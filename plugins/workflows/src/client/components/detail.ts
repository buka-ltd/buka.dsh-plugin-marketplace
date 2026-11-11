/**
 * 运行详情视图：图占据页面主体，节点 / 连线详情在右侧抽屉。
 */

import {
  Button,
  IconChevronRightOutlineRegular,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { RunGraphNode } from '../../graph.ts'
import type { WorkflowRunRecord } from '../../run-store.ts'
import { h } from '../element.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientDefinition, ClientGraph, ClientStep } from '../types.ts'
import { stepsOf } from '../types.ts'

/**
 * 运行详情的共享数据：详情主体、节点抽屉、连线抽屉都从这里取。
 *
 * @returns 详情主体、节点抽屉与连线抽屉共用的数据；没有选中运行时是 null
 */
export function runDetailModel(page: PageContext): {
  run: WorkflowRunRecord
  steps: ClientStep[]
  nodeResults: Array<Record<string, unknown>>
  fullResults: Map<string, Record<string, unknown>>
  definition: ClientDefinition | null
  graph: ClientGraph | null
  nodes: RunGraphNode[]
} | null {
  const { detail } = page

  const data = detail.data
  if (data === null) return null
  const run = data.run
  if (run === null) return null
  const steps = stepsOf(run)
  const nodeResults = Array.isArray(data.nodeResults) ? data.nodeResults : []
  const fullResults = new Map(
    nodeResults.map((result) => [`${String(result.seq)}:${String(result.nodeId)}`, result]),
  )
  const definition = data.definition
  const graph = data.graph
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  return { run, steps, nodeResults, fullResults, definition, graph, nodes }
}

/**
 * 详情视图：图占据页面主体；节点详情在右侧抽屉里打开。
 *
 * @returns React 元素
 */
export function renderDetail(page: PageContext): React.ReactElement {
  const {
    t,
    setSelectedId,
    detail,
    selectedNodeId,
    renderGraph,
    renderUserNotice,
    renderInteractionNotice,
    runDetailModel,
  } = page

  if (detail.error !== null && detail.data === null) {
    return h(
      'p',
      { className: 'buka-workflows-failure', role: 'alert' },
      `${t('loadFailed')} ${detail.error}`,
    )
  }
  if (detail.status === 'loading' && detail.data === null) {
    return h(
      'p',
      { className: 'buka-workflows-statusWithDot', role: 'status' },
      h(StateDot, { state: 'ongoing' }),
      t('loading'),
    )
  }
  const model = runDetailModel()
  if (model === null) {
    return h('p', { className: 'buka-workflows-empty' }, t('empty'))
  }
  const { run, graph, nodes } = model
  const activeNodeId =
    selectedNodeId !== null && nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : null
  const graphBody =
    graph === null
      ? h('p', { className: 'buka-workflows-empty' }, t('noGraph'))
      : renderGraph(graph, activeNodeId)
  // 用户介入提示排在机器人提问 / 审批提示之前；没有等待中的提示时不留空槽。
  const notices = [renderUserNotice(run), renderInteractionNotice(run)].filter(
    (notice) => notice !== null,
  )
  return h(
    'div',
    { className: 'buka-workflows-pageBody buka-workflows-detail' },
    h(
      Button,
      {
        variant: 'ghost',
        size: 'sm',
        className: 'buka-workflows-detailBackButton buka-workflows-back',
        icon: h(IconChevronRightOutlineRegular, { size: 14 }),
        onClick: () => setSelectedId(null),
      },
      t('back'),
    ),
    ...notices,
    graphBody,
  )
}
