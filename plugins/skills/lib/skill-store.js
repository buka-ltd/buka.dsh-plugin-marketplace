/**
 * 全局 skills 的读取与卸载。
 *
 * DSH 的 `dsh-skill-filesystem` 按固定优先级扫描几个本地根目录，其中两个是
 * 「全局」的，对所有会话生效：
 *
 * | 来源 | 根目录 | 谁在写 |
 * | --- | --- | --- |
 * | `user-agents` | `<DSH_AGENTS_HOME 或 ~/.agents>/skills` | `npx skills -g` 与手工安装 |
 * | `user-dsh` | `<DSH_HOME 或 ~/.dsh>/skills` | 手工安装 |
 *
 * `npx skills` 把全局安装记录写进自己的 lockfile：默认是
 * `~/.agents/.skill-lock.json`，但设置了 `XDG_STATE_HOME` 时改写到
 * `$XDG_STATE_HOME/skills/.skill-lock.json`（与 CLI 的 `getSkillLockPath()` 一致，
 * 所以这里必须按同样的规则解析）。lockfile 是 `version: 3`，键是 skill 名。
 *
 * CLI 还把 skill 的「规范副本」放在 `~/.agents/skills/<name>`，其它 agent 目录
 * （如 `~/.claude/skills`）只是指向规范副本的符号链接。因此「是否被 npx skills
 * 管理」由两条一起判定：skill 位于 `~/.agents/skills` 下，且能在 lockfile 里
 * 找到对应记录。
 *
 * 描述优先取 `ctx.skills.list()` 的摘要；摘要缺失（注册表不可用、路径未命中）
 * 时回退到直接解析 `SKILL.md` 的 YAML frontmatter，保证页面上总能显示
 * skill 自己的 description。
 *
 * 本模块只依赖 Node 内置模块，不 import DSH 包，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/skill-store
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 共享 agent 配置目录名；`DSH_AGENTS_HOME` 未设置时用它拼出 `~/.agents`。 */
export const AGENTS_DIR = '.agents'

/** `npx skills` 的 lockfile 文件名。 */
export const NPX_LOCK_FILE = '.skill-lock.json'

/** 本模块认识的 lockfile 版本；更旧的版本 CLI 会当作空 lockfile。 */
export const NPX_LOCK_VERSION = 3

/**
 * 按 DSH home-paths 的习惯处理环境变量：去掉首尾空白，展开开头的 `~`。
 *
 * @param {unknown} value 原始环境变量值
 * @returns {string | null} 规范化后的路径；空值时返回 null
 */
function envPath(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (text === '~') return os.homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2))
  return text
}

/**
 * 解析两个全局根目录的位置。与 DSH 自己的默认值保持一致：
 * `dshHome` 取 `DSH_HOME` 或 `~/.dsh`，`agentsHome` 取 `DSH_AGENTS_HOME` 或 `~/.agents`。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量；测试时可传入
 * @returns {{ agentsHome: string, dshHome: string }}
 */
export function resolveHomes(env = process.env) {
  const home = os.homedir()
  return {
    agentsHome: envPath(env.DSH_AGENTS_HOME) ?? path.join(home, AGENTS_DIR),
    dshHome: envPath(env.DSH_HOME) ?? path.join(home, '.dsh'),
  }
}

/**
 * `npx skills` 的全局 lockfile 位置，规则与 CLI 的 `getSkillLockPath()` 一致：
 * 设置了 `XDG_STATE_HOME` 时在 `$XDG_STATE_HOME/skills/`，否则在 `~/.agents/`。
 *
 * @param {{ agentsHome: string }} homes
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function lockFileFor(homes, env = process.env) {
  const xdgStateHome = envPath(env.XDG_STATE_HOME)
  return xdgStateHome === null
    ? path.join(homes.agentsHome, NPX_LOCK_FILE)
    : path.join(xdgStateHome, 'skills', NPX_LOCK_FILE)
}

/**
 * 两个全局 skills 根目录，按 DSH 的优先级排列（`user-dsh` 高于 `user-agents`）。
 *
 * @param {{ agentsHome: string, dshHome: string }} homes
 * @returns {Array<{ scope: 'dsh' | 'agents', skillsDir: string }>}
 */
export function globalRoots(homes) {
  return [
    { scope: 'dsh', skillsDir: path.join(homes.dshHome, 'skills') },
    { scope: 'agents', skillsDir: path.join(homes.agentsHome, 'skills') },
  ]
}

/**
 * skill 目录名只允许字母、数字、点、下划线与连字符，且不能以点开头。
 * 这样 `..`、路径分隔符和隐藏目录都不会被当成 skill 名传给删除逻辑。
 *
 * @param {unknown} id
 * @returns {id is string}
 */
export function isSafeSkillId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)
}

/**
 * 判断路径是否存在（含符号链接目标）。
 *
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
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
 * 扫描一个 skills 根目录的**直接子项**，与 `dsh-skill-filesystem` 的目录结构一致：
 * 目录形式的 `<name>/SKILL.md`，或平铺的 `<name>.md`；不递归，跳过隐藏项与
 * 根目录下的 `SKILL.md`。同一名字既有目录又有平铺文件时保留目录。
 *
 * @param {{ scope: 'dsh' | 'agents', skillsDir: string }} root
 * @returns {Promise<Array<{ id: string, scope: 'dsh' | 'agents', kind: 'directory' | 'file', path: string, file: string }>>}
 */
export async function scanRoot(root) {
  let dirents
  try {
    dirents = await fs.readdir(root.skillsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  /** @type {Map<string, { id: string, scope: 'dsh' | 'agents', kind: 'directory' | 'file', path: string, file: string }>} */
  const byId = new Map()

  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    const full = path.join(root.skillsDir, dirent.name)

    let stat
    try {
      // 跟随符号链接：npx 也可能用链接把 skill 接到规范目录。
      stat = await fs.stat(full)
    } catch {
      continue
    }

    let entry
    if (stat.isDirectory()) {
      const file = path.join(full, 'SKILL.md')
      if (!(await pathExists(file))) continue
      entry = { id: dirent.name, scope: root.scope, kind: 'directory', path: full, file }
    } else if (stat.isFile() && dirent.name.endsWith('.md') && dirent.name !== 'SKILL.md') {
      entry = { id: dirent.name.slice(0, -3), scope: root.scope, kind: 'file', path: full, file: full }
    } else {
      continue
    }

    const existing = byId.get(entry.id)
    if (existing === undefined || (existing.kind === 'file' && entry.kind === 'directory')) {
      byId.set(entry.id, entry)
    }
  }

  return [...byId.values()]
}

/**
 * 读 `npx skills` 的全局 lockfile。
 *
 * - 文件不存在：`exists: false`，所有 skill 按手工安装展示；
 * - 存在但无法解析 / 结构不对 / 版本比本模块认识的旧：`corrupt: true`，
 *   `skills` 为空。此时**不能**据此判断某个 skill 不是 npx 管理的（CLI 会忽略
 *   旧版本 lockfile，而旧记录里仍可能写着安装来源），卸载前要求先修复它。
 *
 * @param {string} file lockfile 绝对路径
 * @returns {Promise<{ exists: boolean, path: string, version: number | null, skills: Record<string, unknown>, corrupt: boolean }>}
 */
export async function readNpxLock(file) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, path: file, version: null, skills: {}, corrupt: false }
    }
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }

  if (parsed === null || typeof parsed !== 'object' || parsed.skills === null || typeof parsed.skills !== 'object') {
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }

  const version = typeof parsed.version === 'number' ? parsed.version : null
  // CLI 的 readSkillLock() 对 version < 3 返回空 lockfile；这里跟随它，
  // 但标记 corrupt，让页面提示而不是静默把 npx 管理的 skill 当成手工安装。
  if (version === null || version < NPX_LOCK_VERSION) {
    return { exists: true, path: file, version, skills: {}, corrupt: true }
  }

  return { exists: true, path: file, version, skills: parsed.skills, corrupt: false }
}

/**
 * 从 SKILL.md 的 YAML frontmatter 里取 name 与 description。
 *
 * 只实现本项目需要的子集：单行标量、引号标量、`|` 保留换行块与 `>` 折行块。
 * frontmatter 缺失、没有对应字段、或内容不是合法 frontmatter 时，两个字段都
 * 返回空串；解析失败不影响 skill 本身的列出，只影响展示用的元数据。
 *
 * @param {unknown} text SKILL.md 全文
 * @returns {{ name: string, description: string }}
 */
export function parseFrontmatter(text) {
  const front = frontmatterLines(text)
  if (front === null) return { name: '', description: '' }
  return {
    name: parseFrontmatterField(front, 'name'),
    description: parseFrontmatterField(front, 'description'),
  }
}

/**
 * 取 frontmatter 内部的行（不含两侧 `---`）；不是合法 frontmatter 时返回 null。
 *
 * @param {unknown} text SKILL.md 全文
 * @returns {string[] | null}
 */
function frontmatterLines(text) {
  if (typeof text !== 'string') return null
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') return null
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end < 0) return null
  return lines.slice(1, end)
}

/**
 * `metadata.internal: true` 的 skill 是内部 skill：`npx skills` 默认不列出它、
 * 也不安装它（除非用户显式按名字请求）。这里跟随 CLI 的判定，只认 frontmatter
 * 里 `metadata` 映射下的布尔 true（带引号的 `"true"` 是字符串，不算）。
 *
 * @param {unknown} text SKILL.md 全文
 * @returns {boolean}
 */
export function parseFrontmatterInternal(text) {
  const front = frontmatterLines(text)
  if (front === null) return false
  for (let index = 0; index < front.length; index += 1) {
    const match = /^metadata\s*:\s*(.*)$/u.exec(front[index])
    if (match === null) continue
    const inline = match[1].trim()
    // 行内 flow 映射：`metadata: { internal: true }`。
    if (inline.startsWith('{')) {
      return /(?:^|[,{])\s*internal\s*:\s*(?:true|True|TRUE)\s*(?:[,}]|$)/u.test(inline)
    }
    // 块映射：只看 metadata 的直接子键（同一缩进）。
    let childIndent = -1
    for (let next = index + 1; next < front.length; next += 1) {
      const row = front[next]
      if (row.trim() === '') continue
      const indent = /^\s*/u.exec(row)[0].length
      if (indent === 0) break
      if (childIndent < 0) childIndent = indent
      if (indent !== childIndent) continue
      if (/^\s+internal\s*:\s*(?:true|True|TRUE)\s*(?:#.*)?$/u.test(row)) return true
    }
    return false
  }
  return false
}

/**
 * 取 frontmatter 里的一个顶层标量字段；缺失时返回空串。
 *
 * 字段值支持单行标量、引号标量与 YAML 的 `|` / `>` 块。只认同级缩进，
 * 因此缩进在别的键下面的同名键不会被误取。
 *
 * @param {string[]} front frontmatter 内部的行（不含两侧 `---`）
 * @param {'name' | 'description'} key 字段名
 * @returns {string}
 */
function parseFrontmatterField(front, key) {
  for (let index = 0; index < front.length; index += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(front[index])
    if (match === null || match[1] !== key) continue
    const inline = match[2].trim()
    if (/^[|>][+-]?$/u.test(inline)) {
      const block = []
      for (let next = index + 1; next < front.length; next += 1) {
        const row = front[next]
        if (row.trim() === '') {
          block.push('')
          continue
        }
        if (!/^\s+/u.test(row)) break
        block.push(row.replace(/^\s+/u, ''))
      }
      if (inline.startsWith('>')) return block.map((row) => row.trim()).join(' ').replace(/\s+/gu, ' ').trim()
      return block.join('\n').trim()
    }
    return stripQuotes(inline)
  }
  return ''
}

/**
 * 从 SKILL.md 的 YAML frontmatter 里取 description。
 *
 * 保留这个导出是为了让已有的调用方（页面上的描述回退）不必关心 name；
 * 实际解析交给 `parseFrontmatter()`，行为与之前一致。
 *
 * @param {unknown} text SKILL.md 全文
 * @returns {string}
 */
export function parseFrontmatterDescription(text) {
  return parseFrontmatter(text).description
}

/**
 * 去掉 YAML 标量两侧的引号；普通标量原样返回。
 *
 * @param {string} value
 * @returns {string}
 */
function stripQuotes(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'")
  }
  return value
}

/**
 * 直接读 SKILL.md 取 description；文件读不了时返回空串。
 *
 * @param {string} file SKILL.md 绝对路径
 * @returns {Promise<string>}
 */
async function readSkillDescription(file) {
  try {
    return parseFrontmatterDescription(await fs.readFile(file, 'utf8'))
  } catch {
    return ''
  }
}

/**
 * 从 lockfile 记录里取出安装目录名（`skills/<name>/SKILL.md` 的 `<name>` 段）。
 *
 * @param {unknown} skillPath lockfile 的 `skillPath`
 * @returns {string | null}
 */
function folderOfSkillPath(skillPath) {
  if (typeof skillPath !== 'string') return null
  const segments = skillPath.split('/').filter((segment) => segment !== '')
  if (segments.length < 2 || segments[segments.length - 1] !== 'SKILL.md') return null
  return segments[segments.length - 2]
}

/**
 * 某个安装目录名对应的 npx lockfile 记录；找不到时返回 null。
 *
 * 先按 lock 键匹配（CLI 的规范目录名就是键），再兼容「规范目录名与键不同」的
 * 情况：lock 记录的 `skillPath` 目录段也能说明它装进了哪个目录。列表与卸载都
 * 用这一个判定，避免页面标了「npx skills」却走了直接删除分支。
 *
 * @param {{ skills: Record<string, unknown> }} lock
 * @param {string} id 安装目录名
 * @returns {Record<string, unknown> | null}
 */
export function npxRecordFor(lock, id) {
  const direct = lock.skills[id]
  if (direct !== undefined) return direct !== null && typeof direct === 'object' ? direct : {}

  for (const value of Object.values(lock.skills)) {
    if (value === null || typeof value !== 'object') continue
    if (folderOfSkillPath(value.skillPath) === id) return value
  }
  return null
}

/**
 * 收集两个全局根目录下的全部 skills，并标注哪些由 `npx skills` 管理。
 *
 * `summaries` 来自 `ctx.skills.list()`：用它补上 DSH 解析过的 `description` 等
 * 元数据；列表本身以磁盘扫描为准，这样刚删掉的条目不会因为 registry 缓存而
 * 继续出现，刚装上的条目也不依赖 watcher 的时序。某个根读不了时跳过它，
 * 在 `warnings` 里说明，而不是让整页失败。
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   summaries?: Array<Record<string, unknown>>,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 * @returns {Promise<{
 *   skills: Array<{
 *     id: string, name: string, description: string, scope: 'dsh' | 'agents',
 *     kind: 'directory' | 'file', path: string, managedByNpx: boolean,
 *     npxSource: string | null, npxSourceUrl: string | null,
 *     npxInstalledAt: string | null, npxUpdatedAt: string | null,
 *   }>,
 *   homes: { agentsHome: string, dshHome: string },
 *   roots: Array<{ scope: 'dsh' | 'agents', path: string }>,
 *   lock: { exists: boolean, path: string, version: number | null, corrupt: boolean },
 *   warnings: string[],
 * }>}
 */
export async function collectGlobalSkills({ homes = resolveHomes(), summaries = [], env = process.env } = {}) {
  const lockPath = lockFileFor(homes, env)
  const lock = await readNpxLock(lockPath)
  const roots = globalRoots(homes)

  const scanned = []
  const warnings = []
  for (const root of roots) {
    try {
      scanned.push(...(await scanRoot(root)))
    } catch (error) {
      warnings.push(`${root.skillsDir}: ${errorText(error)}`)
    }
  }

  const idCounts = new Map()
  for (const entry of scanned) idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1)

  /** @type {Map<string, Record<string, unknown>>} */
  const byFile = new Map()
  /** @type {Map<string, Record<string, unknown>>} */
  const byName = new Map()
  for (const summary of summaries) {
    if (typeof summary?.name !== 'string') continue
    byName.set(summary.name, summary)
    if (typeof summary.path === 'string') byFile.set(path.resolve(summary.path), summary)
  }

  const skills = []
  for (const entry of scanned) {
    // registry 的摘要可能只有名字（没有 path），但同名 skill 同时存在于两个根时
    // 按名字回填会把赢家（user-dsh）的描述贴到另一行，所以只在名字唯一时回填。
    const summary =
      byFile.get(path.resolve(entry.file)) ??
      (idCounts.get(entry.id) === 1 ? byName.get(entry.id) : undefined) ??
      null
    const name = typeof summary?.name === 'string' ? summary.name : entry.id
    const npx = entry.scope === 'agents' ? npxRecordFor(lock, entry.id) : null
    // 摘要拿不到描述时自己读 SKILL.md：注册表不可用或路径未命中时，
    // 页面仍然要能看到 skill 自己的 description。
    const description =
      typeof summary?.description === 'string' && summary.description !== ''
        ? summary.description
        : await readSkillDescription(entry.file)

    skills.push({
      id: entry.id,
      name,
      description,
      scope: entry.scope,
      kind: entry.kind,
      path: entry.path,
      managedByNpx: npx !== null,
      npxSource: typeof npx?.source === 'string' ? npx.source : null,
      npxSourceUrl: typeof npx?.sourceUrl === 'string' ? npx.sourceUrl : null,
      npxInstalledAt: typeof npx?.installedAt === 'string' ? npx.installedAt : null,
      npxUpdatedAt: typeof npx?.updatedAt === 'string' ? npx.updatedAt : null,
    })
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))

  return {
    skills,
    homes,
    roots: roots.map((root) => ({ scope: root.scope, path: root.skillsDir })),
    lock: { exists: lock.exists, path: lock.path, version: lock.version, corrupt: lock.corrupt },
    warnings,
  }
}

/**
 * 按「来源」选卸载方式：
 *
 * - `npx skills` 管理（位于 `~/.agents/skills` 且在该工具的 lockfile 里）：
 *   交给 `npx skills remove <name> --global --yes`，由它同时清理规范副本、
 *   各 agent 目录里的链接与 lockfile 记录；
 * - 其它（手工安装，或 `~/.dsh/skills` 下的 skill）：直接删除扫描到的目录或文件。
 *
 * lockfile 存在却读不出来时，agents 根下的 skill 一律拒绝卸载：这时无法判断
 * 它是否由 npx 管理，直接删目录会留下 lock 记录与悬空链接。两种方式都会在
 * 最后确认目标真的消失了；工具退出码为 0 但目录仍在时按失败上报。
 *
 * @param {{
 *   homes?: { agentsHome: string, dshHome: string },
 *   scope?: unknown,
 *   id?: unknown,
 *   runNpx: (args: string[]) => Promise<{ ok: boolean, message?: string, output?: string }>,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 * @returns {Promise<{ ok: boolean, method?: 'npx' | 'local', code?: string, message?: string, output?: string }>}
 */
export async function uninstallGlobalSkill({
  homes = resolveHomes(),
  scope,
  id,
  runNpx,
  env = process.env,
}) {
  if (scope !== 'agents' && scope !== 'dsh') {
    return { ok: false, code: 'invalid-scope', message: `未知的 skills 位置：${String(scope)}` }
  }
  if (!isSafeSkillId(id)) {
    return { ok: false, code: 'invalid-id', message: `非法的 skill 名称：${String(id)}` }
  }
  if (typeof runNpx !== 'function') {
    return { ok: false, code: 'no-runner', message: '缺少执行 npx 的能力' }
  }

  const root = globalRoots(homes).find((one) => one.scope === scope)
  let entry
  try {
    entry = (await scanRoot(root)).find((one) => one.id === id)
  } catch (error) {
    return { ok: false, code: 'scan-failed', message: `无法读取 ${root.skillsDir}：${errorText(error)}` }
  }
  if (entry === undefined) {
    return { ok: false, code: 'not-found', message: `没有找到这个 skill，可能已经被删除：${id}` }
  }

  if (entry.scope === 'agents') {
    const lock = await readNpxLock(lockFileFor(homes, env))
    if (lock.corrupt) {
      return {
        ok: false,
        code: 'lock-unreadable',
        message: `无法读取 npx skills 的 lockfile（${lock.path}），无法判断这个 skill 是否由它管理；请先修复或删除该文件，再用 npx skills 处理`,
      }
    }
    if (npxRecordFor(lock, id) !== null) {
      let result
      try {
        result = await runNpx(['remove', id, '--global', '--yes'])
      } catch (error) {
        return { ok: false, code: 'npx-failed', message: errorText(error) }
      }
      if (!result?.ok) {
        return {
          ok: false,
          code: 'npx-failed',
          message: result?.message ?? 'npx skills remove 失败',
          output: result?.output ?? '',
        }
      }
      if (await pathExists(entry.path)) {
        return {
          ok: false,
          code: 'npx-incomplete',
          message: 'npx skills remove 已退出，但 skill 目录仍然存在',
          output: result.output ?? '',
        }
      }
      return { ok: true, method: 'npx', output: result.output ?? '' }
    }
  }

  try {
    await fs.rm(entry.path, { recursive: true, force: true })
  } catch (error) {
    return { ok: false, code: 'remove-failed', message: errorText(error) }
  }
  if (await pathExists(entry.path)) {
    return { ok: false, code: 'remove-incomplete', message: '删除后 skill 仍然存在' }
  }
  return { ok: true, method: 'local' }
}
