/**
 * 中断节点的续跑：在原会话里发续跑提示，续接失败则终止节点。
 */

import type { WorkflowEdge, WorkflowNode } from '../definition.ts'
import { outputProblems, routeNamesOf } from '../output.ts'
import { resolveAbort, resolveRoutes } from '../routing.ts'
import type { WorkflowActiveNode } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import { rememberSessionEntry } from './supervisor-sessions.ts'
import type { DispatchEntry, RobotHandle, RobotResult, RunContext } from './supervisor-types.ts'
import { describeError, RECOVERABLE_STOP_REASONS } from './supervisor-types.ts'

export async function resumeActive(
  host: WorkflowSupervisor,
  ctx: RunContext,
  current: WorkflowActiveNode,
): Promise<'recovered' | 'interrupted'> {
  const runId = ctx.runId
  const run = ctx.run
  if (current.type !== 'robot') {
    await host.store.markInterrupted(
      runId,
      `cannot recover a ${String(current.type)} node after a restart`,
    )
    return 'interrupted'
  }
  if (typeof current.prompt !== 'string' || current.prompt === '') {
    await host.store.markInterrupted(
      runId,
      'this run predates observer recovery data and cannot be resumed safely',
    )
    return 'interrupted'
  }
  const node = ctx.plan.nodes[current.nodeId ?? '']
  if (node === undefined) {
    await host.store.markInterrupted(
      runId,
      `workflow node "${current.nodeId ?? ''}" is missing from the definition`,
    )
    return 'interrupted'
  }
  const robots = host.robots ?? host.ctx?.get?.('bukaRobots') ?? null
  const sessionId = typeof current.sessionId === 'string' ? current.sessionId : ''
  const interrupt = async (message: string): Promise<'interrupted'> => {
    await host.store.markInterrupted(runId, message)
    return 'interrupted'
  }
  if (sessionId === '') {
    return await interrupt(
      `workflow node "${node.id}" has no robot session id; workflow stopped without opening a new session`,
    )
  }
  host.rememberSession(runId, sessionId)
  if (robots === null || typeof robots.openSession !== 'function') {
    return await interrupt(
      `workflow node "${node.id}" cannot resume robot session "${sessionId}": the Buka Robots service cannot open robot sessions; workflow stopped without opening a new session`,
    )
  }
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
      const recoveredEntry: DispatchEntry = {
        runId,
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
      if (await host.handlePlanGate(ctx, recoveredEntry, current, node, result)) return 'recovered'
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
      return 'recovered'
    }
    await handle.send(recoveryPrompt(node, 'the host restarted before this node finished'), {
      compactFirst: true,
    })
    current.startSeq =
      typeof handle.startSeq === 'number' && Number.isInteger(handle.startSeq)
        ? handle.startSeq
        : current.startSeq
    current.recovering = false
    current.recovered = true
    current.resumed = true
    current.recoveryAttempts = 1
    const entry: DispatchEntry = {
      runId,
      seq: current.seq ?? 0,
      recoveryRequested: false,
      startSeq: current.startSeq ?? null,
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
      nodeId: node.id ?? '',
      visit: current.visit ?? 0,
      seq: current.seq ?? 0,
      sessionId: current.sessionId ?? null,
      at: Date.now(),
      resumed: true,
      compacted: current.compacted === true,
    })
    host.dispatchBySession.set(sessionId, entry)
    await host.save(ctx)
    await host.store.appendEvent(runId, 'node/resume', {
      nodeId: node.id,
      visit: current.visit,
      sessionId: current.sessionId,
      attempt: 1,
      reason: 'host restart',
    })
    host.armTimeout(ctx, entry)
    return 'recovered'
  } catch (error) {
    if (node.mode === 'plan') host.clearEntryPlanMode({ planMode: true, handle })
    try {
      await handle?.dispose?.()
    } catch {
      // 已释放：忽略。
    }
    host.dispatchBySession.delete(sessionId)
    host.logger?.warn?.(
      `buka-workflows: 恢复运行 ${runId} 的会话 ${sessionId} 失败，终止运行：${describeError(error)}`,
    )
    return await interrupt(
      `workflow node "${node.id}" could not resume robot session "${sessionId}" after restart: ${describeError(error)}; workflow stopped without opening a new session`,
    )
  }
}

/**
 * 会话中断后发进同一会话的续跑提示。
 *
 * @param node
 * @param reason
 * @returns
 */
export function recoveryPrompt(node: WorkflowNode, reason: string): string {
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
