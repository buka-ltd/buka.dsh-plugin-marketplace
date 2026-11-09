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

import {
  isValidRobotName,
  listRobots,
  readRobotRegistry,
} from './robot-store.js'
import { resolveAvatar } from './avatar.js'
import {
  GENERAL_ROBOT_AVATAR_ID,
  GENERAL_ROBOT_NAME,
  isGeneralRobotName,
} from './general-robot.js'
import { readSettings, resolveSettingsFile } from './settings.js'

/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaRobots`。 */
export const SERVICE_NAME = 'bukaRobots'

/** 默认重试次数：机器人没有交回结构化 JSON 结果时，在原会话里再要求几次。 */
export const DEFAULT_RESULT_RETRIES = 2

/** 提交结构化结果时使用的工具名（由本服务注册 scoped 工具）。 */
export const STRUCTURED_OUTPUT_TOOL = 'structured_output'

/** 没有给 `outputSchema` 时的宽松对象 schema：仍要求交回一个 JSON 对象。 */
const DEFAULT_OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

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

/** 取消后等待 agent 落定（写入 turn/end）的最长时间。 */
const SETTLE_AFTER_CANCEL_MS = 2000

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
   *   settingsFile?: string,
   *   defineTool?: Function,
   *   resultRetries?: number,
   * }} options
   */
  constructor(options) {
    this.ctx = options.ctx
    this.robotsDir = options.robotsDir
    this.registryFile = options.registryFile
    this.settingsFile =
      typeof options.settingsFile === 'string' && options.settingsFile.trim() !== ''
        ? options.settingsFile
        : resolveSettingsFile(options.robotsDir)
    this.defineTool = options.defineTool
    this.resultRetries =
      Number.isInteger(options.resultRetries) && options.resultRetries >= 0
        ? options.resultRetries
        : DEFAULT_RESULT_RETRIES
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
   * 旧登记表里缺头像的机器人按名字兜底成一个确定的预设。通用型机器人启用时
   * 额外返回 `通用型机器人: 'robot'`（工作流节点图画固定 🤖）；登记表损坏时
   * 只返回这一项（或空表）。
   *
   * @returns {Promise<Record<string, string>>}
   */
  async avatarMap() {
    const registry = await readRobotRegistry({ file: this.registryFile })
    const settings = await readSettings({ file: this.settingsFile })
    /** @type {Record<string, string>} */
    const map = {}
    if (!registry.corrupt) {
      for (const robot of registry.robots) map[robot.name] = resolveAvatar(robot.avatar, robot.name)
    }
    // 通用型机器人启用时也暴露给工作流节点图；同名登记机器人优先，避免撞名字。
    if (settings.generalRobot.enabled && !Object.hasOwn(map, GENERAL_ROBOT_NAME)) {
      map[GENERAL_ROBOT_NAME] = GENERAL_ROBOT_AVATAR_ID
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
   * @param {{
   *   robot: string,
   *   prompt: string,
   *   agent?: { id: string, ctx?: import('@deepseek-ai/cordis').Context },
     *   agentPreset?: string,
   *   outputSchema?: object,
   *   routes?: string[],
   *   title?: string,
   *   agentOptions?: { provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number },
   *   approval?: 'ask' | 'never', // 省略 / 'ask' 沿用部署策略；'never' 强制拒绝需要审批的操作。
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   *   sessionId?: string,
   *   newSessionId?: string,
   *   wait?: boolean,
   * }} request
   * @returns {Promise<{
   *   id: string,
   *   robot: string,
   *   cwd: string,
   *   resumed: boolean,
   *   result: Promise<Record<string, any>>,
   *   cancel: (reason?: string) => void,
   *   dispose: () => Promise<void>,
   * }>}
   */
  async startSession(request = {}) {
    // 观察者模式：把 prompt 投进去就返回句柄，结果由调用方订阅会话事件后自己读。
    // 默认仍是 wait:true，保持既有调用方的语义不变。
    if (request.wait === false) return await this.dispatchSession(request)
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
   * @param {{
   *   robot: string,
   *   prompt: string,
   *   agent?: { id: string, ctx?: import('@deepseek-ai/cordis').Context },
   *   agentPreset?: string,
   *   outputSchema?: object,
   *   routes?: string[],
   *   title?: string,
   *   agentOptions?: { provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number },
   *   approval?: 'ask' | 'never', // 省略 / 'ask' 沿用部署策略；'never' 强制拒绝需要审批的操作。
   *   signal?: AbortSignal,
   *   sessionId?: string,
   *   newSessionId?: string,
   * }} request
   * @returns {Promise<Record<string, any>>}
   */
  async dispatchSession(request = {}) {
    if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
      throw new Error('dispatchSession requires a non-empty prompt')
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
      return await this.#continueDispatch({ request, robot, agentOptions, signal, sessionId })
    }
    return await this.#startDispatch({ request, robot, agentOptions, signal })
  }

  /**
   * 只打开（resume / attach）一个已有机器人会话，不发 prompt。观察者恢复时先用
   * 它检查上一轮是否其实已经结束；确认要继续时再调句柄的 `send`。
   *
   * @param {{
   *   robot: string,
   *   sessionId: string,
   *   agent?: { id: string, ctx?: import('@deepseek-ai/cordis').Context },
   *   agentPreset?: string,
   *   outputSchema?: object,
   *   routes?: string[],
   *   title?: string,
   *   agentOptions?: { provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number },
   *   approval?: 'ask' | 'never', // 省略 / 'ask' 沿用部署策略；'never' 强制拒绝需要审批的操作。
   *   signal?: AbortSignal,
   * }} request
   * @returns {Promise<Record<string, any>>}
   */
  async openSession(request = {}) {
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : ''
    if (sessionId === '') throw new Error('openSession requires a sessionId')
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
      throw this.#creationError(robot, error, signal)
    }
  }

  /**
   * 把创建失败包装成给用户看的错误：说明没有隐藏兜底、也没有替代会话。
   *
   * @param {{ name: string }} robot
   * @param {unknown} error
   * @param {AbortSignal} [signal]
   * @returns {Error}
   */
  #creationError(robot, error, signal) {
    if (signal?.aborted === true) return error instanceof Error ? error : new Error(describeError(error))
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
    /** @type {{ sessionId: string, agent: any, state: { reported: { value: unknown } }, handle: any }} */
    let prepared
    try {
      prepared = await this.#resumeAgent({ request, robot, agentOptions, signal, sessionId })
    } catch (error) {
      if (signal?.aborted === true) throw new RobotSessionStop('aborted', 'robot session was cancelled')
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
   * 给新会话 / 续接会话装上机器人自己的工作 preset，并补一个 scoped 的
   * `structured_output` 工具：每个机器人节点都必须交回一个 JSON 对象。
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
    this.#installStructuredTool(childCtx, state, request.outputSchema)
  }

  /**
   * 在会话上安装结构化结果工具。`outputSchema` 直接作为工具的 `parameters`
   * （例如工作流节点要求 `next` 取某个枚举值）；没给时退回宽松对象 schema，
   * 但仍然要求交回一个 JSON 对象。
   *
   * @param {any} childCtx
   * @param {{ reported: { value: unknown } }} state
   * @param {unknown} [schema]
   * @returns {void}
   */
  #installStructuredTool(childCtx, state, schema) {
    const tools = childCtx?.get?.('tools') ?? childCtx?.tools
    if (typeof tools?.register !== 'function') return
    tools.register({
      name: STRUCTURED_OUTPUT_TOOL,
      description:
        "Report the final structured JSON result of this node. Call this exactly once, when your answer is complete; the arguments must match this tool's parameter schema exactly.",
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
   * 在续接会话上执行一轮：compact → followup → 等空闲 → 读结果（没交回 JSON
   * 时在同会话内补问，重试有上限）。
   *
   * @param {{
   *   agent: any,
   *   robot: { name: string, path: string },
   *   request: Record<string, any>,
   *   state: { reported: { value: unknown } },
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   *   compactFirst: boolean,
   *   dispose: () => Promise<void>,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #runSessionTurn({ agent, robot, request, state, timeoutMs, signal, compactFirst, dispose }) {
    // 默认不超时：只有调用方显式给了正的 timeoutMs 才计时。
    const deadline = Number.isInteger(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : null
    const remaining = () => (deadline === null ? 0 : Math.max(1, deadline - Date.now()))
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
        const preparation = await this.#compactSession(agent, signal)
        compacted = preparation.compacted
        compactionError = preparation.compactionError
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
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #startVisibleSession({ request, robot, agentOptions, signal }) {
    const prepared = await this.#createVisibleAgent({ request, robot, agentOptions, signal })
    const { agent, state, handle, sessionId } = prepared
    const timeoutMs = positive(request.timeoutMs) ?? 0
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
   * 新建一个普通顶层机器人会话并完成标题、审批策略、工作区挂载；不发送 prompt。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   * }} input
   * @returns {Promise<{ sessionId: string, agent: any, state: { reported: { value: unknown } }, handle: any }>}
   */
  async #createVisibleAgent({ request, robot, agentOptions, signal }) {
    const agents = this.ctx?.get?.('agents') ?? this.ctx?.agents
    if (typeof agents?.create !== 'function') {
      throw new Error('the agent service is unavailable, so a robot session cannot be created')
    }

    const state = { reported: { value: undefined } }
    // 观察者可以先把 sessionId 落盘再 dispatch：这样即使宿主在 create 期间退出，
    // 恢复时也知道该 resume 哪个会话。调用方没给时仍随机生成。
    const requestedSessionId = typeof request.newSessionId === 'string' ? request.newSessionId.trim() : ''
    const sessionId = requestedSessionId !== '' ? requestedSessionId : randomUUID()
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
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   *   sessionId: string,
   * }} input
   * @returns {Promise<{ sessionId: string, agent: any, state: { reported: { value: unknown } }, handle: any }>}
   */
  async #resumeAgent({ request, robot, agentOptions, signal, sessionId }) {
    const agents = this.ctx?.get?.('agents') ?? this.ctx?.agents
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
   * @param {any} agent
   * @param {any} handle
   * @returns {Promise<void>}
   */
  async #assertVisibleAgent(agent, handle) {
    if (agent?.session?.header?.origin !== 'subagent') return
    await disposeHandle(handle)
    throw new Error(
      'refusing to use a hidden subagent robot session; robot sessions must be visible top-level sessions',
    )
  }

  /**
   * 新会话的非阻塞 dispatch：建会话、投 prompt、返回句柄；不等待这一轮结束。
   *
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #startDispatch({ request, robot, agentOptions, signal }) {
    let prepared
    try {
      prepared = await this.#createVisibleAgent({ request, robot, agentOptions, signal })
    } catch (error) {
      throw this.#creationError(robot, error, signal)
    }
    const startSeq = seqOf(prepared.agent)
    prepared.agent.followup(followupMessage(request.prompt))
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
   * @param {{
   *   request: Record<string, any>,
   *   robot: { name: string, path: string },
   *   agentOptions: Record<string, unknown>,
   *   signal?: AbortSignal,
   *   sessionId: string,
   * }} input
   * @returns {Promise<Record<string, any>>}
   */
  async #continueDispatch({ request, robot, agentOptions, signal, sessionId }) {
    /** @type {{ sessionId: string, agent: any, state: { reported: { value: unknown } }, handle: any }} */
    let prepared
    try {
      prepared = await this.#resumeAgent({ request, robot, agentOptions, signal, sessionId })
    } catch (error) {
      if (signal?.aborted === true) throw new RobotSessionStop('aborted', 'robot session was cancelled')
      throw new Error(
        `could not resume robot session "${sessionId}" for robot "${robot.name}": ${describeError(error)}; refusing to start a new robot session`,
        { cause: error },
      )
    }

    const compaction = await this.#compactSession(prepared.agent, signal)
    const startSeq = seqOf(prepared.agent)
    prepared.agent.followup(followupMessage(request.prompt))
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
   * @param {{
   *   agent: any,
   *   state: { reported: { value: unknown } },
   *   handle: any,
   *   sessionId: string,
   *   robot: { name: string, path: string },
   *   request: Record<string, any>,
   *   resumed: boolean,
   *   compacted: boolean,
   *   compactionError: string | undefined,
   *   startSeq: number,
   * }} input
   * @returns {Record<string, any>}
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
  }) {
    const service = this
    let disposed = false
    let retries = 0
    const dispose = async () => {
      if (disposed) return
      disposed = true
      await disposeHandle(handle)
    }
    /** @type {Record<string, any>} */
    const observer = {
      mode: 'session',
      sessionId: typeof agent?.id === 'string' && agent.id !== '' ? agent.id : sessionId,
      robot: robot.name,
      cwd: robot.path,
      resumed,
      compacted,
      ...(compactionError === undefined ? {} : { compactionError }),
      startSeq,
      /**
       * 从日志读这一轮的结果；`sinceSeq` 之前的轮次不算。
       *
       * @param {{ sinceSeq?: number }} [options]
       * @returns {Record<string, any>}
       */
      readResult({ sinceSeq = observer.startSeq } = {}) {
        const turn = readSessionTurn(agent?.session, sinceSeq)
        const structured =
          state?.reported?.value !== undefined ? state.reported.value : parseStructuredText(turn.text)
        return {
          sessionId: observer.sessionId,
          text: turn.text,
          stopReason: turn.stopReason,
          turnEnded: turn.turnEnded,
          ...(turn.turnEndSeq === null ? {} : { turnEndSeq: turn.turnEndSeq }),
          ...(structured === undefined ? {} : { structured }),
          reportSubmitted:
            state?.reported?.value !== undefined || structuredSubmittedSince(agent?.session, sinceSeq),
        }
      },
      /**
       * 在同一会话里再发一条消息（结构化结果重试 / 恢复续跑用）。返回新的起点 seq。
       *
       * @param {string} text
       * @param {{ compactFirst?: boolean }} [options]
       * @returns {Promise<number>}
       */
      async send(text, { compactFirst = true } = {}) {
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('send requires a non-empty prompt')
        }
        if (compactFirst) {
          const compaction = await service.#compactSession(agent, request.signal)
          observer.compacted = compaction.compacted || observer.compacted
          if (compaction.compactionError !== undefined) observer.compactionError = compaction.compactionError
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
       * 没有额度时返回 `null`。工作流 supervisor 在缺 JSON、缺 `next` 或
       * `next` 不是合法路由时调用它。
       *
       * @param {{ routes?: string[], reason?: 'missing-json' | 'missing-next' | 'invalid-next' | string }} [options]
       * @returns {string | null}
       */
      retryReport(options = {}) {
        const max = service.resultRetries
        if (!Number.isInteger(max) || max <= 0 || retries >= max) return null
        retries += 1
        return resultRetryPrompt(retries, max, {
          toolName: STRUCTURED_OUTPUT_TOOL,
          routes: options?.routes ?? request.routes,
          reason: typeof options?.reason === 'string' ? options.reason : undefined,
        })
      },
      /**
       * 取消当前轮；等它落定后把已经写下的文本读回来。
       *
       * @param {string} [reason]
       * @returns {Promise<Record<string, any>>}
       */
      async cancel(reason) {
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
   * @param {any} agent
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ compacted: boolean, compactionError?: string }>}
   */
  async #compactSession(agent, signal) {
    const compaction = this.ctx?.get?.('compaction')
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
      if (signal?.aborted === true) throw new RobotSessionStop('aborted', 'robot session was cancelled')
      const message = describeError(error)
      this.ctx?.logger?.warn?.(
        `buka-robots: compacting robot session failed; continuing without it: ${message}`,
      )
      return { compacted: false, compactionError: message }
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
   * 通用型机器人不在登记表里：启用时它的会话落在调用方所在的工作区（标准模式），
   * 停用时直接拒绝。同名登记机器人优先，避免用户自建的机器人被内置项顶掉。
   *
   * @param {unknown} name
   * @param {Record<string, any>} [request] 调用方的请求；用来取 `agent.session.header.cwd`
   * @returns {Promise<{ name: string, path: string, general?: true }>}
   */
  async #resolveRobot(name, request = {}) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!isValidRobotName(trimmed)) {
      throw new Error(`invalid robot name: ${String(name)}`)
    }
    const registry = await readRobotRegistry({ file: this.registryFile })
    if (!registry.corrupt) {
      const robot = registry.robots.find((entry) => entry.name === trimmed)
      if (robot !== undefined) {
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
    }

    if (isGeneralRobotName(trimmed)) return await this.#resolveGeneralRobot(request)
    if (registry.corrupt) {
      throw new Error(`robot registry is unreadable: ${this.registryFile}`)
    }
    throw new Error(`unknown robot: ${trimmed}`)
  }

  /**
   * 解析通用型机器人：确认启用，并选一个「调用方所在工作区」当 cwd。
   *
   * 它没有自己的目录，所以在工作流里跑在编排器会话的 cwd（也就是工作流所在的
   * 工作区）；没有调用方会话时退回宿主的默认工作目录。
   *
   * @param {Record<string, any>} request
   * @returns {Promise<{ name: string, path: string }>}
   */
  async #resolveGeneralRobot(request) {
    const settings = await readSettings({ file: this.settingsFile })
    if (!settings.generalRobot.enabled) {
      throw new Error('the general-purpose robot is disabled; enable it on the Robots page first')
    }

    const sessionCwd = request?.agent?.session?.header?.cwd
    const working = this.ctx?.get?.('workingDirectory')
    const fallback = working?.defaultDirectory
    const cwd =
      typeof sessionCwd === 'string' && sessionCwd.trim() !== ''
        ? sessionCwd
        : typeof fallback === 'string' && fallback.trim() !== ''
          ? fallback
          : ''
    if (cwd === '') {
      throw new Error('the general-purpose robot needs a workspace directory, but none is available')
    }
    return { name: GENERAL_ROBOT_NAME, path: cwd }
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
    description: typeof robot?.description === 'string' ? robot.description : '',
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
 * 从会话日志里取一次轮次（`sinceSeq` 之后）的 assistant 文本、结束原因，以及
 * 这一轮是否真的写下了 `turn/end`。观察者恢复时靠 `turnEnded` 判断上一轮是
 * 已经完成、还是被中断后需要续跑。
 *
 * @param {any} session
 * @param {number} [sinceSeq] 只读取这个序号及之后的事件（续接会话时排除旧轮次）
 * @returns {{ text: string, stopReason: string, turnEnded: boolean, turnEndSeq: number | null }}
 */
export function readSessionTurn(session, sinceSeq = 0) {
  const events =
    typeof session?.snapshotEvents === 'function'
      ? session.snapshotEvents(sinceSeq)
      : typeof session?.ownEvents === 'function'
        ? session.ownEvents()
        : []
  let text = ''
  let reason
  let turnEnded = false
  /** @type {number | null} */
  let turnEndSeq = null
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < sinceSeq) continue
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
      turnEnded = true
      turnEndSeq = typeof event?.seq === 'number' ? event.seq : null
    }
  }
  return { text, stopReason: mapTurnEnd(reason), turnEnded, turnEndSeq }
}

/**
 * 从会话日志里取最后一次 assistant 文本与 turn 结束原因。
 *
 * @param {any} session
 * @param {number} [startSeq] 只读取这个序号及之后的事件（续接会话时排除旧轮次）
 * @returns {{ text: string, stopReason: string }}
 */
export function readSessionOutcome(session, startSeq = 0) {
  const turn = readSessionTurn(session, startSeq)
  return { text: turn.text, stopReason: turn.stopReason }
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
 * 机器人没有交回结构化 JSON 结果时，注入原会话的重试提示：说清这次的问题
 * （缺 JSON / 缺 `next` / `next` 不是合法路由），并列出合法路由名。
 *
 * @param {number} attempt 第几次重试（从 1 开始）
 * @param {number} maxAttempts 最多重试几次
 * @param {{
 *   toolName?: string,
 *   routes?: string[],
 *   reason?: 'missing-json' | 'missing-next' | 'invalid-next' | string,
 * }} [options] `toolName` 是该后端提交结构化结果用的工具名；`routes` 是节点
 *   允许的出口路由名；`reason` 说明这次为什么要求重答（默认缺 JSON）。
 * @returns {string}
 */
export function resultRetryPrompt(attempt, maxAttempts, options = {}) {
  const toolName = typeof options.toolName === 'string' ? options.toolName : STRUCTURED_OUTPUT_TOOL
  const routes = routeNames(options.routes)
  const reason = typeof options.reason === 'string' ? options.reason : 'missing-json'
  const problem =
    reason === 'missing-next'
      ? 'your last JSON result did not include the required `next` route'
      : reason === 'invalid-next'
        ? 'the `next` route in your last JSON result is not one of the routes this node can follow'
        : 'your last answer did not provide a structured JSON result'
  let text =
    `The workflow orchestrator expected the final result of this node as a single JSON object, but ${problem}. ` +
    `Do not reply with plain text again: finish now by calling the ${toolName} tool with a single JSON object that answers the assigned task.`
  if (routes.length > 0) {
    text +=
      ' When this node has outgoing routes, the object MUST include `next` set to exactly one of these route names: ' +
      routes.map((route) => `"${route}"`).join(', ') +
      '.'
  }
  text += ` This is retry ${attempt}/${maxAttempts}.`
  return text
}

/**
 * 重试用尽后的错误文案。
 *
 * @param {number} retries 实际重试次数
 * @returns {string}
 */
export function resultFailureMessage(retries) {
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
 * 调用方给的 `outputSchema` 直接作为 `structured_output` 的 parameters；没给
 * （或不是对象）时退回宽松对象 schema，仍然要求交回一个 JSON 对象。
 *
 * @param {unknown} schema
 * @returns {Record<string, unknown>}
 */
function normalizeOutputSchema(schema) {
  if (schema !== null && typeof schema === 'object' && !Array.isArray(schema)) {
    return /** @type {Record<string, unknown>} */ (schema)
  }
  return DEFAULT_OUTPUT_SCHEMA
}

/**
 * 规范化路由名列表：只保留非空字符串并去重。
 *
 * @param {unknown} routes
 * @returns {string[]}
 */
function routeNames(routes) {
  if (!Array.isArray(routes)) return []
  const names = []
  const seen = new Set()
  for (const route of routes) {
    if (typeof route !== 'string') continue
    const name = route.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
