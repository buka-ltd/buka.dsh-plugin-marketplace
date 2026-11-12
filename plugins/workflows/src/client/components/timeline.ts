/**
 * 作业时间线：由作业与任务的时间戳派生（不额外请求事件表）。
 */

import type React from 'react'

import { h } from '../element.ts'
import { formatTime, toDate } from '../format.ts'
import {
  currentDefinition,
  currentJobDefinition,
  jobTasks,
  mergedDefinition,
  positionsOf,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { renderEmpty } from './parts.ts'

/** 一条时间线事件。 */
interface TimelineEvent {
  key: string
  at: number
  label: string
  detail: string
  tone: 'neutral' | 'success' | 'warning' | 'info'
}

/**
 * 时间线视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderTimeline(page: AppContext): React.ReactElement {
  const { t, state } = page
  const job = state.job.data?.job
  const tasks = jobTasks(state)
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const positions = positionsOf(definition)
  const positionLabel = (id: unknown): string => {
    if (id === 'start') return t('boardStart')
    if (id === 'end') return t('boardEnd')
    const found = positions.find((position) => position.id === id)
    return found === undefined ? String(id ?? '') : found.label
  }

  const events: TimelineEvent[] = []
  /**
   * @param key
   * @param value 时间
   * @param label
   * @param detail
   * @param tone
   */
  function push(
    key: string,
    value: unknown,
    label: string,
    detail: string,
    tone: TimelineEvent['tone'] = 'neutral',
  ): void {
    const date = toDate(value)
    if (date === null) return
    events.push({ key, at: date.getTime(), label, detail, tone })
  }

  push('job-created', job?.createdAt, t('timelineJobCreated'), t('jobTitle'), 'info')
  for (const task of tasks) {
    const name = `${task.typeLabel ?? task.type ?? task.id} · ${positionLabel(task.position)}`
    push(`task-created-${task.id}`, task.createdAt, t('timelineTaskCreated'), name)
    push(`task-started-${task.id}`, task.startedAt, t('timelineTaskStarted'), name, 'info')
    if (task.status === 'failed' || task.status === 'blocked') {
      push(`task-failed-${task.id}`, task.finishedAt, t('timelineTaskFailed'), name, 'warning')
    } else if (task.status === 'cancelled') {
      push(
        `task-cancelled-${task.id}`,
        task.finishedAt,
        t('timelineTaskCancelled'),
        name,
        'warning',
      )
    } else {
      push(`task-finished-${task.id}`, task.finishedAt, t('timelineTaskFinished'), name, 'success')
    }
  }
  push('job-updated', job?.updatedAt, t('timelineJobUpdated'), '', 'neutral')
  events.sort((left, right) => left.at - right.at || left.key.localeCompare(right.key))

  if (events.length === 0) return renderEmpty(t('timelineEmpty'))

  return h(
    'ol',
    { className: 'buka-workflows-timeline' },
    ...events.map((event) =>
      h(
        'li',
        { key: event.key, className: `buka-workflows-timelineItem is-${event.tone}` },
        h('span', { className: 'buka-workflows-timelineDot', 'aria-hidden': true }),
        h(
          'div',
          { className: 'buka-workflows-timelineBody' },
          h(
            'div',
            { className: 'buka-workflows-timelineHead' },
            h('span', { className: 'buka-workflows-timelineLabel' }, event.label),
            h('span', { className: 'buka-workflows-timelineTime' }, formatTime(event.at)),
          ),
          event.detail === ''
            ? null
            : h('span', { className: 'buka-workflows-timelineDetail' }, event.detail),
        ),
      ),
    ),
  )
}
