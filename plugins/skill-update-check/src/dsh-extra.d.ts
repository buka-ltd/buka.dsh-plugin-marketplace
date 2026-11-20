/**
 * 本插件额外用到的 DSH 类型，补在共享的 `types/dsh.d.ts` 之外。
 *
 * `types/dsh.d.ts` 是跨插件共享的只读文件，这里只声明本插件实际调用的那部分
 * 服务；形状以调用为准，不追求覆盖上游全部字段。
 */

import type { Context } from '@deepseek-ai/cordis'

import type { SessionLike, WorkspaceRegistryLike } from './workspace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 会话仓库：只用来按 id 取会话 header 里的 cwd。 */
    sessions: SessionsService
    /** 工作区注册表：只读，用来把会话映射回当前工作区。 */
    workspaceRegistry: WorkspaceRegistryLike | undefined
  }
}

/** 会话仓库的最小形状：只声明本插件调用的 `get()`。 */
export interface SessionsService {
  get(id: string): SessionLike | undefined
}

/** 仅为让本文件成为模块并导入 cordis 类型（模块增强要求先 import 目标模块）。 */
export type SkillUpdatesContext = Context
