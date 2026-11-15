/**
 * workflows 宿主侧单测：作业创建、调度、任务创建校验、助理、结束投递、结算、
 * 重试 / 取消、重启恢复、clock、附件与可见性、路由桩。
 *
 * 用内存版 storageDomain + 假的 workers / 发起人投递，直接驱动真实引擎；
 * 不依赖 DSH 宿主。运行：
 *
 *   node --test test/workflows-server.test.mjs
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { visibleAttachmentsForTask } from '../plugins/workflows/src/attachments/index.ts'
import { START_TASK_ID } from '../plugins/workflows/src/domain/ids.ts'
import { WorkflowEngine } from '../plugins/workflows/src/engine/engine.ts'
import { registerWorkflowRoutes } from '../plugins/workflows/src/routes/index.ts'
import { WorkflowStore } from '../plugins/workflows/src/store/index.ts'
import { toV7 } from './workflows-fixture-v7.mjs'

// ---------------------------------------------------------------------------
// 内存版 storageDomain
// ---------------------------------------------------------------------------

/** 一张内存表（与 KvTable 的读写 / 原子 update 语义一致）。 */
class FakeTable {
  constructor() {
    this.map = new Map()
  }

  get(key) {
    return this.map.get(key)
  }

  entries() {
    return this.map.entries()
  }

  keys() {
    return this.map.keys()
  }

  get size() {
    return this.map.size
  }

  async put(key, value) {
    this.map.set(key, value)
  }

  async delete(key) {
    return this.map.delete(key)
  }

  async deleteMany(keys) {
    let removed = 0
    for (const key of keys) if (this.map.delete(key)) removed += 1
    return removed
  }

  async update(key, fn) {
    if (!this.map.has(key)) throw new Error(`missing-key: ${key}`)
    const next = fn(this.map.get(key))
    this.map.set(key, next)
    return next
  }
}

/** 域的纯内存实现。 */
class FakeDomain {
  constructor() {
    this.name = 'buka_workflow'
    this.tables = {
      workflows: new FakeTable(),
      jobs: new FakeTable(),
      tasks: new FakeTable(),
      attempts: new FakeTable(),
      attachments: new FakeTable(),
    }
  }

  table(name) {
    const table = this.tables[name]
    if (table === undefined) throw new Error(`no table ${name}`)
    return table
  }

  async close() {}
}

// ---------------------------------------------------------------------------
// 测试夹具：打工人、会话句柄、发起人投递、工作流定义
// ---------------------------------------------------------------------------

/** 测试里的打工人登记表。 */
const WORKER_ENTRIES = [
  { name: '软件工程师', driver: 'agent', assistant: false, avatar: 'rocket' },
  { name: '质量保障工程师', driver: 'agent', assistant: false, avatar: 'owl' },
  { name: '沟通助理', driver: 'agent', assistant: true, avatar: 'panda' },
  { name: 'clock', driver: 'robot', program: 'clock', assistant: false, avatar: 'bee' },
]

/** 一个可操纵的 workers 句柄。 */
function makeHandle(sessionId) {
  const state = { turnEnded: false, cancelled: false }
  return {
    sessionId,
    startSeq: 0,
    resumed: false,
    state,
    readResult() {
      return {
        sessionId,
        text: '',
        stopReason: state.turnEnded ? 'stop' : '',
        turnEnded: state.turnEnded,
      }
    },
    async send() {
      return 0
    },
    async cancel() {
      state.cancelled = true
    },
    async dispose() {},
    getPlanMode() {
      return null
    },
    setPlanMode() {},
    /** 测试钩子：结束这一轮但不调用 buka_task_complete。 */
    endTurn() {
      state.turnEnded = true
    },
  }
}

/** 假的 workers 服务。 */
function makeWorkers(entries = WORKER_ENTRIES) {
  const dispatched = []
  const handles = new Map()
  return {
    dispatched,
    handles,
    async list() {
      return { workers: entries, corrupt: false }
    },
    async dispatchSession(request) {
      const sessionId = `session-${dispatched.length + 1}`
      const handle = makeHandle(sessionId)
      handles.set(sessionId, handle)
      dispatched.push({ request, sessionId, handle })
      return handle
    },
    async openSession(request) {
      const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
      const existing = handles.get(sessionId)
      if (existing !== undefined) return existing
      const handle = makeHandle(sessionId)
      handles.set(sessionId, handle)
      return handle
    },
  }
}

/** 假的发起人会话投递。 */
function makeDelivery() {
  return {
    messages: [],
    async deliver(sessionId, text) {
      this.messages.push({ sessionId, text })
      return 0
    },
  }
}

/** 测试用 options。 */
function makeOptions(dataDir) {
  return {
    dataDir,
    taskTimeoutMs: 0,
    pollIntervalMs: 5,
    maxAttachmentBytes: 1024 * 1024,
    maxAttachmentsPerTask: 10,
    maxTaskAttachmentsBytes: 4 * 1024 * 1024,
    maxInlineAttachmentBytes: 1024 * 1024,
    maxResultTextBytes: 1024 * 1024,
    orchestratorPresets: ['workflow-orchestrator'],
    workerPreset: 'standard',
  }
}

/** 轮询等待条件成立。 */
async function waitFor(check, timeoutMs = 1500) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`waitFor timed out: ${check}`)
}

/** 简单定义：start → dev(agent) → end。 */
function simpleDevDefinition() {
  return toV7({
    version: 6,
    name: '简单研发',
    budgets: { maxTasks: 20, maxDurationHours: 24 },
    start: {
      task: {
        payload: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
        },
        output: {
          type: 'object',
          properties: { requirement: { type: 'string' } },
          required: ['requirement'],
        },
      },
      next: [
        {
          channel: 'start.dev',
          type: 'dev.implement',
          payload: { requirement: '{{start.output.requirement}}' },
          dependsOn: ['$start'],
        },
      ],
    },
    end: {
      task: {
        payload: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    },
    positions: [
      {
        id: 'dev',
        label: '研发',
        executor: { kind: 'worker', name: '软件工程师' },
        taskTypes: [
          {
            id: 'dev.implement',
            label: '开发',
            prompt: '实现需求，完成后创建交付任务。',
            payload: {
              type: 'object',
              properties: { requirement: { type: 'string' } },
              required: ['requirement'],
            },
            output: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
            },
          },
        ],
      },
    ],
    channels: [
      { id: 'start.dev', label: '开始研发', from: 'start', to: 'dev' },
      { id: 'dev.end', label: '直接交付', from: 'dev', to: 'end' },
    ],
  })
}

/** 研发 + 测试：dev → qa（验证）→ dev（返工，回边）→ end。 */
function reviewDefinition() {
  return toV7({
    version: 6,
    name: '研发与验证',
    budgets: { maxTasks: 40, maxDurationHours: 24 },
    start: {
      task: {
        payload: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
        },
        output: {
          type: 'object',
          properties: { requirement: { type: 'string' } },
          required: ['requirement'],
        },
      },
      next: [
        {
          channel: 'start.dev',
          type: 'dev.implement',
          payload: { requirement: '{{start.output.requirement}}' },
          dependsOn: ['$start'],
        },
      ],
    },
    end: {
      task: {
        payload: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    },
    positions: [
      {
        id: 'dev',
        label: '研发',
        executor: { kind: 'worker', name: '软件工程师' },
        taskTypes: [
          {
            id: 'dev.implement',
            label: '开发',
            prompt: '实现需求，完成后创建交付任务。',
            payload: {
              type: 'object',
              properties: { requirement: { type: 'string' } },
              required: ['requirement'],
            },
            output: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
            },
          },
          {
            id: 'dev.rework',
            label: '返工',
            payload: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
            },
            output: { type: 'object' },
          },
        ],
      },
      {
        id: 'qa',
        label: '测试',
        executor: { kind: 'worker', name: '质量保障工程师' },
        taskTypes: [
          {
            id: 'qa.verify',
            label: '验证',
            requires: [{ types: ['dev.implement'] }],
            payload: {
              type: 'object',
              properties: { focus: { type: 'string' } },
              required: ['focus'],
            },
            output: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['pass', 'fail'] },
                summary: { type: 'string' },
              },
              required: ['result', 'summary'],
            },
          },
        ],
      },
    ],
    channels: [
      { id: 'start.dev', label: '开始研发', from: 'start', to: 'dev' },
      { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa', types: ['qa.verify'] },
      { id: 'dev.end', label: '直接交付', from: 'dev', to: 'end' },
      {
        id: 'qa.dev.rework',
        label: '返工',
        from: 'qa',
        to: 'dev',
        types: ['dev.rework'],
        back: true,
      },
      { id: 'qa.end', label: '验证通过交付', from: 'qa', to: 'end' },
    ],
  })
}

/** 人岗位 + 助理：start → approve(human) → end。 */
function assistantDefinition() {
  const definition = toV7({
    version: 6,
    name: '发布审批',
    budgets: { maxTasks: 10, maxDurationHours: 24 },
    start: {
      task: {
        payload: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
        },
        output: { type: 'object', properties: {}, additionalProperties: true },
      },
      next: [
        {
          channel: 'start.approve',
          type: 'approve.release',
          payload: {},
          dependsOn: ['$start'],
        },
      ],
    },
    end: {
      task: {
        payload: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    },
    positions: [
      {
        id: 'approve',
        label: '发布审批',
        executor: { kind: 'human' },
        taskTypes: [
          {
            id: 'approve.release',
            label: '批准发布',
            assistant: '沟通助理',
            payload: { type: 'object', properties: {} },
            output: {
              type: 'object',
              properties: {
                approved: { type: 'string', enum: ['yes', 'no'] },
                note: { type: 'string' },
              },
              required: ['approved'],
            },
          },
        ],
      },
    ],
    channels: [
      { id: 'start.approve', label: '送审', from: 'start', to: 'approve' },
      { id: 'approve.end', label: '交付', from: 'approve', to: 'end' },
    ],
  })
  definition.positions[0].taskTypes[0].actions = [
    {
      id: 'approve',
      label: '批准',
      creates: [{ channel: 'approve.end', content: { summary: '批准并发布' } }],
    },
    {
      id: 'reject',
      label: '打回',
      input: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: ['note'],
      },
      creates: [{ channel: 'approve.end', content: { summary: '{{input.note}}' } }],
    },
  ]
  return definition
}

/** clock 机器人：start → wait(clock) → end。 */
function clockDefinition() {
  return toV7({
    version: 6,
    name: '定时等待',
    budgets: { maxTasks: 10, maxDurationHours: 24 },
    start: {
      task: {
        payload: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
        },
        output: {
          type: 'object',
          properties: { until: { type: 'string' } },
          required: ['until'],
        },
      },
      next: [
        {
          channel: 'start.wait',
          type: 'wait.until',
          payload: { until: '{{start.output.until}}' },
          dependsOn: ['$start'],
        },
      ],
    },
    end: {
      task: {
        payload: { type: 'object', properties: { summary: { type: 'string' } } },
      },
    },
    positions: [
      {
        id: 'wait',
        label: '等待',
        executor: { kind: 'worker', name: 'clock' },
        taskTypes: [
          {
            id: 'wait.until',
            label: '等待到点',
            payload: {
              type: 'object',
              properties: { until: { type: 'string' } },
              required: ['until'],
            },
            output: {
              type: 'object',
              properties: { completedAt: { type: 'string' } },
              required: ['completedAt'],
            },
          },
        ],
      },
    ],
    channels: [
      { id: 'start.wait', label: '开始等待', from: 'start', to: 'wait' },
      { id: 'wait.end', label: '等待结束', from: 'wait', to: 'end' },
    ],
  })
}

/** 预算装不下的定义：maxTasks=1 但 start.next 有两条初始任务。 */
function overBudgetDefinition() {
  const definition = simpleDevDefinition()
  definition.budgets.maxTasks = 1
  definition.start.next = [
    {
      channel: 'start.dev',
      type: 'dev.implement',
      content: { requirement: 'a' },
    },
    {
      channel: 'start.dev',
      type: 'dev.implement',
      content: { requirement: 'b' },
    },
  ]
  return definition
}

/** 建一套引擎 + 存储 + 已激活工作流。 */
async function setup(definition) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-engine-'))
  const domain = new FakeDomain()
  const store = new WorkflowStore({ domain, dataDir })
  await store.init()
  const workers = makeWorkers()
  const delivery = makeDelivery()
  const engine = new WorkflowEngine({
    ctx: {},
    store,
    options: makeOptions(dataDir),
    logger: undefined,
    workers: () => workers,
    delivery,
  })
  await engine.start()
  const workflow = await engine.saveWorkflow({ definition })
  await engine.setWorkflowActive(workflow.id, true)
  return {
    engine,
    store,
    domain,
    workers,
    delivery,
    dataDir,
    workflowId: workflow.id,
    async cleanup() {
      engine.dispose()
      await fs.rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** 作业任务。 */
function jobTasks(store, jobId) {
  return store.listTasks(jobId)
}

/** 取某个岗位的任务。 */
function taskAt(store, jobId, position) {
  return jobTasks(store, jobId).find((task) => task.position === position)
}

// ---------------------------------------------------------------------------
// 作业创建与调度
// ---------------------------------------------------------------------------

test('engine: the start task id can be used as a storageDomain record key', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    // storageDomain 的 json 后端按记录 id 分文件，只接受 [a-zA-Z0-9_-]。
    assert.match(START_TASK_ID, /^[a-zA-Z0-9_-]+$/u)
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    const tasks = jobTasks(env.store, job.id)
    const start = tasks.find((task) => task.position === 'start')
    assert.equal(start.id, START_TASK_ID)
    const dev = tasks.find((task) => task.position === 'dev')
    assert.deepEqual(dev.deps, [START_TASK_ID])
  } finally {
    await env.cleanup()
  }
})

test('engine: the end task can be handed to an assistant acting as a secretary', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '发布需求' },
      sessionId: 'starter-session',
      delivery: { kind: 'assistant', name: '沟通助理' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const devSession = env.workers.dispatched[0].sessionId
    const dev = taskAt(env.store, job.id, 'dev')
    await env.engine.createTaskFromTarget({
      sessionId: devSession,
      target: 'end',
      content: { summary: '最终报告' },
      deps: [dev.id],
    })
    await env.engine.completeTaskFromSession({ sessionId: devSession, text: '', attachments: [] })
    await waitFor(() => env.workers.dispatched.length === 2)
    const secretary = env.workers.dispatched[1]
    assert.equal(secretary.request.worker, '沟通助理')
    const end = taskAt(env.store, job.id, 'end')
    assert.equal(end.status, 'running')
    assert.equal(end.claimant.kind, 'worker')
    assert.match(secretary.request.prompt, /最终报告/u)

    await env.engine.completeTaskFromSession({
      sessionId: secretary.sessionId,
      text: '已代收',
      attachments: [],
    })
    await waitFor(() => env.store.getJob(job.id).status === 'completed')
  } finally {
    await env.cleanup()
  }
})

test('engine: the delivery assistant must exist and be marked as an assistant', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    await assert.rejects(
      () =>
        env.engine.createJobFromSession({
          workflowId: env.workflowId,
          content: { requirement: 'x' },
          sessionId: 'starter-session',
          delivery: { kind: 'assistant', name: '不存在' },
        }),
      /unknown assistant/u,
    )
    await assert.rejects(
      () =>
        env.engine.createJobFromSession({
          workflowId: env.workflowId,
          content: { requirement: 'x' },
          sessionId: 'starter-session',
          delivery: { kind: 'assistant', name: '软件工程师' },
        }),
      /not marked as an assistant/u,
    )
    assert.equal(env.store.allJobs().length, 0)
  } finally {
    await env.cleanup()
  }
})

test('engine: a human-started job completes the start task and dispatches the first task', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    assert.equal(job.status, 'running')
    assert.equal(job.seq, 1)
    const start = taskAt(env.store, job.id, 'start')
    assert.equal(start.status, 'completed')
    assert.equal(start.channel, null, 'the start task has no inbound channel')
    assert.deepEqual(start.content, { requirement: '登录页需求' })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    assert.equal(dev.status, 'running')
    assert.equal(dev.channel, 'start.dev')
    assert.deepEqual(dev.content, { requirement: '登录页需求' })
    const dispatch = env.workers.dispatched[0]
    assert.equal(dispatch.request.worker, '软件工程师')
    assert.match(dispatch.request.prompt, /## 工作流规则/u)
    assert.match(dispatch.request.prompt, /## 任务类型的定义/u)
    assert.match(dispatch.request.prompt, /实现需求，完成后创建交付任务。/u)
    assert.match(dispatch.request.prompt, /## 任务内容/u)
    assert.match(dispatch.request.prompt, /登录页需求/u)
    assert.doesNotMatch(dispatch.request.prompt, /结果结构|通道|岗位|作业 #/u)
    assert.equal(env.engine.taskForSession(dispatch.sessionId)?.taskId, dev.id)

    await env.engine.completeTaskFromSession({
      sessionId: dispatch.sessionId,
      text: '页面已完成',
      attachments: [],
    })
    assert.equal(env.store.getTask(dev.id).status, 'completed')
    // 没有结束任务完成 → 作业结束为 failed。
    assert.equal(env.store.getJob(job.id).status, 'failed')
    assert.equal(env.engine.taskForSession(dispatch.sessionId), null)
  } finally {
    await env.cleanup()
  }
})

test('engine: the end report is delivered to the starter session and waits for confirmation', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '发布需求' },
      sessionId: 'starter-session',
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const sessionId = env.workers.dispatched[0].sessionId
    await env.engine.createTaskFromSession({
      sessionId,
      channel: 'dev.end',
      type: 'end',
      content: { summary: '最终交付物' },
      deps: [dev.id],
    })
    assert.equal(taskAt(env.store, job.id, 'end').status, 'pending')
    await env.engine.completeTaskFromSession({
      sessionId,
      text: '',
      attachments: [],
    })
    await waitFor(() => env.delivery.messages.length === 1)
    const message = env.delivery.messages[0]
    assert.equal(message.sessionId, 'starter-session')
    assert.match(message.text, /最终交付物/u)
    assert.match(message.text, /buka_task_complete/u)
    const endTask = taskAt(env.store, job.id, 'end')
    assert.equal(endTask.status, 'running', 'delivered, waiting for the starter to confirm')
    assert.equal(env.store.getJob(job.id).status, 'running')

    await env.engine.completeTaskFromSession({
      sessionId: 'starter-session',
      text: '已收到',
      attachments: [],
    })
    await waitFor(() => env.store.getJob(job.id).status === 'completed')
    assert.equal(taskAt(env.store, job.id, 'end').status, 'completed')
    assert.equal((await env.engine.jobDetail(job.id)).canRetryDelivery, false)
  } finally {
    await env.cleanup()
  }
})

test('engine: a session-started job creates its first tasks immediately', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '注册页需求' },
      sessionId: 'starter-session',
    })
    const start = taskAt(env.store, job.id, 'start')
    assert.equal(start.status, 'completed')
    assert.deepEqual(env.store.getJob(job.id).input, { requirement: '注册页需求' })
    await waitFor(() => env.workers.dispatched.length === 1)
    assert.match(env.workers.dispatched[0].request.prompt, /注册页需求/u)
    assert.equal(env.delivery.messages.length, 0, 'nothing is pushed to the starter at job start')
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 任务创建校验
// ---------------------------------------------------------------------------

test('engine: task creation enforces channels, types, content, dependencies and budget', async () => {
  const env = await setup(reviewDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const sessionId = env.workers.dispatched[0].sessionId

    const qa = await env.engine.createTaskFromSession({
      sessionId,
      channel: 'dev.qa',
      type: 'qa.verify',
      content: { focus: '登录流程' },
      deps: [dev.id],
    })
    assert.equal(qa.status, 'pending')
    assert.equal(qa.channel, 'dev.qa')
    assert.equal(qa.position, 'qa')

    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          channel: 'nobody',
          type: 'qa.verify',
          content: {},
          deps: [],
        }),
      /unknown channel/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          channel: 'qa.dev.rework',
          type: 'dev.rework',
          content: { summary: 'x' },
          deps: [dev.id],
        }),
      /starts at "qa"/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          channel: 'dev.end',
          type: 'qa.verify',
          content: {},
          deps: [],
        }),
      /built-in end contract/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          channel: 'dev.qa',
          type: 'dev.rework',
          content: { summary: 'x' },
          deps: [dev.id],
        }),
      /not a task type of position "qa"/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          channel: 'dev.qa',
          type: 'qa.verify',
          content: {},
          deps: [dev.id],
        }),
      /does not match task type/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          channel: 'dev.qa',
          type: 'qa.verify',
          content: { focus: 'x' },
          deps: ['task-does-not-exist'],
        }),
      /does not exist in this job/u,
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: a channel type whitelist rejects a declared task type', async () => {
  const definition = reviewDefinition()
  definition.channels = [
    { id: 'start.dev', label: '开始研发', from: 'start', to: 'dev' },
    { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa', types: ['qa.verify'] },
    {
      id: 'qa.dev.rework',
      label: '返工',
      from: 'qa',
      to: 'dev',
      types: ['dev.rework'],
      back: true,
    },
    { id: 'qa.end', label: '验证通过交付', from: 'qa', to: 'end' },
  ]
  const env = await setup(definition)
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const devSession = env.workers.dispatched[0].sessionId
    const qa = await env.engine.createTaskFromSession({
      sessionId: devSession,
      channel: 'dev.qa',
      type: 'qa.verify',
      content: { focus: 'x' },
      deps: [dev.id],
    })
    await env.engine.completeTaskFromSession({ sessionId: devSession, text: '', attachments: [] })
    await waitFor(() => env.workers.dispatched.length === 2)
    const qaSession = env.workers.dispatched[1].sessionId
    assert.equal(env.store.getTask(qa.id).status, 'running')
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId: qaSession,
          channel: 'qa.dev.rework',
          type: 'dev.implement',
          content: { requirement: 'again' },
          deps: [dev.id],
        }),
      /does not allow task type "dev.implement"/u,
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: parallel channels with overlapping types are chosen explicitly', async () => {
  const definition = reviewDefinition()
  definition.channels.push({
    id: 'dev.qa.urgent',
    label: '加急提测',
    from: 'dev',
    to: 'qa',
    types: ['qa.verify'],
  })
  const env = await setup(definition)
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const sessionId = env.workers.dispatched[0].sessionId
    const prompt = env.workers.dispatched[0].request.prompt
    assert.doesNotMatch(prompt, /提测/u, 'channels are not listed in the execution prompt')
    const qa = await env.engine.createTaskFromSession({
      sessionId,
      channel: 'dev.qa.urgent',
      type: 'qa.verify',
      content: { focus: 'x' },
      deps: [dev.id],
    })
    assert.equal(qa.channel, 'dev.qa.urgent')
    assert.equal(qa.position, 'qa')
  } finally {
    await env.cleanup()
  }
})

test('engine: execution prompt is exactly the three model-facing sections', async () => {
  const definition = reviewDefinition()
  definition.positions[0].taskTypes[0].definition = '任务类型的定义：先读依赖结果，再实现。'
  const env = await setup(definition)
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const prompt = env.workers.dispatched[0].request.prompt
    const headings = ['## 工作流规则', '## 任务类型的定义', '## 任务内容']
    let cursor = -1
    for (const heading of headings) {
      const index = prompt.indexOf(heading)
      assert.ok(index > cursor, `${heading} should appear in this order`)
      cursor = index
    }
    assert.match(prompt, /任务类型的定义：先读依赖结果，再实现。/u)
    assert.match(prompt, /"requirement": "登录页需求"/u, 'the rendered content is the last section')
    assert.doesNotMatch(prompt, /岗位|通道|作业 #/u, 'no authoring vocabulary')
    assert.doesNotMatch(prompt, /研发|测试|软件工程师|开始研发|提测/u, 'no labels or channel names')
  } finally {
    await env.cleanup()
  }
})

test('engine: creatable targets hide channels and create tasks by target', async () => {
  const env = await setup(reviewDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const sessionId = env.workers.dispatched[0].sessionId

    const targets = env.engine.creatableTargetsForSession(sessionId)
    assert.deepEqual(
      targets.map((target) => target.target),
      ['qa.verify', 'end'],
    )
    assert.ok(targets[0].content?.properties !== undefined, 'targets carry the content schema')
    assert.doesNotMatch(JSON.stringify(targets), /dev\.qa|qa\.end|position/u)

    const qa = await env.engine.createTaskFromTarget({
      sessionId,
      target: 'qa.verify',
      content: { focus: '检查' },
      deps: [dev.id],
    })
    assert.equal(qa.position, 'qa')
    assert.equal(qa.channel, 'dev.qa')

    const end = await env.engine.createTaskFromTarget({
      sessionId,
      target: 'end',
      content: { summary: 'x' },
      deps: [],
    })
    assert.deepEqual(end.deps, [dev.id], 'omitted deps default to the creating task')

    await assert.rejects(
      () =>
        env.engine.createTaskFromTarget({
          sessionId,
          target: 'dev.rework',
          content: {},
          deps: [dev.id],
        }),
      /cannot be created from this task/u,
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: exceeding maxTasks fails job creation', async () => {
  const env = await setup(overBudgetDefinition())
  try {
    await assert.rejects(
      () =>
        env.engine.createJobFromHuman({
          workflowId: env.workflowId,
          content: { requirement: 'x' },
        }),
      /budget maxTasks/u,
    )
    const jobs = env.store.allJobs()
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].status, 'failed')
  } finally {
    await env.cleanup()
  }
})

test('engine: a task type may accept a string as its task content', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].content = { type: 'string' }
  definition.start.next = [{ channel: 'start.dev', type: 'dev.implement', content: '做登录页' }]
  const env = await setup(definition)
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    assert.equal(dev.content, '做登录页')
    assert.match(env.workers.dispatched[0].request.prompt, /做登录页/u)
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 人任务与助理
// ---------------------------------------------------------------------------

test('engine: a named assistant takes a human task and completes it with an action', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: {},
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dispatch = env.workers.dispatched[0]
    assert.equal(dispatch.request.worker, '沟通助理')
    const approve = taskAt(env.store, job.id, 'approve')
    assert.equal(approve.status, 'running')
    assert.equal(approve.claimant.kind, 'assistant')
    assert.match(dispatch.request.prompt, /buka_task_actions/u)

    const actions = env.engine.taskActionsForSession(dispatch.sessionId)
    assert.deepEqual(
      actions.map((action) => action.id),
      ['approve', 'reject'],
    )

    await env.engine.completeTaskFromSession({
      sessionId: dispatch.sessionId,
      action: 'approve',
      text: '用户批准',
      attachments: [],
    })
    const end = taskAt(env.store, job.id, 'end')
    assert.equal(end.status, 'ready')
    assert.match(end.content.summary, /批准/u)
    const approveTask = taskAt(env.store, job.id, 'approve')
    assert.deepEqual(approveTask.result.action, { id: 'approve', label: '批准' })

    // 人发起的作业：结束任务落在发起人自己的看板上，确认后才结束作业。
    await env.engine.completeTaskAsHuman({
      jobId: job.id,
      taskId: end.id,
      text: '已收到',
      attachments: [],
    })
    await waitFor(() => env.store.getJob(job.id).status === 'completed')
  } finally {
    await env.cleanup()
  }
})

test('engine: a failed assistant returns the human task to 待认领 and a human can finish it', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 1)
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => taskAt(env.store, job.id, 'approve').status === 'ready')
    const approve = taskAt(env.store, job.id, 'approve')
    assert.equal(approve.assistantBlocked, true)
    assert.equal(approve.claimant, null)
    const attempts = env.store.listAttempts(approve.id)
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0].status, 'failed')

    const claimed = await env.engine.claimTaskAsHuman(job.id, approve.id)
    assert.equal(claimed.status, 'running')
    const completed = await env.engine.completeTaskAsHuman({
      jobId: job.id,
      taskId: approve.id,
      action: 'reject',
      input: { note: '不通过' },
      text: '人自己处理',
      attachments: [],
    })
    assert.equal(completed.status, 'completed')
    assert.deepEqual(completed.result.input, { note: '不通过' })
  } finally {
    await env.cleanup()
  }
})

test('engine: a human action creates the declared task only after validation', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 1)
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => taskAt(env.store, job.id, 'approve').status === 'ready')
    const approve = taskAt(env.store, job.id, 'approve')

    await assert.rejects(
      () =>
        env.engine.completeTaskAsHuman({
          jobId: job.id,
          taskId: approve.id,
          action: 'reject',
          input: {},
          text: '',
          attachments: [],
        }),
      /does not match the action contract/u,
    )
    assert.equal(taskAt(env.store, job.id, 'approve').status, 'ready')
    assert.equal(
      jobTasks(env.store, job.id).filter((task) => task.position === 'end').length,
      0,
      'nothing is created when the form is invalid',
    )

    await env.engine.completeTaskAsHuman({
      jobId: job.id,
      taskId: approve.id,
      action: 'reject',
      input: { note: '回去改' },
      text: '',
      attachments: [],
    })
    const end = taskAt(env.store, job.id, 'end')
    assert.equal(end.status, 'ready')
    assert.equal(end.content.summary, '回去改')
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 技术失败、重试、取消
// ---------------------------------------------------------------------------

test('engine: a task session that ends without completing fails the task, and retry adds a new attempt', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => env.store.getTask(dev.id).status === 'failed')
    // 失败任务等待人工决定，作业仍是 running。
    assert.equal(env.store.getJob(job.id).status, 'running')
    assert.match(env.store.getTask(dev.id).error, /without calling buka_task_complete/u)

    await env.engine.retryTask(job.id, dev.id)
    await waitFor(() => env.workers.dispatched.length === 2)
    assert.equal(env.store.getTask(dev.id).status, 'running')
    assert.deepEqual(
      env.store.listAttempts(dev.id).map((attempt) => attempt.status),
      ['failed', 'running'],
    )

    const cancelled = await env.engine.cancelJob(job.id)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(env.store.getTask(dev.id).status, 'cancelled')
    assert.equal(env.workers.dispatched[1].handle.state.cancelled, true)
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 重启恢复
// ---------------------------------------------------------------------------

test('engine: restart resumes the same agent session for a running task', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-recovery-'))
  try {
    const domain = new FakeDomain()
    const store = new WorkflowStore({ domain, dataDir })
    await store.init()
    const workers = makeWorkers()
    const delivery = makeDelivery()
    const options = makeOptions(dataDir)
    const first = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => workers,
      delivery,
    })
    await first.start()
    const workflow = await first.saveWorkflow({ definition: simpleDevDefinition() })
    await first.setWorkflowActive(workflow.id, true)
    const job = await first.createJobFromHuman({
      workflowId: workflow.id,
      content: { requirement: 'x' },
    })
    await waitFor(() => workers.dispatched.length === 1)
    const dev = taskAt(store, job.id, 'dev')
    const sessionId = workers.dispatched[0].sessionId
    first.dispose()

    const second = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => workers,
      delivery,
    })
    await second.start()
    await waitFor(() => store.getTask(dev.id).status === 'running')
    assert.equal(second.taskForSession(sessionId)?.taskId, dev.id)
    await second.completeTaskFromSession({ sessionId, text: '恢复后完成', attachments: [] })
    assert.equal(store.getTask(dev.id).status, 'completed')
    second.dispose()
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 机器人
// ---------------------------------------------------------------------------

test('engine: clock program tasks complete without a session', async () => {
  const env = await setup(clockDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { until: new Date(Date.now() - 1000).toISOString() },
    })
    assert.equal(env.workers.dispatched.length, 0)
    const wait = taskAt(env.store, job.id, 'wait')
    await waitFor(() => env.store.getTask(wait.id).status === 'completed')
    const stored = env.store.getTask(wait.id)
    assert.match(stored.result.text, /clock 到点/u)
    assert.equal(stored.claimant.kind, 'worker')
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 头像：workers 服务晚于 workflows 就绪时，定义图仍要拿到打工人头像
// ---------------------------------------------------------------------------

test('engine: workflow detail resolves worker avatars even when the workers service starts late', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-avatar-'))
  const store = new WorkflowStore({ domain: new FakeDomain(), dataDir })
  await store.init()
  const workers = makeWorkers()
  const delivery = makeDelivery()
  const options = makeOptions(dataDir)
  let workersReady = true
  let engine
  try {
    engine = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => (workersReady ? workers : null),
      delivery,
    })
    await engine.start()
    const workflow = await engine.saveWorkflow({ definition: simpleDevDefinition() })
    await engine.setWorkflowActive(workflow.id, true)
    engine.dispose()

    // 重启：workflows 先于 workers 插件初始化，start() 时读不到登记表。
    workersReady = false
    engine = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => (workersReady ? workers : null),
      delivery,
    })
    await engine.start()
    workersReady = true

    const detail = await engine.readWorkflowDetail(workflow.id)
    const positions = detail?.graph?.positions ?? []
    assert.equal(positions[0]?.executor?.avatar, 'rocket', 'the worker avatar reaches the graph')
  } finally {
    engine?.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 附件
// ---------------------------------------------------------------------------

test('attachments: a task result attaches files and downstream tasks can read them', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-workspace-'))
  try {
    await fs.mkdir(path.join(workspace, 'artifacts'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'artifacts', 'report.txt'), 'hello attachment', 'utf8')
    // 打工人工作区指向临时目录（附件相对路径的根）。
    const workers = makeWorkers([
      { name: '软件工程师', driver: 'agent', assistant: false, path: workspace },
      { name: '质量保障工程师', driver: 'agent', assistant: false, path: workspace },
    ])
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-attach-'))
    try {
      const domain = new FakeDomain()
      const store = new WorkflowStore({ domain, dataDir })
      await store.init()
      const delivery = makeDelivery()
      const engine = new WorkflowEngine({
        ctx: {},
        store,
        options: makeOptions(dataDir),
        logger: undefined,
        workers: () => workers,
        delivery,
      })
      await engine.start()
      const workflow = await engine.saveWorkflow({ definition: reviewDefinition() })
      await engine.setWorkflowActive(workflow.id, true)
      const job = await engine.createJobFromHuman({
        workflowId: workflow.id,
        content: { requirement: 'x' },
      })
      await waitFor(() => workers.dispatched.length === 1)
      const dev = taskAt(store, job.id, 'dev')
      const devSession = workers.dispatched[0].sessionId
      await engine.createTaskFromSession({
        sessionId: devSession,
        channel: 'dev.qa',
        type: 'qa.verify',
        content: { focus: 'x' },
        deps: [dev.id],
      })
      await engine.completeTaskFromSession({
        sessionId: devSession,
        text: '',
        attachments: [{ path: 'artifacts/report.txt', name: 'report.txt', description: '报告' }],
      })
      const attachments = store.listAttachments(job.id)
      assert.equal(attachments.length, 1)
      assert.equal(attachments[0].name, 'report.txt')
      assert.equal(attachments[0].sourceTaskId, dev.id)
      assert.equal(attachments[0].sourcePositionId, 'dev')
      assert.equal(attachments[0].description, '报告')
      assert.match(attachments[0].sha256, /^[0-9a-f]{64}$/u)
      const opened = engine.openAttachment(job.id, attachments[0].id)
      assert.equal(await fs.readFile(opened.file, 'utf8'), 'hello attachment')

      // 下游 qa 任务可见 dev 的附件；无关任务不可见。
      await waitFor(() => workers.dispatched.length === 2)
      const qaSession = workers.dispatched[1].sessionId
      const visible = engine.searchAttachmentsForSession(qaSession, '')
      assert.equal(visible.length, 1)
      const inline = await engine.readAttachmentForSession(qaSession, attachments[0].id)
      assert.equal(inline.text, 'hello attachment')

      const tasks = store.listTasks(job.id)
      const qa = taskAt(store, job.id, 'qa')
      assert.equal(visibleAttachmentsForTask(tasks, qa.id, attachments).length, 1)
      assert.equal(visibleAttachmentsForTask(tasks, 'task-unrelated', attachments).length, 0)
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 路由桩
// ---------------------------------------------------------------------------

test('routes: registers the contract paths and answers the workflow list', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const registered = []
    const webCtx = {
      webServer: {
        register(route) {
          registered.push(route)
          return () => {}
        },
      },
      connection: { requestRejection: () => undefined },
      effect: (fn) => fn(),
      logger: undefined,
    }
    const ctx = {
      inject(_names, callback) {
        callback(webCtx)
      },
    }
    registerWorkflowRoutes({ ctx, ready: async () => env.engine })
    const paths = registered.map((route) => route.path)
    for (const expected of [
      '/buka-workflows/workflows',
      '/buka-workflows/workflow',
      '/buka-workflows/workflow/activate',
      '/buka-workflows/jobs',
      '/buka-workflows/job/start',
      '/buka-workflows/job',
      '/buka-workflows/job/action',
      '/buka-workflows/task',
      '/buka-workflows/task/action',
      '/buka-workflows/attachments',
      '/buka-workflows/attachment',
    ]) {
      assert.ok(paths.includes(expected), `missing route ${expected}`)
    }

    const route = registered.find((entry) => entry.path === '/buka-workflows/workflows')
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value
      },
      end(body) {
        this.body = body
      },
    }
    const req = {
      method: 'GET',
      url: '/buka-workflows/workflows',
      headers: {},
      async *[Symbol.asyncIterator]() {},
    }
    await route.handler(req, res)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.workflows.length, 1)
    assert.equal(payload.workflows[0].status, 'active')
  } finally {
    await env.cleanup()
  }
})
