/**
 * 「收藏」面板：收藏卡片、仓库类型徽标、已安装标记与展开后的树。
 *
 * 新增收藏不再是页面里的常驻输入行：标题行右侧「刷新」旁边的「收藏」按钮打开
 * 对话框（`save-dialog.ts`），这里只负责列表渲染与删除入口。展开后的树由
 * `components/tree.ts` 的渲染函数提供。
 *
 * @module @buka/dsh-plugin-skills/client/components/saved-panel
 */

import type { ReactElement } from 'react'

import type { Translate } from '../dictionary.ts'
import {
  Button,
  h,
  IconChevronRightOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Tag,
} from '../primitives.ts'
import { isListableSource, repoUrl } from '../repo-source.ts'
import type { SkillsPageState } from '../types.ts'
import { createTreeRenderer } from './tree.ts'

/**
 * 收藏卡片标题行的仓库类型徽标：npx skills / Claude Code 市场 / 不可用。
 *
 * kind 由 Host 给出：展开后拿到的完整结果与轻量探测都带它。两处都没有
 * （还没探测完、探测失败）时不显示徽标，也不渲染占位的「…」。
 *
 * @param kind Host 返回的仓库类型
 * @param t 翻译函数
 */
function kindTagOf(
  kind: unknown,
  t: Translate,
): { text: string; tone: 'neutral' | 'info' | 'warning' } | null {
  switch (kind) {
    case 'npx-skills':
      return { text: t('kindNpx'), tone: 'neutral' }
    case 'claude-code-marketplace':
      return { text: t('kindMarketplace'), tone: 'info' }
    case 'unavailable':
      return { text: t('kindUnavailable'), tone: 'warning' }
    default:
      return null
  }
}

/**
 * 「收藏」页：卡片列表与「已安装」标记；新增走标题行右侧的「收藏」按钮。
 *
 * @param state 页面状态与动作
 */
function renderSaved(state: SkillsPageState): ReactElement {
  const {
    t,
    repos,
    installedRepos,
    expandedRepos,
    trees,
    probes,
    removing,
    toggleRepo,
    removeRepo,
    saved,
    savedData,
    storeCorrupt,
  } = state
  const { renderTree } = createTreeRenderer(state)
  const rows = repos.map((repo) => {
    const link = repoUrl(repo.source)
    const listable = isListableSource(repo.source)
    const installedAlready = installedRepos.has(repo.id)
    const expanded = expandedRepos[repo.id] === true
    // 徽标优先用展开后拿到的完整结果（也带 kind），其次用轻量探测结果；
    // 两处都没有（还在探测、探测失败）时不渲染徽标，也不显示占位。
    const kind = trees[repo.id]?.data?.kind ?? probes[repo.id]?.data?.kind
    const kindTag = kindTagOf(kind, t)
    return h(
      'li',
      { className: 'buka-skills-card', key: repo.id },
      h(
        'div',
        { className: 'buka-skills-cardHead' },
        h(
          'div',
          { className: 'buka-skills-titleRow' },
          h(
            'div',
            { className: 'buka-skills-titleCluster' },
            // 只有可列出的来源（GitHub / git 远端 / 本地路径）显示折叠
            // 箭头；包名与网页链接只当书签，没有可展开的树。
            listable
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-skills-chevron',
                    'aria-expanded': expanded,
                    'aria-label': `${expanded ? t('collapseRepo') : t('expandRepo')} ${repo.source}`,
                    onClick: () => toggleRepo(repo),
                  },
                  h(IconChevronRightOutlineRegular, { size: 14 }),
                )
              : null,
            // 标题本身就是仓库链接：点标题直接打开仓库页。
            link === ''
              ? h('span', { className: 'buka-skills-cardTitle' }, repo.source)
              : h(
                  'a',
                  {
                    className: 'buka-skills-cardTitle buka-skills-cardLink',
                    href: link,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                  },
                  repo.source,
                ),
            // 仓库类型徽标：标题之后、已安装标记之前。
            kindTag === null ? null : h(Tag, { tone: kindTag.tone }, kindTag.text),
            installedAlready ? h(Tag, { tone: 'success' }, t('installedBadge')) : null,
          ),
          h(
            'div',
            { className: 'buka-skills-titleActions' },
            // 样式与已安装列表的卸载按钮一致（outline + 危险色 + 文案）；
            // 删除中整块换成状态点，与卸载一致，也避免请求期间重复点击。
            removing === repo.id
              ? h(
                  'span',
                  { className: 'buka-skills-statusWithDot' },
                  h(StateDot, { state: 'ongoing' }),
                  t('removing'),
                )
              : h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    className: 'buka-skills-danger',
                    icon: h(IconTrashOutlineRegular, { size: 13 }),
                    'aria-label': `${t('removeRepo')} ${repo.source}`,
                    onClick: () => removeRepo(repo),
                    disabled: removing !== null,
                  },
                  t('removeRepo'),
                ),
          ),
        ),
        typeof repo.note === 'string' && repo.note !== ''
          ? h('div', { className: 'buka-skills-cardDesc' }, repo.note)
          : null,
        expanded && listable ? renderTree(repo) : null,
      ),
    )
  })

  return h(
    'div',
    { className: 'buka-skills-panel' },
    saved.error === null
      ? null
      : h(
          'p',
          { className: 'buka-skills-failure', role: 'alert' },
          h(StateDot, { state: 'error' }),
          `${t('loadFailed')} ${saved.error}`,
        ),
    saved.loading && savedData === null
      ? h(
          'p',
          { className: 'buka-skills-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('loading'),
        )
      : null,
    storeCorrupt
      ? h(
          'p',
          { className: 'buka-skills-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h(
            'span',
            null,
            t('storeUnreadable'),
            ' ',
            h('span', { className: 'buka-skills-path' }, String(savedData?.file ?? '')),
          ),
        )
      : null,
    savedData === null
      ? null
      : rows.length === 0 && !saved.loading
        ? h('p', { className: 'buka-skills-empty' }, t('repoEmpty'))
        : h('ul', { className: 'buka-skills-cards' }, ...rows),
  )
}

export { renderSaved }
