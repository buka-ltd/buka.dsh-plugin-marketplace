/**
 * 机器人存储层的数据结构。
 *
 * @module @buka/dsh-plugin-robots/store/types
 */

/** 工作区注册表的最小形状：只声明列表判断挂载用到的 `list`。 */
export interface WorkspaceRegistryLike {
  list(): Array<{ id?: unknown; path?: unknown }>
}

/** 一条机器人记录；写回登记表后这些字段总是齐全。 */
export interface RobotRecord {
  name: string
  path: string
  createdAt: string
  avatar: string
  description: string
}

/** 写登记表时接受的记录：`avatar` / `description` 缺省时由写回逻辑补齐。 */
export interface RobotRecordInput {
  name: string
  path: string
  createdAt: string
  avatar?: string
  description?: string
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
