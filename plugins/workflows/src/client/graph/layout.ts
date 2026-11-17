/**
 * 流程图布局：岗位 / 内建开始结束节点按层从上到下排布，通道向下或从侧面绕行。
 *
 * 回向通道走直角折线：从节点侧边出线，沿所有节点外侧的纵向车道回到目标侧边。
 * 车道按纵向区间复用——互不重叠的回路共用一条车道——同一节点上的多个端口
 * 沿侧边错开，避免两条线叠在一起。
 *
 * 这里不依赖宿主一半的 `src/graph.ts`：坐标全部在浏览器侧按定义快照计算，
 * 服务端只给「岗位 + 通道 + 任务状态」。图不横向滚动，宽度超出时由外层整体缩放。
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

/** 输入通道。 */
export interface GraphEdgeInput {
  /** 通道 id；同一对节点的多条通道靠它区分。 */
  id: string
  /** 人读名字；主流程线常显，回向通道悬浮或选中时显示。 */
  label?: string
  from: string
  to: string
  types?: string[]
  back?: boolean
  /** 运行态：这条通道是否已经被走过。 */
  state?: 'open' | 'taken'
}

/** 布局后的节点：`x` / `y` 是中心点。 */
export interface GraphLayoutNode extends GraphNodeInput {
  x: number
  y: number
  width: number
  height: number
  layer: number
}

/** 布局后的通道。 */
export interface GraphLayoutEdge {
  key: string
  id: string
  label: string
  from: string
  to: string
  kind: 'forward' | 'back'
  types: string[]
  state: 'open' | 'taken'
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

/** 回向通道绕行的基础横向偏移。 */
const BACK_OFFSET = 20

/** 多条回向通道之间的横向间隔。 */
const BACK_STEP = 12

/** 同一对节点的多条前向通道之间的横向间隔。 */
const LANE_STEP = 16

/** 并行前向通道的标签沿曲线错开的起点 / 跨度，避免彼此压字。 */
const PARALLEL_LABEL_START = 0.26
const PARALLEL_LABEL_SPREAD = 0.48

/** 回向通道绕行额外留白（单侧）。 */
const BACK_EXTRA = 12

/** 同一节点侧边多个端口展开的最大高度。 */
const BACK_PORT_SPAN = 20

/** 同一节点侧边相邻端口之间的间距。 */
const BACK_PORT_STEP = 10

/** 同层回向通道绕行轨道之间的间距。 */
const SAME_LAYER_STEP = 10

/** 同层回向通道绕行轨道离行边的距离。 */
const SAME_LAYER_GAP = 12

/** 箭头离节点边缘的距离。 */
const ARROW_INSET = 5

/** 回向通道走哪一侧。 */
type Side = 'left' | 'right'

/** 一条回向通道的走线计划；坐标在布局完成后补进来。 */
interface BackEdgePlan {
  /** 在过滤后的通道列表里的下标。 */
  index: number
  from: GraphLayoutNode
  to: GraphLayoutNode
  side: Side
  /** 该侧的第几条纵向车道；区间不重叠的回路会复用同一条。 */
  lane: number
  /** 纵向车道覆盖的 y 区间，用来判断两条回路能不能共用车道。 */
  yLow: number
  yHigh: number
  /** 同层回绕的轨道序号。 */
  track: number
  /** 同层回绕走行的下一行还是上一行。 */
  trackBelow: boolean
  /** 同层回绕轨道的 y。 */
  trackY: number
  /** 出线 / 入线在节点侧边的纵向偏移。 */
  sourceOffset: number
  targetOffset: number
  /** 同层回绕进入目标底边 / 顶边时的横向偏移，避开中间的箭头。 */
  entryOffset: number
}

/** 回向通道的端口。 */
interface BackPort {
  plan: BackEdgePlan
  role: 'source' | 'target'
  /** 另一端节点的 y，用来决定端口在侧边上的顺序。 */
  otherY: number
}

/**
 * 计算分层的上下坐标与通道路径。
 *
 * @param nodes 节点
 * @param rawEdges 通道
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
  const pairCounts = new Map<string, number>()
  for (const edge of edges) {
    const pair = `${edge.from}->${edge.to}`
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1)
  }
  const maxParallel = Math.max(1, ...pairCounts.values())
  const lanePad = (maxParallel - 1) * LANE_STEP
  const width = SIDE_PAD * 2 + rowWidth + backPad * 2 + lanePad * 2
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

  if (laidOut.length === 0) return { width, height, nodes: laidOut, edges: [] }

  const rows = new Map<number, GraphLayoutNode[]>()
  let nodeLeft = Number.POSITIVE_INFINITY
  let nodeRight = Number.NEGATIVE_INFINITY
  for (const node of laidOut) {
    const group = rows.get(node.layer)
    if (group === undefined) rows.set(node.layer, [node])
    else group.push(node)
    nodeLeft = Math.min(nodeLeft, node.x - node.width / 2)
    nodeRight = Math.max(nodeRight, node.x + node.width / 2)
  }

  // 前向通道的贝塞尔控制点可能鼓出节点外沿；回向车道要绕到这些曲线之外。
  const pairSeen = new Map<string, number>()
  const forwardOffsets = new Map<number, number>()
  const forwardLabelTs = new Map<number, number>()
  let curveLeft = nodeLeft
  let curveRight = nodeRight
  for (const [index, edge] of edges.entries()) {
    if (isBackEdge(edge, layers)) continue
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue
    const pair = `${edge.from}->${edge.to}`
    const total = pairCounts.get(pair) ?? 1
    const seen = pairSeen.get(pair) ?? 0
    pairSeen.set(pair, seen + 1)
    const offset = total <= 1 ? 0 : (seen - (total - 1) / 2) * LANE_STEP
    forwardOffsets.set(index, offset)
    forwardLabelTs.set(
      index,
      total <= 1 ? 0.5 : PARALLEL_LABEL_START + (PARALLEL_LABEL_SPREAD * seen) / (total - 1),
    )
    curveLeft = Math.min(curveLeft, Math.min(from.x, to.x) + Math.min(0, offset))
    curveRight = Math.max(curveRight, Math.max(from.x, to.x) + Math.max(0, offset))
  }

  const plans = planBackEdges(edges, layers, byId, rows, layerKeys)

  const laidOutEdges: GraphLayoutEdge[] = []
  const usedKeys = new Map<string, number>()
  for (const [index, edge] of edges.entries()) {
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
    const plan = plans.get(index)
    const laneX =
      plan === undefined
        ? 0
        : plan.side === 'right'
          ? curveRight + BACK_OFFSET + plan.lane * BACK_STEP
          : curveLeft - BACK_OFFSET - plan.lane * BACK_STEP
    const geometry =
      back && plan !== undefined
        ? backEdgeGeometry(plan, laneX)
        : forwardEdgeGeometry(
            from,
            to,
            forwardOffsets.get(index) ?? 0,
            forwardLabelTs.get(index) ?? 0.5,
          )
    laidOutEdges.push({
      key,
      id: edge.id,
      label: typeof edge.label === 'string' ? edge.label : '',
      from: edge.from,
      to: edge.to,
      kind: back ? 'back' : 'forward',
      types,
      state: edge.state === 'taken' ? 'taken' : 'open',
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
 * 是不是回向通道：显式标记，或指向同层 / 更上层。
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
 * 最长路径分层：开始节点固定第 0 层，结束节点固定最后一层；回向通道不参与分层。
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
 * 给回向通道选边、排车道、分端口。全部用节点中心坐标判断，结果与横向平移无关。
 *
 * @param edges
 * @param layers
 * @param byId
 * @param rows
 * @param layerKeys
 * @returns 通道下标 → 走线计划
 */
function planBackEdges(
  edges: GraphEdgeInput[],
  layers: Map<string, number>,
  byId: Map<string, GraphLayoutNode>,
  rows: Map<number, GraphLayoutNode[]>,
  layerKeys: number[],
): Map<number, BackEdgePlan> {
  const plans: BackEdgePlan[] = []
  for (const [index, edge] of edges.entries()) {
    if (!isBackEdge(edge, layers)) continue
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue
    // 同层回连从目标底边 / 顶边进入，目标那一侧的兄弟节点不影响选边。
    const sameLayer = from.layer === to.layer
    const left = blockerCount(from, 'left', rows) + (sameLayer ? 0 : blockerCount(to, 'left', rows))
    const right =
      blockerCount(from, 'right', rows) + (sameLayer ? 0 : blockerCount(to, 'right', rows))
    plans.push({
      index,
      from,
      to,
      side: left < right ? 'left' : 'right',
      lane: 0,
      yLow: Math.min(from.y, to.y),
      yHigh: Math.max(from.y, to.y),
      track: 0,
      trackBelow: true,
      trackY: 0,
      sourceOffset: 0,
      targetOffset: 0,
      entryOffset: 0,
    })
  }

  const maxLayer = layerKeys.at(-1) ?? 0
  const trackCounts = new Map<number, number>()
  for (const plan of plans) {
    if (plan.from.layer !== plan.to.layer) continue
    const count = trackCounts.get(plan.from.layer) ?? 0
    trackCounts.set(plan.from.layer, count + 1)
    plan.track = count
    plan.trackBelow = plan.from.layer < maxLayer
    const rowTop = plan.from.y - plan.from.height / 2
    const rowBottom = plan.from.y + plan.from.height / 2
    plan.trackY = plan.trackBelow
      ? rowBottom + SAME_LAYER_GAP + count * SAME_LAYER_STEP
      : rowTop - SAME_LAYER_GAP - count * SAME_LAYER_STEP
    plan.yLow = Math.min(plan.from.y, plan.trackY)
    plan.yHigh = Math.max(plan.from.y, plan.trackY)
  }

  assignBackLanes(plans)
  assignBackPorts(plans)
  assignSameLayerEntries(plans)

  const byIndex = new Map<number, BackEdgePlan>()
  for (const plan of plans) byIndex.set(plan.index, plan)
  return byIndex
}

/**
 * 节点同一行里，朝某一侧出线会穿过几个兄弟节点；越少越好。
 *
 * @param node
 * @param side
 * @param rows
 * @returns
 */
function blockerCount(
  node: GraphLayoutNode,
  side: Side,
  rows: Map<number, GraphLayoutNode[]>,
): number {
  const row = rows.get(node.layer) ?? []
  let count = 0
  for (const other of row) {
    if (other.id === node.id) continue
    if (side === 'right' ? other.x > node.x : other.x < node.x) count += 1
  }
  return count
}

/**
 * 按纵向区间分配车道：短回路先占内圈，长回路套在外圈；区间不重叠的回路复用同一条。
 *
 * @param plans
 */
function assignBackLanes(plans: BackEdgePlan[]): void {
  for (const side of ['left', 'right'] as const) {
    const list = plans.filter((plan) => plan.side === side)
    list.sort(
      (left, right) =>
        left.yHigh - left.yLow - (right.yHigh - right.yLow) ||
        left.yLow - right.yLow ||
        left.index - right.index,
    )
    const lanes: Array<Array<{ low: number; high: number }>> = []
    for (const plan of list) {
      let lane = 0
      while (lane < lanes.length) {
        const used = lanes[lane] ?? []
        const free = used.every(
          (interval) => plan.yHigh < interval.low || plan.yLow > interval.high,
        )
        if (free) break
        lane += 1
      }
      if (lane === lanes.length) lanes.push([])
      const used = lanes[lane]
      if (used !== undefined) used.push({ low: plan.yLow, high: plan.yHigh })
      plan.lane = lane
    }
  }
}

/**
 * 同一节点的同侧端口沿侧边上下错开；顺序按另一端的位置排，避免两条线在节点口重叠。
 *
 * @param plans
 */
function assignBackPorts(plans: BackEdgePlan[]): void {
  const groups = new Map<string, BackPort[]>()
  for (const plan of plans) {
    addBackPort(groups, plan, 'source', plan.from, plan.to.y)
    if (plan.from.layer !== plan.to.layer) addBackPort(groups, plan, 'target', plan.to, plan.from.y)
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.otherY - right.otherY ||
        left.plan.index - right.plan.index ||
        (left.role === right.role ? 0 : left.role === 'source' ? -1 : 1),
    )
    const count = group.length
    const span = count <= 1 ? 0 : Math.min(BACK_PORT_SPAN, (count - 1) * BACK_PORT_STEP)
    group.forEach((port, slot) => {
      const offset = count <= 1 ? 0 : span / 2 - (span * slot) / (count - 1)
      if (port.role === 'source') port.plan.sourceOffset = offset
      else port.plan.targetOffset = offset
    })
  }
}

/** 把一个端口加进「节点 + 侧」的分组里。 */
function addBackPort(
  groups: Map<string, BackPort[]>,
  plan: BackEdgePlan,
  role: BackPort['role'],
  node: GraphLayoutNode,
  otherY: number,
): void {
  const key = `${node.id}\u0000${plan.side}`
  const port: BackPort = { plan, role, otherY }
  const group = groups.get(key)
  if (group === undefined) groups.set(key, [port])
  else group.push(port)
}

/**
 * 同层回绕从目标的底边 / 顶边进入：入口偏离中点，避免和中间的向前箭头叠在一起；
 * 同一个目标的多条回连分在两侧。
 *
 * @param plans
 */
function assignSameLayerEntries(plans: BackEdgePlan[]): void {
  const counts = new Map<string, number>()
  for (const plan of plans) {
    if (plan.from.layer !== plan.to.layer) continue
    const count = counts.get(plan.to.id) ?? 0
    counts.set(plan.to.id, count + 1)
    const reach = Math.min(16, plan.to.width / 4)
    const side = plan.side === 'right' ? 1 : -1
    plan.entryOffset = side * (count % 2 === 0 ? reach : -reach)
  }
}

/**
 * 回向通道：从侧边出线，沿节点外侧的车道折回目标侧边。全程只有水平/垂直线段。
 *
 * @param plan
 * @param laneX 车道的 x
 * @returns
 */
function backEdgeGeometry(
  plan: BackEdgePlan,
  laneX: number,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const { from, to, side } = plan
  const sx = sidePortX(from, side, plan.sourceOffset)
  const sy = from.y + plan.sourceOffset
  if (from.layer === to.layer) return sameLayerBackGeometry(plan, laneX, sx, sy)

  const tx = sidePortX(to, side, plan.targetOffset)
  const ty = to.y + plan.targetOffset
  const d = `M ${fmt(sx)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(ty)} L ${fmt(tx)} ${fmt(ty)}`
  return {
    d,
    hit: d,
    arrow: {
      x: tx + (side === 'right' ? ARROW_INSET : -ARROW_INSET),
      y: ty,
      angle: side === 'right' ? 180 : 0,
    },
    labelAt: { x: laneX, y: (sy + ty) / 2 },
  }
}

/**
 * 同层回向通道：从侧边绕到下一行（没有下一行时绕到上一行）的轨道，再从目标底边 / 顶边进入。
 *
 * @param plan
 * @param laneX
 * @param sx 出线点 x
 * @param sy 出线点 y
 * @returns
 */
function sameLayerBackGeometry(
  plan: BackEdgePlan,
  laneX: number,
  sx: number,
  sy: number,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const { to } = plan
  const tx = to.x + plan.entryOffset
  const radius = to.height / 2
  const straight = to.width / 2 - radius
  const cap = Math.max(0, Math.abs(plan.entryOffset) - straight)
  const reach = Math.sqrt(Math.max(0, radius * radius - cap * cap))
  const edgeY = plan.trackBelow ? to.y + reach : to.y - reach
  const d = `M ${fmt(sx)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(edgeY)}`
  return {
    d,
    hit: d,
    arrow: {
      x: tx,
      y: plan.trackBelow ? edgeY + ARROW_INSET : edgeY - ARROW_INSET,
      angle: plan.trackBelow ? -90 : 90,
    },
    labelAt: { x: (laneX + tx) / 2, y: plan.trackY },
  }
}

/**
 * 节点侧边的出线点：纵向偏移后落在胶囊形的圆弧上。
 *
 * @param node
 * @param side
 * @param offset 相对节点中心的纵向偏移
 * @returns
 */
function sidePortX(node: GraphLayoutNode, side: Side, offset: number): number {
  const radius = node.height / 2
  const reach = Math.sqrt(Math.max(0, radius * radius - offset * offset))
  const distance = node.width / 2 - radius + reach
  return node.x + (side === 'right' ? distance : -distance)
}

/**
 * 向下的通道：从下层节点的底边中点连到目标节点的顶边中点；同一对节点的
 * 多条通道用 `offset` 错开车道，标签在曲线上用 `labelT` 错开高度。
 *
 * @param from
 * @param to
 * @param offset 横向车道偏移
 * @param labelT 标签在曲线上的位置（0 起点，1 终点）
 * @returns
 */
function forwardEdgeGeometry(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
  offset = 0,
  labelT = 0.5,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const x1 = from.x
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y - to.height / 2
  const control = Math.max(16, (y2 - y1) / 2)
  const p0 = { x: x1, y: y1 }
  const p1 = { x: x1 + offset, y: y1 + control }
  const p2 = { x: x2 + offset, y: y2 - control }
  const p3 = { x: x2, y: y2 }
  const d = `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`
  const point = cubicPoint(p0, p1, p2, p3, 0.8)
  const tangent = cubicTangent(p0, p1, p2, p3, 0.8)
  return {
    d,
    hit: d,
    arrow: { x: point.x, y: point.y, angle: angleOf(tangent) },
    labelAt: cubicPoint(p0, p1, p2, p3, labelT),
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
