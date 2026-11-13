/**
 * 打工人会话服务的公共类型与宿主服务的最小形状。
 *
 * 这里只放类型：请求 / 观察者句柄，以及本服务实际调用到的 DSH 服务形状
 * （agents、plan-mode、sessionTitle、agentPresets 等）。形状按实际调用收窄，
 * 避免依赖上游未公开的完整类型。
 *
 * v4 里服务只负责「会话 + turn 观测」：一个任务一条新会话（`dispatchSession`），
 * 恢复时只续接同一条会话（`openSession`）；压缩、结构化结果校验与结果追问都在
 * 工作流侧（`buka_task_complete`），这里不再有对应类型。
 *
 * @module @buka/dsh-plugin-workers/service/types
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WorkerModelSelection } from '../store/types.ts'

/** 模型路由选项；缺省时用宿主默认模型。 */
export interface AgentOptions {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
}

/** 两个入口共用的会话请求字段；必填字段由入口在运行时校验。 */
export interface WorkerSessionRequestBase {
  worker?: string
  /** 调用方 / 启动者所在的 agent；只用于挂 preset（`agentPreset` 缺失时）。 */
  agent?: { id: string; ctx?: Context }
  agentPreset?: string
  title?: string
  agentOptions?: AgentOptions
  approval?: 'ask' | 'never'
  planMode?: boolean
  signal?: AbortSignal
}

/** `dispatchSession`：总是新开一条会话（不复用上一条任务的会话）。 */
export interface WorkerDispatchRequest extends WorkerSessionRequestBase {
  prompt?: string
  /**
   * 观察者可以预先生成会话 id 并落盘：宿主在 create 期间退出时，恢复流程仍能
   * 找到该续接哪条会话。省略时随机生成。
   */
  newSessionId?: string
}

/** `openSession`：只续接同一条已有会话，不压缩、不发 prompt。 */
export interface WorkerOpenRequest extends WorkerSessionRequestBase {
  sessionId?: string
}

/** 观察者句柄：只操作这一个 live agent，不负责等待。 */
export interface WorkerSessionObserver {
  mode: 'session'
  sessionId: string
  worker: string
  cwd: string
  resumed: boolean
  /** 本轮 prompt 投递前的事件序号；`readResult` 默认从这里往后读。 */
  startSeq: number
  readResult(options?: { sinceSeq?: number }): Record<string, unknown>
  /** 在同一会话里再发一条消息（恢复续跑用），返回新的起点 seq。 */
  send(text: string): Promise<number>
  cancel(reason?: string): Promise<Record<string, unknown>>
  dispose(): Promise<void>
  getPlanMode(): { active: boolean } | null
  setPlanMode(active: boolean): void
}

/** 解析后的打工人目录；机器人不会走到这里（它们没有会话）。 */
export interface WorkerTarget {
  name: string
  path: string
  /** 新会话使用的模型；null 表示跟随宿主默认模型。 */
  model: WorkerModelSelection | null
}

/** 会话事件的最小形状：只按字段读取，避免依赖 DSH 事件的完整类型。 */
export interface SessionEventLike {
  readonly seq?: number
  readonly type?: string
  readonly data?: {
    readonly reason?: { readonly kind?: unknown } | null
    readonly message?: {
      readonly content?: unknown
      readonly toolCallId?: unknown
      readonly isError?: unknown
      readonly source?: { readonly callId?: unknown } | null
    } | null
    readonly name?: unknown
    readonly callId?: unknown
    readonly toolCallId?: unknown
    /** `plan/mode` 事件的状态值（整值替换）。 */
    readonly active?: unknown
  } | null
}

/** live 会话的最小形状。 */
export interface SessionLike {
  readonly id?: string
  readonly seq?: number
  readonly header?: { readonly origin?: unknown } | null
  snapshotEvents?(sinceSeq: number): SessionEventLike[]
  ownEvents?(): SessionEventLike[]
}

/** live agent 的最小形状：DSH 的 Agent 运行时才有这些能力。 */
export interface LiveAgent {
  readonly id?: string
  readonly session?: SessionLike
  readonly ctx?: {
    on?(
      event: 'session/event',
      listener: (session: unknown, event: SessionEventLike) => void,
    ): (() => void) | undefined
  }
  cancel(reason: { kind: 'hook'; reason?: string }, options?: { keepInbox?: boolean }): void
  followup(message: Record<string, unknown>): void
  whenIdle(): Promise<unknown>
}

/** agents.create / resume 返回句柄的最小形状。 */
export interface AgentHandleLike {
  readonly agent: LiveAgent
  dispose(): Promise<void>
}

/** 会话创建前可用的子上下文：用来挂 preset。 */
export interface ChildContextLike {
  get?(name: string): unknown
  readonly agentPresets?: AgentPresetsServiceLike
}

/** agents.create / resume 的选项里本服务实际用到的部分。 */
export interface CreateAgentOptionsLike {
  readonly sessionId?: string | undefined
  readonly meta?: Record<string, unknown> | undefined
  readonly agentOptions?: AgentOptions | undefined
  readonly signal?: AbortSignal | undefined
  readonly setup?: (childCtx: ChildContextLike, agent: LiveAgent) => Promise<void> | void
}

/** agents.resume 的选项。 */
export interface ResumeAgentOptionsLike extends Omit<CreateAgentOptionsLike, 'sessionId' | 'meta'> {
  readonly resumeSessionId: string
}

/** 会话创建服务的最小形状：create / resume 由 DSH 提供。 */
export interface AgentsServiceLike {
  create(options: CreateAgentOptionsLike): Promise<AgentHandleLike>
  resume(options: ResumeAgentOptionsLike): Promise<AgentHandleLike>
}

/** 一次命令执行的结果；这里只关心成功 / 失败。 */
export interface CommandExecutionLike {
  readonly result?: { readonly kind?: unknown } | null
}

/**
 * 命令注册表服务（DSH 的 `commands`）的最小形状。
 *
 * DSH 里 plan 模式的用户入口就是 `/plan` 命令；服务按 `agent` 作用域解析
 * 命令，所以 profile 根部的插件也能把命令执行在某个具体会话上，不需要拿到
 * 被 isolate 在会话 preset 里的 plan 模式服务实例。
 */
export interface CommandsServiceLike {
  execute?(
    agent: LiveAgent,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<CommandExecutionLike | undefined>
}

/** 会话标题服务的最小形状。 */
export interface SessionTitleServiceLike {
  get?(session: unknown): unknown
  rename?(session: unknown, title: string): void
}

/** 宿主默认模型选择服务的最小形状。 */
export interface AgentDefaultModelLike {
  currentSelection?():
    | { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
    | null
    | undefined
}

/** `agentPresets` 服务的最小形状。 */
export interface AgentPresetsServiceLike {
  presetForSession?(session: unknown): unknown
  mount?(ctx: unknown, preset: string): Promise<unknown>
  composeFrom?(ctx: unknown, source: unknown): unknown
  defaultId?: string
}

/** 会话控制器的最小形状（重新通告时读会话列表）。 */
export interface SessionControllerLike {
  list(
    options: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ items?: Array<{ sessionId?: unknown }> }>
}
