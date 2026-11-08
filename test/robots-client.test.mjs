/**
 * @buka/dsh-plugin-robots 浏览器一半的渲染冒烟测试。
 *
 * 页面模块不能直接 import（顶层依赖 `window.__ModuleLoader__`），这里用最小的
 * React 桩与假的模块加载器把工厂跑起来，再按页面的 `useState` 顺序注入状态，
 * 直接调用注册到 `main` 的页面组件，检查通用型机器人卡片、设置对话框与
 * 「进入工作区」对话框是否按状态渲染。它不是浏览器测试，但能在不启动 DSH 的
 * 情况下抓到渲染函数里的运行时错误。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { AVATAR_IDS } from '../plugins/robots/lib/avatar.js'

const CLIENT_PATH = path.resolve('plugins/robots/client.js')

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
 * 走一遍渲染树；函数组件（Button / Tag / Modal 这些桩）在这里展开。
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
  if (typeof node.type === 'function') {
    walk(node.type({ ...node.props, children: node.children }), visit)
    return
  }
  if (node.type === 'fragment') {
    walk(node.children, visit)
    return
  }
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/**
 * 收集渲染树里的文本与所有元素。
 *
 * @param {any} tree
 * @returns {{ texts: string[], nodes: Array<Record<string, any>> }}
 */
function collect(tree) {
  const texts = []
  const nodes = []
  walk(tree, (node) => {
    nodes.push(node)
    for (const child of node.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') texts.push(String(child))
    }
  })
  return { texts, nodes }
}

/**
 * 按条件找第一个元素。
 *
 * @param {any} tree
 * @param {(node: Record<string, any>) => boolean} predicate
 * @returns {Record<string, any> | null}
 */
function findNode(tree, predicate) {
  let found = null
  walk(tree, (node) => {
    if (found === null && predicate(node)) found = node
  })
  return found
}

/**
 * 载入客户端模块，返回注册到 `main` 的页面组件。
 *
 * @returns {Promise<{ render: (states: Array<any>) => any, css: () => string }>}
 */
async function loadClient() {
  /** @type {Array<any>} */
  const stateQueue = []
  let stateIndex = 0
  const React = {
    createElement: h,
    Fragment: 'fragment',
    useState(initial) {
      const value = stateIndex < stateQueue.length ? stateQueue[stateIndex] : initial
      stateIndex += 1
      return [value, () => {}]
    },
    useEffect() {},
  }

  function ButtonStub(props) {
    return h(
      'button',
      {
        className: `x-button x-button-${props.variant ?? 'primary'}`,
        type: props.type ?? 'button',
        disabled: props.disabled === true,
        'aria-label': props['aria-label'],
        'aria-busy': props['aria-busy'],
      },
      props.children,
    )
  }

  function InputStub(props) {
    return h('input', { className: 'x-input', value: props.value ?? '', placeholder: props.placeholder ?? '' })
  }

  function ModalStub(props) {
    if (props.open !== true) return null
    return h(
      'div',
      { className: 'x-modalOverlay' },
      h(
        'div',
        { className: 'x-modal' },
        h('div', { className: 'x-modalHead' }, h('span', { className: 'x-modalTitle' }, props.title)),
        h('div', { className: 'x-modalBody' }, props.children),
        h('div', { className: 'x-modalFooter' }, props.footer),
      ),
    )
  }

  function TagStub(props) {
    return h('span', { className: 'x-tag', 'data-tone': props.tone }, props.children)
  }

  function TooltipStub(props) {
    return props.children
  }

  function SegmentedTabsStub(props) {
    return h(
      'div',
      { className: 'x-tabs' },
      ...(props.items ?? []).map((item) => h('button', { key: item.value, className: 'x-tab' }, item.label)),
    )
  }

  function StateDotStub() {
    return h('span', { className: 'x-dot' })
  }

  function ToastStub() {
    return null
  }

  function IconStub() {
    return h('span', { className: 'x-icon' })
  }

  const primitives = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'Button') return ButtonStub
        if (name === 'Input') return InputStub
        if (name === 'Modal') return ModalStub
        if (name === 'Tag') return TagStub
        if (name === 'Tooltip') return TooltipStub
        if (name === 'SegmentedTabs') return SegmentedTabsStub
        if (name === 'StateDot') return StateDotStub
        if (name === 'Toast') return ToastStub
        return IconStub
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
      locale: { bind: () => (key) => zh[key] ?? key, register: () => () => {} },
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
        return components.page({ t: (key) => zh[key] ?? key, getService: () => null })
      },
    }
  } finally {
    delete globalThis.window
    delete globalThis.document
  }
}

/** 截图 / 断言用到的中文文案。 */
const zh = {
  title: '机器人',
  refresh: '刷新',
  create: '创建机器人',
  settings: '设置',
  settingsTitle: '设置',
  generalSetting: '通用型机器人',
  generalSettingDesc:
    '固定使用 🤖 头像与标准模式，可以进入任何已存在的工作区，并会出现在工作流的机器人清单里（职责里写明没有专用机器人时使用）；关掉后它既不会出现在机器人列表里，也不会暴露给工作流。',
  settingsEnabled: '启用',
  settingsDisabled: '停用',
  settingsDone: '完成',
  generalTitle: '通用型机器人',
  generalIntro: '以标准模式在任意已有工作区里执行通用任务，自身没有目录、AGENTS.md 或 skills；没有专用机器人时使用。',
  enterWorkspace: '进入工作区',
  chooseWorkspace: '选择工作区',
  chooseWorkspaceHint: '通用型机器人使用标准模式，选一个已有的工作区进入。',
  loadingWorkspaces: '正在读取工作区…',
  workspacesEmpty: '还没有工作区，先在侧边栏新建一个。',
  workspacesFailed: '读取工作区失败：',
  empty: '还没有机器人。',
  mountedBadge: '已挂载',
  unmountedBadge: '未挂载',
  skillsBadge: '{n} skills',
  agentsBadge: 'AGENTS.md',
  noAgentsBadge: '无 AGENTS.md',
  newSession: '新会话',
  configure: '配置',
  descriptionLabel: '职责',
  descriptionPlaceholder: '例如：负责把会议记录整理成三点结论',
  descriptionHint: '工作流会读它来决定是否把节点交给这个机器人；用一句话写清这个机器人负责什么。',
  tabDescription: '职责',
  descriptionSaved: '职责已保存。',
  descriptionSaveFailed: '保存职责失败：',
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  mount: '挂载',
  delete: '删除',
  tabsLabel: '机器人详情页签',
  tabAgents: 'AGENTS.md',
  tabSkills: '技能',
}

/**
 * 一条机器人记录。
 *
 * @param {string} name
 * @param {string} avatar
 * @returns {Record<string, any>}
 */
function robot(name, avatar, description = '') {
  return {
    name,
    path: `/Users/x/.cache/dsh-plugin-robots/robots/${name}`,
    avatar,
    description,
    createdAt: '2026-11-06T00:00:00.000Z',
    exists: true,
    mounted: true,
    workspaceId: 'ws-1',
    skills: [],
    agents: { exists: true, bytes: 0, modifiedAt: null },
    claude: { exists: true, symlink: true, mode: 'symlink', target: 'AGENTS.md' },
  }
}

/**
 * 列表响应（`general.enabled` 决定通用型机器人卡片是否出现）。
 *
 * @param {boolean} generalEnabled
 * @returns {Record<string, any>}
 */
function listData(generalEnabled) {
  return {
    ok: true,
    root: '/Users/x/.cache/dsh-plugin-robots/robots',
    registry: '/Users/x/.cache/dsh-plugin-robots/robots.json',
    corrupt: false,
    general: { enabled: generalEnabled },
    robots: [robot('writer', 'panda', '写发布说明与测试报告')],
  }
}

/**
 * 页面状态数组：顺序必须与 `RobotsPage` 里的 `React.useState` 一致。
 *
 * @param {{
 *   data?: Record<string, any>,
 *   selectedName?: string | null,
 *   dialogOpen?: boolean,
 *   draftDescription?: string,
 *   descriptionDraft?: string,
 *   tab?: string,
 *   settingsOpen?: boolean,
 *   workspacesOpen?: boolean,
 *   workspaces?: Array<Record<string, any>> | null,
 * }} [options]
 * @returns {Array<any>}
 */
function states({
  data = listData(true),
  selectedName = null,
  dialogOpen = false,
  draftDescription = '',
  descriptionDraft = '',
  tab = 'agents',
  settingsOpen = false,
  workspacesOpen = false,
  workspaces = null,
} = {}) {
  return [
    { data, error: null, loading: false }, // list
    0, // reloadKey
    '', // name
    draftDescription, // draftDescription
    dialogOpen, // dialogOpen
    null, // createError
    false, // creating
    null, // confirming
    null, // busy
    'panda', // draftAvatar
    false, // avatarOpen
    null, // avatarTarget
    false, // avatarSaving
    null, // avatarError
    descriptionDraft, // descriptionDraft
    false, // descriptionSaving
    null, // descriptionError
    selectedName, // selectedName
    tab, // tab
    '', // agentsDraft
    false, // agentsSaving
    null, // removing
    null, // confirmingSkill
    null, // skillError
    false, // installOpen
    '', // installSource
    { status: 'idle', skills: [], installed: [], error: null, output: '' }, // installCandidates
    [], // installSelected
    null, // installError
    false, // installing
    { status: 'unavailable', repos: [] }, // favourites
    null, // notice
    workspacesOpen, // workspacesOpen
    workspaces === null
      ? { status: 'idle', items: [], error: null }
      : { status: 'ready', items: workspaces, error: null }, // workspacesState
    null, // workspaceBusy
    settingsOpen, // settingsOpen
    false, // settingsSaving
    null, // settingsError
  ]
}

test('机器人页：通用型机器人卡片固定在列表最前，停用后不渲染', async () => {
  const client = await loadClient()
  const tree = client.render(states({ data: listData(true) }))
  const { texts, nodes } = collect(tree)

  assert.ok(texts.includes('通用型机器人'), '列表顶部应有通用型机器人')
  assert.ok(
    texts.includes(
      '以标准模式在任意已有工作区里执行通用任务，自身没有目录、AGENTS.md 或 skills；没有专用机器人时使用。',
    ),
    '通用型机器人说明里要写清职责与兜底定位',
  )
  assert.equal(texts.includes('通用型 · 标准模式'), false, '标准模式写在说明里，不再单独做标签')
  assert.ok(
    texts.includes(
      '以标准模式在任意已有工作区里执行通用任务，自身没有目录、AGENTS.md 或 skills；没有专用机器人时使用。',
    ),
  )
  assert.ok(texts.includes('进入工作区'))

  const generalButton = findNode(
    tree,
    (node) => node.props?.['aria-label'] === '进入工作区 通用型机器人',
  )
  assert.ok(generalButton, '通用型机器人卡片应有进入工作区按钮')

  // 通用型卡片排在登记机器人之前。
  const cards = nodes.filter((node) => {
    const value = node.props?.className
    return typeof value === 'string' && value.split(/\s+/).includes('buka-robots-card')
  })
  assert.equal(cards.length, 2)
  assert.ok(String(cards[0].props?.key ?? '').includes('general'))

  // 停用后列表里没有通用型机器人。
  const off = collect(client.render(states({ data: listData(false) })))
  assert.equal(off.texts.includes('通用型机器人'), false)
  assert.ok(off.texts.includes('writer'))
})

test('机器人页：设置按钮只在列表页显示，对话框按开关状态渲染', async () => {
  const client = await loadClient()
  const list = client.render(states({ data: listData(true) }))
  assert.ok(findNode(list, (node) => node.props?.['aria-label'] === '设置'), '列表页应有设置按钮')

  const detail = client.render(states({ data: listData(true), selectedName: 'writer' }))
  assert.equal(findNode(detail, (node) => node.props?.['aria-label'] === '设置'), null, '详情页不显示页面设置')

  const open = collect(client.render(states({ data: listData(true), settingsOpen: true })))
  assert.ok(open.texts.includes('设置'))
  assert.ok(open.texts.includes('通用型机器人'))
  assert.ok(open.texts.includes('启用'))
  assert.ok(open.texts.includes('完成'))
  const enabledSwitch = findNode(
    client.render(states({ data: listData(true), settingsOpen: true })),
    (node) => node.props?.role === 'switch',
  )
  assert.equal(enabledSwitch?.props?.['aria-checked'], true)

  const off = collect(client.render(states({ data: listData(false), settingsOpen: true })))
  assert.ok(off.texts.includes('停用'))
  const disabledSwitch = findNode(
    client.render(states({ data: listData(false), settingsOpen: true })),
    (node) => node.props?.role === 'switch',
  )
  assert.equal(disabledSwitch?.props?.['aria-checked'], false)
})

test('机器人页：进入工作区对话框按 Host 返回渲染工作区', async () => {
  const client = await loadClient()
  const workspaces = [
    { id: 'ws-1', title: '卟咔课堂', path: '/Users/x/work/class', sessions: 2 },
    { id: 'ws-2', title: 'writer', path: '/Users/x/.cache/dsh-plugin-robots/robots/writer', sessions: 0 },
  ]
  const { texts, nodes } = collect(
    client.render(states({ data: listData(true), workspacesOpen: true, workspaces })),
  )
  assert.ok(texts.includes('选择工作区'))
  assert.ok(texts.includes('卟咔课堂'))
  assert.ok(texts.includes('/Users/x/work/class'))
  assert.ok(texts.includes('writer'))
  const rows = nodes.filter((node) => {
    const value = node.props?.className
    return (
      typeof value === 'string' &&
      value.split(/\s+/).includes('buka-robots-workspace') &&
      typeof node.props?.['aria-label'] === 'string'
    )
  })
  assert.equal(rows.length, 2, '每个工作区一行')

  const empty = collect(
    client.render(states({ data: listData(true), workspacesOpen: true, workspaces: [] })),
  )
  assert.ok(empty.texts.includes('还没有工作区，先在侧边栏新建一个。'))
})

test('机器人页：头像预设里没有 🤖，通用型机器人卡片自己画固定头像', async () => {
  assert.equal(AVATAR_IDS.includes('robot'), false)
  const client = await loadClient()
  const { texts } = collect(client.render(states({ data: listData(true) })))
  assert.ok(texts.includes('🤖'), '通用型机器人卡片应显示 🤖')
})

test('机器人页：卡片与职责页签展示职责，创建对话框带职责字段', async () => {
  const client = await loadClient()
  const description = '写发布说明与测试报告'

  // 列表卡片直接展示职责，便于比较机器人。
  const list = collect(client.render(states({ data: listData(true) })))
  assert.ok(list.texts.includes(description))

  // 职责是详情页的独立页签：说明 + textarea + 保存按钮。
  const tabStates = {
    data: listData(true),
    selectedName: 'writer',
    descriptionDraft: description,
    tab: 'description',
  }
  const detail = collect(client.render(states(tabStates)))
  assert.ok(detail.texts.includes('职责'))
  assert.ok(
    detail.texts.indexOf('职责') < detail.texts.indexOf('AGENTS.md'),
    '职责页签排在 AGENTS.md 之前',
  )
  assert.ok(
    detail.texts.includes('工作流会读它来决定是否把节点交给这个机器人；用一句话写清这个机器人负责什么。'),
  )
  assert.ok(detail.texts.includes('保存'), '有改动时显示保存按钮')
  const draftField = findNode(
    client.render(states(tabStates)),
    (node) => node.type === 'textarea' && node.props?.value === description,
  )
  assert.ok(draftField)

  // 默认 AGENTS.md 页签不显示职责编辑器。
  const agentsTab = client.render(states({ data: listData(true), selectedName: 'writer' }))
  assert.equal(
    findNode(agentsTab, (node) => node.type === 'textarea' && node.props?.['aria-label'] === '职责'),
    null,
  )

  // 创建对话框里也能直接填职责。
  const createField = findNode(
    client.render(states({ data: listData(true), dialogOpen: true })),
    (node) => node.type === 'textarea' && node.props?.placeholder === '例如：负责把会议记录整理成三点结论',
  )
  assert.ok(createField)
})
