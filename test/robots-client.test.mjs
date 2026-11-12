/**
 * @buka/dsh-plugin-robots 浏览器一半的渲染冒烟测试。
 *
 * 直接 import `src/client/index.ts`（Node 负责剥类型），用 `module.registerHooks`
 * 把 `react` / `@buka/plugin-ui` / `@deepseek-ai/dsh-client-ui-primitives` 换成
 * 最小桩：页面组件只在渲染期用 `React.createElement`、`useState`、`useEffect`
 * 与基座按钮 / 标签，所以不需要构建 `lib/client.js` 也能抓到渲染函数里的运行时
 * 错误。随后按页面的 `useState` 顺序注入状态，直接调用注册到 `main` 的组件，
 * 检查列表卡片与各对话框是否按状态渲染。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const CLIENT_PATH = path.resolve('plugins/robots/src/client/index.ts')

/** 浏览器一半源码里用到的全部基座导出；桩模块必须静态导出这些名字。 */
const PRIMITIVE_NAMES = [
  'Button',
  'IconChevronRightOutlineRegular',
  'IconEditOutlineRegular',
  'IconFolderOpenOutlineRegular',
  'IconNewChatOutlineRegular',
  'IconPlusOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconTrashOutlineRegular',
  'IconWarningOutlineRegular',
  'Input',
  'Modal',
  'SegmentedTabs',
  'StateDot',
  'Tag',
  'Toast',
  'Tooltip',
]

/** 桩模块目录；必须在第一次 import 浏览器一半之前落盘。 */
const stubRoot = mkdtempSync(path.join(tmpdir(), 'buka-robots-client-stubs-'))
const reactStub = path.join(stubRoot, 'react.mjs')
const pluginUiStub = path.join(stubRoot, 'plugin-ui.mjs')
const primitivesStub = path.join(stubRoot, 'primitives.mjs')
const realAvatars = pathToFileURL(path.resolve('packages/plugin-ui/src/avatars.ts')).href

writeFileSync(
  reactStub,
  [
    '// React 最小桩：createElement 交给测试里的元素工厂，状态由测试按位置注入。',
    'const React = {',
    '  createElement: (...args) => globalThis.__dshH(...args),',
    "  Fragment: 'fragment',",
    '  useState: (initial) => globalThis.__dshUseState(initial),',
    '  useEffect: () => {},',
    '}',
    'export default React',
    '',
  ].join('\n'),
)
writeFileSync(
  pluginUiStub,
  [
    '// 头像预设直接复用公共包的真实数据；h / 请求换成测试桩。',
    `export { AVATAR_BY_ID, AVATARS, DEFAULT_AVATAR_ID, findAvatarPreset } from '${realAvatars}'`,
    'export const h = (...args) => globalThis.__dshH(...args)',
    'export const messageOf = (failure) =>',
    '  failure instanceof Error ? failure.message : String(failure ?? "")',
    'export const requestJson = async () => {',
    '  throw new Error("client test: network is disabled")',
    '}',
    '',
  ].join('\n'),
)
writeFileSync(
  primitivesStub,
  [
    '// 基座组件桩：每个导出把 props 交给测试里的分发器，由它返回可检查的元素。',
    'const primitive = (name) => (props) => globalThis.__dshPrimitive(name, props)',
    ...PRIMITIVE_NAMES.map((name) => `export const ${name} = primitive(${JSON.stringify(name)})`),
    '',
  ].join('\n'),
)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react') return { url: pathToFileURL(reactStub).href, shortCircuit: true }
    if (specifier === '@buka/plugin-ui') {
      return { url: pathToFileURL(pluginUiStub).href, shortCircuit: true }
    }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      return { url: pathToFileURL(primitivesStub).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

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
 * 载入浏览器一半，返回注册到 `main` 的页面组件。
 *
 * @returns {Promise<{
 *   render: (states: Array<any>) => any,
 *   css: () => string,
 * }>}
 */
async function loadClient() {
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
        'aria-pressed': props['aria-pressed'],
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

  // 基座组件桩在模块求值时就调用这个分发器，所以每次 loadClient 都重新赋值。
  globalThis.__dshPrimitive = (name, props) => {
    if (name === 'Button') return ButtonStub(props)
    if (name === 'Input') return InputStub(props)
    if (name === 'Modal') return ModalStub(props)
    if (name === 'Tag') return TagStub(props)
    if (name === 'Tooltip') return TooltipStub(props)
    if (name === 'SegmentedTabs') return SegmentedTabsStub(props)
    if (name === 'StateDot') return StateDotStub(props)
    if (name === 'Toast') return ToastStub(props)
    return IconStub()
  }
  globalThis.__dshH = h
  globalThis.__dshUseState = (initial) => {
    const queue = globalThis.__dshStateQueue ?? []
    const index = globalThis.__dshStateIndex ?? 0
    const value = index < queue.length ? queue[index] : initial
    globalThis.__dshStateIndex = index + 1
    return [value, () => {}]
  }

  /** @type {Record<string, Function>} */
  const components = {}
  let clientModule = null
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
  try {
    loadSequence += 1
    const url = `${pathToFileURL(CLIENT_PATH).href}?smoke=${loadSequence}`
    clientModule = await import(url)
    assert.equal(typeof clientModule.apply, 'function', 'client module should export apply')
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
        globalThis.__dshStateQueue = [...states]
        globalThis.__dshStateIndex = 0
        return components.page({ t: (key) => zh[key] ?? key, getService: () => null })
      },
    }
  } finally {
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
  driverAgent: 'Agent 型',
  driverProgram: '程序型',
  assistantBadge: '助理',
  setAssistant: '设为助理',
  clearAssistant: '取消助理',
  assistantSet: '已设为助理。',
  assistantCleared: '已取消助理。',
  assistantSaveFailed: '修改助理标记失败：',
  filterAssistants: '只看助理',
  showAllRobots: '全部机器人',
  assistantEmpty: '还没有标记为助理的机器人。',
  programReadOnly: 'program 机器人由插件驱动：没有目录，不能开会话、编辑或安装 skills。',
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
 * @param {string} [description]
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function robot(name, avatar, description = '', overrides = {}) {
  return {
    name,
    driver: 'agent',
    program: '',
    assistant: false,
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
    ...overrides,
  }
}

/**
 * 内建 program 机器人 clock：没有目录、skills 与 AGENTS.md。
 *
 * @returns {Record<string, any>}
 */
function clockRobot() {
  return robot('clock', 'ghost', '到点完成任务的定时机器人', {
    driver: 'program',
    program: 'clock',
    path: '',
    exists: false,
    mounted: false,
    workspaceId: null,
  })
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
 *   assistantOnly?: boolean,
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
  assistantOnly = false,
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
    assistantOnly, // assistantOnly
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

test('机器人页：program 机器人只读，没有新会话 / 挂载 / 删除 / 助理入口', async () => {
  const client = await loadClient()
  const data = listData()
  data.robots = [clockRobot()]
  const tree = client.render(states({ data }))
  const list = collect(tree)

  // 驱动与职责展示；明确说明只读。
  assert.ok(list.texts.includes('程序型'))
  assert.ok(list.texts.includes('到点完成任务的定时机器人'))
  assert.ok(
    list.texts.includes('program 机器人由插件驱动：没有目录，不能开会话、编辑或安装 skills。'),
  )
  // 没有新会话 / 挂载 / 删除 / 助理入口，也不显示目录缺失警告。
  assert.equal(list.texts.includes('新会话'), false)
  assert.equal(list.texts.includes('删除'), false)
  assert.equal(list.texts.includes('设为助理'), false)
  assert.equal(list.texts.includes('目录缺失'), false)

  const card = findNode(
    tree,
    (node) =>
      node.type === 'li' && String(node.props?.className ?? '').includes('buka-robots-card'),
  )
  assert.ok(card, '列表里有 clock 卡片')
  assert.ok(!String(card.props?.className).includes('is-clickable'), 'program 卡片不可点进详情')
  const title = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '打开详情 clock',
  )
  assert.equal(title?.props?.disabled, true, 'program 卡片的标题按钮禁用')
})

test('机器人页：agent 机器人可设 / 取消助理，并可按助理筛选', async () => {
  const client = await loadClient()

  // assistant=false：展示 Agent 驱动标签与「设为助理」入口。
  let tree = client.render(states({ data: listData() }))
  let list = collect(tree)
  assert.ok(list.texts.includes('Agent 型'))
  assert.equal(list.texts.includes('助理'), false)
  const setButton = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '设为助理 writer',
  )
  assert.ok(setButton, 'agent 机器人有「设为助理」按钮')
  assert.equal(setButton.props?.disabled, false)

  // assistant=true：展示助理标签与「取消助理」入口。
  const marked = listData()
  marked.robots = [
    robot('writer', 'panda', '写发布说明与测试报告', { assistant: true }),
    clockRobot(),
  ]
  tree = client.render(states({ data: marked }))
  list = collect(tree)
  assert.ok(list.texts.includes('助理'))
  const clearButton = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '取消助理 writer',
  )
  assert.ok(clearButton, 'agent 助理可以取消助理标记')

  // 筛选按钮；助理筛选打开时只保留 assistant=true 的机器人。
  tree = client.render(states({ data: marked, assistantOnly: true }))
  list = collect(tree)
  assert.ok(list.texts.includes('全部机器人'), '筛选打开时按钮切到「全部机器人」')
  assert.ok(list.texts.includes('writer'))
  assert.equal(list.texts.includes('clock'), false)

  // 没有任何助理时给独立空状态，而不是「还没有机器人」。
  tree = client.render(states({ data: listData(), assistantOnly: true }))
  list = collect(tree)
  assert.ok(list.texts.includes('还没有标记为助理的机器人。'))
})

test.after(() => {
  rmSync(stubRoot, { recursive: true, force: true })
})
