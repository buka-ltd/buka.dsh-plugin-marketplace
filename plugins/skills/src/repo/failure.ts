/**
 * 统一的失败返回与错误文本：`repo-skills` 各模块共用。
 *
 * 错误码集合与模块契约一致：`git-unavailable` 表示本机没有可执行的 git；
 * `git-failed` 表示 clone / fetch / 读克隆目录失败。两者只可能出现在 git
 * 来源上，其余错误码对三种来源通用。
 *
 * @module @buka/dsh-plugin-skills/repo/failure
 */

import type { RepoSkillsFailure, RepoSkillsFailureCode } from './types.ts'

/**
 * 统一的失败返回，保证错误码集合与模块契约一致。
 */
export function failure(code: RepoSkillsFailureCode, message: string): RepoSkillsFailure {
  return { ok: false, code, message }
}

/**
 * 「既不是 npx skills 仓库，也不是 Claude Code marketplace」的统一失败返回。
 */
export function repoUnavailable(): RepoSkillsFailure {
  return failure(
    'repo-unavailable',
    'Repository is neither an npx skills repository nor a Claude Code plugin marketplace.',
  )
}

/**
 * 把任意错误转成可以展示的文本。
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
