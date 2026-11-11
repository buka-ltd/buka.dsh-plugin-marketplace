/**
 * 附件预览抽屉的 effect 与动作：打开 / 关闭、拉取预览。
 */

import React from 'react'

import type { WorkflowRunRecord, WorkflowStep } from '../../run-store.ts'
import { messageOf } from '../format.ts'
import { attachmentUrl } from '../request.ts'
import type { AttachmentViewer, ClientError, Translate } from '../types.ts'
import { isRecord } from '../types.ts'
import type { PageState } from './use-page-state.ts'

/** 附件预览抽屉的动作。 */
export interface AttachmentsActions {
  /** 在右侧抽屉里打开附件预览。 */
  openAttachment: (
    run: WorkflowRunRecord | null,
    step: WorkflowStep | null | undefined,
    attachment: Record<string, unknown> | null | undefined,
  ) => void
  /** 关闭附件预览抽屉。 */
  closeAttachment: () => void
  /** 拉取一次附件预览。 */
  fetchAttachmentPreview: (viewer: AttachmentViewer | null) => void
}

/**
 * 抽屉预览的进行中请求。只用模块级的一个变量保存：页面只挂一份，它不参与
 * 渲染，新的请求先中止旧的，关闭抽屉时也中止。
 */
let attachmentAbort: AbortController | null = null

/**
 * 附件预览的 effect 与动作。
 *
 * @param state 页面状态
 * @param t 词典翻译函数
 * @returns 附件预览动作
 */
export function useAttachmentsEffects(state: PageState, t: Translate): AttachmentsActions {
  const { attachmentView, setAttachmentView, setAttachmentPreview, selectedId } = state
  const { view } = state

  /**
   * 中止抽屉里进行中的预览请求（如果有）。
   */
  function abortAttachmentPreview(): void {
    if (attachmentAbort === null) return
    attachmentAbort.abort()
    attachmentAbort = null
  }

  /**
   * 在右侧抽屉里打开附件预览。同一个附件重复点击也会重新拉取一次。
   *
   * @param run
   * @param step
   * @param attachment
   */
  function openAttachment(
    run: WorkflowRunRecord | null,
    step: WorkflowStep | null | undefined,
    attachment: Record<string, unknown> | null | undefined,
  ): void {
    const runId = typeof run?.runId === 'string' ? run.runId : ''
    const name = typeof attachment?.name === 'string' ? attachment.name : ''
    if (runId === '' || name === '') return
    setAttachmentView({
      runId,
      seq: step?.seq ?? null,
      nodeId: typeof step?.nodeId === 'string' ? step.nodeId : '',
      name,
      bytes: typeof attachment?.bytes === 'number' ? attachment.bytes : null,
      description: typeof attachment?.description === 'string' ? attachment.description : '',
    })
    setAttachmentPreview({ status: 'loading', data: null, error: null })
  }

  /** 关闭附件预览抽屉：中止进行中的请求并恢复空闲状态。 */
  function closeAttachment(): void {
    abortAttachmentPreview()
    setAttachmentView(null)
    setAttachmentPreview({ status: 'idle', data: null, error: null })
  }

  /**
   * 拉取一次附件预览。新的请求先中止旧的；被中止的请求不再写状态。
   *
   * @param viewer
   */
  function fetchAttachmentPreview(viewer: AttachmentViewer | null): void {
    if (viewer === null || typeof viewer !== 'object') return
    abortAttachmentPreview()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    attachmentAbort = controller
    setAttachmentPreview((previous) => ({
      status: 'loading',
      data: previous?.status === 'ready' ? previous.data : null,
      error: null,
    }))
    const init: RequestInit = { headers: { accept: 'application/json' } }
    if (controller !== null) init.signal = controller.signal
    fetch(attachmentUrl(viewer, 'preview'), init)
      .then(async (response) => {
        const parsed: unknown = await response.json().catch(() => null)
        const body = isRecord(parsed) ? parsed : null
        if (!response.ok || body === null || body.ok !== true) {
          const failure = new Error(
            typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
          ) as ClientError
          failure.code = body?.code
          throw failure
        }
        return body
      })
      .then((body) => {
        // 响应回来前抽屉可能已经关了或换了附件：被中止的请求不再写状态。
        if (controller?.signal.aborted) return
        const attachment = body.attachment
        if (!isRecord(attachment)) {
          setAttachmentPreview({
            status: 'failed',
            data: null,
            error: t('attachmentPreviewFailed'),
          })
          return
        }
        setAttachmentPreview({ status: 'ready', data: attachment, error: null })
      })
      .catch((failure) => {
        // 被 abort 的请求可能是抽屉已经关掉或换成了别的附件，不再写状态。
        if (controller?.signal.aborted) return
        setAttachmentPreview({
          status: 'failed',
          data: null,
          error: `${t('attachmentPreviewFailed')} ${messageOf(failure)}`,
        })
      })
      .finally(() => {
        if (attachmentAbort === controller) attachmentAbort = null
      })
  }

  // 打开 / 切换附件时拉一次预览；关闭抽屉或换附件会中止进行中的请求。
  React.useEffect(() => {
    if (attachmentView === null) return undefined
    fetchAttachmentPreview(attachmentView)
    return () => {
      abortAttachmentPreview()
    }
  }, [attachmentView])

  // 返回列表、切换运行或切到模板页签时收起抽屉；抽屉里打开的正是当前选中的
  // 这个运行时不要关。
  React.useEffect(() => {
    if (attachmentView === null) return
    if (view === 'runs' && selectedId !== null && selectedId === attachmentView.runId) return
    closeAttachment()
  }, [selectedId, view, attachmentView])

  return { openAttachment, closeAttachment, fetchAttachmentPreview }
}
