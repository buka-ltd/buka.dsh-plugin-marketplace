/**
 * @buka/dsh-plugin-workflows 工作流模板目录的单测。
 *
 * 覆盖目录的静态数据完整性、按 id 查找、摘要与可读描述，以及结构校验器的
 * 错误路径。模板是抽象参考（角色名 + 无 output），校验器比可运行定义的校验宽松。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTemplateGraph, layoutRunGraph } from '../plugins/workflows/src/graph.ts'
import {
  describeTemplate,
  findTemplate,
  listTemplates,
  summarizeTemplates,
  validateTemplates,
  WORKFLOW_TEMPLATES,
} from '../plugins/workflows/src/templates.ts'

test('templates: the shipped catalog is non-empty, valid and uniquely identified', () => {
  assert.ok(Array.isArray(WORKFLOW_TEMPLATES), 'templates are an array')
  assert.ok(WORKFLOW_TEMPLATES.length > 0, 'templates are not empty')

  const ids = new Set()
  for (const template of WORKFLOW_TEMPLATES) {
    assert.equal(typeof template.id, 'string')
    assert.equal(typeof template.name, 'string')
    assert.equal(typeof template.description, 'string')
    assert.ok(
      Array.isArray(template.nodes) && template.nodes.length > 0,
      'each template has a flow',
    )
    assert.equal(ids.has(template.id), false, `template id "${template.id}" is unique`)
    ids.add(template.id)
  }
  assert.deepEqual(validateTemplates(WORKFLOW_TEMPLATES), { ok: true, errors: [] })
})

test('templates: abstract robot roles never collide with concrete robot names', () => {
  // 模板里的角色是抽象占位，不是真实机器人；这里只保证每个机器人节点都写明了角色。
  for (const template of WORKFLOW_TEMPLATES) {
    const robots = template.nodes.filter((node) => node.type === 'robot')
    for (const node of robots) {
      assert.equal(typeof node.robot, 'string')
      assert.notEqual(node.robot.trim(), '')
      assert.equal(
        Object.hasOwn(node, 'output'),
        false,
        `template "${template.id}" node "${node.id}" stays abstract (no output)`,
      )
    }
  }
})

test('templates: list, summarize and find behave as expected', () => {
  assert.deepEqual(listTemplates(), WORKFLOW_TEMPLATES)
  const summaries = summarizeTemplates()
  assert.equal(summaries.length, WORKFLOW_TEMPLATES.length)
  for (const summary of summaries) {
    assert.deepEqual(Object.keys(summary).sort(), ['description', 'id', 'name'])
  }

  const first = WORKFLOW_TEMPLATES[0]
  assert.deepEqual(findTemplate(first.id), first)
  assert.equal(findTemplate(first.id.toUpperCase()), null)
  assert.equal(findTemplate('missing'), null)
  assert.equal(findTemplate(undefined), null)
})

test('templates: describeTemplate renders the name, description and abstract flow', () => {
  const template = WORKFLOW_TEMPLATES[0]
  const text = describeTemplate(template)
  assert.ok(text.includes(template.name))
  assert.ok(text.includes(template.id))
  assert.ok(text.includes(template.description))
  const robot = template.nodes.find((node) => node.type === 'robot')
  assert.ok(text.includes(robot.robot), 'the abstract role name appears in the description')
})

test('templates: every template builds a renderable node graph', () => {
  for (const template of WORKFLOW_TEMPLATES) {
    const model = buildTemplateGraph(template)
    assert.ok(model, `template "${template.id}" builds a graph model`)
    assert.equal(model.nodes.length, template.nodes.length, 'every node is in the graph')
    const graph = { ...model, ...layoutRunGraph(model) }
    assert.equal(graph.positions.length, template.nodes.length, 'every node gets a position')
    for (const edge of graph.edges) {
      assert.equal(typeof edge.d, 'string')
      assert.notEqual(edge.d, '', `edge ${edge.from}->${edge.to} has a path`)
    }
    // 模板是静态参考：所有节点都是 idle，不标 completed / 运行中。
    for (const node of graph.nodes) assert.equal(node.state, 'idle', `node "${node.id}" is idle`)
  }
})

test('templates: validateTemplates rejects malformed catalogs', () => {
  assert.deepEqual(validateTemplates(null), {
    ok: false,
    errors: ['templates must be a non-empty array'],
  })
  assert.deepEqual(validateTemplates([]), {
    ok: false,
    errors: ['templates must be a non-empty array'],
  })

  // 缺少必填字段。
  const missingFields = validateTemplates([{ nodes: [] }])
  assert.equal(missingFields.ok, false)
  assert.ok(missingFields.errors.some((message) => message.includes('.id')))
  assert.ok(missingFields.errors.some((message) => message.includes('.name')))
  assert.ok(missingFields.errors.some((message) => message.includes('.description')))
  assert.ok(missingFields.errors.some((message) => message.includes('.nodes')))

  // 重复 id。
  const base = {
    id: 'dup',
    name: 'n',
    description: 'd',
    nodes: [{ id: 'start', type: 'start', next: [] }],
  }
  const duplicated = validateTemplates([base, { ...base, nodes: base.nodes }])
  assert.equal(duplicated.ok, false)
  assert.ok(duplicated.errors.some((message) => message.includes('duplicates template "dup"')))
})

test('templates: validateTemplates checks start uniqueness, edge targets and reachability', () => {
  const goodNodes = [
    { id: 'start', type: 'start', next: [{ to: 'work', name: 'go' }] },
    { id: 'work', type: 'robot', robot: '开发', next: [{ to: 'done', name: 'finish' }] },
    { id: 'done', type: 'end', status: 'completed' },
  ]
  const wrap = (nodes) => [{ id: 't', name: 't', description: 'd', nodes }]

  // 缺 start。
  const noStart = validateTemplates(wrap([{ id: 'work', type: 'robot', robot: '开发', next: [] }]))
  assert.equal(noStart.ok, false)
  assert.ok(noStart.errors.some((message) => message.includes('exactly one start')))

  // 出边指向不存在的节点。
  const badEdge = validateTemplates(
    wrap([
      { id: 'start', type: 'start', next: [{ to: 'ghost', name: 'go' }] },
      { id: 'work', type: 'robot', robot: '开发', next: [] },
    ]),
  )
  assert.equal(badEdge.ok, false)
  assert.ok(badEdge.errors.some((message) => message.includes('unknown node "ghost"')))

  // 不可达节点。
  const unreachable = validateTemplates(
    wrap([
      { id: 'start', type: 'start', next: [] },
      { id: 'work', type: 'robot', robot: '开发', next: [] },
      { id: 'orphan', type: 'end', status: 'completed' },
    ]),
  )
  assert.equal(unreachable.ok, false)
  assert.ok(unreachable.errors.some((message) => message.includes('not reachable from start')))

  // 合法结构通过。
  assert.equal(validateTemplates(wrap(goodNodes)).ok, true)
})
