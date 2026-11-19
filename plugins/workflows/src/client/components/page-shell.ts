/**
 * 页面外壳：返回、标题、状态、工具栏、页签、内容区、Toast 与抽屉 / 对话框。
 */

import { TabLabel } from '@buka/plugin-ui'
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
import { ConfirmButton, renderAvailabilityNotice, renderStatusTag } from './parts.ts'
import { renderRestartDialog } from './restart-dialog.ts'
import { renderTaskDrawer } from './task-drawer.ts'
import { renderWorkflowDefinition } from './workflow-definition.ts'
import { renderWorkflowJobs } from './workflow-jobs.ts'
import { renderWorkflowList } from './workflow-list.ts'

/** 页面标题与副标题。 */
function pageHeading(page: AppContext): { title: string; subtitle: string } {
  const { t, state } = page
  const route = state.route
  if (route.kind === 'workflows') return { title: '', subtitle: '' }
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
  const workflowAvailability = state.workflow.data?.workflow?.availability
  const jobAvailability = state.job.data?.availability
  const availability = route.kind === 'job' ? jobAvailability : workflowAvailability
  const unavailable = availability?.available === false
  const workflowAvailable =
    workflowStatus !== undefined && workflowStatus !== 'retired' && !unavailable

  const tabs =
    route.kind === 'workflow'
      ? [
          {
            value: 'jobs',
            label: h(TabLabel, { text: t('jobsTab') }),
            id: 'buka-workflows-tab-jobs',
            panelId: 'buka-workflows-panel-jobs',
          },
          {
            value: 'definition',
            label: h(TabLabel, { text: t('definitionTab') }),
            id: 'buka-workflows-tab-definition',
            panelId: 'buka-workflows-panel-definition',
          },
        ]
      : route.kind === 'job'
        ? [
            {
              value: 'overview',
              label: h(TabLabel, { text: t('overviewTab') }),
              id: 'buka-workflows-tab-overview',
              panelId: 'buka-workflows-panel-overview',
            },
            {
              value: 'flow',
              label: h(TabLabel, { text: t('flowTab') }),
              id: 'buka-workflows-tab-flow',
              panelId: 'buka-workflows-panel-flow',
            },
            {
              value: 'board',
              label: h(TabLabel, { text: t('boardTab') }),
              id: 'buka-workflows-tab-board',
              panelId: 'buka-workflows-panel-board',
            },
            {
              value: 'outputs',
              label: h(TabLabel, { text: t('outputsTab') }),
              id: 'buka-workflows-tab-outputs',
              panelId: 'buka-workflows-panel-outputs',
            },
          ]
        : null
  const activeTab = route.kind === 'workflow' ? route.tab : route.kind === 'job' ? route.view : ''
  /** 结构图与实时流程是整块画布：画布撑满正文，图例固定在底部。 */
  const graphView =
    (route.kind === 'workflow' && route.tab === 'definition') ||
    (route.kind === 'job' && route.view === 'flow')

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

  const toolbarNode = h('div', { className: 'buka-workflows-toolbar' }, ...toolbar)
  const titleGroup = h(
    'div',
    { className: 'buka-workflows-titleGroup' },
    h(
      'button',
      {
        type: 'button',
        className: 'buka-workflows-back',
        title: t('back'),
        'aria-label': t('back'),
        onClick: route.kind === 'workflow' ? actions.backToWorkflows : actions.backToWorkflow,
      },
      h(IconChevronRightOutlineRegular, { size: 13 }),
    ),
    h('h1', { className: 'buka-workflows-title' }, heading.title),
    route.kind === 'workflow' && retired ? renderStatusTag(t, workflowStatus, 'workflow') : null,
    route.kind === 'workflow' && unavailable
      ? h(
          'span',
          { className: 'buka-workflows-titleMeta' },
          h('span', { className: 'buka-workflows-unavailableTag' }, t('workerUnavailable')),
        )
      : null,
    route.kind === 'job' && unavailable
      ? h(
          'span',
          { className: 'buka-workflows-titleMeta' },
          h('span', { className: 'buka-workflows-unavailableTag' }, t('workerUnavailable')),
        )
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
  )
  const tabsNode =
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
        )

  return h(
    'div',
    {
      className: `buka-workflows-page${graphView ? ' is-graph' : ''}`,
    },
    h(
      'header',
      { className: 'buka-workflows-head' },
      h(
        'div',
        { className: 'buka-workflows-headInner' },
        route.kind === 'workflows'
          ? // 列表页是首页：顶部两个页签就是这一屏的标题，操作按钮在页签带右侧。
            h(
              'div',
              { className: 'buka-workflows-bar' },
              h('div', { className: 'buka-workflows-barTabs' }, page.topTabs),
              toolbarNode,
            )
          : // 详情页独立页头：返回 / 标题 / 状态与操作同一行，页内页签单独一行；
            // 首页的「工作流 / 执行者」页签只留在列表页，不再压在详情页上方。
            h('div', { className: 'buka-workflows-titleRow' }, titleGroup, toolbarNode),
        tabsNode,
      ),
    ),
    h(
      'div',
      {
        key: routeHash(route),
        className: `buka-workflows-body${graphView ? ' is-graph' : ''}`,
      },
      renderAvailabilityNotice(page, availability),
      body,
    ),
    renderNewJobDialog(page),
    renderRestartDialog(page),
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
