/**
 * 作业附件库：文件落盘、元数据、读取与「按数据流授权」的可见集合。
 *
 * 规则来自 `.tmp/workflow-v4-spec.md` §10 与 ADR 0012：
 *
 * - 附件属于作业，每条附件必须有来源任务 / 岗位；
 * - 文件本体放在作业目录的 `attachments/` 下，记录里只存文件名；
 * - 附件对「产出它的任务、直接或传递依赖它的任务（下游）、启动者、看板页面」
 *   可见；引擎在任务上下文与检索时按这个集合过滤。
 *
 * 路径安全：相对路径基于任务执行者（机器人）的工作区；绝对路径必须位于工作区
 * 内；符号链接先 `realpath` 再判断。
 *
 * @module @buka/dsh-plugin-workflows/attachments
 */

import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { newAttachmentId, nowIso } from '../domain/ids.ts'
import type { AttachmentRecord, TaskRecord } from '../domain/types.ts'

/** 单个附件默认上限：8 MiB。 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

/** 每次任务完成默认最多附件数。 */
export const DEFAULT_MAX_ATTACHMENTS_PER_TASK = 20

/** 每次任务完成默认附件总量上限：64 MiB。 */
export const DEFAULT_MAX_TASK_ATTACHMENTS_BYTES = 64 * 1024 * 1024

/** prompt 内联单个文本附件的默认上限：32 KiB。 */
export const DEFAULT_MAX_INLINE_ATTACHMENT_BYTES = 32 * 1024

/** 页面附件预览一次读取的文本上限：64 KiB。 */
export const DEFAULT_PREVIEW_TEXT_BYTES = 64 * 1024

/** 附件清单里文件名允许的最大 UTF-8 字节数。 */
const MAX_NAME_BYTES = 160

/** 描述允许的最大字符数。 */
const MAX_DESCRIPTION_LENGTH = 500

/** 可直接 inline 预览的图片扩展名 → MIME；其它类型按文本嗅探或下载。 */
const IMAGE_MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
  ['.svg', 'image/svg+xml'],
])

/** 一个规范化后的附件请求。 */
export interface AttachmentRequest {
  path: string
  name?: string | undefined
  description?: string | undefined
}

/** 预览类型与对应的 MIME。 */
export interface AttachmentPreviewInfo {
  kind: 'image' | 'pdf' | 'text'
  mime: string
}

/** 文本附件内联结果。 */
export interface InlineAttachmentText {
  available: boolean
  text?: string | undefined
  reason?: 'binary' | 'too-large' | undefined
  bytes: number
}

/** 读取附件一段内容的结果。 */
export interface AttachmentRange {
  text: string | null
  binary: boolean
  truncated: boolean
  bytes: number
  offset: number
  read: number
}

/** 附件限额。 */
export interface AttachmentLimits {
  readonly maxBytes: number
  readonly maxTotalBytes: number
  readonly maxCount: number
}

/** 落盘一个任务的附件所需的上下文。 */
export interface IngestAttachmentsInput {
  readonly raw: unknown
  readonly jobId: string
  /** 作业根目录（绝对路径）。 */
  readonly jobDirectory: string
  readonly taskId: string
  readonly position: string
  /** 创建者展示名（机器人 / 助理 / 人）。 */
  readonly createdBy: string
  /** 机器人工作区；人任务可省略。 */
  readonly workspace?: string | undefined
  readonly limits: AttachmentLimits
}

/**
 * 把任意错误转成一句话。
 *
 * @param error 任意错误
 * @returns 一句话错误
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 按 UTF-8 字节数截断文本，不切断码点。
 *
 * @param text 原文
 * @param maxBytes 字节上限
 * @returns 截断后的文本
 */
export function clipUtf8(text: string, maxBytes: number): string {
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
 * @param value 待校验的值
 * @param fallback 默认值
 * @returns 正整数或默认值
 */
function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * 文件名清洗：保留 Unicode basename，去掉路径分隔符、控制字符与 Windows
 * 非法字符，空名回退 `attachment`。
 *
 * @param value 请求里给的名字
 * @param fallbackSource 源文件路径，用于在没给名字时取 basename
 * @returns 清洗后的文件名
 */
export function sanitizeAttachmentName(value: unknown, fallbackSource = ''): string {
  const raw =
    typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : path.basename(String(fallbackSource).replace(/\\/gu, '/'))
  let name = raw.replace(/\\/gu, '/').split('/').pop() ?? ''
  name = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 清洗文件名必须覆盖控制字符
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/gu, '-')
    .replace(/[.\s]+$/u, '')
    .trim()
  if (name === '' || name === '.' || name === '..') name = 'attachment'
  name = clipUtf8(name, MAX_NAME_BYTES)
  return name === '' ? 'attachment' : name
}

/**
 * 预览类型：按扩展名先划分可 inline 的图片 / PDF，其余交给文本嗅探。
 *
 * @param name 附件文件名
 * @returns 预览类型与对应的 MIME
 */
export function attachmentPreviewInfo(name: unknown): AttachmentPreviewInfo {
  const extension = path.extname(typeof name === 'string' ? name : '').toLowerCase()
  if (extension === '.pdf') return { kind: 'pdf', mime: 'application/pdf' }
  const mime = IMAGE_MIME_BY_EXTENSION.get(extension)
  if (mime !== undefined) return { kind: 'image', mime }
  return { kind: 'text', mime: 'text/plain' }
}

/**
 * 规范化一个附件请求；非法项抛出带下标的错误。
 *
 * @param raw 结果里的 `attachments`
 * @param maxCount 数量上限
 * @returns 规范化后的附件请求
 */
export function normalizeAttachmentRequests(raw: unknown, maxCount: number): AttachmentRequest[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new Error(
      'attachments must be an array of file paths or { path, name?, description? } objects',
    )
  }
  const limit = positive(maxCount, DEFAULT_MAX_ATTACHMENTS_PER_TASK)
  if (raw.length > limit) throw new Error(`attachments must contain at most ${limit} files`)
  const requests: AttachmentRequest[] = []
  raw.forEach((item: unknown, index) => {
    let source: unknown
    let name: unknown
    let description: unknown
    if (typeof item === 'string') {
      source = item
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      source = record.path
      name = record.name
      description = record.description
    } else {
      throw new Error(
        `attachments[${index}] must be a file path string or a { path, name?, description? } object`,
      )
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
    const request: AttachmentRequest = { path: source.trim() }
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
 * @param root 根目录
 * @param candidate 待判断的路径
 * @returns 在根目录内时为 true
 */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/**
 * 解析并校验附件源文件。
 *
 * @param request 附件请求
 * @param workspace 机器人工作区（可省略）
 * @returns 真实源文件路径与字节数
 */
async function resolveSource(
  request: AttachmentRequest,
  workspace: string | undefined,
): Promise<{ source: string; bytes: number }> {
  const display = request.path
  let candidate: string
  if (path.isAbsolute(request.path)) {
    candidate = request.path
  } else if (typeof workspace === 'string' && workspace !== '') {
    candidate = path.resolve(workspace, request.path)
  } else {
    candidate = path.resolve(request.path)
  }

  let source: string
  try {
    source = await fs.realpath(candidate)
  } catch (error) {
    throw new Error(`attachment source "${display}" is not readable: ${describeError(error)}`, {
      cause: error,
    })
  }

  if (typeof workspace === 'string' && workspace !== '' && !path.isAbsolute(request.path)) {
    let root: string
    try {
      root = await fs.realpath(workspace)
    } catch {
      throw new Error(`attachment source "${display}" is outside the robot workspace`)
    }
    if (!isInside(root, source)) {
      throw new Error(`attachment source "${display}" is outside the robot workspace`)
    }
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(source)
  } catch (error) {
    throw new Error(`attachment source "${display}" is not readable: ${describeError(error)}`, {
      cause: error,
    })
  }
  if (!stat.isFile()) throw new Error(`attachment source "${display}" is not a regular file`)
  return { source, bytes: stat.size }
}

/**
 * 文件名去重：`report.md`、`report-2.md`（大小写不敏感）。
 *
 * @param name 原始文件名
 * @param used 已占用的文件名（小写）
 * @returns 去重后的文件名
 */
function uniqueAttachmentName(name: string, used: Set<string>): string {
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
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase())
      return candidate
    }
    index += 1
  }
  const fallback = `${base}-${Date.now()}${extension}`
  used.add(fallback.toLowerCase())
  return fallback
}

/**
 * 把一组附件复制进作业附件库，返回附件记录。
 *
 * 失败时不留下半套文件：已复制的文件与已生成的记录一起回滚（记录由调用方写入，
 * 这里只负责文件）。记录里 `path` 是 `attachments/` 下的文件名。
 *
 * @param input 源清单、作业目录与限额
 * @returns 新的附件记录
 */
export async function ingestAttachments(
  input: IngestAttachmentsInput,
): Promise<AttachmentRecord[]> {
  const directory = path.join(input.jobDirectory, 'attachments')
  const requests = normalizeAttachmentRequests(input.raw, input.limits.maxCount)
  if (requests.length === 0) return []
  const maxBytes = positive(input.limits.maxBytes, DEFAULT_MAX_ATTACHMENT_BYTES)
  const maxTotalBytes = positive(input.limits.maxTotalBytes, DEFAULT_MAX_TASK_ATTACHMENTS_BYTES)
  await fs.mkdir(directory, { recursive: true })
  const records: AttachmentRecord[] = []
  const copied: string[] = []
  const used = new Set<string>()
  let total = 0
  try {
    for (const request of requests) {
      const resolved = await resolveSource(request, input.workspace)
      if (resolved.bytes > maxBytes) {
        throw new Error(
          `attachment "${request.path}" is too large (${resolved.bytes} bytes; limit is ${maxBytes})`,
        )
      }
      if (total + resolved.bytes > maxTotalBytes) {
        throw new Error(`task attachments exceed the total size limit (${maxTotalBytes} bytes)`)
      }
      const id = newAttachmentId()
      const name = uniqueAttachmentName(sanitizeAttachmentName(request.name, request.path), used)
      const fileName = `${id}-${name}`
      const destination = path.join(directory, fileName)
      await fs.copyFile(resolved.source, destination, fs.constants.COPYFILE_EXCL)
      const stat = await fs.stat(destination)
      if (stat.size > maxBytes) {
        throw new Error(`attachment "${request.path}" grew beyond the ${maxBytes}-byte limit`)
      }
      total += stat.size
      if (total > maxTotalBytes) {
        throw new Error(`task attachments exceed the total size limit (${maxTotalBytes} bytes)`)
      }
      const sha256 = await hashFile(destination)
      const preview = attachmentPreviewInfo(name)
      copied.push(destination)
      records.push({
        id,
        jobId: input.jobId,
        name,
        bytes: stat.size,
        mime: preview.kind === 'text' ? 'application/octet-stream' : preview.mime,
        sha256,
        description: request.description ?? '',
        sourceTaskId: input.taskId,
        sourcePositionId: input.position,
        createdBy: input.createdBy,
        createdAt: nowIso(),
        path: fileName,
      })
    }
  } catch (error) {
    await Promise.all(copied.map((file) => fs.rm(file, { force: true }).catch(() => undefined)))
    throw error
  }
  return records
}

/**
 * 计算文件 sha256。
 *
 * @param file 文件路径
 * @returns 十六进制摘要
 */
async function hashFile(file: string): Promise<string> {
  const buffer = await fs.readFile(file)
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 解析附件的绝对路径；只允许作业附件目录里的单个文件名。
 *
 * @param jobDirectory 作业根目录
 * @param relative 记录里的 `path`
 * @returns 绝对路径
 * @throws 越界或非法文件名时抛出
 */
export function resolveAttachmentFile(jobDirectory: string, relative: string): string {
  if (relative === '' || relative.includes('/') || relative.includes('\\') || relative === '..') {
    throw new Error(`invalid attachment path: ${JSON.stringify(relative)}`)
  }
  return path.join(jobDirectory, 'attachments', relative)
}

/**
 * 读取文本附件用于 prompt 内联；二进制或超过上限时不返回文本。
 *
 * @param file 附件绝对路径
 * @param maxBytes 内联字节上限
 * @returns 可内联时带文本，否则带原因
 */
export async function readInlineText(
  file: string,
  maxBytes = DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
): Promise<InlineAttachmentText> {
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
 * @param file 附件绝对路径
 * @param options 起始偏移与读取字节数
 * @returns 一段内容
 */
export async function readAttachmentRange(
  file: string,
  options: { offset?: number | undefined; maxBytes?: number | undefined } = {},
): Promise<AttachmentRange> {
  const stat = await fs.stat(file)
  if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${file}`)
  const offset =
    typeof options.offset === 'number' && Number.isInteger(options.offset) && options.offset >= 0
      ? options.offset
      : 0
  const maxBytes = positive(options.maxBytes, DEFAULT_PREVIEW_TEXT_BYTES)
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
  const available = isUtf8(buffer) && !buffer.includes(0)
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

/**
 * 一个任务可见的附件：自己产出的，以及它直接 / 传递依赖的任务产出的。
 *
 * @param tasks 作业里的全部任务
 * @param currentTaskId 当前任务 id
 * @param attachments 作业附件库
 * @returns 可见附件（顺序与附件库一致）
 */
export function visibleAttachmentsForTask(
  tasks: readonly TaskRecord[],
  currentTaskId: string,
  attachments: readonly AttachmentRecord[],
): AttachmentRecord[] {
  const visible = visibleTaskIds(tasks, currentTaskId)
  return attachments.filter((attachment) => visible.has(attachment.sourceTaskId))
}

/**
 * 可见任务集合：当前任务 + 它的依赖闭包。
 *
 * @param tasks 作业里的全部任务
 * @param currentTaskId 当前任务 id
 * @returns 可见来源任务 id
 */
export function visibleTaskIds(tasks: readonly TaskRecord[], currentTaskId: string): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visible = new Set<string>()
  const queue = [currentTaskId]
  while (queue.length > 0) {
    const taskId = queue.pop() as string
    if (visible.has(taskId)) continue
    visible.add(taskId)
    const task = byId.get(taskId)
    for (const dependency of task?.deps ?? []) queue.push(dependency)
  }
  return visible
}

/**
 * 检索附件：按名称 / 描述匹配，只返回可见集合里的条目。
 *
 * @param attachments 作业附件库
 * @param visible 可见附件 id / 来源集合
 * @param query 关键词
 * @returns 匹配的附件
 */
export function searchAttachments(
  attachments: readonly AttachmentRecord[],
  visible: ReadonlySet<string>,
  query: string,
): AttachmentRecord[] {
  const needle = query.trim().toLowerCase()
  return attachments.filter((attachment) => {
    if (!visible.has(attachment.id)) return false
    if (needle === '') return true
    return (
      attachment.name.toLowerCase().includes(needle) ||
      attachment.description.toLowerCase().includes(needle) ||
      attachment.sourceTaskId.toLowerCase().includes(needle)
    )
  })
}
