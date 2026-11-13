/**
 * 打工人存储层的数据结构。
 *
 * 登记表是 version 3：每个打工人都有 `driver`（agent / robot）与 `assistant`
 * 标记。智能体有目录、AGENTS.md 与项目 skills；机器人是固定程序，
 * 没有目录，只登记 `program` id（稳定契约，v1 只有 `clock`）。
 *
 * @module @buka/dsh-plugin-workers/store/types
 */

/** 打工人驱动类型：智能体跑 DSH 会话，机器人是固定程序。 */
export type WorkerDriver = 'agent' | 'robot'

/** 智能体的模型选择；`reasoningEffort` 省略表示用适配器默认值。 */
export interface WorkerModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 工作区注册表的最小形状：只声明列表判断挂载用到的 `list`。 */
export interface WorkspaceRegistryLike {
  list(): Array<{ id?: unknown; path?: unknown }>
}

/** 一条打工人记录；写回登记表后这些字段总是齐全。 */
export interface WorkerRecord {
  name: string
  driver: WorkerDriver
  /** 智能体的目录；机器人没有目录，固定空串。 */
  path: string
  /** 机器人的程序 id；智能体固定空串。 */
  program: string
  createdAt: string
  avatar: string
  description: string
  /** 只有智能体可以是助理（人任务的承办者）。 */
  assistant: boolean
  /** 智能体新会话使用的模型；没有配置时跟随宿主默认模型。机器人没有。 */
  model?: WorkerModelSelection | undefined
}

/** 写登记表时接受的记录：`driver` 缺省按 agent，其它字段由写回逻辑补齐。 */
export interface WorkerRecordInput {
  name: string
  driver?: WorkerDriver | undefined
  path?: string | undefined
  program?: string | undefined
  createdAt: string
  avatar?: string | undefined
  description?: string | undefined
  assistant?: boolean | undefined
  model?: WorkerModelSelection | null | undefined
}

/** AGENTS.md 的摘要；文件不存在或读不了时字段取空值，保证响应结构稳定。 */
export interface AgentsFileInfo {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}

/** 打工人目录里 CLAUDE.md 的状态；`mode` 的取值见 `readClaudeLink`。 */
export interface ClaudeLinkInfo {
  exists: boolean
  symlink: boolean
  mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing'
  target: string
}

/** 列表里的一行打工人：登记表信息 + 磁盘 / 挂载状态。 */
export interface WorkerListEntry extends WorkerRecord {
  exists: boolean
  mounted: boolean
  workspaceId: string | null
  skills: Array<{ name: string; description: string; source: string | null }>
  agents: AgentsFileInfo
  claude: ClaudeLinkInfo
}
