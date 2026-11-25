/**
 * 执行者「文件」页签的只读文件接口单测。
 *
 * 覆盖目录树（跳过 `.git` / `node_modules`、目录内符号链接照常列出）、单文件
 * 读取（UTF-8、过大、二进制、目录）、路径逃逸（`..`、绝对路径、目录外软链）
 * 以及两个 HTTP 路由的状态码映射。全部使用临时目录，不启动 DSH、不联网。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerFileRoutes } from '../plugins/workflows/src/workers/routes/files.ts'
import {
  FILE_MAX_READ_BYTES,
  listWorkerFiles,
  readWorkerFile,
} from '../plugins/workflows/src/workers/store/files.ts'
import { writeWorkerRegistry } from '../plugins/workflows/src/workers/worker-store.ts'

/**
 * 建临时执行者目录。
 *
 * @returns {Promise<{ root: string, workerDir: string, registryFile: string, cleanup: () => Promise<void> }>}
 */
async function makeHarness() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-files-'))
  const workersDir = path.join(root, 'workers')
  const workerDir = path.join(workersDir, 'writer')
  const registryFile = path.join(root, 'workers.json')
  await fs.mkdir(workerDir, { recursive: true })
  await writeWorkerRegistry({
    file: registryFile,
    workers: [
      {
        id: 'writer',
        name: '',
        driver: 'agent',
        path: workerDir,
        createdAt: '2026-11-19T00:00:00.000Z',
        avatar: 'panda',
        description: '',
      },
    ],
  })
  return {
    root,
    workerDir,
    registryFile,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

/**
 * 写一个文件并建父目录。
 *
 * @param {string} file
 * @param {string | Buffer} content
 */
async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

test('文件树：列出文件与目录，跳过 .git / node_modules，目录内软链照常展示', async () => {
  const harness = await makeHarness()
  try {
    await writeFile(path.join(harness.workerDir, 'AGENTS.md'), '# AGENTS.md\n')
    await writeFile(path.join(harness.workerDir, 'notes.txt'), 'notes\n')
    await writeFile(
      path.join(harness.workerDir, '.agents', 'skills', 'demo', 'SKILL.md'),
      '# demo\n',
    )
    await writeFile(path.join(harness.workerDir, '.git', 'config'), 'ignored\n')
    await writeFile(path.join(harness.workerDir, 'node_modules', 'x', 'index.js'), 'ignored\n')
    await fs.symlink('AGENTS.md', path.join(harness.workerDir, 'CLAUDE.md'))

    const tree = await listWorkerFiles(harness.workerDir)
    assert.equal(tree.truncated, false)
    const names = tree.nodes.map((node) => node.name)
    assert.deepEqual(names, ['.agents', 'AGENTS.md', 'CLAUDE.md', 'notes.txt'])
    assert.equal(tree.nodes[0].kind, 'directory')
    const skill = tree.nodes[0].children?.[0]?.children?.[0]?.children?.[0]
    assert.equal(skill?.name, 'SKILL.md')
    assert.equal(tree.nodes[1].kind, 'file')
    assert.equal(tree.nodes[2].bytes, Buffer.byteLength('# AGENTS.md\n'))

    const read = await readWorkerFile(harness.workerDir, 'CLAUDE.md')
    assert.equal(read.ok, true)
    assert.equal(read.ok && read.file.content, '# AGENTS.md\n')
  } finally {
    await harness.cleanup()
  }
})

test('文件读取：目录 / 过大 / 二进制分别给出稳定结果', async () => {
  const harness = await makeHarness()
  try {
    await writeFile(
      path.join(harness.workerDir, 'large.txt'),
      Buffer.alloc(FILE_MAX_READ_BYTES + 1, 97),
    )
    await writeFile(path.join(harness.workerDir, 'blob.bin'), Buffer.from([0, 1, 2, 255]))
    await fs.mkdir(path.join(harness.workerDir, 'folder'), { recursive: true })

    const directory = await readWorkerFile(harness.workerDir, 'folder')
    assert.equal(directory.ok, false)
    assert.equal(!directory.ok && directory.error.code, 'not-a-file')

    const large = await readWorkerFile(harness.workerDir, 'large.txt')
    assert.equal(large.ok, true)
    assert.equal(large.ok && large.file.tooLarge, true)
    assert.equal(large.ok && large.file.content, '')

    const binary = await readWorkerFile(harness.workerDir, 'blob.bin')
    assert.equal(binary.ok, true)
    assert.equal(binary.ok && binary.file.binary, true)
    assert.equal(binary.ok && binary.file.content, '')
  } finally {
    await harness.cleanup()
  }
})

test('路径逃逸：.. / 绝对路径 / 目录外软链都拒绝', async () => {
  const harness = await makeHarness()
  try {
    const outside = path.join(harness.root, 'outside.txt')
    await writeFile(outside, 'secret\n')
    await fs.symlink(outside, path.join(harness.workerDir, 'escape.txt'))

    const parent = await readWorkerFile(harness.workerDir, '../outside.txt')
    assert.equal(parent.ok, false)
    assert.equal(!parent.ok && parent.error.code, 'invalid-path')

    const absolute = await readWorkerFile(harness.workerDir, outside)
    assert.equal(absolute.ok, false)
    assert.equal(!absolute.ok && absolute.error.code, 'invalid-path')

    const escaped = await readWorkerFile(harness.workerDir, 'escape.txt')
    assert.equal(escaped.ok, false)
    assert.equal(!escaped.ok && escaped.error.code, 'outside-root')

    const missing = await readWorkerFile(harness.workerDir, 'missing.txt')
    assert.equal(missing.ok, false)
    assert.equal(!missing.ok && missing.error.code, 'file-not-found')
  } finally {
    await harness.cleanup()
  }
})

/**
 * 发一个 GET 请求到注册好的路由。
 *
 * @param {Map<string, { handler: Function }>} routes
 * @param {string} url
 * @returns {Promise<{ status: number, body: Record<string, any> }>}
 */
async function request(routes, url, method = 'GET') {
  const route = routes.get(new URL(url, 'http://localhost').pathname)
  assert.ok(route, `route ${url} should be registered`)
  let body = ''
  const req = { method, url, headers: {} }
  const res = {
    statusCode: 200,
    setHeader() {},
    end(value) {
      body = value === undefined ? '' : String(value)
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: body === '' ? {} : JSON.parse(body) }
}

test('文件路由：目录树与文件内容可读，路径逃逸 / 未知执行者 / 方法错误各自映射', async () => {
  const harness = await makeHarness()
  try {
    await writeFile(path.join(harness.workerDir, 'AGENTS.md'), '# AGENTS.md\n')
    /** @type {Map<string, { handler: Function }>} */
    const routes = new Map()
    registerFileRoutes(
      {
        webServer: {
          register(route) {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
        connection: { requestRejection: () => undefined },
        logger: { warn() {} },
        effect: (fn) => fn(),
      },
      {
        workersDir: path.dirname(harness.workerDir),
        registryFile: harness.registryFile,
        serializeRegistry: (work) => work(),
      },
    )

    const tree = await request(routes, '/workflow/workers/files?id=writer')
    assert.equal(tree.status, 200)
    assert.equal(tree.body.ok, true)
    assert.deepEqual(
      tree.body.nodes.map((node) => node.name),
      ['AGENTS.md'],
    )

    const file = await request(routes, '/workflow/workers/file?id=writer&path=AGENTS.md')
    assert.equal(file.status, 200)
    assert.equal(file.body.content, '# AGENTS.md\n')

    const escaped = await request(routes, '/workflow/workers/file?id=writer&path=..%2Foutside.txt')
    assert.equal(escaped.status, 400)
    assert.equal(escaped.body.code, 'invalid-path')

    const unknown = await request(routes, '/workflow/workers/files?id=nobody')
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.code, 'unknown-worker')

    const method = await request(routes, '/workflow/workers/files?id=writer', 'POST')
    assert.equal(method.status, 405)
  } finally {
    await harness.cleanup()
  }
})
