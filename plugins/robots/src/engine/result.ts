/**
 * 机器人会话的结构化结果：JSON 解析、结果校验与重试话术。
 *
 * 每个机器人节点都必须交回一个 JSON 对象（scoped 的 `structured_output` 工具
 * 或回复正文里的 JSON 都算）；没有交回时由这里生成原会话里的追问文案。文案
 * 属于对模型说的话，改动会直接影响节点成功率，所以与编排逻辑分开放。
 *
 * @module @buka/dsh-plugin-robots/engine/result
 */

import type { SessionLike } from '../service/types.ts'

/** 默认重试次数：机器人没有交回结构化 JSON 结果时，在原会话里再要求几次。 */
export const DEFAULT_RESULT_RETRIES = 2

/** 提交结构化结果时使用的工具名（由本服务注册 scoped 工具）。 */
export const STRUCTURED_OUTPUT_TOOL = 'structured_output'

/** 没有给 `outputSchema` 时的宽松对象 schema：仍要求交回一个 JSON 对象。 */
const DEFAULT_OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

/**
 * 机器人没有交回结构化 JSON 结果时，注入原会话的重试提示：说清这次的问题
 * （缺 JSON / 缺 `next` / `next` 不是合法路由 / 结果不匹配 output / abort 形态
 * 不合法），列出合法路由名，并在允许主动终止时再次给出 `abort` 出口。
 *
 */
export function resultRetryPrompt(
  attempt: number,
  maxAttempts: number,
  options: {
    toolName?: string | undefined
    routes?: string[] | undefined
    abortable?: boolean | undefined
    detail?: string | undefined
    reason?:
      | 'missing-json'
      | 'missing-next'
      | 'invalid-next'
      | 'invalid-output'
      | 'invalid-abort'
      | 'ambiguous-result'
      | string
      | undefined
  } = {},
): string {
  const toolName = typeof options.toolName === 'string' ? options.toolName : STRUCTURED_OUTPUT_TOOL
  const routes = routeNames(options.routes)
  const abortable = options.abortable === true
  const reason = typeof options.reason === 'string' ? options.reason : 'missing-json'
  const detail = typeof options.detail === 'string' ? options.detail.trim() : ''
  const problem =
    reason === 'missing-next'
      ? 'your last JSON result did not include the required `next` route'
      : reason === 'invalid-next'
        ? 'the `next` route in your last JSON result is not one of the routes this node can follow'
        : reason === 'invalid-output'
          ? 'the JSON object in your last result does not match the output schema declared for this node'
          : reason === 'invalid-abort'
            ? 'the `abort` field in your last JSON result must be a non-empty string explaining why you cannot complete the task'
            : reason === 'ambiguous-result'
              ? 'your last JSON result included both `next` and `abort`; submit exactly one of them'
              : 'your last answer did not provide a structured JSON result'
  let text =
    `The workflow orchestrator expected the final result of this node as a single JSON object, but ${problem}. ` +
    `Do not reply with plain text again: finish now by calling the ${toolName} tool with a single JSON object that answers the assigned task.`
  if (detail !== '') text += ` Problem: ${detail}.`
  if (routes.length > 0) {
    const routeList = routes.map((route) => `"${route}"`).join(', ')
    text += abortable
      ? ` When this node has outgoing routes, include exactly one of \`next\` (one of ${routeList}) and \`abort\`.`
      : ' When this node has outgoing routes, the object MUST include `next` set to exactly one of these route names: ' +
        `${routeList}.`
  }
  if (abortable) {
    text +=
      " If you cannot complete this node's task, do not pick a route you do not believe in: set `abort` to a short non-empty reason instead; the workflow ends and the run is recorded as failed."
  }
  text += ` This is retry ${attempt}/${maxAttempts}.`
  return text
}

/**
 * 重试用尽后的错误文案。
 *
 */
export function resultFailureMessage(retries: number): string {
  const suffix =
    retries > 0 ? ` after ${retries} retr${retries === 1 ? 'y' : 'ies'} in the same session` : ''
  return `the robot session did not submit a structured JSON result${suffix}`
}

/**
 * 从会话的最后一条回复里解析 JSON 对象；支持 ```json 代码块。
 *
 */
export function parseStructuredText(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== 'string') return undefined
  let body = text.trim()
  if (body === '') return undefined
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(body)
  if (fenced !== null) body = fenced[1]?.trim() ?? ''
  if (!body.startsWith('{')) return undefined
  try {
    const value = JSON.parse(body)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value
  } catch {
    // 不是合法 JSON：交给重试消息处理。
  }
  return undefined
}

/**
 * 会话里是否已经成功提交过结构化结果（根据 `structured_output` 的调用与结果事件）。
 *
 */
export function structuredSubmittedSince(
  session: SessionLike | undefined,
  startSeq: number = 0,
): boolean {
  const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
  const callIds = new Set<string>()
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < startSeq) continue
    if (event?.type !== 'tool/call') continue
    if (event?.data?.name !== STRUCTURED_OUTPUT_TOOL) continue
    if (typeof event.data.callId === 'string') callIds.add(event.data.callId)
  }
  if (callIds.size === 0) return false
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq < startSeq) continue
    if (event?.type !== 'tool/result') continue
    const data = event.data
    const message = data?.message
    const callId =
      typeof message?.toolCallId === 'string'
        ? message.toolCallId
        : typeof data?.toolCallId === 'string'
          ? data.toolCallId
          : typeof message?.source?.callId === 'string'
            ? message.source.callId
            : ''
    if (callId === '' || !callIds.has(callId)) continue
    if (message?.isError === true) continue
    return true
  }
  return false
}

/**
 * 调用方给的 `outputSchema` 直接作为 `structured_output` 的 parameters；没给
 * （或不是对象）时退回宽松对象 schema，仍然要求交回一个 JSON 对象。
 *
 */
export function normalizeOutputSchema(schema: unknown): Record<string, unknown> {
  if (schema !== null && typeof schema === 'object' && !Array.isArray(schema)) {
    // 调用方给的是 JSON schema 对象；运行时形状由 dsh-tools 校验。
    return schema as Record<string, unknown>
  }
  return DEFAULT_OUTPUT_SCHEMA
}

/**
 * 规范化路由名列表：只保留非空字符串并去重。
 *
 */
function routeNames(routes: unknown): string[] {
  if (!Array.isArray(routes)) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const route of routes) {
    if (typeof route !== 'string') continue
    const name = route.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}
