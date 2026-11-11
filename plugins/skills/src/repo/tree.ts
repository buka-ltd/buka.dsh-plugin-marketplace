/**
 * 把仓库内容装配成可展示的树：读 SKILL.md 元数据、按清单分组、排序。
 *
 * npx skills 仓库与 Claude Code marketplace 两条展示规则都在这里：
 *
 * - npx：展示方式与 `npx skills add --list` 一致 —— 清单里显式归到插件的
 *   skill 放进以插件名命名的目录节点（同名插件的 skill 合并到同一组），其余
 *   skill 平铺在根上；**不按仓库的物理目录分组**。`metadata.internal: true`
 *   的内部 skill 默认不列（与 CLI 一致）；同名 skill 不去重（npx 的 GitHub
 *   快路径也只是逐个列出），保留它们是为了不隐藏仓库里真实存在的文件。
 * - marketplace：每个插件一个目录节点，skill 是它的直接子节点。
 *
 * 元数据走统一的 `reader.readFile()`：本地 / git 来源因此不碰网络，GitHub
 * 来源仍是 raw 请求 + frontmatter 解析 + 固定并发。
 *
 * @module @buka/dsh-plugin-skills/repo/tree
 */

import { parseFrontmatter, parseFrontmatterInternal } from '../frontmatter.ts'
import { allSkillMdPaths, findSkillMdPaths, SKIP_DIRS } from './discovery.ts'
import { readSkillGroupings } from './groupings.ts'
import type {
  CachedMarketplace,
  DirNode,
  MarketplacePlugin,
  MarketplaceSkillGroup,
  RepoTreeEntry,
  SkillFileMeta,
  SkillMetadata,
  SkillNode,
  TreeNode,
} from './types.ts'

/** 同时拉取 SKILL.md 的并发上限，避免一次打开几十个连接。 */
const SKILL_MD_CONCURRENCY = 6

/**
 * 按分类结果把仓库内容拉成可展示的树；只用于完整展开，探测不需要。
 *
 * SKILL.md 元数据走同一个 `reader.readFile()`：本地 / git 来源因此不碰网络，
 * GitHub 来源仍是 raw 请求 + frontmatter 解析 + 6 并发。
 *
 * npx 分支还会读仓库根的 `.claude-plugin/plugin.json` / `marketplace.json`
 * 做展示分组（读不到或不合法就当没有分组，不影响列表）。marketplace 分支的
 * 插件清单在分类时已经解析过，这里直接用。
 */
export async function loadRepoContent({
  tree,
  reader,
  classification,
  repoName,
}: {
  tree: RepoTreeEntry[]
  reader: { readFile: (repoPath: string) => Promise<string | null> }
  classification:
    | { kind: 'npx-skills' }
    | { kind: 'claude-code-marketplace'; marketplace: CachedMarketplace }
  repoName: string
}): Promise<{ root: TreeNode[]; skills: number }> {
  if (classification.kind === 'npx-skills') {
    const discovered = findSkillMdPaths(tree)
    const metadata = await mapLimit(discovered, SKILL_MD_CONCURRENCY, (skillMd) =>
      readSkillMetadata(skillMd, reader),
    )
    const groupings = await readSkillGroupings({ tree, reader })
    return buildNpxTree(metadata, groupings, repoName)
  }

  const groups = collectMarketplaceSkills(tree, classification.marketplace)
  const paths = groups.flatMap((group) => group.skills.map((skill) => skill.path))
  const fetched = await mapLimit(paths, SKILL_MD_CONCURRENCY, (skillPath) =>
    readSkillFile(reader, skillPath),
  )
  const metas = new Map<string, SkillFileMeta | undefined>()
  paths.forEach((skillPath, index) => {
    metas.set(skillPath, fetched[index])
  })
  return { root: buildMarketplaceTree(groups, metas), skills: paths.length }
}

/**
 * 按仓库内完整路径读取并解析一个 SKILL.md；失败时 name/description 都留空。
 *
 * 这是 npx 与 marketplace 两条流程共用的底层：npx 流再根据完整路径算展示用的
 * 名称回退，marketplace 流直接用仓库完整路径。`reader` 屏蔽了来源差异
 * （GitHub raw、本地文件或 git 克隆目录里的文件）。
 *
 * @param skillMd 仓库内的完整 SKILL.md 路径
 */
async function readSkillFile(
  reader: { readFile: (repoPath: string) => Promise<string | null> },
  skillMd: string,
): Promise<SkillFileMeta> {
  let text: string | null
  try {
    text = await reader.readFile(skillMd)
  } catch {
    text = null
  }

  try {
    const meta = parseFrontmatter(text ?? '')
    return {
      name: typeof meta.name === 'string' ? meta.name : '',
      description: typeof meta.description === 'string' ? meta.description : '',
      internal: parseFrontmatterInternal(text ?? ''),
    }
  } catch {
    // 解析器只处理字符串；这里兜底，避免一个坏文件让整棵树失败。
    return { name: '', description: '', internal: false }
  }
}

/**
 * 读取一个 SKILL.md 并解析 name/description；失败时两个字段都留空。
 *
 * @param skillMd 仓库内的完整 SKILL.md 路径
 */
async function readSkillMetadata(
  skillMd: string,
  reader: { readFile: (repoPath: string) => Promise<string | null> },
): Promise<SkillMetadata> {
  const meta = await readSkillFile(reader, skillMd)
  return {
    fullPath: skillMd,
    name: typeof meta.name === 'string' ? meta.name.trim() : '',
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
    internal: meta.internal === true,
  }
}

/**
 * 以固定并发跑一批异步任务，结果顺序与输入一致。
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index] as T, index)
    }
  }

  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

/**
 * 把 npx skills 仓库的发现结果拼成展示树。
 *
 * 展示方式与 `npx skills add --list` 一致：清单里显式归到插件的 skill 放进
 * 以插件名命名的目录节点（同名插件的 skill 合并到同一组），其余 skill 平铺在
 * 根上；**不按仓库的物理目录分组**。`metadata.internal: true` 的内部 skill
 * 默认不列（与 CLI 一致）；同名 skill 不去重（npx 的 GitHub 快路径也只是逐个
 * 列出），保留它们是为了不隐藏仓库里真实存在的文件。
 *
 * - 目录节点的 `name` 与 `path` 都是插件名；
 * - skill 节点的 `path` 用仓库里的完整路径（如 `skills/engineering/x/SKILL.md`）；
 * - 名称缺失时用 skill 所在目录名兜底，根目录的 `SKILL.md` 用仓库名。
 *
 * @param groupings skill 目录 → 插件名（`readSkillGroupings()` 的结果）
 */
function buildNpxTree(
  entries: SkillMetadata[],
  groupings: Map<string, string>,
  repoName: string,
): { root: TreeNode[]; skills: number } {
  const groups = new Map<string, SkillNode[]>()
  const plain: SkillNode[] = []
  let skills = 0

  for (const entry of entries) {
    if (entry.internal === true) continue
    skills += 1
    const name = entry.name === '' ? fallbackSkillName(entry.fullPath, repoName) : entry.name
    const node: SkillNode = {
      type: 'skill',
      name,
      path: entry.fullPath,
      description: entry.description,
    }
    const plugin = groupings.get(skillDirOf(entry.fullPath))
    if (plugin === undefined) {
      plain.push(node)
      continue
    }
    const children = groups.get(plugin)
    if (children === undefined) groups.set(plugin, [node])
    else children.push(node)
  }

  const dirs: DirNode[] = [...groups].map(([name, children]) => ({
    type: 'dir',
    name,
    path: name,
    children,
  }))
  const root: TreeNode[] = [...dirs, ...plain]
  sortTree(root)
  return { root, skills }
}

/**
 * SKILL.md 所在的仓库内目录；仓库根 `SKILL.md` 返回空串。
 */
function skillDirOf(skillMd: string): string {
  const slash = skillMd.lastIndexOf('/')
  return slash < 0 ? '' : skillMd.slice(0, slash)
}

/**
 * skill 名称缺失时的兜底：skill 目录名；仓库根 `SKILL.md` 用仓库名。
 */
function fallbackSkillName(skillMd: string, repoName: string): string {
  const dir = skillDirOf(skillMd)
  if (dir === '') return repoName
  return dir.slice(dir.lastIndexOf('/') + 1)
}

/**
 * 把树里的 SKILL.md 按 marketplace 插件分组。
 *
 * 每个插件扫它 root 下的**所有** SKILL.md（不只是 `skills/` 一层）：marketplace
 * 的插件目录结构比 npx skills 自由，可能由 plugin.json 或 entry 指定自定义
 * skills 目录。按插件 root 从深到浅分配，每条完整路径只归第一个插件（根插件
 * 最后兜底）；`rel` 任一段落在 SKIP_DIRS 里的路径跳过。
 *
 * @param tree GitHub 树节点数组
 */
function collectMarketplaceSkills(
  tree: RepoTreeEntry[],
  marketplace: { plugins: MarketplacePlugin[] },
): MarketplaceSkillGroup[] {
  const skillMds = allSkillMdPaths(tree)

  const ordered = [...marketplace.plugins].sort((a, b) => pathDepth(b.root) - pathDepth(a.root))
  const groups: MarketplaceSkillGroup[] = []
  const claimed = new Set<string>()
  for (const plugin of ordered) {
    const skills: Array<{ path: string; rel: string }> = []
    for (const skillPath of skillMds) {
      if (claimed.has(skillPath)) continue
      let rel: string
      if (plugin.root === '') {
        rel = skillPath
      } else {
        if (!skillPath.startsWith(`${plugin.root}/`)) continue
        rel = skillPath.slice(plugin.root.length + 1)
      }
      if (rel.split('/').some((segment) => SKIP_DIRS.has(segment))) continue
      claimed.add(skillPath)
      skills.push({ path: skillPath, rel })
    }
    if (skills.length > 0) {
      groups.push({ pluginName: plugin.name, pluginRoot: plugin.root, skills })
    }
  }
  return groups
}

/**
 * marketplace 预计的 skill 数量；探测用，不拉原文。
 */
export function countMarketplaceSkills(
  tree: RepoTreeEntry[],
  marketplace: { plugins: MarketplacePlugin[] },
): number {
  return collectMarketplaceSkills(tree, marketplace).reduce(
    (total, group) => total + group.skills.length,
    0,
  )
}

/**
 * 相对路径的深度；空串（仓库根）算 0。
 */
function pathDepth(root: string): number {
  return root === '' ? 0 : root.split('/').length
}

/**
 * 建 marketplace 的插件分组树：每个插件一个目录节点，skill 是它的直接子节点。
 *
 * 目录节点的 `path` 是插件 root（仓库根用 `.`），skill 节点保留仓库完整路径。
 * skill 名称优先 frontmatter `name`；为空时回退到 `rel` 的倒数第二段目录名，
 * `rel` 不足两段（插件根 `SKILL.md`）时回退到插件名。
 *
 * @param metas key 是完整路径
 */
function buildMarketplaceTree(
  groups: MarketplaceSkillGroup[],
  metas: Map<string, SkillFileMeta | undefined>,
): TreeNode[] {
  const nodes: DirNode[] = groups.map((group) => ({
    type: 'dir',
    name: group.pluginName,
    path: group.pluginRoot === '' ? '.' : group.pluginRoot,
    children: group.skills.map((skill): SkillNode => {
      const meta = metas.get(skill.path) ?? { name: '', description: '' }
      const segments = skill.rel.split('/')
      const fallback =
        segments.length >= 2 ? (segments.at(-2) ?? group.pluginName) : group.pluginName
      return {
        type: 'skill',
        name: meta.name === '' ? fallback : meta.name,
        path: skill.path,
        description: meta.description,
      }
    }),
  }))

  sortTree(nodes)
  return nodes
}

/**
 * 递归排序：目录在前、skill 在后，同类按 `name` 的大小写不敏感升序。
 */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return compareName(a.name, b.name)
  })
  for (const node of nodes) {
    if (node.type === 'dir') sortTree(node.children)
  }
}

/**
 * 大小写不敏感的 `localeCompare`；完全相同时再用原始大小写稳定排序。
 */
function compareName(a: string, b: string): number {
  const folded = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return folded !== 0 ? folded : a.localeCompare(b)
}
