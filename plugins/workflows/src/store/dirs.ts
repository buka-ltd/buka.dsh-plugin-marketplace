/**
 * 作业目录布局与路径安全。
 *
 * 元数据进 `ctx.storageDomain`；大文本（渲染后的 prompt、结果全文）与附件文件
 * 放插件数据目录下的作业目录：
 *
 * ```text
 * <dataDir>/jobs/<jobId>/
 *   prompts/<attemptId>.md
 *   results/<attemptId>.txt
 *   attachments/<attachmentId>-<name>
 *   events.jsonl
 * ```
 *
 * 记录里只存相对路径，避免宿主机迁移目录后引用失效。所有 id 先校验成单个路径
 * 段再拼路径，防止 `../` 越界。
 *
 * @module @buka/dsh-plugin-workflows/store/dirs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 单个 id 允许的字符；记录 id 都是 `[a-z]+-...` 或 `$start`。 */
const SAFE_SEGMENT = /^[A-Za-z0-9$][A-Za-z0-9._-]*$/u

/** 作业目录内的相对路径。 */
export interface JobPaths {
  /** 作业根目录。 */
  readonly root: string
  /** 渲染后的 prompt。 */
  readonly prompts: string
  /** 结果全文。 */
  readonly results: string
  /** 附件文件。 */
  readonly attachments: string
  /** 事件时间线（JSON Lines）。 */
  readonly events: string
}

/**
 * 校验一个 id / 文件名是单个安全的路径段。
 *
 * @param value 待校验的 id
 * @param label 出错信息里用的名称
 * @returns 原值
 * @throws id 不合法时抛出
 */
export function assertSafeSegment(value: string, label = 'id'): string {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 计算一个作业的目录布局。
 *
 * @param dataDir 插件数据目录
 * @param jobId 作业 id
 * @returns 目录布局
 */
export function jobPaths(dataDir: string, jobId: string): JobPaths {
  const root = path.join(dataDir, 'jobs', assertSafeSegment(jobId, 'job id'))
  return {
    root,
    prompts: path.join(root, 'prompts'),
    results: path.join(root, 'results'),
    attachments: path.join(root, 'attachments'),
    events: path.join(root, 'events.jsonl'),
  }
}

/**
 * 建好一个作业的目录。
 *
 * @param paths 目录布局
 * @returns 无返回值
 */
export async function ensureJobDirectories(paths: JobPaths): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.prompts, { recursive: true }),
    fs.mkdir(paths.results, { recursive: true }),
    fs.mkdir(paths.attachments, { recursive: true }),
  ])
}

/**
 * 把作业目录内的相对路径解析成绝对路径，并确保仍在作业根目录内。
 *
 * @param paths 目录布局
 * @param relative 记录里的相对路径
 * @returns 绝对路径
 * @throws 越界时抛出
 */
export function resolveJobFile(paths: JobPaths, relative: string): string {
  const absolute = path.resolve(paths.root, relative)
  const rel = path.relative(paths.root, absolute)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes the job directory: ${relative}`)
  }
  return absolute
}

/**
 * 写一份大文本到作业目录，返回相对作业根目录的路径。
 *
 * @param paths 目录布局
 * @param kind `prompts` / `results`
 * @param name 文件名（单个安全段）
 * @param text 文本
 * @returns 相对作业根目录的路径
 */
export async function writeJobText(
  paths: JobPaths,
  kind: 'prompts' | 'results',
  name: string,
  text: string,
): Promise<string> {
  const directory = kind === 'prompts' ? paths.prompts : paths.results
  const file = path.join(directory, `${assertSafeSegment(name, 'file name')}.txt`)
  await fs.writeFile(file, text, 'utf8')
  return path.relative(paths.root, file)
}

/**
 * 读一份作业目录里的大文本。
 *
 * @param paths 目录布局
 * @param relative 相对路径
 * @returns 文本；文件不存在时是 null
 */
export async function readJobText(paths: JobPaths, relative: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveJobFile(paths, relative), 'utf8')
  } catch {
    return null
  }
}
