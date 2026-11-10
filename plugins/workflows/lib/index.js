/**
 * `@buka/dsh-plugin-workflows`：由编排 preset 现场创建的一次性工作流。
 *
 * 创建 / 启动 / 状态 / 取消工具注册在 Host 上，但只对配置里点名的 agent preset
 * （默认随插件发布的 `workflow-orchestrator`）的根会话可见；机器人节点会话另外
 * 获得四个只读观测工具（运行总览 / 执行输入 / 执行输出与附件清单 / 附件读取），可见性按运行记录里的
 * sessionId 判定。编排 agent 审视任务后，把一份节点定义连同目标交给
 * `buka_workflow_start`，插件现场校验并顺序执行：同一个 robot 在一次运行里只开
 * 一个会话（落到普通工作 preset），再次进入时先 compact 压缩历史、再把新的边
 * prompt 发进同一会话；每个 robot 节点交回一个 JSON，`next` 选中的出边就是下一跳；
 * gate 节点弹一次原生审批。
 *
 * 不含 gate 的定义在后台跑：工具立刻返回 runId，节点会话由 Host 侧观察者继续
 * 调度，浏览器里只读的运行页负责观察。含 gate 的定义必须在调用者的 turn 内
 * 跑完，因为原生审批要求会话有活跃的 turn。
 *
 * 运行数据落盘到插件目录下的 `runs/`（定义快照、状态快照、事件流、节点结果、节点附件），
 * 既是回看依据，也是恢复的权威状态：Host 侧观察者（lib/supervisor.js）订阅全局
 * 会话事件推进运行，会话中断只续接同一会话，续接失败即终止运行；宿主重启后
 * 未完成的运行会尝试恢复，无法续接时标成 `interrupted`。等待
 * 原生审批的门禁运行无法重建审批，也会标成 `interrupted`。
 * 每次运行有一个持久递增的序号（`runs/sequence.json` 计数器），页面与工具输出
 * 都显示 `#N`；结束的运行按自动归档设置（`runs/` 同级的 `settings.json`，默认
 * 24 小时归档、168 小时删除）自动隐藏或删除，运行中的记录不会被处理。
 *
 * 跨插件依赖只走服务：`ctx.get('bukaRobots')`；取不到时在启动 robot 节点前
 * 报一条明确的安装提示。运行页的节点图还会用它提供的 `avatarMap()` 画出机器人
 * 头像（取不到时图照常画，只是不带头像）。
 *
 * @module @buka/dsh-plugin-workflows
 */

import { createReadStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { resolveWorkflowAccess } from './access.js'
import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_MAX_ATTACHMENTS_PER_NODE,
  DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
  DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
} from './attachments.js'
import { describePlan, validateDefinition } from './definition.js'
import { buildRunGraph, layoutRunGraph } from './graph.js'
import { WorkflowRunStore } from './run-store.js'
import { createSessionToolVisibility, createWorkflowSessionTools } from './session-tools.js'
import { WorkflowSupervisor } from './supervisor.js'
import {
  defaultSettings,
  readSettings,
  resolveSettingsFile,
  validateSettingsInput,
  writeSettings,
} from './settings.js'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 不是一回事。 */
export const name = 'tool-buka-workflows'

/** 依赖的服务：只需要工具注册表；robots / approval 在调用时按需获取。 */
export const inject = ['tools']

/** 插件全局目录名。 */
const PLUGIN_CACHE_DIR = 'dsh-plugin-workflows'

/** 浏览器一半读取运行列表的路由。 */
const RUNS_ROUTE = '/buka-workflows/runs'

/** 浏览器一半读取单次运行详情的路由。 */
const RUN_ROUTE = '/buka-workflows/run'

/** 浏览器一半下载节点附件的路由。 */
const ATTACHMENT_ROUTE = '/buka-workflows/attachment'

/** 浏览器一半读 / 写自动归档设置的路由。 */
const SETTINGS_ROUTE = '/buka-workflows/settings'

/** 自动归档的巡检间隔：设置按小时计，每小时扫一次足够。 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** 设置请求体上限：只有几个字段。 */
const MAX_BODY_BYTES = 8 * 1024

/** 默认配置。 */
const DEFAULTS = {
  runsDir: defaultRunsDir(),
  maxRuns: 200,
  // 默认不超时：节点耗时取决于模型速度、任务大小与网络，硬截止很容易误杀。
  // 需要边界的定义可以显式写 robot 节点的 timeoutMs。
  nodeTimeoutMs: 0,
  maxSteps: 64,
  maxNodeTextBytes: 64 * 1024,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  maxAttachmentsPerNode: DEFAULT_MAX_ATTACHMENTS_PER_NODE,
  maxNodeAttachmentsBytes: DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
  maxInlineAttachmentBytes: DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
  orchestratorPresets: ['workflow-orchestrator'],
  robotPreset: 'standard',
}

/**
 * 可配置的运行记录目录与限额。
 */
export const Config = z.object({
  runsDir: z
    .string()
    .default(DEFAULTS.runsDir)
    .description('运行记录目录；每次运行在它下面建一个子目录。支持 ~ 前缀。'),
  maxRuns: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxRuns)
    .description('已归档运行最多保留多少条；超出时从最旧的已归档运行开始删除。未归档记录不受这个上限影响。'),
  nodeTimeoutMs: z
    .number()
    .step(1)
    .min(0)
    .default(DEFAULTS.nodeTimeoutMs)
    .description('单个机器人节点的默认硬超时（毫秒）；0 表示不超时。默认不超时，建议由定义按节点显式设置 timeoutMs。'),
  maxSteps: z.number().step(1).min(1).default(DEFAULTS.maxSteps).description('单次工作流的最大节点步数。'),
  maxNodeTextBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxNodeTextBytes)
    .description('每个节点结果全文落盘时的字节上限。'),
  maxAttachmentBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxAttachmentBytes)
    .description('单个节点附件的字节上限。'),
  maxAttachmentsPerNode: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxAttachmentsPerNode)
    .description('每次执行最多允许的附件数量。'),
  maxNodeAttachmentsBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxNodeAttachmentsBytes)
    .description('每次执行的附件总量字节上限。'),
  maxInlineAttachmentBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxInlineAttachmentBytes)
    .description('可在 prompt 中用 .text 内联的单个文本附件字节上限。'),
  orchestratorPresets: z
    .array(z.string())
    .default(DEFAULTS.orchestratorPresets)
    .description(
      '能看到并调用工作流工具的 agent preset 名单。留空表示不做收窄（所有会话可见）；推荐只保留随插件发布的 `workflow-orchestrator`。',
    ),
  robotPreset: z
    .string()
    .default(DEFAULTS.robotPreset)
    .description(
      '机器人节点会话使用的 agent preset。编排器跑在专用 preset 上，机器人节点不能继承它，否则会带上编排 persona 且缺少工作工具。',
    ),
})

/** 模型可读的定义格式说明。 */
const DEFINITION_HELP = `A one-off workflow definition is a JSON object:
{
  "goal": "optional overall goal, available to prompts as {{goal}}",
  "maxSteps": 64,
  "nodes": [ ... ]
}

Node types:
- start: { "id", "type": "start", "next": [{ "to": "<robot id>", "name": "short edge name", "prompt": "..." }] }
  Exactly one start node. It never executes and does not count as a step; its single outgoing edge carries the prompt for the first real node, which must be a robot node.
- robot: { "id", "type": "robot", "robot": "<robot name>", "output": { ... }, "summary": "one-line step summary shown in the run page", "agentOptions"?: {...}, "timeoutMs"?, "maxVisits"?, "next"?: [edge, ...] }
  Each robot keeps ONE session for the whole run: the first time any node uses that robot, its session is created; every later entry (another node, or a loop back to the same node) first compacts that session's history and then sends the new edge prompt into the same session. The robot keeps continuity across entries while its context stays bounded.
  A robot node has NO prompt of its own: every edge entering it carries the prompt for that entry. This is how the same robot node gets a different instruction when a loop sends work back to it.
  "output" is REQUIRED: a JSON Schema object with "type": "object" that declares the result JSON fields. Allowed keywords: type, description, properties, required, additionalProperties (boolean), items, enum, const, oneOf; property names use [A-Za-z0-9_-]. Do NOT declare "next" or "attachments" inside output: the engine adds "next" from the outgoing edge names (required when there are outgoing edges) and always adds the built-in "attachments" capability.
  Give every robot node a short "summary": the run page shows it as the step's title.
  "timeoutMs" is optional and there is NO default timeout: a slow model, a large task or a slow network must not be killed by a guessed deadline. Only set it when the node genuinely has a hard time bound.
  Every robot node must finish by calling structured_output with one JSON object matching that schema (a plain-text JSON object is also accepted and validated the same way). If the node has outgoing edges, that JSON MUST contain "next", whose value is one of the outgoing edge names. The engine reads "next" and follows that edge automatically; no other agent decides the route. A terminal robot node (no outgoing edges) still submits JSON but does not need "next". A result that does not match "output" is asked again in the same session, then the node fails.
  The engine appends this declared result contract to every node prompt, so the edge prompt should only state the task and explain what each outgoing edge name means; do not repeat the field list.
  A node may also return optional "attachments": an array of file paths (relative to its workspace) or { "path", "name"?, "description"? } objects. Attachments are a built-in capability for independent data or files (binaries, archives, traces, large datasets); they are NOT a channel for the answer itself. The node's final text is this step's output shown on the run page: tell the robot to put the actual answer there and in the declared fields, never only in an attachment. The workflow copies those files into that execution's node directory so later nodes can read them.
  The outgoing edge names are the only valid values for "next".
- gate: { "id", "type": "gate", "title": "...", "detail"?: "...", "onApprove"?: edge, "onReject"?: edge }
  edge is either a node id string, or { "to": "<node id>", "name"?: "...", "prompt"?: "..." }. Waits for one native approval dialog. Approve goes to onApprove; reject goes to onReject; either may be omitted to end the run (approved => completed, rejected => rejected). An edge entering a robot node must carry a prompt.
- end: { "id", "type": "end", "status"?: "completed" | "failed" | "rejected" }

"next" is an array of edge rules: { "to": "<node id>", "name": "route key", "prompt"?: "prompt for the target robot node" }
Every edge leaving a robot node needs a unique "name" within that node; that name is the route value the robot returns in JSON "next". Edges entering a robot node must carry "prompt"; edges entering a gate or end node must not. The prompt is rendered only when that edge is taken; its template variables are checked at plan time (the referenced node must exist and every data path must be declared in that node's "output").
The start node's edge is the prompt for the first robot node; a loop edge back to a robot node is how a revisit gets different instructions. Gate edges without a name show as approve / reject.
Every node must be reachable from the start node: a node nothing leads to would never run, so it is rejected instead of being drawn as a second entry. Edges may not point back at the start node.
A loop node should set "maxVisits": the run warns when a robot node is on a cycle without it, because then only maxSteps bounds the loop.

"report" and "when" were removed in workflow format 2; the validator rejects them. Routing is driven solely by the JSON "next" route.

Prompt templates only interpolate these paths (no expressions):
{{goal}}, {{step}}, {{nodes.<node id>.text}}, {{nodes.<node id>.data.<path>}}, {{nodes.<node id>.route}}, {{nodes.<gate id>.decision}},
and for an attachment of a completed node: {{nodes.<node id>.attachments.<index>.text}}, .path, .name, .bytes, .description.
The engine validates templates at plan time: the referenced node must exist, and every {{nodes.<node id>.data.<path>}} must be declared in that node's "output" (objects by properties, arrays by numeric index plus "items", oneOf in every variant). Plain {{nodes.<id>.data}} passes the whole result object. Use .text only for small UTF-8 text files; binary or oversized attachments need .path or buka_workflow_execution_attachment. Use buka_robots first to see the available robot names. Use buka_workflow_plan to validate before starting.`

/** "计划"工具的描述。 */
const PLAN_DESCRIPTION = `Validate a one-off workflow definition without running it, and return the normalized node graph or precise errors. Use it after buka_robots and before buka_workflow_start. This tool is only visible to the workflow-orchestrator preset; other sessions must not create workflows.\n\n${DEFINITION_HELP}`

/** "启动"工具的描述。 */
const START_DESCRIPTION = `Create and run a one-off workflow as a scheduled run. Every robot keeps one session for the whole run (spawned in the plugin-configured worker preset); later entries compact that session before sending the new prompt. Every robot node declares its result schema in "output"; the engine installs that schema on structured_output (adding "next" and the built-in attachments array) and appends the result contract to the node prompt. When a node has outgoing edges the JSON carries "next" with the outgoing edge name, and the observer follows that edge automatically. Gate nodes wait for the normal approval dialog. There is no default node timeout: a session is allowed to finish at its own pace, and only an explicit robot timeoutMs creates a hard deadline. The definition is stored under the plugin run directory together with the run record, node results and node attachments, and the read-only sidebar page observes them live. Attachments are a built-in capability for independent data/files, not a way to move the answer out of the result; a node's final text is the step output shown on the run page.

Robot sessions are normal sessions: they run as runtime roots, use the deployment's normal approval policy (an explicit approval:'never' is headless only), and may request tool approvals or ask the user questions. The workflow does not inject behavior instructions; it only provides the task prompt, the declared result contract and the meaning of each route.

A host-level observer (not the robot session itself) watches session events: when the active session finishes its turn, it reads the JSON result and follows "next". If the JSON is missing, does not match the declared output, or has an invalid "next", the observer asks the same session to correct it a bounded number of times, then fails the node. If that session is interrupted or disposed, the observer resumes it with a continuation prompt and continues; if it cannot be resumed, the node and run fail with an explicit error and no substitute session is opened. A run that is still going when DSH restarts is resumed from its persisted state (gate runs waiting for approval are marked interrupted because their approval cannot be recreated). Old-format run data is deleted on startup by WORKFLOW_FORMAT_VERSION.

Every run gets a persistent, increasing sequence number (seq, starting at 1) that the sidebar page and buka_workflow_status show as #N. A definition WITHOUT gate nodes starts in the background: the call returns after the first node is dispatched with a runId and that seq, and the observer keeps the run going, so it never blocks your turn. Poll it with buka_workflow_status (or watch the sidebar page). A definition WITH gate nodes must run inside this call, because the native approval dialog needs an active turn: the call returns only after the run reaches a terminal state.

Only the workflow-orchestrator preset can see this tool; robot node sessions run in the worker preset and cannot start nested workflows. Requires the Buka Robots plugin for robot nodes.\n\n${DEFINITION_HELP}`

/** "状态"工具的描述。 */
const STATUS_DESCRIPTION =
  'Read one persisted workflow run by id, or list the most recent runs (each labelled with its persistent sequence number, #N). Runs are recorded on disk by buka_workflow_start; each robot step shows its JSON route (next) and a pending user question or tool approval is reported as pendingInteraction. Unfinished runs are resumed by the host observer after a restart (except gate runs waiting for approval). Background runs keep advancing while you poll.'

/** "取消"工具的描述。 */
const CANCEL_DESCRIPTION =
  'Cancel one still-running workflow run started by buka_workflow_start. Cancelling a finished run is a no-op; the run record is updated on disk.'

/**
 * 注册工具。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 提供 `tools` 的上下文
 * @param {{ runsDir?: string, maxRuns?: number, nodeTimeoutMs?: number, maxSteps?: number, maxNodeTextBytes?: number, maxAttachmentBytes?: number, maxAttachmentsPerNode?: number, maxNodeAttachmentsBytes?: number, maxInlineAttachmentBytes?: number, orchestratorPresets?: string[], robotPreset?: string } | undefined} [config]
 */
export function apply(ctx, config) {
  const options = resolveOptions(config)
  const settingsFile = resolveSettingsFile(options.runsDir)
  const store = new WorkflowRunStore({
    dir: options.runsDir,
    maxRuns: options.maxRuns,
    maxAttachmentBytes: options.maxAttachmentBytes,
    maxAttachmentsPerNode: options.maxAttachmentsPerNode,
    maxNodeAttachmentsBytes: options.maxNodeAttachmentsBytes,
    maxInlineAttachmentBytes: options.maxInlineAttachmentBytes,
    retention: defaultSettings().archive,
    logger: ctx.logger,
  })

  // 观察者常驻 Host 生命周期：订阅全局会话事件，驱动后台运行并在启动时恢复。
  const supervisor = new WorkflowSupervisor({
    ctx,
    store,
    options: {
      nodeTimeoutMs: options.nodeTimeoutMs,
      maxNodeTextBytes: options.maxNodeTextBytes,
      robotPreset: options.robotPreset,
    },
    logger: ctx.logger,
  })
  ctx.inject(['bukaRobots'], (robotsCtx) => {
    supervisor.attachRobots(robotsCtx.bukaRobots)
  })
  ctx.effect(
    () => () => {
      void supervisor.dispose().catch((error) => {
        ctx.logger?.warn?.(`buka-workflows: 释放观察者失败：${describeError(error)}`)
      })
    },
    'buka-workflows: dispose observer',
  )

  /** 自动归档巡检定时器；存储初始化完成后启动，插件卸载时停掉。 */
  /** @type {NodeJS.Timeout | null} */
  let sweepTimer = null
  ctx.effect(
    () => () => {
      if (sweepTimer !== null) clearInterval(sweepTimer)
      sweepTimer = null
    },
    'buka-workflows: stop archive sweeper',
  )

  /** 启动每小时巡检：自动归档 / 删除只依赖这一个定时器与启动时的一次扫描。 */
  function startSweeper() {
    if (sweepTimer !== null) return
    sweepTimer = setInterval(() => {
      store.sweep().catch((error) => {
        ctx.logger?.warn?.(`buka-workflows: 自动归档巡检失败：${describeError(error)}`)
      })
    }, SWEEP_INTERVAL_MS)
    // 定时器不应该阻止宿主退出。
    sweepTimer.unref?.()
  }

  /**
   * 存储初始化（建目录、回填序号、按设置清理）只做一次；随后由观察者恢复上次
   * 进程留下的未完成运行。归档设置从设置文件读取，页面保存后会立即更新策略
   * 并再扫一次。
   */
  let ready
  function ensureReady() {
    ready ??= (async () => {
      const settings = await readSettings({ file: settingsFile })
      store.setRetention(settings.archive)
      await store.init()
      startSweeper()
      const existing = ctx.get('bukaRobots')
      if (existing !== undefined && existing !== null) supervisor.attachRobots(existing)
      await supervisor.resumeAll()
    })()
    return ready
  }
  // 插件加载后就开始巡检与恢复，不必等到第一次打开页面或调用工具。
  void ensureReady().catch((error) => {
    ctx.logger?.warn?.(`buka-workflows: 初始化运行记录失败：${describeError(error)}`)
  })

  /**
   * 判定某个 agent 能否看到 / 调用工作流工具。
   *
   * 只放行配置里点名的 preset 的根会话；preset 服务不可用时保持可见。
   *
   * @param {{ id?: string } | null | undefined} agent
   * @returns {{ visible: boolean, preset: string | null, reason: string }}
   */
  function accessOf(agent) {
    return resolveWorkflowAccess({
      allowed: options.orchestratorPresets,
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: ctx.get('sessions'),
      agentPresets: ctx.get('agentPresets'),
    })
  }

  /** 工具在每一步的可见性条件。 */
  const visibleWhen = (context) => accessOf(context?.agent).visible

  /**
   * 调用时兜底再校验一次：即便绕过可见性判断直接调用也要被挡住。
   *
   * @param {{ id?: string } | null | undefined} agent
   * @returns {{ visible: boolean, preset: string | null, reason: string }}
   */
  function assertOrchestrator(agent) {
    const access = accessOf(agent)
    if (access.visible) return access
    throw new Error(
      `workflow tools are only available to the ${options.orchestratorPresets.join(' / ')} preset (reason: ${access.reason})`,
    )
  }

  ctx.tools.register(
    defineTool({
      name: 'buka_workflow_plan',
      description: PLAN_DESCRIPTION,
      parameters: {
        definition: {
          type: 'object',
          additionalProperties: true,
          required: true,
          description: 'The complete ephemeral workflow definition (JSON object) described in the tool description.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true, description: 'Whether the definition can run.' },
            errors: {
              type: 'array',
              required: true,
              description: 'Validation errors.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  message: { type: 'string', required: true },
                },
              },
            },
            warnings: {
              type: 'array',
              required: true,
              description: 'Non-fatal problems such as a workflow without any robot node.',
              items: { type: 'string' },
            },
            summary: { type: 'json', required: true, description: 'Normalized node graph, or null when invalid.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderPlanResult(value) }],
      },
      async execute(args) {
        const parsed = validateDefinition(args.definition, { maxSteps: options.maxSteps })
        return {
          ok: parsed.ok,
          errors: parsed.errors.slice(0, 50),
          warnings: parsed.warnings,
          summary: parsed.ok ? describePlan(parsed.plan) : null,
        }
      },
    }),
    { when: visibleWhen },
  )

  ctx.tools.register(
    defineTool({
      name: 'buka_workflow_start',
      description: START_DESCRIPTION,
      parameters: {
        definition: {
          type: 'object',
          additionalProperties: true,
          required: true,
          description: 'The complete ephemeral workflow definition (JSON object) described in the tool description.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            run: { type: 'json', required: true, description: 'The final run record when the call ran the workflow itself; null for a background run.' },
            runId: { type: 'string', required: true, description: 'Run id used for buka_workflow_status / buka_workflow_cancel.' },
            seq: {
              type: 'number',
              required: true,
              description: 'Persistent run sequence number (starts at 1 and never goes back when old runs are deleted).',
            },
            mode: {
              type: 'string',
              required: true,
              description: "'background' when the observer keeps scheduling node sessions after this call returns; 'foreground' when the call waited for a terminal state.",
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderStart(value) }],
      },
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined || agent === null) {
          throw new Error(
            'buka_workflow_start requires a calling agent; start it from a DSH session rather than a service call',
          )
        }
        assertOrchestrator(agent)

        const parsed = validateDefinition(args.definition, { maxSteps: options.maxSteps })
        if (!parsed.ok) {
          throw new Error(`invalid workflow definition: ${formatErrors(parsed.errors)}`)
        }

        const robots = ctx.get('bukaRobots')
        const needsRobots = parsed.plan.order.some((id) => parsed.plan.nodes[id].type === 'robot')
        if (
          needsRobots &&
          (robots === undefined || robots === null || typeof robots.dispatchSession !== 'function')
        ) {
          throw new Error(
            'robot nodes need a Buka Robots service with dispatchSession(); install or update @buka/dsh-plugin-robots first',
          )
        }
        const approval = ctx.get('approval')
        const needsApproval = parsed.plan.order.some((id) => parsed.plan.nodes[id].type === 'gate')
        if (needsApproval && (approval === undefined || approval === null)) {
          throw new Error('gate nodes need the approval service, which is unavailable in this composition')
        }

        await ensureReady()

        // 观察者接管执行：gate 节点要弹原生审批，而审批要求会话里有活跃的
        // turn，所以含 gate 的定义只能前台跑完；其余定义在第一个节点 dispatch
        // 后立刻返回 runId，后续由观察者按会话事件推进。
        if (needsApproval) {
          const run = await supervisor.start({
            plan: parsed.plan,
            definition: args.definition,
            agent,
            mode: 'foreground',
            signal: exec.signal,
          })
          return {
            run,
            runId: run.runId ?? '',
            seq: Number.isInteger(run.seq) ? run.seq : 0,
            mode: 'foreground',
          }
        }

        const started = await supervisor.start({
          plan: parsed.plan,
          definition: args.definition,
          agent,
          mode: 'background',
        })
        const runId = typeof started?.runId === 'string' ? started.runId : ''
        if (runId === '') throw new Error('workflow failed to start')
        const createdRun = await store.readRun(runId)
        return {
          run: null,
          runId,
          seq: Number.isInteger(createdRun?.seq) ? createdRun.seq : started.seq,
          mode: 'background',
        }
      },
    }),
    { when: visibleWhen },
  )

  ctx.tools.register(
    defineTool({
      name: 'buka_workflow_status',
      description: STATUS_DESCRIPTION,
      parameters: {
        run_id: {
          type: 'string',
          description: 'Run id returned by buka_workflow_start. Omit to list the most recent runs.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            run: { type: 'json', required: true, description: 'One run record, or null.' },
            runs: { type: 'json', required: true, description: 'Recent run summaries when no run id was given.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
      },
      async execute(args) {
        await ensureReady()
        const runId = typeof args.run_id === 'string' ? args.run_id.trim() : ''
        if (runId !== '') {
          return { run: await store.readRun(runId), runs: [] }
        }
        return { run: null, runs: await store.listRuns(10) }
      },
    }),
    { when: visibleWhen },
  )

  ctx.tools.register(
    defineTool({
      name: 'buka_workflow_cancel',
      description: CANCEL_DESCRIPTION,
      parameters: {
        run_id: {
          type: 'string',
          required: true,
          description: 'Run id returned by buka_workflow_start.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cancelled: { type: 'boolean', required: true, description: 'Whether a live run was signalled.' },
            run: { type: 'json', required: true, description: 'The run record read back from disk, or null.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderCancel(value) }],
      },
      async execute(args, exec) {
        assertOrchestrator(exec.agent)
        const runId = typeof args.run_id === 'string' ? args.run_id.trim() : ''
        if (runId === '') throw new Error('run_id is required')
        await ensureReady()
        const cancelled = await supervisor.cancel(runId, 'cancelled by the workflow orchestrator')
        return { cancelled, run: await store.readRun(runId) }
      },
    }),
    { when: visibleWhen },
  )

  // ---- 机器人节点会话里的只读观测工具 -----------------------------------
  //
  // 四个工具全局注册，但只对运行记录里出现过的机器人会话可见。会话索引在插件
  // 启动时从 run.steps / run.sessions 重建，所以运行结束或 DSH 重启后重新打开
  // 机器人会话时工具仍在；手动机器人会话不属于任何运行，看不到它们。
  const sessionTools = createWorkflowSessionTools({
    defineTool,
    store,
    resolveSession: (sessionId) => supervisor.sessionRun(sessionId),
  })
  const sessionToolVisibleWhen = createSessionToolVisibility({
    ensureIndex: () => supervisor.ensureSessionIndex(),
    resolveSession: (sessionId) => supervisor.sessionRun(sessionId),
  })
  for (const tool of sessionTools) {
    ctx.tools.register(tool, { when: sessionToolVisibleWhen })
  }

  // ---- 浏览器一半的路由 ----------------------------------------------------
  //
  // 页面只读取落盘的运行记录，不提供“运行工作流”：workflow 由 agent 在会话里
  // 现场创建；唯一的写入口是自动归档设置（settings 文件）。路由沿用 web 组合
  // 的信任栅栏，只接受本机、已认证的浏览器请求。

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    /**
     * 复用 web 组合的信任栅栏；被拒绝时已经写好响应。
     *
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     * @returns {boolean}
     */
    function rejected(req, res) {
      let rejection
      try {
        rejection = webCtx.connection.requestRejection(req)
      } catch {
        rejection = 500
      }
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
    }

    /**
     * 读取查询参数。
     *
     * @param {import('node:http').IncomingMessage} req
     * @returns {URL}
     */
    function requestUrl(req) {
      return new URL(req.url ?? '/', 'http://localhost')
    }

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: RUNS_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            try {
              await ensureReady()
              const params = requestUrl(req).searchParams
              const limit = parseLimit(params.get('limit'))
              // 默认只看未归档的运行；?archived=1 是页面「查看已归档」用的。
              const archived = params.get('archived') === '1'
              const [runs, archivedCount] = await Promise.all([
                store.listRuns(limit, { archived }),
                store.countArchived(),
              ])
              sendJson(res, 200, { ok: true, runs, archivedCount })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 读取运行列表失败：%s', describeError(error))
              sendError(res, 500, 'list-failed', `读取运行列表失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET ${RUNS_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: SETTINGS_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method === 'GET') {
              try {
                const settings = await readSettings({ file: settingsFile })
                sendJson(res, 200, { ok: true, settings: settingsPayload(settings) })
              } catch (error) {
                webCtx.logger?.warn?.('buka-workflows: 读取归档设置失败：%s', describeError(error))
                sendError(res, 500, 'settings-failed', `读取归档设置失败：${describeError(error)}`)
              }
              return
            }
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'GET, POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const parsed = validateSettingsInput(body)
            if (!parsed.ok) {
              sendError(res, 400, 'invalid-settings', parsed.message)
              return
            }
            try {
              await ensureReady()
              const saved = await writeSettings({
                file: settingsFile,
                settings: { version: 1, archive: parsed.archive },
              })
              // 保存后立即生效：更新存储策略并马上扫一次，页面刷新就能看到归档结果。
              store.setRetention(saved.settings.archive)
              await store.sweep()
              webCtx.logger?.info?.(
                'buka-workflows: 自动归档设置已更新（%s，归档 %s 小时，删除 %s 小时）',
                saved.settings.archive.enabled ? '启用' : '停用',
                saved.settings.archive.archiveAfterHours,
                saved.settings.archive.deleteAfterHours,
              )
              sendJson(res, 200, {
                ok: true,
                settings: settingsPayload(saved.settings),
                archivedCount: await store.countArchived(),
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 保存归档设置失败：%s', describeError(error))
              sendError(res, 500, 'settings-failed', `保存归档设置失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET/POST ${SETTINGS_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: RUN_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            const runId = requestUrl(req).searchParams.get('runId') ?? ''
            if (runId.trim() === '') {
              sendError(res, 400, 'invalid-run-id', 'runId is required')
              return
            }
            try {
              await ensureReady()
              const run = await store.readRun(runId.trim())
              if (run === null) {
                sendError(res, 404, 'not-found', `workflow run not found: ${runId}`)
                return
              }
              const [definition, nodeResults] = await Promise.all([
                store.readDefinition(run.runId),
                store.readNodeResults(run.runId),
              ])
              // 图模型与坐标一次算好：页面只渲染，单测直接断言几何结果。
              // 机器人头像从 robots 服务拿（只读登记表）；插件没装 / 表损坏时没有
              // 头像表，图照常绘制，只是胶囊前不画头像。
              const model = buildRunGraph({ run, definition, avatars: await robotAvatars(ctx) })
              sendJson(res, 200, {
                ok: true,
                run,
                definition,
                nodeResults,
                graph: model === null ? null : { ...model, ...layoutRunGraph(model) },
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 读取运行详情失败：%s', describeError(error))
              sendError(res, 500, 'read-failed', `读取运行详情失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET ${RUN_ROUTE}`,
    )

    // 附件下载：只读、只允许清单里的文件。参数非法或文件已删除时返回 404，
    // 不把 runs 目录里的其它文件暴露出去。
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: ATTACHMENT_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            const params = requestUrl(req).searchParams
            const runId = (params.get('runId') ?? '').trim()
            const nodeId = (params.get('nodeId') ?? '').trim()
            const name = params.get('name') ?? ''
            const seq = Number.parseInt(params.get('seq') ?? '', 10)
            if (runId === '' || nodeId === '' || name === '') {
              sendError(res, 400, 'invalid-attachment', 'runId, seq, nodeId and name are required')
              return
            }
            if (!Number.isInteger(seq) || seq <= 0) {
              sendError(res, 400, 'invalid-seq', 'seq must be a positive integer')
              return
            }
            if (runId === '.' || runId === '..' || runId.includes('/') || runId.includes('\\')) {
              sendError(res, 400, 'invalid-run-id', 'runId must be a single path segment')
              return
            }
            try {
              await ensureReady()
              let attachment = null
              try {
                attachment = await store.openAttachment(runId, seq, nodeId, name)
              } catch {
                attachment = null
              }
              if (attachment === null) {
                sendError(res, 404, 'not-found', 'attachment not found')
                return
              }
              res.statusCode = 200
              res.setHeader('content-type', 'application/octet-stream')
              res.setHeader('content-length', String(attachment.bytes))
              res.setHeader('content-disposition', attachmentDisposition(attachment.name))
              res.setHeader('x-content-type-options', 'nosniff')
              res.setHeader('cache-control', 'no-store')
              const stream = createReadStream(attachment.path)
              res.on('close', () => stream.destroy())
              stream.on('error', (error) => {
                webCtx.logger?.warn?.('buka-workflows: 读取附件失败：%s', describeError(error))
                if (!res.headersSent) sendError(res, 500, 'read-failed', 'attachment could not be read')
                else res.destroy(error)
              })
              stream.pipe(res)
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 下载附件失败：%s', describeError(error))
              if (!res.headersSent) sendError(res, 500, 'read-failed', `attachment could not be read: ${describeError(error)}`)
              else res.destroy(error)
            }
          },
        }),
      `buka-workflows: GET ${ATTACHMENT_ROUTE}`,
    )
  })
}

/**
 * 附件的下载头：ASCII 回退 + 完整 UTF-8 文件名。
 *
 * @param {string} name
 * @returns {string}
 */
function attachmentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_')
  const encoded = encodeURIComponent(name).replace(/'/gu, '%27')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * 合并配置与默认值，并解析 runs 目录。
 *
 * @param {{ runsDir?: string, maxRuns?: number, nodeTimeoutMs?: number, maxSteps?: number, maxNodeTextBytes?: number, maxAttachmentBytes?: number, maxAttachmentsPerNode?: number, maxNodeAttachmentsBytes?: number, maxInlineAttachmentBytes?: number, orchestratorPresets?: string[], robotPreset?: string } | undefined} config
 * @returns {{ runsDir: string, maxRuns: number, nodeTimeoutMs: number, maxSteps: number, maxNodeTextBytes: number, maxAttachmentBytes: number, maxAttachmentsPerNode: number, maxNodeAttachmentsBytes: number, maxInlineAttachmentBytes: number, orchestratorPresets: string[], robotPreset: string }}
 */
function resolveOptions(config) {
  const orchestratorPresets = Array.isArray(config?.orchestratorPresets)
    ? config.orchestratorPresets.map((preset) => String(preset).trim()).filter((preset) => preset !== '')
    : DEFAULTS.orchestratorPresets
  const robotPreset = typeof config?.robotPreset === 'string' ? config.robotPreset.trim() : ''
  return {
    runsDir: resolveRunsDir(config?.runsDir),
    maxRuns: positive(config?.maxRuns) ?? DEFAULTS.maxRuns,
    nodeTimeoutMs: positive(config?.nodeTimeoutMs) ?? DEFAULTS.nodeTimeoutMs,
    maxSteps: positive(config?.maxSteps) ?? DEFAULTS.maxSteps,
    maxNodeTextBytes: positive(config?.maxNodeTextBytes) ?? DEFAULTS.maxNodeTextBytes,
    maxAttachmentBytes: positive(config?.maxAttachmentBytes) ?? DEFAULTS.maxAttachmentBytes,
    maxAttachmentsPerNode:
      positive(config?.maxAttachmentsPerNode) ?? DEFAULTS.maxAttachmentsPerNode,
    maxNodeAttachmentsBytes:
      positive(config?.maxNodeAttachmentsBytes) ?? DEFAULTS.maxNodeAttachmentsBytes,
    maxInlineAttachmentBytes:
      positive(config?.maxInlineAttachmentBytes) ?? DEFAULTS.maxInlineAttachmentBytes,
    orchestratorPresets,
    robotPreset: robotPreset === '' ? DEFAULTS.robotPreset : robotPreset,
  }
}

/**
 * 解析 runs 目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/runs`。
 *
 * @param {string | undefined} value
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveRunsDir(value, env = process.env) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return defaultRunsDir(env)
  if (text === '~') return path.join(homeDir(env), `.cache`, PLUGIN_CACHE_DIR, 'runs')
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.resolve(homeDir(env), text.slice(2))
  }
  return path.resolve(text)
}

/**
 * 默认运行目录。
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultRunsDir(env = process.env) {
  const cacheHome =
    typeof env.XDG_CACHE_HOME === 'string' && env.XDG_CACHE_HOME.trim() !== ''
      ? env.XDG_CACHE_HOME.trim()
      : path.join(homeDir(env), '.cache')
  return path.join(cacheHome, PLUGIN_CACHE_DIR, 'runs')
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function homeDir(env) {
  const home = typeof env.HOME === 'string' ? env.HOME.trim() : ''
  return home === '' ? os.homedir() : home
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positive(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * 定义错误的单行文本。
 *
 * @param {Array<{ path: string, message: string }>} errors
 * @returns {string}
 */
function formatErrors(errors) {
  return errors.map((error) => `${error.path}: ${error.message}`).join('; ')
}

/**
 * `buka_workflow_plan` 的展示文本。
 *
 * @param {Record<string, any>} value
 * @returns {string}
 */
export function renderPlanResult(value) {
  const errors = Array.isArray(value?.errors) ? value.errors : []
  const warnings = Array.isArray(value?.warnings) ? value.warnings : []
  if (value?.ok !== true) {
    const lines = [`workflow definition is invalid (${errors.length} error${errors.length === 1 ? '' : 's'}):`]
    for (const error of errors) lines.push(`- ${error.path}: ${error.message}`)
    for (const warning of warnings) lines.push(`! ${warning}`)
    return lines.join('\n')
  }
  const summary = value?.summary ?? {}
  const nodes = Array.isArray(summary.nodes) ? summary.nodes : []
  const lines = [
    `workflow definition is valid: start=${summary.start}, ${nodes.length} node${nodes.length === 1 ? '' : 's'}, maxSteps=${summary.maxSteps}`,
  ]
  if (typeof summary.goal === 'string' && summary.goal !== '') lines.push(`goal: ${summary.goal}`)
  for (const node of nodes) {
    lines.push(`- ${node.id} [${node.type}${node.robot === undefined ? '' : ` robot=${node.robot}`}]`)
  }
  for (const warning of warnings) lines.push(`! ${warning}`)
  return lines.join('\n')
}

/**
 * 运行的序号标签：`#12 `；旧记录没有序号时是空串。
 *
 * @param {Record<string, any> | null | undefined} run
 * @returns {string}
 */
function runSeqLabel(run) {
  return Number.isInteger(run?.seq) && run.seq > 0 ? `#${run.seq} ` : ''
}

/**
 * 一次运行的展示文本。
 *
 * @param {Record<string, any> | null | undefined} run
 * @returns {string}
 */
export function renderRun(run) {
  if (run === null || run === undefined) return 'No workflow run was recorded.'
  const lines = [`workflow ${runSeqLabel(run)}${run.runId} — ${run.status}`]
  if (typeof run.goal === 'string' && run.goal !== '') lines.push(`goal: ${run.goal}`)
  const steps = Array.isArray(run.steps) ? run.steps : []
  if (steps.length === 0) lines.push('no steps completed')
  for (const step of steps) {
    const robot = typeof step.robot === 'string' && step.robot !== '' ? ` robot=${step.robot}` : ''
    const session = typeof step.sessionId === 'string' && step.sessionId !== '' ? ` session=${step.sessionId}` : ''
    const reason = typeof step.stopReason === 'string' ? ` (${step.stopReason})` : ''
    const route = typeof step.route === 'string' && step.route !== '' ? ` route=${step.route}` : ''
    const attachments =
      Array.isArray(step.attachments) && step.attachments.length > 0
        ? ` attachments=${step.attachments.length}`
        : ''
    lines.push(`- ${step.nodeId} [${step.type}${robot}] ${step.status}${reason}${route}${attachments}${session}`)
  }
  if (run.result !== null && run.result !== undefined) {
    lines.push(`result: ${JSON.stringify(run.result)}`)
  }
  if (typeof run.error === 'string' && run.error !== '') lines.push(`error: ${run.error}`)
  if (run.pendingGate !== null && run.pendingGate !== undefined) {
    lines.push(`waiting at gate: ${run.pendingGate.title ?? run.pendingGate.nodeId}`)
  }
  const pending = run.pendingInteraction
  if (pending !== null && pending !== undefined) {
    const session = typeof pending.sessionId === 'string' ? ` in session ${pending.sessionId}` : ''
    if (pending.kind === 'approval') {
      const reason = typeof pending.reason === 'string' && pending.reason !== '' ? `: ${pending.reason}` : ''
      lines.push(`waiting for the user to approve ${pending.toolName ?? 'a tool'}${session}${reason}`)
    } else {
      const first = Array.isArray(pending.questions) ? pending.questions[0] : null
      const text = first === null || first === undefined ? '' : first.question || first.header || ''
      lines.push(`waiting for the user to answer${session}${text === '' ? '' : `: ${text}`}`)
    }
  }
  return lines.join('\n')
}

/**
 * `buka_workflow_start` 的展示文本：后台运行只报 runId，前台运行给出终态摘要。
 *
 * @param {{ run?: Record<string, any> | null, runId?: string, mode?: string } | null | undefined} value
 * @returns {string}
 */
export function renderStart(value) {
  if (value?.mode === 'background') {
    const label = Number.isInteger(value?.seq) && value.seq > 0 ? `#${value.seq} ` : ''
    return [
      `workflow ${label}${value.runId} started in the background`,
      'the host observer keeps scheduling node sessions; follow it with buka_workflow_status or the sidebar page',
    ].join('\n')
  }
  return renderRun(value?.run ?? null)
}

/**
 * `buka_workflow_cancel` 的展示文本。
 *
 * @param {{ cancelled?: boolean, run?: Record<string, any> | null } | null | undefined} value
 * @returns {string}
 */
export function renderCancel(value) {
  if (value?.cancelled === true) return `workflow ${value.run?.runId ?? ''} cancellation signalled`
  if (value?.run === null || value?.run === undefined) return 'No workflow run was found.'
  return `workflow ${value.run.runId} is not live (status: ${value.run.status}); nothing to cancel`
}

/**
 * `buka_workflow_status` 的展示文本。
 *
 * @param {{ run: Record<string, any> | null, runs: Array<Record<string, any>> }} value
 * @returns {string}
 */
export function renderStatus(value) {
  if (value?.run !== null && value?.run !== undefined) return renderRun(value.run)
  const runs = Array.isArray(value?.runs) ? value.runs : []
  if (runs.length === 0) return 'No workflow runs have been recorded yet.'
  const lines = ['recent workflow runs:']
  for (const run of runs) {
    const finished = run.finishedAt === null || run.finishedAt === undefined ? 'running' : new Date(run.finishedAt).toISOString()
    const waiting = run.waitingForUser === true ? ' · waiting for user' : ''
    lines.push(`- ${runSeqLabel(run)}${run.runId} ${run.status}${waiting} (${finished})${run.goal ? ` — ${run.goal}` : ''}`)
  }
  return lines.join('\n')
}

/**
 * 取「机器人名 → 头像 id」表，给运行页的节点图用。
 *
 * robots 插件没装、服务没有 `avatarMap()` 或登记表损坏时返回 null；这只是展示
 * 细节，绝不能因为它让运行详情接口失败。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<Record<string, string> | null>}
 */
async function robotAvatars(ctx) {
  try {
    const robots = ctx.get('bukaRobots')
    if (robots === null || robots === undefined || typeof robots.avatarMap !== 'function') return null
    const map = await robots.avatarMap()
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return null
    return map
  } catch {
    return null
  }
}

/**
 * 设置对象 → 浏览器用的平铺字段。页面不关心 `version` 与内部包装。
 *
 * @param {{ archive: { enabled: boolean, archiveAfterHours: number, deleteAfterHours: number } }} settings
 * @returns {{ enabled: boolean, archiveAfterHours: number, deleteAfterHours: number }}
 */
function settingsPayload(settings) {
  return {
    enabled: settings.archive.enabled,
    archiveAfterHours: settings.archive.archiveAfterHours,
    deleteAfterHours: settings.archive.deleteAfterHours,
  }
}

/**
 * 读取 JSON 请求体；content-type 不对、太大或不是合法 JSON 时已经写好响应，
 * 返回 undefined。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req, res) {
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    sendError(res, 415, 'invalid-content-type', 'content-type 必须是 application/json')
    return undefined
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendError(res, 413, 'too-large', '请求体过大')
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    sendError(res, 400, 'invalid-json', '请求体不是合法 JSON')
    return undefined
  }
}

/**
 * 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string | null>}
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/**
 * 查询参数里的条数上限。
 *
 * @param {string | null} value
 * @returns {number}
 */
function parseLimit(value) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1) return 50
  return Math.min(parsed, 100)
}

/**
 * 发送 JSON 响应。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * 统一的失败响应：`{ ok: false, code, message }`。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, code, message })
}

/**
 * 405 并带上唯一支持的方法。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} allow
 */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, code: 'method-not-allowed', message: `only ${allow} is supported` }))
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
