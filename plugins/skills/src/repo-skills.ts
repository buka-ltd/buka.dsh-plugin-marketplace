/**
 * 「收藏的来源里有哪些 skills」：拉取、缓存与建树的入口。
 *
 * 收藏只支持仓库根 `skills/` 下（允许任意层级子目录）的 `SKILL.md`：
 *
 * - GitHub 仓库与任意 git 远端：先 `git clone --depth 1` 到 DSH home 下的缓存
 *   目录（`src/git-source.ts`），再把克隆目录当本地目录扫描；
 * - 本地绝对路径：直接扫描目录（`src/local-source.ts`）。
 *
 * 三种来源最终都收敛成 `{ tree, readFile }` 的读取抽象（`openRepo()`），后面的
 * 发现规则与建树只认这个抽象，不再关心来源本身。GitHub 不再调用 API 列树，
 * 所有远端来源走同一条本地浅克隆路径。
 *
 * 刷新克隆失败时保留旧克隆继续展示，并把错误原因作为 `warning` 带上；首次
 * 克隆失败（含找不到 git）才返回错误。
 *
 * 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
 * 按规范化来源（`owner/repo`、本地绝对路径或 git 地址）的小写键存整棵树，TTL
 * 30 分钟。缓存是**可重建的易失数据**：文件损坏、版本不符或单条结构不合法时
 * 都直接当作未命中并重拉重写，不像收藏文件那样拒绝覆盖。写入仍是原子写
 * （同目录临时文件 + rename），避免留下半个文件。
 *
 * 本模块只做两个入口的编排；实现按职责拆在 `src/repo/` 下：来源坐标
 * （`source.ts`）、读取抽象（`reader.ts`）、发现规则与仓库分类
 * （`discovery.ts`）、建树（`tree.ts`）、缓存（`cache.ts`）。依赖只有 Node
 * 内置模块与这些本地模块，可单独测试；时钟、git 子进程与缓存目录都从参数注入。
 *
 * @module @buka/dsh-plugin-skills/repo-skills
 */

import type { GitRunner } from './git-source.ts'
import {
  isFresh,
  REPO_SKILLS_CACHE_TTL_MS,
  readCache,
  repoSkillsCacheFile,
  updateCache,
  writeProbeCache,
} from './repo/cache.ts'
import { classifyRepo, findSkillMdPaths } from './repo/discovery.ts'
import { failure, repoUnavailable } from './repo/failure.ts'
import { openRepo } from './repo/reader.ts'
import { githubRepoOf, originName } from './repo/source.ts'
import { loadRepoContent } from './repo/tree.ts'
import type {
  CacheEntry,
  RepoKind,
  RepoOrigin,
  RepoProbeResult,
  RepoSkillsFailure,
  RepoSkillsResult,
  ResolvedTarget,
} from './repo/types.ts'
import { classifyRepoSource, repoKey } from './repo-store.ts'
import type { Homes } from './skill-store.ts'
import { resolveHomes } from './skill-store.ts'

/** 两个入口共用的入参。 */
export interface RepoSkillsOptions {
  homes?: Homes
  source?: unknown
  refresh?: boolean
  now?: number
  ttlMs?: number
  runGit?: GitRunner | undefined
}

/**
 * 拉取并缓存一个来源的 skill 树。
 *
 * `source` 先经 `classifyRepoSource()` 解析成三种可列出的来源之一：GitHub 仓库、
 * 任意 git 远端、本地绝对路径；`@scope/pkg`、`notion` 与已知不是仓库的网页链接
 * 返回 `unsupported-source`。缓存命中时完全不访问来源。
 *
 * 仓库分类只看树：根 `skills/` 下有 `SKILL.md` 就是标准 npx 仓库，否则不可用
 * （`repo-unavailable`）。网络失败、找不到 git、克隆失败等情况返回
 * `{ ok: false, code, message }`，不向调用方抛异常；缓存写入失败则忽略，因为
 * 它随时可以重建。刷新克隆失败时结果仍成功，并带 `warning`。
 *
 * 命中探测写下的轻量缓存（`complete: false`）时仍会重新拉一次 tree，把完整树
 * 补进缓存；命中 `kind: 'unavailable'` 且未过期时直接返回 `repo-unavailable`。
 */
export async function fetchRepoSkills({
  homes = resolveHomes(),
  source,
  refresh = false,
  now = Date.now(),
  ttlMs = REPO_SKILLS_CACHE_TTL_MS,
  runGit,
}: RepoSkillsOptions = {}): Promise<RepoSkillsResult | RepoSkillsFailure> {
  const request = await resolveTarget({ homes, source, now })
  if (request.ok !== true) return request.failure
  const { origin, canonical, timestamp, file, id, cached } = request

  if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
    if (cached.kind === 'unavailable') return repoUnavailable()
    if (cached.complete === true) return cachedResult(canonical, cached)
    // complete: false 只是探测写下的轻量结论：展开时补一次完整流程并写回完整树。
  }

  const reader = await openRepo({ origin, homes, runGit })
  if (!reader.ok) return reader

  const classification = classifyRepo(reader.tree)
  if ('failure' in classification) return classification.failure

  if (classification.kind === 'unavailable') {
    try {
      await updateCache(file, (current) => ({
        ...current,
        [id]: lightEntry({
          source: canonical,
          kind: 'unavailable',
          tree: reader,
          timestamp,
          skills: 0,
        }),
      }))
    } catch {
      // 缓存是可重建的易失数据：写不进去不影响本次结果，下次再试。
    }
    return repoUnavailable()
  }

  const content = await loadRepoContent({
    tree: reader.tree,
    reader,
    repoName: originName(origin),
  })
  const entry: CacheEntry = {
    source: canonical,
    kind: classification.kind,
    ref: reader.ref,
    sha: reader.sha,
    fetchedAt: timestamp,
    truncated: reader.truncated,
    skills: content.skills,
    complete: true,
    root: content.root,
  }

  try {
    await updateCache(file, (current) => ({ ...current, [id]: entry }))
  } catch {
    // 缓存是可重建的易失数据：写不进去不影响本次结果，下次再试。
  }

  return {
    ok: true,
    source: canonical,
    kind: classification.kind,
    ref: reader.ref,
    sha: reader.sha,
    fetchedAt: timestamp,
    cached: false,
    truncated: reader.truncated,
    root: content.root,
    skills: content.skills,
    ...(reader.warning === undefined ? {} : { warning: reader.warning }),
  }
}

/**
 * 只探测一个来源属于哪种技能仓库，不拉任何 `SKILL.md` 原文。
 *
 * 收藏卡片打开后会自动调用它来显示徽标，所以这里只拿树（远端是浅克隆的
 * 目录扫描、本地路径直接扫描）。失败码与 `fetchRepoSkills` 完全一致；判定为
 * 不可用时返回 `repo-unavailable`（命中已缓存的不可用结论时同样不访问来源）。
 *
 * 写缓存总是写轻量条目（`complete: false`，`root: []`），并且**不覆盖**已存在
 * 的完整树缓存：探测刷新不该把展开时拿到的完整数据降级掉。
 */
export async function probeRepoKind({
  homes = resolveHomes(),
  source,
  refresh = false,
  now = Date.now(),
  ttlMs = REPO_SKILLS_CACHE_TTL_MS,
  runGit,
}: RepoSkillsOptions = {}): Promise<RepoProbeResult | RepoSkillsFailure> {
  const request = await resolveTarget({ homes, source, now })
  if (request.ok !== true) return request.failure
  const { origin, canonical, timestamp, file, id, cached } = request

  if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
    if (cached.kind === 'unavailable') return repoUnavailable()
    return probeResult(canonical, cached, true)
  }

  const reader = await openRepo({ origin, homes, runGit })
  if (!reader.ok) return reader

  const classification = classifyRepo(reader.tree)
  if ('failure' in classification) return classification.failure

  const kind = classification.kind
  const skills = kind === 'unavailable' ? 0 : findSkillMdPaths(reader.tree).length

  await writeProbeCache(
    file,
    id,
    lightEntry({ source: canonical, kind, tree: reader, timestamp, skills }),
  )
  if (kind === 'unavailable') return repoUnavailable()

  return {
    ok: true,
    source: canonical,
    kind,
    skills,
    cached: false,
    ref: reader.ref,
    sha: reader.sha,
    fetchedAt: timestamp,
    truncated: reader.truncated,
    ...(reader.warning === undefined ? {} : { warning: reader.warning }),
  }
}

/**
 * 校验来源并读缓存：两个入口共用的前半段。
 *
 * 来源种类由 `classifyRepoSource()` 判定：`web` / `package` 直接返回
 * `unsupported-source`（它们没有可列出的仓库树，也没有缓存条目）。
 */
async function resolveTarget({
  homes,
  source,
  now,
}: {
  homes: Homes
  source: unknown
  now: unknown
}): Promise<ResolvedTarget> {
  const classified = classifyRepoSource(source)
  if (!classified.ok) {
    return {
      ok: false,
      failure: failure(
        'invalid-source',
        'Invalid source: expected a GitHub owner/repo, a git URL, or an absolute path.',
      ),
    }
  }
  if (classified.listable !== true) {
    return {
      ok: false,
      failure: failure(
        'unsupported-source',
        'Unsupported source: only GitHub repositories, git remotes, and local absolute paths can be listed.',
      ),
    }
  }

  const canonical = classified.source
  let origin: RepoOrigin
  if (classified.kind === 'github') {
    const repo = githubRepoOf(canonical)
    if (repo === null) {
      return {
        ok: false,
        failure: failure('invalid-source', 'Invalid source: expected a GitHub owner/repo.'),
      }
    }
    origin = { kind: 'github', owner: repo.owner, repo: repo.repo }
  } else if (classified.kind === 'local') {
    origin = { kind: 'local', root: canonical }
  } else {
    origin = { kind: 'git', url: canonical }
  }

  const timestamp = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const file = repoSkillsCacheFile(homes)
  const entries = await readCache(file)
  const id = repoKey(canonical)
  return {
    ok: true,
    origin,
    canonical,
    timestamp,
    file,
    entries,
    id,
    cached: entries[id],
  }
}

/**
 * 完整树缓存命中的返回；`kind` 原样带回，调用方不用再探测。
 */
function cachedResult(canonical: string, entry: CacheEntry): RepoSkillsResult {
  return {
    ok: true,
    source: canonical,
    kind: entry.kind,
    ref: entry.ref,
    sha: entry.sha,
    fetchedAt: entry.fetchedAt,
    cached: true,
    truncated: entry.truncated,
    root: entry.root,
    skills: entry.skills,
  }
}

/**
 * 探测缓存的返回；没有 `root`，`skills` 是预计数量。
 */
function probeResult(canonical: string, entry: CacheEntry, cached: boolean): RepoProbeResult {
  return {
    ok: true,
    source: canonical,
    kind: entry.kind,
    skills: entry.skills,
    cached,
    ref: entry.ref,
    sha: entry.sha,
    fetchedAt: entry.fetchedAt,
    truncated: entry.truncated,
  }
}

/**
 * 探测写下的轻量缓存条目：`root` 固定为空，`complete: false`。
 */
function lightEntry({
  source,
  kind,
  tree,
  timestamp,
  skills,
}: {
  source: string
  kind: RepoKind
  tree: { ref: string; sha: string; truncated: boolean }
  timestamp: number
  skills: number
}): CacheEntry {
  return {
    source,
    kind,
    ref: tree.ref,
    sha: tree.sha,
    fetchedAt: timestamp,
    truncated: tree.truncated,
    skills,
    complete: false,
    root: [],
  }
}

export {
  REPO_SKILLS_CACHE_TTL_MS,
  REPO_SKILLS_CACHE_VERSION,
  repoSkillsCacheFile,
} from './repo/cache.ts'
export { githubRepoOf } from './repo/source.ts'
export type {
  CacheEntry,
  DirNode,
  RepoBlobEntry,
  RepoKind,
  RepoOpenResult,
  RepoOrigin,
  RepoProbeResult,
  RepoReader,
  RepoSkillsFailure,
  RepoSkillsFailureCode,
  RepoSkillsResult,
  RepoTreeEntry,
  SkillNode,
  TreeNode,
} from './repo/types.ts'
