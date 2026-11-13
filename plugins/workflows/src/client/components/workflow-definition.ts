/**
 * 工作流页的「定义结构」Tab：可交互的分层图；点节点 / 连线在右侧抽屉里看细节。
 */

import { Button, IconInfoOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import type { GraphEdgeInput, GraphNodeInput } from '../graph/layout.ts'
import { renderWorkflowGraph } from '../graph/render.ts'
import { currentDefinition, edgesOf, positionsOf } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { renderEmpty, renderExecutor, renderFailure, renderLoading } from './parts.ts'

/** 定义结构视图。 */
export function renderWorkflowDefinition(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.workflow
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)
  const definition = currentDefinition(state)
  if (definition === null) return renderEmpty(t('definitionMissing'))
  const positions = positionsOf(definition)
  const defined = edgesOf(definition)

  const nodes: GraphNodeInput[] = [
    {
      id: 'start',
      label: t('graphStart'),
      kind: 'start',
      status: 'idle',
    },
    ...positions.map((position) => ({
      id: position.id,
      label: position.label,
      kind: 'position' as const,
      executor: position.executor,
      ...(typeof position.executor.avatar === 'string' && position.executor.avatar !== ''
        ? { avatar: position.executor.avatar }
        : {}),
      status: 'idle',
      title: `${position.label} · ${renderExecutor(page, position.executor)}`,
    })),
    {
      id: 'end',
      label: t('graphEnd'),
      kind: 'end',
      status: 'idle',
    },
  ]
  const edges: GraphEdgeInput[] = defined.map((edge, index) => ({
    from: edge.from,
    to: edge.to,
    types: edge.types,
    back: edge.back,
    index,
  }))
  const selection = state.definitionSelection
  const selectedNodeId =
    selection !== null && selection.kind === 'position'
      ? selection.id
      : selection !== null && (selection.kind === 'start' || selection.kind === 'end')
        ? selection.kind
        : null
  const selectedEdge =
    selection !== null && selection.kind === 'edge' ? defined[selection.index] : undefined
  const selectedEdgeKey =
    selectedEdge === undefined ? null : `${selectedEdge.from}->${selectedEdge.to}`

  return h(
    'div',
    { className: 'buka-workflows-definitionPane' },
    h(
      'div',
      { className: 'buka-workflows-definitionToolbar' },
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          className: 'buka-workflows-smallButton',
          icon: h(IconInfoOutlineRegular, { size: 13 }),
          onClick: () => actions.selectDefinition({ kind: 'info' }),
        },
        t('definitionInfo'),
      ),
      h('span', { className: 'buka-workflows-hint' }, t('definitionHint')),
    ),
    renderWorkflowGraph(page, {
      nodes,
      edges,
      mode: 'definition',
      selectedNodeId,
      selectedEdgeKey,
      onNodeClick: (id) => {
        if (id === 'start' || id === 'end') actions.selectDefinition({ kind: id })
        else actions.selectDefinition({ kind: 'position', id })
      },
      onEdgeClick: (edge) => {
        if (edge.index >= 0) actions.selectDefinition({ kind: 'edge', index: edge.index })
      },
    }),
  )
}
