/**
 * 页面数据模型：把 Host 返回的定义快照 / 任务记录收口成看板与流程图直接消费的形状。
 *
 * 服务端只给「岗位、边、任务」，坐标与分组都在客户端算（见 `graph/layout.ts`）。
 */

import type {
  Claimant,
  EdgeDefinition,
  Executor,
  JobDetail,
  JobSummary,
  JsonSchema,
  PageState,
  PositionDefinition,
  TaskDetail,
  TaskSummary,
  TaskTypeDefinition,
  WorkflowDefinition,
  WorkflowDetail,
} from './types.ts'
import { asArray, isRecord } from './types.ts'

/** 归一化后的岗位：id 一定有值。 */
export interface PositionView {
  id: string
  label: string
  description: string
  executor: Executor
  taskTypes: TaskTypeDefinition[]
}

/** 归一化后的边。 */
export interface EdgeView {
  from: string
  to: string
  types: string[]
  back: boolean
}

/** 看板的一行（岗位，含开始 / 结束）。 */
export interface BoardRow {
  id: string
  kind: 'start' | 'position' | 'end'
  label: string
  executor: Executor | null
  tasks: TaskSummary[]
}

/** 取当前工作流详情里的定义快照。 */
export function currentDefinition(state: PageState): WorkflowDefinition | null {
  const definition = state.workflow.data?.workflow?.definition
  return isRecord(definition) ? definition : null
}

/** 取当前作业绑定的定义快照（任务类型的唯一来源）。 */
export function currentJobDefinition(state: PageState): WorkflowDefinition | null {
  const detail = state.job.data
  if (detail === null) return null
  const definition = detail.definition
  if (!isRecord(definition)) return null
  // 作业详情里的 definition 是精简版（岗位 + 边 + 开始 / 结束）；岗位可能带
  // `taskTypes`（新 Host）也可能不带（契约精简版）。这里保留原形状，由
  // `findTaskType` 再合并工作流完整定义。
  return definition as WorkflowDefinition
}

/** 把定义里的岗位归一化。 */
export function positionsOf(definition: WorkflowDefinition | null): PositionView[] {
  const list = asArray<PositionDefinition>(definition?.positions)
  const out: PositionView[] = []
  for (const position of list) {
    const id = typeof position?.id === 'string' ? position.id : ''
    if (id === '') continue
    out.push({
      id,
      label: typeof position.label === 'string' && position.label !== '' ? position.label : id,
      description: typeof position.description === 'string' ? position.description : '',
      executor: isRecord(position.executor) ? position.executor : {},
      taskTypes: asArray<TaskTypeDefinition>(position.taskTypes),
    })
  }
  return out
}

/** 把定义里的边归一化。 */
export function edgesOf(definition: WorkflowDefinition | null): EdgeView[] {
  const list = asArray<EdgeDefinition>(definition?.edges)
  return list
    .filter(
      (edge) =>
        typeof edge?.from === 'string' &&
        edge.from !== '' &&
        typeof edge.to === 'string' &&
        edge.to !== '',
    )
    .map((edge) => ({
      from: edge.from as string,
      to: edge.to as string,
      types: asArray<string>(edge.types).filter((type) => typeof type === 'string'),
      back: edge.back === true,
    }))
}

/**
 * 图 / 看板里的岗位顺序：定义顺序优先；作业详情精简版只有岗位数组。
 *
 * @param definition
 * @returns
 */
export function graphPositions(
  definition: WorkflowDefinition | null,
): Array<{ id: string; label: string; executor: Executor }> {
  return positionsOf(definition).map((position) => ({
    id: position.id,
    label: position.label,
    executor: position.executor,
  }))
}

/** 岗位标签；开始 / 结束用内建文案。 */
export function positionLabel(
  definition: WorkflowDefinition | null,
  positionId: unknown,
  builtin: { start: string; end: string },
): string {
  if (positionId === 'start') return builtin.start
  if (positionId === 'end') return builtin.end
  const found = positionsOf(definition).find((position) => position.id === positionId)
  return found === undefined ? String(positionId ?? '') : found.label
}

/**
 * 展开所有任务类型（跨岗位）并记下所属岗位。
 *
 * @param definition
 * @returns
 */
export function allTaskTypes(
  definition: WorkflowDefinition | null,
): Array<{ position: PositionView; type: TaskTypeDefinition }> {
  const out: Array<{ position: PositionView; type: TaskTypeDefinition }> = []
  for (const position of positionsOf(definition)) {
    for (const type of position.taskTypes) {
      if (typeof type?.id === 'string' && type.id !== '') out.push({ position, type })
    }
  }
  return out
}

/**
 * 找任务类型定义。作业详情精简版可能不含 `taskTypes`，此时回退到工作流完整定义。
 *
 * @param jobDefinition 作业详情里的定义
 * @param workflowDefinition 工作流完整定义（可选）
 * @param positionId 岗位 id
 * @param typeId 任务类型 id
 * @returns
 */
export function findTaskType(
  jobDefinition: WorkflowDefinition | null,
  workflowDefinition: WorkflowDefinition | null,
  positionId: unknown,
  typeId: unknown,
): TaskTypeDefinition | null {
  for (const definition of [jobDefinition, workflowDefinition]) {
    if (definition === null) continue
    const position = positionsOf(definition).find((item) => item.id === positionId)
    if (position === undefined) continue
    const found = position.taskTypes.find((type) => type.id === typeId)
    if (found !== undefined) return found
  }
  return null
}

/** 任务是否属于「人岗位」。 */
export function isHumanPosition(
  definition: WorkflowDefinition | null,
  positionId: unknown,
): boolean {
  const position = positionsOf(definition).find((item) => item.id === positionId)
  return position !== undefined && position.executor.kind === 'human'
}

/** 任务类型 → 该岗位的输出 schema。 */
export function outputSchemaFor(
  jobDefinition: WorkflowDefinition | null,
  workflowDefinition: WorkflowDefinition | null,
  task: { position?: string; type?: string } | null,
): JsonSchema | null {
  if (task === null) return null
  const type = findTaskType(jobDefinition, workflowDefinition, task.position, task.type)
  return isRecord(type?.output) ? (type.output as JsonSchema) : null
}

/** 任务类型 → 该岗位的 payload schema。 */
export function payloadSchemaFor(
  jobDefinition: WorkflowDefinition | null,
  workflowDefinition: WorkflowDefinition | null,
  task: { position?: string; type?: string } | null,
): JsonSchema | null {
  if (task === null) return null
  const type = findTaskType(jobDefinition, workflowDefinition, task.position, task.type)
  return isRecord(type?.payload) ? (type.payload as JsonSchema) : null
}

/** 当前作业里的任务；没有详情时给空数组。 */
export function jobTasks(state: PageState): TaskSummary[] {
  const tasks = state.job.data?.tasks
  return Array.isArray(tasks) ? tasks.filter((task) => typeof task?.id === 'string') : []
}

/** 当前作业详情。 */
export function jobRecord(state: PageState): JobDetail['job'] | null {
  return state.job.data?.job ?? null
}

/** 某个任务摘要；找不到返回 null。 */
export function taskSummary(state: PageState, taskId: unknown): TaskSummary | null {
  if (typeof taskId !== 'string' || taskId === '') return null
  return jobTasks(state).find((task) => task.id === taskId) ?? null
}

/** 从工作流详情里找一条作业摘要。 */
export function jobSummary(workflow: WorkflowDetail | null, jobId: unknown): JobSummary | null {
  if (workflow === null || typeof jobId !== 'string' || jobId === '') return null
  const jobs = Array.isArray(workflow.jobs) ? workflow.jobs : []
  return jobs.find((job) => job?.id === jobId) ?? null
}

/**
 * 任务摘要的展示顺序：创建时间升序，同一时间按 id 稳定排序。
 *
 * @param tasks
 * @returns
 */
export function sortTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((left, right) => {
    const leftTime = typeof left.createdAt === 'string' ? left.createdAt : ''
    const rightTime = typeof right.createdAt === 'string' ? right.createdAt : ''
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

/**
 * 看板行：开始 + 岗位（定义顺序）+ 结束。
 *
 * @param definition
 * @param tasks
 * @param builtin
 * @returns
 */
export function boardRows(
  definition: WorkflowDefinition | null,
  tasks: TaskSummary[],
  builtin: { start: string; end: string },
): BoardRow[] {
  const positions = positionsOf(definition)
  const known = new Set(positions.map((position) => position.id))
  const startTasks = tasks.filter((task) => task.position === 'start')
  const endTasks = tasks.filter((task) => task.position === 'end')
  const rows: BoardRow[] = [
    { id: 'start', kind: 'start', label: builtin.start, executor: null, tasks: startTasks },
    ...positions.map((position) => ({
      id: position.id,
      kind: 'position' as const,
      label: position.label,
      executor: position.executor,
      tasks: sortTasks(tasks.filter((task) => task.position === position.id)),
    })),
    { id: 'end', kind: 'end', label: builtin.end, executor: null, tasks: endTasks },
  ]
  // 契约外任务（岗位已从定义里删掉）仍然要显示，否则看板会丢卡。
  const extras = tasks.filter(
    (task) =>
      task.position !== 'start' &&
      task.position !== 'end' &&
      (typeof task.position !== 'string' || !known.has(task.position)),
  )
  for (const task of sortTasks(extras)) {
    const id = typeof task.position === 'string' ? task.position : '(unknown)'
    let row = rows.find((item) => item.id === id)
    if (row === undefined) {
      row = { id, kind: 'position', label: id, executor: null, tasks: [] }
      rows.splice(rows.length - 1, 0, row)
    }
    row.tasks.push(task)
  }
  return rows
}

/**
 * 作业看板里某一行的状态汇总（给流程图节点着色）。
 *
 * @param tasks
 * @returns
 */
export function aggregateStatus(tasks: TaskSummary[]): string {
  if (tasks.length === 0) return 'idle'
  if (tasks.some((task) => task.status === 'running')) return 'running'
  if (tasks.some((task) => task.status === 'ready')) return 'ready'
  if (tasks.some((task) => task.status === 'failed' || task.status === 'blocked')) return 'failed'
  if (tasks.some((task) => task.status === 'pending')) return 'pending'
  if (tasks.every((task) => task.status === 'completed')) return 'completed'
  if (tasks.some((task) => task.status === 'cancelled')) return 'cancelled'
  return 'completed'
}

/**
 * 任务统计：看板卡片与作业列表共用。
 *
 * @param tasks
 * @returns
 */
export function countTasks(tasks: TaskSummary[]): Record<string, number> {
  const counts: Record<string, number> = {
    pending: 0,
    ready: 0,
    running: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  }
  for (const task of tasks) {
    const status = typeof task.status === 'string' ? task.status : 'pending'
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

/**
 * 作业摘要的一行统计文案。
 *
 * @param counts
 * @param t
 * @returns
 */
export function taskCountsText(
  counts: Partial<Record<string, number>> | null,
  t: (key: string) => string,
): string {
  if (counts === null) return ''
  const parts: string[] = []
  if (counts.running) parts.push(`${t('statusRunning')} ${counts.running}`)
  if (counts.ready) parts.push(`${t('statusReady')} ${counts.ready}`)
  if (counts.pending) parts.push(`${t('statusPending')} ${counts.pending}`)
  if (counts.completed) parts.push(`${t('statusCompleted')} ${counts.completed}`)
  const problem = (counts.failed ?? 0) + (counts.blocked ?? 0) + (counts.cancelled ?? 0)
  if (problem > 0) parts.push(`${t('statusFailed')} ${problem}`)
  return parts.join(' · ')
}

/**
 * 承办者的展示名。
 *
 * @param claimant
 * @param t
 * @returns
 */
export function claimantName(
  claimant: Claimant | null | undefined,
  t: (key: string) => string,
): string {
  if (!isRecord(claimant)) return ''
  const name = typeof claimant.name === 'string' ? claimant.name : ''
  if (name !== '') return name
  return typeof claimant.kind === 'string' ? t(actorKindKeySafe(claimant.kind)) : ''
}

/**
 * 承办者种类 → 词典 key（避免 format 与 model 相互依赖的重复）。
 *
 * @param kind
 * @returns
 */
function actorKindKeySafe(kind: string): string {
  switch (kind) {
    case 'robot':
      return 'actorRobot'
    case 'human':
      return 'actorHuman'
    case 'assistant':
      return 'actorAssistant'
    default:
      return 'unknown'
  }
}

/**
 * 任务详情里的结果摘要。
 *
 * @param task
 * @returns
 */
export function resultSummary(task: TaskDetail | null): string {
  const summary = task?.result
  if (!isRecord(summary)) return ''
  const text = typeof summary.text === 'string' ? summary.text : ''
  if (text !== '') return text
  const output = summary.output
  if (output === undefined || output === null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return ''
  }
}

/**
 * 作业详情里的 `definition` 与工作流定义合并（作业精简版缺 taskTypes 时回退）。
 *
 * @param jobDefinition
 * @param workflowDefinition
 * @returns
 */
export function mergedDefinition(
  jobDefinition: WorkflowDefinition | null,
  workflowDefinition: WorkflowDefinition | null,
): WorkflowDefinition | null {
  if (jobDefinition === null) return workflowDefinition
  if (workflowDefinition === null) return jobDefinition
  const byId = new Map(positionsOf(jobDefinition).map((position) => [position.id, position]))
  const merged: PositionDefinition[] = positionsOf(workflowDefinition).map((position) => {
    const fromJob = byId.get(position.id)
    return {
      id: position.id,
      label: fromJob?.label ?? position.label,
      description: position.description,
      executor:
        fromJob !== undefined && Object.keys(fromJob.executor).length > 0
          ? fromJob.executor
          : position.executor,
      taskTypes: position.taskTypes,
    }
  })
  const jobEdges = Array.isArray(jobDefinition.edges) ? jobDefinition.edges : []
  const start = jobDefinition.start ?? workflowDefinition.start
  const end = jobDefinition.end ?? workflowDefinition.end
  return {
    ...workflowDefinition,
    positions: merged,
    ...(jobEdges.length > 0
      ? { edges: jobEdges }
      : workflowDefinition.edges !== undefined
        ? { edges: workflowDefinition.edges }
        : {}),
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  }
}

/**
 * 任务详情里「是不是人任务」。
 *
 * @param state
 * @param task
 * @returns
 */
export function isHumanTask(state: PageState, task: { position?: string } | null): boolean {
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  return isHumanPosition(definition, task?.position)
}

/**
 * 任务详情对应的任务类型定义（抽屉展示 assistant / mode / 产出 schema）。
 *
 * @param state
 * @param task
 * @returns
 */
export function taskTypeOf(
  state: PageState,
  task: { position?: string; type?: string } | null,
): TaskTypeDefinition | null {
  return findTaskType(
    currentJobDefinition(state),
    currentDefinition(state),
    task?.position,
    task?.type,
  )
}
