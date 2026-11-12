/**
 * 任务结果表单：按任务类型的 `output` schema 渲染（人任务 / 认领后提交共用）。
 */

import type React from 'react'

import { h } from '../element.ts'
import {
  currentDefinition,
  currentJobDefinition,
  mergedDefinition,
  outputSchemaFor,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { renderJsonFallback, renderSchemaFields, schemaFields } from '../schema.ts'
import type { TaskDetail } from '../types.ts'

/**
 * 渲染结果表单：schema 字段 + 说明 + 错误提示。
 *
 * @param page
 * @param task
 * @returns React 元素数组
 */
export function renderTaskForm(page: AppContext, task: TaskDetail): React.ReactElement[] {
  const { t, state, actions } = page
  const workflowDefinition = currentDefinition(state)
  const jobDefinition = mergedDefinition(currentJobDefinition(state), workflowDefinition)
  const schema = outputSchemaFor(jobDefinition, workflowDefinition, task)
  const form = state.taskForm
  const elements: React.ReactElement[] = []
  if (schemaFields(schema).length > 0) {
    elements.push(
      ...renderSchemaFields(page, {
        schema,
        values: form.values,
        onChange: actions.setTaskField,
        idPrefix: `buka-workflows-task-${task.id}`,
      }),
    )
  } else {
    elements.push(
      h('p', { className: 'buka-workflows-hint', key: 'no-schema' }, t('actionFormNoSchema')),
      renderJsonFallback(
        page,
        form.values.__json ?? '',
        (next) => actions.setTaskField('__json', next),
        `buka-workflows-task-${task.id}-json`,
      ),
    )
  }
  elements.push(
    h(
      'div',
      { key: 'text', className: 'buka-workflows-field' },
      h(
        'label',
        { className: 'buka-workflows-fieldLabel', htmlFor: `buka-workflows-task-${task.id}-text` },
        t('actionTextLabel'),
      ),
      h('textarea', {
        id: `buka-workflows-task-${task.id}-text`,
        className: 'buka-workflows-textarea',
        rows: 2,
        value: form.text,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          actions.setTaskText(event.target.value),
      }),
    ),
  )
  if (form.error !== null) {
    elements.push(
      h('p', { key: 'error', className: 'buka-workflows-formError', role: 'alert' }, form.error),
    )
  }
  return elements
}
