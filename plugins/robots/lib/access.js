/**
 * 机器人构建工具的可见性判定。
 *
 * 「机器人构建」是随本插件发布的一个 agent preset（bundle 补丁里插了
 * `@deepseek-ai/dsh-agent-preset` 行）。创建与修改机器人的工具注册在 Host 上，
 * 但只对该 preset 的**根会话**可见：其他 preset、以及由它 spawn 出来的子会话
 * 都看不到，避免普通会话或机器人自己顺手把机器人改掉。
 *
 * 与工作流插件的 `access.js` 同一模式，但这里**失败时收紧**：工作流工具在
 * preset 服务缺失时保持可用（它就靠 preset 收窄），而机器人构建工具是写操作，
 * 拿不到 `sessions` / `agentPresets` 服务时无法确认调用方就是构建 preset，
 * 一律不可见，宁可不给用也不让别的会话拿到写入口。
 *
 * 纯函数，不 import DSH 包，便于单测。
 *
 * @module @buka/dsh-plugin-robots/access
 */

/** 判定结果的全部 reason 取值。 */
export const ROBOT_BUILD_ACCESS_REASONS = [
  'open',
  'unavailable',
  'no-session',
  'child-session',
  'no-preset',
  'denied',
  'allowed',
]

/**
 * 判断某个 agent 能否看到 / 调用机器人构建工具。
 *
 * - `allowed` 为空：配置显式关掉了收窄（所有会话可见，不推荐）。
 * - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，收紧为不可见。
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
export function resolveRobotBuildAccess(input = {}) {
  const allowed = normalizePresets(input.allowed)
  if (allowed.length === 0) return { visible: true, preset: null, reason: 'open' }

  const sessions = input.sessions
  const agentPresets = input.agentPresets
  if (typeof sessions?.get !== 'function' || typeof agentPresets?.presetForSession !== 'function') {
    return { visible: false, preset: null, reason: 'unavailable' }
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId : ''
  const session = agentId === '' ? undefined : sessions.get(agentId)
  if (session === undefined || session === null) return { visible: false, preset: null, reason: 'no-session' }

  // 子会话（构建 preset 自己 spawn 出来的 agent）继承同一个 preset，但只有
  // 用户直接发起的那一轮根会话才算「构建机器人」，避免后台子会话偷偷创建。
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
