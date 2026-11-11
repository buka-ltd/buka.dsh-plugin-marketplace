/**
 * 页面上下文：全部 useState 的页面状态 + 动作 + 绑定好 `t` 的渲染小工具 +
 * 绑定好本上下文的渲染函数。
 *
 * 每个渲染函数都只读这个对象，因此组件之间没有隐式闭包依赖；页面入口负责把
 * 它装配起来。
 */

import type React from 'react'

import type { RunGraphNode } from '../graph.ts'
import type { WorkflowRunRecord } from '../run-store.ts'
import type { MarkdownLabelsProp } from './element.ts'
import type { AttachmentsActions } from './state/use-attachments.ts'
import type { PageState } from './state/use-page-state.ts'
import type { RunsActions } from './state/use-runs.ts'
import type { SessionsActions } from './state/use-sessions.ts'
import type { SettingsActions } from './state/use-settings.ts'
import type { UiActions } from './state/use-ui.ts'
import type {
  AttachmentViewer,
  ClientDefinition,
  ClientEdge,
  ClientGraph,
  ClientNode,
  ClientStep,
  ClientTemplate,
  ClientView,
  Translate,
} from './types.ts'

/** 页面上下文：状态、动作与已绑定上下文 / 词典的渲染函数。 */
export interface PageContext
  extends PageState,
    RunsActions,
    UiActions,
    SettingsActions,
    SessionsActions,
    AttachmentsActions {
  t: Translate
  getService: (name: string) => unknown

  /** 胶囊文案（绑定词典）。 */
  capsuleText: (node: RunGraphNode) => string
  /** 模板节点的可读标题（绑定词典）。 */
  templateNodeLabel: (node: {
    type?: string
    robot?: string | null
    summary?: string | null
    title?: string | null
    id?: string
  }) => string

  renderLegend: (options?: { states?: boolean | undefined }) => React.ReactElement
  renderGraph: (
    graph: ClientGraph,
    activeNodeId: string | null,
    onNodeSelect?: ((id: string) => void) | null,
    options?: { states?: boolean | undefined },
  ) => React.ReactElement
  renderExecution: (
    step: ClientStep,
    full: Record<string, unknown> | null,
    config: ClientNode | null,
    node: RunGraphNode,
    steps: ClientStep[],
    definition: ClientDefinition | null,
    graph: ClientGraph | null,
    run: WorkflowRunRecord | null,
    nodeSessionIds?: string[],
  ) => React.ReactElement
  renderNodePanel: (
    node: RunGraphNode | null,
    definition: ClientDefinition | null,
    graph: ClientGraph | null,
    steps: ClientStep[],
    fullResults: Map<string, Record<string, unknown>>,
    run: WorkflowRunRecord | null,
    onClose?: (() => void) | null,
  ) => React.ReactElement
  renderList: () => React.ReactElement
  renderUserNotice: (run: WorkflowRunRecord | null) => React.ReactElement | null
  renderInteractionNotice: (run: WorkflowRunRecord | null) => React.ReactElement | null
  runDetailModel: () => {
    run: WorkflowRunRecord
    steps: ClientStep[]
    nodeResults: Array<Record<string, unknown>>
    fullResults: Map<string, Record<string, unknown>>
    definition: ClientDefinition | null
    graph: ClientGraph | null
    nodes: RunGraphNode[]
  } | null
  renderDetail: () => React.ReactElement
  renderTemplatesList: () => React.ReactElement
  renderTemplateNodePanel: (
    node: RunGraphNode | null,
    template: ClientTemplate,
    onClose?: (() => void) | null,
  ) => React.ReactElement
  templateDetailModel: () => {
    template: ClientTemplate
    graph: ClientGraph | null
    nodes: RunGraphNode[]
  } | null
  renderTemplateDetail: () => React.ReactElement
  renderFooter: (withStates?: boolean) => React.ReactElement
  renderSettingsDialog: () => React.ReactElement
  interceptAttachmentLink: (event: React.MouseEvent<HTMLElement>) => void
  attachmentPreviewLabels: () => MarkdownLabelsProp
  renderAttachmentDownload: (viewer: AttachmentViewer) => React.ReactElement
  renderAttachmentPreviewBody: (viewer: AttachmentViewer) => Array<React.ReactElement | null>
  renderDrawerHead: (options: {
    title: string
    meta?: string | undefined
    icon?: React.ReactNode
    actions?: React.ReactNode[]
    closeLabel: string
    onClose: () => void
  }) => React.ReactElement
  renderAttachmentDrawer: () => React.ReactElement | null
  closeRunNodeDrawer: () => void
  closeTemplateNodeDrawer: () => void
  renderRunNodeDrawer: () => React.ReactElement | null
  renderTemplateNodeDrawer: () => React.ReactElement | null
  edgeRulesFor: (
    edge: { from?: string; to?: string },
    definition: ClientDefinition | null | undefined,
  ) => ClientEdge[]
  renderEdgeRule: (rule: ClientEdge, key: string) => React.ReactElement
  renderEdgeDrawer: () => React.ReactElement | null
}

/** 重新导出页签取值，渲染模块与页面入口共用。 */
export type { ClientView }
