/**
 * `@buka/dsh-plugin-pen` 的状态与接线测试。
 *
 * 只导入零依赖的 `src/state.ts` 与只依赖公共包的 `src/routes.ts`：不拉起
 * Cordis，也不连接真正的 mcp-client。覆盖容易回归的几件事：
 *
 * - 会话快照的四种状态（未勾选 / 等 Agent / 已挂载 / 失败）；
 * - 浏览器一半与 Host 一半的路由常量没有脱节；
 * - 勾选框注册在官方 worktree 勾选框所在的 `conversation.hero.options`；
 * - Host 确实在 Agent 作用域里挂 mcp-client、在 `agent/created` 上等待、并且
 *   首次连接失败会让激活失败（勾选成功 = 工具就绪）；
 * - bundle 清单与两份 locale 文案齐全。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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
  assert.equal(STATE_ROUTE, '/buka-pen/state')
  assert.equal(TOGGLE_ROUTE, '/buka-pen/toggle')
  const api = source('api.ts', CLIENT_DIR)
  assert.ok(api.includes(`'${STATE_ROUTE}'`), 'api.ts 缺少读状态路由')
  assert.ok(api.includes(`'${TOGGLE_ROUTE}'`), 'api.ts 缺少勾选路由')
})

test('勾选框注册在官方 worktree 勾选框的位置', () => {
  const client = source('index.ts', CLIENT_DIR)
  assert.ok(client.includes("'conversation.hero.options'"), '没有注册到新会话行')
  assert.ok(client.includes("id: 'buka-pen'"))
  assert.ok(client.includes('locale: NS'))
})

test('label 是「logo + Pen」：内联图标与固定品牌名', () => {
  const dictionary = source('dictionary.ts', CLIENT_DIR)
  assert.ok(dictionary.includes("export const LABEL = 'Pen'"), 'label 不是固定品牌名')
  const toggle = source('toggle.ts', CLIENT_DIR)
  assert.ok(toggle.includes('PEN_LOGO'), '没有引用 Pen logo')
  assert.ok(toggle.includes("'buka-pen-logo'"), '没有渲染 logo 的 class')
  assert.ok(toggle.includes('LABEL'), '没有渲染 Pen 文字')
  const logo = source('logo.ts', CLIENT_DIR)
  assert.ok(logo.includes("'data:image/png;base64,'"), 'logo 不是内联 PNG data URL')
  assert.ok(logo.length > 1000, 'logo data URL 为空')
})

test('Host 在 Agent 作用域挂载 mcp-client，并在 agent/created 上等待', () => {
  const controller = source('src/controller.ts')
  assert.ok(controller.includes("this.ctx.on('agent/created'"), '没有等待 Agent 创建')
  assert.ok(controller.includes('agent.ctx.plugin'), '没有挂进 Agent 作用域')
  assert.ok(controller.includes('failOnStartupError: true'), '首次连接失败没有让激活失败')
  assert.ok(controller.includes('await fiber.dispose()'), '取消勾选没有断开连接')
})

test('bundle 清单声明了 Host 入口、界面一半与 mcp-client peer', () => {
  const manifest = json('package.json')
  assert.equal(manifest.name, '@buka/dsh-plugin-pen')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.match(manifest.peerDependencies?.['@deepseek-ai/dsh-mcp-client'] ?? '', />=0\.2\.2-rc\.1/)
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
