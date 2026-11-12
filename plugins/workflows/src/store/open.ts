/**
 * 从宿主 `ctx.storageDomain` 打开 `buka-workflow` 域，构造 `WorkflowStore`。
 *
 * storageDomain 不放进 cordis `inject`：缺少它的组合里插件仍应加载，只在真正
 * 需要存储时给出明确错误。打开后把 `Domain.close()` 挂到插件生命周期上。
 *
 * @module @buka/dsh-plugin-workflows/store/open
 */

import type { Context } from '@deepseek-ai/cordis'

import { type LoggerLike, type WorkflowDomainLike, WorkflowStore } from './index.ts'
import { workflowDomain } from './schema.ts'

/** 打开存储的入参。 */
export interface OpenWorkflowStoreOptions {
  /** 插件数据目录（大文本与附件）。 */
  readonly dataDir: string
  readonly logger?: LoggerLike | undefined
}

/**
 * 打开存储域并初始化。
 *
 * @param ctx 插件上下文
 * @param options 数据目录与日志
 * @returns 已初始化的存储
 * @throws 宿主缺少 storageDomain 服务 / 打开失败时抛出
 */
export function openWorkflowStore(
  ctx: Context,
  options: OpenWorkflowStoreOptions,
): Promise<WorkflowStore> {
  // 不能直接读 `ctx.storageDomain`：该服务没有写进 `inject`，cordis 会抛
  // `cannot get property "storageDomain" without inject`。可选服务一律用
  // `ctx.get(name)`，并兜住 isolate 等情况下可能抛出的异常。
  const facility = (() => {
    try {
      return ctx.get('storageDomain')
    } catch {
      return undefined
    }
  })()
  if (facility === undefined || facility === null || typeof facility.open !== 'function') {
    return Promise.reject(
      new Error(
        'the host storage domain service is unavailable in this composition (ctx.storageDomain is missing); update DeepSeek Harness or enable the dsh-storage-domain plugin',
      ),
    )
  }

  let domain: WorkflowDomainLike | undefined
  // 生命周期在 apply 阶段同步登记，避免 await 之后挂到已释放的 context 上。
  ctx.effect(
    () => () => {
      if (domain !== undefined) void domain.close().catch(() => undefined)
    },
    'buka-workflows: close workflow storage domain',
  )

  return (async () => {
    const opened = await facility.open(workflowDomain)
    domain = opened as unknown as WorkflowDomainLike
    const store = new WorkflowStore({
      domain,
      dataDir: options.dataDir,
      logger: options.logger,
    })
    try {
      await store.init()
    } catch (error) {
      await domain.close().catch(() => undefined)
      domain = undefined
      throw error
    }
    return store
  })()
}
