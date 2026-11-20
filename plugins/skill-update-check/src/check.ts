/**
 * 当前工作区项目技能的更新检查。
 *
 * DSH 的工作区目录里，由 `npx skills` 管理的项目 skill 记录在
 * `skills-lock.json`（version 1 / 2）。插件只做一件事：调用 `skills` 包自带的
 * CLI（与 `npx skills` 同一套实现）跑 `check -p -y`，把输出里的
 * `↑ <name> has an update` 收成列表。
 *
 * 退出码约定与 CLI 一致：0 表示全部最新，1 表示有更新或本地修改（正常结论），
 * 其它退出码或进程没启动起来才算检查失败。检查不写任何文件：CLI 只读 lock、
 * 读安装目录、拉取来源里的 skill 列表。
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

import type { SkillUpdatesFailure, SkillUpdatesSnapshot } from './types.ts'

/** 项目级 lock 文件名与支持的版本。 */
export const PROJECT_LOCK_FILE = 'skills-lock.json'
export const PROJECT_LOCK_VERSION = 2

/** 单次 CLI 调用的超时；与 Skills 插件的更新流程一致。 */
export const CHECK_TIMEOUT_MS = 120_000

/** 同一个工作区的检查结果缓存时长；点提示可绕过。 */
export const CHECK_TTL_MS = 5 * 60_000

/** CLI 输出上限；正常输出很小，这里只防异常刷屏。 */
const MAX_OUTPUT_BYTES = 1024 * 1024

/** 失败响应里保留的输出尾部；完整的 1 MiB 没必要发给浏览器。 */
const MAX_FAILURE_OUTPUT = 4000

/** `skills check` 的固定参数：只检查项目作用域，非交互。 */
const CHECK_ARGS = ['check', '-p', '-y'] as const

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
}

/** 读取项目 lock 的结果。 */
export type ProjectLockResult = ({ readonly ok: true } & ProjectLock) | SkillUpdatesFailure

/** `parseCheckOutput()` 的结论；只关心「有更新」与「哪些来源没检查成」。 */
export interface ParsedCheckOutput {
  readonly updates: ReadonlySet<string>
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
  /** 缓存时长（毫秒）；默认 {@link CHECK_TTL_MS}。 */
  readonly ttlMs?: number
  readonly now?: () => number
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
 * CLI 没有 `--json`，但这两类行是稳定的：
 * `↑ <name> has an update` 与 `✗ Failed to check skills from <source>`。
 * 解析前先去掉 ANSI 颜色码，避免名字里混入转义。
 *
 * @param output CLI 的 stdout + stderr
 * @returns 有更新的 skill 名与检查失败的来源
 */
export function parseCheckOutput(output: string): ParsedCheckOutput {
  const updates = new Set<string>()
  const failedSources: string[] = []
  for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
    const line = rawLine.trim()
    const update = /^↑ (.+) has an update$/u.exec(line)
    if (update?.[1] !== undefined) {
      updates.add(update[1].trim())
      continue
    }
    const failed = /^✗ Failed to check skills from (.+)$/u.exec(line)
    if (failed?.[1] !== undefined) failedSources.push(failed[1].trim())
  }
  return { updates, failedSources }
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
      return { ok: true, names: [] }
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
  for (const [name, raw] of Object.entries(record.skills as Record<string, unknown>)) {
    if (name.trim() === '') continue
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const source = (raw as { source?: unknown }).source
    if (typeof source !== 'string' || source.trim() === '') continue
    names.push(name)
  }
  return { ok: true, names }
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

  const updates = [...parseCheckOutput(output).updates].sort((left, right) =>
    left.localeCompare(right),
  )
  return {
    ok: true,
    status: updates.length === 0 ? 'up-to-date' : 'updates',
    dir,
    total: lock.names.length,
    updates,
    checkedAt,
  }
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
 * 带缓存与并发合并的检查器。
 *
 * 同一个工作区在 {@link CHECK_TTL_MS} 内只跑一次 CLI；多个会话同时挂载时
 * 共用同一个进行中的 Promise。只缓存成功结果，失败在下一次请求时重试。
 */
export class SkillChecker {
  readonly #runner: SkillsCliRunner
  readonly #ttlMs: number
  readonly #now: () => number
  readonly #cache = new Map<
    string,
    { readonly at: number; readonly snapshot: SkillUpdatesSnapshot }
  >()
  readonly #inFlight = new Map<string, Promise<SkillUpdatesSnapshot | SkillUpdatesFailure>>()

  constructor(options: SkillCheckerOptions = {}) {
    this.#runner = options.runner ?? createSkillsCliRunner()
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
