/**
 * 已安装 skills 的快照：路由与模型工具共用同一份读取逻辑。
 *
 * skills 注册表读取失败时仍然返回磁盘扫描结果，只是描述为空：页面与工具
 * 都不该因为注册表故障而看不到已安装的 skill。
 *
 * @module @buka/dsh-plugin-skills/snapshot
 */

import type { Context } from '@deepseek-ai/cordis'

import { describeError } from './http.ts'
import type { Homes } from './skill-store.ts'
import { collectGlobalSkills } from './skill-store.ts'

/**
 * 读取快照。skills 注册表读取失败时仍然返回磁盘扫描结果，只是描述为空：
 * 页面不该因为注册表故障而看不到已安装的 skill。
 *
 * @param ctx 提供 `skills` 的插件上下文
 * @param homes 两个全局根目录
 */
export async function readSnapshot(
  ctx: Context,
  homes: Homes,
): Promise<Awaited<ReturnType<typeof collectGlobalSkills>>> {
  let summaries: Array<Record<string, unknown>> = []
  try {
    summaries = await ctx.skills.list({ cwd: homes.agentsHome })
  } catch (error) {
    ctx.logger?.warn?.('buka-skills: 无法读取 skills 注册表：%s', describeError(error))
  }
  return collectGlobalSkills({ homes, summaries })
}
