/**
 * 页面的固定 id 与 Tab 定义。
 *
 * 侧边栏条目与主面板共用 `PANEL_ID`；两个 Tab 的 id / panelId 是固定的，
 * 页面只挂载一份，不需要 `useId`。
 *
 * @module @buka/dsh-plugin-skills/client/constants
 */

import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'

/** 侧边栏条目与主面板共用的 id：侧边栏注册的 id 必须与 `main` 的 key 相同。 */
const PANEL_ID = 'skills'

/** 收藏对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
const SAVE_FORM_ID = 'skills-save-form'

/**
 * Tab 与对应面板的固定 id（页面只挂载一份，不需要 `useId`）。
 *
 * 「技能仓库」在前、默认选中；「全局技能」列出已安装的 skill。
 */
const TABS = [
  {
    value: 'repos',
    labelKey: 'tabRepos',
    id: 'skills-tab-repos',
    panelId: 'skills-panel-repos',
  },
  {
    value: 'installed',
    labelKey: 'tabInstalled',
    id: 'skills-tab-installed',
    panelId: 'skills-panel-installed',
  },
] as const

/** 页面 Tab 的取值。 */
type PageTab = (typeof TABS)[number]['value']

/** SegmentedTabs 的 items：显式标注泛型，才不会退化成 `string`。 */
type TabItem = SegmentedTab<PageTab>

export type { PageTab, TabItem }
export { PANEL_ID, SAVE_FORM_ID, TABS }
