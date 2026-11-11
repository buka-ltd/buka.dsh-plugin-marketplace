/**
 * 仓库树的磁盘缓存：读写、校验、TTL 与串行写队列。
 *
 * 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
 * 按规范化来源（`owner/repo`、本地绝对路径或 git 地址）的小写键存整棵树，TTL
 * 30 分钟；git 来源的克隆目录另由 `src/git-source.ts` 管理。缓存是**可重建的
 * 易失数据**：文件损坏、版本不符或单条结构不合法时都直接当作未命中并重拉重写，
 * 不像收藏文件那样拒绝覆盖。写入仍是原子写（同目录临时文件 + rename），避免
 * 留下半个文件。marketplace 的清单（`.claude-plugin/marketplace.json`）也随
 * 完整树一起缓存，这样「列出市场里有哪些插件」不必重拉：树里没有 skill 的插件
 * 不会建节点，但清单仍在，调用方可以列出它们并给一个空 skill 列表。
 *
 * @module @buka/dsh-plugin-skills/repo/cache
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { writeJsonAtomic } from '@buka/plugin-kit'
import { repoKey } from '../repo-store.ts'
import type { Homes } from '../skill-store.ts'
import { normalizeCachedMarketplace } from './marketplace.ts'
import type { CacheEntry, RepoKind, TreeNode } from './types.ts'

/**
 * 缓存文件格式版本；不匹配的缓存直接丢弃重建（v1 没有 kind / complete，v2 没有
 * marketplace 清单，v3 只认 GitHub 来源，v4 的 npx 树按物理目录分组、与
 * `npx skills` 的清单不一致）。
 */
export const REPO_SKILLS_CACHE_VERSION = 5

/** 缓存有效期：30 分钟。GitHub 的树变化不频繁，过期后按需重拉。 */
export const REPO_SKILLS_CACHE_TTL_MS = 30 * 60 * 1000

/** 合法的仓库分类；与缓存条目的 `kind` 字段同值。 */
const REPO_KINDS: ReadonlySet<string> = new Set([
  'npx-skills',
  'claude-code-marketplace',
  'unavailable',
])

/**
 * 缓存文件的绝对路径。
 *
 * @param homes `resolveHomes()` 的结果
 */
export function repoSkillsCacheFile(homes: Pick<Homes, 'dshHome'>): string {
  return path.join(homes.dshHome, 'buka-skills', 'cache', 'repo-skills.json')
}

/**
 * 读缓存；文件不存在、损坏、版本不符或结构不对都返回空对象。
 *
 * 缓存随时可以重建，所以这里不区分「坏文件」与「没有文件」，也不报错。
 * v1 的缓存没有 `kind` / `complete`，因版本不符自动丢弃并重建。
 */
export async function readCache(file: string): Promise<Record<string, CacheEntry>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const record = parsed as { version?: unknown; entries?: unknown }
  if (record.version !== REPO_SKILLS_CACHE_VERSION) return {}
  if (
    record.entries === null ||
    typeof record.entries !== 'object' ||
    Array.isArray(record.entries)
  ) {
    return {}
  }

  const entries: Record<string, CacheEntry> = {}
  for (const [id, raw] of Object.entries(record.entries as Record<string, unknown>)) {
    const entry = normalizeCacheEntry(raw)
    if (entry === null) continue
    // 键必须就是这份来源的规范化小写值，避免手动改坏的缓存被当成别的仓库。
    if (repoKey(entry.source) !== id) continue
    entries[id] = entry
  }
  return entries
}

/**
 * 校验并复制一条缓存记录；结构不合法时返回 null。
 *
 * 除旧字段外还要求 `kind` 属于三种仓库类型、`complete` 是布尔值：缺字段的
 * v1 形状或手改坏的条目都按未命中处理，整条丢弃。`marketplace` 是 v3 新增的
 * 清单快照：缺失或为 null 视为没有清单（兼容手写的旧形状缓存），存在但不是
 * 合法清单时整条丢弃，避免把损坏数据当成插件列表返回。
 */
function normalizeCacheEntry(raw: unknown): CacheEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.source !== 'string' || record.source === '') return null
  if (typeof record.kind !== 'string' || !REPO_KINDS.has(record.kind)) return null
  if (typeof record.ref !== 'string' || typeof record.sha !== 'string') return null
  if (typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt)) return null
  if (typeof record.truncated !== 'boolean') return null
  if (typeof record.skills !== 'number' || !Number.isInteger(record.skills) || record.skills < 0) {
    return null
  }
  if (typeof record.complete !== 'boolean') return null
  if (!isValidTree(record.root)) return null
  const marketplace = normalizeCachedMarketplace(record.marketplace)
  if (marketplace === null && record.marketplace !== null && record.marketplace !== undefined) {
    return null
  }
  return {
    source: record.source,
    kind: record.kind as RepoKind,
    ref: record.ref,
    sha: record.sha,
    fetchedAt: record.fetchedAt,
    truncated: record.truncated,
    root: record.root,
    skills: record.skills,
    complete: record.complete,
    marketplace,
  }
}

/**
 * 校验缓存里的树结构。缓存可能被手工改过，结构不对就当作未命中重拉。
 */
function isValidTree(root: unknown): root is TreeNode[] {
  if (!Array.isArray(root)) return false
  const stack: Array<{ nodes: unknown[]; depth: number }> = [{ nodes: root, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    const { nodes, depth } = current
    if (depth > 64) return false
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') return false
      const record = node as Record<string, unknown>
      if (typeof record.name !== 'string' || typeof record.path !== 'string') return false
      if (record.type === 'dir') {
        if (!Array.isArray(record.children)) return false
        stack.push({ nodes: record.children, depth: depth + 1 })
      } else if (record.type === 'skill') {
        if (typeof record.description !== 'string') return false
      } else {
        return false
      }
    }
  }
  return true
}

/**
 * 缓存是否仍然有效：`refresh` 已在调用处处理，这里只判断 TTL。
 */
export function isFresh(
  entry: CacheEntry | undefined,
  now: number,
  ttlMs: number,
): entry is CacheEntry {
  if (entry === undefined) return false
  return now - entry.fetchedAt < ttlMs
}

/**
 * 写探测的轻量缓存：目标 id 已有完整树缓存时**不覆盖**。
 *
 * 探测刷新（`refresh: true`）同样遵守这条规则，避免把展开时拿到的完整树降级。
 * 「是否已有完整树」在串行化的读改写里重新判断，因此并发探测不会拿旧快照
 * 覆盖掉刚写进去的完整树。
 */
export async function writeProbeCache(file: string, id: string, entry: CacheEntry): Promise<void> {
  try {
    await updateCache(file, (current) => {
      const existing = current[id]
      if (existing !== undefined && existing.complete === true) return undefined
      return { ...current, [id]: entry }
    })
  } catch {
    // 缓存是可重建的易失数据：写不进去不影响本次探测结论。
  }
}

/**
 * 缓存写队列：同一个缓存文件的「读最新内容 → 改 → 原子写」串行执行。
 *
 * 不加队列时，两个并发探测各自用开始时读到的旧快照整文件重写，后写的会
 * 悄悄丢掉先写的条目。缓存丢了只会多打一次 GitHub，但没必要。
 */
const cacheWrites = new Map<string, Promise<void>>()

/**
 * 串行更新缓存文件。`update` 返回 `undefined` 表示这次不写。
 */
export function updateCache(
  file: string,
  update: (entries: Record<string, CacheEntry>) => Record<string, CacheEntry> | undefined,
): Promise<void> {
  const previous = cacheWrites.get(file) ?? Promise.resolve()
  const run = previous.then(
    async () => {
      const entries = await readCache(file)
      const next = update(entries)
      if (next !== undefined) await writeCache(file, next)
    },
    async () => {
      const entries = await readCache(file)
      const next = update(entries)
      if (next !== undefined) await writeCache(file, next)
    },
  )
  cacheWrites.set(
    file,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

/**
 * 原子重写缓存文件：同目录临时文件 + rename，mode 0600。
 *
 * 只在 `updateCache()` 的串行段里调用，调用方不要直接写文件。
 */
async function writeCache(file: string, entries: Record<string, CacheEntry>): Promise<void> {
  // 缓存目录是插件自己的数据目录：新建时收紧到 0700；文件本身固定 0600。
  await writeJsonAtomic(file, { version: REPO_SKILLS_CACHE_VERSION, entries }, { dirMode: 0o700 })
}
