/**
 * 引擎依赖的宿主服务形状与公共类型。
 *
 * 跨插件只走服务：robots 服务按 `.tmp/workflow-v4-api.md` 最后一节的契约收窄成
 * 结构类型；启动者会话投递用宿主 `sessionController` / `agents` 的「解析 live
 * agent + followup」能力（与官方 schedule 插件同一机制）。
 *
 * @module @buka/dsh-plugin-workflows/engine/types
 */

import type { Context } from '@deepseek-ai/cordis'

import type { JsonValue } from '../domain/types.ts'
import type { ResolvedOptions } from '../options.ts'
import type { LoggerLike, WorkflowStore } from '../store/index.ts'

/** robots 列表里的一行（本插件只关心执行者契约）。 */
export interface RobotListEntryLike {
  readonly name?: unknown
  readonly driver?: unknown
  readonly program?: unknown
  readonly assistant?: unknown
  readonly description?: unknown
  readonly avatar?: unknown
  readonly path?: unknown
}

/** robots 服务句柄（契约见 API 文档）。 */
export interface RobotHandleLike {
  readonly sessionId?: unknown
  readonly startSeq?: unknown
  readonly resumed?: unknown
  readResult?(options?: { readonly sinceSeq?: number }): unknown
  send?(text: string, options?: unknown): unknown
  cancel?(reason?: string): unknown
  dispose?(): unknown
  getPlanMode?(): unknown
  setPlanMode?(active: boolean): unknown
}

/** robots 服务里本插件用到的部分。 */
export interface RobotsServiceLike {
  list?(): unknown
  avatarMap?(): unknown
  dispatchSession?(request: Record<string, unknown>): unknown
  openSession?(request: Record<string, unknown>): unknown
}

/** 读一次会话观测结果。 */
export interface TurnSnapshot {
  readonly text: string
  readonly stopReason: string | null
  readonly turnEnded: boolean
  readonly startSeq: number | null
}

/** 宿主会话投递：把一段文本作为消息投进启动者会话。 */
export interface SessionDelivery {
  /**
   * 投递一条用户消息；必要时先 resume 同一个会话。
   *
   * @param sessionId 启动者会话 id
   * @param text 消息正文
   * @returns 投递时该会话的起点 seq（用于观察这一轮是否结束）；未知时是 null
   */
  deliver(sessionId: string, text: string): Promise<number | null>
}

/** 引擎依赖。 */
export interface EngineDeps {
  readonly ctx: Context
  readonly store: WorkflowStore
  readonly options: ResolvedOptions
  readonly logger: LoggerLike | undefined
  /** 每次调用时现取 robots 服务（插件可能后装 / 卸载）。 */
  readonly robots: () => RobotsServiceLike | null
  readonly delivery: SessionDelivery
}

/** 引擎对外抛出的输入 / 状态错误。 */
export class WorkflowError extends Error {
  /** 稳定错误码，路由与工具会原样透传。 */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorkflowError'
    this.code = code
  }
}

/** 把任意错误转成一句话。 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 把 JSON 值安全地转成记录对象。 */
export function asJsonRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null
}
