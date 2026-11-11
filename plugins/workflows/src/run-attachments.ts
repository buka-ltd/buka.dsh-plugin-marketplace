/**
 * 运行目录里的附件：把节点交回的附件复制进本次执行的节点目录，并按清单读取 /
 * 打开。
 *
 * 低层的文件复制与读取在 attachments.ts；这里只负责运行目录布局
 * （`nodes/<seq>-<id>/attachments`）、清单查找与路径安全校验。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { AttachmentManifestEntry } from './attachments.ts'
import { readAttachmentRange, readInlineText, writeAttachments } from './attachments.ts'

/** 每次执行的节点目录里附件目录名。 */
export const ATTACHMENTS_DIR = 'attachments'

/**
 * 把任意错误转成一句话。
 *
 * @param error 任意错误
 * @returns 一句话错误
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `openAttachment` 的返回：清单里的一个可下载附件。 */
export interface OpenedAttachment {
  path: string
  name: string
  bytes: number
  description: string | null
  index: number
}

/**
 * 清单里的附件名必须是一段安全路径；Unicode 文件名允许，分隔符与控制字符
 * 不允许。
 *
 * @param name 清单里的附件名
 * @returns 是安全的一段路径时为 true
 */
function isSafeAttachmentName(name: unknown): boolean {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\') || name.includes('\u0000')) return false
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 附件名不能包含控制字符
  return !/[\u0000-\u001f\u007f]/u.test(name)
}

/**
 * @param root 根目录
 * @param candidate 待判断的路径
 * @returns 在根目录内时为 true
 */
function isInsideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/**
 * 把节点返回的附件复制到该次执行的节点目录，返回稳定清单。
 *
 * @param options 节点目录、运行目录、原始清单与限额
 * @returns 稳定清单
 */
export async function writeNodeAttachmentsToRun(options: {
  runDirectory: string
  nodeDirectory: string
  raw: unknown
  workspace?: string | undefined
  maxBytes: number
  maxTotalBytes: number
  maxCount: number
}): Promise<AttachmentManifestEntry[]> {
  return await writeAttachments({
    raw: options.raw,
    workspace: options.workspace ?? '',
    runDirectory: options.runDirectory,
    destination: path.join(options.nodeDirectory, ATTACHMENTS_DIR),
    maxBytes: options.maxBytes,
    maxTotalBytes: options.maxTotalBytes,
    maxCount: options.maxCount,
  })
}

/**
 * 把附件清单转成模板上下文：每个附件带绝对路径；文本附件在大小上限内
 * 额外带 `text` 供 prompt 内联。
 *
 * @param options 附件目录、清单与内联上限
 * @returns 模板上下文里的附件值
 */
export async function attachmentTemplateValues(options: {
  attachmentsDirectory: string
  manifest: unknown
  maxInlineTextBytes: number
}): Promise<Array<Record<string, unknown>>> {
  if (!Array.isArray(options.manifest)) return []
  const directory = options.attachmentsDirectory
  const values: Array<Record<string, unknown>> = []
  for (const [fallbackIndex, rawEntry] of (options.manifest as unknown[]).entries()) {
    if (rawEntry === null || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
    const entry = rawEntry as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (!isSafeAttachmentName(name)) continue
    const index =
      typeof entry.index === 'number' && Number.isInteger(entry.index) ? entry.index : fallbackIndex
    const file = path.join(directory, name)
    const value: Record<string, unknown> = {
      index,
      name,
      bytes: typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : 0,
      path: file,
    }
    if (typeof entry.description === 'string' && entry.description !== '') {
      value.description = entry.description
    }
    try {
      const inline = await readInlineText(file, options.maxInlineTextBytes)
      if (inline.available) {
        value.text = inline.text
      } else {
        value.text = {
          __bukaTemplateError: `attachment "${name}" is ${
            inline.reason === 'binary' ? 'binary' : 'larger than the inline attachment limit'
          }; use .path or buka_workflow_execution_attachment instead`,
        }
      }
    } catch (error) {
      // 文件暂时读不到时仍保留路径；模板要用 .text 会得到明确错误。
      value.text = {
        __bukaTemplateError: `attachment "${name}" could not be read: ${describeError(error)}`,
      }
    }
    values.push(value)
  }
  return values
}

/**
 * 读取一个附件的一段内容。`name` 必须出现在该次执行的清单里。
 *
 * @param options 节点结果、节点目录、附件名与读取范围
 * @returns 附件的一段内容；找不到时是 `null`
 */
export async function readRunAttachment(options: {
  nodeResult: Record<string, unknown> | null
  nodeDirectory: string
  name: string
  offset?: number | undefined
  maxBytes?: number | undefined
}): Promise<Record<string, unknown> | null> {
  const entry = findAttachmentEntry(options.nodeResult, options.name)
  if (entry === null) return null
  const entryName = typeof entry.name === 'string' ? entry.name : ''
  const file = await attachmentFilePath(options.nodeDirectory, entryName)
  const range = await readAttachmentRange(file, {
    offset: options.offset,
    maxBytes: options.maxBytes,
  })
  const value: Record<string, unknown> = {
    index: typeof entry.index === 'number' && Number.isInteger(entry.index) ? entry.index : 0,
    name: entryName,
    description: typeof entry.description === 'string' ? entry.description : null,
    bytes: range.bytes,
    path: file,
    text: range.text,
    binary: range.binary,
    truncated: range.truncated,
    offset: range.offset,
    read: range.read,
  }
  return value
}

/**
 * 打开一个附件用于下载：只返回清单里的文件，并确认它仍在附件目录内。
 *
 * @param options 节点结果、节点目录与附件名
 * @returns 可下载附件；找不到时是 `null`
 */
export async function openRunAttachment(options: {
  nodeResult: Record<string, unknown> | null
  nodeDirectory: string
  name: string
}): Promise<OpenedAttachment | null> {
  const entry = findAttachmentEntry(options.nodeResult, options.name)
  if (entry === null) return null
  const entryName = typeof entry.name === 'string' ? entry.name : ''
  const file = await attachmentFilePath(options.nodeDirectory, entryName)
  const stat = await fs.stat(file)
  return {
    path: file,
    name: entryName,
    bytes: stat.size,
    description: typeof entry.description === 'string' ? entry.description : null,
    index: typeof entry.index === 'number' && Number.isInteger(entry.index) ? entry.index : 0,
  }
}

/**
 * 在节点结果的附件清单里按名字找一个附件。
 *
 * @param nodeResult 节点结果
 * @param name 附件名
 * @returns 清单里的附件项；找不到时是 `null`
 */
function findAttachmentEntry(
  nodeResult: Record<string, unknown> | null,
  name: string,
): Record<string, unknown> | null {
  if (typeof name !== 'string' || !isSafeAttachmentName(name)) return null
  const manifest = Array.isArray(nodeResult?.attachments) ? nodeResult.attachments : []
  const entry = manifest.find(
    (item) =>
      item !== null && typeof item === 'object' && (item as Record<string, unknown>).name === name,
  )
  return entry === undefined ? null : (entry as Record<string, unknown>)
}

/**
 * 附件文件的真实路径；符号链接解析后必须仍在 attachments 目录内。
 *
 * @param nodeDirectory 该次执行的节点目录
 * @param name 附件名
 * @returns 真实文件路径
 */
async function attachmentFilePath(nodeDirectory: string, name: string): Promise<string> {
  if (!isSafeAttachmentName(name)) throw new Error('invalid attachment name')
  const directory = path.join(nodeDirectory, ATTACHMENTS_DIR)
  const realDirectory = await fs.realpath(directory)
  const realFile = await fs.realpath(path.join(directory, name))
  if (!isInsideDirectory(realDirectory, realFile)) {
    throw new Error(`attachment "${name}" is outside the node attachment directory`)
  }
  const stat = await fs.stat(realFile)
  if (!stat.isFile()) throw new Error(`attachment "${name}" is not a regular file`)
  return realFile
}
