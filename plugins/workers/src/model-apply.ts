/**
 * 给打工人目录里新建的会话套用登记的模型。
 *
 * 页面「新会话」走 DSH 的工作区流程，不会经过 workers 的会话服务；用户在侧边栏
 * 直接打开打工人工作区时也不会。因此 Host 监听 `agent/created`：如果会话的 cwd 是
 * 某个已登记智能体的目录、且会话还没有自己的模型（没有 `model/selection` /
 * `request/header` 事件），就把登记的模型选进这条会话。
 *
 * 只调用 live agent 的 `model.select()`，不动宿主默认模型；用户之后在会话里用
 * `/model` 切换，或恢复一条已有选择的会话，都不会被覆盖。
 *
 * @module @buka/dsh-plugin-workers/model-apply
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { optionalService } from './engine/session-runtime.ts'
import { readDefaultSelection } from './model-catalog.ts'
import type { AgentDefaultModelLike } from './service/types.ts'
import { readWorkerRegistry, type WorkerModelSelection } from './worker-store.ts'

/** live agent 上本模块用到的模型接口。 */
interface AgentModelLike {
  current?(): unknown
  select?(selection: { provider: string; model: string; reasoningEffort?: string }): unknown
}

/** `agent/created` 里本模块用到的 agent 形状。 */
interface AgentLike {
  model?: AgentModelLike
  session?: {
    header?: { cwd?: unknown; origin?: unknown }
    snapshotEvents?(sinceSeq: number): unknown[]
    ownEvents?(): unknown[]
  }
}

/** 判断两个路径是否指向同一个目录（容忍 symlink / realpath 差异）。 */
async function sameDirectory(left: string, right: string): Promise<boolean> {
  if (path.resolve(left) === path.resolve(right)) return true
  try {
    return (await fs.realpath(left)) === (await fs.realpath(right))
  } catch {
    return false
  }
}

/**
 * 读 live agent 当前的模型路由；读不出来时返回 null。
 */
function currentSelection(agent: AgentLike): WorkerModelSelection | null {
  try {
    const value = agent.model?.current?.()
    if (value === null || typeof value !== 'object') return null
    const provider =
      typeof (value as { provider?: unknown }).provider === 'string'
        ? (value as { provider: string }).provider.trim()
        : ''
    const model =
      typeof (value as { model?: unknown }).model === 'string'
        ? (value as { model: string }).model.trim()
        : ''
    if (provider === '' || model === '') return null
    const effort =
      typeof (value as { reasoningEffort?: unknown }).reasoningEffort === 'string'
        ? (value as { reasoningEffort: string }).reasoningEffort.trim()
        : ''
    return { provider, model, ...(effort === '' ? {} : { reasoningEffort: effort }) }
  } catch {
    return null
  }
}

/** 两条选择是否指向同一条模型路由（忽略推理强度）。 */
function sameRoute(left: WorkerModelSelection, right: WorkerModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model
}

/**
 * 会话是否已经选过 / 用过模型。
 *
 * `model/selection` 是显式选择；`request/header` 说明会话已经用某个模型发过请求。
 * 两者任一存在都表示这条会话有自己的模型，不能再拿打工人登记覆盖。新建的空白
 * 会话两个事件都没有——此时 `model.current()` 可能只是宿主默认值，正是要换掉的。
 */
function hasRecordedModel(agent: AgentLike): boolean {
  const session = agent.session
  let events: unknown[] = []
  try {
    events = session?.snapshotEvents?.(0) ?? session?.ownEvents?.() ?? []
  } catch {
    return true
  }
  return events.some(
    (event) =>
      event !== null &&
      typeof event === 'object' &&
      ['model/selection', 'request/header'].includes(
        String((event as { type?: unknown }).type ?? ''),
      ),
  )
}

/** 给新建的 agent 套用打工人目录对应的模型。 */
async function applyWorkerModel(
  ctx: Context,
  registryFile: string,
  payload: unknown,
): Promise<void> {
  const agent = (payload as { agent?: AgentLike } | null | undefined)?.agent
  if (agent?.model?.select === undefined) return
  const header = agent.session?.header
  // 子 agent 有自己的 preset / 模型配置，不套用父目录打工人的模型。
  if (header?.origin === 'subagent') return
  const cwd = header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return
  // 恢复的会话 / 用户切过模型的会话：已经有自己的模型，不再覆盖。
  if (hasRecordedModel(agent)) return
  // 调用方显式给了非默认模型（例如工作流的 agentOptions 覆盖）：保留它。
  const current = currentSelection(agent)
  if (current !== null) {
    const hostDefault = readDefaultSelection(
      optionalService<AgentDefaultModelLike>(ctx, 'agentDefaultModel'),
    )
    if (hostDefault === null || !sameRoute(current, hostDefault)) return
  }

  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) return
  let target: (typeof registry.workers)[number] | undefined
  for (const worker of registry.workers) {
    if (worker.driver !== 'agent' || worker.model === undefined) continue
    if (await sameDirectory(worker.path, cwd)) {
      target = worker
      break
    }
  }
  if (target?.model === undefined) return

  agent.model.select({
    provider: target.model.provider,
    model: target.model.model,
    ...(target.model.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: target.model.reasoningEffort }),
  })
  ctx.logger?.info?.(
    'buka-workers: 已为打工人 %s 的新会话选择模型 %s/%s',
    target.name,
    target.model.provider,
    target.model.model,
  )
}

/**
 * 注册 `agent/created` 监听；插件卸载时随 effect 一起撤销。
 *
 * @param ctx 宿主上下文
 * @param registryFile 打工人登记文件
 */
export function registerWorkerModelEnforcement(ctx: Context, registryFile: string): void {
  ctx.effect(
    () =>
      ctx.on('agent/created', (payload) =>
        applyWorkerModel(ctx, registryFile, payload)
          .then(() => undefined)
          .catch((error: unknown) => {
            ctx.logger?.warn?.(
              'buka-workers: 应用智能体模型失败：%s',
              error instanceof Error ? error.message : String(error),
            )
            return undefined
          }),
      ),
    'buka-workers: apply worker model on agent/created',
  )
}
