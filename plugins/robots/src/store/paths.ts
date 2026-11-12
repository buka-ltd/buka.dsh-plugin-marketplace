/**
 * 机器人存储层的路径、名称与文件系统小工具。
 *
 * 插件全局目录固定在 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`，默认
 * 机器人根目录是它下面的 `robots`，登记文件是根目录同级的 `robots.json`。
 * 路径展开、名称校验与 realpath 兜底都集中在这里，便于用临时目录单测。
 *
 * @module @buka/dsh-plugin-robots/store/paths
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

/**
 * 登记文件格式版本。
 *
 * version 2 新增 `driver`（agent / program）与 `assistant`；读旧版（version 1）
 * 登记表时按 agent / false 迁移，下一次写入落盘成 version 2。
 */
export const ROBOT_REGISTRY_VERSION = 2

/** 仍可读取的旧版登记表版本；读入时迁移到当前版本。 */
export const ROBOT_REGISTRY_LEGACY_VERSIONS: readonly number[] = [1]

/**
 * 机器人名称的合法字符集：字母、数字（含汉字等 Unicode 字母/数字）开头，
 * 后面可以跟 `._-`。点开头、路径分隔符与 NUL 都被这个正则排除。
 */
const ROBOT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u

/**
 * 取用户 home 目录：优先用注入环境里的 `HOME`，否则用 `os.homedir()`。
 * 测试传临时 env 时不会碰真实 home。
 *
 */
function homeDir(env: NodeJS.ProcessEnv | undefined): string {
  const configured = typeof env?.HOME === 'string' ? env.HOME.trim() : ''
  if (
    configured !== '' &&
    configured !== '~' &&
    !configured.startsWith('~/') &&
    !configured.startsWith('~\\')
  ) {
    return configured
  }
  return os.homedir()
}

/**
 * 展开开头的 `~`；其它值原样返回。
 *
 */
function expandPath(value: string, env: NodeJS.ProcessEnv | undefined): string {
  const text = value.trim()
  if (text === '~') return homeDir(env)
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(homeDir(env), text.slice(2))
  return text
}

/**
 * 读一个可选的路径型环境变量：去空白、展开 `~`，空值返回 null。
 *
 */
function envPath(value: unknown, env: NodeJS.ProcessEnv | undefined): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  return expandPath(text, env)
}

/**
 * 插件全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`。
 *
 */
export function pluginCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), '.cache')
  return path.join(cacheHome, PLUGIN_CACHE_DIR)
}

/**
 * 机器人根目录的默认位置：`<插件全局目录>/robots`。
 *
 */
export function defaultRobotsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(pluginCacheDir(env), 'robots')
}

/**
 * 把配置里的根目录解析成绝对路径：空值回退默认目录，展开开头的 `~`，
 * 相对路径按当前进程目录解析。
 *
 */
export function resolveRobotsDir(
  configured?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const text = typeof configured === 'string' ? configured.trim() : ''
  if (text === '') return path.resolve(defaultRobotsRoot(env))
  return path.resolve(expandPath(text, env))
}

/**
 * 登记文件路径：固定为机器人根目录的**同级** `robots.json`。
 *
 */
export function resolveRobotRegistryFile(robotsDir: string): string {
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
 */
export function isValidRobotName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const text = name.trim()
  if (text.length < 1 || text.length > 64) return false
  if (text === '.' || text === '..') return false
  return ROBOT_NAME_PATTERN.test(text)
}

/**
 * 机器人名字对应的绝对目录；名字不合法或解析后跑出根目录时返回 null。
 *
 */
export function robotDirectory(robotsDir: unknown, name: unknown): string | null {
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
 */
export function requireRegistryFile(file: unknown): string {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new Error('缺少机器人登记文件路径')
  }
  return path.resolve(file)
}

// ---- 小工具 --------------------------------------------------------------

/**
 * 判断路径存在且是目录。
 *
 */
export async function isDirectory(target: string): Promise<boolean> {
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
 */
export async function pathExists(target: string): Promise<boolean> {
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
 */
export async function realpathOr(target: string, fallback: string): Promise<string> {
  const real = await realpathOrNull(target)
  return real ?? fallback
}

/**
 * `fs.realpath`，失败时返回 null。
 *
 */
export async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target)
  } catch {
    return null
  }
}
