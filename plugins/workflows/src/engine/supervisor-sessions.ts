/**
 * 运行记录里的机器人会话台账：节点进入 / 结果摘要与会话索引的读写工具。
 */

import type { WorkflowRobotSession, WorkflowRunRecord } from '../run-store.ts'
import { isRecord } from './supervisor-types.ts'

/**
 * 只保留运行页展示需要的问题字段，并限制体积。
 *
 * @param questions
 * @returns
 */
export function normalizeQuestions(questions: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(questions)) return []
  return (questions as unknown[])
    .slice(0, 5)
    .map((rawQuestion) => {
      const question = isRecord(rawQuestion) ? rawQuestion : {}
      return {
        id: clipText(question.id, 64),
        header: clipText(question.header, 200),
        question: clipText(question.question, 1000),
        multiSelect: question.multiSelect === true,
        options: Array.isArray(question.options)
          ? (question.options as unknown[]).slice(0, 20).map((rawOption) => {
              const option = isRecord(rawOption) ? rawOption : {}
              return { label: clipText(option.label, 200) }
            })
          : [],
      }
    })
    .filter((question) => question.question !== '' || question.header !== '')
}

/**
 * @param value
 * @param max
 * @returns
 */
export function clipText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > max ? text.slice(0, max) : text
}

/**
 * @param run
 * @param robot
 * @returns
 */
export function findRobotSession(
  run: WorkflowRunRecord,
  robot: unknown,
): WorkflowRobotSession | undefined {
  if (!Array.isArray(run?.sessions) || typeof robot !== 'string' || robot === '') return undefined
  return run.sessions.find((entry) => entry?.robot === robot)
}

/**
 * 记录一次进入：每个 robot 一个会话条目，entries 里保留每次进入的节点 / 序号。
 *
 * @param run
 * @param robot
 * @param input
 * @returns
 */
export function rememberSessionEntry(
  run: WorkflowRunRecord,
  robot: unknown,
  {
    nodeId,
    visit,
    seq,
    sessionId,
    at,
    resumed,
    compacted,
  }: {
    nodeId: string
    visit: number
    seq: number
    sessionId: string | null
    at: number
    resumed: boolean
    compacted: boolean
  },
): void {
  if (typeof robot !== 'string' || robot === '') return
  if (!Array.isArray(run.sessions)) run.sessions = []
  let existing = findRobotSession(run, robot)
  if (existing === undefined) {
    existing = {
      robot,
      sessionId: sessionId ?? '',
      firstNodeId: nodeId,
      lastNodeId: nodeId,
      visits: 0,
      createdAt: at,
      entries: [],
    }
    run.sessions.push(existing)
  }
  if (typeof sessionId === 'string' && sessionId !== '') {
    if (existing.sessionId !== sessionId && existing.sessionId !== '')
      existing.resets = (existing.resets ?? 0) + 1
    existing.sessionId = sessionId
  }
  existing.lastNodeId = nodeId
  existing.lastVisit = visit
  if (!Array.isArray(existing.entries)) existing.entries = []
  const already = existing.entries.some(
    (entry) =>
      entry?.nodeId === nodeId && entry?.seq === seq && entry?.sessionId === (sessionId ?? null),
  )
  if (already) return
  existing.visits =
    (typeof existing.visits === 'number' && Number.isInteger(existing.visits)
      ? existing.visits
      : 0) + 1
  existing.entries.push({
    nodeId,
    visit,
    seq,
    sessionId: sessionId ?? null,
    at,
    resumed,
    compacted,
  })
  if (existing.entries.length > 500) existing.entries.splice(0, existing.entries.length - 500)
}

/**
 * 完成一次进入后更新会话摘要。
 *
 * @param run
 * @param robot
 * @param input
 * @returns
 */
export function updateRobotSession(
  run: WorkflowRunRecord,
  robot: unknown,
  {
    nodeId,
    visit,
    sessionId,
    at,
  }: { nodeId: string; visit: number; sessionId: string | null; at: number },
): void {
  const existing = findRobotSession(run, robot)
  if (existing === undefined) return
  existing.lastNodeId = nodeId
  existing.lastVisit = visit
  existing.updatedAt = at
  if (typeof sessionId === 'string' && sessionId !== '' && existing.sessionId === '')
    existing.sessionId = sessionId
}
