/**
 * 把仓库内容装配成可展示的树：读 SKILL.md 元数据、按目录建树、排序。
 *
 * 只处理一种布局：仓库根 `skills/` 下的 skill（允许任意层级子目录）。一个
 * 包含 `SKILL.md` 的目录就是技能叶子：叶子用该目录的仓库路径（如
 * `skills/engineering/code-review`），不再为 `SKILL.md` 文件单独建节点；
 * 不含 `SKILL.md` 的目录只作分组，保留物理目录结构。叶子下如果还有嵌套
 * skill（目录自己带 `SKILL.md` 又套了子 skill），它们挂在叶子的 `children`
 * 上。页面上的「全部安装」因此可以直接收集叶子路径。`metadata.internal: true`
 * 的内部 skill 不列。
 *
 * 元数据走统一的 `reader.readFile()`：本地路径与本地克隆都不碰网络。
 *
 * @module @buka/dsh-plugin-skills/repo/tree
 */

import { parseFrontmatter, parseFrontmatterInternal } from '../frontmatter.ts'
import { findSkillMdPaths } from './discovery.ts'
import type { RepoTreeEntry, SkillFileMeta, SkillMetadata, SkillNode, TreeNode } from './types.ts'

/** 同时读取 SKILL.md 的并发上限，避免一次打开几十个文件 / 连接。 */
const SKILL_MD_CONCURRENCY = 6

/**
 * 按仓库树把 skill 文件读成可展示的树。
 *
 * @param tree 仓库树
 * @param reader 仓库读取抽象（本地目录或浅克隆）
 * @param repoName 仓库名；`skills/SKILL.md` 缺名称时的兜底
 */
export async function loadRepoContent({
  tree,
  reader,
  repoName,
}: {
  tree: RepoTreeEntry[]
  reader: { readFile: (repoPath: string) => Promise<string | null> }
  repoName: string
}): Promise<{ root: TreeNode[]; skills: number }> {
  const discovered = findSkillMdPaths(tree)
  const metadata = await mapLimit(discovered, SKILL_MD_CONCURRENCY, (skillMd) =>
    readSkillMetadata(skillMd, reader),
  )
  return buildTree(metadata, repoName)
}

/**
 * 按仓库内完整路径读取并解析一个 SKILL.md；失败时 name/description 都留空。
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

/** 建树时的中间目录节点：子目录按名字去重，`SKILL.md` 记在目录自己身上。 */
interface DirBuilder {
  name: string
  path: string
  dirs: Map<string, DirBuilder>
  /** 这个目录里的 SKILL.md 元数据；没有（或 internal 被跳过）时是分组目录。 */
  skill: SkillMetadata | undefined
}

/**
 * 把发现结果装配成按物理目录分层的树。
 *
 * 一个目录只要有自己的 `SKILL.md`，它就是技能叶子：节点路径取目录路径，
 * 不再生成 `SKILL.md` 子节点。目录里的其它子目录（含子 skill）作为叶子的
 * `children`；没有 `SKILL.md` 的目录只当分组。
 *
 * @param entries 发现阶段读到的元数据
 * @param repoName 仓库名
 */
function buildTree(
  entries: SkillMetadata[],
  repoName: string,
): { root: TreeNode[]; skills: number } {
  const root: DirBuilder = { name: '', path: 'skills', dirs: new Map(), skill: undefined }
  let skills = 0

  for (const entry of entries) {
    if (entry.internal === true) continue
    skills += 1
    // 路径一定以 `skills/` 开头，切掉这段与最后的 `SKILL.md` 后按目录分段。
    const segments = entry.fullPath.split('/').slice(1, -1)
    let current = root
    let pathSoFar = 'skills'
    for (const segment of segments) {
      pathSoFar = `${pathSoFar}/${segment}`
      const existing = current.dirs.get(segment)
      if (existing === undefined) {
        const created: DirBuilder = {
          name: segment,
          path: pathSoFar,
          dirs: new Map(),
          skill: undefined,
        }
        current.dirs.set(segment, created)
        current = created
      } else {
        current = existing
      }
    }
    current.skill = entry
  }

  return { root: finishRoot(root, repoName), skills }
}

/**
 * 把中间根节点转成展示列表。根目录 `skills` 自己不单独显示：它有自己的
 * SKILL.md 时，根部那个 skill 用 `children` 包住其余节点。
 */
function finishRoot(builder: DirBuilder, repoName: string): TreeNode[] {
  const children = finishChildren(builder, repoName)
  if (builder.skill === undefined) return children
  return [skillNodeOf(builder, repoName, children)]
}

/**
 * 递归装配一个目录下的子节点：有 `SKILL.md` 的子目录是 skill 叶子，否则是
 * 分组目录。
 */
function finishChildren(builder: DirBuilder, repoName: string): TreeNode[] {
  const nodes: TreeNode[] = []
  for (const dir of builder.dirs.values()) {
    const children = finishChildren(dir, repoName)
    nodes.push(
      dir.skill === undefined
        ? { type: 'dir', name: dir.name, path: dir.path, children }
        : skillNodeOf(dir, repoName, children),
    )
  }
  sortTree(nodes)
  return nodes
}

/** 把一个带 `SKILL.md` 的目录装配成 skill 节点；名称缺失时回退目录名。 */
function skillNodeOf(builder: DirBuilder, repoName: string, children: TreeNode[]): SkillNode {
  const entry = builder.skill as SkillMetadata
  const segments = builder.path.split('/').slice(1)
  const name = entry.name === '' ? fallbackSkillName(segments, repoName) : entry.name
  return {
    type: 'skill',
    name,
    path: builder.path,
    description: entry.description,
    children,
  }
}

/**
 * skill 名称缺失时的兜底：所在目录名；`skills/SKILL.md` 用仓库名。
 */
function fallbackSkillName(segments: string[], repoName: string): string {
  return segments.at(-1) ?? repoName
}

/**
 * 递归排序：目录在前、skill 在后，同类按 `name` 的大小写不敏感升序；
 * 叶子下嵌套的子节点同样递归排序。
 */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return compareName(a.name, b.name)
  })
  for (const node of nodes) sortTree(node.children)
}

/**
 * 大小写不敏感的 `localeCompare`；完全相同时再用原始大小写稳定排序。
 */
function compareName(a: string, b: string): number {
  const folded = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return folded !== 0 ? folded : a.localeCompare(b)
}
