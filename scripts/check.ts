#!/usr/bin/env node
/**
 * 发布前自检：索引能生成、能被 format 1 接受、钉住的 commit 真的含这些文件。
 * CI 与本地都跑这一条。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { MarketIndex } from './lib/format.ts'
import { MAX_INLINE_ICON_BYTES, parseMarketIndex } from './lib/format.ts'
import type { PluginSummary } from './lib/market.ts'
import { loadMarket, readJson, sourceUrlFromEnvironment } from './lib/market.ts'
import type { MarketProblem } from './lib/report.ts'
import { reportProblems } from './lib/report.ts'

const ROOT_MARKET_KEYS = new Set([
  'title',
  'description',
  'publicUrl',
  'packageScope',
  'packagePrefix',
  'metadata',
])
/** 挂牌字段白名单。展示文案不在其中：它只来自 locale，见 ADR 0003。 */
const PLUGIN_MARKET_KEYS = new Set([
  'listed',
  'icon',
  'author',
  'homepage',
  'repository',
  'category',
  'labels',
  'keywords',
  'sortKeys',
])

const REPOSITORY_FILES: Array<[string, Set<string> | null]> = [
  ['market.json', ROOT_MARKET_KEYS],
  [path.join('schemas', 'index.schema.json'), null],
]

const problems: MarketProblem[] = []

function checkRepositoryFiles(root: string): void {
  for (const [file, allowed] of REPOSITORY_FILES) {
    const full = path.join(root, file)
    if (!existsSync(full)) {
      problems.push({ level: 'error', message: `缺少 ${file}` })
      continue
    }
    if (file.endsWith('.json')) readJson(full)
    if (allowed === null) continue
    for (const key of Object.keys(readJson(full))) {
      if (!allowed.has(key))
        problems.push({ level: 'warning', message: `${file} 有未定义的字段 ${key}` })
    }
  }
}

function checkPluginMarketFiles(root: string, plugins: PluginSummary[]): void {
  for (const plugin of plugins) {
    const file = path.join(root, 'plugins', plugin.directory, 'market.json')
    if (!existsSync(file)) continue
    for (const key of Object.keys(readJson(file))) {
      if (key === 'title' || key === 'description') {
        problems.push({
          level: 'error',
          plugin: plugin.directory,
          message: `market.json 不再接受 ${key}：展示文案只来自 locale（见 ADR 0003）`,
        })
        continue
      }
      if (!PLUGIN_MARKET_KEYS.has(key)) {
        problems.push({
          level: 'warning',
          plugin: plugin.directory,
          message: `market.json 有未定义的字段 ${key}`,
        })
      }
    }
  }
}

/**
 * 展示文案只来自 locale：`en`/`zh` 必须有 title 与 description；
 * `meta.detail` 指向的文件必须真实存在于插件包内，否则详情页会打不开。
 */
function checkPluginLocale(root: string, plugins: PluginSummary[]): void {
  for (const plugin of plugins) {
    const dir = path.join(root, 'plugins', plugin.directory)
    for (const language of ['en', 'zh']) {
      const file = path.join(dir, 'locale', `${language}.json`)
      if (!existsSync(file)) {
        problems.push({
          level: 'error',
          plugin: plugin.directory,
          message: `缺少 locale/${language}.json：展示文案以它为准`,
        })
        continue
      }
      const meta = (readJson(file) as { meta?: Record<string, unknown> }).meta
      for (const key of ['title', 'description']) {
        const value = meta?.[key]
        if (typeof value !== 'string' || value.trim() === '') {
          problems.push({
            level: 'error',
            plugin: plugin.directory,
            message: `locale/${language}.json 的 meta.${key} 必须是非空字符串`,
          })
        }
      }
      const detail = meta?.detail
      if (detail !== undefined) {
        if (typeof detail !== 'string' || !existsSync(path.join(dir, detail))) {
          problems.push({
            level: 'error',
            plugin: plugin.directory,
            message: `locale/${language}.json 的 meta.detail 指向的文件不存在：${String(detail)}`,
          })
        }
      }
    }
  }
}

/** 索引钉住的 commit 必须真的含这个目录，否则装不上。 */
function checkPinnedCommit(root: string, plugins: PluginSummary[]): void {
  for (const plugin of plugins.filter(
    (entry): entry is PluginSummary & { commit: string } => entry.listed && entry.commit !== null,
  )) {
    const spec = `${plugin.commit}:plugins/${plugin.directory}/package.json`
    try {
      execFileSync('git', ['-C', root, 'cat-file', '-e', spec], { stdio: 'ignore' })
    } catch {
      problems.push({
        level: 'error',
        plugin: plugin.directory,
        message: `commit ${plugin.commit.slice(0, 7)} 里没有这个目录（浅克隆请用 fetch-depth: 0）`,
      })
    }
  }
}

/** inline 图标不要贴着上限，顺便在校验器之外再兜一层。 */
function checkInlineIcons(index: MarketIndex): void {
  for (const entry of index.plugins) {
    const icon = entry.icon
    if (typeof icon !== 'string' || !icon.startsWith('data:')) continue
    const payload = icon.slice(icon.indexOf(',') + 1)
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
    if ((payload.length / 4) * 3 - padding > MAX_INLINE_ICON_BYTES) {
      problems.push({ level: 'error', plugin: entry.name, message: 'inline 图标超过 32 KiB' })
    }
  }
}

function main(): void {
  const market = loadMarket({ sourceUrl: sourceUrlFromEnvironment() })
  problems.push(...market.problems)
  checkRepositoryFiles(market.root)
  checkPluginMarketFiles(market.root, market.plugins)
  checkPluginLocale(market.root, market.plugins)
  checkPinnedCommit(market.root, market.plugins)

  // 生成结果再校验一次，拿到校验后的结构（版本已排序、icon 已解析）。
  // loadMarket 已经报过 format 错误时不再重复报一遍。
  let validated: MarketIndex | null = null
  if (!problems.some((problem) => problem.level === 'error')) {
    try {
      validated = parseMarketIndex(market.index, market.indexUrl)
    } catch (failure) {
      problems.push({
        level: 'error',
        message: `索引不满足 format 1：${(failure as Error).message}`,
      })
    }
  }
  if (validated !== null) checkInlineIcons(validated)

  const ok = reportProblems(problems)
  const listed = market.plugins.filter((plugin) => plugin.listed)
  if (ok) {
    console.log(`\n${listed.length} 个插件通过检查，索引地址 ${market.indexUrl}`)
  } else {
    console.log(`\n检查未通过：${listed.length} 个插件待修，索引地址 ${market.indexUrl}`)
  }
  if (existsSync(path.join(market.root, 'dist', 'index.json'))) {
    const published = readFileSync(path.join(market.root, 'dist', 'index.json'), 'utf8')
    if (published !== `${JSON.stringify(market.index, null, 2)}\n`) {
      console.log('提示：dist/index.json 与当前仓库不一致，发布前重新跑 pnpm run build')
    }
  }
  process.exit(ok ? 0 : 1)
}

main()
