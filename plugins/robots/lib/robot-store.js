/**
 * 机器人（插件自建目录）的登记表、目录与文件操作。
 *
 * v2 的「机器人」不再是「所有 DSH 工作区」：机器人是插件自己创建并登记在
 * 登记文件里的目录，之后再由浏览器一半挂到 DSH 工作区列表。本模块负责磁盘
 * 上的全部事实：
 *
 * - 插件全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`；
 *   默认机器人根目录是它下面的 `robots`，登记文件是它与根目录同级的
 *   `robots.json`（原子写、权限 0600）；
 * - 登记表读写与增删：`readRobotRegistry` / `writeRobotRegistry` /
 *   `addRobot` / `setRobotAvatar` / `setRobotDescription` / `renameRobot` /
 *   `removeRobot`；
 * - 工作区挂载状态：`listRobots` 用 `workspaceRegistry.list()` 按规范路径
 *   join 出 `mounted` / `workspaceId`；
 * - 扫描工作区里的**项目级** skills：`<path>/.agents/skills`、
 *   `<path>/.claude/skills`、`<path>/.dsh/skills`（`<name>/SKILL.md` 或平铺的
 *   `<name>.md`），`source` 从项目级 `skills-lock.json` 里补；
 * - 读写 `<path>/AGENTS.md`（读上限 256 KiB，写上限由路由检查 512 KiB），并
 *   维护 Claude Code 约定的 `<path>/CLAUDE.md` → `AGENTS.md` 符号链接。
 *
 * 名称校验、路径解析、frontmatter 解析都放在这里，便于用临时目录单测；
 * 本模块只依赖 Node 内置模块，不 import DSH 包。
 *
 * @module @buka/dsh-plugin-robots/robot-store
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isAvatarId, pickDefaultAvatar, resolveAvatar } from './avatar.js'
import { isGeneralRobotName } from './general-robot.js'

/** 每个机器人工作区里的协作说明文件名。 */
export const AGENTS_FILE = 'AGENTS.md'

/**
 * Claude Code 读取的项目说明文件名。机器人目录里固定把它做成指向 AGENTS.md
 * 的符号链接，两份工具读同一份内容；平台不允许建链接时改写 `@AGENTS.md`。
 */
export const CLAUDE_FILE = 'CLAUDE.md'

/** 页面直接展示 AGENTS.md 全文的上限（256 KiB）；超过只显示大小提示。 */
export const AGENTS_MAX_READ_BYTES = 256 * 1024

/** 允许通过页面写回 AGENTS.md 的上限（512 KiB）；超出由路由返回 413。 */
export const AGENTS_MAX_WRITE_BYTES = 512 * 1024

/** 机器人描述上限（UTF-16 长度）；描述是给工作流选择机器人看的一行摘要。 */
export const ROBOT_DESCRIPTION_MAX_LENGTH = 500

/** 插件全局目录名；位于 `${XDG_CACHE_HOME:-~/.cache}` 下。 */
export const PLUGIN_CACHE_DIR = 'dsh-plugin-robots'

/** 登记文件名；固定放在机器人根目录的父目录里。 */
export const ROBOT_REGISTRY_FILE = 'robots.json'

/** 登记文件格式版本。 */
export const ROBOT_REGISTRY_VERSION = 1

/**
 * 项目级 skills 的三个根目录（相对工作区），按扫描优先级排列。
 * `.agents/skills` 是 `npx skills` 的默认落点，`.claude/skills` 是 Claude Code
 * 的约定；同一个 skill 同时落两处时按名字去重，只展示一条。
 */
const PROJECT_SKILL_ROOTS = [
  path.join('.agents', 'skills'),
  path.join('.claude', 'skills'),
  path.join('.dsh', 'skills'),
]

/** `npx skills add` 在项目里写下的 lockfile 名。 */
const PROJECT_LOCK_FILE = 'skills-lock.json'

/**
 * 机器人名称的合法字符集：字母、数字（含汉字等 Unicode 字母/数字）开头，
 * 后面可以跟 `._-`。点开头、路径分隔符与 NUL 都被这个正则排除。
 */
const ROBOT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u

/**
 * 取用户 home 目录：优先用注入环境里的 `HOME`，否则用 `os.homedir()`。
 * 测试传临时 env 时不会碰真实 home。
 *
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {string}
 */
function homeDir(env) {
  const configured = typeof env?.HOME === 'string' ? env.HOME.trim() : ''
  if (configured !== '' && configured !== '~' && !configured.startsWith('~/') && !configured.startsWith('~\\')) {
    return configured
  }
  return os.homedir()
}

/**
 * 展开开头的 `~`；其它值原样返回。
 *
 * @param {string} value
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {string}
 */
function expandPath(value, env) {
  const text = value.trim()
  if (text === '~') return homeDir(env)
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(homeDir(env), text.slice(2))
  return text
}

/**
 * 读一个可选的路径型环境变量：去空白、展开 `~`，空值返回 null。
 *
 * @param {unknown} value
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {string | null}
 */
function envPath(value, env) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  return expandPath(text, env)
}

/**
 * 插件全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量；测试可注入临时目录
 * @returns {string}
 */
export function pluginCacheDir(env = process.env) {
  const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), '.cache')
  return path.join(cacheHome, PLUGIN_CACHE_DIR)
}

/**
 * 机器人根目录的默认位置：`<插件全局目录>/robots`。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量；测试可注入临时目录
 * @returns {string}
 */
export function defaultRobotsRoot(env = process.env) {
  return path.join(pluginCacheDir(env), 'robots')
}

/**
 * 把配置里的根目录解析成绝对路径：空值回退默认目录，展开开头的 `~`，
 * 相对路径按当前进程目录解析。
 *
 * @param {unknown} [configured] Config 里的 `robotsDir`
 * @param {NodeJS.ProcessEnv} [env] 环境变量；测试可注入
 * @returns {string} 绝对路径
 */
export function resolveRobotsDir(configured, env = process.env) {
  const text = typeof configured === 'string' ? configured.trim() : ''
  if (text === '') return path.resolve(defaultRobotsRoot(env))
  return path.resolve(expandPath(text, env))
}

/**
 * 登记文件路径：固定为机器人根目录的**同级** `robots.json`。
 *
 * @param {string} robotsDir 机器人根目录（已解析或未解析均可）
 * @returns {string} 绝对路径
 */
export function resolveRobotRegistryFile(robotsDir) {
  const base =
    typeof robotsDir === 'string' && robotsDir.trim() !== ''
      ? path.resolve(robotsDir)
      : path.resolve(defaultRobotsRoot())
  return path.join(path.dirname(base), ROBOT_REGISTRY_FILE)
}

/**
 * 判断一个名字能否直接当作机器人目录名。
 *
 * 规则（与页面后端的校验一致）：trim 后 1–64 个字符；不能是 `.` / `..`；
 * 不能以 `.` 开头；不能包含 `/`、`\`、NUL；只允许字母、数字、汉字与 `._-`。
 *
 * @param {unknown} name 用户输入
 * @returns {boolean}
 */
export function isValidRobotName(name) {
  if (typeof name !== 'string') return false
  const text = name.trim()
  if (text.length < 1 || text.length > 64) return false
  if (text === '.' || text === '..') return false
  return ROBOT_NAME_PATTERN.test(text)
}

/**
 * 机器人名字对应的绝对目录；名字不合法或解析后跑出根目录时返回 null。
 *
 * @param {string} robotsDir 机器人根目录（绝对路径）
 * @param {unknown} name 机器人名字
 * @returns {string | null}
 */
export function robotDirectory(robotsDir, name) {
  if (!isValidRobotName(name)) return null
  if (typeof robotsDir !== 'string' || robotsDir.trim() === '') return null
  const base = path.resolve(robotsDir)
  const target = path.resolve(base, name.trim())
  // 防御性检查：名字已经排除了分隔符，这里仍然确认目标是根目录的直接子项。
  const relative = path.relative(base, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return target
}

// ---- 登记表 --------------------------------------------------------------

/**
 * 校验并规范化登记文件路径。
 *
 * @param {unknown} file
 * @returns {string}
 */
function requireRegistryFile(file) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new Error('缺少机器人登记文件路径')
  }
  return path.resolve(file)
}

/**
 * 读机器人登记表。
 *
 * - 文件不存在：`{ version: 1, robots: [], file }`；
 * - 读不了 / 不是合法 JSON / 版本不是 1 / `robots` 不是数组：`corrupt: true`
 *   且 `robots: []`（写操作必须据此拒绝，绝不覆盖原文件）；
 * - 条目必须同时有合法 `name` 与非空 `path`，否则过滤掉；同名条目只保留第一个。
 * - `avatar` 是预设头像 id；旧登记表没有这个字段（或在别处被改坏）时留空，
 *   展示 / 写入时由 `resolveAvatar` 按名字兜底成一个确定的预设。
 *
 * @param {{ file: string }} options 登记文件绝对路径
 * @returns {Promise<{
 *   version: number,
 *   robots: Array<{ name: string, path: string, createdAt: string, avatar: string }>,
 *   corrupt?: true,
 *   file: string,
 * }>}
 */
export async function readRobotRegistry({ file } = {}) {
  const target = requireRegistryFile(file)
  let text
  try {
    text = await fs.readFile(target, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: ROBOT_REGISTRY_VERSION, robots: [], file: target }
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }
  if (parsed.version !== ROBOT_REGISTRY_VERSION || !Array.isArray(parsed.robots)) {
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }

  const robots = []
  const seen = new Set()
  for (const entry of parsed.robots) {
    if (entry === null || typeof entry !== 'object') continue
    if (!isValidRobotName(entry.name)) continue
    const name = entry.name.trim()
    if (typeof entry.path !== 'string' || entry.path.trim() === '') continue
    if (seen.has(name)) continue
    seen.add(name)
    robots.push({
      name,
      path: entry.path,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      avatar: typeof entry.avatar === 'string' ? entry.avatar.trim() : '',
      description: normalizeRobotDescription(entry.description).slice(0, ROBOT_DESCRIPTION_MAX_LENGTH),
    })
  }
  return { version: ROBOT_REGISTRY_VERSION, robots, file: target }
}

/**
 * 原子写机器人登记表（临时文件 + rename，权限 0600）。
 *
 * 目录不存在会先建好；写入失败时清理临时文件，原登记文件保持不变。
 *
 * @param {{ file: string, robots: Array<{ name: string, path: string, createdAt: string, avatar?: string }> }} options
 * @returns {Promise<{ file: string }>}
 */
export async function writeRobotRegistry({ file, robots } = {}) {
  const target = requireRegistryFile(file)
  const entries = Array.isArray(robots) ? robots : []
  await fs.mkdir(path.dirname(target), { recursive: true })

  const payload = {
    version: ROBOT_REGISTRY_VERSION,
    robots: entries.map((robot) => ({
      name: robot.name,
      path: robot.path,
      createdAt: robot.createdAt,
      // 写法上总是落下具体 id，旧记录在第一次写回时顺带补齐头像。
      avatar: resolveAvatar(robot.avatar, robot.name),
      // 旧登记表没有描述：第一次写回时补成空串，之后由页面 / 构建工具维护。
      description: normalizeRobotDescription(robot.description).slice(0, ROBOT_DESCRIPTION_MAX_LENGTH),
    })),
  }
  const temporary = `${target}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    // umask 可能削弱创建权限，显式收紧一次（Windows 上 chmod 基本是空操作）。
    try {
      await fs.chmod(temporary, 0o600)
    } catch {
      // 平台不支持时忽略
    }
    await fs.rename(temporary, target)
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true })
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error
  }
  return { file: target }
}

// ---- 登记表的增删 --------------------------------------------------------

/**
 * 生成「名称不合法」错误。
 *
 * @param {unknown} name
 * @returns {Error & { code: string }}
 */
function invalidNameError(name) {
  const error = new Error(`机器人名称不合法：${String(name)}`)
  return Object.assign(error, { code: 'invalid-name' })
}

/**
 * 生成「描述不合法」错误。
 *
 * @param {unknown} description
 * @returns {Error & { code: string }}
 */
function invalidDescriptionError(description) {
  const error = new Error(
    `机器人描述不合法：需要不超过 ${ROBOT_DESCRIPTION_MAX_LENGTH} 个字符的单行文本（收到 ${String(description)}）`,
  )
  return Object.assign(error, { code: 'invalid-description' })
}

/**
 * 规范化机器人描述：把换行 / 连续空白折叠成一个空格并 trim。描述是给工作流
 * 选择机器人看的「一行摘要」（与 skill 的 description 类似），所以不保留排版。
 * 非字符串按空描述处理。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRobotDescription(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * 描述是否合法：字符串（含空串）且规范化后不超过上限。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidRobotDescription(value) {
  return typeof value === 'string' && normalizeRobotDescription(value).length <= ROBOT_DESCRIPTION_MAX_LENGTH
}

/**
 * 生成「登记文件损坏」错误；写操作遇到它必须拒绝，不能覆盖用户文件。
 *
 * @param {string} file
 * @returns {Error & { code: string }}
 */
function registryUnreadableError(file) {
  const error = new Error(`机器人登记文件无法读取：${file}。请修复或删除该文件后重试。`)
  return Object.assign(error, { code: 'registry-unreadable' })
}

/**
 * 生成「头像不合法」错误。
 *
 * @param {unknown} avatar
 * @returns {Error & { code: string }}
 */
function invalidAvatarError(avatar) {
  const error = new Error(`头像不合法：${String(avatar)}`)
  return Object.assign(error, { code: 'invalid-avatar' })
}

/**
 * 生成「机器人不在登记表里」错误。
 *
 * @param {string} name
 * @returns {Error & { code: string }}
 */
function unknownRobotError(name) {
  const error = new Error(`机器人不在登记表里：${name}`)
  return Object.assign(error, { code: 'unknown-robot' })
}

/**
 * 确保机器人目录存在，并补一份 AGENTS.md 模板（不覆盖已有的）。
 *
 * 模板里的路径用目录的规范绝对路径（`fs.realpath`，失败回退解析值），与
 * 登记进 `robots.json` 的路径、DSH 工作区记录里的路径保持一致。
 *
 * @param {string} directory 机器人目录
 * @param {string} name 机器人名字（写进模板）
 * @returns {Promise<string>} 目录的规范绝对路径
 */
async function ensureRobotDirectory(directory, name) {
  await fs.mkdir(directory, { recursive: true })
  const stat = await fs.stat(directory)
  if (!stat.isDirectory()) {
    const error = new Error(`目标路径已存在且不是目录：${directory}`)
    throw Object.assign(error, { code: 'not-directory' })
  }
  const canonical = await realpathOr(directory, directory)
  const agentsFile = path.join(canonical, AGENTS_FILE)
  if (!(await pathExists(agentsFile))) {
    await fs.writeFile(agentsFile, robotAgentsTemplate(name, canonical), 'utf8')
  }
  // Claude Code 读 CLAUDE.md：机器人目录里让它指向同一份 AGENTS.md。已存在的
  // 用户文件 / 别的链接不覆盖（首次创建以外的调用都是幂等的）。
  await ensureClaudeLink(canonical)
  return canonical
}

/**
 * 机器人目录里 CLAUDE.md 的状态。
 *
 * `mode`：`symlink`（指向同目录 AGENTS.md 的符号链接）、`import`（平台不支持
 * 建链接时写下的 `@AGENTS.md`）、`file`（用户自己的普通文件）、`foreign-link`
 * （指向别处的符号链接）、`missing`（不存在）。
 *
 * @param {unknown} directory 机器人目录
 * @returns {Promise<{ exists: boolean, symlink: boolean, mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing', target: string }>}
 */
export async function readClaudeLink(directory) {
  if (typeof directory !== 'string' || directory.trim() === '') {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }
  const base = path.resolve(directory)
  const file = path.join(base, CLAUDE_FILE)
  let stat
  try {
    stat = await fs.lstat(file)
  } catch {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }

  if (stat.isSymbolicLink()) {
    let target = ''
    try {
      target = await fs.readlink(file)
    } catch {
      target = ''
    }
    const linked = target !== '' && path.resolve(base, target) === path.join(base, AGENTS_FILE)
    return { exists: true, symlink: linked, mode: linked ? 'symlink' : 'foreign-link', target }
  }

  // 不是符号链接：可能是 Windows 等平台的降级写法，也可能是用户自己的文件。
  try {
    if (stat.size <= 256) {
      const text = await fs.readFile(file, 'utf8')
      if (text.trim() === `@${AGENTS_FILE}`) {
        return { exists: true, symlink: false, mode: 'import', target: AGENTS_FILE }
      }
    }
  } catch {
    // 读不了就只当普通文件，不影响其它操作。
  }
  return { exists: true, symlink: false, mode: 'file', target: '' }
}

/**
 * 确保 `<机器人目录>/CLAUDE.md` 指向 `AGENTS.md`。
 *
 * - 已经是指向 AGENTS.md 的符号链接：原样返回，不重建；
 * - 已存在其它文件 / 链接：**不覆盖**，原样返回状态，交给页面提示；
 * - 不存在：优先建相对符号链接；平台不允许（如 Windows 未开开发者模式）时
 *   退回一份只有 `@AGENTS.md` 的说明文件，Claude Code 仍会导入同一份内容。
 *
 * @param {unknown} directory 机器人目录
 * @returns {Promise<{ exists: boolean, symlink: boolean, mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing', target: string }>}
 */
export async function ensureClaudeLink(directory) {
  if (typeof directory !== 'string' || directory.trim() === '') {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }
  const base = path.resolve(directory)
  const current = await readClaudeLink(base)
  if (current.exists) return current

  const file = path.join(base, CLAUDE_FILE)
  try {
    // 相对目标：机器人目录整体被移动或挂载到别的绝对路径时链接仍然有效。
    await fs.symlink(AGENTS_FILE, file, 'file')
    return { exists: true, symlink: true, mode: 'symlink', target: AGENTS_FILE }
  } catch {
    try {
      await fs.writeFile(file, `@${AGENTS_FILE}\n`, 'utf8')
      return { exists: true, symlink: false, mode: 'import', target: AGENTS_FILE }
    } catch {
      return { exists: false, symlink: false, mode: 'missing', target: '' }
    }
  }
}

/**
 * 新建（或复用）一个机器人：建目录、补 AGENTS.md 模板、把条目插到登记表最前。
 *
 * - 头像：传入合法 id 就用它，否则按名字挑一个还被占用的预设；新建的机器人
 *   一定带头像；
 * - 描述可选，存成一行摘要（空白折叠）；新建时写进条目，同名已登记时保留原描述；
 * - 同名已登记：不重复建条目，`created: false`；目录被外部删掉时重新建目录；
 * - 名称不合法抛 `code = 'invalid-name'`；登记文件损坏抛
 *   `code = 'registry-unreadable'`（不覆盖原文件）；
 * - 新条目的 `path` 是创建后的规范绝对路径（`fs.realpath`，失败回退解析值），
 *   这样和工作区注册表里的路径能直接对齐。
 *
 * @param {{ robotsDir: string, file: string, name: string, avatar?: string, description?: string }} options
 * @returns {Promise<{ robot: { name: string, path: string, createdAt: string, avatar: string, description: string }, created: boolean }>}
 */
export async function addRobot({ robotsDir, file, name, avatar, description } = {}) {
  const registryFile = requireRegistryFile(file)
  if (!isValidRobotName(name)) throw invalidNameError(name)

  const rawDescription = description === undefined || description === null ? '' : description
  if (typeof rawDescription !== 'string') throw invalidDescriptionError(rawDescription)
  const cleanDescription = normalizeRobotDescription(rawDescription)
  if (cleanDescription.length > ROBOT_DESCRIPTION_MAX_LENGTH) throw invalidDescriptionError(rawDescription)

  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const trimmed = name.trim()
  const existing = registry.robots.find((robot) => robot.name === trimmed)
  if (existing !== undefined) {
    await ensureRobotDirectory(existing.path, trimmed)
    return {
      robot: { ...existing, avatar: resolveAvatar(existing.avatar, existing.name) },
      created: false,
    }
  }

  const target = robotDirectory(robotsDir, trimmed)
  if (target === null) throw invalidNameError(trimmed)
  const canonical = await ensureRobotDirectory(target, trimmed)

  const used = registry.robots.map((robot) => resolveAvatar(robot.avatar, robot.name))
  const robot = {
    name: trimmed,
    path: canonical,
    createdAt: new Date().toISOString(),
    avatar: isAvatarId(avatar) ? avatar : pickDefaultAvatar(trimmed, used),
    description: cleanDescription,
  }
  await writeRobotRegistry({
    file: registryFile,
    robots: [robot, ...registry.robots.filter((entry) => entry.name !== trimmed)],
  })
  return { robot, created: true }
}

/**
 * 改一个机器人的头像：只动登记表里的 `avatar` 字段，不碰目录与工作区。
 *
 * - 头像 id 不属于预设集合抛 `code = 'invalid-avatar'`；
 * - 名字不在登记表里抛 `code = 'unknown-robot'`；
 * - 登记文件损坏抛 `code = 'registry-unreadable'`。
 *
 * @param {{ file: string, name: string, avatar: string }} options
 * @returns {Promise<{ robot: { name: string, path: string, createdAt: string, avatar: string } }>}
 */
export async function setRobotAvatar({ file, name, avatar } = {}) {
  const registryFile = requireRegistryFile(file)
  if (!isValidRobotName(name)) throw invalidNameError(name)
  if (!isAvatarId(avatar)) throw invalidAvatarError(avatar)

  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const trimmed = name.trim()
  const current = registry.robots.find((robot) => robot.name === trimmed)
  if (current === undefined) throw unknownRobotError(trimmed)

  const robot = { ...current, avatar }
  await writeRobotRegistry({
    file: registryFile,
    robots: registry.robots.map((entry) => (entry.name === trimmed ? robot : entry)),
  })
  return { robot }
}

/**
 * 改一个机器人的描述：只动登记表里的 `description` 字段，不碰目录与工作区。
 *
 * 描述是给工作流选择机器人看的一行摘要（类似 skill 的 description），存储前
 * 会折叠空白；空串表示清空。超过上限抛 `code = 'invalid-description'`。
 *
 * @param {{ file: string, name: string, description: string }} options
 * @returns {Promise<{ robot: { name: string, path: string, createdAt: string, avatar: string, description: string } }>}
 */
export async function setRobotDescription({ file, name, description } = {}) {
  const registryFile = requireRegistryFile(file)
  if (!isValidRobotName(name)) throw invalidNameError(name)
  if (typeof description !== 'string') throw invalidDescriptionError(description)
  const clean = normalizeRobotDescription(description)
  if (clean.length > ROBOT_DESCRIPTION_MAX_LENGTH) throw invalidDescriptionError(description)

  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const trimmed = name.trim()
  const current = registry.robots.find((robot) => robot.name === trimmed)
  if (current === undefined) throw unknownRobotError(trimmed)

  const robot = { ...current, description: clean }
  await writeRobotRegistry({
    file: registryFile,
    robots: registry.robots.map((entry) => (entry.name === trimmed ? robot : entry)),
  })
  return { robot }
}

/**
 * 重命名一个机器人：把机器人目录改名为新名字，并就地更新登记表里的
 * `name` 与 `path`。
 *
 * - 名称规则与新建一致；新名等于旧名时按 no-op 返回（`renamed: false`），
 *   不碰磁盘与登记表；
 * - 新名不能与登记表里其它机器人重名，也不能与 `robotsDir` 下已存在的目录
 *   重名（抛 `code = 'name-taken'`），避免两个登记条目指向同一个目录；内置
 *   「通用型机器人」的名字也保留，不能被普通机器人占用；
 * - 大小写不敏感的文件系统（macOS 默认）上允许只改大小写：目标路径与旧目录
 *   是同一个目录时继续改名，而不是误判成「目标已存在」；
 * - 只移动 `robotsDir` 的直接子目录：登记表被手改到别处时拒绝
 *   （`code = 'path-outside-root'`），不会把用户目录搬进机器人根目录；
 * - 条目里的 `createdAt` / `avatar` / `description` 不变，`avatar` 按**旧名**
 *   解析成具体 id 后写回，避免旧记录缺头像时改名让头像跟着名字哈希漂移；
 * - `AGENTS.md` 仍与旧名 / 旧路径生成的模板完全一致时改写为新模板，用户改过
 *   就保持原样（不覆盖用户内容）；
 * - 登记表写失败时把目录改回旧名再抛错，失败后磁盘与登记表仍然一致。
 *
 * 目录改名后 `CLAUDE.md` 的相对软链接自然继续有效；工作区重建由
 * `builder.js` 负责（本模块不 import DSH 包）。
 *
 * @param {{ robotsDir: string, file: string, name: string, newName: string }} options
 * @returns {Promise<{
 *   robot: { name: string, path: string, createdAt: string, avatar: string, description: string },
 *   previousName: string,
 *   renamed: boolean,
 *   agentsRewritten: boolean,
 * }>}
 */
export async function renameRobot({ robotsDir, file, name, newName } = {}) {
  const registryFile = requireRegistryFile(file)
  if (!isValidRobotName(name)) throw invalidNameError(name)
  const trimmed = name.trim()
  const nextName = typeof newName === 'string' ? newName.trim() : ''
  if (!isValidRobotName(nextName)) throw invalidNameError(newName)

  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const current = registry.robots.find((robot) => robot.name === trimmed)
  if (current === undefined) throw unknownRobotError(trimmed)

  // 名称没变：当作 no-op（页面会禁用保存；工具可能带着相同值调用）。
  if (nextName === current.name) {
    return {
      robot: { ...current, avatar: resolveAvatar(current.avatar, current.name) },
      previousName: current.name,
      renamed: false,
      agentsRewritten: false,
    }
  }

  if (registry.robots.some((robot) => robot.name === nextName)) {
    throw Object.assign(new Error(`机器人名称已被占用：${nextName}`), { code: 'name-taken' })
  }
  // 内置「通用型机器人」不在登记表里，但它的名字是保留的：普通机器人叫这个名字
  // 会让工具清单 / 工作流选择出现两个同名条目。
  if (isGeneralRobotName(nextName)) {
    throw Object.assign(new Error(`机器人名称是内置「${nextName}」保留名，不能使用`), {
      code: 'name-taken',
    })
  }

  const configuredRoot =
    typeof robotsDir === 'string' && robotsDir.trim() !== ''
      ? path.resolve(robotsDir)
      : path.resolve(defaultRobotsRoot())
  const root = await realpathOr(configuredRoot, configuredRoot)
  const oldDirectory = path.resolve(current.path)

  // 只允许移动 robotsDir 的直接子目录：登记表被手改到别处时不要动用户的目录。
  const parent = await realpathOr(path.dirname(oldDirectory), path.dirname(oldDirectory))
  if (parent !== root) {
    throw Object.assign(new Error(`机器人目录不在机器人根目录下，拒绝重命名：${oldDirectory}`), {
      code: 'path-outside-root',
    })
  }

  if (!(await isDirectory(oldDirectory))) {
    throw Object.assign(new Error(`机器人目录不存在或不是目录：${oldDirectory}`), {
      code: 'missing-directory',
    })
  }

  const target = path.join(root, nextName)
  let targetExists = false
  try {
    await fs.lstat(target)
    targetExists = true
  } catch {
    targetExists = false
  }
  if (targetExists) {
    // 大小写不敏感的文件系统上，`writer` → `Writer` 会让严格比较「已存在」；
    // 两者 realpath 相同说明是同一个目录，允许继续做纯大小写改名。
    const [targetReal, oldReal] = await Promise.all([realpathOrNull(target), realpathOrNull(oldDirectory)])
    if (targetReal === null || oldReal === null || targetReal !== oldReal) {
      throw Object.assign(new Error(`目标目录已存在，无法重命名为 ${nextName}：${target}`), {
        code: 'name-taken',
      })
    }
  }

  try {
    await fs.rename(oldDirectory, target)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw Object.assign(new Error(`重命名机器人目录失败：${reason}`), {
      code: 'rename-failed',
      cause: error,
    })
  }

  const canonical = await realpathOr(target, target)

  const next = {
    ...current,
    name: nextName,
    path: canonical,
    avatar: resolveAvatar(current.avatar, current.name),
  }
  try {
    await writeRobotRegistry({
      file: registryFile,
      robots: registry.robots.map((robot) => (robot.name === current.name ? next : robot)),
    })
  } catch (error) {
    // 登记表写失败：把目录改回去，失败后磁盘与登记表仍指向同一处。
    try {
      await fs.rename(canonical, oldDirectory)
    } catch {
      // 回滚也失败时保留原始错误（页面会提示登记表未更新）。
    }
    throw error
  }

  // 模板同步是锦上添花：只有 AGENTS.md 还是创建时那份模板才改写，
  // 缺失 / 读不了 / 写不了都不影响改名结果（登记已经指向新名字）。
  let agentsRewritten = false
  try {
    const agentsFile = path.join(canonical, AGENTS_FILE)
    const text = await fs.readFile(agentsFile, 'utf8')
    if (text === robotAgentsTemplate(current.name, oldDirectory)) {
      await fs.writeFile(agentsFile, robotAgentsTemplate(nextName, canonical), 'utf8')
      agentsRewritten = true
    }
  } catch {
    // 忽略：用户可能已经删掉或替换了 AGENTS.md。
  }

  try {
    await ensureClaudeLink(canonical)
  } catch {
    // 链接修复失败不影响改名本身；列表刷新时会再补一次。
  }

  return {
    robot: { ...next, avatar: resolveAvatar(next.avatar, next.name) },
    previousName: current.name,
    renamed: true,
    agentsRewritten,
  }
}

/**
 * 从登记表移除一个机器人：**目录不删**（目录、文件与会话都保留）。
 *
 * 登记文件损坏抛 `code = 'registry-unreadable'`；未知名字返回
 * `{ removed: false }`，不写文件。
 *
 * @param {{ file: string, name: string }} options
 * @returns {Promise<{ removed: boolean }>}
 */
export async function removeRobot({ file, name } = {}) {
  const registryFile = requireRegistryFile(file)
  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const trimmed = typeof name === 'string' ? name.trim() : ''
  const remaining = registry.robots.filter((robot) => robot.name !== trimmed)
  if (remaining.length === registry.robots.length) return { removed: false }

  await writeRobotRegistry({ file: registryFile, robots: remaining })
  return { removed: true }
}

// ---- 列表与挂载状态 ------------------------------------------------------

/**
 * 汇总登记表里的机器人：目录是否存在、是否已挂到 DSH 工作区，以及每个
 * 机器人自己的项目级 skills 与 AGENTS.md。
 *
 * 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
 * realpath 规范值），机器人路径用 `fs.realpath`（失败回退 `path.resolve`）。
 * 登记文件损坏时返回 `corrupt: true` 与空列表。
 *
 * @param {{
 *   file: string,
 *   workspaceRegistry?: { list: () => Array<Record<string, unknown>> },
 *   robotsDir?: string,
 * }} options
 * @returns {Promise<{
 *   root: string,
 *   registry: string,
 *   corrupt: boolean,
 *   robots: Array<{
 *     name: string,
 *     path: string,
 *     createdAt: string,
 *     avatar: string,
 *     exists: boolean,
 *     mounted: boolean,
 *     workspaceId: string | null,
 *     skills: Array<{ name: string, description: string, source: string | null }>,
 *     agents: { exists: boolean, bytes: number, modifiedAt: string | null, content: string, tooLarge: boolean },
 *     claude: { exists: boolean, symlink: boolean, mode: string, target: string },
 *   }>,
 * }>}
 */
export async function listRobots({ file, workspaceRegistry, robotsDir } = {}) {
  const registryFile = requireRegistryFile(file)
  const root =
    typeof robotsDir === 'string' && robotsDir.trim() !== ''
      ? path.resolve(robotsDir)
      : path.join(path.dirname(registryFile), 'robots')
  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) return { root, registry: registryFile, corrupt: true, robots: [] }

  const workspaceByPath = await indexWorkspaces(workspaceRegistry)
  const robots = []
  for (const entry of registry.robots) {
    const canonical = await realpathOr(entry.path, path.resolve(entry.path))
    const workspace = workspaceByPath.get(canonical) ?? workspaceByPath.get(path.resolve(entry.path))

    const exists = await isDirectory(canonical)
    let skills = []
    try {
      skills = (await scanProjectSkills(canonical)).skills
    } catch {
      skills = []
    }
    let agents = emptyAgentsFile()
    try {
      agents = await readAgentsFile(canonical)
    } catch {
      agents = emptyAgentsFile()
    }

    // 旧机器人（创建时还没有 CLAUDE.md 链接）在列清单时自动补上：
    // 只有机器人目录和 AGENTS.md 都在才建，避免留下悬空链接。
    let claude = { exists: false, symlink: false, mode: 'missing', target: '' }
    try {
      claude = exists && agents.exists ? await ensureClaudeLink(canonical) : await readClaudeLink(canonical)
    } catch {
      claude = { exists: false, symlink: false, mode: 'missing', target: '' }
    }

    robots.push({
      name: entry.name,
      path: entry.path,
      createdAt: entry.createdAt,
      avatar: resolveAvatar(entry.avatar, entry.name),
      description: entry.description,
      exists,
      mounted: workspace !== undefined,
      workspaceId: workspace === undefined ? null : String(workspace.id),
      skills,
      agents,
      claude,
    })
  }
  return { root, registry: registryFile, corrupt: false, robots }
}

// ---- 工作区清单（通用型机器人「进入工作区」对话框用） ----------------------

/**
 * 把 DSH 的工作区注册表投影成页面用的紧凑清单，保留注册表顺序。
 *
 * 通用型机器人的「进入工作区」对话框用它列出现有工作区；页面不自己排序，
 * 标题缺省时回落到路径（与 DSH 侧边栏一致）。注册表不可用时返回空表。
 *
 * @param {{ list?: () => Array<Record<string, unknown>> } | undefined} workspaceRegistry
 * @returns {Array<{ id: string, title: string, path: string, sessions: number }>}
 */
export function summarizeWorkspaces(workspaceRegistry) {
  let snapshot
  try {
    snapshot = workspaceRegistry?.list?.()
  } catch {
    snapshot = undefined
  }
  return (Array.isArray(snapshot) ? snapshot : [])
    .filter((workspace) => workspace !== null && typeof workspace === 'object')
    .map((workspace) => ({
      id: String(workspace.id),
      title:
        typeof workspace.title === 'string' && workspace.title.trim() !== ''
          ? workspace.title
          : String(workspace.path ?? ''),
      path: String(workspace.path ?? ''),
      sessions: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
    }))
}

/**
 * 建「规范路径 → 工作区」索引。工作区路径同时按 `path.resolve` 与
 * `fs.realpath` 登记（后者成功时才登记），机器人侧用 realpath 对齐，
 * 这样缓存目录本身是符号链接时也能正确判断挂载。
 *
 * @param {{ list: () => Array<Record<string, unknown>> } | undefined} workspaceRegistry
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
async function indexWorkspaces(workspaceRegistry) {
  const index = new Map()
  let workspaces = []
  try {
    const snapshot = workspaceRegistry?.list?.()
    workspaces = Array.isArray(snapshot) ? snapshot : []
  } catch {
    workspaces = []
  }
  for (const workspace of workspaces) {
    if (workspace === null || typeof workspace !== 'object') continue
    if (typeof workspace.path !== 'string' || workspace.path.trim() === '') continue
    const resolved = path.resolve(workspace.path)
    if (!index.has(resolved)) index.set(resolved, workspace)
    const real = await realpathOrNull(workspace.path)
    if (real !== null && !index.has(real)) index.set(real, workspace)
  }
  return index
}

// ---- 单机器人的 skills / AGENTS.md --------------------------------------

/**
 * 极简 YAML frontmatter 解析：只取顶层的 `name` 与 `description`。
 *
 * 支持单行标量与单/双引号标量；没有 frontmatter、frontmatter 未闭合或
 * 两个字段都不存在时返回空对象。解析失败不抛错——skill 仍然要被列出来，
 * 只是元数据回退到目录名与空描述。
 *
 * @param {unknown} text 文件全文
 * @returns {{ name?: string, description?: string }}
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return {}
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') return {}
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end < 0) return {}

  /** @type {{ name?: string, description?: string }} */
  const result = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line)
    if (match === null) continue
    const key = match[1]
    if (key !== 'name' && key !== 'description') continue
    if (result[key] !== undefined) continue
    result[key] = stripQuotes(match[2].trim())
  }
  return result
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
 * 扫描一个工作区的项目级 skills。
 *
 * 两个根目录里的条目都算：带 `SKILL.md` 的子目录，以及根下平铺的 `<name>.md`。
 * 名字优先取 frontmatter，缺省回退目录名/文件名；`source` 从
 * `<path>/skills-lock.json` 的 `skills.<name>` 里取 `source`（缺省回退
 * `sourceUrl`），取不到就是 null。单个条目读不了（坏链接、权限、ENOTDIR）
 * 时跳过，整次扫描不抛错。
 *
 * @param {unknown} workspacePath 工作区绝对路径
 * @returns {Promise<{ skills: Array<{ name: string, description: string, source: string | null }> }>}
 */
export async function scanProjectSkills(workspacePath) {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') return { skills: [] }
  const base = path.resolve(workspacePath)
  const lock = await readProjectLock(base)

  /** @type {Map<string, { name: string, description: string, source: string | null, kind: 'directory' | 'file' }>} */
  const byName = new Map()

  for (const relativeRoot of PROJECT_SKILL_ROOTS) {
    const skillsDir = path.join(base, relativeRoot)
    for (const dirent of await readDirents(skillsDir)) {
      if (dirent.name.startsWith('.')) continue
      const full = path.join(skillsDir, dirent.name)

      let stat
      try {
        // 跟随符号链接：npx 也可能用链接把 skill 接进项目。
        stat = await fs.stat(full)
      } catch {
        continue
      }

      let file
      let kind
      let fallbackName
      if (stat.isDirectory()) {
        file = path.join(full, 'SKILL.md')
        kind = 'directory'
        fallbackName = dirent.name
      } else if (stat.isFile() && dirent.name.endsWith('.md')) {
        file = full
        kind = 'file'
        fallbackName = dirent.name.slice(0, -3)
      } else {
        continue
      }

      let text
      try {
        text = await fs.readFile(file, 'utf8')
      } catch {
        // 目录里没有 SKILL.md、文件读不了：这一个条目跳过。
        continue
      }

      const front = parseFrontmatter(text)
      const name = typeof front.name === 'string' && front.name !== '' ? front.name : fallbackName
      const description = typeof front.description === 'string' ? front.description : ''
      const entry = { name, description, source: lockSource(lock, name, fallbackName), kind }

      const existing = byName.get(name)
      // 同名时保留目录形式（与 DSH 的 skill 发现优先级一致）。
      if (existing === undefined || (existing.kind === 'file' && entry.kind === 'directory')) {
        byName.set(name, entry)
      }
    }
  }

  const skills = [...byName.values()]
    .map(({ name, description, source }) => ({ name, description, source }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return { skills }
}

/**
 * 读项目级 `skills-lock.json` 的 `skills` 表；文件缺失、非法 JSON 或结构
 * 不对时按空表处理（只是所有 skill 都显示为没有来源）。
 *
 * @param {string} workspacePath 工作区绝对路径
 * @returns {Promise<Record<string, unknown>>}
 */
async function readProjectLock(workspacePath) {
  let text
  try {
    text = await fs.readFile(path.join(workspacePath, PROJECT_LOCK_FILE), 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return {}
    const skills = parsed.skills
    if (skills === null || typeof skills !== 'object' || Array.isArray(skills)) return {}
    return skills
  } catch {
    return {}
  }
}

/**
 * 从 lockfile 的 `skills` 表里取一个条目的来源。
 *
 * 依次尝试 skill 的展示名与安装目录名（frontmatter 里的名字可能和目录不同），
 * 条目里优先 `source`、其次 `sourceUrl`；都没有就返回 null。
 *
 * @param {Record<string, unknown>} lock
 * @param {...string} names 候选键
 * @returns {string | null}
 */
function lockSource(lock, ...names) {
  for (const name of names) {
    const record = lock[name]
    if (record === null || typeof record !== 'object') continue
    if (typeof record.source === 'string' && record.source.trim() !== '') return record.source.trim()
    if (typeof record.sourceUrl === 'string' && record.sourceUrl.trim() !== '') return record.sourceUrl.trim()
  }
  return null
}

/**
 * 读目录项；目录不存在或不是目录时当作空目录。
 *
 * @param {string} dir
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function readDirents(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * 空的 AGENTS.md 摘要；文件不存在或读不了时用它，保证响应结构稳定。
 *
 * @returns {{ exists: boolean, bytes: number, modifiedAt: string | null, content: string, tooLarge: boolean }}
 */
export function emptyAgentsFile() {
  return { exists: false, bytes: 0, modifiedAt: null, content: '', tooLarge: false }
}

/**
 * 读 `<path>/AGENTS.md`。
 *
 * 文件存在且不超过 256 KiB 时返回全文；超过上限时只返回大小与
 * `tooLarge: true`，`content` 为空串（页面不会把大文件塞进 textarea）。
 *
 * @param {unknown} workspacePath 工作区绝对路径
 * @returns {Promise<{ exists: boolean, bytes: number, modifiedAt: string | null, content: string, tooLarge: boolean }>}
 */
export async function readAgentsFile(workspacePath) {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') return emptyAgentsFile()
  const file = path.join(workspacePath, AGENTS_FILE)

  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return emptyAgentsFile()
  }
  if (!stat.isFile()) return emptyAgentsFile()

  const modifiedAt = new Date(stat.mtimeMs).toISOString()
  if (stat.size > AGENTS_MAX_READ_BYTES) {
    return { exists: true, bytes: stat.size, modifiedAt, content: '', tooLarge: true }
  }

  try {
    const content = await fs.readFile(file, 'utf8')
    return {
      exists: true,
      bytes: Buffer.byteLength(content, 'utf8'),
      modifiedAt,
      content,
      tooLarge: false,
    }
  } catch {
    // 读权限问题不影响其它机器人：只当这个文件没有可展示的内容。
    return { exists: true, bytes: stat.size, modifiedAt, content: '', tooLarge: false }
  }
}

/**
 * 直接写 `<path>/AGENTS.md`（UTF-8），返回写入的字节数与新的修改时间。
 * 上限检查由路由做（512 KiB）；目录不存在时这里会抛错，由路由转成 409/500。
 *
 * @param {string} workspacePath 工作区绝对路径
 * @param {unknown} content 新的全文
 * @returns {Promise<{ bytes: number, modifiedAt: string }>}
 */
export async function writeAgentsFile(workspacePath, content) {
  if (typeof workspacePath !== 'string' || workspacePath === '') {
    throw new Error('缺少工作区目录')
  }
  const text = typeof content === 'string' ? content : String(content ?? '')
  const file = path.join(workspacePath, AGENTS_FILE)
  await fs.writeFile(file, text, 'utf8')
  const stat = await fs.stat(file)
  return { bytes: Buffer.byteLength(text, 'utf8'), modifiedAt: new Date(stat.mtimeMs).toISOString() }
}

/**
 * 新机器人的 AGENTS.md 模板；路径与名字都是磁盘上的真实值。
 *
 * @param {string} name 机器人名字
 * @param {string} robotPath 机器人绝对目录
 * @returns {string}
 */
function robotAgentsTemplate(name, robotPath) {
  return `# AGENTS.md

这是「${name}」机器人的协作说明。这个目录同时是一个 DSH 工作区。

## 项目

- 路径：\`${robotPath}\`
- 用途：

## 约定

- 动手前先读仓库里已有的文档、脚本与测试。
- 提交信息用 Conventional Commits；一个 commit 只做一件事。
`
}

// ---- 小工具 --------------------------------------------------------------

/**
 * 判断路径存在且是目录。
 *
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function isDirectory(target) {
  if (typeof target !== 'string' || target === '') return false
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * 判断路径是否存在。
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
 * `fs.realpath`，失败时回退到调用方给的路径。
 *
 * @param {string} target
 * @param {string} fallback
 * @returns {Promise<string>}
 */
async function realpathOr(target, fallback) {
  const real = await realpathOrNull(target)
  return real ?? fallback
}

/**
 * `fs.realpath`，失败时返回 null。
 *
 * @param {string} target
 * @returns {Promise<string | null>}
 */
async function realpathOrNull(target) {
  try {
    return await fs.realpath(target)
  } catch {
    return null
  }
}
