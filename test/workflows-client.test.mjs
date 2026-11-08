/**
 * @buka/dsh-plugin-workflows 浏览器一半的渲染冒烟测试。
 *
 * 页面模块不能直接 import（顶层依赖 `window.__ModuleLoader__`），这里用最小的
 * React 桩与假的模块加载器把工厂跑起来，再直接调用注册到 `main` 的页面组件，
 * 检查节点图、图例、节点详情与时间线是否按图模型渲染出来。它不是浏览器测试，
 * 但能在不启动 DSH 的情况下抓到渲染函数里的运行时错误。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { validateDefinition } from '../plugins/workflows/lib/definition.js'
import { buildRunGraph, layoutRunGraph } from '../plugins/workflows/lib/graph.js'

const CLIENT_PATH = path.resolve('plugins/workflows/client.js')

/** 每次载入换一个 URL，绕过 ESM 的模块缓存。 */
let loadSequence = 0

/**
 * 元素节点：和 React 元素一样只记录 type / props / children。
 *
 * @param {any} type
 * @param {Record<string, any> | null} props
 * @param {...any} children
 * @returns {Record<string, any>}
 */
function h(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat(Infinity) }
}

/**
 * 走一遍渲染树。
 *
 * @param {any} node
 * @param {(node: Record<string, any>) => void} visit
 */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/**
 * 收集渲染树里的类名、文本、标签名与连线路径。
 *
 * @param {any} tree
 * @returns {{ classes: string[], classLists: string[][], texts: string[], tags: Set<string>, paths: string[] }}
 */
function collect(tree) {
  const classes = []
  const classLists = []
  const texts = []
  const tags = new Set()
  const paths = []
  walk(tree, (node) => {
    tags.add(node.type)
    const className = node.props?.className
    if (typeof className === 'string') {
      const list = className.split(/\s+/).filter(Boolean)
      classes.push(...list)
      classLists.push(list)
    }
    if (typeof node.props?.d === 'string') paths.push(node.props.d)
    for (const child of node.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') texts.push(String(child))
    }
  })
  return { classes, classLists, texts, tags, paths }
}

/**
 * 找到第一个带指定类名的元素。
 *
 * @param {any} tree
 * @param {string} className
 * @returns {Record<string, any> | null}
 */
function findByClass(tree, className) {
  let found = null
  walk(tree, (node) => {
    if (found !== null) return
    const value = node.props?.className
    if (typeof value === 'string' && value.split(/\s+/).includes(className)) found = node
  })
  return found
}

/**
 * 载入客户端模块，返回注册到 `main` 的页面组件与它注入的样式文本。
 *
 * @returns {Promise<{ Page: Function, apply: Function, css: () => string }>}
 */
async function loadClient() {
  /** @type {Array<any>} */
  const stateQueue = []
  /** @type {Array<any>} 每个 setState 收到的值，用来检查交互回调算出的位置。 */
  const stateUpdates = []
  let stateIndex = 0
  const React = {
    createElement: h,
    useState(initial) {
      const value = stateIndex < stateQueue.length ? stateQueue[stateIndex] : initial
      stateIndex += 1
      return [
        value,
        (next) => {
          stateUpdates.push(next)
        },
      ]
    },
    useEffect() {},
  }
  const primitives = new Proxy(
    {},
    {
      get: () =>
        function PrimitiveStub() {
          return null
        },
    },
  )
  const requireStub = (name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`client required an unexpected module: ${name}`)
  }

  /** @type {Record<string, Function>} */
  const components = {}
  let clientModule = null
  let css = ''
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        clientModule = factory(requireStub)
      },
    },
  }
  globalThis.document = {
    createElement() {
      return {
        dataset: {},
        remove() {},
        set textContent(value) {
          css = String(value)
        },
        get textContent() {
          return css
        },
      }
    },
    head: { appendChild() {} },
  }
  try {
    const url = `${pathToFileURL(CLIENT_PATH).href}?smoke=${(loadSequence += 1)}`
    await import(url)
    assert.ok(clientModule, 'client module should register through window.__ModuleLoader__')
    clientModule.apply({
      effect(fn) {
        fn()
      },
      locale: { bind: () => (key) => key, register: () => () => {} },
      slots: {
        inject(_name, fn) {
          fn()
        },
        register(options, component) {
          components[options.name === 'main' ? 'page' : 'icon'] = component
          return () => {}
        },
      },
    })
    assert.equal(typeof components.page, 'function', 'client should register a main page component')
    return {
      Page: components.page,
      css: () => css,
      /**
       * 用预设的 state 顺序渲染一次页面。
       *
       * @param {Array<any>} states
       * @returns {any}
       */
      render(states) {
        stateQueue.length = 0
        stateQueue.push(...states)
        stateIndex = 0
        stateUpdates.length = 0
        return components.page({ t: (key) => key, getService: () => null })
      },
      updates: () => stateUpdates,
    }
  } finally {
    delete globalThis.window
    delete globalThis.document
  }
}

/**
 * 一次门禁 + 两个机器人分支的运行。
 *
 * @returns {{ run: Record<string, any>, definition: Record<string, any>, graph: Record<string, any>, nodeResults: Array<Record<string, any>> }}
 */
function fixture() {
  const raw = {
    goal: '为 v1.2 写发布说明并发布',
    start: 'gate',
    nodes: [
      { id: 'gate', type: 'gate', title: '发布确认', detail: '是否同意发布？', onApprove: 'publish', onReject: 'revise' },
      { id: 'publish', type: 'robot', robot: 'publisher', summary: '发布 v1.2 的说明', prompt: '执行发布', report: true, next: 'done' },
      { id: 'revise', type: 'robot', robot: 'writer', prompt: '修改发布说明', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const parsed = validateDefinition(raw)
  assert.equal(parsed.ok, true)
  const definition = { plan: parsed.plan, definition: raw }
  const run = {
    runId: 'wf-render-smoke',
    goal: raw.goal,
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    steps: [
      { seq: 1, nodeId: 'gate', type: 'gate', status: 'approved', decision: 'approved', startedAt: 1, finishedAt: 2 },
      {
        seq: 2,
        nodeId: 'publish',
        type: 'robot',
        robot: 'publisher',
        status: 'completed',
        stopReason: 'completed',
        startedAt: 3,
        finishedAt: 13,
        sessionId: 'session-1',
        text: 'published the release',
        data: { ok: true },
      },
    ],
    result: { status: 'completed', lastNode: 'done' },
  }
  const model = buildRunGraph({ run, definition })
  assert.ok(model)
  const graph = { ...model, ...layoutRunGraph(model) }
  return {
    run,
    definition,
    graph,
    nodeResults: [
      {
        seq: 2,
        nodeId: 'publish',
        sessionId: 'session-1',
        stopReason: 'completed',
        prompt: '执行发布（渲染后）',
        text: 'published the release',
        structured: { ok: true },
      },
    ],
  }
}

/**
 * 找到胶囊按钮：带 `buka-workflows-capsule` 类名、直接文本等于给定值。
 *
 * @param {any} tree
 * @param {string} label
 * @returns {Record<string, any> | null}
 */
function findCapsule(tree, label) {
  let found = null
  walk(tree, (node) => {
    if (found !== null) return
    const className = node.props?.className
    if (typeof className !== 'string' || !className.split(/\s+/).includes('buka-workflows-capsule')) return
    if ((node.children ?? []).some((child) => child === label)) found = node
  })
  return found
}

/**
 * 一次带循环的运行：check 失败两次、修复两次、第三次通过，另有一个没走到的审计节点。
 *
 * @returns {{ run: Record<string, any>, definition: Record<string, any>, graph: Record<string, any>, nodeResults: Array<Record<string, any>> }}
 */
function loopFixture() {
  const raw = {
    goal: '反复修改直到检查通过',
    start: 'check',
    maxSteps: 12,
    nodes: [
      {
        id: 'check',
        type: 'robot',
        robot: 'reviewer',
        prompt: '检查当前稿：{{goal}}',
        report: true,
        maxVisits: 5,
        next: [
          { when: { field: 'ok', equals: true }, to: 'done', name: '检查通过' },
          { when: { field: 'ok', equals: 'audit' }, to: 'skip', name: '转人工审计' },
          { to: 'fix', name: '发现问题' },
        ],
      },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修复检查发现的问题', next: 'check' },
      { id: 'skip', type: 'robot', robot: 'auditor', prompt: '补充审计', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const parsed = validateDefinition(raw)
  assert.equal(parsed.ok, true)
  const definition = { plan: parsed.plan, definition: raw }
  /** @type {Array<Record<string, any>>} */
  const steps = []
  /** @type {Map<string, number>} */
  const visits = new Map()
  /**
   * @param {string} nodeId
   * @param {string} robot
   * @param {string} text
   * @param {Record<string, any>} data
   */
  function push(nodeId, robot, text, data) {
    const visit = (visits.get(nodeId) ?? 0) + 1
    visits.set(nodeId, visit)
    const seq = steps.length + 1
    steps.push({
      seq,
      nodeId,
      visit,
      type: 'robot',
      robot,
      status: 'completed',
      stopReason: 'completed',
      startedAt: seq * 10,
      finishedAt: seq * 10 + 5,
      sessionId: `session-${seq}`,
      text,
      data,
    })
  }
  push('check', 'reviewer', '发现 2 个问题', { ok: false })
  push('fix', 'fixer', '已修 1 处', {})
  push('check', 'reviewer', '发现 1 个问题', { ok: false })
  push('fix', 'fixer', '已修 2 处', {})
  push('check', 'reviewer', '检查通过', { ok: true })
  const run = {
    runId: 'wf-render-loop',
    goal: raw.goal,
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    steps,
    result: { status: 'completed', lastNode: 'done' },
  }
  const model = buildRunGraph({ run, definition })
  assert.ok(model)
  const graph = { ...model, ...layoutRunGraph(model) }
  const nodeResults = steps.map((step) => ({
    seq: step.seq,
    nodeId: step.nodeId,
    sessionId: step.sessionId,
    stopReason: step.stopReason,
    prompt: `rendered prompt for ${step.nodeId} #${step.visit}`,
    text: step.text,
    structured: step.data,
  }))
  return { run, definition, graph, nodeResults }
}

/**
 * 新格式的运行：start 节点 + 同一个 dev 节点被 start 边和测试打回边两次进入。
 *
 * @returns {{ run: Record<string, any>, definition: Record<string, any>, graph: Record<string, any>, nodeResults: Array<Record<string, any>> }}
 */
function startFixture() {
  const raw = {
    goal: '开发—测试循环',
    maxSteps: 12,
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始开发', prompt: '按需求实现导出功能。' }] },
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
          { when: { field: 'passed', equals: false }, to: 'dev', name: '测试打回', prompt: '测试打回：{{nodes.test.text}}' },
          { to: 'done', name: '测试通过' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const parsed = validateDefinition(raw)
  assert.equal(parsed.ok, true)
  const definition = { plan: parsed.plan, definition: raw }
  const texts = ['初版完成', '发现 2 个问题', '修复完成', '复查通过']
  const steps = [
    { seq: 1, nodeId: 'dev', visit: 1, text: texts[0], data: null },
    { seq: 2, nodeId: 'test', visit: 1, text: texts[1], data: { passed: false } },
    { seq: 3, nodeId: 'dev', visit: 2, text: texts[2], data: null },
    { seq: 4, nodeId: 'test', visit: 2, text: texts[3], data: { passed: true } },
  ].map((step, index) => ({
    ...step,
    type: 'robot',
    robot: step.nodeId === 'dev' ? 'coder' : 'tester',
    status: 'completed',
    stopReason: 'completed',
    startedAt: index * 10 + 1,
    finishedAt: index * 10 + 5,
    sessionId: `session-${index + 1}`,
  }))
  const run = {
    runId: 'wf-render-start',
    goal: raw.goal,
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    steps,
    result: { status: 'completed', lastNode: 'done' },
  }
  const model = buildRunGraph({ run, definition })
  assert.ok(model)
  const graph = { ...model, ...layoutRunGraph(model) }
  const prompts = [
    '按需求实现导出功能。',
    '检查开发结果：初版完成',
    '测试打回：发现 2 个问题',
    '检查开发结果：修复完成',
  ]
  const nodeResults = steps.map((step, index) => ({
    seq: step.seq,
    nodeId: step.nodeId,
    sessionId: step.sessionId,
    stopReason: step.stopReason,
    prompt: prompts[index],
    text: step.text,
    structured: step.data,
  }))
  return { run, definition, graph, nodeResults }
}

/**
 * 渲染详情页的 preset state：列表、选中的 run、详情、tick、toast、选中的节点。
 *
 * @param {{ run: Record<string, any>, definition: Record<string, any>, graph: Record<string, any>, nodeResults: Array<Record<string, any>> }} data
 * @param {string | null} selectedNodeId
 * @param {number | null} [executionIndex] 要打开的那次执行（不传就回到最近一次）
 * @returns {Array<any>}
 */
function detailStates(data, selectedNodeId, executionIndex = null) {
  return [
    { status: 'ready', runs: [], error: null },
    data.run.runId,
    {
      status: 'ready',
      data: { run: data.run, definition: data.definition, nodeResults: data.nodeResults, graph: data.graph },
      error: null,
    },
    0,
    null,
    selectedNodeId,
    executionIndex,
  ]
}

test('client: the vertical graph renders capsules, rails, dots and the legend', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'publish'))
  const { classes, classLists, texts, tags, paths } = collect(tree)

  assert.ok(classes.includes('buka-workflows-split'))
  assert.equal(classes.filter((name) => name === 'buka-workflows-capsule').length, data.graph.nodes.length)
  assert.equal(classes.filter((name) => name === 'buka-workflows-vgraphDot').length, data.graph.nodes.length)
  assert.equal(classes.filter((name) => name === 'buka-workflows-edge').length, data.graph.edges.length)
  const traversedEdges = classLists.filter(
    (list) => list.includes('buka-workflows-edge') && list.includes('is-traversed'),
  )
  assert.equal(traversedEdges.length, 2, 'approved path is traversed')
  const footer = findByClass(tree, 'buka-workflows-footer')
  assert.ok(footer, 'the legend lives in the footer')
  assert.ok(collect(footer).classes.includes('buka-workflows-legend'))
  assert.equal(
    collect(footer).classes.includes('buka-workflows-hint'),
    false,
    'the footer has no explanatory copy below the legend',
  )
  const graphPane = findByClass(tree, 'buka-workflows-graphPane')
  assert.ok(graphPane, 'the graph lives in its own content-sized column')
  assert.ok(!collect(graphPane).classes.includes('buka-workflows-legend'))
  assert.ok(tags.has('circle'))
  assert.ok(paths.length >= data.graph.edges.length)
  // 胶囊只显示名字：机器人名、门禁标题、终止节点 id；没有 R/G/E 角标。
  assert.ok(texts.includes('publisher'))
  assert.ok(texts.includes('writer'))
  assert.ok(texts.includes('发布确认'))
  assert.ok(texts.includes('done'))
  for (const letter of ['R', 'G', 'E']) assert.ok(!texts.includes(letter), `no ${letter} badge`)
  // 右侧默认展示最近执行过的节点，即 publish 的交付物。
  assert.ok(classes.includes('buka-workflows-inspector'))
  assert.ok(texts.includes('published the release'))
  assert.ok(texts.includes('executionOutput'), 'the deliverable lives in the execution tab')
  assert.ok(texts.includes('executionInput'))
  assert.ok(texts.includes('执行发布（渲染后）'), 'the tab shows the rendered prompt of that execution')
  // 步骤概要就是节点标题，节点 id 只是标题旁边的代码小标签。
  const title = findByClass(tree, 'buka-workflows-inspectorTitle')
  assert.ok(title, 'the inspector has a title')
  assert.ok(collect(title).texts.includes('发布 v1.2 的说明'), 'the step summary is the node title')
  assert.equal(
    collect(title).texts.includes('publish'),
    false,
    'the node id is not used as the title',
  )
  assert.ok(findCapsule(tree, '发布 v1.2 的说明'), 'the capsule shows the creator-written step summary')
  assert.ok(texts.includes('publish'), 'the node id stays visible as a small code label')
  assert.ok(texts.includes('nodeExecutor'), 'the executor is labelled')
  // 节点详情不再解释「结构化结果」这类实现细节。
  assert.equal(texts.includes('nodeReport'), false, 'no structured-result meta row')
  assert.equal(texts.includes('nodeReportHint'), false, 'no structured-result explanation')
  // 出口已经画在图上，详情里不再重复一份出口说明。
  assert.equal(texts.includes('nodeTransitions'), false, 'the graph is the only place that shows exits')
  // 详情页只展示图，没有列表卡片与旧的时间线页签。
  assert.ok(!classes.includes('buka-workflows-card'))
  assert.ok(!classes.includes('buka-workflows-timeline'))
})

test('client: clicking a capsule switches the right-hand panel', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'revise'))
  const { classes, texts } = collect(tree)

  assert.ok(classes.includes('buka-workflows-inspector'))
  assert.ok(texts.includes('revise'))
  assert.ok(texts.includes('nodePrompt'))
  assert.ok(texts.includes('修改发布说明'))
  assert.ok(texts.includes('nodeNotRun'), 'the idle node has no execution yet')
  // 选中的胶囊有 is-selected，其他节点的交付物不再展示。
  const selectedCapsules = collect(tree).classLists.filter((list) => list.includes('is-selected'))
  assert.equal(selectedCapsules.length, 1)
  assert.ok(!texts.includes('published the release'))
})

test('client: the selected node shows its session and executions', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'publish'))
  const { texts } = collect(tree)

  assert.ok(texts.includes('publish'))
  assert.ok(texts.includes('openSession'), 'the node session can be opened')
  assert.ok(texts.includes('published the release'))
  assert.ok(texts.includes('session-1'))
})

test('client: a repeated robot execution shows the shared session and compaction', async () => {
  const client = await loadClient()
  const data = startFixture()
  const devSession = 'session-dev-shared'
  data.run.steps = data.run.steps.map((step) =>
    step.nodeId === 'dev'
      ? {
          ...step,
          sessionId: devSession,
          ...(step.visit > 1 ? { resumed: true, compacted: true } : {}),
        }
      : step,
  )
  data.nodeResults = data.nodeResults.map((result) =>
    result.nodeId === 'dev'
      ? {
          ...result,
          sessionId: devSession,
          ...(result.seq > 1 ? { resumed: true, compacted: true } : {}),
        }
      : result,
  )

  const tree = client.render(detailStates(data, 'dev', 1))
  const { texts } = collect(tree)
  assert.ok(texts.includes('nodeSession'), 'the robot session is labelled on the node')
  assert.equal(texts.includes('nodeSessionHint'), false, 'the page does not explain the session mechanism')
  assert.ok(texts.includes(devSession), 'the shared session id is shown')
  assert.ok(texts.includes('openSession'), 'the shared session can be opened')
  // 「继续同一会话」只是实现细节：一个机器人一次运行只用一个会话，重复进入
  // 本来就是常态，不再作为 tag 展示；压缩历史仍然标出来。
  assert.equal(texts.includes('sessionResumed'), false, 'reusing the same session is not tagged')
  assert.ok(texts.includes('sessionCompacted'), 'the second execution says history was compacted')
})

test('client: entering a run focuses the running node, or done when completed', async () => {
  const client = await loadClient()

  // 已完成：默认打开终止节点，直接看到最终交付物。
  const doneData = fixture()
  const doneTree = client.render(detailStates(doneData, null))
  const doneTexts = collect(doneTree).texts
  assert.ok(doneTexts.includes('finalDeliverable'), 'a completed run opens on its final deliverable')
  assert.ok(doneTexts.includes('done'), 'the focused node is the end node')

  // 运行中：默认打开正在执行的那个节点，而不是结束节点。
  const runningData = fixture()
  const runningRun = {
    ...runningData.run,
    status: 'running',
    finishedAt: null,
    result: null,
    current: {
      nodeId: 'publish',
      visit: 1,
      type: 'robot',
      robot: 'publisher',
      startedAt: 3,
    },
  }
  const model = buildRunGraph({ run: runningRun, definition: runningData.definition })
  assert.ok(model)
  const runningTree = client.render(
    detailStates(
      {
        ...runningData,
        run: runningRun,
        graph: { ...model, ...layoutRunGraph(model) },
      },
      null,
    ),
  )
  const runningTexts = collect(runningTree).texts
  assert.ok(runningTexts.includes('published the release'), 'the running node is focused')
  assert.equal(runningTexts.includes('finalDeliverable'), false, 'the end node is not focused while running')
})

test('client: the run list renders cards when no run is selected', async () => {
  const client = await loadClient()
  const tree = client.render([
    {
      status: 'ready',
      runs: [{ runId: 'wf-list', goal: 'list smoke', status: 'completed', createdAt: 1 }],
      error: null,
    },
    null,
    { status: 'idle', data: null, error: null },
    0,
    null,
    null,
  ])
  const { classes, texts } = collect(tree)
  assert.ok(classes.includes('buka-workflows-card'))
  assert.ok(texts.some((text) => text.includes('wf-list')))
  assert.ok(texts.includes('list smoke'))
})

test('client: robot capsules and the inspector show the robot avatar', async () => {
  const client = await loadClient()
  const data = loopFixture()
  const avatarByRobot = { reviewer: 'owl', fixer: 'fox', auditor: 'panda' }
  // 运行接口会把 robots 服务的头像表带进图模型；这里直接补到图节点上。
  data.graph = {
    ...data.graph,
    nodes: data.graph.nodes.map((node) => ({
      ...node,
      avatar: node.robot === null ? null : (avatarByRobot[node.robot] ?? null),
    })),
  }
  const tree = client.render(detailStates(data, 'check'))
  const { classes, texts } = collect(tree)

  const capsuleAvatars = classes.filter((name) => name === 'buka-workflows-capsuleAvatar')
  assert.equal(capsuleAvatars.length, 3, 'every robot capsule carries an avatar')
  const inspectorAvatars = classes.filter((name) => name === 'buka-workflows-inspectorAvatar')
  assert.equal(inspectorAvatars.length, 1, 'the selected robot shows its avatar next to the title')
  for (const emoji of ['🦉', '🦊', '🐼']) assert.ok(texts.includes(emoji), `avatar ${emoji} is rendered`)
  // 机器人头像在预设色的浅底圆片里：底色由预设色与主题背景混合，不写死成亮色。
  assert.match(client.css(), /\.buka-workflows-avatar\{[^}]*border-radius:999px/u)

  // 没有头像表（robots 插件没装）时图照常画，只是不带头像。
  const bare = client.render(detailStates(fixture(), null))
  assert.equal(
    collect(bare).classes.filter((name) => name === 'buka-workflows-avatar').length,
    0,
  )
})

test('client: the general-purpose robot renders its fixed 🤖 avatar', async () => {
  const client = await loadClient()
  const data = loopFixture()
  data.graph = {
    ...data.graph,
    nodes: data.graph.nodes.map((node) => ({
      ...node,
      avatar: node.robot === null ? null : 'robot',
    })),
  }
  const { texts } = collect(client.render(detailStates(data, 'check')))
  assert.ok(texts.includes('🤖'), 'avatarMap 里的机器人头像 id 要画成固定 🤖')
})

test('client: a node the run did not reach is a gray dashed capsule', async () => {
  const client = await loadClient()
  const data = fixture()
  // approve 分支走了 publish；revise 没走，它的胶囊应当是灰色的「未运行」样式。
  const tree = client.render(detailStates(data, 'revise'))
  const idleCapsule = findCapsule(tree, 'writer')
  assert.ok(idleCapsule, 'the skip branch node has a capsule')
  const idleClasses = idleCapsule.props.className.split(/\s+/).filter(Boolean)
  assert.ok(idleClasses.includes('is-idle'))

  const css = client.css()
  assert.match(
    css,
    /\.buka-workflows-capsule\.is-idle\{[^}]*color:var\(--dsw-alias-label-tertiary\)/u,
    'idle capsules use the tertiary (gray) label color',
  )
  assert.match(css, /\.buka-workflows-capsule\.is-idle\{[^}]*border-style:dashed/u, 'idle capsules are dashed')
  assert.doesNotMatch(
    css,
    /\.buka-workflows-capsule\.is-idle\{[^}]*opacity:/u,
    'idle is a gray state, not just a faded type color',
  )
})

test('client: the start node is marked and an unreachable node explains why it never runs', async () => {
  const client = await loadClient()
  // 新定义不允许不可达节点；手工构造旧记录，验证页面仍能解释这种节点。
  const raw = {
    start: 'a',
    nodes: [
      { id: 'a', type: 'robot', robot: 'worker', prompt: 'go', next: 'b' },
      { id: 'b', type: 'robot', robot: 'worker', prompt: 'finish' },
      { id: 'orphan', type: 'robot', robot: 'worker', prompt: 'nobody points here' },
    ],
  }
  const definition = {
    plan: {
      goal: '',
      start: raw.start,
      maxSteps: 8,
      nodes: Object.fromEntries(raw.nodes.map((node) => [node.id, node])),
      order: raw.nodes.map((node) => node.id),
    },
    definition: raw,
  }
  const run = {
    runId: 'wf-render-orphan',
    goal: '',
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    steps: [
      { seq: 1, nodeId: 'a', type: 'robot', robot: 'worker', status: 'completed', stopReason: 'completed', startedAt: 1, finishedAt: 2 },
    ],
    result: { status: 'completed', lastNode: 'b' },
  }
  const model = buildRunGraph({ run, definition })
  assert.ok(model)
  const data = { run, definition, graph: { ...model, ...layoutRunGraph(model) }, nodeResults: [] }

  const startTree = client.render(detailStates(data, 'a'))
  assert.ok(collect(startTree).texts.includes('nodeStart'), 'the declared start carries a Start tag')

  const otherTree = client.render(detailStates(data, 'b'))
  assert.equal(collect(otherTree).texts.includes('nodeStart'), false, 'other nodes do not claim to be the start')

  const orphanTree = client.render(detailStates(data, 'orphan'))
  const orphanTexts = collect(orphanTree).texts
  assert.ok(orphanTexts.includes('nodeUnreachable'), 'an unreachable node says why it never runs')
  assert.ok(orphanTexts.includes('nodeNotRun'))
})

test('client: an execution links to the execution it led to', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'gate'))
  const { texts } = collect(tree)

  // 门禁批准后走到 publish 的第 1 次执行，按步骤概要显示并带上执行序号。
  assert.ok(texts.includes('executionNext'), 'the tab shows where the run went next')
  const nextTitle = findByClass(tree, 'buka-workflows-nextTitle')
  assert.ok(nextTitle, 'the next execution is rendered as a target')
  assert.deepEqual(collect(nextTitle).texts, ['发布 v1.2 的说明'], 'the target is labelled by its step summary')
  const nextVisit = findByClass(tree, 'buka-workflows-nextVisit')
  assert.ok(nextVisit)
  assert.deepEqual(collect(nextVisit).texts, ['#1'], 'the target execution number is shown')
  const link = findByClass(tree, 'buka-workflows-nextLink')
  assert.ok(link, 'the next execution is clickable')
  assert.equal(typeof link.props.onClick, 'function')
  link.props.onClick() // 聚焦动作不应抛错（桩里的 setState 是空操作）

  // 最后一次执行后面没有下一次执行：指向运行最后走到的终止节点，并标「运行结束」。
  const lastTree = client.render(detailStates(data, 'publish'))
  const lastTitle = findByClass(lastTree, 'buka-workflows-nextTitle')
  assert.ok(lastTitle, 'the last execution links to the end node it reached')
  assert.deepEqual(collect(lastTitle).texts, ['done'])
  assert.deepEqual(collect(findByClass(lastTree, 'buka-workflows-nextVisit')).texts, ['executionEnded'])

  // 运行在节点本身结束（例如被拒绝、失败）时，没有可指向的节点，只说明运行结束。
  const cut = fixture()
  cut.run.result = { status: 'rejected', lastNode: 'publish' }
  const cutTree = client.render(detailStates(cut, 'publish'))
  const cutTexts = collect(cutTree).texts
  assert.ok(cutTexts.includes('executionNextEnded'), 'a run that stops on the node itself says it ended')
  assert.equal(findByClass(cutTree, 'buka-workflows-nextLink'), null, 'there is no link in that case')
})

test('client: an execution footer walks both backward and forward', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'publish'))
  const { texts } = collect(tree)

  assert.ok(texts.includes('executionPrev'), 'the left side is labelled previous step')
  assert.ok(texts.includes('executionNext'), 'the right side is labelled next step')
  const prevLink = findByClass(tree, 'buka-workflows-prevLink')
  assert.ok(prevLink, 'the previous execution is clickable')
  assert.deepEqual(collect(findByClass(tree, 'buka-workflows-prevTitle')).texts, ['发布确认'])
  assert.deepEqual(collect(findByClass(tree, 'buka-workflows-prevVisit')).texts, ['#1'])
  assert.equal(typeof prevLink.props.onClick, 'function')
  prevLink.props.onClick()

  // 第一次执行没有上一步：明确说明，而不是留空。
  const gateTree = client.render(detailStates(data, 'gate'))
  assert.ok(collect(gateTree).texts.includes('executionPrevNone'))
  assert.equal(findByClass(gateTree, 'buka-workflows-prevLink'), null)
})

test('client: the first execution can walk back to the start node', async () => {
  const client = await loadClient()
  const data = startFixture()
  const tree = client.render(detailStates(data, 'dev', 0))
  const { texts } = collect(tree)

  assert.ok(texts.includes('executionPrev'))
  const prevLink = findByClass(tree, 'buka-workflows-prevLink')
  assert.ok(prevLink)
  assert.deepEqual(collect(findByClass(tree, 'buka-workflows-prevTitle')).texts, ['typeStart'])
  assert.deepEqual(collect(findByClass(tree, 'buka-workflows-prevVisit')).texts, ['executionStart'])
  prevLink.props.onClick()
})

test('client: the next-step link follows the run, not the graph order', async () => {
  const client = await loadClient()
  const data = loopFixture()
  // check 的第 1 次执行失败了两次，被送进 fix 的第 1 次执行。
  const tree = client.render(detailStates(data, 'check', 0))
  const nextTitle = findByClass(tree, 'buka-workflows-nextTitle')
  assert.ok(nextTitle)
  assert.deepEqual(collect(nextTitle).texts, ['修复检查发现的问题'])
  const nextVisit = findByClass(tree, 'buka-workflows-nextVisit')
  assert.ok(nextVisit)
  assert.deepEqual(collect(nextVisit).texts, ['#1'])
})

test('client: every execution gets its own tab with input and output', async () => {
  const client = await loadClient()
  const data = loopFixture()
  const tree = client.render(detailStates(data, 'check'))
  const { classes, classLists, texts } = collect(tree)

  assert.ok(classes.includes('buka-workflows-tabs'))
  const tabs = classLists.filter((list) => list.includes('buka-workflows-tab'))
  assert.equal(tabs.length, 3, 'check ran three times, so there are three tabs')
  for (const visit of ['#1', '#2', '#3']) assert.ok(texts.includes(visit), `tab ${visit} exists`)
  // 默认打开最近一次执行，只渲染那一次的输入 / 输出。
  const active = tabs.filter((list) => list.includes('is-active'))
  assert.equal(active.length, 1)
  assert.ok(texts.includes('rendered prompt for check #3'), 'the active tab shows that execution input')
  assert.ok(!texts.includes('rendered prompt for check #1'), 'other executions stay collapsed')
  assert.ok(texts.includes('executionInput'))
  assert.ok(texts.includes('executionOutput'))
  assert.ok(texts.includes('检查通过'), 'the active tab shows that execution output')
})

test('client: the output tab shows the deliverable content, not routing fields', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'publish'))
  const { texts } = collect(tree)

  // 输出结果展示交付物正文；结构化结果字段只用于路由，不铺成 key/value，也不展示原始 JSON。
  assert.ok(texts.includes('executionOutput'))
  assert.ok(texts.includes('published the release'), 'the output shows the deliverable text')
  assert.equal(texts.includes('nodeReport'), false, 'no structured-result label')
  assert.equal(texts.includes('ok'), false, 'routing fields are not rendered as key/value rows')
  assert.equal(texts.includes('true'), false)
  assert.equal(texts.some((text) => text.includes('"ok":')), false, 'no raw JSON block')
  const panel = findByClass(tree, 'buka-workflows-tabPanel')
  assert.ok(panel)
  assert.equal(
    collect(panel).classes.includes('buka-workflows-kv'),
    false,
    'the execution panel has no key/value field block',
  )

  // footer 是页面根节点的直接子节点；滚动只发生在 body 里，内容再长也顶不掉它。
  const page = findByClass(tree, 'buka-workflows-page')
  assert.ok(page)
  const body = findByClass(tree, 'buka-workflows-body')
  assert.ok(body)
  assert.equal(collect(body).classes.includes('buka-workflows-footer'), false, 'the footer is not scrolling content')
  const directFooters = (page.children ?? []).filter(
    (child) => typeof child?.props?.className === 'string' && child.props.className.includes('buka-workflows-footer'),
  )
  assert.equal(directFooters.length, 1, 'the footer is pinned as the last row of the page layout')

  const css = client.css()
  assert.match(css, /\.buka-workflows-page\{[^}]*overflow:hidden/u)
  assert.match(css, /\.buka-workflows-body\{[^}]*overflow-y:auto/u)
  assert.match(css, /\.buka-workflows-footer\{[^}]*flex:none/u)
})

test('client: the end node shows the final deliverable, not a definition message', async () => {
  const client = await loadClient()
  const data = fixture()
  const tree = client.render(detailStates(data, 'done'))
  const { texts } = collect(tree)

  assert.ok(texts.includes('finalDeliverable'), 'the end node has a final-deliverable section')
  assert.ok(texts.includes('published the release'), 'it is the content of the last robot execution')
  const source = texts.find((text) => text.includes('finalDeliverableFrom'))
  assert.ok(source, 'the source is labelled')
  assert.ok(source.includes('发布 v1.2 的说明'), 'the source label identifies the node')
  assert.equal(texts.includes('endMessage'), false, 'there is no static end message anymore')
  assert.equal(texts.includes('nodeExecutions'), false, 'the end node does not show execution tabs')

  // 来源可以点回那次机器人执行。
  const link = findByClass(tree, 'buka-workflows-nextLink')
  assert.ok(link, 'the final deliverable links to its source execution')
  assert.equal(typeof link.props.onClick, 'function')
  link.props.onClick()
})

test('client: a loop run shows visit badges and a back edge next to the rail', async () => {
  const client = await loadClient()
  const data = loopFixture()
  const tree = client.render(detailStates(data, null))
  const { classes, classLists, texts, tags, paths } = collect(tree)

  // check 被循环访问 3 次、fix 2 次，胶囊右侧显示 ×N。
  assert.ok(texts.includes('×3'), 'the revisited node shows its visit count')
  assert.ok(texts.includes('×2'))
  const back = data.graph.edges.find((edge) => edge.from === 'fix' && edge.to === 'check')
  assert.ok(back.lane >= 1, 'the back edge is drawn on a side lane, not the main rail')
  assert.equal(back.traversals, 2, 'the loop was walked twice')
  // 循环不额外画图标：回边与正向边的两个箭头围成环即可。
  assert.equal('glyph' in back, false)
  assert.equal(classLists.some((list) => list.includes('is-loop')), false, 'no loop badge on the graph')
  assert.equal(texts.includes('↺'), false, 'no ↺ icon on the graph or in the legend')
  const arrows = classLists.filter((list) => list.includes('buka-workflows-edgeArrow'))
  assert.equal(arrows.length, data.graph.edges.length, 'every edge carries a mid-path arrow')
  assert.ok(paths.length >= data.graph.edges.length * 2, 'paths and arrows are both drawn')

  // 没走到的审计分支依然显示为灰色胶囊。
  const idleCapsule = findCapsule(tree, 'auditor')
  assert.ok(idleCapsule)
  assert.ok(idleCapsule.props.className.split(/\s+/).includes('is-idle'))
})

test('client: a named edge exposes a hover hit area and shows only its name', async () => {
  const client = await loadClient()
  const data = loopFixture()
  const tree = client.render(detailStates(data, null))

  /** @type {Array<Record<string, any>>} */
  const hits = []
  walk(tree, (node) => {
    const className = node.props?.className
    if (typeof className === 'string' && className.split(/\s+/).includes('buka-workflows-edgeHit')) hits.push(node)
  })
  assert.ok(hits.length > 0, 'named edges get a transparent hit area')
  assert.equal(typeof hits[0].props.onMouseEnter, 'function')

  // 悬浮状态只带名字和鼠标坐标；把第 8 个 state（edgeTip）预置上即可检查
  // 它渲染的文本里没有任何条件 / 提示词配置。
  const named = data.graph.edges.find((edge) => edge.names.includes('发现问题'))
  assert.ok(named)
  const tipState = { key: named.key, text: '发现问题', x: 100, y: 50 }
  const tipTree = client.render([...detailStates(data, null), tipState])
  const tip = findByClass(tipTree, 'buka-workflows-edgeTip')
  assert.ok(tip, 'the hover tip is rendered')
  const tipContent = collect(tip)
  assert.ok(tipContent.texts.includes('发现问题'), 'the tip shows only the edge name')
  assert.deepEqual(tip.children, ['发现问题'], 'the tip carries the name alone: no dot, bar or icon')
  assert.equal(
    tipContent.classes.some((name) => name.includes('edgeTipSwatch')),
    false,
    'there is no colour bar next to the name',
  )
  assert.deepEqual(tip.props.style, { left: '112px', top: '64px' })
  assert.equal(tip.props.role, 'tooltip')
  assert.equal(tip.props.className.includes('is-anchored'), false, 'without an anchor the tip follows the cursor')

  // 悬浮的线变成实线并略粗，其余线压暗；不再铺光晕。
  const hovered = collect(tipTree)
  assert.equal(hovered.classes.includes('buka-workflows-edgeHalo'), false, 'no halo layer anymore')
  assert.ok(
    hovered.classLists.some((list) => list.includes('buka-workflows-edge') && list.includes('is-hovered')),
    'the hovered edge itself is highlighted',
  )
  assert.ok(
    hovered.classLists.some((list) => list.includes('buka-workflows-edge') && list.includes('is-dimmed')),
    'the other edges step back',
  )
  assert.ok(
    hovered.classLists.some((list) => list.includes('buka-workflows-edgeArrow') && list.includes('is-hovered')),
    'the arrow is highlighted too',
  )
  const edgeLists = hovered.classLists.filter((list) => list.includes('buka-workflows-edge'))
  assert.equal(edgeLists.filter((list) => list.includes('is-hovered')).length, 1, 'only one edge is hovered')
  assert.equal(
    edgeLists.filter((list) => list.includes('is-dimmed')).length,
    data.graph.edges.length - 1,
    'every other edge steps back',
  )

  // 真实 DOM 里名字钉在轨道右侧、线中段的高度上，纵向由 is-anchored 居中。
  const anchored = client.render([
    ...detailStates(data, null),
    { ...tipState, anchor: { left: 132, top: 241 } },
  ])
  const anchoredTip = findByClass(anchored, 'buka-workflows-edgeTip')
  assert.ok(anchoredTip, 'the anchored tip is rendered')
  assert.ok(anchoredTip.props.className.includes('is-anchored'), 'an anchored tip is vertically centred')
  assert.deepEqual(anchoredTip.props.style, { left: '132px', top: '241px' })

  // 交互回调按 SVG 几何算落点：名字钉在轨道右侧、这条线中段的高度上。
  const namedEdges = data.graph.edges.filter((edge) => {
    const names = Array.isArray(edge.names)
      ? edge.names.filter((name) => typeof name === 'string' && name !== '')
      : []
    return typeof edge.d === 'string' && edge.d !== '' && names.length > 0
  })
  const namedHit = hits[namedEdges.indexOf(named)]
  assert.ok(namedHit, 'the named edge has its own hit area')
  namedHit.props.onMouseEnter({
    currentTarget: {
      ownerSVGElement: { getBoundingClientRect: () => ({ left: 80, top: 111 }) },
    },
    clientX: 50,
    clientY: 60,
  })
  const entry = client.updates().find((update) => update !== null && typeof update === 'object')
  assert.ok(entry, 'hovering the hit area updates the tip')
  assert.deepEqual(entry.anchor, { left: 80 + data.graph.width, top: 111 + named.arrow.y })

  // 靠近视口边缘时名字会收进可视区；测试环境平时没有 window，这里临时给一个。
  globalThis.window = { innerWidth: 1000, innerHeight: 800 }
  try {
    const far = client.render([
      ...detailStates(data, null),
      { ...tipState, anchor: { left: 990, top: 790 } },
    ])
    const farTip = findByClass(far, 'buka-workflows-edgeTip')
    assert.deepEqual(farTip.props.style, { left: '752px', top: '776px' })
  } finally {
    delete globalThis.window
  }
})

test('client: an edge label never lands on a node row', async () => {
  const client = await loadClient()
  const data = loopFixture()
  const rows = data.graph.rows.map((row) => row.y).sort((left, right) => left - right)
  assert.ok(rows.length >= 3, 'the loop fixture has enough rows')
  // 把有名字的边的箭头挪到中间那一行上，模拟自环 / 跨偶数行的回边。
  const rowY = rows[1]
  data.graph.edges = data.graph.edges.map((edge) =>
    edge.names.length > 0 ? { ...edge, arrow: { ...edge.arrow, y: rowY } } : edge,
  )
  const tree = client.render(detailStates(data, null))
  /** @type {Array<Record<string, any>>} */
  const hits = []
  walk(tree, (node) => {
    const className = node.props?.className
    if (typeof className === 'string' && className.split(/\s+/).includes('buka-workflows-edgeHit')) hits.push(node)
  })
  assert.ok(hits.length > 0, 'the named edges still have hit areas')
  hits[0].props.onMouseEnter({
    currentTarget: { ownerSVGElement: { getBoundingClientRect: () => ({ left: 80, top: 0 }) } },
    clientX: 10,
    clientY: 10,
  })
  const entry = client.updates().find((update) => update !== null && typeof update === 'object')
  assert.ok(entry, 'hovering updates the tip')
  // 标签被挪到下一行之前的空隙里，而不是压在 rows[1] 的胶囊上。
  assert.deepEqual(entry.anchor, {
    left: 80 + data.graph.width,
    top: (rows[1] + rows[2]) / 2,
  })
})

test('client: the start node is a marker, not an execution', async () => {
  const client = await loadClient()
  const data = startFixture()
  const tree = client.render(detailStates(data, 'start'))
  const { texts, classLists } = collect(tree)

  // 图上有一个「开始」胶囊；选中后详情显示起点标签和说明，没有执行记录。
  assert.ok(findCapsule(tree, 'typeStart'), 'the start node has its own capsule')
  assert.ok(texts.includes('nodeStart'))
  assert.ok(texts.includes('typeStart'))
  assert.ok(texts.includes('startNodeHint'))
  assert.equal(texts.includes('nodeExecutions'), false, 'a start node has no execution tabs')
  assert.ok(
    classLists.some((list) => list.includes('buka-workflows-capsule') && list.includes('is-start')),
    'the start capsule has its own type style',
  )
})

test('client: the first dev execution comes from the start edge, the rework one from the test edge', async () => {
  const client = await loadClient()
  const data = startFixture()
  const first = collect(client.render(detailStates(data, 'dev', 0)))
  assert.ok(first.texts.includes('按需求实现导出功能。'))
  assert.equal(first.texts.includes('测试打回：发现 2 个问题'), false)

  const rework = collect(client.render(detailStates(data, 'dev', 1)))
  assert.ok(rework.texts.includes('测试打回：发现 2 个问题'))
  assert.ok(rework.texts.some((text) => text.includes('按需求实现导出功能。') === false))
  assert.ok(rework.texts.includes('#2'))
})
