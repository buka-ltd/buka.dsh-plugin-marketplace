/**
 * workers 写 skills 时选择串行队列的单测。
 *
 * 覆盖：Skills 服务在时优先用它的 `runSerialized`（并且真的串行）；插件没装
 * 或服务没有这个入口时退回本地队列。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { preferSharedQueue } from '../plugins/workers/src/serial-runner.ts'

/** 建一个假服务：`runSerialized` 真的串行并记录调用数。 */
function makeSharedService() {
  let queue = Promise.resolve()
  const state = { calls: 0 }
  return {
    state,
    runSerialized(work) {
      state.calls += 1
      const run = queue.then(work, work)
      queue = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}

test('串行执行器：Skills 服务在时优先用共用队列并串行执行', async () => {
  const service = makeSharedService()
  let fallbackCalls = 0
  const serial = preferSharedQueue(service, async (work) => {
    fallbackCalls += 1
    return await work()
  })

  const order = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const first = serial(async () => {
    order.push('start-1')
    await gate
    order.push('end-1')
  })
  const second = serial(async () => {
    order.push('start-2')
  })
  release()
  await Promise.all([first, second])

  assert.equal(service.state.calls, 2)
  assert.equal(fallbackCalls, 0, '有共用队列时不用本地队列')
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2'])
})

test('串行执行器：服务缺失或没有 runSerialized 时退回本地队列', async () => {
  let fallbackCalls = 0
  const fallback = async (work) => {
    fallbackCalls += 1
    return await work()
  }

  assert.equal(await preferSharedQueue(null, fallback)(async () => 1), 1)
  assert.equal(await preferSharedQueue(undefined, fallback)(async () => 2), 2)
  assert.equal(await preferSharedQueue({}, fallback)(async () => 3), 3)
  assert.equal(fallbackCalls, 3)
})
