/**
 * 「打工人」页面里的创建 / 更换头像 / 重命名对话框。
 *
 * 三个对话框都由页面状态控制 `open`，提交中不响应关闭；失败提示留在框里，
 * 避免被 Toast 遮住。
 *
 * @module @buka/dsh-plugin-workers/client/components/worker-dialogs
 */

import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FormEvent, ReactElement } from 'react'
import React from 'react'
import type { createDetailActions } from '../actions/detail.ts'
import type { createWorkerActions } from '../actions/workers.ts'
import { workerIdentityLabel } from '../api.ts'
import {
  AVATAR_FORM_ID,
  CREATE_FORM_ID,
  isValidWorkerId,
  RENAME_FORM_ID,
  WORKER_DESCRIPTION_MAX_LENGTH,
  WORKER_NAME_MAX_LENGTH,
} from '../constants.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate } from '../types.ts'
import { AvatarPicker } from './common.ts'

type WorkerActions = ReturnType<typeof createWorkerActions>
type DetailActions = ReturnType<typeof createDetailActions>

/**
 * 创建打工人对话框。
 *
 */
export function CreateWorkerDialog({
  t,
  state,
  actions,
}: {
  t: Translate
  state: WorkersPageState
  actions: WorkerActions
}): ReactElement {
  const {
    dialogOpen,
    creating,
    createId,
    setCreateId,
    createName,
    setCreateName,
    workers,
    draftDescription,
    setDraftDescription,
    draftAvatar,
    setDraftAvatar,
    createError,
  } = state
  const { createWorker, closeCreateDialog } = actions
  const idValue = createId.trim()
  const idTaken = workers.some((worker) => worker.id === idValue)
  const canCreate = isValidWorkerId(idValue) && !idTaken
  return (
    // 「创建打工人」对话框：标识符必填且创建后不可改，展示名可选；回车可提交。
    // 创建失败留在框里提示，提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
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
              disabled: creating || !canCreate,
            },
            creating ? t('creating') : t('create'),
          ),
        ),
      },
      h(
        'form',
        { id: CREATE_FORM_ID, className: 'buka-workers-dialogForm', onSubmit: createWorker },
        h(
          'div',
          { className: 'buka-workers-avatarField' },
          h('span', { className: 'buka-workers-fieldLabel' }, t('avatar')),
          h(AvatarPicker, {
            t,
            current: draftAvatar,
            disabled: creating,
            onSelect: setDraftAvatar,
          }),
        ),
        h(
          'label',
          { className: 'buka-workers-field' },
          h('span', { className: 'buka-workers-fieldLabel' }, t('createFieldId')),
          h(Input, {
            className: 'buka-workers-fieldInput',
            type: 'text',
            value: createId,
            placeholder: t('createIdPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            maxLength: 64,
            disabled: creating,
            'data-modal-autofocus': '',
            onChange: (event: { target: { value: string } }) => setCreateId(event.target.value),
          }),
          idValue !== '' && !isValidWorkerId(idValue)
            ? h('span', { className: 'buka-workers-formError' }, t('errInvalidId'))
            : idTaken
              ? h('span', { className: 'buka-workers-formError' }, t('errIdTaken'))
              : h('span', { className: 'buka-workers-fieldHint' }, t('createIdHint')),
        ),
        h(
          'label',
          { className: 'buka-workers-field' },
          h('span', { className: 'buka-workers-fieldLabel' }, t('createFieldName')),
          h(Input, {
            className: 'buka-workers-fieldInput',
            type: 'text',
            value: createName,
            placeholder: t('createNamePlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            maxLength: WORKER_NAME_MAX_LENGTH,
            disabled: creating,
            onChange: (event: { target: { value: string } }) => setCreateName(event.target.value),
          }),
          h('span', { className: 'buka-workers-fieldHint' }, t('createNameHint')),
        ),
        h(
          'label',
          { className: 'buka-workers-field' },
          h('span', { className: 'buka-workers-fieldLabel' }, t('descriptionLabel')),
          h('textarea', {
            className: 'buka-workers-descriptionInput',
            value: draftDescription,
            placeholder: t('descriptionPlaceholder'),
            maxLength: WORKER_DESCRIPTION_MAX_LENGTH,
            rows: 2,
            disabled: creating,
            onChange: (event: { target: { value: string } }) =>
              setDraftDescription(event.target.value),
          }),
          h('span', { className: 'buka-workers-fieldHint' }, t('descriptionHint')),
        ),
        createError === null
          ? null
          : h('p', { className: 'buka-workers-formError', role: 'alert' }, createError),
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
  state: WorkersPageState
  detail: DetailActions
}): ReactElement {
  const {
    avatarOpen,
    avatarSaving,
    avatarTarget,
    draftAvatar,
    setDraftAvatar,
    avatarError,
    selectedWorker,
  } = state
  const { closeAvatarDialog, saveAvatar } = detail
  return (
    // 「更换头像」对话框：从预设里选一个，保存后只更新登记表里的 avatar。
    h(
      Modal,
      {
        open: avatarOpen,
        onClose: closeAvatarDialog,
        title:
          avatarTarget === null || selectedWorker === null
            ? t('changeAvatar')
            : `${t('changeAvatar')} · ${workerIdentityLabel(selectedWorker)}`,
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
          className: 'buka-workers-dialogForm',
          onSubmit: (event: FormEvent) => {
            event.preventDefault()
            saveAvatar()
          },
        },
        h(
          'div',
          { className: 'buka-workers-avatarField' },
          h('span', { className: 'buka-workers-fieldLabel' }, t('chooseAvatar')),
          h(AvatarPicker, {
            t,
            current: draftAvatar,
            disabled: avatarSaving,
            onSelect: setDraftAvatar,
          }),
        ),
        avatarError === null
          ? null
          : h('p', { className: 'buka-workers-formError', role: 'alert' }, avatarError),
      ),
    )
  )
}

/**
 * 重命名打工人对话框。
 *
 */
export function RenameDialog({
  t,
  state,
  detail,
}: {
  t: Translate
  state: WorkersPageState
  detail: DetailActions
}): ReactElement {
  const { renameOpen, renameSaving, selectedWorker, renameDraft, setRenameDraft, renameError } =
    state
  const { closeRenameDialog, renameWorker } = detail
  return (
    // 「重命名打工人」对话框：只改展示名；输入为空表示清空（之后显示标识符）。
    // 目录不移动、工作区不重建。失败提示留在框里；保存中不响应关闭。
    h(
      Modal,
      {
        open: renameOpen,
        onClose: closeRenameDialog,
        title:
          selectedWorker === null
            ? t('rename')
            : `${t('rename')} · ${workerIdentityLabel(selectedWorker)}`,
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
                selectedWorker === null ||
                renameDraft.trim() === selectedWorker.name,
            },
            renameSaving ? t('saving') : t('save'),
          ),
        ),
      },
      renameOpen && selectedWorker !== null
        ? h(
            'form',
            { id: RENAME_FORM_ID, className: 'buka-workers-dialogForm', onSubmit: renameWorker },
            h(
              'label',
              { className: 'buka-workers-field' },
              h('span', { className: 'buka-workers-fieldLabel' }, t('renameFieldLabel')),
              h(Input, {
                className: 'buka-workers-fieldInput',
                type: 'text',
                value: renameDraft,
                placeholder: String(selectedWorker.name ?? selectedWorker.id ?? ''),
                autoComplete: 'off',
                spellCheck: false,
                maxLength: WORKER_NAME_MAX_LENGTH,
                disabled: renameSaving,
                'data-modal-autofocus': '',
                onChange: (event: { target: { value: string } }) =>
                  setRenameDraft(event.target.value),
              }),
            ),
            h('p', { className: 'buka-workers-fieldHint' }, t('renameHint')),
            renameError === null
              ? null
              : h('p', { className: 'buka-workers-formError', role: 'alert' }, renameError),
          )
        : null,
    )
  )
}

/**
 * 删除打工人确认弹窗。
 *
 * 删除是硬删：登记条目、打工人目录与工作区注册行一起消失，目录里的
 * AGENTS.md 与项目 skills 也会一起消失。弹窗先列出影响面（阻塞的作业、
 * 会变成不可用的工作流、历史作业数量、将被删除的目录）；存在引用该打工人的
 * 运行中作业时禁用确认，只能先去作业页主动终止它们。
 *
 */
export function DeleteWorkerDialog({
  t,
  state,
  actions,
}: {
  t: Translate
  state: WorkersPageState
  actions: WorkerActions
}): ReactElement {
  const { deleteDialog } = state
  const { closeDeleteDialog, confirmDeleteWorker, openJob } = actions
  const target = deleteDialog.target
  const impact = deleteDialog.impact
  const runningJobs = impact?.blockers.runningJobs ?? []
  const blocked = runningJobs.length > 0
  const workflows = impact?.workflows ?? []
  const footer =
    target === null
      ? null
      : h(
          React.Fragment,
          null,
          h(
            Button,
            {
              variant: 'outline',
              onClick: closeDeleteDialog,
              disabled: deleteDialog.saving,
            },
            t('cancel'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              className: 'buka-workers-danger',
              disabled: blocked || deleteDialog.saving || deleteDialog.loading,
              onClick: () => void confirmDeleteWorker(),
            },
            deleteDialog.saving ? t('deleting') : t('deleteConfirm'),
          ),
        )

  return h(
    Modal,
    {
      open: target !== null,
      onClose: closeDeleteDialog,
      title:
        target === null ? t('deleteTitle') : `${t('deleteTitle')} · ${workerIdentityLabel(target)}`,
      closeLabel: t('close'),
      footer,
    },
    target === null
      ? null
      : h(
          'div',
          { className: 'buka-workers-dialogForm' },
          h('p', { className: 'buka-workers-fieldHint' }, t('deleteHardDeleteNote')),
          deleteDialog.loading
            ? h('p', { className: 'buka-workers-fieldHint' }, t('deleteImpactLoading'))
            : null,
          impact === null
            ? null
            : h(
                React.Fragment,
                null,
                h(
                  'p',
                  { className: 'buka-workers-field' },
                  h('span', { className: 'buka-workers-fieldLabel' }, t('deleteDir')),
                  h('code', { className: 'buka-workers-inlineCode' }, impact.path),
                ),
                h(
                  'p',
                  { className: 'buka-workers-fieldHint' },
                  impact.mounted ? t('deleteMounted') : t('deleteNotMounted'),
                ),
                h(
                  'p',
                  { className: 'buka-workers-fieldHint' },
                  `${t('deleteFinishedJobs')} ${String(impact.finishedJobs)}`,
                ),
                h(
                  'div',
                  { className: 'buka-workers-field' },
                  h(
                    'span',
                    { className: 'buka-workers-fieldLabel' },
                    `${t('deleteAffectedWorkflows')} ${String(workflows.length)}`,
                  ),
                  workflows.length === 0
                    ? h('span', { className: 'buka-workers-fieldHint' }, t('deleteNoWorkflows'))
                    : h(
                        'ul',
                        { className: 'buka-workers-plainList' },
                        ...workflows.map((workflow) =>
                          h(
                            'li',
                            { key: workflow.workflowId },
                            `${workflow.name || workflow.workflowId} · ${workflow.status}`,
                          ),
                        ),
                      ),
                ),
                blocked
                  ? h(
                      'div',
                      { className: 'buka-workers-field' },
                      h('span', { className: 'buka-workers-fieldLabel' }, t('deleteBlockedTitle')),
                      h(
                        'ul',
                        { className: 'buka-workers-plainList' },
                        ...runningJobs.map((job) =>
                          h(
                            'li',
                            { key: job.jobId, className: 'buka-workers-jobBlocker' },
                            h(
                              'span',
                              null,
                              `${job.jobName || job.workflowName || job.workflowId} #${String(job.jobSeq)}`,
                            ),
                            h(
                              Button,
                              { variant: 'outline', onClick: () => openJob(job) },
                              t('deleteOpenJob'),
                            ),
                          ),
                        ),
                      ),
                      h(
                        'p',
                        { className: 'buka-workers-formError', role: 'alert' },
                        t('deleteBlockedByJobs'),
                      ),
                    )
                  : null,
              ),
          deleteDialog.error === null
            ? null
            : h('p', { className: 'buka-workers-formError', role: 'alert' }, deleteDialog.error),
        ),
  )
}
