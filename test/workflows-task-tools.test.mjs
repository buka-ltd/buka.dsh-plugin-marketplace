/**
 * 任务作用域工具：用真实的 `@deepseek-ai/dsh-tools` + `@deepseek-ai/dsh-scope`
 * 验证「按任务注册、遮蔽全局、会话释放后撤销」这条契约。
 *
 * 工具说明里直接列出本任务可创建的 target 与人任务的动作，执行者不再需要先调
 * `buka_task_targets` / `buka_task_actions`（两者已删除）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import ToolsService from '@deepseek-ai/dsh-tools'
import {
  taskCompleteDescription,
  taskCreateDescription,
} from '../plugins/workflows/src/tools/descriptions.ts'
import {
  defineTaskCompleteTool,
  defineTaskCreateTool,
} from '../plugins/workflows/src/tools/index.ts'
import { installTaskScopedTools } from '../plugins/workflows/src/tools/task-scope.ts'

/** 一张任务对应的一组引擎查询结果。 */
function makeEngine({ targets = [], actions = [], taskSessions = [] } = {}) {
  const sessions = new Set(taskSessions)
  return {
    taskForSession: (sessionId) =>
      sessions.has(sessionId) ? { jobId: 'job-1', taskId: 't-1' } : null,
    creatableTargetsForSession: () => targets,
    taskActionsForSession: () => actions,
  }
}

/** 轮询等待条件成立。 */
async function waitFor(check, timeoutMs = 1000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('waitFor timed out')
}

/** 启动一个真实 tools 服务并装好作用域工具。 */
async function setup({ targets, actions, taskSessions } = {}) {
  const root = new Context()
  // tools 服务依赖 systemPrompt：只提供注册表用到的两个入口即可。
  root.provide('systemPrompt', {
    tools: () => () => {},
    section: () => '',
  })
  await root.plugin(ToolsService)
  const engine = makeEngine({ targets, actions, taskSessions })
  installTaskScopedTools({ ctx: root, ready: async () => engine })
  return { root, engine }
}

test('task tools: the scoped description lists this task’s targets and content schema', async () => {
  const { root } = await setup({
    taskSessions: ['session-dev'],
    targets: [
      { target: 'qa.verify', label: '验证', content: { type: 'object', required: ['focus'] } },
      { target: 'end', label: '结束任务' },
    ],
  })
  try {
    const agent = { id: 'session-dev', ctx: root }
    await root.serial('agent/created', { agent })
    const tools = root.get('tools').schemas(agent)
    const create = tools.find((tool) => tool.name === 'workflow_task_create')
    assert.ok(create, 'the scoped create tool is visible')
    assert.match(create.description, /Targets this task can create:/u)
    assert.match(create.description, /qa\.verify \(验证\) — content schema: \{"type":"object"/u)
    assert.match(create.description, /end \(结束任务\) — no content schema/u)
    assert.equal(
      tools.some((tool) => tool.name === 'buka_task_targets'),
      false,
      'the targets tool is gone',
    )
  } finally {
    await root.fiber.dispose()
  }
})

test('task tools: the scoped description lists the actions of a human task', async () => {
  const { root } = await setup({
    taskSessions: ['session-approve'],
    actions: [
      { id: 'approve', label: '批准', input: { type: 'object', required: ['note'] } },
      { id: 'reject', label: '打回' },
    ],
  })
  try {
    const agent = { id: 'session-approve', ctx: root }
    await root.serial('agent/created', { agent })
    const complete = root
      .get('tools')
      .schemas(agent)
      .find((tool) => tool.name === 'workflow_task_complete')
    assert.ok(complete, 'the scoped complete tool is visible')
    assert.match(complete.description, /approve \(批准\) — input schema: \{"type":"object"/u)
    assert.match(complete.description, /reject \(打回\) — no input form/u)
    assert.equal(
      root
        .get('tools')
        .schemas(agent)
        .some((tool) => tool.name === 'buka_task_actions'),
      false,
      'the actions tool is gone',
    )
  } finally {
    await root.fiber.dispose()
  }
})

test('task tools: the scoped registration shadows the global tool only for that agent', async () => {
  const { root } = await setup({ taskSessions: ['session-dev'], targets: [] })
  // 先注册通用版本，模拟插件对所有执行会话开放的全局工具。
  root.get('tools').register(
    defineTaskCreateTool(async () => makeEngine()),
    undefined,
  )
  try {
    const agent = { id: 'session-dev', ctx: root }
    const other = { id: 'session-other', ctx: root }
    await root.serial('agent/created', { agent })
    await root.serial('agent/created', { agent: other })

    const scoped = root
      .get('tools')
      .schemas(agent)
      .find((tool) => tool.name === 'workflow_task_create')
    const generic = root
      .get('tools')
      .schemas(other)
      .find((tool) => tool.name === 'workflow_task_create')
    assert.match(scoped.description, /cannot create follow-up tasks/u)
    assert.match(generic.description, /In a task session this description lists/u)
    assert.equal(
      root
        .get('tools')
        .schemas(other)
        .some((tool) => tool.name === 'buka_task_targets'),
      false,
    )
  } finally {
    await root.fiber.dispose()
  }
})

test('task tools: a session that is not executing a task gets no scoped tools', async () => {
  const { root } = await setup({ taskSessions: [] })
  root.get('tools').register(
    defineTaskCompleteTool(async () => makeEngine()),
    undefined,
  )
  try {
    const agent = { id: 'session-untasked', ctx: root }
    await root.serial('agent/created', { agent })
    const complete = root
      .get('tools')
      .schemas(agent)
      .find((tool) => tool.name === 'workflow_task_complete')
    assert.match(complete.description, /a task session lists the available actions/u)
  } finally {
    await root.fiber.dispose()
  }
})

test('task tools: disposing the session removes the scoped registration', async () => {
  const { root } = await setup({ taskSessions: ['session-dev'], targets: [] })
  root.get('tools').register(
    defineTaskCreateTool(async () => makeEngine()),
    undefined,
  )
  const agent = { id: 'session-dev', ctx: root }
  await root.serial('agent/created', { agent })
  assert.match(
    root
      .get('tools')
      .schemas(agent)
      .find((tool) => tool.name === 'workflow_task_create').description,
    /cannot create follow-up tasks/u,
  )
  await root.serial('agent/disposed', { agent })
  await waitFor(() =>
    /In a task session this description lists/u.test(
      root
        .get('tools')
        .schemas(agent)
        .find((tool) => tool.name === 'workflow_task_create').description,
    ),
  )
  await root.fiber.dispose()
})

test('task tools: description builders keep the required information', () => {
  assert.match(taskCreateDescription([]), /cannot create follow-up tasks/u)
  assert.match(
    taskCreateDescription([{ target: 'dev.rework', label: '返工', content: { type: 'object' } }]),
    /dev\.rework \(返工\) — content schema: \{"type":"object"\}/u,
  )
  assert.equal(taskCompleteDescription([]).includes('actions'), false)
  assert.match(
    taskCompleteDescription([{ id: 'pass', label: '通过' }]),
    /pass \(通过\) — no input form/u,
  )
})
