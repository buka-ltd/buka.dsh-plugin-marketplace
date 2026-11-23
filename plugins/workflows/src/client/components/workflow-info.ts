/**
 * 工作流页的「定义信息」Tab：只保留需要一眼确认的内容。
 *
 * 概览（描述、版本、规模与预算）→ 岗位（执行者、职责与可处理的任务类型）
 * → 任务流转（通道的收发方与类型限制）。任务内容、动作、最终报告等契约细节
 * 属于「结构图」节点抽屉，这一页不重复，避免把定义文档整份铺开。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import {
  type ChannelView,
  channelsOf,
  currentDefinition,
  type PositionView,
  positionLabel,
  positionsOf,
  taskTypeLabels,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { WorkflowDefinition } from '../types.ts'
import {
  ClampedText,
  renderEmpty,
  renderExecutor,
  renderFailure,
  renderLoading,
  renderSection,
  renderStatStrip,
} from './parts.ts'

/** 预算：任务上限。 */
function budgetTasks(page: AppContext, definition: WorkflowDefinition): string {
  const value = definition.budgets?.maxTasks
  return typeof value === 'number' ? String(value) : page.t('budgetUnset')
}

/** 预算：最长时长。 */
function budgetDuration(page: AppContext, definition: WorkflowDefinition): string {
  const value = definition.budgets?.maxDurationHours
  return typeof value === 'number' ? `${value} ${page.t('budgetHours')}` : page.t('budgetUnset')
}

/** 一个岗位：名称、执行者、可处理的任务类型与职责。 */
function renderPositionRow(page: AppContext, position: PositionView): React.ReactElement {
  const { t } = page
  const types = position.taskTypes
    .map((type, index) => {
      const label =
        typeof type.label === 'string' && type.label !== ''
          ? type.label
          : typeof type.id === 'string'
            ? type.id
            : ''
      return label === ''
        ? null
        : h(Tag, { key: type.id ?? `${position.id}-${index}`, tone: 'neutral' }, label)
    })
    .filter((chip) => chip !== null)
  return h(
    'div',
    { key: position.id, className: 'buka-workflows-infoPosition' },
    h('span', { className: 'buka-workflows-infoPositionName' }, position.label),
    h(
      'div',
      { className: 'buka-workflows-infoPositionBody' },
      h(
        'div',
        { className: 'buka-workflows-infoPositionHead' },
        h(
          'span',
          { className: 'buka-workflows-infoPositionMeta' },
          renderExecutor(page, position.executor),
        ),
        types.length === 0 ? null : h('span', { className: 'buka-workflows-infoTypes' }, ...types),
      ),
      position.note === ''
        ? null
        : h(ClampedText, {
            text: position.note,
            className: 'buka-workflows-infoNote',
            expandLabel: t('expandText'),
            collapseLabel: t('collapseText'),
          }),
    ),
  )
}

/** 一条通道：流向、名称与类型限制。 */
function renderChannelRow(
  page: AppContext,
  channel: ChannelView,
  definition: WorkflowDefinition,
  labels: Map<string, string>,
  builtin: { start: string; end: string },
): React.ReactElement {
  const { t } = page
  const types = channel.types.map((type) => labels.get(type) ?? type)
  return h(
    'div',
    { key: channel.id, className: 'buka-workflows-infoFlowRow' },
    h(
      'span',
      { className: 'buka-workflows-infoFlowRoute' },
      h('span', null, positionLabel(definition, channel.from, builtin)),
      h('span', { className: 'buka-workflows-infoFlowArrow', 'aria-hidden': true }, '→'),
      h('span', null, positionLabel(definition, channel.to, builtin)),
    ),
    h(
      'span',
      { className: 'buka-workflows-infoFlowChannel' },
      channel.label,
      channel.back ? h(Tag, { tone: 'neutral' }, t('channelBack')) : null,
    ),
    types.length === 0
      ? null
      : h(
          'span',
          { className: 'buka-workflows-infoFlowTypes' },
          ...types.map((type) => h(Tag, { key: type, tone: 'neutral' }, type)),
        ),
  )
}

/** 定义信息视图。 */
export function renderWorkflowInfo(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.workflow
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.data === null) return renderLoading(page)
  const definition = currentDefinition(state)
  if (definition === null) return renderEmpty(t('definitionMissing'))

  const workflow = loaded.data.workflow
  const positions = positionsOf(definition)
  const channels = channelsOf(definition)
  const labels = taskTypeLabels(definition)
  const builtin = { start: t('graphStart'), end: t('graphEnd') }
  const description = typeof workflow?.description === 'string' ? workflow.description.trim() : ''

  return h(
    'div',
    { className: 'buka-workflows-info' },
    h(
      'div',
      { className: 'buka-workflows-infoSummary' },
      description === ''
        ? null
        : h(ClampedText, {
            text: description,
            className: 'buka-workflows-infoLead',
            expandLabel: t('expandText'),
            collapseLabel: t('collapseText'),
          }),
      renderStatStrip([
        [t('workflowVersionName'), `v${workflow?.version ?? 0}`],
        [t('definitionPositions'), String(positions.length)],
        [t('budgetMaxTasks'), budgetTasks(page, definition)],
        [t('budgetMaxDuration'), budgetDuration(page, definition)],
      ]),
    ),
    renderSection(
      t('definitionPositions'),
      positions.length === 0
        ? h('p', { className: 'buka-workflows-hint' }, t('positionsEmpty'))
        : h(
            'div',
            { className: 'buka-workflows-infoPositions' },
            ...positions.map((position) => renderPositionRow(page, position)),
          ),
    ),
    renderSection(
      t('infoFlowTitle'),
      channels.length === 0
        ? h('p', { className: 'buka-workflows-hint' }, t('channelsEmpty'))
        : h(
            'div',
            { className: 'buka-workflows-infoFlow' },
            ...channels.map((channel) =>
              renderChannelRow(page, channel, definition, labels, builtin),
            ),
          ),
    ),
    h('p', { className: 'buka-workflows-infoHint' }, t('infoDetailHint')),
  )
}
