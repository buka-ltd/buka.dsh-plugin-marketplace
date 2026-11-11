/**
 * 「收藏的来源里有哪些 skills」：拉取、缓存与建树的入口。
 *
 * 页面第二个 Tab 的收藏项可能指向一个包含多个 skill 的仓库，来源可以是 GitHub
 * 仓库、任意 git 远端或本地绝对路径。展开成 tree 的第一步都是拿到「仓库树 +
 * 按仓库内路径读文件」：
 *
 * - GitHub：`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` 拿整棵树，
 *   `https://raw.githubusercontent.com/.../SKILL.md` 拿文件原文；
 * - 任意 git 远端：先 `git clone --depth 1` 到缓存目录（`src/git-source.ts`），
 *   再把克隆目录当本地目录扫描；
 * - 本地绝对路径：直接扫描目录（`src/local-source.ts`）。
 *
 * 三种来源最终都收敛成 `{ tree, readFile }` 的读取抽象（`openRepo()`），后面的
 * 发现规则、分类与建树只认这个抽象，不再关心来源本身。
 *
 * 发现规则与 `npx skills` CLI 的 `findSkillMdPaths()` 保持一致（文件名必须是
 * `SKILL.md`、优先级前缀、container 层级、跳过的目录），**展示方式也照 CLI 的
 * 清单来**：npx 仓库不按仓库的物理目录分组。像 `skills/<bucket>/<skill>/
 * SKILL.md` 这种 catalog 布局，bucket 只对发现有用，CLI 列出来的是扁平的 skill
 * 列表；这里同样把 skill 平铺在根上，只有仓库根的 `.claude-plugin/plugin.json`
 * 或 `.claude-plugin/marketplace.json` 里**显式声明**了某个 skill 目录属于哪个
 * 插件时，才按插件名分组（与 CLI 的 `getPluginGroupings()` 一致）。skill 节点的
 * `path` 仍保留仓库里的完整路径，方便排查。
 *
 * 收藏的仓库有两类，判定顺序固定（用户要求）：先按 `npx skills` 的优先级前缀
 * （标准布局）判定 npx skills 仓库；没命中再看仓库根有没有
 * `.claude-plugin/marketplace.json`，有合法清单就按 Claude Code marketplace
 * 处理，只列各本地插件子树里的 SKILL.md（commands / agents 不列，用户决策），
 * 每个插件一个目录节点；两者都不是时，npx 的兜底规则（任意不超过 6 段的
 * SKILL.md）仍然算 npx skills 仓库；最后才标记为不可用（`repo-unavailable`）。
 * 兜底排在 marketplace 之后，是因为它太宽松：`plugins/<plugin>/skills/<name>/
 * SKILL.md` 正好 5 段，会命中；若它在前，marketplace 永远显示成 npx。判定本身
 * 只看这棵树，不依赖清单文件；npx 仓库展开时才读清单做插件分组，判定不受影响。
 *
 * `probeRepoKind()` 只跑上面这套判定（只拉 tree，必要时拉 marketplace.json），
 * 给收藏卡片显示徽标用，不拉任何 SKILL.md 原文。探测写下的轻量结论用
 * `complete: false` 标记（`root` 固定为 `[]`），展开时才补成完整树。
 *
 * 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
 * 按规范化来源（`owner/repo`、本地绝对路径或 git 地址）的小写键存整棵树，TTL
 * 30 分钟；git 来源的克隆目录另由 `src/git-source.ts` 管理。缓存是**可重建的易失数据**：
 * 文件损坏、版本不符或单条结构不合法时都直接当作未命中并重拉重写，不像收藏
 * 文件那样拒绝覆盖。写入仍是原子写（同目录临时文件 + rename），避免留下半个
 * 文件。SKILL.md 拉取失败只影响那一个节点的名称/描述，不会让整棵树失败。
 * marketplace 的清单（`.claude-plugin/marketplace.json`）也随完整树一起缓存，
 * 这样「列出市场里有哪些插件」不必重拉：树里没有 skill 的插件不会建节点，
 * 但清单仍在，调用方可以列出它们并给一个空 skill 列表。
 *
 * 本模块只做两个入口的编排；实现按职责拆在 `src/repo/` 下：GitHub API
 * （`github.ts`）、来源坐标（`source.ts`）、三种来源的读取抽象（`reader.ts`）、
 * 发现规则与仓库分类（`discovery.ts`）、marketplace 清单（`marketplace.ts`）、
 * 展示分组（`groupings.ts`）、建树（`tree.ts`）、缓存（`cache.ts`）。依赖只有
 * Node 内置模块与这些本地模块，可单独测试；网络、时钟、git 子进程与缓存目录
 * 都从参数注入。
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
import { resolveToken } from './repo/github.ts'
import { openRepo } from './repo/reader.ts'
import { githubRepoOf, originName } from './repo/source.ts'
import { countMarketplaceSkills, loadRepoContent } from './repo/tree.ts'
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

/**
 * 拉取并缓存一个来源的 skill 树。
 *
 * `source` 先经 `classifyRepoSource()` 解析成三种可列出的来源之一：GitHub 仓库、
 * 任意 git 远端、本地绝对路径；`@scope/pkg`、`notion` 与已知不是仓库的网页链接
 * （如 GitHub 子页面）返回 `unsupported-source`。缓存命中时完全不访问来源；
 * GitHub 来源依次尝试 `HEAD`、`main`、`master`，git 来源复用已经克隆的目录。
 *
 * 仓库分类顺序固定：npx skills → Claude Code marketplace → 不可用。用于展示
 * 的目录节点路径已经去掉容器前缀，skill 节点保留完整仓库路径；marketplace
 * 的根节点是「一个插件一个目录」。网络失败、限流、仓库不存在、找不到 git 等
 * 情况都返回 `{ ok: false, code, message }`，不向调用方抛异常；缓存写入失败
 * 则忽略，因为它随时可以重建。
 *
 * 命中探测写下的轻量缓存（`complete: false`）时仍会重新拉一次 tree，把完整树
 * 补进缓存；命中 `kind: 'unavailable'` 且未过期时直接返回 `repo-unavailable`。
 */
export async function fetchRepoSkills({
  homes = resolveHomes(),
  source,
  refresh = false,
  fetchImpl = fetch,
  token,
  now = Date.now(),
  ttlMs = REPO_SKILLS_CACHE_TTL_MS,
  runGit,
}: {
  homes?: Homes
  source?: unknown
  refresh?: boolean
  fetchImpl?: typeof fetch
  token?: string | undefined
  now?: number
  ttlMs?: number
  runGit?: GitRunner | undefined
} = {}): Promise<RepoSkillsResult | RepoSkillsFailure> {
  const request = await resolveTarget({ homes, source, token, now })
  if (request.ok !== true) return request.failure
  const { origin, canonical, timestamp, resolvedToken, file, id, cached } = request

  if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
    if (cached.kind === 'unavailable') return repoUnavailable()
    if (cached.complete === true) return cachedResult(canonical, cached)
    // complete: false 只是探测写下的轻量结论：展开时补一次完整流程并写回完整树。
  }

  const reader = await openRepo({ origin, fetchImpl, token: resolvedToken, homes, runGit })
  if (!reader.ok) return reader

  const classification = await classifyRepo({ tree: reader.tree, reader })
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
    classification,
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
    marketplace:
      classification.kind === 'claude-code-marketplace' ? classification.marketplace : null,
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
    marketplace: entry.marketplace,
  }
}

/**
 * 只探测一个来源属于哪种技能仓库，不拉任何 SKILL.md 原文。
 *
 * 收藏卡片打开后会自动调用它来显示徽标，所以这里只拿 tree（本地路径 / git 克隆
 * 是扫目录，GitHub 是拉 tree），必要时再读一份 `marketplace.json`。失败码与
 * `fetchRepoSkills` 完全一致；判定为不可用时返回 `repo-unavailable`（命中已缓存
 * 的不可用结论时同样不访问来源）。
 *
 * 写缓存总是写轻量条目（`complete: false`，`root: []`），并且**不覆盖**已存在
 * 的完整树缓存：探测刷新不该把展开时拿到的完整数据降级掉。
 */
export async function probeRepoKind({
  homes = resolveHomes(),
  source,
  refresh = false,
  fetchImpl = fetch,
  token,
  now = Date.now(),
  ttlMs = REPO_SKILLS_CACHE_TTL_MS,
  runGit,
}: {
  homes?: Homes
  source?: unknown
  refresh?: boolean
  fetchImpl?: typeof fetch
  token?: string | undefined
  now?: number
  ttlMs?: number
  runGit?: GitRunner | undefined
} = {}): Promise<RepoProbeResult | RepoSkillsFailure> {
  const request = await resolveTarget({ homes, source, token, now })
  if (request.ok !== true) return request.failure
  const { origin, canonical, timestamp, resolvedToken, file, id, cached } = request

  if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
    if (cached.kind === 'unavailable') return repoUnavailable()
    return probeResult(canonical, cached, true)
  }

  const reader = await openRepo({ origin, fetchImpl, token: resolvedToken, homes, runGit })
  if (!reader.ok) return reader

  const classification = await classifyRepo({ tree: reader.tree, reader })
  if ('failure' in classification) return classification.failure

  const kind = classification.kind
  const marketplace =
    classification.kind === 'claude-code-marketplace' ? classification.marketplace : null
  const skills =
    kind === 'unavailable'
      ? 0
      : kind === 'npx-skills'
        ? findSkillMdPaths(reader.tree).length
        : countMarketplaceSkills(reader.tree, marketplace ?? { name: '', plugins: [] })

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
  }
}

/**
 * 校验来源、解析 token 并读缓存：两个入口共用的前半段。
 *
 * 来源种类由 `classifyRepoSource()` 判定：`web` / `package` 直接返回
 * `unsupported-source`（它们没有可列出的仓库树，也没有缓存条目）。
 */
async function resolveTarget({
  homes,
  source,
  token,
  now,
}: {
  homes: Homes
  source: unknown
  token: unknown
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
  const resolvedToken = resolveToken(token)
  const file = repoSkillsCacheFile(homes)
  const entries = await readCache(file)
  const id = repoKey(canonical)
  return {
    ok: true,
    origin,
    canonical,
    timestamp,
    resolvedToken,
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
    marketplace: entry.marketplace ?? null,
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
    marketplace: null,
  }
}

export {
  REPO_SKILLS_CACHE_TTL_MS,
  REPO_SKILLS_CACHE_VERSION,
  repoSkillsCacheFile,
} from './repo/cache.ts'
export { githubRepoOf } from './repo/source.ts'
export type {
  CachedMarketplace,
  CacheEntry,
  DirNode,
  MarketplacePlugin,
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
