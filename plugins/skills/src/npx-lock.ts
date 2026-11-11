/**
 * `npx skills` 全局 lockfile 的解析。
 *
 * `npx skills` 把全局安装记录写进自己的 lockfile：默认是
 * `~/.agents/.skill-lock.json`，但设置了 `XDG_STATE_HOME` 时改写到
 * `$XDG_STATE_HOME/skills/.skill-lock.json`（与 CLI 的 `getSkillLockPath()` 一致，
 * 所以这里必须按同样的规则解析）。lockfile 是 `version: 3`，键是 skill 名。
 *
 * @module @buka/dsh-plugin-skills/npx-lock
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Homes } from './homes.ts'
import { envPath } from './homes.ts'

/** `npx skills` 的 lockfile 文件名。 */
export const NPX_LOCK_FILE = '.skill-lock.json'

/** 本模块认识的 lockfile 版本；更旧的版本 CLI 会当作空 lockfile。 */
export const NPX_LOCK_VERSION = 3

/** `npx skills` 全局 lockfile 的解析结果。 */
export interface NpxLock {
  readonly exists: boolean
  readonly path: string
  readonly version: number | null
  readonly skills: Record<string, unknown>
  readonly corrupt: boolean
}

/**
 * `npx skills` 的全局 lockfile 位置，规则与 CLI 的 `getSkillLockPath()` 一致：
 * 设置了 `XDG_STATE_HOME` 时在 `$XDG_STATE_HOME/skills/`，否则在 `~/.agents/`。
 */
export function lockFileFor(
  homes: Pick<Homes, 'agentsHome'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdgStateHome = envPath(env.XDG_STATE_HOME)
  return xdgStateHome === null
    ? path.join(homes.agentsHome, NPX_LOCK_FILE)
    : path.join(xdgStateHome, 'skills', NPX_LOCK_FILE)
}

/**
 * 读 `npx skills` 的全局 lockfile。
 *
 * - 文件不存在：`exists: false`，所有 skill 按手工安装展示；
 * - 存在但无法解析 / 结构不对 / 版本比本模块认识的旧：`corrupt: true`，
 *   `skills` 为空。此时**不能**据此判断某个 skill 不是 npx 管理的（CLI 会忽略
 *   旧版本 lockfile，而旧记录里仍可能写着安装来源），卸载前要求先修复它。
 *
 * @param file lockfile 绝对路径
 */
export async function readNpxLock(file: string): Promise<NpxLock> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
      return { exists: false, path: file, version: null, skills: {}, corrupt: false }
    }
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }
  const record = parsed as { version?: unknown; skills?: unknown }
  if (record.skills === null || typeof record.skills !== 'object') {
    return { exists: true, path: file, version: null, skills: {}, corrupt: true }
  }

  const version = typeof record.version === 'number' ? record.version : null
  // CLI 的 readSkillLock() 对 version < 3 返回空 lockfile；这里跟随它，
  // 但标记 corrupt，让页面提示而不是静默把 npx 管理的 skill 当成手工安装。
  if (version === null || version < NPX_LOCK_VERSION) {
    return { exists: true, path: file, version, skills: {}, corrupt: true }
  }

  return {
    exists: true,
    path: file,
    version,
    skills: record.skills as Record<string, unknown>,
    corrupt: false,
  }
}

/**
 * 从 lockfile 记录里取出安装目录名（`skills/<name>/SKILL.md` 的 `<name>` 段）。
 *
 * @param skillPath lockfile 的 `skillPath`
 */
function folderOfSkillPath(skillPath: unknown): string | null {
  if (typeof skillPath !== 'string') return null
  const segments = skillPath.split('/').filter((segment) => segment !== '')
  if (segments.length < 2 || segments[segments.length - 1] !== 'SKILL.md') return null
  return segments[segments.length - 2] ?? null
}

/**
 * 某个安装目录名对应的 npx lockfile 记录；找不到时返回 null。
 *
 * 先按 lock 键匹配（CLI 的规范目录名就是键），再兼容「规范目录名与键不同」的
 * 情况：lock 记录的 `skillPath` 目录段也能说明它装进了哪个目录。列表与卸载都
 * 用这一个判定，避免页面标了「npx skills」却走了直接删除分支。
 *
 * @param lock lockfile 的解析结果
 * @param id 安装目录名
 */
export function npxRecordFor(
  lock: Pick<NpxLock, 'skills'>,
  id: string,
): Record<string, unknown> | null {
  const direct = lock.skills[id]
  if (direct !== undefined) {
    return direct !== null && typeof direct === 'object' ? (direct as Record<string, unknown>) : {}
  }

  for (const value of Object.values(lock.skills)) {
    if (value === null || typeof value !== 'object') continue
    if (folderOfSkillPath((value as { skillPath?: unknown }).skillPath) === id) {
      return value as Record<string, unknown>
    }
  }
  return null
}
