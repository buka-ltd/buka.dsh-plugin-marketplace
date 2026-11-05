/**
 * 「收藏的 GitHub 仓库里有哪些 skills」：拉取、缓存与建树。
 *
 * 页面第二个 Tab 的收藏项可能指向一个包含多个 skill 的仓库。为了展开成 tree，
 * 这里直接调用 GitHub 的公开 API：
 *
 * - `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` 拿整棵树；
 * - `https://raw.githubusercontent.com/.../SKILL.md` 拿每个候选 skill 的原文。
 *
 * 发现规则与 `npx skills` CLI 的 `findSkillMdPaths()` 保持一致（优先级前缀、
 * container 层级、跳过的目录），只是额外记住命中哪个优先级前缀，用它把展示
 * 路径上的容器目录（如 `skills/`）剥掉。展示路径用于建 tree，skill 节点的
 * `path` 仍保留仓库里的完整路径，方便排查。
 *
 * 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
 * 按 `owner/repo` 的小写键存整棵树，TTL 30 分钟。缓存是**可重建的易失数据**：
 * 文件损坏、版本不符或单条结构不合法时都直接当作未命中并重拉重写，不像收藏
 * 文件那样拒绝覆盖。写入仍是原子写（同目录临时文件 + rename），避免留下半个
 * 文件。SKILL.md 拉取失败只影响那一个节点的名称/描述，不会让整棵树失败。
 *
 * 本模块只依赖 Node 内置模块，可单独测试；网络、时钟与缓存目录都从参数注入。
 *
 * @module @buka/dsh-plugin-skills/repo-skills
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { MAX_SOURCE_LENGTH, normalizeRepoSource, repoKey } from './repo-store.js'
import { parseFrontmatter, resolveHomes } from './skill-store.js'

/**
 * @typedef {{ type: 'dir', name: string, path: string, children: TreeNode[] }} DirNode
 * @typedef {{ type: 'skill', name: string, path: string, description: string }} SkillNode
 * @typedef {DirNode | SkillNode} TreeNode
 */

/** 缓存文件格式版本；不匹配的缓存直接丢弃重建。 */
export const REPO_SKILLS_CACHE_VERSION = 1

/** 缓存有效期：30 分钟。GitHub 的树变化不频繁，过期后按需重拉。 */
export const REPO_SKILLS_CACHE_TTL_MS = 30 * 60 * 1000

/** 依次尝试的分支。很多仓库没有 `main`，所以先问 `HEAD`。 */
const BRANCHES = ['HEAD', 'main', 'master']

/** GitHub API 的请求超时。 */
const TREE_TIMEOUT_MS = 10_000

/** 单个 SKILL.md 原文的请求超时；失败只影响一个节点。 */
const SKILL_MD_TIMEOUT_MS = 8_000

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
 * 拉取并缓存一个 GitHub 仓库的 skill 树。
 *
 * `source` 先经 `normalizeRepoSource()` 收敛（GitHub 链接变成 `owner/repo`），
 * 再要求它确实是 GitHub 仓库；`@scope/pkg`、`notion`、GitLab 链接等返回
 * `unsupported-source`。缓存命中时完全不发网络请求；否则依次尝试
 * `HEAD`、`main`、`master`，任意一个成功即停。
 *
 * 用于展示的目录节点路径已经去掉容器前缀，skill 节点保留完整仓库路径。
 * 网络失败、限流、仓库不存在等情况都返回 `{ ok: false, code, message }`，
 * 不向调用方抛异常；缓存写入失败则忽略，因为它随时可以重建。
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   source?: unknown,
 *   refresh?: boolean,
 *   fetchImpl?: typeof fetch,
 *   token?: string,
 *   now?: number,
 *   ttlMs?: number,
 * }} [options]
 * @returns {Promise<
 *   | { ok: true, source: string, ref: string, sha: string, fetchedAt: number,
 *       cached: boolean, truncated: boolean, root: TreeNode[], skills: number }
 *   | { ok: false, code: 'invalid-source' | 'unsupported-source' | 'repo-not-found' | 'rate-limited' | 'fetch-failed', message: string }
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
} = {}) {
  const normalized = normalizeRepoSource(source)
  if (normalized === null) {
    return failure('invalid-source', 'Invalid source: expected a GitHub owner/repo or repository URL.')
  }
  const repo = githubRepoOf(normalized)
  if (repo === null) {
    return failure('unsupported-source', 'Unsupported source: only GitHub repositories can be listed.')
  }
  // 最终来源统一成 `owner/repo`：带子路径/查询串的 GitHub 链接也能落到与
  // `owner/repo` 相同的缓存键上，避免同一仓库被缓存成两份。
  const canonical = `${repo.owner}/${repo.repo}`

  const timestamp = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const resolvedToken = resolveToken(token)
  const file = repoSkillsCacheFile(homes)
  const entries = await readCache(file)
  const id = repoKey(canonical)

  const cached = entries[id]
  if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
    return {
      ok: true,
      source: canonical,
      ref: cached.ref,
      sha: cached.sha,
      fetchedAt: cached.fetchedAt,
      cached: true,
      truncated: cached.truncated,
      root: cached.root,
      skills: cached.skills,
    }
  }

  const tree = await fetchRepoTree({ ...repo, token: resolvedToken, fetchImpl })
  if (!tree.ok) return tree

  const discovered = findSkillMdPaths(tree.tree)
  const metadata = await mapLimit(discovered, SKILL_MD_CONCURRENCY, (entry) =>
    fetchSkillMetadata(entry, { ...repo, ref: tree.ref, token: resolvedToken, fetchImpl }),
  )
  const root = buildTree(metadata, repo.repo)
  const entry = {
    source: canonical,
    ref: tree.ref,
    sha: tree.sha,
    fetchedAt: timestamp,
    truncated: tree.truncated,
    root,
    skills: metadata.length,
  }

  try {
    await writeCache(file, { ...entries, [id]: entry })
  } catch {
    // 缓存是可重建的易失数据：写不进去不影响本次结果，下次再试。
  }

  return {
    ok: true,
    source: canonical,
    ref: tree.ref,
    sha: tree.sha,
    fetchedAt: timestamp,
    cached: false,
    truncated: tree.truncated,
    root,
    skills: metadata.length,
  }
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
 * 照搬 `npx skills` CLI 的 `findSkillMdPaths()`，并记录命中的优先级前缀。
 *
 * 返回的 `prefix` 是该路径最终采用的容器前缀（没有命中时为 `''`），调用方
 * 用它计算展示路径。CLI 的 `subpath` 参数这里不需要，等价于空串。
 *
 * @param {unknown[]} tree GitHub 树节点数组
 * @returns {Array<{ skillMd: string, prefix: string }>}
 */
function findSkillMdPaths(tree) {
  const allSkillMds = tree
    .filter((entry) => entry !== null && typeof entry === 'object')
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .filter((entry) => entry.path.toLowerCase().endsWith('skill.md'))
    .map((entry) => entry.path)
  if (allSkillMds.length === 0) return []

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

  if (found.size > 0) {
    return [...found].map(([skillMd, prefix]) => ({ skillMd, prefix }))
  }
  // 没有命中任何优先级前缀时跟随 CLI 的兜底：最多 6 段路径。
  return allSkillMds
    .filter((skillMd) => skillMd.split('/').length <= 6)
    .map((skillMd) => ({ skillMd, prefix: '' }))
}

/**
 * 拉取一个 SKILL.md 并解析 name/description；失败时两个字段都留空。
 *
 * @param {{ skillMd: string, prefix: string }} entry 发现的候选路径
 * @param {{ owner: string, repo: string, ref: string, token: string | null, fetchImpl: typeof fetch }} options
 * @returns {Promise<{ displayPath: string, fullPath: string, name: string, description: string }>}
 */
async function fetchSkillMetadata(entry, { owner, repo, ref, token, fetchImpl }) {
  const segments = entry.skillMd.split('/').map((segment) => encodeURIComponent(segment))
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${segments.join('/')}`

  let text = ''
  try {
    const response = await fetchImpl(url, {
      headers: rawHeaders(token),
      signal: AbortSignal.timeout(SKILL_MD_TIMEOUT_MS),
    })
    if (response?.ok) text = await response.text()
  } catch {
    text = ''
  }

  let meta = { name: '', description: '' }
  try {
    meta = parseFrontmatter(text)
  } catch {
    // 解析器只处理字符串；这里兜底，避免一个坏文件让整棵树失败。
  }

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
 *
 * @param {string} file
 * @returns {Promise<Record<string, {
 *   source: string, ref: string, sha: string, fetchedAt: number,
 *   truncated: boolean, root: TreeNode[], skills: number,
 * }>>}
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
 * @param {unknown} raw
 * @returns {{
 *   source: string, ref: string, sha: string, fetchedAt: number,
 *   truncated: boolean, root: TreeNode[], skills: number,
 * } | null}
 */
function normalizeCacheEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.source !== 'string' || raw.source === '') return null
  if (typeof raw.ref !== 'string' || typeof raw.sha !== 'string') return null
  if (typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt)) return null
  if (typeof raw.truncated !== 'boolean') return null
  if (!Number.isInteger(raw.skills) || raw.skills < 0) return null
  if (!isValidTree(raw.root)) return null
  return {
    source: raw.source,
    ref: raw.ref,
    sha: raw.sha,
    fetchedAt: raw.fetchedAt,
    truncated: raw.truncated,
    root: raw.root,
    skills: raw.skills,
  }
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
 * 原子重写缓存文件：同目录临时文件 + rename，mode 0600。
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
 * 统一的失败返回，保证错误码集合与模块契约一致。
 *
 * @param {'invalid-source' | 'unsupported-source' | 'repo-not-found' | 'rate-limited' | 'fetch-failed'} code
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
