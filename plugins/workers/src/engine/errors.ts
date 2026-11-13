/**
 * 打工人会话的内部错误类型。
 *
 * @module @buka/dsh-plugin-workers/engine/errors
 */

/** 打工人会话被超时 / 取消时抛出的内部错误。 */
export class WorkerSessionStop extends Error {
  /** 停止原因：超时或取消。 */
  readonly kind: 'timeout' | 'aborted'

  /**
   */
  constructor(kind: 'timeout' | 'aborted', message: string) {
    super(message)
    this.name = 'WorkerSessionStop'
    this.kind = kind
  }
}
