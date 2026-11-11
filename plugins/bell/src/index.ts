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
 * 播放交给宿主系统的声音工具（macOS `afplay`、Windows `SystemSounds`、
 * Linux `paplay` 等），不占用 DSH 自己的 UI 与音频权限。系统声音之外，
 * 插件还自带一个梗语音文件作为候选（`CUSTOM_SOUNDS`），它由能解码文件的
 * 播放器播放，不走系统声音表。
 *
 * 声音选择放在插件 Config 的 volatile 字段里：设置页写入时 Loader 不重载
 * 插件，只更新配置引用。四种提示音都可以选「无」（配置值 `none`），表示
 * 这个时机不播放。
 *
 * 试听与选择是分开的两步：设置页先列出所有候选，点一下只播放一次
 * （`POST /buka-bell/preview`，不写配置），听完再在列表里决定四个时机
 * 各用哪个。路由沿用 web 组合的信任栅栏，只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-bell
 */

import type { Context } from '@deepseek-ai/cordis'
// 下面四个包只引入类型：它们把这些生命周期事件与服务增强到 cordis 的 Context 上，
// 运行时由 DSH 自己提供，插件不打包它们。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-remotes'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-questions'
import z from '@deepseek-ai/schemastery'
import type { VolatileString } from '../../../types/dsh.js'
import { createPlayer } from './player.ts'
import { registerPreviewRoutes } from './routes.ts'
import { DEFAULT_SOUND } from './sounds.ts'
import { watch } from './watch.ts'

// 入口原来的公开常量继续可用（文档与单测按入口找它们）。
export { CUSTOM_SOUNDS, SILENT } from './sounds.ts'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'sound-buka-bell'

/** 依赖的服务：用 `roots()` 判断一个 Agent 是不是运行时顶层会话。 */
export const inject = ['agents']

/**
 * 可在设置页改的四项声音。
 *
 * 只有 `volatile` 字段能被设置页热更新：Loader 把新值写进配置引用并派发
 * `loader/volatile-update`，不会重启插件。
 */
export const Config = z.object({
  /** 任务结束时播放的提示音名：macOS 系统声音名、自带的 `ikun`，或 `none`。 */
  finish: z.string().default(DEFAULT_SOUND.finish).volatile(),
  /** DSH 等待用户回答或审批时播放的提示音名：同上，或 `none`。 */
  wait: z.string().default(DEFAULT_SOUND.wait).volatile(),
  /** 计划评审被用户退回修改时播放的提示音名：同上，或 `none`。 */
  plan: z.string().default(DEFAULT_SOUND.plan).volatile(),
  /** 用户手动终止任务时播放的提示音名：同上，或 `none`。 */
  abort: z.string().default(DEFAULT_SOUND.abort).volatile(),
})

/** Host 解析后的配置形状；四个字段都是可热更新的引用。 */
export interface BellConfig {
  readonly finish: VolatileString
  readonly wait: VolatileString
  readonly plan: VolatileString
  readonly abort: VolatileString
}

/**
 * 装配提示音插件：创建播放器，注册试听路由与四个时机的监听。
 */
export function apply(ctx: Context, config: BellConfig): void {
  const play = createPlayer(ctx)
  registerPreviewRoutes(ctx, play)
  watch(ctx, config, play)
}
