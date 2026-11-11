/**
 * 本插件额外用到的 DSH 类型，补在共享的 `types/dsh.d.ts` 之外。
 *
 * `types/dsh.d.ts` 是跨插件共享的只读文件，这里只声明 skills 插件自己实际
 * 调用的那部分 API；形状以插件里的调用为准。
 */

import type { Context } from '@deepseek-ai/cordis'

import type { SkillsCatalogService } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 本插件用 `ctx.provide(SERVICE_NAME, …)` 注册的只读目录服务。 */
    bukaSkills: SkillsCatalogService
    /**
     * DSH 的 skills 注册表（由 `@deepseek-ai/dsh-skill-filesystem` 提供，本仓库
     * 没有安装它的类型包）。插件只调用 `list({ cwd })`，摘要字段随上游版本
     * 变化，所以按 `Record<string, unknown>` 收窄读取。
     */
    skills: {
      list(options: { cwd: string }): Promise<Array<Record<string, unknown>>>
    }
  }
}

/** 仅为让本文件成为模块并导入 cordis 类型（模块增强要求先 import 目标模块）。 */
export type SkillsContext = Context
