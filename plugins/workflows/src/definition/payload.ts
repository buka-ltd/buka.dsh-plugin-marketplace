/**
 * payload 模板：路径解析、引用遍历与执行开始时的递归渲染。
 *
 * 工作流 v5 的 payload 是 JSON 对象，字符串里可以写模板占位符：
 *
 * - `{{start.output.<path>}}`：启动任务交回的结构化输入；
 * - `{{task.<id>.output.<path>}}`：依赖任务的结构化结果；
 * - `{{task.<id>.text}}`：依赖任务的文本结果。
 *
 * 渲染在执行开始时进行（`renderPayload`）；定义校验阶段用 `inspectPayload`
 * 只提取路径、不求值，再按目标 schema / 已存在任务检查。路径不存在时抛错
 * （而不是静默变空串），避免把空提示词交给执行者。
 *
 * @module @buka/dsh-plugin-workflows/definition/payload
 */

import { getPath, inspectTemplate, renderTemplate } from '../template.ts'

/** 一段模板引用的解析结果。 */
export type TemplatePath =
  | { readonly kind: 'start'; readonly segments: readonly string[] }
  | {
      readonly kind: 'task'
      readonly taskId: string
      readonly field: 'output' | 'text'
      readonly segments: readonly string[]
    }

/** 一个任务 id 里允许的字符（`$start` 走 `start.` 前缀，不在这里）。 */
const TASK_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/u

/**
 * 解析一个模板占位符路径。
 *
 * @param path 占位符里的点号路径
 * @returns 合法时是结构化的引用；不认识的前缀返回 null
 */
export function parseTemplatePath(path: string): TemplatePath | null {
  const segments = path.split('.')
  const head = segments[0]
  if (head === 'start') {
    if (segments[1] !== 'output') return null
    return { kind: 'start', segments: segments.slice(2) }
  }
  if (head !== 'task') return null
  const taskId = segments[1] ?? ''
  const field = segments[2]
  if (!TASK_ID_PATTERN.test(taskId)) return null
  if (field === 'text') {
    if (segments.length !== 3) return null
    return { kind: 'task', taskId, field: 'text', segments: [] }
  }
  if (field === 'output')
    return { kind: 'task', taskId, field: 'output', segments: segments.slice(3) }
  return null
}

/** 一个模板字符串里的占位符路径（已解析）。 */
export interface TemplateReference {
  /** 占位符原文路径。 */
  readonly path: string
  /** 解析后的引用；`null` 表示前缀不合法。 */
  readonly reference: TemplatePath | null
}

/** 递归遍历一个 JSON 值，收集字符串里的模板引用。 */
function walkTemplateValue(value: unknown, out: TemplateReference[]): void {
  if (typeof value === 'string') {
    const inspected = inspectTemplate(value)
    for (const path of inspected.paths) out.push({ path, reference: parseTemplatePath(path) })
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkTemplateValue(item, out)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) walkTemplateValue(item, out)
  }
}

/** payload 模板检查结果。 */
export interface PayloadInspection {
  /** 出现的全部模板路径。 */
  readonly references: readonly TemplateReference[]
  /** 语法错误（占位符写坏了）。 */
  readonly syntaxErrors: readonly string[]
}

/**
 * 提取 payload 里的全部模板引用与语法错误；不求值。
 *
 * @param payload 待检查的 payload
 * @returns 引用与语法错误
 */
export function inspectPayload(payload: unknown): PayloadInspection {
  const references: TemplateReference[] = []
  const syntaxErrors: string[] = []
  walkTemplateValue(payload, references)
  // 语法错误要在最外层收集：inspectTemplate 对每个字符串单独返回错误。
  collectSyntaxErrors(payload, syntaxErrors)
  return { references, syntaxErrors }
}

/** 递归收集模板语法错误。 */
function collectSyntaxErrors(value: unknown, errors: string[]): void {
  if (typeof value === 'string') {
    for (const error of inspectTemplate(value).errors) errors.push(error)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSyntaxErrors(item, errors)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectSyntaxErrors(item, errors)
  }
}

/**
 * 判断一个值是否含模板占位符。
 *
 * 定义校验用它在 schema 检查时跳过「运行时才有值」的子树。
 *
 * @param value 待判断的值
 * @returns 含占位符时为 true
 */
export function containsTemplate(value: unknown): boolean {
  if (typeof value === 'string') return inspectTemplate(value).paths.length > 0
  if (Array.isArray(value)) return value.some((item) => containsTemplate(item))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => containsTemplate(item))
  }
  return false
}

/**
 * 递归渲染 payload：字符串里的占位符按 `renderTemplate` 求值，容器逐项递归，
 * 其它值原样返回。返回新对象，不修改入参。
 *
 * @param payload 含模板的 payload
 * @param context 模板上下文（`start` / `task`）
 * @returns 渲染后的 payload
 */
export function renderPayload(payload: unknown, context: Record<string, unknown>): unknown {
  if (typeof payload === 'string') return renderTemplate(payload, context)
  if (Array.isArray(payload)) return payload.map((item) => renderPayload(item, context))
  if (typeof payload === 'object' && payload !== null) {
    const rendered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload)) {
      rendered[key] = renderPayload(value, context)
    }
    return rendered
  }
  return payload
}

/** 一个任务的模板取值。 */
export interface TemplateTaskValue {
  readonly output?: unknown
  readonly text?: string
}

/** 模板上下文输入。 */
export interface TemplateContextInput {
  readonly startOutput?: unknown
  readonly tasks?: ReadonlyMap<string, TemplateTaskValue> | undefined
}

/**
 * 组装模板上下文：
 *
 * ```json
 * { "start": { "output": {...} }, "task": { "<id>": { "output": {...}, "text": "…" } } }
 * ```
 *
 * `start` 与 `task` 都是普通对象，所以 `getPath` 可以按点号路径取值。
 *
 * @param input 启动任务的结构化输入与依赖任务结果
 * @returns 模板上下文
 */
export function buildTemplateContext(input: TemplateContextInput): Record<string, unknown> {
  const tasks: Record<string, unknown> = {}
  for (const [taskId, value] of input.tasks ?? []) {
    tasks[taskId] = {
      ...(value.output === undefined ? {} : { output: value.output }),
      ...(value.text === undefined ? {} : { text: value.text }),
    }
  }
  return {
    start: { output: input.startOutput ?? null },
    task: tasks,
  }
}

/**
 * 按点号路径取值；供渲染以外的只读场景使用（例如任务摘要）。
 *
 * @param source 取值来源
 * @param path 点号路径
 * @returns 取到的值；路径不存在时是 undefined
 */
export function readPath(source: unknown, path: string): unknown {
  return getPath(source, path)
}
