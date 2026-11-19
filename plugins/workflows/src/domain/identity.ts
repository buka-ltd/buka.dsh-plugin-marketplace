/**
 * 执行者引用的读取：v8 写 `id`，v7 作业快照写 `name`。
 *
 * 阶段 1 只做身份模型：旧快照里的 `name` 字段保存的就是当时的引用键（老打工
 * 人的标识符 = 原名字），所以读取时按 `id ?? name` 兜底即可，不需要迁移作业
 * 快照。展示名来自 workers 登记表，不从这里读。
 *
 * @module @buka/dsh-plugin-workflows/domain/identity
 */

import type { DeliveryRule, ExecutorSpec, StoredExecutor } from './types.ts'

/** 带 `id` / `name` 两种引用字段的形状。 */
interface WorkerRefLike {
  readonly kind?: string | undefined
  readonly id?: string | undefined
  readonly name?: string | undefined
}

/**
 * 取一条执行者引用的标识符。
 *
 * @param value 主体、任务主体或交回方式
 * @returns 标识符；两边都为空时是 null
 */
export function workerRef(value: WorkerRefLike | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (id !== '') return id
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  return name === '' ? null : name
}

/**
 * 取岗位主体的标识符。
 *
 * @param executor 岗位主体
 * @returns 执行者标识符；人是 null
 */
export function executorRef(executor: ExecutorSpec | null | undefined): string | null {
  if (executor === null || executor === undefined) return null
  // 旧作业快照可能还带术语改名前的 kind: "robot"。
  if ((executor as { kind?: string }).kind === 'human') return null
  return workerRef(executor)
}

/**
 * 取任务钉住的主体的标识符。
 *
 * @param executor 任务主体
 * @returns 执行者标识符；人或会话是 null
 */
export function storedExecutorRef(executor: StoredExecutor | null | undefined): string | null {
  if (executor === null || executor === undefined) return null
  const kind = (executor as { kind?: string }).kind
  // 人 / 会话没有执行者标识符；旧快照的 kind: "robot" 仍按执行者处理。
  if (kind === 'human' || kind === 'session') return null
  return workerRef(executor)
}

/**
 * 取交回方式里助理的标识符。
 *
 * @param delivery 交回方式
 * @returns 助理标识符；交回发起人时是 null
 */
export function deliveryWorkerRef(delivery: DeliveryRule | null | undefined): string | null {
  if (delivery === null || delivery === undefined || delivery.kind !== 'assistant') return null
  return workerRef(delivery)
}
