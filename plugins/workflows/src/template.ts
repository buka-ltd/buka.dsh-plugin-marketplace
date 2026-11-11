/**
 * 节点 prompt 的模板渲染。
 *
 * 只支持 `{{path}}` 形式的简单取值，不做表达式求值——workflow 定义由 agent
 * 现场生成，必须保证这里不可能执行任意代码。可用路径：
 *
 * - `{{goal}}` / `{{runId}}` / `{{step}}`；
 * - `{{nodes.<id>.text}}`：该节点最近一次执行的最终文本；
 * - `{{nodes.<id>.data.<path>}}`：机器人通过 `structured_output` 回报的结构化结果；
 * - 需要时也可以引用 `{{nodes.<id>.robot}}`、`{{nodes.<id>.sessionId}}`。
 *
 * 路径不存在时抛错（而不是静默变空串），这样定义写错时在对应节点立刻失败，
 * 不会把空提示词交给机器人。
 *
 * 定义校验阶段用 `inspectTemplate` 只提取路径、不求值，再按目标节点声明的
 * `output` schema 检查 `{{nodes.<id>.data.<path>}}` 是否真的存在。
 *
 * @module @buka/dsh-plugin-workflows/template
 */

/** 模板占位符。 */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/gu

/** 合法路径：点号分隔的简单标识符。 */
const PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u

/** 单个占位符的解析结果：要么有路径，要么有错误。 */
type PlaceholderParse =
  | { readonly path: string; readonly error?: undefined }
  | { readonly path?: undefined; readonly error: string }

/** 模板错误：带出错路径，便于定位是哪个占位符。 */
export class TemplateError extends Error {
  /** 出错的模板路径；没有具体路径时是 `undefined`。 */
  readonly path: string | undefined

  constructor(message: string, path?: string) {
    super(message)
    this.name = 'TemplateError'
    this.path = path
  }
}

/**
 * 解析一个占位符里的路径（不含花括号）。
 *
 * @param raw 占位符原文
 * @returns 合法时带 `path`，非法时带 `error`
 */
export function parsePlaceholder(raw: unknown): PlaceholderParse {
  const path = String(raw).trim()
  if (path === '') return { error: 'empty template placeholder' }
  if (!PATH_PATTERN.test(path)) return { error: `invalid template path "${path}"` }
  return { path }
}

/**
 * 列出模板里出现的所有占位符路径，并收集语法错误；不求值。
 *
 * 定义校验用它检查 `{{nodes.<id>.data.<path>}}` 是否落在目标节点声明的
 * `output` 里；规则与运行时 `renderTemplate` 保持一致。
 *
 * @param template 模板原文
 * @returns 占位符路径与语法错误
 */
export function inspectTemplate(template: unknown): { paths: string[]; errors: string[] } {
  if (typeof template !== 'string') return { paths: [], errors: ['template must be a string'] }
  const paths: string[] = []
  const errors: string[] = []
  template.replace(PLACEHOLDER, (_match, raw) => {
    const parsed = parsePlaceholder(raw)
    if (parsed.error !== undefined) {
      errors.push(parsed.error)
      return ''
    }
    paths.push(parsed.path)
    return ''
  })
  return { paths, errors }
}

/**
 * 渲染一个 prompt 模板。
 *
 * @param template 模板原文
 * @param context 例如 `{ goal, nodes, step, runId }`
 * @returns 渲染后的文本
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  if (typeof template !== 'string') throw new TemplateError('template must be a string')
  return template.replace(PLACEHOLDER, (_match, raw) => {
    const parsed = parsePlaceholder(raw)
    if (parsed.error !== undefined) throw new TemplateError(parsed.error, String(raw).trim())
    const path = parsed.path
    const value = getPath(context, path)
    if (value === undefined) {
      throw new TemplateError(`template path "${path}" is not available yet`, path)
    }
    return formatValue(value)
  })
}

/**
 * 按点号路径取值；中途遇到 null / undefined 时返回 undefined。
 *
 * @param source 取值来源
 * @param path 点号路径
 * @returns 取到的值；路径不存在时是 `undefined`
 */
export function getPath(source: unknown, path: string): unknown {
  let current = source
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * 把模板值转成文本：字符串原样，对象转 JSON，null 视作空串。
 *
 * 附件值可能带一个内部错误标记（例如二进制或超过内联上限），此时直接抛出
 * `TemplateError`，而不是把标记对象 JSON 化后塞进 prompt。
 *
 * @param value 模板值
 * @returns 文本
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return ''
  if (
    typeof value === 'object' &&
    typeof (value as { __bukaTemplateError?: unknown }).__bukaTemplateError === 'string'
  ) {
    throw new TemplateError((value as { __bukaTemplateError: string }).__bukaTemplateError)
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
