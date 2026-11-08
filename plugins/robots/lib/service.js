/**
 * `@buka/dsh-plugin-robots` 对外提供的 Host Service：`ctx.bukaRobots`。
 *
 * 目前的能力，供工作流插件（以及将来的编排器）使用：
 *
 * - `list()`：机器人登记表 + 目录状态 + 挂载状态 + 已装 skills；
 * - `avatarMap()`：机器人名 → 预设头像 id（只读登记表，工作流节点图用它）；
 * - `startSession(request)`：在机器人目录下开一个会话（或按 `sessionId` 续接已有
 *   会话，续接前先 compact），投递一段提示词；新会话是挂到机器人工作区的普通
 *   顶层会话（侧边栏可见），
 *   等它结束或空闲后返回最终文本（可选结构化结果），期间不弹审批。
 *   声明 `report: true` 时要求会话交回一个 JSON 对象；如果它没交，就在**同一个
 *   会话**里补一条消息要求按格式重新回复（最多 `reportRetries` 次），只有重试
 *   用尽仍没有结果时节点才失败。
 *
 * 默认后端是 `ctx.subagents.startActivation()`（spawn）：调用方 agent 提供
 * 会话作用域，`cwd` 是机器人目录，机器人自己的 AGENTS.md / 项目 skills 照常
 * 生效，`delivery: 'caller'` 让结果只回给编排器。没有调用方 agent 或 subagent
 * 失败时退化为 subagent 子会话（见 `#startSubagentSession`；子会话不会出现在侧边栏）。
 *
 * 通过 `ctx.provide('bukaRobots', new RobotSessionService(...))` 注册，消费方
 * 用 `inject: ['bukaRobots']` 或 `ctx.get('bukaRobots')` 获取。`defineTool`
 * 由入口注入，这样本模块可以脱离 DSH 依赖被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-robots/service
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'

import {
  isValidRobotName,
  listRobots,
  readRobotRegistry,
} from './robot-store.js'
import { resolveAvatar } from './avatar.js'

/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaRobots`。 */
export const SERVICE_NAME = 'bukaRobots'

/** 默认节点超时：10 分钟。 */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/** 默认重试次数：机器人没有交回结构化结果时，在原会话里再要求几次。 */
export const DEFAULT_REPORT_RETRIES = 2

/** subagent 后端提交结构化结果时使用的工具名（由 DSH 的 outputSchema 注册）。 */
export const STRUCTURED_OUTPUT_TOOL = 'structured_output'

/**
 * 续接会话里补装的 `structured_output` 工具说明。
 *
 * 新会话由 subagent 运行时按 outputSchema 注册工具和这段说明；续接走普通
 * `agents.resume()`，运行时不知道这次调用的 outputSchema，所以由本服务补上。
 */
const STRUCTURED_OUTPUT_INSTRUCTION =
  `When you have your final answer, you MUST report it by calling the \`${STRUCTURED_OUTPUT_TOOL}\` tool ` +
  'with arguments matching its parameter schema exactly. Do not finish with a plain text answer: ' +
  'only the tool call counts as your result.'

/** 取消后等待 agent 落定（写入 turn/end）的最长时间。 */
const SETTLE_AFTER_CANCEL_MS = 2000

/** 补发的重试消息多久还没开新的一轮，就从 inbox 里撤回，避免活动永远等下去。 */
const REPORT_RETRY_WAKE_TIMEOUT_MS = 30_000

/** 机器人会话被超时 / 取消时抛出的内部错误。 */
export class RobotSessionStop extends Error {
  /**
   * @param {'timeout' | 'aborted'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message)
    this.name = 'RobotSessionStop'
    this.kind = kind
  }
}

/**
 * 机器人会话服务。
 */
export class RobotSessionService {
  /**
   * @param {{
   *   ctx: import('@deepseek-ai/cordis').Context,
   *   robotsDir: string,
   *   registryFile: string,
   *   defineTool?: Function,
   *   subagentProvider?: string,
   *   reportRetries?: number,
   *   reportRetryWakeTimeoutMs?: number,
   * }} options
   */
  constructor(options) {
    this.ctx = options.ctx
    this.robotsDir = options.robotsDir
    this.registryFile = options.registryFile
    this.defineTool = options.defineTool
    this.subagentProvider =
      typeof options.subagentProvider === 'string' && options.subagentProvider.trim() !== ''
        ? options.subagentProvider.trim()
        : 'spawn'
    this.reportRetries =
      Number.isInteger(options.reportRetries) && options.reportRetries >= 0
        ? options.reportRetries
        : DEFAULT_REPORT_RETRIES
    this.reportRetryWakeTimeoutMs =
      Number.isInteger(options.reportRetryWakeTimeoutMs) && options.reportRetryWakeTimeoutMs > 0
        ? options.reportRetryWakeTimeoutMs
        : REPORT_RETRY_WAKE_TIMEOUT_MS
  }

  /**
   * 列出机器人。
   *
   * @returns {Promise<{
   *   root: string,
   *   registry: string,
   *   corrupt: boolean,
   *   robots: Array<Record<string, any>>,
   * }>}
   */
  async list() {
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
   * 旧登记表里缺头像的机器人按名字兜底成一个确定的预设；登记表损坏时返回空表。
   *
   * @returns {Promise<Record<string, string>>}
   */
  async avatarMap() {
    const registry = await readRobotRegistry({ file: this.registryFile })
    if (registry.corrupt) return {}
    /** @type {Record<string, string>} */
    const map = {}
    for (const robot of registry.robots) map[robot.name] = resolveAvatar(robot.avatar, robot.name)
    return map
  }

  /**
   * 在机器人目录下开一个会话并执行一段提示词；传 `sessionId` 时改为续接
   * 同一个会话（先 compact 历史，再发新的 prompt）。
   *
   * 返回的 `result` 在会话空闲（或超时 / 取消）后落定，不会 reject；调用方
   * 根据 `stopReason` 判断结果。会话在读取完结果后自动 dispose，日志保留。
   *
   * @param {{
   *   robot: string,
   *   prompt: string,
   *   agent?: { id: string, ctx?: import('@deepseek-ai/cordis').Context },
     *   agentPreset?: string,
   *   report?: boolean,
   *   title?: string,
   *   agentOptions?: { provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number },
   *   approval?: 'ask' | 'never',
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   *   sessionId?: string,
   * }} request
   * @returns {Promise<{
   *   id: string,
   *   robot: string,
   *   cwd: string,
   *   resumed: boolean,
   *   result: Promise<Record<string, any>>,
   *   cancel: (reason?: string) => void,
   *   dispose: () => Promise<void>,
   * }}>}
   */
  async startSession(request = {}) {
    if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
      throw new Error('startSession requires a non-empty prompt')
    }
    const robot = await this.#resolveRobot(request.robot)
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
   * 新开一个会话。
   *
   * 默认创建**普通顶层会话**：它会挂到机器人自己的工作区，因此侧边栏能看到、
   * 能像普通对话一样打开。早期版本走 subagent 子会话，但 DSH 侧边栏会刻意
   * 隐藏 `origin: subagent` 的会话，用户点「打开会话」后只在主区域显示、列表里
   * 找不到，所以这里改成先建普通会话。
   *
   * 普通会话拿不到模型传输等极端情况下，退回 subagent 后端，保证工作流仍能
   * 继续跑（只是该会话不会出现在侧边栏）。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #startNewSession({ request, robot, agentOptions, signal }) {
    try {
      return await this.#startVisibleSession({ request, robot, agentOptions, signal })
    } catch (error) {
      if (signal?.aborted === true) throw error
      const subagents = this.ctx?.get?.('subagents')
      if (
        request.agent !== undefined &&
        request.agent !== null &&
        typeof subagents?.startActivation === 'function'
      ) {
        this.ctx?.logger?.warn?.(
          `buka-robots: could not create a normal robot session; falling back to a subagent session: ${describeError(error)}`,
        )
        return await this.#startSubagentSession({ request, robot, agentOptions, subagents, signal })
      }
      throw error
    }
  }

  /**
   * 在已有机器人会话上继续：先 compact 压缩历史，再把这一次的 prompt 发进去。
   *
   * 与「新开会话」不同，这里通过 `ctx.agents.resume()` 把会话重新加载成 live
   * agent，因此能直接调用 `ctx.compaction.compactNow()`；结束一轮后再释放
   * agent，会话本身留在持久化存储里，供下一次进入继续使用。
   *
   * 旧运行里记录的子会话可能已经不存在、或没有可恢复的续接状态：此时退回
   * 「新开会话」，把原因放进结果的 `resumeError`，不让整个工作流因此失败。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   *   sessionId: string,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #continueSession({ request, robot, agentOptions, signal, sessionId }) {
    const agents = this.ctx?.get?.('agents') ?? this.ctx?.agents
    if (typeof agents?.resume !== 'function') {
      return await this.#startFreshAfterResumeFailure({
        request,
        robot,
        agentOptions,
        signal,
        message: 'the agent service cannot resume a robot session in this composition',
      })
    }

    const state = { reported: { value: undefined } }
    /** @type {any} */
    let handle
    try {
      handle = await agents.resume({
        resumeSessionId: sessionId,
        parentAgent: request.agent,
        agentOptions,
        signal,
        setup: async (childCtx, agent) => {
          await this.#composeSession(childCtx, agent, request, state, { resume: true })
        },
      })
    } catch (error) {
      if (signal?.aborted === true) throw new RobotSessionStop('aborted', 'robot session was cancelled')
      const message = describeError(error)
      this.ctx?.logger?.warn?.(
        `buka-robots: could not resume robot session "${sessionId}"; starting a new one: ${message}`,
      )
      return await this.#startFreshAfterResumeFailure({ request, robot, agentOptions, signal, message })
    }

    const agent = handle.agent
    // 续接的老会话可能还没有标题（早期版本没命名）；顺手补一次，已有的标题
    // 不覆盖，避免把用户手动改的名字改回去。
    this.#titleSession(agent, request.title)
    // 机器人节点自身不弹审批：需要审批的操作直接拒绝，工作必须落在机器人目录内。
    if (request.approval !== 'ask') {
      try {
        this.ctx?.get?.('approval')?.setPolicy?.(agent, 'never')
      } catch {
        // 审批服务不可用时保持默认策略。
      }
    }

    // 旧版本建的 subagent 会话仍可能不在工作区里；顺手补挂一次，普通会话则
    // 保持幂等。
    await this.#attachSessionToWorkspace(sessionId, robot)
    const timeoutMs = positive(request.timeoutMs) ?? DEFAULT_TIMEOUT_MS
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
        dispose: () => disposeHandle(handle),
      }),
      cancel(reason) {
        try {
          agent.cancel(
            {
              kind: 'hook',
              reason: typeof reason === 'string' && reason !== '' ? reason : 'robot session cancelled',
            },
            { keepInbox: true },
          )
        } catch {
          // 已停止或已释放：忽略。
        }
      },
      dispose: () => disposeHandle(handle),
    }
  }

  /**
   * 续接失败时退回新会话，并把失败原因带到结果里。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   *   message: string,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #startFreshAfterResumeFailure({ request, robot, agentOptions, signal, message }) {
    const fresh = await this.#startNewSession({ request, robot, agentOptions, signal })
    const result = Promise.resolve(fresh.result).then((value) => ({
      ...value,
      resumed: false,
      compacted: false,
      resumeError: message,
    }))
    return { ...fresh, resumed: false, resumeError: message, result }
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
   * @param {any} agent 已创建的 agent（`agent.session` 必须是 live 会话）
   * @param {unknown} title 调用方给的标题；空串 / 非字符串表示不命名
   * @returns {void}
   */
  #titleSession(agent, title) {
    const text = typeof title === 'string' ? title.trim() : ''
    if (text === '') return
    const session = agent?.session
    if (session === undefined || session === null) return
    const service = this.ctx?.get?.('sessionTitle') ?? this.ctx?.sessionTitle
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
   * 给新会话 / 续接会话装上机器人自己的工作 preset，report 节点再补一个
   * scoped 的 `structured_output` 工具。
   *
   * 普通顶层会话和 `agents.resume()` 都不会自动套 composition，所以由服务显式
   * 挂载；结构化工具也一样，运行时不知道这次调用的 outputSchema，由服务补上。
   *
   * @param {any} childCtx
   * @param {any} agent
   * @param {Record<string, any>} request
   * @param {{ reported: { value: unknown } }} state
   * @param {{ resume: boolean }} options
   * @returns {Promise<void>}
   */
  async #composeSession(childCtx, agent, request, state, { resume }) {
    const presets = childCtx?.get?.('agentPresets') ?? childCtx?.agentPresets
    if (presets !== undefined && presets !== null) {
      const recorded =
        resume && typeof presets.presetForSession === 'function' ? presets.presetForSession(agent?.session) : null
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
    if (request.report === true) this.#installStructuredTool(childCtx, state)
  }

  /**
   * 在续接出来的 agent 上安装结构化结果工具（仅 report 节点）。
   *
   * @param {any} childCtx
   * @param {{ reported: { value: unknown } }} state
   * @returns {void}
   */
  #installStructuredTool(childCtx, state) {
    const tools = childCtx?.get?.('tools') ?? childCtx?.tools
    if (typeof tools?.register !== 'function') return
    tools.register({
      name: STRUCTURED_OUTPUT_TOOL,
      description:
        "Report your final structured result. Call this exactly once, when your answer is complete; the arguments must match this tool's parameter schema exactly.",
      parameters: { type: 'object', additionalProperties: true },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { recorded: { type: 'boolean', const: true } },
          required: ['recorded'],
        },
        render: () => [{ type: 'text', text: 'Structured output recorded.' }],
      },
      execute(args, exec) {
        if (state.reported.value !== undefined) throw new Error('structured output already recorded')
        state.reported.value = args
        try {
          exec?.concludeTurn?.()
        } catch {
          // 老运行时没有 concludeTurn：靠 turn/end 自然结束。
        }
        return { recorded: true }
      },
    })
    const systemPrompt = childCtx?.get?.('systemPrompt') ?? childCtx?.systemPrompt
    if (typeof systemPrompt?.section === 'function') {
      try {
        systemPrompt.section({
          name: `tool:${STRUCTURED_OUTPUT_TOOL}`,
          order:
            typeof systemPrompt.getSectionOrder === 'function'
              ? systemPrompt.getSectionOrder('STRUCTURED_OUTPUT')
              : 9900,
          text: STRUCTURED_OUTPUT_INSTRUCTION,
        })
      } catch {
        // 没有 systemPrompt 注册表时退回提示词里的重试消息。
      }
    }
  }

  /**
   * 在续接会话上执行一轮：compact → followup → 等空闲 → 读结果（report 节点
   * 缺结构化结果时在同会话内补问）。
   *
   * @param {{
   *   agent: any,
   *   robot: { name: string, path: string },
   *   request: Record<string, any>,
   *   state: { reported: { value: unknown } },
   *   timeoutMs: number,
   *   signal?: AbortSignal,
   *   compactFirst: boolean,
   *   dispose: () => Promise<void>,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #runSessionTurn({ agent, robot, request, state, timeoutMs, signal, compactFirst, dispose }) {
    const wantsReport = request.report === true
    const deadline = Date.now() + timeoutMs
    const remaining = () => Math.max(1, deadline - Date.now())
    let compacted = false
    /** @type {string | undefined} */
    let compactionError
    /** @type {RobotSessionStop | null} */
    let stopped = null
    /** @type {string} */
    let errorMessage
    let text = ''
    let stopReason = 'completed'
    let retries = 0
    let structured
    // 超时 / 取消时从这一轮的起点往后读，避免把上一轮的旧文本当成本轮交付物。
    let turnStartSeq = 0

    try {
      if (compactFirst) {
        const compaction = this.ctx?.get?.('compaction')
        if (typeof compaction?.compactNow === 'function') {
          try {
            // compactNow 要求一个真实的 AbortSignal；没有取消信号时给一个永不中止的。
            const compactedResult = await compaction.compactNow(agent, signal ?? new AbortController().signal)
            compacted = compactedResult !== null && compactedResult !== undefined
          } catch (error) {
            if (signal?.aborted === true) throw new RobotSessionStop('aborted', 'robot session was cancelled')
            compactionError = describeError(error)
            this.ctx?.logger?.warn?.(
              `buka-robots: compacting robot session "${robot.name}" failed; continuing without it: ${compactionError}`,
            )
          }
        } else {
          // 续接的正确性不依赖压缩：没有压缩服务时仍然继续，但把原因交给调用方，
          // 运行页会提示，而不是静默地“没有 compact”。
          compactionError =
            'the host compaction service is unavailable; enable @deepseek-ai/dsh-compaction-basic to compact reused robot sessions'
          this.ctx?.logger?.warn?.(
            `buka-robots: continuing robot session "${robot.name}" without compaction: ${compactionError}`,
          )
        }
      }

      const startSeq = seqOf(agent)
      turnStartSeq = startSeq
      const firstTurn = waitForTurnEnd(agent, startSeq, remaining(), signal)
      agent.followup(followupMessage(request.prompt))
      await firstTurn
      let outcome = readSessionOutcome(agent.session, startSeq)
      text = outcome.text
      stopReason = outcome.stopReason
      structured = state.reported.value

      while (wantsReport && structured === undefined) {
        structured = parseStructuredText(text)
        if (structured !== undefined) break
        if (retries >= this.reportRetries) break
        retries += 1
        const retrySeq = seqOf(agent)
        const retryTurn = waitForTurnEnd(agent, retrySeq, remaining(), signal)
        try {
          agent.followup(followupMessage(reportRetryPrompt(retries, this.reportRetries, STRUCTURED_OUTPUT_TOOL)))
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

      if (wantsReport && structured === undefined) {
        errorMessage = reportFailureMessage(retries)
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
      ...(wantsReport ? { reportRetries: retries } : {}),
      stopReason,
      ...(errorMessage === undefined ? {} : { error: errorMessage }),
      resumed: compactFirst,
      compacted,
      ...(compactionError === undefined ? {} : { compactionError }),
    }
  }

  /**
   * 通过 `ctx.subagents` 启动一个机器人会话。
   *
   * 这是默认后端：新开会话时是一个独立子会话，`cwd` 是机器人目录，
   * 机器人的 AGENTS.md / 项目 skills 照常生效；`delivery: 'caller'` 表示结果
   * 只回给编排器，不往创建者会话里塞完成通知。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   subagents: any,
   *   signal?: AbortSignal,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #startSubagentSession({ request, robot, agentOptions, subagents, signal }) {
    const provider = this.subagentProvider
    if (typeof subagents.list === 'function' && !subagents.list().includes(provider)) {
      throw new Error(`subagent provider "${provider}" is not registered`)
    }
    const outputSchema = request.report === true ? { type: 'object', additionalProperties: true } : undefined
    const activation = await subagents.startActivation({
      provider,
      label:
        typeof request.title === 'string' && request.title.trim() !== ''
          ? request.title.trim()
          : `robot: ${robot.name}`,
      request: {
        cwd: robot.path,
        prompt: [{ type: 'text', text: request.prompt }],
        parent: request.agent,
        agentOptions,
        // 显式指定节点会话的 preset：编排器自己跑在专用 preset 上，机器人
        // 节点必须落到普通工作 preset，不能继承编排器的 persona 与工具集。
        ...(typeof request.agentPreset === 'string' && request.agentPreset.trim() !== ''
          ? { agentPreset: request.agentPreset.trim() }
          : {}),
        ...(outputSchema === undefined ? {} : { outputSchema }),
      },
      delivery: 'caller',
      signal: signal ?? new AbortController().signal,
    })

    const timeoutMs = positive(request.timeoutMs) ?? DEFAULT_TIMEOUT_MS
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      try {
        await activation.dispose()
      } catch {
        // 释放失败不影响结果。
      }
    }
    const result = this.#trackSubagentResult({
      activation,
      robot,
      request,
      timeoutMs,
      signal,
      dispose,
    })
    return {
      id: activation.childId,
      robot: robot.name,
      cwd: robot.path,
      result,
      cancel() {
        try {
          subagents.interrupt(activation.childId, { kind: 'ancestor', agent: request.agent })
        } catch {
          // 已停止或已释放：忽略。
        }
      },
      dispose,
    }
  }

  /**
   * 等待 subagent 结果；超时 / 取消时中断并尽量收集已经产生的输出。
   *
   * @param {{
   *   activation: any,
   *   robot: { name: string, path: string },
   *   request: Record<string, any>,
   *   timeoutMs: number,
   *   signal?: AbortSignal,
   *   dispose: () => Promise<void>,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #trackSubagentResult({ activation, robot, request, timeoutMs, signal, dispose }) {
    const subagents = this.ctx?.get?.('subagents')
    const wantsReport = request.report === true
    const retry = this.#watchReportRetries({ childId: activation.childId, request, signal })
    let output = []
    let structured
    let stopReason = null
    let errorMessage
    try {
      const raw = await waitForSubagent(activation.result, { timeoutMs, signal })
      output = Array.isArray(raw?.output) ? raw.output : []
      structured = raw?.structured
      stopReason = typeof raw?.stopReason === 'string' ? raw.stopReason : 'error'
    } catch (error) {
      if (error instanceof RobotSessionStop) {
        try {
          subagents?.interrupt?.(activation.childId, { kind: 'ancestor', agent: request.agent })
        } catch {
          // 已经结束或被释放。
        }
        const settled = await settleAfterStop(activation.result)
        if (settled !== undefined) {
          output = Array.isArray(settled?.output) ? settled.output : []
          structured = settled?.structured
        }
        stopReason = error.kind
        errorMessage = error.message
      } else {
        stopReason = 'error'
        errorMessage = describeError(error)
      }
    } finally {
      await dispose()
    }
    const text = textOfContent(output)
    const retries = retry.retries()
    const lastTurnKind = retry.lastTurnKind()
    retry.dispose()
    // 会话把 JSON 写在回复正文里也算交回了结果：结构化工具只是首选通道。
    if (wantsReport && structured === undefined && lastTurnKind === 'completed') {
      const parsed = parseStructuredText(text)
      if (parsed !== undefined) {
        structured = parsed
        if (stopReason === 'error') {
          stopReason = 'completed'
          errorMessage = undefined
        }
      }
    }
    if (wantsReport && structured === undefined && errorMessage === undefined) {
      errorMessage = reportFailureMessage(retries)
      if (stopReason === 'completed') stopReason = 'error'
    }
    return {
      sessionId: activation.childId,
      robot: robot.name,
      text,
      ...(structured === undefined ? {} : { structured }),
      ...(wantsReport ? { reportRetries: retries } : {}),
      stopReason: stopReason ?? 'error',
      ...(errorMessage === undefined ? {} : { error: errorMessage }),
    }
  }

  /**
   * 盯着一个 report 节点会话：某一轮正常结束后仍没有交回结构化结果，就在**同一个
   * 会话**里补一条消息，要求它按要求的 JSON 格式回复；最多补 `reportRetries` 次。
   *
   * 消息直接投到子 agent 的 inbox（`followup`）：此时活动还没结算，管理器会看到
   * 待处理的下一轮而继续等待，因此重试发生在同一个活动、同一个会话里。
   *
   * @param {{ childId: string, request: Record<string, any>, signal?: AbortSignal }} input
   * @returns {{ retries: () => number, lastTurnKind: () => string | undefined, dispose: () => void }}
   */
  #watchReportRetries({ childId, request, signal }) {
    const noop = { retries: () => 0, lastTurnKind: () => undefined, dispose() {} }
    const max = this.reportRetries
    if (request.report !== true || max <= 0) return noop
    const agents = this.ctx?.get?.('agents')
    const child = typeof agents?.get === 'function' ? agents.get(childId) : undefined
    if (child === undefined || child === null) return noop
    if (typeof child.ctx?.on !== 'function' || typeof child.followup !== 'function') return noop

    const startSeq = typeof child.session?.seq === 'number' ? child.session.seq : 0
    let retries = 0
    /** @type {string | undefined} */
    let lastTurnKind
    let disposed = false
    /** @type {NodeJS.Timeout | undefined} */
    let wakeTimer
    /** @type {string | null} */
    let pendingMessageId = null

    const clearWakeTimer = () => {
      if (wakeTimer !== undefined) {
        clearTimeout(wakeTimer)
        wakeTimer = undefined
      }
    }
    const clearPending = () => {
      clearWakeTimer()
      pendingMessageId = null
    }

    const off = child.ctx.on('session/event', (session, event) => {
      if (disposed) return
      if (session !== undefined && child.session !== undefined && session !== child.session) return
      // 下一轮已经开起来：补发的消息被收下了。
      if (event?.type === 'turn/start') {
        clearPending()
        return
      }
      if (event?.type !== 'turn/end') return
      clearPending()
      const kind = event.data?.reason?.kind
      lastTurnKind = typeof kind === 'string' ? kind : 'completed'
      if (lastTurnKind !== 'completed') return
      if (structuredSubmittedSince(child.session, startSeq)) return
      // 最后一条回复本身就是 JSON 对象时也算交回，不必再追问。
      if (parseStructuredText(safeOutcomeText(child)) !== undefined) return
      if (retries >= max) return
      if (signal?.aborted === true) return
      retries += 1
      const attempt = retries
      // 事件回调里不能直接往会话追加消息（Session 在发布 turn/end 时拒绝重入）。
      // 第一跳之后本轮 driver 已收尾、Agent 回到 idle；第二跳再投递，`followup`
      // 会直接开下一轮，活动也就继续在同一个会话里等到这一轮结束。
      queueMicrotask(() => {
        if (disposed) return
        queueMicrotask(() => {
          if (disposed) {
            retries -= 1
            return
          }
          try {
            const message = followupMessage(reportRetryPrompt(attempt, max, STRUCTURED_OUTPUT_TOOL))
            child.followup(message)
            pendingMessageId = message.id
            // 消息落在 inbox 里但没能唤醒下一轮时撤回它，否则活动会一直等下去。
            clearWakeTimer()
            wakeTimer = setTimeout(() => {
              clearWakeTimer()
              const id = pendingMessageId
              pendingMessageId = null
              if (disposed || id === null) return
              try {
                child.inbox?.remove?.(id)
                this.ctx?.logger?.warn?.('buka-robots: a structured-result retry message never woke the session')
              } catch {
                // 已经不在队列里：忽略。
              }
            }, this.reportRetryWakeTimeoutMs)
            wakeTimer?.unref?.()
          } catch (error) {
            retries -= 1
            this.ctx?.logger?.warn?.(
              `buka-robots: could not ask the robot session for its structured result: ${describeError(error)}`,
            )
          }
        })
      })
    })

    return {
      retries: () => retries,
      lastTurnKind: () => lastTurnKind,
      dispose() {
        if (disposed) return
        disposed = true
        clearWakeTimer()
        try {
          off?.()
        } catch {
          // 会话已经释放：忽略。
        }
      },
    }
  }

  /**
   * 创建一个普通顶层会话：`cwd` 是机器人目录，composition 用机器人自己的工作
   * preset，并挂到机器人自己的工作区，所以侧边栏能看到、点开就是普通对话。
   *
   * 这是默认后端。只有它失败时才退回 `#startSubagentSession`（子会话不会出现在
   * 侧边栏，但至少能让工作流继续跑）。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #startVisibleSession({ request, robot, agentOptions, signal }) {
    const agents = this.ctx?.get?.('agents') ?? this.ctx?.agents
    if (typeof agents?.create !== 'function') {
      throw new Error('the agent service is unavailable, so a robot session cannot be created')
    }

    const state = { reported: { value: undefined } }
    const sessionId = randomUUID()
    const requestedPreset = typeof request.agentPreset === 'string' ? request.agentPreset.trim() : ''
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
    // 机器人会话的用户消息来源是 `buka-robot`，DSH 的自动标题只认 `user`
    // 来源的消息，所以新会话在这里显式命名，侧边栏里才不是「未命名」。
    this.#titleSession(agent, request.title)
    // 机器人节点自身不弹审批：需要审批的操作直接拒绝，工作必须落在机器人目录内。
    if (request.approval !== 'ask') {
      try {
        this.ctx?.get?.('approval')?.setPolicy?.(agent, 'never')
      } catch {
        // 审批服务不可用时保持默认策略。
      }
    }

    // 挂到机器人自己的工作区：这样侧边栏（按工作区分组）能看到这个会话，
    // `uiWorkspace.openSession()` 打开后也能在列表里找到它。
    await this.#attachSessionToWorkspace(sessionId, robot)

    const timeoutMs = positive(request.timeoutMs) ?? DEFAULT_TIMEOUT_MS
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      await disposeHandle(handle)
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
      cancel(reason) {
        try {
          agent.cancel(
            {
              kind: 'hook',
              reason: typeof reason === 'string' && reason !== '' ? reason : 'robot session cancelled',
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
   * 把机器人会话挂到机器人自己的工作区。会话 header 的 `cwd` 必须等于工作区
   * 路径（DSH 的 attach 会校验），机器人目录正好满足。
   *
   * 挂不上（例如机器人还没挂载成工作区）不算致命错误：会话仍能通过 runId /
   * 页面打开，只是不会出现在侧边栏。
   *
   * @param {string} sessionId
   * @param {{ name: string, path: string }} robot
   * @returns {Promise<void>}
   */
  async #attachSessionToWorkspace(sessionId, robot) {
    const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry
    if (registry === undefined || registry === null) return
    try {
      let workspace
      if (typeof registry.resolveByPath === 'function') workspace = await registry.resolveByPath(robot.path)
      if (workspace === undefined || workspace === null) {
        if (typeof registry.list === 'function') {
          const list = registry.list()
          workspace = Array.isArray(list) ? list.find((entry) => entry?.path === robot.path) : undefined
        }
      }
      if (workspace !== undefined && workspace !== null && typeof workspace.attachSession === 'function') {
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
   * @param {unknown} name
   * @returns {Promise<{ name: string, path: string }>}
   */
  async #resolveRobot(name) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!isValidRobotName(trimmed)) {
      throw new Error(`invalid robot name: ${String(name)}`)
    }
    const registry = await readRobotRegistry({ file: this.registryFile })
    if (registry.corrupt) {
      throw new Error(`robot registry is unreadable: ${this.registryFile}`)
    }
    const robot = registry.robots.find((entry) => entry.name === trimmed)
    if (robot === undefined) throw new Error(`unknown robot: ${trimmed}`)

    let stat
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

  /**
   * 默认模型路由：来自宿主默认模型选择。
   *
   * @returns {{ provider?: string, model?: string, reasoningEffort?: string }}
   */
  #defaultAgentOptions() {
    const defaultModel = this.ctx?.get?.('agentDefaultModel')
    const selection = defaultModel?.currentSelection?.()
    if (selection === undefined || selection === null) return {}
    return {
      ...(typeof selection.provider === 'string' ? { provider: selection.provider } : {}),
      ...(typeof selection.model === 'string' ? { model: selection.model } : {}),
      ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
    }
  }
}

/**
 * 机器人列表里的一行：去掉 AGENTS.md 正文等大字段，只保留编排需要的摘要。
 *
 * @param {Record<string, any>} robot
 * @returns {Record<string, any>}
 */
export function summarizeRobot(robot) {
  const agents = robot?.agents ?? {}
  return {
    name: robot?.name ?? '',
    path: robot?.path ?? '',
    createdAt: robot?.createdAt ?? null,
    avatar: resolveAvatar(robot?.avatar, robot?.name),
    exists: robot?.exists === true,
    mounted: robot?.mounted === true,
    workspaceId: robot?.workspaceId ?? null,
    skills: Array.isArray(robot?.skills)
      ? robot.skills.map((skill) => ({
          name: typeof skill?.name === 'string' ? skill.name : '',
          description: typeof skill?.description === 'string' ? skill.description : '',
        }))
      : [],
    agents: {
      exists: agents.exists === true,
      bytes: typeof agents.bytes === 'number' ? agents.bytes : 0,
      modifiedAt: agents.modifiedAt ?? null,
    },
  }
}

/**
 * 从会话日志里取最后一次 assistant 文本与 turn 结束原因。
 *
 * @param {any} session
 * @param {number} [startSeq] 只读取这个序号及之后的事件（续接会话时排除旧轮次）
 * @returns {{ text: string, stopReason: string }}
 */
export function readSessionOutcome(session, startSeq = 0) {
  const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
  let text = ''
  let reason
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < startSeq) continue
    if (event?.type === 'assistant/message') {
      const content = event?.data?.message?.content
      const parts = Array.isArray(content)
        ? content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
        : []
      if (parts.length > 0) text = parts.join('\n')
    } else if (event?.type === 'turn/end') {
      reason = event?.data?.reason
    }
  }
  return { text, stopReason: mapTurnEnd(reason) }
}

/**
 * 把 `turn/end.reason` 映射成节点结果里的 stopReason。
 *
 * @param {unknown} reason
 * @returns {string}
 */
export function mapTurnEnd(reason) {
  const kind = reason?.kind
  switch (kind) {
    case 'completed':
    case 'error':
    case 'max-tokens':
    case 'aborted':
    case 'interrupted':
    case 'blocked':
    case 'forked':
      return kind
    default:
      return typeof kind === 'string' ? kind : 'completed'
  }
}

/**
 * 拼接 subagent 输出里的文本块。
 *
 * @param {unknown} output
 * @returns {string}
 */
export function textOfContent(output) {
  if (!Array.isArray(output)) return ''
  return output
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * 一件完整的 user 消息：`followup` 要求 `role` 与 `id`，否则会话历史在请求
 * 模型时无法转换成消息。
 *
 * @param {string} text
 * @param {string} [sourceKind]
 * @returns {Record<string, unknown>}
 */
function followupMessage(text, sourceKind = 'buka-robot') {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: sourceKind },
  }
}

/**
 * 机器人没有交回结构化结果时，注入原会话的重试提示。
 *
 * @param {number} attempt 第几次重试（从 1 开始）
 * @param {number} maxAttempts 最多重试几次
 * @param {string} [toolName] 该后端提交结构化结果用的工具名
 * @returns {string}
 */
export function reportRetryPrompt(attempt, maxAttempts, toolName = STRUCTURED_OUTPUT_TOOL) {
  return (
    'The workflow orchestrator expected a structured JSON result from this task, ' +
    `but your last answer did not provide one. Do not reply with plain text again: ` +
    `finish now by calling the ${toolName} tool with a single JSON object that answers the assigned task. ` +
    `This is retry ${attempt}/${maxAttempts}.`
  )
}

/**
 * 重试用尽后的错误文案。
 *
 * @param {number} retries 实际重试次数
 * @returns {string}
 */
export function reportFailureMessage(retries) {
  const suffix =
    retries > 0
      ? ` after ${retries} retr${retries === 1 ? 'y' : 'ies'} in the same session`
      : ''
  return `the robot session did not submit a structured JSON result${suffix}`
}

/**
 * 从会话的最后一条回复里解析 JSON 对象；支持 ```json 代码块。
 *
 * @param {unknown} text
 * @returns {Record<string, unknown> | undefined}
 */
export function parseStructuredText(text) {
  if (typeof text !== 'string') return undefined
  let body = text.trim()
  if (body === '') return undefined
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(body)
  if (fenced !== null) body = fenced[1].trim()
  if (!body.startsWith('{')) return undefined
  try {
    const value = JSON.parse(body)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value
  } catch {
    // 不是合法 JSON：交给重试消息处理。
  }
  return undefined
}

/**
 * 会话里是否已经成功提交过结构化结果（根据 `structured_output` 的调用与结果事件）。
 *
 * @param {any} session
 * @param {number} [startSeq] 只观察这个序号之后的事件
 * @returns {boolean}
 */
export function structuredSubmittedSince(session, startSeq = 0) {
  const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
  /** @type {Set<string>} */
  const callIds = new Set()
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < startSeq) continue
    if (event?.type !== 'tool/call') continue
    if (event?.data?.name !== STRUCTURED_OUTPUT_TOOL) continue
    if (typeof event.data.callId === 'string') callIds.add(event.data.callId)
  }
  if (callIds.size === 0) return false
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < startSeq) continue
    if (event?.type !== 'tool/result') continue
    const data = event.data
    const message = data?.message
    const callId =
      typeof message?.toolCallId === 'string'
        ? message.toolCallId
        : typeof data?.toolCallId === 'string'
          ? data.toolCallId
          : typeof message?.source?.callId === 'string'
            ? message.source.callId
            : ''
    if (callId === '' || !callIds.has(callId)) continue
    if (message?.isError === true) continue
    return true
  }
  return false
}

/**
 * 读会话的最后一条回复文本；失败时返回空串。
 *
 * @param {any} agent
 * @returns {string}
 */
function safeOutcomeText(agent) {
  try {
    const outcome = readSessionOutcome(agent?.session)
    return typeof outcome.text === 'string' ? outcome.text : ''
  } catch {
    return ''
  }
}

/**
 * 等待 subagent 结果；超时 / 取消时抛 `RobotSessionStop`。
 *
 * @param {Promise<unknown>} promise
 * @param {{ timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<unknown>}
 */
function waitForSubagent(promise, options) {
  return new Promise((resolve, reject) => {
    /** @type {boolean} */
    let settled = false
    /** @type {NodeJS.Timeout | undefined} */
    let timer
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener?.('abort', onAbort)
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve(value)
      else reject(error)
    }
    const onAbort = () => finish(new RobotSessionStop('aborted', 'robot session was cancelled'))
    options.signal?.addEventListener?.('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) {
      onAbort()
      return
    }
    if (Number.isInteger(options.timeoutMs) && options.timeoutMs > 0) {
      timer = setTimeout(
        () => finish(new RobotSessionStop('timeout', `robot session timed out after ${options.timeoutMs}ms`)),
        options.timeoutMs,
      )
    }
    Promise.resolve(promise).then(
      (value) => finish(undefined, value),
      (error) => finish(error instanceof Error ? error : new Error(describeError(error))),
    )
  })
}

/**
 * 中断后给结果一点落定时间；超时返回 undefined。
 *
 * @param {Promise<unknown>} promise
 * @returns {Promise<unknown | undefined>}
 */
async function settleAfterStop(promise) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = setTimeout(resolve, SETTLE_AFTER_CANCEL_MS)
      }),
    ])
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 等待 agent 空闲；超时 / 取消时抛 `RobotSessionStop`。
 *
 * @param {any} agent
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<void>}
 */
function waitForIdle(agent, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    /** @type {boolean} */
    let settled = false
    /** @type {NodeJS.Timeout | undefined} */
    let timer
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    const finish = (error) => {
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
        () => finish(new RobotSessionStop('timeout', `robot session timed out after ${timeoutMs}ms`)),
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
 * 会话当前的事件序号；续接时用它排除旧轮次。
 *
 * @param {any} agent
 * @returns {number}
 */
function seqOf(agent) {
  const seq = agent?.session?.seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : 0
}

/**
 * 等这一轮真正结束（`turn/end`），而不是仅仅等 agent 空闲。
 *
 * 续接会话时 agent 在 followup 之前就是 idle 的，单等 `whenIdle()` 可能在
 * 新一轮还没开起来时立刻返回，读到上一轮的旧文本。先挂事件监听、再投递消息，
 * 就能拿到这一轮的结束事件；没有事件源（测试替身 / 老运行时）时退回 `whenIdle()`。
 *
 * @param {any} agent
 * @param {number} startSeq
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<void>}
 */
function waitForTurnEnd(agent, startSeq, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    /** @type {boolean} */
    let settled = false
    /** @type {NodeJS.Timeout | undefined} */
    let timer
    /** @type {(() => void) | undefined} */
    let off
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      try {
        off?.()
      } catch {
        // 会话已经释放：忽略。
      }
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = () => finish(new RobotSessionStop('aborted', 'robot session was cancelled'))
    const hasTurnEnd = () => {
      try {
        const events = typeof agent?.session?.ownEvents === 'function' ? agent.session.ownEvents() : []
        for (const event of events) {
          if (event?.type === 'turn/end' && typeof event.seq === 'number' && event.seq >= startSeq) return true
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
        () => finish(new RobotSessionStop('timeout', `robot session timed out after ${timeoutMs}ms`)),
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
          if (session !== undefined && agent?.session !== undefined && session !== agent.session) return
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
        (error) => finish(error instanceof RobotSessionStop ? error : new RobotSessionStop('aborted', describeError(error))),
      )
    }
  })
}

/**
 * 取消后给 agent 一点时间落定 turn/end，避免读不到最后的文本。
 *
 * @param {any} agent
 * @returns {Promise<void>}
 */
async function waitForSettle(agent) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer
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
 * @param {any} handle
 * @returns {Promise<void>}
 */
async function disposeHandle(handle) {
  try {
    await handle.dispose()
  } catch {
    // 已释放或释放失败都不应该让调用方拿不到结果。
  }
}

/**
 * 合并模型路由。
 *
 * @param {{ provider?: string, model?: string, reasoningEffort?: string }} defaults
 * @param {{ provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number } | undefined} overrides
 * @returns {{ provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number }}
 */
function mergeAgentOptions(defaults, overrides) {
  const merged = { ...defaults }
  if (overrides === undefined || overrides === null) return merged
  for (const key of ['provider', 'model', 'reasoningEffort', 'maxTokens']) {
    const value = overrides[key]
    if (value === undefined || value === null) continue
    merged[key] = value
  }
  return merged
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positive(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
