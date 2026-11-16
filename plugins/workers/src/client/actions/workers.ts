/**
 * 「打工人」页面的打工人管理动作：打开会话、挂载、创建、删除、保存 AGENTS.md。
 *
 * 这些动作只调 Host 路由与 DSH Client Service，然后更新 `useWorkersState` 的
 * 状态；不包含任何渲染。
 *
 * @module @buka/dsh-plugin-workers/client/actions/workers
 */

import type { FormEvent } from 'react'
import {
  agentsOf,
  errorCode,
  failureText,
  isRobotWorker,
  messageOf,
  requestJson,
  workerDisplayName,
  workerIdentityLabel,
} from '../api.ts'
import {
  AGENTS_ROUTE,
  CREATE_ROUTE,
  REMOVE_IMPACT_ROUTE,
  REMOVE_ROUTE,
  REVEAL_ROUTE,
} from '../constants.ts'
import type { WorkersPageState } from '../state.ts'
import type {
  Translate,
  UiWorkspaceService,
  Worker,
  WorkerRemoveImpact,
  WorkerUsageJob,
  WorkspacesService,
} from '../types.ts'

/**
 * 构造打工人管理动作。
 *
 */
export function createWorkerActions(state: WorkersPageState, t: Translate) {
  const {
    setBusy,
    flash,
    reload,
    patchWorker,
    service,
    mutating,
    creating,
    createId,
    setCreateId,
    createName,
    setCreateName,
    draftDescription,
    draftAvatar,
    nextAvatarId,
    setDialogOpen,
    setCreateError,
    setCreating,
    deleteDialog,
    setDeleteDialog,
    selectedId,
    setSelectedId,
    agentsDraft,
    agentsSaving,
    setAgentsSaving,
    corrupt,
    setDraftDescription,
    setDraftAvatar,
  } = state

  /**
   * 打开打工人会话：只有已挂载（有 workspaceId）才能打开；否则提示先挂载。
   * 打开走 DSH 的 `uiWorkspace.openWorkspace(workspaceId)`。
   *
   */
  async function openWorker(worker: Worker) {
    if (isRobotWorker(worker)) {
      flash('error', t('robotReadOnly'))
      return
    }
    if (
      worker.mounted !== true ||
      typeof worker.workspaceId !== 'string' ||
      worker.workspaceId === ''
    ) {
      flash('error', t('openUnmounted'))
      return
    }
    const uiWorkspace = service<UiWorkspaceService>('uiWorkspace')
    if (uiWorkspace === null || typeof uiWorkspace.openWorkspace !== 'function') {
      flash('error', t('noUiWorkspace'))
      return
    }
    setBusy(`open:${worker.id}`)
    try {
      await uiWorkspace.openWorkspace(worker.workspaceId)
    } catch (failure) {
      flash('error', `${t('openFailed')} ${messageOf(failure)}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 用系统文件管理器打开打工人目录（macOS 上是 Finder）。
   *
   * 成功不弹提示：Finder 窗口本身就是反馈；失败用 Toast 说明。
   *
   */
  async function revealWorker(worker: Worker) {
    if (mutating) return
    if (isRobotWorker(worker)) {
      flash('error', t('robotReadOnly'))
      return
    }
    setBusy(`reveal:${worker.id}`)
    try {
      await requestJson(REVEAL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: worker.id }),
      })
    } catch (failure) {
      const extra = errorCode(failure) === 'reveal-failed' ? '' : ` ${failureText(t, failure)}`
      flash('error', `${t('revealFailed')}${extra}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 把打工人挂载成 DSH 工作区：目录已经由 Host 建好，这里只调用
   * `workspaces.create({ path })`，成功后刷新列表让卡片变成「已挂载」。
   *
   */
  async function mountWorker(worker: Worker) {
    if (isRobotWorker(worker)) {
      flash('error', t('robotReadOnly'))
      return
    }
    const workspaces = service<WorkspacesService>('workspaces')
    if (workspaces === null || typeof workspaces.create !== 'function') {
      flash('error', t('noWorkspacesCreate'))
      return
    }
    setBusy(`mount:${worker.id}`)
    try {
      await workspaces.create({ path: worker.path })
      flash('success', `${t('mounted')} ${workerDisplayName(worker)}`)
      reload()
    } catch (failure) {
      flash('error', `${t('mountFailed')} ${messageOf(failure)}`)
    } finally {
      setBusy(null)
    }
  }

  /** 打开「创建打工人」对话框：清掉上一次的输入，并按现有打工人挑一个新头像。 */
  function openCreateDialog() {
    if (creating || corrupt) return
    setCreateId('')
    setCreateName('')
    setDraftDescription('')
    setDraftAvatar(nextAvatarId())
    setCreateError(null)
    setDialogOpen(true)
  }

  /** 关闭「创建打工人」对话框；提交中不响应关闭，避免请求回来时状态错位。 */
  function closeCreateDialog() {
    if (creating) return
    setDialogOpen(false)
    setCreateError(null)
  }

  /**
   * 新建打工人：Host 先建目录并写入登记表，浏览器再把它挂载成工作区。
   * 挂载失败不会撤销打工人 —— 它会以「未挂载」留在列表里，可稍后点「挂载」。
   * 创建请求本身的失败留在对话框里原地提示，不用关掉重开。
   *
   */
  async function createWorker(event: FormEvent) {
    event.preventDefault()
    if (creating || corrupt) return
    const value = createId.trim()
    const displayName = createName.trim()
    if (value === '') {
      setCreateError(t('createEmptyId'))
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const body = await requestJson(CREATE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({
          id: value,
          name: displayName,
          avatar: draftAvatar,
          description: draftDescription,
        }),
      })
      setCreateId('')
      setCreateName('')
      setDialogOpen(false)
      const workerPath = body?.worker?.path
      if (typeof workerPath !== 'string' || workerPath === '') {
        flash('error', `${t('createFailed')} ${messageOf('host did not return the worker path')}`)
        reload()
        return
      }
      const workspaces = service<WorkspacesService>('workspaces')
      if (workspaces === null || typeof workspaces.create !== 'function') {
        flash('error', t('noWorkspacesCreate'))
        reload()
        return
      }
      const created = body?.created !== false
      try {
        await workspaces.create({ path: workerPath })
        const createdLabel = workerIdentityLabel(body?.worker ?? { id: value, name: displayName })
        flash('success', `${created ? t('created') : t('createExisting')} ${createdLabel}`)
      } catch (failure) {
        // 目录与登记已经落盘，挂载失败只影响「已挂载」状态，刷新后仍可重试。
        flash('error', `${t('createMountFailed')} ${messageOf(failure)}`)
      }
      reload()
    } catch (failure) {
      setCreateError(`${t('createFailed')} ${failureText(t, failure)}`)
    } finally {
      setCreating(false)
    }
  }

  /** 空的删除弹窗状态。 */
  function emptyDeleteDialog() {
    return { target: null, impact: null, loading: false, error: null, saving: false }
  }

  /**
   * 读一次删除影响面；同一时刻只保留最后一次打开的打工人。
   *
   */
  async function loadDeleteImpact(worker: Worker) {
    try {
      const impact = await requestJson<WorkerRemoveImpact>(REMOVE_IMPACT_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: worker.id }),
      })
      setDeleteDialog((prev) =>
        prev.target?.id === worker.id ? { ...prev, impact, loading: false } : prev,
      )
    } catch (failure) {
      setDeleteDialog((prev) =>
        prev.target?.id === worker.id
          ? {
              ...prev,
              loading: false,
              error: `${t('deleteImpactFailed')} ${failureText(t, failure)}`,
            }
          : prev,
      )
    }
  }

  /**
   * 打开一个引用了该打工人的运行中作业。
   *
   * 先让布局服务切到工作流面板，再写 hash：工作流页按 hash 打开具体作业。
   * 布局服务不可用时（非 Web 组合）只写 hash，不额外报错。
   *
   */
  function openJob(job: WorkerUsageJob) {
    const layout = service<{ selectPanel?: (id: string | null) => void }>('layout')
    try {
      layout?.selectPanel?.('buka-workflows')
    } catch {
      // 面板切换失败不影响后面的地址写入。
    }
    if (typeof window !== 'undefined') {
      const workflowId = encodeURIComponent(job.workflowId)
      const jobId = encodeURIComponent(job.jobId)
      window.location.hash = `#/job/${workflowId}/${jobId}/overview`
    }
  }

  /**
   * 打开删除确认弹窗：先拉影响面，列出阻塞的作业、会变成不可用的工作流、
   * 历史作业数量与将被删除的目录。删除是硬删，目录里的 AGENTS.md 与项目
   * skills 会一起消失（弹窗文案会写明）。
   *
   */
  async function openDeleteDialog(worker: Worker) {
    if (isRobotWorker(worker)) {
      flash('error', t('robotReadOnly'))
      return
    }
    setDeleteDialog({ target: worker, impact: null, loading: true, error: null, saving: false })
    await loadDeleteImpact(worker)
  }

  /** 关闭删除弹窗；提交中不响应关闭。 */
  function closeDeleteDialog() {
    setDeleteDialog((prev) => (prev.saving ? prev : emptyDeleteDialog()))
  }

  /**
   * 确认删除：Host 在一个事务里删登记条目、打工人目录与工作区注册行。
   * 有引用该标识符的运行中作业时 Host 返回 409 `worker-in-use`，这里刷新
   * 影响面并保留弹窗，不提供强制删除。
   *
   */
  async function confirmDeleteWorker() {
    const target = deleteDialog.target
    if (target === null || deleteDialog.saving) return
    if ((deleteDialog.impact?.blockers.runningJobs.length ?? 0) > 0) return
    setDeleteDialog((prev) => ({ ...prev, saving: true, error: null }))
    try {
      await requestJson(REMOVE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: target.id }),
      })
    } catch (failure) {
      const blocked = errorCode(failure) === 'worker-in-use'
      setDeleteDialog((prev) => ({
        ...prev,
        saving: false,
        error: blocked
          ? t('deleteBlockedByJobs')
          : `${t('deleteFailed')} ${failureText(t, failure)}`,
      }))
      if (blocked) await loadDeleteImpact(target)
      reload()
      return
    }
    setDeleteDialog(emptyDeleteDialog())
    if (selectedId === target.id) setSelectedId(null)
    reload()
    flash('success', `${t('deleted')} ${workerDisplayName(target)}`)
  }

  /**
   * 保存 AGENTS.md：Host 按打工人标识符解析目录并写文件，返回值里带字节数
   * 与修改时间，用来更新本地摘要。
   *
   */
  async function saveAgents(worker: Worker) {
    if (agentsSaving) return
    if (isRobotWorker(worker)) {
      flash('error', t('robotReadOnly'))
      return
    }
    const content = agentsDraft
    if (content === agentsOf(worker).content) return
    setAgentsSaving(true)
    try {
      const body = await requestJson(AGENTS_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: worker.id, content }),
      })
      patchWorker(worker.id, {
        agents: {
          ...agentsOf(worker),
          exists: true,
          bytes: typeof body.bytes === 'number' ? body.bytes : agentsOf(worker).bytes,
          modifiedAt:
            typeof body.modifiedAt === 'string' ? body.modifiedAt : agentsOf(worker).modifiedAt,
          content,
          tooLarge: false,
        },
      })
      flash('success', t('agentsSaved'))
    } catch (failure) {
      flash('error', `${t('agentsSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setAgentsSaving(false)
    }
  }

  return {
    openWorker,
    revealWorker,
    mountWorker,
    openCreateDialog,
    closeCreateDialog,
    createWorker,
    openJob,
    openDeleteDialog,
    closeDeleteDialog,
    confirmDeleteWorker,
    saveAgents,
  }
}
