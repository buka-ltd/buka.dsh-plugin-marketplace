/**
 * 打工人存储层的路径、标识符与文件系统小工具。
 *
 * 插件全局目录固定在 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workers`，默认
 * 打工人根目录是它下面的 `workers`，登记文件是根目录同级的 `workers.json`。
 * 路径展开、标识符校验（新格式 / 旧格式兼容）与 realpath 兜底都集中在这里，
 * 便于用临时目录单测。
 *
 * @module @buka/dsh-plugin-workers/store/paths
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 每个打工人工作区里的协作说明文件名。 */
export const AGENTS_FILE = 'AGENTS.md'

/**
 * Claude Code 读取的项目说明文件名。打工人目录里固定把它做成指向 AGENTS.md
 * 的符号链接，两份工具读同一份内容；平台不允许建链接时改写 `@AGENTS.md`。
 */
export const CLAUDE_FILE = 'CLAUDE.md'

/** 页面直接展示 AGENTS.md 全文的上限（256 KiB）；超过只显示大小提示。 */
export const AGENTS_MAX_READ_BYTES = 256 * 1024

/** 允许通过页面写回 AGENTS.md 的上限（512 KiB）；超出由路由返回 413。 */
export const AGENTS_MAX_WRITE_BYTES = 512 * 1024

/** 打工人描述上限（UTF-16 长度）；描述是给工作流选择打工人看的一行摘要。 */
export const WORKER_DESCRIPTION_MAX_LENGTH = 500

/** 模型选择里 provider / model / reasoningEffort 每一项的长度上限。 */
export const WORKER_MODEL_PART_MAX_LENGTH = 200

/** 插件全局目录名；位于 `${XDG_CACHE_HOME:-~/.cache}` 下。 */
export const PLUGIN_CACHE_DIR = 'dsh-plugin-workers'

/** 登记文件名；固定放在打工人根目录的父目录里。 */
export const WORKER_REGISTRY_FILE = 'workers.json'

/**
 * 登记文件格式版本。
 *
 * version 4 把打工人拆成「不可变标识符 `id` + 可选展示名 `name`」：读
 * version 1 / 2 / 3 旧表时在内存里迁移（`id` 取旧 `name`、`name` 置空），
 * 下一次写入落盘成 version 4。version 3 的 `driver: "robot"` 与 version 2 的
 * `driver: "program"` 迁移关系不变。
 */
export const WORKER_REGISTRY_VERSION = 4

/** 仍可读取的旧版登记表版本；读入时迁移到当前版本。 */
export const WORKER_REGISTRY_LEGACY_VERSIONS: readonly number[] = [1, 2, 3]

/** 旧插件的全局目录名；启动时一次性搬到 `PLUGIN_CACHE_DIR`。 */
export const LEGACY_PLUGIN_CACHE_DIR = 'dsh-plugin-robots'

/**
 * 新标识符的合法字符集：小写字母开头，后面可以跟小写字母、数字、`_` 与 `-`，
 * 总长 1–64。标识符同时是目录名与引用键，所以只允许不需要转义的 ASCII。
 */
const WORKER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

/**
 * 旧登记表里的名字（迁移后成为旧标识符）的合法字符集：字母、数字（含汉字等
 * Unicode 字母/数字）开头，后面可以跟 `._-`。点开头、路径分隔符与 NUL 都被
 * 这个正则排除。
 */
const LEGACY_WORKER_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u

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
 * 插件全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workers`。
 *
 */
export function pluginCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), '.cache')
  return path.join(cacheHome, PLUGIN_CACHE_DIR)
}

/**
 * 旧插件的全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`。
 *
 * 只用于一次性迁移（见 `store/migrate.ts`）；新代码不要再往这里写。
 */
export function legacyPluginCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), '.cache')
  return path.join(cacheHome, LEGACY_PLUGIN_CACHE_DIR)
}

/**
 * 打工人根目录的默认位置：`<插件全局目录>/workers`。
 *
 */
export function defaultWorkersRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(pluginCacheDir(env), 'workers')
}

/**
 * 把配置里的根目录解析成绝对路径：空值回退默认目录，展开开头的 `~`，
 * 相对路径按当前进程目录解析。
 *
 */
export function resolveWorkersDir(
  configured?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const text = typeof configured === 'string' ? configured.trim() : ''
  if (text === '') return path.resolve(defaultWorkersRoot(env))
  return path.resolve(expandPath(text, env))
}

/**
 * 登记文件路径：固定为打工人根目录的**同级** `workers.json`。
 *
 */
export function resolveWorkerRegistryFile(workersDir: string): string {
  const base =
    typeof workersDir === 'string' && workersDir.trim() !== ''
      ? path.resolve(workersDir)
      : path.resolve(defaultWorkersRoot())
  return path.join(path.dirname(base), WORKER_REGISTRY_FILE)
}

/**
 * 判断一个值是不是**新**打工人标识符。
 *
 * 规则：trim 后匹配 `^[a-z][a-z0-9_-]{0,63}$`。只有创建新打工人时使用这条
 * 严格规则；读写已有条目时用 `isResolvableWorkerId`，它同时接受迁移来的旧
 * 标识符（旧登记表里的名字，可能含汉字、大写或 `._`）。
 *
 */
export function isValidWorkerId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  return WORKER_ID_PATTERN.test(id.trim())
}

/**
 * 判断一个值是不是迁移来的**旧**标识符（旧登记表里的 `name`）。
 *
 * 旧标识符不受新字符集约束：trim 后 1–64 个字符，不能是 `.` / `..`，不能以
 * `.` 开头，不能包含 `/`、`\`、NUL，允许 Unicode 字母、数字与 `._-`。
 *
 */
export function isLegacyWorkerId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  const text = id.trim()
  if (text.length < 1 || text.length > 64) return false
  if (text === '.' || text === '..') return false
  return LEGACY_WORKER_ID_PATTERN.test(text)
}

/**
 * 判断一个标识符能否用来定位已有打工人：新标识符或迁移来的旧标识符都接受。
 *
 * 更新 / 改名 / 删除 / 解析路由都走这条判定；创建新打工人只走
 * `isValidWorkerId`，避免新记录再落一个旧格式的标识符。
 *
 */
export function isResolvableWorkerId(id: unknown): id is string {
  return isValidWorkerId(id) || isLegacyWorkerId(id)
}

/**
 * 打工人标识符对应的绝对目录；标识符不合法或解析后跑出根目录时返回 null。
 *
 */
export function workerDirectory(workersDir: unknown, id: unknown): string | null {
  if (!isResolvableWorkerId(id)) return null
  if (typeof workersDir !== 'string' || workersDir.trim() === '') return null
  const base = path.resolve(workersDir)
  const target = path.resolve(base, id.trim())
  // 防御性检查：模板已经排除了分隔符，这里仍然确认目标是根目录的直接子项。
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
    throw new Error('缺少打工人登记文件路径')
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
