/**
 * 「执行者」页面的模型工具装配。
 *
 * 注册两个工具：
 *
 * - 只读的 `buka_workers`：让模型回答「有哪些执行者、挂没挂载、是否写了
 *   AGENTS.md、装了什么技能」；
 * - 写工具 `buka_worker_build`：按标识符创建 / 修改执行者（改名只改展示名）、
 *   写 AGENTS.md 并挂到工作区，但**只对随包发布的 `Workflow` 预设的根会话
 *   可见**（Config.builderPresets）。
 *
 * 可见性判定放在本模块，入口只负责传入 preset 名单与登记表写队列。
 *
 * @module @buka/dsh-plugin-workflows/workers/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveWorkerBuildAccess } from './access.ts'
import { AVATAR_IDS } from './avatar.ts'
import { createWorkerBuildTool } from './build-tool.ts'
import { buildWorker } from './builder.ts'
import { createWorkersListTool } from './list-tool.ts'
import { listWorkers } from './worker-store.ts'

/** 工具装配依赖：入口把 Config 解析后的名单与登记表写队列传进来。 */
export interface WorkerToolDeps {
  workersDir: string
  registryFile: string
  /** 能看到 / 调用 `buka_worker_build` 的 preset 名单（Config 可覆盖）。 */
  builderPresets: string[]
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
}

/**
 * 注册只读列举工具与「执行者」preset 的写工具。
 *
 */
export function registerWorkerTools(ctx: Context, deps: WorkerToolDeps): void {
  const { workersDir, registryFile, builderPresets, serializeRegistry } = deps

  /**
   * 取可见性判定要用的 `sessions` / `agentPresets` 服务。
   *
   * 宿主 `sessions.get` 的参数是品牌类型 `SessionId`，判定只按字符串读会话头，
   * 这里收窄成 `access.ts` 需要的最小形状（运行时不区分品牌类型）。
   */
  function accessServices(): {
    sessions:
      | { get: (id: string) => import('./access.ts').AccessSession | null | undefined }
      | undefined
    agentPresets:
      | {
          presetForSession?: (
            session: import('./access.ts').AccessSession,
          ) => string | null | undefined
        }
      | undefined
  } {
    const sessions = ctx.get('sessions')
    const agentPresets = ctx.get('agentPresets')
    return {
      sessions:
        sessions === undefined ? undefined : { get: (id: string) => sessions.get(id as SessionId) },
      agentPresets,
    }
  }

  /**
   * 判定某个 agent 能否看到 / 调用执行者工具。
   *
   * 走 `sessions` + `agentPresets` 两个服务，与工作流插件同一做法；区别是
   * 写操作在服务缺失时收紧为不可见（见 `lib/access.js`）。
   *
   */
  function builderAccessOf(agent: { id?: string } | null | undefined): {
    visible: boolean
    preset: string | null
    reason: string
  } {
    const services = accessServices()
    return resolveWorkerBuildAccess({
      allowed: builderPresets,
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: services.sessions,
      agentPresets: services.agentPresets,
    })
  }

  /** 工具在每一步的可见性条件。 */
  const builderVisibleWhen = (context: ToolActivationContext): boolean =>
    builderAccessOf(context?.agent).visible

  /**
   * 调用时兜底再校验一次：即便绕过 `when` 直接调用也要被挡住。
   *
   */
  function assertWorkerBuilder(agent: { id?: string } | null | undefined): {
    visible: boolean
    preset: string | null
    reason: string
  } {
    const access = builderAccessOf(agent)
    if (access.visible) return access
    throw new Error(
      `buka_worker_build is only available to the ${builderPresets.join(' / ')} preset (reason: ${access.reason})`,
    )
  }

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(
      createWorkersListTool({
        defineTool,
        listWorkers,
        registryFile,
        workersDir,
        workspaceRegistry: ctx.workspaceRegistry,
      }),
    )

    // ---- 「执行者」preset 的写工具 -----------------------------------
    //
    // 只对 Config.builderPresets 点名的 preset 根会话可见；页面上的新建 /
    // 配置流程不受影响，两条路径写的是同一份登记表与目录。
    const buildTool = createWorkerBuildTool({
      defineTool,
      avatarIds: AVATAR_IDS,
      assertAccess: assertWorkerBuilder,
      runBuild: async (args) => {
        const result = await serializeRegistry(() =>
          buildWorker({
            workersDir,
            file: registryFile,
            id: args?.id,
            name: args?.name,
            avatar: args?.avatar,
            description: args?.description,
            agents: args?.agents,
            update: args?.update,
            workspaceRegistry: ctx.workspaceRegistry,
          }),
        )
        ctx.logger?.info?.(
          'buka-workers: %s 执行者 %s（%s，%s）',
          result.created
            ? '已创建'
            : result.renamed
              ? `已改展示名（原 ${result.previousName ?? ''}）`
              : '已更新',
          result.worker.id,
          result.worker.name,
          result.worker.path,
        )
        return result
      },
    })
    toolCtx.tools.register(buildTool, { when: builderVisibleWhen })
  })
}
