/**
 * 「执行者」页面标题行：返回 / 头像 / 标题 / 重命名、工具栏与详情页签。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/components/page-header
 */

import { TabLabel } from '@buka/plugin-ui'
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
import type { createSkillActions } from '../actions/skills.ts'
import type { createWorkerActions } from '../actions/workers.ts'
import { workerDisplayName, workerIdentityLabel } from '../api.ts'
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
  skillActions,
  topTabs,
}: {
  topTabs?: React.ReactElement
  t: Translate
  state: WorkersPageState
  actions: ReturnType<typeof createWorkerActions>
  detail: ReturnType<typeof createDetailActions>
  skillActions: ReturnType<typeof createSkillActions>
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
    updatingAllSkills,
  } = state
  const { openCreateDialog, openWorker, revealWorker } = actions
  const { updateAllWorkers } = skillActions
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

  // 列表页的「更新全部执行者」：只对智能体、目录存在且有 skill 的 worker
  // 顺序执行；单个失败不中断，结果由 Host 汇总。
  const updateAllButton =
    selectedWorker === null
      ? h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workers-toolbarButton',
            icon: updatingAllSkills
              ? h(StateDot, { state: 'ongoing', size: 13 })
              : h(IconRefreshOutlineRegular, { size: 13 }),
            disabled: mutating || corrupt || updatingAllSkills,
            onClick: () => updateAllWorkers(),
          },
          updatingAllSkills ? t('updatingAllWorkers') : t('updateAllWorkers'),
        )
      : null

  // 「创建执行者」常驻标题行，「刷新」右侧、同一尺寸；名称在对话框里填。
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
              'aria-label': `${t('newSession')} ${workerDisplayName(selectedWorker)}`,
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
                busy === `reveal:${selectedWorker.id}`
                  ? h(StateDot, { state: 'ongoing', size: 13 })
                  : h(IconFolderOpenOutlineRegular, { size: 13 }),
              disabled: mutating || selectedWorker.exists === false,
              'aria-label': `${t('reveal')} ${workerDisplayName(selectedWorker)}`,
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
        { className: 'buka-workers-bar' },
        h('div', { className: 'buka-workers-barTabs' }, topTabs),
        h(
          'div',
          { className: 'buka-workers-toolbar' },
          detailActions,
          updateAllButton,
          refreshButton,
          createButton,
        ),
      ),
      selectedWorker === null
        ? // 列表页没有标题行：顶部页签就是这一屏的标题，操作按钮在页签带右侧。
          null
        : h(
            'div',
            { className: 'buka-workers-titleRow' },
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
                          className:
                            'buka-workers-iconButton buka-workers-back buka-workers-backButton',
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
                          'aria-label': `${t('changeAvatar')} ${workerDisplayName(selectedWorker)}`,
                          disabled: mutating,
                          onClick: () => openAvatarDialog(selectedWorker),
                        },
                        renderAvatar(selectedWorker.avatar, 32),
                      ),
                    ),
                h(
                  'h1',
                  { className: 'buka-workers-title' },
                  selectedWorker === null ? t('title') : workerIdentityLabel(selectedWorker),
                ),
                // 重命名入口紧挨执行者标题：只改展示名，目录与工作区注册不变；
                // 登记文件损坏或写操作进行中时禁用（目录缺失不影响改展示名）。
                selectedWorker === null || robot
                  ? null
                  : h(
                      Tooltip,
                      {
                        label: `${t('renameLabel')} ${workerDisplayName(selectedWorker)}`,
                        side: 'top',
                        delayMs: 400,
                      },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'buka-workers-iconButton',
                          'aria-label': `${t('renameLabel')} ${workerDisplayName(selectedWorker)}`,
                          disabled: mutating || corrupt,
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
                    ),
              ),
            ),
            h(
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
                    label: h(TabLabel, { text: t('tabSettings') }),
                    id: TABS[0].id,
                    panelId: TABS[0].panelId,
                  },
                  {
                    value: TABS[1].value,
                    label: h(TabLabel, { text: t('tabFiles') }),
                    id: TABS[1].id,
                    panelId: TABS[1].panelId,
                  },
                  {
                    value: TABS[2].value,
                    label: h(TabLabel, { text: t('tabSkills') }),
                    id: TABS[2].id,
                    panelId: TABS[2].panelId,
                  },
                ],
              }),
            ),
          ),
    ),
  )
}
