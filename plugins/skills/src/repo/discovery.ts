/**
 * `npx skills` 的 SKILL.md 发现规则，以及据此判定仓库类型。
 *
 * 发现规则与 `npx skills` CLI 的 `findSkillMdPaths()` 保持一致（文件名必须是
 * `SKILL.md`、优先级前缀、container 层级、跳过的目录），**展示方式也照 CLI 的
 * 清单来**：npx 仓库不按仓库的物理目录分组。像 `skills/<bucket>/<skill>/
 * SKILL.md` 这种 catalog 布局，bucket 只对发现有用。
 *
 * 收藏的仓库有两类，判定顺序固定（用户要求）：先按 `npx skills` 的优先级前缀
 * （标准布局）判定 npx skills 仓库；没命中再看仓库根有没有
 * `.claude-plugin/marketplace.json`，有合法清单就按 Claude Code marketplace
 * 处理；两者都不是时，npx 的兜底规则（任意不超过 6 段的 SKILL.md）仍然算 npx
 * skills 仓库；最后才标记为不可用（`repo-unavailable`）。兜底排在 marketplace
 * 之后，是因为它太宽松：`plugins/<plugin>/skills/<name>/SKILL.md` 正好 5 段，
 * 会命中；若它在前，marketplace 永远显示成 npx。判定本身只看这棵树，不依赖
 * 清单文件；npx 仓库展开时才读清单做插件分组，判定不受影响。
 *
 * @module @buka/dsh-plugin-skills/repo/discovery
 */

import { failure } from './failure.ts'
import { MARKETPLACE_PATH, parseMarketplace } from './marketplace.ts'
import type { RepoBlobEntry, RepoClassification, RepoTreeEntry } from './types.ts'

/**
 * 优先级前缀，顺序必须与 `npx skills` CLI 的 `PRIORITY_PREFIXES` 一致：
 * 越靠前的容器目录越优先；空串表示「根目录或一层目录」。
 */
const PRIORITY_PREFIXES = [
  '',
  'skills/',
  'skills/.curated/',
  'skills/.experimental/',
  'skills/.system/',
  '.agents/skills/',
  '.claude/skills/',
  '.cline/skills/',
  '.codebuddy/skills/',
  '.codex/skills/',
  '.commandcode/skills/',
  '.continue/skills/',
  '.factory/skills/',
  '.github/skills/',
  '.goose/skills/',
  '.grok/skills/',
  '.iflow/skills/',
  '.junie/skills/',
  '.kilo/skills/',
  '.kilocode/skills/',
  '.kimchi/skills/',
  '.kiro/skills/',
  '.minimax/skills/',
  '.mux/skills/',
  '.neovate/skills/',
  '.opencode/skills/',
  '.openhands/skills/',
  '.pi/skills/',
  '.posit/assistant/skills/',
  '.qoder/skills/',
  '.roo/skills/',
  '.trae/skills/',
  '.windsurf/skills/',
  '.zcode/skills/',
  '.zencoder/skills/',
]

/** 与 CLI 相同的跳过目录，只在 container 下的嵌套候选里生效。 */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])

/**
 * 路径的 basename 是否就是 `SKILL.md`（大小写不敏感）。
 *
 * 不能写成 `endsWith('skill.md')`：那会把 `.changeset/foo-skill.md`、
 * `my-skill.md` 这类普通 Markdown 也当成 skill。`npx skills` CLI 的
 * `findSkillMdPaths()` 用的是 basename 比较。
 *
 * @param value 仓库内路径
 */
function isSkillMdPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const name = value.slice(value.lastIndexOf('/') + 1)
  return name.toLowerCase() === 'skill.md'
}

/** 树节点是否是带字符串路径的 blob；用于把 unknown 树收窄成可读路径。 */
function isBlobEntry(entry: RepoTreeEntry): entry is RepoBlobEntry {
  return entry.type === 'blob' && typeof entry.path === 'string'
}

/** 树里所有 blob 的完整路径。 */
export function treeBlobPaths(tree: RepoTreeEntry[]): string[] {
  return tree.filter(isBlobEntry).map((entry) => entry.path)
}

/**
 * 收集树里所有 SKILL.md blob 的完整路径。
 *
 * @param tree GitHub 树节点数组
 */
export function allSkillMdPaths(tree: RepoTreeEntry[]): string[] {
  return treeBlobPaths(tree).filter(isSkillMdPath)
}

/**
 * 只按优先级前缀发现 SKILL.md，返回命中的完整路径集合。
 *
 * 分类时用它判断 npx 规则是不是**真的**发现了这个仓库：`findSkillMdPaths()`
 * 末尾还有一条很宽松的兜底（任意 ≤6 段的 SKILL.md），Claude Code marketplace
 * 的 `plugins/<plugin>/skills/<name>/SKILL.md` 正好会被它命中。若兜底也算
 * 「npx 仓库」，marketplace 就永远轮不到，所以先用优先级前缀判定。
 *
 * 另外，catalog 布局（`skills/<bucket>/<skill>/SKILL.md`）命中前缀后不再把
 * bucket 目录留到展示层：npx 的清单是扁平的，bucket 只对发现有用。
 */
function findPrioritySkillMdPaths(allSkillMds: string[]): Set<string> {
  const lowerPaths = new Set(allSkillMds.map((one) => one.toLowerCase()))
  const found = new Set<string>()

  for (const prefix of PRIORITY_PREFIXES) {
    const isContainer = prefix !== ''
    for (const skillMd of allSkillMds) {
      if (!skillMd.startsWith(prefix)) continue
      const rest = skillMd.slice(prefix.length)

      // 前缀下的根 SKILL.md。
      if (rest.toLowerCase() === 'skill.md') {
        found.add(skillMd)
        continue
      }

      const parts = rest.split('/')
      // `<prefix>/<skill>/SKILL.md`：容器下的直接子目录，总是接受。
      if (parts.length === 2 && (parts[1] ?? '').toLowerCase() === 'skill.md') {
        found.add(skillMd)
        continue
      }

      // 容器下的分组目录：只接受两层到三层的 skill 目录，且不能嵌在另一个
      // skill 目录里，也不能落在 node_modules/.git 等目录中。
      const skillDirs = parts.slice(0, -1)
      const hasAncestorSkill = skillDirs.slice(0, -1).some((_, index) => {
        const ancestor = skillDirs.slice(0, index + 1).join('/')
        return lowerPaths.has(`${prefix}${ancestor}/SKILL.md`.toLowerCase())
      })
      if (
        isContainer &&
        parts.length >= 3 &&
        parts.length <= 4 &&
        (parts.at(-1) ?? '').toLowerCase() === 'skill.md' &&
        skillDirs.every((part) => !SKIP_DIRS.has(part)) &&
        !hasAncestorSkill
      ) {
        found.add(skillMd)
      }
    }
  }

  return found
}

/**
 * 照搬 `npx skills` CLI 的 `findSkillMdPaths()`，返回可安装 skill 的
 * `SKILL.md` 完整路径列表（顺序同 CLI：优先级前缀顺序 → 树顺序）。
 *
 * 与 CLI 一样返回扁平路径：容器前缀（`skills/`、`.agents/skills/` 等）和
 * catalog 布局里的 bucket 目录都只用于发现，不进展示路径；展示分组由
 * `readSkillGroupings()` 按仓库清单决定。CLI 的 `subpath` 参数这里不需要，
 * 等价于空串。
 *
 * @param tree GitHub 树节点数组
 */
export function findSkillMdPaths(tree: RepoTreeEntry[]): string[] {
  const allSkillMds = allSkillMdPaths(tree)
  if (allSkillMds.length === 0) return []

  const found = findPrioritySkillMdPaths(allSkillMds)
  if (found.size > 0) return [...found]
  // 没有命中任何优先级前缀时跟随 CLI 的兜底：最多 6 段路径。
  return allSkillMds.filter((skillMd) => skillMd.split('/').length <= 6)
}

/**
 * 判定仓库属于哪种技能仓库，顺序固定：npx skills → marketplace → 不可用。
 *
 * npx 的**优先级前缀**命中任何一个 SKILL.md 就直接按 npx skills 处理，
 * **不再拉** marketplace.json；只有优先级规则一个都没命中时才看仓库根有没有
 * `.claude-plugin/marketplace.json`。兜底的宽松规则留到最后：marketplace 的
 * `plugins/<plugin>/skills/<name>/SKILL.md` 也会被兜底命中，若它先于
 * marketplace 判定，这类仓库就永远显示成 npx（详见 `findPrioritySkillMdPaths`）。
 *
 * tree 里说 marketplace 文件在、却读不到时返回 `fetch-failed`（而不是
 * 「不可用」），避免把网络 / 读文件问题误判成仓库类型。
 */
export async function classifyRepo({
  tree,
  reader,
}: {
  tree: RepoTreeEntry[]
  reader: { readFile: (repoPath: string) => Promise<string | null> }
}): Promise<RepoClassification> {
  const allSkillMds = allSkillMdPaths(tree)
  if (findPrioritySkillMdPaths(allSkillMds).size > 0) return { kind: 'npx-skills' }

  const listed = tree.some(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      entry.type === 'blob' &&
      entry.path === MARKETPLACE_PATH,
  )
  if (listed) {
    const text = await reader.readFile(MARKETPLACE_PATH)
    if (text === null) {
      return {
        failure: failure(
          'fetch-failed',
          'Failed to read the Claude Code marketplace manifest from the repository.',
        ),
      }
    }
    const marketplace = parseMarketplace(text)
    // 清单不合法：这个仓库不是可用的 Claude Code marketplace，继续看 npx 的
    // 兜底规则能不能列出它，而不是直接判死。
    if (marketplace !== null) return { kind: 'claude-code-marketplace', marketplace }
  }

  // 没有 marketplace 文件（或清单不合法）时，npx 的兜底规则仍然生效，与展开时
  // 的发现结果一致。
  if (allSkillMds.some((skillMd) => skillMd.split('/').length <= 6)) return { kind: 'npx-skills' }
  return { kind: 'unavailable' }
}
