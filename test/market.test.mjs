import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { marketInstallTarget, parseMarketIndex } from '../scripts/lib/format.mjs'
import { loadMarket, normalizeRemote } from '../scripts/lib/market.mjs'

const PUBLIC_URL = 'https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json'

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
  writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
}

function writeBundle(root, directory, manifest, market) {
  writeFile(root, `plugins/${directory}/package.json`, manifest)
  writeFile(root, `plugins/${directory}/cordis.patch.yml`, `- insert:\n    - id: ${directory}\n      name: '${manifest.name}'\n`)
  writeFile(root, `plugins/${directory}/lib/index.js`, 'export const name = "fixture"\n')
  writeFile(root, `plugins/${directory}/icon.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
  if (market !== undefined) writeFile(root, `plugins/${directory}/market.json`, market)
}

/**
 * 造一个最小仓库：hello（挂牌）+ secret（默认未挂牌）。
 * @param {{ secretListed?: boolean }} [options]
 */
function makeRepo(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-market-'))
  writeFile(root, 'market.json', ROOT_MARKET)

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
      title: { en: 'Buka Hello' },
      description: { en: 'A minimal bundle' },
      icon: './icon.svg',
      category: 'tools',
      labels: ['stable'],
      keywords: ['hello'],
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
    options.secretListed === true ? { title: { en: 'Secret' }, listed: true } : { listed: false },
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
  assert.equal(entry.metadata.category, 'tools')
  assert.deepEqual(entry.metadata.labels, ['stable'])
  assert.equal(entry.icon, 'icons/hello.svg')
  assert.deepEqual(entry.repository, { url: 'https://github.com/buka-ltd/demo', directory: 'plugins/hello' })
  assert.deepEqual(market.assets.map((asset) => asset.to), ['icons/hello.svg'])

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

test('缺少 market.json 与包名不符都是错误，不会被静默跳过', (t) => {
  const root = makeRepo()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  rmSync(path.join(root, 'plugins/secret/market.json'))
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'chore: 去掉 secret 的挂牌信息'])
  let messages = loadMarket({ root })
    .problems.filter((problem) => problem.level === 'error')
    .map((problem) => problem.message)
  assert.ok(messages.some((message) => message.includes('缺少 market.json')), messages.join('\n'))

  writeFile(root, 'plugins/secret/market.json', { title: { en: 'Secret' }, listed: true })
  writeFile(root, 'plugins/secret/package.json', { name: 'wrong-name', version: '0.0.1', dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } })
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'chore: 改错包名'])
  messages = loadMarket({ root })
    .problems.filter((problem) => problem.level === 'error')
    .map((problem) => problem.message)
  assert.ok(messages.some((message) => message.includes('@buka/dsh-plugin-secret')), messages.join('\n'))
})

test('origin 的常见写法归一成 https 仓库地址', () => {
  assert.equal(normalizeRemote('git@github.com:buka-ltd/demo.git'), 'https://github.com/buka-ltd/demo')
  assert.equal(normalizeRemote('ssh://git@github.com/buka-ltd/demo.git'), 'https://github.com/buka-ltd/demo')
  assert.equal(normalizeRemote('https://github.com/buka-ltd/demo.git'), 'https://github.com/buka-ltd/demo')
  assert.equal(normalizeRemote('https://github.com/buka-ltd/demo'), 'https://github.com/buka-ltd/demo')
  assert.throws(() => normalizeRemote('file:///tmp/demo'), /--source-url/u)
})
