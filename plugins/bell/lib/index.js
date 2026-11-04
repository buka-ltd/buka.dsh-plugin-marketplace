/**
 * 任务结束 / 等待用户操作时播放系统提示音。
 *
 * 两个提示时机都来自 DSH 自己的生命周期，不轮询、不改会话日志：
 *
 * - 完成音：顶层 Agent（`ctx.agents.roots()`）从 `running` 变回 `idle`，
 *   说明这一轮任务真正结束；子 Agent 也发 `agent/status`，所以必须按
 *   运行时的顶层归属过滤，否则每次工具子任务结束都会响。
 *   用户手动终止不算任务结束：GUI 的终止按钮走 `session/cancel` →
 *   `agent.cancel({ kind: 'user' })`，这一轮会以 `turn/end` 的
 *   `reason.kind === 'aborted'` 收尾，随后才是 `agent/status` idle。
 *   完成音监听会话日志里的 `turn/end` 记住最近一轮的结束原因，aborted 时不响。
 * - 等待音：`user-questions/request`（`ask_user_question`、plan review）
 *   与 `approval/request`（审批）这两个 waterfall 事件，都是 DSH 正在
 *   等用户回复时才会派发。监听器只旁听，必须调用 `next()` 把决定交给
 *   真正的 answerer（Web UI / 自动审批），不能截胡。
 *
 * 播放交给宿主系统的声音工具（macOS `afplay`、Windows `SystemSounds`、
 * Linux `paplay` 等），不占用 DSH 自己的 UI 与音频权限。
 *
 * 声音选择放在插件 Config 的 volatile 字段里：设置页写入时 Loader 不重载
 * 插件，只更新配置引用并派发 `loader/volatile-update`；插件在这个事件里
 * 播放新选中的声音，就是设置页下拉框的「选中即试听」。
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

/** 两个提示音的默认选择（macOS 系统声音名）。 */
const DEFAULT_SOUND = { finish: 'Glass', wait: 'Ping' }

/** 同类提示音的最小间隔，避免多个会话同时结束时响成一片。 */
const COOLDOWN_MS = 500

/**
 * 可在设置页改的两项声音。
 *
 * 只有 `volatile` 字段能被设置页热更新：Loader 把新值写进配置引用并派发
 * `loader/volatile-update`，不会重启插件。
 */
export const Config = z.object({
  /** 任务结束时播放的 macOS 系统提示音名。 */
  finish: z.string().default(DEFAULT_SOUND.finish).volatile(),
  /** DSH 等待用户回答或审批时播放的 macOS 系统提示音名。 */
  wait: z.string().default(DEFAULT_SOUND.wait).volatile(),
})

/**
 * 非 macOS 平台的默认播放命令，按数组顺序尝试，前一个无法启动时换下一个。
 * 设置里的 macOS 声音名在这些平台不可用，回退到这里的平台默认声音。
 */
const PLATFORM_COMMANDS = {
  win32: {
    finish: [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Exclamation.Play()']]],
    wait: [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Asterisk.Play()']]],
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
  },
}

/**
 * 读一个提示音当前选中的声音名。配置里是 volatile 引用，值要经 `.get()` 读；
 * 手写节点被测试注入字符串时也兼容。读不到时回退默认值。
 *
 * @param {unknown} config 插件行配置
 * @param {'finish' | 'wait'} cue 提示音种类
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
 * 一种提示音的候选播放命令。
 *
 * @param {'finish' | 'wait'} cue 提示音种类
 * @param {string} sound 选中的声音名
 * @returns {Array<[string, string[]]>}
 */
function commandFor(cue, sound) {
  if (process.platform === 'darwin') {
    const name = SYSTEM_SOUNDS.includes(sound) ? sound : DEFAULT_SOUND[cue]
    return [['afplay', [`/System/Library/Sounds/${name}.aiff`]]]
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
 * @returns {(cue: 'finish' | 'wait', sound: string) => void}
 */
function createPlayer(ctx) {
  const warned = new Set()

  function warnUnavailable(cue) {
    if (warned.has(cue)) return
    warned.add(cue)
    try {
      ctx.logger?.warn(
        'buka-bell: no sound player is available for the %s cue; tasks will finish silently',
        cue,
      )
    } catch {
      // logger 不可用时也不影响任务
    }
  }

  function play(cue, sound) {
    const candidates = commandFor(cue, sound)
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
 * 注册两个提示音的监听。
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

  const finishGate = createGate(COOLDOWN_MS)
  const waitGate = createGate(COOLDOWN_MS)
  const play = createPlayer(ctx)
  const lastSound = { finish: selectedSound(config, 'finish'), wait: selectedSound(config, 'wait') }

  // 每个会话最近一轮 `turn/end` 的原因（`completed` / `aborted` / `error` …）。
  // 用户点终止时，DSH 先把 `turn/end { reason: { kind: 'aborted' } }` 写进会话
  // 日志、再发 `agent/status` idle；手动终止不是任务完成，所以记下原因、idle
  // 时跳过完成音。记「最近一轮」而不是布尔标记：终止后若队列里还有消息，
  // DSH 会接着跑下一轮，真正跑完时仍然应该响。
  const lastTurnEnd = new Map()

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    lastTurnEnd.set(session.id, event.data?.reason?.kind)
  })

  // 设置页切换声音只改 volatile 字段：Loader 更新配置引用后派发该事件。
  // 这里把新选中的声音播放一次，就是下拉框的试听。
  ctx.on('loader/volatile-update', () => {
    for (const cue of ['finish', 'wait']) {
      const next = selectedSound(config, cue)
      if (next === lastSound[cue]) continue
      lastSound[cue] = next
      play(cue, next)
    }
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') {
      running.add(agent.id)
      return
    }
    const turnEnd = lastTurnEnd.get(agent.id)
    lastTurnEnd.delete(agent.id)
    if (!running.delete(agent.id)) return
    if (!isRootAgent(ctx, agent)) return
    // 手动终止、会话归档、Agent 卸载都会让这一轮以 aborted 收尾，不响完成音。
    if (turnEnd === 'aborted') return
    if (!finishGate()) return
    play('finish', selectedSound(config, 'finish'))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    running.delete(agent.id)
    lastTurnEnd.delete(agent.id)
  })

  // waterfall：旁听后把决定交回给真正的 answerer，不能自己返回答案。
  //
  // 必须 `prepend`：Web UI 的回答器由 api-remotes 注册得更早，它会把请求转发给
  // 浏览器并等用户作答，期间不调用 `next()`；排在它后面的监听器就永远收不到这个
  // 事件。排在前面旁听、立刻响铃，再 `next()` 把决定交回，才既响铃又让 UI 正常工作。
  ctx.on(
    'user-questions/request',
    (_request, next) => {
      if (waitGate()) play('wait', selectedSound(config, 'wait'))
      return next()
    },
    { prepend: true },
  )

  ctx.on(
    'approval/request',
    (_request, next) => {
      if (waitGate()) play('wait', selectedSound(config, 'wait'))
      return next()
    },
    { prepend: true },
  )
}
