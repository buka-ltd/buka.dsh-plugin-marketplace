/**
 * 工作流观察者（Host 生命周期服务）。
 *
 * 这里不在任何会话的 `result` promise 上等待：节点 prompt 投进机器人会话后
 * 立即返回，观察者订阅全局 `session/event`，等这一轮 `turn/end` 后读会话日志、
 * 校验 JSON 的 `next`、写 step 并按边路由到下一个节点。会话异常终止
 * （disposed / interrupted）时，观察者尝试 resume 同一会话、发“继续”prompt；
 * 续接失败直接终止运行并写明原因，不新开会话；宿主重启后由 `resumeAll()`
 * 从落盘的 `run.json` 继续，续接失败则标成 interrupted。
 *
 * 一个 run 同时只有一个活跃节点；每个 run 的推进串行化，避免事件竞争导致
 * 重复 dispatch。运行状态以磁盘上的 run.json 为权威，内存里只有活跃句柄。
 * 节点正常完成时会把结果里的附件复制到该次执行的节点目录，并把清单写进
 * run.steps / 节点结果 / 模板上下文。
 *
 * 观察者还维护 `sessionId → runId` 索引，供机器人会话里的四个只读工具判断
 * 可见性：启动时从 `run.steps` / `run.sessions` 重建，dispatch / 恢复时实时
 * 补充，运行结束后保留，所以重新打开机器人会话仍能查看这次运行。
 *
 * @module @buka/dsh-plugin-workflows/supervisor
 */

import { randomUUID } from 'node:crypto'

import { buildResultSchema, outputProblems, routeNamesOf } from './output.js'
import { resolveAbort, resolveRoutes } from './routing.js'
import {
  answersValue,
  buildUserQuestions,
  renderNodePrompt,
  renderUserDetail,
  resolveUserAnswer,
  robotSessionTitle,
  toToolRun,
  WorkflowCancelledError,
  WorkflowRunError,
} from './run.js'
import { truncateUtf8, WORKFLOW_FORMAT_VERSION } from './run-store.js'

/** 启动恢复最多同时拉起多少个 run，避免一次性创建过多会话。 */
const RECOVERY_CONCURRENCY = 4

/** 启动恢复等待 robots 服务出现的上限。 */
const ROBOTS_WAIT_MS = 5000

/** 单个 dispatch 在拿到 startSeq 之前最多缓冲多少个事件。 */
const MAX_EARLY_EVENTS = 40

/** 这些结束原因视为“会话中断”，可以尝试续跑；`max-tokens` / `blocked` 直接失败。 */
const RECOVERABLE_STOP_REASONS = new Set(['aborted', 'interrupted', 'error'])

/**
 * plan 节点的一轮结束时仍停在计划阶段、又没有弹出审阅卡时，发出的唯一一次
 * 协议提示。它不是行为提示词，只把节点拉回 plan 模式的正常收尾路径。
 */
const PLAN_REVIEW_NUDGE =
  'You are still in plan mode. Present your finished plan through the exit_plan_mode tool so the user can approve it; do not submit this node\'s structured result before the plan is approved.'

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positive(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * @returns {string}
 */
function createRunId() {
  return `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

/**
 * @returns {{ promise: Promise<any>, resolve: (value: any) => void, reject: (error: unknown) => void, settled: boolean }}
 */
function deferred() {
  /** @type {any} */
  let resolve
  /** @type {any} */
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve(value) {
      this.settled = true
      resolve(value)
    },
    reject(error) {
      this.settled = true
      reject(error)
    },
    settled: false,
  }
}

/**
 * 工作流观察者。
 */
export class WorkflowSupervisor {
  /**
   * @param {{
   *   ctx: import('@deepseek-ai/cordis').Context,
   *   store: import('./run-store.js').WorkflowRunStore,
   *   options?: Record<string, any>,
   *   logger?: { warn?: (message: string) => void, info?: (message: string) => void },
   * }} input
   */
  constructor({ ctx, store, options = {}, logger }) {
    this.ctx = ctx
    this.store = store
    this.options = {
      nodeTimeoutMs: positive(options.nodeTimeoutMs) ?? 0,
      maxNodeTextBytes: positive(options.maxNodeTextBytes) ?? 64 * 1024,
      previewBytes: positive(options.previewBytes) ?? 4000,
      robotPreset: typeof options.robotPreset === 'string' ? options.robotPreset : '',
    }
    this.logger = logger
    /** @type {Map<string, Record<string, any>>} */
    this.runs = new Map()
    /** @type {Map<string, Record<string, any>>} */
    this.dispatchBySession = new Map()
    /**
     * 机器人会话 id → 所属运行。运行结束后重新打开会话时，四个只读工具靠它
     * 判断可见性；启动时从运行记录重建，dispatch / 恢复时实时补充。
     *
     * @type {Map<string, { runId: string }>}
     */
    this.sessionRuns = new Map()
    /** @type {Promise<void> | null} */
    this.sessionIndexPromise = null
    /** @type {Map<string, Promise<unknown>>} */
    this.queues = new Map()
    /** @type {Array<() => void> | null} */
    this.unsubscribes = null
    this.disposed = false
    /** @type {any} */
    this.robots = null
    /** @type {Array<(robots: any) => void>} */
    this.robotsWaiters = []
    this.recovered = false
    this.#subscribe()
  }

  /**
   * 注入 robots 服务；晚到时会唤醒等待启动恢复的调用方。
   *
   * @param {any} robots
   * @returns {void}
   */
  attachRobots(robots) {
    if (this.disposed || robots === undefined || robots === null) return
    this.robots = robots
    const waiters = this.robotsWaiters.splice(0)
    for (const waiter of waiters) waiter(robots)
  }

  /**
   * 确保「机器人会话 → 运行」索引已从落盘运行记录构建。
   *
   * 工具可见性条件在每一步都会调用它；构建只做一次，失败只记警告并保留已有
   * 映射，避免一个坏运行记录让整个会话的 step preparation 失败。
   *
   * @returns {Promise<void>}
   */
  async ensureSessionIndex() {
    // 存储初始化会清理旧格式运行；不要在它完成前把索引固定下来。初始化失败时
    // 只隐藏只读工具，不能让每个会话的 step preparation 跟着失败。
    if (this.store.ready !== null && this.store.ready !== undefined) {
      try {
        await this.store.ready
      } catch (error) {
        this.logger?.warn?.(`buka-workflows: 运行存储初始化失败，跳过机器人会话索引：${describeError(error)}`)
        this.sessionIndexPromise = Promise.resolve()
        return
      }
    }
    if (this.sessionIndexPromise === null) {
      this.sessionIndexPromise = this.#buildSessionIndex().catch((error) => {
        this.logger?.warn?.(`buka-workflows: 构建机器人会话索引失败：${describeError(error)}`)
      })
    }
    await this.sessionIndexPromise
  }

  /**
   * 查一个机器人会话属于哪次运行；不属于任何运行（例如手动机器人会话）时返回
   * null。
   *
   * @param {string} sessionId
   * @returns {{ runId: string } | null}
   */
  sessionRun(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null
    return this.sessionRuns.get(sessionId) ?? null
  }

  /**
   * 记录一个机器人会话所属运行。运行结束后仍保留：用户从侧边栏重新打开会话时，
   * 四个只读工具仍然可用。
   *
   * @param {string} runId
   * @param {string} sessionId
   * @returns {void}
   */
  rememberSession(runId, sessionId) {
    if (typeof runId !== 'string' || runId === '') return
    if (typeof sessionId !== 'string' || sessionId === '') return
    this.sessionRuns.set(sessionId, { runId })
  }

  /**
   * 启动一次运行。
   *
   * 后台模式在第一个节点 dispatch 后返回；前台模式（含 user 节点）返回 `done`
   * promise，调用方 await 到终止状态。
   *
   * @param {{
   *   plan: Record<string, any>,
   *   definition: unknown,
   *   agent: { id: string, ctx?: unknown },
   *   mode?: 'background' | 'foreground',
   *   signal?: AbortSignal,
   *   onRunCreated?: (runId: string) => void,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async start({ plan, definition, agent, mode = 'background', signal, onRunCreated }) {
    if (typeof agent?.id !== 'string' || agent.id === '') {
      throw new WorkflowRunError('a workflow run needs the creating agent')
    }
    if (mode === 'background' && plan.order.some((id) => plan.nodes[id].type === 'user')) {
      throw new WorkflowRunError('user nodes require a foreground run with an active caller turn')
    }
    const runId = createRunId()
    const seq = await this.store.allocateSeq()
    const now = Date.now()
    /** @type {Record<string, any>} */
    const run = {
      version: WORKFLOW_FORMAT_VERSION,
      runId,
      seq,
      goal: plan.goal,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      createdBy: { sessionId: agent.id },
      active: [],
      pendingUser: null,
      pendingInteraction: null,
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await this.store.create({ run, definition, plan })
    onRunCreated?.(runId)

    const ctx = this.#createContext({
      run,
      plan,
      definition,
      mode,
      agent,
      signal,
    })
    this.runs.set(runId, ctx)
    if (ctx.cancelled) {
      await this.#enqueue(runId, () => this.#finish(ctx, 'cancelled', { message: 'workflow caller aborted' }))
      return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
    }

    const startNode = plan.nodes[plan.start]
    if (startNode === undefined) {
      await this.#enqueue(runId, () => this.#fail(ctx, new WorkflowRunError('workflow start node is missing')))
      return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
    }
    if (startNode.type !== 'start') {
      await this.#enqueue(runId, () => this.#fail(ctx, new WorkflowRunError('workflow start node is not a start node')))
      return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
    }
    const startEdges = Array.isArray(startNode.next) ? startNode.next : []
    if (startEdges.length === 0) {
      await this.#enqueue(runId, () => this.#fail(ctx, new WorkflowRunError('start node has no outgoing edge')))
      return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
    }
    ctx.frontier = startEdges.map((rule) => ({
      nodeId: rule.to,
      edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
    }))
    // start 节点多出边是无条件 fan-out：据此激活 join（启动子集）。
    if (startEdges.length > 1) this.#activateJoins(ctx, startEdges.map((rule) => rule.to))
    await this.#enqueue(runId, () => this.#advanceInner(ctx))
    if (mode === 'foreground') return await ctx.done.promise
    return { run, runId, seq }
  }

  /**
   * 取消一次仍在观察中的运行。
   *
   * @param {string} runId
   * @param {string} [reason]
   * @returns {Promise<boolean>}
   */
  async cancel(runId, reason = 'cancelled by the workflow orchestrator') {
    const ctx = this.runs.get(runId)
    if (ctx === undefined) {
      // 观察者没有接管这个 run（例如恢复失败或插件刚加载）：直接落成中断。
      const run = await this.store.readRun(runId)
      if (run !== null && (run.status === 'running' || run.status === 'waiting')) {
        return await this.store.markInterrupted(runId, reason)
      }
      return false
    }
    ctx.cancelled = true
    try {
      ctx.controller.abort(reason)
    } catch {
      // 已经中止：忽略。
    }
    await this.#enqueue(runId, async () => {
      if (!ctx.closed) await this.#finish(ctx, 'cancelled', { message: reason })
    })
    return true
  }

  /**
   * 启动恢复：把上次进程留下的 running / waiting 运行接回来。等待用户作答的
   * user 运行没有调用者 turn，无法重建原生提问，直接标 interrupted。
   *
   * @returns {Promise<{ recovered: number, interrupted: number }>}
   */
  async resumeAll() {
    if (this.disposed) return { recovered: 0, interrupted: 0 }
    // 先把运行记录里的机器人会话索引建好：恢复出来的会话、以及用户随后重新
    // 打开的已结束会话，都要能立刻看到四个只读工具。存储初始化会删掉旧格式
    // 记录，所以等它完成后再强制重建一次，避免把初始化前的临时索引留下。
    if (!this.recovered && this.store.ready !== null && this.store.ready !== undefined) {
      await this.store.ready
      this.sessionIndexPromise = null
      // 初始化可能删掉了旧格式运行，重建前清掉初始化前可能建立的临时映射。
      this.sessionRuns.clear()
    }
    await this.ensureSessionIndex()
    if (this.recovered) return { recovered: 0, interrupted: 0 }
    this.recovered = true
    const robots = await this.#waitForRobots()
    if (robots === null || typeof robots.dispatchSession !== 'function') {
      const count = await this.store.markAllInterrupted(
        'the Buka Robots service is unavailable or too old (dispatchSession is missing), so unfinished workflow runs cannot be resumed',
      )
      return { recovered: 0, interrupted: count }
    }
    const runs = await this.store.listUnfinished()
    let recovered = 0
    let interrupted = 0
    let next = 0
    const worker = async () => {
      while (next < runs.length) {
        const run = runs[next]
        next += 1
        try {
          const result = await this.#recoverRun(run)
          if (result === 'recovered') recovered += 1
          else if (result === 'interrupted') interrupted += 1
        } catch (error) {
          this.logger?.warn?.(`buka-workflows: 恢复运行 ${run.runId} 失败：${describeError(error)}`)
        }
      }
    }
    const workers = Array.from({ length: Math.min(RECOVERY_CONCURRENCY, runs.length) }, () => worker())
    await Promise.all(workers)
    return { recovered, interrupted }
  }

  /**
   * 插件卸载：取消活动轮次、清定时器，但保留 running 记录供下次加载恢复。
   *
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.unsubscribes ?? []) {
      try {
        off()
      } catch {
        // 已解除：忽略。
      }
    }
    this.unsubscribes = null
    for (const ctx of this.runs.values()) {
      for (const entry of this.#dispatchEntriesForRun(ctx.runId)) {
        if (entry.timer !== null) clearTimeout(entry.timer)
        try {
          await entry.handle?.cancel?.('workflow plugin disposed')
        } catch {
          // 已释放：忽略。
        }
        try {
          await entry.handle?.dispose?.()
        } catch {
          // 已释放：忽略。
        }
      }
      ctx.controller.abort('workflow plugin disposed')
      if (ctx.mode === 'foreground' && !ctx.done.settled) {
        ctx.done.resolve(toToolRun(ctx.run))
      }
    }
    this.runs.clear()
    this.dispatchBySession.clear()
    this.sessionRuns.clear()
    this.queues.clear()
  }

  // -------------------------------------------------------------------------
  // 事件订阅
  // -------------------------------------------------------------------------

  /** @returns {void} */
  #subscribe() {
    if (typeof this.ctx?.on !== 'function') return
    const offs = []
    try {
      offs.push(
        this.ctx.on('session/event', (session, event) => this.#onSessionEvent(session, event), {
          global: true,
        }),
      )
    } catch {
      // 老运行时没有 global 选项：退回普通订阅。
      offs.push(this.ctx.on('session/event', (session, event) => this.#onSessionEvent(session, event)))
    }
    offs.push(this.ctx.on('session/disposed', (session) => this.#onSessionDisposed(session)))
    offs.push(this.ctx.on('agent/disposed', (payload) => this.#onAgentDisposed(payload)))
    // 人类交互（提问 / 工具审批）发生在机器人会话自己的 turn 里；观察者只旁听
    // 用来给运行页一个「正在等用户」的提示，必须排在真正的 answerer 之前并
    // 原样把 next() 交回去。
    for (const event of ['user-questions/request', 'approval/request']) {
      try {
        offs.push(
          this.ctx.on(event, (request, next) => this.#onHumanRequest(event, request, next), {
            prepend: true,
          }),
        )
      } catch {
        // 老运行时没有 prepend 选项：不注册，机器人自身仍然能正常提问/审批。
      }
    }
    this.unsubscribes = offs
  }

  /**
   * 旁听机器人会话里的提问 / 审批，记录成 run.pendingInteraction，供运行页展示。
   *
   * 不截胡：先调用 `next()` 让真正的 answerer（Web UI / 自动审批）处理，再异步
   * 记录/清除；返回值原样交回 waterfall。
   *
   * @param {string} event
   * @param {any} request
   * @param {() => any} next
   * @returns {any}
   */
  #onHumanRequest(event, request, next) {
    const answer = next()
    if (this.disposed) return answer
    const agentId = request?.agent?.id
    const entry = typeof agentId === 'string' ? this.dispatchBySession.get(agentId) : undefined
    if (entry === undefined) return answer
    const ctx = this.runs.get(entry.runId)
    if (ctx === undefined || ctx.closed || ctx.cancelled) return answer
    const interactionId = randomUUID()
    const kind = event === 'approval/request' ? 'approval' : 'question'
    // 计划审阅是 DSH plan 模式在机器人会话里弹出的原生问题卡。它和普通问题
    // 一样记录等待提示，但 supervisor 还要靠这个标志区分「用户关闭了审阅、
    // 正在自己回复」与「机器人自己停在计划阶段」。
    const planReview =
      event === 'user-questions/request' &&
      Array.isArray(request?.questions) &&
      request.questions.some((question) => question?.intent?.kind === 'plan-review')
    if (planReview) entry.planReviewAsked = true
    void this.#enqueue(entry.runId, () => this.#recordInteraction(ctx, entry, kind, request, interactionId, planReview))
    const settle = () => {
      void this.#enqueue(entry.runId, () => this.#clearInteraction(ctx, interactionId))
    }
    Promise.resolve(answer).then(settle, settle)
    return answer
  }

  /**
   * 把一次提问 / 审批写进运行记录。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} entry
   * @param {'question'|'approval'} kind
   * @param {any} request
   * @param {string} interactionId
   * @param {boolean} [planReview]
   * @returns {Promise<void>}
   */
  async #recordInteraction(ctx, entry, kind, request, interactionId, planReview = false) {
    if (ctx.closed || ctx.cancelled) return
    const current = this.#findActive(ctx, entry.seq)
    if (current === null) return
    const questions = kind === 'question' ? normalizeQuestions(request?.questions) : undefined
    if (kind === 'question' && (questions === undefined || questions.length === 0)) return
    ctx.run.pendingInteraction = {
      id: interactionId,
      kind,
      nodeId: current.nodeId,
      visit: current.visit,
      seq: current.seq,
      robot: current.robot ?? null,
      sessionId: current.sessionId ?? null,
      askedAt: Date.now(),
      ...(planReview ? { planReview: true } : {}),
      ...(questions === undefined ? {} : { questions }),
      ...(kind === 'approval'
        ? {
            toolName: clipText(request?.toolName, 120),
            reason: clipText(request?.reason, 2000),
            displayReason: clipText(request?.displayReason, 1000) || undefined,
            callId: typeof request?.callId === 'string' ? request.callId : undefined,
          }
        : {}),
    }
    try {
      await this.#save(ctx)
      await this.store.appendEvent(ctx.runId, 'interaction/asked', {
        kind,
        nodeId: current.nodeId,
        visit: current.visit,
        sessionId: current.sessionId ?? null,
      })
    } catch (error) {
      // 等待提示只是观测增强：落盘失败不能影响机器人会话本身。
      this.logger?.warn?.(`buka-workflows: 保存等待中的交互失败：${describeError(error)}`)
    }
  }

  /**
   * 清除一次提问 / 审批；id 不匹配时说明已经有新的交互，不能误清。
   *
   * @param {Record<string, any>} ctx
   * @param {string} interactionId
   * @returns {Promise<void>}
   */
  async #clearInteraction(ctx, interactionId) {
    if (ctx.closed) return
    if (ctx.run.pendingInteraction?.id !== interactionId) return
    ctx.run.pendingInteraction = null
    try {
      await this.#save(ctx)
      await this.store.appendEvent(ctx.runId, 'interaction/settled', { id: interactionId })
    } catch (error) {
      this.logger?.warn?.(`buka-workflows: 清除等待中的交互失败：${describeError(error)}`)
    }
  }

  /**
   * @param {any} session
   * @param {any} event
   * @returns {void}
   */
  #onSessionEvent(session, event) {
    if (this.disposed || event?.type !== 'turn/end') return
    const sessionId = typeof session?.id === 'string' ? session.id : ''
    if (sessionId === '') return
    const entry = this.dispatchBySession.get(sessionId)
    if (entry === undefined) return
    if (entry.startSeq === null) {
      if (entry.early.length < MAX_EARLY_EVENTS) entry.early.push({ kind: 'turn', session, event })
      return
    }
    if (typeof event.seq !== 'number' || event.seq < entry.startSeq) return
    void this.#enqueue(entry.runId, () => this.#processTurn(entry, session, event))
  }

  /**
   * @param {any} session
   * @returns {void}
   */
  #onSessionDisposed(session) {
    if (this.disposed) return
    const sessionId = typeof session?.id === 'string' ? session.id : ''
    const entry = sessionId === '' ? undefined : this.dispatchBySession.get(sessionId)
    if (entry === undefined || entry.claimed === true || entry.recoveryRequested === true) return
    if (entry.startSeq === null) {
      entry.disposedEarly = true
      return
    }
    entry.recoveryRequested = true
    void this.#enqueue(entry.runId, () => this.#recoverNode(entry, 'the robot session was disposed'))
  }

  /**
   * @param {any} payload
   * @returns {void}
   */
  #onAgentDisposed(payload) {
    const session = payload?.agent?.session ?? payload?.session ?? null
    if (session === null || session === undefined) return
    this.#onSessionDisposed(session)
  }

  // -------------------------------------------------------------------------
  // 运行上下文与队列
  // -------------------------------------------------------------------------

  /**
   * @param {{
   *   run: Record<string, any>,
   *   plan: Record<string, any>,
   *   definition: unknown,
   *   mode: 'background' | 'foreground',
   *   agent?: { id: string },
   *   signal?: AbortSignal,
   * }} input
   * @returns {Record<string, any>}
   */
  #createContext({ run, plan, definition, mode, agent, signal }) {
    const ctx = {
      runId: run.runId,
      run,
      plan,
      definition,
      mode,
      agent,
      controller: new AbortController(),
      frontier: [],
      joins: new Map(),
      lastEnd: null,
      values: {},
      visits: new Map(),
      seq: 0,
      stepCount: 0,
      done: deferred(),
      cancelled: false,
      closed: false,
    }
    // 旧记录用 run.current（单活跃节点）；并发后统一为 run.active 数组。就地迁移，
    // 让升级前仍在跑的运行能继续恢复。
    if (!Array.isArray(ctx.run.active)) {
      ctx.run.active = ctx.run.current !== null && ctx.run.current !== undefined ? [ctx.run.current] : []
      ctx.run.current = null
    }
    this.#rebuildFromSteps(ctx)
    if (signal !== undefined) {
      if (signal.aborted === true) {
        ctx.cancelled = true
        ctx.controller.abort('workflow caller aborted')
      } else {
        signal.addEventListener(
          'abort',
          () => {
            void this.cancel(ctx.runId, 'cancelled by the workflow caller')
          },
          { once: true },
        )
      }
    }
    return ctx
  }

  /**
   * 从已落盘的 steps / 节点结果重建模板上下文、访问次数与序号。
   *
   * @param {Record<string, any>} ctx
   * @returns {void}
   */
  #rebuildFromSteps(ctx) {
    const steps = Array.isArray(ctx.run.steps) ? ctx.run.steps : []
    ctx.stepCount = steps.length
    ctx.seq = 0
    ctx.visits = new Map()
    ctx.values = {}
    for (const step of steps) {
      const seq = typeof step?.seq === 'number' ? step.seq : 0
      if (seq > ctx.seq) ctx.seq = seq
      const nodeId = typeof step?.nodeId === 'string' ? step.nodeId : ''
      if (nodeId === '') continue
      ctx.visits.set(nodeId, (ctx.visits.get(nodeId) ?? 0) + 1)
      if (step.type === 'user') {
        ctx.values[nodeId] = {
          route: typeof step.route === 'string' ? step.route : null,
          routeTo: typeof step.routeTo === 'string' ? step.routeTo : null,
          answers: answersValue(Array.isArray(step.answers) ? step.answers : []),
          text: typeof step.text === 'string' ? step.text : '',
        }
        continue
      }
      ctx.values[nodeId] = {
        text: typeof step.text === 'string' ? step.text : '',
        data: step.data ?? null,
        robot: step.robot ?? null,
        sessionId: typeof step.sessionId === 'string' ? step.sessionId : '',
        route: typeof step.route === 'string' ? step.route : null,
        attachments: Array.isArray(step.attachments) ? step.attachments : [],
      }
    }
  }

  /**
   * 每个 run 的推进串行化。
   *
   * @param {string} runId
   * @param {() => Promise<unknown>} task
   * @returns {Promise<unknown>}
   */
  #enqueue(runId, task) {
    const previous = this.queues.get(runId) ?? Promise.resolve()
    const next = previous.then(task, task).catch((error) => {
      const ctx = this.runs.get(runId)
      this.logger?.warn?.(`buka-workflows: run ${runId} 推进失败：${describeError(error)}`)
      if (ctx !== undefined && !ctx.closed) return this.#fail(ctx, error)
      return undefined
    })
    this.queues.set(runId, next)
    const cleanup = () => {
      if (this.queues.get(runId) === next) this.queues.delete(runId)
    }
    next.then(cleanup, cleanup)
    return next
  }

  /**
   * @param {Record<string, any>} ctx
   * @returns {Promise<unknown>}
   */
  #advance(ctx) {
    return this.#enqueue(ctx.runId, () => this.#advanceInner(ctx))
  }

  /**
   * 消费 frontier 里的待处理 next-hop：robot 节点 dispatch 后继续（非阻塞），
   * user 节点在前台模式等用户作答，end 收尾一个分支；join 不进入 frontier（由
   * 屏障激活）。frontier 与活跃任务都为空时结束运行。
   *
   * @param {Record<string, any>} ctx
   * @returns {Promise<void>}
   */
  async #advanceInner(ctx) {
    while (!ctx.closed && !ctx.cancelled && ctx.frontier.length > 0) {
      const next = ctx.frontier.shift()
      const node = ctx.plan.nodes[next.nodeId]
      if (node === undefined) {
        await this.#fail(ctx, new WorkflowRunError(`workflow node "${next.nodeId}" is missing`))
        return
      }
      if (node.type === 'end') {
        await this.#arriveEnd(ctx, node)
        continue
      }
      if (node.type === 'user') {
        await this.#runUser(ctx, node)
        continue
      }
      if (node.type === 'robot') {
        await this.#startRobotNode(ctx, node, next.edgePrompt)
        continue
      }
      if (node.type === 'join') {
        await this.#fail(ctx, new WorkflowRunError(`join node "${node.id}" must not be reached directly`))
        return
      }
      await this.#fail(ctx, new WorkflowRunError(`unsupported node type "${String(node.type)}"`))
      return
    }
    await this.#maybeFinish(ctx)
  }

  /**
   * 一个分支到达 end：记录该分支终止。所有活跃任务与待处理 next-hop 都清空、
   * 且没有 pending join 时才结束整个运行。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} node
   * @returns {Promise<void>}
   */
  async #arriveEnd(ctx, node) {
    if (ctx.closed || ctx.cancelled) return
    ctx.lastEnd = node
    await this.#maybeFinish(ctx)
  }

  /**
   * 没有任何活跃任务 / 待处理 next-hop / pending join 时收尾。
   *
   * @param {Record<string, any>} ctx
   * @returns {Promise<void>}
   */
  async #maybeFinish(ctx) {
    if (ctx.closed || ctx.cancelled) return
    if (ctx.frontier.length > 0) return
    if (Array.isArray(ctx.run.active) && ctx.run.active.length > 0) return
    if (ctx.run.pendingUser !== null && ctx.run.pendingUser !== undefined) return
    if (ctx.joins.size > 0) return
    const lastEnd = ctx.lastEnd ?? null
    const nodeId = lastEnd !== null && typeof lastEnd.id === 'string' ? lastEnd.id : null
    const status = lastEnd !== null && typeof lastEnd.status === 'string' ? lastEnd.status : 'completed'
    await this.#finish(ctx, status, { nodeId })
  }

  // -------------------------------------------------------------------------
  // Robot 节点
  // -------------------------------------------------------------------------

  /**
   * 进入一个 robot 节点：落盘 current + 运行中的节点结果，再非阻塞 dispatch。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} node
   * @param {string | null} edgePrompt
   * @returns {Promise<void>}
   */
  async #startRobotNode(ctx, node, edgePrompt) {
    const run = ctx.run
    const nodeId = node.id
    const seq = ctx.seq + 1
    if (seq > ctx.plan.maxSteps) {
      await this.#fail(ctx, new WorkflowRunError(`workflow exceeded its ${ctx.plan.maxSteps}-step limit`))
      return
    }
    const visit = (ctx.visits.get(nodeId) ?? 0) + 1
    if (node.type === 'robot' && node.maxVisits !== undefined && visit > node.maxVisits) {
      await this.#fail(ctx, new WorkflowRunError(`robot node "${nodeId}" exceeded its ${node.maxVisits}-visit limit`))
      return
    }
    let prompt
    try {
      prompt = renderNodePrompt(node, edgePrompt, ctx.values, ctx.plan, seq, run.runId)
    } catch (error) {
      await this.#fail(ctx, error)
      return
    }

    const timeoutMs = positive(node.timeoutMs) ?? positive(this.options.nodeTimeoutMs) ?? 0
    const startedAt = Date.now()
    ctx.seq = seq
    ctx.stepCount = seq
    ctx.visits.set(nodeId, visit)
    // 进入新节点时上一节点遗留的等待提示已经无效。
    run.pendingInteraction = null
    /** @type {Record<string, any>} */
    const current = {
      nodeId,
      visit,
      seq,
      type: 'robot',
      robot: node.robot,
      prompt,
      sessionId: null,
      startSeq: null,
      startedAt,
      attempt: 1,
      recoveryAttempts: 0,
      ...(node.mode === 'plan' ? { mode: 'plan' } : {}),
      ...(timeoutMs > 0 ? { timeoutMs } : {}),
    }
    if (!Array.isArray(run.active)) run.active = []
    run.active.push(current)
    run.status = 'running'
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'node/start', {
      nodeId,
      visit,
      type: 'robot',
      ...(node.robot === undefined ? {} : { robot: node.robot }),
      ...(node.mode === 'plan' ? { mode: 'plan' } : {}),
    })
    await this.#saveRunningNodeResult(ctx, current, node, prompt, startedAt)

    const robots = this.robots ?? this.ctx?.get?.('bukaRobots') ?? null
    if (robots === null || !this.#canDispatch(robots)) {
      await this.#completeNode(
        ctx,
        current,
        node,
        {
          sessionId: null,
          text: '',
          stopReason: 'error',
          error:
            'robot node needs a Buka Robots service with dispatchSession(); install or update @buka/dsh-plugin-robots',
        },
        {},
      )
      return
    }
    // plan 节点需要新版 robots 在投递第一轮 prompt 之前切换模式；旧版会静默
    // 忽略 planMode，节点就会在普通模式下跑，必须在启动前明确失败。
    if (node.mode === 'plan' && robots.supportsPlanMode !== true) {
      await this.#completeNode(
        ctx,
        current,
        node,
        {
          sessionId: null,
          text: '',
          stopReason: 'error',
          error:
            'plan mode robot nodes need @buka/dsh-plugin-robots 0.9.0 or newer (supportsPlanMode is missing); update the Buka Robots plugin',
        },
        {},
      )
      return
    }

    const previous = findRobotSession(run, node.robot)
    const previousSessionId =
      typeof previous?.sessionId === 'string' && previous.sessionId !== '' ? previous.sessionId : ''
    const newSessionId = previousSessionId === '' ? randomUUID() : ''
    const dispatchKey = previousSessionId !== '' ? previousSessionId : newSessionId
    // 先把会话 id 落盘再 dispatch：即使 create 期间宿主退出，恢复时也知道该
    // resume 哪个会话（新会话的 id 是调用方先分配好传给 robots 的）。
    current.sessionId = dispatchKey
    current.startSeq = null
    this.rememberSession(run.runId, dispatchKey)
    await this.#save(ctx)
    /** @type {Record<string, any>} */
    const entry = {
      runId: run.runId,
      seq,
      startSeq: null,
      handle: null,
      early: [],
      claimed: false,
      recoveryRequested: false,
      disposedEarly: false,
      resultExhausted: false,
      timer: null,
      timeoutMs,
      planMode: node.mode === 'plan',
      planReviewAsked: false,
      planNudged: false,
    }
    this.dispatchBySession.set(dispatchKey, entry)

    let handle
    try {
      const creator = this.#creatorAgent(ctx)
      handle = await this.#dispatchRobot(robots, {
        robot: node.robot,
        prompt,
        ...(creator === undefined ? {} : { agent: creator }),
        ...(this.options.robotPreset === '' ? {} : { agentPreset: this.options.robotPreset }),
        outputSchema: buildResultSchema(node),
        routes: routeNamesOf(node),
        abortable: true,
        title: robotSessionTitle(run, node),
        ...(node.agentOptions === undefined ? {} : { agentOptions: node.agentOptions }),
        approval: 'ask',
        signal: ctx.controller.signal,
        planMode: node.mode === 'plan',
        ...(previousSessionId !== '' ? { sessionId: previousSessionId } : { newSessionId }),
      })
    } catch (error) {
      this.dispatchBySession.delete(dispatchKey)
      current.sessionId = null
      await this.#completeNode(
        ctx,
        current,
        node,
        { sessionId: null, text: '', stopReason: 'error', error: describeError(error) },
        {},
      )
      return
    }

    current.sessionId = typeof handle.sessionId === 'string' ? handle.sessionId : null
    current.startSeq = Number.isInteger(handle.startSeq) ? handle.startSeq : null
    if (current.sessionId !== null) this.rememberSession(run.runId, current.sessionId)
    current.resumed = handle.resumed === true
    current.compacted = handle.compacted === true
    // dispatch 里的 compact 不计入显式硬超时：计时从这一轮真正投递后开始。
    current.timeoutStartedAt = Date.now()
    if (typeof handle.resumeError === 'string' && handle.resumeError !== '') {
      current.sessionResetReason = handle.resumeError
    }
    if (typeof handle.compactionError === 'string' && handle.compactionError !== '') {
      current.compactionError = handle.compactionError
    }
    entry.handle = handle
    entry.startSeq = Number.isInteger(handle.startSeq) ? handle.startSeq : null
    // 防御旧版服务返回不同的 sessionId：把 provisional 键挪到真实 id。
    if (current.sessionId !== null && current.sessionId !== dispatchKey) {
      this.dispatchBySession.delete(dispatchKey)
      this.dispatchBySession.set(current.sessionId, entry)
    }
    rememberSessionEntry(run, node.robot, {
      nodeId,
      visit,
      seq,
      sessionId: current.sessionId,
      at: Date.now(),
      resumed: handle.resumed === true,
      compacted: handle.compacted === true,
    })
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'node/session', {
      nodeId,
      visit,
      sessionId: current.sessionId,
      resumed: handle.resumed === true,
    })
    await this.store.appendEvent(run.runId, 'node/dispatch', {
      nodeId,
      visit,
      seq,
      sessionId: current.sessionId,
      resumed: handle.resumed === true,
      compacted: handle.compacted === true,
    })

    this.#armTimeout(ctx, entry)
    // dispatch 期间已经到达的 turn/end / disposed：现在有 startSeq 了，补处理。
    const early = entry.early.splice(0)
    if (entry.disposedEarly === true) {
      entry.recoveryRequested = true
      void this.#enqueue(ctx.runId, () => this.#recoverNode(entry, 'the robot session was disposed'))
      return
    }
    for (const item of early) {
      if (item.kind === 'turn') {
        if (typeof item.event?.seq === 'number' && entry.startSeq !== null && item.event.seq >= entry.startSeq) {
          void this.#enqueue(ctx.runId, () => this.#processTurn(entry, item.session, item.event))
        }
      }
    }
  }

  /**
   * 处理一次 `turn/end`：读结果、校验 JSON/next、正常完成或异常恢复。
   *
   * @param {Record<string, any>} entry
   * @param {any} session
   * @param {any} event
   * @returns {Promise<void>}
   */
  async #processTurn(entry, session, event) {
    if (entry.claimed === true) return
    entry.claimed = true
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    const ctx = this.runs.get(entry.runId)
    if (ctx === undefined || ctx.closed || ctx.cancelled) return
    const current = this.#findActive(ctx, entry.seq)
    if (current === null) return
    if (entry.startSeq !== null && typeof event.seq === 'number' && event.seq < entry.startSeq) {
      entry.claimed = false
      return
    }
    const node = ctx.plan.nodes[current.nodeId]
    if (node === undefined) {
      await this.#fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`))
      return
    }

    let result
    try {
      result = await entry.handle.readResult({ sinceSeq: entry.startSeq ?? 0 })
    } catch (error) {
      entry.claimed = false
      entry.recoveryRequested = true
      await this.#recoverNode(entry, `could not read the robot session result: ${describeError(error)}`)
      return
    }

    // 主动终止优先于中断恢复：节点已经明确说无法完成时，不必再把同一会话接
    // 起来；即使这一轮以 aborted / interrupted / error 结束，abort 也是最强的
    // 意图。
    const abort = result.structured === undefined ? null : resolveAbort(result.structured)
    if (abort?.abort !== undefined) {
      if (ctx.run.pendingInteraction !== null) {
        ctx.run.pendingInteraction = null
        await this.#save(ctx)
      }
      await this.#abortNode(ctx, current, node, result, abort.abort.reason, {
        workspace: typeof entry.handle?.cwd === 'string' ? entry.handle.cwd : undefined,
      })
      return
    }

    if (RECOVERABLE_STOP_REASONS.has(result.stopReason) && result.stopReason !== 'completed') {
      entry.claimed = false
      entry.recoveryRequested = true
      await this.#recoverNode(entry, `the robot session ended with ${result.stopReason}`)
      return
    }

    if (ctx.run.pendingInteraction !== null) {
      ctx.run.pendingInteraction = null
      await this.#save(ctx)
    }
    // plan 节点先过模式门禁：计划还没被批准时，这一轮的结果不能当作节点结果
    // 路由；用户关闭审阅时保持等待，机器人自己停在计划阶段时给一次提示。
    if (await this.#handlePlanGate(ctx, entry, current, node, result)) return
    const workspace = typeof entry.handle?.cwd === 'string' ? entry.handle.cwd : undefined

    // 所有 robot 节点都必须交回 JSON；缺失或 next 不合法时在同一会话里重试，
    // 重试次数由 robots 服务的 resultRetries 控制。
    if (result.structured === undefined) {
      if (
        await this.#retryResult(ctx, entry, node, {
          reason: 'missing-json',
          routes: routeNamesOf(node),
        })
      ) {
        return
      }
      result = {
        ...result,
        stopReason: 'error',
        error:
          typeof result.error === 'string' && result.error !== ''
            ? result.error
            : 'the node did not submit a structured JSON result',
      }
      await this.#completeNode(ctx, current, node, result, { routes: null, workspace })
      return
    }

    // next / abort 同时出现，或 abort 的形态不合法：在同一会话里追问。
    if (abort?.error !== undefined) {
      if (
        await this.#retryResult(ctx, entry, node, {
          reason: abort.error.kind,
          routes: routeNamesOf(node),
        })
      ) {
        return
      }
      result = {
        ...result,
        stopReason: 'error',
        error: `invalid workflow result for node "${node.id}": ${abort.error.message}`,
      }
      await this.#completeNode(ctx, current, node, result, { routes: null, workspace })
      return
    }

    // 结果 JSON 必须匹配节点在定义里声明的 output；不匹配时在同一会话里追问，
    // 额度与 missing-json / invalid-next 共用。
    const problems = outputProblems(node, result.structured)
    if (problems.length > 0) {
      const detail = problems.slice(0, 3).join('; ')
      if (
        await this.#retryResult(ctx, entry, node, {
          reason: 'invalid-output',
          routes: routeNamesOf(node),
          detail,
        })
      ) {
        return
      }
      result = {
        ...result,
        stopReason: 'error',
        error: `invalid workflow output for node "${node.id}": ${detail}`,
      }
      await this.#completeNode(ctx, current, node, result, { routes: null, workspace })
      return
    }

    const route = resolveRoutes(node, result.structured)
    if (route.error !== undefined) {
      if (
        await this.#retryResult(ctx, entry, node, {
          reason: 'invalid-next',
          routes: route.routes,
        })
      ) {
        return
      }
      result = {
        ...result,
        stopReason: 'error',
        error: `invalid workflow route: ${route.error}`,
      }
      await this.#completeNode(ctx, current, node, result, { routes: null, workspace })
      return
    }

    await this.#completeNode(ctx, current, node, result, { routes: route.rules, workspace })
  }

  /**
   * plan 节点的模式门禁：一轮结束时如果会话仍停在 plan 模式，这一轮不能按
   * 普通结果路由。
   *
   * 三种情况：
   * - 用户关闭了原生审阅卡（`planReviewAsked`）：不抢答，保持节点等待，用户在
   *   机器人会话里的下一条消息继续这一节点；
   * - 机器人自己停在计划阶段：发一次有界提示，要求先把计划交给
   *   `exit_plan_mode` 审阅；第二次仍如此则节点失败；
   * - 已经批准 / 用户手动退出 / 读不到模式：返回 false，走原有结果处理。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} entry
   * @param {Record<string, any>} current
   * @param {Record<string, any>} node
   * @param {Record<string, any>} result
   * @returns {Promise<boolean>} true 表示已处理，调用方不要再路由
   */
  async #handlePlanGate(ctx, entry, current, node, result) {
    if (node.mode !== 'plan') return false
    const planState =
      typeof entry.handle?.getPlanMode === 'function' ? entry.handle.getPlanMode() : null
    if (planState?.active !== true) return false

    if (entry.planReviewAsked === true) {
      // 用户关闭审阅去自己写回复：plan 模式仍开启，下一轮由用户的消息驱动。
      entry.planReviewAsked = false
      entry.claimed = false
      await this.#save(ctx)
      this.#armTimeout(ctx, entry)
      await this.store.appendEvent(ctx.runId, 'node/plan-review-wait', {
        nodeId: current.nodeId,
        visit: current.visit,
      })
      return true
    }

    if (entry.planNudged !== true && typeof entry.handle?.send === 'function') {
      // 先记标记再投递：新 turn 的 turn/end 即使抢在 await 返回前到达，也不会
      // 再发第二次提示。
      entry.planNudged = true
      try {
        const next = await entry.handle.send(PLAN_REVIEW_NUDGE, { compactFirst: false })
        entry.startSeq = Number.isInteger(next) ? next : entry.startSeq
        current.startSeq = entry.startSeq
        entry.claimed = false
        await this.#save(ctx)
        this.#armTimeout(ctx, entry)
        await this.store.appendEvent(ctx.runId, 'node/plan-review-nudge', {
          nodeId: current.nodeId,
          visit: current.visit,
        })
        return true
      } catch (error) {
        entry.planNudged = false
        this.logger?.warn?.(
          `buka-workflows: could not ask the robot to present its plan（${ctx.runId}/${node.id}）：${describeError(error)}`,
        )
      }
    }

    await this.#completeNode(
      ctx,
      current,
      node,
      {
        ...result,
        stopReason: 'error',
        error: `workflow node "${node.id}" ended its turn in plan mode without presenting a plan for review`,
      },
      {
        routes: null,
        workspace: typeof entry.handle?.cwd === 'string' ? entry.handle.cwd : undefined,
      },
    )
    return true
  }

  /**
   * 在同一会话里要求机器人重新提交结果 / 修正 next。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} entry
   * @param {Record<string, any>} node
   * @param {{ reason: string, routes?: string[], detail?: string }} input
   * @returns {Promise<boolean>} true 表示已经发出重试
   */
  async #retryResult(ctx, entry, node, { reason, routes, detail }) {
    const prompt = entry.handle?.retryReport?.({ reason, routes, detail, abortable: true })
    if (typeof prompt !== 'string' || prompt.trim() === '') return false
    try {
      await entry.handle.send(prompt, { compactFirst: false })
      const nextSeq = entry.handle.startSeq
      entry.startSeq = Number.isInteger(nextSeq) ? nextSeq : entry.startSeq
      const current = this.#findActive(ctx, entry.seq)
      if (current !== null) current.startSeq = entry.startSeq
      entry.claimed = false
      await this.#save(ctx)
      this.#armTimeout(ctx, entry)
      await this.store.appendEvent(ctx.runId, 'node/result-retry', {
        nodeId: node.id,
        visit: current?.visit ?? null,
        reason,
        routes,
      })
      return true
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: 重新要求机器人提交结果失败（${ctx.runId}/${node.id}）：${describeError(error)}`,
      )
      return false
    }
  }

  /**
   * 把节点主动终止落成一条失败的 robot step，并结束整个运行（fail-fast 取消其余分支）。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} current 要终结的活跃节点
   * @param {Record<string, any>} node
   * @param {Record<string, any>} result
   * @param {string} reason 节点给出的无法完成原因
   * @param {{ recovered?: boolean, recoveryAttempts?: number, workspace?: string }} [extra]
   * @returns {Promise<void>}
   */
  async #abortNode(ctx, current, node, result, reason, extra = {}) {
    await this.#completeNode(
      ctx,
      current,
      node,
      { ...result, stopReason: 'aborted', error: reason },
      { ...extra, routes: null, aborted: true },
    )
  }

  /**
   * 正常 / 失败地落一条 robot step，并把它的出口（单线或 fan-out）推进 frontier，
   * 同时更新 join 屏障：并发 fan-out 激活 join、任务完成喂给引用它的 join。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} current 要终结的活跃节点
   * @param {Record<string, any>} node
   * @param {Record<string, any>} result
   * @param {{ recovered?: boolean, recoveryAttempts?: number, timedOut?: boolean, aborted?: boolean, routes?: Array<Record<string, any>> | null, workspace?: string }} extra
   * @returns {Promise<void>}
   */
  async #completeNode(ctx, current, node, result, extra) {
    if (ctx.closed || ctx.cancelled) return
    const run = ctx.run
    const sessionId = typeof result.sessionId === 'string' ? result.sessionId : (current.sessionId ?? null)
    const finishedAt = Date.now()
    const startedAt = typeof current.startedAt === 'number' ? current.startedAt : finishedAt
    const preview = truncateUtf8(result.text ?? '', this.options.previewBytes)
    let aborted = extra.aborted === true
    let stopReason = aborted
      ? 'aborted'
      : typeof result.stopReason === 'string'
        ? result.stopReason
        : 'error'
    const recovered = extra.recovered === true || current.recovered === true
    const recoveryAttempts = Number.isInteger(extra.recoveryAttempts)
      ? extra.recoveryAttempts
      : Number.isInteger(current.recoveryAttempts)
        ? current.recoveryAttempts
        : 0
    let routes = aborted ? null : extra.routes
    if (routes === undefined && stopReason === 'completed') {
      // 防御性处理：调用方没先解析 abort / next 时，这里兜底解析一次。
      const resolvedAbort = resolveAbort(result.structured)
      if (resolvedAbort?.abort !== undefined) {
        aborted = true
        stopReason = 'aborted'
        routes = null
        result = { ...result, stopReason: 'aborted', error: resolvedAbort.abort.reason }
      } else if (resolvedAbort?.error !== undefined) {
        await this.#fail(ctx, new WorkflowRunError(`invalid workflow result: ${resolvedAbort.error.message}`))
        return
      } else {
        const resolved = resolveRoutes(node, result.structured)
        if (resolved.error !== undefined) {
          await this.#fail(ctx, new WorkflowRunError(`invalid workflow route: ${resolved.error}`))
          return
        }
        routes = resolved.rules
      }
    }
    // 附件只在节点正常完成时落盘。复制失败属于节点输出不完整：把节点改成
    // error，而不是带着缺失的附件继续路由。
    /** @type {Array<Record<string, any>>} */
    let nodeAttachments = []
    /** @type {Array<Record<string, any>>} */
    let attachmentValues = []
    if (
      stopReason === 'completed' &&
      result.structured !== null &&
      typeof result.structured === 'object' &&
      !Array.isArray(result.structured) &&
      result.structured.attachments !== undefined
    ) {
      try {
        nodeAttachments = await this.store.writeNodeAttachments(
          run.runId,
          current.seq,
          node.id,
          result.structured.attachments,
          { workspace: extra.workspace },
        )
        attachmentValues = await this.store.attachmentValues(run.runId, current.seq, node.id, nodeAttachments)
        result = {
          ...result,
          structured: { ...result.structured, attachments: nodeAttachments },
        }
      } catch (error) {
        stopReason = 'error'
        routes = null
        result = {
          ...result,
          stopReason: 'error',
          error: `could not store node attachments: ${describeError(error)}`,
        }
      }
    }
    const routeList = Array.isArray(routes) ? routes : []
    const routeName = routeList.length === 1 && typeof routeList[0]?.name === 'string' ? routeList[0].name : null
    const routeTo = routeList.length === 1 && typeof routeList[0]?.to === 'string' ? routeList[0].to : null
    /** @type {Record<string, any>} */
    const step = {
      seq: current.seq,
      nodeId: node.id,
      visit: current.visit,
      type: 'robot',
      robot: node.robot,
      sessionId,
      ...(node.mode === 'plan' ? { mode: 'plan' } : {}),
      status: stopReason === 'completed' ? 'completed' : 'failed',
      stopReason,
      ...(aborted ? { aborted: true } : {}),
      route: routeName,
      routeTo,
      routes: routeList.map((rule) => ({
        name: typeof rule?.name === 'string' ? rule.name : null,
        to: typeof rule?.to === 'string' ? rule.to : null,
      })),
      startedAt,
      finishedAt,
      text: preview.text,
      textTruncated: preview.truncated,
      data: result.structured ?? null,
      error: result.error ?? null,
      attachments: nodeAttachments,
      resumed: current.resumed === true || result.resumed === true,
      compacted: current.compacted === true || result.compacted === true,
      ...(typeof current.compactionError === 'string' && current.compactionError !== ''
        ? { compactionError: current.compactionError }
        : {}),
      ...(typeof result.compactionError === 'string' && result.compactionError !== ''
        ? { compactionError: result.compactionError }
        : {}),
      ...(typeof current.sessionResetReason === 'string' && current.sessionResetReason !== ''
        ? { sessionResetReason: current.sessionResetReason }
        : {}),
      ...(recovered ? { recovered: true, recoveryAttempts } : {}),
      ...(extra.timedOut === true ? { timedOut: true } : {}),
    }
    run.steps.push(step)
    this.#removeActive(ctx, current)
    run.pendingInteraction = null
    run.updatedAt = finishedAt
    ctx.stepCount = run.steps.length
    ctx.values[node.id] = {
      text: typeof result.text === 'string' ? result.text : '',
      data: result.structured ?? null,
      robot: node.robot,
      sessionId: sessionId ?? '',
      route: routeName,
      attachments: attachmentValues,
    }
    updateRobotSession(run, node.robot, {
      nodeId: node.id,
      visit: current.visit,
      sessionId,
      at: finishedAt,
    })
    const fullText = truncateUtf8(result.text ?? '', this.options.maxNodeTextBytes)
    const promptText = truncateUtf8(current.prompt ?? '', this.options.maxNodeTextBytes)
    try {
      await this.store.saveNodeResult(run.runId, current.seq, node.id, {
        nodeId: node.id,
        visit: current.visit,
        robot: node.robot,
        sessionId,
        ...(node.mode === 'plan' ? { mode: 'plan' } : {}),
        status: step.status,
        stopReason,
        ...(aborted ? { aborted: true } : {}),
        error: result.error ?? null,
        structured: result.structured ?? null,
        attachments: nodeAttachments,
        resumed: step.resumed,
        compacted: step.compacted,
        ...(step.compactionError === undefined ? {} : { compactionError: step.compactionError }),
        ...(step.sessionResetReason === undefined ? {} : { sessionResetReason: step.sessionResetReason }),
        ...(step.recovered === true ? { recovered: true, recoveryAttempts: step.recoveryAttempts } : {}),
        ...(step.timedOut === true ? { timedOut: true } : {}),
        prompt: promptText.text,
        promptTruncated: promptText.truncated,
        text: fullText.text,
        textTruncated: fullText.truncated,
        startedAt,
        finishedAt,
      })
    } catch (error) {
      this.logger?.warn?.(`buka-workflows: 保存节点结果失败（${run.runId}/${node.id}）：${describeError(error)}`)
    }
    this.#disposeEntry(ctx, sessionId)
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'node/end', {
      nodeId: node.id,
      visit: current.visit,
      stopReason,
      ...(aborted ? { aborted: true } : {}),
      ...(node.mode === 'plan' ? { mode: 'plan' } : {}),
      sessionId,
      resumed: step.resumed,
      compacted: step.compacted,
      ...(step.recovered === true ? { recovered: true } : {}),
      ...(step.timedOut === true ? { timedOut: true } : {}),
    })

    if (stopReason !== 'completed') {
      const detail =
        typeof result.error === 'string' && result.error !== ''
          ? result.error
          : `robot node "${node.id}" ended with ${stopReason}`
      const message = aborted ? `workflow node "${node.id}" aborted the run: ${detail}` : detail
      run.error = message
      // fail-fast：结束整个运行并取消其余活跃分支。
      await this.#finish(ctx, 'failed', { nodeId: node.id, message, aborted })
      return
    }

    // 单线 / fan-out：把出口推进 frontier，并据此激活 join（并发 fan-out 的启动子集）。
    if (routeList.length > 0) {
      const targets = routeList.map((rule) => rule.to)
      if (routeList.length > 1) this.#activateJoins(ctx, targets)
      for (const rule of routeList) {
        await this.store.appendEvent(run.runId, 'route', {
          nodeId: node.id,
          route: typeof rule?.name === 'string' ? rule.name : null,
          to: typeof rule?.to === 'string' ? rule.to : null,
        })
        ctx.frontier.push({
          nodeId: rule.to,
          edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
        })
      }
    }
    // 本节点作为任务的完成：喂给引用它的 join（可能触发汇合）。
    await this.#contributeJoins(ctx, node.id)
    await this.#advanceInner(ctx)
  }

  /**
   * 会话中断 / 异常：只续接同一会话继续；续接失败直接终止节点和运行，不新开会话。
   *
   * @param {Record<string, any>} entry
   * @param {string} reason
   * @returns {Promise<void>}
   */
  async #recoverNode(entry, reason) {
    const ctx = this.runs.get(entry.runId)
    if (ctx === undefined || ctx.closed || ctx.cancelled) return
    const current = this.#findActive(ctx, entry.seq)
    if (current === null) return
    const node = ctx.plan.nodes[current.nodeId]
    if (node === undefined) {
      await this.#fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`))
      return
    }
    // 中断恢复会重新发 prompt；旧的问题/审批已经无法回答。
    ctx.run.pendingInteraction = null
    // 旧入口标记为已处理：恢复期间迟到的 turn/end 不能再 finalize 这个节点。
    entry.claimed = true
    this.#removeEntry(entry)
    try {
      await entry.handle?.dispose?.()
    } catch {
      // 旧句柄已随会话结束：忽略。
    }

    const sessionId = typeof current.sessionId === 'string' ? current.sessionId : ''
    const robots = this.robots ?? this.ctx?.get?.('bukaRobots') ?? null
    const stop = async (message, session = sessionId === '' ? null : sessionId) => {
      await this.#completeNode(
        ctx,
        current,
        node,
        { sessionId: session, text: '', stopReason: 'error', error: message },
        {},
      )
    }
    if (sessionId === '') {
      await stop(`workflow node "${node.id}" has no robot session id; workflow stopped without opening a new session`)
      return
    }
    this.rememberSession(ctx.runId, sessionId)
    if (robots === null || typeof robots.openSession !== 'function') {
      await stop(
        `workflow node "${node.id}" cannot resume robot session "${sessionId}": the Buka Robots service cannot open robot sessions; workflow stopped without opening a new session`,
      )
      return
    }

    current.recoveryAttempts = 1
    current.recovering = true
    await this.#save(ctx)
    await this.store.appendEvent(ctx.runId, 'node/recover', {
      nodeId: node.id,
      visit: current.visit,
      attempt: 1,
      reason,
    })

    /** @type {Record<string, any> | null} */
    let handle = null
    try {
      handle = await this.#requireVisibleHandle(
        await robots.openSession(this.#sessionRequest(ctx, node, sessionId)),
      )
      await this.#requireSameSession(handle, sessionId)
      const check = handle.readResult({ sinceSeq: current.startSeq ?? 0 })
      if (
        Number.isInteger(current.startSeq) &&
        check.turnEnded === true &&
        !RECOVERABLE_STOP_REASONS.has(check.stopReason)
      ) {
        current.recovering = false
        // 恢复时这一轮其实已经结束：先登记一个 entry，让 plan 门禁和正常结束
        // 路径都能通过它观察 / 清理 plan 模式。
        const recoveredEntry = {
          runId: ctx.runId,
          seq: current.seq,
          startSeq: current.startSeq,
          handle,
          early: [],
          claimed: true,
          recoveryRequested: false,
          disposedEarly: false,
          resultExhausted: false,
          timer: null,
          timeoutMs: current.timeoutMs ?? 0,
          planMode: node.mode === 'plan',
          planReviewAsked: false,
          planNudged: false,
        }
        this.dispatchBySession.set(sessionId, recoveredEntry)
        let result = check
        let routes = null
        if (check.structured === undefined) {
          result = {
            ...check,
            stopReason: 'error',
            error: 'the robot session did not submit a structured JSON result',
          }
        } else {
          const abort = resolveAbort(check.structured)
          if (abort?.abort !== undefined) {
            await this.#abortNode(ctx, current, node, check, abort.abort.reason, {
              recovered: true,
              recoveryAttempts: 1,
              workspace: typeof handle.cwd === 'string' ? handle.cwd : undefined,
            })
            return
          }
          if (abort?.error !== undefined) {
            result = {
              ...check,
              stopReason: 'error',
              error: `invalid workflow result for node "${node.id}": ${abort.error.message}`,
            }
          } else {
            const problems = outputProblems(node, check.structured)
            if (problems.length > 0) {
              result = {
                ...check,
                stopReason: 'error',
                error: `invalid workflow output for node "${node.id}": ${problems.slice(0, 3).join('; ')}`,
              }
            } else {
              const resolved = resolveRoutes(node, check.structured)
              if (resolved.error !== undefined) {
                result = {
                  ...check,
                  stopReason: 'error',
                  error: `invalid workflow route: ${resolved.error}`,
                }
              } else {
                routes = resolved.rules
              }
            }
          }
        }
        if (await this.#handlePlanGate(ctx, recoveredEntry, current, node, result)) return
        this.#clearEntryPlanMode(recoveredEntry)
        this.#removeEntry(recoveredEntry)
        try {
          await handle.dispose?.()
        } catch {
          // 已释放：忽略。
        }
        await this.#completeNode(ctx, current, node, result, {
          recovered: true,
          recoveryAttempts: 1,
          routes,
          workspace: typeof handle.cwd === 'string' ? handle.cwd : undefined,
        })
        return
      }
      await handle.send(recoveryPrompt(node, reason), { compactFirst: true })
      current.startSeq = Number.isInteger(handle.startSeq) ? handle.startSeq : current.startSeq
      current.recovering = false
      current.recovered = true
      current.resumed = true
      current.compacted = handle.compacted === true || current.compacted === true
      if (typeof handle.compactionError === 'string' && handle.compactionError !== '') {
        current.compactionError = handle.compactionError
      }
      const recoveredEntry = {
        runId: ctx.runId,
        seq: current.seq,
        startSeq: current.startSeq,
        handle,
        early: [],
        claimed: false,
        recoveryRequested: false,
        disposedEarly: false,
        resultExhausted: false,
        timer: null,
        timeoutMs: current.timeoutMs ?? 0,
        planMode: node.mode === 'plan',
        planReviewAsked: false,
        planNudged: false,
      }
      rememberSessionEntry(ctx.run, node.robot, {
        nodeId: node.id,
        visit: current.visit,
        seq: current.seq,
        sessionId: current.sessionId,
        at: Date.now(),
        resumed: true,
        compacted: current.compacted === true,
      })
      this.dispatchBySession.set(current.sessionId, recoveredEntry)
      await this.#save(ctx)
      await this.store.appendEvent(ctx.runId, 'node/resume', {
        nodeId: node.id,
        visit: current.visit,
        sessionId: current.sessionId,
        attempt: 1,
      })
      this.#armTimeout(ctx, recoveredEntry)
      return
    } catch (error) {
      if (node.mode === 'plan') this.#clearEntryPlanMode({ planMode: true, handle })
      try {
        await handle?.dispose?.()
      } catch {
        // 已释放：忽略。
      }
      current.recovering = false
      await stop(
        `workflow node "${node.id}" could not resume robot session "${sessionId}": ${describeError(error)}; workflow stopped without opening a new session`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // 用户介入
  // -------------------------------------------------------------------------

  /**
   * 执行一个用户介入节点（仅前台模式）。原生提问卡要求调用者会话有活跃 turn。
   *
   * 用户的选项就是节点的出边（`label` 显示给用户）；`questions` 收集额外的
   * 反馈 / 信息。回答会落成一条 user step，后续 prompt 可以用模板引用答案。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} node
   * @returns {Promise<void>}
   */
  async #runUser(ctx, node) {
    if (ctx.mode !== 'foreground') {
      await this.#fail(ctx, new WorkflowRunError(`user node "${node.id}" requires a foreground run`))
      return
    }
    const userQuestions = this.ctx?.get?.('userQuestions') ?? null
    if (userQuestions === null || typeof userQuestions.ask !== 'function') {
      await this.#fail(ctx, new WorkflowRunError('user node needs the user-questions service'))
      return
    }
    const run = ctx.run
    const seq = ctx.seq + 1
    if (seq > ctx.plan.maxSteps) {
      await this.#fail(ctx, new WorkflowRunError(`workflow exceeded its ${ctx.plan.maxSteps}-step limit`))
      return
    }
    const visit = (ctx.visits.get(node.id) ?? 0) + 1
    const startedAt = Date.now()
    let detail
    try {
      detail = renderUserDetail(node, ctx.values, ctx.plan, seq, run.runId)
    } catch (error) {
      await this.#fail(ctx, error)
      return
    }
    ctx.seq = seq
    ctx.visits.set(node.id, visit)
    run.status = 'waiting'
    run.pendingUser = {
      nodeId: node.id,
      visit,
      seq,
      title: node.title,
      detail,
      options: (Array.isArray(node.next) ? node.next : []).map((rule) => ({
        name: rule.name,
        label: rule.label,
        ...(typeof rule.description === 'string' && rule.description !== ''
          ? { description: rule.description }
          : {}),
      })),
      questions: (Array.isArray(node.questions) ? node.questions : []).map((question) => ({
        ...question,
        options: (Array.isArray(question.options) ? question.options : []).map((option) => ({ ...option })),
      })),
      requestedAt: startedAt,
      sessionId: typeof ctx.agent?.id === 'string' ? ctx.agent.id : null,
    }
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'user/waiting', { nodeId: node.id })

    let answer
    try {
      answer = await userQuestions.ask({
        questions: buildUserQuestions(node, detail),
        agent: ctx.agent,
        signal: ctx.controller.signal,
      })
    } catch (error) {
      run.pendingUser = null
      run.current = null
      const code = typeof error?.code === 'string' ? error.code : ''
      if (ctx.cancelled === true || ctx.controller.signal.aborted === true || code === 'ASK_CANCELLED') {
        await this.#finish(ctx, 'cancelled', {
          nodeId: node.id,
          message: `user node "${node.id}" was cancelled before the user answered`,
        })
        return
      }
      if (code === 'NO_PROVIDER') {
        await this.#fail(
          ctx,
          new WorkflowRunError(
            `user node "${node.id}" could not ask the user: no user-questions answerer is available in this composition`,
            { cause: error },
          ),
        )
        return
      }
      await this.#fail(
        ctx,
        new WorkflowRunError(`user node "${node.id}" could not ask the user: ${describeError(error)}`, {
          cause: error,
        }),
      )
      return
    }

    const resolved = resolveUserAnswer(node, answer)
    const finishedAt = Date.now()
    if (resolved.error !== undefined) {
      run.pendingUser = null
      run.current = null
      await this.#fail(
        ctx,
        new WorkflowRunError(`invalid answer for user node "${node.id}": ${resolved.error}`),
      )
      return
    }
    const cancelled = resolved.cancelled === true
    const route = resolved.route ?? null
    run.pendingUser = null
    run.current = null
    run.status = 'running'
    run.steps.push({
      seq,
      nodeId: node.id,
      visit,
      type: 'user',
      robot: null,
      sessionId: null,
      status: cancelled ? 'cancelled' : 'completed',
      route: cancelled ? null : (route?.name ?? null),
      routeTo: cancelled ? null : (route?.to ?? null),
      answers: resolved.answers,
      input: detail,
      text: resolved.text,
      startedAt,
      finishedAt,
      error: null,
    })
    run.updatedAt = finishedAt
    ctx.stepCount = run.steps.length
    ctx.values[node.id] = {
      route: cancelled ? null : (route?.name ?? null),
      routeTo: cancelled ? null : (route?.to ?? null),
      answers: answersValue(resolved.answers),
      text: resolved.text,
    }
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'user/answered', {
      nodeId: node.id,
      ...(cancelled ? { cancelled: true } : { route: route?.name ?? null }),
    })

    if (cancelled) {
      await this.#finish(ctx, 'cancelled', {
        nodeId: node.id,
        message: `user node "${node.id}" was submitted without a choice; the run was cancelled`,
      })
      return
    }
    if (route === null) {
      await this.#maybeFinish(ctx)
      return
    }
    ctx.frontier.push({
      nodeId: route.to,
      edgePrompt: typeof route.prompt === 'string' && route.prompt !== '' ? route.prompt : null,
    })
  }

  // -------------------------------------------------------------------------
  // 超时
  // -------------------------------------------------------------------------

  /**
   * 只有显式配置了 timeoutMs 才计时；默认不设 timer。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} entry
   * @returns {void}
   */
  #armTimeout(ctx, entry) {
    const current = this.#findActive(ctx, entry.seq)
    const timeoutMs = positive(entry.timeoutMs)
    if (timeoutMs === undefined || current === null) return
    const startedAt =
      typeof current.timeoutStartedAt === 'number'
        ? current.timeoutStartedAt
        : typeof current.startedAt === 'number'
          ? current.startedAt
          : Date.now()
    const remaining = Math.max(0, timeoutMs - (Date.now() - startedAt))
    entry.timer = setTimeout(() => {
      entry.timer = null
      void this.#enqueue(ctx.runId, () => this.#onTimeout(ctx, entry, timeoutMs))
    }, remaining)
    entry.timer.unref?.()
  }

  /**
   * 显式超时：取消当前轮，把节点记成超时失败；不进入恢复重试。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} entry
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  async #onTimeout(ctx, entry, timeoutMs) {
    if (ctx.closed || ctx.cancelled || entry.claimed === true) return
    const current = this.#findActive(ctx, entry.seq)
    if (current === null) return
    entry.claimed = true
    this.#removeEntry(entry)
    let result = { text: '' }
    try {
      result = (await entry.handle?.cancel?.('timeout')) ?? { text: '' }
    } catch {
      // 会话已经不可读：保留空结果。
    }
    // 取消落定后再清 plan 模式：此时 turn 已关闭，set(false) 能直接提交。
    this.#clearEntryPlanMode(entry)
    try {
      await entry.handle?.dispose?.()
    } catch {
      // 已释放：忽略。
    }
    const node = ctx.plan.nodes[current.nodeId]
    if (node === undefined) {
      await this.#fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`))
      return
    }
    await this.store.appendEvent(ctx.runId, 'node/timeout', {
      nodeId: node.id,
      visit: current.visit,
      timeoutMs,
    })
    await this.#completeNode(
      ctx,
      current,
      node,
      {
        ...result,
        sessionId: current.sessionId ?? null,
        stopReason: 'timeout',
        error: `robot node "${node.id}" timed out after ${timeoutMs}ms`,
      },
      { timedOut: true },
    )
  }

  // -------------------------------------------------------------------------
  // 启动恢复
  // -------------------------------------------------------------------------

  /**
   * @param {Record<string, any>} run
   * @returns {Promise<'recovered' | 'interrupted' | 'skipped'>}
   */
  async #recoverRun(run) {
    const runId = typeof run?.runId === 'string' ? run.runId : ''
    if (runId === '' || this.runs.has(runId)) return 'skipped'
    if (
      run.status === 'waiting' ||
      (run.pendingUser !== null && run.pendingUser !== undefined) ||
      run.current?.type === 'user'
    ) {
      await this.store.markInterrupted(
        runId,
        'the run was waiting for the user when the host restarted; a user-question prompt cannot be recreated',
      )
      return 'interrupted'
    }
    const definition = await this.store.readDefinition(runId)
    const plan = definition?.plan
    if (plan === null || plan === undefined || typeof plan.nodes !== 'object') {
      await this.store.markInterrupted(runId, 'the workflow definition snapshot is missing or corrupt')
      return 'interrupted'
    }
    const planOrder = Array.isArray(plan.order) ? plan.order : Object.keys(plan.nodes)
    if (run.status === 'waiting' || planOrder.some((id) => plan.nodes[id]?.type === 'user')) {
      await this.store.markInterrupted(
        runId,
        'this run contains user nodes; their questions need an active caller turn and cannot be recreated after a restart',
      )
      return 'interrupted'
    }
    const ctx = this.#createContext({ run, plan, definition, mode: 'background' })
    // 模板里引用的是完整最终文本；run.steps 只留预览，恢复时用节点结果全文覆盖。
    try {
      const nodeResults = await this.store.readNodeResults(runId)
      const byKey = new Map(nodeResults.map((result) => [`${String(result.seq)}:${String(result.nodeId)}`, result]))
      for (const step of Array.isArray(run.steps) ? run.steps : []) {
        const full = byKey.get(`${String(step.seq)}:${String(step.nodeId)}`)
        if (full === undefined) continue
        const current = ctx.values[step.nodeId]
        if (current === undefined) continue
        if (typeof full.text === 'string' && full.text !== '') current.text = full.text
        if (current.data === null && full.structured !== undefined) current.data = full.structured
        if (Array.isArray(full.attachments)) {
          current.attachments = await this.store.attachmentValues(
            runId,
            Number.isInteger(step.seq) ? step.seq : 0,
            typeof step.nodeId === 'string' ? step.nodeId : '',
            full.attachments,
          )
        }
      }
    } catch {
      // 节点结果读不出来时退回 step 预览；恢复是否安全由 prompt / session 判定。
    }
    this.runs.set(runId, ctx)
    run.status = 'running'
    run.pendingInteraction = null
    await this.#save(ctx)
    await this.store.appendEvent(runId, 'run/recover', {
      status: run.status,
      activeCount: Array.isArray(run.active) ? run.active.length : 0,
    })

    // 并发运行可能有多个活跃会话：逐个恢复；任一失败则整体中断（不新开会话）。
    const actives = Array.isArray(run.active) ? run.active.filter((entry) => entry?.type === 'robot') : []
    if (actives.length === 0) {
      const frontier = this.#deriveFrontier(ctx)
      if (frontier.length === 0) {
        await this.#finish(ctx, 'completed')
        return 'recovered'
      }
      ctx.frontier = frontier
      await this.#advance(ctx)
      return 'recovered'
    }
    for (const current of actives) {
      const outcome = await this.#resumeActive(ctx, current)
      if (outcome !== 'recovered') {
        this.runs.delete(runId)
        return 'interrupted'
      }
    }
    return 'recovered'
  }

  /**
   * 恢复一个活跃的机器人节点：同一会话续接；不新开会话。上一轮已经结束时直接收
   * 结果，否则 compact 后发「继续」prompt。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} current
   * @returns {Promise<'recovered' | 'interrupted'>}
   */
  async #resumeActive(ctx, current) {
    const runId = ctx.runId
    const run = ctx.run
    if (current.type !== 'robot') {
      await this.store.markInterrupted(runId, `cannot recover a ${String(current.type)} node after a restart`)
      return 'interrupted'
    }
    if (typeof current.prompt !== 'string' || current.prompt === '') {
      await this.store.markInterrupted(runId, 'this run predates observer recovery data and cannot be resumed safely')
      return 'interrupted'
    }
    const node = ctx.plan.nodes[current.nodeId]
    if (node === undefined) {
      await this.store.markInterrupted(runId, `workflow node "${current.nodeId}" is missing from the definition`)
      return 'interrupted'
    }
    const robots = this.robots ?? this.ctx?.get?.('bukaRobots') ?? null
    const sessionId = typeof current.sessionId === 'string' ? current.sessionId : ''
    const interrupt = async (message) => {
      await this.store.markInterrupted(runId, message)
      return 'interrupted'
    }
    if (sessionId === '') {
      return await interrupt(
        `workflow node "${node.id}" has no robot session id; workflow stopped without opening a new session`,
      )
    }
    this.rememberSession(runId, sessionId)
    if (robots === null || typeof robots.openSession !== 'function') {
      return await interrupt(
        `workflow node "${node.id}" cannot resume robot session "${sessionId}": the Buka Robots service cannot open robot sessions; workflow stopped without opening a new session`,
      )
    }
    /** @type {Record<string, any> | null} */
    let handle = null
    try {
      handle = await this.#requireVisibleHandle(
        await robots.openSession(this.#sessionRequest(ctx, node, sessionId)),
      )
      await this.#requireSameSession(handle, sessionId)
      const check = handle.readResult({ sinceSeq: current.startSeq ?? 0 })
      if (
        Number.isInteger(current.startSeq) &&
        check.turnEnded === true &&
        !RECOVERABLE_STOP_REASONS.has(check.stopReason)
      ) {
        current.recovering = false
        const recoveredEntry = {
          runId,
          seq: current.seq,
          startSeq: current.startSeq,
          handle,
          early: [],
          claimed: true,
          recoveryRequested: false,
          disposedEarly: false,
          resultExhausted: false,
          timer: null,
          timeoutMs: current.timeoutMs ?? 0,
          planMode: node.mode === 'plan',
          planReviewAsked: false,
          planNudged: false,
        }
        this.dispatchBySession.set(sessionId, recoveredEntry)
        let result = check
        let routes = null
        if (check.structured === undefined) {
          result = {
            ...check,
            stopReason: 'error',
            error: 'the robot session did not submit a structured JSON result',
          }
        } else {
          const abort = resolveAbort(check.structured)
          if (abort?.abort !== undefined) {
            await this.#abortNode(ctx, current, node, check, abort.abort.reason, {
              recovered: true,
              recoveryAttempts: 1,
              workspace: typeof handle.cwd === 'string' ? handle.cwd : undefined,
            })
            return 'recovered'
          }
          if (abort?.error !== undefined) {
            result = {
              ...check,
              stopReason: 'error',
              error: `invalid workflow result for node "${node.id}": ${abort.error.message}`,
            }
          } else {
            const problems = outputProblems(node, check.structured)
            if (problems.length > 0) {
              result = {
                ...check,
                stopReason: 'error',
                error: `invalid workflow output for node "${node.id}": ${problems.slice(0, 3).join('; ')}`,
              }
            } else {
              const resolved = resolveRoutes(node, check.structured)
              if (resolved.error !== undefined) {
                result = {
                  ...check,
                  stopReason: 'error',
                  error: `invalid workflow route: ${resolved.error}`,
                }
              } else {
                routes = resolved.rules
              }
            }
          }
        }
        if (await this.#handlePlanGate(ctx, recoveredEntry, current, node, result)) return 'recovered'
        this.#clearEntryPlanMode(recoveredEntry)
        this.#removeEntry(recoveredEntry)
        try {
          await handle.dispose?.()
        } catch {
          // 已释放：忽略。
        }
        await this.#completeNode(ctx, current, node, result, {
          recovered: true,
          recoveryAttempts: 1,
          routes,
          workspace: typeof handle.cwd === 'string' ? handle.cwd : undefined,
        })
        return 'recovered'
      }
      await handle.send(recoveryPrompt(node, 'the host restarted before this node finished'), {
        compactFirst: true,
      })
      current.startSeq = Number.isInteger(handle.startSeq) ? handle.startSeq : current.startSeq
      current.recovering = false
      current.recovered = true
      current.resumed = true
      current.recoveryAttempts = 1
      const entry = {
        runId,
        seq: current.seq,
        startSeq: current.startSeq,
        handle,
        early: [],
        claimed: false,
        disposedEarly: false,
        resultExhausted: false,
        timer: null,
        timeoutMs: current.timeoutMs ?? 0,
        planMode: node.mode === 'plan',
        planReviewAsked: false,
        planNudged: false,
      }
      rememberSessionEntry(run, node.robot, {
        nodeId: node.id,
        visit: current.visit,
        seq: current.seq,
        sessionId: current.sessionId,
        at: Date.now(),
        resumed: true,
        compacted: current.compacted === true,
      })
      this.dispatchBySession.set(current.sessionId, entry)
      await this.#save(ctx)
      await this.store.appendEvent(runId, 'node/resume', {
        nodeId: node.id,
        visit: current.visit,
        sessionId: current.sessionId,
        attempt: 1,
        reason: 'host restart',
      })
      this.#armTimeout(ctx, entry)
      return 'recovered'
    } catch (error) {
      if (node.mode === 'plan') this.#clearEntryPlanMode({ planMode: true, handle })
      try {
        await handle?.dispose?.()
      } catch {
        // 已释放：忽略。
      }
      this.dispatchBySession.delete(sessionId)
      this.logger?.warn?.(
        `buka-workflows: 恢复运行 ${runId} 的会话 ${sessionId} 失败，终止运行：${describeError(error)}`,
      )
      return await interrupt(
        `workflow node "${node.id}" could not resume robot session "${sessionId}" after restart: ${describeError(error)}; workflow stopped without opening a new session`,
      )
    }
  }

  /**
   * 从已落盘的 step 推导恢复后的 frontier（没有 step 时从 start 的全部出边开始）。
   *
   * @param {Record<string, any>} ctx
   * @returns {Array<{ nodeId: string, edgePrompt: string | null }>}
   */
  #deriveFrontier(ctx) {
    const steps = Array.isArray(ctx.run.steps) ? ctx.run.steps : []
    if (steps.length === 0) {
      const startNode = ctx.plan.nodes[ctx.plan.start]
      if (startNode === undefined || startNode.type !== 'start') return []
      return (Array.isArray(startNode.next) ? startNode.next : []).map((rule) => ({
        nodeId: rule.to,
        edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
      }))
    }
    const last = steps[steps.length - 1]
    const node = ctx.plan.nodes[last.nodeId]
    if (node === undefined) return []
    // 并发 fan-out 的 step 记录了全部出口（routes）；旧记录退回单条 route。
    const routes =
      Array.isArray(last.routes) && last.routes.length > 0
        ? last.routes
        : typeof last.route === 'string' && last.route !== ''
          ? [{ name: last.route, to: typeof last.routeTo === 'string' ? last.routeTo : null }]
          : []
    const edges = Array.isArray(node.next) ? node.next : []
    return routes
      .map((route) => edges.find((rule) => rule.name === route.name))
      .filter((edge) => edge !== undefined)
      .map((edge) => ({
        nodeId: edge.to,
        edgePrompt: typeof edge.prompt === 'string' && edge.prompt !== '' ? edge.prompt : null,
      }))
  }

  // -------------------------------------------------------------------------
  // 收尾
  // -------------------------------------------------------------------------

  /**
   * @param {Record<string, any>} ctx
   * @param {string} status
   * @param {{ nodeId?: string | null, message?: string, aborted?: boolean }} [extra]
   * @returns {Promise<Record<string, any>>}
   */
  async #finish(ctx, status, extra = {}) {
    if (ctx.closed) return ctx.run
    ctx.closed = true
    const run = ctx.run
    run.status = status
    run.updatedAt = Date.now()
    run.finishedAt = run.updatedAt
    run.current = null
    run.active = []
    run.pendingUser = null
    run.pendingInteraction = null
    run.result = {
      status,
      lastNode: extra.nodeId ?? null,
      ...(extra.message === undefined ? {} : { message: extra.message }),
      ...(extra.aborted === true ? { aborted: true } : {}),
      ...(status === 'failed' && run.error !== null ? { error: run.error } : {}),
    }
    for (const entry of this.#dispatchEntriesForRun(ctx.runId)) {
      this.#clearEntryPlanMode(entry)
      this.#removeEntry(entry)
      try {
        await entry.handle?.dispose?.()
      } catch {
        // 已释放：忽略。
      }
    }
    try {
      await this.#save(ctx)
      await this.store.appendEvent(ctx.runId, 'run/end', { status, result: run.result })
    } catch (error) {
      this.logger?.warn?.(`buka-workflows: 写入运行结束状态失败（${ctx.runId}）：${describeError(error)}`)
    }
    this.runs.delete(ctx.runId)
    if (!ctx.done.settled) ctx.done.resolve(toToolRun(run))
    return run
  }

  /**
   * @param {Record<string, any>} ctx
   * @param {unknown} error
   * @returns {Promise<Record<string, any>>}
   */
  async #fail(ctx, error) {
    if (ctx.closed) return ctx.run
    const activeNodeId = this.#activeNodeId(ctx)
    if (error instanceof WorkflowCancelledError || ctx.cancelled === true) {
      return await this.#finish(ctx, 'cancelled', {
        nodeId: activeNodeId,
        message: describeError(error),
      })
    }
    ctx.run.error = describeError(error)
    this.logger?.warn?.(`buka-workflows: run ${ctx.runId} failed: ${ctx.run.error}`)
    return await this.#finish(ctx, 'failed', { nodeId: activeNodeId })
  }

  /**
   * 当前（第一个）活跃节点的 id，用于失败 / 取消记录里的 lastNode。
   *
   * @param {Record<string, any>} ctx
   * @returns {string | null}
   */
  #activeNodeId(ctx) {
    const active = Array.isArray(ctx.run.active) ? ctx.run.active : []
    const first = active.find((entry) => typeof entry?.nodeId === 'string')
    return first !== undefined ? first.nodeId : null
  }

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

  /**
   * 按序号在 run.active 里找活跃的机器人节点。
   *
   * @param {Record<string, any>} ctx
   * @param {number} seq
   * @returns {Record<string, any> | null}
   */
  #findActive(ctx, seq) {
    const active = Array.isArray(ctx.run.active) ? ctx.run.active : []
    return active.find((entry) => entry?.seq === seq) ?? null
  }

  /**
   * 从 run.active 里移除一个已终结的活跃节点。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} current
   * @returns {void}
   */
  #removeActive(ctx, current) {
    if (!Array.isArray(ctx.run.active)) return
    const index = ctx.run.active.findIndex((entry) => entry === current || entry?.seq === current.seq)
    if (index >= 0) ctx.run.active.splice(index, 1)
  }

  /**
   * 并发 fan-out 激活 join：把每个 join 的「本次启动子集」（inputs ∩ 已启动任务）
   * 记为待完成集合。join 放行条件就是这些任务全部完成；没被启动的 input 不计入。
   *
   * @param {Record<string, any>} ctx
   * @param {string[]} startedIds 本次 fan-out 启动的任务节点 id
   * @returns {void}
   */
  #activateJoins(ctx, startedIds) {
    const started = new Set(startedIds)
    for (const id of ctx.plan.order) {
      const node = ctx.plan.nodes[id]
      if (node.type !== 'join') continue
      const awaiting = new Set(node.inputs.filter((input) => started.has(input)))
      if (awaiting.size > 0) ctx.joins.set(id, awaiting)
    }
  }

  /**
   * 一个任务完成：喂给引用它的所有 join，等待集合清空的 join 放行一次（沿唯一出边
   * 推进 frontier）。不在这里调用 #advanceInner，由 #completeNode 收尾统一推进。
   *
   * @param {Record<string, any>} ctx
   * @param {string} nodeId 完成的任务节点 id
   * @returns {Promise<void>}
   */
  async #contributeJoins(ctx, nodeId) {
    for (const [joinId, awaiting] of ctx.joins) {
      if (!awaiting.has(nodeId)) continue
      awaiting.delete(nodeId)
      if (awaiting.size !== 0) continue
      ctx.joins.delete(joinId)
      const join = ctx.plan.nodes[joinId]
      const edge = Array.isArray(join?.next) ? join.next[0] : null
      if (edge !== undefined && edge !== null && typeof edge.to === 'string') {
        ctx.frontier.push({
          nodeId: edge.to,
          edgePrompt: typeof edge.prompt === 'string' && edge.prompt !== '' ? edge.prompt : null,
        })
      }
      await this.store.appendEvent(ctx.runId, 'join/fire', { joinId })
    }
  }

  /**
   * @param {Record<string, any>} ctx
   * @returns {Promise<void>}
   */
  async #save(ctx) {
    ctx.run.updatedAt = Date.now()
    await this.store.save(ctx.run)
  }

  /**
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} current 活跃节点
   * @param {Record<string, any>} node
   * @param {string} prompt
   * @param {number} startedAt
   * @returns {Promise<void>}
   */
  async #saveRunningNodeResult(ctx, current, node, prompt, startedAt) {
    const promptText = truncateUtf8(prompt, this.options.maxNodeTextBytes)
    try {
      await this.store.saveNodeResult(ctx.runId, current.seq, node.id, {
        nodeId: node.id,
        visit: current.visit,
        robot: node.robot,
        status: 'running',
        prompt: promptText.text,
        promptTruncated: promptText.truncated,
        attachments: [],
        startedAt,
      })
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: 保存运行中节点结果失败（${ctx.runId}/${node.id}）：${describeError(error)}`,
      )
    }
  }

  /**
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} node
   * @param {string} sessionId
   * @returns {Record<string, any>}
   */
  #sessionRequest(ctx, node, sessionId) {
    const creator = this.#creatorAgent(ctx)
    return {
      robot: node.robot,
      sessionId,
      outputSchema: buildResultSchema(node),
      routes: routeNamesOf(node),
      abortable: true,
      title: robotSessionTitle(ctx.run, node),
      ...(node.agentOptions === undefined ? {} : { agentOptions: node.agentOptions }),
      approval: 'ask',
      signal: ctx.controller.signal,
      ...(creator === undefined ? {} : { agent: creator }),
      ...(this.options.robotPreset === '' ? {} : { agentPreset: this.options.robotPreset }),
      // 恢复时不强行改变 plan 状态：plan 节点保留会话日志里的状态（批准后可能
      // 已经退出）；普通节点清掉可能残留的 plan 模式。
      ...(node.mode === 'plan' ? {} : { planMode: false }),
    }
  }

  /**
   * @param {Record<string, any>} ctx
   * @returns {any}
   */
  #creatorAgent(ctx) {
    const agents = this.ctx?.get?.('agents') ?? this.ctx?.agents
    if (typeof agents?.get !== 'function') return undefined
    const sessionId = ctx.run?.createdBy?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    try {
      return agents.get(sessionId) ?? undefined
    } catch {
      return undefined
    }
  }

  /**
   * 观察者需要非阻塞的 dispatchSession；旧版 robots 只有 startSession（会自己
   * await 一轮），不能交给观察者，所以明确按失败处理并提示升级。
   *
   * @param {any} robots
   * @returns {boolean}
   */
  #canDispatch(robots) {
    return typeof robots?.dispatchSession === 'function'
  }

  /**
   * @param {any} robots
   * @param {Record<string, any>} request
   * @returns {Promise<Record<string, any>>}
   */
  async #dispatchRobot(robots, request) {
    const handle = await this.#requireVisibleHandle(await robots.dispatchSession(request))
    if (typeof handle?.resumeError === 'string' && handle.resumeError !== '') {
      await this.#rejectHandle(
        handle,
        `the Buka Robots service replaced an unresumable robot session with a new one (${handle.resumeError}); workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`,
      )
    }
    if (typeof request.sessionId === 'string' && request.sessionId !== '') {
      await this.#requireSameSession(handle, request.sessionId)
    }
    return handle
  }

  /**
   * 工作流只接受可见的普通会话。旧版 robots 插件在创建失败时可能返回
   * `mode: 'subagent'` 的隐藏句柄；这里先释放它，再让节点按失败结束，
   * 绝不把它当成节点会话继续调度。
   *
   * @param {Record<string, any>} handle
   * @returns {Promise<Record<string, any>>}
   */
  async #requireVisibleHandle(handle) {
    if (handle?.mode !== 'subagent') return handle
    await this.#rejectHandle(
      handle,
      'the Buka Robots service returned a hidden subagent session; workflow robot sessions must be visible top-level sessions. Upgrade @buka/dsh-plugin-robots.',
    )
  }

  /**
   * 旧版 robots 服务在续接失败时可能换一个新会话：`resumeError` 非空，或
   * 返回的 sessionId 与请求的不一致。工作流不接受替代会话。
   *
   * @param {Record<string, any>} handle
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async #requireSameSession(handle, sessionId) {
    if (typeof handle?.resumeError === 'string' && handle.resumeError !== '') {
      await this.#rejectHandle(
        handle,
        `the Buka Robots service replaced an unresumable robot session with a new one (${handle.resumeError}); workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`,
      )
    }
    if (handle?.sessionId !== sessionId) {
      await this.#rejectHandle(
        handle,
        `the Buka Robots service returned robot session "${String(handle?.sessionId)}" instead of the requested "${sessionId}"; workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`,
      )
    }
  }

  /**
   * 释放一个不可接受的句柄，并让调用方以明确的错误终止节点。
   *
   * @param {Record<string, any>} handle
   * @param {string} message
   * @returns {Promise<never>}
   */
  async #rejectHandle(handle, message) {
    try {
      await handle?.dispose?.()
    } catch {
      // 已释放：忽略。
    }
    throw new WorkflowRunError(message)
  }

  /**
   * @returns {Promise<any | null>}
   */
  async #waitForRobots() {
    if (this.robots !== null) return this.robots
    const existing = this.ctx?.get?.('bukaRobots') ?? null
    if (existing !== null) {
      this.attachRobots(existing)
      return existing
    }
    return await new Promise((resolve) => {
      /** @type {NodeJS.Timeout} */
      let timer
      const finish = (value) => {
        clearTimeout(timer)
        const index = this.robotsWaiters.indexOf(waiter)
        if (index >= 0) this.robotsWaiters.splice(index, 1)
        resolve(value)
      }
      const waiter = (robots) => finish(robots)
      this.robotsWaiters.push(waiter)
      timer = setTimeout(() => finish(null), ROBOTS_WAIT_MS)
      timer.unref?.()
    })
  }

  /**
   * 从所有运行记录重建「机器人会话 → 运行」索引。
   *
   * `run.steps` 覆盖已结束的执行，`run.sessions` 覆盖每个机器人的会话摘要，
   * `run.current` 覆盖运行中尚未形成 step 的节点；旧记录缺其中一项时其他来源
   * 仍能兜底。
   *
   * @returns {Promise<void>}
   */
  async #buildSessionIndex() {
    const remember = (runId, sessionId) => {
      if (typeof sessionId !== 'string' || sessionId === '') return
      this.sessionRuns.set(sessionId, { runId })
    }
    for (const runId of await this.store.listRunIds()) {
      const run = await this.store.readRun(runId)
      if (run === null) continue
      const effectiveRunId = typeof run.runId === 'string' && run.runId !== '' ? run.runId : runId
      for (const step of Array.isArray(run.steps) ? run.steps : []) {
        remember(effectiveRunId, step?.sessionId)
      }
      for (const session of Array.isArray(run.sessions) ? run.sessions : []) {
        remember(effectiveRunId, session?.sessionId)
        for (const entry of Array.isArray(session?.entries) ? session.entries : []) {
          remember(effectiveRunId, entry?.sessionId)
        }
      }
      for (const current of Array.isArray(run.active) ? run.active : []) {
        remember(effectiveRunId, current?.sessionId)
      }
      remember(effectiveRunId, run.current?.sessionId)
    }
  }

  /**
   * @param {string} runId
   * @returns {Array<Record<string, any>>}
   */
  #dispatchEntriesForRun(runId) {
    return [...this.dispatchBySession.values()].filter((entry) => entry.runId === runId)
  }

  /**
   * @param {Record<string, any>} entry
   * @returns {void}
   */
  #removeEntry(entry) {
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    for (const [key, value] of this.dispatchBySession) {
      if (value === entry) this.dispatchBySession.delete(key)
    }
  }

  /**
   * 节点结束 / 运行终止时尽力关闭该 entry 进入的 plan 模式。
   *
   * 失败只记日志：模式清理不能改变节点结果；下一次进入同一机器人时 supervisor
   * 会按节点的 `mode` 重新归一，所以这里只是避免把 plan 状态留在用户可见的
   * 会话里。超时 / 取消时 turn 可能还没关闭，`set(false)` 会排队；不影响结果。
   *
   * @param {Record<string, any>} entry
   * @returns {void}
   */
  #clearEntryPlanMode(entry) {
    if (entry?.planMode !== true) return
    entry.planMode = false
    const handle = entry.handle
    if (handle === null || handle === undefined || typeof handle.setPlanMode !== 'function') return
    try {
      handle.setPlanMode(false)
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: could not leave plan mode for the robot session: ${describeError(error)}`,
      )
    }
  }

  /**
   * 从 dispatch 表里移除并释放这一轮的句柄。
   *
   * @param {Record<string, any>} ctx
   * @param {string | null} sessionId
   * @returns {void}
   */
  #disposeEntry(ctx, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    const entry = this.dispatchBySession.get(sessionId)
    if (entry === undefined || entry.runId !== ctx.runId) return
    this.#clearEntryPlanMode(entry)
    this.#removeEntry(entry)
    try {
      Promise.resolve(entry.handle?.dispose?.()).catch(() => undefined)
    } catch {
      // 已释放：忽略。
    }
  }
}

/**
 * 只保留运行页展示需要的问题字段，并限制体积。
 *
 * @param {unknown} questions
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) return []
  return questions
    .slice(0, 5)
    .map((question) => ({
      id: clipText(question?.id, 64),
      header: clipText(question?.header, 200),
      question: clipText(question?.question, 1000),
      multiSelect: question?.multiSelect === true,
      options: Array.isArray(question?.options)
        ? question.options.slice(0, 20).map((option) => ({ label: clipText(option?.label, 200) }))
        : [],
    }))
    .filter((question) => question.question !== '' || question.header !== '')
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function clipText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > max ? text.slice(0, max) : text
}

/**
 * @param {Record<string, any>} run
 * @param {unknown} robot
 * @returns {Record<string, any> | undefined}
 */
function findRobotSession(run, robot) {
  if (!Array.isArray(run?.sessions) || typeof robot !== 'string' || robot === '') return undefined
  return run.sessions.find((entry) => entry?.robot === robot)
}

/**
 * 记录一次进入：每个 robot 一个会话条目，entries 里保留每次进入的节点 / 序号。
 *
 * @param {Record<string, any>} run
 * @param {unknown} robot
 * @param {{ nodeId: string, visit: number, seq: number, sessionId: string | null, at: number, resumed: boolean, compacted: boolean }} input
 * @returns {void}
 */
function rememberSessionEntry(run, robot, { nodeId, visit, seq, sessionId, at, resumed, compacted }) {
  if (typeof robot !== 'string' || robot === '') return
  if (!Array.isArray(run.sessions)) run.sessions = []
  let existing = findRobotSession(run, robot)
  if (existing === undefined) {
    existing = {
      robot,
      sessionId: sessionId ?? '',
      firstNodeId: nodeId,
      lastNodeId: nodeId,
      visits: 0,
      createdAt: at,
      entries: [],
    }
    run.sessions.push(existing)
  }
  if (typeof sessionId === 'string' && sessionId !== '') {
    if (existing.sessionId !== sessionId && existing.sessionId !== '') existing.resets = (existing.resets ?? 0) + 1
    existing.sessionId = sessionId
  }
  existing.lastNodeId = nodeId
  existing.lastVisit = visit
  if (!Array.isArray(existing.entries)) existing.entries = []
  const already = existing.entries.some(
    (entry) => entry?.nodeId === nodeId && entry?.seq === seq && entry?.sessionId === (sessionId ?? null),
  )
  if (already) return
  existing.visits = (Number.isInteger(existing.visits) ? existing.visits : 0) + 1
  existing.entries.push({ nodeId, visit, seq, sessionId: sessionId ?? null, at, resumed, compacted })
  if (existing.entries.length > 500) existing.entries.splice(0, existing.entries.length - 500)
}

/**
 * 完成一次进入后更新会话摘要。
 *
 * @param {Record<string, any>} run
 * @param {unknown} robot
 * @param {{ nodeId: string, visit: number, sessionId: string | null, at: number }} input
 * @returns {void}
 */
function updateRobotSession(run, robot, { nodeId, visit, sessionId, at }) {
  const existing = findRobotSession(run, robot)
  if (existing === undefined) return
  existing.lastNodeId = nodeId
  existing.lastVisit = visit
  existing.updatedAt = at
  if (typeof sessionId === 'string' && sessionId !== '' && existing.sessionId === '') existing.sessionId = sessionId
}

/**
 * 会话中断后发进同一会话的续跑提示。
 *
 * @param {Record<string, any>} node
 * @param {string} reason
 * @returns {string}
 */
function recoveryPrompt(node, reason) {
  const routes = routeNamesOf(node)
  const routeText =
    routes.length > 0
      ? ` The final JSON object must include exactly one of "next" (one of: ${routes.join(', ')}) and "abort".`
      : ' The final JSON object may include "abort" if you cannot complete the task.'
  return (
    `Your previous execution of workflow node "${node.id}" was interrupted before it delivered a result (${reason}). ` +
    'Continue from the work already done in this session and finish the assigned task now. ' +
    `When you are done, submit the final JSON object by calling the structured_output tool; it must match this node's declared output schema.${routeText} ` +
    'If you cannot complete this task, submit "abort" with a short non-empty reason instead of choosing a route. ' +
    'Put the actual answer in the final text; do not put it only in an attachment.'
  )
}
