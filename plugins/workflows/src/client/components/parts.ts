/**
 * 页面通用小部件：状态标签、加载 / 失败 / 空态、键值行、只读 schema 与二次确认按钮。
 */

import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import React from 'react'

import { h } from '../element.ts'
import {
  actorKindKey,
  formatTime,
  jsonText,
  statusLabel,
  statusTone,
  workflowStatusKey,
} from '../format.ts'
import type { AppContext } from '../page-context.ts'
import { schemaFields } from '../schema.ts'
import type { Executor, JsonSchema, Translate } from '../types.ts'
import { isRecord } from '../types.ts'

/** 加载态。 */
export function renderLoading(page: AppContext): React.ReactElement {
  return h(
    'p',
    { className: 'buka-workflows-statusWithDot', role: 'status' },
    h(StateDot, { state: 'ongoing' }),
    page.t('loading'),
  )
}

/** 失败态；`retry` 存在时给一个重试按钮。 */
export function renderFailure(
  page: AppContext,
  error: string,
  retry?: (() => void) | null,
): React.ReactElement {
  const { t } = page
  return h(
    'div',
    { className: 'buka-workflows-failureBox', role: 'alert' },
    h('p', { className: 'buka-workflows-failure' }, `${t('loadFailed')} ${error}`),
    retry === null || retry === undefined
      ? null
      : h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workflows-smallButton',
            onClick: retry,
          },
          t('retry'),
        ),
  )
}

/** 空态。 */
export function renderEmpty(title: string, hint?: string | null): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-emptyBox' },
    h('p', { className: 'buka-workflows-empty' }, title),
    hint === null || hint === undefined || hint === ''
      ? null
      : h('p', { className: 'buka-workflows-hint' }, hint),
  )
}

/** 空态 + 一个动作。 */
export function renderEmptyAction(
  title: string,
  hint: string | null,
  action: React.ReactNode,
): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-emptyBox' },
    h('p', { className: 'buka-workflows-empty' }, title),
    hint === null || hint === '' ? null : h('p', { className: 'buka-workflows-hint' }, hint),
    action,
  )
}

/** 状态标签（任务 / 作业 / 工作流通用）。 */
export function renderStatusTag(
  t: Translate,
  status: unknown,
  kind: 'task' | 'job' | 'workflow' = 'task',
): React.ReactElement {
  const label = kind === 'workflow' ? t(workflowStatusKey(status)) : statusLabel(t, status)
  return h(Tag, { tone: statusTone(status) }, label)
}

/** 承办者 / 启动者种类标签。 */
export function renderActorTag(t: Translate, kind: unknown): React.ReactElement | null {
  if (typeof kind !== 'string' || kind === '') return null
  return h(Tag, { tone: 'neutral' }, t(actorKindKey(kind)))
}

/** 键值行。 */
export function renderKv(rows: Array<[string, React.ReactNode]>): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-kv' },
    ...rows.map(([key, value], index) =>
      h(
        'div',
        { key: `${key}-${index}`, className: 'buka-workflows-kvRow' },
        h('span', { className: 'buka-workflows-kvKey' }, key),
        h('span', { className: 'buka-workflows-kvValue' }, value),
      ),
    ),
  )
}

/** 抽屉头部：标题 / 状态 / 头像 / 元信息，右侧是动作与关闭。 */
export function renderDrawerHead(options: {
  title: string
  tag?: React.ReactNode
  avatar?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  onClose: () => void
  closeLabel: string
}): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-drawerHead' },
    h(
      'div',
      { className: 'buka-workflows-drawerHeadRow' },
      options.avatar ?? null,
      h(
        'div',
        { className: 'buka-workflows-drawerHeading' },
        h(
          'div',
          { className: 'buka-workflows-drawerTitleRow' },
          h('h2', { className: 'buka-workflows-drawerTitle' }, options.title),
          options.tag ?? null,
        ),
        options.meta === undefined || options.meta === null || options.meta === ''
          ? null
          : h('div', { className: 'buka-workflows-drawerMeta' }, options.meta),
      ),
      h(
        'div',
        { className: 'buka-workflows-drawerActions' },
        options.actions ?? null,
        h(
          'button',
          {
            type: 'button',
            className: 'buka-workflows-drawerClose',
            'aria-label': options.closeLabel,
            title: options.closeLabel,
            onClick: options.onClose,
          },
          h('span', { 'aria-hidden': true }, '×'),
        ),
      ),
    ),
  )
}

/** 长说明：默认收成三行，需要时展开；短文本原样显示。 */
export function ClampedText(props: {
  text: string
  className?: string
  expandLabel: string
  collapseLabel: string
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const long = props.text.length > 120 || props.text.includes('\n')
  const className = props.className ?? ''
  return h(
    'div',
    { className: 'buka-workflows-clamped' },
    h(
      'p',
      {
        className: `buka-workflows-clampedText${className === '' ? '' : ` ${className}`}${
          long && !open ? ' is-clamped' : ''
        }`,
      },
      props.text,
    ),
    long
      ? h(
          'button',
          {
            type: 'button',
            className: 'buka-workflows-textButton',
            onClick: () => setOpen((value) => !value),
          },
          open ? props.collapseLabel : props.expandLabel,
        )
      : null,
  )
}

/** 抽屉里的折叠区：默认收起，展开后才铺技术细节。 */
export function renderFold(title: string, children: React.ReactNode): React.ReactElement {
  return h(
    'details',
    { className: 'buka-workflows-fold' },
    h('summary', { className: 'buka-workflows-foldSummary' }, title),
    h('div', { className: 'buka-workflows-foldBody' }, children),
  )
}

/** 一行指标条：值在上、标签在下。 */
export function renderStatStrip(rows: Array<[string, string]>): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-statStrip' },
    ...rows.map(([label, value]) =>
      h(
        'div',
        { key: label, className: 'buka-workflows-stat' },
        h('span', { className: 'buka-workflows-statValue' }, value),
        h('span', { className: 'buka-workflows-statLabel' }, label),
      ),
    ),
  )
}

/**
 * 契约字段的紧凑展示：字段名、类型与说明收在同一个可换行的小标签里。
 *
 * @param page 页面上下文
 * @param schema 契约
 * @returns React 元素
 */
export function renderContractFields(
  page: AppContext,
  schema: JsonSchema | null | undefined,
): React.ReactElement {
  const { t } = page
  const fields = schemaFields(schema)
  if (fields.length === 0)
    return h('span', { className: 'buka-workflows-hint' }, t('schemaNoFields'))
  return h(
    'div',
    { className: 'buka-workflows-contractFields' },
    ...fields.map((field) => {
      const description =
        typeof field.schema.description === 'string' && field.schema.description !== ''
          ? field.schema.description
          : ''
      return h(
        'span',
        { key: field.name, className: 'buka-workflows-contractField' },
        h('code', { className: 'buka-workflows-inlineCode' }, field.name),
        h('span', { className: 'buka-workflows-contractType' }, schemaTypeLabel(field.schema)),
        field.required
          ? h(
              'span',
              {
                className: 'buka-workflows-required',
                title: t('schemaFieldRequired'),
                'aria-label': t('schemaFieldRequired'),
              },
              '*',
            )
          : null,
        description === ''
          ? null
          : h('span', { className: 'buka-workflows-contractDesc' }, description),
      )
    }),
  )
}

/** 区块：标题 + 内容。 */
export function renderSection(
  title: string,
  children: React.ReactNode,
  extra?: React.ReactNode,
): React.ReactElement {
  return h(
    'section',
    { className: 'buka-workflows-section' },
    h(
      'div',
      { className: 'buka-workflows-sectionHead' },
      h('h3', { className: 'buka-workflows-sectionTitle' }, title),
      extra ?? null,
    ),
    children,
  )
}

/** 执行者展示：打工人 / 人 + 名字。 */
export function renderExecutor(page: AppContext, executor: Executor | null | undefined): string {
  const { t } = page
  if (!isRecord(executor)) return t('taskTypeUnset')
  if (executor.kind === 'human') return t('actorHuman')
  const kind = executor.kind === 'worker' ? t('actorWorker') : t('taskTypeUnset')
  const name = typeof executor.name === 'string' && executor.name !== '' ? executor.name : ''
  return name === '' ? kind : `${kind} · ${name}`
}

/** 字段类型 → 展示文本。 */
function schemaTypeLabel(schema: JsonSchema): string {
  if (Array.isArray(schema.enum)) return `enum(${schema.enum.map(String).join(' | ')})`
  if (schema.const !== undefined) return String(schema.const)
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type
  return typeof type === 'string' && type !== '' ? type : 'any'
}

/**
 * 只读展示一个值：有 schema 时按字段逐行展示、字段名用说明替代；没有 schema
 * 时按对象自身的键逐行展示。展示层不重复渲染原始 JSON。
 *
 * @param page 页面上下文
 * @param schema 契约
 * @param value 值
 * @param emptyText 空值提示
 * @returns React 元素
 */
export function renderReadonlyValue(
  page: AppContext,
  schema: JsonSchema | null | undefined,
  value: unknown,
  emptyText: string,
): React.ReactElement {
  const { t } = page
  if (value === undefined || value === null) {
    return h('p', { className: 'buka-workflows-hint' }, emptyText)
  }
  if (!isRecord(value)) {
    return h(
      'div',
      { className: 'buka-workflows-values' },
      h(
        'div',
        { className: 'buka-workflows-valueRow' },
        h('div', { className: 'buka-workflows-valueValue' }, renderValue(value, t)),
      ),
    )
  }
  const fields = schemaFields(schema)
  const entries =
    fields.length > 0
      ? fields.map((field) => ({ name: field.name, description: field.schema.description }))
      : Object.keys(value).map((name) => ({ name, description: undefined }))
  if (entries.length === 0) {
    return h('p', { className: 'buka-workflows-hint' }, emptyText)
  }
  return h(
    'div',
    { className: 'buka-workflows-values' },
    ...entries.map((entry) => {
      const description =
        typeof entry.description === 'string' && entry.description !== '' ? entry.description : ''
      return h(
        'div',
        { key: entry.name, className: 'buka-workflows-valueRow' },
        h(
          'span',
          { className: 'buka-workflows-valueKey' },
          description === '' ? entry.name : description,
          description === ''
            ? null
            : h('code', { className: 'buka-workflows-inlineCode' }, entry.name),
        ),
        h('div', { className: 'buka-workflows-valueValue' }, renderValue(value[entry.name], t)),
      )
    }),
  )
}

/** 单个值的展示。 */
function renderValue(value: unknown, t: Translate): React.ReactNode {
  if (value === undefined || value === null || value === '') {
    return h('span', { className: 'buka-workflows-hint' }, t('taskTypeUnset'))
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return h('pre', { className: 'buka-workflows-pre is-inline' }, jsonText(value))
}

/** 可点击的附件名按钮。 */
export function renderAttachmentLink(
  page: AppContext,
  attachment: { id?: string; name?: string },
  onOpen: (id: string, name: string) => void,
): React.ReactElement | null {
  const id = typeof attachment.id === 'string' ? attachment.id : ''
  const name = typeof attachment.name === 'string' ? attachment.name : ''
  if (id === '') return null
  return h(
    'button',
    {
      type: 'button',
      className: 'buka-workflows-attachmentLink',
      title: page.t('attachmentPreview'),
      onClick: () => onOpen(id, name),
    },
    name === '' ? id : name,
  )
}

/** 时间文本（null 显示 —）。 */
export function timeText(value: unknown): string {
  return formatTime(value)
}

/** 二次确认按钮：第一次点击换成确认 / 取消，不弹系统对话框。 */
export function ConfirmButton(props: {
  label: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  className?: string
  confirmText?: string
  disabled?: boolean
  variant?: 'outline' | 'primary'
}): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const variant = props.variant ?? 'outline'
  const className = props.className ?? 'buka-workflows-smallButton'
  if (!pending) {
    return h(
      Button,
      {
        variant,
        size: 'sm',
        className,
        disabled: props.disabled === true,
        onClick: () => setPending(true),
      },
      props.label,
    )
  }
  return h(
    'span',
    { className: 'buka-workflows-confirm' },
    props.confirmText === undefined
      ? null
      : h('span', { className: 'buka-workflows-confirmText' }, props.confirmText),
    h(
      Button,
      {
        variant: 'outline',
        size: 'sm',
        className: `${className} is-danger`,
        disabled: props.disabled === true,
        onClick: () => {
          setPending(false)
          props.onConfirm()
        },
      },
      props.confirmLabel,
    ),
    h(
      Button,
      {
        variant: 'outline',
        size: 'sm',
        className,
        disabled: props.disabled === true,
        onClick: () => setPending(false),
      },
      props.cancelLabel,
    ),
  )
}
