/**
 * 全新安装时的预设打工人初始化。
 *
 * 登记表为空时补上「软件工程师」与「质量保障工程师」两个预设打工人；与页面上的
 * 首次新建共用同一个登记表写队列，避免抢写。初始化异步完成、不阻塞启动，失败
 * 只记日志。
 *
 * @module @buka/dsh-plugin-workers/seed
 */

import type { Context } from '@deepseek-ai/cordis'
import { seedPresetWorkers } from './presets.ts'
import { describeError } from './routes/http.ts'

/**
 * 在登记表为空时初始化预设打工人；`enabled: false` 时跳过。
 *
 */
export function seedWorkersOnStartup({
  ctx,
  workersDir,
  registryFile,
  serializeRegistry,
  enabled,
}: {
  ctx: Context
  workersDir: string
  registryFile: string
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
  enabled: boolean
}): void {
  if (!enabled) return
  void serializeRegistry(() =>
    seedPresetWorkers({
      workersDir,
      file: registryFile,
      workspaceRegistry: ctx.workspaceRegistry,
    }).then((result) => {
      if (result.seeded.length > 0) {
        ctx.logger?.info?.('buka-workers: 已初始化预设打工人：%s', result.seeded.join('、'))
      }
    }),
  ).catch((error) => {
    ctx.logger?.warn?.('buka-workers: 初始化预设打工人失败：%s', describeError(error))
  })
}
