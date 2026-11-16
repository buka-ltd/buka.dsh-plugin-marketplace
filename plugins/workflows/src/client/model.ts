/**
 * 页面数据模型：把 Host 返回的定义快照 / 任务记录收口成看板与流程图直接消费的形状。
 *
 * 服务端只给「岗位、通道、任务」，坐标与分组都在客户端算（见 `graph/layout.ts`）。
 */

import { fill } from './i18n.ts'
import type {
  ActionDefinition,
  AttachmentMeta,
  ChannelDefinition,
  DeliveryRule,
  Executor,
  JobDetail,
  JobSummary,
  JsonSchema,
  MissingWorkerRef,
  PageState,
  PositionDefinition,
  Starter,
  TaskDetail,
  TaskSummary,
  TaskTypeDefinition,
  Translate,
  WorkerAvailability,
  WorkflowDefinition,
  WorkflowDetail,
} from './types.ts'
import { asArray, isRecord } from './types.ts'

/** 一条打工人引用的展示身份：标识符 + 展示名。 */
export interface WorkerIdentity {
  /** 不可变标识符；空串表示没有引用。 */
  id: string
  /** 展示名；名称为空时与 id 相同。 */
  displayName: string
}

/**
 * 读取打工人引用的身份；同时容忍 v8 的 `id` 与 v7 快照的 `name`。
 *
 * @param ref 执行者、交回方式或助理
 * @returns 标识符与展示名
 */
export function workerIdentity(
  ref:
    | { id?: string | undefined; name?: string | undefined; displayName?: string | undefined }
    | null
    | undefined,
): WorkerIdentity {
  const id =
    typeof ref?.id === 'string' && ref.id !== ''
      ? ref.id
      : typeof ref?.name === 'string'
        ? ref.name
        : ''
  const displayName =
    typeof ref?.displayName === 'string' && ref.displayName !== ''
      ? ref.displayName
      : typeof ref?.name === 'string' && ref.name !== ''
        ? ref.name
        : id
  return { id, displayName }
}

/**
 * 展示「展示名 · 标识符」；名称为空（等于标识符）时只显示标识符。
 *
 * @param ref 打工人引用
 * @returns 展示文本；没有引用时是空串
 */
export function workerIdentityText(
  ref:
    | { id?: string | undefined; name?: string | undefined; displayName?: string | undefined }
    | null
    | undefined,
): string {
  const identity = workerIdentity(ref)
  if (identity.id === '') return ''
  return identity.displayName === identity.id
    ? identity.id
    : `${identity.displayName} · ${identity.id}`
}

/**
 * 当前页面的派生可用性：作业页取作业的，工作流页取工作流详情的。
 *
 * @param state 页面状态
 * @returns 可用性；还没加载或 Host 没给时 null
 */
export function currentAvailability(state: PageState): WorkerAvailability | null {
  if (state.route.kind === 'job') return state.job.data?.availability ?? null
  return state.workflow.data?.workflow?.availability ?? null
}

/**
 * 缺失的打工人引用。
 *
 * @param state 页面状态
 * @returns 缺失引用数组；可用时是空数组
 */
export function missingWorkersOf(state: PageState): MissingWorkerRef[] {
  const availability = currentAvailability(state)
  return Array.isArray(availability?.missingWorkers) ? availability.missingWorkers : []
}

/**
 * 判断一条打工人引用是否已不存在（历史展示据此显示「已删除」与占位头像）。
 *
 * @param state 页面状态
 * @param ref 打工人标识符（v7 快照里是当时的名字）
 * @returns 缺失时为 true
 */
export function isWorkerMissing(state: PageState, ref: string): boolean {
  if (typeof ref !== 'string' || ref === '') return false
  return missingWorkersOf(state).some((entry) => entry.id === ref)
}

/**
 * 一条缺失引用的可读说明（工作流 / 作业的不可用提示）。
 *
 * @param t 翻译函数
 * @param entry 缺失引用
 * @returns 一句话
 */
export function describeMissingWorker(t: Translate, entry: MissingWorkerRef): string {
  if (entry.role === 'delivery') {
    return fill(t, 'workerMissingDelivery', { id: entry.id })
  }
  if (entry.role === 'assistant') {
    return fill(t, 'workerMissingAssistant', {
      type: entry.taskTypeLabel ?? entry.taskTypeId ?? '',
      id: entry.id,
    })
  }
  return fill(t, 'workerMissingExecutor', {
    position: entry.positionLabel ?? entry.positionId ?? '',
    id: entry.id,
  })
}

/**
 * 助理引用 → 展示身份；展示名来自工作流详情里的助理列表。
 *
 * @param state 页面状态
 * @param id 助理标识符
 * @returns 展示身份
 */
export function assistantIdentity(state: PageState, id: string): WorkerIdentity {
  const assistants = asArray<{ id?: string; name?: string }>(state.workflow.data?.assistants)
  const found = assistants.find((assistant) => (assistant.id ?? assistant.name) === id)
  return workerIdentity({ id, name: found?.name })
}

/**
 * 结束任务的交回方式 → 展示身份。
 *
 * @param delivery 交回方式
 * @returns 展示身份；交回发起人或没有助理时 id 为空
 */
export function deliveryIdentity(delivery: DeliveryRule | null | undefined): WorkerIdentity {
  if (!isRecord(delivery) || delivery.kind !== 'assistant') return { id: '', displayName: '' }
  return workerIdentity(delivery)
}

/** 归一化后的岗位：id 一定有值。 */
export interface PositionView {
  id: string
  label: string
  note: string
  executor: Executor
  taskTypes: TaskTypeDefinition[]
}

/** 归一化后的通道：id 与 label 一定有值。 */
export interface ChannelView {
  id: string
  label: string
  from: string
  to: string
  types: string[]
  back: boolean
}

/**
 * 看板的一行：发起人（开始 / 结束任务合并）或岗位。
 *
 * 开始与结束任务的执行者是同一个发起人，合成一行才不会把同一个人画两次。
 */
export interface BoardRow {
  id: string
  kind: 'starter' | 'position'
  label: string
  executor: Executor | null
  tasks: TaskSummary[]
}

/** 取当前工作流详情里的定义快照；执行者补上打工人登记里的展示字段。 */
export function currentDefinition(state: PageState): WorkflowDefinition | null {
  const detail = state.workflow.data
  const definition = detail?.workflow?.definition
  if (!isRecord(definition)) return null
  // 定义快照只存打工人标识符；展示名 / avatar / driver 在 graph 投影里，展示前合并回来。
  const executors = new Map<string, Executor>()
  for (const position of detail?.graph?.positions ?? []) {
    if (typeof position.id === 'string' && isRecord(position.executor)) {
      executors.set(position.id, position.executor)
    }
  }
  if (executors.size === 0) return definition
  const positions = asArray<PositionDefinition>(definition.positions).map((position) =>
    typeof position.id === 'string' && executors.has(position.id)
      ? { ...position, executor: executors.get(position.id) as Executor }
      : position,
  )
  return { ...definition, positions }
}

/** 取当前作业绑定的定义快照（任务类型的唯一来源）。 */
export function currentJobDefinition(state: PageState): WorkflowDefinition | null {
  const detail = state.job.data
  if (detail === null) return null
  const definition = detail.definition
  if (!isRecord(definition)) return null
  // 作业详情里的 definition 是精简版（岗位 + 通道 + 开始 / 结束）；岗位可能带
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
      note: typeof position.note === 'string' ? position.note : '',
      executor: isRecord(position.executor) ? position.executor : {},
      taskTypes: asArray<TaskTypeDefinition>(position.taskTypes),
    })
  }
  return out
}

/** 把定义里的通道归一化。 */
export function channelsOf(definition: WorkflowDefinition | null): ChannelView[] {
  const list = asArray<ChannelDefinition>(definition?.channels)
  return list
    .filter(
      (channel) =>
        typeof channel?.id === 'string' &&
        channel.id !== '' &&
        typeof channel.from === 'string' &&
        channel.from !== '' &&
        typeof channel.to === 'string' &&
        channel.to !== '',
    )
    .map((channel) => ({
      id: channel.id as string,
      label:
        typeof channel.label === 'string' && channel.label !== ''
          ? channel.label
          : (channel.id as string),
      from: channel.from as string,
      to: channel.to as string,
      types: asArray<string>(channel.types).filter((type) => typeof type === 'string'),
      back: channel.back === true,
    }))
}

/** 按 id 找通道；找不到时返回 null。 */
export function channelOf(
  definition: WorkflowDefinition | null,
  channelId: unknown,
): ChannelView | null {
  if (typeof channelId !== 'string' || channelId === '') return null
  return channelsOf(definition).find((channel) => channel.id === channelId) ?? null
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

/** 任务类型 → 任务内容 schema。 */
export function contentSchemaFor(
  jobDefinition: WorkflowDefinition | null,
  workflowDefinition: WorkflowDefinition | null,
  task: { position?: string; type?: string } | null,
): JsonSchema | null {
  if (task === null) return null
  const type = findTaskType(jobDefinition, workflowDefinition, task.position, task.type)
  return isRecord(type?.content) ? (type.content as JsonSchema) : null
}

/**
 * 人任务类型里的一个动作。
 *
 * @param type 任务类型定义
 * @param actionId 动作 id
 * @returns 动作；不存在时 null
 */
export function actionOf(
  type: TaskTypeDefinition | null,
  actionId: string | null,
): ActionDefinition | null {
  if (type === null || actionId === null) return null
  const actions = Array.isArray(type.actions) ? type.actions : []
  return actions.find((action) => action.id === actionId) ?? null
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

/** 当前作业的发起人（开始 / 结束任务的执行者）；没有作业时为 null。 */
export function currentStarter(state: PageState): Starter | null {
  return state.job.data?.job?.starter ?? null
}

/**
 * 发起人的展示文本：人（页面启动）或会话。
 *
 * @param starter
 * @param t
 * @returns 未知发起人时返回空串
 */
export function starterText(starter: Starter | null | undefined, t: Translate): string {
  if (!isRecord(starter)) return ''
  return starter.kind === 'session' ? t('starterSession') : t('starterHuman')
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
 * 看板行：发起人（开始 + 结束任务）+ 岗位（定义顺序）。
 *
 * 内建开始 / 结束任务的执行者是同一个发起人，因此合并成一行；岗位行只放
 * 定义里仍存在的岗位，契约外任务由调用方补行。
 *
 * @param definition
 * @param tasks
 * @param builtin
 * @returns
 */
export function boardRows(
  definition: WorkflowDefinition | null,
  tasks: TaskSummary[],
  builtin: { starter: string },
): BoardRow[] {
  const positions = positionsOf(definition)
  const known = new Set(positions.map((position) => position.id))
  const starterTasks = sortTasks(
    tasks.filter((task) => task.position === 'start' || task.position === 'end'),
  )
  const rows: BoardRow[] = [
    {
      id: 'starter',
      kind: 'starter',
      label: builtin.starter,
      executor: null,
      tasks: starterTasks,
    },
    ...positions.map((position) => ({
      id: position.id,
      kind: 'position' as const,
      label: position.label,
      executor: position.executor,
      tasks: sortTasks(tasks.filter((task) => task.position === position.id)),
    })),
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
      rows.push(row)
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

/** 任务「谁在办」的展示口径（ADR 0022）。 */
export type TaskActor =
  | { readonly kind: 'assistant'; readonly assistantId: string }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'handling' }
  | { readonly kind: 'executor'; readonly text: string; readonly missing: boolean }
  | { readonly kind: 'none' }

/** 任务里「谁在办」判定用到的最小字段。 */
export interface TaskActorInput {
  position?: string
  type?: string
  status?: string
}

/**
 * 人任务点名的助理标识符：从任务类型定义取，没有点名时 null。
 *
 * @param state 页面状态
 * @param task 任务
 * @returns 助理标识符；没有点名时 null
 */
export function taskAssistantId(state: PageState, task: TaskActorInput): string | null {
  const typeDefinition = taskTypeOf(state, task)
  const assistant = typeDefinition?.assistant
  return typeof assistant === 'string' && assistant.trim() !== '' ? assistant.trim() : null
}

/** 岗位执行者（当前作业定义 + 工作流定义合并后）。 */
function positionExecutorOf(state: PageState, positionId: string): Executor | null {
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  return positionsOf(definition).find((position) => position.id === positionId)?.executor ?? null
}

/**
 * 任务「谁在办」：人任务说代办 / 待你办理 / 你在办理，打工人任务只说执行者。
 *
 * 承办者（谁接走任务）不再展示；人任务的助理来自任务类型定义的点名。
 *
 * @param state 页面状态
 * @param task 任务摘要或详情
 * @returns 展示口径；开始 / 结束任务或无法解析时是 `none`
 */
export function taskActor(state: PageState, task: TaskActorInput): TaskActor {
  const position = typeof task.position === 'string' ? task.position : ''
  if (position === '' || position === 'start' || position === 'end') return { kind: 'none' }
  if (isHumanTask(state, task)) {
    const assistantId = taskAssistantId(state, task)
    if (assistantId !== null) return { kind: 'assistant', assistantId }
    if (task.status === 'running') return { kind: 'handling' }
    if (task.status === 'ready' || task.status === 'pending') return { kind: 'waiting' }
    return { kind: 'none' }
  }
  const executor = positionExecutorOf(state, position)
  if (executor === null || executor.kind !== 'worker') return { kind: 'none' }
  const text = workerIdentityText(executor)
  if (text === '') return { kind: 'none' }
  const identity = workerIdentity(executor)
  const missing =
    executor.missing === true || (identity.id !== '' && isWorkerMissing(state, identity.id))
  return { kind: 'executor', text, missing }
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
  const action = isRecord(summary.action) ? summary.action : null
  return typeof action?.label === 'string' ? action.label : ''
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
      note: position.note,
      executor:
        fromJob !== undefined && Object.keys(fromJob.executor).length > 0
          ? fromJob.executor
          : position.executor,
      taskTypes: position.taskTypes,
    }
  })
  const jobChannels = Array.isArray(jobDefinition.channels) ? jobDefinition.channels : []
  // 作业详情里的 start / end 只是图标签；契约以工作流完整定义为准。
  const start = workflowDefinition.start ?? jobDefinition.start
  const end = workflowDefinition.end ?? jobDefinition.end
  return {
    ...workflowDefinition,
    positions: merged,
    ...(jobChannels.length > 0
      ? { channels: jobChannels }
      : workflowDefinition.channels !== undefined
        ? { channels: workflowDefinition.channels }
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

/** 一个节点的任务进度。 */
export interface TaskProgress {
  done: number
  total: number
  running: number
  ready: number
  failed: number
  pending: number
}

/**
 * 任务进度：节点卡片与作业列表共用。
 *
 * @param tasks
 * @returns
 */
export function taskProgress(tasks: TaskSummary[]): TaskProgress {
  const progress: TaskProgress = {
    done: 0,
    total: tasks.length,
    running: 0,
    ready: 0,
    failed: 0,
    pending: 0,
  }
  for (const task of tasks) {
    switch (task.status) {
      case 'completed':
        progress.done += 1
        break
      case 'running':
        progress.running += 1
        break
      case 'ready':
        progress.ready += 1
        break
      case 'failed':
      case 'blocked':
        progress.failed += 1
        break
      case 'cancelled':
        break
      default:
        progress.pending += 1
    }
  }
  return progress
}

/**
 * 实时流程里哪些通道已经被走过：任务记录自己走过的通道 id。
 *
 * @param tasks
 * @returns 通道 id 的集合
 */
export function takenChannels(tasks: TaskSummary[]): Set<string> {
  const taken = new Set<string>()
  for (const task of tasks) {
    if (typeof task.channel === 'string' && task.channel !== '') taken.add(task.channel)
  }
  return taken
}

/**
 * 结束任务（最终交付物的来源）。
 *
 * @param tasks
 * @returns
 */
export function endTaskSummary(tasks: TaskSummary[]): TaskSummary | null {
  return tasks.find((task) => task.position === 'end') ?? null
}

/**
 * 作业列表筛选。
 *
 * @param jobs
 * @param filter
 * @returns
 */
export function filterJobs(jobs: JobSummary[], filter: string): JobSummary[] {
  return jobs.filter((job) => {
    switch (filter) {
      case 'running':
        return job.status === 'running'
      case 'completed':
        return job.status === 'completed'
      case 'problem':
        return job.status === 'failed' || job.status === 'cancelled'
      default:
        return true
    }
  })
}

/**
 * 作业列表排序：运行中优先，其次编号倒序。
 *
 * @param jobs
 * @returns
 */
export function sortJobs(jobs: JobSummary[]): JobSummary[] {
  return [...jobs].sort((left, right) => {
    const leftRunning = left.status === 'running' ? 0 : 1
    const rightRunning = right.status === 'running' ? 0 : 1
    if (leftRunning !== rightRunning) return leftRunning - rightRunning
    const leftSeq = typeof left.seq === 'number' ? left.seq : 0
    const rightSeq = typeof right.seq === 'number' ? right.seq : 0
    if (leftSeq !== rightSeq) return rightSeq - leftSeq
    const leftTime = typeof left.updatedAt === 'string' ? left.updatedAt : ''
    const rightTime = typeof right.updatedAt === 'string' ? right.updatedAt : ''
    return rightTime.localeCompare(leftTime)
  })
}

/**
 * 任务类型 id → 展示名。
 *
 * @param definition
 * @returns
 */
export function taskTypeLabels(definition: WorkflowDefinition | null): Map<string, string> {
  const labels = new Map<string, string>()
  for (const { type } of allTaskTypes(definition)) {
    if (typeof type.id === 'string') labels.set(type.id, type.label ?? type.id)
  }
  return labels
}

/** 资产池里的一个分组（按来源任务）。 */
export interface AssetGroup {
  key: string
  taskId: string
  label: string
  positionLabel: string
  final: boolean
  items: AttachmentMeta[]
}

/**
 * 资产池：附件按来源任务分组；结束任务产出的组排在最前。
 *
 * @param attachments
 * @param tasks
 * @param definition
 * @param builtin
 * @returns
 */
export function assetGroups(
  attachments: AttachmentMeta[],
  tasks: TaskSummary[],
  definition: WorkflowDefinition | null,
  builtin: { start: string; end: string },
): AssetGroup[] {
  const byTask = new Map<string, TaskSummary>()
  for (const task of tasks) byTask.set(task.id, task)
  const positionLabels = new Map(
    positionsOf(definition).map((position) => [position.id, position.label]),
  )
  const groups = new Map<string, AssetGroup>()

  for (const attachment of attachments) {
    const taskId =
      typeof attachment.sourceTaskId === 'string' && attachment.sourceTaskId !== ''
        ? attachment.sourceTaskId
        : ''
    const task = taskId === '' ? null : (byTask.get(taskId) ?? null)
    const key = taskId === '' ? '__unlinked' : taskId
    let group = groups.get(key)
    if (group === undefined) {
      const position = typeof task?.position === 'string' ? task.position : ''
      const builtinLabel =
        position === 'start' ? builtin.start : position === 'end' ? builtin.end : ''
      const positionLabel =
        builtinLabel !== '' ? '' : position === '' ? '' : (positionLabels.get(position) ?? position)
      group = {
        key,
        taskId,
        label:
          builtinLabel !== ''
            ? builtinLabel
            : task === null
              ? ''
              : (task.typeLabel ?? task.type ?? taskId),
        positionLabel,
        final: position === 'end',
        items: [],
      }
      groups.set(key, group)
    }
    group.items.push(attachment)
  }

  const sorted = [...groups.values()].sort((left, right) => {
    if (left.final !== right.final) return left.final ? -1 : 1
    if (left.key === '__unlinked') return 1
    if (right.key === '__unlinked') return -1
    return 0
  })
  for (const group of sorted) {
    group.items.sort((left, right) => {
      const leftTime = typeof left.createdAt === 'string' ? left.createdAt : ''
      const rightTime = typeof right.createdAt === 'string' ? right.createdAt : ''
      return leftTime.localeCompare(rightTime)
    })
  }
  return sorted
}
