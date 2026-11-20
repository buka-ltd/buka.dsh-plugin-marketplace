/**
 * 提示的文案：英文与简体中文各一份，键完全相同。
 *
 * `apply()` 把两份词典注册到 `NS` 命名空间；组件里的 `t()` 由
 * `ctx.locale.bind(NS)` 提供。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/dictionary
 */

/** 词典命名空间。 */
export const NS = 'buka-skill-update-check'

/** 英文文案。 */
const en = {
  label: 'SKILL update notice',
  badgeOne: 'skill update',
  badgeMany: 'skill updates',
  hint: 'Updates available:',
  hintRecheck: 'Click to check again.',
  separator: ', ',
  error: 'Update check failed:',
  errorShort: 'Skill update check failed',
} as const

/** 简体中文文案。 */
const zh: Record<keyof typeof en, string> = {
  label: 'SKILL 更新提示',
  badgeOne: '个技能可更新',
  badgeMany: '个技能可更新',
  hint: '有更新的项目技能：',
  hintRecheck: '点击重新检查。',
  separator: '、',
  error: '检查技能更新失败：',
  errorShort: '技能更新检查失败',
}

export { en, zh }

/** 词典键。 */
export type SkillUpdatesKey = keyof typeof en
