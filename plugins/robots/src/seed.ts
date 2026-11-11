/**
 * 全新安装时的预设机器人初始化。
 *
 * 登记表为空时补上「软件工程师」与「质量保障工程师」两个预设机器人；与页面上的
 * 首次新建共用同一个登记表写队列，避免抢写。初始化异步完成、不阻塞启动，失败
 * 只记日志。
 *
 * @module @buka/dsh-plugin-robots/seed
 */

import type { Context } from '@deepseek-ai/cordis'
import { seedPresetRobots } from './presets.ts'
import { describeError } from './routes/http.ts'

/**
 * 在登记表为空时初始化预设机器人；`enabled: false` 时跳过。
 *
 */
export function seedRobotsOnStartup({
  ctx,
  robotsDir,
  registryFile,
  serializeRegistry,
  enabled,
}: {
  ctx: Context
  robotsDir: string
  registryFile: string
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
  enabled: boolean
}): void {
  if (!enabled) return
  void serializeRegistry(() =>
    seedPresetRobots({
      robotsDir,
      file: registryFile,
      workspaceRegistry: ctx.workspaceRegistry,
    }).then((result) => {
      if (result.seeded.length > 0) {
        ctx.logger?.info?.('buka-robots: 已初始化预设机器人：%s', result.seeded.join('、'))
      }
    }),
  ).catch((error) => {
    ctx.logger?.warn?.('buka-robots: 初始化预设机器人失败：%s', describeError(error))
  })
}
