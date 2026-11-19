/**
 * 页签标签：按选中态字重预留宽度，切换页签时整条页签栏不改宽。
 *
 * `SegmentedTabs` 的列宽由标签的 max-content 决定，选中态把字重从 400 提到
 * 500 / 600 后标签变宽，整条页签栏会跟着变宽（例如「AGENTS.md」比其它页签
 * 长时最明显）。这里把可见文本与一份不可见的加粗副本叠在同一个网格单元里，
 * 列宽始终按加粗副本计算，可见文本的字重怎么变都不影响布局。
 *
 * @module plugin-ui/tab-label
 */

import type { ReactElement } from 'react'
import { h } from './h.ts'

/** 不可见副本的字重：不低于 `SegmentedTabs` 选中态的字重（sm 500、md 600）。 */
const RESERVED_WEIGHT = 600

/**
 * 一个页签标签，宽度已按选中态预留。
 *
 * @param props.text 可见文案
 * @returns 叠了加粗测量副本的标签
 */
export function TabLabel({ text }: { text: string }): ReactElement {
  return h(
    'span',
    { style: { display: 'inline-grid', alignItems: 'center' } },
    h('span', { style: { gridArea: '1 / 1', whiteSpace: 'nowrap' } }, text),
    h(
      'span',
      {
        'aria-hidden': true,
        style: {
          gridArea: '1 / 1',
          whiteSpace: 'nowrap',
          visibility: 'hidden',
          fontWeight: RESERVED_WEIGHT,
        },
      },
      text,
    ),
  )
}
