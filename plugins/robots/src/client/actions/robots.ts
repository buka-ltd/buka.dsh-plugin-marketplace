/**
 * 「机器人」页面的机器人管理动作：打开会话、挂载、创建、删除、保存 AGENTS.md。
 *
 * 这些动作只调 Host 路由与 DSH Client Service，然后更新 `useRobotsState` 的
 * 状态；不包含任何渲染。
 *
 * @module @buka/dsh-plugin-robots/client/actions/robots
 */

import type { FormEvent } from 'react'
import { agentsOf, errorCode, failureText, isProgramRobot, messageOf, requestJson } from '../api.ts'
import {
  AGENTS_ROUTE,
  ASSISTANT_ROUTE,
  CREATE_ROUTE,
  REMOVE_ROUTE,
  REVEAL_ROUTE,
} from '../constants.ts'
import type { RobotsPageState } from '../state.ts'
import type { Robot, Translate, UiWorkspaceService, WorkspacesService } from '../types.ts'

/**
 * 构造机器人管理动作。
 *
 */
export function createRobotActions(state: RobotsPageState, t: Translate) {
  const {
    setBusy,
    flash,
    reload,
    patchRobot,
    service,
    mutating,
    creating,
    name,
    setName,
    draftDescription,
    draftAvatar,
    nextAvatarId,
    setDialogOpen,
    setCreateError,
    setCreating,
    setConfirming,
    selectedName,
    setSelectedName,
    agentsDraft,
    agentsSaving,
    setAgentsSaving,
    corrupt,
    setDraftDescription,
    setDraftAvatar,
  } = state

  /**
   * 打开机器人会话：只有已挂载（有 workspaceId）才能打开；否则提示先挂载。
   * 打开走 DSH 的 `uiWorkspace.openWorkspace(workspaceId)`。
   *
   */
  async function openRobot(robot: Robot) {
    if (isProgramRobot(robot)) {
      flash('error', t('programReadOnly'))
      return
    }
    if (
      robot.mounted !== true ||
      typeof robot.workspaceId !== 'string' ||
      robot.workspaceId === ''
    ) {
      flash('error', t('openUnmounted'))
      return
    }
    const uiWorkspace = service<UiWorkspaceService>('uiWorkspace')
    if (uiWorkspace === null || typeof uiWorkspace.openWorkspace !== 'function') {
      flash('error', t('noUiWorkspace'))
      return
    }
    setBusy(`open:${robot.name}`)
    try {
      await uiWorkspace.openWorkspace(robot.workspaceId)
    } catch (failure) {
      flash('error', `${t('openFailed')} ${messageOf(failure)}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 用系统文件管理器打开机器人目录（macOS 上是 Finder）。
   *
   * 成功不弹提示：Finder 窗口本身就是反馈；失败用 Toast 说明。
   *
   */
  async function revealRobot(robot: Robot) {
    if (mutating) return
    if (isProgramRobot(robot)) {
      flash('error', t('programReadOnly'))
      return
    }
    setBusy(`reveal:${robot.name}`)
    try {
      await requestJson(REVEAL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: robot.name }),
      })
    } catch (failure) {
      const extra = errorCode(failure) === 'reveal-failed' ? '' : ` ${failureText(t, failure)}`
      flash('error', `${t('revealFailed')}${extra}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 把机器人挂载成 DSH 工作区：目录已经由 Host 建好，这里只调用
   * `workspaces.create({ path })`，成功后刷新列表让卡片变成「已挂载」。
   *
   */
  async function mountRobot(robot: Robot) {
    if (isProgramRobot(robot)) {
      flash('error', t('programReadOnly'))
      return
    }
    const workspaces = service<WorkspacesService>('workspaces')
    if (workspaces === null || typeof workspaces.create !== 'function') {
      flash('error', t('noWorkspacesCreate'))
      return
    }
    setBusy(`mount:${robot.name}`)
    try {
      await workspaces.create({ path: robot.path })
      flash('success', `${t('mounted')} ${robot.name}`)
      reload()
    } catch (failure) {
      flash('error', `${t('mountFailed')} ${messageOf(failure)}`)
    } finally {
      setBusy(null)
    }
  }

  /** 打开「创建机器人」对话框：清掉上一次的输入，并按现有机器人挑一个新头像。 */
  function openCreateDialog() {
    if (creating || corrupt) return
    setName('')
    setDraftDescription('')
    setDraftAvatar(nextAvatarId())
    setCreateError(null)
    setDialogOpen(true)
  }

  /** 关闭「创建机器人」对话框；提交中不响应关闭，避免请求回来时状态错位。 */
  function closeCreateDialog() {
    if (creating) return
    setDialogOpen(false)
    setCreateError(null)
  }

  /**
   * 新建机器人：Host 先建目录并写入登记表，浏览器再把它挂载成工作区。
   * 挂载失败不会撤销机器人 —— 它会以「未挂载」留在列表里，可稍后点「挂载」。
   * 创建请求本身的失败留在对话框里原地提示，不用关掉重开。
   *
   */
  async function createRobot(event: FormEvent) {
    event.preventDefault()
    if (creating || corrupt) return
    const value = name.trim()
    if (value === '') {
      setCreateError(t('createEmpty'))
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const body = await requestJson(CREATE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: value, avatar: draftAvatar, description: draftDescription }),
      })
      setName('')
      setDialogOpen(false)
      const robotPath = body?.robot?.path
      if (typeof robotPath !== 'string' || robotPath === '') {
        flash('error', `${t('createFailed')} ${messageOf('host did not return the robot path')}`)
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
        await workspaces.create({ path: robotPath })
        flash('success', `${created ? t('created') : t('createExisting')} ${value}`)
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

  /**
   * 删除机器人：先摘掉 DSH 工作区注册（若已挂载），再删插件登记记录。
   * 机器人目录与文件保留，这也是二次确认文案要说明的语义。
   *
   */
  async function removeRobot(robot: Robot) {
    if (isProgramRobot(robot)) {
      flash('error', t('programReadOnly'))
      return
    }
    setBusy(`delete:${robot.name}`)
    try {
      if (
        robot.mounted === true &&
        typeof robot.workspaceId === 'string' &&
        robot.workspaceId !== ''
      ) {
        const workspaces = service<WorkspacesService>('workspaces')
        if (workspaces === null || typeof workspaces.delete !== 'function') {
          flash('error', t('noWorkspacesDelete'))
          return
        }
        try {
          await workspaces.delete(robot.workspaceId)
        } catch (failure) {
          flash('error', `${t('deleteFailed')} ${messageOf(failure)}`)
          return
        }
      }
      try {
        await requestJson(REMOVE_ROUTE, {
          method: 'POST',
          body: JSON.stringify({ name: robot.name }),
        })
      } catch (failure) {
        // 工作区注册可能已经摘掉；刷新让卡片回到真实状态，确认按钮保留可重试。
        flash('error', `${t('deleteFailed')} ${failureText(t, failure)}`)
        reload()
        return
      }
      setConfirming(null)
      if (selectedName === robot.name) setSelectedName(null)
      reload()
      flash('success', `${t('deleted')} ${robot.name}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 保存 AGENTS.md：Host 按机器人 name 解析目录并写文件，返回值里带字节数
   * 与修改时间，用来更新本地摘要。
   *
   */
  async function saveAgents(robot: Robot) {
    if (agentsSaving) return
    if (isProgramRobot(robot)) {
      flash('error', t('programReadOnly'))
      return
    }
    const content = agentsDraft
    if (content === agentsOf(robot).content) return
    setAgentsSaving(true)
    try {
      const body = await requestJson(AGENTS_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: robot.name, content }),
      })
      patchRobot(robot.name, {
        agents: {
          ...agentsOf(robot),
          exists: true,
          bytes: typeof body.bytes === 'number' ? body.bytes : agentsOf(robot).bytes,
          modifiedAt:
            typeof body.modifiedAt === 'string' ? body.modifiedAt : agentsOf(robot).modifiedAt,
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

  /**
   * 标记 / 取消助理：只有 agent 型机器人可以设（program 机器人由服务端拒绝）。
   *
   */
  async function toggleAssistant(robot: Robot) {
    if (mutating || isProgramRobot(robot)) return
    const next = robot.assistant !== true
    setBusy(`assistant:${robot.name}`)
    try {
      const body = await requestJson(ASSISTANT_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: robot.name, assistant: next }),
      })
      const saved = body?.robot?.assistant
      patchRobot(robot.name, { assistant: typeof saved === 'boolean' ? saved : next })
      flash('success', next ? t('assistantSet') : t('assistantCleared'))
    } catch (failure) {
      flash('error', `${t('assistantSaveFailed')} ${failureText(t, failure)}`)
    } finally {
      setBusy(null)
    }
  }

  return {
    openRobot,
    revealRobot,
    mountRobot,
    openCreateDialog,
    closeCreateDialog,
    createRobot,
    removeRobot,
    saveAgents,
    toggleAssistant,
  }
}
