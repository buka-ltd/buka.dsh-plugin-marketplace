/**
 * 按 name 解析机器人并确认目录仍在。
 *
 * 机器人路由与 skills 路由共用的前置步骤：登记表损坏、名称不合法、条目不存在
 * 与目录缺失各自映射成稳定的错误码，由调用方按 HTTP 状态码回给页面。
 *
 * @module @buka/dsh-plugin-robots/routes/target
 */

import { promises as fs } from 'node:fs'
import { isValidRobotName, readRobotRegistry } from '../robot-store.ts'
import type { RobotRecord } from '../store/types.ts'

/** 路由错误的统一形状：状态码 + 错误码 + 可展示文案。 */
export interface RobotRouteError {
  status: number
  code: string
  message: string
}

/**
 * 登记文件损坏时的统一错误：写操作必须拒绝，不能覆盖用户文件。
 *
 */
function registryUnreadableError(registryFile: string): RobotRouteError {
  return {
    status: 409,
    code: 'registry-unreadable',
    message: `机器人登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`,
  }
}

/**
 * 按 name 从登记表里取机器人，并确认它的目录还在。
 *
 */
export async function resolveRobot(
  registryFile: string,
  name: unknown,
): Promise<
  { robot: RobotRecord; error?: undefined } | { robot?: undefined; error: RobotRouteError }
> {
  const registry = await readRobotRegistry({ file: registryFile })
  if (registry.corrupt) return { error: registryUnreadableError(registryFile) }

  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!isValidRobotName(trimmed)) {
    return {
      error: { status: 400, code: 'invalid-name', message: `机器人名称不合法：${String(name)}` },
    }
  }
  const robot = registry.robots.find((entry) => entry.name === trimmed)
  if (robot === undefined) {
    return {
      error: { status: 404, code: 'unknown-robot', message: `没有找到这个机器人：${trimmed}` },
    }
  }
  // program 型机器人没有目录、没有 AGENTS.md / skills / 会话：只读。
  if (robot.driver === 'program') {
    return {
      error: {
        status: 409,
        code: 'program-robot',
        message: `program 型机器人只读，不能执行这个操作：${trimmed}`,
      },
    }
  }

  let stat: import('node:fs').Stats | undefined
  try {
    stat = await fs.stat(robot.path)
  } catch {
    stat = undefined
  }
  if (stat === undefined || !stat.isDirectory()) {
    return {
      error: {
        status: 409,
        code: 'missing-directory',
        message: `机器人目录不存在或不是目录：${robot.path}`,
      },
    }
  }
  return { robot }
}
