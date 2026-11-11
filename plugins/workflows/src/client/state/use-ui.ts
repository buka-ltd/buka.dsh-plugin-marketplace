/**
 * 页面交互 effect 与动作：Toast、页签切换与执行聚焦。
 */

import React from 'react'
import type { ClientView } from '../types.ts'
import { stepsOf } from '../types.ts'
import type { PageState } from './use-page-state.ts'

/** 页面交互动作。 */
export interface UiActions {
  /** 切换运行 / 模板页签；从详情页切回列表时也清掉选中项。 */
  switchView: (next: ClientView) => void
  /** 聚焦到一次执行（或一个没有执行记录的节点）。 */
  focusExecution: (nodeId: string, seq?: number | null) => void
  /** 用 Toast 显示一次操作结果。 */
  flash: (kind: 'success' | 'error', text: string) => void
}

/**
 * 页面交互 effect：换运行收起抽屉、滚动 / 尺寸变化收起悬浮边名字。
 *
 * @param state 页面状态
 */
export function useUiEffects(state: PageState): void {
  const {
    selectedId,
    edgeTip,
    setSelectedNodeId,
    setExecutionIndex,
    setEdgeTip,
    setSelectedEdgeKey,
  } = state

  // 换一次运行就收起上一个节点 / 连线抽屉。
  React.useEffect(() => {
    setSelectedNodeId(null)
    setExecutionIndex(null)
    setEdgeTip(null)
    setSelectedEdgeKey(null)
  }, [selectedId])

  // 边上的悬浮名字钉在箭头位置；页面一滚动 / 尺寸变化就把旧坐标收起来，避免
  // 名字停在已经离开的位置。监听器只在“有/没有”之间切换，不跟着每次
  // mousemove 重装。
  const hasEdgeTip = edgeTip !== null
  React.useEffect(() => {
    if (!hasEdgeTip) return undefined
    const hide = () => setEdgeTip(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [hasEdgeTip])
}

/**
 * 页面交互动作。
 *
 * @param state 页面状态
 * @returns 交互动作
 */
export function createUiActions(state: PageState): UiActions {
  const {
    setNotice,
    setSelectedNodeId,
    setExecutionIndex,
    detail,
    view,
    setView,
    setSelectedTemplateId,
    setSelectedTemplateNodeId,
    setSelectedEdgeKey,
    setSelectedId,
  } = state

  /**
   * 用 Toast 显示一次操作结果。
   *
   * @param kind
   * @param text
   */
  function flash(kind: 'success' | 'error', text: string): void {
    setNotice({ kind, text, seq: Date.now() + Math.random() })
  }

  /** 切换运行 / 模板页签；从详情页切回列表时也清掉选中项。 */
  const switchView = (next: ClientView): void => {
    if (next === view) return
    setNotice(null)
    setSelectedTemplateNodeId(null)
    setSelectedEdgeKey(null)
    if (next === 'templates') setSelectedTemplateId(null)
    else setSelectedId(null)
    setView(next)
  }

  /**
   * 聚焦到一次执行（或一个没有执行记录的节点）：选中目标节点，并打开它的
   * 那一次执行；终止节点没有执行记录，就只切换节点。
   *
   * @param nodeId
   * @param [seq] 目标执行的 seq
   */
  function focusExecution(nodeId: string, seq: number | null = null): void {
    const steps = stepsOf(detail.data?.run)
    const list = steps.filter((other) => other.nodeId === nodeId)
    const index = seq === null ? -1 : list.findIndex((other) => other?.seq === seq)
    setSelectedNodeId(nodeId)
    setExecutionIndex(index < 0 ? null : index)
  }

  return { switchView, focusExecution, flash }
}
