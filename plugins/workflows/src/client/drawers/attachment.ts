/**
 * 附件预览抽屉：预览正文、下载入口与关闭。
 */

import {
  Button,
  CodeBlock,
  FileTypeIcon,
  IconDownloadOutlineRegular,
  languageForPath,
  MarkdownText,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { MarkdownLabelsProp } from '../element.ts'
import { ClientModal, h, withAria } from '../element.ts'
import { formatBytes } from '../format.ts'
import type { PageContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import type { AttachmentViewer } from '../types.ts'

/**
 * Markdown 预览里的链接不接管运行页：http(s) 在新窗口打开，其它协议直接
 * 拦掉；无论哪种都不让页面跳走。
 *
 * @param event
 */
export function interceptAttachmentLink(
  _page: PageContext,
  event: React.MouseEvent<HTMLElement>,
): void {
  event.preventDefault()
  const target = event.target
  const anchor =
    target !== null && typeof (target as HTMLElement).closest === 'function'
      ? (target as HTMLElement).closest('a[href]')
      : null
  if (anchor === null) return
  const href = anchor.getAttribute('href') ?? ''
  if (!/^https?:\/\//iu.test(href)) return
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

/**
 * 文字预览用的 labels：复制按钮，以及代码工具栏的代码 / 换行 / 不换行。
 *
 * @returns
 */
export function attachmentPreviewLabels(page: PageContext): MarkdownLabelsProp {
  const { t } = page

  // 只给复制按钮与代码工具栏的文案；其余 labels 由组件内部兜底。
  return {
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      toolbarLabels: {
        codeLabel: t('code'),
        wrapLabel: t('wrap'),
        unwrapLabel: t('unwrap'),
      },
    },
  } as unknown as MarkdownLabelsProp
}

/**
 * 抽屉里的下载链接：与列表里的下载入口同一个路由，不带 mode。
 *
 * @param viewer
 * @returns
 */
export function renderAttachmentDownload(
  page: PageContext,
  viewer: AttachmentViewer,
): React.ReactElement {
  const { t } = page

  return h(
    'a',
    {
      className: 'buka-workflows-drawerDownload',
      href: attachmentUrl(viewer),
      download: viewer.name,
    },
    typeof IconDownloadOutlineRegular === 'function'
      ? h(IconDownloadOutlineRegular, withAria({ size: 14, 'aria-hidden': true }))
      : null,
    h('span', null, t('attachmentDownload')),
  )
}

/**
 * 抽屉正文：按 Host 返回的 `attachment.kind` 分成文字 / 图片 / PDF / 其它。
 *
 * @param viewer
 * @returns
 */
export function renderAttachmentPreviewBody(
  page: PageContext,
  viewer: AttachmentViewer,
): Array<React.ReactElement | null> {
  const {
    t,
    attachmentView,
    attachmentPreview,
    setAttachmentPreview,
    fetchAttachmentPreview,
    interceptAttachmentLink,
    attachmentPreviewLabels,
    renderAttachmentDownload,
  } = page

  const preview = attachmentPreview
  if (preview.status === 'idle') return []
  if (preview.status === 'loading') {
    return [
      h(
        'div',
        { className: 'buka-workflows-drawerStatus', role: 'status' },
        h(StateDot, { state: 'ongoing' }),
        h('span', null, t('attachmentPreviewLoading')),
      ),
    ]
  }
  if (preview.status === 'failed') {
    return [
      h(
        'p',
        { className: 'buka-workflows-failure', role: 'alert' },
        preview.error ?? t('attachmentPreviewFailed'),
      ),
      h(
        'div',
        { className: 'buka-workflows-drawerActions' },
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workflows-smallButton',
            onClick: () => fetchAttachmentPreview(attachmentView),
          },
          t('attachmentPreviewRetry'),
        ),
        renderAttachmentDownload(viewer),
      ),
    ]
  }
  const data = preview.data !== null && typeof preview.data === 'object' ? preview.data : {}
  if (data.kind === 'image') {
    return [
      h('img', {
        className: 'buka-workflows-drawerImage',
        src: attachmentUrl(viewer, 'inline'),
        alt: viewer.name,
        onError: () =>
          setAttachmentPreview({
            status: 'failed',
            data: null,
            error: t('attachmentPreviewImageFailed'),
          }),
      }),
    ]
  }
  if (data.kind === 'pdf') {
    return [
      h('iframe', {
        className: 'buka-workflows-drawerFrame',
        src: attachmentUrl(viewer, 'inline'),
        title: viewer.name,
      }),
      h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewPdfHint')),
    ]
  }
  if (data.kind === 'text') {
    const text = typeof data.text === 'string' ? data.text : ''
    const children = []
    const markdownFile = /\.(md|markdown)$/iu.test(viewer.name)
    if (text === '') {
      children.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewEmpty')))
    } else if (markdownFile && typeof MarkdownText === 'function') {
      children.push(
        h(
          'div',
          { className: 'buka-workflows-drawerMarkdown', onClickCapture: interceptAttachmentLink },
          h(MarkdownText, { text, omitHtml: true, labels: attachmentPreviewLabels() }),
        ),
      )
    } else if (
      !markdownFile &&
      typeof CodeBlock === 'function' &&
      typeof languageForPath === 'function'
    ) {
      children.push(
        h(CodeBlock, {
          code: text,
          lang: languageForPath(viewer.name),
          lineNumbers: true,
          showHeader: true,
          copyLabel: t('copy'),
          copiedLabel: t('copied'),
          className: 'buka-workflows-drawerCode',
        }),
      )
    } else {
      // 基座里没有 Markdown / 代码渲染组件时退回纯文本，至少让内容可读。
      children.push(h('pre', { className: 'buka-workflows-pre' }, text))
    }
    if (data.truncated === true) {
      children.push(h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewTruncated')))
    }
    return children
  }
  if (data.kind === 'binary') {
    return [
      h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewBinary')),
      h('div', { className: 'buka-workflows-drawerActions' }, renderAttachmentDownload(viewer)),
    ]
  }
  return [
    h('p', { className: 'buka-workflows-hint' }, t('attachmentPreviewUnsupported')),
    h('div', { className: 'buka-workflows-drawerActions' }, renderAttachmentDownload(viewer)),
  ]
}

/**
 * 右侧附件预览抽屉：头部是文件身份与下载 / 关闭，正文按预览状态分派。
 *
 * @returns
 */
export function renderAttachmentDrawer(page: PageContext): React.ReactElement | null {
  const {
    t,
    attachmentView,
    closeAttachment,
    renderAttachmentDownload,
    renderAttachmentPreviewBody,
    renderDrawerHead,
  } = page

  const viewer = attachmentView
  if (viewer === null) return null
  const meta = [formatBytes(viewer.bytes), viewer.description].filter(
    (item) => typeof item === 'string' && item !== '',
  )
  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: closeAttachment,
      title: viewer.name,
      closeLabel: t('attachmentPreviewClose'),
      backdropBlur: false,
      className: 'buka-workflows-drawer',
    },
    renderDrawerHead({
      title: viewer.name,
      meta: meta.join(' · '),
      icon:
        typeof FileTypeIcon === 'function'
          ? h(FileTypeIcon, { path: viewer.name, size: 18 })
          : null,
      actions: [renderAttachmentDownload(viewer)],
      closeLabel: t('attachmentPreviewClose'),
      onClose: closeAttachment,
    }),
    h('div', { className: 'buka-workflows-drawerBody' }, ...renderAttachmentPreviewBody(viewer)),
  )
}
