/**
 * 自动归档设置对话框。
 */

import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import React from 'react'
import { ClientModal, h } from '../element.ts'
import type { PageContext } from '../page-context.ts'

/**
 * 自动归档设置对话框：启用开关 + 归档 / 删除小时数 + 保存。打开时先读 Host
 * 的当前设置，输入按整小时校验；读 / 存失败都留在框里说明原因。
 *
 * @returns React 元素
 */
export function renderSettingsDialog(page: PageContext): React.ReactElement {
  const {
    t,
    settingsOpen,
    settingsDraft,
    setSettingsDraft,
    settingsLoading,
    settingsSaving,
    settingsError,
    settingsValidationError,
    closeSettingsDialog,
    saveSettings,
  } = page

  const draft = settingsDraft
  const validation = draft === null ? null : settingsValidationError(draft)
  const saving = settingsSaving
  const canSave = !saving && !settingsLoading && draft !== null && validation === null
  /** @param text 错误文案 */
  const formError = (text: string): React.ReactElement =>
    h('p', { className: 'buka-workflows-formError', role: 'alert' }, text)
  const body = []
  if (settingsLoading) {
    body.push(h('p', { className: 'buka-workflows-hint' }, t('settingsLoading')))
  }
  if (draft === null) {
    if (!settingsLoading && settingsError !== null) body.push(formError(settingsError))
  } else {
    body.push(
      h(
        'div',
        { className: 'buka-workflows-settingRow' },
        h(
          'div',
          { className: 'buka-workflows-settingText' },
          h(
            'div',
            { className: 'buka-workflows-settingHead' },
            h('span', { className: 'buka-workflows-settingTitle' }, t('archiveEnabled')),
            h(
              Tag,
              { tone: draft.enabled ? 'success' : 'neutral' },
              draft.enabled ? t('settingsEnabled') : t('settingsDisabled'),
            ),
          ),
          h('span', { className: 'buka-workflows-settingDesc' }, t('archiveEnabledDesc')),
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': draft.enabled,
            'aria-label': t('archiveEnabled'),
            className: `buka-workflows-switch${draft.enabled ? ' is-on' : ''}`,
            disabled: saving,
            onClick: () =>
              setSettingsDraft((current) =>
                current === null ? current : { ...current, enabled: !current.enabled },
              ),
          },
          h('span', { className: 'buka-workflows-switchThumb', 'aria-hidden': true }),
        ),
      ),
      h(
        'div',
        { className: 'buka-workflows-hoursField' },
        h('span', { className: 'buka-workflows-fieldLabel' }, t('archiveAfterHours')),
        h(
          'div',
          { className: 'buka-workflows-hoursControl' },
          h(Input, {
            type: 'number',
            min: 1,
            max: 720,
            step: 1,
            value: draft.archiveHours,
            disabled: saving || !draft.enabled,
            className: 'buka-workflows-hoursInput',
            onChange: (event) =>
              setSettingsDraft((current) =>
                current === null
                  ? current
                  : { ...current, archiveHours: String(event.target.value) },
              ),
          }),
          h('span', { className: 'buka-workflows-hoursUnit' }, t('hoursUnit')),
        ),
        h('span', { className: 'buka-workflows-fieldHint' }, t('archiveAfterHoursHint')),
      ),
      h(
        'div',
        { className: 'buka-workflows-hoursField' },
        h('span', { className: 'buka-workflows-fieldLabel' }, t('deleteAfterHours')),
        h(
          'div',
          { className: 'buka-workflows-hoursControl' },
          h(Input, {
            type: 'number',
            min: 2,
            max: 8760,
            step: 1,
            value: draft.deleteHours,
            disabled: saving || !draft.enabled,
            className: 'buka-workflows-hoursInput',
            onChange: (event) =>
              setSettingsDraft((current) =>
                current === null
                  ? current
                  : { ...current, deleteHours: String(event.target.value) },
              ),
          }),
          h('span', { className: 'buka-workflows-hoursUnit' }, t('hoursUnit')),
        ),
        h('span', { className: 'buka-workflows-fieldHint' }, t('deleteAfterHoursHint')),
      ),
      h('p', { className: 'buka-workflows-hint' }, t('archiveDefaultsHint')),
    )
    if (validation !== null) body.push(formError(validation))
    if (settingsError !== null) body.push(formError(settingsError))
  }
  return h(
    ClientModal,
    {
      open: settingsOpen,
      onClose: closeSettingsDialog,
      title: t('archiveSettingsTitle'),
      closeLabel: t('close'),
      footer: h(
        React.Fragment,
        null,
        h(
          Button,
          { variant: 'outline', onClick: closeSettingsDialog, disabled: saving },
          t('cancel'),
        ),
        h(
          Button,
          { variant: 'primary', type: 'button', onClick: saveSettings, disabled: !canSave },
          saving ? t('saving') : t('save'),
        ),
      ),
    },
    h('div', { className: 'buka-workflows-dialogForm' }, ...body),
  )
}
