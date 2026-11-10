/**
 * 工作流运行期的纯函数与错误类型（workflow format 2）。
 *
 * 这些工具从旧的阻塞执行器 `engine.js` 里搬出来，供 Host 侧观察者
 * `supervisor.js` 复用：渲染机器人节点的提示词、给机器人会话起标题、门禁审批
 * 结果映射、把运行记录转成工具返回值等。本模块不 import 任何 DSH 包，也不读写
 * 磁盘，便于单测。
 *
 * format 2 里机器人节点没有自己的 prompt：每次进入都渲染「进入它的那条边」上的
 * prompt，所以 `renderNodePrompt` 只接受 edgePrompt 一个来源。
 *
 * @module @buka/dsh-plugin-workflows/run
 */

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
 * 审批结果映射。
 *
 * @param {unknown} outcome
 * @returns {'approved' | 'rejected' | 'cancelled' | 'unavailable'}
 */
export function mapApproval(outcome) {
  switch (outcome) {
    case 'allowed-once':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unavailable'
  }
}

/**
 * 审批框里展示的原因。
 *
 * @param {Record<string, any>} node
 * @returns {string}
 */
export function gateReason(node) {
  const detail = typeof node.detail === 'string' && node.detail.trim() !== '' ? `：${node.detail.trim()}` : ''
  return `工作流门禁「${node.title}」正在等待授权${detail}`
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
    pendingGate: run.pendingGate ?? null,
    pendingInteraction: run.pendingInteraction ?? null,
    sessions: Array.isArray(run.sessions) ? run.sessions.map((session) => ({ ...session })) : [],
    steps: Array.isArray(run.steps) ? run.steps.map((step) => ({ ...step })) : [],
    result: run.result ?? null,
    error: run.error ?? null,
  }
}
