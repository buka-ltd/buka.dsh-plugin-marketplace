/**
 * `buka_workflow_start` 对 plan 节点的启动前校验。
 *
 * plan 模式在 web/desktop 的组合里被 `isolate` 在会话 preset 内，profile 根部
 * 看不到 `planMode` 服务；工作流只能靠 `commands` 服务（对 agent 执行
 * `/plan`）这条入口，所以校验不能要求根作用域的 planMode 服务。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveOptions } from '../plugins/workflows/src/options.ts'
import { registerWorkflowTools } from '../plugins/workflows/src/tools.ts'

/**
 * 注册工作流工具并返回按名字取工具的入口。
 *
 * @returns {{ state: Record<string, any>, tool: (name: string) => any }}
 */
function makeHarness({ robots, commands, userQuestions } = {}) {
  const state = { tools: new Map(), readyCalls: 0, starts: [] }
  const ctx = {
    get(name) {
      if (name === 'bukaRobots') return robots
      // 真实 desktop/web 组合里根部没有 planMode 服务；这里也不提供。
      if (name === 'planMode') return undefined
      if (name === 'commands') return commands
      if (name === 'userQuestions') return userQuestions
      return undefined
    },
    tools: {
      register(tool) {
        state.tools.set(tool.name, tool)
      },
    },
  }
  registerWorkflowTools({
    ctx,
    options: resolveOptions(undefined),
    store: {
      async readRun() {
        return { seq: 1 }
      },
    },
    supervisor: {
      async start() {
        state.starts.push('start')
        return { runId: 'run-1', seq: 1 }
      },
    },
    ensureReady: async () => {
      state.readyCalls += 1
    },
    assertOrchestrator: () => {},
    visibleWhen: () => true,
  })
  return { state, tool: (name) => state.tools.get(name) }
}

/** 一个只有 plan 机器人节点与 end 的合法定义。 */
function planDefinition() {
  return {
    goal: '先计划再实施',
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [{ to: 'dev', name: '开始', prompt: '先给出实施计划。' }],
      },
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        mode: 'plan',
        summary: '先计划',
        output: { type: 'object', properties: {} },
        next: [{ to: 'done', name: '完成' }],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
}

/** 带一个普通机器人节点的合法定义。 */
function normalDefinition() {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [{ to: 'dev', name: '开始', prompt: '实现。' }],
      },
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        summary: '实现',
        output: { type: 'object', properties: {} },
        next: [{ to: 'done', name: '完成' }],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
}

test('workflow start: plan nodes start when commands are composed and no root planMode service exists', async () => {
  const harness = makeHarness({
    robots: { dispatchSession() {}, supportsPlanMode: true },
    commands: { execute() {} },
    userQuestions: { ask() {} },
  })
  const result = await harness
    .tool('buka_workflow_start')
    .execute({ definition: planDefinition() }, { agent: { id: 'root' } })
  assert.equal(result.mode, 'background')
  assert.equal(harness.state.starts.length, 1, 'the run starts')
})

test('workflow start: plan nodes are rejected clearly when the command entry is missing', async () => {
  const harness = makeHarness({
    robots: { dispatchSession() {}, supportsPlanMode: true },
    userQuestions: { ask() {} },
  })
  await assert.rejects(
    () =>
      harness
        .tool('buka_workflow_start')
        .execute({ definition: planDefinition() }, { agent: { id: 'root' } }),
    /plan mode robot nodes need the commands service/u,
  )
  assert.equal(harness.state.starts.length, 0)
})

test('workflow start: plan nodes are rejected clearly when robots is missing or too old', async () => {
  const oldRobots = makeHarness({
    robots: { dispatchSession() {} },
    commands: { execute() {} },
    userQuestions: { ask() {} },
  })
  await assert.rejects(
    () =>
      oldRobots
        .tool('buka_workflow_start')
        .execute({ definition: planDefinition() }, { agent: { id: 'root' } }),
    /need @buka\/dsh-plugin-robots 0\.9\.0 or newer/u,
  )

  // 完全没有 robots 服务时，先命中的是更基础的「机器人节点需要 dispatchSession」
  // 检查；这里只确认它不会走到需要根 planMode 服务的旧分支。
  const noRobots = makeHarness({
    commands: { execute() {} },
    userQuestions: { ask() {} },
  })
  await assert.rejects(
    () =>
      noRobots
        .tool('buka_workflow_start')
        .execute({ definition: planDefinition() }, { agent: { id: 'root' } }),
    /robot nodes need a Buka Robots service with dispatchSession/u,
  )
})

test('workflow start: plan nodes are rejected clearly without the user-questions service', async () => {
  const harness = makeHarness({
    robots: { dispatchSession() {}, supportsPlanMode: true },
    commands: { execute() {} },
  })
  await assert.rejects(
    () =>
      harness
        .tool('buka_workflow_start')
        .execute({ definition: planDefinition() }, { agent: { id: 'root' } }),
    /user-questions service/u,
  )
})

test('workflow start: normal robot nodes do not need the command entry', async () => {
  const harness = makeHarness({ robots: { dispatchSession() {}, supportsPlanMode: true } })
  const result = await harness
    .tool('buka_workflow_start')
    .execute({ definition: normalDefinition() }, { agent: { id: 'root' } })
  assert.equal(result.mode, 'background')
  assert.equal(harness.state.starts.length, 1)
})
