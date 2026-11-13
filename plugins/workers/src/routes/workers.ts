/**
 * 「打工人」页面的打工人相关 HTTP 路由。
 *
 * 负责登记表与目录的打工人管理接口：列表、创建、头像、描述、模型、助理标记、
 * 重命名、移除、写 AGENTS.md 与打开 Finder。工作区身份（挂载 / 删除注册 / 打开会话）都由
 * 浏览器一半走 DSH Client Service，这里只处理磁盘事实。
 *
 * 机器人（内建 clock）只读：创建 / 删除 / 改名 / 改字段都会被拒绝，
 * 助理标记只对智能体开放。
 *
 * @module @buka/dsh-plugin-workers/routes/workers
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { buildWorker } from '../builder.ts'
import { buildWorkerModelCatalog } from '../model-catalog.ts'
import { revealDirectory } from '../reveal.ts'
import type { WorkerModelSelection } from '../store/types.ts'
import {
  AGENTS_MAX_WRITE_BYTES,
  addWorker,
  ensureClaudeLink,
  isValidWorkerName,
  listWorkers,
  readAgentsFile,
  removeWorker,
  setWorkerAssistant,
  setWorkerAvatar,
  setWorkerDescription,
  setWorkerModel,
  WORKER_DESCRIPTION_MAX_LENGTH,
  writeAgentsFile,
} from '../worker-store.ts'
import {
  describeError,
  errorCode,
  readJsonBody,
  rejected,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from './http.ts'
import type { WorkerRouteError } from './target.ts'
import { resolveWorker } from './target.ts'

/** 页面列出打工人用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-workers/list'

/** 页面新建打工人用的路由。 */
const CREATE_ROUTE = '/buka-workers/create'

/** 页面给打工人换头像用的路由。 */
const AVATAR_ROUTE = '/buka-workers/avatar'

/** 页面编辑打工人描述用的路由。 */
const DESCRIPTION_ROUTE = '/buka-workers/description'

/** 页面读取可选模型目录用的路由。 */
const MODELS_ROUTE = '/buka-workers/models'

/** 页面给智能体设置新会话模型用的路由。 */
const MODEL_ROUTE = '/buka-workers/model'

/** 页面标记 / 取消助理（只有智能体可设）用的路由。 */
const ASSISTANT_ROUTE = '/buka-workers/assistant'

/** 页面重命名打工人（改目录 + 重建工作区）用的路由。 */
const RENAME_ROUTE = '/buka-workers/rename'

/** 页面删除打工人（只删登记）用的路由。 */
const REMOVE_ROUTE = '/buka-workers/remove'

/** 页面写入 AGENTS.md 用的路由。 */
const AGENTS_ROUTE = '/buka-workers/agents'

/** 页面「打开 Finder」用的路由。 */
const REVEAL_ROUTE = '/buka-workers/reveal'

/** 打工人路由的依赖：由入口装配时传入，路由本身不持有全局状态。 */
export interface WorkerRouteDeps {
  workersDir: string
  registryFile: string
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
}

/**
 * 注册打工人管理相关的精确路由。
 *
 */
export function registerWorkerRoutes(
  hostCtx: Context,
  webCtx: Context,
  deps: WorkerRouteDeps,
): void {
  const { workersDir, registryFile, serializeRegistry } = deps
  // 路由体沿用入口里的 `ctx` 名字读 workspaceRegistry，避免搬运时改散逻辑。
  const ctx = hostCtx

  /** 把 resolveWorker 的错误写成响应。 */
  function sendWorkerError(res: ServerResponse, error: WorkerRouteError): void {
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
            const snapshot = await listWorkers({
              file: registryFile,
              workspaceRegistry: ctx.workspaceRegistry,
              workersDir,
            })
            sendJson(res, 200, { ok: true, ...snapshot })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 读取打工人列表失败：%s', describeError(error))
            sendError(res, 500, 'list-failed', `读取打工人列表失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: GET ${LIST_ROUTE}`,
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
          if (!isValidWorkerName(name)) {
            sendError(
              res,
              400,
              'invalid-name',
              '打工人名称不合法：需要 1–64 个字符，不能以点开头，只能包含字母、数字、汉字与 ._-。',
            )
            return
          }
          // v1 不允许创建机器人：它们由插件内建登记（只有 clock）。
          if (body?.driver !== undefined && body.driver !== 'agent') {
            sendError(
              res,
              400,
              'invalid-driver',
              '只能创建智能体；机器人由插件内建登记，不能创建。',
            )
            return
          }
          // 头像可选：不传 / 传了非法 id 时由 addWorker 按名字分配默认头像。
          const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''
          if (body?.description !== undefined && typeof body.description !== 'string') {
            sendError(res, 400, 'invalid-description', 'description 必须是字符串')
            return
          }
          const description = typeof body?.description === 'string' ? body.description : ''

          try {
            const result = await serializeRegistry(() =>
              addWorker({ workersDir, file: registryFile, name, avatar, description }),
            )
            webCtx.logger?.info?.(
              'buka-workers: 已登记打工人 %s（%s）',
              result.worker.name,
              result.worker.path,
            )
            sendJson(res, 200, { ok: true, worker: result.worker, created: result.created })
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
                `描述需要不超过 ${WORKER_DESCRIPTION_MAX_LENGTH} 个字符的单行文本。`,
              )
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            if (errorCode(error) === 'builtin-worker' || errorCode(error) === 'robot-worker') {
              sendError(res, 409, String(errorCode(error)), describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-workers: 创建打工人失败：%s', describeError(error))
            sendError(res, 500, 'create-failed', `创建打工人失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${CREATE_ROUTE}`,
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
          if (!isValidWorkerName(name)) {
            sendError(res, 400, 'invalid-name', `打工人名称不合法：${String(body?.name)}`)
            return
          }
          const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''

          try {
            const result = await serializeRegistry(() =>
              setWorkerAvatar({ file: registryFile, name, avatar }),
            )
            webCtx.logger?.info?.('buka-workers: 打工人 %s 的头像改为 %s', name, avatar)
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            if (errorCode(error) === 'invalid-avatar') {
              sendError(res, 400, 'invalid-avatar', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'unknown-worker') {
              sendError(res, 404, 'unknown-worker', describeError(error))
              return
            }
            if (errorCode(error) === 'robot-worker') {
              sendError(res, 409, 'robot-worker', describeError(error))
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-workers: 修改打工人头像失败：%s', describeError(error))
            sendError(res, 500, 'avatar-failed', `修改打工人头像失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${AVATAR_ROUTE}`,
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
          if (!isValidWorkerName(name)) {
            sendError(res, 400, 'invalid-name', `打工人名称不合法：${String(body?.name)}`)
            return
          }
          const description = body?.description
          if (typeof description !== 'string') {
            sendError(res, 400, 'invalid-description', 'description 必须是字符串')
            return
          }

          try {
            const result = await serializeRegistry(() =>
              setWorkerDescription({ file: registryFile, name, description }),
            )
            webCtx.logger?.info?.('buka-workers: 已更新打工人 %s 的描述', name)
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            if (errorCode(error) === 'invalid-description') {
              sendError(
                res,
                400,
                'invalid-description',
                `描述需要不超过 ${WORKER_DESCRIPTION_MAX_LENGTH} 个字符的单行文本。`,
              )
              return
            }
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'unknown-worker') {
              sendError(res, 404, 'unknown-worker', describeError(error))
              return
            }
            if (errorCode(error) === 'robot-worker') {
              sendError(res, 409, 'robot-worker', describeError(error))
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-workers: 更新打工人描述失败：%s', describeError(error))
            sendError(res, 500, 'description-failed', `更新打工人描述失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${DESCRIPTION_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: MODELS_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          try {
            const catalog = await buildWorkerModelCatalog(ctx, controller.signal)
            sendJson(res, 200, { ok: true, ...catalog })
          } catch (error) {
            if (controller.signal.aborted) return
            webCtx.logger?.warn?.('buka-workers: 读取模型目录失败：%s', describeError(error))
            sendError(res, 500, 'models-failed', `读取模型目录失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: GET ${MODELS_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: MODEL_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          if (!isValidWorkerName(name)) {
            sendError(res, 400, 'invalid-name', `打工人名称不合法：${String(body?.name)}`)
            return
          }
          const model = body?.model
          if (
            model !== null &&
            model !== undefined &&
            (typeof model !== 'object' || Array.isArray(model))
          ) {
            sendError(res, 400, 'invalid-model', 'model 必须是对象或 null')
            return
          }

          try {
            const result = await serializeRegistry(() =>
              setWorkerModel({
                file: registryFile,
                name,
                model:
                  model === null || model === undefined ? null : (model as WorkerModelSelection),
              }),
            )
            webCtx.logger?.info?.('buka-workers: 智能体 %s 的模型已更新', name)
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            if (errorCode(error) === 'invalid-model') {
              sendError(res, 400, 'invalid-model', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'unknown-worker') {
              sendError(res, 404, 'unknown-worker', describeError(error))
              return
            }
            if (errorCode(error) === 'robot-worker') {
              sendError(res, 409, 'robot-worker', describeError(error))
              return
            }
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-workers: 更新智能体模型失败：%s', describeError(error))
            sendError(res, 500, 'model-failed', `更新智能体模型失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${MODEL_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: ASSISTANT_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const name = typeof body?.name === 'string' ? body.name.trim() : ''
          if (!isValidWorkerName(name)) {
            sendError(res, 400, 'invalid-name', `打工人名称不合法：${String(body?.name)}`)
            return
          }
          const assistant = body?.assistant
          if (typeof assistant !== 'boolean') {
            sendError(res, 400, 'invalid-assistant', 'assistant 必须是布尔值')
            return
          }

          try {
            const result = await serializeRegistry(() =>
              setWorkerAssistant({ file: registryFile, name, assistant }),
            )
            webCtx.logger?.info?.(
              'buka-workers: 打工人 %s 的助理标记改为 %s',
              name,
              String(assistant),
            )
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            switch (errorCode(error)) {
              case 'invalid-name':
              case 'invalid-assistant':
                sendError(res, 400, String(errorCode(error)), describeError(error))
                return
              case 'unknown-worker':
                sendError(res, 404, 'unknown-worker', describeError(error))
                return
              case 'robot-worker':
                sendError(res, 409, 'robot-worker', describeError(error))
                return
              case 'registry-unreadable':
                sendError(res, 409, 'registry-unreadable', describeError(error))
                return
              default:
                webCtx.logger?.warn?.('buka-workers: 修改助理标记失败：%s', describeError(error))
                sendError(res, 500, 'assistant-failed', `修改助理标记失败：${describeError(error)}`)
            }
          }
        },
      }),
    `buka-workers: POST ${ASSISTANT_ROUTE}`,
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
          if (!isValidWorkerName(name)) {
            sendError(res, 400, 'invalid-name', `打工人名称不合法：${String(body?.name)}`)
            return
          }
          if (!isValidWorkerName(newName)) {
            sendError(res, 400, 'invalid-name', `新打工人名称不合法：${String(body?.newName)}`)
            return
          }
          if (name === newName) {
            sendError(res, 400, 'invalid-name', '新名称与当前名称相同')
            return
          }

          try {
            // 与构建工具走同一条 buildWorker 路径：目录改名、登记表更新、
            // 工作区重建（旧会话保留但不再挂在该打工人下）语义完全一致。
            const result = await serializeRegistry(() =>
              buildWorker({
                workersDir,
                file: registryFile,
                name,
                newName,
                update: true,
                workspaceRegistry: ctx.workspaceRegistry,
              }),
            )
            webCtx.logger?.info?.(
              'buka-workers: 打工人 %s 已重命名为 %s（%s）',
              name,
              result.worker.name,
              result.worker.path,
            )
            // 带上改名后的 AGENTS.md 摘要：Host 会把未改过的模板同步成新名 /
            // 新路径，页面据此重设草稿，避免「保存」把旧模板写回去。
            const agents = await readAgentsFile(result.worker.path)
            sendJson(res, 200, {
              ok: true,
              previousName: result.previousName,
              renamed: result.renamed,
              worker: result.worker,
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
              case 'unknown-worker':
                sendError(res, 404, 'unknown-worker', describeError(error))
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
              case 'builtin-worker':
                sendError(res, 409, 'builtin-worker', describeError(error))
                return
              case 'robot-worker':
                sendError(res, 409, 'robot-worker', describeError(error))
                return
              default:
                webCtx.logger?.warn?.('buka-workers: 重命名打工人失败：%s', describeError(error))
                sendError(res, 500, 'rename-failed', `重命名打工人失败：${describeError(error)}`)
            }
          }
        },
      }),
    `buka-workers: POST ${RENAME_ROUTE}`,
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
          if (!isValidWorkerName(name)) {
            sendError(res, 400, 'invalid-name', `打工人名称不合法：${String(body?.name)}`)
            return
          }

          try {
            const result = await serializeRegistry(() => removeWorker({ file: registryFile, name }))
            if (result.removed) webCtx.logger?.info?.('buka-workers: 已移除打工人登记 %s', name)
            sendJson(res, 200, { ok: true, name, removed: result.removed })
          } catch (error) {
            if (errorCode(error) === 'registry-unreadable') {
              sendError(res, 409, 'registry-unreadable', describeError(error))
              return
            }
            if (errorCode(error) === 'builtin-worker' || errorCode(error) === 'robot-worker') {
              sendError(res, 409, String(errorCode(error)), describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-workers: 移除打工人失败：%s', describeError(error))
            sendError(res, 500, 'remove-failed', `移除打工人失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${REMOVE_ROUTE}`,
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

          const resolved = await resolveWorker(registryFile, body?.name)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
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
            const saved = await writeAgentsFile(resolved.worker.path, body.content)
            // 每次保存后补一次 CLAUDE.md 链接：旧打工人第一次保存时自动修复。
            const claude = await ensureClaudeLink(resolved.worker.path)
            webCtx.logger?.info?.('buka-workers: 已保存 AGENTS.md（%s）', resolved.worker.path)
            sendJson(res, 200, { ok: true, ...saved, claude })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 写入 AGENTS.md 失败：%s', describeError(error))
            sendError(res, 500, 'write-failed', `写入 AGENTS.md 失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${AGENTS_ROUTE}`,
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

          const resolved = await resolveWorker(registryFile, body?.name)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
            return
          }

          try {
            await revealDirectory(resolved.worker.path)
            webCtx.logger?.info?.('buka-workers: 已打开打工人目录（%s）', resolved.worker.path)
            sendJson(res, 200, { ok: true, path: resolved.worker.path })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 打开打工人目录失败：%s', describeError(error))
            sendError(res, 500, 'reveal-failed', `打开打工人目录失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${REVEAL_ROUTE}`,
  )
}
