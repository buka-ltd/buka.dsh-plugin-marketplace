/**
 * 详情页底部的图例与说明。
 */

import type React from 'react'
import { h } from '../element.ts'
import type { PageContext } from '../page-context.ts'

/**
 * 详情页底部的图例与说明。它固定占据页面底部，不跟内容一起滚动，内容再长
 * 也不会把它顶下去。模板页没有执行状态，传入 false 省掉「节点状态」图例，
 * 连线图例也换成单一「流程走向」。
 *
 * @param [withStates]
 * @returns React 元素
 */
export function renderFooter(page: PageContext, withStates = true): React.ReactElement {
  const { t, renderLegend } = page

  return h(
    'footer',
    { className: 'buka-workflows-footer' },
    h('p', { className: 'buka-workflows-hint' }, t('graphInteractHint')),
    renderLegend({ states: withStates }),
  )
}
