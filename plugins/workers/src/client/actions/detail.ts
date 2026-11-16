/**
 * 「打工人」详情页的动作：更换头像、改展示名、保存职责描述。
 *
 * @module @buka/dsh-plugin-workers/client/actions/detail
 */

import type { FormEvent } from 'react'
import { failureText, requestJson } from '../api.ts'
import { avatarPreset } from '../avatar.ts'
import { AVATAR_ROUTE, DESCRIPTION_ROUTE, MODEL_ROUTE, RENAME_ROUTE } from '../constants.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate, Worker, WorkerModelSelection } from '../types.ts'

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
    selectedId,
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
    setAvatarTarget(worker.id)
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
        body: JSON.stringify({ id: avatarTarget, avatar: draftAvatar }),
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
   * 打开「重命名打工人」对话框：草稿从当前展示名开始，用户直接改成新名称。
   * 登记文件损坏或写操作进行中时不打开（入口按钮也会禁用）；目录缺失不影响
   * 改展示名。
   */
  function openRenameDialog() {
    if (selectedWorker === null || mutating || corrupt) return
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
   * 改展示名：Host 只更新登记表里的 `name`，目录与工作区注册保持不变，已挂载
   * 工作区的标题同步成新名称。成功后只局部更新列表里的这一条，`selectedId`
   * 不变，详情页留在同一个打工人上；失败留在对话框里提示。
   *
   */
  async function renameWorker(event: FormEvent) {
    event.preventDefault()
    if (selectedWorker === null || renameSaving) return
    const previousName = selectedWorker.name
    const nextName = renameDraft.trim()
    if (nextName === previousName) {
      setRenameError(t('renameSame'))
      return
    }
    setRenameSaving(true)
    setRenameError(null)
    try {
      const body = await requestJson(RENAME_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: selectedWorker.id, name: nextName }),
      })
      const saved = body?.worker
      const savedName = typeof saved?.name === 'string' ? saved.name : nextName
      patchWorker(selectedWorker.id, { name: savedName })
      setRenameOpen(false)
      setRenameDraft('')
      const display = savedName === '' ? selectedWorker.id : savedName
      flash('success', `${t('renamed')} ${display}`)
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
    if (selectedId === null || descriptionSaving) return
    setDescriptionSaving(true)
    setDescriptionError(null)
    try {
      const body = await requestJson(DESCRIPTION_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: selectedId, description: descriptionDraft }),
      })
      const saved = body?.worker?.description
      const next = typeof saved === 'string' ? saved : normalizedDescription(descriptionDraft)
      patchWorker(selectedId, { description: next })
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
    if (selectedId === null || modelSaving) return
    setModelSaving(true)
    setModelError(null)
    try {
      const body = await requestJson(MODEL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: selectedId, model: modelDraft }),
      })
      const saved = (body?.worker?.model ?? null) as WorkerModelSelection | null
      patchWorker(selectedId, { model: saved })
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
