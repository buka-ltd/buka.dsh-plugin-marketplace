/**
 * 串行执行器：把多次异步操作排成一条队列，前一个 settle 后再跑下一个。
 *
 * 两个地方用到它，原因相同：底层的写入不是为并发准备的。
 *
 * - `npx skills` 会整份重写共享的 lockfile，安装与卸载并发执行可能互相覆盖条目；
 * - 收藏文件是整份 JSON，两次「添加」并发会互相覆盖整个文件。
 *
 * 失败不会卡住队列：下一个任务照样执行，错误由各自的调用方处理。
 *
 * @module @buka/dsh-plugin-skills/serial-queue
 */

/**
 * 创建一个串行队列，返回「把任务排进队列」的函数。
 *
 * @returns 串行执行的包装函数
 */
export function createSerialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<void> = Promise.resolve()
  return function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
