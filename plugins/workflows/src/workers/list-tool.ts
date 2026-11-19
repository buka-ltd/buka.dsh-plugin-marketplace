/**
 * `buka_workers` 工具的定义与执行包装。
 *
 * 只读工具，列出插件登记表里的执行者：标识符、展示名、目录、一句职责、挂载
 * 状态、AGENTS.md 是否存在，以及项目级 skills 清单。
 *
 * 执行者有不可变标识符 `id`（工作流的引用键、目录名）和可选展示名 `name`
 * （空串表示未设置，展示时回退到 `id`）。输出两个字段都给；文本摘要用
 * 「展示名（id）」帮调用方消歧。
 *
 * 技能清单对所有能拿到该工具的调用方可见：合并包只发布一个 `Workflow` 预设，
 * 它同时承担建执行者与排流程，「定岗只看一句职责、技能清单只用于推荐」的
 * 纪律由该预设的 persona 约束，不再在工具层隐藏。
 *
 * 与 `build-tool.js` 一致，`defineTool` 与 `listWorkers` 由入口注入，工具定义
 * 可以脱离 DSH 运行时用假实现单测。
 *
 * @module @buka/dsh-plugin-workflows/workers/list-tool
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
}: {
  defineTool?: typeof defineToolType
  listWorkers?: typeof listWorkersType
  registryFile?: string
  workersDir?: string
  workspaceRegistry?: WorkspaceRegistryLike | undefined
} = {}): ToolDefinition {
  if (typeof defineTool !== 'function')
    throw new TypeError('createWorkersListTool: defineTool is required')
  if (typeof listWorkers !== 'function')
    throw new TypeError('createWorkersListTool: listWorkers is required')

  return defineTool({
    name: WORKERS_LIST_TOOL_NAME,
    description:
      'List the subjects a workflow can delegate a node to: agents created by the Buka Workers page and the built-in robots (v1: clock). Each worker has an immutable identifier (id) and an optional display name (name); the id is the reference key used by workflows and the directory name, while the name is only shown in the UI and falls back to the id when empty. An agent is a directory the plugin created under its own cache directory (default ~/.cache/dsh-plugin-workers/workers/<id>) and registered in workers.json, then mounted as a DSH workspace; a robot is a fixed program with no directory and no session. This is NOT the list of all DSH workspaces: only workers registered by the plugin appear. Each worker reports its id, display name, driver (agent or robot), whether it is currently mounted, its one-sentence responsibility statement (what a workflow orchestrator reads to decide which worker should run a node), its project-level skills and whether it has an AGENTS.md. Use this tool when the user asks which workers exist, which are mounted, what a worker is responsible for, what project-level skills it has, or whether it has an AGENTS.md. This tool is read-only: creating, updating or renaming a worker from a chat is available only to the Workflow preset through buka_worker_build; robots (clock) cannot be created or removed. Removing workers, mounting them, installing skills and editing AGENTS.md remain user actions on the Workers page.',
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
                id: {
                  type: 'string',
                  required: true,
                  description:
                    'Immutable worker identifier: the reference key and the worker directory name.',
                },
                name: {
                  type: 'string',
                  required: true,
                  description:
                    'Display name; empty when none is set, in which case the id is shown.',
                },
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
                  description: 'Project-level skills installed in the worker directory.',
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
                const id = String(worker.id ?? '')
                const name = typeof worker.name === 'string' ? worker.name : ''
                // 「展示名（id）」；没设名称时只写一次 id，避免 `writer (writer)`。
                const identity = name === '' ? id : `${name} (${id})`
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
                const parts = [`- ${identity} — ${description}${location}`]
                if (worker.driver === 'robot') {
                  const program =
                    typeof worker.program === 'string' && worker.program !== ''
                      ? `: ${worker.program}`
                      : ''
                  parts.push(`program${program}`)
                }
                // 技能数量随清单一起展示。
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
    async execute(_args) {
      const snapshot = await listWorkers({
        file: registryFile,
        workspaceRegistry,
        workersDir,
      })
      const workers = snapshot.workers.map((worker) => {
        const entry: {
          id: string
          name: string
          path: string
          description: string
          driver: 'agent' | 'robot'
          program: string | null
          mounted: boolean
          workspaceId: string | null
          agentsFile: boolean
          skills: Array<{ name: string }>
        } = {
          id: worker.id,
          name: typeof worker.name === 'string' ? worker.name : '',
          path: worker.path,
          description: worker.description ?? '',
          driver: worker.driver === 'robot' ? 'robot' : 'agent',
          program: worker.driver === 'robot' && worker.program !== '' ? worker.program : null,
          mounted: worker.mounted,
          workspaceId: worker.workspaceId,
          agentsFile: worker.agents.exists,
          skills: worker.skills.map((skill) => ({ name: skill.name })),
        }
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
