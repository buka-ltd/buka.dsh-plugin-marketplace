/**
 * `POST /buka-workers/rename` 的路由级单测。
 *
 * `src/index.ts` 顶层 import 了 DSH 运行时包（`@deepseek-ai/dsh-tools` 与
 * `@deepseek-ai/schemastery`），仓库里没有这些依赖。这里用 `module.registerHooks`
 * 把两个包替换成最小桩，再用假的 `webServer` / `connection` 注册路由，直接调用
 * 改名 handler 检查 HTTP 状态、响应字段与错误码映射——不启动 DSH、不联网。
 *
 * 覆盖：成功改名的响应形状（`renamed` / `previousName` / `agents` / 工作区重建）、
 * 内置名保留（409）、非法名（400）、未知打工人（404）、方法不允许（405）。
 */

import assert from 'node:assert/strict'
import { promises as fs, mkdtempSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

/** 桩文件目录：必须在 import 插件入口之前落盘。 */
const stubRoot = mkdtempSync(path.join(tmpdir(), 'buka-workers-route-stubs-'))
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
 * 建临时打工人根目录，返回一个最小可用的插件上下文。
 *
 * @returns {Promise<{
 *   workersDir: string,
 *   registryFile: string,
 *   tool: Record<string, any>,
 *   routes: Map<string, { handler: Function }>,
 *   workspaces: Array<{ id: string, path: string }>,
 *   deleted: string[],
 *   cleanup: () => Promise<void>,
 * }>}
 */
async function makeHarness() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-route-'))
  const workersDir = path.join(root, 'workers')
  const registryFile = path.join(root, 'workers.json')

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

  // 「打工人」preset 的根会话：让 buka_worker_build 通过可见性判定。
  const sessions = new Map([['builder', { id: 'builder', header: {} }]])
  const presets = new Map([['builder', 'worker-builder']])

  const ctx = {
    provide() {},
    effect(fn) {
      fn()
    },
    on() {
      return () => {}
    },
    get(name) {
      if (name === 'sessions') return { get: (id) => sessions.get(id) }
      if (name === 'agentPresets')
        return { presetForSession: (session) => presets.get(session.id) ?? null }
      return undefined
    },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback(webCtx)
      if (deps.includes('tools')) callback({ tools, logger })
    },
    workspaceRegistry,
    logger,
  }

  const { apply } = await import(
    `${pathToFileURL(path.resolve('plugins/workers/src/index.ts')).href}`
  )
  apply(ctx, { workersDir, builderPresets: ['worker-builder'], seedPresets: false })

  const entry = registeredTools.find((item) => item.tool.name === 'buka_worker_build')
  assert.ok(entry, 'buka_worker_build 应已注册')

  return {
    workersDir,
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
    on() {},
    end(text = '') {
      this.text = String(text)
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: res.text === '' ? null : JSON.parse(res.text) }
}

test('POST /buka-workers/rename：改名成功并重建工作区，返回新的 AGENTS.md 摘要', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }
    // 用构建工具新建（不传 agents，AGENTS.md 是插件模板），后面改名应把模板同步成新名。
    const created = await harness.tool.execute({ name: 'writer', avatar: 'owl' }, agent)
    assert.equal(created.created, true)
    assert.equal(harness.workspaces.length, 1)
    const oldWorkspaceId = created.workspaceId
    const oldPath = created.path

    const result = await callRoute(harness.routes, '/buka-workers/rename', {
      body: { name: 'writer', newName: 'author' },
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.renamed, true)
    assert.equal(result.body.previousName, 'writer')
    assert.equal(result.body.worker.name, 'author')
    assert.notEqual(result.body.worker.path, oldPath)
    assert.equal(result.body.mounted, true)
    assert.notEqual(result.body.workspaceId, oldWorkspaceId)

    // AGENTS.md 模板同步成新名 / 新路径，并随响应带回给页面重设草稿。
    assert.equal(typeof result.body.agents.content, 'string')
    assert.ok(result.body.agents.content.includes('这是「author」打工人的协作说明'))
    assert.ok(result.body.agents.content.includes(`- 路径：\`${result.body.worker.path}\``))

    // 登记表：条目原位更新，旧目录不存在；内建 clock 仍在表里。
    const registry = JSON.parse(await fs.readFile(harness.registryFile, 'utf8'))
    assert.deepEqual(
      registry.workers.map((worker) => worker.name),
      ['author', 'clock'],
    )
    assert.equal(registry.version, 3)
    assert.equal(registry.workers[0].path, result.body.worker.path)
    assert.equal(
      await fs.stat(path.join(harness.workersDir, 'writer')).then(
        () => true,
        () => false,
      ),
      false,
    )

    // 旧工作区注册被删，新路径上有一个新工作区。
    assert.deepEqual(harness.deleted, [oldWorkspaceId])
    assert.equal(harness.workspaces.length, 1)
    assert.equal(harness.workspaces[0].path, result.body.worker.path)
  } finally {
    await harness.cleanup()
  }
})

test('POST /buka-workers/rename：错误码映射（内置名 409、非法名 400、未知 404、方法 405）', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }
    await harness.tool.execute({ name: 'writer' }, agent)
    await harness.tool.execute({ name: 'painter' }, agent)

    // 新名与另一个打工人重名。
    const taken = await callRoute(harness.routes, '/buka-workers/rename', {
      body: { name: 'writer', newName: 'painter' },
    })
    assert.equal(taken.status, 409)
    assert.equal(taken.body.code, 'name-taken')

    // 非法新名 / 与旧名相同。
    const invalid = await callRoute(harness.routes, '/buka-workers/rename', {
      body: { name: 'writer', newName: '../escape' },
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'invalid-name')
    const same = await callRoute(harness.routes, '/buka-workers/rename', {
      body: { name: 'writer', newName: 'writer' },
    })
    assert.equal(same.status, 400)
    assert.equal(same.body.code, 'invalid-name')

    // 未知打工人。
    const unknown = await callRoute(harness.routes, '/buka-workers/rename', {
      body: { name: 'nobody', newName: 'author' },
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.code, 'unknown-worker')

    // 方法不允许。
    const get = await callRoute(harness.routes, '/buka-workers/rename', { method: 'GET' })
    assert.equal(get.status, 405)
    assert.equal(get.body.code, 'method-not-allowed')

    // 以上失败都没有动目录与登记表。
    assert.deepEqual(
      JSON.parse(await fs.readFile(harness.registryFile, 'utf8')).workers.map(
        (worker) => worker.name,
      ),
      ['painter', 'writer', 'clock'],
    )
  } finally {
    await harness.cleanup()
  }
})

test.after(async () => {
  await fs.rm(stubRoot, { recursive: true, force: true })
})

test('POST /buka-workers/assistant：智能体可设 / 取消助理，机器人与内建名字只读', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }
    await harness.tool.execute({ name: 'writer' }, agent)

    // 设为助理：响应带回完整条目，登记表落到 version 3。
    const marked = await callRoute(harness.routes, '/buka-workers/assistant', {
      body: { name: 'writer', assistant: true },
    })
    assert.equal(marked.status, 200)
    assert.equal(marked.body.ok, true)
    assert.equal(marked.body.worker.assistant, true)
    assert.equal(marked.body.worker.driver, 'agent')
    const registry = JSON.parse(await fs.readFile(harness.registryFile, 'utf8'))
    const writer = registry.workers.find((worker) => worker.name === 'writer')
    assert.equal(writer.assistant, true)

    // 取消助理。
    const cleared = await callRoute(harness.routes, '/buka-workers/assistant', {
      body: { name: 'writer', assistant: false },
    })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.body.worker.assistant, false)

    // 非布尔值 / 未知打工人。
    const invalid = await callRoute(harness.routes, '/buka-workers/assistant', {
      body: { name: 'writer', assistant: 'yes' },
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'invalid-assistant')
    const unknown = await callRoute(harness.routes, '/buka-workers/assistant', {
      body: { name: 'nobody', assistant: true },
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.code, 'unknown-worker')

    // 内建机器人不能是助理。
    const clock = await callRoute(harness.routes, '/buka-workers/assistant', {
      body: { name: 'clock', assistant: true },
    })
    assert.equal(clock.status, 409)
    assert.equal(clock.body.code, 'robot-worker')
  } finally {
    await harness.cleanup()
  }
})

test('打工人路由：内建 clock 不可创建 / 删除 / 改名 / 改头像，列表按 driver 展示', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }

    // 构建工具不能创建 clock。
    await assert.rejects(
      () => harness.tool.execute({ name: 'clock' }, agent),
      (error) => error.code === 'builtin-worker',
    )

    // 页面新建同样拒绝（内建名字 / program driver）。
    const created = await callRoute(harness.routes, '/buka-workers/create', {
      body: { name: 'clock' },
    })
    assert.equal(created.status, 409)
    assert.equal(created.body.code, 'builtin-worker')
    const invalidDriver = await callRoute(harness.routes, '/buka-workers/create', {
      body: { name: 'timer', driver: 'robot' },
    })
    assert.equal(invalidDriver.status, 400)
    assert.equal(invalidDriver.body.code, 'invalid-driver')

    // 删除 / 改名 / 改头像都拒绝内建机器人。
    const removed = await callRoute(harness.routes, '/buka-workers/remove', {
      body: { name: 'clock' },
    })
    assert.equal(removed.status, 409)
    assert.equal(removed.body.code, 'builtin-worker')
    const renamed = await callRoute(harness.routes, '/buka-workers/rename', {
      body: { name: 'clock', newName: 'timer' },
    })
    assert.equal(renamed.status, 409)
    assert.equal(renamed.body.code, 'builtin-worker')
    const avatar = await callRoute(harness.routes, '/buka-workers/avatar', {
      body: { name: 'clock', avatar: 'owl' },
    })
    assert.equal(avatar.status, 409)
    assert.equal(avatar.body.code, 'robot-worker')

    // 列表包含 clock，带 driver / assistant，且没有目录状态。
    const listed = await callRoute(harness.routes, '/buka-workers/list', { method: 'GET' })
    assert.equal(listed.status, 200)
    const clock = listed.body.workers.find((worker) => worker.name === 'clock')
    assert.ok(clock, '列表里应有内建 clock')
    assert.equal(clock.driver, 'robot')
    assert.equal(clock.program, 'clock')
    assert.equal(clock.assistant, false)
    assert.equal(clock.exists, false)
    assert.equal(clock.mounted, false)
  } finally {
    await harness.cleanup()
  }
})

test('POST /buka-workers/model：保存 / 清除智能体的模型，机器人只读', async () => {
  const harness = await makeHarness()
  try {
    const agent = { agent: { id: 'builder' } }
    await harness.tool.execute({ name: 'writer' }, agent)

    const saved = await callRoute(harness.routes, '/buka-workers/model', {
      body: {
        name: 'writer',
        model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      },
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body.worker.model, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
    const registry = JSON.parse(await fs.readFile(harness.registryFile, 'utf8'))
    const stored = registry.workers.find((worker) => worker.name === 'writer')
    assert.deepEqual(stored.model, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })

    // null 表示清除配置，跟随宿主默认模型。
    const cleared = await callRoute(harness.routes, '/buka-workers/model', {
      body: { name: 'writer', model: null },
    })
    assert.equal(cleared.status, 200)
    assert.equal('model' in cleared.body.worker, false)

    // 非法模型（空 provider）400。
    const invalid = await callRoute(harness.routes, '/buka-workers/model', {
      body: { name: 'writer', model: { provider: '', model: 'm' } },
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'invalid-model')

    // 内建机器人只读。
    await callRoute(harness.routes, '/buka-workers/create', {
      body: { name: 'temp' },
    })
    const clock = await callRoute(harness.routes, '/buka-workers/model', {
      body: { name: 'clock', model: { provider: 'deepseek', model: 'deepseek-chat' } },
    })
    assert.equal(clock.status, 409)
    assert.equal(clock.body.code, 'robot-worker')
  } finally {
    await harness.cleanup()
  }
})

test('GET /buka-workers/models：没有 ctx.llm 时返回 available=false', async () => {
  const harness = await makeHarness()
  try {
    const result = await callRoute(harness.routes, '/buka-workers/models', { method: 'GET' })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.available, false)
    assert.deepEqual(result.body.groups, [])
    assert.deepEqual(result.body.failures, [])
    assert.equal(result.body.default, null)
  } finally {
    await harness.cleanup()
  }
})
