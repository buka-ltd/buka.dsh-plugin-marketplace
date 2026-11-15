/**
 * 工作流 v7 的领域类型：定义、作业、任务、执行记录、附件，以及主体与角色。
 *
 * 本模块是纯类型与常量，不 import 任何运行时依赖（除 `json-schema.ts` 的类型），
 * 便于被校验、存储、引擎、路由与单测共同引用。
 *
 * 术语以根 `GLOSSARY.md` 为准：工作流 / 作业 / 任务 / 岗位 / 任务类型 / 动作 /
 * 通道 / 发起人 / 执行者 / 承办者 / 执行记录 / 看板。
 *
 * @module @buka/dsh-plugin-workflows/domain/types
 */

import type { JsonSchema } from '../json-schema.ts'

/** 时间戳统一用 ISO 字符串，保证 storageDomain 里的记录是可 JSON 化的纯数据。 */
export type IsoTime = string

/** 可 JSON 化的值；任务内容 / 动作表单 / 结果文本都只允许这一类。 */
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

/** 任务状态。 */
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
  /** 开始 / 结束任务的执行者是会话发起人。 */
  | { readonly kind: 'session'; readonly sessionId: string }

/** 承办者：实际接走任务的一方。 */
export type ClaimantKind = 'human' | 'worker' | 'assistant'

/** 承办者记录。 */
export interface Claimant {
  readonly kind: ClaimantKind
  readonly name: string
  readonly sessionId: string | null
}

/** 发起人：人（页面启动）或会话（`/job` 启动）。 */
export type Starter =
  | { readonly kind: 'human' }
  | { readonly kind: 'session'; readonly sessionId: string }

/**
 * 结束任务的交回方式，由发起人在创建作业时决定。
 *
 * - `starter`：交回发起人本人——会话发起时投递进那个会话，人发起时落在看板上；
 * - `assistant`：交给一个助理打工人代收。
 */
export type DeliveryRule =
  | { readonly kind: 'starter' }
  | { readonly kind: 'assistant'; readonly name: string }

/**
 * 一条「创建任务」的声明：沿哪条通道、创建哪个任务类型、任务内容怎么来。
 *
 * 人工动作与开始节点的初始任务共用这个形状。`content` 里可以写模板：
 * `{{content.<path>}}` 取正在完成的这张任务的任务内容，`{{input.<path>}}`
 * 取动作表单。`type` 指向结束节点时可以省略。
 */
export interface CreationDefinition {
  /** 从声明所在节点出发的通道 id。 */
  readonly channel: string
  /** 目标任务类型 id；通道指向结束节点时省略。 */
  readonly type?: string | undefined
  /** 目标任务内容（模板）。 */
  readonly content?: JsonValue | undefined
}

/**
 * 人任务类型上的一个动作：人点它，等于沿它声明的通道创建下面的任务。
 *
 * `input` 是给操作人填的表单；省略表示点击即派发，不需要填任何东西。
 */
export interface ActionDefinition {
  /** 任务类型内唯一。 */
  readonly id: string
  /** 按钮文案，唯一进入界面的文本。 */
  readonly label: string
  /** 表单 schema；省略表示这个动作没有参数。 */
  readonly input?: JsonSchema | undefined
  /** 这个动作创建哪些任务；可以为空数组（只留结果，不推进流程）。 */
  readonly creates: readonly CreationDefinition[]
}

/** 一个任务类型。 */
export interface TaskTypeDefinition {
  readonly id: string
  readonly label: string
  /**
   * 这个任务类型是谁、要做什么、有什么预设信息；只给执行者看。
   *
   * 编排者预先写死的事实放这里（例如外部系统的地址），创建者不用、也不该重复提供。
   */
  readonly definition?: string | undefined
  /** 任务内容的格式约束；创建者按它填写，引擎创建任务时校验。 */
  readonly content?: JsonSchema | undefined
  /** 仅人岗位：人可以点的动作。 */
  readonly actions?: readonly ActionDefinition[] | undefined
  /** 仅人岗位：承担沟通的助理打工人名；null / 省略表示无助理。 */
  readonly assistant?: string | null | undefined
  /** `plan`：进入执行前对目标 agent 执行 `/plan`。 */
  readonly mode?: 'plan' | null | undefined
}

/** 一个岗位：图上的节点，给人看清流程结构；执行者 + 任务类型。 */
export interface PositionDefinition {
  readonly id: string
  readonly label: string
  /** 给编排者看的备注，方便交接维护；不进执行者的提示词。 */
  readonly note?: string | undefined
  readonly executor: ExecutorSpec
  readonly taskTypes: readonly TaskTypeDefinition[]
}

/** 一条通道：`from` 的执行者可以沿它把任务派给 `to`；`label` 给人读，引擎不读。 */
export interface ChannelDefinition {
  /** 工作流内唯一的小写点分标识，任务记录用它标注自己走过的通道。 */
  readonly id: string
  /** 展示名（人 / agent 读）；引擎不参与判定。 */
  readonly label: string
  readonly from: string
  readonly to: string
  /** 目标岗位的任务类型白名单；省略表示目标岗位声明的所有类型。 */
  readonly types?: readonly string[] | undefined
  /** 显式回向通道；环上的通道必须标记，同一对有序节点的标记必须一致。 */
  readonly back?: boolean | undefined
}

/** 内建开始节点的任务契约与初始任务。 */
export interface StartDefinition {
  /** 发起人填的任务内容。 */
  readonly content?: JsonSchema | undefined
  /** 发起人提交后创建的初始任务。 */
  readonly next: readonly CreationDefinition[]
}

/** 内建结束节点的任务内容（最终报告）。 */
export interface EndDefinition {
  readonly content?: JsonSchema | undefined
}

/** 预算；回向通道必须有预算兜底。 */
export interface BudgetDefinition {
  readonly maxTasks: number
  readonly maxDurationHours: number
}

/** 工作流 v7 定义。 */
export interface WorkflowDefinition {
  readonly version: 7
  readonly name: string
  /** 列表里的摘要；不是给执行者看的。 */
  readonly description?: string | undefined
  readonly budgets: BudgetDefinition
  readonly start: StartDefinition
  readonly end: EndDefinition
  readonly positions: readonly PositionDefinition[]
  readonly channels: readonly ChannelDefinition[]
}

/** 定义格式的当前版本；其它版本一律视为「待升级」。 */
export const DEFINITION_VERSION = 7 as const

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

/** 人任务点过的动作。 */
export interface ActionRecord {
  readonly id: string
  readonly label: string
}

/** 任务结果：一段总结文本 + 附件；没有结构化契约。 */
export interface TaskResult {
  /** 文本摘要（有上限）；全文在 `textFile`。 */
  readonly text: string
  readonly textBytes: number
  /** 全文相对作业目录的路径；没有文本时为 null。 */
  readonly textFile: string | null
  readonly attachmentIds: readonly string[]
  /** 人任务：点的是哪个动作。 */
  readonly action?: ActionRecord | undefined
  /** 人任务：动作表单填了什么。 */
  readonly input?: JsonValue | undefined
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
  /** 任务沿哪条通道派发而来；启动任务没有入站通道，为 null。 */
  readonly channel: string | null
  /** 任务内容：创建者产出的、给执行者用的东西。 */
  readonly content: JsonValue
  readonly deps: readonly string[]
  readonly status: TaskStatus
  readonly createdBy: { readonly taskId: string; readonly position: string } | null
  readonly assignee: StoredExecutor
  readonly claimant: Claimant | null
  readonly attemptIds: readonly string[]
  readonly result: TaskResult | null
  /** 技术失败原因（status=failed 时）。 */
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
  /** 发起人填的任务内容（也就是启动任务的任务内容）。 */
  readonly input: JsonValue
  /** 结束任务怎么交回发起人；创建作业时定。 */
  readonly delivery: DeliveryRule
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
