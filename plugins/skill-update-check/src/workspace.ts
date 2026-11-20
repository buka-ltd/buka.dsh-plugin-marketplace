/**
 * 从会话解析「当前工作区」的目录。
 *
 * 浏览器一半只传会话 id，路径解析全在 Host：优先用工作区注册表里
 * `sessionIds` 包含该会话的那条记录；拿不到时退回会话 header 的 `cwd`，并在
 * 已注册工作区里找包含它的最长路径。这样即使会话是在工作区子目录里创建的，
 * 检查的仍是工作区根目录的 `skills-lock.json`。
 *
 * 本模块只依赖 Node 内置模块，`node --test` 可以直接 import。
 *
 * @module @buka/dsh-plugin-skill-update-check/workspace
 */

import path from 'node:path'

/** 工作区注册表条目里本插件用到的字段。 */
export interface WorkspaceRecordLike {
  readonly id?: unknown
  readonly path?: unknown
  readonly sessionIds?: readonly unknown[]
}

/** 工作区注册表：只声明 `list()`。 */
export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceRecordLike[]
}

/** 会话里本插件用到的字段。 */
export interface SessionLike {
  readonly header?: { readonly cwd?: string } | undefined
}

/** 解析当前工作区目录的入参。 */
export interface ResolveWorkspaceDirInput {
  readonly sessionId: string
  readonly session?: SessionLike | undefined
  readonly registry?: WorkspaceRegistryLike | undefined
}

/** 规范化后的工作区记录。 */
interface ListedWorkspace {
  readonly path: string
  readonly sessionIds: readonly unknown[]
}

/**
 * 解析当前会话所在的工作区目录。
 *
 * @param input 会话 id、会话快照与可选的工作区注册表
 * @returns 绝对目录；无法解析时返回 `undefined`
 */
export function resolveWorkspaceDir(input: ResolveWorkspaceDirInput): string | undefined {
  const workspaces = listWorkspaces(input.registry)

  const attached = workspaces.find((workspace) => workspace.sessionIds.includes(input.sessionId))
  if (attached !== undefined) return attached.path

  const cwd = absolutePath(input.session?.header?.cwd)
  if (cwd === undefined) return undefined

  let best: string | undefined
  for (const workspace of workspaces) {
    if (!isInside(cwd, workspace.path)) continue
    if (best === undefined || workspace.path.length > best.length) best = workspace.path
  }
  return best ?? cwd
}

/** 读注册表并只保留有绝对路径的条目；注册表不可用时返回空数组。 */
function listWorkspaces(registry: WorkspaceRegistryLike | undefined): ListedWorkspace[] {
  if (registry === undefined) return []
  let listed: readonly WorkspaceRecordLike[]
  try {
    listed = registry.list()
  } catch {
    return []
  }
  if (!Array.isArray(listed)) return []

  const workspaces: ListedWorkspace[] = []
  for (const raw of listed) {
    if (raw === null || typeof raw !== 'object') continue
    const dir = absolutePath(raw.path)
    if (dir === undefined) continue
    workspaces.push({
      path: dir,
      sessionIds: Array.isArray(raw.sessionIds) ? raw.sessionIds : [],
    })
  }
  return workspaces
}

/** 只接受非空的绝对路径。 */
function absolutePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || !path.isAbsolute(text)) return undefined
  return path.resolve(text)
}

/** `target` 是否等于 `root` 或位于它下面。 */
function isInside(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}
