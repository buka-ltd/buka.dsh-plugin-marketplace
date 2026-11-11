/**
 * 工作流工具的可见性判定。
 *
 * 工具本身注册在 Host 上，默认每个会话都能看到。这里把可见性收窄到配置里
 * 点名的 agent preset，并且只放行该 preset 的**根会话**：由编排器 spawn 出来
 * 的子会话（机器人节点）拿不到工具，避免机器人在节点里自己去开新工作流。
 *
 * 纯函数，不 import DSH 包，便于单测。
 *
 * @module @buka/dsh-plugin-workflows/access
 */

/** 判定结果的 reason 取值。 */
export type AccessReason =
  | 'open'
  | 'unavailable'
  | 'no-session'
  | 'child-session'
  | 'no-preset'
  | 'denied'
  | 'allowed'

/** 判定结果的全部 reason 取值。 */
export const ACCESS_REASONS: readonly AccessReason[] = [
  'open',
  'unavailable',
  'no-session',
  'child-session',
  'no-preset',
  'denied',
  'allowed',
]

/** 判定只用到会话的父会话标记。 */
interface SessionLike {
  readonly header?: { readonly parentSession?: unknown } | null | undefined
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
 * - `allowed` 为空：不做收窄（兼容没有 preset 服务的组成）。
 * - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，保持可见。
 * - 其余情况：只有「点名 preset 的根会话」可见。
 *
 * @param input 判定入参
 * @returns 可见性、命中的 preset 与原因
 */
export function resolveWorkflowAccess(input: ResolveWorkflowAccessInput = {}): WorkflowAccess {
  const allowed = normalizePresets(input.allowed)
  if (allowed.length === 0) return { visible: true, preset: null, reason: 'open' }

  // 两个服务按运行时方法存在性判断；类型只在内部按用到的形状收窄。
  const sessions = input.sessions as SessionsLike | null | undefined
  const agentPresets = input.agentPresets as AgentPresetsLike | null | undefined
  if (typeof sessions?.get !== 'function' || typeof agentPresets?.presetForSession !== 'function') {
    return { visible: true, preset: null, reason: 'unavailable' }
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId : ''
  const session = agentId === '' ? undefined : sessions.get(agentId)
  if (session === undefined || session === null) {
    return { visible: false, preset: null, reason: 'no-session' }
  }

  // 子会话（机器人节点自己）继承的是编排器 preset，但不应再编排工作流。
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
