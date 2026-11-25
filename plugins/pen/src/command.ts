/**
 * `/pen` 命令：会话进行中随时开启或关闭这条会话的 pen MCP。
 *
 * 新会话的勾选框只在会话开始前出现，但用户往往聊到一半才发现需要 Pen 的
 * 工具。这条命令补上入口：`/pen` 开启，`/pen off` 关闭，作用与勾选框完全
 * 一致——都走 `PenController.setEnabled`，只改这条会话自己的 Agent 作用域，
 * 不需要另开一个会话。
 *
 * 命令直接由界面执行，不进入模型对话；切换结果以卡片文本回到界面。切换
 * 发生在工具列表组装之后时，新工具从**下一轮**消息开始可见。
 *
 * 宿主没有组合 `commands` 服务时静默跳过，插件的其它入口仍然可用。
 *
 * @module @buka/dsh-plugin-pen/command
 */

import { describeError } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '../../../types/dsh.js'

import type { PenStateSource } from './controller.ts'
import type { PenSnapshot } from './state.ts'

/** 斜杠命令名，不带前导斜杠。 */
export const COMMAND_NAME = 'pen'

/** `/pen` 要做的动作。 */
export type PenCommandAction = 'on' | 'off'

/**
 * 解析 `/pen` 之后的原始输入。
 *
 * 与 `/plan` 对齐：不带参数表示开启，显式 `on` 也开启，`off` 关闭。
 *
 * @param rawInput 命令名之后的文本
 * @returns 要执行的动作；语法不认识时返回 undefined
 */
export function parsePenCommand(rawInput: unknown): PenCommandAction | undefined {
  const input = typeof rawInput === 'string' ? rawInput.trim().toLowerCase() : ''
  if (input === '' || input === 'on') return 'on'
  if (input === 'off') return 'off'
  return undefined
}

/**
 * 把一次切换结果翻成命令卡片上的文本。
 *
 * @param action 刚才执行的动作
 * @param snapshot 切换后的 Host 状态
 * @param serverName MCP 服务名，用来拼出工具名前缀
 * @returns 成功或失败结果
 */
export function penCommandResult(
  action: PenCommandAction,
  snapshot: PenSnapshot,
  serverName: string,
): CommandResult {
  if (action === 'off') {
    return {
      kind: 'success',
      text: `Pen MCP 已关闭，本会话不再提供 mcp__${serverName}__* 工具。`,
    }
  }
  if (snapshot.status === 'error') {
    return {
      kind: 'error',
      text: `Pen MCP 连接失败：${snapshot.message ?? '未知错误'}`,
    }
  }
  if (snapshot.status === 'ready') {
    return {
      kind: 'success',
      text: `Pen MCP 已开启，本会话的下一轮消息可以使用 mcp__${serverName}__* 工具。`,
    }
  }
  return { kind: 'success', text: 'Pen MCP 已开启，会话开始后自动连接。' }
}

/**
 * 执行一条 `/pen` 命令。
 *
 * @param source pen 状态源
 * @param serverName MCP 服务名
 * @param invocation 命令调用
 * @returns 命令卡片上的结果
 */
async function runPenCommand(
  source: PenStateSource,
  serverName: string,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const sessionId = typeof invocation.agent?.id === 'string' ? invocation.agent.id : ''
  if (sessionId === '') return { kind: 'error', text: '/pen 只能在一个会话里使用。' }
  const action = parsePenCommand(invocation.rawInput)
  if (action === undefined) {
    return { kind: 'error', text: '用法：/pen 开启 Pen MCP，/pen off 关闭。' }
  }
  try {
    const snapshot = await source.setEnabled(sessionId, action === 'on')
    return penCommandResult(action, snapshot, serverName)
  } catch (error) {
    return { kind: 'error', text: `切换 Pen MCP 失败：${describeError(error)}` }
  }
}

/** 注册命令需要的配置。 */
export interface PenCommandOptions {
  /** MCP 服务名；决定工具名前缀 `mcp__<serverName>__`。 */
  readonly serverName: string
}

/**
 * 注册 `/pen` 命令；宿主没有 `commands` 服务时不注册。
 *
 * @param ctx 插件上下文
 * @param source pen 状态源（Host 控制器）
 * @param options 命令文案要用的配置
 */
export function registerPenCommand(
  ctx: Context,
  source: PenStateSource,
  options: PenCommandOptions,
): void {
  // `commands` 是可选服务：等它可用再注册；没有组合时普通会话仍可用勾选框。
  ctx.inject(['commands'], (commandCtx) => {
    const commands = commandCtx.get('commands')
    if (commands === undefined || typeof commands.register !== 'function') {
      commandCtx.logger?.warn?.('pen: 宿主没有 commands 服务，/pen 命令不可用')
      return
    }
    const dispose = commands.register({
      name: COMMAND_NAME,
      description: '开启或关闭本会话的 Pen MCP 工具：/pen 开启，/pen off 关闭。',
      handler: (invocation) => runPenCommand(source, options.serverName, invocation),
    })
    commandCtx.effect(() => dispose, 'pen: /pen command')
  })
}
