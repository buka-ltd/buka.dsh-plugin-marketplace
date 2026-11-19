/**
 * 执行者存储层的数据结构。
 *
 * 登记表是 version 4：每个执行者有不可变标识符 `id`（目录名与引用键）、可选
 * 展示名 `name`（空串表示未设置、显示标识符）与 `driver`（agent / robot）。
 * 智能体有目录、AGENTS.md 与项目 skills；机器人是固定程序，没有目录，只登记
 * `program` id（稳定契约，v1 只有 `clock`）。助理不是执行者身上的标记，而是
 * 工作流上的点名（见 workflows 的 ADR 0022）。
 *
 * @module @buka/dsh-plugin-workflows/workers/store/types
 */

/** 执行者驱动类型：智能体跑 DSH 会话，机器人是固定程序。 */
export type WorkerDriver = 'agent' | 'robot'

/** 智能体的模型选择；`reasoningEffort` 省略表示用适配器默认值。 */
export interface WorkerModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * 工作区注册表的最小形状：列表判断挂载用到的 `list`，删除执行者时用 `delete`
 * 摘掉注册行；`create` 只在回滚时尽力恢复。
 */
export interface WorkspaceRegistryLike {
  list(): Array<{ id?: unknown; path?: unknown }>
  delete?(id: unknown): boolean | Promise<boolean>
  create?(directory: string, title?: string): Promise<{ id?: unknown }>
  resolveByPath?(directory: string): Promise<{ id?: unknown; path?: unknown } | null | undefined>
}

/** 一条执行者记录；写回登记表后这些字段总是齐全。 */
export interface WorkerRecord {
  /** 不可变标识符：引用键，也是智能体目录名。 */
  id: string
  /** 可选展示名；空串表示未设置，展示时回退到 `id`。 */
  name: string
  driver: WorkerDriver
  /** 智能体的目录；机器人没有目录，固定空串。 */
  path: string
  /** 机器人的程序 id；智能体固定空串。 */
  program: string
  createdAt: string
  avatar: string
  description: string
  /** 智能体新会话使用的模型；没有配置时跟随宿主默认模型。机器人没有。 */
  model?: WorkerModelSelection | undefined
}

/**
 * 写登记表时接受的记录：`id` 必填，`name` 可选；其它字段由写回逻辑补齐。
 */
export interface WorkerRecordInput {
  id: string
  name?: string | undefined
  driver?: WorkerDriver | undefined
  path?: string | undefined
  program?: string | undefined
  createdAt: string
  avatar?: string | undefined
  description?: string | undefined
  model?: WorkerModelSelection | null | undefined
}

/**
 * 执行者的展示名：`name` 非空时用它，否则回退到标识符。
 *
 */
export function workerDisplayName(worker: { id?: unknown; name?: unknown }): string {
  const name = typeof worker.name === 'string' ? worker.name.trim() : ''
  if (name !== '') return name
  return typeof worker.id === 'string' ? worker.id : ''
}

/** AGENTS.md 的摘要；文件不存在或读不了时字段取空值，保证响应结构稳定。 */
export interface AgentsFileInfo {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}

/** 执行者目录里 CLAUDE.md 的状态；`mode` 的取值见 `readClaudeLink`。 */
export interface ClaudeLinkInfo {
  exists: boolean
  symlink: boolean
  mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing'
  target: string
}

/** 列表里的一行执行者：登记表信息 + 磁盘 / 挂载状态。 */
export interface WorkerListEntry extends WorkerRecord {
  exists: boolean
  mounted: boolean
  workspaceId: string | null
  skills: Array<{ name: string; description: string; source: string | null }>
  agents: AgentsFileInfo
  claude: ClaudeLinkInfo
}
