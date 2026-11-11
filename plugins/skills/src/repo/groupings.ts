/**
 * npx skills 仓库的展示分组：读仓库根的清单，得到「skill 目录 → 插件名」。
 *
 * 与 `npx skills` CLI 的 `getPluginGroupings()` 一致：
 *
 * - 只读仓库根的 `.claude-plugin/marketplace.json` 与 `.claude-plugin/plugin.json`；
 * - 只认同仓库内的本地插件：`source` 必须缺省或以 `./` 开头，远程/对象 source 跳过；
 * - 只认清单里**显式声明**的 `skills` 目录（每项以 `./` 开头），其余 skill 不进组；
 * - 清单缺失、JSON 不合法或形状不对都不报错，当作没有分组 —— 分组只是展示优化，
 *   不能让整棵树失败。
 *
 * @module @buka/dsh-plugin-skills/repo/groupings
 */

import { treeBlobPaths } from './discovery.ts'
import {
  CONTROL_PATTERN,
  MARKETPLACE_PATH,
  MAX_PLUGIN_ROOT_LENGTH,
  normalizeRelativePath,
  PLUGIN_MANIFEST_PATH,
} from './marketplace.ts'
import type { RepoTreeEntry } from './types.ts'

/**
 * 读仓库根的插件清单，返回「skill 目录 → 插件名」，用于 npx 仓库的展示分组。
 *
 * 与 `npx skills` CLI 的 `getPluginGroupings()` 一致：
 *
 * - 只读仓库根的 `.claude-plugin/marketplace.json` 与 `.claude-plugin/plugin.json`；
 * - 只认同仓库内的本地插件：`source` 必须缺省或以 `./` 开头，远程/对象 source 跳过；
 * - 只认清单里**显式声明**的 `skills` 目录（每项以 `./` 开头），其余 skill 不进组；
 * - 清单缺失、JSON 不合法或形状不对都不报错，当作没有分组 —— 分组只是展示优化，
 *   不能让整棵树失败。
 *
 * @returns key 是仓库内 skill 目录（'' 表示仓库根），value 是插件名
 */
export async function readSkillGroupings({
  tree,
  reader,
}: {
  tree: RepoTreeEntry[]
  reader: { readFile: (repoPath: string) => Promise<string | null> }
}): Promise<Map<string, string>> {
  const paths = new Set(treeBlobPaths(tree))
  const groupings = new Map<string, string>()

  if (paths.has(MARKETPLACE_PATH)) {
    const manifest = await readJsonObject(reader, MARKETPLACE_PATH)
    if (manifest !== null) applyMarketplaceGroupings(manifest, groupings)
  }
  if (paths.has(PLUGIN_MANIFEST_PATH)) {
    const manifest = await readJsonObject(reader, PLUGIN_MANIFEST_PATH)
    if (manifest !== null) applyPluginGroupings(manifest, groupings)
  }
  return groupings
}

/**
 * 读一个仓库内 JSON 文件；读不到、不是 JSON 或顶层不是对象时返回 null。
 */
async function readJsonObject(
  reader: { readFile: (repoPath: string) => Promise<string | null> },
  repoPath: string,
): Promise<Record<string, unknown> | null> {
  let text: string | null
  try {
    text = await reader.readFile(repoPath)
  } catch {
    return null
  }
  if (typeof text !== 'string') return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null
}

/**
 * marketplace 清单里的插件分组：每个插件的 `skills` 数组显式列出的目录。
 */
function applyMarketplaceGroupings(
  manifest: Record<string, unknown>,
  out: Map<string, string>,
): void {
  const metadata = manifest.metadata as { pluginRoot?: unknown } | undefined
  const pluginRoot = manifestDir(metadata?.pluginRoot)
  // pluginRoot 不合法时 CLI 整份清单都不用于分组。
  if (pluginRoot === null) return
  const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : []

  for (const entry of plugins) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    const name = normalizeGroupName(item.name)
    if (name === null) continue
    // 只处理仓库内的本地插件；对象形式的 github / url / npm source 不在本仓库里。
    const base = manifestDir(item.source)
    if (base === null) continue
    for (const dir of declaredSkillDirs(item.skills, joinRepoPath(pluginRoot, base))) {
      out.set(dir, name)
    }
  }
}

/**
 * 插件根 `.claude-plugin/plugin.json` 的分组：清单 name 就是组名，`skills`
 * 显式列出的目录相对插件根（仓库根）。
 */
function applyPluginGroupings(manifest: Record<string, unknown>, out: Map<string, string>): void {
  const name = normalizeGroupName(manifest.name)
  if (name === null) return
  for (const dir of declaredSkillDirs(manifest.skills, '')) out.set(dir, name)
}

/**
 * 分组用的插件名：CLI 直接用清单里的 `name`，这里只 trim、限长并拒绝控制字符，
 * 不套 Claude Code 插件的命名规则（清单里更宽松的名字也照常分组）。
 */
function normalizeGroupName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > MAX_PLUGIN_ROOT_LENGTH || CONTROL_PATTERN.test(text)) return null
  return text
}

/**
 * 解析清单里的一个本地目录：缺省表示插件根，字符串必须以 `./` 开头。
 *
 * 与 CLI 一致：undefined → 空串（插件根），合法 `./...` → 规范化后的相对路径，
 * 其它（`.`、`../x`、远程 source、非字符串）→ null（跳过这个 entry）。
 *
 * @returns 规范化相对路径（'' 表示根），或 null 表示跳过
 */
function manifestDir(value: unknown): string | null {
  if (value === undefined) return ''
  if (typeof value !== 'string' || !value.startsWith('./')) return null
  return normalizeManifestPath(value.slice(2))
}

/**
 * 清单里声明的 skills 路径列表（CLI 允许字符串或字符串数组）。
 *
 * @param base 相对于仓库根的插件根
 * @returns 仓库内 skill 目录
 */
function declaredSkillDirs(declared: unknown, base: string): string[] {
  const list = Array.isArray(declared) ? declared : typeof declared === 'string' ? [declared] : []
  const dirs: string[] = []
  for (const item of list) {
    if (typeof item !== 'string' || !item.startsWith('./')) continue
    const rel = normalizeManifestPath(item.slice(2))
    if (rel === null) continue
    dirs.push(joinRepoPath(base, rel))
  }
  return dirs
}

/**
 * 规范化清单里的相对路径：去掉开头 / 结尾的多余 `/`，再要求它是安全的相对路径。
 *
 * @param value 已去掉 `./` 前缀的路径
 */
function normalizeManifestPath(value: string): string | null {
  const trimmed = value.replace(/^\/+|\/+$/gu, '')
  if (trimmed === '') return ''
  return normalizeRelativePath(trimmed)
}

/**
 * 拼两段仓库内相对路径，空串表示仓库根。
 */
function joinRepoPath(base: string, rel: string): string {
  if (base === '') return rel
  if (rel === '') return base
  return `${base}/${rel}`
}
