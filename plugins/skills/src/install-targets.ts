/**
 * 全局之外的安装目标：打工人目录与工作区目录。
 *
 * 收藏页的「安装到打工人 / 安装到工作区」需要两份列表，两份都来自别的插件或
 * 宿主服务，不能由浏览器传路径：
 *
 * - 打工人：`ctx.bukaWorkers`（workers 插件提供）的 `list()`。只保留智能体、
 *   目录存在的打工人；机器人没有目录，装不了项目级 skill。
 * - 工作区：`ctx.workspaceRegistry`（DSH 自带）的 `list()`，取已注册工作区的
 *   规范路径与标题。
 *
 * 安装时按名字 / 路径在这两份列表里重新解析，解析结果只来自 Host 这次读到的
 * 登记表。浏览器传来的字符串永远只当日志里的选择依据，不会被直接拼进
 * `npx skills add` 的工作目录。
 *
 * 两个服务都是可选的：没装 workers 插件或运行在 headless 组合里时，对应列表
 * 标记成 `available: false`，页面给出说明而不是整页失败。
 *
 * @module @buka/dsh-plugin-skills/install-targets
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'

/** workers 插件 Host 服务的最小形状；只用到列出打工人。 */
interface WorkersServiceLike {
  list?(): Promise<unknown> | unknown
}

/** 工作区注册表的最小形状；只用到同步列出已注册工作区。 */
interface WorkspaceRegistryLike {
  list?(): unknown
}

/** 一个可安装的打工人。 */
export interface WorkerInstallTarget {
  readonly name: string
  readonly path: string
  readonly description: string
}

/** 一个可安装的工作区。 */
export interface WorkspaceInstallTarget {
  readonly id: string
  readonly title: string
  readonly path: string
}

/** 一类目标列表：服务在不在、读取失败的原因、以及条目。 */
export interface InstallTargetList<T> {
  readonly available: boolean
  readonly error: string | null
  readonly items: T[]
}

/** `GET /buka-skills/targets` 的响应体。 */
export interface InstallTargetsSnapshot {
  readonly workers: InstallTargetList<WorkerInstallTarget>
  readonly workspaces: InstallTargetList<WorkspaceInstallTarget>
}

/** 页面能选的安装目标。 */
export type InstallTargetKind = 'global' | 'worker' | 'workspace'

/** 解析结果：成功时给出可信目录与展示名，失败时给出稳定错误码。 */
export type ResolvedInstallTarget =
  | { readonly ok: true; readonly path: string; readonly label: string }
  | { readonly ok: false; readonly code: string; readonly message: string }

/**
 * 把任意错误转成一句话，避免服务抛出的非 Error 值让页面显示 `[object Object]`。
 *
 * @param error 抛出的值
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 安全地取一个可选服务：`ctx.get()` 在服务未提供时返回 undefined。
 *
 * @param ctx 插件上下文
 * @param name 服务名
 */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx.get?.(name) ?? undefined) as T | undefined
  } catch {
    return undefined
  }
}

/**
 * 规范化打工人列表：只要智能体、目录存在、名字与路径都非空的条目。
 *
 * workers 插件的 `list()` 返回 `workers` 数组，字段随版本可能增减；这里按字段
 * 读取而不是依赖固定类型，旧版本缺 `exists` 时按「存在」处理（安装时还会再
 * 确认一次目录）。
 *
 * @param result `bukaWorkers.list()` 的返回值
 */
function normalizeWorkers(result: unknown): WorkerInstallTarget[] {
  const workers = (result as { workers?: unknown } | null | undefined)?.workers
  if (!Array.isArray(workers)) return []

  const byName = new Map<string, WorkerInstallTarget>()
  for (const value of workers) {
    if (value === null || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    // 机器人没有目录，装不了项目级 skill。
    if (record.driver === 'robot' || record.exists === false) continue
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const workerPath = typeof record.path === 'string' ? record.path.trim() : ''
    if (name === '' || workerPath === '' || byName.has(name)) continue
    byName.set(name, {
      name,
      path: workerPath,
      description: typeof record.description === 'string' ? record.description : '',
    })
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * 规范化工作区列表：路径非空的都保留，标题缺失时用目录名兜底。
 *
 * @param result `workspaceRegistry.list()` 的返回值
 */
function normalizeWorkspaces(result: unknown): WorkspaceInstallTarget[] {
  if (!Array.isArray(result)) return []

  const byPath = new Map<string, WorkspaceInstallTarget>()
  for (const value of result) {
    if (value === null || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    const workspacePath = typeof record.path === 'string' ? record.path.trim() : ''
    if (workspacePath === '' || byPath.has(workspacePath)) continue
    const title =
      typeof record.title === 'string' && record.title.trim() !== ''
        ? record.title.trim()
        : path.basename(workspacePath)
    byPath.set(workspacePath, {
      id: typeof record.id === 'string' ? record.id : '',
      title,
      path: workspacePath,
    })
  }

  return [...byPath.values()].sort((left, right) => left.title.localeCompare(right.title))
}

/**
 * 读打工人列表；服务缺失时 `available: false`，读取失败时带上原因。
 *
 * @param ctx 插件上下文
 */
async function readWorkers(ctx: Context): Promise<InstallTargetList<WorkerInstallTarget>> {
  const service = optionalService<WorkersServiceLike>(ctx, 'bukaWorkers')
  if (service === undefined || typeof service?.list !== 'function') {
    return { available: false, error: null, items: [] }
  }
  try {
    return { available: true, error: null, items: normalizeWorkers(await service.list()) }
  } catch (error) {
    return { available: true, error: describeError(error), items: [] }
  }
}

/**
 * 读工作区列表；注册表缺失时 `available: false`，读取失败时带上原因。
 *
 * 注册表的 `list()` 是同步的；服务尚未启动时可能抛错，按读取失败处理。
 *
 * @param ctx 插件上下文
 */
function readWorkspaces(ctx: Context): InstallTargetList<WorkspaceInstallTarget> {
  const registry = optionalService<WorkspaceRegistryLike>(ctx, 'workspaceRegistry')
  if (registry === undefined || typeof registry?.list !== 'function') {
    return { available: false, error: null, items: [] }
  }
  try {
    return { available: true, error: null, items: normalizeWorkspaces(registry.list()) }
  } catch (error) {
    return { available: true, error: describeError(error), items: [] }
  }
}

/**
 * 收集页面选择框需要的两份目标列表。
 *
 * @param ctx 插件上下文
 */
export async function listInstallTargets(ctx: Context): Promise<InstallTargetsSnapshot> {
  return {
    workers: await readWorkers(ctx),
    workspaces: readWorkspaces(ctx),
  }
}

/**
 * 确认目标目录仍然存在，并把解析结果整理成安装流程使用的形状。
 *
 * @param directory 候选目录
 * @param label 展示名（打工人名 / 工作区标题）
 */
async function confirmDirectory(directory: string, label: string): Promise<ResolvedInstallTarget> {
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(directory)
  } catch {
    return { ok: false, code: 'missing-target', message: `目标目录不存在：${directory}` }
  }
  if (!stat.isDirectory()) {
    return { ok: false, code: 'missing-target', message: `目标路径不是目录：${directory}` }
  }
  return { ok: true, path: directory, label }
}

/**
 * 安装时把浏览器选中的目标解析成一个可信目录。
 *
 * - 打工人按名字在 `ctx.bukaWorkers` 的列表里找；
 * - 工作区按路径（也接受 id）在 `ctx.workspaceRegistry` 的列表里找。
 *
 * 找不到、服务缺失或目录已消失都返回稳定的错误码，由路由映射成 HTTP 状态码。
 *
 * @param ctx 插件上下文
 * @param request 浏览器选中的目标
 */
export async function resolveInstallTarget(
  ctx: Context,
  request: { target: unknown; worker?: unknown; workspace?: unknown },
): Promise<ResolvedInstallTarget> {
  if (request?.target === 'worker') {
    const name = typeof request.worker === 'string' ? request.worker.trim() : ''
    if (name === '') {
      return { ok: false, code: 'invalid-target', message: '缺少打工人名称' }
    }
    const workers = await readWorkers(ctx)
    if (!workers.available) {
      return {
        ok: false,
        code: 'workers-unavailable',
        message: '没有找到打工人插件（@buka/dsh-plugin-workers），无法安装到打工人',
      }
    }
    if (workers.error !== null) {
      return { ok: false, code: 'workers-unavailable', message: workers.error }
    }
    const found = workers.items.find((worker) => worker.name === name)
    if (found === undefined) {
      return {
        ok: false,
        code: 'unknown-worker',
        message: `没有找到这个打工人（可能只支持智能体）：${name}`,
      }
    }
    return confirmDirectory(found.path, found.name)
  }

  if (request?.target === 'workspace') {
    const wanted = typeof request.workspace === 'string' ? request.workspace.trim() : ''
    if (wanted === '') {
      return { ok: false, code: 'invalid-target', message: '缺少工作区路径' }
    }
    const workspaces = readWorkspaces(ctx)
    if (!workspaces.available) {
      return {
        ok: false,
        code: 'workspaces-unavailable',
        message: '当前运行环境没有工作区注册表，无法安装到工作区',
      }
    }
    if (workspaces.error !== null) {
      return { ok: false, code: 'workspaces-unavailable', message: workspaces.error }
    }
    const found = workspaces.items.find(
      (workspace) => workspace.path === wanted || (workspace.id !== '' && workspace.id === wanted),
    )
    if (found === undefined) {
      return {
        ok: false,
        code: 'unknown-workspace',
        message: `没有找到这个工作区（可能已被移除）：${wanted}`,
      }
    }
    return confirmDirectory(found.path, found.title)
  }

  return {
    ok: false,
    code: 'invalid-target',
    message: `未知的安装目标：${String(request?.target)}`,
  }
}
