/**
 * 「执行者」页面的全部 UI 状态与派生值。
 *
 * 页面只保存 UI 状态；执行者列表（登记表）来自 Host 的 `/buka-workers/list`。
 * 状态集中在 `useWorkersState` 里，视图与动作模块只读写它，不各自持有副本。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/state
 */

import React from 'react'
import { messageOf, requestJson } from './api.ts'
import { AVATARS, avatarPreset, DEFAULT_AVATAR_ID } from './avatar.ts'
import {
  FILE_ROUTE,
  FILES_ROUTE,
  LIST_ROUTE,
  MODELS_ROUTE,
  OPEN_IN_APP_APPS_ROUTE,
  OPEN_IN_APP_CHOICE_KEY,
} from './constants.ts'
import type {
  DeleteDialogState,
  DialogFailure,
  InstallCandidates,
  InstallReposState,
  ListData,
  ListState,
  Notice,
  SkillChecksState,
  Worker,
  WorkerFileContentData,
  WorkerFileNode,
  WorkerFileTreeData,
  WorkerModelCatalogData,
  WorkerModelCatalogState,
  WorkerModelSelection,
} from './types.ts'

/** 页面从插件上下文里取 DSH 的 Client Service；不存在时返回 null。 */
export type GetService = (serviceName: string) => unknown | null

/**
 * 「文件」页签的状态：目录树、当前选中的文件与两段加载状态。
 *
 * 树与内容分开标记加载，点文件时右侧可以先进入 loading 而不遮住左侧树。
 */
interface WorkerFilesState {
  /** 当前文件树属于哪个执行者；切执行者后旧的异步响应据此丢弃。 */
  workerId: string | null
  treeStatus: 'idle' | 'loading' | 'ready' | 'error'
  tree: WorkerFileNode[] | null
  truncated: boolean
  treeError: string | null
  selectedPath: string
  contentStatus: 'idle' | 'loading' | 'ready' | 'error'
  content: WorkerFileContentData | null
  contentError: string | null
}

/** DSH 内置「用应用打开」的应用清单状态。 */
interface OpenInAppState {
  status: 'loading' | 'ready' | 'unavailable'
  apps: string[]
}

/** 「技能」页签自动检查的初始状态。 */
const EMPTY_SKILL_CHECKS: SkillChecksState = {
  workerId: null,
  status: 'idle',
  results: {},
  error: null,
}

/** 「文件」页签的初始状态。 */
const EMPTY_FILES: WorkerFilesState = {
  workerId: null,
  treeStatus: 'idle',
  tree: null,
  truncated: false,
  treeError: null,
  selectedPath: '',
  contentStatus: 'idle',
  content: null,
  contentError: null,
}

/** 深度优先找第一个文件；没有文件时返回空串。 */
function firstFilePath(nodes: readonly WorkerFileNode[]): string {
  for (const node of nodes) {
    if (node.kind === 'file') return node.path
    const nested = firstFilePath(node.children ?? [])
    if (nested !== '') return nested
  }
  return ''
}

/** 按名字找文件（如根目录的 AGENTS.md）；没有时返回空串。 */
function findFilePath(nodes: readonly WorkerFileNode[], name: string): string {
  for (const node of nodes) {
    if (node.kind === 'file' && node.name === name) return node.path
    const nested = findFilePath(node.children ?? [], name)
    if (nested !== '') return nested
  }
  return ''
}

/** 默认打开 AGENTS.md；没有就退到第一个文件。 */
function defaultFilePath(nodes: readonly WorkerFileNode[]): string {
  const agents = findFilePath(nodes, 'AGENTS.md')
  return agents === '' ? firstFilePath(nodes) : agents
}

/**
 * 页面状态：列表、详情、各个对话框的草稿 / 失败提示，以及派生的 workers 等。
 *
 */
export function useWorkersState(props: { getService: GetService }) {
  const getService = typeof props.getService === 'function' ? props.getService : () => null

  /** 列表请求：`data` 是成功的响应，`error` 是失败原因，`loading` 覆盖首载与刷新。 */
  const [list, setList] = React.useState<ListState>({ data: null, error: null, loading: true })
  const [reloadKey, setReloadKey] = React.useState(0)

  /** 创建对话框里的标识符草稿（必填、创建后不可改）与可选展示名。 */
  const [createId, setCreateId] = React.useState('')
  const [createName, setCreateName] = React.useState('')
  /** 创建对话框里的描述草稿；提交时随标识符一起写入登记表。 */
  const [draftDescription, setDraftDescription] = React.useState('')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  /**
   * 删除确认弹窗：先读影响面（阻塞作业 / 会变成不可用的工作流 / 历史作业数 /
   * 将被删除的目录），确认按钮在 `saving` 或存在阻塞作业时禁用。
   */
  const [deleteDialog, setDeleteDialog] = React.useState<DeleteDialogState>({
    target: null,
    impact: null,
    loading: false,
    error: null,
    saving: false,
  })
  const [busy, setBusy] = React.useState<string | null>(null)

  /**
   * 头像状态：`draftAvatar` 是创建对话框 / 「更换头像」对话框里当前选中的
   * 预设；`avatarTarget` 非空时「更换头像」对话框打开，值是执行者标识符。
   */
  const [draftAvatar, setDraftAvatar] = React.useState<string>(DEFAULT_AVATAR_ID)
  const [avatarOpen, setAvatarOpen] = React.useState(false)
  const [avatarTarget, setAvatarTarget] = React.useState<string | null>(null)
  const [avatarSaving, setAvatarSaving] = React.useState(false)
  /** 「更换头像」对话框里的失败提示：请求失败时留在框里，不靠会被遮住的 Toast。 */
  const [avatarError, setAvatarError] = React.useState<string | null>(null)

  /**
   * 「描述」页签的草稿与保存状态；草稿在进入详情时从执行者当前描述初始化，
   * 列表刷新不会覆盖用户正在编辑的内容。
   */
  const [descriptionDraft, setDescriptionDraft] = React.useState('')
  const [descriptionSaving, setDescriptionSaving] = React.useState(false)
  const [descriptionError, setDescriptionError] = React.useState<string | null>(null)

  /**
   * 「设置」页签里的展示名草稿；进入详情时从执行者当前名称初始化。与职责、
   * 模型一样没有保存按钮，停止输入后自动写回登记表。
   */
  const [nameDraft, setNameDraft] = React.useState('')
  const [nameSaving, setNameSaving] = React.useState(false)
  const [nameError, setNameError] = React.useState<string | null>(null)

  /**
   * 「模型」页签：目录按需加载；`modelDraft` 为 null 表示跟随宿主默认模型，
   * 保存失败留在页签里，不用会被滚走的 Toast。
   */
  const [modelCatalog, setModelCatalog] = React.useState<WorkerModelCatalogState>({
    status: 'idle',
    data: null,
    error: null,
  })
  const [modelDraft, setModelDraft] = React.useState<WorkerModelSelection | null>(null)
  const [modelSaving, setModelSaving] = React.useState(false)
  const [modelError, setModelError] = React.useState<string | null>(null)

  /** 详情页状态：`selectedId` 非空时显示配置视图，`tab` 是页签。 */
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState('settings')
  const [files, setFiles] = React.useState<WorkerFilesState>(EMPTY_FILES)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [confirmingSkill, setConfirmingSkill] = React.useState<string | null>(null)
  const [skillError, setSkillError] = React.useState<DialogFailure | null>(null)

  /**
   * 「安装 skills」对话框的状态。
   *
   * - `candidates.status`：`idle` 还没读 / `loading` 读取中 / `ready` 有清单 /
   *   `error` 读取失败（带命令输出）；
   * - `installSelected`：勾选的 skill 名；每次读出清单时默认全选未安装的；
   * - `installRepos.status`：`unavailable` 表示 Skills 插件没安装（对话框给出
   *   安装提示），`ready` 时 `repos` 是「技能仓库」里收藏的来源；`corrupt`
   *   表示收藏文件无法解析。
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
  const [installRepos, setInstallRepos] = React.useState<InstallReposState>({
    status: 'idle',
    repos: [],
    corrupt: false,
    error: null,
  })

  /** Toast 文案；同一时刻只保留最后一条。 */
  const [notice, setNotice] = React.useState<Notice | null>(null)

  // 技能页签：进入页签时自动检查更新，结果按 skill 名保存；`updatingSkill`
  // 是正在行内更新的那一项，与列表页的批量更新标记一起避免重复点击。
  // 放在状态 Hook 列表末尾，避免改变已有状态的位置。
  const [skillChecks, setSkillChecks] = React.useState<SkillChecksState>(EMPTY_SKILL_CHECKS)
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)
  const [updatingAllSkills, setUpdatingAllSkills] = React.useState(false)
  // 「用应用打开」：应用清单来自 DSH 内置 open-in-app 的 HTTP 契约；失败或
  // 非桌面组合（清单为空）时页面退回原来的 Finder 按钮。
  const [openInApp, setOpenInApp] = React.useState<OpenInAppState>({
    status: 'loading',
    apps: [],
  })
  const [openInAppChoice, setOpenInAppChoice] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    try {
      const raw = window.localStorage.getItem(OPEN_IN_APP_CHOICE_KEY)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed === 'string') setOpenInAppChoice(parsed)
      }
    } catch {
      // 隐私模式 / 存储被禁用：没有记住的选择，用清单里的第一个应用。
    }
    fetch(OPEN_IN_APP_APPS_ROUTE, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((body) => {
        if (cancelled) return
        const record = body !== null && typeof body === 'object' ? (body as { apps?: unknown }) : {}
        const apps = Array.isArray(record.apps)
          ? record.apps.filter((id): id is string => typeof id === 'string')
          : []
        setOpenInApp({ status: apps.length > 0 ? 'ready' : 'unavailable', apps })
      })
      .catch(() => {
        if (!cancelled) setOpenInApp({ status: 'unavailable', apps: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 首次挂载与每次刷新（reloadKey 变化）都重新读 Host 的执行者登记表。
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
  const workers = Array.isArray(data?.workers) ? data.workers : []
  const registry = typeof data?.registry === 'string' ? data.registry : ''
  const corrupt = data?.corrupt === true
  const selectedWorker =
    selectedId === null ? null : (workers.find((worker) => worker.id === selectedId) ?? null)

  /** 任意写操作进行中：按钮据此统一禁用，避免并发请求互相覆盖。 */
  const mutating =
    creating ||
    busy !== null ||
    installing ||
    updatingSkill !== null ||
    updatingAllSkills ||
    removing !== null ||
    avatarSaving ||
    descriptionSaving ||
    nameSaving ||
    modelSaving ||
    deleteDialog.saving

  /**
   * 新建执行者时的默认头像：按预设顺序挑第一个还没被占用的，避免刚建的一批
   * 执行者全是一个样子（Host 也会在没传头像时做同样的分配）。
   *
   */
  function nextAvatarId(): string {
    const used = new Set(workers.map((worker) => avatarPreset(worker.avatar).id))
    const free = AVATARS.find((preset) => !used.has(preset.id))
    return (free ?? AVATARS[0]).id
  }

  // 详情里的执行者被外部移除（刷新后不在登记表里）时回到列表页，避免停在
  // 一个永远加载不出来的配置页。
  React.useEffect(() => {
    if (data === null || selectedId === null) return
    if (!workers.some((worker) => worker.id === selectedId)) setSelectedId(null)
  }, [data, selectedId])

  /**
   * 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
   *
   */
  function flash(kind: 'success' | 'error', text: string) {
    setNotice({ kind, text, seq: Date.now() + Math.random() })
  }

  /** 重新读一次执行者列表（新建 / 挂载 / 删除 / 安装 skill 之后都会调用）。 */
  function reload() {
    setReloadKey((key) => key + 1)
  }

  /**
   * 按需读取模型目录：同一时间只发一个请求；`force` 用于目录刷新。
   *
   */
  function loadModelCatalog(force = false) {
    if (!force && (modelCatalog.status === 'loading' || modelCatalog.status === 'ready')) return
    setModelCatalog((prev) => ({ status: 'loading', data: prev.data, error: null }))
    requestJson<WorkerModelCatalogData>(MODELS_ROUTE).then(
      (body) => setModelCatalog({ status: 'ready', data: body, error: null }),
      (failure) =>
        setModelCatalog((prev) => ({
          status: 'error',
          data: prev.data,
          error: messageOf(failure),
        })),
    )
  }

  /**
   * 用 Host 的响应局部更新一个执行者，不整表刷新，避免详情页闪烁。
   *
   */
  function patchWorker(workerId: string, patch: Partial<Worker>) {
    setList((prev) => {
      if (prev.data === null || !Array.isArray(prev.data.workers)) return prev
      return {
        ...prev,
        data: {
          ...prev.data,
          workers: prev.data.workers.map((worker) =>
            worker.id === workerId ? { ...worker, ...patch } : worker,
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
   * 读取一个执行者的目录树，并自动打开 AGENTS.md（没有就打开第一个文件）。
   *
   */
  function loadFiles(worker: Worker) {
    const workerId = worker.id
    setFiles({ ...EMPTY_FILES, workerId, treeStatus: 'loading' })
    requestJson<WorkerFileTreeData>(`${FILES_ROUTE}?id=${encodeURIComponent(workerId)}`).then(
      (body) => {
        const tree = Array.isArray(body.nodes) ? body.nodes : []
        const selected = defaultFilePath(tree)
        setFiles({
          ...EMPTY_FILES,
          workerId,
          treeStatus: 'ready',
          tree,
          truncated: body.truncated === true,
          selectedPath: selected,
          ...(selected === '' ? {} : { contentStatus: 'loading' as const }),
        })
        if (selected !== '') loadFileContent(workerId, selected)
      },
      (failure) => {
        setFiles((prev) =>
          prev.workerId === workerId
            ? { ...prev, treeStatus: 'error', tree: null, treeError: messageOf(failure) }
            : prev,
        )
      },
    )
  }

  /**
   * 读取一个文件的只读内容；同一执行者、同一路径的旧响应才不会覆盖新选择。
   *
   */
  function loadFileContent(workerId: string, relative: string) {
    setFiles((prev) =>
      prev.workerId === workerId
        ? {
            ...prev,
            selectedPath: relative,
            contentStatus: 'loading',
            content: null,
            contentError: null,
          }
        : prev,
    )
    const url = `${FILE_ROUTE}?id=${encodeURIComponent(workerId)}&path=${encodeURIComponent(relative)}`
    requestJson<WorkerFileContentData>(url).then(
      (body) => {
        setFiles((prev) =>
          prev.workerId === workerId && prev.selectedPath === relative
            ? { ...prev, contentStatus: 'ready', content: body, contentError: null }
            : prev,
        )
      },
      (failure) => {
        setFiles((prev) =>
          prev.workerId === workerId && prev.selectedPath === relative
            ? { ...prev, contentStatus: 'error', content: null, contentError: messageOf(failure) }
            : prev,
        )
      },
    )
  }

  /** 打开目录树里的一个文件。 */
  function openFile(worker: Worker, relative: string) {
    loadFileContent(worker.id, relative)
  }

  /**
   * 进入配置视图：清掉上一个执行者的临时状态，并预读「文件」页签的目录树。
   *
   */
  function openDetail(worker: Worker) {
    // 机器人只读：没有目录、文件与 skills，不进入配置视图。
    if (worker.driver === 'robot') return
    setSelectedId(worker.id)
    setTab('settings')
    setFiles(EMPTY_FILES)
    loadModelCatalog()
    loadFiles(worker)
    setDescriptionDraft(typeof worker.description === 'string' ? worker.description : '')
    setDescriptionError(null)
    setNameDraft(typeof worker.name === 'string' ? worker.name : '')
    setNameError(null)
    setSkillError(null)
    setSkillChecks(EMPTY_SKILL_CHECKS)
    setConfirmingSkill(null)
    setInstallOpen(false)
    setInstallError(null)
    setModelDraft(worker.model ?? null)
    setModelError(null)
    setNotice(null)
  }

  /** 返回列表页，并清掉详情页临时状态。 */
  function backToList() {
    setSelectedId(null)
    setFiles(EMPTY_FILES)
    setDescriptionError(null)
    setNameError(null)
    setSkillError(null)
    setSkillChecks(EMPTY_SKILL_CHECKS)
    setConfirmingSkill(null)
    setInstallOpen(false)
    setInstallError(null)
    setModelError(null)
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
    if (next === 'settings') loadModelCatalog()
    if (next === 'files' && selectedWorker !== null) loadFiles(selectedWorker)
  }

  return {
    list,
    setList,
    reloadKey,
    setReloadKey,
    createId,
    setCreateId,
    createName,
    setCreateName,
    draftDescription,
    setDraftDescription,
    dialogOpen,
    setDialogOpen,
    createError,
    setCreateError,
    creating,
    setCreating,
    deleteDialog,
    setDeleteDialog,
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
    nameDraft,
    setNameDraft,
    nameSaving,
    setNameSaving,
    nameError,
    setNameError,
    modelCatalog,
    setModelCatalog,
    modelDraft,
    setModelDraft,
    modelSaving,
    setModelSaving,
    modelError,
    setModelError,
    loadModelCatalog,
    selectedId,
    setSelectedId,
    tab,
    setTab,
    files,
    loadFiles,
    openFile,
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
    skillChecks,
    setSkillChecks,
    updatingSkill,
    setUpdatingSkill,
    updatingAllSkills,
    setUpdatingAllSkills,
    openInApp,
    setOpenInApp,
    openInAppChoice,
    setOpenInAppChoice,
    installRepos,
    setInstallRepos,
    notice,
    setNotice,
    data,
    workers,
    registry,
    corrupt,
    selectedWorker,
    mutating,
    nextAvatarId,
    flash,
    reload,
    patchWorker,
    service,
    openDetail,
    backToList,
    switchTab,
  }
}

/** 页面状态的具体形状（由 `useWorkersState` 的返回值推导）。 */
export type WorkersPageState = ReturnType<typeof useWorkersState>
