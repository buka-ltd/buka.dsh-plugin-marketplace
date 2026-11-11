import assert from 'node:assert/strict'
import test from 'node:test'

import { MarketIndexError, marketInstallTarget, parseMarketIndex } from '../scripts/lib/format.ts'

const INDEX_URL = 'https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json'

function baseIndex() {
  return {
    format: 1,
    title: { en: 'Buka DSH Plugins', 'zh-cn': 'Buka DSH 插件市场' },
    metadata: {
      categories: { tools: { title: { en: 'Tools' } } },
      labels: { stable: { title: { en: 'Stable' } } },
    },
    plugins: [
      {
        name: '@buka/dsh-plugin-hello',
        title: { en: 'Buka Hello' },
        icon: './icons/hello.svg',
        author: 'Buka Ltd',
        homepage: 'https://github.com/buka-ltd/buka.dsh-plugin-marketplace#readme',
        repository: {
          url: 'https://github.com/buka-ltd/buka.dsh-plugin-marketplace',
          directory: 'plugins/hello',
        },
        metadata: { category: 'tools', labels: ['stable'], keywords: ['hello'], sortKeys: {} },
        versions: [
          {
            version: '0.1.0',
            publishTimestamp: 1_793_000_000,
            source: {
              type: 'git',
              url: 'https://github.com/buka-ltd/buka.dsh-plugin-marketplace',
              commit: 'a'.repeat(40),
              path: 'plugins/hello',
            },
            engines: { dsh: '>=0.2.1-rc.5 <0.3.0' },
          },
        ],
      },
    ],
  }
}

function expectError(mutate, path) {
  const index = baseIndex()
  mutate(index)
  assert.throws(
    () => parseMarketIndex(index, INDEX_URL),
    (error) => {
      assert.ok(error instanceof MarketIndexError)
      assert.equal(error.path, path)
      return true
    },
  )
}

test('接受一份完整索引，并补空缺失组', () => {
  const parsed = parseMarketIndex(baseIndex(), INDEX_URL)
  assert.equal(parsed.format, 1)
  assert.equal(parsed.plugins.length, 1)
  assert.equal(
    parsed.plugins[0].icon,
    'https://buka-ltd.github.io/buka.dsh-plugin-marketplace/icons/hello.svg',
  )
  assert.equal(parsed.plugins[0].metadata.keywords[0], 'hello')

  const sparse = parseMarketIndex({ format: 1, title: 'T', plugins: [] }, INDEX_URL)
  assert.deepEqual(sparse.metadata, { categories: {}, labels: {}, sortKeys: {} })
})

test('拒绝不满足 format 1 的索引', () => {
  expectError((index) => {
    index.format = 2
  }, '$.format')
  expectError((index) => {
    delete index.title
  }, '$.title')
  expectError((index) => {
    index.title = { 'zh-cn': '没有英文' }
  }, '$.title')
  expectError((index) => {
    index.title = { 'zh-CN': '大写语言 id' }
  }, '$.title.zh-CN')
  expectError((index) => {
    index.plugins[0].name = 'Hello'
  }, '$.plugins[0].name')
  expectError((index) => {
    index.plugins.push(structuredClone(index.plugins[0]))
  }, '$.plugins[1].name')
  expectError((index) => {
    index.plugins[0].metadata.category = 'undeclared'
  }, '$.plugins[0].metadata.category')
  expectError((index) => {
    index.plugins[0].metadata.labels = ['stable', 'stable']
  }, '$.plugins[0].metadata.labels')
  expectError((index) => {
    index.plugins[0].metadata.labels = ['missing']
  }, '$.plugins[0].metadata.labels[0]')
})

test('拒绝不满足规则的版本记录', () => {
  expectError((index) => {
    index.plugins[0].versions = []
  }, '$.plugins[0].versions')
  expectError((index) => {
    index.plugins[0].versions[0].version = '0.1'
  }, '$.plugins[0].versions[0].version')
  expectError((index) => {
    index.plugins[0].versions[0].publishTimestamp = 1.5
  }, '$.plugins[0].versions[0].publishTimestamp')
  expectError((index) => {
    index.plugins[0].versions[0].source.commit = 'A'.repeat(40)
  }, '$.plugins[0].versions[0].source.commit')
  expectError((index) => {
    index.plugins[0].versions[0].source.url = 'https://github.com/buka-ltd/repo/'
  }, '$.plugins[0].versions[0].source.url')
  expectError((index) => {
    index.plugins[0].versions[0].source.path = '../escape'
  }, '$.plugins[0].versions[0].source.path')
  expectError((index) => {
    index.plugins[0].versions[0].engines.dsh = 'workspace:*'
  }, '$.plugins[0].versions[0].engines.dsh')
  expectError((index) => {
    index.plugins[0].versions[0].engines.dsh = 'latest'
  }, '$.plugins[0].versions[0].engines.dsh')
  expectError((index) => {
    index.plugins[0].versions.push(structuredClone(index.plugins[0].versions[0]))
  }, '$.plugins[0].versions[1].version')
})

test('图标：同源相对地址、https 与 inline data URL', () => {
  const parsed = parseMarketIndex(baseIndex(), INDEX_URL)
  assert.ok(parsed.plugins[0].icon.startsWith('https://buka-ltd.github.io/'))

  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
  const inline = baseIndex()
  inline.plugins[0].icon = `data:image/png;base64,${png}`
  assert.equal(parseMarketIndex(inline, INDEX_URL).plugins[0].icon, inline.plugins[0].icon)

  expectError((index) => {
    index.plugins[0].icon = 'http://example.com/icon.svg'
  }, '$.plugins[0].icon')
  expectError((index) => {
    index.plugins[0].icon = `data:image/gif;base64,${png}`
  }, '$.plugins[0].icon')
  expectError((index) => {
    index.plugins[0].icon = `data:image/png;base64,${'A'.repeat(44_000)}`
  }, '$.plugins[0].icon')
})

test('安装目标：npm 与钉住 commit 的 git', () => {
  const index = parseMarketIndex(baseIndex(), INDEX_URL)
  const gitTarget = marketInstallTarget(index.plugins[0].name, index.plugins[0].versions[0])
  assert.deepEqual(gitTarget, {
    spec: `git+https://github.com/buka-ltd/buka.dsh-plugin-marketplace.git#${'a'.repeat(40)}&path:/plugins/hello`,
  })

  const npm = baseIndex()
  npm.plugins[0].versions[0].source = { type: 'npm', registry: 'https://registry.npmmirror.com' }
  const parsed = parseMarketIndex(npm, INDEX_URL)
  assert.deepEqual(marketInstallTarget(parsed.plugins[0].name, parsed.plugins[0].versions[0]), {
    spec: '@buka/dsh-plugin-hello@0.1.0',
    registry: 'https://registry.npmmirror.com/',
  })
})

test('版本按降序返回', () => {
  const index = baseIndex()
  index.plugins[0].versions.push(
    { ...structuredClone(index.plugins[0].versions[0]), version: '0.2.0' },
    { ...structuredClone(index.plugins[0].versions[0]), version: '0.10.0-rc.1' },
  )
  const parsed = parseMarketIndex(index, INDEX_URL)
  assert.deepEqual(
    parsed.plugins[0].versions.map((version) => version.version),
    ['0.10.0-rc.1', '0.2.0', '0.1.0'],
  )
})
