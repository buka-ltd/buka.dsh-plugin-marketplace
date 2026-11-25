/**
 * 给浏览器一半用的包内 HTTP 路由：读一个会话的 pen 状态、勾选 / 取消勾选。
 *
 * 两条路由都沿用 web 组合的信任栅栏（`connection.requestRejection`）：
 * 只接受本机、已认证的浏览器请求。请求体很小，超过 16 KiB 直接拒绝。
 *
 * @module @buka/dsh-plugin-pen/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  contentTypeOf,
  describeError,
  readBoundedBody,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'

import type { PenStateSource } from './controller.ts'

/** 读取状态的路由；浏览器一半按同一常量访问。 */
export const STATE_ROUTE = '/pen/state'

/** 勾选 / 取消勾选的路由。 */
export const TOGGLE_ROUTE = '/pen/toggle'

/** 两条路由的请求体都很小。 */
const MAX_BODY_BYTES = 16 * 1024

/** 会话 id 的宽松上限；真实 id 远小于它。 */
const MAX_SESSION_ID_LENGTH = 128

/** 解析 GET 查询串。 */
function queryOf(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/** 校验请求里的会话 id。 */
function sessionIdOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return undefined
  return id
}

/**
 * 读 JSON 请求体；失败时已经写好响应，返回 `undefined` 让调用方直接返回。
 */
async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | undefined> {
  if (contentTypeOf(req) !== 'application/json') {
    sendError(res, 415, 'unsupported-media-type', 'content-type 必须是 application/json')
    return undefined
  }
  const text = await readBoundedBody(req, MAX_BODY_BYTES)
  if (text === null) {
    sendError(res, 413, 'body-too-large', '请求体过大')
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    sendError(res, 400, 'invalid-json', '请求体不是合法 JSON')
    return undefined
  }
}

/**
 * 注册两条路由。
 *
 * @param ctx 插件上下文
 * @param source pen 状态源（Host 控制器）
 */
export function registerRoutes(ctx: Context, source: PenStateSource): void {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    /** 复用 web 组合的信任栅栏；被拒绝时已经写好响应。 */
    function rejected(req: IncomingMessage, res: ServerResponse): boolean {
      let rejection: number | undefined
      try {
        rejection = webCtx.connection.requestRejection(req)
      } catch {
        rejection = 500
      }
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
    }

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: STATE_ROUTE,
          handler: (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            const sessionId = sessionIdOf(queryOf(req).get('sessionId'))
            if (sessionId === undefined) {
              sendError(res, 400, 'invalid-session', 'sessionId 缺失或非法')
              return
            }
            sendJson(res, 200, { ok: true, ...source.snapshot(sessionId) })
          },
        }),
      `pen: GET ${STATE_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: TOGGLE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const fields = body as { sessionId?: unknown; enabled?: unknown } | null
            const sessionId = sessionIdOf(fields?.sessionId)
            if (sessionId === undefined || typeof fields?.enabled !== 'boolean') {
              sendError(res, 400, 'invalid-body', '需要 sessionId 与 enabled')
              return
            }
            try {
              const snapshot = await source.setEnabled(sessionId, fields.enabled)
              sendJson(res, 200, { ok: true, ...snapshot })
            } catch (error) {
              sendError(res, 500, 'toggle-failed', describeError(error))
            }
          },
        }),
      `pen: POST ${TOGGLE_ROUTE}`,
    )
  })
}
