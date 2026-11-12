/**
 * 页面 / 工具用的只读投影：任务摘要、任务详情、作业摘要、定义摘要与看板计数。
 *
 * 形状以 `.tmp/workflow-v4-api.md` 为准；`GET /job` 的 `definition` 带完整
 * positions[].taskTypes，客户端不需要再拉工作流兜底。
 *
 * @module @buka/dsh-plugin-workflows/engine/board
 */

import { clipUtf8 } from '../attachments/index.ts'
import { findTaskType } from '../definition/validate.ts'
import { TASK_STATUSES } from '../domain/status.ts'
import type {
  AttachmentRecord,
  AttemptRecord,
  JobRecord,
  PositionDefinition,
  RobotInfo,
  TaskRecord,
  TaskStatus,
  WorkflowDefinition,
  WorkflowRecord,
} from '../domain/types.ts'
import { positionLabel, taskTypeLabel } from './prompt.ts'

/** 摘要文本上限。 */
const SUMMARY_BYTES = 240

/** 把机器人登记里的 driver / avatar 补到执行者上（只用于展示）。 */
function executorView(
  executor: PositionDefinition['executor'],
  robots: ReadonlyMap<string, RobotInfo> | undefined,
): Record<string, unknown> {
  if (executor.kind === 'human' || robots === undefined) return executor
  const robot = robots.get(executor.name)
  return {
    ...executor,
    ...(robot === undefined ? {} : { driver: robot.driver }),
    ...(robot?.avatar === undefined ? {} : { avatar: robot.avatar }),
  }
}

/** 任务计数。 */
export function countTasks(tasks: readonly TaskRecord[]): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >
  for (const task of tasks) counts[task.status] += 1
  return counts
}

/**
 * 任务摘要（看板 / 列表用）。
 *
 * @param task 任务
 * @param definition 作业定义
 * @returns 契约形状的任务摘要
 */
export function taskSummary(
  task: TaskRecord,
  definition: WorkflowDefinition,
): Record<string, unknown> {
  return {
    id: task.id,
    position: task.position,
    type: task.type,
    typeLabel: taskTypeLabel(definition, task.type),
    status: task.status,
    deps: [...task.deps],
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    claimant: task.claimant,
    attemptCount: task.attemptIds.length,
    attachmentCount: task.result?.attachmentIds.length ?? 0,
    resultSummary:
      task.result === null
        ? null
        : clipUtf8(task.result.text.trim(), SUMMARY_BYTES) ||
          (task.result.output === null
            ? null
            : clipUtf8(JSON.stringify(task.result.output), SUMMARY_BYTES)),
  }
}

/**
 * 一次执行记录投影。
 *
 * @param attempt 执行记录
 * @returns 契约形状
 */
export function attemptSummary(attempt: AttemptRecord): Record<string, unknown> {
  return {
    id: attempt.id,
    sessionId: attempt.sessionId,
    status: attempt.status,
    stopReason: attempt.stopReason,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    error: attempt.error,
  }
}

/**
 * 判断一条任务在当前作业状态下允许哪些操作。
 *
 * @param job 作业
 * @param task 任务
 * @returns `cancel | retry | claim | complete` 的子集
 */
export function allowedTaskActions(job: JobRecord, task: TaskRecord): string[] {
  if (job.status !== 'running') return []
  switch (task.status) {
    case 'pending':
      return ['cancel']
    case 'ready':
      return task.assignee.kind === 'human' ? ['claim', 'cancel'] : ['cancel']
    case 'running':
      return task.assignee.kind === 'human' ? ['complete', 'cancel'] : ['cancel']
    case 'failed':
      return ['retry', 'cancel']
    case 'blocked':
      return ['cancel']
    default:
      return []
  }
}

/** 任务详情入参。 */
export interface TaskDetailInput {
  readonly job: JobRecord
  readonly task: TaskRecord
  readonly tasks: readonly TaskRecord[]
  readonly attempts: readonly AttemptRecord[]
  readonly attachments: readonly AttachmentRecord[]
}

/**
 * 任务详情投影。
 *
 * @param input 作业、任务、执行记录与附件
 * @returns 契约形状
 */
export function taskDetail(input: TaskDetailInput): Record<string, unknown> {
  const { job, task } = input
  const definition = job.definition
  const taskType = findTaskType(definition, task.type)
  const dependencyTasks = task.deps
    .map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId))
    .filter((candidate): candidate is TaskRecord => candidate !== undefined)
  const attachments = input.attachments.filter((attachment) =>
    task.result?.attachmentIds.includes(attachment.id),
  )
  return {
    id: task.id,
    jobId: task.jobId,
    position: task.position,
    positionLabel: positionLabel(definition, task.position),
    type: task.type,
    typeLabel: taskTypeLabel(definition, task.type),
    typeDescription: taskType?.description ?? '',
    status: task.status,
    payload: task.payload,
    deps: dependencyTasks.map((dependency) => taskSummary(dependency, definition)),
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    claimant: task.claimant,
    attempts: input.attempts.map(attemptSummary),
    result:
      task.result === null
        ? null
        : {
            text: task.result.text,
            output: task.result.output,
            attachments: attachments.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              bytes: attachment.bytes,
              mime: attachment.mime,
              sha256: attachment.sha256,
              description: attachment.description,
              sourceTaskId: attachment.sourceTaskId,
              sourcePositionId: attachment.sourcePositionId,
              createdBy: attachment.createdBy,
              createdAt: attachment.createdAt,
            })),
          },
    allowedActions: allowedTaskActions(job, task),
  }
}

/**
 * 作业摘要（工作流详情里的作业列表）。
 *
 * @param job 作业
 * @param tasks 作业任务
 * @returns 契约形状
 */
export function jobSummary(job: JobRecord, tasks: readonly TaskRecord[]): Record<string, unknown> {
  return {
    id: job.id,
    seq: job.seq,
    status: job.status,
    inputSummary: job.inputSummary,
    taskCounts: countTasks(tasks),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

/**
 * 作业定义摘要：图 + 完整岗位 / 任务类型契约（客户端按钉住版本渲染表单）。
 *
 * @param definition 定义
 * @returns 契约形状
 */
export function jobDefinition(
  definition: WorkflowDefinition,
  robots?: ReadonlyMap<string, RobotInfo>,
): Record<string, unknown> {
  return {
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    positions: definition.positions.map((position) => ({
      id: position.id,
      label: position.label,
      ...(position.description === undefined ? {} : { description: position.description }),
      executor: executorView(position.executor, robots),
      taskTypes: position.taskTypes.map((taskType) => ({
        id: taskType.id,
        label: taskType.label,
        ...(taskType.description === undefined ? {} : { description: taskType.description }),
        payload: taskType.payload,
        output: taskType.output,
        ...(taskType.requires === undefined ? {} : { requires: taskType.requires }),
        ...(taskType.assistant === undefined ? {} : { assistant: taskType.assistant }),
        ...(taskType.mode === undefined ? {} : { mode: taskType.mode }),
      })),
    })),
    edges: definition.edges,
    start: { label: '开始' },
    end: { label: '结束' },
  }
}

/**
 * 工作流详情里的图（positions / edges / start / end）。
 *
 * @param definition 定义
 * @returns 契约形状
 */
export function workflowGraph(
  definition: WorkflowDefinition,
  robots?: ReadonlyMap<string, RobotInfo>,
): Record<string, unknown> {
  const summary = jobDefinition(definition, robots)
  return {
    positions: (summary.positions as PositionDefinition[]).map((position) => ({
      id: position.id,
      label: position.label,
      executor: position.executor,
    })),
    edges: definition.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      types: edge.types ?? [],
      back: edge.back === true,
    })),
    start: { label: '开始' },
    end: { label: '结束' },
  }
}

/**
 * 工作流列表里的一条。
 *
 * @param workflow 工作流记录
 * @param jobCount 作业数
 * @returns 契约形状
 */
export function workflowSummary(
  workflow: WorkflowRecord,
  jobCount: number,
): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    version: workflow.latestVersion,
    status: workflow.status,
    jobCount,
    updatedAt: workflow.updatedAt,
  }
}

/**
 * 是否还存在待投递的结束任务（页面「重试交付」的判定条件）。
 *
 * @param tasks 作业任务
 * @returns 有待投递结束任务时为 true
 */
export function canRetryDelivery(tasks: readonly TaskRecord[]): boolean {
  return tasks.some(
    (task) => task.position === 'end' && (task.status === 'ready' || task.status === 'failed'),
  )
}
