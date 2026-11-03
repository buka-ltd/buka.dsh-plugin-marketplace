#!/usr/bin/env node
/**
 * 用 DSH 自带的官方校验器复核一份索引（可选，发布前跑一次更安心）。
 *
 * 官方包 `@deepseek-ai/dsh-plugin-market-index` 在 DSH 安装目录的 app.asar 里，
 * 只有 Electron 的 node 能读 asar，所以要这样调用：
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     --expose-internals scripts/official-check.mjs dist/index.json
 *
 * 索引地址默认取根 market.json 的 publicUrl；也可作为第二个参数传入。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_APP = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const OFFICIAL_PACKAGE =
  process.env.DSH_MARKET_INDEX_PACKAGE ??
  path.join(process.env.DSH_APP_ASAR ?? DEFAULT_APP, 'dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js')

const [, , file, explicitUrl] = process.argv
if (file === undefined) {
  console.error('用法：official-check.mjs <index.json> [indexUrl]')
  console.error('需要以 Electron 的 node 运行，见文件顶部的调用示例')
  process.exit(2)
}

let official
try {
  official = await import(OFFICIAL_PACKAGE)
} catch (error) {
  console.error(`读不到官方校验器：${OFFICIAL_PACKAGE}`)
  console.error('确认 DSH 装在默认位置，或用 DSH_APP_ASAR / DSH_MARKET_INDEX_PACKAGE 指定路径')
  console.error(String(error.message))
  process.exit(2)
}

const indexUrl = explicitUrl ?? JSON.parse(readFileSync('market.json', 'utf8')).publicUrl
const raw = JSON.parse(readFileSync(file, 'utf8'))
const parsed = official.parseMarketIndex(raw, indexUrl)

console.log(`官方校验通过：${parsed.plugins.length} 个插件，索引地址 ${indexUrl}`)
for (const plugin of parsed.plugins) {
  for (const version of plugin.versions) {
    const target = official.marketInstallTarget(plugin.name, version)
    console.log(`  ${plugin.name}@${version.version}`)
    console.log(`    ${target.spec}${target.registry === undefined ? '' : ` (registry: ${target.registry})`}`)
  }
}
