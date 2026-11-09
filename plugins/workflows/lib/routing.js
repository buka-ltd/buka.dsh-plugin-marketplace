/**
 * 机器人节点结果到下一节点的路由（workflow format 2）。
 *
 * 机器人节点总是交回一个 JSON 对象；它其中的 `next` 必须精确匹配某一条出边的
 * `name`，执行器就沿着那条边走，并渲染该边上的 prompt。没有 `next` 只允许出现在
 * 没有出边的终止机器人节点上：此时 `resolveRoute` 返回 `{ rule: null }`，流程
 * 正常结束。缺 `next` 或名字不认识时返回错误与可选路由名，供观察者要求机器人
 * 在同一会话里重新交回结果。
 *
 * @module @buka/dsh-plugin-workflows/routing
 */

/**
 * 按机器人结果里的 `next` 选择出边。
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
