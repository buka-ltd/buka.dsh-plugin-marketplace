/**
 * 机器人会话一轮结束后的处理：读结果、校验路由、计划模式门禁与重试。
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkflowEdge, WorkflowNode } from '../definition.ts'
import { outputProblems, routeNamesOf } from '../output.ts'
import { resolveAbort, resolveRoutes } from '../routing.ts'
import { WorkflowRunError } from '../run.ts'
import type { WorkflowActiveNode } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import type {
  DispatchEntry,
  NodeExtra,
  RetryResultInput,
  RobotResult,
  RunContext,
} from './supervisor-types.ts'
import { describeError, PLAN_REVIEW_NUDGE, RECOVERABLE_STOP_REASONS } from './supervisor-types.ts'

/**
 * 处理一次 `turn/end`：读结果、校验 JSON/next、正常完成或异常恢复。
 *
 * @param entry
 * @param session
 * @param event
 * @returns
 */
export async function processTurn(
  host: WorkflowSupervisor,
  entry: DispatchEntry,
  _session: Session,
  event: SessionEvent,
): Promise<void> {
  if (entry.claimed === true) return
  entry.claimed = true
  if (entry.timer !== null) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  const ctx = host.runs.get(entry.runId)
  if (ctx === undefined || ctx.closed || ctx.cancelled) return
  const current = host.findActive(ctx, entry.seq)
  if (current === null) return
  if (entry.startSeq !== null && typeof event.seq === 'number' && event.seq < entry.startSeq) {
    entry.claimed = false
    return
  }
  const node = ctx.plan.nodes[current.nodeId ?? '']
  if (node === undefined) {
    await host.fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`))
    return
  }

  const handle = entry.handle
  if (handle === null) return
  let result: RobotResult
  try {
    result = await handle.readResult({ sinceSeq: entry.startSeq ?? 0 })
  } catch (error) {
    entry.claimed = false
    entry.recoveryRequested = true
    await host.recoverNode(
      entry,
      `could not read the robot session result: ${describeError(error)}`,
    )
    return
  }

  // 主动终止优先于中断恢复：节点已经明确说无法完成时，不必再把同一会话接
  // 起来；即使这一轮以 aborted / interrupted / error 结束，abort 也是最强的
  // 意图。
  const abort = result.structured === undefined ? null : resolveAbort(result.structured)
  if (abort?.abort !== undefined) {
    if (ctx.run.pendingInteraction !== null) {
      ctx.run.pendingInteraction = null
      await host.save(ctx)
    }
    await host.abortNode(ctx, current, node, result, abort.abort.reason, {
      workspace: typeof entry.handle?.cwd === 'string' ? entry.handle.cwd : undefined,
    })
    return
  }

  if (
    typeof result.stopReason === 'string' &&
    RECOVERABLE_STOP_REASONS.has(result.stopReason) &&
    result.stopReason !== 'completed'
  ) {
    entry.claimed = false
    entry.recoveryRequested = true
    await host.recoverNode(entry, `the robot session ended with ${result.stopReason}`)
    return
  }

  if (ctx.run.pendingInteraction !== null) {
    ctx.run.pendingInteraction = null
    await host.save(ctx)
  }
  // plan 节点先过模式门禁：计划还没被批准时，这一轮的结果不能当作节点结果
  // 路由；用户关闭审阅时保持等待，机器人自己停在计划阶段时给一次提示。
  if (await host.handlePlanGate(ctx, entry, current, node, result)) return
  const workspace = typeof entry.handle?.cwd === 'string' ? entry.handle.cwd : undefined

  // 所有 robot 节点都必须交回 JSON；缺失或 next 不合法时在同一会话里重试，
  // 重试次数由 robots 服务的 resultRetries 控制。
  if (result.structured === undefined) {
    if (
      await host.retryResult(ctx, entry, node, {
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
    await host.completeNode(ctx, current, node, result, { routes: null, workspace })
    return
  }

  // next / abort 同时出现，或 abort 的形态不合法：在同一会话里追问。
  if (abort?.error !== undefined) {
    if (
      await host.retryResult(ctx, entry, node, {
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
    await host.completeNode(ctx, current, node, result, { routes: null, workspace })
    return
  }

  // 结果 JSON 必须匹配节点在定义里声明的 output；不匹配时在同一会话里追问，
  // 额度与 missing-json / invalid-next 共用。
  const problems = outputProblems(node, result.structured)
  if (problems.length > 0) {
    const detail = problems.slice(0, 3).join('; ')
    if (
      await host.retryResult(ctx, entry, node, {
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
    await host.completeNode(ctx, current, node, result, { routes: null, workspace })
    return
  }

  const route = resolveRoutes<WorkflowEdge>(node, result.structured)
  if (route.error !== undefined) {
    if (
      await host.retryResult(ctx, entry, node, {
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
    await host.completeNode(ctx, current, node, result, { routes: null, workspace })
    return
  }

  await host.completeNode(ctx, current, node, result, { routes: route.rules, workspace })
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
 * @param ctx
 * @param entry
 * @param current
 * @param node
 * @param result
 * @returns true 表示已处理，调用方不要再路由
 */
export async function handlePlanGate(
  host: WorkflowSupervisor,
  ctx: RunContext,
  entry: DispatchEntry,
  current: WorkflowActiveNode,
  node: WorkflowNode,
  result: RobotResult,
): Promise<boolean> {
  if (node.mode !== 'plan') return false
  const planState =
    typeof entry.handle?.getPlanMode === 'function' ? entry.handle.getPlanMode() : null
  if (planState?.active !== true) return false

  if (entry.planReviewAsked === true) {
    // 用户关闭审阅去自己写回复：plan 模式仍开启，下一轮由用户的消息驱动。
    entry.planReviewAsked = false
    entry.claimed = false
    await host.save(ctx)
    host.armTimeout(ctx, entry)
    await host.store.appendEvent(ctx.runId, 'node/plan-review-wait', {
      nodeId: current.nodeId,
      visit: current.visit,
    })
    return true
  }

  const handle = entry.handle
  if (entry.planNudged !== true && handle !== null && typeof handle.send === 'function') {
    // 先记标记再投递：新 turn 的 turn/end 即使抢在 await 返回前到达，也不会
    // 再发第二次提示。
    entry.planNudged = true
    try {
      const next = await handle.send(PLAN_REVIEW_NUDGE, { compactFirst: false })
      entry.startSeq = typeof next === 'number' && Number.isInteger(next) ? next : entry.startSeq
      current.startSeq = entry.startSeq
      entry.claimed = false
      await host.save(ctx)
      host.armTimeout(ctx, entry)
      await host.store.appendEvent(ctx.runId, 'node/plan-review-nudge', {
        nodeId: current.nodeId,
        visit: current.visit,
      })
      return true
    } catch (error) {
      entry.planNudged = false
      host.logger?.warn?.(
        `buka-workflows: could not ask the robot to present its plan（${ctx.runId}/${node.id}）：${describeError(error)}`,
      )
    }
  }

  await host.completeNode(
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
 * @param ctx
 * @param entry
 * @param node
 * @param input
 * @returns true 表示已经发出重试
 */
export async function retryResult(
  host: WorkflowSupervisor,
  ctx: RunContext,
  entry: DispatchEntry,
  node: WorkflowNode,
  input: RetryResultInput,
): Promise<boolean> {
  const { reason, routes, detail } = input
  const handle = entry.handle
  const prompt = handle?.retryReport?.({ reason, routes, detail, abortable: true })
  if (handle === null || typeof prompt !== 'string' || prompt.trim() === '') return false
  try {
    await handle.send(prompt, { compactFirst: false })
    const nextSeq = handle.startSeq
    entry.startSeq =
      typeof nextSeq === 'number' && Number.isInteger(nextSeq) ? nextSeq : entry.startSeq
    const current = host.findActive(ctx, entry.seq)
    if (current !== null) current.startSeq = entry.startSeq
    entry.claimed = false
    await host.save(ctx)
    host.armTimeout(ctx, entry)
    await host.store.appendEvent(ctx.runId, 'node/result-retry', {
      nodeId: node.id,
      visit: current?.visit ?? null,
      reason,
      routes,
    })
    return true
  } catch (error) {
    host.logger?.warn?.(
      `buka-workflows: 重新要求机器人提交结果失败（${ctx.runId}/${node.id}）：${describeError(error)}`,
    )
    return false
  }
}

/**
 * 把节点主动终止落成一条失败的 robot step，并结束整个运行（fail-fast 取消其余分支）。
 *
 * @param ctx
 * @param current 要终结的活跃节点
 * @param node
 * @param result
 * @param reason 节点给出的无法完成原因
 * @param [extra]
 * @returns
 */
export async function abortNode(
  host: WorkflowSupervisor,
  ctx: RunContext,
  current: WorkflowActiveNode,
  node: WorkflowNode,
  result: RobotResult,
  reason: string,
  extra: NodeExtra = {},
): Promise<void> {
  await host.completeNode(
    ctx,
    current,
    node,
    { ...result, stopReason: 'aborted', error: reason },
    { ...extra, routes: null, aborted: true },
  )
}
