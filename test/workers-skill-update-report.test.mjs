/**
 * 单个打工人「更新 skills」结果的 HTTP 呈现单测。
 *
 * 覆盖两条失败路径：整体失败（`ok:false`，要回错误状态）与逐项失败
 * （`ok:true` 但 `failed` 非空，仍回 200 但 `ok:false`）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  reportSkillUpdate,
  skillUpdateErrorStatus,
} from '../plugins/workers/src/skill-update-report.ts'

test('更新上报：整体失败映射错误状态并带回 message / output', () => {
  const report = reportSkillUpdate({
    ok: false,
    code: 'unsupported-home',
    message: '全局根与 DSH 的扫描目录不一致',
    output: 'detail',
  })
  assert.equal(report.status, 500)
  assert.equal(report.ok, false)
  assert.equal(report.failed, 0)
  assert.deepEqual(report.failure, {
    code: 'unsupported-home',
    message: '全局根与 DSH 的扫描目录不一致',
    output: 'detail',
  })
})

test('更新上报：逐项失败是 200 但 ok:false，并计入失败数', () => {
  const report = reportSkillUpdate({
    ok: true,
    message: '已更新 1 个 skill，1 个失败。',
    updated: [{ name: 'a' }],
    skipped: [],
    failed: [{ name: 'b', message: '网络错误' }],
  })
  assert.equal(report.status, 200)
  assert.equal(report.ok, false)
  assert.equal(report.failed, 1)
  assert.equal(report.failure, null)
})

test('更新上报：没有失败时整体成功', () => {
  const report = reportSkillUpdate({
    ok: true,
    message: '已更新 2 个 skill。',
    updated: [{ name: 'a' }, { name: 'b' }],
    skipped: [],
    failed: [],
  })
  assert.equal(report.status, 200)
  assert.equal(report.ok, true)
  assert.equal(report.failed, 0)
  assert.equal(report.failure, null)
})

test('更新上报：未知失败码按 502，无效参数按 400，lock 不可读按 409', () => {
  assert.equal(skillUpdateErrorStatus(undefined), 502)
  assert.equal(skillUpdateErrorStatus('check-failed'), 502)
  assert.equal(skillUpdateErrorStatus('invalid-dir'), 400)
  assert.equal(skillUpdateErrorStatus('lock-unreadable'), 409)
  assert.equal(skillUpdateErrorStatus('unsupported-home'), 500)
})
