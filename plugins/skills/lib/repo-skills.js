/**
 * 「收藏的来源里有哪些 skills」：拉取、缓存与建树。
 *
 * 页面第二个 Tab 的收藏项可能指向一个包含多个 skill 的仓库，来源可以是 GitHub
 * 仓库、任意 git 远端或本地绝对路径。展开成 tree 的第一步都是拿到「仓库树 +
 * 按仓库内路径读文件」：
 *
 * - GitHub：`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` 拿整棵树，
 *   `https://raw.githubusercontent.com/.../SKILL.md` 拿文件原文；
 * - 任意 git 远端：先 `git clone --depth 1` 到缓存目录（`lib/git-source.js`），
 *   再把克隆目录当本地目录扫描；
 * - 本地绝对路径：直接扫描目录（`lib/local-source.js`）。
 *
 * 三种来源最终都收敛成 `{ tree, readFile }` 的读取抽象（`openRepo()`），后面的
 * 发现规则、分类与建树只认这个抽象，不再关心来源本身。
 *
 * 发现规则与 `npx skills` CLI 的 `findSkillMdPaths()` 保持一致（优先级前缀、
 * container 层级、跳过的目录），只是额外记住命中哪个优先级前缀，用它把展示
 * 路径上的容器目录（如 `skills/`）剥掉。展示路径用于建 tree，skill 节点的
 * `path` 仍保留仓库里的完整路径，方便排查。
 *
 * 收藏的仓库有两类，判定顺序固定（用户要求）：先按 `npx skills` 的优先级前缀
 * （标准布局）判定 npx skills 仓库；没命中再看仓库根有没有
 * `.claude-plugin/marketplace.json`，有合法清单就按 Claude Code marketplace
 * 处理，只列各本地插件子树里的 SKILL.md（commands / agents 不列，用户决策），
 * 每个插件一个目录节点；两者都不是时，npx 的兜底规则（任意不超过 6 段的
 * SKILL.md）仍然算 npx skills 仓库；最后才标记为不可用（`repo-unavailable`）。
 * 兜底排在 marketplace 之后，是因为它太宽松：`plugins/<plugin>/skills/<name>/
 * SKILL.md` 正好 5 段，会命中；若它在前，marketplace 永远显示成 npx。
 *
 * `probeRepoKind()` 只跑上面这套判定（只拉 tree，必要时拉 marketplace.json），
 * 给收藏卡片显示徽标用，不拉任何 SKILL.md 原文。探测写下的轻量结论用
 * `complete: false` 标记（`root` 固定为 `[]`），展开时才补成完整树。
 *
 * 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
 * 按规范化来源（`owner/repo`、本地绝对路径或 git 地址）的小写键存整棵树，TTL
 * 30 分钟；git 来源的克隆目录另由 `lib/git-source.js` 管理。缓存是**可重建的易失数据**：
 * 文件损坏、版本不符或单条结构不合法时都直接当作未命中并重拉重写，不像收藏
 * 文件那样拒绝覆盖。写入仍是原子写（同目录临时文件 + rename），避免留下半个
 * 文件。SKILL.md 拉取失败只影响那一个节点的名称/描述，不会让整棵树失败。
 * marketplace 的清单（`.claude-plugin/marketplace.json`）也随完整树一起缓存，
 * 这样「列出市场里有哪些插件」不必重拉：树里没有 skill 的插件不会建节点，
 * 但清单仍在，调用方可以列出它们并给一个空 skill 列表。
 *
 * 本模块只依赖 Node 内置模块，可单独测试；网络、时钟、git 子进程与缓存目录都
 * 从参数注入。
 *
 * @module @buka/dsh-plugin-skills/repo-skills
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ensureGitClone } from './git-source.js'
import { openLocalRepo } from './local-source.js'
import { MAX_SOURCE_LENGTH, classifyRepoSource, repoKey } from './repo-store.js'
import { parseFrontmatter, resolveHomes } from './skill-store.js'

/**
 * @typedef {{ type: 'dir', name: string, path: string, children: TreeNode[] }} DirNode
 * @typedef {{ type: 'skill', name: string, path: string, description: string }} SkillNode
 * @typedef {DirNode | SkillNode} TreeNode
 * @typedef {'npx-skills' | 'claude-code-marketplace' | 'unavailable'} RepoKind
 * @typedef {(args: string[], options?: { cwd?: string }) => Promise<{ stdout: string, stderr: string }>} GitRunner
 * @typedef {{
 *   source: string, kind: RepoKind, ref: string, sha: string, fetchedAt: number,
 *   truncated: boolean, skills: number, complete: boolean, root: TreeNode[],
 *   marketplace: CachedMarketplace | null,
 * }} CacheEntry
 * @typedef {{ name: string, root: string, description: string }} MarketplacePlugin
 * @typedef {{ name: string, plugins: MarketplacePlugin[] }} CachedMarketplace
 * @typedef {{ kind: 'github', owner: string, repo: string }
 *   | { kind: 'local', root: string }
 *   | { kind: 'git', url: string }} RepoOrigin
 */

/**
 * 缓存文件格式版本；不匹配的缓存直接丢弃重建（v1 没有 kind / complete，v2 没有
 * marketplace 清单，v3 只认 GitHub 来源，来源种类变化后 v3 条目不再可信）。
 */
export const REPO_SKILLS_CACHE_VERSION = 4

/** 缓存有效期：30 分钟。GitHub 的树变化不频繁，过期后按需重拉。 */
export const REPO_SKILLS_CACHE_TTL_MS = 30 * 60 * 1000

/** 依次尝试的分支。很多仓库没有 `main`，所以先问 `HEAD`。 */
const BRANCHES = ['HEAD', 'main', 'master']

/** GitHub API 的请求超时。 */
const TREE_TIMEOUT_MS = 10_000

/** raw.githubusercontent.com 上单个文件的请求超时；失败只影响一个节点。 */
const RAW_TIMEOUT_MS = 8_000

/** Claude Code marketplace 清单在仓库里的固定路径。 */
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json'

/** 合法的仓库分类；与缓存条目的 `kind` 字段同值。 */
const REPO_KINDS = new Set(['npx-skills', 'claude-code-marketplace', 'unavailable'])

/** 插件 root 相对路径的最大长度，防止有人把整篇文档贴进来。 */
const MAX_PLUGIN_ROOT_LENGTH = 300

/** marketplace 插件名的格式；与 Claude Code 的插件命名规则一致。 */
const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u

/** 控制字符（含换行、制表符）不允许出现在路径里。 */
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u

/** 同时拉取 SKILL.md 的并发上限，避免一次打开几十个连接。 */
const SKILL_MD_CONCURRENCY = 6

/**
 * 优先级前缀，顺序必须与 `npx skills` CLI 的 `PRIORITY_PREFIXES` 一致：
 * 越靠前的容器目录越优先；空串表示「根目录或一层目录」。
 */
const PRIORITY_PREFIXES = [
  '',
  'skills/',
  'skills/.curated/',
  'skills/.experimental/',
  'skills/.system/',
  '.agents/skills/',
  '.claude/skills/',
  '.cline/skills/',
  '.codebuddy/skills/',
  '.codex/skills/',
  '.commandcode/skills/',
  '.continue/skills/',
  '.factory/skills/',
  '.github/skills/',
  '.goose/skills/',
  '.grok/skills/',
  '.iflow/skills/',
  '.junie/skills/',
  '.kilo/skills/',
  '.kilocode/skills/',
  '.kimchi/skills/',
  '.kiro/skills/',
  '.minimax/skills/',
  '.mux/skills/',
  '.neovate/skills/',
  '.opencode/skills/',
  '.openhands/skills/',
  '.pi/skills/',
  '.posit/assistant/skills/',
  '.qoder/skills/',
  '.roo/skills/',
  '.trae/skills/',
  '.windsurf/skills/',
  '.zcode/skills/',
  '.zencoder/skills/',
]

/** 与 CLI 相同的跳过目录，只在 container 下的嵌套候选里生效。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])

/** GitHub 用户名/组织名的粗略校验（足够挡住路径与作用域包名）。 */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** GitHub 仓库名的粗略校验。 */
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/u

/**
 * 缓存文件的绝对路径。
 *
 * @param {{ dshHome: string }} homes `resolveHomes()` 的结果
 * @returns {string}
 */
export function repoSkillsCacheFile(homes) {
  return path.join(homes.dshHome, 'buka-skills', 'cache', 'repo-skills.json')
}

/**
 * 从任意来源字符串里取出 GitHub 仓库。
 *
 * 接受 `owner/repo`、`github.com/owner/repo` 与 `https://github.com/owner/repo`
 * （可带 `www.`、`.git` 与结尾斜杠，GitHub 子页面链接按前两段取仓库）。
 * 作用域 npm 包（`@scope/pkg`）、普通包名（`notion`）与其它站点的链接返回 null。
 *
 * @param {unknown} source 任意来源字符串
 * @returns {{ owner: string, repo: string } | null}
 */
export function githubRepoOf(source) {
  if (typeof source !== 'string') return null
  const text = source.trim()
  if (text === '' || text.length > MAX_SOURCE_LENGTH) return null

  if (/^https?:\/\//iu.test(text)) {
    let url
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null
    return splitRepo(url.pathname)
  }

  const bare = /^(?:www\.)?github\.com\/(.+)$/iu.exec(text)
  if (bare !== null) return splitRepo(bare[1])

  if (text.split('/').length !== 2) return null
  return splitRepo(text)
}

/**
 * 从 `owner/repo[/...]` 里取前两段并校验；末尾的 `.git` 去掉。
 *
 * @param {string} text
 * @returns {{ owner: string, repo: string } | null}
 */
function splitRepo(text) {
  const segments = text.split('/').filter((segment) => segment !== '')
  if (segments.length < 2) return null
  const owner = segments[0]
  let repo = segments[1]
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4)
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return null
  return { owner, repo }
}

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
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   source?: unknown,
 *   refresh?: boolean,
 *   fetchImpl?: typeof fetch,
 *   token?: string,
 *   now?: number,
 *   ttlMs?: number,
 *   runGit?: GitRunner,
 * }} [options]
 * @returns {Promise<
 *   | { ok: true, source: string, kind: RepoKind, ref: string, sha: string,
 *       fetchedAt: number, cached: boolean, truncated: boolean, root: TreeNode[], skills: number,
 *       marketplace: CachedMarketplace | null }
 *   | { ok: false, code: 'invalid-source' | 'unsupported-source' | 'repo-not-found' | 'rate-limited' | 'fetch-failed' | 'repo-unavailable' | 'git-unavailable' | 'git-failed', message: string }
 * >}
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
} = {}) {
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
  if (classification.failure !== undefined) return classification.failure

  if (classification.kind === 'unavailable') {
    try {
      await updateCache(file, (current) => ({
        ...current,
        [id]: lightEntry({ source: canonical, kind: 'unavailable', tree: reader, timestamp, skills: 0 }),
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
  const entry = {
    source: canonical,
    kind: classification.kind,
    ref: reader.ref,
    sha: reader.sha,
    fetchedAt: timestamp,
    truncated: reader.truncated,
    skills: content.skills,
    complete: true,
    root: content.root,
    marketplace: classification.kind === 'claude-code-marketplace' ? classification.marketplace : null,
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
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   source?: unknown,
 *   refresh?: boolean,
 *   fetchImpl?: typeof fetch,
 *   token?: string,
 *   now?: number,
 *   ttlMs?: number,
 *   runGit?: GitRunner,
 * }} [options]
 * @returns {Promise<
 *   | { ok: true, source: string, kind: RepoKind, skills: number, cached: boolean,
 *       ref: string, sha: string, fetchedAt: number, truncated: boolean }
 *   | { ok: false, code: 'invalid-source' | 'unsupported-source' | 'repo-not-found' | 'rate-limited' | 'fetch-failed' | 'repo-unavailable' | 'git-unavailable' | 'git-failed', message: string }
 * >}
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
} = {}) {
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
  if (classification.failure !== undefined) return classification.failure

  const kind = classification.kind
  const skills =
    kind === 'unavailable'
      ? 0
      : kind === 'npx-skills'
        ? findSkillMdPaths(reader.tree).length
        : countMarketplaceSkills(reader.tree, classification.marketplace)

  await writeProbeCache(file, id, lightEntry({ source: canonical, kind, tree: reader, timestamp, skills }))
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
 *
 * @param {{
 *   homes: { agentsHome: string, dshHome: string },
 *   source: unknown,
 *   token: unknown,
 *   now: unknown,
 * }} options
 * @returns {Promise<
 *   | { ok: true, origin: RepoOrigin, canonical: string, timestamp: number,
 *       resolvedToken: string | null, file: string, entries: Record<string, CacheEntry>,
 *       id: string, cached: CacheEntry | undefined }
 *   | { ok: false, failure: { ok: false, code: string, message: string } }
 * >}
 */
async function resolveTarget({ homes, source, token, now }) {
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
  let origin
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
  return { ok: true, origin, canonical, timestamp, resolvedToken, file, entries, id, cached: entries[id] }
}

/**
 * 完整树缓存命中的返回；`kind` 原样带回，调用方不用再探测。
 *
 * @param {string} canonical
 * @param {CacheEntry} entry
 * @returns {{ ok: true, source: string, kind: RepoKind, ref: string, sha: string,
 *   fetchedAt: number, cached: true, truncated: boolean, root: TreeNode[], skills: number,
 *   marketplace: CachedMarketplace | null }}
 */
function cachedResult(canonical, entry) {
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
 *
 * @param {string} canonical
 * @param {CacheEntry} entry
 * @param {boolean} cached
 * @returns {{ ok: true, source: string, kind: RepoKind, skills: number, cached: boolean,
 *   ref: string, sha: string, fetchedAt: number, truncated: boolean }}
 */
function probeResult(canonical, entry, cached) {
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
 *
 * @param {{
 *   source: string,
 *   kind: RepoKind,
 *   tree: { ref: string, sha: string, truncated: boolean },
 *   timestamp: number,
 *   skills: number,
 * }} options
 * @returns {CacheEntry}
 */
function lightEntry({ source, kind, tree, timestamp, skills }) {
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

/**
 * 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
 *
 * GitHub 用 API 拉树、raw.githubusercontent.com 读文件；git 来源先浅克隆到缓存
 * 目录再当本地目录扫描；本地来源直接扫描目录。
 *
 * 走到这里说明磁盘缓存没有命中（过期，或只有一条轻量探测结论），所以三种来源
 * 都重新读一次最新内容：GitHub 重拉 tree、本地路径重扫目录、git 来源先
 * `git fetch` 更新克隆（离线时 `ensureGitClone` 保留旧克隆）。
 *
 * @param {{
 *   origin: RepoOrigin,
 *   fetchImpl: typeof fetch,
 *   token: string | null,
 *   homes: { agentsHome: string, dshHome: string },
 *   runGit?: GitRunner,
 * }} options
 * @returns {Promise<
 *   | { ok: true, ref: string, sha: string, truncated: boolean, tree: unknown[],
 *       readFile: (repoPath: string) => Promise<string | null> }
 *   | { ok: false, code: string, message: string }
 * >}
 */
async function openRepo({ origin, fetchImpl, token, homes, runGit }) {
  if (origin.kind === 'github') {
    const tree = await fetchRepoTree({ owner: origin.owner, repo: origin.repo, token, fetchImpl })
    if (!tree.ok) return tree
    return {
      ok: true,
      ref: tree.ref,
      sha: tree.sha,
      truncated: tree.truncated,
      tree: tree.tree,
      readFile: createGithubReader({
        owner: origin.owner,
        repo: origin.repo,
        ref: tree.ref,
        token,
        fetchImpl,
      }),
    }
  }

  if (origin.kind === 'local') return openLocalRepo(origin.root)

  // 只有缓存未命中时才会调用本函数，所以每次读都顺手更新克隆；fetch 失败时
  // `ensureGitClone` 保留旧克隆，离线仍能展开。
  const cloned = await ensureGitClone({ homes, url: origin.url, runGit, update: true })
  if (!cloned.ok) return cloned
  const opened = await openLocalRepo(cloned.dir)
  if (!opened.ok) return opened
  return {
    ok: true,
    // 克隆目录是某个提交的工作区快照；ref 固定写 HEAD，sha 来自 rev-parse。
    ref: 'HEAD',
    sha: cloned.sha,
    truncated: opened.truncated,
    tree: opened.tree,
    readFile: opened.readFile,
  }
}

/**
 * GitHub 的 `readFile`：从 raw.githubusercontent.com 取文件原文。
 *
 * 网络异常、超时与任何非 2xx 都返回 null（对调用方就是「这个文件读不到」）：
 * SKILL.md 读不到只影响一个节点的元数据，marketplace 清单读不到则由分类函数
 * 升级成 `fetch-failed`。
 *
 * @param {{ owner: string, repo: string, ref: string, token: string | null, fetchImpl: typeof fetch }} options
 * @returns {(repoPath: string) => Promise<string | null>}
 */
function createGithubReader({ owner, repo, ref, token, fetchImpl }) {
  return async function readFile(repoPath) {
    const segments = repoPath.split('/').map((segment) => encodeURIComponent(segment))
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${segments.join('/')}`
    try {
      const response = await fetchImpl(url, {
        headers: rawHeaders(token),
        signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
      })
      if (!response?.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }
}

/**
 * 来源的展示名：只给根目录 SKILL.md 的节点名兜底（没有 frontmatter name 时）。
 *
 * @param {RepoOrigin} origin
 * @returns {string}
 */
function originName(origin) {
  if (origin.kind === 'github') return origin.repo
  if (origin.kind === 'local') {
    const base = path.basename(origin.root)
    return base === '' ? origin.root : base
  }
  // git 地址取最后一段：`.../group/repo.git` 与 `git@host:group/repo.git` 都适用。
  const stripped = origin.url.replace(/\/+$/u, '').replace(/\.git$/iu, '')
  const parts = stripped.split(/[/:]/u).filter((part) => part !== '')
  const segment = parts.at(-1)
  return segment === undefined ? origin.url : segment
}

/**
 * 按分类结果把仓库内容拉成可展示的树；只用于完整展开，探测不需要。
 *
 * SKILL.md 元数据走同一个 `reader.readFile()`：本地 / git 来源因此不碰网络，
 * GitHub 来源仍是 raw 请求 + frontmatter 解析 + 6 并发。
 *
 * @param {{
 *   tree: unknown[],
 *   reader: { readFile: (repoPath: string) => Promise<string | null> },
 *   classification: { kind: 'npx-skills' } | { kind: 'claude-code-marketplace', marketplace: { plugins: MarketplacePlugin[] } },
 *   repoName: string,
 * }} options
 * @returns {Promise<{ root: TreeNode[], skills: number }>}
 */
async function loadRepoContent({ tree, reader, classification, repoName }) {
  if (classification.kind === 'npx-skills') {
    const discovered = findSkillMdPaths(tree)
    const metadata = await mapLimit(discovered, SKILL_MD_CONCURRENCY, (entry) =>
      readSkillMetadata(entry, reader),
    )
    return { root: buildTree(metadata, repoName), skills: metadata.length }
  }

  const groups = collectMarketplaceSkills(tree, classification.marketplace)
  const paths = groups.flatMap((group) => group.skills.map((skill) => skill.path))
  const fetched = await mapLimit(paths, SKILL_MD_CONCURRENCY, (skillPath) =>
    readSkillFile(reader, skillPath),
  )
  const metas = new Map()
  paths.forEach((skillPath, index) => metas.set(skillPath, fetched[index]))
  return { root: buildMarketplaceTree(groups, metas), skills: paths.length }
}

/**
 * 解析 token：显式参数优先，缺省时读 `GITHUB_TOKEN` / `GH_TOKEN`；
 * 空串按「没有 token」处理，避免发出空的 Authorization 头。
 *
 * @param {unknown} provided `fetchRepoSkills` 的 `token` 选项
 * @returns {string | null}
 */
function resolveToken(provided) {
  if (provided !== undefined) {
    if (typeof provided !== 'string') return null
    const text = provided.trim()
    return text === '' ? null : text
  }
  for (const value of [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text !== '') return text
  }
  return null
}

/**
 * 按分支顺序拉取递归树。
 *
 * 404 只意味着这个分支不存在，继续试下一个；403 且额度用尽立即返回
 * `rate-limited`；其它非 2xx、网络异常、JSON 解析失败或没有 `tree` 数组
 * 都直接返回 `fetch-failed`，不再浪费后续分支的请求。
 *
 * @param {{ owner: string, repo: string, token: string | null, fetchImpl: typeof fetch }} options
 * @returns {Promise<
 *   | { ok: true, ref: string, sha: string, truncated: boolean, tree: unknown[] }
 *   | { ok: false, code: string, message: string }
 * >}
 */
async function fetchRepoTree({ owner, repo, token, fetchImpl }) {
  for (const branch of BRANCHES) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    let response
    try {
      response = await fetchImpl(url, {
        headers: apiHeaders(token),
        signal: AbortSignal.timeout(TREE_TIMEOUT_MS),
      })
    } catch (error) {
      return failure('fetch-failed', `GitHub tree request failed: ${errorText(error)}`)
    }

    if (response?.status === 404) continue
    if (response?.status === 403 && response.headers?.get('x-ratelimit-remaining') === '0') {
      return failure('rate-limited', 'GitHub API rate limit exhausted; retry later or set GITHUB_TOKEN.')
    }
    if (!response?.ok) {
      return failure('fetch-failed', `GitHub API returned HTTP ${response?.status ?? 'unknown'}.`)
    }

    let data
    try {
      data = await response.json()
    } catch {
      return failure('fetch-failed', 'GitHub API returned invalid JSON.')
    }
    if (!Array.isArray(data?.tree)) {
      return failure('fetch-failed', 'GitHub API tree response is missing the tree array.')
    }
    return {
      ok: true,
      ref: branch,
      sha: typeof data.sha === 'string' ? data.sha : '',
      truncated: data.truncated === true,
      tree: data.tree,
    }
  }

  return failure('repo-not-found', 'Repository not found on GitHub (tried HEAD, main and master).')
}

/**
 * 判定仓库属于哪种技能仓库，顺序固定：npx skills → marketplace → 不可用。
 *
 * npx 的**优先级前缀**命中任何一个 SKILL.md 就直接按 npx skills 处理，
 * **不再拉** marketplace.json；只有优先级规则一个都没命中时才看仓库根有没有
 * `.claude-plugin/marketplace.json`。兜底的宽松规则留到最后：marketplace 的
 * `plugins/<plugin>/skills/<name>/SKILL.md` 也会被兜底命中，若它先于
 * marketplace 判定，这类仓库就永远显示成 npx（详见 `findPrioritySkillMdPaths`）。
 *
 * tree 里说 marketplace 文件在、却读不到时返回 `fetch-failed`（而不是
 * 「不可用」），避免把网络 / 读文件问题误判成仓库类型。
 *
 * @param {{
 *   tree: unknown[],
 *   reader: { readFile: (repoPath: string) => Promise<string | null> },
 * }} options
 * @returns {Promise<
 *   | { kind: 'npx-skills' }
 *   | { kind: 'claude-code-marketplace', marketplace: { name: string, plugins: MarketplacePlugin[] } }
 *   | { kind: 'unavailable' }
 *   | { failure: { ok: false, code: 'fetch-failed', message: string } }
 * >}
 */
async function classifyRepo({ tree, reader }) {
  const allSkillMds = allSkillMdPaths(tree)
  if (findPrioritySkillMdPaths(allSkillMds).size > 0) return { kind: 'npx-skills' }

  const listed = tree.some(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      entry.type === 'blob' &&
      entry.path === MARKETPLACE_PATH,
  )
  if (listed) {
    const text = await reader.readFile(MARKETPLACE_PATH)
    if (text === null) {
      return {
        failure: failure(
          'fetch-failed',
          'Failed to read the Claude Code marketplace manifest from the repository.',
        ),
      }
    }
    const marketplace = parseMarketplace(text)
    // 清单不合法：这个仓库不是可用的 Claude Code marketplace，继续看 npx 的
    // 兜底规则能不能列出它，而不是直接判死。
    if (marketplace !== null) return { kind: 'claude-code-marketplace', marketplace }
  }

  // 没有 marketplace 文件（或清单不合法）时，npx 的兜底规则仍然生效，与展开时
  // 的发现结果一致。
  if (allSkillMds.some((skillMd) => skillMd.split('/').length <= 6)) return { kind: 'npx-skills' }
  return { kind: 'unavailable' }
}

/**
 * 解析 Claude Code marketplace 清单。
 *
 * 顶层不是对象、或者 `plugins` 不是数组时整份按不合法处理（返回 null，调用方
 * 判定为不可用）。单个插件的 name / source 不合法只跳过该插件：宁可少列一个，
 * 也不要让一份有瑕疵的清单整份失败。
 *
 * @param {string} text
 * @returns {{ name: string, plugins: MarketplacePlugin[] } | null}
 */
function parseMarketplace(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  if (!Array.isArray(data.plugins)) return null

  // `metadata.pluginRoot` 只影响「裸 source 名」的解析根；不合法就当作没有。
  const pluginRoot = normalizeRelativePath(data.metadata?.pluginRoot)
  const plugins = []
  const roots = new Set()
  for (const entry of data.plugins) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const pluginName = normalizePluginName(entry.name)
    if (pluginName === null) continue
    const root = resolvePluginRoot(entry.source, pluginRoot)
    if (root === null || roots.has(root)) continue
    // 同一 root 只保留数组里第一条：后面的 entry 分不到 skill，自然被省略。
    roots.add(root)
    plugins.push({
      name: pluginName,
      root,
      // 描述暂时不展示，但保留在解析结果里，后续要用时不必再解析一遍。
      description: typeof entry.description === 'string' ? entry.description : '',
    })
  }
  return { name: typeof data.name === 'string' ? data.name : '', plugins }
}

/**
 * 校验 marketplace 插件名：trim 后必须匹配插件命名规则。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizePluginName(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!PLUGIN_NAME_PATTERN.test(text)) return null
  return text
}

/**
 * 校验一个安全的仓库内相对路径；不合法时返回 null。
 *
 * 拒绝绝对路径、反斜杠、控制字符、空段、`.` / `..` 段与超长路径。空串表示
 * 仓库根，是合法的相对路径。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeRelativePath(value) {
  if (typeof value !== 'string') return null
  if (value === '') return ''
  if (value.length > MAX_PLUGIN_ROOT_LENGTH) return null
  if (value.startsWith('/') || value.includes('\\') || CONTROL_PATTERN.test(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return value
}

/**
 * 把一个插件的 `source` 解析成仓库内相对路径；只接受仓库内的本地 source。
 *
 * - `'.'` → 仓库根（`''`）；
 * - `'./x'` → `'x'`；
 * - 不含 `/` 的裸名 → `${metadata.pluginRoot}/${source}`（没有合法 pluginRoot
 *   则跳过）；裸名指目录名，可能与 entry 的显示名不同；
 * - 其它（含 `/` 但不以 `./` 开头、对象形式的 github / npm / url source）→ 跳过，
 *   因为它们不在这个仓库里，Host 无法列出其中的 skill。
 *
 * @param {unknown} source
 * @param {string | null} pluginRoot `metadata.pluginRoot` 的校验结果
 * @returns {string | null}
 */
function resolvePluginRoot(source, pluginRoot) {
  if (typeof source !== 'string') return null
  if (source === '.') return ''
  if (source.startsWith('./')) return normalizeRelativePath(source.slice(2))
  if (source.includes('/')) return null
  if (pluginRoot === null) return null
  return normalizeRelativePath(pluginRoot === '' ? source : `${pluginRoot}/${source}`)
}

/**
 * GitHub API 请求头。
 *
 * @param {string | null} token
 * @returns {Record<string, string>}
 */
function apiHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'buka-skills',
  }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * raw.githubusercontent.com 的请求头；带 token 可以访问私有仓库。
 *
 * @param {string | null} token
 * @returns {Record<string, string>}
 */
function rawHeaders(token) {
  const headers = { 'User-Agent': 'buka-skills' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * 收集树里所有 SKILL.md blob 的完整路径。
 *
 * @param {unknown[]} tree GitHub 树节点数组
 * @returns {string[]}
 */
function allSkillMdPaths(tree) {
  return tree
    .filter((entry) => entry !== null && typeof entry === 'object')
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .filter((entry) => entry.path.toLowerCase().endsWith('skill.md'))
    .map((entry) => entry.path)
}

/**
 * 只按优先级前缀发现 SKILL.md，返回「完整路径 → 命中的容器前缀」。
 *
 * 分类时用它判断 npx 规则是不是**真的**发现了这个仓库：`findSkillMdPaths()`
 * 末尾还有一条很宽松的兜底（任意 ≤6 段的 SKILL.md），Claude Code marketplace
 * 的 `plugins/<plugin>/skills/<name>/SKILL.md` 正好会被它命中。若兜底也算
 * 「npx 仓库」，marketplace 就永远轮不到，所以先用优先级前缀判定。
 *
 * @param {string[]} allSkillMds
 * @returns {Map<string, string>}
 */
function findPrioritySkillMdPaths(allSkillMds) {
  const lowerPaths = new Set(allSkillMds.map((one) => one.toLowerCase()))
  const found = new Map()

  for (const prefix of PRIORITY_PREFIXES) {
    const isContainer = prefix !== ''
    for (const skillMd of allSkillMds) {
      if (!skillMd.startsWith(prefix)) continue
      const rest = skillMd.slice(prefix.length)

      // 前缀下的根 SKILL.md。
      if (rest.toLowerCase() === 'skill.md') {
        if (!found.has(skillMd)) found.set(skillMd, prefix)
        continue
      }

      const parts = rest.split('/')
      // `<prefix>/<skill>/SKILL.md`：容器下的直接子目录，总是接受。
      if (parts.length === 2 && parts[1].toLowerCase() === 'skill.md') {
        if (!found.has(skillMd)) found.set(skillMd, prefix)
        continue
      }

      // 容器下的分组目录：只接受两层到三层的 skill 目录，且不能嵌在另一个
      // skill 目录里，也不能落在 node_modules/.git 等目录中。
      const skillDirs = parts.slice(0, -1)
      const hasAncestorSkill = skillDirs.slice(0, -1).some((_, index) => {
        const ancestor = skillDirs.slice(0, index + 1).join('/')
        return lowerPaths.has(`${prefix}${ancestor}/SKILL.md`.toLowerCase())
      })
      if (
        isContainer &&
        parts.length >= 3 &&
        parts.length <= 4 &&
        parts.at(-1).toLowerCase() === 'skill.md' &&
        skillDirs.every((part) => !SKIP_DIRS.has(part)) &&
        !hasAncestorSkill
      ) {
        if (!found.has(skillMd)) found.set(skillMd, prefix)
      }
    }
  }

  return found
}

/**
 * 照搬 `npx skills` CLI 的 `findSkillMdPaths()`，并记录命中的优先级前缀。
 *
 * 返回的 `prefix` 是该路径最终采用的容器前缀（没有命中时为 `''`），调用方
 * 用它计算展示路径。CLI 的 `subpath` 参数这里不需要，等价于空串。
 *
 * @param {unknown[]} tree GitHub 树节点数组
 * @returns {Array<{ skillMd: string, prefix: string }>}
 */
function findSkillMdPaths(tree) {
  const allSkillMds = allSkillMdPaths(tree)
  if (allSkillMds.length === 0) return []

  const found = findPrioritySkillMdPaths(allSkillMds)
  if (found.size > 0) {
    return [...found].map(([skillMd, prefix]) => ({ skillMd, prefix }))
  }
  // 没有命中任何优先级前缀时跟随 CLI 的兜底：最多 6 段路径。
  return allSkillMds
    .filter((skillMd) => skillMd.split('/').length <= 6)
    .map((skillMd) => ({ skillMd, prefix: '' }))
}

/**
 * 按仓库内完整路径读取并解析一个 SKILL.md；失败时 name/description 都留空。
 *
 * 这是 npx 与 marketplace 两条流程共用的底层：npx 流还要自己补展示路径，
 * marketplace 流直接用仓库完整路径。`reader` 屏蔽了来源差异（GitHub raw、
 * 本地文件或 git 克隆目录里的文件）。
 *
 * @param {{ readFile: (repoPath: string) => Promise<string | null> }} reader
 * @param {string} skillMd 仓库内的完整 SKILL.md 路径
 * @returns {Promise<{ name: string, description: string }>}
 */
async function readSkillFile(reader, skillMd) {
  let text
  try {
    text = await reader.readFile(skillMd)
  } catch {
    text = null
  }

  try {
    return parseFrontmatter(text ?? '')
  } catch {
    // 解析器只处理字符串；这里兜底，避免一个坏文件让整棵树失败。
    return { name: '', description: '' }
  }
}

/**
 * 读取一个 SKILL.md 并解析 name/description；失败时两个字段都留空。
 *
 * npx 流的位置：`displayPath` 是剥掉容器前缀后的展示路径，`fullPath` 仍是
 * 仓库里的完整路径。
 *
 * @param {{ skillMd: string, prefix: string }} entry 发现的候选路径
 * @param {{ readFile: (repoPath: string) => Promise<string | null> }} reader
 * @returns {Promise<{ displayPath: string, fullPath: string, name: string, description: string }>}
 */
async function readSkillMetadata(entry, reader) {
  const meta = await readSkillFile(reader, entry.skillMd)
  return {
    displayPath: entry.skillMd.slice(entry.prefix.length),
    fullPath: entry.skillMd,
    name: typeof meta.name === 'string' ? meta.name.trim() : '',
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
  }
}

/**
 * 以固定并发跑一批异步任务，结果顺序与输入一致。
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }

  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

/**
 * 把剥过前缀的展示路径拼成目录树。
 *
 * - 目录节点按展示路径建 `path`（如 `core`），同名目录自动合并；
 * - skill 节点的 `path` 用仓库里的完整路径（如 `skills/core/x/SKILL.md`）；
 * - 名称缺失时用所在目录名兜底，根目录的 `SKILL.md` 用仓库名。
 *
 * @param {Array<{ displayPath: string, fullPath: string, name: string, description: string }>} entries
 * @param {string} repoName
 * @returns {TreeNode[]}
 */
function buildTree(entries, repoName) {
  const nodes = []
  const dirs = new Map()

  for (const entry of entries) {
    const segments = entry.displayPath.split('/').filter((segment) => segment !== '')
    // 最后一段是 SKILL.md，倒数第二段是 skill 自己的目录；后者成为 skill
    // 节点，只有它上面的分组目录才建成 dir 节点。
    const dirSegments = segments.slice(0, -2)
    const fallback = segments.length < 2 ? repoName : segments.at(-2)
    const name = entry.name === '' ? fallback : entry.name

    let children = nodes
    let key = ''
    for (const segment of dirSegments) {
      key = key === '' ? segment : `${key}/${segment}`
      let dir = dirs.get(key)
      if (dir === undefined) {
        dir = { type: 'dir', name: segment, path: key, children: [] }
        dirs.set(key, dir)
        children.push(dir)
      }
      children = dir.children
    }
    children.push({ type: 'skill', name, path: entry.fullPath, description: entry.description })
  }

  sortTree(nodes)
  return nodes
}

/**
 * 把树里的 SKILL.md 按 marketplace 插件分组。
 *
 * 每个插件扫它 root 下的**所有** SKILL.md（不只是 `skills/` 一层）：marketplace
 * 的插件目录结构比 npx skills 自由，可能由 plugin.json 或 entry 指定自定义
 * skills 目录。按插件 root 从深到浅分配，每条完整路径只归第一个插件（根插件
 * 最后兜底）；`rel` 任一段落在 SKIP_DIRS 里的路径跳过。
 *
 * @param {unknown[]} tree GitHub 树节点数组
 * @param {{ plugins: MarketplacePlugin[] }} marketplace
 * @returns {Array<{ pluginName: string, pluginRoot: string, skills: Array<{ path: string, rel: string }> }>}
 */
function collectMarketplaceSkills(tree, marketplace) {
  const skillMds = tree
    .filter((entry) => entry !== null && typeof entry === 'object')
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .filter((entry) => entry.path.toLowerCase().endsWith('skill.md'))
    .map((entry) => entry.path)

  const ordered = [...marketplace.plugins].sort(
    (a, b) => pathDepth(b.root) - pathDepth(a.root),
  )
  const groups = []
  const claimed = new Set()
  for (const plugin of ordered) {
    const skills = []
    for (const skillPath of skillMds) {
      if (claimed.has(skillPath)) continue
      let rel
      if (plugin.root === '') {
        rel = skillPath
      } else {
        if (!skillPath.startsWith(`${plugin.root}/`)) continue
        rel = skillPath.slice(plugin.root.length + 1)
      }
      if (rel.split('/').some((segment) => SKIP_DIRS.has(segment))) continue
      claimed.add(skillPath)
      skills.push({ path: skillPath, rel })
    }
    if (skills.length > 0) {
      groups.push({ pluginName: plugin.name, pluginRoot: plugin.root, skills })
    }
  }
  return groups
}

/**
 * marketplace 预计的 skill 数量；探测用，不拉原文。
 *
 * @param {unknown[]} tree
 * @param {{ plugins: MarketplacePlugin[] }} marketplace
 * @returns {number}
 */
function countMarketplaceSkills(tree, marketplace) {
  return collectMarketplaceSkills(tree, marketplace).reduce(
    (total, group) => total + group.skills.length,
    0,
  )
}

/**
 * 相对路径的深度；空串（仓库根）算 0。
 *
 * @param {string} root
 * @returns {number}
 */
function pathDepth(root) {
  return root === '' ? 0 : root.split('/').length
}

/**
 * 建 marketplace 的插件分组树：每个插件一个目录节点，skill 是它的直接子节点。
 *
 * 目录节点的 `path` 是插件 root（仓库根用 `.`），skill 节点保留仓库完整路径。
 * skill 名称优先 frontmatter `name`；为空时回退到 `rel` 的倒数第二段目录名，
 * `rel` 不足两段（插件根 `SKILL.md`）时回退到插件名。
 *
 * @param {Array<{ pluginName: string, pluginRoot: string, skills: Array<{ path: string, rel: string }> }>} groups
 * @param {Map<string, { name: string, description: string }>} metas key 是完整路径
 * @returns {TreeNode[]}
 */
function buildMarketplaceTree(groups, metas) {
  const nodes = groups.map((group) => ({
    type: 'dir',
    name: group.pluginName,
    path: group.pluginRoot === '' ? '.' : group.pluginRoot,
    children: group.skills.map((skill) => {
      const meta = metas.get(skill.path) ?? { name: '', description: '' }
      const segments = skill.rel.split('/')
      const fallback = segments.length >= 2 ? segments.at(-2) : group.pluginName
      return {
        type: 'skill',
        name: meta.name === '' ? fallback : meta.name,
        path: skill.path,
        description: meta.description,
      }
    }),
  }))

  sortTree(nodes)
  return nodes
}

/**
 * 递归排序：目录在前、skill 在后，同类按 `name` 的大小写不敏感升序。
 *
 * @param {TreeNode[]} nodes
 * @returns {void}
 */
function sortTree(nodes) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return compareName(a.name, b.name)
  })
  for (const node of nodes) {
    if (node.type === 'dir') sortTree(node.children)
  }
}

/**
 * 大小写不敏感的 `localeCompare`；完全相同时再用原始大小写稳定排序。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareName(a, b) {
  const folded = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return folded !== 0 ? folded : a.localeCompare(b)
}

/**
 * 读缓存；文件不存在、损坏、版本不符或结构不对都返回空对象。
 *
 * 缓存随时可以重建，所以这里不区分「坏文件」与「没有文件」，也不报错。
 * v1 的缓存没有 `kind` / `complete`，因版本不符自动丢弃并重建。
 *
 * @param {string} file
 * @returns {Promise<Record<string, CacheEntry>>}
 */
async function readCache(file) {
  let parsed
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  if (parsed.version !== REPO_SKILLS_CACHE_VERSION) return {}
  if (parsed.entries === null || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    return {}
  }

  const entries = {}
  for (const [id, raw] of Object.entries(parsed.entries)) {
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
 *
 * @param {unknown} raw
 * @returns {CacheEntry | null}
 */
function normalizeCacheEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.source !== 'string' || raw.source === '') return null
  if (typeof raw.kind !== 'string' || !REPO_KINDS.has(raw.kind)) return null
  if (typeof raw.ref !== 'string' || typeof raw.sha !== 'string') return null
  if (typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt)) return null
  if (typeof raw.truncated !== 'boolean') return null
  if (!Number.isInteger(raw.skills) || raw.skills < 0) return null
  if (typeof raw.complete !== 'boolean') return null
  if (!isValidTree(raw.root)) return null
  const marketplace = normalizeCachedMarketplace(raw.marketplace)
  if (marketplace === null && raw.marketplace !== null && raw.marketplace !== undefined) return null
  return {
    source: raw.source,
    kind: raw.kind,
    ref: raw.ref,
    sha: raw.sha,
    fetchedAt: raw.fetchedAt,
    truncated: raw.truncated,
    root: raw.root,
    skills: raw.skills,
    complete: raw.complete,
    marketplace,
  }
}

/**
 * 校验缓存里的 marketplace 清单；缺失或结构不合法时返回 null。
 *
 * 插件名与 root 都按写入前同一套规则重新校验：缓存可能被手工改过，不能让
 * 非法路径或名字从缓存里重新变成对外服务的返回值。
 *
 * @param {unknown} value
 * @returns {CachedMarketplace | null}
 */
function normalizeCachedMarketplace(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.name !== 'string') return null
  if (!Array.isArray(value.plugins)) return null
  const plugins = []
  for (const entry of value.plugins) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const name = normalizePluginName(entry.name)
    const root = normalizeRelativePath(entry.root)
    if (name === null || root === null) return null
    if (typeof entry.description !== 'string') return null
    plugins.push({ name, root, description: entry.description })
  }
  return { name: value.name, plugins }
}

/**
 * 校验缓存里的树结构。缓存可能被手工改过，结构不对就当作未命中重拉。
 *
 * @param {unknown} root
 * @returns {boolean}
 */
function isValidTree(root) {
  if (!Array.isArray(root)) return false
  const stack = [{ nodes: root, depth: 0 }]
  while (stack.length > 0) {
    const { nodes, depth } = stack.pop()
    if (depth > 64) return false
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') return false
      if (typeof node.name !== 'string' || typeof node.path !== 'string') return false
      if (node.type === 'dir') {
        if (!Array.isArray(node.children)) return false
        stack.push({ nodes: node.children, depth: depth + 1 })
      } else if (node.type === 'skill') {
        if (typeof node.description !== 'string') return false
      } else {
        return false
      }
    }
  }
  return true
}

/**
 * 缓存是否仍然有效：`refresh` 已在调用处处理，这里只判断 TTL。
 *
 * @param {{ fetchedAt: number } | undefined} entry
 * @param {number} now
 * @param {number} ttlMs
 * @returns {boolean}
 */
function isFresh(entry, now, ttlMs) {
  if (entry === undefined) return false
  return now - entry.fetchedAt < ttlMs
}

/**
 * 写探测的轻量缓存：目标 id 已有完整树缓存时**不覆盖**。
 *
 * 探测刷新（`refresh: true`）同样遵守这条规则，避免把展开时拿到的完整树降级。
 * 「是否已有完整树」在串行化的读改写里重新判断，因此并发探测不会拿旧快照
 * 覆盖掉刚写进去的完整树。
 *
 * @param {string} file
 * @param {string} id
 * @param {CacheEntry} entry
 * @returns {Promise<void>}
 */
async function writeProbeCache(file, id, entry) {
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
 *
 * @type {Map<string, Promise<void>>}
 */
const cacheWrites = new Map()

/**
 * 串行更新缓存文件。`update` 返回 `undefined` 表示这次不写。
 *
 * @param {string} file
 * @param {(entries: Record<string, CacheEntry>) => Record<string, CacheEntry> | undefined} update
 * @returns {Promise<void>}
 */
function updateCache(file, update) {
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
 *
 * @param {string} file
 * @param {Record<string, unknown>} entries
 * @returns {Promise<void>}
 */
async function writeCache(file, entries) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const body = `${JSON.stringify({ version: REPO_SKILLS_CACHE_VERSION, entries }, null, 2)}\n`
  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  )
  try {
    await fs.writeFile(temp, body, { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 「既不是 npx skills 仓库，也不是 Claude Code marketplace」的统一失败返回。
 *
 * @returns {{ ok: false, code: 'repo-unavailable', message: string }}
 */
function repoUnavailable() {
  return failure(
    'repo-unavailable',
    'Repository is neither an npx skills repository nor a Claude Code plugin marketplace.',
  )
}

/**
 * 统一的失败返回，保证错误码集合与模块契约一致。
 *
 * `git-unavailable` 表示本机没有可执行的 git；`git-failed` 表示 clone / fetch /
 * 读克隆目录失败。两者只可能出现在 git 来源上，其余错误码对三种来源通用。
 *
 * @param {'invalid-source' | 'unsupported-source' | 'repo-not-found' | 'rate-limited' | 'fetch-failed' | 'repo-unavailable' | 'git-unavailable' | 'git-failed'} code
 * @param {string} message
 * @returns {{ ok: false, code: string, message: string }}
 */
function failure(code, message) {
  return { ok: false, code, message }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
