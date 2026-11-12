/**
 * 页面数据 effect：工作流目录、工作流详情、作业详情、任务详情、附件库、预览与轮询。
 *
 * 轮询沿用旧页面风格：有 `running` 作业时 1.5 秒一次，否则 5 秒一次。所有请求
 * 都可取消（路由切换 / 卸载时不再写状态）。
 */

import React from 'react'

import { messageOf } from '../format.ts'
import { attachmentUrl, requestJson } from '../request.ts'
import type {
  AttachmentMeta,
  JobAttachmentPreview,
  JobDetail,
  TaskDetail,
  WorkflowDetail,
  WorkflowSummary,
} from '../types.ts'
import {
  ATTACHMENTS_ROUTE,
  asString,
  isRecord,
  JOB_ROUTE,
  JOBS_ROUTE,
  LIVE_REFRESH_MS,
  REFRESH_MS,
  TASK_ROUTE,
  WORKFLOW_ROUTE,
  WORKFLOWS_ROUTE,
} from '../types.ts'
import type { PageStore } from './use-page-state.ts'

/**
 * 挂载全部取数与轮询 effect。
 *
 * @param store 页面状态
 */
export function useWorkflowEffects(store: PageStore): void {
  const { state, setState } = store
  const route = state.route
  const tick = state.tick

  // 作业在跑时缩短轮询间隔；看板 / 任务抽屉都靠它刷新。
  const live = state.job.data?.job?.status === 'running'
  React.useEffect(() => {
    const interval = setInterval(
      () => setState((current) => ({ ...current, tick: current.tick + 1 })),
      live ? LIVE_REFRESH_MS : REFRESH_MS,
    )
    return () => clearInterval(interval)
  }, [live])

  // 工作流目录：列表与详情页共用（详情页要显示作业数 / 名称）。
  React.useEffect(() => {
    let cancelled = false
    setState((current) => ({
      ...current,
      workflows: {
        ...current.workflows,
        status: current.workflows.data === null ? 'loading' : current.workflows.status,
      },
    }))
    requestJson<{ workflows?: unknown }>(WORKFLOWS_ROUTE).then(
      (body) => {
        if (cancelled) return
        const list = Array.isArray(body.workflows) ? (body.workflows as WorkflowSummary[]) : []
        setState((current) => ({
          ...current,
          workflows: { status: 'ready', data: list, error: null },
        }))
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          workflows: { ...current.workflows, status: 'ready', error: messageOf(failure) },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [tick])

  // 工作流详情：详情页与作业页都需要（作业页用它补任务类型 schema）。
  const workflowId = route.kind === 'workflows' ? '' : route.workflowId
  React.useEffect(() => {
    if (workflowId === '') return undefined
    let cancelled = false
    setState((current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        status: current.workflow.data === null ? 'loading' : current.workflow.status,
      },
    }))
    requestJson<WorkflowDetail>(`${WORKFLOW_ROUTE}?id=${encodeURIComponent(workflowId)}`).then(
      (body) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          workflow: { status: 'ready', data: body, error: null },
        }))
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          workflow: { ...current.workflow, status: 'ready', error: messageOf(failure) },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [workflowId, tick])

  // 作业详情（含任务摘要）；看板 / 流程图 / 任务 / 时间线都从它派生。
  const jobId = route.kind === 'job' ? route.jobId : ''
  React.useEffect(() => {
    if (jobId === '') return undefined
    let cancelled = false
    setState((current) => ({
      ...current,
      job: {
        ...current.job,
        status: current.job.data === null ? 'loading' : current.job.status,
      },
    }))
    requestJson<JobDetail>(`${JOB_ROUTE}?id=${encodeURIComponent(jobId)}`).then(
      (body) => {
        if (cancelled) return
        setState((current) => ({ ...current, job: { status: 'ready', data: body, error: null } }))
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          job: { ...current.job, status: 'ready', error: messageOf(failure) },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [jobId, tick])

  // 工作流详情页的作业列表：作业属于工作流，单独一条路由。
  React.useEffect(() => {
    if (route.kind !== 'workflow') return undefined
    let cancelled = false
    requestJson<{ jobs?: unknown }>(
      `${JOBS_ROUTE}?workflowId=${encodeURIComponent(route.workflowId)}`,
    ).then(
      (body) => {
        if (cancelled) return
        const jobs = Array.isArray(body.jobs) ? body.jobs : []
        setState((current) => {
          const detail = current.workflow.data
          if (detail === null) return current
          return {
            ...current,
            workflow: {
              ...current.workflow,
              data: { ...detail, jobs: jobs as NonNullable<WorkflowDetail['jobs']> },
            },
          }
        })
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          workflow: {
            ...current.workflow,
            error: current.workflow.error ?? messageOf(failure),
          },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [route, tick])

  // 任务抽屉：点开卡片后按 tick 刷新，直到关掉。
  const taskId = state.taskId
  React.useEffect(() => {
    if (taskId === null || jobId === '') return undefined
    let cancelled = false
    setState((current) => ({
      ...current,
      task: {
        ...current.task,
        status: current.task.data === null ? 'loading' : current.task.status,
      },
    }))
    requestJson<{ task?: unknown }>(
      `${TASK_ROUTE}?jobId=${encodeURIComponent(jobId)}&taskId=${encodeURIComponent(taskId)}`,
    ).then(
      (body) => {
        if (cancelled) return
        if (!isRecord(body?.task)) return
        setState((current) => ({
          ...current,
          task: { status: 'ready', data: body.task as TaskDetail, error: null },
        }))
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          task: { ...current.task, status: 'ready', error: messageOf(failure) },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [taskId, jobId, tick])

  // 附件库：只在这个视图打开时读取（任务抽屉里的结果附件来自任务详情）。
  const attachmentsView = state.jobView === 'attachments' && jobId !== ''
  React.useEffect(() => {
    if (!attachmentsView) return undefined
    let cancelled = false
    setState((current) => ({
      ...current,
      attachments: {
        ...current.attachments,
        status: current.attachments.data === null ? 'loading' : current.attachments.status,
      },
    }))
    requestJson<{ attachments?: unknown }>(
      `${ATTACHMENTS_ROUTE}?jobId=${encodeURIComponent(jobId)}`,
    ).then(
      (body) => {
        if (cancelled) return
        const list = Array.isArray(body.attachments) ? (body.attachments as AttachmentMeta[]) : []
        setState((current) => ({
          ...current,
          attachments: { status: 'ready', data: list, error: null },
        }))
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          attachments: { ...current.attachments, status: 'ready', error: messageOf(failure) },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [attachmentsView, jobId, tick])

  // 附件预览：打开 / 切换附件时拉一次；关掉或换附件时中止旧请求。
  const attachmentId = state.attachment?.id ?? null
  const attachmentLoading = state.attachment?.status === 'loading'
  React.useEffect(() => {
    if (attachmentId === null || !attachmentLoading) return undefined
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const init: RequestInit = { headers: { accept: 'application/json' } }
    if (controller !== null) init.signal = controller.signal
    fetch(attachmentUrl(jobId, attachmentId, 'preview'), init)
      .then(async (response) => {
        const parsed: unknown = await response.json().catch(() => null)
        if (!response.ok || !isRecord(parsed) || parsed.ok !== true) {
          throw new Error(
            isRecord(parsed) && typeof parsed.message === 'string'
              ? parsed.message
              : `HTTP ${response.status}`,
          )
        }
        const attachment = parsed.attachment
        if (!isRecord(attachment)) throw new Error('invalid attachment preview')
        return attachment as JobAttachmentPreview
      })
      .then(
        (preview) => {
          setState((current) => {
            if (current.attachment === null || current.attachment.id !== attachmentId)
              return current
            return {
              ...current,
              attachment: { ...current.attachment, status: 'ready', data: preview, error: null },
            }
          })
        },
        (failure) => {
          if (controller?.signal.aborted === true) return
          setState((current) => {
            if (current.attachment === null || current.attachment.id !== attachmentId)
              return current
            return {
              ...current,
              attachment: {
                ...current.attachment,
                status: 'failed',
                data: null,
                error: `${messageOf(failure)}`,
              },
            }
          })
        },
      )
    return () => {
      controller?.abort()
    }
  }, [attachmentId, attachmentLoading, jobId])
}

/**
 * 附件预览的下载 / 内联地址（详情抽屉渲染用）。
 *
 * @param jobId
 * @param attachmentId
 * @param mode
 * @returns
 */
export function attachmentHref(
  jobId: string,
  attachmentId: string,
  mode?: 'preview' | 'inline',
): string {
  return attachmentUrl(asString(jobId), asString(attachmentId), mode)
}
