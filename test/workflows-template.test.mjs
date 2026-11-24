/**
 * 模板渲染单测：可选路径（`{{input.remark?}}`）、严格默认与保存校验。
 *
 * 直接 import TS 源码（Node 24 原样跑 TS），不依赖宿主。运行：
 *
 *   node --test test/workflows-template.test.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTemplateContext,
  inspectPayload,
  renderPayload,
  validateWorkflowDefinition,
} from '../plugins/workflows/src/definition/index.ts'
import {
  inspectTemplate,
  parsePlaceholder,
  renderTemplate,
} from '../plugins/workflows/src/template.ts'

test('template: an optional path renders an empty string when the key is missing', () => {
  assert.equal(renderTemplate('备注：{{input.remark?}}', { input: {} }), '备注：')
  assert.equal(renderTemplate('{{input.remark?}}', { input: null }), '')
  assert.equal(renderTemplate('{{input.remark?}}', {}), '')
})

test('template: a strict path still fails and points at the optional syntax', () => {
  assert.throws(
    () => renderTemplate('备注：{{input.remark}}', { input: {} }),
    (error) => {
      assert.match(error.message, /template path "input\.remark" is not available yet/u)
      assert.match(error.message, /add "\?" to the path/u)
      assert.equal(error.path, 'input.remark')
      return true
    },
  )
})

test('template: explicitly present empty / 0 / false values render as-is', () => {
  for (const value of ['', 0, false]) {
    assert.equal(renderTemplate('{{input.value?}}', { input: { value } }), String(value))
    assert.equal(renderTemplate('{{input.value}}', { input: { value } }), String(value))
  }
  // 嵌套路径同样按「键不存在才算缺失」判断。
  assert.equal(renderTemplate('{{input.nested.value?}}', { input: { nested: { value: '' } } }), '')
  assert.throws(
    () => renderTemplate('{{input.nested.value}}', { input: { nested: {} } }),
    /not available yet/u,
  )
})

test('template: mixed text keeps the surrounding text', () => {
  assert.equal(renderTemplate('备注：{{input.remark?}}（可选）', { input: {} }), '备注：（可选）')
  assert.equal(
    renderTemplate('备注：{{input.remark?}}（可选）', { input: { remark: '已确认' } }),
    '备注：已确认（可选）',
  )
})

test('template: parsing keeps the optional marker out of the path', () => {
  assert.deepEqual(parsePlaceholder('input.remark?'), { path: 'input.remark', optional: true })
  assert.deepEqual(parsePlaceholder('input.remark'), { path: 'input.remark', optional: false })
  assert.deepEqual(parsePlaceholder('?'), { error: 'invalid template path "?"' })
  assert.deepEqual(inspectTemplate('{{input.a?}} {{input.b}}'), {
    paths: ['input.a', 'input.b'],
    errors: [],
  })
})

test('template: optional paths are inspected without the marker', () => {
  const inspection = inspectPayload({ note: '{{input.remark?}}', other: '{{content.x}}' })
  assert.deepEqual(
    inspection.references.map((reference) => reference.path),
    ['input.remark', 'content.x'],
  )
  assert.deepEqual(inspection.syntaxErrors, [])
})

/** 一个最小工作流：人岗位动作沿回向通道创建开发任务，内容模板可替换。 */
function actionDefinition(template) {
  return {
    version: 8,
    name: '可选路径',
    budgets: { maxTasks: 10, maxDurationHours: 1 },
    start: { next: [{ channel: 'start.dev', type: 'dev.work' }] },
    positions: [
      {
        id: 'dev',
        label: '开发',
        executor: { kind: 'worker', id: 'w' },
        taskTypes: [{ id: 'dev.work', label: '开发', content: { type: 'object' } }],
      },
      {
        id: 'review',
        label: '审批',
        executor: { kind: 'human' },
        taskTypes: [
          {
            id: 'review.decide',
            label: '决定',
            content: { type: 'object' },
            actions: [
              {
                id: 'decide',
                label: '决定',
                input: {
                  type: 'object',
                  properties: { remark: { type: 'string' } },
                  additionalProperties: false,
                },
                creates: [{ channel: 'review.dev', type: 'dev.work', content: { note: template } }],
              },
            ],
          },
        ],
      },
    ],
    channels: [
      { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
      { id: 'dev.review', label: '送审', from: 'dev', to: 'review', types: ['review.decide'] },
      {
        id: 'review.dev',
        label: '返工',
        from: 'review',
        to: 'dev',
        types: ['dev.work'],
        back: true,
      },
      { id: 'dev.end', label: '交付', from: 'dev', to: 'end' },
    ],
    end: { content: { type: 'object' } },
  }
}

/** 校验用的执行者目录。 */
function workers() {
  return new Map([['w', { id: 'w', name: '', displayName: 'w', driver: 'agent' }]])
}

test('definition: an optional path must still exist in the form schema', () => {
  const ok = validateWorkflowDefinition(actionDefinition('备注：{{input.remark?}}'), {
    workers: workers(),
  })
  assert.equal(ok.ok, true, JSON.stringify(ok.issues ?? []))
  const taskType = ok.definition.positions[1].taskTypes[0]
  assert.equal(taskType.actions[0].creates[0].content.note, '备注：{{input.remark?}}')

  const unknown = validateWorkflowDefinition(actionDefinition('{{input.unknown?}}'), {
    workers: workers(),
  })
  assert.equal(unknown.ok, false)
  assert.ok(
    unknown.issues.some((issue) =>
      issue.message.includes('template "{{input.unknown}}" is not declared'),
    ),
    JSON.stringify(unknown.issues),
  )
})

test('definition: an optional path renders through the payload pipeline', () => {
  const rendered = renderPayload(
    { note: '备注：{{input.remark?}}', from: '{{content.id}}' },
    buildTemplateContext({ content: { id: 't-1' }, input: {} }),
  )
  assert.deepEqual(rendered, { note: '备注：', from: 't-1' })
})
