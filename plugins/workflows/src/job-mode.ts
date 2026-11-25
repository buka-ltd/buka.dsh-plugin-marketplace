/**
 * 作业模式：一个会话「只负责启动一个作业」的会话级状态。
 *
 * 与 plan mode 一样，模式本身不新增持久数据，而是折叠会话日志得到：
 *
 * - `command/run` / `command/done` 的成功配对记录「进入或退出」：
 *   `/job [说明]` 进入，`/job off` 退出；
 * - `tool/call` → `tool/result` 里 `workflow_job_start` 的成功调用记录「模式已消耗」；
 * - 日志里已有 `user/message` 或 `turn/start` 表示会话已经用过，不再是「刚开始」。
 *
 * 因此恢复、fork 与压缩都能从日志还原同一状态，命令、提示词与工具可见性
 * 读同一份折叠结果。
 *
 * 模式里不预设工作流：agent 用 `workflow_job_options` 看到全部可启动工作流，
 * 按用户描述挑选；用户没有说明用哪个时先问用户。这样用户不必在命令里记
 * workflow id。
 *
 * 约束：
 *
 * - 进入只允许发生在会话开始时（还没有用户消息 / 轮次）；
 * - 一个会话最多启动一个作业，成功后模式结束；
 * - 任意位置执行 `/job`、或在普通会话里调用 `workflow_job_start` 都会被拒绝。
 *
 * @module @buka/dsh-plugin-workflows/job-mode
 */

import type { Context } from '@deepseek-ai/cordis'

/** 会话日志里本模块用到的形状（与 dsh-session 的 `Session` 结构兼容）。 */
export interface JobModeSession {
  readonly seq?: number
  eventAt?(seq: number): { readonly type?: unknown; readonly data?: unknown } | undefined
}

/** 一个会话的作业模式状态。 */
export interface JobModeState {
  /** 是否已进入作业模式（`/job` 成功）。 */
  readonly entered: boolean
  /** 本会话是否已经成功启动过作业（模式已消耗）。 */
  readonly consumed: boolean
  /** 本会话是否还没有任何用户消息 / 轮次。 */
  readonly fresh: boolean
}

/** 不在作业模式的默认值。 */
const EMPTY: JobModeState = { entered: false, consumed: false, fresh: true }

/** 同一次日志折叠给出的两档状态。 */
interface JobModeFold {
  /** 只算已经结算的命令；命令处理器里的门禁读这一档。 */
  readonly committed: JobModeState
  /** 连正在执行的命令也算上；提示词与工具可见性读这一档。 */
  readonly selected: JobModeState
}

/** 默认折叠结果。 */
const EMPTY_FOLD: JobModeFold = { committed: EMPTY, selected: EMPTY }

/** 折叠缓存：只在日志长度变化时重算。 */
const folds = new WeakMap<object, { readonly seq: number; readonly fold: JobModeFold }>()

/** 一条 `/job` 命令成功时对模式的影响。 */
type JobCommandEffect = { readonly kind: 'enter' } | { readonly kind: 'leave' }

/**
 * 读会话已经结算的作业模式状态（命令处理器用）。
 *
 * 正在执行的 `/job` 不算：命令自己的 `command/run` 在处理器运行前就已落盘，
 * 如果把它算进去，处理器就看不到「进入之前」的会话状态了。
 *
 * @param session agent 的会话；形状不完整时按「不在作业模式」处理
 * @returns 作业模式状态
 */
export function readJobMode(session: unknown): JobModeState {
  return foldOf(session).committed
}

/**
 * 读会话当前的作业模式状态，包含正在执行的 `/job`（提示词与工具可见性用）。
 *
 * `agent.steer()` 会在命令结算前就开启下一步，所以提示词与工具必须把
 * 尚未结算的进入也算上，否则 `/job <说明>` 的第一步会看不到模式。
 *
 * @param session agent 的会话
 * @returns 作业模式状态
 */
export function selectedJobMode(session: unknown): JobModeState {
  return foldOf(session).selected
}

/**
 * 判断一个 agent 能否看到 / 使用作业模式的工具。
 *
 * @param agent 工具激活上下文里的 agent
 * @returns 在作业模式且还没启动过作业时为 true
 */
export function inJobMode(agent: { readonly session?: unknown } | undefined): boolean {
  if (agent === undefined) return false
  const state = selectedJobMode(agent.session)
  return state.entered && !state.consumed
}

/** 读（或重算）一次日志折叠。 */
function foldOf(session: unknown): JobModeFold {
  if (!isRecord(session)) return EMPTY_FOLD
  const seq = typeof session.seq === 'number' ? session.seq : 0
  const cached = folds.get(session)
  if (cached !== undefined && cached.seq === seq) return cached.fold
  const fold = foldSession(session as JobModeSession)
  folds.set(session, { seq, fold })
  return fold
}

/**
 * 作业模式的提示词段落文本。
 *
 * 不内联任何工作流：列表与输入契约由 `workflow_job_options` 提供，段落只说明
 * 选择规则与「不启动一个作业」的约束。
 *
 * @returns 段落文本
 */
export function jobModeSectionText(): string {
  return [
    '你处于作业模式。',
    '本会话只用于启动一个作业；用户可能只说想做什么，也可能点名了某个工作流。',
    '- 先调用 `workflow_job_options` 查看当前可启动的工作流：每项的 id、名称、描述、开始节点输入 schema，以及暂时不可启动的原因。',
    '- 按用户描述挑最匹配的一个。用户没有说明用哪个、或几个都像时，先问用户确认，不要猜；用户点名了 id 或名称就直接用那个。',
    '- 选定后按该工作流的开始节点 schema 向用户补齐输入（用户已经说过的不要重复问），然后调用 `workflow_job_start`。',
    '- 本会话只能启动一个作业；启动后模式结束，最终报告会回到本会话，确认收到用 `workflow_task_complete`。',
    '- 如果 `workflow_job_start` 报出作业启动失败、或本会话已经启动过作业，把原因告诉用户并让 ta 新建会话重试；不要反复调用。',
    '- 不启动就退出：让用户执行 `/job off`。',
  ].join('\n')
}

/**
 * 折叠会话日志，同时给出「已结算」与「含正在执行命令」两档状态。
 *
 * 正在执行的 `/job` 在 `command/run` 写入时就先作用到 `selected`：`agent.steer()`
 * 会在 `command/done` 之前开启下一步。命令结算失败时把 `selected` 回退。
 *
 * @param session 会话
 * @returns 两档作业模式状态
 */
function foldSession(session: JobModeSession): JobModeFold {
  const end = typeof session.seq === 'number' ? session.seq : 0
  let committed = false
  let selected = false
  let consumed = false
  let fresh = true
  let running: {
    readonly commandId: string
    readonly effect: JobCommandEffect
    readonly previousSelected: boolean
  } | null = null
  const pendingCalls = new Set<string>()
  for (let seq = 0; seq < end; seq += 1) {
    const event = session.eventAt?.(seq)
    if (!isRecord(event)) continue
    if (event.type === 'turn/start' || event.type === 'user/message') fresh = false
    const data = isRecord(event.data) ? event.data : undefined
    if (data === undefined) continue
    if (event.type === 'command/run') {
      if (data.name !== 'job') continue
      const effect = commandEffect(data.args)
      running = {
        commandId: String(data.commandId ?? ''),
        effect,
        previousSelected: selected,
      }
      selected = effect.kind === 'enter'
      continue
    }
    if (event.type === 'command/done') {
      if (running === null || data.commandId !== running.commandId) continue
      if (data.kind === 'success') committed = running.effect.kind === 'enter'
      else selected = running.previousSelected
      running = null
      continue
    }
    if (event.type === 'tool/call') {
      if (data.name === 'workflow_job_start' && typeof data.callId === 'string') {
        pendingCalls.add(data.callId)
      }
      continue
    }
    if (event.type === 'tool/result') {
      const message = isRecord(data.message) ? data.message : undefined
      const callId = typeof message?.toolCallId === 'string' ? message.toolCallId : ''
      if (callId === '' || !pendingCalls.delete(callId)) continue
      if (data.error === undefined && message?.isError !== true) consumed = true
    }
  }
  return {
    committed: { entered: committed, consumed, fresh },
    selected: { entered: selected, consumed, fresh },
  }
}

/**
 * 把一条 `/job` 命令的原始输入解释成模式变更。
 *
 * 不带参数也进入模式（随后由 agent 询问用户想做什么）；`off` 是退出；
 * 其余文字只是附带说明，不在这里解析工作流 id。
 *
 * @param args `command/run` 记录下来的原始输入
 * @returns 模式影响
 */
function commandEffect(args: unknown): JobCommandEffect {
  return typeof args === 'string' && args.trim() === 'off' ? { kind: 'leave' } : { kind: 'enter' }
}

/** 记录对象判断。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 作业模式装配依赖。 */
export interface JobModeDeps {
  readonly ctx: Context
}

/**
 * 注册作业模式的提示词段落。
 *
 * 段落只在作业模式激活且尚未消耗时出现；`workflow_job_options` /
 * `workflow_job_start` 的可见性由调用方用 {@link inJobMode} 判定，两处读的是
 * 同一份日志折叠结果。
 *
 * @param deps 上下文
 */
export function installJobMode({ ctx }: JobModeDeps): void {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const systemPrompt = promptCtx.systemPrompt
    if (systemPrompt?.section === undefined) return
    const dispose = systemPrompt.section({
      name: 'workflow_job_policy',
      order: 520,
      interpolate: false,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        return inJobMode(agent) ? jobModeSectionText() : ''
      },
    })
    promptCtx.effect(() => dispose, 'workflow: job mode prompt section')
  })
}
