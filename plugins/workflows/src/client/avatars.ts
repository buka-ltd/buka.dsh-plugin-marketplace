/**
 * 预设头像：id → emoji / 底色。
 *
 * 预设表统一在界面侧公共包里，与 workers 页共用同一份；图模型只带 id，
 * 不认识的 id 当作没有头像。人岗位与「已删执行者」不在预设表里，各有专门的
 * id，由这里换成固定画法。
 */

import { findAvatarPreset } from '@buka/plugin-ui'
import type React from 'react'

import { h } from './element.ts'
import type { Executor } from './types.ts'

/** 人岗位专用头像 id；不属于执行者预设，执行者页也选不到。 */
export const HUMAN_AVATAR_ID = '__human__'

/** 已删执行者的占位头像 id；图节点只带 id，渲染时换成灰色问号。 */
export const MISSING_AVATAR_ID = '__missing-worker__'

/** 人岗位头像里画的人；与执行者的动物头像区分开。 */
const HUMAN_AVATAR_EMOJI = '🧑'

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
 * 执行者 → 节点 / 抽屉里画的头像 id。
 *
 * 已删执行者优先：登记表里查不到时画灰色问号，不再区分人还是执行者。人岗位
 * 拿专用头像，执行者岗位用登记表里挑的那一个。
 *
 * @param executor 岗位上的执行者；缺失时返回 undefined
 * @returns 头像 id，或 undefined（不画头像）
 */
export function executorAvatarId(executor: Executor | null | undefined): string | undefined {
  if (executor === null || executor === undefined) return undefined
  if (executor.missing === true) return MISSING_AVATAR_ID
  if (executor.kind === 'human') return HUMAN_AVATAR_ID
  return typeof executor.avatar === 'string' && executor.avatar !== '' ? executor.avatar : undefined
}

/**
 * 执行者头像小圆片：emoji 画在预设色的浅底上。[size] 是直径（px），`className`
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
  if (avatar === MISSING_AVATAR_ID) return renderMissingAvatar(size, className)
  if (avatar === HUMAN_AVATAR_ID) return renderHumanAvatar(size, className)
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

/**
 * 人岗位的头像：人像 emoji 画在琥珀色浅底上，与图上人节点的描边同色；固定不变，
 * 不参与执行者头像的挑选。
 *
 * @param size 直径（px）
 * @param className 额外类名
 * @returns React 元素
 */
export function renderHumanAvatar(size: number, className = ''): React.ReactElement {
  return h(
    'span',
    {
      className: `buka-workflows-avatar buka-workflows-avatarHuman${className === '' ? '' : ` ${className}`}`,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(8, Math.round(size * 0.62))}px`,
      },
      'aria-hidden': true,
    },
    HUMAN_AVATAR_EMOJI,
  )
}

/**
 * 已删执行者的占位头像：灰色圆片 + 问号，与预设头像同样尺寸。
 *
 * @param size 直径（px）
 * @param className 额外类名
 * @returns React 元素
 */
export function renderMissingAvatar(size: number, className = ''): React.ReactElement {
  return h(
    'span',
    {
      className: `buka-workflows-avatar buka-workflows-avatarMissing${className === '' ? '' : ` ${className}`}`,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(8, Math.round(size * 0.62))}px`,
      },
      'aria-hidden': true,
    },
    '?',
  )
}
