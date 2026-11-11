/**
 * 一次性工作流定义的校验与规范化（workflow format 3）。
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
 *   一个 JSON 对象，其中的 `next` 是出边 `name`（路由键）。可选的 `mode: "plan"`
 *   让这一次进入先走 DSH plan 模式：机器人探索并交计划，用户批准后在同一会话
 *   继续实施，再交回结果；它不改变节点类型、`output` 或路由；
 * - `user`：用户介入节点，不建会话。流程在这里停下，把说明交给用户，等用户
 *   做决策 / 完成只有人才能做的操作 / 查看只有人才能看到的结果后继续。用户的
 *   选项就是出边（`label` 是显示给用户的文字，`name` 是路由键），还可以用
 *   `questions` 追加问题收集反馈；回答按问题 id 落盘，后续 prompt 可以引用；
 * - `end`：终止节点，带最终状态（completed / rejected / failed）。
 *
 * 路由只有一种：机器人结果里的 `next` 必须精确匹配某一条出边的 `name`；
 * 用户节点则由用户选中的选项决定走哪条边。这里不做任何表达式求值，避免让
 * 模型生成可执行代码。
 *
 * `next` 里的每条规则就是一条「边」：`to` 是目标，`name` 是路由键（离开机器人
 * 节点时必须唯一且非空，也是运行页悬停看到的短名字），`prompt` 是进入目标
 * 机器人节点时使用的提示词，可选 `tone`（`success` / `failure`）是运行页上
 * 这条线成功绿 / 失败红的外观色——纯展示，不参与路由或执行。**每个进入机器人
 * 节点的边都必须有 `prompt`**，所以同一个节点首次进入和被循环打回时可以用两条
 * 不同的边给出完全不同的指令。用户节点的出边额外带 `label` / `description`，
 * 作为给用户看的选项。
 *
 * 旧格式（顶层 `start`、节点 prompt、`report`、`when` 条件）以及 format 2 的
 * `gate` 节点在 format 3 里全部移除：出现即报错，不做兼容。
 *
 * robot 节点必须声明 `output`：节点结果 JSON 的 JSON Schema（子集校验见
 * `output.js`）。定义校验还会检查每条边 prompt 里的模板占位符：引用的节点必须
 * 存在，`{{nodes.<id>.data.<path>}}` 的路径必须真的在目标节点的 `output` 里。
 *
 * @module @buka/dsh-plugin-workflows/definition
 */

import type { OutputSchema } from './output.ts'
import { parseOutputSchema, resolveOutputPath } from './output.ts'
import { inspectTemplate } from './template.ts'

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

/** 用户节点标题的最大字符数。 */
export const MAX_USER_TITLE_LENGTH = 200

/** 用户节点说明的最大字符数。 */
export const MAX_USER_DETAIL_LENGTH = 4000

/** 用户选项 / 问题选项 label 的最大字符数。 */
export const MAX_OPTION_LABEL_LENGTH = 120

/** 选项说明的最大字符数。 */
export const MAX_OPTION_DESCRIPTION_LENGTH = 500

/** 单个用户节点最多追加多少个问题（不含 route 问题）。 */
export const MAX_USER_QUESTIONS = 4

/** 问题正文 / 标题的最大字符数。 */
const MAX_QUESTION_TEXT_LENGTH = 1000
const MAX_QUESTION_HEADER_LENGTH = 200

/** 单个问题最多多少个选项。 */
const MAX_QUESTION_OPTIONS = 20

/** 问题 id 的合法字符集。 */
const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u

/** route 问题的保留 id；用户节点的出边选项共用这个 id。 */
export const ROUTE_QUESTION_ID = 'route'

/** 终止节点允许的状态。 */
const END_STATUSES = new Set(['completed', 'failed', 'rejected'])

/** 节点类型。 */
const NODE_TYPES = new Set(['start', 'robot', 'user', 'join', 'end'])

/**
 * 机器人节点可选的会话模式。`plan` 进入 DSH 的 plan 模式（先探索、交计划，
 * 原生审阅批准后再继续）；`goal` 暂未实现，定义里出现会被明确拒绝。
 */
const ROBOT_MODES = new Set(['plan'])

/** format 3 的移除提示：旧 gate 节点被用户介入节点取代。 */
const GATE_REMOVED =
  'gate was replaced by the user node in workflow format 3; use { "type": "user", "title", "detail"?, "next"?, "questions"? }'

/** format 2 的移除提示：机器人节点不再有 `report`。 */
const REPORT_REMOVED =
  'report was removed in workflow format 2; every robot node always returns JSON'

/** format 2 的移除提示：边不再有 `when`。 */
const WHEN_REMOVED = 'when was removed; select the next edge with the JSON "next" route'

/** 机器人节点 prompt 移除提示。 */
const NODE_PROMPT_REMOVED =
  'robot nodes no longer carry a prompt; define it on the edge entering this node'

/**
 * 边可选的展示色。它只影响运行页 / 模板页上那条线的颜色，不参与路由、
 * 调度或结果校验，所以只有「成功」与「失败」两个语义值。
 */
const EDGE_TONES = new Set(['success', 'failure'])

/** 记录一条定义错误。 */
export type FailFn = (path: string, message: string) => void

/** 一条节点出边。用户节点的边额外带 `label` / `description`。 */
export interface WorkflowEdge {
  to: string
  name?: string
  prompt?: string
  tone?: 'success' | 'failure'
  label?: string
  description?: string
}

/** 用户节点追加问题的选项。 */
export interface QuestionOption {
  label: string
  description?: string
}

/** 用户节点追加的问题。 */
export interface UserQuestion {
  id: string
  header: string
  question: string
  multiSelect: boolean
  options: QuestionOption[]
}

/** 机器人节点可选使用的模型路由。 */
export interface AgentOptions {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
}

/**
 * 规范化后的节点。
 *
 * 字段按节点类型出现（start / robot / user / join / end），这里合成一个可选字段
 * 的形状，保持与原实现一致的宽松访问方式：下游本来就按 `node.type` 判断后再用字段。
 */
export interface WorkflowNode {
  id: string
  type: 'start' | 'robot' | 'user' | 'join' | 'end'
  next?: WorkflowEdge[] | undefined
  robot?: string
  summary?: string
  mode?: 'plan'
  output?: OutputSchema
  agentOptions?: AgentOptions | undefined
  timeoutMs?: number | undefined
  maxVisits?: number | undefined
  title?: string
  detail?: string
  questions?: UserQuestion[]
  inputs?: string[]
  status?: 'completed' | 'failed' | 'rejected'
}

/** 校验通过后的可执行计划。 */
export interface WorkflowPlan {
  goal: string
  start: string
  maxSteps: number
  nodes: Record<string, WorkflowNode>
  order: string[]
}

/** 一条定义错误。 */
export interface DefinitionIssue {
  path: string
  message: string
}

/** `validateDefinition` 的结果：`ok` 为 true 时一定有可执行的 plan。 */
export type ValidateDefinitionResult =
  | {
      readonly ok: true
      readonly errors: DefinitionIssue[]
      readonly warnings: string[]
      readonly plan: WorkflowPlan
    }
  | {
      readonly ok: false
      readonly errors: DefinitionIssue[]
      readonly warnings: string[]
      readonly plan: null
    }

/** 需要做模板引用校验的一段文本。 */
interface PromptTemplate {
  template: string
  path: string
}

/** `describePlan` 里单个节点的摘要。 */
interface PlanNodeSummary extends Record<string, unknown> {
  id: string
  type: WorkflowNode['type']
}

/**
 * 判断一个值是不是普通对象。
 *
 * @param value 待判断的值
 * @returns 是普通对象时为 true
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验一份工作流定义。
 *
 * 返回 `{ ok, errors, warnings, plan }`：`ok` 为 true 时 `plan` 可执行；
 * 否则 `errors` 里是 `{ path, message }` 列表，`plan` 为 null。
 *
 * @param input agent 传入的定义
 * @param options 部署侧步数上限
 * @returns 校验结果；`ok` 为 true 时 `plan` 可执行
 */
export function validateDefinition(
  input: unknown,
  options: { maxSteps?: number | undefined } = {},
): ValidateDefinitionResult {
  const errors: DefinitionIssue[] = []
  const warnings: string[] = []
  const fail: FailFn = (path, message) => errors.push({ path, message })

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

  const nodes = new Map<string, WorkflowNode>()
  const order: string[] = []
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
  const startIds = order.filter((id) => nodes.get(id)?.type === 'start')
  let start = ''
  if (startIds.length === 0) {
    if (declaredStart === '')
      fail('start', 'a workflow definition needs exactly one node with type "start"')
  } else {
    if (startIds.length > 1) {
      for (const id of startIds.slice(1)) {
        fail(`nodes[${order.indexOf(id)}]`, 'the definition may contain exactly one start node')
      }
    }
    start = startIds[0] ?? ''
    const startIndex = order.indexOf(start)
    const startNode = nodes.get(start)
    if (startNode !== undefined) {
      if (!Array.isArray(startNode.next) || startNode.next.length === 0) {
        fail(`nodes[${startIndex}].next`, 'a start node needs at least one outgoing edge')
      } else {
        startNode.next.forEach((rule, ruleIndex) => {
          const target = nodes.get(rule.to)
          if (target !== undefined && target.type !== 'robot') {
            fail(
              `nodes[${startIndex}].next[${ruleIndex}].to`,
              'the start edge must enter a robot node',
            )
          }
          if (typeof rule.prompt !== 'string' || rule.prompt.trim() === '') {
            fail(
              `nodes[${startIndex}].next[${ruleIndex}].prompt`,
              'the start edge must carry the first robot prompt',
            )
          }
        })
      }
    }
  }

  // 所有出边必须在节点表里存在；同一份定义里允许环，由 maxSteps / maxVisits 兜底。
  // 每个进入机器人节点的边都必须带 prompt；进入 user / end 的边不能带 prompt。
  const edges: Array<{ edge: WorkflowEdge; path: string }> = []
  for (const [index, id] of order.entries()) {
    const node = nodes.get(id)
    for (const [ruleIndex, rule] of (node?.next ?? []).entries()) {
      edges.push({ edge: rule, path: `nodes[${index}].next[${ruleIndex}]` })
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
    if (target.type === 'join') {
      fail(
        path,
        'an edge cannot point at a join node; joins collect their inputs via the "inputs" list',
      )
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

  // join 的入边（inputs）必须引用存在的机器人节点；同时构建「任务 → 引用它的
  // join」反向索引，供可达性 / 环检测把 join 当成图的一部分（任务 → join 是隐式边）。
  const inputJoins = new Map<string, string[]>()
  for (const [index, id] of order.entries()) {
    const node = nodes.get(id)
    if (node === undefined || node.type !== 'join') continue
    for (const [inputIndex, input] of (node.inputs ?? []).entries()) {
      const target = nodes.get(input)
      if (target === undefined) {
        fail(`nodes[${index}].inputs[${inputIndex}]`, `references unknown node "${input}"`)
        continue
      }
      if (target.type !== 'robot') {
        fail(
          `nodes[${index}].inputs[${inputIndex}]`,
          `a join can only wait for robot nodes; "${input}" is a ${target.type} node`,
        )
        continue
      }
      const list = inputJoins.get(input)
      if (list === undefined) inputJoins.set(input, [id])
      else list.push(id)
    }
  }

  if (errors.length === 0) {
    // 从 start 走不到的节点永远不会执行；它没有入边，画到图上还会被当成第二个
    // 起点，所以这里直接报错，而不是留一条 warning 让运行图出现歧义。
    const reachable = reachableNodes(nodes, start, inputJoins)
    for (const [index, id] of order.entries()) {
      if (reachable.has(id)) continue
      fail(`nodes[${index}]`, `node "${id}" is not reachable from start, so it would never run`)
    }
    // 结构没问题后再检查模板里的变量：引用的节点必须存在，data 路径必须在
    // 目标节点声明的 output 里。这样定义写错时在计划阶段就能定位到边 / 说明。
    if (errors.length === 0) validatePromptReferences(nodes, promptTemplates(nodes, order), fail)
    const hasRobot = order.some((id) => nodes.get(id)?.type === 'robot')
    if (errors.length === 0 && !hasRobot) {
      warnings.push('the workflow has no robot node, so nothing will be delegated')
    }
  }

  if (errors.length === 0) {
    // 成环的机器人节点如果没有 maxVisits，只能靠 maxSteps 兜底；提醒创建者补上
    // 访问次数上限，避免「一直不离开环」的循环跑到步数上限才停。
    const cyclic = cyclicNodes(nodes, order, inputJoins)
    for (const id of order) {
      const node = nodes.get(id)
      if (node === undefined || node.type !== 'robot') continue
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
 * `next` 可以取的值。用户节点带 `title`、`routes`（每条边 `{ name, label }`）
 * 与 `questions`（追加问题的 id）。
 *
 * @param plan 校验通过后的计划
 * @returns 给模型看的摘要
 */
export function describePlan(plan: WorkflowPlan): {
  start: string
  maxSteps: number
  goal: string
  nodes: Array<Record<string, unknown>>
} {
  return {
    start: plan.start,
    maxSteps: plan.maxSteps,
    goal: plan.goal,
    nodes: plan.order.map((id) => {
      const node = plan.nodes[id] as WorkflowNode
      const summary: PlanNodeSummary = { id, type: node.type }
      if (node.robot !== undefined) summary.robot = node.robot
      if (node.type === 'end') summary.status = node.status
      if (node.type === 'robot') {
        if (node.mode === 'plan') summary.mode = 'plan'
        summary.routes = (Array.isArray(node.next) ? node.next : [])
          .map((rule) => rule.name)
          .filter((name) => typeof name === 'string' && name !== '')
      }
      if (node.type === 'user') {
        summary.title = node.title
        summary.routes = (Array.isArray(node.next) ? node.next : []).map((rule) => ({
          name: rule.name,
          label: rule.label,
        }))
        summary.questions = (Array.isArray(node.questions) ? node.questions : []).map(
          (question) => question.id,
        )
      }
      if (node.type === 'join') {
        summary.inputs = [...(node.inputs ?? [])]
        summary.next = Array.isArray(node.next) && node.next.length > 0 ? node.next[0]?.to : null
      }
      return summary
    }),
  }
}

/**
 * 收集一个节点的所有出边目标。
 *
 * @param node 已规范化的节点
 * @returns 出边目标 id
 */
export function targetsOf(node: WorkflowNode): string[] {
  const targets: string[] = []
  if (Array.isArray(node.next)) {
    for (const rule of node.next) {
      if (typeof rule?.to === 'string' && rule.to !== '') targets.push(rule.to)
    }
  }
  return targets
}

/**
 * 一个节点在图上的全部出边目标：普通 `next` 出边，加上「任务 → 引用它的 join」
 * 的隐式入边（join.inputs 里列出该任务的那些 join）。join 自己只有 `next` 出边。
 *
 * @param node 已规范化的节点
 * @param inputJoins 任务节点 id → 引用它的 join id 列表
 * @returns 出边目标 id（含隐式 join 边）
 */
function allTargetsOf(node: WorkflowNode, inputJoins: Map<string, string[]>): string[] {
  const targets = targetsOf(node)
  if (node.type === 'robot') {
    for (const joinId of inputJoins.get(node.id) ?? []) targets.push(joinId)
  }
  return targets
}

/**
 * 从 start 出发按出边做一次 BFS。
 *
 * @param nodes 节点表
 * @param start 起始节点 id
 * @param inputJoins 任务节点 id → 引用它的 join id 列表
 * @returns 从 start 可达的节点 id
 */
function reachableNodes(
  nodes: Map<string, WorkflowNode>,
  start: string,
  inputJoins: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>()
  const queue: string[] = [start]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodes.get(id)
    if (node === undefined) continue
    queue.push(...allTargetsOf(node, inputJoins))
  }
  return seen
}

/**
 * 找出所有「在环上」的节点（从自己出发沿出边可以走回自己）。
 *
 * @param nodes 节点表
 * @param order 节点声明顺序
 * @param inputJoins 任务节点 id → 引用它的 join id 列表
 * @returns 在环上的节点 id
 */
function cyclicNodes(
  nodes: Map<string, WorkflowNode>,
  order: string[],
  inputJoins: Map<string, string[]>,
): Set<string> {
  const cyclic = new Set<string>()
  for (const id of order) {
    const node = nodes.get(id)
    if (node === undefined) continue
    const queue = [...allTargetsOf(node, inputJoins)]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const next = queue.shift()
      if (next === undefined) break
      if (next === id) {
        cyclic.add(id)
        break
      }
      if (seen.has(next)) continue
      seen.add(next)
      const target = nodes.get(next)
      if (target !== undefined) queue.push(...allTargetsOf(target, inputJoins))
    }
  }
  return cyclic
}

/**
 * 读取 goal：可选，默认空串。
 *
 * @param value 定义里的 goal
 * @param fail 记录错误的回调
 * @returns 规范化后的 goal
 */
function readGoal(value: unknown, fail: FailFn): string {
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
 * @param value 定义里的 maxSteps
 * @param ceiling 部署侧上限
 * @param fail 记录错误的回调
 * @returns 裁剪后的步数上限
 */
function readMaxSteps(value: unknown, ceiling: number, fail: FailFn): number {
  if (value === undefined || value === null) return ceiling
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail('maxSteps', 'must be a positive integer')
    return ceiling
  }
  if (value > ceiling) fail('maxSteps', `must be at most ${ceiling}`)
  return Math.min(value, ceiling)
}

/**
 * 部署侧上限的规范化。
 *
 * @param value 部署侧配置的上限
 * @returns 规范化后的上限
 */
function normalizeStepCeiling(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return DEFAULT_MAX_STEPS
  return Math.min(value, MAX_STEPS_CEILING)
}

/**
 * 解析一个节点；无法构成节点时返回 null（错误已记录）。
 *
 * @param raw 原始节点
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的节点；不合法时是 `null`
 */
function parseNode(raw: unknown, path: string, fail: FailFn): WorkflowNode | null {
  if (!isPlainObject(raw)) {
    fail(path, 'must be an object')
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!NODE_ID_PATTERN.test(id)) {
    fail(
      `${path}.id`,
      'must be 1-64 letters, digits, ".", "_" or "-", starting with a letter or digit',
    )
  }
  const type = typeof raw.type === 'string' ? raw.type.trim() : ''
  if (type === 'gate') {
    fail(`${path}.type`, GATE_REMOVED)
    return null
  }
  if (!NODE_TYPES.has(type)) {
    fail(`${path}.type`, 'must be "start", "robot", "user" or "end"')
    return null
  }
  if (!NODE_ID_PATTERN.test(id)) return null

  if (type === 'start') return parseStartNode(raw, id, path, fail)
  if (type === 'robot') return parseRobotNode(raw, id, path, fail)
  if (type === 'user') return parseUserNode(raw, id, path, fail)
  if (type === 'join') return parseJoinNode(raw, id, path, fail)
  return parseEndNode(raw, id, path, fail)
}

/**
 * @param raw 原始节点
 * @param id 节点 id
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的开始节点
 */
function parseStartNode(
  raw: Record<string, unknown>,
  id: string,
  path: string,
  fail: FailFn,
): WorkflowNode {
  rejectOutputOnFixedNode(raw, path, fail)
  rejectModeOnFixedNode(raw, path, fail)
  const next = parseEdgeList(raw.next, `${path}.next`, fail, { allowString: false })
  return { id, type: 'start', next }
}
/**
 * @param raw 原始节点
 * @param id 节点 id
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的机器人节点
 */
function parseRobotNode(
  raw: Record<string, unknown>,
  id: string,
  path: string,
  fail: FailFn,
): WorkflowNode {
  const robot = typeof raw.robot === 'string' ? raw.robot.trim() : ''
  if (robot === '') fail(`${path}.robot`, 'must be a non-empty robot name')
  else if (robot.length > MAX_ROBOT_NAME_LENGTH)
    fail(`${path}.robot`, `must be at most ${MAX_ROBOT_NAME_LENGTH} characters`)

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
  const summaryText = summary.slice(0, MAX_SUMMARY_LENGTH)

  // 可选的会话模式：plan 让这个机器人先探索并交计划，用户在 DSH 原生审阅卡里
  // 批准后才继续执行。它只影响这一次进入的会话状态，不改变节点类型或路由。
  let mode: 'plan' | undefined
  if (raw.mode !== undefined && raw.mode !== null) {
    const rawMode = typeof raw.mode === 'string' ? raw.mode.trim() : ''
    if (rawMode === 'goal') {
      fail(`${path}.mode`, 'mode "goal" is not supported yet; only "plan" is available')
    } else if (!ROBOT_MODES.has(rawMode)) {
      fail(`${path}.mode`, 'must be "plan"')
    } else {
      mode = 'plan'
    }
  }

  // robot 节点必须声明结果 JSON 的 schema：它是运行期校验、structured_output
  // 参数与节点 prompt 结果契约的唯一来源。
  let output: OutputSchema | undefined
  if (raw.output === undefined) {
    fail(`${path}.output`, 'is required: declare the JSON result schema for this robot node')
  } else {
    const parsedOutput = parseOutputSchema(raw.output, `${path}.output`, fail)
    if (parsedOutput !== null) output = parsedOutput
  }

  const agentOptions = parseAgentOptions(raw.agentOptions, `${path}.agentOptions`, fail)
  const timeoutMs = parsePositiveInteger(
    raw.timeoutMs,
    `${path}.timeoutMs`,
    fail,
    24 * 60 * 60 * 1000,
  )
  const maxVisits = parsePositiveInteger(raw.maxVisits, `${path}.maxVisits`, fail, 1000)
  // 机器人节点的 next 必须是边对象数组：每条边的 name 就是机器人 JSON
  // 结果里 `next` 可以取的路由键。
  const next = parseEdgeList(raw.next, `${path}.next`, fail, {
    allowString: false,
    requireNames: true,
  })
  return {
    id,
    type: 'robot',
    robot,
    summary: summaryText,
    ...(mode === undefined ? {} : { mode }),
    ...(output === undefined ? {} : { output }),
    agentOptions,
    timeoutMs,
    maxVisits,
    next,
  }
}
/**
 * 解析一个用户介入节点：说明 + 用户选项出边 + 可选的追加问题。
 *
 * 用户的选项就是出边：每条边都要有 `name`（路由键）与 `label`（显示给用户
 * 的文字），`description` 可选。`questions` 用来收集额外的反馈 / 信息，回答
 * 会按问题 id 落盘，后续 prompt 可以用模板引用。
 *
 * @param raw 原始节点
 * @param id 节点 id
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的用户介入节点
 */
function parseUserNode(
  raw: Record<string, unknown>,
  id: string,
  path: string,
  fail: FailFn,
): WorkflowNode {
  rejectOutputOnFixedNode(raw, path, fail)
  rejectModeOnFixedNode(raw, path, fail)
  if (raw.onApprove !== undefined || raw.onReject !== undefined) {
    fail(
      `${path}.onApprove`,
      'onApprove / onReject were removed in workflow format 3; declare the choices as edges in "next" with a label',
    )
  }
  let title: string
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    fail(`${path}.title`, 'must be a non-empty title')
    title = ''
  } else {
    title = raw.title.trim().slice(0, MAX_USER_TITLE_LENGTH)
  }
  if (raw.detail !== undefined && raw.detail !== null && typeof raw.detail !== 'string') {
    fail(`${path}.detail`, 'must be a string')
  }
  const detail = typeof raw.detail === 'string' ? raw.detail.trim() : ''
  if (detail.length > MAX_USER_DETAIL_LENGTH) {
    fail(`${path}.detail`, `must be at most ${MAX_USER_DETAIL_LENGTH} characters`)
  }
  const detailText = detail.slice(0, MAX_USER_DETAIL_LENGTH)
  // 用户的选项就是出边：离开用户节点不需要 prompt（目标是机器人时仍需要，
  // 由统一的边检查负责），但必须有 name 与 label。
  const next = parseEdgeList(raw.next, `${path}.next`, fail, {
    allowString: false,
    requireNames: true,
    userEdges: true,
  })
  const questions = parseUserQuestions(raw.questions, `${path}.questions`, fail)
  if (next.length === 0 && questions.length === 0) {
    fail(
      path,
      'a user node needs at least one outgoing edge (a choice) or one extra question; otherwise there is nothing to wait for',
    )
  }
  return { id, type: 'user', title, detail: detailText, next, questions }
}
/**
 * 解析用户节点追加的问题。
 *
 * @param raw 原始 questions
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的问题列表
 */
function parseUserQuestions(raw: unknown, path: string, fail: FailFn): UserQuestion[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    fail(path, 'must be an array of questions')
    return []
  }
  if (raw.length > MAX_USER_QUESTIONS) {
    fail(path, `must contain at most ${MAX_USER_QUESTIONS} questions`)
  }
  const questions: UserQuestion[] = []
  const ids = new Set([ROUTE_QUESTION_ID])
  raw.slice(0, MAX_USER_QUESTIONS).forEach((question: unknown, index) => {
    const questionPath = `${path}[${index}]`
    if (!isPlainObject(question)) {
      fail(questionPath, 'must be an object')
      return
    }
    const questionId = typeof question.id === 'string' ? question.id.trim() : ''
    if (!QUESTION_ID_PATTERN.test(questionId)) {
      fail(`${questionPath}.id`, 'must be 1-64 letters, digits, "_" or "-"')
    } else if (ids.has(questionId)) {
      fail(
        `${questionPath}.id`,
        `duplicate question id "${questionId}"; ids must be unique and "route" is reserved`,
      )
    } else {
      ids.add(questionId)
    }
    const text = typeof question.question === 'string' ? question.question.trim() : ''
    if (text === '') fail(`${questionPath}.question`, 'must be a non-empty question')
    else if (text.length > MAX_QUESTION_TEXT_LENGTH) {
      fail(`${questionPath}.question`, `must be at most ${MAX_QUESTION_TEXT_LENGTH} characters`)
    }
    if (
      question.header !== undefined &&
      question.header !== null &&
      typeof question.header !== 'string'
    ) {
      fail(`${questionPath}.header`, 'must be a string')
    }
    const header = typeof question.header === 'string' ? question.header.trim() : ''
    if (header.length > MAX_QUESTION_HEADER_LENGTH) {
      fail(`${questionPath}.header`, `must be at most ${MAX_QUESTION_HEADER_LENGTH} characters`)
    }
    if (question.multiSelect !== undefined && typeof question.multiSelect !== 'boolean') {
      fail(`${questionPath}.multiSelect`, 'must be a boolean')
    }
    const options: QuestionOption[] = []
    if (question.options !== undefined && question.options !== null) {
      if (!Array.isArray(question.options)) {
        fail(`${questionPath}.options`, 'must be an array of { label, description? }')
      } else {
        if (question.options.length > MAX_QUESTION_OPTIONS) {
          fail(`${questionPath}.options`, `must contain at most ${MAX_QUESTION_OPTIONS} options`)
        }
        const labels = new Set<string>()
        question.options.slice(0, MAX_QUESTION_OPTIONS).forEach((option: unknown, optionIndex) => {
          const optionPath = `${questionPath}.options[${optionIndex}]`
          if (!isPlainObject(option)) {
            fail(optionPath, 'must be an object')
            return
          }
          const label = typeof option.label === 'string' ? option.label.trim() : ''
          if (label === '') fail(`${optionPath}.label`, 'must be a non-empty label')
          else if (label.length > MAX_OPTION_LABEL_LENGTH) {
            fail(`${optionPath}.label`, `must be at most ${MAX_OPTION_LABEL_LENGTH} characters`)
          } else if (labels.has(label)) {
            fail(`${optionPath}.label`, `duplicate option label "${label}" on the same question`)
          } else {
            labels.add(label)
          }
          if (
            option.description !== undefined &&
            option.description !== null &&
            typeof option.description !== 'string'
          ) {
            fail(`${optionPath}.description`, 'must be a string')
          }
          const description =
            typeof option.description === 'string'
              ? option.description.trim().slice(0, MAX_OPTION_DESCRIPTION_LENGTH)
              : ''
          options.push(description === '' ? { label } : { label, description })
        })
      }
    }
    questions.push({
      id: questionId,
      header: header.slice(0, MAX_QUESTION_HEADER_LENGTH),
      question: text.slice(0, MAX_QUESTION_TEXT_LENGTH),
      multiSelect: question.multiSelect === true,
      options,
    })
  })
  return questions
}
/**
 * 解析一个 join 节点（并发汇合屏障）：它本身不建会话、不产出结果，只等待
 * `inputs` 里列出的任务节点全部完成后放行一次，沿唯一一条出边继续。
 *
 * join 的入边不是节点图上的 `next`，而是 `inputs`（任务节点 id 列表），所以一个
 * 任务可以同时被多个 join 引用；出边恰好一条，`prompt` 是下游机器人进入时的
 * 指令（与 start 一致）。join 没有 output / robot / questions。
 *
 * @param raw 原始节点
 * @param id 节点 id
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的 join 节点
 */
function parseJoinNode(
  raw: Record<string, unknown>,
  id: string,
  path: string,
  fail: FailFn,
): WorkflowNode {
  rejectOutputOnFixedNode(raw, path, fail)
  rejectModeOnFixedNode(raw, path, fail)
  if (raw.robot !== undefined) {
    fail(`${path}.robot`, 'is only supported on robot nodes')
  }
  if (raw.summary !== undefined) {
    fail(`${path}.summary`, 'is only supported on robot nodes')
  }
  if (raw.prompt !== undefined && raw.prompt !== null) {
    fail(
      `${path}.prompt`,
      'a join node does not carry a prompt; define it on the single outgoing edge',
    )
  }
  if (raw.questions !== undefined) {
    fail(`${path}.questions`, 'is only supported on user nodes')
  }

  // 入边是任务节点 id 列表：非空、去重、必须是合法节点 id（是否引用机器人节点
  // 由统一的引用检查负责，因为节点表在这里还没解析完）。
  const inputs: string[] = []
  if (!Array.isArray(raw.inputs) || raw.inputs.length === 0) {
    fail(`${path}.inputs`, 'must be a non-empty array of node ids this join waits for')
  } else {
    const seen = new Set<string>()
    raw.inputs.forEach((input: unknown, index) => {
      const inputPath = `${path}.inputs[${index}]`
      const name = typeof input === 'string' ? input.trim() : ''
      if (!NODE_ID_PATTERN.test(name)) {
        fail(inputPath, 'must be a valid node id')
      } else if (seen.has(name)) {
        fail(inputPath, `duplicate input "${name}"; a join cannot wait for the same node twice`)
      } else {
        seen.add(name)
        inputs.push(name)
      }
    })
  }

  // 出边恰好一条：join 是无条件放行，不需要 route name（下游进入指令在 prompt 上）。
  const next = parseEdgeList(raw.next, `${path}.next`, fail, { allowString: false })
  if (next.length !== 1) {
    fail(`${path}.next`, 'a join node needs exactly one outgoing edge')
  }
  return { id, type: 'join', inputs, next }
}
/**
 * @param raw 原始节点
 * @param id 节点 id
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的终止节点
 */
function parseEndNode(
  raw: Record<string, unknown>,
  id: string,
  path: string,
  fail: FailFn,
): WorkflowNode {
  rejectOutputOnFixedNode(raw, path, fail)
  rejectModeOnFixedNode(raw, path, fail)
  const status = typeof raw.status === 'string' ? raw.status : undefined
  if (raw.status !== undefined && (status === undefined || !END_STATUSES.has(status))) {
    fail(`${path}.status`, 'must be "completed", "failed" or "rejected"')
  }
  // 终止节点只表达运行以什么状态结束；它展示的「最终输出」来自这次运行最后一次
  // 机器人执行的落盘正文，不由定义写死。
  return {
    id,
    type: 'end',
    status:
      status !== undefined && END_STATUSES.has(status)
        ? (status as 'completed' | 'failed' | 'rejected')
        : 'completed',
  }
}
/**
 * 解析机器人节点可选使用的模型路由。
 *
 * @param raw 原始 agentOptions
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的模型路由；没有时是 `undefined`
 */
function parseAgentOptions(raw: unknown, path: string, fail: FailFn): AgentOptions | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isPlainObject(raw)) {
    fail(path, 'must be an object')
    return undefined
  }
  const allowed = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens'])
  const options: AgentOptions = {}
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      fail(`${path}.${key}`, 'is not a supported agent option')
      continue
    }
    const value = raw[key]
    if (key === 'maxTokens') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        fail(`${path}.${key}`, 'must be a positive integer')
      } else options.maxTokens = value
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${path}.${key}`, 'must be a non-empty string')
      continue
    }
    if (key === 'provider') options.provider = value.trim()
    else if (key === 'model') options.model = value.trim()
    else options.reasoningEffort = value.trim()
  }
  return Object.keys(options).length > 0 ? options : undefined
}
/**
 * 解析节点出口：边对象数组（省略表示没有出边）。
 *
 * 机器人节点、用户节点和 start 节点都不接受字符串简写；每条边上的 `name`
 * 是路由键，离开机器人 / 用户节点时必须唯一且非空。用户节点的边还额外要求
 * `label`（显示给用户的选项文字）唯一，并支持 `description`。
 *
 * @param raw 原始 next
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @param options 是否允许字符串简写、是否要求 name / label
 * @returns 规范化后的出边列表
 */
function parseEdgeList(
  raw: unknown,
  path: string,
  fail: FailFn,
  {
    allowString,
    requireNames = false,
    userEdges = false,
  }: { allowString: boolean; requireNames?: boolean; userEdges?: boolean },
): WorkflowEdge[] {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') {
    if (!allowString) {
      fail(
        path,
        'must be an array of edges { to, name, prompt }; the string shorthand was removed in workflow format 2',
      )
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
    fail(
      path,
      allowString
        ? 'must be a node id, an array of edges, or omitted'
        : 'must be an array of edges { to, name, prompt }',
    )
    return []
  }
  const rules: WorkflowEdge[] = []
  const names = new Set<string>()
  const labels = new Set<string>()
  raw.forEach((rule: unknown, index) => {
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
    const edge: WorkflowEdge = { to }
    parseEdgeExtras(edge, rule, rulePath, fail, userEdges)
    if (requireNames) {
      const rawName = rule.name
      const hasInvalidName =
        rawName !== undefined && rawName !== null && typeof rawName !== 'string'
      if (edge.name === undefined && !hasInvalidName) {
        fail(
          `${rulePath}.name`,
          userEdges
            ? 'every edge leaving a user node needs a unique non-empty name; it is the route key for this choice'
            : 'every edge leaving a robot node needs a unique non-empty name; the robot returns it as the JSON "next" route',
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
    if (userEdges) {
      const rawLabel = rule.label
      const hasInvalidLabel =
        rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string'
      if (edge.label === undefined && !hasInvalidLabel) {
        fail(
          `${rulePath}.label`,
          'every edge leaving a user node needs a non-empty label: the option text the user sees',
        )
      } else if (typeof edge.label === 'string') {
        if (labels.has(edge.label)) {
          fail(
            `${rulePath}.label`,
            `duplicate option label "${edge.label}" on the same node; the user choice must be unambiguous`,
          )
        } else {
          labels.add(edge.label)
        }
      }
    }
    rules.push(edge)
  })
  return rules
}
/**
 * 解析边上的可选字段：`name`（路由键 / 悬停展示）、`prompt`（进入目标节点时的
 * 提示词）、`tone`（成功 / 失败的外观色，纯展示），以及用户节点出边专用的
 * `label` / `description`。
 *
 * @param edge 正在构建的边
 * @param raw 原始边对象
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @param userEdges 是否允许用户节点的选项字段
 * @returns 同一个边对象
 */
function parseEdgeExtras(
  edge: WorkflowEdge,
  raw: Record<string, unknown>,
  path: string,
  fail: FailFn,
  userEdges = false,
): WorkflowEdge {
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

  // tone 只是运行页的线色：校验它只是为了拼错时能被发现，执行链路上没有消费者。
  if (raw.tone !== undefined && raw.tone !== null) {
    const tone = typeof raw.tone === 'string' ? raw.tone.trim() : ''
    if (!EDGE_TONES.has(tone)) fail(`${path}.tone`, 'must be "success" or "failure"')
    else edge.tone = 'success' === tone ? 'success' : 'failure'
  }

  if (!userEdges && (raw.label !== undefined || raw.description !== undefined)) {
    fail(`${path}.label`, 'label / description are only supported on edges leaving a user node')
    return edge
  }
  if (userEdges) {
    if (raw.label !== undefined && raw.label !== null && typeof raw.label !== 'string') {
      fail(`${path}.label`, 'must be a string')
    } else if (typeof raw.label === 'string') {
      const label = raw.label.trim()
      if (label === '') fail(`${path}.label`, 'must be a non-empty label')
      else if (label.length > MAX_OPTION_LABEL_LENGTH) {
        fail(`${path}.label`, `must be at most ${MAX_OPTION_LABEL_LENGTH} characters`)
      } else {
        edge.label = label
      }
    }
    if (
      raw.description !== undefined &&
      raw.description !== null &&
      typeof raw.description !== 'string'
    ) {
      fail(`${path}.description`, 'must be a string')
    } else if (typeof raw.description === 'string' && raw.description.trim() !== '') {
      const description = raw.description.trim()
      if (description.length > MAX_OPTION_DESCRIPTION_LENGTH) {
        fail(`${path}.description`, `must be at most ${MAX_OPTION_DESCRIPTION_LENGTH} characters`)
      } else {
        edge.description = description
      }
    }
  }
  return edge
}
/**
 * start / user / end 节点的输出由引擎定义，不接受 `output`。
 *
 * @param raw 原始节点
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 */
function rejectOutputOnFixedNode(raw: Record<string, unknown>, path: string, fail: FailFn): void {
  if (raw.output === undefined) return
  fail(
    `${path}.output`,
    'is only supported on robot nodes; start, user and end nodes have fixed outputs',
  )
}
/**
 * 会话模式只属于机器人节点：其它节点的执行由引擎定义，不接受 `mode`。
 *
 * @param raw 原始节点
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 */
function rejectModeOnFixedNode(raw: Record<string, unknown>, path: string, fail: FailFn): void {
  if (raw.mode === undefined) return
  fail(`${path}.mode`, 'is only supported on robot nodes')
}
/**
 * 收集所有需要做模板引用校验的文本：边 prompt 与用户节点的 detail。
 *
 * @param nodes 节点表
 * @param order 节点声明顺序
 * @returns 需要校验的模板文本
 */
function promptTemplates(nodes: Map<string, WorkflowNode>, order: string[]): PromptTemplate[] {
  const templates: PromptTemplate[] = []
  for (const [index, id] of order.entries()) {
    const node = nodes.get(id)
    for (const [ruleIndex, rule] of (node?.next ?? []).entries()) {
      if (typeof rule.prompt !== 'string' || rule.prompt === '') continue
      templates.push({ template: rule.prompt, path: `nodes[${index}].next[${ruleIndex}].prompt` })
    }
    if (node?.type === 'user' && typeof node.detail === 'string' && node.detail !== '') {
      templates.push({ template: node.detail, path: `nodes[${index}].detail` })
    }
  }
  return templates
}
/**
 * 校验边 prompt 与用户节点 detail 里的模板变量。
 *
 * 只检查「引用的节点存在、字段在目标节点的 output / 用户回答里、节点类型匹配」，
 * 不推断这个节点在这条边上是否已经执行过——那属于运行时。
 *
 * @param nodes 节点表
 * @param templates 需要校验的模板文本
 * @param fail 记录错误的回调
 */
function validatePromptReferences(
  nodes: Map<string, WorkflowNode>,
  templates: PromptTemplate[],
  fail: FailFn,
): void {
  for (const { template, path } of templates) {
    const inspected = inspectTemplate(template)
    if (inspected.errors.length > 0) {
      for (const message of inspected.errors) fail(path, message)
      continue
    }
    for (const placeholder of inspected.paths) {
      const problem = referenceProblem(nodes, placeholder)
      if (problem !== null) fail(path, problem)
    }
  }
}
/**
 * 单个模板路径的引用检查。
 *
 * @param nodes 节点表
 * @param path 模板路径
 * @returns 没有问题时为 `null`，否则是可以拼进错误信息的原因片段
 */
function referenceProblem(nodes: Map<string, WorkflowNode>, path: string): string | null {
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

  const id = segments[1] as string
  const node = nodes.get(id)
  if (node === undefined) {
    return `template path "${path}" references unknown node "${id}"`
  }
  if (node.type === 'join') {
    return `template path "${path}" references join node "${id}", which provides no output; a join is a pure barrier`
  }

  const field = segments[2] as string
  const rest = segments.slice(3)
  const robotOnly = () => `template path "${path}" reads "${field}", which only robot nodes provide`
  const userOnly = () => `template path "${path}" reads "${field}", which only user nodes provide`

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

  if (field === 'answers') {
    if (node.type !== 'user') return userOnly()
    if (rest.length === 0) return null
    const questionId = rest[0] as string
    const declared = new Set(
      (Array.isArray(node.questions) ? node.questions : []).map((question) => question.id),
    )
    const hasRoute = Array.isArray(node.next) && node.next.length > 0
    if (questionId === ROUTE_QUESTION_ID) {
      if (!hasRoute) {
        return `template path "${path}" reads the reserved route answer, but node "${id}" has no choices`
      }
    } else if (!declared.has(questionId)) {
      const available = [hasRoute ? ROUTE_QUESTION_ID : null, ...declared].filter(Boolean)
      return `template path "${path}" references unknown question id "${questionId}" on node "${id}"; available: ${available.join(', ')}`
    }
    if (rest.length === 1) return null
    if (rest[1] !== 'selected' && rest[1] !== 'custom') {
      return `template path "${path}" reads "${rest[1]}", which is not an answer field; use .selected or .custom`
    }
    if (rest.length > 2) {
      return `template path "${path}" descends into "${rest[1]}", which is not an object`
    }
    return null
  }

  if (field === 'text' || field === 'route') {
    if (node.type !== 'robot' && node.type !== 'user') {
      return `template path "${path}" reads "${field}", which only robot and user nodes provide`
    }
    if (rest.length > 0)
      return `template path "${path}" descends into "${field}", which is not an object`
    return null
  }
  if (field === 'robot' || field === 'sessionId') {
    if (node.type !== 'robot') return robotOnly()
    if (rest.length > 0)
      return `template path "${path}" descends into "${field}", which is not an object`
    return null
  }
  if (field === 'decision') {
    return (
      'template path "' +
      path +
      '" reads "decision" from the removed gate node; use a user node and read {{nodes.<id>.route}} / {{nodes.<id>.answers.<questionId>...}}'
    )
  }
  return `template path "${path}" uses unknown node output "${field}"; available: text, data, route, attachments, robot, sessionId (robot), text, route, answers (user)`
}
/**
 * 读取可选正整数。
 *
 * @param raw 原始值
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @param max 上限
 * @returns 合法时是正整数，否则 `undefined`
 */
function parsePositiveInteger(
  raw: unknown,
  path: string,
  fail: FailFn,
  max: number,
): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    fail(path, 'must be a positive integer')
    return undefined
  }
  if (raw > max) {
    fail(path, `must be at most ${max}`)
    return max
  }
  return raw
}
