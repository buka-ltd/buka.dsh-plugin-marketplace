/**
 * 编排 agent 能看到 / 调用的工具注册：plan / start / status / cancel / templates。
 *
 * 工具定义与结果渲染分离：schema 在这里，展示文本在 render.ts。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { describePlan, validateDefinition } from './definition.ts'
import type { ResolvedOptions } from './options.ts'
import {
  formatErrors,
  jsonValue,
  renderCancel,
  renderPlanResult,
  renderStart,
  renderStatus,
  renderTemplates,
} from './render.ts'
import type { WorkflowRunStore } from './run-store.ts'
import type { WorkflowSupervisor } from './supervisor.ts'
import { findTemplate, listTemplates, summarizeTemplates } from './templates.ts'

/** 工具注册依赖：插件装配时传进来的上下文与已建好的服务。 */
interface WorkflowToolDeps {
  ctx: Context
  options: ResolvedOptions
  store: WorkflowRunStore
  supervisor: WorkflowSupervisor
  ensureReady: () => Promise<void>
  assertOrchestrator: (agent: { id?: string | null | undefined } | null | undefined) => void
  visibleWhen: (context: ToolActivationContext) => boolean
}

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
- robot: { "id", "type": "robot", "robot": "<robot name>", "output": { ... }, "summary": "one-line step summary shown in the run page", "mode"?: "plan", "agentOptions"?: {...}, "timeoutMs"?, "maxVisits"?, "next"?: [edge, ...] }
  Each robot keeps ONE session for the whole run: the first time any node uses that robot, its session is created; every later entry (another node, or a loop back to the same node) first compacts that session's history and then sends the new edge prompt into the same session. The robot keeps continuity across entries while its context stays bounded.
  A robot node has NO prompt of its own: every edge entering it carries the prompt for that entry. This is how the same robot node gets a different instruction when a loop sends work back to it.
  Set "mode": "plan" when the robot should plan before acting. Its session is switched to DSH plan mode before the first prompt: the robot explores, presents the plan through the native plan review card, and only after the user approves does it carry out the plan and submit the node's structured result. This is ONE node, not a separate approval node: do not add a user node just to approve the plan when the native review is what you want. Plan mode is guidance, not a hard sandbox, and it needs the plan-mode + user-questions services and a compatible Buka Robots plugin. The output contract and "next" routes are unchanged; include the plan in an "output" field if later nodes need it.
  "output" is REQUIRED: a JSON Schema object with "type": "object" that declares the result JSON fields. Allowed keywords: type, description, properties, required, additionalProperties (boolean), items, enum, const, oneOf; property names use [A-Za-z0-9_-]. Do NOT declare "next", "abort" or "attachments" inside output: the engine adds "next" from the outgoing edge names (used only when the node chooses to continue), always adds the built-in "abort" escape, and always adds the built-in "attachments" capability.
  Give every robot node a short "summary": the run page shows it as the step's title.
  "timeoutMs" is optional and there is NO default timeout: a slow model, a large task or a slow network must not be killed by a guessed deadline. Only set it when the node genuinely has a hard time bound.
  Every robot node must finish by calling structured_output with one JSON object matching that schema (a plain-text JSON object is also accepted and validated the same way). When the node has outgoing edges, that JSON MUST contain exactly one of "next" and "abort": "next" is one of the outgoing edge names, or a non-empty list of them to start several edges as concurrent branches (fan-out). The engine reads "next" and follows each edge automatically; no other agent decides the route. A terminal robot node (no outgoing edges) still submits JSON but does not need "next". Any node may instead return {"abort": "<short non-empty reason>"} when it cannot complete the task: the run ends as failed immediately, no edge is followed, and the declared output fields are not required. A missing/invalid JSON result, an invalid "abort", or both "next" and "abort" together is asked again in the same session, then the node fails.
  The engine appends this declared result contract to every node prompt, so the edge prompt should only state the task and explain what each outgoing edge name means; do not repeat the field list. The abort escape is part of that contract, so do not invent a route or an end node just to model "cannot".
  A node may also return optional "attachments": an array of file paths (relative to its workspace) or { "path", "name"?, "description"? } objects. Attachments are a built-in capability for independent data or files (binaries, archives, traces, large datasets); they are NOT a channel for the answer itself. The node's final text is this step's output shown on the run page: tell the robot to put the actual answer there and in the declared fields, never only in an attachment. The workflow copies those files into that execution's node directory so later nodes can read them; attachments are copied only when the node completes normally, not when it aborts.
  The outgoing edge names are the only valid values for "next"; "abort" is not a route.
- user: { "id", "type": "user", "title": "...", "detail"?: "...", "next"?: [{ "to": "<node id>", "name": "route key", "label": "option text", "description"?: "...", "prompt"?: "..." }], "questions"?: [{ "id", "header"?, "question", "multiSelect"?, "options"?: [{ "label", "description"? }] }] }
  A user-intervention checkpoint: the run pauses, shows "title" plus "detail" (templates allowed) to the user through the native question card, and waits. Use it for a decision (the user's options are the outgoing edges), for a manual operation only a human can do (one edge, e.g. label "Done"), or for reviewing a result only a human can see and returning feedback (add "questions"). "title" is required; a user node needs at least one outgoing edge or one extra question.
  User edges are the choices: "name" is a unique route key, "label" is the required, unique text the user sees, "description" is optional. The chosen edge's name is available to later prompts as the route of this node; an edge entering a robot node must carry its prompt.
  "questions" (max 4) collect extra answers in the same batch: each needs a unique "id" (not "route"), a required "question", optional "header", "multiSelect", and "options" [ { "label", "description"? } ]. Answers are stored by question id, so later prompts can read the selected labels and custom text. User nodes need the creating session to have an active turn: a definition containing a user node runs in the foreground, and is marked interrupted if DSH restarts while it waits.
- end: { "id", "type": "end", "status"?: "completed" | "failed" | "rejected" }
- join: { "id", "type": "join", "inputs": ["<robot node id>", ...], "next": [{ "to": "<node id>", "prompt"?: "..." }] }
  A barrier that collects concurrent fan-out branches. It has no robot, no output, no prompt and no result. It fires ONCE when every one of its "inputs" that was actually started in that fan-out has completed, then continues down its single outgoing edge (whose "prompt" is the instruction for the next robot node). Inputs that were never started are ignored, so it waits only for the branches that really ran. One task may appear in several joins (its completion feeds all of them), which gives overlapping groups: with tasks 1..8 available and a fan-out that starts 1..6, X = {1,2,3,7} fires when 1,2,3 finish and Y = {3,4,5,6,8} fires when 3,4,5,6 finish, even though 7 and 8 never started. "inputs" must be robot node ids, and its single outgoing edge enters a robot node (with a prompt) or an end node. Any branch aborting or failing fails the whole run and cancels its siblings (fail-fast).

"next" is an array of edge rules: { "to": "<node id>", "name": "route key", "prompt"?: "prompt for the target robot node", "tone"?: "success" | "failure" }; user-choice edges add "label" (and optional "description").
Every edge leaving a robot node needs a unique "name" within that node; that name is the route value the robot returns in JSON "next". Every edge leaving a user node needs a unique "name" and a unique "label"; the label is the option the user clicks. Edges entering a robot node must carry "prompt"; edges entering a user or end node must not. The prompt is rendered only when that edge is taken; its template variables are checked at plan time (the referenced node must exist and every data path must be declared in that node's "output").
"tone" is optional and purely cosmetic: it draws that edge green ("success") or red ("failure") on the run page and changes nothing about routing, validation or execution. Set it where a branch clearly means success or failure - especially when a node has two outgoing edges whose names alone do not make the difference obvious.
The start node's edge is the prompt for the first robot node; a loop edge back to a robot node is how a revisit gets different instructions.
Every node must be reachable from the start node: a node nothing leads to would never run, so it is rejected instead of being drawn as a second entry. Edges may not point back at the start node.
A loop node should set "maxVisits": the run warns when a robot node is on a cycle without it, because then only maxSteps bounds the loop.

"report" and "when" were removed in workflow format 2, and the gate node was replaced by the user node in workflow format 3; the validator rejects all three. Robot routing is driven solely by the JSON "next" route; "abort" is a failure escape that ends the run, not a route.

Prompt templates only interpolate these paths (no expressions):
{{goal}}, {{step}}, {{nodes.<node id>.text}}, {{nodes.<node id>.data.<path>}}, {{nodes.<node id>.route}},
for a user node: {{nodes.<user id>.answers.<question id>.selected}}, {{nodes.<user id>.answers.<question id>.custom}} (or the whole answer object via {{nodes.<user id>.answers}}); the reserved question id "route" holds the chosen option's label,
and for an attachment of a completed node: {{nodes.<node id>.attachments.<index>.text}}, .path, .name, .bytes, .description.
The engine validates templates at plan time: the referenced node must exist, and every {{nodes.<node id>.data.<path>}} must be declared in that node's "output" (objects by properties, arrays by numeric index plus "items", oneOf in every variant). Plain {{nodes.<id>.data}} passes the whole result object. Use .text only for small UTF-8 text files; binary or oversized attachments need .path or buka_workflow_execution_attachment. Use buka_robots first to see the available robot names. Use buka_workflow_plan to validate before starting.`

/** "计划"工具的描述。 */
const PLAN_DESCRIPTION = `Validate a one-off workflow definition without running it, and return the normalized node graph or precise errors. Use it after buka_robots and before buka_workflow_start. This tool is only visible to the workflow-orchestrator preset; other sessions must not create workflows.\n\n${DEFINITION_HELP}`

/** "启动"工具的描述。 */
const START_DESCRIPTION = `Create and run a one-off workflow as a scheduled run. Every robot keeps one session for the whole run (spawned in the plugin-configured worker preset); later entries compact that session before sending the new prompt. Every robot node declares its result schema in "output"; the engine installs that schema on structured_output (adding "next", the built-in "abort" escape and the built-in attachments array) and appends the result contract to the node prompt. When a node has outgoing edges the JSON carries exactly one of "next" (the outgoing edge name) and "abort", and the observer follows "next" automatically; "abort" ends the run as failed with the node's reason and follows no edge. User nodes pause the run on the native question card: the user's choices are the outgoing edges, and optional extra questions collect feedback that later prompts can read; the answer is returned to the run automatically. There is no default node timeout: a session is allowed to finish at its own pace, and only an explicit robot timeoutMs creates a hard deadline. The definition is stored under the plugin run directory together with the run record, node results and node attachments, and the read-only sidebar page observes them live. Attachments are a built-in capability for independent data/files, not a way to move the answer out of the result, and are copied only when the node completes normally; a node's final text is the step output shown on the run page.

Robot sessions are normal sessions: they run as runtime roots, use the deployment's normal approval policy (an explicit approval:'never' is headless only), and may request tool approvals or ask the user questions. The workflow does not inject behavior instructions; it only provides the task prompt, the declared result contract and the meaning of each route. A robot node with "mode": "plan" is the one mode-specific exception: its session enters DSH plan mode before the prompt, the robot presents its plan through the native plan review card, and after approval it carries out the plan and submits the node result. The review card lives in the robot's own session, so the run page shows a waiting notice with an open-session action; a run without user nodes may still be background. If the robot ends its turn while still in plan mode without presenting a plan, the observer sends one bounded nudge and then fails the node with an explicit reason. Plan mode is soft guidance, not a sandbox; it needs the plan-mode and user-questions services and a compatible Buka Robots plugin, checked before the run starts.

A host-level observer (not the robot session itself) watches session events: when the active session finishes its turn, it reads the JSON result and follows "next". If the JSON is missing, does not match the declared output, has an invalid "next", carries an invalid "abort", or carries both "next" and "abort", the observer asks the same session to correct it a bounded number of times, then fails the node. A valid "abort" ends the run as failed at that node without resuming an interrupted session. If that session is interrupted or disposed, the observer resumes it with a continuation prompt and continues; if it cannot be resumed, the node and run fail with an explicit error and no substitute session is opened. A run that is still going when DSH restarts is resumed from its persisted state (runs that contain user nodes are marked interrupted because their question card needs an active caller turn). Old-format run data is deleted on startup by WORKFLOW_FORMAT_VERSION.

Every run gets a persistent, increasing sequence number (seq, starting at 1) that the sidebar page and buka_workflow_status show as #N. A definition WITHOUT user nodes starts in the background: the call returns after the first node is dispatched with a runId and that seq, and the observer keeps the run going, so it never blocks your turn. Poll it with buka_workflow_status (or watch the sidebar page). A definition WITH user nodes must run inside this call, because the native question card needs an active turn: the call returns only after the run reaches a terminal state.

Only the workflow-orchestrator preset can see this tool; robot node sessions run in the worker preset and cannot start nested workflows. Requires the Buka Robots plugin for robot nodes.\n\n${DEFINITION_HELP}`

/** "状态"工具的描述。 */
const STATUS_DESCRIPTION =
  'Read one persisted workflow run by id, or list the most recent runs (each labelled with its persistent sequence number, #N). Runs are recorded on disk by buka_workflow_start; each robot step shows its JSON route (next), and a step that aborted the run is marked aborted with the node reason in error; a user node waiting for the user is reported as pendingUser, and a robot session question or tool approval as pendingInteraction. Unfinished runs are resumed by the host observer after a restart (except runs that contain user nodes). Background runs keep advancing while you poll.'

/** "取消"工具的描述。 */
const CANCEL_DESCRIPTION =
  'Cancel one still-running workflow run started by buka_workflow_start. Cancelling a finished run is a no-op; the run record is updated on disk.'

/** "模板"工具的描述。 */
const TEMPLATES_DESCRIPTION = `Read the abstract workflow template catalog for reference while designing a real one-off workflow. Templates are NOT runnable definitions: each robot node carries an abstract role name (e.g. a role like "development" or "testing"), has no output schema, and no goal. Each template has a description telling you when to reference it. Use this tool first with no arguments to see the catalog (id, name, description), then pass an id to read one template's full abstract node flow. To build the real workflow, run buka_robots to see the robots you actually own, map each abstract role to a real robot, add the required output schema to every robot node, and write concrete edge prompts for the task; adapt the flow to the requirement instead of copying it verbatim. The sidebar "templates" tab shows the same catalog.`

/**
 * 注册编排 agent 的工作流工具。
 *
 * @param deps 上下文、配置与已建好的存储 / 观察者
 */
export function registerWorkflowTools({
  ctx,
  options,
  store,
  supervisor,
  ensureReady,
  assertOrchestrator,
  visibleWhen,
}: WorkflowToolDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'buka_workflow_plan',
      description: PLAN_DESCRIPTION,
      parameters: {
        definition: {
          type: 'object',
          additionalProperties: true,
          required: true,
          description:
            'The complete ephemeral workflow definition (JSON object) described in the tool description.',
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
            summary: {
              type: 'json',
              required: true,
              description: 'Normalized node graph, or null when invalid.',
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderPlanResult(value) }],
      },
      async execute(args) {
        const parsed = validateDefinition(args.definition, { maxSteps: options.maxSteps })
        return {
          ok: parsed.ok,
          errors: parsed.errors.slice(0, 50).map((error) => ({
            path: error.path,
            message: error.message,
          })),
          warnings: parsed.warnings,
          summary: parsed.ok ? jsonValue(describePlan(parsed.plan)) : null,
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
          description:
            'The complete ephemeral workflow definition (JSON object) described in the tool description.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            run: {
              type: 'json',
              required: true,
              description:
                'The final run record when the call ran the workflow itself; null for a background run.',
            },
            runId: {
              type: 'string',
              required: true,
              description: 'Run id used for buka_workflow_status / buka_workflow_cancel.',
            },
            seq: {
              type: 'number',
              required: true,
              description:
                'Persistent run sequence number (starts at 1 and never goes back when old runs are deleted).',
            },
            mode: {
              type: 'string',
              required: true,
              description:
                "'background' when the observer keeps scheduling node sessions after this call returns; 'foreground' when the call waited for a terminal state.",
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

        const plan = parsed.plan
        const robots = ctx.get('bukaRobots')
        const needsRobots = plan.order.some((id) => plan.nodes[id]?.type === 'robot')
        if (
          needsRobots &&
          (robots === undefined || robots === null || typeof robots.dispatchSession !== 'function')
        ) {
          throw new Error(
            'robot nodes need a Buka Robots service with dispatchSession(); install or update @buka/dsh-plugin-robots first',
          )
        }
        const userQuestions = ctx.get('userQuestions')
        const needsUser = plan.order.some((id) => plan.nodes[id]?.type === 'user')
        if (
          needsUser &&
          (userQuestions === undefined ||
            userQuestions === null ||
            typeof userQuestions.ask !== 'function')
        ) {
          throw new Error(
            'user nodes need the user-questions service, which is unavailable in this composition',
          )
        }
        // plan 节点要三样东西：plan 模式服务本身、原生审阅卡需要的提问通道、
        // 以及在首轮 prompt 之前切换模式的新版 robots 服务。缺任何一样都在
        // 创建运行前拒绝，不能静默按普通机器人节点跑。
        const needsPlanMode = plan.order.some((id) => {
          const node = plan.nodes[id]
          return node !== undefined && node.type === 'robot' && node.mode === 'plan'
        })
        if (needsPlanMode) {
          const planMode = ctx.get('planMode')
          if (planMode === undefined || planMode === null || typeof planMode.set !== 'function') {
            throw new Error(
              'plan mode robot nodes need the plan-mode service (@deepseek-ai/dsh-plan-mode), which is unavailable in this composition',
            )
          }
          if (robots === undefined || robots === null || robots.supportsPlanMode !== true) {
            throw new Error(
              'plan mode robot nodes need @buka/dsh-plugin-robots 0.9.0 or newer (supportsPlanMode is missing); update the Buka Robots plugin',
            )
          }
          if (
            userQuestions === undefined ||
            userQuestions === null ||
            typeof userQuestions.ask !== 'function'
          ) {
            throw new Error(
              'plan mode robot nodes need the user-questions service for the native plan review card, which is unavailable in this composition',
            )
          }
        }

        await ensureReady()

        // 观察者接管执行：user 节点要弹原生提问卡，而提问要求会话里有活跃的
        // turn，所以含 user 节点的定义只能前台跑完；其余定义在第一个节点
        // dispatch 后立刻返回 runId，后续由观察者按会话事件推进。
        if (needsUser) {
          const run = await supervisor.start({
            plan,
            definition: args.definition,
            agent,
            mode: 'foreground',
            signal: exec.signal,
          })
          return {
            run: jsonValue(run),
            runId: typeof run.runId === 'string' ? run.runId : '',
            seq: typeof run.seq === 'number' && Number.isInteger(run.seq) ? run.seq : 0,
            mode: 'foreground',
          }
        }

        const started = await supervisor.start({
          plan,
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
          seq:
            createdRun !== null &&
            typeof createdRun.seq === 'number' &&
            Number.isInteger(createdRun.seq)
              ? createdRun.seq
              : typeof started.seq === 'number'
                ? started.seq
                : 0,
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
            runs: {
              type: 'json',
              required: true,
              description: 'Recent run summaries when no run id was given.',
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
      },
      async execute(args) {
        await ensureReady()
        const runId = typeof args.run_id === 'string' ? args.run_id.trim() : ''
        if (runId !== '') {
          return { run: jsonValue(await store.readRun(runId)), runs: [] }
        }
        return { run: null, runs: jsonValue(await store.listRuns(10)) }
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
            cancelled: {
              type: 'boolean',
              required: true,
              description: 'Whether a live run was signalled.',
            },
            run: {
              type: 'json',
              required: true,
              description: 'The run record read back from disk, or null.',
            },
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
        return { cancelled, run: jsonValue(await store.readRun(runId)) }
      },
    }),
    { when: visibleWhen },
  )

  // 模板目录：只读、只对编排 preset 可见。它不参与运行，只是给 agent 设计真实
  // 工作流时参考的抽象流程。
  ctx.tools.register(
    defineTool({
      name: 'buka_workflow_templates',
      description: TEMPLATES_DESCRIPTION,
      parameters: {
        id: {
          type: 'string',
          description:
            'Template id from the catalog; omit to list every template (id, name, description).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            templates: {
              type: 'array',
              required: true,
              description: 'The template catalog as { id, name, description } summaries.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                },
              },
            },
            template: {
              type: 'json',
              required: true,
              description:
                'The full template (id, name, description, nodes) when an id was given and matched; otherwise null.',
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderTemplates(value) }],
      },
      async execute(args) {
        const id = typeof args.id === 'string' ? args.id.trim() : ''
        const templates = listTemplates()
        const template = id === '' ? null : findTemplate(id)
        return {
          templates: summarizeTemplates(templates),
          template: template === null ? null : jsonValue(template),
        }
      },
    }),
    { when: visibleWhen },
  )
}
