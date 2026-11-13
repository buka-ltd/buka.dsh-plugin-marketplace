/**
 * 「打工人」详情页：职责、模型、AGENTS.md 与 skills 四个页签。
 *
 * @module @buka/dsh-plugin-workers/client/components/worker-detail
 */

import {
  Button,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import React from 'react'
import type { createDetailActions } from '../actions/detail.ts'
import type { createSkillActions } from '../actions/skills.ts'
import type { createWorkerActions } from '../actions/workers.ts'
import { agentsOf, skillsOf } from '../api.ts'
import { TABS, WORKER_DESCRIPTION_MAX_LENGTH } from '../constants.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate, Worker, WorkerModelSelection } from '../types.ts'

type WorkerActions = ReturnType<typeof createWorkerActions>
type DetailActions = ReturnType<typeof createDetailActions>
type SkillActions = ReturnType<typeof createSkillActions>

/**
 * 技能区块：来源输入 + 安装按钮、失败输出、已安装列表与移除确认。
 *
 */
export function SkillsSection({
  t,
  worker,
  state,
  skillActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  skillActions: SkillActions
}): ReactElement {
  const { mutating, confirmingSkill, removing, skillError, setConfirmingSkill, corrupt } = state
  const { removeSkill, openInstallDialog } = skillActions
  const skills = skillsOf(worker)
  const anyBusy = mutating

  const rows = skills.map((skill, index) => {
    const confirmingThis = confirmingSkill === skill.name
    const removingThis = removing === skill.name
    const actions = removingThis
      ? h(
          'span',
          { className: 'buka-workers-statusWithDot' },
          h(StateDot, { state: 'ongoing', size: 13 }),
          t('removing'),
        )
      : confirmingThis
        ? [
            h(
              Button,
              {
                key: 'confirm',
                variant: 'outline',
                size: 'sm',
                className: 'buka-workers-danger',
                icon: h(IconWarningOutlineRegular, { size: 13 }),
                disabled: anyBusy,
                onClick: () => removeSkill(worker, skill),
              },
              t('confirmRemoveSkill'),
            ),
            h(
              Button,
              {
                key: 'cancel',
                variant: 'ghost',
                size: 'sm',
                disabled: anyBusy,
                onClick: () => setConfirmingSkill(null),
              },
              t('cancel'),
            ),
          ]
        : h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workers-danger',
              icon: h(IconTrashOutlineRegular, { size: 13 }),
              disabled: anyBusy,
              'aria-label': `${t('removeSkill')} ${skill.name}`,
              onClick: () => setConfirmingSkill(skill.name),
            },
            t('removeSkill'),
          )

    return h(
      'li',
      { className: 'buka-workers-skillRow', key: `${String(skill.name)}:${index}` },
      h(
        'div',
        { className: 'buka-workers-skillHead' },
        h('span', { className: 'buka-workers-skillName' }, String(skill.name)),
        typeof skill.source === 'string' && skill.source !== ''
          ? h(Tag, { tone: 'info' }, skill.source)
          : null,
        h(
          'span',
          { className: 'buka-workers-skillActions' },
          ...(Array.isArray(actions) ? actions : [actions]),
        ),
      ),
      typeof skill.description === 'string' && skill.description !== ''
        ? h(
            'div',
            { className: 'buka-workers-skillDesc', title: skill.description },
            skill.description,
          )
        : null,
    )
  })

  return h(
    'section',
    { className: 'buka-workers-section', 'aria-busy': anyBusy ? true : undefined },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('skillsTitle')),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          className: 'buka-workers-toolbarButton',
          icon: h(IconPlusOutlineRegular, { size: 13 }),
          disabled: mutating || corrupt || worker.exists === false,
          onClick: openInstallDialog,
        },
        t('installSkills'),
      ),
    ),
    h(
      'p',
      { className: 'buka-workers-intro' },
      t('skillsIntroBefore'),
      h('code', { className: 'buka-workers-inlineCode' }, 'npx skills add <source>'),
      t('skillsIntroMiddle'),
      h('code', { className: 'buka-workers-inlineCode' }, '.agents/skills'),
      t('skillsIntroAfter'),
    ),
    skillError === null
      ? null
      : h(
          'div',
          { className: 'buka-workers-alert', role: 'alert' },
          h(
            'div',
            { className: 'buka-workers-alertHead' },
            h(IconWarningOutlineRegular, { size: 16 }),
            h('span', null, `${t('skillErrorTitle')} ${skillError.message}`),
          ),
          typeof skillError.output === 'string' && skillError.output !== ''
            ? h(
                React.Fragment,
                null,
                h('span', { className: 'buka-workers-outputLabel' }, t('outputLabel')),
                h('pre', { className: 'buka-workers-output' }, skillError.output),
              )
            : null,
        ),
    skills.length === 0
      ? h('p', { className: 'buka-workers-empty' }, t('skillsEmpty'))
      : h('ul', { className: 'buka-workers-skillList' }, ...rows),
  )
}

/**
 * AGENTS.md 页签：过大时只给提示；否则是可编辑 textarea + dirty 才可用的
 * 保存按钮。页面不展示目录与 CLAUDE.md 链接状态（链接由 Host 自动维护）。
 *
 */
export function AgentsSection({
  t,
  worker,
  state,
  actions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  actions: WorkerActions
}): ReactElement {
  const { agentsDraft, setAgentsDraft, agentsSaving, mutating } = state
  const { saveAgents } = actions
  const agents = agentsOf(worker)
  const dirty = !agents.tooLarge && agentsDraft !== agents.content

  if (agents.tooLarge) {
    return h(
      'section',
      { className: 'buka-workers-section' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('agentsTitle')),
      h(
        'p',
        { className: 'buka-workers-notice', role: 'status' },
        h(IconWarningOutlineRegular, { size: 16 }),
        h('span', null, t('agentsTooLarge')),
      ),
    )
  }

  return h(
    'section',
    {
      className: 'buka-workers-section buka-workers-agentsSection',
      'aria-busy': agentsSaving ? true : undefined,
    },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('agentsTitle')),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          type: 'button',
          className: 'buka-workers-submit',
          disabled: !dirty || mutating,
          onClick: () => saveAgents(worker),
        },
        agentsSaving ? t('saving') : t('save'),
      ),
    ),
    agents.exists ? null : h('p', { className: 'buka-workers-meta' }, t('agentsMissingHint')),
    h('textarea', {
      className: 'buka-workers-textarea',
      value: agentsDraft,
      placeholder: t('agentsPlaceholder'),
      'aria-label': t('agentsEditorLabel'),
      spellCheck: false,
      disabled: agentsSaving,
      onChange: (event: { target: { value: string } }) => setAgentsDraft(event.target.value),
    }),
  )
}

/**
 * 「描述」页签：一句话摘要 + 保存按钮。工作流通过 `buka_workers` 读这一行，
 * 决定是否把节点交给这个打工人；没有改动时保存按钮不可用。
 *
 */
export function DescriptionSection({
  t,
  worker,
  state,
  detailActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: DetailActions
}): ReactElement {
  const { descriptionDraft, setDescriptionDraft, descriptionSaving, descriptionError, mutating } =
    state
  const { normalizedDescription, saveDescription } = detailActions
  const current = typeof worker.description === 'string' ? worker.description : ''
  const dirty = normalizedDescription(descriptionDraft) !== current
  return h(
    'section',
    { className: 'buka-workers-section', 'aria-busy': descriptionSaving ? true : undefined },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('descriptionLabel')),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          type: 'button',
          className: 'buka-workers-submit',
          disabled: !dirty || mutating,
          onClick: saveDescription,
        },
        descriptionSaving ? t('saving') : t('save'),
      ),
    ),
    h('p', { className: 'buka-workers-fieldHint' }, t('descriptionHint')),
    h('textarea', {
      className: 'buka-workers-descriptionInput is-tall',
      value: descriptionDraft,
      placeholder: t('descriptionPlaceholder'),
      maxLength: WORKER_DESCRIPTION_MAX_LENGTH,
      rows: 4,
      disabled: descriptionSaving,
      'aria-label': t('descriptionLabel'),
      onChange: (event: { target: { value: string } }) => setDescriptionDraft(event.target.value),
    }),
    descriptionError === null
      ? null
      : h('p', { className: 'buka-workers-formError', role: 'alert' }, descriptionError),
  )
}

/**
 * 「模型」页签：给智能体选新会话使用的模型。
 *
 * 目录按需从 Host 读取；`modelDraft === null` 表示跟随宿主默认模型。保存后只影响
 * 之后新开的会话，已有会话保留自己的模型（可在会话里用 `/model` 切换）。
 *
 */
export function ModelSection({
  t,
  worker,
  state,
  detailActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: DetailActions
}): ReactElement {
  const { modelCatalog, modelDraft, setModelDraft, modelSaving, modelError, loadModelCatalog } =
    state
  const { saveWorkerModel } = detailActions
  const catalog = modelCatalog.data
  const available = catalog?.available === true
  const groups = catalog?.groups ?? []

  const currentGroup =
    modelDraft === null ? undefined : groups.find((group) => group.id === modelDraft.provider)
  const currentModel =
    modelDraft === null || currentGroup === undefined
      ? undefined
      : currentGroup.models.find((model) => model.id === modelDraft.model)
  const savedEffort = modelDraft?.reasoningEffort
  const efforts = currentModel?.reasoning?.efforts ?? []
  const effortKnown =
    savedEffort === undefined || efforts.some((effort) => effort.id === savedEffort)
  const showEffort = efforts.length > 0 || savedEffort !== undefined
  const savedSelection = worker.model ?? null
  const dirty =
    modelDraft === null || savedSelection === null
      ? modelDraft !== savedSelection
      : modelDraft.provider !== savedSelection.provider ||
        modelDraft.model !== savedSelection.model ||
        (modelDraft.reasoningEffort ?? '') !== (savedSelection.reasoningEffort ?? '')

  /** 模型选择的展示名：目录里有就用名称，否则退回 provider / model id。 */
  function labelFor(selection: WorkerModelSelection): string {
    const group = groups.find((entry) => entry.id === selection.provider)
    const model = group?.models.find((entry) => entry.id === selection.model)
    return model === undefined || group === undefined
      ? `${selection.provider} / ${selection.model}`
      : `${group.name} · ${model.name}`
  }

  function pickProvider(providerId: string) {
    if (providerId === '') {
      setModelDraft(null)
      return
    }
    const group = groups.find((entry) => entry.id === providerId)
    const first = group?.models[0]
    setModelDraft({ provider: providerId, model: first?.id ?? '' })
  }

  function pickModel(modelId: string) {
    if (modelDraft === null) return
    setModelDraft({ provider: modelDraft.provider, model: modelId })
  }

  function pickEffort(effortId: string) {
    if (modelDraft === null) return
    setModelDraft({
      provider: modelDraft.provider,
      model: modelDraft.model,
      ...(effortId === '' ? {} : { reasoningEffort: effortId }),
    })
  }

  const providerOptions = [
    h('option', { key: 'default', value: '' }, t('modelFollowDefault')),
    ...groups.map((group) => h('option', { key: group.id, value: group.id }, group.name)),
  ]
  if (modelDraft !== null && currentGroup === undefined) {
    providerOptions.push(
      h(
        'option',
        { key: `saved:${modelDraft.provider}`, value: modelDraft.provider },
        `${modelDraft.provider} / ${modelDraft.model}`,
      ),
    )
  }

  const modelOptions =
    modelDraft === null || currentGroup === undefined
      ? []
      : [
          ...currentGroup.models.map((model) =>
            h('option', { key: model.id, value: model.id }, model.name),
          ),
        ]
  if (modelDraft !== null && currentModel === undefined) {
    modelOptions.push(
      h('option', { key: `saved:${modelDraft.model}`, value: modelDraft.model }, modelDraft.model),
    )
  }

  const effortOptions = [
    h('option', { key: 'default', value: '' }, t('modelEffortDefault')),
    ...efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, effort.name)),
  ]
  if (modelDraft !== null && savedEffort !== undefined && !effortKnown) {
    effortOptions.push(
      h('option', { key: `saved:${savedEffort}`, value: savedEffort }, savedEffort),
    )
  }

  return h(
    'section',
    { className: 'buka-workers-modelSection' },
    h('h2', { className: 'buka-workers-sectionTitle' }, t('modelTitle')),
    h('p', { className: 'buka-workers-hint' }, t('modelHint')),
    modelCatalog.status === 'loading' && catalog === null
      ? h('p', { className: 'buka-workers-hint', role: 'status' }, t('loading'))
      : null,
    modelCatalog.status === 'error'
      ? h(
          'p',
          { className: 'buka-workers-formError', role: 'alert' },
          `${t('modelLoadFailed')} ${modelCatalog.error ?? ''}`,
        )
      : null,
    catalog !== null && !available
      ? h('p', { className: 'buka-workers-notice', role: 'status' }, t('modelUnavailable'))
      : null,
    available && groups.length === 0
      ? h('p', { className: 'buka-workers-notice', role: 'status' }, t('modelEmpty'))
      : null,
    catalog !== null && catalog.failures.length > 0
      ? h(
          'p',
          { className: 'buka-workers-hint' },
          `${t('modelSomeFailed')} ${catalog.failures.map((failure) => failure.name).join('、')}`,
        )
      : null,
    available
      ? [
          h(
            'label',
            { key: 'provider', className: 'buka-workers-field' },
            h('span', { className: 'buka-workers-fieldLabel' }, t('modelProvider')),
            h(
              'select',
              {
                className: 'buka-workers-select',
                value: modelDraft?.provider ?? '',
                'aria-label': t('modelProvider'),
                disabled: modelSaving,
                onChange: (event: { target: { value: string } }) =>
                  pickProvider(event.target.value),
              },
              ...providerOptions,
            ),
          ),
          modelDraft === null
            ? null
            : h(
                'label',
                { key: 'model', className: 'buka-workers-field' },
                h('span', { className: 'buka-workers-fieldLabel' }, t('modelModelLabel')),
                h(
                  'select',
                  {
                    className: 'buka-workers-select',
                    value: modelDraft.model,
                    'aria-label': t('modelModelLabel'),
                    disabled: modelSaving,
                    onChange: (event: { target: { value: string } }) =>
                      pickModel(event.target.value),
                  },
                  ...modelOptions,
                ),
              ),
          modelDraft === null || !showEffort
            ? null
            : h(
                'label',
                { key: 'effort', className: 'buka-workers-field' },
                h('span', { className: 'buka-workers-fieldLabel' }, t('modelEffort')),
                h(
                  'select',
                  {
                    className: 'buka-workers-select',
                    value: savedEffort ?? '',
                    'aria-label': t('modelEffort'),
                    disabled: modelSaving,
                    onChange: (event: { target: { value: string } }) =>
                      pickEffort(event.target.value),
                  },
                  ...effortOptions,
                ),
              ),
          h(
            'p',
            { key: 'current', className: 'buka-workers-hint' },
            modelDraft === null
              ? t('modelFollowDefaultHint')
              : `${t('modelCurrent')} ${labelFor(modelDraft)}`,
          ),
          modelError === null
            ? null
            : h(
                'p',
                { key: 'error', className: 'buka-workers-formError', role: 'alert' },
                modelError,
              ),
          h(
            'div',
            { key: 'save', className: 'buka-workers-formActions' },
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                disabled: !dirty || modelSaving,
                onClick: () => void saveWorkerModel(),
              },
              modelSaving ? t('saving') : t('save'),
            ),
            h(
              Button,
              {
                variant: 'ghost',
                size: 'sm',
                disabled: modelSaving,
                onClick: () => loadModelCatalog(true),
              },
              t('refresh'),
            ),
          ),
        ]
      : null,
  )
}

/**
 * 配置视图：缺目录提示 + 页签面板（AGENTS.md / Skills / 描述）。
 *
 */
export function WorkerDetail({
  t,
  worker,
  state,
  actions,
  detailActions,
  skillActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  actions: WorkerActions
  detailActions: DetailActions
  skillActions: SkillActions
}): ReactElement {
  const { tab } = state
  const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0]
  return h(
    'div',
    { className: 'buka-workers-pageBody buka-workers-detail' },
    worker.exists === false
      ? h(
          'p',
          { className: 'buka-workers-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h('span', null, t('missingDirDetail')),
        )
      : null,
    h(
      'div',
      {
        className: 'buka-workers-panel',
        role: 'tabpanel',
        id: activeTab.panelId,
        'aria-labelledby': activeTab.id,
      },
      tab === 'skills'
        ? h(SkillsSection, { t, worker, state, skillActions })
        : tab === 'description'
          ? h(DescriptionSection, { t, worker, state, detailActions })
          : tab === 'model'
            ? h(ModelSection, { t, worker, state, detailActions })
            : h(AgentsSection, { t, worker, state, actions }),
    ),
  )
}
