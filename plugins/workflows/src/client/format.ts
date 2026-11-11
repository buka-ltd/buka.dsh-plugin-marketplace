/**
 * 展示文本：状态 / 时间 / 耗时 / 字节数 / 截断与错误文案。
 */

import type { WorkflowStep } from '../run-store.ts'

import type { Translate } from './types.ts'

/**
 * 把失败原因转成展示文本。
 *
 * @param failure
 * @returns
 */
export function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/**
 * 状态 → Tag tone。
 *
 * @param status
 * @returns
 */
export function statusTone(status: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
    case 'waiting':
      return 'info'
    case 'failed':
    case 'rejected':
    case 'cancelled':
    case 'interrupted':
    case 'unavailable':
      return 'warning'
    default:
      return 'neutral'
  }
}

/**
 * 状态 → 本地化文案。
 *
 * @param t
 * @param status
 * @returns
 */
export function statusLabel(t: Translate, status: string): string {
  switch (status) {
    case 'completed':
      return t('statusCompleted')
    case 'running':
      return t('statusRunning')
    case 'waiting':
      return t('statusWaiting')
    case 'failed':
      return t('statusFailed')
    case 'rejected':
      return t('statusRejected')
    case 'cancelled':
      return t('statusCancelled')
    case 'interrupted':
      return t('statusInterrupted')
    case 'unavailable':
      return t('stateUnavailable')
    case 'idle':
      return t('stateIdle')
    default:
      return t('unknown')
  }
}

/**
 * 时间戳 → 本地时间。
 *
 * @param value
 * @returns
 */
export function formatTime(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '—'
  }
}

/**
 * 节点耗时。
 *
 * @param step
 * @returns
 */
export function formatDuration(step: WorkflowStep | null | undefined): string {
  const started = typeof step?.startedAt === 'number' ? step.startedAt : null
  const finished = typeof step?.finishedAt === 'number' ? step.finishedAt : null
  if (started === null || finished === null || finished < started) return ''
  return formatMs(finished - started)
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
  return `${(seconds / 60).toFixed(1)}min`
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
 * 按字符数截断长文本（prompt 可能有 256 KiB，不能整段渲染）。
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
