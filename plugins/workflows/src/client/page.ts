/**
 * 侧边栏「工作流」页面：装配状态 hooks 与渲染函数，页面本身只做组装。
 */

import type React from 'react'

import { renderDetail, runDetailModel } from './components/detail.ts'
import { renderDrawerHead } from './components/drawer-head.ts'
import { renderExecution } from './components/execution.ts'
import { renderFooter } from './components/footer.ts'
import { renderList } from './components/list.ts'
import { renderInteractionNotice, renderUserNotice } from './components/notices.ts'
import { renderPage } from './components/page-shell.ts'
import { renderSettingsDialog } from './components/settings-dialog.ts'
import {
  renderTemplateDetail,
  renderTemplatesList,
  templateDetailModel,
} from './components/templates.ts'
import {
  attachmentPreviewLabels,
  interceptAttachmentLink,
  renderAttachmentDownload,
  renderAttachmentDrawer,
  renderAttachmentPreviewBody,
} from './drawers/attachment.ts'
import { edgeRulesFor, renderEdgeDrawer, renderEdgeRule } from './drawers/edge.ts'
import { renderNodePanel } from './drawers/node.ts'
import {
  closeRunNodeDrawer,
  closeTemplateNodeDrawer,
  renderRunNodeDrawer,
  renderTemplateNodeDrawer,
} from './drawers/node-drawers.ts'
import { renderTemplateNodePanel } from './drawers/template-node.ts'
import { renderLegend } from './graph/legend.ts'
import { renderGraph } from './graph/render-graph.ts'
import { capsuleText, templateNodeLabel } from './node-model.ts'
import type { PageContext } from './page-context.ts'
import { useAttachmentsEffects } from './state/use-attachments.ts'
import { usePageState } from './state/use-page-state.ts'
import { createRunsActions, useRunsEffects } from './state/use-runs.ts'
import { createSessionActions } from './state/use-sessions.ts'
import { createSettingsActions } from './state/use-settings.ts'
import { createUiActions, useUiEffects } from './state/use-ui.ts'
import type { WorkflowsPageProps } from './types.ts'

/**
 * 侧边栏「工作流」页面。
 *
 * @param props
 * @returns React 元素
 */
export function WorkflowsPage(props: WorkflowsPageProps): React.ReactElement {
  const t = props.t
  const getService = typeof props.getService === 'function' ? props.getService : () => null

  // hooks 只在装配入口调用：先声明全部 useState，再挂 effect，顺序保持稳定。
  const state = usePageState()
  useRunsEffects(state)
  useUiEffects(state)
  const attachments = useAttachmentsEffects(state, t)

  const runs = createRunsActions(state)
  const ui = createUiActions(state)
  const settings = createSettingsActions(state, { t, flash: ui.flash, reload: runs.reload })
  const sessions = createSessionActions({ getService, t, flash: ui.flash })

  const model = {} as PageContext
  Object.assign(model, state, runs, ui, settings, sessions, attachments, {
    t,
    getService,
    capsuleText: (node: Parameters<typeof capsuleText>[1]) => capsuleText(t, node),
    templateNodeLabel: (node: Parameters<typeof templateNodeLabel>[1]) =>
      templateNodeLabel(t, node),
    renderLegend: (options?: { states?: boolean | undefined }) => renderLegend(model, options),
    renderGraph: (
      graph: Parameters<typeof renderGraph>[1],
      activeNodeId: Parameters<typeof renderGraph>[2],
      onNodeSelect?: Parameters<typeof renderGraph>[3],
      options?: Parameters<typeof renderGraph>[4],
    ) => renderGraph(model, graph, activeNodeId, onNodeSelect, options),
    renderExecution: renderExecution.bind(null, model),
    renderNodePanel: renderNodePanel.bind(null, model),
    renderList: () => renderList(model),
    renderUserNotice: (run: Parameters<typeof renderUserNotice>[1]) => renderUserNotice(model, run),
    renderInteractionNotice: (run: Parameters<typeof renderInteractionNotice>[1]) =>
      renderInteractionNotice(model, run),
    runDetailModel: () => runDetailModel(model),
    renderDetail: () => renderDetail(model),
    renderTemplatesList: () => renderTemplatesList(model),
    renderTemplateNodePanel: renderTemplateNodePanel.bind(null, model),
    templateDetailModel: () => templateDetailModel(model),
    renderTemplateDetail: () => renderTemplateDetail(model),
    renderFooter: (withStates?: boolean) => renderFooter(model, withStates),
    renderSettingsDialog: () => renderSettingsDialog(model),
    interceptAttachmentLink: interceptAttachmentLink.bind(null, model),
    attachmentPreviewLabels: () => attachmentPreviewLabels(model),
    renderAttachmentDownload: (viewer: Parameters<typeof renderAttachmentDownload>[1]) =>
      renderAttachmentDownload(model, viewer),
    renderAttachmentPreviewBody: (viewer: Parameters<typeof renderAttachmentPreviewBody>[1]) =>
      renderAttachmentPreviewBody(model, viewer),
    renderDrawerHead: renderDrawerHead.bind(null, model),
    renderAttachmentDrawer: () => renderAttachmentDrawer(model),
    closeRunNodeDrawer: () => closeRunNodeDrawer(model),
    closeTemplateNodeDrawer: () => closeTemplateNodeDrawer(model),
    renderRunNodeDrawer: () => renderRunNodeDrawer(model),
    renderTemplateNodeDrawer: () => renderTemplateNodeDrawer(model),
    edgeRulesFor: edgeRulesFor.bind(null, model),
    renderEdgeRule: renderEdgeRule.bind(null, model),
    renderEdgeDrawer: () => renderEdgeDrawer(model),
  })
  return renderPage(model)
}
