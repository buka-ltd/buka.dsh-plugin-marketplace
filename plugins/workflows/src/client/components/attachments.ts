/**
 * 作业附件库与附件预览抽屉。
 */

import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { ClientModal, h } from '../element.ts'
import { formatBytes, formatTime } from '../format.ts'
import type { AppContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import type { AttachmentMeta } from '../types.ts'
import { renderEmpty, renderFailure, renderLoading } from './parts.ts'

/**
 * 附件库视图。
 *
 * @param page
 * @returns React 元素
 */
export function renderAttachments(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const loaded = state.attachments
  if (loaded.error !== null && loaded.data === null) {
    return renderFailure(page, loaded.error, actions.refresh)
  }
  if (loaded.status !== 'ready' && loaded.data === null) return renderLoading(page)
  const items = loaded.data ?? []
  if (items.length === 0) return renderEmpty(t('attachmentsEmpty'), t('attachmentsHint'))
  const jobId = jobIdOf(page)

  return h(
    'div',
    { className: 'buka-workflows-listPane' },
    h('p', { className: 'buka-workflows-hint' }, t('attachmentsHint')),
    h(
      'ul',
      { className: 'buka-workflows-attachmentList' },
      ...items.map((attachment) => renderAttachmentRow(page, jobId, attachment)),
    ),
  )
}

/**
 * 附件库的一行。
 *
 * @param page
 * @param jobId
 * @param attachment
 * @returns React 元素
 */
function renderAttachmentRow(
  page: AppContext,
  jobId: string,
  attachment: AttachmentMeta,
): React.ReactElement {
  const { t, actions, state } = page
  const meta = [
    formatBytes(attachment.bytes),
    attachment.mime,
    formatTime(attachment.createdAt),
  ].filter((part) => typeof part === 'string' && part !== '')
  const sourcePosition =
    typeof attachment.sourcePositionId === 'string' && attachment.sourcePositionId !== ''
      ? attachment.sourcePositionId
      : ''
  // 来源任务可能已经不在当前任务摘要里；只有找得到时才给入口。
  const sourceKnown =
    typeof attachment.sourceTaskId === 'string' &&
    attachment.sourceTaskId !== '' &&
    (state.job.data?.tasks ?? []).some((task) => task.id === attachment.sourceTaskId)

  return h(
    'li',
    { key: attachment.id, className: 'buka-workflows-attachment' },
    h(
      'span',
      { className: 'buka-workflows-attachmentMain' },
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
      sourceKnown
        ? h(
            'button',
            {
              type: 'button',
              className: 'buka-workflows-attachmentSource',
              onClick: () =>
                actions.openTask(
                  typeof attachment.sourceTaskId === 'string' ? attachment.sourceTaskId : '',
                ),
            },
            `${t('attachmentSource')}: ${sourcePosition || attachment.sourceTaskId}`,
          )
        : sourcePosition === ''
          ? null
          : h(
              'span',
              { className: 'buka-workflows-attachmentSource' },
              `${t('attachmentSource')}: ${sourcePosition}`,
            ),
      typeof attachment.description === 'string' && attachment.description !== ''
        ? h('span', { className: 'buka-workflows-attachmentDescription' }, attachment.description)
        : null,
    ),
    h('span', { className: 'buka-workflows-attachmentMeta' }, meta.join(' · ')),
    h(
      'a',
      {
        className: 'buka-workflows-attachmentDownload',
        href: attachmentUrl(jobId, attachment.id),
        download: attachment.name,
      },
      t('attachmentDownload'),
    ),
  )
}

/**
 * 附件预览抽屉：头部是文件身份与下载 / 关闭，正文按 Host 返回的 `kind` 分派。
 *
 * @param page
 * @returns React 元素；没有打开附件时为 null
 */
export function renderAttachmentDrawer(page: AppContext): React.ReactElement | null {
  const { t, state, actions } = page
  const viewer = state.attachment
  if (viewer === null) return null
  const jobId = jobIdOf(page)
  const preview = viewer.data
  const meta = [
    preview !== null && typeof preview.bytes === 'number' ? formatBytes(preview.bytes) : '',
    preview !== null && typeof preview.mime === 'string' ? preview.mime : '',
  ]
    .filter((part) => part !== '')
    .join(' · ')

  const body: React.ReactElement[] = []
  if (viewer.status === 'loading') {
    body.push(
      h(
        'p',
        { className: 'buka-workflows-statusWithDot', role: 'status' },
        h(StateDot, { state: 'ongoing' }),
        t('attachmentPreviewLoading'),
      ),
    )
  } else if (viewer.status === 'failed') {
    body.push(
      h(
        'p',
        { className: 'buka-workflows-failure', role: 'alert' },
        viewer.error ?? t('attachmentPreviewFailed'),
      ),
    )
    body.push(
      h(
        'div',
        { className: 'buka-workflows-drawerActions' },
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workflows-smallButton',
            onClick: () => actions.openAttachment(viewer.id, viewer.name),
          },
          t('attachmentPreviewRetry'),
        ),
      ),
    )
  } else if (preview !== null) {
    if (preview.kind === 'image') {
      body.push(
        h('img', {
          className: 'buka-workflows-drawerImage',
          src: attachmentUrl(jobId, viewer.id, 'inline'),
          alt: viewer.name,
        }),
      )
    } else if (preview.kind === 'pdf') {
      body.push(
        h('iframe', {
          className: 'buka-workflows-drawerFrame',
          src: attachmentUrl(jobId, viewer.id, 'inline'),
          title: viewer.name,
        }),
      )
      body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewPdfHint')))
    } else if (preview.kind === 'text') {
      const text = typeof preview.text === 'string' ? preview.text : ''
      body.push(
        text === ''
          ? h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewEmpty'))
          : h('pre', { className: 'buka-workflows-pre' }, text),
      )
      if (preview.truncated === true) {
        body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewTruncated')))
      }
    } else if (preview.kind === 'binary') {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewBinary')))
    } else {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewUnsupported')))
    }
  }

  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: actions.closeAttachment,
      title: viewer.name,
      closeLabel: t('attachmentPreviewClose'),
      backdropBlur: false,
      className: 'buka-workflows-drawer',
    },
    h(
      'div',
      { className: 'buka-workflows-drawerHead' },
      h(
        'div',
        { className: 'buka-workflows-drawerTitleRow' },
        h('span', { className: 'buka-workflows-drawerTitle' }, viewer.name),
      ),
      meta === '' ? null : h('span', { className: 'buka-workflows-drawerMeta' }, meta),
      h(
        'div',
        { className: 'buka-workflows-drawerActions' },
        h(
          'a',
          {
            className: 'buka-workflows-drawerDownload',
            href: attachmentUrl(jobId, viewer.id),
            download: viewer.name,
          },
          t('attachmentDownload'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'buka-workflows-drawerClose',
            'aria-label': t('attachmentPreviewClose'),
            title: t('attachmentPreviewClose'),
            onClick: actions.closeAttachment,
          },
          h('span', { 'aria-hidden': true }, '×'),
        ),
      ),
    ),
    h('div', { className: 'buka-workflows-drawerBody' }, ...body),
  )
}

/**
 * 当前作业 id。
 *
 * @param page
 * @returns
 */
function jobIdOf(page: AppContext): string {
  if (page.state.route.kind === 'job') return page.state.route.jobId
  return page.state.job.data?.job?.id ?? ''
}
