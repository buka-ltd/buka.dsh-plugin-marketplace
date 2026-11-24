/**
 * 任务抽屉：先回答「这个任务现在怎么样、要做什么」，技术细节收进折叠区。
 *
 * 头部是身份与状态；正文按「结果 → 操作 → 输入 → 依赖」排序，执行记录与
 * 类型 / 时间这类审计信息默认收起。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { MISSING_AVATAR_ID, renderAvatar } from '../avatars.ts'
import { ClientModal, h } from '../element.ts'
import { errorTextOf, formatBytes, formatTime } from '../format.ts'
import {
  currentDefinition,
  currentJobDefinition,
  isHumanTask,
  mergedDefinition,
  positionsOf,
  taskTypeOf,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import type { Attempt, JsonSchema, TaskDetail } from '../types.ts'
import { isRecord } from '../types.ts'
import {
  ConfirmButton,
  renderAttachmentLink,
  renderDrawerHead,
  renderEmpty,
  renderFailure,
  renderFold,
  renderKv,
  renderLoading,
  renderReadonlyValue,
  renderSection,
  renderStatusTag,
  renderTaskActor,
} from './parts.ts'
import { renderTaskForm } from './task-form.ts'

/** 任务详情抽屉。 */
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
    renderDrawerHead({
      title,
      avatar:
        task === null
          ? null
          : renderAvatar(executorAvatar(page, task), 28, 'buka-workflows-drawerAvatar'),
      tag: task === null ? null : renderStatusTag(t, task.status, 'task'),
      meta: task === null ? null : taskMeta(page, task),
      actions: task === null ? null : renderSessionButton(page, task),
      onClose: actions.closeTask,
      closeLabel: t('close'),
    }),
    h('div', { className: 'buka-workflows-drawerBody' }, ...body),
  )
}

/** 头部第二行：岗位 · 入站通道 · 代办 / 主体。 */
function taskMeta(page: AppContext, task: TaskDetail): string {
  const { t } = page
  const position = task.positionLabel ?? task.position ?? ''
  const channel =
    typeof task.channelLabel === 'string' && task.channelLabel !== ''
      ? `${t('taskChannel')}: ${task.channelLabel}`
      : ''
  return [position, channel, renderTaskActor(page, task)].filter((part) => part !== '').join(' · ')
}

/** 任务岗位对应的执行者头像。 */
function executorAvatar(page: AppContext, task: TaskDetail): string | undefined {
  if (task.position === undefined || task.position === '') return undefined
  const definition = mergedDefinition(
    currentJobDefinition(page.state),
    currentDefinition(page.state),
  )
  const position = positionsOf(definition).find((item) => item.id === task.position)
  if (position?.executor.missing === true) return MISSING_AVATAR_ID
  return typeof position?.executor.avatar === 'string' && position.executor.avatar !== ''
    ? position.executor.avatar
    : undefined
}

/** 抽屉正文。 */
function renderTaskBody(page: AppContext, task: TaskDetail): React.ReactElement[] {
  const { t, state } = page
  const typeDefinition = taskTypeOf(state, task)
  const allowed = Array.isArray(task.allowedActions) ? task.allowedActions : []
  const human = isHumanTask(state, task)
  const canComplete = allowed.includes('complete')
  const showForm =
    human && (task.status === 'ready' || task.status === 'running') && allowed.length > 0

  const elements: React.ReactElement[] = []

  if (showForm) {
    elements.push(renderFormSection(page, task, allowed, canComplete))
  }

  const isEnd = task.position === 'end'
  if (isEnd) elements.push(renderFinalDeliverable(page, task))

  const result = renderTaskResult(page, task)
  if (result !== null) elements.push(renderSection(t('taskResultTitle'), result))

  if (!showForm) {
    const actionsBlock = renderActionSection(page, allowed, canComplete)
    if (actionsBlock !== null) elements.push(actionsBlock)
  }

  if (!isEnd) {
    const contentSchema = isRecord(typeDefinition?.content)
      ? (typeDefinition.content as JsonSchema)
      : null
    elements.push(
      renderSection(
        t('taskContentTitle'),
        h(
          'div',
          { className: 'buka-workflows-contentCard' },
          renderReadonlyValue(page, contentSchema, task.content ?? null, t('taskContentEmpty'), {
            markdown: true,
          }),
        ),
      ),
    )
  }

  const deps = Array.isArray(task.deps) ? task.deps : []
  if (deps.length > 0) {
    elements.push(
      renderSection(
        t('taskDepsTitle'),
        h(
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
                  onClick: () => page.actions.openTask(dep.id),
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
  }

  const attempts = Array.isArray(task.attempts) ? task.attempts : []
  elements.push(
    renderFold(
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

  elements.push(renderFold(t('taskDetailsTitle'), renderTaskDetails(page, task)))

  return elements
}

/** 人任务的填写表单：先选动作，再按动作的表单填，最后提交。 */
function renderFormSection(
  page: AppContext,
  task: TaskDetail,
  allowed: string[],
  canComplete: boolean,
): React.ReactElement {
  const { t, state, actions } = page
  const typeDefinition = taskTypeOf(state, task)
  const actionList = Array.isArray(typeDefinition?.actions) ? typeDefinition.actions : []
  const selected = actionList.find((action) => action.id === state.taskForm.action) ?? null
  const inputSchema = isRecord(selected?.input) ? (selected.input as Record<string, unknown>) : null
  const hasActions = actionList.length > 0
  return renderSection(
    t('actionFormTitle'),
    h(
      'div',
      { className: 'buka-workflows-taskForm' },
      h(
        'p',
        { className: 'buka-workflows-sectionHint' },
        hasActions ? t('actionFormHint') : t('actionFormNoActions'),
      ),
      hasActions
        ? h(
            'div',
            { className: 'buka-workflows-actionRow' },
            ...actionList.map((action) =>
              h(
                Button,
                {
                  key: String(action.id ?? action.label),
                  variant: state.taskForm.action === action.id ? 'primary' : 'outline',
                  size: 'sm',
                  className: 'buka-workflows-smallButton',
                  onClick: () => actions.selectTaskAction(String(action.id ?? '')),
                  disabled: state.taskForm.submitting,
                },
                action.label ?? String(action.id ?? ''),
              ),
            ),
          )
        : null,
      ...renderTaskForm(page, task, inputSchema),
      h(
        'div',
        { className: 'buka-workflows-formActions' },
        ...actionButtons(page, allowed),
        h(
          Button,
          {
            variant: 'primary',
            size: 'sm',
            className: 'buka-workflows-smallButton',
            onClick: () => void actions.runTaskAction('complete'),
            disabled: state.taskForm.submitting || !canComplete,
          },
          state.taskForm.submitting
            ? t('actionSubmitting')
            : state.taskForm.action === null
              ? t('actionSubmitCompleteOnly')
              : t('actionSubmitAction'),
        ),
      ),
    ),
  )
}

/** 非表单任务的操作区；没有可用动作时整块不出现。 */
function renderActionSection(
  page: AppContext,
  allowed: string[],
  canComplete: boolean,
): React.ReactElement | null {
  const { t, state, actions } = page
  const buttons = actionButtons(page, allowed)
  if (canComplete) {
    buttons.push(
      h(
        Button,
        {
          key: 'complete',
          variant: 'primary',
          size: 'sm',
          className: 'buka-workflows-smallButton',
          onClick: () => void actions.runTaskAction('complete'),
          disabled: state.taskForm.submitting,
        },
        t('actionSubmitComplete'),
      ),
    )
  }
  if (buttons.length === 0) return null
  return renderSection(
    t('taskActionsTitle'),
    h('div', { className: 'buka-workflows-formActions' }, ...buttons),
  )
}

/**
 * 重试 / 取消；表单和操作区共用。
 *
 * 人任务不再有独立的「认领」按钮：就绪任务直接提交，服务端在提交时自动认领。
 */
function actionButtons(page: AppContext, allowed: string[]): React.ReactElement[] {
  const { t, state, actions } = page
  const buttons: React.ReactElement[] = []
  if (allowed.includes('retry')) {
    buttons.push(
      h(
        Button,
        {
          key: 'retry',
          variant: 'outline',
          size: 'sm',
          className: 'buka-workflows-smallButton',
          onClick: () => void actions.runTaskAction('retry'),
          disabled: state.taskForm.submitting,
        },
        t('actionRetry'),
      ),
    )
  }
  if (allowed.includes('cancel')) {
    buttons.push(
      h(ConfirmButton, {
        key: 'cancel',
        label: t('actionCancel'),
        confirmLabel: t('actionCancelConfirmAction'),
        cancelLabel: t('cancel'),
        confirmText: t('actionCancelConfirm'),
        onConfirm: () => void actions.runTaskAction('cancel'),
        disabled: state.taskForm.submitting,
      }),
    )
  }
  return buttons
}

/** 结束任务的交付物：置顶，并跳过重复的「任务输入」。 */
function renderFinalDeliverable(page: AppContext, task: TaskDetail): React.ReactElement {
  const { t, state } = page
  const endSchema = currentJobDefinition(state)?.end?.content
  return renderSection(
    t('finalDeliverableTitle'),
    h(
      'div',
      { className: 'buka-workflows-deliverable' },
      renderReadonlyValue(
        page,
        isRecord(endSchema) ? (endSchema as JsonSchema) : null,
        task.content ?? null,
        t('taskContentEmpty'),
        { markdown: true },
      ),
    ),
  )
}

/** 执行记录的一行。 */
function renderAttempt(page: AppContext, attempt: Attempt): React.ReactElement {
  const { t, actions } = page
  const meta = [
    formatTime(attempt.startedAt),
    attempt.finishedAt === null || attempt.finishedAt === undefined
      ? ''
      : formatTime(attempt.finishedAt),
  ].filter((part) => part !== '')
  const error = errorTextOf(attempt.error)
  return h(
    'li',
    { key: attempt.id, className: 'buka-workflows-attempt' },
    h(
      'div',
      { className: 'buka-workflows-attemptHead' },
      renderStatusTag(t, attempt.status, 'task'),
      attempt.stopReason === null || attempt.stopReason === undefined
        ? null
        : h(
            'span',
            { className: 'buka-workflows-attemptMeta' },
            `${t('taskAttemptStopReason')}: ${String(attempt.stopReason)}`,
          ),
      h('span', { className: 'buka-workflows-attemptMeta' }, meta.join(' · ')),
      typeof attempt.sessionId === 'string' && attempt.sessionId !== ''
        ? h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: () => void actions.openSession(attempt.sessionId as string),
            },
            t('openSession'),
          )
        : null,
    ),
    typeof attempt.sessionId === 'string' && attempt.sessionId !== ''
      ? h(
          'span',
          { className: 'buka-workflows-attemptMeta' },
          `${t('sessionLabel')}: ${attempt.sessionId}`,
        )
      : null,
    error === ''
      ? null
      : h('p', { className: 'buka-workflows-failure' }, `${t('taskAttemptError')}: ${error}`),
  )
}

/** 结果区：说明 + 结构化产出 + 附件。 */
function renderTaskResult(page: AppContext, task: TaskDetail): React.ReactElement | null {
  const { t, actions } = page
  const result = isRecord(task.result) ? task.result : null
  if (result === null) return null
  const text = typeof result.text === 'string' ? result.text : ''
  const action = isRecord(result.action) ? result.action : null
  const input = result.input
  const attachments = Array.isArray(result.attachments) ? result.attachments : []
  const blocks: React.ReactNode[] = []
  if (action !== null && typeof action.label === 'string') {
    blocks.push(
      h(
        'p',
        { key: 'action', className: 'buka-workflows-resultMeta' },
        `${t('taskResultAction')}: ${action.label}`,
      ),
    )
  }
  if (text !== '') {
    blocks.push(h('p', { key: 'text', className: 'buka-workflows-resultText' }, text))
  }
  if (input !== undefined && input !== null) {
    blocks.push(
      resultBlock(
        t('taskResultInput'),
        h(
          'div',
          { className: 'buka-workflows-contractBody' },
          renderReadonlyValue(page, null, input, t('taskResultEmpty')),
        ),
      ),
    )
  }
  if (attachments.length > 0) {
    blocks.push(
      resultBlock(
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
  if (blocks.length === 0) return null
  return h('div', { className: 'buka-workflows-result' }, ...blocks)
}

/** 结果里的一个子块：小标签 + 内容。 */
function resultBlock(label: string, content: React.ReactNode): React.ReactElement {
  return h(
    'div',
    { className: 'buka-workflows-resultBlock' },
    h('span', { className: 'buka-workflows-subLabel' }, label),
    content,
  )
}

/** 折叠区里的审计信息：类型 ID、通道与三个时间点。 */
function renderTaskDetails(page: AppContext, task: TaskDetail): React.ReactElement {
  const { t } = page
  const rows: Array<[string, React.ReactNode]> = []
  if (typeof task.type === 'string' && task.type !== '') {
    rows.push([t('taskType'), h('code', { className: 'buka-workflows-inlineCode' }, task.type)])
  }
  if (typeof task.channel === 'string' && task.channel !== '') {
    rows.push([
      t('taskChannel'),
      h('code', { className: 'buka-workflows-inlineCode' }, task.channel),
    ])
  }
  rows.push([t('taskCreatedAt'), formatTime(task.createdAt)])
  if (task.startedAt !== null && task.startedAt !== undefined) {
    rows.push([t('taskStartedAt'), formatTime(task.startedAt)])
  }
  if (task.finishedAt !== null && task.finishedAt !== undefined) {
    rows.push([t('taskFinishedAt'), formatTime(task.finishedAt)])
  }
  return renderKv(rows)
}

/** 任务抽屉头部右侧的会话入口（承办者会话）。 */
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

/** 当前作业 id。 */
function jobIdOf(page: AppContext): string {
  if (page.state.route.kind === 'job') return page.state.route.jobId
  return page.state.job.data?.job?.id ?? ''
}
