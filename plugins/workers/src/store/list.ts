/**
 * 打工人列表：登记表 + 目录 / 挂载状态 + 项目级 skills 与 AGENTS.md。
 *
 * 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
 * realpath 规范值），打工人路径用 `fs.realpath`（失败回退 `path.resolve`）。
 *
 * 机器人没有目录：不扫描 skills / AGENTS.md，`exists` 为 false，
 * 页面按 `driver` 只读展示。内建机器人在视图里补上，即使登记表还没
 * 落盘也能看到。
 *
 * @module @buka/dsh-plugin-workers/store/list
 */

import path from 'node:path'
import { resolveAvatar } from '../avatar.ts'
import { emptyAgentsFile, ensureClaudeLink, readAgentsFile, readClaudeLink } from './agents.ts'
import { withBuiltinWorkers } from './builtin.ts'
import { isDirectory, realpathOr, realpathOrNull, requireRegistryFile } from './paths.ts'
import { scanProjectSkills } from './project-skills.ts'
import { readWorkerRegistry } from './registry.ts'
import type {
  ClaudeLinkInfo,
  WorkerListEntry,
  WorkerRecord,
  WorkspaceRegistryLike,
} from './types.ts'

/** 没有目录的打工人（机器人）的 CLAUDE.md 摘要。 */
function emptyClaude(): ClaudeLinkInfo {
  return { exists: false, symlink: false, mode: 'missing', target: '' }
}

/**
 * 汇总登记表里的打工人：目录是否存在、是否已挂到 DSH 工作区，以及每个
 * 智能体自己的项目级 skills 与 AGENTS.md。
 *
 * 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
 * realpath 规范值），打工人路径用 `fs.realpath`（失败回退 `path.resolve`）。
 * 登记文件损坏时返回 `corrupt: true` 与空列表。
 *
 */
export async function listWorkers({
  file,
  workspaceRegistry,
  workersDir,
}: {
  file?: string | undefined
  workspaceRegistry?: WorkspaceRegistryLike | undefined
  workersDir?: string | undefined
} = {}): Promise<{
  root: string
  registry: string
  corrupt: boolean
  workers: WorkerListEntry[]
}> {
  const registryFile = requireRegistryFile(file)
  const root =
    typeof workersDir === 'string' && workersDir.trim() !== ''
      ? path.resolve(workersDir)
      : path.join(path.dirname(registryFile), 'workers')
  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) return { root, registry: registryFile, corrupt: true, workers: [] }

  const workspaceByPath = await indexWorkspaces(workspaceRegistry)
  const workers: WorkerListEntry[] = []
  for (const entry of withBuiltinWorkers(registry.workers)) {
    if (entry.driver === 'robot') {
      workers.push(programEntry(entry))
      continue
    }
    workers.push(await agentEntry(entry, workspaceByPath))
  }
  return { root, registry: registryFile, corrupt: false, workers }
}

/** 机器人：没有目录、skills 与 AGENTS.md。 */
function programEntry(entry: WorkerRecord): WorkerListEntry {
  return {
    ...entry,
    avatar: resolveAvatar(entry.avatar, entry.name),
    exists: false,
    mounted: false,
    workspaceId: null,
    skills: [],
    agents: emptyAgentsFile(),
    claude: emptyClaude(),
  }
}

/** 智能体：目录 / 挂载 / skills / AGENTS.md 汇总。 */
async function agentEntry(
  entry: WorkerRecord,
  workspaceByPath: Map<string, { id?: unknown; path?: unknown }>,
): Promise<WorkerListEntry> {
  const canonical = await realpathOr(entry.path, path.resolve(entry.path))
  const workspace = workspaceByPath.get(canonical) ?? workspaceByPath.get(path.resolve(entry.path))

  const exists = await isDirectory(canonical)
  let skills: WorkerListEntry['skills'] = []
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

  // 旧打工人（创建时还没有 CLAUDE.md 链接）在列清单时自动补上：
  // 只有打工人目录和 AGENTS.md 都在才建，避免留下悬空链接。
  let claude: ClaudeLinkInfo = emptyClaude()
  try {
    claude =
      exists && agents.exists ? await ensureClaudeLink(canonical) : await readClaudeLink(canonical)
  } catch {
    claude = emptyClaude()
  }

  return {
    ...entry,
    avatar: resolveAvatar(entry.avatar, entry.name),
    exists,
    mounted: workspace !== undefined,
    workspaceId: workspace === undefined ? null : String(workspace.id),
    skills,
    agents,
    claude,
  }
}

/**
 * 建「规范路径 → 工作区」索引。工作区路径同时按 `path.resolve` 与
 * `fs.realpath` 登记（后者成功时才登记），打工人侧用 realpath 对齐，
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
