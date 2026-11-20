/**
 * 浏览器一半用的一条包内 HTTP 路由：检查当前会话所在工作区的项目技能。
 *
 * 路由只接受会话 id，不接受路径：当前工作区由 Host 从 `sessions` 与
 * `workspaceRegistry` 解析，浏览器无法借此读取任意目录。请求沿用 web 组合的
 * 信任栅栏（`connection.requestRejection`），只接受本机、已认证的浏览器请求。
 *
 * `refresh=1` 跳过 5 分钟缓存，对应提示上的一次点击。
 *
 * @module @buka/dsh-plugin-skill-update-check/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { describeError, sendError, sendJson, sendMethodNotAllowed } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'

import type { SkillChecker } from './check.ts'
import type { SkillUpdatesSnapshot } from './types.ts'
import type { SessionLike, WorkspaceRegistryLike } from './workspace.ts'
import { resolveWorkspaceDir } from './workspace.ts'

/** 浏览器一半按同一常量访问。 */
export const CHECK_ROUTE = '/buka-skill-update-check/status'

/** 会话 id 的宽松上限；真实 id 远小于它。 */
const MAX_SESSION_ID_LENGTH = 128

/** 路由需要的共享依赖。 */
export interface RouteDeps {
  readonly checker: SkillChecker
}

/**
 * 注册检查路由。
 *
 * @param ctx 插件上下文
 * @param deps 入口装配好的检查器
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): void {
  ctx.inject(['webServer', 'connection', 'sessions'], (webCtx) => {
    /** 复用 web 组合的信任栅栏；被拒绝时已经写好响应。 */
    function rejected(req: IncomingMessage, res: ServerResponse): boolean {
      let rejection: number | undefined
      try {
        rejection = webCtx.connection.requestRejection(req)
      } catch {
        rejection = 500
      }
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
    }

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: CHECK_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }

            const params = queryOf(req)
            const sessionId = sessionIdOf(params.get('sessionId'))
            if (sessionId === undefined) {
              sendError(res, 400, 'invalid-session', 'sessionId 缺失或非法')
              return
            }

            // 空白新会话可能还没有进入 sessions 仓库，但已经挂在工作区的
            // `sessionIds` 里；所以这里拿不到会话也不算失败，继续用注册表解析。
            let session: SessionLike | undefined
            try {
              session = webCtx.sessions.get(sessionId)
            } catch {
              session = undefined
            }

            const registry = registryOf(webCtx)
            const dir = resolveWorkspaceDir({
              sessionId,
              session,
              ...(registry === undefined ? {} : { registry }),
            })
            if (dir === undefined) {
              const snapshot: SkillUpdatesSnapshot = {
                ok: true,
                status: 'unavailable',
                total: 0,
                updates: [],
                checkedAt: Date.now(),
                message: '当前会话没有可检查的工作区目录。',
              }
              sendJson(res, 200, snapshot)
              return
            }

            try {
              const checked = await deps.checker.check(dir, {
                refresh: params.get('refresh') === '1',
              })
              const status = checked.ok ? 200 : checked.code === 'cli-unavailable' ? 503 : 500
              sendJson(res, status, checked)
            } catch (error) {
              sendError(res, 500, 'check-failed', describeError(error))
            }
          },
        }),
      `buka-skill-update-check: GET ${CHECK_ROUTE}`,
    )
  })
}

/** 解析 GET 查询串。 */
function queryOf(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/** 校验请求里的会话 id。 */
function sessionIdOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return undefined
  return id
}

/** 工作区注册表是可选服务；取不到时退回会话 header 的 cwd。 */
function registryOf(ctx: Context): WorkspaceRegistryLike | undefined {
  try {
    return ctx.get('workspaceRegistry')
  } catch {
    return undefined
  }
}
