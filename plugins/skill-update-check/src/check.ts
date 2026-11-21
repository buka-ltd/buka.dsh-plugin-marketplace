/**
 * 当前工作区项目技能的更新检查与更新。
 *
 * DSH 的工作区目录里，由 `npx skills` 管理的项目 skill 记录在
 * `skills-lock.json`（version 1 / 2）。插件只做两件事：调用 `skills` 包自带的
 * CLI（与 `npx skills` 同一套实现）跑 `check -p -y`，把输出里的
 * `↑ <name> has an update` 收成列表；用户确认后，对选中的 skill 逐个跑
 * `update <name> -p -y`。
 *
 * 检查的退出码约定与 CLI 一致：0 表示全部最新，1 表示有更新或本地修改（正常
 * 结论），其它退出码或进程没启动起来才算检查失败。检查是只读的：CLI 只读
 * lock、读安装目录、拉取来源里的 skill 列表。更新会改写 lock 与安装目录，所以
 * 只更新检查刚刚确认为「有更新」的那几个 skill，并且串行执行。
 *
 * 全局 skill 与手工安装的 skill 不在范围内；那是 Skills 插件页面的职责。
 *
 * 本模块不 import React 与 DSH 包，`node --test` 可以直接 import。
 *
 * @module @buka/dsh-plugin-skill-update-check/check
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import type {
  SkillUpdateFailureItem,
  SkillUpdateReport,
  SkillUpdatesFailure,
  SkillUpdatesSnapshot,
} from './types.ts'

/** 项目级 lock 文件名与支持的版本。 */
export const PROJECT_LOCK_FILE = 'skills-lock.json'
export const PROJECT_LOCK_VERSION = 2

/** 检查那次 CLI 调用的超时；与 Skills 插件的更新流程一致。 */
export const CHECK_TIMEOUT_MS = 120_000

/** 更新那次 CLI 调用的超时；更新要下载并覆盖文件，比检查慢。 */
export const UPDATE_TIMEOUT_MS = 180_000

/** 同一个工作区的检查结果缓存时长；点提示可绕过。 */
export const CHECK_TTL_MS = 5 * 60_000

/** CLI 输出上限；正常输出很小，这里只防异常刷屏。 */
const MAX_OUTPUT_BYTES = 1024 * 1024

/** 失败响应里保留的输出尾部；完整的 1 MiB 没必要发给浏览器。 */
const MAX_FAILURE_OUTPUT = 4000

/** `skills check` 的固定参数：只检查项目作用域，非交互。 */
const CHECK_ARGS = ['check', '-p', '-y'] as const

/** `skills update` 的固定参数：项目作用域、非交互；skill 名插在它们前面。 */
const UPDATE_FLAGS = ['-p', '-y'] as const

/** `skills` 包自带 CLI 的进程结果；`exitCode === null` 表示没有正常启动。 */
export interface SkillsCliResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

/** 可注入的 CLI 执行函数：参数 + 工作目录，不抛错。 */
export type SkillsCliRunner = (
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<SkillsCliResult>

/** `readProjectLock()` 成功时的结果。 */
export interface ProjectLock {
  /** lock 里由 npx 管理、且记录了来源的 skill 名。 */
  readonly names: readonly string[]
  /** skill 名 → lock 里记录的来源，例如 `owner/repo`；弹窗用它标注来源。 */
  readonly sources: Readonly<Record<string, string>>
}

/** 读取项目 lock 的结果。 */
export type ProjectLockResult = ({ readonly ok: true } & ProjectLock) | SkillUpdatesFailure

/** `parseCheckOutput()` 的结论：有更新、有本地修改，以及哪些来源没检查成。 */
export interface ParsedCheckOutput {
  readonly updates: ReadonlySet<string>
  readonly modified: ReadonlySet<string>
  readonly failedSources: readonly string[]
}

/** 创建 CLI runner 的可选参数；测试可注入固定路径与超时。 */
export interface CreateSkillsCliRunnerOptions {
  readonly timeoutMs?: number
  readonly cliPath?: string
  readonly env?: NodeJS.ProcessEnv
}

/** 单次检查的参数。 */
export interface CheckProjectSkillsOptions {
  readonly dir: string
  /** CLI 执行函数；默认使用插件依赖的 `skills` 包自带 CLI。 */
  readonly runner?: SkillsCliRunner
  /** 时钟；测试注入固定时间。 */
  readonly now?: () => number
}

/** `SkillChecker` 的构造参数。 */
export interface SkillCheckerOptions {
  readonly runner?: SkillsCliRunner
  /** 更新用的 CLI 执行函数；省略时跟随 `runner`，两者都没有就用默认 runner。 */
  readonly updateRunner?: SkillsCliRunner
  /** 缓存时长（毫秒）；默认 {@link CHECK_TTL_MS}。 */
  readonly ttlMs?: number
  readonly now?: () => number
}

/** `applySkillUpdates()` 的入参。 */
export interface ApplySkillUpdatesOptions {
  /** 工作区目录。 */
  readonly dir: string
  /** 只更新这些 skill；调用方应先用一次检查确认它们确实有待更新。 */
  readonly names: readonly string[]
  /** CLI 执行函数。 */
  readonly runner: SkillsCliRunner
}

/** 一次更新里每个 skill 的结果。 */
export interface AppliedSkillUpdates {
  readonly updated: readonly string[]
  readonly failed: readonly SkillUpdateFailureItem[]
}

/**
 * 去掉 ANSI 颜色 / 控制序列。
 *
 * @param text 原始文本
 * @returns 不含 ANSI 转义的文本
 */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 这里要匹配的正是 ANSI 转义
  return text.replace(/\u001b\[[0-9;]*m/gu, '')
}

/**
 * 解析 `skills check` 的文本输出。
 *
 * CLI 没有 `--json`，但这三类行是稳定的：
 * `↑ <name> has an update`、`✎ <name> has local changes` 与
 * `✗ Failed to check skills from <source>`。解析前先去掉 ANSI 颜色码，避免
 * 名字里混入转义。
 *
 * @param output CLI 的 stdout + stderr
 * @returns 有更新的 skill 名、有本地修改的 skill 名与检查失败的来源
 */
export function parseCheckOutput(output: string): ParsedCheckOutput {
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
 * 读取一个工作区的 `skills-lock.json`。
 *
 * 文件不存在表示这个工作区没有 npx 管理的项目 skill，是正常情况；文件损坏
 * 或版本不认识时整体失败，绝不猜测状态。
 *
 * @param dir 工作区目录
 * @returns lock 里的 skill 名，或失败原因
 */
export async function readProjectLock(dir: string): Promise<ProjectLockResult> {
  const file = path.join(dir, PROJECT_LOCK_FILE)
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
      return { ok: true, names: [], sources: {} }
    }
    return {
      ok: false,
      code: 'lock-unreadable',
      message: `无法读取 ${file}：${errorText(error)}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      code: 'lock-unreadable',
      message: `${file} 不是合法的 JSON：${errorText(error)}`,
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'lock-unreadable', message: `${file} 不是合法的 JSON 对象。` }
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
      message: `${file} 的版本或结构不受支持。`,
    }
  }

  const names: string[] = []
  const sources: Record<string, string> = {}
  for (const [name, raw] of Object.entries(record.skills as Record<string, unknown>)) {
    if (name.trim() === '') continue
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const source = (raw as { source?: unknown }).source
    if (typeof source !== 'string' || source.trim() === '') continue
    names.push(name)
    sources[name] = source.trim()
  }
  return { ok: true, names, sources }
}

/**
 * 检查一个工作区里的项目 skill 是否有上游更新。
 *
 * @param options 工作区目录、CLI runner 与时钟
 * @returns 检查快照，或失败原因
 */
export async function checkProjectSkills(
  options: CheckProjectSkillsOptions,
): Promise<SkillUpdatesSnapshot | SkillUpdatesFailure> {
  const dir = path.resolve(options.dir)
  const now = options.now ?? Date.now
  const lock = await readProjectLock(dir)
  if (!lock.ok) return lock

  const checkedAt = now()
  if (lock.names.length === 0) {
    return {
      ok: true,
      status: 'no-project-skills',
      dir,
      total: 0,
      updates: [],
      checkedAt,
    }
  }

  const runner = options.runner ?? createSkillsCliRunner()
  const result = await runner(CHECK_ARGS, { cwd: dir })
  const output = joinOutput(result)
  const failureOutput = stripAnsi(output).slice(-MAX_FAILURE_OUTPUT)
  if (result.exitCode === null) {
    return {
      ok: false,
      code: 'cli-unavailable',
      message: `skills check 无法启动：${result.error ?? '未知原因'}`,
      ...(failureOutput === '' ? {} : { output: failureOutput }),
    }
  }
  if (result.exitCode > 1) {
    return {
      ok: false,
      code: 'check-failed',
      message: `skills check 失败（退出码 ${result.exitCode}）`,
      ...(failureOutput === '' ? {} : { output: failureOutput }),
    }
  }

  const parsed = parseCheckOutput(output)
  // 有本地修改的 skill 不进入可更新列表：`skills update` 会覆盖这些修改。
  const modified = [...parsed.modified].sort((left, right) => left.localeCompare(right))
  const modifiedSet = new Set(modified)
  const updates = [...parsed.updates]
    .filter((name) => !modifiedSet.has(name))
    .sort((left, right) => left.localeCompare(right))
  // 只给待更新的 skill 带来源：弹窗在名字下面显示它，用户能确认更新的是哪个仓库。
  const sources: Record<string, string> = {}
  for (const name of updates) {
    const source = lock.sources[name]
    if (source !== undefined) sources[name] = source
  }
  return {
    ok: true,
    status: updates.length === 0 ? 'up-to-date' : 'updates',
    dir,
    total: lock.names.length,
    updates,
    ...(modified.length === 0 ? {} : { modified }),
    ...(Object.keys(sources).length === 0 ? {} : { sources }),
    checkedAt,
  }
}

/**
 * 逐个更新指定的项目 skill。
 *
 * 只跑 `skills update <name> -p -y`，不自己改 lock 或安装目录：更新逻辑、
 * 来源解析与 lock 迁移都由 CLI 维护。任何一项失败都不影响后面的，失败项带上
 * 输出尾部。名字由调用方先用一次检查筛过，所以这里不再判断它是否有更新。
 *
 * @param options 工作区目录、要更新的名字与 CLI runner
 * @returns 成功与失败的 skill
 */
export async function applySkillUpdates(
  options: ApplySkillUpdatesOptions,
): Promise<AppliedSkillUpdates> {
  const dir = path.resolve(options.dir)
  const updated: string[] = []
  const failed: SkillUpdateFailureItem[] = []

  for (const name of options.names) {
    const result = await options.runner(['update', name, ...UPDATE_FLAGS], { cwd: dir })
    if (result.exitCode === 0) {
      updated.push(name)
      continue
    }
    const base =
      result.exitCode === null
        ? `skills update 无法启动：${result.error ?? '未知原因'}`
        : `skills update 失败（退出码 ${result.exitCode}）`
    const detail = lastOutputLine(stripAnsi(joinOutput(result)).slice(-MAX_FAILURE_OUTPUT))
    failed.push({ name, message: detail === '' ? base : `${base} ${detail}` })
  }

  return { updated, failed }
}

/**
 * 解析 `skills` 包自带 CLI 的绝对路径。
 *
 * 通过包的 `exports` 子路径解析，插件被安装到 profile 后仍能取到同一份依赖。
 *
 * @returns CLI 入口的绝对路径
 */
export function resolveSkillsCliPath(): string {
  const require = createRequire(import.meta.url)
  return require.resolve('skills/bin/cli.mjs')
}

/**
 * 创建默认的 CLI 执行函数：`node <cli> check ...`，关闭遥测与颜色。
 *
 * 用 `node` 直接执行插件依赖里的 CLI，不经过 `npx`，也不依赖 PATH；与
 * `npx skills` 使用的是同一份实现。
 *
 * @param options 超时、CLI 路径与基础环境
 * @returns 调用 CLI 的函数
 */
export function createSkillsCliRunner(options: CreateSkillsCliRunnerOptions = {}): SkillsCliRunner {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS
  const baseEnv = options.env ?? process.env

  return (args, { cwd }) =>
    new Promise((resolve) => {
      let cliPath: string
      try {
        cliPath = options.cliPath ?? resolveSkillsCliPath()
      } catch (error) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          error: `找不到 skills CLI：${errorText(error)}`,
        })
        return
      }

      execFile(
        process.execPath,
        [cliPath, ...args],
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          env: {
            ...baseEnv,
            // CLI 的遥测默认开启；这里明确关闭，并固定无颜色输出。
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
 * 带缓存、并发合并与串行更新的检查器。
 *
 * 检查：同一个工作区在 {@link CHECK_TTL_MS} 内只跑一次 CLI；多个会话同时挂载
 * 时共用同一个进行中的 Promise。只缓存成功结果，失败在下一次请求时重试。
 *
 * 更新：先强制检查一次，只更新检查确认为「有更新」的 skill；更新会改写共享的
 * lock 与安装目录，所以同一实例内的更新一律排队串行，绝不并发。更新完丢弃该
 * 工作区的缓存并重新检查，把新快照一起返回。
 */
export class SkillChecker {
  readonly #runner: SkillsCliRunner
  readonly #updateRunner: SkillsCliRunner
  readonly #ttlMs: number
  readonly #now: () => number
  readonly #cache = new Map<
    string,
    { readonly at: number; readonly snapshot: SkillUpdatesSnapshot }
  >()
  readonly #inFlight = new Map<string, Promise<SkillUpdatesSnapshot | SkillUpdatesFailure>>()
  /** 更新的串行队列：`skills update` 会整份重写 lockfile，不能并发。 */
  #updateQueue: Promise<void> = Promise.resolve()

  constructor(options: SkillCheckerOptions = {}) {
    this.#runner = options.runner ?? createSkillsCliRunner()
    this.#updateRunner =
      options.updateRunner ??
      options.runner ??
      createSkillsCliRunner({ timeoutMs: UPDATE_TIMEOUT_MS })
    this.#ttlMs = options.ttlMs ?? CHECK_TTL_MS
    this.#now = options.now ?? Date.now
  }

  /**
   * 检查一个工作区；`refresh` 为 true 时跳过缓存。
   *
   * @param dir 工作区目录
   * @param options 是否强制刷新
   * @returns 检查结果
   */
  check(
    dir: string,
    options: { readonly refresh?: boolean } = {},
  ): Promise<SkillUpdatesSnapshot | SkillUpdatesFailure> {
    const key = path.resolve(dir)
    if (options.refresh !== true) {
      const cached = this.#cache.get(key)
      if (cached !== undefined && this.#now() - cached.at < this.#ttlMs) {
        return Promise.resolve(cached.snapshot)
      }
    }

    const running = this.#inFlight.get(key)
    if (running !== undefined) return running

    const work = checkProjectSkills({ dir: key, runner: this.#runner, now: this.#now })
      .then((result) => {
        if (result.ok) {
          this.#cache.set(key, { at: this.#now(), snapshot: result })
        }
        return result
      })
      .finally(() => {
        this.#inFlight.delete(key)
      })
    this.#inFlight.set(key, work)
    return work
  }

  /**
   * 更新一个工作区里的项目 skill；省略 `skills` 表示检查得到的全部。
   *
   * 请求里的名字会先与一次强制检查的结果求交集：已经是最新、或者不在
   * `skills-lock.json` 里的名字不会传给 CLI。更新结束后重新检查并把结果带给
   * 调用方；单个 skill 失败不改变请求的整体成功。
   *
   * @param dir 工作区目录
   * @param options 要更新的 skill 名；省略表示全部
   * @returns 更新报告，或检查 / 更新本身的失败
   */
  update(
    dir: string,
    options: { readonly skills?: readonly string[] } = {},
  ): Promise<SkillUpdateReport | SkillUpdatesFailure> {
    const work = () => this.#applyUpdate(dir, options)
    // 失败不卡住队列：下一个请求照样执行。
    const run = this.#updateQueue.then(work, work)
    this.#updateQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * 丢弃一个工作区的检查缓存，下一次 `check()` 重新跑 CLI。
   *
   * @param dir 工作区目录
   */
  invalidate(dir: string): void {
    this.#cache.delete(path.resolve(dir))
  }

  /** 排进队列之后的实际更新流程。 */
  async #applyUpdate(
    dir: string,
    options: { readonly skills?: readonly string[] },
  ): Promise<SkillUpdateReport | SkillUpdatesFailure> {
    const before = await this.check(dir, { refresh: true })
    if (!before.ok) return before

    const pending = new Set(before.updates)
    const requested = options.skills ?? before.updates
    const names: string[] = []
    for (const name of requested) {
      if (!pending.has(name) || names.includes(name)) continue
      names.push(name)
    }

    const checkedDir = before.dir ?? path.resolve(dir)
    if (names.length === 0) {
      return {
        ok: true,
        updated: [],
        failed: [],
        snapshot: before,
        message: '没有待更新的 skill。',
      }
    }

    const applied = await applySkillUpdates({
      dir: checkedDir,
      names,
      runner: this.#updateRunner,
    })
    this.invalidate(dir)
    const after = await this.check(dir, { refresh: true })
    const snapshot = after.ok ? after : snapshotWithout(before, applied.updated, this.#now())

    return {
      ok: true,
      updated: applied.updated,
      failed: applied.failed,
      snapshot,
      message:
        applied.failed.length === 0
          ? `已更新 ${applied.updated.length} 个 skill。`
          : `已更新 ${applied.updated.length} 个 skill，${applied.failed.length} 个失败。`,
    }
  }
}

/** 更新后的重新检查失败时，用更新前的快照减去成功项兜底。 */
function snapshotWithout(
  before: SkillUpdatesSnapshot,
  updated: readonly string[],
  checkedAt: number,
): SkillUpdatesSnapshot {
  const removed = new Set(updated)
  const updates = before.updates.filter((name) => !removed.has(name))
  return {
    ...before,
    status: updates.length === 0 ? 'up-to-date' : 'updates',
    updates,
    checkedAt,
  }
}

/** 取输出的最后一行非空文本；用于把 CLI 的失败原因拼进消息。 */
function lastOutputLine(output: string): string {
  return output.trim().split(/\r?\n/u).at(-1)?.trim() ?? ''
}

/** 拼 CLI 的 stdout / stderr；空片段不留下多余换行。 */
function joinOutput(result: SkillsCliResult): string {
  return [result.stdout, result.stderr].filter((text) => text !== '').join('\n')
}

/** 读错误对象上的可展示文本。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
