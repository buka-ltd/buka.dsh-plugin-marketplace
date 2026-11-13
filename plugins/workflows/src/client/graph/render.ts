/**
 * 流程图渲染：SVG 连线 + 绝对定位的节点卡片。
 *
 * 定义结构与实时流程共用同一套布局和卡片；区别只在节点 / 边的数据与
 * 点击后的动作。
 */

import React from 'react'

import { renderAvatar } from '../avatars.ts'
import { h } from '../element.ts'
import { stateClass } from '../format.ts'
import type { AppContext } from '../page-context.ts'
import {
  type GraphEdgeInput,
  type GraphLayoutEdge,
  type GraphNodeInput,
  layoutGraph,
} from './layout.ts'

/** 渲染参数。 */
export interface RenderGraphOptions {
  nodes: GraphNodeInput[]
  edges: GraphEdgeInput[]
  /** 点节点时打开对应面板；不传则不响应点击。 */
  onNodeClick?: ((id: string) => void) | null
  /** 点通道时打开对应面板。 */
  onEdgeClick?: ((edge: GraphLayoutEdge) => void) | null
  /** 当前选中的节点 id。 */
  selectedNodeId?: string | null
  /** 当前选中的通道 id。 */
  selectedChannelId?: string | null
  /** 图下方的说明。 */
  caption?: string | null
  /** 定义图显示节点类型与边类型数；实时图显示任务状态。 */
  mode?: 'definition' | 'live'
  /** 是否显示图例。 */
  showLegend?: boolean
  /** 宽度不够时是否整体缩放（默认 true）。 */
  fit?: boolean
}

/** 流程图组件：负责测量容器宽度做等比缩放。 */
function GraphView(props: RenderGraphOptions & { page: AppContext }): React.ReactElement {
  const { page, ...options } = props
  const { t } = page
  const layout = layoutGraph(options.nodes, options.edges)
  const mode = options.mode ?? 'definition'
  const showLegend = options.showLegend ?? true
  const fit = options.fit ?? true
  const selectedNodeId = options.selectedNodeId ?? null
  const selectedChannelId = options.selectedChannelId ?? null

  const ref = React.useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = React.useState(1)
  const [hoveredEdgeKey, setHoveredEdgeKey] = React.useState<string | null>(null)
  const hoveredEdge = layout.edges.find((edge) => edge.key === hoveredEdgeKey) ?? null
  React.useEffect(() => {
    if (!fit) return undefined
    const element = ref.current
    if (element === null) return undefined
    const update = () => {
      const available = element.clientWidth
      if (!Number.isFinite(available) || available <= 0) return
      setScale(Math.min(1, available / layout.width))
    }
    update()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit, layout.width])

  return h(
    'div',
    { className: 'buka-workflows-graphPane' },
    h(
      'div',
      {
        ref,
        className: 'buka-workflows-graphViewport',
      },
      h(
        'div',
        {
          className: 'buka-workflows-graphScaleBox',
          style: {
            width: `${Math.ceil(layout.width * scale)}px`,
            height: `${Math.ceil(layout.height * scale)}px`,
          },
        },
        h(
          'div',
          {
            className: 'buka-workflows-graphCanvas',
            style: {
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              transform: scale === 1 ? undefined : `scale(${scale})`,
              transformOrigin: 'top left',
            },
            role: 'group',
            'aria-label': t('graphAria'),
          },
          h(
            'svg',
            {
              className: 'buka-workflows-graphSvg',
              width: layout.width,
              height: layout.height,
              viewBox: `0 0 ${layout.width} ${layout.height}`,
            },
            ...layout.edges.map((edge) => {
              const selected = selectedChannelId !== null && edge.id === selectedChannelId
              return h(
                'g',
                {
                  key: edge.key,
                  className: `buka-workflows-edgeGroup is-${edge.kind}${
                    edge.state === 'taken' ? ' is-taken' : ''
                  }${selected ? ' is-selected' : ''}`,
                },
                h('path', {
                  key: `${edge.key}-path`,
                  className: `buka-workflows-edge is-${edge.kind}${
                    edge.state === 'taken' ? ' is-taken' : ''
                  }`,
                  d: edge.d,
                }),
                h('path', {
                  key: `${edge.key}-hit`,
                  className: 'buka-workflows-hitPath',
                  d: edge.hit,
                  onMouseEnter: () => setHoveredEdgeKey(edge.key),
                  onMouseLeave: () =>
                    setHoveredEdgeKey((current) => (current === edge.key ? null : current)),
                  onFocus: () => setHoveredEdgeKey(edge.key),
                  onBlur: () =>
                    setHoveredEdgeKey((current) => (current === edge.key ? null : current)),
                  'aria-label': edge.label === '' ? edge.id : edge.label,
                  ...(options.onEdgeClick === null || options.onEdgeClick === undefined
                    ? {}
                    : {
                        onClick: () =>
                          (options.onEdgeClick as (value: GraphLayoutEdge) => void)(edge),
                        role: 'button',
                        tabIndex: 0,
                      }),
                }),
                edge.labelAt === null || edge.label === ''
                  ? null
                  : h(
                      'text',
                      {
                        key: `${edge.key}-label`,
                        className: `buka-workflows-edgeLabel is-${edge.kind}${
                          edge.state === 'taken' ? ' is-taken' : ''
                        }`,
                        x: round(edge.labelAt.x),
                        y: round(edge.labelAt.y),
                        textAnchor: 'middle',
                        dominantBaseline: 'middle',
                      },
                      clipLabel(edge.label),
                    ),
                h(
                  'g',
                  {
                    key: `${edge.key}-arrow`,
                    className: `buka-workflows-edgeArrow is-${edge.kind}${
                      edge.state === 'taken' ? ' is-taken' : ''
                    }`,
                    transform: `translate(${round(edge.arrow.x)} ${round(edge.arrow.y)}) rotate(${round(edge.arrow.angle)})`,
                  },
                  h('path', { d: 'M-4,-3.5 L4,0 L-4,3.5 Z' }),
                ),
              )
            }),
          ),
          ...layout.nodes.map((node) => {
            const selected = selectedNodeId === node.id
            const status = node.status ?? 'idle'
            const stateName = mode === 'live' ? ` is-${stateClass(status)}` : ''
            const clickable = options.onNodeClick !== null && options.onNodeClick !== undefined
            const tag =
              node.kind === 'position'
                ? node.executor?.kind === 'human'
                  ? 'is-human'
                  : 'is-worker'
                : node.kind === 'start'
                  ? 'is-start'
                  : 'is-end'
            const corner =
              mode === 'live' && typeof node.meta === 'string' && node.meta !== ''
                ? h(
                    'span',
                    {
                      key: 'corner',
                      className: `buka-workflows-nodeCorner is-${stateClass(status)}`,
                      'aria-hidden': true,
                    },
                    node.meta,
                  )
                : null
            return h(
              'div',
              {
                key: node.id,
                className: 'buka-workflows-nodeWrap',
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
                      className: `buka-workflows-node ${tag}${stateName}${selected ? ' is-selected' : ''}`,
                      title: node.title ?? node.label,
                      'aria-pressed': selected,
                      onClick: () => (options.onNodeClick as (id: string) => void)(node.id),
                    },
                    renderAvatar(node.avatar, 16, 'buka-workflows-nodeAvatar'),
                    h('span', { className: 'buka-workflows-nodeLabel' }, node.label),
                    corner,
                  )
                : h(
                    'span',
                    {
                      className: `buka-workflows-node ${tag}${stateName}`,
                    },
                    renderAvatar(node.avatar, 16, 'buka-workflows-nodeAvatar'),
                    h('span', { className: 'buka-workflows-nodeLabel' }, node.label),
                    corner,
                  ),
            )
          }),
        ),
        hoveredEdge === null ||
          hoveredEdge.labelAt === null ||
          hoveredEdge.label === '' ||
          !isClipped(hoveredEdge.label)
          ? null
          : h(
              'span',
              {
                key: 'edge-tip',
                className: 'buka-workflows-edgeTip',
                style: {
                  left: `${hoveredEdge.labelAt.x * scale}px`,
                  top: `${(hoveredEdge.labelAt.y - 14) * scale}px`,
                },
              },
              hoveredEdge.label,
            ),
      ),
    ),
    options.caption === null || options.caption === undefined
      ? null
      : h('p', { className: 'buka-workflows-hint buka-workflows-graphCaption' }, options.caption),
    showLegend ? renderGraphLegend(page, mode) : null,
  )
}

/**
 * 画一张流程图。
 *
 * @param page
 * @param options
 * @returns React 元素
 */
export function renderWorkflowGraph(
  page: AppContext,
  options: RenderGraphOptions,
): React.ReactElement {
  return h(GraphView, { ...options, page })
}

/**
 * 图例：节点类型、任务状态、连线。
 *
 * @param page
 * @param mode
 * @returns
 */
export function renderGraphLegend(
  page: AppContext,
  mode: 'definition' | 'live' = 'definition',
): React.ReactElement {
  const { t } = page
  const types: Array<[string, string]> = [
    ['is-start', t('graphStart')],
    ['is-worker', t('graphWorker')],
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
    ['forward', t('graphChannelForward')],
    ['back', t('graphChannelBack')],
    ...(mode === 'live' ? ([['taken', t('graphChannelTaken')]] as Array<[string, string]>) : []),
  ]
  return h(
    'div',
    { className: 'buka-workflows-legend' },
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
      ...types.map(([kind, label]) =>
        h(
          'span',
          { key: kind, className: 'buka-workflows-legendItem' },
          h('span', {
            className: `buka-workflows-legendNode ${kind}`,
            'aria-hidden': true,
          }),
          label,
        ),
      ),
    ),
    mode === 'live'
      ? h(
          'span',
          { className: 'buka-workflows-legendGroup' },
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
        )
      : null,
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
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

/** 数字保留两位小数，减少 DOM 字符串抖动。 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** 连线上的标签：过长时截断，悬停能看到全文。 */
const LABEL_MAX = 14

/** 标签是否被截断（只有截断时才需要悬停提示）。 */
function isClipped(label: string): boolean {
  return [...label].length > LABEL_MAX
}

/** 截断后的画布标签。 */
function clipLabel(label: string, max = LABEL_MAX): string {
  const chars = [...label]
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join('')}…`
}
