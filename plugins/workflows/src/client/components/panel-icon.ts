/**
 * 侧边栏图标：两个节点与一条连接线。
 */

import type React from 'react'

import { h } from '../element.ts'

/**
 * 侧边栏图标：两个节点与一条连接线。
 *
 * @param props
 * @returns React 元素
 */
export function WorkflowsPanelIcon({ size }: { size: number }): React.ReactElement {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': true,
    },
    h('rect', {
      x: 2,
      y: 3,
      width: 4.4,
      height: 4.4,
      rx: 1.4,
      stroke: 'currentColor',
      strokeWidth: 1.2,
    }),
    h('rect', {
      x: 9.6,
      y: 8.6,
      width: 4.4,
      height: 4.4,
      rx: 1.4,
      stroke: 'currentColor',
      strokeWidth: 1.2,
    }),
    h('path', {
      d: 'M6.4 5.2h2.2a2 2 0 0 1 2 2v1.4',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
    }),
  )
}
