/**
 * 观察者的共享状态操作：运行上下文、dispatch 台账、步骤落盘与 join 推进的
 * 底层读写。
 */

import type { WorkflowNode } from '../definition.ts'
import { buildResultSchema, routeNamesOf } from '../output.ts'
import { answersValue, robotSessionTitle } from '../run.ts'
import type { WorkflowActiveNode } from '../run-store.ts'
import { truncateUtf8 } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import type {
  ContextInput,
  DispatchEntry,
  FrontierItem,
  RobotService,
  RunContext,
} from './supervisor-types.ts'
import { deferred, describeError, isRecord, ROBOTS_WAIT_MS } from './supervisor-types.ts'

/**
 * @param input 运行记录、计划、定义快照、模式、agent 与可选信号
 * @returns 本次运行的观察上下文
 */
export function createContext(host: WorkflowSupervisor, input: ContextInput): RunContext {
  const { run, plan, definition, mode, agent, signal } = input
  const ctx: RunContext = {
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
    done: deferred<Record<string, unknown>>(),
    cancelled: false,
    closed: false,
  }
  // 旧记录用 run.current（单活跃节点）；并发后统一为 run.active 数组。就地迁移，
  // 让升级前仍在跑的运行能继续恢复。
  if (!Array.isArray(ctx.run.active)) {
    ctx.run.active =
      ctx.run.current !== null && ctx.run.current !== undefined ? [ctx.run.current] : []
    ctx.run.current = null
  }
  host.rebuildFromSteps(ctx)
  if (signal !== undefined) {
    if (signal.aborted === true) {
      ctx.cancelled = true
      ctx.controller.abort('workflow caller aborted')
    } else {
      signal.addEventListener(
        'abort',
        () => {
          void host.cancel(ctx.runId, 'cancelled by the workflow caller')
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
 * @param ctx
 * @returns
 */
export function rebuildFromSteps(_host: WorkflowSupervisor, ctx: RunContext): void {
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
 * @param runId
 * @param task
 * @returns
 */
export function enqueue(
  host: WorkflowSupervisor,
  runId: string,
  task: () => Promise<unknown>,
): Promise<unknown> {
  const previous = host.queues.get(runId) ?? Promise.resolve()
  const next = previous.then(task, task).catch((error) => {
    const ctx = host.runs.get(runId)
    host.logger?.warn?.(`buka-workflows: run ${runId} 推进失败：${describeError(error)}`)
    if (ctx !== undefined && !ctx.closed) return host.fail(ctx, error)
    return undefined
  })
  host.queues.set(runId, next)
  const cleanup = () => {
    if (host.queues.get(runId) === next) host.queues.delete(runId)
  }
  next.then(cleanup, cleanup)
  return next
}

/**
 * 从已落盘的 step 推导恢复后的 frontier（没有 step 时从 start 的全部出边开始）。
 *
 * @param ctx
 * @returns
 */
export function deriveFrontier(_host: WorkflowSupervisor, ctx: RunContext): FrontierItem[] {
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
  if (last === undefined) return []
  const node = ctx.plan.nodes[last.nodeId ?? '']
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
 * 当前（第一个）活跃节点的 id，用于失败 / 取消记录里的 lastNode。
 *
 * @param ctx
 * @returns
 */
export function activeNodeId(_host: WorkflowSupervisor, ctx: RunContext): string | null {
  const active = Array.isArray(ctx.run.active) ? ctx.run.active : []
  const first = active.find((entry) => typeof entry?.nodeId === 'string')
  return first !== undefined ? (first.nodeId ?? null) : null
}

// -------------------------------------------------------------------------
// 小工具
// -------------------------------------------------------------------------

/**
 * 按序号在 run.active 里找活跃的机器人节点。
 *
 * @param ctx
 * @param seq
 * @returns
 */
export function findActive(
  _host: WorkflowSupervisor,
  ctx: RunContext,
  seq: number,
): WorkflowActiveNode | null {
  const active = Array.isArray(ctx.run.active) ? ctx.run.active : []
  return active.find((entry) => entry?.seq === seq) ?? null
}

/**
 * 从 run.active 里移除一个已终结的活跃节点。
 *
 * @param ctx
 * @param current
 * @returns
 */
export function removeActive(
  _host: WorkflowSupervisor,
  ctx: RunContext,
  current: WorkflowActiveNode,
): void {
  if (!Array.isArray(ctx.run.active)) return
  const index = ctx.run.active.findIndex((entry) => entry === current || entry?.seq === current.seq)
  if (index >= 0) ctx.run.active.splice(index, 1)
}

/**
 * 并发 fan-out 激活 join：把每个 join 的「本次启动子集」（inputs ∩ 已启动任务）
 * 记为待完成集合。join 放行条件就是这些任务全部完成；没被启动的 input 不计入。
 *
 * @param ctx
 * @param startedIds 本次 fan-out 启动的任务节点 id
 * @returns
 */
export function activateJoins(
  _host: WorkflowSupervisor,
  ctx: RunContext,
  startedIds: string[],
): void {
  const started = new Set(startedIds)
  for (const id of ctx.plan.order) {
    const node = ctx.plan.nodes[id]
    if (node === undefined || node.type !== 'join') continue
    const awaiting = new Set((node.inputs ?? []).filter((input) => started.has(input)))
    if (awaiting.size > 0) ctx.joins.set(id, awaiting)
  }
}

/**
 * 一个任务完成：喂给引用它的所有 join，等待集合清空的 join 放行一次（沿唯一出边
 * 推进 frontier）。不在这里调用 #advanceInner，由 #completeNode 收尾统一推进。
 *
 * @param ctx
 * @param nodeId 完成的任务节点 id
 * @returns
 */
export async function contributeJoins(
  host: WorkflowSupervisor,
  ctx: RunContext,
  nodeId: string,
): Promise<void> {
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
    await host.store.appendEvent(ctx.runId, 'join/fire', { joinId })
  }
}

/**
 * @param ctx
 * @returns
 */
export async function save(host: WorkflowSupervisor, ctx: RunContext): Promise<void> {
  ctx.run.updatedAt = Date.now()
  await host.store.save(ctx.run)
}

/**
 * @param ctx
 * @param current 活跃节点
 * @param node
 * @param prompt
 * @param startedAt
 * @returns
 */
export async function saveRunningNodeResult(
  host: WorkflowSupervisor,
  ctx: RunContext,
  current: WorkflowActiveNode,
  node: WorkflowNode,
  prompt: string,
  startedAt: number,
): Promise<void> {
  const promptText = truncateUtf8(prompt, host.options.maxNodeTextBytes)
  try {
    await host.store.saveNodeResult(ctx.runId, current.seq ?? 0, node.id ?? '', {
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
    host.logger?.warn?.(
      `buka-workflows: 保存运行中节点结果失败（${ctx.runId}/${node.id}）：${describeError(error)}`,
    )
  }
}

/**
 * @param ctx
 * @param node
 * @param sessionId
 * @returns
 */
export function sessionRequest(
  host: WorkflowSupervisor,
  ctx: RunContext,
  node: WorkflowNode,
  sessionId: string,
): Record<string, unknown> {
  const creator = host.creatorAgent(ctx)
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
    ...(host.options.robotPreset === '' ? {} : { agentPreset: host.options.robotPreset }),
    // 恢复时不强行改变 plan 状态：plan 节点保留会话日志里的状态（批准后可能
    // 已经退出）；普通节点清掉可能残留的 plan 模式。
    ...(node.mode === 'plan' ? {} : { planMode: false }),
  }
}

/**
 * @param ctx
 * @returns
 */
export function creatorAgent(host: WorkflowSupervisor, ctx: RunContext): unknown {
  const agents: unknown = host.ctx?.get?.('agents') ?? host.ctx?.agents
  if (!isRecord(agents) || typeof agents.get !== 'function') return undefined
  const sessionId = ctx.run?.createdBy?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  try {
    const get = agents.get as (id: string) => unknown
    return get(sessionId) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 观察者需要非阻塞的 dispatchSession；旧版 robots 只有 startSession（会自己
 * await 一轮），不能交给观察者，所以明确按失败处理并提示升级。
 *
 * @param robots
 * @returns
 */
export function canDispatch(
  _host: WorkflowSupervisor,
  robots: RobotService | null | undefined,
): boolean {
  return typeof robots?.dispatchSession === 'function'
}

/**
 * @param runId
 * @returns
 */
export function dispatchEntriesForRun(host: WorkflowSupervisor, runId: string): DispatchEntry[] {
  return [...host.dispatchBySession.values()].filter((entry) => entry.runId === runId)
}

/**
 * @param entry
 * @returns
 */
export function removeEntry(host: WorkflowSupervisor, entry: DispatchEntry): void {
  if (entry.timer !== null) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  for (const [key, value] of host.dispatchBySession) {
    if (value === entry) host.dispatchBySession.delete(key)
  }
}

/**
 * 节点结束 / 运行终止时尽力关闭该 entry 进入的 plan 模式。
 *
 * 失败只记日志：模式清理不能改变节点结果；下一次进入同一机器人时 supervisor
 * 会按节点的 `mode` 重新归一，所以这里只是避免把 plan 状态留在用户可见的
 * 会话里。超时 / 取消时 turn 可能还没关闭，`set(false)` 会排队；不影响结果。
 *
 * @param entry
 * @returns
 */
export function clearEntryPlanMode(
  host: WorkflowSupervisor,
  entry: Pick<DispatchEntry, 'planMode' | 'handle'>,
): void {
  if (entry?.planMode !== true) return
  entry.planMode = false
  const handle = entry.handle
  if (handle === null || handle === undefined || typeof handle.setPlanMode !== 'function') return
  try {
    handle.setPlanMode(false)
  } catch (error) {
    host.logger?.warn?.(
      `buka-workflows: could not leave plan mode for the robot session: ${describeError(error)}`,
    )
  }
}

/**
 * @returns
 */
export async function waitForRobots(host: WorkflowSupervisor): Promise<RobotService | null> {
  if (host.robots !== null) return host.robots
  const existing = host.ctx?.get?.('bukaRobots') ?? null
  if (existing !== null) {
    host.attachRobots(existing)
    return existing
  }
  return await new Promise<RobotService | null>((resolve) => {
    let timer: NodeJS.Timeout
    const finish = (value: RobotService | null): void => {
      clearTimeout(timer)
      const index = host.robotsWaiters.indexOf(waiter)
      if (index >= 0) host.robotsWaiters.splice(index, 1)
      resolve(value)
    }
    const waiter = (robots: RobotService): void => finish(robots)
    host.robotsWaiters.push(waiter)
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
 * @returns
 */
export async function buildSessionIndex(host: WorkflowSupervisor): Promise<void> {
  const remember = (runId: string, sessionId: unknown): void => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    host.sessionRuns.set(sessionId, { runId })
  }
  for (const runId of await host.store.listRunIds()) {
    const run = await host.store.readRun(runId)
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
