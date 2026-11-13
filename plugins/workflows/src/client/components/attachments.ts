/**
 * 附件预览抽屉：头部是文件身份与下载 / 关闭，正文按 Host 返回的 `kind` 分派。
 */

import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { ClientModal, h } from '../element.ts'
import { formatBytes } from '../format.ts'
import type { AppContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import { renderDrawerHead } from './parts.ts'

/** 附件预览抽屉。 */
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
    renderDrawerHead({
      title: viewer.name,
      meta,
      actions: h(
        'a',
        {
          className: 'buka-workflows-drawerDownload',
          href: attachmentUrl(jobId, viewer.id),
          download: viewer.name,
        },
        t('attachmentDownload'),
      ),
      onClose: actions.closeAttachment,
      closeLabel: t('attachmentPreviewClose'),
    }),
    h('div', { className: 'buka-workflows-drawerBody' }, ...body),
  )
}

/** 当前作业 id。 */
function jobIdOf(page: AppContext): string {
  if (page.state.route.kind === 'job') return page.state.route.jobId
  return page.state.job.data?.job?.id ?? ''
}
