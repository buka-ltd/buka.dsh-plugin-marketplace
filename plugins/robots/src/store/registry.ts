/**
 * 机器人登记表：读写、原子写、条目增删与描述规范化。
 *
 * 登记文件是插件唯一的机器人清单；写操作遇到损坏的登记文件必须拒绝，绝不覆盖
 * 用户文件。新建的机器人目录由 `agents.ts` 的 `ensureRobotDirectory` 补模板。
 *
 * @module @buka/dsh-plugin-robots/store/registry
 */

import { promises as fs } from 'node:fs'
import { writeJsonAtomic } from '@buka/plugin-kit'
import { isAvatarId, pickDefaultAvatar, resolveAvatar } from '../avatar.ts'
import { ensureRobotDirectory } from './agents.ts'
import {
  isValidRobotName,
  ROBOT_DESCRIPTION_MAX_LENGTH,
  ROBOT_REGISTRY_VERSION,
  requireRegistryFile,
  robotDirectory,
} from './paths.ts'
import type { RobotRecord, RobotRecordInput } from './types.ts'

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
 */
export async function readRobotRegistry({ file }: { file?: string | undefined } = {}): Promise<{
  version: number
  robots: RobotRecord[]
  corrupt?: true
  file: string
}> {
  const target = requireRegistryFile(file)
  let text: string
  try {
    text = await fs.readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { version: ROBOT_REGISTRY_VERSION, robots: [], file: target }
    }
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { version: ROBOT_REGISTRY_VERSION, robots: [], corrupt: true, file: target }
  }
  if (
    !('version' in parsed) ||
    parsed.version !== ROBOT_REGISTRY_VERSION ||
    !('robots' in parsed) ||
    !Array.isArray(parsed.robots)
  ) {
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
      description: normalizeRobotDescription(entry.description).slice(
        0,
        ROBOT_DESCRIPTION_MAX_LENGTH,
      ),
    })
  }
  return { version: ROBOT_REGISTRY_VERSION, robots, file: target }
}

/**
 * 原子写机器人登记表（临时文件 + rename，权限 0600）。
 *
 * 目录不存在会先建好；写入失败时清理临时文件，原登记文件保持不变。
 *
 */
export async function writeRobotRegistry({
  file,
  robots,
}: {
  file?: string | undefined
  robots?: RobotRecordInput[] | undefined
} = {}): Promise<{ file: string }> {
  const target = requireRegistryFile(file)
  const entries = Array.isArray(robots) ? robots : []

  const payload = {
    version: ROBOT_REGISTRY_VERSION,
    robots: entries.map((robot) => ({
      name: robot.name,
      path: robot.path,
      createdAt: robot.createdAt,
      // 写法上总是落下具体 id，旧记录在第一次写回时顺带补齐头像。
      avatar: resolveAvatar(robot.avatar, robot.name),
      // 旧登记表没有描述：第一次写回时补成空串，之后由页面 / 构建工具维护。
      description: normalizeRobotDescription(robot.description).slice(
        0,
        ROBOT_DESCRIPTION_MAX_LENGTH,
      ),
    })),
  }
  await writeJsonAtomic(target, payload)
  return { file: target }
}

// ---- 登记表的增删 --------------------------------------------------------

/**
 * 生成「名称不合法」错误。
 *
 */
export function invalidNameError(name: unknown): Error & { code: string } {
  const error = new Error(`机器人名称不合法：${String(name)}`)
  return Object.assign(error, { code: 'invalid-name' })
}

/**
 * 生成「描述不合法」错误。
 *
 */
export function invalidDescriptionError(description: unknown): Error & { code: string } {
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
 */
export function normalizeRobotDescription(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * 描述是否合法：字符串（含空串）且规范化后不超过上限。
 *
 */
export function isValidRobotDescription(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    normalizeRobotDescription(value).length <= ROBOT_DESCRIPTION_MAX_LENGTH
  )
}

/**
 * 生成「登记文件损坏」错误；写操作遇到它必须拒绝，不能覆盖用户文件。
 *
 */
export function registryUnreadableError(file: string): Error & { code: string } {
  const error = new Error(`机器人登记文件无法读取：${file}。请修复或删除该文件后重试。`)
  return Object.assign(error, { code: 'registry-unreadable' })
}

/**
 * 生成「头像不合法」错误。
 *
 */
export function invalidAvatarError(avatar: unknown): Error & { code: string } {
  const error = new Error(`头像不合法：${String(avatar)}`)
  return Object.assign(error, { code: 'invalid-avatar' })
}

/**
 * 生成「机器人不在登记表里」错误。
 *
 */
export function unknownRobotError(name: string): Error & { code: string } {
  const error = new Error(`机器人不在登记表里：${name}`)
  return Object.assign(error, { code: 'unknown-robot' })
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
 */
export async function addRobot({
  robotsDir,
  file,
  name,
  avatar,
  description,
}: {
  robotsDir?: string | undefined
  file?: string | undefined
  name?: string | undefined
  avatar?: string | undefined
  description?: string | undefined
} = {}): Promise<{ robot: RobotRecord; created: boolean }> {
  const registryFile = requireRegistryFile(file)
  if (!isValidRobotName(name)) throw invalidNameError(name)

  const rawDescription = description === undefined || description === null ? '' : description
  if (typeof rawDescription !== 'string') throw invalidDescriptionError(rawDescription)
  const cleanDescription = normalizeRobotDescription(rawDescription)
  if (cleanDescription.length > ROBOT_DESCRIPTION_MAX_LENGTH)
    throw invalidDescriptionError(rawDescription)

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
 */
export async function setRobotAvatar({
  file,
  name,
  avatar,
}: {
  file?: string | undefined
  name?: string | undefined
  avatar?: string | undefined
} = {}): Promise<{ robot: RobotRecord }> {
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
 */
export async function setRobotDescription({
  file,
  name,
  description,
}: {
  file?: string | undefined
  name?: string | undefined
  description?: string | undefined
} = {}): Promise<{ robot: RobotRecord }> {
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
 * 从登记表移除一个机器人：**目录不删**（目录、文件与会话都保留）。
 *
 * 登记文件损坏抛 `code = 'registry-unreadable'`；未知名字返回
 * `{ removed: false }`，不写文件。
 *
 */
export async function removeRobot({
  file,
  name,
}: {
  file?: string | undefined
  name?: string | undefined
} = {}): Promise<{ removed: boolean }> {
  const registryFile = requireRegistryFile(file)
  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const trimmed = typeof name === 'string' ? name.trim() : ''
  const remaining = registry.robots.filter((robot) => robot.name !== trimmed)
  if (remaining.length === registry.robots.length) return { removed: false }

  await writeRobotRegistry({ file: registryFile, robots: remaining })
  return { removed: true }
}
