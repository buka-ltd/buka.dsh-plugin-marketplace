/**
 * 工作流页的「作业」Tab：筛选、作业列表与新建作业入口。
 */

import type React from 'react'

import { h } from '../element.ts'
import { formatTime } from '../format.ts'
import { fill } from '../i18n.ts'
import { filterJobs, sortJobs } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { JobFilter, JobSummary } from '../types.ts'
import { renderEmptyAction, renderFailure, renderLoading, renderStatusTag } from './parts.ts'

/** 筛选定义。 */
const FILTERS: Array<{ value: JobFilter; labelKey: string }> = [
  { value: 'all', labelKey: 'jobsFilterAll' },
  { value: 'running', labelKey: 'jobsFilterRunning' },
  { value: 'completed', labelKey: 'jobsFilterCompleted' },
  { value: 'problem', labelKey: 'jobsFilterProblem' },
]

/** 作业列表视图。 */
export function renderWorkflowJobs(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.workflow
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)

  const workflow = loaded.data.workflow
  const workflowId = workflow?.id ?? ''
  const retired = workflow?.status === 'retired'
  const jobs = Array.isArray(loaded.data.jobs) ? loaded.data.jobs : []
  const counts = {
    all: jobs.length,
    running: jobs.filter((job) => job.status === 'running').length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    problem: jobs.filter((job) => job.status === 'failed' || job.status === 'cancelled').length,
  }
  const visible = sortJobs(filterJobs(jobs, state.jobFilter))

  const newJobAction =
    retired || workflowId === ''
      ? null
      : h(
          'button',
          {
            key: 'new-job-empty',
            type: 'button',
            className: 'buka-workflows-textButton',
            onClick: actions.openNewJob,
          },
          t('newJob'),
        )

  if (jobs.length === 0) {
    return renderEmptyAction(
      t('jobsEmpty'),
      retired ? t('jobsEmptyRetired') : t('jobsEmptyHint'),
      newJobAction,
    )
  }

  return h(
    'div',
    { className: 'buka-workflows-jobsPane' },
    h(
      'div',
      { className: 'buka-workflows-filters', role: 'group', 'aria-label': t('jobsFilterAria') },
      ...FILTERS.map((filter) =>
        h(
          'button',
          {
            key: filter.value,
            type: 'button',
            className: `buka-workflows-filter${state.jobFilter === filter.value ? ' is-active' : ''}`,
            'aria-pressed': state.jobFilter === filter.value,
            onClick: () => actions.setJobFilter(filter.value),
          },
          t(filter.labelKey),
          h('span', { className: 'buka-workflows-filterCount' }, String(counts[filter.value])),
        ),
      ),
    ),
    visible.length === 0
      ? renderEmptyAction(t('jobsFilterEmpty'), null, [
          h(
            'button',
            {
              key: 'reset-filter',
              type: 'button',
              className: 'buka-workflows-textButton',
              onClick: () => actions.setJobFilter('all'),
            },
            t('jobsFilterReset'),
          ),
        ])
      : h(
          'ul',
          { className: 'buka-workflows-cards' },
          ...visible.map((job) => renderJobCard(page, workflowId, job)),
        ),
  )
}

/** 一张作业卡片。 */
function renderJobCard(page: AppContext, workflowId: string, job: JobSummary): React.ReactElement {
  const { t, actions } = page
  const total = Object.values(job.taskCounts ?? {}).reduce(
    (sum, value) => sum + (typeof value === 'number' ? value : 0),
    0,
  )
  const done = typeof job.taskCounts?.completed === 'number' ? job.taskCounts.completed : 0
  const ready = typeof job.taskCounts?.ready === 'number' ? job.taskCounts.ready : 0
  const running = typeof job.taskCounts?.running === 'number' ? job.taskCounts.running : 0
  const problem =
    (job.taskCounts?.failed ?? 0) +
    (job.taskCounts?.blocked ?? 0) +
    (job.taskCounts?.cancelled ?? 0)
  const parts = [
    total > 0 ? fill(t, 'jobTaskProgress', { done, total }) : t('jobNoTasks'),
    running > 0 ? `${t('statusRunning')} ${running}` : '',
    ready > 0 ? `${t('statusReady')} ${ready}` : '',
    problem > 0 ? `${t('jobsFilterProblem')} ${problem}` : '',
    typeof job.updatedAt === 'string' && job.updatedAt !== ''
      ? `${t('updatedAt')} ${formatTime(job.updatedAt)}`
      : typeof job.createdAt === 'string' && job.createdAt !== ''
        ? `${t('jobCreatedAt')} ${formatTime(job.createdAt)}`
        : '',
  ].filter((part) => part !== '')

  return h(
    'li',
    { key: job.id },
    h(
      'button',
      {
        type: 'button',
        className: 'buka-workflows-card',
        onClick: () => actions.openJob(workflowId, job.id),
      },
      h(
        'span',
        { className: 'buka-workflows-cardHead' },
        h(
          'span',
          { className: 'buka-workflows-cardTitleGroup' },
          h('span', { className: 'buka-workflows-seq' }, fill(t, 'jobSeq', { seq: job.seq ?? 0 })),
          h('span', { className: 'buka-workflows-cardTitle' }, job.inputSummary ?? job.id),
        ),
        renderStatusTag(t, job.status, 'job'),
      ),
      h('span', { className: 'buka-workflows-meta' }, parts.join(' · ')),
      total > 0
        ? h(
            'span',
            { className: 'buka-workflows-progress', 'aria-hidden': true },
            h('span', {
              className: `buka-workflows-progressBar is-${job.status ?? 'pending'}`,
              style: { width: `${Math.round((done / total) * 100)}%` },
            }),
          )
        : null,
    ),
  )
}
