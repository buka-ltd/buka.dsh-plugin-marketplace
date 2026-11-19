/**
 * 页面里用到的键与计数：安装目录键、行键、树节点里的 skill 数。
 *
 * 这些函数都是纯字符串 / 纯树操作，页面状态与各个面板共用；安装目录键的规则
 * 与 `npx skills` 的初始化规则一致，见 `skillKeyOf()`。
 *
 * @module @buka/dsh-plugin-skills/client/keys
 */

import { workerIdentityLabel } from '@buka/plugin-ui/worker-label'

import type {
  InstallTargetsSnapshot,
  SkillTreeChild,
  SkillTreeLeaf,
  TargetDialogKind,
} from './types.ts'

/**
 * 同名的 skill 可能同时存在于两个全局根，所以页面状态用「根 + 名称」做键。
 *
 * @param entry 一条 skill
 */
function entryKey(entry: { readonly scope: string; readonly id: string }): string {
  return `${entry.scope}:${entry.id}`
}

/**
 * skill 名对应的安装目录键，规则与 `npx skills` 的 sanitizeName() / Host 的
 * `skillDirName()` 一致：小写，非 `[a-z0-9._]` 的连续字符换成连字符，去掉
 * 首尾的 `.` 与 `-`，最多 255 字符。用来判断仓库树里的 skill 是否已安装。
 *
 * @param name skill 名
 */
function skillKeyOf(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, 255)
}

/**
 * 一条树里的 skill 与它所在收藏的组合键：安装中只让这一行显示进度，
 * 其它行继续可读（但按钮统一禁用，Host 侧安装/卸载本来也是串行的）。
 *
 * @param repo 一条收藏
 * @param node Host 返回的 skill 节点
 */
function installKeyOf(repo: { readonly id: string }, node: { readonly path?: unknown }): string {
  return `${repo.id}\n${typeof node?.path === 'string' ? node.path : ''}`
}

/**
 * 一个树节点里的 skill 数；目录节点用它显示数量。
 *
 * @param node Host 返回的树节点
 */
function countSkills(node: SkillTreeChild): number {
  if (node.type === 'skill') return 1
  const children = Array.isArray(node.children) ? node.children : []
  let total = 0
  for (const child of children) total += countSkills(child)
  return total
}

/**
 * 一个树节点里的全部 skill 叶子；目录按深度优先展开。
 *
 * 目录行上的「全部安装」用它收集要装的 skill；目录节点的 `path` 只是展示
 * 分组键（npx 仓库是插件名，marketplace 是插件根），不能当仓库路径用。
 *
 * @param node Host 返回的树节点
 */
function skillLeavesOf(node: SkillTreeChild): SkillTreeLeaf[] {
  if (node.type === 'skill') return [node]
  const children = Array.isArray(node.children) ? node.children : []
  return children.flatMap((child) => skillLeavesOf(child))
}

/**
 * 对话框里一类目标的条目；快照缺字段时当作空列表。
 *
 * @param kind 目标类型
 * @param snapshot 目标列表快照
 */
function targetItemsOf(kind: TargetDialogKind, snapshot: InstallTargetsSnapshot | null): unknown[] {
  const list = kind === 'worker' ? snapshot?.workers : snapshot?.workspaces
  return Array.isArray(list?.items) ? [...list.items] : []
}

/**
 * 目标条目的选择键：执行者用不可变标识符（旧版退回 `name`），工作区用路径。
 *
 * @param kind 目标类型
 * @param item 一条目标
 */
function targetKeyOf(kind: TargetDialogKind, item: unknown): string {
  const record = item as Record<string, unknown> | null | undefined
  if (kind === 'worker') {
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    if (id !== '') return id
    return typeof record?.name === 'string' ? record.name.trim() : ''
  }
  const value = record?.path
  return typeof value === 'string' ? value : ''
}

/**
 * 目标条目的展示标签：执行者按「名称 · 标识符」消歧，工作区用标题（缺省回退
 * 路径）。
 *
 * @param kind 目标类型
 * @param item 一条目标
 */
function targetLabelOf(kind: TargetDialogKind, item: unknown): string {
  const record = item as Record<string, unknown> | null | undefined
  if (kind === 'worker') return workerIdentityLabel(record)
  const title = typeof record?.title === 'string' ? record.title.trim() : ''
  return title !== '' ? title : typeof record?.path === 'string' ? record.path : ''
}

/**
 * 目标条目的路径副标题；执行者 / 工作区都有，缺失时返回空串。
 *
 * @param item 一条目标
 */
function targetPathOf(item: unknown): string {
  const record = item as Record<string, unknown> | null | undefined
  return typeof record?.path === 'string' ? record.path : ''
}

export {
  countSkills,
  entryKey,
  installKeyOf,
  skillKeyOf,
  skillLeavesOf,
  targetItemsOf,
  targetKeyOf,
  targetLabelOf,
  targetPathOf,
}
