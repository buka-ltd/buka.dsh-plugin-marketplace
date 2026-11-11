/**
 * 定位并执行 `npx skills`：安装、卸载与列清单共用。
 *
 * 桌面版 DSH 从 Finder / Dock 启动时，进程的 PATH 可能与登录 shell 不同（没有
 * mise / nvm / Homebrew 的 shim），所以这里不直接 `spawn('npx')`，而是：
 *
 * 1. 先按 `PATH` 找 `npx`；
 * 2. 再按常见 Node 安装位置找（mise、nvm、Volta、Homebrew、系统目录）；
 * 3. 只有 `node` 时，用 node 直接跑 npm 自带的 `npx-cli.js`。
 *
 * 找不到任何入口就返回可读的失败原因，绝不让 npx 管理的 skill 退化成直接删
 * 目录 —— 那会留下 lockfile 记录与其它 agent 目录里的链接。
 *
 * 子进程超时时先解析失败响应再杀进程组：npm exec 可能再 fork 一个子进程，
 * 只杀直接子进程会让继承的管道一直开着、请求永远不返回。
 *
 * 两个插件的已知差异都保留成显式参数，不在这里悄悄统一：
 *
 * - 工作目录：skills 的全局安装固定在 `agentsHome` 下，robots 每次调用传项目
 *   目录（`cwd` 既可以在工厂里绑定，也可以在调用时覆盖）；
 * - 超时：skills 用默认的 120 s，robots 显式传 180 s；
 * - 失败信息：找不到 npx 时的完整文案由调用方传入；命令名默认是
 *   `npx skills`，robots 传一个按子命令生成的函数；
 * - 「没跑到子进程」的失败（找不到 npx、spawn 直接抛错）是否带 `output: ''`：
 *   robots 的返回形状要求有，skills 原本没有。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 页面展示与失败信息里保留的命令输出上限。 */
export const MAX_OUTPUT_BYTES = 4000

/** 未显式传超时时的默认值：与 skills 插件的全局安装一致（120 s）。 */
export const DEFAULT_NPX_TIMEOUT_MS = 120_000

/** `npx skills` 执行成功。 */
export interface NpxOk {
  readonly ok: true
  readonly output: string
}

/** `npx skills` 执行失败；`output` 是命令输出的尾部，可能没有。 */
export interface NpxFailure {
  readonly ok: false
  readonly message: string
  readonly output?: string
}

/** 一次 `npx skills` 调用的结果。 */
export type NpxResult = NpxOk | NpxFailure

/** 调用 `npx skills` 的函数；`cwd` 不传时用工厂里绑定的工作目录。 */
export type NpxRunner = (args: string[], cwd?: string) => Promise<NpxResult>

/** 找到的 npx 入口：命令、前置参数与要传给子进程的 PATH。 */
export interface NpxCommand {
  readonly command: string
  readonly prefixArgs: string[]
  readonly pathValue: string
}

/** 生成 runner 的全部参数；各插件的差异都从这里进来。 */
export interface NpxRunnerOptions {
  /**
   * 默认工作目录：`npx skills` 在这里写 lockfile、安装 skill。
   * 调用时传的 `cwd` 优先（robots 按工作区传）。
   */
  readonly cwd?: string
  /** 子进程环境；默认 `process.env`。 */
  readonly env?: NodeJS.ProcessEnv
  /** 最长等待时间（毫秒）；默认 {@link DEFAULT_NPX_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
  /** 保留的命令输出字节上限；默认 {@link MAX_OUTPUT_BYTES}。 */
  readonly maxOutputBytes?: number
  /**
   * 失败信息里指代这条命令的名称；默认 `npx skills`。
   * 传函数时按每次调用的参数生成（robots 用 `npx skills add` 这种带子命令的形式）。
   */
  readonly label?: string | ((args: string[]) => string)
  /**
   * 找不到 npx 时的完整失败原因。各插件的文案与提示不同，必须显式传入。
   */
  readonly missingMessage: string
  /**
   * 「没跑到子进程」的失败（找不到 npx、spawn 直接抛错）是否带 `output: ''`。
   * robots 的返回形状要求有；skills 原本没有。
   */
  readonly emptyOutputOnSetupFailure?: boolean
}

/** Windows 上 npm 的启动器是 `npx.cmd`，其余平台是 `npx`。 */
const NPX_EXECUTABLE = process.platform === 'win32' ? 'npx.cmd' : 'npx'

/** 失败信息里的默认命令名。 */
const DEFAULT_NPX_LABEL = 'npx skills'

/** CSI 转义序列（颜色、光标显隐、清行等）；ANSI 控制字符是这里要清理的目标。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列必须以 ESC 控制字符开头
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu

/** 命令输出里的回车符。 */
const CARRIAGE_RETURN = /\r/gu

/**
 * 生成调用 `npx skills` 的函数。
 *
 * 参数与 `uninstallGlobalSkill` / robots 安装路由里的 `runNpx` 一致：传入子命令
 * 参数，解析为 `{ ok, message?, output? }`；不抛错（工作目录缺失属于调用方
 * 编程错误，会直接抛出）。
 *
 * @param options 工作目录、超时、输出上限、失败文案等全部差异
 * @returns 调用 `npx skills` 的函数
 */
export function createNpxRunner(options: NpxRunnerOptions): NpxRunner {
  const baseEnv = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? DEFAULT_NPX_TIMEOUT_MS
  const maxOutputBytes = normalizeMaxOutputBytes(options.maxOutputBytes)

  return async function runNpx(args: string[], cwd?: string): Promise<NpxResult> {
    const commandArgs = Array.isArray(args) ? args : []
    const workingDirectory = typeof cwd === 'string' && cwd !== '' ? cwd : options.cwd
    if (typeof workingDirectory !== 'string' || workingDirectory === '') {
      throw new Error('执行 npx 需要工作目录')
    }
    const label = labelOf(options.label, commandArgs)
    const setupFailure = (message: string): NpxFailure =>
      options.emptyOutputOnSetupFailure === true
        ? { ok: false, message, output: '' }
        : { ok: false, message }

    const resolved = await resolveNpxCommand(baseEnv)
    if (resolved === null) return setupFailure(options.missingMessage)

    return await new Promise((resolve) => {
      let child: ChildProcess | undefined
      let timer: NodeJS.Timeout | undefined
      let settled = false
      /** 只结算一次：超时后 close 事件仍可能到来。 */
      const settle = (value: NpxResult): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolve(value)
      }

      try {
        child = spawn(
          resolved.command,
          [...resolved.prefixArgs, '--yes', 'skills', ...commandArgs],
          {
            cwd: workingDirectory,
            env: { ...baseEnv, PATH: resolved.pathValue },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            // POSIX 上放进独立进程组，超时可以整组杀掉（含 npm exec 的子进程）。
            detached: process.platform !== 'win32',
            shell: process.platform === 'win32',
          },
        )
      } catch (error) {
        settle(setupFailure(errorText(error)))
        return
      }

      let output = ''
      const collect = (chunk: Buffer | string): void => {
        output = (output + chunk.toString()).slice(-maxOutputBytes)
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)

      timer = setTimeout(() => {
        const text = cleanOutput(output, maxOutputBytes)
        settle({
          ok: false,
          message: `${label} 超时（${Math.round(timeoutMs / 1000)}s）`,
          output: text,
        })
        killTree(child)
      }, timeoutMs)

      child.once('error', (error) => {
        settle({
          ok: false,
          message: errorText(error),
          output: cleanOutput(output, maxOutputBytes),
        })
      })
      child.once('close', (code, signal) => {
        const text = cleanOutput(output, maxOutputBytes)
        if (code === 0) {
          settle({ ok: true, output: text })
          return
        }
        const reason =
          signal === null || signal === undefined
            ? `${label} 退出码 ${String(code)}`
            : `${label} 被信号 ${signal} 终止`
        settle({ ok: false, message: reason, output: text })
      })
    })
  }
}

/**
 * 清理命令输出：去掉 ANSI 颜色、光标控制与回车，保留末尾一段。
 *
 * @param text 任意输出值；非字符串按空串处理
 * @param maxBytes 保留的末尾字节数；默认 {@link MAX_OUTPUT_BYTES}
 * @returns 清理后的文本
 */
export function cleanOutput(text: unknown, maxBytes: number = MAX_OUTPUT_BYTES): string {
  const limit = normalizeMaxOutputBytes(maxBytes)
  return (
    (typeof text === 'string' ? text : '')
      // 去掉 CSI 转义（颜色、光标显隐、清行等），spinner 与提示符会大量使用。
      .replace(ANSI_ESCAPE, '')
      .replace(CARRIAGE_RETURN, '')
      .trim()
      .slice(-limit)
  )
}

/**
 * 解析 `npx skills add <source> --list` 的输出。
 *
 * CLI 只提供给人看的 Clack 文本（`--json` 不能与 `--list` 同用），非 TTY 下
 * 形如：
 *
 * ```text
 * │  Available Skills
 * │
 * │    web-design-guidelines
 * │
 * │      Review UI code for Web Interface Guidelines compliance.
 * ```
 *
 * 所以按缩进区分：`│` 列之后 4 空格是 skill 名，6 空格是描述（描述可能续行）。
 * 只解析 `Available Skills` 之后、`Use --skill` 之前的段落；解析不到时返回
 * 空数组，由调用方决定是「来源里没有 skill」还是「输出格式变了」。
 *
 * @param text 命令输出
 * @returns skill 名与描述；解析不到时是空数组
 */
export function parseSkillList(text: unknown): Array<{ name: string; description: string }> {
  const cleaned = cleanOutput(text, Number.MAX_SAFE_INTEGER)
  const lines = cleaned.split('\n')
  const start = lines.findIndex((line) => /Available Skills/u.test(line))
  if (start < 0) return []

  const byName = new Map<string, { name: string; description: string }>()
  let current: { name: string; description: string } | null = null
  for (const raw of lines.slice(start + 1)) {
    if (/Use --skill/u.test(raw)) break
    // 去掉 Clack 的左边框列（│ 或 |），保留缩进用于区分名称与描述。
    const line = raw.replace(/^[\u2502\u2503|]/u, '')
    if (line.trim() === '') continue
    if (current !== null && /^\s{6,}\S/u.test(line)) {
      const piece = line.trim()
      current.description = current.description === '' ? piece : `${current.description} ${piece}`
      continue
    }
    if (/^\s{2,5}\S/u.test(line)) {
      const name = line.trim()
      if (name === '') continue
      current = { name, description: '' }
      if (!byName.has(name)) byName.set(name, current)
    }
    // 其它状态行（Found N skills、提示等）忽略。
  }
  return [...byName.values()]
}

/**
 * 找到可执行的 npx；找不到时返回 null。
 *
 * @param env 子进程环境
 * @returns npx 入口；找不到时是 `null`
 */
export async function resolveNpxCommand(
  env: NodeJS.ProcessEnv = process.env,
): Promise<NpxCommand | null> {
  const dirs = await candidateDirs(env)
  const pathValue = dirs.join(path.delimiter)

  const npx = await findExecutable(NPX_EXECUTABLE, dirs)
  if (npx !== null) return { command: npx, prefixArgs: [], pathValue }

  const node = await findExecutable('node', dirs)
  if (node === null) return null

  // npm 的 npx 入口与 node 同属一个安装目录；GUI 启动时 npx shim 可能不在
  // PATH 上，但 node 在。
  const npxCli = path.resolve(
    path.dirname(node),
    '..',
    'lib',
    'node_modules',
    'npm',
    'bin',
    'npx-cli.js',
  )
  if (await exists(npxCli)) return { command: node, prefixArgs: [npxCli], pathValue }
  return null
}

/**
 * 失败信息里的命令名：默认 `npx skills`；传函数时按本次调用的参数生成。
 *
 * @param label 配置的命令名
 * @param args 本次调用的参数
 * @returns 命令名
 */
function labelOf(label: string | ((args: string[]) => string) | undefined, args: string[]): string {
  if (typeof label === 'function') return label(args)
  if (typeof label === 'string' && label !== '') return label
  return DEFAULT_NPX_LABEL
}

/**
 * 输出上限归一化：不合法时回落到 {@link MAX_OUTPUT_BYTES}。
 *
 * @param value 配置的上限
 * @returns 正整数上限
 */
function normalizeMaxOutputBytes(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : MAX_OUTPUT_BYTES
}

/**
 * 杀掉子进程；POSIX 上连同它的进程组，避免 npm exec 的子进程继续占着管道。
 *
 * @param child 要杀掉的子进程
 */
function killTree(child: ChildProcess): void {
  try {
    if (process.platform !== 'win32' && typeof child.pid === 'number') {
      process.kill(-child.pid, 'SIGKILL')
      return
    }
  } catch {
    // 进程组已经不存在，退回到单进程 kill
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // 进程已经退出
  }
}

/**
 * @param error 任意错误
 * @returns 可以展示的错误文本
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 收集可能放着 node/npx 的目录，按优先级去重。
 *
 * @param env 子进程环境
 * @returns 候选目录
 */
async function candidateDirs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const dirs: string[] = []
  const seen = new Set<string>()
  const add = (dir: unknown): void => {
    if (typeof dir !== 'string' || dir === '' || seen.has(dir)) return
    seen.add(dir)
    dirs.push(dir)
  }

  for (const dir of (env.PATH ?? '').split(path.delimiter)) add(dir)
  add(path.join(os.homedir(), '.local', 'share', 'mise', 'shims'))
  add(path.join(os.homedir(), '.volta', 'bin'))

  for (const base of [
    path.join(os.homedir(), '.local', 'share', 'mise', 'installs', 'node'),
    path.join(os.homedir(), '.nvm', 'versions', 'node'),
  ]) {
    try {
      for (const version of await fs.readdir(base)) add(path.join(base, version, 'bin'))
    } catch {
      // 这个版本管理器没有安装 Node
    }
  }

  if (process.platform === 'win32') {
    add(path.join(env.APPDATA ?? '', 'npm'))
    add(path.join(env.LOCALAPPDATA ?? '', 'Programs', 'nodejs'))
    add(path.join(env.ProgramFiles ?? '', 'nodejs'))
  } else {
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) add(dir)
  }
  return dirs
}

/**
 * 在候选目录里找一个可执行文件。
 *
 * @param name 可执行文件名（不带路径）
 * @param dirs 候选目录
 * @returns 可执行文件路径；找不到时是 `null`
 */
async function findExecutable(name: string, dirs: string[]): Promise<string | null> {
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    try {
      const stat = await fs.stat(candidate)
      if (!stat.isFile()) continue
      await fs.access(candidate, constants.X_OK)
      return candidate
    } catch {
      // 继续找下一个目录
    }
  }
  return null
}

/**
 * @param target 路径
 * @returns 路径存在时为 true
 */
async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
