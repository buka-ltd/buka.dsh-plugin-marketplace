/**
 * 分层二维节点图：节点按坐标绝对定位，SVG 画可绕行的连线。
 */

import type React from 'react'
import type { LayoutEdge } from '../../graph.ts'
import { renderAvatar } from '../avatars.ts'
import { h } from '../element.ts'
import { statusLabel } from '../format.ts'
import { edgeLabel, edgeToneClass, stateClass, typeLabel } from '../node-model.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientGraph } from '../types.ts'
import { edgeTipAnchor } from './geometry.ts'

/**
 * 分层二维节点图：节点按坐标绝对定位（同一层的并行节点在同一排），SVG 画
 * 从节点上 / 下端口进出、可向左右两侧绕行的连线。
 *
 * @param graph 路由返回的图模型（含节点坐标与连线）
 * @param activeNodeId 当前选中 / 抽屉中的节点
 * @param [onNodeSelect] 点胶囊时的回调；不传则回退到运行详情的选中逻辑
 * @param [options] 传 `{ states: false }` 时按「没有执行状态」画：模板是参考流程，胶囊保持类型配色，不套「未运行」的灰虚线
 * @returns React 元素
 */
export function renderGraph(
  page: PageContext,
  graph: ClientGraph,
  activeNodeId: string | null,
  onNodeSelect: ((id: string) => void) | null = null,
  options: { states?: boolean | undefined } = {},
): React.ReactElement {
  const {
    t,
    setSelectedNodeId,
    setExecutionIndex,
    edgeTip,
    setEdgeTip,
    selectedEdgeKey,
    setSelectedEdgeKey,
    setSelectedTemplateNodeId,
    capsuleText,
  } = page

  const showStates = options.states !== false
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  if (nodes.length === 0) return h('p', { className: 'buka-workflows-empty' }, t('graphEmpty'))
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const nodeWidth = typeof graph.nodeWidth === 'number' ? graph.nodeWidth : 260
  const nodeHeight = typeof graph.nodeHeight === 'number' ? graph.nodeHeight : 28
  // 兼容旧版 Host：插件重启前，运行详情仍返回旧的 rows / dotX 布局。此时按
  // 一行一个节点把胶囊放在原轨道右侧，至少保证节点可见、可点；重启 DSH 后
  // 会切回新的 positions 分层布局。
  const legacyRows = Array.isArray(graph.rows) ? graph.rows : []
  const legacy = !Array.isArray(graph.positions) && legacyRows.length > 0
  const legacyDotX = typeof graph.dotX === 'number' ? graph.dotX : 14
  const legacyRailWidth = typeof graph.width === 'number' ? graph.width : legacyDotX
  const positions = legacy
    ? legacyRows.map((row) => ({
        id: row.id ?? '',
        layer: typeof row.index === 'number' ? row.index : 0,
        x: legacyRailWidth + nodeWidth / 2,
        y: typeof row.y === 'number' ? row.y : 0,
      }))
    : Array.isArray(graph.positions)
      ? graph.positions
      : []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const width = legacy
    ? legacyRailWidth + nodeWidth
    : typeof graph.width === 'number'
      ? graph.width
      : 0
  const height = typeof graph.height === 'number' ? graph.height : 0
  const hoveredEdgeKey = edgeTip === null ? null : edgeTip.key
  const drawableEdges = edges.filter((edge) => typeof edge.d === 'string' && edge.d !== '')
  const hoveredEdge =
    hoveredEdgeKey === null
      ? null
      : (drawableEdges.find((edge) => edge.key === hoveredEdgeKey) ?? null)

  /**
   * 一条边的可见线 / 箭头的公共类名：保留运行状态、tone、选中与悬浮压暗。
   *
   * @param edge
   * @param extra
   * @returns
   */
  function edgeClass(edge: LayoutEdge, extra = ''): string {
    return `buka-workflows-edge is-${edge.kind}${showStates ? '' : ' is-static'}${
      edge.traversed === true ? ' is-traversed' : ''
    }${edgeToneClass(edge)}${selectedEdgeKey === edge.key ? ' is-selected' : ''}${extra}`
  }

  /**
   * 点一条边：与节点抽屉互斥，关闭悬停名字，再打开 / 收起连线配置抽屉。
   *
   * @param edge
   */
  function selectEdge(edge: LayoutEdge): void {
    setEdgeTip(null)
    setSelectedNodeId(null)
    setExecutionIndex(null)
    setSelectedTemplateNodeId(null)
    setSelectedEdgeKey(selectedEdgeKey === edge.key ? null : edge.key)
  }

  return h(
    'div',
    { className: 'buka-workflows-graphPane' },
    h(
      'div',
      {
        className: 'buka-workflows-vgraph',
        style: { width: `${width}px`, height: `${height}px` },
      },
      h(
        'svg',
        {
          className: 'buka-workflows-vgraphSvg',
          width,
          height,
          viewBox: `0 0 ${width} ${height}`,
          role: 'group',
          'aria-label': t('legendEdges'),
        },
        // 悬浮的线不换颜色、也不铺光晕，只是变成实线、略粗一点并压住其他线；
        // 名字单独钉在箭头旁，所以这里先把其余线画完，最后补画悬浮的那条。
        ...drawableEdges
          .filter((edge) => edge !== hoveredEdge)
          .map((edge) =>
            h('path', {
              key: edge.key,
              className: edgeClass(edge, hoveredEdge === null ? '' : ' is-dimmed'),
              d: edge.d,
            }),
          ),
        hoveredEdge === null
          ? null
          : h('path', {
              key: hoveredEdge.key,
              className: edgeClass(hoveredEdge, ' is-hovered'),
              d: hoveredEdge.d,
            }),
        // 方向箭头画在每条线自己的竖段中点 / 目标端口前。
        ...edges.map((edge) => {
          const arrow = edge.arrow
          if (arrow === null || typeof arrow !== 'object') return null
          if (typeof arrow.x !== 'number' || typeof arrow.y !== 'number') return null
          const hovered = hoveredEdgeKey === edge.key
          return h(
            'g',
            {
              key: `arrow-${edge.key}`,
              className: `buka-workflows-edgeArrow is-${edge.kind}${showStates ? '' : ' is-static'}${
                edge.traversed === true ? ' is-traversed' : ''
              }${edgeToneClass(edge)}${selectedEdgeKey === edge.key ? ' is-selected' : ''}${
                hovered ? ' is-hovered' : ''
              }${hoveredEdge !== null && !hovered ? ' is-dimmed' : ''}`,
              transform: `translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle ?? 90})`,
            },
            h('path', { d: 'M-3.5,-4 L3.5,0 L-3.5,4 Z' }),
          )
        }),
        // 透明加粗的命中区：每条可绘制的边都能点击查看配置。悬停名字只给
        // 有名字的边；没有名字的边只有点击行为。
        ...edges.map((edge) => {
          if (typeof edge.d !== 'string' || edge.d === '') return null
          const label = edgeLabel(edge)
          const fromNode = nodeById.get(edge.from) ?? null
          const toNode = nodeById.get(edge.to) ?? null
          const show =
            label === ''
              ? null
              : (event: React.MouseEvent<SVGPathElement>) => {
                  const arrow = edge.arrow
                  const anchor =
                    arrow !== null &&
                    typeof arrow === 'object' &&
                    typeof arrow.x === 'number' &&
                    typeof arrow.y === 'number'
                      ? edgeTipAnchor(event.currentTarget, arrow)
                      : null
                  setEdgeTip({
                    key: edge.key,
                    kind: edge.kind,
                    text: label,
                    x: event.clientX,
                    y: event.clientY,
                    anchor,
                  })
                }
          return h('path', {
            key: `hit-${edge.key}`,
            className: 'buka-workflows-edgeHit',
            d: edge.d,
            'data-edge-key': edge.key,
            role: 'button',
            tabIndex: 0,
            'aria-label': String(t('edgeAriaLabel'))
              .replace('{from}', fromNode === null ? edge.from : capsuleText(fromNode))
              .replace('{to}', toNode === null ? edge.to : capsuleText(toNode)),
            onClick: () => selectEdge(edge),
            onKeyDown: (event: React.KeyboardEvent<SVGPathElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              selectEdge(edge)
            },
            // 名字钉在箭头旁，不再跟着鼠标走，所以只需进入时算一次位置。
            onMouseEnter: show ?? undefined,
            onMouseLeave:
              label === ''
                ? undefined
                : () =>
                    setEdgeTip((current) =>
                      current !== null && current.key === edge.key ? null : current,
                    ),
          })
        }),
        ...positions.map((position) => {
          const node = nodeById.get(position.id)
          if (node === undefined) return null
          return h('circle', {
            key: `dot-${position.id}`,
            className: `buka-workflows-vgraphDot is-${stateClass(node.state)}`,
            cx: legacy ? legacyDotX : position.x - nodeWidth / 2 - 10,
            cy: position.y,
            r: 4,
          })
        }),
      ),
      ...positions.map((position) => {
        const node = nodeById.get(position.id)
        if (node === undefined) return null
        const state = typeof node.state === 'string' ? node.state : 'idle'
        const kind = stateClass(state)
        const selected = activeNodeId === node.id
        return h(
          'div',
          {
            key: node.id,
            className: 'buka-workflows-vgraphNode',
            style: {
              left: `${position.x - nodeWidth / 2}px`,
              top: `${position.y - nodeHeight / 2}px`,
              width: `${nodeWidth}px`,
              height: `${nodeHeight}px`,
            },
          },
          h(
            'button',
            {
              type: 'button',
              className: `buka-workflows-capsule is-${node.type}${
                showStates && kind === 'idle' ? ' is-idle' : ''
              }${showStates && kind === 'running' ? ' is-running' : ''}${
                selected ? ' is-selected' : ''
              }${typeof node.avatar === 'string' && node.avatar !== '' ? ' has-avatar' : ''}`,
              title: showStates
                ? `${node.id} · ${typeLabel(t, node.type)} · ${statusLabel(t, state)}`
                : `${node.id} · ${typeLabel(t, node.type)}`,
              'aria-pressed': selected,
              // 点胶囊换节点时回到「最近一次执行」；点执行记录里的「下一步」
              // 则用 focusExecution 指定具体的那一次。
              onClick: () => {
                setEdgeTip(null)
                setSelectedEdgeKey(null)
                if (onNodeSelect !== null) onNodeSelect(node.id)
                else {
                  setSelectedNodeId(node.id)
                  setExecutionIndex(null)
                }
              },
            },
            renderAvatar(node.avatar, 20, 'buka-workflows-capsuleAvatar'),
            h('span', { className: 'buka-workflows-capsuleText' }, capsuleText(node)),
          ),
          node.visits > 1
            ? h(
                'span',
                {
                  className: 'buka-workflows-visitBadge',
                  title: `${t('visitsLabel')}: ${node.visits}`,
                },
                `×${node.visits}`,
              )
            : null,
        )
      }),
    ),
  )
}
