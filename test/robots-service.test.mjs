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

import { defaultAvatarFor } from '../plugins/robots/lib/avatar.js'
import {
  addRobot,
  resolveRobotRegistryFile,
} from '../plugins/robots/lib/robot-store.js'
import {
  RobotSessionService,
  mapTurnEnd,
  parseStructuredText,
  readSessionOutcome,
  reportFailureMessage,
  reportRetryPrompt,
  structuredSubmittedSince,
  summarizeRobot,
  textOfContent,
} from '../plugins/robots/lib/service.js'

test('robots service: summarizeRobot strips AGENTS.md bodies and keeps orchestration fields', () => {
  const summary = summarizeRobot({
    name: 'writer',
    path: '/tmp/writer',
    createdAt: '2026-01-01T00:00:00.000Z',
    exists: true,
    mounted: true,
    workspaceId: 'ws-1',
    skills: [{ name: 'convex', description: 'db' , content: 'x' }],
    agents: { exists: true, bytes: 42, modifiedAt: '2026-01-02T00:00:00.000Z', content: '# big' },
    claude: { exists: true, symlink: true, mode: 'symlink', target: 'AGENTS.md' },
  })
  assert.equal(summary.name, 'writer')
  assert.equal(summary.avatar, defaultAvatarFor('writer'), 'missing avatar falls back deterministically')
  assert.equal(summary.mounted, true)
  assert.equal(summary.workspaceId, 'ws-1')
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
        data: { message: { content: [{ type: 'text', text: 'final' }, { type: 'text', text: 'line two' }] } },
      },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ],
  }
  assert.deepEqual(readSessionOutcome(session), { text: 'final\nline two', stopReason: 'completed' })
  assert.deepEqual(readSessionOutcome({ ownEvents: () => [] }), { text: '', stopReason: 'completed' })

  // 续接时只读 startSeq 之后的事件，不会把上一轮的文本当成本轮结果。
  const continued = {
    ownEvents: () => [
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'old' }] } } },
      { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } },
      { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: 'new' }] } } },
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
function makeFakeContext({ subagents, resumeError, compactionError, noCompaction, noAgentCreate, sessionTitle } = {}) {
  const state = {
    createOptions: null,
    // DSH 的 session-title 服务替身：记录显式命名调用；已有标题时不覆盖。
    sessionTitle: sessionTitle ?? null,
    sessionTitles: [],
    registered: [],
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
  }
  const agentsService = {
    async create(options) {
      if (noAgentCreate === true) throw new Error('normal robot sessions are unavailable')
      state.createOptions = options
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
              section: () => {},
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
      let resolveIdle
      const idle = new Promise((resolve) => {
        resolveIdle = resolve
      })
      state.resumedFinishIdle = resolveIdle
      const session = {
        seq: 0,
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
          const event = { type: 'turn/end', seq: session.seq, data: { reason: { kind: 'completed' } } }
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
    get(name) {
      if (name === 'subagents') return subagents
      if (name === 'agents') return agentsService
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
      if (name === 'approval') return { setPolicy() {} }
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
          { name: 'writer', path: path.join(home.robotsDir, 'writer'), createdAt: '2026-01-01T00:00:00.000Z', avatar: 'panda' },
          { name: 'legacy', path: path.join(home.robotsDir, 'legacy'), createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    )
    assert.deepEqual(await service.avatarMap(), {
      writer: 'panda',
      legacy: defaultAvatarFor('legacy'),
    })

    // 登记表损坏：返回空表，不抛错（调用方只是不画头像）。
    await fs.writeFile(home.registryFile, '{broken')
    assert.deepEqual(await service.avatarMap(), {})
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: startSession creates a robot-cwd session, records structured report and disposes', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext()
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
      defineTool: (definition) => definition,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do the work',
      report: true,
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
    assert.equal(state.registered.length, 1)
    assert.equal(state.registered[0].name, 'structured_output')

    await state.registered[0].execute({ status: 'ok' })
    state.finishIdle()

    const result = await session.result
    assert.equal(result.text, 'robot finished')
    assert.deepEqual(result.structured, { status: 'ok' })
    assert.equal(result.stopReason, 'completed')
    assert.equal(state.disposed, true)
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
    await assert.rejects(() => service.startSession({ robot: 'nobody', prompt: 'x' }), /unknown robot/)
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
    assert.equal(state.resumeOptions.parentAgent.id, 'root')
    assert.equal(state.mountedPreset, 'standard')

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
    assert.equal(result.reportRetries, undefined)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: compaction failure does not lose the continued turn', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext({ compactionError: new Error('summary model unavailable') })
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

test('robots service: a report node on a continued session gets its structured tool back', async () => {
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
      prompt: 'check again',
      sessionId: 'child-report',
      report: true,
      agent: { id: 'root' },
      timeoutMs: 5000,
    })
    assert.equal(session.resumed, true)
    assert.equal(state.resumedRegistered.length, 1)
    assert.equal(state.resumedRegistered[0].name, 'structured_output')
    assert.equal(state.resumedSections.length, 1)
    assert.match(state.resumedSections[0].text, /structured_output/)

    const result = await session.result
    assert.equal(result.resumed, true)
    // 续接会话的 fake 回复是 JSON 文本，没调用工具也应被解析成 structured。
    assert.deepEqual(result.structured, { passed: true })
    assert.equal(result.reportRetries, 0)
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

test('robots service: an unresumable session falls back to a fresh session', async () => {
  const home = await makeRobotHome()
  try {
    const { ctx, state } = makeFakeContext({ resumeError: new Error('session is missing') })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do it',
      sessionId: 'child-gone',
      timeoutMs: 5000,
    })
    assert.equal(session.resumed, false)
    assert.match(session.resumeError, /session is missing/)
    state.finishIdle()
    const result = await session.result
    assert.equal(result.resumed, false)
    assert.equal(result.compacted, false)
    assert.match(result.resumeError, /session is missing/)
    assert.equal(state.disposed, true)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: textOfContent joins only text blocks', () => {
  assert.equal(
    textOfContent([
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'b' },
    ]),
    'a\nb',
  )
  assert.equal(textOfContent(undefined), '')
})

test('robots service: a caller agent gets a visible normal session in the robot workspace', async () => {
  const home = await makeRobotHome()
  try {
    let startedActivation = false
    const subagents = {
      list: () => ['spawn'],
      interrupt() {},
      async startActivation() {
        startedActivation = true
        throw new Error('the subagent backend should not be used')
      },
    }
    const { ctx, state } = makeFakeContext({ subagents })
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
    assert.equal(startedActivation, false)
    state.finishIdle()
    const result = await session.result
    assert.equal(result.text, 'robot finished')
    assert.equal(result.resumed, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: startSession falls back to the subagent backend when a normal session cannot be created', async () => {
  const home = await makeRobotHome()
  try {
    const calls = []
    let disposed = false
    const subagents = {
      list: () => ['spawn'],
      interrupt() {},
      async startActivation(spec) {
        calls.push(spec)
        return {
          childId: 'child-1',
          result: Promise.resolve({
            output: [{ type: 'text', text: 'robot done' }],
            structured: { status: 'ok' },
            stopReason: 'completed',
          }),
          async dispose() {
            disposed = true
          },
        }
      },
    }
    const { ctx } = makeFakeContext({ subagents, noAgentCreate: true })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
      subagentProvider: 'spawn',
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do it',
      report: true,
      agent: { id: 'root' },
      agentPreset: 'standard',
    })
    assert.equal(session.id, 'child-1')
    const result = await session.result
    assert.equal(result.text, 'robot done')
    assert.deepEqual(result.structured, { status: 'ok' })
    assert.equal(result.stopReason, 'completed')
    assert.equal(disposed, true)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].provider, 'spawn')
    assert.equal(calls[0].delivery, 'caller')
    assert.equal(calls[0].request.parent.id, 'root')
    assert.equal(calls[0].request.cwd, await fs.realpath(path.join(home.robotsDir, 'writer')))
    assert.equal(calls[0].request.outputSchema.type, 'object')
    assert.equal(calls[0].request.agentPreset, 'standard')
    assert.match(calls[0].label, /writer/)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: subagent session timeout interrupts and disposes', async () => {
  const home = await makeRobotHome()
  try {
    let interrupted = false
    let disposed = false
    const subagents = {
      list: () => ['spawn'],
      interrupt() {
        interrupted = true
      },
      async startActivation() {
        return {
          childId: 'child-2',
          result: new Promise(() => {}),
          async dispose() {
            disposed = true
          },
        }
      },
    }
    const { ctx } = makeFakeContext({ subagents, noAgentCreate: true })
    const service = new RobotSessionService({
      ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do it',
      agent: { id: 'root' },
      timeoutMs: 10,
    })
    const result = await session.result
    assert.equal(result.stopReason, 'timeout')
    assert.equal(interrupted, true)
    assert.equal(disposed, true)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

/**
 * 可控的 subagent 活动：会话事件与最终结果都由测试手动驱动。
 *
 * @param {string} childId
 * @returns {{ child: Record<string, any>, emit: Function, followups: Array<Record<string, any>>, resolve: Function, result: Promise<any> }}
 */
function retryActivation(childId) {
  /** @type {Function} */
  let resolveResult
  const result = new Promise((resolve) => {
    resolveResult = resolve
  })
  /** @type {Array<Record<string, any>>} */
  const events = []
  /** @type {Array<Record<string, any>>} */
  const followups = []
  /** @type {Map<string, Function[]>} */
  const handlers = new Map()
  const session = {
    seq: 0,
    ownEvents: () => events,
  }
  /** @type {string[]} */
  const removedInbox = []
  const child = {
    id: childId,
    session,
    inbox: {
      remove(id) {
        removedInbox.push(id)
      },
    },
    ctx: {
      on(name, handler) {
        const list = handlers.get(name) ?? []
        list.push(handler)
        handlers.set(name, list)
        return () => {
          handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler))
        }
      },
    },
    followup(message) {
      followups.push(message)
    },
  }
  /** @param {string} type @param {Record<string, any>} data @returns {void} */
  function emit(type, data) {
    session.seq += 1
    const event = { type, seq: session.seq, data }
    events.push(event)
    for (const handler of handlers.get('session/event') ?? []) handler(session, event)
  }
  return { child, emit, followups, removedInbox, result, resolve: (value) => resolveResult(value) }
}

/**
 * 建一个走 subagent 后端的 report 节点会话。
 *
 * @param {Record<string, any>} home
 * @param {ReturnType<typeof retryActivation>} activation
 * @param {number} [reportRetries]
 * @returns {Promise<{ session: Record<string, any>, state: Record<string, any> }>}
 */
async function startRetrySession(home, activation, reportRetries = 2, reportRetryWakeTimeoutMs) {
  const subagents = {
    list: () => ['spawn'],
    interrupt() {},
    async startActivation() {
      return {
        childId: activation.child.id,
        result: activation.result,
        async dispose() {},
      }
    },
  }
  const { ctx, state } = makeFakeContext({ subagents, noAgentCreate: true })
  state.liveAgents.set(activation.child.id, activation.child)
  const service = new RobotSessionService({
    ctx,
    robotsDir: home.robotsDir,
    registryFile: home.registryFile,
    subagentProvider: 'spawn',
    reportRetries,
    ...(reportRetryWakeTimeoutMs === undefined ? {} : { reportRetryWakeTimeoutMs }),
  })
  const session = await service.startSession({
    robot: 'writer',
    prompt: 'do the work',
    report: true,
    agent: { id: 'root' },
    timeoutMs: 5000,
  })
  return { session, state }
}

/**
 * 等一轮微任务：重试消息是排到微任务里投递的。
 *
 * @returns {Promise<void>}
 */
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('robots service: a report node asks the same session for JSON before it can finish', async () => {
  const home = await makeRobotHome()
  try {
    const activation = retryActivation('child-retry')
    const { session } = await startRetrySession(home, activation)

    activation.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flushMicrotasks()
    assert.equal(activation.followups.length, 1, 'the missing JSON injects one follow-up')
    assert.match(activation.followups[0].content[0].text, /structured_output/)
    assert.equal(activation.followups[0].source.kind, 'buka-robot')
    assert.equal(activation.followups[0].role, 'user', 'the injected message is a complete user message')
    assert.equal(typeof activation.followups[0].id, 'string')

    activation.emit('tool/call', {
      turn: 2,
      step: 1,
      callId: 'call-1',
      name: 'structured_output',
      arguments: '{"ok":true}',
    })
    activation.emit('tool/result', {
      turn: 2,
      step: 1,
      message: { role: 'tool', toolCallId: 'call-1', isError: false, content: [] },
    })
    activation.emit('turn/end', { turn: 2, reason: { kind: 'completed' } })
    activation.resolve({ output: [{ type: 'text', text: 'done' }], structured: { ok: true }, stopReason: 'completed' })

    const result = await session.result
    assert.deepEqual(result.structured, { ok: true })
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.reportRetries, 1)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a retry message that never wakes the session is withdrawn from the inbox', async () => {
  const home = await makeRobotHome()
  try {
    const activation = retryActivation('child-wake')
    const { session } = await startRetrySession(home, activation, 2, 5)
    activation.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flushMicrotasks()
    assert.equal(activation.followups.length, 1)
    assert.equal(activation.removedInbox.length, 0, 'the watchdog waits for the next turn')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(activation.removedInbox.length, 1, 'the pending retry message is removed to unblock the activity')
    assert.equal(activation.removedInbox[0], activation.followups[0].id)
    activation.resolve({ output: [], stopReason: 'error' })
    const result = await session.result
    assert.equal(result.stopReason, 'error')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a JSON reply text avoids an unnecessary retry', async () => {
  const home = await makeRobotHome()
  try {
    const activation = retryActivation('child-json-text')
    const { session } = await startRetrySession(home, activation)
    activation.emit('assistant/message', {
      message: { content: [{ type: 'text', text: '{"ok":true}' }] },
    })
    activation.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flushMicrotasks()
    assert.equal(activation.followups.length, 0, 'a JSON reply already satisfies the report')
    activation.resolve({ output: [{ type: 'text', text: '{"ok":true}' }], stopReason: 'error' })
    const result = await session.result
    assert.deepEqual(result.structured, { ok: true })
    assert.equal(result.stopReason, 'completed')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: report retries are bounded and end with a clear error', async () => {
  const home = await makeRobotHome()
  try {
    const activation = retryActivation('child-exhaust')
    const { session } = await startRetrySession(home, activation, 2)

    activation.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flushMicrotasks()
    activation.emit('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await flushMicrotasks()
    activation.emit('turn/end', { turn: 3, reason: { kind: 'completed' } })
    await flushMicrotasks()
    assert.equal(activation.followups.length, 2, 'the session is asked at most reportRetries times')
    activation.resolve({ output: [{ type: 'text', text: 'plain answer' }], stopReason: 'error' })

    const result = await session.result
    assert.equal(result.stopReason, 'error')
    assert.equal(result.reportRetries, 2)
    assert.match(result.error, /did not submit a structured JSON result after 2 retries in the same session/)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a JSON object in the final reply counts as the structured result', async () => {
  const home = await makeRobotHome()
  try {
    const activation = retryActivation('child-text')
    const { session } = await startRetrySession(home, activation)
    activation.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flushMicrotasks()
    activation.resolve({
      output: [{ type: 'text', text: '```json\n{"ok":true}\n```' }],
      stopReason: 'error',
    })
    const result = await session.result
    assert.deepEqual(result.structured, { ok: true })
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.error, undefined)
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
      reportRetries: 2,
    })
    const session = await service.startSession({
      robot: 'writer',
      prompt: 'do the work',
      report: true,
      timeoutMs: 5000,
    })
    state.finishIdle()
    const result = await session.result
    // 第一条是初始任务，后面两条是「没交回 JSON」后的重试消息。
    assert.equal(state.followups.length, 3)
    assert.match(state.followups[1].content[0].text, /structured_output/)
    assert.match(state.followups[2].content[0].text, /retry 2\/2/)
    assert.equal(result.stopReason, 'error')
    assert.equal(result.reportRetries, 2)
    assert.match(result.error, /did not submit a structured JSON result/)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: retry helpers parse JSON replies and detect submitted structured results', () => {
  assert.match(reportRetryPrompt(1, 2, 'structured_output'), /retry 1\/2/)
  assert.equal(reportFailureMessage(0), 'the robot session did not submit a structured JSON result')
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

