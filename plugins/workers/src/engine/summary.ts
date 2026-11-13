/**
 * 打工人列表的摘要投影。
 *
 * @module @buka/dsh-plugin-workers/engine/summary
 */

import { resolveAvatar } from '../avatar.ts'
import type { WorkerListEntry } from '../worker-store.ts'

/**
 * 打工人列表里的一行：去掉 AGENTS.md 正文等大字段，只保留编排需要的摘要。
 *
 * `driver` / `assistant` / `program` 是工作流的执行者契约：智能体可以开会话，
 * 机器人（clock）由工作流按 `program` 驱动、不建会话。机器人没有目录，
 * `exists` / `mounted` 恒为 false，`skills` 为空。
 *
 */
export function summarizeWorker(worker: WorkerListEntry): Record<string, unknown> {
  const agents: Partial<WorkerListEntry['agents']> = worker?.agents ?? {}
  return {
    name: worker?.name ?? '',
    driver: worker?.driver === 'robot' ? 'robot' : 'agent',
    program: typeof worker?.program === 'string' ? worker.program : '',
    assistant: worker?.assistant === true,
    path: worker?.path ?? '',
    createdAt: worker?.createdAt ?? null,
    avatar: resolveAvatar(worker?.avatar, worker?.name),
    description: typeof worker?.description === 'string' ? worker.description : '',
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
