/**
 * `@buka/dsh-plugin-pen` 的状态与接线测试。
 *
 * 只导入零依赖的 `src/state.ts` 与只依赖公共包的 `src/routes.ts`：不拉起
 * Cordis，也不连接真正的 mcp-client。标题标记的渲染用最小 React / 界面基座桩
 * 跑一遍（`useEffect` 是桩，不发请求）。覆盖容易回归的几件事：
 *
 * - 会话快照的四种状态（未勾选 / 等 Agent / 已挂载 / 失败）；
 * - 浏览器一半与 Host 一半的路由常量没有脱节；
 * - 勾选框注册在官方 worktree 勾选框所在的 `conversation.hero.options`；
 * - 标题标记注册在紧挨会话标题的 `conversation.session.header.actions`，
 *   且只在当前会话开启了 Pen 时渲染成「描边图标 + 品牌名」的普通文字；
 * - `/pen`、`/pen off` 经宿主 `commands` 服务注册，按会话开启 / 关闭，
 *   命令卡片给出可读结果；
 * - 标题标记用命令节点签名感知命令结算，命令后重新读 Host 状态；
 * - Host 确实在 Agent 作用域里挂 mcp-client、在 `agent/created` 上等待、并且
 *   首次连接失败会让激活失败（勾选成功 = 工具就绪）；
 * - bundle 清单与两份 locale 文案齐全。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import CommandsService from '@deepseek-ai/dsh-commands'

import {
  COMMAND_NAME,
  parsePenCommand,
  penCommandResult,
  registerPenCommand,
} from '../plugins/pen/src/command.ts'
import { STATE_ROUTE, TOGGLE_ROUTE } from '../plugins/pen/src/routes.ts'
import { snapshotOf } from '../plugins/pen/src/state.ts'

const PLUGIN_DIR = new URL('../plugins/pen/', import.meta.url)
const CLIENT_DIR = new URL('src/client/', PLUGIN_DIR)

/** 读插件里某个文件的文本。 */
function source(name, base = PLUGIN_DIR) {
  return readFileSync(new URL(name, base), 'utf8')
}

/** 读一份 JSON。 */
function json(name) {
  return JSON.parse(source(name))
}

test('快照：没有状态或未勾选都是 idle', () => {
  assert.deepEqual(snapshotOf(undefined), { enabled: false, status: 'idle' })
  assert.deepEqual(snapshotOf({ enabled: false, mounted: false }), {
    enabled: false,
    status: 'idle',
  })
})

test('快照：勾了但 Agent 还没创建是 pending', () => {
  assert.deepEqual(snapshotOf({ enabled: true, mounted: false }), {
    enabled: true,
    status: 'pending',
  })
})

test('快照：已挂载是 ready', () => {
  assert.deepEqual(snapshotOf({ enabled: true, mounted: true }), {
    enabled: true,
    status: 'ready',
  })
})

test('快照：有错误时带上失败文本', () => {
  assert.deepEqual(snapshotOf({ enabled: true, mounted: false, error: 'spawn ENOENT' }), {
    enabled: true,
    status: 'error',
    message: 'spawn ENOENT',
  })
})

test('Host 与浏览器一半的路由常量一致', () => {
  assert.equal(STATE_ROUTE, '/pen/state')
  assert.equal(TOGGLE_ROUTE, '/pen/toggle')
  const api = source('api.ts', CLIENT_DIR)
  assert.ok(api.includes(`'${STATE_ROUTE}'`), 'api.ts 缺少读状态路由')
  assert.ok(api.includes(`'${TOGGLE_ROUTE}'`), 'api.ts 缺少勾选路由')
})

test('勾选框注册在官方 worktree 勾选框的位置', () => {
  const client = source('index.ts', CLIENT_DIR)
  assert.ok(client.includes("'conversation.hero.options'"), '没有注册到新会话行')
  assert.ok(client.includes("id: 'pen'"))
  assert.ok(client.includes('locale: NS'))
})

test('label 是「logo + Pen」：笔尖描边 SVG 与固定品牌名', () => {
  const dictionary = source('dictionary.ts', CLIENT_DIR)
  assert.ok(dictionary.includes("export const LABEL = 'Pen'"), 'label 不是固定品牌名')
  const toggle = source('toggle.ts', CLIENT_DIR)
  assert.ok(toggle.includes('PenLogo'), '没有引用 Pen 笔尖图标')
  assert.ok(toggle.includes("className: 'buka-pen-logo'"), '没有渲染 logo 的 class')
  assert.ok(toggle.includes('LABEL'), '没有渲染 Pen 文字')
  const logo = source('logo.ts', CLIENT_DIR)
  assert.ok(logo.includes("'svg'"), 'logo 不是内联 SVG')
  assert.ok(logo.includes("'0 0 64 77'"), 'logo 缺少笔尖画布')
  assert.ok(logo.includes("stroke: 'currentColor'"), '描边没有跟随主题文字颜色')
  assert.ok(!logo.includes('data:image/png;base64,'), 'logo 仍然是位图')
})

test('Host 在 Agent 作用域挂载 mcp-client，并在 agent/created 上等待', () => {
  const controller = source('src/controller.ts')
  assert.ok(controller.includes("this.ctx.on('agent/created'"), '没有等待 Agent 创建')
  assert.ok(controller.includes('agent.ctx.plugin'), '没有挂进 Agent 作用域')
  assert.ok(controller.includes('failOnStartupError: true'), '首次连接失败没有让激活失败')
  assert.ok(controller.includes('await fiber.dispose()'), '取消勾选没有断开连接')
})

test('/pen 只接受开启与 off 两种输入', () => {
  assert.equal(parsePenCommand(''), 'on')
  assert.equal(parsePenCommand('  ON '), 'on')
  assert.equal(parsePenCommand('off'), 'off')
  assert.equal(parsePenCommand(' off '), 'off')
  assert.equal(parsePenCommand('bogus'), undefined)
  assert.equal(parsePenCommand(undefined), 'on')
  assert.equal(COMMAND_NAME, 'pen')
})

test('/pen 的命令卡片文本反映切换结果', () => {
  assert.deepEqual(penCommandResult('off', { enabled: false, status: 'idle' }, 'pencil'), {
    kind: 'success',
    text: 'Pen MCP 已关闭，本会话不再提供 mcp__pencil__* 工具。',
  })
  assert.deepEqual(penCommandResult('on', { enabled: true, status: 'ready' }, 'pencil'), {
    kind: 'success',
    text: 'Pen MCP 已开启，本会话的下一轮消息可以使用 mcp__pencil__* 工具。',
  })
  assert.deepEqual(
    penCommandResult('on', { enabled: true, status: 'error', message: 'spawn ENOENT' }, 'pencil'),
    { kind: 'error', text: 'Pen MCP 连接失败：spawn ENOENT' },
  )
  assert.equal(
    penCommandResult('on', { enabled: true, status: 'pending' }, 'pencil').kind,
    'success',
  )
})

/** 一个只记录切换调用、不做真实挂载的状态源。 */
function fakePenSource(calls) {
  return {
    snapshot: () => ({ enabled: false, status: 'idle' }),
    setEnabled: (sessionId, enabled) => {
      calls.push([sessionId, enabled])
      return { enabled, status: enabled ? 'ready' : 'idle' }
    },
  }
}

/** 一个能记录命令生命周期事件的最小会话。 */
function makeSession(id) {
  const events = []
  return {
    id,
    get seq() {
      return events.length
    },
    append(type, data) {
      events.push({ type, data, seq: events.length })
    },
  }
}

test('/pen 命令按目标会话调用状态源，命令卡片可读', async () => {
  const root = new Context()
  try {
    await root.plugin(CommandsService)
    const calls = []
    registerPenCommand(root, fakePenSource(calls), { serverName: 'pencil' })
    // `ctx.inject` 在 commands 可用后注册；等一个微任务批次。
    await new Promise((resolve) => setTimeout(resolve, 0))
    const commands = root.get('commands')
    const agent = { id: 'pen-session', session: makeSession('pen-session') }

    const on = await commands.execute(agent, '/pen', [], new AbortController().signal)
    assert.equal(on?.result?.kind, 'success')
    assert.deepEqual(calls[0], ['pen-session', true])

    const off = await commands.execute(agent, '/pen off', [], new AbortController().signal)
    assert.equal(off?.result?.kind, 'success')
    assert.deepEqual(calls[1], ['pen-session', false])

    const bogus = await commands.execute(agent, '/pen bogus', [], new AbortController().signal)
    assert.equal(bogus?.result?.kind, 'error')
    assert.equal(calls.length, 2, '不认识的参数不应该切换状态')
  } finally {
    await root.fiber.dispose()
  }
})

test('命令节点签名：普通消息不触发，最近一条命令的 run/done 都触发', async () => {
  registerClientStubs()
  const { penCommandSignature } = await import('../plugins/pen/src/client/mark.ts')
  const node = (id, outcome) => ({ kind: 'command', data: { commandId: id, outcome } })
  const chat = (nodes) => ({ legacy: { nodes } })

  assert.equal(penCommandSignature(chat([])), '')
  assert.equal(penCommandSignature(chat([{ kind: 'message', data: null }])), '')
  assert.equal(penCommandSignature(chat([node('c1', null)])), 'c1:run')
  assert.equal(penCommandSignature(chat([node('c1', { kind: 'success' })])), 'c1:done')
  assert.equal(
    penCommandSignature(
      chat([node('c1', { kind: 'success' }), node('c2', null), { kind: 'message', data: null }]),
    ),
    'c2:run',
    '只看最近一条命令，后续普通消息不影响',
  )
})

test('bundle 清单声明了 Host 入口、界面一半与 mcp-client peer', () => {
  const manifest = json('package.json')
  assert.equal(manifest.name, '@buka/dsh-plugin-pen')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.match(manifest.peerDependencies?.['@deepseek-ai/dsh-mcp-client'] ?? '', />=0\.2\.2-rc\.1/)
  assert.match(manifest.peerDependencies?.['@deepseek-ai/dsh-commands'] ?? '', />=0\.2\.2-rc\.1/)
  assert.ok(source('cordis.patch.yml').includes(manifest.name))
})

test('两份 locale 都有标题、简介与详情文件', () => {
  for (const [file, detail] of [
    ['locale/en.json', 'docs/DETAIL.md'],
    ['locale/zh.json', 'docs/DETAIL.zh.md'],
  ]) {
    const { meta } = json(file)
    assert.ok(typeof meta.title === 'string' && meta.title.length > 0, `${file} 缺标题`)
    assert.ok(typeof meta.description === 'string' && meta.description.length > 0, `${file} 缺简介`)
    assert.equal(meta.detail, detail)
    assert.ok(source(detail).length > 0, `${detail} 为空`)
  }
})

/** React 桩：`mark.ts` 只用 `useState` / `useEffect`；effect 不执行，避免发请求。 */
const REACT_STUB = `
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
export default { createElement: h }
export const useEffect = () => {}
export const useState = (initial) => {
  const box = globalThis.__PEN_TEST__
  return [box.queue.length > 0 ? box.queue.shift() : initial, () => {}]
}
`

const REACT_URL = `data:text/javascript,${encodeURIComponent(REACT_STUB)}`

let stubsRegistered = false

/** 把 `react` 解析到桩模块；只注册一次。 */
function registerClientStubs() {
  if (stubsRegistered) return
  stubsRegistered = true
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'react') return { url: REACT_URL, shortCircuit: true }
      return next(specifier, context)
    },
  })
}

/** 收集渲染树里的元素节点。 */
function nodesOf(tree) {
  const found = []
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    found.push(node)
    walk(node.children)
  }
  walk(tree)
  return found
}

test('标题标记注册在紧挨会话标题的动作插槽', () => {
  const client = source('index.ts', CLIENT_DIR)
  assert.ok(client.includes("'conversation.session.header.actions'"), '没有注册到标题右侧')
  assert.ok(client.includes("id: 'pen-mark'"), '标题标记缺少 id')
  assert.ok(source('dictionary.ts', CLIENT_DIR).includes("export const MARK_LABEL = 'Pen MCP'"))
  assert.ok(source('src/command.ts').includes('COMMAND_NAME'), 'Host 一半没有 /pen 命令')
})

test('标题标记只在这个会话开启 Pen 时显示为普通文字', async () => {
  registerClientStubs()
  globalThis.__PEN_TEST__ = { queue: [] }
  const { PenMark } = await import('../plugins/pen/src/client/mark.ts')
  const render = (snapshot) => {
    globalThis.__PEN_TEST__.queue = [snapshot]
    return PenMark({ sessionId: 'session-1' })
  }

  assert.equal(PenMark({}), null, '没有会话 id 时不显示')
  assert.equal(render({ enabled: false, status: 'idle' }), null, '没勾选 Pen 时不显示')

  const mark = render({ enabled: true, status: 'ready' })
  assert.ok(mark, '勾选后应显示标记')
  assert.equal(mark.type, 'span', '标记应该是一段普通文字，不是胶囊')
  assert.equal(mark.props.className, 'buka-pen-mark')
  const nodes = nodesOf(mark)
  const icon = nodes.find((node) => node.props.className === 'buka-pen-mark-icon')
  assert.ok(icon, '标记缺少描边图标')
  assert.equal(icon.props.height, 14)
  assert.deepEqual(mark.children, [icon, 'Pen MCP'], '标记应是「图标 + 品牌名」')
})

test('笔尖图标是跟随 currentColor 的内联 SVG', async () => {
  registerClientStubs()
  const { PenLogo } = await import('../plugins/pen/src/client/logo.ts')
  const icon = PenLogo({ height: 14, className: 'buka-pen-mark-icon' })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.viewBox, '0 0 64 77')
  assert.equal(icon.props.height, 14)
  assert.equal(icon.props.width, 11.64)
  assert.equal(icon.props.stroke, 'currentColor')
  assert.equal(icon.props.fill, 'none')
  assert.equal(icon.props.className, 'buka-pen-mark-icon')
  assert.equal(icon.children.length, 3, '图标是「外轮廓 + 圆点 + 分缝」')

  const appIcon = source('icon.svg')
  assert.ok(appIcon.includes('stroke="#fff"'), '市场图标不是白色描边')
  assert.ok(!appIcon.includes('<path d="M43.2 15.6a3.8'), '市场图标还是旧的实心笔形')
})
