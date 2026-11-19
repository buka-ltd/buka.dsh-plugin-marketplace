/**
 * 执行者目录的 git 仓库初始化。
 *
 * 每个智能执行者的目录默认是一个独立 git 仓库：这是「分享」的基础——本地有
 * 仓库，用户才能给它接上 GitHub / GitLab 等远端，再推送或让别人克隆。初始化
 * 只在目录还不是仓库时发生：
 *
 * - 目录里已有 `.git`（普通仓库的目录，或 worktree / submodule 的 `.git` 文件）：
 *   原样保留，不重跑、不覆盖；
 * - 目录位于另一个仓库的工作树里（某个祖先目录有 `.git`）：**不建嵌套仓库**，
 *   让目录里的文件继续由外层仓库管理；
 * - 其余情况执行 `git init --quiet`；分支名交给用户自己的 `init.defaultBranch`；
 * - 没装 git、没有写权限等失败一律降级成结果对象，不打断执行者的创建与列表。
 *
 * 初始化**不提交**：没有配置 `user.name` / `user.email` 的机器也能完成，首个
 * 提交由用户自己决定。同一目录的并发调用在进程内合并成一次。
 *
 * @module @buka/dsh-plugin-workflows/workers/store/git
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 仓库元数据目录名；worktree / submodule 里它是指向真实 git 目录的文件。 */
const GIT_ENTRY = '.git'

/** `git init` 的超时；本地建目录通常几毫秒，慢盘留足余量就够了。 */
const INIT_TIMEOUT_MS = 10_000

/** git 输出的上限；init 正常没有输出，这里只是防御。 */
const MAX_BUFFER = 1024 * 1024

/**
 * 注入式 git runner 的契约。
 *
 * 与 Skills 插件读取来源时的约定一致：参数是 git 子命令，`cwd` 是工作目录；
 * 非零退出或 spawn 失败都 reject，错误上尽量带 `stderr`。
 */
export type GitRunner = (
  args: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>

/**
 * 一次初始化的结果。
 *
 * - `created`：本次新建了仓库；
 * - `exists`：目录里已经有 `.git`，什么都没做；
 * - `nested`：目录在外层仓库里，按约定不建嵌套仓库；
 * - `missing`：目录不存在（通常是登记表与磁盘不同步）；
 * - `unavailable`：PATH 里没有 git 可执行文件；
 * - `failed`：`git init` 执行失败，`error` 是可展示的原因。
 */
export type WorkerGitInitResult =
  | { ok: true; status: 'created' | 'exists' | 'nested'; path: string }
  | { ok: false; status: 'missing' | 'unavailable' | 'failed'; path: string; error: string }

/** 同一目录正在进行的初始化；并发调用共享同一个结果。 */
const pendingInits = new Map<string, Promise<WorkerGitInitResult>>()

/**
 * 确保一个执行者目录已经是一个 git 仓库。
 *
 * 幂等、永不 reject：已在仓库里、目录不存在、没装 git、`git init` 失败都返回
 * 结果对象，由调用方决定是否提示；没装 git 时下次加载会重新尝试。目录不存在
 * 或路径为空时不做任何写操作。
 *
 * @param directory 执行者目录的绝对路径
 * @param options.runGit 注入的 git runner（单测用）
 */
export function ensureWorkerGitRepo(
  directory: unknown,
  { runGit = runGitDefault }: { runGit?: GitRunner } = {},
): Promise<WorkerGitInitResult> {
  const resolved = typeof directory === 'string' ? directory.trim() : ''
  if (resolved === '') {
    return Promise.resolve({
      ok: false,
      status: 'missing',
      path: '',
      error: '缺少执行者目录',
    })
  }
  const target = path.resolve(resolved)
  const running = pendingInits.get(target)
  if (running !== undefined) return running

  const task = initRepository(target, runGit).finally(() => {
    pendingInits.delete(target)
  })
  pendingInits.set(target, task)
  return task
}

/**
 * `ensureWorkerGitRepo` 的实际工作，永不 reject。
 *
 */
async function initRepository(directory: string, runGit: GitRunner): Promise<WorkerGitInitResult> {
  if (!(await isDirectory(directory))) {
    return {
      ok: false,
      status: 'missing',
      path: directory,
      error: `执行者目录不存在：${directory}`,
    }
  }

  if (await hasGitEntry(directory)) {
    return { ok: true, status: 'exists', path: directory }
  }
  if (await hasGitAncestor(directory)) {
    return { ok: true, status: 'nested', path: directory }
  }

  try {
    await runGit(['init', '--quiet'], { cwd: directory })
    return { ok: true, status: 'created', path: directory }
  } catch (error) {
    if (isMissingGit(error)) {
      return {
        ok: false,
        status: 'unavailable',
        path: directory,
        error: '未找到 git 可执行文件；安装 git 或把它加入 PATH 后，下次加载会再试。',
      }
    }
    return { ok: false, status: 'failed', path: directory, error: gitFailureText(error) }
  }
}

/**
 * 目录里是否有 `.git`；`lstat` 让 worktree / submodule 的 `.git` 文件也算数。
 *
 */
async function hasGitEntry(directory: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(directory, GIT_ENTRY))
    return true
  } catch {
    return false
  }
}

/**
 * 某个祖先目录是否是仓库的根（工作树里已有 `.git`）。
 *
 * 从父目录开始逐级向上，遇到文件系统根为止；只看 `.git` 是否存在，不调用 git，
 * 所以列表加载时不会有额外进程。
 */
async function hasGitAncestor(directory: string): Promise<boolean> {
  let current = path.dirname(directory)
  for (;;) {
    if (await hasGitEntry(current)) return true
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

/** 路径存在且是目录。 */
async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * spawn 失败时 `execFile` 的 `error.code` 是字符串（`ENOENT` 表示 PATH 里没有
 * git）；非零退出的 `code` 是数字退出码。
 *
 */
function isMissingGit(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * 把 git 失败转成可展示的一行原因：优先用 stderr 的最后几行。
 *
 */
function gitFailureText(error: unknown): string {
  const tail = lastLines(trimmedString((error as { stderr?: unknown } | null)?.stderr), 3)
  if (tail !== '') return `git init 失败：${tail}`
  const message = trimmedString((error as { message?: unknown } | null)?.message)
  if (message !== '') return `git init 失败：${message}`
  return `git init 失败：${String(error)}`
}

/** 非字符串按空串处理并去掉首尾空白。 */
function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 取文本最后几行并限制长度，避免把整份 git 输出塞进错误消息。
 *
 */
function lastLines(text: string, count: number): string {
  if (text === '') return ''
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '')
  return lines.slice(-count).join('\n').slice(0, 500)
}

/**
 * 默认 git runner：`execFile` + 超时 + 受限输出 + 禁用交互式认证。
 *
 * 初始化前清掉 `GIT_DIR` / `GIT_WORK_TREE`：宿主如果从 git 钩子等环境里启动，
 * 这两个变量会把 `git init` 指向别处，执行者目录反而建不出仓库。
 */
function runGitDefault(
  args: string[],
  { cwd }: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        ...(cwd === undefined ? {} : { cwd }),
        timeout: INIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          // 把 stderr 挂到错误上，`gitFailureText()` 只靠 error.stderr 取值，
          // 注入的 runner 也按同一契约抛错。
          error.stderr = String(stderr ?? '')
          reject(error)
          return
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })
}
