/**
 * `/job` 命令：普通会话启动作业，启动者 = 当前会话。
 *
 * 语法：
 *
 * - `/job`：列出已激活工作流与它们的启动输入要求；
 * - `/job <workflowId> <原始输入>`：创建作业，启动任务回到本会话执行（下一轮
 *   agent 按提示调用 `buka_task_complete` 交回结构化输入）。
 *
 * 宿主 `commands` 服务没有注册 API 时返回 false，由 `index.ts` 记录日志；页面与
 * `buka_job_start` 工具仍是可用入口（spec §13.2 的降级路径）。
 *
 * @module @buka/dsh-plugin-workflows/commands/job
 */

import type { Context } from '@deepseek-ai/cordis'

import type { WorkflowEngine } from '../engine/engine.ts'
import { describeError, WorkflowError } from '../engine/types.ts'

/** 命令注册表的最小形状（避免和上游类型重复声明冲突）。 */
interface CommandsRegistryLike {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly handler: (invocation: CommandInvocationLike) => unknown
  }): () => void
}

/** 一次命令调用的最小形状。 */
interface CommandInvocationLike {
  readonly agent?: { readonly id?: unknown }
  readonly rawInput?: unknown
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
    description: '启动一个工作流作业：/job <workflowId> <原始输入>。不带参数时列出已激活的工作流。',
    async handler(invocation) {
      const engine = await ready()
      const agentId = typeof invocation.agent?.id === 'string' ? invocation.agent.id : ''
      if (agentId === '') {
        return { kind: 'error', text: '/job 需要在一个会话里使用（启动者 = 当前会话）' }
      }
      const raw = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
      if (raw === '') return { kind: 'success', text: describeAvailableWorkflows(engine) }
      const space = raw.search(/\s/u)
      const workflowId = (space < 0 ? raw : raw.slice(0, space)).trim()
      const request = space < 0 ? '' : raw.slice(space + 1).trim()
      if (workflowId === '' || request === '') {
        return {
          kind: 'error',
          text: '用法：/job <workflowId> <原始输入>；不带参数可列出已激活的工作流',
        }
      }
      try {
        const job = await engine.createJobFromSession({
          workflowId,
          rawInput: { request },
          sessionId: agentId,
        })
        return {
          kind: 'success',
          text: `已创建作业 #${job.seq}「${job.workflowName}」。启动任务会作为一条新消息发到本会话：按提示把原始输入转换成结构化输入，并调用 buka_task_complete 提交。`,
        }
      } catch (error) {
        return {
          kind: 'error',
          text:
            error instanceof WorkflowError
              ? error.message
              : `创建工作流作业失败：${describeError(error)}`,
        }
      }
    },
  })
  ctx.effect(() => dispose, 'buka-workflows: /job command')
  return true
}

/** 列出已激活工作流与启动输入要求。 */
function describeAvailableWorkflows(engine: WorkflowEngine): string {
  const workflows = engine
    .listWorkflowSummaries()
    .filter((workflow) => workflow.status === 'active')
  if (workflows.length === 0) {
    return '没有已激活的工作流。先在「工作流」页面创建工作流并激活，或让编排会话保存一份定义。'
  }
  const lines = ['已激活的工作流：']
  for (const workflow of workflows) {
    const id = typeof workflow.id === 'string' ? workflow.id : ''
    const name = typeof workflow.name === 'string' ? workflow.name : id
    lines.push(`- ${id}「${name}」`)
  }
  lines.push('用法：/job <workflowId> <原始输入>')
  return lines.join('\n')
}
