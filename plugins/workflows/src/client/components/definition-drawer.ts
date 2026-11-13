/**
 * 定义结构的右侧抽屉：全局信息、岗位、开始 / 结束节点与通道。
 *
 * 抽屉只回答一个问题：所选节点 / 通道在定义里是什么。身份放在头部，契约字段
 * 收成紧凑标签；预算、完整契约这类技术细节放进默认收起的折叠区。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { renderAvatar } from '../avatars.ts'
import { ClientModal, h } from '../element.ts'
import { fill } from '../i18n.ts'
import {
  allTaskTypes,
  channelOf,
  currentDefinition,
  positionLabel,
  positionsOf,
  taskTypeLabels,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { JsonSchema, TaskTypeDefinition, WorkflowDefinition } from '../types.ts'
import {
  ClampedText,
  renderContractFields,
  renderDrawerHead,
  renderExecutor,
  renderFold,
  renderSection,
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

  const body: React.ReactNode[] = []
  if (selection.kind === 'info') {
    const types = allTaskTypes(definition)
    body.push(
      renderStatStrip([
        [t('workflowVersionName'), `v${workflow?.version ?? 0}`],
        [t('definitionPositions'), String(positions.length)],
        [t('taskTypesTitle'), String(types.length)],
        [t('budgetMaxTasks'), budgetTasks(page, definition)],
        [t('budgetMaxDuration'), budgetDuration(page, definition)],
      ]),
    )
    if (typeof workflow?.description === 'string' && workflow.description !== '') {
      body.push(
        h(ClampedText, {
          key: 'desc',
          text: workflow.description,
          className: 'buka-workflows-drawerText',
          expandLabel: t('expandText'),
          collapseLabel: t('collapseText'),
        }),
      )
    }
    body.push(
      renderSection(
        t('definitionInitialTasks'),
        Array.isArray(definition.start?.next) && definition.start.next.length > 0
          ? h(
              'ul',
              { className: 'buka-workflows-initialList' },
              ...definition.start.next.map((initial, index) => {
                const channel = channelOf(definition, initial.channel)
                return h(
                  'li',
                  {
                    key: `${initial.channel ?? ''}-${index}`,
                    className: 'buka-workflows-initialRow',
                  },
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
                    fill(t, 'initialDeps', { n: initial.dependsOn?.length ?? 0 }),
                  ),
                )
              }),
            )
          : h('p', { className: 'buka-workflows-hint' }, t('definitionInitialEmpty')),
      ),
    )
    body.push(
      renderFold(
        t('definitionStartContract'),
        h(
          'div',
          { className: 'buka-workflows-contractStack' },
          contractBlock(
            page,
            t('taskTypePayload'),
            t('startPayloadHint'),
            definition.start?.task?.payload,
          ),
          contractBlock(
            page,
            t('taskTypeOutput'),
            t('startOutputHint'),
            definition.start?.task?.output,
          ),
        ),
      ),
      renderFold(
        t('definitionEndContract'),
        contractBlock(
          page,
          t('taskTypePayload'),
          t('endPayloadHint'),
          definition.end?.task?.payload,
        ),
      ),
    )
  } else if (selection.kind === 'position') {
    if (position === undefined) {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('notFound')))
    } else {
      if (position.description !== '') {
        body.push(
          h(ClampedText, {
            key: 'desc',
            text: position.description,
            className: 'buka-workflows-drawerText',
            expandLabel: t('expandText'),
            collapseLabel: t('collapseText'),
          }),
        )
      }
      body.push(
        renderSection(
          t('taskTypesTitle'),
          position.taskTypes.length === 0
            ? h('p', { className: 'buka-workflows-hint' }, t('taskTypesEmpty'))
            : h(
                'div',
                { className: 'buka-workflows-typeList' },
                ...position.taskTypes.map((type) => renderTaskType(page, type, labels)),
              ),
        ),
      )
    }
  } else if (selection.kind === 'start' || selection.kind === 'end') {
    const isStart = selection.kind === 'start'
    body.push(
      h(
        'p',
        { className: 'buka-workflows-drawerText' },
        isStart ? t('startContractHint') : t('endContractHint'),
      ),
      renderSection(
        t('taskTypePayload'),
        h(
          'div',
          { className: 'buka-workflows-contractStack' },
          h(
            'p',
            { className: 'buka-workflows-sectionHint' },
            isStart ? t('startPayloadHint') : t('endPayloadHint'),
          ),
          renderContractFields(page, definition.start?.task?.payload),
        ),
      ),
    )
    if (isStart) {
      body.push(
        renderSection(
          t('taskTypeOutput'),
          h(
            'div',
            { className: 'buka-workflows-contractStack' },
            h('p', { className: 'buka-workflows-sectionHint' }, t('startOutputHint')),
            renderContractFields(page, definition.start?.task?.output),
          ),
        ),
      )
    }
  } else {
    const channel = channelOf(definition, selection.id)
    if (channel === null) {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('notFound')))
    } else {
      body.push(
        renderSection(
          t('channelAllowedTypes'),
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
      )
    }
  }

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
      meta: headerMeta(page, selection, position, definition),
      onClose: () => actions.selectDefinition(null),
      closeLabel: t('close'),
    }),
    h('div', { className: 'buka-workflows-drawerBody' }, ...body),
  )
}

/** 头部第二行：执行者 / 通道 id 与端点 / 回向标记，没有可说的就留空。 */
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
    if (channel === null) return null
    const builtin = { start: t('graphStart'), end: t('graphEnd') }
    const route = `${positionLabel(definition, channel.from, builtin)} → ${positionLabel(
      definition,
      channel.to,
      builtin,
    )}`
    return [channel.id, route, channel.back ? t('channelBack') : '']
      .filter((part) => part !== '')
      .join(' · ')
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

/** 一个任务类型：标题 + 说明 + 输入 / 产出两行契约。 */
function renderTaskType(
  page: AppContext,
  type: TaskTypeDefinition,
  labels: Map<string, string>,
): React.ReactElement {
  const { t } = page
  const id = typeof type.id === 'string' ? type.id : ''
  const requires = Array.isArray(type.requires)
    ? type.requires.flatMap((item) => (Array.isArray(item.types) ? item.types : []))
    : []
  return h(
    'article',
    { key: id === '' ? (type.label ?? 'type') : id, className: 'buka-workflows-typeRow' },
    h(
      'div',
      { className: 'buka-workflows-typeRowHead' },
      h('span', { className: 'buka-workflows-typeName' }, type.label ?? id),
      id === '' ? null : h('code', { className: 'buka-workflows-inlineCode' }, id),
      h(
        'span',
        { className: 'buka-workflows-typeTags' },
        typeof type.assistant === 'string' && type.assistant !== ''
          ? h(Tag, { tone: 'neutral' }, `${t('taskTypeAssistant')} · ${type.assistant}`)
          : null,
        type.mode === 'plan' ? h(Tag, { tone: 'info' }, t('taskTypeModePlan')) : null,
      ),
    ),
    typeof type.description === 'string' && type.description !== ''
      ? h(ClampedText, {
          text: type.description,
          className: 'buka-workflows-typeDesc',
          expandLabel: t('expandText'),
          collapseLabel: t('collapseText'),
        })
      : null,
    h(
      'div',
      { className: 'buka-workflows-contractStack is-tight' },
      contractLine(t('taskTypePayload'), contractOrDash(page, type.payload)),
      contractLine(t('taskTypeOutput'), contractOrDash(page, type.output)),
    ),
    requires.length === 0
      ? null
      : contractLine(
          t('taskTypeRequires'),
          h(
            'div',
            { className: 'buka-workflows-tagRow' },
            ...requires.map((required) =>
              h(Tag, { key: required, tone: 'neutral' }, labels.get(required) ?? required),
            ),
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
