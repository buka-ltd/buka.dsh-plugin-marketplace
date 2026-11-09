/**
 * 收藏来源分类与规范化的单测。
 *
 * 收藏的地址从「只支持 GitHub」扩展成「任意 git 地址 + 本地绝对路径」，这里守住
 * 三件容易回归的事：
 *
 * - 五种来源（`github` / `git` / `local` / `web` / `package`）的判定与规范化结果；
 * - 只有 `github` / `git` / `local` 能让 Host 列出 skills（`listable`）；
 * - 会被当成命令行参数的字符串（空白、`-` 开头、控制字符）仍被拒绝。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  addSavedRepo,
  classifyRepoSource,
  listSavedRepos,
  normalizeRepoSource,
  repoStoreFile,
  repoKey,
} from '../plugins/skills/lib/repo-store.js'

/** 建一个临时 DSH home，并在测试结束后删除。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-sources-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
}

test('classifyRepoSource：GitHub 的几种写法都收敛成 owner/repo', () => {
  for (const source of [
    'vercel-labs/agent-skills',
    'github.com/vercel-labs/agent-skills',
    'https://github.com/vercel-labs/agent-skills',
    'https://github.com/vercel-labs/agent-skills.git',
    'https://www.github.com/vercel-labs/agent-skills/',
    'git@github.com:vercel-labs/agent-skills.git',
    'ssh://git@github.com/vercel-labs/agent-skills',
  ]) {
    assert.deepEqual(
      classifyRepoSource(source),
      { ok: true, kind: 'github', source: 'vercel-labs/agent-skills', listable: true },
      source,
    )
  }
})

test('classifyRepoSource：任意 git 地址原样保留且可列出', () => {
  const cases = new Map([
    ['https://gitlab.com/group/repo', 'https://gitlab.com/group/repo'],
    ['https://gitlab.com/group/repo.git/', 'https://gitlab.com/group/repo.git'],
    ['https://git.example.com:8443/team/skills.git', 'https://git.example.com:8443/team/skills.git'],
    ['ssh://git@gitlab.com/group/repo.git', 'ssh://git@gitlab.com/group/repo.git'],
    ['git://example.com/a/b.git', 'git://example.com/a/b.git'],
    ['git@gitlab.com:group/sub/repo.git', 'git@gitlab.com:group/sub/repo.git'],
    ['deploy@example.com:repos/skills', 'deploy@example.com:repos/skills'],
  ])
  for (const [source, expected] of cases) {
    assert.deepEqual(
      classifyRepoSource(source),
      { ok: true, kind: 'git', source: expected, listable: true },
      source,
    )
  }
})

test('classifyRepoSource：普通 http(s) 链接按 git 仓库处理，GitHub 子页面只当书签', () => {
  // 非 GitHub 的 http(s) 无法离线区分「git 仓库」与「普通网页」，统一按 git 处理，
  // 展开失败时由 Host 给出 git 的报错；这样 GitLab 等不带 .git 的仓库链接也能用。
  assert.deepEqual(classifyRepoSource('https://notion.so/some-skill-page'), {
    ok: true,
    kind: 'git',
    source: 'https://notion.so/some-skill-page',
    listable: true,
  })
  assert.deepEqual(
    classifyRepoSource('https://github.com/vercel-labs/agent-skills/tree/main/skills/react'),
    {
      ok: true,
      kind: 'web',
      source: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/react',
      listable: false,
    },
  )
})

test('classifyRepoSource：本地绝对路径规范化且可列出', () => {
  const cases = new Map([
    ['/Users/me/skills', '/Users/me/skills'],
    ['/Users/me/skills/', '/Users/me/skills'],
    ['/Users/me/a/../skills', '/Users/me/skills'],
    ['/Users/me//skills', '/Users/me/skills'],
    ['/Users/me/My Skills', '/Users/me/My Skills'],
    ['/', '/'],
    ['file:///Users/me/skills', '/Users/me/skills'],
    ['file:///Users/me/My%20Skills', '/Users/me/My Skills'],
  ])
  for (const [source, expected] of cases) {
    assert.deepEqual(classifyRepoSource(source), {
      ok: true,
      kind: 'local',
      source: expected,
      listable: true,
    }, source)
  }

  if (process.platform === 'win32') {
    assert.deepEqual(classifyRepoSource('C:\\Users\\me\\skills'), {
      ok: true,
      kind: 'local',
      source: 'C:\\Users\\me\\skills',
      listable: true,
    })
    assert.deepEqual(classifyRepoSource('C:/Users/me/skills/'), {
      ok: true,
      kind: 'local',
      source: 'C:\\Users\\me\\skills',
      listable: true,
    })
  }
})

test('classifyRepoSource：包名可收藏但不可列出', () => {
  for (const source of ['notion', '@scope/pkg']) {
    assert.deepEqual(classifyRepoSource(source), {
      ok: true,
      kind: 'package',
      source,
      listable: false,
    }, source)
  }
})

test('classifyRepoSource：非法输入被拒绝', () => {
  for (const bad of [
    '',
    '   ',
    '-g',
    '--global',
    'a b',
    'owner/repo/extra',
    '../etc',
    'https://',
    'ftp://x/y',
    'a\nb',
    'git@x:path',
    42,
    null,
    undefined,
  ]) {
    assert.deepEqual(classifyRepoSource(bad), { ok: false }, JSON.stringify(bad))
    assert.equal(normalizeRepoSource(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(classifyRepoSource(`a/${'b'.repeat(301)}`), { ok: false })
  assert.deepEqual(classifyRepoSource(`/tmp/${'b'.repeat(301)}`), { ok: false })
})

test('normalizeRepoSource：保持旧入口的返回值', () => {
  const cases = new Map([
    ['vercel-labs/agent-skills', 'vercel-labs/agent-skills'],
    ['https://github.com/vercel-labs/agent-skills.git', 'vercel-labs/agent-skills'],
    ['notion', 'notion'],
    ['@scope/pkg', '@scope/pkg'],
    ['https://notion.so/some-skill-page', 'https://notion.so/some-skill-page'],
    ['https://gitlab.com/group/repo/', 'https://gitlab.com/group/repo'],
    ['/Users/me/skills/', '/Users/me/skills'],
  ])
  for (const [input, expected] of cases) assert.equal(normalizeRepoSource(input), expected, input)
})

test('收藏：git 地址与本地路径写入规范化后的来源并按小写值去重', async (t) => {
  const homes = await tempHomes(t)
  const file = repoStoreFile(homes)

  const git = await addSavedRepo({ homes, source: 'https://gitlab.com/Group/Repo.git/', note: '组内 skills' })
  assert.equal(git.ok, true)
  assert.equal(git.repo.source, 'https://gitlab.com/Group/Repo.git')
  assert.equal(git.repo.id, 'https://gitlab.com/group/repo.git')

  const duplicate = await addSavedRepo({ homes, source: 'https://gitlab.com/Group/Repo.git' })
  assert.deepEqual({ ok: duplicate.ok, code: duplicate.code }, { ok: false, code: 'duplicate' })

  const local = await addSavedRepo({ homes, source: '/tmp/skills/', note: '本地' })
  assert.equal(local.ok, true)
  assert.equal(local.repo.source, '/tmp/skills')
  assert.equal(local.repo.id, '/tmp/skills')

  const localDuplicate = await addSavedRepo({ homes, source: '/tmp/skills' })
  assert.deepEqual({ ok: localDuplicate.ok, code: localDuplicate.code }, { ok: false, code: 'duplicate' })

  const listed = await listSavedRepos({ homes })
  assert.deepEqual(
    listed.repos.map((one) => one.source),
    ['/tmp/skills', 'https://gitlab.com/Group/Repo.git'],
  )
  assert.equal(repoKey('/tmp/skills'), '/tmp/skills')
  assert.equal(await fs.readFile(file, 'utf8').then((text) => JSON.parse(text).version), 1)
})

test('收藏：web 链接与包名照旧可收藏', async (t) => {
  const homes = await tempHomes(t)
  const web = await addSavedRepo({ homes, source: 'https://github.com/acme/demo/tree/main/skills/x' })
  assert.equal(web.ok, true)
  assert.equal(web.repo.source, 'https://github.com/acme/demo/tree/main/skills/x')
  const pkg = await addSavedRepo({ homes, source: 'notion' })
  assert.equal(pkg.ok, true)
  assert.equal(pkg.repo.source, 'notion')
})
