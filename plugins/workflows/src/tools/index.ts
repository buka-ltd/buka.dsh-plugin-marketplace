/**
 * 模型工具注册（ADR 0015）。
 *
 * 可见性：
 * - 工作流定义工具只对配置点名的编排 preset 根会话可见；
 * - 启动 / 状态 / 取消工具对普通会话可见（发起人 = 当前会话）；
 * - 执行工具（建任务 / 提交结果 / 看板 / 任务 / 附件）只对引擎创建的任务会话、
 *   助理会话与发起人会话可见，并在 `execute` 里按会话再校验一次。
 *
 * @module @buka/dsh-plugin-workflows/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolActivationContext, ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { DeliveryRule, JsonValue } from '../domain/types.ts'
import type { WorkflowEngine } from '../engine/engine.ts'
import type { ResolvedOptions } from '../options.ts'

/** 工具注册依赖。 */
export interface WorkflowToolDeps {
  readonly ctx: Context
  readonly ready: () => Promise<WorkflowEngine>
  readonly options: ResolvedOptions
  /** 编排 preset 根会话的可见性条件。 */
  readonly orchestratorVisible: (context: ToolActivationContext) => boolean
  /** 执行会话（任务 / 助理 / 发起人）的可见性条件。 */
  readonly executionVisible: (context: ToolActivationContext) => boolean | Promise<boolean>
  /** 发起人 / 执行会话的可见性条件（状态 / 取消）。 */
  readonly starterVisible: (context: ToolActivationContext) => boolean | Promise<boolean>
  /** 调用时再校验一次编排 preset（防止绕过可见性直接调用）。 */
  readonly assertOrchestrator: (agent: { id?: unknown } | null | undefined) => void
}

/** 工具输出 schema 里 `type: "json"` 对应的值类型；运行时就是 JSON。 */
type ToolJson = NonNullable<ToolResult['meta']>

/**
 * 把已知 JSON 兼容的运行时对象标成工具输出的 json 类型。
 *
 * @param value 运行时的 JSON 对象
 * @returns 工具输出可接受的 json 值
 */
function toolJson(value: unknown): ToolJson {
  return value as ToolJson
}

/** 模型可读的任务投影：不带岗位 / 通道等编排信息。 */
function taskForModel(task: Record<string, unknown>, withContent = false): Record<string, unknown> {
  const result = task.result as Record<string, unknown> | null | undefined
  return {
    id: task.id,
    type: task.typeLabel ?? task.type,
    status: task.status,
    deps: task.deps,
    ...(withContent ? { content: task.content } : {}),
    ...(result === null || result === undefined
      ? {}
      : {
          text: result.text,
          ...(result.action === undefined ? {} : { action: result.action }),
          ...(result.input === undefined ? {} : { input: result.input }),
          attachments: Array.isArray(result.attachments)
            ? (result.attachments as Record<string, unknown>[]).map((attachment) => ({
                id: attachment.id,
                name: attachment.name,
                bytes: attachment.bytes,
                mime: attachment.mime,
                description: attachment.description,
              }))
            : [],
        }),
  }
}

/** 一段模型可读文本。 */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** 取调用会话 id。 */
function sessionIdOf(context: { agent?: { id?: unknown } }): string {
  return typeof context.agent?.id === 'string' ? context.agent.id : ''
}

/** 定义格式的简短帮助（给编排 agent）。 */
const DEFINITION_HELP = `Workflow definition (v8) JSON shape:
{
  "version": 8, "name": "...", "description": "...",
  "budgets": { "maxTasks": 200, "maxDurationHours": 72 },
  "start": {
    "content": <JSON Schema object: what the starter fills in>,
    "next": [
      { "channel": "<channel id leaving start>", "type": "<task type id>",
        "content": { ...templates over {{content.<path}}...} }
    ]
  },
  "end": { "content": <JSON Schema object: the final report> },
  "positions": [
    { "id": "dev", "label": "研发", "note": "<optional note for whoever maintains this flow>",
      "executor": { "kind": "worker", "id": "<worker identifier>" } | { "kind": "human" },
      "taskTypes": [
        { "id": "dev.implement", "label": "开发",
          "definition": "<what this kind of task is and what to do; preset facts live here>",
          "content": <JSON Schema object: the task content the creator must supply>,
          "creates": [   // robot positions only: tasks created when this task finishes
            { "channel": "<channel id from this position>", "type": "<task type id>",
              "content": { "field": "{{content.until}}" } }
          ],
          "assistant": "<assistant worker identifier>" | null, "plan": true,
          "agentPreset": "<agent preset id>",   // agent positions only
          "concurrency": 2,                     // agent / robot positions only, default 1
          "worktree": "none" | "guard" | "create",   // agent positions only
          "actions": [   // human positions only
            { "id": "pass", "label": "通过",
              "input": <JSON Schema object: the form the human fills, optional>,
              "creates": [ { "channel": "<channel id from this position>", "type": "<task type id>",
                             "content": { "field": "{{input.reason}}" } } ] }
          ] }
      ] }
  ],
  "channels": [
    { "id": "start.dev", "label": "受理", "from": "start", "to": "dev" },
    { "id": "dev.qa", "label": "提测", "from": "dev", "to": "qa", "types": ["qa.verify"] },
    { "id": "qa.dev.rework", "label": "返工", "from": "qa", "to": "dev", "types": ["dev.fix"], "back": true },
    { "id": "deploy.end", "label": "交付", "from": "deploy", "to": "end" }
  ]
}
The start and end nodes are two built-in task types, one declared per workflow: "start" accepts only "content" (the job input schema) and "next" (its creation declarations, at least one), "end" accepts only "content" (the final report schema). Their id, label and definition are fixed; "actions", "assistant", "plan", "agentPreset", "concurrency" and "worktree" are invalid there. Unknown fields are rejected everywhere in the definition. The start task is handled by the built-in "engine" worker; the end task is handled by the starter (or the delivery assistant chosen when the job starts). Rules: schemas use the restricted subset (type/description/properties/required/additionalProperties/items/enum/const/oneOf; top-level type must be "object"). A position whose executor is a robot (for example clock) must declare a content schema for every task type that covers the program's input contract: clock reads an object with required "until" (ISO 8601 timestamp), and saving the definition rejects task types that do not declare it. Robot task types may also declare "creates": when the robot finishes a task, the engine creates those tasks along the channels, and each created task depends on the finished task; their content templates may only use {{content.<path>}} (the robot's task content). A task type's "definition" is preset information the executor must know (for example the CI pipeline of each service); the per-task "content" is what the creator supplies. An agent task type may set "worktree" to one of three values: "none" injects no worktree prompt (omitting it means none), "guard" only tells the executor to check that the workspace and every repository it will modify is clean and to stop and ask the user when there are uncommitted changes, and "create" tells the executor to create and enter new Git worktrees itself with create_worktree (one per repository it modifies, so a task may touch several repositories). "create" only takes effect when the user has enabled the worktree plugin; when it is not enabled it degrades to "guard". An agent task type may set "plan": true to start the session in DSH plan mode, and "agentPreset" to the id of the agent preset its session starts with (the task type overrides the worker default, which overrides the plugin option; plan mode and the preset are independent). An agent or robot task type may set "concurrency" to a positive integer: the maximum number of tasks of that type running at once inside one job (default 1, waiting tasks start FIFO). Concurrency is per task type, not per position, and human tasks do not use the engine quota. Prompt-like text must NOT mention positions, channels, workflows or graph structure — the executor only knows its own task, the tools and its content. A channel is a named dispatch route: "id" is a lowercase unique identifier, "label" is the human-readable name shown in the graph (the engine never reads it), "from"/"to" are node ids (a position, or the built-in "start"/"end"). Craft tasks by channel + type in declared creations; the runtime tools use task-type targets. Channels into "end" cannot whitelist types and need no "type". Every position must be reachable from start and able to reach end. A cycle needs at least one explicitly marked back channel; channels between the same ordered pair must agree on "back". Templates may only reference {{content.<path>}} (the content of the task being completed) and {{input.<path>}} (the action form). A placeholder path ending in "?" renders an empty string when the value is missing, for optional form fields; a path without "?" is strict and fails when missing. The referenced path must exist in the schema either way. Human task types carry "actions"; a submission may also create nothing. The end task is acknowledged by the starter, so its content is the final report.`

/**
 * 注册全部工作流工具。
 *
 * @param deps 上下文、引擎 getter 与可见性条件
 */
export function registerWorkflowTools(deps: WorkflowToolDeps): void {
  const { ctx, ready, orchestratorVisible, executionVisible, starterVisible, assertOrchestrator } =
    deps

  /** 注册一个工具。 */
  const register = (
    tool: ToolDefinition,
    when?: (context: ToolActivationContext) => boolean | Promise<boolean>,
  ): void => {
    ctx.tools.register(tool, when === undefined ? undefined : { when })
  }

  register(
    defineTool({
      name: 'buka_workflow_save',
      description: `Validate and save a workflow definition as a new version. New workflows are enabled immediately. Only the orchestration preset can see this tool. Pass the complete v8 definition; executors and assistants reference workers by their immutable identifier; without "id" a new workflow is created.\n\n${DEFINITION_HELP}`,
      parameters: {
        definition: {
          type: 'json',
          required: true,
          description: 'The complete workflow v8 definition object.',
        },
        id: { type: 'string', description: 'Existing workflow id; omit to create a new workflow.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workflowId: { type: 'string', required: true },
            version: { type: 'number', required: true },
            name: { type: 'string', required: true },
            status: { type: 'string', required: true },
            warnings: { type: 'json', required: true },
          },
        },
        render: (_args, value) => {
          const warnings = Array.isArray(value.warnings)
            ? (value.warnings as Array<{ path?: unknown; message?: unknown }>)
            : []
          const lines = [
            `已保存工作流「${String(value.name)}」（${String(value.workflowId)}，版本 ${String(value.version)}，状态 ${String(value.status)}）。`,
          ]
          if (warnings.length > 0) {
            lines.push('提示（不拦截保存）：')
            for (const warning of warnings) {
              lines.push(`- ${String(warning.path ?? '')}: ${String(warning.message ?? '')}`)
            }
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args, exec) {
        assertOrchestrator(exec.agent)
        const engine = await ready()
        const workflow = await engine.saveWorkflow({
          definition: args.definition,
          ...(typeof args.id === 'string' && args.id.trim() !== ''
            ? { workflowId: args.id.trim() }
            : {}),
        })
        return {
          workflowId: workflow.id,
          version: workflow.latestVersion,
          name: workflow.name,
          status: workflow.status,
          warnings: workflow.warnings.map((warning) => ({
            path: warning.path,
            message: warning.message,
          })),
        }
      },
    }),
    orchestratorVisible,
  )

  register(
    defineTool({
      name: 'buka_workflow_list',
      description:
        'List saved workflows (id, name, version, status, job count). Use buka_workflow_get to read a full definition.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workflows: { type: 'json', required: true },
          },
        },
        render: (_args, value) =>
          text(
            Array.isArray(value.workflows) && value.workflows.length > 0
              ? (value.workflows as unknown[])
                  .map((workflow) => {
                    const record = workflow as Record<string, unknown>
                    return `- ${String(record.id)}「${String(record.name)}」v${String(record.version)} ${String(record.status)}（${String(record.jobCount)} 个作业）`
                  })
                  .join('\n')
              : '还没有保存过工作流。',
          ),
      },
      async execute(_args, exec) {
        assertOrchestrator(exec.agent)
        const engine = await ready()
        return { workflows: toolJson(await engine.listWorkflowSummaries()) }
      },
    }),
    orchestratorVisible,
  )

  register(
    defineTool({
      name: 'buka_workflow_get',
      description: 'Read one saved workflow definition (optionally a specific version).',
      parameters: {
        id: { type: 'string', required: true, description: 'Workflow id.' },
        version: { type: 'number', description: 'Version number; defaults to the latest.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workflow: { type: 'json', required: true },
            jobs: { type: 'json', required: true },
          },
        },
        render: (_args, value) => {
          const record = value.workflow as Record<string, unknown>
          const definition = record.definition
          return text(
            `工作流 ${String(record.id)}「${String(record.name)}」v${String(record.version)}（${String(record.status)}）\n\n${JSON.stringify(definition, null, 2)}`,
          )
        },
      },
      async execute(args, exec) {
        assertOrchestrator(exec.agent)
        const engine = await ready()
        const detail = await engine.readWorkflowDetail(
          args.id,
          typeof args.version === 'number' ? args.version : undefined,
        )
        if (detail === null) throw new Error(`workflow not found: ${args.id}`)
        return { workflow: toolJson(detail.workflow), jobs: toolJson(detail.jobs) }
      },
    }),
    orchestratorVisible,
  )

  register(
    defineTool({
      name: 'buka_job_start',
      description:
        'Start a workflow job from this session. The starter is this session: supply the workflow input as `content` (it must match the workflow start.content schema). If the input or initialization fails, a failed job and a failed start task are kept as a trace and the error names the job; such a job cannot be restarted. The job runs on the board; the final report is delivered back into this conversation and you confirm it with buka_task_complete. Use /job instead when the host supports commands.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'Workflow id to start.' },
        content: {
          type: 'json',
          description: 'Workflow input matching the start.content schema; omit for no input.',
        },
        delivery: {
          type: 'json',
          description:
            'How the end task comes back: {"kind":"starter"} (default) or {"kind":"assistant","id":"<assistant worker identifier>"}.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jobId: { type: 'string', required: true },
            seq: { type: 'number', required: true },
            workflowName: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => text(String(value.message)),
      },
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec)
        if (sessionId === '') throw new Error('buka_job_start must be called from a session')
        const engine = await ready()
        const job = await engine.createJobFromSession({
          workflowId: args.workflowId,
          content: (args.content ?? {}) as JsonValue,
          sessionId,
          delivery: args.delivery as DeliveryRule | undefined,
        })
        return {
          jobId: job.id,
          seq: job.seq,
          workflowName: job.workflowName,
          message: `已创建作业 #${job.seq}「${job.workflowName}」，任务已进入看板调度。作业结束后最终报告会回到本会话，调用 buka_task_complete 确认收到。`,
        }
      },
    }),
  )

  register(defineJobStatusTool(ready), starterVisible)
  register(defineJobCancelTool(ready), starterVisible)
  register(defineTaskTargetsTool(ready), executionVisible)
  register(defineTaskActionsTool(ready), executionVisible)
  register(defineTaskCreateTool(ready), executionVisible)
  register(defineTaskCompleteTool(ready), executionVisible)
  register(defineBoardTool(ready), executionVisible)
  register(defineTaskGetTool(ready), executionVisible)
  register(defineAttachmentsTool(ready), executionVisible)
}

/** 作业状态工具。 */
function defineJobStatusTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_job_status',
    description:
      'Read one workflow job (status, task counts) or, without jobId, the job started by this session.',
    parameters: {
      jobId: { type: 'string', description: 'Job id; defaults to this session’s job.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job: { type: 'json', required: true },
          tasks: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const job = value.job as Record<string, unknown>
        const tasks = Array.isArray(value.tasks) ? value.tasks : []
        const counts = new Map<string, number>()
        for (const task of tasks) {
          const status = String((task as Record<string, unknown>).status)
          counts.set(status, (counts.get(status) ?? 0) + 1)
        }
        return text(
          `作业 #${String(job.seq)}「${String(job.workflowName)}」状态 ${String(job.status)}\n任务：${[...counts].map(([status, count]) => `${status}=${count}`).join(' ') || '（无）'}`,
        )
      },
    },
    async execute(args, exec) {
      const engine = await ready()
      const sessionId = sessionIdOf(exec)
      const jobId =
        typeof args.jobId === 'string' && args.jobId.trim() !== ''
          ? args.jobId.trim()
          : engine.jobIdForSession(sessionId)
      if (jobId === null) throw new Error('this session has not started a workflow job')
      const detail = await engine.jobDetail(jobId)
      if (detail === null) throw new Error(`job not found: ${jobId}`)
      return { job: toolJson(detail.job), tasks: toolJson(detail.tasks) }
    },
  })
}

/** 取消作业工具。 */
function defineJobCancelTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_job_cancel',
    description: 'Cancel a running workflow job started by this session (or the given job id).',
    parameters: {
      jobId: { type: 'string', description: 'Job id; defaults to this session’s job.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) =>
        text(`作业 ${String(value.jobId)} 已取消（状态 ${String(value.status)}）。`),
    },
    async execute(args, exec) {
      const engine = await ready()
      const sessionId = sessionIdOf(exec)
      const jobId =
        typeof args.jobId === 'string' && args.jobId.trim() !== ''
          ? args.jobId.trim()
          : engine.jobIdForSession(sessionId)
      if (jobId === null) throw new Error('this session has not started a workflow job')
      if (!engine.canViewJob(sessionId, jobId))
        throw new Error('this session cannot cancel that job')
      const job = await engine.cancelJob(jobId)
      return { jobId: job.id, status: job.status }
    },
  })
}

/** 可创建目标工具。 */
function defineTaskTargetsTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_targets',
    description:
      'List the tasks this task can create next in the current job. Each target carries the content schema it expects. Call this before buka_task_create.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { targets: { type: 'json', required: true } },
      },
      render: (_args, value) => text(JSON.stringify(value.targets, null, 2)),
    },
    async execute(_args, exec) {
      const sessionId = sessionIdOf(exec)
      if (sessionId === '') throw new Error('buka_task_targets must be called from a task session')
      const engine = await ready()
      return { targets: toolJson(engine.creatableTargetsForSession(sessionId)) }
    },
  })
}

/** 人任务动作工具。 */
function defineTaskActionsTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_actions',
    description:
      'List the actions the human task this session is handling can take: each action carries a label and, when it needs input, a form schema. Pick one, fill the form, then call buka_task_complete with `action` (and `input`).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { actions: { type: 'json', required: true } },
      },
      render: (_args, value) => text(JSON.stringify(value.actions, null, 2)),
    },
    async execute(_args, exec) {
      const sessionId = sessionIdOf(exec)
      if (sessionId === '') throw new Error('buka_task_actions must be called from a task session')
      const engine = await ready()
      return { actions: toolJson(engine.taskActionsForSession(sessionId)) }
    },
  })
}

/** 派生任务工具。 */
function defineTaskCreateTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_create',
    description:
      'Create a task in the current job (callable any number of times while executing a task). Call buka_task_targets first to see the available targets and their content schema. Dependencies default to the current task when omitted. The engine validates the content, dependencies (must exist in this job, no cycles) and the workflow budget.',
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Target id from buka_task_targets ("end" for the final delivery task).',
      },
      content: {
        type: 'json',
        required: true,
        description: 'Task content matching the target content schema.',
      },
      deps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task ids in this job that must complete first; omit to depend on this task.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) =>
        text(`已创建任务 ${String(value.taskId)}（状态 ${String(value.status)}）。`),
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      if (sessionId === '') throw new Error('buka_task_create must be called from a task session')
      const target = typeof args.target === 'string' ? args.target.trim() : ''
      if (target === '') {
        throw new Error('buka_task_create requires a target from buka_task_targets')
      }
      const engine = await ready()
      const task = await engine.createTaskFromTarget({
        sessionId,
        target,
        content: (args.content ?? {}) as JsonValue,
        deps: Array.isArray(args.deps) ? args.deps : [],
      })
      return { taskId: task.id, status: task.status }
    },
  })
}

/** 提交结果工具。 */
function defineTaskCompleteTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_complete',
    description:
      'Submit the result of the task this session is executing: a summary `text` plus optional attachments. There is no structured result schema. Assistants of a human task also pass `action` (from buka_task_actions) and the action `input`.',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: 'Human-readable summary of the result.',
      },
      action: {
        type: 'string',
        description: 'Human tasks only: the action id from buka_task_actions.',
      },
      input: {
        type: 'json',
        description: 'Human tasks only: the form values for the chosen action.',
      },
      attachments: {
        type: 'array',
        items: { type: 'json' },
        description:
          'Optional files to archive: strings or { path, name?, description? }. Paths are relative to your workspace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          jobStatus: { type: 'string', required: true },
        },
      },
      render: (_args, value) =>
        text(
          `已提交任务 ${String(value.taskId)}（${String(value.status)}）；作业状态 ${String(value.jobStatus)}。`,
        ),
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      if (sessionId === '') throw new Error('buka_task_complete must be called from a task session')
      const engine = await ready()
      const result = await engine.completeTaskFromSession({
        sessionId,
        text: typeof args.text === 'string' ? args.text : '',
        action: typeof args.action === 'string' ? args.action : undefined,
        input: args.input as JsonValue | undefined,
        attachments: args.attachments,
      })
      return { taskId: result.task.id, status: result.task.status, jobStatus: result.job.status }
    },
  })
}

/** 看板工具。 */
function defineBoardTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_job_board',
    description:
      'Read the tasks of the job this session is executing: id, type, status, dependencies, result text and attachments. Useful to gather task ids when creating follow-up tasks.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job: { type: 'json', required: true },
          tasks: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const job = value.job as Record<string, unknown>
        const tasks = Array.isArray(value.tasks) ? value.tasks : []
        const lines = [`作业 #${String(job.seq)} 状态 ${String(job.status)}`]
        for (const task of tasks) {
          const record = task as Record<string, unknown>
          lines.push(
            `- ${String(record.id)} ${String(record.type)} [${String(record.status)}] deps=${Array.isArray(record.deps) ? record.deps.join(',') : ''}`,
          )
        }
        return text(lines.join('\n'))
      },
    },
    async execute(_args, exec) {
      const sessionId = sessionIdOf(exec)
      const engine = await ready()
      const reference = engine.taskForSession(sessionId)
      if (reference === null) throw new Error('this session is not executing a workflow task')
      const detail = await engine.jobDetail(reference.jobId)
      if (detail === null) throw new Error('job not found')
      const job = detail.job as Record<string, unknown>
      const tasks = Array.isArray(detail.tasks) ? (detail.tasks as Record<string, unknown>[]) : []
      return {
        job: toolJson({ seq: job.seq, status: job.status }),
        tasks: toolJson(tasks.map((task) => taskForModel(task))),
      }
    },
  })
}

/** 任务读取工具。 */
function defineTaskGetTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_get',
    description:
      'Read one task of the job this session is executing: content, dependencies, result and attachments.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task id on the current job board.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { task: { type: 'json', required: true } },
      },
      render: (_args, value) => text(JSON.stringify(value.task, null, 2)),
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      const engine = await ready()
      const reference = engine.taskForSession(sessionId)
      if (reference === null) throw new Error('this session is not executing a workflow task')
      const detail = engine.taskDetail(reference.jobId, args.taskId)
      if (detail === null) throw new Error(`task not found: ${args.taskId}`)
      return { task: toolJson(taskForModel(detail, true)) }
    },
  })
}

/** 附件工具。 */
function defineAttachmentsTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_job_attachments',
    description:
      'Search or read the attachments this task is allowed to see (its own output plus the tasks it depends on, directly or transitively). Pass no arguments to list visible attachments; pass attachmentId to read one (metadata plus bounded inline text).',
    parameters: {
      query: { type: 'string', description: 'Optional keyword to filter by name / description.' },
      attachmentId: { type: 'string', description: 'Attachment id to read.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachments: { type: 'json', required: true },
        },
      },
      render: (_args, value) => text(JSON.stringify(value.attachments, null, 2)),
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      const engine = await ready()
      if (typeof args.attachmentId === 'string' && args.attachmentId.trim() !== '') {
        const attachment = await engine.readAttachmentForSession(
          sessionId,
          args.attachmentId.trim(),
        )
        if (attachment === null) {
          throw new Error(`attachment not found or not visible to this task: ${args.attachmentId}`)
        }
        return { attachments: toolJson([attachment]) }
      }
      const query = typeof args.query === 'string' ? args.query : ''
      return { attachments: toolJson(engine.searchAttachmentsForSession(sessionId, query)) }
    },
  })
}
