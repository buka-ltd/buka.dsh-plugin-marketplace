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

import { buildRunGraph, layoutRunGraph } from '../plugins/workflows/lib/graph.js'

const CLIENT_PATH = path.resolve('plugins/workflows/client.js')

/**
 * 手工构造落盘的定义快照（不经过 definition.js 校验）。
 *
 * 页面测试只关心「图模型 + 运行记录」怎么渲染；定义形状直接按图模型读取的
 * 结构给出，避免和 definition.js 的校验规则演进耦合。
 *
 * @param {Record<string, any>} raw
 * @returns {{ plan: Record<string, any>, definition: Record<string, any> }}
 */
function definitionSnapshot(raw) {
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : []
  const ids = nodes.map((node) => node.id)
  const startNode = nodes.find((node) => node?.type === 'start')
  return {
    plan: {
      goal: typeof raw?.goal === 'string' ? raw.goal : '',
      start: typeof raw?.start === 'string' && raw.start !== '' ? raw.start : (startNode?.id ?? ids[0] ?? ''),
      maxSteps: Number.isInteger(raw?.maxSteps) ? raw.maxSteps : 64,
      nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
      order: ids,
    },
    definition: raw,
  }
}

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
 * 找到第一个满足条件的元素。
 *
 * @param {any} tree
 * @param {(node: Record<string, any>) => boolean} predicate
 * @returns {Record<string, any> | null}
 */
function findBy(tree, predicate) {
  let found = null
  walk(tree, (node) => {
    if (found !== null) return
    if (predicate(node)) found = node
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
       * @param {(key: string) => string} [t] 词典函数；默认原样返回 key
       * @param {(name: string) => any} [getService] Client Service 查找函数
       * @returns {any}
       */
      render(states, t = (key) => key, getService = () => null) {
        stateQueue.length = 0
        stateQueue.push(...states)
        stateIndex = 0
        stateUpdates.length = 0
        return components.page({ t, getService })
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
      { id: 'publish', type: 'robot', robot: 'publisher', summary: '发布 v1.2 的说明', prompt: '执行发布', next: 'done' },
      { id: 'revise', type: 'robot', robot: 'writer', prompt: '修改发布说明', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const definition = definitionSnapshot(raw)
  const run = {
    runId: 'wf-render-smoke',
    goal: raw.goal,
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    // 一个机器人一次运行只有一个会话；每次进入都记在同一条会话的 entries 里。
    sessions: [
      {
        robot: 'publisher',
        sessionId: 'session-1',
        firstNodeId: 'publish',
        lastNodeId: 'publish',
        visits: 1,
        entries: [{ nodeId: 'publish', visit: 1, seq: 2, sessionId: 'session-1', at: 3 }],
      },
    ],
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
 * 按机器人聚合执行记录，生成新格式的 `run.sessions`：一个机器人一次运行只有一个
 * 会话，`entries` 记下每次进入节点。
 *
 * @param {Array<Record<string, any>>} steps
 * @returns {Array<Record<string, any>>}
 */
function sessionsFromSteps(steps) {
  /** @type {Map<string, Array<Record<string, any>>>} */
  const byRobot = new Map()
  for (const step of steps) {
    if (typeof step?.robot !== 'string') continue
    if (!byRobot.has(step.robot)) byRobot.set(step.robot, [])
    byRobot.get(step.robot).push(step)
  }
  return [...byRobot.entries()].map(([robot, robotSteps]) => ({
    robot,
    sessionId: robotSteps[0].sessionId,
    firstNodeId: robotSteps[0].nodeId,
    lastNodeId: robotSteps[robotSteps.length - 1].nodeId,
    visits: robotSteps.length,
    entries: robotSteps.map((step) => ({
      nodeId: step.nodeId,
      visit: step.visit,
      seq: step.seq,
      sessionId: step.sessionId,
      at: step.startedAt,
      resumed: step.visit > 1,
      compacted: step.visit > 1,
    })),
  }))
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
        maxVisits: 5,
        next: [
          { to: 'done', name: '检查通过' },
          { to: 'skip', name: '转人工审计' },
          { to: 'fix', name: '发现问题' },
        ],
      },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修复检查发现的问题', next: 'check' },
      { id: 'skip', type: 'robot', robot: 'auditor', prompt: '补充审计', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const definition = definitionSnapshot(raw)
  /** @type {Array<Record<string, any>>} */
  const steps = []
  /** @type {Map<string, number>} */
  const visits = new Map()
  /** 一个机器人一次运行只有一个会话：同机器人的多次执行共用同一个 sessionId。 */
  const sessionByRobot = new Map()
  /**
   * @param {string} robot
   * @returns {string}
   */
  function sessionFor(robot) {
    if (!sessionByRobot.has(robot)) sessionByRobot.set(robot, `session-${robot}`)
    return sessionByRobot.get(robot)
  }
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
      sessionId: sessionFor(robot),
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
    sessions: sessionsFromSteps(steps),
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
        next: [
          { to: 'dev', name: '测试打回', prompt: '测试打回：{{nodes.test.text}}' },
          { to: 'done', name: '测试通过' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const definition = definitionSnapshot(raw)
  const texts = ['初版完成', '发现 2 个问题', '修复完成', '复查通过']
  const robotForNode = { dev: 'coder', test: 'tester' }
  /** 一个机器人一次运行只有一个会话：dev 的两次执行都用 coder 的会话。 */
  const sessionForRobot = { coder: 'session-coder', tester: 'session-tester' }
  const steps = [
    { seq: 1, nodeId: 'dev', visit: 1, text: texts[0], data: null },
    { seq: 2, nodeId: 'test', visit: 1, text: texts[1], data: { passed: false } },
    { seq: 3, nodeId: 'dev', visit: 2, text: texts[2], data: null },
    { seq: 4, nodeId: 'test', visit: 2, text: texts[3], data: { passed: true } },
  ].map((step, index) => ({
    ...step,
    type: 'robot',
    robot: robotForNode[step.nodeId],
    status: 'completed',
    stopReason: 'completed',
    startedAt: index * 10 + 1,
    finishedAt: index * 10 + 5,
    sessionId: sessionForRobot[robotForNode[step.nodeId]],
  }))
  const run = {
    runId: 'wf-render-start',
    goal: raw.goal,
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    sessions: sessionsFromSteps(steps),
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
 * 旧记录：同一个机器人节点在两个不同会话里执行过，nodeResults 里没有逐次渲染后的
 * prompt（只有定义里的那一份）。
 *
 * @returns {{ run: Record<string, any>, definition: Record<string, any>, graph: Record<string, any>, nodeResults: Array<Record<string, any>> }}
 */
function legacyFixture() {
  const raw = {
    goal: '回看旧记录',
    start: 'check',
    nodes: [
      { id: 'check', type: 'robot', robot: 'reviewer', summary: '检查旧稿', prompt: '定义里的检查提示', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  }
  const definition = definitionSnapshot(raw)
  const steps = [
    { seq: 1, nodeId: 'check', visit: 1, sessionId: 'session-old-1', startedAt: 1, finishedAt: 5, text: '旧输出 1' },
    { seq: 2, nodeId: 'check', visit: 2, sessionId: 'session-old-2', startedAt: 10, finishedAt: 15, text: '旧输出 2' },
  ].map((step) => ({
    ...step,
    type: 'robot',
    robot: 'reviewer',
    status: 'completed',
    stopReason: 'completed',
    resumed: step.visit > 1,
    compacted: step.visit > 1,
  }))
  const run = {
    runId: 'wf-render-legacy',
    goal: raw.goal,
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
    current: null,
    pendingGate: null,
    // 旧格式：同一个机器人在两个会话里执行过，每次进入仍是自己的一条记录。
    sessions: [
      {
        robot: 'reviewer',
        sessionId: 'session-old-1',
        firstNodeId: 'check',
        lastNodeId: 'check',
        visits: 1,
        entries: [{ nodeId: 'check', visit: 1, seq: 1, sessionId: 'session-old-1', at: 1 }],
      },
      {
        robot: 'reviewer',
        sessionId: 'session-old-2',
        firstNodeId: 'check',
        lastNodeId: 'check',
        visits: 1,
        entries: [{ nodeId: 'check', visit: 2, seq: 2, sessionId: 'session-old-2', at: 10, resumed: true, compacted: true }],
      },
    ],
    steps,
    result: { status: 'completed', lastNode: 'done' },
  }
  const model = buildRunGraph({ run, definition })
  assert.ok(model)
  const graph = { ...model, ...layoutRunGraph(model) }
  // 旧记录里没有每次进入的渲染后 prompt。
  const nodeResults = steps.map((step) => ({
    seq: step.seq,
    nodeId: step.nodeId,
    sessionId: step.sessionId,
    stopReason: step.stopReason,
    text: step.text,
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
    { status: 'ready', runs: [], archivedCount: 0, error: null },
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
  assert.equal(texts.filter((text) => text === 'session-1').length, 1, 'the node session is shown once')
  // 已结束的节点用 durationMs（publish 执行 10ms）。
  assert.ok(texts.includes('10ms'), 'a finished node keeps its recorded duration')
})

test('client: a repeated robot execution shows the shared session and compaction', async () => {
  const client = await loadClient()
  const data = startFixture()
  const devSession = data.run.sessions.find((session) => session.robot === 'coder').sessionId
  data.run.steps = data.run.steps.map((step) =>
    step.visit > 1 ? { ...step, resumed: true, compacted: true } : step,
  )
  data.nodeResults = data.nodeResults.map((result) =>
    result.seq > 1 ? { ...result, resumed: true, compacted: true } : result,
  )

  const tree = client.render(detailStates(data, 'dev', 1))
  const { texts } = collect(tree)
  assert.ok(texts.includes('nodeSession'), 'the robot session is labelled on the node')
  assert.equal(texts.includes('nodeSessionHint'), false, 'the page does not explain the session mechanism')
  assert.equal(
    texts.filter((text) => text === devSession).length,
    1,
    'the shared session id is shown once at the node, not again in the execution tab',
  )
  assert.ok(texts.includes('openSession'), 'the shared session can be opened')
  // 「继续同一会话」只是实现细节：一个机器人一次运行只用一个会话，重复进入
  // 本来就是常态，不再作为 tag 展示；压缩历史仍然标出来。
  assert.equal(texts.includes('sessionResumed'), false, 'reusing the same session is not tagged')
  assert.ok(texts.includes('sessionCompacted'), 'the second execution says history was compacted')
})

test('client: a looped node shows its one robot session once, not per execution', async () => {
  const client = await loadClient()
  const data = loopFixture()
  const tree = client.render(detailStates(data, 'check', 2))
  const { classLists, texts } = collect(tree)
  const reviewerSession = data.run.sessions.find((session) => session.robot === 'reviewer').sessionId

  // check 进入了三次，但一个机器人一次运行只有一个会话：节点级只出现一次。
  const tabs = classLists.filter((list) => list.includes('buka-workflows-tab'))
  assert.equal(tabs.length, 3, 'check ran three times, so there are three execution tabs')
  assert.ok(texts.includes('nodeSession'))
  assert.equal(
    texts.filter((text) => text === reviewerSession).length,
    1,
    'the shared session id is rendered once for the whole node',
  )
  assert.equal(texts.filter((text) => text === 'openSession').length, 1, 'one open-session action for the node')
  assert.equal(texts.includes('nodeSessionsLegacy'), false, 'a normal run is not labelled as a legacy record')
  // 每次执行自己的输入仍然各在各自的 Tab 里。
  assert.ok(texts.includes('rendered prompt for check #3'))
})

test('client: an old record with several sessions lists each one and keeps the definition prompt for the first entry', async () => {
  const client = await loadClient()
  const data = legacyFixture()
  const tree = client.render(detailStates(data, 'check', 1))
  const { texts } = collect(tree)

  // 节点级列出旧记录里的两个会话，每个都能打开，并说明这是旧记录。
  assert.ok(texts.includes('nodeSessionsLegacy'), 'several sessions are explained as a legacy record')
  assert.ok(texts.includes('session-old-1'))
  assert.ok(texts.includes('session-old-2'))
  assert.equal(texts.filter((text) => text === 'openSession').length, 2, 'each legacy session has an open action')
  // 第二次进入没有记录输入，不能拿定义里的 prompt 冒充这一次。
  assert.ok(texts.includes('executionInputMissing'), 'the missing per-execution input is explained')
  assert.equal(texts.includes('定义里的检查提示'), false, 'the definition prompt is not reused for visit 2')
  assert.ok(texts.includes('旧输出 2'))

  // 第一次进入没有 per-execution prompt 时，仍可以回退到定义里的 prompt（旧格式兼容）。
  const first = collect(client.render(detailStates(data, 'check', 0)))
  assert.ok(first.texts.includes('定义里的检查提示'), 'visit 1 falls back to the definition prompt')
  assert.equal(first.texts.includes('executionInputMissing'), false)
})

test('client: a running node shows recovering and live-duration state, and step tags', async () => {
  const client = await loadClient()
  const data = fixture()
  const runningRun = {
    ...data.run,
    status: 'running',
    finishedAt: null,
    result: null,
    current: {
      nodeId: 'publish',
      visit: 1,
      type: 'robot',
      robot: 'publisher',
      sessionId: 'session-1',
      startSeq: 2,
      startedAt: Date.now() - 5000,
      recovering: true,
      recoveryAttempts: 2,
    },
    steps: data.run.steps.map((step) =>
      step.seq === 2
        ? { ...step, status: 'running', finishedAt: null, recovered: true, recoveryAttempts: 2, timedOut: true }
        : step,
    ),
  }
  const model = buildRunGraph({ run: runningRun, definition: data.definition })
  assert.ok(model)
  const graph = { ...model, ...layoutRunGraph(model) }
  const tree = client.render(
    detailStates({ ...data, run: runningRun, graph }, 'publish'),
    (key) => (key === 'sessionRecovering' ? '恢复中（第 {n} 次）' : key),
  )
  const { texts } = collect(tree)

  assert.ok(texts.includes('恢复中（第 2 次）'), 'the recovering tag carries the attempt number')
  assert.ok(texts.some((text) => /^5\.\ds$/u.test(text)), 'a running node shows a live duration')
  assert.equal(texts.includes('10ms'), false, 'the live node does not fall back to the finished duration')
  assert.ok(texts.includes('sessionRecovered'), 'a recovered execution is tagged')
  assert.ok(texts.includes('executionTimedOut'), 'a timed-out execution is tagged')
  // 运行中的当前会话仍然是节点级唯一的那一次。
  assert.ok(texts.includes('sessionLive'), 'the live session is marked')
  assert.equal(texts.filter((text) => text === 'session-1').length, 1, 'the live session is shown once')
})

test('client: an aborted execution shows the abort tag and its reason', async () => {
  const client = await loadClient()
  const data = fixture()
  const abortedRun = {
    ...data.run,
    status: 'failed',
    error: 'workflow node "publish" aborted the run: 缺少发布凭据',
    result: {
      status: 'failed',
      lastNode: 'publish',
      message: 'workflow node "publish" aborted the run: 缺少发布凭据',
      aborted: true,
    },
    steps: data.run.steps.map((step) =>
      step.seq === 2
        ? {
            ...step,
            status: 'failed',
            stopReason: 'aborted',
            aborted: true,
            route: null,
            routeTo: null,
            error: '缺少发布凭据',
          }
        : step,
    ),
  }
  const model = buildRunGraph({ run: abortedRun, definition: data.definition })
  assert.ok(model)
  const graph = { ...model, ...layoutRunGraph(model) }
  const tree = client.render(detailStates({ ...data, run: abortedRun, graph }, 'publish'))
  const { texts } = collect(tree)
  assert.ok(texts.includes('executionAborted'), 'the execution is tagged as an abort')
  assert.ok(texts.includes('error: 缺少发布凭据'), 'the node reason is shown')
  assert.equal(texts.includes('routeLabel: done'), false, 'an aborted execution has no route')
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
      startedAt: Date.now() - 1000,
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

test('client: a pending question shows a warning notice with an open-session action', async () => {
  const client = await loadClient()
  const data = fixture()
  data.run = {
    ...data.run,
    status: 'waiting',
    result: null,
    pendingInteraction: {
      kind: 'question',
      nodeId: 'publish',
      visit: 1,
      seq: 2,
      robot: 'publisher',
      sessionId: 'session-1',
      askedAt: 1_700_000_000_000,
      questions: [
        { id: 'q1', header: '发布范围', question: '要发布到生产环境吗？', options: [{ label: '是' }, { label: '否' }] },
        { id: 'q2', header: '其它', question: '还有别的吗？', options: [] },
      ],
    },
  }
  const tree = client.render(detailStates(data, 'publish'))
  const { classes, texts } = collect(tree)

  assert.ok(classes.includes('buka-workflows-interactionNotice'), 'the notice is rendered above the graph')
  assert.ok(texts.includes('waitingForAnswer'))
  assert.ok(texts.includes('要发布到生产环境吗？'), 'the first question is shown')
  assert.equal(texts.includes('还有别的吗？'), false, 'only the first question is previewed')
  assert.equal(texts.includes('q1'), false, 'question ids are not dumped')
  assert.ok(texts.includes('publish'), 'the node id is shown')
  assert.ok(texts.includes('openAnswerSession'))
  const body = findByClass(tree, 'buka-workflows-pageBody')
  assert.ok(body)
  assert.ok(
    String(body.children[0]?.props?.className ?? '').includes('buka-workflows-interactionNotice'),
    'the notice sits above the graph / detail split',
  )

  const openButton = findBy(tree, (node) => (node.children ?? []).includes('openAnswerSession'))
  assert.ok(openButton, 'the notice offers an open-session action')
  assert.equal(typeof openButton.props.onClick, 'function')
  openButton.props.onClick() // 桩里没有 uiWorkspace，只会走到错误 Toast，不应抛错

  const css = client.css()
  assert.match(css, /\.buka-workflows-interactionNotice\{[^}]*border[^}]*state-warn-primary/u)
  assert.match(css, /\.buka-workflows-interactionNotice\{[^}]*background:color-mix\(in srgb,var\(--dsw-alias-state-warn-primary\)/u)
  assert.match(css, /\.buka-workflows-interactionBody\{[^}]*white-space:pre-wrap/u)
})

test('client: a pending approval names the tool and prefers the display reason', async () => {
  const client = await loadClient()
  const data = fixture()
  data.run = {
    ...data.run,
    status: 'waiting',
    result: null,
    pendingInteraction: {
      kind: 'approval',
      nodeId: 'publish',
      visit: 1,
      seq: 2,
      robot: 'publisher',
      sessionId: 'session-1',
      askedAt: 1_700_000_000_001,
      toolName: 'shell',
      reason: 'rm -rf dist',
      displayReason: '需要清掉旧的构建产物',
    },
  }
  const tree = client.render(detailStates(data, 'publish'))
  const { texts } = collect(tree)

  assert.ok(texts.includes('waitingForApproval shell'), 'the tool name joins the approval title')
  assert.ok(texts.includes('需要清掉旧的构建产物'), 'the display reason is preferred')
  assert.equal(texts.includes('rm -rf dist'), false, 'the raw reason is hidden when a display reason exists')
  assert.ok(texts.includes('openApprovalSession'))
  const openButton = findBy(tree, (node) => (node.children ?? []).includes('openApprovalSession'))
  assert.ok(openButton)
  assert.equal(typeof openButton.props.onClick, 'function')

  // 没有 displayReason 时退回 reason。
  const fallback = fixture()
  fallback.run = {
    ...fallback.run,
    status: 'waiting',
    result: null,
    pendingInteraction: {
      kind: 'approval',
      nodeId: 'publish',
      sessionId: 'session-1',
      askedAt: 1,
      toolName: 'shell',
      reason: 'rm -rf dist',
    },
  }
  assert.ok(collect(client.render(detailStates(fallback, 'publish'))).texts.includes('rm -rf dist'))
})

test('client: an execution shows the selected route as a small label', async () => {
  const client = await loadClient()
  const data = fixture()
  data.run.steps = data.run.steps.map((step) => (step.seq === 2 ? { ...step, route: 'done', routeTo: 'done' } : step))
  const tree = client.render(detailStates(data, 'publish'))
  const { texts } = collect(tree)

  assert.ok(texts.includes('routeLabel: done'), 'the route name is shown next to the status')
  // 路由是标签，不是一份铺开的 JSON / key-value。
  assert.equal(texts.includes('routeTo'), false)
  assert.equal(texts.some((text) => text.includes('"next"')), false)
  assert.equal(texts.some((text) => text.includes('"to"')), false)
})

test('client: the run list tags a run that is waiting for the user', async () => {
  const client = await loadClient()
  const tree = client.render([
    {
      status: 'ready',
      runs: [
        { runId: 'wf-wait', goal: 'waiting run', status: 'waiting', createdAt: 1, waitingForUser: true },
        { runId: 'wf-live', goal: 'running run', status: 'running', createdAt: 2, waitingForUser: false },
      ],
      archivedCount: 0,
      error: null,
    },
    null,
    { status: 'idle', data: null, error: null },
    0,
    null,
    null,
  ])

  /** @type {Array<Record<string, any>>} */
  const cards = []
  walk(tree, (node) => {
    const className = node.props?.className
    if (typeof className === 'string' && className.split(/\s+/).includes('buka-workflows-card')) cards.push(node)
  })
  assert.equal(cards.length, 2)
  assert.ok(collect(cards[0]).texts.includes('waitingForUser'), 'a run waiting for the user carries the tag')
  assert.equal(collect(cards[1]).texts.includes('waitingForUser'), false, 'other runs do not')
})

test('client: the run list renders cards when no run is selected', async () => {
  const client = await loadClient()
  const tree = client.render([
    {
      status: 'ready',
      runs: [{ runId: 'wf-list', goal: 'list smoke', status: 'completed', createdAt: 1 }],
      archivedCount: 0,
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

test('client: an execution with attachments shows a download link', async () => {
  const client = await loadClient()
  const data = fixture()
  const attachments = [
    { index: 0, name: 'report.md', bytes: 16, description: '检查报告' },
  ]
  data.run.steps[1].attachments = attachments
  data.nodeResults[0].attachments = attachments
  const tree = client.render(
    detailStates(data, 'publish'),
    (key) => (key === 'attachmentCount' ? '{n} attachments' : key),
  )
  const { texts } = collect(tree)

  assert.ok(texts.includes('executionAttachments'))
  assert.ok(texts.includes('report.md'))
  assert.ok(texts.includes('16 B'))
  assert.ok(texts.includes('1 attachments'))
  const link = findByClass(tree, 'buka-workflows-attachmentLink')
  assert.ok(link, 'the attachment has a download link')
  assert.equal(link.props.download, 'report.md')
  assert.match(link.props.href, /^\/buka-workflows\/attachment\?/)
  assert.match(link.props.href, /runId=wf-render-smoke/)
  assert.match(link.props.href, /seq=2/)
  assert.match(link.props.href, /nodeId=publish/)
  assert.match(link.props.href, /name=report\.md/)
})

test('client: an attachment-only final deliverable is not reported as empty', async () => {
  const client = await loadClient()
  const data = fixture()
  const attachments = [
    { index: 0, name: 'report.md', bytes: 16, description: '检查报告' },
  ]
  data.run.steps[1].text = ''
  data.nodeResults[0].text = ''
  data.run.steps[1].attachments = attachments
  data.nodeResults[0].attachments = attachments
  const tree = client.render(detailStates(data, 'done'))
  const { texts } = collect(tree)

  assert.ok(texts.includes('finalDeliverable'))
  assert.equal(texts.includes('finalDeliverableEmpty'), false)
  assert.ok(texts.includes('executionOutputAttachmentsOnly'))
  const link = findByClass(tree, 'buka-workflows-attachmentLink')
  assert.ok(link, 'the final deliverable links to the attachment')
  assert.equal(link.props.download, 'report.md')
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

test('client: the run list shows sequence numbers and the archived entry', async () => {
  const client = await loadClient()
  const tree = client.render([
    {
      status: 'ready',
      runs: [
        { runId: 'wf-1', seq: 5, goal: 'one', status: 'completed', createdAt: 1, archivedAt: null },
        { runId: 'wf-2', seq: 6, goal: 'two', status: 'completed', createdAt: 2, archivedAt: 3 },
      ],
      archivedCount: 2,
      error: null,
    },
    null,
    { status: 'idle', data: null, error: null },
    0,
    null,
    null,
    null,
    null,
  ])
  const { classes, texts } = collect(tree)

  assert.equal(classes.filter((name) => name === 'buka-workflows-seq').length, 2)
  assert.ok(texts.includes('#5'), 'the first run shows its sequence number')
  assert.ok(texts.includes('#6'), 'the second run shows its sequence number')
  assert.ok(texts.includes('archived'), 'the archived run carries an archived tag')
  // 卡片头分成「序号 + 标题」与「标签组」两段，整卡仍是可点按钮。
  assert.equal(classes.filter((name) => name === 'buka-workflows-cardTitleGroup').length, 2)
  assert.equal(classes.filter((name) => name === 'buka-workflows-cardTags').length, 2)
  const card = findByClass(tree, 'buka-workflows-card')
  assert.ok(card, 'the whole card stays a button')
  assert.equal(typeof card.props.onClick, 'function')

  // 归档入口在标题右侧的工具栏里，按钮带归档数量；列表下方不再有归档入口。
  const toolbar = findByClass(tree, 'buka-workflows-toolbar')
  assert.ok(toolbar, 'the title row has a toolbar')
  const archivedButton = findByClass(tree, 'buka-workflows-toolbarButton')
  assert.ok(archivedButton, 'the archived entry lives in the toolbar')
  assert.deepEqual(collect(archivedButton).texts, ['archiveView (2)'])
  assert.equal(typeof archivedButton.props.onClick, 'function')
  assert.equal(findByClass(tree, 'buka-workflows-archivedRow'), null, 'no archived entry under the list')
  const heading = findByClass(tree, 'buka-workflows-title')
  assert.ok(heading, 'the list has a page title')
  assert.deepEqual(collect(heading).texts, ['title'], 'the normal list keeps the workflows title')

  // 标题行与工具栏同一行：标题列可收缩，工具栏不换行、不缩小；按钮用 32px 的
  // 工具栏尺寸（与 Robots 页一致），比执行面板里的 28px 小按钮更大。
  const toolbarClasses = collect(toolbar).classes
  assert.equal(
    toolbarClasses.filter((name) => name === 'buka-workflows-toolbarButton').length,
    3,
    'the archived, settings and refresh buttons use the toolbar size',
  )
  // 标题与工具栏是同一个 titleRow 的两个子元素，行内不换行；标题列可收缩，
  // 工具栏固定宽度，所以窗口再窄按钮也不会掉到下一行。
  const titleRow = findByClass(tree, 'buka-workflows-titleRow')
  assert.ok(titleRow, 'the header has one title row')
  const titleRowChildren = titleRow.children.filter((child) => typeof child === 'object' && child !== null)
  assert.ok(
    titleRowChildren.some((child) => child.props?.className === 'buka-workflows-titleCluster'),
    'the title is the first cell of the row',
  )
  assert.ok(
    titleRowChildren.includes(toolbar),
    'the toolbar is the second cell of the same row',
  )
  const css = client.css()
  assert.match(css, /\.buka-workflows-titleRow\{[^}]*flex-wrap:nowrap/u)
  assert.match(css, /\.buka-workflows-titleCluster\{[^}]*flex:1 1 auto/u)
  assert.match(css, /\.buka-workflows-toolbar\{[^}]*flex:none/u)
  assert.match(css, /\.buka-workflows-toolbarButton\{[^}]*height:32px/u)
})

test('client: the archived view marks its filter and can go back', async () => {
  const client = await loadClient()
  const tree = client.render([
    {
      status: 'ready',
      runs: [{ runId: 'wf-2', seq: 6, goal: 'two', status: 'completed', createdAt: 2, archivedAt: 3 }],
      archivedCount: 1,
      error: null,
    },
    null,
    { status: 'idle', data: null, error: null },
    0,
    null,
    null,
    null,
    null,
    true,
  ])
  const { texts } = collect(tree)

  // 归档视图里只有卡片带「已归档」标签，右上角工具栏不再放这个 tag，只剩归档设置与刷新；
  // 页面标题改成「已归档的工作流」。
  assert.ok(texts.includes('archived'), 'archived runs keep their tag')
  const heading = findByClass(tree, 'buka-workflows-title')
  assert.ok(heading, 'the archived list has a page title')
  assert.deepEqual(collect(heading).texts, ['archiveTitle'], 'the archived list has its own title')
  const toolbar = findByClass(tree, 'buka-workflows-toolbar')
  assert.ok(toolbar, 'the title row keeps a toolbar')
  assert.equal(collect(toolbar).texts.includes('archived'), false, 'the toolbar has no archived tag')
  assert.equal(collect(toolbar).texts.includes('archiveBack'), false, 'the back entry is not in the toolbar')
  assert.equal(
    collect(toolbar).classes.filter((name) => name === 'buka-workflows-toolbarButton').length,
    2,
    'only the settings and refresh buttons stay in the toolbar',
  )

  // 返回按钮在标题左侧（标题列里），通过它会回到普通运行列表。
  const backButton = findByClass(tree, 'buka-workflows-backButton')
  assert.ok(backButton, 'the back entry sits next to the title')
  assert.equal(backButton.props['aria-label'], 'archiveBack')
  const titleCluster = findByClass(tree, 'buka-workflows-titleCluster')
  assert.ok(titleCluster, 'the header has a title cluster')
  let backInsideTitle = false
  walk(titleCluster, (node) => {
    if (node === backButton) backInsideTitle = true
  })
  assert.ok(backInsideTitle, 'the back button is on the left of the title')
  assert.equal(typeof backButton.props.onClick, 'function')
  backButton.props.onClick()
  assert.deepEqual(client.updates().slice(-1), [false], 'clicking back leaves the archived view')

  assert.equal(findByClass(tree, 'buka-workflows-archivedRow'), null, 'no archived entry under the list')
  assert.equal(texts.includes('welcome'), false, 'the archive empty state is not the welcome copy')
})

test('client: the archive settings dialog renders the switch and hour fields', async () => {
  const client = await loadClient()
  const tree = client.render([
    { status: 'ready', runs: [], archivedCount: 0, error: null },
    null,
    { status: 'idle', data: null, error: null },
    0,
    null,
    null,
    null,
    null,
    false,
    true,
    { enabled: true, archiveHours: '24', deleteHours: '168' },
    false,
    false,
    null,
  ])
  const { classes } = collect(tree)

  // 对话框标题与底部按钮是 Modal 的 props，不在子节点里，直接读出来。
  const dialog = findBy(tree, (node) => node.props?.title === 'archiveSettingsTitle')
  assert.ok(dialog, 'the settings dialog is rendered')
  assert.equal(dialog.props.open, true)
  assert.equal(dialog.props.closeLabel, 'close')
  const { texts } = collect(dialog)

  for (const key of [
    'archiveEnabled',
    'archiveAfterHours',
    'deleteAfterHours',
    'hoursUnit',
    'archiveDefaultsHint',
  ]) {
    assert.ok(texts.includes(key), `${key} is in the settings dialog`)
  }
  const numberInputs = []
  walk(tree, (node) => {
    if (node.props?.type === 'number') numberInputs.push(node)
  })
  assert.equal(numberInputs.length, 2, 'the dialog has an archive and a delete hour field')
  assert.equal(numberInputs[0].props.value, '24')
  assert.equal(numberInputs[1].props.value, '168')
  assert.equal(numberInputs[0].props.disabled, false)
  assert.equal(numberInputs[1].props.disabled, false)
  assert.ok(classes.includes('buka-workflows-switch'))
  assert.ok(classes.includes('is-on'), 'the enabled switch is on')
  const toggle = findBy(tree, (node) => node.props?.role === 'switch')
  assert.ok(toggle, 'the setting is a switch')
  assert.equal(toggle.props['aria-checked'], true)
  const saveButton = findBy(dialog.props.footer, (node) => (node.children ?? []).includes('save'))
  assert.ok(saveButton, 'the save button is rendered')
  assert.equal(saveButton.props.disabled, false, 'a valid draft can be saved')
})

test('client: the settings dialog validates hours and disables fields when archive is off', async () => {
  const client = await loadClient()
  const states = [
    { status: 'ready', runs: [], archivedCount: 0, error: null },
    null,
    { status: 'idle', data: null, error: null },
    0,
    null,
    null,
    null,
    null,
    false,
    true,
  ]

  const invalid = client.render([
    ...states,
    { enabled: true, archiveHours: '0', deleteHours: '168' },
    false,
    false,
    null,
  ])
  assert.ok(collect(invalid).texts.includes('archiveInvalid'), 'an out-of-range archive hour is rejected')
  const invalidDialog = findBy(invalid, (node) => node.props?.title === 'archiveSettingsTitle')
  assert.ok(invalidDialog)
  const invalidSave = findBy(invalidDialog.props.footer, (node) => (node.children ?? []).includes('save'))
  assert.ok(invalidSave)
  assert.equal(invalidSave.props.disabled, true, 'an invalid draft cannot be saved')

  const disabled = client.render([
    ...states,
    { enabled: false, archiveHours: '24', deleteHours: '168' },
    false,
    false,
    null,
  ])
  /** @type {Array<Record<string, any>>} */
  const inputs = []
  walk(disabled, (node) => {
    if (node.props?.type === 'number') inputs.push(node)
  })
  assert.equal(inputs.length, 2)
  assert.equal(inputs[0].props.disabled, true, 'hours are not editable while the archive is off')
  assert.equal(inputs[1].props.disabled, true)
})

test('client: opening a node session refreshes a client list that does not know it yet', async () => {
  const client = await loadClient()
  const data = fixture()
  /** @type {string[]} */
  const calls = []
  const sessions = {
    list: { getSnapshot: () => ({ ids: [], byId: {} }) },
    async refresh() {
      calls.push('refresh')
    },
  }
  const uiWorkspace = {
    openSession(sessionId) {
      calls.push(`open:${sessionId}`)
    },
  }
  const tree = client.render(detailStates(data, 'publish'), (key) => key, (name) => {
    if (name === 'sessions') return sessions
    if (name === 'uiWorkspace') return uiWorkspace
    return null
  })
  const openButton = findBy(tree, (node) => (node.children ?? []).includes('openSession'))
  assert.ok(openButton, 'the node session offers an open action')
  await openButton.props.onClick()
  assert.deepEqual(calls, ['refresh', 'open:session-1'], 'a stale client list is refreshed before opening')
})

test('client: opening a known node session does not refresh the client list', async () => {
  const client = await loadClient()
  const data = fixture()
  /** @type {string[]} */
  const calls = []
  const sessions = {
    list: { getSnapshot: () => ({ ids: ['session-1'], byId: { 'session-1': {} } }) },
    async refresh() {
      calls.push('refresh')
    },
  }
  const uiWorkspace = {
    openSession(sessionId) {
      calls.push(`open:${sessionId}`)
    },
  }
  const tree = client.render(detailStates(data, 'publish'), (key) => key, (name) => {
    if (name === 'sessions') return sessions
    if (name === 'uiWorkspace') return uiWorkspace
    return null
  })
  const openButton = findBy(tree, (node) => (node.children ?? []).includes('openSession'))
  assert.ok(openButton)
  await openButton.props.onClick()
  assert.deepEqual(calls, ['open:session-1'], 'a known session opens without a list refresh')
})
