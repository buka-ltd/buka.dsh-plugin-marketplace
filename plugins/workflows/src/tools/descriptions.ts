/**
 * 执行工具（`workflow_task_create` / `workflow_task_complete`）的说明文本。
 *
 * 同一条工具在两种会话里各注册一份：
 *
 * - 全局（其它会话）：通用说明，不列具体目标；
 * - 任务会话的 agent 作用域：说明里直接列出本任务可创建的目标 / 人任务的动作，
 *   遮蔽全局版本（见 `task-scope.ts`）。
 *
 * 两段共用的开头与结尾只写在这里，避免两处文案各写一遍。
 *
 * @module @buka/dsh-plugin-workflows/tools/descriptions
 */

import type { CreatableTarget, TaskAction } from '../domain/types.ts'

/** 创建工具的开头：两版共用。 */
const CREATE_HEAD =
  'Create a task in the current job (callable any number of times while executing a task).'
/** 创建工具的结尾：两版共用。 */
const CREATE_TAIL =
  'Dependencies default to the current task when omitted. The engine validates the content, dependencies (must exist in this job, no cycles) and the workflow budget.'

/** 全局会话看到的创建工具说明（任务会话会被同名的 scoped 版本遮蔽）。 */
export const DEFAULT_TASK_CREATE_DESCRIPTION = `${CREATE_HEAD} In a task session this description lists the targets the task can create; when none are listed, the task cannot create follow-up tasks. ${CREATE_TAIL}`

/** 提交工具的开头：两版共用。 */
const COMPLETE_HEAD =
  'Submit the result of the task this session is executing: a summary `text` plus optional attachments. There is no structured result schema.'

/** 全局会话看到的提交工具说明（任务会话会被同名的 scoped 版本遮蔽）。 */
export const DEFAULT_TASK_COMPLETE_DESCRIPTION = `${COMPLETE_HEAD} Handling a human task also needs the chosen \`action\` id and its form values in \`input\`; a task session lists the available actions in this description.`

/**
 * 生成 `workflow_task_create` 的说明：列出本任务可创建的 target、展示名与任务内容
 * schema。
 *
 * @param targets 可创建目标
 * @returns 工具说明
 */
export function taskCreateDescription(targets: readonly CreatableTarget[]): string {
  if (targets.length === 0) {
    return `${CREATE_HEAD} This task cannot create follow-up tasks. ${CREATE_TAIL}`
  }
  return [
    `${CREATE_HEAD} Targets this task can create:`,
    ...targets.map((target) => {
      const schema =
        target.content === undefined
          ? 'no content schema; pass {}'
          : `content schema: ${JSON.stringify(target.content)}`
      return `- ${target.target} (${target.label}) — ${schema}`
    }),
    CREATE_TAIL,
  ].join('\n')
}

/**
 * 生成 `workflow_task_complete` 的说明：人任务列出动作 id、展示名与输入表单 schema。
 *
 * @param actions 人任务动作；非人任务为空
 * @returns 工具说明
 */
export function taskCompleteDescription(actions: readonly TaskAction[]): string {
  if (actions.length === 0) return COMPLETE_HEAD
  return [
    COMPLETE_HEAD,
    'Human-task actions (pass the chosen id as `action` and the form values as `input`):',
    ...actions.map((action) => {
      const form =
        action.input === undefined
          ? 'no input form'
          : `input schema: ${JSON.stringify(action.input)}`
      return `- ${action.id} (${action.label}) — ${form}`
    }),
  ].join('\n')
}
