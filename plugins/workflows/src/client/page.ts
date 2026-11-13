/**
 * 侧边栏「工作流」页面：装配状态、数据 effect 与动作，渲染只做分发。
 *
 * 导航只有一条链：工作流列表 → 工作流（作业 / 定义结构）→ 作业（概览 /
 * 实时流程 / 看板 / 资产）。不存在跨工作流的作业列表。
 */

import type React from 'react'

import { renderPage } from './components/page-shell.ts'
import type { AppContext } from './page-context.ts'
import { createActions } from './state/use-actions.ts'
import { useWorkflowEffects } from './state/use-effects.ts'
import { usePageState } from './state/use-page-state.ts'
import type { WorkflowsPageProps } from './types.ts'
import { useIsNarrow } from './use-narrow.ts'

export { createInitialState } from './state/use-page-state.ts'

/**
 * 侧边栏「工作流」页面。
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
  const page: AppContext = { t, getService, state: store.state, actions, narrow }
  return renderPage(page)
}
