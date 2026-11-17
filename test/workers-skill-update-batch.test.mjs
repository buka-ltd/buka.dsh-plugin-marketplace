/**
 * 「更新全部打工人」批量编排的单测。
 *
 * 覆盖验收标准里的批量行为：只对智能体且装了 skill 的 worker 执行、机器人 /
 * 空 skills 跳过、按登记表顺序执行、单个失败不中断、最后汇总每个 worker 的
 * 结果与整体成功 / 失败数。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { updateWorkersSequentially } from '../plugins/workers/src/skill-update-batch.ts'

/** 一条 worker。 */
function worker(id, overrides = {}) {
  return {
    id,
    name: '',
    driver: 'agent',
    path: `/workers/${id}`,
    exists: true,
    skills: [{ name: 'demo' }],
    ...overrides,
  }
}

test('批量更新：跳过机器人 / 目录缺失 / 空 skills，按顺序执行', async () => {
  const calls = []
  const update = async ({ dir }) => {
    calls.push(dir)
    return {
      ok: true,
      message: `updated ${dir}`,
      updated: [{ name: 'a' }, { name: 'b' }],
      skipped: [],
      failed: [],
    }
  }
  const batch = await updateWorkersSequentially({
    workers: [
      worker('first'),
      worker('robot', { driver: 'robot', path: '', exists: false }),
      worker('missing', { exists: false }),
      worker('empty', { skills: [] }),
      worker('second', { name: 'Second worker' }),
    ],
    update,
  })

  assert.deepEqual(calls, ['/workers/first', '/workers/second'])
  assert.deepEqual(
    batch.results.map((one) => one.id),
    ['first', 'second'],
  )
  assert.equal(batch.results[1].name, 'Second worker')
  assert.equal(batch.updated, 4)
  assert.equal(batch.failed, 0)
  assert.equal(batch.skippedWorkers, 3)
})

test('批量更新：worker 内部分 skill 失败时该 worker 记失败，汇总按失败 skill 数', async () => {
  const update = async ({ dir }) => {
    if (dir === '/workers/partial') {
      return {
        ok: true,
        message: '已更新 1 个 skill，1 个失败。',
        updated: [{ name: 'a' }],
        skipped: [{ name: 's' }],
        failed: [{ name: 'b', message: '网络错误' }],
      }
    }
    return { ok: true, message: '已是最新。', updated: [], skipped: [], failed: [] }
  }
  const batch = await updateWorkersSequentially({
    workers: [worker('partial'), worker('ok')],
    update,
  })

  assert.deepEqual(
    batch.results.map((one) => [one.id, one.ok, one.failed]),
    [
      ['partial', false, 1],
      ['ok', true, 0],
    ],
  )
  assert.equal(batch.results[0].message, '已更新 1 个 skill，1 个失败。')
  assert.equal(batch.failed, 1, '汇总数字是失败的 skill 数')
  assert.equal(batch.updated, 1)
})

test('批量更新：整体失败但没有逐项记录时仍计 1 个失败', async () => {
  const update = async () => ({
    ok: false,
    code: 'unsupported-home',
    message: '全局根不一致',
  })
  const batch = await updateWorkersSequentially({ workers: [worker('broken')], update })

  assert.equal(batch.results[0].ok, false)
  assert.equal(batch.results[0].failed, 0)
  assert.equal(batch.results[0].message, '全局根不一致')
  assert.equal(batch.failed, 1)
})

test('批量更新：单个失败不中断，失败项带原因，最后汇总', async () => {
  const calls = []
  const update = async ({ dir }) => {
    calls.push(dir)
    if (dir === '/workers/bad') throw new Error('boom')
    if (dir === '/workers/failed') {
      return { ok: false, message: '检查失败', updated: [], skipped: [], failed: [{}] }
    }
    return { ok: true, message: '已是最新。', updated: [], skipped: [{ name: 'x' }], failed: [] }
  }
  const batch = await updateWorkersSequentially({
    workers: [worker('ok'), worker('bad'), worker('failed'), worker('last')],
    update,
  })

  assert.deepEqual(calls, ['/workers/ok', '/workers/bad', '/workers/failed', '/workers/last'])
  assert.deepEqual(
    batch.results.map((one) => [one.id, one.ok]),
    [
      ['ok', true],
      ['bad', false],
      ['failed', false],
      ['last', true],
    ],
  )
  assert.match(batch.results[1].message, /boom/u)
  assert.equal(batch.results[0].skipped, 1)
  assert.equal(batch.failed, 2)
  assert.equal(batch.updated, 0)
})
