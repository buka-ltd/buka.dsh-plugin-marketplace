/**
 * 一次执行的 Tab 内容：输入、输出、附件、会话与前后步骤。
 */

import { Button, IconNewChatOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { RunGraphNode } from '../../graph.ts'
import type { WorkflowRunRecord } from '../../run-store.ts'
import { renderAttachments } from '../components/attachments.ts'
import { h } from '../element.ts'
import { formatDuration, formatTime, statusLabel, statusTone } from '../format.ts'
import { definitionNode, nodeTitle, routeText } from '../node-model.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientDefinition, ClientGraph, ClientNode, ClientStep } from '../types.ts'

/**
 * 一次执行的 Tab 内容：当次输入（渲染后的提示词）、当次输出、会话，以及这次
 * 执行把运行带到了哪个节点的哪一次执行（点一下就能跳过去）。
 *
 * @param step
 * @param full 落盘的节点结果全文（旧记录可能没有）
 * @param config 定义快照里的节点
 * @param node 图模型里的节点
 * @param steps 整个运行按顺序记下的所有执行
 * @param definition 定义快照（下一步要拿目标节点的步骤概要）
 * @param graph 图模型（同上）
 * @param run 运行记录（最后一步用它找到终止节点）
 * @param [nodeSessionIds] 节点级已经展示过的会话 id（这里不再重复）
 * @returns React 元素
 */
export function renderExecution(
  page: PageContext,
  step: ClientStep,
  full: Record<string, unknown> | null,
  config: ClientNode | null,
  node: RunGraphNode,
  steps: ClientStep[],
  definition: ClientDefinition | null,
  graph: ClientGraph | null,
  run: WorkflowRunRecord | null,
  nodeSessionIds: string[] = [],
): React.ReactElement {
  const { t, openAttachment, openSession, focusExecution } = page

  const visit = typeof step.visit === 'number' ? step.visit : 1
  // 这次执行选中的边名字（机器人由结果里的 next 决定，用户由选中的选项决定）；
  // 只作为标签展示，不把整份 JSON 铺成 key/value。
  const route = typeof step.route === 'string' ? step.route.trim() : ''
  // 每次进入的输入优先用那次落盘的渲染后 prompt。定义里的 prompt 只属于第一次
  // 进入节点时那条边，所以 visit > 1 又没有落盘 prompt 时不能再拿它冒充这次输入。
  let promptText = typeof full?.prompt === 'string' && full.prompt !== '' ? full.prompt : ''
  let inputMissing = false
  if (node.type === 'user') {
    // 用户节点没有 prompt：输入就是渲染后的说明（step.input），等待中的那次
    // 取 run.pendingUser.detail / title；旧记录退回定义快照里的 detail / title。
    const stepInput = typeof step.input === 'string' ? step.input.trim() : ''
    const pending =
      run !== null &&
      typeof run === 'object' &&
      run.pendingUser !== null &&
      typeof run.pendingUser === 'object' &&
      run.pendingUser.nodeId === node.id &&
      run.pendingUser.visit === visit
        ? run.pendingUser
        : null
    const pendingText =
      typeof pending?.detail === 'string' && pending.detail !== ''
        ? pending.detail
        : typeof pending?.title === 'string'
          ? pending.title
          : ''
    const detail = typeof config?.detail === 'string' ? config.detail : ''
    const title = typeof config?.title === 'string' ? config.title : ''
    promptText =
      stepInput !== ''
        ? stepInput
        : pendingText !== ''
          ? pendingText
          : detail !== ''
            ? detail
            : title
  } else if (promptText === '') {
    if (visit === 1) promptText = typeof config?.prompt === 'string' ? config.prompt : ''
    else inputMissing = true
  }
  const stepText = typeof step.text === 'string' ? step.text : ''
  const fullText = typeof full?.text === 'string' ? full.text : ''
  // 用户节点的输出就是答案文本（step.text）；不再有批准 / 拒绝的 decision。
  const outputText = fullText !== '' ? fullText : stepText
  const attachments = Array.isArray(full?.attachments)
    ? full.attachments
    : Array.isArray(step.attachments)
      ? step.attachments
      : []
  const duration = formatDuration(step)
  // 运行是按 seq 顺序记下每次执行的，所以「这一次的下一步」就是 seq + 1 的那次执行；
  // 没有下一次执行说明运行到这里就结束了（终止节点本身不产生执行记录）。
  const nextStep = steps.find((other) => other.seq === step.seq + 1) ?? null
  const nextNode =
    nextStep === null
      ? null
      : ((Array.isArray(graph?.nodes) ? graph.nodes : []).find(
          (item) => item?.id === nextStep.nodeId,
        ) ?? null)
  const nextTitle =
    nextStep === null
      ? ''
      : nextNode === null
        ? nextStep.nodeId
        : nodeTitle(nextNode, definitionNode(definition, nextStep.nodeId))
  const nextVisit = nextStep !== null && typeof nextStep.visit === 'number' ? nextStep.visit : 1
  // 终止节点本身不产生执行记录，所以「最后一次执行」的下一步只能从运行结果
  // 里的 lastNode 拿到；它通常就是这次执行走向的那个结束节点。
  const lastSeq = steps.reduce((max, other) => Math.max(max, other.seq), 0)
  const result = run !== null && typeof run?.result === 'object' ? run.result : null
  const endTarget =
    nextStep === null &&
    step.seq === lastSeq &&
    typeof result?.lastNode === 'string' &&
    result.lastNode !== step.nodeId
      ? result.lastNode
      : null
  const endNode =
    endTarget === null
      ? null
      : ((Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === endTarget) ??
        null)
  const endTitle =
    endNode === null ? endTarget : nodeTitle(endNode, definitionNode(definition, endTarget ?? ''))

  /** 下一步的目标：优先下一次执行，其次这次执行走到的终止节点。 */
  const nextTarget =
    nextStep !== null
      ? { nodeId: nextStep.nodeId, seq: nextStep.seq, title: nextTitle, visit: `#${nextVisit}` }
      : endTarget !== null
        ? { nodeId: endTarget, seq: null, title: endTitle, visit: null }
        : null

  // 「上一步」就是运行里 seq - 1 的那次执行；第一次执行没有上一步时，
  // 新格式还可以退回到开始节点（它不执行，但能解释这条链路从哪来）。
  const prevStep = steps.find((other) => other.seq === step.seq - 1) ?? null
  const prevNode =
    prevStep === null
      ? null
      : ((Array.isArray(graph?.nodes) ? graph.nodes : []).find(
          (item) => item?.id === prevStep.nodeId,
        ) ?? null)
  const prevTitle =
    prevStep === null
      ? ''
      : prevNode === null
        ? prevStep.nodeId
        : nodeTitle(prevNode, definitionNode(definition, prevStep.nodeId))
  const prevVisit = prevStep !== null && typeof prevStep.visit === 'number' ? prevStep.visit : 1
  const startNode =
    (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === graph?.start) ??
    null
  const firstTarget =
    prevStep === null &&
    step.seq === 1 &&
    startNode?.type === 'start' &&
    startNode.id !== step.nodeId
      ? { nodeId: startNode.id, seq: null, title: t('typeStart'), visit: null }
      : null
  const prevTarget =
    prevStep !== null
      ? { nodeId: prevStep.nodeId, seq: prevStep.seq, title: prevTitle, visit: `#${prevVisit}` }
      : firstTarget

  return h(
    'div',
    {
      key: `${String(step.seq)}-${String(step.nodeId)}`,
      className: 'buka-workflows-tabPanel',
      role: 'tabpanel',
    },
    h(
      'div',
      { className: 'buka-workflows-tabMeta' },
      h(Tag, { tone: statusTone(step.status) }, statusLabel(t, step.status)),
      route === ''
        ? null
        : h(Tag, { tone: 'neutral' }, `${t('routeLabel')}: ${routeText(node, config, route)}`),
      attachments.length === 0
        ? null
        : h(
            Tag,
            { tone: 'neutral' },
            String(t('attachmentCount')).replace('{n}', String(attachments.length)),
          ),
      typeof step.startedAt === 'number'
        ? h('span', { className: 'buka-workflows-meta' }, formatTime(step.startedAt))
        : null,
      duration === '' ? null : h('span', { className: 'buka-workflows-meta' }, duration),
      step.compacted === true ? h(Tag, { tone: 'success' }, t('sessionCompacted')) : null,
      step.recovered === true ? h(Tag, { tone: 'info' }, t('sessionRecovered')) : null,
      step.timedOut === true ? h(Tag, { tone: 'warning' }, t('executionTimedOut')) : null,
      step.aborted === true ? h(Tag, { tone: 'warning' }, t('executionAborted')) : null,
    ),
    h(
      'div',
      { className: 'buka-workflows-inspectorSection' },
      h('span', { className: 'buka-workflows-label' }, t('executionInput')),
      promptText === ''
        ? h(
            'p',
            { className: 'buka-workflows-hint' },
            t(inputMissing ? 'executionInputMissing' : 'executionNoInput'),
          )
        : h('pre', { className: 'buka-workflows-pre' }, promptText),
    ),
    h(
      'div',
      { className: 'buka-workflows-inspectorSection' },
      h('span', { className: 'buka-workflows-label' }, t('executionOutput')),
      outputText === ''
        ? h(
            'p',
            { className: 'buka-workflows-hint' },
            t(attachments.length === 0 ? 'executionNoOutput' : 'executionOutputAttachmentsOnly'),
          )
        : h('pre', { className: 'buka-workflows-pre' }, outputText),
    ),
    attachments.length === 0
      ? null
      : h(
          'div',
          { className: 'buka-workflows-inspectorSection' },
          h('span', { className: 'buka-workflows-label' }, t('executionAttachments')),
          renderAttachments(t, run, step, attachments, openAttachment),
        ),
    typeof step.error === 'string' && step.error !== ''
      ? h(
          'p',
          { className: 'buka-workflows-failure', role: 'alert' },
          `${t('error')}: ${step.error}`,
        )
      : null,
    typeof step.stopReason === 'string' && step.stopReason !== '' && step.stopReason !== 'completed'
      ? h('p', { className: 'buka-workflows-warn' }, `${t('stopReason')}: ${step.stopReason}`)
      : null,
    typeof step.compactionError === 'string' && step.compactionError !== ''
      ? h(
          'p',
          { className: 'buka-workflows-warn' },
          `${t('sessionCompactFailed')} ${step.compactionError}`,
        )
      : null,
    typeof step.sessionResetReason === 'string' && step.sessionResetReason !== ''
      ? h(
          'p',
          { className: 'buka-workflows-warn' },
          `${t('sessionReset')} ${step.sessionResetReason}`,
        )
      : null,
    // 节点级已经展示过这个节点的会话，这里只给不属于节点会话的旧执行保留
    // 自己的入口，避免历史会话无处可打开。
    typeof step.sessionId === 'string' &&
      step.sessionId !== '' &&
      !nodeSessionIds.includes(step.sessionId)
      ? h(
          'div',
          { className: 'buka-workflows-stepActions' },
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              className: 'buka-workflows-smallButton',
              icon: h(IconNewChatOutlineRegular, { size: 13 }),
              onClick: () => openSession(step),
            },
            t('openSession'),
          ),
          h('code', { className: 'buka-workflows-inlineCode' }, step.sessionId),
        )
      : null,
    h(
      'div',
      { className: 'buka-workflows-executionNav' },
      h(
        'div',
        { className: 'buka-workflows-navSide is-prev' },
        h('span', { className: 'buka-workflows-label' }, t('executionPrev')),
        prevTarget === null
          ? h('p', { className: 'buka-workflows-hint' }, t('executionPrevNone'))
          : h(
              'button',
              {
                type: 'button',
                className: 'buka-workflows-prevLink',
                title:
                  prevTarget.visit === null
                    ? prevTarget.title
                    : `${prevTarget.title} ${prevTarget.visit}`,
                onClick: () => focusExecution(prevTarget.nodeId, prevTarget.seq),
              },
              h('span', { className: 'buka-workflows-prevArrow', 'aria-hidden': true }, '←'),
              h('span', { className: 'buka-workflows-prevTitle' }, prevTarget.title),
              prevTarget.visit === null
                ? h('span', { className: 'buka-workflows-prevVisit' }, t('executionStart'))
                : h('span', { className: 'buka-workflows-prevVisit' }, prevTarget.visit),
            ),
      ),
      h(
        'div',
        { className: 'buka-workflows-navSide is-next' },
        h('span', { className: 'buka-workflows-label' }, t('executionNext')),
        nextTarget === null
          ? h('p', { className: 'buka-workflows-hint' }, t('executionNextEnded'))
          : h(
              'button',
              {
                type: 'button',
                className: 'buka-workflows-nextLink',
                title:
                  nextTarget.visit === null
                    ? nextTarget.title
                    : `${nextTarget.title} ${nextTarget.visit}`,
                onClick: () => focusExecution(nextTarget.nodeId, nextTarget.seq),
              },
              h('span', { className: 'buka-workflows-nextTitle' }, nextTarget.title),
              nextTarget.visit === null
                ? h('span', { className: 'buka-workflows-nextVisit' }, t('executionEnded'))
                : h('span', { className: 'buka-workflows-nextVisit' }, nextTarget.visit),
              h('span', { className: 'buka-workflows-nextArrow', 'aria-hidden': true }, '→'),
            ),
      ),
    ),
  )
}
