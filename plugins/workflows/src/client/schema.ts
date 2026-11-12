/**
 * 受限 JSON Schema → 表单：人任务产出、页面启动作业的原始 / 结构化输入共用。
 *
 * schema 是 spec §5.4 的子集（object / array / string / number / integer /
 * boolean / enum / const / oneOf），不是完整的 JSON Schema 实现。
 */

import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from './element.ts'
import { fill } from './i18n.ts'
import type { AppContext } from './page-context.ts'
import type { JsonSchema, Translate } from './types.ts'
import { isRecord } from './types.ts'

/** 表单里的一个字段。 */
export interface SchemaField {
  name: string
  schema: JsonSchema
  required: boolean
}

/** 字段类型。 */
export type FieldKind = 'enum' | 'boolean' | 'number' | 'string' | 'json'

/** 多行输入更合适的字段名。 */
const MULTILINE_NAMES = new Set([
  'request',
  'requirement',
  'acceptance',
  'summary',
  'description',
  'note',
  'focus',
  'detail',
  'content',
  'text',
  'prompt',
])

/**
 * 取出 schema 的字段列表；没有 properties 时返回空数组。
 *
 * @param schema
 * @returns
 */
export function schemaFields(schema: JsonSchema | null | undefined): SchemaField[] {
  const properties = isRecord(schema?.properties) ? schema.properties : {}
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter((name) => typeof name === 'string')
      : [],
  )
  return Object.entries(properties).map(([name, value]) => ({
    name,
    schema: isRecord(value) ? (value as JsonSchema) : {},
    required: required.has(name),
  }))
}

/**
 * 字段的类型名（处理 `type` 是数组与 `oneOf` 的简化）。
 *
 * @param schema
 * @returns
 */
export function fieldKind(schema: JsonSchema): FieldKind {
  const value = schema.const !== undefined ? schema.const : undefined
  if (schema.enum !== undefined || value !== undefined) return 'enum'
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : []
  if (oneOf.length === 1 && isRecord(oneOf[0])) {
    return fieldKind(oneOf[0] as JsonSchema)
  }
  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== 'null')
    : schema.type
  switch (type) {
    case 'boolean':
      return 'boolean'
    case 'number':
    case 'integer':
      return 'number'
    case 'object':
    case 'array':
      return 'json'
    case 'string':
    default:
      return 'string'
  }
}

/**
 * 字段是否用多行输入。
 *
 * @param field
 * @returns
 */
export function isMultilineField(field: SchemaField): boolean {
  return (
    field.schema.type !== 'object' &&
    field.schema.type !== 'array' &&
    MULTILINE_NAMES.has(field.name)
  )
}

/**
 * 枚举候选值。
 *
 * @param schema
 * @returns
 */
export function enumOptions(schema: JsonSchema): Array<{ value: string; label: string }> {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((item) => ({ value: String(item), label: String(item) }))
  }
  if (schema.const !== undefined) {
    return [{ value: String(schema.const), label: String(schema.const) }]
  }
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : []
  const first = oneOf.find((item) => isRecord(item) && Array.isArray((item as JsonSchema).enum))
  return first === undefined ? [] : enumOptions(first as JsonSchema)
}

/**
 * 渲染一组 schema 字段。受控输入：值来自 `values`，变化交给 `onChange`。
 *
 * @param page 页面上下文（只用到词典）
 * @param options schema、值、变化回调与 id 前缀
 * @returns 表单字段数组
 */
export function renderSchemaFields(
  page: AppContext,
  options: {
    schema: JsonSchema | null
    values: Record<string, string>
    onChange: (name: string, value: string) => void
    idPrefix: string
  },
): React.ReactElement[] {
  const { t } = page
  const fields = schemaFields(options.schema)
  if (fields.length === 0) {
    return [h('p', { className: 'buka-workflows-hint', key: 'no-fields' }, t('schemaNoFields'))]
  }
  return fields.map((field) => renderField(page, field, options))
}

/**
 * 单个字段。
 *
 * @param page
 * @param field
 * @param options
 * @returns
 */
function renderField(
  page: AppContext,
  field: SchemaField,
  options: {
    values: Record<string, string>
    onChange: (name: string, value: string) => void
    idPrefix: string
  },
): React.ReactElement {
  const { t } = page
  const id = `${options.idPrefix}-${field.name}`
  const value = options.values[field.name] ?? ''
  const kind = fieldKind(field.schema)
  const onChange = (next: string) => options.onChange(field.name, next)
  let control: React.ReactElement
  if (kind === 'enum') {
    const choices = enumOptions(field.schema)
    control = h(
      'select',
      {
        id,
        className: 'buka-workflows-select',
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      },
      h('option', { value: '' }, '—'),
      ...choices.map((choice) =>
        h('option', { key: choice.value, value: choice.value }, choice.label),
      ),
    )
  } else if (kind === 'boolean') {
    control = h(
      'select',
      {
        id,
        className: 'buka-workflows-select',
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      },
      h('option', { value: '' }, '—'),
      h('option', { value: 'true' }, 'true'),
      h('option', { value: 'false' }, 'false'),
    )
  } else if (kind === 'json') {
    control = h('textarea', {
      id,
      className: 'buka-workflows-textarea',
      rows: 4,
      value,
      spellcheck: 'false',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    })
  } else if (kind === 'number') {
    control = h(Input, {
      id,
      type: 'number',
      value,
      className: 'buka-workflows-input',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    })
  } else if (isMultilineField(field)) {
    control = h('textarea', {
      id,
      className: 'buka-workflows-textarea',
      rows: 3,
      value,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    })
  } else {
    control = h(Input, {
      id,
      type: 'text',
      value,
      className: 'buka-workflows-input',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    })
  }

  return h(
    'div',
    { key: field.name, className: 'buka-workflows-field' },
    h(
      'label',
      { className: 'buka-workflows-fieldLabel', htmlFor: id },
      field.name,
      field.required
        ? h('span', { className: 'buka-workflows-required' }, ` · ${t('schemaFieldRequired')}`)
        : null,
    ),
    control,
    kind === 'json'
      ? h('p', { className: 'buka-workflows-fieldHint' }, t('fallbackJsonHint'))
      : null,
  )
}

/**
 * 把表单值解析成 schema 约定的对象。必填缺失 / 类型不对 / JSON 非法时返回错误。
 *
 * @param schema
 * @param values
 * @param t
 * @returns 解析结果
 */
export function parseSchemaValues(
  schema: JsonSchema | null | undefined,
  values: Record<string, string>,
  t: Translate,
): { value: Record<string, unknown> } | { error: string } {
  const fields = schemaFields(schema)
  if (fields.length === 0) {
    // 没有 schema：整段按 JSON 解析（新建作业的结构化输入兜底）。
    const text = Object.values(values).join('').trim()
    if (text === '') return { value: {} }
    const parsed = parseJson(text)
    return isRecord(parsed)
      ? { value: parsed }
      : { error: fill(t, 'fieldJsonInvalid', { name: '' }) }
  }
  const output: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = (values[field.name] ?? '').trim()
    if (raw === '') {
      if (field.required) return { error: fill(t, 'fieldRequired', { name: field.name }) }
      continue
    }
    const kind = fieldKind(field.schema)
    if (kind === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        return { error: fill(t, 'fieldInvalidBoolean', { name: field.name }) }
      }
      output[field.name] = raw === 'true'
    } else if (kind === 'number') {
      const asNumber = Number(raw)
      if (!Number.isFinite(asNumber)) {
        return { error: fill(t, 'fieldInvalidNumber', { name: field.name }) }
      }
      output[field.name] = field.schema.type === 'integer' ? Math.trunc(asNumber) : asNumber
    } else if (kind === 'json') {
      const parsed = parseJson(raw)
      if (parsed === undefined) {
        return { error: fill(t, 'fieldJsonInvalid', { name: field.name }) }
      }
      output[field.name] = parsed
    } else if (kind === 'enum') {
      output[field.name] = coerceEnum(field.schema, raw)
    } else {
      output[field.name] = raw
    }
  }
  return { value: output }
}

/**
 * 枚举值按原 schema 的类型还原（数字枚举保持数字）。
 *
 * @param schema
 * @param raw
 * @returns
 */
function coerceEnum(schema: JsonSchema, raw: string): unknown {
  const options = Array.isArray(schema.enum) ? schema.enum : []
  const direct = options.find((value) => String(value) === raw)
  if (direct !== undefined) return direct
  if (typeof schema.const !== 'undefined' && String(schema.const) === raw) return schema.const
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : []
  const first = oneOf.find((item) => isRecord(item) && Array.isArray((item as JsonSchema).enum))
  if (first !== undefined) return coerceEnum(first as JsonSchema, raw)
  return raw
}

/**
 * 解析 JSON；非法时返回 `undefined`（合法 `undefined` 本身也不在 JSON 里）。
 *
 * @param text
 * @returns
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * 没有 schema 时给一个「整段 JSON」的 textarea 字段。
 *
 * @param page
 * @param value
 * @param onChange
 * @param id
 * @returns
 */
export function renderJsonFallback(
  page: AppContext,
  value: string,
  onChange: (next: string) => void,
  id: string,
): React.ReactElement {
  const { t } = page
  return h(
    'div',
    { className: 'buka-workflows-field' },
    h('label', { className: 'buka-workflows-fieldLabel', htmlFor: id }, t('fallbackJsonTitle')),
    h('textarea', {
      id,
      className: 'buka-workflows-textarea',
      rows: 6,
      value,
      spellcheck: 'false',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    }),
    h('p', { className: 'buka-workflows-fieldHint' }, t('fallbackJsonHint')),
  )
}
