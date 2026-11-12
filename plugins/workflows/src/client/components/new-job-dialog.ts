/**
 * 新建作业对话框：人启动 = 原始输入 + 结构化输入。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import React from 'react'

import { ClientModal, h } from '../element.ts'
import { currentDefinition } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { renderJsonFallback, renderSchemaFields, schemaFields } from '../schema.ts'
import type { JsonSchema } from '../types.ts'
import { isRecord } from '../types.ts'

/**
 * 新建作业对话框。
 *
 * @param page
 * @returns React 元素
 */
export function renderNewJobDialog(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const dialog = state.newJob
  const definition = currentDefinition(state)
  const start = definition?.start?.task
  const rawSchema: JsonSchema | null = isRecord(start?.payload)
    ? (start.payload as JsonSchema)
    : null
  const structuredSchema: JsonSchema | null = isRecord(start?.output)
    ? (start.output as JsonSchema)
    : null
  const rawHasFields = schemaFields(rawSchema).length > 0
  const structuredHasFields = schemaFields(structuredSchema).length > 0

  const body: React.ReactNode[] = [
    h('p', { className: 'buka-workflows-hint' }, t('newJobHint')),
    h(
      'div',
      { className: 'buka-workflows-field' },
      h('span', { className: 'buka-workflows-fieldLabel' }, t('newJobRawTitle')),
      h('p', { className: 'buka-workflows-fieldHint' }, t('newJobRawHint')),
    ),
    ...(rawHasFields
      ? renderSchemaFields(page, {
          schema: rawSchema,
          values: dialog.raw,
          onChange: actions.setNewJobRaw,
          idPrefix: 'buka-workflows-newjob-raw',
        })
      : [
          h(
            'div',
            { key: 'raw-fallback', className: 'buka-workflows-field' },
            h(
              'label',
              {
                className: 'buka-workflows-fieldLabel',
                htmlFor: 'buka-workflows-newjob-raw-request',
              },
              t('newJobRawFallback'),
            ),
            h('textarea', {
              id: 'buka-workflows-newjob-raw-request',
              className: 'buka-workflows-textarea',
              rows: 3,
              value: dialog.raw.request ?? '',
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
                actions.setNewJobRaw('request', event.target.value),
            }),
          ),
        ]),
    h(
      'div',
      { className: 'buka-workflows-field' },
      h('span', { className: 'buka-workflows-fieldLabel' }, t('newJobStructuredTitle')),
      h('p', { className: 'buka-workflows-fieldHint' }, t('newJobStructuredHint')),
    ),
    ...(structuredHasFields
      ? renderSchemaFields(page, {
          schema: structuredSchema,
          values: dialog.structured,
          onChange: actions.setNewJobStructured,
          idPrefix: 'buka-workflows-newjob-structured',
        })
      : [
          renderJsonFallback(
            page,
            dialog.structured.__json ?? '',
            (next) => actions.setNewJobStructured('__json', next),
            'buka-workflows-newjob-structured-json',
          ),
        ]),
    dialog.error === null
      ? null
      : h('p', { className: 'buka-workflows-formError', role: 'alert' }, dialog.error),
  ]

  return h(
    ClientModal,
    {
      open: dialog.open,
      onClose: actions.closeNewJob,
      title: t('newJobTitle'),
      closeLabel: t('close'),
      footer: h(
        React.Fragment,
        null,
        h(
          Button,
          { variant: 'outline', onClick: actions.closeNewJob, disabled: dialog.submitting },
          t('cancel'),
        ),
        h(
          Button,
          {
            variant: 'primary',
            type: 'button',
            onClick: actions.submitNewJob,
            disabled: dialog.submitting,
          },
          dialog.submitting ? t('newJobSubmitting') : t('newJobSubmit'),
        ),
      ),
    },
    h('div', { className: 'buka-workflows-dialogForm' }, ...body),
  )
}
