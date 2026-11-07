/**
 * 提示音的可选清单与「怎么播」：纯数据加纯函数，不碰 DSH 上下文。
 * 候选表、各平台播放命令、试听路由的路径与声音名校验都在这里。
 *
 * 单独成文件是为了能被单测直接导入：Host 入口 `index.js` 依赖
 * `@deepseek-ai/schemastery` 声明 Config，而本文件零依赖，`pnpm test`
 * 不需要先安装依赖就能检查音频文件与候选表。
 *
 * @module @buka/dsh-plugin-bell/sounds
 */

import { fileURLToPath } from 'node:url'

/**
 * 「无」选项的哨兵值：设置页下拉框里的「无」写入这个值，表示该时机不播放。
 * 它不是系统声音名，因此不会出现在 `SYSTEM_SOUNDS` 里。
 */
export const SILENT = 'none'

/** 设置页试听路由：Host 注册它、浏览器一半按同一字符串请求。 */
export const PREVIEW_ROUTE = '/buka-bell/preview'

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
 * 插件自带的音频候选：配置值 → 相对包根的路径。
 *
 * 设置页下拉框里它排在系统声音之前，值写进 volatile 配置。文件随包发布
 * （`package.json` 的 `files`），所以路径按 `import.meta.url` 定位。
 * `ikun` 是网络二创梗语音片段，版权与使用范围见 README 的「素材版权」。
 */
export const CUSTOM_SOUNDS = {
  ikun: 'assets/voice.mp3',
}

/**
 * 把 `CUSTOM_SOUNDS` 里的相对路径解析成插件包里的绝对路径。
 * 本文件在 `lib/` 下，上一级就是包根。
 *
 * @param {string} relative `CUSTOM_SOUNDS` 里的值
 * @returns {string}
 */
function assetPath(relative) {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url))
}

/**
 * 播放自带音频文件的候选命令，按顺序尝试，前一个启动失败就换下一个。
 *
 * 系统声音在 macOS 上是 `/System/Library/Sounds/<name>.aiff`，自带音频是 mp3，
 * 得用能解码文件的播放器：macOS 一定有 `afplay`；Windows / Linux 只列常见
 * 命令行播放器的退路，都没装时这个选项静音（日志里警告一次，不影响任务）。
 * `paplay` 能否解码 mp3 取决于发行版的 GStreamer 插件，失败时退到 `ffplay`。
 *
 * @type {Record<string, (file: string) => Array<[string, string[]]>>
 */
const FILE_PLAYERS = {
  darwin: (file) => [['afplay', [file]]],
  win32: (file) => [
    ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]],
    ['mpv', ['--no-video', '--really-quiet', file]],
  ],
  linux: (file) => [
    ['paplay', [file]],
    ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]],
    ['mpv', ['--no-video', '--really-quiet', file]],
  ],
}

/**
 * 四个提示音的默认选择。
 *
 * 取常用配置：任务结束 `Basso`、等待输入 `Submarine` 都是 macOS 系统声音；
 * 手动终止播放插件自带的「你干嘛~哎哟」（`ikun`），没装 ffplay / mpv 的平台
 * 会静音。计划被退回默认静音：用户点「要求修改」时人就在屏幕前，默认响铃
 * 只会打扰，想要提示的人可以在设置页单独打开。
 */
export const DEFAULT_SOUND = { finish: 'Basso', wait: 'Submarine', plan: SILENT, abort: 'ikun' }

/** 提示音种类；顺序与设置页下拉框一致。 */
export const CUES = ['finish', 'wait', 'plan', 'abort']

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
 * 自带音频的播放命令：按平台给文件播放器，环境里没有播放器时启动失败、静音。
 *
 * @param {string} relative `CUSTOM_SOUNDS` 里的值
 * @returns {Array<[string, string[]]>}
 */
function fileCommands(relative) {
  const players = FILE_PLAYERS[process.platform] ?? FILE_PLAYERS.linux
  return players(assetPath(relative))
}

/**
 * 一种提示音的候选播放命令；选中「无」时没有候选。
 *
 * 自带音频（`CUSTOM_SOUNDS`）优先：它不在 macOS 系统声音表里，任何平台都
 * 交给 `FILE_PLAYERS` 的文件播放器。系统声音在 macOS 上按名字播放
 * `/System/Library/Sounds/<name>.aiff`，名字不认识时退回该时机的默认声音
 * （默认音是自带音频时同样走文件播放器，默认静音的种类没有退路）；
 * Windows / Linux 上没有系统声音表，用平台默认音。
 *
 * 导出是为了让单测能直接检查候选命令，运行时不经过它以外的入口。
 *
 * @param {'finish' | 'wait' | 'plan' | 'abort'} cue 提示音种类
 * @param {string} sound 选中的声音名
 * @returns {Array<[string, string[]]>}
 */
export function commandFor(cue, sound) {
  if (sound === SILENT) return []
  const custom = Object.hasOwn(CUSTOM_SOUNDS, sound) ? CUSTOM_SOUNDS[sound] : undefined
  if (custom !== undefined) return fileCommands(custom)
  if (process.platform === 'darwin') {
    const name = SYSTEM_SOUNDS.includes(sound) ? sound : DEFAULT_SOUND[cue]
    if (name === SILENT) return []
    // 默认音也可能是插件自带的音频（手动终止默认 `ikun`），不能拼系统声音路径。
    const fallbackFile = Object.hasOwn(CUSTOM_SOUNDS, name) ? CUSTOM_SOUNDS[name] : undefined
    if (fallbackFile !== undefined) return fileCommands(fallbackFile)
    return [['afplay', [`/System/Library/Sounds/${name}.aiff`]]]
  }
  return PLATFORM_COMMANDS[process.platform]?.[cue] ?? PLATFORM_COMMANDS.linux[cue]
}

/**
 * 这个声音名能不能播放：自带音频的键，或 macOS 系统声音名。
 *
 * 试听路由用它挡住任意字符串：浏览器一半发什么就播什么是注入面。用
 * `Object.hasOwn` 而不是 `in`，否则 `toString` 之类的原型链键会被当成候选。
 *
 * @param {unknown} sound
 * @returns {boolean}
 */
export function isPlayableSound(sound) {
  if (typeof sound !== 'string' || sound === SILENT) return false
  return Object.hasOwn(CUSTOM_SOUNDS, sound) || SYSTEM_SOUNDS.includes(sound)
}
