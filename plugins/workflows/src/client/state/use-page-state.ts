/**
 * 页面全部 useState 的声明。
 *
 * 集中在一处，保证 useState 的调用顺序与页面演进历史一致（既有的渲染冒烟测试
 * 按这个顺序注入状态）；effects / actions 由其它模块接收这份状态。
 */

import React from 'react'

import type {
  AttachmentPreviewState,
  AttachmentViewer,
  ClientView,
  DetailState,
  EdgeTipState,
  ListState,
  Notice,
  SettingsDraft,
  TemplatesState,
} from '../types.ts'

/** 页面状态：全部 useState 的值与 setter。 */
export interface PageState {
  list: ListState
  setList: React.Dispatch<React.SetStateAction<ListState>>
  selectedId: string | null
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  detail: DetailState
  setDetail: React.Dispatch<React.SetStateAction<DetailState>>
  tick: number
  setTick: React.Dispatch<React.SetStateAction<number>>
  notice: Notice | null
  setNotice: React.Dispatch<React.SetStateAction<Notice | null>>
  selectedNodeId: string | null
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>
  executionIndex: number | null
  setExecutionIndex: React.Dispatch<React.SetStateAction<number | null>>
  edgeTip: EdgeTipState | null
  setEdgeTip: React.Dispatch<React.SetStateAction<EdgeTipState | null>>
  showArchived: boolean
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>
  settingsOpen: boolean
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  settingsDraft: SettingsDraft | null
  setSettingsDraft: React.Dispatch<React.SetStateAction<SettingsDraft | null>>
  settingsLoading: boolean
  setSettingsLoading: React.Dispatch<React.SetStateAction<boolean>>
  settingsSaving: boolean
  setSettingsSaving: React.Dispatch<React.SetStateAction<boolean>>
  settingsError: string | null
  setSettingsError: React.Dispatch<React.SetStateAction<string | null>>
  view: ClientView
  setView: React.Dispatch<React.SetStateAction<ClientView>>
  templates: TemplatesState
  setTemplates: React.Dispatch<React.SetStateAction<TemplatesState>>
  selectedTemplateId: string | null
  setSelectedTemplateId: React.Dispatch<React.SetStateAction<string | null>>
  selectedTemplateNodeId: string | null
  setSelectedTemplateNodeId: React.Dispatch<React.SetStateAction<string | null>>
  attachmentView: AttachmentViewer | null
  setAttachmentView: React.Dispatch<React.SetStateAction<AttachmentViewer | null>>
  attachmentPreview: AttachmentPreviewState
  setAttachmentPreview: React.Dispatch<React.SetStateAction<AttachmentPreviewState>>
  selectedEdgeKey: string | null
  setSelectedEdgeKey: React.Dispatch<React.SetStateAction<string | null>>
}

/**
 * 声明页面的全部 useState。
 *
 * @returns 页面状态
 */
export function usePageState(): PageState {
  /** 列表状态。 */
  const [list, setList] = React.useState<ListState>({
    status: 'loading',
    runs: [],
    archivedCount: 0,
    error: null,
  })

  /** 当前查看的 runId；null 表示列表视图。 */
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  /** 详情状态。 */
  const [detail, setDetail] = React.useState<DetailState>({
    status: 'idle',
    data: null,
    error: null,
  })

  /** 手动刷新与定时刷新都递增它。 */
  const [tick, setTick] = React.useState(0)

  /** Toast 文案。 */
  const [notice, setNotice] = React.useState<Notice | null>(null)

  /** 节点图里打开抽屉的节点 id；null 表示节点抽屉关闭。 */
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)

  /** 详情里选中的第几次执行；null 表示默认看最近一次。 */
  const [executionIndex, setExecutionIndex] = React.useState<number | null>(null)

  /**
   * 鼠标悬停的边名字：`{ key, kind, text, x, y }`。悬停只显示名字；点击边
   * 打开连线配置抽屉。
   */
  const [edgeTip, setEdgeTip] = React.useState<EdgeTipState | null>(null)

  /** 列表是否只看已归档的运行。 */
  const [showArchived, setShowArchived] = React.useState(false)

  /** 自动归档设置对话框是否打开。 */
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  /** 设置草稿；小时存字符串，输入框直接绑它。null 表示还没读到设置。 */
  const [settingsDraft, setSettingsDraft] = React.useState<SettingsDraft | null>(null)

  /** 正在读取设置。 */
  const [settingsLoading, setSettingsLoading] = React.useState(false)

  /** 正在保存设置。 */
  const [settingsSaving, setSettingsSaving] = React.useState(false)

  /** 设置相关的错误文案。 */
  const [settingsError, setSettingsError] = React.useState<string | null>(null)

  /** 页面顶部的页签：运行 / 模板。 */
  const [view, setView] = React.useState<ClientView>('runs')

  /** 模板目录状态。 */
  const [templates, setTemplates] = React.useState<TemplatesState>({
    status: 'loading',
    items: [],
    error: null,
  })

  /** 模板页里选中的模板 id；null 表示模板列表。 */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)

  /** 模板详情里打开抽屉的节点 id；null 表示节点抽屉关闭。 */
  const [selectedTemplateNodeId, setSelectedTemplateNodeId] = React.useState<string | null>(null)

  /**
   * 右侧附件预览抽屉正在看的附件：
   * `{ runId, seq, nodeId, name, bytes, description }`；null 表示抽屉关闭。
   * 放在所有既有 hook 之后追加，避免打乱测试与既有状态的顺序。
   */
  const [attachmentView, setAttachmentView] = React.useState<AttachmentViewer | null>(null)

  /** 抽屉里的预览请求状态；`data` 是 Host 返回的 attachment 对象。 */
  const [attachmentPreview, setAttachmentPreview] = React.useState<AttachmentPreviewState>({
    status: 'idle',
    data: null,
    error: null,
  })

  /**
   * 连线配置抽屉里选中的边 key；null 表示连线抽屉关闭。与节点抽屉互斥。
   * 仍放在所有既有 hook 之后追加，避免打乱测试与既有状态的顺序。
   */
  const [selectedEdgeKey, setSelectedEdgeKey] = React.useState<string | null>(null)
  return {
    list,
    setList,
    selectedId,
    setSelectedId,
    detail,
    setDetail,
    tick,
    setTick,
    notice,
    setNotice,
    selectedNodeId,
    setSelectedNodeId,
    executionIndex,
    setExecutionIndex,
    edgeTip,
    setEdgeTip,
    showArchived,
    setShowArchived,
    settingsOpen,
    setSettingsOpen,
    settingsDraft,
    setSettingsDraft,
    settingsLoading,
    setSettingsLoading,
    settingsSaving,
    setSettingsSaving,
    settingsError,
    setSettingsError,
    view,
    setView,
    templates,
    setTemplates,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplateNodeId,
    setSelectedTemplateNodeId,
    attachmentView,
    setAttachmentView,
    attachmentPreview,
    setAttachmentPreview,
    selectedEdgeKey,
    setSelectedEdgeKey,
  }
}
