/**
 * 真实 cordis 上下文里的可选服务读取回归。
 *
 * 默认 web/desktop 组成把 `planMode` 服务 isolate 在会话 preset 的
 * `planning` 组里；profile 根部的插件（robots）读它时必须按"不存在"处理，
 * 不能因为 cordis 的注入检查而抛错。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'

import { optionalService } from '../plugins/robots/src/engine/session-runtime.ts'

/** 一个最小的 planMode 替身：只用于占据隔离作用域里的服务名。 */
class PlanModeStub extends Service {
  constructor(ctx) {
    super(ctx, 'planMode')
  }

  set() {
    return 'committed'
  }

  get() {
    return { active: false }
  }
}

test('optional service: a service isolated from the caller reads as undefined instead of throwing', async () => {
  const root = new Context()
  try {
    // 模拟 preset 的 planning 组：服务在隔离作用域里提供，父作用域看不到。
    const planning = root.isolate('planMode')
    await planning.plugin(PlanModeStub)
    assert.equal(root.get('planMode'), undefined, 'the isolated service is not visible to root')

    let observed
    await root.plugin((ctx) => {
      observed = optionalService(ctx, 'planMode')
    })
    assert.equal(
      observed,
      undefined,
      'the optional lookup must not throw when the service is isolated',
    )
  } finally {
    await root.fiber.dispose()
  }
})

test('optional service: a composed service is returned and plain test doubles still work', async () => {
  const root = new Context()
  try {
    new PlanModeStub(root)
    let observed
    await root.plugin((ctx) => {
      observed = optionalService(ctx, 'planMode')
    })
    assert.ok(observed, 'a visible service is returned')
    assert.equal(typeof observed.set, 'function', 'the returned value is the composed service')
  } finally {
    await root.fiber.dispose()
  }

  // 旧式测试替身：没有 ctx.get 时读直接挂载的同名字段。
  const direct = { set() {} }
  assert.equal(optionalService({ planMode: direct }, 'planMode'), direct)
  // 有 ctx.get 但拿不到时，仍然回退到直接字段。
  assert.equal(optionalService({ get: () => undefined, planMode: direct }, 'planMode'), direct)
})
