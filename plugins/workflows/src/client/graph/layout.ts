/**
 * 流程图布局：岗位 / 内建开始结束节点按层排布，连线绕行。
 *
 * 这里不依赖宿主一半的 `src/graph.ts`：坐标全部在浏览器侧按定义快照计算，
 * 服务端只给「岗位 + 边 + 任务状态」。
 */

import type { Executor } from '../types.ts'

/** 输入节点。 */
export interface GraphNodeInput {
  id: string
  label: string
  kind: 'start' | 'position' | 'end'
  executor?: Executor | null
  /** 机器人头像 id。 */
  avatar?: string
  /** 任务状态汇总；没有完成态数据时是 idle。 */
  status?: string
  /** 胶囊右侧的小徽标（任务计数等）。 */
  meta?: string
  /** 鼠标悬浮的完整说明。 */
  title?: string
}

/** 输入边。 */
export interface GraphEdgeInput {
  from: string
  to: string
  types?: string[]
  back?: boolean
}

/** 布局后的节点：`x` / `y` 是中心点。 */
export interface GraphLayoutNode extends GraphNodeInput {
  x: number
  y: number
  width: number
  height: number
  layer: number
}

/** 布局后的边。 */
export interface GraphLayoutEdge {
  key: string
  from: string
  to: string
  kind: 'forward' | 'back'
  label: string
  d: string
  arrow: { x: number; y: number; angle: number }
}

/** 布局结果。 */
export interface GraphLayout {
  width: number
  height: number
  nodeWidth: number
  nodeHeight: number
  nodes: GraphLayoutNode[]
  edges: GraphLayoutEdge[]
}

/** 节点宽度。 */
const NODE_WIDTH = 208

/** 节点高度。 */
const NODE_HEIGHT = 34

/** 同层节点水平间距。 */
const GAP_X = 28

/** 层间垂直间距。 */
const GAP_Y = 74

/** 画布四周留白。 */
const MARGIN = 20

/** 回边绕行需要的右侧额外空间。 */
const BACK_EXTRA = 72

/**
 * 计算分层坐标与连线路径。
 *
 * @param nodes 节点
 * @param rawEdges 边
 * @returns 布局结果
 */
export function layoutGraph(nodes: GraphNodeInput[], rawEdges: GraphEdgeInput[]): GraphLayout {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = rawEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  const layers = assignLayers(nodes, edges)

  // 按层分组，保持输入顺序（岗位定义顺序）。
  const byLayer = new Map<number, GraphNodeInput[]>()
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0
    const group = byLayer.get(layer)
    if (group === undefined) byLayer.set(layer, [node])
    else group.push(node)
  }
  const layerKeys = [...byLayer.keys()].sort((left, right) => left - right)
  const rowWidth = Math.max(
    NODE_WIDTH,
    ...layerKeys.map((layer) => {
      const count = byLayer.get(layer)?.length ?? 0
      return count * NODE_WIDTH + Math.max(0, count - 1) * GAP_X
    }),
  )
  const width = rowWidth + 2 * MARGIN + BACK_EXTRA
  const height =
    layerKeys.length === 0
      ? NODE_HEIGHT + 2 * MARGIN
      : (layerKeys.length - 1) * (NODE_HEIGHT + GAP_Y) + NODE_HEIGHT + 2 * MARGIN

  const byId = new Map<string, GraphLayoutNode>()
  const laidOut: GraphLayoutNode[] = []
  layerKeys.forEach((layer, index) => {
    const group = byLayer.get(layer) ?? []
    const groupWidth = group.length * NODE_WIDTH + Math.max(0, group.length - 1) * GAP_X
    const startX = (width - groupWidth) / 2
    const y = MARGIN + NODE_HEIGHT / 2 + index * (NODE_HEIGHT + GAP_Y)
    group.forEach((node, position) => {
      const x = startX + NODE_WIDTH / 2 + position * (NODE_WIDTH + GAP_X)
      const laid: GraphLayoutNode = {
        ...node,
        x,
        y,
        layer,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }
      laidOut.push(laid)
      byId.set(node.id, laid)
    })
  })

  const laidOutEdges: GraphLayoutEdge[] = []
  const usedKeys = new Map<string, number>()
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue
    const back = edge.back === true || to.layer <= from.layer
    const baseKey = `${edge.from}->${edge.to}`
    const seen = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, seen + 1)
    const key = seen === 0 ? baseKey : `${baseKey}#${seen}`
    const types = Array.isArray(edge.types)
      ? edge.types.filter((type) => typeof type === 'string')
      : []
    const label = types.length > 0 ? types.join(', ') : back ? '' : ''
    laidOutEdges.push({
      key,
      from: edge.from,
      to: edge.to,
      kind: back ? 'back' : 'forward',
      label,
      ...edgeGeometry(from, to, back),
    })
  }

  return {
    width,
    height,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    nodes: laidOut,
    edges: laidOutEdges,
  }
}

/**
 * 最长路径分层：开始节点固定第 0 层，结束节点固定最后一层；回边不参与分层。
 *
 * @param nodes
 * @param edges
 * @returns 节点 id → 层号
 */
function assignLayers(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Map<string, number> {
  const layers = new Map<string, number>()
  const first = nodes[0]
  if (nodes.some((node) => node.id === 'start')) layers.set('start', 0)
  else if (first !== undefined) layers.set(first.id, 0)

  const forward = edges.filter((edge) => edge.back !== true)
  for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    let changed = false
    for (const edge of forward) {
      const fromLayer = layers.get(edge.from)
      if (fromLayer === undefined) continue
      const next = fromLayer + 1
      const current = layers.get(edge.to)
      if (current === undefined || current < next) {
        layers.set(edge.to, next)
        changed = true
      }
    }
    if (!changed) break
  }

  const hasEnd = nodes.some((node) => node.id === 'end')
  if (hasEnd) {
    let maxLayer = 0
    for (const [id, layer] of layers) {
      if (id !== 'end') maxLayer = Math.max(maxLayer, layer)
    }
    layers.set('end', maxLayer + 1)
  }
  // 不可达节点兜底：放在开始节点后面一层，至少能被看到。
  for (const node of nodes) {
    if (!layers.has(node.id)) layers.set(node.id, node.id === 'start' ? 0 : 1)
  }
  return layers
}

/**
 * 一条边的路径与箭头位置。
 *
 * @param from
 * @param to
 * @param back
 * @returns
 */
function edgeGeometry(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
  back: boolean,
): Pick<GraphLayoutEdge, 'd' | 'arrow'> {
  if (!back) {
    const x1 = from.x
    const y1 = from.y + from.height / 2
    const x2 = to.x
    const y2 = to.y - to.height / 2
    const control = Math.max(24, (y2 - y1) / 2)
    const p0 = { x: x1, y: y1 }
    const p1 = { x: x1, y: y1 + control }
    const p2 = { x: x2, y: y2 - control }
    const p3 = { x: x2, y: y2 }
    const point = cubicPoint(p0, p1, p2, p3, 0.55)
    const tangent = cubicTangent(p0, p1, p2, p3, 0.55)
    return {
      d: `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`,
      arrow: { x: point.x, y: point.y, angle: angleOf(tangent) },
    }
  }
  // 回边 / 同层边：从右侧绕出去，画一条弓形线。
  const x1 = from.x + from.width / 2
  const y1 = from.y
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const reach = Math.max(x1, x2) + 56
  const p0 = { x: x1, y: y1 }
  const p1 = { x: reach, y: y1 }
  const p2 = { x: reach, y: y2 }
  const p3 = { x: x2, y: y2 }
  const point = cubicPoint(p0, p1, p2, p3, 0.5)
  const tangent = cubicTangent(p0, p1, p2, p3, 0.5)
  return {
    d: `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`,
    arrow: { x: point.x, y: point.y, angle: angleOf(tangent) },
  }
}

/** 三次贝塞尔取点。 */
function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  }
}

/** 三次贝塞尔切线。 */
function cubicTangent(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t
  return {
    x: 3 * mt ** 2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x),
    y: 3 * mt ** 2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y),
  }
}

/** 切线 → 角度（度）。 */
function angleOf(vector: { x: number; y: number }): number {
  return (Math.atan2(vector.y, vector.x) * 180) / Math.PI
}

/** 数字保留两位小数，减少 DOM 字符串抖动。 */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
