/**
 * 与 Host 一半的 HTTP 接口。
 *
 * 浏览器只传会话 id 与「是否强制刷新」：当前工作区、lock 读取与 `skills`
 * CLI 全在 Host 完成。路由常量与 `src/routes.ts` 保持一致。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/api
 */

import { requestJson } from '@buka/plugin-ui'

import type { SkillUpdatesSnapshot, SkillUpdatesStatus } from '../types.ts'

/** 与 Host 一致的检查路由。 */
export const CHECK_ROUTE = '/buka-skill-update-check/status'

/** 检查成功时的响应；`ok` 由 `requestJson` 校验。 */
type CheckResponse = SkillUpdatesSnapshot & { readonly ok: true }

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
  const body = await requestJson<CheckResponse>(`${CHECK_ROUTE}?${query}`)
  return {
    ok: true,
    status: statusOf(body.status),
    total: numberOr(body.total, 0),
    updates: namesOf(body.updates),
    checkedAt: numberOr(body.checkedAt, Date.now()),
    ...(typeof body.dir === 'string' ? { dir: body.dir } : {}),
    ...(typeof body.message === 'string' ? { message: body.message } : {}),
  }
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

/** 数字字段的保守读取。 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
