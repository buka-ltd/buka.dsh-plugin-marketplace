/**
 * `buka_robots` 工具的单测：输出映射、按调用方隐藏技能清单、渲染文本。
 *
 * `defineTool` 与 `listRobots` 都用假实现，不读磁盘、不启动 DSH。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createRobotsListTool, ROBOTS_LIST_TOOL_NAME } from '../plugins/robots/src/list-tool.ts'

/** 假快照：两个机器人，一个有 2 个 skill、另一个 0 个。 */
const SNAPSHOT = {
  root: '/robots',
  registry: '/robots.json',
  corrupt: false,
  robots: [
    {
      name: 'writer',
      path: '/robots/writer',
      description: '写代码',
      mounted: true,
      workspaceId: 'ws-1',
      skills: [{ name: 'foo' }, { name: 'bar' }],
      agents: { exists: true },
    },
    {
      name: 'painter',
      path: '/robots/painter',
      description: '',
      mounted: false,
      workspaceId: null,
      skills: [],
      agents: { exists: false },
    },
  ],
}

/**
 * 建一个假 defineTool：直接返回定义对象。
 * @param {Record<string, unknown>} definition
 * @returns {Record<string, unknown>}
 */
function fakeDefineTool(definition) {
  return definition
}

/**
 * 建工具；`isSkillsVisible` 可控，`listRobots` 记录调用参数。
 * @param {{
 *   isSkillsVisible?: ((agent: { id?: string } | null | undefined) => boolean) | null,
 *   snapshot?: typeof SNAPSHOT,
 *   calls?: Array<Record<string, unknown>>,
 * }} [options]
 * @returns {Record<string, any>}
 */
function makeTool({ isSkillsVisible, snapshot = SNAPSHOT, calls = [] } = {}) {
  const tool = createRobotsListTool({
    defineTool: fakeDefineTool,
    listRobots: async (options) => {
      calls.push(options)
      return snapshot
    },
    registryFile: '/robots.json',
    robotsDir: '/robots',
    workspaceRegistry: { mounted: true },
    isSkillsVisible,
  })
  return /** @type {Record<string, any>} */ (tool)
}

test('createRobotsListTool：工具名、输出 schema 与依赖校验', () => {
  const tool = makeTool()
  assert.equal(tool.name, ROBOTS_LIST_TOOL_NAME)
  assert.equal(tool.name, 'buka_robots')

  const robotProps = tool.output.schema.properties.robots.items.properties
  // skills 是可选字段：编排 preset 拿到的输出里直接没有它。
  assert.equal(robotProps.skills.required, undefined)
  assert.equal(robotProps.name.required, true)
  assert.equal(robotProps.agentsFile.required, true)

  assert.throws(() => createRobotsListTool(), /defineTool is required/)
  assert.throws(
    () => createRobotsListTool({ defineTool: fakeDefineTool }),
    /listRobots is required/,
  )
})

test('createRobotsListTool：默认输出包含技能清单，并把调用参数传给 listRobots', async () => {
  const calls = []
  const tool = makeTool({ calls })
  const result = await tool.execute({}, { agent: { id: 'whatever' } })

  assert.deepEqual(calls, [
    { file: '/robots.json', workspaceRegistry: { mounted: true }, robotsDir: '/robots' },
  ])
  assert.deepEqual(
    result.robots.map((robot) => robot.name),
    ['writer', 'painter'],
  )
  assert.deepEqual(result.robots[0].skills, [{ name: 'foo' }, { name: 'bar' }])
  assert.deepEqual(result.robots[1].skills, [])
  assert.equal(result.robots[1].description, '')
})

test('createRobotsListTool：isSkillsVisible 为 false 时输出与渲染都不含技能清单', async () => {
  /** @type {Array<{ id?: string } | null | undefined>} */
  const seen = []
  const tool = makeTool({
    isSkillsVisible: (agent) => {
      seen.push(agent)
      return false
    },
  })
  const result = await tool.execute({}, { agent: { id: 'orchestrator' } })

  assert.deepEqual(seen, [{ id: 'orchestrator' }])
  for (const robot of result.robots) {
    assert.equal(Object.hasOwn(robot, 'skills'), false)
    assert.equal(typeof robot.name, 'string')
  }

  const rendered = tool.output.render({}, result)[0].text
  assert.equal(rendered.includes('skill'), false)
  assert.match(rendered, /^- writer — 写代码 \(\/robots\/writer\)/u)
  assert.match(rendered, /AGENTS\.md · mounted as ws-1$/mu)
  assert.match(rendered, /^- painter — \(no description\)/mu)
})

test('createRobotsListTool：可见时渲染技能数量，0 个也显示', async () => {
  const tool = makeTool({ isSkillsVisible: () => true })
  const result = await tool.execute({}, { agent: { id: 'standard' } })
  const rendered = tool.output.render({}, result)[0].text
  assert.match(
    rendered,
    /^- writer — 写代码 \(\/robots\/writer\) · 2 skills · AGENTS\.md · mounted as ws-1$/mu,
  )
  assert.match(
    rendered,
    /^- painter — \(no description\) \(\/robots\/painter\) · 0 skills · no AGENTS\.md · not mounted$/mu,
  )
})

test('createRobotsListTool：登记表损坏与空列表有独立文案', async () => {
  const broken = makeTool({ snapshot: { ...SNAPSHOT, corrupt: true, robots: [] } })
  const brokenText = broken.output.render(
    {},
    { corrupt: true, registry: '/robots.json', robots: [] },
  )[0].text
  assert.match(brokenText, /registry is unreadable: \/robots\.json/u)

  const empty = makeTool({ snapshot: { ...SNAPSHOT, robots: [] } })
  const emptyResult = await empty.execute({}, {})
  assert.deepEqual(emptyResult.robots, [])
  assert.equal(empty.output.render({}, emptyResult)[0].text, 'No robots have been created yet.')
})
