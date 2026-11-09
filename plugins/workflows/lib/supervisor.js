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
 * 节点正常完成时会把声明的附件复制到该次执行的节点目录，并把清单写进
 * run.steps / 节点结果 / 模板上下文。
 *
 * 观察者还维护 `sessionId → runId` 索引，供机器人会话里的四个只读工具判断
 * 可见性：启动时从 `run.steps` / `run.sessions` 重建，dispatch / 恢复时实时
 * 补充，运行结束后保留，所以重新打开机器人会话仍能查看这次运行。
 *
 * @module @buka/dsh-plugin-workflows/supervisor
 */

import { randomUUID } from 'node:crypto'

import { resolveRoute } from './routing.js'
import {
  WorkflowCancelledError,
  WorkflowRunError,
  gateReason,
  mapApproval,
  renderNodePrompt,
  robotSessionTitle,
  toToolRun,
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
   * 后台模式在第一个节点 dispatch 后返回；前台模式（含 gate）返回 `done`
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
    if (mode === 'background' && plan.order.some((id) => plan.nodes[id].type === 'gate')) {
      throw new WorkflowRunError('gate nodes require a foreground run with an active caller turn')
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
      current: null,
      pendingGate: null,
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
    const rule = Array.isArray(startNode.next) ? startNode.next[0] : null
    if (rule === null || rule === undefined) {
      await this.#enqueue(runId, () => this.#fail(ctx, new WorkflowRunError('start node has no outgoing edge')))
      return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
    }
    ctx.next = {
      nodeId: rule.to,
      edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
    }
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
   * 启动恢复：把上次进程留下的 running / waiting 运行接回来。等待审批的 gate
   * 运行没有调用者 turn，无法重建审批，直接标 interrupted。
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
    void this.#enqueue(entry.runId, () => this.#recordInteraction(ctx, entry, kind, request, interactionId))
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
   * @returns {Promise<void>}
   */
  async #recordInteraction(ctx, entry, kind, request, interactionId) {
    if (ctx.closed || ctx.cancelled) return
    const current = ctx.run.current
    if (current === null || current.seq !== entry.seq) return
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
      next: null,
      values: {},
      visits: new Map(),
      seq: 0,
      stepCount: 0,
      done: deferred(),
      cancelled: false,
      closed: false,
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
   * 沿图推进到下一个需要等待的节点：robot 节点 dispatch 后返回，end 结束，
   * gate 在前台模式等审批。
   *
   * @param {Record<string, any>} ctx
   * @returns {Promise<void>}
   */
  async #advanceInner(ctx) {
    while (!ctx.closed && !ctx.cancelled) {
      const next = ctx.next
      if (next === null) {
        await this.#finish(ctx, 'completed')
        return
      }
      const node = ctx.plan.nodes[next.nodeId]
      if (node === undefined) {
        await this.#fail(ctx, new WorkflowRunError(`workflow node "${next.nodeId}" is missing`))
        return
      }
      if (node.type === 'end') {
        await this.#finish(ctx, node.status ?? 'completed', { nodeId: node.id })
        return
      }
      if (node.type === 'gate') {
        await this.#runGate(ctx, node)
        continue
      }
      if (node.type === 'robot') {
        await this.#startRobotNode(ctx, node, next.edgePrompt)
        return
      }
      await this.#fail(ctx, new WorkflowRunError(`unsupported node type "${String(node.type)}"`))
      return
    }
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
    run.current = {
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
      ...(timeoutMs > 0 ? { timeoutMs } : {}),
    }
    run.status = 'running'
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'node/start', {
      nodeId,
      visit,
      type: 'robot',
      ...(node.robot === undefined ? {} : { robot: node.robot }),
    })
    await this.#saveRunningNodeResult(ctx, node, prompt, startedAt)

    const robots = this.robots ?? this.ctx?.get?.('bukaRobots') ?? null
    if (robots === null || !this.#canDispatch(robots)) {
      await this.#completeNode(
        ctx,
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

    const previous = findRobotSession(run, node.robot)
    const previousSessionId =
      typeof previous?.sessionId === 'string' && previous.sessionId !== '' ? previous.sessionId : ''
    const newSessionId = previousSessionId === '' ? randomUUID() : ''
    const dispatchKey = previousSessionId !== '' ? previousSessionId : newSessionId
    // 先把会话 id 落盘再 dispatch：即使 create 期间宿主退出，恢复时也知道该
    // resume 哪个会话（新会话的 id 是调用方先分配好传给 robots 的）。
    run.current.sessionId = dispatchKey
    run.current.startSeq = null
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
        outputSchema: resultSchemaOf(node),
        routes: routeNamesOf(node),
        title: robotSessionTitle(run, node),
        ...(node.agentOptions === undefined ? {} : { agentOptions: node.agentOptions }),
        approval: 'ask',
        signal: ctx.controller.signal,
        ...(previousSessionId !== '' ? { sessionId: previousSessionId } : { newSessionId }),
      })
    } catch (error) {
      this.dispatchBySession.delete(dispatchKey)
      run.current.sessionId = null
      await this.#completeNode(
        ctx,
        node,
        { sessionId: null, text: '', stopReason: 'error', error: describeError(error) },
        {},
      )
      return
    }

    run.current.sessionId = typeof handle.sessionId === 'string' ? handle.sessionId : null
    run.current.startSeq = Number.isInteger(handle.startSeq) ? handle.startSeq : null
    if (run.current.sessionId !== null) this.rememberSession(run.runId, run.current.sessionId)
    run.current.resumed = handle.resumed === true
    run.current.compacted = handle.compacted === true
    // dispatch 里的 compact 不计入显式硬超时：计时从这一轮真正投递后开始。
    run.current.timeoutStartedAt = Date.now()
    if (typeof handle.resumeError === 'string' && handle.resumeError !== '') {
      run.current.sessionResetReason = handle.resumeError
    }
    if (typeof handle.compactionError === 'string' && handle.compactionError !== '') {
      run.current.compactionError = handle.compactionError
    }
    entry.handle = handle
    entry.startSeq = Number.isInteger(handle.startSeq) ? handle.startSeq : null
    // 防御旧版服务返回不同的 sessionId：把 provisional 键挪到真实 id。
    if (run.current.sessionId !== null && run.current.sessionId !== dispatchKey) {
      this.dispatchBySession.delete(dispatchKey)
      this.dispatchBySession.set(run.current.sessionId, entry)
    }
    rememberSessionEntry(run, node.robot, {
      nodeId,
      visit,
      seq,
      sessionId: run.current.sessionId,
      at: Date.now(),
      resumed: handle.resumed === true,
      compacted: handle.compacted === true,
    })
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'node/session', {
      nodeId,
      visit,
      sessionId: run.current.sessionId,
      resumed: handle.resumed === true,
    })
    await this.store.appendEvent(run.runId, 'node/dispatch', {
      nodeId,
      visit,
      seq,
      sessionId: run.current.sessionId,
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
    const current = ctx.run.current
    if (current === null || current.seq !== entry.seq) return
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
      await this.#completeNode(ctx, node, result, { route: null, workspace })
      return
    }

    const route = resolveRoute(node, result.structured)
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
      await this.#completeNode(ctx, node, result, { route: null, workspace })
      return
    }

    await this.#completeNode(ctx, node, result, { route: route.rule, workspace })
  }

  /**
   * 在同一会话里要求机器人重新提交结果 / 修正 next。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} entry
   * @param {Record<string, any>} node
   * @param {{ reason: string, routes?: string[] }} input
   * @returns {Promise<boolean>} true 表示已经发出重试
   */
  async #retryResult(ctx, entry, node, { reason, routes }) {
    const prompt = entry.handle?.retryReport?.({ reason, routes })
    if (typeof prompt !== 'string' || prompt.trim() === '') return false
    try {
      await entry.handle.send(prompt, { compactFirst: false })
      const nextSeq = entry.handle.startSeq
      entry.startSeq = Number.isInteger(nextSeq) ? nextSeq : entry.startSeq
      if (ctx.run.current !== null) ctx.run.current.startSeq = entry.startSeq
      entry.claimed = false
      await this.#save(ctx)
      this.#armTimeout(ctx, entry)
      await this.store.appendEvent(ctx.runId, 'node/result-retry', {
        nodeId: node.id,
        visit: ctx.run.current?.visit ?? null,
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
   * 正常 / 失败地落一条 robot step，并决定下一节点。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} node
   * @param {Record<string, any>} result
   * @param {{ recovered?: boolean, recoveryAttempts?: number, timedOut?: boolean, route?: Record<string, any> | null }} extra
   * @returns {Promise<void>}
   */
  async #completeNode(ctx, node, result, extra) {
    if (ctx.closed || ctx.cancelled) return
    const run = ctx.run
    const current = run.current
    if (current === null || current.nodeId !== node.id) return
    const sessionId = typeof result.sessionId === 'string' ? result.sessionId : (current.sessionId ?? null)
    const finishedAt = Date.now()
    const startedAt = typeof current.startedAt === 'number' ? current.startedAt : finishedAt
    const preview = truncateUtf8(result.text ?? '', this.options.previewBytes)
    let stopReason = typeof result.stopReason === 'string' ? result.stopReason : 'error'
    const recovered = extra.recovered === true || current.recovered === true
    const recoveryAttempts = Number.isInteger(extra.recoveryAttempts)
      ? extra.recoveryAttempts
      : Number.isInteger(current.recoveryAttempts)
        ? current.recoveryAttempts
        : 0
    let route = extra.route
    if (route === undefined && stopReason === 'completed') {
      const resolved = resolveRoute(node, result.structured)
      if (resolved.error !== undefined) {
        await this.#fail(ctx, new WorkflowRunError(`invalid workflow route: ${resolved.error}`))
        return
      }
      route = resolved.rule
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
        attachmentValues = await this.store.attachmentValues(
          run.runId,
          current.seq,
          node.id,
          nodeAttachments,
        )
        result = {
          ...result,
          structured: { ...result.structured, attachments: nodeAttachments },
        }
      } catch (error) {
        stopReason = 'error'
        route = null
        result = {
          ...result,
          stopReason: 'error',
          error: `could not store node attachments: ${describeError(error)}`,
        }
      }
    }
    const routeName = typeof route?.name === 'string' ? route.name : null
    const routeTo = typeof route?.to === 'string' ? route.to : null
    /** @type {Record<string, any>} */
    const step = {
      seq: current.seq,
      nodeId: node.id,
      visit: current.visit,
      type: 'robot',
      robot: node.robot,
      sessionId,
      status: stopReason === 'completed' ? 'completed' : 'failed',
      stopReason,
      route: routeName,
      routeTo,
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
    run.current = null
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
        status: step.status,
        stopReason,
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
      sessionId,
      resumed: step.resumed,
      compacted: step.compacted,
      ...(step.recovered === true ? { recovered: true } : {}),
      ...(step.timedOut === true ? { timedOut: true } : {}),
    })

    if (stopReason !== 'completed') {
      const message =
        typeof result.error === 'string' && result.error !== ''
          ? result.error
          : `robot node "${node.id}" ended with ${stopReason}`
      run.error = message
      await this.#finish(ctx, 'failed', { nodeId: node.id, message })
      return
    }

    const rule = route
    await this.store.appendEvent(run.runId, 'route', {
      nodeId: node.id,
      route: routeName,
      to: routeTo,
    })
    if (rule === null || rule === undefined) {
      await this.#finish(ctx, 'completed', { nodeId: node.id })
      return
    }
    ctx.next = {
      nodeId: rule.to,
      edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
    }
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
    const current = ctx.run.current
    if (current === null || current.seq !== entry.seq) return
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
        try {
          await handle.dispose?.()
        } catch {
          // 已释放：忽略。
        }
        let result = check
        let route = null
        if (check.structured === undefined) {
          result = {
            ...check,
            stopReason: 'error',
            error: 'the robot session did not submit a structured JSON result',
          }
        } else {
          const resolved = resolveRoute(node, check.structured)
          if (resolved.error !== undefined) {
            result = {
              ...check,
              stopReason: 'error',
              error: `invalid workflow route: ${resolved.error}`,
            }
          } else {
            route = resolved.rule
          }
        }
        await this.#completeNode(ctx, node, result, {
          recovered: true,
          recoveryAttempts: 1,
          route,
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
  // Gate
  // -------------------------------------------------------------------------

  /**
   * 执行一个 gate 节点（仅前台模式）。审批要求调用者会话有活跃 turn。
   *
   * @param {Record<string, any>} ctx
   * @param {Record<string, any>} node
   * @returns {Promise<void>}
   */
  async #runGate(ctx, node) {
    if (ctx.mode !== 'foreground') {
      await this.#fail(ctx, new WorkflowRunError(`gate "${node.id}" requires a foreground run`))
      return
    }
    const approval = this.ctx?.get?.('approval') ?? null
    if (approval === null || typeof approval.request !== 'function') {
      await this.#fail(ctx, new WorkflowRunError('gate node needs the approval service'))
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
    ctx.seq = seq
    ctx.visits.set(node.id, visit)
    run.status = 'waiting'
    run.current = {
      nodeId: node.id,
      visit,
      seq,
      type: 'gate',
      robot: null,
      startedAt,
    }
    run.pendingGate = {
      nodeId: node.id,
      title: node.title,
      detail: node.detail,
      requestedAt: startedAt,
    }
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'gate/waiting', { nodeId: node.id })

    let outcome
    try {
      outcome = await approval.request({
        agent: ctx.agent,
        toolName: 'buka_workflow_gate',
        reason: gateReason(node),
        signal: ctx.controller.signal,
      })
    } catch (error) {
      run.pendingGate = null
      run.current = null
      if (ctx.cancelled === true || ctx.controller.signal.aborted === true) {
        await this.#finish(ctx, 'cancelled', { nodeId: node.id, message: 'gate approval was cancelled' })
        return
      }
      await this.#fail(
        ctx,
        new WorkflowRunError(`gate "${node.id}" approval failed: ${describeError(error)}`, { cause: error }),
      )
      return
    }

    const decision = mapApproval(outcome)
    const finishedAt = Date.now()
    run.pendingGate = null
    run.current = null
    run.status = 'running'
    run.steps.push({
      seq,
      nodeId: node.id,
      visit,
      type: 'gate',
      robot: null,
      sessionId: null,
      status: decision,
      decision,
      startedAt,
      finishedAt,
      text: '',
      error: decision === 'unavailable' ? 'approval unavailable' : null,
    })
    ctx.values[node.id] = { decision }
    await this.#save(ctx)
    await this.store.appendEvent(run.runId, 'gate/decided', { nodeId: node.id, decision })

    if (decision === 'cancelled') {
      await this.#finish(ctx, 'cancelled', { nodeId: node.id, message: 'gate approval was cancelled' })
      return
    }
    if (decision === 'unavailable') {
      await this.#fail(ctx, new WorkflowRunError(`gate "${node.id}" approval is unavailable in this composition`))
      return
    }
    const target = decision === 'approved' ? node.onApprove : node.onReject
    if (target === null || target === undefined) {
      await this.#finish(ctx, decision === 'approved' ? 'completed' : 'rejected', { nodeId: node.id })
      return
    }
    ctx.next = {
      nodeId: target.to,
      edgePrompt: typeof target.prompt === 'string' && target.prompt !== '' ? target.prompt : null,
    }
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
    const current = ctx.run.current
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
    const current = ctx.run.current
    if (current === null || current.seq !== entry.seq) return
    entry.claimed = true
    this.#removeEntry(entry)
    let result = { text: '' }
    try {
      result = (await entry.handle?.cancel?.('timeout')) ?? { text: '' }
    } catch {
      // 会话已经不可读：保留空结果。
    }
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
      (run.pendingGate !== null && run.pendingGate !== undefined) ||
      run.current?.type === 'gate'
    ) {
      await this.store.markInterrupted(
        runId,
        'the run was waiting for approval when the host restarted; gate approvals cannot be recreated',
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
    if (run.status === 'waiting' || planOrder.some((id) => plan.nodes[id]?.type === 'gate')) {
      await this.store.markInterrupted(
        runId,
        'this run contains approval gates; gate approvals need an active caller turn and cannot be recreated after a restart',
      )
      return 'interrupted'
    }
    const ctx = this.#createContext({ run, plan, definition, mode: 'background' })
    // 模板里引用的是完整交付物；run.steps 只留预览，恢复时用节点结果全文覆盖。
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
      currentNode: run.current?.nodeId ?? null,
    })

    const current = run.current
    if (current === null || current === undefined) {
      const next = this.#deriveNext(ctx)
      if (next === null) {
        await this.#finish(ctx, 'completed')
        return 'recovered'
      }
      ctx.next = next
      await this.#advance(ctx)
      return 'recovered'
    }
    if (current.type !== 'robot') {
      await this.store.markInterrupted(runId, `cannot recover a ${String(current.type)} node after a restart`)
      this.runs.delete(runId)
      return 'interrupted'
    }
    if (typeof current.prompt !== 'string' || current.prompt === '') {
      await this.store.markInterrupted(runId, 'this run predates observer recovery data and cannot be resumed safely')
      this.runs.delete(runId)
      return 'interrupted'
    }

    const node = plan.nodes[current.nodeId]
    if (node === undefined) {
      await this.store.markInterrupted(runId, `workflow node "${current.nodeId}" is missing from the definition`)
      this.runs.delete(runId)
      return 'interrupted'
    }
    const robots = this.robots ?? this.ctx?.get?.('bukaRobots') ?? null
    const sessionId = typeof current.sessionId === 'string' ? current.sessionId : ''
    const interrupt = async (message) => {
      await this.store.markInterrupted(runId, message)
      this.runs.delete(runId)
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
        try {
          await handle.dispose?.()
        } catch {
          // 已释放：忽略。
        }
        let result = check
        let route = null
        if (check.structured === undefined) {
          result = {
            ...check,
            stopReason: 'error',
            error: 'the robot session did not submit a structured JSON result',
          }
        } else {
          const resolved = resolveRoute(node, check.structured)
          if (resolved.error !== undefined) {
            result = {
              ...check,
              stopReason: 'error',
              error: `invalid workflow route: ${resolved.error}`,
            }
          } else {
            route = resolved.rule
          }
        }
        await this.#completeNode(ctx, node, result, {
          recovered: true,
          recoveryAttempts: 1,
          route,
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
   * 从最后的 step 推导下一个节点；没有 step 时从 start 的出边开始。
   *
   * @param {Record<string, any>} ctx
   * @returns {{ nodeId: string, edgePrompt: string | null } | null}
   */
  #deriveNext(ctx) {
    const steps = Array.isArray(ctx.run.steps) ? ctx.run.steps : []
    if (steps.length === 0) {
      const startNode = ctx.plan.nodes[ctx.plan.start]
      if (startNode === undefined || startNode.type !== 'start') return null
      const rule = Array.isArray(startNode.next) ? startNode.next[0] : null
      if (rule === null || rule === undefined) return null
      return {
        nodeId: rule.to,
        edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
      }
    }
    const last = steps[steps.length - 1]
    const node = ctx.plan.nodes[last.nodeId]
    if (node === undefined) return null
    if (node.type === 'gate') {
      const decision = typeof last.decision === 'string' ? last.decision : ''
      if (decision === 'approved' || decision === 'rejected') {
        const target = decision === 'approved' ? node.onApprove : node.onReject
        if (target === null || target === undefined) return null
        return {
          nodeId: target.to,
          edgePrompt: typeof target.prompt === 'string' && target.prompt !== '' ? target.prompt : null,
        }
      }
      return null
    }
    const routeName = typeof last.route === 'string' ? last.route : ''
    const edge = (Array.isArray(node.next) ? node.next : []).find((rule) => rule.name === routeName)
    if (edge === undefined) return null
    return {
      nodeId: edge.to,
      edgePrompt: typeof edge.prompt === 'string' && edge.prompt !== '' ? edge.prompt : null,
    }
  }

  // -------------------------------------------------------------------------
  // 收尾
  // -------------------------------------------------------------------------

  /**
   * @param {Record<string, any>} ctx
   * @param {string} status
   * @param {{ nodeId?: string | null, message?: string }} [extra]
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
    run.pendingGate = null
    run.pendingInteraction = null
    run.result = {
      status,
      lastNode: extra.nodeId ?? null,
      ...(extra.message === undefined ? {} : { message: extra.message }),
      ...(status === 'failed' && run.error !== null ? { error: run.error } : {}),
    }
    for (const entry of this.#dispatchEntriesForRun(ctx.runId)) {
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
    if (error instanceof WorkflowCancelledError || ctx.cancelled === true) {
      return await this.#finish(ctx, 'cancelled', {
        nodeId: ctx.run.current?.nodeId ?? null,
        message: describeError(error),
      })
    }
    ctx.run.error = describeError(error)
    this.logger?.warn?.(`buka-workflows: run ${ctx.runId} failed: ${ctx.run.error}`)
    return await this.#finish(ctx, 'failed', { nodeId: ctx.run.current?.nodeId ?? null })
  }

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

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
   * @param {Record<string, any>} node
   * @param {string} prompt
   * @param {number} startedAt
   * @returns {Promise<void>}
   */
  async #saveRunningNodeResult(ctx, node, prompt, startedAt) {
    const current = ctx.run.current
    if (current === null) return
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
      outputSchema: resultSchemaOf(node),
      routes: routeNamesOf(node),
      title: robotSessionTitle(ctx.run, node),
      ...(node.agentOptions === undefined ? {} : { agentOptions: node.agentOptions }),
      approval: 'ask',
      signal: ctx.controller.signal,
      ...(creator === undefined ? {} : { agent: creator }),
      ...(this.options.robotPreset === '' ? {} : { agentPreset: this.options.robotPreset }),
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
    this.#removeEntry(entry)
    try {
      Promise.resolve(entry.handle?.dispose?.()).catch(() => undefined)
    } catch {
      // 已释放：忽略。
    }
  }
}

/**
 * 一个 robot 节点可用于 JSON `next` 的路由键（出边 name）。
 *
 * @param {Record<string, any>} node
 * @returns {string[]}
 */
function routeNamesOf(node) {
  const rules = Array.isArray(node?.next) ? node.next : []
  return rules
    .map((rule) => (typeof rule?.name === 'string' ? rule.name.trim() : ''))
    .filter((name) => name !== '')
}

/**
 * 传给 robots 服务的 structured_output 参数 schema：有出边时必须给 next，
 * 并用 enum 限定为当前节点的路由键。
 *
 * @param {Record<string, any>} node
 * @returns {Record<string, any>}
 */
function resultSchemaOf(node) {
  const routes = routeNamesOf(node)
  const attachmentSchema = {
    type: 'array',
    description:
      'Optional files this node produced. Paths are relative to your workspace (or absolute inside it); the workflow copies each file into this execution\'s node directory. Later nodes can list/read them with buka_workflow_execution_attachment or reference them in a prompt as {{nodes.<node id>.attachments.<index>.path}} (and .text for small text files). Binary files are read by path, not embedded.',
    items: {
      oneOf: [
        { type: 'string', description: 'Path to a file, relative to your workspace.' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: 'Path to a file, relative to your workspace.' },
            name: {
              type: 'string',
              description: 'Optional destination name; defaults to the source file name.',
            },
            description: {
              type: 'string',
              description: 'Optional one-line description shown with the attachment.',
            },
          },
          required: ['path'],
        },
      ],
    },
  }
  if (routes.length === 0) {
    return {
      type: 'object',
      additionalProperties: true,
      properties: { attachments: attachmentSchema },
    }
  }
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      next: {
        type: 'string',
        enum: routes,
        description: 'Route key from the workflow definition; selects the next edge.',
      },
      attachments: attachmentSchema,
    },
    required: ['next'],
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
      ? ` The final JSON object must include "next" set to one of these route names: ${routes.join(', ')}.`
      : ''
  return (
    `Your previous execution of workflow node "${node.id}" was interrupted before it delivered a result (${reason}). ` +
    'Continue from the work already done in this session and finish the assigned task now. ' +
    `When you are done, submit the final JSON object by calling the structured_output tool.${routeText}`
  )
}
