/**
 * 机器人列表：登记表 + 目录 / 挂载状态 + 项目级 skills 与 AGENTS.md。
 *
 * 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
 * realpath 规范值），机器人路径用 `fs.realpath`（失败回退 `path.resolve`）。
 *
 * @module @buka/dsh-plugin-robots/store/list
 */

import path from 'node:path'
import { resolveAvatar } from '../avatar.ts'
import { emptyAgentsFile, ensureClaudeLink, readAgentsFile, readClaudeLink } from './agents.ts'
import { isDirectory, realpathOr, realpathOrNull, requireRegistryFile } from './paths.ts'
import { scanProjectSkills } from './project-skills.ts'
import { readRobotRegistry } from './registry.ts'
import type { ClaudeLinkInfo, RobotListEntry, WorkspaceRegistryLike } from './types.ts'

// ---- 列表与挂载状态 ------------------------------------------------------

/**
 * 汇总登记表里的机器人：目录是否存在、是否已挂到 DSH 工作区，以及每个
 * 机器人自己的项目级 skills 与 AGENTS.md。
 *
 * 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
 * realpath 规范值），机器人路径用 `fs.realpath`（失败回退 `path.resolve`）。
 * 登记文件损坏时返回 `corrupt: true` 与空列表。
 *
 */
export async function listRobots({
  file,
  workspaceRegistry,
  robotsDir,
}: {
  file?: string | undefined
  workspaceRegistry?: WorkspaceRegistryLike | undefined
  robotsDir?: string | undefined
} = {}): Promise<{
  root: string
  registry: string
  corrupt: boolean
  robots: RobotListEntry[]
}> {
  const registryFile = requireRegistryFile(file)
  const root =
    typeof robotsDir === 'string' && robotsDir.trim() !== ''
      ? path.resolve(robotsDir)
      : path.join(path.dirname(registryFile), 'robots')
  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) return { root, registry: registryFile, corrupt: true, robots: [] }

  const workspaceByPath = await indexWorkspaces(workspaceRegistry)
  const robots: RobotListEntry[] = []
  for (const entry of registry.robots) {
    const canonical = await realpathOr(entry.path, path.resolve(entry.path))
    const workspace =
      workspaceByPath.get(canonical) ?? workspaceByPath.get(path.resolve(entry.path))

    const exists = await isDirectory(canonical)
    let skills: RobotListEntry['skills'] = []
    try {
      skills = (await scanProjectSkills(canonical)).skills
    } catch {
      skills = []
    }
    let agents = emptyAgentsFile()
    try {
      agents = await readAgentsFile(canonical)
    } catch {
      agents = emptyAgentsFile()
    }

    // 旧机器人（创建时还没有 CLAUDE.md 链接）在列清单时自动补上：
    // 只有机器人目录和 AGENTS.md 都在才建，避免留下悬空链接。
    let claude: ClaudeLinkInfo = { exists: false, symlink: false, mode: 'missing', target: '' }
    try {
      claude =
        exists && agents.exists
          ? await ensureClaudeLink(canonical)
          : await readClaudeLink(canonical)
    } catch {
      claude = { exists: false, symlink: false, mode: 'missing', target: '' }
    }

    robots.push({
      name: entry.name,
      path: entry.path,
      createdAt: entry.createdAt,
      avatar: resolveAvatar(entry.avatar, entry.name),
      description: entry.description,
      exists,
      mounted: workspace !== undefined,
      workspaceId: workspace === undefined ? null : String(workspace.id),
      skills,
      agents,
      claude,
    })
  }
  return { root, registry: registryFile, corrupt: false, robots }
}

/**
 * 建「规范路径 → 工作区」索引。工作区路径同时按 `path.resolve` 与
 * `fs.realpath` 登记（后者成功时才登记），机器人侧用 realpath 对齐，
 * 这样缓存目录本身是符号链接时也能正确判断挂载。
 *
 */
async function indexWorkspaces(
  workspaceRegistry: WorkspaceRegistryLike | undefined,
): Promise<Map<string, { id?: unknown; path?: unknown }>> {
  const index = new Map<string, { id?: unknown; path?: unknown }>()
  let workspaces: Array<{ id?: unknown; path?: unknown }> = []
  try {
    const snapshot = workspaceRegistry?.list?.()
    workspaces = Array.isArray(snapshot) ? snapshot : []
  } catch {
    workspaces = []
  }
  for (const workspace of workspaces) {
    if (workspace === null || typeof workspace !== 'object') continue
    if (typeof workspace.path !== 'string' || workspace.path.trim() === '') continue
    const resolved = path.resolve(workspace.path)
    if (!index.has(resolved)) index.set(resolved, workspace)
    const real = await realpathOrNull(workspace.path)
    if (real !== null && !index.has(real)) index.set(real, workspace)
  }
  return index
}
