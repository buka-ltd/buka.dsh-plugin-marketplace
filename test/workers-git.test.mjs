/**
 * 执行者目录默认初始化成 git 仓库的单测。
 *
 * 覆盖：首次建仓、已有仓库 / 外层仓库不重建、目录不存在与失败降级、
 * `addWorker` 创建时建仓（不自动提交），以及 `listWorkers` 为旧执行者补齐。
 * 全部用临时目录，不联网；需要真实 git 的用例在没装 git 的机器上跳过。
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ensureWorkerGitRepo } from '../plugins/workflows/src/workers/store/git.ts'
import {
  addWorker,
  listWorkers,
  writeWorkerRegistry,
} from '../plugins/workflows/src/workers/worker-store.ts'

/** 本机是否装了 git；真实建仓的用例只在有 git 时跑。 */
const GIT_AVAILABLE = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0

/**
 * 建一个临时根目录。
 *
 * @returns {Promise<string>}
 */
async function makeRoot() {
  return await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-git-'))
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
 * 路径存在且是目录。
 *
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

test('ensureWorkerGitRepo：首次建仓，随后识别已有仓库', { skip: !GIT_AVAILABLE }, async () => {
  const root = await makeRoot()
  try {
    const dir = path.join(root, 'writer')
    await fs.mkdir(dir)

    assert.deepEqual(await ensureWorkerGitRepo(dir), { ok: true, status: 'created', path: dir })
    assert.equal(await isDirectory(path.join(dir, '.git')), true)

    // 第二次不再跑 git：已有的 `.git` 直接复用。
    let calls = 0
    const second = await ensureWorkerGitRepo(dir, {
      runGit: async () => {
        calls += 1
        return { stdout: '', stderr: '' }
      },
    })
    assert.deepEqual(second, { ok: true, status: 'exists', path: dir })
    assert.equal(calls, 0)

    // 初始化不提交：HEAD 还不存在，首个提交由用户自己决定。
    const head = spawnSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], {
      stdio: 'ignore',
    })
    assert.notEqual(head.status, 0)
  } finally {
    await removeRoot(root)
  }
})

test('ensureWorkerGitRepo：git init 的参数与工作目录', async () => {
  const root = await makeRoot()
  try {
    const dir = path.join(root, 'writer')
    await fs.mkdir(dir)

    /** @type {Array<{ args: string[], options: { cwd?: string } | undefined }>} */
    const calls = []
    const result = await ensureWorkerGitRepo(dir, {
      runGit: async (args, options) => {
        calls.push({ args, options })
        // 模拟 git init 的产物，让后续检查能识别成仓库。
        await fs.mkdir(path.join(dir, '.git'))
        return { stdout: '', stderr: '' }
      },
    })
    assert.deepEqual(result, { ok: true, status: 'created', path: dir })
    assert.deepEqual(calls, [{ args: ['init', '--quiet'], options: { cwd: dir } }])
  } finally {
    await removeRoot(root)
  }
})

test('ensureWorkerGitRepo：已有 .git 文件与在外层仓库里都不重建', async () => {
  const root = await makeRoot()
  try {
    let calls = 0
    const fakeRunner = async () => {
      calls += 1
      return { stdout: '', stderr: '' }
    }

    // worktree / submodule 的 `.git` 是文件，同样算已有仓库。
    const worktree = path.join(root, 'worktree')
    await fs.mkdir(worktree)
    await fs.writeFile(path.join(worktree, '.git'), 'gitdir: ../repo/.git/worktrees/demo\n')
    assert.deepEqual(await ensureWorkerGitRepo(worktree, { runGit: fakeRunner }), {
      ok: true,
      status: 'exists',
      path: worktree,
    })

    // 祖先目录有 `.git`：不建嵌套仓库，文件交给外层仓库管理。
    const outer = path.join(root, 'outer')
    const inner = path.join(outer, 'workers', 'writer')
    await fs.mkdir(path.join(outer, '.git'), { recursive: true })
    await fs.mkdir(inner, { recursive: true })
    assert.deepEqual(await ensureWorkerGitRepo(inner, { runGit: fakeRunner }), {
      ok: true,
      status: 'nested',
      path: inner,
    })
    assert.equal(await isDirectory(path.join(inner, '.git')), false)
    assert.equal(calls, 0)
  } finally {
    await removeRoot(root)
  }
})

test('ensureWorkerGitRepo：目录不存在、没装 git、git 失败都降级成结果', async () => {
  const root = await makeRoot()
  try {
    const missing = await ensureWorkerGitRepo(path.join(root, 'missing'))
    assert.equal(missing.ok, false)
    assert.equal(missing.status, 'missing')

    const dir = path.join(root, 'writer')
    await fs.mkdir(dir)

    const unavailable = await ensureWorkerGitRepo(dir, {
      runGit: async () => {
        throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      },
    })
    assert.equal(unavailable.ok, false)
    assert.equal(unavailable.status, 'unavailable')
    assert.match(unavailable.error, /git/u)

    const failed = await ensureWorkerGitRepo(dir, {
      runGit: async () => {
        throw Object.assign(new Error('exit 128'), { stderr: 'fatal: cannot init\n第二行\n' })
      },
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.status, 'failed')
    assert.match(failed.error, /cannot init/u)

    // 空路径：不碰文件系统。
    const empty = await ensureWorkerGitRepo('  ')
    assert.equal(empty.status, 'missing')
  } finally {
    await removeRoot(root)
  }
})

test('addWorker 创建执行者时默认初始化 git 仓库', { skip: !GIT_AVAILABLE }, async () => {
  const root = await makeRoot()
  try {
    const workersDir = path.join(root, 'workers')
    const file = path.join(root, 'workers.json')
    const { worker } = await addWorker({ workersDir, file, id: 'writer', name: '写作助手' })

    assert.equal(await isDirectory(path.join(worker.path, '.git')), true)
    // 目录里的 AGENTS.md 已经就位，但还没有提交。
    assert.equal(
      await fs
        .readFile(path.join(worker.path, 'AGENTS.md'), 'utf8')
        .then((text) => text.includes('写作助手')),
      true,
    )
    const head = spawnSync('git', ['-C', worker.path, 'rev-parse', '--verify', 'HEAD'], {
      stdio: 'ignore',
    })
    assert.notEqual(head.status, 0)
  } finally {
    await removeRoot(root)
  }
})

test('listWorkers 为已有执行者补齐 git 仓库', { skip: !GIT_AVAILABLE }, async () => {
  const root = await makeRoot()
  try {
    const workersDir = path.join(root, 'workers')
    const file = path.join(root, 'workers.json')
    const workerDir = path.join(workersDir, 'writer')
    await fs.mkdir(workerDir, { recursive: true })
    await fs.writeFile(path.join(workerDir, 'AGENTS.md'), '# 旧执行者\n', 'utf8')
    await writeWorkerRegistry({
      file,
      workers: [
        {
          id: 'writer',
          name: '',
          driver: 'agent',
          path: workerDir,
          createdAt: '2026-01-01T00:00:00.000Z',
          avatar: 'panda',
          description: '',
        },
      ],
    })
    assert.equal(await isDirectory(path.join(workerDir, '.git')), false)

    const listed = await listWorkers({ file, workersDir })
    assert.equal(listed.corrupt, false)
    const writer = listed.workers.find((entry) => entry.id === 'writer')
    assert.equal(writer?.driver, 'agent')
    assert.equal(await isDirectory(path.join(workerDir, '.git')), true)
  } finally {
    await removeRoot(root)
  }
})
