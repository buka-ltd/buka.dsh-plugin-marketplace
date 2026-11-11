/**
 * 从收藏的仓库把单个 skill 安装到全局。
 *
 * 安装走 `npx skills add <来源> --skill <名字> --global --yes`，而不是由本插件
 * 直接复制文件：仓库内容可能是 GitHub API 读到的、git 克隆缓存里的或本地目录里
 * 的，`npx skills` 已经处理好了这些来源的全部差异（下载、二进制文件、
 * lockfile、各 agent 目录的链接）。我们只负责三件事：
 *
 * 1. 只允许安装**收藏过**的来源，且该 skill 必须真的出现在 Host 读到的仓库列表里
 *    （浏览器传来的只是路径，名字与是否存在都以 Host 的列表为准）；
 * 2. 把 `npx skills add` 排进与卸载共用的串行队列（两者都会整份重写 lockfile）；
 * 3. 安装后确认目标真的落到了 `~/.agents/skills/<目录名>`，退出码为 0 但文件
 *    不在时按失败上报，和卸载的「退出码 0 但目录仍在」对称。
 *
 * `~/.agents/skills` 是 `npx skills` 的全局规范副本目录，也是 DSH 的
 * `user-agents` 根，所以装到那里就对所有 DSH 会话生效。设置了 `DSH_AGENTS_HOME`
 * 指向别处时无法保证 `npx` 装到 DSH 会扫描的位置，这种配置下宁可不装。
 *
 * 本模块只依赖 Node 内置模块与同目录的纯 Node 模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/skill-install
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { NpxResult } from '@buka/plugin-kit'
import { listSavedRepos, normalizeRepoSource, repoKey } from './repo-store.ts'
import type { Homes, SkillScope } from './skill-store.ts'
import { AGENTS_DIR, globalRoots, resolveHomes, scanRoot } from './skill-store.ts'

/** skill 名 / 安装目录名的长度上限，与 `npx skills` 的 sanitizeName() 一致。 */
export const MAX_SKILL_NAME_LENGTH = 255

/**
 * 安装时指定的 `npx skills` agent。
 *
 * 不指定 agent 时（`-y`）CLI 会把 skill 装到**本机检测到的所有 agent** 目录里：
 * DSH 只关心 `~/.agents/skills`，而纯 DSH 机器上检测不到任何 agent 时它甚至会
 * 给全部 agent 各建一份链接。`universal` 是 CLI 自带的「通用 agent」，读写的就是
 * 规范副本 `~/.agents/skills`，指定它只写这一处，不碰其它 agent 目录。
 *
 * 新版本 CLI 若改掉了这个 agent 名，`npx skills add` 会以 `Invalid agents` 失败，
 * 调用方会退回不带 agent 的默认命令（见 `installGlobalSkill()`）。
 */
export const INSTALL_AGENT = 'universal'

/** 安装 / 卸载共用的 npx 执行函数。 */
export type InstallNpxRunner = (args: string[]) => Promise<NpxResult>

/** 安装结果；成功时 `id` / `name` / `path` 说明装到了哪里。 */
export interface SkillInstallResult {
  ok: boolean
  code?: string
  message?: string
  output?: string
  id?: string
  name?: string
  scope?: 'agents'
  path?: string
  repo?: string
  plugin?: string | null
}

/** 已安装判定：两个全局根里的扫描结果。 */
export type InstalledElsewhere =
  | { status: 'absent' }
  | { status: 'installed'; scope: SkillScope; id: string }
  | { status: 'failed'; message: string }

/** `catalog` 只需要 `listSkills()`：安装流程按 Host 这次读到的列表核对 skill。 */
export interface InstallCatalog {
  listSkills(options: { source: string }): Promise<{
    ok: boolean
    skills?: Array<{ name: string; description?: string; path: string; plugin?: string | null }>
    code?: string
    message?: string
  }>
}

/**
 * `npx skills` 的全局规范副本目录（`~/.agents/skills` 的上级），DSH 的
 * `user-agents` 根也在这里。`npx` 自己的规则是 `homedir()/.agents/skills`，
 * 不接受别的路径覆盖。
 */
export function npxGlobalAgentsHome(): string {
  return path.join(os.homedir(), AGENTS_DIR)
}

/**
 * skill 名对应的安装目录名，规则与 `npx skills` 的 `sanitizeName()` 完全一致：
 * 小写，非 `[a-z0-9._]` 的连续字符换成连字符，去掉首尾的 `.` 与 `-`，最多 255 字符。
 *
 * 用来在安装后确认真正的目录，也用于页面判断「这个 skill 是不是已经装过」。
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
 * 这个 skill 名能不能交给 `npx skills add --skill`：
 *
 * - 非空、不超过 255 字符；
 * - 不能以 `-` 或空白开头（会被命令行解析成选项）；
 * - 不能含控制字符；
 * - 必须能 sanitize 出非空目录名。
 *
 * 空格是允许的：仓库里确实有 `Convex Best Practices` 这类带空格的名字，
 * `npx skills` 支持按引号传入的名字安装。
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
 *
 * 同一名字同时存在于 `~/.agents/skills` 与 `~/.dsh/skills` 时 DSH 会列两行，
 * 这里也当作已安装：再装一次要么出现第三份，要么被其中一个根遮住，先拒绝并
 * 让用户去「已安装」里处理。
 *
 * @param id 安装目录名
 * @param name skill 展示名
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
 * 这次失败是不是「CLI 不认识 `universal` agent」。
 *
 * CLI 的报错形如 `Invalid agents: universal`，并且退出码非 0；命中时退回不带
 * agent 的默认命令，而不是把一次可安装的请求判死。
 */
function isInvalidAgentFailure(result: { message?: string; output?: string } | undefined): boolean {
  const text = `${result?.message ?? ''}\n${result?.output ?? ''}`
  return /Invalid agents?:/iu.test(text)
}

/**
 * 把单个 skill 从某个 `npx skills` 来源安装到全局 `~/.agents/skills`。
 *
 * 失败码：
 *
 * - `invalid-source`：来源为空或以 `-` 开头（会被当成命令选项）；
 * - `invalid-skill-name`：名字不能安全地交给 `npx skills add --skill`；
 * - `no-runner`：调用方没给执行能力；
 * - `unsupported-home`：`DSH_AGENTS_HOME` 指到了 `npx` 不会写入的位置；
 * - `scan-failed`：读全局 skills 目录失败，无法判断是否已安装；
 * - `already-installed`：两个全局根里已经有同名 skill；
 * - `npx-failed`：`npx skills add` 失败，`output` 带命令输出；
 * - `install-incomplete`：命令退出码为 0 但目标目录或 `SKILL.md` 不在。
 */
export async function installGlobalSkill({
  homes = resolveHomes(),
  canonicalAgentsHome = npxGlobalAgentsHome(),
  source,
  name,
  runNpx,
}: {
  homes?: Homes
  canonicalAgentsHome?: string
  source?: unknown
  name?: unknown
  runNpx: InstallNpxRunner
}): Promise<SkillInstallResult> {
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, code: 'invalid-source', message: '缺少仓库来源' }
  }
  const trimmedSource = source.trim()
  if (trimmedSource.startsWith('-')) {
    return { ok: false, code: 'invalid-source', message: `来源不能以 - 开头：${trimmedSource}` }
  }
  if (!isInstallableSkillName(name)) {
    return {
      ok: false,
      code: 'invalid-skill-name',
      message: `这个 skill 的名字不能用于安装：${typeof name === 'string' ? name : String(name)}`,
    }
  }
  if (typeof runNpx !== 'function') {
    return { ok: false, code: 'no-runner', message: '缺少执行 npx 的能力' }
  }
  if (path.resolve(canonicalAgentsHome) !== path.resolve(homes.agentsHome)) {
    return {
      ok: false,
      code: 'unsupported-home',
      message: `npx skills 把全局 skill 装到 ${path.join(canonicalAgentsHome, 'skills')}，而 DSH 现在扫描的是 ${path.join(homes.agentsHome, 'skills')}（DSH_AGENTS_HOME）；为避免装到看不见的位置，这里不执行安装`,
    }
  }

  const id = skillDirName(name)
  const skillName = name as string
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

  let result: NpxResult
  try {
    result = await runNpx([
      'add',
      trimmedSource,
      '--skill',
      skillName,
      '--global',
      '--yes',
      '-a',
      INSTALL_AGENT,
    ])
    if (!result?.ok && isInvalidAgentFailure(result)) {
      // 旧 / 未来版本的 CLI 不认识 `universal`：退回它自己的默认选择。
      result = await runNpx(['add', trimmedSource, '--skill', skillName, '--global', '--yes'])
    }
  } catch (error) {
    return { ok: false, code: 'npx-failed', message: errorText(error) }
  }
  if (!result?.ok) {
    return {
      ok: false,
      code: 'npx-failed',
      message: result?.message ?? 'npx skills add 失败',
      output: result?.output ?? '',
    }
  }

  // npx 可能把目录名 sanitize 成另一个名字；按 CLI 的规则算出来再确认 SKILL.md 在。
  const target = path.join(canonicalAgentsHome, 'skills', id)
  if (!(await pathExists(path.join(target, 'SKILL.md')))) {
    return {
      ok: false,
      code: 'install-incomplete',
      message: `npx skills add 已退出，但没有在 ${target} 找到 SKILL.md`,
      output: result.output ?? '',
    }
  }

  return {
    ok: true,
    id,
    name: skillName,
    scope: 'agents',
    path: target,
    output: result.output ?? '',
  }
}

/**
 * 页面「安装」按钮的完整流程：校验来源是收藏、skill 在仓库列表里，再交给
 * `installGlobalSkill()` 执行。
 *
 * 浏览器只传来源与 skill 的仓库路径：名字、是否真的存在都以 Host 这次读到的
 * 仓库列表为准，避免页面缓存过期或请求被伪造时装错东西。
 */
export async function installSavedSkill({
  homes = resolveHomes(),
  canonicalAgentsHome = npxGlobalAgentsHome(),
  catalog,
  source,
  skillPath,
  name,
  runNpx,
}: {
  homes?: Homes
  canonicalAgentsHome?: string
  catalog: InstallCatalog
  source?: unknown
  skillPath?: unknown
  name?: unknown
  runNpx: InstallNpxRunner
}): Promise<SkillInstallResult> {
  const normalized = normalizeRepoSource(source)
  if (normalized === null) {
    return { ok: false, code: 'invalid-source', message: '来源格式不对，无法安装' }
  }

  let store: Awaited<ReturnType<typeof listSavedRepos>>
  try {
    store = await listSavedRepos({ homes })
  } catch (error) {
    return { ok: false, code: 'store-unreadable', message: errorText(error) }
  }
  if (store.corrupt) {
    return {
      ok: false,
      code: 'store-unreadable',
      message: `收藏文件无法解析（${store.file}），请先修复或删除它再安装`,
    }
  }
  const repo = store.repos.find((one) => repoKey(one.source) === repoKey(normalized))
  if (repo === undefined) {
    return {
      ok: false,
      code: 'not-saved',
      message: `只允许安装收藏过的来源，请先收藏再安装：${normalized}`,
    }
  }
  if (catalog === undefined || typeof catalog?.listSkills !== 'function') {
    return { ok: false, code: 'no-catalog', message: '缺少读取仓库的能力' }
  }

  let listed: Awaited<ReturnType<InstallCatalog['listSkills']>>
  try {
    listed = await catalog.listSkills({ source: repo.source })
  } catch (error) {
    return { ok: false, code: 'fetch-failed', message: errorText(error) }
  }
  if (!listed?.ok) {
    return {
      ok: false,
      code: listed?.code ?? 'fetch-failed',
      message: listed?.message ?? '无法读取这个仓库的 skill 列表',
    }
  }

  const skills = Array.isArray(listed.skills) ? listed.skills : []
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

  const installed = await installGlobalSkill({
    homes,
    canonicalAgentsHome,
    source: repo.source,
    name: match.name,
    runNpx,
  })
  if (!installed.ok) return installed
  return { ...installed, repo: repo.source, plugin: match.plugin ?? null }
}
