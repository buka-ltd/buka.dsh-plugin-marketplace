/**
 * DeepSeek Harness 插件市场索引 format 1 的校验规则。
 *
 * 规则逐条对齐 DSH 自带的 `@deepseek-ai/dsh-plugin-market-index`
 * （parseMarketIndex / marketInstallTarget）：同一份 index.json 先由
 * `pnpm run check` 在这里校验，发布后由 DSH 用它再校验一次，所以这里
 * 的判断宁可更严，不要更松。
 */

import { compareVersions, isExactVersion, isValidRange } from './semver.mjs'

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const PACKAGE_NAME_MAX_LENGTH = 214
const COMMIT = /^[0-9a-f]{40}$/u
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

/** inline data URL 图标解码后的最大字节数。 */
export const MAX_INLINE_ICON_BYTES = 32 * 1024

const MAX_PUBLISH_TIMESTAMP = 1e11

/** 索引不满足 format 1；`path` 是出错值的 JSON 路径，例如 `$.plugins[0].versions[1].version`。 */
export class MarketIndexError extends Error {
  /**
   * @param {string} path JSON 路径
   * @param {string} reason 违反的规则
   */
  constructor(path, reason) {
    super(`${path} ${reason}`)
    this.name = 'MarketIndexError'
    this.path = path
    this.reason = reason
  }
}

function fail(path, reason) {
  throw new MarketIndexError(path, reason)
}

function objectAt(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value
}

function stringAt(value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a string with a non-whitespace character')
  return value
}

function optional(object, key, path, read) {
  return Object.hasOwn(object, key) ? read(object[key], `${path}.${key}`) : undefined
}

function localizedText(value, path) {
  if (typeof value === 'string') return stringAt(value, path)
  const object = objectAt(value, path)
  const text = {}
  for (const [language, member] of Object.entries(object)) {
    if (!LANGUAGE_ID.test(language)) fail(`${path}.${language}`, 'must be keyed by a lowercase language id')
    text[language] = stringAt(member, `${path}.${language}`)
  }
  if (!Object.hasOwn(text, 'en')) fail(path, 'must contain en')
  return text
}

function declarations(value, path, read) {
  const result = {}
  for (const [id, member] of Object.entries(objectAt(value, path))) {
    if (id === '') fail(path, 'must not declare an empty id')
    result[id] = read(objectAt(member, `${path}.${id}`), `${path}.${id}`)
  }
  return result
}

function declaration(object, path) {
  return { title: localizedText(object.title, `${path}.title`) }
}

function sortKeyDeclaration(object, path) {
  if (object.order !== 'asc' && object.order !== 'desc') fail(`${path}.order`, 'must be "asc" or "desc"')
  return {
    title: localizedText(object.title, `${path}.title`),
    order: object.order,
  }
}

function indexMetadata(value, path) {
  const object = value === undefined ? {} : objectAt(value, path)
  return {
    categories:
      optional(object, 'categories', path, (member, at) => declarations(member, at, declaration)) ?? {},
    labels: optional(object, 'labels', path, (member, at) => declarations(member, at, declaration)) ?? {},
    sortKeys:
      optional(object, 'sortKeys', path, (member, at) => declarations(member, at, sortKeyDeclaration)) ?? {},
  }
}

function declaredId(value, path, declared) {
  const id = stringAt(value, path)
  if (!Object.hasOwn(declared, id)) fail(path, `references undeclared id ${JSON.stringify(id)}`)
  return id
}

function pluginMetadata(value, path, index) {
  const object = value === undefined ? {} : objectAt(value, path)
  const category = optional(object, 'category', path, (member, at) => declaredId(member, at, index.categories))
  const keywords =
    optional(object, 'keywords', path, (member, at) => {
      if (!Array.isArray(member)) fail(at, 'must be an array')
      return member.map((keyword, position) => {
        if (typeof keyword !== 'string') fail(`${at}[${position}]`, 'must be a string')
        return keyword
      })
    }) ?? []
  const labels =
    optional(object, 'labels', path, (member, at) => {
      if (!Array.isArray(member)) fail(at, 'must be an array')
      const ids = member.map((label, position) => declaredId(label, `${at}[${position}]`, index.labels))
      if (new Set(ids).size !== ids.length) fail(at, 'must not repeat a label')
      return ids
    }) ?? []
  const sortKeys =
    optional(object, 'sortKeys', path, (member, at) => {
      const values = {}
      for (const [id, sortValue] of Object.entries(objectAt(member, at))) {
        declaredId(id, `${at}.${id}`, index.sortKeys)
        if (typeof sortValue !== 'number' || !Number.isFinite(sortValue)) fail(`${at}.${id}`, 'must be a finite number')
        values[id] = sortValue
      }
      return values
    }) ?? {}
  return { ...(category === undefined ? {} : { category }), keywords, labels, sortKeys }
}

function httpUrl(value, path, protocols) {
  const text = stringAt(value, path)
  let url
  try {
    url = new URL(text)
  } catch {
    fail(path, 'must be an absolute URL')
  }
  if (!protocols.includes(url.protocol)) fail(path, `must use ${protocols.join(' or ')}`)
  if (url.username !== '' || url.password !== '') fail(path, 'must not contain credentials')
  if (url.href.includes('?') || url.href.includes('#')) fail(path, 'must not contain a query or fragment')
  return url
}

/** npm 的 homepage 常带 `#readme`，这里保留 query 与 fragment。 */
function homepageUrl(value, path) {
  const text = stringAt(value, path)
  if (!URL.canParse(text)) fail(path, 'must be an absolute URL')
  const url = new URL(text)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(path, 'must use https: or http:')
  return url.href
}

function gitUrl(value, path) {
  const url = httpUrl(value, path, ['https:'])
  if (url.href !== value) fail(path, 'must be a canonical URL')
  if (!/^(?:\/[^/]+){2,}$/u.test(url.pathname)) fail(path, 'must name a repository with at least two path segments')
  if (/\.(?:tgz|tar\.gz)$/iu.test(url.pathname)) fail(path, 'must name a repository, not a tarball')
  return url.href
}

function packagePath(value, path) {
  const text = stringAt(value, path)
  if (text.split('/').some((segment) => segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment))) {
    fail(path, 'must be a relative directory of letters, digits, and ._@+- segments without . or ..')
  }
  return text
}

function repository(value, path) {
  const object = objectAt(value, path)
  const url = httpUrl(object.url, `${path}.url`, ['https:', 'http:']).href
  const directory = optional(object, 'directory', path, packagePath)
  return { url, ...(directory === undefined ? {} : { directory }) }
}

function source(value, path) {
  const object = objectAt(value, path)
  switch (object.type) {
    case 'npm': {
      const registry = optional(object, 'registry', path, (member, at) =>
        httpUrl(member, at, ['https:', 'http:']).href,
      )
      return { type: 'npm', ...(registry === undefined ? {} : { registry }) }
    }
    case 'git': {
      const commit = stringAt(object.commit, `${path}.commit`)
      if (!COMMIT.test(commit)) fail(`${path}.commit`, 'must be a lowercase 40-hex-digit commit SHA')
      const packageDir = optional(object, 'path', path, packagePath)
      return {
        type: 'git',
        url: gitUrl(object.url, `${path}.url`),
        commit,
        ...(packageDir === undefined ? {} : { path: packageDir }),
      }
    }
    default:
      return fail(`${path}.type`, 'must be "npm" or "git"')
  }
}

function engines(value, path) {
  const dsh = optional(objectAt(value, path), 'dsh', path, (member, at) => {
    const range = stringAt(member, at)
    if (range.startsWith('workspace:')) fail(at, 'must not be a workspace: range')
    if (!isValidRange(range)) fail(at, 'must be a SemVer range')
    return range
  })
  return dsh === undefined ? {} : { dsh }
}

function iconAt(value, path, indexUrl) {
  const text = stringAt(value, path)
  if (text.startsWith('data:')) {
    const payload = DATA_ICON.exec(text)?.[1]
    if (payload === undefined || payload === '' || !BASE64.test(payload)) {
      fail(path, 'must be a base64 SVG, PNG, JPEG, or WebP data URL')
    }
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
    if ((payload.length / 4) * 3 - padding > MAX_INLINE_ICON_BYTES) {
      fail(path, `must not exceed ${MAX_INLINE_ICON_BYTES / 1024} KiB of decoded bytes`)
    }
    return text
  }
  let resolved
  try {
    resolved = new URL(text, indexUrl)
  } catch {
    fail(path, 'must be a URL reference')
  }
  if (resolved.protocol !== 'https:' && (resolved.origin === 'null' || resolved.origin !== indexUrl.origin)) {
    fail(path, 'must resolve to https or the index origin')
  }
  return resolved.href
}

function marketVersion(value, path) {
  const object = objectAt(value, path)
  const version = stringAt(object.version, `${path}.version`)
  if (!isExactVersion(version)) fail(`${path}.version`, 'must be an exact SemVer version')
  const publishTimestamp = object.publishTimestamp
  if (
    typeof publishTimestamp !== 'number' ||
    !Number.isInteger(publishTimestamp) ||
    publishTimestamp < 0 ||
    publishTimestamp >= MAX_PUBLISH_TIMESTAMP
  ) {
    fail(`${path}.publishTimestamp`, 'must be an integer number of Unix seconds in [0, 10^11)')
  }
  return {
    version,
    publishTimestamp,
    source: source(object.source, `${path}.source`),
    engines: optional(object, 'engines', path, engines) ?? {},
  }
}

function versions(value, path) {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty array')
  const seen = new Set()
  const entries = value.map((member, position) => {
    const at = `${path}[${position}]`
    const entry = marketVersion(member, at)
    if (seen.has(entry.version)) fail(`${at}.version`, `duplicates ${entry.version}`)
    seen.add(entry.version)
    return entry
  })
  return entries.sort((left, right) => compareVersions(right.version, left.version))
}

function plugin(value, path, index, indexUrl) {
  const object = objectAt(value, path)
  const name = stringAt(object.name, `${path}.name`)
  if (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) {
    fail(`${path}.name`, 'must be a valid npm package name')
  }
  const title = optional(object, 'title', path, localizedText)
  const description = optional(object, 'description', path, localizedText)
  const iconUrl = optional(object, 'icon', path, (member, at) => iconAt(member, at, indexUrl))
  const author = optional(object, 'author', path, stringAt)
  const homepage = optional(object, 'homepage', path, homepageUrl)
  const repo = optional(object, 'repository', path, repository)
  return {
    name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(iconUrl === undefined ? {} : { icon: iconUrl }),
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(repo === undefined ? {} : { repository: repo }),
    metadata: pluginMetadata(object.metadata, `${path}.metadata`, index),
    versions: versions(object.versions, `${path}.versions`),
  }
}

/**
 * 校验一份已解析的 format 1 索引。
 * 未定义的成员被丢弃；缺失的 metadata 组与列表补空值；版本按降序排列；
 * 相对 icon 解析成绝对地址。
 *
 * @param {unknown} value 解析后的 JSON
 * @param {string | URL} indexUrl 索引的绝对地址，相对 icon 以它为基准
 * @returns {object} 校验后的索引
 * @throws {MarketIndexError} 第一条不满足的规则
 */
export function parseMarketIndex(value, indexUrl) {
  let url
  try {
    url = indexUrl instanceof URL ? indexUrl : new URL(String(indexUrl))
  } catch {
    fail('$', `index URL ${JSON.stringify(String(indexUrl))} must be an absolute URL`)
  }
  if (!URL.canParse(url.href)) fail('$', `index URL ${JSON.stringify(String(indexUrl))} must be an absolute URL`)
  const object = objectAt(value, '$')
  if (object.format !== 1) fail('$.format', 'must be 1')
  const metadata = indexMetadata(object.metadata, '$.metadata')
  if (!Array.isArray(object.plugins)) fail('$.plugins', 'must be an array')
  const names = new Set()
  const plugins = object.plugins.map((entry, position) => {
    const parsed = plugin(entry, `$.plugins[${position}]`, metadata, url)
    if (names.has(parsed.name)) fail(`$.plugins[${position}].name`, `duplicates ${parsed.name}`)
    names.add(parsed.name)
    return parsed
  })
  const title = localizedText(object.title, '$.title')
  const description = optional(object, 'description', '$', localizedText)
  return {
    format: 1,
    title,
    ...(description === undefined ? {} : { description }),
    metadata,
    plugins,
  }
}

/**
 * 构造安装一个精确版本所需参数：npm 是 `name@version`，git 是钉住 commit 的
 * `git+https` 地址，包在子目录时带 pnpm 的 `path:` 参数。
 *
 * @param {string} name 包名
 * @param {object} version 校验过的版本记录
 * @returns {{ spec: string, registry?: string }}
 */
export function marketInstallTarget(name, version) {
  const from = version.source
  if (from.type === 'npm') {
    return { spec: `${name}@${version.version}`, ...(from.registry === undefined ? {} : { registry: from.registry }) }
  }
  const base = from.url.endsWith('.git') ? from.url : `${from.url}.git`
  const path = from.path === undefined ? '' : `&path:/${from.path}`
  return { spec: `git+${base}#${from.commit}${path}` }
}
