/**
 * per-job 串行队列：同一个作业的状态变更排队执行，避免并发认领 / 创建竞争。
 *
 * 不同作业互不阻塞。队列只保证「同一 key 的异步任务按调用顺序串行」；任务抛错
 * 不会中断后续任务（下一个任务照常执行）。
 *
 * @module @buka/dsh-plugin-workflows/store/queue
 */

/** 按 key 串行执行异步任务的队列。 */
export class KeyedQueue {
  /** 每个 key 的队尾（永远 settle，便于挂下一个任务）。 */
  private readonly chains = new Map<string, Promise<void>>()

  /**
   * 把任务排到某个 key 的队尾。
   *
   * @param key 队列 key（作业 id）
   * @param task 要执行的异步任务
   * @returns 任务自身的结果 / 错误
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    // 前一个任务失败也要继续：两个回调都指向当前任务。
    const result = previous.then(task, task)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.chains.set(key, tail)
    void tail.then(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key)
    })
    return result
  }

  /**
   * 当前排队的 key 数量（诊断 / 测试用）。
   *
   * @returns 队列数量
   */
  get size(): number {
    return this.chains.size
  }
}
