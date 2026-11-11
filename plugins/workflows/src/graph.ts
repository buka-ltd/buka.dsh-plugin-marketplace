/**
 * 把一次落盘的工作流运行整理成可绘制的节点图。
 *
 * 浏览器一半需要「节点 + 连线 + 每个节点的运行状态」；这些信息分散在定义快照
 * （节点、出口）与状态快照（steps、current、pendingUser、result）里。本模块把
 * 它们合成一份与展示无关的图模型，并给出确定性的分层坐标与 SVG 路径，让页面
 * 只负责渲染、单测可以直接断言几何结果。
 *
 * 图模型：
 *
 * ```text
 * { start, order, nodes: [{ id, type, state, visits, … }],
 *   edges: [{ from, to, kind, names, labels, prompt, tone, traversed, traversals, loop }] }
 * ```
 *
 * - `kind`：目前只有 `next`（机器人 / 用户 / start 节点的出口）；
 * - `names` 是边上的路由键，`labels` 是用户节点选项显示给用户的文字（机器人
 *   节点没有 label）。同一个「来源 → 目标」只留一条边：多条边指向同一目标时
 *   合并，名字 / 选项按定义顺序去重后并列；`prompt` 是进入目标节点时要发的
 *   提示词（取第一条非空值，只作诊断，不在图上渲染）；`tone` 是边可选的
 *   外观色（`success` / `failure`，取第一条有值的边，只用于渲染，不影响路由）；
 * - `traversed`：这次运行实际走过这条边（按 steps 的先后顺序推出）；
 * - `traversals`：走过这条边的次数（循环时同一对节点会被走多次）；
 * - `loop`：这条边属于环（从目标还能走回来源），是按拓扑算的，和行序无关；
 * - `state`：`idle` / `running` / `waiting` / `completed` / `failed` /
 *   `cancelled` / `interrupted`；`idle` 表示这次运行没有走到该节点；
 * - `unreachable`：从 `start` 出发根本没有路径到达该节点。新定义在校验阶段就会
 *   拒绝这种节点（否则它会像第二个起点），这个标记只用于回看旧记录，页面据此
 *   说明它为什么永远不会执行。
 *
 * 布局是自上而下的分层二维图：节点按深度分行，并行的兄弟节点落在同一排；相邻层
 * 之间的边从上 / 下端口直接连过去，跨层 / 回边 / 自环按端点位置选择左侧或右侧的
 * 竖线 lane（两端圆角转弯），同一侧的 lane 按层区间分配、互不重叠。节点尺寸固定，
 * 页面按坐标绝对定位胶囊，SVG 只画连线与方向箭头。
 *
 * @module @buka/dsh-plugin-workflows/graph
 */

import { isPlainObject } from './definition.ts'

/** 节点胶囊的固定宽度（px）；二维布局需要确定性尺寸。 */
export const NODE_WIDTH = 260

/** 节点胶囊的固定高度（px）。 */
export const NODE_HEIGHT = 28

/** 同一排相邻节点之间的水平间距（px）。 */
export const COLUMN_GAP = 40

/** 上下两层节点之间的垂直间距（px）。 */
export const LAYER_GAP = 56

/** 每条侧边 lane 的水平间距（px）；同一侧内层靠近内容，外层依次往外。 */
export const LANE_GAP = 14

/** 画布内容到边缘的留白（px），也用作最外侧 lane 外侧的留白。 */
export const SIDE_PAD = 32

/** 节点中心之间的水平步长（px）。 */
const PITCH = NODE_WIDTH + COLUMN_GAP

/** 相邻两层节点中心之间的垂直步长（px）。 */
const LAYER_PITCH = NODE_HEIGHT + LAYER_GAP

/** 侧边 lane 与同层横穿线的圆角半径（px）。 */
const CORNER = 12

/** 图模型里的一条出边（已规范化成统一形状）。 */
export interface GraphNodeRule {
  to: string
  name: string
  label: string
  prompt: string
  tone: string
}

/** 图模型内部使用的节点配置：只保留展示与路由需要的信息。 */
export interface GraphNodeConfig {
  id: string
  type: string
  next?: GraphNodeRule[]
  robot?: string
  summary?: string
  mode?: 'plan'
  task?: string
  timeoutMs?: number
  maxVisits?: number
  title?: string
  detail?: string
  questions?: unknown[]
  inputs?: unknown[]
  endStatus?: string
}

/** 图模型里的一个节点（带运行态）。 */
export interface RunGraphNode {
  id: string
  type: string
  state: string
  unreachable: boolean
  visits: number
  lastSeq: number | null
  startedAt: number | null
  finishedAt: number | null
  durationMs: number
  stopReason: string | null
  sessionId: string | null
  error: string | null
  task: string
  summary: string | null
  outputText: string
  robot: string | null
  avatar: string | null
  title: string | null
  detail: string | null
  questions: unknown[] | null
  endStatus: string | null
  timeoutMs: number | null
  maxVisits: number | null
  mode: 'plan' | null
  inputs: unknown[] | null
  next: GraphNodeRule[] | undefined
}

/** 图模型里的一条边。 */
export interface RunGraphEdge {
  key: string
  from: string
  to: string
  kind: 'next'
  names: string[]
  labels: string[]
  prompt: string
  tone: string
  traversed: boolean
  traversals: number
  loop: boolean
}

/** 不带坐标的图模型。 */
export interface RunGraph {
  start: string | null
  order: string[]
  nodes: RunGraphNode[]
  edges: RunGraphEdge[]
}

/** 布局里的一个节点坐标。 */
export interface LayoutPoint {
  id: string
  layer: number
  x: number
  y: number
}

/** 布局后的一条边（带 SVG 路径与箭头）。 */
export interface LayoutEdge extends RunGraphEdge {
  lane: number
  side: 'center' | 'left' | 'right'
  d: string
  arrow: { x: number; y: number; angle: number } | null
}

/** 分层二维布局的结果。 */
export interface RunGraphLayout {
  width: number
  height: number
  nodeWidth: number
  nodeHeight: number
  layerGap: number
  layers: Array<{ index: number; y: number }>
  positions: LayoutPoint[]
  edges: LayoutEdge[]
}

/**
 * 保留两位小数，让坐标与 SVG 路径在测试里稳定可比。
 *
 * @param value 原始值
 * @returns 保留两位小数后的值
 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** 终止节点允许的最终状态。 */
const END_STATUSES = new Set(['completed', 'failed', 'rejected'])

/** 卡片上最终文本 / 任务预览的最大字符数。 */
const PREVIEW_LIMIT = 160

/**
 * 把多行文本压成一行预览。
 *
 * @param value 原始值
 * @param limit 字符上限
 * @returns 单行预览
 */
function previewLine(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  if (collapsed === '') return ''
  if (collapsed.length <= limit) return collapsed
  return `${collapsed.slice(0, Math.max(0, limit - 1))}…`
}

/** 节点类型。 */
const NODE_TYPES = new Set(['start', 'robot', 'user', 'join', 'end'])

/**
 * 读取定义快照里的节点表。
 *
 * 优先用 `plan`（宿主校验后的规范化结果），退回原始 `definition`。
 * 两者都没有时返回 null，调用方会用 steps 兜底。
 *
 * @param definition 运行记录里的定义快照
 * @returns 起始节点与规范化后的节点表；没有可用定义时是 `null`
 */
function readDefinitionNodes(
  definition: unknown,
): { start: string | null; nodes: GraphNodeConfig[] } | null {
  if (!isPlainObject(definition)) return null
  const plan = isPlainObject(definition.plan) ? definition.plan : null
  if (plan !== null && isPlainObject(plan.nodes)) {
    const planNodes = plan.nodes
    const ids: string[] = Array.isArray(plan.order)
      ? (plan.order as unknown[]).filter(
          (id): id is string => typeof id === 'string' && isPlainObject(planNodes[id]),
        )
      : Object.keys(planNodes)
    const nodes: GraphNodeConfig[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      nodes.push(normalizeNode(id, planNodes[id] as Record<string, unknown>))
    }
    if (nodes.length > 0) {
      const start =
        typeof plan.start === 'string' && plan.start !== '' ? plan.start : (nodes[0]?.id ?? null)
      return { start, nodes }
    }
  }
  const raw = isPlainObject(definition.definition) ? definition.definition : null
  if (raw === null || !Array.isArray(raw.nodes)) return null
  const nodes: GraphNodeConfig[] = []
  const seen = new Set<string>()
  for (const item of raw.nodes as unknown[]) {
    if (!isPlainObject(item)) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    nodes.push(normalizeNode(id, item))
  }
  if (nodes.length === 0) return null
  const startNode = nodes.find((node) => node.type === 'start')
  const start =
    typeof raw.start === 'string' && raw.start !== ''
      ? raw.start
      : (startNode?.id ?? nodes[0]?.id ?? null)
  return { start, nodes }
}

/**
 * 规范化一个节点，只保留展示与路由需要的信息（不含 prompt 正文）。
 *
 * @param id 节点 id
 * @param raw 原始节点
 * @returns 规范化后的节点配置
 */
function normalizeNode(id: string, raw: Record<string, unknown>): GraphNodeConfig {
  const type = typeof raw.type === 'string' && NODE_TYPES.has(raw.type) ? raw.type : 'robot'
  const node: GraphNodeConfig = { id, type }
  if (type === 'start') {
    node.next = normalizeNext(raw.next)
    return node
  }
  if (type === 'robot') {
    node.robot = typeof raw.robot === 'string' ? raw.robot : ''
    node.summary = typeof raw.summary === 'string' ? raw.summary : ''
    if (raw.mode === 'plan') node.mode = 'plan'
    node.task = previewLine(raw.prompt, 160)
    node.next = normalizeNext(raw.next)
    if (Number.isFinite(raw.timeoutMs)) node.timeoutMs = raw.timeoutMs as number
    if (Number.isFinite(raw.maxVisits)) node.maxVisits = raw.maxVisits as number
    return node
  }
  if (type === 'user') {
    node.title = typeof raw.title === 'string' ? raw.title : ''
    node.detail = typeof raw.detail === 'string' ? raw.detail : ''
    node.next = normalizeNext(raw.next)
    node.questions = Array.isArray(raw.questions) ? raw.questions : []
    return node
  }
  if (type === 'join') {
    node.inputs = Array.isArray(raw.inputs) ? raw.inputs : []
    node.next = normalizeNext(raw.next)
    return node
  }
  node.endStatus =
    typeof raw.status === 'string' && END_STATUSES.has(raw.status) ? raw.status : 'completed'
  return node
}

/**
 * 规范化节点的 `next`：边对象数组（新格式）或字符串 / 字符串数组（旧记录）。
 *
 * 图模型保留给观测者看的 `name`、用户选项的 `label`、边的 `prompt` 与外观色
 * `tone`；路由条件不在这里解析。`tone` 只有 `success` / `failure` 会被保留，
 * 旧记录 / 手工改动里的其它值归一成空串（不画颜色）。
 *
 * @param raw 原始 next
 * @returns 规范化后的出边列表
 */
function normalizeNext(raw: unknown): GraphNodeRule[] {
  if (typeof raw === 'string' && raw.trim() !== '') {
    return [{ to: raw.trim(), name: '', label: '', prompt: '', tone: '' }]
  }
  if (!Array.isArray(raw)) return []
  const rules: GraphNodeRule[] = []
  for (const rule of raw as unknown[]) {
    if (typeof rule === 'string' && rule.trim() !== '') {
      rules.push({ to: rule.trim(), name: '', label: '', prompt: '', tone: '' })
      continue
    }
    if (!isPlainObject(rule)) continue
    const to = typeof rule.to === 'string' ? rule.to.trim() : ''
    if (to === '') continue
    const tone = typeof rule.tone === 'string' ? rule.tone.trim() : ''
    rules.push({
      to,
      name: typeof rule.name === 'string' ? rule.name.trim() : '',
      label: typeof rule.label === 'string' ? rule.label.trim() : '',
      prompt: typeof rule.prompt === 'string' ? rule.prompt : '',
      tone: tone === 'success' || tone === 'failure' ? tone : '',
    })
  }
  return rules
}

/**
 * 构建图模型（不含坐标）。
 *
 * @param input `run` / `definition` 是运行记录里的两份快照；`avatars` 是
 *   「机器人名 → 头像 id」表（由 robots 服务提供），有值的 robot 节点会带上
 *   `avatar`，没有这一项（robots 插件没装 / 机器人已删除）时是 null
 * @returns 图模型；没有可用运行记录时是 `null`
 */
export function buildRunGraph(input: unknown): RunGraph | null {
  if (!isPlainObject(input)) return null
  const run = isPlainObject(input.run) ? input.run : null
  if (run === null || typeof run.runId !== 'string') return null
  const avatars = isPlainObject(input.avatars) ? input.avatars : null
  const steps = Array.isArray(run.steps) ? run.steps.filter(isPlainObject) : []

  const source = readDefinitionNodes(input.definition)
  const configs = new Map<string, GraphNodeConfig>()
  const order: string[] = []
  let start: string | null = null
  if (source !== null) {
    start = source.start
    for (const node of source.nodes) {
      if (configs.has(node.id)) continue
      configs.set(node.id, node)
      order.push(node.id)
    }
  }

  // 没有定义快照（旧记录或快照损坏）时，用步骤顺序还原一条链，至少能看图。
  const synthetic = configs.size === 0
  if (synthetic) {
    for (const step of steps) {
      const id = typeof step.nodeId === 'string' ? step.nodeId : ''
      if (id === '' || configs.has(id)) continue
      configs.set(id, {
        id,
        type: step.type === 'user' ? 'user' : 'robot',
        robot: typeof step.robot === 'string' ? step.robot : '',
        next: [],
      })
      order.push(id)
    }
    start = order[0] ?? null
  }

  if (configs.size === 0) return null

  const stepsByNode = new Map<string, Array<Record<string, unknown>>>()
  for (const step of steps) {
    const id = typeof step.nodeId === 'string' ? step.nodeId : ''
    if (id === '' || !configs.has(id)) continue
    const list = stepsByNode.get(id)
    if (list === undefined) stepsByNode.set(id, [step])
    else list.push(step)
  }

  const result = isPlainObject(run.result) ? run.result : null
  const lastNode = typeof result?.lastNode === 'string' ? result.lastNode : null
  // 并发后活跃节点是数组（run.active）；旧记录退回单值 run.current。
  const actives = Array.isArray(run.active)
    ? run.active.filter(isPlainObject)
    : isPlainObject(run.current)
      ? [run.current]
      : []
  const pendingUser = isPlainObject(run.pendingUser) ? run.pendingUser : null

  // 「任务 → 引用它的 join」反向索引（join.inputs 表达的是入边）。
  const inputJoins = new Map<string, string[]>()
  for (const id of order) {
    const config = configs.get(id)
    if (config?.type !== 'join') continue
    for (const input of Array.isArray(config.inputs) ? config.inputs : []) {
      if (typeof input !== 'string' || !configs.has(input)) continue
      const list = inputJoins.get(input)
      if (list === undefined) inputJoins.set(input, [id])
      else list.push(id)
    }
  }

  /**
   * 节点的出边目标（含 join 的隐式入边：任务 → 引用它的 join）。
   *
   * @param config 节点配置
   * @returns 出边目标 id
   */
  function targetsOf(config: GraphNodeConfig): string[] {
    if (
      config.type === 'start' ||
      config.type === 'robot' ||
      config.type === 'user' ||
      config.type === 'join'
    ) {
      const targets = (config.next ?? []).map((rule) => rule.to)
      if (config.type === 'robot') targets.push(...(inputJoins.get(config.id) ?? []))
      return targets
    }
    return []
  }

  const adjacency = new Map<string, string[]>(order.map((id) => [id, []]))
  for (const id of order) {
    const config = configs.get(id)
    if (config === undefined) continue
    adjacency.set(
      id,
      targetsOf(config).filter((target) => configs.has(target)),
    )
  }
  const reachable = new Map<string, Set<string>>()
  for (const id of order) {
    const seen = new Set<string>()
    const queue: string[] = [...(adjacency.get(id) ?? [])]
    while (queue.length > 0) {
      const next = queue.shift()
      if (typeof next !== 'string' || seen.has(next)) continue
      seen.add(next)
      queue.push(...(adjacency.get(next) ?? []))
    }
    reachable.set(id, seen)
  }

  // 行序按拓扑排序：把成环的节点缩成一组（组内保持定义顺序），再对组之间的
  // DAG 排序。这样所有「不成环」的连线都从上往下走，未执行的节点也留在它该在
  // 的层级，不会被排到结束节点后面造成误解；只有环内的返回边才向上。
  const orderIndex = new Map(order.map((id, index) => [id, index]))
  const componentOf = new Map<string, number>()
  const components: string[][] = []
  for (const id of order) {
    if (componentOf.has(id)) continue
    const members = order.filter(
      (other) =>
        !componentOf.has(other) &&
        (other === id ||
          (reachable.get(id)?.has(other) === true && reachable.get(other)?.has(id) === true)),
    )
    const index = components.length
    for (const member of members) componentOf.set(member, index)
    components.push(members)
  }

  const componentEdges: Array<Set<number>> = components.map(() => new Set<number>())
  const indegree = components.map(() => 0)
  for (const id of order) {
    const from = componentOf.get(id)
    for (const target of adjacency.get(id) ?? []) {
      const to = componentOf.get(target)
      if (to === undefined || to === from || from === undefined) continue
      if (componentEdges[from]?.has(to) === true) continue
      componentEdges[from]?.add(to)
      indegree[to] = (indegree[to] ?? 0) + 1
    }
  }
  const priority = components.map((members) =>
    members.reduce((min, member) => Math.min(min, orderIndex.get(member) ?? Infinity), Infinity),
  )
  const startComponent = start === null ? undefined : componentOf.get(start)
  if (startComponent !== undefined) priority[startComponent] = -1
  const ready: number[] = []
  for (let index = 0; index < components.length; index += 1)
    if (indegree[index] === 0) ready.push(index)
  ready.sort((left, right) => (priority[left] ?? 0) - (priority[right] ?? 0))
  const layoutOrder: string[] = []
  while (ready.length > 0) {
    const index = ready.shift()
    if (index === undefined) break
    const members = [...(components[index] ?? [])].sort(
      (left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0),
    )
    layoutOrder.push(...members)
    for (const next of componentEdges[index] ?? []) {
      indegree[next] = (indegree[next] ?? 0) - 1
      if (indegree[next] !== 0) continue
      ready.push(next)
      ready.sort((left, right) => (priority[left] ?? 0) - (priority[right] ?? 0))
    }
  }
  // DAG 一定全部入列；这里的兜底只防实现意外留下未排序的节点。
  for (const id of order) if (!layoutOrder.includes(id)) layoutOrder.push(id)

  /**
   * 一个节点在这次运行中的状态。
   *
   * @param config 节点配置
   * @returns 节点状态
   */
  function stateOf(config: GraphNodeConfig): string {
    // start 节点本身不执行；从它出发就说明这次运行已经开始了。
    if (config.type === 'start') return 'completed'
    if (config.type === 'join' && config.next?.length === 0) return 'idle'
    if (pendingUser !== null && pendingUser.nodeId === config.id) return 'waiting'
    if (actives.some((active) => active.nodeId === config.id)) return 'running'
    const nodeSteps = stepsByNode.get(config.id) ?? []
    if (nodeSteps.length > 0) {
      const status = nodeSteps[nodeSteps.length - 1]?.status
      return typeof status === 'string' && status !== '' ? status : 'completed'
    }
    if (config.type === 'end' && lastNode === config.id) {
      const status = typeof result?.status === 'string' ? result.status : 'completed'
      return status
    }
    return 'idle'
  }

  const nodes: RunGraphNode[] = layoutOrder.map((id) => {
    const config = configs.get(id) as GraphNodeConfig
    const nodeSteps = stepsByNode.get(id) ?? []
    const lastStep = nodeSteps.length > 0 ? (nodeSteps[nodeSteps.length - 1] ?? null) : null
    // start 自己不可达；其余节点看从 start 出发的 BFS 有没有覆盖到。
    const unreachable = start !== null && id !== start && reachable.get(start)?.has(id) !== true
    let durationMs = 0
    for (const step of nodeSteps) {
      const startedAt = typeof step.startedAt === 'number' ? step.startedAt : null
      const finishedAt = typeof step.finishedAt === 'number' ? step.finishedAt : null
      if (startedAt !== null && finishedAt !== null && finishedAt >= startedAt) {
        durationMs += finishedAt - startedAt
      }
    }
    return {
      id,
      type: config.type,
      state: stateOf(config),
      unreachable,
      visits: nodeSteps.length,
      lastSeq: typeof lastStep?.seq === 'number' ? lastStep.seq : null,
      startedAt: typeof nodeSteps[0]?.startedAt === 'number' ? nodeSteps[0].startedAt : null,
      finishedAt: typeof lastStep?.finishedAt === 'number' ? lastStep.finishedAt : null,
      durationMs,
      stopReason: typeof lastStep?.stopReason === 'string' ? lastStep.stopReason : null,
      sessionId:
        typeof lastStep?.sessionId === 'string' && lastStep.sessionId !== ''
          ? lastStep.sessionId
          : null,
      error: typeof lastStep?.error === 'string' && lastStep.error !== '' ? lastStep.error : null,
      task: config.type === 'robot' ? (config.task ?? '') : '',
      summary: config.type === 'robot' ? (config.summary ?? '') : null,
      outputText: previewLine(lastStep?.text, PREVIEW_LIMIT),
      robot: config.type === 'robot' ? (config.robot ?? null) : null,
      // 节点图上的机器人头像：只认字符串值，查不到就是 null（不画头像）。
      avatar:
        config.type === 'robot' &&
        avatars !== null &&
        typeof config.robot === 'string' &&
        typeof avatars[config.robot] === 'string'
          ? (avatars[config.robot] as string)
          : null,
      title: config.type === 'user' ? (config.title ?? null) : null,
      detail: config.type === 'user' ? (config.detail ?? null) : null,
      questions: config.type === 'user' ? (config.questions ?? []) : null,
      endStatus: config.type === 'end' ? (config.endStatus ?? null) : null,
      timeoutMs:
        config.type === 'robot' && Number.isFinite(config.timeoutMs)
          ? (config.timeoutMs as number)
          : null,
      maxVisits:
        config.type === 'robot' && Number.isFinite(config.maxVisits)
          ? (config.maxVisits as number)
          : null,
      mode: config.type === 'robot' && config.mode === 'plan' ? 'plan' : null,
      inputs: config.type === 'join' ? (config.inputs ?? []) : null,
      next:
        config.type === 'robot' ||
        config.type === 'start' ||
        config.type === 'user' ||
        config.type === 'join'
          ? config.next
          : [],
    }
  })

  /** 这次运行实际走过的节点顺序（含正在执行的节点）。 */
  const sequence: string[] = []
  const pushSequence = (id: unknown): void => {
    if (typeof id !== 'string' || id === '') return
    if (sequence[sequence.length - 1] === id) return
    sequence.push(id)
  }
  for (const step of steps) pushSequence(step.nodeId)
  for (const active of actives) pushSequence(active.nodeId)
  if (pendingUser !== null) pushSequence(pendingUser.nodeId)
  /** 每对相邻节点在这次运行里走了几次；循环会让同一对出现多次。 */
  const pairCounts = new Map<string, number>()
  /**
   * @param from 来源节点 id
   * @param to 目标节点 id
   */
  function countPair(from: string, to: string): void {
    const key = `${from}->${to}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  for (let index = 0; index + 1 < sequence.length; index += 1) {
    countPair(sequence[index] as string, sequence[index + 1] as string)
  }
  // start 节点没有 step；只要运行已经进入第一个真实节点，就视为走过了 start 边。
  if (configs.get(start ?? '')?.type === 'start' && sequence.length > 0 && sequence[0] !== start) {
    countPair(start as string, sequence[0] as string)
  }
  const last = sequence.length > 0 ? (sequence[sequence.length - 1] ?? null) : null
  if (last !== null && lastNode !== null && lastNode !== last) countPair(last, lastNode)

  // 一条边是不是循环边由拓扑决定（目标节点能不能再走回来），和行序无关。
  /**
   * @param from 来源节点 id
   * @param to 目标节点 id
   * @returns 这条边是否属于环
   */
  function inCycle(from: string, to: string): boolean {
    if (from === to) return true
    return reachable.get(to)?.has(from) === true
  }

  // 同一个「来源 → 目标」只画一条线：多条边指向同一目标时合并成一条，名字按
  // 定义顺序并列，避免图上出现平行的重复连线。
  const edgesByKey = new Map<string, RunGraphEdge>()
  /**
   * @param from 来源节点 id
   * @param to 目标节点 id
   * @param kind 边类型
   * @param name 边上写的路由键
   * @param prompt 进入目标节点时要发的提示词（只作诊断，不渲染）
   * @param label 用户节点选项显示给用户的文字
   * @param tone 边上可选的外观色：`success` / `failure`（只用于渲染）
   */
  function pushEdge(
    from: string | undefined,
    to: string | undefined,
    kind: 'next',
    name?: unknown,
    prompt?: unknown,
    label?: unknown,
    tone?: unknown,
  ): void {
    if (from === undefined || to === undefined) return
    if (!configs.has(from) || !configs.has(to)) return
    const key = `${from}->${to}#${kind}`
    const edgeName = typeof name === 'string' ? name.trim() : ''
    const edgePrompt = typeof prompt === 'string' ? prompt : ''
    const edgeLabel = typeof label === 'string' ? label.trim() : ''
    const edgeTone = tone === 'success' || tone === 'failure' ? tone : ''
    const existing = edgesByKey.get(key)
    if (existing !== undefined) {
      if (edgeName !== '' && !existing.names.includes(edgeName)) existing.names.push(edgeName)
      if (edgeLabel !== '' && !existing.labels.includes(edgeLabel)) existing.labels.push(edgeLabel)
      if (existing.prompt === '' && edgePrompt !== '') existing.prompt = edgePrompt
      // 合并线只能有一种颜色：取定义顺序里第一条带 tone 的边。
      if (existing.tone === '' && edgeTone !== '') existing.tone = edgeTone
      return
    }
    const traversals = pairCounts.get(`${from}->${to}`) ?? 0
    edgesByKey.set(key, {
      key,
      from,
      to,
      kind,
      names: edgeName === '' ? [] : [edgeName],
      labels: edgeLabel === '' ? [] : [edgeLabel],
      prompt: edgePrompt,
      tone: edgeTone,
      traversed: traversals > 0,
      traversals,
      // 循环边：从目标还能走回来源（自环恒成立）。
      loop: inCycle(from, to),
    })
  }
  if (synthetic) {
    for (let index = 0; index + 1 < order.length; index += 1) {
      pushEdge(order[index], order[index + 1], 'next')
    }
  } else {
    for (const id of order) {
      const config = configs.get(id)
      if (config === undefined) continue
      if (
        config.type === 'robot' ||
        config.type === 'start' ||
        config.type === 'user' ||
        config.type === 'join'
      ) {
        for (const rule of config.next ?? []) {
          pushEdge(id, rule.to, 'next', rule.name, rule.prompt, rule.label, rule.tone)
        }
      }
      // join 的隐式入边：任务 → join。
      if (config.type === 'join') {
        for (const input of Array.isArray(config.inputs) ? config.inputs : []) {
          if (typeof input === 'string') pushEdge(input, id, 'next', '', '', '')
        }
      }
    }
  }

  return { start, order: layoutOrder, nodes, edges: [...edgesByKey.values()] }
}

/**
 * 计算分层二维节点图的坐标与每条边的 SVG 路径。
 *
 * 节点按深度分层：只统计「更早节点 → 更晚节点」的前向边做最长路径分层，所以并行
 * 分支的自然落在同一排，回边不参与分层。同一层内按父节点横坐标的均值排序并居中，
 * 再强制最小间距，得到确定性的横向坐标。连线从节点上 / 下端口进出：相邻层之间的边
 * 直接连成直线或贝塞尔曲线，跨多层 / 回边 / 自环按端点位置选择**左侧或右侧**的 lane；
 * 同一侧的 lane 按层区间分配，互不重叠。方向箭头画在竖段中点（跨层边）或目标端口
 * 前方（相邻层曲线）。
 *
 * @param graph 图模型
 * @returns 布局结果（尺寸、层、坐标与每条边的路径）
 */
export function layoutRunGraph(graph: RunGraph | null | undefined): RunGraphLayout {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const allEdges = Array.isArray(graph?.edges) ? graph.edges : []
  const empty: RunGraphLayout = {
    width: 0,
    height: 0,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    layerGap: LAYER_GAP,
    layers: [],
    positions: [],
    edges: [],
  }
  if (nodes.length === 0) return empty

  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const incoming = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  for (const edge of allEdges) {
    if (edge.from === edge.to) continue
    const fromIndex = indexOf.get(edge.from)
    const toIndex = indexOf.get(edge.to)
    if (fromIndex === undefined || toIndex === undefined || fromIndex >= toIndex) continue
    const list = incoming.get(edge.to)
    if (list !== undefined && !list.includes(edge.from)) list.push(edge.from)
  }

  // 分层：只让「更早节点 → 更晚节点」的前向边增加层号，回边 / 自环忽略。并行的
  // 兄弟节点因此拿到同一个层号，落在同一排。
  const layerOf = new Map<string, number>()
  for (const node of nodes) {
    let layer = 0
    for (const from of incoming.get(node.id) ?? []) {
      const fromLayer = layerOf.get(from)
      if (typeof fromLayer === 'number') layer = Math.max(layer, fromLayer + 1)
    }
    layerOf.set(node.id, layer)
  }

  const byLayer = new Map<number, RunGraphNode[]>()
  for (const node of nodes) {
    const layer = layerOf.get(node.id) ?? 0
    const list = byLayer.get(layer)
    if (list === undefined) byLayer.set(layer, [node])
    else list.push(node)
  }
  const layerIndexes = [...byLayer.keys()].sort((left, right) => left - right)

  // 同层横坐标：希望落在父节点的平均横坐标下；左右不重叠后把整组平移回期望中心。
  const xOf = new Map<string, number>()
  for (const layer of layerIndexes) {
    const members = byLayer.get(layer) ?? []
    const desired = members.map((node) => {
      const parents = (incoming.get(node.id) ?? []).filter(
        (id) => (layerOf.get(id) ?? layer) < layer,
      )
      if (parents.length === 0) return { node, desired: (indexOf.get(node.id) ?? 0) * PITCH }
      let sum = 0
      for (const parent of parents) sum += xOf.get(parent) ?? 0
      return { node, desired: sum / parents.length }
    })
    desired.sort(
      (left, right) =>
        left.desired - right.desired ||
        (indexOf.get(left.node.id) ?? 0) - (indexOf.get(right.node.id) ?? 0),
    )
    let previous = -Infinity
    const xs = desired.map((item) => {
      const x = Math.max(item.desired, previous + PITCH)
      previous = x
      return x
    })
    const desiredMean = desired.reduce((sum, item) => sum + item.desired, 0) / desired.length
    const xsMean = xs.reduce((sum, x) => sum + x, 0) / xs.length
    const shift = desiredMean - xsMean
    desired.forEach((item, position) => {
      xOf.set(item.node.id, (xs[position] ?? 0) + shift)
    })
  }

  const yOf = new Map<number, number>()
  for (const layer of layerIndexes) yOf.set(layer, SIDE_PAD + layer * LAYER_PITCH + NODE_HEIGHT / 2)

  const contentMinX = Math.min(...nodes.map((node) => (xOf.get(node.id) ?? 0) - NODE_WIDTH / 2))
  const contentMaxX = Math.max(...nodes.map((node) => (xOf.get(node.id) ?? 0) + NODE_WIDTH / 2))
  const contentCenter = (contentMinX + contentMaxX) / 2

  /**
   * @param id 节点 id
   * @returns 节点坐标
   */
  function nodeAt(id: string): LayoutPoint {
    const layer = layerOf.get(id) ?? 0
    return {
      id,
      layer,
      x: xOf.get(id) ?? 0,
      y: yOf.get(layer) ?? SIDE_PAD + NODE_HEIGHT / 2,
    }
  }

  // 相邻层之间的边直接连；其余边按端点位置选左 / 右侧 lane，并按层区间避免共用 lane。
  const sideOf = new Map<string, 'center' | 'left' | 'right'>()
  const laneEdges: Array<{
    edge: RunGraphEdge
    from: LayoutPoint
    to: LayoutPoint
    side: 'left' | 'right'
    start: number
    end: number
    span: number
  }> = []
  for (const edge of allEdges) {
    if (indexOf.get(edge.from) === undefined || indexOf.get(edge.to) === undefined) continue
    const from = nodeAt(edge.from)
    const to = nodeAt(edge.to)
    if (to.layer - from.layer === 1) {
      sideOf.set(edge.key, 'center')
      continue
    }
    const side = (from.x + to.x) / 2 < contentCenter ? 'left' : 'right'
    sideOf.set(edge.key, side)
    const start = Math.min(from.layer, to.layer)
    const end = from.layer === to.layer ? start + 0.5 : Math.max(from.layer, to.layer)
    laneEdges.push({ edge, from, to, side, start, end, span: end - start })
  }
  laneEdges.sort(
    (left, right) =>
      left.span - right.span ||
      left.start - right.start ||
      (indexOf.get(left.edge.from) ?? 0) - (indexOf.get(right.edge.from) ?? 0),
  )
  const occupied: {
    left: Array<{ lane: number; start: number; end: number }>
    right: Array<{ lane: number; start: number; end: number }>
  } = { left: [], right: [] }
  const laneOf = new Map<string, number>()
  for (const item of laneEdges) {
    const list = occupied[item.side]
    let lane = 1
    while (
      list.some((other) => other.lane === lane && other.start < item.end && item.start < other.end)
    ) {
      lane += 1
    }
    list.push({ lane, start: item.start, end: item.end })
    laneOf.set(item.edge.key, lane)
  }
  const maxLeft = occupied.left.reduce((max, item) => Math.max(max, item.lane), 0)
  const maxRight = occupied.right.reduce((max, item) => Math.max(max, item.lane), 0)

  const leftLaneX = (lane: number): number => contentMinX - SIDE_PAD - (lane - 1) * LANE_GAP
  const rightLaneX = (lane: number): number => contentMaxX + SIDE_PAD + (lane - 1) * LANE_GAP
  const leftEdge = contentMinX - SIDE_PAD - Math.max(0, maxLeft - 1) * LANE_GAP - SIDE_PAD
  const rightEdge = contentMaxX + SIDE_PAD + Math.max(0, maxRight - 1) * LANE_GAP + SIDE_PAD
  const shiftX = -leftEdge
  const width = rightEdge - leftEdge
  const maxLayer = layerIndexes[layerIndexes.length - 1] ?? 0
  const height = maxLayer * LAYER_PITCH + NODE_HEIGHT + 2 * SIDE_PAD

  const positions: LayoutPoint[] = nodes.map((node) => {
    const layer = layerOf.get(node.id) ?? 0
    return {
      id: node.id,
      layer,
      x: round((xOf.get(node.id) ?? 0) + shiftX),
      y: round(yOf.get(layer) ?? SIDE_PAD + NODE_HEIGHT / 2),
    }
  })
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const layers = layerIndexes.map((index) => ({ index, y: round(yOf.get(index) ?? 0) }))

  const edges: LayoutEdge[] = allEdges.map((edge) => {
    const from = positionById.get(edge.from)
    const to = positionById.get(edge.to)
    if (from === undefined || to === undefined) {
      return { ...edge, lane: 0, side: 'center', d: '', arrow: null }
    }
    const side = sideOf.get(edge.key) ?? 'center'
    const lane = laneOf.get(edge.key) ?? 0
    let laneX = 0
    if (side === 'left') laneX = round(leftLaneX(lane) + shiftX)
    else if (side === 'right') laneX = round(rightLaneX(lane) + shiftX)
    return { ...edge, lane, side, ...edgeGeometry(from, to, side, laneX) }
  })

  return {
    width: round(width),
    height: round(height),
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    layerGap: LAYER_GAP,
    layers,
    positions,
    edges,
  }
}

/**
 * 一条边的路径与方向箭头位置。
 *
 * - 相邻层：同一横坐标直连；不同横坐标用贝塞尔曲线，从源节点底部进入目标顶部。
 * - 侧边 lane：从端口出发先圆角拐到 lane，再竖直到目标附近拐入端口；箭头在竖段中点。
 * - 自环：从节点顶部绕同侧 lane 回到节点底部。
 * - 同层非自环：从上方绕过整行。箭头方向由路径方向决定。
 *
 * @param from 来源节点坐标
 * @param to 目标节点坐标
 * @param side 走线位置
 * @param laneX lane 的横坐标
 * @returns SVG 路径与箭头位置
 */
function edgeGeometry(
  from: LayoutPoint,
  to: LayoutPoint,
  side: 'center' | 'left' | 'right',
  laneX: number,
): { d: string; arrow: { x: number; y: number; angle: number } | null } {
  const half = NODE_HEIGHT / 2
  if (side === 'center') {
    const start = { x: from.x, y: from.y + half }
    const end = { x: to.x, y: to.y - half }
    if (start.x === end.x) {
      return {
        d: `M${round(start.x)},${round(start.y)} L${round(end.x)},${round(end.y)}`,
        arrow: { x: round(start.x), y: round((start.y + end.y) / 2), angle: 90 },
      }
    }
    const middleY = (start.y + end.y) / 2
    return {
      d:
        `M${round(start.x)},${round(start.y)} ` +
        `C${round(start.x)},${round(middleY)} ${round(end.x)},${round(middleY)} ${round(end.x)},${round(end.y)}`,
      arrow: {
        x: round(end.x),
        y: round(end.y - Math.min(12, (end.y - start.y) / 2)),
        angle: 90,
      },
    }
  }

  const x = round(laneX)
  if (from.id === to.id) {
    const top = { x: from.x, y: from.y - half }
    const bottom = { x: from.x, y: from.y + half }
    return {
      d:
        `M${round(top.x)},${round(top.y)} ` +
        `C${x},${round(top.y - 18)} ${x},${round(bottom.y + 18)} ${round(bottom.x)},${round(bottom.y)}`,
      arrow: { x, y: round(from.y), angle: 90 },
    }
  }

  if (to.layer === from.layer) {
    const above = round(from.y - half - 20)
    const start = { x: from.x, y: from.y - half }
    const end = { x: to.x, y: to.y - half }
    return {
      d:
        `M${round(start.x)},${round(start.y)} ` +
        `C${round(start.x)},${above} ${x},${above} ${x},${above} ` +
        `L${round(end.x)},${above} ` +
        `C${round(end.x)},${above} ${round(end.x)},${round(end.y)} ${round(end.x)},${round(end.y)}`,
      arrow: { x: round((start.x + end.x) / 2), y: above, angle: end.x > start.x ? 0 : 180 },
    }
  }

  const down = to.layer > from.layer
  if (down) {
    const start = { x: from.x, y: from.y + half }
    const end = { x: to.x, y: to.y - half }
    return {
      d:
        `M${round(start.x)},${round(start.y)} ` +
        `C${round(start.x)},${round(start.y + CORNER)} ${x},${round(start.y + CORNER)} ${x},${round(start.y + CORNER * 2)} ` +
        `L${x},${round(end.y - CORNER * 2)} ` +
        `C${x},${round(end.y - CORNER)} ${round(end.x)},${round(end.y - CORNER)} ${round(end.x)},${round(end.y)}`,
      arrow: { x, y: round((start.y + end.y) / 2), angle: 90 },
    }
  }

  const start = { x: from.x, y: from.y - half }
  const end = { x: to.x, y: to.y + half }
  return {
    d:
      `M${round(start.x)},${round(start.y)} ` +
      `C${round(start.x)},${round(start.y - CORNER)} ${x},${round(start.y - CORNER)} ${x},${round(start.y - CORNER * 2)} ` +
      `L${x},${round(end.y + CORNER * 2)} ` +
      `C${x},${round(end.y + CORNER)} ${round(end.x)},${round(end.y + CORNER)} ${round(end.x)},${round(end.y)}`,
    arrow: { x, y: round((start.y + end.y) / 2), angle: -90 },
  }
}

/**
 * 把一份抽象工作流模板画成图模型（不含坐标）。
 *
 * 模板不是运行：没有 steps / current / pendingUser，所以复用 `buildRunGraph` 的
 * 拓扑排序、成环合并与边合并，用一个「空运行」喂进去。得到节点后统一改成
 * `idle` 状态（start 也不再标成 completed），让图读作「静态参考结构」而不是
 * 「执行进度」。调用方再把结果交给 `layoutRunGraph` 计算分层坐标与 SVG 路径。
 *
 * @param template 模板对象（含 `id` 与 `nodes`）
 * @returns 图模型；模板没有节点时是 `null`
 */
export function buildTemplateGraph(template: unknown): RunGraph | null {
  const nodes =
    isPlainObject(template) && Array.isArray(template.nodes) ? (template.nodes as unknown[]) : []
  if (nodes.length === 0) return null
  const model = buildRunGraph({
    run: {
      runId: `template:${isPlainObject(template) && typeof template.id === 'string' ? template.id : ''}`,
    },
    definition: { definition: { nodes } },
    avatars: null,
  })
  if (model === null) return null
  model.nodes = model.nodes.map((node) => ({
    ...node,
    state: 'idle',
    visits: 0,
    unreachable: false,
  }))
  return model
}
