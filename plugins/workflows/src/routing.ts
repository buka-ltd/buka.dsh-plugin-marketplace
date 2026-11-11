/**
 * 机器人节点结果的解析与路由（workflow format 2）。
 *
 * 机器人节点总是交回一个 JSON 对象，结果有两条出口：
 *
 * - `next` 必须精确匹配某一条出边的 `name`，执行器就沿着那条边走，并渲染该边上
 *   的 prompt；没有出边的终止机器人节点不需要 `next`，此时 `resolveRoute` 返回
 *   `{ rule: null }`，流程正常结束；
 * - `abort` 是主动终止：节点用非空字符串说明自己无法完成，执行器直接结束运行，
 *   不选任何边。`resolveAbort` 必须先于 `resolveRoute` 调用；两者同时出现时按
 *   无效结果处理，供观察者要求机器人在同一会话里重新交回结果。
 *
 * @module @buka/dsh-plugin-workflows/routing
 */

/** 主动终止原因的最大字符数；超出部分截断，避免把 run.json 撑大。 */
export const MAX_ABORT_REASON_LENGTH = 2000

/** `resolveAbort` 的结果：没有 abort 时是 `null`，否则按出现的字段区分合法 / 无效。 */
export interface ResolveAbortResult {
  readonly abort?: { readonly reason: string } | undefined
  readonly error?:
    | { readonly kind: 'ambiguous-result' | 'invalid-abort'; readonly message: string }
    | undefined
}

/** 一条出边：路由判定只用到 `name`。 */
interface RouteEdge {
  readonly name?: unknown
}

/** 带出边的节点：只用到 `next`。 */
interface RouteNode<T extends RouteEdge> {
  readonly next?: readonly T[] | null | undefined
}

/** `resolveRoutes` 的结果：命中的出边（按定义顺序）/ 路由错误。 */
export interface ResolveRoutesResult<T extends RouteEdge> {
  readonly rules?: T[] | undefined
  readonly error?: string | undefined
  readonly routes?: string[] | undefined
}

/** `resolveRoute` 的结果：唯一出边 / 无出边 / 路由错误。 */
export type ResolveRouteResult<T extends RouteEdge> =
  | { readonly rule: T }
  | { readonly rule: null }
  | { readonly error: string; readonly routes: string[] }

/**
 * 解析机器人结果里的 `abort` 主动终止字段。
 *
 * 返回：
 * - `null`：结果没有 `abort`，按 `next` 处理；
 * - `{ abort: { reason } }`：合法的主动终止；
 * - `{ error: { kind, message } }`：`next` / `abort` 同时出现，或 `abort` 不是
 *   非空字符串，`kind` 直接作为结果追问的 reason。
 *
 * @param data 机器人交回的 JSON 对象
 * @returns 没有 abort 时是 `null`，否则是合法 abort 或无效结果
 */
export function resolveAbort(data: unknown): ResolveAbortResult | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  if (!Object.hasOwn(data, 'abort')) return null

  if (Object.hasOwn(data, 'next')) {
    return {
      error: {
        kind: 'ambiguous-result',
        message: 'the result carries both "next" and "abort"; submit exactly one of them',
      },
    }
  }

  const raw = (data as Record<string, unknown>).abort
  if (typeof raw !== 'string') {
    return {
      error: {
        kind: 'invalid-abort',
        message:
          '"abort" must be a string containing the reason this node cannot complete its task',
      },
    }
  }

  const reason = raw.trim()
  if (reason === '') {
    return { error: { kind: 'invalid-abort', message: '"abort" must be a non-empty reason' } }
  }
  return {
    abort: {
      reason:
        reason.length > MAX_ABORT_REASON_LENGTH ? reason.slice(0, MAX_ABORT_REASON_LENGTH) : reason,
    },
  }
}

/**
 * 按机器人结果里的 `next` 选择出边（format 2 起，format 3 支持并发 fan-out）。
 *
 * 结果里的 `next` 可以是一个路由键（单线，向后兼容），也可以是一个路由键数组
 * （fan-out：同时沿所有列出的出边并发执行）。调用方必须先处理 `resolveAbort`：
 * 合法 abort 不进入路由。
 *
 * 返回：
 * - `{ rules }`：命中一条或多条出边（数组，按定义顺序）；
 * - `{ rules: [] }`：节点没有出边，流程到此结束；
 * - `{ error, routes }`：缺少 / 未知 / 重复 `next`，`routes` 是允许的名字列表。
 *
 * @param node 已规范化的节点
 * @param data 机器人交回的 JSON 对象
 * @returns 命中的出边数组，或路由错误
 */
export function resolveRoutes<T extends RouteEdge>(
  node: RouteNode<T> | null | undefined,
  data: unknown,
): ResolveRoutesResult<T> {
  const rules: readonly T[] = Array.isArray(node?.next) ? node.next : []
  if (rules.length === 0) return { rules: [] }

  const routes: string[] = []
  for (const rule of rules) {
    if (typeof rule?.name === 'string' && rule.name !== '') routes.push(rule.name)
  }

  const rawNext =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>).next : undefined
  if (typeof rawNext === 'string') {
    const name = rawNext.trim()
    if (name === '') {
      return {
        error: `the result has no "next" route; set "next" to one of: ${formatRoutes(routes)}`,
        routes,
      }
    }
    const matches = rules.filter((rule) => rule?.name === name)
    if (matches.length !== 1) {
      return {
        error:
          matches.length === 0
            ? `unknown route "${name}"; "next" must be one of: ${formatRoutes(routes)}`
            : `route "${name}" is ambiguous; "next" must be one of: ${formatRoutes(routes)}`,
        routes,
      }
    }
    return { rules: matches }
  }

  if (Array.isArray(rawNext)) {
    if (rawNext.length === 0) {
      return {
        error: `the result has an empty "next" route list; set "next" to one or more of: ${formatRoutes(routes)}`,
        routes,
      }
    }
    const selected = []
    const seen = new Set()
    for (const raw of rawNext) {
      if (typeof raw !== 'string') {
        return {
          error: `the "next" route list must contain only route names; set it to one or more of: ${formatRoutes(routes)}`,
          routes,
        }
      }
      const name = raw.trim()
      if (name === '') {
        return {
          error: `the "next" route list contains an empty name; use one or more of: ${formatRoutes(routes)}`,
          routes,
        }
      }
      if (seen.has(name)) {
        return {
          error: `the "next" route list repeats "${name}"; each route can only be selected once`,
          routes,
        }
      }
      seen.add(name)
      const matches = rules.filter((rule) => rule?.name === name)
      if (matches.length !== 1) {
        return {
          error:
            matches.length === 0
              ? `unknown route "${name}"; "next" must be one of: ${formatRoutes(routes)}`
              : `route "${name}" is ambiguous; "next" must be one of: ${formatRoutes(routes)}`,
          routes,
        }
      }
      selected.push(matches[0] as T)
    }
    return { rules: selected }
  }

  return {
    error: `the result has no "next" route; set "next" to one of: ${formatRoutes(routes)}`,
    routes,
  }
}

/**
 * 按机器人结果里的 `next` 选择唯一一条出边（单线；遗留 API）。
 *
 * fan-out（`next` 数组）请用 `resolveRoutes`。这里保留旧的返回值形状，供调用方
 * 处理「终止节点 / 单一路由」路径。
 *
 * @param node 已规范化的节点
 * @param data 机器人交回的 JSON 对象
 * @returns 唯一出边 / 无出边 / 路由错误
 */
export function resolveRoute<T extends RouteEdge>(
  node: RouteNode<T> | null | undefined,
  data: unknown,
): ResolveRouteResult<T> {
  const rules: readonly T[] = Array.isArray(node?.next) ? node.next : []
  if (rules.length === 0) return { rule: null }

  const routes: string[] = []
  for (const rule of rules) {
    if (typeof rule?.name === 'string' && rule.name !== '') routes.push(rule.name)
  }

  const rawNext =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>).next : undefined
  const next = typeof rawNext === 'string' ? rawNext.trim() : ''
  if (next === '') {
    return {
      error: `the result has no "next" route; set "next" to one of: ${formatRoutes(routes)}`,
      routes,
    }
  }

  const matches = rules.filter((rule) => rule?.name === next)
  if (matches.length !== 1) {
    return {
      error:
        matches.length === 0
          ? `unknown route "${next}"; "next" must be one of: ${formatRoutes(routes)}`
          : `route "${next}" is ambiguous; "next" must be one of: ${formatRoutes(routes)}`,
      routes,
    }
  }

  return { rule: matches[0] as T }
}

/**
 * 把可选路由名拼成给模型看的列表。
 *
 * @param routes 可选路由名
 * @returns 给模型看的列表
 */
function formatRoutes(routes: readonly string[]): string {
  return routes.length === 0 ? '(none)' : routes.map((route) => JSON.stringify(route)).join(', ')
}
