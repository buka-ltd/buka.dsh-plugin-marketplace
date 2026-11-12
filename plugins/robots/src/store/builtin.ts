/**
 * 内建 program 型机器人。
 *
 * program 型机器人是固定程序（接收输入 → 产出输出），没有目录、AGENTS.md 与
 * 项目 skills；v1 只有内建 `clock`，由 workflows 插件执行驱动。它们登记在
 * robots 插件里、在页面上只读展示，用户不能创建或删除。
 *
 * 本模块只依赖类型与常量，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-robots/store/builtin
 */

import type { RobotRecord } from './types.ts'

/** 内建定时机器人的名字，也是它的 program id。 */
export const CLOCK_ROBOT_NAME = 'clock'

/**
 * 内建 program 机器人清单（按登记顺序）。
 *
 * `createdAt` 是固定的登记时刻：内建机器人不随安装时间变化，重复补写也不会
 * 让它看起来是新的。
 */
export const BUILTIN_ROBOTS: ReadonlyArray<RobotRecord> = Object.freeze([
  {
    name: CLOCK_ROBOT_NAME,
    driver: 'program',
    path: '',
    program: CLOCK_ROBOT_NAME,
    createdAt: '2026-11-12T00:00:00.000Z',
    avatar: '',
    description: '到点完成任务的定时机器人：任务 payload 带 until，到点后自动完成。',
    assistant: false,
  },
])

/** 按名字取内建程序机器人；不是内建机器人时返回 undefined。 */
export function builtinRobot(name: unknown): RobotRecord | undefined {
  if (typeof name !== 'string') return undefined
  const trimmed = name.trim()
  return BUILTIN_ROBOTS.find((robot) => robot.name === trimmed)
}

/** 名字是否属于内建（不可创建 / 删除 / 改动的）程序机器人。 */
export function isBuiltinRobotName(name: unknown): boolean {
  return builtinRobot(name) !== undefined
}

/**
 * 把登记表里缺的内建机器人补到末尾。
 *
 * 只影响内存里的视图：页面与 `list()` 用它保证内建机器人总是可见；写回由
 * `ensureBuiltinRobots` 负责。
 */
export function withBuiltinRobots(robots: readonly RobotRecord[]): RobotRecord[] {
  const names = new Set(robots.map((robot) => robot.name))
  return [...robots, ...BUILTIN_ROBOTS.filter((robot) => !names.has(robot.name))]
}

/** 生成「内建机器人不可改动」错误。 */
export function builtinRobotError(name: unknown): Error & { code: string } {
  const error = new Error(`内建机器人不可创建、修改或删除：${String(name)}`)
  return Object.assign(error, { code: 'builtin-robot' })
}
