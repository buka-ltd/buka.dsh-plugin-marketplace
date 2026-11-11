/**
 * 工具结果与错误的展示文本：工具输出收口、计划 / 运行 / 状态等渲染。
 */

import type { DefinitionIssue } from './definition.ts'
import type { WorkflowTemplate } from './templates.ts'
import { describeTemplate } from './templates.ts'

/** 工具输出会经过 JSON 序列化；这里按 JSON 的形状收口。 */
export type ToolJsonValue =
  | null
  | boolean
  | number
  | string
  | ToolJsonValue[]
  | { [key: string]: ToolJsonValue }

/** 把运行时值收口成工具输出接受的 JSON 形状（值本身已经是可序列化的）。 */
export function jsonValue(value: unknown): ToolJsonValue {
  return value as ToolJsonValue
}

/** 判断普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/**
 * 定义错误的单行文本。
 *
 * @param errors 定义错误列表
 * @returns 单行文本
 */
export function formatErrors(errors: DefinitionIssue[]): string {
  return errors.map((error) => `${error.path}: ${error.message}`).join('; ')
}
/**
 * `buka_workflow_plan` 的展示文本。
 *
 * @param value 工具返回值
 * @returns 展示文本
 */
export function renderPlanResult(value: unknown): string {
  const record = isRecord(value) ? value : {}
  const errors = Array.isArray(record.errors) ? record.errors : []
  const warnings = Array.isArray(record.warnings) ? record.warnings : []
  if (record.ok !== true) {
    const lines = [
      `workflow definition is invalid (${errors.length} error${errors.length === 1 ? '' : 's'}):`,
    ]
    for (const rawError of errors) {
      const error = isRecord(rawError) ? rawError : {}
      lines.push(`- ${String(error.path)}: ${String(error.message)}`)
    }
    for (const warning of warnings) lines.push(`! ${String(warning)}`)
    return lines.join('\n')
  }
  const summary = isRecord(record.summary) ? record.summary : {}
  const nodes = Array.isArray(summary.nodes) ? summary.nodes : []
  const lines = [
    `workflow definition is valid: start=${String(summary.start)}, ${nodes.length} node${nodes.length === 1 ? '' : 's'}, maxSteps=${String(summary.maxSteps)}`,
  ]
  if (typeof summary.goal === 'string' && summary.goal !== '') lines.push(`goal: ${summary.goal}`)
  for (const rawNode of nodes) {
    const node = isRecord(rawNode) ? rawNode : {}
    const robot = node.robot === undefined ? '' : ` robot=${String(node.robot)}`
    const title = typeof node.title === 'string' && node.title !== '' ? ` "${node.title}"` : ''
    const routes = Array.isArray(node.routes)
      ? node.routes
          .map((rawRoute) => {
            if (typeof rawRoute === 'string') return rawRoute
            const route = isRecord(rawRoute) ? rawRoute : {}
            return `${String(route.name ?? '')}: ${String(route.label ?? '')}`
          })
          .filter((route) => route !== '')
      : []
    const questions = Array.isArray(node.questions)
      ? node.questions.filter((id) => typeof id === 'string' && id !== '')
      : []
    const detail = [
      routes.length === 0 ? '' : ` routes=${routes.join(' | ')}`,
      questions.length === 0 ? '' : ` questions=${questions.join(' | ')}`,
    ].join('')
    lines.push(`- ${String(node.id)} [${String(node.type)}${robot}]${title}${detail}`)
  }
  for (const warning of warnings) lines.push(`! ${String(warning)}`)
  return lines.join('\n')
}
/**
 * 运行的序号标签：`#12 `；旧记录没有序号时是空串。
 *
 * @param run 运行记录（只读 seq）
 * @returns 序号标签
 */
function runSeqLabel(run: unknown): string {
  const record = isRecord(run) ? run : {}
  return typeof record.seq === 'number' && Number.isInteger(record.seq) && record.seq > 0
    ? `#${record.seq} `
    : ''
}
/**
 * 一次运行的展示文本。
 *
 * @param run 运行记录
 * @returns 展示文本
 */
export function renderRun(run: unknown): string {
  if (run === null || run === undefined) return 'No workflow run was recorded.'
  const record = isRecord(run) ? run : {}
  const lines = [
    `workflow ${runSeqLabel(record)}${String(record.runId)} — ${String(record.status)}`,
  ]
  if (typeof record.goal === 'string' && record.goal !== '') lines.push(`goal: ${record.goal}`)
  const steps = Array.isArray(record.steps) ? record.steps : []
  if (steps.length === 0) lines.push('no steps completed')
  for (const rawStep of steps) {
    const step = isRecord(rawStep) ? rawStep : {}
    const robot = typeof step.robot === 'string' && step.robot !== '' ? ` robot=${step.robot}` : ''
    const session =
      typeof step.sessionId === 'string' && step.sessionId !== ''
        ? ` session=${step.sessionId}`
        : ''
    const reason = typeof step.stopReason === 'string' ? ` (${step.stopReason})` : ''
    const route = typeof step.route === 'string' && step.route !== '' ? ` route=${step.route}` : ''
    const attachments =
      Array.isArray(step.attachments) && step.attachments.length > 0
        ? ` attachments=${step.attachments.length}`
        : ''
    lines.push(
      `- ${String(step.nodeId)} [${String(step.type)}${robot}] ${String(step.status)}${reason}${route}${attachments}${session}`,
    )
  }
  if (record.result !== null && record.result !== undefined) {
    lines.push(`result: ${JSON.stringify(record.result)}`)
  }
  if (typeof record.error === 'string' && record.error !== '') lines.push(`error: ${record.error}`)
  if (record.pendingUser !== null && record.pendingUser !== undefined) {
    const pendingUser = isRecord(record.pendingUser) ? record.pendingUser : {}
    lines.push(`waiting at user node: ${String(pendingUser.title ?? pendingUser.nodeId)}`)
  }
  if (record.pendingInteraction !== null && record.pendingInteraction !== undefined) {
    const pending = isRecord(record.pendingInteraction) ? record.pendingInteraction : {}
    const session = typeof pending.sessionId === 'string' ? ` in session ${pending.sessionId}` : ''
    if (pending.kind === 'approval') {
      const reason =
        typeof pending.reason === 'string' && pending.reason !== '' ? `: ${pending.reason}` : ''
      lines.push(
        `waiting for the user to approve ${String(pending.toolName ?? 'a tool')}${session}${reason}`,
      )
    } else {
      const first = Array.isArray(pending.questions) ? pending.questions[0] : null
      const question = isRecord(first) ? first : {}
      const text = question.question || question.header || ''
      lines.push(
        `waiting for the user to answer${session}${text === '' ? '' : `: ${String(text)}`}`,
      )
    }
  }
  return lines.join('\n')
}
/**
 * `buka_workflow_start` 的展示文本：后台运行只报 runId，前台运行给出终态摘要。
 *
 * @param value 工具返回值
 * @returns 展示文本
 */
export function renderStart(value: unknown): string {
  const record = isRecord(value) ? value : {}
  if (record.mode === 'background') {
    const label =
      typeof record.seq === 'number' && Number.isInteger(record.seq) && record.seq > 0
        ? `#${record.seq} `
        : ''
    return [
      `workflow ${label}${String(record.runId)} started in the background`,
      'the host observer keeps scheduling node sessions; follow it with buka_workflow_status or the sidebar page',
    ].join('\n')
  }
  return renderRun(record.run ?? null)
}
/**
 * `buka_workflow_cancel` 的展示文本。
 *
 * @param value 工具返回值
 * @returns 展示文本
 */
export function renderCancel(value: unknown): string {
  const record = isRecord(value) ? value : {}
  const run = isRecord(record.run) ? record.run : null
  if (record.cancelled === true)
    return `workflow ${String(run?.runId ?? '')} cancellation signalled`
  if (run === null) return 'No workflow run was found.'
  return `workflow ${String(run.runId)} is not live (status: ${String(run.status)}); nothing to cancel`
}
/**
 * `buka_workflow_templates` 的展示文本：无 id 时列目录，有 id 时给一份模板的
 * 可读流程。
 *
 * @param value 工具返回值
 * @returns 展示文本
 */
export function renderTemplates(value: unknown): string {
  const record = isRecord(value) ? value : {}
  const template = isRecord(record.template) ? record.template : null
  if (template !== null) {
    return describeTemplate(template as unknown as WorkflowTemplate)
  }
  const templates = Array.isArray(record.templates) ? record.templates : []
  if (templates.length === 0) return 'No workflow templates are available.'
  const lines = ['workflow template catalog (abstract reference, not runnable definitions):']
  for (const rawTemplate of templates) {
    const entry = isRecord(rawTemplate) ? rawTemplate : {}
    lines.push(`- ${String(entry.id)} — ${String(entry.name)}: ${String(entry.description)}`)
  }
  lines.push(
    'pass an id to read one template in full; map its abstract roles to real robots before starting.',
  )
  return lines.join('\n')
}
/**
 * `buka_workflow_status` 的展示文本。
 *
 * @param value 工具返回值
 * @returns 展示文本
 */
export function renderStatus(value: unknown): string {
  const record = isRecord(value) ? value : {}
  if (record.run !== null && record.run !== undefined) return renderRun(record.run)
  const runs = Array.isArray(record.runs) ? record.runs : []
  if (runs.length === 0) return 'No workflow runs have been recorded yet.'
  const lines = ['recent workflow runs:']
  for (const rawRun of runs) {
    const run = isRecord(rawRun) ? rawRun : {}
    const finished =
      run.finishedAt === null || run.finishedAt === undefined
        ? 'running'
        : new Date(run.finishedAt as number).toISOString()
    const waiting = run.waitingForUser === true ? ' · waiting for user' : ''
    lines.push(
      `- ${runSeqLabel(run)}${String(run.runId)} ${String(run.status)}${waiting} (${finished})${run.goal ? ` — ${String(run.goal)}` : ''}`,
    )
  }
  return lines.join('\n')
}
/**
 * @param error 任意错误
 * @returns 一句话错误
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
