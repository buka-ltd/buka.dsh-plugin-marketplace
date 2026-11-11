/**
 * WorkflowSupervisor 的事件驱动测试：用一个最小的假 robots 服务 + 全局会话事件
 * 总线，验证节点 dispatch、turn/end 推进、循环、JSON/next 重试、会话中断恢复、
 * 启动恢复、取消与显式超时。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateDefinition } from '../plugins/workflows/src/definition.ts'
import { WorkflowRunStore } from '../plugins/workflows/src/run-store.ts'
import { WorkflowSupervisor } from '../plugins/workflows/src/supervisor.ts'

/**
 * 假 Host：全局事件总线 + 假 robots 服务。
 *
 * @param {{ autoFinish?: boolean, resumable?: boolean, results?: Array<Record<string, any>> }} [options]
 * @returns {Record<string, any>}
 */
function harness({
  autoFinish = true,
  resumable = true,
  results = [],
  userAnswers = [],
  approval = 'allowed-once',
  workspace = '/robot',
  planModeService = true,
  supportsPlanMode = true,
} = {}) {
  /** @type {Map<string, Array<Function>>} */
  const listeners = new Map()
  /** @type {Map<string, Record<string, any>>} */
  const sessions = new Map()
  const script = [...results]
  const userScript = [...userAnswers]
  const calls = {
    dispatch: [],
    open: [],
    sends: [],
    disposals: [],
    approval: 0,
    user: [],
    planMode: [],
  }
  let counter = 0
  let retries = 0

  const emit = (name, ...args) => {
    for (const handler of listeners.get(name) ?? []) handler(...args)
  }

  const nextResult = () =>
    script.length > 0 ? script.shift() : { text: 'done', stopReason: 'completed' }

  const makeHandle = (state, request, resumed) => {
    /** @type {Record<string, any>} */
    const handle = {
      mode: 'session',
      sessionId: state.sessionId,
      robot: request.robot,
      cwd: workspace,
      resumed,
      compacted: resumed,
      startSeq: state.turnSeq,
      readResult({ sinceSeq = 0 } = {}) {
        const result = state.result ?? { text: '', stopReason: 'completed' }
        return {
          sessionId: state.sessionId,
          text: typeof result.text === 'string' ? result.text : '',
          ...(result.structured === undefined ? {} : { structured: result.structured }),
          stopReason: typeof result.stopReason === 'string' ? result.stopReason : 'completed',
          turnEnded: state.turnEnded === true && state.turnSeq >= sinceSeq,
          turnEndSeq: state.turnSeq,
          reportSubmitted: result.structured !== undefined,
        }
      },
      retryReport({ routes = [], reason = '', detail = '', abortable = false } = {}) {
        if (retries >= 2) return null
        retries += 1
        const routeText = routes.length === 0 ? '' : ` routes=${routes.join(',')}`
        const detailText = typeof detail === 'string' && detail !== '' ? ` detail=${detail}` : ''
        const abortText = abortable ? ' abort' : ''
        return `retry-${retries} ${reason}${routeText}${detailText}${abortText}`
      },
      async send(text, { compactFirst = true } = {}) {
        calls.sends.push({ sessionId: state.sessionId, text, compactFirst })
        state.prompt = text
        state.result = nextResult()
        state.turnEnded = false
        state.turnSeq += 1
        handle.startSeq = state.turnSeq
        if (autoFinish)
          setImmediate(() => finish(state.sessionId, state.result.stopReason ?? 'completed'))
        return handle.startSeq
      },
      async cancel(reason) {
        state.cancelled = reason
        return {
          sessionId: state.sessionId,
          text: state.result?.text ?? '',
          stopReason: 'aborted',
          turnEnded: false,
        }
      },
      async dispose() {
        calls.disposals.push(state.sessionId)
        state.disposed = true
      },
      getPlanMode() {
        return planModeService ? { active: state.planMode === true } : null
      },
      setPlanMode(active) {
        if (!planModeService) return null
        state.planMode = active === true
        calls.planMode.push({ sessionId: state.sessionId, active: state.planMode })
        return 'committed'
      },
    }
    return handle
  }

  const createState = (sessionId, request) => {
    const state = {
      sessionId,
      prompt: request.prompt ?? '',
      turnSeq: 0,
      turnEnded: false,
      result: nextResult(),
      disposed: false,
      cancelled: null,
      planMode: request.planMode === true,
      request,
    }
    sessions.set(sessionId, state)
    return state
  }

  const finish = (sessionId, kind = 'completed') => {
    const state = sessions.get(sessionId)
    if (state === undefined || state.disposed === true) return
    state.turnEnded = true
    state.turnSeq += 1
    emit(
      'session/event',
      { id: sessionId },
      { type: 'turn/end', seq: state.turnSeq, data: { reason: { kind } } },
    )
  }

  const robots = {
    async dispatchSession(request) {
      calls.dispatch.push(request)
      const sessionId = request.sessionId ?? request.newSessionId ?? `session-${++counter}`
      const existing = sessions.get(sessionId)
      let state = existing
      if (state === undefined) {
        state = createState(sessionId, request)
      } else {
        state.result = nextResult()
        state.turnEnded = false
      }
      state.prompt = request.prompt
      state.disposed = false
      if (request.planMode === true || request.planMode === false) state.planMode = request.planMode
      const handle = makeHandle(state, request, existing !== undefined)
      if (autoFinish) setImmediate(() => finish(sessionId, state.result.stopReason ?? 'completed'))
      return handle
    },
    async openSession(request) {
      calls.open.push(request)
      const state = sessions.get(request.sessionId)
      if (!resumable || state === undefined) throw new Error('session cannot be resumed')
      state.disposed = false
      if (request.planMode === true || request.planMode === false) state.planMode = request.planMode
      return makeHandle(state, request, true)
    },
    supportsPlanMode,
  }

  const ctx = {
    on(name, handler) {
      const list = listeners.get(name)
      if (list === undefined) listeners.set(name, [handler])
      else list.push(handler)
      return () => {
        const current = listeners.get(name) ?? []
        const index = current.indexOf(handler)
        if (index >= 0) current.splice(index, 1)
      }
    },
    get(name) {
      if (name === 'bukaRobots') return robots
      if (name === 'approval') {
        return {
          async request() {
            calls.approval += 1
            return approval
          },
        }
      }
      if (name === 'userQuestions') {
        return {
          async ask(request) {
            calls.user.push(request)
            const answer = userScript.length > 0 ? userScript.shift() : { answers: [] }
            if (answer instanceof Error) throw answer
            return answer
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }

  return {
    ctx,
    robots,
    calls,
    sessions,
    finish,
    dispose(sessionId) {
      const state = sessions.get(sessionId)
      if (state !== undefined) state.disposed = true
      emit('session/disposed', { id: sessionId })
    },
    result(sessionId, result) {
      const state = sessions.get(sessionId)
      if (state !== undefined) {
        state.result = result
        state.turnEnded = false
      }
    },
    emit,
  }
}

/**
 * @returns {Promise<{ store: WorkflowRunStore, dir: string }>}
 */
async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-supervisor-'))
  const store = new WorkflowRunStore({ dir })
  await store.init()
  return { store, dir }
}

/**
 * @param {Record<string, any>} definition
 * @returns {Record<string, any>}
 */
function planOf(definition) {
  const parsed = validateDefinition(definition)
  assert.equal(
    parsed.ok,
    true,
    parsed.errors.map((error) => `${error.path}: ${error.message}`).join('; '),
  )
  return parsed.plan
}

/**
 * @param {() => Promise<boolean>} predicate
 * @param {string} label
 * @returns {Promise<void>}
 */
async function waitFor(predicate, label = 'condition') {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for ${label}`)
}

const SIMPLE = {
  goal: '顺序执行',
  maxSteps: 10,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'work', name: '开始', prompt: 'do the work' }] },
    {
      id: 'work',
      type: 'robot',
      robot: 'writer',
      summary: '干活',
      output: { type: 'object', properties: { summary: { type: 'string' } } },
      agentOptions: { provider: 'test-provider', model: 'test-model' },
      next: [{ to: 'done', name: '完成' }],
    },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

const LOOP = {
  goal: '循环',
  maxSteps: 20,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'check', name: '开始', prompt: 'check it' }] },
    {
      id: 'check',
      type: 'robot',
      robot: 'reviewer',
      output: { type: 'object', properties: {} },
      maxVisits: 5,
      next: [
        { to: 'done', name: '通过' },
        { to: 'fix', name: '打回', prompt: 'fix it' },
      ],
    },
    {
      id: 'fix',
      type: 'robot',
      robot: 'fixer',
      output: { type: 'object', properties: {} },
      next: [{ to: 'check', name: '修好了', prompt: 'check again' }],
    },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

test('supervisor: a turn/end event advances the run without an awaited session result', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [{ text: 'work done', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'run completion',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].text, 'work done')
    assert.equal(run.sessions.length, 1)
    assert.equal(run.sessions[0].entries.length, 1)
    assert.equal(run.sessions[0].entries[0].nodeId, 'work')
    assert.deepEqual(host.calls.dispatch[0].agentOptions, {
      provider: 'test-provider',
      model: 'test-model',
    })
    assert.equal(host.calls.dispatch[0].approval, 'ask')
    assert.equal('report' in host.calls.dispatch[0], false)
    assert.equal(host.calls.dispatch[0].outputSchema.required, undefined)
    assert.deepEqual(
      host.calls.dispatch[0].outputSchema.properties.next.oneOf.map((branch) => branch.type),
      ['string', 'array'],
    )
    assert.deepEqual(host.calls.dispatch[0].outputSchema.properties.next.oneOf[0].enum, ['完成'])
    assert.equal(host.calls.dispatch[0].outputSchema.properties.abort.type, 'string')
    assert.equal(host.calls.dispatch[0].outputSchema.properties.summary.type, 'string')
    assert.equal(host.calls.dispatch[0].outputSchema.properties.attachments.type, 'array')
    assert.match(
      host.calls.dispatch[0].outputSchema.properties.attachments.description,
      /independent data or files/,
    )
    assert.equal(run.steps[0].route, '完成')
    assert.equal(run.steps[0].routeTo, 'done')
    const results = await store.readNodeResults(started.runId)
    assert.ok(results[0].prompt.startsWith('do the work\n\n---\nResult contract'))
    assert.match(results[0].prompt, /"summary"/)
    assert.match(results[0].prompt, /final assistant text/)
    assert.match(results[0].prompt, /not a place for the answer itself/)
    assert.equal(results[0].text, 'work done')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: indexes robot sessions from persisted runs for read-only tools', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [{ text: 'work done', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const first = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    first.attachRobots(host.robots)
    const started = await first.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'index run completion',
    )
    const completed = await store.readRun(started.runId)
    const sessionId = completed.steps[0].sessionId
    assert.equal(typeof sessionId, 'string')
    assert.deepEqual(first.sessionRun(sessionId), { runId: started.runId })

    // 模拟 DSH 重启后重新打开已结束的机器人会话：新观察者从落盘记录重建索引。
    const second = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    second.attachRobots(host.robots)
    assert.equal(second.sessionRun(sessionId), null, 'index is built lazily / on startup')
    await second.ensureSessionIndex()
    assert.deepEqual(second.sessionRun(sessionId), { runId: started.runId })
    assert.equal(
      second.sessionRun('root'),
      null,
      'the creating root session is not a robot session',
    )
    await second.dispose()
    await first.dispose()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: session index falls back to steps when sessions is missing', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = SIMPLE
    const now = Date.now()
    const run = {
      version: 2,
      runId: 'wf-steps-only',
      seq: 1,
      goal: '旧记录',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
      createdBy: { sessionId: 'root' },
      current: null,
      pendingUser: null,
      pendingInteraction: null,
      steps: [
        {
          seq: 1,
          nodeId: 'work',
          visit: 1,
          type: 'robot',
          robot: 'writer',
          sessionId: 'session-steps',
          status: 'completed',
          stopReason: 'completed',
          startedAt: now,
          finishedAt: now,
          text: 'done',
        },
      ],
      sessions: [],
      result: { status: 'completed', lastNode: 'done' },
      error: null,
    }
    await store.create({ run, definition, plan: planOf(definition) })
    const host = harness()
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.ensureSessionIndex()
    assert.deepEqual(supervisor.sessionRun('session-steps'), { runId: 'wf-steps-only' })
    await supervisor.dispose()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: node results record prompt and text truncation flags', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [{ text: 'x'.repeat(40), structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({
      ctx: host.ctx,
      store,
      logger: host.ctx.logger,
      options: { maxNodeTextBytes: 8 },
    })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'truncation flags',
    )
    const persisted = await store.readNodeResults(started.runId)
    assert.equal(persisted[0].prompt, 'do the w')
    assert.equal(persisted[0].promptTruncated, true)
    assert.equal(persisted[0].text, 'xxxxxxxx')
    assert.equal(persisted[0].textTruncated, true)
    assert.equal((await store.readNodeResult(started.runId, 1, 'work')).textTruncated, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: node attachments are copied, recorded and embedded into the next prompt', async () => {
  const { store, dir } = await makeStore()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-supervisor-workspace-'))
  /** @type {WorkflowSupervisor | null} */
  let supervisor = null
  try {
    await fs.mkdir(path.join(workspace, 'notes'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'notes', 'result.md'), 'ATTACHMENT-CONTENT\n', 'utf8')
    const definition = {
      goal: '附件传递',
      maxSteps: 10,
      nodes: [
        {
          id: 'start',
          type: 'start',
          next: [{ to: 'dev', name: '开始', prompt: 'produce the note' }],
        },
        {
          id: 'dev',
          type: 'robot',
          robot: 'writer',
          output: { type: 'object', properties: {} },
          next: [
            {
              to: 'review',
              name: '交稿',
              prompt:
                'read {{nodes.dev.attachments.0.text}} from {{nodes.dev.attachments.0.path}} ({{nodes.dev.attachments.0.name}})',
            },
          ],
        },
        {
          id: 'review',
          type: 'robot',
          robot: 'reviewer',
          output: { type: 'object', properties: {} },
          next: [{ to: 'done', name: '完成' }],
        },
        { id: 'done', type: 'end', status: 'completed' },
      ],
    }
    const host = harness({
      workspace,
      results: [
        {
          text: 'wrote it',
          structured: {
            next: '交稿',
            attachments: [{ path: 'notes/result.md', name: 'result.md', description: 'note' }],
          },
          stopReason: 'completed',
        },
        { text: 'reviewed', structured: { next: '完成' }, stopReason: 'completed' },
      ],
    })
    supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'attachment run completion',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 2)
    assert.deepEqual(run.steps[0].attachments, [
      {
        index: 0,
        name: 'result.md',
        bytes: Buffer.byteLength('ATTACHMENT-CONTENT\n'),
        description: 'note',
      },
    ])
    assert.deepEqual(run.steps[0].data.attachments, run.steps[0].attachments)
    assert.equal(host.calls.dispatch.length, 2)
    assert.match(host.calls.dispatch[1].prompt, /ATTACHMENT-CONTENT/)
    assert.match(host.calls.dispatch[1].prompt, /result\.md/)
    const results = await store.readNodeResults(started.runId)
    assert.deepEqual(results[0].attachments, run.steps[0].attachments)
    const attachment = await store.readAttachment(started.runId, 1, 'dev', 'result.md')
    assert.equal(attachment.text, 'ATTACHMENT-CONTENT\n')
    assert.equal(attachment.binary, false)
    assert.match(host.calls.dispatch[0].outputSchema.properties.attachments.description, /files/)
  } finally {
    await supervisor?.dispose()
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('supervisor: a missing attachment path fails the node with a clear error', async () => {
  const { store, dir } = await makeStore()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-supervisor-workspace-'))
  try {
    const host = harness({
      workspace,
      results: [
        {
          text: 'wrote it',
          structured: { next: '完成', attachments: ['missing.md'] },
          stopReason: 'completed',
        },
      ],
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(SIMPLE),
      definition: SIMPLE,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'attachment failure',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps[0].status, 'failed')
    assert.deepEqual(run.steps[0].attachments, [])
    assert.match(run.error, /could not store node attachments/)
    assert.match(run.error, /missing\.md/)
    await supervisor.dispose()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('supervisor: a loop records every entry of the same node in steps and session entries', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: '问题 1', structured: { next: '打回', ok: false }, stopReason: 'completed' },
        { text: '已修 1', structured: { next: '修好了' }, stopReason: 'completed' },
        { text: '问题 2', structured: { next: '打回', ok: false }, stopReason: 'completed' },
        { text: '已修 2', structured: { next: '修好了' }, stopReason: 'completed' },
        { text: '通过', structured: { next: '通过', ok: true }, stopReason: 'completed' },
      ],
    })
    const definition = LOOP
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'loop completion',
    )
    const run = await store.readRun(started.runId)
    assert.deepEqual(
      run.steps.map((step) => `${step.nodeId}:${step.visit}`),
      ['check:1', 'fix:1', 'check:2', 'fix:2', 'check:3'],
    )
    // 同一个 robot 复用同一个会话，entries 仍记录每次进入。
    const reviewer = run.sessions.find((session) => session.robot === 'reviewer')
    assert.ok(reviewer)
    assert.equal(reviewer.sessionId, run.steps[0].sessionId)
    assert.equal(reviewer.entries.length, 3)
    assert.deepEqual(
      reviewer.entries.map((entry) => `${entry.nodeId}:${entry.visit}`),
      ['check:1', 'check:2', 'check:3'],
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a node missing JSON is asked again in the same session', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'plain text', stopReason: 'completed' },
        { text: '{"next":"完成"}', structured: { next: '完成' }, stopReason: 'completed' },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'result retry',
    )
    const run = await store.readRun(started.runId)
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /next|JSON/i)
    assert.deepEqual(run.steps[0].data, { next: '完成' })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a disposed session is resumed and the node continues', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      autoFinish: false,
      results: [{ text: 'first', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    const sessionId = started.run.active[0].sessionId
    assert.equal(typeof sessionId, 'string')
    host.dispose(sessionId)
    await waitFor(async () => {
      const run = await store.readRun(started.runId)
      return run?.active?.[0]?.recovering === true || run?.active?.[0]?.recoveryAttempts > 0
    }, 'recovery start')
    // openSession 后 send 一条恢复 prompt；让它在同一会话里完成。
    host.result(sessionId, {
      text: 'continued',
      structured: { next: '完成' },
      stopReason: 'completed',
    })
    host.finish(sessionId)
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'recovered completion',
    )
    const run = await store.readRun(started.runId)
    assert.equal(host.calls.open.length, 1)
    assert.equal(
      host.calls.open[0].planMode,
      false,
      'a normal node clears stale plan mode on recovery',
    )
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /interrupted/i)
    assert.equal(run.steps[0].text, 'continued')
    assert.equal(run.steps[0].recovered, true)
    assert.equal(run.steps[0].recoveryAttempts, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a disposed session that cannot reopen terminates the run without a new session', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({ autoFinish: false, resumable: false })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    const sessionId = started.run.active[0].sessionId
    host.dispose(sessionId)
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'recovery failure',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].stopReason, 'error')
    assert.match(run.steps[0].error, /could not resume robot session/)
    assert.match(run.steps[0].error, /without opening a new session/)
    assert.equal(host.calls.open.length, 1)
    assert.equal(host.calls.dispatch.length, 1, 'no replacement session is dispatched')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a robot session creation failure fails the run with the service error', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness()
    let attempts = 0
    host.robots.dispatchSession = async () => {
      attempts += 1
      throw new Error(
        'could not create a visible robot session for robot "writer": normal robot sessions are unavailable; refusing to fall back to a hidden subagent or a replacement session',
      )
    }
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'creation failure',
    )
    const run = await store.readRun(started.runId)
    assert.match(run.error, /could not create a visible robot session/)
    assert.match(run.error, /refusing to fall back/)
    assert.equal(attempts, 1, 'the supervisor does not retry with another session')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a substitute session from an old robots service is rejected', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness()
    const dispatch = host.robots.dispatchSession.bind(host.robots)
    host.robots.dispatchSession = async (request) => ({
      ...(await dispatch(request)),
      resumed: false,
      resumeError: 'session is missing',
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'substitute rejection',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].stopReason, 'error')
    assert.match(run.steps[0].error, /replaced an unresumable robot session/)
    assert.match(run.steps[0].error, /without opening a new session/)
    assert.equal(host.calls.disposals.length, 1, 'the replacement handle is released')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a hidden subagent handle fails the node instead of being scheduled', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness()
    const dispatch = host.robots.dispatchSession.bind(host.robots)
    host.robots.dispatchSession = async (request) => ({
      ...(await dispatch(request)),
      mode: 'subagent',
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'hidden handle failure',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].stopReason, 'error')
    assert.match(run.steps[0].error, /hidden subagent session/)
    assert.equal(host.calls.disposals.length, 1, 'the hidden handle is released')
    assert.equal(host.calls.dispatch.length, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: resumeAll finalizes a turn that completed before the restart', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = SIMPLE
    const plan = planOf(definition)
    const run = {
      version: 1,
      runId: 'wf-recover-completed',
      seq: 1,
      goal: '恢复',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      current: {
        nodeId: 'work',
        visit: 1,
        seq: 1,
        type: 'robot',
        robot: 'writer',
        prompt: 'do the work',
        sessionId: 'session-recover',
        startSeq: 0,
        startedAt: 1,
        attempt: 1,
        recoveryAttempts: 0,
      },
      pendingUser: null,
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness({
      autoFinish: false,
      results: [{ text: 'already done', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    host.sessions.set('session-recover', {
      sessionId: 'session-recover',
      prompt: 'do the work',
      turnSeq: 1,
      turnEnded: true,
      result: { text: 'already done', structured: { next: '完成' }, stopReason: 'completed' },
      disposed: false,
      cancelled: null,
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    await waitFor(
      async () => (await store.readRun(run.runId))?.status === 'completed',
      'host recovery',
    )
    const persisted = await store.readRun(run.runId)
    assert.equal(persisted.steps.length, 1)
    assert.equal(persisted.steps[0].text, 'already done')
    assert.equal(persisted.steps[0].recovered, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: cancel stops the run and ignores late turns', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      autoFinish: false,
      results: [{ text: 'slow', stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    const sessionId = started.run.active[0].sessionId
    assert.equal(await supervisor.cancel(started.runId), true)
    const run = await store.readRun(started.runId)
    assert.equal(run.status, 'cancelled')
    host.finish(sessionId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal((await store.readRun(started.runId)).steps.length, 0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: no timer by default; an explicit timeout cancels the node', async () => {
  const { store, dir } = await makeStore()
  try {
    // 默认不超时：等 80ms 仍然 running。
    const host = harness({
      autoFinish: false,
      results: [{ text: 'long', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal((await store.readRun(started.runId)).status, 'running')
    const sessionId = started.run.active[0].sessionId
    host.result(sessionId, {
      text: 'long done',
      structured: { next: '完成' },
      stopReason: 'completed',
    })
    host.finish(sessionId)
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'default no timeout',
    )

    // 显式 timeoutMs：节点失败并标 timedOut。
    const explicit = {
      ...SIMPLE,
      nodes: SIMPLE.nodes.map((node) => (node.id === 'work' ? { ...node, timeoutMs: 20 } : node)),
    }
    const slowHost = harness({
      autoFinish: false,
      results: [{ text: 'slow', stopReason: 'completed' }],
    })
    const second = new WorkflowSupervisor({ ctx: slowHost.ctx, store, logger: slowHost.ctx.logger })
    second.attachRobots(slowHost.robots)
    const timed = await second.start({
      plan: planOf(explicit),
      definition: explicit,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(timed.runId))?.status === 'failed',
      'explicit timeout',
    )
    const timedRun = await store.readRun(timed.runId)
    assert.equal(timedRun.steps[0].timedOut, true)
    assert.equal(timedRun.steps[0].stopReason, 'timeout')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

const USER = {
  goal: '确认后发布',
  maxSteps: 10,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'prepare', name: '开始', prompt: 'prepare' }] },
    {
      id: 'prepare',
      type: 'robot',
      robot: 'writer',
      output: { type: 'object', properties: {} },
      next: [{ to: 'confirm', name: '准备完成' }],
    },
    {
      id: 'confirm',
      type: 'user',
      title: '发布确认',
      detail: '是否发布？',
      next: [
        {
          to: 'publish',
          name: 'approve',
          label: '同意发布',
          description: '直接发布',
          prompt: 'publish it',
        },
        { to: 'done', name: 'reject', label: '取消' },
      ],
      questions: [{ id: 'notes', header: '备注', question: '还有什么要说明？' }],
    },
    {
      id: 'publish',
      type: 'robot',
      robot: 'publisher',
      output: { type: 'object', properties: {} },
      next: [{ to: 'done', name: '完成' }],
    },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

test('supervisor: user runs foreground, waits for the user and continues', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'prepared', structured: { next: '准备完成' }, stopReason: 'completed' },
        { text: 'published', structured: { next: '完成' }, stopReason: 'completed' },
      ],
      userAnswers: [
        {
          answers: [
            { id: 'route', selected: ['同意发布'] },
            { id: 'notes', selected: [], custom: '记得发公告' },
          ],
        },
      ],
    })
    const definition = USER
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const run = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'foreground',
    })
    assert.equal(run.status, 'completed')
    assert.equal(host.calls.approval, 0)
    assert.equal(host.calls.user.length, 1)
    assert.deepEqual(
      host.calls.user[0].questions.map((question) => question.id),
      ['route', 'notes'],
    )
    assert.deepEqual(host.calls.user[0].questions[0].options, [
      { label: '同意发布', description: '直接发布' },
      { label: '取消' },
    ])
    const userStep = run.steps.find((step) => step.nodeId === 'confirm')
    assert.equal(userStep.type, 'user')
    assert.equal(userStep.status, 'completed')
    assert.equal(userStep.route, 'approve')
    assert.equal(userStep.routeTo, 'publish')
    assert.deepEqual(userStep.answers, [
      { id: 'route', selected: ['同意发布'], custom: '' },
      { id: 'notes', selected: [], custom: '记得发公告' },
    ])
    assert.match(userStep.text, /选择：同意发布/u)
    assert.equal(run.steps.find((step) => step.nodeId === 'publish').text, 'published')
    const persisted = await store.readRun(run.runId)
    assert.equal(persisted.status, 'completed')
    assert.equal(persisted.pendingUser, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a user definition cannot start in background mode', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness()
    const definition = USER
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await assert.rejects(
      () =>
        supervisor.start({
          plan: planOf(definition),
          definition,
          agent: { id: 'root' },
          mode: 'background',
        }),
      /user node/i,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a skipped user choice cancels the run', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [{ text: 'prepared', structured: { next: '准备完成' }, stopReason: 'completed' }],
      userAnswers: [
        {
          answers: [
            { id: 'route', selected: [] },
            { id: 'notes', selected: [], custom: '再想想' },
          ],
        },
      ],
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const run = await supervisor.start({
      plan: planOf(USER),
      definition: USER,
      agent: { id: 'root' },
      mode: 'foreground',
    })
    assert.equal(run.status, 'cancelled')
    const userStep = run.steps.find((step) => step.nodeId === 'confirm')
    assert.equal(userStep.status, 'cancelled')
    assert.equal(userStep.route, null)
    assert.match(run.result.message, /submitted without a choice/u)
    assert.equal(
      run.steps.some((step) => step.nodeId === 'publish'),
      false,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a missing user-questions answerer fails the run with a clear error', async () => {
  const { store, dir } = await makeStore()
  try {
    const error = new Error('no user-questions answerer accepted the request')
    error.code = 'NO_PROVIDER'
    const host = harness({
      results: [{ text: 'prepared', structured: { next: '准备完成' }, stopReason: 'completed' }],
      userAnswers: [error],
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const run = await supervisor.start({
      plan: planOf(USER),
      definition: USER,
      agent: { id: 'root' },
      mode: 'foreground',
    })
    assert.equal(run.status, 'failed')
    assert.match(run.error, /no user-questions answerer/u)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: restart recovery rehydrates attachments into the next prompt', async () => {
  const { store, dir } = await makeStore()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-supervisor-workspace-'))
  try {
    const definition = {
      goal: '恢复附件',
      maxSteps: 10,
      nodes: [
        { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: 'make a note' }] },
        {
          id: 'dev',
          type: 'robot',
          robot: 'writer',
          output: { type: 'object', properties: {} },
          next: [{ to: 'review', name: '交稿', prompt: 'read {{nodes.dev.attachments.0.text}}' }],
        },
        {
          id: 'review',
          type: 'robot',
          robot: 'reviewer',
          output: { type: 'object', properties: {} },
          next: [{ to: 'done', name: '完成' }],
        },
        { id: 'done', type: 'end', status: 'completed' },
      ],
    }
    await fs.writeFile(path.join(workspace, 'note.md'), 'RESTART-CONTENT\n', 'utf8')
    const plan = planOf(definition)
    const manifest = await store.writeNodeAttachments('wf-recover-attach', 1, 'dev', ['note.md'], {
      workspace,
    })
    await store.saveNodeResult('wf-recover-attach', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'make a note',
      text: 'note written',
      structured: { next: '交稿', attachments: manifest },
      attachments: manifest,
      status: 'completed',
      stopReason: 'completed',
    })
    const now = Date.now()
    const run = {
      version: 2,
      runId: 'wf-recover-attach',
      seq: 1,
      goal: '恢复附件',
      status: 'running',
      createdAt: now - 1000,
      updatedAt: now,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      current: null,
      pendingUser: null,
      pendingInteraction: null,
      steps: [
        {
          seq: 1,
          nodeId: 'dev',
          visit: 1,
          type: 'robot',
          robot: 'writer',
          sessionId: 'session-dev',
          status: 'completed',
          stopReason: 'completed',
          route: '交稿',
          routeTo: 'review',
          startedAt: now - 900,
          finishedAt: now - 500,
          text: 'note written',
          data: { next: '交稿', attachments: manifest },
          attachments: manifest,
        },
      ],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness({
      workspace,
      results: [{ text: 'reviewed', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    await waitFor(
      async () => (await store.readRun(run.runId))?.status === 'completed',
      'recovered attachment',
    )
    assert.equal(host.calls.dispatch.length, 1)
    assert.match(host.calls.dispatch[0].prompt, /RESTART-CONTENT/)
    await supervisor.dispose()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('supervisor: resumeAll sends a continuation prompt for a turn that never finished', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = SIMPLE
    const plan = planOf(definition)
    const run = {
      version: 1,
      runId: 'wf-recover-unfinished',
      seq: 2,
      goal: '恢复未完成',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      current: {
        nodeId: 'work',
        visit: 1,
        seq: 1,
        type: 'robot',
        robot: 'writer',
        prompt: 'do the work',
        sessionId: 'session-unfinished',
        startSeq: 0,
        startedAt: 1,
        attempt: 1,
        recoveryAttempts: 0,
      },
      pendingUser: null,
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness({
      results: [{ text: 'continued', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    host.sessions.set('session-unfinished', {
      sessionId: 'session-unfinished',
      prompt: 'do the work',
      turnSeq: 0,
      turnEnded: false,
      result: { text: '', stopReason: 'completed' },
      disposed: false,
      cancelled: null,
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    await waitFor(
      async () => (await store.readRun(run.runId))?.status === 'completed',
      'unfinished recovery',
    )
    const persisted = await store.readRun(run.runId)
    assert.equal(host.calls.open.length, 1)
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /host restarted/i)
    assert.equal(persisted.steps[0].text, 'continued')
    assert.equal(persisted.steps[0].recovered, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: resumeAll interrupts a run that cannot reopen its session, without a new session', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = SIMPLE
    const plan = planOf(definition)
    const run = {
      version: 1,
      runId: 'wf-recover-unreachable',
      seq: 3,
      goal: '无法恢复',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      current: {
        nodeId: 'work',
        visit: 1,
        seq: 1,
        type: 'robot',
        robot: 'writer',
        prompt: 'do the work',
        sessionId: 'session-unreachable',
        startSeq: 0,
        startedAt: 1,
        attempt: 1,
        recoveryAttempts: 0,
      },
      pendingUser: null,
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness({ resumable: false })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    const persisted = await store.readRun(run.runId)
    assert.equal(persisted.status, 'interrupted')
    assert.match(persisted.error, /without opening a new session/)
    assert.equal(host.calls.open.length, 1)
    assert.equal(host.calls.dispatch.length, 0, 'no replacement session is dispatched')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: resumeAll interrupts a user run because the question cannot be recreated', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = USER
    const plan = planOf(definition)
    const run = {
      version: 1,
      runId: 'wf-recover-user',
      seq: 1,
      goal: '用户介入恢复',
      status: 'waiting',
      createdAt: 1,
      updatedAt: 1,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      current: { nodeId: 'confirm', visit: 1, seq: 2, type: 'user', robot: null, startedAt: 1 },
      pendingUser: { nodeId: 'confirm', title: '发布确认', requestedAt: 1 },
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness()
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    const persisted = await store.readRun(run.runId)
    assert.equal(persisted.status, 'interrupted')
    assert.match(persisted.error, /user|question/i)
    assert.equal(persisted.pendingUser, null)
    assert.equal(host.calls.user.length, 0, 'no question is re-asked after a restart')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: resumeAll interrupts an old run without observer recovery data', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = SIMPLE
    const plan = planOf(definition)
    const run = {
      version: 1,
      runId: 'wf-recover-predates-observer',
      seq: 1,
      goal: '旧记录',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      // 旧版运行：current 没有 prompt / sessionId，无法安全恢复。
      current: { nodeId: 'work', visit: 1, seq: 1, type: 'robot', robot: 'writer', startedAt: 1 },
      pendingUser: null,
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness()
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    const persisted = await store.readRun(run.runId)
    assert.equal(persisted.status, 'interrupted')
    assert.match(persisted.error, /predates|recovery/i)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a missing next is retried in the same session', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'no route', structured: {}, stopReason: 'completed' },
        { text: 'routed', structured: { next: '完成' }, stopReason: 'completed' },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'missing next retry',
    )
    const run = await store.readRun(started.runId)
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /next/i)
    assert.equal(run.steps[0].route, '完成')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: an unknown next is retried with the allowed routes', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'bad route', structured: { next: 'nope' }, stopReason: 'completed' },
        { text: 'routed', structured: { next: '完成' }, stopReason: 'completed' },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'unknown next retry',
    )
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /完成/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

const REQUIRED_OUTPUT = {
  goal: '输出 schema',
  maxSteps: 10,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'work', name: '开始', prompt: 'do the work' }] },
    {
      id: 'work',
      type: 'robot',
      robot: 'writer',
      output: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
      next: [{ to: 'done', name: '完成' }],
    },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

test('supervisor: a result that does not match the declared output is retried in the same session', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'bad shape', structured: { next: '完成' }, stopReason: 'completed' },
        { text: 'fixed', structured: { next: '完成', summary: 'done' }, stopReason: 'completed' },
      ],
    })
    const definition = REQUIRED_OUTPUT
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'invalid output retry',
    )
    const run = await store.readRun(started.runId)
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /invalid-output/)
    assert.match(host.calls.sends[0].text, /detail=summary: missing required field/)
    assert.equal(run.steps[0].status, 'completed')
    assert.equal(run.steps[0].data.summary, 'done')
    assert.equal(run.steps[0].route, '完成')
    assert.deepEqual(host.calls.dispatch[0].outputSchema.required, ['summary'])
    assert.equal(host.calls.dispatch[0].outputSchema.properties.abort.type, 'string')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: exhausting the retries for an invalid output fails the node with the field problem', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'bad 1', structured: { next: '完成' }, stopReason: 'completed' },
        { text: 'bad 2', structured: { next: '完成' }, stopReason: 'completed' },
        { text: 'bad 3', structured: { next: '完成' }, stopReason: 'completed' },
      ],
    })
    const definition = REQUIRED_OUTPUT
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'invalid output exhaustion',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps[0].status, 'failed')
    assert.match(run.steps[0].error, /invalid workflow output for node "work"/)
    assert.match(run.steps[0].error, /summary: missing required field/)
    assert.equal(run.steps[0].route, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: pending question and approval are recorded and cleared', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      autoFinish: false,
      results: [{ text: 'waiting', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    const sessionId = started.run.active[0].sessionId

    let releaseQuestion
    const questionAnswer = new Promise((resolve) => {
      releaseQuestion = resolve
    })
    host.emit(
      'user-questions/request',
      { agent: { id: sessionId }, questions: [{ id: 'q1', header: '确认', question: '继续吗？' }] },
      () => questionAnswer,
    )
    await waitFor(
      async () => (await store.readRun(started.runId))?.pendingInteraction?.kind === 'question',
      'question record',
    )
    const withQuestion = await store.readRun(started.runId)
    assert.equal(withQuestion.pendingInteraction.questions[0].question, '继续吗？')
    releaseQuestion({ answers: [] })
    await waitFor(
      async () => (await store.readRun(started.runId))?.pendingInteraction === null,
      'question cleared',
    )

    let releaseApproval
    const approvalAnswer = new Promise((resolve) => {
      releaseApproval = resolve
    })
    host.emit(
      'approval/request',
      { agent: { id: sessionId }, toolName: 'bash', reason: 'needs permission' },
      () => approvalAnswer,
    )
    await waitFor(
      async () => (await store.readRun(started.runId))?.pendingInteraction?.kind === 'approval',
      'approval record',
    )
    const withApproval = await store.readRun(started.runId)
    assert.equal(withApproval.pendingInteraction.toolName, 'bash')
    releaseApproval('allowed-once')
    await waitFor(
      async () => (await store.readRun(started.runId))?.pendingInteraction === null,
      'approval cleared',
    )

    await supervisor.cancel(started.runId)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a valid abort ends the run as failed without following an edge', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        {
          text: 'cannot',
          structured: { abort: '缺少访问生产环境的凭据' },
          stopReason: 'completed',
        },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'aborted run',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].status, 'failed')
    assert.equal(run.steps[0].stopReason, 'aborted')
    assert.equal(run.steps[0].aborted, true)
    assert.equal(run.steps[0].route, null)
    assert.equal(run.steps[0].routeTo, null)
    assert.equal(run.steps[0].error, '缺少访问生产环境的凭据')
    assert.equal(run.result.status, 'failed')
    assert.equal(run.result.aborted, true)
    assert.match(run.error, /workflow node "work" aborted the run/u)
    assert.match(run.error, /缺少访问生产环境的凭据/u)
    assert.equal(host.calls.dispatch.length, 1, 'no next node is dispatched')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: abort does not need the declared output fields', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [{ text: 'cannot', structured: { abort: '输出无法生成' }, stopReason: 'completed' }],
    })
    const definition = {
      goal: '严格输出',
      maxSteps: 10,
      nodes: [
        { id: 'start', type: 'start', next: [{ to: 'work', name: '开始', prompt: 'do the work' }] },
        {
          id: 'work',
          type: 'robot',
          robot: 'writer',
          output: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
            additionalProperties: false,
          },
          next: [{ to: 'done', name: '完成' }],
        },
        { id: 'done', type: 'end', status: 'completed' },
      ],
    }
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'aborted strict output',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps[0].aborted, true)
    assert.equal(run.steps[0].error, '输出无法生成')
    assert.equal(run.result.aborted, true)
    assert.equal(host.calls.sends.length, 0, 'abort bypasses the declared output validation')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: abort on a terminal robot node fails instead of completing', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'cannot', structured: { abort: '没有可用的数据源' }, stopReason: 'completed' },
      ],
    })
    const definition = {
      goal: '终止节点主动终止',
      maxSteps: 10,
      nodes: [
        { id: 'start', type: 'start', next: [{ to: 'work', name: '开始', prompt: 'do the work' }] },
        {
          id: 'work',
          type: 'robot',
          robot: 'writer',
          output: { type: 'object', properties: {} },
        },
      ],
    }
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'terminated abort',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps[0].aborted, true)
    assert.equal(run.result.aborted, true)
    assert.match(run.error, /没有可用的数据源/u)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: next and abort together are retried in the same session', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'both', structured: { next: '完成', abort: '继续不了' }, stopReason: 'completed' },
        { text: 'abort', structured: { abort: '继续不了' }, stopReason: 'completed' },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'ambiguous abort retry',
    )
    const run = await store.readRun(started.runId)
    assert.equal(host.calls.sends.length, 1)
    assert.match(host.calls.sends[0].text, /ambiguous-result/u)
    assert.match(host.calls.sends[0].text, /abort/u)
    assert.equal(run.steps[0].aborted, true)
    assert.equal(run.steps[0].error, '继续不了')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: an empty abort reason is retried, then fails as invalid output', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'bad', structured: { abort: '' }, stopReason: 'completed' },
        { text: 'bad', structured: { abort: '   ' }, stopReason: 'completed' },
        { text: 'bad', structured: { abort: '' }, stopReason: 'completed' },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'invalid abort exhausted',
    )
    const run = await store.readRun(started.runId)
    assert.equal(host.calls.sends.length, 2)
    assert.match(host.calls.sends[0].text, /invalid-abort/u)
    assert.match(run.error, /invalid workflow result/u)
    assert.match(run.error, /non-empty reason/u)
    assert.equal(run.steps[0].aborted, undefined)
    assert.equal(run.result.aborted, undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: resumeAll finalizes a completed abort result as an aborted run', async () => {
  const { store, dir } = await makeStore()
  try {
    const definition = SIMPLE
    const plan = planOf(definition)
    const run = {
      version: 1,
      runId: 'wf-recover-abort',
      seq: 1,
      goal: '恢复主动终止',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      finishedAt: null,
      createdBy: { sessionId: 'root' },
      current: {
        nodeId: 'work',
        visit: 1,
        seq: 1,
        type: 'robot',
        robot: 'writer',
        prompt: 'do the work',
        sessionId: 'session-recover-abort',
        startSeq: 0,
        startedAt: 1,
        attempt: 1,
        recoveryAttempts: 0,
      },
      pendingUser: null,
      steps: [],
      sessions: [],
      result: null,
      error: null,
    }
    await store.create({ run, definition, plan })
    const host = harness({ autoFinish: false })
    host.sessions.set('session-recover-abort', {
      sessionId: 'session-recover-abort',
      prompt: 'do the work',
      turnSeq: 1,
      turnEnded: true,
      result: {
        text: 'cannot',
        structured: { abort: '恢复后发现无法完成' },
        stopReason: 'completed',
      },
      disposed: false,
      cancelled: null,
    })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    await supervisor.resumeAll()
    await waitFor(
      async () => (await store.readRun(run.runId))?.status === 'failed',
      'recovered abort',
    )
    const persisted = await store.readRun(run.runId)
    assert.equal(persisted.steps.length, 1)
    assert.equal(persisted.steps[0].recovered, true)
    assert.equal(persisted.steps[0].aborted, true)
    assert.equal(persisted.result.aborted, true)
    assert.match(persisted.error, /恢复后发现无法完成/u)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a valid abort wins over session recovery', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        {
          text: 'cannot',
          structured: { abort: '会话断开前已确认无法继续' },
          stopReason: 'aborted',
        },
      ],
    })
    const definition = SIMPLE
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'abort before recovery',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps[0].aborted, true)
    assert.equal(run.result.aborted, true)
    assert.equal(host.calls.open.length, 0, 'the session is not resumed when it already aborted')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 并发 fan-out + join
// ---------------------------------------------------------------------------

const CONCURRENT = {
  goal: '并行开发',
  maxSteps: 20,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'plan', name: '开始', prompt: '规划并行任务。' }] },
    {
      id: 'plan',
      type: 'robot',
      robot: 'planner',
      output: { type: 'object', properties: {} },
      next: [
        { to: 't1', name: 'a', prompt: '任务一。' },
        { to: 't2', name: 'b', prompt: '任务二。' },
        { to: 't3', name: 'c', prompt: '任务三。' },
      ],
    },
    { id: 't1', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 't2', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 't3', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 'merge', type: 'join', inputs: ['t1', 't2', 't3'], next: [{ to: 'done' }] },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

test('supervisor: fan-out runs tasks concurrently and the join fires after all inputs', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'planned', structured: { next: ['a', 'b', 'c'] }, stopReason: 'completed' },
        { text: 't1', structured: {}, stopReason: 'completed' },
        { text: 't2', structured: {}, stopReason: 'completed' },
        { text: 't3', structured: {}, stopReason: 'completed' },
      ],
    })
    const definition = CONCURRENT
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'concurrent completion',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 4, 'planner + 3 tasks')
    assert.deepEqual(
      run.steps.map((step) => step.nodeId),
      ['plan', 't1', 't2', 't3'],
    )
    // planner fan-out 记录了三条例全部出口。
    assert.deepEqual(run.steps[0].routes, [
      { name: 'a', to: 't1' },
      { name: 'b', to: 't2' },
      { name: 'c', to: 't3' },
    ])
    assert.equal(run.steps[0].route, null, 'fan-out 不止一条边时不写单值 route')
    assert.equal(host.calls.dispatch.length, 4, 'planner + 3 concurrent tasks')
    assert.equal(run.result.lastNode, 'done')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

const OVERLAP = {
  goal: '重叠汇合',
  maxSteps: 30,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'plan', name: '开始', prompt: '规划。' }] },
    {
      id: 'plan',
      type: 'robot',
      robot: 'planner',
      output: { type: 'object', properties: {} },
      next: [
        { to: 't1', name: 'e1', prompt: '任务一。' },
        { to: 't2', name: 'e2', prompt: '任务二。' },
        { to: 't3', name: 'e3', prompt: '任务三。' },
        { to: 't4', name: 'e4', prompt: '任务四（未启动）。' },
      ],
    },
    { id: 't1', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 't2', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 't3', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 't4', type: 'robot', robot: 'worker', output: { type: 'object', properties: {} } },
    { id: 'x', type: 'join', inputs: ['t1', 't2', 't4'], next: [{ to: 'done' }] },
    { id: 'y', type: 'join', inputs: ['t2', 't3'], next: [{ to: 'done' }] },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

test('supervisor: a join waits only for its started inputs and supports overlap', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({
      results: [
        { text: 'planned', structured: { next: ['e1', 'e2', 'e3'] }, stopReason: 'completed' },
        { text: 't1', structured: {}, stopReason: 'completed' },
        { text: 't2', structured: {}, stopReason: 'completed' },
        { text: 't3', structured: {}, stopReason: 'completed' },
      ],
    })
    const definition = OVERLAP
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(definition),
      definition,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'overlap completion',
    )
    const run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 4, 'planner + started tasks (t4 未启动)')
    // t4 没有启动，所以两个 join 都不等它；t2 同时喂给 x 和 y。
    assert.deepEqual(
      run.steps.map((step) => step.nodeId),
      ['plan', 't1', 't2', 't3'],
    )
    assert.equal(run.result.status, 'completed')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

const PLAN = {
  goal: '先计划再实施',
  maxSteps: 10,
  nodes: [
    {
      id: 'start',
      type: 'start',
      next: [{ to: 'implement', name: '开始', prompt: '先给计划，批准后再实施。' }],
    },
    {
      id: 'implement',
      type: 'robot',
      robot: 'developer',
      mode: 'plan',
      summary: '计划后实施',
      output: { type: 'object', properties: {} },
      agentOptions: { provider: 'test-provider', model: 'test-model' },
      next: [{ to: 'done', name: '完成' }],
    },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

test('supervisor: plan nodes dispatch with planMode true and normal nodes with false', async () => {
  const { store, dir } = await makeStore()
  try {
    const normal = harness({
      results: [{ text: 'done', structured: { next: '完成' }, stopReason: 'completed' }],
    })
    const normalSupervisor = new WorkflowSupervisor({
      ctx: normal.ctx,
      store,
      logger: normal.ctx.logger,
    })
    normalSupervisor.attachRobots(normal.robots)
    const normalStarted = await normalSupervisor.start({
      plan: planOf(SIMPLE),
      definition: SIMPLE,
      agent: { id: 'root' },
      mode: 'background',
    })
    assert.equal(normal.calls.dispatch[0].planMode, false)
    await waitFor(
      async () => (await store.readRun(normalStarted.runId))?.status === 'completed',
      'normal completion',
    )

    const plan = harness({ autoFinish: false, results: [{ text: '', stopReason: 'completed' }] })
    const planSupervisor = new WorkflowSupervisor({ ctx: plan.ctx, store, logger: plan.ctx.logger })
    planSupervisor.attachRobots(plan.robots)
    const planStarted = await planSupervisor.start({
      plan: planOf(PLAN),
      definition: PLAN,
      agent: { id: 'root' },
      mode: 'background',
    })
    assert.equal(plan.calls.dispatch[0].planMode, true)
    const planSessionId = planStarted.run.active[0].sessionId
    // 模拟用户批准：plan 模式已退出，机器人实施完并交回结果。
    plan.sessions.get(planSessionId).planMode = false
    plan.result(planSessionId, {
      text: 'done',
      structured: { next: '完成' },
      stopReason: 'completed',
    })
    plan.finish(planSessionId)
    await waitFor(
      async () => (await store.readRun(planStarted.runId))?.status === 'completed',
      'plan completion',
    )
    const run = await store.readRun(planStarted.runId)
    assert.equal(run.steps[0].mode, 'plan')
    assert.ok(
      plan.calls.planMode.some((call) => call.active === false),
      'the plan mode is cleared when the node ends',
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a dismissed plan review waits for the user instead of retrying the result', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({ autoFinish: false, results: [{ text: '', stopReason: 'completed' }] })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(PLAN),
      definition: PLAN,
      agent: { id: 'root' },
      mode: 'background',
    })
    const sessionId = started.run.active[0].sessionId
    let resolveAnswer
    const answer = new Promise((resolve) => {
      resolveAnswer = resolve
    })
    host.emit(
      'user-questions/request',
      {
        agent: { id: sessionId },
        questions: [
          {
            id: 'plan-review',
            question: 'Approve this plan and leave plan mode?',
            options: [{ label: 'Approve' }, { label: 'Keep planning' }],
            intent: { kind: 'plan-review', approve: 'Approve' },
          },
        ],
      },
      () => answer,
    )
    await waitFor(
      async () => (await store.readRun(started.runId))?.pendingInteraction?.planReview === true,
      'plan review recorded',
    )
    resolveAnswer({ answers: [] })
    host.result(sessionId, { text: '', stopReason: 'completed' })
    host.finish(sessionId)
    await new Promise((resolve) => setTimeout(resolve, 40))
    let run = await store.readRun(started.runId)
    assert.equal(run.status, 'running', 'dismissal keeps the node waiting')
    assert.equal(run.active.length, 1)
    assert.equal(host.calls.sends.length, 0, 'no structured-result retry is sent after a dismissal')

    // 用户批准后（plan 模式已退出）这一轮正常交回结果并路由。
    host.sessions.get(sessionId).planMode = false
    host.result(sessionId, {
      text: 'implemented',
      structured: { next: '完成' },
      stopReason: 'completed',
    })
    host.finish(sessionId)
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'completed',
      'after approval',
    )
    run = await store.readRun(started.runId)
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].text, 'implemented')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: a plan node that stops in plan mode is nudged once, then fails', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({ autoFinish: false, results: [{ text: '', stopReason: 'completed' }] })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(PLAN),
      definition: PLAN,
      agent: { id: 'root' },
      mode: 'background',
    })
    const sessionId = started.run.active[0].sessionId
    host.result(sessionId, { text: '', stopReason: 'completed' })
    host.finish(sessionId)
    await waitFor(() => host.calls.sends.length === 1, 'plan review nudge')
    assert.match(host.calls.sends[0].text, /exit_plan_mode/u)
    assert.equal(host.calls.sends[0].compactFirst, false)
    let run = await store.readRun(started.runId)
    assert.equal(run.status, 'running', 'the first stop is nudged, not failed')

    host.result(sessionId, { text: '', stopReason: 'completed' })
    host.finish(sessionId)
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'second stop fails',
    )
    run = await store.readRun(started.runId)
    assert.match(run.error, /without presenting a plan/u)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('supervisor: an old robots service without supportsPlanMode fails the plan node clearly', async () => {
  const { store, dir } = await makeStore()
  try {
    const host = harness({ supportsPlanMode: false })
    const supervisor = new WorkflowSupervisor({ ctx: host.ctx, store, logger: host.ctx.logger })
    supervisor.attachRobots(host.robots)
    const started = await supervisor.start({
      plan: planOf(PLAN),
      definition: PLAN,
      agent: { id: 'root' },
      mode: 'background',
    })
    await waitFor(
      async () => (await store.readRun(started.runId))?.status === 'failed',
      'capability failure',
    )
    const run = await store.readRun(started.runId)
    assert.match(run.error, /supportsPlanMode is missing/u)
    assert.equal(host.calls.dispatch.length, 0, 'no session is dispatched without the capability')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
