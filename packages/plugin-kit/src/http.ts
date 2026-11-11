/**
 * HTTP 路由的公共机制。
 *
 * 四个插件各自注册了几条 Host 路由，机制完全一样（读有上限的 JSON 请求体、
 * 统一响应头、405），但**错误语义**按插件不同：有的回 `{ ok: false, message }`，
 * 有的回 `{ ok: false, code, message }`。所以这里只共享机制，不共享错误口径——
 * 各插件保留自己那层很薄的 `readJsonBody`，用这里的零件拼出来。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 读请求的媒体类型：去掉参数、转小写。没有 content-type 时返回空字符串。
 */
export function contentTypeOf(req: IncomingMessage): string {
  const raw = req.headers['content-type']
  const value = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

/**
 * 读取有上限的请求体；超过上限时丢弃剩余流并返回 `null`。
 *
 * 调用方拿 `null` 决定怎么回 413：状态码一样，响应体形状按插件自己的错误口径。
 */
export async function readBoundedBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > maxBytes) {
      req.resume()
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** 发送 JSON 响应。实时事实，不缓存。 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 发送带错误码的失败响应：`{ ok: false, code, message }`。 */
export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { ok: false, code, message })
}

/** 405，并带上这个路由支持的方法。 */
export function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}
