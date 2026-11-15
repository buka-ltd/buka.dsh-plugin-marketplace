/**
 * 测试夹具：把 v6 形状的定义折成 v7（只做结构与命名，不猜语义）。
 *
 * 引擎 / 页面测试关心的是「岗位、通道、任务、结果」，不是定义怎么搬家；
 * 定义校验本身的测试直接写 v7 字面量。
 *
 * @module test/workflows-fixture-v7
 */

/** 递归把字符串里的 `start.output` 换成 `content`（v7 的模板前缀）。 */
function swap(value) {
  if (typeof value === 'string') return value.replaceAll('start.output', 'content')
  if (Array.isArray(value)) return value.map((item) => swap(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]))
  }
  return value
}

/**
 * 把 v6 定义折成 v7。
 *
 * @param {Record<string, unknown>} v6 v6 形状的定义
 * @returns {Record<string, unknown>} v7 定义
 */
export function toV7(v6) {
  const start = v6.start ?? {}
  const task = start.task ?? {}
  return {
    version: 7,
    name: v6.name,
    ...(v6.description === undefined ? {} : { description: v6.description }),
    budgets: v6.budgets,
    start: {
      ...(task.output === undefined ? {} : { content: task.output }),
      next: (start.next ?? []).map((route) => ({
        channel: route.channel,
        type: route.type,
        content: swap(route.payload ?? {}),
      })),
    },
    end: v6.end?.task?.payload === undefined ? {} : { content: v6.end.task.payload },
    positions: (v6.positions ?? []).map((position) => ({
      ...position,
      taskTypes: (position.taskTypes ?? []).map((type) => ({
        id: type.id,
        label: type.label,
        ...(type.prompt === undefined ? {} : { definition: type.prompt }),
        ...(type.payload === undefined ? {} : { content: type.payload }),
        ...(type.assistant === undefined ? {} : { assistant: type.assistant }),
        ...(type.mode === undefined ? {} : { mode: type.mode }),
      })),
    })),
    channels: v6.channels,
  }
}
