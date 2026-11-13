/**
 * 新建作业对话框：先填需求（原始输入），再填启动任务的结构化输入。
 *
 * 结构化输入会按开始任务的 output schema 被 Host 校验，所以不能省略；这里把它
 * 解释成「启动任务整理出的字段」，而不是一个技术概念。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import React from 'react'

import { ClientModal, h } from '../element.ts'
import { currentDefinition } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { renderJsonFallback, renderSchemaFields, schemaFields } from '../schema.ts'
import type { JsonSchema } from '../types.ts'
import { isRecord } from '../types.ts'

/** 新建作业对话框。 */
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

  const rawSection = h(
    'section',
    { key: 'raw', className: 'buka-workflows-dialogSection' },
    h('h3', { className: 'buka-workflows-dialogSectionTitle' }, t('newJobRawTitle')),
    h('p', { className: 'buka-workflows-fieldHint' }, t('newJobRawHint')),
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
              h('span', { className: 'buka-workflows-required' }, ` · ${t('schemaFieldRequired')}`),
            ),
            h('textarea', {
              id: 'buka-workflows-newjob-raw-request',
              className: 'buka-workflows-textarea',
              rows: 4,
              value: dialog.raw.request ?? '',
              placeholder: t('newJobRawPlaceholder'),
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
                actions.setNewJobRaw('request', event.target.value),
            }),
          ),
        ]),
  )

  const structuredSection = h(
    'section',
    { key: 'structured', className: 'buka-workflows-dialogSection' },
    h('h3', { className: 'buka-workflows-dialogSectionTitle' }, t('newJobStructuredTitle')),
    h('p', { className: 'buka-workflows-fieldHint' }, t('newJobStructuredHint')),
    ...(structuredHasFields
      ? renderSchemaFields(page, {
          schema: structuredSchema,
          values: dialog.structured,
          onChange: actions.setNewJobStructured,
          idPrefix: 'buka-workflows-newjob-structured',
        })
      : [
          h(
            'details',
            { key: 'structured-json', className: 'buka-workflows-details' },
            h(
              'summary',
              { className: 'buka-workflows-detailsSummary' },
              t('newJobStructuredAdvanced'),
            ),
            renderJsonFallback(
              page,
              dialog.structured.__json ?? '',
              (next) => actions.setNewJobStructured('__json', next),
              'buka-workflows-newjob-structured-json',
            ),
          ),
        ]),
  )

  const body: React.ReactNode[] = [
    h('p', { key: 'hint', className: 'buka-workflows-hint' }, t('newJobHint')),
    rawSection,
    structuredSection,
    dialog.error === null
      ? null
      : h(
          'p',
          { key: 'error', className: 'buka-workflows-formError', role: 'alert' },
          dialog.error,
        ),
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
