/**
 * 本插件用到、但 `types/dsh.d.ts` 还没声明的 DSH 服务。
 *
 * `types/dsh.d.ts` 是跨插件共享文件（只读），所以缺的服务在这里按本插件
 * **实际调用**的形状补声明；不追求覆盖上游全部字段，写错反而会掩盖问题。
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 工作区注册表：打工人挂载、列表与改名时用它判断打工人目录是否已挂载。 */
    workspaceRegistry: WorkspaceRegistry
  }

  interface Events {
    /** 释放 live agent 后把仍然持久化的会话重新通告给客户端。 */
    'api-session/added'(summary: unknown): void
  }
}

/** 工作区注册表的最小形状：只声明本插件实际调用的方法。 */
export interface WorkspaceRegistry {
  /** 列出已注册工作区；路径用来和打工人目录的规范路径比较。 */
  list(): Array<{
    id?: unknown
    path?: unknown
    attachSession?(sessionId: string): Promise<unknown>
  }>
  /** 按目录路径找一个已注册工作区；没有时返回 undefined。 */
  resolveByPath?(
    directory: string,
  ): Promise<
    | { id?: unknown; path?: unknown; attachSession?(sessionId: string): Promise<unknown> }
    | null
    | undefined
  >
  /** 把一个目录注册成 DSH 工作区，返回带 id 的工作区记录。 */
  create(directory: string): Promise<{ id?: unknown }>
  /** 删除一个工作区注册；`id` 是 `list()` / `create()` 返回的 id。 */
  delete(id: unknown): boolean
}
