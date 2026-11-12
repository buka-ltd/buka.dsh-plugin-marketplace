/**
 * @buka/dsh-plugin-workflows 浏览器一半的渲染冒烟测试。
 *
 * 页面源码是 TypeScript（Node 24 默认做类型剥离），这里用 `module.registerHooks`
 * 把 `react` 与 DSH 的界面基座替换成最小桩，再直接调用注册到 `main` 的页面
 * 组件：工作流列表 / 工作流详情 / 作业看板 / 任务抽屉 / 人任务表单 / 新建作业
 * 对话框 / 附件库与时间线都会被渲染一遍，能在不启动 DSH、也不先构建 `lib/`
 * 的情况下抓到渲染函数里的运行时错误与 props 形状错误。
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

/**
 * React 桩：元素只记录 type / props / children；useState 从注入队列取值，
 * setState 支持函数式更新并记录结果。
 */
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

/**
 * 界面基座桩：只保留页面真正依赖的元素 / 组件语义。
 *
 * - `Tag` / `Button` / `SegmentedTabs` 等把 children 渲染出来，便于读文本；
 * - `Modal` 在 `open: false` 时不渲染内容；
 * - 图标与 StateDot / Toast 渲染为空。
 */
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

/** 每次载入换一个查询串，绕过 ESM 模块缓存。 */
let loadSequence = 0

/**
 * 载入客户端 `apply` 与页面组件。
 *
 * @returns {Promise<{ Page: Function, zh: Record<string,string>, createInitialState: Function }>}
 */
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

/**
 * 走一遍渲染树；函数组件在这里展开。
 *
 * @param {any} node
 * @param {(node: Record<string, any>) => void} visit
 */
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

/**
 * 收集渲染树里的文本、类名与路径。
 *
 * @param {any} tree
 * @returns {{ texts: string[], classes: string[], paths: string[] }}
 */
function collect(tree) {
  const texts = []
  const classes = []
  const paths = []
  walk(tree, (node) => {
    const className = node.props?.className
    if (typeof className === 'string') classes.push(...className.split(/\s+/).filter(Boolean))
    const classNameValue = node.props?.className
    if (
      typeof node.props?.d === 'string' &&
      typeof classNameValue === 'string' &&
      classNameValue.includes('buka-workflows-edge')
    ) {
      paths.push(node.props.d)
    }
    for (const child of node.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') texts.push(String(child))
    }
  })
  return { texts, classes, paths }
}

/**
 * 找到第一个满足条件的元素（函数组件节点也算）。
 *
 * @param {any} tree
 * @param {(node: Record<string, any>) => boolean} predicate
 * @returns {Record<string, any> | null}
 */
function findBy(tree, predicate) {
  let found = null
  walk(tree, (node) => {
    if (found === null && predicate(node)) found = node
  })
  return found
}

/**
 * 展开一个节点后的全部文本。
 *
 * @param {any} node
 * @returns {string}
 */
function textOf(node) {
  const texts = []
  walk(node, (current) => {
    for (const child of current.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') texts.push(String(child))
    }
  })
  return texts.join(' ')
}

/**
 * 按文本找到可点击按钮并点它。
 *
 * @param {any} tree
 * @param {string} label
 */
function clickButton(tree, label) {
  const node = findBy(
    tree,
    (current) => typeof current.props?.onClick === 'function' && textOf(current).includes(label),
  )
  assert.ok(node !== null, `button with label ${label} should exist`)
  node.props.onClick({})
}

/**
 * 渲染一次页面。`patch` 覆盖初始状态里的任意切片。
 *
 * @param {{ Page: Function, zh: Record<string,string>, createInitialState: Function }} client
 * @param {Record<string, any>} patch
 * @returns {{ tree: any, texts: string[], classes: string[], paths: string[], state: any }}
 */
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

/** 工作流定义（spec §5.7 的简化版）。 */
const DEFINITION = {
  version: 4,
  name: '研发交付',
  description: '需求 → 研发 / 测试准备 → 验证 → 审批 → 发布',
  budgets: { maxTasks: 200, maxDurationHours: 72 },
  start: {
    task: {
      payload: {
        type: 'object',
        properties: { request: { type: 'string' } },
        required: ['request'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: { requirement: { type: 'string' }, acceptance: { type: 'string' } },
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
        properties: { summary: { type: 'string' } },
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
      executor: { kind: 'robot', name: '软件工程师' },
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
      executor: { kind: 'robot', name: '质量保障工程师' },
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
  edges: [
    { from: 'start', to: 'dev' },
    { from: 'dev', to: 'qa', types: ['qa.verify'] },
    { from: 'qa', to: 'dev', types: ['dev.implement'], back: true },
    { from: 'qa', to: 'approve' },
    { from: 'approve', to: 'end' },
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
    edges: DEFINITION.edges,
    start: { label: '开始' },
    end: { label: '结束' },
  },
  jobs: [
    {
      id: 'job-1',
      seq: 7,
      status: 'running',
      inputSummary: '实现登录页',
      taskCounts: { running: 1, ready: 1 },
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
    input: { request: '实现登录页' },
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
    edges: DEFINITION.edges,
    start: { label: '开始' },
    end: { label: '结束' },
  },
  tasks: [
    {
      id: 'task-0',
      position: 'start',
      type: 'start',
      typeLabel: '启动',
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
      status: 'running',
      deps: ['task-0'],
      createdAt: '2026-11-12T10:01:00.000Z',
      startedAt: '2026-11-12T10:01:05.000Z',
      claimant: { kind: 'robot', name: '软件工程师', sessionId: 'session-1' },
      attemptCount: 1,
      attachmentCount: 1,
    },
    {
      id: 'task-2',
      position: 'qa',
      type: 'qa.verify',
      typeLabel: '验证',
      status: 'pending',
      deps: ['task-1'],
      createdAt: '2026-11-12T10:01:00.000Z',
    },
    {
      id: 'task-3',
      position: 'approve',
      type: 'approve.release',
      typeLabel: '批准发布',
      status: 'ready',
      createdAt: '2026-11-12T10:02:00.000Z',
    },
    {
      id: 'task-4',
      position: 'end',
      type: 'end',
      typeLabel: '结束',
      status: 'ready',
      createdAt: '2026-11-12T10:02:00.000Z',
    },
  ],
}

/** 机器人任务详情。 */
const TASK_DETAIL = {
  task: {
    id: 'task-1',
    jobId: 'job-1',
    position: 'dev',
    positionLabel: '研发',
    type: 'dev.implement',
    typeLabel: '开发',
    typeDescription: '实现功能',
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
    claimant: { kind: 'robot', name: '软件工程师', sessionId: 'session-1' },
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
      output: { ok: true },
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

/** 人任务详情：等待按产出契约填表。 */
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

test('工作流列表渲染名称、版本、状态与作业数', async () => {
  const client = await loadClient()
  const { texts } = render(client, {
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
          status: 'draft',
          jobCount: 0,
        },
      ],
      error: null,
    },
  })
  const text = texts.join(' ')
  assert.match(text, /研发交付/u)
  assert.match(text, /内容审核/u)
  assert.match(text, /12 个作业/u)
  assert.match(text, /已激活/u)
  assert.match(text, /草稿/u)
})

test('工作流详情渲染流程图、岗位 / 任务类型、边与作业列表', async () => {
  const client = await loadClient()
  const { texts, paths } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
  })
  const text = texts.join(' ')
  // 图：start / 3 个岗位 / end 共 5 个节点、5 条边，全部画成 path。
  assert.equal(paths.length, DEFINITION.edges.length, 'every defined edge should be drawn')
  for (const label of ['研发', '测试', '发布审批', '开始', '结束']) {
    assert.match(text, new RegExp(label, 'u'))
  }
  // 任务类型与契约。
  assert.match(text, /开发/u)
  assert.match(text, /批准发布/u)
  assert.match(text, /沟通助理/u)
  assert.match(text, /回边/u)
  assert.match(text, /全部任务类型|qa\.verify/u)
  assert.match(text, /任务上限/u)
  assert.match(text, /200/u)
  // 作业列表。
  assert.match(text, /作业 #7/u)
  assert.match(text, /实现登录页/u)
  assert.match(text, /作业 #6/u)
})

test('作业看板按岗位 × 状态分组，点卡片打开任务抽屉', async () => {
  const client = await loadClient()
  const { tree, texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
  })
  const text = texts.join(' ')
  for (const header of ['排队', '待认领', '进行中', '已完成', '异常']) {
    assert.match(text, new RegExp(header, 'u'), `board column ${header}`)
  }
  for (const row of ['开始', '研发', '测试', '发布审批', '结束']) {
    assert.match(text, new RegExp(row, 'u'), `board row ${row}`)
  }
  assert.match(text, /开发/u)
  assert.match(text, /验证/u)
  assert.match(text, /软件工程师/u)

  clickButton(tree, '开发')
  assert.equal(harness.updates.length, 1, 'clicking a card should update state')
  assert.equal(harness.updates[0].taskId, 'task-1')
  assert.equal(harness.updates[0].task.status, 'loading')
})

test('任务抽屉渲染 payload、依赖、执行记录、结果与操作', async () => {
  const client = await loadClient()
  const { texts } = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    taskId: 'task-1',
    task: { status: 'ready', data: TASK_DETAIL.task, error: null },
  })
  const text = texts.join(' ')
  assert.match(text, /实现登录页/u, 'payload rendered')
  assert.match(text, /依赖/u)
  assert.match(text, /已结构化/u)
  assert.match(text, /执行记录/u)
  assert.match(text, /session-1/u)
  assert.match(text, /登录页已实现/u)
  assert.match(text, /trace\.zip/u)
  assert.match(text, /重试/u)
  assert.match(text, /取消任务/u)
  assert.match(text, /打开会话/u)
})

test('人任务按 output schema 渲染表单，提交走 task/action complete', async () => {
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
      route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1' },
      workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
      job: { status: 'ready', data: JOB_DETAIL, error: null },
      taskId: 'task-3',
      task: { status: 'ready', data: HUMAN_TASK_DETAIL.task, error: null },
      taskForm: { values: { approved: 'yes' }, text: '同意发布', error: null, submitting: false },
    })
    const text = texts.join(' ')
    assert.match(text, /填写结果/u)
    assert.match(text, /最终交付物|提交结果/u)

    // 产出 schema 的枚举字段渲染成 select，且带着注入的值。
    const approved = findBy(
      tree,
      (node) => node.props?.id === 'buka-workflows-task-task-3-approved',
    )
    assert.ok(approved !== null, 'approved enum field should render')
    assert.equal(approved.props.value, 'yes')

    clickButton(tree, '提交结果')
    // 等 requestJson 的 fetch / json 两个微任务。
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

test('新建作业对话框按开始契约渲染原始输入与结构化输入', async () => {
  const client = await loadClient()
  const { tree } = render(client, {
    route: { kind: 'workflow', workflowId: 'wf-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    newJob: { open: true, raw: {}, structured: {}, error: null, submitting: false },
  })
  const raw = findBy(tree, (node) =>
    typeof node.props?.id === 'string'
      ? node.props.id === 'buka-workflows-newjob-raw-request'
      : false,
  )
  const structured = findBy(tree, (node) =>
    typeof node.props?.id === 'string'
      ? node.props.id === 'buka-workflows-newjob-structured-requirement'
      : false,
  )
  assert.ok(raw !== null, 'raw input field should render from start.task.payload')
  assert.ok(structured !== null, 'structured field should render from start.task.output')
  const submit = findBy(
    tree,
    (node) => typeof node.props?.onClick === 'function' && textOf(node).includes('启动作业'),
  )
  assert.ok(submit !== null, 'submit button should render')
})

test('附件库、时间线与作业流程图各自渲染', async () => {
  const client = await loadClient()
  const attachments = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    jobView: 'attachments',
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
      ],
      error: null,
    },
  })
  const attachmentText = attachments.texts.join(' ')
  assert.match(attachmentText, /trace\.zip/u)
  assert.match(attachmentText, /失败用例 trace/u)
  assert.match(attachmentText, /2\.0 KiB/u)

  const timeline = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    jobView: 'timeline',
  })
  const timelineText = timeline.texts.join(' ')
  assert.match(timelineText, /作业创建/u)
  assert.match(timelineText, /任务创建/u)
  assert.match(timelineText, /任务完成/u)

  const graph = render(client, {
    route: { kind: 'job', workflowId: 'wf-1', jobId: 'job-1' },
    workflow: { status: 'ready', data: WORKFLOW_DETAIL, error: null },
    job: { status: 'ready', data: JOB_DETAIL, error: null },
    jobView: 'graph',
  })
  assert.equal(graph.paths.length, DEFINITION.edges.length, 'job graph should draw every edge')
  assert.match(graph.texts.join(' '), /研发/u)
})
