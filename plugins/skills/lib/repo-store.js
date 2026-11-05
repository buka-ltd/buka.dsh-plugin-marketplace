/**
 * 「收藏的 npx skills 仓库」的读写。
 *
 * 页面第二个 Tab 让用户记下以后想用的 skill 来源（`owner/repo`、GitHub 链接或
 * `npx skills add` 支持的包名），方便随时取用。这份清单是用户自己的书签，
 * 和已安装的 skill 无关：装不装、装在哪，仍由 `npx skills` 决定。
 *
 * 数据放在 DSH home 下的一个 JSON 文件里（`<DSH_HOME 或 ~/.dsh>/buka-skills/repos.json`），
 * 不放进 `~/.agents/skills`，避免被当成 skill 根目录的一部分；也不进 session 事件。
 *
 * - 写入是原子的（同目录临时文件 + rename），失败不会留下半个文件；
 * - 文件存在但无法解析时**不覆盖**：返回 `corrupt`，页面提示用户先修复，
 *   否则「添加一条」会悄悄清掉其它收藏；
 * - 来源在写入前规范化：GitHub 仓库链接收敛成 `owner/repo`，其余保留原样，
 *   用规范化后的小写值做 `id`，因此同一仓库的大小写/链接形式不会重复收藏。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/repo-store
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

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

/** http(s) 链接；允许路径、查询串与片段。 */
const HTTP_URL = /^https?:\/\/\S+$/u

/** `github.com/owner/repo`（可带协议与 `www.`，可带 `.git` 与结尾斜杠）。 */
const GITHUB_REPO =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/iu

/** 控制字符（含换行、制表符）一律不允许，JSON 里也不该出现。 */
const CONTROL = /[\u0000-\u001f\u007f]/u

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
 * 规范化并校验一个 skill 来源；不合法时返回 null。
 *
 * 接受三类写法：
 * - `owner/repo`（以及 `github.com/owner/repo`、`https://github.com/owner/repo`，
 *   这几种都收敛成 `owner/repo`）；
 * - 任意 http(s) 链接（保留原样，`npx skills add` 支持页面链接）；
 * - 不带斜杠的 npm 包名或作用域包名（如 `notion`、`@scope/pkg`）。
 *
 * 拒绝空白、控制字符、超长文本与 `-` 开头的字符串：来源最终会出现在
 * `npx skills add <source>` 命令里，不能以选项形式被解析。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeRepoSource(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > MAX_SOURCE_LENGTH) return null
  if (CONTROL.test(text) || /\s/u.test(text)) return null

  const github = GITHUB_REPO.exec(text)
  if (github !== null) return `${github[1]}/${github[2]}`

  if (OWNER_REPO.test(text) || SCOPED_PACKAGE.test(text) || PACKAGE.test(text)) return text
  if (HTTP_URL.test(text)) return text.replace(/\/+$/u, '')
  return null
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
      message: '来源格式不对：只支持 owner/repo、GitHub 链接、http(s) 链接或 npm 包名',
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
