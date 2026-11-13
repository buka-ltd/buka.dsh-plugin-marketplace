/**
 * 展示文本：状态 / 时间 / 耗时 / 字节数 / 截断 / JSON 与错误文案。
 *
 * 时间在 HTTP 契约里是 ISO 字符串；旧数据可能是毫秒时间戳，这里两种都接受。
 */

import type { Translate } from './types.ts'
import { isRecord } from './types.ts'

/**
 * 把失败原因转成展示文本。
 *
 * @param failure
 * @returns
 */
export function messageOf(failure: unknown): string {
  if (failure instanceof Error) return failure.message
  return String(failure)
}

/**
 * 失败原因 → 展示文本；字符串原样，对象优先取 message。
 *
 * @param failure
 * @returns
 */
export function errorTextOf(failure: unknown): string {
  if (failure === null || failure === undefined) return ''
  if (failure instanceof Error) return failure.message
  if (typeof failure === 'string') return failure
  if (isRecord(failure) && typeof failure.message === 'string') return failure.message
  return jsonText(failure)
}

/**
 * 工作流状态 → 词典 key。
 *
 * @param status
 * @returns
 */
export function workflowStatusKey(status: unknown): string {
  switch (status) {
    case 'active':
      return 'workflowActive'
    case 'retired':
      return 'workflowRetired'
    case 'draft':
      return 'workflowDraft'
    default:
      return 'unknown'
  }
}

/**
 * 作业 / 任务状态 → 词典 key。
 *
 * @param status
 * @returns
 */
export function statusKey(status: unknown): string {
  switch (status) {
    case 'running':
      return 'statusRunning'
    case 'completed':
      return 'statusCompleted'
    case 'failed':
      return 'statusFailed'
    case 'cancelled':
      return 'statusCancelled'
    case 'pending':
      return 'statusPending'
    case 'ready':
      return 'statusReady'
    case 'blocked':
      return 'statusBlocked'
    default:
      return 'unknown'
  }
}

/**
 * 状态 → Tag tone。
 *
 * @param status
 * @returns
 */
export function statusTone(status: unknown): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'completed':
    case 'active':
      return 'success'
    case 'running':
      return 'info'
    case 'ready':
    case 'failed':
    case 'blocked':
      return 'warning'
    default:
      return 'neutral'
  }
}

/**
 * 状态 → 看板 / 节点圆点的 CSS 状态名。
 *
 * @param status
 * @returns
 */
export function stateClass(status: unknown): string {
  switch (status) {
    case 'running':
      return 'running'
    case 'ready':
      return 'waiting'
    case 'completed':
      return 'done'
    case 'failed':
    case 'blocked':
      return 'failed'
    default:
      return 'idle'
  }
}

/**
 * 承办者 / 启动者种类 → 词典 key。
 *
 * @param kind
 * @returns
 */
export function actorKindKey(kind: unknown): string {
  switch (kind) {
    case 'worker':
      return 'actorWorker'
    case 'human':
      return 'actorHuman'
    case 'assistant':
      return 'actorAssistant'
    case 'session':
      return 'actorSession'
    default:
      return 'unknown'
  }
}

/**
 * ISO 时间 / 毫秒时间戳 → 本地时间。
 *
 * @param value
 * @returns
 */
export function formatTime(value: unknown): string {
  const date = toDate(value)
  if (date === null) return '—'
  try {
    return date.toLocaleString()
  } catch {
    return '—'
  }
}

/**
 * 把一个时间值解析成 Date。
 *
 * @param value
 * @returns
 */
export function toDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value !== 'string' || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 两个时间点之间的耗时。
 *
 * @param startedAt
 * @param finishedAt
 * @returns
 */
export function formatElapsed(startedAt: unknown, finishedAt: unknown): string {
  const started = toDate(startedAt)
  const finished = toDate(finishedAt)
  if (started === null || finished === null) return ''
  return formatMs(finished.getTime() - started.getTime())
}

/**
 * 从创建到现在的等待时长；没有终点时用当前时间。
 *
 * @param since
 * @param [until]
 * @returns
 */
export function formatWaiting(since: unknown, until: unknown = null): string {
  const started = toDate(since)
  if (started === null) return ''
  const finished = until === null ? new Date() : toDate(until)
  if (finished === null) return ''
  return formatMs(finished.getTime() - started.getTime())
}

/**
 * 毫秒数 → 简短耗时。
 *
 * @param value
 * @returns
 */
export function formatMs(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(1)}min`
  return `${(minutes / 60).toFixed(1)}h`
}

/**
 * 字节数 → 简短的附件大小。
 *
 * @param value
 * @returns
 */
export function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

/**
 * 按字符数截断长文本（payload / 结果可能是大段文本）。
 *
 * @param value
 * @param limit
 * @returns
 */
export function truncateText(value: unknown, limit: number): { text: string; truncated: boolean } {
  if (typeof value !== 'string' || value === '') return { text: '', truncated: false }
  if (value.length <= limit) return { text: value, truncated: false }
  return { text: value.slice(0, limit), truncated: true }
}

/**
 * 任意值 → 可读 JSON；循环引用 / 不可序列化时退回字符串。
 *
 * @param value
 * @returns
 */
export function jsonText(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * 一句话摘要：去掉首尾空白，超长截断。
 *
 * @param value
 * @param limit
 * @returns
 */
export function oneLine(value: unknown, limit = 160): string {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * 任务状态 → 看板列 key。
 *
 * @param status
 * @returns
 */
export function boardColumn(
  status: unknown,
): 'pending' | 'ready' | 'running' | 'completed' | 'error' {
  switch (status) {
    case 'ready':
      return 'ready'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
    case 'blocked':
    case 'cancelled':
      return 'error'
    default:
      return 'pending'
  }
}

/**
 * 翻译状态；未知状态直接展示原值。
 *
 * @param t
 * @param status
 * @returns
 */
export function statusLabel(t: Translate, status: unknown): string {
  const key = statusKey(status)
  if (key !== 'unknown') return t(key)
  return typeof status === 'string' && status !== '' ? status : t('unknown')
}
