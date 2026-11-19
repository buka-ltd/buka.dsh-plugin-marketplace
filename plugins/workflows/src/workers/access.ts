/**
 * 按 agent preset 收窄的可见性判定。
 *
 * 执行者写工具：`buka_worker_build` 注册在 Host 上，但只对随包发布的
 * `Workflow` 预设（bundle 补丁里的 `workflow-orchestrator` 行）的**根会话**
 * 可见：其他 preset、以及由它 spawn 出来的子会话都看不到，避免普通会话或
 * 执行者自己顺手把执行者改掉。
 *
 * 与工作流的 `access.ts` 同一模式。**失败策略**：执行者是写操作，拿不到
 * `sessions` / `agentPresets` 服务时一律不可见。
 *
 * 纯函数，不 import DSH 包，便于单测。
 *
 * @module @buka/dsh-plugin-workflows/workers/access
 */

/** 判定只读会话头的父会话标记；用最小结构声明，避免纯函数模块依赖 DSH 类型。 */
export interface AccessSession {
  readonly header?: { readonly parentSession?: unknown } | undefined
}

/** `sessions` 服务在可见性判定里用到的子集。 */
export interface AccessSessions {
  get(id: string): AccessSession | null | undefined
}

/** 判定结果的全部 reason 取值。 */
export const WORKER_BUILD_ACCESS_REASONS = [
  'open',
  'unavailable',
  'no-session',
  'child-session',
  'no-preset',
  'denied',
  'allowed',
]

/**
 * 判断某个 agent 能否看到 / 调用执行者工具。
 *
 * - `allowed` 为空：配置显式关掉了收窄（所有会话可见，不推荐）。
 * - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，收紧为不可见。
 * - 其余情况：只有「点名 preset 的根会话」可见。
 *
 */
export function resolveWorkerBuildAccess(
  input: {
    allowed?: readonly string[] | null | undefined
    agentId?: string | null | undefined
    sessions?: { get?: (id: string) => AccessSession | null | undefined } | null | undefined
    agentPresets?:
      | { presetForSession?: (session: AccessSession) => string | null | undefined }
      | null
      | undefined
  } = {},
): { visible: boolean; preset: string | null; reason: string } {
  const allowed = normalizePresets(input.allowed)
  if (allowed.length === 0) return { visible: true, preset: null, reason: 'open' }

  const sessions = input.sessions
  const agentPresets = input.agentPresets
  if (typeof sessions?.get !== 'function' || typeof agentPresets?.presetForSession !== 'function') {
    return { visible: false, preset: null, reason: 'unavailable' }
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId : ''
  const session = agentId === '' ? undefined : sessions.get(agentId)
  if (session === undefined || session === null)
    return { visible: false, preset: null, reason: 'no-session' }

  // 子会话（构建 preset 自己 spawn 出来的 agent）继承同一个 preset，但只有
  // 用户直接发起的那一轮根会话才算「构建执行者」，避免后台子会话偷偷创建。
  if (session.header?.parentSession !== undefined)
    return { visible: false, preset: null, reason: 'child-session' }

  const preset = agentPresets.presetForSession(session) ?? null
  if (preset === null) return { visible: false, preset: null, reason: 'no-preset' }
  return allowed.includes(preset)
    ? { visible: true, preset, reason: 'allowed' }
    : { visible: false, preset, reason: 'denied' }
}

/**
 * 规范化配置里的 preset 名单：去掉空串与非字符串。
 *
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
