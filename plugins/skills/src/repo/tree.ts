/**
 * 把仓库内容装配成可展示的树：读 SKILL.md 元数据、按目录建树、排序。
 *
 * 只处理一种布局：仓库根 `skills/` 下的 skill（允许任意层级子目录）。展示树
 * 保留仓库里的物理目录结构，目录节点用真实仓库路径（如 `skills/engineering`），
 * skill 节点用完整路径；页面上的「全部安装」因此可以直接收集叶子路径。
 * `metadata.internal: true` 的内部 skill 不列。
 *
 * 元数据走统一的 `reader.readFile()`：本地路径与本地克隆都不碰网络。
 *
 * @module @buka/dsh-plugin-skills/repo/tree
 */

import { parseFrontmatter, parseFrontmatterInternal } from '../frontmatter.ts'
import { findSkillMdPaths } from './discovery.ts'
import type {
  DirNode,
  RepoTreeEntry,
  SkillFileMeta,
  SkillMetadata,
  SkillNode,
  TreeNode,
} from './types.ts'

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

/** 建树时的中间目录节点：子节点按名字去重后再装配成展示节点。 */
interface DirBuilder {
  name: string
  path: string
  dirs: Map<string, DirBuilder>
  skills: SkillNode[]
}

/**
 * 把发现结果装配成按物理目录分层的树。
 *
 * 目录与 skill 的 `path` 都保留仓库里的完整路径；目录名取目录段。skill 名称
 * 优先 frontmatter `name`，缺失时回退到所在目录名，`skills/SKILL.md` 回退到
 * 仓库名。
 *
 * @param entries 发现阶段读到的元数据
 * @param repoName 仓库名
 */
function buildTree(
  entries: SkillMetadata[],
  repoName: string,
): { root: TreeNode[]; skills: number } {
  const root: DirBuilder = { name: '', path: 'skills', dirs: new Map(), skills: [] }
  let skills = 0

  for (const entry of entries) {
    if (entry.internal === true) continue
    skills += 1
    // 路径一定以 `skills/` 开头，切掉这段后按目录分段；最后一段是 SKILL.md。
    const segments = entry.fullPath.split('/').slice(1, -1)
    const name = entry.name === '' ? fallbackSkillName(segments, repoName) : entry.name
    const node: SkillNode = {
      type: 'skill',
      name,
      path: entry.fullPath,
      description: entry.description,
    }
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
          skills: [],
        }
        current.dirs.set(segment, created)
        current = created
      } else {
        current = existing
      }
    }
    current.skills.push(node)
  }

  return { root: finishDir(root), skills }
}

/**
 * skill 名称缺失时的兜底：所在目录名；`skills/SKILL.md` 用仓库名。
 */
function fallbackSkillName(segments: string[], repoName: string): string {
  return segments.at(-1) ?? repoName
}

/** 把中间节点转成展示节点并递归排序。 */
function finishDir(builder: DirBuilder): TreeNode[] {
  const dirs: DirNode[] = [...builder.dirs.values()].map((dir) => ({
    type: 'dir',
    name: dir.name,
    path: dir.path,
    children: finishDir(dir),
  }))
  const nodes: TreeNode[] = [...dirs, ...builder.skills]
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
