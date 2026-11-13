/**
 * 作业的「资产」Tab：资产池。
 *
 * 附件按来源任务分组；最终交付物的内容在概览里看，这里保留它并标「最终」。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { formatBytes, formatTime } from '../format.ts'
import {
  assetGroups,
  currentDefinition,
  currentJobDefinition,
  jobTasks,
  mergedDefinition,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import type { AttachmentMeta } from '../types.ts'
import { renderEmpty, renderFailure, renderLoading } from './parts.ts'

/** 资产视图。 */
export function renderJobOutputs(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.attachments
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.status !== 'ready' && loaded.data === null) return renderLoading(page)
  const items = loaded.data ?? []
  if (items.length === 0) return renderEmpty(t('outputsEmpty'), t('outputsEmptyHint'))
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const tasks = jobTasks(state)
  const groups = assetGroups(items, tasks, definition, {
    start: t('boardStart'),
    end: t('boardEnd'),
  })
  const jobId = state.route.kind === 'job' ? state.route.jobId : ''

  return h(
    'div',
    { className: 'buka-workflows-outputsPane' },
    h('p', { className: 'buka-workflows-hint' }, t('outputsHint')),
    ...groups.map((group) =>
      h(
        'section',
        { key: group.key, className: 'buka-workflows-outputGroup' },
        h(
          'div',
          { className: 'buka-workflows-outputGroupHead' },
          h(
            'span',
            { className: 'buka-workflows-outputGroupTitle' },
            group.label === '' ? t('outputsUnlinked') : group.label,
          ),
          group.positionLabel === ''
            ? null
            : h('span', { className: 'buka-workflows-hint' }, group.positionLabel),
          group.final ? h(Tag, { tone: 'success' }, t('outputsFinal')) : null,
          h('span', { className: 'buka-workflows-outputGroupCount' }, String(group.items.length)),
        ),
        h(
          'ul',
          { className: 'buka-workflows-attachmentList' },
          ...group.items.map((attachment) => renderAsset(page, jobId, attachment, group.taskId)),
        ),
      ),
    ),
  )
}

/** 一个资产。 */
function renderAsset(
  page: AppContext,
  jobId: string,
  attachment: AttachmentMeta,
  taskId: string,
): React.ReactElement {
  const { t, actions } = page
  const meta = [
    formatBytes(attachment.bytes),
    attachment.mime,
    typeof attachment.createdAt === 'string' ? formatTime(attachment.createdAt) : '',
    typeof attachment.createdBy === 'string' && attachment.createdBy !== ''
      ? `${t('attachmentBy')} ${attachment.createdBy}`
      : '',
  ].filter((part) => typeof part === 'string' && part !== '')
  return h(
    'li',
    { key: attachment.id, className: 'buka-workflows-asset' },
    h(
      'span',
      { className: 'buka-workflows-assetMain' },
      h(
        'button',
        {
          type: 'button',
          className: 'buka-workflows-attachmentLink',
          title: t('attachmentPreview'),
          onClick: () => actions.openAttachment(attachment.id, attachment.name),
        },
        attachment.name,
      ),
      typeof attachment.description === 'string' && attachment.description !== ''
        ? h('span', { className: 'buka-workflows-attachmentDescription' }, attachment.description)
        : null,
      h('span', { className: 'buka-workflows-attachmentMeta' }, meta.join(' · ')),
    ),
    h(
      'span',
      { className: 'buka-workflows-assetActions' },
      taskId === ''
        ? null
        : h(
            'button',
            {
              type: 'button',
              className: 'buka-workflows-textButton',
              onClick: () => actions.openTask(taskId),
            },
            t('outputsOpenSource'),
          ),
      h(
        'a',
        {
          className: 'buka-workflows-attachmentDownload',
          href: attachmentUrl(jobId, attachment.id),
          download: attachment.name,
        },
        t('attachmentDownload'),
      ),
    ),
  )
}
