/**
 * 重启失败作业对话框：两个选项——从失败位置开始 / 从头开始。
 *
 * 可用性与不可用原因由服务端 `restart` 投影给出，客户端只按它置灰与显示原因，
 * 不自己判断作业状态或工作流能否启动。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { ClientModal, h } from '../element.ts'
import { jobTasks } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import type { JobRestartOption } from '../types.ts'

/** 服务端原因代码 → 词典 key。 */
const REASON_KEYS: Record<string, string> = {
  'job-not-failed': 'restartReasonJobNotFailed',
  'no-failed-tasks': 'restartReasonNoFailedTasks',
  'workflow-not-found': 'restartReasonWorkflowNotFound',
  'workflow-retired': 'restartReasonWorkflowRetired',
  'definition-outdated': 'restartReasonDefinitionOutdated',
}

/** 渲染一个不可用原因；未知代码退回通用文案。 */
function reasonText(page: AppContext, option: JobRestartOption | undefined): string {
  const reason = typeof option?.reason === 'string' ? option.reason : ''
  return page.t(REASON_KEYS[reason] ?? 'restartReasonUnknown')
}

/** 一个重启选项。 */
function renderOption(input: {
  readonly page: AppContext
  readonly mode: 'failed' | 'scratch'
  readonly title: string
  readonly hint: string
  readonly option: JobRestartOption | undefined
  readonly extra?: React.ReactNode
}): React.ReactElement {
  const { page, option } = input
  const { t, state, actions } = page
  const available = option?.available === true
  const submitting = state.restart.submitting === input.mode
  const busy = state.restart.submitting !== false
  return h(
    'section',
    { key: input.mode, className: 'buka-workflows-dialogSection' },
    h('h3', { className: 'buka-workflows-dialogSectionTitle' }, input.title),
    h('p', { className: 'buka-workflows-fieldHint' }, input.hint),
    input.extra ?? null,
    available
      ? null
      : h(
          'p',
          { className: 'buka-workflows-hint' },
          `${t('restartUnavailable')} · ${reasonText(page, option)}`,
        ),
    h(
      Button,
      {
        variant: 'primary',
        size: 'sm',
        className: 'buka-workflows-smallButton',
        disabled: !available || busy,
        onClick: () => void actions.restartJob(input.mode),
      },
      submitting ? t('restartSubmitting') : input.title,
    ),
  )
}

/** 重启失败作业对话框。 */
export function renderRestartDialog(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const dialog = state.restart
  const restart = state.job.data?.restart
  const failedTasks = jobTasks(state).filter((task) => task.status === 'failed')
  const failedTaskList =
    failedTasks.length === 0
      ? null
      : h(
          'div',
          { className: 'buka-workflows-restartTasks' },
          h('p', { className: 'buka-workflows-hint' }, t('restartFromFailedTasks')),
          h(
            'ul',
            { className: 'buka-workflows-restartTaskList' },
            ...failedTasks.map((task) =>
              h(
                'li',
                { key: task.id, className: 'buka-workflows-restartTask' },
                typeof task.typeLabel === 'string' && task.typeLabel !== ''
                  ? task.typeLabel
                  : (task.type ?? task.id),
              ),
            ),
          ),
        )
  const body: React.ReactNode[] = [
    h('p', { key: 'hint', className: 'buka-workflows-hint' }, t('restartHint')),
    renderOption({
      page,
      mode: 'failed',
      title: t('restartFromFailed'),
      hint: t('restartFromFailedHint'),
      option: restart?.failed,
      ...(failedTaskList === null ? {} : { extra: failedTaskList }),
    }),
    renderOption({
      page,
      mode: 'scratch',
      title: t('restartScratch'),
      hint: t('restartScratchHint'),
      option: restart?.scratch,
    }),
    dialog.error === null
      ? null
      : h(
          'p',
          { key: 'error', className: 'buka-workflows-formError', role: 'alert' },
          dialog.error,
        ),
  ]

  return h(
    ClientModal,
    {
      open: dialog.open,
      onClose: actions.closeRestart,
      title: t('restartTitle'),
      closeLabel: t('close'),
      footer: h(
        Button,
        {
          variant: 'outline',
          onClick: actions.closeRestart,
          disabled: dialog.submitting !== false,
        },
        t('cancel'),
      ),
    },
    h('div', { className: 'buka-workflows-dialogForm' }, ...body),
  )
}
