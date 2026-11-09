/**
 * @buka/dsh-plugin-workflows 纯逻辑模块的单测：模板、落盘存储与自动归档。
 * 定义校验/路由由 test/workflows-format-v2.test.mjs 覆盖，执行由
 * test/workflows-supervisor.test.mjs 覆盖。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { WORKFLOW_FORMAT_VERSION, WorkflowRunStore, truncateUtf8 } from '../plugins/workflows/lib/run-store.js'
import { renderTemplate, TemplateError } from '../plugins/workflows/lib/template.js'

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
  // 附件不可内联时由 run-store 放一个错误标记，模板直接报出原因。
  assert.throws(
    () =>
      renderTemplate('{{nodes.collect.attachments.0.text}}', {
        nodes: { collect: { attachments: [{ text: { __bukaTemplateError: 'attachment is binary' } }] } },
      }),
    /attachment is binary/,
  )
})

test('store: persists, reads and lists runs with their sequence number', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({ dir })
  await store.init()
  const seq = await store.allocateSeq()
  assert.equal(seq, 1)
  const run = {
    version: 1,
    runId: 'wf-test',
    seq,
    goal: 'g',
    status: 'completed',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    finishedAt: Date.now(),
    createdBy: { sessionId: 'root' },
    steps: [],
  }
  await store.create({ run, definition: { start: 'a' } })
  await store.appendEvent('wf-test', 'node/start', { nodeId: 'a' })
  await store.saveNodeResult('wf-test', 1, 'a', { text: 'hello' })

  const nodeResult = await store.readNodeResult('wf-test', 1, 'a')
  assert.equal(nodeResult.text, 'hello')
  assert.equal(await store.readNodeResult('wf-test', 2, 'a'), null)
  assert.equal(await store.readNodeResult('wf-test', 1, '../a'), null)
  assert.equal(await store.readNodeResult('wf-test', 1, 'a/b'), null)

  const stored = await store.readRun('wf-test')
  assert.equal(stored.runId, 'wf-test')
  assert.equal(stored.status, 'completed')
  assert.equal(stored.seq, 1)
  assert.equal(stored.version, WORKFLOW_FORMAT_VERSION)

  const runs = await store.listRuns(10)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].runId, 'wf-test')
  assert.equal(runs[0].seq, 1)
  assert.equal(runs[0].archivedAt, null)

  const files = await fs.readdir(store.runDirectory('wf-test'))
  assert.deepEqual(files.sort(), ['definition.json', 'events.jsonl', 'nodes', 'run.json'])
  // 序号计数器是 runs 目录里的文件，不会被当成一次运行。
  assert.deepEqual(await store.listRunIds(), ['wf-test'])
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: new node result directories and legacy JSON files are both readable', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({ dir })
  await store.init()
  const run = {
    version: 2,
    runId: 'wf-layout',
    seq: 1,
    goal: 'g',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: Date.now(),
    createdBy: { sessionId: 'root' },
    steps: [],
  }
  await store.create({ run, definition: { nodes: [] } })
  await store.saveNodeResult('wf-layout', 1, 'a', { text: 'new-result' })
  assert.equal(
    await fs
      .stat(path.join(store.runDirectory('wf-layout'), 'nodes', '1-a', 'result.json'))
      .then((stat) => stat.isFile()),
    true,
  )

  const nodes = path.join(store.runDirectory('wf-layout'), 'nodes')
  await fs.writeFile(
    path.join(nodes, '2-a.json'),
    `${JSON.stringify({ version: 2, runId: 'wf-layout', seq: 2, nodeId: 'a', text: 'legacy-result' })}\n`,
    'utf8',
  )
  // 同一执行同时存在旧文件时，新目录优先。
  await fs.writeFile(
    path.join(nodes, '1-a.json'),
    `${JSON.stringify({ version: 2, runId: 'wf-layout', seq: 1, nodeId: 'a', text: 'old-result' })}\n`,
    'utf8',
  )
  assert.equal((await store.readNodeResult('wf-layout', 2, 'a')).text, 'legacy-result')
  const results = await store.readNodeResults('wf-layout')
  assert.deepEqual(
    results.map((result) => [result.seq, result.text]),
    [
      [1, 'new-result'],
      [2, 'legacy-result'],
    ],
  )
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: sequence numbers keep growing across restarts and deletions', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const first = new WorkflowRunStore({ dir })
  await first.init()
  assert.equal(await first.allocateSeq(), 1)
  assert.equal(await first.allocateSeq(), 2)
  assert.equal(await first.allocateSeq(), 3)

  // 重开存储：计数器还在，编号继续往后。
  const second = new WorkflowRunStore({ dir })
  await second.init()
  assert.equal(await second.allocateSeq(), 4)

  // 删掉所有运行目录（例如超期自动删除）后编号也不回退。
  for (const runId of await second.listRunIds()) await fs.rm(second.runDirectory(runId), { recursive: true, force: true })
  const third = new WorkflowRunStore({ dir })
  await third.init()
  assert.equal(await third.allocateSeq(), 5)
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: sweep archives old runs, deletes expired runs and never touches live ones', async () => {
  const HOUR = 60 * 60 * 1000
  const base = 1_700_000_000_000
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({
    dir,
    retention: { enabled: true, archiveAfterHours: 24, deleteAfterHours: 168 },
  })
  await store.init()

  /** 写一条指定结束时间的运行。 */
  async function writeRun(runId, status, finishedAt) {
    await store.create({
      run: {
        version: 1,
        runId,
        goal: runId,
        status,
        createdAt: finishedAt - HOUR,
        updatedAt: finishedAt,
        finishedAt,
        createdBy: { sessionId: 'root' },
        steps: [],
      },
      definition: {},
    })
  }

  await writeRun('wf-recent', 'completed', base - 2 * HOUR)
  await writeRun('wf-old', 'completed', base - 25 * HOUR)
  await writeRun('wf-expired', 'completed', base - 200 * HOUR)
  await writeRun('wf-live', 'running', base - 200 * HOUR)

  await store.sweep({ now: base })

  // 超过删除时间：目录被删掉。
  assert.equal(await store.readRun('wf-expired'), null)
  // 超过归档时间但还在保留期内：写 archivedAt，默认列表不再显示。
  const archived = await store.readRun('wf-old')
  assert.equal(archived.archivedAt, base)
  assert.equal(await store.countArchived(), 1)
  assert.deepEqual(
    (await store.listRuns(10)).map((run) => run.runId),
    ['wf-recent', 'wf-live'],
  )
  assert.deepEqual(
    (await store.listRuns(10, { archived: true })).map((run) => run.runId),
    ['wf-old'],
  )
  // 运行中的记录即使很旧也不会被归档或删除。
  const live = await store.readRun('wf-live')
  assert.equal(Object.hasOwn(live, 'archivedAt'), false)
  // 最近结束的记录保持未归档。
  assert.equal(Object.hasOwn(await store.readRun('wf-recent'), 'archivedAt'), false)
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: disabling auto archive keeps old runs', async () => {
  const HOUR = 60 * 60 * 1000
  const base = 1_700_000_000_000
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({
    dir,
    retention: { enabled: false, archiveAfterHours: 24, deleteAfterHours: 168 },
  })
  await store.init()
  await store.create({
    run: {
      version: 1,
      runId: 'wf-ancient',
      goal: '',
      status: 'completed',
      createdAt: base - 500 * HOUR,
      updatedAt: base - 500 * HOUR,
      finishedAt: base - 500 * HOUR,
      createdBy: { sessionId: 'root' },
      steps: [],
    },
    definition: {},
  })
  await store.sweep({ now: base })
  const run = await store.readRun('wf-ancient')
  assert.ok(run, '关闭自动归档后不按时间删除')
  assert.equal(Object.hasOwn(run, 'archivedAt'), false)
  assert.equal(await store.countArchived(), 0)
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: maxRuns only caps archived runs, not records still in retention', async () => {
  const HOUR = 60 * 60 * 1000
  const base = 1_700_000_000_000
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-'))
  const store = new WorkflowRunStore({
    dir,
    maxRuns: 2,
    retention: { enabled: true, archiveAfterHours: 24, deleteAfterHours: 168 },
  })
  await store.init()

  /** 写一条已归档运行；anchor 越小越旧。 */
  async function writeArchived(runId, ageHours) {
    const finishedAt = base - ageHours * HOUR
    await store.create({
      run: {
        version: 1,
        runId,
        goal: '',
        status: 'completed',
        createdAt: finishedAt - HOUR,
        updatedAt: finishedAt,
        finishedAt,
        archivedAt: base - HOUR,
        createdBy: { sessionId: 'root' },
        steps: [],
      },
      definition: {},
    })
  }

  await writeArchived('wf-archived-old', 10)
  await writeArchived('wf-archived-mid', 8)
  await writeArchived('wf-archived-new', 6)
  // 一条仍在保留期内、没有归档的运行：不参与这个上限。
  await store.create({
    run: {
      version: 1,
      runId: 'wf-active',
      goal: '',
      status: 'completed',
      createdAt: base - HOUR,
      updatedAt: base,
      finishedAt: base,
      createdBy: { sessionId: 'root' },
      steps: [],
    },
    definition: {},
  })

  await store.sweep({ now: base })
  const ids = (await store.listRunIds()).sort()
  assert.deepEqual(ids, ['wf-active', 'wf-archived-new'])
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: init leaves unfinished runs for the observer to recover; markInterrupted is explicit', async () => {
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

  // init 不再一律标 interrupted：未完成记录留给观察者恢复。
  const second = new WorkflowRunStore({ dir, maxRuns: 1 })
  await second.init()
  const runs = await second.listRuns(10)
  assert.equal(runs.length, 2)
  for (const id of await second.listRunIds()) {
    const run = await second.readRun(id)
    assert.notEqual(run.status, 'interrupted')
  }
  const unfinished = await second.listUnfinished()
  assert.deepEqual(unfinished.map((run) => run.runId).sort(), ['wf-a', 'wf-b'])
  assert.equal(unfinished[0].status, 'running')
  assert.equal(unfinished[1].status, 'waiting')

  // 确实恢复不了时才显式标记，而且记录不会被删。
  assert.equal(await second.markInterrupted('wf-a', 'cannot resume'), true)
  const marked = await second.readRun('wf-a')
  assert.equal(marked.status, 'interrupted')
  assert.equal(marked.error, 'cannot resume')
  assert.equal(await second.markAllInterrupted('robots unavailable'), 1)
  assert.deepEqual(
    (await second.listUnfinished()).map((run) => run.runId),
    [],
  )
  assert.equal((await second.listRunIds()).length, 2)
  await fs.rm(dir, { recursive: true, force: true })
})

test('store: truncateUtf8 keeps valid multi-byte text', () => {
  const { text, truncated } = truncateUtf8('你好世界', 7)
  assert.equal(truncated, true)
  assert.ok(text === '你好' || text === '你好世')
})
