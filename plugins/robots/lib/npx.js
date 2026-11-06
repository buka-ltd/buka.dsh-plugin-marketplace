/**
 * 定位并执行 `npx skills`（项目级）。
 *
 * 从 `plugins/skills` 的同名模块复制并简化：桌面版 DSH 从 Finder / Dock 启动
 * 时，进程的 PATH 可能与登录 shell 不同（没有 mise / nvm / Homebrew 的 shim），
 * 所以这里不直接 `spawn('npx')`，而是：
 *
 * 1. 先按 `PATH` 找 `npx`；
 * 2. 再按常见 Node 安装位置找（mise、nvm、Volta、Homebrew、系统目录）；
 * 3. 只有 `node` 时，用 node 直接跑 npm 自带的 `npx-cli.js`。
 *
 * 与全局版本的区别只有两点：`cwd` 由调用方按工作区传入（项目级安装落到
 * `<path>/.agents/skills`），超时按页面契约固定 180 s。找不到任何入口时
 * 返回可读的失败原因，绝不退化成「直接删目录」——那会留下 lockfile 记录。
 *
 * 子进程超时时先解析失败响应再杀进程组：npm exec 可能再 fork 一个子进程，
 * 只杀直接子进程会让继承的管道一直开着、请求永远不返回。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-robots/npx
 */

import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/** `npx skills add/remove` 的最长等待时间，避免网络问题把页面卡死。 */
export const NPX_TIMEOUT_MS = 180_000

/** 页面展示与失败信息里保留的命令输出上限。 */
export const MAX_OUTPUT_BYTES = 4000

/** Windows 上 npm 的启动器是 `npx.cmd`，其余平台是 `npx`。 */
const NPX_EXECUTABLE = process.platform === 'win32' ? 'npx.cmd' : 'npx'

/**
 * 生成调用 `npx skills` 的函数。
 *
 * 返回的函数接收子命令参数与工作目录，始终解析为
 * `{ ok, message?, output }`；不抛错，页面据此返回 200 或 502。
 *
 * `maxOutputBytes` 用于 `add --list` 这类需要整段解析输出的调用：默认只保留
 * 末尾 4000 字节够展示失败详情，但会把长列表的头部截掉，所以列清单时传更大的上限。
 *
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number, maxOutputBytes?: number }} [options] 测试可注入的环境、超时与输出上限
 * @returns {(args: string[], cwd: string) => Promise<{ ok: boolean, message?: string, output: string }>}
 */
export function createNpxRunner(options = {}) {
  const baseEnv = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? NPX_TIMEOUT_MS
  const maxOutputBytes =
    Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes > 0
      ? Math.floor(options.maxOutputBytes)
      : MAX_OUTPUT_BYTES

  return async function runNpx(args, cwd) {
    const commandArgs = Array.isArray(args) ? args : []
    const resolved = await resolveNpxCommand(baseEnv)
    if (resolved === null) {
      return {
        ok: false,
        message: '没有找到 npx。请先安装 Node.js（含 npm），再重试安装或移除 skill。',
        output: '',
      }
    }

    const label = commandLabel(commandArgs)

    return await new Promise((resolve) => {
      let child
      let timer
      let settled = false
      /** 只结算一次：超时后 close 事件仍可能到来。 */
      const settle = (value) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolve(value)
      }

      try {
        child = spawn(resolved.command, [...resolved.prefixArgs, '--yes', 'skills', ...commandArgs], {
          cwd,
          env: { ...baseEnv, PATH: resolved.pathValue },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          // POSIX 上放进独立进程组，超时可以整组杀掉（含 npm exec 的子进程）。
          detached: process.platform !== 'win32',
          shell: process.platform === 'win32',
        })
      } catch (error) {
        settle({ ok: false, message: errorText(error), output: '' })
        return
      }

      let output = ''
      const collect = (chunk) => {
        output = (output + chunk.toString()).slice(-maxOutputBytes)
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)

      timer = setTimeout(() => {
        const text = cleanOutput(output, maxOutputBytes)
        settle({
          ok: false,
          message: `npx skills ${label} 超时（${Math.round(timeoutMs / 1000)}s）`,
          output: text,
        })
        killTree(child)
      }, timeoutMs)

      child.once('error', (error) => {
        settle({ ok: false, message: errorText(error), output: cleanOutput(output, maxOutputBytes) })
      })
      child.once('close', (code, signal) => {
        const text = cleanOutput(output, maxOutputBytes)
        if (code === 0) {
          settle({ ok: true, output: text })
          return
        }
        const reason =
          signal === null || signal === undefined
            ? `npx skills ${label} 退出码 ${String(code)}`
            : `npx skills ${label} 被信号 ${signal} 终止`
        settle({ ok: false, message: reason, output: text })
      })
    })
  }
}

/**
 * 失败信息里的子命令名：`add` / `remove`。
 *
 * @param {string[]} args 传给 `npx skills` 的参数
 * @returns {string}
 */
function commandLabel(args) {
  return typeof args[0] === 'string' && args[0] !== '' ? args[0] : '命令'
}

/**
 * 杀掉子进程；POSIX 上连同它的进程组，避免 npm exec 的子进程继续占着管道。
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
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
 * 找到可执行的 npx；找不到时返回 null。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ command: string, prefixArgs: string[], pathValue: string } | null>}
 */
async function resolveNpxCommand(env = process.env) {
  const dirs = await candidateDirs(env)
  const pathValue = dirs.join(path.delimiter)

  const npx = await findExecutable(NPX_EXECUTABLE, dirs)
  if (npx !== null) return { command: npx, prefixArgs: [], pathValue }

  const node = await findExecutable('node', dirs)
  if (node === null) return null

  // npm 的 npx 入口与 node 同属一个安装目录；GUI 启动时 npx shim 可能不在
  // PATH 上，但 node 在。
  const npxCli = path.resolve(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')
  if (await exists(npxCli)) return { command: node, prefixArgs: [npxCli], pathValue }
  return null
}

/**
 * 清理命令输出：去掉 ANSI 颜色、光标控制与回车，保留末尾一段。
 *
 * @param {string} text
 * @param {number} [maxBytes] 保留的末尾字节数；默认 `MAX_OUTPUT_BYTES`
 * @returns {string}
 */
export function cleanOutput(text, maxBytes = MAX_OUTPUT_BYTES) {
  const limit =
    Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : MAX_OUTPUT_BYTES
  return (typeof text === 'string' ? text : '')
    // 去掉 CSI 转义（颜色、光标显隐、清行等），spinner 与提示符会大量使用。
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '')
    .replace(/\r/gu, '')
    .trim()
    .slice(-limit)
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
 * @param {unknown} text npx 输出（可带 ANSI）
 * @returns {Array<{ name: string, description: string }>}
 */
export function parseSkillList(text) {
  const cleaned = cleanOutput(text, Number.MAX_SAFE_INTEGER)
  const lines = cleaned.split('\n')
  const start = lines.findIndex((line) => /Available Skills/u.test(line))
  if (start < 0) return []

  /** @type {Map<string, { name: string, description: string }>} */
  const byName = new Map()
  let current = null
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
      continue
    }
    // 其它状态行（Found N skills、提示等）忽略。
  }
  return [...byName.values()]
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 收集可能放着 node/npx 的目录，按优先级去重。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string[]>}
 */
async function candidateDirs(env) {
  const dirs = []
  const seen = new Set()
  const add = (dir) => {
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
 * @param {string} name 可执行文件名（不带路径）
 * @param {string[]} dirs 候选目录
 * @returns {Promise<string | null>}
 */
async function findExecutable(name, dirs) {
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
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
