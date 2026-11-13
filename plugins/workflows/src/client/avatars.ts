/**
 * 预设头像：id → emoji / 底色。
 *
 * 预设表统一在界面侧公共包里，与 workers 页共用同一份；图模型只带 id，
 * 不认识的 id 当作没有头像。
 */

import { findAvatarPreset } from '@buka/plugin-ui'
import type React from 'react'

import { h } from './element.ts'

/**
 * 头像 id → 预设；不认识的 id 返回 null（图上就不画头像）。
 *
 * @param id
 * @returns
 */
export function avatarPreset(id: unknown): { emoji: string; color: string } | null {
  const preset = findAvatarPreset(id)
  return preset === undefined ? null : { emoji: preset.emoji, color: preset.color }
}

/**
 * 打工人头像小圆片：emoji 画在预设色的浅底上。[size] 是直径（px），`className`
 * 给胶囊 / 详情标题这类不同位置补间距。
 *
 * @param avatar 头像 id
 * @param size
 * @param [className]
 * @returns React 元素；没有头像时返回 null
 */
export function renderAvatar(
  avatar: unknown,
  size: number,
  className = '',
): React.ReactElement | null {
  const preset = avatarPreset(avatar)
  if (preset === null) return null
  return h(
    'span',
    {
      className: `buka-workflows-avatar${className === '' ? '' : ` ${className}`}`,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(8, Math.round(size * 0.62))}px`,
        backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
        borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`,
      },
      'aria-hidden': true,
    },
    preset.emoji,
  )
}
