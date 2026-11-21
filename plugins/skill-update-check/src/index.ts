/**
 * `@buka/dsh-plugin-skill-update-check` 的 Host 一半。
 *
 * 浏览器一半只传会话 id，Host 解析出当前工作区后调用 `skills` 包自带的 CLI
 * 检查项目技能是否有上游更新；有更新时浏览器在新建会话输入框下方显示
 * warn 色提示。具体检查逻辑在 `check.ts`，工作区解析在 `workspace.ts`，
 * HTTP 路由在 `routes.ts`。
 *
 * 本文件只装配：导出 Cordis 插件名、依赖与 `apply`。
 *
 * @module @buka/dsh-plugin-skill-update-check
 */

import type { Context } from '@deepseek-ai/cordis'

import { SkillChecker } from './check.ts'
import { registerRoutes } from './routes.ts'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'check-buka-skill-update'

/** 依赖的服务：按会话解析当前工作区。 */
export const inject = ['sessions']

/**
 * 装配：建立检查器并注册浏览器一半用的路由。
 *
 * @param ctx 插件上下文
 */
export function apply(ctx: Context): void {
  registerRoutes(ctx, { checker: new SkillChecker() })
}
