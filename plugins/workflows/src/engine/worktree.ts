/**
 * 工作树能力探测。
 *
 * 任务类型上的 `worktree` 开关不自己建检出：执行者可能同时改动多个仓库，
 * 具体从哪个仓库、建几个 worktree 由执行者按任务判断。插件只负责确认宿主
 * 同时提供了工作树服务与 `create_worktree` 工具，并在提示词里教执行者使用；
 * 缺少任一能力时忽略开关，改用工作区保护提示。
 *
 * 探测放在执行时而不是保存定义时：插件可能后装 / 卸载，同一份定义在不同
 * 组合里应当按实际能力执行。
 *
 * @module @buka/dsh-plugin-workflows/engine/worktree
 */

/** 探测只需要读宿主服务；Cordis 的 `ctx.get()` 在服务缺失时返回 undefined。 */
export interface WorktreeCapabilityContext {
  get?(name: string): unknown
}

/** 宿主是否同时启用了工作树服务和 `create_worktree` 模型工具。 */
export function worktreeToolAvailable(ctx: WorktreeCapabilityContext | null | undefined): boolean {
  try {
    const tools = ctx?.get?.('tools') as { get?(name: string): unknown } | undefined
    if (typeof tools?.get !== 'function') return false
    if (tools.get('create_worktree') === undefined) return false
    const worktrees = ctx?.get?.('worktrees') as { create?: unknown } | undefined
    return typeof worktrees?.create === 'function'
  } catch {
    return false
  }
}
