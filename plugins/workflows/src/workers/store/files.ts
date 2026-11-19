/**
 * 执行者目录的只读文件浏览：目录树与单文件内容。
 *
 * 浏览器一半的「文件」页签只读：目录树列出执行者目录下的文件与子目录，点一个
 * 文件在右侧展示内容。页面没有编辑 / 保存入口，写入仍由 builder 工具完成。
 *
 * 安全边界：所有路径都相对执行者目录，`path` 参数先规范化再经 realpath 校验，
 * 符号链接不能把读取带到目录外；`AGENTS.md` / `CLAUDE.md` 这类目录内链接照常
 * 展示。
 *
 * @module @buka/dsh-plugin-workflows/workers/store/files
 */

import { isUtf8 } from 'node:buffer'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 目录树的最大深度（根目录算第 0 层）。 */
const MAX_TREE_DEPTH = 8

/** 目录树最多返回的条目数（目录 + 文件），超出时 `truncated` 为 true。 */
const MAX_TREE_ENTRIES = 600

/** 页面直接预览一个文件的上限（256 KiB）；超过只给大小提示。 */
export const FILE_MAX_READ_BYTES = 256 * 1024

/** 判定二进制时探测的开头字节数。 */
const BINARY_PROBE_BYTES = 8 * 1024

/** 不进入的目录：既不是执行者内容，也可能非常大。 */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])

/** 目录树里的一个节点；目录带 `children`。 */
export interface WorkerFileNode {
  /** 文件 / 目录名（不带路径）。 */
  name: string
  /** 相对执行者目录的路径，统一用 `/`。 */
  path: string
  kind: 'directory' | 'file'
  /** 文件字节数；读不到大小时省略。 */
  bytes?: number
  /** 子节点；目录才有。 */
  children?: WorkerFileNode[]
}

/** 目录树快照。 */
export interface WorkerFileTree {
  nodes: WorkerFileNode[]
  /** 条目数 / 深度超限时为 true。 */
  truncated: boolean
}

/** 一个文件的只读预览。 */
export interface WorkerFileContent {
  path: string
  bytes: number
  /** UTF-8 文本；过大或二进制时为空串。 */
  content: string
  tooLarge: boolean
  binary: boolean
}

/** 读取失败的稳定错误码。 */
export type WorkerFileErrorCode = 'invalid-path' | 'outside-root' | 'file-not-found' | 'not-a-file'

/** 读取失败的形状。 */
export interface WorkerFileError {
  code: WorkerFileErrorCode
  message: string
}

/** 读取结果：内容或稳定错误。 */
export type WorkerFileRead =
  | { ok: true; file: WorkerFileContent }
  | { ok: false; error: WorkerFileError }

/** 目录树的遍历预算：条目上限与是否已截断。 */
interface TreeBudget {
  remaining: number
  truncated: boolean
}

/** 把相对目录与名字拼成 `/` 分隔的相对路径。 */
function joinRelative(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

/** 排序：目录在前、文件在后，同类按名称。 */
function compareNodes(left: WorkerFileNode, right: WorkerFileNode): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name)
}

/**
 * 列出执行者目录的树。读不到的目录直接跳过，不让一个坏条目拖垮整棵树。
 *
 * @param root 执行者目录的绝对路径
 * @returns 目录树与截断标记
 */
export async function listWorkerFiles(root: string): Promise<WorkerFileTree> {
  let rootReal: string
  try {
    rootReal = await fs.realpath(root)
  } catch {
    return { nodes: [], truncated: false }
  }
  const budget: TreeBudget = { remaining: MAX_TREE_ENTRIES, truncated: false }
  return { nodes: await walk(rootReal, '', 0, budget), truncated: budget.truncated }
}

/**
 * 递归读取一层目录。
 *
 * @param rootReal 执行者目录的 realpath
 * @param relativeDirectory 当前目录的相对路径（根为 `''`）
 * @param depth 当前深度
 * @param budget 共享的遍历预算
 * @returns 排好序的节点
 */
async function walk(
  rootReal: string,
  relativeDirectory: string,
  depth: number,
  budget: TreeBudget,
): Promise<WorkerFileNode[]> {
  if (depth > MAX_TREE_DEPTH) {
    budget.truncated = true
    return []
  }
  const directory =
    relativeDirectory === '' ? rootReal : path.join(rootReal, ...relativeDirectory.split('/'))
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: WorkerFileNode[] = []
  for (const entry of entries) {
    if (budget.remaining <= 0) {
      budget.truncated = true
      break
    }
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      budget.remaining -= 1
      const relativePath = joinRelative(relativeDirectory, entry.name)
      nodes.push({
        name: entry.name,
        path: relativePath,
        kind: 'directory',
        children: await walk(rootReal, relativePath, depth + 1, budget),
      })
      continue
    }
    if (entry.isSymbolicLink()) {
      // 执行者目录里的 CLAUDE.md 是指向 AGENTS.md 的链接：照常列出，但只接受
      // 落在目录内的文件目标，避免借链接读到目录外。
      const target = await insideRoot(rootReal, path.join(directory, entry.name))
      if (target === null) continue
      try {
        const stat = await fs.stat(target)
        if (!stat.isFile()) continue
        budget.remaining -= 1
        nodes.push({
          name: entry.name,
          path: joinRelative(relativeDirectory, entry.name),
          kind: 'file',
          bytes: stat.size,
        })
      } catch {
        // 悬空链接：不展示。
      }
      continue
    }
    if (!entry.isFile()) continue
    let bytes: number | undefined
    try {
      bytes = (await fs.stat(path.join(directory, entry.name))).size
    } catch {
      bytes = undefined
    }
    budget.remaining -= 1
    nodes.push({
      name: entry.name,
      path: joinRelative(relativeDirectory, entry.name),
      kind: 'file',
      ...(bytes === undefined ? {} : { bytes }),
    })
  }
  return nodes.sort(compareNodes)
}

/**
 * 解析并校验一个相对路径：拒绝绝对路径、`..` 与空串。
 *
 * @param value 页面传入的相对路径
 * @returns 规范化后的相对路径；不合法时返回 null
 */
function normalizeRelative(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\\/gu, '/')
  if (text === '' || text.includes('\0')) return null
  if (text.startsWith('/')) return null
  const normalized = path.posix.normalize(text)
  if (normalized === '.' || normalized === '' || normalized.startsWith('../')) return null
  return normalized
}

/**
 * 目标 realpath 必须仍在执行者目录内；越界或读不到返回 null。
 *
 * @param rootReal 执行者目录的 realpath
 * @param absolute 目标绝对路径
 * @returns realpath 或 null
 */
async function insideRoot(rootReal: string, absolute: string): Promise<string | null> {
  let target: string
  try {
    target = await fs.realpath(absolute)
  } catch {
    return null
  }
  const relative = path.relative(rootReal, target)
  if (relative === '') return target
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return target
}

/** 文件开头疑似二进制：含 NUL 或不是合法 UTF-8。 */
function looksBinary(buffer: Buffer): boolean {
  if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) return true
  return !isUtf8(buffer)
}

/**
 * 读取一个文件的只读内容。
 *
 * @param root 执行者目录的绝对路径
 * @param relative 页面给的相对路径
 * @returns 内容或稳定错误
 */
export async function readWorkerFile(root: string, relative: unknown): Promise<WorkerFileRead> {
  const normalized = normalizeRelative(relative)
  if (normalized === null) {
    return {
      ok: false,
      error: { code: 'invalid-path', message: `文件路径不合法：${String(relative)}` },
    }
  }

  let rootReal: string
  try {
    rootReal = await fs.realpath(root)
  } catch {
    return {
      ok: false,
      error: { code: 'file-not-found', message: `执行者目录不存在：${root}` },
    }
  }

  const absolute = path.resolve(rootReal, ...normalized.split('/'))
  const relativeCheck = path.relative(rootReal, absolute)
  if (relativeCheck === '' || relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    return {
      ok: false,
      error: { code: 'outside-root', message: `文件不在执行者目录内：${normalized}` },
    }
  }

  const target = await insideRoot(rootReal, absolute)
  if (target === null) {
    // 区分「不存在」与「真实存在但越界」：前者给 404，后者给路径错误；对调用方
    // 都只暴露相对路径，不泄露目录外的内容。
    let exists = false
    try {
      await fs.lstat(absolute)
      exists = true
    } catch {
      exists = false
    }
    return exists
      ? {
          ok: false,
          error: { code: 'outside-root', message: `文件不在执行者目录内：${normalized}` },
        }
      : { ok: false, error: { code: 'file-not-found', message: `文件不存在：${normalized}` } }
  }

  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(target)
  } catch {
    return { ok: false, error: { code: 'file-not-found', message: `文件不存在：${normalized}` } }
  }
  if (!stat.isFile()) {
    return { ok: false, error: { code: 'not-a-file', message: `不是文件：${normalized}` } }
  }
  if (stat.size > FILE_MAX_READ_BYTES) {
    return {
      ok: true,
      file: { path: normalized, bytes: stat.size, content: '', tooLarge: true, binary: false },
    }
  }

  let buffer: Buffer
  try {
    buffer = await fs.readFile(target)
  } catch {
    return { ok: false, error: { code: 'file-not-found', message: `文件不存在：${normalized}` } }
  }
  if (buffer.byteLength > FILE_MAX_READ_BYTES) {
    return {
      ok: true,
      file: {
        path: normalized,
        bytes: buffer.byteLength,
        content: '',
        tooLarge: true,
        binary: false,
      },
    }
  }
  if (looksBinary(buffer)) {
    return {
      ok: true,
      file: {
        path: normalized,
        bytes: buffer.byteLength,
        content: '',
        tooLarge: false,
        binary: true,
      },
    }
  }
  return {
    ok: true,
    file: {
      path: normalized,
      bytes: buffer.byteLength,
      content: buffer.toString('utf8'),
      tooLarge: false,
      binary: false,
    },
  }
}
