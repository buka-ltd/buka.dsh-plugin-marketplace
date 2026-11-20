/**
 * 宿主与界面两半共用的结果形状。
 *
 * 这个文件不能 import Node 或 DSH 包：浏览器一半也会 import 它，打包时必须
 * 保持纯类型。
 *
 * @module @buka/dsh-plugin-skill-update-check/types
 */

/** 一次检查的结论。 */
export type SkillUpdatesStatus =
  /** 至少一个项目 skill 有上游更新。 */
  | 'updates'
  /** 全部项目 skill 都是最新的。 */
  | 'up-to-date'
  /** 当前工作区没有 `skills-lock.json`，或里面没有 npx 管理的项目 skill。 */
  | 'no-project-skills'
  /** 会话没有可解析的工作区目录，检查没有执行。 */
  | 'unavailable'

/** 检查成功时的快照；`updates` 只含有上游更新的 skill。 */
export interface SkillUpdatesSnapshot {
  readonly ok: true
  readonly status: SkillUpdatesStatus
  /** 被检查的工作区目录；`unavailable` 时省略。 */
  readonly dir?: string
  /** `skills-lock.json` 里由 npx 管理的 skill 数量。 */
  readonly total: number
  /** 有上游更新的 skill 名，已排序。 */
  readonly updates: readonly string[]
  /** 本次检查完成的时间（Unix 毫秒）。 */
  readonly checkedAt: number
  /** 不需要展示的补充说明，例如「没有可检查的项目」。 */
  readonly message?: string
}

/** 检查失败时的错误码。 */
export type SkillUpdatesFailureCode = 'lock-unreadable' | 'check-failed' | 'cli-unavailable'

/** 检查失败；失败不缓存，下一次请求会重试。 */
export interface SkillUpdatesFailure {
  readonly ok: false
  readonly code: SkillUpdatesFailureCode
  readonly message: string
  /** `skills check` 的输出尾部，便于排查。 */
  readonly output?: string
}
