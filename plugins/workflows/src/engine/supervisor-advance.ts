/**
 * 运行推进：按边路由到下一个节点，并在全部结束时收尾。
 */

import type { WorkflowNode } from '../definition.ts'
import { toToolRun, WorkflowCancelledError, WorkflowRunError } from '../run.ts'
import type { WorkflowRunRecord } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import type { FinishExtra, RunContext } from './supervisor-types.ts'
import { describeError } from './supervisor-types.ts'

/**
 * @param ctx
 * @returns
 */
export function advance(host: WorkflowSupervisor, ctx: RunContext): Promise<unknown> {
  return host.enqueue(ctx.runId, () => host.advanceInner(ctx))
}

/**
 * 消费 frontier 里的待处理 next-hop：robot 节点 dispatch 后继续（非阻塞），
 * user 节点在前台模式等用户作答，end 收尾一个分支；join 不进入 frontier（由
 * 屏障激活）。frontier 与活跃任务都为空时结束运行。
 *
 * @param ctx
 * @returns
 */
export async function advanceInner(host: WorkflowSupervisor, ctx: RunContext): Promise<void> {
  while (!ctx.closed && !ctx.cancelled && ctx.frontier.length > 0) {
    const next = ctx.frontier.shift()
    if (next === undefined) break
    const node = ctx.plan.nodes[next.nodeId]
    if (node === undefined) {
      await host.fail(ctx, new WorkflowRunError(`workflow node "${next.nodeId}" is missing`))
      return
    }
    if (node.type === 'end') {
      await host.arriveEnd(ctx, node)
      continue
    }
    if (node.type === 'user') {
      await host.runUser(ctx, node)
      continue
    }
    if (node.type === 'robot') {
      await host.startRobotNode(ctx, node, next.edgePrompt)
      continue
    }
    if (node.type === 'join') {
      await host.fail(
        ctx,
        new WorkflowRunError(`join node "${node.id}" must not be reached directly`),
      )
      return
    }
    await host.fail(ctx, new WorkflowRunError(`unsupported node type "${String(node.type)}"`))
    return
  }
  await host.maybeFinish(ctx)
}

/**
 * 一个分支到达 end：记录该分支终止。所有活跃任务与待处理 next-hop 都清空、
 * 且没有 pending join 时才结束整个运行。
 *
 * @param ctx
 * @param node
 * @returns
 */
export async function arriveEnd(
  host: WorkflowSupervisor,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<void> {
  if (ctx.closed || ctx.cancelled) return
  ctx.lastEnd = node
  await host.maybeFinish(ctx)
}

/**
 * 没有任何活跃任务 / 待处理 next-hop / pending join 时收尾。
 *
 * @param ctx
 * @returns
 */
export async function maybeFinish(host: WorkflowSupervisor, ctx: RunContext): Promise<void> {
  if (ctx.closed || ctx.cancelled) return
  if (ctx.frontier.length > 0) return
  if (Array.isArray(ctx.run.active) && ctx.run.active.length > 0) return
  if (ctx.run.pendingUser !== null && ctx.run.pendingUser !== undefined) return
  if (ctx.joins.size > 0) return
  const lastEnd = ctx.lastEnd ?? null
  const nodeId = lastEnd !== null && typeof lastEnd.id === 'string' ? lastEnd.id : null
  const status =
    lastEnd !== null && typeof lastEnd.status === 'string' ? lastEnd.status : 'completed'
  await host.finish(ctx, status, { nodeId })
}

// -------------------------------------------------------------------------
// Robot 节点
// -------------------------------------------------------------------------

/**
 * @param ctx
 * @param status
 * @param [extra]
 * @returns
 */
export async function finish(
  host: WorkflowSupervisor,
  ctx: RunContext,
  status: string,
  extra: FinishExtra = {},
): Promise<WorkflowRunRecord> {
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
  for (const entry of host.dispatchEntriesForRun(ctx.runId)) {
    host.clearEntryPlanMode(entry)
    host.removeEntry(entry)
    try {
      await entry.handle?.dispose?.()
    } catch {
      // 已释放：忽略。
    }
  }
  try {
    await host.save(ctx)
    await host.store.appendEvent(ctx.runId, 'run/end', { status, result: run.result })
  } catch (error) {
    host.logger?.warn?.(
      `buka-workflows: 写入运行结束状态失败（${ctx.runId}）：${describeError(error)}`,
    )
  }
  host.runs.delete(ctx.runId)
  if (!ctx.done.settled) ctx.done.resolve(toToolRun(run))
  return run
}

/**
 * @param ctx
 * @param error
 * @returns
 */
export async function fail(
  host: WorkflowSupervisor,
  ctx: RunContext,
  error: unknown,
): Promise<WorkflowRunRecord> {
  if (ctx.closed) return ctx.run
  const activeNodeId = host.activeNodeId(ctx)
  if (error instanceof WorkflowCancelledError || ctx.cancelled === true) {
    return await host.finish(ctx, 'cancelled', {
      nodeId: activeNodeId,
      message: describeError(error),
    })
  }
  ctx.run.error = describeError(error)
  host.logger?.warn?.(`buka-workflows: run ${ctx.runId} failed: ${ctx.run.error}`)
  return await host.finish(ctx, 'failed', { nodeId: activeNodeId })
}
