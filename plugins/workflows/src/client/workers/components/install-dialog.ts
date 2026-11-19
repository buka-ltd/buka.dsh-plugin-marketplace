/**
 * 「安装 skills」对话框：从 Skills 插件的「技能仓库」里选一个收藏来源，再勾选
 * 其中可安装的 skills。页面不再提供手填来源的输入框，第三方来源必须先收藏。
 *
 * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/components/install-dialog
 */

import {
  Button,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import React from 'react'
import type { createSkillActions } from '../actions/skills.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { SkillCandidate, SkillRepository, Translate } from '../types.ts'

type SkillActions = ReturnType<typeof createSkillActions>

/**
 * 一条收藏来源：来源地址 + 备注 + 类型 / 数量。
 *
 * @param repo Host 从 Skills 服务读到的收藏仓库
 * @param selected 是否是当前选中的仓库
 * @param disabled 安装期间不允许切换
 * @param t 词典
 * @param onSelect 选中这个仓库
 */
function renderRepository(
  repo: SkillRepository,
  selected: boolean,
  disabled: boolean,
  t: Translate,
  onSelect: (source: string) => void,
): ReactElement {
  const unavailable = repo.kind === 'unavailable'
  return h(
    'li',
    { key: repo.id },
    h(
      'button',
      {
        type: 'button',
        className: `buka-workers-repo${selected ? ' is-selected' : ''}`,
        'aria-pressed': selected,
        title: repo.note !== '' ? `${repo.source} — ${repo.note}` : repo.source,
        disabled,
        onClick: () => onSelect(repo.source),
      },
      h(
        'span',
        { className: 'buka-workers-repoText' },
        h('span', { className: 'buka-workers-repoSource' }, repo.source),
        repo.note === '' ? null : h('span', { className: 'buka-workers-repoNote' }, repo.note),
      ),
      unavailable ? h(Tag, { tone: 'neutral' }, t('repoUnavailable')) : null,
      repo.skills === null
        ? null
        : h(
            'span',
            { className: 'buka-workers-repoCount' },
            String(t('skillsBadge')).replace('{n}', String(repo.skills)),
          ),
    ),
  )
}

/**
 * 未安装 skill 的候选标签：名称 + 描述。
 *
 * @param skill 候选 skill
 * @param installed 已安装的 skill 名集合
 * @param selected 勾选的 skill 名
 * @param installing 是否正在安装
 * @param t 词典
 * @param onToggle 勾选 / 取消
 */
function renderCandidate(
  skill: SkillCandidate,
  installed: Set<string>,
  selected: string[],
  installing: boolean,
  t: Translate,
  onToggle: (name: string) => void,
): ReactElement {
  const isInstalled = installed.has(skill.name)
  const checked = !isInstalled && selected.includes(skill.name)
  return h(
    'li',
    { key: skill.name },
    h(
      'label',
      {
        className: `buka-workers-candidate${isInstalled ? ' isDisabled' : ''}`,
        title:
          typeof skill.description === 'string' && skill.description !== ''
            ? skill.description
            : String(skill.name),
      },
      h('input', {
        type: 'checkbox',
        className: 'buka-workers-candidateInput',
        checked,
        disabled: isInstalled || installing,
        onChange: () => onToggle(skill.name),
      }),
      h(
        'span',
        { className: 'buka-workers-candidateText' },
        h('span', { className: 'buka-workers-candidateName' }, String(skill.name)),
        typeof skill.description === 'string' && skill.description !== ''
          ? h('span', { className: 'buka-workers-candidateDesc' }, skill.description)
          : null,
      ),
      isInstalled
        ? h(
            'span',
            { className: 'buka-workers-candidateTag' },
            h(Tag, { tone: 'neutral' }, t('alreadyInstalled')),
          )
        : null,
    ),
  )
}

/**
 * 对话框内容：技能仓库选择 + 候选勾选列表。
 * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
 *
 */
export function InstallDialog({
  t,
  state,
  skillActions,
}: {
  t: Translate
  state: WorkersPageState
  skillActions: SkillActions
}): ReactElement {
  const {
    installCandidates,
    installSelected,
    installRepos,
    installSource,
    installing,
    installError,
  } = state
  const { selectInstallRepo, toggleCandidate, selectAllCandidates } = skillActions
  const candidates = installCandidates
  const installed = new Set(candidates.installed)
  const selectable = candidates.skills.filter((skill) => !installed.has(skill.name))
  const allSelected =
    selectable.length > 0 && selectable.every((skill) => installSelected.includes(skill.name))
  const repos = installRepos.repos
  const repoButtonsDisabled = installing

  const reposBlock = h(
    'div',
    { className: 'buka-workers-field' },
    h('span', { className: 'buka-workers-fieldLabel' }, t('installReposLabel')),
    installRepos.status === 'idle' || installRepos.status === 'loading'
      ? h(
          'p',
          { className: 'buka-workers-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('installReposLoading'),
        )
      : installRepos.status === 'unavailable'
        ? h('p', { className: 'buka-workers-fieldHint' }, t('installReposUnavailable'))
        : installRepos.status === 'error'
          ? h(
              'div',
              { className: 'buka-workers-alert', role: 'alert' },
              h(
                'div',
                { className: 'buka-workers-alertHead' },
                h(IconWarningOutlineRegular, { size: 16 }),
                h('span', null, `${t('installReposFailed')} ${installRepos.error}`),
              ),
            )
          : installRepos.status === 'ready' && installRepos.corrupt
            ? h(
                'div',
                { className: 'buka-workers-alert', role: 'alert' },
                h(
                  'div',
                  { className: 'buka-workers-alertHead' },
                  h(IconWarningOutlineRegular, { size: 16 }),
                  h('span', null, t('installReposCorrupt')),
                ),
              )
            : installRepos.status === 'ready' && repos.length === 0
              ? h('p', { className: 'buka-workers-fieldHint' }, t('installReposEmpty'))
              : installRepos.status === 'ready'
                ? h(
                    'ul',
                    { className: 'buka-workers-repos', 'aria-label': t('installReposLabel') },
                    ...repos.map((repo) =>
                      renderRepository(
                        repo,
                        installSource === repo.source,
                        repoButtonsDisabled,
                        t,
                        selectInstallRepo,
                      ),
                    ),
                  )
                : null,
  )

  return h(
    'div',
    { className: 'buka-workers-dialogForm' },
    reposBlock,
    candidates.status === 'idle'
      ? h('p', { className: 'buka-workers-fieldHint' }, t('installPickRepo'))
      : null,
    candidates.status === 'loading'
      ? h(
          'p',
          { className: 'buka-workers-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('loadingSkills'),
        )
      : null,
    candidates.status === 'error'
      ? h(
          'div',
          { className: 'buka-workers-alert', role: 'alert' },
          h(
            'div',
            { className: 'buka-workers-alertHead' },
            h(IconWarningOutlineRegular, { size: 16 }),
            h('span', null, `${t('errAvailableFailed')} ${candidates.error}`),
          ),
          candidates.output === ''
            ? null
            : h(
                React.Fragment,
                null,
                h('span', { className: 'buka-workers-outputLabel' }, t('outputLabel')),
                h('pre', { className: 'buka-workers-output' }, candidates.output),
              ),
        )
      : null,
    candidates.status === 'ready'
      ? h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'buka-workers-candidatesHead' },
            h(
              'span',
              { className: 'buka-workers-fieldHint' },
              `${String(t('skillsFound')).replace('{n}', String(candidates.skills.length))} · ${String(
                t('selectedSkills'),
              )
                .replace('{n}', String(installSelected.length))
                .replace('{m}', String(selectable.length))}`,
            ),
            selectable.length === 0
              ? null
              : h(
                  'label',
                  { className: 'buka-workers-selectAll' },
                  h('input', {
                    type: 'checkbox',
                    className: 'buka-workers-candidateInput',
                    checked: allSelected,
                    disabled: installing,
                    onChange: (event: { target: { checked: boolean } }) =>
                      selectAllCandidates(event.target.checked),
                  }),
                  h('span', null, t('selectAllSkills')),
                ),
          ),
          h(
            'ul',
            { className: 'buka-workers-candidates' },
            ...candidates.skills.map((skill) =>
              renderCandidate(skill, installed, installSelected, installing, t, toggleCandidate),
            ),
          ),
          installed.size === 0
            ? null
            : h('p', { className: 'buka-workers-fieldHint' }, t('installedHint')),
        )
      : null,
    installError === null
      ? null
      : h(
          'div',
          { className: 'buka-workers-alert', role: 'alert' },
          h(
            'div',
            { className: 'buka-workers-alertHead' },
            h(IconWarningOutlineRegular, { size: 16 }),
            h('span', null, `${t('skillErrorTitle')} ${installError.message}`),
          ),
          typeof installError.output === 'string' && installError.output !== ''
            ? h(
                React.Fragment,
                null,
                h('span', { className: 'buka-workers-outputLabel' }, t('outputLabel')),
                h('pre', { className: 'buka-workers-output' }, installError.output),
              )
            : null,
        ),
  )
}

/**
 * 「安装 skills」对话框的 Modal 外壳。
 *
 */
export function InstallSkillsModal({
  t,
  state,
  skillActions,
}: {
  t: Translate
  state: WorkersPageState
  skillActions: SkillActions
}): ReactElement {
  const { installOpen, selectedWorker, installSelected, installCandidates, installing } = state
  const { closeInstallDialog, installSelectedSkills } = skillActions
  return (
    // 「安装 skills」对话框：选「技能仓库」里收藏的来源 → 读出候选 → 勾选 → 只安装选中的。
    // 默认全选未安装的；已安装的置灰不可选；安装中不响应关闭。
    h(
      Modal,
      {
        open: installOpen,
        onClose: closeInstallDialog,
        title: t('installDialogTitle'),
        closeLabel: t('close'),
        footer: h(
          React.Fragment,
          null,
          h(
            Button,
            { variant: 'outline', onClick: closeInstallDialog, disabled: installing },
            t('cancel'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              type: 'button',
              disabled:
                installing ||
                installCandidates.status === 'loading' ||
                installSelected.length === 0,
              onClick: installSelectedSkills,
            },
            installing
              ? String(t('installingSkills')).replace('{n}', String(installSelected.length))
              : installSelected.length > 0
                ? String(t('installSelectedCount')).replace('{n}', String(installSelected.length))
                : t('installSelected'),
          ),
        ),
      },
      installOpen && selectedWorker !== null ? h(InstallDialog, { t, state, skillActions }) : null,
    )
  )
}
