/**
 * Host 路由的请求封装：JSON 请求、POST 动作与附件地址。
 *
 * 所有请求都走界面侧公共包的 `requestJson`（同源、`ok !== true` 即抛错），
 * 信任栅栏由 Host 一半负责。
 */

import { requestJson } from '@buka/plugin-ui'
import { ATTACHMENT_ROUTE } from './types.ts'

export { requestJson }

/**
 * 发一个 POST JSON 请求。
 *
 * @param url 路由地址
 * @param body 已经序列化的请求体对象
 */
export function postJson<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  return requestJson<T>(url, { method: 'POST', body: JSON.stringify(body) })
}

/**
 * 附件地址：作业附件库里的附件 id + `mode`。
 *
 * `mode` 省略即下载；`preview` 取预览元数据 / 文本；`inline` 直接取图片 / PDF
 * 正文。沿用旧附件路由的 mode 语义。
 *
 * @param jobId 作业 id
 * @param attachmentId 附件 id
 * @param [mode] 下载 / 预览 / 内联
 * @returns
 */
export function attachmentUrl(
  jobId: unknown,
  attachmentId: unknown,
  mode?: 'preview' | 'inline',
): string {
  const params = new URLSearchParams({
    jobId: typeof jobId === 'string' ? jobId : '',
    attachmentId: typeof attachmentId === 'string' ? attachmentId : '',
  })
  if (mode === 'preview' || mode === 'inline') params.set('mode', mode)
  return `${ATTACHMENT_ROUTE}?${params.toString()}`
}
