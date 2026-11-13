/**
 * 「打工人」页面用到的数据结构。
 *
 * 全部按 Host 路由的返回形状声明；页面只按字段读取，缺字段时回退默认值。
 *
 * @module @buka/dsh-plugin-workers/client/types
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

/** 打工人 AGENTS.md 摘要。 */
export interface WorkerAgents {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}

/** 打工人目录里 CLAUDE.md 链接摘要。 */
export interface WorkerClaude {
  exists: boolean
  symlink: boolean
  mode: string
  target: string
}

/** 打工人驱动类型：智能体跑 DSH 会话，机器人由插件内建。 */
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

/** 列表接口里的一行打工人。 */
export interface Worker {
  name: string
  /** 智能体有目录并跑会话；机器人（clock）只读、没有目录与会话。 */
  driver: WorkerDriver
  /** 机器人的程序 id（稳定契约）；智能体为空串。 */
  program: string
  /** 只有智能体可以是助理（人任务的承办者）。 */
  assistant: boolean
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

/** 一条 Toast。 */
export interface Notice {
  kind: 'success' | 'error'
  text: string
  seq: number
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

/** Skills 插件的收藏仓库；`unavailable` 表示该插件没安装。 */
export interface FavouritesState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  repos: Array<{ id: string; source: string; note: string }>
}

/** 写操作失败时留在对话框里的提示。 */
export interface DialogFailure {
  message: string
  output: string
}

/** Host 各路由的统一响应：每个接口只返回其中一部分字段，页面按需读取。 */
export interface HostResponse {
  worker?: Partial<Worker> | undefined
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
