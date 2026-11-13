/**
 * 工作流 v4 的领域类型：定义、作业、任务、执行记录、附件，以及主体与角色。
 *
 * 本模块是纯类型与常量，不 import 任何运行时依赖（除 `output.ts` 的类型），
 * 便于被校验、存储、引擎、路由与单测共同引用。
 *
 * 术语以根 `GLOSSARY.md` 为准：工作流 / 作业 / 任务 / 岗位 / 任务类型 / 边 /
 * 启动者 / 执行者 / 承办者 / 执行记录 / 看板。
 *
 * @module @buka/dsh-plugin-workflows/domain/types
 */

import type { OutputSchema } from '../output.ts'

/** 时间戳统一用 ISO 字符串，保证 storageDomain 里的记录是可 JSON 化的纯数据。 */
export type IsoTime = string

/** 可 JSON 化的值；payload / output / 结果都只允许这一类。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** 工作流状态：草稿 / 已激活 / 已停用。 */
export type WorkflowStatus = 'draft' | 'active' | 'retired'

/** 作业状态；没有「等待人工」。 */
export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** 任务状态；业务上的「不通过」不是状态，写在结果里。 */
export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'

/** 打工人驱动方式。 */
export type WorkerDriver = 'agent' | 'robot'

/** workers 登记表里本插件用到的一条打工人信息（由 workers 服务提供）。 */
export interface WorkerInfo {
  readonly name: string
  readonly driver: WorkerDriver
  /** 机器人的驱动 id（例如 `clock`）；智能体没有。 */
  readonly program?: string | undefined
  readonly assistant: boolean
  readonly description?: string | undefined
  readonly avatar?: string | undefined
  /** 智能体的工作目录（附件相对路径的根）。 */
  readonly path?: string | undefined
}

/** workers 服务里本插件用到的部分。 */
export interface WorkerCatalog {
  readonly workers: readonly WorkerInfo[]
}

/** 岗位执行者：人，或登记表里的打工人。 */
export type ExecutorSpec =
  | { readonly kind: 'worker'; readonly name: string }
  | { readonly kind: 'human' }

/** 任务创建时钉住的执行者：打工人额外记录 driver，避免之后登记表变化影响已创建的作业。 */
export type StoredExecutor =
  | {
      readonly kind: 'worker'
      readonly name: string
      readonly driver: WorkerDriver
      readonly program?: string | undefined
      readonly avatar?: string | undefined
    }
  | { readonly kind: 'human' }
  /** 开始 / 结束任务的执行者是会话启动者。 */
  | { readonly kind: 'session'; readonly sessionId: string }

/** 承办者：实际接走任务的一方。 */
export type ClaimantKind = 'human' | 'worker' | 'assistant'

/** 承办者记录。 */
export interface Claimant {
  readonly kind: ClaimantKind
  readonly name: string
  readonly sessionId: string | null
}

/** 启动者：人（页面启动）或会话（`/job` 启动）。 */
export type Starter =
  | { readonly kind: 'human' }
  | { readonly kind: 'session'; readonly sessionId: string }

/** 一个任务类型。 */
export interface TaskTypeDefinition {
  readonly id: string
  readonly label: string
  readonly description?: string | undefined
  /** 创建者必须填的内容；受限 JSON Schema 子集。 */
  readonly payload: OutputSchema
  /** 执行者必须交回的结构化结果；受限 JSON Schema 子集。 */
  readonly output: OutputSchema
  /** 创建时校验：依赖集合里必须至少有一个指定类型的任务。 */
  readonly requires?: readonly { readonly types: readonly string[] }[] | undefined
  /** 仅人岗位：承担沟通的助理打工人名；null / 省略表示无助理。 */
  readonly assistant?: string | null | undefined
  /** `plan`：进入执行前对目标 agent 执行 `/plan`。 */
  readonly mode?: 'plan' | null | undefined
}

/** 一个岗位：执行者 + 任务类型契约。 */
export interface PositionDefinition {
  readonly id: string
  readonly label: string
  readonly description?: string | undefined
  readonly executor: ExecutorSpec
  readonly taskTypes: readonly TaskTypeDefinition[]
}

/** 一条边：`from` 的执行者可以把任务派给 `to`。 */
export interface EdgeDefinition {
  readonly from: string
  readonly to: string
  /** 目标岗位的任务类型白名单；省略表示目标岗位声明的所有类型。 */
  readonly types?: readonly string[] | undefined
  /** 显式回边；环上的边必须标记。 */
  readonly back?: boolean | undefined
}

/** `start.next` 里的一条初始任务模板。 */
export interface StartRouteDefinition {
  readonly position: string
  readonly type: string
  /** 模板对象：字符串里的 `{{start.output.<path>}}` 在执行开始时渲染。 */
  readonly payload: Readonly<Record<string, JsonValue>>
  /** 必须显式包含 `"$start"`。 */
  readonly dependsOn?: readonly string[] | undefined
}

/** 内建开始节点的任务契约与初始任务模板。 */
export interface StartDefinition {
  readonly task: {
    readonly payload: OutputSchema
    readonly output: OutputSchema
  }
  readonly next: readonly StartRouteDefinition[]
}

/** 内建结束节点的任务契约（没有 output，投递即完成）。 */
export interface EndDefinition {
  readonly task: {
    readonly payload: OutputSchema
  }
}

/** 预算；回边必须有预算兜底。 */
export interface BudgetDefinition {
  readonly maxTasks: number
  readonly maxDurationHours: number
}

/** 工作流 v4 定义。 */
export interface WorkflowDefinition {
  readonly version: 4
  readonly name: string
  readonly description?: string | undefined
  readonly budgets: BudgetDefinition
  readonly start: StartDefinition
  readonly end: EndDefinition
  readonly positions: readonly PositionDefinition[]
  readonly edges: readonly EdgeDefinition[]
}

/** 工作流定义的一个版本快照。 */
export interface WorkflowVersionRecord {
  readonly version: number
  readonly definition: WorkflowDefinition
  readonly createdAt: IsoTime
}

/** workflows 表里的一条记录。 */
export interface WorkflowRecord {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly status: WorkflowStatus
  readonly latestVersion: number
  readonly versions: Record<string, WorkflowVersionRecord>
  /** 作业编号计数器；在所属工作流内持久递增，删除归档不回退。 */
  readonly jobSeq: number
  readonly createdAt: IsoTime
  readonly updatedAt: IsoTime
}

/** 任务执行记录（一次尝试）。 */
export interface AttemptRecord {
  readonly id: string
  readonly jobId: string
  readonly taskId: string
  readonly sessionId: string | null
  readonly startSeq: number | null
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly stopReason: string | null
  readonly error: string | null
  /** 渲染后的完整 prompt 落在作业目录时的相对路径；人任务为 null。 */
  readonly promptFile: string | null
  readonly startedAt: IsoTime
  readonly finishedAt: IsoTime | null
}

/** 任务结果：结构化产出 + 文本摘要 + 附件 id 清单。 */
export interface TaskResult {
  readonly output: JsonValue | null
  /** 文本摘要（有上限）；全文在 `textFile`。 */
  readonly text: string
  readonly textBytes: number
  /** 全文相对作业目录的路径；没有文本时为 null。 */
  readonly textFile: string | null
  readonly attachmentIds: readonly string[]
}

/** 任务记录。 */
export interface TaskRecord {
  /** 启动任务固定 `start-task`；其余任务 `task-<time>-<uuid8>`。 */
  readonly id: string
  readonly jobId: string
  /** 目标岗位 id；`start` / `end` 是内建节点。 */
  readonly position: string
  /** 任务类型 id；启动 / 结束任务分别是节点契约，值仍为 `start` / `end`。 */
  readonly type: string
  readonly payload: JsonValue
  readonly deps: readonly string[]
  readonly status: TaskStatus
  readonly createdBy: { readonly taskId: string; readonly position: string } | null
  readonly assignee: StoredExecutor
  readonly claimant: Claimant | null
  readonly attemptIds: readonly string[]
  readonly result: TaskResult | null
  /** 技术失败原因（status=failed 时）；业务不通过写进 result.output。 */
  readonly error: string | null
  /**
   * 人任务：被点名的助理承办失败后置 true。
   *
   * 引擎据此不再自动重新派给同一个助理（v1 不自动换助理、不自动重试），
   * 任务停在「待认领」由人兜底完成。
   */
  readonly assistantBlocked: boolean
  readonly createdAt: IsoTime
  readonly startedAt: IsoTime | null
  readonly finishedAt: IsoTime | null
  readonly updatedAt: IsoTime
}

/** 作业的输入：启动任务的原始输入 + 结构化输入。 */
export interface JobInput {
  readonly raw: JsonValue
  readonly structured?: JsonValue | undefined
}

/** 作业记录；钉住创建时的工作流版本快照。 */
export interface JobRecord {
  readonly id: string
  /** 在所属工作流内递增的作业编号。 */
  readonly seq: number
  readonly workflowId: string
  readonly workflowVersion: number
  readonly workflowName: string
  readonly workflowDescription: string
  /** 创建时钉住的完整定义快照。 */
  readonly definition: WorkflowDefinition
  readonly status: JobStatus
  readonly starter: Starter
  readonly input: JobInput
  /** 列表用的一句话输入摘要。 */
  readonly inputSummary: string
  readonly error: string | null
  readonly createdAt: IsoTime
  readonly updatedAt: IsoTime
  readonly finishedAt: IsoTime | null
}

/** 附件元数据；文件本体在作业目录里。 */
export interface AttachmentRecord {
  readonly id: string
  readonly jobId: string
  readonly name: string
  readonly bytes: number
  readonly mime: string
  readonly sha256: string
  readonly description: string
  /** 来源任务：每条附件都必须有来源任务。 */
  readonly sourceTaskId: string
  readonly sourcePositionId: string
  /** 任务 / 人 / 助理的展示名。 */
  readonly createdBy: string
  readonly createdAt: IsoTime
  /** 相对作业附件目录的路径（单个安全的文件名）。 */
  readonly path: string
  readonly tags?: readonly string[] | undefined
}

/** 定义校验错误：带定位路径。 */
export interface DefinitionIssue {
  readonly path: string
  readonly message: string
}
