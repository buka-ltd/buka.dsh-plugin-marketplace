/**
 * 页面里用到的键与计数：安装目录键、行键、树节点里的 skill 数。
 *
 * 这些函数都是纯字符串 / 纯树操作，页面状态与各个面板共用；安装目录键的规则
 * 与 `npx skills` 的初始化规则一致，见 `skillKeyOf()`。
 *
 * @module @buka/dsh-plugin-skills/client/keys
 */

import type { SkillTreeChild } from './types.ts'

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

export { countSkills, entryKey, installKeyOf, skillKeyOf }
