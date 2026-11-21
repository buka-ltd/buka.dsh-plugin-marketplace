/**
 * 提示与更新弹窗的文案：英文与简体中文各一份，键完全相同。
 *
 * `apply()` 把两份词典注册到 `NS` 命名空间；组件里的 `t()` 由
 * `ctx.locale.bind(NS)` 提供。`{count}` / `{names}` 这类占位符由词典服务替换。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/dictionary
 */

/** 词典命名空间。 */
export const NS = 'buka-skill-update-check'

/** 英文文案。 */
const en = {
  label: 'SKILL updates',
  badgeOne: 'skill update',
  badgeMany: 'skill updates',
  hint: 'Updates available:',
  hintOpen: 'Click to review and update.',
  separator: ', ',
  error: 'Update check failed:',
  dialogTitle: 'SKILL updates',
  close: 'Close',
  recheck: 'Check again',
  update: 'Update',
  updateAll: 'Update all',
  updating: 'Updating…',
  updatingCount: 'Updating {count} skills…',
  updatingHint: 'It keeps running in the background; you can close this dialog.',
  updatingBadge: 'Updating {count} skills',
  updatingBadgeOne: 'Updating 1 skill',
  updatedBadge: 'Updated {count} skills',
  updatedBadgeOne: 'Updated 1 skill',
  checking: 'Checking…',
  upToDateTitle: 'All project skills are up to date.',
  upToDateHint: 'Nothing left to update in this workspace.',
  modifiedTitle: 'Local changes — not updated:',
  nothingToCheckTitle: 'Nothing to check.',
  nothingToCheckHint:
    'This workspace has no skills-lock.json, or no project skills managed by npx skills.',
  nothingUpdated: 'Nothing to update.',
  updatedNames: 'Updated: {names}.',
  updateFailed: 'Update failed:',
} as const

/** 简体中文文案。 */
const zh: Record<keyof typeof en, string> = {
  label: 'SKILL 更新',
  badgeOne: '个技能可更新',
  badgeMany: '个技能可更新',
  hint: '有更新的项目技能：',
  hintOpen: '点击查看并更新。',
  separator: '、',
  error: '检查技能更新失败：',
  dialogTitle: 'SKILL 更新',
  close: '关闭',
  recheck: '重新检查',
  update: '更新',
  updateAll: '全部更新',
  updating: '更新中…',
  updatingCount: '正在更新 {count} 个技能…',
  updatingHint: '更新在后台继续，可以关闭弹窗。',
  updatingBadge: '正在更新 {count} 个技能',
  updatingBadgeOne: '正在更新 1 个技能',
  updatedBadge: '已更新 {count} 个技能',
  updatedBadgeOne: '已更新 1 个技能',
  checking: '正在检查…',
  upToDateTitle: '项目技能都已是最新的。',
  upToDateHint: '当前工作区没有待更新的技能。',
  modifiedTitle: '有本地修改，未参与更新：',
  nothingToCheckTitle: '没有可检查的项目技能。',
  nothingToCheckHint: '当前工作区没有 skills-lock.json，或里面没有由 npx skills 管理的项目技能。',
  nothingUpdated: '没有可更新的技能。',
  updatedNames: '已更新：{names}。',
  updateFailed: '更新失败：',
}

export { en, zh }

/** 词典键。 */
export type SkillUpdatesKey = keyof typeof en
