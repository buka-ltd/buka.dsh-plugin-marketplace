/**
 * 页面全部状态的声明与初值。
 *
 * 页面只用**一个** `useState` 装下整个状态对象：这样渲染冒烟测试注入一份
 * 状态即可覆盖任意页面，不需要按 hook 调用顺序对表；异步动作全部走函数式
 * `setState`，也不会丢更新。
 */

import React from 'react'

import { initialRoute } from '../routing.ts'
import type { PageState } from '../types.ts'

/**
 * 页面初始状态。
 *
 * @returns 可以交给 `useState` 的状态对象
 */
export function createInitialState(): PageState {
  return {
    route: initialRoute(),
    workflows: { status: 'idle', data: null, error: null },
    workflow: { status: 'idle', data: null, error: null },
    job: { status: 'idle', data: null, error: null },
    finalTask: { status: 'idle', data: null, error: null },
    jobFilter: 'all',
    definitionSelection: null,
    nodeTasks: null,
    attachments: { status: 'idle', data: null, error: null },
    taskId: null,
    task: { status: 'idle', data: null, error: null },
    taskForm: { values: {}, text: '', error: null, submitting: false },
    newJob: { open: false, raw: {}, structured: {}, error: null, submitting: false },
    attachment: null,
    busy: null,
    notice: null,
    tick: 0,
  }
}

/** 页面状态与 setter。 */
export interface PageStore {
  state: PageState
  setState: React.Dispatch<React.SetStateAction<PageState>>
}

/**
 * 声明页面状态。
 *
 * @returns 状态与 setter
 */
export function usePageState(): PageStore {
  const [state, setState] = React.useState<PageState>(createInitialState)
  return { state, setState }
}
