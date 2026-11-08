/**
 * 机器人节点结果到下一节点的路由。
 *
 * 规则只做字段等值 / 集合匹配：`{ when: { field, equals } }` 或
 * `{ when: { field, in } }`，第一条命中生效；没有 `when` 的规则作为默认出口。
 * 都不命中时返回 null，表示流程正常结束。
 *
 * @module @buka/dsh-plugin-workflows/routing
 */

/**
 * 判断一条条件是否成立。
 *
 * @param {{ field: string, equals?: unknown, in?: unknown[] } | undefined} when
 * @param {unknown} data 机器人回报的结构化结果
 * @returns {boolean}
 */
export function matchesWhen(when, data) {
  if (when === undefined || when === null) return true
  const value = getPath(data, when.field)
  if (value === undefined) return false
  if (Object.hasOwn(when, 'equals')) return sameValue(value, when.equals)
  if (Array.isArray(when.in)) return when.in.some((candidate) => sameValue(value, candidate))
  return false
}

/**
 * 为一个机器人节点选择命中的出边规则。
 *
 * 返回整条规则（而不是只返回目标 id），因为一条边除了目标还可能带 `name`
 * 与 `prompt`；执行器需要在走到这条边时把入口说明拼进目标节点的提示词。
 *
 * @param {Record<string, any>} node 已规范化的节点
 * @param {{ data?: unknown }} [result] 机器人结果
 * @returns {Record<string, any> | null} 命中的规则；null 表示没有出口
 */
export function chooseNextRule(node, result = {}) {
  const rules = Array.isArray(node?.next) ? node.next : []
  for (const rule of rules) {
    if (matchesWhen(rule.when, result.data)) return rule
  }
  return null
}

/**
 * 为一个机器人节点选择下一节点。
 *
 * @param {Record<string, any>} node 已规范化的节点
 * @param {{ data?: unknown }} [result] 机器人结果
 * @returns {string | null} 下一节点 id；null 表示结束
 */
export function chooseNext(node, result = {}) {
  const rule = chooseNextRule(node, result)
  return rule === null ? null : rule.to
}

/**
 * 按点号路径取结构化结果里的字段。
 *
 * @param {unknown} source
 * @param {string} path
 * @returns {unknown}
 */
export function getPath(source, path) {
  let current = source
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

/**
 * 标量严格相等；对象 / 数组按 JSON 文本比较。
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function sameValue(left, right) {
  if (left === right) return true
  if (left === null || right === null) return false
  if (typeof left !== 'object' && typeof right !== 'object') return false
  return JSON.stringify(left) === JSON.stringify(right)
}
