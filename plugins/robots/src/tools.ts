/**
 * 「机器人」页面的模型工具装配。
 *
 * 注册两个工具：
 *
 * - 只读的 `buka_robots`：让模型回答「有哪些机器人、挂没挂载、是否写了
 *   AGENTS.md、装了什么技能」（工作流编排 preset 固定看不到技能清单）；
 * - 写工具 `buka_robot_build`：创建 / 修改 / 重命名机器人、写 AGENTS.md 并挂到
 *   工作区，但**只对随包发布的「机器人构建」preset 的根会话可见**
 *   （Config.builderPresets）。
 *
 * 可见性判定放在本模块，入口只负责传入 preset 名单与登记表写队列。
 *
 * @module @buka/dsh-plugin-robots/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveRobotBuildAccess, resolveRobotSkillsVisibility } from './access.ts'
import { AVATAR_IDS } from './avatar.ts'
import { createRobotBuildTool } from './build-tool.ts'
import { buildRobot } from './builder.ts'
import { createRobotsListTool } from './list-tool.ts'
import { listRobots } from './robot-store.ts'

/** 工具装配依赖：入口把 Config 解析后的名单与登记表写队列传进来。 */
export interface RobotToolDeps {
  robotsDir: string
  registryFile: string
  /** 能看到 / 调用 `buka_robot_build` 的 preset 名单（Config 可覆盖）。 */
  builderPresets: string[]
  serializeRegistry: <T>(work: () => Promise<T>) => Promise<T>
}

/**
 * 注册只读列举工具与「机器人构建」preset 的写工具。
 *
 */
export function registerRobotTools(ctx: Context, deps: RobotToolDeps): void {
  const { robotsDir, registryFile, builderPresets, serializeRegistry } = deps

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
   * 判定某个 agent 能否看到 / 调用机器人构建工具。
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
    return resolveRobotBuildAccess({
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
   * 判定某个 agent 能否看到 `buka_robots` 输出的机器人技能清单。
   *
   * 工作流编排 preset 固定看不到：编排者只按一句职责选人，不按技能清单。
   *
   */
  function skillsVisibleFor(agent: { id?: string } | null | undefined): boolean {
    const services = accessServices()
    return resolveRobotSkillsVisibility({
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: services.sessions,
      agentPresets: services.agentPresets,
    }).visible
  }

  /**
   * 调用时兜底再校验一次：即便绕过 `when` 直接调用也要被挡住。
   *
   */
  function assertRobotBuilder(agent: { id?: string } | null | undefined): {
    visible: boolean
    preset: string | null
    reason: string
  } {
    const access = builderAccessOf(agent)
    if (access.visible) return access
    throw new Error(
      `buka_robot_build is only available to the ${builderPresets.join(' / ')} preset (reason: ${access.reason})`,
    )
  }

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(
      createRobotsListTool({
        defineTool,
        listRobots,
        registryFile,
        robotsDir,
        workspaceRegistry: ctx.workspaceRegistry,
        isSkillsVisible: skillsVisibleFor,
      }),
    )

    // ---- 「机器人构建」preset 的写工具 -----------------------------------
    //
    // 只对 Config.builderPresets 点名的 preset 根会话可见；页面上的新建 /
    // 配置流程不受影响，两条路径写的是同一份登记表与目录。
    const buildTool = createRobotBuildTool({
      defineTool,
      avatarIds: AVATAR_IDS,
      assertAccess: assertRobotBuilder,
      runBuild: async (args) => {
        const result = await serializeRegistry(() =>
          buildRobot({
            robotsDir,
            file: registryFile,
            name: args?.name,
            avatar: args?.avatar,
            description: args?.description,
            agents: args?.agents,
            update: args?.update,
            newName: args?.newName,
            workspaceRegistry: ctx.workspaceRegistry,
          }),
        )
        ctx.logger?.info?.(
          'buka-robots: %s 机器人 %s（%s）',
          result.created
            ? '已创建'
            : result.renamed
              ? `已重命名（原 ${result.previousName}）`
              : '已更新',
          result.robot.name,
          result.robot.path,
        )
        return result
      },
    })
    toolCtx.tools.register(buildTool, { when: builderVisibleWhen })
  })
}
