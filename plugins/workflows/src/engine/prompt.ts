/**
 * 任务执行提示组装。
 *
 * 一个任务 = 一条全新会话。v9 起的执行提示只有两段：
 *
 * 1. 上下文（非用户来源的 `inject`）：工作流规则（引擎注入的能力说明）与工作树
 *    规则（仅任务类型的 `worktree` 不是 `none` 时出现）；
 * 2. 用户消息（`followup`，来源是 `user`）：任务类型的定义按本任务的任务内容渲染
 *    后的文本。定义省略时，用户消息就是整份任务内容——它才是这一次的具体指令。
 *
 * 代入值（任务内容可能来自表单或上游 agent）要转义 `/skill-name` 手势：定义原文
 * 里的手势由流程维护者写，仍然生效；代入值里的不能借用户身份触发 skill
 * （ADR 0033 / ADR 0024 的取代关系）。
 *
 * 岗位名、通道 id、作业编号、依赖清单等属于编排与页面层的信息，不进入执行
 * 提示，避免把「岗位 / 通道」这些构建工作流的概念暴露给执行者。
 *
 * v8 及更早的作业快照仍按旧语义组装（上下文 = 规则 + 内容，用户消息 = 定义原文），
 * 保证升级时运行中的作业照常跑完。
 *
 * 同时负责结束任务的投递文本与助理会话的固定提示。
 *
 * @module @buka/dsh-plugin-workflows/engine/prompt
 */

import { findTaskType } from '../definition/validate.ts'
import {
  DEFINITION_TEMPLATE_VERSION,
  DEFINITION_VERSION,
  type JobRecord,
  type JsonValue,
  type PositionDefinition,
  type TaskRecord,
  type TaskTypeDefinition,
  type WorkflowDefinition,
} from '../domain/types.ts'
import { escapeSkillGestures, renderTemplate } from '../template.ts'

/**
 * 任务类型配置了工作树模式时，执行提示词里的工作树段。
 *
 * - `create`：宿主启用了工作树能力，要求执行者自己按仓库调用 `create_worktree`；
 * - `guard`：只做工作区保护检查（显式选择，或 `create` 在能力缺失时降级）。
 */
export type WorktreePromptMode = 'create' | 'guard'

/** 任务执行提示的组装入参。 */
export interface ExecutionPromptInput {
  readonly task: TaskRecord
  readonly taskType: TaskTypeDefinition
  /** 任务类型要求工作树时的实际形态；没有配置时不传。 */
  readonly worktree?: WorktreePromptMode | undefined
  /** 作业快照的定义版本；省略按当前版本（v9）处理。 */
  readonly definitionVersion?: number | undefined
}

/** 基准规则：能力说明，不暴露岗位 / 通道。 */
const BASELINE_RULES = [
  '## 工作流规则',
  '- 读取资产：`workflow_job_attachments` 列出并读取本任务可用的附件；`workflow_job_board` 查看本作业的任务，`workflow_task_get` 读取某个任务。',
  '- 写入资产：提交结果时用 `workflow_task_complete` 的 `attachments` 归档产出文件（path 相对你的工作目录）；`text` 写一段给人看的总结。',
  '- 创建后续任务：`workflow_task_create` 创建后续任务（不传 `deps` 时默认依赖本任务）；可创建的目标与任务内容格式见该工具的说明。',
  '- 完成任务：用 `workflow_task_complete` 交回一段总结；结果没有结构化契约。',
].join('\n')

/** 工作树生效时的规则：执行者自己按仓库调用 `create_worktree`，不要直接改原检出。 */
const WORKTREE_RULES = [
  '## 工作树',
  '本任务需要改动代码时，不要直接修改原检出：先进入要修改的仓库目录，调用 `create_worktree` 新建并进入它的 Git 工作树，之后的读写和命令都在这个工作树里进行。任务涉及多个仓库时，对每个仓库分别创建 worktree；需要换仓库时先用 `working_directory` 切到那个仓库的目录。同一个仓库只创建一个工作树，任务结束前不要删除检出。',
].join('\n')

/** 保护检查规则：不创建 worktree，先看工作区有没有未提交的修改，有就停下来问。 */
const WORKTREE_GUARD_RULES = [
  '## 工作区',
  '本任务不创建新的工作树。开始前先检查当前工作区以及任务要修改的每个仓库是否有未提交的修改；如果有，必须停下来询问用户，得到明确答复前不要开始改动。',
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

/** 工作树段：按实际形态选一条规则；没有配置工作树返回 null。 */
function worktreeSection(mode: WorktreePromptMode | undefined): string | null {
  if (mode === 'create') return WORKTREE_RULES
  if (mode === 'guard') return WORKTREE_GUARD_RULES
  return null
}

/** 任务内容段（v8 快照用）：字符串原样，其余按 JSON 展示。 */
function contentSection(content: JsonValue): string {
  if (typeof content === 'string') return ['## 任务内容', content].join('\n')
  return ['## 任务内容', '```json', JSON.stringify(content, null, 2), '```'].join('\n')
}

/** 把非空段用空行拼起来。 */
function joinSections(sections: ReadonlyArray<string | null>): string {
  return sections.filter((section): section is string => section !== null).join('\n\n')
}

/**
 * 渲染一个任务的用户消息：定义是模板时就按任务内容渲染；定义省略时就是整份
 * 任务内容。返回的文本已经转义过 `/skill-name` 手势。
 *
 * 定义渲染成空白（例如只引用可选字段且值都缺失）时同样退回整份任务内容：用户
 * 消息永远非空，执行者不会收到一条空指令。
 *
 * @param taskType 任务类型（定义可能是模板）
 * @param content 任务内容
 * @returns 用户消息；任何情况下都不是空串
 */
export function renderTaskTypeDefinition(
  taskType: TaskTypeDefinition,
  content: JsonValue | undefined,
): string {
  const definition = typeof taskType.definition === 'string' ? taskType.definition.trim() : ''
  if (definition !== '') {
    const rendered = renderTemplate(definition, { content: content ?? null }, { escape: true })
    if (rendered.trim() !== '') return rendered
  }
  const rendered = renderTemplate('{{content}}', { content: content ?? null }, { escape: true })
  if (rendered.trim() !== '') return rendered
  // 空字符串内容也要有一条非空消息；JSON 字面量仍算「整份内容」。
  return escapeSkillGestures(JSON.stringify(content ?? null))
}

/** 执行提示的拆分结果。 */
export interface ExecutionPromptSections {
  /** 规则（+ 工作树）：用 `inject` 投递，来源不是 `user`。 */
  readonly context: string
  /**
   * 用户消息：定义渲染结果或整份任务内容，用 `followup` 以用户身份投递。
   *
   * v8 快照没有定义时是 null（旧行为：只发一条上下文消息）。
   */
  readonly userPrompt: string | null
  /** 完整文本（上下文 + 用户消息）：落盘与排查用，顺序与到达顺序一致。 */
  readonly prompt: string
}

/**
 * 组装一个 agent 任务的完整 prompt（落盘文本）。
 *
 * @param input 任务、岗位与任务类型
 * @returns prompt 文本
 */
export function buildExecutionPrompt(input: ExecutionPromptInput): string {
  return buildExecutionPromptSections(input).prompt
}

/**
 * 按投递身份拆分执行提示。
 *
 * @param input 任务、岗位与任务类型
 * @returns 完整文本、上下文段与用户消息段
 */
export function buildExecutionPromptSections(input: ExecutionPromptInput): ExecutionPromptSections {
  // v9 起定义是模板；更早的作业快照按旧语义组装。
  if ((input.definitionVersion ?? DEFINITION_VERSION) < 9)
    return legacyExecutionPromptSections(input)

  const context = joinSections([BASELINE_RULES, worktreeSection(input.worktree)])
  const userPrompt = renderTaskTypeDefinition(input.taskType, input.task.content)
  return { context, userPrompt, prompt: joinSections([context, userPrompt]) }
}

/** v8 及更早快照的旧拆分：上下文 = 规则 + 内容，用户消息 = 定义原文。 */
function legacyExecutionPromptSections(input: ExecutionPromptInput): ExecutionPromptSections {
  const definition =
    typeof input.taskType.definition === 'string' ? input.taskType.definition.trim() : ''
  const content = contentSection(input.task.content)
  const worktree = worktreeSection(input.worktree)
  return {
    context: joinSections([BASELINE_RULES, worktree, content]),
    userPrompt: definition === '' ? null : definition,
    prompt: joinSections([
      BASELINE_RULES,
      worktree,
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
  if (job.definition.version >= DEFINITION_TEMPLATE_VERSION) {
    return renderTemplate(
      [
        `工作流「${job.workflowName}」的作业 #${job.seq} 已经运行到最后一步，最终报告如下：`,
        '',
        '{{content}}',
        '',
        '如果这份报告就是你要的结果，调用 `workflow_task_complete` 确认收到，作业即结束。',
      ].join('\n'),
      { content: task.content ?? null },
      { escape: true },
    )
  }
  return [
    `工作流「${job.workflowName}」的作业 #${job.seq} 已经运行到最后一步，最终报告如下：`,
    '',
    contentSection(task.content),
    '',
    '如果这份报告就是你要的结果，调用 `workflow_task_complete` 确认收到，作业即结束。',
  ].join('\n')
}

/**
 * 助理承办人任务的固定提示。
 *
 * 助理只负责对接处理人；任务内容用 `workflow_task_get` 读，人任务的动作见
 * `workflow_task_complete` 的工具说明（由宿主列出工具）。
 *
 * @param input 任务与任务类型
 * @returns 提示文本
 */
export function buildAssistantPrompt(input: ExecutionPromptInput): string {
  return `请你负责对接任务「${input.taskType.label}」（${input.task.id}）的处理人，并严格执行处理人对于该任务的决策。`
}
