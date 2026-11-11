/**
 * 浏览器一半的数据类型：Host 路由返回的形状与页面自己的状态。
 *
 * 只放类型，不放实现；页面、状态 Hook、各个面板共用这些契约。
 *
 * @module @buka/dsh-plugin-skills/client/types
 */

import type { Dispatch, SetStateAction } from 'react'

import type { PageTab } from './constants.ts'
import type { Translate } from './dictionary.ts'

/** Host `GET /buka-skills/list` 返回的一条已安装 skill。 */
export interface InstalledSkill {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly scope: string
  readonly managedByNpx?: boolean
  readonly npxSource?: string | null
  readonly npxSourceUrl?: string | null
}

/** 已安装列表快照。 */
export interface InstalledSnapshot {
  readonly skills?: InstalledSkill[]
  readonly roots?: Array<{ scope?: string; path?: string }>
  readonly lock?: { exists?: boolean; path?: string; corrupt?: boolean }
  readonly warnings?: string[]
}

/** 收藏文件里的一条记录。 */
export interface SavedRepo {
  readonly id: string
  readonly source: string
  readonly note?: string
  readonly addedAt?: string
}

/** 收藏列表快照。 */
export interface SavedSnapshot {
  readonly file?: string
  readonly exists?: boolean
  readonly corrupt?: boolean
  readonly repos?: SavedRepo[]
  /** 收藏成功时 Host 返回刚写入的那一条。 */
  readonly repo?: SavedRepo
}

/** 树里的 skill 叶子。 */
export interface SkillTreeLeaf {
  readonly type: 'skill'
  readonly name: string
  readonly path: string
  readonly description?: string
}

/** 树里的目录节点。 */
export interface SkillTreeDir {
  readonly type: 'dir'
  readonly name: string
  readonly path: string
  readonly children: SkillTreeChild[]
}

/** 一个树节点。 */
export type SkillTreeChild = SkillTreeLeaf | SkillTreeDir

/** Host `GET /buka-skills/repo-skills` 返回的仓库树。 */
export interface RepoTreeData {
  readonly kind?: string
  readonly root?: SkillTreeChild[]
  readonly [extra: string]: unknown
}

/** 一条数据加载状态。 */
export interface LoadedState<T> {
  readonly data: T | null
  readonly error: string | null
  readonly loading: boolean
}

/** 一棵仓库树的页面状态。 */
export interface TreeState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly data: RepoTreeData | null
  readonly error: unknown
}

/** 一次仓库类型探测的页面状态。 */
export type ProbeState = TreeState

/** Toast 提示。 */
export interface Notice {
  readonly kind: 'success' | 'error'
  readonly text: string
  readonly seq: number
}

/** 收藏页恢复出来的本地缓存。 */
export interface ViewCache {
  readonly expandedRepos: Record<string, true>
  readonly collapsedDirs: Record<string, Record<string, true>>
  readonly trees: Record<string, TreeState>
}

/** 一条收藏（页面里只用到 id 与来源）。 */
export interface RepoRef {
  readonly id: string
  readonly source: string
}

/** 页面状态与动作；面板组件从这里取需要的字段。 */
export interface SkillsPageState {
  /** 翻译函数。 */
  readonly t: Translate
  /** 当前 Tab。 */
  readonly tab: PageTab
  /** 「已安装」列表状态。 */
  readonly installed: LoadedState<InstalledSnapshot>
  /** 「已安装」列表数据。 */
  readonly installedData: InstalledSnapshot | null
  /** 「收藏」列表状态。 */
  readonly saved: LoadedState<SavedSnapshot>
  /** 「收藏」列表数据。 */
  readonly savedData: SavedSnapshot | null
  /** 已安装的 skill（扁平列表）。 */
  readonly skills: InstalledSkill[]
  /** 收藏的仓库。 */
  readonly repos: SavedRepo[]
  /** 收藏文件是否无法解析。 */
  readonly storeCorrupt: boolean
  /** 当前 Tab 是否正在读取。 */
  readonly loading: boolean
  /** Toast 提示；`null` 表示没有。 */
  readonly notice: Notice | null
  /** 关闭 Toast。 */
  readonly setNotice: Dispatch<SetStateAction<Notice | null>>
  /** 正在卸载的 skill 行键。 */
  readonly busy: string | null
  /** 正在二次确认的 skill 行键。 */
  readonly confirming: string | null
  /** 设置二次确认的行。 */
  readonly setConfirming: Dispatch<SetStateAction<string | null>>
  /** 收藏对话框的仓库输入。 */
  readonly source: string
  /** 修改收藏对话框的仓库输入。 */
  readonly setSource: Dispatch<SetStateAction<string>>
  /** 收藏对话框的备注输入。 */
  readonly note: string
  /** 修改收藏对话框的备注输入。 */
  readonly setNote: Dispatch<SetStateAction<string>>
  /** 是否正在提交收藏。 */
  readonly adding: boolean
  /** 收藏对话框是否打开。 */
  readonly dialogOpen: boolean
  /** 收藏对话框里的失败提示。 */
  readonly addError: string | null
  /** 正在删除的收藏 id。 */
  readonly removing: string | null
  /** 展开着的收藏。 */
  readonly expandedRepos: Record<string, true>
  /** 每个收藏拿到（或正在拿）的树。 */
  readonly trees: Record<string, TreeState>
  /** 每个收藏里收起着的目录。 */
  readonly collapsedDirs: Record<string, Record<string, true>>
  /** 每个收藏的类型探测状态。 */
  readonly probes: Record<string, ProbeState>
  /** 已安装 skill 来自哪些仓库（收藏行据此标「已安装」）。 */
  readonly installedRepos: ReadonlySet<string>
  /** 已安装 skill 的目录键集合。 */
  readonly installedSkillKeys: ReadonlySet<string>
  /** 正在安装的树 skill 键。 */
  readonly installing: string | null
  /** 页面「刷新」。 */
  readonly reload: () => void
  /** 取一个仓库的 skills 树。 */
  readonly loadTree: (repo: RepoRef, options?: { refresh?: boolean }) => Promise<void>
  /** 探测一个仓库的类型。 */
  readonly probeRepo: (repo: RepoRef, options?: { refresh?: boolean }) => Promise<void>
  /** 展开 / 收起一个收藏仓库。 */
  readonly toggleRepo: (repo: RepoRef) => void
  /** 收起 / 展开树里的一个目录。 */
  readonly toggleDir: (repo: RepoRef, dirPath: string) => void
  /** 卸载一条 skill。 */
  readonly uninstall: (entry: InstalledSkill) => Promise<void>
  /** 只重读「已安装」列表。 */
  readonly refreshInstalled: () => Promise<void>
  /** 安装树里的一个 skill。 */
  readonly installSkill: (repo: RepoRef, node: SkillTreeLeaf) => Promise<void>
  /** 打开「收藏」对话框。 */
  readonly openSaveDialog: () => void
  /** 关闭「收藏」对话框。 */
  readonly closeSaveDialog: () => void
  /** 收藏一个仓库。 */
  readonly addRepo: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
  /** 删除一条收藏。 */
  readonly removeRepo: (repo: RepoRef) => Promise<void>
  /** 切换 Tab。 */
  readonly switchTab: (next: PageTab) => void
}
