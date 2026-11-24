/**
 * 结构图抽屉里的任务类型卡片。
 *
 * 一张卡片 = 展示名 + id + 能力标签（助理 / 计划 / 工作树）+ 说明 + 任务内容契约
 * + 动作 / 完成后创建。开始 / 结束是内建任务类型，用同一套卡片。定义信息页只做
 * 摘要，不铺这些细节，细节留在抽屉里。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { channelOf, positionLabel } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { JsonSchema, TaskTypeDefinition, WorkflowDefinition } from '../types.ts'
import { ClampedText, renderAssistant, renderContractFields } from './parts.ts'

/** 一个任务类型：一张卡片，标题 + 说明 + 输入 / 产出两行契约。 */
export function renderTaskTypeCard(
  page: AppContext,
  type: TaskTypeDefinition,
  definition: WorkflowDefinition,
  labels: Map<string, string>,
): React.ReactElement {
  const { t } = page
  const id = typeof type.id === 'string' ? type.id : ''
  const actions = Array.isArray(type.actions) ? type.actions : []
  const creates = Array.isArray(type.creates) ? type.creates : []
  return h(
    'article',
    { key: id === '' ? (type.label ?? 'type') : id, className: 'buka-workflows-typeCard' },
    h(
      'div',
      { className: 'buka-workflows-typeRowHead' },
      h('span', { className: 'buka-workflows-typeName' }, type.label ?? id),
      id === '' ? null : h('code', { className: 'buka-workflows-inlineCode' }, id),
      h(
        'span',
        { className: 'buka-workflows-typeTags' },
        typeof type.assistant === 'string' && type.assistant !== ''
          ? h(
              Tag,
              { tone: 'neutral' },
              `${t('taskTypeAssistant')} · ${renderAssistant(page, type.assistant)}`,
            )
          : null,
        type.plan === true ? h(Tag, { tone: 'info' }, t('taskTypeModePlan')) : null,
        typeof type.agentPreset === 'string' && type.agentPreset !== ''
          ? h(Tag, { tone: 'neutral' }, `${t('taskTypePreset')} · ${type.agentPreset}`)
          : null,
        typeof type.concurrency === 'number' && type.concurrency > 1
          ? h(Tag, { tone: 'neutral' }, `${t('taskTypeConcurrency')} · ${String(type.concurrency)}`)
          : null,
        type.worktree === 'guard'
          ? h(Tag, { tone: 'info' }, t('taskTypeWorktreeGuard'))
          : type.worktree === 'create'
            ? h(Tag, { tone: 'info' }, t('taskTypeWorktree'))
            : null,
      ),
    ),
    typeof type.definition === 'string' && type.definition !== ''
      ? h(ClampedText, {
          text: type.definition,
          className: 'buka-workflows-typeDesc',
          expandLabel: t('expandText'),
          collapseLabel: t('collapseText'),
        })
      : null,
    h(
      'div',
      { className: 'buka-workflows-contractStack is-tight' },
      renderContractLine(t('taskTypeContent'), renderContractOrDash(page, type.content)),
    ),
    actions.length === 0
      ? null
      : renderContractLine(
          t('taskTypeActions'),
          h(
            'div',
            { className: 'buka-workflows-tagRow' },
            ...actions.map((action) =>
              h(
                Tag,
                { key: String(action.id ?? action.label), tone: 'neutral' },
                action.label ?? String(action.id ?? ''),
              ),
            ),
          ),
        ),
    creates.length === 0
      ? null
      : renderContractLine(
          t('taskTypeCreates'),
          h(
            'div',
            { className: 'buka-workflows-tagRow' },
            ...creates.map((creation, index) => {
              const typeId = typeof creation.type === 'string' ? creation.type : ''
              const target =
                typeId === '' || typeId === 'end'
                  ? t('endTaskTitle')
                  : (labels.get(typeId) ?? typeId)
              const channel = channelOf(definition, creation.channel ?? '')
              return h(
                Tag,
                { key: `${creation.channel ?? ''}-${typeId}-${index}`, tone: 'neutral' },
                channel === null ? target : `${target} · ${channel.label}`,
              )
            }),
          ),
        ),
  )
}

/**
 * 内建任务类型卡片：开始（作业输入 + 完成后创建）或结束（最终报告）。
 *
 * @param page 页面上下文
 * @param kind `start` 或 `end`
 * @param definition 定义快照
 * @param labels 任务类型 id → 展示名
 * @param builtin 开始 / 结束节点的展示名
 * @returns React 元素
 */
export function renderBuiltinTaskCard(
  page: AppContext,
  kind: 'start' | 'end',
  definition: WorkflowDefinition,
  labels: Map<string, string>,
  builtin: { start: string; end: string },
): React.ReactElement {
  const { t } = page
  const isStart = kind === 'start'
  const typeName = isStart ? t('startTaskTitle') : t('endTaskTitle')
  const typeId = kind
  const hint = isStart
    ? `${t('startContentTitle')} · ${t('startPayloadHint')}`
    : `${t('endContentTitle')} · ${t('endPayloadHint')}`
  return h(
    'article',
    { className: 'buka-workflows-typeCard' },
    h(
      'div',
      { className: 'buka-workflows-typeRowHead' },
      h('span', { className: 'buka-workflows-typeName' }, typeName),
      h('code', { className: 'buka-workflows-inlineCode' }, typeId),
      h(
        'span',
        { className: 'buka-workflows-typeTags' },
        h(Tag, { tone: 'info' }, t('builtinTypeTag')),
      ),
    ),
    h('p', { className: 'buka-workflows-typeDesc' }, t('builtinTypeHint')),
    h('p', { className: 'buka-workflows-sectionHint' }, hint),
    renderContractLine(
      t('taskTypeContent'),
      renderContractOrDash(page, isStart ? definition.start?.content : definition.end?.content),
    ),
    isStart
      ? renderContractLine(
          t('taskTypeCreates'),
          renderInitialTasks(page, definition, labels, builtin),
        )
      : null,
  )
}

/** 初始任务列表。 */
function renderInitialTasks(
  page: AppContext,
  definition: WorkflowDefinition,
  labels: Map<string, string>,
  builtin: { start: string; end: string },
): React.ReactNode {
  const { t } = page
  if (!Array.isArray(definition.start?.next) || definition.start.next.length === 0) {
    return h('p', { className: 'buka-workflows-hint' }, t('definitionInitialEmpty'))
  }
  return h(
    'ul',
    { className: 'buka-workflows-initialList' },
    ...definition.start.next.map((initial, index) => {
      const channel = channelOf(definition, initial.channel)
      return h(
        'li',
        { key: `${initial.channel ?? ''}-${index}`, className: 'buka-workflows-initialRow' },
        h(
          'span',
          { className: 'buka-workflows-initialMain' },
          h(
            'strong',
            null,
            channel === null
              ? (initial.channel ?? '')
              : positionLabel(definition, channel.to, builtin),
          ),
          h(
            'span',
            { className: 'buka-workflows-hint' },
            [
              channel === null ? '' : `「${channel.label}」`,
              labels.get(initial.type ?? '') ?? initial.type ?? '',
            ]
              .filter((part) => part !== '')
              .join(' · '),
          ),
        ),
        h(
          'span',
          { className: 'buka-workflows-hint' },
          initial.content === undefined ? t('initialNoContent') : t('initialContent'),
        ),
      )
    }),
  )
}

/** 契约的一行：左侧短标签，右侧字段标签。 */
function renderContractLine(label: string, content: React.ReactNode): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-contractLine' },
    h('span', { className: 'buka-workflows-contractLabel' }, label),
    h('div', { className: 'buka-workflows-contractValue' }, content),
  )
}

/** 有契约就渲染字段，没有契约给一个短横线占位。 */
function renderContractOrDash(
  page: AppContext,
  schema: JsonSchema | null | undefined,
): React.ReactNode {
  return schema === null || schema === undefined
    ? h('span', { className: 'buka-workflows-hint' }, page.t('taskTypeUnset'))
    : renderContractFields(page, schema)
}
