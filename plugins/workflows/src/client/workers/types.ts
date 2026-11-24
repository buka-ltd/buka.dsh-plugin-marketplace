/**
 * 「执行者」页面用到的数据结构。
 *
 * 全部按 Host 路由的返回形状声明；页面只按字段读取，缺字段时回退默认值。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/types
 */

/** 翻译函数：词典命名空间里取文案。 */
export type Translate = (key: string) => string

/** 一个预设头像：`id` 与 Host 的 `lib/avatar.ts` 一一对应。 */
export type { AvatarPreset } from '@buka/plugin-ui'

/** 项目级 skill 一行（Host `/buka-workers/list` 返回）。 */
export interface WorkerSkill {
  name: string
  description: string
  source: string | null
}

/** 执行者 AGENTS.md 摘要。 */
export interface WorkerAgents {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}

/** 执行者目录里 CLAUDE.md 链接摘要。 */
export interface WorkerClaude {
  exists: boolean
  symlink: boolean
  mode: string
  target: string
}

/** 执行者驱动类型：智能体跑 DSH 会话，机器人由插件内建。 */
export type WorkerDriver = 'agent' | 'robot'

/** 智能体新会话使用的模型；`reasoningEffort` 省略表示用适配器默认值。 */
export interface WorkerModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 模型目录里的一个推理强度。 */
export interface WorkerModelEffort {
  id: string
  name: string
  description?: string
}

/** 模型目录里的一个模型。 */
export interface WorkerModelEntry {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: WorkerModelEffort[]
    defaultEffort?: string
  }
}

/** 按提供方分组的模型。 */
export interface WorkerModelGroup {
  id: string
  name: string
  models: WorkerModelEntry[]
}

/** `/buka-workers/models` 的成功响应。 */
export interface WorkerModelCatalogData {
  available: boolean
  default: WorkerModelSelection | null
  groups: WorkerModelGroup[]
  failures: Array<{ id: string; name: string; message: string }>
}

/** 模型目录请求的状态。 */
export interface WorkerModelCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: WorkerModelCatalogData | null
  error: string | null
}

/** `/buka-workers/presets` 返回的一个执行者预设。 */
export interface WorkerAgentPreset {
  id: string
  name: string
  description: string
  /** 激活失败的原因；非空时页面把这一项标灰。 */
  broken: string | null
}

/** `/buka-workers/presets` 的成功响应。 */
export interface WorkerAgentPresetCatalogData {
  /** `agentPresets` 服务是否可用；不可用时页面禁用选择器并提示。 */
  available: boolean
  presets: WorkerAgentPreset[]
}

/** 执行者预设目录请求的状态。 */
export interface WorkerAgentPresetCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: WorkerAgentPresetCatalogData | null
  error: string | null
}

/** 列表接口里的一行执行者。 */
export interface Worker {
  /** 不可变标识符：引用键与目录名。 */
  id: string
  /** 可选展示名；空串表示未设置，展示时回退到 `id`。 */
  name: string
  /** 智能体有目录并跑会话；机器人（clock）只读、没有目录与会话。 */
  driver: WorkerDriver
  /** 机器人的程序 id（稳定契约）；智能体为空串。 */
  program: string
  /** 内建执行者（clock / engine）：只读、带「内置」标记。 */
  builtin?: boolean
  path: string
  createdAt: string
  avatar: string
  description: string
  exists: boolean
  mounted: boolean
  workspaceId: string | null
  skills: WorkerSkill[]
  agents: WorkerAgents
  claude: WorkerClaude
  /** 新会话使用的模型；没有配置时省略（跟随宿主默认模型）。 */
  model?: WorkerModelSelection | null
  /** 新会话默认的执行者预设；没有配置时省略（跟随工作流插件的 `workerPreset`）。 */
  agentPreset?: string | null
}

/** `/buka-workers/list` 的成功响应。 */
export interface ListData {
  root: string
  registry: string
  corrupt: boolean
  workers: Worker[]
}

/** 列表请求的状态：数据、失败原因与加载中标记。 */
export interface ListState {
  data: ListData | null
  error: string | null
  loading: boolean
}

/** 「文件」页签的目录树节点；目录带 `children`。 */
export interface WorkerFileNode {
  name: string
  /** 相对执行者目录的路径，统一用 `/`。 */
  path: string
  kind: 'directory' | 'file'
  bytes?: number
  children?: WorkerFileNode[]
}

/** `/buka-workers/files` 的成功响应。 */
export interface WorkerFileTreeData {
  ok: true
  root: string
  nodes: WorkerFileNode[]
  truncated: boolean
}

/** `/buka-workers/file` 的成功响应：只读预览。 */
export interface WorkerFileContentData {
  ok: true
  path: string
  bytes: number
  content: string
  tooLarge: boolean
  binary: boolean
  maxBytes: number
}

/** 一条 Toast。 */
export interface Notice {
  kind: 'success' | 'error'
  text: string
  seq: number
}

/** 一条引用该执行者的运行中作业：删除的唯一阻塞，弹窗里列出来。 */
export interface WorkerUsageJob {
  jobId: string
  jobSeq: number
  workflowId: string
  workflowName: string
  jobName: string
}

/** 一条引用该执行者的工作流（含停用），删除后它会变成「不可用」。 */
export interface WorkerUsageWorkflow {
  workflowId: string
  name: string
  status: string
}

/** `/buka-workers/remove-impact` 的成功响应：删除影响面。 */
export interface WorkerRemoveImpact {
  id: string
  name: string
  path: string
  mounted: boolean
  workspaceId: string | null
  blockers: { runningJobs: WorkerUsageJob[] }
  workflows: WorkerUsageWorkflow[]
  finishedJobs: number
}

/**
 * 删除确认弹窗的状态。
 *
 * 打开时先读影响面；`impact.blockers.runningJobs` 非空时禁用确认按钮，提示
 * 先去作业页终止作业。删除失败（例如刚好又有作业开始）留在框里。
 */
export interface DeleteDialogState {
  target: Worker | null
  impact: WorkerRemoveImpact | null
  loading: boolean
  error: string | null
  saving: boolean
}

/** 「安装 skills」对话框里可勾选的候选。 */
export interface SkillCandidate {
  name: string
  description: string
}

/** 候选清单状态：`idle` / `loading` / `ready` / `error`。 */
export interface InstallCandidates {
  status: 'idle' | 'loading' | 'ready' | 'error'
  skills: SkillCandidate[]
  installed: string[]
  error: string | null
  output: string
}

/** Skills 插件「技能仓库」里的一条收藏来源。 */
export interface SkillRepository {
  id: string
  source: string
  note: string
  /** Host 探测出的类型：`npx-skills` / `unavailable` / `unknown`。 */
  kind: string
  /** 探测出的可安装 skill 数；判不出时为 null。 */
  skills: number | null
}

/**
 * 「技能仓库」列表状态：`unavailable` 表示 Skills 插件没安装（或版本太旧），
 * `corrupt` 表示收藏文件无法解析。
 */
export interface InstallReposState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  repos: SkillRepository[]
  corrupt: boolean
  error: string | null
}

/** 更新结果里失败的一项。 */
export interface SkillUpdateFailureItem {
  name?: unknown
  message?: unknown
  output?: unknown
}

/** Skills 插件检查 / 更新的结果快照（Host 原样透传）。 */
export interface SkillUpdateSummary {
  ok?: boolean
  code?: string
  message?: string
  updated?: unknown[]
  skipped?: unknown[]
  failed?: SkillUpdateFailureItem[]
}

/** 检查里的一行：技能名与状态（状态模型由 Skills 插件定义，页面只认字符串）。 */
export interface SkillCheckItem {
  readonly name: string
  readonly status: string
  readonly message?: string
}

/** 「技能」页签自动检查的页面状态；`results` 按 skill 名索引。 */
export interface SkillChecksState {
  /** 结果属于哪个执行者；切执行者后旧响应据此丢弃。 */
  readonly workerId: string | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly results: Record<string, SkillCheckItem>
  readonly error: string | null
}

/** 单个执行者检查响应里的一行（Host 原样透传的 Skills 插件结果）。 */
export interface WorkerSkillCheckItemSnapshot {
  name?: unknown
  status?: unknown
  message?: unknown
}

/** 单个执行者检查响应。 */
export interface WorkerSkillCheckSnapshot {
  ok?: boolean
  code?: string
  message?: string
  output?: string
  check?: {
    ok?: boolean
    scope?: unknown
    message?: unknown
    results?: WorkerSkillCheckItemSnapshot[]
  }
}

/** 单个执行者更新响应。 */
export interface WorkerSkillUpdateSnapshot {
  ok?: boolean
  update?: SkillUpdateSummary
  skills?: WorkerSkill[]
}

/** 批量更新里一个执行者的结果。 */
export interface WorkerSkillUpdateResult {
  id?: string
  name?: string
  ok?: boolean
  message?: string
  updated?: number
  failed?: number
  skipped?: number
}

/** 批量更新响应。 */
export interface WorkerSkillUpdateAllSnapshot {
  ok?: boolean
  results?: WorkerSkillUpdateResult[]
  updated?: number
  failed?: number
  skippedWorkers?: number
}

/** 写操作失败时留在对话框里的提示。 */
export interface DialogFailure {
  message: string
  output: string
}

/** Host 各路由的统一响应：每个接口只返回其中一部分字段，页面按需读取。 */
export interface HostResponse {
  worker?: Partial<Worker> | undefined
  id?: string | undefined
  created?: boolean | undefined
  mounted?: boolean | undefined
  workspaceId?: string | null | undefined
  renamed?: boolean | undefined
  previousName?: string | null | undefined
  agents?: Partial<WorkerAgents> | undefined
  bytes?: number | undefined
  modifiedAt?: string | null | undefined
  path?: string | undefined
  skills?: WorkerSkill[] | undefined
  claude?: Partial<WorkerClaude> | undefined
  output?: string | undefined
  installed?: string[] | undefined
  name?: string | undefined
  removed?: boolean | undefined
  repos?: Array<{ id?: string; source?: string; note?: string }> | undefined
  update?: SkillUpdateSummary | undefined
  results?: WorkerSkillUpdateResult[] | undefined
  skippedWorkers?: number | undefined
  jobs?: WorkerUsageJob[] | undefined
  blockers?: { runningJobs?: WorkerUsageJob[] } | undefined
  workflows?: WorkerUsageWorkflow[] | undefined
  finishedJobs?: number | undefined
}

/** 带错误码的错误；`npx-failed` 还带命令输出。 */
export interface HostError extends Error {
  code?: string | undefined
  output?: string | undefined
}

/** `workspaces` Client Service 里页面用到的两个方法。 */
export interface WorkspacesService {
  create(options: { path: string }): Promise<unknown>
  delete(id: string): Promise<unknown>
}

/** `uiWorkspace` Client Service：打开一个工作区。 */
export interface UiWorkspaceService {
  openWorkspace(workspaceId: string): unknown
}
