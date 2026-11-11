/**
 * 「机器人」页面的机器人相关 HTTP 路由。
 *
 * 负责登记表与目录的机器人管理接口：列表、创建、头像、描述、重命名、移除、
 * 写 AGENTS.md 与打开 Finder。工作区身份（挂载 / 删除注册 / 打开会话）都由
 * 浏览器一半走 DSH Client Service，这里只处理磁盘事实。
 *
 * @module @buka/dsh-plugin-robots/routes/robots
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { buildRobot } from '../builder.ts'
import { revealDirectory } from '../reveal.ts'
import {
  AGENTS_MAX_WRITE_BYTES,
  addRobot,
  ensureClaudeLink,
  isValidRobotName,
  listRobots,
  ROBOT_DESCRIPTION_MAX_LENGTH,
  readAgentsFile,
  removeRobot,
  setRobotAvatar,
  setRobotDescription,
  writeAgentsFile,
} from '../robot-store.ts'
import {
  describeError,
  errorCode,
  readJsonBody,
  rejected,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from './http.ts'
import type { RobotRouteError } from './target.ts'
import { resolveRobot } from './target.ts'

/** 页面列出机器人用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-robots/list'

/** 页面新建机器人用的路由。 */
const CREATE_ROUTE = '/buka-robots/create'

/** 页面给机器人换头像用的路由。 */
const AVATAR_ROUTE = '/buka-robots/avatar'

/** 页面编辑机器人描述用的路由。 */
const DESCRIPTION_ROUTE = '/buka-robots/description'

/** 页面重命名机器人（改目录 + 重建工作区）用的路由。 */
const RENAME_ROUTE = '/buka-robots/rename'

/** 页面删除机器人（只删登记）用的路由。 */
const REMOVE_ROUTE = '/buka-robots/remove'

/** 页面写入 AGENTS.md 用的路由。 */
const AGENTS_ROUTE = '/buka-robots/agents'

/** 页面「打开 Finder」用的路由。 */
const REVEAL_ROUTE = '/buka-robots/reveal'

/** 机器人路由的依赖：由入口装配时传入，路由本身不持有全局状态。 */
export interface RobotRouteDeps {
  robotsDir: string
  registryFile: string
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
}

/**
 * 注册机器人管理相关的精确路由。
 *
 */
export function registerRobotRoutes(hostCtx: Context, webCtx: Context, deps: RobotRouteDeps): void {
  const { robotsDir, registryFile, serializeRegistry } = deps
  // 路由体沿用入口里的 `ctx` 名字读 workspaceRegistry，避免搬运时改散逻辑。
  const ctx = hostCtx

  /** 把 resolveRobot 的错误写成响应。 */
  function sendRobotError(res: ServerResponse, error: RobotRouteError): void {
    sendError(res, error.status, error.code, error.message)
  }

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: LIST_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          try {
            const snapshot = await listRobots({
              file: registryFile,
              workspaceRegistry: ctx.workspaceRegistry,
              robotsDir,
            })
            sendJson(res, 200, { ok: true, ...snapshot })
          } catch (error) {
            webCtx.logger?.warn?.('buka-robots: 读取机器人列表失败：%s', describeError(error))
            sendError(res, 500, 'list-failed', `读取机器人列表失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: GET ${LIST_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: CREATE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          if (!isValidRobotName(name)) {
            sendError(
              res,
              400,
              'invalid-name',
              '机器人名称不合法：需要 1–64 个字符，不能以点开头，只能包含字母、数字、汉字与 ._-。',
            )
            return
          }
          // 头像可选：不传 / 传了非法 id 时由 addRobot 按名字分配默认头像。
          const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''
          if (body?.description !== undefined && typeof body.description !== 'string') {
            sendError(res, 400, 'invalid-description', 'description 必须是字符串')
            return
          }
          const description = typeof body?.description === 'string' ? body.description : ''

          try {
            const result = await serializeRegistry(() =>
              addRobot({ robotsDir, file: registryFile, name, avatar, description }),
            )
            webCtx.logger?.info?.(
              'buka-robots: 已登记机器人 %s（%s）',
              result.robot.name,
              result.robot.path,
            )
            sendJson(res, 200, { ok: true, robot: result.robot, created: result.created })
          } catch (error) {
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-description') {
              sendError(
                res,
                400,
                'invalid-description',
                `描述需要不超过 ${ROBOT_DESCRIPTION_MAX_LENGTH} 个字符的单行文本。`,
              )
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-robots: 创建机器人失败：%s', describeError(error))
            sendError(res, 500, 'create-failed', `创建机器人失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: POST ${CREATE_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: AVATAR_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          if (!isValidRobotName(name)) {
            sendError(res, 400, 'invalid-name', `机器人名称不合法：${String(body?.name)}`)
            return
          }
          const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''

          try {
            const result = await serializeRegistry(() =>
              setRobotAvatar({ file: registryFile, name, avatar }),
            )
            webCtx.logger?.info?.('buka-robots: 机器人 %s 的头像改为 %s', name, avatar)
            sendJson(res, 200, { ok: true, robot: result.robot })
          } catch (error) {
            if (errorCode(error) === 'invalid-avatar') {
              sendError(res, 400, 'invalid-avatar', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'unknown-robot') {
              sendError(res, 404, 'unknown-robot', describeError(error))
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-robots: 修改机器人头像失败：%s', describeError(error))
            sendError(res, 500, 'avatar-failed', `修改机器人头像失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: POST ${AVATAR_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: DESCRIPTION_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          if (!isValidRobotName(name)) {
            sendError(res, 400, 'invalid-name', `机器人名称不合法：${String(body?.name)}`)
            return
          }
          const description = body?.description
          if (typeof description !== 'string') {
            sendError(res, 400, 'invalid-description', 'description 必须是字符串')
            return
          }

          try {
            const result = await serializeRegistry(() =>
              setRobotDescription({ file: registryFile, name, description }),
            )
            webCtx.logger?.info?.('buka-robots: 已更新机器人 %s 的描述', name)
            sendJson(res, 200, { ok: true, robot: result.robot })
          } catch (error) {
            if (errorCode(error) === 'invalid-description') {
              sendError(
                res,
                400,
                'invalid-description',
                `描述需要不超过 ${ROBOT_DESCRIPTION_MAX_LENGTH} 个字符的单行文本。`,
              )
              return
            }
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'unknown-robot') {
              sendError(res, 404, 'unknown-robot', describeError(error))
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-robots: 更新机器人描述失败：%s', describeError(error))
            sendError(res, 500, 'description-failed', `更新机器人描述失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: POST ${DESCRIPTION_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: RENAME_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          const newName = typeof body?.newName === 'string' ? body.newName.trim() : ''
          if (!isValidRobotName(name)) {
            sendError(res, 400, 'invalid-name', `机器人名称不合法：${String(body?.name)}`)
            return
          }
          if (!isValidRobotName(newName)) {
            sendError(res, 400, 'invalid-name', `新机器人名称不合法：${String(body?.newName)}`)
            return
          }
          if (name === newName) {
            sendError(res, 400, 'invalid-name', '新名称与当前名称相同')
            return
          }

          try {
            // 与构建工具走同一条 buildRobot 路径：目录改名、登记表更新、
            // 工作区重建（旧会话保留但不再挂在该机器人下）语义完全一致。
            const result = await serializeRegistry(() =>
              buildRobot({
                robotsDir,
                file: registryFile,
                name,
                newName,
                update: true,
                workspaceRegistry: ctx.workspaceRegistry,
              }),
            )
            webCtx.logger?.info?.(
              'buka-robots: 机器人 %s 已重命名为 %s（%s）',
              name,
              result.robot.name,
              result.robot.path,
            )
            // 带上改名后的 AGENTS.md 摘要：Host 会把未改过的模板同步成新名 /
            // 新路径，页面据此重设草稿，避免「保存」把旧模板写回去。
            const agents = await readAgentsFile(result.robot.path)
            sendJson(res, 200, {
              ok: true,
              previousName: result.previousName,
              renamed: result.renamed,
              robot: result.robot,
              agents,
              mounted: result.mounted,
              workspaceId: typeof result.workspaceId === 'string' ? result.workspaceId : null,
              mountError: result.mountError,
            })
          } catch (error) {
            switch (errorCode(error)) {
              case 'invalid-name':
                sendError(res, 400, 'invalid-name', describeError(error))
                return
              case 'invalid-update':
                sendError(res, 400, 'invalid-update', describeError(error))
                return
              case 'unknown-robot':
                sendError(res, 404, 'unknown-robot', describeError(error))
                return
              case 'name-taken':
                sendError(res, 409, 'name-taken', describeError(error))
                return
              case 'missing-directory':
                sendError(res, 409, 'missing-directory', describeError(error))
                return
              case 'path-outside-root':
                sendError(res, 409, 'path-outside-root', describeError(error))
                return
              case 'registry-unreadable':
                sendError(res, 409, 'registry-unreadable', describeError(error))
                return
              default:
                webCtx.logger?.warn?.('buka-robots: 重命名机器人失败：%s', describeError(error))
                sendError(res, 500, 'rename-failed', `重命名机器人失败：${describeError(error)}`)
            }
          }
        },
      }),
    `buka-robots: POST ${RENAME_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: REMOVE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          if (!isValidRobotName(name)) {
            sendError(res, 400, 'invalid-name', `机器人名称不合法：${String(body?.name)}`)
            return
          }

          try {
            const result = await serializeRegistry(() => removeRobot({ file: registryFile, name }))
            if (result.removed) webCtx.logger?.info?.('buka-robots: 已移除机器人登记 %s', name)
            sendJson(res, 200, { ok: true, name, removed: result.removed })
          } catch (error) {
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-robots: 移除机器人失败：%s', describeError(error))
            sendError(res, 500, 'remove-failed', `移除机器人失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: POST ${REMOVE_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: AGENTS_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveRobot(registryFile, body?.name)
          if (resolved.error !== undefined) {
            sendRobotError(res, resolved.error)
            return
          }
          if (typeof body?.content !== 'string') {
            sendError(res, 400, 'invalid-content', 'content 必须是字符串')
            return
          }
          if (Buffer.byteLength(body.content, 'utf8') > AGENTS_MAX_WRITE_BYTES) {
            sendError(
              res,
              413,
              'too-large',
              `AGENTS.md 内容超过 ${Math.round(AGENTS_MAX_WRITE_BYTES / 1024)} KiB，请用外部编辑器修改。`,
            )
            return
          }

          try {
            const saved = await writeAgentsFile(resolved.robot.path, body.content)
            // 每次保存后补一次 CLAUDE.md 链接：旧机器人第一次保存时自动修复。
            const claude = await ensureClaudeLink(resolved.robot.path)
            webCtx.logger?.info?.('buka-robots: 已保存 AGENTS.md（%s）', resolved.robot.path)
            sendJson(res, 200, { ok: true, ...saved, claude })
          } catch (error) {
            webCtx.logger?.warn?.('buka-robots: 写入 AGENTS.md 失败：%s', describeError(error))
            sendError(res, 500, 'write-failed', `写入 AGENTS.md 失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: POST ${AGENTS_ROUTE}`,
  )
  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: REVEAL_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveRobot(registryFile, body?.name)
          if (resolved.error !== undefined) {
            sendRobotError(res, resolved.error)
            return
          }

          try {
            await revealDirectory(resolved.robot.path)
            webCtx.logger?.info?.('buka-robots: 已打开机器人目录（%s）', resolved.robot.path)
            sendJson(res, 200, { ok: true, path: resolved.robot.path })
          } catch (error) {
            webCtx.logger?.warn?.('buka-robots: 打开机器人目录失败：%s', describeError(error))
            sendError(res, 500, 'reveal-failed', `打开机器人目录失败：${describeError(error)}`)
          }
        },
      }),
    `buka-robots: POST ${REVEAL_ROUTE}`,
  )
}
