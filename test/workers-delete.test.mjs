/**
 * Workers 插件：删除执行者（硬删）与删除影响面的路由级单测。
 *
 * 直接调用 `registerWorkerRoutes` 注册的路由 handler，用临时目录 + 假的工作区
 * 注册表 / 假 `bukaWorkflows` 服务；不启动 DSH、不联网。覆盖：
 *
 * - 影响面形状（阻塞作业 / 工作流 / 历史作业 / 目录 / 挂载）；
 * - 有 running 作业时 409 `worker-in-use` 且响应列出作业，作业结束后可删；
 * - 删除成功后登记条目、目录、工作区注册行都清掉；
 * - 工作区删除失败 / 登记写失败时目录回滚、登记条目保持；
 * - 已挂载但工作区服务不可用时拒绝；
 * - 目录不在执行者根目录下时拒绝。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerWorkerRoutes } from '../plugins/workflows/src/workers/routes/workers.ts'
import {
  addWorker,
  readWorkerRegistry,
  writeWorkerRegistry,
} from '../plugins/workflows/src/workers/worker-store.ts'

/** 一个可操纵的假 `bukaWorkflows` 服务。 */
function makeWorkflowUsage() {
  return {
    runningJobs: [],
    workflows: [],
    finishedJobs: 0,
    async workerUsage() {
      return {
        runningJobs: this.runningJobs,
        workflows: this.workflows,
        finishedJobs: this.finishedJobs,
      }
    },
  }
}

/**
 * 建临时目录与路由 harness。
 *
 * @param {{ workspaceRegistry?: object | null }} [options]
 */
async function makeHarness({
  workspaceRegistry = 'default',
  workflowUsage: withWorkflows = true,
} = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-delete-'))
  const workersDir = path.join(root, 'workers')
  await fs.mkdir(workersDir, { recursive: true })
  const registryFile = path.join(root, 'workers.json')

  /** @type {Array<{ id: string, path: string }>} */
  const workspaces = []
  let nextWorkspaceId = 0
  const defaultRegistry = {
    list: () => workspaces,
    create: async (directory, title) => {
      const canonical = await fs.realpath(directory)
      nextWorkspaceId += 1
      const workspace = { id: `workspace-${nextWorkspaceId}`, path: canonical, title }
      workspaces.unshift(workspace)
      return workspace
    },
    delete: (id) => {
      const index = workspaces.findIndex((workspace) => workspace.id === id)
      if (index < 0) return false
      workspaces.splice(index, 1)
      return true
    },
  }

  const routes = new Map()
  const logger = { info() {}, warn() {}, debug() {} }
  const webCtx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    connection: { requestRejection: () => undefined },
    logger,
    effect(fn) {
      fn()
    },
  }
  const workflowUsage = makeWorkflowUsage()
  const ctx = {
    workspaceRegistry:
      workspaceRegistry === 'default' ? defaultRegistry : (workspaceRegistry ?? undefined),
    logger,
    get(name) {
      return name === 'bukaWorkflows' && withWorkflows ? workflowUsage : undefined
    },
  }
  registerWorkerRoutes(ctx, webCtx, {
    workersDir,
    registryFile,
    serializeRegistry: (work) => work(),
  })

  return {
    root,
    workersDir,
    registryFile,
    routes,
    workspaces,
    workflowUsage,
    workspaceRegistry: defaultRegistry,
    async cleanup() {
      await fs.chmod(root, 0o755).catch(() => undefined)
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}

/** 直接调用路由 handler。 */
async function callRoute(routes, routePath, body) {
  const route = routes.get(routePath)
  assert.ok(route, `${routePath} 应已注册`)
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method: 'POST',
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

/** 新建一个执行者并把它挂到假工作区。 */
async function addMountedWorker(harness, id, name = '') {
  const created = await addWorker({
    workersDir: harness.workersDir,
    file: harness.registryFile,
    id,
    name,
  })
  const canonical = await fs.realpath(created.worker.path)
  harness.workspaces.unshift({ id: `workspace-${id}`, path: canonical })
  return created.worker
}

/** 目录是否存在。 */
async function exists(target) {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

/** 回收目录（`<id>.deleted-*`）列表。 */
async function recycledDirs(workersDir) {
  const entries = await fs.readdir(workersDir)
  return entries.filter((entry) => entry.includes('.deleted-'))
}

test('删除影响面：返回路径 / 挂载 / 阻塞作业 / 工作流 / 历史作业数', async () => {
  const harness = await makeHarness()
  try {
    const worker = await addMountedWorker(harness, 'writer', '写作助手')
    harness.workflowUsage.runningJobs = [
      {
        jobId: 'job-1',
        jobSeq: 3,
        workflowId: 'wf-1',
        workflowName: '写作流程',
        jobName: '写作流程',
      },
    ]
    harness.workflowUsage.workflows = [
      { workflowId: 'wf-1', name: '写作流程', status: 'active' },
      { workflowId: 'wf-2', name: '旧流程', status: 'retired' },
    ]
    harness.workflowUsage.finishedJobs = 4

    const result = await callRoute(harness.routes, '/buka-workers/remove-impact', {
      id: 'writer',
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.id, 'writer')
    assert.equal(result.body.name, '写作助手')
    assert.equal(result.body.path, worker.path)
    assert.equal(result.body.mounted, true)
    assert.equal(result.body.workspaceId, 'workspace-writer')
    assert.deepEqual(result.body.blockers.runningJobs, harness.workflowUsage.runningJobs)
    assert.deepEqual(result.body.workflows, harness.workflowUsage.workflows)
    assert.equal(result.body.finishedJobs, 4)
  } finally {
    await harness.cleanup()
  }
})

test('删除：running 作业阻塞（响应列出作业），作业终止后可删且三处都清掉', async () => {
  const harness = await makeHarness()
  try {
    const worker = await addMountedWorker(harness, 'writer')
    harness.workflowUsage.runningJobs = [
      {
        jobId: 'job-1',
        jobSeq: 3,
        workflowId: 'wf-1',
        workflowName: '写作流程',
        jobName: '写作流程',
      },
    ]
    harness.workflowUsage.workflows = [{ workflowId: 'wf-1', name: '写作流程', status: 'active' }]
    harness.workflowUsage.finishedJobs = 2

    const blocked = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.body.code, 'worker-in-use')
    assert.equal(blocked.body.jobs.length, 1)
    assert.equal(blocked.body.jobs[0].jobId, 'job-1')
    // 被阻塞时什么都不动。
    assert.equal(await exists(worker.path), true)
    assert.equal((await readWorkerRegistry({ file: harness.registryFile })).workers.length, 1)
    assert.equal(harness.workspaces.length, 1)

    // 终止作业后：工作流引用与历史作业不阻塞。
    harness.workflowUsage.runningJobs = []
    const removed = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
    assert.equal(removed.status, 200)
    assert.equal(removed.body.ok, true)
    assert.equal(removed.body.removed, true)
    assert.equal(removed.body.directoryRemoved, true)
    assert.equal(removed.body.workspaceId, 'workspace-writer')
    assert.deepEqual(removed.body.workflows, harness.workflowUsage.workflows)
    assert.equal(removed.body.finishedJobs, 2)

    // 登记条目、目录、工作区注册行都清掉。
    assert.equal((await readWorkerRegistry({ file: harness.registryFile })).workers.length, 0)
    assert.equal(await exists(worker.path), false)
    assert.equal(harness.workspaces.length, 0)
    assert.deepEqual(await recycledDirs(harness.workersDir), [])
  } finally {
    await harness.cleanup()
  }
})

test('删除：没有 Workflows 插件时视为没有作业引用，照常删除', async () => {
  const harness = await makeHarness({ workflowUsage: false })
  try {
    const worker = await addMountedWorker(harness, 'writer')
    const impact = await callRoute(harness.routes, '/buka-workers/remove-impact', {
      id: 'writer',
    })
    assert.equal(impact.status, 200)
    assert.deepEqual(impact.body.blockers.runningJobs, [])
    assert.deepEqual(impact.body.workflows, [])
    assert.equal(impact.body.finishedJobs, 0)

    const removed = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
    assert.equal(removed.status, 200)
    assert.equal(await exists(worker.path), false)
    assert.equal((await readWorkerRegistry({ file: harness.registryFile })).workers.length, 0)
    assert.equal(harness.workspaces.length, 0)
  } finally {
    await harness.cleanup()
  }
})

test('删除回滚：工作区注册行删不掉时目录回到原位、登记条目仍在', async () => {
  const harness = await makeHarness()
  try {
    const worker = await addMountedWorker(harness, 'writer')
    harness.workspaceRegistry.delete = () => {
      throw new Error('workspace delete failed')
    }

    const result = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
    assert.equal(result.status, 500)
    assert.equal(result.body.code, 'remove-failed')
    assert.equal(await exists(worker.path), true, '目录回到原位')
    assert.equal((await readWorkerRegistry({ file: harness.registryFile })).workers.length, 1)
    assert.equal(harness.workspaces.length, 1, '工作区注册行保持')
    assert.deepEqual(await recycledDirs(harness.workersDir), [])
  } finally {
    await harness.cleanup()
  }
})

test('删除回滚：登记表写入失败时目录回到原位、登记条目仍在', {
  skip: typeof process.getuid === 'function' && process.getuid() === 0,
}, async () => {
  const harness = await makeHarness()
  try {
    const worker = await addMountedWorker(harness, 'writer')
    // 让登记文件所在的父目录不可写：原子写失败，事务必须回滚。
    await fs.chmod(harness.root, 0o555)
    const result = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
    await fs.chmod(harness.root, 0o755)
    assert.equal(result.status, 500)
    assert.equal(result.body.code, 'remove-failed')
    assert.equal(await exists(worker.path), true, '目录回到原位')
    const registry = await readWorkerRegistry({ file: harness.registryFile })
    assert.equal(registry.corrupt, undefined)
    assert.equal(registry.workers.length, 1, '登记条目仍在')
    assert.deepEqual(await recycledDirs(harness.workersDir), [])
  } finally {
    await harness.cleanup()
  }
})

test('删除：已挂载但工作区服务不可用时拒绝，目录与登记保持原样', async () => {
  const harness = await makeHarness({ workspaceRegistry: null })
  try {
    const worker = await addMountedWorker(harness, 'writer')
    const result = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
    assert.equal(result.status, 409)
    assert.equal(result.body.code, 'workspace-unavailable')
    assert.equal(await exists(worker.path), true)
    assert.equal((await readWorkerRegistry({ file: harness.registryFile })).workers.length, 1)
  } finally {
    await harness.cleanup()
  }
})

test('删除：目录不在执行者根目录下时拒绝', async () => {
  const harness = await makeHarness()
  try {
    const outside = await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-outside-'))
    try {
      await writeWorkerRegistry({
        file: harness.registryFile,
        workers: [
          {
            id: 'writer',
            name: '',
            driver: 'agent',
            path: outside,
            program: '',
            createdAt: new Date().toISOString(),
            avatar: 'panda',
            description: '',
          },
        ],
      })
      const result = await callRoute(harness.routes, '/buka-workers/remove', { id: 'writer' })
      assert.equal(result.status, 409)
      assert.equal(result.body.code, 'outside-root')
      assert.equal(await exists(outside), true, '根目录外的目录没有被删')
      assert.equal((await readWorkerRegistry({ file: harness.registryFile })).workers.length, 1)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  } finally {
    await harness.cleanup()
  }
})
