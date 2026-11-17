/**
 * 「收藏仓库里有哪些 skills」的发现、缓存与刷新单测。
 *
 * 收藏只认仓库根 `skills/` 下（任意层级子目录）的 `SKILL.md`：根 `SKILL.md`、
 * agent 目录与 Claude Code marketplace 布局都不算可安装来源。GitHub 与其它
 * git 远端都走本地浅克隆（这里注入假 git runner，不联网），本地路径直接扫描。
 *
 * 重点覆盖：
 *
 * - 发现过滤与物理目录建树、frontmatter 元数据、内部 skill；
 * - GitHub 只克隆不调用 API、来源收敛成同一缓存键；
 * - TTL / refresh / 刷新失败保留旧克隆并返回 warning；
 * - 不可用仓库的缓存与错误码；
 * - `probeRepoKind()` 的轻量结论与「不降级完整树」；
 * - 缓存版本与损坏条目重建。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  fetchRepoSkills,
  probeRepoKind,
  REPO_SKILLS_CACHE_TTL_MS,
  REPO_SKILLS_CACHE_VERSION,
  repoSkillsCacheFile,
} from '../plugins/skills/src/repo-skills.ts'
import { repoKey } from '../plugins/skills/src/repo-store.ts'

/** 建一个临时 DSH home，并在测试结束后删除。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-repo-'))
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
function skillFile(name, description = `${name} description`, extra = '') {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`
}

/** 读回缓存文件；不存在或损坏时返回 null。 */
async function readCacheFile(homes) {
  try {
    return JSON.parse(await fs.readFile(repoSkillsCacheFile(homes), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 假 git runner：clone 时把 fixture 复制到目标目录；fetch 可按需失败。
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

/** 建一个标准的 npx 仓库 fixture。 */
async function makeRepo(root) {
  await writeRel(root, 'README.md', '# demo\n')
  await writeRel(root, 'SKILL.md', skillFile('root-should-not-count'))
  await writeRel(root, '.claude/skills/agent-only/SKILL.md', skillFile('agent-only'))
  await writeRel(root, '.codex/skills/agent-only/SKILL.md', skillFile('agent-only'))
  await writeRel(root, 'skills/top/SKILL.md', skillFile('top', 'Top level skill'))
  await writeRel(root, 'skills/deep/nested/SKILL.md', skillFile('nested', 'Nested skill'))
  await writeRel(
    root,
    'skills/notes.md',
    '---\nname: not-a-skill\ndescription: plain markdown\n---\n',
  )
  await writeRel(
    root,
    'skills/internal/SKILL.md',
    skillFile('internal', 'Hidden', 'metadata:\n  internal: true\n'),
  )
  return root
}

test('发现：只认仓库根 skills/ 下任意深度的 SKILL.md，根与 agent 目录不算', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = await makeRepo(path.join(root, 'fixture'))
  const git = createGit({ fixture })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'npx-skills')
  assert.equal(result.skills, 2, '内部 skill 不列，根 / agent 目录 / 普通 .md 也不算')

  // GitHub 转成 HTTPS 克隆地址，不再有 API / raw 请求。
  const clone = git.cloneCalls()[0]
  assert.ok(clone, '应该走 git clone')
  assert.ok(clone.args.includes('https://github.com/acme/demo.git'))
  assert.ok(clone.args.includes('--depth'))
  assert.ok(clone.args.includes('1'))
  assert.ok(clone.args.includes('--single-branch'))
  assert.ok(clone.args.includes('--no-tags'))

  // 展示树保留物理目录结构：skills/top 与 skills/deep/nested。
  const top = result.root.find((node) => node.type === 'dir' && node.name === 'top')
  assert.ok(top, '顶层目录 top 应在根上')
  assert.equal(top.path, 'skills/top')
  assert.deepEqual(
    top.children.map((node) => ({ name: node.name, path: node.path })),
    [{ name: 'top', path: 'skills/top/SKILL.md' }],
  )
  const deep = result.root.find((node) => node.type === 'dir' && node.name === 'deep')
  assert.ok(deep)
  const nested = deep.children[0]
  assert.equal(nested.type, 'dir')
  assert.equal(nested.children[0].name, 'nested')
  assert.equal(nested.children[0].description, 'Nested skill')
})

test('GitHub 简写与链接收敛成同一来源与缓存键，命中缓存不重复克隆', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = await makeRepo(path.join(root, 'fixture'))
  const git = createGit({ fixture })

  const first = await fetchRepoSkills({ homes, source: 'Acme/Demo', runGit: git.runGit })
  assert.equal(first.ok, true)
  assert.equal(first.source, 'Acme/Demo')
  assert.equal(git.cloneCalls().length, 1)

  const second = await fetchRepoSkills({
    homes,
    source: 'https://github.com/acme/demo.git',
    runGit: git.runGit,
  })
  assert.equal(second.ok, true)
  if (second.ok) {
    assert.equal(second.cached, true, '链接形式应命中同一份缓存')
    assert.equal(second.source.toLowerCase(), 'acme/demo')
  }
  assert.equal(git.cloneCalls().length, 1)

  const cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  assert.deepEqual(Object.keys(cache.entries), [repoKey('Acme/Demo')])
})

test('缓存：TTL 内命中、refresh 与过期后重新 fetch 克隆', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = await makeRepo(path.join(root, 'fixture'))
  const git = createGit({ fixture })

  await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit, now: 1_000_000 })
  const fresh = await fetchRepoSkills({
    homes,
    source: 'acme/demo',
    runGit: git.runGit,
    now: 1_000_000 + REPO_SKILLS_CACHE_TTL_MS - 1,
  })
  assert.equal(fresh.ok, true)
  if (fresh.ok) assert.equal(fresh.cached, true)
  assert.equal(git.calls.filter((one) => one.args.includes('fetch')).length, 0)

  const refreshed = await fetchRepoSkills({
    homes,
    source: 'acme/demo',
    runGit: git.runGit,
    refresh: true,
    now: 1_000_000,
  })
  assert.equal(refreshed.ok, true)
  if (refreshed.ok) assert.equal(refreshed.cached, false)
  assert.equal(git.calls.filter((one) => one.args.includes('fetch')).length, 1)

  const expired = await fetchRepoSkills({
    homes,
    source: 'acme/demo',
    runGit: git.runGit,
    now: 1_000_000 + REPO_SKILLS_CACHE_TTL_MS,
  })
  assert.equal(expired.ok, true)
  assert.equal(git.calls.filter((one) => one.args.includes('fetch')).length, 2)
})

test('刷新克隆失败：保留旧克隆继续展示，并在 warning 里报错', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = await makeRepo(path.join(root, 'fixture'))
  const good = createGit({ fixture })
  await fetchRepoSkills({ homes, source: 'acme/demo', runGit: good.runGit })

  // 远端改动后刷新失败：内容仍是旧克隆，warning 带 git 的 stderr。
  await writeRel(fixture, 'skills/added/SKILL.md', skillFile('added'))
  const failing = createGit({ fixture, failFetch: 'fatal: unable to access remote' })
  const refreshed = await fetchRepoSkills({
    homes,
    source: 'acme/demo',
    runGit: failing.runGit,
    refresh: true,
  })
  assert.equal(refreshed.ok, true)
  if (refreshed.ok) {
    assert.match(String(refreshed.warning), /unable to access remote/u)
    assert.equal(
      refreshed.root.some((node) => node.name === 'added'),
      false,
      '刷新失败时仍用旧克隆内容',
    )
  }
})

test('不可用仓库：根 SKILL.md / agent 目录 / marketplace 布局都返回 repo-unavailable 并缓存', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = path.join(root, 'fixture')
  await writeRel(fixture, 'SKILL.md', skillFile('root-only'))
  await writeRel(fixture, '.claude/skills/only/SKILL.md', skillFile('agent-only'))
  await writeRel(
    fixture,
    '.claude-plugin/marketplace.json',
    JSON.stringify({ name: 'm', plugins: [{ name: 'p', source: './plugins/p' }] }),
  )
  await writeRel(fixture, 'plugins/p/skills/x/SKILL.md', skillFile('x'))
  const git = createGit({ fixture })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'repo-unavailable')

  const cache = await readCacheFile(homes)
  const entry = cache.entries[repoKey('acme/demo')]
  assert.equal(entry.kind, 'unavailable')
  assert.equal(entry.skills, 0)

  // 命中不可用缓存时不再访问来源。
  const again = await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'repo-unavailable')
  assert.equal(git.cloneCalls().length, 1)
})

test('错误码：非法来源、包名 / 网页子页面、本地缺失、找不到 git', async (t) => {
  const { homes, root } = await tempHomes(t)

  const invalid = await fetchRepoSkills({
    homes,
    source: '@scope/pkg/extra',
    runGit: createGit().runGit,
  })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-source')

  const pkg = await fetchRepoSkills({ homes, source: 'notion', runGit: createGit().runGit })
  assert.equal(pkg.ok, false)
  assert.equal(pkg.code, 'unsupported-source')

  const web = await fetchRepoSkills({
    homes,
    source: 'https://github.com/acme/demo/tree/main',
    runGit: createGit().runGit,
  })
  assert.equal(web.ok, false)
  assert.equal(web.code, 'unsupported-source')

  const missing = await fetchRepoSkills({
    homes,
    source: path.join(root, 'nope'),
    runGit: createGit().runGit,
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'repo-not-found')

  const noGit = async () => {
    const error = new Error('spawn git ENOENT')
    error.code = 'ENOENT'
    throw error
  }
  const unavailable = await fetchRepoSkills({
    homes,
    source: 'git@example.com:acme/demo.git',
    runGit: noGit,
  })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'git-unavailable')
})

test('probeRepoKind：只写轻量结论，展开时补完整树，刷新探测不降级完整树', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = await makeRepo(path.join(root, 'fixture'))
  const git = createGit({ fixture })

  const probed = await probeRepoKind({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(probed.ok, true)
  assert.equal(probed.kind, 'npx-skills')
  assert.equal(probed.skills, 3, '探测只数 SKILL.md，内部 skill 也会计入')
  assert.equal(probed.cached, false)

  let cache = await readCacheFile(homes)
  let entry = cache.entries[repoKey('acme/demo')]
  assert.equal(entry.complete, false)
  assert.equal(entry.skills, 3)
  assert.deepEqual(entry.root, [])

  const fetched = await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(fetched.ok, true)
  assert.equal(fetched.cached, false, '轻量缓存不能直接当完整树返回')
  cache = await readCacheFile(homes)
  entry = cache.entries[repoKey('acme/demo')]
  assert.equal(entry.complete, true)
  assert.ok(entry.root.length > 0)

  const reprobed = await probeRepoKind({
    homes,
    source: 'acme/demo',
    runGit: git.runGit,
    refresh: true,
  })
  assert.equal(reprobed.ok, true)
  cache = await readCacheFile(homes)
  entry = cache.entries[repoKey('acme/demo')]
  assert.equal(entry.complete, true, '刷新探测不能把完整树降级成轻量结论')
  assert.ok(entry.root.length > 0)
})

test('缓存版本不符或条目损坏时当作未命中并重建', async (t) => {
  const { homes, root } = await tempHomes(t)
  const fixture = await makeRepo(path.join(root, 'fixture'))
  const git = createGit({ fixture })
  const file = repoSkillsCacheFile(homes)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 1,
      entries: { [repoKey('acme/demo')]: { source: 'acme/demo', root: [] } },
    }),
  )

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(result.ok, true)
  const cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  assert.equal(cache.entries[repoKey('acme/demo')].complete, true)

  // 版本正确但 kind 非法：整条丢弃，重新拉取。
  await fs.writeFile(
    file,
    JSON.stringify({
      version: REPO_SKILLS_CACHE_VERSION,
      entries: {
        [repoKey('acme/demo')]: {
          source: 'acme/demo',
          kind: 'claude-code-marketplace',
          ref: 'HEAD',
          sha: '',
          fetchedAt: Date.now(),
          truncated: false,
          skills: 0,
          complete: true,
          root: [],
        },
      },
    }),
  )
  const rebuilt = await fetchRepoSkills({ homes, source: 'acme/demo', runGit: git.runGit })
  assert.equal(rebuilt.ok, true)
  assert.equal(git.cloneCalls().length, 1, '已有克隆时只 fetch，不重新 clone')
  assert.equal(git.calls.filter((one) => one.args.includes('fetch')).length, 1)
})
