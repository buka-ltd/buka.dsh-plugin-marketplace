/**
 * 页面地址：hash 路由的解析与写回。
 *
 * 只使用 hash，不接管 DSH 外壳的路由；刷新、浏览器前进 / 后退、把某个作业
 * 发给别人，都靠这一层。抽屉、选中项这类一次性的交互不写进地址。
 */

import type { JobView, Route, WorkflowTab } from './types.ts'

/** 合法的作业视图。 */
const JOB_VIEWS: readonly JobView[] = ['overview', 'flow', 'board', 'outputs']

/** 合法的工作流页签。 */
const WORKFLOW_TABS: readonly WorkflowTab[] = ['jobs', 'definition']

/**
 * 把地址里的 hash 解析成路由；认不出来时回工作流列表。
 *
 * @param hash `location.hash`，可带或不带 `#`
 * @returns 路由
 */
export function parseRouteHash(hash: string): Route {
  let parts: string[]
  try {
    parts = hash
      .replace(/^#/u, '')
      .replace(/^\//u, '')
      .split('/')
      .filter((part) => part !== '')
      .map((part) => decodeURIComponent(part))
  } catch {
    return { kind: 'workflows' }
  }

  if (parts[0] === 'workflow' && typeof parts[1] === 'string' && parts[1] !== '') {
    const tab = WORKFLOW_TABS.find((candidate) => candidate === parts[2]) ?? 'jobs'
    return { kind: 'workflow', workflowId: parts[1], tab }
  }
  if (
    parts[0] === 'job' &&
    typeof parts[1] === 'string' &&
    parts[1] !== '' &&
    typeof parts[2] === 'string' &&
    parts[2] !== ''
  ) {
    const view = JOB_VIEWS.find((candidate) => candidate === parts[3]) ?? 'overview'
    return { kind: 'job', workflowId: parts[1], jobId: parts[2], view }
  }
  return { kind: 'workflows' }
}

/**
 * 路由 → hash。
 *
 * @param route
 * @returns 以 `#/` 开头的地址片段
 */
export function routeHash(route: Route): string {
  if (route.kind === 'workflow') {
    return `#/workflow/${encodeURIComponent(route.workflowId)}/${route.tab}`
  }
  if (route.kind === 'job') {
    return `#/job/${encodeURIComponent(route.workflowId)}/${encodeURIComponent(route.jobId)}/${route.view}`
  }
  return '#/workflows'
}

/**
 * 页面首次挂载时的路由；非浏览器环境回工作流列表。
 *
 * @returns 路由
 */
export function initialRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'workflows' }
  try {
    return parseRouteHash(window.location.hash)
  } catch {
    return { kind: 'workflows' }
  }
}

/**
 * 把路由写回地址栏。hash 未变化时不产生历史记录。
 *
 * @param route
 */
export function writeRouteHash(route: Route): void {
  if (typeof window === 'undefined') return
  const hash = routeHash(route)
  try {
    if (window.location.hash === hash) return
    window.location.hash = hash
  } catch {
    // 某些受限 WebView 不允许改地址；页面仍按内存路由工作。
  }
}

/**
 * 返回上一层的路由（页内返回按钮用）。
 *
 * @param route
 * @returns 上一层路由
 */
export function parentRoute(route: Route): Route {
  if (route.kind === 'job') {
    return { kind: 'workflow', workflowId: route.workflowId, tab: 'jobs' }
  }
  return { kind: 'workflows' }
}

/**
 * 两个路由是否指向同一个页面（忽略页签 / 视图）。
 *
 * @param left
 * @param right
 * @returns
 */
export function sameRoutePage(left: Route, right: Route): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'workflows') return true
  if (left.kind === 'workflow' && right.kind === 'workflow') {
    return left.workflowId === right.workflowId
  }
  if (left.kind === 'job' && right.kind === 'job') {
    return left.jobId === right.jobId
  }
  return false
}
