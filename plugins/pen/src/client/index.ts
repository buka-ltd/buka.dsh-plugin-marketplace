/**
 * `@buka/dsh-plugin-pen` 的浏览器一半：把「Pen」勾选框放进新会话行。
 *
 * 只注册一个插槽 `conversation.hero.options`——官方 worktree 勾选框就在
 * 这里，位置在新会话框右上角、工作区与预设控件之后。勾选框本身在
 * `toggle.ts`，请求在 `api.ts`，文案在 `dictionary.ts`，样式在 `styles.ts`。
 *
 * 本文件只导出 `inject` 与 `apply`；`window.__ModuleLoader__.load(...)` 外壳
 * 由构建脚本生成。
 *
 * @module @buka/dsh-plugin-pen/client
 */

import type { Context } from '@deepseek-ai/cordis'

import { en, LABEL, NS, zh } from './dictionary.ts'
import { CSS } from './styles.ts'
import { PenToggle } from './toggle.ts'

/** 浏览器一半依赖的客户端服务。 */
export const inject = ['slots', 'locale']

/**
 * 注册词典、样式与勾选框。
 *
 * @param ctx 浏览器插件上下文
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-pen: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-pen'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'buka-pen: styles')

  ctx.slots.inject('conversation.hero.options', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.options',
        id: 'buka-pen',
        order: 20,
        label: () => LABEL,
        locale: NS,
      },
      PenToggle,
    ),
  )
}
