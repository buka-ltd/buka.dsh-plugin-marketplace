/**
 * 试听路由的注册：`POST /buka-bell/preview` 的信任栅栏与请求体解析。
 *
 * @module @buka/dsh-plugin-bell/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { contentTypeOf, readBoundedBody, sendJson, sendMethodNotAllowed } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes'
import type { Player } from './player.ts'
import { isPlayableSound, PREVIEW_ROUTE } from './sounds.ts'

/** 试听请求体只有 `{ sound }`；超过这个大小按恶意请求处理。 */
const MAX_PREVIEW_BODY_BYTES = 4 * 1024

/**
 * 注册四个提示音的试听路由。
 */
export function registerPreviewRoutes(ctx: Context, play: Player): void {
  // 设置页的试听按钮：先听，再决定四个时机各用哪个。播放不动配置，
  // 也不占用各时机的节流门。
  ctx.inject(['webServer', 'connection'], (webCtx) => {
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
          path: PREVIEW_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res, MAX_PREVIEW_BODY_BYTES)
            if (body === undefined) return
            const sound = (body as { sound?: unknown } | null | undefined)?.sound
            if (!isPlayableSound(sound)) {
              sendJson(res, 400, { ok: false, code: 'unknown-sound', message: 'unknown sound' })
              return
            }
            // 试听按「完成音」的候选表播放：cue 只影响未知系统声音名的退路，
            // 而这里的声音名已经校验过，不受影响。
            play('finish', sound)
            sendJson(res, 200, { ok: true })
          },
        }),
      `buka-bell: POST ${PREVIEW_ROUTE}`,
    )
  })
}

/**
 * 读取并解析试听请求体。
 *
 * 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
 * 返回 `undefined` 让调用方直接返回。
 */
async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
): Promise<unknown> {
  if (contentTypeOf(req) !== 'application/json') {
    sendJson(res, 415, { ok: false, message: 'content-type 必须是 application/json' })
    return undefined
  }
  const text = await readBoundedBody(req, maxBytes)
  if (text === null) {
    sendJson(res, 413, { ok: false, message: '请求体过大' })
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
    return undefined
  }
}
