/**
 * 工作流运行存储的格式版本（v3）单测。
 *
 * 覆盖启动时按版本清退旧运行、序号计数器重置、settings.json 不受影响，以及
 * `pendingInteraction` 在列表与中断标记上的表现。全部使用临时目录，不启动
 * DSH、不联网。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { WORKFLOW_FORMAT_VERSION, WorkflowRunStore } from '../plugins/workflows/src/run-store.ts'

/**
 * 建一个临时根目录：`runs/` 是运行目录，`settings.json` 是它的同级文件。
 *
 * @param {import('node:test').TestContext} t
 * @returns {Promise<{ root: string, runsDir: string, settingsFile: string }>}
 */
async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-format-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, runsDir: path.join(root, 'runs'), settingsFile: path.join(root, 'settings.json') }
}

/**
 * 一条完整的运行状态快照。
 *
 * @param {string} runId
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function sampleRun(runId, overrides = {}) {
  const now = Date.now()
  return {
    version: WORKFLOW_FORMAT_VERSION,
    runId,
    goal: `goal-${runId}`,
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    createdBy: { sessionId: 'root' },
    steps: [],
    ...overrides,
  }
}

/**
 * 直接写一个运行目录（绕过 store.create，模拟旧版本或损坏的数据）。
 *
 * @param {string} runsDir
 * @param {string} runId
 * @param {{
 *   run?: Record<string, any>,
 *   definition?: Record<string, any> | null,
 *   rawDefinition?: string,
 * }} [options]
 * @returns {Promise<string>} 运行目录
 */
async function writeRunDirectory(runsDir, runId, options = {}) {
  const directory = path.join(runsDir, runId)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, 'run.json'),
    `${JSON.stringify(options.run ?? sampleRun(runId), null, 2)}\n`,
  )
  if (options.rawDefinition !== undefined) {
    await fs.writeFile(path.join(directory, 'definition.json'), options.rawDefinition)
  } else if (options.definition !== null) {
    await fs.writeFile(
      path.join(directory, 'definition.json'),
      `${JSON.stringify(
        options.definition ?? {
          version: WORKFLOW_FORMAT_VERSION,
          runId,
          definition: { start: 'a' },
        },
        null,
        2,
      )}\n`,
    )
  }
  return directory
}

test('store format v3: purges runs whose run.json or definition.json is not the current version', async (t) => {
  const { runsDir } = await tempRoot(t)
  await fs.mkdir(runsDir, { recursive: true })

  // 旧格式（版本 1）运行：run.json 和 definition.json 都是 1。
  await writeRunDirectory(runsDir, 'wf-old-run', {
    run: sampleRun('wf-old-run', { version: 1 }),
    definition: { version: 1, runId: 'wf-old-run', definition: {} },
  })
  // 只有一个文件是旧版本也要删：两个版本必须都是当前版本。
  await writeRunDirectory(runsDir, 'wf-old-definition', {
    run: sampleRun('wf-old-definition'),
    definition: { version: 1, runId: 'wf-old-definition', definition: {} },
  })
  // 当前版本的运行要保留。
  await writeRunDirectory(runsDir, 'wf-current', {
    run: sampleRun('wf-current', { seq: 3 }),
    definition: {
      version: WORKFLOW_FORMAT_VERSION,
      runId: 'wf-current',
      definition: { start: 'a' },
    },
  })

  const logs = []
  const store = new WorkflowRunStore({
    dir: runsDir,
    logger: { info: (message) => logs.push(message), warn: (message) => logs.push(message) },
  })
  await store.init()

  assert.deepEqual(await store.listRunIds(), ['wf-current'])
  assert.equal(await store.readRun('wf-old-run'), null)
  assert.equal(await store.readRun('wf-old-definition'), null)
  assert.ok(await store.readRun('wf-current'))
  // 清退数量与原因都要写日志，方便排查「运行怎么没了」。
  assert.ok(
    logs.some((message) => message.includes('wf-old-run')),
    logs.join('\n'),
  )
  assert.ok(
    logs.some((message) => message.includes('2')),
    logs.join('\n'),
  )
})

test('store format v3: deletes runs with a missing or corrupt run/definition snapshot', async (t) => {
  const { runsDir } = await tempRoot(t)
  await fs.mkdir(runsDir, { recursive: true })

  // definition.json 缺失。
  await writeRunDirectory(runsDir, 'wf-missing-definition', {
    run: sampleRun('wf-missing-definition'),
    definition: null,
  })
  // definition.json 损坏。
  await writeRunDirectory(runsDir, 'wf-corrupt-definition', {
    run: sampleRun('wf-corrupt-definition'),
    rawDefinition: '{ not json',
  })
  // run.json 损坏（definition.json 正常）。
  const corruptRunDir = path.join(runsDir, 'wf-corrupt-run')
  await fs.mkdir(corruptRunDir, { recursive: true })
  await fs.writeFile(path.join(corruptRunDir, 'run.json'), '{ nope')
  await fs.writeFile(
    path.join(corruptRunDir, 'definition.json'),
    `${JSON.stringify({ version: WORKFLOW_FORMAT_VERSION, runId: 'wf-corrupt-run' })}\n`,
  )
  // 完全空的目录也当作不可用记录清掉。
  await fs.mkdir(path.join(runsDir, 'wf-empty'), { recursive: true })
  // 正常的当前版本运行保留。
  await writeRunDirectory(runsDir, 'wf-healthy', { run: sampleRun('wf-healthy') })

  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()

  assert.deepEqual(await store.listRunIds(), ['wf-healthy'])
  assert.ok(await store.readRun('wf-healthy'))
})

test('store format v3: every directory purged also resets the sequence counter', async (t) => {
  const { runsDir } = await tempRoot(t)
  await fs.mkdir(runsDir, { recursive: true })
  await writeRunDirectory(runsDir, 'wf-old-a', {
    run: sampleRun('wf-old-a', { version: 1 }),
    definition: { version: 1, runId: 'wf-old-a' },
  })
  await writeRunDirectory(runsDir, 'wf-old-b', {
    run: sampleRun('wf-old-b', { version: 1 }),
    definition: { version: 1, runId: 'wf-old-b' },
  })
  // 旧计数器已经推到很大的号；旧运行都没了就应该回到 #1。
  await fs.writeFile(
    path.join(runsDir, 'sequence.json'),
    `${JSON.stringify({ version: 1, next: 9 })}\n`,
  )

  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()

  assert.deepEqual(await store.listRunIds(), [])
  await assert.rejects(fs.access(path.join(runsDir, 'sequence.json')), { code: 'ENOENT' })
  assert.equal(await store.allocateSeq(), 1)
  // 分配后计数器重新落盘。
  assert.equal(await store.allocateSeq(), 2)
})

test('store format v3: keeps the sequence counter when current-version runs remain', async (t) => {
  const { runsDir } = await tempRoot(t)
  await fs.mkdir(runsDir, { recursive: true })
  await writeRunDirectory(runsDir, 'wf-old', {
    run: sampleRun('wf-old', { version: 1 }),
    definition: { version: 1, runId: 'wf-old' },
  })
  await writeRunDirectory(runsDir, 'wf-current', {
    run: sampleRun('wf-current', { seq: 4 }),
    definition: { version: WORKFLOW_FORMAT_VERSION, runId: 'wf-current' },
  })
  await fs.writeFile(
    path.join(runsDir, 'sequence.json'),
    `${JSON.stringify({ version: 3, next: 12 })}\n`,
  )

  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()

  assert.deepEqual(await store.listRunIds(), ['wf-current'])
  assert.equal(await store.allocateSeq(), 12)
})

test('store format v3: never touches settings.json next to runs/', async (t) => {
  const { runsDir, settingsFile } = await tempRoot(t)
  await fs.mkdir(runsDir, { recursive: true })
  const settingsBody = `${JSON.stringify({ archive: { enabled: false, archiveAfterHours: 24, deleteAfterHours: 168 } }, null, 2)}\n`
  await fs.writeFile(settingsFile, settingsBody)
  await writeRunDirectory(runsDir, 'wf-old', {
    run: sampleRun('wf-old', { version: 1 }),
    definition: { version: 1, runId: 'wf-old' },
  })

  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()

  assert.deepEqual(await store.listRunIds(), [])
  assert.equal(await fs.readFile(settingsFile, 'utf8'), settingsBody)
})

test('store format v3: create() stamps the current version on run and definition snapshots', async (t) => {
  const { runsDir } = await tempRoot(t)
  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()

  // 调用方即使传了旧版本号，也由存储统一改写成当前版本。
  const run = sampleRun('wf-created', { version: 1 })
  await store.create({ run, definition: { start: 'a' }, plan: { start: 'a' } })
  assert.equal(run.version, WORKFLOW_FORMAT_VERSION)

  const stored = await store.readRun('wf-created')
  assert.equal(stored.version, WORKFLOW_FORMAT_VERSION)
  const definition = await store.readDefinition('wf-created')
  assert.equal(definition.version, WORKFLOW_FORMAT_VERSION)

  await store.saveNodeResult('wf-created', 1, 'a', { nodeId: 'a', seq: 1, text: 'hi' })
  const results = await store.readNodeResults('wf-created')
  assert.equal(results[0].version, WORKFLOW_FORMAT_VERSION)
})

test('store format v3: listRuns reports waitingForUser from pendingInteraction', async (t) => {
  const { runsDir } = await tempRoot(t)
  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()
  // 最近的时间：默认归档策略不会把刚写下的记录归档掉。
  const now = Date.now()

  await store.create({
    run: sampleRun('wf-waiting', { status: 'waiting', createdAt: now - 2000 }),
    definition: { start: 'a' },
  })
  await store.save({
    ...(await store.readRun('wf-waiting')),
    status: 'waiting',
    pendingInteraction: {
      kind: 'question',
      nodeId: 'ask',
      visit: 1,
      seq: 2,
      robot: 'writer',
      sessionId: 'session-1',
      askedAt: now,
    },
  })
  await store.create({
    run: sampleRun('wf-idle', { status: 'running', createdAt: now - 1000 }),
    definition: { start: 'a' },
  })
  await store.save({
    ...(await store.readRun('wf-idle')),
    status: 'running',
    pendingInteraction: null,
  })
  // 用户介入节点等待作答也计入 waitingForUser。
  await store.create({
    run: sampleRun('wf-user-waiting', { status: 'waiting', createdAt: now - 3000 }),
    definition: { start: 'a' },
  })
  await store.save({
    ...(await store.readRun('wf-user-waiting')),
    status: 'waiting',
    pendingUser: { nodeId: 'review', title: '发布确认', options: [], questions: [] },
  })

  const runs = await store.listRuns(10)
  const byId = Object.fromEntries(runs.map((item) => [item.runId, item]))
  assert.equal(byId['wf-waiting'].waitingForUser, true)
  assert.equal(byId['wf-user-waiting'].waitingForUser, true)
  assert.equal(byId['wf-idle'].waitingForUser, false)
})

test('store format v3: markInterrupted clears pendingInteraction', async (t) => {
  const { runsDir } = await tempRoot(t)
  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()

  const now = Date.now()
  await store.create({
    run: sampleRun('wf-interrupt', {
      status: 'waiting',
      current: {
        nodeId: 'ask',
        visit: 1,
        seq: 2,
        startedAt: now,
        sessionId: 'session-1',
        recovering: false,
        recoveryAttempts: 0,
      },
      pendingInteraction: {
        kind: 'approval',
        nodeId: 'ask',
        visit: 1,
        seq: 2,
        robot: 'writer',
        sessionId: 'session-1',
        askedAt: now,
        toolName: 'buka_write',
      },
    }),
    definition: { start: 'a' },
  })

  assert.equal((await store.listRuns(10))[0].waitingForUser, true)
  assert.equal(await store.markInterrupted('wf-interrupt', 'host restarted'), true)

  const run = await store.readRun('wf-interrupt')
  assert.equal(run.status, 'interrupted')
  assert.equal(run.pendingInteraction, null)
  assert.equal(run.pendingUser, null)
  assert.equal(run.current, null)
  assert.equal(run.error, 'host restarted')
  assert.equal((await store.listRuns(10))[0].waitingForUser, false)
})
