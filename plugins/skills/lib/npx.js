/**
 * 定位并执行 `npx skills`。
 *
 * 桌面版 DSH 从 Finder / Dock 启动时，进程的 PATH 可能与登录 shell 不同（没有
 * mise / nvm / Homebrew 的 shim），所以这里不直接 `spawn('npx')`，而是：
 *
 * 1. 先按 `PATH` 找 `npx`；
 * 2. 再按常见 Node 安装位置找（mise、nvm、Volta、Homebrew、系统目录）；
 * 3. 只有 `node` 时，用 node 直接跑 npm 自带的 `npx-cli.js`。
 *
 * 找不到任何入口就返回可读的失败原因，绝不让「npx 管理」的 skill 退化成
 * 直接删目录 —— 那会留下 lockfile 记录与其它 agent 目录里的链接。
 *
 * 子进程超时时先解析失败响应再杀进程组：npm exec 可能再 fork 一个子进程，
 * 只杀直接子进程会让继承的管道一直开着、请求永远不返回。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/npx
 */

import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/** `npx skills remove` 的最长等待时间，避免网络问题把页面卡死。 */
export const NPX_TIMEOUT_MS = 120_000

/** 页面展示与失败信息里保留的命令输出上限。 */
export const MAX_OUTPUT_BYTES = 4000

/** Windows 上 npm 的启动器是 `npx.cmd`，其余平台是 `npx`。 */
const NPX_EXECUTABLE = process.platform === 'win32' ? 'npx.cmd' : 'npx'

/**
 * 生成调用 `npx skills` 的函数。参数与 `uninstallGlobalSkill` 的 `runNpx` 一致：
 * 传入子命令参数，返回 `{ ok, message?, output? }`。
 *
 * @param {{ agentsHome: string }} homes 全局 agent 目录；作为子进程 cwd
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options] 测试可注入的环境与超时
 * @returns {(args: string[]) => Promise<{ ok: boolean, message?: string, output?: string }>}
 */
export function createNpxRunner(homes, options = {}) {
  const baseEnv = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? NPX_TIMEOUT_MS

  return async function runNpx(args) {
    const resolved = await resolveNpxCommand(baseEnv)
    if (resolved === null) {
      return {
        ok: false,
        message: `没有找到 npx。请先安装 Node.js（含 npm），或手动删除 ${path.join(homes.agentsHome, 'skills')} 下的目录。`,
      }
    }

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
        child = spawn(resolved.command, [...resolved.prefixArgs, '--yes', 'skills', ...args], {
          cwd: homes.agentsHome,
          env: { ...baseEnv, PATH: resolved.pathValue },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          // POSIX 上放进独立进程组，超时可以整组杀掉（含 npm exec 的子进程）。
          detached: process.platform !== 'win32',
          shell: process.platform === 'win32',
        })
      } catch (error) {
        settle({ ok: false, message: errorText(error) })
        return
      }

      let output = ''
      const collect = (chunk) => {
        output = (output + chunk.toString()).slice(-MAX_OUTPUT_BYTES)
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)

      timer = setTimeout(() => {
        const text = cleanOutput(output)
        settle({
          ok: false,
          message: `npx skills remove 超时（${Math.round(timeoutMs / 1000)}s）`,
          output: text,
        })
        killTree(child)
      }, timeoutMs)

      child.once('error', (error) => {
        settle({ ok: false, message: errorText(error), output: cleanOutput(output) })
      })
      child.once('close', (code, signal) => {
        const text = cleanOutput(output)
        if (code === 0) {
          settle({ ok: true, output: text })
          return
        }
        const reason =
          signal === null || signal === undefined
            ? `npx skills remove 退出码 ${String(code)}`
            : `npx skills remove 被信号 ${signal} 终止`
        settle({ ok: false, message: reason, output: text })
      })
    })
  }
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
export async function resolveNpxCommand(env = process.env) {
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
 * @returns {string}
 */
export function cleanOutput(text) {
  return text
    // 去掉 CSI 转义（颜色、光标显隐、清行等），spinner 与提示符会大量使用。
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '')
    .replace(/\r/gu, '')
    .trim()
    .slice(-MAX_OUTPUT_BYTES)
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
