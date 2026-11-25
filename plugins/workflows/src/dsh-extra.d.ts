/**
 * 本插件用到、但共享的 `types/dsh.d.ts` 没有声明的宿主服务增强。
 *
 * 只声明本插件**实际调用**的字段；跨插件服务在对应插件没装时同样不存在，
 * 所以类型里带 `undefined`。形状以调用点为准，不追求覆盖上游全部 API。
 */

// 显式 import 一次：模块增强必须在本文件里 import 被增强的模块才会合并。
import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 执行者服务（合并包的执行者一半提供）；按可选服务处理，缺省时消费方降级。 */
    workflowWorkers: WorkflowWorkersService | undefined
    /**
     * Web 组合的会话控制器：按 sessionId 解析 / 恢复 ordinary session 的 live agent。
     * 只有 web 组合提供；`ctx.get('sessionController')` 取不到时按「无法恢复会话」处理。
     */
    sessionController: SessionControllerService | undefined
    /** 系统提示词注册表：作业模式用它注入 `workflow_job_policy` 段落。 */
    systemPrompt: SystemPromptService | undefined
  }
}

/**
 * Buka Workers 服务（v4 契约，见 `.tmp/workflow-v4-api.md` 最后一节）。
 *
 * 服务只负责会话与 turn 观测：一个任务一条新会话，恢复时只续接同一条会话；
 * 压缩、结果契约与追问都在 workflows 侧。
 */
export interface WorkflowWorkersService {
  /** 执行者登记表 + 目录状态。 */
  list?: () => Promise<unknown> | unknown
  /** 执行者名 → 头像 id 表。 */
  avatarMap?: () => Promise<unknown> | unknown
  /** 非阻塞地投递一轮执行者会话（总是新会话）。 */
  dispatchSession?: (request: Record<string, unknown>) => Promise<unknown> | unknown
  /** 打开 / 续接一个已有执行者会话，不发 prompt。 */
  openSession?: (request: Record<string, unknown>) => Promise<unknown> | unknown
}

/** Web 组合会话控制器里本插件用到的部分。 */
export interface SessionControllerService {
  /**
   * 按 sessionId 解析 live agent；需要时先 resume 同一个会话。
   *
   * @param sessionId 会话 id
   * @returns `{ agent }` 或 `{ error }`
   */
  resolveAgent?: (sessionId: string) => Promise<unknown>
}

/** 系统提示词注册表里本插件用到的部分（形状见 dsh-system-prompt 的 `section()`）。 */
export interface SystemPromptService {
  /**
   * 注册一个提示词段落；返回撤销注册的函数。
   *
   * @param section 段落定义
   */
  section?: (section: SystemPromptSection) => () => void
}

/** 一个提示词段落。 */
export interface SystemPromptSection {
  /** 段落名；同名会遮蔽全局项。 */
  readonly name: string
  /** 段落的排序位置。 */
  readonly order: number
  /** 段落正文，或按当前组装上下文求值的函数。 */
  readonly text: string | ((context: SystemPromptContext) => string)
  /** 是否对正文做 `{{variable}}` 插值；作业模式写的是原文，必须关掉。 */
  readonly interpolate?: boolean
}

/** 段落求值时的上下文（只声明本插件读取的字段）。 */
export interface SystemPromptContext {
  readonly agent?: {
    readonly id?: unknown
    readonly session?: unknown
  }
}
