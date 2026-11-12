/**
 * 工作流列表：名称、描述、版本、状态与作业数。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { formatTime } from '../format.ts'
import { fill } from '../i18n.ts'
import type { AppContext } from '../page-context.ts'
import { renderEmpty, renderFailure, renderLoading, renderStatusTag } from './parts.ts'

/**
 * 工作流列表视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderWorkflowList(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const workflows = state.workflows

  if (workflows.error !== null && workflows.data === null) {
    return renderFailure(page, workflows.error, actions.refresh)
  }
  if (workflows.status !== 'ready' && workflows.data === null) return renderLoading(page)
  const items = workflows.data ?? []
  if (items.length === 0) {
    return renderEmpty(t('workflowsEmpty'), t('workflowsEmptyHint'))
  }

  return h(
    'div',
    { className: 'buka-workflows-listPane' },
    h('p', { className: 'buka-workflows-hint' }, t('workflowsHint')),
    h(
      'ul',
      { className: 'buka-workflows-cards' },
      ...items.map((workflow) =>
        h(
          'li',
          { key: workflow.id },
          h(
            'button',
            {
              type: 'button',
              className: 'buka-workflows-card',
              onClick: () => actions.openWorkflow(workflow.id),
            },
            h(
              'span',
              { className: 'buka-workflows-cardHead' },
              h(
                'span',
                { className: 'buka-workflows-cardTitleGroup' },
                h(
                  'span',
                  { className: 'buka-workflows-cardTitle' },
                  typeof workflow.name === 'string' && workflow.name !== ''
                    ? workflow.name
                    : workflow.id,
                ),
                typeof workflow.version === 'number'
                  ? h(Tag, { tone: 'neutral' }, `v${workflow.version}`)
                  : null,
              ),
              h(
                'span',
                { className: 'buka-workflows-cardTags' },
                renderStatusTag(t, workflow.status, 'workflow'),
              ),
            ),
            typeof workflow.description === 'string' && workflow.description !== ''
              ? h('span', { className: 'buka-workflows-cardDesc' }, workflow.description)
              : null,
            h(
              'span',
              { className: 'buka-workflows-meta' },
              [
                fill(t, 'jobCount', {
                  n: typeof workflow.jobCount === 'number' ? workflow.jobCount : 0,
                }),
                typeof workflow.updatedAt === 'string' && workflow.updatedAt !== ''
                  ? `${t('updatedAt')} ${formatTime(workflow.updatedAt)}`
                  : '',
              ]
                .filter((part) => part !== '')
                .join(' · '),
            ),
          ),
        ),
      ),
    ),
  )
}
