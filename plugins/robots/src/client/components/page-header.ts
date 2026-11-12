/**
 * 「机器人」页面标题行：返回 / 头像 / 标题 / 重命名、工具栏与详情页签。
 *
 * @module @buka/dsh-plugin-robots/client/components/page-header
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
import type { createRobotActions } from '../actions/robots.ts'
import { renderAvatar } from '../avatar.ts'
import { TABS } from '../constants.ts'
import { h } from '../h.ts'
import type { RobotsPageState } from '../state.ts'
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
  state: RobotsPageState
  actions: ReturnType<typeof createRobotActions>
  detail: ReturnType<typeof createDetailActions>
}): ReactElement {
  const {
    selectedRobot,
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
  const { openCreateDialog, openRobot, revealRobot } = actions
  const { openAvatarDialog, openRenameDialog } = detail
  // program 型机器人只读：不提供新会话 / 打开目录 / 改名 / 换头像入口。
  const program = selectedRobot?.driver === 'program'

  const refreshButton = h(
    Tooltip,
    { label: t('refresh'), side: 'bottom', delayMs: 500, disabled: list.loading },
    h(
      Button,
      {
        variant: 'outline',
        size: 'sm',
        className: 'buka-robots-toolbarButton',
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

  // 列表视图的筛选：只看带 assistant 标记的机器人（program 型永远不是助理）。
  const filterButton =
    selectedRobot === null
      ? h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-robots-toolbarButton',
            'aria-pressed': assistantOnly === true,
            'aria-label': assistantOnly === true ? t('showAllRobots') : t('filterAssistants'),
            disabled: mutating,
            onClick: () => setAssistantOnly(assistantOnly !== true),
          },
          assistantOnly === true ? t('showAllRobots') : t('filterAssistants'),
        )
      : null

  // 「创建机器人」常驻标题行，「刷新」右侧、同一尺寸；名称在对话框里填。
  const createButton =
    selectedRobot === null
      ? h(
          Button,
          {
            variant: 'primary',
            size: 'sm',
            className: 'buka-robots-toolbarButton',
            icon: h(IconPlusOutlineRegular, { size: 13 }),
            'aria-label': t('create'),
            disabled: mutating || corrupt,
            onClick: openCreateDialog,
          },
          t('create'),
        )
      : null

  const detailActions =
    selectedRobot === null || program
      ? null
      : [
          h(
            Button,
            {
              key: 'open',
              variant: 'outline',
              size: 'sm',
              className: 'buka-robots-toolbarButton',
              icon: h(IconNewChatOutlineRegular, { size: 13 }),
              disabled: mutating,
              'aria-label': `${t('newSession')} ${selectedRobot.name}`,
              onClick: () => openRobot(selectedRobot),
            },
            t('newSession'),
          ),
          h(
            Button,
            {
              key: 'reveal',
              variant: 'outline',
              size: 'sm',
              className: 'buka-robots-toolbarButton',
              icon:
                busy === `reveal:${selectedRobot.name}`
                  ? h(StateDot, { state: 'ongoing', size: 13 })
                  : h(IconFolderOpenOutlineRegular, { size: 13 }),
              disabled: mutating || selectedRobot.exists === false,
              'aria-label': `${t('reveal')} ${selectedRobot.name}`,
              onClick: () => revealRobot(selectedRobot),
            },
            t('reveal'),
          ),
        ]

  return h(
    'div',
    { className: 'buka-robots-head' },
    h(
      'div',
      { className: 'buka-robots-headInner' },
      h(
        'div',
        { className: 'buka-robots-heading' },
        h(
          'div',
          { className: 'buka-robots-headingRow' },
          selectedRobot === null
            ? null
            : h(
                Tooltip,
                { label: t('back'), side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-robots-iconButton buka-robots-back buka-robots-backButton',
                    'aria-label': t('back'),
                    disabled: mutating,
                    onClick: backToList,
                  },
                  h(IconChevronRightOutlineRegular, { size: 16 }),
                ),
              ),
          selectedRobot === null || program
            ? null
            : h(
                Tooltip,
                { label: t('changeAvatar'), side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-robots-avatarButton',
                    'aria-label': `${t('changeAvatar')} ${selectedRobot.name}`,
                    disabled: mutating,
                    onClick: () => openAvatarDialog(selectedRobot),
                  },
                  renderAvatar(selectedRobot.avatar, 32),
                ),
              ),
          h(
            'h1',
            { className: 'buka-robots-title' },
            selectedRobot === null ? t('title') : String(selectedRobot.name ?? ''),
          ),
          // 重命名入口紧挨机器人名：改名会移动目录并重建工作区（旧会话不再
          // 列在这个机器人下），登记文件损坏、目录缺失或写操作进行中时禁用。
          selectedRobot === null || program
            ? null
            : h(
                Tooltip,
                { label: `${t('renameLabel')} ${selectedRobot.name}`, side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-robots-iconButton',
                    'aria-label': `${t('renameLabel')} ${selectedRobot.name}`,
                    disabled: mutating || corrupt || selectedRobot.exists === false,
                    onClick: openRenameDialog,
                  },
                  h(IconEditOutlineRegular, { size: 16 }),
                ),
              ),
          selectedRobot === null
            ? null
            : h(
                'span',
                { className: 'buka-robots-headingTag' },
                program
                  ? h(Tag, { tone: 'info' }, t('driverProgram'))
                  : h(MountedTag, { t, robot: selectedRobot }),
                selectedRobot.assistant === true
                  ? h(Tag, { tone: 'success' }, t('assistantBadge'))
                  : null,
              ),
        ),
      ),
      h(
        'div',
        { className: 'buka-robots-toolbar' },
        detailActions,
        filterButton,
        refreshButton,
        createButton,
      ),
      selectedRobot === null
        ? null
        : h(
            'div',
            { className: 'buka-robots-tabs' },
            h(SegmentedTabs, {
              size: 'sm',
              className: 'buka-robots-tabList',
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
                  label: t('tabAgents'),
                  id: TABS[1].id,
                  panelId: TABS[1].panelId,
                },
                {
                  value: TABS[2].value,
                  label: t('tabSkills'),
                  id: TABS[2].id,
                  panelId: TABS[2].panelId,
                },
              ],
            }),
          ),
    ),
  )
}
