/**
 * `@buka/dsh-plugin-workflows` 宿主一半入口：只做装配。
 *
 * 合并包承载两半能力：
 *
 * - **执行者**（`workers/`）：插件全局目录下的登记表与目录、AGENTS.md、项目
 *   skills、模型选择，`workflow_workers` / `workflow_worker_build` 两个模型工具，
 *   `/workflow/workers/*` 页面路由，以及对外服务 `ctx.workflowWorkers`。
 * - **工作流**（`assembly.ts`）：持久工作流定义、作业与任务级看板、显式依赖、
 *   内建开始 / 结束、人任务与助理，`workflow_*` 工具与 `/job` 命令，
 *   `/workflow/*` 页面路由，以及只读服务 `ctx.workflowQuery`
 *   （`workerUsage(id)` 供删除执行者算引用面）。
 *
 * 两半只在服务层互连：工作流引擎经 `ctx.get('workflowWorkers')` 读登记表与开
 * 执行者会话，执行者删除路由经 `ctx.get('workflowQuery')` 算影响面。合并后
 * 两者始终存在，原有「服务缺失」兜底分支保留（零行为变化）。随包发布唯一
 * 编排预设 `workflow-orchestrator`（显示名 `Workflow`），写工具与定义工具都
 * 只对该预设的根会话可见（分别由 `builderPresets` / `orchestratorPresets`
 * 配置，默认同一名单）。
 *
 * @module @buka/dsh-plugin-workflows
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { applyWorkflows } from './assembly.ts'
import type { WorkflowsConfig } from './options.ts'
import { workflowConfigFields } from './options.ts'
import type { WorkerAssemblyConfig } from './workers/index.ts'
import { applyWorkers, workerConfigFields } from './workers/index.ts'

export type { WorkflowsConfig } from './options.ts'
export { defaultDataDir, resolveDataDir } from './options.ts'

/** 合并后的插件配置：执行者字段 + 工作流字段。 */
export type MergedConfig = WorkflowsConfig & WorkerAssemblyConfig

/** Cordis 插件名；与 cordis.patch.yml 的补丁行 id 保持一致。 */
export const name = 'tool-buka-workflows'

/** 依赖的服务：工具注册表与工作区注册（判断执行者是否已挂到 DSH 工作区）。其余服务按需可选获取。 */
export const inject = ['tools', 'workspaceRegistry']

/** 合并后的插件配置：执行者字段 + 工作流字段。 */
export const Config = z.object({
  ...workflowConfigFields,
  ...workerConfigFields,
})

/**
 * 装配合并插件：先执行者一半，再工作流一半。
 *
 * @param ctx 插件上下文
 * @param config 插件配置
 */
export function apply(ctx: Context, config: MergedConfig): void {
  applyWorkers(ctx, config)
  applyWorkflows(ctx, config)
}
