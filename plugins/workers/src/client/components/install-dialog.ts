/**
 * 「安装 skills」对话框：来源输入 + 收藏仓库入口 + 候选勾选列表。
 *
 * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
 *
 * @module @buka/dsh-plugin-workers/client/components/install-dialog
 */

import {
  Button,
  IconWarningOutlineRegular,
  Input,
  Modal,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FormEvent, ReactElement } from 'react'
import React from 'react'
import type { createSkillActions } from '../actions/skills.ts'
import { INSTALL_FORM_ID } from '../constants.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate } from '../types.ts'

type SkillActions = ReturnType<typeof createSkillActions>

/**
 * 对话框内容：来源输入 + 收藏仓库入口 + 候选勾选列表。
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
    favourites,
    installSource,
    setInstallSource,
    installing,
    installError,
  } = state
  const { loadCandidates, toggleCandidate, selectAllCandidates } = skillActions
  const candidates = installCandidates
  const installed = new Set(candidates.installed)
  const selectable = candidates.skills.filter((skill) => !installed.has(skill.name))
  const allSelected =
    selectable.length > 0 && selectable.every((skill) => installSelected.includes(skill.name))

  const favouritesBlock =
    favourites.status === 'ready'
      ? favourites.repos.length === 0
        ? h('p', { className: 'buka-workers-fieldHint' }, t('favouritesEmpty'))
        : h(
            'div',
            { className: 'buka-workers-field' },
            h('span', { className: 'buka-workers-fieldLabel' }, t('favouritesLabel')),
            h(
              'div',
              { className: 'buka-workers-favorites' },
              ...favourites.repos.map((repo) =>
                h(
                  Button,
                  {
                    key: repo.id,
                    variant: installSource === repo.source ? 'primary' : 'outline',
                    size: 'sm',
                    className: 'buka-workers-toolbarButton',
                    title: repo.note !== '' ? repo.note : repo.source,
                    disabled: installing || candidates.status === 'loading',
                    onClick: () => loadCandidates(repo.source),
                  },
                  repo.source,
                ),
              ),
            ),
          )
      : null

  return h(
    'div',
    { className: 'buka-workers-dialogForm' },
    h(
      'form',
      {
        id: INSTALL_FORM_ID,
        className: 'buka-workers-field',
        onSubmit: (event: FormEvent) => {
          event.preventDefault()
          loadCandidates()
        },
      },
      h(
        'label',
        { className: 'buka-workers-fieldLabel', htmlFor: 'buka-workers-install-source' },
        t('installSourceLabel'),
      ),
      h(
        'div',
        { className: 'buka-workers-sourceRow' },
        h(Input, {
          id: 'buka-workers-install-source',
          className: 'buka-workers-input',
          type: 'text',
          value: installSource,
          placeholder: t('sourcePlaceholder'),
          autoComplete: 'off',
          spellCheck: false,
          disabled: installing,
          'data-modal-autofocus': '',
          onChange: (event: { target: { value: string } }) => setInstallSource(event.target.value),
        }),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            type: 'submit',
            className: 'buka-workers-submit',
            icon:
              candidates.status === 'loading'
                ? h(StateDot, { state: 'ongoing', size: 13 })
                : undefined,
            disabled: installing || candidates.status === 'loading' || installSource.trim() === '',
          },
          candidates.status === 'loading' ? t('loadingSkills') : t('loadSkills'),
        ),
      ),
    ),
    favouritesBlock,
    candidates.status === 'idle'
      ? h('p', { className: 'buka-workers-fieldHint' }, t('installIdle'))
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
            ...candidates.skills.map((skill) => {
              const isInstalled = installed.has(skill.name)
              const checked = !isInstalled && installSelected.includes(skill.name)
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
                    onChange: () => toggleCandidate(skill.name),
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
            }),
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
  const { installOpen, selectedWorker, installSelected, installing } = state
  const { closeInstallDialog, installSelectedSkills } = skillActions
  return (
    // 「安装 skills」对话框：选来源（或收藏仓库）→ 读出候选 → 勾选 → 只安装选中的。
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
              disabled: installing || installSelected.length === 0,
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
