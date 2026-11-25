/**
 * 「安装到执行者 / 工作区」目标解析的单测。
 *
 * 守卫几件容易回归的事：
 * - 目标列表只来自 Host 服务：执行者的机器人、缺目录的条目会被过滤；
 * - 执行者按不可变标识符做键，展示名可以为空；旧版只有 `name` 时退回 `name`；
 * - 安装时按标识符 / 路径回登记表重新解析，浏览器传的路径不会直接当工作目录；
 * - 服务缺失、登记表读不了、目录消失都有稳定错误码，页面能给出说明。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { targetKeyOf, targetLabelOf } from '../plugins/skills/src/client/keys.ts'
import { listInstallTargets, resolveInstallTarget } from '../plugins/skills/src/install-targets.ts'

/**
 * 拼一个只提供这两个可选服务的最小 Context。
 *
 * @param services 服务实现；缺省表示服务不存在
 */
function fakeContext(services) {
  return {
    get(name) {
      return services[name]
    },
  }
}

/** 造一个临时目录。 */
async function makeDir(name) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-targets-'))
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  return { root, dir }
}

test('目标列表：过滤机器人与缺路径的执行者，工作区标题缺省回退目录名', async () => {
  const { root, dir } = await makeDir('repo')
  try {
    const ctx = fakeContext({
      workflowWorkers: {
        async list() {
          return {
            workers: [
              { name: '质量保障', driver: 'agent', path: dir, exists: true, description: 'QA' },
              { name: 'clock', driver: 'robot', path: '', exists: false },
              { name: '没有目录', driver: 'agent', path: '', exists: false },
              { name: '质量保障', driver: 'agent', path: '/duplicate', exists: true },
            ],
          }
        },
      },
      workspaceRegistry: {
        list() {
          return [
            { id: 'w1', title: '示例仓库', path: dir },
            { id: 'w2', title: '', path: path.join(root, 'second') },
            { id: 'w3', title: '缺路径', path: '' },
          ]
        },
      },
    })

    const targets = await listInstallTargets(ctx)
    assert.deepEqual(
      targets.workers.items.map((worker) => ({ name: worker.name, path: worker.path })),
      [{ name: '质量保障', path: dir }],
      '机器人、缺路径与重复名字都应被过滤',
    )
    assert.equal(targets.workers.available, true)
    assert.equal(targets.workers.error, null)
    assert.deepEqual(
      targets.workspaces.items.map((workspace) => ({
        title: workspace.title,
        path: workspace.path,
      })),
      [
        { title: 'second', path: path.join(root, 'second') },
        { title: '示例仓库', path: dir },
      ],
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('解析执行者：按名字回登记表，机器人与空名字都有错误码', async () => {
  const { root, dir } = await makeDir('worker')
  try {
    const ctx = fakeContext({
      workflowWorkers: {
        async list() {
          return {
            workers: [
              { name: '软件工程师', driver: 'agent', path: dir, exists: true },
              { name: 'clock', driver: 'robot', path: '', exists: false },
            ],
          }
        },
      },
    })

    const resolved = await resolveInstallTarget(ctx, { target: 'worker', worker: '软件工程师' })
    assert.deepEqual(resolved, { ok: true, path: dir, label: '软件工程师' })

    const program = await resolveInstallTarget(ctx, { target: 'worker', worker: 'clock' })
    assert.equal(program.code, 'unknown-worker')

    const empty = await resolveInstallTarget(ctx, { target: 'worker', worker: '' })
    assert.equal(empty.code, 'invalid-target')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('解析工作区：接受路径或 id，未知与空值都有错误码', async () => {
  const { root, dir } = await makeDir('workspace')
  try {
    const ctx = fakeContext({
      workspaceRegistry: {
        list() {
          return [{ id: 'workspace-1', title: '示例仓库', path: dir }]
        },
      },
    })

    const byPath = await resolveInstallTarget(ctx, { target: 'workspace', workspace: dir })
    assert.deepEqual(byPath, { ok: true, path: dir, label: '示例仓库' })

    const byId = await resolveInstallTarget(ctx, {
      target: 'workspace',
      workspace: 'workspace-1',
    })
    assert.deepEqual(byId, { ok: true, path: dir, label: '示例仓库' })

    const unknown = await resolveInstallTarget(ctx, { target: 'workspace', workspace: '/nope' })
    assert.equal(unknown.code, 'unknown-workspace')

    const empty = await resolveInstallTarget(ctx, { target: 'workspace', workspace: '' })
    assert.equal(empty.code, 'invalid-target')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('服务缺失 / 读取失败 / 目录消失时返回稳定错误码', async () => {
  const gone = path.join(tmpdir(), 'buka-skills-targets-gone')

  const noWorkers = await resolveInstallTarget(fakeContext({}), {
    target: 'worker',
    worker: 'bot',
  })
  assert.equal(noWorkers.code, 'workers-unavailable')

  const noWorkspaces = await resolveInstallTarget(fakeContext({}), {
    target: 'workspace',
    workspace: '/x',
  })
  assert.equal(noWorkspaces.code, 'workspaces-unavailable')

  const broken = await resolveInstallTarget(
    fakeContext({
      workflowWorkers: {
        async list() {
          throw new Error('registry is corrupt')
        },
      },
    }),
    { target: 'worker', worker: 'bot' },
  )
  assert.equal(broken.code, 'workers-unavailable')
  assert.equal(broken.message, 'registry is corrupt')

  const missing = await resolveInstallTarget(
    fakeContext({
      workflowWorkers: {
        async list() {
          return { workers: [{ name: 'bot', driver: 'agent', path: gone, exists: true }] }
        },
      },
    }),
    { target: 'worker', worker: 'bot' },
  )
  assert.equal(missing.code, 'missing-target')

  const targets = await listInstallTargets(fakeContext({}))
  assert.deepEqual(
    { workers: targets.workers.available, workspaces: targets.workspaces.available },
    { workers: false, workspaces: false },
  )
})

test('目标列表：以标识符为键，展示名为空也保留，旧版只有 name 时退回 name', async () => {
  const { root, dir } = await makeDir('repo')
  try {
    const ctx = fakeContext({
      workflowWorkers: {
        async list() {
          return {
            workers: [
              { id: 'qa', name: '', driver: 'agent', path: dir, exists: true, description: 'QA' },
              { id: 'writer', name: '写作助手', driver: 'agent', path: dir, exists: true },
              // 旧版 workers 只返回 name，没有 id。
              { name: 'legacy', driver: 'agent', path: dir, exists: true },
              {
                id: 'qa',
                name: '重复标识符',
                driver: 'agent',
                path: path.join(root, 'duplicate'),
                exists: true,
              },
              { id: 'clock', name: 'clock', driver: 'robot', path: '', exists: false },
              { id: 'no-path', name: '没有目录', driver: 'agent', path: '', exists: true },
              { id: 'gone', name: '已删除', driver: 'agent', path: dir, exists: false },
            ],
          }
        },
      },
    })

    const targets = await listInstallTargets(ctx)
    assert.deepEqual(
      targets.workers.items,
      [
        { id: 'legacy', name: 'legacy', path: dir, description: '' },
        { id: 'qa', name: '', path: dir, description: 'QA' },
        { id: 'writer', name: '写作助手', path: dir, description: '' },
      ],
      '展示名为空不应丢弃执行者；机器人、缺路径、目录不存在与重复标识符仍被过滤，并按键排序',
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('解析执行者：按标识符匹配，名称只作展示，旧版退回 name', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-targets-'))
  const qaDir = path.join(root, 'qa')
  const writerDir = path.join(root, 'writer')
  const legacyDir = path.join(root, 'legacy')
  try {
    for (const dir of [qaDir, writerDir, legacyDir]) {
      await fs.mkdir(dir, { recursive: true })
    }
    const ctx = fakeContext({
      workflowWorkers: {
        async list() {
          return {
            workers: [
              { id: 'qa', name: '', driver: 'agent', path: qaDir, exists: true },
              { id: 'writer', name: '写作助手', driver: 'agent', path: writerDir, exists: true },
              { name: 'legacy', driver: 'agent', path: legacyDir, exists: true },
              { id: 'clock', name: 'clock', driver: 'robot', path: '', exists: false },
            ],
          }
        },
      },
    })

    assert.deepEqual(await resolveInstallTarget(ctx, { target: 'worker', worker: 'qa' }), {
      ok: true,
      path: qaDir,
      label: 'qa',
    })
    assert.deepEqual(await resolveInstallTarget(ctx, { target: 'worker', worker: 'writer' }), {
      ok: true,
      path: writerDir,
      label: '写作助手 · writer',
    })
    assert.deepEqual(await resolveInstallTarget(ctx, { target: 'worker', worker: 'legacy' }), {
      ok: true,
      path: legacyDir,
      label: 'legacy',
    })

    // 有标识符之后 name 不再能被当成引用键。
    const byName = await resolveInstallTarget(ctx, { target: 'worker', worker: '写作助手' })
    assert.equal(byName.code, 'unknown-worker')

    const unknown = await resolveInstallTarget(ctx, { target: 'worker', worker: 'nobody' })
    assert.equal(unknown.code, 'unknown-worker')

    const empty = await resolveInstallTarget(ctx, { target: 'worker', worker: '   ' })
    assert.equal(empty.code, 'invalid-target')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('弹窗标签：执行者用标识符作键，标签按「名称 · 标识符」消歧', () => {
  assert.equal(targetKeyOf('worker', { id: 'qa', name: '' }), 'qa')
  assert.equal(targetKeyOf('worker', { id: 'qa', name: '质量保障' }), 'qa')
  assert.equal(targetKeyOf('worker', { name: '软件工程师' }), '软件工程师')

  assert.equal(targetLabelOf('worker', { id: 'qa', name: '' }), 'qa')
  assert.equal(targetLabelOf('worker', { id: 'qa', name: '质量保障' }), '质量保障 · qa')
  assert.equal(targetLabelOf('worker', { id: 'qa', name: 'qa' }), 'qa')
  assert.equal(targetLabelOf('worker', { name: '软件工程师' }), '软件工程师')

  // 工作区目标的键与标签行为不变。
  assert.equal(targetKeyOf('workspace', { path: '/repo' }), '/repo')
  assert.equal(targetLabelOf('workspace', { title: '示例仓库', path: '/repo' }), '示例仓库')
  assert.equal(targetLabelOf('workspace', { title: '', path: '/repo' }), '/repo')
})
