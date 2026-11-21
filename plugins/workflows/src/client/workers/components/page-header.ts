/**
 * 「执行者」页面标题行：返回 / 头像 / 标题 / 重命名、工具栏与详情页签。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/components/page-header
 */

import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  Menu,
  StateDot,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import React from 'react'
import { DetailTabs } from '../../components/detail-tabs.ts'
import type { createDetailActions } from '../actions/detail.ts'
import type { createSkillActions } from '../actions/skills.ts'
import type { createWorkerActions } from '../actions/workers.ts'
import { workerDisplayName, workerIdentityLabel } from '../api.ts'
import { renderAvatar } from '../avatar.ts'
import { OPEN_IN_APP_ICON_ROUTE, TABS } from '../constants.ts'
import { h } from '../h.ts'
import { openInAppLabel } from '../open-in-app.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate } from '../types.ts'
import { MountedTag } from './common.ts'

/**
 * 菜单里的一个应用图标；图标路由不可用时退回文件夹图标。
 */
function AppIcon({ id, size = 14 }: { id: string; size?: number }): ReactElement {
  const [failed, setFailed] = React.useState(false)
  if (failed) return h(IconFolderOpenOutlineRegular, { size })
  return h('img', {
    className: 'buka-workers-appIcon',
    src: `${OPEN_IN_APP_ICON_ROUTE}/${encodeURIComponent(id)}`,
    width: size,
    height: size,
    alt: '',
    draggable: false,
    onError: () => setFailed(true),
  })
}

/**
 * 「用应用打开」分体按钮：主按钮用上次选中的应用打开目录，右侧箭头选择
 * 其它应用。应用清单来自 DSH 内核的 open-in-app，清单不可用时页面显示原来的
 * Finder 按钮。
 */
function OpenWithButton({
  t,
  apps,
  preferred,
  busy,
  disabled,
  onSelect,
}: {
  t: Translate
  apps: readonly string[]
  preferred: string
  busy: boolean
  disabled: boolean
  onSelect: (appId: string) => void
}): ReactElement {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const appName = openInAppLabel(preferred, t)
  const label = t('openInApp').replace('{app}', appName)
  return h(Menu, {
    open: menuOpen,
    className: 'buka-workers-openAnchor',
    align: 'end',
    portal: true,
    dense: true,
    selectedId: preferred,
    items: apps.map((id) => ({
      id,
      icon: h(AppIcon, { id }),
      label: openInAppLabel(id, t),
    })),
    onSelect: (id: string) => {
      setMenuOpen(false)
      onSelect(id)
    },
    onClose: () => setMenuOpen(false),
    anchor: h(
      'div',
      { className: 'buka-workers-openSplit' },
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          className: 'buka-workers-toolbarButton buka-workers-openMain',
          icon: busy
            ? h(StateDot, { state: 'ongoing', size: 13 })
            : h(AppIcon, { id: preferred, size: 14 }),
          disabled,
          'aria-label': label,
          onClick: () => onSelect(preferred),
        },
        appName,
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'buka-workers-openMore',
          'aria-label': t('openWithChoose'),
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen,
          disabled,
          onClick: () => setMenuOpen((open) => !open),
        },
        h(IconChevronDownOutlineRegular, { size: 12 }),
      ),
    ),
  })
}

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
    skillChecks,
    openInApp,
    openInAppChoice,
    reload,
    switchTab,
    backToList,
    updatingAllSkills,
  } = state
  const { openCreateDialog, openWorker, openWorkerWith, revealWorker } = actions
  const { updateAllWorkers, openInstallDialog } = skillActions
  const { openAvatarDialog } = detail
  // 机器人只读：不提供新会话 / 打开目录 / 换头像入口。
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
      : h(
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
        )

  // 「打开」：优先用 DSH 内置 open-in-app 的分体按钮（应用可选），清单不可用
  // 时退回原来的 Finder 按钮。
  const opening = selectedWorker !== null && busy === `reveal:${selectedWorker.id}`
  const openInReady = openInApp.status === 'ready' && openInApp.apps.length > 0
  const preferredApp = openInReady
    ? openInApp.apps.includes(openInAppChoice)
      ? openInAppChoice
      : openInApp.apps[0]
    : ''
  const openButton =
    selectedWorker === null || robot
      ? null
      : openInReady && preferredApp !== undefined && preferredApp !== ''
        ? h(OpenWithButton, {
            t,
            apps: openInApp.apps,
            preferred: preferredApp,
            busy: opening,
            disabled: mutating || selectedWorker.exists === false,
            onSelect: (appId: string) => void openWorkerWith(selectedWorker, appId),
          })
        : h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workers-toolbarButton',
              icon: opening
                ? h(StateDot, { state: 'ongoing', size: 13 })
                : h(IconFolderOpenOutlineRegular, { size: 13 }),
              disabled: mutating || selectedWorker.exists === false,
              'aria-label': `${t('reveal')} ${workerDisplayName(selectedWorker)}`,
              onClick: () => revealWorker(selectedWorker),
            },
            t('reveal'),
          )

  // 详情页右上角的「安装 skills」：新会话 / 打开目录 / 刷新之后，作为这一屏
  // 的主操作放在最右；安装对话框仍由 skills 动作管理。
  const installButton =
    selectedWorker === null || robot
      ? null
      : h(
          Button,
          {
            variant: 'primary',
            size: 'sm',
            className: 'buka-workers-toolbarButton',
            icon: h(IconPlusOutlineRegular, { size: 13 }),
            disabled: mutating || corrupt || selectedWorker.exists === false,
            onClick: openInstallDialog,
          },
          t('installSkills'),
        )

  const toolbarNode = h(
    'div',
    { className: 'buka-workers-toolbar' },
    detailActions,
    openButton,
    updateAllButton,
    refreshButton,
    createButton,
    installButton,
  )

  const heading =
    selectedWorker === null
      ? null
      : h(
          'div',
          { className: 'buka-workers-heading' },
          h(
            'div',
            { className: 'buka-workers-headingRow' },
            h(
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
            robot
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
            h('h1', { className: 'buka-workers-title' }, workerIdentityLabel(selectedWorker)),
            h(
              'span',
              { className: 'buka-workers-headingTag' },
              robot
                ? h(Tag, { tone: 'info' }, t('driverRobot'))
                : h(MountedTag, { t, worker: selectedWorker }),
            ),
          ),
        )

  // 详情页内是同一个对象的三种视图：用下划线页签而不是胶囊分段控件。
  // 「技能」上的小圆点来自进入详情页时的自动检查，没点进页签也能看到有更新。
  const skillUpdates =
    selectedWorker !== null &&
    skillChecks.workerId === selectedWorker.id &&
    Object.values(skillChecks.results).some((entry) => entry.status === 'update')
  const tabsNode = h(DetailTabs, {
    label: t('tabsLabel'),
    value: tab,
    onChange: switchTab,
    items: [
      {
        value: TABS[0].value,
        label: t('tabSettings'),
        id: TABS[0].id,
        panelId: TABS[0].panelId,
      },
      {
        value: TABS[1].value,
        label: t('tabFiles'),
        id: TABS[1].id,
        panelId: TABS[1].panelId,
      },
      {
        value: TABS[2].value,
        label: t('tabSkills'),
        id: TABS[2].id,
        panelId: TABS[2].panelId,
        dot: skillUpdates,
        ...(skillUpdates ? { labelWithDot: t('tabSkillsHasUpdate') } : {}),
      },
    ],
  })

  return h(
    'div',
    { className: 'buka-workers-head' },
    h(
      'div',
      { className: 'buka-workers-headInner' },
      selectedWorker === null
        ? // 列表页是首页：顶部两个页签就是这一屏的标题，操作按钮在页签带右侧。
          h(
            'div',
            { className: 'buka-workers-bar' },
            h('div', { className: 'buka-workers-barTabs' }, topTabs),
            toolbarNode,
          )
        : // 详情页独立页头：返回 / 头像 / 标题与操作同一行，页内页签单独一行；
          // 首页的「工作流 / 执行者」页签只留在列表页，不再压在详情页上方。
          h('div', { className: 'buka-workers-titleRow' }, heading, toolbarNode),
      selectedWorker === null ? null : tabsNode,
    ),
  )
}
