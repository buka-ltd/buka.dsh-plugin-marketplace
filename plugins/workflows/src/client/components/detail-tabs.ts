/**
 * 详情页的下划线页签。
 *
 * 工作流、作业与执行者三个详情页的页内页签都是「同一个对象的几种视图」，
 * 用轻量的下划线式页签比等宽胶囊更像导航：选中态只靠文字颜色、字重与 2px
 * 下划线区分，底部一条 0.5px 分隔线接住内容区，也方便在标签后挂一个表示
 * 「有更新」的小圆点。
 *
 * 样式在 `../styles.ts`（`.buka-workflows-detailTabs` 等），三个详情页共用。
 *
 * 键盘：← / → 循环切换，Home / End 跳到首尾；只有选中项是 Tab 停靠点
 * （与 WAI-ARIA tabs 模式一致）。页面仍自己渲染 `role="tabpanel"` 的面板。
 *
 * @module @buka/dsh-plugin-workflows/client/components/detail-tabs
 */

import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { h } from '../element.ts'

/** 一个页签；`id` / `panelId` 与页面面板的 ARIA 关联一致。 */
export interface DetailTab {
  readonly value: string
  readonly id: string
  readonly panelId: string
  readonly label: ReactNode
  /** 在标签后加一个小圆点（例如「有更新」）。 */
  readonly dot?: boolean
  /** 有圆点时的无障碍名称；不传则按标签文字朗读。 */
  readonly labelWithDot?: string
}

/**
 * 下划线式页签条。
 *
 * @param props.items 非空且值唯一的页签
 * @param props.value 当前选中值（必须属于 `items`）
 * @param props.onChange 点击、← / →、Home / End 触发的切换
 * @param props.label 页签列表的无障碍名称
 */
export function DetailTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly [DetailTab, ...DetailTab[]]
  value: string
  onChange: (value: string) => void
  label: string
}): ReactElement {
  /** 方向键 / Home / End：切换页签并把焦点移到新页签上。 */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.value === value)
    const last = items.length - 1
    let next = -1
    if (event.key === 'ArrowRight') next = index >= last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index <= 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else return
    const target = items[next]
    if (target === undefined) return
    event.preventDefault()
    onChange(target.value)
    const tabs = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')
    tabs[next]?.focus()
  }

  return h(
    'div',
    {
      className: 'buka-workflows-detailTabs',
      role: 'tablist',
      'aria-label': label,
      onKeyDown,
    },
    ...items.map((item) => {
      const selected = item.value === value
      return h(
        'button',
        {
          key: item.value,
          type: 'button',
          role: 'tab',
          id: item.id,
          className: 'buka-workflows-detailTab',
          'aria-selected': selected,
          'aria-controls': item.panelId,
          tabIndex: selected ? 0 : -1,
          ...(item.dot === true && item.labelWithDot !== undefined
            ? { 'aria-label': item.labelWithDot }
            : {}),
          onClick: () => onChange(item.value),
        },
        item.label,
        item.dot === true
          ? h('span', { className: 'buka-workflows-detailTabDot', 'aria-hidden': true })
          : null,
      )
    }),
  )
}
