/**
 * 浏览器一半的只读路由：运行列表 / 详情 / 附件读取 / 自动归档设置 / 模板目录。
 *
 * 页面只读取落盘的运行记录，不提供“运行工作流”：workflow 由 agent 在会话里
 * 现场创建；唯一的写入口是自动归档设置（settings 文件）。路由沿用 web 组合
 * 的信任栅栏，只接受本机、已认证的浏览器请求。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import {
  attachmentPreviewInfo,
  DEFAULT_PREVIEW_TEXT_BYTES,
  readAttachmentRange,
} from './attachments.ts'
import { buildRunGraph, buildTemplateGraph, layoutRunGraph } from './graph.ts'
import {
  parseLimit,
  pipeAttachment,
  readJsonBody,
  sendError,
  sendJson,
  sendMethodNotAllowed,
  settingsPayload,
} from './http.ts'
import { describeError } from './render.ts'
import type { WorkflowRunStore } from './run-store.ts'
import { readSettings, validateSettingsInput, writeSettings } from './settings.ts'
import { listTemplates } from './templates.ts'

/** 浏览器一半读取运行列表的路由。 */
const RUNS_ROUTE = '/buka-workflows/runs'

/** 浏览器一半读取单次运行详情的路由。 */
const RUN_ROUTE = '/buka-workflows/run'

/** 浏览器一半读取 / 预览节点附件的路由。 */
const ATTACHMENT_ROUTE = '/buka-workflows/attachment'

/** 浏览器一半读 / 写自动归档设置的路由。 */
const SETTINGS_ROUTE = '/buka-workflows/settings'

/** 浏览器一半读取工作流模板目录的路由。 */
const TEMPLATES_ROUTE = '/buka-workflows/templates'
/** 路由注册依赖：插件装配时传进来的上下文与已建好的存储。 */
interface WorkflowRouteDeps {
  ctx: Context
  store: WorkflowRunStore
  settingsFile: string
  ensureReady: () => Promise<void>
}

/**
 * 注册浏览器一半的所有只读路由。
 *
 * @param deps 上下文、存储、设置文件路径与初始化函数
 */
export function registerWorkflowRoutes({
  ctx,
  store,
  settingsFile,
  ensureReady,
}: WorkflowRouteDeps): void {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    /**
     * 复用 web 组合的信任栅栏；被拒绝时已经写好响应。
     *
     * @param req
     * @param res
     * @returns
     */
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

    /**
     * 读取查询参数。
     *
     * @param req
     * @returns
     */
    function requestUrl(req: IncomingMessage): URL {
      return new URL(req.url ?? '/', 'http://localhost')
    }

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: RUNS_ROUTE,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            try {
              await ensureReady()
              const params = requestUrl(req).searchParams
              const limit = parseLimit(params.get('limit'))
              // 默认只看未归档的运行；?archived=1 是页面「查看已归档」用的。
              const archived = params.get('archived') === '1'
              const [runs, archivedCount] = await Promise.all([
                store.listRuns(limit, { archived }),
                store.countArchived(),
              ])
              sendJson(res, 200, { ok: true, runs, archivedCount })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 读取运行列表失败：%s', describeError(error))
              sendError(res, 500, 'list-failed', `读取运行列表失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET ${RUNS_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: SETTINGS_ROUTE,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (rejected(req, res)) return
            if (req.method === 'GET') {
              try {
                const settings = await readSettings({ file: settingsFile })
                sendJson(res, 200, { ok: true, settings: settingsPayload(settings) })
              } catch (error) {
                webCtx.logger?.warn?.('buka-workflows: 读取归档设置失败：%s', describeError(error))
                sendError(res, 500, 'settings-failed', `读取归档设置失败：${describeError(error)}`)
              }
              return
            }
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'GET, POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const parsed = validateSettingsInput(body)
            if (!parsed.ok) {
              sendError(res, 400, 'invalid-settings', parsed.message)
              return
            }
            try {
              await ensureReady()
              const saved = await writeSettings({
                file: settingsFile,
                settings: { version: 1, archive: parsed.archive },
              })
              // 保存后立即生效：更新存储策略并马上扫一次，页面刷新就能看到归档结果。
              store.setRetention(saved.settings.archive)
              await store.sweep()
              webCtx.logger?.info?.(
                'buka-workflows: 自动归档设置已更新（%s，归档 %s 小时，删除 %s 小时）',
                saved.settings.archive.enabled ? '启用' : '停用',
                saved.settings.archive.archiveAfterHours,
                saved.settings.archive.deleteAfterHours,
              )
              sendJson(res, 200, {
                ok: true,
                settings: settingsPayload(saved.settings),
                archivedCount: await store.countArchived(),
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 保存归档设置失败：%s', describeError(error))
              sendError(res, 500, 'settings-failed', `保存归档设置失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET/POST ${SETTINGS_ROUTE}`,
    )

    // 工作流模板目录：只读，供浏览器「模板」页签展示。内容与编排 agent 的
    // `buka_workflow_templates` 工具读同一份静态目录。
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: TEMPLATES_ROUTE,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            try {
              // 每份模板都附带一份算好坐标的图模型：页面只渲染，模板页签复用运行
              // 详情那套纵向节点图，不自己推布局。
              const templates = listTemplates().map((template) => {
                const model = buildTemplateGraph(template)
                return {
                  ...template,
                  graph: model === null ? null : { ...model, ...layoutRunGraph(model) },
                }
              })
              sendJson(res, 200, { ok: true, templates })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 读取工作流模板失败：%s', describeError(error))
              sendError(res, 500, 'templates-failed', `读取工作流模板失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET ${TEMPLATES_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: RUN_ROUTE,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            const runId = requestUrl(req).searchParams.get('runId') ?? ''
            if (runId.trim() === '') {
              sendError(res, 400, 'invalid-run-id', 'runId is required')
              return
            }
            try {
              await ensureReady()
              const run = await store.readRun(runId.trim())
              if (run === null) {
                sendError(res, 404, 'not-found', `workflow run not found: ${runId}`)
                return
              }
              const [definition, nodeResults] = await Promise.all([
                store.readDefinition(run.runId),
                store.readNodeResults(run.runId),
              ])
              // 图模型与坐标一次算好：页面只渲染，单测直接断言几何结果。
              // 机器人头像从 robots 服务拿（只读登记表）；插件没装 / 表损坏时没有
              // 头像表，图照常绘制，只是胶囊前不画头像。
              const model = buildRunGraph({ run, definition, avatars: await robotAvatars(ctx) })
              sendJson(res, 200, {
                ok: true,
                run,
                definition,
                nodeResults,
                graph: model === null ? null : { ...model, ...layoutRunGraph(model) },
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 读取运行详情失败：%s', describeError(error))
              sendError(res, 500, 'read-failed', `读取运行详情失败：${describeError(error)}`)
            }
          },
        }),
      `buka-workflows: GET ${RUN_ROUTE}`,
    )

    // 附件读取：只读、只允许清单里的文件。参数非法或文件已删除时返回 404，
    // 不把 runs 目录里的其它文件暴露出去。默认下载；`mode=preview` 返回预览元数据
    // 与有界文本，`mode=inline` 只对白名单图片 / PDF 返回原始字节供页面内联。
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: ATTACHMENT_ROUTE,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            const params = requestUrl(req).searchParams
            const runId = (params.get('runId') ?? '').trim()
            const nodeId = (params.get('nodeId') ?? '').trim()
            const name = params.get('name') ?? ''
            const seq = Number.parseInt(params.get('seq') ?? '', 10)
            const mode = params.get('mode') ?? 'download'
            if (mode !== 'download' && mode !== 'preview' && mode !== 'inline') {
              sendError(res, 400, 'invalid-mode', 'mode must be download, preview or inline')
              return
            }
            if (runId === '' || nodeId === '' || name === '') {
              sendError(res, 400, 'invalid-attachment', 'runId, seq, nodeId and name are required')
              return
            }
            if (!Number.isInteger(seq) || seq <= 0) {
              sendError(res, 400, 'invalid-seq', 'seq must be a positive integer')
              return
            }
            if (runId === '.' || runId === '..' || runId.includes('/') || runId.includes('\\')) {
              sendError(res, 400, 'invalid-run-id', 'runId must be a single path segment')
              return
            }
            try {
              await ensureReady()
              let attachment = null
              try {
                attachment = await store.openAttachment(runId, seq, nodeId, name)
              } catch {
                attachment = null
              }
              if (attachment === null) {
                sendError(res, 404, 'not-found', 'attachment not found')
                return
              }
              const preview = attachmentPreviewInfo(attachment.name)
              if (mode === 'download') {
                pipeAttachment(res, attachment, {
                  log: (error: unknown) =>
                    webCtx.logger?.warn?.('buka-workflows: 读取附件失败：%s', describeError(error)),
                })
                return
              }
              if (mode === 'inline') {
                if (preview.kind !== 'image' && preview.kind !== 'pdf') {
                  sendError(
                    res,
                    415,
                    'unsupported-preview',
                    'this attachment type cannot be previewed inline',
                  )
                  return
                }
                pipeAttachment(res, attachment, {
                  inline: true,
                  mime: preview.mime,
                  log: (error: unknown) =>
                    webCtx.logger?.warn?.('buka-workflows: 读取附件失败：%s', describeError(error)),
                })
                return
              }
              // preview：图片 / PDF 只回元数据，正文走 `mode=inline`；其余先按文本读
              // 有界的一段，读不出 UTF-8 时降级成 binary 让页面显示下载入口。
              if (preview.kind !== 'text') {
                sendJson(res, 200, {
                  ok: true,
                  attachment: {
                    name: attachment.name,
                    bytes: attachment.bytes,
                    kind: preview.kind,
                    mime: preview.mime,
                  },
                })
                return
              }
              const range = await readAttachmentRange(attachment.path, {
                maxBytes: DEFAULT_PREVIEW_TEXT_BYTES,
              })
              if (range.text === null) {
                sendJson(res, 200, {
                  ok: true,
                  attachment: {
                    name: attachment.name,
                    bytes: attachment.bytes,
                    kind: 'binary',
                    mime: null,
                  },
                })
                return
              }
              sendJson(res, 200, {
                ok: true,
                attachment: {
                  name: attachment.name,
                  bytes: attachment.bytes,
                  kind: 'text',
                  mime: 'text/plain',
                  text: range.text,
                  truncated: range.truncated,
                  read: range.read,
                  offset: range.offset,
                },
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-workflows: 读取附件失败：%s', describeError(error))
              if (!res.headersSent)
                sendError(
                  res,
                  500,
                  'read-failed',
                  `attachment could not be read: ${describeError(error)}`,
                )
              else res.destroy(error as Error | undefined)
            }
          },
        }),
      `buka-workflows: GET ${ATTACHMENT_ROUTE}`,
    )
  })
}

/**
 * 取「机器人名 → 头像 id」表，给运行页的节点图用。
 *
 * robots 插件没装、服务没有 `avatarMap()` 或登记表损坏时返回 null；这只是展示
 * 细节，绝不能因为它让运行详情接口失败。
 *
 * @param ctx 插件上下文
 * @returns 机器人名 → 头像 id；不可用时是 null
 */
async function robotAvatars(ctx: Context): Promise<Record<string, string> | null> {
  try {
    const robots = ctx.get('bukaRobots')
    if (robots === null || robots === undefined || typeof robots.avatarMap !== 'function')
      return null
    const map: unknown = await robots.avatarMap()
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return null
    return map as Record<string, string>
  } catch {
    return null
  }
}
