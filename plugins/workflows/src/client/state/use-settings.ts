/**
 * 自动归档设置对话框的动作：校验、读取与保存。
 */

import { messageOf } from '../format.ts'
import { requestJson } from '../request.ts'
import type { ClientError, SettingsDraft, Translate } from '../types.ts'
import { DEFAULT_ARCHIVE_HOURS, DEFAULT_DELETE_HOURS, isRecord, SETTINGS_ROUTE } from '../types.ts'
import type { PageState } from './use-page-state.ts'

/** 设置对话框依赖。 */
interface SettingsDeps {
  t: Translate
  flash: (kind: 'success' | 'error', text: string) => void
  reload: () => void
}

/** 自动归档设置对话框的动作。 */
export interface SettingsActions {
  /** 校验设置草稿里的两个小时数。 */
  settingsValidationError: (draft: SettingsDraft) => string | null
  openSettingsDialog: () => Promise<void>
  closeSettingsDialog: () => void
  saveSettings: () => Promise<void>
}

/**
 * 自动归档设置对话框的读写动作。
 *
 * @param state 页面状态
 * @param deps 词典、Toast 与列表刷新
 * @returns 设置对话框动作
 */
export function createSettingsActions(
  state: PageState,
  { t, flash, reload }: SettingsDeps,
): SettingsActions {
  const {
    settingsSaving,
    setSettingsOpen,
    setSettingsError,
    setSettingsDraft,
    setSettingsLoading,
    settingsDraft,
    setSettingsSaving,
  } = state

  /**
   * 校验设置草稿里的两个小时数：必须是整数、落在范围内，且删除晚于归档。
   *
   * @param draft
   * @returns 错误文案；null 表示通过
   */
  function settingsValidationError(draft: SettingsDraft): string | null {
    const archiveText = String(draft.archiveHours ?? '').trim()
    const deleteText = String(draft.deleteHours ?? '').trim()
    if (!/^\d+$/u.test(archiveText)) return t('archiveInvalid')
    const archiveHours = Number(archiveText)
    if (archiveHours < 1 || archiveHours > 720) return t('archiveInvalid')
    if (!/^\d+$/u.test(deleteText)) return t('deleteInvalid')
    const deleteHours = Number(deleteText)
    if (deleteHours < 2 || deleteHours > 8760) return t('deleteInvalid')
    if (deleteHours <= archiveHours) return t('deleteBeforeArchive')
    return null
  }

  /**
   * 打开自动归档设置对话框：先清空草稿，再读 Host 的当前设置。读失败时留在
   * 对话框里说明原因；读取期间显示 loading。
   */
  async function openSettingsDialog(): Promise<void> {
    setSettingsOpen(true)
    setSettingsError(null)
    setSettingsDraft(null)
    setSettingsLoading(true)
    try {
      const body = await requestJson(SETTINGS_ROUTE)
      const settings = isRecord(body.settings) ? body.settings : {}
      setSettingsDraft({
        enabled: settings.enabled === true,
        archiveHours: String(settings.archiveAfterHours ?? DEFAULT_ARCHIVE_HOURS),
        deleteHours: String(settings.deleteAfterHours ?? DEFAULT_DELETE_HOURS),
      })
    } catch (failure) {
      setSettingsError(`${t('settingsLoadFailed')} ${messageOf(failure)}`)
    } finally {
      setSettingsLoading(false)
    }
  }

  /** 关闭设置对话框；保存中不响应关闭。 */
  function closeSettingsDialog(): void {
    if (settingsSaving) return
    setSettingsOpen(false)
    setSettingsError(null)
    setSettingsDraft(null)
  }

  /**
   * 保存自动归档设置：校验通过后写回 Host，成功后关闭对话框并刷新列表（归档
   * 结果可能刚刚变化）。
   */
  async function saveSettings(): Promise<void> {
    const draft = settingsDraft
    if (draft === null || settingsValidationError(draft) !== null) return
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      const response = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          archiveAfterHours: Number(draft.archiveHours),
          deleteAfterHours: Number(draft.deleteHours),
        }),
      })
      const parsed: unknown = await response.json().catch(() => null)
      const body = isRecord(parsed) ? parsed : null
      if (!response.ok || body === null || body.ok !== true) {
        const error = new Error(
          typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
        ) as ClientError
        error.code = body?.code
        throw error
      }
      setSettingsOpen(false)
      setSettingsDraft(null)
      flash('success', t('saved'))
      reload()
    } catch (failure) {
      setSettingsError(`${t('settingsSaveFailed')} ${messageOf(failure)}`)
    } finally {
      setSettingsSaving(false)
    }
  }

  return {
    settingsValidationError,
    openSettingsDialog,
    closeSettingsDialog,
    saveSettings,
  }
}
