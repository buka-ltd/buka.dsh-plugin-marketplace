/**
 * 收藏卡片展开后的树：加载中 / 失败可重试 / 空 / 递归树。
 *
 * 树的状态来自页面（`trees`、`collapsedDirs`、`installing`、目标安装状态与
 * 已安装键集合），这里只负责渲染与把点击转回页面动作，因此用
 * `createTreeRenderer()` 把这份状态绑成 `renderTree` / `renderTreeNode` 两个
 * 函数，供「收藏」面板复用。
 *
 * 目录与 skill 叶子都带三个安装入口：目录行装的是**目录下全部 skill**（有的
 * 仓库里一个插件 / 合集就是一个目录，逐个点 skill 太慢），skill 行只装自己。
 *
 * @module @buka/dsh-plugin-skills/client/components/tree
 */

import type { ReactElement } from 'react'

import { errorCode, messageOf } from '../api.ts'
import type { Translate } from '../dictionary.ts'
import { countSkills, installKeyOf, skillKeyOf, skillLeavesOf } from '../keys.ts'
import {
  Button,
  h,
  IconCheckOutlineRegular,
  IconChevronRightOutlineRegular,
  IconDownloadOutlineRegular,
  StateDot,
} from '../primitives.ts'
import type {
  RepoRef,
  SkillTreeChild,
  SkillTreeDir,
  SkillTreeLeaf,
  SkillTreeSelection,
  TargetDialogKind,
  TreeState,
} from '../types.ts'

/**
 * tree 加载失败时的展示文本；已知错误码说清楚原因，其余带 Host 诊断。
 * `git-unavailable`（本机没有 git）有专门文案；`git-failed` 走默认分支，
 * 带上 Host 给的具体原因（clone/fetch 的 stderr）。
 *
 * @param t 翻译函数
 * @param failure 带 `code` 的错误
 */
function treeFailureText(t: Translate, failure: unknown): string {
  switch (errorCode(failure)) {
    case 'repo-not-found':
      return t('treeNotFound')
    case 'repo-unavailable':
      return t('treeUnavailable')
    case 'rate-limited':
      return t('treeRateLimited')
    case 'unsupported-source':
      return t('treeUnsupported')
    case 'git-unavailable':
      return t('treeGitUnavailable')
    case 'invalid-source':
      return t('invalidSource')
    default:
      return `${t('treeFailed')} ${messageOf(failure)}`
  }
}

/**
 * 目录下的 skill 是不是全部已全局安装。
 *
 * 部分已安装时目录按钮保持「全部安装」可用：Host 会跳过已装过的，只装剩下的，
 * 所以这里不能只看「有一个已安装」就禁用。
 *
 * @param dir 目录节点
 * @param installedSkillKeys 已安装 skill 的目录键集合
 */
function allSkillsInstalled(dir: SkillTreeDir, installedSkillKeys: ReadonlySet<string>): boolean {
  const leaves = skillLeavesOf(dir)
  return leaves.length > 0 && leaves.every((leaf) => installedSkillKeys.has(skillKeyOf(leaf.name)))
}

/** 渲染树需要的页面状态与动作。 */
export interface TreeRendererState {
  /** 翻译函数。 */
  readonly t: Translate
  /** 每个仓库拿到（或正在拿）的树。 */
  readonly trees: Record<string, TreeState>
  /** 每个仓库里收起着的目录。 */
  readonly collapsedDirs: Record<string, Record<string, true>>
  /** 已安装 skill 的目录键集合。 */
  readonly installedSkillKeys: ReadonlySet<string>
  /** 正在安装的树 skill（`installKeyOf()` 的组合键）。 */
  readonly installing: string | null
  /** 是否正在把 skill 安装到打工人 / 工作区。 */
  readonly targetInstalling: boolean
  /** 取一个仓库的 skills 树。 */
  readonly loadTree: (repo: RepoRef, options?: { refresh?: boolean }) => Promise<void>
  /** 收起 / 展开树里的一个目录。 */
  readonly toggleDir: (repo: RepoRef, dirPath: string) => void
  /** 安装树里的一个 skill 到全局。 */
  readonly installSkill: (repo: RepoRef, node: SkillTreeLeaf) => Promise<void>
  /** 安装一个目录里的全部 skill 到全局。 */
  readonly installDir: (repo: RepoRef, node: SkillTreeDir) => Promise<void>
  /** 打开「安装到打工人 / 工作区」对话框。 */
  readonly openTargetDialog: (
    kind: TargetDialogKind,
    repo: RepoRef,
    node: SkillTreeSelection,
  ) => void
}

/** 绑定好状态的树渲染函数。 */
export interface TreeRenderer {
  /** 一个仓库展开后的内容。 */
  readonly renderTree: (repo: RepoRef) => ReactElement | null
  /** 递归渲染一个树节点。 */
  readonly renderTreeNode: (repo: RepoRef, node: SkillTreeChild) => ReactElement
}

/**
 * 把页面状态绑成树渲染函数。
 *
 * @param props 渲染树需要的页面状态与动作
 */
function createTreeRenderer(props: TreeRendererState): TreeRenderer {
  const {
    t,
    trees,
    collapsedDirs,
    installedSkillKeys,
    installing,
    targetInstalling,
    loadTree,
    toggleDir,
    installSkill,
    installDir,
    openTargetDialog,
  } = props

  /**
   * 一个仓库展开后的内容：加载中 / 失败可重试 / 空 / 递归树。
   *
   * @param repo 一条收藏
   */
  function renderTree(repo: RepoRef): ReactElement | null {
    const state = trees[repo.id]
    if (state === undefined) return null
    // 刷新失败时保留上一次的树，只在上面加一行错误 + 重试，不把已经看到的
    // 内容整体换成错误页。
    const failure =
      state.status === 'error'
        ? h(
            'div',
            { className: 'buka-skills-treeFailure', role: 'alert' },
            h(StateDot, { state: 'error' }),
            h('span', null, treeFailureText(t, state.error)),
            h(
              Button,
              { variant: 'ghost', size: 'sm', onClick: () => loadTree(repo, { refresh: true }) },
              t('retry'),
            ),
          )
        : null
    const loading =
      state.data === null
        ? h(
            'p',
            { className: 'buka-skills-statusWithDot buka-skills-treeStatus', role: 'status' },
            h(StateDot, { state: 'ongoing' }),
            t('treeLoading'),
          )
        : null
    if (state.data === null) return failure ?? loading
    const root = Array.isArray(state.data.root) ? state.data.root : []
    const body =
      root.length === 0
        ? h('p', { className: 'buka-skills-status buka-skills-treeStatus' }, t('treeEmpty'))
        : // 刷新时保留旧的树，只标 aria-busy，避免展开区域闪成空白。
          h(
            'ul',
            {
              className: 'buka-skills-tree',
              'aria-busy': state.status === 'loading' ? true : undefined,
            },
            ...root.map((node) => renderTreeNode(repo, node)),
          )
    return h('div', { className: 'buka-skills-treeArea' }, failure, body)
  }

  /**
   * 一个节点右侧的三个安装入口，目录与 skill 叶子共用。
   *
   * 目录行把「全局安装」换成「全部安装」（装目录下全部 skill），其余两个入口
   * 在两种行上含义相同：选一个打工人 / 工作区作为目标。三个按钮在任一安装
   * 进行中统一禁用；只有全局入口会在已安装时变成禁用的「全局已安装」，
   * 打工人 / 工作区是每次临时选的目标，不做已安装判断。
   *
   * @param repo 一条收藏
   * @param node 目录或 skill 节点
   * @param installed 这个节点是否已全局安装（目录要求全部 skill 都已安装）
   * @param busy 这个节点是否正在安装
   * @param onInstall 点「全局安装 / 全部安装」时执行的动作
   */
  function renderActions(
    repo: RepoRef,
    node: SkillTreeSelection,
    installed: boolean,
    busy: boolean,
    onInstall: () => void,
  ): ReactElement {
    const installLabel = node.type === 'dir' ? t('installAll') : t('installGlobal')
    return h(
      'div',
      { className: 'buka-skills-treeSkillAction' },
      installed
        ? h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              disabled: true,
              icon: h(IconCheckOutlineRegular, { size: 13 }),
              'aria-label': `${t('installedBadgeGlobal')} ${node.name}`,
            },
            t('installedBadgeGlobal'),
          )
        : busy
          ? h(
              'span',
              { className: 'buka-skills-statusWithDot', role: 'status' },
              h(StateDot, { state: 'ongoing' }),
              t('installing'),
            )
          : h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                icon: h(IconDownloadOutlineRegular, { size: 13 }),
                'aria-label': `${installLabel} ${node.name}`,
                disabled: installing !== null || targetInstalling,
                onClick: onInstall,
              },
              installLabel,
            ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-label': `${t('installWorker')} ${node.name}`,
          disabled: installing !== null || targetInstalling,
          onClick: () => openTargetDialog('worker', repo, node),
        },
        t('installWorker'),
      ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-label': `${t('installWorkspace')} ${node.name}`,
          disabled: installing !== null || targetInstalling,
          onClick: () => openTargetDialog('workspace', repo, node),
        },
        t('installWorkspace'),
      ),
    )
  }

  /**
   * 递归渲染树节点：目录可折叠并带「全部安装」，skill 是叶子（名称 + 一行
   * 描述 + 三个安装入口）。
   *
   * @param repo 一条收藏
   * @param node Host 返回的树节点
   */
  function renderTreeNode(repo: RepoRef, node: SkillTreeChild): ReactElement {
    if (node.type === 'dir') {
      const collapsed = collapsedDirs[repo.id]?.[node.path] === true
      const children = Array.isArray(node.children) ? node.children : []
      return h(
        'li',
        { className: 'buka-skills-treeItem', key: node.path },
        h(
          'div',
          { className: 'buka-skills-treeDir' },
          h(
            'button',
            {
              type: 'button',
              className: 'buka-skills-treeToggle',
              'aria-expanded': !collapsed,
              onClick: () => toggleDir(repo, node.path),
            },
            h(IconChevronRightOutlineRegular, { size: 12 }),
            h('span', { className: 'buka-skills-treeName' }, node.name),
            h('span', { className: 'buka-skills-treeCount' }, `· ${countSkills(node)}`),
          ),
          renderActions(
            repo,
            node,
            allSkillsInstalled(node, installedSkillKeys),
            installing === installKeyOf(repo, node),
            () => installDir(repo, node),
          ),
        ),
        collapsed
          ? null
          : h(
              'ul',
              { className: 'buka-skills-treeGroup' },
              ...children.map((child) => renderTreeNode(repo, child)),
            ),
      )
    }
    const description = typeof node.description === 'string' ? node.description : ''
    const installed = installedSkillKeys.has(skillKeyOf(node.name))
    const busy = installing === installKeyOf(repo, node)
    return h(
      'li',
      { className: 'buka-skills-treeItem', key: node.path },
      h(
        'div',
        { className: 'buka-skills-treeSkill', title: description === '' ? node.path : description },
        h(
          'div',
          { className: 'buka-skills-treeSkillMain' },
          h('span', { className: 'buka-skills-treeSkillName' }, node.name),
          description === ''
            ? null
            : h('span', { className: 'buka-skills-treeSkillDesc' }, description),
        ),
        renderActions(repo, node, installed, busy, () => installSkill(repo, node)),
      ),
    )
  }

  return { renderTree, renderTreeNode }
}

export { createTreeRenderer, treeFailureText }
