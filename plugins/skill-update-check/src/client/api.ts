/**
 * 与 Host 一半的 HTTP 接口。
 *
 * 浏览器只传会话 id、`refresh=1` 与要更新的 skill 名：当前工作区、lock 读取、
 * `skills` CLI 的检查与更新全在 Host 完成。路由常量与 `src/routes.ts` 保持一致。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/api
 */

import { messageOf, requestJson } from '@buka/plugin-ui'

import type {
  SkillUpdateFailureItem,
  SkillUpdateReport,
  SkillUpdatesSnapshot,
  SkillUpdatesStatus,
} from '../types.ts'

/** 与 Host 一致的检查路由。 */
export const CHECK_ROUTE = '/buka-skill-update-check/status'

/** 与 Host 一致的更新路由。 */
export const UPDATE_ROUTE = '/buka-skill-update-check/update'

/**
 * 检查一个会话所在工作区的项目技能。
 *
 * @param sessionId 会话 id
 * @param refresh 是否跳过 Host 的 5 分钟缓存
 * @returns 检查结果
 */
export async function readSkillUpdates(
  sessionId: string,
  refresh = false,
): Promise<SkillUpdatesSnapshot> {
  const query = `sessionId=${encodeURIComponent(sessionId)}${refresh ? '&refresh=1' : ''}`
  const body = await requestJson<unknown>(`${CHECK_ROUTE}?${query}`)
  return snapshotOf(body)
}

/**
 * 更新一个会话所在工作区的项目技能。
 *
 * 省略 `skills` 表示更新检查得到的全部；单个 skill 失败不会让请求抛错，
 * 失败项在响应的 `failed` 里。
 *
 * @param sessionId 会话 id
 * @param skills 要更新的 skill 名；省略表示全部
 * @returns 更新报告，其中 `snapshot` 是更新后的检查结果
 */
export async function updateSkillUpdates(
  sessionId: string,
  skills?: readonly string[],
): Promise<SkillUpdateReport> {
  const body = await requestJson<unknown>(UPDATE_ROUTE, {
    method: 'POST',
    body: JSON.stringify({ sessionId, ...(skills === undefined ? {} : { skills }) }),
  })
  const record = recordOf(body)
  return {
    ok: true,
    updated: namesOf(record.updated),
    failed: failuresOf(record.failed),
    snapshot: snapshotOf(record.snapshot),
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
  }
}

/**
 * 把请求错误和它附带的 CLI 输出尾部合成一行可展示文本。
 *
 * @param error 捕获到的请求错误
 */
export function failureText(error: unknown): string {
  const message = messageOf(error)
  const output = (error as { readonly output?: unknown } | null | undefined)?.output
  if (typeof output !== 'string') return message
  const line = output.trim().split(/\r?\n/u).at(-1)?.trim() ?? ''
  return line === '' ? message : `${message} ${line}`
}

/** 把未知值收窄成记录；数组与原始值按空记录处理。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 把响应里的快照字段逐项收窄；缺失或类型不对时退回保守值。 */
function snapshotOf(value: unknown): SkillUpdatesSnapshot {
  const body = recordOf(value)
  const modified = namesOf(body.modified)
  const sources = sourcesOf(body.sources)
  return {
    ok: true,
    status: statusOf(body.status),
    total: numberOr(body.total, 0),
    updates: namesOf(body.updates),
    ...(modified.length === 0 ? {} : { modified }),
    ...(Object.keys(sources).length === 0 ? {} : { sources }),
    checkedAt: numberOr(body.checkedAt, Date.now()),
    ...(typeof body.message === 'string' ? { message: body.message } : {}),
  }
}

/** 只保留「skill 名 → 非空来源」的条目。 */
function sourcesOf(value: unknown): Record<string, string> {
  const sources: Record<string, string> = {}
  for (const [name, source] of Object.entries(recordOf(value))) {
    if (name.trim() === '' || typeof source !== 'string' || source.trim() === '') continue
    sources[name] = source.trim()
  }
  return sources
}

/** 把响应里的状态收窄到已知值；未知值按不可用处理，不显示提示。 */
function statusOf(value: unknown): SkillUpdatesStatus {
  return value === 'updates' ||
    value === 'up-to-date' ||
    value === 'no-project-skills' ||
    value === 'unavailable'
    ? value
    : 'unavailable'
}

/** 只保留响应里的非空字符串 skill 名。 */
function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (name !== '') names.push(name)
  }
  return names
}

/** 把响应里的失败项收窄成 `{ name, message }`，跳过结构不对的条目。 */
function failuresOf(value: unknown): SkillUpdateFailureItem[] {
  if (!Array.isArray(value)) return []
  const failures: SkillUpdateFailureItem[] = []
  for (const item of value) {
    const record = recordOf(item)
    if (typeof record.name !== 'string' || record.name.trim() === '') continue
    failures.push({
      name: record.name.trim(),
      message: typeof record.message === 'string' ? record.message : '',
    })
  }
  return failures
}

/** 数字字段的保守读取。 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
