/**
 * workflow format 2 的单测：v2 定义校验、`next` 路由与运行期纯函数。
 *
 * 全部使用内存数据，不启动 DSH、不读盘、不联网。只覆盖 format 2 的新契约：
 * 没有 `report` / `when` / 机器人节点 prompt，机器人交回的 JSON `next` 按边的
 * `name` 路由。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { describePlan, validateDefinition } from '../plugins/workflows/lib/definition.js'
import * as routing from '../plugins/workflows/lib/routing.js'
import {
  SESSION_TITLE_MAX_BYTES,
  WorkflowCancelledError,
  WorkflowRunError,
  clipUtf8,
  gateReason,
  mapApproval,
  renderNodePrompt,
  robotSessionTitle,
  toToolRun,
} from '../plugins/workflows/lib/run.js'

/**
 * 一份最小的 format 2 定义：start -> dev <-> test -> done。
 *
 * dev 没有 maxVisits，所以在环上时会触发 warning；test 有 maxVisits。
 *
 * @returns {Record<string, any>}
 */
function v2Definition() {
  return {
    goal: '实现并验证导出功能',
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
        output: { type: 'object', properties: {} },
        next: [{ to: 'test', name: '提交测试', prompt: '检查实现：{{nodes.dev.text}}' }],
      },
      {
        id: 'test',
        type: 'robot',
        robot: 'tester',
        summary: '验证导出功能',
        output: { type: 'object', properties: {} },
        maxVisits: 5,
        next: [
          { to: 'dev', name: '测试打回', prompt: '修复：{{nodes.test.text}}' },
          { to: 'done', name: '测试通过' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
}

/**
 * 带门禁的 format 2 定义。
 *
 * @returns {Record<string, any>}
 */
function gateDefinition() {
  return {
    goal: '发布前确认',
    maxSteps: 10,
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: '写发布说明。' }] },
      {
        id: 'dev',
        type: 'robot',
        robot: 'writer',
        summary: '写发布说明',
        output: { type: 'object', properties: {} },
        next: [{ to: 'gate', name: '提交审批' }],
      },
      {
        id: 'gate',
        type: 'gate',
        title: '发布确认',
        detail: '是否同意发布？',
        onApprove: { to: 'publish', name: '同意发布', prompt: '发布：{{nodes.dev.text}}' },
        onReject: 'done',
      },
      {
        id: 'publish',
        type: 'robot',
        robot: 'publisher',
        summary: '发布',
        output: { type: 'object', properties: {} },
        next: [{ to: 'done', name: '完成' }],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
}

/**
 * 校验失败时把错误拼成便于断言的一段文本。
 *
 * @param {{ errors: Array<{ path: string, message: string }> }} parsed
 * @returns {string}
 */
function errorText(parsed) {
  return parsed.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
}

/**
 * @param {unknown} definition
 * @returns {NonNullable<ReturnType<typeof validateDefinition>['plan']>}
 */
function planOf(definition) {
  const parsed = validateDefinition(definition, { maxSteps: 64 })
  assert.equal(parsed.ok, true, errorText(parsed))
  assert.ok(parsed.plan)
  return parsed.plan
}

test('format v2: report is rejected on every robot node', () => {
  for (const report of [true, false, null]) {
    const definition = v2Definition()
    definition.nodes[1].report = report
    const parsed = validateDefinition(definition)
    assert.equal(parsed.ok, false)
    const error = parsed.errors.find((item) => item.path === 'nodes[1].report')
    assert.ok(error, errorText(parsed))
    assert.equal(
      error.message,
      'report was removed in workflow format 2; every robot node always returns JSON',
    )
    assert.equal(Object.hasOwn(parsed.plan ?? {}, 'nodes'), false)
  }
})

test('format v2: when is rejected on robot and gate edges', () => {
  const robotEdge = v2Definition()
  robotEdge.nodes[1].next[0].when = { field: 'status', equals: 'ok' }
  const robotParsed = validateDefinition(robotEdge)
  assert.equal(robotParsed.ok, false)
  const robotError = robotParsed.errors.find((item) => item.path === 'nodes[1].next[0].when')
  assert.ok(robotError, errorText(robotParsed))
  assert.equal(robotError.message, 'when was removed; select the next edge with the JSON "next" route')

  const gateEdge = gateDefinition()
  gateEdge.nodes[2].onApprove.when = { field: 'status', equals: 'ok' }
  const gateParsed = validateDefinition(gateEdge)
  assert.equal(gateParsed.ok, false)
  const gateError = gateParsed.errors.find((item) => item.path === 'nodes[2].onApprove.when')
  assert.ok(gateError, errorText(gateParsed))
  assert.equal(gateError.message, 'when was removed; select the next edge with the JSON "next" route')
})

test('format v2: robot next must be an edge array, not a string shorthand', () => {
  const definition = v2Definition()
  definition.nodes[1].next = 'test'
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, false)
  assert.match(errorText(parsed), /nodes\[1\]\.next: must be an array of edges .*string shorthand/)
})

test('format v2: every edge leaving a robot node needs a unique name', () => {
  const missing = v2Definition()
  delete missing.nodes[1].next[0].name
  const missingParsed = validateDefinition(missing)
  assert.equal(missingParsed.ok, false)
  const missingError = missingParsed.errors.find((item) => item.path === 'nodes[1].next[0].name')
  assert.ok(missingError, errorText(missingParsed))
  assert.match(missingError.message, /unique non-empty name/u)

  const blank = v2Definition()
  blank.nodes[1].next[0].name = '   '
  assert.equal(validateDefinition(blank).ok, false)

  const duplicate = v2Definition()
  duplicate.nodes[2].next = [
    { to: 'dev', name: '打回', prompt: '修复：{{nodes.test.text}}' },
    { to: 'dev', name: '打回', prompt: '再修一次：{{nodes.test.text}}' },
    { to: 'done', name: '测试通过' },
  ]
  const duplicateParsed = validateDefinition(duplicate)
  assert.equal(duplicateParsed.ok, false)
  const duplicateError = duplicateParsed.errors.find((item) => item.path === 'nodes[2].next[1].name')
  assert.ok(duplicateError, errorText(duplicateParsed))
  assert.match(duplicateError.message, /duplicate edge name "打回"/u)
})

test('format v2: multiple edges to the same target are allowed with distinct names', () => {
  const definition = v2Definition()
  definition.nodes[2].next = [
    { to: 'dev', name: '打回', prompt: '修复：{{nodes.test.text}}' },
    { to: 'dev', name: '再试一次', prompt: '继续修复：{{nodes.test.text}}' },
    { to: 'done', name: '测试通过' },
  ]
  const plan = planOf(definition)
  assert.deepEqual(
    plan.nodes.test.next.map((edge) => [edge.to, edge.name]),
    [
      ['dev', '打回'],
      ['dev', '再试一次'],
      ['done', '测试通过'],
    ],
  )
})

test('format v2: edges entering a robot need a prompt; edges into gate/end must not', () => {
  const missingPrompt = v2Definition()
  delete missingPrompt.nodes[1].next[0].prompt
  const missingParsed = validateDefinition(missingPrompt)
  assert.equal(missingParsed.ok, false)
  assert.match(
    errorText(missingParsed),
    /nodes\[1\]\.next\[0\]\.prompt: an edge entering a robot node must carry its prompt/u,
  )

  const promptToEnd = v2Definition()
  promptToEnd.nodes[2].next[1].prompt = '终止节点不执行，不需要 prompt'
  const promptParsed = validateDefinition(promptToEnd)
  assert.equal(promptParsed.ok, false)
  assert.match(
    errorText(promptParsed),
    /nodes\[2\]\.next\[1\]\.prompt: an edge prompt is only supported when the edge enters a robot node/u,
  )

  const promptToGate = gateDefinition()
  promptToGate.nodes[1].next[0].prompt = '门禁不跑会话'
  const gateParsed = validateDefinition(promptToGate)
  assert.equal(gateParsed.ok, false)
  assert.match(gateParsed.errors.map((error) => error.path).join('\n'), /nodes\[1\]\.next\[0\]\.prompt/u)
})

test('format v2: robot nodes do not carry a prompt and the start node is required', () => {
  const legacyPrompt = v2Definition()
  legacyPrompt.nodes[1].prompt = '旧格式的节点 prompt'
  const promptParsed = validateDefinition(legacyPrompt)
  assert.equal(promptParsed.ok, false)
  assert.match(
    errorText(promptParsed),
    /nodes\[1\]\.prompt: robot nodes no longer carry a prompt; define it on the edge entering this node/u,
  )

  const noStart = v2Definition()
  noStart.nodes.shift()
  const noStartParsed = validateDefinition(noStart)
  assert.equal(noStartParsed.ok, false)
  assert.match(errorText(noStartParsed), /start: a workflow definition needs exactly one node with type "start"/u)

  const legacyTopLevelStart = v2Definition()
  legacyTopLevelStart.start = 'dev'
  const legacyParsed = validateDefinition(legacyTopLevelStart)
  assert.equal(legacyParsed.ok, false)
  assert.match(errorText(legacyParsed), /the legacy top-level "start" format was removed/u)
})

test('format v2: start / gate / end parsing is unchanged', () => {
  const plan = planOf(gateDefinition())
  assert.equal(plan.start, 'start')
  assert.deepEqual(plan.order, ['start', 'dev', 'gate', 'publish', 'done'])
  assert.deepEqual(plan.nodes.start.next, [{ to: 'dev', name: '开始', prompt: '写发布说明。' }])
  assert.equal(plan.nodes.gate.title, '发布确认')
  assert.deepEqual(plan.nodes.gate.onApprove, {
    to: 'publish',
    name: '同意发布',
    prompt: '发布：{{nodes.dev.text}}',
  })
  assert.deepEqual(plan.nodes.gate.onReject, { to: 'done' })
  assert.equal(plan.nodes.done.status, 'completed')
  // format 2 的机器人节点没有 prompt / report 字段。
  assert.equal(Object.hasOwn(plan.nodes.dev, 'prompt'), false)
  assert.equal(Object.hasOwn(plan.nodes.dev, 'report'), false)
  assert.equal(Object.hasOwn(plan.nodes.dev, 'summary'), true)
})

test('format v2: describePlan exposes the route names of each robot node', () => {
  const plan = planOf(v2Definition())
  const described = describePlan(plan)
  const byId = Object.fromEntries(described.nodes.map((node) => [node.id, node]))
  assert.deepEqual(byId.dev.routes, ['提交测试'])
  assert.deepEqual(byId.test.routes, ['测试打回', '测试通过'])
  assert.equal(Object.hasOwn(byId.start, 'routes'), false)
  assert.equal(Object.hasOwn(byId.done, 'routes'), false)
  assert.equal(byId.done.status, 'completed')

  // 终止机器人节点没有出边：routes 是空数组。
  const terminal = {
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始', prompt: '做一件事。' }] },
      { id: 'dev', type: 'robot', robot: 'coder', output: { type: 'object', properties: {} } },
    ],
  }
  const terminalPlan = planOf(terminal)
  assert.deepEqual(terminalPlan.nodes.dev.next, [])
  const terminalNode = describePlan(terminalPlan).nodes.find((node) => node.id === 'dev')
  assert.deepEqual(terminalNode.routes, [])
})

test('format v2: warns about a cycle node without maxVisits, and only then', () => {
  const withWarning = validateDefinition(v2Definition())
  assert.equal(withWarning.ok, true, errorText(withWarning))
  assert.deepEqual(withWarning.warnings, [
    'node "dev" is part of a cycle and does not set maxVisits; the run is only bounded by maxSteps (12). Add maxVisits to stop a no-progress loop.',
  ])

  const bounded = v2Definition()
  bounded.nodes[1].maxVisits = 3
  assert.deepEqual(validateDefinition(bounded).warnings, [])

  // 不成环的定义（start -> dev -> done）不提醒 maxVisits。
  const acyclic = v2Definition()
  acyclic.nodes[1].next = [{ to: 'done', name: '完成' }]
  acyclic.nodes.splice(2, 1)
  const acyclicParsed = validateDefinition(acyclic)
  assert.equal(acyclicParsed.ok, true, errorText(acyclicParsed))
  assert.deepEqual(acyclicParsed.warnings, [])
})

test('routing: resolveRoute follows the JSON next route name', () => {
  const node = {
    next: [
      { to: 'publish', name: 'pass', prompt: '发布' },
      { to: 'fix', name: 'fix', prompt: '修复' },
      { to: 'done', name: 'give-up' },
    ],
  }
  assert.deepEqual(routing.resolveRoute(node, { next: 'fix' }), {
    rule: { to: 'fix', name: 'fix', prompt: '修复' },
  })
  assert.deepEqual(routing.resolveRoute(node, { next: ' give-up ' }), { rule: { to: 'done', name: 'give-up' } })
})

test('routing: resolveRoute reports missing, unknown and terminal routes', () => {
  const node = { next: [{ to: 'a', name: 'yes' }, { to: 'b', name: 'no' }] }

  const missing = routing.resolveRoute(node, {})
  assert.equal(missing.rule, undefined)
  assert.deepEqual(missing.routes, ['yes', 'no'])
  assert.match(missing.error, /no "next" route/u)

  const nonString = routing.resolveRoute(node, { next: 42 })
  assert.match(nonString.error, /no "next" route/u)

  const unknown = routing.resolveRoute(node, { next: 'maybe' })
  assert.deepEqual(unknown.routes, ['yes', 'no'])
  assert.match(unknown.error, /unknown route "maybe"/u)
  assert.deepEqual(unknown.routes, ['yes', 'no'])

  assert.deepEqual(routing.resolveRoute({ next: [] }, { next: 'yes' }), { rule: null })
  assert.deepEqual(routing.resolveRoute({}, { next: 'yes' }), { rule: null })
})

test('routing: exports resolveRoute and resolveAbort', () => {
  assert.deepEqual(Object.keys(routing).sort(), ['MAX_ABORT_REASON_LENGTH', 'resolveAbort', 'resolveRoute'])
})

test('run: renderNodePrompt renders the edge prompt with template values', () => {
  const prompt = renderNodePrompt(
    { id: 'dev' },
    '目标：{{goal}}；调研：{{nodes.collect.data.summary}}（第 {{step}} 步，运行 {{runId}}）',
    { collect: { data: { summary: '三点' } } },
    { goal: '写发布说明' },
    2,
    'wf-abc',
  )
  assert.equal(prompt, '目标：写发布说明；调研：三点（第 2 步，运行 wf-abc）')
})

test('run: renderNodePrompt appends the declared result contract', () => {
  const prompt = renderNodePrompt(
    {
      id: 'dev',
      output: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      next: [{ to: 'done', name: '完成' }],
    },
    '做一件事。',
    {},
    { goal: 'g' },
    1,
    'wf-contract',
  )
  assert.ok(prompt.startsWith('做一件事。\n\n---\nResult contract (added by the workflow):'))
  assert.match(prompt, /"summary"/)
  assert.match(prompt, /"next"/)
  assert.match(prompt, /"attachments"/)
  assert.match(prompt, /final assistant text/)
  assert.match(prompt, /not a place for the answer itself/)

  // 升级前的快照没有 output：prompt 保持原样。
  assert.equal(renderNodePrompt({ id: 'old' }, '做一件事。', {}, { goal: 'g' }, 1, 'wf-old'), '做一件事。')
})

test('run: renderNodePrompt requires an incoming edge prompt and never falls back to the node', () => {
  for (const edgePrompt of [null, undefined, '', '   ']) {
    assert.throws(
      () => renderNodePrompt({ id: 'dev', prompt: '节点 prompt' }, edgePrompt, {}, { goal: 'g' }, 1, 'wf-1'),
      (error) => error instanceof WorkflowRunError && /robot node "dev" has no prompt on its incoming edge/u.test(error.message),
    )
  }

  // 渲染结果为空也算没有 prompt。
  assert.throws(
    () =>
      renderNodePrompt({ id: 'dev' }, '{{nodes.dev.text}}', { dev: { text: '' } }, { goal: 'g' }, 1, 'wf-1'),
    /has no prompt on its incoming edge/u,
  )
})

test('run: toToolRun carries pendingInteraction and the existing run fields', () => {
  const interaction = { kind: 'question', nodeId: 'dev', visit: 1, seq: 1, robot: 'coder', askedAt: 123 }
  const run = {
    runId: 'wf-1',
    seq: 3,
    status: 'running',
    goal: '目标',
    createdAt: 1,
    finishedAt: null,
    current: { nodeId: 'dev' },
    pendingGate: null,
    pendingInteraction: interaction,
    sessions: [{ robot: 'coder', sessionId: 's-1' }],
    steps: [{ nodeId: 'dev', visit: 1 }],
    result: null,
    error: null,
  }
  const toolRun = toToolRun(run)
  assert.equal(toolRun.runId, 'wf-1')
  assert.equal(toolRun.seq, 3)
  assert.equal(toolRun.pendingInteraction, interaction)
  assert.deepEqual(toolRun.current, { nodeId: 'dev' })
  assert.equal(toolRun.pendingGate, null)
  assert.deepEqual(toolRun.sessions, [{ robot: 'coder', sessionId: 's-1' }])
  assert.deepEqual(toolRun.steps, [{ nodeId: 'dev', visit: 1 }])

  // 没有这个字段的旧记录返回 null，而不是 undefined。
  const legacy = toToolRun({ runId: 'wf-2', status: 'completed', steps: [] })
  assert.equal(legacy.pendingInteraction, null)
  assert.equal(legacy.pendingGate, null)
  assert.equal(legacy.seq, null)
})

test('run: the moved helpers keep their behavior', () => {
  assert.equal(mapApproval('allowed-once'), 'approved')
  assert.equal(mapApproval('rejected'), 'rejected')
  assert.equal(mapApproval('cancelled'), 'cancelled')
  assert.equal(mapApproval('anything-else'), 'unavailable')
  assert.equal(gateReason({ title: '发布确认', detail: '是否同意发布？' }), '工作流门禁「发布确认」正在等待授权：是否同意发布？')
  assert.equal(robotSessionTitle({ runId: 'wf-123' }, { robot: 'coder' }), '工作流 wf-123 · coder')
  assert.equal(SESSION_TITLE_MAX_BYTES, 80)
  assert.equal(clipUtf8('你好世界', 7), '你好')
  assert.ok(new WorkflowCancelledError('x') instanceof Error)
})
