/**
 * 连线配置抽屉：合并规则的提示词 / 外观色与运行走过情况。
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import { ClientModal, h } from '../element.ts'
import { truncateText } from '../format.ts'
import { definitionNode, kvRow } from '../node-model.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientDefinition, ClientEdge } from '../types.ts'

/**
 * 一条边的原始配置规则：从定义快照 / 模板节点里找 `from` 节点的 `next` 中
 * `to` 等于目标节点的全部规则。合并成一条线时逐条保留，不丢 prompt / tone。
 *
 * @param edge
 * @param definition
 * @returns
 */
export function edgeRulesFor(
  _page: PageContext,
  edge: { from?: string; to?: string },
  definition: ClientDefinition | null | undefined,
): ClientEdge[] {
  const node = definitionNode(definition, edge.from ?? '')
  const next = Array.isArray(node?.next) ? node.next : []
  return next.filter((rule) => rule !== null && typeof rule === 'object' && rule.to === edge.to)
}

/**
 * 连线配置里的一条规则。
 *
 * @param rule
 * @param key
 * @returns React 元素
 */
export function renderEdgeRule(
  page: PageContext,
  rule: ClientEdge,
  key: string,
): React.ReactElement {
  const { t } = page

  const name = typeof rule.name === 'string' ? rule.name.trim() : ''
  const label = typeof rule.label === 'string' ? rule.label.trim() : ''
  const description = typeof rule.description === 'string' ? rule.description.trim() : ''
  const tone = rule.tone === 'success' || rule.tone === 'failure' ? rule.tone : ''
  const prompt = truncateText(typeof rule.prompt === 'string' ? rule.prompt : '', 4000)
  return h(
    'div',
    { key, className: 'buka-workflows-edgeRule' },
    h(
      'div',
      { className: 'buka-workflows-edgeRuleHead' },
      name === '' ? null : h(Tag, { tone: 'neutral' }, `${t('edgeRoute')}: ${name}`),
      label === '' ? null : h(Tag, { tone: 'info' }, `${t('edgeOption')}: ${label}`),
      tone === ''
        ? null
        : h(
            Tag,
            { tone: tone === 'success' ? 'success' : 'warning' },
            t(tone === 'success' ? 'edgeToneSuccess' : 'edgeToneFailure'),
          ),
    ),
    description === ''
      ? null
      : h('span', { className: 'buka-workflows-edgeRuleDesc' }, description),
    h(
      'div',
      { className: 'buka-workflows-inspectorSection' },
      h('span', { className: 'buka-workflows-label' }, t('edgePrompt')),
      prompt.text === ''
        ? h('p', { className: 'buka-workflows-hint' }, t('edgeNoPrompt'))
        : h('pre', { className: 'buka-workflows-pre' }, prompt.text),
      prompt.truncated ? h('p', { className: 'buka-workflows-hint' }, t('promptTruncated')) : null,
      prompt.text === '' ? null : h('p', { className: 'buka-workflows-hint' }, t('edgePromptHint')),
    ),
  )
}

/**
 * 连线配置抽屉：来源 → 目标、每条合并规则的路由键 / 选项 / 说明 / 提示词 /
 * 外观色，以及运行页面的走过情况。模板页不展示运行状态。
 *
 * @returns
 */
export function renderEdgeDrawer(page: PageContext): React.ReactElement | null {
  const {
    t,
    selectedId,
    selectedEdgeKey,
    setSelectedEdgeKey,
    selectedTemplateId,
    capsuleText,
    templateNodeLabel,
    runDetailModel,
    templateDetailModel,
    renderDrawerHead,
    edgeRulesFor,
    renderEdgeRule,
  } = page

  if (selectedEdgeKey === null) return null
  if (selectedId === null && selectedTemplateId === null) return null
  const templateModel = templateDetailModel()
  const runModel = templateModel === null ? runDetailModel() : null
  const model = templateModel ?? runModel
  if (model === null) return null
  const graph = model.graph
  if (graph === null) return null
  const edges = graph.edges
  const edge = edges.find((item) => item.key === selectedEdgeKey) ?? null
  if (edge === null) return null
  const nodes = graph.nodes
  const fromNode = nodes.find((node) => node.id === edge.from) ?? null
  const toNode = nodes.find((node) => node.id === edge.to) ?? null
  const labelOf = templateModel === null ? capsuleText : templateNodeLabel
  const fromLabel = fromNode === null ? edge.from : labelOf(fromNode)
  const toLabel = toNode === null ? edge.to : labelOf(toNode)
  const definition: ClientDefinition | null =
    templateModel === null
      ? runModel === null
        ? null
        : runModel.definition
      : { definition: { nodes: templateModel.template.nodes ?? [] } }
  const rules = edgeRulesFor(edge, definition)
  const fallback =
    rules.length > 0 ||
    (edge.prompt === '' &&
      (!Array.isArray(edge.names) || edge.names.length === 0) &&
      (!Array.isArray(edge.labels) || edge.labels.length === 0) &&
      edge.tone === '')
      ? rules
      : [
          {
            name: Array.isArray(edge.names) ? edge.names.join(' / ') : '',
            label: Array.isArray(edge.labels) ? edge.labels.join(' / ') : '',
            description: '',
            prompt: typeof edge.prompt === 'string' ? edge.prompt : '',
            tone: edge.tone,
          },
        ]
  const meta = `${fromLabel} → ${toLabel}${edge.loop === true ? ` · ${t('edgeLoop')}` : ''}`
  const stateRows =
    templateModel !== null
      ? null
      : h(
          'div',
          { className: 'buka-workflows-inspectorSection' },
          h('span', { className: 'buka-workflows-label' }, t('edgeState')),
          h(
            'div',
            { className: 'buka-workflows-kv' },
            kvRow(t('edgeTraversed'), edge.traversed === true ? t('yes') : t('no')),
            kvRow(t('edgeTraversals'), String(edge.traversals ?? 0)),
          ),
        )
  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: () => setSelectedEdgeKey(null),
      title: t('edgeDrawerTitle'),
      closeLabel: t('close'),
      backdropBlur: false,
      className: 'buka-workflows-drawer',
    },
    renderDrawerHead({
      title: t('edgeDrawerTitle'),
      meta,
      closeLabel: t('close'),
      onClose: () => setSelectedEdgeKey(null),
    }),
    h(
      'div',
      { className: 'buka-workflows-drawerBody' },
      stateRows,
      h(
        'div',
        { className: 'buka-workflows-inspectorSection' },
        h('span', { className: 'buka-workflows-label' }, t('edgeRules')),
        fallback.length === 0
          ? h('p', { className: 'buka-workflows-hint' }, t('edgeRulesEmpty'))
          : h(
              'div',
              { className: 'buka-workflows-edgeRules' },
              ...fallback.map((rule, index) => renderEdgeRule(rule, `${edge.key}-${index}`)),
            ),
      ),
    ),
  )
}
