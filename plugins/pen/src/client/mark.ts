/**
 * 会话标题右侧的「Pen MCP」标记：标识这条会话已开启 Pen。
 *
 * 插槽 `conversation.session.header.actions` 紧挨在标题之后、官方工具按钮之前，
 * 是「标题右侧」这个位置。标记只在**该会话**开启 Pen 时出现；插件没启用时
 * 浏览器一半根本不会加载，所以「插件开着」这条不需要额外判断。
 *
 * 显示成一行普通文字（Pen 笔尖描边图标 + 品牌名），不做胶囊、不加悬浮提示：
 * 它只回答「这条会话开没开 Pen」。图标是内联 SVG，跟随主题文字颜色。
 *
 * 会话进行中还能用 `/pen` 与 `/pen off` 命令切换，所以状态不再是「挂载后不
 * 变」：每条命令都会在会话里留下 `command/run`、`command/done` 事件，标记借
 * 标准插槽 prop `useChat` 观察命令节点，命令一落地就重新读 Host 状态。没有
 * `useChat` 时（例如测试桩）退化成挂载时读一次。
 *
 * @module @buka/dsh-plugin-pen/client/mark
 */

import { h } from '@buka/plugin-ui'
import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'

import type { PenSnapshot } from '../state.ts'
import { readPenState } from './api.ts'
import { MARK_LABEL } from './dictionary.ts'
import { PenLogo } from './logo.ts'

/** 图标高度（像素），与 12px 文字放在一行里。 */
const ICON_SIZE = 14

/** 命令节点的最小形状；只用来认出「最近一条命令」。 */
interface CommandNodeLike {
  readonly kind?: unknown
  readonly data?: { readonly commandId?: unknown; readonly outcome?: unknown } | null
}

/** Chat 快照里本插件要读的最小投影。 */
export interface PenChatSnapshotLike {
  readonly legacy?: { readonly nodes?: readonly CommandNodeLike[] } | null
}

/** 标准插槽 prop `useChat` 的最小形状。 */
export type UseChatLike = <T>(
  selector: (snapshot: PenChatSnapshotLike) => T,
  equal?: (left: T, right: T) => boolean,
) => T

/**
 * 最近一条命令的「身份 + 状态」签名。
 *
 * 从后往前找第一个命令节点即可：普通消息与流式输出都不会改变它，所以标记
 * 不会跟着每个 token 发请求；命令从 `run` 变成 `done` 时签名变化，正好在
 * 切换完成后重新读一次 Host 状态。
 *
 * @param snapshot 当前 Chat 快照
 * @returns 用于判断是否需要重新读 Host 状态的字符串；没有命令时为空
 */
export function penCommandSignature(snapshot: PenChatSnapshotLike): string {
  const nodes = snapshot.legacy?.nodes
  if (!Array.isArray(nodes)) return ''
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind !== 'command') continue
    const done = node.data?.outcome !== undefined && node.data?.outcome !== null
    return `${String(node.data?.commandId ?? index)}:${done ? 'done' : 'run'}`
  }
  return ''
}

/** 标题标记的插槽 props：会话 id 来自框架，`useChat` 是标准 prop。 */
export interface PenMarkProps {
  /** 当前会话；没有时框架不会渲染这个位置。 */
  readonly sessionId?: string | undefined
  /** 标准插槽 prop：观察 Chat 快照，命令结算后触发重新读状态。 */
  readonly useChat?: UseChatLike | undefined
}

/**
 * 渲染标题旁的 Pen MCP 标记；会话没开启 Pen 时不占位置。
 *
 * @param props 会话 id 与 Chat 快照 hook
 * @returns 标记，或 null
 */
export function PenMark({ sessionId, useChat }: PenMarkProps): ReactElement | null {
  // `useChat` 由插槽注入，在组件生命周期内不会变；缺省时（测试桩、不提供
  // Chat 的界面）跳过这个 hook 是安全的。它之后才调用自己的 state hook。
  const signature = useChat === undefined ? '' : useChat(penCommandSignature)
  const [snapshot, setSnapshot] = useState<PenSnapshot | null>(null)

  // 位置随会话切换时重新读；命令结算后 `signature` 变化，同样重新读。
  // 组件卸载后忽略迟到的响应。
  useEffect(() => {
    if (sessionId === undefined) {
      setSnapshot(null)
      return undefined
    }
    let live = true
    void readPenState(sessionId)
      .then((next) => {
        if (live) setSnapshot(next)
      })
      .catch(() => {
        if (live) setSnapshot(null)
      })
    return () => {
      live = false
    }
  }, [sessionId, signature])

  if (sessionId === undefined || snapshot?.enabled !== true) return null

  return h(
    'span',
    { className: 'buka-pen-mark' },
    h(PenLogo, { height: ICON_SIZE, className: 'buka-pen-mark-icon' }),
    MARK_LABEL,
  )
}
