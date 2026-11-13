/**
 * 智能体可配置的模型目录：把宿主 LLM 注册表投影成页面用的按提供方分组清单。
 *
 * 目录只用于「给智能体选一个模型」：`available: false` 表示当前组合没有
 * `ctx.llm`（模型目录不可用）；单个提供方读取失败时只记录 failure，其它提供方
 * 仍然可用。模型保存只校验形状，不校验目录成员资格——模型可能暂时不可用
 * （凭据缺失 / 目录未加载），保存的选择要保留下来，等目录恢复后再显示名称。
 *
 * @module @buka/dsh-plugin-workers/model-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import { optionalService } from './engine/session-runtime.ts'
import type { AgentDefaultModelLike } from './service/types.ts'
import type { WorkerModelSelection } from './store/types.ts'

/** 一个模型的推理强度档案。 */
export interface WorkerModelReasoning {
  efforts: Array<{ id: string; name: string; description?: string }>
  defaultEffort?: string
}

/** 目录里的一个模型。 */
export interface WorkerModelEntry {
  id: string
  name: string
  description?: string
  reasoning?: WorkerModelReasoning
}

/** 按提供方分组的模型。 */
export interface WorkerModelGroup {
  id: string
  name: string
  models: WorkerModelEntry[]
}

/** 一个提供方读取失败；其它提供方不受影响。 */
export interface WorkerModelFailure {
  id: string
  name: string
  message: string
}

/** `/buka-workers/models` 的响应体。 */
export interface WorkerModelCatalog {
  available: boolean
  default: WorkerModelSelection | null
  groups: WorkerModelGroup[]
  failures: WorkerModelFailure[]
}

/** 宿主 LLM 注册表里本插件用到的形状。 */
interface LlmProviderLike {
  id?: unknown
  name?: unknown
}

interface LlmModelLike {
  id?: unknown
  name?: unknown
  description?: unknown
}

interface LlmResolvedModelLike extends LlmModelLike {
  reasoning?: {
    efforts?: Array<{ id?: unknown; name?: unknown; description?: unknown }>
    defaultEffort?: unknown
  }
}

interface LlmServiceLike {
  listProviders?(): readonly LlmProviderLike[]
  listModels?(provider: string): Promise<readonly LlmModelLike[]>
  resolveModelInfo?(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelLike>
}

/** 读字符串字段并 trim；不是字符串时返回空串。 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 把宿主默认选择投影成配置形状；缺 provider / model 时返回 null。 */
export function readDefaultSelection(
  defaultModel: AgentDefaultModelLike | undefined,
): WorkerModelSelection | null {
  const selection = defaultModel?.currentSelection?.()
  if (selection === null || selection === undefined) return null
  const provider = readString(selection.provider)
  const model = readString(selection.model)
  if (provider === '' || model === '') return null
  const reasoningEffort = readString(selection.reasoningEffort)
  return {
    provider,
    model,
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
  }
}

/** 把一个提供方的模型目录展开成页面形状。 */
async function readGroup(
  llm: LlmServiceLike,
  provider: LlmProviderLike,
  signal: AbortSignal | undefined,
): Promise<WorkerModelGroup> {
  const id = readString(provider.id)
  const models = typeof llm.listModels === 'function' ? await llm.listModels(id) : []
  const entries = await Promise.all(
    models.map(async (model) => {
      const modelId = readString(model.id)
      if (modelId === '') return null
      const name = readString(model.name) || modelId
      const description = readString(model.description)
      let reasoning: WorkerModelReasoning | undefined
      try {
        const resolved =
          typeof llm.resolveModelInfo === 'function'
            ? await llm.resolveModelInfo(id, modelId, signal)
            : undefined
        const efforts = (resolved?.reasoning?.efforts ?? [])
          .map((effort) => {
            const effortId = readString(effort.id)
            if (effortId === '') return null
            const effortName = readString(effort.name) || effortId
            const effortDescription = readString(effort.description)
            return {
              id: effortId,
              name: effortName,
              ...(effortDescription === '' ? {} : { description: effortDescription }),
            }
          })
          .filter(
            (effort): effort is { id: string; name: string; description?: string } =>
              effort !== null,
          )
        const defaultEffort = readString(resolved?.reasoning?.defaultEffort)
        if (efforts.length > 0) {
          reasoning = {
            efforts,
            ...(defaultEffort === '' ? {} : { defaultEffort }),
          }
        }
      } catch {
        // 推理强度只是选填信息：解析失败不影响模型本身可选。
      }
      return {
        id: modelId,
        name,
        ...(description === '' ? {} : { description }),
        ...(reasoning === undefined ? {} : { reasoning }),
      } satisfies WorkerModelEntry
    }),
  )
  return {
    id,
    name: readString(provider.name) || id,
    models: entries.filter((entry): entry is WorkerModelEntry => entry !== null),
  }
}

/**
 * 读取当前组合的模型目录。
 *
 * @param ctx 宿主上下文
 * @param signal 可选取消信号（页面关闭时由路由传入）
 */
export async function buildWorkerModelCatalog(
  ctx: Context,
  signal?: AbortSignal,
): Promise<WorkerModelCatalog> {
  signal?.throwIfAborted?.()
  const llm = optionalService<LlmServiceLike>(ctx, 'llm')
  const defaultSelection = readDefaultSelection(
    optionalService<AgentDefaultModelLike>(ctx, 'agentDefaultModel'),
  )
  if (llm === undefined || typeof llm.listProviders !== 'function') {
    return { available: false, default: defaultSelection, groups: [], failures: [] }
  }

  const providers = llm.listProviders()
  const settled = await Promise.all(
    providers.map(async (provider) => {
      const id = readString(provider.id)
      const name = readString(provider.name) || id
      if (id === '') {
        return { kind: 'failure' as const, failure: { id, name, message: 'empty provider id' } }
      }
      try {
        return { kind: 'group' as const, group: await readGroup(llm, provider, signal) }
      } catch (error) {
        return {
          kind: 'failure' as const,
          failure: {
            id,
            name,
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    }),
  )
  const groups = settled
    .filter((entry): entry is { kind: 'group'; group: WorkerModelGroup } => entry.kind === 'group')
    .map((entry) => entry.group)
    .filter((group) => group.models.length > 0)
  const failures = settled
    .filter(
      (entry): entry is { kind: 'failure'; failure: WorkerModelFailure } =>
        entry.kind === 'failure',
    )
    .map((entry) => entry.failure)
  return { available: true, default: defaultSelection, groups, failures }
}
