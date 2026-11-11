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
 * 行序按拓扑排序：成环的节点缩成一组（组内保持定义顺序），组之间的 DAG 再排序。
 * 于是所有「不成环」的连线都从上往下走，没走到的节点也留在它该在的层级、不会被
 * 排到结束节点后面；只有环内的返回边向上。
 * 布局是自上而下的分层图：相邻的向下边走主干，其余边走右侧的竖线 lane（两端圆角
 * 转弯）。lane 按「内层靠里、外层被挤到外面」分配，嵌套的区间自然分层。行高固定，
 * 页面按行渲染胶囊，SVG 只画轨道、连线与方向箭头。
 *
 * @module @buka/dsh-plugin-workflows/graph
 */

import { isPlainObject } from './definition.js'

/** 一行占用的高度（px）。 */
export const ROW_HEIGHT = 56

/** 行与行之间的垂直间距（px）。 */
export const ROW_GAP = 12

/** 主干在轨道里的 x 坐标。 */
export const RAIL_BASE = 14

/** 每条绕行 lane 的水平间距（px）；内层边靠近轨道，外层边依次往外。 */
export const LANE_GAP = 14

/** 轨道右侧到胶囊列的留白。 */
export const RAIL_PAD = 14

/** 终止节点允许的最终状态。 */
const END_STATUSES = new Set(['completed', 'failed', 'rejected'])

/** 卡片上最终文本 / 任务预览的最大字符数。 */
const PREVIEW_LIMIT = 160

/**
 * 把多行文本压成一行预览。
 *
 * @param {unknown} value
 * @param {number} limit
 * @returns {string}
 */
function previewLine(value, limit) {
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
 * @param {unknown} definition
 * @returns {{ start: string | null, nodes: Array<Record<string, any>> } | null}
 */
function readDefinitionNodes(definition) {
  if (!isPlainObject(definition)) return null
  const plan = isPlainObject(definition.plan) ? definition.plan : null
  if (plan !== null && isPlainObject(plan.nodes)) {
    const ids = Array.isArray(plan.order)
      ? plan.order.filter((id) => typeof id === 'string' && isPlainObject(plan.nodes[id]))
      : Object.keys(plan.nodes)
    const nodes = []
    const seen = new Set()
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      nodes.push(normalizeNode(id, plan.nodes[id]))
    }
    if (nodes.length > 0) {
      const start = typeof plan.start === 'string' && plan.start !== '' ? plan.start : nodes[0].id
      return { start, nodes }
    }
  }
  const raw = isPlainObject(definition.definition) ? definition.definition : null
  if (raw === null || !Array.isArray(raw.nodes)) return null
  const nodes = []
  const seen = new Set()
  for (const item of raw.nodes) {
    if (!isPlainObject(item)) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    nodes.push(normalizeNode(id, item))
  }
  if (nodes.length === 0) return null
  const startNode = nodes.find((node) => node.type === 'start')
  const start =
    typeof raw.start === 'string' && raw.start !== '' ? raw.start : (startNode?.id ?? nodes[0].id)
  return { start, nodes }
}

/**
 * 规范化一个节点，只保留展示与路由需要的信息（不含 prompt 正文）。
 *
 * @param {string} id
 * @param {Record<string, any>} raw
 * @returns {Record<string, any>}
 */
function normalizeNode(id, raw) {
  const type = NODE_TYPES.has(raw?.type) ? raw.type : 'robot'
  /** @type {Record<string, any>} */
  const node = { id, type }
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
    if (Number.isFinite(raw.timeoutMs)) node.timeoutMs = raw.timeoutMs
    if (Number.isFinite(raw.maxVisits)) node.maxVisits = raw.maxVisits
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
  node.endStatus = END_STATUSES.has(raw.status) ? raw.status : 'completed'
  return node
}

/**
 * 规范化节点的 `next`：边对象数组（新格式）或字符串 / 字符串数组（旧记录）。
 *
 * 图模型保留给观测者看的 `name`、用户选项的 `label`、边的 `prompt` 与外观色
 * `tone`；路由条件不在这里解析。`tone` 只有 `success` / `failure` 会被保留，
 * 旧记录 / 手工改动里的其它值归一成空串（不画颜色）。
 *
 * @param {unknown} raw
 * @returns {Array<{ to: string, name: string, label: string, prompt: string, tone: string }>}
 */
function normalizeNext(raw) {
  if (typeof raw === 'string' && raw.trim() !== '') {
    return [{ to: raw.trim(), name: '', label: '', prompt: '', tone: '' }]
  }
  if (!Array.isArray(raw)) return []
  /** @type {Array<{ to: string, name: string, label: string, prompt: string, tone: string }>} */
  const rules = []
  for (const rule of raw) {
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
 * @param {{ run?: unknown, definition?: unknown, avatars?: unknown }} input
 *   `avatars` 是「机器人名 → 头像 id」表（由 robots 服务提供）；有值的 robot 节点
 *   会带上 `avatar`，没有这一项（robots 插件没装 / 机器人已删除）时是 null。
 * @returns {{
 *   start: string | null,
 *   order: string[],
 *   nodes: Array<Record<string, any>>,
 *   edges: Array<Record<string, any>>,
 * } | null}
 */
export function buildRunGraph(input) {
  if (!isPlainObject(input)) return null
  const run = isPlainObject(input.run) ? input.run : null
  if (run === null || typeof run.runId !== 'string') return null
  const avatars = isPlainObject(input.avatars) ? input.avatars : null
  const steps = Array.isArray(run.steps) ? run.steps.filter(isPlainObject) : []

  const source = readDefinitionNodes(input.definition)
  /** @type {Map<string, Record<string, any>>} */
  const configs = new Map()
  /** @type {string[]} */
  const order = []
  let start = null
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

  /** @type {Map<string, Array<Record<string, any>>>} */
  const stepsByNode = new Map()
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
  const current = actives[0] ?? null
  const pendingUser = isPlainObject(run.pendingUser) ? run.pendingUser : null

  // 「任务 → 引用它的 join」反向索引（join.inputs 表达的是入边）。
  /** @type {Map<string, string[]>} */
  const inputJoins = new Map()
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
   * @param {Record<string, any>} config
   * @returns {string[]}
   */
  function targetsOf(config) {
    if (config.type === 'start' || config.type === 'robot' || config.type === 'user' || config.type === 'join') {
      const targets = (config.next ?? []).map((rule) => rule.to)
      if (config.type === 'robot') targets.push(...(inputJoins.get(config.id) ?? []))
      return targets
    }
    return []
  }

  /** @type {Map<string, string[]>} */
  const adjacency = new Map(order.map((id) => [id, []]))
  for (const id of order) {
    const config = configs.get(id)
    if (config === undefined) continue
    adjacency.set(
      id,
      targetsOf(config).filter((target) => configs.has(target)),
    )
  }
  /** @type {Map<string, Set<string>>} */
  const reachable = new Map()
  for (const id of order) {
    /** @type {Set<string>} */
    const seen = new Set()
    /** @type {string[]} */
    const queue = [...(adjacency.get(id) ?? [])]
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
  /** @type {Map<string, number>} */
  const componentOf = new Map()
  /** @type {string[][]} */
  const components = []
  for (const id of order) {
    if (componentOf.has(id)) continue
    const members = order.filter(
      (other) =>
        !componentOf.has(other) &&
        (other === id || (reachable.get(id)?.has(other) === true && reachable.get(other)?.has(id) === true)),
    )
    const index = components.length
    for (const member of members) componentOf.set(member, index)
    components.push(members)
  }

  /** @type {Array<Set<number>>} */
  const componentEdges = components.map(() => new Set())
  const indegree = components.map(() => 0)
  for (const id of order) {
    const from = componentOf.get(id)
    for (const target of adjacency.get(id) ?? []) {
      const to = componentOf.get(target)
      if (to === undefined || to === from) continue
      if (componentEdges[from].has(to)) continue
      componentEdges[from].add(to)
      indegree[to] += 1
    }
  }
  const priority = components.map((members) =>
    members.reduce((min, member) => Math.min(min, orderIndex.get(member) ?? Infinity), Infinity),
  )
  const startComponent = start === null ? undefined : componentOf.get(start)
  if (startComponent !== undefined) priority[startComponent] = -1
  /** @type {number[]} */
  const ready = []
  for (let index = 0; index < components.length; index += 1) if (indegree[index] === 0) ready.push(index)
  ready.sort((left, right) => priority[left] - priority[right])
  /** @type {string[]} */
  const layoutOrder = []
  while (ready.length > 0) {
    const index = ready.shift()
    const members = [...components[index]].sort(
      (left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0),
    )
    layoutOrder.push(...members)
    for (const next of componentEdges[index]) {
      indegree[next] -= 1
      if (indegree[next] !== 0) continue
      ready.push(next)
      ready.sort((left, right) => priority[left] - priority[right])
    }
  }
  // DAG 一定全部入列；这里的兜底只防实现意外留下未排序的节点。
  for (const id of order) if (!layoutOrder.includes(id)) layoutOrder.push(id)

  /**
   * 一个节点在这次运行中的状态。
   *
   * @param {Record<string, any>} config
   * @returns {string}
   */
  function stateOf(config) {
    // start 节点本身不执行；从它出发就说明这次运行已经开始了。
    if (config.type === 'start') return 'completed'
    if (config.type === 'join' && config.next?.length === 0) return 'idle'
    if (pendingUser !== null && pendingUser.nodeId === config.id) return 'waiting'
    if (actives.some((active) => active.nodeId === config.id)) return 'running'
    const nodeSteps = stepsByNode.get(config.id) ?? []
    if (nodeSteps.length > 0) {
      const status = nodeSteps[nodeSteps.length - 1].status
      return typeof status === 'string' && status !== '' ? status : 'completed'
    }
    if (config.type === 'end' && lastNode === config.id) {
      const status = typeof result?.status === 'string' ? result.status : 'completed'
      return status
    }
    return 'idle'
  }

  const nodes = layoutOrder.map((id) => {
    const config = configs.get(id)
    const nodeSteps = stepsByNode.get(id) ?? []
    const lastStep = nodeSteps.length > 0 ? nodeSteps[nodeSteps.length - 1] : null
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
      sessionId: typeof lastStep?.sessionId === 'string' && lastStep.sessionId !== '' ? lastStep.sessionId : null,
      error: typeof lastStep?.error === 'string' && lastStep.error !== '' ? lastStep.error : null,
      task: config.type === 'robot' ? config.task ?? '' : '',
      summary: config.type === 'robot' ? config.summary ?? '' : null,
      outputText: previewLine(lastStep?.text, PREVIEW_LIMIT),
      robot: config.type === 'robot' ? config.robot : null,
      // 节点图上的机器人头像：只认字符串值，查不到就是 null（不画头像）。
      avatar:
        config.type === 'robot' &&
        avatars !== null &&
        typeof config.robot === 'string' &&
        typeof avatars[config.robot] === 'string'
          ? avatars[config.robot]
          : null,
      title: config.type === 'user' ? config.title : null,
      detail: config.type === 'user' ? config.detail : null,
      questions: config.type === 'user' ? config.questions ?? [] : null,
      endStatus: config.type === 'end' ? config.endStatus : null,
      timeoutMs: config.type === 'robot' && Number.isFinite(config.timeoutMs) ? config.timeoutMs : null,
      maxVisits: config.type === 'robot' && Number.isFinite(config.maxVisits) ? config.maxVisits : null,
      mode: config.type === 'robot' && config.mode === 'plan' ? 'plan' : null,
      inputs: config.type === 'join' ? config.inputs ?? [] : null,
      next: config.type === 'robot' || config.type === 'start' || config.type === 'user' || config.type === 'join'
        ? config.next
        : [],
    }
  })

  /** 这次运行实际走过的节点顺序（含正在执行的节点）。 */
  /** @type {string[]} */
  const sequence = []
  const pushSequence = (id) => {
    if (typeof id !== 'string' || id === '') return
    if (sequence[sequence.length - 1] === id) return
    sequence.push(id)
  }
  for (const step of steps) pushSequence(step.nodeId)
  for (const active of actives) pushSequence(active.nodeId)
  if (pendingUser !== null) pushSequence(pendingUser.nodeId)
  /** 每对相邻节点在这次运行里走了几次；循环会让同一对出现多次。 */
  /** @type {Map<string, number>} */
  const pairCounts = new Map()
  /**
   * @param {string} from
   * @param {string} to
   */
  function countPair(from, to) {
    const key = `${from}->${to}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  for (let index = 0; index + 1 < sequence.length; index += 1) {
    countPair(sequence[index], sequence[index + 1])
  }
  // start 节点没有 step；只要运行已经进入第一个真实节点，就视为走过了 start 边。
  if (configs.get(start)?.type === 'start' && sequence.length > 0 && sequence[0] !== start) {
    countPair(start, sequence[0])
  }
  const last = sequence.length > 0 ? sequence[sequence.length - 1] : null
  if (last !== null && lastNode !== null && lastNode !== last) countPair(last, lastNode)

  // 一条边是不是循环边由拓扑决定（目标节点能不能再走回来），和行序无关。
  /**
   * @param {string} from
   * @param {string} to
   * @returns {boolean}
   */
  function inCycle(from, to) {
    if (from === to) return true
    return reachable.get(to)?.has(from) === true
  }

  // 同一个「来源 → 目标」只画一条线：多条边指向同一目标时合并成一条，名字按
  // 定义顺序并列，避免图上出现平行的重复连线。
  /** @type {Map<string, Record<string, any>>} */
  const edgesByKey = new Map()
  /**
   * @param {string} from
   * @param {string} to
   * @param {'next'} kind
   * @param {string} [name] 边上写的路由键
   * @param {string} [prompt] 进入目标节点时要发的提示词（只作诊断，不渲染）
   * @param {string} [label] 用户节点选项显示给用户的文字
   * @param {string} [tone] 边上可选的外观色：`success` / `failure`（只用于渲染）
   */
  function pushEdge(from, to, kind, name, prompt, label, tone) {
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
      if (config.type === 'robot' || config.type === 'start' || config.type === 'user' || config.type === 'join') {
        for (const rule of config.next) {
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
 * 计算纵向节点图（类似 git log）的行坐标与每条边的 SVG 路径。
 *
 * 相邻的向下边走主干；跨行分支、回边、自环走轨道右侧的 lane（竖线 + 圆角转弯）。
 * lane 从内往外分配：跨度小的边先分到靠里的 lane，包含它的边再被挤到更外面，于是
 * 嵌套的区间天然分层；共享同一 lane 的边在行区间上互不重叠，所以线之间不会交叉。
 * 方向箭头画在每条边竖段的中点；循环由回边与正向边围成的环表达。行高固定，页面按
 * 行渲染胶囊，SVG 只画轨道、连线、箭头与循环标记。
 *
 * @param {NonNullable<ReturnType<typeof buildRunGraph>>} graph
 * @returns {{
 *   width: number,
 *   height: number,
 *   rowHeight: number,
 *   rowGap: number,
 *   dotX: number,
 *   rows: Array<{ id: string, index: number, y: number }>,
 *   edges: Array<Record<string, any>>,
 * }}
 */
export function layoutRunGraph(graph) {
  const nodes = graph.nodes
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]))
  const rows = nodes.map((node, index) => ({
    id: node.id,
    index,
    y: index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2,
  }))
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const height = rows.length === 0 ? 0 : rows.length * ROW_HEIGHT + (rows.length - 1) * ROW_GAP

  // 先给跨度小的边分 lane：跨度大的边会包含它们，自然被挤到更外侧的 lane。
  const ordered = [...graph.edges].sort((left, right) => {
    const leftFrom = indexOf.get(left.from) ?? 0
    const leftTo = indexOf.get(left.to) ?? 0
    const rightFrom = indexOf.get(right.from) ?? 0
    const rightTo = indexOf.get(right.to) ?? 0
    const leftSpan = Math.abs(leftTo - leftFrom)
    const rightSpan = Math.abs(rightTo - rightFrom)
    if (leftSpan !== rightSpan) return leftSpan - rightSpan
    const leftStart = Math.min(leftFrom, leftTo)
    const rightStart = Math.min(rightFrom, rightTo)
    return leftStart - rightStart || leftFrom - rightFrom
  })

  /** @type {Map<string, number>} */
  const lanes = new Map()
  /** @type {Array<{ lane: number, start: number, end: number }>} */
  const occupied = []
  for (const edge of ordered) {
    const from = indexOf.get(edge.from)
    const to = indexOf.get(edge.to)
    if (from === undefined || to === undefined) {
      lanes.set(edge.key, 0)
      continue
    }
    const span = Math.abs(to - from)
    if (span === 1 && to > from) {
      lanes.set(edge.key, 0)
      continue
    }
    // 自环的占位区间必须非空，否则两条自环会分到同一条 lane。
    const start = Math.min(from, to)
    const end = span === 0 ? start + 1 : Math.max(from, to)
    let lane = 1
    while (occupied.some((item) => item.lane === lane && item.start < end && start < item.end)) lane += 1
    occupied.push({ lane, start, end })
    lanes.set(edge.key, lane)
  }

  let maxLane = 0
  for (const lane of lanes.values()) maxLane = Math.max(maxLane, lane)

  const edges = graph.edges.map((edge) => {
    const lane = lanes.get(edge.key) ?? 0
    const from = rowById.get(edge.from)
    const to = rowById.get(edge.to)
    if (from === undefined || to === undefined) return { ...edge, lane, d: '', arrow: null }
    return { ...edge, lane, ...edgeGeometry(from, to, lane) }
  })

  return {
    width: RAIL_BASE + maxLane * LANE_GAP + RAIL_PAD,
    height,
    rowHeight: ROW_HEIGHT,
    rowGap: ROW_GAP,
    dotX: RAIL_BASE,
    rows,
    edges,
  }
}

/**
 * 一条边的路径与方向箭头位置。
 *
 * 跨行边是「竖直 lane + 两端圆角」的折线：从来源圆点向右拐入自己的 lane，竖直
 * 走一段，再拐回目标圆点。箭头在竖段中点，方向由箭头本身说明；循环由回边与
 * 正向边围成的环表达，不再额外画标记。
 *
 * @param {{ index: number, y: number }} from
 * @param {{ index: number, y: number }} to
 * @param {number} lane
 * @returns {{ d: string, arrow: { x: number, y: number, angle: number } | null }}
 */
function edgeGeometry(from, to, lane) {
  const x0 = RAIL_BASE
  const down = to.y > from.y
  if (lane === 0) {
    // 相邻行：主干直连，箭头在中间。
    return {
      d: `M${x0},${from.y} L${x0},${to.y}`,
      arrow: { x: x0, y: (from.y + to.y) / 2, angle: down ? 90 : -90 },
    }
  }
  const x = x0 + lane * LANE_GAP
  const midY = (from.y + to.y) / 2
  if (from.index === to.index) {
    // 自环：在节点右侧绕一个小圈。
    return {
      d: `M${x0},${from.y - 7} C${x},${from.y - 16} ${x},${from.y + 16} ${x0},${from.y + 7}`,
      arrow: { x, y: from.y, angle: 90 },
    }
  }
  if (down) {
    return {
      d:
        `M${x0},${from.y} C${x0},${from.y + 6} ${x},${from.y + 6} ${x},${from.y + 12} ` +
        `L${x},${to.y - 12} C${x},${to.y - 6} ${x0},${to.y - 6} ${x0},${to.y}`,
      arrow: { x, y: midY, angle: 90 },
    }
  }
  return {
    d:
      `M${x0},${from.y} C${x0},${from.y - 6} ${x},${from.y - 6} ${x},${from.y - 12} ` +
      `L${x},${to.y + 12} C${x},${to.y + 6} ${x0},${to.y + 6} ${x0},${to.y}`,
    arrow: { x, y: midY, angle: -90 },
  }
}

/**
 * 把一份抽象工作流模板画成图模型（不含坐标）。
 *
 * 模板不是运行：没有 steps / current / pendingUser，所以复用 `buildRunGraph` 的
 * 拓扑排序、成环合并与边合并，用一个「空运行」喂进去。得到节点后统一改成
 * `idle` 状态（start 也不再标成 completed），让图读作「静态参考结构」而不是
 * 「执行进度」。调用方再把结果交给 `layoutRunGraph` 计算行坐标与 SVG 路径。
 *
 * @param {Record<string, any>} template 模板对象（含 `id` 与 `nodes`）
 * @returns {ReturnType<typeof buildRunGraph>}
 */
export function buildTemplateGraph(template) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : []
  if (nodes.length === 0) return null
  const model = buildRunGraph({
    run: { runId: `template:${typeof template?.id === 'string' ? template.id : ''}` },
    definition: { definition: { nodes } },
    avatars: null,
  })
  if (model === null) return null
  model.nodes = model.nodes.map((node) => ({ ...node, state: 'idle', visits: 0, unreachable: false }))
  return model
}
