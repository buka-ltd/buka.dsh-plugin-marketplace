/**
 * `@buka/dsh-plugin-robots` 对外提供的 Host Service：`ctx.bukaRobots`。
 *
 * 目前的能力，供工作流插件（以及将来的编排器）使用：
 *
 * - `list()`：机器人登记表 + 目录状态 + 挂载状态 + 已装 skills；
 * - `avatarMap()`：机器人名 → 预设头像 id（只读登记表，工作流节点图用它）；
 * - `startSession(request)`：在机器人目录下开一个会话（或按 `sessionId` 续接已有
 *   会话，续接前先 compact），投递一段提示词；新会话是挂到机器人工作区的普通
 *   顶层会话（侧边栏可见），等它结束或空闲后返回最终文本与结构化结果。
 *   每个机器人会话都要求交回**一个 JSON 对象**（调用 scoped 的
 *   `structured_output` 工具，回复正文里的 JSON 也算）；没交回时就在**同一个
 *   会话**里补一条消息要求按格式重新回复（最多 `resultRetries` 次），只有重试
 *   用尽仍没有结果时节点才失败。`outputSchema` 约束这个对象的结构（例如工作流
 *   节点要求 `next` 取出口路由名之一）。
 *   审批默认按部署策略（`approval` 省略 / `'ask'`）；只有显式传 `'never'` 时才
 *   强制拒绝需要审批的操作。
 *
 * 唯一的会话后端是普通顶层会话：`cwd` 是机器人目录，机器人自己的 AGENTS.md /
 * 项目 skills 照常生效，会话挂到机器人工作区并出现在 DSH 侧边栏。创建或续接
 * 失败时直接抛错，不退回 subagent 子会话，也不另开新会话。
 *
 * 通过 `ctx.provide('bukaRobots', new RobotSessionService(...))` 注册，消费方
 * 用 `inject: ['bukaRobots']` 或 `ctx.get('bukaRobots')` 获取。`defineTool`
 * 由入口注入，这样本模块可以脱离 DSH 依赖被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-robots/service
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'

import type { Context } from '@deepseek-ai/cordis'
import type { defineTool as defineToolType } from '@deepseek-ai/dsh-tools'
import { resolveAvatar } from './avatar.ts'
import { RobotSessionStop } from './engine/errors.ts'
import {
  DEFAULT_RESULT_RETRIES,
  normalizeOutputSchema,
  parseStructuredText,
  resultFailureMessage,
  resultRetryPrompt,
  STRUCTURED_OUTPUT_TOOL,
  structuredSubmittedSince,
} from './engine/result.ts'
import {
  readPlanModeActive,
  readSessionOutcome,
  readSessionTurn,
  seqOf,
} from './engine/session-events.ts'
import {
  describeError,
  disposeHandle,
  followupMessage,
  mergeAgentOptions,
  optionalService,
  positive,
  waitForSettle,
  waitForTurnEnd,
} from './engine/session-runtime.ts'
import { summarizeRobot } from './engine/summary.ts'
import { isValidRobotName, listRobots, readRobotRegistry } from './robot-store.ts'
import type {
  AgentDefaultModelLike,
  AgentHandleLike,
  AgentOptions,
  AgentPresetsServiceLike,
  AgentsServiceLike,
  ChildContextLike,
  CommandsServiceLike,
  CompactionServiceLike,
  LiveAgent,
  ReportedState,
  RobotSessionHandle,
  RobotSessionObserver,
  RobotSessionRequest,
  RobotSessionResult,
  RobotTarget,
  SessionControllerLike,
  SessionTitleServiceLike,
  SystemPromptServiceLike,
  ToolsRegistryLike,
} from './service/types.ts'

/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaRobots`。 */
export const SERVICE_NAME = 'bukaRobots'

/**
 * 会话里补装的 `structured_output` 工具说明（也是唯一的输出契约）。
 *
 * 新会话和续接都由本服务注册同名工具；续接走 `agents.resume()` 时运行时不知道
 * 这次调用的 outputSchema，所以每次进入都补上。
 */
const STRUCTURED_OUTPUT_INSTRUCTION =
  'Every robot workflow node must finish by submitting its final result as a single JSON object. ' +
  `When your answer is complete, call the \`${STRUCTURED_OUTPUT_TOOL}\` tool with arguments matching its parameter schema exactly. ` +
  'If this workflow node has outgoing routes, that JSON object must include `next` set to the route name you choose. ' +
  'Do not finish with a plain text answer: only the tool call counts as your result.'

/** plan 模式入口不可用时给用户看的错误文案。 */
const PLAN_MODE_UNAVAILABLE =
  'plan mode is unavailable in this composition; install or update @deepseek-ai/dsh-plan-mode to use a robot node with mode "plan"'

/**
 * 命令是否解析并成功执行：没解析到（undefined）或结果是成功以外的 kind 都算
 * 没成功，返回失败原因。
 *
 */
function commandFailure(execution: unknown): string | undefined {
  const result = (execution as { result?: { kind?: unknown } | null }).result
  const kind = result?.kind
  if (kind === undefined || kind === 'success') return undefined
  return typeof kind === 'string' ? kind : 'error'
}

/**
 * 释放 agent 后重新通告会话时，读取宿主会话列表的最长时间。
 *
 * 通告只是可读性补偿，不能因为宿主列表很慢就拖住释放流程。
 */
const ANNOUNCE_SESSION_TIMEOUT_MS = 2000
export class RobotSessionService {
  /** Host 上下文：取 agents / approval / compaction 等可选服务。 */
  readonly ctx: Context
  /** 机器人根目录。 */
  readonly robotsDir: string
  /** 登记文件绝对路径。 */
  readonly registryFile: string
  /** 入口注入的工具定义函数（真实签名来自 `@deepseek-ai/dsh-tools`）。 */
  readonly defineTool?: typeof defineToolType | undefined
  /** 机器人没有交回结构化结果时在原会话里重试的次数上限。 */
  readonly resultRetries: number
  /** 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。 */
  readonly supportsPlanMode: boolean

  /**
   */
  constructor(options: {
    ctx: Context
    robotsDir: string
    registryFile: string
    defineTool?: typeof defineToolType | undefined
    resultRetries?: number | undefined
  }) {
    this.ctx = options.ctx
    this.robotsDir = options.robotsDir
    this.registryFile = options.registryFile
    this.defineTool = options.defineTool
    const retries = options.resultRetries
    this.resultRetries =
      typeof retries === 'number' && Number.isInteger(retries) && retries >= 0
        ? retries
        : DEFAULT_RESULT_RETRIES
    /**
     * 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。工作流的
     * plan 节点在启动前用它判断是否需要提示用户升级 robots 插件；旧版本没有
     * 这个字段，planMode 请求会被静默忽略。
     */
    this.supportsPlanMode = true
  }

  /**
   * 列出机器人。
   *
   */
  async list(): Promise<{
    root: string
    registry: string
    corrupt: boolean
    robots: Array<Record<string, unknown>>
  }> {
    const snapshot = await listRobots({
      file: this.registryFile,
      workspaceRegistry: this.ctx?.workspaceRegistry,
      robotsDir: this.robotsDir,
    })
    return {
      root: snapshot.root,
      registry: snapshot.registry,
      corrupt: snapshot.corrupt,
      robots: snapshot.robots.map((robot) => summarizeRobot(robot)),
    }
  }

  /**
   * 机器人名 → 头像 id。给工作流这类只关心「谁在执行」的消费方用：只读登记表，
   * 不扫描每个机器人目录里的 skills / AGENTS.md，所以可以频繁调用。
   *
   * 旧登记表里缺头像的机器人按名字兜底成一个确定的预设。登记表损坏时返回空表。
   *
   */
  async avatarMap(): Promise<Record<string, string>> {
    const registry = await readRobotRegistry({ file: this.registryFile })
    const map: Record<string, string> = {}
    if (!registry.corrupt) {
      for (const robot of registry.robots) map[robot.name] = resolveAvatar(robot.avatar, robot.name)
    }
    return map
  }

  /**
   * 在机器人目录下开一个会话并执行一段提示词；传 `sessionId` 时改为续接
   * 同一个会话（先 compact 历史，再发新的 prompt）。
   *
   * 返回的 `result` 在会话空闲（或超时 / 取消）后落定，不会 reject；调用方
   * 根据 `stopReason` 判断结果。会话在读取完结果后自动 dispose，日志保留。
   *
   */
  async startSession(request: RobotSessionRequest = {}): Promise<RobotSessionHandle> {
    // 观察者模式：把 prompt 投进去就返回句柄，结果由调用方订阅会话事件后自己读。
    // 默认仍是 wait:true，保持既有调用方的语义不变。
    if (request.wait === false) return await this.dispatchSession(request)
    if (request.planMode !== undefined) {
      throw new Error(
        'planMode is only supported by dispatchSession/openSession (and startSession({ wait: false })); the blocking startSession disposes the agent after one turn and cannot leave a session in plan mode',
      )
    }
    if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
      throw new Error('startSession requires a non-empty prompt')
    }
    const robot = await this.#resolveRobot(request.robot, request)
    const agentOptions = mergeAgentOptions(this.#defaultAgentOptions(), request.agentOptions)
    if (typeof agentOptions.provider !== 'string' || typeof agentOptions.model !== 'string') {
      throw new Error(
        'no model route is available for the robot session: pass agentOptions.provider/model or configure a default model',
      )
    }
    const signal = request.signal
    signal?.throwIfAborted?.()

    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : ''
    if (sessionId !== '') {
      return await this.#continueSession({ request, robot, agentOptions, signal, sessionId })
    }

    const session = await this.#startNewSession({ request, robot, agentOptions, signal })
    return { ...session, resumed: false }
  }

  /**
   * 非阻塞地把一段 prompt 投进机器人会话，返回一个可观测句柄；不在服务里等待
   * 这一轮结束，也不设默认超时。工作流观察者负责订阅 `session/event` 并在
   * `turn/end` 后读结果、决定路由；会话异常终止时由观察者重新 open/dispatch。
   * 注意：`dispatchSession` / `startSession({ wait: false })` 不解释 `timeoutMs`，
   * 硬超时由调用方（观察者）自己计时后调用句柄的 `cancel()`。
   *
   * 句柄里的 `readResult` / `send` / `retryReport` / `cancel` 只操作这一个
   * dispatch 对应的 live agent；持久会话本身由 DSH 保存，`dispose` 只释放 agent。
   *
   */
  async dispatchSession(request: RobotSessionRequest = {}): Promise<RobotSessionObserver> {
    if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
      throw new Error('dispatchSession requires a non-empty prompt')
    }
    this.#assertPlanModeRequest(request)
    const robot = await this.#resolveRobot(request.robot, request)
    const agentOptions = mergeAgentOptions(this.#defaultAgentOptions(), request.agentOptions)
    if (typeof agentOptions.provider !== 'string' || typeof agentOptions.model !== 'string') {
      throw new Error(
        'no model route is available for the robot session: pass agentOptions.provider/model or configure a default model',
      )
    }
    const signal = request.signal
    signal?.throwIfAborted?.()

    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : ''
    if (sessionId !== '') {
      return await this.#continueDispatch({ request, robot, agentOptions, signal, sessionId })
    }
    return await this.#startDispatch({ request, robot, agentOptions, signal })
  }

  /**
   * 只打开（resume / attach）一个已有机器人会话，不发 prompt。观察者恢复时先用
   * 它检查上一轮是否其实已经结束；确认要继续时再调句柄的 `send`。
   *
   */
  async openSession(request: RobotSessionRequest = {}): Promise<RobotSessionObserver> {
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : ''
    if (sessionId === '') throw new Error('openSession requires a sessionId')
    this.#assertPlanModeRequest(request)
    const robot = await this.#resolveRobot(request.robot, request)
    const agentOptions = mergeAgentOptions(this.#defaultAgentOptions(), request.agentOptions)
    if (typeof agentOptions.provider !== 'string' || typeof agentOptions.model !== 'string') {
      throw new Error(
        'no model route is available for the robot session: pass agentOptions.provider/model or configure a default model',
      )
    }
    const signal = request.signal
    signal?.throwIfAborted?.()
    const prepared = await this.#resumeAgent({ request, robot, agentOptions, signal, sessionId })
    try {
      await this.#applyPlanMode(prepared.agent, request, request.signal)
    } catch (error) {
      try {
        await prepared.handle?.dispose?.()
      } catch {
        // 已释放：忽略。
      }
      throw error
    }
    return this.#observeHandle({
      agent: prepared.agent,
      state: prepared.state,
      handle: prepared.handle,
      robot,
      request,
      resumed: true,
      compacted: false,
      compactionError: undefined,
      startSeq: seqOf(prepared.agent),
    })
  }

  /**
   * 新开一个会话。
   *
   * 创建**普通顶层会话**：它会挂到机器人自己的工作区，因此侧边栏能看到、
   * 能像普通对话一样打开。创建失败直接抛错；不会退回 subagent 子会话（DSH
   * 侧边栏不显示这类会话），也不会用别的会话替代。
   *
   */
  async #startNewSession({
    request,
    robot,
    agentOptions,
    signal,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
  }): Promise<RobotSessionResult> {
    try {
      return await this.#startVisibleSession({ request, robot, agentOptions, signal })
    } catch (error) {
      throw this.#creationError(robot, error, signal)
    }
  }

  /**
   * 把创建失败包装成给用户看的错误：说明没有隐藏兜底、也没有替代会话。
   *
   */
  #creationError(robot: RobotTarget, error: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted === true)
      return error instanceof Error ? error : new Error(describeError(error))
    return new Error(
      `could not create a visible robot session for robot "${robot.name}": ${describeError(error)}; refusing to fall back to a hidden subagent or a replacement session`,
      { cause: error },
    )
  }

  /**
   * 在已有机器人会话上继续：先 compact 压缩历史，再把这一次的 prompt 发进去。
   *
   * 与「新开会话」不同，这里通过 `ctx.agents.resume()` 把会话重新加载成 live
   * agent，因此能直接调用 `ctx.compaction.compactNow()`；结束一轮后再释放
   * agent，会话本身留在持久化存储里，供下一次进入继续使用。
   *
   * 续接失败直接抛错：不新开会话、不退回 subagent。调用方（工作流）会把节点
   * 和整个运行按失败结束，并把原因展示给用户。
   *
   */
  async #continueSession({
    request,
    robot,
    agentOptions,
    signal,
    sessionId,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
    sessionId: string
  }): Promise<RobotSessionResult> {
    let prepared: {
      sessionId: string
      agent: LiveAgent
      state: ReportedState
      handle: AgentHandleLike
    }
    try {
      prepared = await this.#resumeAgent({ request, robot, agentOptions, signal, sessionId })
    } catch (error) {
      if (signal?.aborted === true)
        throw new RobotSessionStop('aborted', 'robot session was cancelled')
      throw new Error(
        `could not resume robot session "${sessionId}" for robot "${robot.name}": ${describeError(error)}; refusing to start a new robot session`,
        { cause: error },
      )
    }

    const { agent, state, handle } = prepared
    const timeoutMs = positive(request.timeoutMs) ?? 0
    return {
      id: sessionId,
      robot: robot.name,
      cwd: robot.path,
      resumed: true,
      result: this.#runSessionTurn({
        agent,
        robot,
        request,
        state,
        timeoutMs,
        signal,
        compactFirst: true,
        dispose: () => this.#releaseAgent(handle, sessionId),
      }),
      cancel(reason?: string): void {
        try {
          agent.cancel(
            {
              kind: 'hook',
              reason:
                typeof reason === 'string' && reason !== '' ? reason : 'robot session cancelled',
            },
            { keepInbox: true },
          )
        } catch {
          // 已停止或已释放：忽略。
        }
      },
      dispose: () => this.#releaseAgent(handle, sessionId),
    }
  }

  /**
   * 用调用方给的 `title` 给机器人会话命名。
   *
   * 机器人会话的第一条用户消息来源是 `buka-robot`，而 DSH 的自动标题只看
   * `source.kind === 'user'` 的消息，所以这类会话不会自己长出标题：侧边栏与
   * 会话列表里一直显示「未命名」。工作流进入节点时会把「运行目标 · 机器人」
   * 作为 `title` 传进来，这里用 `sessionTitle.rename()` 写一条显式标题。
   *
   * 续接已有会话时只在还没有标题的情况下补写，不覆盖用户手动改过的名字。
   *
   */
  #titleSession(agent: LiveAgent, title: unknown): void {
    const text = typeof title === 'string' ? title.trim() : ''
    if (text === '') return
    const session = agent?.session
    if (session === undefined || session === null) return
    const service = optionalService<SessionTitleServiceLike>(this.ctx, 'sessionTitle')
    if (typeof service?.rename !== 'function') return
    try {
      if (typeof service.get === 'function' && service.get(session) !== undefined) return
      service.rename(session, text)
    } catch (error) {
      // 标题只是可读性增强：服务缺失 / 会话不是 live 时不影响节点执行。
      this.ctx?.logger?.warn?.(
        `buka-robots: could not title robot session "${String(session?.id ?? '')}": ${describeError(error)}`,
      )
    }
  }

  /**
   * 给新会话 / 续接会话装上机器人自己的工作 preset，并补一个 scoped 的
   * `structured_output` 工具：每个机器人节点都必须交回一个 JSON 对象。
   *
   * 普通顶层会话和 `agents.resume()` 都不会自动套 composition，所以由服务显式
   * 挂载；结构化工具也一样，运行时不知道这次调用的 outputSchema，由服务补上。
   *
   */
  async #composeSession(
    childCtx: ChildContextLike,
    agent: LiveAgent,
    request: RobotSessionRequest,
    state: ReportedState,
    { resume }: { resume: boolean },
  ): Promise<void> {
    const presets = (childCtx?.get?.('agentPresets') ?? childCtx?.agentPresets) as
      | AgentPresetsServiceLike
      | undefined
    if (presets !== undefined && presets !== null) {
      const recorded =
        resume && typeof presets.presetForSession === 'function'
          ? presets.presetForSession(agent?.session)
          : null
      const requested = typeof request.agentPreset === 'string' ? request.agentPreset.trim() : ''
      const preset =
        typeof recorded === 'string' && recorded !== ''
          ? recorded
          : requested !== ''
            ? requested
            : typeof presets.defaultId === 'string'
              ? presets.defaultId
              : ''
      if (preset !== '' && typeof presets.mount === 'function') {
        await presets.mount(childCtx, preset)
      } else if (typeof presets.composeFrom === 'function' && request.agent?.ctx !== undefined) {
        presets.composeFrom(childCtx, request.agent.ctx)
      }
    }
    this.#installStructuredTool(childCtx, state, request.outputSchema, {
      abortable: request.abortable === true,
    })
  }

  /**
   * 在会话上安装结构化结果工具。`outputSchema` 直接作为工具的 `parameters`
   * （例如工作流节点要求 `next` 取某个枚举值）；没给时退回宽松对象 schema，
   * 但仍然要求交回一个 JSON 对象。`abortable` 为 true 时，工具说明和系统提示
   * 都会告诉节点：确实无法完成时可以交回 `abort` 主动终止，而不是随便选一条
   * route。
   *
   */
  #installStructuredTool(
    childCtx: ChildContextLike,
    state: ReportedState,
    schema?: unknown,
    options: { abortable?: boolean } = {},
  ): void {
    const tools = (childCtx?.get?.('tools') ?? childCtx?.tools) as ToolsRegistryLike | undefined
    if (typeof tools?.register !== 'function') return
    const abortText =
      options.abortable === true
        ? ' If you cannot complete this task, submit a single "abort" string with a short reason instead of picking a route; the workflow ends and the run is recorded as failed.'
        : ''
    tools.register({
      name: STRUCTURED_OUTPUT_TOOL,
      description:
        "Report the final structured JSON result of this node. Call this exactly once, when your answer is complete; the arguments must match this tool's parameter schema exactly." +
        abortText,
      parameters: normalizeOutputSchema(schema),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { recorded: { type: 'boolean', const: true } },
          required: ['recorded'],
        },
        render: () => [{ type: 'text', text: 'Structured output recorded.' }],
      },
      execute(args: unknown, exec?: { concludeTurn?(): void }) {
        if (state.reported.value !== undefined)
          throw new Error('structured output already recorded')
        state.reported.value = args
        try {
          exec?.concludeTurn?.()
        } catch {
          // 老运行时没有 concludeTurn：靠 turn/end 自然结束。
        }
        return { recorded: true }
      },
    })
    const systemPrompt = (childCtx?.get?.('systemPrompt') ?? childCtx?.systemPrompt) as
      | SystemPromptServiceLike
      | undefined
    if (typeof systemPrompt?.section === 'function') {
      try {
        systemPrompt.section({
          name: `tool:${STRUCTURED_OUTPUT_TOOL}`,
          order:
            typeof systemPrompt.getSectionOrder === 'function'
              ? systemPrompt.getSectionOrder('STRUCTURED_OUTPUT')
              : 9900,
          text: `${STRUCTURED_OUTPUT_INSTRUCTION}${abortText}`,
        })
      } catch {
        // 没有 systemPrompt 注册表时退回提示词里的重试消息。
      }
    }
  }

  /**
   * 在续接会话上执行一轮：compact → followup → 等空闲 → 读结果（没交回 JSON
   * 时在同会话内补问，重试有上限）。
   *
   */
  async #runSessionTurn({
    agent,
    robot,
    request,
    state,
    timeoutMs,
    signal,
    compactFirst,
    dispose,
  }: {
    agent: LiveAgent
    robot: RobotTarget
    request: RobotSessionRequest
    state: ReportedState
    timeoutMs?: number | undefined
    signal?: AbortSignal | undefined
    compactFirst: boolean
    dispose: () => Promise<void>
  }): Promise<Record<string, unknown>> {
    // 默认不超时：只有调用方显式给了正的 timeoutMs 才计时。
    const deadline =
      typeof timeoutMs === 'number' && Number.isInteger(timeoutMs) && timeoutMs > 0
        ? Date.now() + timeoutMs
        : null
    const remaining = () => (deadline === null ? 0 : Math.max(1, deadline - Date.now()))
    let compacted = false
    let compactionError: string | undefined
    let stopped: RobotSessionStop | null = null
    let errorMessage: string | undefined
    let text = ''
    let stopReason = 'completed'
    let retries = 0
    let structured: unknown
    // 超时 / 取消时从这一轮的起点往后读，避免把上一轮的旧文本当成本轮最终文本。
    let turnStartSeq = 0

    try {
      if (compactFirst) {
        const preparation = await this.#compactSession(agent, signal)
        compacted = preparation.compacted
        compactionError = preparation.compactionError
      }

      const startSeq = seqOf(agent)
      turnStartSeq = startSeq
      const firstTurn = waitForTurnEnd(agent, startSeq, remaining(), signal)
      agent.followup(followupMessage(request.prompt ?? ''))
      await firstTurn
      let outcome = readSessionOutcome(agent.session, startSeq)
      text = outcome.text
      stopReason = outcome.stopReason
      structured = state.reported.value

      while (structured === undefined) {
        structured = parseStructuredText(text)
        if (structured !== undefined) break
        if (retries >= this.resultRetries) break
        retries += 1
        const retrySeq = seqOf(agent)
        const retryTurn = waitForTurnEnd(agent, retrySeq, remaining(), signal)
        try {
          agent.followup(
            followupMessage(
              resultRetryPrompt(retries, this.resultRetries, {
                toolName: STRUCTURED_OUTPUT_TOOL,
                routes: request.routes,
                abortable: request.abortable === true,
              }),
            ),
          )
          await retryTurn
        } catch (error) {
          if (error instanceof RobotSessionStop) throw error
          this.ctx?.logger?.warn?.(
            `buka-robots: could not ask the robot session for its structured result: ${describeError(error)}`,
          )
          retries -= 1
          break
        }
        outcome = readSessionOutcome(agent.session, retrySeq)
        text = outcome.text
        stopReason = outcome.stopReason
        structured = state.reported.value ?? parseStructuredText(text)
      }

      if (structured === undefined) {
        errorMessage = resultFailureMessage(retries)
        if (stopReason === 'completed') stopReason = 'error'
      }
    } catch (error) {
      if (error instanceof RobotSessionStop) {
        stopped = error
        try {
          agent.cancel({ kind: 'hook', reason: error.message }, { keepInbox: true })
        } catch {
          // 会话可能已经结束。
        }
        await waitForSettle(agent)
        try {
          const outcome = readSessionOutcome(agent.session, turnStartSeq)
          text = outcome.text
        } catch {
          // 会话对象不可读时保留空结果。
        }
        stopReason = stopped.kind
        errorMessage = stopped.message
      } else {
        stopReason = 'error'
        errorMessage = describeError(error)
      }
    } finally {
      await dispose()
    }

    return {
      sessionId: agent.id ?? null,
      robot: robot.name,
      text,
      ...(structured === undefined ? {} : { structured }),
      resultRetries: retries,
      stopReason,
      ...(errorMessage === undefined ? {} : { error: errorMessage }),
      resumed: compactFirst,
      compacted,
      ...(compactionError === undefined ? {} : { compactionError }),
    }
  }

  /**
   * 创建一个普通顶层会话：`cwd` 是机器人目录，composition 用机器人自己的工作
   * preset，并挂到机器人自己的工作区，所以侧边栏能看到、点开就是普通对话。
   *
   * 这是唯一的会话后端；创建失败直接抛错，不会退回 subagent。
   *
   */
  async #startVisibleSession({
    request,
    robot,
    agentOptions,
    signal,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
  }): Promise<RobotSessionResult> {
    const prepared = await this.#createVisibleAgent({ request, robot, agentOptions, signal })
    const { agent, state, handle, sessionId } = prepared
    const timeoutMs = positive(request.timeoutMs) ?? 0
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      await this.#releaseAgent(handle, sessionId)
    }

    return {
      id: sessionId,
      robot: robot.name,
      cwd: robot.path,
      resumed: false,
      visible: true,
      result: this.#runSessionTurn({
        agent,
        robot,
        request,
        state,
        timeoutMs,
        signal,
        compactFirst: false,
        dispose,
      }),
      cancel(reason?: string): void {
        try {
          agent.cancel(
            {
              kind: 'hook',
              reason:
                typeof reason === 'string' && reason !== '' ? reason : 'robot session cancelled',
            },
            { keepInbox: true },
          )
        } catch {
          // 已停止或已释放：忽略。
        }
      },
      dispose,
    }
  }

  /**
   * 新建一个普通顶层机器人会话并完成标题、审批策略、工作区挂载；不发送 prompt。
   *
   */
  async #createVisibleAgent({
    request,
    robot,
    agentOptions,
    signal,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
  }): Promise<{
    sessionId: string
    agent: LiveAgent
    state: ReportedState
    handle: AgentHandleLike
  }> {
    const agents = optionalService<AgentsServiceLike>(this.ctx, 'agents')
    if (typeof agents?.create !== 'function') {
      throw new Error('the agent service is unavailable, so a robot session cannot be created')
    }

    const state = { reported: { value: undefined } }
    // 观察者可以先把 sessionId 落盘再 dispatch：这样即使宿主在 create 期间退出，
    // 恢复时也知道该 resume 哪个会话。调用方没给时仍随机生成。
    const requestedSessionId =
      typeof request.newSessionId === 'string' ? request.newSessionId.trim() : ''
    const sessionId = requestedSessionId !== '' ? requestedSessionId : randomUUID()
    const requestedPreset =
      typeof request.agentPreset === 'string' ? request.agentPreset.trim() : ''
    const handle = await agents.create({
      sessionId,
      meta: {
        cwd: robot.path,
        ...(requestedPreset === '' ? {} : { agentPreset: requestedPreset }),
      },
      agentOptions,
      signal,
      setup: async (childCtx, agent) => {
        await this.#composeSession(childCtx, agent, request, state, { resume: false })
      },
    })

    const agent = handle.agent
    await this.#assertVisibleAgent(agent, handle)
    // 机器人会话的用户消息来源是 `buka-robot`，DSH 的自动标题只认 `user`
    // 来源的消息，所以新会话在这里显式命名，侧边栏里才不是「未命名」。
    this.#titleSession(agent, request.title)
    // 审批默认按部署策略（省略 / 'ask'）；只有显式 'never' 时才强制拒绝需要审批
    // 的操作，让机器人节点的工作落在机器人目录内。
    if (request.approval === 'never') {
      try {
        this.ctx?.get?.('approval')?.setPolicy?.(agent, 'never')
      } catch {
        // 审批服务不可用时保持默认策略。
      }
    }

    // 挂到机器人自己的工作区：这样侧边栏（按工作区分组）能看到这个会话，
    // `uiWorkspace.openSession()` 打开后也能在列表里找到它。
    await this.#attachSessionToWorkspace(sessionId, robot)
    return { sessionId, agent, state, handle }
  }

  /**
   * resume 一个已有机器人会话并完成标题、审批策略、工作区挂载；不发 prompt、
   * 不 compact。调用方决定是走阻塞的一轮，还是交给观察者。
   *
   * 续接出来的会话是**运行时根会话**：DSH 的人类交互要求根 agent，所以这里
   * 不传 `parentAgent`（与 `agents.create` 的顶层会话一致）。历史会话如果是
   * 旧版 `origin: 'subagent'` 的隐藏会话，直接拒绝：dispose 后抛错，不新开。
   *
   */
  async #resumeAgent({
    request,
    robot,
    agentOptions,
    signal,
    sessionId,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
    sessionId: string
  }): Promise<{
    sessionId: string
    agent: LiveAgent
    state: ReportedState
    handle: AgentHandleLike
  }> {
    const agents = optionalService<AgentsServiceLike>(this.ctx, 'agents')
    if (typeof agents?.resume !== 'function') {
      throw new Error('the agent service cannot resume a robot session in this composition')
    }

    const state = { reported: { value: undefined } }
    const handle = await agents.resume({
      resumeSessionId: sessionId,
      agentOptions,
      signal,
      setup: async (childCtx, agent) => {
        await this.#composeSession(childCtx, agent, request, state, { resume: true })
      },
    })

    const agent = handle.agent
    await this.#assertVisibleAgent(agent, handle)
    // 续接的老会话可能还没有标题（早期版本没命名）；顺手补一次，已有的标题
    // 不覆盖，避免把用户手动改的名字改回去。
    this.#titleSession(agent, request.title)
    // 审批默认按部署策略（省略 / 'ask'）；只有显式 'never' 时才强制拒绝需要审批
    // 的操作，让机器人节点的工作落在机器人目录内。
    if (request.approval === 'never') {
      try {
        this.ctx?.get?.('approval')?.setPolicy?.(agent, 'never')
      } catch {
        // 审批服务不可用时保持默认策略。
      }
    }

    // 挂到机器人自己的工作区；隐藏会话已在上面被拒绝，不会走到这里。
    await this.#attachSessionToWorkspace(sessionId, robot)
    return { sessionId, agent, state, handle }
  }

  /**
   * 拒绝 DSH 侧边栏不显示的隐藏会话（`origin: 'subagent'`）。
   *
   * 旧版本的工作流兜底可能把机器人节点落成 subagent 子会话；这类会话即使
   * 打开也只在主区域显示，不能作为工作流节点会话。命中时先释放 agent，再抛错。
   *
   */
  async #assertVisibleAgent(agent: LiveAgent, handle: AgentHandleLike): Promise<void> {
    if (agent?.session?.header?.origin !== 'subagent') return
    await disposeHandle(handle)
    throw new Error(
      'refusing to use a hidden subagent robot session; robot sessions must be visible top-level sessions',
    )
  }

  /**
   * 命令注册表服务：DSH 里 plan 模式的入口就是用户对会话执行的 `/plan` 命令，
   * 服务按 `agent` 作用域解析命令。返回 undefined 表示这个组合没有可用的命令
   * 入口。
   *
   */
  #commandsService(): Required<CommandsServiceLike> | undefined {
    const commands = optionalService<CommandsServiceLike>(this.ctx, 'commands')
    if (commands === undefined || typeof commands.execute !== 'function') return undefined
    return commands as Required<CommandsServiceLike>
  }

  /**
   * 创建 / 恢复会话之前检查请求能否满足：要求进入 plan 模式但组合里没有命令
   * 入口时直接失败，避免留下一个没人接管模式的会话。命令是否真的能对目标
   * agent 执行，要等 agent 创建后才能确认，由 `#applyPlanMode()` 负责。
   *
   */
  #assertPlanModeRequest(request: RobotSessionRequest): void {
    if (request?.planMode !== true) return
    if (this.#commandsService() === undefined) throw new Error(PLAN_MODE_UNAVAILABLE)
  }

  /**
   * 在投递第一轮 prompt 之前进入 / 清除 plan 模式。
   *
   * `true` 进入、`false` 确保退出、省略表示不改变。DSH 的 plan 模式是会话级
   * 状态，对 profile 根部插件唯一可用的入口是命令：对目标 agent 执行
   * `/plan`（与用户在会话里输入 `/plan` 完全相同），退出用 `/plan off`。
   * 不能直接读 `planMode` 服务实例——在 web/desktop 的组合里它被 `isolate`
   * 在会话 preset 内，根作用域既看不到、也不该依赖它。
   *
   * 进入必须发生在第一轮之前：此时没有开放 turn，命令会立即写入 `plan/mode`，
   * 第一步的请求组装就能看到 `plan:policy` 与 `exit_plan_mode`。退出是
   * best-effort：命令不可用或执行失败只记日志，不影响普通节点。
   *
   */
  async #applyPlanMode(
    agent: LiveAgent,
    request: RobotSessionRequest,
    signal?: AbortSignal | undefined,
  ): Promise<void> {
    const requested = request?.planMode
    if (requested !== true && requested !== false) return
    const commands = this.#commandsService()
    if (commands === undefined) {
      if (requested === true) throw new Error(PLAN_MODE_UNAVAILABLE)
      return
    }
    // 普通节点只在复用会话可能残留 plan 状态时才清理；新会话没有可清理的东西，
    // 不必给每个节点都写一条命令事件。
    if (requested === false && !readPlanModeActive(agent?.session)) return
    const line = requested === true ? '/plan' : '/plan off'
    try {
      const execution = await commands.execute(
        agent,
        line,
        [],
        signal ?? new AbortController().signal,
      )
      if (execution === undefined) {
        if (requested === true) throw new Error(PLAN_MODE_UNAVAILABLE)
      } else {
        const failure = commandFailure(execution)
        if (failure !== undefined) {
          // 进入失败必须让节点失败：静默按普通模式跑完会违背 plan 节点的语义。
          if (requested === true) {
            throw new Error(
              `plan mode could not be entered: the /plan command reported "${failure}"; refusing to run the node in normal mode`,
            )
          }
          this.ctx?.logger?.warn?.(
            `buka-robots: /plan off reported "${failure}" for robot session "${String(agent?.id ?? '')}"`,
          )
        }
      }
    } catch (error) {
      if (requested === true) throw error
      this.ctx?.logger?.warn?.(
        `buka-robots: could not leave plan mode for robot session "${String(agent?.id ?? '')}": ${describeError(error)}`,
      )
    }
  }

  /**
   * 新会话的非阻塞 dispatch：建会话、投 prompt、返回句柄；不等待这一轮结束。
   *
   */
  async #startDispatch({
    request,
    robot,
    agentOptions,
    signal,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
  }): Promise<RobotSessionObserver> {
    let prepared: {
      sessionId: string
      agent: LiveAgent
      state: ReportedState
      handle: AgentHandleLike
    }
    try {
      prepared = await this.#createVisibleAgent({ request, robot, agentOptions, signal })
    } catch (error) {
      throw this.#creationError(robot, error, signal)
    }
    // plan 模式必须在第一轮 prompt 之前提交：对 agent 执行 /plan 之后，第一步的
    // 请求组装就能看到 plan:policy 与 exit_plan_mode。
    try {
      await this.#applyPlanMode(prepared.agent, request, signal)
    } catch (error) {
      try {
        await prepared.handle?.dispose?.()
      } catch {
        // 已释放：忽略。
      }
      throw error
    }
    const startSeq = seqOf(prepared.agent)
    prepared.agent.followup(followupMessage(request.prompt ?? ''))
    return this.#observeHandle({
      agent: prepared.agent,
      state: prepared.state,
      handle: prepared.handle,
      sessionId: prepared.sessionId,
      robot,
      request,
      resumed: false,
      compacted: false,
      compactionError: undefined,
      startSeq,
    })
  }

  /**
   * 续接会话的非阻塞 dispatch：resume → compact → 投 prompt → 返回句柄。
   * 续接失败直接抛错，不新开会话。
   *
   */
  async #continueDispatch({
    request,
    robot,
    agentOptions,
    signal,
    sessionId,
  }: {
    request: RobotSessionRequest
    robot: RobotTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
    sessionId: string
  }): Promise<RobotSessionObserver> {
    let prepared: {
      sessionId: string
      agent: LiveAgent
      state: ReportedState
      handle: AgentHandleLike
    }
    try {
      prepared = await this.#resumeAgent({ request, robot, agentOptions, signal, sessionId })
    } catch (error) {
      if (signal?.aborted === true)
        throw new RobotSessionStop('aborted', 'robot session was cancelled')
      throw new Error(
        `could not resume robot session "${sessionId}" for robot "${robot.name}": ${describeError(error)}; refusing to start a new robot session`,
        { cause: error },
      )
    }

    const compaction = await this.#compactSession(prepared.agent, signal)
    // plan 模式必须在第一轮 prompt 之前提交；compact 不会改变 plan 状态。
    try {
      await this.#applyPlanMode(prepared.agent, request, signal)
    } catch (error) {
      try {
        await prepared.handle?.dispose?.()
      } catch {
        // 已释放：忽略。
      }
      throw error
    }
    const startSeq = seqOf(prepared.agent)
    prepared.agent.followup(followupMessage(request.prompt ?? ''))
    return this.#observeHandle({
      agent: prepared.agent,
      state: prepared.state,
      handle: prepared.handle,
      sessionId: prepared.sessionId,
      robot,
      request,
      resumed: true,
      compacted: compaction.compacted,
      compactionError: compaction.compactionError,
      startSeq,
    })
  }

  /**
   * 把一次非阻塞 dispatch 包装成观察者句柄。句柄只持有这一个 live agent 的
   * 操作，不负责等待；`readResult` 从会话日志读，`cancel` 只取消当前轮。
   *
   */
  #observeHandle({
    agent,
    state,
    handle,
    sessionId,
    robot,
    request,
    resumed,
    compacted,
    compactionError,
    startSeq,
  }: {
    agent: LiveAgent
    state: ReportedState
    handle: AgentHandleLike
    sessionId?: string | undefined
    robot: RobotTarget
    request: RobotSessionRequest
    resumed: boolean
    compacted: boolean
    compactionError: string | undefined
    startSeq: number
  }): RobotSessionObserver {
    const service = this
    let disposed = false
    let retries = 0
    const dispose = async () => {
      if (disposed) return
      disposed = true
      await service.#releaseAgent(handle, sessionId ?? '')
    }
    const observer: RobotSessionObserver = {
      mode: 'session',
      sessionId: typeof agent?.id === 'string' && agent.id !== '' ? agent.id : (sessionId ?? ''),
      robot: robot.name,
      cwd: robot.path,
      resumed,
      compacted,
      ...(compactionError === undefined ? {} : { compactionError }),
      startSeq,
      /**
       * 从日志读这一轮的结果；`sinceSeq` 之前的轮次不算。
       *
       */
      readResult({
        sinceSeq = observer.startSeq,
      }: {
        sinceSeq?: number
      } = {}): Record<string, unknown> {
        const turn = readSessionTurn(agent?.session, sinceSeq)
        const structured =
          state?.reported?.value !== undefined
            ? state.reported.value
            : parseStructuredText(turn.text)
        return {
          sessionId: observer.sessionId,
          text: turn.text,
          stopReason: turn.stopReason,
          turnEnded: turn.turnEnded,
          ...(turn.turnEndSeq === null ? {} : { turnEndSeq: turn.turnEndSeq }),
          ...(structured === undefined ? {} : { structured }),
          reportSubmitted:
            state?.reported?.value !== undefined ||
            structuredSubmittedSince(agent?.session, sinceSeq),
        }
      },
      /**
       * 在同一会话里再发一条消息（结构化结果重试 / 恢复续跑用）。返回新的起点 seq。
       *
       */
      async send(
        text: string,
        { compactFirst = true }: { compactFirst?: boolean } = {},
      ): Promise<number> {
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('send requires a non-empty prompt')
        }
        if (compactFirst) {
          const compaction = await service.#compactSession(agent, request.signal)
          observer.compacted = compaction.compacted || observer.compacted
          if (compaction.compactionError !== undefined)
            observer.compactionError = compaction.compactionError
        }
        // 新的一轮开始：上一轮的结构化结果不能算到这一轮。
        if (state?.reported !== undefined) state.reported.value = undefined
        const next = seqOf(agent)
        agent.followup(followupMessage(text))
        observer.startSeq = next
        return next
      },
      /**
       * 没交回结构化结果时，按调用方给的 `routes` / `reason` 取下一条追问；
       * 没有额度时返回 `null`。工作流 supervisor 在缺 JSON、缺 `next`、
       * `next` 不合法、结果不匹配 output 或 abort 形态不合法时调用它。
       *
       */
      retryReport(
        options: {
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
        } = {},
      ): string | null {
        const max = service.resultRetries
        if (!Number.isInteger(max) || max <= 0 || retries >= max) return null
        retries += 1
        return resultRetryPrompt(retries, max, {
          toolName: STRUCTURED_OUTPUT_TOOL,
          routes: options?.routes ?? request.routes,
          abortable:
            typeof options?.abortable === 'boolean'
              ? options.abortable
              : request.abortable === true,
          reason: typeof options?.reason === 'string' ? options.reason : undefined,
          detail: typeof options?.detail === 'string' ? options.detail : undefined,
        })
      },
      /**
       * 读当前 live agent 的 plan 模式状态：从会话日志的 `plan/mode` 事件折叠，
       * 读不到时按未激活处理。工作流观察者用它判断一个 plan 节点结束一轮时
       * 是否仍停在计划阶段。
       *
       */
      getPlanMode(): { active: boolean } | null {
        const session = agent?.session
        if (session === undefined || session === null) return null
        try {
          return { active: readPlanModeActive(session) }
        } catch (error) {
          service.ctx?.logger?.warn?.(
            `buka-robots: could not read plan mode for session "${observer.sessionId}": ${describeError(error)}`,
          )
          return null
        }
      },
      /**
       * 尽力进入 / 退出当前 live agent 的 plan 模式。工作流在节点结束时清除
       * 自己进入的 plan 模式：只有日志显示仍在 plan 模式时才发 `/plan off`；
       * 命令失败只记日志，不改变节点结果。
       *
       */
      setPlanMode(active: boolean): void {
        const commands = service.#commandsService()
        if (commands === undefined) return
        if (active !== true && !readPlanModeActive(agent?.session)) return
        const line = active === true ? '/plan' : '/plan off'
        const warn = (error: unknown) => {
          service.ctx?.logger?.warn?.(
            `buka-robots: could not ${active === true ? 'enter' : 'leave'} plan mode for robot session "${observer.sessionId}": ${describeError(error)}`,
          )
        }
        try {
          const pending = commands.execute(agent, line, [], new AbortController().signal)
          void Promise.resolve(pending).catch(warn)
        } catch (error) {
          warn(error)
        }
      },
      /**
       * 取消当前轮；等它落定后把已经写下的文本读回来。
       *
       */
      async cancel(reason?: string): Promise<Record<string, unknown>> {
        try {
          agent.cancel(
            {
              kind: 'hook',
              reason:
                typeof reason === 'string' && reason !== '' ? reason : 'robot session cancelled',
            },
            { keepInbox: true },
          )
        } catch {
          // 已停止或已释放：忽略。
        }
        await waitForSettle(agent)
        return observer.readResult()
      },
      dispose,
    }
    return observer
  }

  /**
   * 续接前压缩会话历史；失败不阻断，把原因交给调用方展示。
   *
   */
  async #compactSession(
    agent: LiveAgent,
    signal?: AbortSignal,
  ): Promise<{ compacted: boolean; compactionError?: string }> {
    const compaction = optionalService<CompactionServiceLike>(this.ctx, 'compaction')
    if (typeof compaction?.compactNow !== 'function') {
      const message =
        'the host compaction service is unavailable; enable @deepseek-ai/dsh-compaction-basic to compact reused robot sessions'
      this.ctx?.logger?.warn?.(
        `buka-robots: continuing robot session without compaction: ${message}`,
      )
      return { compacted: false, compactionError: message }
    }
    try {
      const result = await compaction.compactNow(agent, signal ?? new AbortController().signal)
      return { compacted: result !== null && result !== undefined }
    } catch (error) {
      if (signal?.aborted === true)
        throw new RobotSessionStop('aborted', 'robot session was cancelled')
      const message = describeError(error)
      this.ctx?.logger?.warn?.(
        `buka-robots: compacting robot session failed; continuing without it: ${message}`,
      )
      return { compacted: false, compactionError: message }
    }
  }

  /**
   * 释放一次 dispatch / 续接对应的 live agent，并把这个仍然持久化的会话补通告
   * 回客户端。会话日志由 DSH 保存，释放 agent 只影响这一轮的内存占用。
   *
   * `#assertVisibleAgent` 拒绝隐藏 subagent 时走的是普通 `disposeHandle`：
   * 那类会话本来就不该出现在侧边栏。
   *
   */
  async #releaseAgent(handle: AgentHandleLike, sessionId: string): Promise<void> {
    await disposeHandle(handle)
    await this.#announceDurableSession(sessionId)
  }

  /**
   * 把刚释放 agent 的机器人会话重新通告给客户端（`api-session/added`）。
   *
   * DSH 在 `session/disposed` 时会向客户端发 `api-session/removed`，而机器人
   * 会话的 agent 是每个节点结束就释放的：只发 removed 的话，会话会从侧边栏
   * 消失，运行页「打开会话」也会因为客户端列表里没有这个 id 而报
   * `sessions.retain: unknown session`。会话本身还在磁盘上，所以这里用宿主
   * `sessionController.list()` 取回它（此时是冷会话的 summary）并补发一次
   * `api-session/added`，客户端就把它当作普通历史会话保留下来。
   *
   * 通告只是可读性补偿：服务缺失（headless 组合）、列表读取失败、事件参数
   * 不可序列化时都只记日志，绝不影响节点结果。
   *
   */
  async #announceDurableSession(sessionId: string): Promise<void> {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (id === '') return
    const ctx = this.ctx
    if (ctx === null || ctx === undefined || typeof ctx.emit !== 'function') return
    const controller = optionalService<SessionControllerLike>(ctx, 'sessionController')
    if (controller === null || controller === undefined || typeof controller.list !== 'function')
      return

    let summary: { sessionId?: unknown } | undefined
    try {
      const signal =
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(ANNOUNCE_SESSION_TIMEOUT_MS)
          : new AbortController().signal
      const result = await controller.list({}, signal)
      const items = Array.isArray(result?.items) ? result.items : []
      summary = items.find((item) => item?.sessionId === id)
    } catch (error) {
      ctx.logger?.warn?.(
        `buka-robots: could not read the session list while re-announcing robot session "${id}": ${describeError(error)}`,
      )
      return
    }
    if (summary === undefined) return

    try {
      ctx.emit('api-session/added', summary)
    } catch (error) {
      ctx.logger?.warn?.(
        `buka-robots: could not re-announce robot session "${id}" after releasing its agent: ${describeError(error)}`,
      )
    }
  }

  /**
   * 把机器人会话挂到机器人自己的工作区。会话 header 的 `cwd` 必须等于工作区
   * 路径（DSH 的 attach 会校验），机器人目录正好满足。
   *
   * 挂不上（例如机器人还没挂载成工作区）不算致命错误：会话仍能通过 runId /
   * 页面打开，只是不会出现在侧边栏。
   *
   */
  async #attachSessionToWorkspace(sessionId: string, robot: RobotTarget): Promise<void> {
    const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry
    if (registry === undefined || registry === null) return
    try {
      let workspace: { attachSession?(sessionId: string): Promise<unknown> } | null | undefined
      if (typeof registry.resolveByPath === 'function')
        workspace = await registry.resolveByPath(robot.path)
      if (workspace === undefined || workspace === null) {
        if (typeof registry.list === 'function') {
          const list = registry.list()
          workspace = Array.isArray(list)
            ? list.find((entry) => entry?.path === robot.path)
            : undefined
        }
      }
      if (
        workspace !== undefined &&
        workspace !== null &&
        typeof workspace.attachSession === 'function'
      ) {
        await workspace.attachSession(sessionId)
      }
    } catch (error) {
      this.ctx?.logger?.warn?.(
        `buka-robots: could not attach robot session "${sessionId}" to the robot workspace: ${describeError(error)}`,
      )
    }
  }

  /**
   * 解析机器人名称并在登记表 / 磁盘上确认。
   *
   */
  async #resolveRobot(name: unknown, _request: RobotSessionRequest = {}): Promise<RobotTarget> {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!isValidRobotName(trimmed)) {
      throw new Error(`invalid robot name: ${String(name)}`)
    }
    const registry = await readRobotRegistry({ file: this.registryFile })
    if (!registry.corrupt) {
      const robot = registry.robots.find((entry) => entry.name === trimmed)
      if (robot !== undefined) {
        let stat: import('node:fs').Stats | undefined
        try {
          stat = await fs.stat(robot.path)
        } catch {
          stat = undefined
        }
        if (stat === undefined || !stat.isDirectory()) {
          throw new Error(`robot directory does not exist: ${robot.path}`)
        }
        return { name: robot.name, path: robot.path }
      }
    }

    if (registry.corrupt) {
      throw new Error(`robot registry is unreadable: ${this.registryFile}`)
    }
    throw new Error(`unknown robot: ${trimmed}`)
  }

  /**
   * 默认模型路由：来自宿主默认模型选择。
   *
   */
  #defaultAgentOptions(): AgentOptions {
    const defaultModel = optionalService<AgentDefaultModelLike>(this.ctx, 'agentDefaultModel')
    const selection = defaultModel?.currentSelection?.()
    if (selection === undefined || selection === null) return {}
    return {
      ...(typeof selection.provider === 'string' ? { provider: selection.provider } : {}),
      ...(typeof selection.model === 'string' ? { model: selection.model } : {}),
      ...(typeof selection.reasoningEffort === 'string'
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    }
  }
}

// 结果解析、重试话术、句柄 / 超时与列表摘要拆在 engine/ 下；这里继续对外
// 导出同样的符号，消费方与测试不需要改 import 路径。
export { RobotSessionStop } from './engine/errors.ts'
export {
  DEFAULT_RESULT_RETRIES,
  parseStructuredText,
  resultFailureMessage,
  resultRetryPrompt,
  STRUCTURED_OUTPUT_TOOL,
  structuredSubmittedSince,
} from './engine/result.ts'
export { mapTurnEnd, readSessionOutcome, readSessionTurn } from './engine/session-events.ts'
export { summarizeRobot } from './engine/summary.ts'
export type {
  AgentDefaultModelLike,
  AgentHandleLike,
  AgentOptions,
  AgentPresetsServiceLike,
  AgentsServiceLike,
  ChildContextLike,
  CommandsServiceLike,
  CompactionServiceLike,
  CreateAgentOptionsLike,
  LiveAgent,
  ReportedState,
  ResumeAgentOptionsLike,
  RobotSessionHandle,
  RobotSessionObserver,
  RobotSessionRequest,
  RobotSessionResult,
  RobotTarget,
  SessionControllerLike,
  SessionEventLike,
  SessionLike,
  SessionTitleServiceLike,
  SystemPromptServiceLike,
  ToolsRegistryLike,
} from './service/types.ts'
