/**
 * 「打工人」页面标题行：返回 / 头像 / 标题 / 重命名、工具栏与详情页签。
 *
 * @module @buka/dsh-plugin-workers/client/components/page-header
 */

import {
  Button,
  IconChevronRightOutlineRegular,
  IconEditOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  SegmentedTabs,
  StateDot,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import type { createDetailActions } from '../actions/detail.ts'
import type { createWorkerActions } from '../actions/workers.ts'
import { renderAvatar } from '../avatar.ts'
import { TABS } from '../constants.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate } from '../types.ts'
import { MountedTag } from './common.ts'

/**
 * 渲染标题行、工具栏与详情页签。
 *
 */
export function PageHeader({
  t,
  state,
  actions,
  detail,
}: {
  t: Translate
  state: WorkersPageState
  actions: ReturnType<typeof createWorkerActions>
  detail: ReturnType<typeof createDetailActions>
}): ReactElement {
  const {
    selectedWorker,
    mutating,
    corrupt,
    list,
    busy,
    tab,
    reload,
    switchTab,
    backToList,
    assistantOnly,
    setAssistantOnly,
  } = state
  const { openCreateDialog, openWorker, revealWorker } = actions
  const { openAvatarDialog, openRenameDialog } = detail
  // 机器人只读：不提供新会话 / 打开目录 / 改名 / 换头像入口。
  const robot = selectedWorker?.driver === 'robot'

  const refreshButton = h(
    Tooltip,
    { label: t('refresh'), side: 'bottom', delayMs: 500, disabled: list.loading },
    h(
      Button,
      {
        variant: 'outline',
        size: 'sm',
        className: 'buka-workers-toolbarButton',
        'aria-label': t('refresh'),
        'aria-busy': list.loading,
        disabled: list.loading || mutating,
        icon: list.loading
          ? h(StateDot, { state: 'ongoing', size: 13 })
          : h(IconRefreshOutlineRegular, { size: 13 }),
        onClick: reload,
      },
      t('refresh'),
    ),
  )

  // 列表视图的筛选：只看带 assistant 标记的打工人（机器人永远不是助理）。
  const filterButton =
    selectedWorker === null
      ? h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workers-toolbarButton',
            'aria-pressed': assistantOnly === true,
            'aria-label': assistantOnly === true ? t('showAllWorkers') : t('filterAssistants'),
            disabled: mutating,
            onClick: () => setAssistantOnly(assistantOnly !== true),
          },
          assistantOnly === true ? t('showAllWorkers') : t('filterAssistants'),
        )
      : null

  // 「创建打工人」常驻标题行，「刷新」右侧、同一尺寸；名称在对话框里填。
  const createButton =
    selectedWorker === null
      ? h(
          Button,
          {
            variant: 'primary',
            size: 'sm',
            className: 'buka-workers-toolbarButton',
            icon: h(IconPlusOutlineRegular, { size: 13 }),
            'aria-label': t('create'),
            disabled: mutating || corrupt,
            onClick: openCreateDialog,
          },
          t('create'),
        )
      : null

  const detailActions =
    selectedWorker === null || robot
      ? null
      : [
          h(
            Button,
            {
              key: 'open',
              variant: 'outline',
              size: 'sm',
              className: 'buka-workers-toolbarButton',
              icon: h(IconNewChatOutlineRegular, { size: 13 }),
              disabled: mutating,
              'aria-label': `${t('newSession')} ${selectedWorker.name}`,
              onClick: () => openWorker(selectedWorker),
            },
            t('newSession'),
          ),
          h(
            Button,
            {
              key: 'reveal',
              variant: 'outline',
              size: 'sm',
              className: 'buka-workers-toolbarButton',
              icon:
                busy === `reveal:${selectedWorker.name}`
                  ? h(StateDot, { state: 'ongoing', size: 13 })
                  : h(IconFolderOpenOutlineRegular, { size: 13 }),
              disabled: mutating || selectedWorker.exists === false,
              'aria-label': `${t('reveal')} ${selectedWorker.name}`,
              onClick: () => revealWorker(selectedWorker),
            },
            t('reveal'),
          ),
        ]

  return h(
    'div',
    { className: 'buka-workers-head' },
    h(
      'div',
      { className: 'buka-workers-headInner' },
      h(
        'div',
        { className: 'buka-workers-heading' },
        h(
          'div',
          { className: 'buka-workers-headingRow' },
          selectedWorker === null
            ? null
            : h(
                Tooltip,
                { label: t('back'), side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workers-iconButton buka-workers-back buka-workers-backButton',
                    'aria-label': t('back'),
                    disabled: mutating,
                    onClick: backToList,
                  },
                  h(IconChevronRightOutlineRegular, { size: 16 }),
                ),
              ),
          selectedWorker === null || robot
            ? null
            : h(
                Tooltip,
                { label: t('changeAvatar'), side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workers-avatarButton',
                    'aria-label': `${t('changeAvatar')} ${selectedWorker.name}`,
                    disabled: mutating,
                    onClick: () => openAvatarDialog(selectedWorker),
                  },
                  renderAvatar(selectedWorker.avatar, 32),
                ),
              ),
          h(
            'h1',
            { className: 'buka-workers-title' },
            selectedWorker === null ? t('title') : String(selectedWorker.name ?? ''),
          ),
          // 重命名入口紧挨打工人名：改名会移动目录并重建工作区（旧会话不再
          // 列在这个打工人下），登记文件损坏、目录缺失或写操作进行中时禁用。
          selectedWorker === null || robot
            ? null
            : h(
                Tooltip,
                { label: `${t('renameLabel')} ${selectedWorker.name}`, side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workers-iconButton',
                    'aria-label': `${t('renameLabel')} ${selectedWorker.name}`,
                    disabled: mutating || corrupt || selectedWorker.exists === false,
                    onClick: openRenameDialog,
                  },
                  h(IconEditOutlineRegular, { size: 16 }),
                ),
              ),
          selectedWorker === null
            ? null
            : h(
                'span',
                { className: 'buka-workers-headingTag' },
                robot
                  ? h(Tag, { tone: 'info' }, t('driverRobot'))
                  : h(MountedTag, { t, worker: selectedWorker }),
                selectedWorker.assistant === true
                  ? h(Tag, { tone: 'success' }, t('assistantBadge'))
                  : null,
              ),
        ),
      ),
      h(
        'div',
        { className: 'buka-workers-toolbar' },
        detailActions,
        filterButton,
        refreshButton,
        createButton,
      ),
      selectedWorker === null
        ? null
        : h(
            'div',
            { className: 'buka-workers-tabs' },
            h(SegmentedTabs, {
              size: 'sm',
              className: 'buka-workers-tabList',
              label: t('tabsLabel'),
              value: tab,
              onChange: switchTab,
              items: [
                {
                  value: TABS[0].value,
                  label: t('tabDescription'),
                  id: TABS[0].id,
                  panelId: TABS[0].panelId,
                },
                {
                  value: TABS[1].value,
                  label: t('tabModel'),
                  id: TABS[1].id,
                  panelId: TABS[1].panelId,
                },
                {
                  value: TABS[2].value,
                  label: t('tabAgents'),
                  id: TABS[2].id,
                  panelId: TABS[2].panelId,
                },
                {
                  value: TABS[3].value,
                  label: t('tabSkills'),
                  id: TABS[3].id,
                  panelId: TABS[3].panelId,
                },
              ],
            }),
          ),
    ),
  )
}
