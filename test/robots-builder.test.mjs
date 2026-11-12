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
import { promises as fs, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  normalizePresets,
  resolveRobotBuildAccess,
  resolveRobotSkillsVisibility,
} from '../plugins/robots/src/access.ts'
import { AVATAR_IDS, DEFAULT_AVATAR_ID } from '../plugins/robots/src/avatar.ts'
import { createRobotBuildTool, ROBOT_BUILD_TOOL_NAME } from '../plugins/robots/src/build-tool.ts'
import {
  BUILD_ERROR_CODES,
  buildRobot,
  currentMount,
  mountRobot,
  normalizeBuildRequest,
} from '../plugins/robots/src/builder.ts'
import {
  readClaudeLink,
  readRobotRegistry,
  writeRobotRegistry,
} from '../plugins/robots/src/robot-store.ts'

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
 * 假的工作区注册表：记录 `create` / `delete` 调用，`list` 返回当前数据。
 *
 * @param {{ workspaces?: Array<{ id: string, path: string }>, create?: (directory: string) => Promise<{ id: string }> }} [options]
 * @returns {{
 *   list: () => Array<{ id: string, path: string }>,
 *   create: (directory: string) => Promise<{ id: string }>,
 *   delete: (id: string) => boolean,
 *   created: string[],
 *   deleted: string[],
 * }}
 */
function fakeWorkspaceRegistry(options = {}) {
  /** @type {string[]} */
  const created = []
  /** @type {string[]} */
  const deleted = []
  let workspaces = [...(options.workspaces ?? [])]
  return {
    created,
    deleted,
    list: () => workspaces,
    create:
      options.create ??
      (async (directory) => {
        created.push(directory)
        const workspace = { id: `workspace-${created.length}`, path: directory }
        workspaces = [workspace, ...workspaces]
        return workspace
      }),
    delete: (id) => {
      deleted.push(id)
      const before = workspaces.length
      workspaces = workspaces.filter((workspace) => workspace.id !== id)
      return workspaces.length < before
    },
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
    newName: '',
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
      newName: '',
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
  // 改名：newName 必须合法，且必须配 update: true。
  assert.equal(
    normalizeBuildRequest({ name: 'writer', newName: '  author ', update: true }).newName,
    'author',
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', newName: '../escape', update: true }),
    (error) => error.code === BUILD_ERROR_CODES.invalidName,
  )
  assert.throws(
    () => normalizeBuildRequest({ name: 'writer', newName: 'author' }),
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
  assert.deepEqual(resolveRobotBuildAccess({ allowed: ['robot-builder'], agentId: 'root' }), {
    visible: false,
    preset: null,
    reason: 'unavailable',
  })
  assert.deepEqual(resolveRobotBuildAccess({ allowed: [] }), {
    visible: true,
    preset: null,
    reason: 'open',
  })
  assert.equal(resolveRobotBuildAccess().reason, 'open')

  assert.deepEqual(normalizePresets([' robot-builder ', '', 42, 'standard']), [
    'robot-builder',
    'standard',
  ])
  assert.deepEqual(normalizePresets('robot-builder'), [])
})

test('resolveRobotSkillsVisibility：工作流编排 preset 固定看不到技能清单，识别不出调用方时保持可见', () => {
  const sessions = new Map([
    ['orchestrator', { id: 'orchestrator', header: {} }],
    ['builder', { id: 'builder', header: {} }],
    ['fresh', { id: 'fresh', header: {} }],
  ])
  const presets = new Map([
    ['orchestrator', 'workflow-orchestrator'],
    ['builder', 'robot-builder'],
    ['fresh', null],
  ])
  const services = {
    sessions: { get: (id) => sessions.get(id) },
    agentPresets: { presetForSession: (session) => presets.get(session.id) ?? null },
  }
  const visibility = (agentId) => resolveRobotSkillsVisibility({ agentId, ...services })

  // 固定规则：随包发布的工作流编排 preset 看不到技能清单，其他 preset 正常可见。
  assert.deepEqual(visibility('orchestrator'), {
    visible: false,
    preset: 'workflow-orchestrator',
    reason: 'hidden',
  })
  assert.deepEqual(visibility('builder'), {
    visible: true,
    preset: 'robot-builder',
    reason: 'visible',
  })
  assert.deepEqual(visibility('fresh'), { visible: true, preset: null, reason: 'no-preset' })
  assert.deepEqual(visibility('missing'), { visible: true, preset: null, reason: 'no-session' })
  assert.equal(visibility('').reason, 'no-session')

  // 只读信息的收窄：识别不出调用方时保持可见（与写操作的收紧策略不同）。
  assert.deepEqual(resolveRobotSkillsVisibility({ agentId: 'orchestrator' }), {
    visible: true,
    preset: null,
    reason: 'unavailable',
  })
  assert.equal(resolveRobotSkillsVisibility().reason, 'unavailable')
  assert.equal(resolveRobotSkillsVisibility().visible, true)
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
    assert.equal(result.robot.driver, 'agent')
    assert.equal(result.robot.assistant, false, 'build 工具创建的 agent 机器人默认不是助理')
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
    assert.ok(
      claude.mode === 'symlink' || claude.mode === 'import',
      `unexpected claude mode ${claude.mode}`,
    )

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
    const result = await buildRobot({
      ...store,
      name: 'writer',
      workspaceRegistry: fakeWorkspaceRegistry(),
    })

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
    const first = await buildRobot({
      ...store,
      name: 'writer',
      agents: '# 原稿\n',
      workspaceRegistry: registry,
    })

    await assert.rejects(
      () =>
        buildRobot({ ...store, name: 'writer', agents: '# 覆盖\n', workspaceRegistry: registry }),
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
    assert.equal(
      await fs.readFile(path.join(first.robot.path, 'AGENTS.md'), 'utf8'),
      '# 第二版\n',
      '没传 AGENTS.md 时保留原文件',
    )
    const registryFile = await readRobotRegistry({ file: store.file })
    assert.equal(registryFile.robots[0].avatar, 'panda')

    // 空更新：什么都不写，也不报错。
    const fourth = await buildRobot({
      ...store,
      name: 'writer',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(fourth.updated, false)
    assert.equal(fourth.created, false)
    assert.equal(registry.created.length, 1, '已挂载的机器人不会再 create 一次')

    // update 用于不存在的名字时按新建处理。
    const created = await buildRobot({
      ...store,
      name: 'fresh',
      update: true,
      agents: '# fresh\n',
      workspaceRegistry: registry,
    })
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
    const first = await buildRobot({
      ...store,
      name: 'writer',
      agents: '# 原稿\n',
      workspaceRegistry: registry,
    })
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
    const first = await buildRobot({
      ...store,
      name: 'writer',
      workspaceRegistry: fakeWorkspaceRegistry(),
    })
    const robotPath = first.robot.path

    // 已有同名工作区：直接复用，不再 create。
    const reused = fakeWorkspaceRegistry({
      workspaces: [{ id: 'workspace-existing', path: robotPath }],
    })
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
    const mounted = await buildRobot({
      ...store,
      name: 'writer',
      update: true,
      workspaceRegistry: failing,
    })
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
    assistant: false,
    created: true,
    updated: false,
    renamed: false,
    previousName: null,
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
      driver: 'agent',
      path: '/tmp/robots/writer',
      avatar: 'owl',
      description: '把会议记录整理成三点结论',
      createdAt: '2026-01-01T00:00:00.000Z',
      assistant: false,
    },
    created: true,
    updated: false,
    renamed: false,
    previousName: null,
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
  assert.equal(tool.parameters.newName.type, 'string')
  assert.ok(tool.description.includes('sprout'), '描述里列出可选头像 id')
  assert.ok(tool.description.includes('update: true'), '描述里说明覆盖要先 update')
  assert.ok(tool.description.includes('newName'), '描述里说明改名入口')
  assert.equal(tool.output.schema.properties.workspaceId.oneOf.length, 2)
  assert.equal(tool.output.schema.properties.renamed.type, 'boolean')
  assert.equal(tool.output.schema.properties.previousName.oneOf.length, 2)
  assert.equal(tool.output.schema.properties.assistant.required, true)
  assert.equal(tool.output.schema.properties.assistant.type, 'boolean')

  const agent = { id: 'root' }
  const output = await tool.execute({ name: 'writer', agents: '# x' }, { agent })
  assert.deepEqual(asserted, [{ agent }])
  assert.deepEqual(runs, [{ name: 'writer', agents: '# x' }])
  assert.deepEqual(output, {
    name: 'writer',
    path: '/tmp/robots/writer',
    avatar: 'owl',
    description: '把会议记录整理成三点结论',
    assistant: false,
    created: true,
    updated: false,
    renamed: false,
    previousName: null,
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
      buildResult({
        created: false,
        updated: true,
        workspaceId: 7,
        mounted: false,
        mountError: 'boom',
      }),
  }).execute({}, { agent })
  assert.deepEqual(await unmounted, {
    name: 'writer',
    path: '/tmp/robots/writer',
    avatar: 'owl',
    description: '把会议记录整理成三点结论',
    assistant: false,
    created: false,
    updated: true,
    renamed: false,
    previousName: null,
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
  assert.match(
    render(toolOutput({ created: false, updated: true, agentsBytes: 0 })),
    /^Updated robot: writer/,
  )
  assert.match(render(toolOutput({ mountError: 'boom', mounted: false })), /Not mounted: boom/)
  // 改名：第一行给出旧名 → 新名，并说明旧会话不再挂在该机器人下。
  const renamedRender = render(
    toolOutput({
      created: false,
      updated: true,
      renamed: true,
      previousName: 'writer',
      name: 'author',
    }),
  )
  assert.match(renamedRender, /^Renamed robot: writer → author/)
  assert.match(renamedRender, /no longer listed under the robot/)
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
  await assert.rejects(
    () => tool.execute({ name: 'writer' }, { agent: { id: 'other' } }),
    /robot-builder/,
  )
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

  const index = readFileSync(new URL('../plugins/robots/src/index.ts', import.meta.url), 'utf8')
  assert.match(index, /const DEFAULT_BUILDER_PRESETS = \['robot-builder'\]/)
})

test('package.json 的 files 用 lib 覆盖全部产物，避免发布时漏文件', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../plugins/robots/package.json', import.meta.url), 'utf8'),
  )
  const modules = readdirSync(new URL('../plugins/robots/lib', import.meta.url)).filter((name) =>
    name.endsWith('.js'),
  )
  assert.ok(modules.length > 0)
  // lib/ 是构建产物目录，files 里用整目录覆盖（index.js 与 client.js 都在里面）。
  assert.ok(pkg.files.includes('lib'), 'package.json files 缺少 lib')
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.equal(
    pkg.files.includes('client.js'),
    false,
    '客户端产物在 lib/ 下，不应再单独列出 client.js',
  )
  assert.equal(pkg.exports['./client'], './lib/client.js')
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
    assert.equal(
      (await readRobotRegistry({ file: store.file })).robots[0].description,
      '写发布说明',
    )

    const second = await buildRobot({
      ...store,
      name: 'writer',
      description: '写发布说明与测试报告',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(second.updated, true)
    assert.equal(second.robot.description, '写发布说明与测试报告')
    assert.equal(
      (await readRobotRegistry({ file: store.file })).robots[0].description,
      '写发布说明与测试报告',
    )

    // 不传 / 传空串都保留原描述，避免 update 顺手清空。
    const third = await buildRobot({
      ...store,
      name: 'writer',
      update: true,
      workspaceRegistry: registry,
    })
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

test('buildRobot：newName 改目录与登记表，并按新路径重建工作区', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const first = await buildRobot({
      ...store,
      name: 'writer',
      avatar: 'owl',
      description: '写发布说明',
      agents: '# 原稿\n',
      workspaceRegistry: registry,
    })
    assert.deepEqual(registry.created, [first.robot.path], '创建时挂到旧路径')

    const renamed = await buildRobot({
      ...store,
      name: 'writer',
      newName: 'author',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(renamed.created, false)
    assert.equal(renamed.updated, true)
    assert.equal(renamed.renamed, true)
    assert.equal(renamed.previousName, 'writer')
    assert.equal(renamed.robot.name, 'author')
    assert.equal(renamed.robot.path, path.join(path.dirname(first.robot.path), 'author'))
    assert.equal(renamed.robot.avatar, 'owl', '头像保留')
    assert.equal(renamed.robot.description, '写发布说明', '职责保留')
    assert.equal(renamed.robot.createdAt, first.robot.createdAt, '创建时间保留')
    assert.equal(
      await fs.stat(first.robot.path).then(
        () => true,
        () => false,
      ),
      false,
      '旧目录已不存在',
    )
    assert.equal(await fs.readFile(path.join(renamed.robot.path, 'AGENTS.md'), 'utf8'), '# 原稿\n')

    const registered = await readRobotRegistry({ file: store.file })
    assert.deepEqual(
      registered.robots.map((robot) => robot.name),
      ['author'],
    )
    assert.equal(registered.robots[0].path, renamed.robot.path)

    // 旧工作区注册被摘掉，新路径重建一个新工作区（新 id）。
    assert.deepEqual(registry.deleted, [first.workspaceId])
    assert.equal(registry.created.length, 2)
    assert.equal(registry.created[1], renamed.robot.path)
    assert.equal(renamed.mounted, true)
    assert.notEqual(renamed.workspaceId, first.workspaceId)
    assert.equal(renamed.mountError, null)

    // 目录改名后 CLAUDE.md 的相对软链接仍然有效。
    const claude = await readClaudeLink(renamed.robot.path)
    assert.equal(claude.exists, true)
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：newName 必须配 update，目标名/目录被占用时拒绝，同名视为不改名', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const writer = await buildRobot({ ...store, name: 'writer', workspaceRegistry: registry })
    await buildRobot({ ...store, name: 'painter', workspaceRegistry: registry })

    // 没有 update：不允许改已存在机器人的名字。
    await assert.rejects(
      () =>
        buildRobot({ ...store, name: 'writer', newName: 'author', workspaceRegistry: registry }),
      (error) => error.code === BUILD_ERROR_CODES.invalidUpdate,
    )
    // 新名与登记表里的机器人重名。
    await assert.rejects(
      () =>
        buildRobot({
          ...store,
          name: 'writer',
          newName: 'painter',
          update: true,
          workspaceRegistry: registry,
        }),
      (error) => error.code === BUILD_ERROR_CODES.nameTaken,
    )
    // 新名与 robotsDir 下已存在的目录重名（没有登记条目也不能占）。
    await fs.mkdir(path.join(store.robotsDir, 'ghost'))
    await assert.rejects(
      () =>
        buildRobot({
          ...store,
          name: 'writer',
          newName: 'ghost',
          update: true,
          workspaceRegistry: registry,
        }),
      (error) => error.code === BUILD_ERROR_CODES.nameTaken,
    )
    // 不能把不存在的机器人「改名」出来。
    await assert.rejects(
      () =>
        buildRobot({
          ...store,
          name: 'nobody',
          newName: 'author',
          update: true,
          workspaceRegistry: registry,
        }),
      (error) => error.code === BUILD_ERROR_CODES.unknownRobot,
    )

    // 同名：no-op，不碰目录与登记表。
    const same = await buildRobot({
      ...store,
      name: 'writer',
      newName: 'writer',
      update: true,
      workspaceRegistry: registry,
    })
    assert.equal(same.renamed, false)
    assert.equal(same.previousName, null)
    assert.equal(same.updated, false)
    assert.equal(same.robot.path, writer.robot.path)
    assert.equal((await fs.stat(writer.robot.path)).isDirectory(), true)
    assert.deepEqual(
      (await readRobotRegistry({ file: store.file })).robots.map((robot) => robot.name),
      ['painter', 'writer'],
    )
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：改名与头像 / 职责 / AGENTS.md 同一次调用；未挂载的机器人改名后重新挂载', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()
    const first = await buildRobot({ ...store, name: 'writer', workspaceRegistry: registry })

    const renamed = await buildRobot({
      ...store,
      name: 'writer',
      newName: 'author',
      update: true,
      avatar: 'panda',
      description: '写发布说明与测试报告',
      agents: '# 新版 AGENTS.md\n',
      workspaceRegistry: registry,
    })
    assert.equal(renamed.renamed, true)
    assert.equal(renamed.robot.avatar, 'panda')
    assert.equal(renamed.robot.description, '写发布说明与测试报告')
    assert.equal(
      await fs.readFile(path.join(renamed.robot.path, 'AGENTS.md'), 'utf8'),
      '# 新版 AGENTS.md\n',
    )
    assert.equal(renamed.robot.createdAt, first.robot.createdAt)

    // 未挂载的机器人在改名后会按新路径重新挂载。
    const loose = await buildRobot({ ...store, name: 'loose' })
    assert.equal(loose.mounted, false)
    const mountAfterRename = await buildRobot({
      ...store,
      name: 'loose',
      newName: 'loose-next',
      update: true,
      workspaceRegistry: fakeWorkspaceRegistry(),
    })
    assert.equal(mountAfterRename.renamed, true)
    assert.equal(mountAfterRename.mounted, true)
    assert.equal(mountAfterRename.workspaceId, 'workspace-1')
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：内建 clock 不可创建，也不可作为改名目标', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    const registry = fakeWorkspaceRegistry()

    await assert.rejects(
      () => buildRobot({ ...store, name: 'clock', workspaceRegistry: registry }),
      (error) => error.code === BUILD_ERROR_CODES.builtinRobot,
    )

    const writer = await buildRobot({ ...store, name: 'writer', workspaceRegistry: registry })
    await assert.rejects(
      () =>
        buildRobot({
          ...store,
          name: 'writer',
          newName: 'clock',
          update: true,
          workspaceRegistry: registry,
        }),
      (error) => error.code === BUILD_ERROR_CODES.builtinRobot,
    )
    // 失败的调用没有动登记表与目录。
    assert.deepEqual(
      (await readRobotRegistry({ file: store.file })).robots.map((robot) => robot.name),
      ['writer'],
    )
    assert.equal((await fs.stat(writer.robot.path)).isDirectory(), true)
  } finally {
    await removeRoot(root)
  }
})

test('buildRobot：program 型机器人只读，构建工具不能修改它', async () => {
  const root = await makeRoot()
  try {
    const store = storeOf(root)
    await writeRobotRegistry({
      file: store.file,
      robots: [
        {
          name: 'timer',
          driver: 'program',
          program: 'clock',
          createdAt: '2026-01-01T00:00:00.000Z',
          description: '到点完成任务',
          assistant: false,
        },
      ],
    })

    await assert.rejects(
      () =>
        buildRobot({
          ...store,
          name: 'timer',
          description: '改描述',
          update: true,
          workspaceRegistry: fakeWorkspaceRegistry(),
        }),
      (error) => error.code === BUILD_ERROR_CODES.programRobot,
    )
    const registry = await readRobotRegistry({ file: store.file })
    assert.equal(registry.robots.length, 1)
    assert.equal(registry.robots[0].description, '到点完成任务')

    // 新建时看到同名 program 条目也不能覆盖。
    await assert.rejects(
      () => buildRobot({ ...store, name: 'timer', workspaceRegistry: fakeWorkspaceRegistry() }),
      (error) => error.code === BUILD_ERROR_CODES.programRobot,
    )
  } finally {
    await removeRoot(root)
  }
})
