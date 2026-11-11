/**
 * `@buka/dsh-plugin-skills` 的浏览器一半：侧边栏的「Skills」页面。
 *
 * DSH 的面板由两处注册拼成（见 `@deepseek-ai/dsh-client-ui-sidebar` 与
 * `@deepseek-ai/dsh-client-ui-layout` 的契约）：
 *
 * - `sidebar.panellist` 里的一个图标组件：侧边栏负责按钮、tooltip 与选中态，
 *   图标只拿 `{ size, active }`；
 * - `main` 里以同一个 id 为 key 的页面组件：侧边栏点选时布局挂载它。
 *
 * 页面顶部只有两个 Tab，不放说明文字：
 *
 * - 「已安装」：两个全局 skills 根目录下现有的 skill，标注哪些由 npx skills
 *   管理，并提供按来源选择的卸载入口；
 * - 「收藏」：用户自己记下的 npx skills 来源（`owner/repo`、GitHub/GitLab 等
 *   git 地址、本地绝对路径或包名），用于以后 `npx skills add` 时随手取用；
 *   点标题打开仓库，卡片右侧的「删除」按钮与已安装列表的卸载按钮同款
 *   （outline + 危险色）。来源既可以是 npx skills 仓库，也可以是 Claude Code
 *   marketplace 仓库：打开收藏页后会对每个可列出 skills 的收藏静默探测仓库
 *   类型（`probe=1`，只读 tree，不阻塞列表），标题行标出「npx skills」
 *   「Claude Code 市场」或「不可用」。展开后的每个 skill 右侧有「安装」按钮：
 *   点一下就把这一个 skill 装到全局（Host 交给 `npx skills add -g`），已经装过
 *   的显示为禁用的「已安装」按钮（带对勾图标），不提供重复安装的入口。
 *
 * 新增收藏不再是页面里的常驻输入行：标题行右侧「刷新」旁边的「收藏」按钮
 * 打开一个对话框，填「仓库」与「备注」后提交；两个按钮尺寸一致。
 *
 * 视觉与交互直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`
 * （模块表里的静态项，不需要声明 external）：`Button` / `Input` /
 * `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标；页面
 * 布局、卡片与状态文字沿用 Plugins 页面（`dsh-client-ui-plugin-manager`）的
 * 结构：标题行 + 工具栏 + Tab 行，内容区 960px 宽、卡片列表、48px 图标块。
 * 这样两个页面共享同一套尺寸、圆角、颜色 token 与控件手感。
 *
 * 页面只做展示与触发：列表、卸载、安装、收藏的读写都走 Host 一半注册的包内
 * 路由（`/buka-skills/*`），不在浏览器里判断 npx 的安装方式，也不碰文件系统 ——
 * 这样「怎么卸载」「怎么安装」「收藏存在哪」都只有一份实现。收藏页的展开状态与
 * 上次拿到的树属于纯页面状态，缓存在 localStorage（`dsh.buka-skills.view.v1`）：
 * 关闭 DSH 再打开时先按上次的样子渲染，再找 Host 校正，不用干等网络。
 *
 * 本文件只做装配：页面在 `components/skills-page.ts`，状态与请求在 `state.ts`，
 * 词典在 `dictionary.ts`，样式在 `styles.ts`，基座组件在 `primitives.ts`。
 * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
 * 那层外壳由构建脚本 `scripts/build-clients.ts` 生成，源码里不写死包名。
 *
 * @module @buka/dsh-plugin-skills/client
 */

import type { Context } from '@deepseek-ai/cordis'

import type { SlotDefinition } from '../../../../types/dsh.js'
import { SkillsPanelIcon } from './components/panel-icon.ts'
import { SkillsPage } from './components/skills-page.ts'
import { PANEL_ID } from './constants.ts'
import { en, NS, zh } from './dictionary.ts'
import { CSS } from './styles.ts'

/** 浏览器一半依赖的两个客户端服务。 */
export const inject = ['slots', 'locale']

/**
 * 注册侧边栏条目与主面板页面。
 *
 * @param ctx 浏览器插件上下文
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-skills: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-skills'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'buka-skills: styles')

  // 侧边栏图标：id 与 main 的 key 相同，点击由侧边栏自己完成。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => t('panel'),
        locale: NS,
      },
      SkillsPanelIcon,
    ),
  )

  // 主面板页面：布局按侧边栏选中的 id 挂载这里的组件。
  // `main` 插槽用 `key`（不是 `id`）标识页面，共享声明的 `SlotDefinition`
  // 只描述了 sidebar 那种带 `id` 的形状，这里按实际契约收窄。
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      } as unknown as SlotDefinition,
      SkillsPage,
    ),
  )
}
