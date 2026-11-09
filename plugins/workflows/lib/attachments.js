/**
 * 工作流节点附件：输入规范化、从机器人工作区复制到节点目录、文本读取。
 *
 * 节点在结构化结果里声明 `attachments`，这里负责把声明变成落盘清单。本模块
 * 不 import 任何 DSH 包，也不决定运行目录布局；目录与清单的持久化由
 * `run-store.js` 负责，便于单测。
 *
 * 路径安全规则：相对路径基于机器人工作区；绝对路径必须位于机器人工作区或
 * 当前运行目录内；符号链接会先 `realpath` 再判断，不能借它越界。
 *
 * @module @buka/dsh-plugin-workflows/attachments
 */

import { isUtf8 } from 'node:buffer'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 单个附件默认上限：8 MiB。 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

/** 每次执行默认最多附件数。 */
export const DEFAULT_MAX_ATTACHMENTS_PER_NODE = 20

/** 每次执行默认附件总量上限：64 MiB。 */
export const DEFAULT_MAX_NODE_ATTACHMENTS_BYTES = 64 * 1024 * 1024

/** prompt 内联单个文本附件的默认上限：32 KiB。 */
export const DEFAULT_MAX_INLINE_ATTACHMENT_BYTES = 32 * 1024

/** 清单里文件名允许的最大 UTF-8 字节数。 */
const MAX_NAME_BYTES = 160

/** 清单里描述允许的最大字符数。 */
const MAX_DESCRIPTION_LENGTH = 500

/**
 * 把任意错误转成一句话。
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 按 UTF-8 字节数截断文本，不切断码点。
 *
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function clipUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let used = 0
  let output = ''
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/**
 * 正整数或默认值。
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positive(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * 文件名清洗：保留 Unicode basename，去掉路径分隔符、控制字符与 Windows
 * 非法字符，空名回退 `attachment`。
 *
 * @param {unknown} value
 * @param {string} fallbackSource 源文件路径，用于在没给名字时取 basename
 * @returns {string}
 */
export function sanitizeAttachmentName(value, fallbackSource = '') {
  const raw =
    typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : path.basename(String(fallbackSource).replace(/\\/gu, '/'))
  let name = raw.replace(/\\/gu, '/').split('/').pop() ?? ''
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/gu, '-')
    .replace(/[.\s]+$/u, '')
    .trim()
  if (name === '' || name === '.' || name === '..') name = 'attachment'
  name = clipUtf8(name, MAX_NAME_BYTES)
  return name === '' ? 'attachment' : name
}

/**
 * 同名附件去重：`report.md`、`report-2.md`。大小写不敏感，兼容大小写不敏感
 * 的文件系统。
 *
 * @param {string} name
 * @param {Set<string>} used
 * @returns {string}
 */
function uniqueAttachmentName(name, used) {
  const key = name.toLowerCase()
  if (!used.has(key)) {
    used.add(key)
    return name
  }
  const extension = path.extname(name)
  const base = extension === '' ? name : name.slice(0, -extension.length)
  let index = 2
  while (index < 10000) {
    const candidate = `${base}-${index}${extension}`
    const candidateKey = candidate.toLowerCase()
    if (!used.has(candidateKey)) {
      used.add(candidateKey)
      return candidate
    }
    index += 1
  }
  const fallback = `${base}-${Date.now()}${extension}`
  used.add(fallback.toLowerCase())
  return fallback
}

/**
 * 规范化一个附件声明；非法项抛出带下标的错误。
 *
 * @param {unknown} raw
 * @param {{ maxCount?: number }} [options]
 * @returns {Array<{ path: string, name?: string, description?: string }>}
 */
export function normalizeAttachmentRequests(raw, options = {}) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new Error('attachments must be an array of file paths or { path, name?, description? } objects')
  }
  const maxCount = positive(options.maxCount, DEFAULT_MAX_ATTACHMENTS_PER_NODE)
  if (raw.length > maxCount) {
    throw new Error(`attachments must contain at most ${maxCount} files`)
  }
  const requests = []
  raw.forEach((item, index) => {
    let source
    let name
    let description
    if (typeof item === 'string') {
      source = item
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      source = item.path
      name = item.name
      description = item.description
    } else {
      throw new Error(`attachments[${index}] must be a file path string or a { path, name?, description? } object`)
    }
    if (typeof source !== 'string' || source.trim() === '') {
      throw new Error(`attachments[${index}].path must be a non-empty file path`)
    }
    if (source.includes('\u0000')) {
      throw new Error(`attachments[${index}].path contains an invalid NUL character`)
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      throw new Error(`attachments[${index}].name must be a string`)
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      throw new Error(`attachments[${index}].description must be a string`)
    }
    const request = { path: source.trim() }
    if (typeof name === 'string' && name.trim() !== '') request.name = name.trim()
    if (typeof description === 'string' && description.trim() !== '') {
      request.description = description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
    }
    requests.push(request)
  })
  return requests
}

/**
 * 判断一个路径是否在根目录内。
 *
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * 解析并校验附件源文件。
 *
 * @param {{ path: string }} request
 * @param {{ workspace?: string, runDirectory?: string }} roots
 * @returns {Promise<{ source: string, bytes: number }>}
 */
async function resolveSource(request, roots) {
  const display = request.path
  let candidate
  if (path.isAbsolute(request.path)) {
    candidate = request.path
  } else if (typeof roots.workspace === 'string' && roots.workspace !== '') {
    candidate = path.resolve(roots.workspace, request.path)
  } else {
    throw new Error(`cannot resolve attachment "${display}": the robot session did not report a workspace`)
  }

  let source
  try {
    source = await fs.realpath(candidate)
  } catch (error) {
    throw new Error(`attachment source "${display}" is not readable: ${describeError(error)}`, { cause: error })
  }

  const allowedRoots = []
  for (const root of [roots.workspace, roots.runDirectory]) {
    if (typeof root !== 'string' || root === '') continue
    try {
      allowedRoots.push(await fs.realpath(root))
    } catch {
      // 根目录不存在时跳过；如果另一个根可用，仍然可以解析。
    }
  }
  if (!allowedRoots.some((root) => isInside(root, source))) {
    throw new Error(
      `attachment source "${display}" is outside the robot workspace and the current run directory`,
    )
  }

  let stat
  try {
    stat = await fs.stat(source)
  } catch (error) {
    throw new Error(`attachment source "${display}" is not readable: ${describeError(error)}`, { cause: error })
  }
  if (!stat.isFile()) {
    throw new Error(`attachment source "${display}" is not a regular file`)
  }
  return { source, bytes: stat.size }
}

/**
 * 把一组附件复制到目的地，返回稳定清单。
 *
 * 复制前会清空目的地，失败时也清空，避免留下半套附件。清单顺序与输入一致；
 * 名字冲突时自动追加 `-2`、`-3`。
 *
 * @param {{
 *   raw: unknown,
 *   workspace?: string,
 *   runDirectory: string,
 *   destination: string,
 *   maxBytes?: number,
 *   maxTotalBytes?: number,
 *   maxCount?: number,
 * }} input
 * @returns {Promise<Array<{ index: number, name: string, bytes: number, description?: string }>>}
 */
export async function writeAttachments(input) {
  const requests = normalizeAttachmentRequests(input.raw, { maxCount: input.maxCount })
  const maxBytes = positive(input.maxBytes, DEFAULT_MAX_ATTACHMENT_BYTES)
  const maxTotalBytes = positive(input.maxTotalBytes, DEFAULT_MAX_NODE_ATTACHMENTS_BYTES)
  const roots = { workspace: input.workspace, runDirectory: input.runDirectory }
  /** @type {Array<{ index: number, name: string, bytes: number, description?: string }>} */
  const manifest = []
  const used = new Set()
  let total = 0

  await fs.rm(input.destination, { recursive: true, force: true })
  if (requests.length === 0) return manifest
  await fs.mkdir(input.destination, { recursive: true })
  try {
    for (const [index, request] of requests.entries()) {
      const resolved = await resolveSource(request, roots)
      if (resolved.bytes > maxBytes) {
        throw new Error(
          `attachment "${request.path}" is too large (${resolved.bytes} bytes; limit is ${maxBytes} bytes)`,
        )
      }
      if (total + resolved.bytes > maxTotalBytes) {
        throw new Error(
          `node attachments exceed the total size limit (${maxTotalBytes} bytes)`,
        )
      }
      const name = uniqueAttachmentName(
        sanitizeAttachmentName(request.name, request.path),
        used,
      )
      const destination = path.join(input.destination, name)
      await fs.copyFile(resolved.source, destination, fs.constants.COPYFILE_EXCL)
      const stat = await fs.stat(destination)
      if (stat.size > maxBytes) {
        throw new Error(
          `attachment "${request.path}" grew beyond the ${maxBytes}-byte limit while being copied`,
        )
      }
      total += stat.size
      if (total > maxTotalBytes) {
        throw new Error(`node attachments exceed the total size limit (${maxTotalBytes} bytes)`)
      }
      /** @type {{ index: number, name: string, bytes: number, description?: string }} */
      const entry = { index, name, bytes: stat.size }
      if (request.description !== undefined) entry.description = request.description
      manifest.push(entry)
    }
  } catch (error) {
    await fs.rm(input.destination, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return manifest
}

/**
 * 读取文本附件用于 prompt 内联；二进制或超过上限时不返回文本。
 *
 * @param {string} file
 * @param {number} maxBytes
 * @returns {Promise<{ available: boolean, text?: string, reason?: 'binary' | 'too-large', bytes: number }>}
 */
export async function readInlineText(file, maxBytes) {
  const limit = positive(maxBytes, DEFAULT_MAX_INLINE_ATTACHMENT_BYTES)
  const stat = await fs.stat(file)
  if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${file}`)
  if (stat.size > limit) return { available: false, reason: 'too-large', bytes: stat.size }
  const buffer = await fs.readFile(file)
  if (!isUtf8(buffer) || buffer.includes(0)) {
    return { available: false, reason: 'binary', bytes: stat.size }
  }
  return { available: true, text: buffer.toString('utf8'), bytes: stat.size }
}

/**
 * 读取附件的一段内容；文本按 UTF-8 解码，二进制返回 null 文本。
 *
 * @param {string} file
 * @param {{ offset?: number, maxBytes?: number }} [options]
 * @returns {Promise<{ text: string | null, binary: boolean, truncated: boolean, bytes: number, offset: number, read: number }>}
 */
export async function readAttachmentRange(file, options = {}) {
  const stat = await fs.stat(file)
  if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${file}`)
  const offset = Number.isInteger(options.offset) && options.offset >= 0 ? options.offset : 0
  const maxBytes = positive(options.maxBytes, 64 * 1024)
  const start = Math.min(offset, stat.size)
  const length = Math.max(0, Math.min(maxBytes, stat.size - start))
  let buffer = Buffer.alloc(0)
  if (length > 0) {
    const handle = await fs.open(file, 'r')
    try {
      const target = Buffer.alloc(length)
      const { bytesRead } = await handle.read(target, 0, length, start)
      buffer = target.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }
  const truncated = start + buffer.length < stat.size
  let available = isUtf8(buffer) && !buffer.includes(0)
  let text = available ? buffer.toString('utf8') : null
  if (!available && truncated) {
    // 截断点可能刚好切在多字节字符中间：最多回退 3 个字节再试一次。
    for (let trim = 1; trim <= 3 && trim < buffer.length; trim += 1) {
      const candidate = buffer.subarray(0, buffer.length - trim)
      if (isUtf8(candidate) && !candidate.includes(0)) {
        text = candidate.toString('utf8')
        break
      }
    }
  }
  return {
    text,
    binary: text === null,
    truncated,
    bytes: stat.size,
    offset: start,
    read: buffer.length,
  }
}
