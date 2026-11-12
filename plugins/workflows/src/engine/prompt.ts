/**
 * 任务执行上下文组装（`.tmp/workflow-v4-spec.md` §7.6）。
 *
 * 一个任务 = 一条全新会话，上下文由引擎按依赖与任务契约组装：
 *
 * 1. 岗位说明；
 * 2. 任务类型说明；
 * 3. 渲染后的 payload；
 * 4. 依赖任务摘要与可见附件清单；
 * 5. 产出契约（output schema + `buka_task_complete` + 附件规则）；
 * 6. 可派发的直接后继岗位 / 类型白名单。
 *
 * 同时负责开始任务的「原始输入 → 结构化输入」提示与结束任务的投递文本。
 *
 * @module @buka/dsh-plugin-workflows/engine/prompt
 */

import { clipUtf8, visibleAttachmentsForTask } from '../attachments/index.ts'
import { buildTemplateContext, renderPayload } from '../definition/payload.ts'
import { findTaskType } from '../definition/validate.ts'
import type {
  AttachmentRecord,
  JobRecord,
  JsonValue,
  PositionDefinition,
  TaskRecord,
  TaskTypeDefinition,
  WorkflowDefinition,
} from '../domain/types.ts'
import { schemaJson } from '../output.ts'

/** 依赖摘要里单段文本的上限。 */
const PREVIEW_BYTES = 1200

/** prompt 组装入参。 */
export interface ExecutionPromptInput {
  readonly job: JobRecord
  readonly task: TaskRecord
  readonly position: PositionDefinition
  readonly taskType: TaskTypeDefinition
  readonly tasks: readonly TaskRecord[]
  readonly attachments: readonly AttachmentRecord[]
  readonly workspace: string | undefined
}

/**
 * 按任务类型取岗位（任务的岗位在定义里唯一）。
 *
 * @param definition 定义
 * @param positionId 岗位 id
 * @returns 岗位；不存在时 undefined
 */
export function positionOf(
  definition: WorkflowDefinition,
  positionId: string,
): PositionDefinition | undefined {
  return definition.positions.find((position) => position.id === positionId)
}

/**
 * 任务类型的展示名。
 *
 * @param definition 定义
 * @param typeId 任务类型 id
 * @returns 展示名；未知时用 id
 */
export function taskTypeLabel(definition: WorkflowDefinition, typeId: string): string {
  if (typeId === 'start') return '启动任务'
  if (typeId === 'end') return '结束任务'
  return findTaskType(definition, typeId)?.label ?? typeId
}

/**
 * 岗位的展示名。
 *
 * @param definition 定义
 * @param positionId 岗位 id
 * @returns 展示名；内建节点给中文名
 */
export function positionLabel(definition: WorkflowDefinition, positionId: string): string {
  if (positionId === 'start') return '开始'
  if (positionId === 'end') return '结束'
  return positionOf(definition, positionId)?.label ?? positionId
}

/**
 * 渲染一个任务的 payload 模板。
 *
 * @param payload 原始 payload（可能含模板）
 * @param tasks 作业里的全部任务
 * @returns 渲染后的 payload
 */
export function renderTaskPayload(payload: JsonValue, tasks: readonly TaskRecord[]): JsonValue {
  const start = tasks.find((task) => task.id === '$start')
  const values = new Map<string, { output?: unknown; text?: string }>()
  for (const task of tasks) {
    values.set(task.id, {
      ...(task.result?.output === null || task.result?.output === undefined
        ? {}
        : { output: task.result.output }),
      ...(task.result?.text === undefined ? {} : { text: task.result.text }),
    })
  }
  const context = buildTemplateContext({
    startOutput: start?.result?.output ?? null,
    tasks: values,
  })
  return renderPayload(payload, context) as JsonValue
}

/**
 * 一段任务结果的摘要（id / 类型 / 状态 / 文本 / 结构化结果）。
 *
 * @param task 任务记录
 * @param definition 作业定义
 * @returns 可读摘要
 */
export function summarizeTaskResult(task: TaskRecord, definition: WorkflowDefinition): string {
  const lines = [
    `- task ${task.id} [${task.status}] ${positionLabel(definition, task.position)} / ${taskTypeLabel(definition, task.type)}`,
  ]
  if (task.error !== null) lines.push(`  error: ${clipUtf8(task.error, PREVIEW_BYTES)}`)
  const text = task.result?.text ?? ''
  if (text.trim() !== '') lines.push(`  text: ${clipUtf8(text.trim(), PREVIEW_BYTES)}`)
  if (task.result?.output !== null && task.result?.output !== undefined) {
    lines.push(`  output: ${clipUtf8(JSON.stringify(task.result.output), PREVIEW_BYTES)}`)
  }
  return lines.join('\n')
}

/**
 * 可派发的直接后继：目标岗位 + 允许的任务类型。
 *
 * @param definition 定义
 * @param fromPosition 创建者岗位
 * @returns 后继说明
 */
export function successorLines(definition: WorkflowDefinition, fromPosition: string): string[] {
  const lines: string[] = []
  for (const edge of definition.edges) {
    if (edge.from !== fromPosition) continue
    if (edge.to === 'end') {
      lines.push('- end（结束任务：payload 为最终交付物，投递即完成）')
      continue
    }
    const position = positionOf(definition, edge.to)
    if (position === undefined) continue
    const types = edge.types ? edge.types : position.taskTypes.map((taskType) => taskType.id)
    const labels = types.map((type) => `${type}（${taskTypeLabel(definition, type)}）`).join('、')
    lines.push(`- ${position.id}（${position.label}）: ${labels}`)
  }
  return lines
}

/**
 * 组装一个 agent 任务的完整 prompt。
 *
 * @param input 任务、定义与依赖信息
 * @returns prompt 文本
 */
export function buildExecutionPrompt(input: ExecutionPromptInput): string {
  const { job, task, position, taskType } = input
  const definition = job.definition
  const payload = renderTaskPayload(task.payload, input.tasks)
  const dependencies = task.deps
    .map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId))
    .filter((candidate): candidate is TaskRecord => candidate !== undefined)
  const dependencyText =
    dependencies.length === 0
      ? '（无依赖任务）'
      : dependencies.map((dependency) => summarizeTaskResult(dependency, definition)).join('\n')
  const attachments = visibleAttachmentsForTask(input.tasks, task.id, input.attachments)
  const attachmentLines =
    attachments.length === 0
      ? '（依赖任务没有可见附件）'
      : attachments
          .map(
            (attachment) =>
              `- ${attachment.id} · ${attachment.name} (${attachment.bytes} bytes${attachment.mime === '' ? '' : `, ${attachment.mime}`})${attachment.description === '' ? '' : ` · ${attachment.description}`}`,
          )
          .join('\n')
  const successors = successorLines(definition, position.id)
  const jobRef = `作业 #${job.seq}「${job.workflowName}」 · task ${task.id}`

  return [
    `你正在执行工作流${jobRef}。`,
    '',
    '## 岗位',
    `- ${position.label}（${position.id}）${position.description === undefined ? '' : `：${position.description}`}`,
    '',
    '## 任务类型',
    `- ${taskType.label}（${taskType.id}）${taskType.description === undefined ? '' : `：${taskType.description}`}`,
    '',
    '## 任务 payload',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '## 依赖任务结果',
    dependencyText,
    '',
    '## 可见附件',
    attachmentLines,
    input.workspace === undefined ? '' : `附件源文件路径相对你的工作目录：${input.workspace}`,
    '',
    '## 产出契约',
    '完成后必须调用 `buka_task_complete` 提交结果：',
    '- `output`：一个 JSON 对象，匹配下面的 schema；',
    '- `text`：可选，一段给人看的文本摘要；',
    '- `attachments`：可选，需要归档的独立文件清单（`{ path, name?, description? }`，path 相对你的工作目录）；附件不是答案本身。',
    '```json',
    schemaJson(taskType.output),
    '```',
    '',
    '## 你可以派发的任务',
    '执行期间可以随时调用 `buka_task_create` 往本作业看板创建任务（可多次），参数：position、type、payload、deps。',
    'deps 只能引用本作业里已创建的任务 id（包括刚创建但未完成的任务）；依赖图不能成环。',
    ...(successors.length === 0 ? ['- （本岗位没有后继岗位）'] : successors),
    '',
    '## 只读工具',
    '`buka_job_board` 读取整个作业看板，`buka_task_get` 读取某个任务与依赖结果，`buka_job_attachments` 检索 / 读取可见附件。',
    taskType.mode === 'plan'
      ? '本次任务以 plan 模式开始：先探索并提交计划，用户批准后继续实施。'
      : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * 开始任务的执行提示：把原始输入转换成第一个结构化输入。
 *
 * @param job 作业
 * @returns prompt 文本
 */
export function buildStartTaskPrompt(job: JobRecord): string {
  const start = job.definition.start
  return [
    `工作流「${job.workflowName}」的启动任务（作业 #${job.seq}）由你执行：把原始输入转换成第一个结构化输入，后续任务只读这份结构化输入。`,
    '',
    '## 原始输入',
    '```json',
    JSON.stringify(job.input.raw, null, 2),
    '```',
    '',
    '## 产出契约（启动任务）',
    '完成后调用 `buka_task_complete` 提交 `output`，它是一个 JSON 对象，匹配下面的 schema：',
    '```json',
    schemaJson(start.task.output),
    '```',
    job.definition.description === undefined ? '' : `工作流说明：${job.definition.description}`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * 结束任务的投递文本：把最终交付物交给启动者。
 *
 * @param job 作业
 * @param task 结束任务
 * @returns 投递文本
 */
export function buildEndDeliveryText(job: JobRecord, task: TaskRecord): string {
  return [
    `工作流「${job.workflowName}」的作业 #${job.seq} 已完成，最终交付物如下：`,
    '```json',
    JSON.stringify(task.payload, null, 2),
    '```',
  ].join('\n')
}

/**
 * 助理承办人任务的 prompt。
 *
 * @param input 任务与定义
 * @returns prompt 文本
 */
export function buildAssistantPrompt(input: ExecutionPromptInput): string {
  const { job, task, position, taskType } = input
  const payload = renderTaskPayload(task.payload, input.tasks)
  const dependencies = task.deps
    .map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId))
    .filter((candidate): candidate is TaskRecord => candidate !== undefined)
  const dependencyText =
    dependencies.length === 0
      ? '（无依赖任务）'
      : dependencies.map((dependency) => summarizeTaskResult(dependency, job.definition)).join('\n')
  return [
    `你被指派为工作流「${job.workflowName}」作业 #${job.seq} 的人任务助理。执行者是人：${position.label}（${position.id}）。`,
    '你的职责：代表这条任务与人沟通（按你自己的 skill 选择方式），拿到人给出的决定 / 结果后，调用 `buka_task_complete` 提交。',
    '你只能读取并完成这条任务，不能往工作流派任务。',
    '',
    '## 任务类型',
    `- ${taskType.label}（${taskType.id}）${taskType.description === undefined ? '' : `：${taskType.description}`}`,
    '',
    '## 任务 payload',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '## 依赖任务结果',
    dependencyText,
    '',
    '## 产出契约',
    '完成后调用 `buka_task_complete`，`output` 必须是匹配下面 schema 的 JSON 对象：',
    '```json',
    schemaJson(taskType.output),
    '```',
    '如果人迟迟不回复或你无法完成，直接结束本轮即可：任务会回到待认领，由人自己处理。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
