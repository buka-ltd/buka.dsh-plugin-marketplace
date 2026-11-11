/**
 * 「机器人」页面的 HTTP 路由装配。
 *
 * 路由本身按职责拆在 `routes/robots.ts` 与 `routes/skills.ts`；这里只做两件事：
 * 等 `webServer` / `connection` 就绪，然后把两组精确路由注册到同一个 web
 * 上下文上。
 *
 * @module @buka/dsh-plugin-robots/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RobotRouteDeps } from './routes/robots.ts'
import { registerRobotRoutes } from './routes/robots.ts'
import { registerSkillRoutes } from './routes/skills.ts'

/** 路由装配依赖：两个目录路径与登记表写队列由入口提供。 */
export interface RouteDeps extends RobotRouteDeps {}

/**
 * 在 `webServer` 就绪后注册页面用到的全部精确路由。
 *
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): void {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    registerRobotRoutes(ctx, webCtx, deps)
    registerSkillRoutes(webCtx, deps)
  })
}
