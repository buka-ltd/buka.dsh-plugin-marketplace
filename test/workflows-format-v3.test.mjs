/**
 * workflow format 3 的单测：v3 定义校验、`next` 路由、用户介入节点与运行期纯函数。
 *
 * 全部使用内存数据，不启动 DSH、不读盘、不联网。覆盖 format 3 的契约：
 * 没有 `report` / `when` / 机器人节点 prompt；`gate` 被 `user` 节点取代；
 * 机器人交回的 JSON `next` 按边的 `name` 路由，用户的选项由出边 `label` 决定。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { describePlan, validateDefinition } from '../plugins/workflows/lib/definition.js'
import * as routing from '../plugins/workflows/lib/routing.js'
import {
  SESSION_TITLE_MAX_BYTES,
  WorkflowCancelledError,
  WorkflowRunError,
  answersValue,
  buildUserQuestions,
  clipUtf8,
  renderNodePrompt,
  renderUserDetail,
  resolveUserAnswer,
  robotSessionTitle,
  toToolRun,
} from '../plugins/workflows/lib/run.js'

/**
 * 一份最小的 format 3 定义：start -> dev <-> test -> done。
 *
 * dev 没有 maxVisits，所以在环上时会触发 warning；test 有 maxVisits。
 *
 * @returns {Record<string, any>}
 */
function v3Definition() {
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
 * 带用户介入节点的 format 3 定义。
 *
 * @returns {Record<string, any>}
 */
function userDefinition() {
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
        next: [{ to: 'review', name: '提交确认' }],
      },
      {
        id: 'review',
        type: 'user',
        title: '发布确认',
        detail: '请检查 {{nodes.dev.text}} 后选择。',
        next: [
          {
            to: 'publish',
            name: 'approve',
            label: '同意发布',
            description: '直接发布',
            prompt: '发布：{{nodes.dev.text}}；用户备注：{{nodes.review.answers.notes.custom}}',
          },
          { to: 'done', name: 'reject', label: '打回' },
        ],
        questions: [
          {
            id: 'notes',
            header: '备注',
            question: '还有什么要说明？',
            multiSelect: false,
            options: [{ label: '无' }, { label: '有', description: '在自定义输入里说明' }],
          },
        ],
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

test('format v3: report is rejected on every robot node', () => {
  for (const report of [true, false, null]) {
    const definition = v3Definition()
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

test('format v3: when is rejected on robot and user edges', () => {
  const robotEdge = v3Definition()
  robotEdge.nodes[1].next[0].when = { field: 'status', equals: 'ok' }
  const robotParsed = validateDefinition(robotEdge)
  assert.equal(robotParsed.ok, false)
  const robotError = robotParsed.errors.find((item) => item.path === 'nodes[1].next[0].when')
  assert.ok(robotError, errorText(robotParsed))
  assert.equal(robotError.message, 'when was removed; select the next edge with the JSON "next" route')

  const userEdge = userDefinition()
  userEdge.nodes[2].next[0].when = { field: 'status', equals: 'ok' }
  const userParsed = validateDefinition(userEdge)
  assert.equal(userParsed.ok, false)
  const userError = userParsed.errors.find((item) => item.path === 'nodes[2].next[0].when')
  assert.ok(userError, errorText(userParsed))
  assert.equal(userError.message, 'when was removed; select the next edge with the JSON "next" route')
})

test('format v3: robot next must be an edge array, not a string shorthand', () => {
  const definition = v3Definition()
  definition.nodes[1].next = 'test'
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, false)
  assert.match(errorText(parsed), /nodes\[1\]\.next: must be an array of edges .*string shorthand/)
})

test('format v3: every edge leaving a robot node needs a unique name', () => {
  const missing = v3Definition()
  delete missing.nodes[1].next[0].name
  const missingParsed = validateDefinition(missing)
  assert.equal(missingParsed.ok, false)
  const missingError = missingParsed.errors.find((item) => item.path === 'nodes[1].next[0].name')
  assert.ok(missingError, errorText(missingParsed))
  assert.match(missingError.message, /unique non-empty name/u)

  const blank = v3Definition()
  blank.nodes[1].next[0].name = '   '
  assert.equal(validateDefinition(blank).ok, false)

  const duplicate = v3Definition()
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

test('format v3: multiple edges to the same target are allowed with distinct names', () => {
  const definition = v3Definition()
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

test('format v3: edges accept an optional success / failure tone without affecting routing', () => {
  const definition = v3Definition()
  definition.nodes[0].next[0].tone = 'success'
  definition.nodes[2].next[0].tone = 'failure'
  definition.nodes[2].next[1].tone = 'success'
  const plan = planOf(definition)
  assert.equal(plan.nodes.start.next[0].tone, 'success', 'start edges accept a tone too')
  assert.equal(plan.nodes.test.next[0].tone, 'failure')
  assert.equal(plan.nodes.test.next[1].tone, 'success')
  // tone 只追加外观字段：路由 / 目标 / 名字都没有变化。
  assert.deepEqual(
    plan.nodes.test.next.map((edge) => [edge.to, edge.name]),
    [
      ['dev', '测试打回'],
      ['done', '测试通过'],
    ],
  )

  const user = userDefinition()
  user.nodes[2].next[0].tone = 'success'
  user.nodes[2].next[1].tone = 'failure'
  const userPlan = planOf(user)
  assert.deepEqual(
    userPlan.nodes.review.next.map((edge) => [edge.name, edge.tone]),
    [
      ['approve', 'success'],
      ['reject', 'failure'],
    ],
  )
  assert.equal(userPlan.nodes.review.next[0].label, '同意发布', 'tone does not touch the user-facing label')
})

test('format v3: an edge tone must be "success" or "failure"', () => {
  for (const tone of ['green', '', 'SUCCESS', 42, true]) {
    const definition = v3Definition()
    definition.nodes[2].next[0].tone = tone
    const parsed = validateDefinition(definition)
    assert.equal(parsed.ok, false, `tone ${JSON.stringify(tone)} is rejected`)
    const error = parsed.errors.find((item) => item.path === 'nodes[2].next[0].tone')
    assert.ok(error, errorText(parsed))
    assert.equal(error.message, 'must be "success" or "failure"')
  }
  // null 与省略等价：表示没有设置外观色。
  const unset = v3Definition()
  unset.nodes[2].next[0].tone = null
  assert.equal(validateDefinition(unset).ok, true)
})

test('format v3: edges entering a robot need a prompt; edges into user/end must not', () => {
  const missingPrompt = v3Definition()
  delete missingPrompt.nodes[1].next[0].prompt
  const missingParsed = validateDefinition(missingPrompt)
  assert.equal(missingParsed.ok, false)
  assert.match(
    errorText(missingParsed),
    /nodes\[1\]\.next\[0\]\.prompt: an edge entering a robot node must carry its prompt/u,
  )

  const promptToEnd = v3Definition()
  promptToEnd.nodes[2].next[1].prompt = '终止节点不执行，不需要 prompt'
  const promptParsed = validateDefinition(promptToEnd)
  assert.equal(promptParsed.ok, false)
  assert.match(
    errorText(promptParsed),
    /nodes\[2\]\.next\[1\]\.prompt: an edge prompt is only supported when the edge enters a robot node/u,
  )

  const promptToUser = userDefinition()
  promptToUser.nodes[1].next[0].prompt = '用户节点不跑会话'
  const userParsed = validateDefinition(promptToUser)
  assert.equal(userParsed.ok, false)
  assert.match(userParsed.errors.map((error) => error.path).join('\n'), /nodes\[1\]\.next\[0\]\.prompt/u)
})

test('format v3: robot nodes do not carry a prompt and the start node is required', () => {
  const legacyPrompt = v3Definition()
  legacyPrompt.nodes[1].prompt = '旧格式的节点 prompt'
  const promptParsed = validateDefinition(legacyPrompt)
  assert.equal(promptParsed.ok, false)
  assert.match(
    errorText(promptParsed),
    /nodes\[1\]\.prompt: robot nodes no longer carry a prompt; define it on the edge entering this node/u,
  )

  const noStart = v3Definition()
  noStart.nodes.shift()
  const noStartParsed = validateDefinition(noStart)
  assert.equal(noStartParsed.ok, false)
  assert.match(errorText(noStartParsed), /start: a workflow definition needs exactly one node with type "start"/u)

  const legacyTopLevelStart = v3Definition()
  legacyTopLevelStart.start = 'dev'
  const legacyParsed = validateDefinition(legacyTopLevelStart)
  assert.equal(legacyParsed.ok, false)
  assert.match(errorText(legacyParsed), /the legacy top-level "start" format was removed/u)
})

test('format v3: start / user / end parsing', () => {
  const plan = planOf(userDefinition())
  assert.equal(plan.start, 'start')
  assert.deepEqual(plan.order, ['start', 'dev', 'review', 'publish', 'done'])
  assert.deepEqual(plan.nodes.start.next, [{ to: 'dev', name: '开始', prompt: '写发布说明。' }])
  assert.equal(plan.nodes.review.title, '发布确认')
  assert.deepEqual(plan.nodes.review.next, [
    {
      to: 'publish',
      name: 'approve',
      label: '同意发布',
      description: '直接发布',
      prompt: '发布：{{nodes.dev.text}}；用户备注：{{nodes.review.answers.notes.custom}}',
    },
    { to: 'done', name: 'reject', label: '打回' },
  ])
  assert.deepEqual(plan.nodes.review.questions, [
    {
      id: 'notes',
      header: '备注',
      question: '还有什么要说明？',
      multiSelect: false,
      options: [{ label: '无' }, { label: '有', description: '在自定义输入里说明' }],
    },
  ])
  assert.equal(plan.nodes.done.status, 'completed')
  // format 3 的机器人节点没有 prompt / report 字段。
  assert.equal(Object.hasOwn(plan.nodes.dev, 'prompt'), false)
  assert.equal(Object.hasOwn(plan.nodes.dev, 'report'), false)
  assert.equal(Object.hasOwn(plan.nodes.dev, 'summary'), true)
})

test('format v3: gate is rejected with a migration error', () => {
  const definition = userDefinition()
  definition.nodes[2] = {
    id: 'review',
    type: 'gate',
    title: '发布确认',
    onApprove: { to: 'publish', prompt: '发布' },
    onReject: 'done',
  }
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, false)
  const error = parsed.errors.find((item) => item.path === 'nodes[2].type')
  assert.ok(error, errorText(parsed))
  assert.match(error.message, /gate was replaced by the user node in workflow format 3/u)
})

test('format v3: user node validation', () => {
  const missingTitle = userDefinition()
  delete missingTitle.nodes[2].title
  assert.match(errorText(validateDefinition(missingTitle)), /nodes\[2\]\.title: must be a non-empty title/u)

  const missingLabel = userDefinition()
  delete missingLabel.nodes[2].next[0].label
  assert.match(errorText(validateDefinition(missingLabel)), /nodes\[2\]\.next\[0\]\.label: .*non-empty label/u)

  const duplicateLabel = userDefinition()
  duplicateLabel.nodes[2].next[1].label = '同意发布'
  assert.match(errorText(validateDefinition(duplicateLabel)), /nodes\[2\]\.next\[1\]\.label: duplicate option label/u)

  const legacyApprove = userDefinition()
  legacyApprove.nodes[2].onApprove = { to: 'publish', prompt: '发布' }
  assert.match(
    errorText(validateDefinition(legacyApprove)),
    /onApprove \/ onReject were removed in workflow format 3/u,
  )

  const nothing = userDefinition()
  nothing.nodes[2].next = []
  delete nothing.nodes[2].questions
  assert.match(errorText(validateDefinition(nothing)), /needs at least one outgoing edge .* or one extra question/u)

  const withOutput = userDefinition()
  withOutput.nodes[2].output = { type: 'object', properties: {} }
  assert.match(errorText(validateDefinition(withOutput)), /output.*only supported on robot nodes/u)

  const tooManyQuestions = userDefinition()
  tooManyQuestions.nodes[2].questions = [1, 2, 3, 4, 5].map((index) => ({
    id: `q${index}`,
    question: `问题 ${index}`,
  }))
  assert.match(errorText(validateDefinition(tooManyQuestions)), /at most 4 questions/u)

  const badQuestion = userDefinition()
  badQuestion.nodes[2].questions = [{ id: 'route', question: '重复 id' }]
  assert.match(errorText(validateDefinition(badQuestion)), /duplicate question id "route"/u)

  const noQuestionText = userDefinition()
  noQuestionText.nodes[2].questions = [{ id: 'notes' }]
  assert.match(errorText(validateDefinition(noQuestionText)), /nodes\[2\]\.questions\[0\]\.question: must be a non-empty question/u)
})

test('format v3: user detail templates are validated', () => {
  const unknownNode = userDefinition()
  unknownNode.nodes[2].detail = '检查 {{nodes.nope.text}}'
  assert.match(errorText(validateDefinition(unknownNode)), /references unknown node "nope"/u)

  const badAnswer = userDefinition()
  badAnswer.nodes[2].detail = '检查 {{nodes.review.answers.missing.custom}}'
  assert.match(errorText(validateDefinition(badAnswer)), /unknown question id "missing"/u)

  const badRobotField = userDefinition()
  badRobotField.nodes[2].detail = '检查 {{nodes.dev.answers.notes.custom}}'
  assert.match(errorText(validateDefinition(badRobotField)), /only user nodes provide/u)

  const badDataPath = userDefinition()
  badDataPath.nodes[1].output = {
    type: 'object',
    properties: { summary: { type: 'string' } },
    additionalProperties: true,
  }
  badDataPath.nodes[2].detail = '检查 {{nodes.dev.data.missing}}'
  assert.match(errorText(validateDefinition(badDataPath)), /undeclared|not declared|missing/u)
})

test('format v3: describePlan exposes user title, route labels and question ids', () => {
  const plan = planOf(userDefinition())
  const described = describePlan(plan)
  const byId = Object.fromEntries(described.nodes.map((node) => [node.id, node]))
  assert.deepEqual(byId.dev.routes, ['提交确认'])
  assert.equal(byId.review.title, '发布确认')
  assert.deepEqual(byId.review.routes, [
    { name: 'approve', label: '同意发布' },
    { name: 'reject', label: '打回' },
  ])
  assert.deepEqual(byId.review.questions, ['notes'])
  assert.equal(Object.hasOwn(byId.start, 'routes'), false)
  assert.equal(Object.hasOwn(byId.done, 'routes'), false)
  assert.equal(byId.done.status, 'completed')
})

test('format v3: warns about a cycle node without maxVisits, and only then', () => {
  const withWarning = validateDefinition(v3Definition())
  assert.equal(withWarning.ok, true, errorText(withWarning))
  assert.deepEqual(withWarning.warnings, [
    'node "dev" is part of a cycle and does not set maxVisits; the run is only bounded by maxSteps (12). Add maxVisits to stop a no-progress loop.',
  ])

  const bounded = v3Definition()
  bounded.nodes[1].maxVisits = 3
  assert.deepEqual(validateDefinition(bounded).warnings, [])

  // 不成环的定义（start -> dev -> done）不提醒 maxVisits。
  const acyclic = v3Definition()
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
  assert.deepEqual(Object.keys(routing).sort(), ['MAX_ABORT_REASON_LENGTH', 'resolveAbort', 'resolveRoute', 'resolveRoutes'])
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

test('run: renderUserDetail renders the detail template', () => {
  const detail = renderUserDetail(
    { id: 'review', title: '确认', detail: '请检查 {{nodes.dev.text}}（第 {{step}} 步）' },
    { dev: { text: '草稿' } },
    { goal: 'g' },
    3,
    'wf-1',
  )
  assert.equal(detail, '请检查 草稿（第 3 步）')
  assert.equal(renderUserDetail({ id: 'review', title: '确认', detail: '' }, {}, { goal: 'g' }, 1, 'wf-1'), '')
})

test('run: buildUserQuestions turns edges into the route question and appends extra questions', () => {
  const node = planOf(userDefinition()).nodes.review
  const questions = buildUserQuestions(node, '请检查草稿后选择。')
  assert.deepEqual(questions, [
    {
      id: 'route',
      header: '发布确认',
      question: '请检查草稿后选择。',
      options: [
        { label: '同意发布', description: '直接发布' },
        { label: '打回' },
      ],
    },
    {
      id: 'notes',
      header: '备注',
      question: '还有什么要说明？',
      options: [{ label: '无' }, { label: '有', description: '在自定义输入里说明' }],
    },
  ])

  // 只有 questions、没有出边时没有 route 问题。
  const noEdges = { ...node, next: [] }
  const onlyQuestions = buildUserQuestions(noEdges, '')
  assert.deepEqual(onlyQuestions.map((question) => question.id), ['notes'])
  assert.equal(onlyQuestions[0].question, '还有什么要说明？')
})

test('run: resolveUserAnswer maps the chosen label to the edge and normalizes answers', () => {
  const node = planOf(userDefinition()).nodes.review
  const resolved = resolveUserAnswer(node, {
    answers: [
      { id: 'route', selected: ['同意发布'] },
      { id: 'notes', selected: ['有'], custom: '记得更新 changelog' },
    ],
  })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.cancelled, false)
  assert.equal(resolved.route.name, 'approve')
  assert.equal(resolved.route.to, 'publish')
  assert.deepEqual(resolved.answers, [
    { id: 'route', selected: ['同意发布'], custom: '' },
    { id: 'notes', selected: ['有'], custom: '记得更新 changelog' },
  ])
  assert.equal(resolved.text, '选择：同意发布\n备注：有（记得更新 changelog）')

  // 用户跳过选择（只填自定义文本）→ cancelled，不再路由。
  const skipped = resolveUserAnswer(node, {
    answers: [{ id: 'route', selected: [], custom: '我再想想' }, { id: 'notes', selected: [], custom: '稍后' }],
  })
  assert.equal(skipped.ok, true)
  assert.equal(skipped.cancelled, true)
  assert.equal(skipped.route, null)
  assert.equal(skipped.text, '')

  // 未知 label → 失败。
  const unknown = resolveUserAnswer(node, { answers: [{ id: 'route', selected: ['不存在'] }] })
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /unknown choice "不存在"/u)

  // 没有 route 答案也算没有选择。
  const missing = resolveUserAnswer(node, { answers: [] })
  assert.equal(missing.cancelled, true)

  // 只有 questions 的节点：没有 route，答案照常记录。
  const terminal = { ...node, next: [] }
  const onlyQuestions = resolveUserAnswer(terminal, {
    answers: [{ id: 'notes', selected: [], custom: '没问题' }],
  })
  assert.equal(onlyQuestions.route, null)
  assert.equal(onlyQuestions.cancelled, false)
  assert.equal(onlyQuestions.text, '备注：（没问题）')
})

test('run: answersValue indexes normalized answers by question id', () => {
  assert.deepEqual(
    answersValue([
      { id: 'route', selected: ['打回'], custom: '' },
      { id: 'notes', selected: [], custom: '缺测试' },
    ]),
    {
      route: { selected: ['打回'], custom: '' },
      notes: { selected: [], custom: '缺测试' },
    },
  )
})

test('run: toToolRun carries pendingUser, pendingInteraction and the existing run fields', () => {
  const interaction = { kind: 'question', nodeId: 'dev', visit: 1, seq: 1, robot: 'coder', askedAt: 123 }
  const pendingUser = { nodeId: 'review', title: '发布确认', options: [], questions: [] }
  const run = {
    runId: 'wf-1',
    seq: 3,
    status: 'waiting',
    goal: '目标',
    createdAt: 1,
    finishedAt: null,
    current: { nodeId: 'review' },
    pendingUser,
    pendingInteraction: interaction,
    sessions: [{ robot: 'coder', sessionId: 's-1' }],
    steps: [{ nodeId: 'dev', visit: 1 }],
    result: null,
    error: null,
  }
  const toolRun = toToolRun(run)
  assert.equal(toolRun.runId, 'wf-1')
  assert.equal(toolRun.seq, 3)
  assert.equal(toolRun.pendingUser, pendingUser)
  assert.equal(toolRun.pendingInteraction, interaction)
  assert.deepEqual(toolRun.current, { nodeId: 'review' })
  assert.deepEqual(toolRun.sessions, [{ robot: 'coder', sessionId: 's-1' }])
  assert.deepEqual(toolRun.steps, [{ nodeId: 'dev', visit: 1 }])

  // 没有这些字段的旧记录返回 null，而不是 undefined。
  const legacy = toToolRun({ runId: 'wf-2', status: 'completed', steps: [] })
  assert.equal(legacy.pendingUser, null)
  assert.equal(legacy.pendingInteraction, null)
  assert.equal(legacy.seq, null)
})

test('run: session title and text helpers keep their behavior', () => {
  assert.equal(robotSessionTitle({ runId: 'wf-123' }, { robot: 'coder' }), '工作流 wf-123 · coder')
  assert.equal(SESSION_TITLE_MAX_BYTES, 80)
  assert.equal(clipUtf8('你好世界', 7), '你好')
  assert.ok(new WorkflowCancelledError('x') instanceof Error)
})

test('format v3: join node collects started inputs and must be well-formed', () => {
  const definition = {
    goal: '并行',
    maxSteps: 20,
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'plan', name: '开始', prompt: '规划。' }] },
      {
        id: 'plan',
        type: 'robot',
        robot: 'coder',
        output: { type: 'object', properties: {} },
        next: [
          { to: 't1', name: 'a', prompt: '任务一。' },
          { to: 't2', name: 'b', prompt: '任务二。' },
        ],
      },
      { id: 't1', type: 'robot', robot: 'coder', output: { type: 'object', properties: {} } },
      { id: 't2', type: 'robot', robot: 'coder', output: { type: 'object', properties: {} } },
      { id: 'merge', type: 'join', inputs: ['t1', 't2'], next: [{ to: 'done' }] },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const plan = planOf(definition)
  assert.equal(plan.nodes.merge.type, 'join')
  assert.deepEqual(plan.nodes.merge.inputs, ['t1', 't2'])

  // inputs 必须引用机器人节点。
  const badInput = structuredClone(definition)
  badInput.nodes[4].inputs = ['done']
  assert.match(errorText(validateDefinition(badInput)), /a join can only wait for robot nodes/u)

  // inputs 必须非空。
  const emptyInput = structuredClone(definition)
  emptyInput.nodes[4].inputs = []
  assert.match(errorText(validateDefinition(emptyInput)), /non-empty array of node ids/u)

  // 出边必须恰好一条。
  const twoEdges = structuredClone(definition)
  twoEdges.nodes[4].next = [{ to: 'done' }, { to: 'done' }]
  assert.match(errorText(validateDefinition(twoEdges)), /exactly one outgoing edge/u)

  // 普通出边不能指向 join（join 由 inputs 收集）。
  const edgeToJoin = structuredClone(definition)
  edgeToJoin.nodes[1].next[0] = { to: 'merge', name: 'a', prompt: '任务一。' }
  assert.match(errorText(validateDefinition(edgeToJoin)), /an edge cannot point at a join node/u)

  // join 提供不了任何输出，模板不能引用它。
  const refJoin = structuredClone(definition)
  refJoin.nodes[1].next[0].prompt = '读 {{nodes.merge.text}}'
  assert.match(errorText(validateDefinition(refJoin)), /provides no output/u)
})

test('format v3: robot nodes accept mode "plan" and describePlan exposes it', () => {
  const definition = v3Definition()
  definition.nodes[1].mode = 'plan'
  const parsed = validateDefinition(definition)
  assert.equal(parsed.ok, true, errorText(parsed))
  assert.equal(parsed.plan.nodes.dev.mode, 'plan')
  const dev = describePlan(parsed.plan).nodes.find((node) => node.id === 'dev')
  assert.equal(dev.mode, 'plan')

  // 未设置 mode 的节点保持原样，摘要里不出现 mode。
  const plain = describePlan(planOf(v3Definition())).nodes.find((node) => node.id === 'dev')
  assert.equal('mode' in plain, false)
})

test('format v3: goal mode and unknown modes are rejected', () => {
  const goal = v3Definition()
  goal.nodes[1].mode = 'goal'
  assert.match(errorText(validateDefinition(goal)), /nodes\[1\]\.mode: mode "goal" is not supported yet/u)

  const unknown = v3Definition()
  unknown.nodes[1].mode = 'fast'
  assert.match(errorText(validateDefinition(unknown)), /nodes\[1\]\.mode: must be "plan"/u)
})

test('format v3: mode is rejected on non-robot nodes', () => {
  const start = v3Definition()
  start.nodes[0].mode = 'plan'
  assert.match(errorText(validateDefinition(start)), /nodes\[0\]\.mode: is only supported on robot nodes/u)

  const user = userDefinition()
  user.nodes[2].mode = 'plan'
  assert.match(errorText(validateDefinition(user)), /nodes\[2\]\.mode: is only supported on robot nodes/u)

  const end = v3Definition()
  end.nodes[3].mode = 'plan'
  assert.match(errorText(validateDefinition(end)), /nodes\[3\]\.mode: is only supported on robot nodes/u)
})
