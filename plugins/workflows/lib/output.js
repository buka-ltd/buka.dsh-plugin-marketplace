/**
 * 节点结果 JSON 的 schema：定义校验、运行期校验与 prompt 结果契约。
 *
 * 工作流的 robot 节点在定义里用 `output` 声明它交回的 JSON 对象长什么样。
 * 本模块只处理声明与结果之间的纯逻辑（不读盘、不依赖 DSH）：
 *
 * - `parseOutputSchema`：定义校验时使用的 JSON Schema 子集检查。定义由模型现场
 *   生成，所以这里只放行一组可移植关键字，避免把任意 schema 直接当成工具参数；
 * - `buildResultSchema`：把声明的 `output` 与引擎字段合并成真正交给
 *   `structured_output` 的 schema。`next` 由出边名生成；`abort` 是每个 robot
 *   节点内置的主动终止能力；`attachments` 是每个 robot 节点内置的能力，总是
 *   可选出现（不是主输出，只放独立数据 / 文件）；
 * - `outputProblems`：运行期按声明的 `output` 校验节点交回的结果；
 * - `resolveOutputPath`：定义校验时检查 prompt 里 `{{nodes.<id>.data.<path>}}`
 *   的路径是否真的在目标节点的 `output` 里；
 * - `renderOutputContract`：给节点 prompt 追加一段固定契约（schema + 最终文本
 *   与附件的边界）。
 *
 * 本模块不修改调用方传入的定义对象：`buildResultSchema` 会 clone 后再合并。
 *
 * @module @buka/dsh-plugin-workflows/output
 */

/** 单份 `output` schema 序列化后的字节上限。 */
export const MAX_OUTPUT_SCHEMA_BYTES = 16 * 1024

/** `output` schema 的最大嵌套深度（顶层算第 1 层）。 */
export const MAX_OUTPUT_SCHEMA_DEPTH = 8

/** 一份 `output` schema 里所有 properties 的总数上限。 */
export const MAX_OUTPUT_PROPERTIES = 64

/** 引擎保留、不允许在 `output` 里声明的顶层字段。 */
export const RESERVED_OUTPUT_FIELDS = Object.freeze(['next', 'attachments', 'abort'])

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

/**
 * 判断一个值是不是普通对象。
 *
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 判断一个值是否是 JSON 原始值。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPrimitive(value) {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * 校验并规范化一个 robot 节点的 `output`。
 *
 * 返回只包含合法关键字的新对象；无法构成 schema 时返回 null（错误已记录）。
 *
 * @param {unknown} raw
 * @param {string} path
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any> | null}
 */
export function parseOutputSchema(raw, path, fail) {
  if (!isPlainObject(raw)) {
    fail(path, 'must be a JSON Schema object')
    return null
  }
  if (raw.type !== 'object') {
    fail(`${path}.type`, 'must be "object": a robot node always returns a JSON object')
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
 * @param {unknown} raw
 * @param {string} path
 * @param {number} depth
 * @param {{ properties: number }} state
 * @param {(path: string, message: string) => void} fail
 * @returns {Record<string, any> | null}
 */
function walkSchema(raw, path, depth, state, fail) {
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
    fail(`${path}.${key}`, `is not a supported JSON Schema keyword (allowed: ${[...ALLOWED_KEYWORDS].join(', ')})`)
    invalid = true
  }
  if (invalid) return null

  /** @type {Record<string, any>} */
  const schema = {}
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
    /** @type {Array<Record<string, any>>} */
    const branches = []
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
    /** @type {unknown[]} */
    const values = []
    const seen = new Set()
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
    /** @type {Record<string, any>} */
    const properties = {}
    /** @type {string[]} */
    const names = []
    if (raw.properties !== undefined) {
      if (!isPlainObject(raw.properties)) {
        fail(`${path}.properties`, 'must be an object')
        return null
      }
      for (const [name, value] of Object.entries(raw.properties)) {
        if (!PROPERTY_NAME_PATTERN.test(name)) {
          fail(
            `${path}.properties.${name}`,
            'must match [A-Za-z0-9_-] and be at most 64 characters so prompts can address it as {{nodes.<id>.data.<field>}}',
          )
          invalid = true
          continue
        }
        if (depth === 1 && RESERVED_OUTPUT_FIELDS.includes(name)) {
          fail(
            `${path}.properties.${name}`,
            name === 'next'
              ? 'is added by the workflow from the outgoing edge names; do not declare it in output'
              : name === 'abort'
                ? 'is the built-in way to end the run when this node cannot complete its task; do not declare it in output'
                : 'is always available as the built-in attachments capability; do not declare it in output',
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
      /** @type {string[]} */
      const required = []
      const seen = new Set()
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

  if (raw.properties !== undefined || raw.required !== undefined || raw.additionalProperties !== undefined) {
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
 * 一个 robot 节点可用于 JSON `next` 的路由键（出边 name）。
 *
 * @param {Record<string, any>} node
 * @returns {string[]}
 */
export function routeNamesOf(node) {
  const rules = Array.isArray(node?.next) ? node.next : []
  return rules
    .map((rule) => (typeof rule?.name === 'string' ? rule.name.trim() : ''))
    .filter((name) => name !== '')
}

/**
 * 生成 attachments 数组的 schema（每次返回新对象，避免被调用方修改）。
 *
 * attachments 是每个 robot 节点内置的能力：用来交回与答案相互独立的数据 / 文件，
 * 不是主输出通道。
 *
 * @returns {Record<string, any>}
 */
function attachmentSchema() {
  return {
    type: 'array',
    description:
      'Optional independent data or files this node produced (binary artifacts, archives, traces, large datasets). Supplementary only: never put the answer itself in an attachment. Paths are relative to your workspace; the workflow copies each file into this execution\'s node directory.',
    items: {
      oneOf: [
        { type: 'string', description: 'Path to a file, relative to your workspace.' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: 'Path to a file, relative to your workspace.' },
            name: {
              type: 'string',
              description: 'Optional destination name; defaults to the source file name.',
            },
            description: {
              type: 'string',
              description: 'Optional one-line description shown with the attachment.',
            },
          },
          required: ['path'],
        },
      ],
    },
  }
}

/**
 * 构造真正交给 `structured_output` 的 schema。
 *
 * 新定义以声明的 `output` 为底，合并 `next`（有出边时 enum）、内置的 `abort`
 * 与内置的 `attachments`；升级前已在跑的快照没有 `output`，退回旧的宽松对象
 * schema，保证未完成的运行能继续。`next` 不放进 `required`：节点可以用 `abort`
 * 代替它。返回值是新对象，不会修改节点。
 *
 * @param {Record<string, any>} node
 * @returns {Record<string, any>}
 */
export function buildResultSchema(node) {
  const declared = isPlainObject(node?.output) ? structuredClone(node.output) : null
  /** @type {Record<string, any>} */
  const schema = declared ?? { type: 'object', additionalProperties: true, properties: {} }
  if (!isPlainObject(schema.properties)) schema.properties = {}

  const routes = routeNamesOf(node)
  if (routes.length > 0) {
    schema.properties.next = {
      type: 'string',
      enum: routes,
      description:
        'Route key from the workflow definition; selects the next edge. Use "abort" instead when you cannot complete this node\'s task.',
    }
  }

  schema.properties.abort = {
    type: 'string',
    description:
      'Set this instead of "next" (or instead of a normal result on a terminal node) when you cannot complete this task: a short reason why. The workflow ends and the run is recorded as failed. Abort does not need to satisfy the declared output fields.',
  }
  schema.properties.attachments = attachmentSchema()
  return schema
}

/**
 * 判断 prompt 里的 `data.<path>` 是否真的在声明的 `output` 里。
 *
 * 返回 null 表示存在；否则返回可以拼进错误信息的原因片段。
 *
 * 规则：
 * - 对象按 `properties` 下钻；未声明的字段直接报错（即使 additionalProperties
 *   允许，模板引用也必须是显式声明过的字段）；
 * - 数组只允许数字下标，并且必须声明了 `items` 才能继续下钻；
 * - `oneOf` 的路径必须在所有分支里都存在，避免某一支运行到一半才失败。
 *
 * @param {Record<string, any>} schema 节点声明的 output schema
 * @param {string[]} segments `data` 之后的路径段
 * @returns {string | null}
 */
export function resolveOutputPath(schema, segments) {
  /** @type {Record<string, any>} */
  let current = schema
  /** @type {string[]} */
  const walked = []
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
      if (!isPlainObject(current.items)) return 'descends into an array that does not declare "items"'
      current = current.items
      walked.push(segment)
      continue
    }
    if (current.type !== 'object') return 'points into a value that is not an object'
    const properties = isPlainObject(current.properties) ? current.properties : {}
    if (!Object.hasOwn(properties, segment)) return 'is not declared'
    current = properties[segment]
    walked.push(segment)
  }
  return null
}

/**
 * 按声明的 `output` 校验节点交回的结果。
 *
 * 引擎保留的顶层 `next` / `abort` / `attachments` 不参与声明字段校验：`next`
 * 与 `abort` 由结果解析单独处理，`attachments` 是内置能力。返回可读问题列表，
 * 空数组表示通过。
 *
 * @param {Record<string, any>} node
 * @param {unknown} data
 * @returns {string[]}
 */
export function outputProblems(node, data) {
  if (!isPlainObject(node?.output)) return []
  /** @type {string[]} */
  const problems = []
  if (!isPlainObject(data)) {
    problems.push('result: expected a JSON object')
    return problems
  }
  checkValue(node.output, data, '', problems, 0)
  return problems
}

/**
 * 递归校验一个值。
 *
 * @param {Record<string, any>} schema
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} problems
 * @param {number} depth
 * @returns {void}
 */
function checkValue(schema, value, path, problems, depth) {
  if (depth > MAX_CHECK_DEPTH) return
  const label = path === '' ? 'result' : path

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((branch) => {
      /** @type {string[]} */
      const branchProblems = []
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
          if (depth === 0 && RESERVED_OUTPUT_FIELDS.includes(name)) continue
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
          checkValue(schema.items, item, `${path}[${index}]`, problems, depth + 1)
        })
      }
      return
    }
    case 'string':
      if (typeof value !== 'string') problems.push(`${label}: expected string, got ${actualType(value)}`)
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push(`${label}: expected number, got ${actualType(value)}`)
      }
      return
    case 'integer':
      if (!Number.isInteger(value)) problems.push(`${label}: expected integer, got ${actualType(value)}`)
      return
    case 'boolean':
      if (typeof value !== 'boolean') problems.push(`${label}: expected boolean, got ${actualType(value)}`)
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
 * @param {string} path
 * @param {string} name
 * @returns {string}
 */
function joinPath(path, name) {
  return path === '' ? name : `${path}.${name}`
}

/**
 * 值的实际类型，用于错误信息。
 *
 * @param {unknown} value
 * @returns {string}
 */
function actualType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

/**
 * 节点 prompt 末尾追加的结果契约。
 *
 * 升级前的快照没有 `output`，返回空串，保持旧 prompt 不变。
 *
 * @param {Record<string, any>} node
 * @returns {string}
 */
export function renderOutputContract(node) {
  if (!isPlainObject(node?.output)) return ''
  const schema = buildResultSchema(node)
  return [
    '---',
    'Result contract (added by the workflow):',
    'Finish by calling the structured_output tool with one JSON object that matches this schema:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    'When this node has outgoing edges, the object must contain exactly one of "next" (one of the declared route names) and "abort".',
    'If you cannot complete this task, do not choose a route you do not believe in: submit "abort" with a short non-empty reason instead. The workflow ends immediately, the run is recorded as failed, and the declared output fields and attachments are not required.',
    "The final assistant text is this step's output shown on the run page; put the actual answer in the final text and the declared fields.",
    'The "attachments" list is a built-in capability for independent data or files this node produced (archives, traces, images, large datasets); it is not a place for the answer itself.',
  ].join('\n')
}
