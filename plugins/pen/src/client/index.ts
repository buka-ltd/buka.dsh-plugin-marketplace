/**
 * `@buka/dsh-plugin-pen` 的浏览器一半：新会话行里的「Pen」勾选框，以及会话
 * 标题右侧的「Pen MCP」标记。
 *
 * 注册两个插槽：
 *
 * - `conversation.hero.options`——官方 worktree 勾选框就在这里，位置在新会话框
 *   右上角、工作区与预设控件之后；只在空会话（新会话）阶段出现。
 * - `conversation.session.header.actions`——紧挨会话标题的右侧、官方工具按钮
 *   之前；标记只在这一会话勾选过 Pen 时显示，补上「会话开始后看不到勾选框」
 *   的信息缺口。
 *
 * 勾选框在 `toggle.ts`，标题标记在 `mark.ts`，请求在 `api.ts`，文案在
 * `dictionary.ts`，样式在 `styles.ts`。
 *
 * 本文件只导出 `inject` 与 `apply`；`window.__ModuleLoader__.load(...)` 外壳
 * 由构建脚本生成。
 *
 * @module @buka/dsh-plugin-pen/client
 */

import type { Context } from '@deepseek-ai/cordis'

import { en, LABEL, MARK_LABEL, NS, zh } from './dictionary.ts'
import { PenMark } from './mark.ts'
import { CSS } from './styles.ts'
import { PenToggle } from './toggle.ts'

/** 浏览器一半依赖的客户端服务。 */
export const inject = ['slots', 'locale']

/**
 * 注册词典、样式、勾选框与标题标记。
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

  // 列表插槽按 order 升序排列（再按注册顺序）；10 让它排在官方动作按钮之前，
  // 紧贴标题。标记只有一行品牌文字，不需要词典的 `t`。
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'buka-pen-mark',
        order: 10,
        label: () => MARK_LABEL,
      },
      PenMark,
    ),
  )
}
