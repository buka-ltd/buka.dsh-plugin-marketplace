/**
 * 与 Host 一半的 HTTP 接口。
 *
 * 浏览器只读状态、发勾选：挂载与卸载 pen MCP 全在 Host 完成。路由常量与
 * `src/routes.ts` 保持一致。
 *
 * @module @buka/dsh-plugin-pen/client/api
 */

import { requestJson } from '@buka/plugin-ui'

import type { PenSnapshot } from '../state.ts'

/** 与 Host 一致的读状态路由。 */
const STATE_ROUTE = '/pen/state'

/** 与 Host 一致的勾选路由。 */
const TOGGLE_ROUTE = '/pen/toggle'

/** 路由响应：`ok` 之外就是快照字段。 */
type PenResponse = PenSnapshot & { ok: true }

/**
 * 把响应体收成快照；`message` 只在存在时带上，满足可选字段的严格类型。
 */
function snapshotOfBody(body: PenResponse): PenSnapshot {
  return {
    enabled: body.enabled,
    status: body.status,
    ...(typeof body.message === 'string' ? { message: body.message } : {}),
  }
}

/**
 * 读一个会话的 pen 状态。
 *
 * @param sessionId 会话 id
 * @returns 当前快照
 */
export async function readPenState(sessionId: string): Promise<PenSnapshot> {
  const body = await requestJson<PenResponse>(
    `${STATE_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`,
  )
  return snapshotOfBody(body)
}

/**
 * 勾选或取消勾选。
 *
 * @param sessionId 会话 id
 * @param enabled 是否启用
 * @returns 操作后的快照
 */
export async function setPenEnabled(sessionId: string, enabled: boolean): Promise<PenSnapshot> {
  const body = await requestJson<PenResponse>(TOGGLE_ROUTE, {
    method: 'POST',
    body: JSON.stringify({ sessionId, enabled }),
  })
  return snapshotOfBody(body)
}
