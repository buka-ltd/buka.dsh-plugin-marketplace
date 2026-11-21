/**
 * `@buka/dsh-plugin-skill-update-check` 的浏览器一半。
 *
 * 只注册一个插槽：`conversation.composer.dock`——新建会话输入框卡片下方的
 * 统计行。提示在统计行里用 flex `order` 排到「上下文已用」圆环之后
 * （见 `styles.ts`）。组件在 `badge.ts`，请求在 `api.ts`，文案在
 * `dictionary.ts`，样式在 `styles.ts`。提示只在当前工作区有项目技能更新时
 * 出现，点击可重新检查。
 *
 * 本文件只导出 `inject` 与 `apply`；`window.__ModuleLoader__.load(...)` 外壳
 * 由构建脚本生成。
 *
 * @module @buka/dsh-plugin-skill-update-check/client
 */

import type { Context } from '@deepseek-ai/cordis'

import { SkillUpdatesBadge } from './badge.ts'
import { en, NS, zh } from './dictionary.ts'
import { CSS } from './styles.ts'

/** 浏览器一半依赖的两个客户端服务。 */
export const inject = ['slots', 'locale']

/**
 * 注册词典、样式与输入框下方的提示。
 *
 * @param ctx 浏览器插件上下文
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-skill-update-check: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-skill-update-check'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'buka-skill-update-check: styles')

  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'buka-skill-update-check',
        order: 20,
        label: () => t('label'),
        locale: NS,
      },
      SkillUpdatesBadge,
    ),
  )
}
