/**
 * `@buka/dsh-plugin-bell` 的浏览器一半：在 设置 → 提示音 里选四个声音。
 *
 * 页面本身不保存任何状态：读写都走 DSH 的设置表单服务 `ctx.configForms`
 * （Host 设置的浏览器镜像）。交互是两级的：设置页是四行，点一行进入该时机的
 * **独立声音列表页**；列表里点一项就同时「选中 + 试听」——写入配置并请求
 * Host 播放一次（`POST /buka-bell/preview`），不自动返回，只有点「返回」才
 * 回到四行页面，方便连着听几个再定。「无」表示那个时机不响。
 *
 * 不用 Modal、也不在行内展开：设置本身就是浮层，再叠一层弹窗或撑开页面都
 * 破坏操作预期；整页替换成列表最简单，也最像「进入一个页面」。
 *
 * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
 * 那层外壳由构建脚本 `scripts/build-clients.ts` 生成，源码里不写死包名。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Field } from './components/settings.ts'
import { BellSettings } from './components/settings.ts'
import { en, NS, zh } from './dictionaries.ts'
import { CSS } from './styles.ts'

/** Host 插件行 id：设置表单按这个命名空间读写 Host 的 volatile 配置。 */
const NAMESPACE = 'sound-buka-bell'

/** 浏览器一半依赖的三个客户端服务。 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * 注册设置页入口。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-bell: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-bell'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'buka-bell: styles')

  const form = ctx.configForms.get(NAMESPACE)
  const bellForm = {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener: () => void) => form.subscribe(listener),
  }

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'buka-bell',
        order: 16,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({
          hooks: { bellForm },
          setSound: (field: Field, value: string) => form.set(field, value),
        }),
      },
      BellSettings,
    ),
  )
}
