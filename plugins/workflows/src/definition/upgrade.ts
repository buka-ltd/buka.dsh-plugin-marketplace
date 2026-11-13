/**
 * v4 → v5 定义升级（ADR 0015）：一次性存储迁移与读取兜底共用。
 *
 * v4 的边 `{ from, to, types?, back? }` 升级成通道 `{ id, label, from, to, types?, back? }`：
 *
 * - `id` 派生为 `<from>.<to>`（小写；同一对节点在 v4 里唯一，冲突时追加 `.2`、
 *   `.3`），保证引用稳定；
 * - `label` 派生为端点显示名（`研发 → 测试`；内建节点用 `start` / `end`），迁移
 *   只做形式升级，不猜语义，真正的名字留给之后的编排 agent；
 * - `start.next` 的 `position` 换成对应的 `channel` id，目标岗位由通道推出；
 * - 任务按 `createdBy.position → position` + 类型反查通道，回填 `channel`。
 *
 * 纯函数：不读盘、不改记录；幂等（已是 v5 时返回 null）。
 *
 * @module @buka/dsh-plugin-workflows/definition/upgrade
 */

import { START_TASK_ID } from '../domain/ids.ts'
import type {
  BudgetDefinition,
  ChannelDefinition,
  EndDefinition,
  JsonValue,
  PositionDefinition,
  StartDefinition,
  StartRouteDefinition,
  WorkflowDefinition,
} from '../domain/types.ts'

/** v4 边的最小形状。 */
interface LegacyEdge {
  readonly from?: unknown
  readonly to?: unknown
  readonly types?: unknown
  readonly back?: unknown
}

/** v4 初始任务模板的最小形状。 */
interface LegacyRoute {
  readonly position?: unknown
  readonly type?: unknown
  readonly payload?: unknown
  readonly dependsOn?: unknown
}

/** v4 定义的最小形状；只读取升级需要的字段。 */
interface LegacyV4Definition {
  readonly version?: unknown
  readonly name?: unknown
  readonly description?: unknown
  readonly budgets?: unknown
  readonly positions?: unknown
  readonly start?: unknown
  readonly end?: unknown
  readonly edges?: unknown
}

/** 判一个值是不是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 通道 id 的基础形式：小写、点分；超长时截断，冲突由调用方追加后缀。 */
function baseChannelId(from: string, to: string): string {
  const raw = `${from}.${to}`.toLowerCase()
  const cleaned = raw.replace(/[^a-z0-9._-]/gu, '-').replace(/[._-]+$/u, '') || 'channel'
  return cleaned.slice(0, 58).replace(/[._-]+$/u, '') || 'channel'
}

/** 判一个定义是不是已升级的 v5。 */
export function isV5Definition(raw: unknown): boolean {
  return isRecord(raw) && raw.version === 5 && Array.isArray(raw.channels)
}

/**
 * 把一份 v4 定义升级成 v5。
 *
 * @param raw 已通过 v4 校验的原始定义
 * @returns v5 定义；已经是 v5 或形状不完整时返回 null
 */
export function upgradeV4Definition(raw: unknown): WorkflowDefinition | null {
  if (!isRecord(raw)) return null
  if (isV5Definition(raw)) return null
  const definition = raw as LegacyV4Definition
  if (definition.version !== 4) return null
  if (!Array.isArray(definition.positions)) return null
  if (!isRecord(definition.start) || !isRecord(definition.end)) return null
  if (!isRecord(definition.budgets)) return null
  if (!Array.isArray(definition.edges)) return null
  const edges = definition.edges.filter((edge): edge is LegacyEdge => isRecord(edge))

  const positions = definition.positions as readonly PositionDefinition[]
  const labelOf = (nodeId: string): string => {
    if (nodeId === 'start' || nodeId === 'end') return nodeId
    const position = positions.find((candidate) => candidate.id === nodeId)
    return position?.label ?? nodeId
  }

  const used = new Set<string>()
  const byPair = new Map<string, string>()
  const channels: ChannelDefinition[] = []
  for (const edge of edges) {
    const from = typeof edge.from === 'string' ? edge.from : ''
    const to = typeof edge.to === 'string' ? edge.to : ''
    if (from === '' || to === '') continue
    const base = baseChannelId(from, to)
    let id = base
    let suffix = 2
    while (used.has(id)) {
      id = `${base}.${suffix}`
      suffix += 1
    }
    used.add(id)
    byPair.set(`${from}\u0000${to}`, id)
    channels.push({
      id,
      label: `${labelOf(from)} → ${labelOf(to)}`,
      from,
      to,
      ...(Array.isArray(edge.types)
        ? { types: edge.types.filter((type): type is string => typeof type === 'string') }
        : {}),
      ...(edge.back === true ? { back: true } : {}),
    })
  }

  const start = definition.start as Record<string, unknown>
  const rawRoutes = Array.isArray(start.next) ? start.next : []
  const routes: StartRouteDefinition[] = []
  for (const entry of rawRoutes) {
    if (!isRecord(entry)) continue
    const route = entry as LegacyRoute
    const position = typeof route.position === 'string' ? route.position : ''
    const type = typeof route.type === 'string' ? route.type : ''
    if (position === '' || type === '' || !isRecord(route.payload)) continue
    routes.push({
      channel: byPair.get(`start\u0000${position}`) ?? baseChannelId('start', position),
      type,
      payload: route.payload as Record<string, JsonValue>,
      ...(Array.isArray(route.dependsOn)
        ? {
            dependsOn: route.dependsOn.filter(
              (dependency): dependency is string => typeof dependency === 'string',
            ),
          }
        : {}),
    })
  }

  return {
    version: 5,
    name: typeof definition.name === 'string' ? definition.name : '',
    ...(typeof definition.description === 'string' && definition.description !== ''
      ? { description: definition.description }
      : {}),
    budgets: definition.budgets as unknown as BudgetDefinition,
    start: { task: start.task as StartDefinition['task'], next: routes },
    end: definition.end as unknown as EndDefinition,
    positions,
    channels,
  }
}

/**
 * 按 v4 的唯一派发关系，给一条历史任务回填通道 id。
 *
 * 启动任务没有入站通道，返回 null；推不出来时也返回 null，由调用方决定是否记日志。
 *
 * @param definition 已升级的 v5 定义
 * @param task 历史任务（v4 记录）
 * @returns 通道 id 或 null
 */
export function upgradeV4TaskChannel(
  definition: WorkflowDefinition,
  task: {
    readonly id?: unknown
    readonly position?: unknown
    readonly type?: unknown
    readonly createdBy?: { readonly position?: unknown } | null
  },
): string | null {
  if (task.id === START_TASK_ID) return null
  if (typeof task.position !== 'string' || typeof task.type !== 'string') return null
  const from =
    isRecord(task.createdBy) && typeof task.createdBy.position === 'string'
      ? task.createdBy.position
      : null
  if (from === null) return null
  const channels = Array.isArray(definition.channels) ? definition.channels : []
  const channel = channels.find(
    (candidate) =>
      candidate.from === from &&
      candidate.to === task.position &&
      (candidate.types === undefined || candidate.types.includes(task.type as string)),
  )
  return channel?.id ?? null
}
