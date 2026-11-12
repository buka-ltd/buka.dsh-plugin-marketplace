/**
 * 作业详情：头部摘要 + 看板 / 流程图 / 任务 / 附件库 / 时间线五个视图。
 */

import {
  Button,
  IconRefreshOutlineRegular,
  SegmentedTabs,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { formatTime, jsonText } from '../format.ts'
import { fill } from '../i18n.ts'
import { currentDefinition, currentJobDefinition, jobTasks, mergedDefinition } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { JobView } from '../types.ts'
import { isRecord } from '../types.ts'
import { renderAttachments } from './attachments.ts'
import { renderBoard } from './board.ts'
import { renderJobGraph } from './job-graph.ts'
import {
  renderEmpty,
  renderFailure,
  renderLoading,
  renderSection,
  renderStatusTag,
} from './parts.ts'
import { renderTaskList } from './task-list.ts'
import { renderTimeline } from './timeline.ts'

/**
 * 作业详情视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderJobDetail(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.job
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)
  const detail = loaded.data
  const job = detail.job
  if (job === undefined) return renderEmpty(t('notFound'))

  const tasks = jobTasks(state)
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const needsDeliveryRetry =
    job.status === 'running' &&
    tasks.some((task) => task.position === 'end' && task.status === 'ready')
  const starter = isRecord(job.starter) ? job.starter : null

  const tabs: Array<{ value: JobView; labelKey: string }> = [
    { value: 'board', labelKey: 'boardTab' },
    { value: 'graph', labelKey: 'graphTab' },
    { value: 'tasks', labelKey: 'tasksTab' },
    { value: 'attachments', labelKey: 'attachmentsTab' },
    { value: 'timeline', labelKey: 'timelineTab' },
  ]

  return h(
    'div',
    { className: 'buka-workflows-detail' },
    h(
      'div',
      { className: 'buka-workflows-jobHead' },
      h(
        'div',
        { className: 'buka-workflows-jobTitleGroup' },
        h('span', { className: 'buka-workflows-seq' }, fill(t, 'jobSeq', { seq: job.seq ?? 0 })),
        h(
          'h2',
          { className: 'buka-workflows-jobTitle' },
          job.workflowName ?? job.workflowId ?? t('jobTitle'),
        ),
        typeof job.workflowVersion === 'number'
          ? h(Tag, { tone: 'neutral' }, `v${job.workflowVersion}`)
          : null,
        renderStatusTag(t, job.status, 'job'),
      ),
      h(
        'div',
        { className: 'buka-workflows-jobMeta' },
        `${t('jobCreatedAt')} ${formatTime(job.createdAt)}`,
        ` · ${t('jobUpdatedAt')} ${formatTime(job.updatedAt)}`,
        starter === null
          ? ''
          : ` · ${t('starter')}: ${
              starter.kind === 'session'
                ? `${t('starterSession')}${typeof starter.sessionId === 'string' ? ` ${starter.sessionId}` : ''}`
                : t('starterHuman')
            }`,
      ),
      starter !== null &&
        starter.kind === 'session' &&
        typeof starter.sessionId === 'string' &&
        starter.sessionId !== ''
        ? h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: () => void actions.openSession(starter.sessionId),
            },
            t('openStarterSession'),
          )
        : null,
    ),
    needsDeliveryRetry
      ? h(
          'div',
          { className: 'buka-workflows-deliveryNotice', role: 'status' },
          h('p', { className: 'buka-workflows-warn' }, t('deliveryRetryHint')),
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              icon: h(IconRefreshOutlineRegular, { size: 13 }),
              onClick: () => void actions.retryDelivery(),
              disabled: state.busy === 'retry-delivery',
            },
            t('retryDelivery'),
          ),
        )
      : null,
    job.error === null || job.error === undefined
      ? null
      : renderSection(
          t('jobErrorTitle'),
          h('pre', { className: 'buka-workflows-pre' }, jsonText(job.error)),
        ),
    renderSection(
      t('jobInput'),
      h('pre', { className: 'buka-workflows-pre is-tall' }, jsonText(job.input ?? {})),
    ),
    h(
      'div',
      { className: 'buka-workflows-viewTabs' },
      h(SegmentedTabs, {
        size: 'sm',
        className: 'buka-workflows-tabList',
        label: t('jobViewsAria'),
        value: state.jobView,
        onChange: (value: string) => actions.setJobView(value as JobView),
        items: tabs.map((tab) => ({
          value: tab.value,
          label: t(tab.labelKey),
          id: `buka-workflows-tab-${tab.value}`,
          panelId: `buka-workflows-panel-${tab.value}`,
        })),
      }),
    ),
    h(
      'div',
      { className: 'buka-workflows-viewBody' },
      state.jobView === 'board'
        ? renderBoard(page)
        : state.jobView === 'graph'
          ? renderJobGraph(page)
          : state.jobView === 'tasks'
            ? renderTaskList(page)
            : state.jobView === 'attachments'
              ? renderAttachments(page)
              : renderTimeline(page),
    ),
    definition === null
      ? h('p', { className: 'buka-workflows-hint' }, t('definitionMissing'))
      : null,
  )
}
