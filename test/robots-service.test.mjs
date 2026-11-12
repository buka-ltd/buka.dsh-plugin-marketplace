/**
 * @buka/dsh-plugin-robots 对外 Service 的单测。
 *
 * 不启动 DSH：覆盖列表摘要、会话日志解析、dispatchSession / openSession 的
 * 观测语义、plan 模式与恢复路径。v4 的服务不再有压缩、结果追问与阻塞
 * startSession，这里同时回归这些路径确实不存在。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { defaultAvatarFor } from '../plugins/robots/src/avatar.ts'
import {
  addRobot,
  ensureBuiltinRobots,
  resolveRobotRegistryFile,
} from '../plugins/robots/src/robot-store.ts'
import {
  mapTurnEnd,
  RobotSessionService,
  readSessionOutcome,
  summarizeRobot,
} from '../plugins/robots/src/service.ts'

test('robots service: summarizeRobot keeps orchestration fields and driver/assistant', () => {
  const summary = summarizeRobot({
    name: 'writer',
    driver: 'agent',
    program: '',
    assistant: true,
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
  assert.equal(summary.driver, 'agent')
  assert.equal(summary.program, '')
  assert.equal(summary.assistant, true)
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

  // program 型机器人：登记与展示用，但没有会话 / 目录。
  const clock = summarizeRobot({
    name: 'clock',
    driver: 'program',
    program: 'clock',
    assistant: false,
    path: '',
    createdAt: '2026-11-12T00:00:00.000Z',
    exists: false,
    mounted: false,
    workspaceId: null,
    description: '到点完成任务的定时机器人',
    skills: [],
    agents: { exists: false, bytes: 0, modifiedAt: null, content: '', tooLarge: false },
    claude: { exists: false, symlink: false, mode: 'missing', target: '' },
  })
  assert.equal(clock.driver, 'program')
  assert.equal(clock.program, 'clock')
  assert.equal(clock.assistant, false)
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
 * 建一个临时机器人目录与登记表，并补上内建 clock（模拟插件启动）。
 *
 * @returns {Promise<{ robotsDir: string, registryFile: string, root: string }>}
 */
async function makeRobotHome() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-robots-service-'))
  const robotsDir = path.join(root, 'robots')
  const registryFile = resolveRobotRegistryFile(robotsDir)
  await addRobot({ robotsDir, file: registryFile, name: 'writer' })
  await ensureBuiltinRobots({ file: registryFile })
  return { root, robotsDir, registryFile }
}

/**
 * dispatch / openSession 用的最小假上下文：visible 会话 + 可追加的会话事件。
 * 默认不提供根作用域的 `planMode` 服务，与 desktop/web 的组合一致。
 *
 * @returns {{ ctx: Record<string, any>, state: Record<string, any>, agent: Record<string, any> }}
 */
function makeDispatchContext({
  sessionListError,
  noSessionController,
  noEmit,
  commands,
  presets,
  sessionTitle,
  noCompaction,
  noAgentCreate,
  resumeOrigin,
  resumeError,
} = {}) {
  const events = []
  const state = {
    events,
    followups: [],
    disposed: false,
    createOptions: null,
    createCalls: 0,
    resumeOptions: null,
    summaries: [],
    sessionListCalls: 0,
    emitted: [],
    warnings: [],
    cancelled: null,
    approvalPolicies: [],
    mountedPresets: [],
    sessionTitles: [],
    compactCalls: 0,
    sessionTitle: sessionTitle ?? null,
  }
  const session = {
    get seq() {
      return events.length
    },
    header: {},
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
    cancel(reason) {
      state.cancelled = reason ?? {}
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
    get(name) {
      if (name === 'agentPresets' && presets !== false) {
        return {
          defaultId: 'standard',
          presetForSession: () => state.recordedPreset ?? null,
          async mount(_ctx, preset) {
            state.mountedPresets.push(preset)
          },
          composeFrom() {},
        }
      }
      return undefined
    },
    tools: { register() {} },
  }
  const agents = {
    async create(options) {
      if (noAgentCreate === true) throw new Error('normal robot sessions are unavailable')
      state.createCalls += 1
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
      if (resumeError !== undefined) throw resumeError
      agent.id = options.resumeSessionId
      session.header = resumeOrigin === undefined ? {} : { origin: resumeOrigin }
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
        return {
          path: target,
          async attachSession(sessionId) {
            state.attachedSessions ??= []
            state.attachedSessions.push({ sessionId, path: target })
          },
        }
      },
    },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'commands') return commands
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
      }
      if (name === 'sessionTitle') {
        return {
          get: () => state.sessionTitle ?? undefined,
          rename(_session, title) {
            state.sessionTitles.push(title)
            state.sessionTitle = { title, source: { kind: 'user' } }
          },
        }
      }
      if (name === 'approval') {
        return {
          setPolicy(_agent, policy) {
            state.approvalPolicies.push(policy)
          },
        }
      }
      if (name === 'compaction') {
        if (noCompaction === true) return undefined
        return {
          async compactNow() {
            state.compactCalls += 1
            return { compactionId: 'cmp-1' }
          },
        }
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

/**
 * dispatch / openSession 用的假 `commands` 服务：把 plan 模式当作真实的 `/plan`
 * 命令入口——记录调用，并在会话日志里写命令生命周期与 `plan/mode` 事件。
 *
 * @returns {{ state: Record<string, any>, service: Record<string, any> }}
 */
function makePlanCommands({ available = true, kind = 'success' } = {}) {
  const state = { lines: [], agents: [] }
  const service = {
    async execute(agent, line) {
      if (!available) return undefined
      state.lines.push(line)
      state.agents.push(agent?.id)
      const commandId = `cmd-${state.lines.length}`
      const session = agent?.session
      session?.append?.('command/run', { commandId, name: 'plan' })
      if (kind === 'success') session?.append?.('plan/mode', { active: line !== '/plan off' })
      session?.append?.('command/done', { commandId, kind })
      return { commandId, result: { kind } }
    },
  }
  return { state, service }
}

test('robots service: list returns summarized registry robots including the built-in clock', async () => {
  const home = await makeRobotHome()
  try {
    const service = new RobotSessionService({
      ctx: { workspaceRegistry: { list: () => [] } },
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const listed = await service.list()
    assert.equal(listed.corrupt, false)
    assert.deepEqual(
      listed.robots.map((robot) => robot.name),
      ['writer', 'clock'],
    )
    const writer = listed.robots.find((robot) => robot.name === 'writer')
    assert.equal(writer.driver, 'agent')
    assert.equal(writer.assistant, false)
    assert.equal(writer.description, '')
    assert.ok(typeof writer.avatar === 'string' && writer.avatar !== '')
    assert.equal(writer.agents.exists, true)
    assert.equal('content' in writer.agents, false)
    const clock = listed.robots.find((robot) => robot.name === 'clock')
    assert.equal(clock.driver, 'program')
    assert.equal(clock.program, 'clock')
    assert.equal(clock.assistant, false)
    assert.equal(clock.exists, false)
    assert.deepEqual(clock.skills, [])
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: avatarMap is a lightweight name -> avatar lookup with builtins', async () => {
  const home = await makeRobotHome()
  try {
    const service = new RobotSessionService({
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    // 新建的机器人一定有头像；内建 clock 按名字兜底。
    const first = await service.avatarMap()
    assert.deepEqual(Object.keys(first), ['writer', 'clock'])
    assert.ok(typeof first.writer === 'string' && first.writer !== '')
    assert.equal(first.clock, defaultAvatarFor('clock'))

    // version 1 旧登记表：缺 avatar 的按名字兜底；显式设置过的用设置值。
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
      clock: defaultAvatarFor('clock'),
    })

    // 登记表损坏：返回空表，不抛错。
    await fs.writeFile(home.registryFile, '{broken')
    assert.deepEqual(await service.avatarMap(), {})
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: dispatchSession creates a visible session without a structured-output tool', async () => {
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
    assert.equal(handle.resumed, false)
    assert.equal(
      fake.state.createOptions.meta.cwd,
      await fs.realpath(path.join(home.robotsDir, 'writer')),
    )
    assert.equal(fake.state.createOptions.agentOptions.provider, 'test-provider')
    assert.equal(fake.state.createOptions.agentOptions.model, 'test-model')
    assert.deepEqual(fake.state.mountedPresets, ['standard'])
    assert.equal(fake.state.attachedSessions.length, 1)
    assert.equal(fake.state.attachedSessions[0].sessionId, handle.sessionId)
    assert.equal(fake.state.followups.length, 1)
    // 结果契约已经移到工作流侧：不再注册任何 scoped 工具或系统提示段。
    assert.equal('registered' in fake.state, false)

    // 新会话先投 prompt，再读这一轮的文本。
    const result = handle.readResult()
    assert.equal(result.turnEnded, true)
    assert.equal(result.text, 'dispatch done 1')
    assert.equal(result.stopReason, 'completed')
    assert.equal(result.sessionId, handle.sessionId)
    // 观测句柄只剩契约里的方法：不再有结果追问 / 压缩标记。
    assert.equal('retryReport' in handle, false)
    assert.equal('compacted' in handle, false)

    await handle.dispose()
    assert.equal(fake.state.disposed, true)
    // 释放 agent 后会话仍然持久化：补通告一次冷会话，客户端不会把它从列表里删掉。
    assert.equal(fake.state.sessionListCalls, 1)
    const announced = fake.state.emitted.filter(([event]) => event === 'api-session/added')
    assert.equal(announced.length, 1)
    assert.equal(announced[0][1].sessionId, handle.sessionId)
    assert.equal(announced[0][1].agentAvailable, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: the blocking startSession is gone', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    assert.equal(typeof service.startSession, 'undefined')
    assert.equal(service.supportsPlanMode, true)
    // dispatch 不再复用会话：带 sessionId 直接失败，恢复只能走 openSession。
    await assert.rejects(
      () => service.dispatchSession({ robot: 'writer', prompt: 'resume', sessionId: 'old' }),
      /dispatchSession always starts a new robot session; use openSession/u,
    )
    await assert.rejects(
      () => service.dispatchSession({ robot: 'writer', prompt: '   ' }),
      /prompt/,
    )
    assert.equal(fake.state.createOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a new robot session is titled from the request', async () => {
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
      prompt: 'write the release notes',
      title: '为 v1.2 写发布说明 · writer',
    })
    assert.deepEqual(fake.state.sessionTitles, ['为 v1.2 写发布说明 · writer'])
    await handle.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: openSession resumes the same session without sending a prompt or compacting', async () => {
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
    assert.equal(fake.state.resumeOptions.resumeSessionId, 'dispatch-session')
    // 续接出来的会话是运行时根：不能把编排器 agent 当 parentAgent 传进去。
    assert.equal('parentAgent' in fake.state.resumeOptions, false)
    assert.equal(fake.state.followups.length, 1, 'openSession does not send a prompt')
    const previous = opened.readResult({ sinceSeq: firstSeq })
    assert.equal(previous.turnEnded, true)
    assert.equal(previous.text, 'dispatch done 1')

    const nextSeq = await opened.send('continue')
    assert.equal(fake.state.followups.length, 2)
    assert.equal(nextSeq, opened.startSeq)
    const next = opened.readResult()
    assert.equal(next.text, 'dispatch done 2')
    // 续接只投消息，不压缩、不新开会话。
    assert.equal(fake.state.compactCalls, 0)
    assert.equal(opened.resumed, true)
    await opened.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: openSession only titles a session that has no title yet', async () => {
  const home = await makeRobotHome()
  try {
    // 已有标题（例如用户手动改过）：续接时不再覆盖。
    const existing = makeDispatchContext({ sessionTitle: { title: '用户改过的标题' } })
    const service = new RobotSessionService({
      ctx: existing.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const first = await service.dispatchSession({ robot: 'writer', prompt: 'first' })
    await first.dispose()
    const kept = await service.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      title: '为 v1.2 写发布说明 · writer',
    })
    // dispatch 时已经命名过（fake 的 rename 会写入 sessionTitle），续接不覆盖。
    assert.equal(existing.state.sessionTitle.title, '用户改过的标题')
    await kept.dispose()

    // 早期版本建的会话没有标题：续接时补上，侧边栏不再显示「未命名」。
    const untitled = makeDispatchContext()
    untitled.state.sessionTitle = null
    const second = new RobotSessionService({
      ctx: untitled.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const secondFirst = await second.dispatchSession({ robot: 'writer', prompt: 'first' })
    untitled.state.sessionTitles.length = 0
    untitled.state.sessionTitle = null
    await secondFirst.dispose()
    const named = await second.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      title: '为 v1.2 写发布说明 · writer',
    })
    assert.deepEqual(untitled.state.sessionTitles, ['为 v1.2 写发布说明 · writer'])
    await named.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: unknown and program robots are rejected before creating an agent', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext()
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.dispatchSession({ robot: 'nobody', prompt: 'x' }),
      /unknown robot/,
    )
    await assert.rejects(
      () => service.dispatchSession({ robot: 'clock', prompt: 'tick' }),
      /program robot and has no session/,
    )
    await assert.rejects(
      () => service.openSession({ robot: 'clock', sessionId: 's1' }),
      /program robot and has no session/,
    )
    assert.equal(fake.state.createOptions, null)
    assert.equal(fake.state.resumeOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: an unresumable session rejects without opening a new session', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext({ resumeError: new Error('session is missing') })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.openSession({ robot: 'writer', sessionId: 'child-gone' }),
      /could not resume robot session "child-gone".*session is missing.*refusing to start a new robot session/s,
    )
    assert.equal(fake.state.createOptions, null, 'no replacement session is created')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a failed normal session creation is surfaced, never replaced by a subagent', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext({ noAgentCreate: true })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.dispatchSession({ robot: 'writer', prompt: 'do it' }),
      /could not create a visible robot session.*normal robot sessions are unavailable.*refusing to fall back/s,
    )
    assert.equal(fake.state.createOptions, null)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: resuming a hidden subagent session rejects without a replacement', async () => {
  const home = await makeRobotHome()
  try {
    const fake = makeDispatchContext({ resumeOrigin: 'subagent' })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    const first = await service.dispatchSession({ robot: 'writer', prompt: 'first' })
    await first.dispose()
    await assert.rejects(
      () => service.openSession({ robot: 'writer', sessionId: 'hidden-child' }),
      /hidden subagent robot session/u,
    )
    assert.equal(fake.state.disposed, true, 'the hidden handle is released')
    assert.equal(fake.state.createCalls, 1, 'no replacement session is created')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: approval defaults to the deployment policy; never forces rejections', async () => {
  const home = await makeRobotHome()
  try {
    /** @param {ReturnType<typeof makeDispatchContext>} fake */
    const makeService = (fake) =>
      new RobotSessionService({
        ctx: fake.ctx,
        robotsDir: home.robotsDir,
        registryFile: home.registryFile,
      })

    // 省略 approval：保持部署策略。
    const omitted = makeDispatchContext()
    const omittedHandle = await makeService(omitted).dispatchSession({
      robot: 'writer',
      prompt: 'do it',
    })
    assert.deepEqual(omitted.state.approvalPolicies, [])
    await omittedHandle.dispose()

    // 'ask' 是默认值，同样不动策略。
    const asked = makeDispatchContext()
    const askedHandle = await makeService(asked).dispatchSession({
      robot: 'writer',
      prompt: 'do it',
      approval: 'ask',
    })
    assert.deepEqual(asked.state.approvalPolicies, [])
    await askedHandle.dispose()

    // 'never' 才强制拒绝需要审批的操作。
    const forced = makeDispatchContext()
    const forcedHandle = await makeService(forced).dispatchSession({
      robot: 'writer',
      prompt: 'do it',
      approval: 'never',
    })
    assert.deepEqual(forced.state.approvalPolicies, ['never'])
    await forcedHandle.dispose()

    // 续接出来的会话遵循同一规则。
    const resumed = makeDispatchContext()
    const resumedService = makeService(resumed)
    const first = await resumedService.dispatchSession({ robot: 'writer', prompt: 'do it' })
    await first.dispose()
    const resumedHandle = await resumedService.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      approval: 'never',
    })
    assert.deepEqual(resumed.state.approvalPolicies, ['never'])
    await resumedHandle.dispose()
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
    assert.equal(fake.state.sessionListCalls, 1)
    const announced = fake.state.emitted.filter(([event]) => event === 'api-session/added')
    assert.equal(announced.length, 1)
    assert.equal(announced[0][1].sessionId, handle.sessionId)
    assert.equal(announced[0][1].agentAvailable, false)
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a missing session list or a failing list never breaks releasing the agent', async () => {
  const home = await makeRobotHome()
  try {
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

test('robots service: openSession applies plan mode before continuing the session', async () => {
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
    const opened = await service.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      planMode: true,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan'])
    assert.deepEqual(opened.getPlanMode(), { active: true })
    await opened.dispose()
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a plan node fails clearly when /plan reports an error', async () => {
  const home = await makeRobotHome()
  try {
    const planCommands = makePlanCommands({ kind: 'error' })
    const fake = makeDispatchContext({ commands: planCommands.service })
    const service = new RobotSessionService({
      ctx: fake.ctx,
      robotsDir: home.robotsDir,
      registryFile: home.registryFile,
    })
    await assert.rejects(
      () => service.dispatchSession({ robot: 'writer', prompt: 'plan it', planMode: true }),
      /plan mode could not be entered/u,
    )
    assert.equal(fake.state.followups.length, 0, 'the node does not run in normal mode')
    assert.equal(fake.state.disposed, true, 'the created agent is released')
  } finally {
    await fs.rm(home.root, { recursive: true, force: true })
  }
})

test('robots service: a plan node fails clearly when the agent cannot run /plan', async () => {
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
    assert.notEqual(fake.state.createOptions, null, 'the command entry is checked after create')
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
    assert.equal(fake.state.createOptions, null)
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

    const first = await service.dispatchSession({ robot: 'writer', prompt: 'work' })
    await first.dispose()

    // 普通节点：没有残留状态，不碰命令入口。
    const normal = await service.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      planMode: false,
    })
    assert.deepEqual(planCommands.state.lines, [])
    await normal.dispose()

    // plan 节点进入过 plan 模式：复用同一会话的普通节点先把它清掉。
    const plan = await service.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      planMode: true,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan'])
    await plan.dispose()
    const cleared = await service.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
      planMode: false,
    })
    assert.deepEqual(planCommands.state.lines, ['/plan', '/plan off'])
    await cleared.dispose()

    // 已经退出后再进入普通节点：无残留，不再重复清理。
    const again = await service.openSession({
      robot: 'writer',
      sessionId: 'dispatch-session',
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
