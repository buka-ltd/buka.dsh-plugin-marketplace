/**
 * 「执行者」页面「文件」页签的只读路由：目录树与单文件内容。
 *
 * 只注册 GET；路径与执行者 id 都从查询参数读取，不接受请求体。读取范围限定在
 * 执行者目录内（见 `store/files.ts` 的 realpath 校验）。
 *
 * @module @buka/dsh-plugin-workflows/workers/routes/files
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  FILE_MAX_READ_BYTES,
  listWorkerFiles,
  readWorkerFile,
  type WorkerFileErrorCode,
} from '../store/files.ts'
import { describeError, rejected, sendError, sendJson, sendMethodNotAllowed } from './http.ts'
import type { WorkerRouteError } from './target.ts'
import { resolveWorker } from './target.ts'
import type { WorkerRouteDeps } from './workers.ts'

/** 页面读取执行者目录树用的路由。 */
const TREE_ROUTE = '/workflow/workers/files'

/** 页面读取单个文件内容用的路由。 */
const FILE_ROUTE = '/workflow/workers/file'

/** 从请求地址读取查询参数。 */
function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams
}

/** 把 resolveWorker 的错误写成响应。 */
function sendWorkerError(res: ServerResponse, error: WorkerRouteError): void {
  sendError(res, error.status, error.code, error.message)
}

/** 读取错误的错误码 → HTTP 状态码。 */
function statusForFileError(code: WorkerFileErrorCode): number {
  switch (code) {
    case 'file-not-found':
      return 404
    default:
      return 400
  }
}

/**
 * 注册「文件」页签用到的两个只读路由。
 *
 * @param webCtx web 上下文
 * @param deps 登记表路径等依赖
 */
export function registerFileRoutes(webCtx: Context, deps: WorkerRouteDeps): void {
  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: TREE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          const id = query(req).get('id') ?? ''
          try {
            const resolved = await resolveWorker(deps.registryFile, id)
            if (resolved.error !== undefined) {
              sendWorkerError(res, resolved.error)
              return
            }
            const tree = await listWorkerFiles(resolved.worker.path)
            sendJson(res, 200, {
              ok: true,
              root: resolved.worker.path,
              nodes: tree.nodes,
              truncated: tree.truncated,
            })
          } catch (error) {
            webCtx.logger?.warn?.('workflow-workers: 读取执行者目录失败：%s', describeError(error))
            sendError(res, 500, 'files-failed', `读取执行者目录失败：${describeError(error)}`)
          }
        },
      }),
    `workflow-workers: GET ${TREE_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: FILE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          const params = query(req)
          const id = params.get('id') ?? ''
          const relative = params.get('path') ?? ''
          try {
            const resolved = await resolveWorker(deps.registryFile, id)
            if (resolved.error !== undefined) {
              sendWorkerError(res, resolved.error)
              return
            }
            const result = await readWorkerFile(resolved.worker.path, relative)
            if (!result.ok) {
              const { code, message } = result.error
              sendError(res, statusForFileError(code), code, message)
              return
            }
            sendJson(res, 200, {
              ok: true,
              ...result.file,
              maxBytes: FILE_MAX_READ_BYTES,
            })
          } catch (error) {
            webCtx.logger?.warn?.('workflow-workers: 读取执行者文件失败：%s', describeError(error))
            sendError(res, 500, 'file-failed', `读取执行者文件失败：${describeError(error)}`)
          }
        },
      }),
    `workflow-workers: GET ${FILE_ROUTE}`,
  )
}
