/**
 * 「收藏的来源里有哪些 skills」用到的类型。
 *
 * 这些类型是 `src/repo/` 各模块之间的公共契约：来源坐标、树节点、缓存条目、
 * 拉取与探测的返回值。集中放在这里，实现模块之间只依赖类型、不互相 import，
 * 避免出现环。
 *
 * 收藏只支持一种格式：仓库根 `skills/` 下（允许任意层级子目录）的 `SKILL.md`。
 * 根 `SKILL.md`、各种 agent 目录（`.claude/skills`、`.codex/skills` 等）与
 * Claude Code marketplace 都不算可安装来源，因此仓库类型只有「标准 npx 仓库」
 * 与「不可用」两种。
 *
 * @module @buka/dsh-plugin-skills/repo/types
 */

/** 目录节点；`path` 是它在仓库里的完整路径。 */
export interface DirNode {
  type: 'dir'
  name: string
  path: string
  children: TreeNode[]
}

/** skill 节点；`path` 是包含 SKILL.md 的目录在仓库里的完整路径。 */
export interface SkillNode {
  type: 'skill'
  name: string
  path: string
  description: string
  /** 这个 skill 目录下嵌套的 skill / 目录；通常为空。 */
  children: TreeNode[]
}

/** 展示树节点。 */
export type TreeNode = DirNode | SkillNode

/** 仓库分类：标准 npx skills 仓库（根 `skills/`）或不可用。 */
export type RepoKind = 'npx-skills' | 'unavailable'

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
  /**
   * 刷新本地克隆失败时的提示：此时保留旧克隆、继续用缓存内容，错误只在
   * 结果里报给调用方。
   */
  readonly warning?: string
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
  readonly warning?: string
}

/** 本地扫描树 / 克隆目录里的一个节点；建树只读 `type` 与 `path`。 */
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
  readonly warning?: string
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

/** 分类结果；读仓库内容失败时带 `failure`（目前分类本身不读文件）。 */
export type RepoClassification =
  | { kind: 'npx-skills' }
  | { kind: 'unavailable' }
  | { failure: RepoSkillsFailure }

/** 两个入口共用的前半段结果。 */
export type ResolvedTarget =
  | {
      readonly ok: true
      readonly origin: RepoOrigin
      readonly canonical: string
      readonly timestamp: number
      readonly file: string
      readonly entries: Record<string, CacheEntry>
      readonly id: string
      readonly cached: CacheEntry | undefined
    }
  | { readonly ok: false; readonly failure: RepoSkillsFailure }
