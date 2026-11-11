/**
 * 侧边栏的图标。
 *
 * 复用基座自带的 skill 图标（文档 + 星芒），与 DSH 自己的 skill 界面
 * 保持同一套图形；侧边栏只给尺寸与选中态，颜色通过 `currentColor`
 * 继承面板行的前景色，不自己写死颜色。
 *
 * @module @buka/dsh-plugin-skills/client/components/panel-icon
 */

import type { ReactElement } from 'react'

import { h, IconSkillOutlineRegular } from '../primitives.ts'

/**
 * 侧边栏的图标。
 *
 * @param props 侧边栏的图标入参
 */
function SkillsPanelIcon({
  size,
}: {
  readonly size: number
  readonly active?: boolean
}): ReactElement {
  return h(IconSkillOutlineRegular, { size })
}

export { SkillsPanelIcon }
