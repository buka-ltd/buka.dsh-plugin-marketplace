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
import {
  AGENTS_MAX_WRITE_BYTES,
  addWorker,
  ensureClaudeLink,
  isBuiltinWorkerName,
  isValidWorkerName,
  normalizeWorkerDescription,
  readWorkerRegistry,
  renameWorker as renameWorkerStore,
  setWorkerAvatar,
  setWorkerDescription,
  WORKER_DESCRIPTION_MAX_LENGTH,
  writeAgentsFile,
} from './worker-store.ts'

/** 构建请求的错误码；工具层按这些码给出可读提示。 */
export const BUILD_ERROR_CODES = Object.freeze({
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
  nameTaken: 'name-taken',
  missingDirectory: 'missing-directory',
  pathOutsideRoot: 'path-outside-root',
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
 * - `name` 先 trim 再按打工人名称规则校验；
 * - `avatar` 缺省 / 空串表示「不指定」（新建时自动分配）；给了就必须是预设 id；
 * - `description` 是一行摘要，空白会折叠；缺省 / 空串表示「不改」（新建时为空）；
 * - `agents` 是完整 AGENTS.md 文本，只有全空白时视为「不写」，避免误清空；
 * - `update` 必须是布尔值，缺省按 `false` 处理；
 * - `newName` 是可选的新名字：给了就必须合法，且必须 `update: true`（改名只针对
 *   已存在的打工人）；与 `name` 相同时按「不改名」处理。
 *
 */
export function normalizeBuildRequest(
  input: {
    name?: unknown
    avatar?: unknown
    description?: unknown
    agents?: unknown
    update?: unknown
    newName?: unknown
  } = {},
): {
  name: string
  avatar: string
  description: string
  agents: string
  agentsBytes: number
  update: boolean
  newName: string
} {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!isValidWorkerName(name)) {
    throw buildError(
      BUILD_ERROR_CODES.invalidName,
      'invalid worker name: use 1-64 characters, do not start with a dot, and allow only letters, digits, Chinese, ".", "_" and "-".',
    )
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

  let newName = ''
  if (input.newName !== undefined && input.newName !== null && typeof input.newName !== 'string') {
    throw buildError(BUILD_ERROR_CODES.invalidName, 'newName must be a string.')
  }
  if (typeof input.newName === 'string' && input.newName.trim() !== '') {
    newName = input.newName.trim()
    if (!isValidWorkerName(newName)) {
      throw buildError(
        BUILD_ERROR_CODES.invalidName,
        'invalid new worker name: use 1-64 characters, do not start with a dot, and allow only letters, digits, Chinese, ".", "_" and "-".',
      )
    }
    if (!update) {
      throw buildError(
        BUILD_ERROR_CODES.invalidUpdate,
        'renaming an existing worker requires update: true; pass it only when the user asked to rename that worker.',
      )
    }
  }

  return { name, avatar, description, agents, agentsBytes, update, newName }
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
  workspaceRegistry?: { list?: () => Array<{ id?: unknown; path?: unknown }> } | null | undefined
  workerPath?: string | undefined
} = {}): Promise<{ id?: unknown; path?: unknown } | null> {
  if (typeof workspaceRegistry?.list !== 'function') return null
  // 调用方必须传 workerPath；缺省时保持原来的 TypeError（`path.resolve(undefined)`），
  // 这里用断言只是为了让已通过校验的调用方拿到 string 类型。
  const target = await canonicalPath(workerPath as string)
  let workspaces: Array<{ id?: unknown; path?: unknown }>
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
 * 确保打工人目录已挂成 DSH 工作区。
 *
 * 已挂载时不动它（不重命名、不重排）；未挂载时用 `workspaceRegistry.create()`
 * 注册，标题交给注册表按目录名生成。挂载失败（注册表不可用、目录冲突等）不抛错，
 * 而是返回失败原因，让打工人本身仍然可用。
 *
 */
export async function mountWorker({
  workspaceRegistry,
  workerPath,
}: {
  workspaceRegistry?:
    | {
        list?: () => Array<{ id?: unknown; path?: unknown }>
        create?: (directory: string) => Promise<{ id?: unknown }>
      }
    | null
    | undefined
  workerPath?: string | undefined
} = {}): Promise<{ mounted: boolean; workspaceId: unknown; mountError: string | null }> {
  const existing = await currentMount({ workspaceRegistry, workerPath })
  if (existing !== null) {
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
    const workspace = await workspaceRegistry.create(workerPath as string)
    return { mounted: true, workspaceId: workspace?.id ?? null, mountError: null }
  } catch (error) {
    return { mounted: false, workspaceId: null, mountError: describeError(error) }
  }
}

/**
 * 创建、修改或重命名一个打工人，并确保它已挂到工作区。
 *
 * - 名字已存在且没有传 `update: true`：拒绝，避免模型顺手覆盖用户的打工人；
 * - 已存在且 `update: true`：只改传了的字段（头像 / 描述 / AGENTS.md），目录与
 *   `createdAt` 不变；描述为空串表示保留原描述；
 * - 传了 `newName` 且与 `name` 不同：先把打工人目录改名、就地更新登记表，再
 *   应用其它字段；改名前已挂载时删除旧工作区注册，最后按新路径重挂
 *   （新工作区 id / 标题 = 新名；旧会话日志保留，但不再挂在这个打工人下）；
 *   `newName` 必须配 `update: true`，且 `name` 必须已存在；
 * - 新建：建目录、写默认模板（没给 `agents` 时）、登记、按需写 AGENTS.md；
 * - 所有情况都补 `CLAUDE.md` 链接，再确保工作区挂载。
 *
 */
export async function buildWorker({
  workersDir,
  file,
  name,
  avatar,
  description,
  agents,
  update,
  newName,
  workspaceRegistry,
}: {
  workersDir?: string | undefined
  file?: string | undefined
  name?: unknown
  avatar?: unknown
  description?: unknown
  agents?: unknown
  update?: unknown
  newName?: unknown
  workspaceRegistry?:
    | {
        list?: () => Array<{ id?: unknown; path?: unknown }>
        create?: (directory: string) => Promise<{ id?: unknown }>
        delete?: (id: unknown) => unknown
      }
    | null
    | undefined
} = {}): Promise<{
  worker: {
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
  const request = normalizeBuildRequest({ name, avatar, description, agents, update, newName })

  // v1 的机器人只有内建 clock：不可创建、不可当改名目标。
  // 构建工具只创建 / 修改智能体。
  if (isBuiltinWorkerName(request.name)) {
    throw buildError(
      BUILD_ERROR_CODES.builtinWorker,
      `"${request.name}" is a built-in robot and cannot be created, changed or removed; robots are registered by the plugin.`,
    )
  }
  if (request.newName !== '' && isBuiltinWorkerName(request.newName)) {
    throw buildError(
      BUILD_ERROR_CODES.builtinWorker,
      `"${request.newName}" is a built-in robot name and cannot be used as a new worker name.`,
    )
  }

  const registry = await readWorkerRegistry({ file })
  if (registry.corrupt) {
    throw buildError(
      BUILD_ERROR_CODES.registryUnreadable,
      `the worker registry is unreadable: ${String(file)}. Fix or remove that file, then try again.`,
    )
  }

  const existing = registry.workers.find((worker) => worker.name === request.name)
  if (existing !== undefined && existing.driver !== 'agent') {
    throw buildError(
      BUILD_ERROR_CODES.robotWorker,
      `"${request.name}" is a robot: robots are read-only and cannot be changed by this tool.`,
    )
  }
  if (existing !== undefined && !request.update) {
    throw buildError(
      BUILD_ERROR_CODES.workerExists,
      `worker "${request.name}" already exists; pass update: true only when the user asked to change that worker.`,
    )
  }

  // 改名先落盘：目录与登记表的更新由 worker-store 负责，工作区在这里重建。
  // 改名后沿用新名字继续走下面的字段更新，返回的 name / path 都是新值。
  let activeName = request.name
  let renamed = false
  let previousName = null
  if (request.newName !== '' && request.newName !== request.name) {
    if (existing === undefined) {
      throw buildError(
        BUILD_ERROR_CODES.unknownWorker,
        `cannot rename "${request.name}": no worker with that name exists.`,
      )
    }

    // 改名前记下挂载的工作区：改名后旧路径不再对应任何注册，需要摘掉它，
    // 再由最后的 mountWorker 按新路径重建（DSH 的工作区路径创建后不可改）。
    const mountBefore = await currentMount({ workspaceRegistry, workerPath: existing.path })
    const moved = await renameWorkerStore({
      workersDir,
      file,
      name: request.name,
      newName: request.newName,
    })
    renamed = moved.renamed
    previousName = moved.renamed ? moved.previousName : null
    activeName = moved.worker.name
    if (renamed && mountBefore !== null && typeof workspaceRegistry?.delete === 'function') {
      try {
        await workspaceRegistry.delete(mountBefore.id)
      } catch {
        // 旧注册没删掉时最后的 mountWorker 仍会按新路径建工作区；旧行留在
        // 侧边栏由用户删除，不因此让改名失败。
      }
    }
  }

  // 两种情况都走 addWorker：新建时建目录并登记；已存在时它会确保目录还在、
  // 补 AGENTS.md 模板（不覆盖已有文件）并复用条目，目录被外部删掉后也能重建。
  const added = await addWorker({
    workersDir,
    file,
    name: activeName,
    avatar: request.avatar,
    description: request.description,
  })
  let worker = added.worker
  const created = added.created
  let updated = renamed

  if (!created && request.avatar !== '' && request.avatar !== worker.avatar) {
    worker = (await setWorkerAvatar({ file, name: activeName, avatar: request.avatar })).worker
    updated = true
  }

  if (!created && request.description !== '' && request.description !== worker.description) {
    worker = (
      await setWorkerDescription({ file, name: activeName, description: request.description })
    ).worker
    updated = true
  }

  if (request.agents !== '') {
    await writeAgentsFile(worker.path, request.agents)
    updated = updated || !created
  }
  await ensureClaudeLink(worker.path)

  const mount = await mountWorker({ workspaceRegistry, workerPath: worker.path })
  return {
    worker: {
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

/**
 * 把任意错误转成可以展示的文本。
 *
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
