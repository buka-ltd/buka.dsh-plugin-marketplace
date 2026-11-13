/**
 * 浏览器一半的共享类型与常量。
 *
 * 这里的形状全部是**客户端本地定义**：按 `.tmp/workflow-v4-api.md` 的 HTTP
 * 契约声明，不 import 宿主一半的任何模块，避免把 node 依赖带进浏览器包。
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

/** 岗位执行者：打工人或人。 */
export interface Executor {
  kind?: string
  name?: string
  /** 打工人头像 id（Host 若给出就画）。 */
  avatar?: string
  /** 打工人驱动：agent / robot（只读展示用）。 */
  driver?: string
}

/** 受限 JSON Schema 子集（与 `src/output.ts` 的规则一致，这里只做展示与表单）。 */
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

/** 任务类型定义（工作流定义快照里的一份）。 */
export interface TaskTypeDefinition {
  id?: string
  label?: string
  description?: string
  payload?: JsonSchema
  output?: JsonSchema
  requires?: Array<{ types?: string[] }>
  assistant?: string | null
  mode?: string | null
}

/** 岗位定义（工作流定义快照里的一份）。 */
export interface PositionDefinition {
  id?: string
  label?: string
  description?: string
  executor?: Executor
  taskTypes?: TaskTypeDefinition[]
}

/** 边定义。`from` / `to` 是岗位 id 或内建的 `start` / `end`。 */
export interface EdgeDefinition {
  from?: string
  to?: string
  types?: string[]
  back?: boolean
}

/** 开始节点契约。 */
export interface StartDefinition {
  task?: {
    payload?: JsonSchema
    output?: JsonSchema
  }
  next?: Array<{
    position?: string
    type?: string
    payload?: Record<string, unknown>
    dependsOn?: string[]
  }>
}

/** 结束节点契约。 */
export interface EndDefinition {
  task?: {
    payload?: JsonSchema
  }
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
  edges?: EdgeDefinition[]
}

/** 工作流列表里的一条。 */
export interface WorkflowSummary {
  id: string
  name?: string
  description?: string
  version?: number
  status?: string
  jobCount?: number
  updatedAt?: string | null
}

/** 作业列表里的一条。 */
export interface JobSummary {
  id: string
  seq?: number
  status?: string
  inputSummary?: string
  taskCounts?: Partial<Record<TaskStatus, number>>
  createdAt?: string
  updatedAt?: string
}

/** 承办者（人 / 助理打工人 / 执行打工人）。 */
export interface Claimant {
  kind?: string
  name?: string
  sessionId?: string | null
}

/** 启动者：人，或某个会话。 */
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
  output?: unknown
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
  typeDescription?: string
  status?: string
  payload?: Record<string, unknown>
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
  }
  graph?: {
    positions?: Array<{ id?: string; label?: string; executor?: Executor }>
    edges?: EdgeDefinition[]
    start?: { label?: string }
    end?: { label?: string }
  }
  jobs?: JobSummary[]
}

/** 作业详情里的图（服务端只给结构，坐标由客户端算）。 */
export interface JobDefinition {
  name?: string
  positions?: Array<{ id?: string; label?: string; executor?: Executor }>
  edges?: EdgeDefinition[]
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
    input?: Record<string, unknown>
    createdAt?: string
    updatedAt?: string
    error?: unknown
  }
  definition?: JobDefinition
  tasks?: TaskSummary[]
  canRetryDelivery?: boolean
}

/** 作业详情页的视图页签。 */
export type JobView = 'overview' | 'flow' | 'board' | 'outputs'

/** 工作流页签。 */
export type WorkflowTab = 'jobs' | 'definition'

/** 作业列表筛选。 */
export type JobFilter = 'all' | 'running' | 'completed' | 'problem'

/** 定义结构画布上的选中项：节点、边或全局信息。 */
export type DefinitionSelection =
  | { kind: 'position'; id: string }
  | { kind: 'edge'; index: number }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'info' }
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

/** 人任务表单的草稿。 */
export interface TaskFormState {
  values: Record<string, string>
  text: string
  error: string | null
  submitting: boolean
}

/** 新建作业表单的草稿。 */
export interface NewJobState {
  open: boolean
  raw: Record<string, string>
  structured: Record<string, string>
  error: string | null
  submitting: boolean
}

/** 附件预览抽屉的状态。`data` 是 Host preview 响应的 `attachment` 对象。 */
export interface AttachmentViewState {
  id: string
  name: string
  status: 'loading' | 'ready' | 'failed'
  data: JobAttachmentPreview | null
  error: string | null
}

/** 附件预览（沿用旧附件路由的 `kind` 语义）。 */
export interface JobAttachmentPreview {
  name?: string
  bytes?: number
  kind?: 'text' | 'image' | 'pdf' | 'binary'
  mime?: string
  text?: string
  truncated?: boolean
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
  /** 定义结构画布的选中项。 */
  definitionSelection: DefinitionSelection
  /** 实时流程里打开的节点任务列表。 */
  nodeTasks: NodeTasksSelection | null
  /** 作业附件库；进入产出视图时读取。 */
  attachments: Loadable<AttachmentMeta[]>
  taskId: string | null
  task: Loadable<TaskDetail>
  taskForm: TaskFormState
  newJob: NewJobState
  attachment: AttachmentViewState | null
  busy: string | null
  notice: Notice | null
  tick: number
}

/** 页面 props（由 `index.ts` 的 `main` 插槽注入）。 */
export interface WorkflowsPageProps {
  t: Translate
  getService?: ((name: string) => unknown) | null
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
