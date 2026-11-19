/**
 * `@buka/dsh-plugin-pen` 的 Host 一半：把 pen MCP 变成新会话框里的一个勾选框。
 *
 * 勾选后，这条会话的 Agent 作用域里挂一个 `@deepseek-ai/dsh-mcp-client`，
 * 工具（`mcp__pencil__*`）只对该会话可见；不勾选的会话看不到、也不会为它
 * 启动 pen 进程。具体时机与状态机在 `controller.ts`，HTTP 路由在 `routes.ts`。
 *
 * 本文件只装配：导出 Cordis 插件名、依赖、配置与 `apply`。
 *
 * @module @buka/dsh-plugin-pen
 */

import type { Context } from '@deepseek-ai/cordis'
// 类型增强：`ctx.agents` 与 `agent/created` 等事件。
import type {} from '@deepseek-ai/dsh-agent'
// 类型增强：`session/disposed` 与 `SessionId`。
import type {} from '@deepseek-ai/dsh-session'

import type { PenConfig } from './config.ts'
import { PenController } from './controller.ts'
import { registerRoutes } from './routes.ts'

/** 插件配置：pen MCP 的启动方式。 */
export { Config } from './config.ts'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'mcp-buka-pen'

/** 依赖的 DSH 服务：按会话拿 Agent、按会话事件跟进创建与销毁。 */
export const inject = ['agents']

/**
 * 装配：建立控制器、监听 Agent 生命周期、注册浏览器一半用的路由。
 *
 * @param ctx 插件上下文
 * @param config 解析后的配置
 */
export function apply(ctx: Context, config: PenConfig): void {
  const pen = new PenController(ctx, config)
  pen.watch()
  registerRoutes(ctx, pen)
}
