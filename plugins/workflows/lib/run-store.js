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
 *   nodes/<seq>-<id>.json  节点结果全文（run.json 里只留预览）
 * ```
 *
 * 每次运行有一个持久递增的序号 `seq`（从 1 开始，写在 run.json 里）：删除旧
 * 运行不会让编号回退；启动时会给没有序号的旧记录按创建时间回填，再把计数器
 * 推到最大值之后。序号只用于展示与引用，不影响执行。
 *
 * 工作流不做断点续跑：宿主启动时把 `running` / `waiting` 的运行标成
 * `interrupted`，保留记录供回看。结束的运行按自动归档设置处理：超过归档
 * 时间的运行写上 `archivedAt` 并从默认列表隐藏；超过删除时间的运行目录直接
 * 删除。仍在运行的记录永远不会被归档或删除；`maxRuns` 只限制已归档记录的
 * 数量（从最旧的已归档运行开始删）。
 *
 * @module @buka/dsh-plugin-workflows/run-store
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { normalizeRetention } from './settings.js'

/** 状态快照文件名。 */
export const RUN_FILE = 'run.json'

/** 定义快照文件名。 */
export const DEFINITION_FILE = 'definition.json'

/** 事件流文件名。 */
export const EVENTS_FILE = 'events.jsonl'

/** 节点结果目录名。 */
export const NODES_DIR = 'nodes'

/** 运行序号计数器文件名；放在 runs 目录里，但不是运行目录。 */
export const SEQUENCE_FILE = 'sequence.json'

/** 当前存储格式版本。 */
export const STORE_VERSION = 1

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
 * 运行记录存储。
 */
export class WorkflowRunStore {
  /**
   * @param {{
   *   dir: string,
   *   maxRuns?: number,
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
   * 建目录、恢复上次未结束的运行、回填序号、按自动归档设置清理；幂等。
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
    await this.recover()
    await this.backfillSeq()
    await this.sweep()
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
    const directory = this.runDirectory(run.runId)
    await fs.mkdir(directory, { recursive: true })
    await writeJsonAtomic(path.join(directory, DEFINITION_FILE), {
      version: STORE_VERSION,
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
   * 保存一个节点结果全文。
   *
   * @param {string} runId
   * @param {number} seq
   * @param {string} nodeId
   * @param {Record<string, unknown>} payload
   * @returns {Promise<void>}
   */
  async saveNodeResult(runId, seq, nodeId, payload) {
    const file = path.join(this.runDirectory(runId), NODES_DIR, `${seq}-${nodeId}.json`)
    await writeJsonAtomic(file, {
      version: STORE_VERSION,
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
   * 读取一次运行的全部节点结果，按 seq 升序。
   *
   * @param {string} runId
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async readNodeResults(runId) {
    if (typeof runId !== 'string' || runId === '') return []
    const directory = path.join(this.runDirectory(runId), NODES_DIR)
    let names
    try {
      names = await fs.readdir(directory)
    } catch {
      return []
    }
    const results = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const text = await fs.readFile(path.join(directory, name), 'utf8')
        const value = JSON.parse(text)
        if (value !== null && typeof value === 'object') results.push(value)
      } catch {
        // 坏文件跳过，不影响其他节点。
      }
    }
    results.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    return results
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
   * 把上次进程遗留的进行中运行标成 interrupted。
   *
   * @returns {Promise<void>}
   */
  async recover() {
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      if (run.status !== 'running' && run.status !== 'waiting') continue
      const now = Date.now()
      run.status = 'interrupted'
      run.updatedAt = now
      run.finishedAt = now
      run.current = null
      run.pendingGate = null
      run.error = 'host restarted before this workflow finished'
      run.result = { status: 'interrupted', lastNode: run.result?.lastNode ?? null }
      try {
        await this.save(run)
        await this.appendEvent(runId, 'run/interrupted', { reason: run.error })
      } catch (error) {
        this.logger?.warn?.(`buka-workflows: 标记中断运行失败（${runId}）：${describeError(error)}`)
      }
    }
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
    await writeJsonAtomic(this.sequenceFile(), { version: STORE_VERSION, next })
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
