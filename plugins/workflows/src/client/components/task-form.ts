/**
 * 人任务动作表单：按所选动作的 `input` schema 渲染；没有表单的动作不需要填。
 *
 * 表单值放在 `state.taskForm.values`，切换动作时保留（提交只取当前动作的字段）。
 */

import type React from 'react'

import { h } from '../element.ts'
import type { AppContext } from '../page-context.ts'
import { renderJsonFallback, renderSchemaFields, schemaFields } from '../schema.ts'
import type { TaskDetail } from '../types.ts'
import { isRecord } from '../types.ts'

/**
 * 渲染动作表单：schema 字段 + 备注文本 + 错误提示。
 *
 * @param page 页面上下文
 * @param task 任务（只用于生成元素 id）
 * @param schema 所选动作的 input schema；null 表示这个动作没有表单
 * @returns React 元素数组
 */
export function renderTaskForm(
  page: AppContext,
  task: TaskDetail,
  schema: Record<string, unknown> | null,
): React.ReactElement[] {
  const { t, state, actions } = page
  const form = state.taskForm
  const elements: React.ReactElement[] = []
  const typed = isRecord(schema) ? schema : null
  if (typed !== null && schemaFields(typed as never).length > 0) {
    elements.push(
      ...renderSchemaFields(page, {
        schema: typed as never,
        values: form.values,
        onChange: actions.setTaskField,
        idPrefix: `buka-workflows-task-${task.id}`,
      }),
    )
  } else if (typed !== null) {
    elements.push(
      h(
        'div',
        { key: 'json', className: 'buka-workflows-field' },
        renderJsonFallback(
          page,
          form.values.__json ?? '',
          (next) => actions.setTaskField('__json', next),
          `buka-workflows-task-${task.id}-json`,
        ),
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
