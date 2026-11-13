/**
 * `buka_workers` 工具的单测：输出映射、按调用方隐藏技能清单、渲染文本。
 *
 * `defineTool` 与 `listWorkers` 都用假实现，不读磁盘、不启动 DSH。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkersListTool, WORKERS_LIST_TOOL_NAME } from '../plugins/workers/src/list-tool.ts'

/** 假快照：两个智能体 + 一个内建机器人。 */
const SNAPSHOT = {
  root: '/workers',
  registry: '/workers.json',
  corrupt: false,
  workers: [
    {
      name: 'writer',
      driver: 'agent',
      program: '',
      assistant: false,
      path: '/workers/writer',
      description: '写代码',
      mounted: true,
      workspaceId: 'ws-1',
      skills: [{ name: 'foo' }, { name: 'bar' }],
      agents: { exists: true },
    },
    {
      name: 'painter',
      driver: 'agent',
      program: '',
      assistant: false,
      path: '/workers/painter',
      description: '',
      mounted: false,
      workspaceId: null,
      skills: [],
      agents: { exists: false },
    },
    {
      name: 'clock',
      driver: 'robot',
      program: 'clock',
      assistant: false,
      path: '',
      description: '到点完成任务的定时打工人',
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
 * 建工具；`isSkillsVisible` 可控，`listWorkers` 记录调用参数。
 * @param {{
 *   isSkillsVisible?: ((agent: { id?: string } | null | undefined) => boolean) | null,
 *   snapshot?: typeof SNAPSHOT,
 *   calls?: Array<Record<string, unknown>>,
 * }} [options]
 * @returns {Record<string, any>}
 */
function makeTool({ isSkillsVisible, snapshot = SNAPSHOT, calls = [] } = {}) {
  const tool = createWorkersListTool({
    defineTool: fakeDefineTool,
    listWorkers: async (options) => {
      calls.push(options)
      return snapshot
    },
    registryFile: '/workers.json',
    workersDir: '/workers',
    workspaceRegistry: { mounted: true },
    isSkillsVisible,
  })
  return /** @type {Record<string, any>} */ (tool)
}

test('createWorkersListTool：工具名、输出 schema 与依赖校验', () => {
  const tool = makeTool()
  assert.equal(tool.name, WORKERS_LIST_TOOL_NAME)
  assert.equal(tool.name, 'buka_workers')

  const workerProps = tool.output.schema.properties.workers.items.properties
  // skills 是可选字段：编排 preset 拿到的输出里直接没有它。
  assert.equal(workerProps.skills.required, undefined)
  assert.equal(workerProps.name.required, true)
  assert.equal(workerProps.agentsFile.required, true)
  assert.equal(workerProps.driver.required, true)
  assert.deepEqual(workerProps.driver.enum, ['agent', 'robot'])
  assert.equal(workerProps.assistant.required, true)
  assert.equal(workerProps.program.required, true)

  assert.throws(() => createWorkersListTool(), /defineTool is required/)
  assert.throws(
    () => createWorkersListTool({ defineTool: fakeDefineTool }),
    /listWorkers is required/,
  )
})

test('createWorkersListTool：默认输出包含技能清单，并把调用参数传给 listWorkers', async () => {
  const calls = []
  const tool = makeTool({ calls })
  const result = await tool.execute({}, { agent: { id: 'whatever' } })

  assert.deepEqual(calls, [
    { file: '/workers.json', workspaceRegistry: { mounted: true }, workersDir: '/workers' },
  ])
  assert.deepEqual(
    result.workers.map((worker) => worker.name),
    ['writer', 'painter', 'clock'],
  )
  assert.deepEqual(result.workers[0].skills, [{ name: 'foo' }, { name: 'bar' }])
  assert.deepEqual(result.workers[1].skills, [])
  assert.equal(result.workers[1].description, '')
  // 输出带 driver / assistant / program：工作流按 driver 分派，机器人没有会话。
  assert.equal(result.workers[0].driver, 'agent')
  assert.equal(result.workers[0].assistant, false)
  assert.equal(result.workers[0].program, null)
  assert.equal(result.workers[2].driver, 'robot')
  assert.equal(result.workers[2].program, 'clock')
  assert.equal(result.workers[2].assistant, false)
})

test('createWorkersListTool：isSkillsVisible 为 false 时输出与渲染都不含技能清单', async () => {
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
  for (const worker of result.workers) {
    assert.equal(Object.hasOwn(worker, 'skills'), false)
    assert.equal(typeof worker.name, 'string')
  }

  const rendered = tool.output.render({}, result)[0].text
  assert.equal(rendered.includes('skill'), false)
  assert.match(rendered, /^- writer — 写代码 \(\/workers\/writer\)/u)
  assert.match(rendered, /AGENTS\.md · mounted as ws-1$/mu)
  assert.match(rendered, /^- painter — \(no description\)/mu)
})

test('createWorkersListTool：可见时渲染技能数量，0 个也显示', async () => {
  const tool = makeTool({ isSkillsVisible: () => true })
  const result = await tool.execute({}, { agent: { id: 'standard' } })
  const rendered = tool.output.render({}, result)[0].text
  assert.match(
    rendered,
    /^- writer — 写代码 \(\/workers\/writer\) · 2 skills · AGENTS\.md · mounted as ws-1$/mu,
  )
  assert.match(
    rendered,
    /^- painter — \(no description\) \(\/workers\/painter\) · 0 skills · no AGENTS\.md · not mounted$/mu,
  )
})

test('createWorkersListTool：登记表损坏与空列表有独立文案', async () => {
  const broken = makeTool({ snapshot: { ...SNAPSHOT, corrupt: true, workers: [] } })
  const brokenText = broken.output.render(
    {},
    { corrupt: true, registry: '/workers.json', workers: [] },
  )[0].text
  assert.match(brokenText, /registry is unreadable: \/workers\.json/u)

  const empty = makeTool({ snapshot: { ...SNAPSHOT, workers: [] } })
  const emptyResult = await empty.execute({}, {})
  assert.deepEqual(emptyResult.workers, [])
  assert.equal(empty.output.render({}, emptyResult)[0].text, 'No workers have been created yet.')
})
