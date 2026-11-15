/**
 * 任务创建校验与记录构造。
 *
 * 创建任务的入口有三个：引擎按 `start.next` 生成初始任务、执行中的任务通过
 * `buka_task_create` 派生任务、人任务的动作创建任务。三者共享同一套校验：
 *
 * 1. 通道存在、起点是创建任务的节点；
 * 2. 任务类型是目标岗位声明的类型（结束任务用 `end` 契约）；
 * 3. 通道写了类型白名单时，类型在白名单里；
 * 4. 任务内容符合目标任务类型的 content schema；
 * 5. 依赖 id 属于本作业、已存在、不是自己、依赖图不成环；
 * 6. 作业预算未超。
 *
 * @module @buka/dsh-plugin-workflows/engine/tasks
 */

import { buildTemplateContext, renderPayload } from '../definition/payload.ts'
import {
  channelAllowsType,
  channelsFrom,
  contentIssues,
  findChannel,
  findPosition,
  findTaskType,
} from '../definition/validate.ts'
import { newTaskId, nowIso, START_TASK_ID } from '../domain/ids.ts'
import type {
  ChannelDefinition,
  CreationDefinition,
  JobRecord,
  JsonValue,
  StoredExecutor,
  TaskRecord,
  TaskTypeDefinition,
  WorkerInfo,
  WorkflowDefinition,
} from '../domain/types.ts'
import { WorkflowError } from './types.ts'

/** 创建任务的入参。 */
export interface CreateTaskInput {
  readonly job: JobRecord
  readonly creator: TaskRecord
  /** 沿哪条通道派发；目标岗位由通道的 `to` 推出。 */
  readonly channel: string
  readonly type: string
  /** 已经渲染好、可以直接校验的任务内容。 */
  readonly content: JsonValue
  readonly deps: readonly string[]
  readonly tasks: readonly TaskRecord[]
  /** 打工人登记表（按名字）；机器人带 driver/program。 */
  readonly workers: ReadonlyMap<string, WorkerInfo>
}

/** 构造出的任务与派生信息。 */
export interface CreateTaskResult {
  readonly task: TaskRecord
  /** 依赖是否已全部完成（决定初始状态）。 */
  readonly ready: boolean
}

/**
 * 解析节点执行者，构造任务记录里钉住的执行者。
 *
 * 开始 / 结束任务的执行者都是发起人；结束任务选了「交给秘书」时是那个助理。
 *
 * @param definition 定义
 * @param positionId 岗位 id
 * @param job 作业
 * @param workers 打工人登记表
 * @returns 钉住的执行者
 */
export function resolveExecutor(
  definition: WorkflowDefinition,
  positionId: string,
  job: JobRecord,
  workers: ReadonlyMap<string, WorkerInfo>,
): StoredExecutor {
  if (positionId === 'start' || positionId === 'end') {
    if (positionId === 'end' && job.delivery.kind === 'assistant') {
      const worker = workers.get(job.delivery.name)
      if (worker === undefined) {
        throw new WorkflowError(
          'unknown-worker',
          `the delivery assistant "${job.delivery.name}" is not registered`,
        )
      }
      return {
        kind: 'worker',
        name: worker.name,
        driver: worker.driver,
        ...(worker.program === undefined ? {} : { program: worker.program }),
        ...(worker.avatar === undefined ? {} : { avatar: worker.avatar }),
      }
    }
    return job.starter.kind === 'human'
      ? { kind: 'human' }
      : { kind: 'session', sessionId: job.starter.sessionId }
  }
  const position = findPosition(definition, positionId)
  if (position === undefined) {
    throw new WorkflowError('unknown-position', `unknown position "${positionId}"`)
  }
  if (position.executor.kind === 'human') return { kind: 'human' }
  const worker = workers.get(position.executor.name)
  if (worker === undefined) {
    throw new WorkflowError(
      'unknown-worker',
      `position "${positionId}" uses worker "${position.executor.name}", which is not registered`,
    )
  }
  return {
    kind: 'worker',
    name: worker.name,
    driver: worker.driver,
    ...(worker.program === undefined ? {} : { program: worker.program }),
    ...(worker.avatar === undefined ? {} : { avatar: worker.avatar }),
  }
}

/**
 * 判断一个任务在加入新依赖后依赖图是否成环。
 *
 * 新任务的依赖只能指向已创建任务，所以只需检查已有任务的依赖闭包；但如果已有
 * 数据被外部改坏，仍在创建时报错而不是拖到调度。
 *
 * @param tasks 已有任务
 * @returns 依赖图里的环（任务 id）；无环时是 null
 */
export function findDependencyCycle(tasks: readonly TaskRecord[]): string[] | null {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  let cycle: string[] | null = null
  const visit = (taskId: string, path: string[]): boolean => {
    if (visiting.has(taskId)) {
      cycle = [...path.slice(path.indexOf(taskId)), taskId]
      return true
    }
    if (visited.has(taskId)) return false
    visiting.add(taskId)
    const task = byId.get(taskId)
    for (const dependency of task?.deps ?? []) {
      if (byId.has(dependency) && visit(dependency, [...path, taskId])) return true
    }
    visiting.delete(taskId)
    visited.add(taskId)
    return false
  }
  for (const task of tasks) {
    if (visit(task.id, [])) break
  }
  return cycle
}

/**
 * 校验并构造一条派生任务。
 *
 * @param input 创建者、通道、类型、任务内容与依赖
 * @returns 新任务记录与初始状态
 * @throws `WorkflowError`（code 稳定）表示创建被拒绝
 */
export function buildCreatedTask(input: CreateTaskInput): CreateTaskResult {
  const { job, creator, channel: channelId, type, content, deps, tasks, workers } = input
  const definition = job.definition
  if (job.status !== 'running') {
    throw new WorkflowError('job-not-running', `job ${job.id} is not running`)
  }
  if (creator.status !== 'running') {
    throw new WorkflowError(
      'creator-not-running',
      `task ${creator.id} is not ${creator.status}; only a running task can create tasks`,
    )
  }
  const channel = resolveDispatchChannel(definition, creator.position, channelId)
  const position = channel.to
  if (position === 'start') {
    throw new WorkflowError(
      'invalid-target',
      'tasks cannot be dispatched to the built-in start node',
    )
  }
  const taskType = resolveTargetTaskType(definition, position, type)
  if (!channelAllowsType(channel, taskType.id)) {
    throw new WorkflowError(
      'type-not-allowed',
      `channel "${channel.id}" (${channel.from} -> ${channel.to}) does not allow task type "${taskType.id}"`,
    )
  }
  const problems = contentProblems(taskType, content)
  if (problems.length > 0) {
    throw new WorkflowError(
      'invalid-content',
      `content does not match task type "${taskType.id}": ${problems.join('; ')}`,
    )
  }

  // 依赖：存在、同作业、不重复、不是自己、无环、预算。
  const taskId = newTaskId()
  const dependencyIds: string[] = []
  for (const dependency of deps) {
    if (typeof dependency !== 'string' || dependency.trim() === '') {
      throw new WorkflowError('invalid-dependency', 'deps must be non-empty task ids')
    }
    if (dependency === taskId) {
      throw new WorkflowError('invalid-dependency', 'a task cannot depend on itself')
    }
    if (dependencyIds.includes(dependency)) {
      throw new WorkflowError('invalid-dependency', `duplicate dependency "${dependency}"`)
    }
    const existing = tasks.find((task) => task.id === dependency)
    if (existing === undefined) {
      throw new WorkflowError(
        'unknown-dependency',
        `dependency "${dependency}" does not exist in this job (no future references)`,
      )
    }
    dependencyIds.push(dependency)
  }
  if (findDependencyCycle(tasks) !== null) {
    throw new WorkflowError(
      'dependency-cycle',
      'the job task dependency graph already contains a cycle',
    )
  }
  const budget = definition.budgets.maxTasks
  if (tasks.length + 1 > budget) {
    throw new WorkflowError(
      'budget-exceeded',
      `workflow budget maxTasks=${budget} would be exceeded (job ${job.id} already has ${tasks.length} tasks)`,
    )
  }

  const now = nowIso()
  const ready = dependencyIds.every(
    (dependency) => tasks.find((task) => task.id === dependency)?.status === 'completed',
  )
  const task: TaskRecord = {
    id: taskId,
    jobId: job.id,
    position,
    type: taskType.id,
    channel: channel.id,
    content,
    deps: dependencyIds,
    status: ready ? 'ready' : 'pending',
    createdBy: { taskId: creator.id, position: creator.position },
    assignee: resolveExecutor(definition, position, job, workers),
    claimant: null,
    attemptIds: [],
    result: null,
    error: null,
    assistantBlocked: false,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  }
  return { task, ready }
}

/**
 * 按任务类型校验任务内容，返回可读的问题列表。
 *
 * @param taskType 目标任务类型（结束任务是合成契约）
 * @param content 任务内容
 * @returns 问题列表；空表示通过
 */
export function contentProblems(taskType: TaskTypeDefinition, content: JsonValue): string[] {
  if (taskType.content === undefined) return []
  return contentIssues(taskType.content, content).map((issue) => `${issue.path} ${issue.message}`)
}

/**
 * 解析一条可用的派发通道：必须存在、从创建者岗位出发。
 *
 * @param definition 定义
 * @param from 创建者岗位（启动任务是 `start`）
 * @param channelId 请求的通道 id
 * @returns 通道
 * @throws `WorkflowError` 通道不存在或起点不符
 */
function resolveDispatchChannel(
  definition: WorkflowDefinition,
  from: string,
  channelId: string,
): ChannelDefinition {
  const channel = findChannel(definition, channelId)
  if (channel === undefined) {
    const available = channelsFrom(definition, from)
    throw new WorkflowError(
      'no-channel',
      `unknown channel "${channelId}"; channels from "${from}": ${
        available.length === 0
          ? '(none)'
          : available.map((item) => `${item.id}「${item.label}」-> ${item.to}`).join(', ')
      }`,
    )
  }
  if (channel.from !== from) {
    throw new WorkflowError(
      'channel-not-own',
      `channel "${channel.id}" starts at "${channel.from}"; this task is at "${from}"`,
    )
  }
  return channel
}

/**
 * 解析目标岗位与任务类型（结束任务用内建契约）。
 *
 * @param definition 定义
 * @param position 目标岗位
 * @param type 请求的类型 id
 * @returns 目标岗位与任务类型
 */
export function resolveTarget(
  definition: WorkflowDefinition,
  position: string,
  type: string,
): { readonly position: string; readonly taskType: TaskTypeDefinition } {
  if (position === 'end') {
    return { position, taskType: resolveTargetTaskType(definition, position, type) }
  }
  const taskType = findTaskType(definition, type)
  const positionDef = definition.positions.find((candidate) => candidate.id === position)
  if (
    taskType === undefined ||
    positionDef?.taskTypes.every((candidate) => candidate.id !== type)
  ) {
    throw new WorkflowError(
      'invalid-type',
      `"${type}" is not a task type of position "${position}"`,
    )
  }
  return { position, taskType }
}

/**
 * 解析目标任务类型；`end` 用内建契约，既不是岗位类型也不存在。
 *
 * @param definition 定义
 * @param position 目标岗位
 * @param type 请求的类型 id
 * @returns 任务类型（end 返回合成契约）
 */
export function resolveTargetTaskType(
  definition: WorkflowDefinition,
  position: string,
  type: string,
): TaskTypeDefinition {
  if (position === 'end') {
    if (type !== 'end' && type !== '') {
      throw new WorkflowError(
        'invalid-type',
        `end tasks use the built-in end contract; "type" must be "end" (got "${type}")`,
      )
    }
    return {
      id: 'end',
      label: '结束任务',
      definition: '把作业的最终报告交给发起人；发起人确认收到后完成。',
      ...(definition.end.content === undefined ? {} : { content: definition.end.content }),
    }
  }
  const taskType = findTaskType(definition, type)
  const positionDef = definition.positions.find((candidate) => candidate.id === position)
  if (
    taskType === undefined ||
    positionDef?.taskTypes.every((candidate) => candidate.id !== type)
  ) {
    throw new WorkflowError(
      'invalid-type',
      `"${type}" is not a task type of position "${position}"`,
    )
  }
  return taskType
}

/**
 * 渲染一条创建声明：解析通道、目标类型与任务内容。
 *
 * @param definition 定义
 * @param from 声明所在的节点（`start` 或岗位 id）
 * @param creation 创建声明
 * @param context 模板上下文（`content` / `input`）
 * @returns 渲染好的目标、通道与任务内容
 */
export function renderCreation(
  definition: WorkflowDefinition,
  from: string,
  creation: CreationDefinition,
  context: { readonly content?: JsonValue; readonly input?: JsonValue },
): {
  readonly channel: ChannelDefinition
  readonly position: string
  readonly taskType: TaskTypeDefinition
  readonly content: JsonValue
} {
  const channel = resolveDispatchChannel(definition, from, creation.channel)
  const position = channel.to
  if (position === 'start') {
    throw new WorkflowError('invalid-target', 'tasks cannot be dispatched to the start node')
  }
  const type = position === 'end' ? 'end' : (creation.type ?? '')
  const { taskType } = resolveTarget(definition, position, type)
  if (position !== 'end' && !channelAllowsType(channel, taskType.id)) {
    throw new WorkflowError(
      'type-not-allowed',
      `channel "${channel.id}" does not allow task type "${taskType.id}"`,
    )
  }
  const rendered = renderPayload(
    creation.content ?? {},
    buildTemplateContext({ content: context.content ?? null, input: context.input ?? null }),
  ) as JsonValue
  const problems = contentProblems(taskType, rendered)
  if (problems.length > 0) {
    throw new WorkflowError(
      'invalid-content',
      `content does not match task type "${taskType.id}": ${problems.join('; ')}`,
    )
  }
  return { channel, position, taskType, content: rendered }
}

/**
 * 生成 `start.next` 发布的初始任务。
 *
 * 启动任务已完成：它们的唯一依赖是启动任务（`START_TASK_ID`），所以初始状态
 * 都是 `ready`。
 *
 * @param input 作业、启动任务、已有任务与打工人表
 * @returns 新任务记录
 */
export function buildInitialTasks(input: {
  readonly job: JobRecord
  readonly startTask: TaskRecord
  readonly tasks: readonly TaskRecord[]
  readonly workers: ReadonlyMap<string, WorkerInfo>
}): TaskRecord[] {
  const { job, startTask, workers } = input
  const definition = job.definition
  const tasks = [...input.tasks]
  const created: TaskRecord[] = []
  for (const [index, creation] of definition.start.next.entries()) {
    if (tasks.length + 1 > definition.budgets.maxTasks) {
      throw new WorkflowError(
        'budget-exceeded',
        `workflow budget maxTasks=${definition.budgets.maxTasks} would be exceeded by initial task ${index}`,
      )
    }
    const parsed = renderCreation(definition, 'start', creation, { content: startTask.content })
    const now = nowIso()
    const task: TaskRecord = {
      id: newTaskId(),
      jobId: job.id,
      position: parsed.position,
      type: parsed.taskType.id,
      channel: parsed.channel.id,
      content: parsed.content,
      deps: [START_TASK_ID],
      status: 'ready',
      createdBy: { taskId: startTask.id, position: 'start' },
      assignee: resolveExecutor(definition, parsed.position, job, workers),
      claimant: null,
      attemptIds: [],
      result: null,
      error: null,
      assistantBlocked: false,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    }
    tasks.push(task)
    created.push(task)
  }
  return created
}
