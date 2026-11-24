/**
 * 任务内容与任务类型定义的模板渲染。
 *
 * 只支持 `{{path}}` 形式的简单取值，不做表达式求值——workflow 定义由 agent
 * 现场生成，必须保证这里不可能执行任意代码。当前模板上下文只有
 * `{{content}}` / `{{content.<path>}}`（正在完成的这张任务的任务内容）与
 * `{{input}}` / `{{input.<path>}}`（人任务动作表单，只用于创建声明）。
 *
 * 路径不存在时默认抛错（而不是静默变空串），这样定义写错时在对应任务立刻失败，
 * 不会把空提示交给执行者。确实允许运行时缺失的路径（表单非必填字段）要在末尾
 * 加 `?` 显式声明：`{{content.remark?}}` 取不到值时渲染成空串。`?` 不进入路径
 * 本身，保存校验看到的仍是 `content.remark`，写错路径照样被拒。
 *
 * 定义校验阶段用 `inspectTemplate` 只提取路径、不求值，再按对应的 task content
 * schema 检查路径是否声明、是否经过非必填字段。
 *
 * 代入值可能来自上游 agent 或表单，不能让它借用户来源的消息触发宿主的
 * `/skill-name` 手势：`renderTemplate(..., { escape: true })` 会给代入文本里的
 * 手势插入零宽空格（见 `escapeSkillGestures`），模板原文不转义。
 *
 * @module @buka/dsh-plugin-workflows/template
 */

/** 模板占位符。 */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/gu

/** 合法路径：点号分隔的简单标识符。 */
const PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u

/** 单个占位符的解析结果：要么有路径，要么有错误。 */
type PlaceholderParse =
  | {
      readonly path: string
      /** 路径末尾带 `?`：取不到值时渲染成空串。 */
      readonly optional: boolean
      readonly error?: undefined
    }
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
 * 末尾的 `?` 表示可选路径：解析结果里 `path` 不含 `?`，由 `optional` 单独表示。
 *
 * @param raw 占位符原文
 * @returns 合法时带 `path` 与 `optional`，非法时带 `error`
 */
export function parsePlaceholder(raw: unknown): PlaceholderParse {
  const text = String(raw).trim()
  if (text === '') return { error: 'empty template placeholder' }
  const optional = text.endsWith('?')
  const path = optional ? text.slice(0, -1).trim() : text
  if (path === '') return { error: `invalid template path "${text}"` }
  if (!PATH_PATTERN.test(path)) return { error: `invalid template path "${text}"` }
  return { path, optional }
}

/** 一个已解析的占位符：路径（不含 `?`）与它是否声明为可选。 */
export interface InspectedPlaceholder {
  readonly path: string
  readonly optional: boolean
}

/** 模板检查结果。 */
export interface TemplateInspection {
  /** 出现的全部占位符路径（不含 `?`）。 */
  readonly paths: string[]
  /** 完整占位符信息；定义模板校验用它区分必填与可选路径。 */
  readonly placeholders: InspectedPlaceholder[]
  /** 语法错误（占位符写坏了）。 */
  readonly errors: string[]
}

/**
 * 列出模板里出现的所有占位符路径，并收集语法错误；不求值。
 *
 * 定义校验用它检查模板路径是否落在声明的 schema 里；规则与运行时
 * `renderTemplate` 保持一致。
 *
 * @param template 模板原文
 * @returns 占位符路径、完整占位符信息与语法错误
 */
export function inspectTemplate(template: unknown): TemplateInspection {
  if (typeof template !== 'string') {
    return { paths: [], placeholders: [], errors: ['template must be a string'] }
  }
  const paths: string[] = []
  const placeholders: InspectedPlaceholder[] = []
  const errors: string[] = []
  template.replace(PLACEHOLDER, (_match, raw) => {
    const parsed = parsePlaceholder(raw)
    if (parsed.error !== undefined) {
      errors.push(parsed.error)
      return ''
    }
    paths.push(parsed.path)
    placeholders.push({ path: parsed.path, optional: parsed.optional })
    return ''
  })
  return { paths, placeholders, errors }
}

/**
 * 让代入文本里的 `/skill-name` 手势不再匹配宿主的 skill 正则。
 *
 * 宿主只在用户来源的消息里识别 `(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)`；
 * 在 `/` 后面插入零宽空格（U+200B）打断它，界面上看不出区别。只对代入值做，
 * 模板原文不转义——流程维护者写在定义里的手势本来就该生效。
 *
 * @param text 代入的文本
 * @returns 手势被转义后的文本
 */
export function escapeSkillGestures(text: string): string {
  return text.replace(
    /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/gu,
    (_match, lead: string, name: string) => `${lead}/\u200B${name}`,
  )
}

/** `renderTemplate` 的选项。 */
export interface RenderTemplateOptions {
  /** 代入值是否转义 `/skill-name` 手势；模板原文不转义。默认不转义。 */
  readonly escape?: boolean
}

/**
 * 渲染一个 prompt 模板。
 *
 * @param template 模板原文
 * @param context 例如 `{ content, goal, step }`
 * @param options 代入值是否转义 `/skill-name` 手势
 * @returns 渲染后的文本
 */
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
  options: RenderTemplateOptions = {},
): string {
  if (typeof template !== 'string') throw new TemplateError('template must be a string')
  return template.replace(PLACEHOLDER, (_match, raw) => {
    const parsed = parsePlaceholder(raw)
    if (parsed.error !== undefined) throw new TemplateError(parsed.error, String(raw).trim())
    const path = parsed.path
    const value = getPath(context, path)
    if (value === undefined) {
      if (parsed.optional) return ''
      throw new TemplateError(
        `template path "${path}" is not available yet; add "?" to the path to render an empty string when it is missing`,
        path,
      )
    }
    const rendered = formatValue(value)
    return options.escape === true ? escapeSkillGestures(rendered) : rendered
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
