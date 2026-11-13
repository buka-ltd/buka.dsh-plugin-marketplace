/**
 * 启动者会话投递与打工人句柄读取。
 *
 * 开始 / 结束任务的执行者是启动者。启动者可能是普通会话：插件通过宿主
 * `sessionController.resolveAgent(sessionId)`（没有时退回 `agents.get`）拿到 live
 * agent，构造一条用户消息 `followup` 进去，再用 `sessions.flush` 等持久化确认。
 * 这与官方 `@deepseek-ai/dsh-schedule` 的提醒投递是同一机制。
 *
 * 消息形状按 DSH 的 `UserMessage` 结构构造（id / role / content / source）；
 * 不 import `@deepseek-ai/dsh-llm`，避免插件多一个运行时依赖。
 *
 * @module @buka/dsh-plugin-workflows/engine/session
 */

import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'

import type { SessionDelivery, TurnSnapshot, WorkerHandleLike } from './types.ts'
import { describeError } from './types.ts'

/** live agent 的最小形状。 */
interface AgentLike {
  readonly id?: unknown
  readonly session?: unknown
  readonly status?: unknown
  followup?(message: unknown): void
  whenIdle?(): Promise<unknown>
}

/** sessionController.resolveAgent 的返回。 */
interface ResolvedAgentLike {
  readonly agent?: AgentLike
  readonly error?: unknown
}

/** web 层会话控制器的最小形状。 */
interface SessionControllerLike {
  resolveAgent?(sessionId: string): Promise<ResolvedAgentLike>
}

/** agents 注册表的最小形状。 */
interface AgentsRegistryLike {
  get?(sessionId: string): AgentLike | undefined
}

/** 会话存储的最小形状。 */
interface SessionsLike {
  get?(sessionId: string): { readonly seq?: number } | undefined
  flush?(session: unknown): Promise<boolean>
}

/**
 * 构造一条用户消息。
 *
 * @param text 消息正文
 * @returns UserMessage 形状的对象
 */
export function createUserMessage(text: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * 取一个会话的 live agent：先问 web 的 sessionController（会 resume），
 * 再退回 agents 注册表里的 live 实例。
 *
 * @param ctx 插件上下文
 * @param sessionId 会话 id
 * @returns live agent
 * @throws 该组成里无法恢复会话时抛出
 */
export async function resolveLiveAgent(ctx: Context, sessionId: string): Promise<AgentLike> {
  const controller = ctx.get('sessionController') as SessionControllerLike | undefined
  if (
    controller !== undefined &&
    controller !== null &&
    typeof controller.resolveAgent === 'function'
  ) {
    const resolved = await controller.resolveAgent(sessionId)
    if (resolved !== undefined && resolved !== null) {
      if ('error' in resolved && resolved.error !== undefined) {
        throw new Error(
          `cannot resume starter session "${sessionId}": ${describeError(resolved.error)}`,
        )
      }
      if (resolved.agent !== undefined) return resolved.agent
    }
  }
  const agents = ctx.get('agents') as AgentsRegistryLike | undefined
  const live = agents?.get?.(sessionId)
  if (live !== undefined) return live
  throw new Error(
    `cannot resume starter session "${sessionId}" in this composition (no live agent and no sessionController)`,
  )
}

/**
 * 宿主会话投递实现。
 *
 * @param ctx 插件上下文
 * @returns 投递器
 */
export function createHostSessionDelivery(ctx: Context): SessionDelivery {
  return {
    async deliver(sessionId: string, text: string): Promise<number | null> {
      const agent = await resolveLiveAgent(ctx, sessionId)
      const sessions = ctx.get('sessions') as SessionsLike | undefined
      const before = sessions?.get?.(sessionId)
      const startSeq = typeof before?.seq === 'number' ? before.seq : null
      if (typeof agent.followup !== 'function') {
        throw new Error(`starter session "${sessionId}" cannot accept a follow-up message`)
      }
      agent.followup(createUserMessage(text))
      if (typeof sessions?.flush === 'function' && agent.session !== undefined) {
        try {
          await sessions.flush(agent.session)
        } catch {
          // flush 只是持久化确认；消息已进 inbox，投递仍算成功。
        }
      }
      return startSeq
    },
  }
}

/**
 * 读一次打工人句柄的观测结果。
 *
 * @param handle workers 句柄
 * @param sinceSeq 起点 seq
 * @returns 本轮快照
 */
export function readHandleResult(handle: WorkerHandleLike, sinceSeq: number): TurnSnapshot {
  let raw: Record<string, unknown> | undefined
  if (typeof handle.readResult === 'function') {
    const value = handle.readResult({ sinceSeq })
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      raw = value as Record<string, unknown>
    }
  }
  return {
    text: typeof raw?.text === 'string' ? raw.text : '',
    stopReason: typeof raw?.stopReason === 'string' ? raw.stopReason : null,
    turnEnded: raw?.turnEnded === true,
    startSeq:
      typeof raw?.startSeq === 'number' && Number.isInteger(raw.startSeq) ? raw.startSeq : null,
  }
}

/**
 * 读句柄的起点 seq。
 *
 * @param handle workers 句柄
 * @returns 起点 seq；未知时是 null
 */
export function handleStartSeq(handle: WorkerHandleLike): number | null {
  return typeof handle.startSeq === 'number' && Number.isInteger(handle.startSeq)
    ? handle.startSeq
    : null
}

/**
 * 读句柄的会话 id。
 *
 * @param handle workers 句柄
 * @returns 会话 id；未知时是 null
 */
export function handleSessionId(handle: WorkerHandleLike): string | null {
  return typeof handle.sessionId === 'string' && handle.sessionId !== '' ? handle.sessionId : null
}

/**
 * 等待一段会话轮次观测的定时器；返回取消函数。
 *
 * @param intervalMs 轮询间隔
 * @param check 每次轮询的回调；返回 true 时停止
 * @returns 取消函数
 */
export function poll(intervalMs: number, check: () => boolean | Promise<boolean>): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  const tick = async () => {
    if (stopped) return
    let done = false
    try {
      done = await check()
    } catch {
      done = true
    }
    if (stopped || done) return
    timer = setTimeout(tick, intervalMs)
    timer.unref?.()
  }
  timer = setTimeout(tick, intervalMs)
  timer.unref?.()
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}
