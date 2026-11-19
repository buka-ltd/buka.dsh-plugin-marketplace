/**
 * 预设头像与头像渲染。
 *
 * 预设表（id / emoji / 底色 / 词典 key）统一在界面侧公共包里，执行者页与
 * 工作流节点图都从那里派生；这里只保留执行者页自己的兜底与渲染。头像 id 与
 * Host 的 `avatar.ts` 一一对应（插件之间不互相 import，所以契约是
 * 「同一个 id」）。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/avatar
 */

import { AVATAR_BY_ID, AVATARS, DEFAULT_AVATAR_ID, findAvatarPreset, h } from '@buka/plugin-ui'
import type { ReactElement } from 'react'
import type { AvatarPreset } from './types.ts'

export { AVATAR_BY_ID, AVATARS, DEFAULT_AVATAR_ID }

/**
 * 头像 id → 预设；不认识的 id 退回第一个预设（Host 的旧记录已兜底，这里只是
 * 防御脏数据，保证页面上永远有一个头像）。
 *
 */
export function avatarPreset(id: unknown): AvatarPreset {
  return findAvatarPreset(id) ?? AVATARS[0]
}

/**
 * 执行者头像：emoji 画在预设色的浅底圆片里。[size] 是直径（px）。
 *
 */
export function renderAvatar(id: unknown, size: number, className: string = ''): ReactElement {
  const preset = avatarPreset(id)
  return h(
    'span',
    {
      className: `buka-workers-avatar${className === '' ? '' : ` ${className}`}`,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(9, Math.round(size * 0.6))}px`,
        backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
        borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`,
      },
      'aria-hidden': true,
    },
    preset.emoji,
  )
}
