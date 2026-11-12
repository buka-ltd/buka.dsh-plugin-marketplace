/**
 * 作业事件时间线：`<dataDir>/jobs/<jobId>/events.jsonl`。
 *
 * 只用于回看 / 排查，不是权威状态（权威状态在 storageDomain）。写失败只记日志，
 * 绝不影响作业推进。
 *
 * @module @buka/dsh-plugin-workflows/engine/events
 */

import { promises as fs } from 'node:fs'

import { nowIso } from '../domain/ids.ts'
import type { LoggerLike, WorkflowStore } from '../store/index.ts'
import { describeError } from './types.ts'

/**
 * 追加一条作业事件。
 *
 * @param store 存储（提供作业目录）
 * @param logger 日志
 * @param jobId 作业 id
 * @param type 事件类型（`job/created`、`task/claimed` 等）
 * @param data 事件数据
 * @returns 无返回值
 */
export async function appendJobEvent(
  store: WorkflowStore,
  logger: LoggerLike | undefined,
  jobId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const paths = await store.ensureJobDirectories(jobId)
    const line = `${JSON.stringify({ at: nowIso(), type, data })}\n`
    await fs.appendFile(paths.events, line, 'utf8')
  } catch (error) {
    logger?.warn?.(`buka-workflows: could not append job event ${type}: ${describeError(error)}`)
  }
}
