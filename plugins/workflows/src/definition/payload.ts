/**
 * 任务内容模板：路径解析、引用遍历与渲染。
 *
 * 只有两处声明会写模板：开始节点的初始任务、人任务类型的动作。可用占位符：
 *
 * - `{{content.<path>}}`：正在完成的这张任务的任务内容（开始节点是发起人填的内容，
 *   人任务类型是上游给这张任务的内容）；
 * - `{{input.<path>}}`：动作表单里填的值（开始节点的初始任务没有表单）。
 *
 * 渲染在创建任务时进行；定义校验阶段用 `inspectPayload` 只提取路径、不求值，
 * 再按对应的 schema 检查。路径不存在时默认抛错（而不是静默变空串），避免把空内容
 * 交给主体；确实允许运行时缺失的路径（表单非必填字段）在末尾加 `?` 显式声明，
 * 例如 `{{input.remark?}}` 取不到值时渲染成空串，`?` 不进入路径本身。
 *
 * @module @buka/dsh-plugin-workflows/definition/payload
 */

import { getPath, inspectTemplate, renderTemplate } from '../template.ts'

/** 一段模板引用的解析结果。 */
export type TemplatePath =
  | { readonly kind: 'content'; readonly segments: readonly string[] }
  | { readonly kind: 'input'; readonly segments: readonly string[] }

/**
 * 解析一个模板占位符路径。
 *
 * @param path 占位符里的点号路径
 * @returns 合法时是结构化的引用；不认识的前缀返回 null
 */
export function parseTemplatePath(path: string): TemplatePath | null {
  const segments = path.split('.')
  const head = segments[0]
  if (head === 'content') return { kind: 'content', segments: segments.slice(1) }
  if (head === 'input') return { kind: 'input', segments: segments.slice(1) }
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

/** 模板检查结果。 */
export interface PayloadInspection {
  /** 出现的全部模板路径。 */
  readonly references: readonly TemplateReference[]
  /** 语法错误（占位符写坏了）。 */
  readonly syntaxErrors: readonly string[]
}

/**
 * 提取一个值里的全部模板引用与语法错误；不求值。
 *
 * @param payload 待检查的值
 * @returns 引用与语法错误
 */
export function inspectPayload(payload: unknown): PayloadInspection {
  const references: TemplateReference[] = []
  const syntaxErrors: string[] = []
  walkTemplateValue(payload, references)
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
 * 递归渲染：字符串里的占位符按 `renderTemplate` 求值，容器逐项递归，其它值原样返回。
 *
 * @param payload 含模板的值
 * @param context 模板上下文（`content` / `input`）
 * @returns 渲染后的值
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

/** 渲染上下文：正在完成的任务内容 + 动作表单。 */
export interface TemplateContextInput {
  readonly content?: unknown
  readonly input?: unknown
}

/**
 * 组装模板上下文。
 *
 * @param input 任务内容与动作表单
 * @returns 可直接交给 `renderPayload` 的上下文
 */
export function buildTemplateContext(input: TemplateContextInput): Record<string, unknown> {
  return { content: input.content ?? null, input: input.input ?? null }
}

/**
 * 按点号路径取值；供渲染以外的只读场景使用。
 *
 * @param source 取值来源
 * @param path 点号路径
 * @returns 取到的值；路径不存在时是 undefined
 */
export function readPath(source: unknown, path: string): unknown {
  return getPath(source, path)
}
