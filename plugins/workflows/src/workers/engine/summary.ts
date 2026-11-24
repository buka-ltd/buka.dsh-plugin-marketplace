/**
 * 执行者列表的摘要投影。
 *
 * @module @buka/dsh-plugin-workflows/workers/engine/summary
 */

import { resolveAvatar } from '../avatar.ts'
import { isBuiltinWorkerId } from '../store/builtin.ts'
import { workerDisplayName } from '../store/types.ts'
import type { WorkerListEntry } from '../worker-store.ts'

/**
 * 执行者列表里的一行：去掉 AGENTS.md 正文等大字段，只保留编排需要的摘要。
 *
 * `id` 是不可变标识符（引用键），`name` 是可选展示名（空串表示未设置，展示时
 * 回退到 `id`）；两者都原样给出，让消费方自己决定显示哪个。`driver` /
 * `program` 是工作流的主体契约：智能体可以开会话，机器人（clock）由工作流
 * 按 `program` 驱动、不建会话。机器人没有目录，`exists` / `mounted` 恒为
 * false，`skills` 为空。助理不是这里的一个字段：它由工作流对人任务类型的
 * 点名决定。
 *
 */
export function summarizeWorker(worker: WorkerListEntry): Record<string, unknown> {
  const agents: Partial<WorkerListEntry['agents']> = worker?.agents ?? {}
  return {
    id: typeof worker?.id === 'string' ? worker.id : '',
    name: typeof worker?.name === 'string' ? worker.name : '',
    displayName: workerDisplayName(worker ?? {}),
    driver: worker?.driver === 'robot' ? 'robot' : 'agent',
    program: typeof worker?.program === 'string' ? worker.program : '',
    builtin: isBuiltinWorkerId(worker?.id),
    path: worker?.path ?? '',
    createdAt: worker?.createdAt ?? null,
    avatar: resolveAvatar(worker?.avatar, worker?.id),
    description: typeof worker?.description === 'string' ? worker.description : '',
    ...(typeof worker?.agentPreset === 'string' && worker.agentPreset !== ''
      ? { agentPreset: worker.agentPreset }
      : {}),
    exists: worker?.exists === true,
    mounted: worker?.mounted === true,
    workspaceId: worker?.workspaceId ?? null,
    skills: Array.isArray(worker?.skills)
      ? worker.skills.map((skill) => ({
          name: typeof skill?.name === 'string' ? skill.name : '',
          description: typeof skill?.description === 'string' ? skill.description : '',
        }))
      : [],
    agents: {
      exists: agents.exists === true,
      bytes: typeof agents.bytes === 'number' ? agents.bytes : 0,
      modifiedAt: agents.modifiedAt ?? null,
    },
  }
}
