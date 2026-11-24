/**
 * 「工作流」页签（首页 Workflow Tab 的内容）：装配状态、数据 effect 与动作，
 * 渲染只做分发。
 *
 * 导航只有一条链：工作流列表 → 工作流（作业 / 结构图 / 任务类型）→ 作业
 * （概览 / 实时流程 / 看板 / 资产）。不存在跨工作流的作业列表。
 */

import type React from 'react'

import { renderPage } from './components/page-shell.ts'
import type { AppContext } from './page-context.ts'
import { createActions } from './state/use-actions.ts'
import { useWorkflowEffects } from './state/use-effects.ts'
import { usePageState } from './state/use-page-state.ts'
import { EMPTY_SESSION_STATUS, type UseSessionStatus, type WorkflowsPageProps } from './types.ts'
import { useIsNarrow } from './use-narrow.ts'

export { createInitialState } from './state/use-page-state.ts'

/** 组合里没有会话状态钩子时使用：始终返回空快照，功能静默降级。 */
const useEmptySessionStatus: UseSessionStatus = (selector) => selector(EMPTY_SESSION_STATUS)

/**
 * 「工作流」页签（首页 Workflow Tab 的内容）。
 *
 * @param props 词典与 Client Service 取值器
 * @returns React 元素
 */
export function WorkflowsPage(props: WorkflowsPageProps): React.ReactElement {
  const t = props.t
  const getService = typeof props.getService === 'function' ? props.getService : () => null

  const store = usePageState()
  useWorkflowEffects(store)
  const narrow = useIsNarrow()
  const actions = createActions(store, { t, getService })
  // `main` 插槽随页面提供全局会话状态；旧组合缺钩子时用空快照，保持 Hook 调用位置稳定。
  const useSessionStatus =
    typeof props.useSessionStatus === 'function' ? props.useSessionStatus : useEmptySessionStatus
  const sessionStatus = useSessionStatus((snapshot) => snapshot)
  // 顶部页签：首页装配；页面只在列表视图摆放，详情页用独立页头。
  const topTabs = props.topTabs ?? (null as unknown as React.ReactElement)
  const page: AppContext = {
    t,
    getService,
    state: store.state,
    actions,
    narrow,
    topTabs,
    sessionStatus,
  }
  return renderPage(page)
}
