/**
 * 「收藏的来源里有哪些 skills」用到的类型。
 *
 * 这些类型是 `src/repo/` 各模块之间的公共契约：来源坐标、树节点、缓存条目、
 * 拉取与探测的返回值。集中放在这里，实现模块之间只依赖类型、不互相 import，
 * 避免出现环。
 *
 * @module @buka/dsh-plugin-skills/repo/types
 */

/** 目录节点。 */
export interface DirNode {
  type: 'dir'
  name: string
  path: string
  children: TreeNode[]
}

/** skill 节点；`path` 是仓库内的完整路径。 */
export interface SkillNode {
  type: 'skill'
  name: string
  path: string
  description: string
}

/** 展示树节点。 */
export type TreeNode = DirNode | SkillNode

/** 仓库分类：npx skills 仓库、Claude Code marketplace、不可用。 */
export type RepoKind = 'npx-skills' | 'claude-code-marketplace' | 'unavailable'

/** marketplace 里的一个插件。 */
export interface MarketplacePlugin {
  name: string
  root: string
  description: string
}

/** 缓存里的 marketplace 清单快照。 */
export interface CachedMarketplace {
  name: string
  plugins: MarketplacePlugin[]
}

/** 一条完整树缓存。 */
export interface CacheEntry {
  source: string
  kind: RepoKind
  ref: string
  sha: string
  fetchedAt: number
  truncated: boolean
  skills: number
  complete: boolean
  root: TreeNode[]
  marketplace: CachedMarketplace | null
}

/** 规范化后的来源坐标。 */
export type RepoOrigin =
  | { kind: 'github'; owner: string; repo: string }
  | { kind: 'local'; root: string }
  | { kind: 'git'; url: string }

/** 拉取 / 探测失败的错误码。 */
export type RepoSkillsFailureCode =
  | 'invalid-source'
  | 'unsupported-source'
  | 'repo-not-found'
  | 'rate-limited'
  | 'fetch-failed'
  | 'repo-unavailable'
  | 'git-unavailable'
  | 'git-failed'

/** 统一的失败返回。 */
export interface RepoSkillsFailure {
  readonly ok: false
  readonly code: RepoSkillsFailureCode
  readonly message: string
}

/** `fetchRepoSkills()` 成功时的结果。 */
export interface RepoSkillsResult {
  readonly ok: true
  readonly source: string
  readonly kind: RepoKind
  readonly ref: string
  readonly sha: string
  readonly fetchedAt: number
  readonly cached: boolean
  readonly truncated: boolean
  readonly root: TreeNode[]
  readonly skills: number
  readonly marketplace: CachedMarketplace | null
}

/** `probeRepoKind()` 成功时的结果：没有 `root`，`skills` 是预计数量。 */
export interface RepoProbeResult {
  readonly ok: true
  readonly source: string
  readonly kind: RepoKind
  readonly skills: number
  readonly cached: boolean
  readonly ref: string
  readonly sha: string
  readonly fetchedAt: number
  readonly truncated: boolean
}

/** GitHub 树 / 本地扫描树里的一个节点；建树只读 `type` 与 `path`。 */
export type RepoTreeEntry = { type?: unknown; path?: unknown }

/** 树里确认是 blob 且带字符串路径的节点。 */
export type RepoBlobEntry = { type?: unknown; path: string }

/** 打开后的仓库读取抽象：树 + 读文件；三种来源统一成这个形状。 */
export interface RepoReader {
  readonly ok: true
  readonly ref: string
  readonly sha: string
  readonly truncated: boolean
  readonly tree: RepoTreeEntry[]
  readonly readFile: (repoPath: string) => Promise<string | null>
}

/** `openRepo()` 的结果。 */
export type RepoOpenResult = RepoReader | RepoSkillsFailure

/** 从 SKILL.md 解析出的元数据。 */
export interface SkillFileMeta {
  name: string
  description: string
  internal: boolean
}

/** 发现阶段的一个 SKILL.md。 */
export interface SkillMetadata {
  fullPath: string
  name: string
  description: string
  internal: boolean
}

/** marketplace 里一个插件下的 skill 分组。 */
export interface MarketplaceSkillGroup {
  pluginName: string
  pluginRoot: string
  skills: Array<{ path: string; rel: string }>
}

/** 分类结果；读 marketplace 清单失败时带 `failure`。 */
export type RepoClassification =
  | { kind: 'npx-skills' }
  | { kind: 'claude-code-marketplace'; marketplace: CachedMarketplace }
  | { kind: 'unavailable' }
  | { failure: RepoSkillsFailure }

/** 两个入口共用的前半段结果。 */
export type ResolvedTarget =
  | {
      readonly ok: true
      readonly origin: RepoOrigin
      readonly canonical: string
      readonly timestamp: number
      readonly resolvedToken: string | null
      readonly file: string
      readonly entries: Record<string, CacheEntry>
      readonly id: string
      readonly cached: CacheEntry | undefined
    }
  | { readonly ok: false; readonly failure: RepoSkillsFailure }
