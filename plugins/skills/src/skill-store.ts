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
 * home 路径与 lockfile 解析分别由 `src/homes.ts`、`src/npx-lock.ts` 提供，
 * frontmatter 解析在 `src/frontmatter.ts`；这里只保留扫描、汇总与卸载。
 *
 * 本模块只依赖 Node 内置模块，不 import DSH 包，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/skill-store
 */

import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { parseFrontmatterDescription } from './frontmatter.ts'
import type { Homes } from './homes.ts'
import { resolveHomes } from './homes.ts'
import { lockFileFor, npxRecordFor, readNpxLock } from './npx-lock.ts'

/** skill 所在的全局根：`dsh` 是 `~/.dsh/skills`，`agents` 是 `~/.agents/skills`。 */
export type SkillScope = 'dsh' | 'agents'

/** 一个全局 skills 根目录。 */
export interface SkillRoot {
  readonly scope: SkillScope
  readonly skillsDir: string
}

/** 扫描到的一个 skill（磁盘上的目录或平铺的 `.md` 文件）。 */
export interface ScannedSkill {
  readonly id: string
  readonly scope: SkillScope
  readonly kind: 'directory' | 'file'
  readonly path: string
  readonly file: string
}

/** 页面上展示的一个全局 skill。 */
export interface GlobalSkill {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly scope: SkillScope
  readonly kind: 'directory' | 'file'
  readonly path: string
  readonly managedByNpx: boolean
  readonly npxSource: string | null
  readonly npxSourceUrl: string | null
  readonly npxInstalledAt: string | null
  readonly npxUpdatedAt: string | null
}

/** `collectGlobalSkills()` 的完整快照。 */
export interface GlobalSkillsSnapshot {
  readonly skills: GlobalSkill[]
  readonly homes: Homes
  readonly roots: Array<{ readonly scope: SkillScope; readonly path: string }>
  readonly lock: {
    readonly exists: boolean
    readonly path: string
    readonly version: number | null
    readonly corrupt: boolean
  }
  readonly warnings: string[]
}

/** 卸载结果；`ok` 为 true 时 `method` 说明用了哪条路径。 */
export interface UninstallResult {
  readonly ok: boolean
  readonly method?: 'npx' | 'local'
  readonly code?: string
  readonly message?: string
  readonly output?: string
}

/**
 * 两个全局 skills 根目录，按 DSH 的优先级排列（`user-dsh` 高于 `user-agents`）。
 */
export function globalRoots(homes: Homes): SkillRoot[] {
  return [
    { scope: 'dsh', skillsDir: path.join(homes.dshHome, 'skills') },
    { scope: 'agents', skillsDir: path.join(homes.agentsHome, 'skills') },
  ]
}

/**
 * skill 目录名只允许字母、数字、点、下划线与连字符，且不能以点开头。
 * 这样 `..`、路径分隔符和隐藏目录都不会被当成 skill 名传给删除逻辑。
 */
export function isSafeSkillId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)
}

/**
 * 判断路径是否存在（含符号链接目标）。
 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 扫描一个 skills 根目录的**直接子项**，与 `dsh-skill-filesystem` 的目录结构一致：
 * 目录形式的 `<name>/SKILL.md`，或平铺的 `<name>.md`；不递归，跳过隐藏项与
 * 根目录下的 `SKILL.md`。同一名字既有目录又有平铺文件时保留目录。
 */
export async function scanRoot(root: SkillRoot): Promise<ScannedSkill[]> {
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(root.skillsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') return []
    throw error
  }

  const byId = new Map<string, ScannedSkill>()

  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    const full = path.join(root.skillsDir, dirent.name)

    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      // 跟随符号链接：npx 也可能用链接把 skill 接到规范目录。
      stat = await fs.stat(full)
    } catch {
      continue
    }

    let entry: ScannedSkill
    if (stat.isDirectory()) {
      const file = path.join(full, 'SKILL.md')
      if (!(await pathExists(file))) continue
      entry = { id: dirent.name, scope: root.scope, kind: 'directory', path: full, file }
    } else if (stat.isFile() && dirent.name.endsWith('.md') && dirent.name !== 'SKILL.md') {
      entry = {
        id: dirent.name.slice(0, -3),
        scope: root.scope,
        kind: 'file',
        path: full,
        file: full,
      }
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
 * 直接读 SKILL.md 取 description；文件读不了时返回空串。
 *
 * @param file SKILL.md 绝对路径
 */
async function readSkillDescription(file: string): Promise<string> {
  try {
    return parseFrontmatterDescription(await fs.readFile(file, 'utf8'))
  } catch {
    return ''
  }
}

/**
 * 收集两个全局根目录下的全部 skills，并标注哪些由 `npx skills` 管理。
 *
 * `summaries` 来自 `ctx.skills.list()`：用它补上 DSH 解析过的 `description` 等
 * 元数据；列表本身以磁盘扫描为准，这样刚删掉的条目不会因为 registry 缓存而
 * 继续出现，刚装上的条目也不依赖 watcher 的时序。某个根读不了时跳过它，
 * 在 `warnings` 里说明，而不是让整页失败。
 */
export async function collectGlobalSkills({
  homes = resolveHomes(),
  summaries = [],
  env = process.env,
}: {
  homes?: Homes
  summaries?: ReadonlyArray<Record<string, unknown>>
  env?: NodeJS.ProcessEnv
} = {}): Promise<GlobalSkillsSnapshot> {
  const lockPath = lockFileFor(homes, env)
  const lock = await readNpxLock(lockPath)
  const roots = globalRoots(homes)

  const scanned: ScannedSkill[] = []
  const warnings: string[] = []
  for (const root of roots) {
    try {
      scanned.push(...(await scanRoot(root)))
    } catch (error) {
      warnings.push(`${root.skillsDir}: ${errorText(error)}`)
    }
  }

  const idCounts = new Map<string, number>()
  for (const entry of scanned) idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1)

  const byFile = new Map<string, Record<string, unknown>>()
  const byName = new Map<string, Record<string, unknown>>()
  for (const summary of summaries) {
    if (typeof summary?.name !== 'string') continue
    byName.set(summary.name, summary)
    if (typeof summary.path === 'string') byFile.set(path.resolve(summary.path), summary)
  }

  const skills: GlobalSkill[] = []
  for (const entry of scanned) {
    // registry 的摘要可能只有名字（没有 path），但同名 skill 同时存在于两个根时
    // 按名字回填会把赢家（user-dsh）的描述贴到另一行，所以只在名字唯一时回填。
    const summary =
      byFile.get(path.resolve(entry.file)) ??
      (idCounts.get(entry.id) === 1 ? byName.get(entry.id) : undefined) ??
      null
    const summaryName = summary?.name
    const name = typeof summaryName === 'string' ? summaryName : entry.id
    const npx = entry.scope === 'agents' ? npxRecordFor(lock, entry.id) : null
    // 摘要拿不到描述时自己读 SKILL.md：注册表不可用或路径未命中时，
    // 页面仍然要能看到 skill 自己的 description。
    const summaryDescription = summary?.description
    const description =
      typeof summaryDescription === 'string' && summaryDescription !== ''
        ? summaryDescription
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
 */
export async function uninstallGlobalSkill({
  homes = resolveHomes(),
  scope,
  id,
  runNpx,
  env = process.env,
}: {
  homes?: Homes
  scope?: unknown
  id?: unknown
  runNpx: (args: string[]) => Promise<{
    ok: boolean
    message?: string
    output?: string
  }>
  env?: NodeJS.ProcessEnv
}): Promise<UninstallResult> {
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
  if (root === undefined) {
    // scope 上面已经校验只能是两个值，这里只为把类型收窄。
    return { ok: false, code: 'invalid-scope', message: `未知的 skills 位置：${String(scope)}` }
  }
  let entry: ScannedSkill | undefined
  try {
    entry = (await scanRoot(root)).find((one) => one.id === id)
  } catch (error) {
    return {
      ok: false,
      code: 'scan-failed',
      message: `无法读取 ${root.skillsDir}：${errorText(error)}`,
    }
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
      let result: { ok: boolean; message?: string; output?: string }
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

export type { SkillFrontmatter } from './frontmatter.ts'
export {
  parseFrontmatter,
  parseFrontmatterDescription,
  parseFrontmatterInternal,
} from './frontmatter.ts'
export type { Homes } from './homes.ts'
// 保持原有对外导出：这些实现已经搬到独立模块，测试与其他插件仍从本模块取。
export { AGENTS_DIR, resolveHomes } from './homes.ts'
export type { NpxLock } from './npx-lock.ts'
export {
  lockFileFor,
  NPX_LOCK_FILE,
  NPX_LOCK_VERSION,
  npxRecordFor,
  readNpxLock,
} from './npx-lock.ts'
