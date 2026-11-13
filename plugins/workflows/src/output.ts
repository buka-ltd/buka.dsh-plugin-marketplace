/**
 * 受限 JSON Schema 子集：定义校验、运行期结果校验与模板路径检查。
 *
 * 工作流 v5 里任务类型用 `payload` / `output` 声明创建者必须填的内容与
 * 执行者必须交回的结构化结果；开始 / 结束节点也各自声明任务契约。本模块
 * 只处理声明与值之间的纯逻辑（不读盘、不依赖 DSH）：
 *
 * - `parseOutputSchema`：定义校验时使用的 JSON Schema 子集检查。工作流定义
 *   由编排 agent 生成，所以这里只放行一组可移植关键字，避免把任意 schema
 *   直接当成工具参数；
 * - `schemaProblems`：运行期按声明的 schema 校验 payload / output；
 * - `resolveOutputPath`：定义校验时检查 `{{start.output.<path>}}` 这类模板
 *   引用的路径是否真的在目标 schema 里；
 * - `schemaJson`：给 prompt 用的 schema 序列化。
 *
 * 本模块不修改调用方传入的对象。
 *
 * @module @buka/dsh-plugin-workflows/output
 */

/** 单份 schema 序列化后的字节上限。 */
export const MAX_OUTPUT_SCHEMA_BYTES = 16 * 1024

/** schema 的最大嵌套深度（顶层算第 1 层）。 */
export const MAX_OUTPUT_SCHEMA_DEPTH = 8

/** 一份 schema 里所有 properties 的总数上限。 */
export const MAX_OUTPUT_PROPERTIES = 64

/** 属性名必须能被 prompt 模板的点号路径寻址。 */
const PROPERTY_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u

/** 允许的子 schema 类型。 */
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

/** 允许的 schema 关键字。 */
const ALLOWED_KEYWORDS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'oneOf',
])

/** `description` 的最大字符数。 */
const MAX_DESCRIPTION_LENGTH = 1000

/** 运行期校验的递归深度上限（定义已经过 parseOutputSchema，正常不会触发）。 */
const MAX_CHECK_DEPTH = 32

/** 校验通过后保留的 JSON Schema 子集；只含 ALLOWED_KEYWORDS。 */
export interface OutputSchema {
  description?: string
  type?: string
  enum?: unknown[]
  const?: unknown
  oneOf?: OutputSchema[]
  properties?: Record<string, OutputSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: OutputSchema
}

/** 定义校验时记录错误的回调。 */
export type FailFn = (path: string, message: string) => void

/**
 * 判断一个值是不是普通对象。
 *
 * @param value 待判断的值
 * @returns 是普通对象时为 true
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 判断一个值是否是 JSON 原始值。
 *
 * @param value 待判断的值
 * @returns 是 JSON 原始值时为 true
 */
function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * 校验并规范化一份 payload / output schema。
 *
 * 顶层必须是 `type: "object"`：任务的 payload 与结构化结果都是 JSON 对象，
 * 页面表单与 `buka_task_complete` 都按对象读写。返回只包含合法关键字的新对象；
 * 无法构成 schema 时返回 null（错误已记录）。
 *
 * @param raw 声明的 schema
 * @param path 出错时使用的路径前缀
 * @param fail 记录错误的回调
 * @returns 规范化后的 schema；不合法时是 `null`
 */
export function parseOutputSchema(raw: unknown, path: string, fail: FailFn): OutputSchema | null {
  if (!isPlainObject(raw)) {
    fail(path, 'must be a JSON Schema object')
    return null
  }
  if (raw.type !== 'object') {
    fail(`${path}.type`, 'must be "object": task payload and results are JSON objects')
    return null
  }
  const state = { properties: 0 }
  const schema = walkSchema(raw, path, 1, state, fail)
  if (schema === null) return null
  const bytes = Buffer.byteLength(JSON.stringify(schema), 'utf8')
  if (bytes > MAX_OUTPUT_SCHEMA_BYTES) {
    fail(path, `must be at most ${Math.round(MAX_OUTPUT_SCHEMA_BYTES / 1024)} KiB when serialized`)
    return null
  }
  return schema
}

/**
 * 递归校验一个子 schema。
 *
 * @param raw 子 schema
 * @param path 出错时使用的路径前缀
 * @param depth 当前嵌套深度（顶层算第 1 层）
 * @param state 所有 properties 的累计计数
 * @param fail 记录错误的回调
 * @returns 规范化后的子 schema；不合法时是 `null`
 */
function walkSchema(
  raw: unknown,
  path: string,
  depth: number,
  state: { properties: number },
  fail: FailFn,
): OutputSchema | null {
  if (!isPlainObject(raw)) {
    fail(path, 'must be a JSON Schema object')
    return null
  }
  if (depth > MAX_OUTPUT_SCHEMA_DEPTH) {
    fail(path, `must not be nested deeper than ${MAX_OUTPUT_SCHEMA_DEPTH} levels`)
    return null
  }

  let invalid = false
  for (const key of Object.keys(raw)) {
    if (ALLOWED_KEYWORDS.has(key)) continue
    fail(
      `${path}.${key}`,
      `is not a supported JSON Schema keyword (allowed: ${[...ALLOWED_KEYWORDS].join(', ')})`,
    )
    invalid = true
  }
  if (invalid) return null

  const schema: OutputSchema = {}
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      fail(`${path}.description`, 'must be a string')
      return null
    }
    if (raw.description.length > MAX_DESCRIPTION_LENGTH) {
      fail(`${path}.description`, `must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
      return null
    }
    schema.description = raw.description
  }

  // oneOf 是联合类型：只允许和 description 一起出现，避免在同一层混合两种含义。
  if (raw.oneOf !== undefined) {
    for (const key of Object.keys(raw)) {
      if (key === 'oneOf' || key === 'description') continue
      fail(`${path}.${key}`, 'cannot be combined with oneOf')
      invalid = true
    }
    if (invalid) return null
    if (!Array.isArray(raw.oneOf) || raw.oneOf.length === 0) {
      fail(`${path}.oneOf`, 'must be a non-empty array of schemas')
      return null
    }
    const branches: OutputSchema[] = []
    for (const [index, branch] of raw.oneOf.entries()) {
      const parsed = walkSchema(branch, `${path}.oneOf[${index}]`, depth + 1, state, fail)
      if (parsed === null) return null
      branches.push(parsed)
    }
    return { ...schema, oneOf: branches }
  }

  const type = typeof raw.type === 'string' ? raw.type : ''
  if (!SCHEMA_TYPES.has(type)) {
    fail(`${path}.type`, `must be one of: ${[...SCHEMA_TYPES].join(', ')}`)
    return null
  }
  schema.type = type

  if (raw.enum !== undefined) {
    if (!Array.isArray(raw.enum) || raw.enum.length === 0) {
      fail(`${path}.enum`, 'must be a non-empty array of primitive values')
      return null
    }
    const values: unknown[] = []
    const seen = new Set<string>()
    for (const [index, value] of raw.enum.entries()) {
      if (!isPrimitive(value)) {
        fail(`${path}.enum[${index}]`, 'must be a string, number, boolean or null')
        return null
      }
      const key = `${typeof value}:${JSON.stringify(value)}`
      if (seen.has(key)) {
        fail(`${path}.enum[${index}]`, 'must not repeat a value')
        return null
      }
      seen.add(key)
      values.push(value)
    }
    schema.enum = values
  }

  if (raw.const !== undefined) {
    if (!isPrimitive(raw.const)) {
      fail(`${path}.const`, 'must be a string, number, boolean or null')
      return null
    }
    schema.const = raw.const
  }

  if (type === 'object') {
    const properties: Record<string, OutputSchema> = {}
    const names: string[] = []
    if (raw.properties !== undefined) {
      if (!isPlainObject(raw.properties)) {
        fail(`${path}.properties`, 'must be an object')
        return null
      }
      for (const [name, value] of Object.entries(raw.properties)) {
        if (!PROPERTY_NAME_PATTERN.test(name)) {
          fail(
            `${path}.properties.${name}`,
            'must match [A-Za-z0-9_-] and be at most 64 characters so prompts can address it by path',
          )
          invalid = true
          continue
        }
        state.properties += 1
        if (state.properties > MAX_OUTPUT_PROPERTIES) {
          fail(path, `must declare at most ${MAX_OUTPUT_PROPERTIES} properties in total`)
          return null
        }
        const parsed = walkSchema(value, `${path}.properties.${name}`, depth + 1, state, fail)
        if (parsed === null) {
          invalid = true
          continue
        }
        properties[name] = parsed
        names.push(name)
      }
    }
    if (invalid) return null
    if (names.length > 0) schema.properties = properties

    if (raw.required !== undefined) {
      if (!Array.isArray(raw.required)) {
        fail(`${path}.required`, 'must be an array of property names')
        return null
      }
      const required: string[] = []
      const seen = new Set<string>()
      for (const [index, name] of raw.required.entries()) {
        if (typeof name !== 'string' || !PROPERTY_NAME_PATTERN.test(name)) {
          fail(`${path}.required[${index}]`, 'must be a property name declared in properties')
          return null
        }
        if (!Object.hasOwn(properties, name)) {
          fail(`${path}.required[${index}]`, `"${name}" is not declared in properties`)
          return null
        }
        if (seen.has(name)) {
          fail(`${path}.required[${index}]`, `"${name}" is listed more than once`)
          return null
        }
        seen.add(name)
        required.push(name)
      }
      if (required.length > 0) schema.required = required
    }

    if (raw.additionalProperties !== undefined) {
      if (typeof raw.additionalProperties !== 'boolean') {
        fail(`${path}.additionalProperties`, 'must be true or false')
        return null
      }
      schema.additionalProperties = raw.additionalProperties
    }
    return schema
  }

  if (
    raw.properties !== undefined ||
    raw.required !== undefined ||
    raw.additionalProperties !== undefined
  ) {
    fail(path, 'properties / required / additionalProperties are only allowed on object schemas')
    return null
  }

  if (type === 'array') {
    if (raw.items !== undefined) {
      const parsed = walkSchema(raw.items, `${path}.items`, depth + 1, state, fail)
      if (parsed === null) return null
      schema.items = parsed
    }
    return schema
  }

  if (raw.items !== undefined) {
    fail(`${path}.items`, 'is only allowed on array schemas')
    return null
  }
  return schema
}

/**
 * 判断 prompt 里的路径是否真的在声明的 schema 里。
 *
 * 规则：
 * - 对象按 `properties` 下钻；未声明的字段直接报错（即使 additionalProperties
 *   允许，模板引用也必须是显式声明过的字段）；
 * - 数组只允许数字下标，并且必须声明了 `items` 才能继续下钻；
 * - `oneOf` 的路径必须在所有分支里都存在，避免某一支运行到一半才失败。
 *
 * @param schema 声明的 schema
 * @param segments 路径段（不含 `start.output` 前缀）
 * @returns 存在时是 `null`，否则是可以拼进错误信息的原因片段
 */
export function resolveOutputPath(
  schema: OutputSchema,
  segments: readonly string[],
): string | null {
  let current: OutputSchema = schema
  const walked: string[] = []
  for (const segment of segments) {
    if (!isPlainObject(current)) return 'points into a value that is not an object'
    if (Array.isArray(current.oneOf)) {
      for (const branch of current.oneOf) {
        const reason = resolveOutputPath(branch, segments.slice(walked.length))
        if (reason !== null) return 'is not declared in every oneOf variant'
      }
      return null
    }
    if (current.type === 'array') {
      if (!/^\d+$/u.test(segment)) return 'uses a non-numeric segment on an array'
      if (!isPlainObject(current.items))
        return 'descends into an array that does not declare "items"'
      current = current.items as OutputSchema
      walked.push(segment)
      continue
    }
    if (current.type !== 'object') return 'points into a value that is not an object'
    const properties = isPlainObject(current.properties) ? current.properties : {}
    if (!Object.hasOwn(properties, segment)) return 'is not declared'
    current = properties[segment] as OutputSchema
    walked.push(segment)
  }
  return null
}

/**
 * 按声明的 schema 校验一个值。
 *
 * @param schema 声明的 schema
 * @param data 待校验的值
 * @returns 可读问题列表；空数组表示通过
 */
export function schemaProblems(schema: OutputSchema, data: unknown): string[] {
  const problems: string[] = []
  checkValue(schema, data, '', problems, 0)
  return problems
}

/**
 * 递归校验一个值。
 *
 * @param schema 声明或构建出的 schema
 * @param value 待校验的值
 * @param path 出错时使用的路径前缀
 * @param problems 问题列表
 * @param depth 当前递归深度
 * @returns 无返回值
 */
function checkValue(
  schema: OutputSchema,
  value: unknown,
  path: string,
  problems: string[],
  depth: number,
): void {
  if (depth > MAX_CHECK_DEPTH) return
  const label = path === '' ? 'payload' : path

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((branch) => {
      const branchProblems: string[] = []
      checkValue(branch, value, path, branchProblems, depth + 1)
      return branchProblems.length === 0
    })
    if (!matched) problems.push(`${label}: does not match any oneOf variant`)
    return
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((candidate) => candidate === value)) {
      problems.push(`${label}: must be one of ${JSON.stringify(schema.enum)}`)
      return
    }
  }
  if (Object.hasOwn(schema, 'const') && schema.const !== value) {
    problems.push(`${label}: must equal ${JSON.stringify(schema.const)}`)
    return
  }

  const type = typeof schema.type === 'string' ? schema.type : ''
  switch (type) {
    case 'object': {
      if (!isPlainObject(value)) {
        problems.push(`${label}: expected object, got ${actualType(value)}`)
        return
      }
      const properties = isPlainObject(schema.properties) ? schema.properties : {}
      for (const name of Array.isArray(schema.required) ? schema.required : []) {
        if (Object.hasOwn(value, name)) continue
        problems.push(`${joinPath(path, name)}: missing required field`)
      }
      if (schema.additionalProperties === false) {
        for (const name of Object.keys(value)) {
          if (Object.hasOwn(properties, name)) continue
          problems.push(`${joinPath(path, name)}: unexpected field (additionalProperties is false)`)
        }
      }
      for (const [name, child] of Object.entries(properties)) {
        if (!Object.hasOwn(value, name)) continue
        checkValue(child, value[name], joinPath(path, name), problems, depth + 1)
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        problems.push(`${label}: expected array, got ${actualType(value)}`)
        return
      }
      if (isPlainObject(schema.items)) {
        value.forEach((item, index) => {
          checkValue(schema.items as OutputSchema, item, `${path}[${index}]`, problems, depth + 1)
        })
      }
      return
    }
    case 'string':
      if (typeof value !== 'string')
        problems.push(`${label}: expected string, got ${actualType(value)}`)
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push(`${label}: expected number, got ${actualType(value)}`)
      }
      return
    case 'integer':
      if (!Number.isInteger(value))
        problems.push(`${label}: expected integer, got ${actualType(value)}`)
      return
    case 'boolean':
      if (typeof value !== 'boolean')
        problems.push(`${label}: expected boolean, got ${actualType(value)}`)
      return
    case 'null':
      if (value !== null) problems.push(`${label}: expected null, got ${actualType(value)}`)
      return
    default:
      return
  }
}

/**
 * 路径拼接：顶层字段直接用名字，嵌套用点号，数组下标紧跟在父路径后面。
 *
 * @param path 父路径
 * @param name 字段名
 * @returns 拼接后的路径
 */
function joinPath(path: string, name: string): string {
  return path === '' ? name : `${path}.${name}`
}

/**
 * 值的实际类型，用于错误信息。
 *
 * @param value 待判断的值
 * @returns 值的实际类型
 */
function actualType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

/**
 * 把 schema 序列化成 prompt 里展示的 JSON 文本。
 *
 * @param schema 声明的 schema
 * @returns 格式化后的 JSON
 */
export function schemaJson(schema: OutputSchema): string {
  return JSON.stringify(schema, null, 2)
}
