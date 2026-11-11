/**
 * 运行列表 / 详情 / 模板目录的加载与定时刷新。
 */

import React from 'react'

import { messageOf } from '../format.ts'
import { requestJson } from '../request.ts'
import type { ClientRunSummary, ClientTemplate } from '../types.ts'
import {
  asRunDetail,
  LIVE_REFRESH_MS,
  REFRESH_MS,
  RUN_ROUTE,
  RUNS_ROUTE,
  TEMPLATES_ROUTE,
} from '../types.ts'
import type { PageState } from './use-page-state.ts'

/** 运行列表的刷新动作。 */
export interface RunsActions {
  /** 手动刷新。 */
  reload: () => void
}

/**
 * 运行列表、选中运行详情与模板目录的加载 / 定时刷新。
 *
 * @param state 页面状态
 */
export function useRunsEffects(state: PageState): void {
  const {
    tick,
    setTick,
    showArchived,
    selectedId,
    list,
    detail,
    setList,
    setDetail,
    setTemplates,
  } = state

  // 列表：首次加载与每次刷新；归档视图只取已归档的运行。
  React.useEffect(() => {
    let cancelled = false
    setList((previous) => ({
      ...previous,
      status: previous.runs.length > 0 ? previous.status : 'loading',
    }))
    requestJson(RUNS_ROUTE + (showArchived ? '?archived=1' : '')).then(
      (body) => {
        if (cancelled) return
        setList({
          status: 'ready',
          runs: Array.isArray(body.runs) ? (body.runs as unknown as ClientRunSummary[]) : [],
          archivedCount: typeof body.archivedCount === 'number' ? body.archivedCount : 0,
          error: null,
        })
      },
      (failure) => {
        if (cancelled) return
        setList((previous) => ({ ...previous, status: 'ready', error: messageOf(failure) }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [tick, showArchived])

  // 详情：选中 run 后加载，并随刷新更新。
  React.useEffect(() => {
    if (selectedId === null) {
      setDetail({ status: 'idle', data: null, error: null })
      return undefined
    }
    let cancelled = false
    setDetail((previous) => ({
      status: previous.data === null ? 'loading' : previous.status,
      data: previous.data,
      error: null,
    }))
    requestJson(`${RUN_ROUTE}?runId=${encodeURIComponent(selectedId)}`).then(
      (body) => {
        if (cancelled) return
        setDetail({ status: 'ready', data: asRunDetail(body), error: null })
      },
      (failure) => {
        if (cancelled) return
        setDetail((previous) => ({ ...previous, status: 'ready', error: messageOf(failure) }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [selectedId, tick])

  // 模板目录：静态数据，挂载时读一次；之后不再重复请求。空依赖避免「状态变更
  // → 清理上一次请求 → 结果被丢弃」的死循环。
  React.useEffect(() => {
    let cancelled = false
    requestJson(TEMPLATES_ROUTE).then(
      (body) => {
        if (cancelled) return
        setTemplates({
          status: 'ready',
          items: Array.isArray(body.templates)
            ? (body.templates as unknown as ClientTemplate[])
            : [],
          error: null,
        })
      },
      (failure) => {
        if (cancelled) return
        setTemplates({ status: 'ready', items: [], error: messageOf(failure) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // 页面打开期间定时刷新：有运行在跑时快一点，否则保持低频。
  const live =
    (Array.isArray(list.runs) &&
      list.runs.some((run) => run?.status === 'running' || run?.status === 'waiting')) ||
    detail.data?.run?.status === 'running' ||
    detail.data?.run?.status === 'waiting'
  React.useEffect(() => {
    const timer = setInterval(
      () => setTick((value) => value + 1),
      live ? LIVE_REFRESH_MS : REFRESH_MS,
    )
    return () => clearInterval(timer)
  }, [live])
}

/**
 * 运行列表的刷新动作。
 *
 * @param state 页面状态
 * @returns 刷新动作
 */
export function createRunsActions(state: PageState): RunsActions {
  return {
    reload(): void {
      state.setTick((value) => value + 1)
    },
  }
}
