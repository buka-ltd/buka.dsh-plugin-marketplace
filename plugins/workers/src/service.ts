/**
 * `@buka/dsh-plugin-workers` 对外提供的 Host Service：`ctx.bukaWorkers`。
 *
 * 能力（工作流插件与将来的编排器使用）：
 *
 * - `list()`：打工人登记表 + 目录状态 + 挂载状态 + 已装 skills，摘要里带
 *   `driver`（agent / robot）/ `assistant` / `program`；
 * - `avatarMap()`：打工人名 → 预设头像 id（只读登记表，工作流节点图用它）；
 * - `dispatchSession(request)`：在打工人目录下**新开**一条会话并投递一段提示词，
 *   立即返回观测句柄；不在服务里等待这一轮结束，也不设默认超时；
 * - `openSession(request)`：只续接（resume / attach）一条已有会话，不发 prompt；
 *   观察者恢复时先用它检查上一轮是否其实已经结束，确认要继续时再调句柄的
 *   `send`。
 *
 * 一个任务一条新会话：`dispatchSession` 不复用上一条任务的会话；`openSession`
 * 只续接同一条会话，**不压缩**。压缩、结构化结果校验与结果追问都在工作流侧
 * （`buka_task_complete`），本服务不再注册 `structured_output` 工具。
 *
 * 机器人（clock）没有会话：`dispatchSession` / `openSession` 会拒绝
 * 它们，执行由工作流按 `driver` + `program` 驱动。
 *
 * 唯一的会话后端是普通顶层会话：`cwd` 是打工人目录，打工人自己的 AGENTS.md /
 * 项目 skills 照常生效，会话挂到打工人工作区并出现在 DSH 侧边栏。创建或续接
 * 失败时直接抛错，不退回 subagent 子会话，也不另开新会话。
 *
 * 通过 `ctx.provide('bukaWorkers', new WorkerSessionService(...))` 注册，消费方
 * 用 `inject: ['bukaWorkers']` 或 `ctx.get('bukaWorkers')` 获取。
 *
 * @module @buka/dsh-plugin-workers/service
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'

import type { Context } from '@deepseek-ai/cordis'
import { resolveAvatar } from './avatar.ts'
import { WorkerSessionStop } from './engine/errors.ts'
import { readPlanModeActive, readSessionTurn, seqOf } from './engine/session-events.ts'
import {
  describeError,
  disposeHandle,
  followupMessage,
  mergeAgentOptions,
  optionalService,
  waitForSettle,
} from './engine/session-runtime.ts'
import { summarizeWorker } from './engine/summary.ts'
import type {
  AgentDefaultModelLike,
  AgentHandleLike,
  AgentOptions,
  AgentPresetsServiceLike,
  AgentsServiceLike,
  ChildContextLike,
  CommandsServiceLike,
  LiveAgent,
  SessionControllerLike,
  SessionTitleServiceLike,
  WorkerDispatchRequest,
  WorkerOpenRequest,
  WorkerSessionObserver,
  WorkerTarget,
} from './service/types.ts'
import {
  isValidWorkerName,
  listWorkers,
  readWorkerRegistry,
  withBuiltinWorkers,
} from './worker-store.ts'

/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaWorkers`。 */
export const SERVICE_NAME = 'bukaWorkers'

/** plan 模式入口不可用时给用户看的错误文案。 */
const PLAN_MODE_UNAVAILABLE =
  'plan mode is unavailable in this composition; install or update @deepseek-ai/dsh-plan-mode to use a worker node with mode "plan"'

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

export class WorkerSessionService {
  /** Host 上下文：取 agents / approval 等可选服务。 */
  readonly ctx: Context
  /** 打工人根目录。 */
  readonly workersDir: string
  /** 登记文件绝对路径。 */
  readonly registryFile: string
  /** 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。 */
  readonly supportsPlanMode: boolean

  /**
   */
  constructor(options: {
    ctx: Context
    workersDir: string
    registryFile: string
  }) {
    this.ctx = options.ctx
    this.workersDir = options.workersDir
    this.registryFile = options.registryFile
    /**
     * 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。工作流的
     * plan 节点在启动前用它判断是否需要提示用户升级 workers 插件；旧版本没有
     * 这个字段，planMode 请求会被静默忽略。
     */
    this.supportsPlanMode = true
  }

  /**
   * 列出打工人。
   *
   */
  async list(): Promise<{
    root: string
    registry: string
    corrupt: boolean
    workers: Array<Record<string, unknown>>
  }> {
    const snapshot = await listWorkers({
      file: this.registryFile,
      workspaceRegistry: this.ctx?.workspaceRegistry,
      workersDir: this.workersDir,
    })
    return {
      root: snapshot.root,
      registry: snapshot.registry,
      corrupt: snapshot.corrupt,
      workers: snapshot.workers.map((worker) => summarizeWorker(worker)),
    }
  }

  /**
   * 打工人名 → 头像 id。给工作流这类只关心「谁在执行」的消费方用：只读登记表，
   * 不扫描每个打工人目录里的 skills / AGENTS.md，所以可以频繁调用。
   *
   * 内建机器人（clock）也在这里，工作流把它画在节点上。旧登记表里
   * 缺头像的打工人按名字兜底成一个确定的预设。登记表损坏时返回空表。
   *
   */
  async avatarMap(): Promise<Record<string, string>> {
    const registry = await readWorkerRegistry({ file: this.registryFile })
    const map: Record<string, string> = {}
    if (!registry.corrupt) {
      for (const worker of withBuiltinWorkers(registry.workers))
        map[worker.name] = resolveAvatar(worker.avatar, worker.name)
    }
    return map
  }

  /**
   * 非阻塞地把一段 prompt 投进一条**新的**打工人会话，返回一个可观测句柄；
   * 不在服务里等待这一轮结束，也不设默认超时。工作流观察者负责订阅
   * `session/event` 并在 `turn/end` 后读结果、决定路由；会话异常终止时由观察者
   * 重新 open/dispatch。硬超时由调用方（观察者）自己计时后调用句柄的 `cancel()`。
   *
   * 一个任务一条新会话：这里不接受 `sessionId`，恢复只能走 `openSession`。
   *
   */
  async dispatchSession(request: WorkerDispatchRequest = {}): Promise<WorkerSessionObserver> {
    if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
      throw new Error('dispatchSession requires a non-empty prompt')
    }
    // 一个任务一条新会话：dispatch 不再接受 sessionId；恢复只能走 openSession。
    // 旧调用方带着 sessionId 调进来时直接失败，而不是悄悄开一条新会话。
    if ('sessionId' in request && (request as { sessionId?: unknown }).sessionId !== undefined) {
      throw new Error(
        'dispatchSession always starts a new worker session; use openSession() to resume an existing session',
      )
    }
    this.#assertPlanModeRequest(request)
    const worker = await this.#resolveWorker(request.worker)
    const agentOptions = mergeAgentOptions(this.#workerAgentOptions(worker), request.agentOptions)
    if (typeof agentOptions.provider !== 'string' || typeof agentOptions.model !== 'string') {
      throw new Error(
        'no model route is available for the worker session: pass agentOptions.provider/model or configure a default model',
      )
    }
    const signal = request.signal
    signal?.throwIfAborted?.()
    return await this.#startDispatch({ request, worker, agentOptions, signal })
  }

  /**
   * 只打开（resume / attach）一条已有打工人会话，不发 prompt、不压缩。观察者
   * 恢复时先用它检查上一轮是否其实已经结束；确认要继续时再调句柄的 `send`。
   *
   */
  async openSession(request: WorkerOpenRequest = {}): Promise<WorkerSessionObserver> {
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : ''
    if (sessionId === '') throw new Error('openSession requires a sessionId')
    this.#assertPlanModeRequest(request)
    const worker = await this.#resolveWorker(request.worker)
    const agentOptions = mergeAgentOptions(this.#workerAgentOptions(worker), request.agentOptions)
    if (typeof agentOptions.provider !== 'string' || typeof agentOptions.model !== 'string') {
      throw new Error(
        'no model route is available for the worker session: pass agentOptions.provider/model or configure a default model',
      )
    }
    const signal = request.signal
    signal?.throwIfAborted?.()
    const prepared = await this.#resumeAgent({ request, worker, agentOptions, signal, sessionId })
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
      handle: prepared.handle,
      sessionId: prepared.sessionId,
      worker,
      resumed: true,
      startSeq: seqOf(prepared.agent),
    })
  }

  /**
   * 把创建失败包装成给用户看的错误：说明没有隐藏兜底、也没有替代会话。
   *
   */
  #creationError(worker: WorkerTarget, error: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted === true)
      return error instanceof Error ? error : new Error(describeError(error))
    return new Error(
      `could not create a visible worker session for worker "${worker.name}": ${describeError(error)}; refusing to fall back to a hidden subagent or a replacement session`,
      { cause: error },
    )
  }

  /**
   * 用调用方给的 `title` 给打工人会话命名。
   *
   * 打工人会话的第一条用户消息来源是 `buka-worker`，而 DSH 的自动标题只看
   * `source.kind === 'user'` 的消息，所以这类会话不会自己长出标题：侧边栏与
   * 会话列表里一直显示「未命名」。工作流进入节点时会把「运行目标 · 打工人」
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
        `buka-workers: could not title worker session "${String(session?.id ?? '')}": ${describeError(error)}`,
      )
    }
  }

  /**
   * 给新会话 / 续接会话装上打工人自己的工作 preset。
   *
   * 普通顶层会话和 `agents.resume()` 都不会自动套 composition，所以由服务显式
   * 挂载；结果契约（结构化输出）已移到工作流侧，这里不再注册任何工具。
   *
   */
  async #composeSession(
    childCtx: ChildContextLike,
    agent: LiveAgent,
    request: WorkerDispatchRequest | WorkerOpenRequest,
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
  }

  /**
   * 新建一个普通顶层打工人会话并完成标题、审批策略、工作区挂载；不发送 prompt。
   *
   */
  async #createVisibleAgent({
    request,
    worker,
    agentOptions,
    signal,
  }: {
    request: WorkerDispatchRequest
    worker: WorkerTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
  }): Promise<{
    sessionId: string
    agent: LiveAgent
    handle: AgentHandleLike
  }> {
    const agents = optionalService<AgentsServiceLike>(this.ctx, 'agents')
    if (typeof agents?.create !== 'function') {
      throw new Error('the agent service is unavailable, so a worker session cannot be created')
    }

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
        cwd: worker.path,
        ...(requestedPreset === '' ? {} : { agentPreset: requestedPreset }),
      },
      agentOptions,
      signal,
      setup: async (childCtx, agent) => {
        await this.#composeSession(childCtx, agent, request, { resume: false })
      },
    })

    const agent = handle.agent
    await this.#assertVisibleAgent(agent, handle)
    // 打工人会话的用户消息来源是 `buka-worker`，DSH 的自动标题只认 `user`
    // 来源的消息，所以新会话在这里显式命名，侧边栏里才不是「未命名」。
    this.#titleSession(agent, request.title)
    // 审批默认按部署策略（省略 / 'ask'）；只有显式 'never' 时才强制拒绝需要审批
    // 的操作，让打工人节点的工作落在打工人目录内。
    if (request.approval === 'never') {
      try {
        this.ctx?.get?.('approval')?.setPolicy?.(agent, 'never')
      } catch {
        // 审批服务不可用时保持默认策略。
      }
    }

    // 挂到打工人自己的工作区：这样侧边栏（按工作区分组）能看到这个会话，
    // `uiWorkspace.openSession()` 打开后也能在列表里找到它。
    await this.#attachSessionToWorkspace(sessionId, worker)
    return { sessionId, agent, handle }
  }

  /**
   * resume 一条已有打工人会话并完成标题、审批策略、工作区挂载；不发 prompt、
   * 不压缩（一个任务一条会话，恢复只续接同一条）。
   *
   * 续接出来的会话是**运行时根会话**：DSH 的人类交互要求根 agent，所以这里
   * 不传 `parentAgent`（与 `agents.create` 的顶层会话一致）。历史会话如果是
   * 旧版 `origin: 'subagent'` 的隐藏会话，直接拒绝：dispose 后抛错，不新开。
   *
   */
  async #resumeAgent({
    request,
    worker,
    agentOptions,
    signal,
    sessionId,
  }: {
    request: WorkerOpenRequest
    worker: WorkerTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
    sessionId: string
  }): Promise<{
    sessionId: string
    agent: LiveAgent
    handle: AgentHandleLike
  }> {
    const agents = optionalService<AgentsServiceLike>(this.ctx, 'agents')
    if (typeof agents?.resume !== 'function') {
      throw new Error('the agent service cannot resume a worker session in this composition')
    }

    let handle: AgentHandleLike
    try {
      handle = await agents.resume({
        resumeSessionId: sessionId,
        agentOptions,
        signal,
        setup: async (childCtx, agent) => {
          await this.#composeSession(childCtx, agent, request, { resume: true })
        },
      })
    } catch (error) {
      if (signal?.aborted === true)
        throw new WorkerSessionStop('aborted', 'worker session was cancelled')
      throw new Error(
        `could not resume worker session "${sessionId}" for worker "${worker.name}": ${describeError(error)}; refusing to start a new worker session`,
        { cause: error },
      )
    }

    const agent = handle.agent
    await this.#assertVisibleAgent(agent, handle)
    // 续接的老会话可能还没有标题（早期版本没命名）；顺手补一次，已有的标题
    // 不覆盖，避免把用户手动改的名字改回去。
    this.#titleSession(agent, request.title)
    // 审批默认按部署策略（省略 / 'ask'）；只有显式 'never' 时才强制拒绝需要审批
    // 的操作，让打工人节点的工作落在打工人目录内。
    if (request.approval === 'never') {
      try {
        this.ctx?.get?.('approval')?.setPolicy?.(agent, 'never')
      } catch {
        // 审批服务不可用时保持默认策略。
      }
    }

    // 挂到打工人自己的工作区；隐藏会话已在上面被拒绝，不会走到这里。
    await this.#attachSessionToWorkspace(sessionId, worker)
    return { sessionId, agent, handle }
  }

  /**
   * 拒绝 DSH 侧边栏不显示的隐藏会话（`origin: 'subagent'`）。
   *
   * 旧版本的工作流兜底可能把打工人节点落成 subagent 子会话；这类会话即使
   * 打开也只在主区域显示，不能作为工作流节点会话。命中时先释放 agent，再抛错。
   *
   */
  async #assertVisibleAgent(agent: LiveAgent, handle: AgentHandleLike): Promise<void> {
    if (agent?.session?.header?.origin !== 'subagent') return
    await disposeHandle(handle)
    throw new Error(
      'refusing to use a hidden subagent worker session; worker sessions must be visible top-level sessions',
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
  #assertPlanModeRequest(request: { planMode?: boolean }): void {
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
    request: { planMode?: boolean },
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
            `buka-workers: /plan off reported "${failure}" for worker session "${String(agent?.id ?? '')}"`,
          )
        }
      }
    } catch (error) {
      if (requested === true) throw error
      this.ctx?.logger?.warn?.(
        `buka-workers: could not leave plan mode for worker session "${String(agent?.id ?? '')}": ${describeError(error)}`,
      )
    }
  }

  /**
   * 新会话的非阻塞 dispatch：建会话、投 prompt、返回句柄；不等待这一轮结束。
   *
   */
  async #startDispatch({
    request,
    worker,
    agentOptions,
    signal,
  }: {
    request: WorkerDispatchRequest
    worker: WorkerTarget
    agentOptions: AgentOptions
    signal?: AbortSignal | undefined
  }): Promise<WorkerSessionObserver> {
    let prepared: {
      sessionId: string
      agent: LiveAgent
      handle: AgentHandleLike
    }
    try {
      prepared = await this.#createVisibleAgent({ request, worker, agentOptions, signal })
    } catch (error) {
      throw this.#creationError(worker, error, signal)
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
      handle: prepared.handle,
      sessionId: prepared.sessionId,
      worker,
      resumed: false,
      startSeq,
    })
  }

  /**
   * 把一次非阻塞 dispatch / open 包装成观察者句柄。句柄只持有这一个 live agent
   * 的操作，不负责等待；`readResult` 从会话日志读，`cancel` 只取消当前轮。
   *
   */
  #observeHandle({
    agent,
    handle,
    sessionId,
    worker,
    resumed,
    startSeq,
  }: {
    agent: LiveAgent
    handle: AgentHandleLike
    sessionId?: string | undefined
    worker: WorkerTarget
    resumed: boolean
    startSeq: number
  }): WorkerSessionObserver {
    const service = this
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      await service.#releaseAgent(handle, sessionId ?? '')
    }
    const observer: WorkerSessionObserver = {
      mode: 'session',
      sessionId: typeof agent?.id === 'string' && agent.id !== '' ? agent.id : (sessionId ?? ''),
      worker: worker.name,
      cwd: worker.path,
      resumed,
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
        return {
          sessionId: observer.sessionId,
          text: turn.text,
          stopReason: turn.stopReason,
          turnEnded: turn.turnEnded,
          startSeq: sinceSeq,
          ...(turn.turnEndSeq === null ? {} : { turnEndSeq: turn.turnEndSeq }),
        }
      },
      /**
       * 在同一会话里再发一条消息（恢复续跑 / plan 审阅跟进用）。返回新的起点 seq。
       * 不再有压缩：续接就是往同一条会话里继续投消息。
       *
       */
      async send(text: string): Promise<number> {
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('send requires a non-empty prompt')
        }
        const next = seqOf(agent)
        agent.followup(followupMessage(text))
        observer.startSeq = next
        return next
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
            `buka-workers: could not read plan mode for session "${observer.sessionId}": ${describeError(error)}`,
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
            `buka-workers: could not ${active === true ? 'enter' : 'leave'} plan mode for worker session "${observer.sessionId}": ${describeError(error)}`,
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
                typeof reason === 'string' && reason !== '' ? reason : 'worker session cancelled',
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
   * 把刚释放 agent 的打工人会话重新通告给客户端（`api-session/added`）。
   *
   * DSH 在 `session/disposed` 时会向客户端发 `api-session/removed`，而打工人
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
        `buka-workers: could not read the session list while re-announcing worker session "${id}": ${describeError(error)}`,
      )
      return
    }
    if (summary === undefined) return

    try {
      ctx.emit('api-session/added', summary)
    } catch (error) {
      ctx.logger?.warn?.(
        `buka-workers: could not re-announce worker session "${id}" after releasing its agent: ${describeError(error)}`,
      )
    }
  }

  /**
   * 把打工人会话挂到打工人自己的工作区。会话 header 的 `cwd` 必须等于工作区
   * 路径（DSH 的 attach 会校验），打工人目录正好满足。
   *
   * 挂不上（例如打工人还没挂载成工作区）不算致命错误：会话仍能通过 runId /
   * 页面打开，只是不会出现在侧边栏。
   *
   */
  async #attachSessionToWorkspace(sessionId: string, worker: WorkerTarget): Promise<void> {
    const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry
    if (registry === undefined || registry === null) return
    try {
      let workspace: { attachSession?(sessionId: string): Promise<unknown> } | null | undefined
      if (typeof registry.resolveByPath === 'function')
        workspace = await registry.resolveByPath(worker.path)
      if (workspace === undefined || workspace === null) {
        if (typeof registry.list === 'function') {
          const list = registry.list()
          workspace = Array.isArray(list)
            ? list.find((entry) => entry?.path === worker.path)
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
        `buka-workers: could not attach worker session "${sessionId}" to the worker workspace: ${describeError(error)}`,
      )
    }
  }

  /**
   * 解析打工人名称并在登记表 / 磁盘上确认。
   *
   * 机器人没有目录、也不建会话：它们由工作流按 `program` 驱动，
   * 这里直接拒绝，让调用方知道该走 program 路径。
   *
   */
  async #resolveWorker(name: unknown): Promise<WorkerTarget> {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!isValidWorkerName(trimmed)) {
      throw new Error(`invalid worker name: ${String(name)}`)
    }
    const registry = await readWorkerRegistry({ file: this.registryFile })
    if (!registry.corrupt) {
      const worker = registry.workers.find((entry) => entry.name === trimmed)
      if (worker !== undefined) {
        if (worker.driver === 'robot') {
          throw new Error(
            `worker "${worker.name}" is a robot and has no session; drive it by its "program" id instead of dispatching a session`,
          )
        }
        let stat: import('node:fs').Stats | undefined
        try {
          stat = await fs.stat(worker.path)
        } catch {
          stat = undefined
        }
        if (stat === undefined || !stat.isDirectory()) {
          throw new Error(`worker directory does not exist: ${worker.path}`)
        }
        return {
          name: worker.name,
          path: worker.path,
          model: worker.model ?? null,
        }
      }
    }

    if (registry.corrupt) {
      throw new Error(`worker registry is unreadable: ${this.registryFile}`)
    }
    throw new Error(`unknown worker: ${trimmed}`)
  }

  /**
   * 一个打工人新会话的模型路由：配置了模型就用配置，否则回落到宿主默认。
   *
   */
  #workerAgentOptions(worker: WorkerTarget): AgentOptions {
    if (worker.model === null || worker.model === undefined) return this.#defaultAgentOptions()
    return {
      provider: worker.model.provider,
      model: worker.model.model,
      ...(worker.model.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: worker.model.reasoningEffort }),
    }
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

// 会话日志解析、错误与摘要拆在 engine/ 下；这里继续对外导出同样的符号，消费方
// 与测试不需要改 import 路径。
export { WorkerSessionStop } from './engine/errors.ts'
export { mapTurnEnd, readSessionOutcome, readSessionTurn } from './engine/session-events.ts'
export { summarizeWorker } from './engine/summary.ts'
export type {
  AgentDefaultModelLike,
  AgentHandleLike,
  AgentOptions,
  AgentPresetsServiceLike,
  AgentsServiceLike,
  ChildContextLike,
  CommandsServiceLike,
  CreateAgentOptionsLike,
  LiveAgent,
  ResumeAgentOptionsLike,
  SessionControllerLike,
  SessionEventLike,
  SessionLike,
  SessionTitleServiceLike,
  WorkerDispatchRequest,
  WorkerOpenRequest,
  WorkerSessionObserver,
  WorkerSessionRequestBase,
  WorkerTarget,
} from './service/types.ts'
