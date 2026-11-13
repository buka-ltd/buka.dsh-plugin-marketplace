/**
 * `buka_workers` 工具的定义与执行包装。
 *
 * 只读工具，列出插件登记表里的打工人：名字、目录、一句职责、挂载状态、
 * AGENTS.md 是否存在，以及（对允许的调用方）项目级 skills 清单。
 *
 * 技能清单按调用方的 agent preset 收窄：工作流编排者只按打工人的一句职责
 * 选人，不应该看到它们装了哪些 skill（见 `access.js` 的
 * `resolveWorkerSkillsVisibility`）。隐藏时输出里直接没有 `skills` 字段，
 * 渲染文本里也不会出现技能数量，避免它从「0 skills」「3 skills」反推。
 *
 * 与 `build-tool.js` 一致，`defineTool` 与 `listWorkers` 由入口注入，工具定义
 * 可以脱离 DSH 运行时用假实现单测。
 *
 * @module @buka/dsh-plugin-workers/list-tool
 */

import type { defineTool as defineToolType, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { listWorkers as listWorkersType, WorkspaceRegistryLike } from './worker-store.ts'

/** 工具名；入口注册与文档都用它。 */
export const WORKERS_LIST_TOOL_NAME = 'buka_workers'

/**
 * 构造 `buka_workers` 工具。
 *
 */
export function createWorkersListTool({
  defineTool,
  listWorkers,
  registryFile,
  workersDir,
  workspaceRegistry,
  isSkillsVisible,
}: {
  defineTool?: typeof defineToolType
  listWorkers?: typeof listWorkersType
  registryFile?: string
  workersDir?: string
  workspaceRegistry?: WorkspaceRegistryLike | undefined
  isSkillsVisible?: ((agent: { id?: string } | null | undefined) => boolean) | null | undefined
} = {}): ToolDefinition {
  if (typeof defineTool !== 'function')
    throw new TypeError('createWorkersListTool: defineTool is required')
  if (typeof listWorkers !== 'function')
    throw new TypeError('createWorkersListTool: listWorkers is required')

  return defineTool({
    name: WORKERS_LIST_TOOL_NAME,
    description:
      'List the subjects a workflow can delegate a node to: agents created by the Buka Workers page and the built-in robots (v1: clock). An agent is a directory the plugin created under its own cache directory (default ~/.cache/dsh-plugin-workers/workers) and registered in workers.json, then mounted as a DSH workspace; a robot is a fixed program with no directory and no session. This is NOT the list of all DSH workspaces: only workers registered by the plugin appear. Each worker reports its driver (agent or robot), whether it is an assistant (agents only: they take over human tasks), whether it is currently mounted, its one-sentence responsibility statement (what a workflow orchestrator reads to decide which worker should run a node), its project-level skills and whether it has an AGENTS.md. Skills are reported only to callers whose preset may see them. Use this tool when the user asks which workers exist, which are mounted, which are assistants, what a worker is responsible for, what project-level skills it has, or whether it has an AGENTS.md. This tool is read-only: creating, updating or renaming a worker from a chat is available only to the worker-builder preset through buka_worker_build; robots (clock) cannot be created or removed. Removing workers, mounting them, installing skills, editing AGENTS.md and setting the assistant flag remain user actions on the Workers page.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true, description: 'Workers root directory.' },
          registry: {
            type: 'string',
            required: true,
            description: 'Absolute path of the plugin workers.json registry.',
          },
          corrupt: {
            type: 'boolean',
            required: true,
            description: 'Whether the registry file is unreadable; workers is then empty.',
          },
          workers: {
            type: 'array',
            required: true,
            description: 'Workers in registry order (newest first).',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: 'Worker name.' },
                path: { type: 'string', required: true, description: 'Absolute worker directory.' },
                description: {
                  type: 'string',
                  required: true,
                  description:
                    'One-sentence description of what the worker does and when to use it; empty when none was set.',
                },
                driver: {
                  type: 'string',
                  required: true,
                  description:
                    'How the worker runs: "agent" is a DSH session with a directory and skills, "robot" is a fixed program (no directory, no session; v1 only clock).',
                  enum: ['agent', 'robot'],
                },
                assistant: {
                  type: 'boolean',
                  required: true,
                  description:
                    'Whether this agent is an assistant that can take over human tasks. Robots are never assistants.',
                },
                program: {
                  required: true,
                  description:
                    'Program id for a robot (for example "clock"); empty string for agents.',
                  oneOf: [{ type: 'string' }, { type: 'null' }],
                },
                mounted: {
                  type: 'boolean',
                  required: true,
                  description: 'Whether a DSH workspace is mounted at this worker directory.',
                },
                workspaceId: {
                  required: true,
                  description: 'Mounted DSH workspace id, or null when not mounted.',
                  oneOf: [{ type: 'string' }, { type: 'null' }],
                },
                skills: {
                  type: 'array',
                  description:
                    'Project-level skills installed in the worker directory; omitted for callers whose preset may not see skills (for example the workflow orchestrator).',
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
                  description: 'Whether the worker directory has an AGENTS.md.',
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
              text: `The worker registry is unreadable: ${String(value?.registry ?? '')}. Renew or remove that file, then refresh.`,
            },
          ]
        }
        const workers = Array.isArray(value?.workers) ? value.workers : []
        if (workers.length === 0) {
          return [{ type: 'text', text: 'No workers have been created yet.' }]
        }
        return [
          {
            type: 'text',
            text: workers
              .map((worker) => {
                const agents = worker.agentsFile ? 'AGENTS.md' : 'no AGENTS.md'
                const mounted = worker.mounted
                  ? `mounted as ${String(worker.workspaceId)}`
                  : 'not mounted'
                const description =
                  typeof worker.description === 'string' && worker.description !== ''
                    ? worker.description
                    : '(no description)'
                const location =
                  typeof worker.path === 'string' && worker.path !== '' ? ` (${worker.path})` : ''
                const parts = [`- ${worker.name} — ${description}${location}`]
                if (worker.driver === 'robot') {
                  const program =
                    typeof worker.program === 'string' && worker.program !== ''
                      ? `: ${worker.program}`
                      : ''
                  parts.push(`program${program}`)
                }
                if (worker.assistant === true) parts.push('assistant')
                // 技能清单被隐藏时连数量也不展示：`skills: []` 与「不让看」是两件事。
                if (Array.isArray(worker.skills)) {
                  const count = worker.skills.length
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
      const snapshot = await listWorkers({
        file: registryFile,
        workspaceRegistry,
        workersDir,
      })
      const showSkills =
        typeof isSkillsVisible === 'function' ? isSkillsVisible(exec?.agent) === true : true
      const workers = snapshot.workers.map((worker) => {
        const entry: {
          name: string
          path: string
          description: string
          driver: 'agent' | 'robot'
          assistant: boolean
          program: string | null
          mounted: boolean
          workspaceId: string | null
          agentsFile: boolean
          skills?: Array<{ name: string }>
        } = {
          name: worker.name,
          path: worker.path,
          description: worker.description ?? '',
          driver: worker.driver === 'robot' ? 'robot' : 'agent',
          assistant: worker.assistant === true,
          program: worker.driver === 'robot' && worker.program !== '' ? worker.program : null,
          mounted: worker.mounted,
          workspaceId: worker.workspaceId,
          agentsFile: worker.agents.exists,
        }
        if (showSkills) entry.skills = worker.skills.map((skill) => ({ name: skill.name }))
        return entry
      })

      return {
        root: snapshot.root,
        registry: snapshot.registry,
        corrupt: snapshot.corrupt,
        workers,
      }
    },
  })
}
