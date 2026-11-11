/**
 * `ctx.bukaSkills` 对外服务的单测。
 *
 * 服务是插件对其他插件的公开 ABI，所以这里直接构造实例（不经过 Host 入口，
 * 入口依赖 `@deepseek-ai/*`，本仓库单测不安装）。网络全部走注入的假 fetch，
 * 收藏文件与缓存落在临时 DSH home：
 *
 * - `listRepositories()` 的分类、探测失败降级与缓存复用；
 * - `listSkills()` 对 npx skills 仓库与 marketplace 的摊平结果；
 * - `listPlugins()` 包括没有 skill 的插件、排序与 `not-a-marketplace`；
 * - 同一仓库的并发请求只打一次 GitHub。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { addSavedRepo, repoStoreFile } from '../plugins/skills/src/repo-store.ts'
import { SERVICE_NAME, SkillsCatalogService } from '../plugins/skills/src/service.ts'

/** 建一个临时 DSH home，并在测试结束后删除。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-service-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
}

/** GitHub tree API 的 URL，测试里拼断言用。 */
function _treeUrl(owner, repo, branch = 'HEAD') {
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
}

/**
 * 多仓库假 fetch。
 *
 * `repos` 的键是 `owner/repo` 的小写值，值形如：
 * `{ tree, treeBranch?, sha?, contents }`，其中 `contents` 是 raw 文件原文
 * （`SKILL.md` 或 `marketplace.json`），缺失时返回 404。未知仓库一律 404，
 * 用来模拟 `repo-not-found`。
 *
 * @param {Record<string, { tree?: unknown[], treeBranch?: string, sha?: string, contents?: Record<string, string> }>} repos
 */
function createFetch(repos) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)

    const treeMatch =
      /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^?]+)\?recursive=1$/u.exec(
        url,
      )
    if (treeMatch !== null) {
      const spec = repos[`${treeMatch[1]}/${treeMatch[2]}`.toLowerCase()]
      if (spec === undefined) return new Response(null, { status: 404 })
      const branch = decodeURIComponent(treeMatch[3])
      if (branch !== (spec.treeBranch ?? 'HEAD')) return new Response(null, { status: 404 })
      return new Response(
        JSON.stringify({ sha: spec.sha ?? 'tree-sha', tree: spec.tree ?? [], truncated: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const rawMatch = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/u.exec(
      url,
    )
    if (rawMatch !== null) {
      const spec = repos[`${rawMatch[1]}/${rawMatch[2]}`.toLowerCase()]
      const content = spec?.contents?.[decodeURIComponent(rawMatch[3])]
      if (content === undefined) return new Response(null, { status: 404 })
      return new Response(content, { status: 200 })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }
  return { fetchImpl, calls }
}

/** 一套固定的仓库：npx skills 仓库、Claude Code marketplace、以及不存在的仓库。 */
function sampleRepos() {
  const npxTree = [
    { type: 'blob', path: 'skills/alpha/SKILL.md' },
    { type: 'blob', path: 'skills/beta/SKILL.md' },
    { type: 'blob', path: 'README.md' },
  ]
  const marketplace = {
    name: 'Acme Market',
    plugins: [
      { name: 'one', source: './plugins/one', description: 'First plugin' },
      { name: 'two', source: './plugins/two', description: 'Second plugin' },
      { name: 'empty', source: './plugins/empty', description: 'Commands only' },
      // 仓库外的 source 无法列出，解析时跳过。
      { name: 'remote', source: { type: 'github', repo: 'acme/elsewhere' } },
    ],
  }
  const marketTree = [
    { type: 'blob', path: '.claude-plugin/marketplace.json' },
    { type: 'blob', path: 'plugins/one/skills/a/SKILL.md' },
    { type: 'blob', path: 'plugins/two/skills/b/SKILL.md' },
    { type: 'blob', path: 'plugins/two/skills/c/SKILL.md' },
  ]
  return {
    'acme/npx': {
      tree: npxTree,
      contents: {
        'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha skill\n---\n',
        'skills/beta/SKILL.md': '---\nname: beta\ndescription: Beta skill\n---\n',
      },
    },
    'acme/market': {
      tree: marketTree,
      contents: {
        '.claude-plugin/marketplace.json': JSON.stringify(marketplace),
        'plugins/one/skills/a/SKILL.md': '---\nname: alpha\ndescription: One alpha\n---\n',
        'plugins/two/skills/b/SKILL.md': '---\nname: beta\ndescription: Two beta\n---\n',
        'plugins/two/skills/c/SKILL.md': '---\nname: gamma\ndescription: Two gamma\n---\n',
      },
    },
  }
}

/** 收藏三个来源：npx 仓库、marketplace、不存在的仓库（新的排在前面）。 */
async function seedRepositories(homes) {
  for (const source of ['acme/npx', 'acme/market', 'acme/missing']) {
    const result = await addSavedRepo({ homes, source })
    assert.equal(result.ok, true)
  }
}

test('listRepositories：分类、探测失败降级并沿用收藏顺序', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl } = createFetch(sampleRepos())
  await seedRepositories(homes)

  const service = new SkillsCatalogService({ homes, fetchImpl })
  const list = await service.listRepositories()

  assert.equal(list.exists, true)
  assert.equal(list.corrupt, false)
  assert.equal(list.repositories.length, 3)
  // 收藏文件把最新添加的排在最前：missing、market、npx。
  assert.deepEqual(
    list.repositories.map((one) => one.source),
    ['acme/missing', 'acme/market', 'acme/npx'],
  )

  const missing = list.repositories[0]
  assert.equal(missing.kind, 'unknown')
  assert.equal(missing.skills, null)
  assert.equal(missing.code, 'repo-not-found')
  assert.equal(typeof missing.error, 'string')

  const market = list.repositories[1]
  assert.equal(market.kind, 'claude-code-marketplace')
  assert.equal(market.skills, 3)

  const npx = list.repositories[2]
  assert.equal(npx.kind, 'npx-skills')
  assert.equal(npx.skills, 2)
})

test('listRepositories：探测结论复用缓存，只有无法缓存的失败会重试', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl, calls } = createFetch(sampleRepos())
  await seedRepositories(homes)

  const service = new SkillsCatalogService({ homes, fetchImpl })
  await service.listRepositories()
  const requestsAfterFirst = calls.length

  const list = await service.listRepositories()
  const retried = calls.slice(requestsAfterFirst)
  assert.ok(
    retried.length > 0 && retried.every((url) => url.includes('/acme/missing/')),
    `第二次只该重试没有缓存的失败仓库，实际请求：${retried.join(', ')}`,
  )
  assert.deepEqual(
    list.repositories.map((one) => one.kind),
    ['unknown', 'claude-code-marketplace', 'npx-skills'],
  )

  // refresh=true 绕过缓存：能探测的仓库也会重新探测。
  const requestsBeforeRefresh = calls.length
  await service.listRepositories({ refresh: true })
  assert.ok(calls.length > requestsBeforeRefresh + retried.length)
})

test('listRepositories：收藏文件损坏时如实返回 corrupt，不伪造条目', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl, calls } = createFetch(sampleRepos())
  await fs.mkdir(path.dirname(repoStoreFile(homes)), { recursive: true })
  await fs.writeFile(repoStoreFile(homes), 'not json')

  const service = new SkillsCatalogService({ homes, fetchImpl })
  const list = await service.listRepositories()

  assert.equal(list.exists, true)
  assert.equal(list.corrupt, true)
  assert.deepEqual(list.repositories, [])
  assert.deepEqual(calls, [])
})

test('listSkills：npx skills 仓库摊平成 skill 列表，plugin 为 null', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl } = createFetch(sampleRepos())
  const service = new SkillsCatalogService({ homes, fetchImpl })

  const result = await service.listSkills({ source: 'acme/npx' })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'npx-skills')
  assert.equal(result.source, 'acme/npx')
  assert.equal(result.cached, false)
  assert.deepEqual(result.skills, [
    { name: 'alpha', description: 'Alpha skill', path: 'skills/alpha/SKILL.md', plugin: null },
    { name: 'beta', description: 'Beta skill', path: 'skills/beta/SKILL.md', plugin: null },
  ])

  const cached = await service.listSkills({ source: 'acme/npx' })
  assert.equal(cached.ok, true)
  assert.equal(cached.cached, true)
  assert.deepEqual(cached.skills, result.skills)
})

test('listSkills：npx 仓库里清单声明的 skill 带 plugin 名，其余为 null', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl } = createFetch({
    'acme/grouped': {
      tree: [
        { type: 'blob', path: 'skills/declared/SKILL.md' },
        { type: 'blob', path: 'skills/plain/SKILL.md' },
        { type: 'blob', path: '.claude-plugin/plugin.json' },
      ],
      contents: {
        'skills/declared/SKILL.md': '---\nname: declared\ndescription: In the plugin\n---\n',
        'skills/plain/SKILL.md': '---\nname: plain\ndescription: Not declared\n---\n',
        '.claude-plugin/plugin.json': JSON.stringify({
          name: 'demo-plugin',
          skills: ['./skills/declared'],
        }),
      },
    },
  })
  await addSavedRepo({ homes, source: 'acme/grouped' })
  const service = new SkillsCatalogService({ homes, fetchImpl })

  const result = await service.listSkills({ source: 'acme/grouped' })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'npx-skills')
  assert.deepEqual(result.skills, [
    {
      name: 'declared',
      description: 'In the plugin',
      path: 'skills/declared/SKILL.md',
      plugin: 'demo-plugin',
    },
    { name: 'plain', description: 'Not declared', path: 'skills/plain/SKILL.md', plugin: null },
  ])
})

test('listSkills：marketplace 把 skill 归到所属插件', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl } = createFetch(sampleRepos())
  const service = new SkillsCatalogService({ homes, fetchImpl })

  const result = await service.listSkills({ source: 'acme/market' })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.deepEqual(
    result.skills.map((one) => [one.name, one.plugin]),
    [
      ['alpha', 'one'],
      ['beta', 'two'],
      ['gamma', 'two'],
    ],
  )
})

test('listPlugins：列出所有声明的插件（含没有 skill 的）并按名字排序', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl } = createFetch(sampleRepos())
  const service = new SkillsCatalogService({ homes, fetchImpl })

  const result = await service.listPlugins({ source: 'acme/market' })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.deepEqual(
    result.plugins.map((one) => one.name),
    ['empty', 'one', 'two'],
  )
  assert.deepEqual(
    result.plugins.map((one) => [one.name, one.root, one.description]),
    [
      ['empty', 'plugins/empty', 'Commands only'],
      ['one', 'plugins/one', 'First plugin'],
      ['two', 'plugins/two', 'Second plugin'],
    ],
  )
  assert.deepEqual(result.plugins[0].skills, [])
  assert.deepEqual(
    result.plugins[1].skills.map((one) => [one.name, one.plugin]),
    [['alpha', 'one']],
  )
  assert.deepEqual(
    result.plugins[2].skills.map((one) => [one.name, one.plugin]),
    [
      ['beta', 'two'],
      ['gamma', 'two'],
    ],
  )

  // marketplace 清单随完整树一起进缓存：第二次调用命中缓存也要能列出完整插件。
  const cached = await service.listPlugins({ source: 'acme/market' })
  assert.equal(cached.ok, true)
  assert.equal(cached.cached, true)
  assert.deepEqual(
    cached.plugins.map((one) => one.name),
    ['empty', 'one', 'two'],
  )
  assert.deepEqual(cached.plugins[0].skills, [])
})

test('listPlugins：非 marketplace 仓库返回 not-a-marketplace，坏仓库返回原始错误码', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl } = createFetch(sampleRepos())
  const service = new SkillsCatalogService({ homes, fetchImpl })

  const npx = await service.listPlugins({ source: 'acme/npx' })
  assert.equal(npx.ok, false)
  assert.equal(npx.code, 'not-a-marketplace')

  const missing = await service.listPlugins({ source: 'acme/missing' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'repo-not-found')
})

test('同一仓库的并发调用只打一次 GitHub，refresh 请求不合并', async (t) => {
  const homes = await tempHomes(t)
  const { fetchImpl, calls } = createFetch(sampleRepos())
  const service = new SkillsCatalogService({ homes, fetchImpl })

  const [first, second] = await Promise.all([
    service.listSkills({ source: 'acme/npx' }),
    service.listSkills({ source: 'acme/npx' }),
  ])
  assert.deepEqual(first.skills, second.skills)
  assert.equal(
    calls.filter((url) => url.startsWith('https://api.github.com/')).length,
    1,
    '并发调用应共用一次 tree 拉取',
  )

  // 两个 refresh 请求互不合并：各自真的重新拉。
  await Promise.all([
    service.listSkills({ source: 'acme/npx', refresh: true }),
    service.listSkills({ source: 'acme/npx', refresh: true }),
  ])
  assert.equal(calls.filter((url) => url.startsWith('https://api.github.com/')).length, 3)
})

test('服务名是其他插件注入用的稳定标识', () => {
  assert.equal(SERVICE_NAME, 'bukaSkills')
})
