/**
 * 作业概览：需求 / 输入、结构化输入、最终交付物与启动信息。
 *
 * 概览只回答「这次作业要做什么、交出了什么、谁启动的」；进度看实时流程，
 * 任务看板看任务，资产看文件。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

import { h } from '../element.ts'
import { errorTextOf, formatBytes, formatTime } from '../format.ts'
import { fill } from '../i18n.ts'
import {
  currentDefinition,
  currentJobDefinition,
  deliveryIdentity,
  endTaskSummary,
  isWorkerMissing,
  jobSummary,
  jobTasks,
  mergedDefinition,
  workerIdentity,
  workerIdentityText,
} from '../model.ts'
import type { AppContext } from '../page-context.ts'
import { attachmentUrl } from '../request.ts'
import type { AttachmentMeta, JsonSchema, TaskDetail } from '../types.ts'
import { isRecord } from '../types.ts'
import {
  renderAttachmentLink,
  renderEmpty,
  renderKv,
  renderReadonlyValue,
  renderSection,
  renderStatusTag,
} from './parts.ts'

/** 作业概览视图。 */
export function renderJobOverview(page: AppContext): React.ReactElement {
  const { t, state, actions } = page
  const job = state.job.data?.job
  if (job === undefined) return renderEmpty(t('notFound'))
  const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state))
  const tasks = jobTasks(state)
  const input = job.input ?? {}
  const starter = isRecord(job.starter) ? job.starter : null
  const endTask = endTaskSummary(tasks)
  const finalTask = state.finalTask
  const endSchema = isRecord(definition?.end?.content) ? definition?.end?.content : null
  const startSchema = isRecord(definition?.start?.content) ? definition?.start?.content : null
  const restartedFrom =
    typeof job.restartedFrom === 'string' && job.restartedFrom !== '' ? job.restartedFrom : null
  const sourceJob = jobSummary(state.workflow.data, restartedFrom)
  const restartCount = typeof job.restartCount === 'number' ? job.restartCount : 0
  const workflowId =
    typeof job.workflowId === 'string' && job.workflowId !== ''
      ? job.workflowId
      : state.route.kind === 'job'
        ? state.route.workflowId
        : ''

  const starterRows: Array<[string, string]> = [
    [
      t('overviewWorkflow'),
      `${job.workflowName ?? job.workflowId ?? ''}${
        typeof job.workflowVersion === 'number' ? ` · v${job.workflowVersion}` : ''
      }`,
    ],
    [
      t('starter'),
      starter === null
        ? t('taskTypeUnset')
        : starter.kind === 'session'
          ? t('starterSession')
          : t('starterHuman'),
    ],
    [
      t('overviewDelivery'),
      job.delivery?.kind === 'assistant'
        ? `${t('newJobDeliveryAssistant')} · ${workerIdentityText(deliveryIdentity(job.delivery))}${
            job.delivery.missing === true ||
            isWorkerMissing(state, workerIdentity(deliveryIdentity(job.delivery)).id)
              ? ` · ${t('workerDeleted')}`
              : ''
          }`
        : t('newJobDeliveryStarter'),
    ],
    [t('jobCreatedAt'), formatTime(job.createdAt)],
    [t('jobUpdatedAt'), formatTime(job.updatedAt)],
  ]
  if (restartCount > 0) starterRows.push([t('restartCount'), String(restartCount)])
  if (restartedFrom !== null) {
    starterRows.push([
      t('restartSource'),
      typeof sourceJob?.seq === 'number'
        ? fill(t, 'restartSourceJob', { seq: sourceJob.seq })
        : restartedFrom,
    ])
  }

  return h(
    'div',
    { className: 'buka-workflows-overview' },
    renderSection(
      t('overviewRequirement'),
      h(
        'div',
        { className: 'buka-workflows-overviewCard' },
        renderReadonlyValue(
          page,
          isRecord(startSchema) ? (startSchema as JsonSchema) : null,
          input,
          t('overviewRequirementEmpty'),
        ),
      ),
    ),
    renderSection(
      t('overviewFinal'),
      renderFinalDeliverable(
        page,
        finalTask.data,
        finalTask.status,
        endTask?.id ?? null,
        endSchema,
      ),
      endTask === null
        ? h('span', { className: 'buka-workflows-hint' }, t('overviewFinalEmpty'))
        : h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              onClick: () => actions.openTask(endTask.id),
            },
            t('overviewOpenFinalTask'),
          ),
    ),
    renderSection(
      t('overviewStarter'),
      h(
        'div',
        { className: 'buka-workflows-overviewCard' },
        renderKv(starterRows),
        restartedFrom !== null && workflowId !== ''
          ? h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                className: 'buka-workflows-smallButton',
                onClick: () => actions.openJob(workflowId, restartedFrom),
              },
              t('restartSourceOpen'),
            )
          : null,
        starter !== null &&
          starter.kind === 'session' &&
          typeof starter.sessionId === 'string' &&
          starter.sessionId !== ''
          ? h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                className: 'buka-workflows-smallButton',
                onClick: () => void actions.openSession(starter.sessionId),
              },
              t('openStarterSession'),
            )
          : null,
      ),
    ),
    job.error === null || job.error === undefined || job.error === ''
      ? null
      : renderSection(
          t('jobErrorTitle'),
          h('p', { className: 'buka-workflows-failure', role: 'alert' }, errorTextOf(job.error)),
        ),
  )
}

/** 最终交付物内容。 */
function renderFinalDeliverable(
  page: AppContext,
  task: TaskDetail | null,
  status: string,
  endTaskId: string | null,
  schema: unknown,
): React.ReactElement {
  const { t, actions } = page
  if (endTaskId === null)
    return h('p', { className: 'buka-workflows-hint' }, t('overviewFinalEmpty'))
  if (task === null && (status === 'loading' || status === 'idle')) {
    return h('p', { className: 'buka-workflows-hint' }, t('loading'))
  }
  if (task === null) {
    return h('p', { className: 'buka-workflows-hint' }, t('overviewFinalPending'))
  }
  const result = isRecord(task.result) ? task.result : null
  const text = typeof result?.text === 'string' ? result.text : ''
  const attachments = Array.isArray(result?.attachments) ? result.attachments : []
  const payloadSchema = isRecord(schema) ? (schema as JsonSchema) : null
  return h(
    'div',
    { className: 'buka-workflows-overviewCard buka-workflows-finalCard' },
    h(
      'div',
      { className: 'buka-workflows-finalHead' },
      renderStatusTag(t, task.status, 'task'),
      typeof task.positionLabel === 'string' && task.positionLabel !== ''
        ? h('span', { className: 'buka-workflows-hint' }, task.positionLabel)
        : null,
    ),
    renderReadonlyValue(page, payloadSchema, task.content ?? null, t('overviewFinalPending')),
    text === '' ? null : h('pre', { className: 'buka-workflows-pre' }, text),
    attachments.length === 0
      ? null
      : h(
          'ul',
          { className: 'buka-workflows-attachmentList' },
          ...attachments.map((attachment: AttachmentMeta) => {
            const name = attachment.name
            const jobId = page.state.route.kind === 'job' ? page.state.route.jobId : ''
            return h(
              'li',
              { key: attachment.id, className: 'buka-workflows-attachment' },
              renderAttachmentLink(page, attachment, actions.openAttachment),
              h(
                'span',
                { className: 'buka-workflows-attachmentMeta' },
                formatBytes(attachment.bytes),
              ),
              h(
                'a',
                {
                  className: 'buka-workflows-attachmentDownload',
                  href: attachmentUrl(jobId, attachment.id),
                  download: name,
                },
                t('attachmentDownload'),
              ),
            )
          }),
        ),
  )
}
