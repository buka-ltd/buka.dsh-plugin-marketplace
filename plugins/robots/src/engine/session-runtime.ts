/**
 * 机器人会话的运行时小工具：等轮次结束、等取消落定、组装消息、合并模型路由。
 *
 * 超时 / 取消统一用 `RobotSessionStop` 表达；这些函数不读写服务状态，只操作
 * 传进来的 live agent。
 *
 * @module @buka/dsh-plugin-robots/engine/session-runtime
 */

import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandleLike, LiveAgent } from '../service/types.ts'
import { RobotSessionStop } from './errors.ts'

/** 取消后等待 agent 落定（写入 turn/end）的最长时间。 */
const SETTLE_AFTER_CANCEL_MS = 2000

/**
 * 从 composition 里取一个可选服务：先走 `ctx.get`（cordis 里表示服务可以
 * 不存在），拿不到再读直接挂载的同名字段（旧式 / 测试替身上下文）。服务形状
 * 以本文件实际调用为准。
 *
 * 直接属性读取在 cordis 里表示「必需注入」：服务不存在、或被 `isolate`
 * 隔离在别的作用域时，会抛 `cannot get property "…" without inject`。可选
 * 服务的缺失是正常状态，绝不能把异常带进调用方，所以这里把整段读取包进
 * try/catch，失败时按不存在处理。
 */
export function optionalService<T>(ctx: Context, name: string): T | undefined {
  const viaGet = ctx?.get?.(name)
  if (viaGet !== undefined) return viaGet as T
  try {
    return (ctx as unknown as Record<string, unknown>)?.[name] as T | undefined
  } catch {
    // 直接属性读取被 cordis 的注入检查拒绝：按服务不存在处理。
    return undefined
  }
}

/**
 * 一件完整的 user 消息：`followup` 要求 `role` 与 `id`，否则会话历史在请求
 * 模型时无法转换成消息。
 *
 */
export function followupMessage(
  text: string,
  sourceKind: string = 'buka-robot',
): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: sourceKind },
  }
}

/**
 * 等待 agent 空闲；超时 / 取消时抛 `RobotSessionStop`。
 *
 */
export function waitForIdle(
  agent: LiveAgent,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = () => finish(new RobotSessionStop('aborted', 'robot session was cancelled'))
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(
        () =>
          finish(new RobotSessionStop('timeout', `robot session timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
    }
    Promise.resolve(agent.whenIdle()).then(
      () => finish(undefined),
      (error) => finish(new RobotSessionStop('aborted', describeError(error))),
    )
  })
}

/**
 * 等这一轮真正结束（`turn/end`），而不是仅仅等 agent 空闲。
 *
 * 续接会话时 agent 在 followup 之前就是 idle 的，单等 `whenIdle()` 可能在
 * 新一轮还没开起来时立刻返回，读到上一轮的旧文本。先挂事件监听、再投递消息，
 * 就能拿到这一轮的结束事件；没有事件源（测试替身 / 老运行时）时退回 `whenIdle()`。
 *
 */
export function waitForTurnEnd(
  agent: LiveAgent,
  startSeq: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let off: (() => void) | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      try {
        off?.()
      } catch {
        // 会话已经释放：忽略。
      }
    }
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = () => finish(new RobotSessionStop('aborted', 'robot session was cancelled'))
    const hasTurnEnd = () => {
      try {
        const events =
          typeof agent?.session?.ownEvents === 'function' ? agent.session.ownEvents() : []
        for (const event of events) {
          if (event?.type === 'turn/end' && typeof event.seq === 'number' && event.seq >= startSeq)
            return true
        }
      } catch {
        // 读不到事件时退回 idle 判定。
      }
      return false
    }

    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(
        () =>
          finish(new RobotSessionStop('timeout', `robot session timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
    }

    if (hasTurnEnd()) {
      finish(undefined)
      return
    }

    if (typeof agent?.ctx?.on === 'function') {
      try {
        off = agent.ctx.on('session/event', (session, event) => {
          if (session !== undefined && agent?.session !== undefined && session !== agent.session)
            return
          if (event?.type !== 'turn/end') return
          if (typeof event.seq === 'number' && event.seq < startSeq) return
          finish(undefined)
        })
      } catch {
        off = undefined
      }
    }

    if (off === undefined) {
      // 没有事件源时退回原来的语义；startSeq 过滤保证不会把旧轮次当成本轮结果。
      waitForIdle(agent, timeoutMs, signal).then(
        () => finish(undefined),
        (error) =>
          finish(
            error instanceof RobotSessionStop
              ? error
              : new RobotSessionStop('aborted', describeError(error)),
          ),
      )
    }
  })
}

/**
 * 取消后给 agent 一点时间落定 turn/end，避免读不到最后的文本。
 *
 */
export async function waitForSettle(agent: LiveAgent): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      Promise.resolve(agent.whenIdle()),
      new Promise((resolve) => {
        timer = setTimeout(resolve, SETTLE_AFTER_CANCEL_MS)
      }),
    ])
  } catch {
    // 忽略：结果读取有兜底。
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 */
export async function disposeHandle(handle: AgentHandleLike): Promise<void> {
  try {
    await handle.dispose()
  } catch {
    // 已释放或释放失败都不应该让调用方拿不到结果。
  }
}

/**
 * 合并模型路由。
 *
 */
export function mergeAgentOptions(
  defaults: { provider?: string; model?: string; reasoningEffort?: string },
  overrides:
    | { provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number }
    | undefined,
): { provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number } {
  const merged = { ...defaults }
  if (overrides === undefined || overrides === null) return merged
  // 值直接透传（与原实现一致），最后按合并后的路由类型返回。
  const entries = overrides as Record<string, unknown>
  const target = merged as Record<string, unknown>
  for (const key of ['provider', 'model', 'reasoningEffort', 'maxTokens']) {
    const value = entries[key]
    if (value === undefined || value === null) continue
    target[key] = value
  }
  return merged
}

/**
 */
export function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
