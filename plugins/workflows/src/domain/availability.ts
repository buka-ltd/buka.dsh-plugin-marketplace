/**
 * 派生的「不可用」状态：工作流 / 作业引用的打工人已不在登记表里。
 *
 * 不可用不落盘，由读取方按引用能否解析实时计算；重新绑定一个已存在的打工人
 * 后自动恢复。它与「停用」不同：停用是人为收起，不可用是引用断了。
 *
 * 引用来源：
 *
 * - 工作流定义：岗位执行者、任务类型的助理；
 * - 作业快照：钉住的定义 + 交回方式里的助理（v7 快照用 `name` 兜底）。
 *
 * @module @buka/dsh-plugin-workflows/domain/availability
 */

import { deliveryWorkerRef, executorRef } from './identity.ts'
import type {
  JobRecord,
  MissingWorkerRef,
  WorkerAvailability,
  WorkerInfo,
  WorkflowDefinition,
} from './types.ts'

/** 空的可用性结果（没有缺失引用）。 */
const AVAILABLE: WorkerAvailability = { available: true, missingWorkers: [] }

/** 判断登记表里有没有这个标识符。 */
function hasWorker(workers: ReadonlyMap<string, WorkerInfo>, id: string): boolean {
  return workers.has(id)
}

/** 追加一条缺失引用；同一个标识符在同一位置只记一次。 */
function collect(missing: MissingWorkerRef[], seen: Set<string>, entry: MissingWorkerRef): void {
  const key = `${entry.role}:${entry.positionId ?? ''}:${entry.taskTypeId ?? ''}:${entry.id}`
  if (seen.has(key)) return
  seen.add(key)
  missing.push(entry)
}

/**
 * 计算一份工作流定义里的缺失引用。
 *
 * @param definition 工作流定义（v8）或作业钉住的旧快照（v7）
 * @param workers 打工人登记表（按标识符）
 * @returns 可用性：缺哪些标识符、分别在哪
 */
export function definitionAvailability(
  definition: WorkflowDefinition,
  workers: ReadonlyMap<string, WorkerInfo>,
): WorkerAvailability {
  const missing: MissingWorkerRef[] = []
  const seen = new Set<string>()
  for (const position of definition.positions) {
    const executorId = executorRef(position.executor)
    if (executorId !== null && !hasWorker(workers, executorId)) {
      collect(missing, seen, {
        id: executorId,
        role: 'executor',
        positionId: position.id,
        positionLabel: position.label,
      })
    }
    for (const taskType of position.taskTypes) {
      const assistantId = typeof taskType.assistant === 'string' ? taskType.assistant.trim() : ''
      if (assistantId !== '' && !hasWorker(workers, assistantId)) {
        collect(missing, seen, {
          id: assistantId,
          role: 'assistant',
          positionId: position.id,
          positionLabel: position.label,
          taskTypeId: taskType.id,
          taskTypeLabel: taskType.label,
        })
      }
    }
  }
  if (missing.length === 0) return AVAILABLE
  return { available: false, missingWorkers: missing }
}

/**
 * 计算一个作业的派生可用性：钉住的定义 + 交回方式的助理。
 *
 * @param job 作业记录
 * @param workers 打工人登记表（按标识符）
 * @returns 可用性
 */
export function jobAvailability(
  job: JobRecord,
  workers: ReadonlyMap<string, WorkerInfo>,
): WorkerAvailability {
  const definition = definitionAvailability(job.definition, workers)
  const missing = [...definition.missingWorkers]
  const deliveryId = deliveryWorkerRef(job.delivery)
  if (deliveryId !== null && !hasWorker(workers, deliveryId)) {
    missing.push({ id: deliveryId, role: 'delivery' })
  }
  if (missing.length === 0) return AVAILABLE
  return { available: false, missingWorkers: missing }
}

/**
 * 把缺失引用拼成一句可展示的原因（工具 / 报错都用它）。
 *
 * @param availability 可用性
 * @returns 一句话；可用时是空串
 */
export function describeUnavailable(availability: WorkerAvailability): string {
  if (availability.available) return ''
  return availability.missingWorkers
    .map((entry) => {
      if (entry.role === 'delivery') return `delivery assistant "${entry.id}"`
      if (entry.role === 'assistant') {
        return `task type "${entry.taskTypeId ?? entry.id}" assistant "${entry.id}"`
      }
      return `position "${entry.positionLabel ?? entry.positionId ?? ''}" executor "${entry.id}"`
    })
    .join('; ')
}

/**
 * 判断一份工作流定义是否引用了某个打工人标识符。
 *
 * 引用 = 岗位执行者、任务类型助理（定义里是字符串）。
 *
 * @param definition 工作流定义 / 作业快照
 * @param id 打工人标识符
 * @returns 引用时为 true
 */
export function definitionReferencesWorker(definition: WorkflowDefinition, id: string): boolean {
  if (typeof id !== 'string' || id === '') return false
  for (const position of definition.positions) {
    if (executorRef(position.executor) === id) return true
    for (const taskType of position.taskTypes) {
      if (typeof taskType.assistant === 'string' && taskType.assistant.trim() === id) return true
    }
  }
  return false
}

/**
 * 判断一个作业是否引用了某个打工人标识符：钉住的定义 + 交回方式。
 *
 * v7 作业快照用 `name` 兜底，读取时统一按标识符比较。
 *
 * @param job 作业记录
 * @param id 打工人标识符
 * @returns 引用时为 true
 */
export function jobReferencesWorker(job: JobRecord, id: string): boolean {
  if (definitionReferencesWorker(job.definition, id)) return true
  return deliveryWorkerRef(job.delivery) === id
}
