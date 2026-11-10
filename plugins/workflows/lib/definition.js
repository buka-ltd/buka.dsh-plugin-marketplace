/**
 * 一次性工作流定义的校验与规范化（workflow format 2）。
 *
 * 工作流由 agent 在运行时现场生成：一份 JSON，包含目标、起始节点与节点表。
 * 本模块只做纯校验（不读盘、不依赖 DSH），返回可直接执行的 plan，以及给
 * 模型看的错误列表。节点分四类：
 *
 * - `start`：唯一的开始节点，不建会话、不执行；它只有一条出边，出边上的
 *   `prompt` 就是真正的第一个机器人节点首次进入时的提示词；
 * - `robot`：交给某个机器人执行；同一个机器人一次运行共用一个可续接的会话，
 *   节点只带一句给运行页展示的 `summary` 与必填的 `output`（节点结果 JSON 的
 *   schema），不带提示词——每次进入它的边各自定义 prompt。机器人节点总是交回
 *   一个 JSON 对象，其中的 `next` 是出边 `name`（路由键）；
 * - `gate`：不建会话，等待用户做一次原生审批，批准 / 拒绝各走一条出边；
 * - `end`：终止节点，带最终状态（completed / rejected / failed）。
 *
 * 路由只有一种：机器人结果里的 `next` 必须精确匹配某一条出边的 `name`。
 * 这里不做任何表达式求值，避免让模型生成可执行代码。
 *
 * `next` 里的每条规则就是一条「边」：`to` 是目标，`name` 是路由键（离开机器人
 * 节点时必须唯一且非空，也是运行页悬停看到的短名字），`prompt` 是进入目标
 * 机器人节点时使用的提示词。**每个进入机器人节点的边都必须有 `prompt`**，
 * 所以同一个节点首次进入和被循环打回时可以用两条不同的边给出完全不同的
 * 指令。门禁的两条出边也支持同样的 `{ to, name, prompt }` 对象。
 *
 * 旧格式（顶层 `start`、节点 prompt、`report`、`when` 条件）在 format 2 里
 * 全部移除：出现即报错，不做兼容。
 *
 * robot 节点必须声明 `output`：节点结果 JSON 的 JSON Schema（子集校验见
 * `output.js`）。定义校验还会检查每条边 prompt 里的模板占位符：引用的节点必须
 * 存在，`{{nodes.<id>.data.<path>}}` 的路径必须真的在目标节点的 `output` 里。
 *
 * @module @buka/dsh-plugin-workflows/definition
 */

import { parseOutputSchema, resolveOutputPath } from './output.js'
import { inspectTemplate } from './template.js'

/** 单份定义最多节点数。 */
export const MAX_NODES = 200

/** `maxSteps` 的绝对上限；再大也按这个值截断。 */
export const MAX_STEPS_CEILING = 256

/** 默认步数上限。 */
export const DEFAULT_MAX_STEPS = 64

/** 节点 id 的合法字符集。 */
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u

/** 机器名称的最大长度。 */
const MAX_ROBOT_NAME_LENGTH = 128

/** prompt 的字节上限。 */
export const MAX_PROMPT_BYTES = 256 * 1024

/** 步骤概要的最大字符数。 */
export const MAX_SUMMARY_LENGTH = 500

/** 边名字的最大字符数。 */
export const MAX_EDGE_NAME_LENGTH = 120

/** 终止节点允许的状态。 */
const END_STATUSES = new Set(['completed', 'failed', 'rejected'])

/** 节点类型。 */
const NODE_TYPES = new Set(['start', 'robot', 'gate', 'end'])

/** format 2 的移除提示：机器人节点不再有 `report`。 */
const REPORT_REMOVED = 'report was removed in workflow format 2; every robot node always returns JSON'

/** format 2 的移除提示：边不再有 `when`。 */
const WHEN_REMOVED = 'when was removed; select the next edge with the JSON "next" route'

/** 机器人节点 prompt 移除提示。 */
const NODE_PROMPT_REMOVED = 'robot nodes no longer carry a prompt; define it on the edge entering this node'

/**
 * 判断一个值是不是普通对象。
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验一份工作流定义。
 *
 * 返回 `{ ok, errors, warnings, plan }`：`ok` 为 true 时 `plan` 可执行；
 * 否则 `errors` 里是 `{ path, message }` 列表，`plan` 为 null。
 *
 * @param {unknown} input agent 传入的定义
 * @param {{ maxSteps?: number }} [options] 部署侧步数上限
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{ path: string, message: string }>,
 *   warnings: string[],
 *   plan: null | {
 *     goal: string,
 *     start: string,
 *     maxSteps: number,
 *     nodes: Record<string, object>,
 *     order: string[],
 *   },
 * }}
 */
export function validateDefinition(input, options = {}) {
  /** @type {Array<{ path: string, message: string }>} */
  const errors = []
  /** @type {string[]} */
  const warnings = []
  const fail = (path, message) => errors.push({ path, message })

  if (!isPlainObject(input)) {
    fail('definition', 'must be a JSON object')
    return { ok: false, errors, warnings, plan: null }
  }

  const ceiling = normalizeStepCeiling(options.maxSteps)
  const goal = readGoal(input.goal, fail)
  const maxSteps = readMaxSteps(input.maxSteps, ceiling, fail)
  const declaredStart = typeof input.start === 'string' ? input.start.trim() : ''
  if (declaredStart !== '') {
    fail('start', 'the legacy top-level "start" format was removed; add a node with type "start"')
  }

  /** @type {Map<string, object>} */
  const nodes = new Map()
  /** @type {string[]} */
  const order = []
  if (!Array.isArray(input.nodes)) {
    fail('nodes', 'must be a non-empty array of node objects')
  } else if (input.nodes.length === 0) {
    fail('nodes', 'must contain at least one node')
  } else if (input.nodes.length > MAX_NODES) {
    fail('nodes', `must contain at most ${MAX_NODES} nodes`)
  } else {
    input.nodes.forEach((raw, index) => {
      const node = parseNode(raw, `nodes[${index}]`, fail)
      if (node === null) return
      if (nodes.has(node.id)) {
        fail(`nodes[${index}].id`, `duplicate node id "${node.id}"`)
        return
      }
      nodes.set(node.id, node)
      order.push(node.id)
    })
  }

  // format 2：恰好一个 start 节点；所有 prompt 都在边上。
  const startIds = order.filter((id) => nodes.get(id).type === 'start')
  /** @type {string} */
  let start = ''
  if (startIds.length === 0) {
    if (declaredStart === '') fail('start', 'a workflow definition needs exactly one node with type "start"')
  } else {
    if (startIds.length > 1) {
      for (const id of startIds.slice(1)) {
        fail(`nodes[${order.indexOf(id)}]`, 'the definition may contain exactly one start node')
      }
    }
    start = startIds[0]
    const startIndex = order.indexOf(start)
    const startNode = nodes.get(start)
    if (startNode !== undefined) {
      if (!Array.isArray(startNode.next) || startNode.next.length !== 1) {
        fail(`nodes[${startIndex}].next`, 'a start node needs exactly one outgoing edge')
      } else {
        const rule = startNode.next[0]
        const target = nodes.get(rule.to)
        if (target !== undefined && target.type !== 'robot') {
          fail(`nodes[${startIndex}].next[0].to`, 'the start edge must enter a robot node')
        }
        if (typeof rule.prompt !== 'string' || rule.prompt.trim() === '') {
          fail(`nodes[${startIndex}].next[0].prompt`, 'the start edge must carry the first robot prompt')
        }
      }
    }
  }

  // 所有出边必须在节点表里存在；同一份定义里允许环，由 maxSteps / maxVisits 兜底。
  // 每个进入机器人节点的边都必须带 prompt；进入 gate / end 的边不能带 prompt。
  /** @type {Array<{ edge: Record<string, any>, path: string }>} */
  const edges = []
  for (const [index, id] of order.entries()) {
    const node = nodes.get(id)
    for (const [ruleIndex, rule] of (node.next ?? []).entries()) {
      edges.push({ edge: rule, path: `nodes[${index}].next[${ruleIndex}]` })
    }
    for (const key of ['onApprove', 'onReject']) {
      const edge = node[key]
      if (edge !== null && typeof edge === 'object') {
        edges.push({ edge, path: `nodes[${index}].${key}` })
      }
    }
  }
  for (const { edge, path } of edges) {
    const target = nodes.get(edge.to)
    if (target === undefined) {
      fail(path, `transition to unknown node "${edge.to}"`)
      continue
    }
    if (target.type === 'start') {
      fail(path, 'an edge cannot point at the start node')
      continue
    }
    if (target.type === 'robot') {
      if (typeof edge.prompt !== 'string' || edge.prompt.trim() === '') {
        fail(`${path}.prompt`, 'an edge entering a robot node must carry its prompt')
      }
    } else if (typeof edge.prompt === 'string' && edge.prompt !== '') {
      fail(`${path}.prompt`, 'an edge prompt is only supported when the edge enters a robot node')
    }
  }

  if (errors.length === 0) {
    // 从 start 走不到的节点永远不会执行；它没有入边，画到图上还会被当成第二个
    // 起点，所以这里直接报错，而不是留一条 warning 让运行图出现歧义。
    const reachable = reachableNodes(nodes, start)
    for (const [index, id] of order.entries()) {
      if (reachable.has(id)) continue
      fail(`nodes[${index}]`, `node "${id}" is not reachable from start, so it would never run`)
    }
    // 结构没问题后再检查 prompt 里的变量：引用的节点必须存在，data 路径必须在
    // 目标节点声明的 output 里。这样定义写错时在计划阶段就能定位到边。
    if (errors.length === 0) validatePromptReferences(nodes, edges, fail)
    const hasRobot = order.some((id) => nodes.get(id).type === 'robot')
    if (errors.length === 0 && !hasRobot) {
      warnings.push('the workflow has no robot node, so nothing will be delegated')
    }
  }

  if (errors.length === 0) {
    // 成环的机器人节点如果没有 maxVisits，只能靠 maxSteps 兜底；提醒创建者补上
    // 访问次数上限，避免「一直不离开环」的循环跑到步数上限才停。
    const cyclic = cyclicNodes(nodes, order)
    for (const id of order) {
      const node = nodes.get(id)
      if (node.type !== 'robot') continue
      if (node.maxVisits !== undefined) continue
      if (!cyclic.has(id)) continue
      warnings.push(
        `node "${id}" is part of a cycle and does not set maxVisits; the run is only bounded by maxSteps (${maxSteps}). Add maxVisits to stop a no-progress loop.`,
      )
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings, plan: null }

  return {
    ok: true,
    errors,
    warnings,
    plan: {
      goal,
      start,
      maxSteps,
      nodes: Object.fromEntries(nodes),
      order,
    },
  }
}

/**
 * 转成给模型看的一份摘要（不包含 prompt 正文）。
 *
 * 机器人节点额外带 `routes`：离开它的每条边的 `name`，也就是机器人结果里的
 * `next` 可以取的值。
 *
 * @param {NonNullable<ReturnType<typeof validateDefinition>['plan']>} plan
 * @returns {{
 *   start: string,
 *   maxSteps: number,
 *   goal: string,
 *   nodes: Array<Record<string, unknown>>,
 * }}
 */
export function describePlan(plan) {
  return {
    start: plan.start,
    maxSteps: plan.maxSteps,
    goal: plan.goal,
    nodes: plan.order.map((id) => {
      const node = plan.nodes[id]
      const summary = { id, type: node.type }
      if (node.robot !== undefined) summary.robot = node.robot
      if (node.type === 'end') summary.status = node.status
      if (node.type === 'robot') {
        summary.routes = (Array.isArray(node.next) ? node.next : [])
          .map((rule) => rule.name)
          .filter((name) => typeof name === 'string' && name !== '')
      }
      return summary
    }),
  }
}

/**
 * 收集一个节点的所有出边目标。
 *
 * @param {Record<string, any>} node
 * @returns {string[]}
 */
export function targetsOf(node) {
  const targets = []
  if (Array.isArray(node.next)) {
    for (const rule of node.next) {
      if (typeof rule?.to === 'string' && rule.to !== '') targets.push(rule.to)
    }
  }
  for (const key of ['onApprove', 'onReject']) {
    const edge = node[key]
    if (typeof edge === 'string' && edge !== '') targets.push(edge)
    else if (edge !== null && typeof edge === 'object' && typeof edge.to === 'string' && edge.to !== '') {
      targets.push(edge.to)
    }
  }
  return targets
}

/**
 * 从 start 出发按出边做一次 BFS。
 *
 * @param {Map<string, Record<string, any>>} nodes
 * @param {string} start
 * @returns {Set<string>}
 */
function reachableNodes(nodes, start) {
  const seen = new Set()
  const queue = [start]
  while (queue.length > 0) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodes.get(id)
    if (node === undefined) continue
    queue.push(...targetsOf(node))
  }
  return seen
}

/**
 * 找出所有「在环上」的节点（从自己出发沿出边可以走回自己）。
 *
 * @param {Map<string, Record<string, any>>} nodes
 * @param {string[]} order
 * @returns {Set<string>}
 */
function cyclicNodes(nodes, order) {
  const cyclic = new Set()
  for (const id of order) {
    const node = nodes.get(id)
    if (node === undefined) continue
    const queue = [...targetsOf(node)]
    const seen = new Set()
    while (queue.length > 0) {
      const next = queue.shift()
      if (next === id) {
        cyclic.add(id)
        break
      }
      if (seen.has(next)) continue
      seen.add(next)
      const target = nodes.get(next)
      if (target !== undefined) queue.push(...targetsOf(target))
    }
  }
  return cyclic
}

/**
 * 读取 goal：可选，默认空串。
 *
 * @param {unknown} value
 * @param {(path: string, message: string) => void} fail
 * @returns {string}
 */
function readGoal(value, fail) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    fail('goal', 'must be a string')
    return ''
  }
  const goal = value.trim()
  if (goal.length > 4000) fail('goal', 'must be at most 4000 characters')
  return goal
}

/**
 * 读取并裁剪 maxSteps。
 *
 * @param {unknown} value
 * @param {number} ceiling
 * @param {(path: string, message: string) => void} fail
 * @returns {number}
 */
function readMaxSteps(value, ceiling, fail) {
  if (value === undefined || value === null) return ceiling
  if (!Number.isInteger(value) || value < 1) {
    fail('maxSteps', 'must be a positive integer')
    return ceiling
  }
  if (value > ceiling) fail('maxSteps', `must be at most ${ceiling}`)
  return Math.min(value, ceiling)
}

/**
 * 部署侧上限的规范化。
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeStepCeiling(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_MAX_STEPS
  return Math.min(value, MAX_STEPS_CEILING)
}

/**
 * 解析一个节点；无法构成节点时返回 null（错误已记录）。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any> | null}
 */
function parseNode(raw, path, fail) {
  if (!isPlainObject(raw)) {
    fail(path, 'must be an object')
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!NODE_ID_PATTERN.test(id)) {
    fail(`${path}.id`, 'must be 1-64 letters, digits, ".", "_" or "-", starting with a letter or digit')
  }
  const type = typeof raw.type === 'string' ? raw.type.trim() : ''
  if (!NODE_TYPES.has(type)) {
    fail(`${path}.type`, 'must be "start", "robot", "gate" or "end"')
    return null
  }
  if (!NODE_ID_PATTERN.test(id)) return null

  if (type === 'start') return parseStartNode(raw, id, path, fail)
  if (type === 'robot') return parseRobotNode(raw, id, path, fail)
  if (type === 'gate') return parseGateNode(raw, id, path, fail)
  return parseEndNode(raw, id, path, fail)
}

/**
 * @param {Record<string, any>} raw
 * @param {string} id
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any>}
 */
function parseStartNode(raw, id, path, fail) {
  const node = { id, type: 'start' }
  rejectOutputOnFixedNode(raw, path, fail)
  node.next = parseEdgeList(raw.next, `${path}.next`, fail, { allowString: false })
  return node
}

/**
 * @param {Record<string, any>} raw
 * @param {string} id
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any>}
 */
function parseRobotNode(raw, id, path, fail) {
  const node = { id, type: 'robot' }
  const robot = typeof raw.robot === 'string' ? raw.robot.trim() : ''
  if (robot === '') fail(`${path}.robot`, 'must be a non-empty robot name')
  else if (robot.length > MAX_ROBOT_NAME_LENGTH) fail(`${path}.robot`, `must be at most ${MAX_ROBOT_NAME_LENGTH} characters`)
  node.robot = robot

  // format 2：机器人节点不再携带 prompt，prompt 只写在进入它的边上。
  if (raw.prompt !== undefined && raw.prompt !== null) {
    fail(`${path}.prompt`, NODE_PROMPT_REMOVED)
  }

  // format 2：机器人始终交回 JSON，不再有 report 开关。
  if (raw.report !== undefined) {
    fail(`${path}.report`, REPORT_REMOVED)
  }

  if (raw.summary !== undefined && raw.summary !== null && typeof raw.summary !== 'string') {
    fail(`${path}.summary`, 'must be a string')
  }
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (summary.length > MAX_SUMMARY_LENGTH) {
    fail(`${path}.summary`, `must be at most ${MAX_SUMMARY_LENGTH} characters`)
  }
  node.summary = summary.slice(0, MAX_SUMMARY_LENGTH)

  // robot 节点必须声明结果 JSON 的 schema：它是运行期校验、structured_output
  // 参数与节点 prompt 结果契约的唯一来源。
  if (raw.output === undefined) {
    fail(`${path}.output`, 'is required: declare the JSON result schema for this robot node')
  } else {
    const output = parseOutputSchema(raw.output, `${path}.output`, fail)
    if (output !== null) node.output = output
  }

  node.agentOptions = parseAgentOptions(raw.agentOptions, `${path}.agentOptions`, fail)
  node.timeoutMs = parsePositiveInteger(raw.timeoutMs, `${path}.timeoutMs`, fail, 24 * 60 * 60 * 1000)
  node.maxVisits = parsePositiveInteger(raw.maxVisits, `${path}.maxVisits`, fail, 1000)
  // 机器人节点的 next 必须是边对象数组：每条边的 name 就是机器人 JSON
  // 结果里 `next` 可以取的路由键。
  node.next = parseEdgeList(raw.next, `${path}.next`, fail, { allowString: false, requireNames: true })
  return node
}

/**
 * @param {Record<string, any>} raw
 * @param {string} id
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any>}
 */
function parseGateNode(raw, id, path, fail) {
  const node = { id, type: 'gate' }
  rejectOutputOnFixedNode(raw, path, fail)
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    fail(`${path}.title`, 'must be a non-empty title')
    node.title = ''
  } else {
    node.title = raw.title.trim().slice(0, 200)
  }
  if (raw.detail !== undefined && typeof raw.detail !== 'string') {
    fail(`${path}.detail`, 'must be a string')
  }
  node.detail = typeof raw.detail === 'string' ? raw.detail.trim().slice(0, 4000) : ''
  node.onApprove = parseGateEdge(raw.onApprove, `${path}.onApprove`, fail)
  node.onReject = parseGateEdge(raw.onReject, `${path}.onReject`, fail)
  return node
}

/**
 * @param {Record<string, any>} raw
 * @param {string} id
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any>}
 */
function parseEndNode(raw, id, path, fail) {
  const node = { id, type: 'end' }
  rejectOutputOnFixedNode(raw, path, fail)
  if (raw.status !== undefined && !END_STATUSES.has(raw.status)) {
    fail(`${path}.status`, 'must be "completed", "failed" or "rejected"')
  }
  node.status = END_STATUSES.has(raw.status) ? raw.status : 'completed'
  // 终止节点只表达运行以什么状态结束；它展示的「最终输出」来自这次运行最后一次
  // 机器人执行的落盘正文，不由定义写死。
  return node
}

/**
 * 解析机器人节点可选使用的模型路由。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {{ provider?: string, model?: string, reasoningEffort?: string, maxTokens?: number } | undefined}
 */
function parseAgentOptions(raw, path, fail) {
  if (raw === undefined || raw === null) return undefined
  if (!isPlainObject(raw)) {
    fail(path, 'must be an object')
    return undefined
  }
  const allowed = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens'])
  const options = {}
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      fail(`${path}.${key}`, 'is not a supported agent option')
      continue
    }
    const value = raw[key]
    if (key === 'maxTokens') {
      if (!Number.isInteger(value) || value < 1) fail(`${path}.${key}`, 'must be a positive integer')
      else options[key] = value
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${path}.${key}`, 'must be a non-empty string')
      continue
    }
    options[key] = value.trim()
  }
  return Object.keys(options).length > 0 ? options : undefined
}

/**
 * 解析节点出口：边对象数组（省略表示没有出边）。
 *
 * format 2 里机器人节点和 start 节点都不再接受字符串简写；每条边上的 `name`
 * 是机器人结果 `next` 的路由键，离开机器人节点时必须唯一且非空。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @param {{ allowString: boolean, requireNames?: boolean }} options
 * @returns {Array<Record<string, any>>}
 */
function parseEdgeList(raw, path, fail, { allowString, requireNames = false }) {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') {
    if (!allowString) {
      fail(path, 'must be an array of edges { to, name, prompt }; the string shorthand was removed in workflow format 2')
      return []
    }
    const to = raw.trim()
    if (to === '') {
      fail(path, 'must be a non-empty node id')
      return []
    }
    return [{ to }]
  }
  if (!Array.isArray(raw)) {
    fail(path, allowString ? 'must be a node id, an array of edges, or omitted' : 'must be an array of edges { to, name, prompt }')
    return []
  }
  /** @type {Array<Record<string, any>>} */
  const rules = []
  const names = new Set()
  raw.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`
    if (!isPlainObject(rule)) {
      fail(rulePath, 'must be an object')
      return
    }
    if (rule.when !== undefined) {
      fail(`${rulePath}.when`, WHEN_REMOVED)
    }
    const to = typeof rule.to === 'string' ? rule.to.trim() : ''
    if (to === '') fail(`${rulePath}.to`, 'must be a non-empty node id')
    /** @type {Record<string, any>} */
    const edge = { to }
    parseEdgeExtras(edge, rule, rulePath, fail)
    if (requireNames) {
      const rawName = rule.name
      const hasInvalidName = rawName !== undefined && rawName !== null && typeof rawName !== 'string'
      if (edge.name === undefined && !hasInvalidName) {
        fail(
          `${rulePath}.name`,
          'every edge leaving a robot node needs a unique non-empty name; the robot returns it as the JSON "next" route',
        )
      } else if (typeof edge.name === 'string') {
        if (names.has(edge.name)) {
          fail(
            `${rulePath}.name`,
            `duplicate edge name "${edge.name}" on the same node; the JSON "next" route must be unambiguous`,
          )
        } else {
          names.add(edge.name)
        }
      }
    }
    rules.push(edge)
  })
  return rules
}

/**
 * 解析边上的可选字段：`name`（路由键 / 悬停展示）与 `prompt`（进入目标节点时的提示词）。
 *
 * @param {Record<string, any>} edge
 * @param {Record<string, any>} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any>}
 */
function parseEdgeExtras(edge, raw, path, fail) {
  if (raw.name !== undefined && raw.name !== null && typeof raw.name !== 'string') {
    fail(`${path}.name`, 'must be a string')
  } else if (typeof raw.name === 'string') {
    const name = raw.name.trim()
    if (name.length > MAX_EDGE_NAME_LENGTH) {
      fail(`${path}.name`, `must be at most ${MAX_EDGE_NAME_LENGTH} characters`)
    }
    if (name !== '') edge.name = name
  }

  if (raw.prompt !== undefined && raw.prompt !== null && typeof raw.prompt !== 'string') {
    fail(`${path}.prompt`, 'must be a string')
  } else if (typeof raw.prompt === 'string' && raw.prompt.trim() !== '') {
    if (Buffer.byteLength(raw.prompt, 'utf8') > MAX_PROMPT_BYTES) {
      fail(`${path}.prompt`, `must be at most ${Math.round(MAX_PROMPT_BYTES / 1024)} KiB`)
    }
    edge.prompt = raw.prompt
  }
  return edge
}

/**
 * 解析门禁的一条出边：节点 id 字符串，或 `{ to, name?, prompt? }` 对象。
 *
 * 门禁的“批准 / 拒绝”本身就是分支，所以边上不再支持 `when`。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any> | null}
 */
function parseGateEdge(raw, path, fail) {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') {
    const to = raw.trim()
    if (to === '') {
      fail(path, 'must be a non-empty node id or an edge object')
      return null
    }
    return { to }
  }
  if (!isPlainObject(raw)) {
    fail(path, 'must be a node id or an edge object')
    return null
  }
  if (raw.when !== undefined) {
    fail(`${path}.when`, WHEN_REMOVED)
  }
  const to = typeof raw.to === 'string' ? raw.to.trim() : ''
  if (to === '') {
    fail(`${path}.to`, 'must be a non-empty node id')
    return null
  }
  return parseEdgeExtras({ to }, raw, path, fail)
}

/**
 * start / gate / end 节点的输出由引擎定义，不接受 `output`。
 *
 * @param {Record<string, any>} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {void}
 */
function rejectOutputOnFixedNode(raw, path, fail) {
  if (raw.output === undefined) return
  fail(`${path}.output`, 'is only supported on robot nodes; start, gate and end nodes have fixed outputs')
}

/**
 * 校验每条边 prompt 里的模板变量。
 *
 * 只检查「引用的节点存在、字段在目标节点的 output 里、节点类型匹配」，不推断
 * 这个节点在这条边上是否已经执行过——那属于运行时。
 *
 * `edges` 里已经包含 start / robot / gate 的所有边；只有带 prompt 的边需要检查。
 *
 * @param {Map<string, Record<string, any>>} nodes
 * @param {Array<{ edge: Record<string, any>, path: string }>} edges
 * @param {(path: string, message: string) => void} fail
 * @returns {void}
 */
function validatePromptReferences(nodes, edges, fail) {
  for (const { edge, path } of edges) {
    if (typeof edge.prompt !== 'string' || edge.prompt === '') continue
    const inspected = inspectTemplate(edge.prompt)
    if (inspected.errors.length > 0) {
      for (const message of inspected.errors) fail(`${path}.prompt`, message)
      continue
    }
    for (const placeholder of inspected.paths) {
      const problem = referenceProblem(nodes, placeholder)
      if (problem !== null) fail(`${path}.prompt`, problem)
    }
  }
}

/**
 * 单个模板路径的引用检查。
 *
 * @param {Map<string, Record<string, any>>} nodes
 * @param {string} path
 * @returns {string | null}
 */
function referenceProblem(nodes, path) {
  const segments = path.split('.')
  const root = segments[0]
  if (root === 'goal' || root === 'step' || root === 'runId') {
    if (segments.length === 1) return null
    return `template path "${path}" cannot be descended into: "${root}" is not an object`
  }
  if (root !== 'nodes') {
    return `unknown template path "${path}"; available: {{goal}}, {{step}}, {{runId}}, {{nodes.<id>...}}`
  }
  if (segments.length < 3) {
    return `template path "${path}" is incomplete; use {{nodes.<id>.<field>}}`
  }

  const id = segments[1]
  const node = nodes.get(id)
  if (node === undefined) {
    return `template path "${path}" references unknown node "${id}"`
  }

  const field = segments[2]
  const rest = segments.slice(3)
  const robotOnly = () => `template path "${path}" reads "${field}", which only robot nodes provide`
  const gateOnly = () => `template path "${path}" reads "${field}", which only gate nodes provide`

  if (field === 'data') {
    if (node.type !== 'robot') return robotOnly()
    if (rest.length === 0) return null
    if (rest[0] === 'next') {
      return `template path "${path}" uses reserved field "next"; use {{nodes.${id}.route}}`
    }
    if (rest[0] === 'attachments') {
      return `template path "${path}" uses reserved field "attachments"; use {{nodes.${id}.attachments.<index>...}}`
    }
    if (node.output === undefined || node.output === null) {
      return `template path "${path}" cannot be checked because node "${id}" has no declared output schema`
    }
    const reason = resolveOutputPath(node.output, rest)
    if (reason === null) return null
    return `template path "${path}" ${reason} in node "${id}".output`
  }

  if (field === 'attachments') {
    // manifest 的形状由引擎定义，这里只检查节点类型；具体条目在运行时读取。
    return node.type === 'robot' ? null : robotOnly()
  }
  if (field === 'decision') {
    if (node.type !== 'gate') return gateOnly()
    if (rest.length > 0) return `template path "${path}" descends into "decision", which is not an object`
    return null
  }
  if (field === 'text' || field === 'route' || field === 'robot' || field === 'sessionId') {
    if (node.type !== 'robot') return robotOnly()
    if (rest.length > 0) return `template path "${path}" descends into "${field}", which is not an object`
    return null
  }
  return `template path "${path}" uses unknown node output "${field}"; available: text, data, route, attachments, robot, sessionId, decision (gate)`
}

/**
 * 读取可选正整数。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @param {number} max
 * @returns {number | undefined}
 */
function parsePositiveInteger(raw, path, fail, max) {
  if (raw === undefined || raw === null) return undefined
  if (!Number.isInteger(raw) || raw < 1) {
    fail(path, 'must be a positive integer')
    return undefined
  }
  if (raw > max) {
    fail(path, `must be at most ${max}`)
    return max
  }
  return raw
}
