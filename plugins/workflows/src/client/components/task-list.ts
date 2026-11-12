/**
 * 作业的任务列表视图。
 */

import type React from 'react'

import { h } from '../element.ts'
import { formatTime, statusLabel } from '../format.ts'
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
import { renderEmpty, renderStatusTag } from './parts.ts'

/**
 * 任务列表视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderTaskList(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const tasks = sortTasks(jobTasks(state))
  if (tasks.length === 0) return renderEmpty(t('tasksEmpty'), t('boardEmptyHint'))
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const positions = positionsOf(definition)
  const positionLabel = (id: unknown): string => {
    if (id === 'start') return t('boardStart')
    if (id === 'end') return t('boardEnd')
    const found = positions.find((position) => position.id === id)
    return found === undefined ? String(id ?? '') : found.label
  }

  return h(
    'div',
    { className: 'buka-workflows-tablePane' },
    h('p', { className: 'buka-workflows-hint' }, t('tasksHint')),
    h(
      'table',
      { className: 'buka-workflows-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, t('tasksTableType')),
          h('th', null, t('tasksTablePosition')),
          h('th', null, t('tasksTableStatus')),
          h('th', null, t('tasksTableClaimant')),
          h('th', null, t('tasksTableCreated')),
        ),
      ),
      h(
        'tbody',
        null,
        ...tasks.map((task) =>
          h(
            'tr',
            {
              key: task.id,
              className: 'buka-workflows-tableRow',
              tabIndex: 0,
              onClick: () => actions.openTask(task.id),
              onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                actions.openTask(task.id)
              },
            },
            h('td', null, task.typeLabel ?? task.type ?? task.id),
            h('td', null, task.position === undefined ? '' : positionLabel(task.position)),
            h('td', null, renderStatusTag(t, task.status, 'task')),
            h('td', null, claimantName(task.claimant, t) || statusLabel(t, 'unknown')),
            h('td', { className: 'buka-workflows-tableTime' }, formatTime(task.createdAt)),
          ),
        ),
      ),
    ),
  )
}
