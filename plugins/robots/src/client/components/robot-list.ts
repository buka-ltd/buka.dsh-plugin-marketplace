/**
 * 「机器人」列表：机器人卡片与列表状态。
 *
 * 列表不展示目录；每张卡片显示名称、驱动类型、skills / AGENTS.md / 挂载状态、
 * 一句职责与行内动作。整行点击进入详情，行内动作区自己挡住冒泡。
 *
 * program 型机器人（clock）只读：卡片展示驱动与职责，没有新会话 / 挂载 /
 * 删除 / 助理入口，也不进入配置视图。agent 型机器人可以标记 / 取消助理。
 *
 * @module @buka/dsh-plugin-robots/client/components/robot-list
 */

import {
  Button,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import type { createRobotActions } from '../actions/robots.ts'
import { agentsOf, countBadge, isProgramRobot, skillsOf } from '../api.ts'
import { renderAvatar } from '../avatar.ts'
import { h } from '../h.ts'
import type { RobotsPageState } from '../state.ts'
import type { Robot, Translate } from '../types.ts'
import { MountedTag } from './common.ts'

/** 列表组件用到的动作集合。 */
type RobotActions = ReturnType<typeof createRobotActions>

/**
 * 一条机器人卡片：名称、驱动 / 助理 / skills / AGENTS.md / 挂载状态、职责与
 * 动作与删除确认。program 型机器人只读。
 *
 */
export function RobotCard({
  t,
  robot,
  state,
  actions: robotActions,
}: {
  t: Translate
  robot: Robot
  state: RobotsPageState
  actions: RobotActions
}): ReactElement {
  const { confirming, setConfirming, busy, mutating, corrupt, openDetail } = state
  const { openRobot, mountRobot, removeRobot, toggleAssistant } = robotActions
  const skills = skillsOf(robot)
  const agents = agentsOf(robot)
  const program = isProgramRobot(robot)
  const confirmingThis = confirming === robot.name
  const missing = !program && robot.exists === false
  const mounted = robot.mounted === true
  const anyBusy = mutating || corrupt
  // 整行点击进入详情：program 型机器人只读，不进入配置视图；写操作进行中
  // （重命名 / 删除 / 挂载）时先别切页，避免把正在操作的卡片切走。
  const canOpen = !mutating && !program

  const actions = program
    ? []
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
              onClick: () => removeRobot(robot),
            },
            t('confirmDelete'),
          ),
          h(
            Button,
            {
              key: 'cancel',
              variant: 'ghost',
              size: 'sm',
              disabled: mutating,
              onClick: () => setConfirming(null),
            },
            t('cancel'),
          ),
        ]
      : [
          h(
            Button,
            {
              key: 'open',
              variant: 'outline',
              size: 'sm',
              icon: h(IconNewChatOutlineRegular, { size: 13 }),
              disabled: mutating,
              'aria-label': `${t('newSession')} ${robot.name}`,
              onClick: () => openRobot(robot),
            },
            t('newSession'),
          ),
          mounted
            ? null
            : h(
                Button,
                {
                  key: 'mount',
                  variant: 'outline',
                  size: 'sm',
                  icon:
                    busy === `mount:${robot.name}`
                      ? h(StateDot, { state: 'ongoing', size: 13 })
                      : h(IconPlusOutlineRegular, { size: 13 }),
                  disabled: anyBusy,
                  'aria-label': `${t('mount')} ${robot.name}`,
                  onClick: () => mountRobot(robot),
                },
                busy === `mount:${robot.name}` ? t('mounting') : t('mount'),
              ),
          h(
            Button,
            {
              key: 'assistant',
              variant: 'outline',
              size: 'sm',
              disabled: anyBusy || busy === `assistant:${robot.name}`,
              'aria-label': `${robot.assistant === true ? t('clearAssistant') : t('setAssistant')} ${robot.name}`,
              onClick: () => toggleAssistant(robot),
            },
            busy === `assistant:${robot.name}`
              ? t('saving')
              : robot.assistant === true
                ? t('clearAssistant')
                : t('setAssistant'),
          ),
          // 删除与其它行内动作共用同一套按钮（outline + sm + 危险色），
          // 不再用裸图标按钮，避免这一行里出现两种按钮风格。
          h(
            Button,
            {
              key: 'delete',
              variant: 'outline',
              size: 'sm',
              className: 'buka-robots-danger',
              icon: h(IconTrashOutlineRegular, { size: 13 }),
              disabled: anyBusy,
              'aria-label': `${t('delete')} ${robot.name}`,
              onClick: () => setConfirming(robot.name),
            },
            t('delete'),
          ),
        ]

  return h(
    'li',
    {
      className: `buka-robots-card${canOpen ? ' is-clickable' : ''}${program ? ' is-program' : ''}`,
      key: robot.name,
      'aria-busy': busy !== null ? true : undefined,
      // 整行可点进详情；行内动作区自己挡住冒泡，点按钮不会误触。
      onClick: () => {
        if (canOpen) openDetail(robot)
      },
    },
    h(
      'div',
      { className: 'buka-robots-cardHead' },
      h(
        'div',
        { className: 'buka-robots-titleRow' },
        h(
          'div',
          { className: 'buka-robots-titleCluster' },
          renderAvatar(robot.avatar, 26),
          // 标题本身就是按钮：鼠标点整行都能进详情，键盘 Tab 也能落到这里，
          // 不依赖一个单独的「配置」按钮。
          h(
            'button',
            {
              type: 'button',
              className: 'buka-robots-cardTitle',
              title: robot.name,
              'aria-label': `${t('openDetail')} ${robot.name}`,
              disabled: !canOpen,
              onClick: (event: { stopPropagation(): void }) => {
                event.stopPropagation()
                if (canOpen) openDetail(robot)
              },
            },
            String(robot.name ?? ''),
          ),
          h(
            Tag,
            { tone: program ? 'info' : 'neutral' },
            program ? t('driverProgram') : t('driverAgent'),
          ),
          robot.assistant === true ? h(Tag, { tone: 'success' }, t('assistantBadge')) : null,
          program ? null : h(MountedTag, { t, robot }),
          program ? null : h(Tag, { tone: 'neutral' }, countBadge(skills.length, t)),
          program
            ? null
            : h(
                Tag,
                { tone: agents.exists ? 'success' : 'neutral' },
                agents.exists ? t('agentsBadge') : t('noAgentsBadge'),
              ),
          missing ? h(Tag, { tone: 'warning' }, t('missingDir')) : null,
        ),
        h(
          'div',
          {
            className: 'buka-robots-titleActions',
            onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
          },
          ...actions.filter(Boolean),
        ),
      ),
      // 描述是工作流选择机器人的依据，列表里直接展示，避免必须点进详情才能比较。
      typeof robot.description === 'string' && robot.description !== ''
        ? h('p', { className: 'buka-robots-cardDesc' }, robot.description)
        : null,
      program ? h('p', { className: 'buka-robots-hint' }, t('programReadOnly')) : null,
      missing ? h('p', { className: 'buka-robots-hint' }, t('missingDirHint')) : null,
      confirmingThis ? h('p', { className: 'buka-robots-hint' }, t('deleteHint')) : null,
    ),
  )
}

/** 列表页：登记文件提示、加载 / 失败 / 空状态与机器人卡片（不展示目录）。 */
export function RobotList({
  t,
  state,
  actions,
}: {
  t: Translate
  state: RobotsPageState
  actions: RobotActions
}): ReactElement {
  const { corrupt, registry, list, data, robots, assistantOnly } = state
  const visible = assistantOnly ? robots.filter((robot) => robot.assistant === true) : robots
  const corruptNotice = corrupt
    ? h(
        'p',
        { className: 'buka-robots-notice', role: 'status' },
        h(IconWarningOutlineRegular, { size: 16 }),
        h(
          'span',
          null,
          t('corruptNote'),
          ' ',
          h('code', { className: 'buka-robots-inlineCode' }, registry),
        ),
      )
    : null

  return h(
    'div',
    { className: 'buka-robots-pageBody' },
    corruptNotice,
    list.error === null
      ? null
      : h(
          'p',
          { className: 'buka-robots-failure', role: 'alert' },
          h(StateDot, { state: 'error' }),
          `${t('loadFailed')} ${list.error}`,
        ),
    list.loading && data === null
      ? h(
          'p',
          { className: 'buka-robots-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('loading'),
        )
      : null,
    data === null
      ? null
      : visible.length === 0 && !list.loading && !corrupt
        ? h(
            'p',
            { className: 'buka-robots-empty' },
            assistantOnly ? t('assistantEmpty') : t('empty'),
          )
        : h(
            'ul',
            { className: 'buka-robots-cards' },
            ...visible.map((robot) => h(RobotCard, { t, robot, state, actions, key: robot.name })),
          ),
  )
}
