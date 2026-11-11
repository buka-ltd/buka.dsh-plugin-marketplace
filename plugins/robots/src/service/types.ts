/**
 * 机器人会话服务的公共类型与宿主服务的最小形状。
 *
 * 这里只放类型：请求 / 结果 / 观察者句柄，以及本服务实际调用到的 DSH 服务
 * 形状（agents、plan-mode、compaction、sessionTitle、agentPresets 等）。
 * 形状按实际调用收窄，避免依赖上游未公开的完整类型。
 *
 * @module @buka/dsh-plugin-robots/service/types
 */

import type { Context } from '@deepseek-ai/cordis'

/** 模型路由选项；缺省时用宿主默认模型。 */
export interface AgentOptions {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
}

/** 一次机器人会话请求；三种入口共用，必填字段由入口在运行时校验。 */
export interface RobotSessionRequest {
  robot?: string
  prompt?: string
  agent?: { id: string; ctx?: Context }
  agentPreset?: string
  outputSchema?: Record<string, unknown>
  routes?: string[]
  title?: string
  agentOptions?: AgentOptions
  approval?: 'ask' | 'never'
  timeoutMs?: number
  signal?: AbortSignal
  sessionId?: string
  newSessionId?: string
  wait?: boolean
  planMode?: boolean
  /** 工作流节点确实无法完成时可以交回 `abort` 主动终止。 */
  abortable?: boolean
}

/** 一次阻塞会话的返回值。 */
export interface RobotSessionResult {
  id: string
  robot: string
  cwd: string
  resumed: boolean
  /** 新建的普通顶层会话会额外标出 `visible: true`。 */
  visible?: boolean
  result: Promise<Record<string, unknown>>
  cancel: (reason?: string) => void
  dispose: () => Promise<void>
}

/** 非阻塞 dispatch / open 返回的观察者句柄。 */
export interface RobotSessionObserver {
  mode: 'session'
  sessionId: string
  robot: string
  cwd: string
  resumed: boolean
  compacted: boolean
  compactionError?: string
  startSeq: number
  readResult(options?: { sinceSeq?: number }): Record<string, unknown>
  send(text: string, options?: { compactFirst?: boolean }): Promise<number>
  retryReport(options?: {
    routes?: string[]
    abortable?: boolean
    reason?:
      | 'missing-json'
      | 'missing-next'
      | 'invalid-next'
      | 'invalid-output'
      | 'invalid-abort'
      | 'ambiguous-result'
      | string
    detail?: string
  }): string | null
  getPlanMode(): { active: boolean } | null
  setPlanMode(active: boolean): void
  cancel(reason?: string): Promise<Record<string, unknown>>
  dispose(): Promise<void>
}

/** 两个入口返回的句柄：阻塞的一轮返回 `RobotSessionResult`，观察者模式返回观察者。 */
export type RobotSessionHandle = RobotSessionResult | RobotSessionObserver

/** 解析后的机器人目录。 */
export interface RobotTarget {
  name: string
  path: string
}

/** `structured_output` 工具记录的共享状态。 */
export interface ReportedState {
  reported: { value: unknown }
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

/** 会话创建前可用的子上下文：用来挂 preset、scoped 工具与系统提示。 */
export interface ChildContextLike {
  get?(name: string): unknown
  readonly agentPresets?: AgentPresetsServiceLike
  readonly tools?: ToolsRegistryLike
  readonly systemPrompt?: SystemPromptServiceLike
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

/** 压缩服务的最小形状。 */
export interface CompactionServiceLike {
  compactNow(agent: LiveAgent, signal: AbortSignal): Promise<unknown>
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

/** 工具注册表的最小形状。 */
export interface ToolsRegistryLike {
  register(definition: unknown): unknown
}

/** systemPrompt 服务的最小形状。 */
export interface SystemPromptServiceLike {
  section(options: { name: string; order?: number; text: string }): void
  getSectionOrder?(name: string): number
}

/** 会话控制器的最小形状（重新通告时读会话列表）。 */
export interface SessionControllerLike {
  list(
    options: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ items?: Array<{ sessionId?: unknown }> }>
}
