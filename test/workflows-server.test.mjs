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

import {
  attachmentPreviewInfo,
  visibleAttachmentsForTask,
} from '../plugins/workflows/src/attachments/index.ts'
import { START_TASK_ID, startTaskId } from '../plugins/workflows/src/domain/ids.ts'
import { WorkflowEngine } from '../plugins/workflows/src/engine/engine.ts'
import { registerWorkflowRoutes } from '../plugins/workflows/src/routes/index.ts'
import { WorkflowStore } from '../plugins/workflows/src/store/index.ts'
import { toV9 } from './workflows-fixture-v7.mjs'

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
// 测试夹具：执行者、会话句柄、发起人投递、工作流定义
// ---------------------------------------------------------------------------

/** 测试里的执行者登记表。 */
const WORKER_ENTRIES = [
  { id: '软件工程师', name: '', driver: 'agent', avatar: 'rocket' },
  { id: '质量保障工程师', name: '', driver: 'agent', avatar: 'owl' },
  { id: '沟通助理', name: '', driver: 'agent', avatar: 'panda' },
  { id: 'clock', name: '', driver: 'robot', program: 'clock', avatar: 'bee' },
]

/** 一个可操纵的 workers 句柄。 */
function makeHandle(sessionId) {
  const state = { turnEnded: false, cancelled: false, disposed: false, stopReason: 'stop' }
  return {
    sessionId,
    startSeq: 0,
    resumed: false,
    state,
    readResult() {
      return {
        sessionId,
        text: '',
        stopReason: state.turnEnded ? state.stopReason : '',
        turnEnded: state.turnEnded,
      }
    },
    async send() {
      return 0
    },
    async cancel(reason) {
      state.cancelled = true
      state.cancelReason = reason
    },
    async dispose() {
      state.disposed = true
    },
    getPlanMode() {
      return null
    },
    setPlanMode() {},
    /**
     * 测试钩子：结束这一轮但不调用 buka_task_complete。
     *
     * @param stopReason 本轮的结束原因；默认用 `stop` 这个非 `completed` 值，
     *   让既有「会话异常结束」测试保持原来的失败语义。
     */
    endTurn(stopReason = 'stop') {
      state.turnEnded = true
      state.stopReason = stopReason
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
    /** 投递前的钩子；测试用它观察执行工具可见性依赖的会话绑定。 */
    beforeDispatch: null,
    /** resume 前的钩子；恢复路径同样要在 openSession 之前绑定会话与任务。 */
    beforeOpenSession: null,
    async list() {
      return { workers: entries, corrupt: false }
    },
    async dispatchSession(request) {
      this.beforeDispatch?.(request)
      const sessionId = `session-${dispatched.length + 1}`
      const handle = makeHandle(sessionId)
      handles.set(sessionId, handle)
      dispatched.push({ request, sessionId, handle })
      return handle
    },
    async openSession(request) {
      this.beforeOpenSession?.(request)
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
function makeOptions(dataDir, overrides = {}) {
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
    ...overrides,
  }
}

/** 记录 info 日志的 logger。 */
function makeLogger() {
  const infos = []
  return {
    infos,
    info(message) {
      infos.push(String(message))
    },
    warn() {},
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

/** 等一小段，用来观察轮询是否重复触发。 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 简单定义：start → dev(agent) → end。 */
function simpleDevDefinition() {
  return toV9({
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
        executor: { kind: 'worker', id: '软件工程师' },
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
  return toV9({
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
        executor: { kind: 'worker', id: '软件工程师' },
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
        executor: { kind: 'worker', id: '质量保障工程师' },
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
  const definition = toV9({
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

/** 人任务不再点名助理：人直接点动作提交，提交时自动认领。 */
function humanOnlyDefinition() {
  const definition = assistantDefinition()
  delete definition.positions[0].taskTypes[0].assistant
  return definition
}

/** 人任务点名助理 + 一条并行的执行者分支：用来验证代办失败会取消其余任务。 */
function assistantWithParallelDefinition() {
  const definition = assistantDefinition()
  definition.positions.push({
    id: 'dev',
    label: '研发',
    executor: { kind: 'worker', id: '软件工程师' },
    taskTypes: [
      {
        id: 'dev.work',
        label: '开发',
        content: { type: 'object', properties: {}, additionalProperties: true },
      },
    ],
  })
  definition.channels.push({ id: 'start.dev', label: '开发', from: 'start', to: 'dev' })
  definition.channels.push({ id: 'dev.end', label: '交付', from: 'dev', to: 'end' })
  definition.start.next.push({ channel: 'start.dev', type: 'dev.work', content: {} })
  return definition
}

/** clock 机器人：start → wait(clock) → end。 */
function clockDefinition() {
  return toV9({
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
        executor: { kind: 'worker', id: 'clock' },
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

/** 机器人完成后创建：开始 → 等待（clock）→ 执行（人）→ 结束。 */
function robotCreatesDefinition(change) {
  const definition = {
    version: 9,
    name: '到点执行',
    budgets: { maxTasks: 10, maxDurationHours: 24 },
    start: {
      content: {
        type: 'object',
        properties: { until: { type: 'string' } },
        required: ['until'],
      },
      next: [
        { channel: 'start.wait', type: 'wait.until', content: { until: '{{content.until}}' } },
      ],
    },
    end: { content: { type: 'object' } },
    positions: [
      {
        id: 'wait',
        label: '等待',
        executor: { kind: 'worker', id: 'clock' },
        taskTypes: [
          {
            id: 'wait.until',
            label: '等待到点',
            content: {
              type: 'object',
              properties: { until: { type: 'string' } },
              required: ['until'],
            },
            creates: [
              { channel: 'wait.run', type: 'run.task', content: { note: '{{content.until}}' } },
            ],
          },
        ],
      },
      {
        id: 'run',
        label: '执行',
        executor: { kind: 'human' },
        taskTypes: [
          {
            id: 'run.task',
            label: '执行',
            content: {
              type: 'object',
              properties: { note: { type: 'string' } },
              required: ['note'],
            },
          },
        ],
      },
    ],
    channels: [
      { id: 'start.wait', label: '开始等待', from: 'start', to: 'wait' },
      { id: 'wait.run', label: '到点执行', from: 'wait', to: 'run' },
      { id: 'run.end', label: '完成', from: 'run', to: 'end' },
    ],
  }
  if (typeof change === 'function') change(definition)
  return definition
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
async function setup(definition, overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-engine-'))
  const domain = new FakeDomain()
  const store = new WorkflowStore({ domain, dataDir })
  await store.init()
  const workers = overrides.workers ?? makeWorkers()
  const delivery = overrides.delivery ?? makeDelivery()
  const engine = new WorkflowEngine({
    ctx: overrides.ctx ?? {},
    store,
    options: makeOptions(dataDir, overrides.options),
    logger: overrides.logger,
    workers: () => workers,
    delivery,
    ...(overrides.worktreeAvailable === undefined
      ? {}
      : { worktreeAvailable: overrides.worktreeAvailable }),
    ...(overrides.retireGraceMs === undefined ? {} : { retireGraceMs: overrides.retireGraceMs }),
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
      // 作业事件是异步追加的：给删除留几次重试，避免和 appendFile 抢目录。
      await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
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
    const expected = startTaskId(job.id)
    assert.match(expected, /^[a-zA-Z0-9_-]+$/u)
    const tasks = jobTasks(env.store, job.id)
    const start = tasks.find((task) => task.position === 'start')
    assert.equal(start.id, expected)
    assert.equal(start.assignee.id, 'engine')
    const dev = tasks.find((task) => task.position === 'dev')
    assert.deepEqual(dev.deps, [expected])
  } finally {
    await env.cleanup()
  }
})

test('engine: invalid input leaves a failed job and a failed start task', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    let captured = null
    await assert.rejects(
      () =>
        env.engine.createJobFromHuman({
          workflowId: env.workflowId,
          content: {},
        }),
      (error) => {
        captured = error
        return error.code === 'invalid-input'
      },
    )
    const jobs = env.store.listJobs(env.workflowId)
    assert.equal(jobs.length, 1, 'the failed job is kept as a trace')
    const job = jobs[0]
    assert.equal(job.status, 'failed')
    assert.match(job.error, /content does not match the workflow input/u)
    assert.match(captured.message, new RegExp(job.id, 'u'), 'the error names the job')

    const start = taskAt(env.store, job.id, 'start')
    assert.equal(start.status, 'failed')
    assert.match(start.error, /content does not match the workflow input/u)
    assert.equal(start.assignee.kind, 'worker')
    assert.equal(start.assignee.id, 'engine')
    assert.equal(start.claimant.kind, 'worker')
    assert.equal(start.claimant.name, 'engine')

    const detail = await env.engine.jobDetail(job.id)
    assert.equal(detail.restart.failed.reason, 'start-task-failed')
    assert.equal(detail.restart.scratch.reason, 'start-task-failed')
    await assert.rejects(
      () => env.engine.restartJob(job.id, 'failed'),
      (error) => error.code === 'start-task-failed',
    )
    await assert.rejects(
      () => env.engine.restartJob(job.id, 'scratch'),
      (error) => error.code === 'start-task-failed',
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: the start task is handled by the built-in engine worker', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    const start = taskAt(env.store, job.id, 'start')
    assert.equal(start.status, 'completed')
    assert.deepEqual(start.assignee, {
      kind: 'worker',
      id: 'engine',
      driver: 'robot',
      program: 'engine',
    })
    assert.deepEqual(start.claimant, { kind: 'worker', name: 'engine', sessionId: null })
  } finally {
    await env.cleanup()
  }
})

test('engine: worktree create tells the executor to create worktrees itself', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].worktree = 'create'
  const env = await setup(definition, { worktreeAvailable: () => true })
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '在独立工作树里实现' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const request = env.workers.dispatched[0].request
    assert.match(request.prompt, /## 工作树/u)
    assert.match(request.prompt, /`create_worktree`/u)
    assert.match(request.prompt, /多个仓库/u)
    assert.match(request.prompt, /working_directory/u)
    assert.doesNotMatch(request.prompt, /必须停下来询问用户/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: worktree create degrades to guard when the plugin is unavailable', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].worktree = 'create'
  const env = await setup(definition)
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '在独立工作树里实现' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const request = env.workers.dispatched[0].request
    assert.match(request.prompt, /## 工作区/u)
    assert.match(request.prompt, /本任务不创建新的工作树/u)
    assert.match(request.prompt, /未提交的修改/u)
    assert.match(request.prompt, /必须停下来询问用户/u)
    assert.doesNotMatch(request.prompt, /`create_worktree`/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: worktree guard never creates a worktree even with the plugin enabled', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].worktree = 'guard'
  const env = await setup(definition, { worktreeAvailable: () => true })
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '检查工作区' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const request = env.workers.dispatched[0].request
    assert.match(request.prompt, /## 工作区/u)
    assert.match(request.prompt, /本任务不创建新的工作树/u)
    assert.doesNotMatch(request.prompt, /`create_worktree`/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: worktree none injects no worktree prompt', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].worktree = 'none'
  const env = await setup(definition, { worktreeAvailable: () => true })
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '不注入工作树提示' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const prompt = env.workers.dispatched[0].request.prompt
    assert.doesNotMatch(prompt, /## 工作树/u)
    assert.doesNotMatch(prompt, /## 工作区/u)
    assert.doesNotMatch(prompt, /create_worktree/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: the end task can be handed to an assistant for delivery', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '发布需求' },
      sessionId: 'starter-session',
      delivery: { kind: 'assistant', id: '沟通助理' },
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
    const delivery = env.workers.dispatched[1]
    assert.equal(delivery.request.worker, '沟通助理')
    const end = taskAt(env.store, job.id, 'end')
    assert.equal(end.status, 'running')
    assert.equal(end.claimant.kind, 'worker')
    assert.match(delivery.request.prompt, /最终报告/u)

    await env.engine.completeTaskFromSession({
      sessionId: delivery.sessionId,
      text: '已代收',
      attachments: [],
    })
    await waitFor(() => env.store.getJob(job.id).status === 'completed')
  } finally {
    await env.cleanup()
  }
})

test('engine: the delivery assistant must exist and be an agent', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    await assert.rejects(
      () =>
        env.engine.createJobFromSession({
          workflowId: env.workflowId,
          content: { requirement: 'x' },
          sessionId: 'starter-session',
          delivery: { kind: 'assistant', id: '不存在' },
        }),
      /unknown assistant/u,
    )
    await assert.rejects(
      () =>
        env.engine.createJobFromSession({
          workflowId: env.workflowId,
          content: { requirement: 'x' },
          sessionId: 'starter-session',
          delivery: { kind: 'assistant', id: 'clock' },
        }),
      /must be an agent/u,
    )
    assert.equal(env.store.allJobs().length, 0)

    // 未被任何标记「点过名」的智能体也可以被交回方式点名。
    const accepted = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
      sessionId: 'starter-session',
      delivery: { kind: 'assistant', id: '软件工程师' },
    })
    assert.equal(accepted.delivery.kind, 'assistant')
    assert.equal(accepted.delivery.id, '软件工程师')
  } finally {
    await env.cleanup()
  }
})

test('engine: saving a definition rejects an unregistered worker identifier', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const definition = simpleDevDefinition()
    definition.positions[0].executor = { kind: 'worker', id: '未登记' }
    await assert.rejects(
      () => env.engine.saveWorkflow({ definition }),
      /unknown worker identifier "未登记"/u,
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: a v7 job snapshot stays readable and keeps advancing with name fallbacks', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-legacy-'))
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
  try {
    // v7 快照：定义里主体与交回方式都只有 name（不迁移）。
    const definition = simpleDevDefinition()
    definition.version = 7
    definition.positions[0].executor = { kind: 'worker', name: '软件工程师' }
    const timestamp = new Date().toISOString()
    const job = {
      id: 'job-legacy',
      seq: 1,
      workflowId: 'wf-legacy',
      workflowVersion: 1,
      workflowName: '简单研发',
      workflowDescription: '',
      definition,
      status: 'running',
      starter: { kind: 'human' },
      input: { requirement: '旧作业' },
      delivery: { kind: 'assistant', name: '沟通助理' },
      inputSummary: '旧作业',
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    }
    await store.ensureJobDirectories(job.id)
    await store.insertJob(job)
    await store.insertTask({
      id: START_TASK_ID,
      jobId: job.id,
      position: 'start',
      type: 'start',
      channel: null,
      content: { requirement: '旧作业' },
      deps: [],
      status: 'completed',
      createdBy: null,
      assignee: { kind: 'human' },
      claimant: { kind: 'human', name: '本地用户', sessionId: null },
      attemptIds: [],
      result: { text: '', textBytes: 0, textFile: null, attachmentIds: [] },
      error: null,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: timestamp,
      updatedAt: timestamp,
    })
    await store.insertTask({
      id: 'task-legacy-dev',
      jobId: job.id,
      position: 'dev',
      type: 'dev.implement',
      channel: 'start.dev',
      content: { requirement: '旧作业' },
      deps: [START_TASK_ID],
      status: 'pending',
      createdBy: { taskId: START_TASK_ID, position: 'start' },
      assignee: { kind: 'worker', name: '软件工程师', driver: 'agent', avatar: 'rocket' },
      claimant: null,
      attemptIds: [],
      result: null,
      error: null,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
      updatedAt: timestamp,
    })

    await engine.start()
    await waitFor(() => workers.dispatched.length === 1)
    assert.equal(
      workers.dispatched[0].request.worker,
      '软件工程师',
      'the old assignee name resolves as the identifier',
    )
    // 旧快照按旧语义投递：上下文带任务内容，用户消息是定义原文。
    assert.match(workers.dispatched[0].request.prompt, /## 任务内容/u)
    assert.equal(
      workers.dispatched[0].request.userPrompt,
      '实现需求，完成后创建交付任务。',
      'the v8 snapshot keeps the definition text as the user prompt',
    )
    const devSession = workers.dispatched[0].sessionId

    const detail = await engine.jobDetail(job.id)
    assert.ok(detail !== null, 'v7 job snapshots stay readable')
    assert.equal(detail.definition.version, 7)
    assert.equal(detail.job.delivery.id, '沟通助理', 'delivery.name is read as the identifier')

    await engine.createTaskFromTarget({
      sessionId: devSession,
      target: 'end',
      content: { summary: '旧作业完成' },
      deps: [],
    })
    await engine.completeTaskFromSession({
      sessionId: devSession,
      text: '开发完成',
      attachments: [],
    })
    await waitFor(() => workers.dispatched.length === 2)
    assert.equal(
      workers.dispatched[1].request.worker,
      '沟通助理',
      'the old delivery name resolves to the assistant',
    )
    await engine.completeTaskFromSession({
      sessionId: workers.dispatched[1].sessionId,
      text: '已代收',
      attachments: [],
    })
    await waitFor(() => store.getJob(job.id).status === 'completed')
  } finally {
    engine.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

/** 直接写入一条运行中的作业与一张就绪任务：用于旧快照与手改数据。 */
let injectedJobSeq = 0
async function insertReadyJob(
  store,
  { definition, content = { requirement: '旧作业' }, taskContent = content },
) {
  const timestamp = new Date().toISOString()
  injectedJobSeq += 1
  const jobId = `job-injected-${injectedJobSeq}`
  const job = {
    id: jobId,
    seq: 1,
    workflowId: `wf-${jobId}`,
    workflowVersion: 1,
    workflowName: definition.name,
    workflowDescription: '',
    definition,
    status: 'running',
    starter: { kind: 'human' },
    input: content,
    delivery: { kind: 'starter' },
    inputSummary: '旧作业',
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  }
  await store.ensureJobDirectories(job.id)
  await store.insertJob(job)
  await store.insertTask({
    id: START_TASK_ID,
    jobId: job.id,
    position: 'start',
    type: 'start',
    channel: null,
    content,
    deps: [],
    status: 'completed',
    createdBy: null,
    assignee: { kind: 'human' },
    claimant: { kind: 'human', name: '本地用户', sessionId: null },
    attemptIds: [],
    result: { text: '', textBytes: 0, textFile: null, attachmentIds: [] },
    error: null,
    createdAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    updatedAt: timestamp,
  })
  const task = {
    id: `task-${jobId}-dev`,
    jobId: job.id,
    position: 'dev',
    type: 'dev.implement',
    channel: 'start.dev',
    content: taskContent,
    deps: [START_TASK_ID],
    status: 'ready',
    createdBy: { taskId: START_TASK_ID, position: 'start' },
    assignee: { kind: 'worker', name: '软件工程师', driver: 'agent' },
    claimant: null,
    attemptIds: [],
    result: null,
    error: null,
    createdAt: timestamp,
    startedAt: null,
    finishedAt: null,
    updatedAt: timestamp,
  }
  await store.insertTask(task)
  return { job, task }
}

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
    // 上下文只剩规则；任务内容与定义一起走用户消息（v9）。
    assert.match(dispatch.request.prompt, /## 工作流规则/u)
    assert.doesNotMatch(dispatch.request.prompt, /## 任务类型的定义/u)
    assert.doesNotMatch(dispatch.request.prompt, /## 任务内容/u)
    assert.doesNotMatch(dispatch.request.prompt, /登录页需求/u)
    assert.doesNotMatch(dispatch.request.prompt, /结果结构|通道|岗位|作业 #/u)
    assert.equal(dispatch.request.userPrompt, '实现需求，完成后创建交付任务。')
    assert.ok(
      dispatch.request.prompt.endsWith('\n\n实现需求，完成后创建交付任务。'),
      'the user message follows the context in the landed text',
    )
    assert.doesNotMatch(dispatch.request.userPrompt, /## 工作流规则|## 任务内容/u)
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

test('engine: the execution session is bound before the first prompt is delivered', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const boundAtDispatch = []
    env.workers.beforeDispatch = (request) => {
      boundAtDispatch.push(env.engine.taskForSession(request.newSessionId))
    }
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    // dispatchSession 返回前提示词就已经投递，第一轮组装工具清单时依赖这条绑定。
    assert.equal(boundAtDispatch.length, 1)
    assert.equal(boundAtDispatch[0]?.jobId, job.id)
    assert.equal(boundAtDispatch[0]?.taskId, dev.id)
    // 假服务回报的会话 id 与请求的不同：绑定要跟到真实 id 上。
    assert.equal(env.engine.taskForSession(env.workers.dispatched[0].sessionId)?.taskId, dev.id)
  } finally {
    await env.cleanup()
  }
})

test('engine: a failed dispatch does not leave a session binding behind', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    let requestedSessionId = ''
    env.workers.dispatchSession = async (request) => {
      requestedSessionId = request.newSessionId
      throw new Error('boom')
    }
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    const dev = taskAt(env.store, job.id, 'dev')
    await waitFor(() => env.store.getTask(dev.id).status === 'failed')
    assert.notEqual(requestedSessionId, '')
    assert.equal(env.engine.taskForSession(requestedSessionId), null)
  } finally {
    await env.cleanup()
  }
})

test('engine: a completed task releases its session only after the turn settles', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    let releaseIdle = () => {}
    const idle = new Promise((resolve) => {
      releaseIdle = resolve
    })
    const handle = makeHandle('session-1')
    handle.whenIdle = () => idle
    env.workers.dispatchSession = async (request) => {
      env.workers.dispatched.push({ request, sessionId: 'session-1', handle })
      return handle
    }
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    await env.engine.completeTaskFromSession({
      sessionId: 'session-1',
      text: '页面已完成',
      attachments: [],
    })
    await delay(20)
    assert.equal(env.store.getTask(dev.id).status, 'completed')
    // 任务结果已记录，但句柄要等当前轮落定：立刻释放会掐断模型收尾。
    assert.equal(handle.state.disposed, false)
    releaseIdle()
    await waitFor(() => handle.state.disposed === true)
  } finally {
    await env.cleanup()
  }
})

test('engine: a session that never settles is released once the retire grace expires', async () => {
  const env = await setup(simpleDevDefinition(), { retireGraceMs: 30 })
  try {
    const handle = makeHandle('session-1')
    // whenIdle 永不 resolve：模拟当前轮卡住，由上限兜底释放。
    handle.whenIdle = () => new Promise(() => {})
    env.workers.dispatchSession = async (request) => {
      env.workers.dispatched.push({ request, sessionId: 'session-1', handle })
      return handle
    }
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    await env.engine.completeTaskFromSession({
      sessionId: 'session-1',
      text: '页面已完成',
      attachments: [],
    })
    // 还没到上限：句柄保留，等这一轮落定。
    assert.equal(handle.state.disposed, false)
    await waitFor(() => handle.state.disposed === true)
    // 上限只影响释放时机，任务结果本身不受影响。
    assert.equal(env.store.getTask(dev.id).status, 'completed')
  } finally {
    await env.cleanup()
  }
})

test('engine: the v9 definition template is rendered into the user prompt', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].definition =
    '需求资料：\n{{content.requirement}}\n\n先读代码。\n\n/grill-with-docs'
  const env = await setup(definition)
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dispatch = env.workers.dispatched[0]
    assert.equal(
      dispatch.request.userPrompt,
      '需求资料：\n登录页需求\n\n先读代码。\n\n/grill-with-docs',
    )
    assert.ok(dispatch.request.prompt.endsWith(dispatch.request.userPrompt))
    assert.match(dispatch.request.prompt, /## 工作流规则/u)
    assert.doesNotMatch(dispatch.request.prompt, /## 任务内容/u)

    // 落盘的 prompt 文件 = 上下文 + 用户消息，顺序与到达顺序一致。
    const dev = taskAt(env.store, job.id, 'dev')
    const attempt = env.store.listAttempts(dev.id)[0]
    assert.ok(attempt, 'the attempt is recorded')
    assert.equal(typeof attempt.promptFile, 'string')
    assert.equal(await env.store.readText(job.id, attempt.promptFile), dispatch.request.prompt)
  } finally {
    await env.cleanup()
  }
})

test('engine: upstream content cannot spoof a /skill gesture through the template', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].definition = '需求资料：\n{{content.requirement}}'
  const env = await setup(definition)
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '/disable-model-invocation' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const userPrompt = env.workers.dispatched[0].request.userPrompt
    assert.match(userPrompt, /\/\u200bdisable-model-invocation/u)
    assert.doesNotMatch(userPrompt, /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: an omitted definition delivers the whole task content', async () => {
  const definition = simpleDevDefinition()
  delete definition.positions[0].taskTypes[0].definition
  const env = await setup(definition)
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dispatch = env.workers.dispatched[0]
    assert.equal(dispatch.request.userPrompt, '{\n  "requirement": "登录页需求"\n}')
    assert.match(dispatch.request.prompt, /## 工作流规则/u)
    assert.match(dispatch.request.prompt, /登录页需求/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: a plan-mode task type is delivered like any other task', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].plan = true
  const env = await setup(definition)
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dispatch = env.workers.dispatched[0]
    assert.equal(dispatch.request.planMode, true)
    // plan 模式只是会话模式：投递与普通任务相同（上下文 + 用户消息）。
    assert.equal(dispatch.request.userPrompt, '实现需求，完成后创建交付任务。')
    assert.match(dispatch.request.prompt, /## 工作流规则/u)
    assert.doesNotMatch(dispatch.request.prompt, /## 任务类型的定义|## 任务内容/u)
    assert.match(dispatch.request.prompt, /实现需求，完成后创建交付任务。/u)
    assert.doesNotMatch(dispatch.request.prompt, /登录页需求/u)

    // 落盘仍是完整文本，供排查使用。
    const dev = taskAt(env.store, job.id, 'dev')
    const attempt = env.store.listAttempts(dev.id)[0]
    assert.equal(await env.store.readText(job.id, attempt.promptFile), dispatch.request.prompt)
  } finally {
    await env.cleanup()
  }
})

/** 同一岗位两个任务类型的定义：初始任务可重复，用来观察并发度。 */
function parallelDefinition({ concurrency, secondType = false } = {}) {
  const definition = simpleDevDefinition()
  definition.budgets.maxTasks = 10
  const dev = definition.positions[0]
  if (concurrency !== undefined) dev.taskTypes[0].concurrency = concurrency
  if (secondType) {
    dev.taskTypes.push({
      id: 'dev.review',
      label: '复核',
      content: { type: 'object', properties: { requirement: { type: 'string' } } },
    })
  }
  definition.start.next = [
    { channel: 'start.dev', type: dev.taskTypes[0].id, content: { requirement: 'a' } },
    {
      channel: 'start.dev',
      type: secondType ? 'dev.review' : dev.taskTypes[0].id,
      content: secondType ? {} : { requirement: 'b' },
    },
  ]
  return definition
}

test('engine: a task type runs one task at a time by default and queues the rest', async () => {
  const env = await setup(parallelDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    await delay(30)
    assert.equal(env.workers.dispatched.length, 1, 'a second task of the same type waits')
    const waiting = jobTasks(env.store, job.id).find(
      (task) => task.type === 'dev.implement' && task.status === 'ready',
    )
    assert.ok(waiting, 'the queued task stays ready')

    await env.engine.completeTaskFromSession({
      sessionId: env.workers.dispatched[0].sessionId,
      text: '完成第一条',
      attachments: [],
    })
    await waitFor(() => env.workers.dispatched.length === 2)
    assert.equal(
      env.store.getTask(waiting.id).status,
      'running',
      'the queued task starts after the first one finishes',
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: task type concurrency lets several tasks of the same type run', async () => {
  const env = await setup(parallelDefinition({ concurrency: 2 }))
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 2)
  } finally {
    await env.cleanup()
  }
})

test('engine: different task types on one position run in parallel', async () => {
  const env = await setup(parallelDefinition({ secondType: true }))
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 2)
    const running = jobTasks(env.store, job.id).filter(
      (task) => task.position === 'dev' && task.status === 'running',
    )
    assert.deepEqual(running.map((task) => task.type).sort(), ['dev.implement', 'dev.review'])
  } finally {
    await env.cleanup()
  }
})

/** 带默认执行者预设的登记表。 */
function presetWorkers(defaultPreset) {
  return makeWorkers(
    WORKER_ENTRIES.map((entry) =>
      entry.id === '软件工程师' && defaultPreset !== undefined
        ? { ...entry, agentPreset: defaultPreset }
        : entry,
    ),
  )
}

test('engine: the task type agent preset wins over the worker default', async () => {
  const definition = simpleDevDefinition()
  definition.positions[0].taskTypes[0].agentPreset = 'ptc'
  const env = await setup(definition, { workers: presetWorkers('worker-mode') })
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    assert.equal(env.workers.dispatched[0].request.agentPreset, 'ptc')
  } finally {
    await env.cleanup()
  }
})

test('engine: the worker default agent preset applies when the task type has none', async () => {
  const env = await setup(simpleDevDefinition(), { workers: presetWorkers('worker-mode') })
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    assert.equal(env.workers.dispatched[0].request.agentPreset, 'worker-mode')
  } finally {
    await env.cleanup()
  }
})

test('engine: the plugin worker preset is the last fallback', async () => {
  const env = await setup(simpleDevDefinition(), { workers: presetWorkers(undefined) })
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    assert.equal(env.workers.dispatched[0].request.agentPreset, 'standard')
  } finally {
    await env.cleanup()
  }
})

test('engine: saving a definition validates agent presets against the roster', async () => {
  const ctx = {
    get(name) {
      if (name !== 'agentPresets') return undefined
      return {
        list: async () => [{ id: 'standard' }, { id: 'ptc' }, { id: 'broken', broken: 'nope' }],
      }
    },
  }
  const env = await setup(simpleDevDefinition(), { ctx })
  try {
    const definition = simpleDevDefinition()
    definition.positions[0].taskTypes[0].agentPreset = 'nope'
    await assert.rejects(
      () => env.engine.saveWorkflow({ definition }),
      (error) => {
        assert.equal(error.code, 'invalid-definition')
        assert.match(error.message, /positions\[0\]\.taskTypes\[0\]\.agentPreset/u)
        assert.match(error.message, /unknown agent preset "nope"/u)
        return true
      },
    )
    // broken 的预设也接受：激活失败在派发时按任务失败处理。
    definition.positions[0].taskTypes[0].agentPreset = 'broken'
    const saved = await env.engine.saveWorkflow({ definition })
    const latest = env.store.readWorkflowVersion(saved.id)
    assert.equal(latest?.versionRecord.definition.positions[0].taskTypes[0].agentPreset, 'broken')
  } finally {
    await env.cleanup()
  }
})

test('engine: an omitted definition sends the whole task content as the user prompt', async () => {
  const definition = simpleDevDefinition()
  delete definition.positions[0].taskTypes[0].definition
  const env = await setup(definition)
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dispatch = env.workers.dispatched[0]
    assert.equal(dispatch.request.userPrompt, '{\n  "requirement": "登录页需求"\n}')
    assert.doesNotMatch(dispatch.request.prompt, /## 任务类型的定义|## 任务内容/u)
    assert.ok(dispatch.request.prompt.endsWith(dispatch.request.userPrompt))
  } finally {
    await env.cleanup()
  }
})

test('engine: a v8 plan-mode snapshot keeps the old single-message delivery', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-legacy-plan-'))
  const domain = new FakeDomain()
  const store = new WorkflowStore({ domain, dataDir })
  await store.init()
  const workers = makeWorkers()
  const engine = new WorkflowEngine({
    ctx: {},
    store,
    options: makeOptions(dataDir),
    logger: undefined,
    workers: () => workers,
    delivery: makeDelivery(),
  })
  try {
    const definition = simpleDevDefinition()
    definition.version = 8
    definition.positions[0].taskTypes[0].plan = true
    const { task } = await insertReadyJob(store, { definition })

    await engine.start()
    await waitFor(() => workers.dispatched.length === 1)
    const request = workers.dispatched[0].request
    assert.equal(request.planMode, true)
    // 旧快照的 plan 模式保持旧投递：完整提示词一条 followup，不拆用户消息。
    assert.equal('userPrompt' in request, false)
    assert.match(request.prompt, /## 任务类型的定义/u)
    assert.match(request.prompt, /## 任务内容/u)
    assert.equal(store.getTask(task.id).status, 'running')
  } finally {
    engine.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('engine: a task whose definition path is missing at run time fails with the path', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-render-fail-'))
  const domain = new FakeDomain()
  const store = new WorkflowStore({ domain, dataDir })
  await store.init()
  const workers = makeWorkers()
  const engine = new WorkflowEngine({
    ctx: {},
    store,
    options: makeOptions(dataDir),
    logger: undefined,
    workers: () => workers,
    delivery: makeDelivery(),
  })
  try {
    const definition = simpleDevDefinition()
    definition.positions[0].taskTypes[0].definition = '需求：{{content.requirement}}'
    // 手改过的任务内容缺必填字段：保存校验拦不住，运行时按任务失败处理。
    const { task } = await insertReadyJob(store, { definition, taskContent: {} })

    await engine.start()
    await waitFor(() => store.getTask(task.id).status === 'failed')
    const failed = store.getTask(task.id)
    assert.match(failed.error, /content\.requirement/u)
    assert.equal(workers.dispatched.length, 0)
    const attempt = store.listAttempts(task.id)[0]
    assert.equal(attempt?.status, 'failed')
  } finally {
    engine.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
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

/**
 * 在 dev 会话里建结束任务并完成 dev，触发一次结束投递。
 *
 * @param env 测试环境
 * @param job 作业
 * @param workerSession 执行该作业 dev 任务的会话
 */
async function handOffToEnd(env, job, workerSession) {
  const dev = taskAt(env.store, job.id, 'dev')
  await env.engine.createTaskFromSession({
    sessionId: workerSession,
    channel: 'dev.end',
    type: 'end',
    content: { summary: '最终交付物' },
    deps: [dev.id],
  })
  await env.engine.completeTaskFromSession({ sessionId: workerSession, text: '', attachments: [] })
}

test('engine: the starter session already handles the end task when the delivery turn starts', async () => {
  let engine = null
  const seen = []
  const delivery = {
    async deliver(sessionId) {
      // 宿主 followup() 之后回合立刻开始；该回合的工具清单按 when 谓词算，
      // 所以 deliver 被调用的这一刻 taskForSession() 就必须能查到结束任务。
      seen.push(engine.taskForSession(sessionId))
      return 0
    },
  }
  const env = await setup(simpleDevDefinition(), { delivery })
  engine = env.engine
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '发布需求' },
      sessionId: 'starter-session',
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    await handOffToEnd(env, job, env.workers.dispatched[0].sessionId)
    await waitFor(() => seen.length === 1)
    const end = taskAt(env.store, job.id, 'end')
    assert.deepEqual(seen[0], { jobId: job.id, taskId: end.id })
  } finally {
    await env.cleanup()
  }
})

test('engine: a failed delivery leaves the starter session without task tools', async () => {
  const delivery = {
    async deliver() {
      throw new Error('starter session is unavailable')
    },
  }
  const env = await setup(simpleDevDefinition(), { delivery })
  try {
    const job = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '发布需求' },
      sessionId: 'starter-session',
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    await handOffToEnd(env, job, env.workers.dispatched[0].sessionId)
    await waitFor(() => taskAt(env.store, job.id, 'end').status === 'ready')
    assert.equal(env.engine.taskForSession('starter-session'), null)
    assert.equal((await env.engine.jobDetail(job.id)).canRetryDelivery, true)
  } finally {
    await env.cleanup()
  }
})

test('engine: a failed delivery gives the session back the task it was already running', async () => {
  const delivery = {
    async deliver() {
      throw new Error('starter session is unavailable')
    },
  }
  const env = await setup(simpleDevDefinition(), { delivery })
  try {
    const jobA = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '先发的作业' },
      sessionId: 'external-session',
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    // 执行作业 A 的 dev 的那个会话，同时也是作业 B 的发起人。
    const runningSession = env.workers.dispatched[0].sessionId
    const devA = taskAt(env.store, jobA.id, 'dev')
    assert.equal(env.engine.taskForSession(runningSession)?.taskId, devA.id)

    const jobB = await env.engine.createJobFromSession({
      workflowId: env.workflowId,
      content: { requirement: '后发的作业' },
      sessionId: runningSession,
    })
    await waitFor(() => env.workers.dispatched.length === 2)
    await handOffToEnd(env, jobB, env.workers.dispatched[1].sessionId)
    await waitFor(() => taskAt(env.store, jobB.id, 'end').status === 'ready')
    // 投递失败只解绑结束任务，不能把它正在跑的 dev 绑定弄丢。
    assert.equal(env.engine.taskForSession(runningSession)?.taskId, devA.id)
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
    const dispatch = env.workers.dispatched[0]
    assert.equal(dispatch.request.userPrompt, '实现需求，完成后创建交付任务。')
    assert.doesNotMatch(
      dispatch.request.prompt,
      /注册页需求/u,
      'content only enters through the template',
    )
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

test('engine: execution prompt is exactly the rules plus one rendered user message', async () => {
  const definition = reviewDefinition()
  definition.positions[0].taskTypes[0].definition =
    '任务类型的定义：先读依赖结果，再实现。\n\n需求：{{content.requirement}}'
  const env = await setup(definition)
  try {
    await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: '登录页需求' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dispatch = env.workers.dispatched[0]
    assert.equal(
      dispatch.request.userPrompt,
      '任务类型的定义：先读依赖结果，再实现。\n\n需求：登录页需求',
    )
    assert.equal(
      dispatch.request.prompt,
      `## 工作流规则\n${dispatch.request.prompt.slice('## 工作流规则\n'.length)}`,
    )
    const prompt = dispatch.request.prompt
    assert.equal(prompt.match(/^## /gmu)?.length, 1, 'only the rules heading remains')
    assert.match(prompt, /需求：登录页需求/u)
    assert.ok(prompt.endsWith(dispatch.request.userPrompt))
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
    assert.equal(env.workers.dispatched[0].request.userPrompt, '实现需求，完成后创建交付任务。')
    assert.doesNotMatch(env.workers.dispatched[0].request.prompt, /做登录页/u)
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
    assert.equal(
      dispatch.request.prompt,
      `请你负责对接任务「批准发布」（${approve.id}）的处理人，并严格执行处理人对于该任务的决策。`,
    )
    // 助理任务只收这一条固定提示，不拆用户消息。
    assert.equal('userPrompt' in dispatch.request, false)

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

test('engine: a failed assistant fails the task and the job and cancels the other open tasks', async () => {
  const env = await setup(assistantWithParallelDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 2)
    const assistantDispatch = env.workers.dispatched.find(
      (dispatch) => dispatch.request.worker === '沟通助理',
    )
    const workerDispatch = env.workers.dispatched.find(
      (dispatch) => dispatch.request.worker === '软件工程师',
    )
    assert.ok(assistantDispatch, 'the named assistant gets the human task')
    assert.ok(workerDispatch, 'the worker branch is running in parallel')
    const approve = taskAt(env.store, job.id, 'approve')
    const dev = taskAt(env.store, job.id, 'dev')
    assert.equal(approve.status, 'running')
    assert.equal(dev.status, 'running')

    // 代办会话结束但没有提交结果：任务 failed、作业 failed、其它在跑任务 cancelled。
    assistantDispatch.handle.endTurn()
    await waitFor(() => env.store.getJob(job.id).status === 'failed')

    const failedApprove = env.store.getTask(approve.id)
    assert.equal(failedApprove.status, 'failed')
    assert.equal(failedApprove.claimant.kind, 'assistant', 'the claimant stays on the record')
    assert.match(failedApprove.error, /assistant 沟通助理/u, 'the task error names the assistant')
    assert.match(failedApprove.error, /without completing the task/u)

    const cancelledDev = env.store.getTask(dev.id)
    assert.equal(cancelledDev.status, 'cancelled')
    assert.match(cancelledDev.error, /delegated task/u, 'the cancellation carries the reason')
    assert.equal(workerDispatch.handle.state.cancelled, true, 'the other session is cancelled')

    const failedJob = env.store.getJob(job.id)
    assert.match(failedJob.error, /delegated task/u)
    assert.match(failedJob.error, /沟通助理/u, 'the job error names the assistant')
    assert.match(failedJob.error, /without completing the task/u, 'the job error names the cause')

    // 人不能接手已失败的代办任务。
    await assert.rejects(
      () => env.engine.claimTaskAsHuman(job.id, approve.id),
      /job .* is failed|not running/u,
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: a human action creates the declared task only after validation', async () => {
  const env = await setup(humanOnlyDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => taskAt(env.store, job.id, 'approve').status === 'ready')
    const approve = taskAt(env.store, job.id, 'approve')

    // 就绪的人任务可以直接提交：页面不再要求先认领，allowedActions 同时给出 claim 与 complete。
    const detail = env.engine.taskDetail(job.id, approve.id)
    assert.ok(detail.allowedActions.includes('complete'), 'a ready human task can be completed')
    assert.ok(detail.allowedActions.includes('claim'), 'the claim flow itself is kept')

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

    // 没认领就提交：完成时自动补上认领者、开始时间与一条执行记录。
    const completed = taskAt(env.store, job.id, 'approve')
    assert.equal(completed.status, 'completed')
    assert.equal(completed.claimant.kind, 'human', 'submitting claims the task for the person')
    assert.equal(completed.claimant.name, '本地用户')
    assert.equal(completed.attemptIds.length, 1, 'the implicit claim records one attempt')
    assert.ok(completed.startedAt !== null, 'the implicit claim records a start time')
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 技术失败、重试、取消
// ---------------------------------------------------------------------------

test('engine: a task session that ends its turn completed while unfinished waits for the user', async () => {
  const logger = makeLogger()
  const env = await setup(simpleDevDefinition(), { logger })
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    const handle = env.workers.dispatched[0].handle
    handle.endTurn('completed')
    await waitFor(() => logger.infos.length === 1)

    // 回合正常结束不等于任务失败：任务保持 running，观测句柄留在 active 集合。
    assert.equal(env.store.getTask(dev.id).status, 'running')
    assert.equal(env.store.getTask(dev.id).error, null)
    assert.equal(env.store.getJob(job.id).status, 'running')
    assert.equal(env.engine.active.has(dev.id), true)
    assert.equal(handle.state.disposed, false)
    assert.equal(handle.state.cancelled, false)

    // 等待只在第一次进入时记一条日志，轮询继续但不重复记。
    await delay(40)
    assert.equal(logger.infos.length, 1)
    assert.match(logger.infos[0], /waiting/u)
    assert.equal(env.store.getTask(dev.id).status, 'running', 'taskTimeoutMs 为 0 时无限等待')
    assert.equal(handle.state.disposed, false)

    // 用户在会话里回复并调用 buka_task_complete：任务完成，观测器清理干净。
    await env.engine.completeTaskFromSession({
      sessionId: handle.sessionId,
      text: '收到',
      attachments: [],
    })
    assert.equal(env.store.getTask(dev.id).status, 'completed')
    assert.equal(env.store.getTask(dev.id).error, null)
    await waitFor(() => handle.state.disposed === true)
    assert.equal(env.engine.active.has(dev.id), false)
  } finally {
    await env.cleanup()
  }
})

for (const stopReason of ['error', 'aborted', 'max-tokens', 'interrupted', 'blocked']) {
  test(`engine: a task session that ends with stopReason ${stopReason} fails the task`, async () => {
    const env = await setup(simpleDevDefinition())
    try {
      const job = await env.engine.createJobFromHuman({
        workflowId: env.workflowId,
        content: { requirement: 'x' },
      })
      await waitFor(() => env.workers.dispatched.length === 1)
      const dev = taskAt(env.store, job.id, 'dev')
      const handle = env.workers.dispatched[0].handle
      handle.endTurn(stopReason)
      await waitFor(() => env.store.getTask(dev.id).status === 'failed')
      // 异常结束仍按失败处理，错误信息保留 stopReason；作业等人工决定。
      assert.equal(env.store.getJob(job.id).status, 'running')
      assert.match(env.store.getTask(dev.id).error, /without calling buka_task_complete/u)
      assert.match(env.store.getTask(dev.id).error, new RegExp(`stopReason: ${stopReason}`, 'u'))
      await waitFor(() => handle.state.disposed === true)
    } finally {
      await env.cleanup()
    }
  })
}

test('engine: a waiting task still times out when taskTimeoutMs is set', async () => {
  const logger = makeLogger()
  const env = await setup(simpleDevDefinition(), {
    logger,
    options: { taskTimeoutMs: 60 },
  })
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    env.workers.dispatched[0].handle.endTurn('completed')
    await waitFor(() => env.store.getTask(dev.id).status === 'failed')
    assert.match(env.store.getTask(dev.id).error, /timed out after 60ms/u)
    assert.equal(logger.infos.length, 1, 'the wait was observed before the timeout')
  } finally {
    await env.cleanup()
  }
})

test('engine: retrying a task failed by an abnormal session end adds a new attempt', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    const dev = taskAt(env.store, job.id, 'dev')
    env.workers.dispatched[0].handle.endTurn('error')
    await waitFor(() => env.store.getTask(dev.id).status === 'failed')

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
// 失败作业重启（ADR 0023）
// ---------------------------------------------------------------------------

/** 读作业事件时间线。 */
async function jobEvents(store, jobId) {
  const text = await fs.readFile(store.paths(jobId).events, 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/** 审批（人 + 助理）+ 研发 + 测试三条并行分支：用来验证重启恢复各自的处理。 */
function restartBranchesDefinition() {
  const definition = assistantWithParallelDefinition()
  definition.positions.push({
    id: 'qa',
    label: '测试',
    executor: { kind: 'worker', id: '质量保障工程师' },
    taskTypes: [
      {
        id: 'qa.verify',
        label: '验证',
        content: {
          type: 'object',
          properties: { focus: { type: 'string' } },
          required: ['focus'],
        },
      },
    ],
  })
  definition.channels.push({ id: 'start.qa', label: '开始验证', from: 'start', to: 'qa' })
  definition.channels.push({ id: 'qa.end', label: '验证交付', from: 'qa', to: 'end' })
  definition.start.next.push({ channel: 'start.qa', type: 'qa.verify', content: { focus: 'x' } })
  return definition
}

test('engine: restarting from the failure re-dispatches failed tasks and re-queues cancelled ones', async () => {
  const env = await setup(restartBranchesDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 3)
    const qa = taskAt(env.store, job.id, 'qa')
    // 人主动取消一条任务：重启时不得复活。
    await env.engine.cancelTask(job.id, qa.id)

    const assistantDispatch = env.workers.dispatched.find(
      (dispatch) => dispatch.request.worker === '沟通助理',
    )
    assistantDispatch.handle.endTurn()
    await waitFor(() => env.store.getJob(job.id).status === 'failed')

    const approve = taskAt(env.store, job.id, 'approve')
    const dev = taskAt(env.store, job.id, 'dev')
    assert.equal(approve.status, 'failed')
    assert.equal(dev.status, 'cancelled')
    assert.match(dev.error, /delegated task/u, 'the cancellation carries the termination reason')
    assert.equal(env.store.getTask(qa.id).status, 'cancelled')
    assert.equal(env.store.getTask(qa.id).error, null, 'a person cancellation has no error')
    const startBefore = env.store.getTask(startTaskId(job.id))

    const outcome = await env.engine.restartJob(job.id, 'failed')
    assert.equal(outcome.mode, 'failed')
    assert.equal(outcome.job.id, job.id, 'resuming keeps the same job')
    assert.equal(outcome.source.id, job.id)

    const restarted = env.store.getJob(job.id)
    assert.equal(restarted.status, 'running')
    assert.equal(restarted.error, null)
    assert.equal(restarted.finishedAt, null)
    assert.equal(restarted.restartCount, 1)
    assert.equal(typeof restarted.budgetStartedAt, 'string')

    await waitFor(
      () =>
        env.workers.dispatched.filter((entry) => entry.request.worker === '沟通助理').length === 2,
    )
    await waitFor(
      () =>
        env.workers.dispatched.filter((entry) => entry.request.worker === '软件工程师').length ===
        2,
    )
    assert.equal(
      env.workers.dispatched.filter((entry) => entry.request.worker === '质量保障工程师').length,
      1,
      'the person-cancelled task is not revived',
    )

    const resumedApprove = env.store.getTask(approve.id)
    const resumedDev = env.store.getTask(dev.id)
    assert.equal(resumedApprove.status, 'running', 'the failed task is dispatched again')
    assert.equal(resumedDev.status, 'running', 'the termination-cancelled task is queued again')
    assert.equal(resumedApprove.error, null)
    assert.equal(resumedDev.error, null)
    assert.equal(resumedApprove.attemptIds.length, 2, 'a new attempt is appended')
    assert.equal(resumedDev.attemptIds.length, 2)
    assert.deepEqual(
      env.store.listAttempts(approve.id).map((attempt) => attempt.status),
      ['failed', 'running'],
    )
    assert.deepEqual(
      env.store.listAttempts(dev.id).map((attempt) => attempt.status),
      ['cancelled', 'running'],
    )

    assert.equal(env.store.getTask(qa.id).status, 'cancelled')
    const startAfter = env.store.getTask(startTaskId(job.id))
    assert.equal(startAfter.status, 'completed', 'completed tasks are untouched')
    assert.deepEqual(startAfter.result, startBefore.result)
    assert.equal(startAfter.attemptIds.length, startBefore.attemptIds.length)

    const restartedEvents = (await jobEvents(env.store, job.id)).filter(
      (event) => event.type === 'job/restarted',
    )
    assert.equal(restartedEvents.length, 1)
    assert.equal(restartedEvents[0].data.mode, 'failed')
    assert.equal(restartedEvents[0].data.restartCount, 1)
    assert.equal(restartedEvents[0].data.readyTasks, 1)
    assert.equal(restartedEvents[0].data.queuedTasks, 1)
  } finally {
    await env.cleanup()
  }
})

test('engine: a task a person cancelled from failed stays cancelled after restarting', async () => {
  const env = await setup(assistantWithParallelDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 2)
    const devDispatch = env.workers.dispatched.find(
      (dispatch) => dispatch.request.worker === '软件工程师',
    )
    const assistantDispatch = env.workers.dispatched.find(
      (dispatch) => dispatch.request.worker === '沟通助理',
    )

    devDispatch.handle.endTurn()
    const dev = taskAt(env.store, job.id, 'dev')
    await waitFor(() => env.store.getTask(dev.id).status === 'failed')
    // 人放弃一条失败任务：取消后 error 置空，重启时不能被当成作业终止的取消。
    await env.engine.cancelTask(job.id, dev.id)
    const cancelled = env.store.getTask(dev.id)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.error, null)

    assistantDispatch.handle.endTurn()
    await waitFor(() => env.store.getJob(job.id).status === 'failed')
    await env.engine.restartJob(job.id, 'failed')
    await waitFor(
      () =>
        env.workers.dispatched.filter((entry) => entry.request.worker === '沟通助理').length === 2,
    )
    assert.equal(
      env.store.getTask(dev.id).status,
      'cancelled',
      'a person cancellation is not revived',
    )
    assert.equal(env.store.getTask(dev.id).error, null)
    assert.equal(
      env.workers.dispatched.filter((entry) => entry.request.worker === '软件工程师').length,
      1,
      'the person-cancelled task is not dispatched again',
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: giving up a failed task still ends the job as failed', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const now = new Date().toISOString()
    const job = await insertJobWithTasks(env.store, {
      id: 'job-abandoned',
      seq: 62,
      workflowId: env.workflowId,
      definition: simpleDevDefinition(),
      tasks: [
        {
          id: 'task-failed',
          jobId: 'job-abandoned',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'x' },
          assignee: { kind: 'worker', id: '软件工程师', driver: 'agent' },
          status: 'failed',
          error: 'the session ended',
          finishedAt: now,
        },
        {
          id: 'task-end',
          jobId: 'job-abandoned',
          position: 'end',
          type: 'end',
          content: { summary: 'done' },
          assignee: { kind: 'human' },
          deps: ['task-failed'],
          status: 'completed',
          result: { text: 'done', textBytes: 4, textFile: null, attachmentIds: [] },
          finishedAt: now,
        },
      ],
    })
    await env.store.insertAttempt({
      id: 'attempt-failed',
      jobId: job.id,
      taskId: 'task-failed',
      sessionId: null,
      startSeq: null,
      status: 'failed',
      stopReason: null,
      error: 'the session ended',
      promptFile: null,
      startedAt: now,
      finishedAt: now,
    })

    // 人放弃失败任务：任务被取消且 error 置空，但执行记录里的失败尝试让作业
    // 仍然结算为 failed，而不是悄悄变成 completed。
    await env.engine.cancelTask(job.id, 'task-failed')
    assert.equal(env.store.getTask('task-failed').status, 'cancelled')
    assert.equal(env.store.getTask('task-failed').error, null)
    assert.equal(env.store.getJob(job.id).status, 'failed')
    assert.match(env.store.getJob(job.id).error, /failed or was blocked/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: restarting resets the duration budget start so an old failed job is not failed again at once', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 1)
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => env.store.getJob(job.id).status === 'failed')

    // 模拟一条旧记录：按 createdAt 起算早已超时，且没有 budgetStartedAt。
    await env.store.updateJob(job.id, (current) => {
      const next = { ...current, createdAt: '2020-01-01T00:00:00.000Z' }
      delete next.budgetStartedAt
      return next
    })

    const outcome = await env.engine.restartJob(job.id, 'failed')
    assert.equal(outcome.job.status, 'running')
    assert.equal(outcome.job.restartCount, 1)
    assert.equal(typeof outcome.job.budgetStartedAt, 'string')
    await waitFor(() => env.workers.dispatched.length === 2)
    assert.equal(env.store.getJob(job.id).status, 'running', 'the budget counts from the restart')
    assert.equal(env.store.getJob(job.id).error, null)
    assert.equal(taskAt(env.store, job.id, 'approve').status, 'running')
  } finally {
    await env.cleanup()
  }
})

test('engine: starting over creates a new job from the same input on the currently enabled version', async () => {
  const env = await setup(assistantDefinition())
  try {
    const source = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: {},
      delivery: { kind: 'assistant', id: '沟通助理' },
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => env.store.getJob(source.id).status === 'failed')

    // 原作业钉住 v1；重启前保存 v2，从头开始要用当前启用的版本。
    const changed = assistantDefinition()
    changed.name = '发布审批（改）'
    const workflow = await env.engine.saveWorkflow({
      workflowId: env.workflowId,
      definition: changed,
    })
    assert.equal(workflow.latestVersion, 2)

    const outcome = await env.engine.restartJob(source.id, 'scratch')
    assert.equal(outcome.mode, 'scratch')
    assert.notEqual(outcome.job.id, source.id, 'starting over creates a second job')
    const created = env.store.getJob(outcome.job.id)
    assert.equal(created.status, 'running')
    assert.equal(created.seq, source.seq + 1)
    assert.deepEqual(created.input, source.input)
    assert.equal(created.workflowId, env.workflowId)
    assert.equal(created.workflowVersion, 2, 'the new job pins the current version')
    assert.equal(created.definition.name, '发布审批（改）')
    assert.deepEqual(created.starter, { kind: 'human' })
    assert.deepEqual(created.delivery, { kind: 'assistant', id: '沟通助理' })
    assert.equal(created.restartedFrom, source.id)
    assert.equal(created.restartCount, 0)

    const original = env.store.getJob(source.id)
    assert.equal(original.status, 'failed', 'the failed job stays as the scene')
    assert.equal(original.restartedFrom, undefined)
    const restartedEvents = (await jobEvents(env.store, source.id)).filter(
      (event) => event.type === 'job/restarted',
    )
    assert.equal(restartedEvents.length, 1)
    assert.equal(restartedEvents[0].data.mode, 'scratch')
    assert.equal(restartedEvents[0].data.newJobId, created.id)
  } finally {
    await env.cleanup()
  }
})

test('engine: starting over hands the report back to the new human starter when the source used starter delivery', async () => {
  const env = await setup(assistantDefinition())
  try {
    const source = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: {},
    })
    await waitFor(() => env.workers.dispatched.length === 1)
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => env.store.getJob(source.id).status === 'failed')

    const outcome = await env.engine.restartJob(source.id, 'scratch')
    assert.deepEqual(outcome.job.starter, { kind: 'human' })
    assert.deepEqual(outcome.job.delivery, { kind: 'starter' })
  } finally {
    await env.cleanup()
  }
})

test('engine: restarting unblocks blocked tasks once their dependencies recover, but keeps person cancellations', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const failedAt = new Date().toISOString()
    const worker = { kind: 'worker', id: '软件工程师', driver: 'agent' }
    const job = await insertJobWithTasks(env.store, {
      id: 'job-blocked',
      seq: 60,
      workflowId: env.workflowId,
      definition: simpleDevDefinition(),
      tasks: [
        {
          id: 'task-failed',
          jobId: 'job-blocked',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'x' },
          assignee: worker,
          status: 'failed',
          error: 'boom',
          finishedAt: failedAt,
        },
        {
          id: 'task-blocked',
          jobId: 'job-blocked',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'y' },
          assignee: worker,
          deps: ['task-failed'],
          status: 'blocked',
          finishedAt: failedAt,
        },
        {
          id: 'task-blocked-chain',
          jobId: 'job-blocked',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'z' },
          assignee: worker,
          deps: ['task-blocked'],
          status: 'blocked',
          finishedAt: failedAt,
        },
        {
          id: 'task-person-cancelled',
          jobId: 'job-blocked',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'w' },
          assignee: worker,
          deps: ['task-failed'],
          status: 'cancelled',
          error: null,
          finishedAt: failedAt,
        },
        {
          id: 'task-still-blocked',
          jobId: 'job-blocked',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'v' },
          assignee: worker,
          deps: ['task-person-cancelled'],
          status: 'blocked',
          finishedAt: failedAt,
        },
      ],
    })
    await env.store.updateJob(job.id, (current) => ({
      ...current,
      status: 'failed',
      error: 'a task failed',
      finishedAt: current.updatedAt,
    }))

    const detail = await env.engine.jobDetail(job.id)
    assert.equal(detail.restart.failed.available, true)
    assert.equal(detail.restart.scratch.available, true)

    const outcome = await env.engine.restartJob(job.id, 'failed')
    assert.equal(outcome.job.status, 'running')
    assert.equal(outcome.job.restartCount, 1)

    await waitFor(() => env.store.getTask('task-failed').status === 'running')
    assert.equal(env.store.getTask('task-blocked').status, 'pending')
    assert.equal(
      env.store.getTask('task-blocked-chain').status,
      'pending',
      'blocked tasks recover iteratively with their dependencies',
    )
    assert.equal(env.store.getTask('task-person-cancelled').status, 'cancelled')
    assert.equal(env.store.getTask('task-person-cancelled').error, null)
    assert.equal(
      env.store.getTask('task-still-blocked').status,
      'blocked',
      'a task depending on a person cancellation stays blocked',
    )
  } finally {
    await env.cleanup()
  }
})

test('engine: restart options are unavailable for non-failed jobs and when no failed task exists', async () => {
  const env = await setup(simpleDevDefinition())
  try {
    const running = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    let detail = await env.engine.jobDetail(running.id)
    assert.deepEqual(detail.restart.failed, { available: false, reason: 'job-not-failed' })
    assert.deepEqual(detail.restart.scratch, { available: false, reason: 'job-not-failed' })
    await assert.rejects(() => env.engine.restartJob(running.id, 'failed'), /only failed jobs/u)

    const failed = await insertJobWithTasks(env.store, {
      id: 'job-no-failed-task',
      seq: 61,
      workflowId: env.workflowId,
      definition: simpleDevDefinition(),
      tasks: [
        {
          id: 'task-done',
          jobId: 'job-no-failed-task',
          position: 'dev',
          type: 'dev.implement',
          content: { requirement: 'x' },
          assignee: { kind: 'worker', id: '软件工程师', driver: 'agent' },
          deps: [START_TASK_ID],
          status: 'completed',
          result: { text: 'done', textBytes: 4, textFile: null, attachmentIds: [] },
          finishedAt: new Date().toISOString(),
        },
      ],
    })
    await env.store.updateJob(failed.id, (current) => ({
      ...current,
      status: 'failed',
      error: 'never reached the end',
      finishedAt: current.updatedAt,
    }))
    detail = await env.engine.jobDetail(failed.id)
    assert.deepEqual(detail.restart.failed, { available: false, reason: 'no-failed-tasks' })
    assert.equal(detail.restart.scratch.available, true, 'starting over is still possible')
    await assert.rejects(() => env.engine.restartJob(failed.id, 'failed'), /has no failed task/u)
  } finally {
    await env.cleanup()
  }
})

test('engine: starting over is unavailable while the workflow is disabled', async () => {
  const env = await setup(assistantDefinition())
  try {
    const job = await env.engine.createJobFromHuman({ workflowId: env.workflowId, content: {} })
    await waitFor(() => env.workers.dispatched.length === 1)
    env.workers.dispatched[0].handle.endTurn()
    await waitFor(() => env.store.getJob(job.id).status === 'failed')

    await env.engine.setWorkflowActive(env.workflowId, false)
    const detail = await env.engine.jobDetail(job.id)
    assert.equal(
      detail.restart.failed.available,
      true,
      'resuming still works on the pinned version',
    )
    assert.deepEqual(detail.restart.scratch, { available: false, reason: 'workflow-retired' })
    await assert.rejects(() => env.engine.restartJob(job.id, 'scratch'), /not enabled/u)
    assert.equal(env.store.getJob(job.id).status, 'failed', 'the failed job is unchanged')
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
    const boundAtResume = []
    workers.beforeOpenSession = (request) => {
      boundAtResume.push(second.taskForSession(request.sessionId))
    }
    await second.start()
    await waitFor(() => store.getTask(dev.id).status === 'running')
    // resume 之前已经绑定会话：host 的 agent/created 监听按会话注册执行工具。
    assert.equal(boundAtResume.length, 1)
    assert.equal(boundAtResume[0]?.taskId, dev.id)
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

test('engine: a robot creates the declared follow-up task when it finishes', async () => {
  const env = await setup(robotCreatesDefinition())
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { until: new Date(Date.now() - 1000).toISOString() },
    })
    const wait = taskAt(env.store, job.id, 'wait')
    await waitFor(() => env.store.getTask(wait.id).status === 'completed')
    await waitFor(() => taskAt(env.store, job.id, 'run')?.status === 'ready')
    const run = taskAt(env.store, job.id, 'run')
    assert.equal(run.status, 'ready', 'the follow-up task is ready once the robot finished')
    assert.deepEqual(run.deps, [wait.id], 'the follow-up depends on the finished robot task')
    assert.equal(run.createdBy.taskId, wait.id)
    assert.deepEqual(
      run.content,
      { note: wait.content.until },
      'the content template read the robot task',
    )
    assert.equal(env.workers.dispatched.length, 0, 'no session was created')
    assert.equal(env.store.getJob(job.id).status, 'running', 'the human task still waits')
  } finally {
    await env.cleanup()
  }
})

test('engine: a robot may create the end task', async () => {
  const env = await setup(
    robotCreatesDefinition((definition) => {
      definition.positions[0].taskTypes[0].creates = [{ channel: 'wait.end', content: {} }]
      definition.channels.push({ id: 'wait.end', label: '到点结束', from: 'wait', to: 'end' })
    }),
  )
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { until: new Date(Date.now() - 1000).toISOString() },
    })
    const wait = taskAt(env.store, job.id, 'wait')
    await waitFor(() => env.store.getTask(wait.id).status === 'completed')
    await waitFor(() => taskAt(env.store, job.id, 'end')?.status === 'ready')
    const end = taskAt(env.store, job.id, 'end')
    assert.equal(end.status, 'ready', 'the human starter gets the end task on the board')
    assert.deepEqual(end.deps, [wait.id])
  } finally {
    await env.cleanup()
  }
})

test('engine: a failing robot creation fails the robot task and creates nothing', async () => {
  const env = await setup(
    robotCreatesDefinition((definition) => {
      definition.positions[1].taskTypes[0].content = {
        type: 'object',
        properties: { note: { type: 'number' } },
        required: ['note'],
      }
    }),
  )
  try {
    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { until: new Date(Date.now() - 1000).toISOString() },
    })
    const wait = taskAt(env.store, job.id, 'wait')
    await waitFor(() => env.store.getTask(wait.id).status === 'failed')
    const failed = env.store.getTask(wait.id)
    assert.match(failed.error, /program task failed/u)
    assert.equal(taskAt(env.store, job.id, 'run'), undefined, 'no follow-up task was left behind')
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 头像：workers 服务晚于 workflows 就绪时，定义图仍要拿到执行者头像
// ---------------------------------------------------------------------------

test('engine: workflow detail resolves worker avatars even when the workers service starts late', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-avatar-'))
  const store = new WorkflowStore({ domain: new FakeDomain(), dataDir })
  await store.init()
  const workers = makeWorkers([
    {
      id: 'software-engineer',
      name: '软件工程师',
      driver: 'agent',
      avatar: 'rocket',
    },
  ])
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
    const definition = simpleDevDefinition()
    definition.positions[0].executor = { kind: 'worker', id: 'software-engineer' }
    const workflow = await engine.saveWorkflow({ definition })
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
    assert.equal(
      positions[0]?.executor?.id,
      'software-engineer',
      'the identifier reaches the graph',
    )
    assert.equal(positions[0]?.executor?.name, '软件工程师', 'the display name reaches the graph')
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
    // 执行者工作区指向临时目录（附件相对路径的根）。
    const workers = makeWorkers([
      { id: '软件工程师', name: '', driver: 'agent', path: workspace },
      { id: '质量保障工程师', name: '', driver: 'agent', path: workspace },
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

test('附件预览分类：Markdown 扩展名归入 markdown 类型，其余不变', () => {
  assert.deepEqual(attachmentPreviewInfo('report.md'), { kind: 'markdown', mime: 'text/markdown' })
  assert.deepEqual(attachmentPreviewInfo('REPORT.MARKDOWN'), {
    kind: 'markdown',
    mime: 'text/markdown',
  })
  assert.deepEqual(attachmentPreviewInfo('notes.txt'), { kind: 'text', mime: 'text/plain' })
  assert.deepEqual(attachmentPreviewInfo('chart.png'), { kind: 'image', mime: 'image/png' })
  assert.deepEqual(attachmentPreviewInfo('doc.pdf'), { kind: 'pdf', mime: 'application/pdf' })
})

test('附件预览路由：markdown 附件返回全文与同作业图片清单，超限截断、二进制降级', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-md-workspace-'))
  try {
    await fs.mkdir(path.join(workspace, 'artifacts'), { recursive: true })
    const reportText = '# 交付报告\n\n正文 **加粗**。\n'
    await fs.writeFile(path.join(workspace, 'artifacts', 'report.md'), reportText, 'utf8')
    await fs.writeFile(
      path.join(workspace, 'artifacts', 'big.md'),
      Buffer.alloc(1024 * 1024 + 1, 0x61),
    )
    await fs.writeFile(path.join(workspace, 'artifacts', 'figure.png'), 'fake-png', 'utf8')
    await fs.writeFile(
      path.join(workspace, 'artifacts', 'binary.md'),
      Buffer.from([0x50, 0x4b, 0x00, 0x03, 0x04]),
    )
    const workers = makeWorkers([
      { id: '软件工程师', name: '', driver: 'agent', path: workspace },
      { id: '质量保障工程师', name: '', driver: 'agent', path: workspace },
    ])
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-md-'))
    try {
      const domain = new FakeDomain()
      const store = new WorkflowStore({ domain, dataDir })
      await store.init()
      const engine = new WorkflowEngine({
        ctx: {},
        store,
        options: makeOptions(dataDir, { maxAttachmentBytes: 2 * 1024 * 1024 }),
        logger: undefined,
        workers: () => workers,
        delivery: makeDelivery(),
      })
      await engine.start()
      const workflow = await engine.saveWorkflow({ definition: reviewDefinition() })
      await engine.setWorkflowActive(workflow.id, true)
      const job = await engine.createJobFromHuman({
        workflowId: workflow.id,
        content: { requirement: 'x' },
      })
      await waitFor(() => workers.dispatched.length === 1)
      const devSession = workers.dispatched[0].sessionId
      await engine.completeTaskFromSession({
        sessionId: devSession,
        text: '',
        attachments: [
          { path: 'artifacts/report.md', name: 'report.md' },
          { path: 'artifacts/big.md', name: 'big.md' },
          { path: 'artifacts/figure.png', name: 'figure.png' },
          { path: 'artifacts/binary.md', name: 'binary.md' },
        ],
      })
      const records = store.listAttachments(job.id)
      const byName = new Map(records.map((record) => [record.name, record]))

      // 入库记录：markdown 附件的 mime 记为 text/markdown。
      assert.equal(byName.get('report.md').mime, 'text/markdown')
      assert.equal(byName.get('figure.png').mime, 'image/png')

      const registered = []
      registerWorkflowRoutes({
        ctx: {
          inject(_names, callback) {
            callback({
              webServer: {
                register(route) {
                  registered.push(route)
                  return () => {}
                },
              },
              connection: { requestRejection: () => undefined },
              effect: (fn) => fn(),
              logger: undefined,
            })
          },
        },
        ready: async () => engine,
      })
      const attachmentRoute = registered.find(
        (entry) => entry.path === '/buka-workflows/attachment',
      )
      assert.ok(attachmentRoute, 'the attachment route is registered')

      /** 发一个 GET preview 请求。 */
      const preview = async (attachmentId) => {
        const req = {
          method: 'GET',
          url: `/buka-workflows/attachment?jobId=${job.id}&attachmentId=${attachmentId}&mode=preview`,
          headers: {},
          async *[Symbol.asyncIterator]() {},
        }
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
        await attachmentRoute.handler(req, res)
        return { status: res.statusCode, payload: JSON.parse(res.body) }
      }

      const report = byName.get('report.md')
      let response = await preview(report.id)
      assert.equal(response.status, 200)
      assert.equal(response.payload.ok, true)
      assert.equal(response.payload.attachment.kind, 'markdown')
      assert.equal(response.payload.attachment.mime, 'text/markdown')
      assert.equal(response.payload.attachment.text, reportText)
      assert.equal(response.payload.attachment.truncated, false)
      assert.deepEqual(response.payload.attachment.images, [
        { id: byName.get('figure.png').id, name: 'figure.png' },
      ])

      const big = byName.get('big.md')
      response = await preview(big.id)
      assert.equal(response.payload.attachment.kind, 'markdown')
      assert.equal(response.payload.attachment.truncated, true)
      assert.equal(response.payload.attachment.text.length, 1024 * 1024)

      const binary = byName.get('binary.md')
      response = await preview(binary.id)
      assert.equal(response.payload.attachment.kind, 'binary')
      assert.equal(response.payload.attachment.mime, null)

      const figure = byName.get('figure.png')
      response = await preview(figure.id)
      assert.equal(response.payload.attachment.kind, 'image')
      assert.equal(response.payload.attachment.mime, 'image/png')
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
      '/buka-workflows/job/restart',
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

test('routes: POST job/restart validates the mode and returns a stable error code', async () => {
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
    registerWorkflowRoutes({
      ctx: {
        inject(_names, callback) {
          callback(webCtx)
        },
      },
      ready: async () => env.engine,
    })

    const job = await env.engine.createJobFromHuman({
      workflowId: env.workflowId,
      content: { requirement: 'x' },
    })
    const restartRoute = registered.find((entry) => entry.path === '/buka-workflows/job/restart')
    assert.ok(restartRoute, 'the restart route is registered')

    /** 发一个 JSON POST。 */
    const post = async (body) => {
      const text = JSON.stringify(body)
      const req = {
        method: 'POST',
        url: '/buka-workflows/job/restart',
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(text)
        },
        resume() {},
      }
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value
        },
        end(value) {
          this.body = value
        },
      }
      await restartRoute.handler(req, res)
      return { status: res.statusCode, payload: JSON.parse(res.body) }
    }

    let response = await post({ jobId: job.id, mode: 'failed' })
    assert.equal(response.status, 409)
    assert.equal(response.payload.code, 'job-not-failed')

    response = await post({ jobId: job.id, mode: 'bogus' })
    assert.equal(response.status, 400)
    assert.equal(response.payload.code, 'invalid-mode')

    response = await post({ mode: 'failed' })
    assert.equal(response.status, 400)
    assert.equal(response.payload.code, 'invalid-id')
  } finally {
    await env.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 派生不可用：工作流 / 作业引用缺失执行者
// ---------------------------------------------------------------------------

/** 两条并行分支：dev(软件工程师) 与 qa(质量保障工程师)，各自都能到 end。 */
function parallelBranchesDefinition() {
  const definition = simpleDevDefinition()
  definition.start.next = [
    { channel: 'start.dev', type: 'dev.implement', content: { requirement: 'x' } },
    { channel: 'start.qa', type: 'qa.verify', content: { focus: 'x' } },
  ]
  definition.positions.push({
    id: 'qa',
    label: '验证',
    executor: { kind: 'worker', id: '质量保障工程师' },
    taskTypes: [
      {
        id: 'qa.verify',
        label: '验证',
        content: {
          type: 'object',
          properties: { focus: { type: 'string' } },
          required: ['focus'],
        },
      },
    ],
  })
  definition.channels = [
    { id: 'start.dev', label: '开始研发', from: 'start', to: 'dev' },
    { id: 'start.qa', label: '开始验证', from: 'start', to: 'qa' },
    { id: 'dev.end', label: '交付', from: 'dev', to: 'end' },
    { id: 'qa.end', label: '验证完成', from: 'qa', to: 'end' },
  ]
  return definition
}

/** 插一个带指定任务的 running 作业（任务直接构建，不经过调度）。 */
async function insertJobWithTasks(
  store,
  { id, seq, definition, tasks, workflowId = 'wf-availability' },
) {
  const timestamp = new Date().toISOString()
  const job = {
    id,
    seq,
    workflowId,
    workflowVersion: 1,
    workflowName: definition.name,
    workflowDescription: '',
    definition,
    status: 'running',
    starter: { kind: 'human' },
    input: { requirement: '不可用测试' },
    delivery: { kind: 'starter' },
    inputSummary: '不可用测试',
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  }
  await store.ensureJobDirectories(job.id)
  await store.insertJob(job)
  await store.insertTask({
    id: START_TASK_ID,
    jobId: job.id,
    position: 'start',
    type: 'start',
    channel: null,
    content: { requirement: '不可用测试' },
    deps: [],
    status: 'completed',
    createdBy: null,
    assignee: { kind: 'human' },
    claimant: { kind: 'human', name: '本地用户', sessionId: null },
    attemptIds: [],
    result: { text: '', textBytes: 0, textFile: null, attachmentIds: [] },
    error: null,
    createdAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    updatedAt: timestamp,
  })
  for (const task of tasks) {
    await store.insertTask({
      channel: null,
      deps: [START_TASK_ID],
      status: 'pending',
      createdBy: { taskId: START_TASK_ID, position: 'start' },
      claimant: null,
      attemptIds: [],
      result: null,
      error: null,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
      updatedAt: timestamp,
      ...task,
    })
  }
  return job
}

test('engine: a workflow referencing a deleted worker derives unavailable, blocks start and recovers on rebind', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-unavailable-'))
  const store = new WorkflowStore({ domain: new FakeDomain(), dataDir })
  await store.init()
  const delivery = makeDelivery()
  const options = makeOptions(dataDir)
  const workersFull = makeWorkers()
  let engine
  try {
    engine = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => workersFull,
      delivery,
    })
    await engine.start()
    const workflow = await engine.saveWorkflow({ definition: simpleDevDefinition() })
    await engine.setWorkflowActive(workflow.id, true)
    engine.dispose()

    // 删除执行者：重新读登记表，工作流派生「不可用」。
    const workersMissing = makeWorkers(WORKER_ENTRIES.filter((entry) => entry.id !== '软件工程师'))
    engine = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => workersMissing,
      delivery,
    })
    await engine.start()

    const summaries = await engine.listWorkflowSummaries()
    const summary = summaries.find((entry) => entry.id === workflow.id)
    assert.equal(summary.availability.available, false, 'list marks the workflow unavailable')
    assert.deepEqual(
      summary.availability.missingWorkers.map((entry) => entry.id),
      ['软件工程师'],
    )

    const detail = await engine.readWorkflowDetail(workflow.id)
    assert.equal(detail.workflow.availability.available, false)
    assert.equal(detail.graph.positions[0].executor.missing, true)
    assert.equal(detail.graph.positions[0].executor.name, undefined)

    await assert.rejects(
      () =>
        engine.createJobFromHuman({
          workflowId: workflow.id,
          content: { requirement: 'x' },
        }),
      (error) =>
        error.code === 'workflow-unavailable' &&
        /missing worker identifiers/u.test(error.message) &&
        /软件工程师/u.test(error.message),
    )
    engine.dispose()

    // 重新绑定一个已存在的执行者：自动恢复可用，可以启动作业。
    const workersRebound = makeWorkers()
    engine = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => workersRebound,
      delivery,
    })
    await engine.start()
    const recovered = await engine.readWorkflowDetail(workflow.id)
    assert.equal(recovered.workflow.availability.available, true, 'rebinding clears unavailable')
    const job = await engine.createJobFromHuman({
      workflowId: workflow.id,
      content: { requirement: 'x' },
    })
    assert.equal(job.status, 'running')
  } finally {
    engine?.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('engine: workerUsage lists running jobs, workflows and finished job count', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-usage-'))
  const store = new WorkflowStore({ domain: new FakeDomain(), dataDir })
  await store.init()
  const workers = makeWorkers()
  const engine = new WorkflowEngine({
    ctx: {},
    store,
    options: makeOptions(dataDir),
    logger: undefined,
    workers: () => workers,
    delivery: makeDelivery(),
  })
  try {
    await engine.start()
    const workflow = await engine.saveWorkflow({ definition: simpleDevDefinition() })
    await engine.setWorkflowActive(workflow.id, true)
    const running = await engine.createJobFromHuman({
      workflowId: workflow.id,
      content: { requirement: 'x' },
    })

    // 一个引用同一标识符的已结束作业，与一个交回方式点名助理的已结束作业。
    const finished = await insertJobWithTasks(store, {
      id: 'job-finished',
      seq: 9,
      definition: simpleDevDefinition(),
      tasks: [],
    })
    await store.updateJob(finished.id, (current) => ({
      ...current,
      status: 'completed',
      finishedAt: current.updatedAt,
    }))
    const deliveryOnlyDefinition = simpleDevDefinition()
    deliveryOnlyDefinition.positions[0].executor = { kind: 'human' }
    const delivered = await insertJobWithTasks(store, {
      id: 'job-delivered',
      seq: 10,
      definition: deliveryOnlyDefinition,
      tasks: [],
    })
    await store.updateJob(delivered.id, (current) => ({
      ...current,
      status: 'completed',
      delivery: { kind: 'assistant', id: '沟通助理' },
      finishedAt: current.updatedAt,
    }))

    const usage = await engine.workerUsage('软件工程师')
    assert.deepEqual(usage.workflows, [
      { workflowId: workflow.id, name: '简单研发', status: 'active' },
    ])
    assert.equal(usage.runningJobs.length, 1)
    assert.equal(usage.runningJobs[0].jobId, running.id)
    assert.equal(usage.runningJobs[0].jobSeq, running.seq)
    assert.equal(usage.runningJobs[0].workflowId, workflow.id)
    assert.equal(usage.runningJobs[0].jobName, '简单研发')
    assert.equal(usage.finishedJobs, 1, 'only the finished job that references the identifier')

    const assistantUsage = await engine.workerUsage('沟通助理')
    assert.equal(assistantUsage.runningJobs.length, 0)
    assert.equal(assistantUsage.finishedJobs, 1, 'a finished job delivery reference still counts')
    assert.deepEqual(assistantUsage.workflows, [])
  } finally {
    engine.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('engine: a task with a deleted executor fails with the identifier, retries, and other branches keep running', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-missing-dispatch-'))
  const store = new WorkflowStore({ domain: new FakeDomain(), dataDir })
  await store.init()
  const options = makeOptions(dataDir)
  const definition = parallelBranchesDefinition()
  const job = await insertJobWithTasks(store, {
    id: 'job-missing',
    seq: 1,
    definition,
    tasks: [
      {
        id: 'task-dev',
        jobId: 'job-missing',
        position: 'dev',
        type: 'dev.implement',
        content: { requirement: 'x' },
        assignee: { kind: 'worker', id: '软件工程师', driver: 'agent', avatar: 'rocket' },
      },
      {
        id: 'task-qa',
        jobId: 'job-missing',
        position: 'qa',
        type: 'qa.verify',
        content: { focus: 'x' },
        assignee: { kind: 'worker', id: '质量保障工程师', driver: 'agent', avatar: 'owl' },
      },
    ],
  })

  const workersMissing = makeWorkers(WORKER_ENTRIES.filter((entry) => entry.id !== '软件工程师'))
  let engine = new WorkflowEngine({
    ctx: {},
    store,
    options,
    logger: undefined,
    workers: () => workersMissing,
    delivery: makeDelivery(),
  })
  try {
    await engine.start()
    await waitFor(() => workersMissing.dispatched.length === 1)

    const dev = store.getTask('task-dev')
    assert.equal(dev.status, 'failed', 'the missing executor task fails')
    assert.match(dev.error, /task "task-dev"/u)
    assert.match(dev.error, /position "研发"/u)
    assert.match(dev.error, /type "开发"/u)
    assert.match(dev.error, /"软件工程师"/u)
    assert.equal(store.getTask('task-qa').status, 'running', 'the other branch keeps running')
    assert.equal(workersMissing.dispatched[0].request.worker, '质量保障工程师')

    const detail = await engine.jobDetail(job.id)
    assert.equal(detail.job.status, 'running')
    assert.equal(detail.availability.available, false)
    assert.deepEqual(
      detail.availability.missingWorkers.map((entry) => entry.id),
      ['软件工程师'],
    )
    // 失败任务可重试：允许的动作里有 retry。
    const taskDetail = engine.taskDetail(job.id, 'task-dev')
    assert.ok(taskDetail.allowedActions.includes('retry'))

    // 等 qa 的 attempt 记下 sessionId，重启续接时才不会丢会话。
    await waitFor(() => store.listAttempts('task-qa').some((attempt) => attempt.sessionId !== null))
    engine.dispose()

    // 重新绑定同一个标识符后重试：任务恢复可派发。
    const workersRebound = makeWorkers()
    engine = new WorkflowEngine({
      ctx: {},
      store,
      options,
      logger: undefined,
      workers: () => workersRebound,
      delivery: makeDelivery(),
    })
    await engine.start()
    await engine.retryTask(job.id, 'task-dev')
    await waitFor(() =>
      workersRebound.dispatched.some((entry) => entry.request.worker === '软件工程师'),
    )
    const retried = store.getTask('task-dev')
    assert.equal(retried.status, 'running')
    assert.equal(retried.error, null)
  } finally {
    engine?.dispose()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
