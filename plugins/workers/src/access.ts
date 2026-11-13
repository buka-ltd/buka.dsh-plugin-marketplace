/**
 * 按 agent preset 收窄的可见性判定。
 *
 * 两处用途：
 *
 * 1. **打工人工具**：「打工人」是随本插件发布的一个 agent preset
 *    （bundle 补丁里插了 `@deepseek-ai/dsh-agent-preset` 行）。创建与修改打工人
 *    的工具注册在 Host 上，但只对该 preset 的**根会话**可见：其他 preset、以及
 *    由它 spawn 出来的子会话都看不到，避免普通会话或打工人自己顺手把打工人改掉。
 * 2. **`buka_workers` 的技能清单**：工作流编排者只按打工人的一句职责选人，不应该
 *    看到每个打工人装了哪些 skill（那属于执行细节）；对这些 preset 隐藏
 *    `skills` 字段，避免它拿技能清单来排流程。
 *
 * 与工作流插件的 `access.js` 同一模式。**失败策略按用途不同**：打工人是写
 * 操作，拿不到 `sessions` / `agentPresets` 服务时一律不可见；技能清单是只读
 * 信息的收窄，识别不出调用方时保持可见，避免在拿不到 preset 服务的组成里
 * 把普通会话的 `buka_workers` 输出砍掉。
 *
 * 纯函数，不 import DSH 包，便于单测。
 *
 * @module @buka/dsh-plugin-workers/access
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
 * 判断某个 agent 能否看到 / 调用打工人工具。
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
  // 用户直接发起的那一轮根会话才算「构建打工人」，避免后台子会话偷偷创建。
  if (session.header?.parentSession !== undefined)
    return { visible: false, preset: null, reason: 'child-session' }

  const preset = agentPresets.presetForSession(session) ?? null
  if (preset === null) return { visible: false, preset: null, reason: 'no-preset' }
  return allowed.includes(preset)
    ? { visible: true, preset, reason: 'allowed' }
    : { visible: false, preset, reason: 'denied' }
}

/**
 * 工作流编排 preset（由 workflows 插件随包发布）。这个 preset 固定看不到
 * 打工人的技能清单：编排者只按每个打工人的一句职责选人，不按技能清单排流程。
 * 这是一条硬规则，不提供配置开关。
 */
export const WORKFLOW_ORCHESTRATOR_PRESET = 'workflow-orchestrator'

/**
 * 技能清单可见性判定结果的全部 reason 取值。
 *
 * `visible: false` 时调用方拿不到 `buka_workers` 的 `skills` 字段。
 */
export const WORKER_SKILLS_ACCESS_REASONS = [
  'unavailable',
  'no-session',
  'no-preset',
  'visible',
  'hidden',
]

/**
 * 判断某个 agent 能否看到 `buka_workers` 返回的打工人技能清单。
 *
 * 工作流编排 preset 固定隐藏（见 `WORKFLOW_ORCHESTRATOR_PRESET`）：编排者拿到的
 * 只有每个打工人的一句职责，不需要、也不应该知道它们装了哪些 skill。
 *
 * - 组成里没有 `sessions` / `agentPresets` 服务：识别不出调用方，保持可见
 *   （只读信息的收窄，失败时不连累普通会话）。
 * - 其余情况：只有 `workflow-orchestrator` 看不到技能清单。
 *
 */
export function resolveWorkerSkillsVisibility(
  input: {
    agentId?: string | null | undefined
    sessions?: { get?: (id: string) => AccessSession | null | undefined } | null | undefined
    agentPresets?:
      | { presetForSession?: (session: AccessSession) => string | null | undefined }
      | null
      | undefined
  } = {},
): { visible: boolean; preset: string | null; reason: string } {
  const sessions = input.sessions
  const agentPresets = input.agentPresets
  if (typeof sessions?.get !== 'function' || typeof agentPresets?.presetForSession !== 'function') {
    return { visible: true, preset: null, reason: 'unavailable' }
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId : ''
  const session = agentId === '' ? undefined : sessions.get(agentId)
  if (session === undefined || session === null)
    return { visible: true, preset: null, reason: 'no-session' }

  const preset = agentPresets.presetForSession(session) ?? null
  if (preset === null) return { visible: true, preset: null, reason: 'no-preset' }
  return preset === WORKFLOW_ORCHESTRATOR_PRESET
    ? { visible: false, preset, reason: 'hidden' }
    : { visible: true, preset, reason: 'visible' }
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
