/**
 * 流程图渲染：SVG 连线 + 绝对定位的节点卡片。
 *
 * 结构图与实时流程共用同一套布局和卡片；区别只在节点 / 边的数据与
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
  MAX_EDGE_LABEL_CHARS,
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
  /** 画布底部的说明，和图例一起固定在底部。 */
  caption?: string | null
  /** 定义图显示节点类型与边类型数；实时图显示任务状态。 */
  mode?: 'definition' | 'live'
  /** 是否显示图例。 */
  showLegend?: boolean
  /** 宽度不够时是否整体缩放（默认 true）。 */
  fit?: boolean
}

/** 悬浮通道气泡的定位：视口坐标。 */
interface EdgeTipAnchor {
  key: string
  x: number
  y: number
}

/** 流程图组件：负责测量容器宽度做等比缩放。 */
function GraphView(props: RenderGraphOptions & { page: AppContext }): React.ReactElement {
  const { page, ...options } = props
  const { t } = page
  const layout = React.useMemo(
    () => layoutGraph(options.nodes, options.edges),
    [options.nodes, options.edges],
  )
  const mode = options.mode ?? 'definition'
  const showLegend = options.showLegend ?? true
  const caption = options.caption ?? null
  const fit = options.fit ?? true
  const selectedNodeId = options.selectedNodeId ?? null
  const selectedChannelId = options.selectedChannelId ?? null

  const ref = React.useRef<HTMLDivElement | null>(null)
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const [scale, setScale] = React.useState(1)
  const [hoveredTip, setHoveredTip] = React.useState<EdgeTipAnchor | null>(null)
  const hoveredEdge = layout.edges.find((edge) => edge.key === hoveredTip?.key) ?? null
  // 悬浮的通道最后画，交叉处不会被别的线盖住。
  const orderedEdges =
    hoveredEdge === null
      ? layout.edges
      : [...layout.edges.filter((edge) => edge.key !== hoveredEdge.key), hoveredEdge]
  const edgeTip =
    hoveredEdge === null || hoveredTip === null || hoveredEdge.label === ''
      ? null
      : { edge: hoveredEdge, placement: edgeTipPlacement(hoveredTip, hoveredEdge.label) }

  /** 鼠标进入通道时，把气泡锚在指针旁边。 */
  const showEdgeTip = (edge: GraphLayoutEdge, x: number, y: number): void => {
    setHoveredTip({ key: edge.key, x, y })
  }

  /** 鼠标沿通道移动时更新锚点；位移小于 2px 不重绘。 */
  const moveEdgeTip = (edge: GraphLayoutEdge, x: number, y: number): void => {
    setHoveredTip((current) => {
      if (current === null || current.key !== edge.key) return { key: edge.key, x, y }
      return Math.abs(current.x - x) < 2 && Math.abs(current.y - y) < 2
        ? current
        : { key: edge.key, x, y }
    })
  }

  /** 键盘聚焦时没有指针坐标，改用连线标签位置作为锚点。 */
  const focusEdgeTip = (edge: GraphLayoutEdge): void => {
    const box = svgRef.current?.getBoundingClientRect()
    const at = edge.labelAt
    if (box === undefined || at === null) return
    showEdgeTip(edge, box.left + at.x * scale, box.top + at.y * scale)
  }

  const hideEdgeTip = (edge: GraphLayoutEdge): void => {
    setHoveredTip((current) => (current !== null && current.key === edge.key ? null : current))
  }

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
        onScroll: () => setHoveredTip(null),
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
              ref: svgRef,
              className: 'buka-workflows-graphSvg',
              width: layout.width,
              height: layout.height,
              viewBox: `0 0 ${layout.width} ${layout.height}`,
            },
            ...orderedEdges.map((edge) => {
              const selected = selectedChannelId !== null && edge.id === selectedChannelId
              const hovered = hoveredEdge !== null && hoveredEdge.key === edge.key
              const dimmed = hoveredEdge !== null && !hovered && !selected
              return h(
                'g',
                {
                  key: edge.key,
                  className: `buka-workflows-edgeGroup is-${edge.kind}${
                    edge.state === 'taken' ? ' is-taken' : ''
                  }${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${
                    dimmed ? ' is-dimmed' : ''
                  }`,
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
                  onMouseEnter: (event: React.MouseEvent<SVGPathElement>) =>
                    showEdgeTip(edge, event.clientX, event.clientY),
                  onMouseMove: (event: React.MouseEvent<SVGPathElement>) =>
                    moveEdgeTip(edge, event.clientX, event.clientY),
                  onMouseLeave: () => hideEdgeTip(edge),
                  onFocus: () => focusEdgeTip(edge),
                  onBlur: () => hideEdgeTip(edge),
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
                edge.labelAt === null || edge.label === '' || (!selected && edge.kind !== 'forward')
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
            // 有会话在等用户操作 / 回复：左上角一个不拦点击的小红点。
            const attention =
              mode === 'live' && node.awaitingUser === true
                ? h('span', {
                    key: 'attention',
                    className: 'buka-workflows-nodeAttention',
                    'aria-hidden': true,
                  })
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
                    attention,
                  )
                : h(
                    'span',
                    {
                      className: `buka-workflows-node ${tag}${stateName}`,
                    },
                    renderAvatar(node.avatar, 16, 'buka-workflows-nodeAvatar'),
                    h('span', { className: 'buka-workflows-nodeLabel' }, node.label),
                    corner,
                    attention,
                  ),
            )
          }),
        ),
      ),
    ),
    edgeTip === null
      ? null
      : h(
          'span',
          {
            key: 'edge-tip',
            className: `buka-workflows-edgeTip is-${edgeTip.edge.kind}${
              edgeTip.placement.flipped ? ' is-flipped' : ''
            }`,
            style: edgeTip.placement.style,
          },
          edgeTip.edge.label,
        ),
    caption === null && !showLegend
      ? null
      : h(
          'div',
          { className: 'buka-workflows-graphFooter' },
          caption === null
            ? null
            : h('p', { className: 'buka-workflows-hint buka-workflows-graphHint' }, caption),
          showLegend ? renderGraphLegend(page, mode) : null,
        ),
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

/** 连线上的标签：主流程线常显，回向通道选中时也显示；过长时截断，截断上限与布局估宽共用。 */
function clipLabel(label: string, max = MAX_EDGE_LABEL_CHARS): string {
  const chars = [...label]
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join('')}…`
}

/** 气泡与鼠标之间的间距。 */
const TIP_GAP = 14

/** 气泡离视口边缘的安全距离。 */
const TIP_MARGIN = 8

/** 气泡的半高，用于上下夹取。 */
const TIP_HALF_HEIGHT = 12

/** 气泡最大宽度。 */
const TIP_MAX_WIDTH = 280

/** 气泡位置：沿鼠标哪一侧展开，以及对应的内联样式。 */
interface EdgeTipPlacement {
  flipped: boolean
  style: React.CSSProperties
}

/**
 * 气泡的定位：默认在鼠标右下方展开，右边放不下时翻到左边，
 * 垂直方向夹在视口内。气泡是独立图层，不压在连线上。
 *
 * @param anchor 鼠标 / 聚焦位置（视口坐标）
 * @param label 通道名
 * @returns 定位结果
 */
function edgeTipPlacement(anchor: EdgeTipAnchor, label: string): EdgeTipPlacement {
  const { width, height } = viewportSize()
  const flipped = width > 0 && anchor.x + TIP_GAP + tipWidthOf(label) + TIP_MARGIN > width
  const top =
    height > 0
      ? Math.min(
          Math.max(anchor.y, TIP_MARGIN + TIP_HALF_HEIGHT),
          height - TIP_MARGIN - TIP_HALF_HEIGHT,
        )
      : anchor.y
  return {
    flipped,
    style: {
      left: `${round(flipped ? anchor.x - TIP_GAP : anchor.x + TIP_GAP)}px`,
      top: `${round(top)}px`,
      transform: flipped ? 'translate(-100%,-50%)' : 'translateY(-50%)',
    },
  }
}

/** 估算气泡宽度：中文按字号算，拉丁字母按半宽算。 */
function tipWidthOf(label: string): number {
  let width = 0
  for (const char of label) {
    width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 11 : 6.5
  }
  return Math.min(TIP_MAX_WIDTH, width + 20)
}

/** 视口尺寸；测试环境没有窗口时返回 0，退化成不翻转。 */
function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}
