/**
 * 「安装到打工人 / 工作区」目标解析的单测。
 *
 * 守卫几件容易回归的事：
 * - 目标列表只来自 Host 服务：打工人的机器人、缺目录的条目会被过滤；
 * - 安装时按名字 / 路径回登记表重新解析，浏览器传的路径不会直接当工作目录；
 * - 服务缺失、登记表读不了、目录消失都有稳定错误码，页面能给出说明。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

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

test('目标列表：过滤机器人与缺路径的打工人，工作区标题缺省回退目录名', async () => {
  const { root, dir } = await makeDir('repo')
  try {
    const ctx = fakeContext({
      bukaWorkers: {
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

test('解析打工人：按名字回登记表，机器人与空名字都有错误码', async () => {
  const { root, dir } = await makeDir('worker')
  try {
    const ctx = fakeContext({
      bukaWorkers: {
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
      bukaWorkers: {
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
      bukaWorkers: {
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
