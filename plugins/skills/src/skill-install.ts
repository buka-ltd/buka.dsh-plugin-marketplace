/**
 * 从收藏的仓库把单个 skill 安装到全局、打工人或工作区。
 *
 * 安装走 `skills` 包的库 API（`installSkills`），而不是运行时 spawn `npx`：
 * 来源解析、下载、lockfile 与各 agent 目录的链接都由库维护。我们只负责三件事：
 *
 * 1. 只允许安装**收藏过**的来源，且该 skill 必须真的出现在 Host 读到的仓库列表里
 *    （浏览器传来的只是路径，名字与是否存在都以 Host 的列表为准）；
 * 2. 把安装排进与卸载 / 更新共用的串行队列（它们都会整份重写 lockfile）；
 * 3. 安装后确认目标真的落到了预期目录，库报告成功但文件不在时按失败上报。
 *
 * 三个目标：
 *
 * - **全局**：`~/.agents/skills/<目录名>`，DSH 的 `user-agents` 根，对所有会话
 *   生效；设置了 `DSH_AGENTS_HOME` 指向别处时无法保证库装到 DSH 会扫描的
 *   位置，这种配置下宁可不装。
 * - **打工人**：打工人目录下的 `.agents/skills` 与 `.claude/skills`（workers 插件
 *   的项目级 skills 约定）。
 * - **工作区**：工作区目录下的 `.agents/skills`，只对那个项目生效。
 *
 * 安装时把**原始来源**（GitHub 简写 / git URL / 本地路径）交给 `installSkills`，
 * lock 里的来源因此仍是可再解析的上游身份，而不是本插件的克隆缓存路径。
 *
 * 打工人 / 工作区目录由调用方从 Host 的登记表解析后传入，本模块不接触 DSH
 * 服务；除 `install-targets.ts` 的类型外只依赖 Node 内置模块与同目录的纯 Node
 * 模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/skill-install
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { installSkills as installSkillsLibrary } from 'skills'
import type { InstallTargetKind, ResolvedInstallTarget } from './install-targets.ts'
import { listSavedRepos, normalizeRepoSource, repoKey } from './repo-store.ts'
import type { Homes, SkillScope } from './skill-store.ts'
import { AGENTS_DIR, globalRoots, resolveHomes, scanRoot } from './skill-store.ts'

/** skill 名 / 安装目录名的长度上限，与 `skills` CLI 的 sanitizeName() 一致。 */
export const MAX_SKILL_NAME_LENGTH = 255

/**
 * 一次「目录安装」最多接受多少个 skill。
 *
 * 页面把目录里所有 skill 的路径一起传上来，Host 逐个交给安装库；这里只防页面
 * 构造超长请求，正常的插件 / 合集目录远达不到这个数量。
 */
export const MAX_GROUP_SKILLS = 200

/** 安装时指定的 agent：`universal` 读写 `~/.agents/skills`（项目里是 `.agents/skills`）。 */
export const INSTALL_AGENT = 'universal'

/** 打工人额外落一份 `.claude/skills` 链接。 */
export const WORKER_CLAUDE_AGENT = 'claude-code'

/** 库 API 里用到的一小部分选项；显式声明便于测试注入假实现。 */
export interface SkillsInstallOptions {
  /** 要安装的 skill 名；缺省表示整个来源。 */
  skills?: readonly string[]
  /** `global` 或当前目录（`project`）。 */
  scope?: 'project' | 'global'
  /** 安装到哪些 agent；`universal` 对应 `.agents/skills`。 */
  agents?: readonly string[]
  /** 项目级安装的工作目录。 */
  cwd?: string
  /** 共享设置；本插件固定关闭遥测。 */
  config?: { telemetry?: boolean }
}

/** 库返回的安装结果里本模块用到的部分。 */
export interface SkillsInstallResult {
  installed: ReadonlyArray<{
    skill: string
    agent: string
    scope: string
    mode: string
    path: string
    canonicalPath?: string
  }>
  failed: ReadonlyArray<{ skill: string; agent: string; code?: string; message: string }>
  skipped: ReadonlyArray<{ skill: string; agent: string; reason: string }>
}

/** 可注入的安装函数；默认是 `skills` 包的 `installSkills`。 */
export type SkillsInstaller = (
  source: string,
  options?: SkillsInstallOptions,
) => Promise<SkillsInstallResult>

/** 安装结果；成功时 `id` / `name` / `path` 说明装到了哪里。 */
export interface SkillInstallResult {
  ok: boolean
  code?: string
  message?: string
  output?: string
  id?: string
  name?: string
  /** 装到了哪一类目标；全局安装时同时保留旧的 `scope` 字段。 */
  target?: InstallTargetKind
  scope?: 'agents'
  path?: string
  repo?: string
}

/**
 * 把浏览器选中的打工人 / 工作区解析成一个可信目录。
 *
 * 由路由注入，实现见 `src/install-targets.ts`：本模块只依赖 Node 内置模块，
 * 不直接接触 DSH 服务，便于单独测试。
 */
export type InstallTargetResolver = (request: {
  readonly target: 'worker' | 'workspace'
  readonly worker?: unknown
  readonly workspace?: unknown
}) => Promise<ResolvedInstallTarget>

/** 已安装判定：两个全局根里的扫描结果。 */
export type InstalledElsewhere =
  | { status: 'absent' }
  | { status: 'installed'; scope: SkillScope; id: string }
  | { status: 'failed'; message: string }

/** `catalog` 只需要 `listSkills()`：安装流程按 Host 这次读到的列表核对 skill。 */
export interface InstallCatalog {
  listSkills(options: { source: string }): Promise<{
    ok: boolean
    skills?: Array<{ name: string; description?: string; path: string }>
    code?: string
    message?: string
  }>
}

/**
 * 库的全局规范副本目录（`~/.agents/skills` 的上级），DSH 的 `user-agents`
 * 根也在这里。`skills` 的规则是 `homedir()/.agents/skills`，不接受别的路径覆盖。
 */
export function npxGlobalAgentsHome(): string {
  return path.join(os.homedir(), AGENTS_DIR)
}

/**
 * skill 名对应的安装目录名，规则与 `skills` 的 `sanitizeName()` 完全一致：
 * 小写，非 `[a-z0-9._]` 的连续字符换成连字符，去掉首尾的 `.` 与 `-`，最多 255 字符。
 *
 * @param name skill 名
 * @returns 目录名；名字不合法时可能是空串
 */
export function skillDirName(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, MAX_SKILL_NAME_LENGTH)
}

/**
 * 这个 skill 名能不能交给安装库：
 *
 * - 非空、不超过 255 字符；
 * - 不能以 `-` 或空白开头（会被当成命令行选项）；
 * - 不能含控制字符；
 * - 必须能 sanitize 出非空目录名。
 *
 * 空格是允许的：仓库里确实有 `Convex Best Practices` 这类带空格的名字。
 *
 * @param name skill 名
 */
export function isInstallableSkillName(name: unknown): boolean {
  if (typeof name !== 'string') return false
  if (name === '' || name.length > MAX_SKILL_NAME_LENGTH) return false
  if (/^[-\s]/u.test(name)) return false
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 这里就是要拒绝控制字符
  if (/[\u0000-\u001f\u007f]/u.test(name)) return false
  return skillDirName(name) !== ''
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
 * 两个全局根里是否已经有这个 skill（目录名或展示名命中）。
 */
async function findInstalledElsewhere(
  homes: Homes,
  id: string,
  name: string,
): Promise<InstalledElsewhere> {
  const wanted = new Set([id, name])
  for (const root of globalRoots(homes)) {
    let entries: Awaited<ReturnType<typeof scanRoot>>
    try {
      entries = await scanRoot(root)
    } catch (error) {
      return { status: 'failed', message: `无法读取 ${root.skillsDir}：${errorText(error)}` }
    }
    const found = entries.find((entry) => wanted.has(entry.id))
    if (found !== undefined) return { status: 'installed', scope: root.scope, id: found.id }
  }
  return { status: 'absent' }
}

/**
 * 安装前共用的来源 / 名字校验：全局、打工人、工作区三处都必须过这一关。
 */
function checkSourceAndName(
  source: unknown,
  name: unknown,
): { ok: true; source: string; name: string } | { ok: false; result: SkillInstallResult } {
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, result: { ok: false, code: 'invalid-source', message: '缺少仓库来源' } }
  }
  const trimmedSource = source.trim()
  if (trimmedSource.startsWith('-')) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'invalid-source',
        message: `来源不能以 - 开头：${trimmedSource}`,
      },
    }
  }
  if (!isInstallableSkillName(name)) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'invalid-skill-name',
        message: `这个 skill 的名字不能用于安装：${typeof name === 'string' ? name : String(name)}`,
      },
    }
  }
  return { ok: true, source: trimmedSource, name: name as string }
}

/**
 * 库的全局副本目录与 DSH 扫描的目录是否一致；不一致时返回拒绝理由。
 */
function globalHomeMismatch(homes: Homes, canonicalAgentsHome: string): string | null {
  if (path.resolve(canonicalAgentsHome) === path.resolve(homes.agentsHome)) return null
  return `skills 把全局 skill 装到 ${path.join(canonicalAgentsHome, 'skills')}，而 DSH 现在扫描的是 ${path.join(homes.agentsHome, 'skills')}（DSH_AGENTS_HOME）；为避免装到看不见的位置，这里不执行安装`
}

/**
 * 安装后的结果核对：库报告成功的条目里选 universal（或第一个），确认目标
 * 目录里真的有 `SKILL.md`。
 */
async function installedPathOf(
  result: SkillsInstallResult,
  fallbackDir: string,
  id: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (result.failed.length > 0) {
    const first = result.failed[0]
    return {
      ok: false,
      message: `${first?.skill ?? ''}（${first?.agent ?? ''}）：${first?.message ?? '安装失败'}`,
    }
  }
  const chosen = result.installed.find((one) => one.agent === INSTALL_AGENT) ?? result.installed[0]
  const target = chosen?.canonicalPath ?? chosen?.path ?? path.join(fallbackDir, id)
  if (!(await pathExists(path.join(target, 'SKILL.md')))) {
    return { ok: false, message: `安装已结束，但没有在 ${target} 找到 SKILL.md` }
  }
  return { ok: true, path: target }
}

/**
 * 把单个 skill 从某个来源安装到全局 `~/.agents/skills`。
 *
 * 失败码：
 *
 * - `invalid-source`：来源为空或以 `-` 开头；
 * - `invalid-skill-name`：名字不能安全地交给安装库；
 * - `no-installer`：调用方没给安装能力；
 * - `unsupported-home`：`DSH_AGENTS_HOME` 指到了库不会写入的位置；
 * - `scan-failed`：读全局 skills 目录失败，无法判断是否已安装；
 * - `already-installed`：两个全局根里已经有同名 skill；
 * - `install-failed`：安装库失败，`output` 带库返回的失败说明；
 * - `install-incomplete`：库报告成功但目标目录 / `SKILL.md` 不在。
 */
export async function installGlobalSkill({
  homes = resolveHomes(),
  canonicalAgentsHome = npxGlobalAgentsHome(),
  source,
  name,
  install = installSkillsLibrary,
}: {
  homes?: Homes
  canonicalAgentsHome?: string
  source?: unknown
  name?: unknown
  install?: SkillsInstaller
}): Promise<SkillInstallResult> {
  const checked = checkSourceAndName(source, name)
  if (!checked.ok) return checked.result
  const { source: trimmedSource, name: skillName } = checked
  if (typeof install !== 'function') {
    return { ok: false, code: 'no-installer', message: '缺少安装 skill 的能力' }
  }
  if (path.resolve(canonicalAgentsHome) !== path.resolve(homes.agentsHome)) {
    return {
      ok: false,
      code: 'unsupported-home',
      message: globalHomeMismatch(homes, canonicalAgentsHome) ?? '',
    }
  }

  const id = skillDirName(skillName)
  const existing = await findInstalledElsewhere(homes, id, skillName)
  if (existing.status === 'failed') {
    return { ok: false, code: 'scan-failed', message: existing.message }
  }
  if (existing.status === 'installed') {
    return {
      ok: false,
      code: 'already-installed',
      message: `这个 skill 已经全局安装（${existing.scope}）：${existing.id}；如需重装，请先在「已安装」里卸载`,
    }
  }

  let result: SkillsInstallResult
  try {
    result = await install(trimmedSource, {
      skills: [skillName],
      scope: 'global',
      agents: [INSTALL_AGENT],
      config: { telemetry: false },
    })
  } catch (error) {
    return { ok: false, code: 'install-failed', message: errorText(error) }
  }

  const target = await installedPathOf(result, path.join(canonicalAgentsHome, 'skills'), id)
  if (!target.ok) {
    return {
      ok: false,
      code: result.failed.length > 0 ? 'install-failed' : 'install-incomplete',
      message: target.message,
    }
  }

  return {
    ok: true,
    id,
    name: skillName,
    target: 'global',
    scope: 'agents',
    path: target.path,
    output: '',
  }
}

/**
 * 把单个 skill 从某个来源安装到打工人或工作区目录。
 *
 * 目标目录由调用方（`install-targets.ts`）从 Host 的登记表解析，浏览器不能
 * 直接指定路径。项目级安装不检查「已安装」：同一个 skill 装进另一个打工人 /
 * 工作区是正常操作，重复执行交给安装库自己处理。
 *
 * 打工人目录按 workers 插件的约定同时落 `.agents/skills` 与 `.claude/skills`
 * （`agents: ['universal', 'claude-code']`）；工作区只写 DSH 会扫描的
 * `.agents/skills`，不碰用户其它 agent 目录。
 */
export async function installProjectSkill({
  targetDir,
  target = 'workspace',
  source,
  name,
  install = installSkillsLibrary,
}: {
  targetDir?: unknown
  target?: 'worker' | 'workspace'
  source?: unknown
  name?: unknown
  install?: SkillsInstaller
}): Promise<SkillInstallResult> {
  const checked = checkSourceAndName(source, name)
  if (!checked.ok) return checked.result
  const { source: trimmedSource, name: skillName } = checked
  if (typeof install !== 'function') {
    return { ok: false, code: 'no-installer', message: '缺少安装 skill 的能力' }
  }
  if (typeof targetDir !== 'string' || targetDir.trim() === '') {
    return { ok: false, code: 'no-target', message: '缺少安装目标目录' }
  }
  const directory = targetDir.trim()

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(directory)
  } catch {
    return { ok: false, code: 'missing-target', message: `目标目录不存在：${directory}` }
  }
  if (!stat.isDirectory()) {
    return { ok: false, code: 'missing-target', message: `目标路径不是目录：${directory}` }
  }

  const agents = target === 'worker' ? [INSTALL_AGENT, WORKER_CLAUDE_AGENT] : [INSTALL_AGENT]
  let result: SkillsInstallResult
  try {
    result = await install(trimmedSource, {
      skills: [skillName],
      scope: 'project',
      cwd: directory,
      agents,
      config: { telemetry: false },
    })
  } catch (error) {
    return { ok: false, code: 'install-failed', message: errorText(error) }
  }

  const id = skillDirName(skillName)
  const targetPath = await installedPathOf(result, path.join(directory, AGENTS_DIR, 'skills'), id)
  if (!targetPath.ok) {
    return {
      ok: false,
      code: result.failed.length > 0 ? 'install-failed' : 'install-incomplete',
      message: targetPath.message,
    }
  }

  return {
    ok: true,
    id,
    name: skillName,
    target,
    path: targetPath.path,
    output: '',
  }
}

/** 仓库列表里一条可安装 skill 的形状（Host 读到的字段）。 */
interface CatalogSkill {
  name: string
  path: string
}

/** 单条安装与目录安装共用的前半段结果。 */
interface SavedInstallContext {
  readonly repoSource: string
  readonly skills: CatalogSkill[]
  readonly targetDir: string | null
}

type SavedInstallPrepared =
  | { readonly ok: true; readonly context: SavedInstallContext }
  | { readonly ok: false; readonly result: SkillInstallResult }

/**
 * 单条安装与目录安装共用的前半段：校验来源是收藏、解析目标目录、读仓库列表。
 *
 * 顺序有意保持：目标先解析，目标不存在时不必为了列仓库去打一次网络请求；
 * 来源与目标都以 Host 这次读到的数据为准，浏览器传来的只是标识符 / 路径。
 *
 * @returns 成功时给出规范化来源、仓库里的 skill 列表与（项目级安装时的）目标目录
 */
async function resolveSavedInstall({
  homes,
  catalog,
  source,
  target,
  worker,
  workspace,
  resolveTarget,
}: {
  homes: Homes
  catalog: InstallCatalog
  source?: unknown
  target: InstallTargetKind
  worker?: unknown
  workspace?: unknown
  resolveTarget: InstallTargetResolver | null
}): Promise<SavedInstallPrepared> {
  if (target !== 'global' && resolveTarget === null) {
    return {
      ok: false,
      result: { ok: false, code: 'no-target-resolver', message: '缺少解析安装目标的能力' },
    }
  }

  const normalized = normalizeRepoSource(source)
  if (normalized === null) {
    return {
      ok: false,
      result: { ok: false, code: 'invalid-source', message: '来源格式不对，无法安装' },
    }
  }

  let store: Awaited<ReturnType<typeof listSavedRepos>>
  try {
    store = await listSavedRepos({ homes })
  } catch (error) {
    return {
      ok: false,
      result: { ok: false, code: 'store-unreadable', message: errorText(error) },
    }
  }
  if (store.corrupt) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'store-unreadable',
        message: `收藏文件无法解析（${store.file}），请先修复或删除它再安装`,
      },
    }
  }
  const repo = store.repos.find((one) => repoKey(one.source) === repoKey(normalized))
  if (repo === undefined) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'not-saved',
        message: `只允许安装收藏过的来源，请先收藏再安装：${normalized}`,
      },
    }
  }
  if (catalog === undefined || typeof catalog?.listSkills !== 'function') {
    return {
      ok: false,
      result: { ok: false, code: 'no-catalog', message: '缺少读取仓库的能力' },
    }
  }

  let targetDir: string | null = null
  if (target !== 'global' && resolveTarget !== null) {
    const resolved = await resolveTarget({ target, worker, workspace })
    if (!resolved.ok) {
      return { ok: false, result: { ok: false, code: resolved.code, message: resolved.message } }
    }
    targetDir = resolved.path
  }

  let listed: Awaited<ReturnType<InstallCatalog['listSkills']>>
  try {
    listed = await catalog.listSkills({ source: repo.source })
  } catch (error) {
    return {
      ok: false,
      result: { ok: false, code: 'fetch-failed', message: errorText(error) },
    }
  }
  if (!listed?.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        code: listed?.code ?? 'fetch-failed',
        message: listed?.message ?? '无法读取这个仓库的 skill 列表',
      },
    }
  }

  const skills = Array.isArray(listed.skills) ? (listed.skills as CatalogSkill[]) : []
  return { ok: true, context: { repoSource: repo.source, skills, targetDir } }
}

/**
 * 页面「安装」按钮的完整流程：校验来源是收藏、skill 在仓库列表里，再按
 * `target` 交给全局安装或某个打工人 / 工作区的项目级安装。
 *
 * 浏览器只传来源与 skill 的仓库路径：名字、是否真的存在都以 Host 这次读到的
 * 仓库列表为准；打工人只传标识符、工作区只传路径，真正的工作目录由
 * `resolveTarget()` 从 Host 的登记表解析，避免页面缓存过期或请求被伪造时装错
 * 位置。
 */
export async function installSavedSkill({
  homes = resolveHomes(),
  canonicalAgentsHome = npxGlobalAgentsHome(),
  catalog,
  source,
  skillPath,
  name,
  target = 'global',
  worker,
  workspace,
  resolveTarget,
  install = installSkillsLibrary,
}: {
  homes?: Homes
  canonicalAgentsHome?: string
  catalog: InstallCatalog
  source?: unknown
  skillPath?: unknown
  name?: unknown
  target?: unknown
  worker?: unknown
  workspace?: unknown
  resolveTarget?: InstallTargetResolver
  install?: SkillsInstaller
}): Promise<SkillInstallResult> {
  if (target !== 'global' && target !== 'worker' && target !== 'workspace') {
    return { ok: false, code: 'invalid-target', message: `未知的安装目标：${String(target)}` }
  }
  const resolver = typeof resolveTarget === 'function' ? resolveTarget : null

  const prepared = await resolveSavedInstall({
    homes,
    catalog,
    source,
    target,
    worker,
    workspace,
    resolveTarget: resolver,
  })
  if (!prepared.ok) return prepared.result
  const { repoSource, skills, targetDir } = prepared.context

  const requestedPath = typeof skillPath === 'string' ? skillPath : ''
  const requestedName = typeof name === 'string' ? name : ''
  const match =
    requestedPath === ''
      ? skills.find((one) => one?.name === requestedName)
      : skills.find((one) => one?.path === requestedPath)
  if (match === undefined) {
    return {
      ok: false,
      code: 'skill-not-found',
      message: '仓库列表里没有这个 skill，仓库可能已经更新，请刷新后再试',
    }
  }

  if (target === 'global') {
    const installed = await installGlobalSkill({
      homes,
      canonicalAgentsHome,
      source: repoSource,
      name: match.name,
      install,
    })
    if (!installed.ok) return installed
    return { ...installed, repo: repoSource }
  }

  const installed = await installProjectSkill({
    targetDir: targetDir ?? '',
    target,
    source: repoSource,
    name: match.name,
    install,
  })
  if (!installed.ok) return installed
  return { ...installed, repo: repoSource }
}

/** 一次「目录安装」里每个 skill 的最终去向。 */
export interface SkillGroupInstallResult {
  ok: boolean
  code?: string
  message?: string
  /** 固定为 true：与单条安装的返回区分开。 */
  batch: true
  target: InstallTargetKind
  repo?: string
  /** 这次真的装上的 skill。 */
  installed: Array<{ name: string; id?: string; path?: string }>
  /** 已经装过（两个全局根里同名）而跳过的 skill；只可能出现在全局安装。 */
  skipped: Array<{ name: string }>
  /** 没装上的 skill 与原因；有一个就整体 `ok: false`。 */
  failed: Array<{ name: string; code: string; message: string }>
}

/**
 * 目录行「安装全部」：把目录里每个 skill 依次装到全局或选中的打工人 / 工作区。
 *
 * 任何一个失败都不会中断后面的，结果按 installed / skipped / failed 分组返回；
 * 有失败时整体 `ok: false`，`message` 列出每个失败的名字与原因。
 */
export async function installSavedSkillGroup({
  homes = resolveHomes(),
  canonicalAgentsHome = npxGlobalAgentsHome(),
  catalog,
  source,
  skillPaths,
  target = 'global',
  worker,
  workspace,
  resolveTarget,
  install = installSkillsLibrary,
}: {
  homes?: Homes
  canonicalAgentsHome?: string
  catalog: InstallCatalog
  source?: unknown
  /** 目录里每个 skill 的仓库路径；由页面从树叶子收集。 */
  skillPaths?: unknown
  target?: unknown
  worker?: unknown
  workspace?: unknown
  resolveTarget?: InstallTargetResolver
  install?: SkillsInstaller
}): Promise<SkillGroupInstallResult> {
  if (target !== 'global' && target !== 'worker' && target !== 'workspace') {
    return {
      ok: false,
      code: 'invalid-target',
      message: `未知的安装目标：${String(target)}`,
      batch: true,
      target: 'global',
      installed: [],
      skipped: [],
      failed: [],
    }
  }
  const settle = (code: string, message: string): SkillGroupInstallResult => ({
    ok: false,
    code,
    message,
    batch: true,
    target,
    installed: [],
    skipped: [],
    failed: [],
  })

  const paths = requestedSkillPaths(skillPaths)
  if (paths === null || paths.length === 0) {
    return settle(
      'invalid-skill-paths',
      `目录安装需要一组 skill 路径（最多 ${MAX_GROUP_SKILLS} 个），且不能为空`,
    )
  }
  if (typeof install !== 'function') return settle('no-installer', '缺少安装 skill 的能力')
  if (target === 'global') {
    const mismatch = globalHomeMismatch(homes, canonicalAgentsHome)
    if (mismatch !== null) return settle('unsupported-home', mismatch)
  }

  const resolver = typeof resolveTarget === 'function' ? resolveTarget : null
  const prepared = await resolveSavedInstall({
    homes,
    catalog,
    source,
    target,
    worker,
    workspace,
    resolveTarget: resolver,
  })
  if (!prepared.ok) {
    return settle(prepared.result.code ?? 'fetch-failed', prepared.result.message ?? '无法安装')
  }
  const { repoSource, skills, targetDir } = prepared.context

  const byPath = new Map(skills.map((one) => [one.path, one]))
  const selected: CatalogSkill[] = []
  for (const wanted of paths) {
    const found = byPath.get(wanted)
    if (found === undefined) {
      return settle(
        'skill-not-found',
        '仓库列表里没有目录下的这个 skill，仓库可能已经更新，请刷新后再试',
      )
    }
    selected.push(found)
  }

  const installed: SkillGroupInstallResult['installed'] = []
  const skipped: SkillGroupInstallResult['skipped'] = []
  const failed: SkillGroupInstallResult['failed'] = []
  for (const skill of selected) {
    const one =
      target === 'global'
        ? await installGlobalSkill({
            homes,
            canonicalAgentsHome,
            source: repoSource,
            name: skill.name,
            install,
          })
        : await installProjectSkill({
            targetDir: targetDir ?? '',
            target,
            source: repoSource,
            name: skill.name,
            install,
          })
    if (one.ok) {
      const entry: SkillGroupInstallResult['installed'][number] = { name: skill.name }
      if (one.id !== undefined) entry.id = one.id
      if (one.path !== undefined) entry.path = one.path
      installed.push(entry)
      continue
    }
    if (one.code === 'already-installed') {
      skipped.push({ name: skill.name })
      continue
    }
    failed.push({
      name: skill.name,
      code: one.code ?? 'install-failed',
      message: one.message ?? '安装失败',
    })
  }

  if (failed.length > 0) {
    return {
      ok: false,
      code: failed[0]?.code ?? 'install-failed',
      message: failed.map((one) => `${one.name}（${one.message}）`).join('；'),
      batch: true,
      target,
      repo: repoSource,
      installed,
      skipped,
      failed,
    }
  }

  return { ok: true, batch: true, target, repo: repoSource, installed, skipped, failed }
}

/**
 * 目录安装请求里的 skill 路径：必须是字符串数组、去重、数量不超过上限。
 *
 * @returns 规范化后的路径；形状不对或超过上限时返回 null
 */
function requestedSkillPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const paths: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || item === '') return null
    if (seen.has(item)) continue
    seen.add(item)
    paths.push(item)
  }
  if (paths.length > MAX_GROUP_SKILLS) return null
  return paths
}
