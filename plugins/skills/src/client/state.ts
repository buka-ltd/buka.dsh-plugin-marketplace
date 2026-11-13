/**
 * 页面状态与请求：一个 Hook 管住「已安装」与「收藏」两个面板的数据。
 *
 * 页面只做展示与触发：列表、卸载、安装、收藏的读写都走 Host 一半注册的包内
 * 路由（`/buka-skills/*`），不在浏览器里判断 npx 的安装方式，也不碰文件系统 ——
 * 这样「怎么卸载」「怎么安装」「收藏存在哪」都只有一份实现。收藏页的展开状态与
 * 上次拿到的树属于纯页面状态，缓存在 localStorage（`dsh.buka-skills.view.v1`）：
 * 关闭 DSH 再打开时先按上次的样子渲染，再找 Host 校正，不用干等网络。
 *
 * 面板组件只消费这里返回的状态与动作，不自己发请求。
 *
 * @module @buka/dsh-plugin-skills/client/state
 */

import React from 'react'

import {
  errorCode,
  INSTALL_ROUTE,
  LIST_ROUTE,
  messageOf,
  REPO_REMOVE_ROUTE,
  REPO_SKILLS_ROUTE,
  REPOS_ROUTE,
  requestJson,
  TARGETS_ROUTE,
  UNINSTALL_ROUTE,
} from './api.ts'
import type { PageTab } from './constants.ts'
import type { Translate } from './dictionary.ts'
import {
  entryKey,
  installKeyOf,
  skillKeyOf,
  targetItemsOf,
  targetKeyOf,
  targetLabelOf,
} from './keys.ts'
import { isListableSource, normalizeRepo } from './repo-source.ts'
import type {
  InstalledSkill,
  InstalledSnapshot,
  InstallTargetsSnapshot,
  LoadedState,
  Notice,
  ProbeState,
  RepoRef,
  RepoTreeData,
  SavedRepo,
  SavedSnapshot,
  SkillsPageState,
  SkillTreeLeaf,
  TargetDialog,
  TargetDialogKind,
  TreeState,
  ViewCache,
} from './types.ts'
import { readViewCache, writeViewCache } from './view-cache.ts'

/**
 * 页面的全部状态、副作用与请求。
 *
 * @param t 翻译函数
 */
function useSkillsPageState(t: Translate): SkillsPageState {
  const [tab, setTab] = React.useState<PageTab>('installed')
  const [installed, setInstalled] = React.useState<LoadedState<InstalledSnapshot>>({
    data: null,
    error: null,
    loading: true,
  })
  const [saved, setSaved] = React.useState<LoadedState<SavedSnapshot>>({
    data: null,
    error: null,
    loading: true,
  })
  const [reloadKey, setReloadKey] = React.useState(0)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState<string | null>(null)
  const [source, setSource] = React.useState('')
  const [note, setNote] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [addError, setAddError] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null)
  // 正在安装的树 skill（`installKeyOf()` 的组合键）；Host 侧安装与卸载串行，
  // 这里也同一时刻只放一个请求，避免用户连点排出看不到的队列。
  const [installing, setInstalling] = React.useState<string | null>(null)
  // 「安装到打工人 / 工作区」对话框：打开时才去读目标列表，选中后复用同一条
  // 安装路由（带 `target`）。目标列表与选择都是纯页面状态，不进 localStorage。
  const [targetDialog, setTargetDialog] = React.useState<TargetDialog | null>(null)
  const [targets, setTargets] = React.useState<LoadedState<InstallTargetsSnapshot>>({
    data: null,
    error: null,
    loading: false,
  })
  const [targetChoice, setTargetChoice] = React.useState('')
  const [targetInstalling, setTargetInstalling] = React.useState(false)
  const [targetError, setTargetError] = React.useState<string | null>(null)
  // 目标列表请求的序号：连续打开 / 重读时只让最后一次响应落地。
  const targetRequestRef = React.useRef(0)
  // 收藏仓库的树：哪些卡片展开、各仓库拿到（或正在拿）的树、哪些目录收起来。
  // 按仓库 id 存，删除收藏后由下面的 prune 清掉，避免留下孤儿状态。
  // 初始值来自 localStorage 里的上一份缓存：重开 DSH 后先按上次的样子渲染，
  // 再在后台用 Host 的缓存校正（见下面的 revalidate）。
  const [restored] = React.useState<ViewCache | null>(readViewCache)
  const [expandedRepos, setExpandedRepos] = React.useState<Record<string, true>>(
    restored?.expandedRepos ?? {},
  )
  const [trees, setTrees] = React.useState<Record<string, TreeState>>(restored?.trees ?? {})
  const [collapsedDirs, setCollapsedDirs] = React.useState<Record<string, Record<string, true>>>(
    restored?.collapsedDirs ?? {},
  )
  // 每个可列出 skills 的收藏的仓库类型探测结果（npx skills / Claude Code
  // 市场 / 不可用），只用来渲染标题行的徽标。纯页面状态、不进 localStorage：
  // 重开 DSH 重新探测一次即可。删除收藏时由下面的 prune 一起清掉。
  const [probes, setProbes] = React.useState<Record<string, ProbeState>>({})

  // 每次刷新（或首次挂载）重新读一次 Host 的扫描结果与收藏；两个 Tab 的
  // 数据一起刷新，切 Tab 时不再发请求。
  React.useEffect(() => {
    let cancelled = false
    setInstalled((prev) => ({ ...prev, loading: true, error: null }))
    setSaved((prev) => ({ ...prev, loading: true, error: null }))
    requestJson<InstalledSnapshot>(LIST_ROUTE).then(
      (body) => {
        if (!cancelled) setInstalled({ data: body, error: null, loading: false })
      },
      (failure: unknown) => {
        if (!cancelled) {
          setInstalled((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
        }
      },
    )
    requestJson<SavedSnapshot>(REPOS_ROUTE).then(
      (body) => {
        if (!cancelled) setSaved({ data: body, error: null, loading: false })
      },
      (failure: unknown) => {
        if (!cancelled) setSaved((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const installedData = installed.data
  const skills: InstalledSkill[] = Array.isArray(installedData?.skills) ? installedData.skills : []
  const savedData = saved.data
  const repos: SavedRepo[] = Array.isArray(savedData?.repos) ? savedData.repos : []
  const storeCorrupt = savedData !== null && savedData.corrupt === true
  const loading = tab === 'installed' ? installed.loading : saved.loading

  // 已安装的 skill 来自哪些仓库：收藏行据此标「已安装」。
  const installedRepos = React.useMemo(() => {
    const keys = new Set<string>()
    for (const skill of skills) {
      for (const value of [skill.npxSource, skill.npxSourceUrl]) {
        const key = normalizeRepo(value).key
        if (key !== '') keys.add(key)
      }
    }
    return keys
  }, [installedData])

  // 已安装 skill 的目录键集合：仓库树里的每个 skill 据此显示「已安装」标记
  // 而不是「安装」按钮。用目录名（id）与展示名两个来源，名字与目录名不一致
  // 的历史安装也能命中。
  const installedSkillKeys = React.useMemo(() => {
    const keys = new Set<string>()
    for (const skill of skills) {
      for (const value of [skill.id, skill.name]) {
        const key = skillKeyOf(value)
        if (key !== '') keys.add(key)
      }
    }
    return keys
  }, [installedData])

  // 收藏被删除（或宿主刷新后消失）时，把它的展开态与树一起丢掉。
  React.useEffect(() => {
    if (savedData === null) return
    const ids = new Set(repos.map((repo) => repo.id))
    const prune = <T>(record: Record<string, T>): Record<string, T> => {
      const kept: Record<string, T> = {}
      let dropped = false
      for (const [key, value] of Object.entries(record)) {
        if (ids.has(key)) kept[key] = value
        else dropped = true
      }
      return dropped ? kept : record
    }
    setExpandedRepos(prune)
    setTrees(prune)
    setCollapsedDirs(prune)
    setProbes(prune)
  }, [savedData])

  // 展开状态、收起的目录与拿到的树都写回 localStorage：关掉 DSH 再打开时
  // 能立刻恢复上次的收藏页，不用先等 Host 重新拉取仓库。
  React.useEffect(() => {
    writeViewCache({ expandedRepos, collapsedDirs, trees })
  }, [expandedRepos, collapsedDirs, trees])

  // 从本地缓存恢复出来的树可能已经过期：切到「收藏」Tab 后，用 Host 的磁盘
  // 缓存（必要时才重新拉取仓库）在后台校正。请求期间保留旧树，不会从
  // 「有列表」退回「加载中」。只做一次，之后由展开动作与「刷新」按钮触发。
  const revalidatedRef = React.useRef(false)
  React.useEffect(() => {
    if (tab !== 'repos' || savedData === null || revalidatedRef.current) return
    revalidatedRef.current = true
    for (const repo of repos) {
      if (expandedRepos[repo.id] === true) loadTree(repo)
    }
  }, [tab, savedData])

  // 切到「收藏」Tab 后静默探测每个可列出 skills 的收藏的仓库类型：这是
  // 轻量请求（Host 只拉 tree，必要时拉 marketplace.json），不阻塞列表渲染，
  // 结果只影响标题行的徽标。已经探测过（含探测中、探测失败）的卡片不重复
  // 发请求，想强制重探走顶部「刷新」。
  React.useEffect(() => {
    if (tab !== 'repos' || savedData === null) return
    for (const repo of repos) {
      if (!isListableSource(repo.source)) continue
      if (probes[repo.id] !== undefined) continue
      probeRepo(repo)
    }
  }, [tab, savedData, probes])

  /**
   * 页面「刷新」：重读列表与收藏，并强制刷新已展开仓库的树；没展开的
   * 仓库继续用 Host 缓存，等下次展开再取，避免一次刷新打十几个请求。
   * 所有可列出的收藏同时强制重探仓库类型（刷新徽标），失败保留旧徽标。
   */
  function reload(): void {
    setReloadKey((key) => key + 1)
    for (const repo of repos) {
      if (expandedRepos[repo.id] === true) loadTree(repo, { refresh: true })
      if (isListableSource(repo.source)) probeRepo(repo, { refresh: true })
    }
  }

  /**
   * 取一个仓库的 skills 树。Host 侧有 TTL 缓存并负责拉取仓库内容，这里只在
   * 展开与页面刷新时发请求；失败时保留旧数据，只更新错误状态。
   *
   * @param repo 一条收藏
   * @param options 是否绕过 Host 缓存
   */
  async function loadTree(repo: RepoRef, options: { refresh?: boolean } = {}): Promise<void> {
    const refresh = options.refresh === true
    setTrees((prev) => ({
      ...prev,
      [repo.id]: { status: 'loading', data: prev[repo.id]?.data ?? null, error: null },
    }))
    try {
      const query = `?source=${encodeURIComponent(repo.source)}${refresh ? '&refresh=1' : ''}`
      const body = await requestJson<RepoTreeData>(`${REPO_SKILLS_ROUTE}${query}`)
      setTrees((prev) => ({ ...prev, [repo.id]: { status: 'ready', data: body, error: null } }))
    } catch (failure) {
      setTrees((prev) => ({
        ...prev,
        [repo.id]: { status: 'error', data: prev[repo.id]?.data ?? null, error: failure },
      }))
    }
  }

  /**
   * 探测一个仓库的类型（npx skills / Claude Code 市场 / 不可用）。Host 只拉
   * tree（必要时再拉 marketplace.json），比展开轻得多，所以收藏页打开后可以
   * 对所有可列出的收藏各发一次。
   *
   * 「不可用」是正常结论而不是错误：Host 返回 `repo-unavailable` 时转成
   * `{ kind: 'unavailable' }` 的 ready 数据，让卡片显示「不可用」徽标，不弹
   * 错误；其它失败保留旧徽标、静默，等用户展开时再看完整的错误信息。
   *
   * @param repo 一条收藏
   * @param options 是否绕过 Host 缓存
   */
  async function probeRepo(repo: RepoRef, options: { refresh?: boolean } = {}): Promise<void> {
    const refresh = options.refresh === true
    setProbes((prev) => ({
      ...prev,
      [repo.id]: { status: 'loading', data: prev[repo.id]?.data ?? null, error: null },
    }))
    try {
      const query = `?source=${encodeURIComponent(repo.source)}&probe=1${refresh ? '&refresh=1' : ''}`
      const body = await requestJson<RepoTreeData>(`${REPO_SKILLS_ROUTE}${query}`)
      setProbes((prev) => ({ ...prev, [repo.id]: { status: 'ready', data: body, error: null } }))
    } catch (failure) {
      if (errorCode(failure) === 'repo-unavailable') {
        setProbes((prev) => ({
          ...prev,
          [repo.id]: { status: 'ready', data: { kind: 'unavailable' }, error: null },
        }))
        return
      }
      setProbes((prev) => ({
        ...prev,
        [repo.id]: { status: 'error', data: prev[repo.id]?.data ?? null, error: failure },
      }))
    }
  }

  /**
   * 展开 / 收起一个收藏仓库；首次展开时拉树，之后走状态里的数据。
   *
   * @param repo 一条收藏
   */
  function toggleRepo(repo: RepoRef): void {
    const willExpand = expandedRepos[repo.id] !== true
    setExpandedRepos((prev) => {
      const next = { ...prev }
      if (willExpand) next[repo.id] = true
      else delete next[repo.id]
      return next
    })
    if (willExpand && trees[repo.id] === undefined) loadTree(repo)
  }

  /**
   * 收起 / 展开树里的一个目录。
   *
   * @param repo 一条收藏
   * @param dirPath 目录节点的相对路径
   */
  function toggleDir(repo: RepoRef, dirPath: string): void {
    setCollapsedDirs((prev) => {
      const repoDirs = { ...(prev[repo.id] ?? {}) }
      if (repoDirs[dirPath] === true) delete repoDirs[dirPath]
      else repoDirs[dirPath] = true
      return { ...prev, [repo.id]: repoDirs }
    })
  }

  /**
   * 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
   */
  function flash(kind: 'success' | 'error', text: string): void {
    setNotice({ kind, text, seq: Date.now() + Math.random() })
  }

  /**
   * 请求 Host 卸载一条 skill；Host 会按 npx 管理与否选择方式。
   *
   * @param entry 一条 skill
   */
  async function uninstall(entry: InstalledSkill): Promise<void> {
    setBusy(entryKey(entry))
    try {
      const body = await requestJson<{ method?: string }>(UNINSTALL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ scope: entry.scope, id: entry.id }),
      })
      flash(
        'success',
        `${body.method === 'npx' ? t('removedWithNpx') : t('removedLocally')} ${entry.name}`,
      )
      setConfirming(null)
      reload()
    } catch (failure) {
      flash('error', `${t('failed')} ${messageOf(failure)}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 只重读「已安装」列表：安装成功后调用，让新 skill 立刻出现在第一页，
   * 收藏页的「已安装」标记也随之更新。不刷新仓库树与探测，省掉一轮网络请求。
   */
  async function refreshInstalled(): Promise<void> {
    try {
      const body = await requestJson<InstalledSnapshot>(LIST_ROUTE)
      setInstalled({ data: body, error: null, loading: false })
    } catch (failure) {
      setInstalled((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
    }
  }

  /**
   * 安装树里的一个 skill：Host 校验来源是收藏、skill 在仓库列表里，然后交给
   * `npx skills add` 装到全局 `~/.agents/skills`。成功后只刷新已安装列表，
   * 树保持展开，用户能接着装下一个。
   *
   * @param repo 一条收藏
   * @param node Host 返回的 skill 节点
   */
  async function installSkill(repo: RepoRef, node: SkillTreeLeaf): Promise<void> {
    if (installing !== null) return
    setInstalling(installKeyOf(repo, node))
    try {
      const body = await requestJson<{ name?: string }>(INSTALL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ source: repo.source, path: node.path }),
      })
      flash('success', `${t('installedToast')} ${body.name ?? node.name}`)
      await refreshInstalled()
    } catch (failure) {
      const text =
        errorCode(failure) === 'skill-not-found'
          ? t('installMissing')
          : `${t('installFailed')} ${messageOf(failure)}`
      flash('error', text)
    } finally {
      setInstalling(null)
    }
  }

  /**
   * 读一次目标列表；成功后默认选中第一项，让「安装」按钮直接可用。
   *
   * @param kind 目标类型
   */
  async function loadTargets(kind: TargetDialogKind): Promise<void> {
    const request = ++targetRequestRef.current
    setTargets((prev) => ({ data: prev.data, error: null, loading: true }))
    try {
      const body = await requestJson<InstallTargetsSnapshot>(TARGETS_ROUTE)
      if (request !== targetRequestRef.current) return
      setTargets({ data: body, error: null, loading: false })
      const first = targetItemsOf(kind, body)[0]
      setTargetChoice((prev) => (prev === '' ? targetKeyOf(kind, first) : prev))
    } catch (failure) {
      if (request !== targetRequestRef.current) return
      setTargets((prev) => ({ data: prev.data, error: messageOf(failure), loading: false }))
    }
  }

  /**
   * 打开「安装到打工人 / 工作区」对话框。
   *
   * @param kind 目标类型
   * @param repo 一条收藏
   * @param node Host 返回的 skill 节点
   */
  function openTargetDialog(kind: TargetDialogKind, repo: RepoRef, node: SkillTreeLeaf): void {
    if (installing !== null || targetInstalling) return
    targetRequestRef.current += 1
    setTargetDialog({ kind, repo, node })
    setTargetChoice('')
    setTargetError(null)
    setTargets({ data: null, error: null, loading: false })
    void loadTargets(kind)
  }

  /** 清空对话框状态；安装成功时也用它，因为此时 `targetInstalling` 还是 true。 */
  function resetTargetDialog(): void {
    targetRequestRef.current += 1
    setTargetDialog(null)
    setTargetChoice('')
    setTargetError(null)
    setTargets({ data: null, error: null, loading: false })
  }

  /** 关闭对话框；安装中不响应，避免请求回来时状态错位。 */
  function closeTargetDialog(): void {
    if (targetInstalling) return
    resetTargetDialog()
  }

  /** 重新读取当前对话框的目标列表。 */
  function reloadTargets(): void {
    if (targetDialog === null || targetInstalling) return
    void loadTargets(targetDialog.kind)
  }

  /**
   * 把当前 skill 安装到选中的打工人 / 工作区。Host 会把选择换回登记表里的
   * 可信目录；成功后关掉对话框并提示，失败留在框里显示（与「收藏」对话框一致）。
   */
  async function installToTarget(): Promise<void> {
    if (targetDialog === null || targetInstalling) return
    const kind = targetDialog.kind
    const choice = targetChoice
    if (choice === '') return
    const chosen = targetItemsOf(kind, targets.data).find(
      (item) => targetKeyOf(kind, item) === choice,
    )
    const label = targetLabelOf(kind, chosen) || choice
    setTargetInstalling(true)
    setTargetError(null)
    try {
      const body = await requestJson<{ name?: string }>(INSTALL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({
          source: targetDialog.repo.source,
          path: targetDialog.node.path,
          target: kind,
          ...(kind === 'worker' ? { worker: choice } : { workspace: choice }),
        }),
      })
      resetTargetDialog()
      flash(
        'success',
        `${t(kind === 'worker' ? 'installedToWorker' : 'installedToWorkspace')} ${
          body.name ?? targetDialog.node.name
        } → ${label}`,
      )
    } catch (failure) {
      const text =
        errorCode(failure) === 'skill-not-found'
          ? t('installMissing')
          : `${t('installFailed')} ${messageOf(failure)}`
      setTargetError(text)
    } finally {
      setTargetInstalling(false)
    }
  }

  /**
   * 打开「收藏」对话框：清掉上一次的失败提示与残留输入。
   * 收藏文件坏掉时不能写，按钮本身已禁用，这里再兜一次。
   */
  function openSaveDialog(): void {
    if (adding || storeCorrupt) return
    setAddError(null)
    setSource('')
    setNote('')
    setDialogOpen(true)
  }

  /** 关闭「收藏」对话框；提交中不允许关闭，避免请求回来时状态错位。 */
  function closeSaveDialog(): void {
    if (adding) return
    setDialogOpen(false)
    setAddError(null)
    setSource('')
    setNote('')
  }

  /**
   * 收藏一个仓库；Host 负责校验、去重与写文件。对话框内的失败留在对话框里
   * 显示，用户可以直接改了再提交，不用关掉重开。
   *
   * @param event 表单提交事件
   */
  async function addRepo(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (adding) return
    const value = source.trim()
    // 空输入时「收藏」按钮是禁用的；回车提交也直接忽略，不弹格式错误。
    if (value === '') return
    setAdding(true)
    setAddError(null)
    try {
      const body = await requestJson<SavedSnapshot>(REPOS_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ source: value, note }),
      })
      setSaved({ data: body, error: null, loading: false })
      setDialogOpen(false)
      setSource('')
      setNote('')
      flash('success', `${t('added')} ${body.repo?.source ?? value}`)
    } catch (failure) {
      const code = errorCode(failure)
      const text =
        code === 'duplicate'
          ? `${t('duplicate')} ${value}`
          : code === 'invalid-source'
            ? t('invalidSource')
            : code === 'invalid-note'
              ? t('invalidNote')
              : code === 'store-unreadable'
                ? t('storeUnreadable')
                : `${t('addFailed')} ${messageOf(failure)}`
      setAddError(text)
    } finally {
      setAdding(false)
    }
  }

  /**
   * 删除一条收藏；只动收藏文件，不碰已安装的 skill。
   *
   * @param repo 一条收藏
   */
  async function removeRepo(repo: RepoRef): Promise<void> {
    setRemoving(repo.id)
    try {
      const body = await requestJson<SavedSnapshot>(REPO_REMOVE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: repo.id }),
      })
      setSaved((prev) => ({
        ...prev,
        data: { ...(prev.data ?? {}), ...body },
        error: null,
        loading: false,
      }))
      flash('success', `${t('removed')} ${repo.source}`)
    } catch (failure) {
      flash('error', `${t('removeFailed')} ${messageOf(failure)}`)
    } finally {
      setRemoving(null)
    }
  }

  /** 切 Tab 时清掉上一条提示，避免串台。 */
  function switchTab(next: PageTab): void {
    if (next === tab) return
    setNotice(null)
    setTab(next)
  }

  return {
    t,
    tab,
    installed,
    installedData,
    saved,
    savedData,
    skills,
    repos,
    storeCorrupt,
    loading,
    notice,
    setNotice,
    busy,
    confirming,
    setConfirming,
    source,
    setSource,
    note,
    setNote,
    adding,
    dialogOpen,
    addError,
    removing,
    expandedRepos,
    trees,
    collapsedDirs,
    probes,
    installedRepos,
    installedSkillKeys,
    installing,
    targetDialog,
    targets,
    targetChoice,
    targetInstalling,
    targetError,
    reload,
    loadTree,
    probeRepo,
    toggleRepo,
    toggleDir,
    uninstall,
    refreshInstalled,
    installSkill,
    openTargetDialog,
    closeTargetDialog,
    setTargetChoice,
    reloadTargets,
    installToTarget,
    openSaveDialog,
    closeSaveDialog,
    addRepo,
    removeRepo,
    switchTab,
  }
}

export { useSkillsPageState }
