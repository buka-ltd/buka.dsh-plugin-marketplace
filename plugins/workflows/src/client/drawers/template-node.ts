/**
 * 模板详情的节点抽屉内容。
 */

import { IconCloseOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { RunGraphNode } from '../../graph.ts'
import { h } from '../element.ts'
import { statusLabel } from '../format.ts'
import { kvRow, typeLabel, typeTone } from '../node-model.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientTemplate } from '../types.ts'

/**
 * 模板节点抽屉的内容：说明这个节点「做什么 / 什么时候需要它」，并把它的出边
 * 连同条件列成流转去向。
 *
 * @param node 图模型里的节点
 * @param template 模板对象（含原始 nodes）
 * @param [onClose] 关闭抽屉的回调
 * @returns React 元素
 */
export function renderTemplateNodePanel(
  page: PageContext,
  node: RunGraphNode | null,
  template: ClientTemplate,
  onClose: (() => void) | null = null,
): React.ReactElement {
  const { t, templateNodeLabel } = page

  if (node === null) return h('p', { className: 'buka-workflows-hint' }, t('templatesNoFlow'))
  const rawNodes = Array.isArray(template?.nodes) ? template.nodes : []
  const config = rawNodes.find((item) => item?.id === node.id) ?? null
  const byId = new Map(rawNodes.map((item) => [item.id, item]))
  const rows = []
  if (node.type === 'robot') {
    rows.push(kvRow(t('templatesRole'), node.robot || '—'))
    if (typeof node.summary === 'string' && node.summary !== '') {
      rows.push(kvRow(t('templatesPurpose'), node.summary))
    }
  } else if (node.type === 'user') {
    if (typeof node.title === 'string' && node.title !== '')
      rows.push(kvRow(t('typeUser'), node.title))
    if (typeof node.detail === 'string' && node.detail !== '') {
      rows.push(kvRow(t('templatesPurpose'), node.detail))
    }
  } else if (node.type === 'end') {
    rows.push(kvRow(t('nodeEndStatus'), statusLabel(t, node.endStatus ?? 'completed')))
  }

  const next = Array.isArray(config?.next) ? config.next : []
  const transitions = next.map((rule) => {
    const target = byId.get(rule.to)
    const label =
      typeof rule.label === 'string' && rule.label !== ''
        ? rule.label
        : typeof rule.name === 'string' && rule.name !== ''
          ? rule.name
          : ''
    const condition =
      typeof rule.description === 'string' && rule.description !== ''
        ? rule.description
        : typeof rule.prompt === 'string' && rule.prompt !== ''
          ? rule.prompt
          : ''
    const head =
      label === ''
        ? rule.to
        : `${label} → ${target === undefined ? rule.to : templateNodeLabel(target)}`
    return h(
      'div',
      {
        key: `${String(rule.name ?? '')}-${String(rule.to)}`,
        className: 'buka-workflows-templateTransition',
      },
      h(
        'span',
        { className: 'buka-workflows-templateTransitionHead' },
        h(Tag, { tone: 'neutral' }, head),
      ),
      condition === ''
        ? null
        : h('span', { className: 'buka-workflows-templateTransitionBody' }, condition),
    )
  })

  const title = templateNodeLabel(node)
  return h(
    'div',
    { className: 'buka-workflows-inspector', role: 'region', 'aria-label': t('inspector') },
    h(
      'div',
      { className: 'buka-workflows-inspectorHead' },
      h('span', { className: 'buka-workflows-inspectorTitle' }, title),
      title === node.id ? null : h('code', { className: 'buka-workflows-inspectorId' }, node.id),
      node.type === 'start' ? h(Tag, { tone: 'neutral' }, t('nodeStart')) : null,
      node.type === 'robot' ? h(Tag, { tone: 'info' }, t('templatesAbstractRole')) : null,
      h(Tag, { tone: typeTone(node.type) }, typeLabel(t, node.type)),
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
    node.type === 'start' ? h('p', { className: 'buka-workflows-hint' }, t('startNodeHint')) : null,
    rows.length === 0 ? null : h('div', { className: 'buka-workflows-kv' }, ...rows),
    h(
      'div',
      { className: 'buka-workflows-inspectorSection' },
      h('span', { className: 'buka-workflows-label' }, t('templatesTransitions')),
      transitions.length === 0
        ? h('p', { className: 'buka-workflows-hint' }, t('templatesNoTransitions'))
        : h('div', { className: 'buka-workflows-templateTransitions' }, ...transitions),
    ),
  )
}
