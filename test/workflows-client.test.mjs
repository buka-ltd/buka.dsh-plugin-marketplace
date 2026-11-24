/**
 * @buka/dsh-plugin-workflows 浏览器一半的渲染冒烟测试。
 *
 * 页面源码是 TypeScript（Node 24 默认做类型剥离），这里用 `module.registerHooks`
 * 把 `react` 与 DSH 的界面基座替换成最小桩，再直接调用注册到 `main` 的页面
 * 组件：工作流列表 / 工作流页（作业 / 结构图 / 任务类型）/ 作业四视图 / 任务抽屉 / 新建作业
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

import { toV9 } from './workflows-fixture-v7.mjs'

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
export const Menu = (props) => h('span', { className: 'x-menu' }, props.anchor)
export const MarkdownText = (props) => h('span', { className: 'x-markdown' }, props.text)
export const CodeBlock = () => null
export const FileTypeIcon = () => null
export const ReadBlock = () => null
export const languageForPath = () => ''
export const IconChevronRightOutlineRegular = () => null
export const IconChevronDownOutlineRegular = () => null
export const IconCloseOutlineRegular = () => null
export const IconRefreshOutlineRegular = () => null
export const IconWarningOutlineRegular = () => null
export const IconInfoOutlineRegular = () => null
export const IconDownloadOutlineRegular = () => null
export const IconNewChatOutlineRegular = () => null
export const IconFolderOpenOutlineRegular = () => null
export const IconSettingsOutlineRegular = () => null
export const IconEditOutlineRegular = () => null
export const IconPlusOutlineRegular = () => null
export const IconTrashOutlineRegular = () => null
export const Tooltip = (props) => h('span', props, ...(props.children ?? []))
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
    baseURI: 'http://localhost/',
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
  const workersI18n = await import(
    `${pathToFileURL(path.join(CLIENT_DIR, 'workers/i18n.ts')).href}${suffix}`
  )
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
        // 合并后的 client 只注册一个首页（两个页签）；按 key 存下来供测试取。
        if (options.name === 'main') components[options.key] = component
        return () => {}
      },
    },
  })
  assert.equal(
    typeof components['buka-workflows'],
    'function',
    'client should register the workflows main page component',
  )
  return {
    Page: components['buka-workflows'],
    zh: i18n.zh,
    workersZh: workersI18n.zh,
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
    // 函数组件只展开一次并缓存：首页包裹了页面组件，同一棵树被反复遍历时
    // 不能再消费页面内部的 useState（第二次展开会越界回落到初值）。
    if (node.__walkExpanded === undefined) {
      node.__walkExpanded = node.type({ ...node.props, children: node.children })
    }
    walk(node.__walkExpanded, visit)
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
  const nodes = []
  walk(tree, (node) => {
    nodes.push(node)
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
  return { texts, classes, paths, nodes }
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

/**
 * 渲染一次页面。
 *
 * @param client loadClient() 的返回值
 * @param patch 覆盖初始页面状态
 * @param options sessionStatus：注入的会话状态快照（按 sessionId 索引）
 */
function render(client, patch, options = {}) {
  const state = { ...client.createInitialState(), ...patch }
  // 首页（HomePage）的页签 useState 占第 0 位，工作流页状态从第 1 位开始。
  harness.queue = ['workflow', state]
  harness.index = 0
  harness.updates = []
  const t = (key) => client.zh[key] ?? key
  const workersT = (key) => client.workersZh[key] ?? key
  const sessionStatus = options.sessionStatus
  const tree = client.Page({
    t,
    workersT,
    getService: () => null,
    // 不注入时走页面自己的空快照 fallback；注入时模拟 `main` 插槽的会话状态钩子。
    ...(sessionStatus === undefined
      ? {}
      : { useSessionStatus: (selector) => selector(sessionStatus) }),
  })
  const collected = collect(tree)
  return { tree, ...collected, state }
}

/** 工作流定义。 */
const DEFINITION = toV9({
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

/** 执行者任务详情。 */
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

test('首页：顶部两个页签，默认 Workflow，切到 Worker 更新页签状态', async () => {
  const client = await loadClient()
  const { tree, texts } = render(client, {
    workflows: { status: 'ready', data: [], error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /工作流/u, 'the Workflow tab renders first')
  assert.match(text, /执行者/u, 'the Worker tab renders second')
  assert.ok(text.indexOf('工作流') < text.indexOf('执行者'), 'Workflow tab comes first')

  // 列表页不再重复「工作流」大标题：首页页签已经是标题。
  assert.equal(
    findBy(tree, (node) => node.type === 'h1'),
    null,
    'the workflow list no longer renders a duplicate h1 title',
  )
  // 页签栏左对齐（不再居中）。
  assert.doesNotMatch(
    client.css(),
    /\.buka-workflows-homeTabs\{[^}]*justify-content:center/u,
    'the home tab bar is left-aligned',
  )
  // 内容区进入动画只做透明度：它在滚动容器里，translate 会临时撑大
  // scrollable overflow，从执行者页切过来时右侧会闪一条滚动条。
  assert.doesNotMatch(
    client.css(),
    /@keyframes buka-enter\{[^}]*transform/u,
    'the page enter animation must not transform content inside the scroll container',
  )

  // 首页页签栏是树里唯一的 SegmentedTabs（列表页没有页内页签）。
  const tabBar = findBy(
    tree,
    (node) =>
      typeof node.props?.onChange === 'function' &&
      Array.isArray(node.props?.items) &&
      node.props.items.length === 2,
  )
  assert.ok(tabBar !== null, 'the home tab bar should render')
  assert.deepEqual(
    tabBar.props.items.map((item) => item.value),
    ['workflow', 'worker'],
    'tab values are workflow then worker',
  )
  assert.equal(tabBar.props.value, 'workflow', 'the home defaults to the Workflow tab')
  assert.equal(tabBar.props.label, '主视图', 'the tab bar carries its accessible name')

  tabBar.props.onChange('worker')
  assert.equal(harness.updates.length, 1)
  assert.equal(harness.updates[0], 'worker', 'selecting the Worker tab updates the home tab')
})

test('详情页独立页头：不再渲染首页顶部的「工作流 / 执行者」页签', async () => {
  const client = await loadClient()
  const tabValues = (node) =>
    Array.isArray(node.props?.items) ? node.props.items.map((item) => item.value) : null
  const homeTabs = (node) => {
    const values = tabValues(node)
    return values !== null && values.join(',') === 'workflow,worker'
  }

  // 工作流详情：标题 + 操作一行，页内「作业 / 结构图 / 任务类型」页签单独一行。
  const workflowPage = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  assert.equal(findBy(workflowPage.tree, homeTabs), null, '工作流详情不显示首页页签')
  const workflowTabs = findBy(
    workflowPage.tree,
    (node) => (tabValues(node) ?? []).join(',') === 'jobs,definition,types',
  )
  assert.ok(workflowTabs !== null, '工作流详情保留页内页签')
  assert.ok(workflowPage.texts.includes('研发交付'), '详情标题仍在')
  assert.ok(workflowPage.texts.includes('新建作业'), '详情操作仍在')

  // 作业详情同理：首页页签消失，作业自己的四个视图页签保留。
  const jobPage = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    finalTask: { status: 'ready', data: FINAL_TASK.task, error: null },
  })
  assert.equal(findBy(jobPage.tree, homeTabs), null, '作业详情不显示首页页签')
  const jobTabs = findBy(
    jobPage.tree,
    (node) => (tabValues(node) ?? []).join(',') === 'overview,flow,board,outputs',
  )
  assert.ok(jobTabs !== null, '作业详情保留页内页签')
})

test('工作流详情：停用直接在工具栏里，不再藏进「更多」菜单', async () => {
  const client = await loadClient()
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  /** 工具栏里的按钮文案。 */
  const toolbarButtons = (tree) => {
    const toolbar = findBy(
      tree,
      (node) =>
        typeof node.props?.className === 'string' &&
        node.props.className.split(/\s+/).includes('buka-workflows-toolbar'),
    )
    assert.ok(toolbar !== null, 'the workflow toolbar should render')
    return collect(toolbar)
      .nodes.filter((node) => node.type === 'button')
      .map((node) => textOf(node))
  }

  try {
    const active = render(client, {
      route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
      workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    })
    assert.deepEqual(toolbarButtons(active.tree), ['新建作业', '刷新', '停用'])
    assert.equal(
      findBy(active.tree, (node) => node.type === 'details' || node.type === 'summary'),
      null,
      'the More dropdown is gone',
    )
    assert.ok(!active.texts.includes('更多'), 'no More label is rendered')

    clickButton(active.tree, '停用')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests.length, 1, 'disable posts exactly once')
    assert.equal(requests[0].url, '/buka-workflows/workflow/activate')
    assert.deepEqual(JSON.parse(requests[0].body), { id: 'wf-1', active: false })

    // 已停用的工作流只给「重新启用」，工具栏里不再出现停用。
    const retired = render(client, {
      route: { kind: 'workflow', workflowId: 'wf-2', tab: 'jobs' },
      workflow: {
        status: 'ready',
        data: {
          ...WORKFLOW_DETAIL,
          workflow: { ...WORKFLOW_DETAIL.workflow, id: 'wf-2', status: 'retired' },
        },
        error: null,
      },
    })
    assert.deepEqual(toolbarButtons(retired.tree), ['重新启用', '刷新'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('详情页页内页签：工作流与作业都沿用执行者详情的下划线样式', async () => {
  const client = await loadClient()
  const roleTabs = (tree) => collect(tree).nodes.filter((node) => node.props?.role === 'tab')
  const underline = (tab) => String(tab.props?.className ?? '').includes('buka-workflows-detailTab')

  const workflowPage = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  const workflowTabs = roleTabs(workflowPage.tree)
  assert.deepEqual(
    workflowTabs.map((node) => textOf(node)),
    ['作业', '结构图', '任务类型'],
  )
  assert.ok(workflowTabs.every(underline), '工作流详情用下划线页签，而不是胶囊分段控件')
  assert.deepEqual(
    workflowTabs.map((node) => node.props?.['aria-selected']),
    [true, false, false],
  )
  assert.deepEqual(
    workflowTabs.map((node) => node.props?.tabIndex),
    [0, -1, -1],
    '只有选中页签是 Tab 停靠点',
  )

  const jobPage = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'overview' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    finalTask: { status: 'ready', data: FINAL_TASK.task, error: null },
  })
  const jobTabs = roleTabs(jobPage.tree)
  assert.deepEqual(
    jobTabs.map((node) => textOf(node)),
    ['概览', '实时流程', '看板', '资产'],
  )
  assert.ok(jobTabs.every(underline), '作业详情与工作流详情保持同一种页签样式')
  assert.equal(jobTabs[0].props?.['aria-selected'], true)
})

test('任务类型：左列表右详情，展示全部任务类型与契约', async () => {
  const client = await loadClient()

  // 从作业页签点「任务类型」：路由切到 types。
  const jobs = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'jobs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  const typesTab = findBy(
    jobs.tree,
    (node) => node.props?.role === 'tab' && textOf(node) === '任务类型',
  )
  assert.ok(typesTab !== null, '任务类型 是页内页签')
  typesTab.props.onClick()
  assert.equal(harness.updates.length, 1)
  assert.equal(harness.updates[0].route.tab, 'types')

  const base = {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'types' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  }
  const types = render(client, { ...base, taskTypeSelection: null })
  const text = types.texts.join(' ')
  const classCount = (name) =>
    collect(types.tree).nodes.filter((node) =>
      String(node.props?.className ?? '')
        .split(/\s+/)
        .includes(name),
    ).length
  const items = collect(types.tree).nodes.filter(
    (node) =>
      node.type === 'button' &&
      String(node.props?.className ?? '')
        .split(/\s+/)
        .includes('buka-workflows-typesItem'),
  )

  // 左侧：内建开始 / 结束 + 每个岗位声明的任务类型。
  assert.equal(items.length, 5, 'one list item per task type')
  for (const label of ['开始任务', '结束任务', '开发', '验证', '批准发布']) {
    assert.ok(
      items.some((item) => textOf(item).includes(label)),
      `list has ${label}`,
    )
  }
  assert.equal(classCount('buka-workflows-typesGroupLabel'), 0, 'the list is not split into groups')
  const selected = items.filter((item) =>
    String(item.props?.className ?? '')
      .split(/\s+/)
      .includes('is-selected'),
  )
  assert.equal(selected.length, 1, 'exactly one task type is selected')
  assert.ok(textOf(selected[0]).includes('开始任务'), 'the first item is selected by default')
  assert.equal(selected[0].props?.['aria-current'], 'true', 'the selected item is announced')

  // 默认选中开始任务：右侧展示作业输入契约与初始任务。
  assert.match(text, /作业输入/u)
  assert.match(text, /需求说明/u, 'start content schema fields are shown')
  assert.match(text, /初始任务/u)
  assert.match(text, /创建带任务内容的任务/u)
  assert.match(text, /引擎/u, 'the engine handles the start task')

  // 列表是两栏视图，不画图、不弹抽屉，也不再有旧的「定义信息」摘要。
  assert.ok(types.classes.includes('is-types'), 'the types tab uses the two-pane layout')
  assert.ok(!types.classes.includes('is-graph'), 'the types tab is not a graph view')
  assert.deepEqual(types.paths, [], 'the types tab draws no graph')
  assert.equal(drawerOf(types.tree), null, 'the types tab opens no drawer')
  assert.equal(classCount('buka-workflows-infoPosition'), 0, 'the definition-info summary is gone')
  assert.equal(classCount('buka-workflows-typeCard'), 0, 'the list is not made of cards')

  // 点「开发」：选中项写回页面状态，右侧换成该任务类型的详情。
  const devItem = items.find((item) => textOf(item).includes('开发'))
  assert.ok(devItem !== undefined, 'the dev task type is selectable')
  devItem.props.onClick()
  assert.equal(harness.updates[0].taskTypeSelection, 'dev/dev.implement')

  const dev = render(client, { ...base, taskTypeSelection: 'dev/dev.implement' })
  const devText = dev.texts.join(' ')
  const devSelected = collect(dev.tree).nodes.filter((node) =>
    String(node.props?.className ?? '')
      .split(/\s+/)
      .includes('is-selected'),
  )
  assert.equal(devSelected.length, 1, 'the selected task type stays highlighted')
  assert.ok(textOf(devSelected[0]).includes('开发'), 'the dev item is highlighted')
  assert.match(devText, /所属岗位/u)
  assert.match(devText, /研发/u)
  assert.match(devText, /执行者 · 软件工程师/u)
  assert.match(devText, /定义/u)
  assert.match(devText, /实现功能/u, 'the task type definition template is shown')
  assert.match(devText, /requirement/u, 'the content schema is shown')
  assert.ok(!devText.includes('表单'), 'the dev task type declares no actions')

  // 人任务类型：动作、表单与完成后创建都要在详情里展开。
  const approve = render(client, { ...base, taskTypeSelection: 'approve/approve.release' })
  const approveText = approve.texts.join(' ')
  assert.match(approveText, /助理 · 沟通助理/u)
  assert.match(approveText, /动作/u)
  assert.match(approveText, /批准/u)
  assert.match(approveText, /表单/u)
  assert.match(approveText, /approved/u, 'the action form schema is shown')
  assert.match(approveText, /创建任务/u)
  assert.match(approveText, /结束任务 · 交付/u)

  // 结束任务是内建类型：详情给最终报告契约与处理人。
  const end = render(client, { ...base, taskTypeSelection: 'end' })
  const endText = end.texts.join(' ')
  assert.match(endText, /最终报告/u)
  assert.match(endText, /发起人（或作业指定的交付助理）/u)
  assert.match(endText, /summary/u, 'the final report schema is shown')
})

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
  assert.match(text, /待升级/u, 'definition version 7 is not the current v9')
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
  const graphPane = findBy(
    tree,
    (node) =>
      typeof node.props?.className === 'string' &&
      node.props.className.split(/\s+/).includes('buka-workflows-definitionPane'),
  )
  assert.ok(graphPane !== null, 'the structure view renders')
  assert.doesNotMatch(textOf(graphPane), /任务类型/u, '任务类型是页面页签，不再占结构图顶部')
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

test('结构图：同一对节点的并行通道分别画线，名称默认都显示', async () => {
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
  assert.ok(text.includes('提测'), '主流程通道名默认显示')
  assert.ok(text.includes('加急提测'), '并行通道的名称也默认显示')
})

test('结构图：节点头像来自执行者登记，而不是定义快照', async () => {
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
  assert.match(text, /执行者 · 软件工程师/u, 'executor identity lives in the drawer header')
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
  assert.doesNotMatch(text, /主体:/u, 'the executor is no longer a loose key-value row')
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
  assert.match(text, /执行者 · 质量保障工程师/u, 'the sender executor is shown')
  assert.match(text, /允许的任务类型/u)
  assert.match(text, /开发/u, 'the allowed task type is listed')
})

test('定义抽屉：开始 / 结束节点展示内建任务类型与契约', async () => {
  const client = await loadClient()
  const base = {
    route: { kind: 'workflow', workflowId: 'wf-1', tab: 'definition' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  }

  const start = render(client, { ...base, definitionSelection: { kind: 'start' } })
  const startDrawer = drawerOf(start.tree)
  assert.ok(startDrawer !== null, 'the start drawer renders')
  const startText = textOf(startDrawer)
  assert.match(startText, /开始任务/u, 'the start node keeps its own title')
  assert.match(startText, /处理人: Workflow引擎/u, 'the start node is handled by the engine')
  assert.match(startText, /作业输入/u)
  assert.match(startText, /启动作业的人填写的内容/u)
  assert.match(startText, /内建任务类型/u, 'the start node shows the built-in task type card')
  assert.match(startText, /完成后创建/u, 'the creates are shown on the start task type')
  assert.match(startText, /开发/u, 'the created task type is labelled')
  assert.doesNotMatch(startText, /最终报告/u)
  assert.doesNotMatch(startText, /初始任务/u)

  const end = render(client, { ...base, definitionSelection: { kind: 'end' } })
  const endDrawer = drawerOf(end.tree)
  assert.ok(endDrawer !== null, 'the end drawer renders')
  const endText = textOf(endDrawer)
  assert.match(endText, /结束任务/u, 'the end node keeps its own title')
  assert.match(endText, /处理人: 发起人/u, 'the end node is handled by the starter')
  assert.match(endText, /最终报告/u)
  assert.match(endText, /summary/u, 'the end contract fields are listed')
  assert.doesNotMatch(endText, /完成后创建/u)
})

test('客户端展示：主体与助理显示「展示名 · 标识符」', async () => {
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
    /执行者 · 质量保障工程师 · qa-engineer/u,
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

test('实时流程：会话等用户操作或等回复时，节点左上角显示小红点', async () => {
  const client = await loadClient()
  const flowState = {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'flow' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
  }
  const isAttention = (node) =>
    typeof node.props?.className === 'string' &&
    node.props.className.split(/\s+/).includes('buka-workflows-nodeAttention')
  const devButton = (tree) =>
    findBy(tree, (node) => node.type === 'button' && textOf(node).includes('研发'))
  const attentionDot = (tree) => {
    const dev = devButton(tree)
    assert.ok(dev !== null, 'the dev node renders')
    return findBy(dev, isAttention)
  }

  // 回合已结束、会话空闲：等用户回复。
  const idle = render(client, flowState, {
    sessionStatus: new Map([['session-1', { running: false }]]),
  })
  assert.ok(attentionDot(idle.tree) !== null, 'idle session shows the red dot')
  assert.match(
    String(devButton(idle.tree).props.title),
    /等你回复/u,
    'the node tooltip explains the wait',
  )

  // 会话还在跑，但正在等用户审批 / 回答。
  const pending = render(client, flowState, {
    sessionStatus: new Map([
      ['session-1', { running: true, pendingInteraction: { kind: 'question' } }],
    ]),
  })
  assert.ok(attentionDot(pending.tree) !== null, 'pending interaction shows the red dot')

  // 会话在忙且没有待处理交互：不打扰。
  const running = render(client, flowState, {
    sessionStatus: new Map([['session-1', { running: true }]]),
  })
  assert.equal(attentionDot(running.tree), null, 'a busy session shows no red dot')

  // 定义图不显示运行态提醒。
  const suffix = `?attention=${Date.now()}`
  const renderGraph = await import(
    `${pathToFileURL(path.join(CLIENT_DIR, 'graph/render.ts')).href}${suffix}`
  )
  const definition = renderGraph.renderWorkflowGraph(
    { t: (key) => client.zh[key] ?? key },
    {
      nodes: [{ id: 'dev', label: '研发', kind: 'position', awaitingUser: true }],
      edges: [],
      mode: 'definition',
      showLegend: false,
    },
  )
  assert.equal(
    collect(definition).classes.includes('buka-workflows-nodeAttention'),
    false,
    'the definition graph never shows the runtime dot',
  )
})

test('看板：五列、引擎 / 发起人 / 岗位行、卡片打开任务抽屉', async () => {
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
    4,
    '五行之间各有一条分割虚线',
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
    ['Workflow引擎', '发起人', '研发', '测试', '发布审批'],
    'the engine and the starter get their own rows',
  )

  const boardRow = (label) =>
    findBy(
      tree,
      (node) =>
        typeof node.props?.className === 'string' &&
        node.props.className.split(/\s+/).includes('buka-workflows-boardRow') &&
        textOf(node).includes(label),
    )
  const engineRow = boardRow('Workflow引擎')
  assert.ok(engineRow !== null, 'the engine row should exist')
  assert.match(textOf(engineRow), /启动/u, 'the engine row holds the start task')

  const starterRow = boardRow('发起人')
  assert.ok(starterRow !== null, 'the starter row should exist')
  assert.match(textOf(starterRow), /人（页面启动）/u, 'the row names the starter')
  assert.match(textOf(starterRow), /1 个任务/u, 'the starter row holds only the end task')

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

test('任务抽屉：任务内容放进卡片并交给 MarkdownText 渲染', async () => {
  const client = await loadClient()
  const content = { requirement: '## 实现登录页\n\n- 支持 **记住我**\n- 提交失败要有提示' }
  const { tree } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'board' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    taskId: 'task-1',
    task: { status: 'ready', data: { ...TASK_DETAIL.task, content }, error: null },
  })
  const card = findBy(tree, (node) =>
    String(node.props?.className ?? '')
      .split(/\s+/)
      .includes('buka-workflows-contentCard'),
  )
  assert.ok(card !== null, 'task content sits in a card')
  const markdown = findBy(
    card,
    (node) => typeof node.type === 'function' && node.type.name === 'MarkdownText',
  )
  assert.ok(markdown !== null, 'task content renders through MarkdownText')
  assert.equal(markdown.props.text, content.requirement, 'Markdown keeps the raw source text')
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
  assert.match(text, /执行者 · 质量保障工程师/u)

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

test('人任务与执行者任务：只显示代办 / 待你办理 / 你在办理或执行者', async () => {
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

  // 执行者任务只显示执行者，不出现代办 / 承办者。
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

test('附件抽屉：Markdown 附件经 MarkdownText 渲染，相对图片解析到同作业图片附件', async () => {
  const client = await loadClient()
  const { tree } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'outputs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    attachment: {
      id: 'att-md-1',
      name: 'delivery.md',
      status: 'ready',
      data: {
        kind: 'markdown',
        mime: 'text/markdown',
        text: '# 交付说明',
        truncated: false,
        images: [
          { id: 'att-img-1', name: 'figure.png' },
          { id: 'att-img-2', name: 'photo.jpg' },
        ],
      },
      error: null,
    },
  })
  const markdown = findBy(
    tree,
    (node) => typeof node.type === 'function' && node.type.name === 'MarkdownText',
  )
  assert.ok(markdown !== null, 'markdown attachments render through MarkdownText')
  assert.equal(markdown.props.text, '# 交付说明')
  assert.equal(markdown.props.streaming, false)
  assert.equal(markdown.props.labels.code.copyLabel, '复制')
  assert.equal(markdown.props.labels.code.copiedLabel, '已复制')
  assert.equal(markdown.props.labels.code.toolbarLabels.codeLabel, '代码')
  assert.equal(markdown.props.labels.code.toolbarLabels.wrapLabel, '换行')
  assert.equal(markdown.props.labels.code.toolbarLabels.unwrapLabel, '不换行')
  assert.equal(markdown.props.labels.footnotes, '脚注')

  const resolve = markdown.props.pathImages.resolve
  const figure = resolve('figure.png')
  assert.equal(typeof figure, 'string')
  assert.match(figure, /buka-workflows\/attachment/u)
  assert.match(figure, /att-img-1/u)
  assert.match(figure, /mode=inline/u)
  assert.equal(resolve('./figure.png'), figure, '相对路径按文件名匹配')
  assert.equal(resolve('assets/photo.jpg'), resolve('photo.jpg'), '只按文件名精确匹配')
  assert.equal(resolve('missing.png'), undefined, '没有同名图片附件时不改写目标')
  assert.equal(resolve('https://example.com/x.png'), undefined, '远程图片交给渲染器原样处理')
})

test('附件抽屉：Markdown 附件截断与空文件提示照旧', async () => {
  const client = await loadClient()
  const truncated = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'outputs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    attachment: {
      id: 'att-md-2',
      name: 'big.md',
      status: 'ready',
      data: { kind: 'markdown', mime: 'text/markdown', text: '# x', truncated: true },
      error: null,
    },
  })
  assert.match(truncated.texts.join(' '), /仅展示文件开头的一部分/u)

  const empty = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1', view: 'outputs' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    attachment: {
      id: 'att-md-3',
      name: 'empty.md',
      status: 'ready',
      data: { kind: 'markdown', mime: 'text/markdown', text: '', truncated: false },
      error: null,
    },
  })
  assert.match(empty.texts.join(' '), /文件内容为空/u)
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
    /岗位「研发」引用的执行者标识符「软件工程师」已不存在/u,
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
  assert.match(text, /岗位「研发」引用的执行者标识符「软件工程师」已不存在/u)
  const newJob = findBy(tree, (node) => node.type === 'button' && textOf(node) === '新建作业')
  assert.ok(newJob, 'the new job button still renders')
  assert.equal(newJob.props.disabled, true, 'starting a job is blocked while unavailable')
})

test('派生不可用：作业页标注，主体与交回助理显示「已删除」与占位头像', async () => {
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
  assert.match(text, /岗位「研发」引用的执行者标识符「软件工程师」已不存在/u)
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

test('结构图：主流程线默认显示名称，悬浮强调连线并在鼠标旁弹气泡', async () => {
  const suffix = `?edge-labels=${Date.now()}`
  const render = await import(
    `${pathToFileURL(path.join(CLIENT_DIR, 'graph/render.ts')).href}${suffix}`
  )
  const layout = await import(
    `${pathToFileURL(path.join(CLIENT_DIR, 'graph/layout.ts')).href}${suffix}`
  )
  const nodes = [
    { id: 'start', label: '开始', kind: 'start' },
    { id: 'end', label: '结束', kind: 'end' },
  ]
  const edges = [
    { id: 'ch-1', label: '提交', from: 'start', to: 'end' },
    { id: 'ch-2', label: '加急提交', from: 'start', to: 'end' },
    { id: 'ch-3', label: '返工', from: 'end', to: 'start', back: true },
  ]
  const page = { t: (key) => key }
  const key = layout.layoutGraph(nodes, edges).edges[0].key
  const renderEdges = (list, anchor, extra = {}) => {
    harness.queue = [1, anchor]
    harness.index = 0
    return render.renderWorkflowGraph(page, { nodes, edges: list, showLegend: false, ...extra })
  }
  const renderGraph = (anchor, extra = {}) => renderEdges(edges, anchor, extra)
  const findTip = (collected) =>
    collected.nodes.find(
      (node) =>
        typeof node.props?.className === 'string' &&
        node.props.className.split(/\s+/).includes('buka-workflows-edgeTip'),
    )

  const idle = collect(renderGraph(null))
  assert.ok(idle.classes.includes('buka-workflows-edgeLabel'), '主流程线默认显示名称')
  assert.ok(idle.texts.includes('提交'), '主流程通道名默认可见')
  assert.ok(idle.texts.includes('加急提交'), '并行主流程通道名也默认可见')
  assert.ok(!idle.texts.includes('返工'), '回向通道名称默认隐藏')
  assert.ok(!idle.classes.includes('buka-workflows-edgeTip'), '默认不显示悬浮气泡')
  assert.ok(!idle.classes.includes('is-hovered'), '默认不高亮连线')
  assert.ok(!idle.classes.includes('is-dimmed'), '默认不淡化其他连线')

  const hovered = collect(renderGraph({ key, x: 120, y: 80 }))
  assert.ok(hovered.classes.includes('buka-workflows-edgeLabel'), '悬浮不隐藏线上名称')
  assert.ok(hovered.classes.includes('buka-workflows-edgeTip'), '悬浮时另起气泡层')
  assert.ok(hovered.classes.includes('is-hovered'), '悬浮的连线自身高亮')
  assert.ok(hovered.classes.includes('is-dimmed'), '其他连线变淡，便于辨认')
  assert.ok(hovered.texts.includes('提交'), '气泡里读到通道名')
  const hoveredTip = findTip(hovered)
  assert.ok(hoveredTip !== undefined, '气泡应该是一个独立的 DOM 层')
  assert.ok(hoveredTip.props.className.includes('is-forward'), '气泡标出通道方向')
  assert.equal(hoveredTip.props.style.left, '134px', '气泡在鼠标右侧')
  assert.equal(hoveredTip.props.style.top, '80px', '气泡与鼠标垂直居中')
  assert.equal(hoveredTip.props.style.transform, 'translateY(-50%)')

  const selectedBack = collect(renderGraph(null, { selectedChannelId: 'ch-3' }))
  assert.ok(selectedBack.classes.includes('buka-workflows-edgeLabel'), '选中的回向通道也显示名称')
  assert.ok(selectedBack.texts.includes('返工'), '选中的回向通道名称可见')

  const longLabel = '提交给下游岗位并等待最终验收结果'
  const longEdges = [{ id: 'ch-long', label: longLabel, from: 'start', to: 'end' }]
  const longKey = layout.layoutGraph(nodes, longEdges).edges[0].key
  const longIdle = collect(renderEdges(longEdges, null))
  assert.ok(
    longIdle.texts.some((text) => text.endsWith('…')),
    '线上名称过长时仍截断',
  )
  const longHovered = collect(renderEdges(longEdges, { key: longKey, x: 40, y: 40 }))
  assert.ok(longHovered.texts.includes(longLabel), '气泡显示完整通道名，不截断')
})
