/**
 * `@buka/dsh-plugin-robots` 的浏览器一半：侧边栏的「机器人」页面。
 *
 * v2 语义：机器人是**插件自己创建并登记**的条目，而不是 DSH 里的全部工作区。
 * 机器人目录统一放在插件全局目录下（Host 的 `robotsDir`），登记表是
 * `<机器人根目录>/../robots.json`；页面只展示登记表里的机器人，DSH 里用户
 * 自己建的工作区不显示。每个机器人可以「挂载」成 DSH 工作区（之后出现在
 * 侧边栏工作区列表里），也可以从工作区列表摘掉而保留目录与登记记录。
 *
 * 分工是固定的：
 *
 * - 浏览器一半（本文件）负责「工作区身份」：挂载 / 删除工作区注册 / 打开会话
 *   都必须走 DSH 的 Client Service（`workspaces.create`、`workspaces.delete`、
 *   `uiWorkspace.openWorkspace`），这样侧边栏与主区域才会立刻同步；
 * - Host 一半负责「磁盘内容」：创建机器人目录、维护登记表、扫描项目级 skills、
 *   跑 `npx skills`、读写 `AGENTS.md`，浏览器只通过 `/buka-robots/*` 路由请求它。
 *
 * DSH 的面板由两处注册拼成（见 `@deepseek-ai/dsh-client-ui-sidebar` 与
 * `@deepseek-ai/dsh-client-ui-layout` 的契约）：
 *
 * - `sidebar.panellist` 里的一个图标组件：侧边栏负责按钮、tooltip 与选中态，
 *   图标只拿 `{ size, active }`；
 * - `main` 里以同一个 id 为 key 的页面组件：侧边栏点选时布局挂载它。
 *
 * 页面有两个视图，共用同一个标题行与工具栏：
 *
 * - 列表视图：整行点击（或点机器人名 / 键盘 Tab 到标题）进入详情，行内动作是
 *   「新会话 / 挂载 / 删除」。删除先摘掉工作区注册、再删插件记录，目录与文件
 *   保留；登记文件损坏时只允许刷新，新建/删除/挂载都会禁用。列表**不展示目录**
 *   （机器人根目录与各机器人路径都只在详情页出现）；每张卡片显示机器人的一行
 *   描述（工作流靠它决定是否选用该机器人）；标题行「刷新」右侧的「创建机器人」
 *   按钮打开对话框填名称与描述后提交；全新安装（登记表为空）时插件会自动补上
 *   「软件工程师」与「质量保障工程师」两个预设机器人；
 * - 配置视图：标题左侧的返回按钮回到列表，右侧是「新会话 / 打开 Finder / 刷新」；
 *   机器人名旁的铅笔按钮打开「重命名机器人」对话框：改的是机器人目录名，Host 会
 *   在新路径重建 DSH 工作区，已有会话日志保留但不再列在这个机器人下。正文用
 *   可切换的页签分成
 *   「描述」（一句话摘要，工作流用它决定是否选用这个机器人）、
 *   「AGENTS.md」（编辑目录下的 AGENTS.md，Host 同时维护 CLAUDE.md 软链接）
 *   与「Skills」（列出已安装的项目级 skills，并通过对话框选择来源里要安装的
 *   skills；来源可以直接用 Skills 插件的收藏仓库，该插件没装时这一块不显示）。
 *   「打开 Finder」把机器人目录交给系统文件管理器（Host 的 `/buka-robots/reveal`）。
 *
 * 视觉与交互直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`
 * （模块表里的静态项，不需要声明 external）：`Button` / `Input` / `Modal` /
 * `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标；textarea、
 * 复选框与滚动列表用原生元素 + 自带 CSS。
 * 页面布局沿用 Plugins / Skills 页面的结构：标题行 + 工具栏 + 960px 内容区 +
 * 卡片列表，颜色与尺寸只用主题 token。这样三个页面共享同一套控件手感。
 *
 * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
 * 那层外壳由构建脚本 `scripts/build-clients.ts` 在构建时生成，源码里不写死包名。
 * 模块顶层只有纯声明（常量、文案、样式、辅助函数），不注册插槽、不发请求、
 * 不碰 DOM；所有副作用都在 `apply(ctx)` 里。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SlotDefinition } from '../../../../types/dsh.js'
import { RobotsPanelIcon } from './avatar.ts'
import { RobotsPage } from './components/robots-page.ts'
import { NS, PANEL_ID } from './constants.ts'
import { en, zh } from './i18n.ts'
import { CSS } from './styles.ts'

export const inject = ['slots', 'locale']

/**
 * 注册侧边栏条目与主面板页面，并在插件生效期注入文案与样式。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)

  /**
   * 页面从插件上下文里取 DSH 的 Client Service。`ctx.get` 在服务不存在
   * 时会抛错，这里统一收敛成 null，由页面给出可读提示。
   *
   */
  function getService(serviceName: string): unknown | null {
    try {
      return ctx.get(serviceName) ?? null
    } catch {
      return null
    }
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-robots: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-robots'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'buka-robots: styles')

  // 侧边栏图标：id 与 main 的 key 相同，点击与选中态由侧边栏自己完成。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => t('panel'),
        locale: NS,
      },
      RobotsPanelIcon,
    ),
  )

  // 主面板页面：布局按侧边栏选中的 id 挂载这里的组件；页面通过 inject
  // 拿到服务解析函数，其余文案由插槽按 locale 注入。
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      // main 插槽按 `key` 匹配（见 dsh-client-ui-layout 契约）；共享的
      // SlotDefinition 是按 settings.* 插槽声明的（要求 id），这里按实际
      // 运行时契约传入。
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ getService }),
      } as unknown as SlotDefinition,
      RobotsPage,
    ),
  )
}
