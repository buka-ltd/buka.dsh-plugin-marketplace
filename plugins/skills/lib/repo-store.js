/**
 * 「收藏的 skill 来源」的读写。
 *
 * 页面第二个 Tab 让用户记下以后想用的 skill 来源，方便随时取用。这份清单是
 * 用户自己的书签，和已安装的 skill 无关：装不装、装在哪，仍由 `npx skills` 决定。
 *
 * 来源分五类（`classifyRepoSource()`）：
 *
 * - `github`：GitHub 仓库（`owner/repo`、GitHub 链接、`git@github.com:o/r.git`），
 *   规范化为 `owner/repo`；
 * - `git`：任意 git 远端（GitHub 之外的 http(s)/ssh/git 地址、`git@host:path`），
 *   保留原样（只去掉结尾斜杠）；
 * - `local`：本地绝对路径（POSIX `/…`、Windows 盘符、`file://` URL），规范化为
 *   绝对路径；
 * - `web`：已知不是仓库的网页链接（如 GitHub 仓库的子页面），只当书签；
 * - `package`：npm 包名（如 `notion`、`@scope/pkg`），只当书签。
 *
 * 前三种能让 Host 列出仓库里的 skills 并展开成树，后两种不能。
 *
 * 数据放在 DSH home 下的一个 JSON 文件里（`<DSH_HOME 或 ~/.dsh>/buka-skills/repos.json`），
 * 不放进 `~/.agents/skills`，避免被当成 skill 根目录的一部分；也不进 session 事件。
 *
 * - 写入是原子的（同目录临时文件 + rename），失败不会留下半个文件；
 * - 文件存在但无法解析时**不覆盖**：返回 `corrupt`，页面提示用户先修复，
 *   否则「添加一条」会悄悄清掉其它收藏；
 * - 来源在写入前规范化，用规范化后的小写值做 `id`，因此同一仓库的大小写/链接
 *   形式不会重复收藏。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/repo-store
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveHomes } from './skill-store.js'

/** 收藏文件所在目录（DSH home 下），与 skills 根目录分开。 */
export const REPO_STORE_DIR = 'buka-skills'

/** 收藏文件名。 */
export const REPO_STORE_FILE = 'repos.json'

/** 本模块写出的文件版本；只接受版本不高于它的文件。 */
export const REPO_STORE_VERSION = 1

/** 来源的最大长度，防止有人把整篇文档贴进来。 */
export const MAX_SOURCE_LENGTH = 300

/** 备注的最大长度。 */
export const MAX_NOTE_LENGTH = 200

/** `owner/repo`：GitHub 仓库的简写，也是 `npx skills add` 最常用的来源。 */
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u

/** npm 作用域包名，如 `@scope/pkg`；同上，交给 npx 解析。 */
const SCOPED_PACKAGE = /^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u

/** 无斜杠的 npm 包名，如 `notion`。 */
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** 带协议头的远端地址；`file://` 单独按本地路径处理。 */
const REMOTE_URL = /^(?:https?|ssh|git):\/\//iu

/** GitHub 的仓库链接（可带协议与 `www.`，可带 `.git` 与结尾斜杠）。 */
const GITHUB_REPO =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/iu

/** GitHub 的 SCP / ssh 形式，如 `git@github.com:owner/repo.git`。 */
const GITHUB_SCP =
  /^(?:ssh:\/\/)?git@github\.com[:/]([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/iu

/**
 * SCP 形式的 git 地址：`[user@]host:path`。host 至少两个字符，避免把盘符
 * `C:` 误判成主机名；`(?!\/\/)` 排除 `https://` 这类协议头。
 */
const GIT_SCP = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]+:(?!\/\/)\S+$/u

/** 本地绝对路径：POSIX 以 `/` 开头；Windows 盘符/UNC 只在 win32 上算。 */
const POSIX_ABSOLUTE = /^\//u
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u
const UNC_ABSOLUTE = /^\\\\[^\\]+\\/u

/** 控制字符（含换行、制表符）一律不允许，JSON 里也不该出现。 */
const CONTROL = /[\u0000-\u001f\u007f]/u

/**
 * 来源种类：
 *
 * - `github`：GitHub 仓库，规范化为 `owner/repo`；
 * - `git`：任意 git 远端（GitHub 之外的 http(s)/ssh/git 地址、SCP 形式）；
 * - `local`：本地绝对路径（含 `file://` URL）；
 * - `web`：已知不是仓库的网页链接（如 GitHub 仓库的子页面）；
 * - `package`：npm 包名。
 *
 * `listable` 表示 Host 能不能列出这个来源里的 skills：`github`、`git`、`local`
 * 可以，`web`、`package` 只能当书签。
 *
 * @typedef {'github' | 'git' | 'local' | 'web' | 'package'} RepoSourceKind
 * @typedef {{ ok: true, kind: RepoSourceKind, source: string, listable: boolean }
 *   | { ok: false }} RepoSource
 */

/**
 * 收藏文件的绝对路径。
 *
 * @param {{ dshHome: string }} homes `resolveHomes()` 的结果
 * @returns {string}
 */
export function repoStoreFile(homes) {
  return path.join(homes.dshHome, REPO_STORE_DIR, REPO_STORE_FILE)
}

/**
 * 解析并规范化一个 skill 来源。
 *
 * 接受：
 * - GitHub 仓库：`owner/repo`、`github.com/owner/repo`、`https://github.com/owner/repo`、
 *   `git@github.com:owner/repo.git`（统一收敛成 `owner/repo`）；
 * - 任意 git 地址：非 GitHub 的 http(s)、`ssh://`、`git://`、`git@host:path`
 *   （保留原样，由 Host 交给 `git clone`）；
 * - 本地绝对路径：POSIX `/…`、Windows `C:\…` / `C:/…`（仅 win32）、`file://` URL；
 * - 其它网页链接（目前只识别 GitHub 子页面，如 `/tree/…`）与 npm 包名，只能当书签。
 *
 * 拒绝控制字符、超长文本与 `-` 开头的字符串：来源最终会出现在
 * `npx skills add <source>` / `git clone <source>` 命令里，不能以选项形式被解析。
 * 非本地路径还拒绝空白；本地绝对路径允许空格（Host 用 fs 直接读，不经过 shell）。
 *
 * @param {unknown} value
 * @returns {RepoSource}
 */
export function classifyRepoSource(value) {
  if (typeof value !== 'string') return { ok: false }
  const text = value.trim()
  if (text === '' || text.length > MAX_SOURCE_LENGTH) return { ok: false }
  if (CONTROL.test(text) || text.startsWith('-')) return { ok: false }

  if (/^file:\/\//iu.test(text)) {
    const localPath = localPathOfFileUrl(text)
    return localPath === null ? { ok: false } : localSource(localPath)
  }

  if (isLocalAbsolutePath(text)) return localSource(text)

  const github = githubRepoParts(text)
  if (github !== null) return githubSource(github.owner, github.repo)

  if (REMOTE_URL.test(text)) {
    let url
    try {
      url = new URL(text)
    } catch {
      return { ok: false }
    }
    const source = trimTrailingSlashes(text)
    // GitHub 上不是仓库根的链接（子页面等）仍可收藏，但 Host 列不出 skills。
    if (isGithubHost(url.hostname)) {
      return { ok: true, kind: 'web', source, listable: false }
    }
    return { ok: true, kind: 'git', source, listable: true }
  }

  if (GIT_SCP.test(text)) {
    return { ok: true, kind: 'git', source: trimTrailingSlashes(text), listable: true }
  }
  // 含空白的都到这里：本地路径分支已经放行了带空格的绝对路径，剩下的不可能是
  // 合法来源。
  if (/\s/u.test(text)) return { ok: false }

  if (OWNER_REPO.test(text)) {
    const [owner, repo] = text.split('/')
    return githubSource(owner, repo)
  }
  if (SCOPED_PACKAGE.test(text) || PACKAGE.test(text)) {
    return { ok: true, kind: 'package', source: text, listable: false }
  }
  return { ok: false }
}

/**
 * 规范化并校验一个 skill 来源；不合法时返回 null。
 *
 * 保留这个入口是为了兼容既有调用方和单测：它只返回规范化后的来源字符串，
 * 需要知道来源种类（GitHub / git / 本地 / 网页 / 包名）时用
 * `classifyRepoSource()`。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeRepoSource(value) {
  const classified = classifyRepoSource(value)
  return classified.ok ? classified.source : null
}

/**
 * 从 `owner/repo` 形式或 GitHub 链接里取仓库两段；不是 GitHub 仓库时返回 null。
 *
 * @param {string} text 已 trim 的来源
 * @returns {{ owner: string, repo: string } | null}
 */
function githubRepoParts(text) {
  for (const pattern of [GITHUB_REPO, GITHUB_SCP]) {
    const match = pattern.exec(text)
    if (match !== null) return { owner: match[1], repo: match[2] }
  }
  return null
}

/**
 * @param {string} hostname `new URL()` 解析出的主机名
 * @returns {boolean}
 */
function isGithubHost(hostname) {
  return hostname === 'github.com' || hostname === 'www.github.com'
}

/**
 * `file://` URL → 本地绝对路径；不是本机绝对路径（如带远端主机名）时返回 null。
 *
 * @param {string} text
 * @returns {string | null}
 */
function localPathOfFileUrl(text) {
  let localPath
  try {
    localPath = fileURLToPath(text)
  } catch {
    return null
  }
  return isLocalAbsolutePath(localPath) ? localPath : null
}

/**
 * 是不是本平台的绝对路径。Windows 形式只在 win32 上算：在 POSIX 上把
 * `C:\foo` 当成路径没有意义，也会和 SCP 形式混淆。
 *
 * @param {string} text
 * @returns {boolean}
 */
function isLocalAbsolutePath(text) {
  if (POSIX_ABSOLUTE.test(text)) return true
  if (process.platform !== 'win32') return false
  return WINDOWS_ABSOLUTE.test(text) || UNC_ABSOLUTE.test(text)
}

/**
 * 把绝对路径规范化：折叠 `.` / `..` 与重复分隔符，去掉结尾斜杠（根保留）。
 *
 * @param {string} text
 * @returns {string | null}
 */
function canonicalLocalPath(text) {
  let normalized
  try {
    normalized = path.normalize(text)
  } catch {
    return null
  }
  if (!path.isAbsolute(normalized)) return null
  const root = path.parse(normalized).root
  if (normalized === root) return normalized
  return normalized.replace(/[\\/]+$/u, '')
}

/**
 * @param {string} owner
 * @param {string} repo
 * @returns {RepoSource}
 */
function githubSource(owner, repo) {
  return { ok: true, kind: 'github', source: `${owner}/${repo}`, listable: true }
}

/**
 * @param {string} text 绝对路径
 * @returns {RepoSource}
 */
function localSource(text) {
  const normalized = canonicalLocalPath(text)
  if (normalized === null || normalized.length > MAX_SOURCE_LENGTH) return { ok: false }
  return { ok: true, kind: 'local', source: normalized, listable: true }
}

/**
 * 去掉结尾斜杠；整串都是斜杠时保持原样。
 *
 * @param {string} text
 * @returns {string}
 */
function trimTrailingSlashes(text) {
  const stripped = text.replace(/\/+$/u, '')
  return stripped === '' ? text : stripped
}

/**
 * 收藏项的去重键：规范化后的小写值。列表、添加与删除都用它，保证
 * `Foo/Bar`、`https://github.com/foo/bar` 与 `foo/bar` 是同一条。
 *
 * @param {string} source 已规范化的来源
 * @returns {string}
 */
export function repoKey(source) {
  return source.toLowerCase()
}

/**
 * 校验备注：缺省为空串，超长或非字符串都算不合法。
 *
 * @param {unknown} note
 * @returns {{ ok: true, note: string } | { ok: false }}
 */
function normalizeNote(note) {
  if (note === undefined || note === null) return { ok: true, note: '' }
  if (typeof note !== 'string') return { ok: false }
  const text = note.trim()
  if (text.length > MAX_NOTE_LENGTH) return { ok: false }
  return { ok: true, note: text }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 读收藏文件。
 *
 * 返回结构里 `exists` 说明文件是否在磁盘上，`corrupt` 说明文件存在却不可用
 * （不是 JSON、结构不对、版本比本模块新）。`corrupt` 时 `repos` 为空，
 * 调用方**不能**据此写回文件。
 *
 * @param {string} file 收藏文件绝对路径
 * @returns {Promise<{
 *   exists: boolean,
 *   corrupt: boolean,
 *   repos: Array<{ id: string, source: string, note: string, addedAt: string }>,
 * }>}
 */
async function readStore(file) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, corrupt: false, repos: [] }
    return { exists: true, corrupt: true, repos: [] }
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { exists: true, corrupt: true, repos: [] }
  }

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.repos)) {
    return { exists: true, corrupt: true, repos: [] }
  }
  const version = typeof parsed.version === 'number' ? parsed.version : null
  // 未来版本可能带本模块不认识的字段，写回会丢掉它们，所以同样拒绝。
  if (version === null || version < 1 || version > REPO_STORE_VERSION) {
    return { exists: true, corrupt: true, repos: [] }
  }

  const repos = []
  const seen = new Set()
  for (const raw of parsed.repos) {
    if (raw === null || typeof raw !== 'object') continue
    const source = normalizeRepoSource(raw.source)
    if (source === null) continue
    const id = repoKey(source)
    if (seen.has(id)) continue
    seen.add(id)
    const note = normalizeNote(raw.note)
    repos.push({
      id,
      source,
      note: note.ok ? note.note : '',
      addedAt: typeof raw.addedAt === 'string' && !Number.isNaN(Date.parse(raw.addedAt)) ? raw.addedAt : '',
    })
  }
  return { exists: true, corrupt: false, repos }
}

/**
 * 原子写回收藏文件：先写同目录临时文件再 rename，中途失败不会留下半个文件。
 *
 * @param {string} file
 * @param {Array<{ id: string, source: string, note: string, addedAt: string }>} repos
 * @returns {Promise<void>}
 */
async function writeStore(file, repos) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const body = `${JSON.stringify({ version: REPO_STORE_VERSION, repos }, null, 2)}\n`
  const temp = path.join(dir, `.${REPO_STORE_FILE}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.writeFile(temp, body, { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 列出收藏的仓库。
 *
 * @param {{ homes?: { agentsHome: string, dshHome: string } }} [options]
 * @returns {Promise<{
 *   file: string,
 *   exists: boolean,
 *   corrupt: boolean,
 *   repos: Array<{ id: string, source: string, note: string, addedAt: string }>,
 * }>}
 */
export async function listSavedRepos({ homes = resolveHomes() } = {}) {
  const file = repoStoreFile(homes)
  const store = await readStore(file)
  return { file, ...store }
}

/**
 * 收藏一个仓库。
 *
 * 重复（规范化后同名）返回 `duplicate`，文件不可读返回 `store-unreadable`。
 * 新条目排在最前面。
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   source?: unknown,
 *   note?: unknown,
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   code?: string,
 *   message?: string,
 *   repo?: { id: string, source: string, note: string, addedAt: string },
 *   repos?: Array<{ id: string, source: string, note: string, addedAt: string }>,
 *   file?: string,
 * }>}
 */
export async function addSavedRepo({ homes = resolveHomes(), source, note } = {}) {
  const normalized = normalizeRepoSource(source)
  if (normalized === null) {
    return {
      ok: false,
      code: 'invalid-source',
      message:
        '来源格式不对：支持 owner/repo、GitHub/GitLab 等链接、任意 git 地址、本地绝对路径（含 file://）或 npm 包名',
    }
  }
  const normalizedNote = normalizeNote(note)
  if (!normalizedNote.ok) {
    return { ok: false, code: 'invalid-note', message: `备注不能超过 ${MAX_NOTE_LENGTH} 个字符` }
  }

  const file = repoStoreFile(homes)
  const store = await readStore(file)
  if (store.corrupt) {
    return {
      ok: false,
      code: 'store-unreadable',
      message: `收藏文件无法解析（${file}），请先修复或删除它再添加`,
    }
  }

  const id = repoKey(normalized)
  if (store.repos.some((one) => one.id === id)) {
    return { ok: false, code: 'duplicate', message: `已经收藏过 ${normalized}`, repos: store.repos, file }
  }

  const repo = { id, source: normalized, note: normalizedNote.note, addedAt: new Date().toISOString() }
  const repos = [repo, ...store.repos]
  try {
    await writeStore(file, repos)
  } catch (error) {
    return { ok: false, code: 'write-failed', message: `无法写入 ${file}：${errorText(error)}` }
  }
  return { ok: true, repo, repos, file }
}

/**
 * 移除一条收藏；`id` 是列表里给出的去重键（大小写不敏感）。
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   id?: unknown,
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   code?: string,
 *   message?: string,
 *   repos?: Array<{ id: string, source: string, note: string, addedAt: string }>,
 *   file?: string,
 * }>}
 */
export async function removeSavedRepo({ homes = resolveHomes(), id } = {}) {
  if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_SOURCE_LENGTH) {
    return { ok: false, code: 'invalid-id', message: `非法的收藏 id：${String(id)}` }
  }
  const key = id.trim().toLowerCase()

  const file = repoStoreFile(homes)
  const store = await readStore(file)
  if (store.corrupt) {
    return {
      ok: false,
      code: 'store-unreadable',
      message: `收藏文件无法解析（${file}），请先修复或删除它再操作`,
    }
  }

  const repos = store.repos.filter((one) => one.id !== key)
  if (repos.length === store.repos.length) {
    return { ok: false, code: 'not-found', message: `没有收藏 ${String(id)}`, repos: store.repos, file }
  }
  try {
    await writeStore(file, repos)
  } catch (error) {
    return { ok: false, code: 'write-failed', message: `无法写入 ${file}：${errorText(error)}` }
  }
  return { ok: true, repos, file }
}
