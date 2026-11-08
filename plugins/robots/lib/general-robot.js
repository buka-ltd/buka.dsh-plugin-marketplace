/**
 * 内置「通用型机器人」的身份信息。
 *
 * 它没有目录、AGENTS.md 与 skills，也不写进 `robots.json`；启用时由插件以固定
 * 的名字 / 职责暴露给工作流（`buka_robots` 工具、`ctx.bukaRobots.avatarMap()`
 * 与 `startSession()`），停用后完全不出现、也不能被调用。
 *
 * 工作流里它必须是**兜底选项**：排在所有登记机器人之后，只有没有其他更合适的
 * 机器人时才使用。它的会话落在调用方所在的工作区（普通标准模式），因此该工作区
 * 的 AGENTS.md 与项目 skills 照常生效。
 *
 * 名字与头像 id 是跨插件契约：节点图靠 `avatarMap()` 拿到 `robot` 这个 id 画固定
 * 的 🤖 头像（见 `plugins/workflows/client.js`）；改名字要同步浏览器一半与工作流插件。
 *
 * 对外它和普通机器人没有区别：工具清单里不额外暴露任何标记字段，只有名字、
 * 职责与和其它机器人同形的字段。
 *
 * @module @buka/dsh-plugin-robots/general-robot
 */

/** 暴露给工作流时使用的机器人名字。 */
export const GENERAL_ROBOT_NAME = '通用型机器人'

/** 头像是固定的 🤖；`robot` 不在普通机器人的可选头像集合里，只用于这个兜底项。 */
export const GENERAL_ROBOT_AVATAR_ID = 'robot'

/** 对外的职责：只说这个机器人负责什么、什么时候用，不提「工作流」的存在。 */
export const GENERAL_ROBOT_DESCRIPTION =
  '以标准模式在任意已有工作区里执行通用任务，自身没有目录、AGENTS.md 或 skills；没有专用机器人时使用。'

/**
 * 这个名字是不是通用型机器人。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isGeneralRobotName(value) {
  return typeof value === 'string' && value.trim() === GENERAL_ROBOT_NAME
}

/**
 * 给模型 / 页面用的清单项：形状与普通机器人一致，不携带任何「内置 / 兜底」
 * 标记；调用方所在的工作区可以作为 path / workspaceId 传进来，让它在清单里
 * 看起来就是一个普通机器人。
 *
 * @param {{ path?: unknown, workspaceId?: unknown, mounted?: unknown }} [options]
 * @returns {{
 *   name: string,
 *   avatar: string,
 *   description: string,
 *   path: string,
 *   exists: true,
 *   mounted: boolean,
 *   workspaceId: string | null,
 *   skills: [],
 *   agents: { exists: false, bytes: 0, modifiedAt: null },
 * }}
 */
export function generalRobotEntry(options = {}) {
  const path = typeof options.path === 'string' ? options.path : ''
  const workspaceId = typeof options.workspaceId === 'string' ? options.workspaceId : null
  return {
    name: GENERAL_ROBOT_NAME,
    avatar: GENERAL_ROBOT_AVATAR_ID,
    description: GENERAL_ROBOT_DESCRIPTION,
    path,
    exists: true,
    mounted: options.mounted === true || workspaceId !== null,
    workspaceId,
    skills: [],
    agents: { exists: false, bytes: 0, modifiedAt: null },
  }
}
