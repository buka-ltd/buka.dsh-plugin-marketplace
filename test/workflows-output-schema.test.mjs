/**
 * 节点输出 schema 的纯单测：`output.js` 的定义校验 / schema 合并 / 路径解析 /
 * 运行期结果校验 / prompt 契约，以及 `template.js` 的占位符提取。
 *
 * 全部使用内存数据，不启动 DSH、不读盘、不联网。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { validateDefinition } from '../plugins/workflows/lib/definition.js'
import {
  MAX_OUTPUT_SCHEMA_BYTES,
  MAX_OUTPUT_SCHEMA_DEPTH,
  MAX_OUTPUT_PROPERTIES,
  buildResultSchema,
  outputProblems,
  parseOutputSchema,
  renderOutputContract,
  resolveOutputPath,
  routeNamesOf,
} from '../plugins/workflows/lib/output.js'
import { inspectTemplate } from '../plugins/workflows/lib/template.js'

/**
 * @param {unknown} raw
 * @returns {{ schema: Record<string, any> | null, errors: Array<{ path: string, message: string }> }}
 */
function parse(raw) {
  /** @type {Array<{ path: string, message: string }>} */
  const errors = []
  const schema = parseOutputSchema(raw, 'nodes[1].output', (path, message) => errors.push({ path, message }))
  return { schema, errors }
}

/**
 * @param {ReturnType<typeof parse>} result
 * @returns {string}
 */
function errorText(result) {
  return result.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
}

test('output: a typical object schema is accepted and normalized', () => {
  const result = parse({
    type: 'object',
    description: '检查结果',
    properties: {
      status: { type: 'string', enum: ['ok', 'blocked'], description: '结论' },
      note: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      extra: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['status'],
    additionalProperties: false,
  })
  assert.deepEqual(result.errors, [])
  assert.ok(result.schema)
  assert.equal(result.schema.type, 'object')
  assert.deepEqual(result.schema.required, ['status'])
  assert.equal(result.schema.additionalProperties, false)
  assert.deepEqual(result.schema.properties.status.enum, ['ok', 'blocked'])
  assert.equal(Object.hasOwn(result.schema, 'next'), false)
})

test('output: the top level must be an object schema', () => {
  assert.match(errorText(parse({ type: 'array', items: { type: 'string' } })), /must be "object"/u)
  assert.match(errorText(parse(null)), /must be a JSON Schema object/u)
  assert.match(errorText(parse([])), /must be a JSON Schema object/u)
})

test('output: unsupported keywords, malformed required and bad shapes are rejected', () => {
  assert.match(errorText(parse({ type: 'object', pattern: 'x' })), /not a supported JSON Schema keyword/u)

  const dangling = parse({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'] })
  assert.match(errorText(dangling), /"b" is not declared in properties/u)

  const duplicateRequired = parse({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a', 'a'],
  })
  assert.match(errorText(duplicateRequired), /listed more than once/u)

  const badName = parse({ type: 'object', properties: { 'bad.name': { type: 'string' } } })
  assert.match(errorText(badName), /must match \[A-Za-z0-9_-\]/u)

  const itemsOnString = parse({ type: 'object', properties: { a: { type: 'string', items: { type: 'string' } } } })
  assert.match(errorText(itemsOnString), /only allowed on array schemas/u)

  const propsOnString = parse({ type: 'object', properties: { a: { type: 'string', properties: {} } } })
  assert.match(errorText(propsOnString), /only allowed on object schemas/u)

  const oneOfMixed = parse({
    type: 'object',
    oneOf: [{ type: 'object' }],
    properties: {},
  })
  assert.match(errorText(oneOfMixed), /cannot be combined with oneOf/u)

  const badEnum = parse({ type: 'object', properties: { a: { type: 'string', enum: ['x', 'x'] } } })
  assert.match(errorText(badEnum), /must not repeat a value/u)

  const objectEnum = parse({ type: 'object', properties: { a: { type: 'string', enum: [{}] } } })
  assert.match(errorText(objectEnum), /must be a string, number, boolean or null/u)

  const badAdditional = parse({ type: 'object', additionalProperties: {} })
  assert.match(errorText(badAdditional), /must be true or false/u)
})

test('output: next and attachments are reserved at the top level', () => {
  const next = parse({ type: 'object', properties: { next: { type: 'string' } } })
  assert.match(errorText(next), /added by the workflow from the outgoing edge names/u)
  const attachments = parse({ type: 'object', properties: { attachments: { type: 'array' } } })
  assert.match(errorText(attachments), /built-in attachments capability/u)

  // 嵌套对象里的 next 只是普通数据字段，允许。
  const nested = parse({
    type: 'object',
    properties: { meta: { type: 'object', properties: { next: { type: 'string' } } } },
  })
  assert.deepEqual(nested.errors, [])
})

test('output: depth, property count and serialized size are bounded', () => {
  /** @param {number} depth */
  const nested = (depth) => {
    let schema = { type: 'string' }
    for (let index = 0; index < depth; index += 1) {
      schema = { type: 'object', properties: { child: schema } }
    }
    return schema
  }
  assert.deepEqual(parse(nested(MAX_OUTPUT_SCHEMA_DEPTH - 1)).errors, [])
  assert.match(errorText(parse(nested(MAX_OUTPUT_SCHEMA_DEPTH))), /nested deeper/u)

  /** @type {Record<string, any>} */
  const tooMany = {}
  for (let index = 0; index <= MAX_OUTPUT_PROPERTIES; index += 1) tooMany[`f${index}`] = { type: 'string' }
  assert.match(errorText(parse({ type: 'object', properties: tooMany })), /at most 64 properties/u)

  /** @type {Record<string, any>} */
  const tooLarge = {}
  for (let index = 0; index < 60; index += 1) {
    tooLarge[`f${index}`] = { type: 'string', description: 'x'.repeat(400) }
  }
  const large = parse({ type: 'object', properties: tooLarge })
  assert.equal(large.schema, null)
  assert.match(errorText(large), new RegExp(`at most ${Math.round(MAX_OUTPUT_SCHEMA_BYTES / 1024)} KiB`, 'u'))
})

test('output: buildResultSchema merges next and the built-in attachments capability', () => {
  const node = {
    id: 'dev',
    type: 'robot',
    output: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false,
    },
    next: [
      { to: 'review', name: '交稿' },
      { to: 'done', name: '完成' },
    ],
  }
  const before = JSON.parse(JSON.stringify(node.output))
  const schema = buildResultSchema(node)
  assert.deepEqual(schema.properties.next.enum, ['交稿', '完成'])
  assert.deepEqual(schema.required, ['summary', 'next'])
  assert.equal(schema.properties.attachments.type, 'array')
  assert.match(schema.properties.attachments.description, /independent data or files/u)
  assert.match(schema.properties.attachments.description, /never put the answer itself/u)
  assert.deepEqual(node.output, before, 'the declaration must not be mutated')

  const terminal = buildResultSchema({ id: 'done', type: 'robot', output: { type: 'object', properties: {} } })
  assert.equal(Object.hasOwn(terminal.properties, 'next'), false)
  assert.deepEqual(terminal.required, undefined)
  assert.equal(terminal.properties.attachments.type, 'array')

  const legacy = buildResultSchema({ id: 'old', type: 'robot' })
  assert.equal(legacy.type, 'object')
  assert.equal(legacy.additionalProperties, true)
  assert.equal(legacy.properties.attachments.type, 'array')
  assert.deepEqual(routeNamesOf(node), ['交稿', '完成'])
})

test('output: resolveOutputPath follows properties, array items and oneOf', () => {
  const schema = {
    type: 'object',
    properties: {
      status: { type: 'string' },
      meta: {
        type: 'object',
        properties: { kind: { type: 'string' } },
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
      choice: {
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
        ],
      },
    },
  }
  assert.equal(resolveOutputPath(schema, ['status']), null)
  assert.equal(resolveOutputPath(schema, ['meta', 'kind']), null)
  assert.equal(resolveOutputPath(schema, ['rows', '0', 'id']), null)
  assert.equal(resolveOutputPath(schema, ['choice', 'a']), null)
  assert.match(resolveOutputPath(schema, ['missing']), /not declared/u)
  assert.match(resolveOutputPath(schema, ['meta', 'missing']), /not declared/u)
  assert.match(resolveOutputPath(schema, ['rows', 'x']), /non-numeric/u)
  assert.match(resolveOutputPath(schema, ['rows', '0', 'missing']), /not declared/u)
  assert.match(resolveOutputPath(schema, ['choice', 'b']), /every oneOf variant/u)
  assert.match(resolveOutputPath(schema, ['status', 'deep']), /not an object/u)
  assert.match(
    resolveOutputPath({ type: 'object', properties: { rows: { type: 'array' } } }, ['rows', '0']),
    /does not declare "items"/u,
  )
})

test('output: outputProblems validates the declared result JSON', () => {
  const node = {
    id: 'check',
    type: 'robot',
    output: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'blocked'] },
        note: { type: 'string' },
        meta: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] },
        rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
      },
      required: ['status'],
      additionalProperties: false,
    },
    next: [{ to: 'done', name: '完成' }],
  }
  assert.deepEqual(outputProblems(node, { next: '完成', status: 'ok', attachments: [] }), [])
  assert.deepEqual(outputProblems(node, { status: 'ok' }), [])

  const missing = outputProblems(node, { next: '完成' })
  assert.deepEqual(missing, ['status: missing required field'])

  const wrong = outputProblems(node, { status: 'ok', note: 1 })
  assert.deepEqual(wrong, ['note: expected string, got integer'])

  const badEnum = outputProblems(node, { status: 'maybe' })
  assert.match(badEnum[0], /must be one of/)

  const nested = outputProblems(node, { status: 'ok', meta: {} })
  assert.match(nested[0], /meta\.kind: missing required field/)

  const rows = outputProblems(node, { status: 'ok', rows: [{ id: 2 }] })
  assert.match(rows[0], /rows\[0\]\.id: expected string/)

  const extra = outputProblems(node, { status: 'ok', extra: true })
  assert.match(extra[0], /extra: unexpected field/)

  // 顶层 next / attachments 是引擎字段，不参与声明字段校验。
  assert.deepEqual(outputProblems(node, { status: 'ok', next: '完成', attachments: ['a'] }), [])

  // 升级前的快照没有 output：不校验。
  assert.deepEqual(outputProblems({ id: 'old', type: 'robot' }, { anything: true }), [])

  const oneOfNode = {
    output: { type: 'object', properties: { value: { oneOf: [{ type: 'string' }, { type: 'number' }] } } },
  }
  assert.deepEqual(outputProblems(oneOfNode, { value: 3 }), [])
  assert.match(outputProblems(oneOfNode, { value: true })[0], /oneOf variant/u)
})

test('output: renderOutputContract states the final-text and attachment rules', () => {
  const node = {
    id: 'dev',
    type: 'robot',
    output: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    next: [{ to: 'done', name: '完成' }],
  }
  const contract = renderOutputContract(node)
  assert.match(contract, /^---\nResult contract \(added by the workflow\):/u)
  assert.match(contract, /"summary"/)
  assert.match(contract, /"next"/)
  assert.match(contract, /"attachments"/)
  assert.match(contract, /final assistant text is this step's output/)
  assert.match(contract, /not a place for the answer itself/)
  assert.doesNotMatch(contract, /deliverable/u)

  assert.equal(renderOutputContract({ id: 'old', type: 'robot' }), '')
})

test('template: inspectTemplate extracts paths and reports syntax errors', () => {
  const inspected = inspectTemplate('目标 {{goal}}；{{nodes.dev.data.summary}}；{{ nodes.dev.text }}')
  assert.deepEqual(inspected.paths, ['goal', 'nodes.dev.data.summary', 'nodes.dev.text'])
  assert.deepEqual(inspected.errors, [])

  const broken = inspectTemplate('{{}} {{bad path}}')
  assert.deepEqual(broken.paths, [])
  assert.deepEqual(broken.errors, ['empty template placeholder', 'invalid template path "bad path"'])
})

test('definition: output is required on robot nodes and rejected on fixed nodes', () => {
  const base = (output) => ({
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: 'go' }] },
      { id: 'dev', type: 'robot', robot: 'coder', ...(output === undefined ? {} : { output }) },
    ],
  })
  const missing = validateDefinition(base(undefined))
  assert.equal(missing.ok, false)
  assert.match(
    missing.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /nodes\[1\]\.output: is required/u,
  )

  const fixed = validateDefinition({
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: 'go' }] },
      { id: 'dev', type: 'robot', robot: 'coder', output: { type: 'object', properties: {} } },
      { id: 'done', type: 'end', output: { type: 'object', properties: {} } },
    ],
  })
  // done 不可达且带 output：两条错误都应出现。
  assert.match(fixed.errors.map((error) => error.message).join('\n'), /only supported on robot nodes/u)
})

test('definition: prompt references are checked against the declared output', () => {
  const withPrompt = (prompt) => ({
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt }] },
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        output: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            meta: { type: 'object', properties: { kind: { type: 'string' } } },
          },
          required: ['status'],
        },
        next: [{ to: 'done', name: '完成' }],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })

  const ok = validateDefinition(withPrompt('read {{nodes.dev.data.status}} and {{nodes.dev.data.meta.kind}}'))
  assert.equal(ok.ok, true, ok.errors.map((error) => error.message).join('; '))

  const missing = validateDefinition(withPrompt('read {{nodes.dev.data.missing}}'))
  assert.equal(missing.ok, false)
  assert.match(
    missing.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /nodes\[0\]\.next\[0\]\.prompt: template path "nodes\.dev\.data\.missing" is not declared in node "dev"\.output/u,
  )

  const unknownNode = validateDefinition(withPrompt('read {{nodes.ghost.text}}'))
  assert.match(
    unknownNode.errors.map((error) => error.message).join('\n'),
    /references unknown node "ghost"/u,
  )

  const nonRobot = validateDefinition(withPrompt('read {{nodes.done.text}}'))
  assert.match(nonRobot.errors.map((error) => error.message).join('\n'), /only robot nodes provide/u)

  const reserved = validateDefinition(withPrompt('read {{nodes.dev.data.next}}'))
  assert.match(reserved.errors.map((error) => error.message).join('\n'), /reserved field "next"/u)
  assert.match(reserved.errors.map((error) => error.message).join('\n'), /use \{\{nodes\.dev\.route\}\}/u)

  const syntax = validateDefinition(withPrompt('read {{bad path}}'))
  assert.match(syntax.errors.map((error) => error.message).join('\n'), /invalid template path/u)
})

test('definition: gate decisions and attachments are checked by node type', () => {
  const base = () => ({
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: 'go' }] },
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        output: { type: 'object', properties: {} },
        next: [{ to: 'gate', name: '提交' }],
      },
      {
        id: 'gate',
        type: 'gate',
        title: '确认',
        onApprove: { to: 'publish', name: '批准', prompt: 'decided {{nodes.gate.decision}}' },
        onReject: 'done',
      },
      {
        id: 'publish',
        type: 'robot',
        robot: 'publisher',
        output: { type: 'object', properties: {} },
        next: [{ to: 'done', name: '完成' }],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  const ok = validateDefinition(base())
  assert.equal(ok.ok, true, ok.errors.map((error) => error.message).join('; '))

  const wrong = base()
  wrong.nodes[2].onApprove.prompt = 'decision {{nodes.dev.decision}}'
  assert.match(
    validateDefinition(wrong).errors.map((error) => error.message).join('\n'),
    /only gate nodes provide/u,
  )

  const dataOnGate = base()
  dataOnGate.nodes[2].onApprove.prompt = 'data {{nodes.gate.data.ok}}'
  assert.match(
    validateDefinition(dataOnGate).errors.map((error) => error.message).join('\n'),
    /only robot nodes provide/u,
  )

  const attachmentsOnRobot = base()
  attachmentsOnRobot.nodes[2].onApprove.prompt = 'files {{nodes.dev.attachments.0.path}}'
  assert.equal(validateDefinition(attachmentsOnRobot).ok, true)
})
