/**
 * 「GitHub 仓库 skills 列表」拉取、缓存与建树的单测。
 *
 * 本地绝对路径与任意 git 地址的读取在 `skills-repos-local-git.test.mjs` 单独覆盖；
 * 这里只验证 GitHub 行为不变，以及来源种类变化后的错误码：web / package 仍是
 * `unsupported-source`，git 地址在没有 git 时返回 `git-unavailable`。
 *
 * 全部走注入的 `fetchImpl`，不访问真实网络；缓存目录用临时 DSH home，
 * 每个用例结束清理。重点覆盖：
 *
 * - 与 `npx skills` 一致的发现规则与容器前缀剥离；
 * - 仓库分类顺序：npx skills → Claude Code marketplace → 不可用；
 * - marketplace 清单解析、本地插件分组与远程/非法 source 的跳过；
 * - `probeRepoKind()` 的轻量探测与「不降级完整缓存」；
 * - 目录/skill 的排序与完整仓库路径；
 * - TTL、`refresh`、损坏缓存与 v1 缓存的重建；
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
  probeRepoKind,
  repoSkillsCacheFile,
} from '../plugins/skills/lib/repo-skills.js'
import { repoKey } from '../plugins/skills/lib/repo-store.js'
import { parseFrontmatter, parseFrontmatterDescription } from '../plugins/skills/lib/skill-store.js'

/** GitHub tree API 的 URL，测试里拼断言用。 */
function treeUrl(owner, repo, branch, host = 'api.github.com') {
  return `https://${host}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
}

/** raw.githubusercontent.com 的 URL，测试里拼断言用。 */
function rawUrl(owner, repo, branch, repoPath) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${repoPath}`
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
 * `contents[repoPath]` 是 raw 文件原文（SKILL.md 或 marketplace.json）；
 * 缺失时返回 404，`{ status }` 指定 HTTP 状态码，`{ throw }` 直接抛错。
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
        if (content.throw !== undefined) throw new Error(String(content.throw))
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
  assert.equal(result.kind, 'npx-skills')
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
  assert.equal(entry.kind, 'npx-skills')
  assert.equal(entry.complete, true)
  assert.equal(entry.ref, 'HEAD')
  assert.equal(entry.sha, 'tree-sha')
  assert.equal(entry.fetchedAt, now)
  assert.equal(entry.skills, 4)
  assert.deepEqual(entry.root, result.root)
})

test('GitHub 链接与 owner/repo 收敛成同一来源和缓存键', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }], truncated: true } },
  })

  const first = await fetchRepoSkills({
    homes,
    source: 'https://github.com/Acme/Demo',
    fetchImpl,
    now: 1,
  })
  assert.equal(first.ok, true)
  assert.equal(first.kind, 'npx-skills')
  assert.equal(first.source, 'Acme/Demo')
  assert.equal(first.truncated, true)
  assert.equal(calls.length, 2, '一次 tree + 一次 SKILL.md')

  const second = await fetchRepoSkills({ homes, source: 'Acme/Demo', fetchImpl, now: 2 })
  assert.equal(second.cached, true)
  assert.equal(second.kind, 'npx-skills')
  assert.equal(second.fetchedAt, 1)
  assert.equal(second.truncated, true)
  assert.equal(calls.length, 2)
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
  assert.equal(first.kind, 'npx-skills')
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
  for (const source of ['@scope/pkg', 'notion', 'https://github.com/a/b/tree/main']) {
    const result = await fetchRepoSkills({ homes, source, fetchImpl: neverFetch })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'unsupported-source', source)
  }
  // 非 GitHub 的 git 地址会走 clone：本机没有 git 时返回 git-unavailable，
  // 仍然不碰 fetch。
  const noGit = async () => {
    throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
  }
  const gitMissing = await fetchRepoSkills({
    homes,
    source: 'https://gitlab.com/a/b',
    fetchImpl: neverFetch,
    runGit: noGit,
  })
  assert.equal(gitMissing.ok, false)
  assert.equal(gitMissing.code, 'git-unavailable')
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
  assert.equal(result.kind, 'npx-skills')
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

test('既不是 npx skills 也不是 marketplace 的仓库返回 repo-unavailable，并缓存判定', async (t) => {
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
  assert.equal(first.ok, false)
  assert.equal(first.code, 'repo-unavailable')
  assert.equal(typeof first.message, 'string')
  assert.equal(calls.length, 1, '没有 SKILL.md / marketplace 时只发 tree 请求')

  const cache = await readCacheFile(homes)
  const entry = cache.entries[repoKey('acme/demo')]
  assert.equal(entry.kind, 'unavailable')
  assert.equal(entry.complete, false)
  assert.deepEqual(entry.root, [])
  assert.equal(entry.skills, 0)

  const second = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'repo-unavailable')
  assert.equal(calls.length, 1, '未过期的「不可用」结论不再发请求')
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

test('分类：npx 优先，命中 SKILL.md 时不拉 marketplace.json', async (t) => {
  const { homes } = await tempHomes(t)
  const tree = [
    { type: 'blob', path: 'skills/a/SKILL.md' },
    { type: 'blob', path: '.claude-plugin/marketplace.json' },
  ]
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { tree } },
    contents: {
      'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\n',
      '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'p', source: './plugins/p' }] }),
    },
  })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'npx-skills')
  assert.equal(result.skills, 1)
  assert.equal(calls.length, 2, '只发 tree 与 SKILL.md 两次请求')
  assert.deepEqual(
    calls.filter((one) => one.url.startsWith('https://raw.githubusercontent.com/')).map((one) => one.url),
    [rawUrl('acme', 'demo', 'HEAD', 'skills/a/SKILL.md')],
  )
})

test('Claude Code marketplace：按插件分组列出 SKILL.md（不列 commands / agents）', async (t) => {
  const { homes } = await tempHomes(t)
  const marketplace = {
    name: 'Demo Marketplace',
    metadata: { pluginRoot: 'plugins' },
    plugins: [
      { name: 'alpha', source: 'alpha', description: 'Alpha plugin' },
      { name: 'beta', source: './plugins/beta' },
    ],
  }
  const tree = [
    { type: 'blob', path: '.claude-plugin/marketplace.json' },
    { type: 'blob', path: 'plugins/alpha/skills/x/SKILL.md' },
    { type: 'blob', path: 'plugins/alpha/commands/run.md' },
    { type: 'blob', path: 'plugins/alpha/agents/helper.md' },
    { type: 'blob', path: 'plugins/alpha/README.md' },
    { type: 'blob', path: 'plugins/beta/SKILL.md' },
  ]
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { sha: 'market-sha', tree } },
    contents: {
      '.claude-plugin/marketplace.json': JSON.stringify(marketplace),
      'plugins/alpha/skills/x/SKILL.md': '---\nname: alpha-x\ndescription: X from alpha\n---\n',
      'plugins/beta/SKILL.md': '---\ndescription: Beta root skill\n---\n',
    },
  })
  const now = 1_700_000_000_000

  const result = await fetchRepoSkills({ homes, source: 'Acme/Demo', fetchImpl, now })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.equal(result.skills, 2)
  assert.equal(result.cached, false)
  assert.equal(result.ref, 'HEAD')
  assert.equal(result.sha, 'market-sha')
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
          description: 'X from alpha',
        },
      ],
    },
    {
      type: 'dir',
      name: 'beta',
      path: 'plugins/beta',
      // 插件根 SKILL.md 没有 frontmatter name：回退到插件名。
      children: [{ type: 'skill', name: 'beta', path: 'plugins/beta/SKILL.md', description: 'Beta root skill' }],
    },
  ])

  // 只拉清单和两个 SKILL.md；commands / agents / README 不拉。
  assert.deepEqual(
    calls
      .filter((one) => one.url.startsWith('https://raw.githubusercontent.com/'))
      .map((one) => one.url)
      .sort(),
    [
      rawUrl('Acme', 'Demo', 'HEAD', '.claude-plugin/marketplace.json'),
      rawUrl('Acme', 'Demo', 'HEAD', 'plugins/alpha/skills/x/SKILL.md'),
      rawUrl('Acme', 'Demo', 'HEAD', 'plugins/beta/SKILL.md'),
    ].sort(),
  )

  const entry = (await readCacheFile(homes)).entries[repoKey('Acme/Demo')]
  assert.equal(entry.kind, 'claude-code-marketplace')
  assert.equal(entry.complete, true)
  assert.equal(entry.skills, 2)
  assert.deepEqual(entry.root, result.root)
})

test('marketplace：跳过远程/非法 source，只列仓库内的本地插件', async (t) => {
  const { homes } = await tempHomes(t)
  const marketplace = {
    plugins: [
      { name: 'remote', source: { source: 'github', repo: 'x/y' } },
      { name: 'escape', source: './../escape' },
      { name: 'bare', source: 'bare' },
      { name: 'slash', source: 'plugins/slash' },
      { name: '../bad', source: './plugins/bad' },
      { name: '', source: './plugins/empty-name' },
      { name: 42, source: './plugins/number-name' },
      'not-an-object',
      { name: 'ok', source: './plugins/ok' },
    ],
  }
  const tree = [
    { type: 'blob', path: '.claude-plugin/marketplace.json' },
    { type: 'blob', path: 'plugins/slash/SKILL.md' },
    { type: 'blob', path: 'plugins/bare/SKILL.md' },
    { type: 'blob', path: 'plugins/ok/skills/ok-skill/SKILL.md' },
  ]
  const { fetchImpl } = createFetch({
    trees: { HEAD: { tree } },
    contents: {
      '.claude-plugin/marketplace.json': JSON.stringify(marketplace),
      'plugins/ok/skills/ok-skill/SKILL.md': '---\nname: ok-skill\ndescription: Local skill\n---\n',
    },
  })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.equal(result.skills, 1)
  assert.deepEqual(result.root, [
    {
      type: 'dir',
      name: 'ok',
      path: 'plugins/ok',
      children: [
        {
          type: 'skill',
          name: 'ok-skill',
          path: 'plugins/ok/skills/ok-skill/SKILL.md',
          description: 'Local skill',
        },
      ],
    },
  ])
})

test('marketplace：JSON 非法或结构不对时判定为不可用', async (t) => {
  const { homes } = await tempHomes(t)
  const now = 1_700_000_000_000
  const cases = [
    { repo: 'BadJson', text: 'not json' },
    { repo: 'BadShape', text: JSON.stringify({ plugins: 'nope' }) },
    { repo: 'BadTop', text: JSON.stringify([1, 2]) },
  ]

  for (const one of cases) {
    const { fetchImpl } = createFetch({
      repo: one.repo,
      trees: { HEAD: { tree: [{ type: 'blob', path: '.claude-plugin/marketplace.json' }] } },
      contents: { '.claude-plugin/marketplace.json': one.text },
    })
    const result = await fetchRepoSkills({ homes, source: `Acme/${one.repo}`, fetchImpl, now })
    assert.equal(result.ok, false, one.repo)
    assert.equal(result.code, 'repo-unavailable', one.repo)

    const entry = (await readCacheFile(homes)).entries[repoKey(`Acme/${one.repo}`)]
    assert.equal(entry.kind, 'unavailable', one.repo)
    assert.equal(entry.complete, false, one.repo)
    assert.deepEqual(entry.root, [], one.repo)
  }
})

test('marketplace：清单不合法但有 npx 兜底可发现的 SKILL.md 时按 npx 处理', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl } = createFetch({
    trees: {
      HEAD: {
        tree: [
          { type: 'blob', path: '.claude-plugin/marketplace.json' },
          { type: 'blob', path: 'docs/skill-demo/SKILL.md' },
        ],
      },
    },
    contents: {
      '.claude-plugin/marketplace.json': 'not json',
      'docs/skill-demo/SKILL.md': '---\nname: skill-demo\ndescription: fallback\n---\n',
    },
  })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'npx-skills')
  assert.equal(result.skills, 1)
  assert.deepEqual(result.root, [
    {
      type: 'dir',
      name: 'docs',
      path: 'docs',
      children: [
        {
          type: 'skill',
          name: 'skill-demo',
          path: 'docs/skill-demo/SKILL.md',
          description: 'fallback',
        },
      ],
    },
  ])
})

test('marketplace：清单拉取失败返回 fetch-failed 而不是不可用', async (t) => {
  const { homes } = await tempHomes(t)
  const cases = [
    { repo: 'HttpFail', content: { status: 500 } },
    { repo: 'NetFail', content: { throw: 'offline' } },
  ]

  for (const one of cases) {
    const { fetchImpl } = createFetch({
      repo: one.repo,
      trees: { HEAD: { tree: [{ type: 'blob', path: '.claude-plugin/marketplace.json' }] } },
      contents: { '.claude-plugin/marketplace.json': one.content },
    })
    const result = await fetchRepoSkills({ homes, source: `Acme/${one.repo}`, fetchImpl })
    assert.equal(result.ok, false, one.repo)
    assert.equal(result.code, 'fetch-failed', one.repo)
  }
  assert.equal(await readCacheFile(homes), null, '拉取失败不写缓存')
})

test('marketplace：有效清单但没有任何本地 skill 时返回空树', async (t) => {
  const { homes } = await tempHomes(t)
  const tree = [
    { type: 'blob', path: '.claude-plugin/marketplace.json' },
    { type: 'tree', path: 'plugins/empty' },
  ]
  const { fetchImpl } = createFetch({
    trees: { HEAD: { tree } },
    contents: {
      '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'empty', source: './plugins/empty' }] }),
    },
  })

  const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.deepEqual(result.root, [])
  assert.equal(result.skills, 0)

  const entry = (await readCacheFile(homes)).entries[repoKey('acme/demo')]
  assert.equal(entry.kind, 'claude-code-marketplace')
  assert.equal(entry.complete, true)
  assert.equal(entry.skills, 0)
})

test('probeRepoKind：npx 结论只拉 tree、写轻量缓存，展开时补完整树', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { sha: 'probe-sha', tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }] } },
  })
  const now = 1_700_000_000_000

  const first = await probeRepoKind({ homes, source: 'acme/demo', fetchImpl, now })
  assert.equal(first.ok, true)
  assert.equal(first.kind, 'npx-skills')
  assert.equal(first.skills, 1)
  assert.equal(first.cached, false)
  assert.equal(first.ref, 'HEAD')
  assert.equal(first.sha, 'probe-sha')
  assert.equal(calls.length, 1, '探测不拉 SKILL.md')

  const entry = (await readCacheFile(homes)).entries[repoKey('acme/demo')]
  assert.equal(entry.kind, 'npx-skills')
  assert.equal(entry.complete, false)
  assert.deepEqual(entry.root, [])
  assert.equal(entry.skills, 1)

  const second = await probeRepoKind({ homes, source: 'acme/demo', fetchImpl, now: now + 1 })
  assert.equal(second.ok, true)
  assert.equal(second.cached, true)
  assert.equal(second.kind, 'npx-skills')
  assert.equal(second.skills, 1)
  assert.equal(calls.length, 1, '轻量缓存未过期时不再请求')

  // 展开时命中轻量缓存仍会补拉完整流程，写回 complete: true。
  const expanded = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 2 })
  assert.equal(expanded.ok, true)
  assert.equal(expanded.cached, false)
  assert.equal(expanded.skills, 1)
  const rewritten = (await readCacheFile(homes)).entries[repoKey('acme/demo')]
  assert.equal(rewritten.complete, true)
  assert.equal(rewritten.kind, 'npx-skills')
  assert.equal(rewritten.root.length, 1)
})

test('probeRepoKind：marketplace 结论只拉 tree 与 marketplace.json', async (t) => {
  const { homes } = await tempHomes(t)
  const tree = [
    { type: 'blob', path: '.claude-plugin/marketplace.json' },
    { type: 'blob', path: 'plugins/p/skills/x/SKILL.md' },
  ]
  const { fetchImpl, calls } = createFetch({
    repo: 'Market',
    trees: { HEAD: { tree } },
    contents: {
      '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'p', source: './plugins/p' }] }),
      'plugins/p/skills/x/SKILL.md': '---\nname: x\ndescription: X\n---\n',
    },
  })

  const result = await probeRepoKind({ homes, source: 'Acme/Market', fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'claude-code-marketplace')
  assert.equal(result.skills, 1)
  assert.equal(result.cached, false)
  assert.deepEqual(
    calls.filter((one) => one.url.startsWith('https://raw.githubusercontent.com/')).map((one) => one.url),
    [rawUrl('Acme', 'Market', 'HEAD', '.claude-plugin/marketplace.json')],
  )

  const entry = (await readCacheFile(homes)).entries[repoKey('Acme/Market')]
  assert.equal(entry.kind, 'claude-code-marketplace')
  assert.equal(entry.complete, false)
  assert.deepEqual(entry.root, [])
})

test('probeRepoKind：不可用结论也会缓存，第二次不再发请求', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    repo: 'Empty',
    trees: { HEAD: { tree: [{ type: 'blob', path: 'README.md' }] } },
  })

  const first = await probeRepoKind({ homes, source: 'Acme/Empty', fetchImpl })
  assert.equal(first.ok, false)
  assert.equal(first.code, 'repo-unavailable')
  assert.equal(typeof first.message, 'string')
  assert.equal(calls.length, 1)

  const entry = (await readCacheFile(homes)).entries[repoKey('Acme/Empty')]
  assert.equal(entry.kind, 'unavailable')
  assert.equal(entry.complete, false)
  assert.equal(entry.skills, 0)

  const second = await probeRepoKind({ homes, source: 'Acme/Empty', fetchImpl })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'repo-unavailable')
  assert.equal(calls.length, 1)
})

test('probeRepoKind：命中完整缓存返回 kind，刷新探测不降级完整树', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl, calls } = createFetch({
    trees: { HEAD: { tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }] } },
    contents: { 'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\n' },
  })
  const now = 1_700_000_000_000

  const full = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now })
  assert.equal(full.ok, true)
  const fullCalls = calls.length

  const cachedProbe = await probeRepoKind({ homes, source: 'acme/demo', fetchImpl, now: now + 1 })
  assert.equal(cachedProbe.ok, true)
  assert.equal(cachedProbe.cached, true)
  assert.equal(cachedProbe.kind, 'npx-skills')
  assert.equal(cachedProbe.skills, 1)
  assert.equal(calls.length, fullCalls, '完整缓存命中不请求')

  const refreshed = await probeRepoKind({ homes, source: 'acme/demo', fetchImpl, now: now + 2, refresh: true })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.cached, false)
  assert.equal(refreshed.kind, 'npx-skills')
  assert.equal(calls.length, fullCalls + 1, '探测刷新只多拉一次 tree')

  const entry = (await readCacheFile(homes)).entries[repoKey('acme/demo')]
  assert.equal(entry.complete, true)
  assert.equal(entry.kind, 'npx-skills')
  assert.deepEqual(entry.root, full.root)
})

test('probeRepoKind：非法/非 GitHub 来源直接失败且不发请求', async (t) => {
  const { homes } = await tempHomes(t)
  const called = []
  const neverFetch = async (url) => {
    called.push(url)
    throw new Error('network should not be called')
  }

  for (const source of ['', '   ', 42, null]) {
    const result = await probeRepoKind({ homes, source, fetchImpl: neverFetch })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid-source', String(source))
  }
  for (const source of ['@scope/pkg', 'notion', 'https://github.com/a/b/tree/main']) {
    const result = await probeRepoKind({ homes, source, fetchImpl: neverFetch })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'unsupported-source', source)
  }
  const noGit = async () => {
    throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
  }
  const gitMissing = await probeRepoKind({
    homes,
    source: 'https://gitlab.com/a/b',
    fetchImpl: neverFetch,
    runGit: noGit,
  })
  assert.equal(gitMissing.ok, false)
  assert.equal(gitMissing.code, 'git-unavailable')
  assert.equal(called.length, 0)
})

test('缓存版本不匹配：旧版本被丢弃，kind 非法或缺失 complete 的条目按未命中处理', async (t) => {
  const { homes } = await tempHomes(t)
  const { fetchImpl } = createFetch({
    trees: { HEAD: { tree: [{ type: 'blob', path: 'skills/a/SKILL.md' }] } },
    contents: { 'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\n' },
  })
  const file = repoSkillsCacheFile(homes)
  const id = repoKey('acme/demo')
  const now = 1_700_000_000_000
  const oldRoot = [{ type: 'skill', name: 'old', path: 'skills/old/SKILL.md', description: '' }]

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 1,
      entries: {
        [id]: {
          source: 'Acme/Demo',
          ref: 'HEAD',
          sha: 'v1-sha',
          fetchedAt: now,
          truncated: false,
          skills: 1,
          root: oldRoot,
        },
      },
    }),
  )
  const first = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now })
  assert.equal(first.ok, true)
  assert.equal(first.cached, false, 'v1 缓存整份丢弃')
  let cache = await readCacheFile(homes)
  assert.equal(cache.version, REPO_SKILLS_CACHE_VERSION)
  assert.equal(cache.entries[id].complete, true)
  assert.equal(cache.entries[id].kind, 'npx-skills')

  const base = {
    source: 'Acme/Demo',
    kind: 'npx-skills',
    ref: 'HEAD',
    sha: 'v2-sha',
    fetchedAt: now + 10,
    truncated: false,
    skills: 1,
    complete: true,
    root: oldRoot,
  }
  const withoutComplete = { ...base }
  delete withoutComplete.complete
  const invalidEntries = [
    ['kind 非法', { ...base, kind: 'bogus-kind' }],
    ['complete 缺失', withoutComplete],
  ]
  for (const [label, entry] of invalidEntries) {
    await fs.writeFile(file, JSON.stringify({ version: REPO_SKILLS_CACHE_VERSION, entries: { [id]: entry } }))
    const result = await fetchRepoSkills({ homes, source: 'acme/demo', fetchImpl, now: now + 20 })
    assert.equal(result.ok, true, label)
    assert.equal(result.cached, false, label)
    assert.equal(result.kind, 'npx-skills', label)
  }

  cache = await readCacheFile(homes)
  assert.equal(cache.entries[id].complete, true)
  assert.notDeepEqual(cache.entries[id].root, oldRoot)
})
