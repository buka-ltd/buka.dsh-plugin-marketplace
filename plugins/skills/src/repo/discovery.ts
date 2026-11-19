/**
 * 可安装 skill 的发现规则与仓库分类。
 *
 * 收藏只支持一种格式：仓库根 `skills/` 目录下（允许任意层级子目录）的
 * `SKILL.md`。根目录的 `SKILL.md`、任何 agent 目录（`.claude/skills`、
 * `.codex/skills` 等）与 Claude Code marketplace 的插件目录都不算可安装来源；
 * 一个 `SKILL.md` 都没有的仓库标记为不可用。
 *
 * 发现结果保留 SKILL.md 在仓库里的完整路径（如
 * `skills/engineering/review/SKILL.md`）；建树时把它的父目录转成技能叶子，
 * 展示树与安装流程都用目录路径做唯一定位。`node_modules`、`.git` 等目录不
 * 参与发现，避免把仓库里的依赖或元数据当成 skill。
 *
 * @module @buka/dsh-plugin-skills/repo/discovery
 */

import type { RepoBlobEntry, RepoClassification, RepoTreeEntry } from './types.ts'

/** 可安装 skill 所在的顶层目录。 */
export const SKILLS_DIR = 'skills'

/** 与仓库树扫描保持一致的跳过目录。 */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])

/**
 * 路径的 basename 是否就是 `SKILL.md`（大小写不敏感）。
 *
 * 不能写成 `endsWith('skill.md')`：那会把 `.changeset/foo-skill.md`、
 * `my-skill.md` 这类普通 Markdown 也当成 skill。
 *
 * @param value 仓库内路径
 */
export function isSkillMdPath(value: unknown): value is string {
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
 * @param tree 仓库树节点数组
 */
export function allSkillMdPaths(tree: RepoTreeEntry[]): string[] {
  return treeBlobPaths(tree).filter(isSkillMdPath)
}

/**
 * 一个仓库内路径是否落在 `skills/` 下、且中间没有跳过目录。
 *
 * @param skillMd 仓库内的完整 SKILL.md 路径
 */
function isUnderSkillsDir(skillMd: string): boolean {
  const segments = skillMd.split('/')
  if (segments[0] !== SKILLS_DIR || segments.length < 2) return false
  // 最后一段是 SKILL.md；中间目录不能是隐藏依赖或构建产物。
  return segments.slice(1, -1).every((segment) => segment !== '' && !SKIP_DIRS.has(segment))
}

/**
 * 发现仓库里可安装的 skill：`skills/` 下任意层级的 `SKILL.md`。
 *
 * 根 `SKILL.md`、agent 目录与仓库里其它位置的 `SKILL.md` 一律忽略。返回的
 * 顺序与树一致，展示树再按名字排序。
 *
 * @param tree 仓库树节点数组
 */
export function findSkillMdPaths(tree: RepoTreeEntry[]): string[] {
  return allSkillMdPaths(tree).filter(isUnderSkillsDir)
}

/**
 * 判定仓库是否可用：根 `skills/` 下至少有一个 `SKILL.md`。
 *
 * 不读任何文件，只看树。没有可安装 skill 的仓库（包括只有根 `SKILL.md`、
 * 只有 `.claude/skills/**`、或 Claude Code marketplace 布局的仓库）统一
 * 标记为 `unavailable`。
 *
 * @param tree 仓库树节点数组
 */
export function classifyRepo(tree: RepoTreeEntry[]): RepoClassification {
  const skills = findSkillMdPaths(tree)
  return skills.length > 0 ? { kind: 'npx-skills' } : { kind: 'unavailable' }
}
