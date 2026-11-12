/**
 * HTTP 小工具：响应写出、请求体读取与附件流式下载。
 *
 * @module @buka/dsh-plugin-workflows/http
 */

import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 设置请求体上限：工作流定义可能较大，但仍要防止无界读取。 */
const MAX_BODY_BYTES = 256 * 1024

/** 一个可流式返回的附件。 */
export interface AttachmentFile {
  readonly path: string
  readonly name: string
  readonly bytes: number
}

/**
 * 把附件文件写进响应：默认下载，`inline` 时按给定 MIME 内联并附带安全头。
 *
 * @param res HTTP 响应
 * @param attachment 附件文件
 * @param options 内联 / MIME / 日志
 */
export function pipeAttachment(
  res: ServerResponse,
  attachment: AttachmentFile,
  options: {
    inline?: boolean | undefined
    mime?: string | undefined
    log?: ((error: unknown) => void) | undefined
  } = {},
): void {
  res.statusCode = 200
  res.setHeader('content-type', options.mime ?? 'application/octet-stream')
  res.setHeader('content-length', String(attachment.bytes))
  res.setHeader(
    'content-disposition',
    attachmentDisposition(attachment.name, options.inline === true),
  )
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', 'no-store')
  // SVG 直接打开时也可能带脚本；预览只走 <img>，再加一条 CSP 兜住直接访问。
  if (options.mime === 'image/svg+xml') {
    res.setHeader('content-security-policy', "script-src 'none'; object-src 'none'")
  }
  const stream = createReadStream(attachment.path)
  res.on('close', () => stream.destroy())
  stream.on('error', (error) => {
    options.log?.(error)
    if (!res.headersSent) sendError(res, 500, 'read-failed', 'attachment could not be read')
    else res.destroy(error)
  })
  stream.pipe(res)
}

/**
 * 附件的响应头：ASCII 回退 + 完整 UTF-8 文件名。
 *
 * @param name 文件名
 * @param inline 是否内联展示（预览）而不是下载
 * @returns content-disposition 值
 */
function attachmentDisposition(name: string, inline = false): string {
  const ascii = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_')
  const encoded = encodeURIComponent(name).replace(/'/gu, '%27')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * 读取 JSON 请求体；content-type 不对、太大或不是合法 JSON 时已经写好响应，
 * 返回 undefined。
 *
 * @param req HTTP 请求
 * @param res HTTP 响应
 * @returns 解析后的值；失败时是 undefined
 */
export async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
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
    return JSON.parse(text) as unknown
  } catch {
    sendError(res, 400, 'invalid-json', '请求体不是合法 JSON')
    return undefined
  }
}

/**
 * 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
 *
 * @param req HTTP 请求
 * @returns 请求体文本；过大时是 null
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

/**
 * 查询参数里的条数上限。
 *
 * @param value limit 参数
 * @returns 条数上限
 */
export function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1) return 50
  return Math.min(parsed, 100)
}

/**
 * 发送 JSON 响应。
 *
 * @param res HTTP 响应
 * @param status 状态码
 * @param payload 响应体
 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * 统一的失败响应：`{ ok: false, code, message }`。
 *
 * @param res HTTP 响应
 * @param status 状态码
 * @param code 错误码
 * @param message 错误文案
 */
export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { ok: false, code, message })
}

/**
 * 405 并带上唯一支持的方法。
 *
 * @param res HTTP 响应
 * @param allow 允许的方法
 */
export function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(
    JSON.stringify({
      ok: false,
      code: 'method-not-allowed',
      message: `only ${allow} is supported`,
    }),
  )
}
