/**
 * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的「工作流」页面。
 *
 * 这一半只做**只读观测**：workflow 由编排 preset（默认 `workflow-orchestrator`）
 * 的会话现场创建，没有可复用的流程列表，也没有“从这里启动流程”的入口。页面
 * 展示落盘的运行记录：
 *
 * - 列表：最近运行的状态、目标、runId、开始时间；
 * - 详情：分层二维节点图占据页面主体，并行的节点在同一排；点节点从右侧抽屉看
 *   节点详情（按「第几次执行」拆成 Tab），点连线从右侧抽屉看这条边的配置；
 * - 每个节点可以「打开会话」，复用 DSH 的 `uiWorkspace.openSession(sessionId)`；
 *   客户端会话列表里还没有这个会话时先补一次 `sessions.refresh()`。
 *
 * 运行记录由 Host 的 `/buka-workflows/runs` 与 `/buka-workflows/run` 两条只读
 * 路由提供，附件下载走 `/buka-workflows/attachment`；有运行在跑时每 1.5 秒刷新一次（否则 5 秒），后台运行也能看到进度。
 *
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
