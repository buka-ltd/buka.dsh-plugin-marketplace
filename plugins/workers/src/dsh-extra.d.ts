/**
 * 本插件用到、但 `types/dsh.d.ts` 还没声明的 DSH 服务。
 *
 * `types/dsh.d.ts` 是跨插件共享文件（只读），所以缺的服务在这里按本插件
 * **实际调用**的形状补声明；不追求覆盖上游全部字段，写错反而会掩盖问题。
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 工作区注册表：打工人挂载、列表、改名同步与删除时用它。 */
    workspaceRegistry: WorkspaceRegistry
    /** Workflows 插件的只读查询服务；没装时不存在，删除按「没有作业引用」处理。 */
    bukaWorkflows: BukaWorkflowsService | undefined
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
    /** 工作区展示标题；改打工人展示名时同步它。 */
    title?: unknown
    setTitle?(title: string): Promise<void> | void
    attachSession?(sessionId: string): Promise<unknown>
  }>
  /** 按目录路径找一个已注册工作区；没有时返回 undefined。 */
  resolveByPath?(directory: string): Promise<
    | {
        id?: unknown
        path?: unknown
        title?: unknown
        setTitle?(title: string): Promise<void> | void
        attachSession?(sessionId: string): Promise<unknown>
      }
    | null
    | undefined
  >
  /** 把一个目录注册成 DSH 工作区，返回带 id 的工作区记录；`title` 只用于新建。 */
  create(directory: string, title?: string): Promise<{ id?: unknown }>
  /** 删除一个工作区注册；`id` 是 `list()` / `create()` 返回的 id。 */
  delete(id: unknown): boolean
}

/**
 * Workflows 插件提供的只读查询服务（`ctx.bukaWorkflows`）。
 *
 * Workers 插件只在删除前调用它：引用该标识符的运行中作业是唯一的删除阻塞，
 * 引用了它但已结束的作业与工作流只用于展示影响面。
 */
export interface BukaWorkflowsService {
  /**
   * 一个打工人标识符被哪些工作流 / 作业引用。
   *
   * @param id 打工人标识符
   */
  workerUsage(id: string): Promise<WorkerUsage>
}

/** 一条引用某个打工人的运行中作业。 */
export interface WorkerUsageJob {
  readonly jobId: string
  /** 作业在所属工作流内的编号。 */
  readonly jobSeq: number
  readonly workflowId: string
  readonly workflowName: string
  /** 作业展示名（取钉住的工作流名）。 */
  readonly jobName: string
}

/** 一条引用某个打工人的工作流（含停用）。 */
export interface WorkerUsageWorkflow {
  readonly workflowId: string
  readonly name: string
  readonly status: string
}

/** `workerUsage()` 的返回形状。 */
export interface WorkerUsage {
  readonly runningJobs: readonly WorkerUsageJob[]
  readonly workflows: readonly WorkerUsageWorkflow[]
  readonly finishedJobs: number
}
