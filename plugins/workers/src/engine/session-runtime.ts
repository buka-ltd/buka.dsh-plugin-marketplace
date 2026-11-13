/**
 * 打工人会话的运行时小工具：等取消落定、组装消息、合并模型路由。
 *
 * 服务是非阻塞的：不再等轮次结束（观察者订阅会话事件），这里只保留真正被
 * 调用到的函数；这些函数不读写服务状态，只操作传进来的 live agent。
 *
 * @module @buka/dsh-plugin-workers/engine/session-runtime
 */

import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandleLike, LiveAgent } from '../service/types.ts'

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
  sourceKind: string = 'buka-worker',
): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: sourceKind },
  }
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
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
