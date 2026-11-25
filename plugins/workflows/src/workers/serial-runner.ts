/**
 * 串行执行器的选择：优先借用 Skills 服务的共用队列。
 *
 * available / install / remove 与 Skills 的检查 / 更新都会整份重写
 * `skills-lock.json`。Skills 插件在的时候必须共用它的队列；没装时退回本插件
 * 自己的串行队列，至少保证本页面内的写入不并发。
 *
 * @module @buka/dsh-plugin-workflows/workers/serial-runner
 */

/** 串行执行器：同一时刻只跑一段工作。 */
export type SerialRunner = <T>(work: () => Promise<T>) => Promise<T>

/** 可选提供共用队列的服务；`ctx.skillCatalog` 是它的实现。 */
export interface SerialQueueService {
  runSerialized?: SerialRunner
}

/**
 * 取一个串行执行器：优先用服务提供的共用队列，没有时用本地队列。
 *
 * @param service Skills 服务；插件没装时是 null / undefined
 * @param fallback 本插件自己的串行队列
 */
export function preferSharedQueue(
  service: SerialQueueService | null | undefined,
  fallback: SerialRunner,
): SerialRunner {
  if (service === null || service === undefined) return fallback
  const shared = service.runSerialized
  if (typeof shared !== 'function') return fallback
  // 服务方法可能依赖 `this`（读取私有队列），先绑到实例再交给调用方。
  return shared.bind(service) as SerialRunner
}
