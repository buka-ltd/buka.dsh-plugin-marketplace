/**
 * 「执行者」页面与 Host 通信的请求 / 错误处理。
 *
 * 所有 `/workflow/workers/*` 路由都返回 `{ ok, ... }`；非 2xx 或 `ok !== true` 时
 * 抛出带 `code` 的错误，页面再按错误码翻成可读文案。逐项更新是例外：请求
 * 成功但部分 skill 失败时回 200 + `ok:false`，由调用方读取 `update.failed`。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/api
 */

import type { JsonRequestInit } from '@buka/plugin-ui'
import { messageOf, requestJson as requestJsonBase } from '@buka/plugin-ui'

import type { HostResponse, Translate, Worker, WorkerClaude, WorkerSkill } from './types.ts'

export { workerDisplayName, workerIdentityLabel } from '@buka/plugin-ui'
export { messageOf }

/** 读带错误码的错误的 `code`；不是对象或没有字符串 `code` 时返回 undefined。 */
export function errorCode(failure: unknown): string | undefined {
  if (failure === null || typeof failure !== 'object' || !('code' in failure)) return undefined
  const code = failure.code
  return typeof code === 'string' ? code : undefined
}

/** 读失败响应里的命令输出；没有时返回空串。 */
export function outputOf(failure: unknown): string {
  if (failure === null || typeof failure !== 'object' || !('output' in failure)) return ''
  const output = failure.output
  return typeof output === 'string' ? output : ''
}

/**
 * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
 * 实现统一在界面侧公共包里，这里只补上本插件的默认响应类型。
 *
 */
export function requestJson<T = HostResponse>(
  url: string,
  init: RequestInit & { body?: string } = {},
): Promise<T> {
  return requestJsonBase<T>(url, init)
}

/**
 * 读允许 `ok:false` 的 2xx 响应。
 *
 * 更新的「逐项失败」是请求成功、部分 skill 失败：路由回 200 但 `ok:false`，
 * 页面需要拿到 `update.failed` 里的原因再决定提示方式，所以不能按普通请求
 * 直接抛错。
 */
export function requestUpdateJson<T = HostResponse>(
  url: string,
  init: JsonRequestInit = {},
): Promise<T> {
  return requestJsonBase<T>(url, { ...init, allowFailureBody: true })
}

/**
 * Host 返回的错误码 → 可读文案；未知错误原样展示 message。
 *
 */
export function failureText(t: Translate, failure: unknown): string {
  switch (errorCode(failure)) {
    case 'invalid-id':
      return t('errInvalidId')
    case 'invalid-name':
      return t('errInvalidName')
    case 'id-taken':
      return t('errIdTaken')
    case 'invalid-avatar':
      return t('errInvalidAvatar')
    case 'not-directory':
      return t('errNotDirectory')
    case 'unknown-worker':
      return t('errUnknownWorker')
    case 'invalid-update':
      return t('errInvalidUpdate')
    case 'missing-directory':
      return t('errMissingDirectory')
    case 'registry-unreadable':
      return t('errRegistryUnreadable')
    case 'robot-worker':
      return t('errRobotWorker')
    case 'builtin-worker':
      return t('errBuiltinWorker')
    case 'worker-in-use':
      return t('deleteBlockedByJobs')
    case 'outside-root':
      return t('errOutsideRoot')
    case 'workspace-unavailable':
      return t('errWorkspaceUnavailable')
    case 'invalid-model':
      return t('errInvalidModel')
    case 'invalid-agent-preset':
      return t('errInvalidAgentPreset')
    case 'unknown-agent-preset':
      return t('errUnknownAgentPreset')
    case 'invalid-driver':
      return t('errInvalidDriver')
    case 'too-large':
      return t('errTooLarge')
    case 'invalid-content':
      return t('errInvalidContent')
    case 'invalid-source':
      return t('errInvalidSource')
    case 'invalid-skill':
      return t('errInvalidSkill')
    case 'invalid-skills':
      return t('errInvalidSkills')
    case 'not-saved':
      return t('errSourceNotSaved')
    case 'repos-unreadable':
      return t('errReposUnreadable')
    case 'skill-not-found':
      return t('errSkillNotFound')
    case 'npx-failed':
      return t('errNpxFailed')
    case 'skills-unavailable':
      return t('errSkillsUnavailable')
    case 'update-failed':
      return t('errUpdateFailed')
    default:
      return messageOf(failure)
  }
}

/**
 * `{n} skills` 这类带数量的标签；占位符写在词典里，中英文各自组织语序。
 *
 */
export function countBadge(count: number, t: (arg0: string) => string): string {
  return String(t('skillsBadge')).replace('{n}', String(count))
}

/** 是否机器人（只读、没有目录与会话）。 */
export function isRobotWorker(worker: Worker): boolean {
  return worker?.driver === 'robot'
}

/**
 * 工作流状态 → 可读文案。
 *
 * 执行者页与工作流页是两个词典命名空间，这里只认识删除影响面里会出现的
 * `active` / `retired` / `draft`；其它值原样显示，避免把状态吞成空白。
 *
 */
export function workflowStatusText(t: Translate, status: unknown): string {
  switch (status) {
    case 'active':
      return t('workflowStatusActive')
    case 'retired':
      return t('workflowStatusRetired')
    case 'draft':
      return t('workflowStatusDraft')
    default:
      return typeof status === 'string' ? status : ''
  }
}

/**
 * 执行者的 skills 列表；Host 字段缺失时回退空数组，避免渲染期抛错。
 *
 */
export function skillsOf(worker: Worker): WorkerSkill[] {
  return Array.isArray(worker?.skills) ? worker.skills : []
}

/**
 * 执行者的 CLAUDE.md 链接摘要；缺失时按「没有链接」处理。
 *
 */
export function claudeOf(worker: Worker): WorkerClaude {
  const claude = worker?.claude
  if (claude === null || typeof claude !== 'object') {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }
  return {
    exists: claude.exists === true,
    symlink: claude.symlink === true,
    mode: typeof claude.mode === 'string' ? claude.mode : 'missing',
    target: typeof claude.target === 'string' ? claude.target : '',
  }
}
