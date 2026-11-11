#!/usr/bin/env node
/**
 * 生成 `dist/index.json`（以及图标），供逐字节发布到静态托管。
 * 用法：pnpm run build [--out dist] [--source-url https://github.com/org/repo]
 */

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { loadMarket, sourceUrlFromEnvironment } from './lib/market.ts'
import { formatProblems, reportProblems } from './lib/report.ts'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist' },
    'source-url': { type: 'string' },
  },
  allowPositionals: false,
})

const outDir = path.resolve(values.out)
const market = loadMarket({ sourceUrl: values['source-url'] ?? sourceUrlFromEnvironment() })
reportProblems(market.problems)

if (market.problems.some((problem) => problem.level === 'error')) {
  console.error(`\n索引未生成：${formatProblems(market.problems).errors} 个错误待修`)
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const asset of market.assets) {
  cpSync(asset.from, path.join(outDir, asset.to))
}
writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(market.index, null, 2)}\n`)

const outFile = path.join(outDir, 'index.json')
const relative = path.relative(process.cwd(), outFile)
const listed = market.index.plugins
console.log(`\n索引 ${relative.startsWith('..') ? outFile : relative}：${listed.length} 个插件`)
for (const entry of listed) {
  const version = entry.versions[0]
  if (version === undefined) continue
  const source = version.source
  const pinned =
    source.type === 'npm' ? `${entry.name}@${version.version}` : `git ${source.commit.slice(0, 7)}`
  console.log(`  ${entry.name.padEnd(34)} ${version.version.padEnd(10)} ${pinned}`)
}
console.log(`\n索引地址（写进 Discover）：${market.indexUrl}`)
console.log('本地预览：pnpm run serve')
