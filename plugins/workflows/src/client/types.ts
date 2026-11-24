/**
 * 浏览器一半的共享类型与常量。
 *
 * 这里的形状全部是**客户端本地定义**：按 ADR 0015 / 0017 的 v6 契约声明，不 import
 * 宿主一半的任何模块，避免把 node 依赖带进浏览器包。
 *
 * 契约字段一律按「可能缺失」处理（响应来自新版 / 旧版 Host 都可能），页面
 * 只做防御式读取，不做完整校验。
 */

/** 词典翻译函数。 */
export type Translate = (key: string) => string

/** Host 路由返回的 JSON 对象。 */
export type JsonRecord = Record<string, unknown>

/** 侧边栏条目的词典命名空间，也是 `main` 插槽的 locale。 */
export const NS = 'buka-workflows'

/** 侧边栏条目 id；与 `main` 插槽的 key 必须相同。 */
export const PANEL_ID = 'buka-workflows'

/** 工作流列表。 */
export const WORKFLOWS_ROUTE = '/buka-workflows/workflows'

/** 工作流详情（定义快照 + 图 + 作业列表）。 */
export const WORKFLOW_ROUTE = '/buka-workflows/workflow'

/** 激活 / 停用工作流。 */
export const WORKFLOW_ACTIVATE_ROUTE = '/buka-workflows/workflow/activate'

/** 某个工作流下的作业列表。 */
export const JOBS_ROUTE = '/buka-workflows/jobs'

/** 作业详情（含任务摘要）。 */
export const JOB_ROUTE = '/buka-workflows/job'

/** 页面人启动作业。 */
export const JOB_START_ROUTE = '/buka-workflows/job/start'

/** 作业动作：cancel / retry-delivery。 */
export const JOB_ACTION_ROUTE = '/buka-workflows/job/action'

/** 重启失败作业：failed（从失败位置）/ scratch（从头开始）。 */
export const JOB_RESTART_ROUTE = '/buka-workflows/job/restart'

/** 任务详情（payload / 依赖 / 执行记录 / 结果 / 操作）。 */
export const TASK_ROUTE = '/buka-workflows/task'

/** 任务动作：cancel / retry / claim / complete。 */
export const TASK_ACTION_ROUTE = '/buka-workflows/task/action'

/** 作业附件库。 */
export const ATTACHMENTS_ROUTE = '/buka-workflows/attachments'

/** 单个附件的下载 / 预览 / 内联地址。 */
export const ATTACHMENT_ROUTE = '/buka-workflows/attachment'

/** 有运行中作业时的刷新间隔（沿用旧页面风格）。 */
export const LIVE_REFRESH_MS = 1500

/** 没有运行中作业时的刷新间隔。 */
export const REFRESH_MS = 5000

/** 当前工作流定义格式；与宿主 `DEFINITION_VERSION` 保持一致。 */
export const DEFINITION_VERSION = 9

/** 一个会话在 DSH 客户端里的即时状态；只取本插件判定「是否在等人」要用的字段。 */
export interface SessionStatusSummary {
  /** 会话是否还有回合在跑；未知时缺省。 */
  running?: boolean
  /** 正在等用户处理的交互（审批 / plan 审阅 / 提问）；有值即表示会话在等人。 */
  pendingInteraction?: unknown
}

/** 按会话 id 索引的会话状态快照，由 `main` 插槽的 `useSessionStatus` 提供。 */
export type SessionStatusSnapshot = ReadonlyMap<string, SessionStatusSummary>

/** DSH `main` 插槽注入的会话状态选择器钩子。 */
export type UseSessionStatus = <Selected>(
  selector: (snapshot: SessionStatusSnapshot) => Selected,
) => Selected

/** 没有注入会话状态钩子时复用的空快照。 */
export const EMPTY_SESSION_STATUS: SessionStatusSnapshot = new Map()

/** 工作流状态。 */
export type WorkflowStatus = 'draft' | 'active' | 'retired'

/** 作业状态。 */
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

/** 岗位主体：执行者或工作人员；v8 用 `id` 引用，`name` 是展示名或 v7 快照的旧引用。 */
export interface Executor {
  kind?: string
  /** 执行者标识符。 */
  id?: string
  /** 展示名；旧快照里也可能是当时的标识符。 */
  name?: string
  /** 执行者头像 id（Host 若给出就画）。 */
  avatar?: string
  /** 执行者驱动：agent / robot（只读展示用）。 */
  driver?: string
  /** 登记表里查不到这个标识符：显示占位头像与「已删除」。 */
  missing?: boolean
}

/** 一条缺失的执行者引用。 */
export interface MissingWorkerRef {
  id: string
  role?: 'executor' | 'assistant' | 'delivery'
  positionId?: string
  positionLabel?: string
  taskTypeId?: string
  taskTypeLabel?: string
}

/** 工作流 / 作业的派生可用性：引用断了时不可用，重新绑定后自动恢复。 */
export interface WorkerAvailability {
  available?: boolean
  missingWorkers?: MissingWorkerRef[]
}

/** 受限 JSON Schema 子集（与 `src/json-schema.ts` 的规则一致，这里只做展示与表单）。 */
export interface JsonSchema {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  oneOf?: JsonSchema[]
}

/** 一条「创建任务」的声明（人任务的动作与机器人的完成后创建共用）。 */
export interface CreationDefinition {
  channel?: string
  type?: string
  content?: unknown
}

/** 人任务类型上的一个动作。 */
export interface ActionDefinition {
  id?: string
  label?: string
  input?: JsonSchema
  creates?: CreationDefinition[]
}

/** 任务类型定义（工作流定义快照里的一份）。 */
export interface TaskTypeDefinition {
  id?: string
  label?: string
  /** 预设信息：这个任务类型是谁、要做什么。 */
  definition?: string
  /** 任务内容的格式约束。 */
  content?: JsonSchema
  actions?: ActionDefinition[]
  /** 仅机器人岗位：任务完成后创建的后续任务。 */
  creates?: CreationDefinition[]
  /** 仅人岗位：点名的助理执行者标识符。 */
  assistant?: string | null
  /** 仅智能体岗位：以计划模式起步。 */
  plan?: boolean
  /** 仅智能体岗位：执行会话使用的执行者预设 id。 */
  agentPreset?: string
  /** 同一作业内这类任务最多同时进行几条；省略等同 1。 */
  concurrency?: number
  /** 仅智能体岗位：`none` 不注入、`guard` 保护检查、`create` 让执行者建 worktree。 */
  worktree?: 'none' | 'guard' | 'create'
}

/** 岗位定义（工作流定义快照里的一份）。 */
export interface PositionDefinition {
  id?: string
  label?: string
  /** 给编排者看的维护备注。 */
  note?: string
  executor?: Executor
  taskTypes?: TaskTypeDefinition[]
}

/** 通道定义。`from` / `to` 是岗位 id 或内建的 `start` / `end`。 */
export interface ChannelDefinition {
  id?: string
  label?: string
  from?: string
  to?: string
  types?: string[]
  back?: boolean
}

/** 开始节点契约。 */
export interface StartDefinition {
  content?: JsonSchema
  next?: CreationDefinition[]
}

/** 结束节点契约。 */
export interface EndDefinition {
  content?: JsonSchema
}

/** 工作流定义快照。 */
export interface WorkflowDefinition {
  version?: number
  name?: string
  description?: string
  budgets?: { maxTasks?: number; maxDurationHours?: number }
  start?: StartDefinition
  end?: EndDefinition
  positions?: PositionDefinition[]
  channels?: ChannelDefinition[]
}

/** 工作流列表里的一条。 */
export interface WorkflowSummary {
  id: string
  name?: string
  description?: string
  version?: number
  definitionVersion?: number
  status?: string
  jobCount?: number
  updatedAt?: string | null
  availability?: WorkerAvailability
}

/** 作业列表里的一条。 */
export interface JobSummary {
  id: string
  seq?: number
  status?: string
  inputSummary?: string
  definitionVersion?: number
  delivery?: DeliveryRule
  taskCounts?: Partial<Record<TaskStatus, number>>
  createdAt?: string
  updatedAt?: string
  availability?: WorkerAvailability
}

/** 承办者（人 / 助理执行者 / 执行执行者）。 */
export interface Claimant {
  kind?: string
  name?: string
  sessionId?: string | null
}

/** 发起人：人，或某个会话。 */
export interface Starter {
  kind?: string
  sessionId?: string | null
}

/** 任务摘要（看板 / 列表用的轻记录）。 */
export interface TaskSummary {
  id: string
  position?: string
  type?: string
  typeLabel?: string
  channel?: string | null
  status?: string
  deps?: string[]
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
  claimant?: Claimant | null
  attemptCount?: number
  attachmentCount?: number
  resultSummary?: string | null
}

/** 一次执行记录。 */
export interface Attempt {
  id: string
  sessionId?: string | null
  status?: string
  stopReason?: string | null
  startedAt?: string
  finishedAt?: string | null
  error?: unknown
}

/** 附件元数据。 */
export interface AttachmentMeta {
  id: string
  name: string
  bytes?: number
  mime?: string
  sha256?: string
  description?: string
  sourceTaskId?: string
  sourcePositionId?: string
  createdBy?: string
  createdAt?: string
}

/** 任务结果。 */
export interface TaskResult {
  text?: string
  /** 人任务点过的动作。 */
  action?: { id?: string; label?: string }
  /** 人任务填的表单。 */
  input?: unknown
  attachments?: AttachmentMeta[]
}

/** 任务详情。 */
export interface TaskDetail {
  id: string
  jobId?: string
  position?: string
  positionLabel?: string
  type?: string
  typeLabel?: string
  channel?: string | null
  channelLabel?: string
  status?: string
  content?: unknown
  deps?: TaskSummary[]
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
  claimant?: Claimant | null
  attempts?: Attempt[]
  result?: TaskResult | null
  allowedActions?: string[]
}

/** 工作流详情响应。 */
export interface WorkflowDetail {
  workflow?: {
    id?: string
    name?: string
    description?: string
    version?: number
    status?: string
    definition?: WorkflowDefinition
    availability?: WorkerAvailability
  }
  graph?: {
    positions?: Array<{ id?: string; label?: string; executor?: Executor }>
    channels?: ChannelDefinition[]
    start?: { label?: string }
    end?: { label?: string }
  }
  /** 新建作业「交给助理代收」的候选：全部智能体（排除机器人）。 */
  assistants?: Array<{ id?: string; name?: string; description?: string; avatar?: string }>
  jobs?: JobSummary[]
}

/** 作业详情里的图（服务端只给结构，坐标由客户端算）。 */
export interface JobDefinition {
  name?: string
  positions?: Array<{ id?: string; label?: string; executor?: Executor }>
  channels?: ChannelDefinition[]
  start?: { label?: string }
  end?: { label?: string }
}

/** 作业详情响应。 */
export interface JobDetail {
  job?: {
    id?: string
    seq?: number
    status?: string
    workflowId?: string
    workflowName?: string
    workflowVersion?: number
    starter?: Starter | null
    input?: unknown
    delivery?: DeliveryRule
    createdAt?: string
    updatedAt?: string
    error?: unknown
    /** 人重启过几次；旧 Host 不返回时按 0。 */
    restartCount?: number
    /** 从头开始的新作业指向来源作业。 */
    restartedFrom?: string | null
  }
  definition?: JobDefinition
  tasks?: TaskSummary[]
  canRetryDelivery?: boolean
  /** 重启入口：可用性与不可用原因由服务端判定，客户端只按它渲染。 */
  restart?: JobRestartOptions
  /** 派生可用性：缺主体 / 助理时作业页标注「不可用」。 */
  availability?: WorkerAvailability
}

/** 一个重启选项。 */
export interface JobRestartOption {
  available?: boolean
  /** 不可用原因代码（`job-not-failed`、`no-failed-tasks`、`workflow-retired` 等）。 */
  reason?: string
}

/** 失败作业的两个重启选项。 */
export interface JobRestartOptions {
  failed?: JobRestartOption
  scratch?: JobRestartOption
}

/** 重启方式：从失败位置 / 从头开始。 */
export type JobRestartMode = 'failed' | 'scratch'

/** 作业详情页的视图页签。 */
export type JobView = 'overview' | 'flow' | 'board' | 'outputs'

/** 工作流页签。 */
export type WorkflowTab = 'jobs' | 'definition' | 'types'

/** 作业列表筛选。 */
export type JobFilter = 'all' | 'running' | 'completed' | 'problem'

/** 结构图画布上的选中项：节点或边。 */
export type DefinitionSelection =
  | { kind: 'position'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'start' }
  | { kind: 'end' }
  | null

/** 实时流程里打开的节点任务列表。 */
export interface NodeTasksSelection {
  positionId: string
  label: string
}

/** 页面路由：工作流列表 → 工作流（作业 / 定义）→ 作业（四个视图）。 */
export type Route =
  | { kind: 'workflows' }
  | { kind: 'workflow'; workflowId: string; tab: WorkflowTab }
  | { kind: 'job'; workflowId: string; jobId: string; view: JobView }

/** 一次异步读取的状态。 */
export interface Loadable<T> {
  status: 'idle' | 'loading' | 'ready'
  data: T | null
  error: string | null
}

/** Toast 文案。 */
export interface Notice {
  kind: 'success' | 'error'
  text: string
  seq: number
}

/** 交回方式：交回发起人，或交给某个助理；v8 用 `id`，旧快照用 `name`。 */
export type DeliveryRule = { kind?: string; id?: string; name?: string; missing?: boolean }

/** 人任务表单的草稿。 */
export interface TaskFormState {
  /** 选中的动作 id；null 表示只提交结果、不创建任务。 */
  action: string | null
  values: Record<string, string>
  text: string
  error: string | null
  submitting: boolean
}

/** 新建作业表单的草稿。 */
export interface NewJobState {
  open: boolean
  /** 发起人填的任务内容（按 start.content schema 渲染）。 */
  content: Record<string, string>
  /** `starter` 或 `assistant:<id>`。 */
  delivery: string
  error: string | null
  submitting: boolean
}

/** 重启失败作业对话框的草稿。 */
export interface JobRestartState {
  open: boolean
  submitting: false | JobRestartMode
  error: string | null
}

/** 附件预览抽屉的状态。`data` 是 Host preview 响应的 `attachment` 对象。 */
export interface AttachmentViewState {
  id: string
  name: string
  status: 'loading' | 'ready' | 'failed'
  data: JobAttachmentPreview | null
  error: string | null
}

/** 同作业附件库里可被 Markdown 相对图片按名匹配的图片附件引用。 */
export interface AttachmentImageRef {
  id: string
  name: string
}

/** 附件预览（沿用旧附件路由的 `kind` 语义）。 */
export interface JobAttachmentPreview {
  name?: string
  bytes?: number
  kind?: 'text' | 'image' | 'pdf' | 'binary' | 'markdown'
  mime?: string
  text?: string
  truncated?: boolean
  /** markdown 附件的同作业图片附件清单，正文里的相对图片按文件名匹配它。 */
  images?: AttachmentImageRef[]
}

/** 页面全部状态。 */
export interface PageState {
  route: Route
  workflows: Loadable<WorkflowSummary[]>
  workflow: Loadable<WorkflowDetail>
  job: Loadable<JobDetail>
  /** 结束任务的详情：概览里的最终交付物。 */
  finalTask: Loadable<TaskDetail>
  /** 作业列表筛选。 */
  jobFilter: JobFilter
  /** 结构图画布的选中项。 */
  definitionSelection: DefinitionSelection
  /** 任务类型页选中的条目；null 表示落在列表第一项。 */
  taskTypeSelection: string | null
  /** 实时流程里打开的节点任务列表。 */
  nodeTasks: NodeTasksSelection | null
  /** 作业附件库；进入产出视图时读取。 */
  attachments: Loadable<AttachmentMeta[]>
  taskId: string | null
  task: Loadable<TaskDetail>
  taskForm: TaskFormState
  newJob: NewJobState
  restart: JobRestartState
  attachment: AttachmentViewState | null
  busy: string | null
  notice: Notice | null
  tick: number
}

/** 页面 props（由 `index.ts` 的 `main` 插槽注入）。 */
export interface WorkflowsPageProps {
  t: Translate
  getService?: ((name: string) => unknown) | null
  /** 首页装配好的顶部页签；列表视图才渲染，详情页用独立页头。 */
  topTabs?: React.ReactElement
  /** `main` 插槽注入的会话状态钩子；旧组合没有时退化为空快照。 */
  useSessionStatus?: UseSessionStatus | undefined
}

/** 判断普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 安全数组。 */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** 安全字符串。 */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
