/**
 * 会话标题右侧的「Pen MCP」标记：标识这条会话已开启 Pen。
 *
 * 插槽 `conversation.session.header.actions` 紧挨在标题之后、官方工具按钮之前，
 * 是「标题右侧」这个位置。标记只在**该会话**勾选过 Pen 时出现；插件没启用时
 * 浏览器一半根本不会加载，所以「插件开着」这条不需要额外判断。
 *
 * 显示成一行普通文字（官方描边图标 + 品牌名），不做胶囊、不加悬浮提示：它只
 * 回答「这条会话开没开 Pen」。勾选只发生在空会话，会话开始后勾选框不再出现，
 * 所以状态不会在标记挂载后再变，读一次 Host 状态就够了。
 *
 * @module @buka/dsh-plugin-pen/client/mark
 */

import { h } from '@buka/plugin-ui'
import { IconListPenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'

import type { PenSnapshot } from '../state.ts'
import { readPenState } from './api.ts'
import { MARK_LABEL } from './dictionary.ts'

/** 图标边长（像素），与 12px 文字放在一行里。 */
const ICON_SIZE = 14

/** 标题标记的插槽 props：会话 id 来自框架。 */
export interface PenMarkProps {
  /** 当前会话；没有时框架不会渲染这个位置。 */
  readonly sessionId?: string | undefined
}

/**
 * 渲染标题旁的 Pen MCP 标记；会话没开启 Pen 时不占位置。
 *
 * @param props 会话 id
 * @returns 标记，或 null
 */
export function PenMark({ sessionId }: PenMarkProps): ReactElement | null {
  const [snapshot, setSnapshot] = useState<PenSnapshot | null>(null)

  // 位置随会话切换时重新读；组件卸载后忽略迟到的响应。
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
  }, [sessionId])

  if (sessionId === undefined || snapshot?.enabled !== true) return null

  return h(
    'span',
    { className: 'buka-pen-mark' },
    h(IconListPenOutlineRegular, { size: ICON_SIZE, className: 'buka-pen-mark-icon' }),
    MARK_LABEL,
  )
}
