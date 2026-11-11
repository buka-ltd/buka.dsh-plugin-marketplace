/**
 * 运行详情的节点抽屉内容。
 */

import {
  Button,
  IconCloseOutlineRegular,
  IconNewChatOutlineRegular,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { RunGraphNode } from '../../graph.ts'
import type { WorkflowRunRecord } from '../../run-store.ts'
import { renderAvatar } from '../avatars.ts'
import { renderAttachments } from '../components/attachments.ts'
import { h } from '../element.ts'
import { formatMs, statusLabel, statusTone, truncateText } from '../format.ts'
import {
  collectNodeSessionIds,
  definitionNode,
  kvRow,
  nodeTitle,
  stateClass,
  typeLabel,
  typeTone,
} from '../node-model.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientDefinition, ClientGraph, ClientStep } from '../types.ts'

/**
 * 节点抽屉的内容：节点配置与按执行拆开的 Tab（输入 / 输出 / 会话 / 下一步）。
 *
 * @param node
 * @param definition
 * @param graph
 * @param steps
 * @param fullResults
 * @param run 运行记录
 * @param [onClose] 关闭抽屉的回调
 * @returns React 元素
 */
export function renderNodePanel(
  page: PageContext,
  node: RunGraphNode | null,
  definition: ClientDefinition | null,
  graph: ClientGraph | null,
  steps: ClientStep[],
  fullResults: Map<string, Record<string, unknown>>,
  run: WorkflowRunRecord | null,
  onClose: (() => void) | null = null,
): React.ReactElement {
  const {
    t,
    executionIndex,
    setExecutionIndex,
    openAttachment,
    openSession,
    focusExecution,
    renderExecution,
  } = page

  if (node === null) return h('p', { className: 'buka-workflows-hint' }, t('nodeNotRun'))
  const config = definitionNode(definition, node.id)
  const nodeSteps = steps.filter((step) => step.nodeId === node.id)
  const state = typeof node.state === 'string' ? node.state : 'idle'
  const rows = []
  if (node.type === 'robot') {
    rows.push(kvRow(t('nodeExecutor'), node.robot || '—'))
    if (typeof node.timeoutMs === 'number')
      rows.push(kvRow(t('nodeTimeout'), formatMs(node.timeoutMs) || '—'))
    if (typeof node.maxVisits === 'number')
      rows.push(kvRow(t('nodeMaxVisits'), String(node.maxVisits)))
  } else if (node.type === 'user') {
    rows.push(kvRow(t('typeUser'), node.title || '—'))
    // 说明优先展示等待中的那一次（模板已经渲染过），其次是定义快照里的模板，
    // 最后退回执行记录里落盘的输入。
    const pendingUser =
      run !== null &&
      typeof run === 'object' &&
      run.pendingUser !== null &&
      typeof run.pendingUser === 'object'
        ? run.pendingUser
        : null
    let detail = ''
    if (
      pendingUser !== null &&
      pendingUser.nodeId === node.id &&
      typeof pendingUser.detail === 'string'
    ) {
      detail = pendingUser.detail
    }
    if (detail === '' && typeof config?.detail === 'string') detail = config.detail
    if (detail === '' && typeof node.detail === 'string') detail = node.detail
    if (detail === '') {
      const lastUserStep = nodeSteps.filter((step) => step.type === 'user').pop()
      if (typeof lastUserStep?.input === 'string') detail = lastUserStep.input
    }
    const detailText = detail.trim()
    if (detailText !== '') rows.push(kvRow(t('userDetail'), detailText))
  } else if (node.type === 'end') {
    rows.push(kvRow(t('nodeEndStatus'), statusLabel(t, node.endStatus ?? 'completed')))
  }
  const template = truncateText(config?.prompt, 4000)
  const isStart = node.type === 'start'
  const title = isStart ? t('typeStart') : nodeTitle(node, config)
  const actives =
    run !== null && Array.isArray(run.active)
      ? run.active.filter((entry) => entry !== null && typeof entry === 'object')
      : run !== null &&
          typeof run === 'object' &&
          run.current !== null &&
          typeof run.current === 'object'
        ? [run.current]
        : []
  const current = actives.find((entry) => entry.nodeId === node.id) ?? null
  // 机器人会话在进入节点后、执行结束前就会落到 run.active（旧记录 run.current）上，
  // 所以运行中的节点也能看到并打开当前会话；它也是这个节点优先展示的会话。
  const isLiveNode = current !== null && current.nodeId === node.id
  const liveSession = isLiveNode && typeof current.sessionId === 'string' ? current.sessionId : ''
  // 节点级只展示一次会话：正常情况一个节点只有一个会话；旧记录里一个节点可能
  // 在几个会话中执行过，需要逐个列出才能打开每一段历史。
  const nodeSessionIds = collectNodeSessionIds(node, nodeSteps, liveSession, run)
  // 运行中的节点还没有 durationMs，直接用 startedAt 算实时耗时；页面 tick 会
  // 重渲染，所以这个数字会走。已结束的节点继续用 durationMs。
  const liveStartedAt =
    isLiveNode && typeof current.startedAt === 'number' && Number.isFinite(current.startedAt)
      ? current.startedAt
      : null
  const liveDuration = liveStartedAt === null ? '' : formatMs(Date.now() - liveStartedAt)
  const duration = liveDuration !== '' ? liveDuration : formatMs(node.durationMs)
  // 恢复中的运行在节点标题旁标出第几次恢复尝试。
  const recoveryAttempts =
    isLiveNode &&
    typeof current.recoveryAttempts === 'number' &&
    Number.isFinite(current.recoveryAttempts)
      ? current.recoveryAttempts
      : 1
  const recoveringText =
    isLiveNode && current.recovering === true
      ? String(t('sessionRecovering')).replace('{n}', String(recoveryAttempts))
      : ''

  // 终止节点自己不执行、没有输出；它代表整个运行结束，所以这里展示这次运行
  // 最后交出来的机器人正文或附件（按 seq 找最后一次有文本或附件的机器人
  // 执行），而不是定义里写死的说明文字。来源节点 + 第几次执行可以点回去。
  let finalStep: ClientStep | null = null
  let finalText = ''
  let finalAttachments: Array<Record<string, unknown>> = []
  if (node.type === 'end' && node.state !== 'idle') {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const candidate = steps[index]
      if (candidate === undefined || candidate.type !== 'robot') continue
      const full = fullResults.get(`${String(candidate.seq)}:${candidate.nodeId}`) ?? null
      const text =
        typeof full?.text === 'string' && full.text !== ''
          ? full.text
          : typeof candidate.text === 'string'
            ? candidate.text
            : ''
      const attachments = Array.isArray(full?.attachments)
        ? full.attachments
        : Array.isArray(candidate.attachments)
          ? candidate.attachments
          : []
      if (text === '' && attachments.length === 0) continue
      finalStep = candidate
      finalText = text
      finalAttachments = attachments
      break
    }
  }
  const finalNode =
    finalStep === null
      ? null
      : ((Array.isArray(graph?.nodes) ? graph.nodes : []).find(
          (item) => item?.id === finalStep.nodeId,
        ) ?? null)
  const finalTitle =
    finalStep === null
      ? ''
      : finalNode === null
        ? finalStep.nodeId
        : nodeTitle(finalNode, definitionNode(definition, finalStep.nodeId))
  const finalVisit = finalStep !== null && typeof finalStep.visit === 'number' ? finalStep.visit : 1

  // 每次执行一个 Tab：输入是那一次的渲染后提示词，输出是那一次交付的正文。
  const activeIndex =
    nodeSteps.length === 0
      ? -1
      : executionIndex === null
        ? nodeSteps.length - 1
        : Math.min(Math.max(executionIndex, 0), nodeSteps.length - 1)
  const activeStep = activeIndex === -1 ? null : (nodeSteps[activeIndex] ?? null)
  const activeFull =
    activeStep === null
      ? null
      : (fullResults.get(`${String(activeStep.seq)}:${String(activeStep.nodeId)}`) ?? null)
  const executions =
    nodeSteps.length === 0 || activeStep === null
      ? h('p', { className: 'buka-workflows-hint' }, t('nodeNotRun'))
      : h(
          'div',
          { className: 'buka-workflows-executions' },
          h(
            'div',
            {
              className: 'buka-workflows-tabs',
              role: 'tablist',
              'aria-label': t('nodeExecutions'),
            },
            ...nodeSteps.map((step, index) => {
              const visit = typeof step.visit === 'number' ? step.visit : index + 1
              return h(
                'button',
                {
                  key: `${String(step.seq)}-${String(step.nodeId)}`,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': index === activeIndex,
                  className: `buka-workflows-tab${index === activeIndex ? ' is-active' : ''}`,
                  title: `${t('execution')} ${visit} · ${statusLabel(t, step.status)}`,
                  onClick: () => setExecutionIndex(index),
                },
                h('span', {
                  className: `buka-workflows-tabDot is-${stateClass(step.status)}`,
                  'aria-hidden': true,
                }),
                `#${visit}`,
              )
            }),
          ),
          renderExecution(
            activeStep,
            activeFull,
            config,
            node,
            steps,
            definition,
            graph,
            run,
            nodeSessionIds,
          ),
        )

  // 节点级只展示一次会话：只有一个会话时是一个「打开会话」入口；旧记录里有多个
  // 会话时逐个列出，并说明这是旧记录，避免历史会话没有入口。
  const sessionBar =
    node.type !== 'robot' || nodeSessionIds.length === 0
      ? null
      : h(
          'div',
          { className: 'buka-workflows-sessionBar' },
          h('span', { className: 'buka-workflows-label' }, t('nodeSession')),
          nodeSessionIds.length === 1
            ? [
                h(
                  'code',
                  { key: 'session', className: 'buka-workflows-inlineCode' },
                  nodeSessionIds[0],
                ),
                liveSession !== '' ? h(Tag, { key: 'live', tone: 'info' }, t('sessionLive')) : null,
                h(
                  Button,
                  {
                    key: 'open',
                    variant: 'outline',
                    size: 'sm',
                    className: 'buka-workflows-smallButton',
                    icon: h(IconNewChatOutlineRegular, { size: 13 }),
                    onClick: () => openSession({ sessionId: nodeSessionIds[0] }),
                  },
                  t('openSession'),
                ),
              ]
            : [
                h(
                  'span',
                  { key: 'hint', className: 'buka-workflows-hint' },
                  t('nodeSessionsLegacy'),
                ),
                h(
                  'span',
                  { key: 'list', className: 'buka-workflows-sessionList' },
                  ...nodeSessionIds.map((sessionId) =>
                    h(
                      'span',
                      { key: sessionId, className: 'buka-workflows-sessionRow' },
                      h('code', { className: 'buka-workflows-inlineCode' }, sessionId),
                      sessionId === liveSession ? h(Tag, { tone: 'info' }, t('sessionLive')) : null,
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
                  ),
                ),
              ],
        )

  return h(
    'div',
    { className: 'buka-workflows-inspector', role: 'region', 'aria-label': t('inspector') },
    h(
      'div',
      { className: 'buka-workflows-inspectorHead' },
      renderAvatar(node.avatar, 22, 'buka-workflows-inspectorAvatar'),
      h('span', { className: 'buka-workflows-inspectorTitle' }, title),
      title === node.id ? null : h('code', { className: 'buka-workflows-inspectorId' }, node.id),
      node.id === graph?.start ? h(Tag, { tone: 'neutral' }, t('nodeStart')) : null,
      isStart ? null : h(Tag, { tone: typeTone(node.type) }, typeLabel(t, node.type)),
      node.type === 'robot' && node.mode === 'plan'
        ? h(Tag, { tone: 'info' }, t('modePlan'))
        : null,
      isStart ? null : h(Tag, { tone: statusTone(state) }, statusLabel(t, state)),
      recoveringText === '' ? null : h(Tag, { tone: 'warning' }, recoveringText),
      node.visits > 1 ? h('span', { className: 'buka-workflows-meta' }, `×${node.visits}`) : null,
      duration === '' ? null : h('span', { className: 'buka-workflows-meta' }, duration),
      onClose === null
        ? null
        : h(
            'button',
            {
              type: 'button',
              className: 'buka-workflows-inspectorClose buka-workflows-drawerClose',
              'aria-label': t('close'),
              title: t('close'),
              onClick: onClose,
            },
            h(IconCloseOutlineRegular, { size: 16 }),
          ),
    ),
    rows.length === 0 ? null : h('div', { className: 'buka-workflows-kv' }, ...rows),
    sessionBar,
    isStart ? h('p', { className: 'buka-workflows-hint' }, t('startNodeHint')) : null,
    node.type === 'end' && node.state !== 'idle'
      ? h(
          'div',
          { className: 'buka-workflows-inspectorSection' },
          h('span', { className: 'buka-workflows-label' }, t('finalDeliverable')),
          finalStep === null
            ? h('p', { className: 'buka-workflows-hint' }, t('finalDeliverableEmpty'))
            : finalText === ''
              ? h('p', { className: 'buka-workflows-hint' }, t('executionOutputAttachmentsOnly'))
              : h('pre', { className: 'buka-workflows-pre' }, finalText),
          finalStep === null
            ? null
            : renderAttachments(t, run, finalStep, finalAttachments, openAttachment),
          finalStep === null
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'buka-workflows-nextLink',
                  title: `${finalTitle} #${String(finalVisit)}`,
                  onClick: () => focusExecution(finalStep.nodeId, finalStep.seq),
                },
                h('span', { className: 'buka-workflows-nextArrow', 'aria-hidden': true }, '←'),
                h(
                  'span',
                  { className: 'buka-workflows-nextTitle' },
                  `${t('finalDeliverableFrom')} ${finalTitle}`,
                ),
                h('span', { className: 'buka-workflows-nextVisit' }, `#${String(finalVisit)}`),
              ),
        )
      : null,
    node.unreachable === true
      ? h('p', { className: 'buka-workflows-hint' }, t('nodeUnreachable'))
      : null,
    nodeSteps.length === 0 && template.text !== ''
      ? h(
          'div',
          { className: 'buka-workflows-inspectorSection' },
          h('span', { className: 'buka-workflows-label' }, t('nodePrompt')),
          h('pre', { className: 'buka-workflows-pre' }, template.text),
          template.truncated
            ? h('p', { className: 'buka-workflows-hint' }, t('promptTruncated'))
            : null,
        )
      : null,
    node.type === 'end' || isStart
      ? null
      : h(
          'div',
          { className: 'buka-workflows-inspectorSection' },
          h('span', { className: 'buka-workflows-label' }, t('nodeExecutions')),
          executions,
        ),
  )
}
