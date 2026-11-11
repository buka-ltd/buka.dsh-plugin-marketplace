/**
 * 浏览器一半的共享类型与常量：Host 路由响应形状、页面状态、路由与刷新间隔。
 */

import type { RunGraphLayout, RunGraphNode } from '../graph.ts'
import type { WorkflowRunRecord, WorkflowStep } from '../run-store.ts'

/** 词典翻译函数。 */
export type Translate = (key: string) => string

/** Host 路由返回的 JSON 对象。 */
export type JsonRecord = Record<string, unknown>

/** 定义快照里的一条出边。 */
export interface ClientEdge {
  [key: string]: unknown
  to?: string
  name?: string
  label?: string
  prompt?: string
  description?: string
  tone?: string
}

/** 定义快照里的一个节点。 */
export interface ClientNode {
  [key: string]: unknown
  id?: string
  type?: string
  robot?: string
  summary?: string
  prompt?: string
  title?: string
  detail?: string
  next?: ClientEdge[]
  questions?: Array<Record<string, unknown>>
  inputs?: string[]
  mode?: string
  timeoutMs?: number
  maxVisits?: number
  status?: string
}

/** 定义快照。 */
export interface ClientDefinition {
  [key: string]: unknown
  plan?: { nodes?: Record<string, ClientNode>; order?: string[]; start?: string }
  definition?: { nodes?: ClientNode[]; start?: string }
}

/** Host 返回的图模型（布局坐标 + 节点 + 兼容旧版的 rows / dotX 布局）。 */
export type ClientGraph = RunGraphLayout & {
  nodes: RunGraphNode[]
  order: string[]
  start: string | null
  rows?: Array<{ id?: string; index?: number; y?: number }>
  dotX?: number
}

/** 页面读取的执行记录：Host 一定写入了这几个字段。 */
export type ClientStep = WorkflowStep & {
  seq: number
  nodeId: string
  status: string
  type: string
}

/** 运行记录里的 steps；空记录时返回空数组。 */
export function stepsOf(run: WorkflowRunRecord | null | undefined): ClientStep[] {
  return Array.isArray(run?.steps) ? (run.steps as ClientStep[]) : []
}

/** 运行列表里的一条摘要。 */
export interface ClientRunSummary {
  [key: string]: unknown
  runId: string
  seq?: number
  status: string
  goal?: string
  createdAt?: number
  archivedAt?: number | null
  error?: string | null
  waitingForUser?: boolean
}

/** 运行详情响应。 */
export interface ClientRunDetail {
  [key: string]: unknown
  run: WorkflowRunRecord | null
  definition: ClientDefinition | null
  nodeResults: Array<Record<string, unknown>>
  graph: ClientGraph | null
}

/** 模板目录里的一份模板（带 Host 算好的图）。 */
export interface ClientTemplate {
  [key: string]: unknown
  id: string
  name?: string
  description?: string
  nodes?: ClientNode[]
  graph?: ClientGraph | null
}

/** 列表状态。 */
export interface ListState {
  status: string
  runs: ClientRunSummary[]
  archivedCount: number
  error: string | null
}

/** 详情状态。 */
export interface DetailState {
  status: string
  data: ClientRunDetail | null
  error: string | null
}

/** 模板目录状态。 */
export interface TemplatesState {
  status: string
  items: ClientTemplate[]
  error: string | null
}

/** 右侧附件预览抽屉正在看的附件。 */
export interface AttachmentViewer {
  runId: string
  seq: unknown
  nodeId: string
  name: string
  bytes?: number | null
  description?: string
}

/** 附件预览请求状态。 */
export interface AttachmentPreviewState {
  status: string
  data: Record<string, unknown> | null
  error: string | null
}

/** 设置草稿；小时存字符串，输入框直接绑它。 */
export interface SettingsDraft {
  enabled: boolean
  archiveHours: string
  deleteHours: string
}

/** Toast 文案。 */
export interface Notice {
  kind: 'success' | 'error'
  text: string
  seq: number
}

/** 鼠标悬停的边名字。 */
export interface EdgeTipState {
  key: string
  kind: string
  text: string
  x: number
  y: number
  anchor: { left: number; top: number } | null
}

/** 页面顶部的页签。 */
export type ClientView = 'runs' | 'templates'

/** 带 code 的请求错误。 */
export interface ClientError extends Error {
  code?: unknown
}

/** 页面 props。 */
export interface WorkflowsPageProps {
  t: Translate
  getService?: ((name: string) => unknown) | null
}

/** 判断普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 Host 返回的 JSON 收口成页面读取的形状（只读展示，不再校验输入）。 */
export function asRunDetail(body: JsonRecord): ClientRunDetail {
  return body as unknown as ClientRunDetail
}

/** 词典命名空间。 */
export const NS = 'buka-workflows'

/** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
export const PANEL_ID = 'buka-workflows'

/** 与 Host 一半（`lib/index.js`）的路由常量保持一致。 */
export const RUNS_ROUTE = '/buka-workflows/runs'
export const RUN_ROUTE = '/buka-workflows/run'
export const SETTINGS_ROUTE = '/buka-workflows/settings'
export const TEMPLATES_ROUTE = '/buka-workflows/templates'

/** 自动归档默认值：运行结束 24 小时后归档、168 小时后删除。 */
export const DEFAULT_ARCHIVE_HOURS = 24
export const DEFAULT_DELETE_HOURS = 168

/** 页面刷新间隔：正在跑的运行也能看到节点进度。 */
export const REFRESH_MS = 5000

/** 有运行在跑时缩短的刷新间隔：后台调度时这张图是唯一的观测点。 */
export const LIVE_REFRESH_MS = 1500
