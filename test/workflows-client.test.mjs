/**
 * @buka/dsh-plugin-workflows 浏览器一半的渲染冒烟测试。
 *
 * 页面源码是 TypeScript（Node 24 默认做类型剥离），这里用 `module.registerHooks`
 * 把 `react` 与 DSH 的界面基座替换成最小桩，再直接调用注册到 `main` 的页面
 * 组件：工作流列表 / 工作流页（作业 / 定义）/ 作业四视图 / 任务抽屉 / 新建作业
 * 对话框 / 资产池都会被渲染一遍，能在不启动 DSH、也不先构建 `lib/` 的情况下
 * 抓到渲染函数里的运行时错误与 props 形状错误。
 *
 * 它不是浏览器测试，也不验证轮询定时器（`useEffect` 是桩）。
 */

import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const CLIENT_DIR = path.resolve('plugins/workflows/src/client')

/** 测试与桩模块共享的状态：注入的 useState 值、setState 记录与样式文本。 */
const harness = {
  /** @type {Array<any>} */
  queue: [],
  /** @type {Array<any>} */
  updates: [],
  index: 0,
  css: '',
}
globalThis.__WF_TEST__ = harness

/** React 桩。 */
const REACT_STUB = `
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
export default {
  createElement: h,
  Fragment: 'fragment',
  useState(initial) {
    const box = globalThis.__WF_TEST__
    const index = box.index
    const value = index < box.queue.length ? box.queue[index] : typeof initial === 'function' ? initial() : initial
    box.index = index + 1
    const setState = (next) => {
      const current = box.queue[index]
      const resolved = typeof next === 'function' ? next(current) : next
      box.queue[index] = resolved
      box.updates.push(resolved)
    }
    return [value, setState]
  },
  useEffect() {},
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useRef(value) { return { current: value } },
}
export const memo = (component) => component
`

/** 界面基座桩。 */
const PRIMITIVES_STUB = `
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
const passthrough = (tag) => (props) => h(tag, props, ...(props.children ?? []))
export const Button = passthrough('button')
export const Tag = passthrough('span')
export const Input = (props) => h('input', props)
export const StateDot = () => null
export const Toast = () => null
export const SegmentedTabs = (props) => h('div', props, ...(props.items ?? []).map((item) => h('span', { key: item.value }, item.label)))
export const Modal = (props) => (props.open === false ? null : h('div', { className: props.className }, ...(props.children ?? []), props.footer ?? null))
export const MarkdownText = () => null
export const CodeBlock = () => null
export const FileTypeIcon = () => null
export const IconChevronRightOutlineRegular = () => null
export const IconCloseOutlineRegular = () => null
export const IconRefreshOutlineRegular = () => null
export const IconWarningOutlineRegular = () => null
export const IconInfoOutlineRegular = () => null
export const IconDownloadOutlineRegular = () => null
export const IconNewChatOutlineRegular = () => null
export const IconFolderOpenOutlineRegular = () => null
export const IconSettingsOutlineRegular = () => null
`

const REACT_URL = `data:text/javascript,${encodeURIComponent(REACT_STUB)}`
const PRIMITIVES_URL = `data:text/javascript,${encodeURIComponent(PRIMITIVES_STUB)}`

let hooksRegistered = false

/** 把 `react` 与界面基座解析到桩模块。 */
function registerStubs() {
  if (hooksRegistered) return
  hooksRegistered = true
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'react') return { url: REACT_URL, shortCircuit: true }
      if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
        return { url: PRIMITIVES_URL, shortCircuit: true }
      }
      return next(specifier, context)
    },
  })
}

let loadSequence = 0

/** 载入客户端 `apply` 与页面组件。 */
async function loadClient() {
  registerStubs()
  /** @type {Record<string, Function>} */
  const components = {}
  let css = ''
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
  loadSequence += 1
  const suffix = `?smoke=${loadSequence}`
  const indexUrl = `${pathToFileURL(path.join(CLIENT_DIR, 'index.ts')).href}${suffix}`
  const client = await import(indexUrl)
  const i18n = await import(`${pathToFileURL(path.join(CLIENT_DIR, 'i18n.ts')).href}${suffix}`)
  const stateModule = await import(
    `${pathToFileURL(path.join(CLIENT_DIR, 'state/use-page-state.ts')).href}${suffix}`
  )
  client.apply({
    effect(fn) {
      fn()
    },
    locale: { bind: () => () => '', register: () => () => {} },
    slots: {
      inject(_name, fn) {
        fn()
      },
      register(options, component) {
        if (options.name === 'main') components.page = component
        return () => {}
      },
    },
  })
  assert.equal(typeof components.page, 'function', 'client should register a main page component')
  return {
    Page: components.page,
    zh: i18n.zh,
    createInitialState: stateModule.createInitialState,
    css: () => css,
  }
}

/** 走一遍渲染树；函数组件在这里展开。 */
function walk(node, visit) {
  if (node === null || node === undefined || node === false || node === true) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  if (typeof node.type === 'function') {
    walk(node.type({ ...node.props, children: node.children }), visit)
    return
  }
  if (node.type === 'fragment') {
    walk(node.children, visit)
    return
  }
  for (const child of node.children ?? []) walk(child, visit)
}

/** 收集文本、类名与边路径。 */
function collect(tree) {
  const texts = []
  const classes = []
  const paths = []
  walk(tree, (node) => {
    const className = node.props?.className
    if (typeof className === 'string') classes.push(...className.split(/\s+/).filter(Boolean))
    if (
      typeof node.props?.d === 'string' &&
      typeof className === 'string' &&
      className.split(/\s+/).includes('buka-workflows-edge')
    ) {
      paths.push(node.props.d)
    }
    for (const child of node.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') texts.push(String(child))
    }
  })
  return { texts, classes, paths }
}

/** 找到第一个满足条件的元素。 */
function findBy(tree, predicate) {
  let found = null
  walk(tree, (node) => {
    if (found === null && predicate(node)) found = node
  })
  return found
}

/** 展开一个节点后的全部文本。 */
function textOf(node) {
  const texts = []
  walk(node, (current) => {
    for (const child of current.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') texts.push(String(child))
    }
  })
  return texts.join(' ')
}

/** 按文本找可点击按钮并点它。 */
function clickButton(tree, label) {
  const node = findBy(
    tree,
    (current) => typeof current.props?.onClick === 'function' && textOf(current).includes(label),
  )
  assert.ok(node !== null, `button with label ${label} should exist`)
  node.props.onClick({})
  return node
}

/** 渲染一次页面。 */
function render(client, patch) {
  const state = { ...client.createInitialState(), ...patch }
  harness.queue = [state]
  harness.index = 0
  harness.updates = []
  const t = (key) => client.zh[key] ?? key
  const tree = client.Page({ t, getService: () => null })
  const collected = collect(tree)
  return { tree, ...collected, state }
}

/** 工作流定义。 */
const DEFINITION = {
  version: 4,
  name: '研发交付',
  description: '需求 → 研发 / 测试准备 → 验证 → 审批 → 发布',
  budgets: { maxTasks: 200, maxDurationHours: 72 },
  start: {
    task: {
      payload: {
        type: 'object',
        properties: { request: { type: 'string', description: '这次要做什么' } },
        required: ['request'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '需求说明' },
          acceptance: { type: 'string', description: '验收标准' },
        },
        required: ['requirement'],
        additionalProperties: false,
      },
    },
    next: [{ position: 'dev', type: 'dev.implement', dependsOn: ['$start'] }],
  },
  end: {
    task: {
      payload: {
        type: 'object',
        properties: { summary: { type: 'string', description: '交付说明' } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
  positions: [
    {
      id: 'dev',
      label: '研发',
      description: '负责实现与返工',
      executor: { kind: 'worker', name: '软件工程师' },
      taskTypes: [
        {
          id: 'dev.implement',
          label: '开发',
          description: '实现功能',
          payload: { type: 'object', properties: { requirement: { type: 'string' } } },
          output: { type: 'object', properties: { summary: { type: 'string' } } },
        },
      ],
    },
    {
      id: 'qa',
      label: '测试',
      executor: { kind: 'worker', name: '质量保障工程师' },
      taskTypes: [
        {
          id: 'qa.verify',
          label: '验证',
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
    {
      id: 'approve',
      label: '发布审批',
      executor: { kind: 'human' },
      taskTypes: [
        {
          id: 'approve.release',
          label: '批准发布',
          assistant: '沟通助理',
          payload: { type: 'object', properties: { summary: { type: 'string' } } },
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
    { id: 'start.dev', label: '开始研发', from: 'start', to: 'dev' },
    { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa', types: ['qa.verify'] },
    {
      id: 'qa.dev.rework',
      label: '返工',
      from: 'qa',
      to: 'dev',
      types: ['dev.implement'],
      back: true,
    },
    { id: 'qa.approve', label: '送审', from: 'qa', to: 'approve' },
    { id: 'approve.end', label: '交付', from: 'approve', to: 'end' },
  ],
}

/** 工作流详情响应。 */
const WORKFLOW_DETAIL = {
  workflow: {
    id: 'wf-1',
    name: '研发交付',
    description: '需求 → 研发 / 测试准备 → 验证 → 审批 → 发布',
    version: 3,
    status: 'active',
    definition: DEFINITION,
  },
  graph: {
    positions: DEFINITION.positions.map((position) => ({
      id: position.id,
      label: position.label,
      executor: position.executor,
    })),
    channels: DEFINITION.channels,
    start: { label: '开始' },
    end: { label: '结束' },
  },
  jobs: [
    {
      id: 'job-1',
      seq: 7,
      status: 'running',
      inputSummary: '实现登录页',
      taskCounts: { running: 1, ready: 1, pending: 1 },
      createdAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:05:00.000Z',
    },
    {
      id: 'job-2',
      seq: 6,
      status: 'completed',
      inputSummary: '修复导航',
      taskCounts: { completed: 4 },
      createdAt: '2026-11-11T10:00:00.000Z',
    },
  ],
}

/** 作业详情响应。 */
const JOB_DETAIL = {
  job: {
    id: 'job-1',
    seq: 7,
    status: 'running',
    workflowId: 'wf-1',
    workflowName: '研发交付',
    workflowVersion: 3,
    starter: { kind: 'human' },
    input: {
      raw: { request: '实现登录页' },
      structured: { requirement: '实现登录页', acceptance: '可以登录' },
    },
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:05:00.000Z',
    error: null,
  },
  definition: {
    name: '研发交付',
    positions: DEFINITION.positions.map((position) => ({
      id: position.id,
      label: position.label,
      executor: position.executor,
    })),
    channels: DEFINITION.channels,
    start: { label: '开始' },
    end: { label: '结束' },
  },
  tasks: [
    {
      id: 'task-0',
      position: 'start',
      type: 'start',
      typeLabel: '启动',
      channel: null,
      status: 'completed',
      createdAt: '2026-11-12T10:00:00.000Z',
      finishedAt: '2026-11-12T10:00:30.000Z',
      resultSummary: '已结构化',
    },
    {
      id: 'task-1',
      position: 'dev',
      type: 'dev.implement',
      typeLabel: '开发',
      channel: 'start.dev',
      status: 'running',
      deps: ['task-0'],
      createdAt: '2026-11-12T10:01:00.000Z',
      startedAt: '2026-11-12T10:01:05.000Z',
      claimant: { kind: 'worker', name: '软件工程师', sessionId: 'session-1' },
      attemptCount: 1,
      attachmentCount: 1,
    },
    {
      id: 'task-2',
      position: 'qa',
      type: 'qa.verify',
      typeLabel: '验证',
      channel: 'dev.qa',
      status: 'pending',
      deps: ['task-1'],
      createdAt: '2026-11-12T10:01:00.000Z',
    },
    {
      id: 'task-3',
      position: 'approve',
      type: 'approve.release',
      typeLabel: '批准发布',
      channel: 'qa.approve',
      status: 'ready',
      createdAt: '2026-11-12T10:02:00.000Z',
    },
    {
      id: 'task-4',
      position: 'end',
      type: 'end',
      typeLabel: '结束',
      channel: 'approve.end',
      status: 'ready',
      createdAt: '2026-11-12T10:02:00.000Z',
    },
  ],
  canRetryDelivery: true,
}

/** 结束任务详情（概览里的最终交付物）。 */
const FINAL_TASK = {
  task: {
    id: 'task-4',
    jobId: 'job-1',
    position: 'end',
    positionLabel: '结束',
    type: 'end',
    typeLabel: '结束',
    channel: 'approve.end',
    status: 'ready',
    payload: { summary: '最终交付说明' },
    deps: [],
    attempts: [],
    result: null,
    allowedActions: [],
  },
}

/** 打工人任务详情。 */
const TASK_DETAIL = {
  task: {
    id: 'task-1',
    jobId: 'job-1',
    position: 'dev',
    positionLabel: '研发',
    type: 'dev.implement',
    typeLabel: '开发',
    typeDescription: '实现功能',
    channel: 'start.dev',
    channelLabel: '开始研发',
    status: 'running',
    payload: { requirement: '实现登录页' },
    deps: [
      {
        id: 'task-0',
        position: 'start',
        typeLabel: '启动',
        status: 'completed',
        resultSummary: '已结构化',
      },
    ],
    createdAt: '2026-11-12T10:01:00.000Z',
    startedAt: '2026-11-12T10:01:05.000Z',
    finishedAt: null,
    claimant: { kind: 'worker', name: '软件工程师', sessionId: 'session-1' },
    attempts: [
      {
        id: 'att-1',
        sessionId: 'session-1',
        status: 'completed',
        stopReason: 'completed',
        startedAt: '2026-11-12T10:01:05.000Z',
        finishedAt: '2026-11-12T10:03:05.000Z',
        error: null,
      },
    ],
    result: {
      text: '登录页已实现',
      output: { summary: '登录页已实现' },
      attachments: [
        {
          id: 'att-file-1',
          name: 'trace.zip',
          bytes: 1024,
          mime: 'application/zip',
          description: '失败用例 trace',
        },
      ],
    },
    allowedActions: ['cancel', 'retry'],
  },
}

/** 人任务详情。 */
const HUMAN_TASK_DETAIL = {
  task: {
    id: 'task-3',
    jobId: 'job-1',
    position: 'approve',
    positionLabel: '发布审批',
    type: 'approve.release',
    typeLabel: '批准发布',
    typeDescription: '批准或驳回发布',
    status: 'running',
    payload: { summary: '发布说明' },
    deps: [],
    createdAt: '2026-11-12T10:02:00.000Z',
    startedAt: '2026-11-12T10:02:05.000Z',
    finishedAt: null,
    claimant: { kind: 'assistant', name: '沟通助理', sessionId: 'session-assistant' },
    attempts: [],
    result: null,
    allowedActions: ['complete'],
  },
}

test('工作流列表：停用的工作流灰显并排在后面', async () => {
  const client = await loadClient()
  const { texts, classes } = render(client, {
    workflows: {
      status: 'ready',
      data: [
        {
          id: 'wf-1',
          name: '研发交付',
          description: '需求到发布',
          version: 3,
          status: 'active',
          jobCount: 12,
          updatedAt: '2026-11-12T10:00:00.000Z',
        },
        {
          id: 'wf-2',
          name: '内容审核',
          version: 1,
          status: 'retired',
          jobCount: 2,
        },
      ],
      error: null,
    },
  })
  const text = texts.join(' ')
  assert.match(text, /研发交付/u)
  assert.match(text, /内容审核/u)
  assert.match(text, /已停用/u)
  assert.match(text, /12 个作业/u)
  assert.ok(classes.includes('is-disabled'), 'retired card is greyed out')
  assert.ok(
    text.indexOf('研发交付') < text.indexOf('内容审核'),
    'active workflows come before retired ones',
  )
})

test('工作流页：作业 Tab 默认，筛选、卡片与进入作业', async () => {
  const client = await loadClient()
  const { tree, texts } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  const text = texts.join(' ')
  for (const label of ['全部', '进行中', '已完成', '异常']) {
    assert.match(text, new RegExp(label, 'u'), `filter ${label}`)
  }
  assert.match(text, /作业 #7/u)
  assert.match(text, /实现登录页/u)
  assert.match(text, /作业 #6/u)
  assert.match(text, /研发交付/u)

  clickButton(tree, '作业 #7')
  assert.equal(harness.updates.length, 1)
  assert.equal(harness.updates[0].route.kind, 'job')
  assert.equal(harness.updates[0].route.view, 'overview')
})

test('定义结构：画通道、点节点打开抽屉、点通道记录选中', async () => {
  const client = await loadClient()
  const { tree, texts, paths } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  assert.equal(paths.length, DEFINITION.channels.length, 'every defined channel should be drawn')
  const firstEdge = paths[0].match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? []
  assert.ok(firstEdge[1] < firstEdge.at(-1), 'channels flow from top to bottom')
  assert.equal(firstEdge[0], firstEdge.at(-2), 'a straight channel keeps one column')
  const widths = new Map()
  walk(tree, (node) => {
    if (node.props?.className === 'buka-workflows-nodeWrap') {
      widths.set(textOf(node).trim(), Number.parseFloat(node.props.style?.width ?? '0'))
    }
  })
  assert.ok(
    (widths.get('研发') ?? 0) < (widths.get('发布审批') ?? 0),
    'node width follows the label instead of a fixed card width',
  )
  const text = texts.join(' ')
  for (const label of ['研发', '测试', '发布审批', '开始', '结束']) {
    assert.match(text, new RegExp(label, 'u'))
  }
  assert.match(text, /定义信息/u)
  assert.match(text, /点节点或通道查看详情/u)

  clickButton(tree, '研发')
  assert.equal(harness.updates.length, 1)
  assert.deepEqual(harness.updates[0].definitionSelection, { kind: 'position', id: 'dev' })

  const edgeHit = findBy(
    tree,
    (node) =>
      typeof node.props?.className === 'string' &&
      node.props.className.split(/\s+/).includes('buka-workflows-hitPath') &&
      typeof node.props?.onClick === 'function',
  )
  assert.ok(edgeHit !== null, 'channel hit area should be clickable')
  assert.equal(edgeHit.props['aria-label'], '开始研发', 'a channel carries its human label')
  assert.equal(typeof edgeHit.props.onMouseEnter, 'function', 'hovering a channel shows its label')
  edgeHit.props.onClick()
  assert.deepEqual(harness.updates[1].definitionSelection, {
    kind: 'channel',
    id: 'start.dev',
  })
})

test('定义结构：同一对节点的并行通道分别画线并显示标签', async () => {
  const client = await loadClient()
  const extra = {
    id: 'dev.qa.urgent',
    label: '加急提测',
    from: 'dev',
    to: 'qa',
    types: ['qa.verify'],
  }
  const parallel = {
    ...WORKFLOW_DETAIL,
    workflow: {
      ...WORKFLOW_DETAIL.workflow,
      definition: {
        ...DEFINITION,
        channels: [...DEFINITION.channels, extra],
      },
    },
    graph: {
      ...WORKFLOW_DETAIL.graph,
      channels: [...DEFINITION.channels, extra],
    },
  }
  const { texts, paths } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: parallel, error: null },
  })
  assert.equal(paths.length, DEFINITION.channels.length + 1, 'both parallel channels are drawn')
  assert.notEqual(paths[1], paths[5], 'parallel channels take different lanes')
  const text = texts.join(' ')
  assert.match(text, /提测/u)
  assert.match(text, /加急提测/u)
})

test('定义结构：节点头像来自打工人登记，而不是定义快照', async () => {
  const client = await loadClient()
  const graphPositions = WORKFLOW_DETAIL.graph.positions.map((position) =>
    position.id === 'dev'
      ? { ...position, executor: { ...position.executor, avatar: 'rocket' } }
      : position,
  )
  const { texts, classes } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: {
      status: 'ready',
      data: {
        ...WORKFLOW_DETAIL,
        graph: { ...WORKFLOW_DETAIL.graph, positions: graphPositions },
      },
      error: null,
    },
  })
  const text = texts.join(' ')
  assert.match(text, /🚀/u, 'the worker avatar is drawn on the node')
  assert.ok(classes.includes('buka-workflows-avatar'), 'avatar chip rendered')
})

test('定义抽屉：岗位任务类型与 schema 按需展开', async () => {
  const client = await loadClient()
  const { texts } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    definitionSelection: { kind: 'position', id: 'dev' },
  })
  const text = texts.join(' ')
  assert.match(text, /研发/u)
  assert.match(text, /打工人 · 软件工程师/u, 'executor identity lives in the drawer header')
  assert.match(text, /开发/u)
  assert.match(text, /实现功能/u)
  assert.match(text, /requirement/u, 'schema fields are listed')
  assert.doesNotMatch(text, /执行者:/u, 'the executor is no longer a loose key-value row')
  assert.doesNotMatch(text, /原始 schema/u, 'no raw schema dump')
})

test('作业概览：需求、结构化输入、最终交付物与启动信息', async () => {
  const client = await loadClient()
  const { texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    finalTask: { status: 'ready', data: FINAL_TASK.task, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /这次要做什么/u)
  assert.match(text, /实现登录页/u)
  assert.match(text, /结构化输入/u)
  assert.match(text, /需求说明/u)
  assert.match(text, /最终交付物/u)
  assert.match(text, /最终交付说明/u)
  assert.match(text, /启动信息/u)
  assert.match(text, /人（页面启动）/u)
  assert.match(text, /重试交付/u)
  assert.doesNotMatch(text, /排队 1/u, 'progress counts are not shown in overview')
  assert.doesNotMatch(text, /原始需求|原始结构化输入/u, 'readable sections replace raw JSON')
})

test('实时流程：节点聚合、待认领徽标、已走过的通道与点节点开任务', async () => {
  const client = await loadClient()
  const { tree, texts, classes } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'flow' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /待认领/u)
  assert.match(text, /1\/1/u, 'dev node shows one of one done')
  assert.ok(classes.includes('buka-workflows-nodeCorner'), 'live nodes show a task corner badge')
  assert.ok(classes.includes('is-taken'), 'traversed channels should be marked')
  assert.match(text, /点节点查看/u)

  clickButton(tree, '研发')
  assert.equal(harness.updates.length, 1)
  assert.equal(harness.updates[0].taskId, 'task-1', 'a single task opens its drawer directly')
})

test('看板：五列、岗位行（开始 / 结束合并为启动者）、卡片打开任务抽屉', async () => {
  const client = await loadClient()
  const { tree, texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
  })
  const text = texts.join(' ')
  for (const header of ['排队', '待认领', '进行中', '已完成', '异常']) {
    assert.match(text, new RegExp(header, 'u'), `board column ${header}`)
  }

  const rowTitle = (node) => {
    const className = node.props?.className
    return (
      typeof className === 'string' &&
      className.split(/\s+/).includes('buka-workflows-boardRowTitle')
    )
  }
  const titles = []
  walk(tree, (node) => {
    if (rowTitle(node)) titles.push(textOf(node))
  })
  assert.deepEqual(
    titles,
    ['启动者', '研发', '测试', '发布审批'],
    'start / end share one starter row',
  )

  const starterRow = findBy(
    tree,
    (node) =>
      typeof node.props?.className === 'string' &&
      node.props.className.split(/\s+/).includes('buka-workflows-boardRow') &&
      textOf(node).includes('启动者'),
  )
  assert.ok(starterRow !== null, 'the starter row should exist')
  assert.match(textOf(starterRow), /人（页面启动）/u, 'the row names the starter')
  assert.match(textOf(starterRow), /2 个任务/u, 'start and end tasks sit in the same row')

  assert.match(text, /开发/u)
  assert.match(text, /验证/u)
  assert.match(text, /软件工程师/u)

  clickButton(tree, '开发')
  assert.equal(harness.updates.length, 1)
  assert.equal(harness.updates[0].taskId, 'task-1')
})

test('任务抽屉：输入按契约、结果与操作', async () => {
  const client = await loadClient()
  const { texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    taskId: 'task-1',
    task: { status: 'ready', data: TASK_DETAIL.task, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /实现登录页/u, 'payload rendered')
  assert.doesNotMatch(text, /原始输入|原始产出/u, 'no raw JSON dumps')
  assert.match(text, /依赖/u)
  assert.match(text, /已结构化/u)
  assert.match(text, /执行记录/u)
  assert.match(text, /session-1/u)
  assert.match(text, /登录页已实现/u)
  assert.match(text, /trace\.zip/u)
  assert.match(text, /重试/u)
  assert.match(text, /取消任务/u)
  assert.match(text, /打开会话/u)
  assert.match(text, /研发 · 软件工程师/u, 'header carries position and claimant')
  assert.match(text, /更多信息/u, 'audit details are folded away')
})

test('节点任务抽屉：岗位身份、任务数与任务卡', async () => {
  const client = await loadClient()
  const { tree, texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'flow' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    nodeTasks: { positionId: 'qa', label: '测试' },
  })
  const text = texts.join(' ')
  assert.match(text, /测试 · 任务/u)
  assert.match(text, /1 个任务/u)
  assert.match(text, /打工人 · 质量保障工程师/u)

  clickButton(tree, '验证')
  assert.equal(harness.updates[0].taskId, 'task-2', 'the first task card opens its drawer')
})

test('只读值：没有 payload 契约时按字段逐行展示，不铺原始 JSON', async () => {
  const client = await loadClient()
  const definition = {
    ...DEFINITION,
    positions: DEFINITION.positions.map((position) =>
      position.id === 'dev'
        ? {
            ...position,
            taskTypes: position.taskTypes.map((type) => ({ ...type, payload: undefined })),
          }
        : position,
    ),
  }
  const { texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: {
      status: 'ready',
      data: { ...WORKFLOW_DETAIL, workflow: { ...WORKFLOW_DETAIL.workflow, definition } },
      error: null,
    },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    taskId: 'task-1',
    task: { status: 'ready', data: TASK_DETAIL.task, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /requirement/u, 'field names still carry the structure')
  assert.match(text, /实现登录页/u)
  assert.doesNotMatch(text, /"requirement"/u, 'no raw JSON dump')
})

test('人任务：按 output schema 渲染表单，提交走 task/action complete', async () => {
  const client = await loadClient()
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body })
    return new Response(JSON.stringify({ ok: true, task: { id: 'task-3', status: 'completed' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const { tree, texts } = render(client, {
      route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
      workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
      job: { status: 'ready', data: JOB_DETAIL, error: null },
      taskId: 'task-3',
      task: { status: 'ready', data: HUMAN_TASK_DETAIL.task, error: null },
      taskForm: { values: { approved: 'yes' }, text: '同意发布', error: null, submitting: false },
    })
    const text = texts.join(' ')
    assert.match(text, /填写结果/u)

    const approved = findBy(
      tree,
      (node) => node.props?.id === 'buka-workflows-task-task-3-approved',
    )
    assert.ok(approved !== null, 'approved enum field should render')
    assert.equal(approved.props.value, 'yes')

    clickButton(tree, '提交结果')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests.length, 1, 'complete should POST exactly once')
    assert.equal(requests[0].url, '/buka-workflows/task/action')
    const body = JSON.parse(requests[0].body)
    assert.equal(body.jobId, 'job-1')
    assert.equal(body.taskId, 'task-3')
    assert.equal(body.action, 'complete')
    assert.deepEqual(body.output, { approved: 'yes' })
    assert.equal(body.text, '同意发布')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('新建作业：需求在前、结构化输入按契约渲染', async () => {
  const client = await loadClient()
  const { tree } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    newJob: { open: true, raw: {}, structured: {}, error: null, submitting: false },
  })
  const raw = findBy(tree, (node) => node.props?.id === 'buka-workflows-newjob-raw-request')
  const structured = findBy(
    tree,
    (node) => node.props?.id === 'buka-workflows-newjob-structured-requirement',
  )
  assert.ok(raw !== null, 'raw input field should render from start.task.payload')
  assert.ok(structured !== null, 'structured field should render from start.task.output')
  const submit = findBy(
    tree,
    (node) => typeof node.props?.onClick === 'function' && textOf(node).includes('启动作业'),
  )
  assert.ok(submit !== null, 'submit button should render')
})

test('资产：资产池按来源任务分组，最终交付物带标记', async () => {
  const client = await loadClient()
  const { texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'outputs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    attachments: {
      status: 'ready',
      data: [
        {
          id: 'att-file-1',
          name: 'trace.zip',
          bytes: 2048,
          mime: 'application/zip',
          description: '失败用例 trace',
          sourceTaskId: 'task-1',
          sourcePositionId: 'dev',
          createdBy: '软件工程师',
          createdAt: '2026-11-12T10:03:00.000Z',
        },
        {
          id: 'att-file-2',
          name: 'delivery.md',
          bytes: 1024,
          mime: 'text/markdown',
          sourceTaskId: 'task-4',
          sourcePositionId: 'end',
          createdAt: '2026-11-12T10:04:00.000Z',
        },
      ],
      error: null,
    },
  })
  const text = texts.join(' ')
  assert.match(text, /trace\.zip/u)
  assert.match(text, /失败用例 trace/u)
  assert.match(text, /2\.0 KiB/u)
  assert.match(text, /delivery\.md/u)
  assert.match(text, /最终/u)
  assert.match(text, /产出者/u)
})
