/**
 * 「机器人」页面共用的小组件：头像选择器与挂载状态标签。
 *
 * @module @buka/dsh-plugin-robots/client/components/common
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import { AVATARS, renderAvatar } from '../avatar.ts'
import { h } from '../h.ts'
import type { Robot, Translate } from '../types.ts'

/**
 * 预设头像选择器：圆形 emoji 按钮的网格，选中项有描边。创建对话框与
 * 「更换头像」对话框共用；`disabled` 时整组不可点。
 *
 */
export function AvatarPicker({
  t,
  current,
  disabled,
  onSelect,
}: {
  t: Translate
  current: string
  disabled: boolean
  onSelect: (avatarId: string) => void
}): ReactElement {
  return h(
    'div',
    { className: 'buka-robots-avatarGrid', role: 'radiogroup', 'aria-label': t('chooseAvatar') },
    ...AVATARS.map((preset) =>
      h(
        'button',
        {
          key: preset.id,
          type: 'button',
          role: 'radio',
          'aria-checked': preset.id === current,
          'aria-label': t(preset.labelKey),
          title: t(preset.labelKey),
          className: `buka-robots-avatarOption${preset.id === current ? ' is-selected' : ''}`,
          disabled,
          onClick: () => onSelect(preset.id),
        },
        renderAvatar(preset.id, 30),
      ),
    ),
  )
}

/**
 * 挂载状态标签：已挂载用 success，未挂载用 neutral。
 *
 */
export function MountedTag({ t, robot }: { t: Translate; robot: Robot }): ReactElement {
  return h(
    Tag,
    { tone: robot.mounted === true ? 'success' : 'neutral' },
    robot.mounted === true ? t('mountedBadge') : t('unmountedBadge'),
  )
}
