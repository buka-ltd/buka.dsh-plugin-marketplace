/**
 * 侧边栏「Skills」页面：标题行、工具栏、两个 Tab 与页脚的 Toast / 对话框。
 *
 * 页面本身只做装配：状态与请求在 `state.ts`，两个面板分别在
 * `components/installed-panel.ts` 与 `components/saved-panel.ts`，
 * 收藏对话框在 `components/save-dialog.ts`。
 *
 * @module @buka/dsh-plugin-skills/client/components/skills-page
 */

import type { ReactElement } from 'react'
import type { PageTab, TabItem } from '../constants.ts'
import { TABS } from '../constants.ts'
import type { Translate } from '../dictionary.ts'
import {
  Button,
  h,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
  SegmentedTabs,
  StateDot,
  Toast,
  Tooltip,
} from '../primitives.ts'
import { useSkillsPageState } from '../state.ts'
import { renderInstalled } from './installed-panel.ts'
import { renderSaveDialog } from './save-dialog.ts'
import { renderSaved } from './saved-panel.ts'

/**
 * 侧边栏「Skills」页面。
 *
 * @param props 插槽注入的文案函数
 */
function SkillsPage(props: { readonly t: Translate }): ReactElement {
  const t = props.t
  const state = useSkillsPageState(t)
  const {
    tab,
    storeCorrupt,
    loading,
    notice,
    setNotice,
    dialogOpen,
    adding,
    source,
    setSource,
    note,
    setNote,
    addError,
    reload,
    openSaveDialog,
    closeSaveDialog,
    addRepo,
    switchTab,
  } = state

  const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0]

  return h(
    'div',
    { className: 'buka-skills-page' },
    h(
      'div',
      { className: 'buka-skills-head' },
      h(
        'div',
        { className: 'buka-skills-headInner' },
        h(
          'div',
          { className: 'buka-skills-heading' },
          h('h1', { className: 'buka-skills-title' }, t('title')),
        ),
        h(
          'div',
          { className: 'buka-skills-toolbar' },
          h(Tooltip, {
            label: t('refresh'),
            side: 'bottom',
            delayMs: 500,
            disabled: loading,
            children: h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                className: 'buka-skills-toolbarButton',
                'aria-label': t('refresh'),
                'aria-busy': loading,
                disabled: loading,
                icon: loading
                  ? h(StateDot, { state: 'ongoing', size: 13 })
                  : h(IconRefreshOutlineRegular, { size: 13 }),
                onClick: reload,
              },
              t('refresh'),
            ),
          }),
          // 「收藏」按钮常驻标题行（两个 Tab 都能用）：紧挨「刷新」，两者同一尺寸。
          h(
            Button,
            {
              variant: 'primary',
              size: 'sm',
              className: 'buka-skills-toolbarButton',
              icon: h(IconPlusOutlineRegular, { size: 13 }),
              'aria-label': t('add'),
              disabled: storeCorrupt,
              onClick: openSaveDialog,
            },
            t('add'),
          ),
        ),
        h(
          'div',
          { className: 'buka-skills-tabs' },
          h(SegmentedTabs, {
            size: 'sm',
            className: 'buka-skills-tabList',
            label: t('tabsLabel'),
            value: tab,
            // SegmentedTabs 是泛型组件，createElement 推断不出 Value，退化成
            // `string`；它只会回传 items 里的值，这里按页面 Tab 收窄。
            onChange: (value: string) => switchTab(value as PageTab),
            items: [
              {
                value: TABS[0].value,
                label: t('tabInstalled'),
                id: TABS[0].id,
                panelId: TABS[0].panelId,
              },
              {
                value: TABS[1].value,
                label: t('tabRepos'),
                id: TABS[1].id,
                panelId: TABS[1].panelId,
              },
            ] satisfies readonly [TabItem, ...TabItem[]],
          }),
        ),
      ),
    ),
    h(
      'div',
      { className: 'buka-skills-body' },
      h(
        'div',
        { role: 'tabpanel', id: activeTab.panelId, 'aria-labelledby': activeTab.id },
        tab === 'installed' ? renderInstalled(state) : renderSaved(state),
      ),
    ),
    notice === null
      ? null
      : h(Toast, {
          key: notice.seq,
          text: notice.text,
          ...(notice.kind === 'success' ? { tone: 'success' as const } : {}),
          ...(notice.kind === 'success' ? {} : { icon: h(IconWarningOutlineRegular, {}) }),
          holdMs: 3200,
          onDone: () => setNotice(null),
        }),
    // 「收藏」对话框：仓库必填、备注可选；提交失败留在框里提示，
    // 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
    renderSaveDialog({
      t,
      dialogOpen,
      closeSaveDialog,
      adding,
      source,
      setSource,
      note,
      setNote,
      addError,
      addRepo,
    }),
  )
}

export { SkillsPage }
