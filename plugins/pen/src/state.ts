/**
 * 一个会话的 pen MCP 连接状态，以及浏览器一半读到的快照。
 *
 * 这里只有纯数据与纯函数：Host 的状态机在 `controller.ts`，路由在
 * `routes.ts`。把快照形状单独放一层，测试与浏览器一半都不需要拉起 Cordis。
 *
 * @module @buka/dsh-plugin-pen/state
 */

/** 一个会话的 pen 状态。`connecting` 只出现在浏览器一半的乐观更新里。 */
export type PenStatus = 'idle' | 'pending' | 'connecting' | 'ready' | 'error'

/** 浏览器一半从 Host 拿到的一份状态快照。 */
export interface PenSnapshot {
  /** 这个会话是否勾选了「Pen」。 */
  readonly enabled: boolean
  /** 当前连接状态。 */
  readonly status: PenStatus
  /** `status: 'error'` 时的失败文本。 */
  readonly message?: string
}

/** Host 侧维护的单个会话状态；`fiber` 不放进快照，浏览器不需要它。 */
export interface PenSessionState {
  /** 用户是否勾选。勾选后，Agent 一创建就挂载 pen MCP。 */
  readonly enabled: boolean
  /** 已经挂载（或正在挂载）的 mcp-client 插件 fiber。 */
  readonly mounted: boolean
  /** 最近一次挂载失败的原因；成功挂载或取消勾选后清空。 */
  readonly error?: string
}

/**
 * 把一个会话状态投影成浏览器快照。
 *
 * - 未勾选 → `idle`；
 * - 勾了但 Agent 还没创建 → `pending`（会话开始后自动连接）；
 * - 已挂载 → `ready`；
 * - 挂载失败 → `error`。
 *
 * @param state 会话状态；没有记录时视为未勾选
 * @returns 供浏览器展示的快照
 */
export function snapshotOf(state: PenSessionState | undefined): PenSnapshot {
  if (state === undefined || !state.enabled) return { enabled: false, status: 'idle' }
  if (state.error !== undefined) return { enabled: true, status: 'error', message: state.error }
  if (state.mounted) return { enabled: true, status: 'ready' }
  return { enabled: true, status: 'pending' }
}
