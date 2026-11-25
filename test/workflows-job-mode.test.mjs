/**
 * workflows 作业模式单测：`/job` 只在会话开始时进入、一个会话只启动一个作业、
 * 工作流由 agent 用 `workflow_job_options` 查看并选择。
 *
 * 用假会话日志直接驱动折叠函数；命令与提示词段落用真实的 Cordis
 * `commands` / `systemPrompt` 注册面，工具可见性用真实的 `tools` 服务钉住。
 * 运行：
 *
 *   node --test test/workflows-job-mode.test.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import CommandsService from '@deepseek-ai/dsh-commands'
import ToolsService from '@deepseek-ai/dsh-tools'

import { registerJobCommand, runJobCommand } from '../plugins/workflows/src/commands/job.ts'
import {
  inJobMode,
  installJobMode,
  jobModeSectionText,
  readJobMode,
  selectedJobMode,
} from '../plugins/workflows/src/job-mode.ts'
import { registerWorkflowTools } from '../plugins/workflows/src/tools/index.ts'

// ---------------------------------------------------------------------------
// 假会话与假引擎
// ---------------------------------------------------------------------------

/** 一个能按 `eventAt` 回放的会话日志。 */
function makeSession() {
  const events = []
  return {
    events,
    get seq() {
      return events.length
    },
    eventAt(seq) {
      return events[seq]
    },
    append(type, data) {
      events.push({ type, data })
    },
  }
}

/** 一条 `/job` 命令的完整 run / done 记录。 */
function appendCommand(session, { commandId = 'c1', args = '', kind = 'success' } = {}) {
  session.append('command/run', { commandId, name: 'job', args, source: { kind: 'user' } })
  session.append('command/done', { commandId, kind, text: '', source: { kind: 'user' } })
}

/** 一次 `workflow_job_start` 的工具调用记录。 */
function appendStartCall(session, { callId = 't1', error = undefined } = {}) {
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'workflow_job_start',
    arguments: '{}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: { toolCallId: callId, content: [] },
    ...(error === undefined ? {} : { error: { name: 'Error', code: 'x' } }),
  })
}

/** 一个只够命令与可见性用的假引擎。 */
function makeEngine({
  jobId = null,
  workflows = [{ id: 'release-notes', name: '发布说明', status: 'active' }],
  targets = [],
  failList = null,
} = {}) {
  return {
    jobIdForSession: () => jobId,
    listWorkflowSummaries: async () => {
      if (failList !== null) throw failList
      return workflows
    },
    jobModeTargets: async () => targets,
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

// ---------------------------------------------------------------------------
// 日志折叠
// ---------------------------------------------------------------------------

test('作业模式：初始为空闲且会话是新的', () => {
  assert.deepEqual(readJobMode(makeSession()), {
    entered: false,
    consumed: false,
    fresh: true,
  })
})

test('作业模式：成功的 /job 进入，/job off 退出', () => {
  const session = makeSession()
  appendCommand(session)
  assert.equal(readJobMode(session).entered, true)

  appendCommand(session, { commandId: 'c2', args: ' off' })
  assert.equal(readJobMode(session).entered, false)
})

test('作业模式：不带参数的 /job 也进入模式', () => {
  const session = makeSession()
  appendCommand(session, { args: '' })
  assert.equal(readJobMode(session).entered, true)
})

test('作业模式：正在执行的 /job 只影响「选中」一档，结算失败后回退', () => {
  const session = makeSession()
  session.append('command/run', { commandId: 'c1', name: 'job', args: '' })
  // 命令处理器自己读已结算状态：此时还是「没进入」。
  assert.equal(readJobMode(session).entered, false)
  // 提示词与工具读选中状态：steer 出来的下一步已经能看到模式。
  assert.equal(selectedJobMode(session).entered, true)
  assert.equal(inJobMode({ session }), true)

  session.append('command/done', { commandId: 'c1', kind: 'error' })
  assert.equal(selectedJobMode(session).entered, false)
  assert.equal(inJobMode({ session }), false)
})

test('作业模式：失败的 /job 不改变状态', () => {
  const session = makeSession()
  appendCommand(session, { kind: 'error' })
  assert.equal(readJobMode(session).entered, false)
})

test('作业模式：用户消息之后会话不再「新」，模式仍然有效', () => {
  const session = makeSession()
  appendCommand(session)
  session.append('user/message', { message: { role: 'user', content: [] } })
  const state = readJobMode(session)
  assert.equal(state.fresh, false)
  assert.equal(state.entered, true)
})

test('作业模式：成功的 workflow_job_start 消耗模式', () => {
  const session = makeSession()
  appendCommand(session)
  appendStartCall(session)
  const state = readJobMode(session)
  assert.equal(state.consumed, true)
  assert.equal(inJobMode({ session }), false)
})

test('作业模式：失败或未结算的 workflow_job_start 不消耗模式', () => {
  const session = makeSession()
  appendCommand(session)
  appendStartCall(session, { error: { name: 'Error', code: 'invalid-input' } })
  assert.equal(readJobMode(session).consumed, false)
  assert.equal(inJobMode({ session }), true)

  appendStartCall(session, { callId: 't2' })
  assert.equal(readJobMode(session).consumed, true)
})

test('作业模式：普通会话不进入模式，作业工具不可见', () => {
  const session = makeSession()
  session.append('user/message', { message: { role: 'user', content: [] } })
  assert.equal(inJobMode({ session }), false)
})

// ---------------------------------------------------------------------------
// 提示词段落
// ---------------------------------------------------------------------------

test('作业模式段落：让 agent 列工作流、按描述挑选、不确定时问用户', () => {
  const text = jobModeSectionText()
  assert.match(text, /你处于作业模式/)
  assert.match(text, /workflow_job_options/)
  assert.match(text, /先问用户/)
  assert.match(text, /workflow_job_start/)
  assert.match(text, /\/job off/)
})

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

test('命令：新会话的 /job 进入模式，不要求 workflow id', async () => {
  const session = makeSession()
  const result = await runJobCommand({
    engine: makeEngine(),
    agent: { id: 'session-1', session },
    sessionId: 'session-1',
    rawInput: '',
  })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /已进入作业模式/)
  assert.match(result.text, /说说你想做什么/)
})

test('命令：附带说明会作为第一条用户消息投递', async () => {
  const session = makeSession()
  let steered = null
  const result = await runJobCommand({
    engine: makeEngine(),
    agent: {
      id: 'session-1',
      session,
      steer(message) {
        steered = message
      },
    },
    sessionId: 'session-1',
    rawInput: ' 帮我发 1.2.3',
  })
  assert.equal(result.kind, 'success')
  assert.equal(steered?.content?.[0]?.text, '帮我发 1.2.3')
})

test('命令：会话已有内容时拒绝进入模式', async () => {
  const session = makeSession()
  session.append('user/message', { message: { role: 'user', content: [] } })
  const result = await runJobCommand({
    engine: makeEngine(),
    agent: { id: 'session-1', session },
    sessionId: 'session-1',
    rawInput: '',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /会话开始时进入/)
})

test('命令：已经在模式里时再执行 /job 仍然可以补充说明', async () => {
  const session = makeSession()
  appendCommand(session)
  session.append('user/message', { message: { role: 'user', content: [] } })
  let steered = null
  const result = await runJobCommand({
    engine: makeEngine(),
    agent: {
      id: 'session-1',
      session,
      steer(message) {
        steered = message
      },
    },
    sessionId: 'session-1',
    rawInput: '再加一个附件',
  })
  assert.equal(result.kind, 'success')
  assert.equal(steered?.content?.[0]?.text, '再加一个附件')
})

test('命令：/job off 退出', async () => {
  const session = makeSession()
  appendCommand(session)
  const result = await runJobCommand({
    engine: makeEngine(),
    agent: { id: 'session-1', session },
    sessionId: 'session-1',
    rawInput: ' off',
  })
  assert.equal(result.kind, 'success')
  assert.equal(result.text, '已退出作业模式。')
})

test('命令：已经启动过作业的会话不能再进入', async () => {
  const result = await runJobCommand({
    engine: makeEngine({ jobId: 'job-1' }),
    agent: { id: 'session-1', session: makeSession() },
    sessionId: 'session-1',
    rawInput: '',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /已经启动过作业/)
})

test('命令：已经启动过作业时 /job off 只说明模式已结束', async () => {
  const result = await runJobCommand({
    engine: makeEngine({ jobId: 'job-1' }),
    agent: { id: 'session-1', session: makeSession() },
    sessionId: 'session-1',
    rawInput: ' off',
  })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /作业模式已结束/)
})

test('命令：没有已启用的工作流时拒绝进入', async () => {
  const result = await runJobCommand({
    engine: makeEngine({
      workflows: [{ id: 'old', name: '旧流程', status: 'retired' }],
    }),
    agent: { id: 'session-1', session: makeSession() },
    sessionId: 'session-1',
    rawInput: '',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /没有可用的工作流/)
})

// ---------------------------------------------------------------------------
// 真实注册面
// ---------------------------------------------------------------------------

test('命令注册：/job 经宿主 commands 服务执行并留下进入记录', async () => {
  const root = new Context()
  try {
    await root.plugin(CommandsService)
    const session = makeSession()
    const agent = { id: 'session-1', session }
    const registered = registerJobCommand({
      ctx: root,
      ready: async () => makeEngine(),
    })
    assert.equal(registered, true)
    const commands = root.get('commands')
    const execution = await commands.execute(agent, '/job', [], new AbortController().signal)
    assert.equal(execution?.result?.kind, 'success')
    assert.equal(readJobMode(session).entered, true)
    assert.equal(session.events[0]?.type, 'command/run')
  } finally {
    await root.fiber.dispose()
  }
})

test('提示词段落：installJobMode 注册 workflow_job_policy 并按模式渲染', async () => {
  const root = new Context()
  try {
    const sections = []
    root.provide('systemPrompt', {
      section: (section) => {
        sections.push(section)
        return () => {}
      },
    })
    installJobMode({ ctx: root })
    await waitFor(() => sections.length === 1)
    assert.equal(sections[0].name, 'workflow_job_policy')
    assert.equal(sections[0].order, 520)
    assert.equal(sections[0].interpolate, false)

    const session = makeSession()
    const agent = { id: 'session-1', session }
    assert.equal(sections[0].text({ agent }), '')
    appendCommand(session)
    assert.match(sections[0].text({ agent }), /workflow_job_options/)

    appendStartCall(session)
    assert.equal(sections[0].text({ agent }), '')
  } finally {
    await root.fiber.dispose()
  }
})

test('作业工具：只有作业模式会话能看到列表与启动工具', async () => {
  const root = new Context()
  try {
    root.provide('systemPrompt', {
      tools: () => () => {},
      section: () => () => {},
    })
    await root.plugin(ToolsService)
    registerWorkflowTools({
      ctx: root,
      ready: async () => makeEngine(),
      options: { orchestratorPresets: [], orchestratorWorkspaces: [] },
      orchestratorVisible: () => false,
      executionVisible: () => false,
      starterVisible: () => false,
      assertOrchestrator: () => {},
    })
    const tools = root.get('tools')
    const session = makeSession()
    const agent = { id: 'session-1', session }
    const visible = async () => {
      const toolSet = await tools.resolve({
        agent,
        modelSelection: { provider: 'test', model: 'test' },
        signal: new AbortController().signal,
      })
      const names = tools.schemas(agent, toolSet).map((tool) => tool.name)
      return {
        list: names.includes('workflow_job_options'),
        start: names.includes('workflow_job_start'),
      }
    }

    assert.deepEqual(await visible(), { list: false, start: false }, '普通会话看不到作业工具')
    appendCommand(session)
    assert.deepEqual(await visible(), { list: true, start: true }, '进入作业模式后可见')
    appendStartCall(session)
    assert.deepEqual(await visible(), { list: false, start: false }, '启动成功后模式结束')
  } finally {
    await root.fiber.dispose()
  }
})
