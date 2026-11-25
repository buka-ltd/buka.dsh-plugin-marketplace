/**
 * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的一个入口，首页顶部
 * 两个页签——「工作流」与「执行者」；页签只出现在两个列表页，详情页使用
 * 各自的独立页头（ADR 0029）。
 *
 * 两半页面各自的契约不变：
 *
 * - 「执行者」页（`workers/`）负责「工作区身份」：挂载 / 删除工作区注册 /
 *   打开会话都走 DSH 的 Client Service（`workspaces.*`、`uiWorkspace.*`），
 *   磁盘内容由 Host 的 `/workflow/workers/*` 路由处理。
 * - 「工作流」页（本目录其余模块）只做一条链：工作流列表 → 工作流
 *   （作业 / 结构图 / 任务类型）→ 作业（概览 / 实时流程 / 看板 / 资产），数据与动作来自
 *   Host 的 `/workflow/*` 路由。
 *
 * 两个页签由 `home.ts` 的 `HomePage` 装配：页签由 hash 驱动（`#/workers`
 * ↔ 执行者页签），跨页签跳转（如删除影响面里的「打开作业」）只写 hash。
 *
 * DSH 的面板由两处注册拼成（见 `@deepseek-ai/dsh-client-ui-sidebar` 与
 * `@deepseek-ai/dsh-client-ui-layout` 的契约）：
 *
 * - `sidebar.panellist` 里的一个图标组件：侧边栏负责按钮、tooltip 与选中态，
 *   图标只拿 `{ size, active }`；
 * - `main` 里以同一个 id 为 key 的页面组件：侧边栏点选时布局挂载它。
 *   组件的 props 由插槽位置与 `inject()` 决定：`t` 按 `locale` 绑定本命名空间，
 *   `workersT` 按执行者命名空间绑定，`getService` 取 DSH 的 Client Service。
 *
 * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
 * 那层外壳由构建脚本 `scripts/build-clients.ts` 在构建时生成，源码里不写死包名。
 * 模块顶层只有纯声明（常量、文案、样式、辅助函数），不注册插槽、不发请求、
 * 不碰 DOM；所有副作用都在 `apply(ctx)` 里。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SlotDefinition } from '../../../../types/dsh.js'
import { WorkflowsPanelIcon } from './components/panel-icon.ts'
import { HomePage } from './home.ts'
import { en, zh } from './i18n.ts'
import { CSS } from './styles.ts'
import { NS, PANEL_ID } from './types.ts'
import { NS as WORKERS_NS } from './workers/constants.ts'
import { en as workersEn, zh as workersZh } from './workers/i18n.ts'
import { CSS as workersCss } from './workers/styles.ts'

export const inject = ['slots', 'locale']

/**
 * 注册唯一的侧边栏条目与首页（两个页签），并在插件生效期注入文案与样式。
 */
export function apply(ctx: Context): void {
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

  // ---- 两半页面的词典与样式 ------------------------------------------------
  ctx.effect(
    () => ctx.locale.register(WORKERS_NS, { zh: workersZh, en: workersEn }),
    'workflow-workers: dictionaries',
  )
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-workflows'
    tag.textContent = workersCss
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'workflow-workers: styles')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workflow: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-workflows'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'workflow: styles')

  // ---- 唯一的侧边栏条目与首页 ----------------------------------------------
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => ctx.locale.bind(NS)('panel'),
        locale: NS,
      },
      WorkflowsPanelIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        // `workersT` 必须是绑定后的翻译函数，而不是返回它的 getter：插槽把
        // `inject` 返回对象里的函数当普通 prop 传给组件，不会再调用一层。
        // 多包一层会让执行者页的 `t()` 全部拿到函数（页签 / 按钮文案为空，
        // 数量标签渲染成函数源码）。
        inject: () => ({ getService, workersT: ctx.locale.bind(WORKERS_NS) }),
      } as unknown as SlotDefinition,
      HomePage,
    ),
  )
}
