/**
 * 节点附件清单：文件名（点击打开右侧预览抽屉）、大小、描述与下载入口。
 */

import type { WorkflowRunRecord, WorkflowStep } from '../../run-store.ts'
import { h } from '../element.ts'
import { formatBytes } from '../format.ts'
import { attachmentToken, attachmentUrl } from '../request.ts'
import type { Translate } from '../types.ts'

/**
 * 附件清单：文件名（点击打开右侧预览抽屉）、大小、描述与下载入口。
 *
 * @param t
 * @param run
 * @param step
 * @param attachments
 * @param [onOpen]
 * @returns
 */
export function renderAttachments(
  t: Translate,
  run: WorkflowRunRecord | null,
  step: WorkflowStep | null | undefined,
  attachments: Array<Record<string, unknown>>,
  onOpen:
    | ((
        run: WorkflowRunRecord | null,
        step: WorkflowStep | null | undefined,
        attachment: Record<string, unknown>,
      ) => void)
    | null = null,
): React.ReactElement | null {
  if (!Array.isArray(attachments) || attachments.length === 0) return null
  return h(
    'ul',
    { className: 'buka-workflows-attachmentList' },
    attachments.map((attachment, index) => {
      const token = attachmentToken(run, step, attachment)
      const name = typeof attachment?.name === 'string' ? attachment.name : 'attachment'
      return h(
        'li',
        {
          key: `${String(attachment?.index ?? index)}-${name}`,
          className: 'buka-workflows-attachment',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'buka-workflows-attachmentLink',
            title: t('attachmentPreviewOpenHint'),
            onClick: () => {
              if (typeof onOpen === 'function') onOpen(run, step, attachment)
            },
          },
          name,
        ),
        h('span', { className: 'buka-workflows-attachmentMeta' }, formatBytes(attachment?.bytes)),
        typeof attachment?.description === 'string' && attachment.description !== ''
          ? h('span', { className: 'buka-workflows-attachmentDescription' }, attachment.description)
          : null,
        h(
          'a',
          {
            className: 'buka-workflows-attachmentDownload',
            href: attachmentUrl(token),
            download: name,
          },
          t('attachmentDownload'),
        ),
      )
    }),
  )
}
