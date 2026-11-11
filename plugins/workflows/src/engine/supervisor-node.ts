/**
 * 机器人节点的完成：写 step / 附件 / 结果，并按路由决定下一步。
 */

import type { AttachmentManifestEntry } from '../attachments.ts'
import type { WorkflowEdge, WorkflowNode } from '../definition.ts'
import { resolveAbort, resolveRoutes } from '../routing.ts'
import { WorkflowRunError } from '../run.ts'
import type { WorkflowActiveNode, WorkflowStep } from '../run-store.ts'
import { truncateUtf8 } from '../run-store.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import { updateRobotSession } from './supervisor-sessions.ts'
import type { NodeExtra, RobotResult, RunContext } from './supervisor-types.ts'
import { describeError, isRecord } from './supervisor-types.ts'

/**
 * 正常 / 失败地落一条 robot step，并把它的出口（单线或 fan-out）推进 frontier，
 * 同时更新 join 屏障：并发 fan-out 激活 join、任务完成喂给引用它的 join。
 *
 * @param ctx
 * @param current 要终结的活跃节点
 * @param node
 * @param result
 * @param extra
 * @returns
 */
export async function completeNode(
  host: WorkflowSupervisor,
  ctx: RunContext,
  current: WorkflowActiveNode,
  node: WorkflowNode,
  result: RobotResult,
  extra: NodeExtra,
): Promise<void> {
  if (ctx.closed || ctx.cancelled) return
  const run = ctx.run
  const sessionId =
    typeof result.sessionId === 'string' ? result.sessionId : (current.sessionId ?? null)
  const finishedAt = Date.now()
  const startedAt = typeof current.startedAt === 'number' ? current.startedAt : finishedAt
  const preview = truncateUtf8(result.text ?? '', host.options.previewBytes)
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
      await host.fail(
        ctx,
        new WorkflowRunError(`invalid workflow result: ${resolvedAbort.error.message}`),
      )
      return
    } else {
      const resolved = resolveRoutes<WorkflowEdge>(node, result.structured)
      if (resolved.error !== undefined) {
        await host.fail(ctx, new WorkflowRunError(`invalid workflow route: ${resolved.error}`))
        return
      }
      routes = resolved.rules ?? null
    }
  }
  // 附件只在节点正常完成时落盘。复制失败属于节点输出不完整：把节点改成
  // error，而不是带着缺失的附件继续路由。
  let nodeAttachments: AttachmentManifestEntry[] = []
  let attachmentValues: Array<Record<string, unknown>> = []
  const structured = isRecord(result.structured) ? result.structured : null
  if (stopReason === 'completed' && structured !== null && structured.attachments !== undefined) {
    try {
      nodeAttachments = await host.store.writeNodeAttachments(
        run.runId,
        current.seq ?? 0,
        node.id ?? '',
        structured.attachments,
        { workspace: extra.workspace },
      )
      attachmentValues = await host.store.attachmentValues(
        run.runId,
        current.seq ?? 0,
        node.id ?? '',
        nodeAttachments,
      )
      result = {
        ...result,
        structured: { ...structured, attachments: nodeAttachments },
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
  const routeName =
    routeList.length === 1 && typeof routeList[0]?.name === 'string' ? routeList[0].name : null
  const routeTo =
    routeList.length === 1 && typeof routeList[0]?.to === 'string' ? routeList[0].to : null
  const step: WorkflowStep = {
    seq: current.seq,
    nodeId: node.id ?? '',
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
  host.removeActive(ctx, current)
  run.pendingInteraction = null
  run.updatedAt = finishedAt
  ctx.stepCount = run.steps.length
  ctx.values[node.id ?? ''] = {
    text: typeof result.text === 'string' ? result.text : '',
    data: result.structured ?? null,
    robot: node.robot,
    sessionId: sessionId ?? '',
    route: routeName,
    attachments: attachmentValues,
  }
  updateRobotSession(run, node.robot, {
    nodeId: node.id ?? '',
    visit: current.visit ?? 0,
    sessionId,
    at: finishedAt,
  })
  const fullText = truncateUtf8(result.text ?? '', host.options.maxNodeTextBytes)
  const promptText = truncateUtf8(current.prompt ?? '', host.options.maxNodeTextBytes)
  try {
    await host.store.saveNodeResult(run.runId, current.seq ?? 0, node.id ?? '', {
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
      ...(step.sessionResetReason === undefined
        ? {}
        : { sessionResetReason: step.sessionResetReason }),
      ...(step.recovered === true
        ? { recovered: true, recoveryAttempts: step.recoveryAttempts }
        : {}),
      ...(step.timedOut === true ? { timedOut: true } : {}),
      prompt: promptText.text,
      promptTruncated: promptText.truncated,
      text: fullText.text,
      textTruncated: fullText.truncated,
      startedAt,
      finishedAt,
    })
  } catch (error) {
    host.logger?.warn?.(
      `buka-workflows: 保存节点结果失败（${run.runId}/${node.id}）：${describeError(error)}`,
    )
  }
  host.disposeEntry(ctx, sessionId)
  await host.save(ctx)
  await host.store.appendEvent(run.runId, 'node/end', {
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
    await host.finish(ctx, 'failed', { nodeId: node.id, message, aborted })
    return
  }

  // 单线 / fan-out：把出口推进 frontier，并据此激活 join（并发 fan-out 的启动子集）。
  if (routeList.length > 0) {
    const targets = routeList.map((rule) => rule.to)
    if (routeList.length > 1) host.activateJoins(ctx, targets)
    for (const rule of routeList) {
      await host.store.appendEvent(run.runId, 'route', {
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
  await host.contributeJoins(ctx, node.id)
  await host.advanceInner(ctx)
}
