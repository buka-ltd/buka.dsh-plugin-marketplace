/**
 * 附件预览抽屉：头部是文件身份与下载 / 关闭，正文按 Host 返回的 `kind` 分派。
 */

import {
  Button,
  type MarkdownPathImages,
  MarkdownText,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { ClientModal, h } from '../element.ts'
import { formatBytes } from '../format.ts'
import type { AppContext } from '../page-context.ts'
import { absoluteAttachmentUrl, attachmentUrl } from '../request.ts'
import type { AttachmentImageRef } from '../types.ts'
import { markdownLabels, renderDrawerHead } from './parts.ts'

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
    } else if (preview.kind === 'markdown') {
      const text = typeof preview.text === 'string' ? preview.text : ''
      if (text === '') {
        body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewEmpty')))
      } else {
        const pathImages: MarkdownPathImages = {
          resolve: (value) => resolveMarkdownImage(jobId, preview.images, value),
        }
        body.push(
          h(MarkdownText, { text, streaming: false, labels: markdownLabels(t), pathImages }),
        )
      }
    } else if (preview.kind === 'binary') {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewBinary')))
    } else {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewUnsupported')))
    }
    if ((preview.kind === 'text' || preview.kind === 'markdown') && preview.truncated === true) {
      body.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewTruncated')))
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

/**
 * 把 Markdown 正文里的相对图片目标解析成同作业附件库图片附件的 inline URL。
 * 只按文件名（路径最后一段）精确匹配；未命中返回 `undefined`，渲染器保留原目标。
 *
 * @param jobId 作业 id
 * @param images preview 响应带回的同作业图片附件清单
 * @param destination 正文里原样书写的图片目标
 * @returns inline URL 或 undefined
 */
function resolveMarkdownImage(
  jobId: string,
  images: readonly AttachmentImageRef[] | undefined,
  destination: string,
): string | undefined {
  const name = markdownImageName(destination)
  if (name === undefined || images === undefined) return undefined
  const hit = images.find((image) => image.name === name)
  if (hit === undefined) return undefined
  return absoluteAttachmentUrl(jobId, hit.id)
}

/**
 * 从图片目标里取出文件名：去掉查询 / 片段、解码百分号转义、取路径最后一段；
 * 带协议（http 等，Windows 盘符除外）或解码失败时返回 undefined。
 *
 * @param destination 正文里原样书写的图片目标
 * @returns 文件名或 undefined
 */
function markdownImageName(destination: string): string | undefined {
  const suffix = destination.search(/[?#]/u)
  const raw = suffix === -1 ? destination : destination.slice(0, suffix)
  if (raw.length === 0) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(decoded) && !/^[a-z]:[/\\]/iu.test(decoded)) return undefined
  const segment = decoded.replace(/\\/gu, '/').split('/').pop()
  return segment === undefined || segment === '' ? undefined : segment
}
