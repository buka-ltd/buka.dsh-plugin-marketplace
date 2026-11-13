/**
 * `@buka/dsh-plugin-workflows` 宿主一半入口：只做装配。
 *
 * 工作流是持久定义，作业是运行容器；任务级看板、显式依赖、内建开始 / 结束、
 * 人任务与助理都由引擎驱动。业务状态进 `ctx.storageDomain`，大文本与附件进
 * 插件数据目录，旧的运行目录由 `migration.ts` 在首次启动时删除。
 *
 * 装配顺序：
 *
 * 1. 解析配置；
 * 2. `ensureReady`：硬切换迁移 → 打开 storageDomain → 构造引擎 → 恢复未完成作业；
 * 3. 注册工具（可见性按编排 preset / 编排工作区 / 任务会话收窄）；
 * 4. 注册 `/job` 命令（宿主不支持命令注册时降级为工具）；
 * 5. 注册浏览器路由。
 *
 * `storageDomain` 不放进 `inject`：缺少它的组合里插件仍然加载，只在真正需要
 * 存储时给出明确错误。
 *
 * @module @buka/dsh-plugin-workflows
 */

import type { Context } from '@deepseek-ai/cordis'

import type { WorkflowAccess } from './access.ts'
import { resolveWorkflowAccess } from './access.ts'
import { registerJobCommand } from './commands/job.ts'
import { WorkflowEngine } from './engine/engine.ts'
import { createHostSessionDelivery } from './engine/session.ts'
import type { WorkersServiceLike } from './engine/types.ts'
import { describeError } from './engine/types.ts'
import { runMigrations } from './migration.ts'
import type { WorkflowsConfig } from './options.ts'
import { resolveOptions } from './options.ts'
import { registerWorkflowRoutes } from './routes/index.ts'
import { openWorkflowStore } from './store/open.ts'
import { registerWorkflowTools } from './tools/index.ts'

export type { WorkflowsConfig } from './options.ts'
export { Config, defaultDataDir, resolveDataDir } from './options.ts'

/** Cordis 插件名；与 cordis.patch.yml 的补丁行 id 保持一致。 */
export const name = 'tool-buka-workflows'

/** 依赖的服务：工具注册表。其余服务（storageDomain / webServer / commands / bukaWorkers）按需可选获取。 */
export const inject = ['tools']

/**
 * 装配插件。
 *
 * @param ctx 插件上下文
 * @param config 插件配置
 */
export function apply(ctx: Context, config: WorkflowsConfig): void {
  const options = resolveOptions(config)
  let engine: WorkflowEngine | undefined
  let ready: Promise<WorkflowEngine> | undefined

  /** 引擎与存储当前实例；卸载时按登记顺序释放。 */
  ctx.effect(
    () => () => {
      engine?.dispose()
      engine = undefined
    },
    'buka-workflows: dispose engine',
  )

  /**
   * 初始化：迁移 → 打开存储 → 构造引擎 → 恢复。只做一次。
   *
   * @returns 就绪的引擎
   */
  function ensureReady(): Promise<WorkflowEngine> {
    ready ??= (async () => {
      await runMigrations({ dataDir: options.dataDir, logger: ctx.logger })
      const store = await openWorkflowStore(ctx, {
        dataDir: options.dataDir,
        logger: ctx.logger,
      })
      const created = new WorkflowEngine({
        ctx,
        store,
        options,
        logger: ctx.logger,
        workers: () => (ctx.get('bukaWorkers') ?? null) as WorkersServiceLike | null,
        delivery: createHostSessionDelivery(ctx),
      })
      engine = created
      await created.start()
      return created
    })()
    return ready
  }

  // 插件加载后就开始恢复未完成作业，不必等到第一次打开页面。
  void ensureReady().catch((error) => {
    ctx.logger?.warn?.(`buka-workflows: 初始化工作流存储失败：${describeError(error)}`)
  })

  /** 判定某个 agent 能否看到 / 调用工作流定义工具（编排 preset 根会话）。 */
  function accessOf(agent: { id?: unknown } | null | undefined): WorkflowAccess {
    return resolveWorkflowAccess({
      allowed: options.orchestratorPresets,
      allowedWorkspaces: options.orchestratorWorkspaces,
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: ctx.get('sessions'),
      agentPresets: ctx.get('agentPresets'),
    })
  }

  /** 定义工具可见性（同步判定，供每一步的 when 使用）。 */
  const orchestratorVisible = (context: { agent?: { id?: unknown } }): boolean =>
    accessOf(context.agent).visible

  /** 执行会话可见性：该会话正在执行一条任务（启动 / agent / 助理）。 */
  const executionVisible = async (context: { agent?: { id?: unknown } }): Promise<boolean> => {
    const sessionId = typeof context.agent?.id === 'string' ? context.agent.id : ''
    if (sessionId === '') return false
    const current = await ensureReady()
    return current.taskForSession(sessionId) !== null
  }

  /** 启动者 / 执行会话可见性：作业状态与取消。 */
  const starterVisible = async (context: { agent?: { id?: unknown } }): Promise<boolean> => {
    const sessionId = typeof context.agent?.id === 'string' ? context.agent.id : ''
    if (sessionId === '') return false
    const current = await ensureReady()
    return current.taskForSession(sessionId) !== null || current.jobIdForSession(sessionId) !== null
  }

  registerWorkflowTools({
    ctx,
    ready: ensureReady,
    options,
    orchestratorVisible,
    executionVisible,
    starterVisible,
    assertOrchestrator: (agent) => {
      const access = accessOf(agent)
      if (access.visible) return
      throw new Error(
        `workflow definition tools are only available to the ${options.orchestratorPresets.join(' / ')} preset or to sessions started in the configured orchestrator workspaces (reason: ${access.reason})`,
      )
    },
  })

  const commandRegistered = registerJobCommand({ ctx, ready: ensureReady })
  if (!commandRegistered) {
    ctx.logger?.info?.(
      'buka-workflows: the host commands service cannot register /job; ordinary sessions can use the buka_job_start tool instead',
    )
  }

  registerWorkflowRoutes({ ctx, ready: ensureReady })
}
