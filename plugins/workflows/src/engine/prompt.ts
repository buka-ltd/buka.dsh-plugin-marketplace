/**
 * 任务执行上下文组装。
 *
 * 一个任务 = 一条全新会话。执行提示词只包含三段，顺序固定：
 *
 * 1. 工作流基准规则（引擎注入的能力说明：读写资产、创建后续任务、提交结果）；
 * 2. 任务类型的定义：这个任务类型是谁、要做什么、有什么预设信息；
 * 3. 任务内容：创建者这一次给出的东西。
 *
 * 岗位名、通道 id、作业编号、依赖清单等属于编排与页面层的信息，不进入执行
 * 提示词，避免把「岗位 / 通道」这些构建工作流的概念暴露给执行者。
 *
 * 派发时三段拆成两条消息投递：规则 + 内容走非用户来源的上下文，只有任务类型
 * 的定义按用户身份投递（宿主只在这类消息里识别 `/skill-name` 手势）。落盘的
 * prompt 文件仍保存完整文本。
 *
 * 同时负责结束任务的投递文本。
 *
 * @module @buka/dsh-plugin-workflows/engine/prompt
 */

import { findTaskType } from '../definition/validate.ts'
import type {
  JobRecord,
  JsonValue,
  PositionDefinition,
  TaskRecord,
  TaskTypeDefinition,
  WorkflowDefinition,
} from '../domain/types.ts'

/** 任务执行提示的组装入参。 */
export interface ExecutionPromptInput {
  readonly task: TaskRecord
  readonly taskType: TaskTypeDefinition
}

/** 基准规则：能力说明，不暴露岗位 / 通道。 */
const BASELINE_RULES = [
  '## 工作流规则',
  '- 读取资产：`buka_job_attachments` 列出并读取本任务可用的附件；`buka_job_board` 查看本作业的任务，`buka_task_get` 读取某个任务。',
  '- 写入资产：提交结果时用 `buka_task_complete` 的 `attachments` 归档产出文件（path 相对你的工作目录）；`text` 写一段给人看的总结。',
  '- 创建后续任务：`buka_task_targets` 列出当前可创建的任务，`buka_task_create` 按 `target` 和 `content` 创建（不传 `deps` 时默认依赖本任务）；是否需要创建、创建什么，见下面的任务类型的定义。',
  '- 完成任务：用 `buka_task_complete` 交回一段总结；结果没有结构化契约。',
].join('\n')

/** 人任务助理的基准规则：代人处理，动作由人确认。 */
const ASSISTANT_RULES = [
  '## 工作流规则',
  '- 你代表人与执行者沟通，拿到人的决定后用 `buka_task_complete` 提交。',
  '- 读取资产：`buka_job_attachments` 列出并读取本任务可用的附件。',
  '- 写入资产：提交结果时用 `attachments` 归档产出文件（path 相对你的工作目录）。',
  '- 需要创建后续任务时，用 `buka_task_actions` 看这个任务可选的动作，用 `buka_task_complete` 带上 `action` 与 `input`。',
].join('\n')

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

/** 有内容时给出一段；空串 / 缺省时整段省略。 */
function textSection(title: string, text: string | undefined): string | null {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  return trimmed === '' ? null : `## ${title}\n${trimmed}`
}

/** 任务内容段：字符串原样，其余按 JSON 展示。 */
function contentSection(content: JsonValue): string {
  if (typeof content === 'string') return ['## 任务内容', content].join('\n')
  return ['## 任务内容', '```json', JSON.stringify(content, null, 2), '```'].join('\n')
}

/** 把非空段用空行拼起来。 */
function joinSections(sections: ReadonlyArray<string | null>): string {
  return sections.filter((section): section is string => section !== null).join('\n\n')
}

/**
 * 组装一个 agent 任务的完整 prompt。
 *
 * @param input 任务、岗位与任务类型
 * @returns prompt 文本
 */
export function buildExecutionPrompt(input: ExecutionPromptInput): string {
  return buildExecutionPromptSections(input).prompt
}

/**
 * 执行提示的拆分结果。
 *
 * 三段内容的作者不同，投递身份也不同：规则由插件生成、内容可能来自表单或上游
 * agent，两者都走非用户来源的上下文；只有流程维护者写的定义按用户身份投递，
 * 这样定义里的 `/skill-name` 才会被宿主识别。
 */
export interface ExecutionPromptSections {
  /** 规则 + 任务内容：用 `inject` 投递，来源不是 `user`。 */
  readonly context: string
  /** 任务类型的定义：用 `followup` 以用户身份投递；没有定义时是 null。 */
  readonly userPrompt: string | null
  /** 完整文本（规则 + 定义 + 内容）：落盘与排查用，顺序与旧版一致。 */
  readonly prompt: string
}

/**
 * 按作者拆分执行提示。
 *
 * @param input 任务、岗位与任务类型
 * @returns 完整文本、上下文段与用户提示段
 */
export function buildExecutionPromptSections(input: ExecutionPromptInput): ExecutionPromptSections {
  const { taskType, task } = input
  const definition = typeof taskType.definition === 'string' ? taskType.definition.trim() : ''
  const content = contentSection(task.content)
  return {
    context: joinSections([BASELINE_RULES, content]),
    userPrompt: definition === '' ? null : definition,
    prompt: joinSections([
      BASELINE_RULES,
      definition === '' ? null : `## 任务类型的定义\n${definition}`,
      content,
    ]),
  }
}

/**
 * 结束任务的投递文本：把最终报告交给发起人，等待确认。
 *
 * @param job 作业
 * @param task 结束任务
 * @returns 投递文本
 */
export function buildEndDeliveryText(job: JobRecord, task: TaskRecord): string {
  return [
    `工作流「${job.workflowName}」的作业 #${job.seq} 已经运行到最后一步，最终报告如下：`,
    '',
    contentSection(task.content),
    '',
    '如果这份报告就是你要的结果，调用 `buka_task_complete` 确认收到，作业即结束。',
  ].join('\n')
}

/**
 * 助理承办人任务的 prompt。
 *
 * @param input 任务、岗位与任务类型
 * @returns prompt 文本
 */
export function buildAssistantPrompt(input: ExecutionPromptInput): string {
  const { taskType, task } = input
  return joinSections([
    ASSISTANT_RULES,
    textSection('任务类型的定义', taskType.definition),
    contentSection(task.content),
  ])
}
