/**
 * 工作流运行的落盘存储。
 *
 * 每次运行占一个目录，内容如下：
 *
 * ```text
 * runs/sequence.json  运行序号计数器（不是运行目录，只记录下一个序号）
 * runs/<runId>/
 *   definition.json  本次一次性定义的快照（goal、节点、创建者、时间）
 *   run.json         权威状态快照：原子写（临时文件 + rename）
 *   events.jsonl     追加事件：node/start、node/end、gate/decided、run/end …
 *   nodes/<seq>-<id>/
 *     result.json       节点结果全文（run.json 里只留预览；机器人会话的只读
 *                       工具从这里读某次执行的 prompt / 输出）
 *     attachments/      该次执行声明的附件文件
 * ```
 *
 * 旧记录的 `nodes/<seq>-<id>.json` 仍然可以读取（新执行只写目录布局），
 * 所以格式 2 的已有运行不需要迁移或删除。
 *
 * 每次运行有一个持久递增的序号 `seq`（从 1 开始，写在 run.json 里）：删除旧
 * 运行不会让编号回退；启动时会给没有序号的旧记录按创建时间回填，再把计数器
 * 推到最大值之后。序号只用于展示与引用，不影响执行。
 *
 * 运行数据带格式版本（`WORKFLOW_FORMAT_VERSION`）：启动时版本不符、或
 * `run.json` / `definition.json` 缺失损坏的运行目录会被整个删除（旧格式没有
 * 迁移路径）；全部删光时序号计数器也一起丢掉，下次从 #1 开始。
 *
 * 未完成的运行由 `WorkflowSupervisor` 在启动时尝试恢复（只续接同一会话，不新开
 * 会话）；确实无法恢复时才调用 `markInterrupted`，保留记录供回看。结束的
 * 运行按自动归档设置处理：超过归档时间的运行写上 `archivedAt` 并从默认列表
 * 隐藏；超过删除时间的运行目录直接删除。仍在运行的记录永远不会被归档或删除；
 * `maxRuns` 只限制已归档记录的数量（从最旧的已归档运行开始删）。
 *
 * @module @buka/dsh-plugin-workflows/run-store
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_MAX_ATTACHMENTS_PER_NODE,
  DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
  DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
  readAttachmentRange,
  readInlineText,
  writeAttachments,
} from './attachments.js'
import { normalizeRetention } from './settings.js'

/** 状态快照文件名。 */
export const RUN_FILE = 'run.json'

/** 定义快照文件名。 */
export const DEFINITION_FILE = 'definition.json'

/** 事件流文件名。 */
export const EVENTS_FILE = 'events.jsonl'

/** 节点结果目录名。 */
export const NODES_DIR = 'nodes'

/** 每次执行的节点目录里结果文件名。 */
export const NODE_RESULT_FILE = 'result.json'

/** 每次执行的节点目录里附件目录名。 */
export const ATTACHMENTS_DIR = 'attachments'

/** 运行序号计数器文件名；放在 runs 目录里，但不是运行目录。 */
export const SEQUENCE_FILE = 'sequence.json'

/**
 * 当前运行数据格式版本。启动时会把版本不符（或 run.json / definition.json
 * 缺失、损坏）的运行目录整个删掉：旧格式没有迁移路径。
 */
export const WORKFLOW_FORMAT_VERSION = 2

/** 一个小时的毫秒数：归档设置的时间单位。 */
const HOUR_MS = 60 * 60 * 1000

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
 * 原子写 JSON：先写同目录临时文件，再 rename。
 *
 * @param {string} file
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * 读一个 JSON 文件；文件缺失、不可读或内容不是对象时返回 null。
 *
 * @param {string} file
 * @returns {Promise<Record<string, any> | null>}
 */
async function readJsonFile(file) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * 判断一条运行记录是否与当前格式不兼容；兼容时返回 null，否则返回原因。
 *
 * @param {Record<string, any> | null} run
 * @param {Record<string, any> | null} definition
 * @returns {string | null}
 */
function incompatibleReason(run, definition) {
  if (run === null) return 'run.json 缺失或损坏'
  if (run.version !== WORKFLOW_FORMAT_VERSION) return `run.json 版本为 ${String(run.version)}`
  if (definition === null) return 'definition.json 缺失或损坏'
  if (definition.version !== WORKFLOW_FORMAT_VERSION) return `definition.json 版本为 ${String(definition.version)}`
  return null
}

/**
 * 按 UTF-8 字节数截断文本，避免把一个多字节字符切成两半。
 *
 * @param {string} text
 * @param {number} maxBytes
 * @returns {{ text: string, truncated: boolean }}
 */
export function truncateUtf8(text, maxBytes) {
  if (typeof text !== 'string') return { text: '', truncated: false }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { text, truncated: false }
  let clipped = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')
  // 截断点可能落在字符中间，替换掉末尾的无效字符。
  clipped = clipped.replace(/\uFFFD$/u, '')
  return { text: clipped, truncated: true }
}

/**
 * 计龄基准：优先结束时间，其次最后更新时间，再次创建时间；读不到记录时用
 * 目录的 mtime 兜底。归档 / 删除都按这个时间算，运行中的记录不会被处理。
 *
 * @param {Record<string, any> | null} run
 * @param {number} fallback
 * @returns {number}
 */
function ageAnchor(run, fallback) {
  for (const value of [run?.finishedAt, run?.updatedAt, run?.createdAt]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

/**
 * 正整数选项或默认值。
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveOption(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * 清单里的附件名必须是一段安全路径；Unicode 文件名允许，分隔符与控制字符
 * 不允许。
 *
 * @param {unknown} name
 * @returns {boolean}
 */
function isSafeAttachmentName(name) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\') || name.includes('\u0000')) return false
  return !/[\u0000-\u001f\u007f]/u.test(name)
}

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * 运行记录存储。
 */
export class WorkflowRunStore {
  /**
   * @param {{
   *   dir: string,
   *   maxRuns?: number,
   *   maxAttachmentBytes?: number,
   *   maxAttachmentsPerNode?: number,
   *   maxNodeAttachmentsBytes?: number,
   *   maxInlineAttachmentBytes?: number,
   *   retention?: { enabled?: boolean, archiveAfterHours?: number, deleteAfterHours?: number },
   *   logger?: { warn?: (message: string) => void, info?: (message: string) => void },
   * }} options
   */
  constructor(options) {
    if (typeof options?.dir !== 'string' || options.dir.trim() === '') {
      throw new Error('WorkflowRunStore requires a runs directory')
    }
    this.dir = path.resolve(options.dir)
    this.maxRuns = Number.isInteger(options.maxRuns) && options.maxRuns > 0 ? options.maxRuns : 200
    this.maxAttachmentBytes = positiveOption(options.maxAttachmentBytes, DEFAULT_MAX_ATTACHMENT_BYTES)
    this.maxAttachmentsPerNode = positiveOption(
      options.maxAttachmentsPerNode,
      DEFAULT_MAX_ATTACHMENTS_PER_NODE,
    )
    this.maxNodeAttachmentsBytes = positiveOption(
      options.maxNodeAttachmentsBytes,
      DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
    )
    this.maxInlineAttachmentBytes = positiveOption(
      options.maxInlineAttachmentBytes,
      DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
    )
    this.retention = normalizeRetention(options.retention)
    this.logger = options.logger
    /** @type {Promise<void> | null} */
    this.ready = null
    /** 序号分配串行化：并发创建工作流时不能读到同一个「下一个序号」。 */
    /** @type {Promise<unknown>} */
    this.sequenceQueue = Promise.resolve()
    /** 清扫串行化：定时器与「保存设置后立即清扫」可能撞在一起。 */
    /** @type {Promise<unknown>} */
    this.sweepQueue = Promise.resolve()
  }

  /**
   * 建目录、删掉格式不兼容的旧运行、回填序号、按自动归档设置清理；未完成
   * 运行交给观察者恢复。
   *
   * @returns {Promise<void>}
   */
  async init() {
    this.ready ??= this.#initialize()
    return await this.ready
  }

  /** @returns {Promise<void>} */
  async #initialize() {
    await fs.mkdir(this.dir, { recursive: true })
    // 格式版本变了就直接丢弃旧运行目录：旧数据没有升级路径，留着只会让页面
    // 读到结构不一致的记录。必须在回填序号之前做，序号才不会被旧记录带偏。
    await this.#purgeIncompatibleRuns()
    // 未完成的运行不再在 store 初始化时一律标成 interrupted：由
    // WorkflowSupervisor 先尝试恢复；确实恢复不了时才调用 markInterrupted。
    await this.backfillSeq()
    await this.sweep()
  }

  /**
   * 删除格式版本不兼容（或 run.json / definition.json 缺失、损坏）的运行目录。
   * 运行时文件（settings.json）在 runs 目录之外，永远不会被这里碰到。
   *
   * 如果所有运行目录都被删掉，一并删除序号计数器，让下一次运行从 #1 重新
   * 开始；只要还有当前版本的运行留着，就保持计数器原样。
   *
   * @returns {Promise<void>}
   */
  async #purgeIncompatibleRuns() {
    const runIds = await this.listRunIds()
    if (runIds.length === 0) return
    let removed = 0
    for (const runId of runIds) {
      const directory = this.runDirectory(runId)
      if (!this.#isOwnRunDirectory(directory)) continue
      const run = await readJsonFile(path.join(directory, RUN_FILE))
      const definition = await readJsonFile(path.join(directory, DEFINITION_FILE))
      const reason = incompatibleReason(run, definition)
      if (reason === null) continue
      try {
        await fs.rm(directory, { recursive: true, force: true })
        removed += 1
        this.logger?.info?.(`buka-workflows: 删除格式不兼容的运行记录（${runId}：${reason}）`)
      } catch (error) {
        this.logger?.warn?.(`buka-workflows: 删除格式不兼容的运行记录失败（${runId}）：${describeError(error)}`)
      }
    }
    if (removed === 0) return
    this.logger?.info?.(`buka-workflows: 共删除 ${removed} 条格式不兼容的运行记录`)
    // 全部旧运行都清掉了才重置编号；还有当前版本的运行就保留计数器。
    if ((await this.listRunIds()).length === 0) {
      try {
        await fs.rm(this.sequenceFile(), { force: true })
      } catch (error) {
        this.logger?.warn?.(`buka-workflows: 重置运行序号失败：${describeError(error)}`)
      }
    }
  }

  /**
   * 更新自动归档策略（页面保存设置后调用）。
   *
   * @param {{ enabled?: boolean, archiveAfterHours?: number, deleteAfterHours?: number } | undefined} retention
   */
  setRetention(retention) {
    this.retention = normalizeRetention(retention)
  }

  /**
   * 一次运行的目录。
   *
   * @param {string} runId
   * @returns {string}
   */
  runDirectory(runId) {
    return path.join(this.dir, runId)
  }

  /**
   * 序号计数器文件。
   *
   * @returns {string}
   */
  sequenceFile() {
    return path.join(this.dir, SEQUENCE_FILE)
  }

  /**
   * 分配下一个运行序号（从 1 开始）。计数器缺失时按现有运行的最大序号 +
   * 1 初始化；分配串行执行，避免并发创建拿到同一个号。
   *
   * @returns {Promise<number>}
   */
  allocateSeq() {
    const job = this.sequenceQueue.then(() => this.#allocateSeqOnce())
    this.sequenceQueue = job.catch(() => undefined)
    return job
  }

  /** @returns {Promise<number>} */
  async #allocateSeqOnce() {
    await fs.mkdir(this.dir, { recursive: true })
    const state = await this.#readSequence()
    const next = state === null ? await this.#nextSeqFromRuns() : state.next
    await this.#writeSequence(next + 1)
    return next
  }

  /**
   * 新建一次运行：写定义快照、状态快照与首条事件。
   *
   * @param {{ run: Record<string, any>, definition: unknown, plan?: unknown }} input
   * @returns {Promise<void>}
   */
  async create({ run, definition, plan }) {
    // 运行记录与定义快照都带上当前格式版本：启动时按它判断要不要丢弃。
    run.version = WORKFLOW_FORMAT_VERSION
    const directory = this.runDirectory(run.runId)
    await fs.mkdir(directory, { recursive: true })
    await writeJsonAtomic(path.join(directory, DEFINITION_FILE), {
      version: WORKFLOW_FORMAT_VERSION,
      runId: run.runId,
      createdAt: run.createdAt,
      createdBy: run.createdBy,
      goal: run.goal,
      definition,
      ...(plan === undefined ? {} : { plan }),
    })
    await writeJsonAtomic(path.join(directory, RUN_FILE), run)
    await this.appendEvent(run.runId, 'run/created', {
      goal: run.goal,
      ...(Number.isInteger(run.seq) ? { seq: run.seq } : {}),
      ...(run.createdBy === undefined ? {} : { createdBy: run.createdBy }),
    })
  }

  /**
   * 写状态快照。
   *
   * @param {Record<string, any>} run
   * @returns {Promise<void>}
   */
  async save(run) {
    await writeJsonAtomic(path.join(this.runDirectory(run.runId), RUN_FILE), run)
  }

  /**
   * 追加一条事件。
   *
   * @param {string} runId
   * @param {string} type
   * @param {Record<string, unknown>} [data]
   * @returns {Promise<void>}
   */
  async appendEvent(runId, type, data = {}) {
    const directory = this.runDirectory(runId)
    await fs.mkdir(directory, { recursive: true })
    const line = `${JSON.stringify({ time: Date.now(), type, data })}\n`
    await fs.appendFile(path.join(directory, EVENTS_FILE), line, { encoding: 'utf8', mode: 0o600 })
  }

  /**
   * 一次执行的节点目录：`nodes/<seq>-<nodeId>/`。
   *
   * `runId` / `nodeId` 必须是单段路径，`seq` 必须是正整数；调用方不能用路径
   * 片段逃出 `nodes/`。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @returns {string}
   */
  nodeDirectory(runId, seq, nodeId) {
    if (typeof runId !== 'string' || runId === '') throw new Error('runId is required')
    if (runId === '.' || runId === '..' || runId.includes('/') || runId.includes('\\')) {
      throw new Error('runId must be a single path segment')
    }
    if (!Number.isInteger(seq) || seq <= 0) throw new Error('seq must be a positive integer')
    if (typeof nodeId !== 'string' || nodeId === '') throw new Error('nodeId is required')
    if (nodeId === '.' || nodeId === '..' || nodeId.includes('/') || nodeId.includes('\\')) {
      throw new Error('nodeId must be a single path segment')
    }
    return path.join(this.runDirectory(runId), NODES_DIR, `${seq}-${nodeId}`)
  }

  /**
   * 保存一个节点结果全文。新记录写到节点目录的 `result.json`；旧记录中的
   * `nodes/<seq>-<nodeId>.json` 只读不删。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {Record<string, unknown>} payload
   * @returns {Promise<void>}
   */
  async saveNodeResult(runId, seq, nodeId, payload) {
    const directory = this.nodeDirectory(runId, seq, nodeId)
    await fs.mkdir(directory, { recursive: true })
    await writeJsonAtomic(path.join(directory, NODE_RESULT_FILE), {
      version: WORKFLOW_FORMAT_VERSION,
      runId,
      seq,
      nodeId,
      savedAt: Date.now(),
      ...payload,
    })
  }

  /**
   * 读取一次运行的状态快照。
   *
   * @param {string} runId
   * @returns {Promise<Record<string, any> | null>}
   */
  async readRun(runId) {
    if (typeof runId !== 'string' || runId === '') return null
    if (runId === SEQUENCE_FILE) return null
    try {
      const text = await fs.readFile(path.join(this.runDirectory(runId), RUN_FILE), 'utf8')
      const run = JSON.parse(text)
      if (typeof run?.runId !== 'string' || typeof run?.status !== 'string') return null
      return run
    } catch {
      return null
    }
  }

  /**
   * 读取一次运行的定义快照。
   *
   * @param {string} runId
   * @returns {Promise<Record<string, any> | null>}
   */
  async readDefinition(runId) {
    if (typeof runId !== 'string' || runId === '') return null
    try {
      const text = await fs.readFile(path.join(this.runDirectory(runId), DEFINITION_FILE), 'utf8')
      const value = JSON.parse(text)
      return value !== null && typeof value === 'object' ? value : null
    } catch {
      return null
    }
  }

  /**
   * 读取一次运行的全部节点结果，按 seq 升序。新目录布局与旧 JSON 文件同时
   * 扫描；同一 `seq:nodeId` 以新目录为准。
   *
   * @param {string} runId
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async readNodeResults(runId) {
    if (typeof runId !== 'string' || runId === '') return []
    const directory = path.join(this.runDirectory(runId), NODES_DIR)
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return []
    }
    /** @type {Map<string, Record<string, any>>} */
    const byKey = new Map()
    /** @param {Record<string, any>} value */
    const remember = (value) => {
      const key = `${String(value.seq ?? '')}:${String(value.nodeId ?? '')}`
      if (!byKey.has(key)) byKey.set(key, value)
    }
    // 先读新目录，保证同一执行同时存在旧文件时新记录优先。
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const value = await readJsonFile(path.join(directory, entry.name, NODE_RESULT_FILE))
      if (value !== null) remember(value)
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const value = await readJsonFile(path.join(directory, entry.name))
      if (value !== null) remember(value)
    }
    return [...byKey.values()].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
  }

  /**
   * 读取某一次执行的节点结果全文。优先新目录 `result.json`，找不到时回退
   * 旧版 `nodes/<seq>-<nodeId>.json`。文件缺失、损坏或参数不合法时返回 null。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @returns {Promise<Record<string, any> | null>}
   */
  async readNodeResult(runId, seq, nodeId) {
    let directory
    try {
      directory = this.nodeDirectory(runId, seq, nodeId)
    } catch {
      return null
    }
    const fresh = await readJsonFile(path.join(directory, NODE_RESULT_FILE))
    if (fresh !== null) return fresh
    return await readJsonFile(
      path.join(this.runDirectory(runId), NODES_DIR, `${seq}-${nodeId}.json`),
    )
  }

  /**
   * 把节点声明的附件复制到该次执行的节点目录，返回稳定清单。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {unknown} raw `structured_output.attachments`
   * @param {{ workspace?: string }} [options]
   * @returns {Promise<Array<{ index: number, name: string, bytes: number, description?: string }>>}
   */
  async writeNodeAttachments(runId, seq, nodeId, raw, options = {}) {
    const directory = this.nodeDirectory(runId, seq, nodeId)
    return await writeAttachments({
      raw,
      workspace: typeof options.workspace === 'string' ? options.workspace : '',
      runDirectory: this.runDirectory(runId),
      destination: path.join(directory, ATTACHMENTS_DIR),
      maxBytes: this.maxAttachmentBytes,
      maxTotalBytes: this.maxNodeAttachmentsBytes,
      maxCount: this.maxAttachmentsPerNode,
    })
  }

  /**
   * 把附件清单转成模板上下文：每个附件带绝对路径；文本附件在大小上限内
   * 额外带 `text` 供 prompt 内联。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {unknown} manifest
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async attachmentValues(runId, seq, nodeId, manifest) {
    if (!Array.isArray(manifest)) return []
    const directory = path.join(this.nodeDirectory(runId, seq, nodeId), ATTACHMENTS_DIR)
    /** @type {Array<Record<string, any>>} */
    const values = []
    for (const [fallbackIndex, entry] of manifest.entries()) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const name = typeof entry.name === 'string' ? entry.name : ''
      if (!isSafeAttachmentName(name)) continue
      const index = Number.isInteger(entry.index) ? entry.index : fallbackIndex
      const file = path.join(directory, name)
      /** @type {Record<string, any>} */
      const value = {
        index,
        name,
        bytes: Number.isFinite(entry.bytes) ? entry.bytes : 0,
        path: file,
      }
      if (typeof entry.description === 'string' && entry.description !== '') {
        value.description = entry.description
      }
      try {
        const inline = await readInlineText(file, this.maxInlineAttachmentBytes)
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
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {string} name
   * @param {{ offset?: number, maxBytes?: number }} [options]
   * @returns {Promise<Record<string, any> | null>}
   */
  async readAttachment(runId, seq, nodeId, name, options = {}) {
    const entry = await this.#attachmentEntry(runId, seq, nodeId, name)
    if (entry === null) return null
    const file = await this.#attachmentFilePath(runId, seq, nodeId, entry.name)
    const range = await readAttachmentRange(file, options)
    /** @type {Record<string, any>} */
    const value = {
      index: Number.isInteger(entry.index) ? entry.index : 0,
      name: entry.name,
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
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {string} name
   * @returns {Promise<{ path: string, name: string, bytes: number, description: string | null, index: number } | null>}
   */
  async openAttachment(runId, seq, nodeId, name) {
    const entry = await this.#attachmentEntry(runId, seq, nodeId, name)
    if (entry === null) return null
    const file = await this.#attachmentFilePath(runId, seq, nodeId, entry.name)
    const stat = await fs.stat(file)
    return {
      path: file,
      name: entry.name,
      bytes: stat.size,
      description: typeof entry.description === 'string' ? entry.description : null,
      index: Number.isInteger(entry.index) ? entry.index : 0,
    }
  }

  /**
   * 在节点结果的附件清单里按名字找一个附件。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {string} name
   * @returns {Promise<Record<string, any> | null>}
   */
  async #attachmentEntry(runId, seq, nodeId, name) {
    if (typeof name !== 'string' || !isSafeAttachmentName(name)) return null
    const result = await this.readNodeResult(runId, seq, nodeId)
    const manifest = Array.isArray(result?.attachments) ? result.attachments : []
    const entry = manifest.find((item) => item !== null && typeof item === 'object' && item.name === name)
    return entry ?? null
  }

  /**
   * 附件文件的真实路径；符号链接解析后必须仍在 attachments 目录内。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {string} name
   * @returns {Promise<string>}
   */
  async #attachmentFilePath(runId, seq, nodeId, name) {
    if (!isSafeAttachmentName(name)) throw new Error('invalid attachment name')
    const directory = path.join(this.nodeDirectory(runId, seq, nodeId), ATTACHMENTS_DIR)
    const realDirectory = await fs.realpath(directory)
    const realFile = await fs.realpath(path.join(directory, name))
    if (!isInsideDirectory(realDirectory, realFile)) {
      throw new Error(`attachment "${name}" is outside the node attachment directory`)
    }
    const stat = await fs.stat(realFile)
    if (!stat.isFile()) throw new Error(`attachment "${name}" is not a regular file`)
    return realFile
  }

  /**
   * 列出运行目录名（忽略序号计数器文件）。
   *
   * @returns {Promise<string[]>}
   */
  async listRunIds() {
    let entries
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== SEQUENCE_FILE)
  }

  /**
   * 最近的运行摘要，按创建时间倒序。默认只列未归档的运行；`archived: true`
   * 时只列已归档的运行（供页面的「查看已归档」用）。
   *
   * @param {number} [limit]
   * @param {{ archived?: boolean }} [options]
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async listRuns(limit = 20, options = {}) {
    const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20
    const archivedOnly = options.archived === true
    const runs = []
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      const archived = typeof run.archivedAt === 'number'
      if (archived !== archivedOnly) continue
      runs.push({
        runId: run.runId,
        seq: Number.isInteger(run.seq) && run.seq > 0 ? run.seq : null,
        goal: run.goal ?? '',
        status: run.status,
        createdAt: run.createdAt ?? null,
        finishedAt: run.finishedAt ?? null,
        archivedAt: archived ? run.archivedAt : null,
        lastNode: run.current?.nodeId ?? run.result?.lastNode ?? null,
        error: run.error ?? null,
        waitingForUser: Boolean(run.pendingInteraction),
      })
    }
    runs.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    return runs.slice(0, max)
  }

  /**
   * 已归档运行的条数：页面用它决定是否显示「查看已归档」入口。
   *
   * @returns {Promise<number>}
   */
  async countArchived() {
    let count = 0
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run !== null && typeof run.archivedAt === 'number') count += 1
    }
    return count
  }

  /**
   * 所有仍在进行（running / waiting）的运行，按创建时间升序。观察者启动恢复
   * 先用它，能恢复就继续跑，不能恢复再调用 `markInterrupted`。
   *
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async listUnfinished() {
    const runs = []
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      if (run.status !== 'running' && run.status !== 'waiting') continue
      runs.push(run)
    }
    runs.sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
    return runs
  }

  /**
   * 把一个无法恢复的进行中运行标成 interrupted，保留记录供回看。
   *
   * @param {string} runId
   * @param {string} reason
   * @returns {Promise<boolean>} 是否确实改了状态
   */
  async markInterrupted(runId, reason) {
    const run = await this.readRun(runId)
    if (run === null) return false
    if (run.status !== 'running' && run.status !== 'waiting') return false
    const now = Date.now()
    run.status = 'interrupted'
    run.updatedAt = now
    run.finishedAt = now
    run.current = null
    run.pendingGate = null
    run.pendingInteraction = null
    run.error = typeof reason === 'string' && reason !== '' ? reason : 'host restarted before this workflow finished'
    run.result = { status: 'interrupted', lastNode: run.result?.lastNode ?? null }
    try {
      await this.save(run)
      await this.appendEvent(runId, 'run/interrupted', { reason: run.error })
      return true
    } catch (error) {
      this.logger?.warn?.(`buka-workflows: 标记中断运行失败（${runId}）：${describeError(error)}`)
      return false
    }
  }

  /**
   * 把所有无法恢复的进行中运行标成 interrupted。观察者不可用（例如 robots
   * 服务缺失）时用它兜底。
   *
   * @param {string} reason
   * @returns {Promise<number>} 标成 interrupted 的运行数
   */
  async markAllInterrupted(reason) {
    let count = 0
    for (const run of await this.listUnfinished()) {
      if (await this.markInterrupted(run.runId, reason)) count += 1
    }
    return count
  }

  /**
   * 给没有序号的历史运行按创建时间回填编号，并把计数器推到最大值之后。
   * 只在启动时执行一次；已经有序号的记录保持原样。
   *
   * @returns {Promise<void>}
   */
  async backfillSeq() {
    const unnumbered = []
    let maxSeq = 0
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      if (Number.isInteger(run.seq) && run.seq > 0) {
        maxSeq = Math.max(maxSeq, run.seq)
        continue
      }
      unnumbered.push(run)
    }
    if (unnumbered.length === 0) {
      // 计数器丢了但运行还在：用现有最大序号重新初始化，避免下一次分配撞号。
      if (maxSeq > 0 && (await this.#readSequence()) === null) {
        await this.#writeSequence(maxSeq + 1)
      }
      return
    }
    const state = await this.#readSequence()
    let next = Math.max(maxSeq + 1, state?.next ?? 1)
    unnumbered.sort((left, right) => {
      const diff = ageAnchor(left, 0) - ageAnchor(right, 0)
      return diff !== 0 ? diff : String(left.runId).localeCompare(String(right.runId))
    })
    for (const run of unnumbered) {
      run.seq = next
      next += 1
      try {
        await this.save(run)
      } catch (error) {
        this.logger?.warn?.(`buka-workflows: 回填运行序号失败（${run.runId}）：${describeError(error)}`)
      }
    }
    await this.#writeSequence(next)
  }

  /**
   * 按自动归档设置处理所有运行：超删除时间的删目录，超归档时间的写
   * `archivedAt`；运行中（running / waiting）的记录永远跳过。关闭自动归档
   * 后不做按时间的归档 / 删除，但 `maxRuns` 上限仍然生效（只删已归档记录）。
   *
   * @param {{ now?: number }} [options] 测试注入的当前时间
   * @returns {Promise<void>}
   */
  sweep(options = {}) {
    const job = this.sweepQueue.then(() => this.#sweepOnce(options))
    this.sweepQueue = job.catch(() => undefined)
    return job
  }

  /**
   * 一次清扫的实际逻辑；只由 `sweep` 串行调用。
   *
   * @param {{ now?: number }} options
   * @returns {Promise<void>}
   */
  async #sweepOnce({ now = Date.now() } = {}) {
    const retention = this.retention
    /** @type {Array<{ runId: string, directory: string, run: Record<string, any> | null, anchor: number, active: boolean, deleted: boolean }>} */
    const entries = []
    for (const runId of await this.listRunIds()) {
      const directory = this.runDirectory(runId)
      let stat
      try {
        stat = await fs.stat(directory)
      } catch {
        // 目录在扫描期间消失，忽略。
        continue
      }
      const run = await this.readRun(runId)
      const active = run !== null && (run.status === 'running' || run.status === 'waiting')
      entries.push({ runId, directory, run, anchor: ageAnchor(run, stat.mtimeMs), active, deleted: false })
    }

    if (retention.enabled) {
      const archiveCutoff = now - retention.archiveAfterHours * HOUR_MS
      const deleteCutoff = now - retention.deleteAfterHours * HOUR_MS
      for (const entry of entries) {
        // 运行中的记录既不归档也不删除：它还没结束，计龄没有意义。
        if (entry.active) continue
        if (entry.anchor <= deleteCutoff) {
          await this.#removeRun(entry)
          continue
        }
        if (entry.run === null || typeof entry.run.archivedAt === 'number') continue
        if (entry.anchor > archiveCutoff) continue
        entry.run.archivedAt = now
        try {
          await this.save(entry.run)
          await this.appendEvent(entry.runId, 'run/archived', { archivedAt: now })
        } catch (error) {
          this.logger?.warn?.(`buka-workflows: 归档运行失败（${entry.runId}）：${describeError(error)}`)
        }
      }
    }

    await this.#pruneArchivedOverflow(entries)
  }

  /**
   * `maxRuns` 只限制已归档记录：超出时从最旧的已归档运行开始删除。未归档的
   * 运行（还在保留期内）不会被这个上限删掉。
   *
   * @param {Array<{ runId: string, directory: string, run: Record<string, any> | null, anchor: number, active: boolean, deleted: boolean }>} entries
   * @returns {Promise<void>}
   */
  async #pruneArchivedOverflow(entries) {
    const remaining = entries.filter((entry) => !entry.deleted)
    const overflow = remaining.length - this.maxRuns
    if (overflow <= 0) return
    const archived = remaining
      .filter((entry) => !entry.active && entry.run !== null && typeof entry.run.archivedAt === 'number')
      .sort((left, right) => left.anchor - right.anchor)
    for (const entry of archived.slice(0, overflow)) {
      await this.#removeRun(entry)
    }
  }

  /**
   * 删除一个运行目录；只允许删 runs 目录下的直接子目录，避免误删用户文件。
   *
   * @param {{ runId: string, directory: string, deleted: boolean }} entry
   * @returns {Promise<void>}
   */
  async #removeRun(entry) {
    if (entry.deleted) return
    if (!this.#isOwnRunDirectory(entry.directory)) return
    try {
      await fs.rm(entry.directory, { recursive: true, force: true })
      entry.deleted = true
    } catch (error) {
      this.logger?.warn?.(`buka-workflows: 清理旧运行失败（${entry.directory}）：${describeError(error)}`)
    }
  }

  /**
   * 读序号计数器；文件缺失 / 损坏 / 值不合法时返回 null，由调用方按现有运行
   * 推导下一个序号。
   *
   * @returns {Promise<{ next: number } | null>}
   */
  async #readSequence() {
    try {
      const text = await fs.readFile(this.sequenceFile(), 'utf8')
      const value = JSON.parse(text)
      if (!Number.isInteger(value?.next) || value.next < 1) return null
      return { next: value.next }
    } catch {
      return null
    }
  }

  /**
   * 写序号计数器。
   *
   * @param {number} next
   * @returns {Promise<void>}
   */
  async #writeSequence(next) {
    await writeJsonAtomic(this.sequenceFile(), { version: WORKFLOW_FORMAT_VERSION, next })
  }

  /**
   * 从现有运行推导下一个序号：最大 seq + 1（没有记录时从 1 开始）。
   *
   * @returns {Promise<number>}
   */
  async #nextSeqFromRuns() {
    let maxSeq = 0
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run !== null && Number.isInteger(run.seq) && run.seq > maxSeq) maxSeq = run.seq
    }
    return maxSeq + 1
  }

  /**
   * 只允许删除 runsDir 下的直接子目录，避免误删用户文件。
   *
   * @param {string} directory
   * @returns {boolean}
   */
  #isOwnRunDirectory(directory) {
    const resolved = path.resolve(directory)
    return resolved.startsWith(`${this.dir}${path.sep}`) && resolved !== this.dir
  }
}
