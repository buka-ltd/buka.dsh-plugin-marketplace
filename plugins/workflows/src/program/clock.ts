/**
 * 机器人驱动：v1 只有内建 `clock`。
 *
 * `clock` 任务在任务内容里带 `until`（ISO 时间）；到点完成，不建会话、不占
 * 执行者实例。重启时按 `until` 重新计时：已过则立即完成。
 *
 * @module @buka/dsh-plugin-workflows/program/clock
 */

import type { JsonValue } from '../domain/types.ts'
import type { JsonSchema } from '../json-schema.ts'

/** 内建 `clock` 驱动 id；与 workers 登记表里的 program id 一致。 */
export const CLOCK_PROGRAM_ID = 'clock'

/** 一个 program 驱动的执行结果。 */
export interface ProgramRunResult {
  /** 一段总结文本，写进任务结果。 */
  readonly text: string
}

/** program 驱动接口；未来可注册更多。 */
export interface ProgramDriver {
  readonly id: string
  /**
   * 这个程序接收的任务内容契约；省略表示不限。
   *
   * 保存工作流时要求挂该程序的任务类型声明 `content` schema 覆盖必填字段，
   * 创建任务与执行前再按它校验实际内容（见 `program/contracts.ts`）。
   */
  readonly content?: JsonSchema | undefined
  /**
   * 执行一个 program 任务。
   *
   * @param input 任务内容与取消信号
   * @returns 结果文本
   */
  run(input: {
    readonly content: JsonValue
    readonly signal: AbortSignal
  }): Promise<ProgramRunResult>
}

/** Node `setTimeout` 的最大延迟；超过时分段计时。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/**
 * 解析任务内容里的 `until`。
 *
 * @param content 任务内容
 * @returns 时间戳（毫秒）；不合法时是 null
 */
export function clockUntil(content: JsonValue): number | null {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null
  const raw = (content as Record<string, JsonValue>).until
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * 等一段时间；`AbortSignal` 取消时 reject。
 *
 * @param delayMs 延迟毫秒
 * @param signal 取消信号
 * @returns 无返回值
 */
function sleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('clock task was cancelled'))
      return
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      Math.min(delayMs, MAX_TIMER_DELAY_MS),
    )
    timer.unref?.()
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('clock task was cancelled'))
    }
    signal.addEventListener?.('abort', onAbort, { once: true })
  })
}

/** 内建 clock 驱动；任务内容只有一个必填的 `until`。 */
export const clockDriver: ProgramDriver = {
  id: CLOCK_PROGRAM_ID,
  content: {
    type: 'object',
    description: 'Task content for the clock robot: when the task should complete.',
    properties: {
      until: {
        type: 'string',
        description: 'ISO 8601 timestamp, for example 2026-11-16T09:00:00+08:00.',
      },
    },
    required: ['until'],
  },
  async run({ content, signal }) {
    const until = clockUntil(content)
    if (until === null) {
      throw new Error('clock task content must contain an ISO timestamp "until"')
    }
    // 分段等待，避免超过 setTimeout 上限；重启恢复时同样按 until 判断。
    while (Date.now() < until) {
      if (signal.aborted) throw new Error('clock task was cancelled')
      await sleep(until - Date.now(), signal)
    }
    return { text: `clock 到点：${new Date().toISOString()}` }
  },
}

/** v1 可用的 program 驱动表。 */
export const PROGRAM_DRIVERS: ReadonlyMap<string, ProgramDriver> = new Map([
  [CLOCK_PROGRAM_ID, clockDriver],
])

/**
 * 取一个 program 驱动。
 *
 * @param programId 驱动 id
 * @returns 驱动；未知时是 undefined
 */
export function programDriver(programId: string): ProgramDriver | undefined {
  return PROGRAM_DRIVERS.get(programId)
}
