/**
 * 「GitHub 仓库 skills 列表」拉取、缓存与建树的单测。
 *
 * 全部走注入的 `fetchImpl`，不访问真实网络；缓存目录用临时 DSH home，
 * 每个用例结束清理。重点覆盖：
 *
 * - 与 `npx skills` 一致的发现规则与容器前缀剥离；
 * - 目录/skill 的排序与完整仓库路径；
 * - TTL、`refresh`、损坏缓存的重建；
 * - 各错误码与分支回退；
 * - token 来源与 SKILL.md 拉取的并发上限。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  REPO_SKILLS_CACHE_TTL_MS,
  REPO_SKILLS_CACHE_VERSION,
  fetchRepoSkills,
  githubRepoOf,
  repoSkillsCacheFile,
} from '../plugins/skills/lib/repo-skills.js'
import { repoKey } from '../plugins/skills/lib/repo-store.js'
import { parseFrontmatter, parseFrontmatterDescription } from '../plugins/skills/lib/skill-store.js'

/** GitHub tree API 的 URL，测试里拼断言用。 */
function treeUrl(owner, repo, branch, host = 'api.github.com') {
  return `https://${host}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
}

/** 建一个临时 DSH home，并在测试结束后删除。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-repo-skills-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return {
    root,
    homes: { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') },
  }
}

/**
 * 按 URL 分派的假 fetch。
 *
 * `trees[branch]` 可以是：
 * - `{ tree, sha, truncated }`：成功的 tree 响应；
 * - `{ status, headers }`：指定状态码（如 403/500）；
 * - `{ raw }`：返回坏 JSON；
 * - `{ throw }`：直接抛错。
 * `contents[repoPath]` 是 SKILL.md 原文；缺失时返回 404。
 */
function createFetch({ owner = 'Acme', repo = 'Demo', trees = {}, contents = {} } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })

    // GitHub 的 owner/repo 不区分大小写；mock 也跟着不区分，避免测试里
    // 来源大小写和 mock 配置不一致时出现「假」的网络失败。
    const apiPrefix = `https://api.github.com/repos/${owner}/${repo}/git/trees/`
    if (url.toLowerCase().startsWith(apiPrefix.toLowerCase())) {
      const branch = decodeURIComponent(url.slice(apiPrefix.length).split('?')[0])
      const spec = trees[branch]
      if (spec === undefined) return new Response(null, { status: 404 })
      if (spec.throw !== undefined) throw new Error(String(spec.throw))
      if (spec.status !== undefined) {
        return new Response(null, { status: spec.status, headers: spec.headers ?? {} })
      }
      if (spec.raw !== undefined) return new Response(spec.raw, { status: 200 })
      return new Response(JSON.stringify({ sha: spec.sha ?? 'tree-sha', tree: spec.tree, truncated: spec.truncated === true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const rawPrefix = `https://raw.githubusercontent.com/${owner}/${repo}/`
    if (url.toLowerCase().startsWith(rawPrefix.toLowerCase())) {
      const rest = url.slice(rawPrefix.length)
      const slash = rest.indexOf('/')
      const repoPath = decodeURIComponent(slash < 0 ? '' : rest.slice(slash + 1))
      const content = contents[repoPath]
      if (content === undefined) return new Response(null, { status: 404 })
      if (typeof content === 'object' && content !== null) {
        return new Response(null, { status: content.status ?? 404 })
      }
      return new Response(content, { status: 200 })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }
  return { fetchImpl, calls }
}

/** 读回缓存文件；不存在时返回 null。 */
async function readCacheFile(homes) {
  try {
    return JSON.parse(await fs.readFile(repoSkillsCacheFile(homes), 'utf8'))
  } catch {
    return null
  }
}

test('GitHub 仓库：发现 SKILL.md、剥容器前缀、排序并解析元数据', async (t) => {
  const { homes } = await tempHomes(t)
  const tree = [
    { type: 'blob', path: 'SKILL.md' },
    { type: 'blob', path: 'README.md' },
    { type: 'blob', path: 'skills/find-skills/SKILL.md' },
    { type: 'blob', path: 'skills/core/firecrawl-agent/SKILL.md' },
    { type: 'blob', path: 'skills/Workflows/batch/SKILL.md' },
    // 有优先级结果时不会被兜底规则收进来。
    { type: 'blob', path: '.automations/daily/SKILL.md' },
  ]
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { sha: 'tree-sha', tree } },
    contents: {
      'SKILL.md': '---\ndescription: Root skill\n---\n\n# Demo\n',
      'skills/find-skills/SKILL.md': '---\nname: find-skills\ndescription: "Find the right skill"\n---\n',
      'skills/core/firecrawl-agent/SKILL.md':
        '---\nname: firecrawl-agent\ndescription: >\n  Agentic\n  browsing\n---\n',
      // batch 故意不提供原文：模拟 SKILL.md 拉取失败，名称回退目录名。
    },
  })
  const now = 1_700_000_000_000

  const result = await fetchRepoSkills({ homes, source: 'Acme/Demo', fetchImpl, token: 'test-token', now })

  assert.equal(result.ok, true)
  assert.equal(result.source, 'Acme/Demo')
  assert.equal(result.ref, 'HEAD')
  assert.equal(result.sha, 'tree-sha')
  assert.equal(result.fetchedAt, now)
  assert.equal(result.cached, false)
  assert.equal(result.truncated, false)
  assert.equal(result.skills, 4)
  assert.deepEqual(result.root, [
    {
      type: 'dir',
      name: 'core',
      path: 'core',
      children: [
        {
          type: 'skill',
          name: 'firecrawl-agent',
          path: 'skills/core/firecrawl-agent/SKILL.md',
          description: 'Agentic browsing',
        },
      ],
    },
    {
      type: 'dir',
      name: 'Workflows',
      path: 'Workflows',
      children: [
        {
          type: 'skill',
          name: 'batch',
          path: 'skills/Workflows/batch/SKILL.md',
          description: '',
        },
      ],
    },
    { type: 'skill', name: 'Demo', path: 'SKILL.md', description: 'Root skill' },
    {
      type: 'skill',
      name: 'find-skills',
      path: 'skills/find-skills/SKILL.md',
      description: 'Find the right skill',
    },
  ])

  // 被过滤掉的 .automations 不应出现在树的任何一层。
  const names = []
  const walk = (nodes) => {
    for (const node of nodes) {
      names.push(node.name)
      if (node.type === 'dir') walk(node.children)
    }
  }
  walk(result.root)
  assert.equal(names.includes('daily'), false)

  const apiCalls = calls.filter((one) => one.url.startsWith('https://api.github.com/'))
  assert.equal(apiCalls.length, 1)
  assert.equal(apiCalls[0].url, treeUrl('Acme', 'Demo', 'HEAD'))
  assert.equal(apiCalls[0].init.headers.Accept, 'application/vnd.github.v3+json')
  assert.equal(apiCalls[0].init.headers['User-Agent'], 'buka-skills')
  assert.equal(apiCalls[0].init.headers.Authorization, 'Bearer test-token')
  assert.ok(apiCalls[0].init.signal instanceof AbortSignal)

  const rawCalls = calls.filter((one) => one.url.startsWith('https://raw.githubusercontent.com/'))
  assert.deepEqual(rawCalls.map((one) => one.url).sort(), [
    'https://raw.githubusercontent.com/Acme/Demo/HEAD/SKILL.md',
    'https://raw.githubusercontent.com/Acme/Demo/HEAD/skills/Workflows/batch/SKILL.md',
    'https://raw.githubusercontent.com/Acme/Demo/HEAD/skills/core/firecrawl-agent/SKILL.md',
    'https://raw.githubusercontent.com/Acme/Demo/HEAD/skills/find-skills/SKILL.md',
  ])
  assert.equal(rawCalls[0].init.headers.Authorization, 'Bearer test-token')
  assert.ok(rawCalls[0].init.signal instanceof AbortSignal)

  const cache = await readCacheFile(homes)
  assert.equal(repoSkillsCacheFile(homes), path.join(homes.dshHome, 'buka-skills', 'cache', 'repo-skills.json'))
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  const entry = cache.entries[repoKey('Acme/Demo')]
  assert.equal(entry.source, 'Acme/Demo')
  assert.equal(entry.ref, 'HEAD')
  assert.equal(entry.sha, 'tree-sha')
  assert.equal(entry.fetchedAt, now)
  assert.equal(entry.skills, 4)
  assert.deepEqual(entry.root, result.root)
})

test('GitHub 链接与 owner/repo 收敛成同一来源和缓存键', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({ trees: { HEAD: { tree: [], truncated: true } } })

  const first = await fetchRepoSkills({
    homes,
    source: 'https://github.com/Acme/Demo/tree/main',
    fetchImpl,
    now: 1,
  })
  assert.equal(first.ok, true)
  assert.equal(first.source, 'Acme/Demo')
  assert.equal(first.truncated, true)
  assert.equal(calls.length, 1)

  const second = await fetchRepoSkills({ homes, source: 'Acme/Demo', fetchImpl, now: 2 })
  assert.equal(second.cached, true)
  assert.equal(second.fetchedAt, 1)
  assert.equal(second.truncated, true)
  assert.equal(calls.length, 1)
})

test('缓存：TTL 内命中、refresh 强制重拉、过期后重拉', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { sha: 'sha-1', tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }] } },
    contents: { 'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\n' },
  })
  const now = 1_700_000_000_000

  const first = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now })
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  assert.equal(calls.length, 2)

  const second = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 1 })
  assert.equal(second.ok, true)
  assert.equal(second.cached, true)
  assert.equal(second.fetchedAt, first.fetchedAt)
  assert.equal(second.ref, 'HEAD')
  assert.deepEqual(second.root, first.root)
  assert.equal(calls.length, 2, '缓存命中不应再发请求')

  const refreshed = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 2, refresh: true })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.cached, false)
  assert.equal(refreshed.fetchedAt, now + 2)
  assert.equal(calls.length, 4)

  const expired = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 2 + REPO_SKILLS_CACHE_TTL_MS })
  assert.equal(expired.ok, true)
  assert.equal(expired.cached, false)
  assert.equal(calls.length, 6)
})

test('错误码：非法来源、非 GitHub、404、限流与网络失败', async (t) => {
  const { homes } = await tempHomes(t)
  const called = []
  const neverFetch = async (url) => {
    called.push(url)
    throw new Error('network should not be called')
  }

  for (const source of ['', '   ', 42, null, undefined, 'x/'.repeat(200)]) {
    const result = await fetchRepoSkills({ homes, source, fetchImpl: neverFetch })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid-source', String(source))
    assert.equal(typeof result.message, 'string')
  }
  for (const source of ['@scope/pkg', 'notion', 'https://gitlab.com/a/b']) {
    const result = await fetchRepoSkills({ homes, source, fetchImpl: neverFetch })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'unsupported-source', source)
  }
  assert.equal(called.length, 0, '非法/不支持的来源不应该发请求')

  const missing = createFetch({ trees: {} })
  const notFound = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: missing.fetchImpl })
  assert.equal(notFound.ok, false)
  assert.equal(notFound.code, 'repo-not-found')
  assert.deepEqual(
    missing.calls.map((one) => one.url),
    [treeUrl('acme', 'demo', 'HEAD'), treeUrl('acme', 'demo', 'main'), treeUrl('acme', 'demo', 'master')],
  )

  const limited = createFetch({
    trees: { HEAD: { status: 403, headers: { 'x-ratelimit-remaining': '0' } } },
  })
  const rateLimited = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: limited.fetchImpl })
  assert.equal(rateLimited.ok, false)
  assert.equal(rateLimited.code, 'rate-limited')
  assert.equal(limited.calls.length, 1, '限流后不再尝试其它分支')

  const forbidden = createFetch({ trees: { HEAD: { status: 403 } } })
  const forbiddenResult = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: forbidden.fetchImpl })
  assert.equal(forbiddenResult.code, 'fetch-failed')
  assert.equal(forbidden.calls.length, 1)

  const offline = async () => {
    throw new Error('offline')
  }
  const offlineResult = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: offline })
  assert.equal(offlineResult.ok, false)
  assert.equal(offlineResult.code, 'fetch-failed')

  const broken = createFetch({ trees: { HEAD: { status: 500 } } })
  const brokenResult = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: broken.fetchImpl })
  assert.equal(brokenResult.code, 'fetch-failed')
  assert.equal(broken.calls.length, 1, '5xx 后不再尝试其它分支')

  const badJson = createFetch({ trees: { HEAD: { raw: 'not json' } } })
  const badJsonResult = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: badJson.fetchImpl })
  assert.equal(badJsonResult.code, 'fetch-failed')

  const badTree = createFetch({ trees: { HEAD: { sha: 's', tree: 'not-an-array' } } })
  const badTreeResult = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl: badTree.fetchImpl })
  assert.equal(badTreeResult.code, 'fetch-failed')
})

test('分支回退：HEAD 404 时用 main，并返回命中的 ref', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: {
      main: { sha: 'main-sha', tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }] },
    },
    contents: { 'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\n' },
  })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.ref, 'main')
  assert.equal(result.sha, 'main-sha')
  assert.equal(result.cached, false)
  assert.deepEqual(
    calls.filter((one) => one.url.startsWith('https://api.github.com/')).map((one) => one.url),
    [treeUrl('acme', 'demo', 'HEAD'), treeUrl('acme', 'demo', 'main')],
  )
  const raw = calls.find((one) => one.url.startsWith('https://raw.githubusercontent.com/'))
  assert.equal(raw.url, 'https://raw.githubusercontent.com/acme/demo/main/skills/a/SKILL.md')
})

test('缓存损坏或版本不符时当作未命中，拉取成功后重写', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl } = createFetch({
    trees: { HEAD: { sha: 'sha-1', tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }] } },
    contents: { 'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\n' },
  })
  const file = repoSkillsCacheFile(homes)
  const id = repoKey('acme/demo')
  const now = 1_700_000_000_000

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, '{"version":1,"entries":{')

  const first = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now })
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  let cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  assert.equal(cache.entries[id].sha, 'sha-1')

  await fs.writeFile(file, JSON.stringify({ version: 99, entries: {} }))
  const second = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 1 })
  assert.equal(second.ok, true)
  assert.equal(second.cached, false)
  cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  assert.ok(cache.entries[id])

  // 版本对但单条结构不合法：root 不是数组。
  await fs.writeFile(
    file,
    JSON.stringify({
      version: REPO_SKILLS_CACHE_VERSION,
      entries: {
        [id]: { source: 'acme/demo', ref: 'HEAD', sha: 'bad', fetchedAt: now, truncated: false, root: 'oops', skills: 0 },
      },
    }),
  )
  const third = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 2 })
  assert.equal(third.ok, true)
  assert.equal(third.cached, false)
  assert.deepEqual((await readCacheFile(homes)).entries[id].root, third.root)
})

test('没有 SKILL.md 的仓库返回空树，但仍然写缓存', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: {
      HEAD: {
        tree: [
          { type: 'blob', path: 'README.md' },
          { type: 'tree', path: 'src' },
        ],
      },
    },
  })

  const first = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })
  assert.equal(first.ok, true)
  assert.deepEqual(first.root, [])
  assert.equal(first.skills, 0)
  assert.equal(first.cached, false)
  assert.equal(calls.length, 1, '没有 SKILL.md 时只发 tree 请求')

  const cache = await readCacheFile(homes)
  assert.ok(cache.entries[repoKey('acme/demo')])
  assert.deepEqual(cache.entries[repoKey('acme/demo')].root, [])
  assert.equal(cache.entries[repoKey('acme/demo')].skills, 0)

  const second = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })
  assert.equal(second.cached, true)
  assert.equal(calls.length, 1)
})

test('SKILL.md 的并发上限为 6', async (t) => {
  const { homes } = await tempHomes(t)
  const tree = Array.from({ length: 10 }, (_, index) => ({
    type: 'blob',
    path: `skills/s${index}/SKILL.md`,
  }))
  let inFlight = 0
  let maxInFlight = 0
  const fetchImpl = async (url) => {
    if (url.startsWith('https://api.github.com/')) {
      return new Response(JSON.stringify({ sha: 's', tree, truncated: false }), { status: 200 })
    }
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response('---\nname: s\ndescription: d\n---\n', { status: 200 })
    } finally {
      inFlight -= 1
    }
  }

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.skills, 10)
  assert.equal(maxInFlight, 6)
})

test('token：显式参数优先，缺省读环境变量，空串按无 token 处理', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { tree: [] } },
  })
  const savedGithub = process.env.GITHUB_TOKEN
  const savedGh = process.env.GH_TOKEN
  const setEnv = (name, value) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  try {
    await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, token: 'explicit', now: 1 })
    assert.equal(calls[0].init.headers.Authorization, 'Bearer explicit')

    process.env.GITHUB_TOKEN = ''
    process.env.GH_TOKEN = 'gh-env'
    const beforeGh = calls.length
    await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: 2, refresh: true })
    assert.equal(calls[beforeGh].init.headers.Authorization, 'Bearer gh-env')

    process.env.GITHUB_TOKEN = ''
    process.env.GH_TOKEN = ''
    const beforeEmpty = calls.length
    await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: 3, refresh: true })
    assert.equal(calls[beforeEmpty].init.headers.Authorization, undefined)
  } finally {
    setEnv('GITHUB_TOKEN', savedGithub)
    setEnv('GH_TOKEN', savedGh)
  }
})

test('githubRepoOf：只认 GitHub owner/repo 与 github.com 链接', () => {
  assert.deepEqual(githubRepoOf('Acme/Demo'), { owner: 'Acme', repo: 'Demo' })
  assert.deepEqual(githubRepoOf('github.com/Acme/Demo'), { owner: 'Acme', repo: 'Demo' })
  assert.deepEqual(githubRepoOf('https://github.com/Acme/Demo.git'), { owner: 'Acme', repo: 'Demo' })
  assert.deepEqual(githubRepoOf('https://www.github.com/Acme/Demo/tree/main'), { owner: 'Acme', repo: 'Demo' })
  for (const bad of ['@scope/pkg', 'notion', 'https://gitlab.com/a/b', '', null, 42, 'a/b/c']) {
    assert.equal(githubRepoOf(bad), null, String(bad))
  }
})

test('parseFrontmatter 同时解析 name 与 description，旧导出行为不变', () => {
  assert.deepEqual(parseFrontmatter('---\nname: demo\ndescription: >\n  folded\n  text\n---\n'), {
    name: 'demo',
    description: 'folded text',
  })
  assert.deepEqual(parseFrontmatter('---\nname: "quoted name"\n---\n'), { name: 'quoted name', description: '' })
  assert.deepEqual(parseFrontmatter('no frontmatter'), { name: '', description: '' })
  assert.deepEqual(parseFrontmatter(undefined), { name: '', description: '' })
  assert.equal(parseFrontmatterDescription('---\ndescription: inline\n---\n'), 'inline')
})
