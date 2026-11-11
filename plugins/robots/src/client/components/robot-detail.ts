/**
 * 「机器人」详情页：职责、AGENTS.md 与 skills 三个页签。
 *
 * @module @buka/dsh-plugin-robots/client/components/robot-detail
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
import type { createRobotActions } from '../actions/robots.ts'
import type { createSkillActions } from '../actions/skills.ts'
import { agentsOf, skillsOf } from '../api.ts'
import { ROBOT_DESCRIPTION_MAX_LENGTH, TABS } from '../constants.ts'
import { h } from '../h.ts'
import type { RobotsPageState } from '../state.ts'
import type { Robot, Translate } from '../types.ts'

type RobotActions = ReturnType<typeof createRobotActions>
type DetailActions = ReturnType<typeof createDetailActions>
type SkillActions = ReturnType<typeof createSkillActions>

/**
 * 技能区块：来源输入 + 安装按钮、失败输出、已安装列表与移除确认。
 *
 */
export function SkillsSection({
  t,
  robot,
  state,
  skillActions,
}: {
  t: Translate
  robot: Robot
  state: RobotsPageState
  skillActions: SkillActions
}): ReactElement {
  const { mutating, confirmingSkill, removing, skillError, setConfirmingSkill, corrupt } = state
  const { removeSkill, openInstallDialog } = skillActions
  const skills = skillsOf(robot)
  const anyBusy = mutating

  const rows = skills.map((skill, index) => {
    const confirmingThis = confirmingSkill === skill.name
    const removingThis = removing === skill.name
    const actions = removingThis
      ? h(
          'span',
          { className: 'buka-robots-statusWithDot' },
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
                className: 'buka-robots-danger',
                icon: h(IconWarningOutlineRegular, { size: 13 }),
                disabled: anyBusy,
                onClick: () => removeSkill(robot, skill),
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
              className: 'buka-robots-danger',
              icon: h(IconTrashOutlineRegular, { size: 13 }),
              disabled: anyBusy,
              'aria-label': `${t('removeSkill')} ${skill.name}`,
              onClick: () => setConfirmingSkill(skill.name),
            },
            t('removeSkill'),
          )

    return h(
      'li',
      { className: 'buka-robots-skillRow', key: `${String(skill.name)}:${index}` },
      h(
        'div',
        { className: 'buka-robots-skillHead' },
        h('span', { className: 'buka-robots-skillName' }, String(skill.name)),
        typeof skill.source === 'string' && skill.source !== ''
          ? h(Tag, { tone: 'info' }, skill.source)
          : null,
        h(
          'span',
          { className: 'buka-robots-skillActions' },
          ...(Array.isArray(actions) ? actions : [actions]),
        ),
      ),
      typeof skill.description === 'string' && skill.description !== ''
        ? h(
            'div',
            { className: 'buka-robots-skillDesc', title: skill.description },
            skill.description,
          )
        : null,
    )
  })

  return h(
    'section',
    { className: 'buka-robots-section', 'aria-busy': anyBusy ? true : undefined },
    h(
      'div',
      { className: 'buka-robots-sectionHead' },
      h('h2', { className: 'buka-robots-sectionTitle' }, t('skillsTitle')),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          className: 'buka-robots-toolbarButton',
          icon: h(IconPlusOutlineRegular, { size: 13 }),
          disabled: mutating || corrupt || robot.exists === false,
          onClick: openInstallDialog,
        },
        t('installSkills'),
      ),
    ),
    h(
      'p',
      { className: 'buka-robots-intro' },
      t('skillsIntroBefore'),
      h('code', { className: 'buka-robots-inlineCode' }, 'npx skills add <source>'),
      t('skillsIntroMiddle'),
      h('code', { className: 'buka-robots-inlineCode' }, '.agents/skills'),
      t('skillsIntroAfter'),
    ),
    skillError === null
      ? null
      : h(
          'div',
          { className: 'buka-robots-alert', role: 'alert' },
          h(
            'div',
            { className: 'buka-robots-alertHead' },
            h(IconWarningOutlineRegular, { size: 16 }),
            h('span', null, `${t('skillErrorTitle')} ${skillError.message}`),
          ),
          typeof skillError.output === 'string' && skillError.output !== ''
            ? h(
                React.Fragment,
                null,
                h('span', { className: 'buka-robots-outputLabel' }, t('outputLabel')),
                h('pre', { className: 'buka-robots-output' }, skillError.output),
              )
            : null,
        ),
    skills.length === 0
      ? h('p', { className: 'buka-robots-empty' }, t('skillsEmpty'))
      : h('ul', { className: 'buka-robots-skillList' }, ...rows),
  )
}

/**
 * AGENTS.md 页签：过大时只给提示；否则是可编辑 textarea + dirty 才可用的
 * 保存按钮。页面不展示目录与 CLAUDE.md 链接状态（链接由 Host 自动维护）。
 *
 */
export function AgentsSection({
  t,
  robot,
  state,
  actions,
}: {
  t: Translate
  robot: Robot
  state: RobotsPageState
  actions: RobotActions
}): ReactElement {
  const { agentsDraft, setAgentsDraft, agentsSaving, mutating } = state
  const { saveAgents } = actions
  const agents = agentsOf(robot)
  const dirty = !agents.tooLarge && agentsDraft !== agents.content

  if (agents.tooLarge) {
    return h(
      'section',
      { className: 'buka-robots-section' },
      h('h2', { className: 'buka-robots-sectionTitle' }, t('agentsTitle')),
      h(
        'p',
        { className: 'buka-robots-notice', role: 'status' },
        h(IconWarningOutlineRegular, { size: 16 }),
        h('span', null, t('agentsTooLarge')),
      ),
    )
  }

  return h(
    'section',
    {
      className: 'buka-robots-section buka-robots-agentsSection',
      'aria-busy': agentsSaving ? true : undefined,
    },
    h(
      'div',
      { className: 'buka-robots-sectionHead' },
      h('h2', { className: 'buka-robots-sectionTitle' }, t('agentsTitle')),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          type: 'button',
          className: 'buka-robots-submit',
          disabled: !dirty || mutating,
          onClick: () => saveAgents(robot),
        },
        agentsSaving ? t('saving') : t('save'),
      ),
    ),
    agents.exists ? null : h('p', { className: 'buka-robots-meta' }, t('agentsMissingHint')),
    h('textarea', {
      className: 'buka-robots-textarea',
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
 * 「描述」页签：一句话摘要 + 保存按钮。工作流通过 `buka_robots` 读这一行，
 * 决定是否把节点交给这个机器人；没有改动时保存按钮不可用。
 *
 */
export function DescriptionSection({
  t,
  robot,
  state,
  detailActions,
}: {
  t: Translate
  robot: Robot
  state: RobotsPageState
  detailActions: DetailActions
}): ReactElement {
  const { descriptionDraft, setDescriptionDraft, descriptionSaving, descriptionError, mutating } =
    state
  const { normalizedDescription, saveDescription } = detailActions
  const current = typeof robot.description === 'string' ? robot.description : ''
  const dirty = normalizedDescription(descriptionDraft) !== current
  return h(
    'section',
    { className: 'buka-robots-section', 'aria-busy': descriptionSaving ? true : undefined },
    h(
      'div',
      { className: 'buka-robots-sectionHead' },
      h('h2', { className: 'buka-robots-sectionTitle' }, t('descriptionLabel')),
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          type: 'button',
          className: 'buka-robots-submit',
          disabled: !dirty || mutating,
          onClick: saveDescription,
        },
        descriptionSaving ? t('saving') : t('save'),
      ),
    ),
    h('p', { className: 'buka-robots-fieldHint' }, t('descriptionHint')),
    h('textarea', {
      className: 'buka-robots-descriptionInput is-tall',
      value: descriptionDraft,
      placeholder: t('descriptionPlaceholder'),
      maxLength: ROBOT_DESCRIPTION_MAX_LENGTH,
      rows: 4,
      disabled: descriptionSaving,
      'aria-label': t('descriptionLabel'),
      onChange: (event: { target: { value: string } }) => setDescriptionDraft(event.target.value),
    }),
    descriptionError === null
      ? null
      : h('p', { className: 'buka-robots-formError', role: 'alert' }, descriptionError),
  )
}

/**
 * 配置视图：缺目录提示 + 页签面板（AGENTS.md / Skills / 描述）。
 *
 */
export function RobotDetail({
  t,
  robot,
  state,
  actions,
  detailActions,
  skillActions,
}: {
  t: Translate
  robot: Robot
  state: RobotsPageState
  actions: RobotActions
  detailActions: DetailActions
  skillActions: SkillActions
}): ReactElement {
  const { tab } = state
  const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0]
  return h(
    'div',
    { className: 'buka-robots-pageBody buka-robots-detail' },
    robot.exists === false
      ? h(
          'p',
          { className: 'buka-robots-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h('span', null, t('missingDirDetail')),
        )
      : null,
    h(
      'div',
      {
        className: 'buka-robots-panel',
        role: 'tabpanel',
        id: activeTab.panelId,
        'aria-labelledby': activeTab.id,
      },
      tab === 'skills'
        ? h(SkillsSection, { t, robot, state, skillActions })
        : tab === 'description'
          ? h(DescriptionSection, { t, robot, state, detailActions })
          : h(AgentsSection, { t, robot, state, actions }),
    ),
  )
}
