/**
 * 观察者的类型、常量与构造原语。
 *
 * 运行上下文、会话句柄、dispatch 登记项等内部形状都在这里；上层模块只通过
 * `WorkflowSupervisor` 的字段与方法协作。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkflowEdge, WorkflowNode, WorkflowPlan } from '../definition.ts'
import type { WorkflowRunRecord, WorkflowRunStore } from '../run-store.ts'

/** 判断普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 观察者的节点超时 / 文本限额选项（入口解析好之后传进来）。 */
export interface SupervisorOptions {
  nodeTimeoutMs: number
  maxNodeTextBytes: number
  previewBytes: number
  robotPreset: string
}

/** 可选日志器；参数形态与 Cordis Logger 一致。 */
export interface SupervisorLogger {
  readonly warn?: (...args: unknown[]) => void
  readonly info?: (...args: unknown[]) => void
}

/** 构造参数。 */
export interface SupervisorInit {
  ctx: Context
  store: WorkflowRunStore
  options?: Record<string, unknown> | undefined
  logger?: SupervisorLogger | undefined
}

/** 运行模式：后台（工具立即返回）或前台（含 user 节点，等终态）。 */
export type RunMode = 'background' | 'foreground'

/** 待处理的 next-hop。 */
export interface FrontierItem {
  nodeId: string
  edgePrompt: string | null
}

/** 模板上下文里一个已完成节点的值。 */
export interface NodeValues {
  [key: string]: unknown
  text?: string
  data?: unknown
  robot?: unknown
  sessionId?: string
  route?: string | null
  routeTo?: string | null
  answers?: unknown
  attachments?: unknown[]
}

/** 一次运行在一个进程内的观察上下文。 */
export interface RunContext {
  runId: string
  run: WorkflowRunRecord
  plan: WorkflowPlan
  definition: unknown
  mode: RunMode
  agent: Agent | undefined
  controller: AbortController
  frontier: FrontierItem[]
  joins: Map<string, Set<string>>
  lastEnd: WorkflowNode | null
  values: Record<string, NodeValues>
  visits: Map<string, number>
  seq: number
  stepCount: number
  done: Deferred<Record<string, unknown>>
  cancelled: boolean
  closed: boolean
}

/** 一个可 settle 的 promise。 */
export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
  settled: boolean
}

/** 机器人会话一轮结果的形状。 */
export interface RobotResult {
  [key: string]: unknown
  sessionId?: string | null
  text?: string
  stopReason?: string
  error?: string
  structured?: unknown
  resumed?: boolean
  compacted?: boolean
  compactionError?: string
  turnEnded?: boolean
  startSeq?: number
  seq?: number
}

/** Buka Robots 服务返回的会话句柄；字段按本插件实际使用声明。 */
export interface RobotHandle {
  [key: string]: unknown
  sessionId?: unknown
  startSeq?: unknown
  resumed?: unknown
  compacted?: unknown
  resumeError?: unknown
  compactionError?: unknown
  cwd?: unknown
  mode?: unknown
  readResult(options: { sinceSeq: number }): RobotResult
  send(prompt: string, options: { compactFirst: boolean }): Promise<unknown> | unknown
  cancel?(reason: string): Promise<unknown> | unknown
  dispose?(): Promise<unknown> | unknown
  setPlanMode?(active: boolean): void
  retryReport?(input: {
    reason: string
    routes: string[] | undefined
    detail: string | undefined
    abortable: boolean
  }): string | undefined
  getPlanMode?(): { active?: unknown } | null
}

/** Buka Robots 服务本身（与 `dsh-extra.d.ts` 的声明保持结构一致）。 */
export interface RobotService {
  [key: string]: unknown
  dispatchSession?: (request: unknown) => Promise<unknown> | unknown
  openSession?: (request: unknown) => Promise<unknown> | unknown
  supportsPlanMode?: unknown
}

/** dispatch 期间提前到达的事件。 */
export interface EarlyEvent {
  kind: string
  session: Session
  event: SessionEvent
}

/** 一次机器人 dispatch 的登记项。 */
export interface DispatchEntry {
  runId: string
  seq: number
  startSeq: number | null
  handle: RobotHandle | null
  early: EarlyEvent[]
  claimed: boolean
  recoveryRequested: boolean
  disposedEarly: boolean
  resultExhausted: boolean
  timer: NodeJS.Timeout | null
  timeoutMs: number
  planMode: boolean
  planReviewAsked: boolean
  planNudged: boolean
}

/** `#completeNode` 的附加信息。 */
export interface NodeExtra {
  recovered?: boolean
  recoveryAttempts?: number
  timedOut?: boolean
  aborted?: boolean
  routes?: WorkflowEdge[] | null | undefined
  workspace?: string | undefined
  nodeId?: string | null
  message?: string
}

/** `#finish` 的附加信息。 */
export interface FinishExtra {
  nodeId?: string | null
  message?: string
  aborted?: boolean
}

/** `#start` 的入参。 */
export interface StartInput {
  plan: WorkflowPlan
  definition: unknown
  agent: Agent
  mode?: RunMode | undefined
  signal?: AbortSignal | undefined
  onRunCreated?: ((runId: string) => void) | undefined
}

/** `createContext` 的入参。 */
export interface RetryResultInput {
  reason: string
  routes?: string[] | undefined
  detail?: string | undefined
}

/** `createContext` 的入参。 */
export interface ContextInput {
  run: WorkflowRunRecord
  plan: WorkflowPlan
  definition: unknown
  mode: RunMode
  agent?: Agent | undefined
  signal?: AbortSignal | undefined
}

/** 启动恢复最多同时拉起多少个 run，避免一次性创建过多会话。 */
export const RECOVERY_CONCURRENCY = 4

/** 启动恢复等待 robots 服务出现的上限。 */
export const ROBOTS_WAIT_MS = 5000

/** 单个 dispatch 在拿到 startSeq 之前最多缓冲多少个事件。 */
export const MAX_EARLY_EVENTS = 40

/** 这些结束原因视为“会话中断”，可以尝试续跑；`max-tokens` / `blocked` 直接失败。 */
export const RECOVERABLE_STOP_REASONS = new Set(['aborted', 'interrupted', 'error'])

/**
 * plan 节点的一轮结束时仍停在计划阶段、又没有弹出审阅卡时，发出的唯一一次
 * 协议提示。它不是行为提示词，只把节点拉回 plan 模式的正常收尾路径。
 */
export const PLAN_REVIEW_NUDGE =
  "You are still in plan mode. Present your finished plan through the exit_plan_mode tool so the user can approve it; do not submit this node's structured result before the plan is approved."

/**
 * @param error
 * @returns
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param value
 * @returns
 */
export function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * @returns
 */
export function createRunId(): string {
  return `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

/**
 * @returns
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve(value: T) {
      this.settled = true
      resolve(value)
    },
    reject(error: unknown) {
      this.settled = true
      reject(error)
    },
    settled: false,
  }
}
