/**
 * 与 Host 一半通信的 JSON 请求 / 错误处理。
 *
 * 四个插件的浏览器一半原本各有一份几乎相同的实现：请求返回 `{ ok, ... }`，
 * 非 2xx 或 `ok !== true` 时抛出带 `code`（以及 `npx` 类路由的 `output`）的
 * 错误，失败原因再用 `messageOf` 转成展示文本。差异只在各插件自己的错误码
 * 映射与请求参数，所以这里共享机制、不共享错误文案。
 *
 * @module plugin-ui/request
 */

/** 带错误码的请求错误；`npx` 类路由还会带命令输出。 */
export interface RequestError extends Error {
  code?: string | undefined
  output?: string | undefined
}

/**
 * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
 * `npx-failed` 的响应里还有 `output`，一并挂到错误上供详情页展示。
 *
 * @param url 路由地址
 * @param init 请求选项；`body` 是已经序列化好的 JSON 字符串
 */
export async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { body?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  // 调用方只传普通对象形式的 headers；这里按同类对象展开。
  const extraHeaders = (init.headers ?? {}) as Record<string, string>
  const response = await fetch(url, { ...init, headers: { ...headers, ...extraHeaders } })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || body === null || body.ok !== true) {
    const error: RequestError = new Error(
      typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
    )
    error.code = typeof body?.code === 'string' ? body.code : undefined
    error.output = typeof body?.output === 'string' ? body.output : undefined
    throw error
  }
  return body as T
}

/**
 * 把失败原因转成展示文本。
 *
 * @param failure 捕获到的任意失败值
 */
export function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
