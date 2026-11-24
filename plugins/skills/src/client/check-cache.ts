/**
 * 全局技能检查结果的本地缓存：上一次检查出的「有更新 / 已是最新 / ...」按行存
 * 下来，页面重新打开时先按这份结果渲染，再在后台静默重查。
 *
 * 检查是静默的：页面上没有「检查中…」一类的进度提示，所以状态标记必须能先
 * 从缓存里恢复出来，否则每次重开都要等 Host 跑完 `skills check` 才看得到。
 * 缓存放在浏览器 localStorage 里（和 DSH 自己的 `dsh.sessions.current` 等页面
 * 状态同一个 origin），键名沿用 `dsh.` 前缀并带版本号。
 *
 * 缓存是纯页面状态、可重建：所有 localStorage 访问都有兜底（隐私模式 / 配额
 * 满不能让页面挂掉），形状不对就当没有缓存；每次检查 / 更新后写回最新结果。
 *
 * @module @buka/dsh-plugin-skills/client/check-cache
 */

import type { SkillCheckEntry } from './types.ts'

/** 检查结果缓存的键。 */
const CHECK_CACHE_KEY = 'dsh.buka-skills.checks.v1'

/** 缓存格式版本；版本不符就当没有缓存，不做迁移。 */
const CHECK_CACHE_VERSION = 1

/** 检查结果只有一个已知字段需要校验：状态字符串。 */
function isCheckEntry(value: unknown): value is SkillCheckEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof (value as { status?: unknown }).status === 'string'
}

/**
 * 取 localStorage；隐私模式、没有 window 或 storage 被禁用时返回 null。
 * 缓存是可重建的页面状态，任何访问失败都不该让页面挂掉。
 */
function checkStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * 读上一次的检查结果；没有缓存、版本不符或结构不对时返回 null。
 *
 * 只保留形状合法的条目：状态标签的渲染本来就容忍缺字段（来源、说明都可选），
 * 但一条没有 `status` 的记录没有任何用处。
 */
function readCheckCache(): Record<string, SkillCheckEntry> | null {
  const storage = checkStorage()
  if (storage === null) return null
  let raw: string | null
  try {
    raw = storage.getItem(CHECK_CACHE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const record = parsed as { version?: unknown; results?: unknown }
  if (record.version !== CHECK_CACHE_VERSION) return null
  if (
    record.results === null ||
    typeof record.results !== 'object' ||
    Array.isArray(record.results)
  ) {
    return null
  }

  const results: Record<string, SkillCheckEntry> = {}
  for (const [key, value] of Object.entries(record.results as Record<string, unknown>)) {
    if (key !== '' && isCheckEntry(value)) results[key] = value
  }
  return results
}

/**
 * 写回检查结果；结果为空时删掉缓存，避免留下一份过期的空记录。
 *
 * 配额写不下时直接丢掉整份缓存——下次打开只是先没有状态标记，不影响功能。
 */
function writeCheckCache(results: Record<string, SkillCheckEntry>): void {
  const storage = checkStorage()
  if (storage === null) return

  const keys = Object.keys(results)
  if (keys.length === 0) {
    try {
      storage.removeItem(CHECK_CACHE_KEY)
    } catch {
      // 缓存删不掉也不影响页面。
    }
    return
  }

  try {
    storage.setItem(CHECK_CACHE_KEY, JSON.stringify({ version: CHECK_CACHE_VERSION, results }))
  } catch {
    try {
      storage.removeItem(CHECK_CACHE_KEY)
    } catch {
      // 配额满时清缓存也可能失败，忽略即可。
    }
  }
}

export { readCheckCache, writeCheckCache }
