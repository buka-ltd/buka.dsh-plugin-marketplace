/**
 * 右侧抽屉的头部：标题、meta、可选操作与关闭按钮。
 */

import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import { h, withAria } from '../element.ts'
import type { PageContext } from '../page-context.ts'

/**
 * 右侧抽屉的头部：标题、meta、可选操作与关闭按钮。附件预览 / 连线配置共用。
 *
 * @param options 抽屉头部内容
 * @returns React 元素
 */
export function renderDrawerHead(
  _page: PageContext,
  options: {
    title: string
    meta?: string | undefined
    icon?: React.ReactNode
    actions?: React.ReactNode[]
    closeLabel: string
    onClose: () => void
  },
): React.ReactElement {
  const meta = typeof options.meta === 'string' ? options.meta : ''
  const actions = Array.isArray(options.actions) ? options.actions : []
  return h(
    'div',
    { className: 'buka-workflows-drawerHead' },
    h(
      'div',
      { className: 'buka-workflows-drawerTitleRow' },
      options.icon ?? null,
      h('span', { className: 'buka-workflows-drawerTitle' }, options.title),
    ),
    meta === '' ? null : h('span', { className: 'buka-workflows-drawerMeta' }, meta),
    h(
      'div',
      { className: 'buka-workflows-drawerActions' },
      ...actions,
      h(
        'button',
        {
          type: 'button',
          className: 'buka-workflows-drawerClose',
          'aria-label': options.closeLabel,
          title: options.closeLabel,
          onClick: options.onClose,
        },
        typeof IconCloseOutlineRegular === 'function'
          ? h(IconCloseOutlineRegular, withAria({ size: 16, 'aria-hidden': true }))
          : null,
      ),
    ),
  )
}
