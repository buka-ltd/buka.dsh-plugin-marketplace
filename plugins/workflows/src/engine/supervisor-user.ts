/**
 * 用户介入节点：在原生提问卡上等用户作答，再把答案写回运行。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { WorkflowNode } from '../definition.ts'
import {
  answersValue,
  buildUserQuestions,
  renderUserDetail,
  resolveUserAnswer,
  WorkflowRunError,
} from '../run.ts'
import type { WorkflowSupervisor } from '../supervisor.ts'
import type { RunContext } from './supervisor-types.ts'
import { describeError, isRecord } from './supervisor-types.ts'

/**
 * 执行一个用户介入节点（仅前台模式）。原生提问卡要求调用者会话有活跃 turn。
 *
 * 用户的选项就是节点的出边（`label` 显示给用户）；`questions` 收集额外的
 * 反馈 / 信息。回答会落成一条 user step，后续 prompt 可以用模板引用答案。
 *
 * @param ctx
 * @param node
 * @returns
 */
export async function runUser(
  host: WorkflowSupervisor,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<void> {
  if (ctx.mode !== 'foreground') {
    await host.fail(ctx, new WorkflowRunError(`user node "${node.id}" requires a foreground run`))
    return
  }
  const userQuestions = host.ctx?.get?.('userQuestions') ?? null
  if (userQuestions === null || typeof userQuestions.ask !== 'function') {
    await host.fail(ctx, new WorkflowRunError('user node needs the user-questions service'))
    return
  }
  const run = ctx.run
  const seq = ctx.seq + 1
  if (seq > ctx.plan.maxSteps) {
    await host.fail(
      ctx,
      new WorkflowRunError(`workflow exceeded its ${ctx.plan.maxSteps}-step limit`),
    )
    return
  }
  const visit = (ctx.visits.get(node.id) ?? 0) + 1
  const startedAt = Date.now()
  let detail: string
  try {
    detail = renderUserDetail(node, ctx.values, ctx.plan, seq, run.runId)
  } catch (error) {
    await host.fail(ctx, error)
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
      options: (Array.isArray(question.options) ? question.options : []).map((option) => ({
        ...option,
      })),
    })),
    requestedAt: startedAt,
    sessionId: typeof ctx.agent?.id === 'string' ? ctx.agent.id : null,
  }
  await host.save(ctx)
  await host.store.appendEvent(run.runId, 'user/waiting', { nodeId: node.id })

  let answer: AskUserQuestionAnswer
  try {
    answer = await userQuestions.ask({
      questions: buildUserQuestions(node, detail),
      // user 节点只在前台运行，调用方会话一定带 agent。
      agent: ctx.agent as Agent,
      signal: ctx.controller.signal,
    })
  } catch (error) {
    run.pendingUser = null
    run.current = null
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
    if (
      ctx.cancelled === true ||
      ctx.controller.signal.aborted === true ||
      code === 'ASK_CANCELLED'
    ) {
      await host.finish(ctx, 'cancelled', {
        nodeId: node.id,
        message: `user node "${node.id}" was cancelled before the user answered`,
      })
      return
    }
    if (code === 'NO_PROVIDER') {
      await host.fail(
        ctx,
        new WorkflowRunError(
          `user node "${node.id}" could not ask the user: no user-questions answerer is available in this composition`,
          { cause: error },
        ),
      )
      return
    }
    await host.fail(
      ctx,
      new WorkflowRunError(
        `user node "${node.id}" could not ask the user: ${describeError(error)}`,
        {
          cause: error,
        },
      ),
    )
    return
  }

  const resolved = resolveUserAnswer(node, answer)
  const finishedAt = Date.now()
  if (resolved.error !== undefined) {
    run.pendingUser = null
    run.current = null
    await host.fail(
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
  await host.save(ctx)
  await host.store.appendEvent(run.runId, 'user/answered', {
    nodeId: node.id,
    ...(cancelled ? { cancelled: true } : { route: route?.name ?? null }),
  })

  if (cancelled) {
    await host.finish(ctx, 'cancelled', {
      nodeId: node.id,
      message: `user node "${node.id}" was submitted without a choice; the run was cancelled`,
    })
    return
  }
  if (route === null) {
    await host.maybeFinish(ctx)
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
