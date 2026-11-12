/**
 * 工作流详情：流程图 + 岗位 / 任务类型 / 边 / 开始结束契约 / 预算 + 作业列表。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import type { GraphEdgeInput, GraphNodeInput } from '../graph/layout.ts'
import { renderWorkflowGraph } from '../graph/render.ts'
import { fill } from '../i18n.ts'
import { allTaskTypes, edgesOf, graphPositions, positionsOf, taskCountsText } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import {
  renderEmpty,
  renderExecutor,
  renderFailure,
  renderKv,
  renderLoading,
  renderSchema,
  renderSection,
  renderStatusTag,
  timeText,
} from './parts.ts'

/**
 * 工作流详情视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderWorkflowDetail(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.workflow
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)
  const detail = loaded.data
  const workflow = detail.workflow
  if (workflow === undefined) return renderEmpty(t('notFound'), t('definitionMissing'))
  const definition = workflow.definition ?? null

  const graphPositionsList = Array.isArray(detail.graph?.positions)
    ? detail.graph.positions
    : graphPositions(definition)
  const graphEdges = Array.isArray(detail.graph?.edges) ? detail.graph.edges : definition?.edges
  const nodes: GraphNodeInput[] = [
    {
      id: 'start',
      label: detail.graph?.start?.label ?? t('graphStart'),
      kind: 'start',
      status: 'idle',
    },
    ...graphPositionsList
      .filter((position) => typeof position?.id === 'string' && position.id !== '')
      .map((position) => ({
        id: position.id as string,
        label:
          typeof position.label === 'string' && position.label !== ''
            ? position.label
            : (position.id as string),
        kind: 'position' as const,
        executor: position.executor ?? null,
        ...(typeof position.executor?.avatar === 'string' && position.executor.avatar !== ''
          ? { avatar: position.executor.avatar }
          : {}),
        status: 'idle',
        meta: renderExecutor(page, position.executor),
      })),
    {
      id: 'end',
      label: detail.graph?.end?.label ?? t('graphEnd'),
      kind: 'end',
      status: 'idle',
    },
  ]
  const edges: GraphEdgeInput[] = (Array.isArray(graphEdges) ? graphEdges : []).map((edge) => ({
    from: typeof edge.from === 'string' ? edge.from : '',
    to: typeof edge.to === 'string' ? edge.to : '',
    types: Array.isArray(edge.types) ? edge.types.filter((type) => typeof type === 'string') : [],
    back: edge.back === true,
  }))
  const jobs = Array.isArray(detail.jobs) ? detail.jobs : []
  const allTypes = allTaskTypes(definition)

  return h(
    'div',
    { className: 'buka-workflows-detail' },
    h(
      'div',
      { className: 'buka-workflows-workflowHead' },
      h(
        'div',
        { className: 'buka-workflows-workflowTitleGroup' },
        h(
          'h2',
          { className: 'buka-workflows-workflowTitle' },
          typeof workflow.name === 'string' && workflow.name !== '' ? workflow.name : workflow.id,
        ),
        h(Tag, { tone: 'neutral' }, `v${workflow.version ?? 0}`),
        renderStatusTag(t, workflow.status, 'workflow'),
      ),
      typeof workflow.description === 'string' && workflow.description !== ''
        ? h('p', { className: 'buka-workflows-workflowDesc' }, workflow.description)
        : null,
    ),
    renderSection(
      t('graphTitle'),
      nodes.length === 0
        ? renderEmpty(t('definitionMissing'))
        : renderWorkflowGraph(page, { nodes, edges }),
    ),
    renderSection(
      `${t('positionsTitle')} / ${t('taskTypesTitle')}`,
      positionsOf(definition).length === 0
        ? renderEmpty(t('positionsEmpty'))
        : h(
            'div',
            { className: 'buka-workflows-positionList' },
            ...positionsOf(definition).map((position) =>
              h(
                'article',
                { key: position.id, className: 'buka-workflows-positionCard' },
                h(
                  'div',
                  { className: 'buka-workflows-positionHead' },
                  h('code', { className: 'buka-workflows-inlineCode' }, position.id),
                  h('span', { className: 'buka-workflows-positionLabel' }, position.label),
                  h(Tag, { tone: 'neutral' }, renderExecutor(page, position.executor)),
                ),
                position.description === ''
                  ? null
                  : h('p', { className: 'buka-workflows-positionDesc' }, position.description),
                position.taskTypes.length === 0
                  ? h('p', { className: 'buka-workflows-hint' }, t('taskTypesTitle'))
                  : h(
                      'div',
                      { className: 'buka-workflows-typeList' },
                      ...position.taskTypes.map((type) =>
                        h(
                          'details',
                          { key: String(type.id), className: 'buka-workflows-typeCard' },
                          h(
                            'summary',
                            { className: 'buka-workflows-typeHead' },
                            h('code', { className: 'buka-workflows-inlineCode' }, String(type.id)),
                            h(
                              'span',
                              { className: 'buka-workflows-typeLabel' },
                              type.label ?? String(type.id),
                            ),
                            typeof type.assistant === 'string' && type.assistant !== ''
                              ? h(
                                  Tag,
                                  { tone: 'neutral' },
                                  `${t('taskTypeAssistant')} · ${type.assistant}`,
                                )
                              : null,
                            type.mode === 'plan'
                              ? h(Tag, { tone: 'info' }, t('taskTypeModePlan'))
                              : null,
                          ),
                          typeof type.description === 'string' && type.description !== ''
                            ? h('p', { className: 'buka-workflows-typeDesc' }, type.description)
                            : null,
                          h(
                            'div',
                            { className: 'buka-workflows-typeColumns' },
                            h(
                              'div',
                              { className: 'buka-workflows-typeColumn' },
                              h(
                                'span',
                                { className: 'buka-workflows-fieldLabel' },
                                t('taskTypePayload'),
                              ),
                              renderSchema(page, type.payload),
                            ),
                            h(
                              'div',
                              { className: 'buka-workflows-typeColumn' },
                              h(
                                'span',
                                { className: 'buka-workflows-fieldLabel' },
                                t('taskTypeOutput'),
                              ),
                              renderSchema(page, type.output),
                            ),
                          ),
                          Array.isArray(type.requires) && type.requires.length > 0
                            ? h(
                                'div',
                                { className: 'buka-workflows-requiresRow' },
                                h(
                                  'span',
                                  { className: 'buka-workflows-fieldLabel' },
                                  t('taskTypeRequires'),
                                ),
                                ...type.requires.map((require, index) =>
                                  h(
                                    Tag,
                                    { key: `${index}`, tone: 'neutral' },
                                    (Array.isArray(require?.types) ? require.types : []).join(
                                      ' / ',
                                    ),
                                  ),
                                ),
                              )
                            : null,
                        ),
                      ),
                    ),
              ),
            ),
          ),
      h('span', { className: 'buka-workflows-hint' }, `${allTypes.length} ${t('taskTypesTitle')}`),
    ),
    renderSection(
      t('edgesTitle'),
      edgesOf(definition).length === 0
        ? renderEmpty(t('edgesEmpty'))
        : h(
            'ul',
            { className: 'buka-workflows-edgeList' },
            ...edgesOf(definition).map((edge, index) =>
              h(
                'li',
                { key: `${edge.from}-${edge.to}-${index}`, className: 'buka-workflows-edgeRow' },
                h('code', { className: 'buka-workflows-inlineCode' }, edge.from),
                h('span', { className: 'buka-workflows-edgeArrowText', 'aria-hidden': true }, '→'),
                h('code', { className: 'buka-workflows-inlineCode' }, edge.to),
                edge.types.length === 0
                  ? h('span', { className: 'buka-workflows-hint' }, t('edgeAllTypes'))
                  : h(
                      'span',
                      { className: 'buka-workflows-edgeTypes' },
                      ...edge.types.map((type) => h(Tag, { key: type, tone: 'neutral' }, type)),
                    ),
                edge.back ? h(Tag, { tone: 'warning' }, t('edgeBack')) : null,
              ),
            ),
          ),
    ),
    h(
      'div',
      { className: 'buka-workflows-contractGrid' },
      renderSection(
        t('startContractTitle'),
        h(
          'div',
          { className: 'buka-workflows-contractBody' },
          h('p', { className: 'buka-workflows-hint' }, t('startContractHint')),
          h(
            'div',
            { className: 'buka-workflows-typeColumns' },
            h(
              'div',
              { className: 'buka-workflows-typeColumn' },
              h('span', { className: 'buka-workflows-fieldLabel' }, t('taskTypePayload')),
              renderSchema(page, definition?.start?.task?.payload),
            ),
            h(
              'div',
              { className: 'buka-workflows-typeColumn' },
              h('span', { className: 'buka-workflows-fieldLabel' }, t('taskTypeOutput')),
              renderSchema(page, definition?.start?.task?.output),
            ),
          ),
        ),
      ),
      renderSection(
        t('endContractTitle'),
        h(
          'div',
          { className: 'buka-workflows-contractBody' },
          h('p', { className: 'buka-workflows-hint' }, t('endContractHint')),
          renderSchema(page, definition?.end?.task?.payload),
        ),
      ),
    ),
    renderSection(
      t('budgetsTitle'),
      renderKv([
        [
          t('budgetMaxTasks'),
          typeof definition?.budgets?.maxTasks === 'number'
            ? String(definition.budgets.maxTasks)
            : t('budgetUnset'),
        ],
        [
          t('budgetMaxDuration'),
          typeof definition?.budgets?.maxDurationHours === 'number'
            ? `${definition.budgets.maxDurationHours} ${t('budgetHours')}`
            : t('budgetUnset'),
        ],
      ]),
    ),
    renderSection(
      t('workflowJobsTitle'),
      jobs.length === 0
        ? renderEmpty(t('workflowJobsEmpty'), t('workflowJobsEmptyHint'))
        : h(
            'ul',
            { className: 'buka-workflows-cards' },
            ...jobs.map((job) =>
              h(
                'li',
                { key: job.id },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workflows-card',
                    onClick: () => actions.openJob(workflowIdOf(page), job.id),
                  },
                  h(
                    'span',
                    { className: 'buka-workflows-cardHead' },
                    h(
                      'span',
                      { className: 'buka-workflows-cardTitleGroup' },
                      h(
                        'span',
                        { className: 'buka-workflows-seq' },
                        fill(t, 'jobSeq', { seq: job.seq ?? 0 }),
                      ),
                      h(
                        'span',
                        { className: 'buka-workflows-cardTitle' },
                        job.inputSummary ?? job.id,
                      ),
                    ),
                    h(
                      'span',
                      { className: 'buka-workflows-cardTags' },
                      renderStatusTag(t, job.status, 'job'),
                    ),
                  ),
                  h(
                    'span',
                    { className: 'buka-workflows-meta' },
                    [taskCountsText(job.taskCounts ?? null, t), timeText(job.createdAt)]
                      .filter((part) => part !== '')
                      .join(' · '),
                  ),
                ),
              ),
            ),
          ),
    ),
  )
}

/**
 * 当前工作流 id。
 *
 * @param page
 * @returns
 */
function workflowIdOf(page: AppContext): string {
  if (page.state.route.kind === 'workflow') return page.state.route.workflowId
  return page.state.workflow.data?.workflow?.id ?? ''
}
