/**
 * 模板页签：模板列表、详情与共享数据。
 */

import {
  IconChevronRightOutlineRegular,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { RunGraphNode } from '../../graph.ts'
import { h } from '../element.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientGraph, ClientTemplate } from '../types.ts'

/**
 * 模板页签里的模板列表。
 *
 * @returns React 元素
 */
export function renderTemplatesList(page: PageContext): React.ReactElement {
  const { t, templates, setSelectedEdgeKey, setSelectedTemplateId, setSelectedTemplateNodeId } =
    page

  if (templates.error !== null && templates.items.length === 0) {
    return h(
      'div',
      { className: 'buka-workflows-templateList' },
      h(
        'p',
        { className: 'buka-workflows-failure', role: 'alert' },
        `${t('loadFailed')} ${templates.error}`,
      ),
    )
  }
  if (templates.status === 'loading' && templates.items.length === 0) {
    return h(
      'div',
      { className: 'buka-workflows-templateList' },
      h(
        'p',
        { className: 'buka-workflows-statusWithDot', role: 'status' },
        h(StateDot, { state: 'ongoing' }),
        t('loading'),
      ),
    )
  }
  if (templates.items.length === 0) {
    return h(
      'div',
      { className: 'buka-workflows-templateList' },
      h(
        'div',
        { className: 'buka-workflows-emptyBox' },
        h('p', { className: 'buka-workflows-empty' }, t('templatesEmpty')),
        h('p', { className: 'buka-workflows-hint' }, t('templatesHint')),
      ),
    )
  }
  return h(
    'div',
    { className: 'buka-workflows-templateList' },
    h('p', { className: 'buka-workflows-hint' }, t('templatesHint')),
    ...templates.items.map((template) =>
      h(
        'button',
        {
          key: template.id,
          type: 'button',
          className: 'buka-workflows-templateCard',
          onClick: () => {
            setSelectedTemplateNodeId(null)
            setSelectedEdgeKey(null)
            setSelectedTemplateId(template.id)
          },
        },
        h(
          'span',
          { className: 'buka-workflows-templateHead' },
          h('span', { className: 'buka-workflows-templateTitle' }, template.name),
          h(Tag, { tone: 'neutral' }, template.id),
          h(IconChevronRightOutlineRegular, {
            size: 14,
            className: 'buka-workflows-templateChevron',
          }),
        ),
        h('p', { className: 'buka-workflows-templateDesc' }, template.description),
      ),
    ),
  )
}

/**
 * 模板详情的共享数据：详情主体与两个抽屉都从这里取。
 *
 * @returns
 */
export function templateDetailModel(page: PageContext): {
  template: ClientTemplate
  graph: ClientGraph | null
  nodes: RunGraphNode[]
} | null {
  const { templates, selectedTemplateId } = page

  if (selectedTemplateId === null) return null
  const template = templates.items.find((item) => item.id === selectedTemplateId) ?? null
  if (template === null) return null
  const graph =
    template.graph !== null && typeof template.graph === 'object' ? template.graph : null
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  return { template, graph, nodes }
}

/**
 * 模板详情：名字 + 描述 + 分层二维图；节点信息和连线配置都在右侧抽屉里。
 *
 * @returns React 元素
 */
export function renderTemplateDetail(page: PageContext): React.ReactElement {
  const {
    t,
    setSelectedEdgeKey,
    setSelectedTemplateId,
    selectedTemplateNodeId,
    setSelectedTemplateNodeId,
    renderGraph,
    templateDetailModel,
  } = page

  const model = templateDetailModel()
  if (model === null) {
    return h('p', { className: 'buka-workflows-empty' }, t('templatesEmpty'))
  }
  const { template, graph, nodes } = model
  const activeNodeId =
    selectedTemplateNodeId !== null && nodes.some((node) => node.id === selectedTemplateNodeId)
      ? selectedTemplateNodeId
      : null
  const graphBody =
    graph === null || nodes.length === 0
      ? h('p', { className: 'buka-workflows-empty' }, t('templatesNoFlow'))
      : renderGraph(graph, activeNodeId, (id) => setSelectedTemplateNodeId(id), { states: false })
  return h(
    'div',
    { className: 'buka-workflows-pageBody buka-workflows-detail buka-workflows-templateDetail' },
    h(
      'div',
      { className: 'buka-workflows-templateHead' },
      h(
        'button',
        {
          type: 'button',
          className: 'buka-workflows-templateBackButton buka-workflows-back',
          'aria-label': t('templatesBack'),
          onClick: () => {
            setSelectedTemplateId(null)
            setSelectedTemplateNodeId(null)
            setSelectedEdgeKey(null)
          },
        },
        h(IconChevronRightOutlineRegular, { size: 16 }),
      ),
      h('span', { className: 'buka-workflows-templateTitle' }, template.name),
      h(Tag, { tone: 'neutral' }, template.id),
    ),
    h('p', { className: 'buka-workflows-templateDesc' }, template.description),
    graphBody,
  )
}
