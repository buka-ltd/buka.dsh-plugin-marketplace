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
  /** 有上游更新的 skill 名，已排序。有本地修改的 skill 不在这里。 */
  readonly updates: readonly string[]
  /**
   * 本地文件与 lock 里的哈希不一致的 skill 名，已排序。
   *
   * 这类 skill 即使上游也有更新也不会被列入 `updates`：更新会覆盖本地修改，
   * 所以弹窗只提示、不提供更新按钮。
   */
  readonly modified?: readonly string[]
  /**
   * 待更新 skill 的来源，按 skill 名索引，例如 `{ "ask-matt": "mattpocock/skills" }`。
   *
   * 取自工作区 `skills-lock.json` 里记录的来源；弹窗在名字下面显示它，让用户
   * 知道这次更新的是哪个仓库里的技能。没有来源记录的名字不会出现在这里。
   */
  readonly sources?: Readonly<Record<string, string>>
  /** 本次检查完成的时间（Unix 毫秒）。 */
  readonly checkedAt: number
  /** 不需要展示的补充说明，例如「没有可检查的项目」。 */
  readonly message?: string
}

/** 检查 / 更新失败时的错误码。 */
export type SkillUpdatesFailureCode =
  | 'lock-unreadable'
  | 'check-failed'
  | 'cli-unavailable'
  | 'update-failed'
  | 'invalid-request'
  | 'no-workspace'

/** 检查失败；失败不缓存，下一次请求会重试。 */
export interface SkillUpdatesFailure {
  readonly ok: false
  readonly code: SkillUpdatesFailureCode
  readonly message: string
  /** `skills` CLI 的输出尾部，便于排查。 */
  readonly output?: string
}

/** 一个更新失败的 skill。 */
export interface SkillUpdateFailureItem {
  readonly name: string
  readonly message: string
}

/**
 * 一次更新请求的结果。
 *
 * `ok` 只表示这一次请求本身执行完了：单个 skill 的失败在 `failed` 里，
 * 不把整次请求变成错误。`snapshot` 是更新之后重新检查得到的新状态，浏览器
 * 直接用它刷新弹窗列表与提示计数，不需要再发一次检查请求。
 */
export interface SkillUpdateReport {
  readonly ok: true
  /** 成功更新的 skill 名，按执行顺序。 */
  readonly updated: readonly string[]
  /** 更新失败的 skill；这些 skill 通常会继续留在待更新列表里。 */
  readonly failed: readonly SkillUpdateFailureItem[]
  /** 更新后的检查快照。 */
  readonly snapshot: SkillUpdatesSnapshot
  /** 不需要展示的补充说明，例如「没有待更新的技能」。 */
  readonly message?: string
}
