/**
 * 工作流工具的可见性判定。
 *
 * 工具本身注册在 Host 上，默认每个会话都能看到。这里把可见性收窄到配置里
 * 点名的 agent preset，并且只放行该 preset 的**根会话**：由编排器 spawn 出来
 * 的子会话（打工人节点）拿不到工具，避免打工人在节点里自己去开新工作流。
 *
 * 另外可以按工作区放行（`orchestratorWorkspaces`）：在点名目录（含子目录）
 * 里启动的会话直接可见，不必切到编排 preset——开发者工作区就是这种用法。
 *
 * 纯函数，不 import DSH 包，便于单测。
 *
 * @module @buka/dsh-plugin-workflows/access
 */

import path from 'node:path'

/** 判定结果的 reason 取值。 */
export type AccessReason =
  | 'open'
  | 'unavailable'
  | 'no-session'
  | 'workspace'
  | 'child-session'
  | 'no-preset'
  | 'denied'
  | 'allowed'

/** 判定结果的全部 reason 取值。 */
export const ACCESS_REASONS: readonly AccessReason[] = [
  'open',
  'unavailable',
  'no-session',
  'workspace',
  'child-session',
  'no-preset',
  'denied',
  'allowed',
]

/** 判定只用到会话的父会话标记与工作目录。 */
interface SessionLike {
  readonly header?: { readonly parentSession?: unknown; readonly cwd?: unknown } | null | undefined
}

/** `sessions` 服务里只用到的部分。 */
interface SessionsLike {
  get?: (id: string) => SessionLike | null | undefined
}

/** `agentPresets` 服务里只用到的部分。 */
interface AgentPresetsLike {
  presetForSession?: (session: SessionLike) => string | null | undefined
}

/** 判定入参：全部可选，缺服务时按“无法判定”处理。 */
export interface ResolveWorkflowAccessInput {
  readonly allowed?: readonly string[] | null | undefined
  /** 按工作区放行的目录；会话 cwd 在其中一个之下即放行。 */
  readonly allowedWorkspaces?: readonly string[] | null | undefined
  readonly agentId?: string | null | undefined
  /** 宿主 `sessions` 服务；只做运行时方法检查，避免耦合它的具体类型。 */
  readonly sessions?: unknown
  /** 宿主 `agentPresets` 服务；同上。 */
  readonly agentPresets?: unknown
}

/** 判定结果。 */
export interface WorkflowAccess {
  readonly visible: boolean
  readonly preset: string | null
  readonly reason: AccessReason
}

/**
 * 判断某个 agent 能否看到 / 调用工作流工具。
 *
 * - `allowed` 与 `allowedWorkspaces` 都为空：不做收窄（兼容没有 preset 服务的组成）。
 * - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，保持可见。
 * - 会话 cwd 落在 `allowedWorkspaces` 的某个目录下：直接放行（开发者工作区）。
 * - 其余情况：只有「点名 preset 的根会话」可见。
 *
 * @param input 判定入参
 * @returns 可见性、命中的 preset 与原因
 */
export function resolveWorkflowAccess(input: ResolveWorkflowAccessInput = {}): WorkflowAccess {
  const allowed = normalizePresets(input.allowed)
  const workspaces = normalizeWorkspaces(input.allowedWorkspaces)
  if (allowed.length === 0 && workspaces.length === 0) {
    return { visible: true, preset: null, reason: 'open' }
  }

  // 两个服务按运行时方法存在性判断；类型只在内部按用到的形状收窄。
  const sessions = input.sessions as SessionsLike | null | undefined
  const agentPresets = input.agentPresets as AgentPresetsLike | null | undefined
  if (typeof sessions?.get !== 'function') {
    return { visible: true, preset: null, reason: 'unavailable' }
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId : ''
  const session = agentId === '' ? undefined : sessions.get(agentId)
  if (session === undefined || session === null) {
    return { visible: false, preset: null, reason: 'no-session' }
  }

  // 工作区放行：开发者工作区里的会话不必切 preset。放在子会话判断之前，
  // 这样同一个工作区里 spawn 出来的子会话也能直接改定义。
  const cwd = typeof session.header?.cwd === 'string' ? session.header.cwd : ''
  if (isInsideWorkspace(cwd, workspaces)) {
    return { visible: true, preset: null, reason: 'workspace' }
  }

  if (typeof agentPresets?.presetForSession !== 'function') {
    return { visible: true, preset: null, reason: 'unavailable' }
  }

  // 子会话（打工人节点自己）继承的是编排器 preset，但不应再编排工作流。
  if (session.header?.parentSession !== undefined) {
    return { visible: false, preset: null, reason: 'child-session' }
  }

  const preset = agentPresets.presetForSession(session) ?? null
  if (preset === null) return { visible: false, preset: null, reason: 'no-preset' }
  return allowed.includes(preset)
    ? { visible: true, preset, reason: 'allowed' }
    : { visible: false, preset, reason: 'denied' }
}

/**
 * 规范化配置里的工作区目录：去掉空串与非字符串。
 *
 * @param value 配置里的原始值
 * @returns 规范化的目录列表
 */
export function normalizeWorkspaces(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const roots: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const root = normalizeWorkspacePath(entry)
    if (root !== '' && !roots.includes(root)) roots.push(root)
  }
  return roots
}

/**
 * 会话 cwd 是否落在某个工作区目录下（含目录本身）。
 *
 * @param cwd 会话的工作目录
 * @param workspaces 放行的工作区目录
 * @returns 命中任何一个目录即为 true
 */
function isInsideWorkspace(cwd: string, workspaces: readonly string[]): boolean {
  if (workspaces.length === 0 || typeof cwd !== 'string' || cwd.trim() === '') return false
  const target = normalizeWorkspacePath(cwd)
  if (target === '') return false
  const separator = path.sep
  for (const workspace of workspaces) {
    if (target === workspace) return true
    const prefix = workspace.endsWith(separator) ? workspace : `${workspace}${separator}`
    if (target.startsWith(prefix)) return true
  }
  return false
}

/**
 * 规范化一个目录：转绝对路径、去掉末尾的 `/` 与 `\\`。
 *
 * @param value 原始路径
 * @returns 规范化路径；空串表示无效
 */
function normalizeWorkspacePath(value: string): string {
  const text = value.trim()
  if (text === '') return ''
  const absolute = path.resolve(text)
  if (absolute === path.sep) return absolute
  return absolute.replace(/[\\/]+$/u, '')
}

/**
 * 规范化配置里的 preset 名单：去掉空串与非字符串。
 *
 * @param value 配置里的原始值
 * @returns 去重前的合法 preset 名单
 */
export function normalizePresets(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const presets: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const preset = entry.trim()
    if (preset !== '') presets.push(preset)
  }
  return presets
}
