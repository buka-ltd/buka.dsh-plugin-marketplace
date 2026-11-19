/**
 * 执行者展示名的公共写法：名称 / displayName / 标识符的取值顺序与消歧格式。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { workerDisplayName, workerIdentityLabel } from '../packages/plugin-ui/src/worker-label.ts'

test('workerDisplayName：名称优先，其次 displayName，最后标识符', () => {
  assert.equal(workerDisplayName({ id: 'writer', name: '写作助手' }), '写作助手')
  assert.equal(workerDisplayName({ id: 'writer', name: '', displayName: '写作助手' }), '写作助手')
  assert.equal(workerDisplayName({ id: 'writer', name: '' }), 'writer')
  assert.equal(workerDisplayName(null), '')
})

test('workerIdentityLabel：名称与标识符相同时不重复，旧快照只有 name 时按标识符显示', () => {
  assert.equal(workerIdentityLabel({ id: 'writer', name: '写作助手' }), '写作助手 · writer')
  assert.equal(workerIdentityLabel({ id: 'writer', name: '' }), 'writer')
  assert.equal(workerIdentityLabel({ id: 'clock', name: 'clock' }), 'clock')
  // v7 旧作业快照只有 name，没有 id。
  assert.equal(workerIdentityLabel({ name: 'writer' }), 'writer')
  assert.equal(workerIdentityLabel(null), '')
})
