/**
 * 业务存储：`ctx.storageDomain` 上的 workflows / jobs / tasks / attempts /
 * attachments 读写，以及 per-job 串行队列与作业目录。
 *
 * 记录全部是不可变数据：更新一律用表句柄的原子 `update`（传入纯函数），
 * 或构造新记录 `put`。读是同步内存读，写返回时已落盘。
 *
 * 本模块不 import 任何 DSH 服务类型；`openWorkflowStore`（`store/open.ts`）
 * 负责把真实宿主域接进来，单测直接传内存实现。
 *
 * @module @buka/dsh-plugin-workflows/store
 */

import { upgradeV4Definition, upgradeV4TaskChannel } from '../definition/upgrade.ts'
import { newWorkflowId, nowIso } from '../domain/ids.ts'
import type {
  AttachmentRecord,
  AttemptRecord,
  Claimant,
  JobRecord,
  StoredExecutor,
  TaskRecord,
  WorkflowDefinition,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowVersionRecord,
} from '../domain/types.ts'
import {
  assertSafeSegment,
  ensureJobDirectories,
  type JobPaths,
  jobPaths,
  readJobText,
  writeJobText,
} from './dirs.ts'
import { KeyedQueue } from './queue.ts'
import { WORKFLOW_DOMAIN_VERSION } from './schema.ts'

/** 表句柄的最小形状；与 `@deepseek-ai/dsh-storage-domain` 的 `KvTable` 结构兼容。 */
export interface KvTableLike<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  deleteMany(keys: readonly string[]): Promise<number>
  update(key: string, fn: (current: V) => V): Promise<V>
}

/** 打开的存储域的最小形状。 */
export interface WorkflowDomainLike {
  readonly name: string
  table(name: 'workflows'): KvTableLike<WorkflowRecord>
  table(name: 'jobs'): KvTableLike<JobRecord>
  table(name: 'tasks'): KvTableLike<TaskRecord>
  table(name: 'attempts'): KvTableLike<AttemptRecord>
  table(name: 'attachments'): KvTableLike<AttachmentRecord>
  close(): Promise<void>
}

/** 日志的最小形状（宿主 logger 的子集）。 */
export interface LoggerLike {
  warn?(message: string, ...args: readonly unknown[]): void
  info?(message: string, ...args: readonly unknown[]): void
}

/** 存储构造参数。 */
export interface WorkflowStoreOptions {
  /** 已打开的 `buka-workflow` 域。 */
  readonly domain: WorkflowDomainLike
  /** 插件数据目录；作业目录建在 `<dataDir>/jobs/<jobId>`。 */
  readonly dataDir: string
  readonly logger?: LoggerLike | undefined
}

/** 把术语改名前的 `kind: "robot"` 归一成 `worker`；其它记录原样返回。 */
function normalizeStoredExecutor(executor: StoredExecutor): StoredExecutor {
  if (executor === null || typeof executor !== 'object') return executor
  const legacy = executor as { kind?: string }
  if (legacy.kind !== 'robot') return executor
  const record = executor as unknown as {
    name: string
    driver?: string
    program?: string
    avatar?: string
  }
  const driver = record.driver === 'robot' || record.driver === 'program' ? 'robot' : 'agent'
  return {
    kind: 'worker',
    name: record.name,
    driver,
    ...(record.program === undefined ? {} : { program: record.program }),
    ...(record.avatar === undefined ? {} : { avatar: record.avatar }),
  }
}

/** 把术语改名前的承办者 `kind: "robot"` 归一成 `worker`。 */
function normalizeClaimant(claimant: Claimant | null): Claimant | null {
  if (claimant === null || (claimant as { kind?: string }).kind !== 'robot') return claimant
  return { ...claimant, kind: 'worker' }
}

/** 把定义快照里岗位执行者的 `kind: "robot"` 归一成 `worker`。 */
function normalizeDefinitionExecutors(definition: WorkflowDefinition): WorkflowDefinition {
  // 容错：单测和手工数据里可能有缺 definition / positions 的记录。
  if (
    definition === null ||
    typeof definition !== 'object' ||
    !Array.isArray((definition as { positions?: unknown }).positions)
  ) {
    return definition
  }
  let changed = false
  const positions = definition.positions.map((position) => {
    if ((position.executor as { kind?: string }).kind !== 'robot') return position
    changed = true
    return {
      ...position,
      executor: { kind: 'worker' as const, name: (position.executor as { name: string }).name },
    }
  })
  return changed ? { ...definition, positions } : definition
}

/** 创建一条工作流记录的入参。 */
export interface CreateWorkflowInput {
  readonly name: string
  readonly description: string
  readonly definition: WorkflowDefinition
  readonly status?: WorkflowStatus | undefined
}

/** 一条工作流 + 某个版本。 */
export interface WorkflowWithVersion {
  readonly record: WorkflowRecord
  readonly version: number
  readonly versionRecord: WorkflowVersionRecord
}

/** 存储根对象。 */
export class WorkflowStore {
  private readonly domain: WorkflowDomainLike
  private readonly dataDir: string
  private readonly logger: LoggerLike | undefined
  private readonly queue = new KeyedQueue()

  constructor(options: WorkflowStoreOptions) {
    this.domain = options.domain
    this.dataDir = options.dataDir
    this.logger = options.logger
  }

  /** 存储域版本；迁移入口在 `init` 里按它检查。 */
  get domainVersion(): number {
    return WORKFLOW_DOMAIN_VERSION
  }

  /**
   * 把术语改名前的旧记录（执行者 / 承办者 `kind: "robot"`、driver `"program"`）
   * 归一成当前取值。只改标记为旧值的记录，幂等；迁移后字段与新建记录一致。
   */
  private async normalizeLegacyWorkerKinds(): Promise<void> {
    let tasks = 0
    for (const [id, record] of this.domain.table('tasks').entries()) {
      const assignee = normalizeStoredExecutor(record.assignee)
      const claimant = normalizeClaimant(record.claimant)
      if (assignee === record.assignee && claimant === record.claimant) continue
      await this.domain.table('tasks').update(id, (current) => ({ ...current, assignee, claimant }))
      tasks += 1
    }

    let jobs = 0
    for (const [id, record] of this.domain.table('jobs').entries()) {
      const definition = normalizeDefinitionExecutors(record.definition)
      if (definition === record.definition) continue
      await this.domain.table('jobs').update(id, (current) => ({ ...current, definition }))
      jobs += 1
    }

    let workflows = 0
    for (const [id, record] of this.domain.table('workflows').entries()) {
      let changed = false
      const versions: Record<string, WorkflowVersionRecord> = {}
      for (const [version, snapshot] of Object.entries(record.versions)) {
        const definition = normalizeDefinitionExecutors(snapshot.definition)
        if (definition !== snapshot.definition) changed = true
        versions[version] = { ...snapshot, definition }
      }
      if (!changed) continue
      await this.domain.table('workflows').update(id, (current) => ({ ...current, versions }))
      workflows += 1
    }

    if (tasks > 0 || jobs > 0 || workflows > 0) {
      this.logger?.info?.(
        `buka-workflows: normalized legacy worker fields (${tasks} task(s), ${jobs} job(s), ${workflows} workflow(s))`,
      )
    }
  }

  /**
   * v4 → v5 一次性迁移：把工作流（全部版本）与作业快照升级成通道定义，
   * 并按 v4 的唯一派发关系给任务回填 `channel`。
   *
   * 幂等：已升级的定义返回 null，已带 `channel` 的任务跳过。某条记录升级失败
   * 时只记日志、保留原样，避免一次坏数据让整个插件起不来。
   */
  private async upgradeDefinitionsToV5(): Promise<void> {
    let workflows = 0
    for (const [id, record] of this.domain.table('workflows').entries()) {
      let changed = false
      const versions: Record<string, WorkflowVersionRecord> = {}
      for (const [version, snapshot] of Object.entries(record.versions)) {
        const upgraded = upgradeV4Definition(snapshot.definition)
        if (upgraded === null) {
          versions[version] = snapshot
          continue
        }
        changed = true
        versions[version] = { ...snapshot, definition: upgraded }
      }
      if (!changed) continue
      await this.domain.table('workflows').update(id, (current) => ({ ...current, versions }))
      workflows += 1
    }
    if (workflows > 0) {
      this.logger?.info?.(`buka-workflows: upgraded ${workflows} workflow(s) to definition v5`)
    }

    let jobs = 0
    const definitions = new Map<string, WorkflowDefinition>()
    for (const [id, record] of this.domain.table('jobs').entries()) {
      const upgraded = upgradeV4Definition(record.definition)
      if (upgraded === null) {
        definitions.set(id, record.definition)
        continue
      }
      definitions.set(id, upgraded)
      await this.domain
        .table('jobs')
        .update(id, (current) => ({ ...current, definition: upgraded }))
      jobs += 1
    }
    if (jobs > 0) {
      this.logger?.info?.(`buka-workflows: upgraded ${jobs} job snapshot(s) to definition v5`)
    }

    let tasks = 0
    for (const [id, record] of this.domain.table('tasks').entries()) {
      if (Object.hasOwn(record, 'channel')) continue
      const definition = definitions.get(record.jobId)
      const channel = definition === undefined ? null : upgradeV4TaskChannel(definition, record)
      await this.domain.table('tasks').update(id, (current) => ({ ...current, channel }))
      tasks += 1
    }
    if (tasks > 0) {
      this.logger?.info?.(`buka-workflows: backfilled channel on ${tasks} legacy task(s)`)
    }
  }

  /** 打开域之后的初始化：键唯一性、旧草稿启用、作业编号回填。 */
  async init(): Promise<void> {
    for (const [key, record] of this.domain.table('workflows').entries()) {
      if (key !== record.id)
        throw new Error(`workflows: stored key "${key}" differs from record id`)
    }
    for (const [key, record] of this.domain.table('jobs').entries()) {
      if (key !== record.id) throw new Error(`jobs: stored key "${key}" differs from record id`)
    }
    for (const [key, record] of this.domain.table('tasks').entries()) {
      if (key !== record.id) throw new Error(`tasks: stored key "${key}" differs from record id`)
    }
    for (const [key, record] of this.domain.table('attempts').entries()) {
      if (key !== record.id) throw new Error(`attempts: stored key "${key}" differs from record id`)
    }
    for (const [key, record] of this.domain.table('attachments').entries()) {
      if (key !== record.id) {
        throw new Error(`attachments: stored key "${key}" differs from record id`)
      }
    }
    await this.normalizeLegacyWorkerKinds()
    await this.upgradeDefinitionsToV5()
    // 旧版本把新建工作流保存为 draft，要求人工激活；现在新建即启用。
    // 这里把遗留草稿一次性归一为启用，且只做一次幂等更新。
    let promoted = 0
    for (const [id, record] of this.domain.table('workflows').entries()) {
      if (record.status !== 'draft') continue
      await this.domain.table('workflows').update(id, (current) => ({
        ...current,
        status: 'active',
      }))
      promoted += 1
    }
    if (promoted > 0) {
      this.logger?.info?.(`buka-workflows: enabled ${promoted} legacy draft workflow(s)`)
    }
    // 作业编号在所属工作流内递增；记录损坏或迁移丢字段时按已有作业回填。
    const maxSeq = new Map<string, number>()
    for (const [, job] of this.domain.table('jobs').entries()) {
      maxSeq.set(job.workflowId, Math.max(maxSeq.get(job.workflowId) ?? 0, job.seq))
    }
    for (const [workflowId, seq] of maxSeq) {
      const workflow = this.domain.table('workflows').get(workflowId)
      if (workflow === undefined) {
        this.logger?.warn?.(`buka-workflows: job ${workflowId} has no workflow record`)
        continue
      }
      if (workflow.jobSeq >= seq) continue
      await this.domain.table('workflows').update(workflowId, (current) => ({
        ...current,
        jobSeq: seq,
        updatedAt: nowIso(),
      }))
    }
  }

  /**
   * 关闭存储域。
   *
   * @returns 无返回值
   */
  async close(): Promise<void> {
    await this.domain.close()
  }

  // ---------------------------------------------------------------------
  // 工作流
  // ---------------------------------------------------------------------

  /**
   * 新建一条工作流（版本 1，默认启用）。
   *
   * @param input 名称、描述与定义
   * @returns 新建的记录
   */
  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowRecord> {
    const createdAt = nowIso()
    const versionRecord: WorkflowVersionRecord = {
      version: 1,
      definition: input.definition,
      createdAt,
    }
    const record: WorkflowRecord = {
      id: newWorkflowId(),
      name: input.name,
      description: input.description,
      status: input.status ?? 'active',
      latestVersion: 1,
      versions: { '1': versionRecord },
      jobSeq: 0,
      createdAt,
      updatedAt: createdAt,
    }
    await this.domain.table('workflows').put(record.id, record)
    return record
  }

  /**
   * 取一条工作流记录。
   *
   * @param workflowId 工作流 id
   * @returns 记录；不存在时是 undefined
   */
  getWorkflow(workflowId: string): WorkflowRecord | undefined {
    return this.domain.table('workflows').get(workflowId)
  }

  /**
   * 全部工作流记录（按更新时间倒序）。
   *
   * @returns 工作流记录
   */
  listWorkflows(): WorkflowRecord[] {
    const records = [...this.domain.table('workflows').entries()].map(([, record]) => record)
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * 保存一个工作流新版本；名称 / 描述同步为最新定义里的值。
   *
   * @param workflowId 工作流 id
   * @param definition 已校验的定义
   * @returns 更新后的记录
   * @throws 工作流不存在时抛出
   */
  async saveWorkflowVersion(
    workflowId: string,
    definition: WorkflowDefinition,
  ): Promise<WorkflowRecord> {
    const updatedAt = nowIso()
    return await this.domain.table('workflows').update(workflowId, (current) => {
      const version = current.latestVersion + 1
      return {
        ...current,
        latestVersion: version,
        versions: {
          ...current.versions,
          [String(version)]: { version, definition, createdAt: updatedAt },
        },
        name: definition.name,
        description: definition.description ?? '',
        updatedAt,
      }
    })
  }

  /**
   * 改工作流状态；`retired` 表示停用，`active` 表示可用。
   *
   * @param workflowId 工作流 id
   * @param status 新状态
   * @returns 更新后的记录
   */
  async setWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<WorkflowRecord> {
    return await this.domain.table('workflows').update(workflowId, (current) => ({
      ...current,
      status,
      updatedAt: nowIso(),
    }))
  }

  /**
   * 停用 / 重新启用；停用后状态是 `retired`。
   *
   * @param workflowId 工作流 id
   * @param active 是否可用
   * @returns 更新后的记录
   */
  async activateWorkflow(workflowId: string, active: boolean): Promise<WorkflowRecord> {
    return await this.setWorkflowStatus(workflowId, active ? 'active' : 'retired')
  }

  /**
   * 取工作流的某个版本（默认最新）。
   *
   * @param workflowId 工作流 id
   * @param version 版本号；省略取最新
   * @returns 工作流与版本记录；不存在时是 null
   */
  readWorkflowVersion(workflowId: string, version?: number): WorkflowWithVersion | null {
    const record = this.getWorkflow(workflowId)
    if (record === undefined) return null
    const target = version ?? record.latestVersion
    const versionRecord = record.versions[String(target)]
    if (versionRecord === undefined) return null
    return { record, version: target, versionRecord }
  }

  /**
   * 在当前工作流内分配下一个作业编号（原子递增）。
   *
   * @param workflowId 工作流 id
   * @returns 递增后的作业编号
   */
  async allocateJobSeq(workflowId: string): Promise<number> {
    const updated = await this.domain.table('workflows').update(workflowId, (current) => ({
      ...current,
      jobSeq: current.jobSeq + 1,
      updatedAt: nowIso(),
    }))
    return updated.jobSeq
  }

  /**
   * 统计工作流下的作业数。
   *
   * @param workflowId 工作流 id
   * @returns 作业数
   */
  countJobs(workflowId: string): number {
    let count = 0
    for (const [, job] of this.domain.table('jobs').entries()) {
      if (job.workflowId === workflowId) count += 1
    }
    return count
  }

  // ---------------------------------------------------------------------
  // 作业
  // ---------------------------------------------------------------------

  /**
   * 插入一条作业记录。
   *
   * @param job 作业记录
   * @returns 无返回值
   */
  async insertJob(job: JobRecord): Promise<void> {
    await this.domain.table('jobs').put(job.id, job)
  }

  /**
   * 取作业记录。
   *
   * @param jobId 作业 id
   * @returns 作业；不存在时是 undefined
   */
  getJob(jobId: string): JobRecord | undefined {
    return this.domain.table('jobs').get(jobId)
  }

  /**
   * 列出某个工作流下的作业（按编号倒序）。
   *
   * @param workflowId 工作流 id
   * @returns 作业记录
   */
  listJobs(workflowId: string): JobRecord[] {
    const jobs: JobRecord[] = []
    for (const [, job] of this.domain.table('jobs').entries()) {
      if (job.workflowId === workflowId) jobs.push(job)
    }
    return jobs.sort((left, right) => right.seq - left.seq)
  }

  /**
   * 全部作业（恢复时用）。
   *
   * @returns 作业记录
   */
  allJobs(): JobRecord[] {
    return [...this.domain.table('jobs').entries()].map(([, job]) => job)
  }

  /**
   * 原子更新作业记录。
   *
   * @param jobId 作业 id
   * @param update 纯函数：当前记录 → 新记录
   * @returns 新记录
   */
  async updateJob(jobId: string, update: (current: JobRecord) => JobRecord): Promise<JobRecord> {
    return await this.domain.table('jobs').update(jobId, update)
  }

  // ---------------------------------------------------------------------
  // 任务
  // ---------------------------------------------------------------------

  /**
   * 插入一条任务记录。
   *
   * @param task 任务记录
   * @returns 无返回值
   */
  async insertTask(task: TaskRecord): Promise<void> {
    await this.domain.table('tasks').put(task.id, task)
  }

  /**
   * 取任务记录。
   *
   * @param taskId 任务 id
   * @returns 任务；不存在时是 undefined
   */
  getTask(taskId: string): TaskRecord | undefined {
    return this.domain.table('tasks').get(taskId)
  }

  /**
   * 列出某个作业的全部任务（按创建时间升序）。
   *
   * @param jobId 作业 id
   * @returns 任务记录
   */
  listTasks(jobId: string): TaskRecord[] {
    const tasks: TaskRecord[] = []
    for (const [, task] of this.domain.table('tasks').entries()) {
      if (task.jobId === jobId) tasks.push(task)
    }
    return tasks.sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    )
  }

  /**
   * 原子更新一条任务记录。
   *
   * @param taskId 任务 id
   * @param update 纯函数：当前记录 → 新记录
   * @returns 新记录
   */
  async updateTask(
    taskId: string,
    update: (current: TaskRecord) => TaskRecord,
  ): Promise<TaskRecord> {
    return await this.domain.table('tasks').update(taskId, update)
  }

  // ---------------------------------------------------------------------
  // 执行记录
  // ---------------------------------------------------------------------

  /**
   * 插入一条执行记录。
   *
   * @param attempt 执行记录
   * @returns 无返回值
   */
  async insertAttempt(attempt: AttemptRecord): Promise<void> {
    await this.domain.table('attempts').put(attempt.id, attempt)
  }

  /**
   * 取执行记录。
   *
   * @param attemptId 执行记录 id
   * @returns 执行记录；不存在时是 undefined
   */
  getAttempt(attemptId: string): AttemptRecord | undefined {
    return this.domain.table('attempts').get(attemptId)
  }

  /**
   * 按 id 顺序列出某个任务的执行记录。
   *
   * @param taskId 任务 id
   * @returns 执行记录
   */
  listAttempts(taskId: string): AttemptRecord[] {
    const attempts: AttemptRecord[] = []
    for (const [, attempt] of this.domain.table('attempts').entries()) {
      if (attempt.taskId === taskId) attempts.push(attempt)
    }
    return attempts.sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  }

  /**
   * 原子更新一条执行记录。
   *
   * @param attemptId 执行记录 id
   * @param update 纯函数：当前记录 → 新记录
   * @returns 新记录
   */
  async updateAttempt(
    attemptId: string,
    update: (current: AttemptRecord) => AttemptRecord,
  ): Promise<AttemptRecord> {
    return await this.domain.table('attempts').update(attemptId, update)
  }

  // ---------------------------------------------------------------------
  // 附件
  // ---------------------------------------------------------------------

  /**
   * 插入一条附件元数据。
   *
   * @param attachment 附件记录
   * @returns 无返回值
   */
  async insertAttachment(attachment: AttachmentRecord): Promise<void> {
    await this.domain.table('attachments').put(attachment.id, attachment)
  }

  /**
   * 取附件元数据。
   *
   * @param attachmentId 附件 id
   * @returns 附件；不存在时是 undefined
   */
  getAttachment(attachmentId: string): AttachmentRecord | undefined {
    return this.domain.table('attachments').get(attachmentId)
  }

  /**
   * 列出某个作业的附件库（按创建时间升序）。
   *
   * @param jobId 作业 id
   * @returns 附件记录
   */
  listAttachments(jobId: string): AttachmentRecord[] {
    const attachments: AttachmentRecord[] = []
    for (const [, attachment] of this.domain.table('attachments').entries()) {
      if (attachment.jobId === jobId) attachments.push(attachment)
    }
    return attachments.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  // ---------------------------------------------------------------------
  // 作业队列与目录
  // ---------------------------------------------------------------------

  /**
   * 串行执行一个作业的状态变更。
   *
   * @param jobId 作业 id
   * @param task 异步任务
   * @returns 任务结果
   */
  runExclusive<T>(jobId: string, task: () => Promise<T>): Promise<T> {
    return this.queue.run(jobId, task)
  }

  /**
   * 当前有排队任务的作业数（诊断 / 测试用）。
   *
   * @returns 队列数量
   */
  get queueSize(): number {
    return this.queue.size
  }

  /**
   * 计算作业目录布局。
   *
   * @param jobId 作业 id
   * @returns 目录布局
   */
  paths(jobId: string): JobPaths {
    return jobPaths(this.dataDir, jobId)
  }

  /**
   * 建好作业目录。
   *
   * @param jobId 作业 id
   * @returns 目录布局
   */
  async ensureJobDirectories(jobId: string): Promise<JobPaths> {
    const paths = this.paths(jobId)
    await ensureJobDirectories(paths)
    return paths
  }

  /**
   * 写一份大文本到作业目录。
   *
   * @param jobId 作业 id
   * @param kind prompt / 结果
   * @param name 文件名
   * @param text 文本
   * @returns 相对作业根目录的路径
   */
  async writeText(
    jobId: string,
    kind: 'prompts' | 'results',
    name: string,
    text: string,
  ): Promise<string> {
    return await writeJobText(this.paths(jobId), kind, name, text)
  }

  /**
   * 读一份作业目录里的大文本。
   *
   * @param jobId 作业 id
   * @param relative 相对路径
   * @returns 文本；不存在时是 null
   */
  async readText(jobId: string, relative: string): Promise<string | null> {
    return await readJobText(this.paths(jobId), relative)
  }

  /**
   * 校验并返回一个安全的作业 id（路由参数用）。
   *
   * @param jobId 作业 id
   * @returns 原值
   */
  assertJobId(jobId: string): string {
    return assertSafeSegment(jobId, 'job id')
  }
}
