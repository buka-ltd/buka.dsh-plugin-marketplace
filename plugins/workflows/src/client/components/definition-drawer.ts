/**
 * 结构图的右侧抽屉：岗位、开始 / 结束节点与通道。
 *
 * 抽屉只回答一个问题：所选节点 / 通道在定义里是什么。身份放在头部，正文按
 * 页签分区：岗位看可处理的任务类型（卡片），开始看作业输入与初始任务，结束看
 * 最终报告，通道看发送方、接收方与允许的任务类型。整个定义的概览在页面的
 * 「任务类型」Tab 里，不占抽屉。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { renderAvatar } from '../avatars.ts'
import { ClientModal, h } from '../element.ts'
import {
  channelOf,
  currentDefinition,
  type PositionView,
  positionLabel,
  positionsOf,
  taskTypeLabels,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { WorkflowDefinition } from '../types.ts'
import { renderBuiltinTaskCard, renderTaskTypeCard } from './definition-parts.ts'
import { ClampedText, DrawerTabs, renderDrawerHead, renderExecutor, renderKv } from './parts.ts'

/** 定义抽屉。 */
export function renderDefinitionDrawer(page: AppContext): React.ReactElement | null {
  const { t, state, actions } = page
  if (state.route.kind !== 'workflow' || state.route.tab !== 'definition') return null
  const selection = state.definitionSelection
  if (selection === null) return null
  const definition = currentDefinition(state)
  if (definition === null) return null
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
  const tabs = definitionTabs(page, selection, { definition, positions, labels, builtin })
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
  const { definition, positions, labels, builtin } = context
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
                ...position.taskTypes.map((type) =>
                  renderTaskTypeCard(page, type, definition, labels),
                ),
              ),
        ),
      },
    ]
  }
  if (selection.kind === 'start' || selection.kind === 'end') {
    // 开始 / 结束是内建任务类型：用与岗位任务类型一致的卡片展示契约与处理人。
    const isStart = selection.kind === 'start'
    return [
      {
        id: isStart ? 'content' : 'deliverable',
        label: isStart ? t('startTaskTitle') : t('finalDeliverableTitle'),
        content: renderBuiltinTaskCard(page, selection.kind, definition, labels, builtin),
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
  if (selection.kind === 'start') {
    return `${t('definitionHandler')}: ${t('boardEngine')}`
  }
  if (selection.kind === 'end') {
    return `${t('definitionHandler')}: ${t('endHandlerHint')}`
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
