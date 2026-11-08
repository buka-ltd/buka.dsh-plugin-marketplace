/**
 * 一次性工作流定义的校验与规范化。
 *
 * 工作流由 agent 在运行时现场生成：一份 JSON，包含目标、起始节点与节点表。
 * 本模块只做纯校验（不读盘、不依赖 DSH），返回可直接执行的 plan，以及给
 * 模型看的错误列表。节点分四类：
 *
 * - `start`：唯一的开始节点，不建会话、不执行；它只有一条出边，出边上的
 *   `prompt` 就是真正的第一个机器人节点首次进入时的提示词；
 * - `robot`：交给某个机器人执行；同一个机器人一次运行共用一个可续接的会话，节点只带一句给运行页
 *   展示的 `summary`，不再带提示词——每次进入它的边各自定义 prompt；
 * - `gate`：不建会话，等待用户做一次原生审批，批准 / 拒绝各走一条出边；
 * - `end`：终止节点，带最终状态（completed / rejected / failed）。
 *
 * 路由只有两种：固定 `next`，或按机器人回报的 `data` 字段做条件匹配。
 * 这里不做任何表达式求值，避免让模型生成可执行代码。
 *
 * `next` 里的每条规则就是一条「边」：`to` 是目标，`when` 是条件，`name` 是给
 * 运行页悬停看的短名字，`prompt` 是进入目标机器人节点时使用的提示词。**每个进入
 * 机器人节点的边都必须有 `prompt`**，所以同一个节点首次进入和被循环打回时可以
 * 用两条不同的边给出完全不同的指令。门禁的两条出边也支持同样的 `{ to, name,
 * prompt }` 对象。
 *
 * 兼容旧格式：没有 `start` 节点、用顶层 `start` 指定入口、提示词写在机器人节点
 * 上的定义仍然可以运行；新定义应使用 `start` 节点，并把所有 prompt 放在边上。
 *
 * @module @buka/dsh-plugin-workflows/definition
 */

/** 单份定义最多节点数。 */
export const MAX_NODES = 200

/** `maxSteps` 的绝对上限；再大也按这个值截断。 */
export const MAX_STEPS_CEILING = 256

/** 默认步数上限。 */
export const DEFAULT_MAX_STEPS = 64

/** 节点 id 的合法字符集。 */
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u

/** 条件字段路径：点号分隔的简单路径。 */
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u

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
 * 判断一个值是不是 JSON 标量（条件比较只支持标量）。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
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

  // 新格式：唯一 start 节点，所有 prompt 都在边上；旧格式：顶层 start + 节点 prompt。
  const startIds = order.filter((id) => nodes.get(id).type === 'start')
  const hasStartNode = startIds.length > 0
  /** @type {string} */
  let start = declaredStart

  if (hasStartNode) {
    if (startIds.length > 1) {
      for (const id of startIds.slice(1)) {
        fail(`nodes[${order.indexOf(id)}]`, 'the definition may contain exactly one start node')
      }
    }
    if (declaredStart !== '') fail('start', 'is not used when the definition has a start node')
    start = startIds[0]
    const startIndex = order.indexOf(start)
    const startNode = nodes.get(start)
    if (startNode !== undefined) {
      if (!Array.isArray(startNode.next) || startNode.next.length !== 1) {
        fail(`nodes[${startIndex}].next`, 'a start node needs exactly one outgoing edge')
      }
      const rule = startNode.next?.[0]
      if (rule !== undefined) {
        if (rule.when !== undefined) fail(`nodes[${startIndex}].next[0].when`, 'a start edge cannot have a condition')
        const target = nodes.get(rule.to)
        if (target !== undefined && target.type !== 'robot') {
          fail(`nodes[${startIndex}].next[0].to`, 'the start edge must enter a robot node')
        }
        if (typeof rule.prompt !== 'string' || rule.prompt.trim() === '') {
          fail(`nodes[${startIndex}].next[0].prompt`, 'the start edge must carry the first robot prompt')
        }
      }
    }
    // start 节点存在时，机器人节点上的 prompt 是旧格式残留，必须搬到边上。
    for (const [index, id] of order.entries()) {
      const node = nodes.get(id)
      if (node.type !== 'robot') continue
      if (typeof node.prompt === 'string' && node.prompt !== '') {
        fail(
          `nodes[${index}].prompt`,
          'robot nodes no longer carry a prompt; define it on the edge entering this node',
        )
        node.prompt = ''
      }
    }
  } else {
    if (declaredStart === '') fail('start', 'must be a non-empty node id, or add a start node')
    else if (!NODE_ID_PATTERN.test(declaredStart)) fail('start', 'must be a valid node id')
    else if (!nodes.has(declaredStart)) fail('start', `unknown start node "${declaredStart}"`)
    // 旧格式必须保留机器人节点自己的 prompt。
    for (const [index, id] of order.entries()) {
      const node = nodes.get(id)
      if (node.type !== 'robot') continue
      if (typeof node.prompt !== 'string' || node.prompt.trim() === '') {
        fail(`nodes[${index}].prompt`, 'must be a non-empty prompt string')
      }
    }
  }

  // 所有出边必须在节点表里存在；同一份定义里允许环，由 maxSteps / maxVisits 兜底。
  // 新格式下每个进入机器人节点的边都必须带 prompt；旧格式允许退回节点 prompt。
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
      if (hasStartNode && (typeof edge.prompt !== 'string' || edge.prompt.trim() === '')) {
        fail(`${path}.prompt`, 'an edge entering a robot node must carry its prompt')
      }
    } else if (typeof edge.prompt === 'string' && edge.prompt !== '') {
      fail(`${path}.prompt`, 'an edge prompt is only supported when the edge enters a robot node')
    }
  }

  if (errors.length === 0) {
    // 一条分支上的多条出边在图上无法只凭位置区分，名字是观察者唯一的线索；
    // 单出口的线性边不需要名字，所以这里只提醒多出口的情况。
    for (const [index, id] of order.entries()) {
      const node = nodes.get(id)
      const rules = Array.isArray(node.next) ? node.next : []
      if (rules.length < 2) continue
      for (const [ruleIndex, rule] of rules.entries()) {
        if (typeof rule.name === 'string' && rule.name !== '') continue
        warnings.push(
          `node "${id}" has multiple exits; add a "name" to nodes[${index}].next[${ruleIndex}] so the run page can label that edge`,
        )
      }
    }
    // 从 start 走不到的节点永远不会执行；它没有入边，画到图上还会被当成第二个
    // 起点，所以这里直接报错，而不是留一条 warning 让运行图出现歧义。
    const reachable = reachableNodes(nodes, start)
    for (const [index, id] of order.entries()) {
      if (reachable.has(id)) continue
      fail(`nodes[${index}]`, `node "${id}" is not reachable from start, so it would never run`)
    }
    const hasRobot = order.some((id) => nodes.get(id).type === 'robot')
    if (errors.length === 0 && !hasRobot) {
      warnings.push('the workflow has no robot node, so nothing will be delegated')
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
 * @param {NonNullable<ReturnType<typeof validateDefinition>['plan']>} plan
 * @returns {{ start: string, maxSteps: number, goal: string, nodes: Array<Record<string, unknown>> }}
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
  node.next = parseNext(raw.next, `${path}.next`, fail)
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

  if (raw.prompt !== undefined && raw.prompt !== null && typeof raw.prompt !== 'string') {
    fail(`${path}.prompt`, 'must be a string')
    node.prompt = ''
  } else {
    node.prompt = typeof raw.prompt === 'string' ? raw.prompt : ''
  }
  if (node.prompt !== '' && Buffer.byteLength(node.prompt, 'utf8') > MAX_PROMPT_BYTES) {
    fail(`${path}.prompt`, `must be at most ${Math.round(MAX_PROMPT_BYTES / 1024)} KiB`)
  }

  if (raw.summary !== undefined && raw.summary !== null && typeof raw.summary !== 'string') {
    fail(`${path}.summary`, 'must be a string')
  }
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (summary.length > MAX_SUMMARY_LENGTH) {
    fail(`${path}.summary`, `must be at most ${MAX_SUMMARY_LENGTH} characters`)
  }
  node.summary = summary.slice(0, MAX_SUMMARY_LENGTH)

  if (raw.report !== undefined && typeof raw.report !== 'boolean') {
    fail(`${path}.report`, 'must be a boolean')
  }
  node.report = raw.report === true
  node.agentOptions = parseAgentOptions(raw.agentOptions, `${path}.agentOptions`, fail)
  node.timeoutMs = parsePositiveInteger(raw.timeoutMs, `${path}.timeoutMs`, fail, 24 * 60 * 60 * 1000)
  node.maxVisits = parsePositiveInteger(raw.maxVisits, `${path}.maxVisits`, fail, 1000)
  node.next = parseNext(raw.next, `${path}.next`, fail)
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
  if (raw.status !== undefined && !END_STATUSES.has(raw.status)) {
    fail(`${path}.status`, 'must be "completed", "failed" or "rejected"')
  }
  node.status = END_STATUSES.has(raw.status) ? raw.status : 'completed'
  // 终止节点只表达运行以什么状态结束；它展示的「最终交付物」来自这次运行最后一次
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
 * 解析节点出口：字符串、规则数组或省略。
 *
 * 每条规则是一条边，可带 `name`（运行页悬停时展示）与 `prompt`（只在这条边
 * 被走到时附加给目标节点的入口说明）。边 prompt 的落点由后续校验保证是
 * 机器人节点，这里只做字段本身的校验。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Array<Record<string, any>>}
 */
function parseNext(raw, path, fail) {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') {
    const to = raw.trim()
    if (to === '') {
      fail(path, 'must be a non-empty node id')
      return []
    }
    return [{ to }]
  }
  if (!Array.isArray(raw)) {
    fail(path, 'must be a node id, an array of rules, or omitted')
    return []
  }
  const rules = []
  raw.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`
    if (!isPlainObject(rule)) {
      fail(rulePath, 'must be an object')
      return
    }
    const to = typeof rule.to === 'string' ? rule.to.trim() : ''
    if (to === '') fail(`${rulePath}.to`, 'must be a non-empty node id')
    const when = rule.when === undefined ? undefined : parseWhen(rule.when, `${rulePath}.when`, fail)
    const edge = when === undefined ? { to } : { to, when }
    parseEdgeExtras(edge, rule, rulePath, fail)
    rules.push(edge)
  })
  return rules
}

/**
 * 解析边上的可选字段：`name`（悬停展示）与 `prompt`（进入目标节点时的提示词）。
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
 * 解析一个条件。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, unknown> | undefined}
 */
function parseWhen(raw, path, fail) {
  if (!isPlainObject(raw)) {
    fail(path, 'must be an object with "field" and one of "equals" / "in"')
    return undefined
  }
  const field = typeof raw.field === 'string' ? raw.field.trim() : ''
  if (!FIELD_PATH_PATTERN.test(field)) {
    fail(`${path}.field`, 'must be a dotted path such as "status" or "meta.verdict"')
    return undefined
  }
  const hasEquals = Object.hasOwn(raw, 'equals')
  const hasIn = Object.hasOwn(raw, 'in')
  if (hasEquals === hasIn) {
    fail(path, 'must contain exactly one of "equals" or "in"')
    return undefined
  }
  if (hasEquals) {
    if (!isJsonScalar(raw.equals)) fail(`${path}.equals`, 'must be a string, number, boolean or null')
    else return { field, equals: raw.equals }
  }
  if (hasIn) {
    if (!Array.isArray(raw.in) || !raw.in.every(isJsonScalar)) {
      fail(`${path}.in`, 'must be an array of strings, numbers, booleans or null')
      return undefined
    }
    return { field, in: raw.in }
  }
  return undefined
}

/**
 * 解析门禁的一条出边：节点 id 字符串，或 `{ to, name?, prompt? }` 对象。
 *
 * 门禁的“批准 / 拒绝”本身已经是条件，所以边上不再支持 `when`。
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
  const to = typeof raw.to === 'string' ? raw.to.trim() : ''
  if (to === '') {
    fail(`${path}.to`, 'must be a non-empty node id')
    return null
  }
  if (raw.when !== undefined) {
    fail(`${path}.when`, 'gate edges do not support "when"; approve / reject is the condition')
  }
  return parseEdgeExtras({ to }, raw, path, fail)
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
