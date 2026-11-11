/**
 * @buka/dsh-plugin-robots 浏览器一半的渲染冒烟测试。
 *
 * 页面模块不能直接 import（顶层依赖 `window.__ModuleLoader__`），这里用最小的
 * React 桩与假的模块加载器把工厂跑起来，再按页面的 `useState` 顺序注入状态，
 * 直接调用注册到 `main` 的页面组件，检查列表卡片与各对话框是否按状态渲染。
 * 它不是浏览器测试，但能在不启动 DSH 的情况下抓到渲染函数里的运行时错误。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const CLIENT_PATH = path.resolve('plugins/robots/lib/client.js')

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
        // 调用方传进来的 className 一并保留：测试要区分危险色按钮与普通按钮。
        className: ['x-button', `x-button-${props.variant ?? 'primary'}`, props.className]
          .filter((part) => typeof part === 'string' && part !== '')
          .join(' '),
        type: props.type ?? 'button',
        disabled: props.disabled === true,
        'aria-label': props['aria-label'],
        'aria-busy': props['aria-busy'],
      },
      props.children,
    )
  }

  function InputStub(props) {
    return h('input', {
      className: 'x-input',
      value: props.value ?? '',
      placeholder: props.placeholder ?? '',
      type: props.type,
      maxLength: props.maxLength,
      'data-modal-autofocus': props['data-modal-autofocus'],
    })
  }

  function ModalStub(props) {
    if (props.open !== true) return null
    return h(
      'div',
      { className: 'x-modalOverlay' },
      h(
        'div',
        { className: 'x-modal' },
        h(
          'div',
          { className: 'x-modalHead' },
          h('span', { className: 'x-modalTitle' }, props.title),
        ),
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
      ...(props.items ?? []).map((item) =>
        h('button', { key: item.value, className: 'x-tab' }, item.label),
      ),
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
    loadSequence += 1
    const url = `${pathToFileURL(CLIENT_PATH).href}?smoke=${loadSequence}`
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
  empty: '还没有机器人。',
  mountedBadge: '已挂载',
  unmountedBadge: '未挂载',
  skillsBadge: '{n} skills',
  agentsBadge: 'AGENTS.md',
  noAgentsBadge: '无 AGENTS.md',
  newSession: '新会话',
  openDetail: '打开详情',
  descriptionLabel: '职责',
  descriptionPlaceholder: '例如：负责把会议记录整理成三点结论',
  descriptionHint: '工作流会读它来决定是否把节点交给这个机器人；用一句话写清这个机器人负责什么。',
  tabDescription: '职责',
  descriptionSaved: '职责已保存。',
  descriptionSaveFailed: '保存职责失败：',
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  rename: '重命名机器人',
  renameLabel: '重命名',
  renameFieldLabel: '新名称',
  renameHint: '重命名会改机器人目录名并重建 DSH 工作区；已有会话仍保留，但不再列在这个机器人下。',
  renameEmpty: '先填一个新名称。',
  renameSame: '新名称与当前名称相同。',
  renameSaveFailed: '重命名失败：',
  renamed: '已重命名为：',
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
 * 列表响应。
 *
 * @returns {Record<string, any>}
 */
function listData() {
  return {
    ok: true,
    root: '/Users/x/.cache/dsh-plugin-robots/robots',
    registry: '/Users/x/.cache/dsh-plugin-robots/robots.json',
    corrupt: false,
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
 *   renameOpen?: boolean,
 *   renameDraft?: string,
 *   renameSaving?: boolean,
 *   renameError?: string | null,
 *   tab?: string,
 * }} [options]
 * @returns {Array<any>}
 */
function states({
  data = listData(),
  selectedName = null,
  dialogOpen = false,
  draftDescription = '',
  descriptionDraft = '',
  renameOpen = false,
  renameDraft = '',
  renameSaving = false,
  renameError = null,
  tab = 'agents',
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
    renameOpen, // renameOpen
    renameDraft, // renameDraft
    renameSaving, // renameSaving
    renameError, // renameError
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
  ]
}

test('机器人页：卡片与职责页签展示职责，创建对话框带职责字段', async () => {
  const client = await loadClient()
  const description = '写发布说明与测试报告'

  // 列表卡片直接展示职责，便于比较机器人。
  const list = collect(client.render(states({ data: listData() })))
  assert.ok(list.texts.includes(description))

  // 职责是详情页的独立页签：说明 + textarea + 保存按钮。
  const tabStates = {
    data: listData(),
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
    detail.texts.includes(
      '工作流会读它来决定是否把节点交给这个机器人；用一句话写清这个机器人负责什么。',
    ),
  )
  assert.ok(detail.texts.includes('保存'), '有改动时显示保存按钮')
  const draftField = findNode(
    client.render(states(tabStates)),
    (node) => node.type === 'textarea' && node.props?.value === description,
  )
  assert.ok(draftField)

  // 默认 AGENTS.md 页签不显示职责编辑器。
  const agentsTab = client.render(states({ data: listData(), selectedName: 'writer' }))
  assert.equal(
    findNode(
      agentsTab,
      (node) => node.type === 'textarea' && node.props?.['aria-label'] === '职责',
    ),
    null,
  )

  // 创建对话框里也能直接填职责。
  const createField = findNode(
    client.render(states({ data: listData(), dialogOpen: true })),
    (node) =>
      node.type === 'textarea' && node.props?.placeholder === '例如：负责把会议记录整理成三点结论',
  )
  assert.ok(createField)
})

test('机器人页：详情页有重命名入口，renameOpen 时渲染重命名对话框', async () => {
  const client = await loadClient()

  // 配置视图标题行：机器人名旁有铅笔按钮（tooltip / aria-label 带机器人名）。
  const detail = client.render(states({ data: listData(), selectedName: 'writer' }))
  const renameButton = findNode(detail, (node) => node.props?.['aria-label'] === '重命名 writer')
  assert.ok(renameButton, '配置视图标题行应有重命名按钮')
  assert.equal(renameButton.props?.disabled, false)

  // 目录缺失时入口禁用。
  const missingData = listData()
  missingData.robots[0].exists = false
  const missingButton = findNode(
    client.render(states({ data: missingData, selectedName: 'writer' })),
    (node) => node.props?.['aria-label'] === '重命名 writer',
  )
  assert.equal(missingButton?.props?.disabled, true, '目录缺失时重命名按钮禁用')

  // renameOpen 时对话框要有标题、新名称字段、后果提示与保存 / 取消。
  const dialogStates = {
    data: listData(),
    selectedName: 'writer',
    renameOpen: true,
    renameDraft: 'writer',
  }
  const dialog = collect(client.render(states(dialogStates)))
  assert.ok(dialog.texts.includes('重命名机器人'))
  assert.ok(dialog.texts.includes('新名称'))
  assert.ok(
    dialog.texts.includes(
      '重命名会改机器人目录名并重建 DSH 工作区；已有会话仍保留，但不再列在这个机器人下。',
    ),
  )
  assert.ok(dialog.texts.includes('保存'))
  assert.ok(dialog.texts.includes('取消'))
  const field = findNode(
    client.render(states(dialogStates)),
    (node) => node.type === 'input' && node.props?.value === 'writer',
  )
  assert.ok(field, '对话框应有新名称输入框，并带出当前名称')
  assert.equal(field.props?.maxLength, 64)

  // 保存按钮：草稿与当前名相同 / 为空 / 保存中都禁用；改成新名字才可用。
  const saveButtons = (options) =>
    collect(client.render(states(options))).nodes.filter(
      (node) => node.type === 'button' && (node.children ?? []).includes('保存'),
    )
  const sameButtons = saveButtons(dialogStates)
  assert.ok(sameButtons.length > 0)
  assert.ok(
    sameButtons.every((node) => node.props?.disabled === true),
    '新名称与当前名相同时保存禁用',
  )
  const changedButtons = saveButtons({ ...dialogStates, renameDraft: 'author' })
  assert.ok(
    changedButtons.some((node) => node.props?.disabled === false),
    '改了新名称后保存可用',
  )
  const emptyButtons = saveButtons({ ...dialogStates, renameDraft: '   ' })
  assert.ok(
    emptyButtons.every((node) => node.props?.disabled === true),
    '新名称为空时保存禁用',
  )
  const savingButtons = saveButtons({ ...dialogStates, renameDraft: 'author', renameSaving: true })
  assert.ok(
    savingButtons.every((node) => node.props?.disabled === true),
    '保存中禁用',
  )

  // 失败提示留在对话框里。
  const failed = collect(
    client.render(states({ ...dialogStates, renameError: '重命名失败：机器人名称已被占用' })),
  )
  assert.ok(failed.texts.includes('重命名失败：机器人名称已被占用'))

  // 登记文件损坏时重命名入口禁用。
  const corruptData = listData()
  corruptData.corrupt = true
  const corruptButton = findNode(
    client.render(states({ data: corruptData, selectedName: 'writer' })),
    (node) => node.props?.['aria-label'] === '重命名 writer',
  )
  assert.equal(corruptButton?.props?.disabled, true, '登记文件损坏时重命名按钮禁用')
})

test('机器人页：列表整行点击进详情，行内动作统一为 outline 按钮', async () => {
  const client = await loadClient()
  const tree = client.render(states({ data: listData() }))
  const list = collect(tree)

  // 不再有单独的「配置」按钮：进入详情靠整行点击 / 标题按钮。
  assert.ok(!list.texts.includes('配置'), '列表里不再有「配置」按钮文案')

  const card = findNode(
    tree,
    (node) =>
      node.type === 'li' && String(node.props?.className ?? '').includes('buka-robots-card'),
  )
  assert.ok(card, '列表里有机器人卡片')
  assert.equal(typeof card.props?.onClick, 'function', '整行可点击进入详情')
  assert.match(String(card.props?.className), /is-clickable/u)

  // 标题本身是按钮：键盘 Tab 能落到这里，点它把事件拦在行内，避免重复进入。
  const titleButton = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '打开详情 writer',
  )
  assert.ok(titleButton, '机器人名是进入详情的按钮')
  let stopped = false
  titleButton.props.onClick({
    stopPropagation: () => {
      stopped = true
    },
  })
  assert.equal(stopped, true, '点标题不再冒泡到整行')

  // 行内动作：新会话 / 删除；删除与其它动作同一套 outline 按钮（危险色），
  // 不再是那个裸图标按钮。
  assert.ok(list.texts.includes('新会话'))
  assert.ok(list.texts.includes('删除'))
  const deleteButton = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '删除 writer',
  )
  assert.ok(deleteButton, '有删除按钮')
  assert.match(String(deleteButton.props?.className), /x-button-outline/u)
  assert.match(String(deleteButton.props?.className), /buka-robots-danger/u)
  assert.equal(
    findNode(
      tree,
      (node) =>
        node.type === 'button' &&
        String(node.props?.className ?? '').includes('buka-robots-iconDanger'),
    ),
    null,
    '列表里不再有裸图标删除按钮',
  )

  // 写操作进行中（busy）时整行不进入详情，标题按钮也禁用。
  const busyStates = states({ data: listData() })
  busyStates[8] = 'delete:writer' // busy
  const busyTree = client.render(busyStates)
  const busyCard = findNode(
    busyTree,
    (node) =>
      node.type === 'li' && String(node.props?.className ?? '').includes('buka-robots-card'),
  )
  assert.ok(!String(busyCard.props?.className).includes('is-clickable'), '写操作中整行不可点')
  const busyTitle = findNode(
    busyTree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '打开详情 writer',
  )
  assert.equal(busyTitle.props?.disabled, true, '写操作中标题按钮禁用')
})
