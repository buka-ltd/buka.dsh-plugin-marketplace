/**
 * `@buka/dsh-plugin-workflows` 对外提供的只读查询服务：`ctx.bukaWorkflows`。
 *
 * 目前只有一个能力：`workerUsage(id)`。Workers 插件在删除打工人前用它算出
 * 影响面与唯一阻塞条件（引用该标识符的运行中作业）；取不到服务时视为没有
 * 作业引用。
 *
 * 服务只读，不改变工作流 / 作业状态，也不落盘任何派生状态：可用性由读取方
 * 按引用能否解析实时计算。
 *
 * @module @buka/dsh-plugin-workflows/service
 */

import type { WorkerUsage } from './domain/types.ts'
import type { WorkflowEngine } from './engine/engine.ts'

/** 服务名；消费方用 `ctx.get(SERVICE_NAME)` 读取，运行时是 `ctx.bukaWorkflows`。 */
export const SERVICE_NAME = 'bukaWorkflows'

/** 查询服务：等价于转发给就绪后的引擎。 */
export class WorkflowQueryService {
  readonly #ready: () => Promise<WorkflowEngine>

  /**
   * @param options.ready 等存储 / 引擎就绪后返回引擎
   */
  constructor(options: { ready: () => Promise<WorkflowEngine> }) {
    this.#ready = options.ready
  }

  /**
   * 一个打工人标识符被工作流 / 作业引用的情况。
   *
   * @param id 打工人标识符
   * @returns 运行中作业、引用它的工作流与已结束作业数
   */
  async workerUsage(id: string): Promise<WorkerUsage> {
    const engine = await this.#ready()
    return await engine.workerUsage(id)
  }
}
