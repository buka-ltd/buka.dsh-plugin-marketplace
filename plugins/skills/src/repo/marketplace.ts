/**
 * Claude Code marketplace 清单（`.claude-plugin/marketplace.json`）的解析与校验。
 *
 * 清单在仓库里的固定路径、插件名与插件 root 的合法形状都集中在这里；分组与
 * 缓存校验复用同一套规则，保证「写进缓存」与「从缓存读回」的判断一致。
 *
 * @module @buka/dsh-plugin-skills/repo/marketplace
 */

import type { CachedMarketplace, MarketplacePlugin } from './types.ts'

/** Claude Code marketplace 清单在仓库里的固定路径。 */
export const MARKETPLACE_PATH = '.claude-plugin/marketplace.json'

/**
 * Claude Code 单插件清单在插件根下的固定路径；npx skills 仓库按它声明的
 * `skills` 做展示分组，与 CLI 的 `getPluginGroupings()` 一致。
 */
export const PLUGIN_MANIFEST_PATH = '.claude-plugin/plugin.json'

/** 插件 root 相对路径的最大长度，防止有人把整篇文档贴进来。 */
export const MAX_PLUGIN_ROOT_LENGTH = 300

/** marketplace 插件名的格式；与 Claude Code 的插件命名规则一致。 */
const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u

/** 控制字符（含换行、制表符）不允许出现在路径里。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 这里就是要拒绝控制字符
export const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u

/**
 * 解析 Claude Code marketplace 清单。
 *
 * 顶层不是对象、或者 `plugins` 不是数组时整份按不合法处理（返回 null，调用方
 * 判定为不可用）。单个插件的 name / source 不合法只跳过该插件：宁可少列一个，
 * 也不要让一份有瑕疵的清单整份失败。
 */
export function parseMarketplace(text: string): CachedMarketplace | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as { name?: unknown; metadata?: unknown; plugins?: unknown }
  if (!Array.isArray(record.plugins)) return null

  // `metadata.pluginRoot` 只影响「裸 source 名」的解析根；不合法就当作没有。
  const metadata = record.metadata as { pluginRoot?: unknown } | undefined
  const pluginRoot = normalizeRelativePath(metadata?.pluginRoot)
  const plugins: MarketplacePlugin[] = []
  const roots = new Set<string>()
  for (const entry of record.plugins) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    const pluginName = normalizePluginName(item.name)
    if (pluginName === null) continue
    const root = resolvePluginRoot(item.source, pluginRoot)
    if (root === null || roots.has(root)) continue
    // 同一 root 只保留数组里第一条：后面的 entry 分不到 skill，自然被省略。
    roots.add(root)
    plugins.push({
      name: pluginName,
      root,
      // 描述暂时不展示，但保留在解析结果里，后续要用时不必再解析一遍。
      description: typeof item.description === 'string' ? item.description : '',
    })
  }
  return { name: typeof record.name === 'string' ? record.name : '', plugins }
}

/**
 * 校验 marketplace 插件名：trim 后必须匹配插件命名规则。
 */
export function normalizePluginName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!PLUGIN_NAME_PATTERN.test(text)) return null
  return text
}

/**
 * 校验一个安全的仓库内相对路径；不合法时返回 null。
 *
 * 拒绝绝对路径、反斜杠、控制字符、空段、`.` / `..` 段与超长路径。空串表示
 * 仓库根，是合法的相对路径。
 */
export function normalizeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value === '') return ''
  if (value.length > MAX_PLUGIN_ROOT_LENGTH) return null
  if (value.startsWith('/') || value.includes('\\') || CONTROL_PATTERN.test(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return value
}

/**
 * 把一个插件的 `source` 解析成仓库内相对路径；只接受仓库内的本地 source。
 *
 * - `'.'` → 仓库根（`''`）；
 * - `'./x'` → `'x'`；
 * - 不含 `/` 的裸名 → `${metadata.pluginRoot}/${source}`（没有合法 pluginRoot
 *   则跳过）；裸名指目录名，可能与 entry 的显示名不同；
 * - 其它（含 `/` 但不以 `./` 开头、对象形式的 github / npm / url source）→ 跳过，
 *   因为它们不在这个仓库里，Host 无法列出其中的 skill。
 *
 * @param pluginRoot `metadata.pluginRoot` 的校验结果
 */
function resolvePluginRoot(source: unknown, pluginRoot: string | null): string | null {
  if (typeof source !== 'string') return null
  if (source === '.') return ''
  if (source.startsWith('./')) return normalizeRelativePath(source.slice(2))
  if (source.includes('/')) return null
  if (pluginRoot === null) return null
  return normalizeRelativePath(pluginRoot === '' ? source : `${pluginRoot}/${source}`)
}

/**
 * 校验缓存里的 marketplace 清单；缺失或结构不合法时返回 null。
 *
 * 插件名与 root 都按写入前同一套规则重新校验：缓存可能被手工改过，不能让
 * 非法路径或名字从缓存里重新变成对外服务的返回值。
 */
export function normalizeCachedMarketplace(value: unknown): CachedMarketplace | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string') return null
  if (!Array.isArray(record.plugins)) return null
  const plugins: MarketplacePlugin[] = []
  for (const entry of record.plugins) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const item = entry as Record<string, unknown>
    const name = normalizePluginName(item.name)
    const root = normalizeRelativePath(item.root)
    if (name === null || root === null) return null
    if (typeof item.description !== 'string') return null
    plugins.push({ name, root, description: item.description })
  }
  return { name: record.name, plugins }
}
