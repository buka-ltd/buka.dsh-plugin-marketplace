/**
 * 作业看板：行 = 岗位（含开始 / 结束），列 = 排队 / 待认领 / 进行中 / 已完成 / 异常。
 */

import type React from 'react'

import { h } from '../element.ts'
import { boardColumn, formatWaiting, statusLabel } from '../format.ts'
import { fill } from '../i18n.ts'
import {
  boardRows,
  claimantName,
  countTasks,
  currentDefinition,
  currentJobDefinition,
  jobTasks,
  mergedDefinition,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { TaskSummary } from '../types.ts'
import { renderEmpty, renderExecutor, renderStatusTag } from './parts.ts'

/** 看板列。 */
const COLUMNS = [
  { key: 'pending', labelKey: 'boardColumnPending' },
  { key: 'ready', labelKey: 'boardColumnReady' },
  { key: 'running', labelKey: 'boardColumnRunning' },
  { key: 'completed', labelKey: 'boardColumnCompleted' },
  { key: 'error', labelKey: 'boardColumnError' },
] as const

/**
 * 看板视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderBoard(page: AppContext): React.ReactElement {
  const { t, state } = page
  const tasks = jobTasks(state)
  if (tasks.length === 0) {
    return renderEmpty(t('boardEmpty'), t('boardEmptyHint'))
  }
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const rows = boardRows(definition, tasks, { start: t('boardStart'), end: t('boardEnd') })

  return h(
    'div',
    { className: 'buka-workflows-boardPane' },
    h('p', { className: 'buka-workflows-hint' }, t('boardHint')),
    h(
      'div',
      { className: 'buka-workflows-board' },
      h(
        'div',
        { className: 'buka-workflows-boardGrid' },
        h(
          'div',
          { className: 'buka-workflows-boardHeader', role: 'row' },
          h('div', { className: 'buka-workflows-boardRowHead' }, ''),
          ...COLUMNS.map((column) =>
            h(
              'div',
              {
                key: column.key,
                className: 'buka-workflows-boardColumnHead',
                role: 'columnheader',
              },
              t(column.labelKey),
            ),
          ),
        ),
        ...rows.map((row) => {
          const rowTasks = row.tasks
          const counts = countTasks(rowTasks)
          const cellTasks = new Map<string, TaskSummary[]>()
          for (const task of rowTasks) {
            const key = boardColumn(task.status)
            const list = cellTasks.get(key)
            if (list === undefined) cellTasks.set(key, [task])
            else list.push(task)
          }
          return h(
            'div',
            { key: row.id, className: `buka-workflows-boardRow is-${row.kind}`, role: 'row' },
            h(
              'div',
              { className: 'buka-workflows-boardRowHead' },
              h('span', { className: 'buka-workflows-boardRowTitle' }, row.label),
              row.executor === null
                ? null
                : h(
                    'span',
                    { className: 'buka-workflows-boardRowExecutor' },
                    renderExecutor(page, row.executor),
                  ),
              h(
                'span',
                { className: 'buka-workflows-boardRowMeta' },
                rowTasks.length === 0
                  ? t('boardNoTasks')
                  : fill(t, 'taskCount', { n: rowTasks.length }) +
                      (counts.running ? ` · ${t('statusRunning')} ${counts.running}` : ''),
              ),
            ),
            ...COLUMNS.map((column) => {
              const list = cellTasks.get(column.key) ?? []
              return h(
                'div',
                {
                  key: column.key,
                  className: `buka-workflows-boardCell is-${column.key}`,
                  role: 'cell',
                },
                ...list.map((task) => renderBoardCard(page, task)),
              )
            }),
          )
        }),
      ),
    ),
  )
}

/**
 * 看板卡片。
 *
 * @param page
 * @param task
 * @returns React 元素
 */
function renderBoardCard(page: AppContext, task: TaskSummary): React.ReactElement {
  const { t, actions } = page
  const meta: string[] = []
  if (Array.isArray(task.deps) && task.deps.length > 0) {
    meta.push(fill(t, 'boardCardDeps', { n: task.deps.length }))
  }
  if (typeof task.attemptCount === 'number' && task.attemptCount > 1) {
    meta.push(fill(t, 'boardCardAttempts', { n: task.attemptCount }))
  }
  if (typeof task.attachmentCount === 'number' && task.attachmentCount > 0) {
    meta.push(fill(t, 'boardCardAttachments', { n: task.attachmentCount }))
  }
  const claimant = claimantName(task.claimant, t)
  if (task.status === 'ready' || task.status === 'pending') {
    const waiting = formatWaiting(task.createdAt)
    if (waiting !== '') meta.push(fill(t, 'boardCardWaiting', { duration: waiting }))
  }
  const summary = typeof task.resultSummary === 'string' ? task.resultSummary : ''

  return h(
    'button',
    {
      key: task.id,
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
    claimant === ''
      ? null
      : h(
          'span',
          { className: 'buka-workflows-taskCardMeta' },
          `${t('taskClaimant')}: ${claimant}`,
        ),
    summary === '' ? null : h('span', { className: 'buka-workflows-taskCardSummary' }, summary),
    meta.length === 0
      ? null
      : h('span', { className: 'buka-workflows-taskCardMeta' }, meta.join(' · ')),
    h('span', { className: 'buka-workflows-taskCardStatus' }, statusLabel(page.t, task.status)),
  )
}
