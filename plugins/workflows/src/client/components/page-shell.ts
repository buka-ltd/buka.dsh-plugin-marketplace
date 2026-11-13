/**
 * 页面外壳：返回、标题、状态、工具栏、页签、内容区、Toast 与抽屉 / 对话框。
 */

import {
  Button,
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
  SegmentedTabs,
  StateDot,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { fill } from '../i18n.ts'
import type { AppContext } from '../page-context.ts'
import { routeHash } from '../routing.ts'
import type { JobView, WorkflowTab } from '../types.ts'
import { renderAttachmentDrawer } from './attachments.ts'
import { renderDefinitionDrawer } from './definition-drawer.ts'
import { renderJobDetail } from './job-detail.ts'
import { renderNewJobDialog } from './new-job-dialog.ts'
import { renderNodeTasksDrawer } from './node-tasks-drawer.ts'
import { ConfirmButton, renderStatusTag } from './parts.ts'
import { renderTaskDrawer } from './task-drawer.ts'
import { renderWorkflowDefinition } from './workflow-definition.ts'
import { renderWorkflowJobs } from './workflow-jobs.ts'
import { renderWorkflowList } from './workflow-list.ts'

/** 页面标题与副标题。 */
function pageHeading(page: AppContext): { title: string; subtitle: string } {
  const { t, state } = page
  const route = state.route
  if (route.kind === 'workflows') return { title: t('title'), subtitle: '' }
  if (route.kind === 'workflow') {
    return {
      title: state.workflow.data?.workflow?.name ?? route.workflowId,
      subtitle: '',
    }
  }
  const job = state.job.data?.job
  const version = typeof job?.workflowVersion === 'number' ? ` · v${job.workflowVersion}` : ''
  return {
    title: typeof job?.seq === 'number' ? fill(t, 'jobSeq', { seq: job.seq }) : t('jobTitle'),
    subtitle: `${job?.workflowName ?? ''}${version}`,
  }
}

/**
 * 页面外壳。
 *
 * @param page
 * @returns React 元素
 */
export function renderPage(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const route = state.route
  const heading = pageHeading(page)
  const workflowStatus = state.workflow.data?.workflow?.status
  const jobStatus = state.job.data?.job?.status
  const live = jobStatus === 'running'
  const retired = route.kind === 'workflow' && workflowStatus === 'retired'
  const workflowAvailable = workflowStatus !== undefined && workflowStatus !== 'retired'

  const tabs =
    route.kind === 'workflow'
      ? [
          {
            value: 'jobs',
            label: t('jobsTab'),
            id: 'buka-workflows-tab-jobs',
            panelId: 'buka-workflows-panel-jobs',
          },
          {
            value: 'definition',
            label: t('definitionTab'),
            id: 'buka-workflows-tab-definition',
            panelId: 'buka-workflows-panel-definition',
          },
        ]
      : route.kind === 'job'
        ? [
            {
              value: 'overview',
              label: t('overviewTab'),
              id: 'buka-workflows-tab-overview',
              panelId: 'buka-workflows-panel-overview',
            },
            {
              value: 'flow',
              label: t('flowTab'),
              id: 'buka-workflows-tab-flow',
              panelId: 'buka-workflows-panel-flow',
            },
            {
              value: 'board',
              label: t('boardTab'),
              id: 'buka-workflows-tab-board',
              panelId: 'buka-workflows-panel-board',
            },
            {
              value: 'outputs',
              label: t('outputsTab'),
              id: 'buka-workflows-tab-outputs',
              panelId: 'buka-workflows-panel-outputs',
            },
          ]
        : null
  const activeTab = route.kind === 'workflow' ? route.tab : route.kind === 'job' ? route.view : ''

  const toolbar: React.ReactNode[] = []
  if (route.kind === 'workflow') {
    if (retired) {
      toolbar.push(
        h(
          Button,
          {
            key: 'enable',
            variant: 'primary',
            size: 'sm',
            className: 'buka-workflows-toolbarButton',
            onClick: () => void actions.setWorkflowEnabled(true),
            disabled: state.busy === 'workflow-status',
          },
          t('enableWorkflow'),
        ),
      )
    } else {
      toolbar.push(
        h(
          Button,
          {
            key: 'new-job',
            variant: 'primary',
            size: 'sm',
            className: 'buka-workflows-toolbarButton',
            onClick: actions.openNewJob,
            disabled: !workflowAvailable,
          },
          t('newJob'),
        ),
      )
    }
  }
  if (route.kind === 'job') {
    toolbar.push(
      h(ConfirmButton, {
        key: 'cancel-job',
        label: t('cancelJob'),
        confirmLabel: t('cancelJobConfirmAction'),
        cancelLabel: t('cancel'),
        confirmText: t('cancelJobConfirm'),
        onConfirm: () => void actions.cancelJob(),
        disabled: state.busy === 'cancel-job' || jobStatus !== 'running',
      }),
    )
  }
  toolbar.push(
    h(
      Button,
      {
        key: 'refresh',
        variant: 'outline',
        size: 'sm',
        className: 'buka-workflows-toolbarButton',
        icon: h(IconRefreshOutlineRegular, { size: 13 }),
        onClick: actions.refresh,
      },
      t('refresh'),
    ),
  )
  if (route.kind === 'workflow' && !retired && workflowStatus !== undefined) {
    toolbar.push(
      h(
        'details',
        { key: 'more', className: 'buka-workflows-more' },
        h('summary', { className: 'buka-workflows-moreSummary' }, t('more')),
        h(
          'div',
          { className: 'buka-workflows-moreMenu' },
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                void actions.setWorkflowEnabled(false)
              },
              disabled: state.busy === 'workflow-status',
            },
            t('disableWorkflow'),
          ),
        ),
      ),
    )
  }

  const body =
    route.kind === 'workflows'
      ? renderWorkflowList(page)
      : route.kind === 'workflow'
        ? route.tab === 'definition'
          ? renderWorkflowDefinition(page)
          : renderWorkflowJobs(page)
        : renderJobDetail(page)

  return h(
    'div',
    {
      className: `buka-workflows-page${route.kind === 'job' ? ' is-wide' : route.kind === 'workflow' ? ' is-mid' : ''}`,
    },
    h(
      'header',
      { className: 'buka-workflows-head' },
      h(
        'div',
        { className: 'buka-workflows-headInner' },
        h(
          'div',
          { className: 'buka-workflows-titleRow' },
          h(
            'div',
            { className: 'buka-workflows-titleGroup' },
            route.kind === 'workflows'
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workflows-back',
                    title: t('back'),
                    'aria-label': t('back'),
                    onClick:
                      route.kind === 'workflow' ? actions.backToWorkflows : actions.backToWorkflow,
                  },
                  h(IconChevronRightOutlineRegular, { size: 13 }),
                ),
            h('h1', { className: 'buka-workflows-title' }, heading.title),
            route.kind === 'workflow' && retired
              ? renderStatusTag(t, workflowStatus, 'workflow')
              : null,
            route.kind === 'job'
              ? h(
                  'span',
                  { className: 'buka-workflows-titleMeta' },
                  h('span', { className: 'buka-workflows-titleSub' }, heading.subtitle),
                  renderStatusTag(t, jobStatus, 'job'),
                  live ? h(StateDot, { state: 'ongoing' }) : null,
                )
              : null,
          ),
          h('div', { className: 'buka-workflows-toolbar' }, ...toolbar),
        ),
        tabs === null
          ? null
          : h(
              'div',
              { className: 'buka-workflows-tabs' },
              h(SegmentedTabs, {
                size: 'sm',
                className: 'buka-workflows-tabList',
                label: route.kind === 'workflow' ? t('workflowTabsAria') : t('jobTabsAria'),
                value: activeTab,
                onChange: (value: string) => {
                  if (route.kind === 'workflow') actions.setWorkflowTab(value as WorkflowTab)
                  else if (route.kind === 'job') actions.setJobView(value as JobView)
                },
                items: tabs,
              }),
            ),
      ),
    ),
    h(
      'div',
      {
        key: routeHash(route),
        className: `buka-workflows-body${route.kind === 'job' ? ' is-wide' : ''}`,
      },
      body,
    ),
    renderNewJobDialog(page),
    renderDefinitionDrawer(page),
    renderNodeTasksDrawer(page),
    renderTaskDrawer(page),
    renderAttachmentDrawer(page),
    state.notice === null
      ? null
      : h(Toast, {
          key: state.notice.seq,
          text: state.notice.text,
          ...(state.notice.kind === 'success' ? { tone: 'success' as const } : {}),
          ...(state.notice.kind === 'success' ? {} : { icon: h(IconWarningOutlineRegular, {}) }),
          holdMs: 3200,
          onDone: actions.dismissNotice,
        }),
  )
}
