/**
 * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的「工作流」页面。
 *
 * 页面只做一条链：工作流列表 → 工作流（作业 / 定义结构）→ 作业（概览 /
 * 实时流程 / 看板 / 资产）。
 *
 * - 工作流列表：名称、描述、版本、作业数；停用的工作流灰显并排在后面；
 * - 工作流页：作业（默认）按状态筛选；定义结构是可交互的分层图，点节点 / 连线
 *   在右侧抽屉里看岗位、任务类型、边与契约；
 * - 作业页：概览（需求 / 结构化输入、最终交付物、启动信息）、实时流程（任务
 *   状态叠在定义图上）、看板（岗位 × 状态）、资产（按来源任务分组的资产池）；
 *   点节点 / 卡片从右侧抽屉看任务，人任务按产出 schema 填表提交；
 * - 作业有 `running` 时每 1.5 秒刷新一次，否则 5 秒。
 *
 * 数据与动作来自 Host 的 `/buka-workflows/*` 路由；附件下载 / 预览走
 * `/buka-workflows/attachment`。会话入口复用 `uiWorkspace.openSession(sessionId)`，
 * 客户端会话列表里还没有这个会话时先补一次 `sessions.refresh()`。
 *
 * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
 * 那层外壳由构建脚本 `scripts/build-clients.ts` 生成，源码里不写死包名。
 */

import type { Context } from '@deepseek-ai/cordis'

import { WorkflowsPanelIcon } from './components/panel-icon.ts'
import { en, zh } from './i18n.ts'
import { WorkflowsPage } from './page.ts'
import { CSS } from './styles.ts'
import { NS, PANEL_ID } from './types.ts'

export const inject = ['slots', 'locale']

/**
 * 注册侧边栏条目与主面板页面，并注入文案与样式。
 *
 * @param ctx 浏览器插件上下文
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)

  /**
   * 页面从插件上下文里取 DSH 的 Client Service；不存在时返回 null。
   *
   * @param serviceName
   * @returns
   */
  function getService(serviceName: string): unknown {
    try {
      return ctx.get(serviceName) ?? null
    } catch {
      return null
    }
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-workflows: dictionaries')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@buka/dsh-plugin-workflows'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'buka-workflows: styles')

  // 侧边栏图标：id 与 main 的 key 相同。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 31,
        label: () => t('panel'),
        locale: NS,
      },
      WorkflowsPanelIcon,
    ),
  )

  // 主面板页面。
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      // 主面板插槽用 `key`（不是共享类型里写给 sidebar 的 `id`），这里按运行时形状传入。
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ getService }),
      } as unknown as Parameters<typeof ctx.slots.register>[0],
      WorkflowsPage,
    ),
  )
}
