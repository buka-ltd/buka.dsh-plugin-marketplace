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

import type { defineTool as defineToolType, ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 工具名；入口注册与日志都用它。 */
export const ROBOT_BUILD_TOOL_NAME = 'buka_robot_build'

/**
 * 构造 `buka_robot_build` 工具。
 *
 */
export function createRobotBuildTool({
  defineTool,
  avatarIds,
  runBuild,
  assertAccess,
}: {
  defineTool?: typeof defineToolType
  avatarIds?: readonly string[]
  runBuild?: (args: Record<string, unknown>) => Promise<{
    robot: {
      name: string
      driver: 'agent'
      path: string
      avatar: string
      description: string
      createdAt: string
      assistant: boolean
    }
    created: boolean
    updated: boolean
    renamed: boolean
    previousName: string | null
    agentsBytes: number
    mounted: boolean
    workspaceId: unknown
    mountError: string | null
  }>
  assertAccess?: (agent: { id?: string } | null | undefined) => void
} = {}): ToolDefinition {
  if (typeof defineTool !== 'function')
    throw new TypeError('createRobotBuildTool: defineTool is required')
  if (typeof runBuild !== 'function')
    throw new TypeError('createRobotBuildTool: runBuild is required')
  if (typeof assertAccess !== 'function')
    throw new TypeError('createRobotBuildTool: assertAccess is required')
  const avatars = Array.isArray(avatarIds) && avatarIds.length > 0 ? avatarIds.join(', ') : ''

  return defineTool({
    name: ROBOT_BUILD_TOOL_NAME,
    description:
      'Create, update or rename one robot of the Buka Robots plugin and mount it as a DSH workspace. A robot is a directory the plugin manages (by default ~/.cache/dsh-plugin-robots/robots/<name>) whose AGENTS.md tells every session in it who the robot is and how it works. Use this only in the robot-builder preset, after understanding what the user wants the robot to do and after showing them the proposed name, avatar, description and AGENTS.md and getting their approval. Call buka_robots first so you do not duplicate an existing robot. The tool creates the directory, registers the robot, writes the provided AGENTS.md (the plugin template is used when agents is omitted on create), keeps the CLAUDE.md link, and mounts the robot as a workspace. An existing robot name is rejected unless update: true is passed; pass it only when the user asked to change that robot, and omit the fields that should stay unchanged. To rename that existing robot, also pass newName: the directory is renamed and its DSH workspace is re-registered at the new path, so earlier conversations stay in history but are no longer listed under the robot — confirm the new name with the user first. Installing project-level skills is a page action (Robots page → the robot → 技能) and is not done by this tool; recommend sources instead. Each robot also needs a one-sentence description: it is what a workflow orchestrator reads to decide whether to delegate a node to that robot (like a skill description). Avatar ids: ' +
      `${avatars}. Robots created here are agent robots; the assistant flag starts false and can be turned on for an agent robot on the Robots page.`,
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
      description: {
        type: 'string',
        required: true,
        description:
          'One sentence describing what this robot does and when to use it; a workflow orchestrator reads it to pick robots for nodes. Empty string keeps the current description when update: true (and leaves it empty on create).',
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
      newName: {
        type: 'string',
        description:
          'Optional new name when the user asked to rename an existing robot: pass name as the current name, newName as the new one, and update: true. Renaming moves the robot directory and re-registers its DSH workspace; earlier conversations stay in history but are no longer listed under the robot, so confirm with the user first. Same rules as name: 1-64 characters, letters, digits or Chinese plus ".", "_" and "-".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true, description: 'Robot name.' },
          path: { type: 'string', required: true, description: 'Absolute robot directory.' },
          avatar: {
            type: 'string',
            required: true,
            description: 'Avatar id stored for the robot.',
          },
          description: {
            type: 'string',
            required: true,
            description: 'One-sentence description stored for the robot; empty when none was set.',
          },
          assistant: {
            type: 'boolean',
            required: true,
            description:
              'Whether the robot is marked as an assistant. Robots created by this tool are agent robots and start with false.',
          },
          created: {
            type: 'boolean',
            required: true,
            description: 'Whether this call created the robot.',
          },
          updated: {
            type: 'boolean',
            required: true,
            description: 'Whether this call changed an existing robot.',
          },
          renamed: {
            type: 'boolean',
            required: true,
            description:
              'Whether this call renamed an existing robot (moved its directory and re-registered its workspace).',
          },
          previousName: {
            required: true,
            description: 'Robot name before this call when it renamed the robot, otherwise null.',
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
          agentsBytes: {
            type: 'number',
            required: true,
            description:
              'Bytes of AGENTS.md written by this call; 0 when the file was left untouched.',
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
        const previousName =
          typeof value?.previousName === 'string' && value.previousName !== ''
            ? value.previousName
            : null
        const renamed = value?.renamed === true && previousName !== null
        const action =
          value?.created === true
            ? 'Created robot'
            : renamed
              ? `Renamed robot: ${previousName} → ${String(value?.name ?? '')}`
              : value?.updated === true
                ? 'Updated robot'
                : 'Robot ready'
        const description = String(value?.description ?? '')
        const identity = renamed
          ? `${action} (${String(value?.path ?? '')}) · avatar ${String(value?.avatar ?? '')}`
          : `${action}: ${String(value?.name ?? '')} (${String(value?.path ?? '')}) · avatar ${String(value?.avatar ?? '')}`
        const lines = [identity, `Description: ${description === '' ? '(none)' : description}`]
        if (renamed) {
          lines.push(
            'The workspace was re-registered at the new path; earlier conversations stay in history but are no longer listed under the robot.',
          )
        }
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
        description: result.robot.description,
        assistant: result.robot.assistant === true,
        created: result.created,
        updated: result.updated,
        renamed: result.renamed === true,
        previousName: typeof result.previousName === 'string' ? result.previousName : null,
        agentsBytes: result.agentsBytes,
        mounted: result.mounted,
        workspaceId: typeof result.workspaceId === 'string' ? result.workspaceId : null,
        mountError: result.mountError,
      }
    },
  })
}
