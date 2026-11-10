/**
 * workflow 结果解析的纯单测：`next` 选路与 `abort` 主动终止。
 *
 * 这些函数不读盘、不依赖 DSH；supervisor 的集成行为在
 * `workflows-supervisor.test.mjs` 里覆盖。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_ABORT_REASON_LENGTH,
  resolveAbort,
  resolveRoute,
} from '../plugins/workflows/lib/routing.js'

const NODE = { id: 'check', type: 'robot', next: [{ to: 'done', name: '完成' }] }

test('routing: an abort string ends the run and is trimmed', () => {
  assert.deepEqual(resolveAbort({ abort: '  无法访问生产环境  ' }), {
    abort: { reason: '无法访问生产环境' },
  })
  assert.deepEqual(resolveAbort({ next: '完成', abort: '继续不了' }), {
    error: {
      kind: 'ambiguous-result',
      message: 'the result carries both "next" and "abort"; submit exactly one of them',
    },
  })
})

test('routing: no abort key is left to the next route', () => {
  assert.equal(resolveAbort({ next: '完成' }), null)
  assert.equal(resolveAbort({}), null)
  assert.equal(resolveAbort(null), null)
  assert.equal(resolveAbort('text'), null)
  assert.equal(resolveAbort(['abort']), null)
})

test('routing: invalid abort shapes are reported with a retry reason', () => {
  for (const data of [{ abort: '' }, { abort: '   ' }, { abort: null }, { abort: true }, { abort: 3 }]) {
    const resolved = resolveAbort(data)
    assert.equal(resolved.error.kind, 'invalid-abort')
    assert.match(resolved.error.message, /abort/u)
  }
})

test('routing: a long abort reason is truncated', () => {
  const resolved = resolveAbort({ abort: 'x'.repeat(MAX_ABORT_REASON_LENGTH + 50) })
  assert.equal(resolved.abort.reason.length, MAX_ABORT_REASON_LENGTH)
})

test('routing: resolveRoute still follows a valid next route', () => {
  assert.deepEqual(resolveRoute(NODE, { next: '完成' }), { rule: NODE.next[0] })
  assert.deepEqual(resolveRoute({ id: 'terminal', next: [] }, {}), { rule: null })
  const missing = resolveRoute(NODE, {})
  assert.match(missing.error, /no "next" route/u)
  assert.deepEqual(missing.routes, ['完成'])
  const unknown = resolveRoute(NODE, { next: 'nope' })
  assert.match(unknown.error, /unknown route/u)
})
