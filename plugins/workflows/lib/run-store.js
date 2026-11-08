/**
 * 工作流运行的落盘存储。
 *
 * 每次运行占一个目录，内容如下：
 *
 * ```text
 * runs/<runId>/
 *   definition.json  本次一次性定义的快照（goal、节点、创建者、时间）
 *   run.json         权威状态快照：原子写（临时文件 + rename）
 *   events.jsonl     追加事件：node/start、node/end、gate/decided、run/end …
 *   nodes/<seq>-<id>.json  节点结果全文（run.json 里只留预览）
 * ```
 *
 * 工作流不做断点续跑：宿主启动时把 `running` / `waiting` 的运行标成
 * `interrupted`，保留记录供回看。超过保留策略的旧目录在启动时清理。
 *
 * @module @buka/dsh-plugin-workflows/run-store
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 状态快照文件名。 */
export const RUN_FILE = 'run.json'

/** 定义快照文件名。 */
export const DEFINITION_FILE = 'definition.json'

/** 事件流文件名。 */
export const EVENTS_FILE = 'events.jsonl'

/** 节点结果目录名。 */
export const NODES_DIR = 'nodes'

/** 当前存储格式版本。 */
export const STORE_VERSION = 1

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
 * 运行记录存储。
 */
export class WorkflowRunStore {
  /**
   * @param {{
   *   dir: string,
   *   maxRuns?: number,
   *   maxAgeDays?: number,
   *   logger?: { warn?: (message: string) => void },
   * }} options
   */
  constructor(options) {
    if (typeof options?.dir !== 'string' || options.dir.trim() === '') {
      throw new Error('WorkflowRunStore requires a runs directory')
    }
    this.dir = path.resolve(options.dir)
    this.maxRuns = Number.isInteger(options.maxRuns) && options.maxRuns > 0 ? options.maxRuns : 200
    this.maxAgeDays = Number.isFinite(options.maxAgeDays) && options.maxAgeDays > 0 ? options.maxAgeDays : 30
    this.logger = options.logger
    /** @type {Promise<void> | null} */
    this.ready = null
  }

  /**
   * 建目录、恢复上次未结束的运行、按保留策略清理；幂等。
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
    await this.prune()
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
   * 列出运行目录名。
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
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  }

  /**
   * 最近的运行摘要，按创建时间倒序。
   *
   * @param {number} [limit]
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async listRuns(limit = 20) {
    const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20
    const runs = []
    for (const runId of await this.listRunIds()) {
      const run = await this.readRun(runId)
      if (run === null) continue
      runs.push({
        runId: run.runId,
        goal: run.goal ?? '',
        status: run.status,
        createdAt: run.createdAt ?? null,
        finishedAt: run.finishedAt ?? null,
        lastNode: run.current?.nodeId ?? run.result?.lastNode ?? null,
        error: run.error ?? null,
      })
    }
    runs.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    return runs.slice(0, max)
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
   * 按保留策略清理旧运行目录。
   *
   * @returns {Promise<void>}
   */
  async prune() {
    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000
    const entries = []
    for (const runId of await this.listRunIds()) {
      const directory = this.runDirectory(runId)
      try {
        const stat = await fs.stat(directory)
        entries.push({ directory, mtimeMs: stat.mtimeMs })
      } catch {
        // 目录在扫描期间消失，忽略。
      }
    }
    entries.sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const [index, entry] of entries.entries()) {
      if (index < this.maxRuns && entry.mtimeMs >= cutoff) continue
      if (!this.#isOwnRunDirectory(entry.directory)) continue
      try {
        await fs.rm(entry.directory, { recursive: true, force: true })
      } catch (error) {
        this.logger?.warn?.(`buka-workflows: 清理旧运行失败（${entry.directory}）：${describeError(error)}`)
      }
    }
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
