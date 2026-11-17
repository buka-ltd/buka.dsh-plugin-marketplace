/**
 * 已安装 skill 的检查与更新。
 *
 * 状态模型（不引入版本号）：
 *
 * - `update`：上游有更新；
 * - `modified`：本地文件与 lock 里的 `computedHash` 不一致（只对目标目录的
 *   项目级 skill 有意义，全局 lock 不记内容哈希）；
 * - `up-to-date`：已是最新；
 * - `unsupported-source`：来源不再可解析（典型是旧 Claude Code marketplace
 *   安装：skill 不在仓库根 `skills/` 下），无法再自动检查；
 * - `failed`：检查本身失败，带原因。
 *
 * 检查与更新复用 `skills` 包自带的 CLI（`skills check` / `skills update`），
 * 因为更新逻辑、来源解析与 lock 迁移都由它维护；调用时关闭遥测。全局作用域
 * 只在 `~/.agents` 是 DSH 扫描的全局根时可用——CLI 固定写自己的全局目录，
 * 路径不一致时宁可拒绝，也不改到用户看不到的位置。
 *
 * 更新只应用 `update`；`modified` 默认跳过并说明原因，绝不覆盖本地修改。
 * 手工安装（不在 npx lock 里）的条目不在候选内，也不参与检查 / 更新。
 *
 * @module @buka/dsh-plugin-skills/skill-update
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { computeSkillFolderHash } from './skill-hash.ts'
import { skillDirName } from './skill-install.ts'
import type { Homes } from './skill-store.ts'
import { collectGlobalSkills, resolveHomes } from './skill-store.ts'

/** CLI 单次调用的超时：与安装流程的 180 s 保持一致。 */
export const SKILL_UPDATE_TIMEOUT_MS = 180_000

/** CLI 输出的上限；正常输出很小，这里只防异常刷屏。 */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024

/** 项目级 lock 文件名与版本。 */
export const PROJECT_LOCK_FILE = 'skills-lock.json'
export const PROJECT_LOCK_VERSION = 2

/** 检查得到的单个 skill 状态。 */
export type SkillCheckStatus =
  | 'update'
  | 'modified'
  | 'up-to-date'
  | 'unsupported-source'
  | 'failed'

/** 检查结果里的一行。 */
export interface SkillCheckEntry {
  readonly name: string
  readonly source: string | null
  readonly status: SkillCheckStatus
  readonly message?: string
  readonly output?: string
}

/** 检查结果；`scope` 是 `global` 或某个目标目录的 `project`。 */
export interface SkillCheckResult {
  readonly ok: true
  readonly scope: 'global' | 'project'
  readonly dir?: string
  readonly results: SkillCheckEntry[]
  readonly message?: string
}

/** 更新结果：逐项说明成功、跳过与失败。 */
export interface SkillUpdateResult {
  readonly ok: true
  readonly scope: 'global' | 'project'
  readonly dir?: string
  readonly updated: Array<{ readonly name: string }>
  readonly skipped: Array<{
    readonly name: string
    readonly status: SkillCheckStatus
    readonly reason: string
  }>
  readonly failed: Array<{
    readonly name: string
    readonly message: string
    readonly output?: string
  }>
  readonly message: string
}

/** 检查 / 更新失败的形状。 */
export interface SkillUpdateFailure {
  readonly ok: false
  readonly code: string
  readonly message: string
  readonly output?: string
}

/** CLI 进程的结果；`exitCode === null` 表示进程没有正常启动。 */
export interface SkillsCliResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

/** 可注入的 CLI 执行函数。 */
export type SkillsCliRunner = (
  args: string[],
  options?: { cwd?: string },
) => Promise<SkillsCliResult>

/** 仓库读取能力：只用到 `listSkills()` 判断来源是否仍可解析。 */
export interface UpdateCatalog {
  listSkills(options: { source: string; refresh?: boolean }): Promise<{
    ok: boolean
    skills?: Array<{ name: string; description?: string; path: string }>
    code?: string
    message?: string
  }>
}

/** 检查 / 更新需要的共享依赖。 */
export interface SkillUpdateDeps {
  readonly homes?: Homes
  readonly catalog: UpdateCatalog
  /** CLI 执行函数；测试注入假 runner。 */
  readonly cli?: SkillsCliRunner
  /** 绕过仓库缓存重新拉取来源。 */
  readonly refresh?: boolean
}

/** 检查 / 更新的候选：一条由 npx lock 管理、且仍装在磁盘上的 skill。 */
interface Candidate {
  readonly name: string
  readonly id: string
  readonly source: string
  readonly sourceUrl: string | null
  readonly installedPath: string
  /** 项目级候选：lock 里的内容哈希；缺失表示无法判断本地修改。 */
  readonly computedHash: string | null
}

type CandidatesResult =
  | { readonly ok: true; readonly scope: 'global' | 'project'; readonly candidates: Candidate[] }
  | SkillUpdateFailure

/**
 * 解析 `skills check` 的文本输出。
 *
 * CLI 没有 `--json`，但这两类行是稳定的：`↑ <name> has an update` 与
 * `✎ <name> has local changes`。解析前先去掉 ANSI 颜色码，避免名字里混入转义。
 *
 * @param output CLI 的 stdout + stderr
 */
export function parseCheckOutput(output: string): {
  updates: Set<string>
  modified: Set<string>
  failedSources: string[]
} {
  const updates = new Set<string>()
  const modified = new Set<string>()
  const failedSources: string[] = []
  for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
    const line = rawLine.trim()
    const update = /^↑ (.+) has an update$/u.exec(line)
    if (update?.[1] !== undefined) {
      updates.add(update[1].trim())
      continue
    }
    const changed = /^✎ (.+) has local changes$/u.exec(line)
    if (changed?.[1] !== undefined) {
      modified.add(changed[1].trim())
      continue
    }
    const failed = /^✗ Failed to check skills from (.+)$/u.exec(line)
    if (failed?.[1] !== undefined) failedSources.push(failed[1].trim())
  }
  return { updates, modified, failedSources }
}

/**
 * 去掉 ANSI 颜色 / 控制序列。
 *
 * @param text 原始文本
 */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 这里要匹配的正是 ANSI 转义
  return text.replace(/\u001b\[[0-9;]*m/gu, '')
}

/**
 * 解析 `skills` 包自带 CLI 的绝对路径。
 *
 * 通过包的 `exports` 子路径解析，插件被安装到 profile 后仍能取到同一份依赖。
 */
export function resolveSkillsCliPath(): string {
  const require = createRequire(import.meta.url)
  return require.resolve('skills/bin/cli.mjs')
}

/**
 * 创建默认的 CLI 执行函数：`node <cli> ...args`，关闭遥测与颜色。
 *
 * 用 `node` 直接执行包的入口，不经过 `npx`，也不依赖 PATH 里的全局命令。
 */
export function createSkillsCliRunner({
  timeoutMs = SKILL_UPDATE_TIMEOUT_MS,
  cliPath = resolveSkillsCliPath(),
  env = process.env,
}: {
  timeoutMs?: number
  cliPath?: string
  env?: NodeJS.ProcessEnv
} = {}): SkillsCliRunner {
  return (args, options = {}) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [cliPath, ...args],
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          env: {
            ...env,
            // CLI 的遥测默认开启；库 API 也通过 config.telemetry: false 关闭。
            DISABLE_TELEMETRY: '1',
            DO_NOT_TRACK: '1',
            NO_COLOR: '1',
            FORCE_COLOR: '0',
          },
        },
        (error, stdout, stderr) => {
          const exitCode =
            error === null
              ? 0
              : typeof (error as { code?: unknown }).code === 'number'
                ? ((error as { code: number }).code ?? null)
                : null
          resolve({
            exitCode,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            ...(error === null ? {} : { error: error.message }),
          })
        },
      )
    })
}

/**
 * 检查全局或某个目标目录里的 skill 状态。
 *
 * @param deps 仓库读取能力、CLI runner 与作用域
 */
export async function checkSkills(
  deps: SkillUpdateDeps & { dir?: string },
): Promise<SkillCheckResult | SkillUpdateFailure> {
  const { homes = resolveHomes(), catalog, cli = createSkillsCliRunner(), refresh } = deps
  const prepared = await collectCandidates({ homes, dir: deps.dir })
  if (!prepared.ok) return prepared
  const { scope, candidates } = prepared
  if (candidates.length === 0) {
    return {
      ok: true,
      scope,
      ...(scope === 'project' && deps.dir !== undefined ? { dir: deps.dir } : {}),
      results: [],
      message: '没有由 npx 管理、且仍安装在磁盘上的 skill，无需检查。',
    }
  }

  if (scope === 'global') {
    const mismatch = globalHomeMismatch(homes)
    if (mismatch !== null) return { ok: false, code: 'unsupported-home', message: mismatch }
  }

  const checked = await runCheckCli({
    scope,
    dir: deps.dir,
    cli,
  })
  if (!checked.ok) return checked

  const { updates, modified, failedSources } = parseCheckOutput(checked.output)
  const checks = await evaluateCandidates({
    candidates,
    updates,
    modified,
    failedSources,
    catalog,
    ...(refresh === undefined ? {} : { refresh }),
  })
  return {
    ok: true,
    scope,
    ...(scope === 'project' && deps.dir !== undefined ? { dir: deps.dir } : {}),
    results: checks,
  }
}

/**
 * 检查并更新：只应用 `update` 状态，`modified` 默认跳过。
 *
 * 更新逐个执行，任何一个失败都不影响后面的；每个失败项带上 CLI 输出。
 * 没有可更新项时明确返回「已是最新」。
 *
 * @param deps 同 `checkSkills()`
 */
export async function updateSkills(
  deps: SkillUpdateDeps & { dir?: string },
): Promise<SkillUpdateResult | SkillUpdateFailure> {
  const { homes = resolveHomes(), catalog, cli = createSkillsCliRunner(), refresh } = deps
  const prepared = await collectCandidates({ homes, dir: deps.dir })
  if (!prepared.ok) return prepared
  const { scope, candidates } = prepared
  const base = {
    scope,
    ...(scope === 'project' && deps.dir !== undefined ? { dir: deps.dir } : {}),
  }
  if (candidates.length === 0) {
    return {
      ok: true,
      ...base,
      updated: [],
      skipped: [],
      failed: [],
      message: '没有由 npx 管理、且仍安装在磁盘上的 skill，无需更新。',
    }
  }
  if (scope === 'global') {
    const mismatch = globalHomeMismatch(homes)
    if (mismatch !== null) return { ok: false, code: 'unsupported-home', message: mismatch }
  }

  const checked = await runCheckCli({ scope, dir: deps.dir, cli })
  if (!checked.ok) return checked
  const { updates, modified, failedSources } = parseCheckOutput(checked.output)
  const checks = await evaluateCandidates({
    candidates,
    updates,
    modified,
    failedSources,
    catalog,
    ...(refresh === undefined ? {} : { refresh }),
  })

  const updated: SkillUpdateResult['updated'] = []
  const skipped: SkillUpdateResult['skipped'] = []
  const failed: SkillUpdateResult['failed'] = []
  let attempted = 0

  for (const entry of checks) {
    if (entry.status === 'update') {
      attempted += 1
      const args = ['update', entry.name, scope === 'global' ? '-g' : '-p', '-y']
      const result = await cli(args, cliOptions(scope, deps.dir))
      const output = [result.stdout, result.stderr].filter((text) => text !== '').join('\n')
      if (result.exitCode === 0) {
        updated.push({ name: entry.name })
        continue
      }
      failed.push({
        name: entry.name,
        message:
          result.exitCode === null
            ? `skills update 无法启动：${result.error ?? '未知原因'}`
            : `skills update 失败（退出码 ${result.exitCode}）`,
        ...(output === '' ? {} : { output }),
      })
      continue
    }
    if (entry.status === 'modified') {
      skipped.push({
        name: entry.name,
        status: 'modified',
        reason: '本地文件已被修改，默认跳过更新，避免覆盖你的改动。',
      })
      continue
    }
    if (entry.status === 'unsupported-source') {
      skipped.push({
        name: entry.name,
        status: 'unsupported-source',
        reason: '来源里已经没有可再解析的 skill（常见于旧 marketplace 安装），无法自动更新。',
      })
      continue
    }
    if (entry.status === 'failed') {
      failed.push({
        name: entry.name,
        message: entry.message ?? '检查失败，已跳过更新。',
        ...(entry.output === undefined ? {} : { output: entry.output }),
      })
    }
  }

  let message: string
  if (attempted === 0) {
    message =
      skipped.length === 0
        ? '所有 skill 都已是最新。'
        : `没有可更新的 skill（${skipped.length} 个已跳过）；其余已是最新。`
  } else {
    message = `已更新 ${updated.length} 个 skill${failed.length === 0 ? '。' : `，${failed.length} 个失败。`}`
  }
  return { ok: true, ...base, updated, skipped, failed, message }
}

/**
 * 收集候选并确定作用域。
 */
async function collectCandidates({
  homes,
  dir,
}: {
  homes: Homes
  dir?: string | undefined
}): Promise<CandidatesResult> {
  if (dir !== undefined) {
    const project = await projectCandidates(dir)
    return project.ok ? { ok: true, scope: 'project', candidates: project.candidates } : project
  }
  return { ok: true, scope: 'global', candidates: await globalCandidates(homes) }
}

/** 全局候选：位于 `~/.agents/skills` 且出现在 npx lock 里的 skill。 */
async function globalCandidates(homes: Homes): Promise<Candidate[]> {
  const snapshot = await collectGlobalSkills({ homes })
  const candidates: Candidate[] = []
  for (const skill of snapshot.skills) {
    if (skill.managedByNpx !== true) continue
    const source = skill.npxSource ?? skill.npxSourceUrl
    if (typeof source !== 'string' || source === '') continue
    candidates.push({
      name: skill.name,
      id: skill.id,
      source,
      sourceUrl: skill.npxSourceUrl,
      installedPath: skill.path,
      computedHash: null,
    })
  }
  return candidates
}

/** 项目级 lock 的结构（只读版本 1 / 2 的 skills 字段）。 */
interface ProjectLockEntry {
  source?: unknown
  sourceUrl?: unknown
  computedHash?: unknown
}

/**
 * 项目级候选：目标目录的 `skills-lock.json` 里 tracked、且目录仍在的 skill。
 *
 * lock 里没有的目录按手工安装处理，不参与检查 / 更新。
 */
async function projectCandidates(
  dir: string,
): Promise<{ readonly ok: true; readonly candidates: Candidate[] } | SkillUpdateFailure> {
  const lockPath = path.join(dir, PROJECT_LOCK_FILE)
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(lockPath, 'utf8'))
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
      return { ok: true, candidates: [] }
    }
    return {
      ok: false,
      code: 'lock-unreadable',
      message: `无法读取 ${lockPath}：${errorText(error)}`,
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'lock-unreadable', message: `${lockPath} 不是合法的 JSON 对象。` }
  }
  const record = parsed as { version?: unknown; skills?: unknown }
  if (
    (record.version !== 1 && record.version !== PROJECT_LOCK_VERSION) ||
    record.skills === null ||
    typeof record.skills !== 'object' ||
    Array.isArray(record.skills)
  ) {
    return {
      ok: false,
      code: 'lock-unreadable',
      message: `${lockPath} 的版本或结构不受支持。`,
    }
  }

  const candidates: Candidate[] = []
  for (const [name, raw] of Object.entries(record.skills as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as ProjectLockEntry
    const source = typeof entry.source === 'string' ? entry.source : ''
    if (source === '') continue
    const id = skillDirName(name)
    if (id === '') continue
    const installedPath = path.join(dir, '.agents', 'skills', id)
    try {
      await fs.access(path.join(installedPath, 'SKILL.md'))
    } catch {
      continue
    }
    candidates.push({
      name,
      id,
      source,
      sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl : null,
      installedPath,
      computedHash: typeof entry.computedHash === 'string' ? entry.computedHash : null,
    })
  }
  return { ok: true, candidates }
}

/**
 * 跑一次 `skills check`。
 *
 * 退出码 1 是正常结论（发现更新或本地修改），0 表示没有；其它退出码或进程
 * 没启动起来时整体失败。
 */
async function runCheckCli({
  scope,
  dir,
  cli,
}: {
  scope: 'global' | 'project'
  dir?: string | undefined
  cli: SkillsCliRunner
}): Promise<{ readonly ok: true; readonly output: string } | SkillUpdateFailure> {
  const args = ['check', scope === 'global' ? '-g' : '-p', '-y']
  const result = await cli(args, cliOptions(scope, dir))
  const output = [result.stdout, result.stderr].filter((text) => text !== '').join('\n')
  if (result.exitCode === null || result.exitCode > 1) {
    return {
      ok: false,
      code: 'check-failed',
      message:
        result.exitCode === null
          ? `skills check 无法启动：${result.error ?? '未知原因'}`
          : `skills check 失败（退出码 ${result.exitCode}）`,
      ...(output === '' ? {} : { output }),
    }
  }
  return { ok: true, output }
}

/**
 * 把 CLI 结论、来源可解析性与本地修改合成每个 skill 的状态。
 *
 * 来源不可解析（repo-unavailable / unsupported-source）或仓库根 `skills/` 下
 * 已经没有这个 skill 时记为 `unsupported-source`；读取来源本身失败记为
 * `failed`。CLI 检查失败的来源，其下候选也记为 `failed`。
 */
async function evaluateCandidates({
  candidates,
  updates,
  modified,
  failedSources,
  catalog,
  refresh,
}: {
  candidates: Candidate[]
  updates: Set<string>
  modified: Set<string>
  failedSources: string[]
  catalog: UpdateCatalog
  refresh?: boolean | undefined
}): Promise<SkillCheckEntry[]> {
  const sources = new Map<string, SourceSupport>()
  const loweredFailedSources = failedSources.map((source) => stripAnsi(source).toLowerCase())

  const namesIn = (set: Set<string>, candidate: Candidate): boolean => {
    for (const value of set) {
      const lowered = value.toLowerCase()
      if (lowered === candidate.name.toLowerCase() || lowered === candidate.id.toLowerCase()) {
        return true
      }
    }
    return false
  }

  const entries: SkillCheckEntry[] = []
  for (const candidate of candidates) {
    let source = sources.get(candidate.source)
    if (source === undefined) {
      source = await resolveSourceSupport(catalog, candidate.source, refresh)
      sources.set(candidate.source, source)
    }
    const state = source.state
    const supported =
      state !== 'supported' ||
      source.names.has(candidate.name.toLowerCase()) ||
      source.names.has(candidate.id.toLowerCase())
    if (state === 'supported' && !supported) {
      entries.push({
        name: candidate.name,
        source: candidate.source,
        status: 'unsupported-source',
        message: '仓库根 skills/ 下已经找不到这个 skill（常见于旧 marketplace 安装）。',
      })
      continue
    }

    const failedByCli =
      loweredFailedSources.length > 0 &&
      loweredFailedSources.some(
        (source) =>
          source === candidate.source.toLowerCase() ||
          (candidate.sourceUrl !== null && source === candidate.sourceUrl.toLowerCase()),
      )

    if (state === 'unsupported') {
      entries.push({
        name: candidate.name,
        source: candidate.source,
        status: 'unsupported-source',
        message: '来源里已经没有可再解析的 skill（常见于旧 marketplace 安装）。',
      })
      continue
    }
    if (state === 'failed') {
      entries.push({
        name: candidate.name,
        source: candidate.source,
        status: 'failed',
        message: source.message ?? '无法读取来源。',
      })
      continue
    }
    if (failedByCli) {
      entries.push({
        name: candidate.name,
        source: candidate.source,
        status: 'failed',
        message: 'skills check 无法检查这个来源。',
      })
      continue
    }
    if (namesIn(modified, candidate)) {
      entries.push({ name: candidate.name, source: candidate.source, status: 'modified' })
      continue
    }
    if (namesIn(updates, candidate)) {
      entries.push({ name: candidate.name, source: candidate.source, status: 'update' })
      continue
    }
    // 项目级 skill 有内容哈希时自己再判一次本地修改：CLI 已经会报，这里兜底
    // 兼容没有 stdout 解析成功的边界，同时覆盖 lock 里的 skill 仍存在但 CLI
    // 未列出 modified 的情况。
    if (candidate.computedHash !== null) {
      const current = await computeSkillFolderHash(candidate.installedPath).catch(() => null)
      if (current !== null && current !== candidate.computedHash) {
        entries.push({ name: candidate.name, source: candidate.source, status: 'modified' })
        continue
      }
    }
    entries.push({ name: candidate.name, source: candidate.source, status: 'up-to-date' })
  }
  return entries
}

/**
 * 判断一个来源是否仍能解析出这个 skill（按仓库根 `skills/` 的发现规则）。
 */
interface SourceSupport {
  state: 'supported' | 'unsupported' | 'failed'
  message?: string
  /** 仓库根 skills/ 下可安装 skill 的名字（小写）。 */
  names: Set<string>
}

async function resolveSourceSupport(
  catalog: UpdateCatalog,
  source: string,
  refresh?: boolean | undefined,
): Promise<SourceSupport> {
  let listed: Awaited<ReturnType<UpdateCatalog['listSkills']>>
  try {
    listed = await catalog.listSkills({ source, ...(refresh === undefined ? {} : { refresh }) })
  } catch (error) {
    return { state: 'failed', message: errorText(error), names: new Set() }
  }
  if (!listed.ok) {
    if (listed.code === 'repo-unavailable' || listed.code === 'unsupported-source') {
      return { state: 'unsupported', names: new Set() }
    }
    return { state: 'failed', message: listed.message ?? '无法读取来源。', names: new Set() }
  }
  const names = new Set<string>()
  for (const skill of listed.skills ?? []) {
    names.add(skill.name.toLowerCase())
    names.add(skillDirName(skill.name).toLowerCase())
  }
  return { state: 'supported', names }
}

/**
 * 全局更新固定写 `~/.agents`；DSH 扫描别的目录时拒绝执行，避免改到看不见的位置。
 */
function globalHomeMismatch(homes: Homes): string | null {
  const canonical = path.join(os.homedir(), '.agents')
  if (path.resolve(homes.agentsHome) === path.resolve(canonical)) return null
  return `skills CLI 只更新 ${path.join(canonical, 'skills')}，而 DSH 现在扫描 ${path.join(homes.agentsHome, 'skills')}（DSH_AGENTS_HOME）；为避免更新到看不见的位置，这里不执行。`
}

/**
 * CLI 的 cwd 选项：项目级必须传目标目录，全局不传。
 */
function cliOptions(
  scope: 'global' | 'project',
  dir: string | undefined,
): { cwd?: string } | undefined {
  return scope === 'project' && dir !== undefined ? { cwd: dir } : undefined
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
