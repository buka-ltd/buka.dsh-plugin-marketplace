/**
 * 机器人头像的 Host 侧契约：预设 id、默认分配与校验。
 *
 * 头像在登记表里只存一个 id（例如 `panda`），显示由两个浏览器一半各自维护一份
 * 同一 id → emoji / 底色的映射（本仓库不允许插件之间互相 import）：
 * `plugins/robots/client.js` 的机器人页与 `plugins/workflows/client.js` 的工作流
 * 节点图。因此 **id 是跨插件的稳定契约**，增删预设时要同步两处客户端。
 *
 * 默认分配是确定性的：没有指定头像的机器人按名字哈希到一个预设，这样旧登记表
 * 里的机器人也有稳定头像；新建机器人优先挑一个还没被占用的预设，避免刚创建
 * 的一批机器人全是一个样子。
 *
 * 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-robots/avatar
 */

/**
 * 预设头像 id。顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是名字哈希
 * 的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
 *
 * 这里**没有** 🤖 机器人 emoji：它固定属于页面里的「通用型机器人」，不再分配给
 * 普通机器人，避免用户创建的机器人跟内置入口撞脸。旧登记表里残留的 `robot`
 * id 会按名字哈希落回其它预设。
 *
 * @type {readonly string[]}
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
])

/** 没有任何可用 id 时的兜底头像。 */
export const DEFAULT_AVATAR_ID = AVATAR_IDS[0]

/** id → 是否属于预设集合。 */
const AVATAR_ID_SET = new Set(AVATAR_IDS)

/**
 * 这个值是不是一个预设头像 id。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAvatarId(value) {
  return typeof value === 'string' && AVATAR_ID_SET.has(value)
}

/**
 * 名字 → 稳定哈希（FNV-1a，按 Unicode 码点遍历，中文名也能均匀分布）。
 *
 * @param {unknown} name
 * @returns {number}
 */
function hashName(name) {
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
 * @param {unknown} name
 * @returns {string}
 */
export function defaultAvatarFor(name) {
  return AVATAR_IDS[hashName(name) % AVATAR_IDS.length] ?? DEFAULT_AVATAR_ID
}

/**
 * 新建机器人时的默认头像：先按名字哈希，如果这个 id 已经被别的机器人用了，
 * 就按预设顺序挑第一个没被占用的；全被占用时回到名字哈希的结果。
 *
 * @param {unknown} name 机器人名
 * @param {Iterable<string>} [used] 已占用的头像 id
 * @returns {string}
 */
export function pickDefaultAvatar(name, used = []) {
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
 * @param {unknown} value 登记表里的原始值
 * @param {unknown} name 机器人名（兜底哈希用）
 * @returns {string}
 */
export function resolveAvatar(value, name) {
  return isAvatarId(value) ? value : defaultAvatarFor(name)
}
