/**
 * 作业的实时流程：同一份任务数据按岗位聚合后画在定义图上。
 *
 * 节点表达「谁在做什么、做了多少、哪里在等认领、哪里出了问题」；点节点
 * 打开该岗位的任务列表（单任务直接进任务抽屉）。
 */

import type React from 'react'

import type { GraphEdgeInput, GraphNodeInput } from '../graph/layout.ts'
import { renderWorkflowGraph } from '../graph/render.ts'
import {
  currentDefinition,
  currentJobDefinition,
  edgesOf,
  jobTasks,
  mergedDefinition,
  positionsOf,
  takenEdges,
  taskProgress,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { TaskSummary } from '../types.ts'

/** 实时流程视图。 */
export function renderJobFlow(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const tasks = jobTasks(state)
  const positions = positionsOf(definition)
  const done = takenEdges(tasks)

  const tasksOf = (positionId: string): TaskSummary[] =>
    tasks.filter((task) => task.position === positionId)

  const metaOf = (list: TaskSummary[]): string => {
    const progress = taskProgress(list)
    return progress.total === 0 ? '' : `${progress.done}/${progress.total}`
  }

  /** 悬浮说明：角标只给数量，具体状态在 title 里展开。 */
  const titleOf = (label: string, list: TaskSummary[]): string => {
    const progress = taskProgress(list)
    if (progress.total === 0) return label
    const parts = [`${progress.done}/${progress.total} ${t('statusCompleted')}`]
    if (progress.ready > 0) parts.push(`${progress.ready} ${t('statusReady')}`)
    if (progress.running > 0) parts.push(`${progress.running} ${t('statusRunning')}`)
    if (progress.failed > 0) parts.push(`${progress.failed} ${t('statusFailed')}`)
    if (progress.pending > 0) parts.push(`${progress.pending} ${t('statusPending')}`)
    return `${label} · ${parts.join(' · ')}`
  }

  const aggregateOf = (list: TaskSummary[]): string => {
    if (list.length === 0) return 'idle'
    if (list.some((task) => task.status === 'running')) return 'running'
    if (list.some((task) => task.status === 'ready')) return 'ready'
    if (list.some((task) => task.status === 'failed' || task.status === 'blocked')) return 'failed'
    if (list.some((task) => task.status === 'pending')) return 'pending'
    if (list.every((task) => task.status === 'completed')) return 'completed'
    return 'idle'
  }

  const nodes: GraphNodeInput[] = [
    {
      id: 'start',
      label: t('boardStart'),
      kind: 'start',
      status: aggregateOf(tasksOf('start')),
      meta: metaOf(tasksOf('start')),
      title: titleOf(t('boardStart'), tasksOf('start')),
    },
    ...positions.map((position) => {
      const list = tasksOf(position.id)
      return {
        id: position.id,
        label: position.label,
        kind: 'position' as const,
        executor: position.executor,
        ...(typeof position.executor.avatar === 'string' && position.executor.avatar !== ''
          ? { avatar: position.executor.avatar }
          : {}),
        status: aggregateOf(list),
        meta: metaOf(list),
        title: titleOf(position.label, list),
      }
    }),
    {
      id: 'end',
      label: t('boardEnd'),
      kind: 'end',
      status: aggregateOf(tasksOf('end')),
      meta: metaOf(tasksOf('end')),
      title: titleOf(t('boardEnd'), tasksOf('end')),
    },
  ]
  const edges: GraphEdgeInput[] = edgesOf(definition).map((edge) => ({
    from: edge.from,
    to: edge.to,
    types: edge.types,
    back: edge.back,
    state: done.has(`${edge.from}->${edge.to}`) ? 'taken' : 'open',
  }))

  return renderWorkflowGraph(page, {
    nodes,
    edges,
    mode: 'live',
    caption: t('flowHint'),
    onNodeClick: (id) => {
      const label =
        id === 'start'
          ? t('boardStart')
          : id === 'end'
            ? t('boardEnd')
            : (positions.find((position) => position.id === id)?.label ?? id)
      actions.openPositionTasks(id, label)
    },
  })
}
