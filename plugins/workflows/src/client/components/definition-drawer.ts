/**
 * 结构图的右侧抽屉：全局信息、岗位、开始 / 结束节点与通道。
 *
 * 抽屉只回答一个问题：所选节点 / 通道在定义里是什么。身份放在头部，正文按
 * 页签分区：岗位看可处理的任务类型（卡片），开始 / 结束看契约，通道看发送方、
 * 接收方与允许的任务类型，定义信息看概览、初始任务与契约。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { renderAvatar } from '../avatars.ts'
import { ClientModal, h } from '../element.ts'
import {
  allTaskTypes,
  channelOf,
  currentDefinition,
  type PositionView,
  positionLabel,
  positionsOf,
  taskTypeLabels,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { JsonSchema, TaskTypeDefinition, WorkflowDefinition } from '../types.ts'
import {
  ClampedText,
  DrawerTabs,
  renderAssistant,
  renderContractFields,
  renderDrawerHead,
  renderExecutor,
  renderFold,
  renderKv,
  renderStatStrip,
} from './parts.ts'

/** 定义抽屉。 */
export function renderDefinitionDrawer(page: AppContext): React.ReactElement | null {
  const { t, state, actions } = page
  if (state.route.kind !== 'workflow' || state.route.tab !== 'definition') return null
  const selection = state.definitionSelection
  if (selection === null) return null
  const detail = state.workflow.data
  const definition = currentDefinition(state)
  if (definition === null) return null
  const workflow = detail?.workflow
  const builtin = { start: t('graphStart'), end: t('graphEnd') }
  const positions = positionsOf(definition)
  const labels = taskTypeLabels(definition)
  const title = titleOf(page, selection, definition)
  const position =
    selection.kind === 'position' ? positions.find((item) => item.id === selection.id) : undefined
  const avatar =
    position !== undefined && typeof position.executor.avatar === 'string'
      ? renderAvatar(position.executor.avatar, 28, 'buka-workflows-drawerAvatar')
      : null
  const tabs = definitionTabs(page, selection, { definition, workflow, positions, labels, builtin })
  const backChannel =
    selection.kind === 'channel' && channelOf(definition, selection.id)?.back === true
      ? h(Tag, { tone: 'neutral' }, t('channelBack'))
      : null
  const lead =
    selection.kind === 'position' && position !== undefined && position.note !== ''
      ? h(ClampedText, {
          key: 'desc',
          text: position.note,
          className: 'buka-workflows-drawerText',
          expandLabel: t('expandText'),
          collapseLabel: t('collapseText'),
        })
      : null

  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: () => actions.selectDefinition(null),
      title,
      closeLabel: t('close'),
      backdropBlur: false,
      className: 'buka-workflows-drawer buka-workflows-inspector',
    },
    renderDrawerHead({
      title,
      avatar,
      ...(backChannel === null ? {} : { tag: backChannel }),
      meta: headerMeta(page, selection, position, definition),
      onClose: () => actions.selectDefinition(null),
      closeLabel: t('close'),
    }),
    h(
      'div',
      { className: 'buka-workflows-drawerBody' },
      lead,
      h(DrawerTabs, {
        key: selectionKey(selection),
        label: t('definitionTabsAria'),
        tabs,
      }),
    ),
  )
}

/** 抽屉的分区页签。 */
interface DefinitionTab {
  id: string
  label: string
  content: React.ReactNode
}

/** 定义抽屉的上下文。 */
interface DefinitionContext {
  definition: WorkflowDefinition
  workflow: { description?: string; version?: number } | undefined
  positions: PositionView[]
  labels: Map<string, string>
  builtin: { start: string; end: string }
}

/** 按所选对象给出页签。 */
function definitionTabs(
  page: AppContext,
  selection: NonNullable<AppContext['state']['definitionSelection']>,
  context: DefinitionContext,
): DefinitionTab[] {
  const { t } = page
  const { definition, workflow, positions, labels, builtin } = context
  if (selection.kind === 'info') {
    const overview: React.ReactNode[] = [
      renderStatStrip([
        [t('workflowVersionName'), `v${workflow?.version ?? 0}`],
        [t('definitionPositions'), String(positions.length)],
        [t('taskTypesTitle'), String(allTaskTypes(definition).length)],
        [t('budgetMaxTasks'), budgetTasks(page, definition)],
        [t('budgetMaxDuration'), budgetDuration(page, definition)],
      ]),
    ]
    if (typeof workflow?.description === 'string' && workflow.description !== '') {
      overview.push(
        h(ClampedText, {
          key: 'desc',
          text: workflow.description,
          className: 'buka-workflows-drawerText',
          expandLabel: t('expandText'),
          collapseLabel: t('collapseText'),
        }),
      )
    }
    return [
      {
        id: 'overview',
        label: t('definitionTabOverview'),
        content: h('div', { className: 'buka-workflows-drawerStack' }, ...overview),
      },
      {
        id: 'initial',
        label: t('definitionInitialTasks'),
        content: initialTasks(page, definition, labels, builtin),
      },
      {
        id: 'contract',
        label: t('definitionTabContract'),
        content: h(
          'div',
          { className: 'buka-workflows-drawerStack' },
          renderFold(
            t('definitionStartContract'),
            h(
              'div',
              { className: 'buka-workflows-contractStack' },
              contractBlock(
                page,
                t('startContentTitle'),
                t('startPayloadHint'),
                definition.start?.content,
              ),
            ),
          ),
          renderFold(
            t('definitionEndContract'),
            contractBlock(page, t('endContentTitle'), t('endPayloadHint'), definition.end?.content),
          ),
        ),
      },
    ]
  }
  if (selection.kind === 'position') {
    const position = positions.find((item) => item.id === selection.id)
    if (position === undefined) {
      return [
        {
          id: 'missing',
          label: t('positionTaskTypes'),
          content: h('p', { className: 'buka-workflows-hint' }, t('notFound')),
        },
      ]
    }
    return [
      {
        id: 'types',
        label: t('positionTaskTypes'),
        content: h(
          'div',
          { className: 'buka-workflows-drawerStack' },
          h('h3', { className: 'buka-workflows-sectionTitle' }, t('positionTaskTypes')),
          position.taskTypes.length === 0
            ? h('p', { className: 'buka-workflows-hint' }, t('taskTypesEmpty'))
            : h(
                'div',
                { className: 'buka-workflows-typeList' },
                ...position.taskTypes.map((type) => renderTaskType(page, type, definition, labels)),
              ),
        ),
      },
    ]
  }
  if (selection.kind === 'start' || selection.kind === 'end') {
    const isStart = selection.kind === 'start'
    if (!isStart) {
      return [
        {
          id: 'deliverable',
          label: t('finalDeliverableTitle'),
          content: h(
            'div',
            { className: 'buka-workflows-contractStack' },
            h('p', { className: 'buka-workflows-sectionHint' }, t('endPayloadHint')),
            renderContractFields(page, definition.end?.content),
          ),
        },
      ]
    }
    return [
      {
        id: 'input',
        label: t('startContentTitle'),
        content: h(
          'div',
          { className: 'buka-workflows-contractStack' },
          h('p', { className: 'buka-workflows-sectionHint' }, t('startPayloadHint')),
          renderContractFields(page, definition.start?.content),
        ),
      },
    ]
  }
  const channel = channelOf(definition, selection.id)
  if (channel === null) {
    return [
      {
        id: 'missing',
        label: t('channelTitle'),
        content: h('p', { className: 'buka-workflows-hint' }, t('notFound')),
      },
    ]
  }
  return [
    {
      id: 'info',
      label: t('channelTitle'),
      content: h(
        'div',
        { className: 'buka-workflows-drawerStack' },
        renderKv([
          [t('channelSender'), channelEndpoint(page, definition, positions, channel.from, builtin)],
          [t('channelReceiver'), channelEndpoint(page, definition, positions, channel.to, builtin)],
        ]),
        h(
          'div',
          { className: 'buka-workflows-section' },
          h('h3', { className: 'buka-workflows-sectionTitle' }, t('channelAllowedTypes')),
          channel.types.length === 0
            ? h('p', { className: 'buka-workflows-hint' }, t('channelAllTypes'))
            : h(
                'div',
                { className: 'buka-workflows-tagRow' },
                ...channel.types.map((type) =>
                  h(Tag, { key: type, tone: 'neutral' }, labels.get(type) ?? type),
                ),
              ),
        ),
      ),
    },
  ]
}

/** 初始任务列表。 */
function initialTasks(
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

/** 通道端点：岗位标签 + 主体；内建开始 / 结束节点只有标签。 */
function channelEndpoint(
  page: AppContext,
  definition: WorkflowDefinition,
  positions: PositionView[],
  nodeId: string,
  builtin: { start: string; end: string },
): React.ReactNode {
  const label = positionLabel(definition, nodeId, builtin)
  if (nodeId === 'start' || nodeId === 'end') return label
  const position = positions.find((item) => item.id === nodeId)
  if (position === undefined) return label
  const executor = renderExecutor(page, position.executor)
  if (executor === page.t('taskTypeUnset')) return label
  return h(
    'span',
    { className: 'buka-workflows-inlineGroup' },
    h('span', null, label),
    h('span', { className: 'buka-workflows-hint' }, executor),
  )
}

/** 头部第二行：主体 / 通道 id 与端点 / 回向标记，没有可说的就留空。 */
function headerMeta(
  page: AppContext,
  selection: NonNullable<AppContext['state']['definitionSelection']>,
  position: ReturnType<typeof positionsOf>[number] | undefined,
  definition: WorkflowDefinition,
): React.ReactNode {
  const { t } = page
  if (selection.kind === 'position') {
    if (position === undefined) return null
    const text = renderExecutor(page, position.executor)
    return text === t('taskTypeUnset') ? null : text
  }
  if (selection.kind === 'channel') {
    const channel = channelOf(definition, selection.id)
    return channel === null ? null : channel.id
  }
  return null
}

/** 抽屉标题。 */
function titleOf(
  page: AppContext,
  selection: NonNullable<AppContext['state']['definitionSelection']>,
  definition: WorkflowDefinition,
): string {
  const { t } = page
  if (selection.kind === 'info') return t('definitionInfo')
  if (selection.kind === 'start') return t('startTaskTitle')
  if (selection.kind === 'end') return t('endTaskTitle')
  if (selection.kind === 'position') {
    const position = positionsOf(definition).find((item) => item.id === selection.id)
    return position?.label ?? selection.id
  }
  const channel = channelOf(definition, selection.id)
  return channel === null ? t('channelTitle') : channel.label
}

/** 页签的 `key`：换一个所选对象就重置到默认页签。 */
function selectionKey(selection: NonNullable<AppContext['state']['definitionSelection']>): string {
  return selection.kind === 'position' || selection.kind === 'channel'
    ? `${selection.kind}:${selection.id}`
    : selection.kind
}

/** 一个任务类型：一张卡片，标题 + 说明 + 输入 / 产出两行契约。 */
function renderTaskType(
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
        type.mode === 'plan' ? h(Tag, { tone: 'info' }, t('taskTypeModePlan')) : null,
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
      contractLine(t('taskTypeContent'), contractOrDash(page, type.content)),
    ),
    actions.length === 0
      ? null
      : contractLine(
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
      : contractLine(
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

/** 契约的一行：左侧短标签，右侧字段标签。 */
function contractLine(label: string, content: React.ReactNode): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-contractLine' },
    h('span', { className: 'buka-workflows-contractLabel' }, label),
    h('div', { className: 'buka-workflows-contractValue' }, content),
  )
}

/** 有契约就渲染字段，没有契约给一个短横线占位。 */
function contractOrDash(page: AppContext, schema: JsonSchema | null | undefined): React.ReactNode {
  return schema === null || schema === undefined
    ? h('span', { className: 'buka-workflows-hint' }, page.t('taskTypeUnset'))
    : renderContractFields(page, schema)
}

/** 带说明的契约块（开始 / 结束节点）。 */
function contractBlock(
  page: AppContext,
  label: string,
  hint: string,
  schema: JsonSchema | null | undefined,
): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-contractBlock' },
    h('span', { className: 'buka-workflows-fieldLabel' }, label),
    h('p', { className: 'buka-workflows-sectionHint' }, hint),
    renderContractFields(page, schema),
  )
}

/** 预算：任务数。 */
function budgetTasks(page: AppContext, definition: WorkflowDefinition): string {
  const value = definition.budgets?.maxTasks
  return typeof value === 'number' ? String(value) : page.t('budgetUnset')
}

/** 预算：最长时长。 */
function budgetDuration(page: AppContext, definition: WorkflowDefinition): string {
  const value = definition.budgets?.maxDurationHours
  return typeof value === 'number' ? `${value} ${page.t('budgetHours')}` : page.t('budgetUnset')
}
