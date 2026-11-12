/**
 * 任务抽屉：payload、依赖、执行记录、结果、附件与按 `allowedActions` 展示的操作。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { ClientModal, h } from '../element.ts'
import { formatBytes, formatTime, jsonText, statusLabel } from '../format.ts'
import { claimantName, isHumanTask, taskTypeOf } from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import type { Attempt, TaskDetail } from '../types.ts'
import { isRecord } from '../types.ts'
import {
  renderAttachmentLink,
  renderEmpty,
  renderFailure,
  renderJsonBlock,
  renderKv,
  renderLoading,
  renderSection,
  renderStatusTag,
} from './parts.ts'
import { renderTaskForm } from './task-form.ts'

/**
 * 任务详情抽屉。
 *
 * @param page
 * @returns React 元素；没有打开任务时为 null
 */
export function renderTaskDrawer(page: AppContext): React.ReactElement | null {
  const { t, state, actions } = page
  if (state.taskId === null) return null
  const loaded = state.task

  const body: React.ReactElement[] = []
  if (loaded.error !== null && loaded.data === null) {
    body.push(renderFailure(page, loaded.error, actions.refresh))
  } else if (loaded.data === null) {
    body.push(renderLoading(page))
  } else {
    body.push(...renderTaskBody(page, loaded.data))
  }

  const task = loaded.data
  const title = task === null ? t('taskDrawerTitle') : `${task.typeLabel ?? task.type ?? task.id}`
  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: actions.closeTask,
      title,
      closeLabel: t('close'),
      backdropBlur: false,
      className: 'buka-workflows-drawer',
    },
    h(
      'div',
      { className: 'buka-workflows-drawerHead' },
      h(
        'div',
        { className: 'buka-workflows-drawerTitleRow' },
        h('span', { className: 'buka-workflows-drawerTitle' }, title),
        task === null ? null : renderStatusTag(t, task.status, 'task'),
      ),
      task === null
        ? null
        : h('span', { className: 'buka-workflows-drawerMeta' }, `${t('taskId')}: ${task.id}`),
      h(
        'div',
        { className: 'buka-workflows-drawerActions' },
        task === null ? null : renderSessionButton(page, task),
        h(
          'button',
          {
            type: 'button',
            className: 'buka-workflows-drawerClose',
            'aria-label': t('close'),
            title: t('close'),
            onClick: actions.closeTask,
          },
          h('span', { 'aria-hidden': true }, '×'),
        ),
      ),
    ),
    h('div', { className: 'buka-workflows-drawerBody' }, ...body),
  )
}

/**
 * 抽屉正文。
 *
 * @param page
 * @param task
 * @returns
 */
function renderTaskBody(page: AppContext, task: TaskDetail): React.ReactElement[] {
  const { t, state, actions } = page
  const positionLabel =
    typeof task.positionLabel === 'string' && task.positionLabel !== ''
      ? task.positionLabel
      : (task.position ?? '')
  const typeDefinition = taskTypeOf(state, task)
  const claimant = claimantName(task.claimant, t)
  const allowed = Array.isArray(task.allowedActions) ? task.allowedActions : []
  const human = isHumanTask(state, task)
  const canClaim = allowed.includes('claim') && task.status === 'ready'
  const canComplete = allowed.includes('complete')
  const showForm =
    human && (task.status === 'ready' || task.status === 'running') && allowed.length > 0

  const elements: React.ReactElement[] = []

  elements.push(
    renderKv([
      [t('taskPosition'), positionLabel === '' ? t('taskTypeUnset') : positionLabel],
      [t('taskType'), task.typeLabel ?? task.type ?? t('taskTypeUnset')],
      [t('taskStatus'), statusLabel(t, task.status)],
      [t('taskClaimant'), claimant === '' ? t('taskTypeUnset') : claimant],
      [t('taskCreatedAt'), formatTime(task.createdAt)],
      [t('taskStartedAt'), formatTime(task.startedAt)],
      [t('taskFinishedAt'), formatTime(task.finishedAt)],
      [
        t('taskTypeAssistant'),
        isRecord(typeDefinition) && typeof typeDefinition.assistant === 'string'
          ? typeDefinition.assistant
          : t('taskTypeUnset'),
      ],
    ]),
  )

  if (typeof task.typeDescription === 'string' && task.typeDescription !== '') {
    elements.push(
      h('p', { key: 'type-desc', className: 'buka-workflows-hint' }, task.typeDescription),
    )
  }

  // 依赖。
  const deps = Array.isArray(task.deps) ? task.deps : []
  elements.push(
    renderSection(
      t('taskDepsTitle'),
      deps.length === 0
        ? renderEmpty(t('taskDepsEmpty'))
        : h(
            'ul',
            { className: 'buka-workflows-depList' },
            ...deps.map((dep) =>
              h(
                'li',
                { key: dep.id, className: 'buka-workflows-depRow' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workflows-depLink',
                    onClick: () => actions.openTask(dep.id),
                  },
                  dep.typeLabel ?? dep.type ?? dep.id,
                ),
                renderStatusTag(t, dep.status, 'task'),
                dep.resultSummary === null || dep.resultSummary === undefined
                  ? null
                  : h('span', { className: 'buka-workflows-depSummary' }, dep.resultSummary),
              ),
            ),
          ),
    ),
  )

  // 输入。
  elements.push(
    renderSection(
      t('taskPayloadTitle'),
      renderJsonBlock(task.payload ?? null, t('taskPayloadEmpty')),
    ),
  )

  // 执行记录。
  const attempts = Array.isArray(task.attempts) ? task.attempts : []
  elements.push(
    renderSection(
      t('taskAttemptsTitle'),
      attempts.length === 0
        ? renderEmpty(t('taskAttemptsEmpty'))
        : h(
            'ul',
            { className: 'buka-workflows-attemptList' },
            ...attempts.map((attempt) => renderAttempt(page, attempt)),
          ),
    ),
  )

  // 结果。
  elements.push(renderSection(t('taskResultTitle'), renderTaskResult(page, task)))

  // 附件：结果附件已经包含在结果区；这里只做提示，避免重复区块。
  // 操作。
  const actionsList: React.ReactElement[] = []
  if (canClaim) {
    actionsList.push(
      h(
        Button,
        {
          key: 'claim',
          variant: 'primary',
          size: 'sm',
          className: 'buka-workflows-smallButton',
          onClick: () => actions.runTaskAction('claim'),
          disabled: state.taskForm.submitting,
        },
        t('actionClaim'),
      ),
    )
  }
  if (allowed.includes('retry')) {
    actionsList.push(
      h(
        Button,
        {
          key: 'retry',
          variant: 'outline',
          size: 'sm',
          className: 'buka-workflows-smallButton',
          onClick: () => actions.runTaskAction('retry'),
          disabled: state.taskForm.submitting,
        },
        t('actionRetry'),
      ),
    )
  }
  if (allowed.includes('cancel')) {
    actionsList.push(
      h(
        Button,
        {
          key: 'cancel',
          variant: 'outline',
          size: 'sm',
          className: 'buka-workflows-smallButton',
          onClick: () => {
            if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
              if (!window.confirm(t('actionCancelConfirm'))) return
            }
            void actions.runTaskAction('cancel')
          },
          disabled: state.taskForm.submitting,
        },
        t('actionCancel'),
      ),
    )
  }

  const actionBlock: React.ReactElement[] = []
  if (showForm) {
    actionBlock.push(
      renderSection(
        t('actionFormTitle'),
        h(
          'div',
          { className: 'buka-workflows-taskForm' },
          h('p', { className: 'buka-workflows-hint' }, t('actionFormHint')),
          ...renderTaskForm(page, task),
          h(
            'div',
            { className: 'buka-workflows-formActions' },
            ...actionsList,
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                className: 'buka-workflows-smallButton',
                onClick: () => actions.runTaskAction('complete'),
                disabled: state.taskForm.submitting || !canComplete,
              },
              state.taskForm.submitting ? t('actionSubmitting') : t('actionSubmitComplete'),
            ),
          ),
        ),
      ),
    )
  } else if (actionsList.length > 0) {
    actionBlock.push(
      renderSection(
        t('taskActionsTitle'),
        h('div', { className: 'buka-workflows-formActions' }, ...actionsList),
      ),
    )
  } else if (allowed.includes('complete')) {
    actionBlock.push(
      renderSection(
        t('taskActionsTitle'),
        h(
          'div',
          { className: 'buka-workflows-formActions' },
          h(
            Button,
            {
              variant: 'primary',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: () => actions.runTaskAction('complete'),
              disabled: state.taskForm.submitting,
            },
            t('actionSubmitComplete'),
          ),
        ),
      ),
    )
  } else {
    actionBlock.push(renderSection(t('taskActionsTitle'), renderEmpty(t('taskActionsEmpty'))))
  }
  elements.push(...actionBlock)

  // 结束任务：投递即完成；`payload` 就是最终交付物，单独强调。
  if (task.position === 'end') {
    elements.unshift(
      renderSection(
        t('finalDeliverableTitle'),
        renderJsonBlock(task.payload ?? null, t('taskPayloadEmpty')),
      ),
    )
  }
  // 会话入口：承办会话。
  if (typeof task.claimant?.sessionId === 'string' && task.claimant.sessionId !== '') {
    elements.unshift(
      h(
        'div',
        { key: 'session', className: 'buka-workflows-sessionBar' },
        h('span', { className: 'buka-workflows-label' }, t('sessionLabel')),
        h('code', { className: 'buka-workflows-inlineCode' }, task.claimant.sessionId),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-workflows-smallButton',
            onClick: () => void actions.openSession(task.claimant?.sessionId),
          },
          t('openSession'),
        ),
      ),
    )
  }

  return elements
}

/**
 * 执行记录的一行。
 *
 * @param page
 * @param attempt
 * @returns
 */
function renderAttempt(page: AppContext, attempt: Attempt): React.ReactElement {
  const { t, actions } = page
  const meta = [
    formatTime(attempt.startedAt),
    attempt.finishedAt === null || attempt.finishedAt === undefined
      ? ''
      : formatTime(attempt.finishedAt),
  ].filter((part) => part !== '')
  const error = attempt.error === null || attempt.error === undefined ? '' : jsonText(attempt.error)
  return h(
    'li',
    { key: attempt.id, className: 'buka-workflows-attempt' },
    h(
      'div',
      { className: 'buka-workflows-attemptHead' },
      h('code', { className: 'buka-workflows-inlineCode' }, attempt.id),
      renderStatusTag(t, attempt.status, 'task'),
      attempt.stopReason === null || attempt.stopReason === undefined
        ? null
        : h(
            'span',
            { className: 'buka-workflows-attemptMeta' },
            `${t('taskAttemptStopReason')}: ${String(attempt.stopReason)}`,
          ),
      h('span', { className: 'buka-workflows-attemptMeta' }, meta.join(' · ')),
    ),
    typeof attempt.sessionId === 'string' && attempt.sessionId !== ''
      ? h(
          'div',
          { className: 'buka-workflows-sessionRow' },
          h(
            'span',
            { className: 'buka-workflows-attemptMeta' },
            `${t('sessionLabel')}: ${attempt.sessionId}`,
          ),
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: () => void actions.openSession(attempt.sessionId),
            },
            t('openSession'),
          ),
        )
      : null,
    error === ''
      ? null
      : h('p', { className: 'buka-workflows-failure' }, `${t('taskAttemptError')}: ${error}`),
  )
}

/**
 * 结果区：文本 + 结构化产出 + 附件。
 *
 * @param page
 * @param task
 * @returns
 */
function renderTaskResult(page: AppContext, task: TaskDetail): React.ReactElement {
  const { t, actions } = page
  const result = isRecord(task.result) ? task.result : null
  if (result === null) return renderEmpty(t('taskResultEmpty'))
  const text = typeof result.text === 'string' ? result.text : ''
  const output = result.output
  const attachments = Array.isArray(result.attachments) ? result.attachments : []
  return h(
    'div',
    { className: 'buka-workflows-result' },
    text === ''
      ? null
      : renderSection(t('taskResultText'), h('pre', { className: 'buka-workflows-pre' }, text)),
    output === undefined || output === null
      ? null
      : renderSection(t('taskResultOutput'), renderJsonBlock(output, t('taskResultEmpty'))),
    attachments.length === 0
      ? null
      : renderSection(
          t('taskResultAttachments'),
          h(
            'ul',
            { className: 'buka-workflows-attachmentList' },
            ...attachments.map((attachment) => {
              const name =
                typeof attachment.name === 'string' ? attachment.name : String(attachment.id)
              return h(
                'li',
                { key: String(attachment.id), className: 'buka-workflows-attachment' },
                renderAttachmentLink(page, attachment, actions.openAttachment),
                h(
                  'span',
                  { className: 'buka-workflows-attachmentMeta' },
                  [formatBytes(attachment.bytes), attachment.mime].filter(Boolean).join(' · '),
                ),
                typeof attachment.description === 'string' && attachment.description !== ''
                  ? h(
                      'span',
                      { className: 'buka-workflows-attachmentDescription' },
                      attachment.description,
                    )
                  : null,
                h(
                  'a',
                  {
                    className: 'buka-workflows-attachmentDownload',
                    href: attachmentUrl(jobIdOf(page), attachment.id),
                    download: name,
                  },
                  t('attachmentDownload'),
                ),
              )
            }),
          ),
        ),
  )
}

/**
 * 任务抽屉头部右侧的会话入口（承办者会话）。
 *
 * @param page
 * @param task
 * @returns
 */
function renderSessionButton(page: AppContext, task: TaskDetail): React.ReactElement | null {
  const sessionId = task.claimant?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return null
  return h(
    Button,
    {
      variant: 'outline',
      size: 'sm',
      className: 'buka-workflows-smallButton',
      onClick: () => void page.actions.openSession(sessionId),
    },
    page.t('openSession'),
  )
}

/**
 * 当前作业 id。
 *
 * @param page
 * @returns
 */
function jobIdOf(page: AppContext): string {
  if (page.state.route.kind === 'job') return page.state.route.jobId
  return page.state.job.data?.job?.id ?? ''
}
