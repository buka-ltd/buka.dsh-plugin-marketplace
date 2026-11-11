/**
 * 观察者的生命周期：启动 / 取消 / 释放运行，以及机器人服务接入。
 */

import { toToolRun, WorkflowRunError } from '../run.ts'
import { WORKFLOW_FORMAT_VERSION } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import type { RobotService, StartInput } from './supervisor-types.ts'
import { createRunId, describeError } from './supervisor-types.ts'

/**
 * 注入 robots 服务；晚到时会唤醒等待启动恢复的调用方。
 *
 * @param robots
 * @returns
 */
export function attachRobots(host: WorkflowSupervisor, robots: unknown): void {
  if (host.disposed || robots === undefined || robots === null) return
  host.robots = robots as RobotService
  const waiters = host.robotsWaiters.splice(0)
  for (const waiter of waiters) waiter(robots as RobotService)
}

/**
 * 确保「机器人会话 → 运行」索引已从落盘运行记录构建。
 *
 * 工具可见性条件在每一步都会调用它；构建只做一次，失败只记警告并保留已有
 * 映射，避免一个坏运行记录让整个会话的 step preparation 失败。
 *
 * @returns
 */
export async function ensureSessionIndex(host: WorkflowSupervisor): Promise<void> {
  // 存储初始化会清理旧格式运行；不要在它完成前把索引固定下来。初始化失败时
  // 只隐藏只读工具，不能让每个会话的 step preparation 跟着失败。
  if (host.store.ready !== null && host.store.ready !== undefined) {
    try {
      await host.store.ready
    } catch (error) {
      host.logger?.warn?.(
        `buka-workflows: 运行存储初始化失败，跳过机器人会话索引：${describeError(error)}`,
      )
      host.sessionIndexPromise = Promise.resolve()
      return
    }
  }
  if (host.sessionIndexPromise === null) {
    host.sessionIndexPromise = host.buildSessionIndex().catch((error) => {
      host.logger?.warn?.(`buka-workflows: 构建机器人会话索引失败：${describeError(error)}`)
    })
  }
  await host.sessionIndexPromise
}

/**
 * 查一个机器人会话属于哪次运行；不属于任何运行（例如手动机器人会话）时返回
 * null。
 *
 * @param sessionId
 * @returns
 */
export function sessionRun(host: WorkflowSupervisor, sessionId: string): { runId: string } | null {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  return host.sessionRuns.get(sessionId) ?? null
}

/**
 * 记录一个机器人会话所属运行。运行结束后仍保留：用户从侧边栏重新打开会话时，
 * 四个只读工具仍然可用。
 *
 * @param runId
 * @param sessionId
 * @returns
 */
export function rememberSession(host: WorkflowSupervisor, runId: string, sessionId: string): void {
  if (typeof runId !== 'string' || runId === '') return
  if (typeof sessionId !== 'string' || sessionId === '') return
  host.sessionRuns.set(sessionId, { runId })
}

/**
 * 启动一次运行。
 *
 * 后台模式在第一个节点 dispatch 后返回；前台模式（含 user 节点）返回 `done`
 * promise，调用方 await 到终止状态。
 *
 * @param input 计划、定义快照、创建者 agent 与可选信号 / 回调
 * @returns 终态运行记录，或后台运行的 { run, runId, seq }
 */
export async function start(
  host: WorkflowSupervisor,
  input: StartInput,
): Promise<Record<string, unknown>> {
  const { plan, definition, agent, mode = 'background', signal, onRunCreated } = input
  if (typeof agent?.id !== 'string' || agent.id === '') {
    throw new WorkflowRunError('a workflow run needs the creating agent')
  }
  if (mode === 'background' && plan.order.some((id) => plan.nodes[id]?.type === 'user')) {
    throw new WorkflowRunError('user nodes require a foreground run with an active caller turn')
  }
  const runId = createRunId()
  const seq = await host.store.allocateSeq()
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
  await host.store.create({ run, definition, plan })
  onRunCreated?.(runId)

  const ctx = host.createContext({
    run,
    plan,
    definition,
    mode,
    agent,
    signal,
  })
  host.runs.set(runId, ctx)
  if (ctx.cancelled) {
    await host.enqueue(runId, () =>
      host.finish(ctx, 'cancelled', { message: 'workflow caller aborted' }),
    )
    return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
  }

  const startNode = plan.nodes[plan.start]
  if (startNode === undefined) {
    await host.enqueue(runId, () =>
      host.fail(ctx, new WorkflowRunError('workflow start node is missing')),
    )
    return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
  }
  if (startNode.type !== 'start') {
    await host.enqueue(runId, () =>
      host.fail(ctx, new WorkflowRunError('workflow start node is not a start node')),
    )
    return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
  }
  const startEdges = Array.isArray(startNode.next) ? startNode.next : []
  if (startEdges.length === 0) {
    await host.enqueue(runId, () =>
      host.fail(ctx, new WorkflowRunError('start node has no outgoing edge')),
    )
    return mode === 'foreground' ? await ctx.done.promise : { run, runId, seq }
  }
  ctx.frontier = startEdges.map((rule) => ({
    nodeId: rule.to,
    edgePrompt: typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null,
  }))
  // start 节点多出边是无条件 fan-out：据此激活 join（启动子集）。
  if (startEdges.length > 1)
    host.activateJoins(
      ctx,
      startEdges.map((rule) => rule.to),
    )
  await host.enqueue(runId, () => host.advanceInner(ctx))
  if (mode === 'foreground') return await ctx.done.promise
  return { run, runId, seq }
}

/**
 * 取消一次仍在观察中的运行。
 *
 * @param runId
 * @param [reason]
 * @returns
 */
export async function cancel(
  host: WorkflowSupervisor,
  runId: string,
  reason = 'cancelled by the workflow orchestrator',
): Promise<boolean> {
  const ctx = host.runs.get(runId)
  if (ctx === undefined) {
    // 观察者没有接管这个 run（例如恢复失败或插件刚加载）：直接落成中断。
    const run = await host.store.readRun(runId)
    if (run !== null && (run.status === 'running' || run.status === 'waiting')) {
      return await host.store.markInterrupted(runId, reason)
    }
    return false
  }
  ctx.cancelled = true
  try {
    ctx.controller.abort(reason)
  } catch {
    // 已经中止：忽略。
  }
  await host.enqueue(runId, async () => {
    if (!ctx.closed) await host.finish(ctx, 'cancelled', { message: reason })
  })
  return true
}

/**
 * 插件卸载：取消活动轮次、清定时器，但保留 running 记录供下次加载恢复。
 *
 * @returns
 */
export async function dispose(host: WorkflowSupervisor): Promise<void> {
  if (host.disposed) return
  host.disposed = true
  for (const off of host.unsubscribes ?? []) {
    try {
      off()
    } catch {
      // 已解除：忽略。
    }
  }
  host.unsubscribes = null
  for (const ctx of host.runs.values()) {
    for (const entry of host.dispatchEntriesForRun(ctx.runId)) {
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
  host.runs.clear()
  host.dispatchBySession.clear()
  host.sessionRuns.clear()
  host.queues.clear()
}

// -------------------------------------------------------------------------
// 事件订阅
// -------------------------------------------------------------------------
