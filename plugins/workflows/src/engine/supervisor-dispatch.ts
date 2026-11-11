/**
 * 机器人节点的 dispatch：创建 / 复用会话、登记句柄、超时与句柄校验。
 */

import { randomUUID } from 'node:crypto'
import type { WorkflowNode } from '../definition.ts'
import { buildResultSchema, routeNamesOf } from '../output.ts'
import { renderNodePrompt, robotSessionTitle, WorkflowRunError } from '../run.ts'
import type { WorkflowActiveNode } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import { findRobotSession, rememberSessionEntry } from './supervisor-sessions.ts'
import type {
  DispatchEntry,
  RobotHandle,
  RobotResult,
  RobotService,
  RunContext,
} from './supervisor-types.ts'
import { describeError, positive } from './supervisor-types.ts'

/**
 * 进入一个 robot 节点：落盘 current + 运行中的节点结果，再非阻塞 dispatch。
 *
 * @param ctx
 * @param node
 * @param edgePrompt
 * @returns
 */
export async function startRobotNode(
  host: WorkflowSupervisor,
  ctx: RunContext,
  node: WorkflowNode,
  edgePrompt: string | null,
): Promise<void> {
  const run = ctx.run
  const nodeId = node.id ?? ''
  const seq = ctx.seq + 1
  if (seq > ctx.plan.maxSteps) {
    await host.fail(
      ctx,
      new WorkflowRunError(`workflow exceeded its ${ctx.plan.maxSteps}-step limit`),
    )
    return
  }
  const visit = (ctx.visits.get(nodeId) ?? 0) + 1
  if (node.type === 'robot' && node.maxVisits !== undefined && visit > node.maxVisits) {
    await host.fail(
      ctx,
      new WorkflowRunError(`robot node "${nodeId}" exceeded its ${node.maxVisits}-visit limit`),
    )
    return
  }
  let prompt: string
  try {
    prompt = renderNodePrompt(node, edgePrompt, ctx.values, ctx.plan, seq, run.runId)
  } catch (error) {
    await host.fail(ctx, error)
    return
  }

  const timeoutMs = positive(node.timeoutMs) ?? positive(host.options.nodeTimeoutMs) ?? 0
  const startedAt = Date.now()
  ctx.seq = seq
  ctx.stepCount = seq
  ctx.visits.set(nodeId, visit)
  // 进入新节点时上一节点遗留的等待提示已经无效。
  run.pendingInteraction = null
  const current: WorkflowActiveNode = {
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
  await host.save(ctx)
  await host.store.appendEvent(run.runId, 'node/start', {
    nodeId,
    visit,
    type: 'robot',
    ...(node.robot === undefined ? {} : { robot: node.robot }),
    ...(node.mode === 'plan' ? { mode: 'plan' } : {}),
  })
  await host.saveRunningNodeResult(ctx, current, node, prompt, startedAt)

  const robots = host.robots ?? host.ctx?.get?.('bukaRobots') ?? null
  if (robots === null || !host.canDispatch(robots)) {
    await host.completeNode(
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
    await host.completeNode(
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
  host.rememberSession(run.runId, dispatchKey)
  await host.save(ctx)
  const entry: DispatchEntry = {
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
  host.dispatchBySession.set(dispatchKey, entry)

  let handle: RobotHandle
  try {
    const creator = host.creatorAgent(ctx)
    handle = await host.dispatchRobot(robots, {
      robot: node.robot,
      prompt,
      ...(creator === undefined ? {} : { agent: creator }),
      ...(host.options.robotPreset === '' ? {} : { agentPreset: host.options.robotPreset }),
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
    host.dispatchBySession.delete(dispatchKey)
    current.sessionId = null
    await host.completeNode(
      ctx,
      current,
      node,
      { sessionId: null, text: '', stopReason: 'error', error: describeError(error) },
      {},
    )
    return
  }

  current.sessionId = typeof handle.sessionId === 'string' ? handle.sessionId : null
  current.startSeq =
    typeof handle.startSeq === 'number' && Number.isInteger(handle.startSeq)
      ? handle.startSeq
      : null
  if (current.sessionId !== null) host.rememberSession(run.runId, current.sessionId)
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
  entry.startSeq =
    typeof handle.startSeq === 'number' && Number.isInteger(handle.startSeq)
      ? handle.startSeq
      : null
  // 防御旧版服务返回不同的 sessionId：把 provisional 键挪到真实 id。
  if (typeof current.sessionId === 'string' && current.sessionId !== dispatchKey) {
    host.dispatchBySession.delete(dispatchKey)
    host.dispatchBySession.set(current.sessionId, entry)
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
  await host.save(ctx)
  await host.store.appendEvent(run.runId, 'node/session', {
    nodeId,
    visit,
    sessionId: current.sessionId,
    resumed: handle.resumed === true,
  })
  await host.store.appendEvent(run.runId, 'node/dispatch', {
    nodeId,
    visit,
    seq,
    sessionId: current.sessionId,
    resumed: handle.resumed === true,
    compacted: handle.compacted === true,
  })

  host.armTimeout(ctx, entry)
  // dispatch 期间已经到达的 turn/end / disposed：现在有 startSeq 了，补处理。
  const early = entry.early.splice(0)
  if (entry.disposedEarly === true) {
    entry.recoveryRequested = true
    void host.enqueue(ctx.runId, () => host.recoverNode(entry, 'the robot session was disposed'))
    return
  }
  for (const item of early) {
    if (item.kind === 'turn') {
      if (
        typeof item.event?.seq === 'number' &&
        entry.startSeq !== null &&
        item.event.seq >= entry.startSeq
      ) {
        void host.enqueue(ctx.runId, () => host.processTurn(entry, item.session, item.event))
      }
    }
  }
}

/**
 * @param robots
 * @param request
 * @returns
 */
export async function dispatchRobot(
  host: WorkflowSupervisor,
  robots: RobotService,
  request: Record<string, unknown>,
): Promise<RobotHandle> {
  const dispatch = robots.dispatchSession
  if (dispatch === undefined)
    throw new WorkflowRunError('the Buka Robots service cannot dispatch sessions')
  const handle = await host.requireVisibleHandle((await dispatch(request)) as RobotHandle)
  if (typeof handle?.resumeError === 'string' && handle.resumeError !== '') {
    await host.rejectHandle(
      handle,
      `the Buka Robots service replaced an unresumable robot session with a new one (${handle.resumeError}); workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`,
    )
  }
  if (typeof request.sessionId === 'string' && request.sessionId !== '') {
    await host.requireSameSession(handle, request.sessionId)
  }
  return handle
}

/**
 * 只有显式配置了 timeoutMs 才计时；默认不设 timer。
 *
 * @param ctx
 * @param entry
 * @returns
 */
export function armTimeout(host: WorkflowSupervisor, ctx: RunContext, entry: DispatchEntry): void {
  const current = host.findActive(ctx, entry.seq)
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
    void host.enqueue(ctx.runId, () => host.onTimeout(ctx, entry, timeoutMs))
  }, remaining)
  entry.timer.unref?.()
}

/**
 * 显式超时：取消当前轮，把节点记成超时失败；不进入恢复重试。
 *
 * @param ctx
 * @param entry
 * @param timeoutMs
 * @returns
 */
export async function onTimeout(
  host: WorkflowSupervisor,
  ctx: RunContext,
  entry: DispatchEntry,
  timeoutMs: number,
): Promise<void> {
  if (ctx.closed || ctx.cancelled || entry.claimed === true) return
  const current = host.findActive(ctx, entry.seq)
  if (current === null) return
  entry.claimed = true
  host.removeEntry(entry)
  let result: RobotResult = { text: '' }
  try {
    // cancel 的返回值在旧版服务里可能缺失，缺省按空结果处理。
    result = ((await entry.handle?.cancel?.('timeout')) as RobotResult | undefined) ?? {
      text: '',
    }
  } catch {
    // 会话已经不可读：保留空结果。
  }
  // 取消落定后再清 plan 模式：此时 turn 已关闭，set(false) 能直接提交。
  host.clearEntryPlanMode(entry)
  try {
    await entry.handle?.dispose?.()
  } catch {
    // 已释放：忽略。
  }
  const node = ctx.plan.nodes[current.nodeId ?? '']
  if (node === undefined) {
    await host.fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`))
    return
  }
  await host.store.appendEvent(ctx.runId, 'node/timeout', {
    nodeId: node.id,
    visit: current.visit,
    timeoutMs,
  })
  await host.completeNode(
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
 * 工作流只接受可见的普通会话。旧版 robots 插件在创建失败时可能返回
 * `mode: 'subagent'` 的隐藏句柄；这里先释放它，再让节点按失败结束，
 * 绝不把它当成节点会话继续调度。
 *
 * @param handle
 * @returns
 */
export async function requireVisibleHandle(
  host: WorkflowSupervisor,
  handle: RobotHandle,
): Promise<RobotHandle> {
  if (handle?.mode !== 'subagent') return handle
  return await host.rejectHandle(
    handle,
    'the Buka Robots service returned a hidden subagent session; workflow robot sessions must be visible top-level sessions. Upgrade @buka/dsh-plugin-robots.',
  )
}

/**
 * 旧版 robots 服务在续接失败时可能换一个新会话：`resumeError` 非空，或
 * 返回的 sessionId 与请求的不一致。工作流不接受替代会话。
 *
 * @param handle
 * @param sessionId
 * @returns
 */
export async function requireSameSession(
  host: WorkflowSupervisor,
  handle: RobotHandle,
  sessionId: string,
): Promise<void> {
  if (typeof handle?.resumeError === 'string' && handle.resumeError !== '') {
    await host.rejectHandle(
      handle,
      `the Buka Robots service replaced an unresumable robot session with a new one (${handle.resumeError}); workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`,
    )
  }
  if (handle?.sessionId !== sessionId) {
    await host.rejectHandle(
      handle,
      `the Buka Robots service returned robot session "${String(handle?.sessionId)}" instead of the requested "${sessionId}"; workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`,
    )
  }
}

/**
 * 释放一个不可接受的句柄，并让调用方以明确的错误终止节点。
 *
 * @param handle
 * @param message
 * @returns
 */
export async function rejectHandle(
  _host: WorkflowSupervisor,
  handle: RobotHandle,
  message: string,
): Promise<never> {
  try {
    await handle?.dispose?.()
  } catch {
    // 已释放：忽略。
  }
  throw new WorkflowRunError(message)
}
