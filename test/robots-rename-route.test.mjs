/**
 * `POST /buka-robots/rename` 的路由级单测。
 *
 * `lib/index.js` 顶层 import 了 DSH 运行时包（`@deepseek-ai/dsh-tools` 与
 * `@deepseek-ai/schemastery`），仓库里没有这些依赖。这里用 `module.registerHooks`
 * 把两个包替换成最小桩，再用假的 `webServer` / `connection` 注册路由，直接调用
 * 改名 handler 检查 HTTP 状态、响应字段与错误码映射——不启动 DSH、不联网。
 *
 * 覆盖：成功改名的响应形状（`renamed` / `previousName` / `agents` / 工作区重建）、
 * 内置名保留（409）、非法名（400）、未知机器人（404）、方法不允许（405）。
 */

import assert from 'node:assert/strict'
import { promises as fs, mkdtempSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

/** 桩文件目录：必须在 import 插件入口之前落盘。 */
const stubRoot = mkdtempSync(path.join(tmpdir(), 'buka-robots-route-stubs-'))
const toolsStub = path.join(stubRoot, 'dsh-tools.mjs')
const schemasteryStub = path.join(stubRoot, 'schemastery.mjs')
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition\n')
writeFileSync(
  schemasteryStub,
  [
    '// Config 只需要可链式调用的占位：z.object({...}) / z.string().default() 等。',
    'const chain = () => new Proxy(function () {}, {',
    '  get: () => () => chain(),',
    '  apply: () => chain(),',
    '})',
    'export default chain()',
    '',
  ].join('\n'),
)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: pathToFileURL(toolsStub).href, shortCircuit: true }
    }
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: pathToFileURL(schemasteryStub).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

/**
 * 建临时机器人根目录，返回一个最小可用的插件上下文。
 *
 * @returns {Promise<{
 *   robotsDir: string,
 *   registryFile: string,
 *   tool: Record<string, any>,
 *   routes: Map<string, { handler: Function }>,
 *   workspaces: Array<{ id: string, path: string }>,
 *   deleted: string[],
 *   cleanup: () => Promise<void>,
 * }>}
 */
async function makeHarness() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-robots-route-'))
  const robotsDir = path.join(root, 'robots')
  const registryFile = path.join(root, 'robots.json')

  /** @type {Array<{ id: string, path: string }>} */
  const workspaces = []
  /** @type {string[]} */
  const deleted = []
  let nextWorkspaceId = 0
  const workspaceRegistry = {
    list: () => workspaces,
    create: async (directory) => {
      const canonical = await fs.realpath(directory)
      nextWorkspaceId += 1
      const workspace = { id: `workspace-${nextWorkspaceId}`, path: canonical }
      workspaces.unshift(workspace)
      return workspace
    },
    delete: (id) => {
      deleted.push(id)
      const before = workspaces.length
      for (let index = workspaces.length - 1; index >= 0; index -= 1) {
        if (workspaces[index].id === id) workspaces.splice(index, 1)
      }
      return workspaces.length < before
    },
  }

  /** @type {Map<string, { handler: Function }>} */
  const routes = new Map()
  const logger = { info() {}, debug() {}, warn() {} }
  const webServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const connection = { requestRejection: () => undefined }
  const webCtx = { webServer, connection, logger, effect: (fn) => fn() }

  const registeredTools = []
  const tools = { register: (tool, options) => registeredTools.push({ tool, options }) }

  // 「机器人构建」preset 的根会话：让 buka_robot_build 通过可见性判定。
  const sessions = new Map([['builder', { id: 'builder', header: {} }]])
  const presets = new Map([['builder', 'robot-builder']])

  const ctx = {
    provide() {},
    effect(fn) {
      fn()
    },
    get(name) {
      if (name === 'sessions') return { get: (id) => sessions.get(id) }
      if (name === 'agentPresets') return { presetForSession: (session) => presets.get(session.id) ?? null }
      return undefined
    },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback(webCtx)
      if (deps.includes('tools')) callback({ tools, logger })
    },
    workspaceRegistry,
    logger,
  }

  const { apply } = await import(`${pathToFileURL(path.resolve('plugins/robots/lib/index.js')).href}`)
  apply(ctx, { robotsDir, builderPresets: ['robot-builder'] })

  const entry = registeredTools.find((item) => item.tool.name === 'buka_robot_build')
  assert.ok(entry, 'buka_robot_build 应已注册')

  return {
    robotsDir,
    registryFile,
    tool: entry.tool,
    routes,
    workspaces,
    deleted,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * 直接调用路由 handler，返回状态码与解析后的响应体。
 *
 * @param {Map<string, { handler: Function }>} routes
 * @param {string} routePath
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
async function callRoute(routes, routePath, { method = 'POST', body } = {}) {
  const route = routes.get(routePath)
  assert.ok(route, `${routePath} 应已注册`)
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield* payload
    },
  }
  const res = {
    statusCode: 200,
    headers: {},
    text: '',
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(text = '') {
      this.text = String(text)
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: res.text === '' ? null : JSON.parse(res.text) }
}

test('POST /buka-robots/rename：改名成功并重建工作区，返回新的 AGENTS.md 摘要', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }
    // 用构建工具新建（不传 agents，AGENTS.md 是插件模板），后面改名应把模板同步成新名。
    const created = await harness.tool.execute({ name: 'writer', avatar: 'owl' }, agent)
    assert.equal(created.created, true)
    assert.equal(harness.workspaces.length, 1)
    const oldWorkspaceId = created.workspaceId
    const oldPath = created.path

    const result = await callRoute(harness.routes, '/buka-robots/rename', {
      body: { name: 'writer', newName: 'author' },
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.renamed, true)
    assert.equal(result.body.previousName, 'writer')
    assert.equal(result.body.robot.name, 'author')
    assert.notEqual(result.body.robot.path, oldPath)
    assert.equal(result.body.mounted, true)
    assert.notEqual(result.body.workspaceId, oldWorkspaceId)

    // AGENTS.md 模板同步成新名 / 新路径，并随响应带回给页面重设草稿。
    assert.equal(typeof result.body.agents.content, 'string')
    assert.ok(result.body.agents.content.includes('这是「author」机器人的协作说明'))
    assert.ok(result.body.agents.content.includes(`- 路径：\`${result.body.robot.path}\``))

    // 登记表：条目原位更新，旧目录不存在。
    const registry = JSON.parse(await fs.readFile(harness.registryFile, 'utf8'))
    assert.deepEqual(
      registry.robots.map((robot) => robot.name),
      ['author'],
    )
    assert.equal(registry.robots[0].path, result.body.robot.path)
    assert.equal(
      await fs.stat(path.join(harness.robotsDir, 'writer')).then(
        () => true,
        () => false,
      ),
      false,
    )

    // 旧工作区注册被删，新路径上有一个新工作区。
    assert.deepEqual(harness.deleted, [oldWorkspaceId])
    assert.equal(harness.workspaces.length, 1)
    assert.equal(harness.workspaces[0].path, result.body.robot.path)
  } finally {
    await harness.cleanup()
  }
})

test('POST /buka-robots/rename：错误码映射（内置名 409、非法名 400、未知 404、方法 405）', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }
    await harness.tool.execute({ name: 'writer' }, agent)
    await harness.tool.execute({ name: 'painter' }, agent)

    // 新名与另一个机器人重名。
    const taken = await callRoute(harness.routes, '/buka-robots/rename', {
      body: { name: 'writer', newName: 'painter' },
    })
    assert.equal(taken.status, 409)
    assert.equal(taken.body.code, 'name-taken')

    // 内置「通用型机器人」的名字保留。
    const reserved = await callRoute(harness.routes, '/buka-robots/rename', {
      body: { name: 'writer', newName: '通用型机器人' },
    })
    assert.equal(reserved.status, 409)
    assert.equal(reserved.body.code, 'name-taken')

    // 非法新名 / 与旧名相同。
    const invalid = await callRoute(harness.routes, '/buka-robots/rename', {
      body: { name: 'writer', newName: '../escape' },
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'invalid-name')
    const same = await callRoute(harness.routes, '/buka-robots/rename', {
      body: { name: 'writer', newName: 'writer' },
    })
    assert.equal(same.status, 400)
    assert.equal(same.body.code, 'invalid-name')

    // 未知机器人。
    const unknown = await callRoute(harness.routes, '/buka-robots/rename', {
      body: { name: 'nobody', newName: 'author' },
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.code, 'unknown-robot')

    // 方法不允许。
    const get = await callRoute(harness.routes, '/buka-robots/rename', { method: 'GET' })
    assert.equal(get.status, 405)
    assert.equal(get.body.code, 'method-not-allowed')

    // 以上失败都没有动目录与登记表。
    assert.deepEqual(
      JSON.parse(await fs.readFile(harness.registryFile, 'utf8')).robots.map((robot) => robot.name),
      ['painter', 'writer'],
    )
  } finally {
    await harness.cleanup()
  }
})

test.after(async () => {
  await fs.rm(stubRoot, { recursive: true, force: true })
})
