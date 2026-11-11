/**
 * 节点会话入口：打开 DSH 会话，必要时先刷新客户端会话列表。
 */

import { messageOf } from '../format.ts'
import type { Translate } from '../types.ts'
import { isRecord } from '../types.ts'

/** 会话动作依赖。 */
interface SessionsDeps {
  getService: (name: string) => unknown
  t: Translate
  flash: (kind: 'success' | 'error', text: string) => void
}

/** 节点会话动作。 */
export interface SessionsActions {
  /** 打开某个节点会话。 */
  openSession: (step: { sessionId?: unknown } | null | undefined) => Promise<void>
}

/**
 * 节点会话的打开入口。
 *
 * @param deps DSH Client Service 取值器、词典与 Toast
 * @returns 会话动作
 */
export function createSessionActions({ getService, t, flash }: SessionsDeps): SessionsActions {
  /**
   * 取一个 DSH Client Service；不存在时返回 null。
   *
   * @param serviceName
   * @returns
   */
  function service(serviceName: string): Record<string, unknown> | null {
    try {
      const found = getService(serviceName)
      return isRecord(found) ? found : null
    } catch {
      return null
    }
  }

  /**
   * 客户端会话列表里还没有这个会话时，先做一次全量刷新。
   *
   * 宿主释放机器人 agent 后会给客户端发 `api-session/removed`，旧版本留下的
   * 记录、或补通告失败时，这个节点会话可能已经不在客户端列表里；此时
   * `uiWorkspace.openSession()` 会抛 `sessions.retain: unknown session`。
   * 这里补一次 `sessions.refresh()`，把宿主仍然持久化的会话重新拉回来。
   *
   * @param sessionId
   * @returns
   */
  async function refreshSessionsIfUnknown(sessionId: string): Promise<void> {
    const sessions = service('sessions')
    if (sessions === null || typeof sessions.refresh !== 'function') return
    let known = false
    try {
      const list = sessions.list
      const getSnapshot = isRecord(list) ? list.getSnapshot : undefined
      const state = typeof getSnapshot === 'function' ? (getSnapshot as () => unknown)() : null
      const byId = isRecord(state) && isRecord(state.byId) ? state.byId : null
      known = byId !== null && byId[sessionId] !== undefined
    } catch {
      known = false
    }
    if (known) return
    try {
      await (sessions.refresh as () => Promise<unknown>)()
    } catch (failure) {
      // 刷新失败时仍然尝试打开：openSession 会给出真正的错误原因。
      console.warn('buka-workflows: refreshing the session list failed:', failure)
    }
  }

  /**
   * 打开某个节点会话。
   *
   * @param step
   * @returns
   */
  async function openSession(step: { sessionId?: unknown } | null | undefined): Promise<void> {
    const sessionId = typeof step?.sessionId === 'string' ? step.sessionId : ''
    if (sessionId === '') return
    const uiWorkspace = service('uiWorkspace')
    if (uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') {
      flash('error', t('noUiWorkspace'))
      return
    }
    try {
      await refreshSessionsIfUnknown(sessionId)
      ;(uiWorkspace.openSession as (id: string) => void)(sessionId)
    } catch (failure) {
      flash('error', `${t('openSessionFailed')} ${messageOf(failure)}`)
    }
  }

  return { openSession }
}
