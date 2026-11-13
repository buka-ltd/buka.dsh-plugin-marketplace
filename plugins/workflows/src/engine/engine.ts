/**
 * 工作流引擎：作业创建、调度、执行、派发校验、结算、取消、重试与恢复。
 *
 * 设计要点（`.tmp/workflow-v4-spec.md` §6-§12、ADR 0006-0012）：
 *
 * - 任务是唯一执行单元；任务依赖纯显式，依赖图无环；
 * - 一个智能体岗位一次只跑一条任务（FIFO），机器人直接完成，
 *   人任务由被点名的助理承办或停在「待认领」；
 * - 记状态变更全部串行化到 per-job 队列；长等待的会话 / 定时器在队列外执行，
 *   完成时再回队列提交状态；
 * - 一个任务一条新会话，不复用、不压缩；重启时只续接同一条会话。
 *
 * @module @buka/dsh-plugin-workflows/engine
 */

import { randomUUID } from 'node:crypto'
import {
  clipUtf8,
  ingestAttachments,
  readInlineText,
  resolveAttachmentFile,
  searchAttachments,
  visibleTaskIds,
} from '../attachments/index.ts'
import { validateWorkflowDefinition } from '../definition/validate.ts'
import { newAttemptId, newJobId, nowIso, START_TASK_ID } from '../domain/ids.ts'
import {
  assertJobTransition,
  assertTaskTransition,
  canTransitionTask,
  isOpenTaskStatus,
  isTerminalJobStatus,
} from '../domain/status.ts'
import type {
  AttachmentRecord,
  AttemptRecord,
  Claimant,
  JobRecord,
  JsonValue,
  Starter,
  TaskRecord,
  TaskStatus,
  WorkerInfo,
  WorkflowDefinition,
  WorkflowRecord,
} from '../domain/types.ts'
import type { ResolvedOptions } from '../options.ts'
import { schemaProblems } from '../output.ts'
import { programDriver } from '../program/clock.ts'
import type { LoggerLike, WorkflowStore } from '../store/index.ts'
import {
  canRetryDelivery,
  jobDefinition,
  jobSummary,
  taskDetail,
  taskSummary,
  workflowGraph,
} from './board.ts'
import { appendJobEvent } from './events.ts'
import {
  buildAssistantPrompt,
  buildEndDeliveryText,
  buildExecutionPrompt,
  buildStartTaskPrompt,
  positionOf,
  renderTaskPayload,
  taskTypeLabel,
} from './prompt.ts'
import { handleSessionId, handleStartSeq, poll, readHandleResult } from './session.ts'
import { buildCreatedTask, buildInitialTasks } from './tasks.ts'
import type { EngineDeps, TurnSnapshot, WorkerHandleLike, WorkersServiceLike } from './types.ts'
import { describeError, WorkflowError } from './types.ts'

/** 任务结果文本在记录里的预览上限。 */
const RESULT_PREVIEW_BYTES = 4096

/** 打工人登记表缓存时间。 */
const WORKER_CACHE_MS = 5000

/** 一次等待中的执行。 */
interface ActiveExecution {
  readonly jobId: string
  readonly taskId: string
  readonly attemptId: string
  readonly kind: 'agent' | 'assistant' | 'program' | 'start'
  sessionId: string | null
  handle: WorkerHandleLike | null
  stopPoll: (() => void) | null
  readonly controller: AbortController
  timeout: NodeJS.Timeout | null
}

/** 调度产生的启动任务：在队列外执行，完成后回队列提交状态。 */
type Launch =
  | {
      readonly kind: 'agent' | 'assistant'
      readonly jobId: string
      readonly taskId: string
      readonly attemptId: string
      readonly worker: string
      readonly prompt: string
      readonly planMode: boolean
    }
  | {
      readonly kind: 'program'
      readonly jobId: string
      readonly taskId: string
      readonly attemptId: string
      readonly programId: string
    }
  | {
      readonly kind: 'start'
      readonly jobId: string
      readonly taskId: string
      readonly attemptId: string
      readonly sessionId: string
      readonly prompt: string
    }
  | {
      readonly kind: 'delivery'
      readonly jobId: string
      readonly taskId: string
      readonly attemptId: string
    }

/** 引擎构造参数。 */
export interface WorkflowEngineOptions extends EngineDeps {}

/** 从 workers 服务读登记表，转成本插件关心的形状。 */
function parseWorkerCatalog(raw: unknown): Map<string, WorkerInfo> {
  const catalog = new Map<string, WorkerInfo>()
  const entries = Array.isArray(raw)
    ? raw
    : raw !== null &&
        typeof raw === 'object' &&
        Array.isArray((raw as { workers?: unknown }).workers)
      ? ((raw as { workers?: unknown[] }).workers ?? [])
      : []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (name === '') continue
    // 旧版 workers 服务把固定程序驱动写成 program；新版写成 robot。两者都按机器人处理。
    const driver = record.driver === 'robot' || record.driver === 'program' ? 'robot' : 'agent'
    catalog.set(name, {
      name,
      driver,
      ...(typeof record.program === 'string' && record.program !== ''
        ? { program: record.program }
        : {}),
      assistant: record.assistant === true,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      ...(typeof record.avatar === 'string' ? { avatar: record.avatar } : {}),
      ...(typeof record.path === 'string' && record.path !== '' ? { path: record.path } : {}),
    })
  }
  return catalog
}

/** 一句话输入摘要。 */
function summarizeInput(input: JsonValue): string {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const request = (input as Record<string, JsonValue>).request
    if (typeof request === 'string' && request.trim() !== '') {
      return clipUtf8(request.trim(), 240)
    }
  }
  return clipUtf8(JSON.stringify(input), 240)
}

/** 引擎。 */
export class WorkflowEngine {
  private readonly store: WorkflowStore
  private readonly options: ResolvedOptions
  private readonly logger: LoggerLike | undefined
  private readonly workersOf: () => WorkersServiceLike | null
  private readonly delivery: EngineDeps['delivery']
  private readonly active = new Map<string, ActiveExecution>()
  private readonly sessionTasks = new Map<string, { jobId: string; taskId: string }>()
  private readonly busyAssistants = new Set<string>()
  private readonly deliveryBlocked = new Set<string>()
  private catalog = new Map<string, WorkerInfo>()
  private catalogAt = 0
  private started = false
  private disposed = false

  constructor(deps: EngineDeps) {
    this.store = deps.store
    this.options = deps.options
    this.logger = deps.logger
    this.workersOf = deps.workers
    this.delivery = deps.delivery
  }

  // ---------------------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------------------

  /** 启动引擎：刷新打工人登记表并恢复未完成的作业。 */
  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    await this.refreshWorkers(true)
    await this.recover()
  }

  /** 停掉所有等待中的执行与定时器。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const execution of this.active.values()) {
      execution.stopPoll?.()
      if (execution.timeout !== null) clearTimeout(execution.timeout)
      execution.controller.abort()
      try {
        if (execution.handle !== null && typeof execution.handle.cancel === 'function') {
          void execution.handle.cancel('host is shutting down')
        }
      } catch {
        // 已释放：忽略。
      }
      this.disposeHandle(execution.handle)
    }
    this.active.clear()
    this.sessionTasks.clear()
  }

  /** 释放一个 workers 句柄。 */
  private disposeHandle(handle: WorkerHandleLike | null): void {
    if (handle === null) return
    try {
      if (typeof handle.dispose === 'function') void handle.dispose()
    } catch {
      // 已释放：忽略。
    }
  }

  /**
   * 刷新打工人登记表（默认 5s 缓存）。
   *
   * 空表不缓存：workers 插件可能晚于本插件注册服务，缓存空表会让定义图 / 作业页
   * 一直拿不到头像，直到某个写操作恰好触发下一次刷新。
   */
  private async refreshWorkers(force = false): Promise<Map<string, WorkerInfo>> {
    if (!force && this.catalog.size > 0 && Date.now() - this.catalogAt < WORKER_CACHE_MS) {
      return this.catalog
    }
    const workers = this.workersOf()
    if (workers === null) {
      this.catalog = new Map()
      this.catalogAt = Date.now()
      return this.catalog
    }
    try {
      const listed = typeof workers.list === 'function' ? await workers.list() : undefined
      this.catalog = parseWorkerCatalog(listed ?? workers)
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: could not read the workers registry: ${describeError(error)}`,
      )
      this.catalog = new Map()
    }
    this.catalogAt = Date.now()
    return this.catalog
  }

  /** 取打工人登记表（按名字）。 */
  private async workers(): Promise<Map<string, WorkerInfo>> {
    return await this.refreshWorkers()
  }

  // ---------------------------------------------------------------------
  // 工作流
  // ---------------------------------------------------------------------

  /**
   * 校验并保存工作流定义：没有 id 时新建（默认启用），有 id 时追加一个版本。
   *
   * @param input 定义与可选工作流 id
   * @returns 保存后的工作流记录
   */
  async saveWorkflow(input: {
    readonly definition: unknown
    readonly workflowId?: string | undefined
  }): Promise<WorkflowRecord> {
    const workers = await this.workers()
    const validated = validateWorkflowDefinition(input.definition, { workers })
    if (!validated.ok) {
      throw new WorkflowError(
        'invalid-definition',
        validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'),
      )
    }
    const definition = validated.definition
    if (input.workflowId !== undefined && input.workflowId !== '') {
      const existing = this.store.getWorkflow(input.workflowId)
      if (existing === undefined) {
        throw new WorkflowError('not-found', `workflow not found: ${input.workflowId}`)
      }
      return await this.store.saveWorkflowVersion(input.workflowId, definition)
    }
    return await this.store.createWorkflow({
      name: definition.name,
      description: definition.description ?? '',
      definition,
      status: 'active',
    })
  }

  /**
   * 工作流列表投影。
   *
   * @returns 工作流摘要
   */
  listWorkflowSummaries(): Record<string, unknown>[] {
    return this.store.listWorkflows().map((workflow) => {
      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.latestVersion,
        status: workflow.status,
        jobCount: this.store.countJobs(workflow.id),
        updatedAt: workflow.updatedAt,
      }
    })
  }

  /**
   * 读工作流详情（含某个版本的完整定义）。
   *
   * 展示投影要在读取时刷新打工人登记表：图上岗位头像来自 workers 服务，而服务
   * 可能晚于本插件就绪。
   *
   * @param workflowId 工作流 id
   * @param version 版本；省略取最新
   * @returns 工作流详情；不存在时 null
   */
  async readWorkflowDetail(
    workflowId: string,
    version?: number,
  ): Promise<Record<string, unknown> | null> {
    const found = this.store.readWorkflowVersion(workflowId, version)
    if (found === null) return null
    const workers = await this.workers()
    const jobs = this.store
      .listJobs(workflowId)
      .map((job) => jobSummary(job, this.store.listTasks(job.id)))
    return {
      workflow: {
        id: found.record.id,
        name: found.versionRecord.definition.name,
        description: found.versionRecord.definition.description ?? '',
        version: found.version,
        status: found.record.status,
        definition: found.versionRecord.definition,
      },
      graph: workflowGraph(found.versionRecord.definition, workers),
      jobs,
    }
  }

  /**
   * 停用 / 重新启用工作流。
   *
   * @param workflowId 工作流 id
   * @param active 是否可用
   * @returns 更新后的记录
   */
  async setWorkflowActive(workflowId: string, active: boolean): Promise<WorkflowRecord> {
    const existing = this.store.getWorkflow(workflowId)
    if (existing === undefined)
      throw new WorkflowError('not-found', `workflow not found: ${workflowId}`)
    return await this.store.activateWorkflow(workflowId, active)
  }

  // ---------------------------------------------------------------------
  // 作业创建
  // ---------------------------------------------------------------------

  /**
   * 页面人启动作业：原始输入与结构化输入一起提交，启动任务即刻完成。
   *
   * @param input 工作流、原始输入与结构化输入
   * @returns 新作业
   */
  async createJobFromHuman(input: {
    readonly workflowId: string
    readonly rawInput: JsonValue
    readonly structuredInput: JsonValue
  }): Promise<JobRecord> {
    const { workflow, definition } = this.requireStartableWorkflow(input.workflowId)
    const workers = await this.workers()
    const inputProblems = schemaProblems(definition.start.task.payload, input.rawInput)
    if (inputProblems.length > 0) {
      throw new WorkflowError('invalid-input', `raw input: ${inputProblems.join('; ')}`)
    }
    const structuredProblems = schemaProblems(definition.start.task.output, input.structuredInput)
    if (structuredProblems.length > 0) {
      throw new WorkflowError('invalid-input', `structured input: ${structuredProblems.join('; ')}`)
    }
    const job = await this.insertJob({
      workflow,
      definition,
      starter: { kind: 'human' },
      rawInput: input.rawInput,
      structuredInput: input.structuredInput,
    })
    try {
      await this.store.runExclusive(job.id, async () => {
        const now = nowIso()
        const startTask: TaskRecord = {
          id: START_TASK_ID,
          jobId: job.id,
          position: 'start',
          type: 'start',
          payload: input.rawInput,
          deps: [],
          status: 'completed',
          createdBy: null,
          assignee: { kind: 'human' },
          claimant: { kind: 'human', name: '本地用户', sessionId: null },
          attemptIds: [],
          result: {
            output: input.structuredInput,
            text: '',
            textBytes: 0,
            textFile: null,
            attachmentIds: [],
          },
          error: null,
          assistantBlocked: false,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
          updatedAt: now,
        }
        await this.store.insertTask(startTask)
        await this.appendEvent(job.id, 'job/created', { seq: job.seq, starter: 'human' })
        await this.appendEvent(job.id, 'task/completed', { taskId: startTask.id, type: 'start' })
        const initial = buildInitialTasks({
          job,
          startTask,
          tasks: [startTask],
          workers,
        })
        for (const task of initial) {
          await this.store.insertTask(task)
          await this.appendEvent(job.id, 'task/created', {
            taskId: task.id,
            position: task.position,
            type: task.type,
            deps: task.deps,
          })
        }
        await this.recomputeLocked(job.id)
      })
    } catch (error) {
      await this.store
        .updateJob(job.id, (current) => ({
          ...current,
          status: 'failed',
          error: describeError(error),
          finishedAt: nowIso(),
          updatedAt: nowIso(),
        }))
        .catch(() => undefined)
      throw error
    }
    const updated = this.store.getJob(job.id) ?? job
    return updated
  }

  /**
   * 会话启动作业：启动任务回到启动者会话执行（下一轮 agent 提交结构化输入）。
   *
   * @param input 工作流、原始输入与启动者会话
   * @returns 新作业
   */
  async createJobFromSession(input: {
    readonly workflowId: string
    readonly rawInput: JsonValue
    readonly sessionId: string
  }): Promise<JobRecord> {
    const { workflow, definition } = this.requireStartableWorkflow(input.workflowId)
    const inputProblems = schemaProblems(definition.start.task.payload, input.rawInput)
    if (inputProblems.length > 0) {
      throw new WorkflowError('invalid-input', `raw input: ${inputProblems.join('; ')}`)
    }
    const job = await this.insertJob({
      workflow,
      definition,
      starter: { kind: 'session', sessionId: input.sessionId },
      rawInput: input.rawInput,
    })
    await this.store.runExclusive(job.id, async () => {
      const now = nowIso()
      const startTask: TaskRecord = {
        id: START_TASK_ID,
        jobId: job.id,
        position: 'start',
        type: 'start',
        payload: input.rawInput,
        deps: [],
        status: 'pending',
        createdBy: null,
        assignee: { kind: 'session', sessionId: input.sessionId },
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
      await this.store.insertTask(startTask)
      await this.appendEvent(job.id, 'job/created', { seq: job.seq, starter: 'session' })
      await this.recomputeLocked(job.id)
    })
    return this.store.getJob(job.id) ?? job
  }

  /** 取一个可启动的工作流：必须存在且未停用。 */
  private requireStartableWorkflow(workflowId: string): {
    workflow: WorkflowRecord
    definition: WorkflowDefinition
  } {
    const found = this.store.readWorkflowVersion(workflowId)
    if (found === null) throw new WorkflowError('not-found', `workflow not found: ${workflowId}`)
    if (found.record.status !== 'active') {
      throw new WorkflowError(
        'workflow-retired',
        `workflow "${found.record.name}" is not enabled; enable it before starting a job`,
      )
    }
    return { workflow: found.record, definition: found.versionRecord.definition }
  }

  /** 插入作业记录。 */
  private async insertJob(input: {
    readonly workflow: WorkflowRecord
    readonly definition: WorkflowDefinition
    readonly starter: Starter
    readonly rawInput: JsonValue
    readonly structuredInput?: JsonValue | undefined
  }): Promise<JobRecord> {
    const seq = await this.store.allocateJobSeq(input.workflow.id)
    const now = nowIso()
    const found = this.store.readWorkflowVersion(input.workflow.id)
    const version = found?.version ?? input.workflow.latestVersion
    const job: JobRecord = {
      id: newJobId(),
      seq,
      workflowId: input.workflow.id,
      workflowVersion: version,
      workflowName: input.definition.name,
      workflowDescription: input.definition.description ?? '',
      definition: input.definition,
      status: 'running',
      starter: input.starter,
      input: {
        raw: input.rawInput,
        ...(input.structuredInput === undefined ? {} : { structured: input.structuredInput }),
      },
      inputSummary: summarizeInput(input.rawInput),
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    }
    await this.store.ensureJobDirectories(job.id)
    await this.store.insertJob(job)
    return job
  }

  // ---------------------------------------------------------------------
  // 只读投影
  // ---------------------------------------------------------------------

  /**
   * 作业详情（契约形状）。
   *
   * 与工作流详情一样，展示投影在读取时刷新打工人登记表，让岗位头像保持最新。
   *
   * @param jobId 作业 id
   * @returns 作业详情；不存在时 null
   */
  async jobDetail(jobId: string): Promise<Record<string, unknown> | null> {
    const job = this.store.getJob(jobId)
    if (job === undefined) return null
    const workers = await this.workers()
    const tasks = this.store.listTasks(jobId)
    return {
      job: {
        id: job.id,
        seq: job.seq,
        status: job.status,
        workflowId: job.workflowId,
        workflowName: job.workflowName,
        workflowVersion: job.workflowVersion,
        starter: job.starter,
        input: job.input,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        error: job.error,
      },
      definition: jobDefinition(job.definition, workers),
      tasks: tasks.map((task) => taskSummary(task, job.definition)),
      canRetryDelivery: canRetryDelivery(tasks),
    }
  }

  /**
   * 作业列表（某个工作流下）。
   *
   * @param workflowId 工作流 id
   * @returns 作业摘要
   */
  listJobSummaries(workflowId: string): Record<string, unknown>[] {
    return this.store
      .listJobs(workflowId)
      .map((job) => jobSummary(job, this.store.listTasks(job.id)))
  }

  /**
   * 任务详情（契约形状）。
   *
   * @param jobId 作业 id
   * @param taskId 任务 id
   * @returns 任务详情；不存在时 null
   */
  taskDetail(jobId: string, taskId: string): Record<string, unknown> | null {
    const job = this.store.getJob(jobId)
    if (job === undefined) return null
    const task = this.store.getTask(taskId)
    if (task === undefined || task.jobId !== jobId) return null
    return taskDetail({
      job,
      task,
      tasks: this.store.listTasks(jobId),
      attempts: this.store.listAttempts(taskId),
      attachments: this.store.listAttachments(jobId),
    })
  }

  /**
   * 作业附件库（页面展示全部附件与来源任务）。
   *
   * @param jobId 作业 id
   * @returns 附件元数据
   */
  listJobAttachments(jobId: string): AttachmentRecord[] {
    return this.store.listAttachments(jobId)
  }

  /**
   * 取附件元数据（路由下载 / 预览用）。
   *
   * @param jobId 作业 id
   * @param attachmentId 附件 id
   * @returns 附件文件与元数据；不存在时 null
   */
  openAttachment(
    jobId: string,
    attachmentId: string,
  ): { readonly record: AttachmentRecord; readonly file: string } | null {
    const record = this.store.getAttachment(attachmentId)
    if (record === undefined || record.jobId !== jobId) return null
    try {
      return {
        record,
        file: resolveAttachmentFile(this.store.paths(jobId).root, record.path),
      }
    } catch {
      return null
    }
  }

  /**
   * 执行会话可见的附件检索结果。
   *
   * @param sessionId 会话 id
   * @param query 关键词
   * @returns 可见附件
   */
  searchAttachmentsForSession(sessionId: string, query: string): AttachmentRecord[] {
    const reference = this.sessionTasks.get(sessionId)
    if (reference === undefined) return []
    const tasks = this.store.listTasks(reference.jobId)
    const visible = visibleTaskIds(tasks, reference.taskId)
    const attachments = this.store.listAttachments(reference.jobId)
    return searchAttachments(
      attachments,
      new Set(attachments.map((item) => item.id)),
      query,
    ).filter((attachment) => visible.has(attachment.sourceTaskId))
  }

  /**
   * 执行会话按 id 读取一个可见附件（元数据 + 有界文本）。
   *
   * @param sessionId 会话 id
   * @param attachmentId 附件 id
   * @returns 附件信息；不可见 / 不存在时 null
   */
  async readAttachmentForSession(
    sessionId: string,
    attachmentId: string,
  ): Promise<Record<string, unknown> | null> {
    const reference = this.sessionTasks.get(sessionId)
    if (reference === undefined) return null
    const tasks = this.store.listTasks(reference.jobId)
    const visible = visibleTaskIds(tasks, reference.taskId)
    const record = this.store.getAttachment(attachmentId)
    if (record === undefined || record.jobId !== reference.jobId) return null
    if (!visible.has(record.sourceTaskId)) return null
    const base = {
      id: record.id,
      name: record.name,
      bytes: record.bytes,
      mime: record.mime,
      description: record.description,
      sourceTaskId: record.sourceTaskId,
      sourcePositionId: record.sourcePositionId,
      createdAt: record.createdAt,
    }
    try {
      const file = resolveAttachmentFile(this.store.paths(record.jobId).root, record.path)
      const inline = await readInlineText(file, this.options.maxInlineAttachmentBytes)
      return {
        ...base,
        ...(inline.available ? { text: inline.text } : { reason: inline.reason ?? 'binary' }),
      }
    } catch {
      return { ...base, reason: 'unreadable' }
    }
  }

  /**
   * 一个会话正在执行的任务（工具可见性 / 结果收口用）。
   *
   * @param sessionId 会话 id
   * @returns 作业与任务 id；没有时 null
   */
  taskForSession(sessionId: string): { jobId: string; taskId: string } | null {
    return this.sessionTasks.get(sessionId) ?? null
  }

  /**
   * 某个会话作为启动者的作业 id（最近创建的优先）。
   *
   * @param sessionId 会话 id
   * @returns 作业 id；没有时 null
   */
  jobIdForSession(sessionId: string): string | null {
    let found: JobRecord | null = null
    for (const job of this.store.allJobs()) {
      if (job.starter.kind !== 'session' || job.starter.sessionId !== sessionId) continue
      if (found === null || job.createdAt > found.createdAt) found = job
    }
    return found?.id ?? null
  }

  /**
   * 会话能否查看某个作业（启动者或执行中的任务会话）。
   *
   * @param sessionId 会话 id
   * @param jobId 作业 id
   * @returns 可以查看时为 true
   */
  canViewJob(sessionId: string, jobId: string): boolean {
    const reference = this.sessionTasks.get(sessionId)
    if (reference !== undefined) return reference.jobId === jobId
    return this.jobIdForSession(sessionId) === jobId
  }

  // ---------------------------------------------------------------------
  // 任务动作
  // ---------------------------------------------------------------------

  /**
   * 执行中的任务创建派生任务。
   *
   * @param input 会话、目标岗位、类型、payload 与依赖
   * @returns 新任务
   */
  async createTaskFromSession(input: {
    readonly sessionId: string
    readonly position: string
    readonly type: string
    readonly payload: JsonValue
    readonly deps: readonly string[]
  }): Promise<TaskRecord> {
    const reference = this.sessionTasks.get(input.sessionId)
    if (reference === undefined) {
      throw new WorkflowError(
        'no-task',
        'this session is not executing a workflow task; only an executing task can create tasks',
      )
    }
    const workers = await this.workers()
    return await this.store.runExclusive(reference.jobId, async () => {
      const job = this.store.getJob(reference.jobId)
      if (job === undefined) throw new WorkflowError('not-found', 'job not found')
      const tasks = this.store.listTasks(job.id)
      const creator = tasks.find((task) => task.id === reference.taskId)
      if (creator === undefined) throw new WorkflowError('not-found', 'task not found')
      const created = buildCreatedTask({
        job,
        creator,
        position: input.position,
        type: input.type,
        payload: input.payload,
        deps: input.deps,
        tasks,
        workers,
      })
      await this.store.insertTask(created.task)
      await this.appendEvent(job.id, 'task/created', {
        taskId: created.task.id,
        position: created.task.position,
        type: created.task.type,
        deps: created.task.deps,
        createdBy: creator.id,
      })
      await this.recomputeLocked(job.id)
      return this.store.getTask(created.task.id) ?? created.task
    })
  }

  /**
   * 执行中的任务 / 助理提交结果。
   *
   * @param input 会话、结构化结果、文本与附件
   * @returns 任务与作业的最新状态
   */
  async completeTaskFromSession(input: {
    readonly sessionId: string
    readonly output: JsonValue
    readonly text: string
    readonly attachments: unknown
  }): Promise<{ task: TaskRecord; job: JobRecord }> {
    const reference = this.sessionTasks.get(input.sessionId)
    if (reference === undefined) {
      throw new WorkflowError('no-task', 'this session is not executing a workflow task')
    }
    return await this.store.runExclusive(reference.jobId, async () => {
      const job = this.store.getJob(reference.jobId)
      if (job === undefined) throw new WorkflowError('not-found', 'job not found')
      const task = this.store.getTask(reference.taskId)
      if (task === undefined) throw new WorkflowError('not-found', 'task not found')
      if (task.status !== 'running') {
        throw new WorkflowError(
          'task-not-running',
          `task ${task.id} is ${task.status}; it cannot be completed again`,
        )
      }
      if (task.id === START_TASK_ID) {
        const planned = this.store.listTasks(job.id).length + job.definition.start.next.length
        if (planned + 1 > job.definition.budgets.maxTasks) {
          throw new WorkflowError(
            'budget-exceeded',
            `workflow budget maxTasks=${job.definition.budgets.maxTasks} would be exceeded by the initial tasks`,
          )
        }
      }
      const problems = this.outputProblemsFor(job, task, input.output)
      if (problems.length > 0) {
        throw new WorkflowError(
          'invalid-output',
          `output does not match the task contract: ${problems.join('; ')}`,
        )
      }
      const claimant = task.claimant
      const workspace = this.workspaceFor(task)
      const updated = await this.completeTaskLocked(job, task, {
        output: input.output,
        text: input.text,
        attachments: input.attachments,
        workspace,
        createdBy: claimant?.name ?? '执行者',
      })
      this.sessionTasks.delete(input.sessionId)
      await this.recomputeLocked(job.id)
      return { task: updated, job: this.store.getJob(job.id) ?? job }
    })
  }

  /**
   * 页面：人认领一条待认领任务。
   *
   * @param jobId 作业 id
   * @param taskId 任务 id
   * @returns 更新后的任务
   */
  async claimTaskAsHuman(jobId: string, taskId: string): Promise<TaskRecord> {
    return await this.store.runExclusive(jobId, async () => {
      const job = this.requireRunningJob(jobId)
      const task = this.requireTask(jobId, taskId)
      if (task.assignee.kind !== 'human') {
        throw new WorkflowError('not-human-task', `task ${taskId} is not a human task`)
      }
      if (task.status !== 'ready') {
        throw new WorkflowError(
          'not-ready',
          `task ${taskId} is ${task.status}; only ready tasks can be claimed`,
        )
      }
      assertTaskTransition(taskId, task.status, 'running')
      const now = nowIso()
      const attemptId = newAttemptId()
      const attempt: AttemptRecord = {
        id: attemptId,
        jobId,
        taskId,
        sessionId: null,
        startSeq: null,
        status: 'running',
        stopReason: null,
        error: null,
        promptFile: null,
        startedAt: now,
        finishedAt: null,
      }
      await this.store.insertAttempt(attempt)
      const updated = await this.store.updateTask(taskId, (current) => ({
        ...current,
        status: 'running',
        claimant: { kind: 'human', name: '本地用户', sessionId: null },
        attemptIds: [...current.attemptIds, attemptId],
        startedAt: current.startedAt ?? now,
        updatedAt: now,
      }))
      await this.appendEvent(jobId, 'task/claimed', { taskId, claimant: 'human' })
      await this.recomputeLocked(job.id)
      return updated
    })
  }

  /**
   * 页面：人填表提交一条人任务。
   *
   * @param input 作业、任务、结构化结果、文本与附件
   * @returns 更新后的任务
   */
  async completeTaskAsHuman(input: {
    readonly jobId: string
    readonly taskId: string
    readonly output: JsonValue
    readonly text: string
    readonly attachments: unknown
  }): Promise<TaskRecord> {
    return await this.store.runExclusive(input.jobId, async () => {
      const job = this.requireRunningJob(input.jobId)
      const task = this.requireTask(input.jobId, input.taskId)
      if (task.assignee.kind !== 'human') {
        throw new WorkflowError('not-human-task', `task ${input.taskId} is not a human task`)
      }
      if (task.status !== 'running' && task.status !== 'ready') {
        throw new WorkflowError(
          'invalid-status',
          `task ${input.taskId} is ${task.status}; a human task can only be completed from ready/running`,
        )
      }
      let prepared = task
      if (task.status === 'ready') {
        const now = nowIso()
        const attempt: AttemptRecord = {
          id: newAttemptId(),
          jobId: job.id,
          taskId: task.id,
          sessionId: null,
          startSeq: null,
          status: 'running',
          stopReason: null,
          error: null,
          promptFile: null,
          startedAt: now,
          finishedAt: null,
        }
        await this.store.insertAttempt(attempt)
        prepared = await this.store.updateTask(task.id, (current) => ({
          ...current,
          claimant: { kind: 'human', name: '本地用户', sessionId: null },
          attemptIds: [...current.attemptIds, attempt.id],
          updatedAt: now,
        }))
      }
      const problems = this.outputProblemsFor(job, prepared, input.output)
      if (problems.length > 0) {
        throw new WorkflowError(
          'invalid-output',
          `output does not match the task contract: ${problems.join('; ')}`,
        )
      }
      const updated = await this.completeTaskLocked(job, prepared, {
        output: input.output,
        text: input.text,
        attachments: input.attachments,
        workspace: undefined,
        createdBy: '本地用户',
      })
      await this.recomputeLocked(job.id)
      return updated
    })
  }

  /**
   * 取消一条任务。
   *
   * @param jobId 作业 id
   * @param taskId 任务 id
   * @returns 更新后的任务
   */
  async cancelTask(jobId: string, taskId: string): Promise<TaskRecord> {
    return await this.store.runExclusive(jobId, async () => {
      const job = this.requireRunningJob(jobId, true)
      const task = this.requireTask(jobId, taskId)
      if (task.status === 'completed' || task.status === 'cancelled') {
        throw new WorkflowError('invalid-status', `task ${taskId} is already ${task.status}`)
      }
      assertTaskTransition(taskId, task.status, 'cancelled')
      const now = nowIso()
      this.cancelActive(taskId, 'task was cancelled')
      const updated = await this.store.updateTask(taskId, (current) => ({
        ...current,
        status: 'cancelled',
        finishedAt: now,
        updatedAt: now,
      }))
      await this.closeRunningAttempts(taskId, 'cancelled', 'task was cancelled')
      this.dropSessionTask(taskId)
      await this.appendEvent(jobId, 'task/cancelled', { taskId })
      await this.recomputeLocked(job.id)
      return updated
    })
  }

  /**
   * 重试一条技术失败的任务：新增一次执行记录。
   *
   * @param jobId 作业 id
   * @param taskId 任务 id
   * @returns 更新后的任务
   */
  async retryTask(jobId: string, taskId: string): Promise<TaskRecord> {
    return await this.store.runExclusive(jobId, async () => {
      const job = this.requireRunningJob(jobId)
      const task = this.requireTask(jobId, taskId)
      if (task.status !== 'failed') {
        throw new WorkflowError(
          'not-failed',
          `task ${taskId} is ${task.status}; only failed tasks can be retried`,
        )
      }
      assertTaskTransition(taskId, 'failed', 'ready')
      const updated = await this.store.updateTask(taskId, (current) => ({
        ...current,
        status: 'ready',
        error: null,
        claimant: null,
        assistantBlocked: false,
        finishedAt: null,
        updatedAt: nowIso(),
      }))
      await this.appendEvent(jobId, 'task/retried', { taskId })
      await this.recomputeLocked(job.id)
      return updated
    })
  }

  /**
   * 取消作业：取消全部非终态任务。
   *
   * @param jobId 作业 id
   * @returns 更新后的作业
   */
  async cancelJob(jobId: string): Promise<JobRecord> {
    return await this.store.runExclusive(jobId, async () => {
      const job = this.store.getJob(jobId)
      if (job === undefined) throw new WorkflowError('not-found', `job not found: ${jobId}`)
      if (isTerminalJobStatus(job.status)) return job
      assertJobTransition(jobId, job.status, 'cancelled')
      const now = nowIso()
      for (const task of this.store.listTasks(jobId)) {
        if (!isOpenTaskStatus(task.status)) continue
        this.cancelActive(task.id, 'job was cancelled')
        if (task.claimant?.kind === 'assistant') this.busyAssistants.delete(task.claimant.name)
        await this.store.updateTask(task.id, (current) => ({
          ...current,
          status: 'cancelled',
          finishedAt: now,
          updatedAt: now,
        }))
        await this.closeRunningAttempts(task.id, 'cancelled', 'job was cancelled')
        this.dropSessionTask(task.id)
      }
      const updated = await this.store.updateJob(jobId, (current) => ({
        ...current,
        status: 'cancelled',
        error: null,
        finishedAt: now,
        updatedAt: now,
      }))
      await this.appendEvent(jobId, 'job/cancelled', {})
      return updated
    })
  }

  /**
   * 页面：重试结束任务投递。
   *
   * @param jobId 作业 id
   * @returns 更新后的作业
   */
  async retryDelivery(jobId: string): Promise<JobRecord> {
    return await this.store.runExclusive(jobId, async () => {
      const job = this.requireRunningJob(jobId)
      const tasks = this.store.listTasks(jobId)
      const endTasks = tasks.filter((task) => task.position === 'end' && task.status === 'ready')
      if (endTasks.length === 0) {
        throw new WorkflowError(
          'no-pending-delivery',
          'this job has no end task waiting for delivery',
        )
      }
      for (const task of endTasks) this.deliveryBlocked.delete(task.id)
      await this.appendEvent(jobId, 'delivery/retry', { taskIds: endTasks.map((task) => task.id) })
      await this.recomputeLocked(job.id)
      return this.store.getJob(job.id) ?? job
    })
  }

  // ---------------------------------------------------------------------
  // 恢复
  // ---------------------------------------------------------------------

  /** 重启恢复：重建调度、续接 running 任务、补算 clock、重试交付。 */
  private async recover(): Promise<void> {
    const jobs = this.store.allJobs().filter((job) => job.status === 'running')
    for (const job of jobs) {
      try {
        await this.store.runExclusive(job.id, async () => {
          await this.recoverJobLocked(job.id)
        })
      } catch (error) {
        this.logger?.warn?.(
          `buka-workflows: could not recover job ${job.id}: ${describeError(error)}`,
        )
      }
    }
  }

  /** 恢复一个作业：running 任务续接 / 失败，然后重新调度。 */
  private async recoverJobLocked(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId)
    if (job === undefined || job.status !== 'running') return
    for (const task of this.store.listTasks(jobId)) {
      if (task.status !== 'running') continue
      const attempt = this.store.listAttempts(task.id).find((entry) => entry.status === 'running')
      if (attempt !== undefined) {
        await this.store.updateAttempt(attempt.id, (current) => ({
          ...current,
          status: 'failed',
          error: 'host restarted while this attempt was running',
          finishedAt: nowIso(),
        }))
      }
      if (task.position === 'start') {
        // 启动任务：重新把提示词投进启动者会话；失败则任务失败。
        const starter = job.starter
        if (starter.kind === 'session' && attempt !== undefined) {
          void this.resumeStartTask(job, task, attempt)
          continue
        }
        await this.failTaskLocked(jobId, task.id, 'host restarted before the start task finished')
        continue
      }
      if (task.position === 'end') {
        // 结束任务不占用 running：正常不会走到这里。
        continue
      }
      const executor = task.assignee
      if (executor.kind === 'worker' && executor.driver === 'robot') {
        if (attempt !== undefined)
          void this.launchProgram(jobId, task.id, attempt.id, executor.program ?? '')
        continue
      }
      if (attempt === undefined) {
        await this.failTaskLocked(
          jobId,
          task.id,
          'host restarted and the execution attempt was lost',
        )
        continue
      }
      const sessionId = attempt.sessionId
      if (sessionId === null || executor.kind !== 'worker') {
        await this.failTaskLocked(
          jobId,
          task.id,
          'host restarted and the execution session was lost',
        )
        continue
      }
      const resumed = await this.resumeAgentAttempt(jobId, task, attempt, executor.name, sessionId)
      if (!resumed) {
        if (task.claimant?.kind === 'assistant') {
          await this.releaseAssistantLocked(jobId, task, 'assistant session could not be resumed')
        } else {
          await this.failTaskLocked(
            jobId,
            task.id,
            'host restarted and the execution session could not be resumed',
          )
        }
      }
    }
    const tasks = this.store.listTasks(jobId)
    const startTask = tasks.find((task) => task.id === START_TASK_ID)
    if (
      startTask !== undefined &&
      startTask.status === 'completed' &&
      tasks.length === 1 &&
      job.definition.start.next.length > 0
    ) {
      try {
        await this.spawnInitialTasksLocked(job, startTask)
      } catch (error) {
        this.logger?.warn?.(
          `buka-workflows: could not rebuild initial tasks for job ${jobId}: ${describeError(error)}`,
        )
      }
    }
    await this.recomputeLocked(jobId)
  }

  /** 重新投递启动任务提示词。 */
  private async resumeStartTask(
    job: JobRecord,
    task: TaskRecord,
    attempt: AttemptRecord,
  ): Promise<void> {
    const starter = job.starter
    if (starter.kind !== 'session') return
    try {
      const startSeq = await this.delivery.deliver(starter.sessionId, buildStartTaskPrompt(job))
      await this.store.runExclusive(job.id, async () => {
        await this.store.updateAttempt(attempt.id, (current) => ({
          ...current,
          status: 'running',
          error: null,
          finishedAt: null,
          sessionId: starter.sessionId,
          startSeq: startSeq ?? current.startSeq,
        }))
        this.sessionTasks.set(starter.sessionId, { jobId: job.id, taskId: task.id })
      })
    } catch (error) {
      await this.store.runExclusive(job.id, async () => {
        await this.failTaskLocked(
          job.id,
          task.id,
          `could not resume the start task: ${describeError(error)}`,
        )
        await this.recomputeLocked(job.id)
      })
    }
  }

  /** 续接一个 agent / 助理任务会话。 */
  private async resumeAgentAttempt(
    jobId: string,
    task: TaskRecord,
    attempt: AttemptRecord,
    worker: string,
    sessionId: string,
  ): Promise<boolean> {
    const workers = this.workersOf()
    if (workers === null || typeof workers.openSession !== 'function') return false
    let handle: WorkerHandleLike
    try {
      handle = (await workers.openSession({ worker, sessionId })) as WorkerHandleLike
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: could not resume session ${sessionId}: ${describeError(error)}`,
      )
      return false
    }
    const startSeq = handleStartSeq(handle) ?? attempt.startSeq ?? 0
    await this.store.updateAttempt(attempt.id, (current) => ({
      ...current,
      status: 'running',
      error: null,
      finishedAt: null,
      startSeq,
    }))
    this.sessionTasks.set(sessionId, { jobId, taskId: task.id })
    this.trackExecution({
      jobId,
      taskId: task.id,
      attemptId: attempt.id,
      kind: task.claimant?.kind === 'assistant' ? 'assistant' : 'agent',
      sessionId,
      handle,
      startSeq,
      worker,
    })
    return true
  }

  // ---------------------------------------------------------------------
  // 调度与结算（调用方必须已持有 per-job 队列）
  // ---------------------------------------------------------------------

  /** 重算就绪、调度可执行任务、检查预算与结算。 */
  private async recomputeLocked(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId)
    if (job === undefined || job.status !== 'running') return

    // 1. 预算：最长时长
    if (this.overDurationBudget(job)) {
      await this.failJobForBudget(job)
      return
    }

    // 2. 传播 blocked、提升 ready
    const tasks = this.store.listTasks(jobId)
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const now = nowIso()
    for (const task of tasks) {
      if (task.status !== 'pending') continue
      let blocked = false
      let allCompleted = true
      for (const dependency of task.deps) {
        const dep = byId.get(dependency)
        if (dep === undefined) continue
        if (dep.status === 'blocked' || dep.status === 'cancelled') blocked = true
        if (dep.status !== 'completed') allCompleted = false
      }
      if (blocked) {
        if (!canTransitionTask(task.status, 'blocked')) continue
        await this.store.updateTask(task.id, (current) => ({
          ...current,
          status: 'blocked',
          finishedAt: now,
          updatedAt: now,
        }))
        await this.appendEvent(jobId, 'task/blocked', { taskId: task.id })
        continue
      }
      if (!allCompleted) continue
      await this.store.updateTask(task.id, (current) => ({
        ...current,
        status: 'ready',
        updatedAt: now,
      }))
      await this.appendEvent(jobId, 'task/ready', { taskId: task.id })
    }

    // 3. 调度
    const launches = await this.scheduleReadyLocked(jobId)

    // 4. 结算
    await this.settleLocked(jobId)

    // 5. 在队列外真正启动执行
    for (const launch of launches) this.launch(launch)
  }

  /** 生成可执行任务：结束任务投递、启动任务、agent / robot / 助理任务。 */
  private async scheduleReadyLocked(jobId: string): Promise<Launch[]> {
    const job = this.store.getJob(jobId)
    if (job === undefined || job.status !== 'running') return []
    const tasks = this.store.listTasks(jobId)
    const ready = tasks.filter((task) => task.status === 'ready')
    if (ready.length === 0) return []
    const workers = await this.workers()
    const launches: Launch[] = []
    const busyPositions = new Set<string>()
    for (const task of tasks) {
      if (task.status === 'running') busyPositions.add(task.position)
    }
    const sorted = [...ready].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    )
    for (const task of sorted) {
      if (task.position === 'end') {
        if (this.deliveryBlocked.has(task.id)) continue
        const launch = await this.claimForDelivery(job, task)
        if (launch !== null) launches.push(launch)
        continue
      }
      if (task.position === 'start') {
        if (job.starter.kind !== 'session') continue
        if (busyPositions.has('start')) continue
        const launch = await this.claimStartTask(job, task)
        if (launch !== null) {
          busyPositions.add('start')
          launches.push(launch)
        }
        continue
      }
      const executor = task.assignee
      if (executor.kind === 'human') {
        const assistantName = this.assistantFor(job.definition, task.type)
        if (assistantName === null || task.assistantBlocked) continue
        if (this.busyAssistants.has(assistantName)) continue
        const launch = await this.claimAssistantTask(job, task, assistantName, tasks)
        if (launch !== null) {
          this.busyAssistants.add(assistantName)
          launches.push(launch)
        }
        continue
      }
      if (executor.kind !== 'worker') continue
      if (executor.driver === 'robot') {
        const programId = executor.program ?? ''
        const launch = await this.claimProgramTask(job, task, programId)
        if (launch !== null) launches.push(launch)
        continue
      }
      if (busyPositions.has(task.position)) continue
      const launch = await this.claimAgentTask(job, task, tasks, workers)
      if (launch !== null) {
        busyPositions.add(task.position)
        launches.push(launch)
      }
    }
    return launches
  }

  /** 取人任务类型点名的助理。 */
  private assistantFor(definition: WorkflowDefinition, typeId: string): string | null {
    for (const position of definition.positions) {
      for (const taskType of position.taskTypes) {
        if (taskType.id === typeId) {
          return typeof taskType.assistant === 'string' && taskType.assistant !== ''
            ? taskType.assistant
            : null
        }
      }
    }
    return null
  }

  /** 为一次执行准备 attempt 记录。 */
  private async createAttempt(input: {
    readonly jobId: string
    readonly taskId: string
    readonly promptFile: string | null
  }): Promise<AttemptRecord> {
    const attempt: AttemptRecord = {
      id: newAttemptId(),
      jobId: input.jobId,
      taskId: input.taskId,
      sessionId: null,
      startSeq: null,
      status: 'running',
      stopReason: null,
      error: null,
      promptFile: input.promptFile,
      startedAt: nowIso(),
      finishedAt: null,
    }
    await this.store.insertAttempt(attempt)
    return attempt
  }

  /** 认领任务为 running（写 attempt id 与认领者）。 */
  private async claimTaskRecord(
    job: JobRecord,
    task: TaskRecord,
    claimant: Claimant,
    attemptId: string,
  ): Promise<TaskRecord> {
    assertTaskTransition(task.id, task.status, 'running')
    const now = nowIso()
    const updated = await this.store.updateTask(task.id, (current) => ({
      ...current,
      status: 'running',
      claimant,
      attemptIds: [...current.attemptIds, attemptId],
      startedAt: current.startedAt ?? now,
      updatedAt: now,
    }))
    await this.appendEvent(job.id, 'task/claimed', {
      taskId: task.id,
      claimant: claimant.kind,
      name: claimant.name,
    })
    return updated
  }

  /** 认领 agent 任务并写 prompt。 */
  private async claimAgentTask(
    job: JobRecord,
    task: TaskRecord,
    tasks: readonly TaskRecord[],
    workers: ReadonlyMap<string, WorkerInfo>,
  ): Promise<Launch | null> {
    const position = positionOf(job.definition, task.position)
    if (position === undefined || position.executor.kind !== 'worker') return null
    const taskType = this.taskTypeOf(job.definition, task.type)
    if (taskType === undefined) {
      await this.failTaskLocked(
        job.id,
        task.id,
        `task type "${task.type}" is not declared in the workflow`,
      )
      return null
    }
    const prompt = buildExecutionPrompt({
      job,
      task,
      position,
      taskType,
      tasks,
      attachments: this.store.listAttachments(job.id),
      workspace: workers.get(position.executor.name)?.path,
    })
    const attempt = await this.createAttempt({ jobId: job.id, taskId: task.id, promptFile: null })
    const promptFile = await this.store
      .writeText(job.id, 'prompts', attempt.id, prompt)
      .catch(() => null)
    if (promptFile !== null) {
      await this.store.updateAttempt(attempt.id, (current) => ({ ...current, promptFile }))
    }
    await this.claimTaskRecord(
      job,
      task,
      { kind: 'worker', name: position.executor.name, sessionId: null },
      attempt.id,
    )
    return {
      kind: 'agent',
      jobId: job.id,
      taskId: task.id,
      attemptId: attempt.id,
      worker: position.executor.name,
      prompt,
      planMode: taskType.mode === 'plan',
    }
  }

  /** 认领助理承办的人任务。 */
  private async claimAssistantTask(
    job: JobRecord,
    task: TaskRecord,
    assistantName: string,
    tasks: readonly TaskRecord[],
  ): Promise<Launch | null> {
    const position = positionOf(job.definition, task.position)
    const taskType = this.taskTypeOf(job.definition, task.type)
    if (position === undefined || taskType === undefined) return null
    const prompt = buildAssistantPrompt({
      job,
      task,
      position,
      taskType,
      tasks,
      attachments: this.store.listAttachments(job.id),
      workspace: undefined,
    })
    const attempt = await this.createAttempt({ jobId: job.id, taskId: task.id, promptFile: null })
    const promptFile = await this.store
      .writeText(job.id, 'prompts', attempt.id, prompt)
      .catch(() => null)
    if (promptFile !== null) {
      await this.store.updateAttempt(attempt.id, (current) => ({ ...current, promptFile }))
    }
    await this.claimTaskRecord(
      job,
      task,
      { kind: 'assistant', name: assistantName, sessionId: null },
      attempt.id,
    )
    return {
      kind: 'assistant',
      jobId: job.id,
      taskId: task.id,
      attemptId: attempt.id,
      worker: assistantName,
      prompt,
      planMode: false,
    }
  }

  /** 认领 program 任务。 */
  private async claimProgramTask(
    job: JobRecord,
    task: TaskRecord,
    programId: string,
  ): Promise<Launch | null> {
    const attempt = await this.createAttempt({ jobId: job.id, taskId: task.id, promptFile: null })
    await this.claimTaskRecord(
      job,
      task,
      {
        kind: 'worker',
        name: task.assignee.kind === 'worker' ? task.assignee.name : programId,
        sessionId: null,
      },
      attempt.id,
    )
    return { kind: 'program', jobId: job.id, taskId: task.id, attemptId: attempt.id, programId }
  }

  /** 认领启动任务（会话启动者）。 */
  private async claimStartTask(job: JobRecord, task: TaskRecord): Promise<Launch | null> {
    if (job.starter.kind !== 'session') return null
    const attempt = await this.createAttempt({ jobId: job.id, taskId: task.id, promptFile: null })
    await this.claimTaskRecord(
      job,
      task,
      { kind: 'worker', name: 'starter', sessionId: job.starter.sessionId },
      attempt.id,
    )
    return {
      kind: 'start',
      jobId: job.id,
      taskId: task.id,
      attemptId: attempt.id,
      sessionId: job.starter.sessionId,
      prompt: buildStartTaskPrompt(job),
    }
  }

  /** 为结束任务准备一次投递。 */
  private async claimForDelivery(job: JobRecord, task: TaskRecord): Promise<Launch | null> {
    const attempt = await this.createAttempt({ jobId: job.id, taskId: task.id, promptFile: null })
    await this.appendEvent(job.id, 'delivery/attempt', { taskId: task.id, attemptId: attempt.id })
    return { kind: 'delivery', jobId: job.id, taskId: task.id, attemptId: attempt.id }
  }

  /** 在队列外启动一次执行。 */
  private launch(launch: Launch): void {
    if (this.disposed) return
    switch (launch.kind) {
      case 'agent':
      case 'assistant':
        void this.launchAgent(launch)
        return
      case 'program':
        void this.launchProgram(launch.jobId, launch.taskId, launch.attemptId, launch.programId)
        return
      case 'start':
        void this.launchStart(launch)
        return
      case 'delivery':
        void this.runDelivery(launch.jobId, launch.taskId, launch.attemptId)
    }
  }

  /** 启动一个 agent / 助理会话。 */
  private async launchAgent(
    launch: Extract<Launch, { kind: 'agent' | 'assistant' }>,
  ): Promise<void> {
    const workers = this.workersOf()
    if (workers === null || typeof workers.dispatchSession !== 'function') {
      await this.failOutside(
        launch.jobId,
        launch.taskId,
        'the Buka Workers service with dispatchSession() is unavailable; install or update @buka/dsh-plugin-workers',
      )
      return
    }
    const task = this.store.getTask(launch.taskId)
    if (task === undefined || task.status !== 'running') return
    let handle: WorkerHandleLike
    try {
      handle = (await workers.dispatchSession({
        worker: launch.worker,
        prompt: launch.prompt,
        title: `工作流任务 ${task.id}`,
        agentPreset: this.options.workerPreset,
        approval: 'ask',
        planMode: launch.planMode,
        newSessionId: randomUUID(),
      })) as WorkerHandleLike
    } catch (error) {
      await this.failOutside(
        launch.jobId,
        launch.taskId,
        `could not start the task session: ${describeError(error)}`,
      )
      return
    }
    const sessionId = handleSessionId(handle)
    const startSeq = handleStartSeq(handle) ?? 0
    await this.store.runExclusive(launch.jobId, async () => {
      const current = this.store.getTask(launch.taskId)
      if (current === undefined || current.status !== 'running') {
        this.disposeHandle(handle)
        return
      }
      await this.store.updateAttempt(launch.attemptId, (attempt) => ({
        ...attempt,
        sessionId,
        startSeq,
      }))
      if (sessionId !== null) {
        this.sessionTasks.set(sessionId, { jobId: launch.jobId, taskId: launch.taskId })
        await this.store.updateTask(launch.taskId, (record) => ({
          ...record,
          claimant: record.claimant === null ? record.claimant : { ...record.claimant, sessionId },
          updatedAt: nowIso(),
        }))
      }
    })
    this.trackExecution({
      jobId: launch.jobId,
      taskId: launch.taskId,
      attemptId: launch.attemptId,
      kind: launch.kind,
      sessionId,
      handle,
      startSeq,
      worker: launch.worker,
    })
  }

  /** 注册一个等待中的执行（轮询会话轮次、硬超时）。 */
  private trackExecution(input: {
    readonly jobId: string
    readonly taskId: string
    readonly attemptId: string
    readonly kind: ActiveExecution['kind']
    readonly sessionId: string | null
    readonly handle: WorkerHandleLike
    readonly startSeq: number
    readonly worker: string
  }): void {
    const controller = new AbortController()
    const execution: ActiveExecution = {
      jobId: input.jobId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      kind: input.kind,
      sessionId: input.sessionId,
      handle: input.handle,
      stopPoll: null,
      controller,
      timeout: null,
    }
    const finish = () => {
      execution.stopPoll?.()
      if (execution.timeout !== null) clearTimeout(execution.timeout)
      this.active.delete(input.taskId)
      this.disposeHandle(input.handle)
      if (input.sessionId !== null) {
        const current = this.sessionTasks.get(input.sessionId)
        if (current?.taskId === input.taskId) this.sessionTasks.delete(input.sessionId)
      }
    }
    execution.stopPoll = poll(this.options.pollIntervalMs, async () => {
      const task = this.store.getTask(input.taskId)
      if (task === undefined || task.status !== 'running') {
        finish()
        return true
      }
      const snapshot = readHandleResult(input.handle, input.startSeq)
      if (!snapshot.turnEnded) return false
      finish()
      if (input.kind === 'assistant') {
        await this.releaseAssistantOutside(input.jobId, input.taskId, snapshot, input.worker)
      } else {
        await this.failOutside(
          input.jobId,
          input.taskId,
          `the task session ended without calling buka_task_complete (stopReason: ${snapshot.stopReason ?? 'unknown'})`,
        )
      }
      return true
    })
    this.active.set(input.taskId, execution)
    if (this.options.taskTimeoutMs > 0) {
      execution.timeout = setTimeout(() => {
        void this.timeoutOutside(input.jobId, input.taskId, input.worker)
      }, this.options.taskTimeoutMs)
      execution.timeout.unref?.()
    }
  }

  /** 启动 program 任务。 */
  private async launchProgram(
    jobId: string,
    taskId: string,
    attemptId: string,
    programId: string,
  ): Promise<void> {
    const task = this.store.getTask(taskId)
    if (task === undefined || task.status !== 'running') return
    const driver = programDriver(programId === '' ? 'clock' : programId)
    if (driver === undefined) {
      await this.failOutside(jobId, taskId, `unknown robot driver "${programId}"`)
      return
    }
    const job = this.store.getJob(jobId)
    if (job === undefined) return
    const controller = new AbortController()
    this.active.set(taskId, {
      jobId,
      taskId,
      attemptId,
      kind: 'program',
      sessionId: null,
      handle: null,
      stopPoll: null,
      controller,
      timeout: null,
    })
    try {
      const tasks = this.store.listTasks(jobId)
      const payload = renderTaskPayload(task.payload, tasks)
      const result = await driver.run({ payload, signal: controller.signal })
      await this.store.runExclusive(jobId, async () => {
        this.active.delete(taskId)
        const current = this.store.getTask(taskId)
        if (current === undefined || current.status !== 'running') return
        const outputProblems = this.outputProblemsFor(job, current, result.output)
        if (outputProblems.length > 0) {
          await this.failTaskLocked(
            jobId,
            taskId,
            `program output is invalid: ${outputProblems.join('; ')}`,
          )
        } else {
          await this.completeTaskLocked(job, current, {
            output: result.output,
            text: '',
            attachments: [],
            workspace: undefined,
            createdBy: current.claimant?.name ?? programId,
          })
        }
        await this.recomputeLocked(jobId)
      })
    } catch (error) {
      await this.failOutside(jobId, taskId, `program task failed: ${describeError(error)}`)
    }
  }

  /** 投递启动任务提示词到启动者会话。 */
  private async launchStart(launch: Extract<Launch, { kind: 'start' }>): Promise<void> {
    try {
      const startSeq = await this.delivery.deliver(launch.sessionId, launch.prompt)
      await this.store.runExclusive(launch.jobId, async () => {
        const task = this.store.getTask(launch.taskId)
        if (task === undefined || task.status !== 'running') return
        await this.store.updateAttempt(launch.attemptId, (attempt) => ({
          ...attempt,
          sessionId: launch.sessionId,
          startSeq,
        }))
        this.sessionTasks.set(launch.sessionId, { jobId: launch.jobId, taskId: launch.taskId })
        await this.store.updateTask(launch.taskId, (record) => ({
          ...record,
          claimant: { kind: 'worker', name: 'starter', sessionId: launch.sessionId },
          updatedAt: nowIso(),
        }))
      })
      if (this.options.taskTimeoutMs > 0) {
        setTimeout(() => {
          void this.timeoutOutside(launch.jobId, launch.taskId, 'starter')
        }, this.options.taskTimeoutMs).unref?.()
      }
    } catch (error) {
      await this.failOutside(
        launch.jobId,
        launch.taskId,
        `could not deliver the start task prompt to the starter session: ${describeError(error)}`,
      )
    }
  }

  /** 结束任务投递。 */
  private async runDelivery(jobId: string, taskId: string, attemptId: string): Promise<void> {
    const job = this.store.getJob(jobId)
    const task = this.store.getTask(taskId)
    if (job === undefined || task === undefined || task.status !== 'ready') {
      await this.finishAttemptOutside(attemptId, 'cancelled', 'cancelled before delivery')
      return
    }
    let delivered = true
    let error: string | null = null
    if (job.starter.kind === 'session') {
      try {
        await this.delivery.deliver(job.starter.sessionId, buildEndDeliveryText(job, task))
      } catch (caught) {
        delivered = false
        error = describeError(caught)
      }
    }
    await this.store.runExclusive(jobId, async () => {
      const current = this.store.getTask(taskId)
      if (current === undefined) return
      if (!delivered) {
        this.deliveryBlocked.add(taskId)
        await this.store.updateAttempt(attemptId, (attempt) => ({
          ...attempt,
          status: 'failed',
          error,
          finishedAt: nowIso(),
        }))
        await this.appendEvent(jobId, 'delivery/failed', { taskId, error })
        return
      }
      await this.store.updateAttempt(attemptId, (attempt) => ({
        ...attempt,
        status: 'completed',
        stopReason: 'delivered',
        finishedAt: nowIso(),
      }))
      const text = JSON.stringify(current.payload)
      await this.completeRecordNoRecompute(job, current, {
        output: null,
        text,
        attachmentIds: [],
        createdBy: job.starter.kind === 'human' ? '本地用户' : 'starter',
      })
      await this.appendEvent(jobId, 'delivery/completed', { taskId })
      await this.recomputeLocked(jobId)
    })
  }

  /** 尝试结束任务之外的其它任务在超时后失败。 */
  private async timeoutOutside(jobId: string, taskId: string, worker: string): Promise<void> {
    await this.store.runExclusive(jobId, async () => {
      const task = this.store.getTask(taskId)
      if (task === undefined || task.status !== 'running') return
      const execution = this.active.get(taskId)
      execution?.controller.abort()
      if (execution?.handle != null && typeof execution.handle.cancel === 'function') {
        try {
          void execution.handle.cancel('task timed out')
        } catch {
          // 已释放：忽略。
        }
      }
      this.active.delete(taskId)
      if (execution?.stopPoll != null) execution.stopPoll()
      await this.failTaskLocked(
        jobId,
        taskId,
        `task timed out after ${this.options.taskTimeoutMs}ms (worker: ${worker})`,
      )
      await this.recomputeLocked(jobId)
    })
  }

  // ---------------------------------------------------------------------
  // 状态提交
  // ---------------------------------------------------------------------

  /** 队列外失败：重新进队列提交。 */
  private async failOutside(jobId: string, taskId: string, reason: string): Promise<void> {
    try {
      await this.store.runExclusive(jobId, async () => {
        await this.failTaskLocked(jobId, taskId, reason)
        await this.recomputeLocked(jobId)
      })
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: could not mark task ${taskId} failed: ${describeError(error)}`,
      )
    }
  }

  /** 助理失败（会话结束但未提交）：回到待认领。 */
  private async releaseAssistantOutside(
    jobId: string,
    taskId: string,
    snapshot: TurnSnapshot,
    worker: string,
  ): Promise<void> {
    try {
      await this.store.runExclusive(jobId, async () => {
        this.busyAssistants.delete(worker)
        await this.releaseAssistantLocked(
          jobId,
          this.requireTask(jobId, taskId),
          `assistant session ended without completing the task (stopReason: ${snapshot.stopReason ?? 'unknown'})`,
        )
        await this.recomputeLocked(jobId)
      })
    } catch (error) {
      this.logger?.warn?.(
        `buka-workflows: could not release assistant task ${taskId}: ${describeError(error)}`,
      )
    }
  }

  /** 助理失败后把任务放回「待认领」。 */
  private async releaseAssistantLocked(
    jobId: string,
    task: TaskRecord,
    reason: string,
  ): Promise<void> {
    const now = nowIso()
    const current = this.store.getTask(task.id)
    if (current === undefined || current.status !== 'running') return
    this.dropSessionTask(task.id)
    await this.store.updateTask(task.id, (record) => ({
      ...record,
      status: 'ready',
      claimant: null,
      assistantBlocked: true,
      updatedAt: now,
    }))
    await this.closeRunningAttempts(task.id, 'failed', reason)
    await this.appendEvent(jobId, 'task/assistant-failed', { taskId: task.id, reason })
  }

  /** 标记任务技术失败。 */
  private async failTaskLocked(jobId: string, taskId: string, reason: string): Promise<void> {
    const task = this.store.getTask(taskId)
    if (task === undefined) return
    if (task.status !== 'running' && task.status !== 'ready') return
    const now = nowIso()
    this.dropSessionTask(taskId)
    this.active.delete(taskId)
    if (task.claimant?.kind === 'assistant') this.busyAssistants.delete(task.claimant.name)
    const nextStatus: TaskStatus = 'failed'
    if (canTransitionTask(task.status, nextStatus)) {
      await this.store.updateTask(taskId, (current) => ({
        ...current,
        status: nextStatus,
        error: reason,
        finishedAt: now,
        updatedAt: now,
      }))
    }
    await this.closeRunningAttempts(taskId, 'failed', reason)
    await this.appendEvent(jobId, 'task/failed', { taskId, error: reason })
  }

  /** 关闭任务下所有 running 执行记录。 */
  private async closeRunningAttempts(
    taskId: string,
    status: 'failed' | 'cancelled',
    error: string,
  ): Promise<void> {
    for (const attempt of this.store.listAttempts(taskId)) {
      if (attempt.status !== 'running') continue
      await this.store.updateAttempt(attempt.id, (current) => ({
        ...current,
        status,
        error,
        finishedAt: nowIso(),
      }))
    }
  }

  /** 完成一条任务并写入结果 / 附件。 */
  private async completeTaskLocked(
    job: JobRecord,
    task: TaskRecord,
    input: {
      readonly output: JsonValue
      readonly text: string
      readonly attachments: unknown
      readonly workspace: string | undefined
      readonly createdBy: string
    },
  ): Promise<TaskRecord> {
    const jobDirectory = this.store.paths(job.id).root
    const attachmentRecords = await ingestAttachments({
      raw: input.attachments,
      jobId: job.id,
      jobDirectory,
      taskId: task.id,
      position: task.position,
      createdBy: input.createdBy,
      workspace: input.workspace,
      limits: {
        maxBytes: this.options.maxAttachmentBytes,
        maxTotalBytes: this.options.maxTaskAttachmentsBytes,
        maxCount: this.options.maxAttachmentsPerTask,
      },
    })
    for (const attachment of attachmentRecords) await this.store.insertAttachment(attachment)
    const attemptId = task.attemptIds.at(-1) ?? newAttemptId()
    const text = clipUtf8(input.text, this.options.maxResultTextBytes)
    const textFile =
      text.trim() === ''
        ? null
        : await this.store.writeText(job.id, 'results', attemptId, text).catch(() => null)
    const result = {
      output: input.output,
      text: clipUtf8(text, RESULT_PREVIEW_BYTES),
      textBytes: Buffer.byteLength(text, 'utf8'),
      textFile,
      attachmentIds: attachmentRecords.map((attachment) => attachment.id),
    }
    if (task.claimant?.kind === 'assistant') this.busyAssistants.delete(task.claimant.name)
    const now = nowIso()
    if (task.id === START_TASK_ID) {
      await this.store.updateJob(job.id, (current) => ({
        ...current,
        input: { ...current.input, structured: input.output },
        updatedAt: now,
      }))
    }
    if (!canTransitionTask(task.status, 'completed')) {
      throw new WorkflowError(
        'invalid-status',
        `task ${task.id} is ${task.status}, cannot complete`,
      )
    }
    const updated = await this.store.updateTask(task.id, (current) => ({
      ...current,
      status: 'completed',
      result,
      error: null,
      finishedAt: now,
      updatedAt: now,
    }))
    if (this.store.getAttempt(attemptId) !== undefined) {
      await this.store.updateAttempt(attemptId, (current) => ({
        ...current,
        status: current.status === 'running' ? 'completed' : current.status,
        stopReason: current.status === 'running' ? 'completed' : current.stopReason,
        finishedAt: current.finishedAt ?? now,
      }))
    }
    this.active.delete(task.id)
    this.dropSessionTask(task.id)
    await this.appendEvent(job.id, 'task/completed', { taskId: task.id, type: task.type })
    if (task.id === START_TASK_ID) {
      await this.spawnInitialTasksLocked(job, updated)
    }
    return updated
  }

  /** 完成结束任务（无 recompute，由调用方继续）。 */
  private async completeRecordNoRecompute(
    job: JobRecord,
    task: TaskRecord,
    result: {
      readonly output: JsonValue | null
      readonly text: string
      readonly attachmentIds: readonly string[]
      readonly createdBy: string
    },
  ): Promise<void> {
    const now = nowIso()
    const text = clipUtf8(result.text, this.options.maxResultTextBytes)
    const resultRecord = {
      output: result.output,
      text: clipUtf8(text, RESULT_PREVIEW_BYTES),
      textBytes: Buffer.byteLength(text, 'utf8'),
      textFile: null,
      attachmentIds: [...result.attachmentIds],
    }
    if (!canTransitionTask(task.status, 'completed')) return
    await this.store.updateTask(task.id, (current) => ({
      ...current,
      status: 'completed',
      result: resultRecord,
      claimant: current.claimant ?? {
        kind: job.starter.kind === 'human' ? 'human' : 'worker',
        name: result.createdBy,
        sessionId: job.starter.kind === 'session' ? job.starter.sessionId : null,
      },
      error: null,
      finishedAt: now,
      updatedAt: now,
    }))
  }

  /** 启动任务完成后创建初始任务。 */
  private async spawnInitialTasksLocked(job: JobRecord, startTask: TaskRecord): Promise<void> {
    const workers = await this.workers()
    const initial = buildInitialTasks({
      job,
      startTask,
      tasks: this.store.listTasks(job.id),
      workers,
    })
    for (const task of initial) {
      await this.store.insertTask(task)
      await this.appendEvent(job.id, 'task/created', {
        taskId: task.id,
        position: task.position,
        type: task.type,
        deps: task.deps,
      })
    }
  }

  /** 结算：没有非终态任务时决定作业最终状态。 */
  private async settleLocked(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId)
    if (job === undefined || job.status !== 'running') return
    if (this.overDurationBudget(job)) {
      await this.failJobForBudget(job)
      return
    }
    const tasks = this.store.listTasks(jobId)
    // 失败任务在人工决定重试 / 放弃前保持作业 running（spec §7.8）。
    if (tasks.some((task) => task.status === 'failed')) return
    if (tasks.some((task) => isOpenTaskStatus(task.status))) return
    const hasEndCompleted = tasks.some(
      (task) => task.position === 'end' && task.status === 'completed',
    )
    // 放弃（failed -> cancelled）也是失败分支：结果 / 错误记录仍留在任务上。
    const hasFailure = tasks.some(
      (task) =>
        task.status === 'blocked' ||
        task.status === 'failed' ||
        (task.status === 'cancelled' && task.error !== null),
    )
    const now = nowIso()
    if (hasEndCompleted && !hasFailure) {
      assertJobTransition(jobId, job.status, 'completed')
      await this.store.updateJob(jobId, (current) => ({
        ...current,
        status: 'completed',
        error: null,
        finishedAt: now,
        updatedAt: now,
      }))
      await this.appendEvent(jobId, 'job/completed', {})
      return
    }
    const reason = hasEndCompleted
      ? 'a task failed or was blocked, so the job ended as failed'
      : 'no end task was completed, so the job ended as failed'
    assertJobTransition(jobId, job.status, 'failed')
    await this.store.updateJob(jobId, (current) => ({
      ...current,
      status: 'failed',
      error: reason,
      finishedAt: now,
      updatedAt: now,
    }))
    await this.appendEvent(jobId, 'job/failed', { error: reason })
  }

  /** 是否超过最长时长预算。 */
  private overDurationBudget(job: JobRecord): boolean {
    const elapsedMs = Date.now() - Date.parse(job.createdAt)
    return elapsedMs > job.definition.budgets.maxDurationHours * 3600 * 1000
  }

  /** 超预算：取消非终态任务，作业 failed。 */
  private async failJobForBudget(job: JobRecord): Promise<void> {
    const now = nowIso()
    for (const task of this.store.listTasks(job.id)) {
      if (!isOpenTaskStatus(task.status)) continue
      this.cancelActive(task.id, 'workflow budget exceeded')
      await this.store.updateTask(task.id, (current) => ({
        ...current,
        status: 'cancelled',
        finishedAt: now,
        updatedAt: now,
      }))
      await this.closeRunningAttempts(task.id, 'cancelled', 'workflow budget exceeded')
      this.dropSessionTask(task.id)
    }
    const reason = `workflow exceeded its maxDurationHours budget (${job.definition.budgets.maxDurationHours}h)`
    await this.store.updateJob(job.id, (current) => ({
      ...current,
      status: 'failed',
      error: reason,
      finishedAt: now,
      updatedAt: now,
    }))
    await this.appendEvent(job.id, 'job/budget-exceeded', { error: reason })
  }

  // ---------------------------------------------------------------------
  // 小工具
  // ---------------------------------------------------------------------

  /** 取一个运行中的作业，否则抛错。 */
  private requireRunningJob(jobId: string, allowTerminal = false): JobRecord {
    const job = this.store.getJob(jobId)
    if (job === undefined) throw new WorkflowError('not-found', `job not found: ${jobId}`)
    if (!allowTerminal && job.status !== 'running') {
      throw new WorkflowError('job-not-running', `job ${jobId} is ${job.status}`)
    }
    return job
  }

  /** 取一条属于该作业的任务。 */
  private requireTask(jobId: string, taskId: string): TaskRecord {
    const task = this.store.getTask(taskId)
    if (task === undefined || task.jobId !== jobId) {
      throw new WorkflowError('not-found', `task not found: ${taskId}`)
    }
    return task
  }

  /** 按 id 取任务类型。 */
  private taskTypeOf(definition: WorkflowDefinition, typeId: string) {
    for (const position of definition.positions) {
      for (const taskType of position.taskTypes) {
        if (taskType.id === typeId) return taskType
      }
    }
    return undefined
  }

  /** 按任务契约校验结构化结果。 */
  private outputProblemsFor(job: JobRecord, task: TaskRecord, output: JsonValue): string[] {
    const definition = job.definition
    if (task.position === 'end') return []
    if (task.id === START_TASK_ID) return schemaProblems(definition.start.task.output, output)
    const taskType = this.taskTypeOf(definition, task.type)
    if (taskType === undefined) return [`unknown task type "${task.type}"`]
    return schemaProblems(taskType.output, output)
  }

  /** 任务执行者的工作区（打工人目录）。 */
  private workspaceFor(task: TaskRecord): string | undefined {
    if (task.assignee.kind === 'worker') return this.catalog.get(task.assignee.name)?.path
    if (task.claimant !== null && task.claimant.kind === 'assistant') {
      return this.catalog.get(task.claimant.name)?.path
    }
    return undefined
  }

  /** 取消一条任务的等待中执行。 */
  private cancelActive(taskId: string, reason: string): void {
    const execution = this.active.get(taskId)
    if (execution === undefined) return
    execution.stopPoll?.()
    if (execution.timeout !== null) clearTimeout(execution.timeout)
    execution.controller.abort()
    try {
      if (execution.handle !== null && typeof execution.handle.cancel === 'function') {
        void execution.handle.cancel(reason)
      }
    } catch {
      // 已释放：忽略。
    }
    this.disposeHandle(execution.handle)
    this.active.delete(taskId)
    if (execution.sessionId !== null) this.sessionTasks.delete(execution.sessionId)
  }

  /** 从 session→task 索引里删掉某条任务。 */
  private dropSessionTask(taskId: string): void {
    for (const [sessionId, reference] of this.sessionTasks) {
      if (reference.taskId === taskId) this.sessionTasks.delete(sessionId)
    }
  }

  /** 关闭 attempt（投递取消等）。 */
  private async finishAttemptOutside(
    attemptId: string,
    status: 'failed' | 'cancelled',
    error: string,
  ): Promise<void> {
    try {
      await this.store.updateAttempt(attemptId, (current) => ({
        ...current,
        status,
        error,
        finishedAt: nowIso(),
      }))
    } catch {
      // 记录已不存在：忽略。
    }
  }

  /** 追加作业事件。 */
  private async appendEvent(
    jobId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await appendJobEvent(this.store, this.logger, jobId, type, data)
  }
}

/**
 * 判断一次任务状态转换是否合法（给内部断言用）。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 合法时为 true
 */
/** 取任务类型展示名（工具输出用）。 */
export function describeTaskType(job: JobRecord, typeId: string): string {
  return taskTypeLabel(job.definition, typeId)
}
