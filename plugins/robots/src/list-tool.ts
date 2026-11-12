/**
 * `buka_robots` 工具的定义与执行包装。
 *
 * 只读工具，列出插件登记表里的机器人：名字、目录、一句职责、挂载状态、
 * AGENTS.md 是否存在，以及（对允许的调用方）项目级 skills 清单。
 *
 * 技能清单按调用方的 agent preset 收窄：工作流编排者只按机器人的一句职责
 * 选人，不应该看到它们装了哪些 skill（见 `access.js` 的
 * `resolveRobotSkillsVisibility`）。隐藏时输出里直接没有 `skills` 字段，
 * 渲染文本里也不会出现技能数量，避免它从「0 skills」「3 skills」反推。
 *
 * 与 `build-tool.js` 一致，`defineTool` 与 `listRobots` 由入口注入，工具定义
 * 可以脱离 DSH 运行时用假实现单测。
 *
 * @module @buka/dsh-plugin-robots/list-tool
 */

import type { defineTool as defineToolType, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { listRobots as listRobotsType, WorkspaceRegistryLike } from './robot-store.ts'

/** 工具名；入口注册与文档都用它。 */
export const ROBOTS_LIST_TOOL_NAME = 'buka_robots'

/**
 * 构造 `buka_robots` 工具。
 *
 */
export function createRobotsListTool({
  defineTool,
  listRobots,
  registryFile,
  robotsDir,
  workspaceRegistry,
  isSkillsVisible,
}: {
  defineTool?: typeof defineToolType
  listRobots?: typeof listRobotsType
  registryFile?: string
  robotsDir?: string
  workspaceRegistry?: WorkspaceRegistryLike | undefined
  isSkillsVisible?: ((agent: { id?: string } | null | undefined) => boolean) | null | undefined
} = {}): ToolDefinition {
  if (typeof defineTool !== 'function')
    throw new TypeError('createRobotsListTool: defineTool is required')
  if (typeof listRobots !== 'function')
    throw new TypeError('createRobotsListTool: listRobots is required')

  return defineTool({
    name: ROBOTS_LIST_TOOL_NAME,
    description:
      'List the subjects a workflow can delegate a node to: agent robots created by the Buka Robots page and the built-in program robots (v1: clock). An agent robot is a directory the plugin created under its own cache directory (default ~/.cache/dsh-plugin-robots/robots) and registered in robots.json, then mounted as a DSH workspace; a program robot is a fixed program with no directory and no session. This is NOT the list of all DSH workspaces: only robots registered by the plugin appear. Each robot reports its driver (agent or program), whether it is an assistant (agent robots only: they take over human tasks), whether it is currently mounted, its one-sentence responsibility statement (what a workflow orchestrator reads to decide which robot should run a node), its project-level skills and whether it has an AGENTS.md. Skills are reported only to callers whose preset may see them. Use this tool when the user asks which robots exist, which are mounted, which are assistants, what a robot is responsible for, what project-level skills it has, or whether it has an AGENTS.md. This tool is read-only: creating, updating or renaming a robot from a chat is available only to the robot-builder preset through buka_robot_build; program robots (clock) cannot be created or removed. Removing robots, mounting them, installing skills, editing AGENTS.md and setting the assistant flag remain user actions on the Robots page.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true, description: 'Robots root directory.' },
          registry: {
            type: 'string',
            required: true,
            description: 'Absolute path of the plugin robots.json registry.',
          },
          corrupt: {
            type: 'boolean',
            required: true,
            description: 'Whether the registry file is unreadable; robots is then empty.',
          },
          robots: {
            type: 'array',
            required: true,
            description: 'Robots in registry order (newest first).',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: 'Robot name.' },
                path: { type: 'string', required: true, description: 'Absolute robot directory.' },
                description: {
                  type: 'string',
                  required: true,
                  description:
                    'One-sentence description of what the robot does and when to use it; empty when none was set.',
                },
                driver: {
                  type: 'string',
                  required: true,
                  description:
                    'How the robot runs: "agent" is a DSH session with a directory and skills, "program" is a fixed program (no directory, no session; v1 only clock).',
                  enum: ['agent', 'program'],
                },
                assistant: {
                  type: 'boolean',
                  required: true,
                  description:
                    'Whether this agent robot is an assistant that can take over human tasks. Program robots are never assistants.',
                },
                program: {
                  required: true,
                  description:
                    'Program id for a program robot (for example "clock"); empty string for agent robots.',
                  oneOf: [{ type: 'string' }, { type: 'null' }],
                },
                mounted: {
                  type: 'boolean',
                  required: true,
                  description: 'Whether a DSH workspace is mounted at this robot directory.',
                },
                workspaceId: {
                  required: true,
                  description: 'Mounted DSH workspace id, or null when not mounted.',
                  oneOf: [{ type: 'string' }, { type: 'null' }],
                },
                skills: {
                  type: 'array',
                  description:
                    'Project-level skills installed in the robot directory; omitted for callers whose preset may not see skills (for example the workflow orchestrator).',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string', required: true, description: 'Skill name.' },
                    },
                  },
                },
                agentsFile: {
                  type: 'boolean',
                  required: true,
                  description: 'Whether the robot directory has an AGENTS.md.',
                },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value?.corrupt === true) {
          return [
            {
              type: 'text',
              text: `The robot registry is unreadable: ${String(value?.registry ?? '')}. Renew or remove that file, then refresh.`,
            },
          ]
        }
        const robots = Array.isArray(value?.robots) ? value.robots : []
        if (robots.length === 0) {
          return [{ type: 'text', text: 'No robots have been created yet.' }]
        }
        return [
          {
            type: 'text',
            text: robots
              .map((robot) => {
                const agents = robot.agentsFile ? 'AGENTS.md' : 'no AGENTS.md'
                const mounted = robot.mounted
                  ? `mounted as ${String(robot.workspaceId)}`
                  : 'not mounted'
                const description =
                  typeof robot.description === 'string' && robot.description !== ''
                    ? robot.description
                    : '(no description)'
                const location =
                  typeof robot.path === 'string' && robot.path !== '' ? ` (${robot.path})` : ''
                const parts = [`- ${robot.name} — ${description}${location}`]
                if (robot.driver === 'program') {
                  const program =
                    typeof robot.program === 'string' && robot.program !== ''
                      ? `: ${robot.program}`
                      : ''
                  parts.push(`program${program}`)
                }
                if (robot.assistant === true) parts.push('assistant')
                // 技能清单被隐藏时连数量也不展示：`skills: []` 与「不让看」是两件事。
                if (Array.isArray(robot.skills)) {
                  const count = robot.skills.length
                  parts.push(count === 1 ? '1 skill' : `${count} skills`)
                }
                parts.push(agents, mounted)
                return parts.join(' · ')
              })
              .join('\n'),
          },
        ]
      },
    },
    async execute(_args, exec) {
      const snapshot = await listRobots({
        file: registryFile,
        workspaceRegistry,
        robotsDir,
      })
      const showSkills =
        typeof isSkillsVisible === 'function' ? isSkillsVisible(exec?.agent) === true : true
      const robots = snapshot.robots.map((robot) => {
        const entry: {
          name: string
          path: string
          description: string
          driver: 'agent' | 'program'
          assistant: boolean
          program: string | null
          mounted: boolean
          workspaceId: string | null
          agentsFile: boolean
          skills?: Array<{ name: string }>
        } = {
          name: robot.name,
          path: robot.path,
          description: robot.description ?? '',
          driver: robot.driver === 'program' ? 'program' : 'agent',
          assistant: robot.assistant === true,
          program: robot.driver === 'program' && robot.program !== '' ? robot.program : null,
          mounted: robot.mounted,
          workspaceId: robot.workspaceId,
          agentsFile: robot.agents.exists,
        }
        if (showSkills) entry.skills = robot.skills.map((skill) => ({ name: skill.name }))
        return entry
      })

      return {
        root: snapshot.root,
        registry: snapshot.registry,
        corrupt: snapshot.corrupt,
        robots,
      }
    },
  })
}
