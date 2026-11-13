/**
 * 模型工具注册（`.tmp/workflow-v4-spec.md` §13.2）。
 *
 * 可见性：
 * - 工作流定义工具只对配置点名的编排 preset 根会话可见；
 * - 启动 / 状态 / 取消工具对普通会话可见（启动者 = 当前会话）；
 * - 执行工具（建任务 / 提交结果 / 看板 / 任务 / 附件）只对引擎创建的任务会话、
 *   助理会话与启动者会话可见，并在 `execute` 里按会话再校验一次。
 *
 * @module @buka/dsh-plugin-workflows/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolActivationContext, ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { JsonValue } from '../domain/types.ts'
import type { WorkflowEngine } from '../engine/engine.ts'
import type { ResolvedOptions } from '../options.ts'

/** 工具注册依赖。 */
export interface WorkflowToolDeps {
  readonly ctx: Context
  readonly ready: () => Promise<WorkflowEngine>
  readonly options: ResolvedOptions
  /** 编排 preset 根会话的可见性条件。 */
  readonly orchestratorVisible: (context: ToolActivationContext) => boolean
  /** 执行会话（任务 / 助理 / 启动者）的可见性条件。 */
  readonly executionVisible: (context: ToolActivationContext) => boolean | Promise<boolean>
  /** 启动者 / 执行会话的可见性条件（状态 / 取消）。 */
  readonly starterVisible: (context: ToolActivationContext) => boolean | Promise<boolean>
  /** 调用时再校验一次编排 preset（防止绕过可见性直接调用）。 */
  readonly assertOrchestrator: (agent: { id?: unknown } | null | undefined) => void
}

/** 工具输出 schema 里 `type: "json"` 对应的值类型；运行时就是 JSON。 */
type ToolJson = NonNullable<ToolResult['meta']>

/** 把已知 JSON 兼容的运行时对象标成工具输出的 json 类型。 */
function toolJson(value: unknown): ToolJson {
  return value as ToolJson
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
const DEFINITION_HELP = `Workflow definition (v4) JSON shape:
{
  "version": 4, "name": "...", "description": "...",
  "budgets": { "maxTasks": 200, "maxDurationHours": 72 },
  "start": {
    "task": {
      "payload": <JSON Schema object: the raw input form>,
      "output":  <JSON Schema object: the first structured input>
    },
    "next": [
      { "position": "<position id>", "type": "<task type id>",
        "payload": { ...templates... }, "dependsOn": ["$start"] }
    ]
  },
  "end": { "task": { "payload": <JSON Schema object: the final deliverable> } },
  "positions": [
    { "id": "dev", "label": "研发", "description": "...",
      "executor": { "kind": "worker", "name": "<registered worker>" } | { "kind": "human" },
      "taskTypes": [
        { "id": "dev.implement", "label": "开发", "description": "...",
          "payload": <JSON Schema object>, "output": <JSON Schema object>,
          "requires": [{ "types": ["qa.prepare"] }], "assistant": "<assistant worker>" | null,
          "mode": "plan" | null }
      ] }
  ],
  "edges": [
    { "from": "start", "to": "dev" },
    { "from": "qa", "to": "dev", "types": ["dev.rework"], "back": true },
    { "from": "deploy", "to": "end" }
  ]
}
Rules: schemas use the restricted subset (type/description/properties/required/additionalProperties/items/enum/const/oneOf; top-level type must be "object"). Every position must be reachable from start and able to reach end. A cycle needs at least one explicitly marked back edge; a back edge must close a cycle. start.next entries must depend on "$start" and target a direct successor of start. Task payload templates may reference {{start.output.<path>}}, {{task.<id>.output.<path>}} and {{task.<id>.text}}. Edges carry no prompt: instructions live in task payloads and task type contracts.`

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
      description: `Validate and save a workflow definition as a new version. New workflows are enabled immediately. Only the orchestration preset can see this tool. Pass the complete v4 definition; without "id" a new workflow is created.\n\n${DEFINITION_HELP}`,
      parameters: {
        definition: {
          type: 'json',
          required: true,
          description: 'The complete workflow v4 definition object.',
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
          },
        },
        render: (_args, value) =>
          text(
            `已保存工作流「${String(value.name)}」（${String(value.workflowId)}，版本 ${String(value.version)}，状态 ${String(value.status)}）。`,
          ),
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
        return { workflows: toolJson(engine.listWorkflowSummaries()) }
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
        'Start a workflow job from this session. The starter is this session: the start task comes back as a new message in this conversation, asking you to convert the raw request into the first structured input and submit it with buka_task_complete. Use /job instead when the host supports commands.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'Workflow id to start.' },
        request: { type: 'string', required: true, description: 'The raw request / input text.' },
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
          rawInput: { request: args.request },
          sessionId,
        })
        return {
          jobId: job.id,
          seq: job.seq,
          workflowName: job.workflowName,
          message: `已创建作业 #${job.seq}「${job.workflowName}」。启动任务会作为一条新消息发到本会话；按它给的结构化输入契约调用 buka_task_complete 提交后，作业进入看板调度。`,
        }
      },
    }),
  )

  register(defineJobStatusTool(ready), starterVisible)
  register(defineJobCancelTool(ready), starterVisible)
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

/** 派生任务工具。 */
function defineTaskCreateTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_create',
    description:
      'Create a task on the current job board (callable any number of times while executing a task). The engine validates the target position, task type, edge whitelist, payload schema, dependencies (must exist in this job, no cycles) and the workflow budget.',
    parameters: {
      position: {
        type: 'string',
        required: true,
        description: 'Target position id (or "end" for the end task).',
      },
      type: {
        type: 'string',
        required: true,
        description: 'Task type id declared by the target position ("end" for the end task).',
      },
      payload: {
        type: 'json',
        required: true,
        description:
          'Task payload matching the task type payload schema; templates are rendered when the task starts.',
      },
      deps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task ids in this job that must complete first.',
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
      const engine = await ready()
      const task = await engine.createTaskFromSession({
        sessionId,
        position: args.position,
        type: args.type,
        payload: (args.payload ?? {}) as JsonValue,
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
      'Submit the structured result of the task this session is executing. The engine validates `output` against the task type output schema (invalid output is returned as an error so you can correct it in the same turn), copies any attachments into the job attachment library, and advances the workflow.',
    parameters: {
      output: {
        type: 'json',
        required: true,
        description: 'Structured result matching the task type output schema.',
      },
      text: { type: 'string', description: 'Optional human-readable summary.' },
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
        output: (args.output ?? {}) as JsonValue,
        text: typeof args.text === 'string' ? args.text : '',
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
      'Read the read-only board of the job this session is executing: every task with status, dependencies, claimant and result summary. Useful to gather task ids when creating tasks across branches.',
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
        const lines = [
          `作业 #${String(job.seq)}「${String(job.workflowName)}」状态 ${String(job.status)}`,
        ]
        for (const task of tasks) {
          const record = task as Record<string, unknown>
          lines.push(
            `- ${String(record.id)} ${String(record.position)}/${String(record.typeLabel)} [${String(record.status)}] deps=${Array.isArray(record.deps) ? record.deps.join(',') : ''}`,
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
      return { job: toolJson(detail.job), tasks: toolJson(detail.tasks) }
    },
  })
}

/** 任务读取工具。 */
function defineTaskGetTool(ready: () => Promise<WorkflowEngine>) {
  return defineTool({
    name: 'buka_task_get',
    description:
      'Read one task of the job this session is executing: payload, dependencies, attempts, result and attachments.',
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
      return { task: toolJson(detail) }
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
