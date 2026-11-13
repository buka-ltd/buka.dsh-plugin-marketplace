/**
 * 打工人头像的 Host 侧契约：预设 id、默认分配与校验。
 *
 * 头像在登记表里只存一个 id（例如 `panda`），显示由两个浏览器一半各自维护一份
 * 同一 id → emoji / 底色的映射（本仓库不允许插件之间互相 import）：
 * `plugins/workers/client.js` 的打工人页与 `plugins/workflows/client.js` 的工作流
 * 节点图。因此 **id 是跨插件的稳定契约**，增删预设时要同步两处客户端。
 *
 * 默认分配是确定性的：没有指定头像的打工人按名字哈希到一个预设，这样旧登记表
 * 里的打工人也有稳定头像；新建打工人优先挑一个还没被占用的预设，避免刚创建
 * 的一批打工人全是一个样子。
 *
 * 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-workers/avatar
 */

/**
 * 预设头像 id。顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是名字哈希
 * 的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
 *
 * 这里**没有** 🤖 打工人 emoji：那是历史遗留的「通用型打工人」专属头像，通用型
 * 打工人已移除，`worker` 这个 id 不再使用；旧登记表里残留的 `worker` id 会按名字
 * 哈希落回其它预设。
 *
 */
export const AVATAR_IDS = Object.freeze([
  'sprout',
  'sun',
  'cat',
  'fox',
  'panda',
  'owl',
  'whale',
  'octopus',
  'bee',
  'rocket',
  'dino',
  'ghost',
  'penguin',
  'unicorn',
  'mushroom',
] as const)

/** 没有任何可用 id 时的兜底头像。 */
export const DEFAULT_AVATAR_ID = AVATAR_IDS[0]

/** id → 是否属于预设集合。 */
const AVATAR_ID_SET = new Set<string>(AVATAR_IDS)

/**
 * 这个值是不是一个预设头像 id。
 *
 */
export function isAvatarId(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_ID_SET.has(value)
}

/**
 * 名字 → 稳定哈希（FNV-1a，按 Unicode 码点遍历，中文名也能均匀分布）。
 *
 */
function hashName(name: unknown): number {
  let hash = 2166136261
  for (const char of String(name ?? '')) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 名字对应的确定性头像：同一个名字永远得到同一个 id。
 *
 */
export function defaultAvatarFor(name: unknown): string {
  return AVATAR_IDS[hashName(name) % AVATAR_IDS.length] ?? DEFAULT_AVATAR_ID
}

/**
 * 新建打工人时的默认头像：先按名字哈希，如果这个 id 已经被别的打工人用了，
 * 就按预设顺序挑第一个没被占用的；全被占用时回到名字哈希的结果。
 *
 */
export function pickDefaultAvatar(name: unknown, used: Iterable<string> = []): string {
  const taken = new Set(used)
  const preferred = defaultAvatarFor(name)
  if (!taken.has(preferred)) return preferred
  for (const id of AVATAR_IDS) {
    if (!taken.has(id)) return id
  }
  return preferred
}

/**
 * 读取登记表里的头像值并规范化：合法的 id 原样返回，缺省 / 非法值按名字兜底。
 *
 */
export function resolveAvatar(value: unknown, name: unknown): string {
  return isAvatarId(value) ? value : defaultAvatarFor(name)
}
