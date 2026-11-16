/**
 * 「打工人」preset 的写操作：创建 / 修改打工人，并把它挂到工作区。
 *
 * 页面上的新建流程是「建目录 + 登记 + `workspaces.create` 挂载」；这里把同一套
 * 事实操作收成一个函数，供 `buka_worker_build` 工具调用（工具只对构建 preset
 * 的根会话可见，见 `access.js`）。与 `worker-store.js` 的分工：
 *
 * - 目录、登记表、AGENTS.md 的底层读写仍由 `worker-store.js` 负责；
 * - 本模块负责「一次构建」的语义：参数规范化、已存在打工人必须显式
 *   `update: true` 才允许覆盖、写 AGENTS.md 后补 CLAUDE.md 链接、按规范路径
 *   判断是否已挂载并只在需要时创建 DSH 工作区；
 * - 改名（`update: true` 且传了 `name`）只改展示名：目录不移动、工作区注册
 *   不重建，只把已挂载工作区的标题同步成新的展示名；
 * - 挂载失败不让整个构建失败：打工人已经建好了，返回 `mounted: false` 与
 *   `mountError`，由调用方告诉用户去页面点「挂载」。
 *
 * 只在 `index.js` 里被包进登记表串行队列调用；本模块自身不 import DSH 包，
 * 用临时目录就能单测。
 *
 * @module @buka/dsh-plugin-workers/builder
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { AVATAR_IDS, isAvatarId } from './avatar.ts'
import { ensureWorkerDirectory } from './store/agents.ts'
import type { WorkerRecord } from './store/types.ts'
import { workerDisplayName } from './store/types.ts'
import {
  AGENTS_MAX_WRITE_BYTES,
  addWorker,
  ensureClaudeLink,
  isBuiltinWorkerId,
  isResolvableWorkerId,
  isValidWorkerId,
  isValidWorkerName,
  normalizeWorkerDescription,
  normalizeWorkerName,
  readWorkerRegistry,
  setWorkerAvatar,
  setWorkerDescription,
  setWorkerName,
  WORKER_DESCRIPTION_MAX_LENGTH,
  writeAgentsFile,
} from './worker-store.ts'

/** 构建请求的错误码；工具层按这些码给出可读提示。 */
export const BUILD_ERROR_CODES = Object.freeze({
  invalidId: 'invalid-id',
  invalidName: 'invalid-name',
  invalidAvatar: 'invalid-avatar',
  invalidDescription: 'invalid-description',
  invalidAgents: 'invalid-agents',
  invalidUpdate: 'invalid-update',
  agentsTooLarge: 'agents-too-large',
  registryUnreadable: 'registry-unreadable',
  workerExists: 'worker-exists',
  builtinWorker: 'builtin-worker',
  robotWorker: 'robot-worker',
  unknownWorker: 'unknown-worker',
  idTaken: 'id-taken',
})

/**
 * 带错误码的构建错误。
 *
 */
function buildError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/**
 * 规范化一次构建请求；不合法时抛带错误码的 `Error`。
 *
 * - `id` 必填且不可修改：创建时必须是新标识符字符集，更新时也接受迁移来的
 *   旧标识符（由 `buildWorker` 按「是否已登记」区分）；
 * - `name` 是可选展示名：缺省 / null 表示「不改」（新建时为空）；给了就必须
 *   是单行文本，空白会折叠；空串表示清空，展示时回退到标识符；
 * - `avatar` 缺省 / 空串表示「不指定」（新建时自动分配）；给了就必须是预设 id；
 * - `description` 是一行摘要，空白会折叠；缺省 / 空串表示「不改」（新建时为空）；
 * - `agents` 是完整 AGENTS.md 文本，只有全空白时视为「不写」，避免误清空；
 * - `update` 必须是布尔值，缺省按 `false` 处理。
 *
 */
export function normalizeBuildRequest(
  input: {
    id?: unknown
    name?: unknown
    avatar?: unknown
    description?: unknown
    agents?: unknown
    update?: unknown
  } = {},
): {
  id: string
  name: string
  nameProvided: boolean
  avatar: string
  description: string
  agents: string
  agentsBytes: number
  update: boolean
} {
  const rawId = typeof input.id === 'string' ? input.id.trim() : ''
  if (rawId === '' || !isResolvableWorkerId(rawId)) {
    throw buildError(
      BUILD_ERROR_CODES.invalidId,
      'invalid worker identifier: pass the immutable id of the worker; a new id must match ^[a-z][a-z0-9_-]{0,63}$.',
    )
  }

  const nameProvided = input.name !== undefined && input.name !== null
  let name = ''
  if (nameProvided) {
    if (!isValidWorkerName(input.name)) {
      throw buildError(
        BUILD_ERROR_CODES.invalidName,
        'invalid worker name: use a single line of at most 64 characters, or leave it empty to show the identifier.',
      )
    }
    name = normalizeWorkerName(input.name)
  }

  let avatar = ''
  if (input.avatar !== undefined && input.avatar !== null && input.avatar !== '') {
    if (!isAvatarId(input.avatar)) {
      throw buildError(
        BUILD_ERROR_CODES.invalidAvatar,
        `unknown avatar id "${String(input.avatar)}"; use one of: ${AVATAR_IDS.join(', ')}.`,
      )
    }
    avatar = input.avatar
  }

  let description = ''
  if (
    input.description !== undefined &&
    input.description !== null &&
    typeof input.description !== 'string'
  ) {
    throw buildError(
      BUILD_ERROR_CODES.invalidDescription,
      'description must be a single-line string.',
    )
  }
  if (typeof input.description === 'string') {
    description = normalizeWorkerDescription(input.description)
    if (description.length > WORKER_DESCRIPTION_MAX_LENGTH) {
      throw buildError(
        BUILD_ERROR_CODES.invalidDescription,
        `description is ${description.length} characters; the limit is ${WORKER_DESCRIPTION_MAX_LENGTH}. Shorten it to one sentence.`,
      )
    }
  }

  if (input.agents !== undefined && input.agents !== null && typeof input.agents !== 'string') {
    throw buildError(
      BUILD_ERROR_CODES.invalidAgents,
      'agents must be a string containing the complete AGENTS.md markdown.',
    )
  }
  const rawAgents = typeof input.agents === 'string' ? input.agents : ''
  const agents = rawAgents.trim() === '' ? '' : rawAgents
  const agentsBytes = Buffer.byteLength(agents, 'utf8')
  if (agentsBytes > AGENTS_MAX_WRITE_BYTES) {
    throw buildError(
      BUILD_ERROR_CODES.agentsTooLarge,
      `AGENTS.md is ${agentsBytes} bytes; the limit is ${AGENTS_MAX_WRITE_BYTES} bytes. Shorten it or use the page editor.`,
    )
  }

  if (input.update !== undefined && typeof input.update !== 'boolean') {
    throw buildError(BUILD_ERROR_CODES.invalidUpdate, 'update must be a boolean.')
  }
  const update = input.update === true

  return { id: rawId, name, nameProvided, avatar, description, agents, agentsBytes, update }
}

/**
 * `fs.realpath`，不存在时回退原值。
 *
 */
async function canonicalPath(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch {
    return path.resolve(target)
  }
}

/** 工作区记录里本模块用到的字段：标题用于改名同步。 */
export interface WorkspaceMountLike {
  id?: unknown
  path?: unknown
  title?: unknown
  setTitle?: (title: string) => Promise<void> | void
}

/** 工作区注册表里本模块用到的方法。 */
export interface WorkspaceRegistryForBuild {
  list?: () => WorkspaceMountLike[]
  create?: (directory: string, title?: string) => Promise<{ id?: unknown }>
}

/**
 * 找打工人目录对应的已注册工作区。
 *
 * 工作区登记的路径本身就是规范绝对路径；打工人目录也走 `fs.realpath`，
 * 两者直接比较，符号链接不会造成重复挂载。
 *
 */
export async function currentMount({
  workspaceRegistry,
  workerPath,
}: {
  workspaceRegistry?: WorkspaceRegistryForBuild | null | undefined
  workerPath?: string | undefined
} = {}): Promise<WorkspaceMountLike | null> {
  if (typeof workspaceRegistry?.list !== 'function') return null
  // 调用方必须传 workerPath；缺省时保持原来的 TypeError（`path.resolve(undefined)`），
  // 这里用断言只是为了让已通过校验的调用方拿到 string 类型。
  const target = await canonicalPath(workerPath as string)
  let workspaces: WorkspaceMountLike[]
  try {
    workspaces = workspaceRegistry.list()
  } catch {
    return null
  }
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    if (typeof workspace?.path !== 'string') continue
    if (path.resolve(workspace.path) === target) return workspace
  }
  return null
}

/**
 * 把已挂载工作区的标题同步成打工人当前展示名。
 *
 * 标题只是展示：同步失败（工作区记录不提供 `setTitle`、写入失败）不影响构建
 * 结果，目录、登记表与引用都不受影响。
 *
 */
async function syncWorkspaceTitle(
  workspace: WorkspaceMountLike | null,
  title: string | undefined,
): Promise<void> {
  if (workspace === null || typeof workspace?.setTitle !== 'function') return
  const text = typeof title === 'string' ? title.trim() : ''
  if (text === '') return
  if (typeof workspace.title === 'string' && workspace.title === text) return
  try {
    await workspace.setTitle(text)
  } catch {
    // 标题同步是锦上添花：失败不回滚改名。
  }
}

/**
 * 确保打工人目录已挂成 DSH 工作区。
 *
 * 已挂载时不动它（不重命名、不重排），只按需同步工作区标题；未挂载时用
 * `workspaceRegistry.create(path, title)` 注册，标题用打工人展示名（空名时传
 * 标识符）。挂载失败（注册表不可用、目录冲突等）不抛错，而是返回失败原因，
 * 让打工人本身仍然可用。
 *
 */
export async function mountWorker({
  workspaceRegistry,
  workerPath,
  title,
}: {
  workspaceRegistry?: WorkspaceRegistryForBuild | null | undefined
  workerPath?: string | undefined
  title?: string | undefined
} = {}): Promise<{ mounted: boolean; workspaceId: unknown; mountError: string | null }> {
  const existing = await currentMount({ workspaceRegistry, workerPath })
  if (existing !== null) {
    await syncWorkspaceTitle(existing, title)
    return { mounted: true, workspaceId: existing.id ?? null, mountError: null }
  }
  if (typeof workspaceRegistry?.create !== 'function') {
    return {
      mounted: false,
      workspaceId: null,
      mountError: 'the workspace registry is unavailable in this composition',
    }
  }
  try {
    const workspace = await workspaceRegistry.create(workerPath as string, title)
    return { mounted: true, workspaceId: workspace?.id ?? null, mountError: null }
  } catch (error) {
    return { mounted: false, workspaceId: null, mountError: describeError(error) }
  }
}

/**
 * 创建或更新一个打工人，并确保它已挂到工作区。
 *
 * - `id` 必填且不可修改；已登记的标识符没有 `update: true` 时拒绝，避免模型
 *   顺手覆盖用户的打工人；新建时 `id` 必须匹配新标识符字符集；
 * - 已存在且 `update: true`：只改传了的字段（名称 / 头像 / 描述 / AGENTS.md），
 *   目录与 `createdAt` 不变；描述为空串表示保留原描述；
 * - 传了 `name` 且与当前展示名不同：只改展示名（`renamed: true`），目录不动、
 *   工作区注册不重建，只同步已挂载工作区的标题；
 * - 新建：按标识符建目录、写默认模板（没给 `agents` 时）、登记、按需写
 *   AGENTS.md；
 * - 所有情况都补 `CLAUDE.md` 链接（新建时），再确保工作区挂载。
 *
 */
export async function buildWorker({
  workersDir,
  file,
  id,
  name,
  avatar,
  description,
  agents,
  update,
  workspaceRegistry,
}: {
  workersDir?: string | undefined
  file?: string | undefined
  id?: unknown
  name?: unknown
  avatar?: unknown
  description?: unknown
  agents?: unknown
  update?: unknown
  workspaceRegistry?: WorkspaceRegistryForBuild | null | undefined
} = {}): Promise<{
  worker: {
    id: string
    name: string
    driver: 'agent'
    path: string
    avatar: string
    description: string
    createdAt: string
    assistant: boolean
  }
  created: boolean
  updated: boolean
  renamed: boolean
  previousName: string | null
  agentsBytes: number
  mounted: boolean
  workspaceId: unknown
  mountError: string | null
}> {
  const request = normalizeBuildRequest({ id, name, avatar, description, agents, update })

  // v1 的机器人只有内建 clock：不可创建、不可修改。展示名可以是 clock，
  // 但标识符 clock 固定属于内建机器人。
  if (isBuiltinWorkerId(request.id)) {
    throw buildError(
      BUILD_ERROR_CODES.builtinWorker,
      `"${request.id}" is a built-in robot identifier and cannot be created, changed or removed; robots are registered by the plugin.`,
    )
  }

  const registry = await readWorkerRegistry({ file })
  if (registry.corrupt) {
    throw buildError(
      BUILD_ERROR_CODES.registryUnreadable,
      `the worker registry is unreadable: ${String(file)}. Fix or remove that file, then try again.`,
    )
  }

  const existing = registry.workers.find((worker) => worker.id === request.id)

  let worker: WorkerRecord
  let created = false
  let updated = false
  let renamed = false
  let previousName: string | null = null

  if (existing === undefined) {
    // 新建才要求新标识符字符集；更新已有条目时允许迁移来的旧标识符。
    if (!isValidWorkerId(request.id)) {
      throw buildError(
        BUILD_ERROR_CODES.invalidId,
        `invalid new worker identifier "${request.id}": use ^[a-z][a-z0-9_-]{0,63}$.`,
      )
    }
    const added = await addWorker({
      workersDir,
      file,
      id: request.id,
      name: request.nameProvided ? request.name : '',
      avatar: request.avatar,
      description: request.description,
    })
    worker = added.worker
    created = true
    if (request.agents !== '') await writeAgentsFile(worker.path, request.agents)
  } else {
    if (existing.driver !== 'agent') {
      throw buildError(
        BUILD_ERROR_CODES.robotWorker,
        `"${request.id}" is a robot: robots are read-only and cannot be changed by this tool.`,
      )
    }
    if (!request.update) {
      throw buildError(
        BUILD_ERROR_CODES.workerExists,
        `worker "${request.id}" already exists; pass update: true only when the user asked to change that worker.`,
      )
    }

    worker = existing
    if (request.nameProvided && request.name !== existing.name) {
      const result = await setWorkerName({ file, id: request.id, name: request.name })
      worker = result.worker
      renamed = result.renamed
      previousName = result.renamed ? result.previousName : null
      updated = updated || result.renamed
    }

    if (request.avatar !== '' && request.avatar !== worker.avatar) {
      worker = (await setWorkerAvatar({ file, id: request.id, avatar: request.avatar })).worker
      updated = true
    }

    if (request.description !== '' && request.description !== worker.description) {
      worker = (
        await setWorkerDescription({ file, id: request.id, description: request.description })
      ).worker
      updated = true
    }

    if (request.agents !== '') {
      // 已登记但目录被外部删掉时，写入 AGENTS.md 前按登记的标识符重建目录。
      await ensureWorkerDirectory(worker.path, workerDisplayName(worker))
      await writeAgentsFile(worker.path, request.agents)
      updated = true
    }
    if (request.agents === '' && (await pathIsDirectory(worker.path))) {
      // 旧打工人（创建时还没有 CLAUDE.md 链接）在构建时顺手补上。
      try {
        await ensureClaudeLink(worker.path)
      } catch {
        // 链接修复失败不影响构建结果。
      }
    }
  }

  const mount = await mountWorker({
    workspaceRegistry,
    workerPath: worker.path,
    title: workerDisplayName(worker),
  })
  return {
    worker: {
      id: worker.id,
      name: worker.name,
      driver: 'agent',
      path: worker.path,
      avatar: worker.avatar,
      description: worker.description ?? '',
      createdAt: worker.createdAt,
      assistant: worker.assistant === true,
    },
    created,
    updated,
    renamed,
    previousName,
    agentsBytes: request.agents === '' ? 0 : request.agentsBytes,
    ...mount,
  }
}

/** 路径是否存在且是目录；用于决定要不要补 CLAUDE.md 链接。 */
async function pathIsDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 把任意错误转成可以展示的文本。
 *
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
