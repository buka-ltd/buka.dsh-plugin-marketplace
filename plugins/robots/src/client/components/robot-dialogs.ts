/**
 * 「机器人」页面里的创建 / 更换头像 / 重命名对话框。
 *
 * 三个对话框都由页面状态控制 `open`，提交中不响应关闭；失败提示留在框里，
 * 避免被 Toast 遮住。
 *
 * @module @buka/dsh-plugin-robots/client/components/robot-dialogs
 */

import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FormEvent, ReactElement } from 'react'
import React from 'react'
import type { createDetailActions } from '../actions/detail.ts'
import type { createRobotActions } from '../actions/robots.ts'
import {
  AVATAR_FORM_ID,
  CREATE_FORM_ID,
  RENAME_FORM_ID,
  ROBOT_DESCRIPTION_MAX_LENGTH,
} from '../constants.ts'
import { h } from '../h.ts'
import type { RobotsPageState } from '../state.ts'
import type { Translate } from '../types.ts'
import { AvatarPicker } from './common.ts'

type RobotActions = ReturnType<typeof createRobotActions>
type DetailActions = ReturnType<typeof createDetailActions>

/**
 * 创建机器人对话框。
 *
 */
export function CreateRobotDialog({
  t,
  state,
  actions,
}: {
  t: Translate
  state: RobotsPageState
  actions: RobotActions
}): ReactElement {
  const {
    dialogOpen,
    creating,
    name,
    setName,
    draftDescription,
    setDraftDescription,
    draftAvatar,
    setDraftAvatar,
    createError,
  } = state
  const { createRobot, closeCreateDialog } = actions
  return (
    // 「创建机器人」对话框：名称必填、回车可提交；创建失败留在框里提示，
    // 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
    h(
      Modal,
      {
        open: dialogOpen,
        onClose: closeCreateDialog,
        title: t('create'),
        closeLabel: t('close'),
        footer: h(
          React.Fragment,
          null,
          h(
            Button,
            { variant: 'outline', onClick: closeCreateDialog, disabled: creating },
            t('cancel'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              type: 'submit',
              form: CREATE_FORM_ID,
              disabled: creating || name.trim() === '',
            },
            creating ? t('creating') : t('create'),
          ),
        ),
      },
      h(
        'form',
        { id: CREATE_FORM_ID, className: 'buka-robots-dialogForm', onSubmit: createRobot },
        h(
          'div',
          { className: 'buka-robots-avatarField' },
          h('span', { className: 'buka-robots-fieldLabel' }, t('avatar')),
          h(AvatarPicker, {
            t,
            current: draftAvatar,
            disabled: creating,
            onSelect: setDraftAvatar,
          }),
        ),
        h(
          'label',
          { className: 'buka-robots-field' },
          h('span', { className: 'buka-robots-fieldLabel' }, t('createFieldName')),
          h(Input, {
            className: 'buka-robots-fieldInput',
            type: 'text',
            value: name,
            placeholder: t('createPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            maxLength: 64,
            disabled: creating,
            'data-modal-autofocus': '',
            onChange: (event: { target: { value: string } }) => setName(event.target.value),
          }),
        ),
        h(
          'label',
          { className: 'buka-robots-field' },
          h('span', { className: 'buka-robots-fieldLabel' }, t('descriptionLabel')),
          h('textarea', {
            className: 'buka-robots-descriptionInput',
            value: draftDescription,
            placeholder: t('descriptionPlaceholder'),
            maxLength: ROBOT_DESCRIPTION_MAX_LENGTH,
            rows: 2,
            disabled: creating,
            onChange: (event: { target: { value: string } }) =>
              setDraftDescription(event.target.value),
          }),
          h('span', { className: 'buka-robots-fieldHint' }, t('descriptionHint')),
        ),
        createError === null
          ? null
          : h('p', { className: 'buka-robots-formError', role: 'alert' }, createError),
      ),
    )
  )
}

/**
 * 更换头像对话框。
 *
 */
export function AvatarDialog({
  t,
  state,
  detail,
}: {
  t: Translate
  state: RobotsPageState
  detail: DetailActions
}): ReactElement {
  const { avatarOpen, avatarSaving, avatarTarget, draftAvatar, setDraftAvatar, avatarError } = state
  const { closeAvatarDialog, saveAvatar } = detail
  return (
    // 「更换头像」对话框：从预设里选一个，保存后只更新登记表里的 avatar。
    h(
      Modal,
      {
        open: avatarOpen,
        onClose: closeAvatarDialog,
        title: avatarTarget === null ? t('changeAvatar') : `${t('changeAvatar')} · ${avatarTarget}`,
        closeLabel: t('close'),
        footer: h(
          React.Fragment,
          null,
          h(
            Button,
            { variant: 'outline', onClick: closeAvatarDialog, disabled: avatarSaving },
            t('cancel'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              type: 'submit',
              form: AVATAR_FORM_ID,
              disabled: avatarSaving || avatarTarget === null,
            },
            avatarSaving ? t('saving') : t('save'),
          ),
        ),
      },
      h(
        'form',
        {
          id: AVATAR_FORM_ID,
          className: 'buka-robots-dialogForm',
          onSubmit: (event: FormEvent) => {
            event.preventDefault()
            saveAvatar()
          },
        },
        h(
          'div',
          { className: 'buka-robots-avatarField' },
          h('span', { className: 'buka-robots-fieldLabel' }, t('chooseAvatar')),
          h(AvatarPicker, {
            t,
            current: draftAvatar,
            disabled: avatarSaving,
            onSelect: setDraftAvatar,
          }),
        ),
        avatarError === null
          ? null
          : h('p', { className: 'buka-robots-formError', role: 'alert' }, avatarError),
      ),
    )
  )
}

/**
 * 重命名机器人对话框。
 *
 */
export function RenameDialog({
  t,
  state,
  detail,
}: {
  t: Translate
  state: RobotsPageState
  detail: DetailActions
}): ReactElement {
  const { renameOpen, renameSaving, selectedRobot, renameDraft, setRenameDraft, renameError } =
    state
  const { closeRenameDialog, renameRobot } = detail
  return (
    // 「重命名机器人」对话框：输入新名称后提交，Host 改目录并重建工作区。
    // 失败提示留在框里；保存中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
    h(
      Modal,
      {
        open: renameOpen,
        onClose: closeRenameDialog,
        title: t('rename'),
        closeLabel: t('close'),
        footer: h(
          React.Fragment,
          null,
          h(
            Button,
            { variant: 'outline', onClick: closeRenameDialog, disabled: renameSaving },
            t('cancel'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              type: 'submit',
              form: RENAME_FORM_ID,
              disabled:
                renameSaving ||
                selectedRobot === null ||
                renameDraft.trim() === '' ||
                renameDraft.trim() === selectedRobot.name,
            },
            renameSaving ? t('saving') : t('save'),
          ),
        ),
      },
      renameOpen && selectedRobot !== null
        ? h(
            'form',
            { id: RENAME_FORM_ID, className: 'buka-robots-dialogForm', onSubmit: renameRobot },
            h(
              'label',
              { className: 'buka-robots-field' },
              h('span', { className: 'buka-robots-fieldLabel' }, t('renameFieldLabel')),
              h(Input, {
                className: 'buka-robots-fieldInput',
                type: 'text',
                value: renameDraft,
                placeholder: String(selectedRobot.name ?? ''),
                autoComplete: 'off',
                spellCheck: false,
                maxLength: 64,
                disabled: renameSaving,
                'data-modal-autofocus': '',
                onChange: (event: { target: { value: string } }) =>
                  setRenameDraft(event.target.value),
              }),
            ),
            h('p', { className: 'buka-robots-fieldHint' }, t('renameHint')),
            renameError === null
              ? null
              : h('p', { className: 'buka-robots-formError', role: 'alert' }, renameError),
          )
        : null,
    )
  )
}
