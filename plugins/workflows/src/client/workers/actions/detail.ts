/**
 * 「执行者」详情页的动作：更换头像，以及设置页签里展示名 / 职责 / 模型的
 * 自动保存。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/actions/detail
 */

import { failureText, requestJson } from '../api.ts'
import { avatarPreset } from '../avatar.ts'
import {
  AVATAR_ROUTE,
  DESCRIPTION_ROUTE,
  MODEL_ROUTE,
  PRESET_ROUTE,
  RENAME_ROUTE,
} from '../constants.ts'
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
    nameDraft,
    nameSaving,
    setNameSaving,
    setNameError,
    selectedId,
    descriptionDraft,
    descriptionSaving,
    setDescriptionSaving,
    setDescriptionError,
    modelDraft,
    modelSaving,
    setModelSaving,
    setModelError,
    agentPresetDraft,
    agentPresetSaving,
    setAgentPresetSaving,
    setAgentPresetError,
    patchWorker,
    flash,
  } = state

  /**
   * 打开「更换头像」对话框：草稿从执行者当前头像开始。
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

  /** 保存头像：成功后只局部更新那一个执行者，详情页不闪烁。 */
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
   * 展示名的规范化（与 Host 一致：折叠空白并 trim），用来判断有没有改动。
   * 空串表示清空名称，展示时回退到标识符。
   */
  function normalizedWorkerName(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  }

  /**
   * 保存展示名：Host 只更新登记表里的 `name`，目录与工作区注册保持不变，已挂载
   * 工作区的标题由 Host 同步。设置页签没有保存按钮，成功后只局部更新列表里的
   * 这一条；失败提示留在区块里。
   */
  async function saveWorkerName() {
    if (selectedId === null || nameSaving) return
    setNameSaving(true)
    setNameError(null)
    try {
      const body = await requestJson(RENAME_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: selectedId, name: nameDraft }),
      })
      const saved = body?.worker
      const savedName =
        typeof saved?.name === 'string' ? saved.name : normalizedWorkerName(nameDraft)
      patchWorker(selectedId, { name: savedName })
    } catch (failure) {
      setNameError(`${t('nameSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setNameSaving(false)
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
   * 保存「描述」页签：Host 折叠空白后写进登记表。工作流通过 `workflow_workers`
   * 工具读它，决定是否把节点交给这个执行者。
   *
   * 设置页签没有保存按钮：页面在输入停下后自动调用这里，所以成功后只局部
   * 更新列表，不改写正在编辑的草稿（改写会吞掉保存期间继续输入的内容）。
   * 失败提示留在区块里。
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
    } catch (failure) {
      setDescriptionError(`${t('descriptionSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setDescriptionSaving(false)
    }
  }

  /**
   * 保存智能体的模型选择；`null` 表示跟随宿主默认模型。
   *
   * 与职责一样由页面在改动后自动调用，成功后只局部更新列表；草稿保持用户
   * 刚选的值，避免把保存期间继续改动的选择覆盖回旧值。
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
    } catch (failure) {
      setModelError(`${t('modelSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setModelSaving(false)
    }
  }

  /**
   * 保存智能体的默认执行者预设；`null` 表示跟随工作流插件的 `workerPreset`。
   *
   * 与模型一样由页面在改动后自动调用，成功后只局部更新列表。
   */
  async function saveWorkerPreset() {
    if (selectedId === null || agentPresetSaving) return
    setAgentPresetSaving(true)
    setAgentPresetError(null)
    try {
      const body = await requestJson(PRESET_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: selectedId, agentPreset: agentPresetDraft }),
      })
      const saved = body?.worker?.agentPreset
      patchWorker(selectedId, {
        agentPreset: typeof saved === 'string' && saved !== '' ? saved : null,
      })
    } catch (failure) {
      setAgentPresetError(`${t('presetSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setAgentPresetSaving(false)
    }
  }

  return {
    openAvatarDialog,
    closeAvatarDialog,
    saveAvatar,
    normalizedWorkerName,
    saveWorkerName,
    normalizedDescription,
    saveDescription,
    saveWorkerModel,
    saveWorkerPreset,
  }
}
