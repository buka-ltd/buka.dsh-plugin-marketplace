/**
 * 页面通用小部件：状态标签、加载 / 失败 / 空态、键值行、只读 schema 与 JSON 块。
 */

import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

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

/** 状态标签（任务 / 作业通用）。 */
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

/** 执行者展示：机器人 / 人 + 名字。 */
export function renderExecutor(page: AppContext, executor: Executor | null | undefined): string {
  const { t } = page
  if (!isRecord(executor)) return t('taskTypeUnset')
  if (executor.kind === 'human') return t('actorHuman')
  const kind = executor.kind === 'robot' ? t('actorRobot') : t('taskTypeUnset')
  const name = typeof executor.name === 'string' && executor.name !== '' ? executor.name : ''
  return name === '' ? kind : `${kind} · ${name}`
}

/** 只读展示一组 schema 字段。 */
export function renderSchema(
  page: AppContext,
  schema: JsonSchema | null | undefined,
): React.ReactElement {
  const { t } = page
  const fields = schemaFields(schema)
  if (fields.length === 0) return h('p', { className: 'buka-workflows-hint' }, t('schemaNoFields'))
  return h(
    'ul',
    { className: 'buka-workflows-schemaList' },
    ...fields.map((field) =>
      h(
        'li',
        { key: field.name, className: 'buka-workflows-schemaField' },
        h('code', { className: 'buka-workflows-inlineCode' }, field.name),
        h('span', { className: 'buka-workflows-schemaType' }, schemaTypeLabel(field.schema)),
        field.required
          ? h('span', { className: 'buka-workflows-required' }, t('schemaFieldRequired'))
          : null,
      ),
    ),
  )
}

/** 字段类型 → 展示文本。 */
function schemaTypeLabel(schema: JsonSchema): string {
  if (Array.isArray(schema.enum)) return `enum(${schema.enum.map(String).join(' | ')})`
  if (schema.const !== undefined) return String(schema.const)
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type
  return typeof type === 'string' && type !== '' ? type : 'any'
}

/** JSON 块；空值显示提示。 */
export function renderJsonBlock(
  value: unknown,
  emptyText: string,
  maxHeight = false,
): React.ReactElement {
  const text = jsonText(value)
  if (text === '') return h('p', { className: 'buka-workflows-hint' }, emptyText)
  return h('pre', { className: `buka-workflows-pre${maxHeight ? ' is-tall' : ''}` }, text)
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
