/**
 * `buka_worker_build` 工具的定义与执行包装。
 *
 * 放在独立模块里，`defineTool` 与真正的构建函数都由入口注入（与 `service.js`
 * 一致），这样工具的参数 / 结果映射可以脱离 DSH 运行时用假 `defineTool` 单测；
 * 可见性判定与登记表串行队列留在 `index.js`，那里才知道 `sessions` /
 * `agentPresets` 服务与队列。
 *
 * 工具只对「执行者」preset 的根会话可见（由入口的 `when` 与
 * `assertAccess` 保证）；页面上的新建 / 配置流程不受影响。
 *
 * @module @buka/dsh-plugin-workflows/workers/build-tool
 */

import type { defineTool as defineToolType, ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 工具名；入口注册与日志都用它。 */
export const WORKER_BUILD_TOOL_NAME = 'buka_worker_build'

/**
 * 构造 `buka_worker_build` 工具。
 *
 */
export function createWorkerBuildTool({
  defineTool,
  avatarIds,
  runBuild,
  assertAccess,
}: {
  defineTool?: typeof defineToolType
  avatarIds?: readonly string[]
  runBuild?: (args: Record<string, unknown>) => Promise<{
    worker: {
      id: string
      name: string
      driver: 'agent'
      path: string
      avatar: string
      description: string
      createdAt: string
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
    throw new TypeError('createWorkerBuildTool: defineTool is required')
  if (typeof runBuild !== 'function')
    throw new TypeError('createWorkerBuildTool: runBuild is required')
  if (typeof assertAccess !== 'function')
    throw new TypeError('createWorkerBuildTool: assertAccess is required')
  const avatars = Array.isArray(avatarIds) && avatarIds.length > 0 ? avatarIds.join(', ') : ''

  return defineTool({
    name: WORKER_BUILD_TOOL_NAME,
    description:
      'Create or update one worker of the Buka Workers page and mount it as a DSH workspace. A worker has an immutable identifier (id) and an optional display name. The id is the reference key used by workflows and the directory name: the plugin creates workers/<id> (default ~/.cache/dsh-plugin-workers/workers/<id>), whose AGENTS.md tells every session in it who the worker is and how it works. The display name is only shown in the UI and can be changed at any time; when it is empty the id is shown. Use this only in the Workflow preset, after understanding what the user wants the worker to do and after showing them the proposed id, display name, avatar, description and AGENTS.md and getting their approval. Call buka_workers first so you do not duplicate an existing worker. The tool creates the directory, registers the worker, writes the provided AGENTS.md (the plugin template is used when agents is omitted on create), keeps the CLAUDE.md link, and mounts the worker as a workspace. An existing id is rejected unless update: true is passed; pass it only when the user asked to change that worker, and omit the fields that should stay unchanged. To change the display name, pass the same id together with the new name and update: true — this does not move the directory or re-register the workspace, and earlier conversations stay listed under the worker. The id itself can never be changed. Installing project-level skills is a page action (Workers page → the worker → 技能) and is not done by this tool; recommend sources instead. Each worker also needs a one-sentence description: it is what a workflow orchestrator reads to decide whether to delegate a node to that worker (like a skill description). Avatar ids: ' +
      `${avatars}. Workers created here are agents.`,
    parameters: {
      id: {
        type: 'string',
        required: true,
        description:
          'Immutable worker identifier. New ids must match ^[a-z][a-z0-9_-]{0,63}$ (lowercase letters, digits, "_" and "-", starting with a letter). It becomes the directory workers/<id> and the reference key used by workflows; it cannot be changed after creation. Pass the current id to update an existing worker.',
      },
      name: {
        type: 'string',
        description:
          'Optional display name (a single line of at most 64 characters); it is only shown in the UI, need not be unique, and can be changed later. Empty means no display name, so the id is shown. On update, omit it to keep the current name, or pass an empty string to clear it.',
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
          'One sentence describing what this worker does and when to use it; a workflow orchestrator reads it to pick workers for nodes. Empty string keeps the current description when update: true (and leaves it empty on create).',
      },
      agents: {
        type: 'string',
        description:
          'Complete AGENTS.md markdown (role, inputs, workflow, output format, boundaries). Omit on create to keep the plugin template; omit on update to keep the current file.',
      },
      update: {
        type: 'boolean',
        description:
          'Set true only when the user asked to change a worker that already exists (including changing its display name). Without it, an existing id is rejected.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            required: true,
            description: 'Immutable worker identifier.',
          },
          name: {
            type: 'string',
            required: true,
            description: 'Display name; empty when none is set (the id is shown instead).',
          },
          path: { type: 'string', required: true, description: 'Absolute worker directory.' },
          avatar: {
            type: 'string',
            required: true,
            description: 'Avatar id stored for the worker.',
          },
          description: {
            type: 'string',
            required: true,
            description: 'One-sentence description stored for the worker; empty when none was set.',
          },
          created: {
            type: 'boolean',
            required: true,
            description: 'Whether this call created the worker.',
          },
          updated: {
            type: 'boolean',
            required: true,
            description: 'Whether this call changed an existing worker.',
          },
          renamed: {
            type: 'boolean',
            required: true,
            description:
              'Whether this call changed the display name of an existing worker. The directory and workspace registration are unchanged.',
          },
          previousName: {
            required: true,
            description:
              'Display name before this call when it changed the display name, otherwise null.',
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
            description: 'Whether a DSH workspace is now mounted at the worker directory.',
          },
          workspaceId: {
            required: true,
            description: 'Mounted workspace id, or null when the worker is not mounted.',
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
          mountError: {
            required: true,
            description: 'Why mounting failed, or null when the worker is mounted.',
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
      },
      render: (_args, value) => {
        const id = String(value?.id ?? '')
        const name = typeof value?.name === 'string' ? value.name : ''
        const display = name === '' ? id : name
        const identity = name === '' ? id : `${name} (${id})`
        const previousName =
          typeof value?.previousName === 'string' && value.previousName !== ''
            ? value.previousName
            : null
        const renamed = value?.renamed === true && previousName !== null
        const action =
          value?.created === true
            ? 'Created worker'
            : renamed
              ? `Renamed worker: ${previousName === '' ? display : previousName} → ${display}`
              : value?.updated === true
                ? 'Updated worker'
                : 'Worker ready'
        const description = String(value?.description ?? '')
        const lines = [
          renamed
            ? `${action} (id ${id}) · ${String(value?.path ?? '')} · avatar ${String(value?.avatar ?? '')}`
            : `${action}: ${identity} (${String(value?.path ?? '')}) · avatar ${String(value?.avatar ?? '')}`,
          `Description: ${description === '' ? '(none)' : description}`,
        ]
        if (renamed) {
          lines.push(
            'Only the display name changed: the directory and the workspace registration were kept.',
          )
        }
        if (typeof value?.agentsBytes === 'number' && value.agentsBytes > 0) {
          lines.push(`AGENTS.md written: ${value.agentsBytes} bytes.`)
        }
        if (value?.mounted === true) {
          const workspaceId = typeof value?.workspaceId === 'string' ? ` ${value.workspaceId}` : ''
          lines.push(`Mounted as a workspace${workspaceId}.`)
        } else {
          lines.push(
            `Not mounted: ${String(value?.mountError ?? 'unknown error')}. The user can mount it from the Workers page.`,
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
        id: result.worker.id,
        name: result.worker.name,
        path: result.worker.path,
        avatar: result.worker.avatar,
        description: result.worker.description,
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
