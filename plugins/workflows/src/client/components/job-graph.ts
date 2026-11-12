/**
 * 作业流程图：同一份任务数据按岗位汇总状态后画在定义图上。
 */

import type React from 'react'
import type { GraphNodeInput } from '../graph/layout.ts'
import { renderWorkflowGraph } from '../graph/render.ts'
import {
  aggregateStatus,
  currentDefinition,
  currentJobDefinition,
  edgesOf,
  jobTasks,
  mergedDefinition,
  positionsOf,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'

/**
 * 作业流程图视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderJobGraph(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const tasks = jobTasks(state)
  const positions = positionsOf(definition)

  /** 某个节点的任务。 */
  function tasksOf(positionId: string) {
    return tasks.filter((task) => task.position === positionId)
  }

  /** 节点徽标：已完成 / 总数。 */
  function metaOf(positionId: string): string {
    const list = tasksOf(positionId)
    if (list.length === 0) return ''
    const done = list.filter((task) => task.status === 'completed').length
    return `${done}/${list.length}`
  }

  /** 点节点：打开该岗位最近活动的任务。 */
  function openFirst(positionId: string): void {
    const list = tasksOf(positionId)
    const priority = ['running', 'ready', 'pending', 'failed', 'blocked', 'completed', 'cancelled']
    for (const status of priority) {
      const found = list.find((task) => task.status === status)
      if (found !== undefined) {
        actions.openTask(found.id)
        return
      }
    }
  }

  const nodes: GraphNodeInput[] = [
    {
      id: 'start',
      label: t('boardStart'),
      kind: 'start',
      status: aggregateStatus(tasksOf('start')),
      meta: metaOf('start'),
    },
    ...positions.map((position) => {
      const id = position.id
      const avatar = position.executor.avatar
      return {
        id,
        label: position.label,
        kind: 'position' as const,
        executor: position.executor,
        ...(typeof avatar === 'string' && avatar !== '' ? { avatar } : {}),
        status: aggregateStatus(tasksOf(id)),
        meta: metaOf(id),
        title: `${id} · ${t('tasksTablePosition')}`,
      }
    }),
    {
      id: 'end',
      label: t('boardEnd'),
      kind: 'end',
      status: aggregateStatus(tasksOf('end')),
      meta: metaOf('end'),
    },
  ]
  const edges = edgesOf(definition).map((edge) => ({
    from: edge.from,
    to: edge.to,
    types: edge.types,
    back: edge.back,
  }))

  return renderWorkflowGraph(page, {
    nodes,
    edges,
    onNodeClick: openFirst,
    caption: t('jobGraphHint'),
  })
}
