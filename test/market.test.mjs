import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { marketInstallTarget, parseMarketIndex } from '../scripts/lib/format.ts'
import { loadMarket, normalizeRemote, sourceUrlFromEnvironment } from '../scripts/lib/market.ts'

const PUBLIC_URL = 'https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json'
const BUILD_SCRIPT = fileURLToPath(new URL('../scripts/build.ts', import.meta.url))
const CHECK_SCRIPT = fileURLToPath(new URL('../scripts/check.ts', import.meta.url))

const ROOT_MARKET = {
  title: { en: 'Buka DSH Plugins', 'zh-cn': 'Buka DSH 插件市场' },
  description: { en: 'Plugins by Buka Ltd' },
  publicUrl: PUBLIC_URL,
  packageScope: '@buka',
  packagePrefix: 'dsh-plugin-',
  metadata: {
    categories: { tools: { title: { en: 'Tools', 'zh-cn': '工具' } } },
    labels: { stable: { title: { en: 'Stable', 'zh-cn': '稳定' } } },
  },
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
}

function writeFile(root, file, content) {
  const full = path.join(root, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(
    full,
    typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
  )
}

/** 在 fixture 仓库里跑真实脚本；env 里的 undefined 表示清掉该变量。 */
function runNode(root, script, args = [], env = {}) {
  const childEnv = { ...process.env, ...env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key]
  }
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: childEnv,
    // stderr 由调用方从 error.stderr 里读，不直接漏进测试输出
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function writeBundle(root, directory, manifest, market, locale) {
  writeFile(root, `plugins/${directory}/package.json`, manifest)
  writeFile(
    root,
    `plugins/${directory}/cordis.patch.yml`,
    `- insert:\n    - id: ${directory}\n      name: '${manifest.name}'\n`,
  )
  writeFile(root, `plugins/${directory}/lib/index.js`, 'export const name = "fixture"\n')
  writeFile(root, `plugins/${directory}/icon.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
  if (market !== undefined) writeFile(root, `plugins/${directory}/market.json`, market)
  for (const [language, meta] of Object.entries(locale ?? {})) {
    writeFile(root, `plugins/${directory}/locale/${language}.json`, { meta })
  }
}

/**
 * 造一个最小仓库：hello（挂牌）+ secret（默认未挂牌）。
 * @param {{ secretListed?: boolean }} [options]
 */
function makeRepo(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-market-'))
  writeFile(root, 'market.json', ROOT_MARKET)
  writeFile(root, 'schemas/index.schema.json', {})

  writeBundle(
    root,
    'hello',
    {
      name: '@buka/dsh-plugin-hello',
      version: '0.1.0',
      type: 'module',
      main: 'lib/index.js',
      files: ['lib/index.js', 'cordis.patch.yml'],
      engines: { node: '>=22.20', dsh: '>=0.2.1-rc.5 <0.3.0' },
      peerDependencies: { '@deepseek-ai/cordis': '~4.0.5' },
      dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
    },
    {
      icon: './icon.svg',
      category: 'tools',
      labels: ['stable'],
      keywords: ['hello'],
    },
    {
      en: { title: 'Buka Hello', description: 'A minimal bundle' },
      zh: { title: 'Buka 问候', description: '一个最小的 bundle' },
    },
  )

  writeBundle(
    root,
    'secret',
    {
      name: '@buka/dsh-plugin-secret',
      version: '0.0.1',
      main: 'lib/index.js',
      files: ['lib/index.js', 'cordis.patch.yml'],
      engines: { dsh: '>=0.2.1-rc.5 <0.3.0' },
      dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
    },
    options.secretListed === true ? { listed: true } : { listed: false },
    // 文案唯一来源是 locale，未挂牌的插件也要有：装好后插件页一样要显示它。
    {
      en: { title: 'Secret', description: 'A secret bundle' },
      zh: { title: 'Secret', description: '一个未挂牌的 bundle' },
    },
  )

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['remote', 'add', 'origin', 'git@github.com:buka-ltd/demo.git'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'feat: 初始插件'])
  return root
}

test('从插件目录生成索引，并钉住该目录的提交', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const market = loadMarket({ root })
  assert.deepEqual(
    market.problems.filter((problem) => problem.level === 'error'),
    [],
  )
  assert.equal(market.sourceUrl, 'https://github.com/buka-ltd/demo')
  assert.equal(market.index.plugins.length, 1)

  const entry = market.index.plugins[0]
  assert.equal(entry.name, '@buka/dsh-plugin-hello')
  assert.deepEqual(entry.title, { en: 'Buka Hello', 'zh-cn': 'Buka 问候' })
  assert.deepEqual(entry.description, { en: 'A minimal bundle', 'zh-cn': '一个最小的 bundle' })
  assert.equal(entry.metadata.category, 'tools')
  assert.deepEqual(entry.metadata.labels, ['stable'])
  assert.equal(entry.icon, 'icons/hello.svg')
  assert.deepEqual(entry.repository, {
    url: 'https://github.com/buka-ltd/demo',
    directory: 'plugins/hello',
  })
  assert.deepEqual(
    market.assets.map((asset) => asset.to),
    ['icons/hello.svg'],
  )

  const version = entry.versions[0]
  assert.equal(version.version, '0.1.0')
  assert.equal(version.source.type, 'git')
  assert.match(version.source.commit, /^[0-9a-f]{40}$/u)
  assert.equal(version.source.path, 'plugins/hello')
  assert.ok(Number.isInteger(version.publishTimestamp))

  const parsed = parseMarketIndex(market.index, market.indexUrl)
  assert.deepEqual(marketInstallTarget(parsed.plugins[0].name, parsed.plugins[0].versions[0]), {
    spec: `git+https://github.com/buka-ltd/demo.git#${version.source.commit}&path:/plugins/hello`,
  })
})

test('生成器只认显式 sourceUrl，环境变量留给命令行入口', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const previous = process.env.DSH_MARKET_SOURCE_URL
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_MARKET_SOURCE_URL
    else process.env.DSH_MARKET_SOURCE_URL = previous
  })

  delete process.env.DSH_MARKET_SOURCE_URL
  assert.equal(sourceUrlFromEnvironment(), undefined)
  process.env.DSH_MARKET_SOURCE_URL = ''
  assert.equal(sourceUrlFromEnvironment(), undefined)

  // 回归：CI 把 DSH_MARKET_SOURCE_URL 设在 job 级别时，单测不能再被它污染
  process.env.DSH_MARKET_SOURCE_URL = 'https://github.com/buka-ltd/mirror'
  assert.equal(sourceUrlFromEnvironment(), 'https://github.com/buka-ltd/mirror')
  assert.equal(loadMarket({ root }).sourceUrl, 'https://github.com/buka-ltd/demo')
  assert.equal(
    loadMarket({ root, sourceUrl: 'https://github.com/buka-ltd/override' }).sourceUrl,
    'https://github.com/buka-ltd/override',
  )
})

test('build 用 DSH_MARKET_SOURCE_URL 固定安装来源', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const out = mkdtempSync(path.join(tmpdir(), 'dsh-market-out-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  runNode(root, BUILD_SCRIPT, ['--out', out], {
    DSH_MARKET_SOURCE_URL: 'https://github.com/buka-ltd/mirror',
  })
  const pinned = JSON.parse(readFileSync(path.join(out, 'index.json'), 'utf8'))
  assert.equal(pinned.plugins[0].versions[0].source.url, 'https://github.com/buka-ltd/mirror')
  assert.equal(pinned.plugins[0].repository.url, 'https://github.com/buka-ltd/mirror')

  const fallback = mkdtempSync(path.join(tmpdir(), 'dsh-market-out-'))
  t.after(() => rmSync(fallback, { recursive: true, force: true }))
  runNode(root, BUILD_SCRIPT, ['--out', fallback], { DSH_MARKET_SOURCE_URL: undefined })
  const derived = JSON.parse(readFileSync(path.join(fallback, 'index.json'), 'utf8'))
  assert.equal(derived.plugins[0].versions[0].source.url, 'https://github.com/buka-ltd/demo')
})

test('check 把 DSH_MARKET_SOURCE_URL 交给生成器', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  runNode(root, CHECK_SCRIPT, [], { DSH_MARKET_SOURCE_URL: 'https://github.com/buka-ltd/mirror' })

  // 非法地址只能由这条环境变量带进来；入口漏读时这里不会报错
  let stderr = ''
  try {
    runNode(root, CHECK_SCRIPT, [], { DSH_MARKET_SOURCE_URL: 'file:///tmp/fork' })
  } catch (error) {
    stderr = String(error.stderr)
  }
  assert.match(stderr, /--source-url 必须是 https 仓库地址/u)
})

test('listed: false 默认不进索引，改成 true 才挂牌', (t) => {
  const unlisted = makeRepo()
  t.after(() => rmSync(unlisted, { recursive: true, force: true }))
  assert.deepEqual(
    loadMarket({ root: unlisted }).index.plugins.map((entry) => entry.name),
    ['@buka/dsh-plugin-hello'],
  )

  const listed = makeRepo({ secretListed: true })
  t.after(() => rmSync(listed, { recursive: true, force: true }))
  const market = loadMarket({ root: listed })
  assert.deepEqual(
    market.index.plugins.map((entry) => entry.name),
    ['@buka/dsh-plugin-hello', '@buka/dsh-plugin-secret'],
  )
})

test('标题与简介从 locale 的 meta 生成，market.json 只留挂牌字段', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const marketInfo = JSON.parse(readFileSync(path.join(root, 'plugins/hello/market.json'), 'utf8'))
  assert.equal(Object.hasOwn(marketInfo, 'title'), false)
  assert.equal(Object.hasOwn(marketInfo, 'description'), false)

  writeFile(root, 'plugins/hello/locale/en.json', {
    meta: { title: 'Hello from locale', description: 'Locale description' },
  })
  writeFile(root, 'plugins/hello/locale/zh.json', {
    meta: { title: '来自 locale 的标题' },
  })

  const entry = loadMarket({ root }).index.plugins[0]
  assert.deepEqual(entry.title, { en: 'Hello from locale', 'zh-cn': '来自 locale 的标题' })
  assert.deepEqual(entry.description, { en: 'Locale description' })

  // market.json 里残留旧的 title/description 不再参与生成，只提醒迁移
  writeFile(root, 'plugins/hello/market.json', {
    title: { en: 'Stale title' },
    description: { en: 'Stale description' },
    icon: './icon.svg',
    category: 'tools',
    labels: ['stable'],
    keywords: ['hello'],
  })
  const moved = loadMarket({ root })
  assert.deepEqual(moved.index.plugins[0].title, {
    en: 'Hello from locale',
    'zh-cn': '来自 locale 的标题',
  })
  assert.ok(
    moved.problems.some((problem) => problem.message.includes('title/description 已废弃')),
    moved.problems.map((problem) => problem.message).join('\n'),
  )
})

test('locale 缺 en 文案是错误，不会悄悄回退成包名', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const errors = () =>
    loadMarket({ root })
      .problems.filter((problem) => problem.level === 'error')
      .map((problem) => problem.message)

  rmSync(path.join(root, 'plugins/hello/locale'), { recursive: true, force: true })
  assert.ok(
    errors().some((message) => message.includes('缺少 locale/en.json')),
    errors().join('\n'),
  )

  writeFile(root, 'plugins/hello/locale/en.json', { meta: { title: 'Only a title' } })
  assert.ok(
    errors().some((message) => message.includes('locale/en.json 缺少 meta.description')),
    errors().join('\n'),
  )
})

test('缺少 market.json 与包名不符都是错误，不会被静默跳过', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  rmSync(path.join(root, 'plugins/secret/market.json'))
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'chore: 去掉 secret 的挂牌信息'])
  let messages = loadMarket({ root })
    .problems.filter((problem) => problem.level === 'error')
    .map((problem) => problem.message)
  assert.ok(
    messages.some((message) => message.includes('缺少 market.json')),
    messages.join('\n'),
  )

  writeFile(root, 'plugins/secret/market.json', { listed: true })
  writeFile(root, 'plugins/secret/locale/en.json', {
    meta: { title: 'Secret', description: 'A secret bundle' },
  })
  writeFile(root, 'plugins/secret/package.json', {
    name: 'wrong-name',
    version: '0.0.1',
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
  })
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'chore: 改错包名'])
  messages = loadMarket({ root })
    .problems.filter((problem) => problem.level === 'error')
    .map((problem) => problem.message)
  assert.ok(
    messages.some((message) => message.includes('@buka/dsh-plugin-secret')),
    messages.join('\n'),
  )
})

test('origin 的常见写法归一成 https 仓库地址', () => {
  assert.equal(
    normalizeRemote('git@github.com:buka-ltd/demo.git'),
    'https://github.com/buka-ltd/demo',
  )
  assert.equal(
    normalizeRemote('ssh://git@github.com/buka-ltd/demo.git'),
    'https://github.com/buka-ltd/demo',
  )
  assert.equal(
    normalizeRemote('https://github.com/buka-ltd/demo.git'),
    'https://github.com/buka-ltd/demo',
  )
  assert.equal(
    normalizeRemote('https://github.com/buka-ltd/demo'),
    'https://github.com/buka-ltd/demo',
  )
  assert.throws(() => normalizeRemote('file:///tmp/demo'), /--source-url/u)
})
