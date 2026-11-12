/**
 * 机器人列表的摘要投影。
 *
 * @module @buka/dsh-plugin-robots/engine/summary
 */

import { resolveAvatar } from '../avatar.ts'
import type { RobotListEntry } from '../robot-store.ts'

/**
 * 机器人列表里的一行：去掉 AGENTS.md 正文等大字段，只保留编排需要的摘要。
 *
 * `driver` / `assistant` / `program` 是工作流的执行者契约：agent 型可以开会话，
 * program 型（clock）由工作流按 `program` 驱动、不建会话。program 型没有目录，
 * `exists` / `mounted` 恒为 false，`skills` 为空。
 *
 */
export function summarizeRobot(robot: RobotListEntry): Record<string, unknown> {
  const agents: Partial<RobotListEntry['agents']> = robot?.agents ?? {}
  return {
    name: robot?.name ?? '',
    driver: robot?.driver === 'program' ? 'program' : 'agent',
    program: typeof robot?.program === 'string' ? robot.program : '',
    assistant: robot?.assistant === true,
    path: robot?.path ?? '',
    createdAt: robot?.createdAt ?? null,
    avatar: resolveAvatar(robot?.avatar, robot?.name),
    description: typeof robot?.description === 'string' ? robot.description : '',
    exists: robot?.exists === true,
    mounted: robot?.mounted === true,
    workspaceId: robot?.workspaceId ?? null,
    skills: Array.isArray(robot?.skills)
      ? robot.skills.map((skill) => ({
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
