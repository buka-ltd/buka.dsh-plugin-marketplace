/**
 * 工作流页的「任务类型」Tab：左侧逐个列出定义里的全部任务类型，右侧展示
 * 所选类型的完整信息。
 *
 * 开始 / 结束是内建任务类型，与岗位任务类型混在同一个列表里，用 id 区分，
 * 不再额外分类。左侧只负责选，右侧回答一个问题：这个任务类型是什么、收
 * 什么、交什么、由谁处理。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { currentDefinition, type PositionView, positionsOf, taskTypeLabels } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type {
  ActionDefinition,
  JsonSchema,
  TaskTypeDefinition,
  WorkflowDefinition,
} from '../types.ts'
import {
  renderContractOrDash,
  renderCreationTags,
  renderInitialTasks,
  renderTaskTypeTags,
} from './definition-parts.ts'
import {
  ClampedText,
  renderEmpty,
  renderExecutor,
  renderFailure,
  renderKv,
  renderLoading,
  renderSection,
} from './parts.ts'

/** 列表里的一个任务类型。 */
interface TypeEntry {
  /** 页签内稳定的选中键：`start` / `end` / `<positionId>/<typeId>`。 */
  key: string
  id: string
  label: string
  kind: 'start' | 'end' | 'position'
  position: PositionView | null
  type: TaskTypeDefinition | null
}

/**
 * 把定义展开成左侧的平铺列表。
 *
 * @param page 页面上下文
 * @param definition 定义快照
 * @returns 内建开始 / 结束在前，岗位任务类型按定义顺序在后
 */
function taskTypes(page: AppContext, definition: WorkflowDefinition): TypeEntry[] {
  const entries: TypeEntry[] = [
    {
      key: 'start',
      id: 'start',
      label: page.t('startTaskTitle'),
      kind: 'start',
      position: null,
      type: null,
    },
    {
      key: 'end',
      id: 'end',
      label: page.t('endTaskTitle'),
      kind: 'end',
      position: null,
      type: null,
    },
  ]
  for (const position of positionsOf(definition)) {
    for (const type of position.taskTypes) {
      const id = typeof type.id === 'string' ? type.id : ''
      if (id === '') continue
      entries.push({
        key: `${position.id}/${id}`,
        id,
        label: typeof type.label === 'string' && type.label !== '' ? type.label : id,
        kind: 'position',
        position,
        type,
      })
    }
  }
  return entries
}

/** 详情头部：展示名 + id + 能力标签。 */
function renderHead(entry: TypeEntry, tags: React.ReactNode): React.ReactElement {
  return h(
    'header',
    { className: 'buka-workflows-typesHead' },
    h(
      'div',
      { className: 'buka-workflows-typesTitleRow' },
      h('h2', { className: 'buka-workflows-typesTitle' }, entry.label),
      h('code', { className: 'buka-workflows-inlineCode' }, entry.id),
    ),
    tags,
  )
}

/** 内建任务类型的详情：固定说明、处理人与契约。 */
function renderBuiltinDetail(
  page: AppContext,
  entry: TypeEntry,
  definition: WorkflowDefinition,
  labels: Map<string, string>,
  builtin: { start: string; end: string },
): React.ReactNode {
  const { t } = page
  const isStart = entry.kind === 'start'
  return h(
    'div',
    { className: 'buka-workflows-typesBody' },
    renderHead(
      entry,
      h(
        'span',
        { className: 'buka-workflows-typeTags' },
        h(Tag, { tone: 'info' }, t('builtinTypeTag')),
      ),
    ),
    h('p', { className: 'buka-workflows-typeDesc' }, t('builtinTypeHint')),
    h(
      'p',
      { className: 'buka-workflows-sectionHint' },
      isStart ? t('startContractHint') : t('endContractHint'),
    ),
    renderKv([[t('definitionHandler'), isStart ? t('boardEngine') : t('endHandlerHint')]]),
    renderSection(
      isStart ? t('startContentTitle') : t('endContentTitle'),
      renderContractOrDash(page, isStart ? definition.start?.content : definition.end?.content),
    ),
    isStart
      ? renderSection(
          t('definitionInitialTasks'),
          renderInitialTasks(page, definition, labels, builtin),
        )
      : null,
  )
}

/** 一条人任务动作：名称、id、表单与创建声明。 */
function renderAction(
  page: AppContext,
  action: ActionDefinition,
  index: number,
  definition: WorkflowDefinition,
  labels: Map<string, string>,
): React.ReactElement {
  const { t } = page
  const id = typeof action.id === 'string' ? action.id : ''
  const label =
    typeof action.label === 'string' && action.label !== ''
      ? action.label
      : id === ''
        ? t('taskTypeUnset')
        : id
  const input: JsonSchema | null = action.input ?? null
  const creates = Array.isArray(action.creates) ? action.creates : []
  return h(
    'div',
    { key: id === '' ? `action-${index}` : id, className: 'buka-workflows-actionDef' },
    h(
      'div',
      { className: 'buka-workflows-actionHead' },
      h('span', { className: 'buka-workflows-typeName' }, label),
      id === '' ? null : h('code', { className: 'buka-workflows-inlineCode' }, id),
    ),
    input === null
      ? null
      : h(
          'div',
          { className: 'buka-workflows-actionPart' },
          h('span', { className: 'buka-workflows-subLabel' }, t('taskTypeActionForm')),
          renderContractOrDash(page, input),
        ),
    creates.length === 0
      ? null
      : h(
          'div',
          { className: 'buka-workflows-actionPart' },
          h('span', { className: 'buka-workflows-subLabel' }, t('taskTypeActionCreates')),
          renderCreationTags(page, creates, definition, labels),
        ),
  )
}

/** 岗位任务类型的详情：所属岗位、定义模板与完整契约。 */
function renderPositionDetail(
  page: AppContext,
  entry: TypeEntry,
  definition: WorkflowDefinition,
  labels: Map<string, string>,
): React.ReactNode {
  const { t } = page
  const type = entry.type
  const position = entry.position
  if (type === null || position === null) return null
  const actions = Array.isArray(type.actions) ? type.actions : []
  const creates = Array.isArray(type.creates) ? type.creates : []
  return h(
    'div',
    { className: 'buka-workflows-typesBody' },
    renderHead(entry, renderTaskTypeTags(page, type)),
    renderKv([
      [
        t('taskTypePosition'),
        h(
          'span',
          { className: 'buka-workflows-inlineGroup' },
          h('span', null, position.label),
          h('span', { className: 'buka-workflows-hint' }, renderExecutor(page, position.executor)),
        ),
      ],
    ]),
    typeof type.definition === 'string' && type.definition !== ''
      ? renderSection(
          t('taskTypeDefinition'),
          h(ClampedText, {
            text: type.definition,
            className: 'buka-workflows-drawerText',
            expandLabel: t('expandText'),
            collapseLabel: t('collapseText'),
          }),
        )
      : null,
    renderSection(t('taskTypeContent'), renderContractOrDash(page, type.content)),
    actions.length === 0
      ? null
      : renderSection(
          t('taskTypeActions'),
          h(
            'div',
            { className: 'buka-workflows-actionList' },
            ...actions.map((action, index) =>
              renderAction(page, action, index, definition, labels),
            ),
          ),
        ),
    creates.length === 0
      ? null
      : renderSection(t('taskTypeCreates'), renderCreationTags(page, creates, definition, labels)),
  )
}

/** 任务类型视图。 */
export function renderWorkflowTypes(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.workflow
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)
  const definition = currentDefinition(state)
  if (definition === null) return renderEmpty(t('definitionMissing'))

  const entries = taskTypes(page, definition)
  const selected = entries.find((entry) => entry.key === state.taskTypeSelection) ?? entries[0]
  if (selected === undefined) return renderEmpty(t('taskTypesEmptyWorkflow'))
  const labels = taskTypeLabels(definition)
  const builtin = { start: t('graphStart'), end: t('graphEnd') }

  return h(
    'div',
    { className: 'buka-workflows-types' },
    h(
      'nav',
      { className: 'buka-workflows-typesList', 'aria-label': t('taskTypesListAria') },
      ...entries.map((entry) =>
        h(
          'button',
          {
            key: entry.key,
            type: 'button',
            className:
              entry.key === selected.key
                ? 'buka-workflows-typesItem is-selected'
                : 'buka-workflows-typesItem',
            ...(entry.key === selected.key ? { 'aria-current': 'true' as const } : {}),
            onClick: () => actions.selectTaskType(entry.key),
          },
          h('span', { className: 'buka-workflows-typesItemLabel' }, entry.label),
          h('code', { className: 'buka-workflows-typesItemId' }, entry.id),
        ),
      ),
    ),
    h(
      'article',
      {
        key: selected.key,
        className: 'buka-workflows-typesDetail',
        'aria-label': selected.label,
      },
      selected.kind === 'position'
        ? renderPositionDetail(page, selected, definition, labels)
        : renderBuiltinDetail(page, selected, definition, labels, builtin),
    ),
  )
}
