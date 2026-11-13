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
    /** Buka Workers 服务（`@buka/dsh-plugin-workers` 提供）；未安装时为 undefined。 */
    bukaWorkers: BukaWorkersService | undefined
    /**
     * Web 组合的会话控制器：按 sessionId 解析 / 恢复 ordinary session 的 live agent。
     * 只有 web 组合提供；`ctx.get('sessionController')` 取不到时按「无法恢复会话」处理。
     */
    sessionController: SessionControllerService | undefined
  }
}

/**
 * Buka Workers 服务（v4 契约，见 `.tmp/workflow-v4-api.md` 最后一节）。
 *
 * 服务只负责会话与 turn 观测：一个任务一条新会话，恢复时只续接同一条会话；
 * 压缩、结果契约与追问都在 workflows 侧。
 */
export interface BukaWorkersService {
  /** 打工人登记表 + 目录状态。 */
  list?: () => Promise<unknown> | unknown
  /** 打工人名 → 头像 id 表。 */
  avatarMap?: () => Promise<unknown> | unknown
  /** 非阻塞地投递一轮打工人会话（总是新会话）。 */
  dispatchSession?: (request: Record<string, unknown>) => Promise<unknown> | unknown
  /** 打开 / 续接一个已有打工人会话，不发 prompt。 */
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
