/**
 * 工作流列表：名称、描述、版本、状态与作业数；停用的工作流灰显并排在后面。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { formatTime } from '../format.ts'
import { fill } from '../i18n.ts'
import type { AppContext } from '../page-context.ts'
import type { WorkflowSummary } from '../types.ts'
import { renderEmpty, renderFailure, renderLoading } from './parts.ts'

/** 工作流列表视图。 */
export function renderWorkflowList(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const workflows = state.workflows

  if (workflows.error !== null && workflows.data === null) {
    return renderFailure(page, workflows.error, actions.refresh)
  }
  if (workflows.status !== 'ready' && workflows.data === null) return renderLoading(page)
  const all = workflows.data ?? []
  if (all.length === 0) {
    return renderEmpty(t('workflowsEmpty'), t('workflowsEmptyHint'))
  }
  // 停用的工作流留在列表里，灰显并排在后面。
  const sorted = [...all].sort((left, right) => {
    const leftRetired = left.status === 'retired' ? 1 : 0
    const rightRetired = right.status === 'retired' ? 1 : 0
    return leftRetired - rightRetired
  })

  return h(
    'div',
    { className: 'buka-workflows-listPane' },
    h(
      'ul',
      { className: 'buka-workflows-cards' },
      ...sorted.map((workflow) => renderWorkflowCard(page, workflow)),
    ),
  )
}

/** 一张工作流卡片。 */
function renderWorkflowCard(page: AppContext, workflow: WorkflowSummary): React.ReactElement {
  const { t, actions } = page
  const retired = workflow.status === 'retired'
  return h(
    'li',
    { key: workflow.id },
    h(
      'button',
      {
        type: 'button',
        className: `buka-workflows-card${retired ? ' is-disabled' : ''}`,
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
            typeof workflow.name === 'string' && workflow.name !== '' ? workflow.name : workflow.id,
          ),
          typeof workflow.version === 'number'
            ? h(Tag, { tone: 'neutral' }, `v${workflow.version}`)
            : null,
        ),
        retired ? h(Tag, { tone: 'neutral' }, t('workflowRetired')) : null,
      ),
      typeof workflow.description === 'string' && workflow.description !== ''
        ? h('span', { className: 'buka-workflows-cardDesc' }, workflow.description)
        : null,
      h(
        'span',
        { className: 'buka-workflows-meta' },
        [
          fill(t, 'jobCount', { n: typeof workflow.jobCount === 'number' ? workflow.jobCount : 0 }),
          typeof workflow.updatedAt === 'string' && workflow.updatedAt !== ''
            ? `${t('updatedAt')} ${formatTime(workflow.updatedAt)}`
            : '',
          retired ? t('workflowRetiredHint') : '',
        ]
          .filter((part) => part !== '')
          .join(' · '),
      ),
    ),
  )
}
