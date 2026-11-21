/**
 * 浏览器一半用的两条包内 HTTP 路由：检查与更新当前会话所在工作区的项目技能。
 *
 * - `GET /buka-skill-update-check/status` 检查；`refresh=1` 跳过 5 分钟缓存。
 * - `POST /buka-skill-update-check/update` 更新；请求体是
 *   `{ sessionId, skills? }`，省略 `skills` 表示更新检查得到的全部。名字会先
 *   与一次强制检查的结果求交集，Host 不接受浏览器指定的路径。
 *
 * 路由只接受会话 id，不接受路径：当前工作区由 Host 从 `sessions` 与
 * `workspaceRegistry` 解析，浏览器无法借此读写任意目录。请求沿用 web 组合的
 * 信任栅栏（`connection.requestRejection`），只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-skill-update-check/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  contentTypeOf,
  describeError,
  readBoundedBody,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'

import type { SkillChecker } from './check.ts'
import type { SkillUpdatesSnapshot } from './types.ts'
import type { SessionLike, WorkspaceRegistryLike } from './workspace.ts'
import { resolveWorkspaceDir } from './workspace.ts'

/** 浏览器一半按同一常量访问。 */
export const CHECK_ROUTE = '/buka-skill-update-check/status'

/** 更新路由；请求体只有会话 id 与若干 skill 名。 */
export const UPDATE_ROUTE = '/buka-skill-update-check/update'

/** 会话 id 的宽松上限；真实 id 远小于它。 */
const MAX_SESSION_ID_LENGTH = 128

/** 单个 skill 名的长度上限；真实名字远小于它。 */
const MAX_SKILL_NAME_LENGTH = 200

/** 一次请求里最多接受的 skill 名数量，防止异常请求撑大请求体。 */
const MAX_SKILLS = 500

/** 更新请求体的上限；只装一个会话 id 与若干名字。 */
const MAX_BODY_BYTES = 64 * 1024

/** 路由需要的共享依赖。 */
export interface RouteDeps {
  readonly checker: SkillChecker
}

/**
 * 注册检查与更新路由。
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

    /** 会话 id → 工作区目录；解析不出来时返回 undefined。 */
    function resolveDirFor(sessionId: string): string | undefined {
      // 空白新会话可能还没有进入 sessions 仓库，但已经挂在工作区的
      // `sessionIds` 里；所以这里拿不到会话也不算失败，继续用注册表解析。
      let session: SessionLike | undefined
      try {
        session = webCtx.sessions.get(sessionId)
      } catch {
        session = undefined
      }
      const registry = registryOf(webCtx)
      return resolveWorkspaceDir({
        sessionId,
        ...(session === undefined ? {} : { session }),
        ...(registry === undefined ? {} : { registry }),
      })
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

            const dir = resolveDirFor(sessionId)
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

    // 更新会改写工作区里的 lock 与安装目录，所以只接受 POST，且名字必须先在
    // 一次强制检查里确认过；浏览器不能把任意字符串送进 CLI。
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: UPDATE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }

            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const record =
              body !== null && typeof body === 'object' && !Array.isArray(body)
                ? (body as { sessionId?: unknown; skills?: unknown })
                : {}

            const sessionId = sessionIdOf(record.sessionId)
            if (sessionId === undefined) {
              sendError(res, 400, 'invalid-session', 'sessionId 缺失或非法')
              return
            }
            const skills = skillsOf(record.skills)
            if (skills === null) {
              sendError(res, 400, 'invalid-request', 'skills 必须是 skill 名组成的非空数组')
              return
            }

            const dir = resolveDirFor(sessionId)
            if (dir === undefined) {
              sendError(res, 409, 'no-workspace', '当前会话没有可更新的工作区目录')
              return
            }

            try {
              const result = await deps.checker.update(dir, skills === undefined ? {} : { skills })
              const status = result.ok ? 200 : result.code === 'cli-unavailable' ? 503 : 500
              sendJson(res, status, result)
            } catch (error) {
              sendError(res, 500, 'update-failed', describeError(error))
            }
          },
        }),
      `buka-skill-update-check: POST ${UPDATE_ROUTE}`,
    )
  })
}

/**
 * 读取并解析 JSON 请求体。
 *
 * 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
 * 返回 `undefined` 让调用方直接返回；合法 JSON 原样返回；`null` 也是合法 JSON。
 */
async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | undefined> {
  if (contentTypeOf(req) !== 'application/json') {
    sendError(res, 415, 'invalid-request', 'content-type 必须是 application/json')
    return undefined
  }
  const text = await readBoundedBody(req, MAX_BODY_BYTES)
  if (text === null) {
    sendError(res, 413, 'invalid-request', '请求体过大')
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    sendError(res, 400, 'invalid-request', '请求体不是合法 JSON')
    return undefined
  }
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

/**
 * 校验请求里的 skill 名数组。
 *
 * @returns 省略时 `undefined`（更新全部）；非法时 `null`；否则是去重后的名字
 */
function skillsOf(value: unknown): readonly string[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SKILLS) return null

  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const name = item.trim()
    if (name === '' || name.length > MAX_SKILL_NAME_LENGTH) return null
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/** 工作区注册表是可选服务；取不到时退回会话 header 的 cwd。 */
function registryOf(ctx: Context): WorkspaceRegistryLike | undefined {
  try {
    return ctx.get('workspaceRegistry')
  } catch {
    return undefined
  }
}
