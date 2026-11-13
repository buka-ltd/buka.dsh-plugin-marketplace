/**
 * 流程图布局：岗位 / 内建开始结束节点按层从上到下排布，连线向下或从侧面绕行。
 *
 * 这里不依赖宿主一半的 `src/graph.ts`：坐标全部在浏览器侧按定义快照计算，
 * 服务端只给「岗位 + 边 + 任务状态」。图不横向滚动，宽度超出时由外层整体缩放。
 */

import type { Executor } from '../types.ts'

/** 输入节点。 */
export interface GraphNodeInput {
  id: string
  label: string
  kind: 'start' | 'position' | 'end'
  executor?: Executor | null
  /** 打工人头像 id。 */
  avatar?: string
  /** 任务状态汇总；没有完成态数据时是 idle。 */
  status?: string
  /** 右上角的角标：运行态显示完成 / 总数。 */
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
  /** 运行态：这条边是否已经被走过。 */
  state?: 'open' | 'taken'
  /** 定义里的边序号（抽屉按它找定义）。 */
  index?: number
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
  types: string[]
  state: 'open' | 'taken'
  index: number
  d: string
  hit: string
  arrow: { x: number; y: number; angle: number }
  labelAt: { x: number; y: number } | null
}

/** 布局结果。 */
export interface GraphLayout {
  width: number
  height: number
  nodes: GraphLayoutNode[]
  edges: GraphLayoutEdge[]
}

/** 节点左右内边距。 */
const NODE_PADDING_X = 10

/** 头像直径与头像后的间距（只有岗位节点有头像）。 */
const AVATAR_WIDTH = 16
const AVATAR_GAP = 6

/** 估算文本宽度时的字宽：CJK 按一个字号，拉丁字母按半个多一点。 */
const CJK_WIDTH = 13.5
const LATIN_WIDTH = 7.8

/** 文本与边框之间的安全余量。 */
const LABEL_SLACK = 4

/** 节点最小 / 最大宽度。 */
const MIN_NODE_WIDTH = 58
const MAX_NODE_WIDTH = 200

/** 节点高度。 */
const NODE_HEIGHT = 34

/** 同层节点水平间距。 */
const GAP_X = 18

/** 层间垂直间距。 */
const GAP_Y = 42

/** 画布上下留白。 */
const PAD = 24

/** 画布左右留白。 */
const SIDE_PAD = 24

/** 回边绕行的基础横向偏移。 */
const BACK_OFFSET = 20

/** 多条回边之间的横向间隔。 */
const BACK_STEP = 10

/** 回边绕行额外留白（单侧）。 */
const BACK_EXTRA = 12

/**
 * 计算分层的上下坐标与连线路径。
 *
 * @param nodes 节点
 * @param rawEdges 边
 * @returns 布局结果
 */
export function layoutGraph(nodes: GraphNodeInput[], rawEdges: GraphEdgeInput[]): GraphLayout {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = rawEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  const layers = assignLayers(nodes, edges)

  const byLayer = new Map<number, GraphNodeInput[]>()
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0
    const group = byLayer.get(layer)
    if (group === undefined) byLayer.set(layer, [node])
    else group.push(node)
  }
  const layerKeys = [...byLayer.keys()].sort((left, right) => left - right)
  const rowWidth = Math.max(1, ...layerKeys.map((layer) => rowWidthOf(byLayer.get(layer) ?? [])))
  const backCount = edges.filter((edge) => isBackEdge(edge, layers)).length
  const backPad =
    backCount === 0 ? 0 : BACK_OFFSET + Math.max(0, backCount - 1) * BACK_STEP + BACK_EXTRA
  const width = SIDE_PAD * 2 + rowWidth + backPad * 2
  const height =
    PAD * 2 + layerKeys.length * NODE_HEIGHT + Math.max(0, layerKeys.length - 1) * GAP_Y

  const byId = new Map<string, GraphLayoutNode>()
  const laidOut: GraphLayoutNode[] = []
  layerKeys.forEach((layer, index) => {
    const group = byLayer.get(layer) ?? []
    const groupWidth = rowWidthOf(group)
    let cursor = (width - groupWidth) / 2
    for (const node of group) {
      const nodeWidth = widthOf(node)
      const laid: GraphLayoutNode = {
        ...node,
        x: cursor + nodeWidth / 2,
        y: PAD + NODE_HEIGHT / 2 + index * (NODE_HEIGHT + GAP_Y),
        layer,
        width: nodeWidth,
        height: NODE_HEIGHT,
      }
      laidOut.push(laid)
      byId.set(node.id, laid)
      cursor += nodeWidth + GAP_X
    }
  })

  const laidOutEdges: GraphLayoutEdge[] = []
  const usedKeys = new Map<string, number>()
  let backLane = 0
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue
    const back = isBackEdge(edge, layers)
    const baseKey = `${edge.from}->${edge.to}`
    const seen = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, seen + 1)
    const key = seen === 0 ? baseKey : `${baseKey}#${seen}`
    const types = Array.isArray(edge.types)
      ? edge.types.filter((type) => typeof type === 'string')
      : []
    const geometry = back
      ? backEdgeGeometry(from, to, backLane, width)
      : forwardEdgeGeometry(from, to)
    if (back) backLane += 1
    laidOutEdges.push({
      key,
      from: edge.from,
      to: edge.to,
      kind: back ? 'back' : 'forward',
      types,
      state: edge.state === 'taken' ? 'taken' : 'open',
      index: typeof edge.index === 'number' ? edge.index : -1,
      ...geometry,
    })
  }

  return { width, height, nodes: laidOut, edges: laidOutEdges }
}

/** 一个节点的宽度：由头像与岗位名内容决定，不预留固定留白。 */
function widthOf(node: GraphNodeInput): number {
  let content = 0
  for (const char of node.label) {
    content += (char.codePointAt(0) ?? 0) >= 0x2e80 ? CJK_WIDTH : LATIN_WIDTH
  }
  const lead = node.kind === 'position' ? AVATAR_WIDTH + AVATAR_GAP : 0
  const width = NODE_PADDING_X * 2 + lead + content + LABEL_SLACK
  return Math.round(Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, width)))
}

/** 同一层排开后的总宽度。 */
function rowWidthOf(group: GraphNodeInput[]): number {
  let width = Math.max(0, group.length - 1) * GAP_X
  for (const node of group) width += widthOf(node)
  return width
}

/**
 * 是不是回边：显式标记，或指向同层 / 更上层。
 *
 * @param edge
 * @param layers
 * @returns
 */
function isBackEdge(edge: GraphEdgeInput, layers: Map<string, number>): boolean {
  if (edge.back === true) return true
  return (layers.get(edge.to) ?? 0) <= (layers.get(edge.from) ?? 0)
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
 * 向下的边：从下层节点的底边中点连到目标节点的顶边中点。
 *
 * @param from
 * @param to
 * @returns
 */
function forwardEdgeGeometry(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const x1 = from.x
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y - to.height / 2
  const control = Math.max(16, (y2 - y1) / 2)
  const p0 = { x: x1, y: y1 }
  const p1 = { x: x1, y: y1 + control }
  const p2 = { x: x2, y: y2 - control }
  const p3 = { x: x2, y: y2 }
  const d = `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`
  const point = cubicPoint(p0, p1, p2, p3, 0.8)
  const tangent = cubicTangent(p0, p1, p2, p3, 0.8)
  return {
    d,
    hit: d,
    arrow: { x: point.x, y: point.y, angle: angleOf(tangent) },
    labelAt: cubicPoint(p0, p1, p2, p3, 0.5),
  }
}

/**
 * 回边：从节点右侧绕出去，再回到目标的右侧，避免穿过中间的节点。
 *
 * @param from
 * @param to
 * @param lane 第几条回边，用来错开绕行线
 * @param width 画布宽度
 * @returns
 */
function backEdgeGeometry(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
  lane: number,
  width: number,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const x1 = from.x + from.width / 2
  const y1 = from.y
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const laneX = Math.min(width - 8, Math.max(x1, x2) + BACK_OFFSET + lane * BACK_STEP)
  const p0 = { x: x1, y: y1 }
  const p1 = { x: laneX, y: y1 }
  const p2 = { x: laneX, y: y2 }
  const p3 = { x: x2, y: y2 }
  const d = `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`
  const point = cubicPoint(p0, p1, p2, p3, 0.94)
  const tangent = cubicTangent(p0, p1, p2, p3, 0.94)
  return {
    d,
    hit: d,
    arrow: { x: point.x, y: point.y, angle: angleOf(tangent) },
    labelAt: cubicPoint(p0, p1, p2, p3, 0.5),
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
