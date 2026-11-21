/**
 * 记录 id 生成与时间戳。
 *
 * 形态遵循 `.tmp/workflow-v4-spec.md` §7.1：`task-<base36 time>-<uuid8>`；
 * 其余记录沿用同一风格。启动任务固定使用保留 id `start-task`，不经过这里。
 *
 * @module @buka/dsh-plugin-workflows/domain/ids
 */

import { randomUUID } from 'node:crypto'

/**
 * 启动任务 id 的保留前缀，也是旧作业里启动任务的完整 id。
 *
 * 定义格式里用 `$start` 引用启动任务，但**记录 id 必须能当文件名**：
 * storageDomain 的 json 后端按记录 id 分文件，只接受 `[a-zA-Z0-9_-]`，
 * `$start` 会被宿主拒绝（`per-record key ... is not path-safe`）。新作业用
 * `start-task-<jobId>`（见 `startTaskId`）；旧的作业快照仍用这个保留 id。
 */
export const START_TASK_ID = 'start-task'

/**
 * 新作业的启动任务 id。
 *
 * 任务表按记录 id 做键，`START_TASK_ID` 是所有旧作业共用的保留 id：同一张
 * 表里第二个作业的启动任务会覆盖第一个。新作业改用带作业 id 的键；旧作业
 * 继续读 `start-task`，依赖字段不需要迁移。
 *
 * @param jobId 作业 id
 * @returns 路径安全的启动任务 id
 */
export function startTaskId(jobId: string): string {
  return `${START_TASK_ID}-${jobId}`
}

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
