/**
 * 四个提示时机的监听与判定状态机：只旁听 DSH 的生命周期事件，
 * 按「运行时顶层 Agent 从 running 变回 idle」这一条主线决定该响哪一种提示音。
 *
 * 四个提示时机都来自 DSH 自己的生命周期，不轮询、不改会话日志：
 *
 * - 完成音：顶层 Agent（`ctx.agents.roots()`）从 `running` 变回 `idle`，
 *   说明这一轮任务真正结束；子 Agent 也发 `agent/status`，所以必须按
 *   运行时的顶层归属过滤，否则每次工具子任务结束都会响。
 *   用户手动终止不算任务结束：GUI 的终止按钮走 `session/cancel` →
 *   `agent.cancel({ kind: 'user' })`，这一轮会以 `turn/end` 的
 *   `reason.kind === 'aborted'` 收尾，随后才是 `agent/status` idle。
 *   完成音监听会话日志里的 `turn/end` 记住最近一轮的结束原因，aborted 时
 *   改由手动终止音处理（默认播放插件自带的「你干嘛~哎哟」）。
 * - 等待音：`user-questions/request`（`ask_user_question`、plan review）
 *   与 `approval/request`（审批）这两个 waterfall 事件，都是 DSH 正在
 *   等用户回复时才会派发。监听器只旁听，必须调用 `next()` 把决定交给
 *   真正的 answerer（Web UI / 自动审批），不能截胡。
 * - 计划被退回音：plan review 卡片里点「要求修改」不会回答批准/拒绝选项，
 *   而是由 Web UI 以 `ASK_CANCELLED` 取消这次提问；`dsh-plan-mode` 收到
 *   取消后调用 `concludeTurn()`，这一轮随即以 `turn/end` `completed` 收尾。
 *   插件在旁听 `user-questions/request` 时接住 `next()` 的拒绝结果，看到
 *   `ASK_CANCELLED` 且请求带 `plan-review` 意图，就记下这个会话；等 idle
 *   时改播计划被退回音，而不是当成任务完成的完成音。
 * - 手动终止音：只在 `turn/end` 原因为 `aborted` 且取消来源是 `user`
 *   （用户点终止按钮/停止快捷键）时播放。会话归档、父级取消、插件卸载
 *   同样以 aborted 收尾，但它们不是用户手动停止，保持静音。
 *
 * @module @buka/dsh-plugin-bell/watch
 */

import type { Context } from '@deepseek-ai/cordis'
// 下面三个包只引入类型：它们把这些生命周期事件与服务增强到 cordis 的 Context 上，
// 运行时由 DSH 自己提供，插件不打包它们。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { BellConfig } from './index.ts'
import type { Player } from './player.ts'
import { createGate } from './player.ts'
import type { Cue } from './sounds.ts'
import { CUES, SILENT, selectedSound } from './sounds.ts'

/** 同类提示音的最小间隔，避免多个会话同时结束时响成一片。 */
const COOLDOWN_MS = 500

/** `turn/end` 里的结束原因。 */
interface TurnEndReason {
  readonly kind?: string
  readonly reason?: { readonly kind?: string }
}

/** 一个 Agent 的最小形状；顶层判断只用到 id。 */
interface AgentLike {
  readonly id: string
}

/**
 * 判断 Agent 是不是运行时顶层会话；子 Agent（subagent / workflow 子运行）
 * 也发 `agent/status`，但不应该触发完成音。
 */
function isRootAgent(ctx: Context, agent: AgentLike): boolean {
  try {
    return ctx.agents.roots().some((root) => root.id === agent.id)
  } catch {
    return false
  }
}

/**
 * 这个提问是不是 plan review：`dsh-plan-mode` 会在 `exit_plan_mode` 的提问上
 * 设置 `intent.kind === 'plan-review'`，并带上待审的计划全文。
 */
function isPlanReview(request: unknown): boolean {
  const questions = (request as { questions?: unknown } | null | undefined)?.questions
  if (!Array.isArray(questions)) return false
  return questions.some((question) => {
    const intent = (question as { intent?: { kind?: unknown } } | null | undefined)?.intent
    return intent?.kind === 'plan-review'
  })
}

/**
 * 读取提问被取消/失败时带回来的错误码。跨进程传输后可能是 Error，也可能是
 * `{ name, code, message }` 形状的普通对象。
 */
function rejectionCode(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/**
 * 注册四个提示音的监听。
 */
export function watch(ctx: Context, config: BellConfig, play: Player): void {
  // 已经观察到进入 running 的 Agent id。只对“响过 run 的 idle”响铃，
  // 避免 Agent 创建时的初始 idle 也触发完成音。插件热加载时把正在跑的
  // 顶层 Agent 预置进来，这样装载前就开始的任务结束时也不会漏。
  const running = new Set<string>()
  for (const agent of ctx.agents.roots()) {
    if (agent.status === 'running') running.add(agent.id)
  }

  const gates = new Map<Cue, () => boolean>(CUES.map((cue) => [cue, createGate(COOLDOWN_MS)]))

  /** 按当前配置播放一种提示音；选「无」时不响，也不占用节流门。 */
  function ring(cue: Cue): void {
    const sound = selectedSound(config, cue)
    if (sound === SILENT) return
    const gate = gates.get(cue)
    if (gate === undefined || !gate()) return
    play(cue, sound)
  }

  // 每个会话最近一轮 `turn/end` 的结束原因（`completed` / `aborted` / `error` …）。
  // 用户点终止时，DSH 先把 `turn/end { reason: { kind: 'aborted' } }` 写进会话
  // 日志、再发 `agent/status` idle；手动终止不是任务完成，所以记下原因、idle
  // 时改判。记「最近一轮」而不是布尔标记：终止后若队列里还有消息，
  // DSH 会接着跑下一轮，真正跑完时仍然应该按那一轮的原因响。
  const lastTurnEnd = new Map<string, TurnEndReason | undefined>()

  // 刚刚被用户点了「要求修改」的 plan review 所属会话。plan review 被退回后
  // 这一轮以 `completed` 收尾，不能当成任务完成的完成音。
  const planRevise = new Set<string>()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      // 计划被退回后，用户可能紧接着发消息：DSH 会在同一驱动里直接开下一轮，
      // 中间没有 idle。标到这里已经过期，清掉，避免把下一轮真正的完成当成
      // 计划被退回。
      planRevise.delete(session.id)
      return
    }
    if (event.type !== 'turn/end') return
    lastTurnEnd.set(session.id, (event.data as { reason?: TurnEndReason } | undefined)?.reason)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') {
      running.add(agent.id)
      return
    }
    const reason = lastTurnEnd.get(agent.id)
    lastTurnEnd.delete(agent.id)
    const planReviseTurn = planRevise.delete(agent.id)
    if (!running.delete(agent.id)) return
    if (!isRootAgent(ctx, agent)) return
    if (reason?.kind === 'aborted') {
      // 手动终止、会话归档、父级取消、Agent 卸载都会让这一轮以 aborted 收尾。
      // 只有用户自己点的终止才响手动终止音；其余情况保持静音。
      if (reason.reason?.kind !== 'user') return
      ring('abort')
      return
    }
    // plan review 被退回时 turn/end 是 completed，按计划音而不是完成音处理。
    if (planReviseTurn && reason?.kind === 'completed') {
      ring('plan')
      return
    }
    ring('finish')
  })

  ctx.on('agent/disposed', ({ agent }) => {
    running.delete(agent.id)
    lastTurnEnd.delete(agent.id)
    planRevise.delete(agent.id)
  })

  // waterfall：旁听后把决定交回给真正的 answerer，不能自己返回答案。
  //
  // 必须 `prepend`：Web UI 的回答器由 api-remotes 注册得更早，它会把请求转发给
  // 浏览器并等用户作答，期间不调用 `next()`；排在它后面的监听器就永远收不到这个
  // 事件。排在前面旁听、立刻响铃，再 `next()` 把决定交回，才既响铃又让 UI 正常工作。
  ctx.on(
    'user-questions/request',
    (request, next) => {
      ring('wait')
      const answer = next()
      // 旁听 answer 的拒绝：plan review 点「要求修改」时 Web UI 以 ASK_CANCELLED
      // 取消提问，host 侧因此拿到的是一次拒绝，而不是回答。只监听结果，
      // 原样把 answer 交回调用方，不改变提问语义。
      if (
        isPlanReview(request) &&
        answer !== null &&
        typeof (answer as PromiseLike<unknown>)?.then === 'function'
      ) {
        void (answer as PromiseLike<unknown>).then?.(undefined, (error: unknown) => {
          try {
            if (rejectionCode(error) !== 'ASK_CANCELLED') return
            const sessionId = (request as { agent?: { id?: unknown } } | null | undefined)?.agent
              ?.id
            if (typeof sessionId === 'string') planRevise.add(sessionId)
          } catch {
            // 旁听失败不能影响提问本身
          }
        })
      }
      return answer
    },
    { prepend: true },
  )

  ctx.on(
    'approval/request',
    (_request, next) => {
      ring('wait')
      return next()
    },
    { prepend: true },
  )
}
