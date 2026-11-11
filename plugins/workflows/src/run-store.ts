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
 *   events.jsonl     追加事件：node/start、node/end、user/answered、run/end …
 *   nodes/<seq>-<id>/
 *     result.json       节点结果全文（run.json 里只留预览；机器人会话的只读
 *                       工具从这里读某次执行的 prompt / 输出）
 *     attachments/      该次执行的附件文件
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

import { readJsonFile, writeJsonAtomic } from '@buka/plugin-kit'
import type { AttachmentManifestEntry } from './attachments.ts'
import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_MAX_ATTACHMENTS_PER_NODE,
  DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
  DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
} from './attachments.ts'
import type { OpenedAttachment } from './run-attachments.ts'
import {
  ATTACHMENTS_DIR,
  attachmentTemplateValues,
  openRunAttachment,
  readRunAttachment,
  writeNodeAttachmentsToRun,
} from './run-attachments.ts'
import type { ArchiveRetention } from './settings.ts'
import { normalizeRetention } from './settings.ts'

/** 运行记录里的一次节点执行（`run.steps` 的一项）。 */
export interface WorkflowStep {
  [key: string]: unknown
  seq?: number | undefined
  nodeId?: string | undefined
  visit?: number | undefined
  type?: string | undefined
  robot?: string | null | undefined
  sessionId?: string | null | undefined
  mode?: 'plan' | undefined
  status?: string | undefined
  stopReason?: string | undefined
  aborted?: boolean | undefined
  route?: string | null | undefined
  routeTo?: string | null | undefined
  routes?: Array<{ name?: string | null; to?: string | null }> | undefined
  answers?: unknown | undefined
  input?: string | undefined
  startedAt?: number | undefined
  finishedAt?: number | undefined
  text?: string | undefined
  textTruncated?: boolean | undefined
  data?: unknown | undefined
  error?: string | null | undefined
  attachments?: AttachmentManifestEntry[] | undefined
  resumed?: boolean | undefined
  compacted?: boolean | undefined
  compactionError?: string | undefined
  sessionResetReason?: string | undefined
  recovered?: boolean | undefined
  recoveryAttempts?: number | undefined
  timedOut?: boolean | undefined
}

/** `run.active` 里的一次活跃执行。 */
export interface WorkflowActiveNode {
  [key: string]: unknown
  nodeId?: string | undefined
  seq?: number | undefined
  visit?: number | undefined
  type?: string | undefined
  robot?: string | undefined
  prompt?: string | undefined
  sessionId?: string | null | undefined
  startSeq?: number | null | undefined
  startedAt?: number | undefined
  attempt?: number | undefined
  recoveryAttempts?: number | undefined
  mode?: 'plan' | undefined
  timeoutMs?: number | undefined
  timeoutStartedAt?: number | undefined
  resumed?: boolean | undefined
  compacted?: boolean | undefined
  recovering?: boolean | undefined
  recovered?: boolean | undefined
  sessionResetReason?: string | undefined
  compactionError?: string | undefined
}

/** `run.sessions` 里每个机器人的会话摘要。 */
export interface WorkflowRobotSession {
  [key: string]: unknown
  robot: string
  sessionId?: string | undefined
  firstNodeId?: string | undefined
  lastNodeId?: string | undefined
  lastVisit?: number | undefined
  visits?: number | undefined
  resets?: number | undefined
  createdAt?: number | undefined
  updatedAt?: number | undefined
  entries?: Array<{
    nodeId?: string
    visit?: number
    seq?: number
    sessionId?: string | null
    at?: number
    resumed?: boolean
    compacted?: boolean
  }>
}

/** `run.result`。 */
export interface WorkflowRunResult {
  [key: string]: unknown
  status?: string | undefined
  lastNode?: string | null | undefined
  message?: string | undefined
  aborted?: boolean | undefined
  error?: string | undefined
}

/** `run.pendingUser`：等待用户作答的用户节点快照。 */
export interface WorkflowPendingUser {
  [key: string]: unknown
  nodeId?: string | undefined
  visit?: number | undefined
  seq?: number | undefined
  title?: unknown | undefined
  detail?: unknown | undefined
  options?: unknown[] | undefined
  questions?: unknown[] | undefined
  requestedAt?: number | undefined
  sessionId?: string | null | undefined
}

/** `run.pendingInteraction`：机器人会话正在等待的提问 / 审批。 */
export interface WorkflowPendingInteraction {
  [key: string]: unknown
  id?: string | undefined
  kind?: string | undefined
  nodeId?: string | undefined
  visit?: number | undefined
  seq?: number | undefined
  robot?: string | null | undefined
  sessionId?: string | null | undefined
  askedAt?: number | undefined
  planReview?: boolean | undefined
  questions?: unknown[] | undefined
  toolName?: string | undefined
  reason?: string | undefined
  displayReason?: string | undefined
  callId?: string | undefined
}

/** 运行记录（run.json）。 */
export interface WorkflowRunRecord {
  [key: string]: unknown
  runId: string
  version?: number | undefined
  seq?: number | undefined
  goal?: string | undefined
  status?: string | undefined
  createdAt?: number | undefined
  updatedAt?: number | undefined
  finishedAt?: number | null | undefined
  archivedAt?: number | undefined
  createdBy?: Record<string, unknown> | undefined
  current?: WorkflowActiveNode | null | undefined
  active: WorkflowActiveNode[]
  pendingUser?: WorkflowPendingUser | null | undefined
  pendingInteraction?: WorkflowPendingInteraction | null | undefined
  steps: WorkflowStep[]
  sessions?: WorkflowRobotSession[] | undefined
  result?: WorkflowRunResult | null | undefined
  error?: string | null | undefined
}

export type { OpenedAttachment } from './run-attachments.ts'

/** 清扫时对一次运行的快照。 */
interface SweepEntry {
  runId: string
  directory: string
  run: WorkflowRunRecord | null
  anchor: number
  active: boolean
  deleted: boolean
}

/** 运行存储的构造参数。 */
export interface WorkflowRunStoreOptions {
  dir: string
  maxRuns?: number | undefined
  maxAttachmentBytes?: number | undefined
  maxAttachmentsPerNode?: number | undefined
  maxNodeAttachmentsBytes?: number | undefined
  maxInlineAttachmentBytes?: number | undefined
  retention?: unknown | undefined
  logger?: {
    readonly warn?: (message: string) => void
    readonly info?: (message: string) => void
  }
}

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

export { ATTACHMENTS_DIR }

/** 运行序号计数器文件名；放在 runs 目录里，但不是运行目录。 */
export const SEQUENCE_FILE = 'sequence.json'

/**
 * 当前运行数据格式版本。启动时会把版本不符（或 run.json / definition.json
 * 缺失、损坏）的运行目录整个删掉：旧格式没有迁移路径。
 */
export const WORKFLOW_FORMAT_VERSION = 3

/** 一个小时的毫秒数：归档设置的时间单位。 */
const HOUR_MS = 60 * 60 * 1000

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
 * 判断一条运行记录是否与当前格式不兼容；兼容时返回 null，否则返回原因。
 *
 * @param run 运行记录
 * @param definition 定义快照
 * @returns 不兼容时是原因，否则 `null`
 */
function incompatibleReason(
  run: Record<string, unknown> | null,
  definition: Record<string, unknown> | null,
): string | null {
  if (run === null) return 'run.json 缺失或损坏'
  if (run.version !== WORKFLOW_FORMAT_VERSION) return `run.json 版本为 ${String(run.version)}`
  if (definition === null) return 'definition.json 缺失或损坏'
  if (definition.version !== WORKFLOW_FORMAT_VERSION)
    return `definition.json 版本为 ${String(definition.version)}`
  return null
}

/**
 * 按 UTF-8 字节数截断文本，避免把一个多字节字符切成两半。
 *
 * @param text 原文
 * @param maxBytes 字节上限
 * @returns 截断后的文本与是否截断
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
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
 * @param run 运行记录
 * @param fallback 记录缺失时使用的计龄时间
 * @returns 计龄基准时间
 */
function ageAnchor(run: Record<string, unknown> | null, fallback: number): number {
  for (const value of [run?.finishedAt, run?.updatedAt, run?.createdAt]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

/**
 * 正整数选项或默认值。
 *
 * @param value 待校验的值
 * @param fallback 不合法时使用的默认值
 * @returns 正整数或默认值
 */
function positiveOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * 运行记录存储。
 */
export class WorkflowRunStore {
  /** 运行记录根目录（绝对路径）。 */
  declare readonly dir: string
  /** 已归档记录的数量上限。 */
  declare maxRuns: number
  /** 单个附件大小上限。 */
  declare maxAttachmentBytes: number
  /** 每次执行的附件数量上限。 */
  declare maxAttachmentsPerNode: number
  /** 每次执行的附件总量上限。 */
  declare maxNodeAttachmentsBytes: number
  /** 单个文本附件内联上限。 */
  declare maxInlineAttachmentBytes: number
  /** 自动归档策略。 */
  declare retention: ArchiveRetention
  /** 可选日志器。 */
  declare logger: WorkflowRunStoreOptions['logger']
  /** 初始化 promise；初始化只跑一次。 */
  declare ready: Promise<void> | null
  /** 序号分配串行化队列。 */
  declare sequenceQueue: Promise<unknown>
  /** 清扫串行化队列。 */
  declare sweepQueue: Promise<unknown>

  constructor(options: WorkflowRunStoreOptions) {
    if (typeof options?.dir !== 'string' || options.dir.trim() === '') {
      throw new Error('WorkflowRunStore requires a runs directory')
    }
    this.dir = path.resolve(options.dir)
    this.maxRuns =
      typeof options.maxRuns === 'number' &&
      Number.isInteger(options.maxRuns) &&
      options.maxRuns > 0
        ? options.maxRuns
        : 200
    this.maxAttachmentBytes = positiveOption(
      options.maxAttachmentBytes,
      DEFAULT_MAX_ATTACHMENT_BYTES,
    )
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
    // 序号分配串行化：并发创建工作流时不能读到同一个「下一个序号」。
    this.sequenceQueue = Promise.resolve()
    // 清扫串行化：定时器与「保存设置后立即清扫」可能撞在一起。
    this.sweepQueue = Promise.resolve()
  }

  /**
   * 建目录、删掉格式不兼容的旧运行、回填序号、按自动归档设置清理；未完成
   * 运行交给观察者恢复。
   *
   * @returns 初始化完成的 promise
   */
  async init(): Promise<void> {
    this.ready ??= this.#initialize()
    return await this.ready
  }

  /** @returns 初始化完成的 promise */
  async #initialize(): Promise<void> {
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
   * @returns 无返回值
   */
  async #purgeIncompatibleRuns(): Promise<void> {
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
        this.logger?.warn?.(
          `buka-workflows: 删除格式不兼容的运行记录失败（${runId}）：${describeError(error)}`,
        )
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
   * @param retention 新的归档策略
   */
  setRetention(retention: unknown): void {
    this.retention = normalizeRetention(retention)
  }

  /**
   * 一次运行的目录。
   *
   * @param runId 运行 id
   * @returns 运行目录
   */
  runDirectory(runId: string): string {
    return path.join(this.dir, runId)
  }

  /**
   * 序号计数器文件。
   *
   * @returns 序号计数器文件
   */
  sequenceFile(): string {
    return path.join(this.dir, SEQUENCE_FILE)
  }

  /**
   * 分配下一个运行序号（从 1 开始）。计数器缺失时按现有运行的最大序号 +
   * 1 初始化；分配串行执行，避免并发创建拿到同一个号。
   *
   * @returns 下一个运行序号
   */
  allocateSeq(): Promise<number> {
    const job = this.sequenceQueue.then(() => this.#allocateSeqOnce())
    this.sequenceQueue = job.catch(() => undefined)
    return job
  }

  /** @returns 下一个运行序号 */
  async #allocateSeqOnce(): Promise<number> {
    await fs.mkdir(this.dir, { recursive: true })
    const state = await this.#readSequence()
    const next = state === null ? await this.#nextSeqFromRuns() : state.next
    await this.#writeSequence(next + 1)
    return next
  }

  /**
   * 新建一次运行：写定义快照、状态快照与首条事件。
   *
   * @param input 运行记录、定义快照与可选计划
   */
  async create({
    run,
    definition,
    plan,
  }: {
    run: WorkflowRunRecord
    definition: unknown
    plan?: unknown
  }): Promise<void> {
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
   * @param run 运行记录
   */
  async save(run: WorkflowRunRecord): Promise<void> {
    await writeJsonAtomic(path.join(this.runDirectory(run.runId), RUN_FILE), run)
  }

  /**
   * 追加一条事件。
   *
   * @param runId 运行 id
   * @param type 事件类型
   * @param data 事件数据
   */
  async appendEvent(
    runId: string,
    type: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
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
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @returns 节点目录
   */
  nodeDirectory(runId: string, seq: number, nodeId: string): string {
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
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @param payload 节点结果
   */
  async saveNodeResult(
    runId: string,
    seq: number,
    nodeId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
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
   * @param runId 运行 id
   * @returns 运行记录；缺失 / 损坏时是 `null`
   */
  async readRun(runId: string): Promise<WorkflowRunRecord | null> {
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
   * @param runId 运行 id
   * @returns 定义快照；缺失 / 损坏时是 `null`
   */
  async readDefinition(runId: string): Promise<Record<string, unknown> | null> {
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
   * @param runId 运行 id
   * @returns 全部节点结果，按 seq 升序
   */
  async readNodeResults(runId: string): Promise<Array<Record<string, unknown>>> {
    if (typeof runId !== 'string' || runId === '') return []
    const directory = path.join(this.runDirectory(runId), NODES_DIR)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return []
    }
    const byKey = new Map<string, Record<string, unknown>>()
    /** @param value 一条节点结果 */
    const remember = (value: Record<string, unknown>): void => {
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
    return [...byKey.values()].sort(
      (left, right) =>
        ((left.seq as number | undefined) ?? 0) - ((right.seq as number | undefined) ?? 0),
    )
  }

  /**
   * 读取某一次执行的节点结果全文。优先新目录 `result.json`，找不到时回退
   * 旧版 `nodes/<seq>-<nodeId>.json`。文件缺失、损坏或参数不合法时返回 null。
   *
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @returns 节点结果；缺失 / 参数不合法时是 `null`
   */
  async readNodeResult(
    runId: string,
    seq: number,
    nodeId: string,
  ): Promise<Record<string, unknown> | null> {
    let directory: string
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
   * 把节点返回的附件复制到该次执行的节点目录，返回稳定清单。
   *
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @param raw `structured_output.attachments`
   * @param options 机器人工作区
   * @returns 稳定清单
   */
  async writeNodeAttachments(
    runId: string,
    seq: number,
    nodeId: string,
    raw: unknown,
    options: { workspace?: string | undefined } = {},
  ): Promise<AttachmentManifestEntry[]> {
    return await writeNodeAttachmentsToRun({
      runDirectory: this.runDirectory(runId),
      nodeDirectory: this.nodeDirectory(runId, seq, nodeId),
      raw,
      workspace: typeof options.workspace === 'string' ? options.workspace : '',
      maxBytes: this.maxAttachmentBytes,
      maxTotalBytes: this.maxNodeAttachmentsBytes,
      maxCount: this.maxAttachmentsPerNode,
    })
  }

  /**
   * 把附件清单转成模板上下文：每个附件带绝对路径；文本附件在大小上限内
   * 额外带 `text` 供 prompt 内联。
   *
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @param manifest 附件清单
   * @returns 模板上下文里的附件值
   */
  async attachmentValues(
    runId: string,
    seq: number,
    nodeId: string,
    manifest: unknown,
  ): Promise<Array<Record<string, unknown>>> {
    return await attachmentTemplateValues({
      attachmentsDirectory: path.join(this.nodeDirectory(runId, seq, nodeId), ATTACHMENTS_DIR),
      manifest,
      maxInlineTextBytes: this.maxInlineAttachmentBytes,
    })
  }

  /**
   * 读取一个附件的一段内容。`name` 必须出现在该次执行的清单里。
   *
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @param name 附件名
   * @param options 起始偏移与读取字节数
   * @returns 附件的一段内容；找不到时是 `null`
   */
  async readAttachment(
    runId: string,
    seq: number,
    nodeId: string,
    name: string,
    options: { offset?: number | undefined; maxBytes?: number | undefined } = {},
  ): Promise<Record<string, unknown> | null> {
    return await readRunAttachment({
      nodeResult: await this.readNodeResult(runId, seq, nodeId),
      nodeDirectory: this.nodeDirectory(runId, seq, nodeId),
      name,
      offset: options.offset,
      maxBytes: options.maxBytes,
    })
  }

  /**
   * 打开一个附件用于下载：只返回清单里的文件，并确认它仍在附件目录内。
   *
   * @param runId 运行 id
   * @param seq 执行序号
   * @param nodeId 节点 id
   * @param name 附件名
   * @returns 可下载附件；找不到时是 `null`
   */
  async openAttachment(
    runId: string,
    seq: number,
    nodeId: string,
    name: string,
  ): Promise<OpenedAttachment | null> {
    return await openRunAttachment({
      nodeResult: await this.readNodeResult(runId, seq, nodeId),
      nodeDirectory: this.nodeDirectory(runId, seq, nodeId),
      name,
    })
  }

  /**
   * 列出运行目录名（忽略序号计数器文件）。
   *
   * @returns 运行目录名
   */
  async listRunIds(): Promise<string[]> {
    let entries: import('node:fs').Dirent[]
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
   * @param limit 最多返回多少条
   * @param options 是否只看已归档
   * @returns 运行摘要
   */
  async listRuns(
    limit = 20,
    options: { archived?: boolean | undefined } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20
    const archivedOnly = options.archived === true
    const runs: Array<Record<string, unknown>> = []
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      const archived = typeof run.archivedAt === 'number'
      if (archived !== archivedOnly) continue
      runs.push({
        runId: run.runId,
        seq:
          typeof run.seq === 'number' && Number.isInteger(run.seq) && run.seq > 0 ? run.seq : null,
        goal: run.goal ?? '',
        status: run.status,
        createdAt: run.createdAt ?? null,
        finishedAt: run.finishedAt ?? null,
        archivedAt: archived ? (run.archivedAt as number) : null,
        lastNode: run.active?.[0]?.nodeId ?? run.current?.nodeId ?? run.result?.lastNode ?? null,
        error: run.error ?? null,
        waitingForUser: Boolean(run.pendingInteraction || run.pendingUser),
      })
    }
    runs.sort(
      (left, right) =>
        ((right.createdAt as number | undefined) ?? 0) -
        ((left.createdAt as number | undefined) ?? 0),
    )
    return runs.slice(0, max)
  }

  /**
   * 已归档运行的条数：页面用它决定是否显示「查看已归档」入口。
   *
   * @returns 已归档运行条数
   */
  async countArchived(): Promise<number> {
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
   * @returns 未完成的运行，按创建时间升序
   */
  async listUnfinished(): Promise<WorkflowRunRecord[]> {
    const runs: WorkflowRunRecord[] = []
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      if (run.status !== 'running' && run.status !== 'waiting') continue
      runs.push(run)
    }
    runs.sort(
      (left, right) =>
        ((left.createdAt as number | undefined) ?? 0) -
        ((right.createdAt as number | undefined) ?? 0),
    )
    return runs
  }

  /**
   * 把一个无法恢复的进行中运行标成 interrupted，保留记录供回看。
   *
   * @param runId 运行 id
   * @param reason 中断原因
   * @returns 是否确实改了状态
   */
  async markInterrupted(runId: string, reason: string): Promise<boolean> {
    const run = await this.readRun(runId)
    if (run === null) return false
    if (run.status !== 'running' && run.status !== 'waiting') return false
    const now = Date.now()
    run.status = 'interrupted'
    run.updatedAt = now
    run.finishedAt = now
    run.current = null
    run.active = []
    run.pendingUser = null
    run.pendingInteraction = null
    run.error =
      typeof reason === 'string' && reason !== ''
        ? reason
        : 'host restarted before this workflow finished'
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
   * @param reason 中断原因
   * @returns 标成 interrupted 的运行数
   */
  async markAllInterrupted(reason: string): Promise<number> {
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
   * @returns 无返回值
   */
  async backfillSeq(): Promise<void> {
    const unnumbered: WorkflowRunRecord[] = []
    let maxSeq = 0
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      if (typeof run.seq === 'number' && Number.isInteger(run.seq) && run.seq > 0) {
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
        this.logger?.warn?.(
          `buka-workflows: 回填运行序号失败（${run.runId}）：${describeError(error)}`,
        )
      }
    }
    await this.#writeSequence(next)
  }

  /**
   * 按自动归档设置处理所有运行：超删除时间的删目录，超归档时间的写
   * `archivedAt`；运行中（running / waiting）的记录永远跳过。关闭自动归档
   * 后不做按时间的归档 / 删除，但 `maxRuns` 上限仍然生效（只删已归档记录）。
   *
   * @param options 测试注入的当前时间
   * @returns 清扫完成的 promise
   */
  sweep(options: { now?: number | undefined } = {}): Promise<void> {
    const job = this.sweepQueue.then(() => this.#sweepOnce(options))
    this.sweepQueue = job.catch(() => undefined)
    return job
  }

  /**
   * 一次清扫的实际逻辑；只由 `sweep` 串行调用。
   *
   * @param options 测试注入的当前时间
   * @returns 无返回值
   */
  async #sweepOnce({ now = Date.now() }: { now?: number | undefined } = {}): Promise<void> {
    const retention = this.retention
    const entries: SweepEntry[] = []
    for (const runId of await this.listRunIds()) {
      const directory = this.runDirectory(runId)
      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(directory)
      } catch {
        // 目录在扫描期间消失，忽略。
        continue
      }
      const run = await this.readRun(runId)
      const active = run !== null && (run.status === 'running' || run.status === 'waiting')
      entries.push({
        runId,
        directory,
        run,
        anchor: ageAnchor(run, stat.mtimeMs),
        active,
        deleted: false,
      })
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
          this.logger?.warn?.(
            `buka-workflows: 归档运行失败（${entry.runId}）：${describeError(error)}`,
          )
        }
      }
    }

    await this.#pruneArchivedOverflow(entries)
  }

  /**
   * `maxRuns` 只限制已归档记录：超出时从最旧的已归档运行开始删除。未归档的
   * 运行（还在保留期内）不会被这个上限删掉。
   *
   * @param entries 本次清扫的运行快照
   * @returns 无返回值
   */
  async #pruneArchivedOverflow(entries: SweepEntry[]): Promise<void> {
    const remaining = entries.filter((entry) => !entry.deleted)
    const overflow = remaining.length - this.maxRuns
    if (overflow <= 0) return
    const archived = remaining
      .filter(
        (entry) => !entry.active && entry.run !== null && typeof entry.run.archivedAt === 'number',
      )
      .sort((left, right) => left.anchor - right.anchor)
    for (const entry of archived.slice(0, overflow)) {
      await this.#removeRun(entry)
    }
  }

  /**
   * 删除一个运行目录；只允许删 runs 目录下的直接子目录，避免误删用户文件。
   *
   * @param entry 要删除的运行快照
   * @returns 无返回值
   */
  async #removeRun(entry: SweepEntry): Promise<void> {
    if (entry.deleted) return
    if (!this.#isOwnRunDirectory(entry.directory)) return
    try {
      await fs.rm(entry.directory, { recursive: true, force: true })
      entry.deleted = true
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: 清理旧运行失败（${entry.directory}）：${describeError(error)}`,
      )
    }
  }

  /**
   * 读序号计数器；文件缺失 / 损坏 / 值不合法时返回 null，由调用方按现有运行
   * 推导下一个序号。
   *
   * @returns 计数器内容；缺失 / 损坏时是 `null`
   */
  async #readSequence(): Promise<{ next: number } | null> {
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
   * @param next 下一个序号
   * @returns 无返回值
   */
  async #writeSequence(next: number): Promise<void> {
    await writeJsonAtomic(this.sequenceFile(), { version: WORKFLOW_FORMAT_VERSION, next })
  }

  /**
   * 从现有运行推导下一个序号：最大 seq + 1（没有记录时从 1 开始）。
   *
   * @returns 下一个序号
   */
  async #nextSeqFromRuns(): Promise<number> {
    let maxSeq = 0
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (
        run !== null &&
        typeof run.seq === 'number' &&
        Number.isInteger(run.seq) &&
        run.seq > maxSeq
      ) {
        maxSeq = run.seq
      }
    }
    return maxSeq + 1
  }

  /**
   * 只允许删除 runsDir 下的直接子目录，避免误删用户文件。
   *
   * @param directory 目录路径
   * @returns 是 runsDir 的直接子目录时为 true
   */
  #isOwnRunDirectory(directory: string): boolean {
    const resolved = path.resolve(directory)
    return resolved.startsWith(`${this.dir}${path.sep}`) && resolved !== this.dir
  }
}
