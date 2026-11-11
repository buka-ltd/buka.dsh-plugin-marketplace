/**
 * @buka/dsh-plugin-robots 对外 Service 的纯函数单测。
 *
 * 不启动 DSH：只覆盖列表摘要与会话日志解析，startSession 的运行时行为由
 * 真实宿主验证。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { defaultAvatarFor } from '../plugins/robots/src/avatar.ts'
import { addRobot, resolveRobotRegistryFile } from '../plugins/robots/src/robot-store.ts'
import {
  mapTurnEnd,
  parseStructuredText,
  RobotSessionService,
  readSessionOutcome,
  resultFailureMessage,
  resultRetryPrompt,
  structuredSubmittedSince,
  summarizeRobot,
} from '../plugins/robots/src/service.ts'

test('robots service: summarizeRobot strips AGENTS.md bodies and keeps orchestration fields', () => {
  const summary = summarizeRobot({
    name: 'writer',
    path: '/tmp/writer',
    createdAt: '2026-01-01T00:00:00.000Z',
    exists: true,
    mounted: true,
    workspaceId: 'ws-1',
    description: '把会议记录整理成三点结论',
    skills: [{ name: 'convex', description: 'db', content: 'x' }],
    agents: { exists: true, bytes: 42, modifiedAt: '2026-01-02T00:00:00.000Z', content: '# big' },
    claude: { exists: true, symlink: true, mode: 'symlink', target: 'AGENTS.md' },
  })
  assert.equal(summary.name, 'writer')
  assert.equal(
    summary.avatar,
    defaultAvatarFor('writer'),
    'missing avatar falls back deterministically',
  )
  assert.equal(summary.mounted, true)
  assert.equal(summary.workspaceId, 'ws-1')
  assert.equal(summary.description, '把会议记录整理成三点结论')
  assert.deepEqual(summary.skills, [{ name: 'convex', description: 'db' }])
  assert.deepEqual(summary.agents, {
    exists: true,
    bytes: 42,
    modifiedAt: '2026-01-02T00:00:00.000Z',
  })
  assert.equal('content' in summary.agents, false)
})

test('robots service: readSessionOutcome returns the last assistant text and turn reason', () => {
  const session = {
    ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'assistant/message',
        data: {
          message: {
            content: [
              { type: 'text', text: 'first' },
              { type: 'reasoning', text: 'hidden' },
            ],
          },
        },
      },
      {
        type: 'assistant/message',
        data: {
          message: {
            content: [
              { type: 'text', text: 'final' },
              { type: 'text', text: 'line two' },
            ],
          },
        },
      },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ],
  }
  assert.deepEqual(readSessionOutcome(session), {
    text: 'final\nline two',
    stopReason: 'completed',
  })
  assert.deepEqual(readSessionOutcome({ ownEvents: () => [] }), {
    text: '',
    stopReason: 'completed',
  })

  // 续接时只读 startSeq 之后的事件，不会把上一轮的文本当成本轮结果。
  const continued = {
    ownEvents: () => [
      {
        type: 'assistant/message',
        seq: 1,
        data: { message: { content: [{ type: 'text', text: 'old' }] } },
      },
      { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } },
      {
        type: 'assistant/message',
        seq: 3,
        data: { message: { content: [{ type: 'text', text: 'new' }] } },
      },
      { type: 'turn/end', seq: 4, data: { reason: { kind: 'completed' } } },
    ],
  }
  assert.deepEqual(readSessionOutcome(continued, 3), { text: 'new', stopReason: 'completed' })
})

test('robots service: mapTurnEnd normalizes turn end reasons', () => {
  assert.equal(mapTurnEnd({ kind: 'completed' }), 'completed')
  assert.equal(mapTurnEnd({ kind: 'aborted' }), 'aborted')
  assert.equal(mapTurnEnd({ kind: 'max-tokens' }), 'max-tokens')
  assert.equal(mapTurnEnd({ kind: 'error' }), 'error')
  assert.equal(mapTurnEnd(undefined), 'completed')
})

/**
 * 建一个临时机器人目录与登记表。
 *
 * @returns {Promise<{ robotsDir: string, registryFile: string }>}
 */
async function makeRobotHome() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-robots-service-'))
  const robotsDir = path.join(root, 'robots')
  const registryFile = resolveRobotRegistryFile(robotsDir)
  await addRobot({ robotsDir, file: registryFile, name: 'writer' })
  return { root, robotsDir, registryFile }
}

/**
 * 假的插件上下文：记录 agent 创建参数、注册的 scoped 工具与取消状态。
 *
 * @returns {{ ctx: Record<string, any>, state: Record<string, any> }}
 */
function makeFakeContext({
  subagents,
  resumeError,
  resumeOrigin,
  compactionError,
  noCompaction,
  noAgentCreate,
  sessionTitle,
  sessionListError,
  noSessionController,
  noEmit,
} = {}) {
  const state = {
    createOptions: null,
    // 记录 dispatch / resume 期间的调用顺序：`planMode` 必须早于 `followup`。
    trace: [],
    // DSH 的 session-title 服务替身：记录显式命名调用；已有标题时不覆盖。
    sessionTitle: sessionTitle ?? null,
    sessionTitles: [],
    registered: [],
    sections: [],
    approvalPolicies: [],
    disposed: false,
    cancelled: false,
    finishIdle: null,
    followups: [],
    liveAgents: new Map(),
    resumeOptions: null,
    resumeDisposed: false,
    resumedRegistered: [],
    resumedSections: [],
    resumedFollowups: [],
    resumedEvents: [],
    resumedHandlers: [],
    resumedFinishIdle: null,
    mountedPreset: null,
    compacted: false,
    compactionAgent: null,
    mountedPresets: [],
    attachedSessions: [],
    // 宿主会话列表的替身：create/resume 时登记一条 summary，list() 返回冷会话版本。
    summaries: [],
    sessionListCalls: 0,
    emitted: [],
    warnings: [],
  }
  const agentsService = {
    async create(options) {
      if (noAgentCreate === true) throw new Error('normal robot sessions are unavailable')
      state.createOptions = options
      state.summaries.push({
        sessionId: options.sessionId,
        cwd: typeof options.meta?.cwd === 'string' ? options.meta.cwd : '',
        agentAvailable: true,
        running: true,
        blank: false,
        updatedAt: 1,
      })
      let resolveIdle
      const idle = new Promise((resolve) => {
        resolveIdle = resolve
      })
      state.finishIdle = resolveIdle
      const agent = {
        id: options.sessionId,
        session: sessionWithText('robot finished'),
        followup(message) {
          state.followups.push(message)
          state.trace.push('followup')
        },
        whenIdle: () => idle,
        cancel() {
          state.cancelled = true
          resolveIdle()
        },
      }
      const childCtx = {
        get(name) {
          if (name === 'agentPresets') {
            return {
              defaultId: 'standard',
              presetForSession: () => null,
              mount: async (_ctx, preset) => {
                state.mountedPresets.push(preset)
              },
              composeFrom() {},
            }
          }
          if (name === 'tools') return { register: (tool) => state.registered.push(tool) }
          if (name === 'systemPrompt') {
            return {
              getSectionOrder: () => 9900,
              section: (section) => state.sections.push(section),
            }
          }
          return undefined
        },
        tools: { register: (tool) => state.registered.push(tool) },
      }
      options.setup?.(childCtx, agent)
      return {
        agent,
        dispose: async () => {
          state.disposed = true
        },
      }
    },
    get(id) {
      return state.liveAgents.get(id)
    },
    async resume(options) {
      state.resumeOptions = options
      if (resumeError !== undefined) throw resumeError
      state.summaries.push({
        sessionId: options.resumeSessionId,
        cwd: '',
        agentAvailable: true,
        running: true,
        blank: false,
        updatedAt: 1,
      })
      let resolveIdle
      const idle = new Promise((resolve) => {
        resolveIdle = resolve
      })
      state.resumedFinishIdle = resolveIdle
      const session = {
        seq: 0,
        header: resumeOrigin === undefined ? {} : { origin: resumeOrigin },
        ownEvents: () => state.resumedEvents,
      }
      const agent = {
        id: options.resumeSessionId,
        session,
        ctx: {
          on(_name, handler) {
            state.resumedHandlers.push(handler)
            return () => {}
          },
        },
        followup(message) {
          state.resumedFollowups.push(message)
          state.trace.push('followup')
          // 模拟一轮：用户消息 → assistant 文本 → turn/end。
          session.seq += 1
          state.resumedEvents.push({ type: 'user/message', seq: session.seq, data: {} })
          session.seq += 1
          state.resumedEvents.push({
            type: 'assistant/message',
            seq: session.seq,
            data: { message: { content: [{ type: 'text', text: '{"passed":true}' }] } },
          })
          session.seq += 1
          const event = {
            type: 'turn/end',
            seq: session.seq,
            data: { reason: { kind: 'completed' } },
          }
          state.resumedEvents.push(event)
          for (const handler of state.resumedHandlers) handler(session, event)
          resolveIdle()
        },
        whenIdle: () => idle,
        cancel() {
          state.cancelled = true
          resolveIdle()
        },
      }
      const childCtx = {
        get(name) {
          if (name === 'agentPresets') {
            return {
              presetForSession: () => 'standard',
              mount: async (_ctx, preset) => {
                state.mountedPreset = preset
              },
              composeFrom() {},
            }
          }
          if (name === 'tools') {
            return { register: (tool) => state.resumedRegistered.push(tool) }
          }
          if (name === 'systemPrompt') {
            return {
              getSectionOrder: () => 9900,
              section: (section) => state.resumedSections.push(section),
            }
          }
          return undefined
        },
        tools: { register: (tool) => state.resumedRegistered.push(tool) },
      }
      await options.setup?.(childCtx, agent)
      return {
        agent,
        dispose: async () => {
          state.resumeDisposed = true
        },
      }
    },
  }
  const ctx = {
    workspaceRegistry: {
      list: () => [],
      async resolveByPath(target) {
        return {
          path: target,
          async attachSession(sessionId) {
            state.attachedSessions.push({ sessionId, path: target })
          },
        }
      },
    },
    agents: agentsService,
    logger: { warn: (message) => state.warnings.push(String(message)) },
    ...(noEmit === true
      ? {}
      : {
          emit(event, ...args) {
            state.emitted.push([event, ...args])
          },
        }),
    get(name) {
      if (name === 'subagents') return subagents
      if (name === 'agents') return agentsService
      if (name === 'sessionController') {
        if (noSessionController === true) return undefined
        return {
          async list() {
            state.sessionListCalls += 1
            if (sessionListError !== undefined) throw sessionListError
            // 释放 agent 之后宿主读到的就是冷会话 summary。
            return {
              items: state.summaries.map((summary) => ({
                ...summary,
                agentAvailable: false,
                running: false,
              })),
            }
          },
        }
      }
      if (name === 'sessionTitle') {
        return {
          get: () => state.sessionTitle ?? undefined,
          rename(session, title) {
            state.sessionTitles.push({ session, title })
            state.sessionTitle = { title, source: { kind: 'user' } }
            return state.sessionTitle
          },
        }
      }
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
      }
      if (name === 'approval') {
        return {
          setPolicy(agent, policy) {
            state.approvalPolicies.push({ agent, policy })
          },
        }
      }
      if (name === 'compaction') {
        if (noCompaction === true) return undefined
        return {
          async compactNow(agent) {
            if (compactionError !== undefined) throw compactionError
            state.compacted = true
            state.compactionAgent = agent.id
            return { compactionId: 'cmp-1' }
          },
        }
      }
      return undefined
    },
  }
  return { ctx, state }
}

/**
 * @param {string} text
 * @returns {{ ownEvents: () => Array<Record<string, any>> }}
 */
function sessionWithText(text) {
  return {
    ownEvents: () => [
      {
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text }] } },
      },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ],
  }
}

test('robots service: list returns summarized registry robots', async () => {
  const home = await makeRobotHome()
  try {
    const service = new RobotSessionService({
      ctx: { workspaceRegistry: { list: () => [] } },
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const listed = await service.list()
    assert.equal(listed.corrupt, false)
    assert.equal(listed.robots.length, 1)
    assert.equal(listed.robots[0].name, 'writer')
    assert.equal(listed.robots[0].description, '')
    assert.ok(typeof listed.robots[0].avatar === 'string' && listed.robots[0].avatar !== '')
    assert.equal(listed.robots[0].agents.exists, true)
    assert.equal('content' in listed.robots[0].agents, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: avatarMap is a lightweight name -> avatar lookup', async () => {
  const home = await makeRobotHome()
  try {
    const service = new RobotSessionService({
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    // 新建的机器人一定有头像。
    const first = await service.avatarMap()
    assert.deepEqual(Object.keys(first), ['writer'])
    assert.ok(typeof first.writer === 'string' && first.writer !== '')

    // 旧登记表里缺 avatar 的那条按名字兜底；显式设置过的用设置值。
    await fs.writeFile(
      home.registryFile,
      JSON.stringify({
        version: 1,
        robots: [
          {
            name: 'writer',
            path: path.join(home.robotsDir, 'writer'),
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'panda',
          },
          {
            name: 'legacy',
            path: path.join(home.robotsDir, 'legacy'),
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    )
    assert.deepEqual(await service.avatarMap(), {
      writer: 'panda',
      legacy: defaultAvatarFor('legacy'),
    })

    // 登记表损坏：返回空表，不抛错。
    await fs.writeFile(home.registryFile, '{broken')
    assert.deepEqual(await service.avatarMap(), {})
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: startSession creates a robot-cwd session, records structured output and disposes', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
      defineTool: (definition) => definition,
    })
    const outputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string' },
        next: { type: 'string', enum: ['done', 'retry'] },
      },
      required: ['status', 'next'],
    }
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do the work',
      outputSchema,
      timeoutMs: 5000,
    })
    assert.equal(session.robot, 'writer')
    assert.equal(
      state.createOptions.meta.cwd,
      await fs.realpath(path.join(home.robotsDir, 'writer')),
    )
    assert.equal(state.createOptions.agentOptions.provider, 'test-provider')
    assert.equal(state.createOptions.agentOptions.model, 'test-model')
    assert.deepEqual(state.mountedPresets, ['standard'])
    assert.equal(state.attachedSessions.length, 1)
    assert.equal(state.attachedSessions[0].sessionId, session.id)
    // 每个机器人会话都装 scoped structured_output，parameters 就是 outputSchema。
    assert.equal(state.registered.length, 1)
    assert.equal(state.registered[0].name, 'structured_output')
    assert.deepEqual(state.registered[0].parameters, outputSchema)
    // 只有结构化输出契约这一段 systemPrompt，没有额外的行为段。
    assert.deepEqual(
      state.sections.map((section) => section.name),
      ['tool:structured_output'],
    )
    assert.match(state.sections[0].text, /next/)
    assert.doesNotMatch(state.sections[0].text, /approval|ask when blocked/i)
    // 审批默认按部署策略：省略 approval 时不强制拒绝。
    assert.deepEqual(state.approvalPolicies, [])

    await state.registered[0].execute({ status: 'ok', next: 'done' })
    state.finishIdle()

    const result = await session.result
    assert.equal(result.text, 'robot finished')
    assert.deepEqual(result.structured, { status: 'ok', next: 'done' })
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.resultRetries, 0)
    assert.equal(state.disposed, true)
    // 释放 agent 后会话仍然持久化：补通告一次冷会话，客户端不会把它从列表里删掉。
    assert.equal(state.sessionListCalls, 1)
    const announced = state.emitted.filter(([event]) => event === 'api-session/added')
    assert.equal(announced.length, 1)
    assert.equal(announced[0][1].sessionId, session.id)
    assert.equal(announced[0][1].agentAvailable, false)
    assert.equal(announced[0][1].running, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: abortable adds the abort escape to the structured output contract', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do the work',
      abortable: true,
      timeoutMs: 5000,
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { abort: { type: 'string' } },
      },
    })
    assert.match(state.registered[0].description, /abort/u)
    assert.match(state.sections[0].text, /abort/u)
    await state.registered[0].execute({ abort: '缺少工作区权限' })
    state.finishIdle()
    const result = await session.result
    assert.deepEqual(result.structured, { abort: '缺少工作区权限' })
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: the structured tool falls back to a generic object schema', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do it',
      timeoutMs: 5000,
    })
    assert.deepEqual(state.registered[0].parameters, { type: 'object', additionalProperties: true })

    state.finishIdle()
    const result = await session.result
    // 没有交回 JSON：同一会话里重试到上限后以 error 结束。
    assert.equal(result.structured, undefined)
    assert.equal(result.stopReason, 'error')
    assert.equal(result.resultRetries, 2)
    assert.match(result.error, /did not submit a structured JSON result/)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a new robot session is titled from the request', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'write the release notes',
      title: '为 v1.2 写发布说明 · writer',
      timeoutMs: 5000,
    })
    assert.equal(state.sessionTitles.length, 1, 'the new session is named once')
    assert.equal(state.sessionTitles[0].title, '为 v1.2 写发布说明 · writer')
    assert.equal(state.sessionTitle.title, '为 v1.2 写发布说明 · writer')
    await session.result
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a resumed session only gets a title when it has none', async () => {
  const home = await makeRobotHome()
  try {
    // 已有标题（例如用户手动改过）：续接时不再覆盖。
    const existing = makeFakeContext({ sessionTitle: { title: '用户改过的标题' } })
    const service = new RobotSessionService({
      ctx: existing.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const kept = await service.startSession({
      robot: 'writer',
      prompt: 'continue',
      title: '为 v1.2 写发布说明 · writer',
      sessionId: 'child-titled',
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    await kept.result
    assert.equal(existing.state.sessionTitles.length, 0, 'an existing title is preserved')
    assert.equal(existing.state.sessionTitle.title, '用户改过的标题')

    // 早期版本建的会话没有标题：续接时补上，侧边栏不再显示「未命名」。
    const untitled = makeFakeContext()
    const second = new RobotSessionService({
      ctx: untitled.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const named = await second.startSession({
      robot: 'writer',
      prompt: 'continue',
      title: '为 v1.2 写发布说明 · writer',
      sessionId: 'child-untitled',
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    await named.result
    assert.equal(untitled.state.sessionTitles.length, 1, 'an untitled session is named on entry')
    assert.equal(untitled.state.sessionTitles[0].title, '为 v1.2 写发布说明 · writer')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: startSession timeout cancels the agent and reports timeout', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do the work',
      timeoutMs: 10,
    })
    const result = await session.result
    assert.equal(result.stopReason, 'timeout')
    assert.equal(state.cancelled, true)
    assert.equal(state.disposed, true)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: unknown robot is rejected before creating an agent', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.startSession({ robot: 'nobody', prompt: 'x' }),
      /unknown robot/,
    )
    assert.equal(state.createOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a repeated entry compacts the same session and sends the new prompt', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'fix the test failure',
      sessionId: 'child-existing',
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    assert.equal(session.id, 'child-existing')
    assert.equal(session.resumed, true)
    assert.equal(state.resumeOptions.resumeSessionId, 'child-existing')
    // 续接出来的会话是运行时根：不能把编排器 agent 当 parentAgent 传进去。
    assert.equal('parentAgent' in state.resumeOptions, false)
    assert.equal(state.mountedPreset, 'standard')
    // 省略 approval 时保留部署策略，不强制 never。
    assert.deepEqual(state.approvalPolicies, [])

    const result = await session.result
    assert.equal(state.compacted, true)
    assert.equal(state.compactionAgent, 'child-existing')
    assert.equal(state.resumeDisposed, true)
    assert.equal(state.resumedFollowups.length, 1)
    assert.equal(state.resumedFollowups[0].content[0].text, 'fix the test failure')
    assert.equal(result.sessionId, 'child-existing')
    assert.equal(result.resumed, true)
    assert.equal(result.compacted, true)
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.resultRetries, 0)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: compaction failure does not lose the continued turn', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext({
      compactionError: new Error('summary model unavailable'),
    })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'continue anyway',
      sessionId: 'child-compaction-failed',
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    const result = await session.result
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.compacted, false)
    assert.match(result.compactionError, /summary model unavailable/)
    assert.equal(state.resumedFollowups.length, 1)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a continued session gets its structured tool back', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const outputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        passed: { type: 'boolean' },
        next: { type: 'string', enum: ['done'] },
      },
      required: ['passed', 'next'],
    }
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'check again',
      sessionId: 'child-report',
      outputSchema,
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    assert.equal(session.resumed, true)
    assert.equal(state.resumedRegistered.length, 1)
    assert.equal(state.resumedRegistered[0].name, 'structured_output')
    assert.deepEqual(state.resumedRegistered[0].parameters, outputSchema)
    assert.equal(state.resumedSections.length, 1)
    assert.equal(state.resumedSections[0].name, 'tool:structured_output')
    assert.match(state.resumedSections[0].text, /structured_output/)
    assert.match(state.resumedSections[0].text, /next/)

    const result = await session.result
    assert.equal(result.resumed, true)
    // 续接会话的 fake 回复是 JSON 文本，没调用工具也应被解析成 structured。
    assert.deepEqual(result.structured, { passed: true })
    assert.equal(result.resultRetries, 0)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a missing compaction service is reported, not hidden', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx } = makeFakeContext({ noCompaction: true })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'continue without compaction',
      sessionId: 'child-no-compaction',
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    const result = await session.result
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.compacted, false)
    assert.match(result.compactionError, /compaction service is unavailable/)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: an unresumable session rejects without opening a new session', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext({ resumeError: new Error('session is missing') })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      service.startSession({
        robot: 'writer',
        prompt: 'do it',
        sessionId: 'child-gone',
        timeoutMs: 5000,
      }),
      /could not resume robot session "child-gone".*session is missing.*refusing to start a new robot session/s,
    )
    assert.equal(state.createOptions, null, 'no replacement session is created')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a caller agent gets a visible normal session in the robot workspace', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do it',
      agent: { id: 'root' },
      agentPreset: 'standard',
    })
    assert.equal(session.visible, true)
    assert.equal(session.resumed, false)
    assert.deepEqual(state.mountedPresets, ['standard'])
    assert.equal(state.attachedSessions.length, 1)
    assert.equal(state.attachedSessions[0].sessionId, session.id)
    state.finishIdle()
    const result = await session.result
    assert.equal(result.text, 'robot finished')
    assert.equal(result.resumed, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a failed normal session creation is surfaced, never replaced by a subagent', async () => {
  const home = await makeRobotHome()
  try {
    let activated = false
    const subagents = {
      list: () => ['spawn'],
      interrupt() {},
      async startActivation() {
        activated = true
        throw new Error('the subagent backend must not be used')
      },
    }
    const { ctx, state } = makeFakeContext({ subagents, noAgentCreate: true })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      service.startSession({
        robot: 'writer',
        prompt: 'do it',
        agent: { id: 'root' },
      }),
      /could not create a visible robot session.*normal robot sessions are unavailable.*refusing to fall back/s,
    )
    assert.equal(activated, false, 'no subagent fallback is attempted')
    assert.equal(state.createOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: resuming a hidden subagent session rejects without a replacement', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext({ resumeOrigin: 'subagent' })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      service.startSession({
        robot: 'writer',
        prompt: 'do it',
        sessionId: 'hidden-child',
      }),
      /hidden subagent robot session.*refusing to start a new robot session/s,
    )
    assert.equal(state.resumeDisposed, true, 'the hidden handle is released')
    assert.equal(state.createOptions, null, 'no replacement session is created')

    await assert.rejects(
      service.openSession({ robot: 'writer', sessionId: 'hidden-child' }),
      /hidden subagent robot session/,
    )
    assert.equal(state.resumeDisposed, true)
    assert.equal(state.createOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a visible normal session is asked again for its JSON', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
      resultRetries: 2,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do the work',
      timeoutMs: 5000,
    })
    state.finishIdle()
    const result = await session.result
    // 第一条是初始任务，后面两条是「没交回 JSON」后的重试消息。
    assert.equal(state.followups.length, 3)
    assert.match(state.followups[1].content[0].text, /structured_output/)
    assert.match(state.followups[2].content[0].text, /retry 2\/2/)
    assert.equal(result.stopReason, 'error')
    assert.equal(result.resultRetries, 2)
    assert.match(result.error, /did not submit a structured JSON result/)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: retry helpers parse JSON replies and detect submitted structured results', () => {
  assert.match(resultRetryPrompt(1, 2, { toolName: 'structured_output' }), /retry 1\/2/)
  assert.match(resultRetryPrompt(1, 2, { toolName: 'structured_output' }), /structured_output/)
  assert.match(
    resultRetryPrompt(1, 2, { toolName: 'structured_output' }),
    /did not provide a structured JSON result/,
  )
  assert.equal(resultFailureMessage(0), 'the robot session did not submit a structured JSON result')

  // 问题类型与合法路由名都要写进重试提示。
  const missingNext = resultRetryPrompt(2, 3, { reason: 'missing-next', routes: ['done', 'retry'] })
  assert.match(missingNext, /did not include the required `next` route/)
  assert.match(missingNext, /"done"/)
  assert.match(missingNext, /"retry"/)
  assert.match(missingNext, /retry 2\/3/)
  const invalidNext = resultRetryPrompt(1, 2, { reason: 'invalid-next', routes: ['done'] })
  assert.match(invalidNext, /is not one of the routes this node can follow/)
  assert.match(invalidNext, /"done"/)
  const invalidOutput = resultRetryPrompt(1, 2, {
    reason: 'invalid-output',
    routes: ['done'],
    detail: 'status: missing required field',
  })
  assert.match(invalidOutput, /does not match the output schema declared for this node/)
  assert.match(invalidOutput, /Problem: status: missing required field\./)
  const ambiguous = resultRetryPrompt(1, 2, {
    reason: 'ambiguous-result',
    routes: ['done'],
    abortable: true,
  })
  assert.match(ambiguous, /included both `next` and `abort`/u)
  assert.match(ambiguous, /exactly one of `next`/u)
  assert.match(ambiguous, /set `abort` to a short non-empty reason/u)
  const invalidAbort = resultRetryPrompt(1, 2, { reason: 'invalid-abort', abortable: true })
  assert.match(invalidAbort, /`abort` field in your last JSON result must be a non-empty string/u)
  assert.match(invalidAbort, /set `abort` to a short non-empty reason/u)
  // 没有 abortable 时不能把 abort 作为出口塞给节点。
  assert.doesNotMatch(
    resultRetryPrompt(1, 2, { reason: 'missing-next', routes: ['done'] }),
    /`abort`/u,
  )
  // 没有路由时不要把 next 强塞给节点。
  assert.doesNotMatch(resultRetryPrompt(1, 2, {}), /`next`/)

  assert.deepEqual(parseStructuredText('{"ok":true}'), { ok: true })
  assert.deepEqual(parseStructuredText('```json\n{"ok":true}\n```'), { ok: true })
  assert.equal(parseStructuredText('plain text'), undefined)
  assert.equal(parseStructuredText('["not-an-object"]'), undefined)

  const session = {
    ownEvents: () => [
      { type: 'tool/call', seq: 1, data: { callId: 'c1', name: 'structured_output' } },
      { type: 'tool/result', seq: 2, data: { message: { toolCallId: 'c1', isError: false } } },
    ],
  }
  assert.equal(structuredSubmittedSince(session), true)
  assert.equal(structuredSubmittedSince(session, 3), false)
  assert.equal(structuredSubmittedSince({ ownEvents: () => [] }), false)
})

test('robots service: retryReport accepts routes/reason and is bounded', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const handle = await service.dispatchSession({
      robot: 'writer',
      prompt: 'do the work',
      routes: ['continue'],
      abortable: true,
    })
    const prompt = handle.retryReport({ routes: ['done', 'retry'], reason: 'missing-next' })
    assert.equal(typeof prompt, 'string')
    assert.match(prompt, /did not include the required `next` route/)
    assert.match(prompt, /"done"/)
    assert.match(prompt, /"retry"/)
    assert.match(prompt, /retry 1\/2/)
    assert.match(prompt, /exactly one of `next`/u)
    assert.match(prompt, /set `abort` to a short non-empty reason/u)
    // invalid-output 的 detail 要带进追问，routes 不传时用会话请求里的值兜底。
    const invalid = handle.retryReport({
      reason: 'invalid-output',
      detail: 'status: expected string, got integer',
    })
    assert.equal(typeof invalid, 'string')
    assert.match(invalid, /does not match the output schema declared for this node/)
    assert.match(invalid, /Problem: status: expected string, got integer\./)
    assert.match(invalid, /"continue"/)
    assert.equal(handle.retryReport(), null, 'retry quota is bounded')
    await handle.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: approval defaults to the deployment policy; never forces rejections', async () => {
  const home = await makeRobotHome()
  try {
    /** @param {ReturnType<typeof makeFakeContext>} fake */
    const makeService = (fake) =>
      new RobotSessionService({
        ctx: fake.ctx,
        robotsDir: home.robotsDir,
        registryFile: home.registryFile,
      })

    // 省略 approval：保持部署策略。
    const omitted = makeFakeContext()
    const omittedSession = await makeService(omitted).startSession({
      robot: 'writer',
      prompt: 'do it',
      timeoutMs: 5000,
    })
    assert.deepEqual(omitted.state.approvalPolicies, [])
    omitted.state.finishIdle()
    await omittedSession.result

    // 'ask' 是默认值，同样不动策略。
    const asked = makeFakeContext()
    const askedSession = await makeService(asked).startSession({
      robot: 'writer',
      prompt: 'do it',
      approval: 'ask',
      timeoutMs: 5000,
    })
    assert.deepEqual(asked.state.approvalPolicies, [])
    asked.state.finishIdle()
    await askedSession.result

    // 'never' 才强制拒绝需要审批的操作。
    const forced = makeFakeContext()
    const forcedSession = await makeService(forced).startSession({
      robot: 'writer',
      prompt: 'do it',
      approval: 'never',
      timeoutMs: 5000,
    })
    assert.equal(forced.state.approvalPolicies.length, 1)
    assert.equal(forced.state.approvalPolicies[0].policy, 'never')
    forced.state.finishIdle()
    await forcedSession.result

    // 续接出来的会话遵循同一规则。
    const resumed = makeFakeContext()
    const resumedSession = await makeService(resumed).startSession({
      robot: 'writer',
      prompt: 'do it',
      sessionId: 'child-approval',
      approval: 'never',
      timeoutMs: 5000,
    })
    assert.equal(resumed.state.approvalPolicies.length, 1)
    assert.equal(resumed.state.approvalPolicies[0].policy, 'never')
    await resumedSession.result
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

/**
 * dispatch / openSession 用的假 `commands` 服务：把 plan 模式当作真实的 `/plan`
 * 命令入口——记录调用，并在会话日志里写命令生命周期与 `plan/mode` 事件（真实
 * DSH 的 plan-mode 插件就是这样持久化状态的）。
 *
 * @returns {{ state: Record<string, any>, service: Record<string, any> }}
 */
function makePlanCommands({ available = true } = {}) {
  const state = { lines: [], agents: [] }
  const service = {
    async execute(agent, line) {
      if (!available) return undefined
      state.lines.push(line)
      state.agents.push(agent?.id)
      const commandId = `cmd-${state.lines.length}`
      const session = agent?.session
      session?.append?.('command/run', { commandId, name: 'plan' })
      session?.append?.('plan/mode', { active: line !== '/plan off' })
      session?.append?.('command/done', { commandId, kind: 'success' })
      return { commandId, result: { kind: 'success' } }
    },
  }
  return { state, service }
}

/**
 * dispatch / openSession 用的最小假上下文：visible 会话 + 可追加的会话事件。
 * 默认不提供根作用域的 `planMode` 服务，与 desktop/web 的组成一致。
 *
 * @returns {{ ctx: Record<string, any>, state: Record<string, any>, agent: Record<string, any> }}
 */
function makeDispatchContext({ sessionListError, noSessionController, noEmit, commands } = {}) {
  const events = []
  const state = {
    events,
    followups: [],
    // 记录 dispatch / resume 期间的调用顺序：plan 命令必须早于 followup。
    trace: [],
    disposed: false,
    createOptions: null,
    resumeOptions: null,
    summaries: [],
    sessionListCalls: 0,
    emitted: [],
    warnings: [],
  }
  const session = {
    get seq() {
      return events.length
    },
    append(type, data) {
      events.push({ type, seq: events.length, data })
    },
    snapshotEvents(from = 0) {
      return events.slice(from)
    },
    ownEvents() {
      return events.slice()
    },
  }
  const agent = {
    id: 'dispatch-session',
    session,
    followup(message) {
      state.followups.push(message)
      state.trace.push('followup')
      events.push({ type: 'user/message', seq: events.length, data: {} })
      events.push({
        type: 'assistant/message',
        seq: events.length,
        data: {
          message: { content: [{ type: 'text', text: `dispatch done ${state.followups.length}` }] },
        },
      })
      events.push({ type: 'turn/end', seq: events.length, data: { reason: { kind: 'completed' } } })
    },
    whenIdle: async () => {},
    cancel() {
      state.cancelled = true
    },
    ctx: {
      on() {
        return () => {}
      },
    },
  }
  const handle = {
    agent,
    dispose: async () => {
      state.disposed = true
    },
  }
  const childCtx = {
    get() {
      return undefined
    },
    tools: { register() {} },
  }
  const agents = {
    async create(options) {
      state.createOptions = options
      // 真实运行时 agent id 就等于请求的 sessionId（服务会传 newSessionId 或随机生成）。
      agent.id = options.sessionId
      state.summaries.push({
        sessionId: agent.id,
        cwd: typeof options.meta?.cwd === 'string' ? options.meta.cwd : '',
        agentAvailable: true,
        running: true,
        blank: false,
        updatedAt: 1,
      })
      await options.setup?.(childCtx, agent)
      return handle
    },
    async resume(options) {
      state.resumeOptions = options
      agent.id = options.resumeSessionId
      state.summaries.push({
        sessionId: agent.id,
        cwd: '',
        agentAvailable: true,
        running: true,
        blank: false,
        updatedAt: 1,
      })
      await options.setup?.(childCtx, agent)
      return handle
    },
    get(id) {
      return id === agent.id ? agent : undefined
    },
  }
  const ctx = {
    agents,
    logger: { warn: (message) => state.warnings.push(String(message)) },
    ...(noEmit === true
      ? {}
      : {
          emit(event, ...args) {
            state.emitted.push([event, ...args])
          },
        }),
    workspaceRegistry: {
      list: () => [],
      async resolveByPath(target) {
        return { path: target, async attachSession() {} }
      },
    },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'commands') return commands
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
      }
      if (name === 'sessionController') {
        if (noSessionController === true) return undefined
        return {
          async list() {
            state.sessionListCalls += 1
            if (sessionListError !== undefined) throw sessionListError
            return {
              items: state.summaries.map((summary) => ({
                ...summary,
                agentAvailable: false,
                running: false,
              })),
            }
          },
        }
      }
      return undefined
    },
  }
  return { ctx, state, agent }
}

test('robots service: dispatchSession returns before the turn ends and reads the finished turn', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const handle = await service.dispatchSession({ robot: 'writer', prompt: 'do the work' })
    assert.equal(handle.mode, 'session')
    assert.equal(handle.sessionId, fake.state.createOptions.sessionId)
    assert.equal(handle.startSeq, 0)
    assert.equal(fake.state.followups.length, 1)
    const result = handle.readResult()
    assert.equal(result.turnEnded, true)
    assert.equal(result.text, 'dispatch done 1')
    assert.equal(result.stopReason, 'completed')
    await handle.dispose()
    assert.equal(fake.state.disposed, true)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: openSession attaches a finished session without sending a prompt, then can continue it', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const first = await service.dispatchSession({ robot: 'writer', prompt: 'first' })
    const firstSeq = first.startSeq
    await first.dispose()
    const opened = await service.openSession({ robot: 'writer', sessionId: 'dispatch-session' })
    assert.equal(fake.state.followups.length, 1, 'openSession does not send a prompt')
    const previous = opened.readResult({ sinceSeq: firstSeq })
    assert.equal(previous.turnEnded, true)
    assert.equal(previous.text, 'dispatch done 1')
    await opened.send('continue')
    assert.equal(fake.state.followups.length, 2)
    const next = opened.readResult({ sinceSeq: opened.startSeq - 1 })
    assert.equal(next.text, 'dispatch done 2')
    await opened.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: releasing a dispatched agent re-announces the durable session', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const handle = await service.dispatchSession({ robot: 'writer', prompt: 'do the work' })
    await handle.dispose()
    assert.equal(fake.state.disposed, true)
    assert.equal(
      fake.state.sessionListCalls,
      1,
      'the host session list is read once after disposing',
    )
    const announced = fake.state.emitted.filter(([event]) => event === 'api-session/added')
    assert.equal(announced.length, 1, 'the durable session is announced back to the client')
    assert.equal(announced[0][1].sessionId, handle.sessionId)
    assert.equal(announced[0][1].agentAvailable, false, 'the announced session is cold')
    assert.equal(announced[0][1].running, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a missing session list or a failing list never breaks releasing the agent', async () => {
  const home = await makeRobotHome()
  try {
    // 没有 sessionController（例如 headless 组合）：只释放 agent，不补通告。
    const withoutController = makeDispatchContext({ noSessionController: true })
    const first = new RobotSessionService({
      ctx: withoutController.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const firstHandle = await first.dispatchSession({ robot: 'writer', prompt: 'do the work' })
    await firstHandle.dispose()
    assert.equal(withoutController.state.disposed, true)
    assert.equal(withoutController.state.sessionListCalls, 0)
    assert.deepEqual(withoutController.state.emitted, [])

    // 读会话列表失败：只 warn，dispose 仍然成功。
    const failing = makeDispatchContext({ sessionListError: new Error('session list unavailable') })
    const second = new RobotSessionService({
      ctx: failing.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const secondHandle = await second.dispatchSession({ robot: 'writer', prompt: 'do the work' })
    await secondHandle.dispose()
    assert.equal(failing.state.disposed, true)
    assert.equal(failing.state.sessionListCalls, 1)
    assert.deepEqual(failing.state.emitted, [])
    assert.ok(
      failing.state.warnings.some((message) => message.includes('re-announcing robot session')),
      'a failed re-announce is reported',
    )
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a plan node runs /plan against the agent before the first prompt', async () => {
  const home = await makeRobotHome()
  try {
    const planCommands = makePlanCommands()
    const fake = makeDispatchContext({ commands: planCommands.service })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    assert.equal(service.supportsPlanMode, true)
    const handle = await service.dispatchSession({
      robot: 'writer',
      prompt: 'plan it',
      planMode: true,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan'], 'plan mode is entered with /plan')
    assert.deepEqual(
      planCommands.state.agents,
      [fake.agent.id],
      '/plan is executed against the robot agent',
    )
    const types = fake.state.events.map((event) => event.type)
    const planIndex = types.indexOf('plan/mode')
    const promptIndex = types.indexOf('user/message')
    assert.ok(
      planIndex >= 0 && planIndex < promptIndex,
      'plan mode is applied before the first prompt',
    )
    assert.deepEqual(handle.getPlanMode(), { active: true })
    await handle.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a resumed plan node runs /plan before continuing the session', async () => {
  const home = await makeRobotHome()
  try {
    const planCommands = makePlanCommands()
    const fake = makeDispatchContext({ commands: planCommands.service })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const first = await service.dispatchSession({ robot: 'writer', prompt: 'first' })
    await first.dispose()
    const resumed = await service.dispatchSession({
      robot: 'writer',
      prompt: 'plan next',
      sessionId: first.sessionId,
      planMode: true,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan'])
    const types = fake.state.events.map((event) => event.type)
    const planIndex = types.lastIndexOf('plan/mode')
    const promptIndex = types.lastIndexOf('user/message')
    assert.ok(
      planIndex >= 0 && planIndex < promptIndex,
      'plan mode is applied before the continuation prompt',
    )
    await resumed.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a plan node fails clearly when the agent cannot run /plan, and the session is released', async () => {
  const home = await makeRobotHome()
  try {
    const planCommands = makePlanCommands({ available: false })
    const fake = makeDispatchContext({ commands: planCommands.service })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.dispatchSession({ robot: 'writer', prompt: 'plan it', planMode: true }),
      /plan mode is unavailable in this composition/u,
    )
    assert.notEqual(
      fake.state.createOptions,
      null,
      'the command entry is checked against the created agent',
    )
    assert.equal(fake.state.disposed, true, 'the created agent is released')
    assert.equal(fake.state.followups.length, 0)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: requesting planMode without a command entry fails before creating a session', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.dispatchSession({ robot: 'writer', prompt: 'plan it', planMode: true }),
      /plan mode is unavailable in this composition/u,
    )
    assert.equal(
      fake.state.createOptions,
      null,
      'no robot session is created when the plan command entry is unavailable',
    )
    assert.equal(fake.state.followups.length, 0)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: /plan off only runs when the session log says plan mode is active', async () => {
  const home = await makeRobotHome()
  try {
    const planCommands = makePlanCommands()
    const fake = makeDispatchContext({ commands: planCommands.service })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })

    // 新会话的普通节点：没有残留状态，不碰命令入口。
    const normal = await service.dispatchSession({
      robot: 'writer',
      prompt: 'work',
      planMode: false,
    })
    assert.deepEqual(planCommands.state.lines, [])
    await normal.dispose()

    // plan 节点进入过 plan 模式：复用同一会话的普通节点先把它清掉。
    const plan = await service.dispatchSession({ robot: 'writer', prompt: 'plan', planMode: true })
    assert.deepEqual(planCommands.state.lines, ['/plan'])
    await plan.dispose()
    const reused = await service.dispatchSession({
      robot: 'writer',
      prompt: 'work',
      sessionId: plan.sessionId,
      planMode: false,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan', '/plan off'])
    await reused.dispose()

    // 已经退出后再进入普通节点：无残留，不再重复清理。
    const again = await service.dispatchSession({
      robot: 'writer',
      prompt: 'work more',
      sessionId: plan.sessionId,
      planMode: false,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan', '/plan off'])
    await again.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: the observer reads plan state from the session log and clears it best-effort', async () => {
  const home = await makeRobotHome()
  try {
    const planCommands = makePlanCommands()
    const fake = makeDispatchContext({ commands: planCommands.service })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const handle = await service.dispatchSession({ robot: 'writer', prompt: 'work' })
    assert.deepEqual(handle.getPlanMode(), { active: false })

    fake.agent.session.append('plan/mode', { active: true })
    assert.deepEqual(handle.getPlanMode(), { active: true })

    handle.setPlanMode(false)
    await Promise.resolve()
    assert.deepEqual(planCommands.state.lines, ['/plan off'])
    assert.deepEqual(handle.getPlanMode(), { active: false })

    // 已经退出：再次清理是 no-op，不会再发命令。
    handle.setPlanMode(false)
    await Promise.resolve()
    assert.deepEqual(planCommands.state.lines, ['/plan off'])

    handle.setPlanMode(true)
    await Promise.resolve()
    assert.deepEqual(planCommands.state.lines, ['/plan off', '/plan'])
    assert.deepEqual(handle.getPlanMode(), { active: true })
    await handle.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: the blocking startSession rejects planMode', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.startSession({ robot: 'writer', prompt: 'plan it', planMode: true }),
      /planMode is only supported by dispatchSession\/openSession/u,
    )
    assert.equal(fake.state.createOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})
