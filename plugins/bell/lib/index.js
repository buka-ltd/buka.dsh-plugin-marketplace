/**
 * 任务结束 / 等待用户操作 / 计划被退回 / 手动终止时播放系统提示音。
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
 *   改由手动终止音处理（默认静音）。
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
 * 播放交给宿主系统的声音工具（macOS `afplay`、Windows `SystemSounds`、
 * Linux `paplay` 等），不占用 DSH 自己的 UI 与音频权限。
 *
 * 声音选择放在插件 Config 的 volatile 字段里：设置页写入时 Loader 不重载
 * 插件，只更新配置引用并派发 `loader/volatile-update`；插件在这个事件里
 * 播放新选中的声音，就是设置页下拉框的「选中即试听」。四种提示音都可以
 * 选「无」（配置值 `none`），表示这个时机不播放。
 *
 * @module @buka/dsh-plugin-bell
 */

import { spawn } from 'node:child_process'
import z from '@deepseek-ai/schemastery'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'sound-buka-bell'

/** 依赖的服务：用 `roots()` 判断一个 Agent 是不是运行时顶层会话。 */
export const inject = ['agents']

/**
 * 「无」选项的哨兵值：设置页下拉框里的「无」写入这个值，表示该时机不播放。
 * 它不是系统声音名，因此不会出现在 `SYSTEM_SOUNDS` 里。
 */
export const SILENT = 'none'

/**
 * macOS 系统自带提示音清单；设置页下拉框的可选项与这里保持一致。
 * 文件位置固定为 `/System/Library/Sounds/<name>.aiff`。
 */
const SYSTEM_SOUNDS = [
  'Basso',
  'Blow',
  'Bottle',
  'Frog',
  'Funk',
  'Glass',
  'Hero',
  'Morse',
  'Ping',
  'Pop',
  'Purr',
  'Sosumi',
  'Submarine',
  'Tink',
]

/**
 * 四个提示音的默认选择。
 *
 * 计划被退回、手动终止默认静音：这两种时机都是用户刚操作完、人就在屏幕前，
 * 默认响铃只会打扰；想要提示的人可以在设置页单独打开。
 */
const DEFAULT_SOUND = { finish: 'Glass', wait: 'Ping', plan: SILENT, abort: SILENT }

/** 提示音种类；顺序与设置页下拉框一致。 */
const CUES = ['finish', 'wait', 'plan', 'abort']

/** 同类提示音的最小间隔，避免多个会话同时结束时响成一片。 */
const COOLDOWN_MS = 500

/**
 * 可在设置页改的四项声音。
 *
 * 只有 `volatile` 字段能被设置页热更新：Loader 把新值写进配置引用并派发
 * `loader/volatile-update`，不会重启插件。
 */
export const Config = z.object({
  /** 任务结束时播放的 macOS 系统提示音名（或 `none`）。 */
  finish: z.string().default(DEFAULT_SOUND.finish).volatile(),
  /** DSH 等待用户回答或审批时播放的 macOS 系统提示音名（或 `none`）。 */
  wait: z.string().default(DEFAULT_SOUND.wait).volatile(),
  /** 计划评审被用户退回修改时播放的 macOS 系统提示音名（或 `none`）。 */
  plan: z.string().default(DEFAULT_SOUND.plan).volatile(),
  /** 用户手动终止任务时播放的 macOS 系统提示音名（或 `none`）。 */
  abort: z.string().default(DEFAULT_SOUND.abort).volatile(),
})

/**
 * 非 macOS 平台的默认播放命令，按数组顺序尝试，前一个无法启动时换下一个。
 * 设置里的 macOS 声音名在这些平台不可用，回退到这里的平台默认声音；
 * 默认静音的种类（`none`）在任何平台都不会播放。
 */
const PLATFORM_COMMANDS = {
  win32: {
    finish: [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Exclamation.Play()']]],
    wait: [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Asterisk.Play()']]],
    plan: [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Question.Play()']]],
    abort: [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Hand.Play()']]],
  },
  // freedesktop 声音包在大多数发行版上由 sound-theme-freedesktop 提供；
  // 后两个候选是没装它时的退路。
  linux: {
    finish: [
      ['paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga']],
      ['canberra-gtk-play', ['-i', 'complete']],
      ['aplay', ['/usr/share/sounds/alsa/Front_Center.wav']],
    ],
    wait: [
      ['paplay', ['/usr/share/sounds/freedesktop/stereo/message.oga']],
      ['canberra-gtk-play', ['-i', 'message']],
      ['aplay', ['/usr/share/sounds/alsa/Front_Center.wav']],
    ],
    plan: [
      ['paplay', ['/usr/share/sounds/freedesktop/stereo/dialog-information.oga']],
      ['canberra-gtk-play', ['-i', 'dialog-information']],
      ['aplay', ['/usr/share/sounds/alsa/Front_Center.wav']],
    ],
    abort: [
      ['paplay', ['/usr/share/sounds/freedesktop/stereo/dialog-warning.oga']],
      ['canberra-gtk-play', ['-i', 'dialog-warning']],
      ['aplay', ['/usr/share/sounds/alsa/Front_Center.wav']],
    ],
  },
}

/**
 * 读一个提示音当前选中的声音名。配置里是 volatile 引用，值要经 `.get()` 读；
 * 手写节点被测试注入字符串时也兼容。读不到时回退默认值。
 *
 * @param {unknown} config 插件行配置
 * @param {'finish' | 'wait' | 'plan' | 'abort'} cue 提示音种类
 * @returns {string}
 */
export function selectedSound(config, cue) {
  const field = config?.[cue]
  try {
    if (field !== null && typeof field === 'object' && typeof field.get === 'function') {
      const value = field.get()
      if (typeof value === 'string' && value !== '') return value
    } else if (typeof field === 'string' && field !== '') {
      return field
    }
  } catch {
    // volatile 引用不可读时走默认值
  }
  return DEFAULT_SOUND[cue]
}

/**
 * 一种提示音的候选播放命令；选中「无」时没有候选。
 *
 * @param {'finish' | 'wait' | 'plan' | 'abort'} cue 提示音种类
 * @param {string} sound 选中的声音名
 * @returns {Array<[string, string[]]>}
 */
function commandFor(cue, sound) {
  if (sound === SILENT) return []
  if (process.platform === 'darwin') {
    const fallback = DEFAULT_SOUND[cue] === SILENT ? undefined : DEFAULT_SOUND[cue]
    const name = SYSTEM_SOUNDS.includes(sound) ? sound : fallback
    return name === undefined ? [] : [['afplay', [`/System/Library/Sounds/${name}.aiff`]]]
  }
  return PLATFORM_COMMANDS[process.platform]?.[cue] ?? PLATFORM_COMMANDS.linux[cue]
}

/**
 * 同类提示音的节流门：返回 true 表示这次可以响。
 *
 * @param {number} cooldownMs 最小间隔（毫秒）
 * @returns {() => boolean}
 */
function createGate(cooldownMs) {
  let last = 0
  return () => {
    const now = Date.now()
    if (now - last < cooldownMs) return false
    last = now
    return true
  }
}

/**
 * 生成播放器。任何一步失败都只记一次警告，绝不向 DSH 的生命周期抛错：
 * 提示音失败不能影响任务本身。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文（只用来取 logger）
 * @returns {(cue: 'finish' | 'wait' | 'plan' | 'abort', sound: string) => void}
 */
function createPlayer(ctx) {
  const warned = new Set()

  function warnUnavailable(cue) {
    if (warned.has(cue)) return
    warned.add(cue)
    try {
      ctx.logger?.warn(
        'buka-bell: no sound player is available for the %s cue; that moment will be silent',
        cue,
      )
    } catch {
      // logger 不可用时也不影响任务
    }
  }

  function play(cue, sound) {
    const candidates = commandFor(cue, sound)
    if (candidates.length === 0) return
    let index = 0

    const attempt = () => {
      if (index >= candidates.length) {
        warnUnavailable(cue)
        return
      }
      const [command, args] = candidates[index]
      index += 1
      let child
      try {
        child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
      } catch {
        attempt()
        return
      }
      child.once('error', attempt)
      child.unref()
    }

    attempt()
  }

  return play
}

/**
 * 判断 Agent 是不是运行时顶层会话；子 Agent（subagent / workflow 子运行）
 * 也发 `agent/status`，但不应该触发完成音。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {{ id: string }} agent 事件里的 Agent
 * @returns {boolean}
 */
function isRootAgent(ctx, agent) {
  try {
    return ctx.agents.roots().some((root) => root.id === agent.id)
  } catch {
    return false
  }
}

/**
 * 这个提问是不是 plan review：`dsh-plan-mode` 会在 `exit_plan_mode` 的提问上
 * 设置 `intent.kind === 'plan-review'`，并带上待审的计划全文。
 *
 * @param {unknown} request `user-questions/request` 的请求
 * @returns {boolean}
 */
function isPlanReview(request) {
  const questions = request?.questions
  if (!Array.isArray(questions)) return false
  return questions.some((question) => question?.intent?.kind === 'plan-review')
}

/**
 * 读取提问被取消/失败时带回来的错误码。跨进程传输后可能是 Error，也可能是
 * `{ name, code, message }` 形状的普通对象。
 *
 * @param {unknown} error 拒绝原因
 * @returns {string | undefined}
 */
function rejectionCode(error) {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object' && typeof error.code === 'string') return error.code
  return undefined
}

/**
 * 注册四个提示音的监听。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 提供 `agents` 的上下文
 * @param {unknown} [config] 插件行配置
 */
export function apply(ctx, config) {
  // 已经观察到进入 running 的 Agent id。只对“响过 run 的 idle”响铃，
  // 避免 Agent 创建时的初始 idle 也触发完成音。插件热加载时把正在跑的
  // 顶层 Agent 预置进来，这样装载前就开始的任务结束时也不会漏。
  const running = new Set()
  for (const agent of ctx.agents.roots()) {
    if (agent.status === 'running') running.add(agent.id)
  }

  const gates = new Map(CUES.map((cue) => [cue, createGate(COOLDOWN_MS)]))
  const play = createPlayer(ctx)
  const lastSound = Object.fromEntries(CUES.map((cue) => [cue, selectedSound(config, cue)]))

  /**
   * 按当前配置播放一种提示音；选「无」时不响，也不占用节流门。
   *
   * @param {'finish' | 'wait' | 'plan' | 'abort'} cue 提示音种类
   */
  function ring(cue) {
    const sound = selectedSound(config, cue)
    if (sound === SILENT) return
    if (!gates.get(cue)()) return
    play(cue, sound)
  }

  // 每个会话最近一轮 `turn/end` 的结束原因（`completed` / `aborted` / `error` …）。
  // 用户点终止时，DSH 先把 `turn/end { reason: { kind: 'aborted' } }` 写进会话
  // 日志、再发 `agent/status` idle；手动终止不是任务完成，所以记下原因、idle
  // 时改判。记「最近一轮」而不是布尔标记：终止后若队列里还有消息，
  // DSH 会接着跑下一轮，真正跑完时仍然应该按那一轮的原因响。
  const lastTurnEnd = new Map()

  // 刚刚被用户点了「要求修改」的 plan review 所属会话。plan review 被退回后
  // 这一轮以 `completed` 收尾，不能当成任务完成的完成音。
  const planRevise = new Set()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      // 计划被退回后，用户可能紧接着发消息：DSH 会在同一驱动里直接开下一轮，
      // 中间没有 idle。标到这里已经过期，清掉，避免把下一轮真正的完成当成
      // 计划被退回。
      planRevise.delete(session.id)
      return
    }
    if (event.type !== 'turn/end') return
    lastTurnEnd.set(session.id, event.data?.reason)
  })

  // 设置页切换声音只改 volatile 字段：Loader 更新配置引用后派发该事件。
  // 这里把新选中的声音播放一次，就是下拉框的试听。
  ctx.on('loader/volatile-update', () => {
    for (const cue of CUES) {
      const next = selectedSound(config, cue)
      if (next === lastSound[cue]) continue
      lastSound[cue] = next
      if (next !== SILENT) play(cue, next)
    }
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
      if (isPlanReview(request) && answer !== null && typeof answer.then === 'function') {
        answer.then(undefined, (error) => {
          try {
            if (rejectionCode(error) !== 'ASK_CANCELLED') return
            const sessionId = request?.agent?.id
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
