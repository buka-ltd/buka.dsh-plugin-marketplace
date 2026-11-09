/**
 * 机器人会话里的四个只读工作流工具：总览、执行输入、执行输出与附件读取。
 *
 * 用真实 WorkflowRunStore + 假 defineTool / resolveSession，覆盖节点图、执行顺序、
 * 门禁记录、运行中节点、截断标记与错误分支。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateDefinition } from '../plugins/workflows/lib/definition.js'
import { WorkflowRunStore } from '../plugins/workflows/lib/run-store.js'
import { createSessionToolVisibility, createWorkflowSessionTools } from '../plugins/workflows/lib/session-tools.js'

const DEFINITION = {
  goal: '写发布说明',
  maxSteps: 10,
  nodes: [
    { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: 'PROMPT-DEV' }] },
    {
      id: 'dev',
      type: 'robot',
      robot: 'writer',
      summary: '写草稿',
      next: [{ to: 'review', name: 'pass' }],
    },
    {
      id: 'review',
      type: 'gate',
      title: '发布确认',
      detail: 'GATE-DETAIL',
      onApprove: { to: 'done', name: '同意' },
      onReject: { to: 'done', name: '拒绝' },
    },
    { id: 'done', type: 'end', status: 'completed' },
  ],
}

/**
 * @returns {Promise<{ store: WorkflowRunStore, dir: string }>}
 */
async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-session-tools-'))
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
  assert.equal(parsed.ok, true, parsed.errors.map((error) => `${error.path}: ${error.message}`).join('; '))
  return parsed.plan
}

/**
 * @param {Record<string, any>} run
 * @param {Record<string, any>} definition
 * @param {string} sessionId
 * @param {(value: string) => string | null} resolveSession
 * @returns {Promise<{ store: WorkflowRunStore, dir: string, tools: Record<string, any> }>}
 */
async function writeRun({ run, definition = DEFINITION, sessionId = 'session-dev', resolveSession }) {
  const { store, dir } = await makeStore()
  await store.create({ run, definition, plan: planOf(definition) })
  const tools = Object.fromEntries(
    createWorkflowSessionTools({
      defineTool: (tool) => tool,
      store,
      resolveSession: resolveSession ?? ((id) => (id === sessionId ? { runId: run.runId } : null)),
    }).map((tool) => [tool.name, tool]),
  )
  return { store, dir, tools }
}

/**
 * @param {string} runId
 * @returns {Promise<Record<string, any>>}
 */
async function completedRun(runId) {
  const now = Date.now()
  return {
    version: 2,
    runId,
    seq: 7,
    goal: '写发布说明',
    status: 'completed',
    createdAt: now - 1000,
    updatedAt: now,
    finishedAt: now,
    createdBy: { sessionId: 'root' },
    current: null,
    pendingGate: null,
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
        route: 'pass',
        routeTo: 'review',
        startedAt: now - 900,
        finishedAt: now - 500,
        text: 'OUTPUT-PREVIEW',
        data: { next: 'pass' },
        error: null,
      },
      {
        seq: 2,
        nodeId: 'review',
        visit: 1,
        type: 'gate',
        robot: null,
        sessionId: null,
        status: 'approved',
        decision: 'approved',
        startedAt: now - 400,
        finishedAt: now - 300,
        text: '',
        error: null,
      },
    ],
    sessions: [
      {
        robot: 'writer',
        sessionId: 'session-dev',
        firstNodeId: 'dev',
        lastNodeId: 'dev',
        visits: 1,
        createdAt: now - 900,
        entries: [
          { nodeId: 'dev', visit: 1, seq: 1, sessionId: 'session-dev', at: now - 900, resumed: false, compacted: false },
        ],
      },
    ],
    result: { status: 'completed', lastNode: 'done' },
    error: null,
  }
}

test('session tools: overview exposes graph, states, summaries and execution order without details', async () => {
  const { store, dir, tools } = await writeRun({ run: await completedRun('wf-tools') })
  try {
    assert.deepEqual(Object.keys(tools).sort(), [
      'buka_workflow_execution_attachment',
      'buka_workflow_execution_input',
      'buka_workflow_execution_output',
      'buka_workflow_overview',
    ])
    await store.saveNodeResult('wf-tools', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'PROMPT-DEV',
      promptTruncated: false,
      text: 'OUTPUT-DEV',
      textTruncated: false,
      structured: { next: 'pass' },
      status: 'completed',
      stopReason: 'completed',
    })

    const overview = await tools.buka_workflow_overview.execute({}, { agent: { id: 'session-dev' } })
    assert.equal(overview.run.seq, 7)
    assert.equal(overview.run.status, 'completed')
    assert.deepEqual(
      overview.nodes.map((node) => [node.id, node.state]),
      [
        ['start', 'completed'],
        ['dev', 'completed'],
        ['review', 'approved'],
        ['done', 'completed'],
      ],
    )
    assert.equal(overview.nodes.find((node) => node.id === 'dev').summary, '写草稿')
    assert.deepEqual(overview.edges.map((edge) => [edge.from, edge.to, edge.names]), [
      ['start', 'dev', ['开始']],
      ['dev', 'review', ['pass']],
      ['review', 'done', ['同意']],
      ['review', 'done', ['拒绝']],
    ])
    assert.deepEqual(overview.executions.map((execution) => [execution.seq, execution.nodeId, execution.status]), [
      [1, 'dev', 'completed'],
      [2, 'review', 'approved'],
    ])
    const serialized = JSON.stringify(overview)
    assert.doesNotMatch(serialized, /PROMPT-DEV|OUTPUT-DEV|GATE-DETAIL/)
    const rendered = tools.buka_workflow_overview.output.render({}, overview)[0].text
    assert.match(rendered, /nodes:/)
    assert.match(rendered, /executions:/)
    assert.doesNotMatch(rendered, /PROMPT-DEV|OUTPUT-DEV|GATE-DETAIL/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: input reads the robot prompt and the gate title/detail', async () => {
  const { store, dir, tools } = await writeRun({ run: await completedRun('wf-input') })
  try {
    await store.saveNodeResult('wf-input', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'PROMPT-DEV',
      promptTruncated: false,
      text: 'OUTPUT-DEV',
      textTruncated: false,
      structured: { next: 'pass' },
      status: 'completed',
      stopReason: 'completed',
    })
    const robot = await tools.buka_workflow_execution_input.execute({ seq: 1 }, { agent: { id: 'session-dev' } })
    assert.equal(robot.type, 'robot')
    assert.equal(robot.robot, 'writer')
    assert.equal(robot.input, 'PROMPT-DEV')
    assert.equal(robot.truncated, false)
    assert.match(
      tools.buka_workflow_execution_input.output.render({}, robot)[0].text,
      /PROMPT-DEV/,
    )

    const gate = await tools.buka_workflow_execution_input.execute({ seq: 2 }, { agent: { id: 'session-dev' } })
    assert.equal(gate.type, 'gate')
    assert.equal(gate.robot, null)
    assert.equal(gate.status, 'approved')
    assert.match(gate.input, /发布确认/)
    assert.match(gate.input, /GATE-DETAIL/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: output reads deliverable, structured data and gate decision', async () => {
  const { store, dir, tools } = await writeRun({ run: await completedRun('wf-output') })
  try {
    await store.saveNodeResult('wf-output', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'PROMPT-DEV',
      promptTruncated: false,
      text: 'OUTPUT-DEV',
      textTruncated: false,
      structured: { next: 'pass', ok: true },
      status: 'completed',
      stopReason: 'completed',
      route: 'pass',
    })
    const robot = await tools.buka_workflow_execution_output.execute({ seq: 1 }, { agent: { id: 'session-dev' } })
    assert.equal(robot.status, 'completed')
    assert.equal(robot.stopReason, 'completed')
    assert.equal(robot.output, 'OUTPUT-DEV')
    assert.deepEqual(robot.structured, { next: 'pass', ok: true })
    assert.equal(robot.route, 'pass')
    assert.equal(robot.truncated, false)
    assert.match(
      tools.buka_workflow_execution_output.output.render({}, robot)[0].text,
      /OUTPUT-DEV/,
    )

    const gate = await tools.buka_workflow_execution_output.execute({ seq: 2 }, { agent: { id: 'session-dev' } })
    assert.equal(gate.type, 'gate')
    assert.equal(gate.output, 'approved')
    assert.equal(gate.structured, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: output lists attachments and the attachment tool reads them', async () => {
  const run = await completedRun('wf-files')
  const { store, dir, tools } = await writeRun({ run })
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-session-files-'))
  try {
    await fs.writeFile(path.join(workspace, 'note.md'), 'ATTACHMENT-TEXT\n', 'utf8')
    await fs.writeFile(path.join(workspace, 'data.bin'), Buffer.from([0, 1, 2, 255]))
    const manifest = await store.writeNodeAttachments(
      'wf-files',
      1,
      'dev',
      [
        { path: 'note.md', description: 'text note' },
        { path: 'data.bin', name: 'payload.bin' },
      ],
      { workspace },
    )
    await store.saveNodeResult('wf-files', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'PROMPT-DEV',
      text: 'OUTPUT-DEV',
      structured: { next: 'pass', attachments: manifest },
      attachments: manifest,
      status: 'completed',
      stopReason: 'completed',
      route: 'pass',
    })
    run.steps[0].attachments = manifest
    await store.save(run)

    const expectedManifest = manifest.map((entry) => ({
      ...entry,
      description: entry.description ?? null,
    }))
    const output = await tools.buka_workflow_execution_output.execute(
      { seq: 1 },
      { agent: { id: 'session-dev' } },
    )
    assert.deepEqual(output.attachments, expectedManifest)
    assert.match(
      tools.buka_workflow_execution_output.output.render({}, output)[0].text,
      /note\.md/,
    )

    const listed = await tools.buka_workflow_execution_attachment.execute(
      { seq: 1 },
      { agent: { id: 'session-dev' } },
    )
    assert.equal(listed.attachment, null)
    assert.deepEqual(listed.attachments, expectedManifest)
    assert.match(
      tools.buka_workflow_execution_attachment.output.render({}, listed)[0].text,
      /payload\.bin/,
    )

    const text = await tools.buka_workflow_execution_attachment.execute(
      { seq: 1, name: 'note.md', maxBytes: 4 },
      { agent: { id: 'session-dev' } },
    )
    assert.equal(text.attachment.text, 'ATTA')
    assert.equal(text.attachment.binary, false)
    assert.equal(text.attachment.truncated, true)
    assert.match(text.attachment.path, /attachments[\\/]note\.md$/u)

    const binary = await tools.buka_workflow_execution_attachment.execute(
      { seq: 1, name: 'payload.bin' },
      { agent: { id: 'session-dev' } },
    )
    assert.equal(binary.attachment.binary, true)
    assert.equal(binary.attachment.text, null)
    assert.match(
      tools.buka_workflow_execution_attachment.output.render({}, binary)[0].text,
      /binary/,
    )

    await assert.rejects(
      () =>
        tools.buka_workflow_execution_attachment.execute(
          { seq: 1, name: 'missing.txt' },
          { agent: { id: 'session-dev' } },
        ),
      /available: note\.md, payload\.bin/,
    )
    const overview = await tools.buka_workflow_overview.execute({}, { agent: { id: 'session-dev' } })
    assert.equal(overview.executions[0].attachments, 2)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: an attachment tool refuses a running execution', async () => {
  const now = Date.now()
  const run = {
    version: 2,
    runId: 'wf-file-running',
    seq: 10,
    goal: '运行中',
    status: 'running',
    createdAt: now - 1000,
    updatedAt: now,
    finishedAt: null,
    createdBy: { sessionId: 'root' },
    current: {
      nodeId: 'dev',
      visit: 1,
      seq: 1,
      type: 'robot',
      robot: 'writer',
      prompt: 'RUNNING-PROMPT',
      sessionId: 'session-run',
      startedAt: now,
    },
    pendingGate: null,
    pendingInteraction: null,
    steps: [],
    sessions: [],
    result: null,
    error: null,
  }
  const { store, dir, tools } = await writeRun({ run, sessionId: 'session-run' })
  try {
    await store.saveNodeResult('wf-file-running', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'RUNNING-PROMPT',
      status: 'running',
      attachments: [],
    })
    await assert.rejects(
      () =>
        tools.buka_workflow_execution_attachment.execute(
          { seq: 1 },
          { agent: { id: 'session-run' } },
        ),
      /still running/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: current running execution exposes input but not output', async () => {
  const now = Date.now()
  const run = {
    version: 2,
    runId: 'wf-running',
    seq: 8,
    goal: '运行中',
    status: 'running',
    createdAt: now - 1000,
    updatedAt: now,
    finishedAt: null,
    createdBy: { sessionId: 'root' },
    current: {
      nodeId: 'dev',
      visit: 1,
      seq: 1,
      type: 'robot',
      robot: 'writer',
      prompt: 'RUNNING-PROMPT',
      sessionId: 'session-run',
      startedAt: now,
    },
    pendingGate: null,
    pendingInteraction: null,
    steps: [],
    sessions: [],
    result: null,
    error: null,
  }
  const { store, dir, tools } = await writeRun({ run, sessionId: 'session-run' })
  try {
    await store.saveNodeResult('wf-running', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'RUNNING-PROMPT',
      promptTruncated: false,
      status: 'running',
    })
    const overview = await tools.buka_workflow_overview.execute({}, { agent: { id: 'session-run' } })
    assert.deepEqual(overview.executions.map((execution) => [execution.seq, execution.status]), [[1, 'running']])
    const input = await tools.buka_workflow_execution_input.execute({ seq: 1 }, { agent: { id: 'session-run' } })
    assert.equal(input.input, 'RUNNING-PROMPT')
    await assert.rejects(
      () => tools.buka_workflow_execution_output.execute({ seq: 1 }, { agent: { id: 'session-run' } }),
      /still running/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: a waiting gate exposes input but not output', async () => {
  const now = Date.now()
  const run = {
    version: 2,
    runId: 'wf-gate',
    seq: 9,
    goal: '等待审批',
    status: 'waiting',
    createdAt: now - 1000,
    updatedAt: now,
    finishedAt: null,
    createdBy: { sessionId: 'root' },
    current: { nodeId: 'review', visit: 1, seq: 1, type: 'gate', robot: null, startedAt: now },
    pendingGate: { nodeId: 'review', title: '发布确认', detail: 'GATE-DETAIL', requestedAt: now },
    pendingInteraction: null,
    steps: [],
    sessions: [],
    result: null,
    error: null,
  }
  const { dir, tools } = await writeRun({ run })
  try {
    const input = await tools.buka_workflow_execution_input.execute({ seq: 1 }, { agent: { id: 'session-dev' } })
    assert.equal(input.type, 'gate')
    assert.equal(input.status, 'waiting')
    assert.match(input.input, /发布确认/)
    assert.match(input.input, /GATE-DETAIL/)
    await assert.rejects(
      () => tools.buka_workflow_execution_output.execute({ seq: 1 }, { agent: { id: 'session-dev' } }),
      /waiting for approval/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: truncation flags are returned', async () => {
  const { store, dir, tools } = await writeRun({ run: await completedRun('wf-truncated') })
  try {
    await store.saveNodeResult('wf-truncated', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'CLIPPED-PROMPT',
      promptTruncated: true,
      text: 'CLIPPED-OUTPUT',
      textTruncated: true,
      structured: null,
      status: 'completed',
      stopReason: 'completed',
    })
    const input = await tools.buka_workflow_execution_input.execute({ seq: 1 }, { agent: { id: 'session-dev' } })
    assert.equal(input.truncated, true)
    const output = await tools.buka_workflow_execution_output.execute({ seq: 1 }, { agent: { id: 'session-dev' } })
    assert.equal(output.truncated, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('session tools: unknown seq, missing binding and missing run fail clearly', async () => {
  const { store, dir, tools } = await writeRun({ run: await completedRun('wf-errors') })
  try {
    await store.saveNodeResult('wf-errors', 1, 'dev', {
      nodeId: 'dev',
      seq: 1,
      prompt: 'PROMPT-DEV',
      text: 'OUTPUT-DEV',
      structured: { next: 'pass' },
      status: 'completed',
      stopReason: 'completed',
    })
    await assert.rejects(
      () => tools.buka_workflow_execution_input.execute({ seq: 99 }, { agent: { id: 'session-dev' } }),
      /execution #99 was not found/,
    )
    await assert.rejects(
      () => tools.buka_workflow_execution_output.execute({ seq: 0 }, { agent: { id: 'session-dev' } }),
      /positive integer/,
    )

    const unbound = Object.fromEntries(
      createWorkflowSessionTools({
        defineTool: (tool) => tool,
        store,
        resolveSession: () => null,
      }).map((tool) => [tool.name, tool]),
    )
    await assert.rejects(
      () => unbound.buka_workflow_overview.execute({}, { agent: { id: 'manual' } }),
      /only available to robot sessions/,
    )

    const missing = Object.fromEntries(
      createWorkflowSessionTools({
        defineTool: (tool) => tool,
        store,
        resolveSession: () => ({ runId: 'wf-missing' }),
      }).map((tool) => [tool.name, tool]),
    )
    await assert.rejects(
      () => missing.buka_workflow_overview.execute({}, { agent: { id: 'session-dev' } }),
      /no longer available/,
    )

    // 删掉节点结果文件：step 还在，但输入/输出全文已经不可读。
    await fs.rm(path.join(store.runDirectory('wf-errors'), 'nodes', '1-dev', 'result.json'), {
      force: true,
    })
    await assert.rejects(
      () => tools.buka_workflow_execution_output.execute({ seq: 1 }, { agent: { id: 'session-dev' } }),
      /no recorded output/,
    )
    await assert.rejects(
      () => tools.buka_workflow_execution_input.execute({ seq: 1 }, { agent: { id: 'session-dev' } }),
      /no recorded input/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
test('session tools: visibility is limited to bound robot sessions and never throws', async () => {
  let ensured = 0
  const visible = createSessionToolVisibility({
    ensureIndex: async () => {
      ensured += 1
    },
    resolveSession: (id) => (id === 'session-dev' ? { runId: 'wf-tools' } : null),
  })
  assert.equal(await visible({ agent: { id: 'session-dev' } }), true)
  assert.equal(await visible({ agent: { id: 'manual' } }), false)
  assert.equal(await visible({}), false)
  const aborted = new AbortController()
  aborted.abort()
  assert.equal(await visible({ agent: { id: 'session-dev' }, signal: aborted.signal }), false)

  const broken = createSessionToolVisibility({
    ensureIndex: async () => {
      throw new Error('store unavailable')
    },
    resolveSession: () => ({ runId: 'wf-tools' }),
  })
  assert.equal(await broken({ agent: { id: 'session-dev' } }), false)
  assert.equal(ensured, 3)
})
