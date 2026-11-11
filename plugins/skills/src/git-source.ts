/**
 * 任意 git 远端来源：把收藏的 git 地址浅克隆到 DSH 缓存目录，再当本地目录扫描。
 *
 * GitHub 之外的仓库（GitLab、自建 Gitea、`ssh://` / `git@host:path` 等）没有统一
 * 的公开 API 可列树，本机装了 git 时最直接的办法就是 `git clone --depth 1`：
 * 只拉一个提交，代价可控，之后 `repo-skills.js` 用 `local-source.js` 扫目录即可。
 *
 * 克隆放在 `<DSH_HOME>/buka-skills/cache/git/<sha256(url) 前 32 位>`：
 * - 用 URL 的哈希做目录名，避免不同地址拼出同一个路径，也避免把密码、分支等
 *   写进目录名；
 * - 目录名就是进程内并发锁的键：同一地址的并发展开共用一次克隆，不用 `Map`
 *   再存一份 URL 到目录的映射。
 *
 * 刷新（`update: true`）先 `git fetch --depth 1 origin` 再 `reset --hard
 * FETCH_HEAD`；失败时**保留旧克隆继续用**——离线或远端临时不可达时，用户
 * 仍能看到上次缓存的仓库树，而不是一个错误。首次克隆失败（含找不到 git）
 * 才返回错误；浏览器端据此提示安装 git 或检查地址。
 *
 * 克隆目录不会被自动清理：删除收藏不会删缓存，用户需要时自己删
 * `buka-skills/cache/git/`。这是有意的取舍——重新克隆一个远端仓库比留几百 MB
 * 缓存更贵。
 *
 * `runGit` 可注入：单测用假 runner 复制 fixture 目录，不联网、也不依赖本机
 * git；默认 runner 用 `execFile`，带超时、`maxBuffer` 与
 * `GIT_TERMINAL_PROMPT=0`（避免卡在交互式认证）。
 *
 * @module @buka/dsh-plugin-skills/git-source
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 首次克隆的超时；大仓库要拉完整棵浅树，给得比 fetch 宽。 */
const CLONE_TIMEOUT_MS = 60_000

/** fetch / reset / rev-parse 的超时：只走增量，不该很久。 */
const FETCH_TIMEOUT_MS = 15_000

/** git 输出的上限；超过时 execFile 会报错而不是把内存吃光。 */
const MAX_BUFFER = 10 * 1024 * 1024

/** 目录名取 sha256 的前 32 个十六进制字符（128 位），足够避免碰撞。 */
const CLONE_DIR_HASH_LENGTH = 32

/** 注入式 git runner 的契约。 */
export type GitRunner = (
  args: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>

/** 只用到 `dshHome` 的 home 集合；`resolveHomes()` 的结果也是这个形状的超集。 */
export interface CloneHomes {
  readonly dshHome: string
}

/** 克隆成功：目录与 HEAD sha。 */
export interface GitCloneOk {
  readonly ok: true
  readonly dir: string
  readonly sha: string
}

/** 克隆失败：本机没有 git，或 git 命令失败。 */
export interface GitCloneFailure {
  readonly ok: false
  readonly code: 'git-unavailable' | 'git-failed'
  readonly message: string
}

/** `ensureGitClone()` 的结果。 */
export type GitCloneResult = GitCloneOk | GitCloneFailure

/**
 * 一个 git 地址对应的克隆目录。
 *
 * @param homes `resolveHomes()` 的结果
 * @param url 已规范化的 git 地址
 */
export function gitCloneDir(homes: CloneHomes, url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, CLONE_DIR_HASH_LENGTH)
  return path.join(homes.dshHome, 'buka-skills', 'cache', 'git', hash)
}

/**
 * 确保一个 git 地址已经浅克隆到缓存目录，并返回它的目录与 HEAD sha。
 *
 * 目录已存在且 `update === false` 时直接复用；`update === true` 时尝试 fetch +
 * reset，失败保留旧克隆。目录不存在时克隆到同目录下的临时目录，成功后再
 * rename，避免并发读到半个克隆。同一目录的并发调用在进程内合并成一次。
 *
 * @param options.url 已规范化的 git 地址
 */
export function ensureGitClone({
  homes,
  url,
  runGit = runGitDefault,
  update = false,
}: {
  homes: CloneHomes
  url: string
  runGit?: GitRunner | undefined
  update?: boolean
}): GitCloneResult | Promise<GitCloneResult> {
  const dir = gitCloneDir(homes, url)
  const running = pendingClones.get(dir)
  if (running !== undefined) return running

  const task = prepareClone({ dir, url, runGit, update }).finally(() => {
    pendingClones.delete(dir)
  })
  pendingClones.set(dir, task)
  return task
}

/**
 * 同一克隆目录的进程内锁：键是目录，值是正在进行的 prepareClone。
 */
const pendingClones = new Map<string, Promise<GitCloneResult>>()

/**
 * `ensureGitClone()` 的实际工作，永不 reject（失败也变成 `{ ok: false }`）。
 */
async function prepareClone({
  dir,
  url,
  runGit,
  update,
}: {
  dir: string
  url: string
  runGit: GitRunner
  update: boolean
}): Promise<GitCloneResult> {
  try {
    if (await isDirectory(dir)) {
      if (update === true) await updateClone(dir, runGit)
      return { ok: true, dir, sha: await headSha(dir, runGit) }
    }

    const parent = path.dirname(dir)
    await fs.mkdir(parent, { recursive: true, mode: 0o700 })
    const temp = path.join(
      parent,
      `.${path.basename(dir)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    )
    try {
      // `--` 之后才是 URL 与目标目录：地址不能被 git 当成选项解析。
      await runGit(['clone', '--depth', '1', '--single-branch', '--no-tags', '--', url, temp], {})
    } catch (error) {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
      return gitFailure(error)
    }

    try {
      await fs.rename(temp, dir)
    } catch (error) {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
      // 另一个进程可能刚建好同名目录：已经有目录就复用它，别把成功当失败。
      if (await isDirectory(dir)) return { ok: true, dir, sha: await headSha(dir, runGit) }
      return gitFailure(error)
    }
    return { ok: true, dir, sha: await headSha(dir, runGit) }
  } catch (error) {
    return gitFailure(error)
  }
}

/**
 * 尝试更新已有克隆；失败时静默保留旧克隆（离线可用）。
 */
async function updateClone(dir: string, runGit: GitRunner): Promise<void> {
  try {
    await runGit(['-C', dir, 'fetch', '--depth', '1', 'origin'], { cwd: dir })
    await runGit(['-C', dir, 'reset', '--hard', 'FETCH_HEAD'], { cwd: dir })
  } catch {
    // 远端不可达时就继续用旧克隆：缓存的意义是让离线也能展开。
  }
}

/**
 * 取 HEAD 的 sha；失败留空串（请求方只把它当展示信息）。
 */
async function headSha(dir: string, runGit: GitRunner): Promise<string> {
  try {
    const result = await runGit(['-C', dir, 'rev-parse', 'HEAD'], { cwd: dir })
    if (typeof result?.stdout !== 'string') return ''
    return result.stdout.trim().split(/\s+/u)[0] ?? ''
  } catch {
    return ''
  }
}

/**
 * 目录是否存在且确实是目录；不存在、权限不足都算「没有」。
 */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 把 git 失败转成对外错误码。
 *
 * `execFile` 的 `error.code` 在 spawn 失败时是字符串（`ENOENT` 表示 PATH 里没有
 * git），在非零退出时是数字退出码；后者统一算 `git-failed`，message 带上 stderr
 * 尾部，方便用户看出是认证、地址还是网络问题。
 */
function gitFailure(error: unknown): GitCloneFailure {
  if (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'ENOENT'
  ) {
    return failure('git-unavailable', 'Git executable not found; install git or add it to PATH.')
  }
  const stderr =
    typeof (error as { stderr?: unknown } | null)?.stderr === 'string'
      ? (error as { stderr: string }).stderr
      : ''
  const tail = lastLines(stderr.trim(), 3)
  return failure(
    'git-failed',
    tail === '' ? `git failed: ${errorText(error)}` : `git failed: ${tail}`,
  )
}

/**
 * 取文本最后几行，并限制长度，避免把整份 git 输出塞进错误消息。
 */
function lastLines(text: string, count: number): string {
  if (text === '') return ''
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '')
  return lines.slice(-count).join('\n').slice(0, 500)
}

/**
 * 默认 git runner：`execFile` + 超时 + 受限输出 + 禁用交互式认证。
 */
function runGitDefault(
  args: string[],
  { cwd }: { cwd?: string } = {},
): Promise<{
  stdout: string
  stderr: string
}> {
  const timeout = args.includes('clone') ? CLONE_TIMEOUT_MS : FETCH_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        ...(cwd === undefined ? {} : { cwd }),
        timeout,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          // 把 stderr 挂到错误上，`gitFailure()` 只靠 error.code 与 error.stderr
          // 判断，注入的 runner 也按同一契约抛错。
          error.stderr = String(stderr ?? '')
          reject(error)
          return
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })
}

function failure(code: GitCloneFailure['code'], message: string): GitCloneFailure {
  return { ok: false, code, message }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
