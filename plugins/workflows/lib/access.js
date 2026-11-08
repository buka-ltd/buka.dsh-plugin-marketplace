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

/** 判定结果的全部 reason 取值。 */
export const ACCESS_REASONS = [
  'open',
  'unavailable',
  'no-session',
  'child-session',
  'no-preset',
  'denied',
  'allowed',
]

/**
 * 判断某个 agent 能否看到 / 调用工作流工具。
 *
 * - `allowed` 为空：不做收窄（兼容没有 preset 服务的组成）。
 * - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，保持可见。
 * - 其余情况：只有「点名 preset 的根会话」可见。
 *
 * @param {{
 *   allowed?: readonly string[] | null | undefined,
 *   agentId?: string | null | undefined,
 *   sessions?: { get?: (id: string) => any } | null | undefined,
 *   agentPresets?: { presetForSession?: (session: any) => string | null | undefined } | null | undefined,
 * }} [input]
 * @returns {{ visible: boolean, preset: string | null, reason: string }}
 */
export function resolveWorkflowAccess(input = {}) {
  const allowed = normalizePresets(input.allowed)
  if (allowed.length === 0) return { visible: true, preset: null, reason: 'open' }

  const sessions = input.sessions
  const agentPresets = input.agentPresets
  if (typeof sessions?.get !== 'function' || typeof agentPresets?.presetForSession !== 'function') {
    return { visible: true, preset: null, reason: 'unavailable' }
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId : ''
  const session = agentId === '' ? undefined : sessions.get(agentId)
  if (session === undefined || session === null) return { visible: false, preset: null, reason: 'no-session' }

  // 子会话（机器人节点自己）继承的是编排器 preset，但不应再编排工作流。
  if (session.header?.parentSession !== undefined) return { visible: false, preset: null, reason: 'child-session' }

  const preset = agentPresets.presetForSession(session) ?? null
  if (preset === null) return { visible: false, preset: null, reason: 'no-preset' }
  return allowed.includes(preset)
    ? { visible: true, preset, reason: 'allowed' }
    : { visible: false, preset, reason: 'denied' }
}

/**
 * 规范化配置里的 preset 名单：去掉空串与非字符串。
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizePresets(value) {
  if (!Array.isArray(value)) return []
  /** @type {string[]} */
  const presets = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const preset = entry.trim()
    if (preset !== '') presets.push(preset)
  }
  return presets
}
