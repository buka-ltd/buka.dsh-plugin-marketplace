/**
 * `buka_workflow` 存储域（version 1）：workflows / jobs / tasks / attempts /
 * attachments 五张表的声明。
 *
 * 用官方 `@deepseek-ai/dsh-storage-domain` 的 `defineDomain` / `domainTable`：
 * 记录在打开时按 zod schema 校验，写入先在内存里提交再异步落盘，读是同步的。
 * 用 `per-record` 布局：一条任务一个文档，回看 / 更新单条任务不必重写整个域。
 *
 * schema 只校验稳定的身份与状态字段；嵌套的 `definition` / `payload` / 结果
 * 用宽松对象（校验在保存与执行路径上分别进行），避免每次重启都重复完整定义校验。
 *
 * @module @buka/dsh-plugin-workflows/store/schema
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

import type {
  AttachmentRecord,
  AttemptRecord,
  JobRecord,
  TaskRecord,
  WorkflowDefinition,
  WorkflowRecord,
} from '../domain/types.ts'

/** 当前域版本。记录格式变化时递增并补迁移入口（见 `store/index.ts` 的 `init`）。 */
export const WORKFLOW_DOMAIN_VERSION = 1

/** 域名称；与 storage backend 里的 unit 名一致。 */
export const WORKFLOW_DOMAIN_NAME = 'buka_workflow'

/** 宽松对象：嵌套结构的完整校验在各自的使用路径上做。 */
const looseObject = z.record(z.string(), z.unknown())

/** 任务 / 作业 / 工作流状态。 */
const workflowStatusSchema = z.enum(['draft', 'active', 'retired'])
const jobStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled'])
const taskStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'completed',
  'failed',
  'blocked',
  'cancelled',
])

/** 执行者：机器人或人。 */
const storedExecutorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('robot'),
      name: z.string(),
      driver: z.enum(['agent', 'program']),
      program: z.string().optional(),
      avatar: z.string().optional(),
    })
    .passthrough(),
  z.object({ kind: z.literal('human') }).passthrough(),
  z.object({ kind: z.literal('session'), sessionId: z.string() }).passthrough(),
])

/** 承办者。 */
const claimantSchema = z
  .object({
    kind: z.enum(['human', 'robot', 'assistant']),
    name: z.string(),
    sessionId: z.string().nullable(),
  })
  .passthrough()

/** 启动者。 */
const starterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human') }).passthrough(),
  z.object({ kind: z.literal('session'), sessionId: z.string() }).passthrough(),
])

/** 任务结果。 */
const taskResultSchema = z
  .object({
    output: z.unknown().nullable(),
    text: z.string(),
    textBytes: z.number().int().nonnegative(),
    textFile: z.string().nullable(),
    attachmentIds: z.array(z.string()),
  })
  .passthrough()

/** 工作流版本快照。 */
const workflowVersionSchema = z
  .object({
    version: z.number().int().positive(),
    definition: looseObject,
    createdAt: z.string(),
  })
  .passthrough()

/** workflows 表记录。 */
const workflowRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string(),
    status: workflowStatusSchema,
    latestVersion: z.number().int().positive(),
    versions: z.record(z.string(), workflowVersionSchema),
    jobSeq: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()

/** jobs 表记录。 */
const jobRecordSchema = z
  .object({
    id: z.string().min(1),
    seq: z.number().int().positive(),
    workflowId: z.string().min(1),
    workflowVersion: z.number().int().positive(),
    workflowName: z.string(),
    workflowDescription: z.string(),
    definition: looseObject,
    status: jobStatusSchema,
    starter: starterSchema,
    input: z.object({ raw: z.unknown(), structured: z.unknown().optional() }).passthrough(),
    inputSummary: z.string(),
    error: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .passthrough()

/** tasks 表记录。 */
const taskRecordSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    position: z.string().min(1),
    type: z.string().min(1),
    payload: z.unknown(),
    deps: z.array(z.string()),
    status: taskStatusSchema,
    createdBy: z.object({ taskId: z.string(), position: z.string() }).passthrough().nullable(),
    assignee: storedExecutorSchema,
    claimant: claimantSchema.nullable(),
    attemptIds: z.array(z.string()),
    result: taskResultSchema.nullable(),
    error: z.string().nullable(),
    assistantBlocked: z.boolean(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .passthrough()

/** attempts 表记录。 */
const attemptRecordSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    taskId: z.string().min(1),
    sessionId: z.string().nullable(),
    startSeq: z.number().int().nonnegative().nullable(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    stopReason: z.string().nullable(),
    error: z.string().nullable(),
    promptFile: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .passthrough()

/** attachments 表记录。 */
const attachmentRecordSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    name: z.string(),
    bytes: z.number().int().nonnegative(),
    mime: z.string(),
    sha256: z.string(),
    description: z.string(),
    sourceTaskId: z.string().min(1),
    sourcePositionId: z.string().min(1),
    createdBy: z.string(),
    createdAt: z.string(),
    path: z.string(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough()

/**
 * `buka-workflow` 域声明。表记录类型与 `domain/types.ts` 的 TS 接口一一对应；
 * zod 输出只用于运行时校验，消费方仍用 TS 接口。
 */
export const workflowDomain = defineDomain({
  name: WORKFLOW_DOMAIN_NAME,
  version: WORKFLOW_DOMAIN_VERSION,
  layout: 'per-record',
  tables: {
    workflows: domainTable<string, WorkflowRecord>(
      workflowRecordSchema as unknown as z.ZodType<WorkflowRecord>,
    ),
    jobs: domainTable<string, JobRecord>(jobRecordSchema as unknown as z.ZodType<JobRecord>),
    tasks: domainTable<string, TaskRecord>(taskRecordSchema as unknown as z.ZodType<TaskRecord>),
    attempts: domainTable<string, AttemptRecord>(
      attemptRecordSchema as unknown as z.ZodType<AttemptRecord>,
    ),
    attachments: domainTable<string, AttachmentRecord>(
      attachmentRecordSchema as unknown as z.ZodType<AttachmentRecord>,
    ),
  },
})

/** 域里的一条定义快照；供按版本读取。 */
export interface StoredWorkflowDefinition {
  readonly version: number
  readonly definition: WorkflowDefinition
}
