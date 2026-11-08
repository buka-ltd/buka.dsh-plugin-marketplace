/**
 * 「机器人构建」preset 相关纯逻辑的单测：可见性判定（access.js）、
 * 构建请求规范化与创建 / 修改 / 挂载（builder.js）、工具定义与结果映射
 * （build-tool.js）。
 *
 * 全部用 `fs.mkdtemp(tmpdir())` 的临时目录与假的工作区注册表，不联网、
 * 不读真实 home、不启动 DSH。`createRobotBuildTool` 的 `defineTool` 用假实现
 * 直接返回定义对象，所以这里不需要安装 `@deepseek-ai/dsh-tools`。
 */

import assert from 'node:assert/strict'
import { promises as fs, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { normalizePresets, resolveRobotBuildAccess } from '../plugins/robots/lib/access.js'
import { AVATAR_IDS, DEFAULT_AVATAR_ID } from '../plugins/robots/lib/avatar.js'
import { ROBOT_BUILD_TOOL_NAME, createRobotBuildTool } from '../plugins/robots/lib/build-tool.js'
import {
  BUILD_ERROR_CODES,
  buildRobot,
  currentMount,
  mountRobot,
  normalizeBuildRequest,
} from '../plugins/robots/lib/builder.js'
import { readClaudeLink, readRobotRegistry } from '../plugins/robots/lib/robot-store.js'

/**
 * 建一个临时根目录。
 *
 * @returns {Promise<string>}
 */
async function makeRoot() {
  return await fs.mkdtemp(path.join(tmpdir(), 'buka-robots-builder-'))
}

/**
 * 删掉临时根目录。
 *
 * @param {string} root
 * @returns {Promise<void>}
 */
async function removeRoot(root) {
  await fs.rm(root, { recursive: true, force: true })
}

/**
 * 临时根目录里的 `{ robotsDir, file }`。
 *
 * @param {string} root
 * @returns {{ robotsDir: string, file: string }}
 */
function storeOf(root) {
  return { robotsDir: path.join(root, 'robots'), file: path.join(root, 'robots.json') }
}

/**
 * 假的工作区注册表：记录 `create` 调用，`list` 返回调用方给的数据。
 *
 * @param {{ workspaces?: Array<{ id: string, path: string }>, create?: (directory: string) => Promise<{ id: string }> }} [options]
 * @returns {{ list: () => Array<{ id: string, path: string }>, create: (directory: string) => Promise<{ id: string }>, created: string[] }}
 */
function fakeWorkspaceRegistry(options = {}) {
  /** @type {string[]} */
  const created = []
  let workspaces = [...(options.workspaces ?? [])]
  return {
    created,
    list: () => workspaces,
    create:
      options.create ??
      (async (directory) => {
        created.push(directory)
        const workspace = { id: `workspace-${created.length}`, path: directory }
        workspaces = [workspace, ...workspaces]
        return workspace
      }),
  }
}

test('normalizeBuildRequest：名称、头像、AGENTS.md 与 update 的边界', () => {
  assert.deepEqual(normalizeBuildRequest({ name: '  writer  ' }), {
    name: 'writer',
    avatar: '',
    description: '',
    agents: '',
    agentsBytes: 0,
    update: false,
  })
  assert.deepEqual(
    normalizeBuildRequest({
      name: '新闻-机器人',
      avatar: 'owl',
      description: '  把新闻\n整理成简报  ',
      agents: '# 角色\n',
      update: true,
    }),
    {
      name: '新闻-机器人',
      avatar: 'owl',
      description: '把新闻 整理成简报',
      agents: '# 角色\n',
      agentsBytes: Buffer.byteLength('# 角色\n', 'utf8'),
      update: true,
    },
  )
  // 全空白的 AGENTS.md 视为「不写」，避免模型误清空。
  assert.equal(normalizeBuildRequest({ name: 'writer', agents: ' \n\t ' }).agents, '')

  assert.throws(
    () => normalizeBuildRequest({ name: '../escape' }),
    (error) => error.code === BUILD_ERROR_CODES.invalidName,
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', avatar: 'dragon' }),
    (error) =>
      error.code === BUILD_ERROR_CODES.invalidAvatar &&
      error.message.includes('sprout') &&
      error.message.includes(DEFAULT_AVATAR_ID),
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', description: 42 }),
    (error) => error.code === BUILD_ERROR_CODES.invalidDescription,
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', description: 'x'.repeat(501) }),
    (error) => error.code === BUILD_ERROR_CODES.invalidDescription,
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', agents: 42 }),
    (error) => error.code === BUILD_ERROR_CODES.invalidAgents,
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', update: 'yes' }),
    (error) => error.code === BUILD_ERROR_CODES.invalidUpdate,
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', agents: 'x'.repeat(512 * 1024 + 1) }),
    (error) => error.code === BUILD_ERROR_CODES.agentsTooLarge,
  )
})

test('resolveRobotBuildAccess：只放行点名 preset 的根会话，服务缺失时收紧', () => {
  const sessions = new Map([
    ['root', { id: 'root', header: {} }],
    ['child', { id: 'child', header: { parentSession: 'root' } }],
    ['other', { id: 'other', header: {} }],
    ['fresh', { id: 'fresh', header: {} }],
  ])
  const presets = new Map([
    ['root', 'robot-builder'],
    ['child', 'robot-builder'],
    ['other', 'standard'],
    ['fresh', null],
  ])
  const services = {
    sessions: { get: (id) => sessions.get(id) },
    agentPresets: { presetForSession: (session) => presets.get(session.id) ?? null },
  }
  const access = (agentId, allowed = ['robot-builder']) =>
    resolveRobotBuildAccess({ allowed, agentId, ...services })

  assert.deepEqual(access('root'), { visible: true, preset: 'robot-builder', reason: 'allowed' })
  assert.deepEqual(access('child'), { visible: false, preset: null, reason: 'child-session' })
  assert.deepEqual(access('other'), { visible: false, preset: 'standard', reason: 'denied' })
  assert.deepEqual(access('fresh'), { visible: false, preset: null, reason: 'no-preset' })
  assert.deepEqual(access('missing'), { visible: false, preset: null, reason: 'no-session' })
  assert.equal(access('').reason, 'no-session')

  // 配置留空：显式关掉收窄。
  assert.deepEqual(access('other', []), { visible: true, preset: null, reason: 'open' })

  // 服务不可用：写操作收紧（与工作流插件的「保持可见」不同）。
  assert.deepEqual(
    resolveRobotBuildAccess({ allowed: ['robot-builder'], agentId: 'root' }),
    { visible: false, preset: null, reason: 'unavailable' },
  )
  assert.deepEqual(resolveRobotBuildAccess({ allowed: [] }), { visible: true, preset: null, reason: 'open' })
  assert.equal(resolveRobotBuildAccess().reason, 'open')

  assert.deepEqual(normalizePresets([' robot-builder ', '', 42, 'standard']), ['robot-builder', 'standard'])
  assert.deepEqual(normalizePresets('robot-builder'), [])
})

test('buildRobot：新建机器人写目录、登记、AGENTS.md、CLAUDE.md 链接并挂载', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const agents = '# 新闻简报机器人\n\n## 角色\n\n每天把行业新闻整理成三条结论。\n'
    const result = await buildRobot({
      ...store,
      name: '简报',
      avatar: 'owl',
      agents,
      workspaceRegistry: registry,
    })

    assert.equal(result.created, true)
    assert.equal(result.updated, false)
    assert.equal(result.robot.name, '简报')
    assert.equal(result.robot.avatar, 'owl')
    assert.equal(result.agentsBytes, Buffer.byteLength(agents, 'utf8'))
    assert.equal(result.mounted, true)
    assert.equal(result.workspaceId, 'workspace-1')
    assert.equal(result.mountError, null)
    assert.deepEqual(registry.created, [result.robot.path])
    assert.equal(await fs.readFile(path.join(result.robot.path, 'AGENTS.md'), 'utf8'), agents)
    assert.equal((await fs.stat(result.robot.path)).isDirectory(), true)

    // CLAUDE.md 指向同一份内容（符号链接或降级的 @AGENTS.md）。
    const claude = await readClaudeLink(result.robot.path)
    assert.equal(claude.exists, true)
    assert.ok(claude.mode === 'symlink' || claude.mode === 'import', `unexpected claude mode ${claude.mode}`)

    const registered = await readRobotRegistry({ file: store.file })
    assert.equal(registered.robots.length, 1)
    assert.equal(registered.robots[0].name, '简报')
    assert.equal(registered.robots[0].avatar, 'owl')
    assert.equal(registered.robots[0].path, result.robot.path)
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：不传头像时自动分配，不传 AGENTS.md 时用模板', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const result = await buildRobot({ ...store, name: 'writer', workspaceRegistry: fakeWorkspaceRegistry() })

    assert.equal(result.created, true)
    assert.equal(result.agentsBytes, 0)
    assert.ok(AVATAR_IDS.includes(result.robot.avatar))
    const template = await fs.readFile(path.join(result.robot.path, 'AGENTS.md'), 'utf8')
    assert.ok(template.startsWith('# AGENTS.md'))
    assert.ok(template.includes('writer'), '模板里带机器人名字')
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：同名机器人没有 update 时拒绝且不覆盖现有文件', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const first = await buildRobot({ ...store, name: 'writer', agents: '# 原稿\n', workspaceRegistry: registry })

    await assert.rejects(
      () => buildRobot({ ...store, name: 'writer', agents: '# 覆盖\n', workspaceRegistry: registry }),
      (error) => error.code === BUILD_ERROR_CODES.robotExists,
    )
    assert.equal(await fs.readFile(path.join(first.robot.path, 'AGENTS.md'), 'utf8'), '# 原稿\n')
    assert.equal((await readRobotRegistry({ file: store.file })).robots.length, 1)
    assert.equal(registry.created.length, 1, '被拒绝的调用不会再挂载一次')
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：update 只改传入的字段，目录、创建时间与登记条数不变', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const first = await buildRobot({
      ...store,
      name: 'writer',
      avatar: 'owl',
      agents: '# 第一版\n',
      workspaceRegistry: registry,
    })

    const second = await buildRobot({
      ...store,
      name: 'writer',
      agents: '# 第二版\n',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(second.created, false)
    assert.equal(second.updated, true)
    assert.equal(second.robot.path, first.robot.path)
    assert.equal(second.robot.createdAt, first.robot.createdAt)
    assert.equal(second.robot.avatar, 'owl', '没传头像时保留原头像')
    assert.equal(await fs.readFile(path.join(first.robot.path, 'AGENTS.md'), 'utf8'), '# 第二版\n')
    assert.equal((await readRobotRegistry({ file: store.file })).robots.length, 1)

    const third = await buildRobot({
      ...store,
      name: 'writer',
      avatar: 'panda',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(third.updated, true)
    assert.equal(third.robot.avatar, 'panda')
    assert.equal(await fs.readFile(path.join(first.robot.path, 'AGENTS.md'), 'utf8'), '# 第二版\n', '没传 AGENTS.md 时保留原文件')
    const registryFile = await readRobotRegistry({ file: store.file })
    assert.equal(registryFile.robots[0].avatar, 'panda')

    // 空更新：什么都不写，也不报错。
    const fourth = await buildRobot({ ...store, name: 'writer', update: true, workspaceRegistry: registry })
    assert.equal(fourth.updated, false)
    assert.equal(fourth.created, false)
    assert.equal(registry.created.length, 1, '已挂载的机器人不会再 create 一次')

    // update 用于不存在的名字时按新建处理。
    const created = await buildRobot({ ...store, name: 'fresh', update: true, agents: '# fresh\n', workspaceRegistry: registry })
    assert.equal(created.created, true)
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：已登记但目录被外部删掉时，update 会重建目录再写 AGENTS.md', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const first = await buildRobot({ ...store, name: 'writer', agents: '# 原稿\n', workspaceRegistry: registry })
    await fs.rm(first.robot.path, { recursive: true, force: true })

    const again = await buildRobot({
      ...store,
      name: 'writer',
      agents: '# 重建版\n',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(again.created, false, '登记还在，不是新建')
    assert.equal(again.updated, true)
    assert.equal(again.robot.path, first.robot.path, '目录按登记里的路径重建')
    assert.equal(await fs.readFile(path.join(again.robot.path, 'AGENTS.md'), 'utf8'), '# 重建版\n')
    assert.equal((await readRobotRegistry({ file: store.file })).robots.length, 1)
  } finally {
    await removeRoot(root)
  }
})

test('mountRobot / currentMount：按规范路径判断是否已挂载，失败不抛错', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const first = await buildRobot({ ...store, name: 'writer', workspaceRegistry: fakeWorkspaceRegistry() })
    const robotPath = first.robot.path

    // 已有同名工作区：直接复用，不再 create。
    const reused = fakeWorkspaceRegistry({ workspaces: [{ id: 'workspace-existing', path: robotPath }] })
    assert.deepEqual(await currentMount({ workspaceRegistry: reused, robotPath }), {
      id: 'workspace-existing',
      path: robotPath,
    })
    assert.deepEqual(await mountRobot({ workspaceRegistry: reused, robotPath }), {
      mounted: true,
      workspaceId: 'workspace-existing',
      mountError: null,
    })
    assert.equal(reused.created.length, 0)

    // 没有 create 能力：机器人仍然可用，但报告未挂载。
    const readOnly = { list: () => [] }
    assert.deepEqual(await mountRobot({ workspaceRegistry: readOnly, robotPath }), {
      mounted: false,
      workspaceId: null,
      mountError: 'the workspace registry is unavailable in this composition',
    })
    assert.equal(await currentMount({ workspaceRegistry: undefined, robotPath }), null)

    // create 抛错：不中断构建，返回原因。
    const failing = fakeWorkspaceRegistry({
      create: async () => {
        throw new Error('workspace/path-exists')
      },
    })
    const mounted = await buildRobot({ ...store, name: 'writer', update: true, workspaceRegistry: failing })
    assert.equal(mounted.mounted, false)
    assert.equal(mounted.mountError, 'workspace/path-exists')
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：登记表损坏时拒绝写入，错误码明确', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    await fs.writeFile(store.file, '{broken')
    await assert.rejects(
      () => buildRobot({ ...store, name: 'writer', workspaceRegistry: fakeWorkspaceRegistry() }),
      (error) => error.code === BUILD_ERROR_CODES.registryUnreadable,
    )
    assert.equal(await fs.readFile(store.file, 'utf8'), '{broken', '不覆盖损坏的登记表')
  } finally {
    await removeRoot(root)
  }
})

/**
 * 工具输出测试用的映射结果（`execute` 的返回形状）。
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function toolOutput(overrides = {}) {
  return {
    name: 'writer',
    path: '/tmp/robots/writer',
    avatar: 'owl',
    description: '把会议记录整理成三点结论',
    created: true,
    updated: false,
    agentsBytes: 12,
    mounted: true,
    workspaceId: 'workspace-1',
    mountError: null,
    ...overrides,
  }
}

/**
 * 工具测试用的构建结果。
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function buildResult(overrides = {}) {
  return {
    robot: {
      name: 'writer',
      path: '/tmp/robots/writer',
      avatar: 'owl',
      description: '把会议记录整理成三点结论',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    created: true,
    updated: false,
    agentsBytes: 12,
    mounted: true,
    workspaceId: 'workspace-1',
    mountError: null,
    ...overrides,
  }
}

test('createRobotBuildTool：定义、可见性兜底与结果映射', async () => {
  /** @type {Array<{ agent: unknown }>} */
  const asserted = []
  /** @type {Array<Record<string, unknown>>} */
  const runs = []
  const tool = createRobotBuildTool({
    defineTool: (definition) => definition,
    avatarIds: AVATAR_IDS,
    assertAccess: (agent) => asserted.push({ agent }),
    runBuild: async (args) => {
      runs.push(args)
      return buildResult()
    },
  })

  assert.equal(tool.name, ROBOT_BUILD_TOOL_NAME)
  assert.equal(tool.name, 'buka_robot_build')
  assert.equal(tool.parameters.name.required, true)
  assert.equal(tool.parameters.description.required, true)
  assert.equal(tool.parameters.update.type, 'boolean')
  assert.ok(tool.description.includes('sprout'), '描述里列出可选头像 id')
  assert.ok(tool.description.includes('update: true'), '描述里说明覆盖要先 update')
  assert.equal(tool.output.schema.properties.workspaceId.oneOf.length, 2)

  const agent = { id: 'root' }
  const output = await tool.execute({ name: 'writer', agents: '# x' }, { agent })
  assert.deepEqual(asserted, [{ agent }])
  assert.deepEqual(runs, [{ name: 'writer', agents: '# x' }])
  assert.deepEqual(output, {
    name: 'writer',
    path: '/tmp/robots/writer',
    avatar: 'owl',
    description: '把会议记录整理成三点结论',
    created: true,
    updated: false,
    agentsBytes: 12,
    mounted: true,
    workspaceId: 'workspace-1',
    mountError: null,
  })

  // 未挂载时把原因带回去，且非字符串 workspaceId 归一为 null。
  const unmounted = createRobotBuildTool({
    defineTool: (definition) => definition,
    avatarIds: AVATAR_IDS,
    assertAccess: () => {},
    runBuild: async () =>
      buildResult({ created: false, updated: true, workspaceId: 7, mounted: false, mountError: 'boom' }),
  }).execute({}, { agent })
  assert.deepEqual(await unmounted, {
    name: 'writer',
    path: '/tmp/robots/writer',
    avatar: 'owl',
    description: '把会议记录整理成三点结论',
    created: false,
    updated: true,
    agentsBytes: 12,
    mounted: false,
    workspaceId: null,
    mountError: 'boom',
  })

  // 渲染结果覆盖「已创建 / 已更新 / 未挂载」三种提示。
  const render = (value) => tool.output.render({}, value)[0].text
  assert.match(render(toolOutput()), /^Created robot: writer/)
  assert.match(render(toolOutput()), /Description: 把会议记录整理成三点结论/)
  assert.match(render(toolOutput({ description: '' })), /Description: \(none\)/)
  assert.match(render(toolOutput()), /Mounted as a workspace workspace-1\./)
  assert.match(render(toolOutput({ created: false, updated: true, agentsBytes: 0 })), /^Updated robot: writer/)
  assert.match(render(toolOutput({ mountError: 'boom', mounted: false })), /Not mounted: boom/)
})

test('createRobotBuildTool：assertAccess 抛错时不执行构建', async () => {
  let ran = false
  const tool = createRobotBuildTool({
    defineTool: (definition) => definition,
    avatarIds: AVATAR_IDS,
    assertAccess: () => {
      throw new Error('only the robot-builder preset')
    },
    runBuild: async () => {
      ran = true
      return buildResult()
    },
  })
  await assert.rejects(() => tool.execute({ name: 'writer' }, { agent: { id: 'other' } }), /robot-builder/)
  assert.equal(ran, false)
})

test('createRobotBuildTool：缺少依赖时直接报错，避免注册出半成品工具', () => {
  assert.throws(() => createRobotBuildTool(), /defineTool is required/)
  assert.throws(() => createRobotBuildTool({ defineTool: () => ({}) }), /runBuild is required/)
  assert.throws(
    () => createRobotBuildTool({ defineTool: () => ({}), runBuild: async () => ({}) }),
    /assertAccess is required/,
  )
})

test('bundle 补丁随插件发布 robot-builder preset，且与 Config 默认名单一致', () => {
  const patch = readFileSync(new URL('../plugins/robots/cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- id: preset-robot-builder/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-agent-preset'/)
  assert.match(patch, /config:\n\s+id: robot-builder/)
  assert.match(patch, /name: 机器人构建/)
  assert.match(patch, /order: 10/)

  const index = readFileSync(new URL('../plugins/robots/lib/index.js', import.meta.url), 'utf8')
  assert.match(index, /const DEFAULT_BUILDER_PRESETS = \['robot-builder'\]/)
})

test('package.json 的 files 覆盖 lib 下全部模块，避免发布时漏文件', () => {
  const pkg = JSON.parse(readFileSync(new URL('../plugins/robots/package.json', import.meta.url), 'utf8'))
  const modules = readdirSync(new URL('../plugins/robots/lib', import.meta.url))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `lib/${name}`)
  assert.ok(modules.length > 0)
  for (const module of modules) {
    assert.ok(pkg.files.includes(module), `package.json files 缺少 ${module}`)
  }
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.ok(pkg.files.includes('client.js'))
})

test('buildRobot：description 随创建写入，update 可改、空串保留原值', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()

    const first = await buildRobot({
      ...store,
      name: 'writer',
      description: '  写发布说明  ',
      workspaceRegistry: registry,
    })
    assert.equal(first.created, true)
    assert.equal(first.robot.description, '写发布说明')
    assert.equal((await readRobotRegistry({ file: store.file })).robots[0].description, '写发布说明')

    const second = await buildRobot({
      ...store,
      name: 'writer',
      description: '写发布说明与测试报告',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(second.updated, true)
    assert.equal(second.robot.description, '写发布说明与测试报告')
    assert.equal((await readRobotRegistry({ file: store.file })).robots[0].description, '写发布说明与测试报告')

    // 不传 / 传空串都保留原描述，避免 update 顺手清空。
    const third = await buildRobot({ ...store, name: 'writer', update: true, workspaceRegistry: registry })
    assert.equal(third.robot.description, '写发布说明与测试报告')
    const fourth = await buildRobot({
      ...store,
      name: 'writer',
      description: '   ',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(fourth.updated, false, '空描述不算一次更新')
    assert.equal(fourth.robot.description, '写发布说明与测试报告')
  } finally {
    await removeRoot(root)
  }
})
