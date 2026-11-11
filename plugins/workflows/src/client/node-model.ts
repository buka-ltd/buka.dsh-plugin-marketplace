/**
 * 图模型 / 定义快照的读取：节点标题、类型、状态、出边与步骤概览。
 */

import type { RunGraphNode } from '../graph.ts'
import type { WorkflowRobotSession, WorkflowRunRecord, WorkflowStep } from '../run-store.ts'
import { h } from './element.ts'
import { truncateText } from './format.ts'
import type { ClientDefinition, ClientNode, Translate } from './types.ts'

/**
 * 节点步骤概要：创建者写的 summary，缺省时退回提示词的第一行。
 *
 * @param config
 * @returns
 */
export function summaryText(config: ClientNode | null | undefined): string {
  if (config === null || typeof config !== 'object') return ''
  const summary = typeof config.summary === 'string' ? config.summary.trim() : ''
  if (summary !== '') return summary
  const prompt = typeof config.prompt === 'string' ? config.prompt : ''
  const first = prompt
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  if (first === undefined) return ''
  return truncateText(first, 160).text
}

/**
 * 节点标题：步骤概要就是标题。机器人节点用创建者写的 summary（旧定义退回
 * 提示词第一行，再退回机器人名），用户介入节点用标题，终止节点用 id。
 *
 * @param node 图模型里的节点
 * @param config 定义快照里的节点
 * @returns
 */
export function nodeTitle(node: RunGraphNode, config: ClientNode | null): string {
  if (node.type === 'robot') return summaryText(config) || node.robot || node.id
  if (node.type === 'user') return node.title || node.id
  return node.id
}

/**
 * 节点类型 → 本地化名称。
 *
 * @param t
 * @param type
 * @returns
 */
export function typeLabel(t: Translate, type: string): string {
  if (type === 'start') return t('typeStart')
  if (type === 'robot') return t('typeRobot')
  if (type === 'user') return t('typeUser')
  if (type === 'join') return t('typeJoin')
  if (type === 'end') return t('typeEnd')
  return String(type)
}

/**
 * 节点状态 → 卡片样式类。
 *
 * @param state
 * @returns
 */
export function stateClass(state: string): 'done' | 'running' | 'waiting' | 'failed' | 'idle' {
  switch (state) {
    case 'completed':
      return 'done'
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'failed':
    case 'rejected':
    case 'cancelled':
    case 'interrupted':
    case 'unavailable':
      return 'failed'
    default:
      return 'idle'
  }
}

/**
 * 从定义快照里取一个节点的原始配置（用于提示词、用户说明）。
 *
 * @param definition
 * @param id
 * @returns
 */
export function definitionNode(
  definition: ClientDefinition | null | undefined,
  id: string,
): ClientNode | null {
  if (definition === null || typeof definition !== 'object') return null
  const plan = definition.plan
  if (
    plan !== null &&
    typeof plan === 'object' &&
    plan.nodes !== null &&
    typeof plan.nodes === 'object'
  ) {
    const node = plan.nodes[id]
    if (node !== null && typeof node === 'object') return node
  }
  const raw = definition.definition
  if (raw !== null && typeof raw === 'object' && Array.isArray(raw.nodes)) {
    for (const node of raw.nodes) {
      if (node !== null && typeof node === 'object' && node.id === id) return node
    }
  }
  return null
}

/**
 * 一个节点关联的唯一会话 id 列表（按展示顺序）：
 *
 * - 运行中 `run.current.sessionId` 排最前（当前会话优先展示）；
 * - `run.sessions[].entries` 里记录到这个节点的会话（新格式）；
 * - 旧记录没有逐次进入的 `entries` 时，退回机器人 / 首末节点归属；
 * - 该节点各次执行自己记下的 `sessionId`。
 *
 * 同一个机器人一次运行通常只有一个会话，所以正常情况下列表长度为 1；只有旧记录
 * 里一个节点在几个会话中执行过，才会出现多项（每一段历史都要有打开入口）。
 *
 * @param node 图模型里的节点
 * @param nodeSteps 该节点的执行记录
 * @param liveSession 运行中节点在 `run.current` 上的会话 id（没有则为空串）
 * @param run 运行记录
 * @returns
 */
export function collectNodeSessionIds(
  node: RunGraphNode,
  nodeSteps: WorkflowStep[],
  liveSession: string,
  run: WorkflowRunRecord | null,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  /** @param value 候选会话 id */
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || value === '' || seen.has(value)) return
    seen.add(value)
    ids.push(value)
  }
  add(liveSession)
  const sessions: WorkflowRobotSession[] = Array.isArray(run?.sessions) ? run.sessions : []
  for (const session of sessions) {
    if (session === null || typeof session !== 'object') continue
    const entries = Array.isArray(session.entries) ? session.entries : []
    let listedHere = false
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || entry.nodeId !== node.id) continue
      listedHere = true
      add(typeof entry.sessionId === 'string' ? entry.sessionId : session.sessionId)
    }
    if (listedHere) continue
    // 旧记录没有 entries：会话记录按机器人归属，节点本身也按首末节点兜底。
    const sameRobot =
      node.type === 'robot' &&
      typeof node.robot === 'string' &&
      node.robot !== '' &&
      session.robot === node.robot
    const touchesNode = session.firstNodeId === node.id || session.lastNodeId === node.id
    if (sameRobot || touchesNode) add(session.sessionId)
  }
  for (const step of nodeSteps) add(step?.sessionId)
  return ids
}

/**
 * 一行「键：值」。
 *
 * @param key
 * @param value
 * @returns React 元素
 */
export function kvRow(key: string, value: string): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-kvRow' },
    h('span', { className: 'buka-workflows-kvKey' }, key),
    h('span', { className: 'buka-workflows-kvValue' }, value),
  )
}

/**
 * 胶囊文案：机器人节点优先用创建者写的步骤概要（旧定义没有时退回机器人
 * 名），用户介入节点用标题，终止节点用 id。
 *
 * @param node
 * @returns
 */
export function capsuleText(t: Translate, node: RunGraphNode): string {
  if (node.type === 'robot') return node.summary || node.robot || node.id
  if (node.type === 'user') return node.title || node.id
  if (node.type === 'start') return t('typeStart')
  return node.id
}

/**
 * 一条边在悬停时展示的名字。
 *
 * - 用户介入节点的边：先显示给用户看的选项文字（`labels`），这才是这条边
 *   对用户的意义；
 * - 机器人节点的边：创建者写的路由名 `names`；多条规则合并成一条边时按顺序
 *   并列；
 * - 没写名字的边：不展示，不拿目标 id 凑数。
 *
 * @param edge
 * @returns
 */
export function edgeLabel(
  edge: { labels?: string[]; names?: string[] } | null | undefined,
): string {
  const labels = Array.isArray(edge?.labels)
    ? edge.labels.filter((label) => typeof label === 'string' && label !== '')
    : []
  if (labels.length > 0) return labels.join(' / ')
  const names = Array.isArray(edge?.names)
    ? edge.names.filter((name) => typeof name === 'string' && name !== '')
    : []
  if (names.length > 0) return names.join(' / ')
  return ''
}

/**
 * 边的外观色 class：只认图模型归一后的 `success` / `failure`。
 *
 * 颜色是纯展示属性（定义里的可选 `tone`），不参与路由；状态 class
 * （`is-traversed` / `is-static` / `is-hovered`）仍然各自控制线宽、实线与
 * 压暗，CSS 里让 tone 的颜色优先于它们。
 *
 * @param edge
 * @returns
 */
export function edgeToneClass(edge: { tone?: unknown } | null | undefined): string {
  if (edge?.tone === 'success') return ' is-success'
  if (edge?.tone === 'failure') return ' is-failure'
  return ''
}

/**
 * 一次用户执行的 route 展示文字：优先用所选边的 `label`（定义里用户看到的
 * 选项），找不到时退回路由键。机器人执行仍然显示路由名。
 *
 * @param node 图模型里的节点
 * @param config 定义快照里的节点
 * @param route 路由键
 * @returns
 */
export function routeText(node: RunGraphNode, config: ClientNode | null, route: string): string {
  if (node.type !== 'user' || route === '') return route
  const next = Array.isArray(config?.next) ? config.next : []
  const edge = next.find((item) => item?.name === route)
  const label = typeof edge?.label === 'string' ? edge.label.trim() : ''
  return label === '' ? route : label
}

/**
 * 节点类型 → Tag tone；颜色用于区分类型。
 *
 * @param type
 * @returns
 */
export function typeTone(type: string): 'info' | 'warning' | 'success' | 'neutral' {
  if (type === 'start') return 'neutral'
  if (type === 'robot') return 'info'
  if (type === 'user') return 'warning'
  if (type === 'end') return 'success'
  return 'neutral'
}

/**
 * 模板节点的可读标题：机器人用抽象角色名，用户用标题，起止用固定文案。
 *
 * @param node
 * @returns
 */
export function templateNodeLabel(
  t: Translate,
  node: {
    type?: string
    robot?: string | null
    summary?: string | null
    title?: string | null
    id?: string
  },
): string {
  if (node.type === 'robot') return node.robot || node.summary || node.id || ''
  if (node.type === 'user') return node.title || node.id || ''
  if (node.type === 'start') return t('typeStart')
  return t('typeEnd')
}
