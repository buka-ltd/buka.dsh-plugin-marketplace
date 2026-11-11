/**
 * 包内 HTTP 路由用到的请求 / 响应工具。
 *
 * 都是与业务无关的薄封装：解析查询串、读有上限的 JSON 请求体、发 JSON、
 * 405 响应，以及把错误转成可展示的文本。路由处理自己不做这些细节。
 *
 * @module @buka/dsh-plugin-skills/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 卸载请求体很小（只有 scope 与 id），超过这个大小按恶意请求处理。 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * 解析 GET 路由的查询串。
 */
export function parseQuery(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * 读取并解析 JSON 请求体。
 *
 * 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
 * 返回 `undefined` 让调用方直接返回；`null` 是合法 JSON，原样返回。
 */
export async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    sendJson(res, 415, { ok: false, message: 'content-type 必须是 application/json' })
    return undefined
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendJson(res, 413, { ok: false, message: '请求体过大' })
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
    return undefined
  }
}

/**
 * 把任意错误转成可以展示的文本。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 发送 JSON 响应；数据是实时事实，不缓存。 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 并带上唯一支持的方法。 */
export function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/**
 * 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
 */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}
