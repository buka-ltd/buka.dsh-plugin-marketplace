/**
 * 页面动作：导航、取数后的写回、工作流激活、作业启停、任务动作、会话与附件。
 *
 * 所有异步动作都走函数式 `setState`；动作失败只写页面错误 / Toast，不抛出去。
 */

import { messageOf } from '../format.ts'
import { fill } from '../i18n.ts'
import {
  currentDefinition,
  currentJobDefinition,
  mergedDefinition,
  outputSchemaFor,
} from '../model.ts'
import { postJson } from '../request.ts'
import { parseJson, parseSchemaValues, schemaFields } from '../schema.ts'
import type { PageState, Translate } from '../types.ts'
import {
  isRecord,
  JOB_ACTION_ROUTE,
  JOB_START_ROUTE,
  TASK_ACTION_ROUTE,
  WORKFLOW_ACTIVATE_ROUTE,
} from '../types.ts'
import type { PageStore } from './use-page-state.ts'

/** 动作依赖。 */
export interface ActionDeps {
  t: Translate
  getService: (name: string) => unknown
}

/** 页面动作。 */
export interface AppActions extends ActionDeps {
  openWorkflow: (workflowId: string) => void
  backToWorkflows: () => void
  openJob: (workflowId: string, jobId: string) => void
  backToWorkflow: () => void
  refresh: () => void
  flash: (kind: 'success' | 'error', text: string) => void
  dismissNotice: () => void
  setJobView: (view: PageState['jobView']) => void
  activateWorkflow: (active: boolean) => Promise<void>
  openNewJob: () => void
  closeNewJob: () => void
  setNewJobRaw: (name: string, value: string) => void
  setNewJobStructured: (name: string, value: string) => void
  submitNewJob: () => Promise<void>
  cancelJob: () => Promise<void>
  retryDelivery: () => Promise<void>
  openTask: (taskId: string) => void
  closeTask: () => void
  setTaskField: (name: string, value: string) => void
  setTaskText: (text: string) => void
  runTaskAction: (action: 'claim' | 'complete' | 'cancel' | 'retry') => Promise<void>
  openSession: (sessionId: unknown) => Promise<void>
  openAttachment: (attachmentId: string, name: string) => void
  closeAttachment: () => void
}

/**
 * 创建页面动作。
 *
 * @param store 状态与 setter
 * @param deps 词典、Service 取值器与 Toast
 * @returns 动作集合
 */
export function createActions(store: PageStore, deps: ActionDeps): AppActions {
  const { t, getService } = deps
  const { state, setState } = store

  /** 当前作业 id（作业详情路由或已加载的作业详情）。 */
  function jobIdOf(current: PageState = state): string {
    if (current.route.kind === 'job') return current.route.jobId
    return current.job.data?.job?.id ?? ''
  }

  /** 当前工作流 id。 */
  function workflowIdOf(current: PageState = state): string {
    if (current.route.kind === 'workflow') return current.route.workflowId
    if (current.route.kind === 'job') return current.route.workflowId
    return current.workflow.data?.workflow?.id ?? ''
  }

  /** 用 Toast 显示一次操作结果。 */
  function flash(kind: 'success' | 'error', text: string): void {
    setState((current) => ({
      ...current,
      notice: { kind, text, seq: Date.now() + Math.random() },
    }))
  }

  /** 手动刷新：递增 tick 触发所有数据 effect。 */
  function refresh(): void {
    setState((current) => ({ ...current, tick: current.tick + 1 }))
  }

  return {
    t,
    getService,
    flash,
    refresh,
    dismissNotice: () => setState((current) => ({ ...current, notice: null })),

    openWorkflow(workflowId) {
      setState((current) => ({
        ...current,
        route: { kind: 'workflow', workflowId },
        workflow: { status: 'loading', data: null, error: null },
        job: { status: 'idle', data: null, error: null },
        taskId: null,
        task: { status: 'idle', data: null, error: null },
        attachment: null,
        tick: current.tick + 1,
      }))
    },

    backToWorkflows() {
      setState((current) => ({
        ...current,
        route: { kind: 'workflows' },
        workflow: { status: 'idle', data: null, error: null },
        job: { status: 'idle', data: null, error: null },
        taskId: null,
        task: { status: 'idle', data: null, error: null },
        attachment: null,
        tick: current.tick + 1,
      }))
    },

    openJob(workflowId, jobId) {
      setState((current) => ({
        ...current,
        route: { kind: 'job', workflowId, jobId },
        job: { status: 'loading', data: null, error: null },
        jobView: 'board',
        taskId: null,
        task: { status: 'idle', data: null, error: null },
        attachment: null,
        tick: current.tick + 1,
      }))
    },

    backToWorkflow() {
      const workflowId = workflowIdOf()
      if (workflowId === '') {
        setState((current) => ({ ...current, route: { kind: 'workflows' } }))
        return
      }
      setState((current) => ({
        ...current,
        route: { kind: 'workflow', workflowId },
        job: { status: 'idle', data: null, error: null },
        taskId: null,
        task: { status: 'idle', data: null, error: null },
        attachment: null,
        tick: current.tick + 1,
      }))
    },

    setJobView(view) {
      setState((current) => ({ ...current, jobView: view }))
    },

    async activateWorkflow(active) {
      const workflowId = workflowIdOf()
      if (workflowId === '') return
      setState((current) => ({ ...current, busy: 'activate' }))
      try {
        await postJson(WORKFLOW_ACTIVATE_ROUTE, { id: workflowId, active })
        setState((current) => {
          const detail = current.workflow.data
          const status = active ? 'active' : 'retired'
          const nextDetail =
            detail === null || detail.workflow === undefined
              ? current.workflow
              : {
                  ...current.workflow,
                  data: { ...detail, workflow: { ...detail.workflow, status } },
                }
          const nextWorkflows =
            current.workflows.data === null
              ? current.workflows
              : {
                  ...current.workflows,
                  data: current.workflows.data.map((item) =>
                    item.id === workflowId ? { ...item, status } : item,
                  ),
                }
          return {
            ...current,
            busy: null,
            tick: current.tick + 1,
            workflow: nextDetail,
            workflows: nextWorkflows,
          }
        })
        flash('success', t('activateDone'))
      } catch (failure) {
        setState((current) => ({ ...current, busy: null }))
        flash('error', `${t('activateFailed')} ${messageOf(failure)}`)
      }
    },

    openNewJob() {
      setState((current) => ({
        ...current,
        newJob: { open: true, raw: {}, structured: {}, error: null, submitting: false },
      }))
    },

    closeNewJob() {
      setState((current) => ({
        ...current,
        newJob: { open: false, raw: {}, structured: {}, error: null, submitting: false },
      }))
    },

    setNewJobRaw(name, value) {
      setState((current) => ({
        ...current,
        newJob: { ...current.newJob, raw: { ...current.newJob.raw, [name]: value }, error: null },
      }))
    },

    setNewJobStructured(name, value) {
      setState((current) => ({
        ...current,
        newJob: {
          ...current.newJob,
          structured: { ...current.newJob.structured, [name]: value },
          error: null,
        },
      }))
    },

    async submitNewJob() {
      const current = state
      const definition = currentDefinition(current)
      const workflowId = workflowIdOf(current)
      if (workflowId === '') return
      const start = definition?.start?.task
      const rawSchema = isRecord(start?.payload) ? start.payload : null
      const structuredSchema = isRecord(start?.output) ? start.output : null
      const draft = current.newJob

      let rawInput: Record<string, unknown>
      if (schemaFields(rawSchema).length > 0) {
        const parsed = parseSchemaValues(rawSchema, draft.raw, t)
        if ('error' in parsed) {
          setState((now) => ({ ...now, newJob: { ...now.newJob, error: parsed.error } }))
          return
        }
        rawInput = parsed.value
      } else {
        const request = (draft.raw.request ?? '').trim()
        if (request === '') {
          setState((now) => ({
            ...now,
            newJob: {
              ...now.newJob,
              error: fill(t, 'fieldRequired', { name: t('newJobRawFallback') }),
            },
          }))
          return
        }
        rawInput = { request }
      }

      let structuredInput: Record<string, unknown>
      if (schemaFields(structuredSchema).length > 0) {
        const parsed = parseSchemaValues(structuredSchema, draft.structured, t)
        if ('error' in parsed) {
          setState((now) => ({ ...now, newJob: { ...now.newJob, error: parsed.error } }))
          return
        }
        structuredInput = parsed.value
      } else {
        const text = (draft.structured.__json ?? '').trim()
        if (text === '') {
          structuredInput = {}
        } else {
          const parsed = parseJson(text)
          if (!isRecord(parsed)) {
            setState((now) => ({
              ...now,
              newJob: {
                ...now.newJob,
                error: `${t('newJobJsonInvalid')} ${text.slice(0, 120)}`,
              },
            }))
            return
          }
          structuredInput = parsed
        }
      }

      setState((now) => ({
        ...now,
        newJob: { ...now.newJob, submitting: true, error: null },
      }))
      try {
        const body = await postJson<{ jobId?: string }>(JOB_START_ROUTE, {
          workflowId,
          rawInput,
          structuredInput,
        })
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        setState((now) => ({
          ...now,
          newJob: { open: false, raw: {}, structured: {}, error: null, submitting: false },
          route: jobId === '' ? now.route : { kind: 'job', workflowId, jobId },
          job: { status: 'loading', data: null, error: null },
          jobView: 'board',
          tick: now.tick + 1,
        }))
        flash('success', t('newJobStarted'))
      } catch (failure) {
        setState((now) => ({
          ...now,
          newJob: {
            ...now.newJob,
            submitting: false,
            error: `${t('newJobFailed')} ${messageOf(failure)}`,
          },
        }))
      }
    },

    async cancelJob() {
      const jobId = jobIdOf()
      if (jobId === '') return
      setState((current) => ({ ...current, busy: 'cancel-job' }))
      try {
        await postJson(JOB_ACTION_ROUTE, { jobId, action: 'cancel' })
        setState((current) => ({ ...current, busy: null, tick: current.tick + 1 }))
      } catch (failure) {
        setState((current) => ({ ...current, busy: null }))
        flash('error', `${t('taskActionFailed')} ${messageOf(failure)}`)
      }
    },

    async retryDelivery() {
      const jobId = jobIdOf()
      if (jobId === '') return
      setState((current) => ({ ...current, busy: 'retry-delivery' }))
      try {
        await postJson(JOB_ACTION_ROUTE, { jobId, action: 'retry-delivery' })
        setState((current) => ({ ...current, busy: null, tick: current.tick + 1 }))
        flash('success', t('deliveryRetryStarted'))
      } catch (failure) {
        setState((current) => ({ ...current, busy: null }))
        flash('error', `${t('taskActionFailed')} ${messageOf(failure)}`)
      }
    },

    openTask(taskId) {
      setState((current) => ({
        ...current,
        taskId,
        task: { status: 'loading', data: null, error: null },
        taskForm: { values: {}, text: '', error: null, submitting: false },
      }))
    },

    closeTask() {
      setState((current) => ({
        ...current,
        taskId: null,
        task: { status: 'idle', data: null, error: null },
        taskForm: { values: {}, text: '', error: null, submitting: false },
      }))
    },

    setTaskField(name, value) {
      setState((current) => ({
        ...current,
        taskForm: {
          ...current.taskForm,
          values: { ...current.taskForm.values, [name]: value },
          error: null,
        },
      }))
    },

    setTaskText(text) {
      setState((current) => ({
        ...current,
        taskForm: { ...current.taskForm, text, error: null },
      }))
    },

    async runTaskAction(action) {
      const current = state
      const task = current.task.data
      if (task === null) return
      const jobId = typeof task.jobId === 'string' ? task.jobId : jobIdOf(current)
      if (jobId === '') return
      const taskId = task.id

      let output: Record<string, unknown> | null = null
      if (action === 'complete') {
        const workflowDefinition = currentDefinition(current)
        const jobDefinition = mergedDefinition(currentJobDefinition(current), workflowDefinition)
        const schema = outputSchemaFor(jobDefinition, workflowDefinition, task)
        const form = current.taskForm
        if (schemaFields(schema).length > 0) {
          const parsed = parseSchemaValues(schema, form.values, t)
          if ('error' in parsed) {
            setState((now) => ({ ...now, taskForm: { ...now.taskForm, error: parsed.error } }))
            return
          }
          output = parsed.value
        } else {
          const text = (form.values.__json ?? '').trim()
          if (text === '') {
            setState((now) => ({
              ...now,
              taskForm: {
                ...now.taskForm,
                error: fill(t, 'fieldRequired', { name: t('actionFormTitle') }),
              },
            }))
            return
          }
          const parsed = parseJson(text)
          if (!isRecord(parsed)) {
            setState((now) => ({
              ...now,
              taskForm: {
                ...now.taskForm,
                error: `${t('actionJsonInvalid')} ${text}`,
              },
            }))
            return
          }
          output = parsed
        }
      }

      setState((now) => ({ ...now, taskForm: { ...now.taskForm, submitting: true, error: null } }))
      try {
        const body: Record<string, unknown> = { jobId, taskId, action }
        if (output !== null) body.output = output
        if (action === 'complete' && current.taskForm.text.trim() !== '') {
          body.text = current.taskForm.text.trim()
        }
        await postJson(TASK_ACTION_ROUTE, body)
        setState((now) => ({
          ...now,
          taskForm: { ...now.taskForm, submitting: false, error: null },
          task: { ...now.task, status: 'loading' },
          tick: now.tick + 1,
        }))
        flash('success', t('taskActionDone'))
      } catch (failure) {
        setState((now) => ({
          ...now,
          taskForm: {
            ...now.taskForm,
            submitting: false,
            error: `${t('taskActionFailed')} ${messageOf(failure)}`,
          },
        }))
      }
    },

    async openSession(sessionId) {
      const id = typeof sessionId === 'string' ? sessionId : ''
      if (id === '') return
      const uiWorkspace = service(getService, 'uiWorkspace')
      if (uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') {
        flash('error', t('noUiWorkspace'))
        return
      }
      try {
        await refreshSessionsIfUnknown(getService, id)
        ;(uiWorkspace.openSession as (session: string) => void)(id)
      } catch (failure) {
        flash('error', `${t('openSessionFailed')} ${messageOf(failure)}`)
      }
    },

    openAttachment(attachmentId, name) {
      setState((current) => ({
        ...current,
        attachment: { id: attachmentId, name, status: 'loading', data: null, error: null },
      }))
    },

    closeAttachment() {
      setState((current) => ({ ...current, attachment: null }))
    },
  }
}

/**
 * 取一个 DSH Client Service；不存在时返回 null。
 *
 * @param getService
 * @param name
 * @returns
 */
function service(
  getService: (name: string) => unknown,
  name: string,
): Record<string, unknown> | null {
  try {
    const found = getService(name)
    return isRecord(found) ? found : null
  } catch {
    return null
  }
}

/**
 * 客户端会话列表里还没有这个会话时，先做一次全量刷新（与旧页面一致）。
 *
 * @param getService
 * @param sessionId
 * @returns
 */
async function refreshSessionsIfUnknown(
  getService: (name: string) => unknown,
  sessionId: string,
): Promise<void> {
  const sessions = service(getService, 'sessions')
  if (sessions === null || typeof sessions.refresh !== 'function') return
  let known = false
  try {
    const list = sessions.list
    const getSnapshot = isRecord(list) ? list.getSnapshot : undefined
    const snapshot = typeof getSnapshot === 'function' ? (getSnapshot as () => unknown)() : null
    const byId = isRecord(snapshot) && isRecord(snapshot.byId) ? snapshot.byId : null
    known = byId !== null && byId[sessionId] !== undefined
  } catch {
    known = false
  }
  if (known) return
  try {
    await (sessions.refresh as () => Promise<unknown>)()
  } catch (failure) {
    console.warn('buka-workflows: refreshing the session list failed:', failure)
  }
}
