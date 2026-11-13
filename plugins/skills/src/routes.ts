/**
 * 给浏览器一半的侧边栏「Skills」页面用的包内 HTTP 路由。
 *
 * 七个路由：
 *
 * - `GET /buka-skills/list` 列出全局 skills；
 * - `POST /buka-skills/uninstall` 卸载一个；
 * - `GET /buka-skills/targets` 列出可安装的打工人（`ctx.bukaWorkers`）与工作区
 *   （`ctx.workspaceRegistry`）；
 * - `POST /buka-skills/install` 把某个收藏仓库里的一个 skill 安装到全局、
 *   某个打工人目录或某个工作区目录；
 * - `GET /buka-skills/repos` 列出用户收藏的仓库，
 * - `POST /buka-skills/repos` 收藏一个，
 * - `POST /buka-skills/repos/remove` 移除一个，
 * - `GET /buka-skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
 *   `probe=1` 时只探测仓库类型：npx skills / Claude Code marketplace / 不可用）。
 *
 * 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
 * （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-skills/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NpxRunner } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'

import { describeError, parseQuery, readJsonBody, sendJson, sendMethodNotAllowed } from './http.ts'
import { listInstallTargets, resolveInstallTarget } from './install-targets.ts'
import { addSavedRepo, listSavedRepos, removeSavedRepo } from './repo-store.ts'
import type { SkillsCatalogService } from './service.ts'
import { installSavedSkill } from './skill-install.ts'
import type { GlobalSkillsSnapshot, Homes } from './skill-store.ts'
import { uninstallGlobalSkill } from './skill-store.ts'

/** 页面读取列表用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-skills/list'

/** 页面卸载 skill 用的路由。 */
const UNINSTALL_ROUTE = '/buka-skills/uninstall'

/** 页面读取可安装目标（打工人 / 工作区）用的路由。 */
const TARGETS_ROUTE = '/buka-skills/targets'

/** 页面把收藏仓库里的一个 skill 安装到全局 / 打工人 / 工作区用的路由。 */
const INSTALL_ROUTE = '/buka-skills/install'

/** 收藏仓库的列表 / 添加路由。 */
const REPOS_ROUTE = '/buka-skills/repos'

/** 收藏仓库的移除路由。 */
const REPO_REMOVE_ROUTE = '/buka-skills/repos/remove'

/** 收藏仓库的 skills 树路由。 */
const REPO_SKILLS_ROUTE = '/buka-skills/repo-skills'

/** 请求体里本插件认识的可选字段；其余字段忽略。 */
interface RequestBody {
  scope?: unknown
  id?: unknown
  source?: unknown
  note?: unknown
  path?: unknown
  target?: unknown
  worker?: unknown
  workspace?: unknown
}

/** 路由需要的共享依赖：都由入口装配好后传进来。 */
export interface RouteDeps {
  /** 两个全局 skills 根目录。 */
  readonly homes: Homes
  /** 执行 `npx skills` 的函数（cwd 已绑定到 agentsHome）。 */
  readonly runNpx: NpxRunner
  /** 仓库级缓存与并发合并所在的对外服务。 */
  readonly catalog: SkillsCatalogService
  /** 读一份已安装 skills 快照。 */
  readonly readSnapshot: () => Promise<GlobalSkillsSnapshot>
  /** 安装 / 卸载共用的串行队列。 */
  readonly serializeNpx: <T>(work: () => Promise<T>) => Promise<T>
}

/**
 * 注册全部路由。
 *
 * @param ctx 提供 `webServer` 与 `connection` 的插件上下文
 * @param deps 入口装配好的共享依赖
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): void {
  const { homes, runNpx, catalog, readSnapshot, serializeNpx } = deps

  // ---- HTTP 路由：浏览器一半的列表与卸载 ---------------------------------

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    /** 复用 web 组合的信任栅栏；被拒绝时已经写好响应。 */
    function rejected(req: IncomingMessage, res: ServerResponse): boolean {
      let rejection: number | undefined
      try {
        rejection = webCtx.connection.requestRejection(req)
      } catch {
        rejection = 500
      }
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
    }

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: LIST_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            try {
              const snapshot = await readSnapshot()
              sendJson(res, 200, { ok: true, ...snapshot })
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: GET ${LIST_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: UNINSTALL_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const fields = body as RequestBody | null
            try {
              const result = await serializeNpx(() =>
                uninstallGlobalSkill({
                  homes,
                  scope: fields?.scope,
                  id: fields?.id,
                  runNpx,
                }),
              )
              if (result.ok) {
                webCtx.logger?.info?.(
                  'buka-skills: 已卸载 %s（%s）',
                  String(fields?.id),
                  result.method,
                )
              }
              sendJson(res, result.ok ? 200 : statusFor(result.code), result)
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: POST ${UNINSTALL_ROUTE}`,
    )

    // ---- 可安装目标：打工人 / 工作区 ---------------------------------------
    // 两份列表都来自 Host 的登记表（可选的 `bukaWorkers` 服务与 DSH 的
    // `workspaceRegistry`），浏览器只拿到名字 / 标题 / 路径，安装时再把选中的
    // 字符串换回可信目录。

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: TARGETS_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            try {
              const targets = await listInstallTargets(webCtx)
              sendJson(res, 200, { ok: true, ...targets })
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: GET ${TARGETS_ROUTE}`,
    )

    // ---- 从收藏列表一键安装 ------------------------------------------------
    // 只接受收藏过的来源；skill 是否存在、叫什么以 Host 这次读到的仓库列表
    // 为准（浏览器只传仓库路径）。安装目标默认全局；打工人 / 工作区由
    // `resolveInstallTarget()` 从登记表解析成目录。三类安装与卸载共用串行队列，
    // 避免同时改写 npx skills 的 lockfile。

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: INSTALL_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const fields = body as RequestBody | null
            try {
              const result = await serializeNpx(() =>
                installSavedSkill({
                  homes,
                  catalog,
                  source: fields?.source,
                  skillPath: fields?.path,
                  target: fields?.target,
                  worker: fields?.worker,
                  workspace: fields?.workspace,
                  resolveTarget: (request) => resolveInstallTarget(webCtx, request),
                  runNpx,
                }),
              )
              if (result.ok) {
                webCtx.logger?.info?.(
                  'buka-skills: 已安装 %s（%s，%s）',
                  String(result.name),
                  String(result.repo),
                  result.target ?? 'global',
                )
              }
              sendJson(res, result.ok ? 200 : installStatusFor(result.code), result)
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: POST ${INSTALL_ROUTE}`,
    )

    // ---- 收藏的仓库（npx skills 与 Claude Code marketplace）----------------
    // 收藏是用户自己的书签：写入同一个 JSON 文件，和已安装列表互不影响。
    // 写操作排成队列，避免两次「添加」互相覆盖整个文件。

    let repoQueue: Promise<void> = Promise.resolve()
    function serializeRepo<T>(work: () => Promise<T>): Promise<T> {
      const run = repoQueue.then(work, work)
      repoQueue = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    }

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: REPOS_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method === 'GET') {
              try {
                const store = await listSavedRepos({ homes })
                sendJson(res, 200, { ok: true, ...store })
              } catch (error) {
                sendJson(res, 500, { ok: false, message: describeError(error) })
              }
              return
            }
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'GET, POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const fields = body as RequestBody | null
            try {
              const result = await serializeRepo(() =>
                addSavedRepo({ homes, source: fields?.source, note: fields?.note }),
              )
              if (result.ok) {
                webCtx.logger?.info?.('buka-skills: 已收藏仓库 %s', String(fields?.source))
              }
              sendJson(res, result.ok ? 200 : repoStatusFor(result.code), result)
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: ${REPOS_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: REPO_REMOVE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return
            const fields = body as RequestBody | null
            try {
              const result = await serializeRepo(() => removeSavedRepo({ homes, id: fields?.id }))
              if (result.ok) {
                webCtx.logger?.info?.('buka-skills: 已移除收藏 %s', String(fields?.id))
              }
              sendJson(res, result.ok ? 200 : repoStatusFor(result.code), result)
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: POST ${REPO_REMOVE_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: REPO_SKILLS_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            const query = parseQuery(req)
            const source = query.get('source') ?? ''
            const refresh = query.get('refresh') === '1'
            // probe=1 只探测仓库类型（收藏卡片徽标用），不拉 SKILL.md。
            const probe = query.get('probe') === '1'
            try {
              const result = probe
                ? await catalog.probeRepositoryKind({ source, refresh })
                : await catalog.fetchRepositorySkills({ source, refresh })
              sendJson(res, result.ok ? 200 : repoSkillsStatusFor(result.code), result)
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: GET ${REPO_SKILLS_ROUTE}`,
    )
  })
}

/**
 * 按失败原因选 HTTP 状态码。
 *
 * @param code skill-store 返回的错误码
 */
function statusFor(code: string | undefined): number {
  if (code === 'not-found') return 404
  if (code === 'invalid-scope' || code === 'invalid-id') return 400
  if (code === 'lock-unreadable') return 409
  return 500
}

/**
 * 安装操作的失败码 → HTTP 状态码。
 *
 * `not-saved` / `invalid-source` / `invalid-skill-name` / `invalid-target` /
 * `invalid-worker` / `invalid-workspace` 是请求本身的问题（400）；
 * `skill-not-found`、仓库不存在、`unknown-worker` / `unknown-workspace` 是 404；
 * `already-installed` / `store-unreadable` / `missing-target` /
 * `workers-unavailable` / `workspaces-unavailable` / `no-target-resolver` 是当前
 * 状态不允许这次写入（409）；仓库不可用 422；限流 429；`unsupported-home` 与
 * `git-unavailable` 是本机环境问题（500）；其余（`npx-failed`、`fetch-failed`、
 * `git-failed`、`install-incomplete` 等上游失败）按 502 处理。
 *
 * @param code skill-install 返回的错误码
 */
function installStatusFor(code: string | undefined): number {
  if (
    code === 'invalid-source' ||
    code === 'invalid-skill-name' ||
    code === 'not-saved' ||
    code === 'unsupported-source' ||
    code === 'invalid-target' ||
    code === 'invalid-worker' ||
    code === 'invalid-workspace'
  ) {
    return 400
  }
  if (
    code === 'skill-not-found' ||
    code === 'repo-not-found' ||
    code === 'not-found' ||
    code === 'unknown-worker' ||
    code === 'unknown-workspace'
  ) {
    return 404
  }
  if (
    code === 'already-installed' ||
    code === 'store-unreadable' ||
    code === 'missing-target' ||
    code === 'workers-unavailable' ||
    code === 'workspaces-unavailable' ||
    code === 'no-target-resolver'
  ) {
    return 409
  }
  if (code === 'repo-unavailable') return 422
  if (code === 'rate-limited') return 429
  if (code === 'unsupported-home' || code === 'git-unavailable') return 500
  return 502
}

/**
 * 收藏操作的失败码 → HTTP 状态码。
 *
 * `duplicate` 与 `store-unreadable` 都是 409：请求本身合法，只是当前状态
 * 不允许这次写入（已经收藏过 / 收藏文件需要先修复）。
 */
function repoStatusFor(code: string | undefined): number {
  if (code === 'not-found') return 404
  if (code === 'invalid-id' || code === 'invalid-source' || code === 'invalid-note') return 400
  if (code === 'duplicate' || code === 'store-unreadable') return 409
  return 500
}

/**
 * 仓库 skills 路由的失败码 → HTTP 状态码。
 *
 * `unsupported-source` 用 400：来源本身合法，但这个来源（npm 包名 / 已知不是
 * 仓库的网页链接）没有可以让 Host 列举的仓库树，请求方不该重试。
 * `repo-unavailable` 用 422：请求格式没问题，只是这个仓库既不是 npx skills
 * 也不是 Claude Code marketplace，改来源才有意义。
 *
 * `git-unavailable`（本机没有 git）用 500：这是 Host 环境问题，与来源无关；
 * `git-failed`（clone/fetch 失败）用 502：上游 git 服务或网络的问题，和 GitHub
 * 的 `fetch-failed` 同级。
 */
function repoSkillsStatusFor(code: string | undefined): number {
  if (code === 'invalid-source' || code === 'unsupported-source') return 400
  if (code === 'repo-unavailable') return 422
  if (code === 'repo-not-found') return 404
  if (code === 'rate-limited') return 429
  if (code === 'git-unavailable') return 500
  return 502
}
