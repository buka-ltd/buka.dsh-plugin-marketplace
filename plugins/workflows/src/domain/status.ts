/**
 * 任务 / 作业状态机：合法的状态转换矩阵。
 *
 * 规则来自 `.tmp/workflow-v4-spec.md` §6.3 / §7.2 / §7.8：
 *
 * - 任务依赖完成才 `ready`；依赖被取消 / 阻塞时 `blocked`；
 * - 认领把 `ready` 变成 `running`；
 * - 技术失败进 `failed`，重试把同一个任务退回 `ready`（新增执行记录，历史保留）；
 * - 失败任务被用户放弃（取消）后，依赖它的任务 `blocked`；
 * - 业务「不通过」不是状态：结果里写 `result: "fail"`，由执行者再派新任务。
 *
 * 纯函数，不依赖任何服务，便于单测。
 *
 * @module @buka/dsh-plugin-workflows/domain/status
 */

import type { JobStatus, TaskStatus } from './types.ts'

/** 全部任务状态。 */
export const TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  'pending',
  'ready',
  'running',
  'completed',
  'failed',
  'blocked',
  'cancelled',
])

/** 任务终态：不再变化，也不再阻塞作业结算。 */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  'completed',
  'failed',
  'blocked',
  'cancelled',
])

/** 非终态任务状态。 */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  'pending',
  'ready',
  'running',
] as const)

/** 合法任务状态转换矩阵；数组为空表示终态。 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  pending: ['ready', 'blocked', 'cancelled'],
  // ready -> completed：结束任务投递即完成；人可以直接兜底完成待认领任务。
  ready: ['running', 'completed', 'blocked', 'cancelled'],
  // running -> ready：助理承办失败 / 会话丢失后回到「待认领」（不自动换助理）。
  running: ['completed', 'failed', 'cancelled', 'ready'],
  completed: [],
  failed: ['ready', 'cancelled'],
  blocked: ['cancelled'],
  cancelled: [],
})

/** 全部作业状态。 */
export const JOB_STATUSES: readonly JobStatus[] = Object.freeze([
  'running',
  'completed',
  'failed',
  'cancelled',
])

/** 作业终态。 */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = Object.freeze([
  'completed',
  'failed',
  'cancelled',
])

/** 合法作业状态转换矩阵。 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = Object.freeze({
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
})

/**
 * 判断任务状态是否终态。
 *
 * @param status 任务状态
 * @returns 是终态时为 true
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status)
}

/**
 * 判断任务状态是否非终态。
 *
 * @param status 任务状态
 * @returns 非终态时为 true
 */
export function isOpenTaskStatus(status: TaskStatus): boolean {
  return !isTerminalTaskStatus(status)
}

/**
 * 判断作业状态是否终态。
 *
 * @param status 作业状态
 * @returns 是终态时为 true
 */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status)
}

/**
 * 判断一次任务状态转换是否合法。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 合法时为 true
 */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

/**
 * 判断一次作业状态转换是否合法。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 合法时为 true
 */
export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to)
}

/**
 * 断言一次任务状态转换合法，非法时抛出带任务 id 的错误。
 *
 * @param taskId 任务 id
 * @param from 当前状态
 * @param to 目标状态
 * @throws 转换非法时抛出
 */
export function assertTaskTransition(taskId: string, from: TaskStatus, to: TaskStatus): void {
  if (canTransitionTask(from, to)) return
  throw new Error(`task ${taskId}: illegal status transition ${from} -> ${to}`)
}

/**
 * 断言一次作业状态转换合法，非法时抛出带作业 id 的错误。
 *
 * @param jobId 作业 id
 * @param from 当前状态
 * @param to 目标状态
 * @throws 转换非法时抛出
 */
export function assertJobTransition(jobId: string, from: JobStatus, to: JobStatus): void {
  if (canTransitionJob(from, to)) return
  throw new Error(`job ${jobId}: illegal status transition ${from} -> ${to}`)
}
