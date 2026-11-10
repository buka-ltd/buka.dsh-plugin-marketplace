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

/**
 * 解析机器人结果里的 `abort` 主动终止字段。
 *
 * 返回：
 * - `null`：结果没有 `abort`，按 `next` 处理；
 * - `{ abort: { reason } }`：合法的主动终止；
 * - `{ error: { kind, message } }`：`next` / `abort` 同时出现，或 `abort` 不是
 *   非空字符串，`kind` 直接作为结果追问的 reason。
 *
 * @param {unknown} data 机器人交回的 JSON 对象
 * @returns {null | { abort: { reason: string } } | { error: { kind: 'ambiguous-result' | 'invalid-abort', message: string } }}
 */
export function resolveAbort(data) {
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

  const raw = data.abort
  if (typeof raw !== 'string') {
    return {
      error: {
        kind: 'invalid-abort',
        message: '"abort" must be a string containing the reason this node cannot complete its task',
      },
    }
  }

  const reason = raw.trim()
  if (reason === '') {
    return { error: { kind: 'invalid-abort', message: '"abort" must be a non-empty reason' } }
  }
  return {
    abort: {
      reason: reason.length > MAX_ABORT_REASON_LENGTH ? reason.slice(0, MAX_ABORT_REASON_LENGTH) : reason,
    },
  }
}

/**
 * 按机器人结果里的 `next` 选择出边。
 *
 * 调用方必须先处理 `resolveAbort`：合法 abort 不进入路由。
 *
 * 返回：
 * - `{ rule }`：命中唯一一条出边；
 * - `{ rule: null }`：节点没有出边，流程到此结束；
 * - `{ error, routes }`：缺少 / 未知 `next`，`routes` 是允许的名字列表。
 *
 * @param {Record<string, any>} node 已规范化的节点
 * @param {unknown} data 机器人交回的 JSON 对象
 * @returns {{ rule: Record<string, any> } | { rule: null } | { error: string, routes: string[] }}
 */
export function resolveRoute(node, data) {
  const rules = Array.isArray(node?.next) ? node.next : []
  if (rules.length === 0) return { rule: null }

  const routes = []
  for (const rule of rules) {
    if (typeof rule?.name === 'string' && rule.name !== '') routes.push(rule.name)
  }

  const rawNext = typeof data === 'object' && data !== null ? data.next : undefined
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

  return { rule: matches[0] }
}

/**
 * 把可选路由名拼成给模型看的列表。
 *
 * @param {string[]} routes
 * @returns {string}
 */
function formatRoutes(routes) {
  return routes.length === 0 ? '(none)' : routes.map((route) => JSON.stringify(route)).join(', ')
}
