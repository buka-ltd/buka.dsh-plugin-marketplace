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
const PANEL_ID = 'buka-skills'

/** 收藏对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
const SAVE_FORM_ID = 'buka-skills-save-form'

/** Tab 与对应面板的固定 id（页面只挂载一份，不需要 `useId`）。 */
const TABS = [
  { value: 'installed', id: 'buka-skills-tab-installed', panelId: 'buka-skills-panel-installed' },
  { value: 'repos', id: 'buka-skills-tab-repos', panelId: 'buka-skills-panel-repos' },
] as const

/** 页面 Tab 的取值。 */
type PageTab = (typeof TABS)[number]['value']

/** SegmentedTabs 的 items：显式标注泛型，才不会退化成 `string`。 */
type TabItem = SegmentedTab<PageTab>

export type { PageTab, TabItem }
export { PANEL_ID, SAVE_FORM_ID, TABS }
