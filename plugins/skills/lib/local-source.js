/**
 * 本地目录来源：把一个收藏的本地绝对路径当成仓库树扫描。
 *
 * 收藏项除了 GitHub 仓库，也可能是用户本机上的一个目录（比如刚 clone 下来还没
 * 推远端的仓库）。它没有 GitHub API 可查，所以这里直接把目录当成 `git ls-tree`
 * 的结果：递归收集所有文件，`path` 用 `/` 分隔的相对路径，读文件则限制在 root
 * 之内。这样 `repo-skills.js` 的发现规则、分类与建树不用为本地来源写第二套。
 *
 * 遍历有上限（目录深度、文件条数、单文件大小），超出就标记 `truncated`：本地
 * 目录可能是整个 home 目录或带几十万个文件的大仓库，全量展开会把 Host 卡死，
 * 而用户看到的只是一棵列不全的树。跳过 `node_modules` 等目录与 `repo-skills.js`
 * 的 `SKIP_DIRS` 一致，这里另写一份常量是为了避免两个模块互相 import。
 *
 * 目录符号链接只作为 blob 收进树、不跟随：跟随可能形成环，也可能把人带到 root
 * 之外。root 不存在或不是目录返回 `repo-not-found`，其它文件系统错误返回
 * `fetch-failed`。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/local-source
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 遍历的文件条数上限：超过就不再收集，返回 `truncated: true`。 */
export const LOCAL_TREE_MAX_ENTRIES = 20000

/** 目录递归深度上限：更深的目录不再展开。 */
export const LOCAL_TREE_MAX_DEPTH = 32

/** 单个文件的可读上限；超过就当作读不到（SKILL.md 不该有 1MB）。 */
export const LOCAL_FILE_MAX_BYTES = 1024 * 1024

/** 与 repo-skills 的 SKIP_DIRS 保持一致；本地模块内另写一份避免循环 import。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])

/**
 * 打开一个本地目录来源。
 *
 * @param {string} root 已规范化的本地绝对路径
 * @returns {Promise<
 *   | { ok: true, ref: 'worktree', sha: '', truncated: boolean,
 *       tree: Array<{ type: 'blob', path: string }>,
 *       readFile: (repoPath: string) => Promise<string | null> }
 *   | { ok: false, code: 'repo-not-found' | 'fetch-failed', message: string }
 * >}
 */
export async function openLocalRepo(root) {
  let stats
  try {
    stats = await fs.stat(root)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return failure('repo-not-found', `Local path does not exist: ${root}`)
    }
    return failure('fetch-failed', `Could not read local path ${root}: ${errorText(error)}`)
  }
  if (!stats.isDirectory()) {
    return failure('repo-not-found', `Local path is not a directory: ${root}`)
  }

  try {
    const scanned = await scanLocalTree(root)
    // 读文件按真实路径复核（root 自己可能就是符号链接），见 createFileReader()。
    const realRoot = await fs.realpath(root).catch(() => root)
    return {
      ok: true,
      // 本地目录没有提交概念：ref 用固定值，sha 留空，缓存仍按来源区分。
      ref: 'worktree',
      sha: '',
      truncated: scanned.truncated,
      tree: scanned.tree,
      readFile: createFileReader(realRoot),
    }
  } catch (error) {
    return failure('fetch-failed', `Could not scan local path ${root}: ${errorText(error)}`)
  }
}

/**
 * 递归扫描目录，把文件收成 GitHub 树同形状的 `{ type: 'blob', path }` 数组。
 *
 * 用显式栈而不是递归，避免很深的目录把调用栈打爆。深度超限只是不再深入该
 * 目录（继续扫其它分支）；条数超限才整轮停止，因为再扫也不会有结果被收下。
 *
 * @param {string} root
 * @returns {Promise<{ tree: Array<{ type: 'blob', path: string }>, truncated: boolean }>}
 */
async function scanLocalTree(root) {
  const tree = []
  const queue = [{ abs: root, rel: '', depth: 0 }]
  let truncated = false
  let hitEntryCap = false

  while (queue.length > 0 && !hitEntryCap) {
    const current = queue.pop()
    let entries
    try {
      entries = await readDirectory(current.abs)
    } catch (error) {
      // 子目录在扫描期间被删除或没有权限：跳过它，别让整棵树失败。
      if (current.rel === '') throw error
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (current.depth + 1 > LOCAL_TREE_MAX_DEPTH) {
          truncated = true
          continue
        }
        queue.push({
          abs: path.join(current.abs, entry.name),
          rel: joinRelative(current.rel, entry.name),
          depth: current.depth + 1,
        })
        continue
      }
      // 只收普通文件与符号链接；符号链接不跟随（见模块注释）。
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      if (tree.length >= LOCAL_TREE_MAX_ENTRIES) {
        truncated = true
        hitEntryCap = true
        break
      }
      tree.push({ type: 'blob', path: joinRelative(current.rel, entry.name) })
    }
  }

  // opendir 的顺序取决于文件系统，排序让同一目录每次扫描得到相同的树。
  tree.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { tree, truncated }
}

/**
 * 读完一个目录的全部条目后关闭句柄；`opendir` 的迭代在异常时也要释放。
 *
 * @param {string} abs
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function readDirectory(abs) {
  const dir = await fs.opendir(abs)
  const entries = []
  try {
    for await (const entry of dir) entries.push(entry)
  } finally {
    await dir.close().catch(() => {})
  }
  return entries
}

/**
 * 造一个只在 root 内读文件的 `readFile(repoPath)`。
 *
 * 返回 null 表示「读不到」而不是抛错：文件不存在、不是普通文件、超过大小上限
 * 或读取失败都一样，调用方只需把它当成一个没有元数据的 SKILL.md。
 *
 * 路径先做字面检查，再按 `realpath` 复核一次：仓库（尤其是刚 clone 下来的
 * 不可信仓库）里可能有指向 root 之外的符号链接，不能把本机任意文件当成仓库
 * 内容读出来。
 *
 * @param {string} root 真实路径（已展开符号链接）
 * @returns {(repoPath: string) => Promise<string | null>}
 */
function createFileReader(root) {
  return async function readFile(repoPath) {
    const resolved = resolveInside(root, repoPath)
    if (resolved === null) return null
    try {
      const real = await fs.realpath(resolved)
      const relative = path.relative(root, real)
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
      const stats = await fs.stat(real)
      if (!stats.isFile() || stats.size > LOCAL_FILE_MAX_BYTES) return null
      return await fs.readFile(real, 'utf8')
    } catch {
      return null
    }
  }
}

/**
 * 把仓库内相对路径解析成 root 内的绝对路径；任何可能逃出 root 的写法返回 null。
 *
 * 拒绝反斜杠（路径分隔符不一致会绕过检查）、绝对路径、`.` / `..` / 空段。
 * 解析后再用 `path.relative` 复核一次，双保险。
 *
 * @param {string} root
 * @param {unknown} repoPath
 * @returns {string | null}
 */
function resolveInside(root, repoPath) {
  if (typeof repoPath !== 'string' || repoPath === '') return null
  if (repoPath.includes('\\') || repoPath.includes('\u0000')) return null
  if (path.isAbsolute(repoPath)) return null
  const segments = repoPath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  const resolved = path.resolve(root, ...segments)
  const relative = path.relative(root, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolved
}

/**
 * 拼相对路径；root 下直接用文件名，否则用 `/` 连接。
 *
 * @param {string} dir 当前相对目录（root 为空串）
 * @param {string} name
 * @returns {string}
 */
function joinRelative(dir, name) {
  return dir === '' ? name : `${dir}/${name}`
}

/**
 * @param {'repo-not-found' | 'fetch-failed'} code
 * @param {string} message
 * @returns {{ ok: false, code: string, message: string }}
 */
function failure(code, message) {
  return { ok: false, code, message }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
