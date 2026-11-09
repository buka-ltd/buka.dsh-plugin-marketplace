/**
 * 「本地绝对路径 / 任意 git 地址」两种来源的读取单测。
 *
 * 与 `repo-skills.test.mjs` 共享同一套断言口径：全部用临时 DSH home 与临时
 * fixture 目录，结束清理；git 子进程一律注入假 `runGit`，不联网、不调用本机
 * 真实 git，也不在测试里 clone 远端。重点覆盖：
 *
 * - local：npx skills / marketplace 两种布局、`file://` 收敛、不存在路径、
 *   空目录、`refresh` 重扫、遍历与读取上限、跳过目录；
 * - git：clone 参数与缓存目录、并发合并、`update` 的 fetch/reset、离线沿用旧
 *   克隆、`git-unavailable` / `git-failed`、端到端列树与缓存。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { ensureGitClone, gitCloneDir } from '../plugins/skills/lib/git-source.js'
import {
  LOCAL_FILE_MAX_BYTES,
  LOCAL_TREE_MAX_DEPTH,
  LOCAL_TREE_MAX_ENTRIES,
  openLocalRepo,
} from '../plugins/skills/lib/local-source.js'
import {
  REPO_SKILLS_CACHE_VERSION,
  fetchRepoSkills,
  probeRepoKind,
  repoSkillsCacheFile,
} from '../plugins/skills/lib/repo-skills.js'
import { repoKey } from '../plugins/skills/lib/repo-store.js'

/** 建一个临时 DSH home，并在测试结束后删除。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-local-git-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return {
    root,
    homes: { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') },
  }
}

/** 在 fixture 目录里按相对路径写文件，自动建父目录。 */
async function writeRel(root, relPath, content) {
  const abs = path.join(root, ...relPath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

/** 读回仓库 skills 缓存文件；不存在时返回 null。 */
async function readCacheFile(homes) {
  try {
    return JSON.parse(await fs.readFile(repoSkillsCacheFile(homes), 'utf8'))
  } catch {
    return null
  }
}

/** 任何请求都算失败：本地 / git 来源不该碰网络。 */
async function neverFetch(url) {
  throw new Error(`unexpected fetch: ${url}`)
}

/**
 * 假 git runner：clone 时把 fixture 复制到目标目录，其余命令记录后返回固定值。
 *
 * 每个用例自建实例，`calls` 用来断言参数；这样单测既不联网，也不依赖本机
 * 装没装 git。
 *
 * @param {{ fixture?: string, sha?: string }} [options]
 */
function createGit({ fixture, sha = 'git-sha' } = {}) {
  const calls = []
  const runGit = async (args, options = {}) => {
    calls.push({ args, options })
    if (args[0] === 'clone') {
      const separator = args.indexOf('--')
      const target = args[separator + 2]
      if (fixture !== undefined) await fs.cp(fixture, target, { recursive: true })
      else await fs.mkdir(target, { recursive: true })
      return { stdout: '', stderr: '' }
    }
    if (args.includes('rev-parse')) return { stdout: `${sha}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }
  return {
    runGit,
    calls,
    cloneCalls: () => calls.filter((one) => one.args[0] === 'clone'),
  }
}

test('local：扫描 npx skills 布局，probeRepoKind 与 fetchRepoSkills 都能列出', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'repo')
  await writeRel(fixture, 'README.md', '# demo\n')
  await writeRel(fixture, 'skills/find-skills/SKILL.md', '---\nname: find-skills\ndescription: Find it\n---\n')
  await writeRel(fixture, 'skills/core/batch/SKILL.md', '---\nname: batch\ndescription: Batch it\n---\n')
  // 这些目录按 SKIP_DIRS 跳过，里面的 SKILL.md 不能被收进来。
  await writeRel(fixture, 'node_modules/dep/SKILL.md', '---\nname: dep\n---\n')

  const probe = await probeRepoKind({ homes, source: fixture, fetchImpl: neverFetch, now: 1 })
  assert.equal(probe.ok, true)
  assert.equal(probe.kind, 'npx-skills')
  assert.equal(probe.skills, 2)
  assert.equal(probe.cached, false)
  assert.equal(probe.ref, 'worktree')
  assert.equal(probe.sha, '')
  assert.equal(probe.source, fixture)

  const result = await fetchRepoSkills({ homes, source: fixture, fetchImpl: neverFetch, now: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'npx-skills')
  assert.equal(result.source, fixture)
  assert.equal(result.ref, 'worktree')
  assert.equal(result.sha, '')
  assert.equal(result.skills, 2)
  assert.equal(result.cached, false)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.root, [
    {
      type: 'dir',
      name: 'core',
      path: 'core',
      children: [
        {
          type: 'skill',
          name: 'batch',
          path: 'skills/core/batch/SKILL.md',
          description: 'Batch it',
        },
      ],
    },
    {
      type: 'skill',
      name: 'find-skills',
      path: 'skills/find-skills/SKILL.md',
      description: 'Find it',
    },
  ])

  const cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  const entry = cache.entries[repoKey(fixture)]
  assert.equal(entry.source, fixture)
  assert.equal(entry.complete, true)
  assert.equal(entry.kind, 'npx-skills')
  assert.equal(entry.ref, 'worktree')
  assert.equal(entry.sha, '')
  assert.equal(entry.skills, 2)
})

test('local：marketplace 布局按插件分组，file:// 链接收敛成本地路径', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'market')
  await writeRel(
    fixture,
    '.claude-plugin/marketplace.json',
    JSON.stringify({
      name: 'Local Market',
      plugins: [{ name: 'alpha', source: './plugins/alpha' }],
    }),
  )
  await writeRel(
    fixture,
    'plugins/alpha/skills/x/SKILL.md',
    '---\nname: alpha-x\ndescription: From alpha\n---\n',
  )
  await writeRel(fixture, 'plugins/alpha/commands/run.md', 'not a skill\n')

  const result = await fetchRepoSkills({
    homes,
    source: pathToFileURL(fixture).href,
    fetchImpl: neverFetch,
    now: 1,
  })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.equal(result.source, fixture, 'file:// 会被规范化成本地绝对路径')
  assert.equal(result.skills, 1)
  assert.deepEqual(result.root, [
    {
      type: 'dir',
      name: 'alpha',
      path: 'plugins/alpha',
      children: [
        {
          type: 'skill',
          name: 'alpha-x',
          path: 'plugins/alpha/skills/x/SKILL.md',
          description: 'From alpha',
        },
      ],
    },
  ])
})

test('local：不存在的路径与普通文件返回 repo-not-found，空目录返回 repo-unavailable', async (t) => {
  const { homes, root } = await tempHomes(t)
  const missing = path.join(root, 'missing')
  const notFound = await fetchRepoSkills({ homes, source: missing, fetchImpl: neverFetch })
  assert.equal(notFound.ok, false)
  assert.equal(notFound.code, 'repo-not-found')
  assert.match(notFound.message, /Local path/u)
  assert.ok(notFound.message.includes(missing))

  const filePath = path.join(root, 'plain.txt')
  await fs.writeFile(filePath, 'not a directory\n')
  const fileResult = await fetchRepoSkills({ homes, source: filePath, fetchImpl: neverFetch })
  assert.equal(fileResult.ok, false)
  assert.equal(fileResult.code, 'repo-not-found')

  const empty = path.join(root, 'empty')
  await fs.mkdir(empty)
  const emptyResult = await fetchRepoSkills({ homes, source: empty, fetchImpl: neverFetch, now: 1 })
  assert.equal(emptyResult.ok, false)
  assert.equal(emptyResult.code, 'repo-unavailable')
  const entry = (await readCacheFile(homes)).entries[repoKey(empty)]
  assert.equal(entry.kind, 'unavailable')
  assert.equal(entry.complete, false)

  const probed = await probeRepoKind({ homes, source: empty, fetchImpl: neverFetch, now: 2 })
  assert.equal(probed.ok, false)
  assert.equal(probed.code, 'repo-unavailable')
})

test('local：refresh 能看到新增文件，TTL 内命中缓存', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'repo')
  await writeRel(fixture, 'skills/a/SKILL.md', '---\nname: a\ndescription: A\n---\n')

  const first = await fetchRepoSkills({ homes, source: fixture, fetchImpl: neverFetch, now: 100 })
  assert.equal(first.ok, true)
  assert.equal(first.skills, 1)

  await writeRel(fixture, 'skills/b/SKILL.md', '---\nname: b\ndescription: B\n---\n')

  const cached = await fetchRepoSkills({ homes, source: fixture, fetchImpl: neverFetch, now: 101 })
  assert.equal(cached.ok, true)
  assert.equal(cached.cached, true)
  assert.equal(cached.skills, 1, 'TTL 内不重扫目录')

  const refreshed = await fetchRepoSkills({
    homes,
    source: fixture,
    fetchImpl: neverFetch,
    now: 102,
    refresh: true,
  })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.cached, false)
  assert.equal(refreshed.skills, 2)
  assert.deepEqual(
    refreshed.root.map((node) => node.name),
    ['a', 'b'],
  )
})

test('local：遍历深度超限标记 truncated，readFile 只读 root 内并限制大小', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'deep')
  await writeRel(fixture, 'SKILL.md', '---\nname: shallow\ndescription: Shallow\n---\n')

  // 造一条超过 LOCAL_TREE_MAX_DEPTH 的目录链，最深处的 SKILL.md 不该被收进来。
  let deepDir = fixture
  for (let depth = 0; depth <= LOCAL_TREE_MAX_DEPTH + 2; depth += 1) {
    deepDir = path.join(deepDir, `d${depth}`)
  }
  await fs.mkdir(deepDir, { recursive: true })
  await fs.writeFile(path.join(deepDir, 'SKILL.md'), '---\nname: too-deep\n---\n')

  const opened = await openLocalRepo(fixture)
  assert.equal(opened.ok, true)
  assert.equal(opened.truncated, true, '超过深度上限要标记截断')
  assert.deepEqual(opened.tree.map((entry) => entry.path), ['SKILL.md'])

  // readFile：正常文件可读，越界 / 反斜杠 / 绝对路径 / 超限都返回 null。
  assert.equal(await opened.readFile('SKILL.md'), '---\nname: shallow\ndescription: Shallow\n---\n')
  assert.equal(await opened.readFile('../outside.md'), null)
  assert.equal(await opened.readFile('SKILL.md/../../etc/passwd'), null)
  assert.equal(await opened.readFile('/etc/passwd'), null)
  assert.equal(await opened.readFile('a\\b.md'), null)
  assert.equal(await opened.readFile(''), null)

  const big = path.join(fixture, 'big.bin')
  await fs.writeFile(big, Buffer.alloc(LOCAL_FILE_MAX_BYTES + 1, 'a'))
  assert.equal(await opened.readFile('big.bin'), null, '超过单文件上限返回 null')

  // 符号链接作为 blob 收进树，读取时跟随到目标文件。
  await fs.symlink(path.join(fixture, 'SKILL.md'), path.join(fixture, 'link.md'))
  const linked = await openLocalRepo(fixture)
  assert.equal(linked.ok, true)
  assert.ok(linked.tree.some((entry) => entry.path === 'link.md'))
  assert.equal(await linked.readFile('link.md'), '---\nname: shallow\ndescription: Shallow\n---\n')

  // 展开流程也要把 truncated 带出来（否则页面不知道这棵树不完整）。
  const result = await fetchRepoSkills({ homes, source: fixture, fetchImpl: neverFetch, now: 1 })
  assert.equal(result.ok, true)
  assert.equal(result.truncated, true)
  assert.equal(result.skills, 1)
})

test('local：跳过 node_modules / .git / dist / build / __pycache__', async (t) => {
  const { root } = await tempHomes(t)
  const fixture = path.join(root, 'skip')
  for (const dir of ['node_modules', '.git', 'dist', 'build', '__pycache__']) {
    await writeRel(fixture, `${dir}/x/SKILL.md`, '---\nname: skipped\n---\n')
  }
  await writeRel(fixture, 'ok/SKILL.md', '---\nname: kept\n---\n')

  const opened = await openLocalRepo(fixture)
  assert.equal(opened.ok, true)
  assert.deepEqual(opened.tree.map((entry) => entry.path), ['ok/SKILL.md'])
})

test('local：文件条数超过 LOCAL_TREE_MAX_ENTRIES 时截断', async (t) => {
  const { root } = await tempHomes(t)
  const fixture = path.join(root, 'many')
  await fs.mkdir(fixture, { recursive: true })
  const total = LOCAL_TREE_MAX_ENTRIES + 1
  // 分批并发写，20k 个小文件在 APFS 上约几百毫秒。
  for (let start = 0; start < total; start += 2000) {
    const batch = []
    for (let index = start; index < Math.min(start + 2000, total); index += 1) {
      batch.push(fs.writeFile(path.join(fixture, `f${index}.md`), ''))
    }
    await Promise.all(batch)
  }

  const opened = await openLocalRepo(fixture)
  assert.equal(opened.ok, true)
  assert.equal(opened.truncated, true)
  assert.equal(opened.tree.length, LOCAL_TREE_MAX_ENTRIES)
})

test('git：clone 参数、缓存目录与二次复用', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'skills/git-skill/SKILL.md', '---\nname: git-skill\ndescription: From git\n---\n')
  const { runGit, cloneCalls } = createGit({ fixture, sha: 'sha-1' })
  const url = 'https://gitlab.com/group/repo.git'

  const first = await ensureGitClone({ homes, url, runGit })
  assert.equal(first.ok, true)
  const dir = gitCloneDir(homes, url)
  assert.equal(first.dir, dir)
  assert.equal(first.sha, 'sha-1')
  assert.equal(path.dirname(dir), path.join(homes.dshHome, 'buka-skills', 'cache', 'git'))
  assert.match(path.basename(dir), /^[0-9a-f]{32}$/u, '目录名是 URL 的 sha256 前 32 位')

  const clones = cloneCalls()
  assert.equal(clones.length, 1)
  const [command, ...args] = clones[0].args
  assert.equal(command, 'clone')
  assert.deepEqual(args.slice(0, 5), ['--depth', '1', '--single-branch', '--no-tags', '--'])
  assert.equal(args[5], url, 'URL 在 -- 之后')
  assert.ok(args[6].startsWith(path.dirname(dir)), '先克隆到缓存目录下的临时目录')
  assert.ok(args[6].endsWith('.tmp'))

  const second = await ensureGitClone({ homes, url, runGit })
  assert.equal(second.ok, true)
  assert.equal(second.dir, dir)
  assert.equal(cloneCalls().length, 1, '目录已存在时直接复用')
})

test('git：同一目录的并发调用只克隆一次', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'SKILL.md', '---\nname: root\n---\n')
  const { runGit, cloneCalls } = createGit({ fixture })

  const [first, second] = await Promise.all([
    ensureGitClone({ homes, url: 'https://gitlab.com/a/concurrent.git', runGit }),
    ensureGitClone({ homes, url: 'https://gitlab.com/a/concurrent.git', runGit }),
  ])

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(cloneCalls().length, 1)
})

test('git：update 时 fetch + reset，失败时保留旧克隆', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'SKILL.md', '---\nname: root\n---\n')
  const url = 'https://gitlab.com/group/repo.git'
  const dir = gitCloneDir(homes, url)
  await ensureGitClone({ homes, url, runGit: createGit({ fixture }).runGit })

  const updating = createGit({ sha: 'new-sha' })
  const updated = await ensureGitClone({ homes, url, runGit: updating.runGit, update: true })
  assert.equal(updated.ok, true)
  assert.equal(updated.dir, dir)
  assert.equal(updated.sha, 'new-sha')
  assert.deepEqual(
    updating.calls.map((one) => (one.args[0] === '-C' ? one.args[2] : one.args[0])),
    ['fetch', 'reset', 'rev-parse'],
  )
  assert.deepEqual(updating.calls[0].args, ['-C', dir, 'fetch', '--depth', '1', 'origin'])
  assert.equal(updating.calls[0].options.cwd, dir)
  assert.deepEqual(updating.calls[1].args, ['-C', dir, 'reset', '--hard', 'FETCH_HEAD'])

  // 离线：fetch 抛错时不返回错误，继续用旧克隆。
  const offline = async (args) => {
    if (args.includes('fetch')) {
      throw Object.assign(new Error('offline'), { code: 128, stderr: 'fatal: unable to access' })
    }
    return { stdout: 'old-sha\n', stderr: '' }
  }
  const kept = await ensureGitClone({ homes, url, runGit: offline, update: true })
  assert.equal(kept.ok, true)
  assert.equal(kept.dir, dir)
  assert.equal(kept.sha, 'old-sha')
})

test('git：ENOENT 返回 git-unavailable，带 stderr 的失败返回 git-failed', async (t) => {
  const { homes } = await tempHomes(t)

  const missingGit = async () => {
    throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
  }
  const unavailable = await ensureGitClone({
    homes,
    url: 'https://gitlab.com/a/no-git.git',
    runGit: missingGit,
  })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'git-unavailable')
  assert.match(unavailable.message, /install git/iu)

  const cloneFailed = async () => {
    throw Object.assign(new Error('Command failed: git clone'), {
      code: 128,
      stderr: 'remote: Permission denied\nfatal: could not read from remote\n',
    })
  }
  const failed = await ensureGitClone({
    homes,
    url: 'https://gitlab.com/a/private.git',
    runGit: cloneFailed,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'git-failed')
  assert.match(failed.message, /Permission denied/u)
  const gitDir = path.join(homes.dshHome, 'buka-skills', 'cache', 'git')
  assert.deepEqual(await fs.readdir(gitDir).catch(() => []), [], '失败后不留下临时目录')
})

test('git：fetchRepoSkills 端到端列树、缓存命中，refresh 触发更新', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'skills/git-skill/SKILL.md', '---\nname: git-skill\ndescription: From git\n---\n')
  const url = 'https://gitlab.com/group/repo.git'
  const { runGit, calls, cloneCalls } = createGit({ fixture, sha: 'git-sha' })

  const first = await fetchRepoSkills({ homes, source: url, fetchImpl: neverFetch, runGit, now: 1000 })
  assert.equal(first.ok, true)
  assert.equal(first.kind, 'npx-skills')
  assert.equal(first.source, url)
  assert.equal(first.ref, 'HEAD')
  assert.equal(first.sha, 'git-sha')
  assert.equal(first.skills, 1)
  assert.equal(first.cached, false)
  assert.equal(first.truncated, false)
  assert.deepEqual(first.root, [
    {
      type: 'skill',
      name: 'git-skill',
      path: 'skills/git-skill/SKILL.md',
      description: 'From git',
    },
  ])
  assert.equal(cloneCalls().length, 1)

  const cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  assert.equal(cache.entries[repoKey(url)].source, url)
  assert.equal(cache.entries[repoKey(url)].ref, 'HEAD')

  const callsAfterFirst = calls.length
  const cached = await fetchRepoSkills({ homes, source: url, fetchImpl: neverFetch, runGit, now: 1001 })
  assert.equal(cached.ok, true)
  assert.equal(cached.cached, true)
  assert.equal(cached.sha, 'git-sha')
  assert.equal(calls.length, callsAfterFirst, '缓存命中不碰 git')

  const refreshed = await fetchRepoSkills({
    homes,
    source: url,
    fetchImpl: neverFetch,
    runGit,
    now: 1002,
    refresh: true,
  })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.cached, false)
  assert.ok(
    calls.some((one) => one.args[0] === '-C' && one.args[2] === 'fetch'),
    'refresh 要更新克隆',
  )
  assert.ok(calls.some((one) => one.args[0] === '-C' && one.args[2] === 'reset'))

  const probed = await probeRepoKind({ homes, source: url, fetchImpl: neverFetch, runGit, now: 1003 })
  assert.equal(probed.ok, true)
  assert.equal(probed.kind, 'npx-skills')
  assert.equal(probed.cached, true, '完整缓存命中时探测不再访问来源')
})
