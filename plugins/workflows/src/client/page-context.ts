/**
 * 页面上下文：渲染函数统一收到的只读状态 + 动作 + 词典。
 */

import type React from 'react'

import type { AppActions } from './state/use-actions.ts'
import type { PageState, SessionStatusSnapshot, Translate } from './types.ts'

/** 页面上下文：每个渲染函数只读它，不依赖隐式闭包。 */
export interface AppContext {
  t: Translate
  /** 取 DSH Client Service（`uiWorkspace` / `sessions`）。 */
  getService: (name: string) => unknown
  state: PageState
  actions: AppActions
  /** 当前视口是否窄屏（看板等视图据此切换布局）。 */
  narrow: boolean
  /** 顶部 Workflow / Worker 页签，由首页装配；只在列表视图放进页签带左侧。 */
  topTabs: React.ReactElement
  /** 会话 id → 会话即时状态；实时流程据此判断节点是否在等用户。 */
  sessionStatus: SessionStatusSnapshot
}
