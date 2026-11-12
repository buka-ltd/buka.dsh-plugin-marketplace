/**
 * 记录 id 生成与时间戳。
 *
 * 形态遵循 `.tmp/workflow-v4-spec.md` §7.1：`task-<base36 time>-<uuid8>`；
 * 其余记录沿用同一风格。启动任务固定使用保留 id `$start`，不经过这里。
 *
 * @module @buka/dsh-plugin-workflows/domain/ids
 */

import { randomUUID } from 'node:crypto'

/** 启动任务的保留 id；定义里 `dependsOn: ["$start"]` 引用它。 */
export const START_TASK_ID = '$start'

/** 一段 base36 时间戳。 */
function timeSegment(): string {
  return Date.now().toString(36)
}

/** 八位 uuid 片段。 */
function uuidSegment(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 8)
}

/**
 * 生成一条带前缀的记录 id。
 *
 * @param prefix 记录类型前缀，例如 `task`
 * @returns `<prefix>-<base36 time>-<uuid8>`
 */
export function newRecordId(prefix: string): string {
  return `${prefix}-${timeSegment()}-${uuidSegment()}`
}

/**
 * 新工作流 id。
 *
 * @returns `wf-…`
 */
export function newWorkflowId(): string {
  return newRecordId('wf')
}

/**
 * 新作业 id。
 *
 * @returns `job-…`
 */
export function newJobId(): string {
  return newRecordId('job')
}

/**
 * 新任务 id（启动任务除外）。
 *
 * @returns `task-…`
 */
export function newTaskId(): string {
  return newRecordId('task')
}

/**
 * 新执行记录 id。
 *
 * @returns `att-…`
 */
export function newAttemptId(): string {
  return newRecordId('att')
}

/**
 * 新附件 id。
 *
 * @returns `att-file-…`
 */
export function newAttachmentId(): string {
  return newRecordId('att-file')
}

/**
 * 当前时间的 ISO 字符串。
 *
 * @returns ISO 时间戳
 */
export function nowIso(): string {
  return new Date().toISOString()
}
