/**
 * 「执行者」页面的执行者相关 HTTP 路由。
 *
 * 负责登记表与目录的执行者管理接口：列表、创建、头像、描述、模型、
 * 改展示名、移除、写 AGENTS.md 与打开 Finder。工作区身份（挂载 / 删除注册 /
 * 打开会话）都由浏览器一半走 DSH Client Service，这里只处理磁盘事实。
 *
 * 执行者按不可变标识符 `id` 寻址；`name` 只是可选展示名。创建时 `id` 必填，
 * 之后任何入口都不能改它。机器人（内建 clock）只读：创建 / 删除 / 改名 /
 * 改字段都会被拒绝。
 *
 * @module @buka/dsh-plugin-workflows/workers/routes/workers
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPresetsServiceLike } from '../../engine/types.ts'
import { syncWorkerTitle } from '../builder.ts'
import { optionalService } from '../engine/session-runtime.ts'
import { buildWorkerModelCatalog } from '../model-catalog.ts'
import { revealDirectory } from '../reveal.ts'
import type { WorkerModelSelection } from '../store/types.ts'
import {
  addWorker,
  deleteWorker,
  findWorkerWorkspace,
  isResolvableWorkerId,
  isValidWorkerId,
  listWorkers,
  readWorkerRegistry,
  renameWorker,
  setWorkerAvatar,
  setWorkerDescription,
  setWorkerModel,
  setWorkerPreset,
  WORKER_DESCRIPTION_MAX_LENGTH,
  workerDisplayName,
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

/** 页面列出执行者用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-workers/list'

/** 页面新建执行者用的路由。 */
const CREATE_ROUTE = '/buka-workers/create'

/** 页面给执行者换头像用的路由。 */
const AVATAR_ROUTE = '/buka-workers/avatar'

/** 页面编辑执行者描述用的路由。 */
const DESCRIPTION_ROUTE = '/buka-workers/description'

/** 页面读取可选模型目录用的路由。 */
const MODELS_ROUTE = '/buka-workers/models'

/** 页面给智能体设置新会话模型用的路由。 */
const MODEL_ROUTE = '/buka-workers/model'

/** 页面读取可用执行者预设（界面写作「模式」）列表用的路由。 */
const PRESETS_ROUTE = '/buka-workers/presets'

/** 页面给智能体设置默认执行者预设用的路由。 */
const PRESET_ROUTE = '/buka-workers/preset'

/** 页面改执行者展示名（不移动目录）用的路由。 */
const RENAME_ROUTE = '/buka-workers/rename'

/** 页面读取删除影响面（阻塞作业 / 受影响工作流 / 历史作业数）用的路由。 */
const REMOVE_IMPACT_ROUTE = '/buka-workers/remove-impact'

/** 页面删除执行者（登记 + 目录 + 工作区注册）用的路由。 */
const REMOVE_ROUTE = '/buka-workers/remove'

/** 页面「打开 Finder」用的路由。 */
const REVEAL_ROUTE = '/buka-workers/reveal'

/** 执行者路由的依赖：由入口装配时传入，路由本身不持有全局状态。 */
export interface WorkerRouteDeps {
  workersDir: string
  registryFile: string
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
}

/** 一条引用该执行者的运行中作业（只读展示 / 删除阻塞）。 */
interface WorkerUsageJobView {
  jobId: string
  jobSeq: number
  workflowId: string
  workflowName: string
  jobName: string
}

/** 一条引用该执行者的工作流（含停用）。 */
interface WorkerUsageWorkflowView {
  workflowId: string
  name: string
  status: string
}

/** `bukaWorkflows.workerUsage()` 的本插件视图。 */
interface WorkerUsageView {
  runningJobs: WorkerUsageJobView[]
  workflows: WorkerUsageWorkflowView[]
  finishedJobs: number
}

/** 工作流一半只读服务的收窄形状；按可选服务处理。 */
interface WorkflowUsageService {
  workerUsage?(id: string): Promise<unknown>
}

/** 页面展示用的一条执行者预设。 */
interface AgentPresetRowView {
  id: string
  name: string
  description: string
  broken: string | null
}

/**
 * 把 `agentPresets.list()` 的返回值收窄成页面稳定使用的形状。
 *
 * 服务不可用 / 返回值坏掉时按空列表处理；激活失败（broken）的预设保留，页面
 * 把它标灰并显示原因。
 */
function normalizeAgentPresets(raw: unknown): AgentPresetRowView[] {
  if (!Array.isArray(raw)) return []
  const rows: AgentPresetRowView[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    rows.push({
      id,
      name: typeof record.name === 'string' ? record.name : '',
      description: typeof record.description === 'string' ? record.description : '',
      broken: typeof record.broken === 'string' ? record.broken : null,
    })
  }
  return rows
}

/** 把服务返回值收窄成稳定形状：缺字段按空值处理，不让页面拿到坏结构。 */
function normalizeWorkerUsage(raw: unknown): WorkerUsageView {
  const record = (raw ?? {}) as Record<string, unknown>
  const runningJobs = Array.isArray(record.runningJobs)
    ? record.runningJobs
        .filter(
          (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
        )
        .map((entry) => ({
          jobId: typeof entry.jobId === 'string' ? entry.jobId : '',
          jobSeq: typeof entry.jobSeq === 'number' ? entry.jobSeq : 0,
          workflowId: typeof entry.workflowId === 'string' ? entry.workflowId : '',
          workflowName: typeof entry.workflowName === 'string' ? entry.workflowName : '',
          jobName: typeof entry.jobName === 'string' ? entry.jobName : '',
        }))
    : []
  const workflows = Array.isArray(record.workflows)
    ? record.workflows
        .filter(
          (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
        )
        .map((entry) => ({
          workflowId: typeof entry.workflowId === 'string' ? entry.workflowId : '',
          name: typeof entry.name === 'string' ? entry.name : '',
          status: typeof entry.status === 'string' ? entry.status : '',
        }))
    : []
  return {
    runningJobs,
    workflows,
    finishedJobs: typeof record.finishedJobs === 'number' ? record.finishedJobs : 0,
  }
}

/**
 * 注册执行者管理相关的精确路由。
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

  /**
   * 跨插件读取一个执行者的引用面。
   *
   * 工作流一半按可选服务处理：取不到服务时视为「没有作业引用」。
   * 服务存在但读取失败时向上抛，删除与影响面都中止，
   * 避免在未知引用的情况下误删。
   *
   */
  async function readWorkerUsage(id: string): Promise<WorkerUsageView> {
    const service = optionalService<WorkflowUsageService>(ctx, 'bukaWorkflows')
    if (service === null || service === undefined || typeof service.workerUsage !== 'function') {
      return { runningJobs: [], workflows: [], finishedJobs: 0 }
    }
    return normalizeWorkerUsage(await service.workerUsage(id))
  }

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
            webCtx.logger?.warn?.('buka-workers: 读取执行者列表失败：%s', describeError(error))
            sendError(res, 500, 'list-failed', `读取执行者列表失败：${describeError(error)}`)
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

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isValidWorkerId(id)) {
            sendError(
              res,
              400,
              'invalid-id',
              '执行者标识符不合法：需要匹配 ^[a-z][a-z0-9_-]{0,63}$（小写字母开头，可带小写字母、数字、_ 与 -）。',
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
          // 展示名可选；类型不对或超长由 addWorker 拒绝。
          // 头像可选：不传 / 传了非法 id 时由 addWorker 按标识符分配默认头像。
          const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''
          if (body?.description !== undefined && typeof body.description !== 'string') {
            sendError(res, 400, 'invalid-description', 'description 必须是字符串')
            return
          }
          const description = typeof body?.description === 'string' ? body.description : ''

          try {
            const result = await serializeRegistry(() =>
              addWorker({
                workersDir,
                file: registryFile,
                id,
                name: body?.name,
                avatar,
                description,
              }),
            )
            webCtx.logger?.info?.(
              'buka-workers: 已登记执行者 %s（%s，%s）',
              result.worker.id,
              result.worker.name,
              result.worker.path,
            )
            sendJson(res, 200, { ok: true, worker: result.worker, created: result.created })
          } catch (error) {
            if (errorCode(error) === 'invalid-id') {
              sendError(res, 400, 'invalid-id', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-name') {
              sendError(res, 400, 'invalid-name', describeError(error))
              return
            }
            if (errorCode(error) === 'id-taken') {
              sendError(res, 409, 'id-taken', describeError(error))
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
            webCtx.logger?.warn?.('buka-workers: 创建执行者失败：%s', describeError(error))
            sendError(res, 500, 'create-failed', `创建执行者失败：${describeError(error)}`)
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

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
            return
          }
          const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''

          try {
            const result = await serializeRegistry(() =>
              setWorkerAvatar({ file: registryFile, id, avatar }),
            )
            webCtx.logger?.info?.('buka-workers: 执行者 %s 的头像改为 %s', id, avatar)
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            if (errorCode(error) === 'invalid-avatar') {
              sendError(res, 400, 'invalid-avatar', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-id') {
              sendError(res, 400, 'invalid-id', describeError(error))
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
            webCtx.logger?.warn?.('buka-workers: 修改执行者头像失败：%s', describeError(error))
            sendError(res, 500, 'avatar-failed', `修改执行者头像失败：${describeError(error)}`)
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

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
            return
          }
          const description = body?.description
          if (typeof description !== 'string') {
            sendError(res, 400, 'invalid-description', 'description 必须是字符串')
            return
          }

          try {
            const result = await serializeRegistry(() =>
              setWorkerDescription({ file: registryFile, id, description }),
            )
            webCtx.logger?.info?.('buka-workers: 已更新执行者 %s 的描述', id)
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
            if (errorCode(error) === 'invalid-id') {
              sendError(res, 400, 'invalid-id', describeError(error))
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
            webCtx.logger?.warn?.('buka-workers: 更新执行者描述失败：%s', describeError(error))
            sendError(res, 500, 'description-failed', `更新执行者描述失败：${describeError(error)}`)
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

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
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
                id,
                model:
                  model === null || model === undefined ? null : (model as WorkerModelSelection),
              }),
            )
            webCtx.logger?.info?.('buka-workers: 智能体 %s 的模型已更新', id)
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            if (errorCode(error) === 'invalid-model') {
              sendError(res, 400, 'invalid-model', describeError(error))
              return
            }
            if (errorCode(error) === 'invalid-id') {
              sendError(res, 400, 'invalid-id', describeError(error))
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

  /** 读一次 `agentPresets` 服务声明的预设；服务缺失时返回 `null`。 */
  async function listAgentPresets(): Promise<AgentPresetRowView[] | null> {
    const service = optionalService<AgentPresetsServiceLike>(ctx, 'agentPresets')
    if (service === null || service === undefined || typeof service.list !== 'function') {
      return null
    }
    return normalizeAgentPresets(await service.list())
  }

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: PRESETS_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          try {
            const presets = await listAgentPresets()
            // 服务缺失时页面把选择器置灰并提示；空列表与「不可用」是两回事。
            sendJson(res, 200, {
              ok: true,
              available: presets !== null,
              presets: presets ?? [],
            })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 读取执行者预设失败：%s', describeError(error))
            sendError(res, 500, 'presets-failed', `读取执行者预设失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: GET ${PRESETS_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: PRESET_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
            return
          }
          const agentPreset = body?.agentPreset
          if (
            agentPreset !== null &&
            agentPreset !== undefined &&
            typeof agentPreset !== 'string'
          ) {
            sendError(res, 400, 'invalid-agent-preset', 'agentPreset 必须是字符串或 null')
            return
          }
          const nextPreset =
            agentPreset === null || agentPreset === undefined ? null : agentPreset.trim()

          try {
            // 预设存在性在能读到目录时校验；服务缺失时只校验形状，派发时挂载失败
            // 按任务失败处理（ADR 0032）。
            if (nextPreset !== null && nextPreset !== '') {
              const presets = await listAgentPresets()
              if (presets !== null && !presets.some((preset) => preset.id === nextPreset)) {
                sendError(res, 400, 'unknown-agent-preset', `执行者预设不存在：${nextPreset}`)
                return
              }
            }
            const result = await serializeRegistry(() =>
              setWorkerPreset({ file: registryFile, id, agentPreset: nextPreset }),
            )
            webCtx.logger?.info?.('buka-workers: 智能体 %s 的执行者预设已更新', id)
            sendJson(res, 200, { ok: true, worker: result.worker })
          } catch (error) {
            const code = errorCode(error)
            if (
              code === 'invalid-agent-preset' ||
              code === 'invalid-id' ||
              code === 'unknown-agent-preset'
            ) {
              sendError(res, 400, code, describeError(error))
              return
            }
            if (code === 'unknown-worker') {
              sendError(res, 404, 'unknown-worker', describeError(error))
              return
            }
            if (code === 'robot-worker' || code === 'registry-unreadable') {
              sendError(res, 409, code, describeError(error))
              return
            }
            webCtx.logger?.warn?.('buka-workers: 更新执行者预设失败：%s', describeError(error))
            sendError(res, 500, 'preset-failed', `更新执行者预设失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${PRESET_ROUTE}`,
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

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
            return
          }
          const name = body?.name
          if (name !== undefined && name !== null && typeof name !== 'string') {
            sendError(res, 400, 'invalid-name', 'name 必须是字符串')
            return
          }
          const nextName = typeof name === 'string' ? name : ''

          try {
            // 改名路由只更新已有执行者：registry 里必须先有这个标识符。
            // 只改展示名，目录不移动、工作区注册不重建，只同步标题。
            const result = await serializeRegistry(async () => {
              const registry = await readWorkerRegistry({ file: registryFile })
              if (registry.corrupt)
                throw Object.assign(new Error('registry corrupt'), {
                  code: 'registry-unreadable',
                })
              if (!registry.workers.some((worker) => worker.id === id)) {
                throw Object.assign(new Error(`no worker with id ${id}`), {
                  code: 'unknown-worker',
                })
              }
              const renamed = await renameWorker({
                file: registryFile,
                id,
                name: nextName,
              })
              // 只同步已挂载工作区的标题：改名不新建工作区注册，也不碰目录。
              const mount = await syncWorkerTitle({
                workspaceRegistry: ctx.workspaceRegistry,
                workerPath: renamed.worker.path,
                title: workerDisplayName(renamed.worker),
              })
              return { ...renamed, mount }
            })
            webCtx.logger?.info?.(
              'buka-workers: 执行者 %s 的展示名改为 %s',
              result.worker.id,
              result.worker.name,
            )
            sendJson(res, 200, {
              ok: true,
              id: result.worker.id,
              name: result.worker.name,
              previousName: result.previousName,
              renamed: result.renamed,
              worker: result.worker,
              mounted: result.mount.mounted,
              workspaceId:
                typeof result.mount.workspaceId === 'string' ? result.mount.workspaceId : null,
              mountError: result.mount.mountError,
            })
          } catch (error) {
            switch (errorCode(error)) {
              case 'invalid-id':
              case 'invalid-name':
              case 'invalid-update':
                sendError(res, 400, String(errorCode(error)), describeError(error))
                return
              case 'unknown-worker':
                sendError(res, 404, 'unknown-worker', describeError(error))
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
                webCtx.logger?.warn?.('buka-workers: 改展示名失败：%s', describeError(error))
                sendError(res, 500, 'rename-failed', `改展示名失败：${describeError(error)}`)
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
        path: REMOVE_IMPACT_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
            return
          }

          try {
            const registry = await readWorkerRegistry({ file: registryFile })
            if (registry.corrupt) {
              sendError(
                res,
                409,
                'registry-unreadable',
                `执行者登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`,
              )
              return
            }
            const worker = registry.workers.find((entry) => entry.id === id)
            if (worker === undefined) {
              sendError(res, 404, 'unknown-worker', `没有找到这个执行者：${id}`)
              return
            }
            if (worker.driver !== 'agent') {
              sendError(res, 409, 'robot-worker', `机器人只读，不能删除：${id}`)
              return
            }
            const workspace = await findWorkerWorkspace(ctx.workspaceRegistry, worker.path).catch(
              () => null,
            )
            const usage = await readWorkerUsage(id)
            sendJson(res, 200, {
              ok: true,
              id,
              name: workerDisplayName(worker),
              path: worker.path,
              mounted: workspace !== null,
              workspaceId: workspace === null ? null : String(workspace.id),
              blockers: { runningJobs: usage.runningJobs },
              workflows: usage.workflows,
              finishedJobs: usage.finishedJobs,
            })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 读取删除影响面失败：%s', describeError(error))
            sendError(
              res,
              500,
              'remove-impact-failed',
              `读取删除影响面失败：${describeError(error)}`,
            )
          }
        },
      }),
    `buka-workers: POST ${REMOVE_IMPACT_ROUTE}`,
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

          const id = typeof body?.id === 'string' ? body.id.trim() : ''
          if (!isResolvableWorkerId(id)) {
            sendError(res, 400, 'invalid-id', `执行者标识符不合法：${String(body?.id)}`)
            return
          }

          try {
            // 唯一阻塞条件：有引用该标识符的 running 作业。已结束的作业不阻塞。
            const usage = await readWorkerUsage(id)
            if (usage.runningJobs.length > 0) {
              sendJson(res, 409, {
                ok: false,
                code: 'worker-in-use',
                message:
                  '有引用这个执行者的运行中作业，删除会打断它们；请先在作业页主动终止这些作业，再回来删除。',
                jobs: usage.runningJobs,
              })
              return
            }
            const result = await serializeRegistry(() =>
              deleteWorker({
                workersDir,
                file: registryFile,
                id,
                workspaceRegistry: ctx.workspaceRegistry,
              }),
            )
            webCtx.logger?.info?.(
              'buka-workers: 已删除执行者 %s（目录 %s，工作区注册 %s）',
              result.worker.id,
              result.path,
              result.workspaceId ?? '无',
            )
            sendJson(res, 200, {
              ok: true,
              id,
              removed: true,
              path: result.path,
              workspaceId: result.workspaceId,
              directoryRemoved: result.directoryRemoved,
              workflows: usage.workflows,
              finishedJobs: usage.finishedJobs,
            })
          } catch (error) {
            switch (errorCode(error)) {
              case 'invalid-id':
                sendError(res, 400, 'invalid-id', describeError(error))
                return
              case 'registry-unreadable':
              case 'builtin-worker':
              case 'robot-worker':
              case 'outside-root':
              case 'workspace-unavailable':
                sendError(res, 409, String(errorCode(error)), describeError(error))
                return
              case 'unknown-worker':
                sendError(res, 404, 'unknown-worker', describeError(error))
                return
              default:
                webCtx.logger?.warn?.('buka-workers: 删除执行者失败：%s', describeError(error))
                sendError(res, 500, 'remove-failed', `删除执行者失败：${describeError(error)}`)
            }
          }
        },
      }),
    `buka-workers: POST ${REMOVE_ROUTE}`,
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

          const resolved = await resolveWorker(registryFile, body?.id)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
            return
          }

          try {
            await revealDirectory(resolved.worker.path)
            webCtx.logger?.info?.('buka-workers: 已打开执行者目录（%s）', resolved.worker.path)
            sendJson(res, 200, { ok: true, path: resolved.worker.path })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 打开执行者目录失败：%s', describeError(error))
            sendError(res, 500, 'reveal-failed', `打开执行者目录失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${REVEAL_ROUTE}`,
  )
}
