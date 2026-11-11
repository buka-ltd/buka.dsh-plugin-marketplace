/**
 * 宿主重启后的运行恢复：未完成运行逐个尝试续接，无法续接的节点终止运行。
 */

import type { WorkflowEdge, WorkflowPlan } from '../definition.ts'
import { outputProblems } from '../output.ts'
import { resolveAbort, resolveRoutes } from '../routing.ts'
import { WorkflowRunError } from '../run.ts'
import type { WorkflowRunRecord } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import { recoveryPrompt } from './supervisor-resume.ts'
import { rememberSessionEntry } from './supervisor-sessions.ts'
import type { DispatchEntry, RobotHandle, RobotResult } from './supervisor-types.ts'
import {
  describeError,
  isRecord,
  RECOVERABLE_STOP_REASONS,
  RECOVERY_CONCURRENCY,
} from './supervisor-types.ts'

/**
 * 启动恢复：把上次进程留下的 running / waiting 运行接回来。等待用户作答的
 * user 运行没有调用者 turn，无法重建原生提问，直接标 interrupted。
 *
 * @returns
 */
export async function resumeAll(
  host: WorkflowSupervisor,
): Promise<{ recovered: number; interrupted: number }> {
  if (host.disposed) return { recovered: 0, interrupted: 0 }
  // 先把运行记录里的机器人会话索引建好：恢复出来的会话、以及用户随后重新
  // 打开的已结束会话，都要能立刻看到四个只读工具。存储初始化会删掉旧格式
  // 记录，所以等它完成后再强制重建一次，避免把初始化前的临时索引留下。
  if (!host.recovered && host.store.ready !== null && host.store.ready !== undefined) {
    await host.store.ready
    host.sessionIndexPromise = null
    // 初始化可能删掉了旧格式运行，重建前清掉初始化前可能建立的临时映射。
    host.sessionRuns.clear()
  }
  await host.ensureSessionIndex()
  if (host.recovered) return { recovered: 0, interrupted: 0 }
  host.recovered = true
  const robots = await host.waitForRobots()
  if (robots === null || typeof robots.dispatchSession !== 'function') {
    const count = await host.store.markAllInterrupted(
      'the Buka Robots service is unavailable or too old (dispatchSession is missing), so unfinished workflow runs cannot be resumed',
    )
    return { recovered: 0, interrupted: count }
  }
  const runs = await host.store.listUnfinished()
  let recovered = 0
  let interrupted = 0
  let next = 0
  const worker = async () => {
    while (next < runs.length) {
      const run = runs[next]
      next += 1
      if (run === undefined) continue
      try {
        const result = await host.recoverRun(run)
        if (result === 'recovered') recovered += 1
        else if (result === 'interrupted') interrupted += 1
      } catch (error) {
        host.logger?.warn?.(`buka-workflows: 恢复运行 ${run.runId} 失败：${describeError(error)}`)
      }
    }
  }
  const workers = Array.from({ length: Math.min(RECOVERY_CONCURRENCY, runs.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return { recovered, interrupted }
}

/**
 * @param run
 * @returns
 */
export async function recoverRun(
  host: WorkflowSupervisor,
  run: WorkflowRunRecord,
): Promise<'recovered' | 'interrupted' | 'skipped'> {
  const runId = typeof run?.runId === 'string' ? run.runId : ''
  if (runId === '' || host.runs.has(runId)) return 'skipped'
  if (
    run.status === 'waiting' ||
    (run.pendingUser !== null && run.pendingUser !== undefined) ||
    run.current?.type === 'user'
  ) {
    await host.store.markInterrupted(
      runId,
      'the run was waiting for the user when the host restarted; a user-question prompt cannot be recreated',
    )
    return 'interrupted'
  }
  const definition = await host.store.readDefinition(runId)
  const planValue = definition?.plan
  if (!isRecord(planValue) || !isRecord(planValue.nodes)) {
    await host.store.markInterrupted(
      runId,
      'the workflow definition snapshot is missing or corrupt',
    )
    return 'interrupted'
  }
  // 落盘的计划是 validateDefinition 的规范化结果；这里只需按它的形状继续恢复。
  const plan = planValue as unknown as WorkflowPlan
  const planOrder: string[] = Array.isArray(plan.order) ? plan.order : Object.keys(plan.nodes)
  if (run.status === 'waiting' || planOrder.some((id) => plan.nodes[id]?.type === 'user')) {
    await host.store.markInterrupted(
      runId,
      'this run contains user nodes; their questions need an active caller turn and cannot be recreated after a restart',
    )
    return 'interrupted'
  }
  const ctx = host.createContext({ run, plan, definition, mode: 'background' })
  // 模板里引用的是完整最终文本；run.steps 只留预览，恢复时用节点结果全文覆盖。
  try {
    const nodeResults = await host.store.readNodeResults(runId)
    const byKey = new Map(
      nodeResults.map((result) => [`${String(result.seq)}:${String(result.nodeId)}`, result]),
    )
    for (const step of Array.isArray(run.steps) ? run.steps : []) {
      const full = byKey.get(`${String(step.seq)}:${String(step.nodeId)}`)
      if (full === undefined) continue
      const stepNodeId = step.nodeId ?? ''
      const current = ctx.values[stepNodeId]
      if (current === undefined) continue
      if (typeof full.text === 'string' && full.text !== '') current.text = full.text
      if (current.data === null && full.structured !== undefined) current.data = full.structured
      if (Array.isArray(full.attachments)) {
        current.attachments = await host.store.attachmentValues(
          runId,
          typeof step.seq === 'number' && Number.isInteger(step.seq) ? step.seq : 0,
          stepNodeId,
          full.attachments,
        )
      }
    }
  } catch {
    // 节点结果读不出来时退回 step 预览；恢复是否安全由 prompt / session 判定。
  }
  host.runs.set(runId, ctx)
  run.status = 'running'
  run.pendingInteraction = null
  await host.save(ctx)
  await host.store.appendEvent(runId, 'run/recover', {
    status: run.status,
    activeCount: Array.isArray(run.active) ? run.active.length : 0,
  })

  // 并发运行可能有多个活跃会话：逐个恢复；任一失败则整体中断（不新开会话）。
  const actives = Array.isArray(run.active)
    ? run.active.filter((entry) => entry?.type === 'robot')
    : []
  if (actives.length === 0) {
    const frontier = host.deriveFrontier(ctx)
    if (frontier.length === 0) {
      await host.finish(ctx, 'completed')
      return 'recovered'
    }
    ctx.frontier = frontier
    await host.advance(ctx)
    return 'recovered'
  }
  for (const current of actives) {
    const outcome = await host.resumeActive(ctx, current)
    if (outcome !== 'recovered') {
      host.runs.delete(runId)
      return 'interrupted'
    }
  }
  return 'recovered'
}

/**
 * 会话中断 / 异常：只续接同一会话继续；续接失败直接终止节点和运行，不新开会话。
 *
 * @param entry
 * @param reason
 * @returns
 */
export async function recoverNode(
  host: WorkflowSupervisor,
  entry: DispatchEntry,
  reason: string,
): Promise<void> {
  const ctx = host.runs.get(entry.runId)
  if (ctx === undefined || ctx.closed || ctx.cancelled) return
  const current = host.findActive(ctx, entry.seq)
  if (current === null) return
  const node = ctx.plan.nodes[current.nodeId ?? '']
  if (node === undefined) {
    await host.fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`))
    return
  }
  // 中断恢复会重新发 prompt；旧的问题/审批已经无法回答。
  ctx.run.pendingInteraction = null
  // 旧入口标记为已处理：恢复期间迟到的 turn/end 不能再 finalize 这个节点。
  entry.claimed = true
  host.removeEntry(entry)
  try {
    await entry.handle?.dispose?.()
  } catch {
    // 旧句柄已随会话结束：忽略。
  }

  const sessionId = typeof current.sessionId === 'string' ? current.sessionId : ''
  const robots = host.robots ?? host.ctx?.get?.('bukaRobots') ?? null
  const stop = async (
    message: string,
    session: string | null = sessionId === '' ? null : sessionId,
  ): Promise<void> => {
    await host.completeNode(
      ctx,
      current,
      node,
      { sessionId: session, text: '', stopReason: 'error', error: message },
      {},
    )
  }
  if (sessionId === '') {
    await stop(
      `workflow node "${node.id}" has no robot session id; workflow stopped without opening a new session`,
    )
    return
  }
  host.rememberSession(ctx.runId, sessionId)
  if (robots === null || typeof robots.openSession !== 'function') {
    await stop(
      `workflow node "${node.id}" cannot resume robot session "${sessionId}": the Buka Robots service cannot open robot sessions; workflow stopped without opening a new session`,
    )
    return
  }

  current.recoveryAttempts = 1
  current.recovering = true
  await host.save(ctx)
  await host.store.appendEvent(ctx.runId, 'node/recover', {
    nodeId: node.id,
    visit: current.visit,
    attempt: 1,
    reason,
  })

  let handle: RobotHandle | null = null
  try {
    handle = await host.requireVisibleHandle(
      (await robots.openSession(host.sessionRequest(ctx, node, sessionId))) as RobotHandle,
    )
    await host.requireSameSession(handle, sessionId)
    const check = handle.readResult({ sinceSeq: current.startSeq ?? 0 })
    if (
      Number.isInteger(current.startSeq) &&
      check.turnEnded === true &&
      (typeof check.stopReason !== 'string' || !RECOVERABLE_STOP_REASONS.has(check.stopReason))
    ) {
      current.recovering = false
      // 恢复时这一轮其实已经结束：先登记一个 entry，让 plan 门禁和正常结束
      // 路径都能通过它观察 / 清理 plan 模式。
      const recoveredEntry: DispatchEntry = {
        runId: ctx.runId,
        seq: current.seq ?? 0,
        startSeq: current.startSeq ?? null,
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
      host.dispatchBySession.set(sessionId, recoveredEntry)
      let result: RobotResult = check
      let routes: WorkflowEdge[] | null = null
      if (check.structured === undefined) {
        result = {
          ...check,
          stopReason: 'error',
          error: 'the robot session did not submit a structured JSON result',
        }
      } else {
        const abort = resolveAbort(check.structured)
        if (abort?.abort !== undefined) {
          await host.abortNode(ctx, current, node, check, abort.abort.reason, {
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
            const resolved = resolveRoutes<WorkflowEdge>(node, check.structured)
            if (resolved.error !== undefined) {
              result = {
                ...check,
                stopReason: 'error',
                error: `invalid workflow route: ${resolved.error}`,
              }
            } else {
              routes = resolved.rules ?? null
            }
          }
        }
      }
      if (await host.handlePlanGate(ctx, recoveredEntry, current, node, result)) return
      host.clearEntryPlanMode(recoveredEntry)
      host.removeEntry(recoveredEntry)
      try {
        await handle.dispose?.()
      } catch {
        // 已释放：忽略。
      }
      await host.completeNode(ctx, current, node, result, {
        recovered: true,
        recoveryAttempts: 1,
        routes,
        workspace: typeof handle.cwd === 'string' ? handle.cwd : undefined,
      })
      return
    }
    await handle.send(recoveryPrompt(node, reason), { compactFirst: true })
    current.startSeq =
      typeof handle.startSeq === 'number' && Number.isInteger(handle.startSeq)
        ? handle.startSeq
        : current.startSeq
    current.recovering = false
    current.recovered = true
    current.resumed = true
    current.compacted = handle.compacted === true || current.compacted === true
    if (typeof handle.compactionError === 'string' && handle.compactionError !== '') {
      current.compactionError = handle.compactionError
    }
    const recoveredEntry: DispatchEntry = {
      runId: ctx.runId,
      seq: current.seq ?? 0,
      startSeq: current.startSeq ?? null,
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
      nodeId: node.id ?? '',
      visit: current.visit ?? 0,
      seq: current.seq ?? 0,
      sessionId: current.sessionId ?? null,
      at: Date.now(),
      resumed: true,
      compacted: current.compacted === true,
    })
    host.dispatchBySession.set(sessionId, recoveredEntry)
    await host.save(ctx)
    await host.store.appendEvent(ctx.runId, 'node/resume', {
      nodeId: node.id,
      visit: current.visit,
      sessionId: current.sessionId,
      attempt: 1,
    })
    host.armTimeout(ctx, recoveredEntry)
    return
  } catch (error) {
    if (node.mode === 'plan') host.clearEntryPlanMode({ planMode: true, handle })
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
