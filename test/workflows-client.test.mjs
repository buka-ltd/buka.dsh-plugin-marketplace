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

import { toV8 } from './workflows-fixture-v7.mjs'

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

/** 找出定义 / 任务抽屉的根元素，断言只看抽屉里的内容。 */
function drawerOf(tree) {
  return findBy(
    tree,
    (node) =>
      typeof node.props?.className === 'string' &&
      node.props.className.split(/\s+/).includes('buka-workflows-drawer'),
  )
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
const DEFINITION = toV8({
  version: 6,
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
      prompt: '负责实现与返工',
      executor: { kind: 'worker', name: '软件工程师' },
      taskTypes: [
        {
          id: 'dev.implement',
          label: '开发',
          prompt: '实现功能',
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
          assistant: 'secretary',
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
})
DEFINITION.positions[2].taskTypes[0].actions = [
  {
    id: 'approve',
    label: '批准',
    input: {
      type: 'object',
      properties: {
        approved: { type: 'string', enum: ['yes', 'no'] },
        note: { type: 'string' },
      },
      required: ['approved'],
    },
    creates: [{ channel: 'approve.end', content: { summary: '批准发布' } }],
  },
]

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
  assistants: [{ id: 'secretary', name: '沟通助理', avatar: 'panda' }],
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
    input: { requirement: '实现登录页', acceptance: '可以登录' },
    delivery: { kind: 'starter' },
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
    content: { summary: '最终交付说明' },
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
    channel: 'start.dev',
    channelLabel: '开始研发',
    status: 'running',
    content: { requirement: '实现登录页' },
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
    status: 'running',
    content: { summary: '发布说明' },
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
        {
          id: 'wf-3',
          name: '旧格式',
          version: 4,
          definitionVersion: 7,
          status: 'active',
          jobCount: 0,
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
  assert.match(text, /待升级/u, 'definition version 7 is not the current v8')
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

test('结构图：画通道、点节点打开抽屉、点通道记录选中', async () => {
  const client = await loadClient()
  const { tree, texts, paths, classes } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  assert.equal(paths.length, DEFINITION.channels.length, 'every defined channel should be drawn')
  assert.ok(classes.includes('is-graph'), 'the structure view fills the body height')
  assert.ok(classes.includes('buka-workflows-graphFooter'), 'the legend sits in the pinned footer')
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

test('结构图：同一对节点的并行通道分别画线并显示标签', async () => {
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

test('结构图：节点头像来自打工人登记，而不是定义快照', async () => {
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
  const { tree, texts, classes } = render(client, {
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
  assert.ok(classes.includes('buka-workflows-typeCard'), 'task types render as cards')
  assert.match(text, /可处理的任务类型/u, 'the heading names the position’s task types explicitly')
  const drawer = drawerOf(tree)
  assert.ok(drawer !== null, 'the definition drawer renders')
  assert.doesNotMatch(
    textOf(drawer),
    /通道/u,
    'channels are inspected on the edge, not on the node',
  )
  assert.doesNotMatch(text, /执行者:/u, 'the executor is no longer a loose key-value row')
  assert.doesNotMatch(text, /原始 schema/u, 'no raw schema dump')
})

test('定义抽屉：机器人任务类型显示完成后创建', async () => {
  const client = await loadClient()
  const definition = {
    ...DEFINITION,
    positions: DEFINITION.positions.map((position) =>
      position.id === 'dev'
        ? {
            ...position,
            executor: { kind: 'worker', name: 'clock', driver: 'robot' },
            taskTypes: position.taskTypes.map((type) => ({
              ...type,
              creates: [{ channel: 'dev.qa', type: 'qa.verify', content: {} }],
            })),
          }
        : position,
    ),
  }
  const { tree } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: {
      status: 'ready',
      data: { ...WORKFLOW_DETAIL, workflow: { ...WORKFLOW_DETAIL.workflow, definition } },
      error: null,
    },
    definitionSelection: { kind: 'position', id: 'dev' },
  })
  const drawer = drawerOf(tree)
  assert.ok(drawer !== null, 'the definition drawer renders')
  const text = textOf(drawer)
  assert.match(text, /完成后创建/u, 'the creates row is labelled')
  assert.match(text, /验证/u, 'the created task type label is shown')
  assert.match(text, /提测/u, 'the channel label is shown')
})

test('定义抽屉：通道显示发送方、接收方与允许的任务类型', async () => {
  const client = await loadClient()
  const { tree } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    definitionSelection: { kind: 'channel', id: 'qa.dev.rework' },
  })
  const drawer = drawerOf(tree)
  assert.ok(drawer !== null, 'the channel drawer renders')
  const text = textOf(drawer)
  assert.match(text, /返工/u, 'the channel label is the drawer title')
  assert.match(text, /qa\.dev\.rework/u, 'the channel id sits in the drawer header')
  assert.match(text, /回向通道/u, 'a back channel is marked')
  assert.match(text, /发送方/u)
  assert.match(text, /接收方/u)
  assert.match(text, /测试/u, 'the sender is the source position')
  assert.match(text, /研发/u, 'the receiver is the target position')
  assert.match(text, /打工人 · 质量保障工程师/u, 'the sender executor is shown')
  assert.match(text, /允许的任务类型/u)
  assert.match(text, /开发/u, 'the allowed task type is listed')
})

test('客户端展示：执行者与助理显示「展示名 · 标识符」', async () => {
  const client = await loadClient()
  const graphPositions = WORKFLOW_DETAIL.graph.positions.map((position) =>
    position.id === 'qa'
      ? { ...position, executor: { kind: 'worker', id: 'qa-engineer', name: '质量保障工程师' } }
      : position,
  )
  const withGraph = {
    ...WORKFLOW_DETAIL,
    graph: { ...WORKFLOW_DETAIL.graph, positions: graphPositions },
  }
  const { texts } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: withGraph, error: null },
    definitionSelection: { kind: 'position', id: 'qa' },
  })
  const text = texts.join(' ')
  assert.match(
    text,
    /打工人 · 质量保障工程师 · qa-engineer/u,
    'executor shows display name and identifier',
  )

  const approve = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: withGraph, error: null },
    definitionSelection: { kind: 'position', id: 'approve' },
  })
  assert.match(
    approve.texts.join(' '),
    /助理 · 沟通助理 · secretary/u,
    'assistant shows display name and identifier',
  )
})

test('作业列表：v7 快照带「旧版本」标记，但仍可打开', async () => {
  const client = await loadClient()
  const workflow = {
    ...WORKFLOW_DETAIL,
    jobs: [{ ...WORKFLOW_DETAIL.jobs[0], definitionVersion: 7 }],
  }
  const { tree, texts, classes } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: workflow, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /旧版本/u)
  assert.ok(!classes.includes('is-disabled'), 'a v7 job stays openable')

  clickButton(tree, '作业 #7')
  assert.equal(harness.updates[0].route.kind, 'job')
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
  assert.match(text, /实现登录页/u)
  assert.match(text, /需求说明/u)
  assert.match(text, /最终交付物/u)
  assert.match(text, /最终交付说明/u)
  assert.match(text, /启动信息/u)
  assert.match(text, /人（页面启动）/u)
  assert.match(text, /重试交付/u)
  assert.doesNotMatch(text, /排队 1/u, 'progress counts are not shown in overview')
  assert.doesNotMatch(text, /原始需求|原始结构化输入/u, 'readable sections replace raw JSON')
})

test('重启作业：失败作业显示入口、重启次数与来源作业，非失败作业没有入口', async () => {
  const client = await loadClient()
  const restartedJob = {
    ...JOB_DETAIL,
    job: {
      ...JOB_DETAIL.job,
      status: 'failed',
      error: 'delegated task failed',
      restartCount: 2,
      restartedFrom: 'job-0',
    },
    restart: { failed: { available: true }, scratch: { available: true } },
  }
  const workflow = {
    ...WORKFLOW_DETAIL,
    jobs: [
      ...WORKFLOW_DETAIL.jobs,
      { id: 'job-0', seq: 3, status: 'failed', inputSummary: '最早的作业' },
    ],
  }
  const { tree, texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: workflow, error: null },
    job: { status: 'ready', data: restartedJob, error: null },
    finalTask: { status: 'ready', data: FINAL_TASK.task, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /重启作业/u)
  assert.match(text, /重启次数/u)
  assert.match(text, /来源作业/u)
  assert.match(text, /作业 #3/u, 'the source job is shown by its sequence')

  clickButton(tree, '重启作业')
  assert.equal(harness.updates[0].restart.open, true, 'the entry opens the restart dialog')

  clickButton(tree, '打开来源作业')
  assert.equal(harness.updates.at(-1).route.jobId, 'job-0', 'the source job is reachable')

  const completed = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: {
      status: 'ready',
      data: { ...JOB_DETAIL, job: { ...JOB_DETAIL.job, status: 'completed' } },
      error: null,
    },
  })
  assert.doesNotMatch(
    completed.texts.join(' '),
    /重启作业/u,
    'completed jobs have no restart entry',
  )
})

test('重启作业：两个选项按服务端可用性置灰并显示原因', async () => {
  const client = await loadClient()
  const failedJob = {
    ...JOB_DETAIL,
    job: { ...JOB_DETAIL.job, status: 'failed', error: 'delegated task failed' },
    tasks: [
      { ...JOB_DETAIL.tasks[1], status: 'failed' },
      { ...JOB_DETAIL.tasks[2], status: 'cancelled' },
      ...JOB_DETAIL.tasks,
    ],
    restart: {
      failed: { available: false, reason: 'no-failed-tasks' },
      scratch: { available: true },
    },
  }
  const { tree, texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: failedJob, error: null },
    restart: { open: true, submitting: false, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /从失败位置开始/u)
  assert.match(text, /从头开始/u)
  assert.match(
    text,
    /会重新派发的失败任务/u,
    'the dialog names the task that will be re-dispatched',
  )
  assert.match(text, /这个作业没有失败任务/u, 'the server reason is shown')

  const fromFailed = findBy(
    tree,
    (node) => node.type === 'button' && textOf(node) === '从失败位置开始',
  )
  assert.ok(fromFailed !== null, 'the resume option renders')
  assert.equal(fromFailed.props.disabled, true, 'an unavailable option is disabled')

  const scratch = findBy(tree, (node) => node.type === 'button' && textOf(node) === '从头开始')
  assert.ok(scratch !== null, 'the start-over option renders')
  assert.equal(scratch.props.disabled, false, 'an available option stays clickable')
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
  assert.ok(classes.includes('is-graph'), 'the live flow fills the body height')
  assert.ok(classes.includes('buka-workflows-graphFooter'), 'the legend sits in the pinned footer')
  assert.match(text, /点节点查看/u)

  clickButton(tree, '研发')
  assert.equal(harness.updates.length, 1)
  assert.equal(harness.updates[0].taskId, 'task-1', 'a single task opens its drawer directly')
})

test('看板：五列、岗位行（开始 / 结束合并为发起人）、卡片打开任务抽屉', async () => {
  const client = await loadClient()
  const { tree, texts, classes } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
  })
  const text = texts.join(' ')
  for (const header of ['排队', '待认领', '进行中', '已完成', '异常']) {
    assert.match(text, new RegExp(header, 'u'), `board column ${header}`)
  }
  assert.equal(
    classes.filter((name) => name === 'buka-workflows-boardDivider').length,
    3,
    '四行之间各有一条分割虚线',
  )

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
    ['发起人', '研发', '测试', '发布审批'],
    'start / end share one starter row',
  )

  const starterRow = findBy(
    tree,
    (node) =>
      typeof node.props?.className === 'string' &&
      node.props.className.split(/\s+/).includes('buka-workflows-boardRow') &&
      textOf(node).includes('发起人'),
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
  assert.match(text, /研发/u, 'header carries the position')
  assert.match(text, /通道: 开始研发/u, 'header carries the inbound channel')
  assert.match(text, /软件工程师/u, 'worker tasks show only the executor')
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

test('只读值：没有任务内容契约时按字段逐行展示，不铺原始 JSON', async () => {
  const client = await loadClient()
  const definition = {
    ...DEFINITION,
    positions: DEFINITION.positions.map((position) =>
      position.id === 'dev'
        ? {
            ...position,
            taskTypes: position.taskTypes.map((type) => ({ ...type, content: undefined })),
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

test('人任务：选动作、按动作表单填写，提交走 task/action complete', async () => {
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
      taskForm: {
        action: 'approve',
        values: { approved: 'yes' },
        text: '同意发布',
        error: null,
        submitting: false,
      },
    })
    const text = texts.join(' ')
    assert.match(text, /接下来做什么/u)
    assert.match(
      text,
      /代办: 沟通助理 · secretary/u,
      'delegation names the assistant by name and id',
    )

    const approved = findBy(
      tree,
      (node) => node.props?.id === 'buka-workflows-task-task-3-approved',
    )
    assert.ok(approved !== null, 'approved enum field should render')
    assert.equal(approved.props.value, 'yes')

    clickButton(tree, '执行这个动作')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests.length, 1, 'complete should POST exactly once')
    assert.equal(requests[0].url, '/buka-workflows/task/action')
    const body = JSON.parse(requests[0].body)
    assert.equal(body.jobId, 'job-1')
    assert.equal(body.taskId, 'task-3')
    assert.equal(body.action, 'complete')
    assert.equal(body.selectedAction, 'approve')
    assert.deepEqual(body.input, { approved: 'yes' })
    assert.equal(body.text, '同意发布')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('人任务与打工人任务：只显示代办 / 待你办理 / 你在办理或执行者', async () => {
  const client = await loadClient()
  const definition = {
    ...DEFINITION,
    positions: DEFINITION.positions.map((position) =>
      position.id === 'approve'
        ? {
            ...position,
            taskTypes: position.taskTypes.map((type) => {
              const next = { ...type }
              delete next.assistant
              return next
            }),
          }
        : position,
    ),
  }
  const workflow = {
    ...WORKFLOW_DETAIL,
    workflow: { ...WORKFLOW_DETAIL.workflow, definition },
  }

  // 人任务没有点名助理且已就绪：待你办理。
  let rendered = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: workflow, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
  })
  assert.match(rendered.texts.join(' '), /待你办理/u)
  assert.doesNotMatch(rendered.texts.join(' '), /承办者/u)

  // 人任务在进行中：你在办理。
  const humanTask = {
    ...HUMAN_TASK_DETAIL.task,
    claimant: { kind: 'human', name: '本地用户', sessionId: null },
  }
  rendered = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: workflow, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    taskId: 'task-3',
    task: { status: 'ready', data: humanTask, error: null },
  })
  assert.match(rendered.texts.join(' '), /你在办理/u)
  assert.doesNotMatch(rendered.texts.join(' '), /承办者/u)

  // 打工人任务只显示执行者，不出现代办 / 承办者。
  rendered = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: workflow, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    taskId: 'task-1',
    task: { status: 'ready', data: TASK_DETAIL.task, error: null },
  })
  const workerText = rendered.texts.join(' ')
  assert.match(workerText, /软件工程师/u)
  assert.doesNotMatch(workerText, /承办者|代办/u)
})

test('新建作业：需求在前、结构化输入按契约渲染', async () => {
  const client = await loadClient()
  const { tree } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    newJob: { open: true, content: {}, delivery: 'starter', error: null, submitting: false },
  })
  const requirement = findBy(
    tree,
    (node) => node.props?.id === 'buka-workflows-newjob-content-requirement',
  )
  assert.ok(requirement !== null, 'the start content schema renders the job input form')
  const assistantOption = findBy(
    tree,
    (node) => node.type === 'option' && node.props?.value === 'assistant:secretary',
  )
  assert.ok(
    assistantOption !== null,
    'the delivery option uses the assistant identifier as its value',
  )
  assert.equal(textOf(assistantOption), '交给我的助理 · 沟通助理 · secretary')
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

test('派生不可用：工作流列表 / 详情标出缺失的标识符，新建作业禁用', async () => {
  const client = await loadClient()
  const missing = [
    {
      id: '软件工程师',
      role: 'executor',
      positionId: 'dev',
      positionLabel: '研发',
    },
  ]
  const unavailableDefinition = {
    ...DEFINITION,
    positions: DEFINITION.positions.map((position) =>
      position.id === 'dev'
        ? { ...position, executor: { ...position.executor, missing: true } }
        : position,
    ),
  }
  const unavailableDetail = {
    ...WORKFLOW_DETAIL,
    workflow: {
      ...WORKFLOW_DETAIL.workflow,
      definition: unavailableDefinition,
      availability: { available: false, missingWorkers: missing },
    },
    graph: {
      ...WORKFLOW_DETAIL.graph,
      positions: WORKFLOW_DETAIL.graph.positions.map((position) =>
        position.id === 'dev'
          ? { ...position, executor: { ...position.executor, missing: true } }
          : position,
      ),
    },
  }

  // 列表：不可用的工作流带「不可用」标签与缺失说明。
  const list = render(client, {
    route: { kind: 'workflows' },
    workflows: {
      status: 'ready',
      error: null,
      data: [
        {
          id: 'wf-1',
          name: '研发交付',
          status: 'active',
          version: 3,
          jobCount: 1,
          availability: { available: false, missingWorkers: missing },
        },
      ],
    },
  })
  assert.ok(list.texts.includes('不可用'), 'list marks the workflow unavailable')
  assert.match(
    list.texts.join(' '),
    /岗位「研发」引用的打工人标识符「软件工程师」已不存在/u,
    'the list names the missing identifier',
  )

  // 详情：提示条列出缺口，新建作业按钮禁用。
  const { tree, texts } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflows: { status: 'ready', error: null, data: [] },
    workflow: { status: 'ready', data: unavailableDetail, error: null },
  })
  const text = texts.join(' ')
  assert.ok(text.includes('不可用'), 'the detail keeps an unavailable tag')
  assert.match(text, /岗位「研发」引用的打工人标识符「软件工程师」已不存在/u)
  const newJob = findBy(tree, (node) => node.type === 'button' && textOf(node) === '新建作业')
  assert.ok(newJob, 'the new job button still renders')
  assert.equal(newJob.props.disabled, true, 'starting a job is blocked while unavailable')
})

test('派生不可用：作业页标注，执行者与交回助理显示「已删除」与占位头像', async () => {
  const client = await loadClient()
  const missing = [
    { id: '软件工程师', role: 'executor', positionId: 'dev', positionLabel: '研发' },
    { id: 'secretary', role: 'delivery' },
  ]
  const job = {
    ...JOB_DETAIL,
    job: {
      ...JOB_DETAIL.job,
      delivery: { kind: 'assistant', id: 'secretary', name: '沟通助理', missing: true },
    },
    definition: {
      ...JOB_DETAIL.definition,
      positions: JOB_DETAIL.definition.positions.map((position) =>
        position.id === 'dev'
          ? { ...position, executor: { ...position.executor, missing: true } }
          : position,
      ),
    },
    availability: { available: false, missingWorkers: missing },
  }
  const { tree, texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: job, error: null },
    taskId: 'task-1',
    task: { status: 'ready', data: TASK_DETAIL.task, error: null },
  })
  const text = texts.join(' ')
  assert.ok(text.includes('不可用'), 'the job page marks the job unavailable')
  assert.match(text, /岗位「研发」引用的打工人标识符「软件工程师」已不存在/u)
  assert.match(text, /交回方式里的助理「secretary」已不存在/u)
  assert.match(text, /软件工程师 · 已删除/u, 'the executor is marked deleted')
  assert.match(text, /沟通助理 · secretary · 已删除/u, 'the delivery assistant is marked deleted')
  assert.ok(
    findBy(tree, (node) =>
      String(node.props?.className ?? '')
        .split(/\s+/)
        .includes('buka-workflows-avatarMissing'),
    ) !== null,
    'the deleted worker gets a placeholder avatar',
  )
})
