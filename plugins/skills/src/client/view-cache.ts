/**
 * 收藏页的本地缓存：展开过哪些仓库、收起了哪些目录、每个仓库上次拿到的树。
 *
 * 放在浏览器 localStorage 里（和 DSH 自己的 `dsh.sessions.current` 等页面状态
 * 同一个 origin），这样关掉 DSH 再打开时能先按上次的样子渲染，不用等 Host
 * 重新拉取仓库。键名沿用 DSH 的 `dsh.` 前缀并带版本号。
 *
 * 缓存是纯页面状态、可重建：所有 localStorage 访问都有兜底（隐私模式 / 配额
 * 满是不能让页面挂掉），形状不对就当没有缓存。
 *
 * @module @buka/dsh-plugin-skills/client/view-cache
 */

import type { RepoTreeData, TreeState, ViewCache } from './types.ts'

/**
 * 收藏页本地缓存的键：展开过哪些仓库、收起了哪些目录、每个仓库上次拿到的
 * skills 树。放在浏览器 localStorage 里（和 DSH 自己的 `dsh.sessions.current`
 * 等页面状态同一个 origin），这样关掉 DSH 再打开时能先按上次的样子渲染，
 * 不用等 Host 重新拉取仓库。键名沿用 DSH 的 `dsh.` 前缀并带版本号。
 */
const VIEW_CACHE_KEY = 'dsh.buka-skills.view.v1'

/**
 * 本地缓存的格式版本；版本不符就当没有缓存，不做迁移。
 *
 * v2：npx 仓库的树改为按 `npx skills` 清单平铺/按插件分组（不再按仓库物理
 * 目录分组），v1 缓存里的旧树形状已经不对，直接丢弃重新拉。
 */
const VIEW_CACHE_VERSION = 2

/**
 * 取 localStorage；隐私模式、没有 window 或 storage 被禁用时返回 null。
 * 缓存是可重建的页面状态，任何访问失败都不该让页面挂掉。
 */
function viewStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * 读收藏页的本地缓存。
 *
 * 形状不对、版本不符、JSON 坏了都直接当没有缓存：这里只恢复「看起来对」
 * 的状态，不尝试修数据。树的校验只到 `root` 是数组为止，渲染层本来就容忍
 * 缺字段（描述、children 都有兜底）。
 */
function readViewCache(): ViewCache | null {
  const storage = viewStorage()
  if (storage === null) return null
  let raw: string | null
  try {
    raw = storage.getItem(VIEW_CACHE_KEY)
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
  const record = parsed as {
    version?: unknown
    expanded?: unknown
    collapsedDirs?: unknown
    trees?: unknown
  }
  if (record.version !== VIEW_CACHE_VERSION) return null

  const expandedRepos: Record<string, true> = {}
  if (Array.isArray(record.expanded)) {
    for (const id of record.expanded) {
      if (typeof id === 'string' && id !== '') expandedRepos[id] = true
    }
  }

  const collapsedDirs: Record<string, Record<string, true>> = {}
  if (
    record.collapsedDirs !== null &&
    typeof record.collapsedDirs === 'object' &&
    !Array.isArray(record.collapsedDirs)
  ) {
    for (const [id, dirs] of Object.entries(record.collapsedDirs as Record<string, unknown>)) {
      if (dirs === null || typeof dirs !== 'object' || Array.isArray(dirs)) continue
      const kept: Record<string, true> = {}
      for (const [dir, collapsed] of Object.entries(dirs as Record<string, unknown>)) {
        if (collapsed === true) kept[dir] = true
      }
      if (Object.keys(kept).length > 0) collapsedDirs[id] = kept
    }
  }

  const trees: Record<string, TreeState> = {}
  if (record.trees !== null && typeof record.trees === 'object' && !Array.isArray(record.trees)) {
    for (const [id, data] of Object.entries(record.trees as Record<string, unknown>)) {
      if (
        data === null ||
        typeof data !== 'object' ||
        !Array.isArray((data as { root?: unknown }).root)
      ) {
        continue
      }
      trees[id] = { status: 'ready', data: data as RepoTreeData, error: null }
    }
  }

  return { expandedRepos, collapsedDirs, trees }
}

/**
 * 写收藏页的本地缓存。
 *
 * 只缓存当前展开着的仓库的树：收起的卡片重开 DSH 后仍按原来的路径重新取，
 * 不会拿一份旧树冒充新数据；恢复出来的展开卡片也一定带内容，不会展开成
 * 一片空白。配额写不下时直接丢掉整份缓存——下次打开只是回到默认的收起
 * 状态，不影响功能。
 */
function writeViewCache({
  expandedRepos,
  collapsedDirs,
  trees,
}: {
  expandedRepos: Record<string, true>
  collapsedDirs: Record<string, Record<string, true>>
  trees: Record<string, TreeState>
}): void {
  const storage = viewStorage()
  if (storage === null) return

  const cachedTrees: Record<string, RepoTreeData> = {}
  for (const [id, state] of Object.entries(trees)) {
    if (expandedRepos[id] !== true) continue
    if (state?.data === null || state?.data === undefined) continue
    cachedTrees[id] = state.data
  }
  // 没有树就不恢复展开：否则重开 DSH 会看到一张「展开着但什么都没有」的卡片。
  const expanded = Object.keys(expandedRepos).filter(
    (id) => expandedRepos[id] === true && cachedTrees[id] !== undefined,
  )
  const cachedCollapsed: Record<string, Record<string, true>> = {}
  for (const id of expanded) {
    const dirs = collapsedDirs[id]
    if (dirs !== undefined) cachedCollapsed[id] = dirs
  }

  const remove = (): void => {
    try {
      storage.removeItem(VIEW_CACHE_KEY)
    } catch {
      // 缓存删不掉也不影响页面。
    }
  }
  if (expanded.length === 0) {
    remove()
    return
  }

  const payload = {
    version: VIEW_CACHE_VERSION,
    expanded,
    collapsedDirs: cachedCollapsed,
    trees: cachedTrees,
  }
  try {
    storage.setItem(VIEW_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // 配额不够（树最占地方）：整份缓存丢掉，下次打开回到默认收起状态。
    remove()
  }
}

export { readViewCache, writeViewCache }
