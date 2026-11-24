/**
 * 内建机器人。
 *
 * 机器人是固定程序（接收输入 → 产出输出），没有目录、AGENTS.md 与
 * 项目 skills；目前有 `clock` 与 `engine`，由 workflows 插件执行驱动。它们
 * 登记在 workers 插件里、在页面上只读展示，用户不能创建或删除。内建机器人的
 * 标识符固定；展示名可以是标识符，也可以是一个可读的名字。
 *
 * `engine` 是工作流引擎自己：它只处理内建开始节点，岗位不能引用它。展示名是
 * `Workflow引擎`，默认头像 🤖（预设 id `robot`）。
 *
 * 本模块只依赖类型与常量，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-workflows/workers/store/builtin
 */

import type { WorkerRecord } from './types.ts'

/** 内建定时执行者的标识符，也是它的 program id。 */
export const CLOCK_WORKER_ID = 'clock'

/** 工作流引擎的标识符，也是它的 program id。 */
export const ENGINE_WORKER_ID = 'engine'

/** 引擎 program id；与 worker 标识符同源。 */
export const ENGINE_PROGRAM_ID = ENGINE_WORKER_ID

/**
 * 内建机器人清单（按登记顺序）。
 *
 * `createdAt` 是固定的登记时刻：内建执行者不随安装时间变化，重复补写也不会
 * 让它看起来是新的。
 */
export const BUILTIN_WORKERS: ReadonlyArray<WorkerRecord> = Object.freeze([
  {
    id: CLOCK_WORKER_ID,
    name: CLOCK_WORKER_ID,
    driver: 'robot',
    path: '',
    program: CLOCK_WORKER_ID,
    createdAt: '2026-11-12T00:00:00.000Z',
    avatar: '',
    description:
      '到点完成任务的定时执行者：任务内容带 until，到点后自动完成。等待彼此独立，建议把该任务类型的 concurrency 设为 10，避免多个等待互相排队。',
  },
  {
    id: ENGINE_WORKER_ID,
    name: 'Workflow引擎',
    driver: 'robot',
    path: '',
    program: ENGINE_PROGRAM_ID,
    createdAt: '2026-11-20T00:00:00.000Z',
    avatar: 'robot',
    description: '工作流引擎：接受开始任务类型，校验作业输入并创建初始任务；只处理内建开始节点。',
  },
])

/** 按标识符取内建机器人；不是内建执行者时返回 undefined。 */
export function builtinWorker(id: unknown): WorkerRecord | undefined {
  if (typeof id !== 'string') return undefined
  const trimmed = id.trim()
  return BUILTIN_WORKERS.find((worker) => worker.id === trimmed)
}

/** 标识符是否属于内建（不可创建 / 删除 / 改动的）机器人。 */
export function isBuiltinWorkerId(id: unknown): boolean {
  return builtinWorker(id) !== undefined
}

/**
 * 标识符是否只能由内建节点使用。
 *
 * 引擎是开始节点的处理人；岗位如果把引擎当执行者，会得到一个只会初始化
 * 作业、不会执行岗位任务的机器人。定义校验直接拒绝这种引用。
 */
export function isSystemOnlyWorkerId(id: unknown): boolean {
  return typeof id === 'string' && id.trim() === ENGINE_WORKER_ID
}

/**
 * 把内建执行者的记录换成清单里的规范记录，并把清单里缺的补到末尾。
 *
 * 内建执行者的名称、头像与描述由 `BUILTIN_WORKERS` 决定：登记表里可能还留着
 * 旧版本写下的值，视图只以清单为准。只影响内存里的视图：页面与 `list()` 用它
 * 保证内建执行者总是可见且展示一致；写回由 `ensureBuiltinWorkers` 负责。
 */
export function withBuiltinWorkers(workers: readonly WorkerRecord[]): WorkerRecord[] {
  const ids = new Set(workers.map((worker) => worker.id))
  const canonical = workers.map((worker) => builtinWorker(worker.id) ?? worker)
  return [...canonical, ...BUILTIN_WORKERS.filter((worker) => !ids.has(worker.id))]
}

/** 生成「内建执行者不可改动」错误。 */
export function builtinWorkerError(id: unknown): Error & { code: string } {
  const error = new Error(`内建执行者不可创建、修改或删除：${String(id)}`)
  return Object.assign(error, { code: 'builtin-worker' })
}
