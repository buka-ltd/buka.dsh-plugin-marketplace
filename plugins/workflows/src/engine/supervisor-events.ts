/**
 * 观察者的事件订阅：会话事件、人类交互旁听与会话释放清理。
 */

import { randomUUID } from 'node:crypto'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkflowSupervisor } from '../supervisor.ts'
import { clipText, normalizeQuestions } from './supervisor-sessions.ts'
import type { DispatchEntry, RunContext } from './supervisor-types.ts'
import { describeError, isRecord, MAX_EARLY_EVENTS } from './supervisor-types.ts'

/** 注册全局事件订阅。 */
export function subscribe(host: WorkflowSupervisor): void {
  if (typeof host.ctx?.on !== 'function') return
  const offs = []
  try {
    offs.push(
      host.ctx.on('session/event', (session, event) => host.onSessionEvent(session, event), {
        global: true,
      }),
    )
  } catch {
    // 老运行时没有 global 选项：退回普通订阅。
    offs.push(host.ctx.on('session/event', (session, event) => host.onSessionEvent(session, event)))
  }
  offs.push(host.ctx.on('session/disposed', (session) => host.onSessionDisposed(session)))
  offs.push(host.ctx.on('agent/disposed', (payload) => host.onAgentDisposed(payload)))
  // 人类交互（提问 / 工具审批）发生在机器人会话自己的 turn 里；观察者只旁听
  // 用来给运行页一个「正在等用户」的提示，必须排在真正的 answerer 之前并
  // 原样把 next() 交回去。
  for (const event of ['user-questions/request', 'approval/request'] as const) {
    try {
      offs.push(
        host.ctx.on(
          event as 'user-questions/request',
          (request, next) => host.onHumanRequest(event, request, next),
          {
            prepend: true,
          },
        ),
      )
    } catch {
      // 老运行时没有 prepend 选项：不注册，机器人自身仍然能正常提问/审批。
    }
  }
  host.unsubscribes = offs
}

/**
 * 旁听机器人会话里的提问 / 审批，记录成 run.pendingInteraction，供运行页展示。
 *
 * 不截胡：先调用 `next()` 让真正的 answerer（Web UI / 自动审批）处理，再异步
 * 记录/清除；返回值原样交回 waterfall。
 *
 * @param event
 * @param request
 * @param next
 * @returns
 */
export function onHumanRequest<T>(
  host: WorkflowSupervisor,
  event: string,
  request: unknown,
  next: () => T,
): T {
  const answer = next()
  if (host.disposed) return answer
  const requestRecord = isRecord(request) ? request : {}
  const agent = isRecord(requestRecord.agent) ? requestRecord.agent : null
  const agentId = agent !== null ? agent.id : undefined
  const entry = typeof agentId === 'string' ? host.dispatchBySession.get(agentId) : undefined
  if (entry === undefined) return answer
  const ctx = host.runs.get(entry.runId)
  if (ctx === undefined || ctx.closed || ctx.cancelled) return answer
  const interactionId = randomUUID()
  const kind = event === 'approval/request' ? 'approval' : 'question'
  // 计划审阅是 DSH plan 模式在机器人会话里弹出的原生问题卡。它和普通问题
  // 一样记录等待提示，但 supervisor 还要靠这个标志区分「用户关闭了审阅、
  // 正在自己回复」与「机器人自己停在计划阶段」。
  const planReview =
    event === 'user-questions/request' &&
    Array.isArray(requestRecord.questions) &&
    (requestRecord.questions as unknown[]).some(
      (question) =>
        isRecord(question) && isRecord(question.intent) && question.intent.kind === 'plan-review',
    )
  if (planReview) entry.planReviewAsked = true
  void host.enqueue(entry.runId, () =>
    host.recordInteraction(ctx, entry, kind, request, interactionId, planReview),
  )
  const settle = () => {
    void host.enqueue(entry.runId, () => host.clearInteraction(ctx, interactionId))
  }
  Promise.resolve(answer).then(settle, settle)
  return answer
}

/**
 * 把一次提问 / 审批写进运行记录。
 *
 * @param ctx
 * @param entry
 * @param kind
 * @param request
 * @param interactionId
 * @param [planReview]
 * @returns
 */
export async function recordInteraction(
  host: WorkflowSupervisor,
  ctx: RunContext,
  entry: DispatchEntry,
  kind: 'question' | 'approval',
  request: unknown,
  interactionId: string,
  planReview = false,
): Promise<void> {
  if (ctx.closed || ctx.cancelled) return
  const current = host.findActive(ctx, entry.seq)
  if (current === null) return
  const requestRecord = isRecord(request) ? request : {}
  const questions = kind === 'question' ? normalizeQuestions(requestRecord.questions) : undefined
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
    ...(planReview ? { planReview: true } : {}),
    ...(questions === undefined ? {} : { questions }),
    ...(kind === 'approval'
      ? {
          toolName: clipText(requestRecord.toolName, 120),
          reason: clipText(requestRecord.reason, 2000),
          displayReason: clipText(requestRecord.displayReason, 1000) || undefined,
          callId: typeof requestRecord.callId === 'string' ? requestRecord.callId : undefined,
        }
      : {}),
  }
  try {
    await host.save(ctx)
    await host.store.appendEvent(ctx.runId, 'interaction/asked', {
      kind,
      nodeId: current.nodeId,
      visit: current.visit,
      sessionId: current.sessionId ?? null,
    })
  } catch (error) {
    // 等待提示只是观测增强：落盘失败不能影响机器人会话本身。
    host.logger?.warn?.(`buka-workflows: 保存等待中的交互失败：${describeError(error)}`)
  }
}

/**
 * 清除一次提问 / 审批；id 不匹配时说明已经有新的交互，不能误清。
 *
 * @param ctx
 * @param interactionId
 * @returns
 */
export async function clearInteraction(
  host: WorkflowSupervisor,
  ctx: RunContext,
  interactionId: string,
): Promise<void> {
  if (ctx.closed) return
  if (ctx.run.pendingInteraction?.id !== interactionId) return
  ctx.run.pendingInteraction = null
  try {
    await host.save(ctx)
    await host.store.appendEvent(ctx.runId, 'interaction/settled', { id: interactionId })
  } catch (error) {
    host.logger?.warn?.(`buka-workflows: 清除等待中的交互失败：${describeError(error)}`)
  }
}

/**
 * @param session
 * @param event
 * @returns
 */
export function onSessionEvent(
  host: WorkflowSupervisor,
  session: Session,
  event: SessionEvent,
): void {
  if (host.disposed || event?.type !== 'turn/end') return
  const sessionId = typeof session?.id === 'string' ? session.id : ''
  if (sessionId === '') return
  const entry = host.dispatchBySession.get(sessionId)
  if (entry === undefined) return
  if (entry.startSeq === null) {
    if (entry.early.length < MAX_EARLY_EVENTS) entry.early.push({ kind: 'turn', session, event })
    return
  }
  if (typeof event.seq !== 'number' || event.seq < entry.startSeq) return
  void host.enqueue(entry.runId, () => host.processTurn(entry, session, event))
}

/**
 * @param session
 * @returns
 */
export function onSessionDisposed(host: WorkflowSupervisor, session: Session): void {
  if (host.disposed) return
  const sessionId = typeof session?.id === 'string' ? session.id : ''
  const entry = sessionId === '' ? undefined : host.dispatchBySession.get(sessionId)
  if (entry === undefined || entry.claimed === true || entry.recoveryRequested === true) return
  if (entry.startSeq === null) {
    entry.disposedEarly = true
    return
  }
  entry.recoveryRequested = true
  void host.enqueue(entry.runId, () => host.recoverNode(entry, 'the robot session was disposed'))
}

/**
 * @param payload
 * @returns
 */
export function onAgentDisposed(host: WorkflowSupervisor, payload: unknown): void {
  const payloadRecord = isRecord(payload) ? payload : {}
  const agentRecord = isRecord(payloadRecord.agent) ? payloadRecord.agent : null
  const session = agentRecord?.session ?? payloadRecord.session ?? null
  if (session === null || session === undefined) return
  host.onSessionDisposed(session as Session)
}

// -------------------------------------------------------------------------
// 运行上下文与队列
// -------------------------------------------------------------------------

/**
 * 从 dispatch 表里移除并释放这一轮的句柄。
 *
 * @param ctx
 * @param sessionId
 * @returns
 */
export function disposeEntry(
  host: WorkflowSupervisor,
  ctx: RunContext,
  sessionId: string | null,
): void {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const entry = host.dispatchBySession.get(sessionId)
  if (entry === undefined || entry.runId !== ctx.runId) return
  host.clearEntryPlanMode(entry)
  host.removeEntry(entry)
  try {
    Promise.resolve(entry.handle?.dispose?.()).catch(() => undefined)
  } catch {
    // 已释放：忽略。
  }
}
