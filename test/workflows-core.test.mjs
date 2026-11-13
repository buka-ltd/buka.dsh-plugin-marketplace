/**
 * workflows 领域层单测：状态机、v4 定义校验、storageDomain 存储与 per-job 队列。
 *
 * 直接 import TS 源码（Node 24 原样跑 TS）；存储用内存版 domain 实现，
 * 不依赖宿主。运行：
 *
 *   node --test test/workflows-core.test.mjs
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  edgeAllowsType,
  findEdge,
  findPosition,
  findTaskType,
  validateWorkflowDefinition,
} from '../plugins/workflows/src/definition/index.ts'
import { START_TASK_ID } from '../plugins/workflows/src/domain/ids.ts'
import {
  assertJobTransition,
  assertTaskTransition,
  canTransitionJob,
  canTransitionTask,
  isOpenTaskStatus,
  isTerminalJobStatus,
  isTerminalTaskStatus,
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  TERMINAL_TASK_STATUSES,
} from '../plugins/workflows/src/domain/status.ts'
import { WorkflowStore } from '../plugins/workflows/src/store/index.ts'

// ---------------------------------------------------------------------------
// fixture：spec §5.7 的「研发交付」工作流与 workers 登记
// ---------------------------------------------------------------------------

/** workers 目录：四个 agent、一个助理、一个 program（clock）。 */
function sampleWorkers() {
  return new Map(
    [
      { name: '产品经理', driver: 'agent', assistant: false },
      { name: '软件工程师', driver: 'agent', assistant: false },
      { name: '质量保障工程师', driver: 'agent', assistant: false },
      { name: '发布工程师', driver: 'agent', assistant: false },
      { name: '沟通助理', driver: 'agent', assistant: true },
      { name: 'clock', driver: 'robot', program: 'clock', assistant: false },
    ].map((worker) => [worker.name, worker]),
  )
}

/** spec §5.7 的研发交付定义（approve 补了一条到 deploy 的边，满足「每个岗位都能到达 end」）。 */
function sampleDefinition() {
  return {
    version: 4,
    name: '研发交付',
    description: '需求 → 研发 / 测试准备 → 验证 → 审批 → 发布',
    budgets: { maxTasks: 200, maxDurationHours: 72 },
    start: {
      task: {
        payload: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
          additionalProperties: false,
        },
        output: {
          type: 'object',
          properties: { requirement: { type: 'string' }, acceptance: { type: 'string' } },
          required: ['requirement'],
          additionalProperties: false,
        },
      },
      next: [
        {
          position: 'need',
          type: 'need.analyze',
          payload: { focus: '{{start.output.requirement}}' },
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
          additionalProperties: false,
        },
      },
    },
    positions: [
      {
        id: 'need',
        label: '需求',
        executor: { kind: 'worker', name: '产品经理' },
        taskTypes: [
          {
            id: 'need.analyze',
            label: '需求拆解',
            payload: {
              type: 'object',
              properties: { focus: { type: 'string' } },
              required: ['focus'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: { requirement: { type: 'string' } },
              required: ['requirement'],
              additionalProperties: false,
            },
          },
        ],
      },
      {
        id: 'dev',
        label: '研发',
        executor: { kind: 'worker', name: '软件工程师' },
        taskTypes: [
          {
            id: 'dev.implement',
            label: '开发',
            payload: {
              type: 'object',
              properties: { requirement: { type: 'string' } },
              required: ['requirement'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
              additionalProperties: false,
            },
          },
          {
            id: 'dev.rework',
            label: '返工',
            payload: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
              additionalProperties: false,
            },
          },
        ],
      },
      {
        id: 'qa',
        label: '测试',
        executor: { kind: 'worker', name: '质量保障工程师' },
        taskTypes: [
          {
            id: 'qa.prepare',
            label: '测试准备',
            payload: { type: 'object' },
            output: { type: 'object' },
          },
          {
            id: 'qa.verify',
            label: '验证',
            payload: {
              type: 'object',
              properties: { focus: { type: 'string' } },
              required: ['focus'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['pass', 'fail'] },
                summary: { type: 'string' },
              },
              required: ['result', 'summary'],
              additionalProperties: false,
            },
          },
        ],
      },
      {
        id: 'approve',
        label: '发布审批',
        executor: { kind: 'human' },
        taskTypes: [
          {
            id: 'approve.release',
            label: '批准发布',
            assistant: '沟通助理',
            payload: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: {
                approved: { type: 'string', enum: ['yes', 'no'] },
                note: { type: 'string' },
              },
              required: ['approved'],
              additionalProperties: false,
            },
          },
        ],
      },
      {
        id: 'deploy',
        label: '发布',
        executor: { kind: 'worker', name: '发布工程师' },
        taskTypes: [
          {
            id: 'deploy.run',
            label: '发布',
            payload: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
              additionalProperties: false,
            },
            output: { type: 'object' },
          },
        ],
      },
    ],
    edges: [
      { from: 'start', to: 'need' },
      { from: 'need', to: 'dev' },
      { from: 'need', to: 'qa', types: ['qa.prepare'] },
      { from: 'dev', to: 'qa', types: ['qa.verify'] },
      { from: 'qa', to: 'dev', types: ['dev.rework'], back: true },
      { from: 'qa', to: 'approve', types: ['approve.release'] },
      { from: 'qa', to: 'deploy', types: ['deploy.run'] },
      { from: 'approve', to: 'deploy', types: ['deploy.run'] },
      { from: 'deploy', to: 'end' },
    ],
  }
}

// ---------------------------------------------------------------------------
// 内存版 storageDomain：与真实 KvTable 的读 / 写 / 原子 update 语义一致
// ---------------------------------------------------------------------------

/** 一张内存表。 */
class FakeTable {
  constructor() {
    this.map = new Map()
    /** 每次写递增，测试用来观察写入顺序。 */
    this.writeCount = 0
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
    this.writeCount += 1
    this.map.set(key, value)
  }

  async delete(key) {
    this.writeCount += 1
    return this.map.delete(key)
  }

  async deleteMany(keys) {
    let removed = 0
    for (const key of keys) {
      if (this.map.delete(key)) removed += 1
    }
    this.writeCount += 1
    return removed
  }

  async update(key, fn) {
    if (!this.map.has(key)) throw new Error(`missing-key: ${key}`)
    const next = fn(this.map.get(key))
    this.writeCount += 1
    this.map.set(key, next)
    return next
  }
}

/** 域的内存实现。 */
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
    this.closed = false
  }

  table(name) {
    const table = this.tables[name]
    if (table === undefined) throw new Error(`no table ${name}`)
    return table
  }

  async close() {
    this.closed = true
  }
}

/** 建一个临时数据目录。 */
async function makeDataDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-store-'))
}

/** 建一个接好内存域的 store。 */
async function makeStore() {
  const dataDir = await makeDataDir()
  const domain = new FakeDomain()
  const store = new WorkflowStore({ domain, dataDir })
  await store.init()
  return { store, domain, dataDir }
}

/** 深拷贝（JSON 化，测试 fixture 都是 JSON）。 */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** 在 fixture 上做一次修改，返回新定义。 */
function mutate(change) {
  const definition = sampleDefinition()
  change(definition)
  return definition
}

/** 断言某条校验错误存在。 */
function expectIssue(result, pathPattern, messagePattern) {
  assert.equal(result.ok, false, 'definition should be rejected')
  const matched = result.issues.some(
    (issue) => pathPattern.test(issue.path) && messagePattern.test(issue.message),
  )
  assert.ok(
    matched,
    `expected an issue matching ${pathPattern} / ${messagePattern}, got:\n${JSON.stringify(result.issues, null, 2)}`,
  )
}

/** 断言定义被接受。 */
function expectOk(result) {
  assert.equal(
    result.ok,
    true,
    `expected a valid definition, got:\n${JSON.stringify(result.issues ?? [], null, 2)}`,
  )
  return result.definition
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

const EXPECTED_TASK_TRANSITIONS = {
  pending: ['ready', 'blocked', 'cancelled'],
  ready: ['running', 'completed', 'blocked', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'ready'],
  completed: [],
  failed: ['ready', 'cancelled'],
  blocked: ['cancelled'],
  cancelled: [],
}

test('domain: task status transitions match the state machine', () => {
  for (const [from, allowed] of Object.entries(EXPECTED_TASK_TRANSITIONS)) {
    for (const to of Object.keys(EXPECTED_TASK_TRANSITIONS)) {
      assert.equal(
        canTransitionTask(from, to),
        allowed.includes(to),
        `${from} -> ${to} should be ${allowed.includes(to) ? 'legal' : 'illegal'}`,
      )
    }
  }
  assert.doesNotThrow(() => assertTaskTransition('task-1', 'ready', 'running'))
  assert.throws(
    () => assertTaskTransition('task-1', 'completed', 'running'),
    /illegal status transition/,
  )
  assert.throws(
    () => assertTaskTransition('task-1', 'pending', 'running'),
    /illegal status transition/,
  )
})

test('domain: terminal helpers', () => {
  for (const status of TERMINAL_TASK_STATUSES) assert.equal(isTerminalTaskStatus(status), true)
  assert.equal(isTerminalTaskStatus('running'), false)
  assert.equal(isOpenTaskStatus('ready'), true)
  assert.equal(isOpenTaskStatus('completed'), false)
  for (const status of TERMINAL_JOB_STATUSES) assert.equal(isTerminalJobStatus(status), true)
  assert.equal(isTerminalJobStatus('running'), false)
  for (const from of JOB_STATUSES) {
    for (const to of JOB_STATUSES) {
      assert.equal(canTransitionJob(from, to), from === 'running' && to !== 'running')
    }
  }
  assert.doesNotThrow(() => assertJobTransition('job-1', 'running', 'completed'))
  assert.throws(() => assertJobTransition('job-1', 'failed', 'running'))
})

// ---------------------------------------------------------------------------
// 定义校验
// ---------------------------------------------------------------------------

test('definition: accepts the v4 研发交付 reference workflow', () => {
  const result = validateWorkflowDefinition(sampleDefinition(), { workers: sampleWorkers() })
  const definition = expectOk(result)
  assert.equal(definition.version, 4)
  assert.equal(definition.name, '研发交付')
  assert.equal(definition.positions.length, 5)
  assert.equal(definition.budgets.maxTasks, 200)
  assert.equal(definition.start.next.length, 1)
  assert.deepEqual(definition.start.next[0].dependsOn, ['$start'])
  assert.equal(findPosition(definition, 'dev')?.executor.name, '软件工程师')
  assert.equal(findTaskType(definition, 'qa.verify')?.label, '验证')
  assert.equal(findEdge(definition, 'qa', 'dev')?.back, true)
  assert.equal(edgeAllowsType(findEdge(definition, 'qa', 'dev'), 'dev.rework'), true)
  assert.equal(edgeAllowsType(findEdge(definition, 'qa', 'dev'), 'qa.verify'), false)
  const approve = findPosition(definition, 'approve')
  assert.equal(approve?.executor.kind, 'human')
  assert.equal(approve?.taskTypes[0].assistant, '沟通助理')
})

test('definition: rejects structural and identity errors', () => {
  const workers = sampleWorkers()
  const cases = [
    [mutate((d) => (d.version = 3)), /^version$/, /must be 4/],
    [mutate((d) => (d.positions = [])), /^positions$/, /non-empty array/],
    [
      mutate((d) => d.positions.push(clone(d.positions[0]))),
      /positions\[5\]\.id/,
      /duplicate position id/,
    ],
    [
      mutate((d) => {
        d.positions[0].id = 'start'
      }),
      /positions\[0\]\.id/,
      /reserved/,
    ],
    [
      mutate((d) => {
        d.positions[0].executor = { kind: 'worker', name: '不存在' }
      }),
      /positions\[0\]\.executor\.name/,
      /unknown worker/,
    ],
    [
      mutate((d) => {
        d.positions[1].taskTypes[0].id = 'qa.verify'
      }),
      /positions\[[0-9]+\]\.taskTypes\[[0-9]+\]\.id/,
      /duplicate task type id/,
    ],
    [
      mutate((d) => {
        d.positions[1].taskTypes[0].payload.type = 'object'
        d.positions[1].taskTypes[0].payload.unknownKeyword = true
      }),
      /positions\[1\]\.taskTypes\[0\]\.payload\.unknownKeyword/,
      /not a supported JSON Schema keyword/,
    ],
    [
      mutate((d) => {
        d.positions[1].taskTypes[0].requires = [{ types: ['nope.type'] }]
      }),
      /positions\[1\]\.taskTypes\[0\]\.requires\[0\]\.types/,
      /unknown task type/,
    ],
    [
      mutate((d) => {
        d.positions[1].taskTypes[0].assistant = '沟通助理'
      }),
      /positions\[1\]\.taskTypes\[0\]\.assistant/,
      /only valid on human positions/,
    ],
    [
      mutate((d) => {
        d.positions[3].taskTypes[0].assistant = '产品经理'
      }),
      /positions\[3\]\.taskTypes\[0\]\.assistant/,
      /not marked as an assistant/,
    ],
    [
      mutate((d) => {
        d.positions[3].taskTypes[0].mode = 'plan'
      }),
      /positions\[3\]\.taskTypes\[0\]\.mode/,
      /only valid for agent positions/,
    ],
    [
      mutate((d) => (d.start.task.output = { type: 'string' })),
      /start\.task\.output\.type/,
      /must be "object"/,
    ],
  ]
  for (const [definition, pathPattern, messagePattern] of cases) {
    expectIssue(validateWorkflowDefinition(definition, { workers }), pathPattern, messagePattern)
  }
})

test('definition: rejects edge, cycle and reachability errors', () => {
  const workers = sampleWorkers()
  const cases = [
    [mutate((d) => d.edges.push({ from: 'dev', to: 'nobody' })), /edges\[9\]\.to/, /unknown node/],
    [
      mutate((d) => d.edges.push({ from: 'end', to: 'dev' })),
      /edges\[9\]\.from/,
      /end node cannot dispatch/,
    ],
    [
      mutate((d) => d.edges.push({ from: 'dev', to: 'start' })),
      /edges\[9\]\.to/,
      /start node cannot receive/,
    ],
    [mutate((d) => d.edges.push({ from: 'qa', to: 'dev' })), /edges\[9\]/, /duplicate edge/],
    [
      mutate((d) => d.edges.push({ from: 'approve', to: 'qa', types: ['nope.type'] })),
      /edges\[9\]\.types\[0\]/,
      /not a task type of position "qa"/,
    ],
    [
      mutate((d) => d.edges.push({ from: 'qa', to: 'end', types: ['x'] })),
      /edges\[9\]\.types/,
      /cannot whitelist types/,
    ],
    [
      mutate((d) => {
        d.edges.find((edge) => edge.from === 'qa' && edge.to === 'dev').back = undefined
      }),
      /edges\[3\]\.back/,
      /no explicit back edge/,
    ],
    [
      mutate((d) => {
        d.edges.find((edge) => edge.from === 'need' && edge.to === 'dev').back = true
      }),
      /edges\[1\]\.back/,
      /does not close a cycle/,
    ],
    [
      mutate((d) => {
        d.positions.push({
          id: 'orphan',
          label: '孤儿',
          executor: { kind: 'worker', name: '产品经理' },
          taskTypes: [{ id: 'orphan.task', label: '孤儿任务' }],
        })
        d.edges.push({ from: 'orphan', to: 'end' })
      }),
      /positions\.orphan/,
      /unreachable from the built-in start/,
    ],
    [
      mutate((d) => {
        d.edges = d.edges.filter((edge) => edge.from !== 'deploy')
      }),
      /positions\.deploy/,
      /cannot reach the built-in end node/,
    ],
    [
      mutate((d) => {
        d.edges = d.edges.filter((edge) => edge.to !== 'end')
      }),
      /^edges$/,
      /at least one position must have an edge into the built-in end node/,
    ],
  ]
  for (const [definition, pathPattern, messagePattern] of cases) {
    expectIssue(validateWorkflowDefinition(definition, { workers }), pathPattern, messagePattern)
  }
})

test('definition: rejects start.next dependency and template errors', () => {
  const workers = sampleWorkers()
  const cases = [
    [
      mutate((d) => (d.start.next[0].dependsOn = [])),
      /start\.next\[0\]\.dependsOn/,
      /must be \["\$start"\]/,
    ],
    [
      mutate((d) => (d.start.next[0].dependsOn = ['$start', 'task-1'])),
      /start\.next\[0\]\.dependsOn\[1\]/,
      /can only depend on "\$start"/,
    ],
    [
      mutate((d) => {
        d.start.next[0].position = 'dev'
        d.start.next[0].type = 'dev.implement'
        d.start.next[0].payload = { requirement: '{{start.output.requirement}}' }
      }),
      /start\.next\[0\]\.position/,
      /direct successor/,
    ],
    [
      mutate((d) => (d.start.next[0].payload = { focus: '{{task.abc.output.focus}}' })),
      /start\.next\[0\]\.payload/,
      /no other task exists yet/,
    ],
    [
      mutate((d) => (d.start.next[0].payload = { focus: '{{start.output.missing}}' })),
      /start\.next\[0\]\.payload/,
      /is not declared/,
    ],
    [
      mutate((d) => (d.start.next[0].payload = {})),
      /start\.next\[0\]\.payload\.focus/,
      /missing required field/,
    ],
  ]
  for (const [definition, pathPattern, messagePattern] of cases) {
    expectIssue(validateWorkflowDefinition(definition, { workers }), pathPattern, messagePattern)
  }
})

test('definition: rejects budget and end contract errors', () => {
  const workers = sampleWorkers()
  const cases = [
    [mutate((d) => delete d.budgets), /^budgets$/, /must declare maxTasks/],
    [mutate((d) => (d.budgets.maxTasks = 0)), /budgets\.maxTasks/, /positive integer/],
    [
      mutate((d) => (d.budgets.maxDurationHours = -1)),
      /budgets\.maxDurationHours/,
      /positive number/,
    ],
    [mutate((d) => delete d.end), /^end$/, /built-in end node/],
    [mutate((d) => delete d.end.task.payload), /end\.task\.payload/, /required/],
    [
      mutate((d) => {
        d.end.task.payload = { type: 'object', required: ['nope'] }
      }),
      /end\.task\.payload\.required\[0\]/,
      /not declared in properties/,
    ],
  ]
  for (const [definition, pathPattern, messagePattern] of cases) {
    expectIssue(validateWorkflowDefinition(definition, { workers }), pathPattern, messagePattern)
  }
})

test('definition: workers are valid executors', () => {
  const definition = {
    version: 4,
    name: '定时等待',
    budgets: { maxTasks: 10, maxDurationHours: 1 },
    start: {
      task: {
        payload: { type: 'object' },
        output: { type: 'object', properties: { request: { type: 'string' } } },
      },
      next: [
        {
          position: 'wait',
          type: 'wait.until',
          payload: { until: '{{start.output.request}}' },
          dependsOn: ['$start'],
        },
      ],
    },
    end: { task: { payload: { type: 'object' } } },
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
            output: { type: 'object' },
          },
        ],
      },
    ],
    edges: [
      { from: 'start', to: 'wait' },
      { from: 'wait', to: 'end' },
    ],
  }
  expectOk(validateWorkflowDefinition(definition, { workers: sampleWorkers() }))
})

// ---------------------------------------------------------------------------
// 存储
// ---------------------------------------------------------------------------

test('store: workflow versions, status and job sequence', async () => {
  const { store, dataDir } = await makeStore()
  try {
    const created = await store.createWorkflow({
      name: '研发交付',
      description: '需求到发布',
      definition: sampleDefinition(),
    })
    assert.match(created.id, /^wf-[a-z0-9]+-[a-z0-9]{8}$/)
    assert.equal(created.status, 'active')
    assert.equal(created.latestVersion, 1)
    assert.equal(store.listWorkflows().length, 1)

    const second = await store.saveWorkflowVersion(created.id, {
      ...sampleDefinition(),
      name: '研发交付 v2',
    })
    assert.equal(second.latestVersion, 2)
    assert.equal(second.name, '研发交付 v2')
    assert.equal(second.versions['1'].definition.name, '研发交付')

    assert.equal(store.readWorkflowVersion(created.id)?.version, 2)
    assert.equal(
      store.readWorkflowVersion(created.id, 1)?.versionRecord.definition.name,
      '研发交付',
    )
    assert.equal(store.readWorkflowVersion(created.id, 99), null)

    const activated = await store.activateWorkflow(created.id, true)
    assert.equal(activated.status, 'active')
    const retired = await store.activateWorkflow(created.id, false)
    assert.equal(retired.status, 'retired')

    assert.equal(await store.allocateJobSeq(created.id), 1)
    assert.equal(await store.allocateJobSeq(created.id), 2)
    assert.equal(store.getWorkflow(created.id)?.jobSeq, 2)
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('store: job / task / attempt / attachment records filter by job', async () => {
  const { store, dataDir } = await makeStore()
  try {
    const workflow = await store.createWorkflow({
      name: '研发交付',
      description: '',
      definition: sampleDefinition(),
    })
    const seq = await store.allocateJobSeq(workflow.id)
    const jobBase = {
      id: 'job-test-1',
      seq,
      workflowId: workflow.id,
      workflowVersion: 1,
      workflowName: '研发交付',
      workflowDescription: '',
      definition: sampleDefinition(),
      status: 'running',
      starter: { kind: 'human' },
      input: { raw: { request: 'demo' } },
      inputSummary: 'demo',
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
    }
    await store.insertJob(jobBase)
    assert.equal(store.getJob('job-test-1')?.seq, 1)
    assert.equal(store.countJobs(workflow.id), 1)
    assert.deepEqual(
      store.listJobs(workflow.id).map((job) => job.id),
      ['job-test-1'],
    )

    const updated = await store.updateJob('job-test-1', (current) => ({
      ...current,
      status: 'completed',
      finishedAt: '2026-01-01T01:00:00.000Z',
    }))
    assert.equal(updated.status, 'completed')

    const task = {
      id: START_TASK_ID,
      jobId: 'job-test-1',
      position: 'start',
      type: 'start',
      payload: { request: 'demo' },
      deps: [],
      status: 'completed',
      createdBy: null,
      assignee: { kind: 'human' },
      claimant: { kind: 'human', name: '本地用户', sessionId: null },
      attemptIds: ['att-1'],
      result: null,
      error: null,
      assistantBlocked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    }
    await store.insertTask(task)
    await store.insertTask({
      ...task,
      id: 'task-2',
      position: 'need',
      type: 'need.analyze',
      deps: [START_TASK_ID],
    })
    await store.insertTask({ ...task, id: 'task-3', jobId: 'other-job' })
    assert.deepEqual(
      store.listTasks('job-test-1').map((entry) => entry.id),
      [START_TASK_ID, 'task-2'],
    )
    const claimed = await store.updateTask('task-2', (current) => ({
      ...current,
      status: 'running',
      claimant: { kind: 'worker', name: '产品经理', sessionId: 'session-1' },
    }))
    assert.equal(claimed.status, 'running')

    const attempt = {
      id: 'att-1',
      jobId: 'job-test-1',
      taskId: 'task-2',
      sessionId: 'session-1',
      startSeq: 3,
      status: 'running',
      stopReason: null,
      error: null,
      promptFile: 'prompts/att-1.txt',
      startedAt: '2026-01-01T00:00:02.000Z',
      finishedAt: null,
    }
    await store.insertAttempt(attempt)
    assert.equal(store.listAttempts('task-2').length, 1)
    await store.updateAttempt('att-1', (current) => ({
      ...current,
      status: 'failed',
      error: 'boom',
      finishedAt: '2026-01-01T00:00:03.000Z',
    }))
    assert.equal(store.getAttempt('att-1')?.error, 'boom')

    const attachment = {
      id: 'att-file-1',
      jobId: 'job-test-1',
      name: 'trace.zip',
      bytes: 1234,
      mime: 'application/zip',
      sha256: 'abc',
      description: '失败用例 trace',
      sourceTaskId: 'task-2',
      sourcePositionId: 'need',
      createdBy: '产品经理',
      createdAt: '2026-01-01T00:00:04.000Z',
      path: 'att-file-1-trace.zip',
    }
    await store.insertAttachment(attachment)
    assert.equal(store.listAttachments('job-test-1').length, 1)
    assert.equal(store.getAttachment('att-file-1')?.sha256, 'abc')
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('store: init rejects mismatched keys and backfills the job sequence', async () => {
  const dataDir = await makeDataDir()
  try {
    const domain = new FakeDomain()
    const workflow = {
      id: 'wf-1',
      name: '研发交付',
      description: '',
      status: 'draft',
      latestVersion: 1,
      versions: { 1: { version: 1, definition: sampleDefinition(), createdAt: 't' } },
      jobSeq: 0,
      createdAt: 't',
      updatedAt: 't',
    }
    await domain.table('workflows').put('wf-1', workflow)
    await domain.table('jobs').put('job-5', {
      id: 'job-5',
      seq: 5,
      workflowId: 'wf-1',
      status: 'completed',
    })
    const store = new WorkflowStore({ domain, dataDir })
    await store.init()
    assert.equal(store.getWorkflow('wf-1')?.jobSeq, 5)
    assert.equal(store.getWorkflow('wf-1')?.status, 'active', 'legacy drafts are enabled')

    const broken = new FakeDomain()
    await broken.table('workflows').put('not-the-id', workflow)
    await assert.rejects(
      () => new WorkflowStore({ domain: broken, dataDir }).init(),
      /differs from record id/,
    )
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('store: init normalizes legacy robot executor and claimant kinds', async () => {
  const dataDir = await makeDataDir()
  try {
    const domain = new FakeDomain()
    const definition = sampleDefinition()
    // 术语改名前的作业快照：岗位执行者写成 kind "robot"，承办者也一样。
    definition.positions[0].executor = { kind: 'robot', name: '产品经理' }
    await domain.table('workflows').put('wf-1', {
      id: 'wf-1',
      name: '研发交付',
      description: '',
      status: 'active',
      latestVersion: 1,
      versions: { 1: { version: 1, definition, createdAt: 't' } },
      jobSeq: 0,
      createdAt: 't',
      updatedAt: 't',
    })
    await domain.table('jobs').put('job-1', {
      id: 'job-1',
      seq: 1,
      workflowId: 'wf-1',
      workflowVersion: 1,
      workflowName: '研发交付',
      workflowDescription: '',
      definition,
      status: 'running',
      starter: { kind: 'human' },
      input: { raw: 'x' },
      inputSummary: 'x',
      error: null,
      createdAt: 't',
      updatedAt: 't',
      finishedAt: null,
    })
    await domain.table('tasks').put('task-1', {
      id: 'task-1',
      jobId: 'job-1',
      position: 'need',
      type: 'need.analyze',
      payload: {},
      deps: [],
      status: 'ready',
      createdBy: null,
      assignee: { kind: 'robot', name: '产品经理', driver: 'program' },
      claimant: { kind: 'robot', name: '产品经理', sessionId: null },
      attemptIds: [],
      result: null,
      error: null,
      assistantBlocked: false,
      createdAt: 't',
      startedAt: null,
      finishedAt: null,
      updatedAt: 't',
    })

    await new WorkflowStore({ domain, dataDir }).init()

    assert.deepEqual(domain.table('tasks').get('task-1').assignee, {
      kind: 'worker',
      name: '产品经理',
      driver: 'robot',
    })
    assert.deepEqual(domain.table('tasks').get('task-1').claimant, {
      kind: 'worker',
      name: '产品经理',
      sessionId: null,
    })
    assert.equal(domain.table('jobs').get('job-1').definition.positions[0].executor.kind, 'worker')
    assert.equal(
      domain.table('workflows').get('wf-1').versions['1'].definition.positions[0].executor.kind,
      'worker',
    )
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('store: per-job queue serializes and survives failures', async () => {
  const { store, dataDir } = await makeStore()
  try {
    const order = []
    const first = store.runExclusive('job-a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push('a1')
      throw new Error('boom')
    })
    const second = store.runExclusive('job-a', async () => {
      order.push('a2')
      return 'done'
    })
    const other = store.runExclusive('job-b', async () => {
      order.push('b1')
      return 'other'
    })
    await assert.rejects(() => first, /boom/)
    assert.equal(await second, 'done')
    assert.equal(await other, 'other')
    assert.deepEqual(order, ['b1', 'a1', 'a2'])
    // 队列在 settle 后释放，不会永久保留 key。
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(store.queueSize, 0)
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('store: concurrent task updates are atomic', async () => {
  const { store, domain, dataDir } = await makeStore()
  try {
    await store.insertTask({
      id: 'task-counter',
      jobId: 'job-1',
      position: 'dev',
      type: 'dev.implement',
      payload: {},
      deps: [],
      status: 'pending',
      createdBy: null,
      assignee: { kind: 'human' },
      claimant: null,
      attemptIds: [],
      result: null,
      error: null,
      assistantBlocked: false,
      createdAt: 't',
      startedAt: null,
      finishedAt: null,
      updatedAt: 't',
    })
    await Promise.all(
      Array.from({ length: 20 }, () => store.updateTask('task-counter', (current) => current)),
    )
    assert.equal(domain.table('tasks').writeCount, 21)
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('store: job directories and large text round-trip', async () => {
  const { store, dataDir } = await makeStore()
  try {
    const paths = await store.ensureJobDirectories('job-dir-1')
    assert.equal(await fs.stat(paths.root).then((stat) => stat.isDirectory()), true)
    assert.equal(await fs.stat(paths.attachments).then((stat) => stat.isDirectory()), true)
    const relative = await store.writeText('job-dir-1', 'prompts', 'att-1', 'hello')
    assert.equal(relative, path.join('prompts', 'att-1.txt'))
    assert.equal(await store.readText('job-dir-1', relative), 'hello')
    assert.equal(await store.readText('job-dir-1', 'prompts/nope.txt'), null)
    assert.throws(() => store.paths('../escape'), /invalid job id/)
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
