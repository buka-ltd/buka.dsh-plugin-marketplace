/**
 * 运行等待提示：用户介入 / 机器人提问与审批。
 */

import { Button, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { WorkflowRunRecord } from '../../run-store.ts'
import { h } from '../element.ts'
import { formatTime } from '../format.ts'
import type { PageContext } from '../page-context.ts'
import { isRecord } from '../types.ts'

/**
 * 运行停在用户介入节点时的提示条：说明在等什么（标题 + 渲染后的说明），列出
 * 用户可选的出口与追加问题，并提供直达工作流创建者会话的入口。数据由
 * supervisor 写在 `run.pendingUser` 上。
 *
 * @param run 运行记录
 * @returns React 元素；没有等待中的用户介入时返回 null
 */
export function renderUserNotice(
  page: PageContext,
  run: WorkflowRunRecord | null,
): React.ReactElement | null {
  const { t, openSession } = page

  const pending =
    run !== null &&
    typeof run === 'object' &&
    run.pendingUser !== null &&
    typeof run.pendingUser === 'object'
      ? run.pendingUser
      : null
  if (pending === null) return null
  const nodeId = typeof pending.nodeId === 'string' ? pending.nodeId : ''
  const title = typeof pending.title === 'string' ? pending.title.trim() : ''
  const detail = typeof pending.detail === 'string' ? pending.detail.trim() : ''
  const sessionId = typeof pending.sessionId === 'string' ? pending.sessionId : ''
  const requestedAt =
    typeof pending.requestedAt === 'number' && Number.isFinite(pending.requestedAt)
      ? formatTime(pending.requestedAt)
      : ''
  // 正文就是等待卡的内容：用户节点的标题 + 模板渲染后的说明。
  const body = [title, detail].filter((text) => text !== '').join('\n')
  const options = Array.isArray(pending.options)
    ? pending.options.filter((option): option is Record<string, unknown> => isRecord(option))
    : []
  const questions = Array.isArray(pending.questions)
    ? pending.questions.filter((question): question is Record<string, unknown> =>
        isRecord(question),
      )
    : []
  return h(
    'div',
    { className: 'buka-workflows-interactionNotice buka-workflows-userNotice', role: 'status' },
    h(
      'div',
      { className: 'buka-workflows-interactionHead' },
      h('span', { className: 'buka-workflows-interactionTitle' }, t('userWaitingTitle')),
      nodeId === '' ? null : h('code', { className: 'buka-workflows-inlineCode' }, nodeId),
      requestedAt === '' ? null : h('span', { className: 'buka-workflows-meta' }, requestedAt),
    ),
    body === '' ? null : h('p', { className: 'buka-workflows-interactionBody' }, body),
    // 用户的选择就是出边：列出每条边给用户看的 label（可带 description）。
    options.length === 0
      ? null
      : h(
          'div',
          { className: 'buka-workflows-userNoticeGroup' },
          h('span', { className: 'buka-workflows-label' }, t('userChoice')),
          h(
            'ul',
            { className: 'buka-workflows-userChoiceList' },
            ...options.map((option, index) => {
              const label = typeof option.label === 'string' ? option.label.trim() : ''
              const description =
                typeof option.description === 'string' ? option.description.trim() : ''
              return h(
                'li',
                {
                  key: `${String(option.name ?? index)}-${label}`,
                  className: 'buka-workflows-userChoice',
                },
                h(
                  'span',
                  { className: 'buka-workflows-userChoiceLabel' },
                  label === '' ? t('userAnswerSkipped') : label,
                ),
                description === ''
                  ? null
                  : h('span', { className: 'buka-workflows-userChoiceDesc' }, description),
              )
            }),
          ),
        ),
    // 追加问题：header 是可选的大标题，question 才是正文。
    questions.length === 0
      ? null
      : h(
          'div',
          { className: 'buka-workflows-userNoticeGroup' },
          h('span', { className: 'buka-workflows-label' }, t('userAnswers')),
          h(
            'ul',
            { className: 'buka-workflows-userQuestionList' },
            ...questions.map((question, index) => {
              const id = typeof question.id === 'string' ? question.id : String(index)
              const header = typeof question.header === 'string' ? question.header.trim() : ''
              const text = typeof question.question === 'string' ? question.question.trim() : ''
              return h(
                'li',
                { key: id, className: 'buka-workflows-userQuestion' },
                header === ''
                  ? null
                  : h('span', { className: 'buka-workflows-userQuestionHeader' }, header),
                text === ''
                  ? null
                  : h('span', { className: 'buka-workflows-userQuestionText' }, text),
              )
            }),
          ),
        ),
    // 提问卡出现在创建者会话里：给出直达入口，并说明要去哪里作答。
    sessionId === ''
      ? null
      : h(
          'div',
          { className: 'buka-workflows-interactionActions' },
          h('span', { className: 'buka-workflows-hint' }, t('userWaitingBody')),
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              icon: h(IconNewChatOutlineRegular, { size: 13 }),
              onClick: () => openSession({ sessionId }),
            },
            t('openSession'),
          ),
        ),
  )
}

/**
 * 运行在等待用户时（机器人提问 / 请求批准）的提示条：说明在等什么，并提供
 * 直达当前机器人会话的入口。数据由 supervisor 写在 `run.pendingInteraction`。
 *
 * @param run 运行记录
 * @returns React 元素；没有等待中的交互时返回 null
 */
export function renderInteractionNotice(
  page: PageContext,
  run: WorkflowRunRecord | null,
): React.ReactElement | null {
  const { t, openSession } = page

  const interaction =
    run !== null &&
    typeof run === 'object' &&
    run.pendingInteraction !== null &&
    typeof run.pendingInteraction === 'object'
      ? run.pendingInteraction
      : null
  if (interaction === null) return null
  const approval = interaction.kind === 'approval'
  const planReview = interaction.planReview === true && !approval
  const toolName = typeof interaction.toolName === 'string' ? interaction.toolName.trim() : ''
  const nodeId = typeof interaction.nodeId === 'string' ? interaction.nodeId : ''
  const sessionId = typeof interaction.sessionId === 'string' ? interaction.sessionId : ''
  const askedAt =
    typeof interaction.askedAt === 'number' && Number.isFinite(interaction.askedAt)
      ? formatTime(interaction.askedAt)
      : ''
  // 批准展示工具/原因；提问展示第一个问题（其余问题在会话里继续回答）。
  let body = ''
  if (approval) {
    const displayReason =
      typeof interaction.displayReason === 'string' ? interaction.displayReason.trim() : ''
    const reason = typeof interaction.reason === 'string' ? interaction.reason.trim() : ''
    body = displayReason !== '' ? displayReason : reason
  } else if (planReview) {
    // 计划正文留在机器人会话的原生审阅卡里，运行页只说明去哪里审阅。
    body = t('planReviewBody')
  } else {
    const questions: unknown[] = Array.isArray(interaction.questions) ? interaction.questions : []
    const first = isRecord(questions[0]) ? questions[0] : null
    const question = typeof first?.question === 'string' ? first.question.trim() : ''
    const header = typeof first?.header === 'string' ? first.header.trim() : ''
    body = question !== '' ? question : header
  }
  const title = planReview
    ? t('waitingForPlanReview')
    : approval
      ? `${t('waitingForApproval')}${toolName === '' ? '' : ` ${toolName}`}`
      : t('waitingForAnswer')
  return h(
    'div',
    { className: 'buka-workflows-interactionNotice', role: 'status' },
    h(
      'div',
      { className: 'buka-workflows-interactionHead' },
      h('span', { className: 'buka-workflows-interactionTitle' }, title),
      nodeId === '' ? null : h('code', { className: 'buka-workflows-inlineCode' }, nodeId),
      askedAt === '' ? null : h('span', { className: 'buka-workflows-meta' }, askedAt),
    ),
    body === '' ? null : h('p', { className: 'buka-workflows-interactionBody' }, body),
    sessionId === ''
      ? null
      : h(
          'div',
          { className: 'buka-workflows-interactionActions' },
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              icon: h(IconNewChatOutlineRegular, { size: 13 }),
              onClick: () => openSession({ sessionId }),
            },
            t(
              planReview
                ? 'openPlanReviewSession'
                : approval
                  ? 'openApprovalSession'
                  : 'openAnswerSession',
            ),
          ),
        ),
  )
}
