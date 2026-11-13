/**
 * 作业看板：行 = 启动者（开始 / 结束任务合并）+ 岗位，
 * 列 = 排队 / 待认领 / 进行中 / 已完成 / 异常。
 *
 * 宽屏是网格；窄屏退化成按状态分组的纵向列表。
 */

import type React from 'react'

import { h } from '../element.ts'
import { boardColumn, formatWaiting } from '../format.ts'
import { fill } from '../i18n.ts'
import {
  type BoardRow,
  boardRows,
  claimantName,
  currentDefinition,
  currentJobDefinition,
  currentStarter,
  jobTasks,
  mergedDefinition,
  starterText,
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

/** 看板视图。 */
export function renderBoard(page: AppContext): React.ReactElement {
  const { t, state } = page
  const tasks = jobTasks(state)
  if (tasks.length === 0) {
    return renderEmpty(t('boardEmpty'), t('boardEmptyHint'))
  }
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const rows = boardRows(definition, tasks, { starter: t('boardStarter') }).filter(
    (row) => row.kind === 'position' || row.tasks.length > 0,
  )

  return h(
    'div',
    { className: 'buka-workflows-boardPane' },
    h('p', { className: 'buka-workflows-hint' }, t('boardHint')),
    page.narrow
      ? renderCompactBoard(page, rows)
      : h(
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
                    className: `buka-workflows-boardColumnHead is-${column.key}`,
                    role: 'columnheader',
                  },
                  t(column.labelKey),
                ),
              ),
            ),
            ...rows.map((row) => renderBoardRow(page, row)),
          ),
        ),
  )
}

/** 网格里的一行。 */
function renderBoardRow(page: AppContext, row: BoardRow): React.ReactElement {
  const { t } = page
  const cellTasks = new Map<string, TaskSummary[]>()
  for (const task of row.tasks) {
    const key = boardColumn(task.status)
    const list = cellTasks.get(key)
    if (list === undefined) cellTasks.set(key, [task])
    else list.push(task)
  }
  const executor =
    row.kind === 'starter'
      ? starterText(currentStarter(page.state), t)
      : row.executor === null
        ? ''
        : renderExecutor(page, row.executor)
  return h(
    'div',
    { key: row.id, className: `buka-workflows-boardRow is-${row.kind}`, role: 'row' },
    h(
      'div',
      { className: 'buka-workflows-boardRowHead' },
      h('span', { className: 'buka-workflows-boardRowTitle' }, row.label),
      executor === ''
        ? null
        : h('span', { className: 'buka-workflows-boardRowExecutor' }, executor),
      h(
        'span',
        { className: 'buka-workflows-boardRowMeta' },
        row.tasks.length === 0 ? t('boardNoTasks') : fill(t, 'taskCount', { n: row.tasks.length }),
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
        ...list.map((task) => renderBoardCard(page, task, false)),
      )
    }),
  )
}

/** 窄屏：按状态分组的纵向列表。 */
function renderCompactBoard(page: AppContext, rows: BoardRow[]): React.ReactElement {
  const { t } = page
  // 卡片按任务自己的 position 找行名；启动者行同时覆盖 start 与 end。
  const labels = new Map<string, string>()
  for (const row of rows) {
    labels.set(row.id, row.label)
    if (row.kind === 'starter') {
      labels.set('start', row.label)
      labels.set('end', row.label)
    }
  }
  const groups = COLUMNS.map((column) => ({
    column,
    tasks: rows
      .flatMap((row) => row.tasks)
      .filter((task) => boardColumn(task.status) === column.key),
  })).filter((group) => group.tasks.length > 0)

  return h(
    'div',
    { className: 'buka-workflows-boardCompact' },
    ...groups.map((group) =>
      h(
        'section',
        { key: group.column.key, className: 'buka-workflows-boardGroup' },
        h(
          'h4',
          { className: `buka-workflows-boardGroupTitle is-${group.column.key}` },
          t(group.column.labelKey),
          h('span', { className: 'buka-workflows-boardGroupCount' }, String(group.tasks.length)),
        ),
        h(
          'ul',
          { className: 'buka-workflows-taskList' },
          ...group.tasks.map((task) =>
            renderBoardCard(page, task, true, labels.get(task.position ?? '') ?? ''),
          ),
        ),
      ),
    ),
  )
}

/** 看板卡片。 */
function renderBoardCard(
  page: AppContext,
  task: TaskSummary,
  compact: boolean,
  positionLabel = '',
): React.ReactElement {
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

  const wrapper = compact ? 'li' : 'div'
  return h(
    wrapper,
    { key: task.id, className: 'buka-workflows-taskItem' },
    h(
      'button',
      {
        type: 'button',
        className: `buka-workflows-taskCard is-${task.status ?? 'pending'}`,
        onClick: () => actions.openTask(task.id),
      },
      compact && positionLabel !== ''
        ? h('span', { className: 'buka-workflows-taskCardPosition' }, positionLabel)
        : null,
      h(
        'span',
        { className: 'buka-workflows-taskCardHead' },
        h(
          'span',
          { className: 'buka-workflows-taskCardType' },
          task.typeLabel ?? task.type ?? task.id,
        ),
        compact ? renderStatusTag(t, task.status, 'task') : null,
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
    ),
  )
}
