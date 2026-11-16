/**
 * 「打工人」列表：打工人卡片与列表状态。
 *
 * 列表不展示目录；每张卡片显示名称、驱动类型、skills / 挂载状态、
 * 一句职责与行内动作。整行点击进入详情，行内动作区自己挡住冒泡。
 *
 * 机器人（clock）只读：卡片展示驱动与职责，没有新会话 / 挂载 /
 * 删除 / 助理入口，也不进入配置视图。智能体可以标记 / 取消助理。
 *
 * @module @buka/dsh-plugin-workers/client/components/worker-list
 */

import {
  Button,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import type { createWorkerActions } from '../actions/workers.ts'
import {
  countBadge,
  isRobotWorker,
  skillsOf,
  workerDisplayName,
  workerIdentityLabel,
} from '../api.ts'
import { renderAvatar } from '../avatar.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate, Worker } from '../types.ts'
import { MountedTag } from './common.ts'

/** 列表组件用到的动作集合。 */
type WorkerActions = ReturnType<typeof createWorkerActions>

/**
 * 一条打工人卡片：名称、驱动 / 助理 / skills / 挂载状态、职责与
 * 动作与删除确认。机器人只读。
 *
 */
export function WorkerCard({
  t,
  worker,
  state,
  actions: workerActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  actions: WorkerActions
}): ReactElement {
  const { busy, mutating, corrupt, openDetail } = state
  const { openWorker, mountWorker, openDeleteDialog, toggleAssistant } = workerActions
  const skills = skillsOf(worker)
  const robot = isRobotWorker(worker)
  const missing = !robot && worker.exists === false
  const mounted = worker.mounted === true
  const anyBusy = mutating || corrupt
  // 整行点击进入详情：机器人只读，不进入配置视图；写操作进行中
  // （重命名 / 删除 / 挂载）时先别切页，避免把正在操作的卡片切走。
  const canOpen = !mutating && !robot

  const actions = robot
    ? []
    : [
        h(
          Button,
          {
            key: 'open',
            variant: 'outline',
            size: 'sm',
            icon: h(IconNewChatOutlineRegular, { size: 13 }),
            disabled: mutating,
            'aria-label': `${t('newSession')} ${workerDisplayName(worker)}`,
            onClick: () => openWorker(worker),
          },
          t('newSession'),
        ),
        mounted
          ? null
          : h(
              Button,
              {
                key: 'mount',
                variant: 'outline',
                size: 'sm',
                icon:
                  busy === `mount:${worker.id}`
                    ? h(StateDot, { state: 'ongoing', size: 13 })
                    : h(IconPlusOutlineRegular, { size: 13 }),
                disabled: anyBusy,
                'aria-label': `${t('mount')} ${workerDisplayName(worker)}`,
                onClick: () => mountWorker(worker),
              },
              busy === `mount:${worker.id}` ? t('mounting') : t('mount'),
            ),
        h(
          Button,
          {
            key: 'assistant',
            variant: 'outline',
            size: 'sm',
            disabled: anyBusy || busy === `assistant:${worker.id}`,
            'aria-label': `${worker.assistant === true ? t('clearAssistant') : t('setAssistant')} ${workerDisplayName(worker)}`,
            onClick: () => toggleAssistant(worker),
          },
          busy === `assistant:${worker.id}`
            ? t('saving')
            : worker.assistant === true
              ? t('clearAssistant')
              : t('setAssistant'),
        ),
        // 删除与其它行内动作共用同一套按钮（outline + sm + 危险色）。
        // 点它先打开确认弹窗，弹窗读完影响面才允许确认。
        h(
          Button,
          {
            key: 'delete',
            variant: 'outline',
            size: 'sm',
            className: 'buka-workers-danger',
            icon: h(IconTrashOutlineRegular, { size: 13 }),
            disabled: anyBusy,
            'aria-label': `${t('delete')} ${workerDisplayName(worker)}`,
            onClick: () => openDeleteDialog(worker),
          },
          t('delete'),
        ),
      ]

  return h(
    'li',
    {
      className: `buka-workers-card${canOpen ? ' is-clickable' : ''}${robot ? ' is-robot' : ''}`,
      key: worker.id,
      'aria-busy': busy !== null ? true : undefined,
      // 整行可点进详情；行内动作区自己挡住冒泡，点按钮不会误触。
      onClick: () => {
        if (canOpen) openDetail(worker)
      },
    },
    h(
      'div',
      { className: 'buka-workers-cardHead' },
      h(
        'div',
        { className: 'buka-workers-titleRow' },
        h(
          'div',
          { className: 'buka-workers-titleCluster' },
          renderAvatar(worker.avatar, 26),
          // 标题本身就是按钮：鼠标点整行都能进详情，键盘 Tab 也能落到这里，
          // 不依赖一个单独的「配置」按钮。
          h(
            'button',
            {
              type: 'button',
              className: 'buka-workers-cardTitle',
              title: workerIdentityLabel(worker),
              'aria-label': `${t('openDetail')} ${workerDisplayName(worker)}`,
              disabled: !canOpen,
              onClick: (event: { stopPropagation(): void }) => {
                event.stopPropagation()
                if (canOpen) openDetail(worker)
              },
            },
            workerIdentityLabel(worker),
          ),
          h(Tag, { tone: robot ? 'info' : 'neutral' }, robot ? t('driverRobot') : t('driverAgent')),
          worker.assistant === true ? h(Tag, { tone: 'success' }, t('assistantBadge')) : null,
          robot ? null : h(MountedTag, { t, worker }),
          robot ? null : h(Tag, { tone: 'neutral' }, countBadge(skills.length, t)),
          missing ? h(Tag, { tone: 'warning' }, t('missingDir')) : null,
        ),
        h(
          'div',
          {
            className: 'buka-workers-titleActions',
            onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
          },
          ...actions.filter(Boolean),
        ),
      ),
      // 描述是工作流选择打工人的依据，列表里直接展示，避免必须点进详情才能比较。
      typeof worker.description === 'string' && worker.description !== ''
        ? h('p', { className: 'buka-workers-cardDesc' }, worker.description)
        : null,
      robot ? h('p', { className: 'buka-workers-hint' }, t('robotReadOnly')) : null,
      missing ? h('p', { className: 'buka-workers-hint' }, t('missingDirHint')) : null,
    ),
  )
}

/** 列表页：登记文件提示、加载 / 失败 / 空状态与打工人卡片（不展示目录）。 */
export function WorkerList({
  t,
  state,
  actions,
}: {
  t: Translate
  state: WorkersPageState
  actions: WorkerActions
}): ReactElement {
  const { corrupt, registry, list, data, workers, assistantOnly } = state
  const visible = assistantOnly ? workers.filter((worker) => worker.assistant === true) : workers
  const corruptNotice = corrupt
    ? h(
        'p',
        { className: 'buka-workers-notice', role: 'status' },
        h(IconWarningOutlineRegular, { size: 16 }),
        h(
          'span',
          null,
          t('corruptNote'),
          ' ',
          h('code', { className: 'buka-workers-inlineCode' }, registry),
        ),
      )
    : null

  return h(
    'div',
    { className: 'buka-workers-pageBody' },
    corruptNotice,
    list.error === null
      ? null
      : h(
          'p',
          { className: 'buka-workers-failure', role: 'alert' },
          h(StateDot, { state: 'error' }),
          `${t('loadFailed')} ${list.error}`,
        ),
    list.loading && data === null
      ? h(
          'p',
          { className: 'buka-workers-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('loading'),
        )
      : null,
    data === null
      ? null
      : visible.length === 0 && !list.loading && !corrupt
        ? h(
            'p',
            { className: 'buka-workers-empty' },
            assistantOnly ? t('assistantEmpty') : t('empty'),
          )
        : h(
            'ul',
            { className: 'buka-workers-cards' },
            ...visible.map((worker) =>
              h(WorkerCard, { t, worker, state, actions, key: worker.id }),
            ),
          ),
  )
}
