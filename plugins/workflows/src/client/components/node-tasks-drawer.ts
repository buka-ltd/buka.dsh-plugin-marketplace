/**
 * 实时流程里点开的节点任务列表。
 *
 * 单任务的节点直接进任务抽屉；多任务或空节点才用这个列表。
 */

import type React from 'react'

import { renderAvatar } from '../avatars.ts'
import { ClientModal, h } from '../element.ts'
import { formatWaiting } from '../format.ts'
import { fill } from '../i18n.ts'
import {
  claimantName,
  currentDefinition,
  currentJobDefinition,
  jobTasks,
  mergedDefinition,
  positionsOf,
  sortTasks,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { TaskSummary } from '../types.ts'
import { renderDrawerHead, renderEmpty, renderExecutor, renderStatusTag } from './parts.ts'

/** 节点任务列表抽屉。 */
export function renderNodeTasksDrawer(page: AppContext): React.ReactElement | null {
  const { t, state, actions } = page
  const selection = state.nodeTasks
  if (selection === null) return null
  const tasks = sortTasks(jobTasks(state).filter((task) => task.position === selection.positionId))
  const title = fill(t, 'nodeTasksTitle', { label: selection.label })
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const position = positionsOf(definition).find((item) => item.id === selection.positionId)
  const avatar =
    position !== undefined && typeof position.executor.avatar === 'string'
      ? renderAvatar(position.executor.avatar, 28, 'buka-workflows-drawerAvatar')
      : null
  const meta = [
    fill(t, 'flowTaskCount', { n: tasks.length }),
    position === undefined ? '' : renderExecutor(page, position.executor),
  ].filter((part) => part !== '')

  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: actions.closeNodeTasks,
      title,
      closeLabel: t('close'),
      backdropBlur: false,
      className: 'buka-workflows-drawer buka-workflows-nodeTasks',
    },
    renderDrawerHead({
      title,
      avatar,
      meta: meta.join(' · '),
      onClose: actions.closeNodeTasks,
      closeLabel: t('close'),
    }),
    h(
      'div',
      { className: 'buka-workflows-drawerBody' },
      tasks.length === 0
        ? renderEmpty(t('nodeTasksEmpty'), t('nodeTasksEmptyHint'))
        : h(
            'ul',
            { className: 'buka-workflows-taskList' },
            ...tasks.map((task) => renderNodeTask(page, task)),
          ),
    ),
  )
}

/** 一个任务行。 */
function renderNodeTask(page: AppContext, task: TaskSummary): React.ReactElement {
  const { t, actions } = page
  const claimant = claimantName(task.claimant, t)
  const waiting =
    task.status === 'ready' || task.status === 'pending' ? formatWaiting(task.createdAt) : ''
  return h(
    'li',
    { key: task.id },
    h(
      'button',
      {
        type: 'button',
        className: `buka-workflows-taskCard is-${task.status ?? 'pending'}`,
        onClick: () => actions.openTask(task.id),
      },
      h(
        'span',
        { className: 'buka-workflows-taskCardHead' },
        h(
          'span',
          { className: 'buka-workflows-taskCardType' },
          task.typeLabel ?? task.type ?? task.id,
        ),
        renderStatusTag(t, task.status, 'task'),
      ),
      typeof task.resultSummary === 'string' && task.resultSummary !== ''
        ? h('span', { className: 'buka-workflows-taskCardSummary' }, task.resultSummary)
        : null,
      claimant === '' && waiting === ''
        ? null
        : h(
            'span',
            { className: 'buka-workflows-taskCardMeta' },
            [
              claimant === '' ? '' : `${t('taskClaimant')}: ${claimant}`,
              waiting === '' ? '' : fill(t, 'boardCardWaiting', { duration: waiting }),
            ]
              .filter((part) => part !== '')
              .join(' · '),
          ),
    ),
  )
}
