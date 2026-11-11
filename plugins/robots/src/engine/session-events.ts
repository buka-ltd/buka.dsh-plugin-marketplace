/**
 * 机器人会话日志的读取。
 *
 * 只按字段读 DSH 的会话事件（`assistant/message` / `turn/end`），不依赖上游
 * 事件类型的完整定义，这样本模块可以脱离 DSH 依赖被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-robots/engine/session-events
 */

import type { LiveAgent, SessionEventLike, SessionLike } from '../service/types.ts'

/**
 * 会话日志里 `sinceSeq` 之后的事件；没有事件源时返回空数组。
 *
 */
function sessionEvents(session: SessionLike | undefined, sinceSeq: number = 0): SessionEventLike[] {
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents(sinceSeq)
  if (typeof session?.ownEvents === 'function') return session.ownEvents()
  return []
}

/**
 * 从会话日志里取一次轮次（`sinceSeq` 之后）的 assistant 文本、结束原因，以及
 * 这一轮是否真的写下了 `turn/end`。观察者恢复时靠 `turnEnded` 判断上一轮是
 * 已经完成、还是被中断后需要续跑。
 *
 */
export function readSessionTurn(
  session: SessionLike | undefined,
  sinceSeq: number = 0,
): { text: string; stopReason: string; turnEnded: boolean; turnEndSeq: number | null } {
  const events = sessionEvents(session, sinceSeq)
  let text = ''
  let reason: { kind?: unknown } | null | undefined
  let turnEnded = false
  let turnEndSeq: number | null = null
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < sinceSeq) continue
    if (event?.type === 'assistant/message') {
      const content = event?.data?.message?.content
      const parts = Array.isArray(content)
        ? content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
        : []
      if (parts.length > 0) text = parts.join('\n')
    } else if (event?.type === 'turn/end') {
      reason = event?.data?.reason
      turnEnded = true
      turnEndSeq = typeof event?.seq === 'number' ? event.seq : null
    }
  }
  return { text, stopReason: mapTurnEnd(reason), turnEnded, turnEndSeq }
}

/**
 * 从会话日志里取最后一次 assistant 文本与 turn 结束原因。
 *
 */
export function readSessionOutcome(
  session: SessionLike | undefined,
  startSeq: number = 0,
): { text: string; stopReason: string } {
  const turn = readSessionTurn(session, startSeq)
  return { text: turn.text, stopReason: turn.stopReason }
}

/**
 * 从会话日志读 plan 模式状态。
 *
 * DSH 的 plan 模式把状态记成 `plan/mode` 事件（整值替换），最后一条就是当前
 * 提交状态；读不到事件时按未激活处理。这样不需要拿到被 `isolate` 在会话
 * preset 里的 planMode 服务实例，profile 根部的插件也能判断某个会话是否还
 * 停在 plan 模式。
 *
 */
export function readPlanModeActive(session: SessionLike | undefined): boolean {
  const events = sessionEvents(session)
  let active = false
  for (const event of events) {
    if (event?.type === 'plan/mode' && typeof event?.data?.active === 'boolean') {
      active = event.data.active
    }
  }
  return active
}

/**
 * 把 `turn/end.reason` 映射成节点结果里的 stopReason。
 *
 */
export function mapTurnEnd(reason: { kind?: unknown } | null | undefined): string {
  const kind = reason?.kind
  switch (kind) {
    case 'completed':
    case 'error':
    case 'max-tokens':
    case 'aborted':
    case 'interrupted':
    case 'blocked':
    case 'forked':
      return kind
    default:
      return typeof kind === 'string' ? kind : 'completed'
  }
}

/**
 * 会话当前的事件序号；续接时用它排除旧轮次。
 *
 */
export function seqOf(agent: LiveAgent): number {
  const seq = agent?.session?.seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : 0
}
