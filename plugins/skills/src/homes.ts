/**
 * DSH home 路径的解析。
 *
 * 两个全局 skills 根、`npx skills` 的 lockfile、插件自己的缓存与收藏文件都
 * 放在这两个目录下，所以解析规则集中在这里：`DSH_AGENTS_HOME` / `DSH_HOME`
 * 未设置时退回 `~/.agents` 与 `~/.dsh`，与 DSH 自己的默认值一致。
 *
 * @module @buka/dsh-plugin-skills/homes
 */

import os from 'node:os'
import path from 'node:path'

/** 共享 agent 配置目录名；`DSH_AGENTS_HOME` 未设置时用它拼出 `~/.agents`。 */
export const AGENTS_DIR = '.agents'

/** 两个全局根目录的位置。 */
export interface Homes {
  readonly agentsHome: string
  readonly dshHome: string
}

/**
 * 按 DSH home-paths 的习惯处理环境变量：去掉首尾空白，展开开头的 `~`。
 *
 * @param value 原始环境变量值
 * @returns 规范化后的路径；空值时返回 null
 */
export function envPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (text === '~') return os.homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2))
  return text
}

/**
 * 解析两个全局根目录的位置。与 DSH 自己的默认值保持一致：
 * `dshHome` 取 `DSH_HOME` 或 `~/.dsh`，`agentsHome` 取 `DSH_AGENTS_HOME` 或 `~/.agents`。
 *
 * @param env 环境变量；测试时可传入
 */
export function resolveHomes(env: NodeJS.ProcessEnv = process.env): Homes {
  const home = os.homedir()
  return {
    agentsHome: envPath(env.DSH_AGENTS_HOME) ?? path.join(home, AGENTS_DIR),
    dshHome: envPath(env.DSH_HOME) ?? path.join(home, '.dsh'),
  }
}
