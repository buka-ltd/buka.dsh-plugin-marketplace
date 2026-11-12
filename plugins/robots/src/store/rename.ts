/**
 * 机器人重命名：移动目录并就地更新登记表。
 *
 * 工作区重建由 `builder.ts` 负责；本模块只动磁盘与登记表，失败时把目录改回
 * 旧名，保证磁盘与登记表仍然一致。
 *
 * @module @buka/dsh-plugin-robots/store/rename
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveAvatar } from '../avatar.ts'
import { ensureClaudeLink, robotAgentsTemplate } from './agents.ts'
import { builtinRobotError, isBuiltinRobotName } from './builtin.ts'
import {
  AGENTS_FILE,
  defaultRobotsRoot,
  isDirectory,
  isValidRobotName,
  realpathOr,
  realpathOrNull,
  requireRegistryFile,
} from './paths.ts'
import {
  invalidNameError,
  programRobotError,
  readRobotRegistry,
  registryUnreadableError,
  unknownRobotError,
  writeRobotRegistry,
} from './registry.ts'
import type { RobotRecord } from './types.ts'

/**
 * 重命名一个机器人：把机器人目录改名为新名字，并就地更新登记表里的
 * `name` 与 `path`。
 *
 * - 名称规则与新建一致；新名等于旧名时按 no-op 返回（`renamed: false`），
 *   不碰磁盘与登记表；
 * - 新名不能与登记表里其它机器人重名，也不能与 `robotsDir` 下已存在的目录
 *   重名（抛 `code = 'name-taken'`），避免两个登记条目指向同一个目录；
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
 */
export async function renameRobot({
  robotsDir,
  file,
  name,
  newName,
}: {
  robotsDir?: string | undefined
  file?: string | undefined
  name?: string | undefined
  newName?: string | undefined
} = {}): Promise<{
  robot: RobotRecord
  previousName: string
  renamed: boolean
  agentsRewritten: boolean
}> {
  const registryFile = requireRegistryFile(file)
  if (!isValidRobotName(name)) throw invalidNameError(name)
  const trimmed = name.trim()
  const nextName = typeof newName === 'string' ? newName.trim() : ''
  if (!isValidRobotName(nextName)) throw invalidNameError(newName)

  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const current = registry.robots.find((robot) => robot.name === trimmed)
  if (current === undefined) throw unknownRobotError(trimmed)

  // program 型机器人没有目录、只读；内建名字也不能成为改名目标。
  if (current.driver !== 'agent') throw programRobotError(trimmed)
  if (isBuiltinRobotName(nextName)) throw builtinRobotError(nextName)

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
    const [targetReal, oldReal] = await Promise.all([
      realpathOrNull(target),
      realpathOrNull(oldDirectory),
    ])
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

  const next: typeof current = {
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
