/**
 * DSH 的 `commands` 服务按 agent 作用域解析命令：挂载在某个会话上下文之下的
 * 命令只对该 agent 可见。workers 的 plan 模式入口依赖这条语义——它无法读取
 * 被 `isolate` 在会话 preset 内的 `planMode` 服务，只能对目标 agent 执行
 * `/plan`。
 *
 * 这个测试用真实的 `@deepseek-ai/dsh-commands` + `@deepseek-ai/dsh-scope` 把
 * 这条假设钉住：DSH 侧行为变化时，这里会先失败，而不是等真实工作流静默降级。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import CommandsService from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'

/** 一个能记录生命周期事件的最小会话。 */
function makeSession(id) {
  const events = []
  return {
    id,
    get seq() {
      return events.length
    },
    append(type, data) {
      events.push({ type, data, seq: events.length })
    },
  }
}

/** 一个只用来做作用域 key 与命令接收者的 agent。 */
function makeAgent(id) {
  return { id, session: makeSession(id) }
}

/**
 * 在 agent 作用域下注册一条命令。
 *
 * @returns {Promise<{ dispose(): Promise<void> }>} 作用域句柄
 */
async function mountScopedPlanCommand(root, agent) {
  const scope = createScope(root, agent)
  await scope.ctx.plugin((ctx) => {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'plan',
        description: 'Enter plan mode',
        handler: ({ rawInput }) => ({ kind: 'success', text: `plan ${rawInput}`.trim() }),
      })
    })
  })
  return scope
}

test('commands: an agent-scoped /plan resolves for that agent and stays invisible to others', async () => {
  const root = new Context()
  try {
    await root.plugin(CommandsService)
    const agent = makeAgent('agent-1')
    const other = makeAgent('agent-2')
    const scope = await mountScopedPlanCommand(root, agent)
    try {
      const commands = root.get('commands')
      assert.deepEqual(
        commands.list(agent).map((command) => command.name),
        ['plan'],
      )
      const execution = await commands.execute(agent, '/plan', [], new AbortController().signal)
      assert.equal(execution?.result?.kind, 'success')
      assert.equal(
        await commands.execute(other, '/plan', [], new AbortController().signal),
        undefined,
        'the scoped command is not visible to another agent',
      )
    } finally {
      await scope.dispose()
    }
  } finally {
    await root.fiber.dispose()
  }
})

test('commands: an unknown command is returned as undefined instead of throwing', async () => {
  const root = new Context()
  try {
    await root.plugin(CommandsService)
    const agent = makeAgent('agent-3')
    const commands = root.get('commands')
    assert.equal(
      await commands.execute(agent, '/plan', [], new AbortController().signal),
      undefined,
      'no command is registered for this agent',
    )
    assert.equal(
      await commands.execute(agent, 'not-a-command', [], new AbortController().signal),
      undefined,
    )
  } finally {
    await root.fiber.dispose()
  }
})
