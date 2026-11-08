/**
 * `buka_robot_build` 工具的定义与执行包装。
 *
 * 放在独立模块里，`defineTool` 与真正的构建函数都由入口注入（与 `service.js`
 * 一致），这样工具的参数 / 结果映射可以脱离 DSH 运行时用假 `defineTool` 单测；
 * 可见性判定与登记表串行队列留在 `index.js`，那里才知道 `sessions` /
 * `agentPresets` 服务与队列。
 *
 * 工具只对「机器人构建」preset 的根会话可见（由入口的 `when` 与
 * `assertAccess` 保证）；页面上的新建 / 配置流程不受影响。
 *
 * @module @buka/dsh-plugin-robots/build-tool
 */

/** 工具名；入口注册与日志都用它。 */
export const ROBOT_BUILD_TOOL_NAME = 'buka_robot_build'

/**
 * 构造 `buka_robot_build` 工具。
 *
 * @param {{
 *   defineTool: Function,
 *   avatarIds: readonly string[],
 *   runBuild: (args: Record<string, unknown>) => Promise<{
 *     robot: { name: string, path: string, avatar: string, createdAt: string },
 *     created: boolean,
 *     updated: boolean,
 *     agentsBytes: number,
 *     mounted: boolean,
 *     workspaceId: unknown,
 *     mountError: string | null,
 *   }>,
 *   assertAccess: (agent: { id?: string } | null | undefined) => void,
 * }} options
 * @returns {Record<string, unknown>} `defineTool` 的返回值，可直接交给 `ctx.tools.register`
 */
export function createRobotBuildTool({ defineTool, avatarIds, runBuild, assertAccess } = {}) {
  if (typeof defineTool !== 'function') throw new TypeError('createRobotBuildTool: defineTool is required')
  if (typeof runBuild !== 'function') throw new TypeError('createRobotBuildTool: runBuild is required')
  if (typeof assertAccess !== 'function') throw new TypeError('createRobotBuildTool: assertAccess is required')
  const avatars = Array.isArray(avatarIds) && avatarIds.length > 0 ? avatarIds.join(', ') : ''

  return defineTool({
    name: ROBOT_BUILD_TOOL_NAME,
    description:
      'Create or update one robot of the Buka Robots plugin and mount it as a DSH workspace. A robot is a directory the plugin manages (by default ~/.cache/dsh-plugin-robots/robots/<name>) whose AGENTS.md tells every session in it who the robot is and how it works. Use this only in the robot-builder preset, after understanding what the user wants the robot to do and after showing them the proposed name, avatar and AGENTS.md and getting their approval. Call buka_robots first so you do not duplicate an existing robot. The tool creates the directory, registers the robot, writes the provided AGENTS.md (the plugin template is used when agents is omitted on create), keeps the CLAUDE.md link, and mounts the robot as a workspace. An existing robot name is rejected unless update: true is passed; pass it only when the user asked to change that robot, and omit the fields that should stay unchanged. Installing project-level skills is a page action (Robots page → the robot → 技能) and is not done by this tool; recommend sources instead. Avatar ids: ' +
      `${avatars}.`,
    parameters: {
      name: {
        type: 'string',
        required: true,
        description:
          'Robot name: 1-64 characters, letters, digits or Chinese plus ".", "_" and "-"; it becomes the directory name and the mounted workspace title.',
      },
      avatar: {
        type: 'string',
        description:
          'Optional avatar id from the list in the description. Omit to let the plugin pick one that is not used yet.',
      },
      agents: {
        type: 'string',
        description:
          'Complete AGENTS.md markdown (role, inputs, workflow, output format, boundaries). Omit on create to keep the plugin template; omit on update to keep the current file.',
      },
      update: {
        type: 'boolean',
        description:
          'Set true only when the user asked to change a robot that already exists. Without it, an existing name is rejected.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true, description: 'Robot name.' },
          path: { type: 'string', required: true, description: 'Absolute robot directory.' },
          avatar: { type: 'string', required: true, description: 'Avatar id stored for the robot.' },
          created: { type: 'boolean', required: true, description: 'Whether this call created the robot.' },
          updated: { type: 'boolean', required: true, description: 'Whether this call changed an existing robot.' },
          agentsBytes: {
            type: 'number',
            required: true,
            description: 'Bytes of AGENTS.md written by this call; 0 when the file was left untouched.',
          },
          mounted: {
            type: 'boolean',
            required: true,
            description: 'Whether a DSH workspace is now mounted at the robot directory.',
          },
          workspaceId: {
            required: true,
            description: 'Mounted workspace id, or null when the robot is not mounted.',
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
          mountError: {
            required: true,
            description: 'Why mounting failed, or null when the robot is mounted.',
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
      },
      render: (_args, value) => {
        const action =
          value?.created === true ? 'Created robot' : value?.updated === true ? 'Updated robot' : 'Robot ready'
        const lines = [
          `${action}: ${String(value?.name ?? '')} (${String(value?.path ?? '')}) · avatar ${String(value?.avatar ?? '')}`,
        ]
        if (typeof value?.agentsBytes === 'number' && value.agentsBytes > 0) {
          lines.push(`AGENTS.md written: ${value.agentsBytes} bytes.`)
        }
        if (value?.mounted === true) {
          const id = typeof value?.workspaceId === 'string' ? ` ${value.workspaceId}` : ''
          lines.push(`Mounted as a workspace${id}.`)
        } else {
          lines.push(
            `Not mounted: ${String(value?.mountError ?? 'unknown error')}. The user can mount it from the Robots page.`,
          )
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      // 这里再判一次：工具可能被没有 `when` 过滤的路径直接调用。
      assertAccess(exec?.agent)
      const result = await runBuild(args ?? {})
      return {
        name: result.robot.name,
        path: result.robot.path,
        avatar: result.robot.avatar,
        created: result.created,
        updated: result.updated,
        agentsBytes: result.agentsBytes,
        mounted: result.mounted,
        workspaceId: typeof result.workspaceId === 'string' ? result.workspaceId : null,
        mountError: result.mountError,
      }
    },
  })
}
