/**
 * `/workflow/workers/skills/*` 路由的「只读技能仓库」约束回归。
 *
 * 页面不能再用任意第三方来源列出 / 安装 skill：来源必须出现在 Skills 插件的
 * 收藏列表里。这里用假的 `ctx.skillCatalog` 与临时执行者目录跑真实的路由处理
 * 函数，不启动 webServer，也不执行 npx。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { registerSkillRoutes } from '../plugins/workflows/src/workers/routes/skills.ts'
import { writeWorkerRegistry } from '../plugins/workflows/src/workers/store/registry.ts'

const REPOS_ROUTE = '/workflow/workers/skills/repos'
const AVAILABLE_ROUTE = '/workflow/workers/skills/available'
const INSTALL_ROUTE = '/workflow/workers/skills/install'

/** 一条假的收藏仓库。 */
const SAVED_REPO = {
  id: 'repo-1',
  source: 'owner/repo',
  note: '团队技能',
  kind: 'npx-skills',
  skills: 2,
}

/**
 * 造一个执行者目录 + 登记表，并注册技能路由。
 *
 * @param {Record<string, any>} [options]
 * @returns {Promise<{ handlers: Map<string, Function>, calls: any[], root: string }>}
 */
async function makeHarness({
  repositories = [SAVED_REPO],
  corrupt = false,
  skills = [
    { name: 'alpha', description: 'first' },
    { name: 'beta', description: 'second' },
  ],
} = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skill-routes-'))
  const workersDir = path.join(root, 'workers')
  const workerDir = path.join(workersDir, 'writer')
  await fs.mkdir(path.join(workerDir, '.agents', 'skills', 'installed-skill'), { recursive: true })
  await fs.writeFile(
    path.join(workerDir, '.agents', 'skills', 'installed-skill', 'SKILL.md'),
    '---\nname: installed-skill\ndescription: already here\n---\n',
  )
  const registryFile = path.join(root, 'workers.json')
  await writeWorkerRegistry({
    file: registryFile,
    workers: [
      {
        id: 'writer',
        name: 'Writer',
        driver: 'agent',
        path: workerDir,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })

  const calls = []
  const service = {
    listRepositories: async () => {
      calls.push('listRepositories')
      return { corrupt, repositories }
    },
    listSkills: async ({ source }) => {
      calls.push(`listSkills:${source}`)
      return { ok: true, source, skills }
    },
    updateSkills: async () => ({}),
    checkSkills: async () => ({}),
    runSerialized: async (work) => work(),
  }
  const handlers = new Map()
  const webCtx = {
    effect(fn) {
      fn()
    },
    webServer: {
      register({ path: route, handler }) {
        handlers.set(route, handler)
        return () => {}
      },
    },
    get(name) {
      return name === 'skillCatalog' ? service : undefined
    },
    connection: { requestRejection: () => undefined },
    logger: { info() {}, warn() {} },
  }
  registerSkillRoutes(webCtx, { workersDir, registryFile })
  return { handlers, calls, root }
}

/**
 * 发一次请求；返回解析后的 JSON 与状态码。
 *
 * @param {Function} handler 路由处理函数
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
async function dispatch(handler, { method = 'POST', body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  const chunks = []
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
    },
  }
  await handler(req, res)
  const text = Buffer.concat(chunks).toString('utf8')
  return { status: res.statusCode, body: text === '' ? null : JSON.parse(text) }
}

/**
 * 删掉临时根目录。
 *
 * @param {string} root
 */
async function removeRoot(root) {
  await fs.rm(root, { recursive: true, force: true })
}

test('技能仓库路由：列出收藏来源与探测结果', async () => {
  const { handlers, root } = await makeHarness()
  try {
    const { status, body } = await dispatch(handlers.get(REPOS_ROUTE), { method: 'GET' })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.corrupt, false)
    assert.deepEqual(body.repositories, [SAVED_REPO])
  } finally {
    await removeRoot(root)
  }
})

test('技能仓库路由：候选清单只来自已收藏来源', async () => {
  const { handlers, calls, root } = await makeHarness()
  try {
    const { status, body } = await dispatch(handlers.get(AVAILABLE_ROUTE), {
      body: { id: 'writer', source: 'owner/repo' },
    })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(
      body.skills.map((skill) => skill.name),
      ['alpha', 'beta'],
    )
    assert.ok(body.installed.includes('installed-skill'), '执行者现有 skill 仍然标为已安装')
    assert.ok(calls.includes('listSkills:owner/repo'))

    const rejected = await dispatch(handlers.get(AVAILABLE_ROUTE), {
      body: { id: 'writer', source: 'third-party/repo' },
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.code, 'not-saved')
    assert.ok(!calls.includes('listSkills:third-party/repo'), '未收藏来源不会去读仓库内容')
  } finally {
    await removeRoot(root)
  }
})

test('技能仓库路由：收藏文件损坏时不放行任何来源', async () => {
  const { handlers, root } = await makeHarness({ corrupt: true })
  try {
    const { status, body } = await dispatch(handlers.get(AVAILABLE_ROUTE), {
      body: { id: 'writer', source: 'owner/repo' },
    })
    assert.equal(status, 409)
    assert.equal(body.code, 'repos-unreadable')
  } finally {
    await removeRoot(root)
  }
})

test('技能仓库路由：安装只接受收藏来源与仓库里真实存在的 skill', async () => {
  const { handlers, root } = await makeHarness()
  try {
    const unsaved = await dispatch(handlers.get(INSTALL_ROUTE), {
      body: { id: 'writer', source: 'third-party/repo', skills: ['alpha'] },
    })
    assert.equal(unsaved.status, 400)
    assert.equal(unsaved.body.code, 'not-saved')

    const missing = await dispatch(handlers.get(INSTALL_ROUTE), {
      body: { id: 'writer', source: 'owner/repo', skills: ['gamma'] },
    })
    assert.equal(missing.status, 400)
    assert.equal(missing.body.code, 'skill-not-found')
  } finally {
    await removeRoot(root)
  }
})
