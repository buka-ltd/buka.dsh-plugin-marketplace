/**
 * 按会话管理 pen MCP：勾选时把 `dsh-mcp-client` 挂进该 Agent 的作用域，
 * 取消时卸载。工具只在勾选的会话里可见，不影响其它会话。
 *
 * 时机很关键：新会话框里的勾选发生在这条会话的 Agent 创建之前，所以不能
 * 只靠「勾选时立刻挂载」。控制器记住勾选的会话 id，等 `agent/created` 再
 * 挂载；该事件是串行的，且会话的排队输入会等监听器完成，因此勾选后的第一轮
 * 消息就能看到工具。之后 Agent 被销毁时，作用域会连同 mcp-client 一起卸载。
 *
 * 挂载失败（例如 Pen.app 不在默认路径）不会让会话创建失败：错误记在会话
 * 状态里并写日志，会话照常开始，只是没有 pen 工具。
 *
 * @module @buka/dsh-plugin-pen/controller
 */

import { describeError } from '@buka/plugin-kit'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { StdioConfig } from '@deepseek-ai/dsh-mcp-client'
import type { SessionId } from '@deepseek-ai/dsh-session'

import type { PenConfig } from './config.ts'
import type { PenSessionState, PenSnapshot } from './state.ts'
import { snapshotOf } from './state.ts'

/** 一个会话的 Host 侧状态；`fiber` 是挂在该 Agent 作用域里的 mcp-client。 */
interface SessionEntry {
  /** 用户是否勾选。 */
  enabled: boolean
  /** 已挂载的 mcp-client fiber；没有时表示还没挂载。 */
  fiber?: Fiber
  /** 最近一次挂载失败的原因。 */
  error?: string
}

/** 浏览器一半读取的最小接口；路由不直接碰 Cordis。 */
export interface PenStateSource {
  /**
   * 读一个会话的状态。
   * @param sessionId 会话 id
   * @returns 当前快照
   */
  snapshot(sessionId: string): PenSnapshot
  /**
   * 勾选或取消勾选；勾选时如果 Agent 已存在就立刻挂载，否则等 Agent 创建。
   * @param sessionId 会话 id
   * @param enabled 是否启用
   * @returns 操作后的快照
   */
  setEnabled(sessionId: string, enabled: boolean): Promise<PenSnapshot>
}

/** 加载 DSH 自带的 mcp-client；按需加载，缺包时只影响 pen 功能。 */
let mcpClient: Promise<typeof import('@deepseek-ai/dsh-mcp-client')> | undefined

function loadMcpClient(): Promise<typeof import('@deepseek-ai/dsh-mcp-client')> {
  mcpClient ??= import('@deepseek-ai/dsh-mcp-client').catch((error: unknown) => {
    mcpClient = undefined
    throw error
  })
  return mcpClient
}

/** 把插件配置翻成 mcp-client 的 stdio 条目。 */
function stdioConfigOf(config: PenConfig): StdioConfig {
  return {
    transport: 'stdio',
    serverName: config.serverName,
    command: config.command,
    args: [...config.args],
    env: { ...config.env },
    cwd: config.cwd,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    // 首次连接失败时让插件激活 reject，这样「勾选成功」就等于「工具已就绪」。
    failOnStartupError: true,
  }
}

/**
 * 给挂载加一道自己的截止时间。
 *
 * `startupTimeoutMs` 在较早的 dsh-mcp-client 版本里还不是配置字段，所以不
 * 交给它，而是在这里 race；超时后由调用方 dispose fiber，连接尝试随即结束。
 */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`连接 pen MCP 超时（${timeoutMs}ms）`))
    }, timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** pen MCP 的会话控制器。 */
export class PenController implements PenStateSource {
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly chains = new Map<string, Promise<unknown>>()

  /**
   * @param ctx 插件上下文，需要 `agents` 与会话事件
   * @param config 解析后的插件配置
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: PenConfig,
  ) {}

  /** 装配生命周期监听与卸载清理；由入口调用一次。 */
  watch(): void {
    // 串行事件：返回的 Promise 会被等待，新会话的首轮消息因此不会抢跑。
    this.ctx.on('agent/created', async ({ agent }) => {
      await this.onAgentCreated(agent)
      return undefined
    })
    this.ctx.on('agent/disposed', ({ agent }) => {
      this.onAgentDisposed(agent)
    })
    this.ctx.on('session/disposed', (session) => {
      this.onSessionDisposed(session.header.id)
    })
    this.ctx.effect(() => () => this.dispose(), 'pen: mounts')
  }

  /** @inheritdoc */
  snapshot(sessionId: string): PenSnapshot {
    return snapshotOf(this.stateOf(sessionId))
  }

  /** @inheritdoc */
  async setEnabled(sessionId: string, enabled: boolean): Promise<PenSnapshot> {
    return this.serialize(sessionId, async () => {
      const entry = this.entryOf(sessionId)
      if (!enabled) {
        entry.enabled = false
        delete entry.error
        await this.unmount(entry)
        return this.snapshot(sessionId)
      }

      entry.enabled = true
      delete entry.error
      if (entry.fiber === undefined) {
        const agent = this.ctx.agents.get(sessionId as SessionId)
        // Agent 还没创建：等 `agent/created` 再挂载。
        if (agent !== undefined) await this.mount(entry, agent)
      }
      return this.snapshot(sessionId)
    })
  }

  /** 把内部状态投影成快照；不存在该会话时视为未勾选。 */
  private stateOf(sessionId: string): PenSessionState | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return undefined
    return {
      enabled: entry.enabled,
      mounted: entry.fiber !== undefined,
      ...(entry.error === undefined ? {} : { error: entry.error }),
    }
  }

  /** 取或建立一个会话状态。 */
  private entryOf(sessionId: string): SessionEntry {
    let entry = this.sessions.get(sessionId)
    if (entry === undefined) {
      entry = { enabled: false }
      this.sessions.set(sessionId, entry)
    }
    return entry
  }

  /** 新 Agent 创建后，如果它的会话勾选了 pen，就挂载 MCP。 */
  private async onAgentCreated(agent: Agent): Promise<void> {
    const sessionId = String(agent.id)
    const entry = this.sessions.get(sessionId)
    if (entry === undefined || !entry.enabled) return
    await this.serialize(sessionId, async () => {
      const current = this.sessions.get(sessionId)
      if (current === undefined || !current.enabled || current.fiber !== undefined) return
      await this.mount(current, agent)
    })
  }

  /** Agent 销毁时作用域已卸载 mcp-client，这里只清掉引用。 */
  private onAgentDisposed(agent: Agent): void {
    const entry = this.sessions.get(String(agent.id))
    if (entry === undefined) return
    delete entry.fiber
    delete entry.error
  }

  /** 会话被移除时忘掉勾选，并确保连接关闭。 */
  private onSessionDisposed(sessionId: SessionId): void {
    const id = String(sessionId)
    if (!this.sessions.has(id)) return
    void this.serialize(id, async () => {
      const entry = this.sessions.get(id)
      if (entry === undefined) return
      this.sessions.delete(id)
      await this.unmount(entry)
    })
  }

  /** 在 Agent 作用域里挂载 mcp-client；失败只记录，不抛给 Agent 创建。 */
  private async mount(entry: SessionEntry, agent: Agent): Promise<void> {
    let fiber: Fiber | undefined
    try {
      const mcp = await loadMcpClient()
      fiber = agent.ctx.plugin(mcp, stdioConfigOf(this.config))
      entry.fiber = fiber
      const ready = fiber.await()
      // 截止时间先到时，这次 await 仍会在 dispose 后 reject；先挂一个 catch。
      ready.catch(() => {})
      await withDeadline(ready, this.config.startupTimeoutMs)
      delete entry.error
    } catch (error) {
      delete entry.fiber
      entry.error = describeError(error)
      this.ctx.logger.warn(`pen: 连接 pen MCP 失败：${entry.error}`)
      if (fiber !== undefined) {
        try {
          await fiber.dispose()
        } catch {
          // 失败原因已经记录；卸载失败不覆盖它。
        }
      }
    }
  }

  /** 卸载该会话的 mcp-client。 */
  private async unmount(entry: SessionEntry): Promise<void> {
    const fiber = entry.fiber
    delete entry.fiber
    if (fiber === undefined) return
    try {
      await fiber.dispose()
    } catch (error) {
      this.ctx.logger.warn(`pen: 卸载 pen MCP 失败：${describeError(error)}`)
    }
  }

  /**
   * 串行化同一会话上的勾选、挂载与会话移除，避免两次点击或
   * `agent/created` 与 HTTP 请求同时改同一份状态。
   */
  private serialize<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const run = previous.then(work, work)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.chains.set(sessionId, tail)
    void tail.then(() => {
      if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId)
    })
    return run
  }

  /** 插件卸载：等所有排队操作结束，再逐个关闭已挂载的连接。 */
  private async dispose(): Promise<void> {
    await Promise.allSettled([...this.chains.values()])
    const entries = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(entries.map(async (entry) => this.unmount(entry)))
  }
}
