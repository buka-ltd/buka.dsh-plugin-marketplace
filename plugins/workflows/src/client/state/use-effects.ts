/**
 * 页面数据 effect：工作流目录、工作流详情、作业详情、结束任务、任务详情、
 * 附件库、预览、hash 路由与轮询。
 *
 * 轮询沿用旧页面风格：有 `running` 作业时 1.5 秒一次，否则 5 秒一次。所有请求
 * 都可取消（路由切换 / 卸载时不再写状态）。
 */

import React from 'react'

import { messageOf } from '../format.ts'
import { attachmentUrl, requestJson } from '../request.ts'
import { parseRouteHash, sameRoutePage } from '../routing.ts'
import type {
  AttachmentMeta,
  JobAttachmentPreview,
  JobDetail,
  Loadable,
  PageState,
  Route,
  TaskDetail,
  TaskSummary,
  WorkflowDetail,
  WorkflowSummary,
} from '../types.ts'
import {
  ATTACHMENTS_ROUTE,
  asString,
  isRecord,
  JOB_ROUTE,
  LIVE_REFRESH_MS,
  REFRESH_MS,
  TASK_ROUTE,
  WORKFLOW_ROUTE,
  WORKFLOWS_ROUTE,
} from '../types.ts'
import type { PageStore } from './use-page-state.ts'

/** 路由完全相同。 */
function routesEqual(left: Route, right: Route): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'workflows') return true
  if (left.kind === 'workflow' && right.kind === 'workflow') {
    return left.workflowId === right.workflowId && left.tab === right.tab
  }
  if (left.kind === 'job' && right.kind === 'job') {
    return (
      left.workflowId === right.workflowId && left.jobId === right.jobId && left.view === right.view
    )
  }
  return false
}

/** 空的可加载状态。 */
function idle<T>(): Loadable<T> {
  return { status: 'idle', data: null, error: null }
}

/**
 * 浏览器前进 / 后退：把新 hash 合进状态，只在跨页面时清掉旧数据。
 *
 * @param current 当前状态
 * @param next 新路由
 * @returns 新状态
 */
function applyHashRoute(current: PageState, next: Route): PageState {
  if (routesEqual(current.route, next)) return current
  if (sameRoutePage(current.route, next)) {
    return {
      ...current,
      route: next,
      ...(next.kind === 'workflow' && current.route.kind === 'workflow' && next.tab === 'jobs'
        ? { definitionSelection: null }
        : {}),
      ...(next.kind === 'job' && current.route.kind === 'job' && next.view !== 'flow'
        ? { nodeTasks: null }
        : {}),
    }
  }

  const base: PageState = {
    ...current,
    route: next,
    definitionSelection: null,
    nodeTasks: null,
    taskId: null,
    task: idle<TaskDetail>(),
    attachment: null,
    attachments: idle<AttachmentMeta[]>(),
    finalTask: idle<TaskDetail>(),
    newJob: { open: false, raw: {}, structured: {}, error: null, submitting: false },
  }
  if (next.kind === 'workflows') {
    return {
      ...base,
      workflow: idle<WorkflowDetail>(),
      job: idle<JobDetail>(),
    }
  }
  const sameWorkflow =
    current.route.kind !== 'workflows' &&
    current.route.workflowId === next.workflowId &&
    current.workflow.data !== null
  const job: PageState['job'] =
    next.kind === 'job'
      ? current.route.kind === 'job' &&
        current.route.jobId === next.jobId &&
        current.job.data !== null
        ? current.job
        : idle<JobDetail>()
      : idle<JobDetail>()
  return {
    ...base,
    workflow: sameWorkflow ? current.workflow : idle<WorkflowDetail>(),
    job,
  }
}

/**
 * 挂载全部取数与轮询 effect。
 *
 * @param store 页面状态
 */
export function useWorkflowEffects(store: PageStore): void {
  const { state, setState } = store
  const route = state.route
  const tick = state.tick

  // 浏览器前进 / 后退：hash 是唯一的路由来源。
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onHash = () => {
      setState((current) => applyHashRoute(current, parseRouteHash(window.location.hash)))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 作业在跑时缩短轮询间隔；看板 / 任务抽屉都靠它刷新。
  const live = state.job.data?.job?.status === 'running'
  React.useEffect(() => {
    const interval = setInterval(
      () => setState((current) => ({ ...current, tick: current.tick + 1 })),
      live ? LIVE_REFRESH_MS : REFRESH_MS,
    )
    return () => clearInterval(interval)
  }, [live])

  // 工作流目录：只在列表页读取；详情页有自己的状态，不必陪着轮询。
  const listView = route.kind === 'workflows'
  React.useEffect(() => {
    if (!listView) return undefined
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
  }, [tick, listView])

  // 工作流详情：工作流页与作业页都需要（作业页用它补任务类型 schema）。
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

  // 作业详情（含任务摘要）；看板 / 流程 / 概览 / 产出都从它派生。
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

  // 结束任务的详情：概览里的「最终交付物」需要它的 payload / result / 附件。
  const endTask = (state.job.data?.tasks ?? []).find(
    (task: TaskSummary) => task.position === 'end' && typeof task.id === 'string',
  )
  const endTaskId = typeof endTask?.id === 'string' ? endTask.id : ''
  React.useEffect(() => {
    if (jobId === '' || endTaskId === '') {
      setState((current) =>
        current.finalTask.status === 'idle' && current.finalTask.data === null
          ? current
          : { ...current, finalTask: idle<TaskDetail>() },
      )
      return undefined
    }
    let cancelled = false
    setState((current) => ({
      ...current,
      finalTask: {
        ...current.finalTask,
        status: current.finalTask.data === null ? 'loading' : current.finalTask.status,
      },
    }))
    requestJson<{ task?: unknown }>(
      `${TASK_ROUTE}?jobId=${encodeURIComponent(jobId)}&taskId=${encodeURIComponent(endTaskId)}`,
    ).then(
      (body) => {
        if (cancelled) return
        if (!isRecord(body?.task)) return
        setState((current) => ({
          ...current,
          finalTask: { status: 'ready', data: body.task as TaskDetail, error: null },
        }))
      },
      (failure) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          finalTask: { ...current.finalTask, status: 'ready', error: messageOf(failure) },
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [jobId, endTaskId, tick])

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

  // 附件库（资产池）：只在资产视图打开时读取。
  const outputsView = route.kind === 'job' && route.view === 'outputs'
  React.useEffect(() => {
    if (!outputsView || jobId === '') return undefined
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
  }, [outputsView, jobId, tick])

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
