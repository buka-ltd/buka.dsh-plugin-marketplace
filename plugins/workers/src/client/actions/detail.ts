/**
 * 「打工人」详情页的动作：更换头像、重命名、保存职责描述。
 *
 * @module @buka/dsh-plugin-workers/client/actions/detail
 */

import type { FormEvent } from 'react'
import { agentsOf, failureText, requestJson } from '../api.ts'
import { avatarPreset } from '../avatar.ts'
import { AVATAR_ROUTE, DESCRIPTION_ROUTE, MODEL_ROUTE, RENAME_ROUTE } from '../constants.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate, Worker, WorkerAgents, WorkerModelSelection } from '../types.ts'

/**
 * 构造详情页动作。
 *
 */
export function createDetailActions(state: WorkersPageState, t: Translate) {
  const {
    mutating,
    avatarTarget,
    setAvatarTarget,
    draftAvatar,
    setDraftAvatar,
    avatarSaving,
    setAvatarSaving,
    setAvatarError,
    setAvatarOpen,
    selectedWorker,
    setRenameDraft,
    setRenameError,
    setRenameOpen,
    renameSaving,
    renameDraft,
    setRenameSaving,
    agentsDraft,
    setAgentsDraft,
    selectedName,
    setSelectedName,
    descriptionDraft,
    setDescriptionDraft,
    descriptionSaving,
    setDescriptionSaving,
    setDescriptionError,
    modelDraft,
    setModelDraft,
    modelSaving,
    setModelSaving,
    setModelError,
    patchWorker,
    flash,
    reload,
    corrupt,
  } = state

  /**
   * 打开「更换头像」对话框：草稿从打工人当前头像开始。
   *
   */
  function openAvatarDialog(worker: Worker) {
    if (mutating) return
    setAvatarTarget(worker.name)
    setDraftAvatar(avatarPreset(worker.avatar).id)
    setAvatarError(null)
    setAvatarOpen(true)
  }

  /** 关闭「更换头像」对话框；保存中不响应关闭。 */
  function closeAvatarDialog() {
    if (avatarSaving) return
    setAvatarOpen(false)
    setAvatarTarget(null)
    setAvatarError(null)
  }

  /** 保存头像：成功后只局部更新那一个打工人，详情页不闪烁。 */
  async function saveAvatar() {
    if (avatarTarget === null || avatarSaving) return
    setAvatarSaving(true)
    setAvatarError(null)
    try {
      const body = await requestJson(AVATAR_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: avatarTarget, avatar: draftAvatar }),
      })
      const saved = body?.worker?.avatar
      patchWorker(avatarTarget, { avatar: typeof saved === 'string' ? saved : draftAvatar })
      flash('success', t('avatarUpdated'))
      setAvatarOpen(false)
      setAvatarTarget(null)
    } catch (failure) {
      setAvatarError(`${t('avatarSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setAvatarSaving(false)
    }
  }

  /**
   * 打开「重命名打工人」对话框：草稿从当前名称开始，用户直接改成新名。
   * 登记文件损坏、目录缺失或写操作进行中时不打开（入口按钮也会禁用）。
   */
  function openRenameDialog() {
    if (selectedWorker === null || mutating || corrupt || selectedWorker.exists === false) return
    setRenameDraft(selectedWorker.name)
    setRenameError(null)
    setRenameOpen(true)
  }

  /** 关闭「重命名打工人」对话框；保存中不响应关闭。 */
  function closeRenameDialog() {
    if (renameSaving) return
    setRenameOpen(false)
    setRenameError(null)
  }

  /**
   * 重命名打工人：Host 会把目录改到新名并重建 DSH 工作区。
   *
   * 成功后只局部更新列表里的这一条（name / path / mounted / workspaceId /
   * agents），没被用户改过的 AGENTS.md 草稿跟着 Host 同步后的内容走，再把
   * `selectedName` 切到新名让配置视图留在同一个打工人上，最后用 `reload()`
   * 对账；标题是旧名的详情页会因此自然刷新。失败留在对话框里提示。
   *
   */
  async function renameWorker(event: FormEvent) {
    event.preventDefault()
    if (selectedWorker === null || renameSaving) return
    const previousName = selectedWorker.name
    const previousAgents = agentsOf(selectedWorker)
    const nextName = renameDraft.trim()
    if (nextName === '') {
      setRenameError(t('renameEmpty'))
      return
    }
    if (nextName === previousName) {
      setRenameError(t('renameSame'))
      return
    }
    setRenameSaving(true)
    setRenameError(null)
    try {
      const body = await requestJson(RENAME_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: previousName, newName: nextName }),
      })
      const renamed = body?.worker
      const savedName =
        typeof renamed?.name === 'string' && renamed.name !== '' ? renamed.name : nextName
      const patch: Partial<Worker> = {
        name: savedName,
        mounted: body?.mounted === true,
        workspaceId: typeof body?.workspaceId === 'string' ? body.workspaceId : null,
      }
      if (typeof renamed?.path === 'string' && renamed.path !== '') patch.path = renamed.path
      const savedAgents = body?.agents
      if (savedAgents !== null && typeof savedAgents === 'object')
        patch.agents = savedAgents as WorkerAgents
      patchWorker(previousName, patch)
      // Host 会把未改过的 AGENTS.md 模板同步成新名 / 新路径；用户没有改过草稿
      // 时跟着换，否则 AGENTS 页签会显示旧模板，点「保存」还会把它写回去。
      if (
        typeof savedAgents?.content === 'string' &&
        agentsDraft === previousAgents.content &&
        savedAgents.content !== agentsDraft
      ) {
        setAgentsDraft(savedAgents.content)
      }
      setRenameOpen(false)
      setRenameDraft('')
      setSelectedName(savedName)
      flash('success', `${t('renamed')} ${savedName}`)
      reload()
    } catch (failure) {
      setRenameError(`${t('renameSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setRenameSaving(false)
    }
  }

  /**
   * 描述草稿的规范化（与 Host 一致：折叠空白并 trim）；用来判断有没有改动。
   *
   */
  function normalizedDescription(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  }

  /**
   * 保存「描述」页签：Host 折叠空白后写进登记表。工作流通过 `buka_workers`
   * 工具读它，决定是否把节点交给这个打工人；保存成功后只局部更新列表。
   */
  async function saveDescription() {
    if (selectedName === null || descriptionSaving) return
    setDescriptionSaving(true)
    setDescriptionError(null)
    try {
      const body = await requestJson(DESCRIPTION_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: selectedName, description: descriptionDraft }),
      })
      const saved = body?.worker?.description
      const next = typeof saved === 'string' ? saved : normalizedDescription(descriptionDraft)
      patchWorker(selectedName, { description: next })
      setDescriptionDraft(next)
      flash('success', t('descriptionSaved'))
    } catch (failure) {
      setDescriptionError(`${t('descriptionSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setDescriptionSaving(false)
    }
  }

  /**
   * 保存智能体的模型选择；`null` 表示跟随宿主默认模型。
   *
   */
  async function saveWorkerModel() {
    if (selectedName === null || modelSaving) return
    setModelSaving(true)
    setModelError(null)
    try {
      const body = await requestJson(MODEL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: selectedName, model: modelDraft }),
      })
      const saved = (body?.worker?.model ?? null) as WorkerModelSelection | null
      patchWorker(selectedName, { model: saved })
      setModelDraft(saved)
      flash('success', t('modelSaved'))
    } catch (failure) {
      setModelError(`${t('modelSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setModelSaving(false)
    }
  }

  return {
    openAvatarDialog,
    closeAvatarDialog,
    saveAvatar,
    openRenameDialog,
    closeRenameDialog,
    renameWorker,
    normalizedDescription,
    saveDescription,
    saveWorkerModel,
  }
}
