/**
 * 合并包浏览器一半的执行者页渲染冒烟测试。
 *
 * 直接 import `src/client/index.ts`（合并后的入口，注册唯一的首页，顶部两个
 * 页签：工作流 / 执行者；Node 负责剥类型），用 `module.registerHooks` 把
 * `react` / `@buka/plugin-ui` / `@deepseek-ai/dsh-client-ui-primitives` 换成
 * 最小桩：页面组件只在渲染期用 `React.createElement`、`useState`、`useEffect`
 * 与基座按钮 / 标签，所以不需要构建 `lib/client.js` 也能抓到渲染函数里的运行时
 * 错误。随后按页面的 `useState` 顺序注入状态（首页页签排第 0 位，执行者页状态
 * 从第 1 位开始），直接调用注册到 `main` 的首页组件并停在执行者页签，检查列表
 * 卡片与各对话框是否按状态渲染。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const CLIENT_PATH = path.resolve('plugins/workflows/src/client/index.ts')

/** 浏览器一半源码里用到的全部基座导出；桩模块必须静态导出这些名字。 */
const PRIMITIVE_NAMES = [
  'Button',
  'CodeBlock',
  'FileTypeIcon',
  'IconChevronRightOutlineRegular',
  'IconChevronDownOutlineRegular',
  'IconCloseOutlineRegular',
  'IconDownloadOutlineRegular',
  'IconEditOutlineRegular',
  'IconFolderOpenOutlineRegular',
  'IconInfoOutlineRegular',
  'IconNewChatOutlineRegular',
  'IconPlusOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconSettingsOutlineRegular',
  'IconTrashOutlineRegular',
  'IconWarningOutlineRegular',
  'Input',
  'MarkdownText',
  'Menu',
  'ReadBlock',
  'Modal',
  'SegmentedTabs',
  'StateDot',
  'Tag',
  'Toast',
  'Tooltip',
]

/** 桩模块目录；必须在第一次 import 浏览器一半之前落盘。 */
const stubRoot = mkdtempSync(path.join(tmpdir(), 'buka-workers-client-stubs-'))
const reactStub = path.join(stubRoot, 'react.mjs')
const pluginUiStub = path.join(stubRoot, 'plugin-ui.mjs')
const primitivesStub = path.join(stubRoot, 'primitives.mjs')
const realAvatars = pathToFileURL(path.resolve('packages/plugin-ui/src/avatars.ts')).href
const realWorkerLabel = pathToFileURL(path.resolve('packages/plugin-ui/src/worker-label.ts')).href

writeFileSync(
  reactStub,
  [
    '// React 最小桩：createElement 交给测试里的元素工厂，状态由测试按位置注入。',
    'const React = {',
    '  createElement: (...args) => globalThis.__dshH(...args),',
    "  Fragment: 'fragment',",
    '  useState: (initial) => globalThis.__dshUseState(initial),',
    '  useEffect: () => {},',
    '  useRef: (value) => ({ current: value }),',
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
    `export { workerDisplayName, workerIdentityLabel } from '${realWorkerLabel}'`,
    "export const TabLabel = (props) => globalThis.__dshH('span', { className: 'x-tabLabel' }, props.text)",
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
    'export const languageForPath = (value) =>',
    "  typeof value === 'string' && value.includes('.') ? value.split('.').pop() : ''",
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
    // 函数组件只展开一次并缓存：首页包裹了执行者页组件，同一棵树被反复
    // 遍历时不能再消费页面内部的 useState（第二次展开会越界回落到初值）。
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
        onClick: props.onClick,
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
      'aria-label': props['aria-label'],
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
        h('button', { key: item.value, className: 'x-tab', role: 'tab' }, item.label),
      ),
    )
  }

  function MenuStub(props) {
    return h(
      'span',
      { className: 'x-menu' },
      props.anchor,
      ...(props.open === true
        ? (props.items ?? []).map((item) =>
            h('button', { key: item.id, className: 'x-menuItem' }, item.label),
          )
        : []),
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
    if (name === 'Menu') return MenuStub(props)
    if (name === 'ReadBlock') {
      return h(
        'div',
        { className: 'x-readBlock', 'data-label': props.label },
        ...(props.lines ?? []).map((line) => h('div', { className: 'x-readBlockLine' }, line.text)),
      )
    }
    if (name === 'FileTypeIcon') return IconStub()
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
  /** 首页注册时 `inject` 工厂的返回值：页面收到的 props 就是这一份。 */
  let injectedProps = {}

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
          // 合并后的 client 只注册一个首页（两个页签）；测试取它并停在执行者页签。
          const key = options.key ?? options.id ?? (options.name === 'main' ? 'page' : 'icon')
          components[key] = component
          if (typeof options.inject === 'function') injectedProps = options.inject()
          return () => {}
        },
      },
    })
    assert.equal(
      typeof components['workflow'],
      'function',
      'client should register the merged home page component',
    )
    return {
      css: () => css,
      /** 首页注册时注入的 props（`getService` / `workersT`）。 */
      injected: () => injectedProps,
      /**
       * 用预设的 state 顺序渲染一次首页（停在执行者页签）。
       *
       * @param {Array<any>} states
       * @returns {any}
       */
      render(states) {
        // 首页（HomePage）的页签 useState 占第 0 位，执行者页状态从第 1 位开始。
        globalThis.__dshStateQueue = ['worker', ...states]
        globalThis.__dshStateIndex = 0
        return components['workflow']({
          t: (key) => zh[key] ?? key,
          // 执行者页的 `t` 来自 main 插槽的 inject；这里刻意不再兜底成正确翻译，
          // 让「inject 多包一层函数」这类问题在测试里直接暴露成空文案。
          workersT: injectedProps.workersT,
          getService: () => null,
        })
      },
    }
  } finally {
    delete globalThis.document
  }
}

/** 截图 / 断言用到的中文文案。 */
const zh = {
  topTabWorkflow: '工作流',
  topTabWorker: '执行者',
  topTabsAria: '主视图',
  title: '执行者',
  refresh: '刷新',
  create: '创建执行者',
  empty: '还没有执行者。',
  mountedBadge: '已挂载',
  unmountedBadge: '未挂载',
  skillsBadge: '{n} skills',
  newSession: '新会话',
  openDetail: '打开详情',
  driverAgent: '智能体',
  driverRobot: '机器人',
  builtinWorker: '内置',
  descriptionLabel: '职责',
  descriptionPlaceholder: '例如：负责把会议记录整理成三点结论',
  descriptionHint:
    '工作流会读它来决定是否把节点交给这个执行者；用一句话写清这个执行者负责什么。修改后自动保存。',
  tabSettings: '设置',
  modelTitle: '模型',
  modelHint:
    '选择这个智能体新开会话时使用的模型；已有会话保留自己的模型，可以在会话里用 /model 切换。',
  modelFollowDefault: '跟随默认模型',
  modelFollowDefaultHint: '新会话使用宿主当前默认模型。',
  modelProvider: '提供方',
  modelModelLabel: '模型',
  modelEffort: '推理强度',
  modelEffortDefault: '适配器默认',
  modelCurrent: '当前模型：',
  modelSaved: '已保存模型。',
  modelSaveFailed: '保存模型失败：',
  modelLoadFailed: '读取模型目录失败：',
  modelEmpty: '当前没有可用模型，请先在 DSH 的模型设置里配置提供方。',
  modelSomeFailed: '部分提供方读取失败：',
  modelUnavailable: '当前组合没有模型目录（ctx.llm 不可用），无法为智能体选择模型。',
  presetTitle: '模式',
  presetHint:
    '选择这个执行者新开会话时使用的执行者预设；任务类型可以单独覆盖。改动后自动保存，只影响之后新开的会话。',
  presetFollowWorkflow: '跟随工作流默认',
  presetFollowWorkflowHint: '新会话使用工作流插件配置的默认模式。',
  presetCurrent: '当前模式：',
  presetBroken: '这个模式无法启动会话：',
  presetSaveFailed: '保存模式失败：',
  presetLoadFailed: '读取模式失败：',
  presetUnavailable: '当前组合没有执行者预设服务（ctx.agentPresets 不可用），无法选择模式。',
  errInvalidModel: '模型选择不合法，请选择提供方与模型。',
  loading: '正在读取…',
  descriptionSaved: '职责已保存。',
  descriptionSaveFailed: '保存职责失败：',
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  createFieldId: '标识符',
  createIdPlaceholder: '标识符，如 writer',
  createIdHint:
    '必填，创建后不可修改；它同时是执行者目录名与工作流引用键。只能用小写字母、数字、_ 与 -，且以小写字母开头。',
  createFieldName: '名称（可选）',
  createNamePlaceholder: '展示名，如 写作助手',
  createNameHint: '只用于展示，可随时修改；留空时显示标识符。',
  createEmptyId: '先填一个执行者标识符。',
  errInvalidId:
    '标识符不合法：需匹配 ^[a-z][a-z0-9_-]{0,63}$（小写字母开头，可带小写字母、数字、_ 与 -），且创建后不可修改。',
  errIdTaken: '这个标识符已被占用，请换一个。',
  nameLabel: '名称',
  nameHint: '只改展示名：目录与工作区都保持原位；留空表示清空名称、显示标识符。修改后自动保存。',
  nameSaveFailed: '保存名称失败：',
  autosavePending: '待保存…',
  mount: '挂载',
  delete: '删除',
  tabsLabel: '执行者详情页签',
  tabFiles: '文件',
  tabSkills: '技能',
  tabSkillsHasUpdate: '技能（有更新）',
  installSkills: '安装 skills',
  installDialogTitle: '安装 skills',
  installReposLabel: '技能仓库',
  repoUnavailable: '不可用',
  loadingSkills: '正在读取 skills…',
  skillsFound: '共 {n} 个 skills',
  selectAllSkills: '全选',
  selectedSkills: '已选 {n} / {m}',
  alreadyInstalled: '已安装',
  installedHint: '已安装的 skill 不能重复勾选。',
  installSelected: '安装选中的',
  close: '关闭',
  reveal: '打开 Finder',
  openInApp: '用 {app} 打开',
  openWithChoose: '选择打开方式',
  openInAppFailed: '打开执行者目录失败：',
  appFinder: '访达',
  appTerminal: '终端',
  filesTitle: '文件',
  filesHint: '以只读方式浏览执行者目录；内容显示在右侧，编辑与保存交给 builder 工具。',
  filesTreeAria: '执行者目录树',
  filesSelectFile: '选择一个文件查看内容。',
  filesEmpty: '这个执行者目录里还没有文件。',
  filesLoadFailed: '读取目录失败：',
  filesReadFailed: '读取文件失败：',
  filesTooLarge: '文件大小 {n}，超过 256 KiB 的预览上限；请用外部编辑器打开。',
  filesBinary: '这是二进制文件，不提供预览。',
  filesEmptyFile: '这个文件是空的。',
  filesTruncated: '目录较大，只展示了一部分。',
  filesLinesTruncated: '文件较长，只显示前 {n} 行。',
  filesCode: '代码',
  filesWrap: '自动换行',
  filesUnwrap: '取消换行',
  filesCopy: '复制',
  filesCopied: '已复制',
  filesWindow: '显示 {shown} / {total} 行',
  filesCollapseAria: '折叠隐藏行',
  filesExpandAria: '展开 {n} 个隐藏行',
  filesCollapse: '折叠',
  filesExpand: '展开',
  deleteTitle: '删除执行者',
  deleteConfirm: '永久删除',
  deleting: '正在删除…',
  deleteHardDeleteNote:
    '删除是硬删：登记条目、执行者目录与工作区注册会一起消失。目录里的 AGENTS.md 与项目 skills 也会一起消失，没有回收站。',
  deleteImpactLoading: '正在读取删除影响面…',
  deleteImpactFailed: '读取删除影响面失败：',
  deleteDir: '将被删除的目录',
  deleteMounted: '这个执行者已挂载，工作区注册会一起摘掉。',
  deleteNotMounted: '这个执行者没有挂载，没有工作区注册需要摘掉。',
  deleteFinishedJobs: '引用它的已结束作业数：',
  deleteAffectedWorkflows: '会因此变成不可用的工作流：',
  deleteNoWorkflows: '没有工作流引用这个执行者。',
  deleteOpenJob: '打开作业',
  deleteBlockedTitle: '运行中的作业阻塞删除',
  deleteBlockedByJobs:
    '有引用这个执行者的运行中作业。请先在这些作业的作业页主动终止它们，再回来删除；不提供强制删除。',
}

/**
 * 一条执行者记录。
 *
 * @param {string} id
 * @param {string} avatar
 * @param {string} [description]
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function worker(id, avatar, description = '', overrides = {}) {
  return {
    id,
    name: '',
    driver: 'agent',
    program: '',
    path: `/Users/x/.cache/dsh-plugin-workers/workers/${id}`,
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
 * 内建机器人 clock：没有目录、skills 与 AGENTS.md。
 *
 * @returns {Record<string, any>}
 */
function clockWorker() {
  return worker('clock', 'ghost', '到点完成任务的定时执行者', {
    driver: 'robot',
    program: 'clock',
    builtin: true,
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
    root: '/Users/x/.cache/dsh-plugin-workers/workers',
    registry: '/Users/x/.cache/dsh-plugin-workers/workers.json',
    corrupt: false,
    workers: [worker('writer', 'panda', '写发布说明与测试报告')],
  }
}

/** 「文件」页签的空状态，形状与 `state.ts` 的 `EMPTY_FILES` 一致。 */
function emptyFiles() {
  return {
    workerId: null,
    treeStatus: 'idle',
    tree: null,
    truncated: false,
    treeError: null,
    selectedPath: '',
    contentStatus: 'idle',
    content: null,
    contentError: null,
  }
}

/**
 * 页面状态数组：顺序必须与 `WorkersPage` 里的 `React.useState` 一致。
 *
 * @param {{
 *   data?: Record<string, any>,
 *   selectedName?: string | null,
 *   dialogOpen?: boolean,
 *   draftDescription?: string,
 *   descriptionDraft?: string,
 *   nameDraft?: string,
 *   nameSaving?: boolean,
 *   nameError?: string | null,
 *   tab?: string,
 *   files?: Record<string, any>,
 *   installOpen?: boolean,
 *   installSource?: string,
 *   installCandidates?: Record<string, any>,
 *   installSelected?: string[],
 *   installing?: boolean,
 *   installRepos?: Record<string, any>,
 * }} [options]
 * @returns {Array<any>}
 */
function states({
  data = listData(),
  selectedId = null,
  dialogOpen = false,
  draftDescription = '',
  descriptionDraft = '',
  nameDraft = '',
  nameSaving = false,
  nameError = null,
  modelCatalog = { status: 'idle', data: null, error: null },
  modelDraft = null,
  modelSaving = false,
  modelError = null,
  agentPresetCatalog = { status: 'idle', data: null, error: null },
  agentPresetDraft = null,
  agentPresetSaving = false,
  agentPresetError = null,
  tab = 'settings',
  files = emptyFiles(),
  deleteDialog = { target: null, impact: null, loading: false, error: null, saving: false },
  skillChecks = { workerId: null, status: 'idle', results: {}, error: null },
  installOpen = false,
  installSource = '',
  installCandidates = { status: 'idle', skills: [], installed: [], error: null, output: '' },
  installSelected = [],
  installing = false,
  installRepos = { status: 'unavailable', repos: [], corrupt: false, error: null },
  openInApps = { status: 'loading', apps: [] },
  openInAppChoice = '',
} = {}) {
  return [
    { data, error: null, loading: false }, // list
    0, // reloadKey
    '', // createId
    '', // createName
    draftDescription, // draftDescription
    dialogOpen, // dialogOpen
    null, // createError
    false, // creating
    deleteDialog, // deleteDialog
    null, // busy
    'panda', // draftAvatar
    false, // avatarOpen
    null, // avatarTarget
    false, // avatarSaving
    null, // avatarError
    descriptionDraft, // descriptionDraft
    false, // descriptionSaving
    null, // descriptionError
    nameDraft, // nameDraft
    nameSaving, // nameSaving
    nameError, // nameError
    modelCatalog, // modelCatalog
    modelDraft, // modelDraft
    modelSaving, // modelSaving
    modelError, // modelError
    agentPresetCatalog, // agentPresetCatalog
    agentPresetDraft, // agentPresetDraft
    agentPresetSaving, // agentPresetSaving
    agentPresetError, // agentPresetError
    selectedId, // selectedId
    tab, // tab
    files, // files
    null, // removing
    deleteDialog, // deleteDialogSkill
    null, // skillError
    installOpen, // installOpen
    installSource, // installSource
    installCandidates, // installCandidates
    installSelected, // installSelected
    null, // installError
    installing, // installing
    installRepos, // installRepos
    null, // notice
    skillChecks, // skillChecks
    null, // updatingSkill
    false, // updatingAllSkills
    openInApps, // openInApp
    openInAppChoice, // openInAppChoice
  ]
}

test('执行者详情：独立页头，不显示首页的工作流 / 执行者页签', async () => {
  const client = await loadClient()
  const tabLabels = (tree) =>
    collect(tree)
      .nodes.filter((node) => node.props?.role === 'tab')
      .map((node) => collect(node).texts.join(''))

  // 详情页只保留自己的「设置 / 文件 / 技能」页签。
  const detail = client.render(states({ data: listData(), selectedId: 'writer' }))
  assert.deepEqual(tabLabels(detail), ['设置', '文件', '技能'])
  assert.ok(collect(detail).texts.includes('writer'), '详情标题仍在')

  // 列表页仍以首页两个页签作为标题。
  const list = client.render(states({ data: listData() }))
  assert.deepEqual(tabLabels(list), ['工作流', '执行者'])
})

test('执行者详情：下划线页签的 ARIA 与「技能」更新圆点', async () => {
  const client = await loadClient()

  const withUpdate = client.render(
    states({
      data: listData(),
      selectedId: 'writer',
      skillChecks: {
        workerId: 'writer',
        status: 'ready',
        results: { alpha: { name: 'alpha', status: 'update' } },
        error: null,
      },
    }),
  )
  const tabs = collect(withUpdate).nodes.filter((node) => node.props?.role === 'tab')
  assert.equal(tabs.length, 3, '三个页签都带 role=tab')
  assert.deepEqual(
    tabs.map((node) => node.props?.['aria-selected']),
    [true, false, false],
  )
  assert.deepEqual(
    tabs.map((node) => node.props?.tabIndex),
    [0, -1, -1],
    '只有选中页签是 Tab 停靠点',
  )
  assert.equal(tabs[0].props?.['aria-controls'], 'workflow-workers-panel-settings')
  assert.equal(tabs[2].props?.['aria-controls'], 'workflow-workers-panel-skills')

  const skillsTab = tabs[2]
  assert.ok(
    collect(skillsTab).nodes.some((node) =>
      String(node.props?.className ?? '').includes('buka-workflows-detailTabDot'),
    ),
    '有更新时「技能」页签带圆点',
  )
  assert.equal(skillsTab.props?.['aria-label'], '技能（有更新）')

  const noUpdate = client.render(states({ data: listData(), selectedId: 'writer' }))
  const plainTabs = collect(noUpdate).nodes.filter((node) => node.props?.role === 'tab')
  assert.equal(
    collect(plainTabs[2]).nodes.some((node) =>
      String(node.props?.className ?? '').includes('buka-workflows-detailTabDot'),
    ),
    false,
    '没有更新时不显示圆点',
  )
})

test('执行者详情：「安装 skills」在页头工具栏最右侧，技能区块不再有该按钮', async () => {
  const client = await loadClient()

  for (const tab of ['settings', 'skills']) {
    const tree = client.render(states({ data: listData(), selectedId: 'writer', tab }))
    const installButtons = collect(tree).nodes.filter(
      (node) => node.type === 'button' && (node.children ?? []).includes('安装 skills'),
    )
    assert.equal(installButtons.length, 1, `「${tab}」页签只有页头一个安装入口`)
  }

  // 页头工具栏的最后一个按钮就是安装入口（新会话 / 打开目录 / 刷新之后）。
  const tree = client.render(states({ data: listData(), selectedId: 'writer' }))
  const toolbar = findNode(
    tree,
    (node) => String(node.props?.className ?? '') === 'buka-workers-toolbar',
  )
  assert.ok(toolbar, '详情页有工具栏')
  const toolbarButtons = collect(toolbar).nodes.filter((node) => node.type === 'button')
  assert.ok(
    (toolbarButtons.at(-1)?.children ?? []).includes('安装 skills'),
    '安装入口在工具栏最右侧',
  )
})

test('安装 skills 弹窗：来源只读技能仓库，不提供手填来源', async () => {
  const client = await loadClient()
  const tree = client.render(
    states({
      data: listData(),
      selectedId: 'writer',
      tab: 'skills',
      installOpen: true,
      installSource: 'owner/repo',
      installCandidates: {
        status: 'ready',
        skills: [
          { name: 'alpha', description: 'first' },
          { name: 'beta', description: 'second' },
        ],
        installed: ['beta'],
        error: null,
        output: '',
      },
      installSelected: ['alpha'],
      installRepos: {
        status: 'ready',
        corrupt: false,
        error: null,
        repos: [
          { id: 'r1', source: 'owner/repo', note: '团队技能', kind: 'npx-skills', skills: 2 },
          { id: 'r2', source: 'other/repo', note: '', kind: 'unavailable', skills: 0 },
        ],
      },
    }),
  )
  const { texts, nodes } = collect(tree)

  assert.ok(texts.includes('技能仓库'), '对话框只展示技能仓库区块')
  assert.ok(texts.includes('owner/repo'), '收藏来源出现在弹窗里')
  assert.ok(texts.includes('团队技能'), '收藏备注出现在弹窗里')
  assert.ok(texts.includes('2 skills'), '展示收藏仓库的 skill 数')
  assert.ok(texts.includes('不可用'), '不可用仓库带标签')
  assert.ok(
    findNode(
      tree,
      (node) =>
        String(node.props?.className ?? '')
          .split(' ')
          .includes('buka-workers-repo') && node.props?.['aria-pressed'] === true,
    ),
    '当前来源的仓库高亮',
  )
  assert.equal(
    nodes.filter((node) => node.type === 'input' && node.props?.type === 'text').length,
    0,
    '不再提供手填来源的输入框',
  )
  assert.ok(texts.includes('alpha'), '候选 skill 列出')
  assert.ok(texts.includes('已安装'), '已安装项带标签')
})

test('执行者详情：「打开」优先用内置 open-in-app，不可用时退回 Finder', async () => {
  const client = await loadClient()

  // 应用清单加载中 / 不可用：保留原来的 Finder 按钮。
  const fallback = client.render(states({ data: listData(), selectedId: 'writer' }))
  assert.ok(
    findNode(
      fallback,
      (node) => node.type === 'button' && node.props?.['aria-label'] === '打开 Finder writer',
    ),
    '清单不可用时显示「打开 Finder」',
  )

  // 清单可用：分体按钮用上次选中的应用，箭头打开选择菜单。
  const ready = client.render(
    states({
      data: listData(),
      selectedId: 'writer',
      openInApps: { status: 'ready', apps: ['finder', 'vscode', 'terminal'] },
      openInAppChoice: 'vscode',
    }),
  )
  const main = findNode(
    ready,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '用 VS Code 打开',
  )
  assert.ok(main, '主按钮显示上次选中的应用')
  assert.ok((main.children ?? []).includes('VS Code'), '主按钮用应用名代替「用…打开」文案')
  const chevron = findNode(
    ready,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '选择打开方式',
  )
  assert.ok(chevron, '有下拉箭头')
  assert.equal(chevron.props?.['aria-haspopup'], 'menu')

  // 记住的应用不在清单里时退回清单第一项。
  const missing = client.render(
    states({
      data: listData(),
      selectedId: 'writer',
      openInApps: { status: 'ready', apps: ['finder', 'terminal'] },
      openInAppChoice: 'cursor',
    }),
  )
  assert.ok(
    findNode(
      missing,
      (node) => node.type === 'button' && node.props?.['aria-label'] === '用 访达 打开',
    ),
    '选择失效时用清单第一项',
  )
})

test('执行者页：main 插槽注入的 workersT 是已绑定的翻译函数', async () => {
  const client = await loadClient()
  const { workersT } = client.injected()
  // 插槽把 inject 返回值里的函数当普通 prop 传，不会再调用；多包一层时
  // `workersT('title')` 会返回函数，于是页签 / 按钮文案全部为空。
  assert.equal(typeof workersT, 'function')
  assert.equal(workersT('title'), '执行者')
  assert.equal(workersT('skillsBadge'), '{n} skills')
})

test('执行者页：卡片与职责页签展示职责，创建对话框带职责字段', async () => {
  const client = await loadClient()
  const description = '写发布说明与测试报告'

  // 列表卡片直接展示职责，便于比较执行者。
  const list = collect(client.render(states({ data: listData() })))
  assert.ok(list.texts.includes(description))

  // 职责在「设置」页签：说明 + textarea，没有保存按钮（修改即自动保存）。
  const tabStates = {
    data: listData(),
    selectedId: 'writer',
    descriptionDraft: description,
    tab: 'settings',
  }
  const detail = collect(client.render(states(tabStates)))
  assert.ok(detail.texts.includes('职责'))
  assert.ok(
    detail.texts.indexOf('设置') < detail.texts.indexOf('文件') &&
      detail.texts.indexOf('文件') < detail.texts.indexOf('技能'),
    '页签顺序为设置、文件、技能',
  )
  assert.ok(
    detail.texts.includes(
      '工作流会读它来决定是否把节点交给这个执行者；用一句话写清这个执行者负责什么。修改后自动保存。',
    ),
  )
  assert.equal(
    findNode(detail, (node) => node.type === 'button' && (node.children ?? []).includes('保存')),
    null,
    '设置页签没有保存按钮',
  )
  const draftField = findNode(
    client.render(states(tabStates)),
    (node) => node.type === 'textarea' && node.props?.value === description,
  )
  assert.ok(draftField)

  // 文件页签不显示职责编辑器。
  const filesTab = client.render(states({ data: listData(), selectedId: 'writer', tab: 'files' }))
  assert.equal(
    findNode(filesTab, (node) => node.type === 'textarea' && node.props?.['aria-label'] === '职责'),
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

test('执行者页：文件页签只读展示目录树与代码内容，没有编辑器与保存按钮', async () => {
  const client = await loadClient()
  const files = {
    workerId: 'writer',
    treeStatus: 'ready',
    tree: [
      { name: 'AGENTS.md', path: 'AGENTS.md', kind: 'file', bytes: 32 },
      {
        name: '.agents',
        path: '.agents',
        kind: 'directory',
        children: [{ name: 'skills', path: '.agents/skills', kind: 'directory', children: [] }],
      },
    ],
    truncated: false,
    treeError: null,
    selectedPath: 'AGENTS.md',
    contentStatus: 'ready',
    content: {
      ok: true,
      path: 'AGENTS.md',
      bytes: 32,
      content: '# AGENTS.md\n\n负责写发布说明。',
      tooLarge: false,
      binary: false,
      maxBytes: 262144,
    },
    contentError: null,
  }
  const detail = client.render(
    states({ data: listData(), selectedId: 'writer', tab: 'files', files }),
  )
  const texts = collect(detail).texts
  assert.ok(texts.includes('文件'), '页签名为「文件」')
  assert.ok(texts.includes('AGENTS.md'), '目录树列出文件')
  assert.ok(texts.includes('负责写发布说明。'), '右侧展示代码内容')
  assert.ok(texts.includes('.agents'), '目录树列出子目录')
  assert.equal(
    findNode(detail, (node) => node.type === 'textarea'),
    null,
    '文件页签不渲染编辑器',
  )
  assert.equal(
    findNode(detail, (node) => node.type === 'button' && (node.children ?? []).includes('保存')),
    null,
    '文件页签没有保存按钮',
  )
})

test('执行者页：创建对话框有必填标识符与可选名称，列表 / 详情显示「名称 · id」', async () => {
  const client = await loadClient()
  const data = listData()
  data.workers = [worker('writer', 'panda', '写发布说明与测试报告', { name: '写作助手' })]

  // 列表标题同时给出展示名与标识符，避免同名执行者无法区分。
  const list = collect(client.render(states({ data })))
  assert.ok(list.texts.includes('写作助手 · writer'))

  // 详情标题同样显示「名称 · id」。
  const detail = collect(client.render(states({ data, selectedId: 'writer' })))
  assert.ok(detail.texts.includes('写作助手 · writer'))

  // 创建对话框：标识符必填且创建后不可改，名称可选。
  const dialog = client.render(states({ data, dialogOpen: true }))
  const idField = findNode(
    dialog,
    (node) => node.type === 'input' && node.props?.placeholder === '标识符，如 writer',
  )
  assert.ok(idField, '创建对话框有标识符输入框')
  assert.equal(idField.props?.maxLength, 64)
  assert.equal(idField.props?.['data-modal-autofocus'], '')
  const nameField = findNode(
    dialog,
    (node) => node.type === 'input' && node.props?.placeholder === '展示名，如 写作助手',
  )
  assert.ok(nameField, '创建对话框有可选名称输入框')
  const dialogTexts = collect(dialog).texts
  assert.ok(dialogTexts.includes('标识符'))
  assert.ok(dialogTexts.includes('名称（可选）'))
  assert.ok(
    dialogTexts.includes(
      '必填，创建后不可修改；它同时是执行者目录名与工作流引用键。只能用小写字母、数字、_ 与 -，且以小写字母开头。',
    ),
  )

  // 标识符非法 / 已被占用时创建按钮禁用。
  const createButton = (state) =>
    collect(client.render(state)).nodes.find(
      (node) => node.type === 'button' && node.props?.type === 'submit',
    )
  const invalidStates = states({ data, dialogOpen: true })
  invalidStates[2] = 'Writer'
  assert.equal(createButton(invalidStates)?.props?.disabled, true, '非法标识符不能创建')
  const takenStates = states({ data, dialogOpen: true })
  takenStates[2] = 'writer'
  assert.equal(createButton(takenStates)?.props?.disabled, true, '已有标识符不能创建')
  const validStates = states({ data, dialogOpen: true })
  validStates[2] = 'author'
  assert.equal(createButton(validStates)?.props?.disabled, false, '合法新标识符可以创建')
})

test('执行者页：展示名在「设置」页签里配置，标题行不再有重命名入口', async () => {
  const client = await loadClient()
  const data = listData()
  data.workers[0].name = 'writer'

  // 标题行不再有铅笔按钮，展示名只能在设置页签里改。
  const detail = client.render(states({ data, selectedId: 'writer' }))
  assert.equal(
    findNode(detail, (node) => node.props?.['aria-label'] === '重命名 writer'),
    null,
    '标题行没有重命名按钮',
  )

  // 设置页签第一块是「名称」：输入框带出当前名称、上限与自动保存提示。
  const settings = collect(
    client.render(states({ data, selectedId: 'writer', nameDraft: 'writer' })),
  )
  assert.ok(settings.texts.includes('名称'))
  assert.ok(
    settings.texts.includes(
      '只改展示名：目录与工作区都保持原位；留空表示清空名称、显示标识符。修改后自动保存。',
    ),
  )
  const field = findNode(
    client.render(states({ data, selectedId: 'writer', nameDraft: 'writer' })),
    (node) => node.type === 'input' && node.props?.['aria-label'] === '名称',
  )
  assert.ok(field, '设置页签有名称输入框')
  assert.equal(field.props?.value, 'writer')
  assert.equal(field.props?.maxLength, 64)

  // 目录缺失不影响改展示名（名称只写登记表，不碰磁盘）。
  const missingData = listData()
  missingData.workers[0].exists = false
  assert.ok(
    findNode(
      client.render(states({ data: missingData, selectedId: 'writer', nameDraft: 'writer' })),
      (node) => node.type === 'input' && node.props?.['aria-label'] === '名称',
    ),
    '目录缺失时仍可配置展示名',
  )

  // 保存中 / 有改动 / 失败都留在区块里，不弹对话框。
  const saving = collect(
    client.render(states({ data, selectedId: 'writer', nameDraft: 'author', nameSaving: true })),
  )
  assert.ok(saving.texts.includes('保存中…'))
  const dirty = collect(client.render(states({ data, selectedId: 'writer', nameDraft: 'author' })))
  assert.ok(dirty.texts.includes('待保存…'))
  const failed = collect(
    client.render(
      states({
        data,
        selectedId: 'writer',
        nameDraft: 'author',
        nameError: '保存名称失败：执行者名称已被占用',
      }),
    ),
  )
  assert.ok(failed.texts.includes('保存名称失败：执行者名称已被占用'))
})

test('执行者页：列表整行点击进详情，行内动作统一为 outline 按钮', async () => {
  const client = await loadClient()
  const tree = client.render(states({ data: listData() }))
  const list = collect(tree)

  // 不再有单独的「配置」按钮：进入详情靠整行点击 / 标题按钮。
  assert.ok(!list.texts.includes('配置'), '列表里不再有「配置」按钮文案')

  const card = findNode(
    tree,
    (node) =>
      node.type === 'li' && String(node.props?.className ?? '').includes('buka-workers-card'),
  )
  assert.ok(card, '列表里有执行者卡片')
  assert.equal(typeof card.props?.onClick, 'function', '整行可点击进入详情')
  assert.match(String(card.props?.className), /is-clickable/u)

  // 标题本身是按钮：键盘 Tab 能落到这里，点它把事件拦在行内，避免重复进入。
  const titleButton = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '打开详情 writer',
  )
  assert.ok(titleButton, '执行者名是进入详情的按钮')
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
  assert.match(String(deleteButton.props?.className), /buka-workers-danger/u)
  assert.equal(
    findNode(
      tree,
      (node) =>
        node.type === 'button' &&
        String(node.props?.className ?? '').includes('buka-workers-iconDanger'),
    ),
    null,
    '列表里不再有裸图标删除按钮',
  )

  // 写操作进行中（busy）时整行不进入详情，标题按钮也禁用。
  const busyStates = states({ data: listData() })
  busyStates[9] = 'delete:writer' // busy
  const busyTree = client.render(busyStates)
  const busyCard = findNode(
    busyTree,
    (node) =>
      node.type === 'li' && String(node.props?.className ?? '').includes('buka-workers-card'),
  )
  assert.ok(!String(busyCard.props?.className).includes('is-clickable'), '写操作中整行不可点')
  const busyTitle = findNode(
    busyTree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '打开详情 writer',
  )
  assert.equal(busyTitle.props?.disabled, true, '写操作中标题按钮禁用')
})

test('执行者页：机器人只读，没有新会话 / 挂载 / 删除 / 助理入口', async () => {
  const client = await loadClient()
  const data = listData()
  data.workers = [clockWorker()]
  const tree = client.render(states({ data }))
  const list = collect(tree)

  // 驱动、内建标记与职责展示。
  assert.ok(list.texts.includes('机器人'))
  assert.ok(list.texts.includes('内置'), 'built-in robots carry the built-in badge')
  assert.ok(list.texts.includes('到点完成任务的定时执行者'))
  // 没有新会话 / 挂载 / 删除 / 助理入口，也不显示目录缺失警告。
  assert.equal(list.texts.includes('新会话'), false)
  assert.equal(list.texts.includes('删除'), false)
  assert.equal(list.texts.includes('目录缺失'), false)

  const card = findNode(
    tree,
    (node) =>
      node.type === 'li' && String(node.props?.className ?? '').includes('buka-workers-card'),
  )
  assert.ok(card, '列表里有 clock 卡片')
  assert.ok(!String(card.props?.className).includes('is-clickable'), 'program 卡片不可点进详情')
  const title = findNode(
    tree,
    (node) => node.type === 'button' && node.props?.['aria-label'] === '打开详情 clock',
  )
  assert.equal(title?.props?.disabled, true, 'program 卡片的标题按钮禁用')
})

test('执行者页：列表与详情没有助理徽标、标记按钮或筛选', async () => {
  const client = await loadClient()
  const tree = client.render(states({ data: listData() }))
  const list = collect(tree)
  assert.ok(list.texts.includes('智能体'), 'the agent driver tag still renders')
  assert.equal(list.texts.includes('助理'), false, 'no assistant badge')
  assert.equal(list.texts.includes('设为助理'), false, 'no make-assistant button')
  assert.equal(list.texts.includes('取消助理'), false, 'no clear-assistant button')
  assert.equal(list.texts.includes('只看助理'), false, 'no assistants-only filter')

  const detail = collect(client.render(states({ data: listData(), selectedId: 'writer' })))
  assert.equal(detail.texts.includes('助理'), false, 'the detail page has no assistant badge')
  assert.equal(detail.texts.includes('设为助理'), false)
  assert.equal(detail.texts.includes('取消助理'), false)
})

test('执行者页：设置页签展示职责与模型，模型可选', async () => {
  const client = await loadClient()
  const data = listData()
  data.workers[0].model = { provider: 'p1', model: 'm1' }
  const tree = client.render(
    states({
      data,
      selectedId: 'writer',
      tab: 'settings',
      modelDraft: { provider: 'p1', model: 'm1' },
      modelCatalog: {
        status: 'ready',
        data: {
          available: true,
          default: { provider: 'p1', model: 'm1' },
          groups: [
            {
              id: 'p1',
              name: 'Provider One',
              models: [
                { id: 'm1', name: 'Model One' },
                { id: 'm2', name: 'Model Two' },
              ],
            },
          ],
          failures: [],
        },
        error: null,
      },
    }),
  )
  const view = collect(tree)

  assert.ok(view.texts.includes('模型'), '设置页签有模型区块')
  assert.ok(view.texts.includes('当前模型： Provider One · Model One'))
  const provider = findNode(tree, (node) => node.props?.['aria-label'] === '提供方')
  assert.equal(provider?.type, 'select')
  assert.equal(provider?.props?.value, 'p1')
  const model = findNode(tree, (node) => node.props?.['aria-label'] === '模型')
  assert.equal(model?.type, 'select')
  assert.equal(model?.props?.value, 'm1')
})

test('执行者页：设置页签跟随默认模型时只渲染提供方选择', async () => {
  const client = await loadClient()
  const view = collect(
    client.render(
      states({
        data: listData(),
        selectedId: 'writer',
        tab: 'settings',
        modelCatalog: {
          status: 'ready',
          data: {
            available: true,
            default: { provider: 'p1', model: 'm1' },
            groups: [{ id: 'p1', name: 'Provider One', models: [{ id: 'm1', name: 'Model One' }] }],
            failures: [],
          },
          error: null,
        },
      }),
    ),
  )
  assert.ok(view.texts.includes('新会话使用宿主当前默认模型。'))
  const selects = collect(
    client.render(
      states({
        data: listData(),
        selectedId: 'writer',
        tab: 'settings',
        modelCatalog: {
          status: 'ready',
          data: {
            available: true,
            default: { provider: 'p1', model: 'm1' },
            groups: [{ id: 'p1', name: 'Provider One', models: [{ id: 'm1', name: 'Model One' }] }],
            failures: [],
          },
          error: null,
        },
      }),
    ),
  ).nodes.filter(
    (node) =>
      node.type === 'select' &&
      (node.props?.['aria-label'] === '提供方' || node.props?.['aria-label'] === '模型'),
  )
  assert.equal(selects.length, 1, '跟随默认模型时只显示提供方选择')
})

test('执行者页：设置页签的模型目录不可用时说明原因', async () => {
  const client = await loadClient()
  const view = collect(
    client.render(
      states({
        data: listData(),
        selectedId: 'writer',
        tab: 'settings',
        modelCatalog: {
          status: 'ready',
          data: { available: false, default: null, groups: [], failures: [] },
          error: null,
        },
      }),
    ),
  )
  assert.ok(view.texts.includes('当前组合没有模型目录（ctx.llm 不可用），无法为智能体选择模型。'))
})

test('执行者页：设置页签可选模式，broken 预设标灰、服务不可用时禁用', async () => {
  const client = await loadClient()
  const catalog = {
    status: 'ready',
    data: {
      available: true,
      presets: [
        { id: 'ptc', name: 'PTC', description: '', broken: null, isDefault: false },
        { id: 'broken', name: 'Broken', description: '', broken: '插件缺失', isDefault: false },
      ],
    },
    error: null,
  }
  const tree = client.render(
    states({
      data: listData(),
      selectedId: 'writer',
      tab: 'settings',
      agentPresetCatalog: catalog,
      agentPresetDraft: 'ptc',
    }),
  )
  const view = collect(tree)
  assert.ok(view.texts.includes('模式'))
  assert.ok(view.texts.includes('当前模式： PTC'))
  const select = findNode(tree, (node) => node.props?.['aria-label'] === '模式')
  assert.equal(select?.type, 'select')
  assert.equal(select?.props?.value, 'ptc')
  assert.equal(select?.props?.disabled, false)
  const broken = findNode(tree, (node) => node.type === 'option' && node.props?.value === 'broken')
  assert.equal(broken?.props?.disabled, true, 'a broken preset cannot be chosen')

  const unavailable = collect(
    client.render(
      states({
        data: listData(),
        selectedId: 'writer',
        tab: 'settings',
        agentPresetCatalog: {
          status: 'ready',
          data: { available: false, presets: [] },
          error: null,
        },
      }),
    ),
  )
  assert.ok(
    unavailable.texts.includes(
      '当前组合没有执行者预设服务（ctx.agentPresets 不可用），无法选择模式。',
    ),
  )
})

test('删除弹窗：列出影响面、硬删说明，被 running 作业阻塞时禁用确认', async () => {
  const client = await loadClient()
  const workerEntry = worker('writer', 'panda', '写发布说明')
  const impact = {
    id: 'writer',
    name: 'writer',
    path: workerEntry.path,
    mounted: true,
    workspaceId: 'ws-1',
    blockers: {
      runningJobs: [
        {
          jobId: 'job-1',
          jobSeq: 3,
          workflowId: 'wf-1',
          workflowName: '写作流程',
          jobName: '写作流程',
        },
      ],
    },
    workflows: [{ workflowId: 'wf-1', name: '写作流程', status: 'active' }],
    finishedJobs: 2,
  }

  // 有运行中作业：确认按钮禁用，弹窗列出作业并提示先终止。
  const blocked = collect(
    client.render(
      states({
        deleteDialog: {
          target: workerEntry,
          impact,
          loading: false,
          error: null,
          saving: false,
        },
      }),
    ),
  )
  const blockedText = blocked.texts.join(' ')
  assert.match(blockedText, /删除是硬删/u, 'hard delete is explained')
  assert.match(blockedText, /AGENTS\.md 与项目 skills 也会一起消失/u)
  assert.ok(blockedText.includes(workerEntry.path), 'the directory to delete is shown')
  assert.match(blockedText, /写作流程 #3/u, 'running jobs are listed')
  assert.match(blockedText, /打开作业/u, 'each blocking job links to its job page')
  assert.match(blockedText, /运行中的作业阻塞删除/u)
  assert.match(blockedText, /请先在这些作业的作业页主动终止它们/u)
  assert.match(blockedText, /引用它的已结束作业数： 2/u)
  assert.match(blockedText, /会因此变成不可用的工作流： 1/u)
  const deleteButton = findNode(
    client.render(
      states({
        deleteDialog: {
          target: workerEntry,
          impact,
          loading: false,
          error: null,
          saving: false,
        },
      }),
    ),
    (node) => node.type === 'button' && collect(node).texts.includes('永久删除'),
  )
  assert.ok(deleteButton, 'the confirm button exists')
  assert.equal(deleteButton.props.disabled, true, 'blocked deletion cannot be confirmed')

  // 没有运行中作业：确认按钮可用。
  const free = collect(
    client.render(
      states({
        deleteDialog: {
          target: workerEntry,
          impact: { ...impact, blockers: { runningJobs: [] } },
          loading: false,
          error: null,
          saving: false,
        },
      }),
    ),
  )
  assert.ok(!free.texts.join(' ').includes('运行中的作业阻塞删除'))
  const freeButton = findNode(
    client.render(
      states({
        deleteDialog: {
          target: workerEntry,
          impact: { ...impact, blockers: { runningJobs: [] } },
          loading: false,
          error: null,
          saving: false,
        },
      }),
    ),
    (node) => node.type === 'button' && collect(node).texts.includes('永久删除'),
  )
  assert.equal(freeButton.props.disabled, false, 'unblocked deletion can be confirmed')
})

test.after(() => {
  rmSync(stubRoot, { recursive: true, force: true })
})
