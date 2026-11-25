/**
 * 删除执行者：登记条目、执行者目录与工作区注册行一起清掉（硬删，不归档）。
 *
 * 事务顺序（见 ADR 0021）：
 *
 * 1. 校验目录在执行者根目录下；
 * 2. 把目录原子改名为同级回收名；
 * 3. 删工作区注册行；
 * 4. 删登记条目；
 * 5. 尽力删除回收目录。
 *
 * 第 2～4 步任一步失败都把目录改回原名、登记条目保持原样；工作区注册行已经
 * 删掉时用 `create` 尽力恢复。内建 clock 与 `driver: robot` 的条目不可删。
 *
 * 唯一阻塞条件（引用该标识符的运行中作业）由路由通过 `workflowQuery` 服务
 * 检查，本模块只处理磁盘与登记表。
 *
 * @module @buka/dsh-plugin-workflows/workers/store/delete
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { builtinWorkerError, isBuiltinWorkerId } from './builtin.ts'
import {
  isDirectory,
  isResolvableWorkerId,
  realpathOr,
  realpathOrNull,
  requireRegistryFile,
  workerDirectory,
} from './paths.ts'
import {
  invalidIdError,
  readWorkerRegistry,
  registryUnreadableError,
  robotWorkerError,
  unknownWorkerError,
  writeWorkerRegistry,
} from './registry.ts'
import type { WorkerRecord, WorkspaceRegistryLike } from './types.ts'

/** 删除结果；`workspaceId` 是被摘掉的工作区注册（没挂载时为 null）。 */
export interface DeleteWorkerResult {
  readonly worker: WorkerRecord
  /** 被删除的执行者目录（登记里的规范路径）；目录原本就不存在时仍返回记录值。 */
  readonly path: string
  /** 被摘掉的工作区注册 id。 */
  readonly workspaceId: string | null
  /** 目录是否真的改名并删除了。 */
  readonly directoryRemoved: boolean
}

/** 目录不在执行者根目录下：拒绝删除，避免误删任意路径。 */
export function deleteOutsideRootError(target: string): Error & { code: string } {
  const error = new Error(`执行者目录不在执行者根目录下，拒绝删除：${target}`)
  return Object.assign(error, { code: 'outside-root' })
}

/** 工作区注册服务不可用：无法安全摘掉注册行。 */
export function workspaceUnavailableError(): Error & { code: string } {
  const error = new Error(
    '工作区注册服务不可用，无法确认或摘掉执行者的工作区注册，拒绝删除；请刷新后重试。',
  )
  return Object.assign(error, { code: 'workspace-unavailable' })
}

/** 判断 `child` 是否在 `root` 目录下（不含 root 本身）。 */
function isInside(root: string, child: string): boolean {
  const relative = path.relative(root, child)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false
  return true
}

/** 工作区注册表里与执行者目录对应的那一条。 */
export interface WorkerWorkspaceMatch {
  readonly id: unknown
  readonly path: string
}

/**
 * 按规范路径在已注册工作区里找执行者目录。
 *
 * 工作区路径用 `path.resolve` 与 `fs.realpath` 两种形式比较，缓存目录本身是
 * 符号链接时也能对齐；注册表不可用时抛 `workspace-unavailable`。
 *
 */
export async function findWorkerWorkspace(
  workspaceRegistry: WorkspaceRegistryLike | undefined,
  workerPath: string,
): Promise<WorkerWorkspaceMatch | null> {
  if (workspaceRegistry === undefined || workspaceRegistry === null) {
    throw workspaceUnavailableError()
  }
  let entries: Array<{ id?: unknown; path?: unknown }>
  try {
    const listed = workspaceRegistry.list()
    entries = Array.isArray(listed) ? listed : []
  } catch {
    throw workspaceUnavailableError()
  }
  const resolved = path.resolve(workerPath)
  const real = await realpathOrNull(workerPath)
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.path !== 'string' || entry.path.trim() === '') continue
    const candidate = path.resolve(entry.path)
    if (candidate === resolved || (real !== null && candidate === real)) {
      return { id: entry.id, path: candidate }
    }
    const candidateReal = await realpathOrNull(entry.path)
    if (real !== null && candidateReal === real) return { id: entry.id, path: candidate }
  }
  return null
}

/**
 * 硬删一个执行者：目录、登记条目与工作区注册行一起删除。
 *
 * - 标识符不合法抛 `code = 'invalid-id'`；不在登记表里抛 `code = 'unknown-worker'`；
 * - 内建 clock 抛 `code = 'builtin-worker'`，其它机器人抛 `code = 'robot-worker'`；
 * - 目录不在执行者根目录下抛 `code = 'outside-root'`；
 * - 工作区注册服务不可用抛 `code = 'workspace-unavailable'`；
 * - 目录不存在时只删登记与注册行，不报错。
 *
 */
export async function deleteWorker({
  workersDir,
  file,
  id,
  workspaceRegistry,
}: {
  workersDir?: string | undefined
  file?: string | undefined
  id?: string | undefined
  workspaceRegistry?: WorkspaceRegistryLike | undefined
} = {}): Promise<DeleteWorkerResult> {
  const registryFile = requireRegistryFile(file)
  if (!isResolvableWorkerId(id)) throw invalidIdError(id)
  const workerId = id.trim()

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) throw registryUnreadableError(registryFile)
  const worker = registry.workers.find((entry) => entry.id === workerId)
  if (worker === undefined) throw unknownWorkerError(workerId)
  if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId)
  if (worker.driver !== 'agent') throw robotWorkerError(workerId)

  // 1. 校验目录在执行者根目录下（登记里的路径与按标识符算出的路径都要能对上）。
  const root =
    typeof workersDir === 'string' && workersDir.trim() !== '' ? path.resolve(workersDir) : null
  if (root === null) throw invalidIdError(workerId)
  const expected = workerDirectory(root, workerId)
  if (expected === null) throw invalidIdError(workerId)
  const rootCanonical = await realpathOr(root, root)
  const expectedCanonical = await realpathOr(expected, expected)
  const sourcePath = await realpathOr(worker.path, path.resolve(worker.path))
  if (!isInside(rootCanonical, expectedCanonical) || !isInside(rootCanonical, sourcePath)) {
    throw deleteOutsideRootError(worker.path)
  }

  // 2. 工作区注册先查好：已挂载但注册表不可用时拒绝删除，事务还没开始。
  const workspace = await findWorkerWorkspace(workspaceRegistry, worker.path)

  // 3. 目录原子改名为同级回收名（目录不存在时跳过）。
  let recycledPath: string | null = null
  if (await isDirectory(sourcePath)) {
    recycledPath = `${sourcePath}.deleted-${Date.now()}-${randomUUID().slice(0, 8)}`
    await fs.rename(sourcePath, recycledPath)
  }
  const rollbackDirectory = async (): Promise<void> => {
    if (recycledPath === null) return
    try {
      await fs.rename(recycledPath, sourcePath)
    } catch {
      // 回滚失败只能留给日志；原始错误更重要，照常抛给调用方。
    }
  }

  // 4. 删工作区注册行；失败回滚目录。
  if (workspace !== null) {
    if (typeof workspaceRegistry?.delete !== 'function') {
      await rollbackDirectory()
      throw workspaceUnavailableError()
    }
    try {
      await workspaceRegistry.delete(workspace.id)
    } catch (error) {
      await rollbackDirectory()
      throw error
    }
  }

  // 5. 删登记条目；失败回滚目录，并尽力恢复工作区注册行。
  try {
    await writeWorkerRegistry({
      file: registryFile,
      workers: registry.workers.filter((entry) => entry.id !== workerId),
    })
  } catch (error) {
    await rollbackDirectory()
    if (workspace !== null && typeof workspaceRegistry?.create === 'function') {
      try {
        await workspaceRegistry.create(worker.path, worker.name === '' ? workerId : worker.name)
      } catch {
        // 恢复注册行是尽力而为：无法恢复时保持原错误。
      }
    }
    throw error
  }

  // 6. 尽力删除回收目录；删不掉只留下一个 `<id>.deleted-*` 目录，不影响一致性。
  if (recycledPath !== null) {
    try {
      await fs.rm(recycledPath, { recursive: true, force: true })
    } catch {
      // 回收目录清理失败不阻塞删除。
    }
  }

  return {
    worker,
    path: worker.path,
    workspaceId: workspace === null ? null : String(workspace.id),
    directoryRemoved: recycledPath !== null,
  }
}
