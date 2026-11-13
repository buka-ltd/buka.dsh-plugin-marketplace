/**
 * 与 Host 一半的 HTTP 接口。
 *
 * 页面只做展示与触发：列表、卸载、安装、收藏的读写都走 Host 注册的包内路由，
 * 不在浏览器里判断 npx 的安装方式，也不碰文件系统。路由常量与 Host
 * `src/routes.ts` 保持一致。
 *
 * @module @buka/dsh-plugin-skills/client/api
 */

import { messageOf, requestJson } from '@buka/plugin-ui'

/** 与 Host 一半的路由常量保持一致。 */
const LIST_ROUTE = '/buka-skills/list'
const UNINSTALL_ROUTE = '/buka-skills/uninstall'
const TARGETS_ROUTE = '/buka-skills/targets'
const INSTALL_ROUTE = '/buka-skills/install'
const REPOS_ROUTE = '/buka-skills/repos'
const REPO_REMOVE_ROUTE = '/buka-skills/repos/remove'
const REPO_SKILLS_ROUTE = '/buka-skills/repo-skills'

/**
 * 取错误上的 `code` 字段（Host 的失败响应带它）。
 */
function errorCode(failure: unknown): string | undefined {
  const code = (failure as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

export {
  errorCode,
  INSTALL_ROUTE,
  LIST_ROUTE,
  messageOf,
  REPO_REMOVE_ROUTE,
  REPO_SKILLS_ROUTE,
  REPOS_ROUTE,
  requestJson,
  TARGETS_ROUTE,
  UNINSTALL_ROUTE,
}
