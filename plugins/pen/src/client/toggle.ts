/**
 * 新会话行右上角的「Pen」勾选框。
 *
 * 插槽 `conversation.hero.options` 只在有会话（包括还没发消息的空会话）时
 * 渲染，正好是用户决定「这条会话要不要 pen」的位置。勾选状态存在 Host：
 * 组件挂载时读一次，点击时写一次；写操作返回的新快照直接替换本地状态。
 *
 * 可见文字固定为 `{logo} Pen`：前面是内联的 Pen 标记，后面是品牌名，不做
 * 翻译；tooltip 才随界面语言切换。
 *
 * 勾选时 Agent 往往还没创建（空会话），Host 会记住会话 id，等
 * `agent/created` 再挂载 MCP；所以这里显示 `pending` 是正常状态，不是失败。
 *
 * @module @buka/dsh-plugin-pen/client/toggle
 */

import { h, messageOf } from '@buka/plugin-ui'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangeEvent, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import type { PenSnapshot, PenStatus } from '../state.ts'

import { readPenState, setPenEnabled } from './api.ts'
import type { PenKey } from './dictionary.ts'
import { LABEL } from './dictionary.ts'
import { PEN_LOGO } from './logo.ts'

/** 勾选框的插槽 props：会话 id 来自框架，`t` 来自注册时的 `locale`。 */
export interface PenToggleProps {
  /** 当前会话；空会话也有 id，它是之后创建 Agent 用的身份。 */
  readonly sessionId?: string | undefined
  /** 当前界面语言的翻译函数。 */
  readonly t: (key: PenKey) => string
}

/** 根据状态给出 tooltip。 */
function hintOf(status: PenStatus, snapshot: PenSnapshot | null, t: PenToggleProps['t']): string {
  if (status === 'error') {
    const message = snapshot?.message ?? ''
    return message === '' ? t('hintFailed') : `${t('hintFailed')} ${message}`
  }
  if (snapshot?.enabled !== true) return t('hint')
  if (status === 'ready') return t('hintReady')
  if (status === 'connecting') return t('hintConnecting')
  return t('hintPending')
}

/**
 * 渲染勾选框；没有会话 id 时不显示。
 *
 * @param props 会话 id 与翻译函数
 * @returns 勾选框，或 null
 */
export function PenToggle({ sessionId, t }: PenToggleProps): ReactElement | null {
  const [snapshot, setSnapshot] = useState<PenSnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  // 位置随会话切换时重新读；组件卸载后忽略迟到的响应。
  useEffect(() => {
    if (sessionId === undefined) return undefined
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

  if (sessionId === undefined) return null

  const enabled = snapshot?.enabled === true
  const status: PenStatus = busy ? 'connecting' : (snapshot?.status ?? 'idle')
  const hint = hintOf(status, snapshot, t)

  const change = (event: ChangeEvent<HTMLInputElement>): void => {
    const checked = event.currentTarget.checked
    setBusy(true)
    setSnapshot(
      checked ? { enabled: true, status: 'connecting' } : { enabled: false, status: 'idle' },
    )
    void setPenEnabled(sessionId, checked)
      .then((next) => {
        setSnapshot(next)
      })
      .catch((error: unknown) => {
        // 请求本身失败（不是 MCP 连接失败）：回滚到点击前的状态并说明原因。
        setSnapshot({ enabled: !checked, status: 'error', message: messageOf(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return h(
    'span',
    { className: 'buka-pen-root' },
    h(
      Tooltip,
      { label: hint, side: 'bottom', delayMs: 500 },
      h(
        'label',
        { className: 'buka-pen-toggle', 'data-disabled': busy ? '' : undefined },
        h('input', {
          type: 'checkbox',
          className: 'buka-pen-checkbox',
          checked: enabled,
          disabled: busy,
          onChange: change,
        }),
        h(
          'span',
          { className: 'buka-pen-brand' },
          h('img', {
            className: 'buka-pen-logo',
            src: PEN_LOGO,
            alt: '',
            'aria-hidden': 'true',
            draggable: false,
          }),
          LABEL,
        ),
      ),
    ),
    status === 'error' ? h('span', { className: 'buka-pen-warning' }, '!') : null,
  )
}
