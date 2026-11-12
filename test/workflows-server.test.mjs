/**
 * workflows 宿主侧单测：作业创建、调度、任务创建校验、助理、结束投递、结算、
 * 重试 / 取消、重启恢复、clock、附件与可见性、路由桩。
 *
 * 用内存版 storageDomain + 假的 robots / 启动者投递，直接驱动真实引擎；
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
// 测试夹具：机器人、会话句柄、启动者投递、工作流定义
// ---------------------------------------------------------------------------

/** 测试里的机器人登记表。 */
const ROBOT_ENTRIES = [
  { name: '软件工程师', driver: 'agent', assistant: false },
  { name: '质量保障工程师', driver: 'agent', assistant: false },
  { name: '沟通助理', driver: 'agent', assistant: true },
  { name: 'clock', driver: 'program', program: 'clock', assistant: false },
]

/** 一个可操纵的 robots 句柄。 */
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

/** 假的 robots 服务。 */
function makeRobots(entries = ROBOT_ENTRIES) {
  const dispatched = []
  const handles = new Map()
  return {
    dispatched,
    handles,
    async list() {
      return { robots: entries, corrupt: false }
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

/** 假的启动者会话投递。 */
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
    robotPreset: 'standard',
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
  return {
    version: 4,
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
          position: 'dev',
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
        executor: { kind: 'robot', name: '软件工程师' },
        taskTypes: [
          {
            id: 'dev.implement',
            label: '开发',
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
    edges: [
      { from: 'start', to: 'dev' },
      { from: 'dev', to: 'end' },
    ],
  }
}

/** 研发 + 测试：dev → qa（验证）→ dev（返工，回边）→ end。 */
function reviewDefinition() {
  return {
    version: 4,
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
          position: 'dev',
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
        executor: { kind: 'robot', name: '软件工程师' },
        taskTypes: [
          {
            id: 'dev.implement',
            label: '开发',
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
        executor: { kind: 'robot', name: '质量保障工程师' },
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
    edges: [
      { from: 'start', to: 'dev' },
      { from: 'dev', to: 'qa', types: ['qa.verify'] },
      { from: 'dev', to: 'end' },
      { from: 'qa', to: 'dev', types: ['dev.rework'], back: true },
      { from: 'qa', to: 'end' },
    ],
  }
}

/** 人岗位 + 助理：start → approve(human) → end。 */
function assistantDefinition() {
  return {
    version: 4,
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
          position: 'approve',
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
    edges: [
      { from: 'start', to: 'approve' },
      { from: 'approve', to: 'end' },
    ],
  }
}

/** clock 程序机器人：start → wait(clock) → end。 */
function clockDefinition() {
  return {
    version: 4,
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
          position: 'wait',
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
        executor: { kind: 'robot', name: 'clock' },
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
    edges: [
      { from: 'start', to: 'wait' },
      { from: 'wait', to: 'end' },
    ],
  }
}

/** 预算装不下的定义：maxTasks=1 但 start.next 有两条初始任务。 */
function overBudgetDefinition() {
  const definition = simpleDevDefinition()
  definition.budgets.maxTasks = 1
  definition.start.next = [
    {
      position: 'dev',
      type: 'dev.implement',
      payload: { requirement: 'a' },
      dependsOn: ['$start'],
    },
    {
      position: 'dev',
      type: 'dev.implement',
      payload: { requirement: 'b' },
      dependsOn: ['$start'],
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
  const robots = makeRobots()
  const delivery = makeDelivery()
  const engine = new WorkflowEngine({
    ctx: {},
    store,
    options: makeOptions(dataDir),
    logger: undefined,
    robots: () => robots,
    delivery,
  })
  await engine.start()
  const workflow = await engine.saveWorkflow({ definition })
  await engine.setWorkflowActive(workflow.id, true)
  return {
    engine,
    store,
    domain,
    robots,
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
    // 旧实现用 `$start` 当记录 id，真实宿主上创建作业会直接失败。
    assert.match(START_TASK_ID, /^[a-zA-Z0-9_-]+$/u)
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '做一个登录页' },
      structuredInput: { requirement: '登录页需求' },
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

test('engine: a human-started job completes the start task and dispatches the first task', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '做一个登录页' },
      structuredInput: { requirement: '登录页需求' },
    })
    assert.equal(job.status, 'running')
    assert.equal(job.seq, 1)
    const start = taskAt(env.store, job.id, 'start')
    assert.equal(start.status, 'completed')
    assert.deepEqual(start.result.output, { requirement: '登录页需求' })
    await waitFor(() => env.robots.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    assert.equal(dev.status, 'running')
    const dispatch = env.robots.dispatched[0]
    assert.equal(dispatch.request.robot, '软件工程师')
    assert.match(dispatch.request.prompt, /登录页需求/u)
    assert.match(dispatch.request.prompt, /buka_task_complete/u)
    assert.equal(env.engine.taskForSession(dispatch.sessionId)?.taskId, dev.id)

    await env.engine.completeTaskFromSession({
      sessionId: dispatch.sessionId,
      output: { summary: '页面已完成' },
      text: '完成',
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

test('engine: end task delivery completes the job', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '发布 v1' },
      structuredInput: { requirement: '发布需求' },
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const sessionId = env.robots.dispatched[0].sessionId
    await env.engine.createTaskFromSession({
      sessionId,
      position: 'end',
      type: 'end',
      payload: { summary: '最终交付物' },
      deps: [dev.id],
    })
    assert.equal(taskAt(env.store, job.id, 'end').status, 'pending')
    await env.engine.completeTaskFromSession({
      sessionId,
      output: { summary: 'ok' },
      text: '',
      attachments: [],
    })
    await waitFor(() => taskAt(env.store, job.id, 'end').status === 'completed')
    assert.equal(env.store.getJob(job.id).status, 'completed')
    assert.equal(env.engine.jobDetail(job.id).canRetryDelivery, false)
  } finally {
    await env.cleanup()
  }
})

test('engine: a session-started job runs the start task in the starter session', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      rawInput: { request: '做一个注册页' },
      sessionId: 'starter-session',
    })
    await waitFor(() => env.delivery.messages.length === 1)
    const message = env.delivery.messages[0]
    assert.equal(message.sessionId, 'starter-session')
    assert.match(message.text, /启动任务/u)
    assert.equal(taskAt(env.store, job.id, 'start').status, 'running')

    await assert.rejects(
      () =>
        env.engine.completeTaskFromSession({
          sessionId: 'starter-session',
          output: {},
          text: '',
          attachments: [],
        }),
      /output does not match/u,
    )
    await env.engine.completeTaskFromSession({
      sessionId: 'starter-session',
      output: { requirement: '注册页需求' },
      text: '',
      attachments: [],
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    const stored = env.store.getJob(job.id)
    assert.deepEqual(stored.input.structured, { requirement: '注册页需求' })
    assert.equal(taskAt(env.store, job.id, 'start').status, 'completed')
    assert.match(env.robots.dispatched[0].request.prompt, /注册页需求/u)
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 任务创建校验
// ---------------------------------------------------------------------------

test('engine: task creation enforces edges, types, payloads, dependencies, requires and budget', async () => {
  const env = await setup(reviewDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '实现登录' },
      structuredInput: { requirement: '登录' },
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const sessionId = env.robots.dispatched[0].sessionId

    const qa = await env.engine.createTaskFromSession({
      sessionId,
      position: 'qa',
      type: 'qa.verify',
      payload: { focus: '登录流程' },
      deps: [dev.id],
    })
    assert.equal(qa.status, 'pending')

    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'nobody',
          type: 'qa.verify',
          payload: {},
          deps: [],
        }),
      /no edge/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'end',
          type: 'qa.verify',
          payload: {},
          deps: [],
        }),
      /built-in end contract/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'qa',
          type: 'dev.rework',
          payload: { summary: 'x' },
          deps: [dev.id],
        }),
      /not a task type of position "qa"/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'qa',
          type: 'qa.verify',
          payload: {},
          deps: [dev.id],
        }),
      /does not match task type/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'qa',
          type: 'qa.verify',
          payload: { focus: 'x' },
          deps: ['task-does-not-exist'],
        }),
      /does not exist in this job/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'qa',
          type: 'qa.verify',
          payload: { focus: 'x' },
          deps: [],
        }),
      /requires a dependency of type/u,
    )
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId,
          position: 'qa',
          type: 'qa.verify',
          payload: { focus: '{{task.missing.output.x}}' },
          deps: [dev.id],
        }),
      /does not exist in this job/u,
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: an edge type whitelist rejects a declared task type', async () => {
  const definition = reviewDefinition()
  definition.edges = [
    { from: 'start', to: 'dev' },
    { from: 'dev', to: 'qa', types: ['qa.verify'] },
    { from: 'qa', to: 'dev', types: ['dev.rework'], back: true },
    { from: 'qa', to: 'end' },
  ]
  const env = await setup(definition)
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: 'x' },
      structuredInput: { requirement: 'x' },
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const devSession = env.robots.dispatched[0].sessionId
    const qa = await env.engine.createTaskFromSession({
      sessionId: devSession,
      position: 'qa',
      type: 'qa.verify',
      payload: { focus: 'x' },
      deps: [dev.id],
    })
    await env.engine.completeTaskFromSession({
      sessionId: devSession,
      output: { summary: 'ok' },
      text: '',
      attachments: [],
    })
    await waitFor(() => env.robots.dispatched.length === 2)
    const qaSession = env.robots.dispatched[1].sessionId
    assert.equal(env.store.getTask(qa.id).status, 'running')
    await assert.rejects(
      () =>
        env.engine.createTaskFromSession({
          sessionId: qaSession,
          position: 'dev',
          type: 'dev.implement',
          payload: { requirement: 'again' },
          deps: [dev.id],
        }),
      /does not allow task type "dev.implement"/u,
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
          rawInput: { request: 'x' },
          structuredInput: { requirement: 'x' },
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

// ---------------------------------------------------------------------------
// 人任务与助理
// ---------------------------------------------------------------------------

test('engine: a named assistant takes a human task and can complete the job', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '发布' },
      structuredInput: {},
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    const dispatch = env.robots.dispatched[0]
    assert.equal(dispatch.request.robot, '沟通助理')
    const approve = taskAt(env.store, job.id, 'approve')
    assert.equal(approve.status, 'running')
    assert.equal(approve.claimant.kind, 'assistant')

    await env.engine.createTaskFromSession({
      sessionId: dispatch.sessionId,
      position: 'end',
      type: 'end',
      payload: { summary: '批准并发布' },
      deps: [approve.id],
    })
    await env.engine.completeTaskFromSession({
      sessionId: dispatch.sessionId,
      output: { approved: 'yes' },
      text: '用户批准',
      attachments: [],
    })
    await waitFor(() => taskAt(env.store, job.id, 'end').status === 'completed')
    assert.equal(env.store.getJob(job.id).status, 'completed')
  } finally {
    await env.cleanup()
  }
})

test('engine: a failed assistant returns the human task to 待认领 and a human can finish it', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '发布' },
      structuredInput: {},
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    env.robots.dispatched[0].handle.endTurn()
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
      output: { approved: 'no' },
      text: '人自己处理',
      attachments: [],
    })
    assert.equal(completed.status, 'completed')
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
      rawInput: { request: 'x' },
      structuredInput: { requirement: 'x' },
    })
    await waitFor(() => env.robots.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    env.robots.dispatched[0].handle.endTurn()
    await waitFor(() => env.store.getTask(dev.id).status === 'failed')
    // 失败任务等待人工决定，作业仍是 running。
    assert.equal(env.store.getJob(job.id).status, 'running')
    assert.match(env.store.getTask(dev.id).error, /without calling buka_task_complete/u)

    await env.engine.retryTask(job.id, dev.id)
    await waitFor(() => env.robots.dispatched.length === 2)
    assert.equal(env.store.getTask(dev.id).status, 'running')
    assert.deepEqual(
      env.store.listAttempts(dev.id).map((attempt) => attempt.status),
      ['failed', 'running'],
    )

    const cancelled = await env.engine.cancelJob(job.id)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(env.store.getTask(dev.id).status, 'cancelled')
    assert.equal(env.robots.dispatched[1].handle.state.cancelled, true)
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
    const robots = makeRobots()
    const delivery = makeDelivery()
    const options = makeOptions(dataDir)
    const first = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      robots: () => robots,
      delivery,
    })
    await first.start()
    const workflow = await first.saveWorkflow({ definition: simpleDevDefinition() })
    await first.setWorkflowActive(workflow.id, true)
    const job = await first.createJobFromHuman({
      workflowId: workflow.id,
      rawInput: { request: 'x' },
      structuredInput: { requirement: 'x' },
    })
    await waitFor(() => robots.dispatched.length === 1)
    const dev = taskAt(store, job.id, 'dev')
    const sessionId = robots.dispatched[0].sessionId
    first.dispose()

    const second = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      robots: () => robots,
      delivery,
    })
    await second.start()
    await waitFor(() => store.getTask(dev.id).status === 'running')
    assert.equal(second.taskForSession(sessionId)?.taskId, dev.id)
    await second.completeTaskFromSession({
      sessionId,
      output: { summary: '恢复后完成' },
      text: '',
      attachments: [],
    })
    assert.equal(store.getTask(dev.id).status, 'completed')
    second.dispose()
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// program 机器人
// ---------------------------------------------------------------------------

test('engine: clock program tasks complete without a session', async () => {
  const env = await setup(clockDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      rawInput: { request: '到点提醒' },
      structuredInput: { until: new Date(Date.now() - 1000).toISOString() },
    })
    assert.equal(env.robots.dispatched.length, 0)
    const wait = taskAt(env.store, job.id, 'wait')
    await waitFor(() => env.store.getTask(wait.id).status === 'completed')
    const stored = env.store.getTask(wait.id)
    assert.equal(typeof stored.result.output.completedAt, 'string')
    assert.equal(stored.claimant.kind, 'robot')
  } finally {
    await env.cleanup()
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
    // 机器人工作区指向临时目录（附件相对路径的根）。
    const robots = makeRobots([
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
        robots: () => robots,
        delivery,
      })
      await engine.start()
      const workflow = await engine.saveWorkflow({ definition: reviewDefinition() })
      await engine.setWorkflowActive(workflow.id, true)
      const job = await engine.createJobFromHuman({
        workflowId: workflow.id,
        rawInput: { request: 'x' },
        structuredInput: { requirement: 'x' },
      })
      await waitFor(() => robots.dispatched.length === 1)
      const dev = taskAt(store, job.id, 'dev')
      const devSession = robots.dispatched[0].sessionId
      await engine.createTaskFromSession({
        sessionId: devSession,
        position: 'qa',
        type: 'qa.verify',
        payload: { focus: 'x' },
        deps: [dev.id],
      })
      await engine.completeTaskFromSession({
        sessionId: devSession,
        output: { summary: '完成' },
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
      await waitFor(() => robots.dispatched.length === 2)
      const qaSession = robots.dispatched[1].sessionId
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
