/**
 * 工作流 v8 定义校验。
 *
 * 纯函数：不读盘、不依赖 DSH。执行者存在性由调用方传入 `workers` 目录（按
 * 标识符建索引），这样 `buka_workflow_save` 用 workers 服务的登记表，单测用
 * 固定目录。
 *
 * 校验分两步：先解析出规范化定义，再跑跨节点规则（通道、可达性、动作、模板引用）。
 * 错误带定位路径，尽量一次返回全部问题；结构缺得太多时提前返回。
 *
 * @module @buka/dsh-plugin-workflows/definition/validate
 */

import { executorRef } from '../domain/identity.ts'
import type {
  ActionDefinition,
  BudgetDefinition,
  ChannelDefinition,
  CreationDefinition,
  DefinitionIssue,
  EndDefinition,
  ExecutorSpec,
  JsonValue,
  PositionDefinition,
  StartDefinition,
  TaskTypeDefinition,
  WorkerInfo,
  WorkflowDefinition,
} from '../domain/types.ts'
import type { JsonSchema } from '../json-schema.ts'
import { isPlainObject, parseJsonSchema, resolveSchemaPath } from '../json-schema.ts'
import { isKnownProgram, normalizeProgramId, programRequiredContent } from '../program/contracts.ts'
import { containsTemplate, inspectPayload } from './payload.ts'

/** 校验入参。 */
export interface ValidateDefinitionOptions {
  /** workers 登记表里本插件关心的字段；主体 / 助理的存在性据此判断。 */
  readonly workers: ReadonlyMap<string, WorkerInfo>
}

/** 校验结果。 */
export type ValidateDefinitionResult =
  | { readonly ok: true; readonly definition: WorkflowDefinition }
  | { readonly ok: false; readonly issues: readonly DefinitionIssue[] }

/** 岗位 id 与任务类型 id 的形状。 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

/** 通道 id 的形状：小写点分，首尾是字母或数字，便于在对话与报错里引用。 */
const CHANNEL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u

/** 内建节点 id。 */
const START_ID = 'start'
const END_ID = 'end'

/** 收集错误。 */
class Issues {
  readonly list: DefinitionIssue[] = []

  add(path: string, message: string): void {
    this.list.push({ path, message })
  }

  get failed(): boolean {
    return this.list.length > 0
  }
}

/**
 * 校验一份工作流 v8 定义。
 *
 * @param raw 待校验的原始定义（来自工具参数或 storageDomain）
 * @param options 执行者目录
 * @returns 规范化定义，或全部校验错误
 */
export function validateWorkflowDefinition(
  raw: unknown,
  options: ValidateDefinitionOptions,
): ValidateDefinitionResult {
  const issues = new Issues()
  if (!isPlainObject(raw)) {
    issues.add('', 'workflow definition must be a JSON object')
    return { ok: false, issues: issues.list }
  }

  if (raw.version !== 8) issues.add('version', 'must be 8')
  const name = readName(raw, 'name', '', issues)
  const description = readOptionalString(raw, 'description', 'description', issues) ?? ''
  const budgets = readBudgets(raw.budgets, issues)

  const positions = readPositions(raw.positions, options.workers, issues)
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const typeById = new Map<string, TaskTypeDefinition>()
  for (const position of positions) {
    for (const taskType of position.taskTypes) typeById.set(taskType.id, taskType)
  }

  const channels = readChannels(raw.channels, positionById, typeById, issues)
  const channelById = new Map(channels.map((channel) => [channel.id, channel]))
  const start = readStart(raw.start, issues)
  const end = readEnd(raw.end, issues)

  checkChannels(channels, positions, issues)
  checkReachability(channels, positions, issues)
  checkEnd(channels, positions, issues)
  const endContent = end?.content
  checkStartRoutes(start, positionById, typeById, channelById, endContent, issues)
  checkActions(positions, positionById, typeById, channelById, endContent, issues)
  checkRobotCreates(positions, positionById, typeById, channelById, endContent, issues)

  if (issues.failed) return { ok: false, issues: issues.list }
  if (name === null || budgets === null || start === null || end === null) {
    return { ok: false, issues: issues.list }
  }

  return {
    ok: true,
    definition: {
      version: 8,
      name,
      ...(description === '' ? {} : { description }),
      budgets,
      start,
      end,
      positions,
      channels,
    },
  }
}

/** 读取必填字符串字段。 */
function readName(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: Issues,
): string | null {
  const value = source[key]
  const at = path === '' ? key : `${path}.${key}`
  if (typeof value !== 'string' || value.trim() === '') {
    issues.add(at, 'must be a non-empty string')
    return null
  }
  return value.trim()
}

/** 读取可选字符串字段。 */
function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: Issues,
): string | null {
  const value = source[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    issues.add(path, 'must be a string')
    return null
  }
  return value
}

/** 解析预算。 */
function readBudgets(raw: unknown, issues: Issues): BudgetDefinition | null {
  if (!isPlainObject(raw)) {
    issues.add('budgets', 'must declare maxTasks and maxDurationHours')
    return null
  }
  let valid = true
  const maxTasks = raw.maxTasks
  if (typeof maxTasks !== 'number' || !Number.isInteger(maxTasks) || maxTasks < 1) {
    issues.add('budgets.maxTasks', 'must be a positive integer')
    valid = false
  }
  const maxDurationHours = raw.maxDurationHours
  if (
    typeof maxDurationHours !== 'number' ||
    !Number.isFinite(maxDurationHours) ||
    maxDurationHours <= 0
  ) {
    issues.add('budgets.maxDurationHours', 'must be a positive number of hours')
    valid = false
  }
  if (!valid) return null
  return { maxTasks: maxTasks as number, maxDurationHours: maxDurationHours as number }
}

/** 解析岗位列表。 */
function readPositions(
  raw: unknown,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): PositionDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.add('positions', 'must be a non-empty array')
    return []
  }
  const positions: PositionDefinition[] = []
  const seenPositions = new Set<string>()
  const seenTypes = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const path = `positions[${index}]`
    if (!isPlainObject(entry)) {
      issues.add(path, 'must be an object')
      continue
    }
    const id = readPositionId(entry, path, seenPositions, issues)
    if (id === null) continue
    const label = readName(entry, 'label', path, issues)
    const note = readOptionalString(entry, 'note', `${path}.note`, issues)
    const executor = readExecutor(entry.executor, `${path}.executor`, id, workers, issues)
    const taskTypes = readTaskTypes(
      entry.taskTypes,
      `${path}.taskTypes`,
      id,
      executor,
      workers,
      seenTypes,
      issues,
    )
    if (label === null || executor === null) continue
    if (taskTypes.length === 0) {
      issues.add(`${path}.taskTypes`, 'a position must declare at least one task type')
    }
    positions.push({
      id,
      label,
      ...(note === null || note === '' ? {} : { note }),
      executor,
      taskTypes,
    })
  }
  return positions
}

/** 读取岗位 id 并检查唯一性 / 保留字。 */
function readPositionId(
  entry: Record<string, unknown>,
  path: string,
  seen: Set<string>,
  issues: Issues,
): string | null {
  const id = entry.id
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    issues.add(`${path}.id`, 'must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}')
    return null
  }
  if (id === START_ID || id === END_ID) {
    issues.add(`${path}.id`, `"${id}" is reserved by the built-in start/end nodes`)
    return null
  }
  if (seen.has(id)) {
    issues.add(`${path}.id`, `duplicate position id "${id}"`)
    return null
  }
  seen.add(id)
  return id
}

/** 解析岗位主体。 */
function readExecutor(
  raw: unknown,
  path: string,
  positionId: string,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): ExecutorSpec | null {
  if (!isPlainObject(raw)) {
    issues.add(path, 'must be { kind: "worker", id } or { kind: "human" }')
    return null
  }
  if (raw.kind === 'human') return { kind: 'human' }
  if (raw.kind !== 'worker') {
    issues.add(`${path}.kind`, 'must be "worker" or "human"')
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') {
    issues.add(`${path}.id`, 'must be a non-empty worker identifier')
    return null
  }
  const worker = workers.get(id)
  if (worker === undefined) {
    issues.add(
      `${path}.id`,
      `unknown worker identifier "${id}" for position "${positionId}": register it with the Buka Workers plugin first`,
    )
    return null
  }
  if (worker.driver === 'robot' && !isKnownProgram(worker.program)) {
    issues.add(
      `${path}.id`,
      `robot identifier "${id}" of position "${positionId}" uses program "${normalizeProgramId(worker.program)}", which no installed plugin provides`,
    )
    return null
  }
  return { kind: 'worker', id }
}

/** 解析一个岗位的任务类型列表。 */
function readTaskTypes(
  raw: unknown,
  path: string,
  positionId: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  seenTypes: Set<string>,
  issues: Issues,
): TaskTypeDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.add(path, 'must be a non-empty array')
    return []
  }
  const taskTypes: TaskTypeDefinition[] = []
  for (const [index, entry] of raw.entries()) {
    const at = `${path}[${index}]`
    if (!isPlainObject(entry)) {
      issues.add(at, 'must be an object')
      continue
    }
    const taskType = readTaskType(entry, at, positionId, executor, workers, seenTypes, issues)
    if (taskType !== null) taskTypes.push(taskType)
  }
  return taskTypes
}

/** 解析一个任务类型。 */
function readTaskType(
  entry: Record<string, unknown>,
  path: string,
  positionId: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  seenTypes: Set<string>,
  issues: Issues,
): TaskTypeDefinition | null {
  const id = entry.id
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    issues.add(`${path}.id`, 'must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}')
    return null
  }
  if (seenTypes.has(id)) {
    issues.add(
      `${path}.id`,
      `duplicate task type id "${id}": task type ids are unique in a workflow`,
    )
    return null
  }
  seenTypes.add(id)
  const label = readName(entry, 'label', path, issues)
  const definition = readOptionalString(entry, 'definition', `${path}.definition`, issues)
  const content = readSchema(entry.content, `${path}.content`, issues, 'value')
  const human = executor?.kind === 'human'
  const actions = readActions(entry.actions, `${path}.actions`, human, issues)
  const creates = readRobotCreates(entry.creates, `${path}.creates`, executor, workers, issues)
  const assistant = readAssistant(
    entry.assistant,
    `${path}.assistant`,
    positionId,
    id,
    executor,
    workers,
    issues,
  )
  const mode = readMode(entry.mode, `${path}.mode`, path, executor, workers, issues)
  const worktree = readWorktree(entry.worktree, `${path}.worktree`, path, executor, workers, issues)
  if (label === null) return null
  const taskType: TaskTypeDefinition = {
    id,
    label,
    ...(definition === null || definition === '' ? {} : { definition }),
    ...(content === null ? {} : { content }),
    ...(actions === undefined ? {} : { actions }),
    ...(creates === undefined ? {} : { creates }),
    ...(assistant === undefined ? {} : { assistant }),
    ...(mode === undefined ? {} : { mode }),
    ...(worktree === undefined ? {} : { worktree }),
  }
  // content 写坏了已经报过错，不再叠一条「缺 content schema」。
  if (content !== null || entry.content === undefined || entry.content === null) {
    checkRobotContent(taskType, path, executor, workers, issues)
  }
  return taskType
}

/**
 * 机器人岗位的任务类型必须覆盖程序声明的内容契约。
 *
 * 契约属于程序（见 `program/contracts.ts`）；这里只检查作者声明的 `content`
 * schema 是否覆盖了程序要求的必填字段，实际内容在创建任务与执行前再校验。
 * `oneOf` 联合类型不在这里猜，交给运行期校验。
 */
function checkRobotContent(
  taskType: TaskTypeDefinition,
  path: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): void {
  if (executor === null || executor.kind !== 'worker') return
  const id = executorRef(executor)
  const worker = id === null ? undefined : workers.get(id)
  if (worker === undefined || worker.driver !== 'robot') return
  const program = normalizeProgramId(worker.program)
  const required = programRequiredContent(program)
  if (required.length === 0) return
  const fields = required.map((name) => `"${name}"`).join(', ')
  const schema = taskType.content
  if (schema === undefined) {
    issues.add(
      `${path}.content`,
      `robot "${worker.id}" (program "${program}") needs task content: declare a content schema with required ${fields}`,
    )
    return
  }
  if (Array.isArray(schema.oneOf)) return
  if (schema.type !== 'object') {
    issues.add(
      `${path}.content.type`,
      `must be "object": robot "${worker.id}" (program "${program}") reads task content fields ${fields}`,
    )
    return
  }
  const declared = new Set(Array.isArray(schema.required) ? schema.required : [])
  const missing = required.filter((name) => !declared.has(name))
  if (missing.length > 0) {
    issues.add(
      `${path}.content.required`,
      `must include ${missing.map((name) => `"${name}"`).join(', ')}: robot "${worker.id}" (program "${program}") needs it`,
    )
  }
}

/** 主体是不是机器人（登记表里 driver 为 robot）。 */
function isRobotExecutor(
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
): boolean {
  if (executor === null || executor.kind !== 'worker') return false
  const id = executorRef(executor)
  return id === null ? false : workers.get(id)?.driver === 'robot'
}

/**
 * 解析机器人任务类型的「完成后创建」。
 *
 * 只有机器人岗位能声明：agent 任务用 `buka_task_create` 动态创建，人任务用动作。
 */
function readRobotCreates(
  raw: unknown,
  path: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): readonly CreationDefinition[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRobotExecutor(executor, workers)) {
    issues.add(path, 'creates are only valid on robot positions')
    return undefined
  }
  return readCreations(raw, path, issues) ?? undefined
}

/** 解析 schema 字段；任务内容允许非对象顶层，表单与作业输入要求对象。 */
function readSchema(
  raw: unknown,
  path: string,
  issues: Issues,
  root: 'object' | 'value' = 'object',
): JsonSchema | null {
  if (raw === undefined || raw === null) return null
  return parseJsonSchema(raw, path, (at, message) => issues.add(at, message), { root })
}

/** 解析任务类型上的动作列表。 */
function readActions(
  raw: unknown,
  path: string,
  human: boolean,
  issues: Issues,
): readonly ActionDefinition[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!human) {
    issues.add(path, 'actions are only valid on human positions')
    return undefined
  }
  if (!Array.isArray(raw)) {
    issues.add(path, 'must be an array of actions')
    return undefined
  }
  const actions: ActionDefinition[] = []
  const seen = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const at = `${path}[${index}]`
    if (!isPlainObject(entry)) {
      issues.add(at, 'must be an object')
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '' || !ID_PATTERN.test(id)) {
      issues.add(`${at}.id`, 'must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}')
      continue
    }
    if (seen.has(id)) {
      issues.add(`${at}.id`, `duplicate action id "${id}" in this task type`)
      continue
    }
    seen.add(id)
    const label = readName(entry, 'label', at, issues)
    if (label === null) continue
    const input = readSchema(entry.input, `${at}.input`, issues)
    const creates = readCreations(entry.creates, `${at}.creates`, issues)
    if (creates === null) continue
    actions.push({
      id,
      label,
      ...(input === null ? {} : { input }),
      creates,
    })
  }
  return actions.length > 0 ? actions : undefined
}

/** 解析一组创建声明（结构层；通道与模板在第二遍校验）。 */
function readCreations(raw: unknown, path: string, issues: Issues): CreationDefinition[] | null {
  if (!Array.isArray(raw)) {
    issues.add(path, 'must be an array (it may be empty)')
    return null
  }
  const creations: CreationDefinition[] = []
  for (const [index, entry] of raw.entries()) {
    const at = `${path}[${index}]`
    if (!isPlainObject(entry)) {
      issues.add(at, 'must be an object')
      continue
    }
    const channel = typeof entry.channel === 'string' ? entry.channel.trim() : ''
    if (channel === '') {
      issues.add(`${at}.channel`, 'must be a channel id')
      continue
    }
    const type =
      entry.type === undefined || entry.type === null
        ? undefined
        : typeof entry.type === 'string' && entry.type.trim() !== ''
          ? entry.type.trim()
          : null
    if (type === null) {
      issues.add(`${at}.type`, 'must be a task type id (omit it only for the end task)')
      continue
    }
    creations.push({
      channel,
      ...(type === undefined ? {} : { type }),
      ...(entry.content === undefined ? {} : { content: entry.content as JsonValue }),
    })
  }
  return creations
}

/**
 * 解析助理字段；只对人岗位有效。
 *
 * 助理是工作流上的点名：只要求标识符已登记且是智能体，不要求执行者身上带
 * 任何标记（ADR 0022）。
 */
function readAssistant(
  raw: unknown,
  path: string,
  positionId: string,
  taskTypeId: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): string | null | undefined {
  if (raw === undefined) return undefined
  if (executor !== null && executor.kind !== 'human') {
    issues.add(path, `assistant is only valid on human positions (position "${positionId}")`)
    return undefined
  }
  if (raw === null) return null
  if (typeof raw !== 'string' || raw.trim() === '') {
    issues.add(path, 'must be a worker identifier or null')
    return undefined
  }
  const id = raw.trim()
  const worker = workers.get(id)
  if (worker === undefined) {
    issues.add(
      path,
      `unknown assistant worker identifier "${id}" for task type "${positionId}.${taskTypeId}": register it with the Buka Workers plugin first`,
    )
    return undefined
  }
  if (worker.driver !== 'agent') {
    issues.add(
      path,
      `assistant identifier "${id}" of task type "${positionId}.${taskTypeId}" must be an agent, not a robot`,
    )
    return undefined
  }
  return id
}

/** 解析 plan 模式；只对智能体有效。 */
function readMode(
  raw: unknown,
  path: string,
  ownerPath: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): 'plan' | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (raw !== 'plan') {
    issues.add(path, 'must be "plan" or null')
    return undefined
  }
  if (executor === null) return undefined
  if (executor.kind !== 'worker') {
    issues.add(path, 'mode "plan" is only valid for agent positions')
    return undefined
  }
  const executorId = executorRef(executor)
  const worker = executorId === null ? undefined : workers.get(executorId)
  if (worker === undefined || worker.driver !== 'agent') {
    issues.add(`${ownerPath}.executor`, 'mode "plan" requires an agent executor')
    return undefined
  }
  return 'plan'
}

/**
 * 解析工作树模式；只对智能体岗位有效。
 *
 * 三个取值：`none`（不注入提示词，等价于省略，任何岗位都接受）、`guard`
 * （只做工作区保护检查）、`create`（让执行者自己创建 worktree）。后两者只对
 * 智能体岗位有效。这里只校验配置形状，不校验宿主是否启用了工作树插件：定义
 * 可能在启用插件的机器上编写、在没启用的组合里执行，也可能反过来。真正生效
 * 与否由执行时探测；`create` 不可用时降级为 `guard`。
 */
function readWorktree(
  raw: unknown,
  path: string,
  ownerPath: string,
  executor: ExecutorSpec | null,
  workers: ReadonlyMap<string, WorkerInfo>,
  issues: Issues,
): 'guard' | 'create' | undefined {
  if (raw === undefined || raw === null) return undefined
  if (raw !== 'none' && raw !== 'guard' && raw !== 'create') {
    issues.add(path, 'must be "none", "guard", or "create"')
    return undefined
  }
  if (raw === 'none') return undefined
  if (executor === null) return undefined
  if (executor.kind !== 'worker') {
    issues.add(path, 'worktree is only valid on agent positions')
    return undefined
  }
  const executorId = executorRef(executor)
  const worker = executorId === null ? undefined : workers.get(executorId)
  if (worker === undefined || worker.driver !== 'agent') {
    issues.add(`${ownerPath}.executor`, 'worktree requires an agent executor')
    return undefined
  }
  return raw
}

/** 解析通道列表。 */
function readChannels(
  raw: unknown,
  positionById: ReadonlyMap<string, PositionDefinition>,
  typeById: ReadonlyMap<string, TaskTypeDefinition>,
  issues: Issues,
): ChannelDefinition[] {
  if (!Array.isArray(raw)) {
    issues.add('channels', 'must be an array')
    return []
  }
  const channels: ChannelDefinition[] = []
  const seen = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const path = `channels[${index}]`
    if (!isPlainObject(entry)) {
      issues.add(path, 'must be an object')
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '' || !CHANNEL_ID_PATTERN.test(id)) {
      issues.add(
        `${path}.id`,
        'must be a lowercase identifier (letters, digits, dots, hyphens or underscores), e.g. "qa.dev.rework"',
      )
      continue
    }
    if (seen.has(id)) {
      issues.add(`${path}.id`, `duplicate channel id "${id}"`)
      continue
    }
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    if (label === '') {
      issues.add(`${path}.label`, 'must be a non-empty display label')
      continue
    }
    const from = typeof entry.from === 'string' ? entry.from.trim() : ''
    const to = typeof entry.to === 'string' ? entry.to.trim() : ''
    if (!isKnownNode(from, positionById)) {
      issues.add(`${path}.from`, `unknown node "${String(entry.from)}"`)
      continue
    }
    if (!isKnownNode(to, positionById)) {
      issues.add(`${path}.to`, `unknown node "${String(entry.to)}"`)
      continue
    }
    if (from === END_ID) {
      issues.add(`${path}.from`, 'the built-in end node cannot dispatch tasks')
      continue
    }
    if (to === START_ID) {
      issues.add(`${path}.to`, 'the built-in start node cannot receive tasks')
      continue
    }
    if (from === to) {
      issues.add(path, 'a channel must connect two different nodes')
      continue
    }
    seen.add(id)
    const types = readChannelTypes(entry.types, `${path}.types`, to, positionById, typeById, issues)
    if (entry.back !== undefined && typeof entry.back !== 'boolean') {
      issues.add(`${path}.back`, 'must be true or false')
    }
    channels.push({
      id,
      label,
      from,
      to,
      ...(types === undefined ? {} : { types }),
      ...(entry.back === true ? { back: true } : {}),
    })
  }
  return channels
}

/** 判断节点是否存在（岗位或内建 start / end）。 */
function isKnownNode(id: string, positionById: ReadonlyMap<string, PositionDefinition>): boolean {
  return id === START_ID || id === END_ID || positionById.has(id)
}

/** 解析通道上的任务类型白名单。 */
function readChannelTypes(
  raw: unknown,
  path: string,
  to: string,
  positionById: ReadonlyMap<string, PositionDefinition>,
  typeById: ReadonlyMap<string, TaskTypeDefinition>,
  issues: Issues,
): readonly string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (to === END_ID) {
    issues.add(
      path,
      'the built-in end node has a single contract; a channel into it cannot whitelist types',
    )
    return undefined
  }
  const target = positionById.get(to)
  if (target === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.add(path, 'must be a non-empty array of task type ids')
    return undefined
  }
  const allowed = new Set(target.taskTypes.map((taskType) => taskType.id))
  const types: string[] = []
  for (const [index, value] of raw.entries()) {
    if (typeof value !== 'string' || value.trim() === '') {
      issues.add(`${path}[${index}]`, 'must be a non-empty task type id')
      continue
    }
    const type = value.trim()
    if (!allowed.has(type) || !typeById.has(type)) {
      issues.add(`${path}[${index}]`, `"${type}" is not a task type of position "${to}"`)
      continue
    }
    if (!types.includes(type)) types.push(type)
  }
  return types.length > 0 ? types : undefined
}

/** 解析开始节点。 */
function readStart(raw: unknown, issues: Issues): StartDefinition | null {
  if (!isPlainObject(raw)) {
    issues.add('start', 'must declare the built-in start node task contract')
    return null
  }
  const content = readSchema(raw.content, 'start.content', issues)
  const next = readCreations(raw.next, 'start.next', issues)
  if (next === null || next.length === 0) {
    issues.add('start.next', 'must declare at least one initial task')
    return null
  }
  return { ...(content === null ? {} : { content }), next }
}

/** 解析结束节点。 */
function readEnd(raw: unknown, issues: Issues): EndDefinition | null {
  if (!isPlainObject(raw)) {
    issues.add('end', 'must declare the built-in end node task contract')
    return null
  }
  const content = readSchema(raw.content, 'end.content', issues, 'value')
  return { ...(content === null ? {} : { content }) }
}

/** 校验开始节点的初始任务。 */
function checkStartRoutes(
  start: StartDefinition | null,
  positionById: ReadonlyMap<string, PositionDefinition>,
  typeById: ReadonlyMap<string, TaskTypeDefinition>,
  channelById: ReadonlyMap<string, ChannelDefinition>,
  endContent: JsonSchema | undefined,
  issues: Issues,
): void {
  if (start === null) return
  for (const [index, creation] of start.next.entries()) {
    checkCreation(
      creation,
      `start.next[${index}]`,
      START_ID,
      start.content,
      undefined,
      endContent,
      {
        positionById,
        typeById,
        channelById,
        issues,
      },
    )
  }
}

/** 校验所有人任务类型上的动作。 */
function checkActions(
  positions: readonly PositionDefinition[],
  positionById: ReadonlyMap<string, PositionDefinition>,
  typeById: ReadonlyMap<string, TaskTypeDefinition>,
  channelById: ReadonlyMap<string, ChannelDefinition>,
  endContent: JsonSchema | undefined,
  issues: Issues,
): void {
  for (const position of positions) {
    for (const taskType of position.taskTypes) {
      for (const [index, action] of (taskType.actions ?? []).entries()) {
        for (const [creationIndex, creation] of action.creates.entries()) {
          checkCreation(
            creation,
            `positions.${position.id}.taskTypes.${taskType.id}.actions[${index}].creates[${creationIndex}]`,
            position.id,
            taskType.content,
            action.input,
            endContent,
            { positionById, typeById, channelById, issues },
          )
        }
      }
    }
  }
}

/** 校验机器人任务类型的「完成后创建」。 */
function checkRobotCreates(
  positions: readonly PositionDefinition[],
  positionById: ReadonlyMap<string, PositionDefinition>,
  typeById: ReadonlyMap<string, TaskTypeDefinition>,
  channelById: ReadonlyMap<string, ChannelDefinition>,
  endContent: JsonSchema | undefined,
  issues: Issues,
): void {
  for (const position of positions) {
    for (const taskType of position.taskTypes) {
      for (const [index, creation] of (taskType.creates ?? []).entries()) {
        checkCreation(
          creation,
          `positions.${position.id}.taskTypes.${taskType.id}.creates[${index}]`,
          position.id,
          taskType.content,
          undefined,
          endContent,
          { positionById, typeById, channelById, issues },
        )
      }
    }
  }
}

/** 校验一条创建声明：通道、目标类型、任务内容模板。 */
function checkCreation(
  creation: CreationDefinition,
  path: string,
  node: string,
  creatorContent: JsonSchema | undefined,
  actionInput: JsonSchema | undefined,
  endContent: JsonSchema | undefined,
  context: {
    readonly positionById: ReadonlyMap<string, PositionDefinition>
    readonly typeById: ReadonlyMap<string, TaskTypeDefinition>
    readonly channelById: ReadonlyMap<string, ChannelDefinition>
    readonly issues: Issues
  },
): void {
  const { issues, channelById, positionById, typeById } = context
  const channel = channelById.get(creation.channel)
  if (channel === undefined) {
    issues.add(`${path}.channel`, `unknown channel "${creation.channel}"`)
    return
  }
  if (channel.from !== node) {
    issues.add(
      `${path}.channel`,
      `channel "${channel.id}" starts at "${channel.from}", not at "${node}"`,
    )
    return
  }
  if (channel.to === END_ID) {
    if (creation.type !== undefined && creation.type !== END_ID) {
      issues.add(`${path}.type`, 'the end task has no task type; omit "type" for channels into end')
    }
    checkContent(creation.content, path, endContent, creatorContent, actionInput, issues)
    return
  }
  const target = positionById.get(channel.to)
  if (target === undefined) {
    issues.add(`${path}.channel`, `channel "${channel.id}" does not lead to a position`)
    return
  }
  if (creation.type === undefined) {
    issues.add(`${path}.type`, `must name a task type of position "${target.id}"`)
    return
  }
  const taskType = typeById.get(creation.type)
  if (
    taskType === undefined ||
    !target.taskTypes.some((candidate) => candidate.id === creation.type)
  ) {
    issues.add(`${path}.type`, `"${creation.type}" is not a task type of position "${target.id}"`)
    return
  }
  if (!channelAllowsType(channel, taskType.id)) {
    issues.add(`${path}.type`, `channel "${channel.id}" does not allow task type "${taskType.id}"`)
    return
  }
  checkContent(creation.content, path, taskType.content, creatorContent, actionInput, issues)
}

/**
 * 校验任务内容：模板引用 + 按目标 schema 的结构检查。
 *
 * @param content 声明的任务内容（可含模板）
 * @param path 定位路径
 * @param target 目标任务内容的 schema
 * @param creatorContent 声明方任务自己的 content schema
 * @param actionInput 动作表单 schema（开始节点没有）
 * @param issues 错误收集
 */
function checkContent(
  content: JsonValue | undefined,
  path: string,
  target: JsonSchema | undefined,
  creatorContent: JsonSchema | undefined,
  actionInput: JsonSchema | undefined,
  issues: Issues,
): void {
  const value: unknown = content ?? {}
  const inspection = inspectPayload(value)
  for (const error of inspection.syntaxErrors) issues.add(`${path}.content`, error)
  for (const reference of inspection.references) {
    const parsed = reference.reference
    if (parsed === null) {
      issues.add(
        `${path}.content`,
        `template "{{${reference.path}}}" must reference content.<path> or input.<path>`,
      )
      continue
    }
    const schema = parsed.kind === 'content' ? creatorContent : actionInput
    if (schema === undefined) {
      issues.add(
        `${path}.content`,
        `template "{{${reference.path}}}" cannot be resolved: the creating task declares no ${
          parsed.kind === 'content' ? 'content schema' : 'input form'
        }`,
      )
      continue
    }
    const reason = resolveSchemaPath(schema, parsed.segments)
    if (reason !== null) issues.add(`${path}.content`, `template "{{${reference.path}}}" ${reason}`)
  }
  if (target === undefined) return
  checkTemplatedContent(target, value, `${path}.content`, issues)
}

/**
 * 按 schema 校验可能含模板的值。
 *
 * 含模板的子树跳过类型 / 枚举检查（值要到执行时才有），但对象 / 数组的结构、
 * required 与 additionalProperties 仍然检查。
 */
function checkTemplatedContent(
  schema: JsonSchema,
  value: unknown,
  path: string,
  issues: Issues,
): void {
  if (Array.isArray(schema.oneOf)) {
    const ok = schema.oneOf.some((branch) => {
      const probe = new Issues()
      checkTemplatedContent(branch, value, path, probe)
      return !probe.failed
    })
    if (!ok) issues.add(path, 'does not match any oneOf variant')
    return
  }
  // 含模板的字符串要等执行时才确定，跳过枚举 / 类型检查；容器继续逐项检查。
  if (typeof value === 'string' && containsTemplate(value)) return
  if (Array.isArray(schema.enum) || Object.hasOwn(schema, 'const')) {
    if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
      issues.add(path, `must be one of ${JSON.stringify(schema.enum)}`)
    }
    if (Object.hasOwn(schema, 'const') && schema.const !== value) {
      issues.add(path, `must equal ${JSON.stringify(schema.const)}`)
    }
    return
  }
  const type = typeof schema.type === 'string' ? schema.type : ''
  if (type === 'object') {
    if (!isPlainObject(value)) {
      issues.add(path, 'must be an object')
      return
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, name)) issues.add(`${path}.${name}`, 'missing required field')
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!Object.hasOwn(properties, name)) {
          issues.add(`${path}.${name}`, 'unexpected field (additionalProperties is false)')
        }
      }
    }
    for (const [name, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, name)) continue
      checkTemplatedContent(child, value[name], `${path}.${name}`, issues)
    }
    return
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      issues.add(path, 'must be an array')
      return
    }
    if (isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        checkTemplatedContent(schema.items as JsonSchema, item, `${path}[${index}]`, issues)
      })
    }
    return
  }
  if (type === '') return
  if (value === null ? type !== 'null' : typeof value !== type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    issues.add(path, `expected ${type}, got ${actual}`)
  }
}

/**
 * 通道与节点的结构检查：回向通道闭合、环上至少一条回向通道、同一对节点的
 * `back` 一致。
 *
 * 规则按 ADR 0015：环上的通道必须有显式标记，回向通道必须真的闭合一个环。
 * 一个环只需要一条 `back: true`（例：`qa -> dev` 标 back，`dev -> qa` 是环里
 * 向前的通道，不必再标），所以按强连通分量检查：每个多节点分量至少有一条
 * 内部回向通道。同一对有序节点可以有多条通道，但 `back` 必须一致。
 */
function checkChannels(
  channels: readonly ChannelDefinition[],
  positions: readonly PositionDefinition[],
  issues: Issues,
): void {
  const nodes = new Set<string>([START_ID, END_ID, ...positions.map((position) => position.id)])
  const adjacency = new Map<string, Set<string>>()
  for (const node of nodes) adjacency.set(node, new Set())
  for (const channel of channels) {
    if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue
    adjacency.get(channel.from)?.add(channel.to)
  }
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [from]
    while (queue.length > 0) {
      const node = queue.pop() as string
      for (const next of adjacency.get(node) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    return seen
  }
  const reachability = new Map<string, Set<string>>()
  for (const node of nodes) reachability.set(node, reach(node))

  // 回向通道必须闭合：to 能回到 from 才算回向。
  for (const [index, channel] of channels.entries()) {
    if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue
    if (channel.back !== true) continue
    if (reachability.get(channel.to)?.has(channel.from) === true) continue
    issues.add(
      `channels[${index}].back`,
      `channel "${channel.id}" (${channel.from} -> ${channel.to}) does not close a cycle and cannot be marked back`,
    )
  }

  // 每个强连通分量（多节点）至少有一条内部回向通道。
  const grouped = new Set<string>()
  for (const node of nodes) {
    if (grouped.has(node)) continue
    const members = new Set<string>([node])
    for (const other of nodes) {
      if (other === node || grouped.has(other)) continue
      if (reachability.get(node)?.has(other) !== true) continue
      if (reachability.get(other)?.has(node) !== true) continue
      members.add(other)
    }
    if (members.size < 2) continue
    for (const member of members) grouped.add(member)
    const internal = channels.flatMap((channel, index) =>
      channel.back === true && members.has(channel.from) && members.has(channel.to) ? [index] : [],
    )
    if (internal.length > 0) continue
    const first = channels.findIndex(
      (channel) => members.has(channel.from) && members.has(channel.to),
    )
    const cycle = [...members].join(' -> ')
    issues.add(
      `channels[${Math.max(first, 0)}].back`,
      `cycle "${cycle}" has no explicit back channel: mark the channel that closes it with "back": true`,
    )
  }

  // 同一对有序节点的 back 必须一致：一条向前一条回向会自相矛盾。
  const pairs = new Map<string, Array<{ index: number; back: boolean; from: string; to: string }>>()
  for (const [index, channel] of channels.entries()) {
    if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue
    const key = `${channel.from}\u0000${channel.to}`
    const group = pairs.get(key)
    const item = { index, back: channel.back === true, from: channel.from, to: channel.to }
    if (group === undefined) pairs.set(key, [item])
    else group.push(item)
  }
  for (const group of pairs.values()) {
    const first = group[0]
    if (first === undefined || group.length < 2) continue
    for (const item of group.slice(1)) {
      if (item.back === first.back) continue
      issues.add(
        `channels[${item.index}].back`,
        `channels between "${item.from}" and "${item.to}" must agree on "back"`,
      )
    }
  }
}

/** 可达性：每个岗位都能从 start 到达，也能到达 end。 */
function checkReachability(
  channels: readonly ChannelDefinition[],
  positions: readonly PositionDefinition[],
  issues: Issues,
): void {
  const nodes = new Set<string>([START_ID, END_ID, ...positions.map((position) => position.id)])
  const forward = new Map<string, Set<string>>()
  const reverse = new Map<string, Set<string>>()
  for (const node of nodes) {
    forward.set(node, new Set())
    reverse.set(node, new Set())
  }
  for (const channel of channels) {
    if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue
    forward.get(channel.from)?.add(channel.to)
    reverse.get(channel.to)?.add(channel.from)
  }
  const fromStart = walkFrom(START_ID, forward)
  const toEnd = walkFrom(END_ID, reverse)
  for (const position of positions) {
    if (!fromStart.has(position.id)) {
      issues.add(
        `positions.${position.id}`,
        'is unreachable from the built-in start node: add a channel path from start',
      )
    }
    if (!toEnd.has(position.id)) {
      issues.add(
        `positions.${position.id}`,
        'cannot reach the built-in end node: add a channel path to end',
      )
    }
  }
}

/** 从某个节点出发的可达集合。 */
function walkFrom(from: string, adjacency: ReadonlyMap<string, Set<string>>): Set<string> {
  const seen = new Set<string>()
  const queue = [from]
  while (queue.length > 0) {
    const node = queue.pop() as string
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next) || next === from) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

/** 结束节点检查：至少一条入向通道；能派发结束任务的岗位必须与 end 有通道。 */
function checkEnd(
  channels: readonly ChannelDefinition[],
  positions: readonly PositionDefinition[],
  issues: Issues,
): void {
  const intoEnd = channels.flatMap((channel, index) =>
    channel.to === END_ID ? [{ channel, index }] : [],
  )
  if (intoEnd.length === 0) {
    issues.add('channels', 'at least one position must have a channel into the built-in end node')
  }
  for (const { channel, index } of intoEnd) {
    if (channel.from === START_ID) {
      issues.add(
        `channels[${index}].from`,
        'the start node cannot dispatch the end task; only positions can',
      )
      continue
    }
    if (positions.every((position) => position.id !== channel.from)) {
      issues.add(`channels[${index}].from`, `unknown position "${channel.from}"`)
    }
  }
}

/**
 * 判断一个任务类型是否允许某个派发（通道白名单）。
 *
 * 引擎创建任务时复用这里的规则。
 *
 * @param channel 通道
 * @param type 任务类型 id
 * @returns 允许时为 true
 */
export function channelAllowsType(channel: ChannelDefinition, type: string): boolean {
  return channel.types === undefined || channel.types.includes(type)
}

/**
 * 按 id 取一条通道。
 *
 * @param definition 定义
 * @param channelId 通道 id
 * @returns 通道；不存在时是 undefined
 */
export function findChannel(
  definition: WorkflowDefinition,
  channelId: string,
): ChannelDefinition | undefined {
  return definition.channels.find((channel) => channel.id === channelId)
}

/**
 * 从某个节点出发的全部通道。
 *
 * @param definition 定义
 * @param from 起点节点 id
 * @returns 通道列表
 */
export function channelsFrom(definition: WorkflowDefinition, from: string): ChannelDefinition[] {
  return definition.channels.filter((channel) => channel.from === from)
}

/**
 * 按岗位 id 取岗位。
 *
 * @param definition 定义
 * @param positionId 岗位 id
 * @returns 岗位；不存在时是 undefined
 */
export function findPosition(
  definition: WorkflowDefinition,
  positionId: string,
): PositionDefinition | undefined {
  return definition.positions.find((position) => position.id === positionId)
}

/**
 * 按任务类型 id 取类型定义。
 *
 * @param definition 定义
 * @param typeId 任务类型 id
 * @returns 任务类型；不存在时是 undefined
 */
export function findTaskType(
  definition: WorkflowDefinition,
  typeId: string,
): TaskTypeDefinition | undefined {
  for (const position of definition.positions) {
    for (const taskType of position.taskTypes) {
      if (taskType.id === typeId) return taskType
    }
  }
  return undefined
}

/**
 * 按 schema 校验任务内容，返回带路径的问题列表。
 *
 * 引擎创建任务时复用：模板子树只做结构检查，类型与枚举留给创建之后。
 *
 * @param schema 任务类型的 content schema
 * @param value 待校验的任务内容
 * @returns 问题列表；空数组表示通过
 */
export function contentIssues(schema: JsonSchema, value: unknown): DefinitionIssue[] {
  const issues = new Issues()
  checkTemplatedContent(schema, value, 'content', issues)
  return issues.list
}
