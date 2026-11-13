/**
 * 浏览器一半的 HTTP 路由（ADR 0015 的 v5 契约）：
 * 工作流 / 作业 / 任务 / 附件与动作。
 *
 * 所有路由沿用 web 组合的信任栅栏（`ctx.connection.requestRejection`），只接受
 * 本机同源请求；失败统一 `{ ok: false, code, message }`。
 *
 * @module @buka/dsh-plugin-workflows/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import {
  attachmentPreviewInfo,
  DEFAULT_PREVIEW_TEXT_BYTES,
  readAttachmentRange,
} from '../attachments/index.ts'
import type { WorkflowEngine } from '../engine/engine.ts'
import { describeError, WorkflowError } from '../engine/types.ts'
import {
  parseLimit,
  pipeAttachment,
  readJsonBody,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from '../http.ts'

/** 路由注册依赖。 */
export interface WorkflowRouteDeps {
  readonly ctx: Context
  /** 等存储 / 引擎就绪后返回引擎。 */
  readonly ready: () => Promise<WorkflowEngine>
}

/** 路由路径。 */
const ROUTES = {
  workflows: '/buka-workflows/workflows',
  workflow: '/buka-workflows/workflow',
  workflowActivate: '/buka-workflows/workflow/activate',
  jobs: '/buka-workflows/jobs',
  jobStart: '/buka-workflows/job/start',
  job: '/buka-workflows/job',
  jobAction: '/buka-workflows/job/action',
  task: '/buka-workflows/task',
  taskAction: '/buka-workflows/task/action',
  attachments: '/buka-workflows/attachments',
  attachment: '/buka-workflows/attachment',
} as const

/** 错误码 → HTTP 状态码。 */
function statusForError(error: unknown): number {
  if (error instanceof WorkflowError) {
    switch (error.code) {
      case 'not-found':
        return 404
      case 'workflow-not-active':
      case 'workflow-retired':
        return 409
      case 'job-not-running':
      case 'task-not-running':
      case 'invalid-status':
      case 'not-ready':
      case 'not-failed':
      case 'no-pending-delivery':
        return 409
      default:
        return 400
    }
  }
  return 500
}

/** 统一错误响应。 */
function sendRouteError(
  res: ServerResponse,
  error: unknown,
  logger: { warn?(message: string): void } | undefined,
  fallbackCode = 'internal',
): void {
  const status = statusForError(error)
  const code = error instanceof WorkflowError ? error.code : fallbackCode
  const message = describeError(error)
  if (status >= 500) logger?.warn?.(`buka-workflows: request failed: ${message}`)
  if (!res.headersSent) sendError(res, status, code, message)
  else res.destroy(error instanceof Error ? error : undefined)
}

/** 查询参数。 */
function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams
}

/**
 * 注册全部浏览器路由。
 *
 * @param deps 上下文与引擎 getter
 */
export function registerWorkflowRoutes({ ctx, ready }: WorkflowRouteDeps): void {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    /** 信任栅栏；被拒绝时响应已写出。 */
    const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
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

    /** 注册一条精确路由。 */
    const route = (
      path: string,
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
    ): void => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
              if (rejected(req, res)) return
              try {
                await handler(req, res)
              } catch (error) {
                sendRouteError(res, error, webCtx.logger)
              }
            },
          }),
        `buka-workflows: ${path}`,
      )
    }

    // ---- 工作流 ---------------------------------------------------------
    route(ROUTES.workflows, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const engine = await ready()
      sendJson(res, 200, { ok: true, workflows: engine.listWorkflowSummaries() })
    })

    route(ROUTES.workflow, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const params = query(req)
      const workflowId = (params.get('id') ?? '').trim()
      const versionRaw = params.get('version')
      const version =
        versionRaw === null || versionRaw === '' ? undefined : Number.parseInt(versionRaw, 10)
      if (workflowId === '') return sendError(res, 400, 'invalid-id', 'id is required')
      if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
        return sendError(res, 400, 'invalid-version', 'version must be a positive integer')
      }
      const engine = await ready()
      const detail = await engine.readWorkflowDetail(workflowId, version)
      if (detail === null)
        return sendError(res, 404, 'not-found', `workflow not found: ${workflowId}`)
      sendJson(res, 200, { ok: true, ...detail })
    })

    route(ROUTES.workflowActivate, async (req, res) => {
      if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      const record = body as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (id === '') return sendError(res, 400, 'invalid-id', 'id is required')
      if (typeof record.active !== 'boolean') {
        return sendError(res, 400, 'invalid-active', 'active must be a boolean')
      }
      const engine = await ready()
      const workflow = await engine.setWorkflowActive(id, record.active)
      sendJson(res, 200, { ok: true, workflow: { id: workflow.id, status: workflow.status } })
    })

    // ---- 作业 -----------------------------------------------------------
    route(ROUTES.jobs, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const workflowId = (query(req).get('workflowId') ?? '').trim()
      if (workflowId === '') return sendError(res, 400, 'invalid-id', 'workflowId is required')
      const engine = await ready()
      sendJson(res, 200, { ok: true, jobs: engine.listJobSummaries(workflowId) })
    })

    route(ROUTES.jobStart, async (req, res) => {
      if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      const record = body as Record<string, unknown>
      const workflowId = typeof record.workflowId === 'string' ? record.workflowId.trim() : ''
      if (workflowId === '') return sendError(res, 400, 'invalid-id', 'workflowId is required')
      const engine = await ready()
      const job = await engine.createJobFromHuman({
        workflowId,
        rawInput: (record.rawInput ?? {}) as never,
        structuredInput: (record.structuredInput ?? {}) as never,
      })
      sendJson(res, 200, { ok: true, jobId: job.id, seq: job.seq })
    })

    route(ROUTES.job, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const jobId = (query(req).get('id') ?? '').trim()
      if (jobId === '') return sendError(res, 400, 'invalid-id', 'id is required')
      const engine = await ready()
      const detail = await engine.jobDetail(jobId)
      if (detail === null) return sendError(res, 404, 'not-found', `job not found: ${jobId}`)
      sendJson(res, 200, { ok: true, ...detail })
    })

    route(ROUTES.jobAction, async (req, res) => {
      if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      const record = body as Record<string, unknown>
      const jobId = typeof record.jobId === 'string' ? record.jobId.trim() : ''
      if (jobId === '') return sendError(res, 400, 'invalid-id', 'jobId is required')
      const engine = await ready()
      if (record.action === 'cancel') {
        const job = await engine.cancelJob(jobId)
        sendJson(res, 200, { ok: true, job: { id: job.id, status: job.status } })
        return
      }
      if (record.action === 'retry-delivery') {
        const job = await engine.retryDelivery(jobId)
        sendJson(res, 200, { ok: true, job: { id: job.id, status: job.status } })
        return
      }
      sendError(res, 400, 'invalid-action', 'action must be cancel or retry-delivery')
    })

    // ---- 任务 -----------------------------------------------------------
    route(ROUTES.task, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const params = query(req)
      const jobId = (params.get('jobId') ?? '').trim()
      const taskId = (params.get('taskId') ?? '').trim()
      if (jobId === '' || taskId === '') {
        return sendError(res, 400, 'invalid-id', 'jobId and taskId are required')
      }
      const engine = await ready()
      const detail = engine.taskDetail(jobId, taskId)
      if (detail === null) return sendError(res, 404, 'not-found', 'task not found')
      sendJson(res, 200, { ok: true, task: detail })
    })

    route(ROUTES.taskAction, async (req, res) => {
      if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      const record = body as Record<string, unknown>
      const jobId = typeof record.jobId === 'string' ? record.jobId.trim() : ''
      const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
      if (jobId === '' || taskId === '') {
        return sendError(res, 400, 'invalid-id', 'jobId and taskId are required')
      }
      const engine = await ready()
      switch (record.action) {
        case 'cancel': {
          const task = await engine.cancelTask(jobId, taskId)
          sendJson(res, 200, { ok: true, task: { id: task.id, status: task.status } })
          return
        }
        case 'retry': {
          const task = await engine.retryTask(jobId, taskId)
          sendJson(res, 200, { ok: true, task: { id: task.id, status: task.status } })
          return
        }
        case 'claim': {
          const task = await engine.claimTaskAsHuman(jobId, taskId)
          sendJson(res, 200, { ok: true, task: { id: task.id, status: task.status } })
          return
        }
        case 'complete': {
          const task = await engine.completeTaskAsHuman({
            jobId,
            taskId,
            output: (record.output ?? {}) as never,
            text: typeof record.text === 'string' ? record.text : '',
            attachments: record.attachments,
          })
          sendJson(res, 200, { ok: true, task: { id: task.id, status: task.status } })
          return
        }
        default:
          sendError(res, 400, 'invalid-action', 'action must be cancel, retry, claim or complete')
      }
    })

    // ---- 附件 -----------------------------------------------------------
    route(ROUTES.attachments, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const params = query(req)
      const jobId = (params.get('jobId') ?? '').trim()
      if (jobId === '') return sendError(res, 400, 'invalid-id', 'jobId is required')
      const limit = parseLimit(params.get('limit'))
      const engine = await ready()
      const attachments = engine.listJobAttachments(jobId).slice(0, limit)
      sendJson(res, 200, { ok: true, attachments })
    })

    route(ROUTES.attachment, async (req, res) => {
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
      const params = query(req)
      const jobId = (params.get('jobId') ?? '').trim()
      const attachmentId = (params.get('attachmentId') ?? '').trim()
      const mode = params.get('mode') ?? 'download'
      if (jobId === '' || attachmentId === '') {
        return sendError(res, 400, 'invalid-id', 'jobId and attachmentId are required')
      }
      if (mode !== 'download' && mode !== 'preview' && mode !== 'inline') {
        return sendError(res, 400, 'invalid-mode', 'mode must be download, preview or inline')
      }
      const engine = await ready()
      const opened = engine.openAttachment(jobId, attachmentId)
      if (opened === null) return sendError(res, 404, 'not-found', 'attachment not found')
      const preview = attachmentPreviewInfo(opened.record.name)
      if (mode === 'download') {
        pipeAttachment(
          res,
          { path: opened.file, name: opened.record.name, bytes: opened.record.bytes },
          {
            log: (error) =>
              webCtx.logger?.warn?.(
                `buka-workflows: attachment read failed: ${describeError(error)}`,
              ),
          },
        )
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
        pipeAttachment(
          res,
          { path: opened.file, name: opened.record.name, bytes: opened.record.bytes },
          {
            inline: true,
            mime: preview.mime,
            log: (error) =>
              webCtx.logger?.warn?.(
                `buka-workflows: attachment read failed: ${describeError(error)}`,
              ),
          },
        )
        return
      }
      if (preview.kind !== 'text') {
        sendJson(res, 200, {
          ok: true,
          attachment: {
            name: opened.record.name,
            bytes: opened.record.bytes,
            kind: preview.kind,
            mime: preview.mime,
          },
        })
        return
      }
      const range = await readAttachmentRange(opened.file, { maxBytes: DEFAULT_PREVIEW_TEXT_BYTES })
      if (range.text === null) {
        sendJson(res, 200, {
          ok: true,
          attachment: {
            name: opened.record.name,
            bytes: opened.record.bytes,
            kind: 'binary',
            mime: null,
          },
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        attachment: {
          name: opened.record.name,
          bytes: opened.record.bytes,
          kind: 'text',
          mime: 'text/plain',
          text: range.text,
          truncated: range.truncated,
          read: range.read,
          offset: range.offset,
        },
      })
    })
  })
}
