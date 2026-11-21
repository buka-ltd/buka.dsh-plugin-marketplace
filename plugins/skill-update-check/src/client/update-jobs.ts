/**
 * 后台更新任务的状态机（不依赖浏览器 API，`node --test` 可以直接 import）。
 *
 * 更新请求挂在页面级实例上，而不是弹窗的组件 state：关掉弹窗、切换会话都不会
 * 取消它。提示条与弹窗订阅同一份状态，所以点完更新可以立刻关掉弹窗；更新结束
 * 后把 Host 返回的新快照交给订阅者，计数随之刷新。
 *
 * 同一会话同时只允许一个任务：Host 本来就会串行执行 `skills update`，这里再挡
 * 一道，避免重复点击产生多余请求。整次请求失败时保留原来的列表，失败原因留给
 * 弹窗展示。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/update-jobs
 */

import type { SkillUpdateFailureItem, SkillUpdateReport, SkillUpdatesSnapshot } from '../types.ts'

/** 一次更新任务的状态；`running` 之外的字段在任务结束后才有值。 */
export interface SkillUpdateJob {
  /** 这次更新属于哪个会话。 */
  readonly sessionId: string
  /** 要更新的 skill 名；调用方总会给出具体名字。 */
  readonly names: readonly string[]
  readonly status: 'running' | 'done' | 'failed'
  /** 成功更新的 skill 名；运行中为空。 */
  readonly updated: readonly string[]
  /** 更新失败的 skill；运行中为空。 */
  readonly failed: readonly SkillUpdateFailureItem[]
  /** 更新后重新检查得到的快照；整次请求失败时为 `null`。 */
  readonly snapshot: SkillUpdatesSnapshot | null
  /** 整次请求失败的原因；单个 skill 失败在 `failed` 里。 */
  readonly failure: string | null
  /** 任务结束时间（Unix 毫秒）；运行中为 `null`。 */
  readonly finishedAt: number | null
}

/** 订阅回调。 */
export type SkillUpdateListener = (job: SkillUpdateJob) => void

/** 真正发起更新请求的函数；测试注入假实现。 */
export type SkillUpdateRunner = (
  sessionId: string,
  names: readonly string[],
) => Promise<SkillUpdateReport>

/** `SkillUpdateJobs` 的构造参数。 */
export interface SkillUpdateJobsOptions {
  readonly run: SkillUpdateRunner
  /** 把请求错误变成可展示文本；默认用 `String(error)`。 */
  readonly describe?: (error: unknown) => string
  /** 时钟；测试注入固定时间。 */
  readonly now?: () => number
}

/**
 * 按会话保存更新任务的小状态机。
 *
 * 每个会话只保留最近一个任务：重复 `start()` 在运行中会被忽略，结束后再点则
 * 覆盖上一次结果。订阅者拿到的始终是该会话的最新状态。
 */
export class SkillUpdateJobs {
  readonly #run: SkillUpdateRunner
  readonly #describe: (error: unknown) => string
  readonly #now: () => number
  readonly #jobs = new Map<string, SkillUpdateJob>()
  readonly #listeners = new Set<SkillUpdateListener>()

  constructor(options: SkillUpdateJobsOptions) {
    this.#run = options.run
    this.#describe = options.describe ?? ((error) => String(error))
    this.#now = options.now ?? Date.now
  }

  /**
   * 读一个会话最近的更新任务。
   *
   * @param sessionId 会话 id
   * @returns 任务状态；这个会话还没更新过时是 `undefined`
   */
  jobOf(sessionId: string): SkillUpdateJob | undefined {
    return this.#jobs.get(sessionId)
  }

  /**
   * 订阅任务状态变化。
   *
   * @param listener 每次状态变化时调用
   * @returns 取消订阅
   */
  subscribe(listener: SkillUpdateListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * 开始更新；这个会话已有任务在跑时不重复发起。
   *
   * @param sessionId 会话 id
   * @param names 要更新的 skill 名
   */
  start(sessionId: string, names: readonly string[]): void {
    if (names.length === 0) return
    if (this.#jobs.get(sessionId)?.status === 'running') return
    const requested = [...names]
    this.#publish({
      sessionId,
      names: requested,
      status: 'running',
      updated: [],
      failed: [],
      snapshot: null,
      failure: null,
      finishedAt: null,
    })
    void this.#run(sessionId, requested).then(
      (report) => {
        this.#publish({
          sessionId,
          names: requested,
          status: 'done',
          updated: report.updated,
          failed: report.failed,
          snapshot: report.snapshot,
          failure: null,
          finishedAt: this.#now(),
        })
      },
      (error: unknown) => {
        this.#publish({
          sessionId,
          names: requested,
          status: 'failed',
          updated: [],
          failed: [],
          snapshot: null,
          failure: this.#describe(error),
          finishedAt: this.#now(),
        })
      },
    )
  }

  /** 写入状态并通知所有订阅者。 */
  #publish(job: SkillUpdateJob): void {
    this.#jobs.set(job.sessionId, job)
    for (const listener of this.#listeners) listener(job)
  }
}
