/**
 * 「机器人」页面用到的数据结构。
 *
 * 全部按 Host 路由的返回形状声明；页面只按字段读取，缺字段时回退默认值。
 *
 * @module @buka/dsh-plugin-robots/client/types
 */

/** 翻译函数：词典命名空间里取文案。 */
export type Translate = (key: string) => string

/** 一个预设头像：`id` 与 Host 的 `lib/avatar.ts` 一一对应。 */
export type { AvatarPreset } from '@buka/plugin-ui'

/** 项目级 skill 一行（Host `/buka-robots/list` 返回）。 */
export interface RobotSkill {
  name: string
  description: string
  source: string | null
}

/** 机器人 AGENTS.md 摘要。 */
export interface RobotAgents {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}

/** 机器人目录里 CLAUDE.md 链接摘要。 */
export interface RobotClaude {
  exists: boolean
  symlink: boolean
  mode: string
  target: string
}

/** 机器人驱动类型：agent 型跑 DSH 会话，program 型由插件内建。 */
export type RobotDriver = 'agent' | 'program'

/** 列表接口里的一行机器人。 */
export interface Robot {
  name: string
  /** agent 型有目录并跑会话；program 型（clock）只读、没有目录与会话。 */
  driver: RobotDriver
  /** program 型机器人的程序 id（稳定契约）；agent 型为空串。 */
  program: string
  /** 只有 agent 型机器人可以是助理（人任务的承办者）。 */
  assistant: boolean
  path: string
  createdAt: string
  avatar: string
  description: string
  exists: boolean
  mounted: boolean
  workspaceId: string | null
  skills: RobotSkill[]
  agents: RobotAgents
  claude: RobotClaude
}

/** `/buka-robots/list` 的成功响应。 */
export interface ListData {
  root: string
  registry: string
  corrupt: boolean
  robots: Robot[]
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
  robot?: Partial<Robot> | undefined
  created?: boolean | undefined
  mounted?: boolean | undefined
  workspaceId?: string | null | undefined
  renamed?: boolean | undefined
  previousName?: string | null | undefined
  agents?: Partial<RobotAgents> | undefined
  bytes?: number | undefined
  modifiedAt?: string | null | undefined
  path?: string | undefined
  skills?: RobotSkill[] | undefined
  claude?: Partial<RobotClaude> | undefined
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
