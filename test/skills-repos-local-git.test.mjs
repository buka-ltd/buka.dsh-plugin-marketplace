/**
 * 「本地绝对路径 / 任意 git 地址」两种来源的读取单测。
 *
 * 全部用临时 DSH home 与临时 fixture 目录，git 子进程一律注入假 `runGit`，
 * 不联网、不调用本机真实 git。重点覆盖：
 *
 * - local：只列根 `skills/` 下的 SKILL.md、`file://` 收敛、不存在路径、
 *   刷新重扫、遍历与读取上限、跳过目录；
 * - git：浅克隆参数与缓存目录、并发合并、`update` 的 fetch / reset、
 *   离线时沿用旧克隆并返回 warning、端到端列树与缓存。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { ensureGitClone, gitCloneDir } from '../plugins/skills/src/git-source.ts'
import {
  LOCAL_FILE_MAX_BYTES,
  LOCAL_TREE_MAX_DEPTH,
  LOCAL_TREE_MAX_ENTRIES,
  openLocalRepo,
} from '../plugins/skills/src/local-source.ts'
import { fetchRepoSkills, repoSkillsCacheFile } from '../plugins/skills/src/repo-skills.ts'
import { repoKey } from '../plugins/skills/src/repo-store.ts'

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

/** 写一个最小 SKILL.md。 */
function skillFile(name, description = `${name} description`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

/**
 * 假 git runner：clone 时把 fixture 复制到目标目录；fetch 可失败。
 *
 * @param {{ fixture?: string, sha?: string, failFetch?: string }} [options]
 */
function createGit({ fixture, sha = 'git-sha', failFetch } = {}) {
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
    if (failFetch !== undefined && (args.includes('fetch') || args.includes('reset'))) {
      const error = new Error(failFetch)
      error.stderr = failFetch
      throw error
    }
    return { stdout: '', stderr: '' }
  }
  return {
    runGit,
    calls,
    cloneCalls: () => calls.filter((one) => one.args[0] === 'clone'),
  }
}

test('local：只列根 skills/ 下的 SKILL.md，file:// 收敛成本地路径', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'repo')
  await writeRel(fixture, 'README.md', '# demo\n')
  await writeRel(fixture, 'SKILL.md', skillFile('root'))
  await writeRel(fixture, '.claude/skills/agent/SKILL.md', skillFile('agent'))
  await writeRel(fixture, 'skills/one/SKILL.md', skillFile('one', 'First'))
  await writeRel(fixture, 'skills/two/nested/SKILL.md', skillFile('nested', 'Nested'))
  await writeRel(fixture, 'skills/node_modules/pkg/SKILL.md', skillFile('dep'))

  const viaFile = pathToFileURL(fixture)
  const result = await fetchRepoSkills({ homes, source: viaFile.href })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.source, fixture)
  assert.equal(result.skills, 2)
  assert.equal(result.ref, 'worktree')
  assert.equal(result.sha, '')

  const opened = await openLocalRepo(fixture)
  assert.equal(opened.ok, true)
  assert.equal(await opened.readFile('skills/one/SKILL.md').then((text) => text !== null), true)
  assert.equal(await opened.readFile('../outside.txt'), null)
  assert.equal(
    opened.tree.some((entry) => entry.path.includes('node_modules')),
    false,
    'node_modules 不进树',
  )
})

test('local：不存在、空仓库与刷新重扫', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'repo')
  await fs.mkdir(fixture, { recursive: true })

  const missing = await fetchRepoSkills({ homes, source: path.join(root, 'nope') })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'repo-not-found')

  const empty = await fetchRepoSkills({ homes, source: fixture, now: 1000 })
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'repo-unavailable')

  await writeRel(fixture, 'skills/added/SKILL.md', skillFile('added'))
  const refreshed = await fetchRepoSkills({ homes, source: fixture, now: 1000, refresh: true })
  assert.equal(refreshed.ok, true)
  if (refreshed.ok) assert.equal(refreshed.skills, 1)
})

test('local：遍历深度与条目上限会标记 truncated，单文件读取有大小上限', async (t) => {
  const { root } = await tempHomes(t)
  const fixture = path.join(root, 'repo')
  const deepDir = Array.from({ length: LOCAL_TREE_MAX_DEPTH + 2 }, () => 'd').join('/')
  await writeRel(fixture, `${deepDir}/very-deep.txt`, 'x')
  for (let index = 0; index < LOCAL_TREE_MAX_ENTRIES + 2; index += 1) {
    await writeRel(fixture, `files/f-${index}.txt`, 'x')
  }
  const opened = await openLocalRepo(fixture)
  assert.equal(opened.ok, true)
  if (!opened.ok) return
  assert.equal(opened.truncated, true)

  const big = path.join(root, 'big')
  await writeRel(big, 'skills/big/SKILL.md', 'x'.repeat(LOCAL_FILE_MAX_BYTES + 1))
  const bigRepo = await openLocalRepo(big)
  assert.equal(bigRepo.ok, true)
  if (bigRepo.ok) assert.equal(await bigRepo.readFile('skills/big/SKILL.md'), null)
})

test('git：浅克隆到 hash 目录、并发合并、update 走 fetch/reset', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'skills/one/SKILL.md', skillFile('one'))
  const git = createGit({ fixture, sha: 'abc123' })
  const url = 'https://gitlab.com/acme/demo.git'

  const [first, second] = await Promise.all([
    ensureGitClone({ homes, url, runGit: git.runGit, update: true }),
    ensureGitClone({ homes, url, runGit: git.runGit, update: true }),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(git.cloneCalls().length, 1, '同一地址的并发调用共用一次 clone')
  assert.equal(first.sha, 'abc123')
  assert.equal(first.dir, gitCloneDir(homes, url))

  const refreshed = await ensureGitClone({ homes, url, runGit: git.runGit, update: true })
  assert.equal(refreshed.ok, true)
  const fetchCalls = git.calls.filter((one) => one.args.includes('fetch'))
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].args[0], '-C', '在克隆目录里 fetch')
  assert.ok(git.calls.some((one) => one.args.includes('reset') && one.args.includes('FETCH_HEAD')))
})

test('git：fetch 失败保留旧克隆，返回 stale + warning', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'skills/one/SKILL.md', skillFile('one'))
  const url = 'ssh://git@example.com/acme/demo.git'

  const good = createGit({ fixture })
  const cloned = await ensureGitClone({ homes, url, runGit: good.runGit })
  assert.equal(cloned.ok, true)

  const failing = createGit({ fixture, failFetch: 'fatal: could not read from remote' })
  const stale = await ensureGitClone({ homes, url, runGit: failing.runGit, update: true })
  assert.equal(stale.ok, true)
  if (!stale.ok) return
  assert.equal(stale.stale, true)
  assert.match(String(stale.warning), /could not read from remote/u)
  assert.equal(await fs.stat(path.join(stale.dir, 'skills/one/SKILL.md')).then(() => true), true)

  const noGit = async () => {
    const error = new Error('spawn git ENOENT')
    error.code = 'ENOENT'
    throw error
  }
  const unavailable = await ensureGitClone({
    homes,
    url: 'ssh://git@example.com/x/y.git',
    runGit: noGit,
  })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'git-unavailable')
})

test('git 端到端：fetchRepoSkills 列树、缓存命中、refresh 触发更新', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'skills/one/SKILL.md', skillFile('one', 'First'))
  const git = createGit({ fixture, sha: 'deadbeef' })

  const first = await fetchRepoSkills({
    homes,
    source: 'https://gitlab.com/acme/demo.git',
    runGit: git.runGit,
    now: 1_000_000,
  })
  assert.equal(first.ok, true)
  if (first.ok) {
    assert.equal(first.kind, 'npx-skills')
    assert.equal(first.sha, 'deadbeef')
    assert.equal(first.skills, 1)
    const cache = JSON.parse(await fs.readFile(repoSkillsCacheFile(homes), 'utf8'))
    assert.deepEqual(Object.keys(cache).sort(), ['entries', 'version'])
  }

  const cached = await fetchRepoSkills({
    homes,
    source: 'https://gitlab.com/acme/demo.git',
    runGit: git.runGit,
    now: 1_000_000 + 1,
  })
  assert.equal(cached.ok, true)
  if (cached.ok) assert.equal(cached.cached, true)

  const refreshed = await fetchRepoSkills({
    homes,
    source: 'https://gitlab.com/acme/demo.git',
    runGit: git.runGit,
    refresh: true,
    now: 1_000_000,
  })
  assert.equal(refreshed.ok, true)
  assert.ok(git.calls.some((one) => one.args.includes('fetch')))
  assert.ok(repoKey('https://gitlab.com/acme/demo.git').includes('gitlab'))
})
