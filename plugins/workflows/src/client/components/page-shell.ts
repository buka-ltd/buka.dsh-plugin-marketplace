/**
 * 页面外壳：面包屑返回、标题、工具栏、内容区、页脚、Toast 与抽屉 / 对话框。
 */

import {
  Button,
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { fill } from '../i18n.ts'
import type { AppContext } from '../page-context.ts'
import { renderAttachmentDrawer } from './attachments.ts'
import { renderJobDetail } from './job-detail.ts'
import { renderNewJobDialog } from './new-job-dialog.ts'
import { renderTaskDrawer } from './task-drawer.ts'
import { renderWorkflowDetail } from './workflow-detail.ts'
import { renderWorkflowList } from './workflow-list.ts'

/**
 * 页面外壳。
 *
 * @param page
 * @returns React 元素
 */
export function renderPage(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const route = state.route
  const backButton =
    route.kind === 'workflows'
      ? null
      : h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workflows-toolbarButton buka-workflows-back',
            icon: h(IconChevronRightOutlineRegular, { size: 13 }),
            onClick: route.kind === 'workflow' ? actions.backToWorkflows : actions.backToWorkflow,
          },
          route.kind === 'workflow' ? t('backToWorkflows') : t('backToWorkflow'),
        )

  const title =
    route.kind === 'workflows'
      ? t('title')
      : route.kind === 'workflow'
        ? (state.workflow.data?.workflow?.name ?? route.workflowId)
        : fill(t, 'jobSeq', { seq: state.job.data?.job?.seq ?? 0 })

  const workflowStatus = state.workflow.data?.workflow?.status
  const jobStatus = state.job.data?.job?.status
  const live = jobStatus === 'running'

  return h(
    'div',
    { className: `buka-workflows-page${route.kind === 'job' ? ' is-wide' : ''}` },
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
            backButton,
            h('h1', { className: 'buka-workflows-title' }, title),
          ),
          h(
            'div',
            { className: 'buka-workflows-toolbar' },
            ...(route.kind === 'workflow'
              ? [
                  h(
                    Button,
                    {
                      key: 'activate',
                      variant: 'outline',
                      size: 'sm',
                      className: 'buka-workflows-toolbarButton',
                      onClick: () => void actions.activateWorkflow(workflowStatus !== 'active'),
                      disabled: state.busy === 'activate' || workflowStatus === undefined,
                    },
                    workflowStatus === 'active' ? t('deactivate') : t('activate'),
                  ),
                  h(
                    Button,
                    {
                      key: 'new-job',
                      variant: 'primary',
                      size: 'sm',
                      className: 'buka-workflows-toolbarButton',
                      onClick: actions.openNewJob,
                      disabled: workflowStatus !== 'active',
                    },
                    t('newJob'),
                  ),
                ]
              : []),
            ...(route.kind === 'job'
              ? [
                  h(
                    Button,
                    {
                      key: 'cancel-job',
                      variant: 'outline',
                      size: 'sm',
                      className: 'buka-workflows-toolbarButton',
                      onClick: () => {
                        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                          if (!window.confirm(t('cancelJobConfirm'))) return
                        }
                        void actions.cancelJob()
                      },
                      disabled: state.busy === 'cancel-job' || jobStatus !== 'running',
                    },
                    t('cancelJob'),
                  ),
                ]
              : []),
            h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                className: 'buka-workflows-toolbarButton',
                icon: h(IconRefreshOutlineRegular, { size: 13 }),
                onClick: actions.refresh,
              },
              t('refresh'),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      {
        className: `buka-workflows-body${route.kind === 'job' ? ' is-wide' : ''}`,
      },
      route.kind === 'workflows'
        ? renderWorkflowList(page)
        : route.kind === 'workflow'
          ? renderWorkflowDetail(page)
          : renderJobDetail(page),
    ),
    h(
      'footer',
      { className: 'buka-workflows-footer' },
      h(
        'p',
        { className: 'buka-workflows-statusWithDot', role: 'status' },
        h(StateDot, { state: live ? 'ongoing' : 'idle' }),
        live ? t('autoRefreshLive') : t('autoRefreshIdle'),
      ),
    ),
    renderNewJobDialog(page),
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
