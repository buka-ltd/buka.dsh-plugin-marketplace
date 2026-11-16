/**
 * 打工人登记表：读写、迁移、原子写、条目增删与描述规范化。
 *
 * 登记文件是插件唯一的打工人清单；写操作遇到损坏的登记文件必须拒绝，绝不覆盖
 * 用户文件。新建的打工人目录由 `agents.ts` 的 `ensureWorkerDirectory` 补模板。
 *
 * 格式为 version 4：每条打工人有不可变标识符 `id`、可选展示名 `name` 与
 * `driver`。读 version 1 / 2 / 3 旧表时在内存里迁移：`id` 取旧条目的 `name`，
 * `name` 置空；下一次写入落盘成 version 4。version 2 的 `driver: "program"`
 * 读成 `"robot"`。旧表里可能残留 `assistant` 字段：它不是打工人身份的一部分，
 * 读取时直接丢弃，写回时不再落盘（助理改为工作流上的点名）。内建机器人
 * （clock）由 `BUILTIN_WORKERS` 提供：读旧表时补到视图里，写回前由
 * `ensureBuiltinWorkers` 落盘一次。
 *
 * @module @buka/dsh-plugin-workers/store/registry
 */

import { promises as fs } from 'node:fs'
import { writeJsonAtomic } from '@buka/plugin-kit'
import { isAvatarId, pickDefaultAvatar, resolveAvatar } from '../avatar.ts'
import { ensureWorkerDirectory } from './agents.ts'
import { BUILTIN_WORKERS, builtinWorkerError, isBuiltinWorkerId } from './builtin.ts'
import {
  isLegacyWorkerId,
  isResolvableWorkerId,
  isValidWorkerId,
  requireRegistryFile,
  WORKER_DESCRIPTION_MAX_LENGTH,
  WORKER_MODEL_PART_MAX_LENGTH,
  WORKER_REGISTRY_LEGACY_VERSIONS,
  WORKER_REGISTRY_VERSION,
  workerDirectory,
} from './paths.ts'
import type {
  WorkerDriver,
  WorkerModelSelection,
  WorkerRecord,
  WorkerRecordInput,
} from './types.ts'

/** 展示名上限（UTF-16 长度）；名称只用于展示，不参与目录与引用。 */
export const WORKER_NAME_MAX_LENGTH = 64

/** 登记表里能读到的版本：当前版本 + 仍需要迁移的旧版本。 */
const READABLE_VERSIONS = new Set<number>([
  WORKER_REGISTRY_VERSION,
  ...WORKER_REGISTRY_LEGACY_VERSIONS,
])

/** 判断值是不是普通对象（不是数组 / null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 规范化一份模型选择；缺字段、空串或超长时返回 undefined。
 *
 * 只校验形状，不校验目录成员资格：模型可能暂时不可用（凭据缺失 / 目录未加载），
 * 保存的选择仍然保留，等目录恢复后再匹配。
 */
export function normalizeWorkerModel(value: unknown): WorkerModelSelection | undefined {
  if (!isRecord(value)) return undefined
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return undefined
  if (
    provider.length > WORKER_MODEL_PART_MAX_LENGTH ||
    model.length > WORKER_MODEL_PART_MAX_LENGTH
  ) {
    return undefined
  }
  const reasoningEffort =
    typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  if (reasoningEffort.length > WORKER_MODEL_PART_MAX_LENGTH) return undefined
  return {
    provider,
    model,
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
  }
}

/**
 * 规范化展示名：折叠连续空白并 trim；非字符串按空串处理。
 *
 * 名称只用于展示，不要求唯一；空串表示「未设置」，展示时回退到标识符。
 *
 */
export function normalizeWorkerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * 展示名是否合法：字符串且规范化后不超过上限。
 *
 */
export function isValidWorkerName(value: unknown): value is string {
  return typeof value === 'string' && normalizeWorkerName(value).length <= WORKER_NAME_MAX_LENGTH
}

/**
 * 写入口用的展示名规范化：缺省 / null 表示「未设置」；类型不对或超长抛
 * `code = 'invalid-name'`。
 *
 */
export function normalizeWorkerNameInput(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (!isValidWorkerName(value)) throw invalidNameError(value)
  return normalizeWorkerName(value)
}

/**
 * 读登记表里的一个条目并迁移成当前形状；不合法时返回 undefined。
 *
 * - version 1 / 2 / 3 条目没有 `id`：`id` 取旧 `name`（旧标识符，可能含汉字 /
 *   大写 / `._`），`name` 置空；
 * - version 4 条目必须同时有能定位的 `id`；`name` 是可选展示名；
 * - `driver` 缺失（version 1 旧条目）或取值写坏时按 `agent` 处理；
 *   version 2 的 `program` 取值迁移成 `robot`；
 * - 机器人条目必须有非空 `program` id，智能体条目必须有非空 `path`；
 * - 旧表里的 `assistant` 字段直接丢弃，不进入记录。
 */
function readEntry(entry: Record<string, unknown>, version: number): WorkerRecord | undefined {
  const legacy = version < WORKER_REGISTRY_VERSION
  let id: string
  if (legacy) {
    if (!isLegacyWorkerId(entry.name)) return undefined
    id = entry.name.trim()
  } else {
    if (!isResolvableWorkerId(entry.id)) return undefined
    id = entry.id.trim()
  }
  const name = legacy ? '' : normalizeWorkerName(entry.name).slice(0, WORKER_NAME_MAX_LENGTH)

  // version 2 把固定程序驱动的打工人写成 driver: "program"；version 3 起叫 robot。
  const rawDriver = entry.driver
  const driver: WorkerDriver = rawDriver === 'robot' || rawDriver === 'program' ? 'robot' : 'agent'
  const program =
    driver === 'robot' && typeof entry.program === 'string' ? entry.program.trim() : ''
  if (driver === 'robot' && program === '') return undefined

  const workerPath = typeof entry.path === 'string' ? entry.path.trim() : ''
  if (driver === 'agent' && workerPath === '') return undefined
  const model = driver === 'agent' ? normalizeWorkerModel(entry.model) : undefined

  return {
    id,
    name,
    driver,
    path: workerPath,
    program,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
    avatar: typeof entry.avatar === 'string' ? entry.avatar.trim() : '',
    description: normalizeWorkerDescription(entry.description).slice(
      0,
      WORKER_DESCRIPTION_MAX_LENGTH,
    ),
    ...(model === undefined ? {} : { model }),
  }
}

/**
 * 把一条待写入记录规范化成完整记录；缺省字段按当前格式补齐。
 *
 * - `driver` 缺省按 `agent`；
 * - agent 记录补 `path`、清空 `program`；robot 记录补 `program`、清空 `path`；
 * - `avatar` 总是落成具体预设 id（旧记录第一次写回时顺带补齐），默认头像按
 *   标识符哈希，改名不会让头像漂移；
 * - 描述折叠空白并截断。
 */
function normalizeRecord(worker: WorkerRecordInput): WorkerRecord {
  const driver: WorkerDriver = worker.driver === 'robot' ? 'robot' : 'agent'
  const model = driver === 'agent' ? normalizeWorkerModel(worker.model) : undefined
  const id = typeof worker.id === 'string' ? worker.id.trim() : ''
  return {
    id,
    name: normalizeWorkerName(worker.name).slice(0, WORKER_NAME_MAX_LENGTH),
    driver,
    path: driver === 'agent' && typeof worker.path === 'string' ? worker.path : '',
    program: driver === 'robot' && typeof worker.program === 'string' ? worker.program.trim() : '',
    createdAt: worker.createdAt,
    avatar: resolveAvatar(worker.avatar, id),
    description: normalizeWorkerDescription(worker.description).slice(
      0,
      WORKER_DESCRIPTION_MAX_LENGTH,
    ),
    ...(model === undefined ? {} : { model }),
  }
}

/**
 * 读打工人登记表。
 *
 * - 文件不存在：`{ version: 4, workers: [], file }`（内建打工人由调用方合并）；
 * - 读不了 / 不是合法 JSON / 版本不可读 / `workers` 不是数组：`corrupt: true`
 *   且 `workers: []`（写操作必须据此拒绝，绝不覆盖原文件）；
 * - version 1 旧表按 `driver: "agent"` 迁移；
 *   version 2 的 `driver: "program"` 读成 `"robot"`；
 *   version 1 / 2 / 3 的旧名字迁移成 `id`，`name` 置空；
 * - 条目必须有能定位的 `id`（智能体还要有非空 `path`，机器人要有 `program`），
 *   否则过滤掉；重复标识符只保留第一个。
 * - `avatar` 是预设头像 id；旧登记表没有这个字段（或在别处被改坏）时留空，
 *   展示 / 写入时由 `resolveAvatar` 按标识符兜底成一个确定的预设。
 *
 */
export async function readWorkerRegistry({ file }: { file?: string | undefined } = {}): Promise<{
  version: number
  workers: WorkerRecord[]
  corrupt?: true
  file: string
}> {
  const target = requireRegistryFile(file)
  let text: string
  try {
    text = await fs.readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { version: WORKER_REGISTRY_VERSION, workers: [], file: target }
    }
    return { version: WORKER_REGISTRY_VERSION, workers: [], corrupt: true, file: target }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { version: WORKER_REGISTRY_VERSION, workers: [], corrupt: true, file: target }
  }
  if (!isRecord(parsed)) {
    return { version: WORKER_REGISTRY_VERSION, workers: [], corrupt: true, file: target }
  }
  if (typeof parsed.version !== 'number' || !READABLE_VERSIONS.has(parsed.version)) {
    return { version: WORKER_REGISTRY_VERSION, workers: [], corrupt: true, file: target }
  }
  // 旧 `@buka/dsh-plugin-robots` 的 v1 / v2 登记表用 `robots` 作为键；迁移要先能
  // 读出旧表，否则整条迁移链（格式升级 + 目录路径平移）都会被当成损坏跳过。
  const entries =
    parsed.version <= 2 && Array.isArray(parsed.robots) ? parsed.robots : parsed.workers
  if (!Array.isArray(entries)) {
    return { version: WORKER_REGISTRY_VERSION, workers: [], corrupt: true, file: target }
  }

  const workers: WorkerRecord[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const worker = readEntry(entry, parsed.version)
    if (worker === undefined || seen.has(worker.id)) continue
    seen.add(worker.id)
    workers.push(worker)
  }
  return { version: WORKER_REGISTRY_VERSION, workers, file: target }
}

/**
 * 原子写打工人登记表（临时文件 + rename，权限 0600）。
 *
 * 目录不存在会先建好；写入失败时清理临时文件，原登记文件保持不变。写入总是
 * 落成当前版本（version 4），旧记录缺的 `id` / `name` / `driver` 在这里补齐，
 * 旧表残留的 `assistant` 不落盘。
 *
 */
export async function writeWorkerRegistry({
  file,
  workers,
}: {
  file?: string | undefined
  workers?: WorkerRecordInput[] | undefined
} = {}): Promise<{ file: string }> {
  const target = requireRegistryFile(file)
  const entries = Array.isArray(workers) ? workers : []

  const payload = {
    version: WORKER_REGISTRY_VERSION,
    workers: entries.map((entry) => {
      const worker = normalizeRecord(entry)
      // 智能体条目写目录，机器人条目写程序 id；另一个字段不落盘。
      if (worker.driver === 'robot') {
        return {
          id: worker.id,
          name: worker.name,
          driver: worker.driver,
          program: worker.program,
          createdAt: worker.createdAt,
          avatar: worker.avatar,
          description: worker.description,
        }
      }
      return {
        id: worker.id,
        name: worker.name,
        driver: worker.driver,
        path: worker.path,
        createdAt: worker.createdAt,
        avatar: worker.avatar,
        description: worker.description,
        ...(worker.model === undefined ? {} : { model: worker.model }),
      }
    }),
  }
  await writeJsonAtomic(target, payload)
  return { file: target }
}

/**
 * 把内建机器人补进登记表（幂等）。
 *
 * 只补缺的条目，不动已有条目与顺序；登记表损坏时拒绝写入、返回 `corrupt`。
 *
 */
export async function ensureBuiltinWorkers({ file }: { file?: string | undefined } = {}): Promise<{
  added: string[]
  corrupt?: true
}> {
  const target = requireRegistryFile(file)
  const registry = await readWorkerRegistry({ file: target })
  if (registry.corrupt) return { added: [], corrupt: true }

  const ids = new Set(registry.workers.map((worker) => worker.id))
  const missing = BUILTIN_WORKERS.filter((worker) => !ids.has(worker.id))
  if (missing.length === 0) return { added: [] }

  await writeWorkerRegistry({ file: target, workers: [...registry.workers, ...missing] })
  return { added: missing.map((worker) => worker.id) }
}

// ---- 登记表的增删 --------------------------------------------------------

/**
 * 生成「标识符不合法」错误。
 *
 */
export function invalidIdError(id: unknown): Error & { code: string } {
  const error = new Error(
    `打工人标识符不合法：${String(id)}（新标识符需匹配 ^[a-z][a-z0-9_-]{0,63}$）`,
  )
  return Object.assign(error, { code: 'invalid-id' })
}

/**
 * 生成「展示名不合法」错误。
 *
 */
export function invalidNameError(name: unknown): Error & { code: string } {
  const error = new Error(
    `打工人名称不合法：需要不超过 ${WORKER_NAME_MAX_LENGTH} 个字符的单行文本（收到 ${String(name)}）`,
  )
  return Object.assign(error, { code: 'invalid-name' })
}

/**
 * 生成「标识符已被占用」错误。
 *
 */
export function idTakenError(id: string): Error & { code: string } {
  const error = new Error(`打工人标识符已被占用：${id}`)
  return Object.assign(error, { code: 'id-taken' })
}

/**
 * 生成「描述不合法」错误。
 *
 */
export function invalidDescriptionError(description: unknown): Error & { code: string } {
  const error = new Error(
    `打工人描述不合法：需要不超过 ${WORKER_DESCRIPTION_MAX_LENGTH} 个字符的单行文本（收到 ${String(description)}）`,
  )
  return Object.assign(error, { code: 'invalid-description' })
}

/**
 * 生成「机器人只读」错误。
 *
 */
export function robotWorkerError(id: unknown): Error & { code: string } {
  const error = new Error(`机器人只读，不能修改或打开会话：${String(id)}`)
  return Object.assign(error, { code: 'robot-worker' })
}

/**
 * 生成「模型选择不合法」错误。
 *
 */
export function invalidModelError(model: unknown): Error & { code: string } {
  const error = new Error(
    `模型选择不合法：需要非空的 provider 与 model（收到 ${JSON.stringify(model)}）`,
  )
  return Object.assign(error, { code: 'invalid-model' })
}

/**
 * 规范化打工人描述：把换行 / 连续空白折叠成一个空格并 trim。描述是给工作流
 * 选择打工人看的「一行摘要」（与 skill 的 description 类似），所以不保留排版。
 * 非字符串按空描述处理。
 *
 */
export function normalizeWorkerDescription(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * 描述是否合法：字符串（含空串）且规范化后不超过上限。
 *
 */
export function isValidWorkerDescription(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    normalizeWorkerDescription(value).length <= WORKER_DESCRIPTION_MAX_LENGTH
  )
}

/**
 * 生成「登记文件损坏」错误；写操作遇到它必须拒绝，不能覆盖用户文件。
 *
 */
export function registryUnreadableError(file: string): Error & { code: string } {
  const error = new Error(`打工人登记文件无法读取：${file}。请修复或删除该文件后重试。`)
  return Object.assign(error, { code: 'registry-unreadable' })
}

/**
 * 生成「头像不合法」错误。
 *
 */
export function invalidAvatarError(avatar: unknown): Error & { code: string } {
  const error = new Error(`头像不合法：${String(avatar)}`)
  return Object.assign(error, { code: 'invalid-avatar' })
}

/**
 * 生成「打工人不在登记表里」错误。
 *
 */
export function unknownWorkerError(id: string): Error & { code: string } {
  const error = new Error(`打工人不在登记表里：${id}`)
  return Object.assign(error, { code: 'unknown-worker' })
}

/**
 * 新建一个智能体：按标识符建目录、补 AGENTS.md 模板、把条目插到登记表最前。
 *
 * - `id` 必填，必须匹配新标识符字符集；标识符已登记时抛 `id-taken`（id 冲突
 *   必须拒绝，不会静默复用已有条目）；
 * - 内建机器人（clock）的标识符不可创建；
 * - 头像：传入合法 id 就用它，否则按标识符挑一个还没被占用的预设；新建的
 *   打工人一定带头像；
 * - 描述可选，存成一行摘要（空白折叠）；
 * - 展示名可选，空串表示未设置；
 * - 标识符不合法抛 `code = 'invalid-id'`；内建 id 抛 `code = 'builtin-worker'`；
 *   登记文件损坏抛 `code = 'registry-unreadable'`（不覆盖原文件）；
 * - 新条目的 `path` 是创建后的规范绝对路径（`fs.realpath`，失败回退解析值），
 *   这样和工作区注册表里的路径能直接对齐。
 *
 */
export async function addWorker({
  workersDir,
  file,
  id,
  name,
  avatar,
  description,
}: {
  workersDir?: string | undefined
  file?: string | undefined
  id?: string | undefined
  name?: unknown
  avatar?: string | undefined
  description?: string | undefined
} = {}): Promise<{ worker: WorkerRecord; created: boolean }> {
  const registryFile = requireRegistryFile(file)
  if (!isValidWorkerId(id)) throw invalidIdError(id)
  const workerId = id.trim()
  if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId)
  const workerName = normalizeWorkerNameInput(name)

  const rawDescription = description === undefined || description === null ? '' : description
  if (typeof rawDescription !== 'string') throw invalidDescriptionError(rawDescription)
  const cleanDescription = normalizeWorkerDescription(rawDescription)
  if (cleanDescription.length > WORKER_DESCRIPTION_MAX_LENGTH)
    throw invalidDescriptionError(rawDescription)

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const existing = registry.workers.find((worker) => worker.id === workerId)
  if (existing !== undefined) throw idTakenError(workerId)

  const target = workerDirectory(workersDir, workerId)
  if (target === null) throw invalidIdError(workerId)
  const label = workerName === '' ? workerId : workerName
  const canonical = await ensureWorkerDirectory(target, label)

  const used = registry.workers.map((worker) => resolveAvatar(worker.avatar, worker.id))
  const worker: WorkerRecord = {
    id: workerId,
    name: workerName,
    driver: 'agent',
    path: canonical,
    program: '',
    createdAt: new Date().toISOString(),
    avatar: isAvatarId(avatar) ? avatar : pickDefaultAvatar(workerId, used),
    description: cleanDescription,
  }
  await writeWorkerRegistry({ file: registryFile, workers: [worker, ...registry.workers] })
  return { worker, created: true }
}

/**
 * 定位一个已有打工人：接受新标识符与迁移来的旧标识符。
 *
 */
function findWorker(registry: { workers: WorkerRecord[] }, id: string): WorkerRecord | undefined {
  return registry.workers.find((worker) => worker.id === id)
}

/**
 * 改一个智能体的展示名：只动登记表里的 `name` 字段，不碰目录与工作区。
 *
 * - `id` 是标识符（新格式或迁移来的旧标识符都接受），不可修改；
 * - 展示名可随时改、不要求唯一；空串表示清空（之后显示标识符）；
 * - 名称没变时返回 `renamed: false`，不写文件；
 * - 标识符不合法抛 `code = 'invalid-id'`；展示名不合法抛
 *   `code = 'invalid-name'`；id 不在登记表里抛 `code = 'unknown-worker'`；
 *   机器人只读，抛 `code = 'robot-worker'`。
 *
 */
export async function setWorkerName({
  file,
  id,
  name,
}: {
  file?: string | undefined
  id?: string | undefined
  name?: string | undefined
} = {}): Promise<{ worker: WorkerRecord; previousName: string; renamed: boolean }> {
  const registryFile = requireRegistryFile(file)
  if (!isResolvableWorkerId(id)) throw invalidIdError(id)
  const workerId = id.trim()
  const nextName = normalizeWorkerNameInput(name)

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const current = findWorker(registry, workerId)
  if (current === undefined) throw unknownWorkerError(workerId)
  if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId)
  if (current.driver !== 'agent') throw robotWorkerError(workerId)

  if (current.name === nextName) {
    return { worker: current, previousName: current.name, renamed: false }
  }
  const worker = { ...current, name: nextName }
  await writeWorkerRegistry({
    file: registryFile,
    workers: registry.workers.map((entry) => (entry.id === workerId ? worker : entry)),
  })
  return { worker, previousName: current.name, renamed: true }
}

/**
 * 改一个智能体的头像：只动登记表里的 `avatar` 字段，不碰目录与工作区。
 *
 * - 头像 id 不属于预设集合抛 `code = 'invalid-avatar'`；
 * - 标识符不在登记表里抛 `code = 'unknown-worker'`；
 * - 机器人只读，抛 `code = 'robot-worker'`；
 * - 登记文件损坏抛 `code = 'registry-unreadable'`。
 *
 */
export async function setWorkerAvatar({
  file,
  id,
  avatar,
}: {
  file?: string | undefined
  id?: string | undefined
  avatar?: string | undefined
} = {}): Promise<{ worker: WorkerRecord }> {
  const registryFile = requireRegistryFile(file)
  if (!isResolvableWorkerId(id)) throw invalidIdError(id)
  if (!isAvatarId(avatar)) throw invalidAvatarError(avatar)

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const workerId = id.trim()
  const current = findWorker(registry, workerId)
  if (current === undefined) throw unknownWorkerError(workerId)
  if (current.driver !== 'agent') throw robotWorkerError(workerId)

  const worker = { ...current, avatar }
  await writeWorkerRegistry({
    file: registryFile,
    workers: registry.workers.map((entry) => (entry.id === workerId ? worker : entry)),
  })
  return { worker }
}

/**
 * 改一个智能体新会话使用的模型：只动登记表里的 `model` 字段，不碰目录与工作区。
 *
 * - `model: null` 表示清除配置、跟随宿主默认模型；
 * - provider / model 必须是非空字符串，超长或类型不对抛 `code = 'invalid-model'`；
 * - 标识符不在登记表里抛 `code = 'unknown-worker'`；
 * - 机器人只读，抛 `code = 'robot-worker'`；
 * - 登记文件损坏抛 `code = 'registry-unreadable'`。
 */
export async function setWorkerModel({
  file,
  id,
  model,
}: {
  file?: string | undefined
  id?: string | undefined
  model?: WorkerModelSelection | null | undefined
} = {}): Promise<{ worker: WorkerRecord }> {
  const registryFile = requireRegistryFile(file)
  if (!isResolvableWorkerId(id)) throw invalidIdError(id)
  const next = model === null || model === undefined ? undefined : normalizeWorkerModel(model)
  if (model !== null && model !== undefined && next === undefined) throw invalidModelError(model)

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const workerId = id.trim()
  const current = findWorker(registry, workerId)
  if (current === undefined) throw unknownWorkerError(workerId)
  if (current.driver !== 'agent') throw robotWorkerError(workerId)

  const worker: WorkerRecord = { ...current }
  if (next === undefined) {
    delete worker.model
  } else {
    worker.model = next
  }
  await writeWorkerRegistry({
    file: registryFile,
    workers: registry.workers.map((entry) => (entry.id === workerId ? worker : entry)),
  })
  return { worker }
}

/**
 * 改一个智能体的描述：只动登记表里的 `description` 字段，不碰目录与工作区。
 *
 * 描述是给工作流选择打工人看的一行摘要（类似 skill 的 description），存储前
 * 会折叠空白；空串表示清空。超过上限抛 `code = 'invalid-description'`。
 * 机器人只读，抛 `code = 'robot-worker'`。
 *
 */
export async function setWorkerDescription({
  file,
  id,
  description,
}: {
  file?: string | undefined
  id?: string | undefined
  description?: string | undefined
} = {}): Promise<{ worker: WorkerRecord }> {
  const registryFile = requireRegistryFile(file)
  if (!isResolvableWorkerId(id)) throw invalidIdError(id)
  if (typeof description !== 'string') throw invalidDescriptionError(description)
  const clean = normalizeWorkerDescription(description)
  if (clean.length > WORKER_DESCRIPTION_MAX_LENGTH) throw invalidDescriptionError(description)

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const workerId = id.trim()
  const current = findWorker(registry, workerId)
  if (current === undefined) throw unknownWorkerError(workerId)
  if (current.driver !== 'agent') throw robotWorkerError(workerId)

  const worker = { ...current, description: clean }
  await writeWorkerRegistry({
    file: registryFile,
    workers: registry.workers.map((entry) => (entry.id === workerId ? worker : entry)),
  })
  return { worker }
}

/**
 * 从登记表移除一个智能体：**目录不删**（目录、文件与会话都保留）。
 *
 * - 内建机器人（clock）与其它机器人只读，拒绝移除；
 * - 登记文件损坏抛 `code = 'registry-unreadable'`；未知标识符返回
 *   `{ removed: false }`，不写文件。
 *
 */
export async function removeWorker({
  file,
  id,
}: {
  file?: string | undefined
  id?: string | undefined
} = {}): Promise<{ removed: boolean }> {
  const registryFile = requireRegistryFile(file)
  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)

  const workerId = typeof id === 'string' ? id.trim() : ''
  const current = findWorker(registry, workerId)
  if (current === undefined) return { removed: false }
  if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId)
  if (current.driver !== 'agent') throw robotWorkerError(workerId)

  const remaining = registry.workers.filter((worker) => worker.id !== workerId)
  await writeWorkerRegistry({ file: registryFile, workers: remaining })
  return { removed: true }
}
