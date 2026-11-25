/**
 * `/job` 命令：普通会话进入作业模式，发起人 = 当前会话。
 *
 * 语法（`/job` 必须是会话的第一条消息）：
 *
 * - `/job [说明]`：进入作业模式。说明非空时作为第一条用户消息投递；agent
 *   之后用 `workflow_job_options` 列出可启动的工作流，按用户描述挑选，用户
 *   没有说明用哪个时先问用户；
 * - `/job off`：退出作业模式。
 *
 * 命令不接收 workflow id：用户不必记住标识符，选择交给 agent；真正建单由
 * 模式里的 `workflow_job_start` 完成，这样结构化输入可以按开始节点的 schema 补齐。
 * 模式状态折叠自会话日志（见 `../job-mode.ts`），命令、提示词与工具读同一份。
 *
 * 宿主 `commands` 服务没有注册 API 时返回 false，由 `assembly.ts` 记录日志；
 * 页面仍可从侧边栏「新建作业」，人发起的作业不受作业模式影响。
 *
 * @module @buka/dsh-plugin-workflows/commands/job
 */

import type { Context } from '@deepseek-ai/cordis'

import type { WorkflowEngine } from '../engine/engine.ts'
import { createUserMessage } from '../engine/session.ts'
import { describeError } from '../engine/types.ts'
import type { JobModeSession } from '../job-mode.ts'
import { readJobMode } from '../job-mode.ts'

/** 命令注册表的最小形状（避免和上游类型重复声明冲突）。 */
interface CommandsRegistryLike {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint: string }
    readonly handler: (invocation: CommandInvocationLike) => unknown
  }): () => void
}

/** 一次命令调用的最小形状。 */
interface CommandInvocationLike {
  readonly agent?: CommandAgentLike
  readonly rawInput?: unknown
}

/** 命令处理器看到的 agent（结构类型，避免依赖 dsh-agent 的完整类型）。 */
export interface CommandAgentLike {
  readonly id?: unknown
  readonly session?: JobModeSession
  steer?(message: unknown): void
}

/** 命令结果，形状与宿主 `commands` 的结果一致。 */
export interface JobCommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
}

/** 注册依赖。 */
export interface JobCommandDeps {
  readonly ctx: Context
  readonly ready: () => Promise<WorkflowEngine>
}

/**
 * 注册 `/job` 命令。
 *
 * @param deps 上下文与引擎 getter
 * @returns 注册成功返回 true；宿主不支持命令注册时返回 false
 */
export function registerJobCommand({ ctx, ready }: JobCommandDeps): boolean {
  const commands = ctx.get('commands') as unknown as CommandsRegistryLike | undefined
  if (commands === undefined || commands === null || typeof commands.register !== 'function') {
    return false
  }
  const dispose = commands.register({
    name: 'job',
    description:
      '进入作业模式：/job [说明] 作为会话第一条消息，说明可省略。之后由 agent 从可用工作流里选择或询问。/job off 退出。',
    input: { hint: '[说明]|off' },
    async handler(invocation) {
      const agent = invocation.agent
      const sessionId = typeof agent?.id === 'string' ? agent.id : ''
      if (agent === undefined || sessionId === '') {
        return { kind: 'error', text: '/job 需要在一个会话里使用（发起人 = 当前会话）' }
      }
      const engine = await ready()
      return await runJobCommand({
        engine,
        agent,
        sessionId,
        rawInput: typeof invocation.rawInput === 'string' ? invocation.rawInput : '',
      })
    },
  })
  ctx.effect(() => dispose, 'workflow: /job command')
  return true
}

/**
 * 执行一条 `/job` 命令（拆出来便于单测）。
 *
 * @param input 引擎、会话与原始输入
 * @returns 命令结果
 */
export async function runJobCommand(input: {
  readonly engine: WorkflowEngine
  readonly agent: CommandAgentLike
  readonly sessionId: string
  readonly rawInput: string
}): Promise<JobCommandResult> {
  const { engine, agent, sessionId } = input
  const text = input.rawInput.trim()
  const state = readJobMode(agent.session)
  const startedJobId = engine.jobIdForSession(sessionId)

  if (startedJobId !== null || state.consumed) {
    return text === 'off'
      ? { kind: 'success', text: '作业模式已结束（本会话已启动过作业）。' }
      : {
          kind: 'error',
          text: '本会话已经启动过作业，作业模式已结束；要再启动一个作业，请新建一个会话并以 /job 开头。',
        }
  }

  if (text === 'off') {
    return {
      kind: 'success',
      text: state.entered ? '已退出作业模式。' : '当前不在作业模式。',
    }
  }

  if (!state.entered && !state.fresh) {
    return {
      kind: 'error',
      text: '作业模式只能在会话开始时进入：请新建一个会话，把 /job 作为第一条消息。',
    }
  }

  // 进入模式前确认至少有一个已启用工作流；都停用时空等没有意义。
  let activeCount: number
  try {
    const workflows = await engine.listWorkflowSummaries()
    activeCount = workflows.filter((workflow) => workflow.status === 'active').length
  } catch (error) {
    return { kind: 'error', text: `无法读取工作流列表：${describeError(error)}` }
  }
  if (activeCount === 0) {
    return {
      kind: 'error',
      text: '没有可用的工作流。让编排会话保存一份定义，或在「工作流」页面重新启用一个已停用的工作流。',
    }
  }

  if (text !== '') agent.steer?.(createUserMessage(text))
  return {
    kind: 'success',
    text:
      text === ''
        ? `已进入作业模式。说说你想做什么，我会从 ${activeCount} 个已启用工作流里挑一个；也可以直接说用哪个。退出作业模式：/job off。`
        : `已进入作业模式，并把你的说明作为第一条消息；我会从 ${activeCount} 个已启用工作流里挑一个，拿不准时问你。退出作业模式：/job off。`,
  }
}
