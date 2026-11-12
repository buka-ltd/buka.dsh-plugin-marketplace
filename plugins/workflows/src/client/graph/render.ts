/**
 * 流程图渲染：SVG 连线 + 绝对定位的胶囊节点。
 */

import type React from 'react'

import { renderAvatar } from '../avatars.ts'
import { h } from '../element.ts'
import { stateClass } from '../format.ts'
import type { AppContext } from '../page-context.ts'
import { type GraphEdgeInput, type GraphNodeInput, layoutGraph } from './layout.ts'

/** 渲染参数。 */
export interface RenderGraphOptions {
  nodes: GraphNodeInput[]
  edges: GraphEdgeInput[]
  /** 点节点时打开对应面板；不传则不响应点击。 */
  onNodeClick?: ((id: string) => void) | null
  /** 当前选中的节点 id。 */
  selectedId?: string | null
  /** 图下方的说明。 */
  caption?: string | null
}

/**
 * 画一张流程图。节点是岗位 / 开始 / 结束，边是定义里的白名单与回边。
 *
 * @param page
 * @param options
 * @returns React 元素
 */
export function renderWorkflowGraph(
  page: AppContext,
  options: RenderGraphOptions,
): React.ReactElement {
  const { t } = page
  const layout = layoutGraph(options.nodes, options.edges)
  const selectedId = options.selectedId ?? null
  const onNodeClick = options.onNodeClick ?? null
  const idle = layout.nodes.every((node) => (node.status ?? 'idle') === 'idle')

  return h(
    'div',
    { className: 'buka-workflows-graphPane' },
    h(
      'div',
      {
        className: 'buka-workflows-vgraph',
        style: { width: `${layout.width}px`, height: `${layout.height}px` },
        role: 'group',
        'aria-label': t('graphAria'),
      },
      h(
        'svg',
        {
          className: 'buka-workflows-vgraphSvg',
          width: layout.width,
          height: layout.height,
          viewBox: `0 0 ${layout.width} ${layout.height}`,
        },
        ...layout.edges.map((edge) =>
          h('path', {
            key: edge.key,
            className: `buka-workflows-edge is-${edge.kind}`,
            d: edge.d,
          }),
        ),
        ...layout.edges.map((edge) =>
          h(
            'g',
            {
              key: `arrow-${edge.key}`,
              className: `buka-workflows-edgeArrow is-${edge.kind}`,
              transform: `translate(${edge.arrow.x} ${edge.arrow.y}) rotate(${edge.arrow.angle})`,
            },
            h('path', { d: 'M-4,-3.6 L4,0 L-4,3.6 Z' }),
          ),
        ),
      ),
      ...layout.nodes.map((node) => {
        const isSelected = selectedId === node.id
        const status = node.status ?? 'idle'
        const clickable = onNodeClick !== null
        const tag =
          node.kind === 'position'
            ? node.executor?.kind === 'human'
              ? 'is-human'
              : 'is-robot'
            : node.kind === 'start'
              ? 'is-start'
              : 'is-end'
        return h(
          'div',
          {
            key: node.id,
            className: 'buka-workflows-vgraphNode',
            style: {
              left: `${node.x - node.width / 2}px`,
              top: `${node.y - node.height / 2}px`,
              width: `${node.width}px`,
              height: `${node.height}px`,
            },
          },
          clickable
            ? h(
                'button',
                {
                  type: 'button',
                  className: `buka-workflows-capsule ${tag} is-${stateClass(status)}${
                    idle ? ' is-idle' : ''
                  }${isSelected ? ' is-selected' : ''}${
                    typeof node.avatar === 'string' && node.avatar !== '' ? ' has-avatar' : ''
                  }`,
                  title: node.title ?? node.label,
                  'aria-pressed': isSelected,
                  onClick: () => onNodeClick(node.id),
                },
                renderAvatar(node.avatar, 20, 'buka-workflows-capsuleAvatar'),
                h(
                  'span',
                  { className: 'buka-workflows-capsuleText' },
                  h('span', { className: 'buka-workflows-capsuleLabel' }, node.label),
                  typeof node.meta === 'string' && node.meta !== ''
                    ? h('span', { className: 'buka-workflows-capsuleMeta' }, node.meta)
                    : null,
                ),
              )
            : h(
                'span',
                {
                  className: `buka-workflows-capsule ${tag} is-${stateClass(status)}${
                    idle ? ' is-idle' : ''
                  }${typeof node.avatar === 'string' && node.avatar !== '' ? ' has-avatar' : ''}`,
                  title: node.title ?? node.label,
                },
                renderAvatar(node.avatar, 20, 'buka-workflows-capsuleAvatar'),
                h(
                  'span',
                  { className: 'buka-workflows-capsuleText' },
                  h('span', { className: 'buka-workflows-capsuleLabel' }, node.label),
                  typeof node.meta === 'string' && node.meta !== ''
                    ? h('span', { className: 'buka-workflows-capsuleMeta' }, node.meta)
                    : null,
                ),
              ),
        )
      }),
    ),
    options.caption === null || options.caption === undefined
      ? null
      : h('p', { className: 'buka-workflows-hint buka-workflows-graphCaption' }, options.caption),
    renderGraphLegend(page),
  )
}

/**
 * 图例：节点类型、任务状态、连线。
 *
 * @param page
 * @returns
 */
export function renderGraphLegend(page: AppContext): React.ReactElement {
  const { t } = page
  const types: Array<[string, string]> = [
    ['is-start', t('graphStart')],
    ['is-robot', t('graphRobot')],
    ['is-human', t('graphHuman')],
    ['is-end', t('graphEnd')],
  ]
  const states: Array<[string, string]> = [
    ['done', t('statusCompleted')],
    ['running', t('statusRunning')],
    ['waiting', t('statusReady')],
    ['failed', t('statusFailed')],
    ['idle', t('graphIdle')],
  ]
  const edges: Array<[string, string]> = [
    ['forward', t('graphEdgeForward')],
    ['back', t('graphEdgeBack')],
  ]
  return h(
    'div',
    { className: 'buka-workflows-legend' },
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
      h('span', { className: 'buka-workflows-legendTitle' }, t('graphLegendTypes')),
      ...types.map(([kind, label]) =>
        h(
          'span',
          { key: kind, className: 'buka-workflows-legendItem' },
          h('span', {
            className: `buka-workflows-legendCapsule ${kind}`,
            'aria-hidden': true,
          }),
          label,
        ),
      ),
    ),
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
      h('span', { className: 'buka-workflows-legendTitle' }, t('graphLegendStates')),
      ...states.map(([kind, label]) =>
        h(
          'span',
          { key: kind, className: 'buka-workflows-legendItem' },
          h('span', {
            className: `buka-workflows-legendDot is-${kind}`,
            'aria-hidden': true,
          }),
          label,
        ),
      ),
    ),
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
      h('span', { className: 'buka-workflows-legendTitle' }, t('graphLegendEdges')),
      ...edges.map(([kind, label]) =>
        h(
          'span',
          { key: kind, className: 'buka-workflows-legendItem' },
          h('span', {
            className: `buka-workflows-legendLine is-${kind}`,
            'aria-hidden': true,
          }),
          label,
        ),
      ),
    ),
  )
}
