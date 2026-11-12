/**
 * 任务创建校验与记录构造（`.tmp/workflow-v4-spec.md` §7.3 / §7.4）。
 *
 * 创建任务的入口只有两个：引擎按 `start.next` 生成初始任务；执行中的任务通过
 * `buka_task_create` 派生任务。这里实现两条路径共享的纯校验：
 *
 * 1. 目标岗位是创建者岗位的直接后继（边存在；`start` / `end` 同理）；
 * 2. 任务类型是目标岗位声明的类型（结束任务用 `end.task`）；
 * 3. 边写了类型白名单时，类型在白名单里；
 * 4. payload 符合类型 schema，模板只引用已存在的数据路径；
 * 5. 依赖 id 属于本作业、已存在、不是自己、依赖图不成环；`requires` 满足；
 * 6. 作业预算未超。
 *
 * @module @buka/dsh-plugin-workflows/engine/tasks
 */

import { inspectPayload } from '../definition/payload.ts'
import {
  edgeAllowsType,
  findEdge,
  findPosition,
  findTaskType,
  templatedPayloadIssues,
} from '../definition/validate.ts'
import { newTaskId, nowIso, START_TASK_ID } from '../domain/ids.ts'
import type {
  JobRecord,
  JsonValue,
  RobotInfo,
  StartRouteDefinition,
  StoredExecutor,
  TaskRecord,
  TaskTypeDefinition,
  WorkflowDefinition,
} from '../domain/types.ts'
import { resolveOutputPath } from '../output.ts'
import { WorkflowError } from './types.ts'

/** 创建任务的入参。 */
export interface CreateTaskInput {
  readonly job: JobRecord
  readonly creator: TaskRecord
  readonly position: string
  readonly type: string
  readonly payload: JsonValue
  readonly deps: readonly string[]
  readonly tasks: readonly TaskRecord[]
  /** 机器人登记表（按名字）；program 型带 driver/program。 */
  readonly robots: ReadonlyMap<string, RobotInfo>
}

/** 构造出的任务与派生信息。 */
export interface CreateTaskResult {
  readonly task: TaskRecord
  /** 依赖是否已全部完成（决定初始状态）。 */
  readonly ready: boolean
}

/**
 * 解析岗位执行者，构造任务记录里钉住的执行者。
 *
 * @param definition 定义
 * @param positionId 岗位 id
 * @param job 作业
 * @param robots 机器人登记表
 * @returns 钉住的执行者
 */
export function resolveExecutor(
  definition: WorkflowDefinition,
  positionId: string,
  job: JobRecord,
  robots: ReadonlyMap<string, RobotInfo>,
): StoredExecutor {
  if (positionId === 'start' || positionId === 'end') {
    return job.starter.kind === 'human'
      ? { kind: 'human' }
      : { kind: 'session', sessionId: job.starter.sessionId }
  }
  const position = findPosition(definition, positionId)
  if (position === undefined) {
    throw new WorkflowError('unknown-position', `unknown position "${positionId}"`)
  }
  if (position.executor.kind === 'human') return { kind: 'human' }
  const robot = robots.get(position.executor.name)
  if (robot === undefined) {
    throw new WorkflowError(
      'unknown-robot',
      `position "${positionId}" uses robot "${position.executor.name}", which is not registered`,
    )
  }
  return {
    kind: 'robot',
    name: robot.name,
    driver: robot.driver,
    ...(robot.program === undefined ? {} : { program: robot.program }),
    ...(robot.avatar === undefined ? {} : { avatar: robot.avatar }),
  }
}

/**
 * 校验模板引用：只允许 start.output 与已存在任务的 output / text。
 *
 * @param payload payload
 * @param tasks 作业里已创建的任务
 * @param definition 定义
 * @param startOutputSchema 启动任务 output schema
 * @returns 错误消息列表
 */
export function templateReferenceIssues(
  payload: JsonValue,
  tasks: readonly TaskRecord[],
  definition: WorkflowDefinition,
  startOutputSchema: TaskTypeDefinition['payload'],
): string[] {
  const issues: string[] = []
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const reference of inspectPayload(payload).references) {
    const parsed = reference.reference
    if (parsed === null) {
      issues.push(
        `template "{{${reference.path}}}" must be start.output, task.<id>.output or task.<id>.text`,
      )
      continue
    }
    if (parsed.kind === 'start') {
      const reason = resolveOutputPath(startOutputSchema, parsed.segments)
      if (reason !== null) issues.push(`template "{{${reference.path}}}" ${reason}`)
      continue
    }
    const task = byId.get(parsed.taskId)
    if (task === undefined) {
      issues.push(
        `template "{{${reference.path}}}" references task "${parsed.taskId}", which does not exist in this job`,
      )
      continue
    }
    if (parsed.field === 'text') continue
    const type = findTaskType(definition, task.type)
    if (type === undefined) continue
    const reason = resolveOutputPath(type.output, parsed.segments)
    if (reason !== null) {
      issues.push(`template "{{${reference.path}}}" ${reason}`)
    }
  }
  return issues
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
 * @param input 创建者、目标岗位、类型、payload 与依赖
 * @returns 新任务记录与初始状态
 * @throws `WorkflowError`（code 稳定）表示创建被拒绝
 */
export function buildCreatedTask(input: CreateTaskInput): CreateTaskResult {
  const { job, creator, position, type, payload, deps, tasks, robots } = input
  const definition = job.definition
  if (job.status !== 'running') {
    throw new WorkflowError('job-not-running', `job ${job.id} is not running`)
  }
  if (creator.status !== 'running') {
    throw new WorkflowError(
      'creator-not-running',
      `task ${creator.id} is not running; only an executing task can create tasks`,
    )
  }
  if (position === 'start') {
    throw new WorkflowError(
      'invalid-target',
      'tasks cannot be dispatched to the built-in start node',
    )
  }
  const edge = findEdge(definition, creator.position, position)
  if (edge === undefined) {
    throw new WorkflowError(
      'no-edge',
      `no edge "${creator.position} -> ${position}": the executing position cannot dispatch this target`,
    )
  }
  const taskType = resolveTargetTaskType(definition, position, type)
  if (!edgeAllowsType(edge, taskType.id)) {
    throw new WorkflowError(
      'type-not-allowed',
      `edge "${creator.position} -> ${position}" does not allow task type "${taskType.id}"`,
    )
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new WorkflowError('invalid-payload', 'payload must be a JSON object')
  }
  const schemaIssues = templatedPayloadIssues(taskType.payload, payload)
  if (schemaIssues.length > 0) {
    throw new WorkflowError(
      'invalid-payload',
      `payload does not match task type "${taskType.id}": ${schemaIssues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}`,
    )
  }
  const startType = definition.start.task.output
  const templateIssues = templateReferenceIssues(payload, tasks, definition, startType)
  if (templateIssues.length > 0) {
    throw new WorkflowError('invalid-template', templateIssues.join('; '))
  }

  // 依赖：存在、同作业、不重复、不是自己、无环、requires、预算。
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

  for (const requirement of taskType.requires ?? []) {
    const satisfied = tasks.some(
      (task) => dependencyIds.includes(task.id) && requirement.types.includes(task.type),
    )
    if (!satisfied) {
      throw new WorkflowError(
        'requires-not-met',
        `task type "${taskType.id}" requires a dependency of type: ${requirement.types.join(' | ')}`,
      )
    }
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
    payload,
    deps: dependencyIds,
    status: ready ? 'ready' : 'pending',
    createdBy: { taskId: creator.id, position: creator.position },
    assignee: resolveExecutor(definition, position, job, robots),
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
      description: '把最终交付物交给启动者，投递即完成。',
      payload: definition.end.task.payload,
      output: { type: 'object' },
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
 * 生成 `start.next` 发布的初始任务。
 *
 * 启动任务已完成：结构化输入是它们的唯一依赖 `$start`，所以初始状态都是
 * `ready`（除非模板里显式依赖了别的初始任务——本版不允许）。
 *
 * @param input 作业、启动任务、模板、已有任务与机器人表
 * @returns 新任务记录
 */
export function buildInitialTasks(input: {
  readonly job: JobRecord
  readonly startTask: TaskRecord
  readonly tasks: readonly TaskRecord[]
  readonly robots: ReadonlyMap<string, RobotInfo>
}): TaskRecord[] {
  const { job, startTask, robots } = input
  const definition = job.definition
  const tasks = [...input.tasks]
  const created: TaskRecord[] = []
  for (const [index, route] of definition.start.next.entries()) {
    if (tasks.length + 1 > definition.budgets.maxTasks) {
      throw new WorkflowError(
        'budget-exceeded',
        `workflow budget maxTasks=${definition.budgets.maxTasks} would be exceeded by initial task ${index}`,
      )
    }
    const task = buildInitialTask({ job, route, startTask, tasks, robots, definition })
    tasks.push(task)
    created.push(task)
  }
  return created
}

/** 构造单条初始任务。 */
function buildInitialTask(input: {
  readonly job: JobRecord
  readonly route: StartRouteDefinition
  readonly startTask: TaskRecord
  readonly tasks: readonly TaskRecord[]
  readonly robots: ReadonlyMap<string, RobotInfo>
  readonly definition: WorkflowDefinition
}): TaskRecord {
  const { job, route, startTask, tasks, robots, definition } = input
  const position = findPosition(definition, route.position)
  if (position === undefined) {
    throw new WorkflowError(
      'unknown-position',
      `start.next targets unknown position "${route.position}"`,
    )
  }
  const taskType = resolveTargetTaskType(definition, route.position, route.type)
  const edge = findEdge(definition, 'start', route.position)
  if (edge === undefined || !edgeAllowsType(edge, taskType.id)) {
    throw new WorkflowError(
      'no-edge',
      `start.next dispatches to "${route.position}" but no edge allows task type "${taskType.id}"`,
    )
  }
  const templateIssues = templateReferenceIssues(
    route.payload as JsonValue,
    tasks,
    definition,
    definition.start.task.output,
  )
  if (templateIssues.length > 0) {
    throw new WorkflowError('invalid-template', templateIssues.join('; '))
  }
  const now = nowIso()
  return {
    id: newTaskId(),
    jobId: job.id,
    position: route.position,
    type: taskType.id,
    payload: route.payload as JsonValue,
    deps: route.dependsOn === undefined ? [START_TASK_ID] : [...route.dependsOn],
    status: 'ready',
    createdBy: { taskId: startTask.id, position: 'start' },
    assignee: resolveExecutor(definition, route.position, job, robots),
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
}
