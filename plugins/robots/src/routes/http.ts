/**
 * 「机器人」页面 Host 路由共用的 HTTP 小工具。
 *
 * 所有路由都沿用 web 组合的信任栅栏（`connection.requestRejection`），请求体
 * 只接受小体积 JSON；失败统一回 `{ ok: false, code, message }`。这些函数只做
 * 协议层的事，不知道具体的机器人语义，所以单独放在这里。
 *
 * @module @buka/dsh-plugin-robots/routes/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** 请求体上限：页面发送的 JSON 都很小，超过这个大小按恶意请求处理。 */
export const MAX_BODY_BYTES = 1024 * 1024

/**
 * 复用 web 组合的信任栅栏；被拒绝时已经写好响应。
 *
 */
export function rejected(webCtx: Context, req: IncomingMessage, res: ServerResponse): boolean {
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

/**
 * 读取并解析 JSON 请求体。
 *
 * 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
 * 返回 `undefined` 让调用方直接返回；`null` 是合法 JSON，原样返回。
 *
 */
export async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    sendError(res, 415, 'invalid-content-type', 'content-type 必须是 application/json')
    return undefined
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendError(res, 413, 'too-large', '请求体过大')
    return undefined
  }
  try {
    // 调用方只按字段读取；`null` / 数组在读字段时自然得到 undefined，与原实现一致。
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    sendError(res, 400, 'invalid-json', '请求体不是合法 JSON')
    return undefined
  }
}

/**
 * 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
 *
 */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/**
 * 读带错误码的错误；HTTP 路由按 `code` 映射状态码。
 *
 */
export function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * 把任意错误转成可以展示的文本。
 *
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 发送 JSON 响应；数据是实时事实，不缓存。
 *
 */
export function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * 统一的失败响应：`{ ok: false, code, message }`。
 *
 */
export function sendError(res: ServerResponse, status: number, code: string, message: string) {
  sendJson(res, status, { ok: false, code, message })
}

/**
 * 405 并带上唯一支持的方法。
 *
 */
export function sendMethodNotAllowed(res: ServerResponse, allow: string) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ ok: false, code: 'method-not-allowed', message: `只支持 ${allow}` }))
}
