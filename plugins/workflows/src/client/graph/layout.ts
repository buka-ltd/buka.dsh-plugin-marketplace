/**
 * 流程图布局：岗位 / 内建开始结束节点按层从上到下排布，通道向下或从侧面绕行。
 *
 * 相邻层的通道用曲线直连；回向通道固定走右侧车道，跨层前向通道（跳过中间层）
 * 固定走左侧车道：向上与向下的绕行分居两侧，不会在同一条车道或同一侧端口上
 * 交叠。跨层前向通道绕过中间层后再折回目标，不会在中间层节点上垂直贯穿。
 *
 * 车道按纵向区间复用——互不重叠的绕行共用一条车道——同一节点的多个端口沿
 * 侧边 / 底边错开，层间横向轨道按带内数量均分，避免线与线、线与节点叠在一起。
 *
 * 通道名贴在各自连线的空白一侧：相邻层通道跟着曲线弧顶走，跨层前向通道压在
 * 目标侧入线段上方、紧贴箭头；标注宽度按渲染层的截断上限估算，长标签朝目标
 * 一侧收，不会飘到上一层的空隙里跟别的通道名挤在一起。
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
  /** 执行者头像 id。 */
  avatar?: string
  /** 任务状态汇总；没有完成态数据时是 idle。 */
  status?: string
  /** 右上角的角标：运行态显示完成 / 总数。 */
  meta?: string
  /** 鼠标悬浮的完整说明。 */
  title?: string
  /** 运行态：该节点有会话正在等用户操作 / 回复，卡片左上角显示小红点。 */
  awaitingUser?: boolean
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

/** 通道标签的字号，与样式表里 `.buka-workflows-edgeLabel` 保持一致。 */
const EDGE_LABEL_FONT_SIZE = 11

/** 标签里拉丁字符的估算字宽（中文按一个字号算）。 */
const EDGE_LABEL_LATIN_WIDTH = 6.2

/** 标签离画布边缘、离节点的最小留白。 */
const EDGE_LABEL_MARGIN = 6
const EDGE_LABEL_CLEARANCE = 4

/** 渲染层保留的标签字符数（超出截断成省略号）；布局按同一上限估宽。 */
export const MAX_EDGE_LABEL_CHARS = 14

/** 回向通道绕行额外留白（单侧）。 */
const BACK_EXTRA = 12

/** 同一节点侧边多个端口展开的最大高度。 */
const BACK_PORT_SPAN = 20

/** 同一节点侧边相邻端口之间的间距。 */
const BACK_PORT_STEP = 10

/** 前向通道在节点底边 / 顶边相邻端口之间的间距。 */
const PORT_STEP = 9

/** 前向通道端口离节点圆角的最小距离。 */
const PORT_INSET = 4

/** 箭头离节点边缘的距离。 */
const ARROW_INSET = 5

/** 通道绕行时走哪一侧。 */
type Side = 'left' | 'right'

/**
 * 回向通道固定走右侧：向上的回边和向下的跨层通道分居两侧，避免两条线在
 * 同一条车道上重叠或交错。
 */
const BACK_SIDE: Side = 'right'

/** 跨层前向通道固定走左侧，与回向通道分居两侧。 */
const STRADDLE_SIDE: Side = 'left'

/** 一条回向通道的走线计划；坐标在布局完成后补进来。 */
interface BackEdgePlan {
  /** 在过滤后的通道列表里的下标。 */
  index: number
  from: GraphLayoutNode
  to: GraphLayoutNode
  side: Side
  /** 该侧的第几条纵向车道；区间不重叠的绕行会复用同一条。 */
  lane: number
  /** 纵向车道覆盖的 y 区间，用来判断两条绕行能不能共用车道。 */
  yLow: number
  yHigh: number
  /** 从源节点侧边出线；否则从底边经层间空隙横移到车道。 */
  sourceSide: boolean
  /** 从目标节点侧边进线；否则从下方空隙折回目标底边。 */
  targetSide: boolean
  /** 同层回绕走行的下一行还是上一行。 */
  trackBelow: boolean
  /** 同层回绕轨道的 y。 */
  trackY: number
  /** 源节点下方的横向轨道 y（仅底边出线时用）。 */
  sourceTrackY: number
  /** 目标节点下方的横向轨道 y（仅底边入线时用）。 */
  targetTrackY: number
  /** 出线 / 入线在节点侧边的纵向偏移。 */
  sourceOffset: number
  targetOffset: number
  /** 底边 / 顶边出线时相对节点中心的横向偏移，同一节点的多个绕行错开。 */
  sourceFallbackOffset: number
  /** 底边 / 顶边进线时相对节点中心的横向偏移。 */
  targetFallbackOffset: number
  /** 同层回绕进入目标底边 / 顶边时的横向偏移，避开中间的箭头。 */
  entryOffset: number
}

/**
 * 一条跨层前向通道的走线计划：优先从节点侧边出线，沿所有节点外侧的纵向车道
 * 绕过中间层，再从目标侧边进线；侧边被同排节点挡住时退回层间空隙轨道。
 */
interface StraddlePlan {
  /** 在过滤后的通道列表里的下标。 */
  index: number
  from: GraphLayoutNode
  to: GraphLayoutNode
  side: Side
  /** 该侧的第几条纵向车道。 */
  lane: number
  /** 车道覆盖的 y 区间，用来复用互不重叠的车道。 */
  yLow: number
  yHigh: number
  /** 从源节点侧边出线；否则从底边经层间空隙横移到车道。 */
  sourceSide: boolean
  /** 从目标节点侧边进线；否则从上方空隙折回目标顶边。 */
  targetSide: boolean
  /** 源节点下方的横向轨道 y（仅底边出线时用）。 */
  sourceTrackY: number
  /** 目标节点上方的横向轨道 y（仅顶边入线时用）。 */
  targetTrackY: number
  /** 侧边出线 / 进线在节点侧边上的纵向偏移。 */
  sourceOffset: number
  targetOffset: number
}

/** 需要走外侧车道的通道。 */
type DetourPlan = BackEdgePlan | StraddlePlan

/** 前向通道在端点上的端口偏移：相对节点中心。 */
interface ForwardPorts {
  source: number[]
  target: number[]
}

/** 节点侧边上的一个端口请求。 */
interface SidePortRequest {
  side: Side
  node: GraphLayoutNode
  role: 'source' | 'target'
  /** 另一端节点的 y，用来决定端口在侧边上的顺序。 */
  otherY: number
  /** 通道下标，顺序相同时按它稳定排序。 */
  index: number
  /** 把算好的纵向偏移写回走线计划。 */
  set: (offset: number) => void
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
  const rowOf = new Map<number, number>()
  layerKeys.forEach((layer, index) => {
    rowOf.set(layer, index)
  })
  const rowCount = layerKeys.length
  const rowWidth = Math.max(1, ...layerKeys.map((layer) => rowWidthOf(byLayer.get(layer) ?? [])))
  const rowTop = (row: number): number => PAD + row * (NODE_HEIGHT + GAP_Y)
  const rowBottom = (row: number): number => rowTop(row) + NODE_HEIGHT
  const width0 = SIDE_PAD * 2 + rowWidth
  const height = PAD * 2 + rowCount * NODE_HEIGHT + Math.max(0, rowCount - 1) * GAP_Y

  // 先按不含绕行车道的宽度居中布点；绕行需要的外侧留白最后补上再整体平移。
  const byId = new Map<string, GraphLayoutNode>()
  const laidOut: GraphLayoutNode[] = []
  layerKeys.forEach((layer, index) => {
    const group = byLayer.get(layer) ?? []
    const groupWidth = rowWidthOf(group)
    let cursor = (width0 - groupWidth) / 2
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

  if (laidOut.length === 0) return { width: width0, height, nodes: laidOut, edges: [] }

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

  // 层间横向轨道：同层回绕与跨层通道共用一套槽位，按带内数量均分 y，
  // 既不会共线重叠，也不会跑出层间空隙。
  const bands = new Map<number, Array<(y: number) => void>>()
  const slotOf = (band: number, assign: (y: number) => void): void => {
    const list = bands.get(band)
    if (list === undefined) bands.set(band, [assign])
    else list.push(assign)
  }

  const backPlans = planBackEdges(edges, layers, rowOf, rowCount, byId, rows, slotOf)
  const straddlePlans = planStraddleEdges(edges, layers, rowOf, byId, rows, slotOf)
  for (const [band, list] of bands) {
    const top = band < 0 ? 0 : rowBottom(band)
    const bottom = band >= rowCount - 1 ? height : rowTop(band + 1)
    const count = list.length
    list.forEach((assign, slot) => {
      assign(top + ((slot + 1) * (bottom - top)) / (count + 1))
    })
  }

  const ports = assignForwardPorts(edges, layers, byId, straddlePlans)
  assignSidePorts([
    ...sidePortRequestsOfBack(backPlans),
    ...sidePortRequestsOfStraddle(straddlePlans),
  ])

  // 绕行通道的车道区间取实际经过的两端：侧边出 / 入时到节点中心，否则到轨道。
  for (const plan of backPlans.values()) {
    if (plan.from.layer === plan.to.layer) continue
    const low = plan.sourceSide ? plan.from.y : plan.sourceTrackY
    const high = plan.targetSide ? plan.to.y : plan.targetTrackY
    plan.yLow = Math.min(low, high)
    plan.yHigh = Math.max(low, high)
  }
  for (const plan of straddlePlans.values()) {
    const low = plan.sourceSide ? plan.from.y : plan.sourceTrackY
    const high = plan.targetSide ? plan.to.y : plan.targetTrackY
    plan.yLow = Math.min(low, high)
    plan.yHigh = Math.max(low, high)
  }

  const detours: DetourPlan[] = [...backPlans.values(), ...straddlePlans.values()]
  assignDetourLanes(detours)

  // 相邻层前向通道的贝塞尔控制点可能鼓出节点外沿；绕行车道要绕到这些曲线之外。
  const pairCounts = new Map<string, number>()
  for (const edge of edges) {
    const pair = `${edge.from}->${edge.to}`
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1)
  }
  const pairSeen = new Map<string, number>()
  const forwardOffsets = new Map<number, number>()
  const forwardLabelTs = new Map<number, number>()
  let curveLeft = nodeLeft
  let curveRight = nodeRight
  for (const [index, edge] of edges.entries()) {
    if (isBackEdge(edge, layers) || straddlePlans.has(index)) continue
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
    const source = ports.source[index] ?? 0
    const target = ports.target[index] ?? 0
    curveLeft = Math.min(curveLeft, Math.min(from.x + source, to.x + target) + Math.min(0, offset))
    curveRight = Math.max(
      curveRight,
      Math.max(from.x + source, to.x + target) + Math.max(0, offset),
    )
  }

  // 按实际用到的最大车道补两侧留白，然后整体平移到画布中。
  let maxLaneLeft = -1
  let maxLaneRight = -1
  for (const plan of detours) {
    if (!usesOuterLane(plan)) continue
    if (plan.side === 'left') maxLaneLeft = Math.max(maxLaneLeft, plan.lane)
    else maxLaneRight = Math.max(maxLaneRight, plan.lane)
  }
  // 跨层通道的名字压在自己的车道中间，所以车道与节点列之间要留出半个标签，画布
  // 左侧还要留出另外半个：按最宽的那条标签算，一次留够。
  let labelHalfLeft = 0
  for (const plan of straddlePlans.values()) {
    if (plan.side !== 'left') continue
    const labelled = edges[plan.index]
    if (labelled === undefined) continue
    const text = typeof labelled.label === 'string' ? labelled.label : ''
    labelHalfLeft = Math.max(labelHalfLeft, edgeLabelWidth(text) / 2)
  }
  const straddleInset = labelHalfLeft === 0 ? 0 : labelHalfLeft + EDGE_LABEL_CLEARANCE
  const padLeftLane = maxLaneLeft < 0 ? 0 : BACK_OFFSET + maxLaneLeft * BACK_STEP + BACK_EXTRA
  const padLeftLabel =
    labelHalfLeft === 0
      ? 0
      : BACK_OFFSET +
        Math.max(0, maxLaneLeft) * BACK_STEP +
        straddleInset +
        labelHalfLeft +
        EDGE_LABEL_MARGIN -
        SIDE_PAD
  const padLeft = Math.max(padLeftLane, padLeftLabel)
  const padRight = maxLaneRight < 0 ? 0 : BACK_OFFSET + maxLaneRight * BACK_STEP + BACK_EXTRA
  const width = width0 + padLeft + padRight
  const dx = SIDE_PAD + padLeft - nodeLeft
  if (dx !== 0) {
    for (const node of laidOut) node.x += dx
    curveLeft += dx
    curveRight += dx
  }

  const laidOutEdges: GraphLayoutEdge[] = []
  const usedKeys = new Map<string, number>()
  for (const [index, edge] of edges.entries()) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue
    const back = isBackEdge(edge, layers)
    const backPlan = backPlans.get(index)
    const straddle = straddlePlans.get(index)
    const baseKey = `${edge.from}->${edge.to}`
    const seen = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, seen + 1)
    const key = seen === 0 ? baseKey : `${baseKey}#${seen}`
    const types = Array.isArray(edge.types)
      ? edge.types.filter((type) => typeof type === 'string')
      : []
    const lanePlan = straddle ?? backPlan
    const laneX =
      lanePlan === undefined
        ? 0
        : lanePlan.side === 'right'
          ? curveRight + BACK_OFFSET + lanePlan.lane * BACK_STEP
          : curveLeft -
            BACK_OFFSET -
            lanePlan.lane * BACK_STEP -
            (lanePlan === straddle ? straddleInset : 0)
    const source = ports.source[index] ?? 0
    const target = ports.target[index] ?? 0
    const geometry =
      back && backPlan !== undefined
        ? backEdgeGeometry(backPlan, laneX)
        : straddle !== undefined
          ? straddleEdgeGeometry(straddle, laneX, source, target)
          : forwardEdgeGeometry(
              from,
              to,
              forwardOffsets.get(index) ?? 0,
              forwardLabelTs.get(index) ?? 0.5,
              source,
              target,
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
 * 给回向通道排车道、分端口。全部用节点中心坐标判断，结果与横向平移无关。
 *
 * 回向通道固定走右侧车道；某一端的右侧被同排兄弟挡住时，这一端改从底边 /
 * 顶边经层间空隙的横向轨道接入，不会为了绕开兄弟而换到左侧和向下的线抢道。
 *
 * @param edges
 * @param layers
 * @param rowOf 层号 → 行下标
 * @param rowCount 行数
 * @param byId
 * @param rows
 * @param slotOf 登记层间横向轨道
 * @returns 通道下标 → 走线计划
 */
function planBackEdges(
  edges: GraphEdgeInput[],
  layers: Map<string, number>,
  rowOf: Map<number, number>,
  rowCount: number,
  byId: Map<string, GraphLayoutNode>,
  rows: Map<number, GraphLayoutNode[]>,
  slotOf: (band: number, assign: (y: number) => void) => void,
): Map<number, BackEdgePlan> {
  const plans: BackEdgePlan[] = []
  for (const [index, edge] of edges.entries()) {
    if (!isBackEdge(edge, layers)) continue
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue
    plans.push({
      index,
      from,
      to,
      side: BACK_SIDE,
      lane: 0,
      yLow: Math.min(from.y, to.y),
      yHigh: Math.max(from.y, to.y),
      sourceSide: true,
      targetSide: true,
      trackBelow: true,
      trackY: 0,
      sourceTrackY: 0,
      targetTrackY: 0,
      sourceOffset: 0,
      targetOffset: 0,
      sourceFallbackOffset: 0,
      targetFallbackOffset: 0,
      entryOffset: 0,
    })
  }

  for (const plan of plans) {
    // 侧边被同排兄弟挡住时改从底边进出，避免横穿兄弟节点；同层回绕只看源节点。
    plan.sourceSide = blockerCount(plan.from, plan.side, rows) === 0
    if (plan.from.layer === plan.to.layer) continue
    plan.targetSide = blockerCount(plan.to, plan.side, rows) === 0
    if (!plan.sourceSide) {
      slotOf(rowOf.get(plan.from.layer) ?? 0, (y) => {
        plan.sourceTrackY = y
      })
    }
    if (!plan.targetSide) {
      slotOf(rowOf.get(plan.to.layer) ?? 0, (y) => {
        plan.targetTrackY = y
      })
    }
  }

  for (const plan of plans) {
    if (plan.from.layer !== plan.to.layer) continue
    const row = rowOf.get(plan.from.layer) ?? 0
    plan.trackBelow = row < rowCount - 1
    const band = plan.trackBelow ? row : row - 1
    slotOf(band, (y) => {
      plan.trackY = y
      plan.yLow = Math.min(plan.from.y, y)
      plan.yHigh = Math.max(plan.from.y, y)
    })
  }

  assignSameLayerEntries(plans)
  assignBackFallbackPorts(plans)

  const byIndex = new Map<number, BackEdgePlan>()
  for (const plan of plans) byIndex.set(plan.index, plan)
  return byIndex
}

/**
 * 跨层前向通道：跳过中间层的边不能垂直穿过中间层的节点。
 *
 * 固定从左侧车道绕行：两侧都能从侧边进出时贴左侧走，某一端被同排兄弟挡住时
 * 这一端退回层间空隙的横向轨道。左侧车道不给回向通道使用，向上的线不会和
 * 向下的线叠在同一条车道上。
 *
 * @param edges
 * @param layers
 * @param rowOf
 * @param byId
 * @param rows
 * @param slotOf
 * @returns 通道下标 → 走线计划
 */
function planStraddleEdges(
  edges: GraphEdgeInput[],
  layers: Map<string, number>,
  rowOf: Map<number, number>,
  byId: Map<string, GraphLayoutNode>,
  rows: Map<number, GraphLayoutNode[]>,
  slotOf: (band: number, assign: (y: number) => void) => void,
): Map<number, StraddlePlan> {
  const plans: StraddlePlan[] = []
  for (const [index, edge] of edges.entries()) {
    if (!isStraddleEdge(edge, layers)) continue
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue

    const plan: StraddlePlan = {
      index,
      from,
      to,
      side: STRADDLE_SIDE,
      lane: 0,
      yLow: from.y,
      yHigh: to.y,
      sourceSide: blockerCount(from, STRADDLE_SIDE, rows) === 0,
      targetSide: blockerCount(to, STRADDLE_SIDE, rows) === 0,
      sourceTrackY: 0,
      targetTrackY: 0,
      sourceOffset: 0,
      targetOffset: 0,
    }
    const fromRow = rowOf.get(from.layer) ?? 0
    const toRow = rowOf.get(to.layer) ?? fromRow + 1
    if (!plan.sourceSide) {
      slotOf(fromRow, (y) => {
        plan.sourceTrackY = y
      })
    }
    if (!plan.targetSide) {
      slotOf(toRow - 1, (y) => {
        plan.targetTrackY = y
      })
    }
    plans.push(plan)
  }

  const byIndex = new Map<number, StraddlePlan>()
  for (const plan of plans) byIndex.set(plan.index, plan)
  return byIndex
}

/**
 * 估算通道标签的宽度：渲染层会把超长标签截断成省略号，估宽按截断后的字符算，
 * 免得一条很长但没有展示完的标签把落位推到别处。
 *
 * @param label 标签原文
 * @returns 估算宽度
 */
function edgeLabelWidth(label: string): number {
  const chars = [...label]
  const shown =
    chars.length <= MAX_EDGE_LABEL_CHARS
      ? chars
      : [...chars.slice(0, MAX_EDGE_LABEL_CHARS - 1), '…']
  let width = 0
  for (const char of shown) {
    if (char === '…') width += EDGE_LABEL_LATIN_WIDTH * 1.6
    else if ((char.codePointAt(0) ?? 0) >= 0x2e80) width += EDGE_LABEL_FONT_SIZE
    else width += EDGE_LABEL_LATIN_WIDTH
  }
  return Math.round(width)
}

/**
 * 跨层前向通道的走线：侧边出 / 侧边入时直接沿车道上下；被挡住的一侧退回
 * 底边 / 顶边的层间空隙轨道。
 *
 * @param plan
 * @param laneX 车道的 x
 * @param sourcePort 源节点底边的端口偏移（仅底边出线时用）
 * @param targetPort 目标节点顶边的端口偏移（仅顶边入线时用）
 * @returns
 */
function straddleEdgeGeometry(
  plan: StraddlePlan,
  laneX: number,
  sourcePort: number,
  targetPort: number,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const { from, to, side } = plan
  const sx = plan.sourceSide ? sidePortX(from, side, plan.sourceOffset) : from.x + sourcePort
  const sy = plan.sourceSide ? from.y + plan.sourceOffset : from.y + from.height / 2
  const tx = plan.targetSide ? sidePortX(to, side, plan.targetOffset) : to.x + targetPort
  const ty = plan.targetSide ? to.y + plan.targetOffset : to.y - to.height / 2

  const points: Array<[number, number]> = [[sx, sy]]
  if (!plan.sourceSide) points.push([sx, plan.sourceTrackY])
  points.push([laneX, plan.sourceSide ? sy : plan.sourceTrackY])
  points.push([laneX, plan.targetSide ? ty : plan.targetTrackY])
  if (!plan.targetSide) points.push([tx, plan.targetTrackY])
  points.push([tx, ty])
  const d = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`)
    .join(' ')

  const arrow = plan.targetSide
    ? {
        x: tx + (side === 'right' ? ARROW_INSET : -ARROW_INSET),
        y: ty,
        angle: side === 'right' ? 180 : 0,
      }
    : { x: tx, y: ty - ARROW_INSET, angle: 90 }
  // 名字压在绕行车道自己的中间：横向居中于线，纵向落在绕行段的中点，和回向
  // 通道的标签同一套规则；车道外的留白已按标签宽度留够，不会压住节点。
  const labelAt = { x: laneX, y: (sy + ty) / 2 }
  return { d, hit: d, arrow, labelAt }
}

/**
 * 给前向通道分配端口的横向偏移：同一节点上的多条出线 / 入线按对端位置错开，
 * 多条通道不会挤在底边 / 顶边的同一点上。
 *
 * 跨层通道按它绕行的外侧方向排序：从右侧车道绕回来的接最右端口，从左侧绕的
 * 接最左端口，横向折回时不会横穿同节点的其它入线。
 *
 * @param edges
 * @param layers
 * @param byId
 * @param straddlePlans 跨层通道的走线计划
 * @returns 每条通道在源节点与目标节点上的横向偏移
 */
function assignForwardPorts(
  edges: GraphEdgeInput[],
  layers: Map<string, number>,
  byId: Map<string, GraphLayoutNode>,
  straddlePlans: Map<number, StraddlePlan>,
): ForwardPorts {
  const source = new Array<number>(edges.length).fill(0)
  const target = new Array<number>(edges.length).fill(0)
  const outs = new Map<string, number[]>()
  const ins = new Map<string, number[]>()
  for (const [index, edge] of edges.entries()) {
    if (isBackEdge(edge, layers)) continue
    const plan = straddlePlans.get(index)
    if (plan?.sourceSide !== true) {
      const outList = outs.get(edge.from)
      if (outList === undefined) outs.set(edge.from, [index])
      else outList.push(index)
    }
    if (plan?.targetSide !== true) {
      const inList = ins.get(edge.to)
      if (inList === undefined) ins.set(edge.to, [index])
      else inList.push(index)
    }
  }
  const xOf = (id: string | undefined): number => (id === undefined ? 0 : (byId.get(id)?.x ?? 0))
  const PORT_FAR = 1_000_000
  const detourKey = (index: number): number | null => {
    const plan = straddlePlans.get(index)
    if (plan === undefined) return null
    return plan.side === 'right' ? PORT_FAR : -PORT_FAR
  }
  const outKey = (index: number): number => detourKey(index) ?? xOf(edges[index]?.to)
  const inKey = (index: number): number => detourKey(index) ?? xOf(edges[index]?.from)
  for (const [nodeId, list] of outs) {
    const node = byId.get(nodeId)
    if (node === undefined) continue
    const sorted = [...list].sort((left, right) => outKey(left) - outKey(right) || left - right)
    const offsets = portOffsets(sorted.length, node)
    sorted.forEach((index, slot) => {
      source[index] = offsets[slot] ?? 0
    })
  }
  for (const [nodeId, list] of ins) {
    const node = byId.get(nodeId)
    if (node === undefined) continue
    const sorted = [...list].sort((left, right) => inKey(left) - inKey(right) || left - right)
    const offsets = portOffsets(sorted.length, node)
    sorted.forEach((index, slot) => {
      target[index] = offsets[slot] ?? 0
    })
  }
  return { source, target }
}

/**
 * 同一节点上 N 条前向通道的端口偏移：沿胶囊的直边均匀铺开，左右顺序与对端一致。
 *
 * @param count 通道数
 * @param node 节点
 * @returns 从最左到最右的偏移
 */
function portOffsets(count: number, node: GraphLayoutNode): number[] {
  if (count <= 1) return [0]
  const limit = Math.max(0, (node.width - node.height) / 2 - PORT_INSET)
  const span = Math.min(limit * 2, (count - 1) * PORT_STEP)
  const step = span / (count - 1)
  return Array.from({ length: count }, (_, slot) => -span / 2 + slot * step)
}

/**
 * 是不是跨层前向通道：显式回向不算，目标比源低两层及以上才算。
 *
 * @param edge
 * @param layers
 * @returns
 */
function isStraddleEdge(edge: GraphEdgeInput, layers: Map<string, number>): boolean {
  if (edge.back === true) return false
  return (layers.get(edge.to) ?? 0) - (layers.get(edge.from) ?? 0) >= 2
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
 * 绕行是否占用节点外侧的纵向车道：同层回绕在源侧被挡住时直接从行下方折回，
 * 只走层间空隙，不需要外侧车道。
 *
 * @param plan
 * @returns
 */
function usesOuterLane(plan: DetourPlan): boolean {
  if (!('trackY' in plan)) return true
  return !(plan.from.layer === plan.to.layer && !plan.sourceSide)
}

/**
 * 按纵向区间分配车道：短绕行先占内圈，长绕行套在外圈；区间不重叠的绕行复用同一条。
 *
 * @param plans 回向通道与跨层前向通道
 */
function assignDetourLanes(plans: DetourPlan[]): void {
  for (const side of ['left', 'right'] as const) {
    const list = plans.filter((plan) => plan.side === side && usesOuterLane(plan))
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
 * @param requests 回向通道与跨层通道的侧边端口
 */
function assignSidePorts(requests: SidePortRequest[]): void {
  const groups = new Map<string, SidePortRequest[]>()
  for (const request of requests) {
    const key = `${request.node.id}\u0000${request.side}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [request])
    else group.push(request)
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.otherY - right.otherY ||
        left.index - right.index ||
        (left.role === right.role ? 0 : left.role === 'source' ? -1 : 1),
    )
    const count = group.length
    const span = count <= 1 ? 0 : Math.min(BACK_PORT_SPAN, (count - 1) * BACK_PORT_STEP)
    group.forEach((request, slot) => {
      const offset = count <= 1 ? 0 : span / 2 - (span * slot) / (count - 1)
      request.set(offset)
    })
  }
}

/**
 * 回向通道在节点侧边的端口请求。
 *
 * @param plans
 * @returns
 */
function sidePortRequestsOfBack(plans: Map<number, BackEdgePlan>): SidePortRequest[] {
  const requests: SidePortRequest[] = []
  for (const plan of plans.values()) {
    if (plan.sourceSide) {
      requests.push({
        side: plan.side,
        node: plan.from,
        role: 'source',
        otherY: plan.to.y,
        index: plan.index,
        set: (offset) => {
          plan.sourceOffset = offset
        },
      })
    }
    if (plan.from.layer !== plan.to.layer && plan.targetSide) {
      requests.push({
        side: plan.side,
        node: plan.to,
        role: 'target',
        otherY: plan.from.y,
        index: plan.index,
        set: (offset) => {
          plan.targetOffset = offset
        },
      })
    }
  }
  return requests
}

/**
 * 跨层通道在节点侧边的端口请求：只有从侧边出 / 入的那一端才占侧边端口。
 *
 * @param plans
 * @returns
 */
function sidePortRequestsOfStraddle(plans: Map<number, StraddlePlan>): SidePortRequest[] {
  const requests: SidePortRequest[] = []
  for (const plan of plans.values()) {
    if (plan.sourceSide) {
      requests.push({
        side: plan.side,
        node: plan.from,
        role: 'source',
        otherY: plan.to.y,
        index: plan.index,
        set: (offset) => {
          plan.sourceOffset = offset
        },
      })
    }
    if (plan.targetSide) {
      requests.push({
        side: plan.side,
        node: plan.to,
        role: 'target',
        otherY: plan.from.y,
        index: plan.index,
        set: (offset) => {
          plan.targetOffset = offset
        },
      })
    }
  }
  return requests
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
 * 底边 / 顶边进出的回向通道在节点边缘上的横向端口：同一节点的多个绕行入口
 * 沿胶囊直边错开，避免几条线在同一位置纵向重叠。
 *
 * @param plans
 */
function assignBackFallbackPorts(plans: BackEdgePlan[]): void {
  const sources = new Map<string, BackEdgePlan[]>()
  const targets = new Map<string, BackEdgePlan[]>()
  for (const plan of plans) {
    if (!plan.sourceSide) {
      const list = sources.get(plan.from.id)
      if (list === undefined) sources.set(plan.from.id, [plan])
      else list.push(plan)
    }
    // 同层回绕的入口已经按 entryOffset 在目标边缘上错开。
    if (!plan.targetSide && plan.from.layer !== plan.to.layer) {
      const list = targets.get(plan.to.id)
      if (list === undefined) targets.set(plan.to.id, [plan])
      else list.push(plan)
    }
  }
  for (const list of sources.values()) {
    const node = list[0]?.from
    if (node === undefined) continue
    list.sort((left, right) => left.index - right.index)
    const offsets = portOffsets(list.length, node)
    list.forEach((plan, slot) => {
      plan.sourceFallbackOffset = offsets[slot] ?? 0
    })
  }
  for (const list of targets.values()) {
    const node = list[0]?.to
    if (node === undefined) continue
    list.sort((left, right) => left.index - right.index)
    const offsets = portOffsets(list.length, node)
    list.forEach((plan, slot) => {
      plan.targetFallbackOffset = offsets[slot] ?? 0
    })
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
  const sameLayer = from.layer === to.layer
  const sx = plan.sourceSide
    ? sidePortX(from, side, plan.sourceOffset)
    : from.x + plan.sourceFallbackOffset
  // 同层回绕在最后一行时轨道在行上方，被挡住的源节点要从顶边出线，不能纵向穿过自己。
  const sy = plan.sourceSide
    ? from.y + plan.sourceOffset
    : from.y + (sameLayer && !plan.trackBelow ? -from.height / 2 : from.height / 2)
  if (sameLayer) return sameLayerBackGeometry(plan, laneX, sx, sy)

  const tx = plan.targetSide
    ? sidePortX(to, side, plan.targetOffset)
    : to.x + plan.targetFallbackOffset
  const ty = plan.targetSide ? to.y + plan.targetOffset : to.y + to.height / 2

  const points: Array<[number, number]> = [[sx, sy]]
  if (!plan.sourceSide) points.push([sx, plan.sourceTrackY])
  points.push([laneX, plan.sourceSide ? sy : plan.sourceTrackY])
  points.push([laneX, plan.targetSide ? ty : plan.targetTrackY])
  if (!plan.targetSide) points.push([tx, plan.targetTrackY])
  points.push([tx, ty])
  const d = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`)
    .join(' ')

  const arrow = plan.targetSide
    ? {
        x: tx + (side === 'right' ? ARROW_INSET : -ARROW_INSET),
        y: ty,
        angle: side === 'right' ? 180 : 0,
      }
    : { x: tx, y: ty + ARROW_INSET, angle: -90 }
  return {
    d,
    hit: d,
    arrow,
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
  // 源节点右侧被同排兄弟挡住时，直接从底边 / 顶边进入层间空隙的轨道，不在
  // 节点边缘横向穿过整行，也不占用外侧车道。
  const d = plan.sourceSide
    ? `M ${fmt(sx)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(edgeY)}`
    : `M ${fmt(sx)} ${fmt(sy)} L ${fmt(sx)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(edgeY)}`
  return {
    d,
    hit: d,
    arrow: {
      x: tx,
      y: plan.trackBelow ? edgeY + ARROW_INSET : edgeY - ARROW_INSET,
      angle: plan.trackBelow ? -90 : 90,
    },
    labelAt: { x: ((plan.sourceSide ? laneX : sx) + tx) / 2, y: plan.trackY },
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
 * 向下的通道：从源节点底边连到目标节点顶边；同一对节点的多条通道用 `offset`
 * 错开曲线车道，标签在曲线上用 `labelT` 错开高度。
 *
 * @param from
 * @param to
 * @param offset 横向车道偏移
 * @param labelT 标签在曲线上的位置（0 起点，1 终点）
 * @param sourcePort 源节点底边的端口偏移
 * @param targetPort 目标节点顶边的端口偏移
 * @returns
 */
function forwardEdgeGeometry(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
  offset = 0,
  labelT = 0.5,
  sourcePort = 0,
  targetPort = 0,
): Pick<GraphLayoutEdge, 'd' | 'hit' | 'arrow' | 'labelAt'> {
  const x1 = from.x + sourcePort
  const y1 = from.y + from.height / 2
  const x2 = to.x + targetPort
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
