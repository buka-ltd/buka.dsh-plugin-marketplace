/**
 * 本插件用到、但共享的 `types/dsh.d.ts` 没有声明的服务增强。
 *
 * 只声明本插件**实际调用**的字段；跨插件服务在对应插件没装时同样不存在，
 * 所以类型里带 `undefined`。形状以调用点为准，不追求覆盖上游全部 API。
 */

// 显式 import 一次：模块增强必须在本文件里 import 被增强的模块才会合并。
import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Buka Robots 服务（`@buka/dsh-plugin-robots` 提供）；未安装时为 undefined。 */
    bukaRobots: BukaRobotsService | undefined
    /** 命令注册表服务；plan 节点通过对 agent 执行 `/plan` 进入 plan 模式。 */
    commands: CommandsService | undefined
  }
}

/** Buka Robots 服务里本插件用到的部分。 */
export interface BukaRobotsService {
  [key: string]: unknown
  /** 非阻塞地投递一轮机器人会话。 */
  dispatchSession?: (request: unknown) => Promise<unknown> | unknown
  /** 打开 / 续接一个机器人会话。 */
  openSession?: (request: unknown) => Promise<unknown> | unknown
  /** 机器人名 → 头像 id 表。 */
  avatarMap?: () => Promise<unknown> | unknown
  /** 新版服务支持在投递首轮 prompt 前切换 plan 模式。 */
  supportsPlanMode?: unknown
}

/** 命令注册表服务里本插件用到的部分。 */
export interface CommandsService {
  [key: string]: unknown
  /** 对目标 agent 执行一条斜杠命令；名称不可解析时返回 undefined。 */
  execute?: (
    agent: unknown,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ) => Promise<unknown> | unknown
}
