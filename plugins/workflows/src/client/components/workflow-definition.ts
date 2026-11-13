/**
 * 工作流页的「定义结构」Tab：可交互的分层图；点节点 / 通道在右侧抽屉里看细节。
 */

import { Button, IconInfoOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import type { GraphEdgeInput, GraphNodeInput } from '../graph/layout.ts'
import { renderWorkflowGraph } from '../graph/render.ts'
import { channelsOf, currentDefinition, positionsOf } from '../model.ts'
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
  const defined = channelsOf(definition)

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
  const edges: GraphEdgeInput[] = defined.map((channel) => ({
    id: channel.id,
    label: channel.label,
    from: channel.from,
    to: channel.to,
    types: channel.types,
    back: channel.back,
  }))
  const selection = state.definitionSelection
  const selectedNodeId =
    selection !== null && selection.kind === 'position'
      ? selection.id
      : selection !== null && (selection.kind === 'start' || selection.kind === 'end')
        ? selection.kind
        : null
  const selectedChannelId = selection !== null && selection.kind === 'channel' ? selection.id : null

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
      selectedChannelId,
      onNodeClick: (id) => {
        if (id === 'start' || id === 'end') actions.selectDefinition({ kind: id })
        else actions.selectDefinition({ kind: 'position', id })
      },
      onEdgeClick: (edge) => {
        actions.selectDefinition({ kind: 'channel', id: edge.id })
      },
    }),
  )
}
