/**
 * 预设头像：id → emoji / 底色 / 词典 key。
 *
 * 机器人页与工作流节点图原本各维护一份同样的显示表；插件之间不互相 import，
 * 所以统一收在这里，两个浏览器一半都从这里派生。id 与 Host 的
 * `plugins/robots/src/avatar.ts` 一一对应（那边只存 id，不存 emoji / 底色），
 * **id 是跨插件的稳定契约**：增删预设时两边一起改，顺序也不要动。
 *
 * @module plugin-ui/avatars
 */

/** 一个预设头像。 */
export interface AvatarPreset {
  /** 与 Host 的预设 id 一一对应。 */
  readonly id: string
  /** 画在圆片里的 emoji。 */
  readonly emoji: string
  /** 圆片的底色；渲染时按比例调成浅底。 */
  readonly color: string
  /** 词典里给读屏与 tooltip 用的名字。 */
  readonly labelKey: string
}

/**
 * 预设头像：顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是名字哈希
 * 的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
 */
export const AVATARS = [
  { id: 'sprout', emoji: '🌱', color: '#34A853', labelKey: 'avatarSprout' },
  { id: 'sun', emoji: '☀️', color: '#F2A60C', labelKey: 'avatarSun' },
  { id: 'cat', emoji: '🐱', color: '#F2994A', labelKey: 'avatarCat' },
  { id: 'fox', emoji: '🦊', color: '#EB6A4E', labelKey: 'avatarFox' },
  { id: 'panda', emoji: '🐼', color: '#6B7280', labelKey: 'avatarPanda' },
  { id: 'owl', emoji: '🦉', color: '#8D6E63', labelKey: 'avatarOwl' },
  { id: 'whale', emoji: '🐳', color: '#4A90E2', labelKey: 'avatarWhale' },
  { id: 'octopus', emoji: '🐙', color: '#9B51E0', labelKey: 'avatarOctopus' },
  { id: 'bee', emoji: '🐝', color: '#D9A400', labelKey: 'avatarBee' },
  { id: 'rocket', emoji: '🚀', color: '#5B6BFF', labelKey: 'avatarRocket' },
  { id: 'dino', emoji: '🦖', color: '#27AE60', labelKey: 'avatarDino' },
  { id: 'ghost', emoji: '👻', color: '#94A3B8', labelKey: 'avatarGhost' },
  { id: 'penguin', emoji: '🐧', color: '#2D9CDB', labelKey: 'avatarPenguin' },
  { id: 'unicorn', emoji: '🦄', color: '#BB6BD9', labelKey: 'avatarUnicorn' },
  { id: 'mushroom', emoji: '🍄', color: '#EB5757', labelKey: 'avatarMushroom' },
] as const

/** 预设 id，顺序与 `AVATARS` 一致。 */
export const AVATAR_IDS: readonly string[] = AVATARS.map((preset) => preset.id)

/** id → 预设。 */
export const AVATAR_BY_ID = new Map<string, AvatarPreset>(
  AVATARS.map((preset) => [preset.id, preset]),
)

/** 列表 / 默认值用第一个预设。 */
export const DEFAULT_AVATAR_ID: string = AVATARS[0].id

/**
 * 头像 id → 预设；不认识的 id 返回 `undefined`。
 *
 * 两个浏览器一半的兜底不同：机器人页退回第一个预设，节点图当作没有头像，
 * 所以这里只做查表，兜底留在各自的 `avatarPreset` 里。
 *
 * @param id 头像 id
 */
export function findAvatarPreset(id: unknown): AvatarPreset | undefined {
  return typeof id === 'string' ? AVATAR_BY_ID.get(id) : undefined
}
