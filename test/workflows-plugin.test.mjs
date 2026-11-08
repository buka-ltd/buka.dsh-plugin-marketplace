/**
 * @buka/dsh-plugin-workflows 纯逻辑模块的单测。
 *
 * 覆盖定义校验、prompt 模板、条件路由、落盘存储与执行器；全部使用临时目录
 * 或内存替身，不启动 DSH、不联网。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { describePlan, validateDefinition } from '../plugins/workflows/lib/definition.js'
import { robotSessionTitle, runWorkflow } from '../plugins/workflows/lib/engine.js'
import { chooseNext, chooseNextRule, matchesWhen } from '../plugins/workflows/lib/routing.js'
import {
  WorkflowRunStore,
  truncateUtf8,
} from '../plugins/workflows/lib/run-store.js'
import { renderTemplate, TemplateError } from '../plugins/workflows/lib/template.js'

/**
 * 一个最小可用的定义。
 *
 * @returns {Record<string, any>}
 */
function sampleDefinition() {
  return {
    goal: '为 v1.2 写发布说明',
    start: 'collect',
    maxSteps: 8,
    nodes: [
      {
        id: 'collect',
        type: 'robot',
        robot: 'researcher',
        prompt: '目标：{{goal}}\n收集变更。',
        report: true,
        next: [
          { when: { field: 'status', equals: 'ok' }, to: 'write' },
          { to: 'done' },
        ],
      },
      {
        id: 'write',
        type: 'robot',
        robot: 'writer',
        prompt: '根据调研写说明：{{nodes.collect.data.summary}}',
        next: 'gate',
      },
      {
        id: 'gate',
        type: 'gate',
        title: '发布确认',
        detail: '是否同意发布？',
        onApprove: 'done',
        onReject: 'abort',
      },
      { id: 'done', type: 'end', status: 'completed' },
      { id: 'abort', type: 'end', status: 'rejected' },
    ],
  }
}

/**
 * 新格式：start 节点 + 所有 prompt 都在边上；开发/测试循环里同一个 dev 节点
 * 会被 start 边和测试打回边用两份不同的 prompt 进入。
 *
 * @returns {Record<string, any>}
 */
function startDefinition() {
  return {
    goal: '开发—测试循环',
    maxSteps: 12,
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [{ to: 'dev', name: '开始开发', prompt: '按需求实现导出功能。' }],
      },
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        summary: '实现导出功能',
        next: [{ to: 'test', name: '开发完成', prompt: '检查开发结果：{{nodes.dev.text}}' }],
      },
      {
        id: 'test',
        type: 'robot',
        robot: 'tester',
        summary: '检查导出实现',
        report: true,
        next: [
          {
            when: { field: 'passed', equals: false },
            to: 'dev',
            name: '测试打回',
            prompt: '测试打回：{{nodes.test.text}}',
          },
          { to: 'done', name: '测试通过' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
}

/**
 * @param {unknown} definition
 * @returns {NonNullable<ReturnType<typeof validateDefinition>['plan']>}
 */
function planOf(definition) {
  const parsed = validateDefinition(definition, { maxSteps: 64 })
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors))
  assert.ok(parsed.plan)
  return parsed.plan
}

/**
 * 内存版存储替身。
 */
class MemoryStore {
  constructor() {
    this.runs = new Map()
    this.events = []
    this.nodes = []
  }

  async create({ run }) {
    this.runs.set(run.runId, structuredClone(run))
  }

  async save(run) {
    this.runs.set(run.runId, structuredClone(run))
  }

  async appendEvent(runId, type, data) {
    this.events.push({ runId, type, data })
  }

  async saveNodeResult(runId, seq, nodeId, payload) {
    this.nodes.push({ runId, seq, nodeId, payload })
  }
}

/**
 * 记录调用并依次返回预设结果的机器人服务替身。
 *
 * @param {Array<Record<string, any>>} results
 * @returns {{ calls: Array<Record<string, any>>, startSession: Function }}
 */
function fakeRobots(results) {
  const calls = []
  const queue = [...results]
  return {
    calls,
    async startSession(request) {
      calls.push(request)
      const result = queue.shift() ?? { text: 'done', structured: undefined, stopReason: 'completed' }
      const requestedId = typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : ''
      const sessionId = requestedId !== '' ? requestedId : `session-${calls.length}`
      const resumed = requestedId !== ''
      return {
        id: sessionId,
        robot: request.robot,
        cwd: '/tmp/robot',
        resumed,
        result: Promise.resolve({
          sessionId,
          robot: request.robot,
          resumed,
          compacted: resumed,
          ...result,
        }),
        cancel() {},
        async dispose() {},
      }
    },
  }
}

/**
 * @param {string[]} outcomes
 * @returns {{ requests: Array<Record<string, any>>, request: Function }}
 */
function fakeApproval(outcomes) {
  const queue = [...outcomes]
  const requests = []
  return {
    requests,
    async request(request) {
      requests.push(request)
      return queue.shift() ?? 'rejected'
    },
  }
}

test('definition: accepts a complete workflow and describes it', () => {
  const plan = planOf(sampleDefinition())
  assert.equal(plan.start, 'collect')
  assert.equal(plan.goal, '为 v1.2 写发布说明')
  assert.deepEqual(plan.order, ['collect', 'write', 'gate', 'done', 'abort'])
  assert.deepEqual(describePlan(plan).nodes.map((node) => node.id), plan.order)
})

test('definition: keeps an optional creator-written step summary', () => {
  const definition = sampleDefinition()
  definition.nodes[0].summary = '  收集 v1.2 的变更  '
  const plan = planOf(definition)
  assert.equal(plan.nodes.collect.summary, '收集 v1.2 的变更')
  assert.equal(plan.nodes.write.summary, '')

  const invalid = sampleDefinition()
  invalid.nodes[0].summary = 42
  const parsed = validateDefinition(invalid)
  assert.equal(parsed.ok, false)
  assert.match(
    parsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /nodes\[0\]\.summary: must be a string/,
  )

  const tooLong = sampleDefinition()
  tooLong.nodes[0].summary = 'x'.repeat(501)
  const longParsed = validateDefinition(tooLong)
  assert.equal(longParsed.ok, false)
  assert.match(longParsed.errors.map((error) => error.message).join('\n'), /at most 500 characters/)
})

test('definition: keeps edge names and entry prompts', () => {
  const definition = sampleDefinition()
  definition.nodes[0].next = [
    { when: { field: 'status', equals: 'ok' }, to: 'write', name: '  调研完成  ', prompt: '入口说明：{{nodes.collect.text}}' },
    { to: 'done', name: '调研失败' },
  ]
  const plan = planOf(definition)
  assert.equal(plan.nodes.collect.next[0].name, '调研完成')
  assert.equal(plan.nodes.collect.next[0].prompt, '入口说明：{{nodes.collect.text}}')
  assert.equal(plan.nodes.collect.next[1].name, '调研失败')
  assert.equal(Object.hasOwn(plan.nodes.collect.next[1], 'prompt'), false, 'a missing edge prompt is not stored')

  // 多出口的节点会提醒补名字，补全后提醒消失；单出口的线性边不提醒。
  const unnamed = validateDefinition(sampleDefinition())
  assert.equal(unnamed.ok, true)
  assert.ok(unnamed.warnings.some((warning) => warning.includes('multiple exits')))
  const named = sampleDefinition()
  for (const [index, rule] of named.nodes[0].next.entries()) rule.name = `边 ${index + 1}`
  assert.equal(
    validateDefinition(named).warnings.some((warning) => warning.includes('multiple exits')),
    false,
  )
})

test('definition: validates edge fields and only lets prompts enter a robot node', () => {
  const badTypes = sampleDefinition()
  badTypes.nodes[0].next = [{ to: 'write', name: 42, prompt: 42 }]
  const parsed = validateDefinition(badTypes)
  assert.equal(parsed.ok, false)
  const messages = parsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
  assert.match(messages, /nodes\[0\]\.next\[0\]\.name: must be a string/u)
  assert.match(messages, /nodes\[0\]\.next\[0\]\.prompt: must be a string/u)

  const toGate = sampleDefinition()
  toGate.nodes[0].next = [{ to: 'gate', name: '去审批', prompt: '门禁不跑会话，不该有入口说明' }]
  const gateParsed = validateDefinition(toGate)
  assert.equal(gateParsed.ok, false)
  assert.match(
    gateParsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /nodes\[0\]\.next\[0\]\.prompt: an edge prompt is only supported when the edge enters a robot node/u,
  )
})

test('definition: a start node and the prompts on its edges', () => {
  const parsed = validateDefinition(startDefinition())
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors))
  assert.ok(parsed.plan)
  assert.equal(parsed.plan.start, 'start')
  assert.deepEqual(parsed.plan.order, ['start', 'dev', 'test', 'done'])
  assert.equal(parsed.plan.nodes.start.type, 'start')
  assert.deepEqual(parsed.plan.nodes.start.next, [
    { to: 'dev', name: '开始开发', prompt: '按需求实现导出功能。' },
  ])
  // 新格式里 prompt 只在边上，节点上是空串（旧格式兼容字段）。
  assert.equal(parsed.plan.nodes.dev.prompt, '')
  assert.equal(parsed.plan.nodes.dev.next[0].prompt, '检查开发结果：{{nodes.dev.text}}')
  assert.equal(parsed.plan.nodes.test.next[0].prompt, '测试打回：{{nodes.test.text}}')
})

test('definition: the start format keeps every prompt on an edge', () => {
  const missing = startDefinition()
  delete missing.nodes[2].next[0].prompt
  const missingParsed = validateDefinition(missing)
  assert.equal(missingParsed.ok, false)
  assert.match(
    missingParsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /an edge entering a robot node must carry its prompt/u,
  )

  const legacyPrompt = startDefinition()
  legacyPrompt.nodes[1].prompt = '旧格式的节点 prompt'
  const legacyParsed = validateDefinition(legacyPrompt)
  assert.equal(legacyParsed.ok, false)
  assert.match(
    legacyParsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /robot nodes no longer carry a prompt/u,
  )

  const noFirstPrompt = startDefinition()
  delete noFirstPrompt.nodes[0].next[0].prompt
  const firstParsed = validateDefinition(noFirstPrompt)
  assert.equal(firstParsed.ok, false)
  assert.match(
    firstParsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /the start edge must carry the first robot prompt/u,
  )

  const startToGate = startDefinition()
  startToGate.nodes[0].next[0].to = 'gate'
  startToGate.nodes.push({ id: 'gate', type: 'gate', title: '确认', onApprove: 'done', onReject: 'done' })
  const gateParsed = validateDefinition(startToGate)
  assert.equal(gateParsed.ok, false)
  assert.match(
    gateParsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /the start edge must enter a robot node/u,
  )

  const backToStart = startDefinition()
  backToStart.nodes[3].type = 'robot'
  backToStart.nodes[3].robot = 'writer'
  backToStart.nodes[3].next = [{ to: 'start' }]
  const backParsed = validateDefinition(backToStart)
  assert.equal(backParsed.ok, false)
  assert.match(
    backParsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
    /an edge cannot point at the start node/u,
  )
})

test('definition: gate edges carry a name and prompt like other edges', () => {
  const definition = startDefinition()
  definition.nodes.push({
    id: 'gate',
    type: 'gate',
    title: '确认',
    onApprove: 'done',
    onReject: { to: 'dev', name: '打回修改', prompt: '继续修改：{{nodes.test.text}}' },
  })
  definition.nodes[2].next[1].to = 'gate'
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors))
  assert.deepEqual(parsed.plan.nodes.gate.onApprove, { to: 'done' })
  assert.deepEqual(parsed.plan.nodes.gate.onReject, {
    to: 'dev',
    name: '打回修改',
    prompt: '继续修改：{{nodes.test.text}}',
  })
})

test('definition: reports missing start, duplicate ids and unknown transitions', () => {
  const definition = sampleDefinition()
  definition.start = 'missing'
  definition.nodes.push({ id: 'collect', type: 'end' })
  definition.nodes[1].next = 'nowhere'
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, false)
  const messages = parsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
  assert.match(messages, /unknown start node/)
  assert.match(messages, /duplicate node id/)
  assert.match(messages, /transition to unknown node/)
})

test('definition: rejects nodes the start cannot reach', () => {
  const definition = sampleDefinition()
  definition.nodes.push({ id: 'orphan', type: 'robot', robot: 'researcher', prompt: 'nobody points here' })
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, false)
  const messages = parsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
  // 不可达节点永远不会执行，画到图上还会像第二个起点，所以直接报错。
  assert.match(messages, /nodes\[5\]: node "orphan" is not reachable from start, so it would never run/)
})

test('definition: validates robot and gate fields and clamps maxSteps', () => {
  const definition = sampleDefinition()
  definition.maxSteps = 999
  definition.nodes[0].robot = ''
  definition.nodes[2].onApprove = 'missing'
  const parsed = validateDefinition(definition, { maxSteps: 8 })
  assert.equal(parsed.ok, false)
  const messages = parsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
  assert.match(messages, /maxSteps/)
  assert.match(messages, /robot must be a non-empty robot name|\.robot: must be a non-empty robot name/)
  assert.match(messages, /transition to unknown node "missing"/)
})

test('template: interpolates goal, node text and structured data', () => {
  const text = renderTemplate('目标 {{goal}}；上一步：{{nodes.collect.text}}；摘要：{{nodes.collect.data.summary}}', {
    goal: '发布',
    nodes: { collect: { text: 'abc', data: { summary: 'ok' } } },
  })
  assert.equal(text, '目标 发布；上一步：abc；摘要：ok')
})

test('template: rejects unknown and malformed paths', () => {
  assert.throws(() => renderTemplate('{{nodes.collect.text}}', { nodes: {} }), TemplateError)
  assert.throws(() => renderTemplate('{{a b}}', {}), TemplateError)
})

test('routing: equals, in, default and no match', () => {
  const node = {
    next: [
      { when: { field: 'verdict', equals: 'pass' }, to: 'publish' },
      { when: { field: 'meta.level', in: ['high', 'critical'] }, to: 'escalate' },
      { to: 'fallback' },
    ],
  }
  assert.equal(chooseNext(node, { data: { verdict: 'pass' } }), 'publish')
  assert.equal(chooseNext(node, { data: { meta: { level: 'high' } } }), 'escalate')
  assert.equal(chooseNext(node, { data: {} }), 'fallback')
  assert.equal(chooseNext({ next: [] }, { data: {} }), null)
  // 返回整条规则，执行器才能拿到边上的 name / prompt。
  assert.equal(chooseNextRule(node, { data: { verdict: 'pass' } }).to, 'publish')
  assert.equal(chooseNextRule(node, { data: {} }).to, 'fallback')
  assert.equal(chooseNextRule({ next: [] }, { data: {} }), null)
  assert.equal(matchesWhen(undefined, undefined), true)
  assert.equal(matchesWhen({ field: 'x', equals: 1 }, { x: 1 }), true)
  assert.equal(matchesWhen({ field: 'x', equals: 1 }, {}), false)
})

test('store: persists, reads and lists runs', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({ dir })
  await store.init()
  const run = {
    version: 1,
    runId: 'wf-test',
    goal: 'g',
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: { sessionId: 'root' },
    steps: [],
  }
  await store.create({ run, definition: { start: 'a' } })
  await store.appendEvent('wf-test', 'node/start', { nodeId: 'a' })
  await store.saveNodeResult('wf-test', 1, 'a', { text: 'hello' })

  const stored = await store.readRun('wf-test')
  assert.equal(stored.runId, 'wf-test')
  assert.equal(stored.status, 'running')

  const runs = await store.listRuns(10)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].runId, 'wf-test')

  const files = await fs.readdir(store.runDirectory('wf-test'))
  assert.deepEqual(files.sort(), ['definition.json', 'events.jsonl', 'nodes', 'run.json'])
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: marks stale running/waiting runs interrupted on init and prunes old runs', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const first = new WorkflowRunStore({ dir })
  await first.init()
  for (const runId of ['wf-a', 'wf-b']) {
    await first.create({
      run: {
        version: 1,
        runId,
        goal: '',
        status: runId === 'wf-a' ? 'running' : 'waiting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: { sessionId: 'root' },
        steps: [],
      },
      definition: {},
    })
  }

  const second = new WorkflowRunStore({ dir, maxRuns: 1 })
  await second.init()
  const runs = await second.listRuns(10)
  assert.equal(runs.length, 1)
  for (const id of await second.listRunIds()) {
    const run = await second.readRun(id)
    assert.equal(run.status, 'interrupted')
  }
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: truncateUtf8 keeps valid multi-byte text', () => {
  const { text, truncated } = truncateUtf8('你好世界', 7)
  assert.equal(truncated, true)
  assert.ok(text === '你好' || text === '你好世')
})

test('engine: runs robot nodes in order and routes on structured data', async () => {
  const definition = sampleDefinition()
  const plan = planOf(definition)
  const store = new MemoryStore()
  const robots = fakeRobots([
    { text: '调研完成', structured: { status: 'ok', summary: '三点' }, stopReason: 'completed' },
    { text: '写好了', stopReason: 'completed' },
  ])
  const approval = fakeApproval(['allowed-once'])

  const run = await runWorkflow({
    plan,
    definition,
    store,
    robots,
    approval,
    agent: { id: 'root' },
    options: { nodeTimeoutMs: 1000 },
  })

  assert.equal(run.status, 'completed')
  assert.equal(robots.calls.length, 2)
  assert.equal(robots.calls[0].robot, 'researcher')
  assert.equal(robots.calls[0].approval, 'never')
  assert.equal(robots.calls[0].agentPreset, undefined)
  assert.match(robots.calls[0].prompt, /目标：为 v1\.2 写发布说明/)
  assert.match(robots.calls[1].prompt, /三点/)
  assert.equal(approval.requests.length, 1)
  assert.equal(approval.requests[0].toolName, 'buka_workflow_gate')
  // 每次执行的渲染后输入单独落盘，详情页按次查看。
  assert.match(store.nodes[0].payload.prompt, /目标：为 v1\.2 写发布说明/u)
  assert.match(store.nodes[1].payload.prompt, /三点/u)
  assert.deepEqual(run.steps.map((step) => step.nodeId), ['collect', 'write', 'gate'])
  assert.equal(run.result.status, 'completed')
  assert.ok(store.events.some((event) => event.type === 'gate/decided'))
})

test('engine: rejected gate follows onReject', async () => {
  const definition = sampleDefinition()
  const plan = planOf(definition)
  const robots = fakeRobots([
    { text: 'ok', structured: { status: 'ok', summary: 's' }, stopReason: 'completed' },
    { text: 'draft', stopReason: 'completed' },
  ])
  const approval = fakeApproval(['rejected'])
  const run = await runWorkflow({
    plan,
    definition,
    store: new MemoryStore(),
    robots,
    approval,
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'rejected')
  assert.deepEqual(run.steps.map((step) => step.nodeId), ['collect', 'write', 'gate'])
})

test('engine: a gate edge prompt is used when it enters a robot node', async () => {
  const definition = {
    goal: '发布前确认',
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: '写发布说明。' }] },
      { id: 'dev', type: 'robot', robot: 'writer', summary: '写发布说明', next: [{ to: 'gate', name: '提交审批' }] },
      {
        id: 'gate',
        type: 'gate',
        title: '发布确认',
        onApprove: { to: 'publish', name: '同意发布', prompt: '发布：{{nodes.dev.text}}' },
        onReject: 'done',
      },
      { id: 'publish', type: 'robot', robot: 'publisher', summary: '发布', next: [{ to: 'done', name: '完成' }] },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const robots = fakeRobots([
    { text: '草稿', stopReason: 'completed' },
    { text: '已发布', stopReason: 'completed' },
  ])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store: new MemoryStore(),
    robots,
    approval: fakeApproval(['allowed-once']),
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'completed')
  assert.deepEqual(run.steps.map((step) => step.nodeId), ['dev', 'gate', 'publish'])
  assert.equal(robots.calls[0].prompt, '写发布说明。')
  assert.equal(robots.calls[1].prompt, '发布：草稿')
})

test('engine: robot failure ends the run as failed', async () => {
  const definition = sampleDefinition()
  const plan = planOf(definition)
  const run = await runWorkflow({
    plan,
    definition,
    store: new MemoryStore(),
    robots: fakeRobots([{ text: '', stopReason: 'error', error: 'boom' }]),
    approval: fakeApproval([]),
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'failed')
  assert.match(run.error, /boom/)
})

test('engine: abort signal ends the run as cancelled', async () => {
  const definition = sampleDefinition()
  const plan = planOf(definition)
  const controller = new AbortController()
  const robots = {
    async startSession(request) {
      controller.abort()
      return {
        id: 'session-1',
        result: Promise.resolve({ sessionId: 'session-1', robot: request.robot, text: '', stopReason: 'aborted' }),
        cancel() {},
        async dispose() {},
      }
    },
  }
  const run = await runWorkflow({
    plan,
    definition,
    store: new MemoryStore(),
    robots,
    approval: fakeApproval([]),
    agent: { id: 'root' },
    signal: controller.signal,
  })
  assert.equal(run.status, 'cancelled')
})

test('engine: reports the run id as soon as the run record exists', async () => {
  const definition = sampleDefinition()
  const plan = planOf(definition)
  const created = []
  const robots = fakeRobots([
    { text: '调研完成', structured: { status: 'ok', summary: '三点' }, stopReason: 'completed' },
    { text: '写好了', stopReason: 'completed' },
  ])
  const run = await runWorkflow({
    plan,
    definition,
    store: new MemoryStore(),
    robots,
    approval: fakeApproval(['allowed-once']),
    agent: { id: 'root' },
    onRunCreated: (runId) => created.push(runId),
  })
  assert.equal(run.status, 'completed')
  assert.deepEqual(created, [run.runId])
})

test('engine: robot nodes start in the configured worker preset', async () => {
  const definition = {
    start: 'a',
    nodes: [
      { id: 'a', type: 'robot', robot: 'writer', prompt: '写一段', next: 'done' },
      { id: 'done', type: 'end' },
    ],
  }
  const robots = fakeRobots([{ text: 'ok', stopReason: 'completed' }])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store: new MemoryStore(),
    robots,
    agent: { id: 'root' },
    options: { robotPreset: 'standard' },
  })
  assert.equal(run.status, 'completed')
  assert.equal(robots.calls[0].agentPreset, 'standard')
})

test('engine: a loop revisits nodes until the route leaves the cycle', async () => {
  const definition = {
    goal: '反复修到检查通过',
    start: 'check',
    maxSteps: 12,
    nodes: [
      {
        id: 'check',
        type: 'robot',
        robot: 'reviewer',
        prompt: '检查当前稿',
        report: true,
        maxVisits: 5,
        next: [
          { when: { field: 'ok', equals: true }, to: 'done' },
          { to: 'fix' },
        ],
      },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修复：{{nodes.check.text}}', next: 'check' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const robots = fakeRobots([
    { text: '问题 1', structured: { ok: false }, stopReason: 'completed' },
    { text: '已修 1', stopReason: 'completed' },
    { text: '问题 2', structured: { ok: false }, stopReason: 'completed' },
    { text: '已修 2', stopReason: 'completed' },
    { text: '通过', structured: { ok: true }, stopReason: 'completed' },
  ])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store: new MemoryStore(),
    robots,
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'completed')
  assert.equal(robots.calls.length, 5)
  assert.deepEqual(
    run.steps.map((step) => `${step.nodeId}:${step.visit}`),
    ['check:1', 'fix:1', 'check:2', 'fix:2', 'check:3'],
  )
  // 第二次进入 fix 时，prompt 引用的是最近一次 check 的交付物。
  assert.match(robots.calls[3].prompt, /问题 2/u)
})

test('engine: repeated entries of one robot reuse its session and record compaction', async () => {
  const definition = {
    goal: '同一个机器人反复处理',
    start: 'dev',
    maxSteps: 10,
    nodes: [
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        prompt: '处理一轮',
        report: true,
        next: [
          { when: { field: 'ok', equals: true }, to: 'done' },
          { to: 'retry' },
        ],
      },
      { id: 'retry', type: 'robot', robot: 'coder', prompt: '再处理一轮', next: 'dev' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const robots = fakeRobots([
    { text: '第一轮', structured: { ok: false }, stopReason: 'completed' },
    { text: '补充', structured: {}, stopReason: 'completed' },
    { text: '第二轮', structured: { ok: false }, stopReason: 'completed' },
    { text: '补充', structured: {}, stopReason: 'completed' },
    { text: '通过', structured: { ok: true }, stopReason: 'completed' },
  ])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store: new MemoryStore(),
    robots,
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'completed')
  // 第一次进入新开会话；之后每次进入都复用同一个会话。
  assert.equal(robots.calls[0].sessionId, undefined)
  for (const call of robots.calls.slice(1)) assert.equal(typeof call.sessionId, 'string')
  assert.deepEqual(
    robots.calls.map((call) => call.sessionId ?? null),
    [null, 'session-1', 'session-1', 'session-1', 'session-1'],
  )
  assert.deepEqual(
    run.steps.map((step) => ({ resumed: step.resumed, compacted: step.compacted })),
    [
      { resumed: false, compacted: false },
      { resumed: true, compacted: true },
      { resumed: true, compacted: true },
      { resumed: true, compacted: true },
      { resumed: true, compacted: true },
    ],
  )
  assert.equal(run.sessions.length, 1)
  assert.equal(run.sessions[0].robot, 'coder')
  assert.equal(run.sessions[0].sessionId, 'session-1')
  assert.equal(run.sessions[0].visits, 5)
})

test('engine: robot sessions are titled with the run goal and robot name', async () => {
  const definition = sampleDefinition()
  const robots = fakeRobots([{ text: 'ok', structured: { status: 'ok', summary: '三点' }, stopReason: 'completed' }])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store: new MemoryStore(),
    robots,
    approval: fakeApproval(['allowed-once']),
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'completed')
  assert.equal(robots.calls[0].title, '为 v1.2 写发布说明 · researcher')
  // 再进入同一个机器人时标题不变：一次运行里这个机器人的会话本来就是一个。
  assert.equal(robots.calls[1].title, '为 v1.2 写发布说明 · writer')
})

test('engine: session titles stay within the title byte budget', () => {
  // 没有 goal 时退回到 runId，保证标题仍然能区分运行。
  assert.equal(robotSessionTitle({ runId: 'wf-123' }, { robot: 'coder' }), '工作流 wf-123 · coder')
  // 标题按 UTF-8 字节裁剪：机器人名保留，目标被裁短，总长度不超过 80 字节。
  const title = robotSessionTitle(
    { goal: '把这段很长的目标写成一句完整的说明'.repeat(6), runId: 'wf-123' },
    { robot: 'coder' },
  )
  assert.ok(Buffer.byteLength(title, 'utf8') <= 80)
  assert.ok(title.endsWith(' · coder'))
  // 没有机器人名时不拼后缀。
  assert.equal(robotSessionTitle({ goal: '写发布说明' }, {}), '写发布说明')
})

test('engine: an edge prompt is only prepended when that edge is taken', async () => {
  const definition = {
    goal: '写一个功能',
    start: 'dev',
    maxSteps: 10,
    nodes: [
      { id: 'dev', type: 'robot', robot: 'coder', prompt: '开发任务：{{goal}}', next: 'test' },
      {
        id: 'test',
        type: 'robot',
        robot: 'tester',
        prompt: '测试开发结果：{{nodes.dev.text}}',
        report: true,
        next: [
          {
            when: { field: 'passed', equals: false },
            to: 'dev',
            name: '测试打回',
            prompt: '这是测试打回：\n{{nodes.test.text}}',
          },
          { to: 'done', name: '测试通过' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const store = new MemoryStore()
  const robots = fakeRobots([
    { text: '初版完成', stopReason: 'completed' },
    { text: '发现 2 个问题', structured: { passed: false }, stopReason: 'completed' },
    { text: '修复完成', stopReason: 'completed' },
    { text: '通过', structured: { passed: true }, stopReason: 'completed' },
  ])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store,
    robots,
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'completed')
  assert.deepEqual(
    run.steps.map((step) => `${step.nodeId}:${step.visit}`),
    ['dev:1', 'test:1', 'dev:2', 'test:2'],
  )
  // 首次进入 dev 走的是 start，没有边 prompt。
  assert.equal(robots.calls[0].prompt, '开发任务：写一个功能')
  // 第二次进入 dev 是走 test 的「测试打回」边，入口说明排在节点 prompt 前面。
  assert.equal(robots.calls[2].prompt, '这是测试打回：\n发现 2 个问题\n\n开发任务：写一个功能')
  // 每次执行的落盘提示词也是各自真实用到的输入。
  const devResults = store.nodes.filter((entry) => entry.nodeId === 'dev')
  assert.equal(devResults.length, 2)
  assert.equal(devResults[0].payload.prompt, '开发任务：写一个功能')
  assert.match(devResults[1].payload.prompt, /这是测试打回：\n发现 2 个问题/u)
})

test('engine: one robot node, two incoming edges, two different prompts', async () => {
  const definition = startDefinition()
  const store = new MemoryStore()
  const robots = fakeRobots([
    { text: '初版完成', stopReason: 'completed' },
    { text: '发现 2 个问题', structured: { passed: false }, stopReason: 'completed' },
    { text: '修复完成', stopReason: 'completed' },
    { text: '复查通过', structured: { passed: true }, stopReason: 'completed' },
  ])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store,
    robots,
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'completed')
  // start 不占步数；测试打回直接回到同一个 dev 节点，不另建修复节点。
  assert.deepEqual(
    run.steps.map((step) => `${step.nodeId}:${step.visit}`),
    ['dev:1', 'test:1', 'dev:2', 'test:2'],
  )
  assert.equal(robots.calls[0].prompt, '按需求实现导出功能。')
  assert.equal(robots.calls[1].prompt, '检查开发结果：初版完成')
  assert.equal(robots.calls[2].prompt, '测试打回：发现 2 个问题')
  assert.equal(robots.calls[3].prompt, '检查开发结果：修复完成')
  const devResults = store.nodes.filter((entry) => entry.nodeId === 'dev')
  assert.deepEqual(
    devResults.map((entry) => entry.payload.prompt),
    ['按需求实现导出功能。', '测试打回：发现 2 个问题'],
  )
})

test('engine: maxVisits stops a loop that never leaves the cycle', async () => {
  const definition = {
    start: 'check',
    maxSteps: 20,
    nodes: [
      { id: 'check', type: 'robot', robot: 'reviewer', prompt: '总是失败', maxVisits: 2, next: 'fix' },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修', next: 'check' },
    ],
  }
  const robots = fakeRobots([])
  const run = await runWorkflow({
    plan: planOf(definition),
    definition,
    store: new MemoryStore(),
    robots,
    agent: { id: 'root' },
  })
  assert.equal(run.status, 'failed')
  assert.match(run.error, /exceeded its 2-visit limit/u)
  // 第三次进入 check 之前就被拦下，前两次循环都跑完了。
  assert.deepEqual(
    run.steps.map((step) => `${step.nodeId}:${step.visit}`),
    ['check:1', 'fix:1', 'check:2', 'fix:2'],
  )
  assert.equal(robots.calls.length, 4)
})

test('store: reads the definition snapshot and node results for the page', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({ dir })
  await store.init()
  const run = {
    version: 1,
    runId: 'wf-page',
    goal: 'g',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: { sessionId: 'root' },
    steps: [],
  }
  await store.create({ run, definition: { goal: 'g', start: 'a' }, plan: { start: 'a' } })
  await store.saveNodeResult('wf-page', 1, 'a', { nodeId: 'a', seq: 1, text: 'hi', structured: { ok: true } })
  await store.saveNodeResult('wf-page', 2, 'b', { nodeId: 'b', seq: 2, text: 'bye' })

  const definition = await store.readDefinition('wf-page')
  assert.equal(definition.definition.start, 'a')
  const results = await store.readNodeResults('wf-page')
  assert.deepEqual(results.map((result) => result.nodeId), ['a', 'b'])
  assert.equal(results[0].text, 'hi')
  assert.deepEqual((await store.readNodeResults('wf-missing')), [])
  await fs.rm(dir, { recursive: true, force: true })
})
