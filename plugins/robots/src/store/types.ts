/**
 * 机器人存储层的数据结构。
 *
 * 登记表是 version 2：每个机器人都有 `driver`（agent / program）与 `assistant`
 * 标记。agent 型机器人有目录、AGENTS.md 与项目 skills；program 型是固定程序，
 * 没有目录，只登记 `program` id（稳定契约，v1 只有 `clock`）。
 *
 * @module @buka/dsh-plugin-robots/store/types
 */

/** 机器人驱动类型：agent 型跑 DSH 会话，program 型是固定程序。 */
export type RobotDriver = 'agent' | 'program'

/** 工作区注册表的最小形状：只声明列表判断挂载用到的 `list`。 */
export interface WorkspaceRegistryLike {
  list(): Array<{ id?: unknown; path?: unknown }>
}

/** 一条机器人记录；写回登记表后这些字段总是齐全。 */
export interface RobotRecord {
  name: string
  driver: RobotDriver
  /** agent 型机器人的目录；program 型没有目录，固定空串。 */
  path: string
  /** program 型机器人的程序 id；agent 型固定空串。 */
  program: string
  createdAt: string
  avatar: string
  description: string
  /** 只有 agent 型机器人可以是助理（人任务的承办者）。 */
  assistant: boolean
}

/** 写登记表时接受的记录：`driver` 缺省按 agent，其它字段由写回逻辑补齐。 */
export interface RobotRecordInput {
  name: string
  driver?: RobotDriver | undefined
  path?: string | undefined
  program?: string | undefined
  createdAt: string
  avatar?: string | undefined
  description?: string | undefined
  assistant?: boolean | undefined
}

/** AGENTS.md 的摘要；文件不存在或读不了时字段取空值，保证响应结构稳定。 */
export interface AgentsFileInfo {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}

/** 机器人目录里 CLAUDE.md 的状态；`mode` 的取值见 `readClaudeLink`。 */
export interface ClaudeLinkInfo {
  exists: boolean
  symlink: boolean
  mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing'
  target: string
}

/** 列表里的一行机器人：登记表信息 + 磁盘 / 挂载状态。 */
export interface RobotListEntry extends RobotRecord {
  exists: boolean
  mounted: boolean
  workspaceId: string | null
  skills: Array<{ name: string; description: string; source: string | null }>
  agents: AgentsFileInfo
  claude: ClaudeLinkInfo
}
