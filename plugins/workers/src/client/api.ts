/**
 * 「打工人」页面与 Host 通信的请求 / 错误处理。
 *
 * 所有 `/buka-workers/*` 路由都返回 `{ ok, ... }`；非 2xx 或 `ok !== true` 时
 * 抛出带 `code` 的错误，页面再按错误码翻成可读文案。
 *
 * @module @buka/dsh-plugin-workers/client/api
 */

import { messageOf, requestJson as requestJsonBase } from '@buka/plugin-ui'
import type {
  HostResponse,
  Translate,
  Worker,
  WorkerAgents,
  WorkerClaude,
  WorkerSkill,
} from './types.ts'

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
 * Host 返回的错误码 → 可读文案；未知错误原样展示 message。
 *
 */
export function failureText(t: Translate, failure: unknown): string {
  switch (errorCode(failure)) {
    case 'invalid-name':
      return t('errInvalidName')
    case 'invalid-avatar':
      return t('errInvalidAvatar')
    case 'not-directory':
      return t('errNotDirectory')
    case 'unknown-worker':
      return t('errUnknownWorker')
    case 'name-taken':
      return t('errNameTaken')
    case 'invalid-update':
      return t('errInvalidUpdate')
    case 'path-outside-root':
      return t('errPathOutsideRoot')
    case 'missing-directory':
      return t('errMissingDirectory')
    case 'registry-unreadable':
      return t('errRegistryUnreadable')
    case 'robot-worker':
      return t('errRobotWorker')
    case 'builtin-worker':
      return t('errBuiltinWorker')
    case 'invalid-assistant':
      return t('errInvalidAssistant')
    case 'invalid-model':
      return t('errInvalidModel')
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
    case 'list-unparsed':
      return t('errListUnparsed')
    case 'npx-failed':
      return t('errNpxFailed')
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
 * 打工人的 skills 列表；Host 字段缺失时回退空数组，避免渲染期抛错。
 *
 */
export function skillsOf(worker: Worker): WorkerSkill[] {
  return Array.isArray(worker?.skills) ? worker.skills : []
}

/**
 * 打工人的 AGENTS.md 摘要；缺失时给一个「不存在」的空结构。
 *
 */
export function agentsOf(worker: Worker): WorkerAgents {
  const agents = worker?.agents
  if (agents === null || typeof agents !== 'object') {
    return { exists: false, bytes: 0, modifiedAt: null, content: '', tooLarge: false }
  }
  return {
    exists: agents.exists === true,
    bytes: typeof agents.bytes === 'number' ? agents.bytes : 0,
    modifiedAt: typeof agents.modifiedAt === 'string' ? agents.modifiedAt : null,
    content: typeof agents.content === 'string' ? agents.content : '',
    tooLarge: agents.tooLarge === true,
  }
}

/**
 * 打工人的 CLAUDE.md 链接摘要；缺失时按「没有链接」处理。
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
