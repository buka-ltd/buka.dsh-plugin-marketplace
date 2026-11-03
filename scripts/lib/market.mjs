/**
 * 从仓库里的插件目录生成 format 1 索引。
 *
 * 索引的每一栏都有唯一事实来源，不在这里重复维护：
 * - 包名、版本、engines.dsh、简介来自 `plugins/<dir>/package.json`
 * - 展示信息（标题、图标、分类、标签、关键词）来自 `plugins/<dir>/market.json`
 * - 安装来源是 git：`commit` 取该目录最后一次提交（HEAD 与发布产物总能对上），
 *   `publishTimestamp` 取同一次提交的时间
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { MarketIndexError, parseMarketIndex } from './format.mjs'
import { isExactVersion, isValidRange } from './semver.mjs'

/** 读 JSON 文件，解析失败时带上文件路径。 */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`无法解析 JSON：${path.relative(process.cwd(), file)}\n${error.message}`)
  }
}

function git(cwd, args, options = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

/**
 * 把常见的 git remote 写法归一成 https 仓库地址（去掉 `.git`）。
 * 索引里 `source.url` 只接受 https，所以不留 ssh 形式。
 */
export function normalizeRemote(remote) {
  const text = remote.trim()
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?\/?$/u.exec(text)
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2]}`
  const http = /^(https?:\/\/[^/]+\/.+?)(?:\.git)?\/?$/u.exec(text)
  if (http !== null) return http[1]
  throw new Error(`无法把 origin（${text}）归一成 https 仓库地址，请用 --source-url 指定`)
}

/** 某个目录最后一次提交的 { commit, commitTime }；还没有任何提交时返回 null。 */
export function lastCommit(cwd, directory) {
  let output
  try {
    output = git(cwd, ['log', '-1', '--format=%H %ct', '--', directory]).trim()
  } catch {
    return null
  }
  if (output === '') return null
  const [commit, seconds] = output.split(' ')
  return { commit, commitTime: Number(seconds) }
}

/** 该目录是否有未提交改动。 */
export function isDirty(cwd, directory) {
  return git(cwd, ['status', '--porcelain', '--', directory]).trim() !== ''
}

function pluginDirectories(root) {
  const base = path.join(root, 'plugins')
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort()
}

function iconTarget(directory, icon) {
  const extension = path.extname(icon).toLowerCase()
  if (!['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    throw new Error(`market.json 的 icon 只支持 .svg/.png/.jpg/.jpeg/.webp，收到 ${icon}`)
  }
  return `icons/${directory}${extension === '.jpeg' ? '.jpg' : extension}`
}

/**
 * 读取仓库里的市场配置与全部插件，生成索引并收集问题。
 *
 * @param {{ root?: string, sourceUrl?: string }} [options]
 * @returns {{
 *   root: string,
 *   indexUrl: string,
 *   index: object,
 *   plugins: Array<{ directory: string, name: string, version: string, commit: string, listed: boolean }>,
 *   assets: Array<{ from: string, to: string }>,
 *   problems: Array<{ level: 'error' | 'warning', plugin?: string, message: string }>,
 * }}
 */
export function loadMarket(options = {}) {
  const root = options.root ?? process.cwd()
  const config = readJson(path.join(root, 'market.json'))
  const problems = []
  const error = (message, plugin) => problems.push({ level: 'error', message, ...(plugin ? { plugin } : {}) })
  const warning = (message, plugin) => problems.push({ level: 'warning', message, ...(plugin ? { plugin } : {}) })

  if (typeof config.publicUrl !== 'string' || !URL.canParse(config.publicUrl)) {
    throw new Error('market.json 的 publicUrl 必须是索引发布后的绝对地址')
  }
  const indexUrl = new URL(config.publicUrl)

  let sourceUrl = options.sourceUrl ?? process.env.DSH_MARKET_SOURCE_URL
  if (sourceUrl === undefined || sourceUrl === '') {
    let remote
    try {
      remote = git(root, ['remote', 'get-url', 'origin'])
    } catch {
      throw new Error('仓库没有 origin remote，用 --source-url 指定插件的 https 仓库地址')
    }
    sourceUrl = normalizeRemote(remote)
  }
  if (!/^https:\/\/[^/]+\/.+/u.test(sourceUrl)) {
    throw new Error(`--source-url 必须是 https 仓库地址，收到 ${sourceUrl}`)
  }
  sourceUrl = sourceUrl.replace(/\.git$/u, '')

  const scope = config.packageScope
  const prefix = config.packagePrefix
  const plugins = []
  const assets = []
  const entries = []

  for (const directory of pluginDirectories(root)) {
    const pluginRoot = path.join(root, 'plugins', directory)
    const packageFile = path.join(pluginRoot, 'package.json')
    const marketFile = path.join(pluginRoot, 'market.json')
    if (!existsSync(packageFile)) {
      error('缺少 package.json', directory)
      continue
    }
    const manifest = readJson(packageFile)
    const info = existsSync(marketFile) ? readJson(marketFile) : null
    if (info === null) {
      error('缺少 market.json，无法在市场上挂牌', directory)
      continue
    }
    if (info.listed === false) {
      plugins.push({ directory, name: manifest.name, version: manifest.version, commit: null, listed: false })
      continue
    }

    if (typeof scope === 'string' && typeof prefix === 'string') {
      const expected = `${scope}/${prefix}${directory}`
      if (manifest.name !== expected) {
        error(`package.json 的 name 应为 ${expected}（目录名决定包名），实际是 ${manifest.name}`, directory)
      }
    }
    if (!isExactVersion(manifest.version)) {
      error(`package.json 的 version 必须是精确 SemVer，实际是 ${JSON.stringify(manifest.version)}`, directory)
    }
    const patch = manifest.dsh?.bundle?.patch
    if (patch === undefined) {
      error('package.json 缺少 dsh.bundle.patch，DSH 不会把它当作 bundle 安装', directory)
    } else {
      for (const one of Array.isArray(patch) ? patch : [patch]) {
        if (!existsSync(path.join(pluginRoot, one))) {
          error(`dsh.bundle.patch 指向的 ${one} 不存在`, directory)
        }
      }
    }
    if (manifest.dsh?.manifestVersion !== 1) {
      warning('package.json 建议声明 dsh.manifestVersion: 1', directory)
    }
    const main = manifest.main ?? manifest.exports?.['.']?.default
    if (typeof main !== 'string' || !existsSync(path.join(pluginRoot, main))) {
      error('package.json 的 main / exports["."] 指向的入口文件不存在', directory)
    }
    const dshRange = manifest.engines?.dsh
    if (typeof dshRange !== 'string' || !isValidRange(dshRange)) {
      error('package.json 的 engines.dsh 必须是合法的 SemVer 范围，DSH 用它判断兼容性', directory)
    }
    if (typeof manifest.peerDependencies?.['@deepseek-ai/cordis'] !== 'string') {
      warning('package.json 建议把 @deepseek-ai/cordis 声明为 peerDependency', directory)
    }
    const files = manifest.files
    if (Array.isArray(files)) {
      if (!files.some((pattern) => pattern === 'lib' || pattern.startsWith('lib/'))) {
        warning('package.json 的 files 没包含 lib/，发布后入口文件会缺失', directory)
      }
      if (!files.includes('cordis.patch.yml')) {
        warning('package.json 的 files 没包含 cordis.patch.yml，发布后 bundle 补丁会缺失', directory)
      }
    }

    const commitInfo = lastCommit(root, path.posix.join('plugins', directory))
    if (commitInfo === null) {
      error('目录还没有提交，索引无法钉住安装用的 commit；先提交插件再生成索引', directory)
      continue
    }
    if (isDirty(root, path.posix.join('plugins', directory))) {
      warning('目录有未提交改动，索引钉住的 commit 不含这些改动', directory)
    }

    let icon
    if (info.icon !== undefined) {
      if (typeof info.icon !== 'string') {
        error('market.json 的 icon 必须是字符串', directory)
      } else if (info.icon.startsWith('data:')) {
        icon = info.icon
      } else if (/^https?:\/\//u.test(info.icon)) {
        icon = info.icon
      } else {
        const from = path.join(pluginRoot, info.icon)
        if (!existsSync(from) || !statSync(from).isFile()) {
          error(`market.json 的 icon 指向的 ${info.icon} 不存在`, directory)
        } else {
          const to = iconTarget(directory, info.icon)
          assets.push({ from, to })
          icon = to
        }
      }
    } else {
      warning('market.json 没有 icon，Discovery 页会显示占位图', directory)
    }

    const metadata = {
      ...(info.category === undefined ? {} : { category: info.category }),
      keywords: info.keywords ?? [],
      labels: info.labels ?? [],
      ...(info.sortKeys === undefined ? {} : { sortKeys: info.sortKeys }),
    }
    const entry = {
      name: manifest.name,
      ...(info.title === undefined ? {} : { title: info.title }),
      description: info.description ?? manifest.description,
      ...(icon === undefined ? {} : { icon }),
      ...(info.author === undefined ? {} : { author: info.author }),
      ...(info.homepage === undefined ? {} : { homepage: info.homepage }),
      repository: info.repository ?? { url: sourceUrl, directory: `plugins/${directory}` },
      metadata,
      versions: [
        {
          version: manifest.version,
          publishTimestamp: commitInfo.commitTime,
          source: { type: 'git', url: sourceUrl, commit: commitInfo.commit, path: `plugins/${directory}` },
          ...(dshRange === undefined ? {} : { engines: { dsh: dshRange } }),
        },
      ],
    }
    entries.push(entry)
    plugins.push({
      directory,
      name: manifest.name,
      version: manifest.version,
      commit: commitInfo.commit,
      listed: true,
    })
  }

  const index = {
    format: 1,
    title: config.title,
    ...(config.description === undefined ? {} : { description: config.description }),
    metadata: config.metadata ?? { categories: {}, labels: {}, sortKeys: {} },
    plugins: entries,
  }

  try {
    parseMarketIndex(index, indexUrl)
  } catch (failure) {
    if (failure instanceof MarketIndexError) {
      error(`生成结果不满足 format 1：${failure.message}`)
    } else {
      throw failure
    }
  }

  return { root, indexUrl: indexUrl.href, index, plugins, assets, problems, sourceUrl }
}
