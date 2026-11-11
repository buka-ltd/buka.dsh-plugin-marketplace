/**
 * 工作流运行期的纯函数与错误类型（workflow format 3）。
 *
 * 这些工具从旧的阻塞执行器 `engine.js` 里搬出来，供 Host 侧观察者
 * `supervisor.js` 复用：渲染机器人节点的提示词、给机器人会话起标题、构造用户
 * 介入节点的提问批次与解析回答、把运行记录转成工具返回值等。本模块不 import
 * 任何 DSH 包，也不读写磁盘，便于单测。
 *
 * format 3 里机器人节点没有自己的 prompt：每次进入都渲染「进入它的那条边」上的
 * prompt，所以 `renderNodePrompt` 只接受 edgePrompt 一个来源；用户节点则把
 * `detail` 渲染后交给原生提问卡，用户的选项就是出边。
 *
 * @module @buka/dsh-plugin-workflows/run
 */

import { ROUTE_QUESTION_ID } from './definition.js'
import { renderOutputContract } from './output.js'
import { renderTemplate } from './template.js'

/** 运行级错误：节点失败、超出步数、缺少服务等。 */
export class WorkflowRunError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message)
    this.name = 'WorkflowRunError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/** 运行被取消。 */
export class WorkflowCancelledError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'WorkflowCancelledError'
  }
}

/**
 * 渲染一个机器人节点的最终提示词。
 *
 * format 2 只在进入节点的边上定义 prompt：`edgePrompt` 必须存在，渲染后也不能为
 * 空；不存在节点自身 prompt 的兼容回退。渲染完成后追加节点声明的结果契约
 * （`output` 合并 `next` 与附件能力后的 schema）；升级前没有 `output` 的快照
 * 不追加，保持旧提示词。
 *
 * @param {Record<string, any>} node 已规范化的机器人节点
 * @param {string | null} edgePrompt 走到进入这条边时携带的 prompt 模板
 * @param {Record<string, any>} values 已完成节点的结果，供 `{{nodes.<id>...}}` 引用
 * @param {{ goal?: string }} plan
 * @param {number} step
 * @param {string} runId
 * @returns {string}
 */
export function renderNodePrompt(node, edgePrompt, values, plan, step, runId) {
  if (typeof edgePrompt !== 'string' || edgePrompt === '') {
    throw new WorkflowRunError(`robot node "${node.id}" has no prompt on its incoming edge`)
  }
  const prompt = renderTemplate(edgePrompt, {
    goal: plan.goal,
    nodes: values,
    step,
    runId,
  })
  if (prompt.trim() === '') {
    throw new WorkflowRunError(`robot node "${node.id}" has no prompt on its incoming edge`)
  }
  const contract = renderOutputContract(node)
  return contract === '' ? prompt : `${prompt}\n\n${contract}`
}

/**
 * 渲染用户节点的说明（`detail`）。说明可以引用前面节点的文本 / 结构化结果 /
 * 用户回答；为空时返回空串，调用方在提问卡里退回 `title`。
 *
 * @param {Record<string, any>} node
 * @param {Record<string, any>} values 已完成节点的结果，供 `{{nodes.<id>...}}` 引用
 * @param {{ goal?: string }} plan
 * @param {number} step
 * @param {string} runId
 * @returns {string}
 */
export function renderUserDetail(node, values, plan, step, runId) {
  const template = typeof node.detail === 'string' ? node.detail : ''
  if (template.trim() === '') return ''
  return renderTemplate(template, {
    goal: plan.goal,
    nodes: values,
    step,
    runId,
  })
}

/**
 * DSH 会话标题的 UTF-8 字节上限（与 `session-title` 服务的 `maxTitleBytes` 一致）。
 */
export const SESSION_TITLE_MAX_BYTES = 80

/**
 * 机器人会话的标题：`运行目标 · 机器人`。
 *
 * 机器人会话的第一条用户消息来源是 `buka-robot`，DSH 的自动标题只看 `user`
 * 来源的消息，所以不会给这类会话生成标题。工作流在进入节点时显式命名，
 * 侧边栏里才能一眼看出这段对话属于哪次运行、哪个机器人。
 *
 * 标题按 UTF-8 字节裁剪：机器人名优先保留，运行目标裁到剩余预算里；运行没有
 * goal 时退回 `工作流 <runId>`。
 *
 * @param {{ goal?: unknown, runId?: unknown }} run
 * @param {{ robot?: unknown }} node
 * @returns {string}
 */
export function robotSessionTitle(run, node) {
  const robot = typeof node?.robot === 'string' ? node.robot.trim() : ''
  const goal = typeof run?.goal === 'string' ? run.goal.replace(/\s+/gu, ' ').trim() : ''
  const runId = typeof run?.runId === 'string' ? run.runId.trim() : ''
  const base = goal !== '' ? goal : runId !== '' ? `工作流 ${runId}` : '工作流'
  if (robot === '') return clipUtf8(base, SESSION_TITLE_MAX_BYTES)
  const suffix = ` · ${robot}`
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  if (suffixBytes >= SESSION_TITLE_MAX_BYTES) return clipUtf8(robot, SESSION_TITLE_MAX_BYTES)
  const clipped = clipUtf8(base, SESSION_TITLE_MAX_BYTES - suffixBytes).trimEnd()
  return clipped === '' ? clipUtf8(robot, SESSION_TITLE_MAX_BYTES) : `${clipped}${suffix}`
}

/**
 * 按 UTF-8 字节裁剪，不切断码点。
 *
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
export function clipUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let used = 0
  let output = ''
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/**
 * 用户节点问题批次里的 route 问题 id：用户的选项就是节点的出边。
 *
 * @param {Record<string, any>} node
 * @param {string} detail 已渲染的说明（为空时用 title 作为问题正文）
 * @returns {Array<Record<string, any>>} 传给 ctx.userQuestions.ask() 的问题数组
 */
export function buildUserQuestions(node, detail) {
  /** @type {Array<Record<string, any>>} */
  const questions = []
  const edges = Array.isArray(node.next) ? node.next : []
  if (edges.length > 0) {
    questions.push({
      id: ROUTE_QUESTION_ID,
      header: node.title,
      question: typeof detail === 'string' && detail.trim() !== '' ? detail.trim() : node.title,
      options: edges.map((edge) =>
        typeof edge.description === 'string' && edge.description !== ''
          ? { label: edge.label, description: edge.description }
          : { label: edge.label },
      ),
    })
  }
  for (const question of Array.isArray(node.questions) ? node.questions : []) {
    /** @type {Record<string, any>} */
    const item = { id: question.id, question: question.question }
    if (typeof question.header === 'string' && question.header !== '') item.header = question.header
    if (Array.isArray(question.options) && question.options.length > 0) {
      item.options = question.options.map((option) =>
        typeof option.description === 'string' && option.description !== ''
          ? { label: option.label, description: option.description }
          : { label: option.label },
      )
    }
    if (question.multiSelect === true) item.multiSelect = true
    questions.push(item)
  }
  return questions
}

/**
 * 解析用户节点的回答。
 *
 * 返回 `{ ok: true, route, answers, text }`；`route` 是选中的出边（没有出边时为
 * null）。用户没有做出选择（跳过 / 只写了自定义文本）时返回
 * `{ cancelled: true, answers, text }`，让运行以 cancelled 结束。答案是
 * `{ id, selected, custom }` 数组，`custom` 缺省补空串，方便模板直接取值。
 *
 * @param {Record<string, any>} node
 * @param {{ answers?: Array<{ id?: unknown, selected?: unknown, custom?: unknown }> }} answer
 * @returns {{ ok: boolean, cancelled?: boolean, error?: string, route?: Record<string, any> | null, answers: Array<{ id: string, selected: string[], custom: string }>, text: string }}
 */
export function resolveUserAnswer(node, answer) {
  const received = new Map()
  for (const item of Array.isArray(answer?.answers) ? answer.answers : []) {
    if (typeof item?.id !== 'string') continue
    const selected = Array.isArray(item.selected)
      ? item.selected.filter((label) => typeof label === 'string' && label !== '')
      : []
    const custom = typeof item.custom === 'string' ? item.custom.trim() : ''
    received.set(item.id, { selected, custom })
  }

  /** @type {Array<{ id: string, selected: string[], custom: string }>} */
  const answers = []
  const edges = Array.isArray(node.next) ? node.next : []
  let route = null
  let cancelled = false
  const lines = []

  if (edges.length > 0) {
    const raw = received.get(ROUTE_QUESTION_ID) ?? { selected: [], custom: '' }
    answers.push({ id: ROUTE_QUESTION_ID, selected: [...raw.selected], custom: '' })
    if (raw.selected.length === 0) {
      cancelled = true
    } else if (raw.selected.length > 1) {
      return {
        ok: false,
        error: `the route choice must be a single option, received ${raw.selected.length}`,
        answers,
        text: '',
      }
    } else {
      const label = raw.selected[0]
      const edge = edges.find((item) => item.label === label)
      if (edge === undefined) {
        return { ok: false, error: `received an unknown choice "${label}"`, answers, text: '' }
      }
      route = edge
      lines.push(`选择：${label}`)
    }
  }

  for (const question of Array.isArray(node.questions) ? node.questions : []) {
    const raw = received.get(question.id) ?? { selected: [], custom: '' }
    answers.push({ id: question.id, selected: [...raw.selected], custom: raw.custom })
    const heading = question.header !== '' ? question.header : question.question
    const parts = []
    if (raw.selected.length > 0) parts.push(raw.selected.join('、'))
    if (raw.custom !== '') parts.push(`（${raw.custom}）`)
    if (parts.length > 0) lines.push(`${heading}：${parts.join('')}`)
  }

  return {
    ok: true,
    cancelled,
    route,
    answers,
    text: cancelled && edges.length > 0 ? '' : lines.join('\n'),
  }
}

/**
 * 把规范化后的答案数组转成按问题 id 索引的对象（模板 / 运行记录用）。
 *
 * @param {Array<{ id: string, selected: string[], custom: string }>} answers
 * @returns {Record<string, { selected: string[], custom: string }>}
 */
export function answersValue(answers) {
  /** @type {Record<string, { selected: string[], custom: string }>} */
  const value = {}
  for (const answer of answers) {
    value[answer.id] = { selected: [...answer.selected], custom: answer.custom }
  }
  return value
}

/**
 * 把运行记录转成工具返回值（不携带完整节点文本）。
 *
 * @param {Record<string, any>} run
 * @returns {Record<string, any>}
 */
export function toToolRun(run) {
  return {
    runId: run.runId,
    seq: Number.isInteger(run.seq) ? run.seq : null,
    status: run.status,
    goal: run.goal,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? null,
    current: run.current ?? null,
    active: Array.isArray(run.active) ? run.active.map((entry) => ({ ...entry })) : [],
    pendingUser: run.pendingUser ?? null,
    pendingInteraction: run.pendingInteraction ?? null,
    sessions: Array.isArray(run.sessions) ? run.sessions.map((session) => ({ ...session })) : [],
    steps: Array.isArray(run.steps) ? run.steps.map((step) => ({ ...step })) : [],
    result: run.result ?? null,
    error: run.error ?? null,
  }
}
