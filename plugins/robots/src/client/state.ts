/**
 * 「机器人」页面的全部 UI 状态与派生值。
 *
 * 页面只保存 UI 状态；机器人列表（登记表）来自 Host 的 `/buka-robots/list`。
 * 状态集中在 `useRobotsState` 里，视图与动作模块只读写它，不各自持有副本。
 *
 * @module @buka/dsh-plugin-robots/client/state
 */

import React from 'react'
import { agentsOf, messageOf, requestJson } from './api.ts'
import { AVATARS, avatarPreset, DEFAULT_AVATAR_ID } from './avatar.ts'
import { LIST_ROUTE } from './constants.ts'
import type {
  DialogFailure,
  FavouritesState,
  InstallCandidates,
  ListData,
  ListState,
  Notice,
  Robot,
} from './types.ts'

/** 页面从插件上下文里取 DSH 的 Client Service；不存在时返回 null。 */
export type GetService = (serviceName: string) => unknown | null

/**
 * 页面状态：列表、详情、各个对话框的草稿 / 失败提示，以及派生的 robots 等。
 *
 */
export function useRobotsState(props: { getService: GetService }) {
  const getService = typeof props.getService === 'function' ? props.getService : () => null

  /** 列表请求：`data` 是成功的响应，`error` 是失败原因，`loading` 覆盖首载与刷新。 */
  const [list, setList] = React.useState<ListState>({ data: null, error: null, loading: true })
  const [reloadKey, setReloadKey] = React.useState(0)

  /** 列表页状态。 */
  const [name, setName] = React.useState('')
  /** 创建对话框里的描述草稿；提交时随名字一起写入登记表。 */
  const [draftDescription, setDraftDescription] = React.useState('')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [confirming, setConfirming] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  /**
   * 头像状态：`draftAvatar` 是创建对话框 / 「更换头像」对话框里当前选中的
   * 预设；`avatarTarget` 非空时「更换头像」对话框打开，值是机器人名。
   */
  const [draftAvatar, setDraftAvatar] = React.useState<string>(DEFAULT_AVATAR_ID)
  const [avatarOpen, setAvatarOpen] = React.useState(false)
  const [avatarTarget, setAvatarTarget] = React.useState<string | null>(null)
  const [avatarSaving, setAvatarSaving] = React.useState(false)
  /** 「更换头像」对话框里的失败提示：请求失败时留在框里，不靠会被遮住的 Toast。 */
  const [avatarError, setAvatarError] = React.useState<string | null>(null)

  /**
   * 「描述」页签的草稿与保存状态；草稿在进入详情时从机器人当前描述初始化，
   * 列表刷新不会覆盖用户正在编辑的内容。
   */
  const [descriptionDraft, setDescriptionDraft] = React.useState('')
  const [descriptionSaving, setDescriptionSaving] = React.useState(false)
  const [descriptionError, setDescriptionError] = React.useState<string | null>(null)

  /**
   * 「重命名机器人」对话框：`renameDraft` 是新名称草稿，默认带出当前名称；
   * 失败提示留在对话框里，提交中不响应关闭。
   */
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [renameSaving, setRenameSaving] = React.useState(false)
  const [renameError, setRenameError] = React.useState<string | null>(null)

  /** 详情页状态：`selectedName` 非空时显示配置视图，`tab` 是页签。 */
  const [selectedName, setSelectedName] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState('agents')
  const [agentsDraft, setAgentsDraft] = React.useState('')
  const [agentsSaving, setAgentsSaving] = React.useState(false)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [confirmingSkill, setConfirmingSkill] = React.useState<string | null>(null)
  const [skillError, setSkillError] = React.useState<DialogFailure | null>(null)

  /**
   * 「安装 skills」对话框的状态。
   *
   * - `candidates.status`：`idle` 还没读 / `loading` 读取中 / `ready` 有清单 /
   *   `error` 读取失败（带命令输出）；
   * - `installSelected`：勾选的 skill 名；每次读出清单时默认全选未安装的；
   * - `favourites.status`：`unavailable` 表示 Skills 插件没安装（整块隐藏，
   *   不是错误），`ready` 时 `repos` 是收藏仓库。
   */
  const [installOpen, setInstallOpen] = React.useState(false)
  const [installSource, setInstallSource] = React.useState('')
  const [installCandidates, setInstallCandidates] = React.useState<InstallCandidates>({
    status: 'idle',
    skills: [],
    installed: [],
    error: null,
    output: '',
  })
  const [installSelected, setInstallSelected] = React.useState<string[]>([])
  const [installError, setInstallError] = React.useState<DialogFailure | null>(null)
  const [installing, setInstalling] = React.useState(false)
  const [favourites, setFavourites] = React.useState<FavouritesState>({ status: 'idle', repos: [] })

  /** Toast 文案；同一时刻只保留最后一条。 */
  const [notice, setNotice] = React.useState<Notice | null>(null)

  // 首次挂载与每次刷新（reloadKey 变化）都重新读 Host 的机器人登记表。
  React.useEffect(() => {
    let cancelled = false
    setList((prev) => ({ ...prev, loading: true, error: null }))
    requestJson<ListData>(LIST_ROUTE).then(
      (body) => {
        if (!cancelled) setList({ data: body, error: null, loading: false })
      },
      (failure) => {
        if (!cancelled) setList((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const data = list.data
  const robots = Array.isArray(data?.robots) ? data.robots : []
  const registry = typeof data?.registry === 'string' ? data.registry : ''
  const corrupt = data?.corrupt === true
  const selectedRobot =
    selectedName === null ? null : (robots.find((robot) => robot.name === selectedName) ?? null)

  /** 任意写操作进行中：按钮据此统一禁用，避免并发请求互相覆盖。 */
  const mutating =
    creating ||
    busy !== null ||
    installing ||
    removing !== null ||
    agentsSaving ||
    avatarSaving ||
    descriptionSaving ||
    renameSaving

  /**
   * 新建机器人时的默认头像：按预设顺序挑第一个还没被占用的，避免刚建的一批
   * 机器人全是一个样子（Host 也会在没传头像时做同样的分配）。
   *
   */
  function nextAvatarId(): string {
    const used = new Set(robots.map((robot) => avatarPreset(robot.avatar).id))
    const free = AVATARS.find((preset) => !used.has(preset.id))
    return (free ?? AVATARS[0]).id
  }

  // 详情里的机器人被外部移除（刷新后不在登记表里）时回到列表页，避免停在
  // 一个永远加载不出来的配置页。
  React.useEffect(() => {
    if (data === null || selectedName === null) return
    if (!robots.some((robot) => robot.name === selectedName)) setSelectedName(null)
  }, [data, selectedName])

  /**
   * 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
   *
   */
  function flash(kind: 'success' | 'error', text: string) {
    setNotice({ kind, text, seq: Date.now() + Math.random() })
  }

  /** 重新读一次机器人列表（新建 / 挂载 / 删除 / 安装 skill 之后都会调用）。 */
  function reload() {
    setReloadKey((key) => key + 1)
  }

  /**
   * 用 Host 的响应局部更新一个机器人，不整表刷新，避免详情页闪烁。
   *
   */
  function patchRobot(robotName: string, patch: Partial<Robot>) {
    setList((prev) => {
      if (prev.data === null || !Array.isArray(prev.data.robots)) return prev
      return {
        ...prev,
        data: {
          ...prev.data,
          robots: prev.data.robots.map((robot) =>
            robot.name === robotName ? { ...robot, ...patch } : robot,
          ),
        },
      }
    })
  }

  /**
   * 取一个 DSH Client Service；插件上下文里不存在时返回 null，而不是抛错。
   *
   */
  function service<T>(serviceName: string): T | null {
    try {
      // 页面只关心服务是否存在、方法能否调用；具体形状由调用方按需收窄。
      return (getService(serviceName) ?? null) as T | null
    } catch {
      return null
    }
  }

  /**
   * 进入配置视图：从列表返回值初始化 AGENTS.md 草稿，并清掉上一个机器人的
   * 临时状态。之后刷新列表不会覆盖这份草稿（用户可能正在编辑）。
   *
   */
  function openDetail(robot: Robot) {
    setSelectedName(robot.name)
    setTab('agents')
    setAgentsDraft(agentsOf(robot).content)
    setDescriptionDraft(typeof robot.description === 'string' ? robot.description : '')
    setDescriptionError(null)
    setSkillError(null)
    setConfirmingSkill(null)
    setInstallOpen(false)
    setInstallError(null)
    setRenameOpen(false)
    setRenameError(null)
    setNotice(null)
  }

  /** 返回列表页，并清掉详情页临时状态。 */
  function backToList() {
    setSelectedName(null)
    setDescriptionError(null)
    setSkillError(null)
    setConfirmingSkill(null)
    setInstallOpen(false)
    setInstallError(null)
    setRenameOpen(false)
    setRenameError(null)
    setNotice(null)
  }

  /**
   * 切换详情页签；切换时收起 Toast，避免旧提示留在新页签上方。
   *
   */
  function switchTab(next: string) {
    if (next === tab) return
    setNotice(null)
    setTab(next)
  }

  return {
    list,
    setList,
    reloadKey,
    setReloadKey,
    name,
    setName,
    draftDescription,
    setDraftDescription,
    dialogOpen,
    setDialogOpen,
    createError,
    setCreateError,
    creating,
    setCreating,
    confirming,
    setConfirming,
    busy,
    setBusy,
    draftAvatar,
    setDraftAvatar,
    avatarOpen,
    setAvatarOpen,
    avatarTarget,
    setAvatarTarget,
    avatarSaving,
    setAvatarSaving,
    avatarError,
    setAvatarError,
    descriptionDraft,
    setDescriptionDraft,
    descriptionSaving,
    setDescriptionSaving,
    descriptionError,
    setDescriptionError,
    renameOpen,
    setRenameOpen,
    renameDraft,
    setRenameDraft,
    renameSaving,
    setRenameSaving,
    renameError,
    setRenameError,
    selectedName,
    setSelectedName,
    tab,
    setTab,
    agentsDraft,
    setAgentsDraft,
    agentsSaving,
    setAgentsSaving,
    removing,
    setRemoving,
    confirmingSkill,
    setConfirmingSkill,
    skillError,
    setSkillError,
    installOpen,
    setInstallOpen,
    installSource,
    setInstallSource,
    installCandidates,
    setInstallCandidates,
    installSelected,
    setInstallSelected,
    installError,
    setInstallError,
    installing,
    setInstalling,
    favourites,
    setFavourites,
    notice,
    setNotice,
    data,
    robots,
    registry,
    corrupt,
    selectedRobot,
    mutating,
    nextAvatarId,
    flash,
    reload,
    patchRobot,
    service,
    openDetail,
    backToList,
    switchTab,
  }
}

/** 页面状态的具体形状（由 `useRobotsState` 的返回值推导）。 */
export type RobotsPageState = ReturnType<typeof useRobotsState>
