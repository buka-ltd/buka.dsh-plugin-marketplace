/**
 * 预设头像与头像渲染。
 *
 * 预设表（id / emoji / 底色 / 词典 key）统一在界面侧公共包里，机器人页与
 * 工作流节点图都从那里派生；这里只保留机器人页自己的兜底与渲染。头像 id 与
 * Host 的 `avatar.ts` 一一对应（插件之间不互相 import，所以契约是
 * 「同一个 id」）。
 *
 * @module @buka/dsh-plugin-robots/client/avatar
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
 * 机器人头像：emoji 画在预设色的浅底圆片里。[size] 是直径（px）。
 *
 */
export function renderAvatar(id: unknown, size: number, className: string = ''): ReactElement {
  const preset = avatarPreset(id)
  return h(
    'span',
    {
      className: `buka-robots-avatar${className === '' ? '' : ` ${className}`}`,
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

/**
 * 侧边栏的图标：一个机器人头（圆角矩形 + 两眼 + 天线）。侧边栏只给尺寸与
 * 选中态；颜色通过 `currentColor` 继承面板行的前景色，不自己写死颜色。
 *
 */
export function RobotsPanelIcon({ size }: { size: number; active?: boolean }): ReactElement {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': true,
    },
    h('rect', {
      x: 2.7,
      y: 5.2,
      width: 10.6,
      height: 8.2,
      rx: 2.6,
      stroke: 'currentColor',
      strokeWidth: 1.2,
    }),
    h('circle', { cx: 5.9, cy: 9, r: 0.95, fill: 'currentColor' }),
    h('circle', { cx: 10.1, cy: 9, r: 0.95, fill: 'currentColor' }),
    h('path', {
      d: 'M8 5.2V3.1',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
    }),
    h('circle', { cx: 8, cy: 2.4, r: 0.9, fill: 'currentColor' }),
  )
}
