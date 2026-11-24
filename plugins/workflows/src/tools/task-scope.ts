/**
 * 按任务注册的创建 / 完成工具说明。
 *
 * 任务能创建什么、人任务能点哪些动作，原先要靠 `buka_task_targets` /
 * `buka_task_actions` 再问一次；现在这两样直接写进工具自己的说明里：
 *
 * - 引擎在派发前就绑定「会话 → 任务」，host 的 `agent/created` 监听据此查出
 *   这张任务；
 * - 在 agent 作用域（`createScope(agent.ctx, agent)`）里各注册一份带本任务说明的
 *   `buka_task_create` / `buka_task_complete`，遮蔽同名全局工具；
 * - 会话释放或插件卸载时撤销。
 *
 * 作用域注册跟随 agent 的 fiber 释放；`agent/disposed` 再兜底一次。
 *
 * @module @buka/dsh-plugin-workflows/tools/task-scope
 */

import type { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'

import type { WorkflowEngine } from '../engine/engine.ts'
import { taskCompleteDescription, taskCreateDescription } from './descriptions.ts'
import { defineTaskCompleteTool, defineTaskCreateTool } from './index.ts'

/** 安装任务作用域工具。 */
export interface TaskScopeDeps {
  /** 插件根上下文。 */
  readonly ctx: Context
  /** 就绪的引擎。 */
  readonly ready: () => Promise<WorkflowEngine>
}

/** `agent/created` / `agent/disposed` 里本模块用到的 agent 形状。 */
interface AgentLike {
  readonly id?: unknown
  readonly ctx?: Context | undefined
}

/** 会话 → 作用域句柄。 */
type ScopeMap = Map<string, Scope>

/**
 * 监听 `agent/created`，给执行任务的会话注册带本任务说明的工具。
 *
 * @param deps 根上下文与引擎
 */
export function installTaskScopedTools(deps: TaskScopeDeps): void {
  const scopes: ScopeMap = new Map()

  /** 撤销一条会话的作用域注册。 */
  const disposeScope = (sessionId: string): void => {
    const scope = scopes.get(sessionId)
    if (scope === undefined) return
    scopes.delete(sessionId)
    void scope.dispose()
  }

  deps.ctx.effect(
    () => () => {
      for (const sessionId of [...scopes.keys()]) disposeScope(sessionId)
    },
    'buka-workflows: dispose task tool scopes',
  )

  /** 会话开始执行任务时装配说明；`agent/created` 是串行事件，返回的 Promise 会被等待。 */
  const mount = async (agent: AgentLike, sessionId: string): Promise<undefined> => {
    const engine = await deps.ready().catch((error: unknown) => {
      deps.ctx.logger?.warn?.(
        `buka-workflows: could not mount task tools for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    })
    if (engine === null || engine.taskForSession(sessionId) === null) return undefined
    const agentCtx = agent.ctx
    if (agentCtx === undefined) return undefined
    disposeScope(sessionId)
    const scope = createScope(agentCtx, agent)
    scopes.set(sessionId, scope)
    const targets = engine.creatableTargetsForSession(sessionId)
    const actions = engine.taskActionsForSession(sessionId)
    // 通过 scoped ctx 的插件注册：注册落在 agent 作用域里，随 scope.dispose()
    // 一起撤销；inject 让这条 ctx 拿得到 tools 服务。
    await scope.ctx.plugin((scopedCtx) => {
      scopedCtx.inject(['tools'], (toolCtx) => {
        toolCtx.tools.register(defineTaskCreateTool(deps.ready, taskCreateDescription(targets)))
        toolCtx.tools.register(defineTaskCompleteTool(deps.ready, taskCompleteDescription(actions)))
      })
    })
    return undefined
  }

  deps.ctx.on('agent/created', (payload) => {
    const agent = (payload as { agent?: AgentLike } | null | undefined)?.agent
    if (agent === undefined) return
    const sessionId = typeof agent.id === 'string' ? agent.id : ''
    if (sessionId === '') return
    return mount(agent, sessionId)
  })
  deps.ctx.on('agent/disposed', (payload) => {
    const agent = (payload as { agent?: { id?: unknown } } | null | undefined)?.agent
    disposeScope(typeof agent?.id === 'string' ? agent.id : '')
  })
}
