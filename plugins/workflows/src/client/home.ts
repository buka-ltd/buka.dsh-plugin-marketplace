/**
 * 面板首页：顶部 Workflow / Worker 两个页签，下面按页签挂载对应的页面。
 *
 * 页签由 hash 驱动：`#/workers`（或 `#/workers/…`）落在 Worker 页签，其余
 * hash 都是工作流路由，落在 Workflow 页签。刷新、浏览器前进 / 后退、执行者
 * 影响面弹窗里的「打开作业」（写 `#/job/...`）都靠同一个 hashchange 监听。
 *
 * 顶部页签只由两个列表页渲染；工作流 / 作业 / 执行者详情页使用自己的页头
 * （ADR 0029），页签元素照常传下去，页面按当前视图决定用不用。
 *
 * 只挂载活动页签：切页签会卸载另一页，执行者页的选中态 / 草稿不跨页签保留
 * （与合并前两个侧边栏面板互切的行为一致）；工作流页的路由与数据都在 hash
 * 与 Host 里，重新挂载即可恢复。
 */

import { TabLabel } from '@buka/plugin-ui'
import { type SegmentedTab, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import React from 'react'

import { h } from './element.ts'
import { WorkflowsPage } from './page.ts'
import type { Translate, UseSessionStatus } from './types.ts'
import { WorkersPage } from './workers/components/workers-page.ts'

/** 首页页签。 */
export type HomeTab = 'workflow' | 'worker'

/** Worker 页签的 hash：`#/workers` 或其后缀路由。 */
const WORKERS_HASH = /^#\/workers(?:\/|$)/u

/** 没有工作流 hash 可恢复时写的列表页地址。 */
const WORKFLOWS_DEFAULT_HASH = '#/workflows'

/** 当前 hash；非浏览器环境（或读取失败）返回空串。 */
function currentHash(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.location.hash
  } catch {
    return ''
  }
}

/** hash → 页签：`#/workers…` 是 Worker，其余都按工作流路由处理。 */
function tabOf(hash: string): HomeTab {
  return WORKERS_HASH.test(hash) ? 'worker' : 'workflow'
}

/**
 * 只保留工作流一侧的 hash：Worker 页签的 hash 或空 hash 都归一成列表页。
 *
 * @param hash
 * @returns 可以写回地址栏的工作流 hash
 */
function workflowHashOf(hash: string): string {
  if (hash === '' || WORKERS_HASH.test(hash)) return WORKFLOWS_DEFAULT_HASH
  return hash
}

/** 页面首次挂载时的页签；非浏览器环境默认 Workflow。 */
function initialTab(): HomeTab {
  return tabOf(currentHash())
}

/**
 * 把页签写回地址栏。Worker 页签用 `#/workers`；Workflow 页签恢复上一次的
 * 工作流 hash（没有就写列表页）。hash 未变化时不产生历史记录。
 *
 * @param tab 目标页签
 * @param lastWorkflowHash 切回 Workflow 页签时恢复的工作流 hash
 */
function writeTabHash(tab: HomeTab, lastWorkflowHash: string): void {
  if (typeof window === 'undefined') return
  const hash = tab === 'worker' ? '#/workers' : lastWorkflowHash || WORKFLOWS_DEFAULT_HASH
  try {
    if (window.location.hash === hash) return
    window.location.hash = hash
  } catch {
    // 某些受限 WebView 不允许改地址；页面仍按内存状态工作。
  }
}

/**
 * 面板首页。
 *
 * @param props 工作流词典、执行者词典与 Client Service 取值器
 * @returns React 元素
 */
export function HomePage(props: {
  t: Translate
  workersT: Translate
  getService: (name: string) => unknown | null
  /** `main` 插槽注入的全局会话状态钩子；透传给工作流页。 */
  useSessionStatus?: UseSessionStatus | undefined
}): React.ReactElement {
  const { t, workersT } = props
  const getService = typeof props.getService === 'function' ? props.getService : () => null
  const [tab, setTab] = React.useState<HomeTab>(initialTab)
  const lastWorkflowHash = React.useRef(workflowHashOf(currentHash()))

  // hash 是页签的唯一来源：hashchange 时更新页签，并记住工作流一侧的 hash。
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onHash = () => {
      const hash = window.location.hash
      if (tabOf(hash) === 'workflow') lastWorkflowHash.current = workflowHashOf(hash)
      setTab(tabOf(hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /** 切页签：先写 hash，再切内存状态；工作流页重新挂载时按 hash 恢复路由。 */
  function selectTab(next: HomeTab) {
    writeTabHash(next, lastWorkflowHash.current)
    setTab(next)
  }

  const tabs: [SegmentedTab<HomeTab>, SegmentedTab<HomeTab>] = [
    {
      value: 'workflow',
      label: h(TabLabel, { text: t('topTabWorkflow') }),
      id: 'workflow-hometab-workflow',
      panelId: 'workflow-homepanel-workflow',
    },
    {
      value: 'worker',
      label: h(TabLabel, { text: t('topTabWorker') }),
      id: 'workflow-hometab-worker',
      panelId: 'workflow-homepanel-worker',
    },
  ]

  // 顶部两个页签由页面自己放进「页签带」：带子的右侧留给当前屏的操作按钮，
  // 这样页签与按钮始终同一条基线、同一个内容列。
  const topTabs = h(SegmentedTabs, {
    size: 'sm',
    className: 'buka-workflows-homeTabList',
    label: t('topTabsAria'),
    value: tab,
    onChange: selectTab,
    items: tabs,
  })

  return h(
    'div',
    { className: 'buka-workflows-home' },
    h(
      'div',
      { className: 'buka-workflows-frame' },
      tab === 'worker'
        ? h(WorkersPage, { t: workersT, getService, topTabs })
        : h(WorkflowsPage, { t, getService, topTabs, useSessionStatus: props.useSessionStatus }),
    ),
  )
}
