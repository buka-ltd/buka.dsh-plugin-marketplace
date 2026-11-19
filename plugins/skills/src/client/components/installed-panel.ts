/**
 * 「已安装」面板：两个全局根下的 skill 卡片、检查 / 更新入口、lockfile 提示
 * 与卸载按钮。
 *
 * 检查结果按 `update` / `modified` / `up-to-date` / `unsupported-source` /
 * `failed` 在每行标题旁标出；检查 / 更新进行中统一禁用按钮。数据与动作由
 * 页面状态（`useSkillsPageState`）提供。
 *
 * @module @buka/dsh-plugin-skills/client/components/installed-panel
 */

import type { ReactElement } from 'react'

import type { Translate } from '../dictionary.ts'
import { entryKey } from '../keys.ts'
import {
  Button,
  h,
  IconRefreshOutlineRegular,
  IconSkillOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Tag,
} from '../primitives.ts'
import { repoLabel } from '../repo-source.ts'
import type { InstalledSkill, SkillCheckEntry, SkillsPageState } from '../types.ts'
import { RepoAvatar } from './repo-avatar.ts'

/** 一行右侧操作区的入参。 */
interface RowActionsState {
  readonly busy: string | null
  readonly confirming: string | null
  readonly t: Translate
  readonly onAsk: () => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/**
 * 标题行第二个标签：安装来源。
 *
 * - npx skills 管理：显示来源仓库（如 `vercel-labs/skills`），lockfile
 *   没写来源时退回 `npx skills`；
 * - 其它：`manual`。
 *
 * @param entry 一条 skill
 * @param t 翻译函数
 */
function sourceTagOf(
  entry: InstalledSkill,
  t: Translate,
): { text: string; tone: 'info' | 'outline' } {
  if (entry.managedByNpx !== true) return { text: t('badgeManual'), tone: 'outline' }
  const source = repoLabel(entry.npxSourceUrl) || repoLabel(entry.npxSource)
  return { text: source === '' ? t('badgeNpx') : source, tone: 'info' }
}

/**
 * 检查结果 → 行内状态标签；没有结果（还没检查、手工安装）时不显示。
 */
function statusTagOf(
  result: SkillCheckEntry | undefined,
  t: Translate,
): { text: string; tone: 'info' | 'warning' | 'success' } | null {
  switch (result?.status) {
    case 'update':
      return { text: t('statusUpdate'), tone: 'info' }
    case 'modified':
      return { text: t('statusModified'), tone: 'warning' }
    case 'up-to-date':
      return { text: t('statusUpToDate'), tone: 'success' }
    case 'unsupported-source':
      return { text: t('statusUnsupported'), tone: 'warning' }
    case 'failed':
      return { text: t('statusFailed'), tone: 'warning' }
    default:
      return null
  }
}

/**
 * 一行右侧的操作区：卸载 / 二次确认 / 进行中。
 * 按钮样式与 Plugins 页面的卸载按钮一致（outline + 危险色）。
 *
 * @param entry 一条 skill
 */
function rowActions(entry: InstalledSkill, state: RowActionsState): ReactElement | ReactElement[] {
  const { busy, confirming, t } = state
  const anyBusy = busy !== null
  if (busy === entryKey(entry)) {
    return h(
      'span',
      { className: 'buka-skills-statusWithDot' },
      h(StateDot, { state: 'ongoing' }),
      t('uninstalling'),
    )
  }
  if (confirming === entryKey(entry)) {
    return [
      h(
        Button,
        {
          key: 'confirm',
          variant: 'outline',
          size: 'sm',
          className: 'buka-skills-danger',
          icon: h(IconWarningOutlineRegular, { size: 13 }),
          onClick: state.onConfirm,
          disabled: anyBusy,
        },
        t('confirmRemove'),
      ),
      h(
        Button,
        {
          key: 'cancel',
          variant: 'ghost',
          size: 'sm',
          onClick: state.onCancel,
          disabled: anyBusy,
        },
        t('cancel'),
      ),
    ]
  }
  return h(
    Button,
    {
      variant: 'outline',
      size: 'sm',
      className: 'buka-skills-danger',
      icon: h(IconTrashOutlineRegular, { size: 13 }),
      'aria-label': `${t('uninstall')} ${entry.name}`,
      onClick: state.onAsk,
      disabled: anyBusy,
    },
    t('uninstall'),
  )
}

/**
 * 「已安装」页：卡片列表、lockfile 提示与卸载按钮。
 *
 * @param state 页面状态与动作
 */
function renderInstalled(state: SkillsPageState): ReactElement {
  const {
    t,
    skills,
    busy,
    checking,
    updating,
    checkResults,
    checkMessage,
    hasUpdates,
    checkUpdates,
    updateSkills,
    confirming,
    setConfirming,
    uninstall,
    installed,
    installedData,
  } = state
  const anyCheckBusy = checking || updating
  const rows = skills.map((entry) => {
    const source = sourceTagOf(entry, t)
    const status = statusTagOf(checkResults[entryKey(entry)], t)
    return h(
      'li',
      { className: 'buka-skills-card', key: `${entry.scope}:${entry.id}` },
      h(
        'div',
        { className: 'buka-skills-cardHead' },
        // 图标列：来源仓库的头像（手工安装的回退到 skill 图标），在 40px 列内
        // 水平、垂直居中；主区与它等高，标题与描述从主区左边缘开始。
        h(
          'span',
          { className: 'buka-skills-cardLead', 'aria-hidden': true },
          h(RepoAvatar, {
            source: entry.npxSourceUrl ?? entry.npxSource,
            size: 24,
            fallback: h(IconSkillOutlineRegular, { size: 16 }),
          }),
        ),
        h(
          'div',
          { className: 'buka-skills-cardMain' },
          h(
            'div',
            { className: 'buka-skills-titleRow' },
            h(
              'div',
              { className: 'buka-skills-titleCluster' },
              h('span', { className: 'buka-skills-cardTitle', title: entry.name }, entry.name),
              // 检查结果是这一行最需要被看见的信息，紧跟在名字后面；
              // 来源仓库名可能很长，放到最后，换行时不会顶掉状态。
              status === null ? null : h(Tag, { tone: status.tone }, status.text),
              h(Tag, { tone: 'neutral' }, entry.scope),
              h(Tag, { tone: source.tone }, source.text),
            ),
            h(
              'div',
              { className: 'buka-skills-titleActions' },
              rowActions(entry, {
                busy,
                confirming,
                t,
                onAsk: () => setConfirming(entryKey(entry)),
                onCancel: () => setConfirming(null),
                onConfirm: () => uninstall(entry),
              }),
            ),
          ),
          typeof entry.description === 'string' && entry.description !== ''
            ? h(
                'div',
                { className: 'buka-skills-cardDesc', title: entry.description },
                entry.description,
              )
            : null,
          confirming === entryKey(entry)
            ? h(
                'p',
                { className: 'buka-skills-hint' },
                entry.managedByNpx === true ? t('confirmNpx') : t('confirmLocal'),
              )
            : null,
        ),
      ),
    )
  })

  const rootsTip =
    installedData !== null && Array.isArray(installedData.roots) && installedData.roots.length > 0
      ? h(
          'p',
          { className: 'buka-skills-meta' },
          installedData.roots.map((root) => root.path).join(' · '),
        )
      : null

  const emptyState = h(
    'div',
    { className: 'buka-skills-emptyState' },
    h(
      'span',
      { className: 'buka-skills-emptyIcon', 'aria-hidden': true },
      h(IconSkillOutlineRegular, { size: 28 }),
    ),
    h('p', { className: 'buka-skills-emptyTitle' }, t('empty')),
    h('p', { className: 'buka-skills-emptyHint' }, t('emptyHint')),
    rootsTip,
  )

  return h(
    'div',
    { className: 'buka-skills-panel' },
    h(
      'div',
      { className: 'buka-skills-panelActions' },
      checkMessage === null
        ? null
        : h('p', { className: 'buka-skills-meta', role: 'status' }, checkMessage),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          icon: checking
            ? h(StateDot, { state: 'ongoing', size: 13 })
            : h(IconRefreshOutlineRegular, { size: 13 }),
          disabled: anyCheckBusy,
          onClick: () => void checkUpdates(),
        },
        checking ? t('checkingUpdates') : t('checkUpdates'),
      ),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          icon: updating ? h(StateDot, { state: 'ongoing', size: 13 }) : undefined,
          disabled: anyCheckBusy || !hasUpdates,
          onClick: () => void updateSkills(),
        },
        updating ? t('updatingSkills') : t('updateSkills'),
      ),
    ),
    installed.error === null
      ? null
      : h(
          'p',
          { className: 'buka-skills-failure', role: 'alert' },
          h(StateDot, { state: 'error' }),
          `${t('loadFailed')} ${installed.error}`,
        ),
    installed.loading && installedData === null
      ? h(
          'p',
          { className: 'buka-skills-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('loading'),
        )
      : null,
    installedData !== null && installedData.lock?.corrupt === true
      ? h(
          'p',
          { className: 'buka-skills-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h(
            'span',
            null,
            t('corruptLock'),
            ' ',
            h('span', { className: 'buka-skills-path' }, String(installedData.lock?.path ?? '')),
          ),
        )
      : null,
    installedData !== null && installedData.lock?.exists === false
      ? h(
          'p',
          { className: 'buka-skills-status' },
          `${t('noLock')} `,
          h('span', { className: 'buka-skills-path' }, String(installedData.lock?.path ?? '')),
        )
      : null,
    installedData !== null &&
      Array.isArray(installedData.warnings) &&
      installedData.warnings.length > 0
      ? h(
          'p',
          { className: 'buka-skills-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h(
            'span',
            null,
            `${t('warningsLabel')} `,
            h('span', { className: 'buka-skills-path' }, installedData.warnings.join(' · ')),
          ),
        )
      : null,
    // 只有拿到过列表才决定「空」还是「列表」：读取失败时由上面的错误行
    // 说明原因，不能同时显示「还没有安装任何 skill」。
    installedData === null
      ? null
      : rows.length === 0 && !installed.loading
        ? emptyState
        : h('ul', { className: 'buka-skills-cards' }, ...rows),
  )
}

export { renderInstalled }
