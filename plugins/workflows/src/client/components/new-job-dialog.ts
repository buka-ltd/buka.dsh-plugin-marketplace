/**
 * 新建作业对话框：填发起人的任务内容，并选择结束任务怎么交回。
 *
 * 任务内容按开始节点的 `content` schema 校验；交回方式只有两档——交回发起人，
 * 或交给一个助理代收。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import React from 'react'

import { ClientModal, h } from '../element.ts'
import { currentDefinition, workerIdentity, workerIdentityText } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { renderJsonFallback, renderSchemaFields, schemaFields } from '../schema.ts'
import type { JsonSchema } from '../types.ts'
import { asArray, isRecord } from '../types.ts'

/** 新建作业对话框。 */
export function renderNewJobDialog(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const dialog = state.newJob
  const definition = currentDefinition(state)
  const contentSchema: JsonSchema | null = isRecord(definition?.start?.content)
    ? (definition.start.content as JsonSchema)
    : null
  const hasFields = schemaFields(contentSchema).length > 0
  const assistants = asArray<{ id?: string; name?: string; description?: string }>(
    state.workflow.data?.assistants,
  ).filter(
    (assistant) =>
      (typeof assistant.id === 'string' && assistant.id !== '') ||
      (typeof assistant.name === 'string' && assistant.name !== ''),
  )

  const contentSection = h(
    'section',
    { key: 'content', className: 'buka-workflows-dialogSection' },
    h('h3', { className: 'buka-workflows-dialogSectionTitle' }, t('newJobContentTitle')),
    h('p', { className: 'buka-workflows-fieldHint' }, t('newJobContentHint')),
    ...(hasFields
      ? renderSchemaFields(page, {
          schema: contentSchema,
          values: dialog.content,
          onChange: actions.setNewJobContent,
          idPrefix: 'buka-workflows-newjob-content',
        })
      : [
          renderJsonFallback(
            page,
            dialog.content.__json ?? '',
            (next) => actions.setNewJobContent('__json', next),
            'buka-workflows-newjob-content-json',
          ),
        ]),
  )

  const deliverySection = h(
    'section',
    { key: 'delivery', className: 'buka-workflows-dialogSection' },
    h('h3', { className: 'buka-workflows-dialogSectionTitle' }, t('newJobDeliveryTitle')),
    h('p', { className: 'buka-workflows-fieldHint' }, t('newJobDeliveryHint')),
    h(
      'div',
      { className: 'buka-workflows-field' },
      h(
        'select',
        {
          className: 'buka-workflows-select',
          value: dialog.delivery,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            actions.setNewJobDelivery(event.target.value),
        },
        h('option', { value: 'starter' }, t('newJobDeliveryStarter')),
        ...assistants.map((assistant) => {
          const identity = workerIdentity(assistant)
          return h(
            'option',
            { key: identity.id, value: `assistant:${identity.id}` },
            `${t('newJobDeliveryAssistant')} · ${workerIdentityText(assistant)}`,
          )
        }),
      ),
    ),
  )

  const body: React.ReactNode[] = [
    h('p', { key: 'hint', className: 'buka-workflows-hint' }, t('newJobHint')),
    contentSection,
    deliverySection,
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
