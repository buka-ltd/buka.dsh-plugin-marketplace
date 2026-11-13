/**
 * 作业详情：四个视图（概览 / 实时流程 / 看板 / 资产）的分发与交付重试提示。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import type { AppContext } from '../page-context.ts'
import { renderBoard } from './board.ts'
import { renderJobFlow } from './job-flow.ts'
import { renderJobOutputs } from './job-outputs.ts'
import { renderJobOverview } from './job-overview.ts'
import { renderEmpty, renderFailure, renderLoading } from './parts.ts'

/** 作业详情视图。 */
export function renderJobDetail(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.job
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)
  const job = loaded.data.job
  if (job === undefined) return renderEmpty(t('notFound'))

  const view = state.route.kind === 'job' ? state.route.view : 'overview'
  const body =
    view === 'flow'
      ? renderJobFlow(page)
      : view === 'board'
        ? renderBoard(page)
        : view === 'outputs'
          ? renderJobOutputs(page)
          : renderJobOverview(page)

  return h(
    'div',
    { className: 'buka-workflows-detail' },
    page.state.job.data?.canRetryDelivery === true
      ? h(
          'div',
          { className: 'buka-workflows-notice', role: 'status' },
          h('p', { className: 'buka-workflows-noticeText' }, t('deliveryRetryHint')),
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: () => void actions.retryDelivery(),
              disabled: state.busy === 'retry-delivery',
            },
            t('retryDelivery'),
          ),
        )
      : null,
    body,
  )
}
