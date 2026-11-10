/**
 * 全局 skills 管理插件：Host 一半。
 *
 * 提供三件东西：
 *
 * - 包内 HTTP 路由，给浏览器一半的侧边栏「Skills」页面用：
 *   `GET /buka-skills/list` 列出全局 skills，`POST /buka-skills/uninstall` 卸载一个，
 *   `POST /buka-skills/install` 把某个收藏仓库里的一个 skill 安装到全局；
 *   `GET /buka-skills/repos` 列出用户收藏的仓库，
 *   `POST /buka-skills/repos` 收藏一个，`POST /buka-skills/repos/remove` 移除一个，
 *   `GET /buka-skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
 *   `probe=1` 时只探测仓库类型：npx skills / Claude Code marketplace / 不可用）。
 *   收藏的仓库既可以是 npx skills 仓库，也可以是 Claude Code marketplace 仓库：
 *   前者按 `npx skills` 的发现规则列 SKILL.md，后者只列 marketplace 里各本地
 *   插件子树中的 SKILL.md（commands / agents 不列）。收藏来源可以是 GitHub
 *   仓库、任意 git 远端（Host 用 `git clone --depth 1` 拉到缓存目录再扫描）或
 *   本地绝对路径（直接扫描目录）。列表数据来自同一份磁盘扫描
 *   （`lib/skill-store.js`），收藏来自 `lib/repo-store.js` 的 JSON 文件，
 *   仓库 skills 由 `lib/repo-skills.js` 按 TTL 缓存仓库树，安装由
 *   `lib/skill-install.js` 交给 `npx skills add`（与卸载共用串行队列）；
 * - 一个只读工具 `buka_skills`，让模型能回答「本机装了哪些全局 skill、它们
 *   是不是 npx skills 装的」。安装与卸载都是写操作，只留给页面上的用户按钮，
 *   不开放给模型。
 * - 一个 Host Service `ctx.bukaSkills`（`lib/service.js`）：把收藏的仓库、
 *   仓库里的 skill 列表与 marketplace 插件列表开放给其他插件。页面与工具
 *   也复用同一个服务实例，因此两处的缓存与并发请求是同一份。
 *
 * 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
 * （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-skills
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { createNpxRunner } from './npx.js'
import { addSavedRepo, listSavedRepos, removeSavedRepo } from './repo-store.js'
import { SERVICE_NAME, SkillsCatalogService } from './service.js'
import { installSavedSkill } from './skill-install.js'
import { collectGlobalSkills, resolveHomes, uninstallGlobalSkill } from './skill-store.js'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'skill-buka-skills'

/** 依赖的服务：列举 skill 需要 skills 注册表；页面与工具各自按可选依赖挂载。 */
export const inject = ['skills']

/** 页面读取列表用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-skills/list'

/** 页面卸载 skill 用的路由。 */
const UNINSTALL_ROUTE = '/buka-skills/uninstall'

/** 页面把收藏仓库里的一个 skill 安装到全局用的路由。 */
const INSTALL_ROUTE = '/buka-skills/install'

/** 收藏仓库的列表 / 添加路由。 */
const REPOS_ROUTE = '/buka-skills/repos'

/** 收藏仓库的移除路由。 */
const REPO_REMOVE_ROUTE = '/buka-skills/repos/remove'

/** 收藏仓库的 skills 树路由。 */
const REPO_SKILLS_ROUTE = '/buka-skills/repo-skills'

/** 卸载请求体很小（只有 scope 与 id），超过这个大小按恶意请求处理。 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * 注册路由与只读工具。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 提供 `skills` 的插件上下文
 */
export function apply(ctx) {
  const homes = resolveHomes()
  const runNpx = createNpxRunner(homes)

  // 对外服务：其他插件的 `inject: ['bukaSkills']` 拿到的就是这个实例。
  // 服务本身不注册 effect，会随本插件 fiber 卸载自动从 ctx 上摘除。
  const catalog = new SkillsCatalogService({ homes })
  ctx.provide(SERVICE_NAME, catalog)

  /**
   * 读取快照。skills 注册表读取失败时仍然返回磁盘扫描结果，只是描述为空：
   * 页面不该因为注册表故障而看不到已安装的 skill。
   */
  async function readSnapshot() {
    let summaries = []
    try {
      summaries = await ctx.skills.list({ cwd: homes.agentsHome })
    } catch (error) {
      ctx.logger?.warn?.('buka-skills: 无法读取 skills 注册表：%s', describeError(error))
    }
    return collectGlobalSkills({ homes, summaries })
  }

  // 仓库级请求的并发合并与 TTL 缓存都在服务里：页面路由与外部插件调服务时
  // 共用同一份在途请求，同一仓库不会重复打 GitHub。

  // npx skills 会整份重写共享的 lockfile，安装与卸载并发执行可能互相覆盖条目；
  // 这里把两类请求排成一条队列，页面上的并发点击也安全。
  let npxQueue = Promise.resolve()
  function serializeNpxTool(work) {
    const run = npxQueue.then(work, work)
    npxQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // ---- HTTP 路由：浏览器一半的列表与卸载 ---------------------------------

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    /** 复用 web 组合的信任栅栏；被拒绝时已经写好响应。 */
    function rejected(req, res) {
      let rejection
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
            try {
              const result = await serializeNpxTool(() =>
                uninstallGlobalSkill({
                  homes,
                  scope: body?.scope,
                  id: body?.id,
                  runNpx,
                }),
              )
              if (result.ok) {
                webCtx.logger?.info?.('buka-skills: 已卸载 %s（%s）', String(body?.id), result.method)
              }
              sendJson(res, result.ok ? 200 : statusFor(result.code), result)
            } catch (error) {
              sendJson(res, 500, { ok: false, message: describeError(error) })
            }
          },
        }),
      `buka-skills: POST ${UNINSTALL_ROUTE}`,
    )

    // ---- 从收藏列表一键安装 ------------------------------------------------
    // 只接受收藏过的来源；skill 是否存在、叫什么以 Host 这次读到的仓库列表
    // 为准（浏览器只传仓库路径）。安装与卸载共用串行队列，避免两者同时改写
    // npx skills 的 lockfile。

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
            try {
              const result = await serializeNpxTool(() =>
                installSavedSkill({
                  homes,
                  catalog,
                  source: body?.source,
                  skillPath: body?.path,
                  runNpx,
                }),
              )
              if (result.ok) {
                webCtx.logger?.info?.('buka-skills: 已安装 %s（%s）', String(result.name), String(result.repo))
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

    let repoQueue = Promise.resolve()
    function serializeRepo(work) {
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
            try {
              const result = await serializeRepo(() =>
                addSavedRepo({ homes, source: body?.source, note: body?.note }),
              )
              if (result.ok) {
                webCtx.logger?.info?.('buka-skills: 已收藏仓库 %s', String(body?.source))
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
            try {
              const result = await serializeRepo(() => removeSavedRepo({ homes, id: body?.id }))
              if (result.ok) webCtx.logger?.info?.('buka-skills: 已移除收藏 %s', String(body?.id))
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

  // ---- 模型工具：只读列举 ------------------------------------------------

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(
      defineTool({
        name: 'buka_skills',
        description:
          'List the skills installed globally for every DSH session (~/.agents/skills and ~/.dsh/skills) and mark the ones the npx skills CLI installed and manages. Use it when the user asks which global skills exist or how one of them got installed. Uninstalling is a user action on the Skills page in the DSH sidebar.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              skills: {
                type: 'array',
                required: true,
                description: 'Global skills, sorted by name.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true, description: 'Skill name from its frontmatter.' },
                    description: { type: 'string', required: true, description: 'Skill description from its frontmatter.' },
                    scope: {
                      type: 'string',
                      required: true,
                      description: 'agents for ~/.agents/skills or dsh for ~/.dsh/skills.',
                    },
                    managedByNpx: {
                      type: 'boolean',
                      required: true,
                      description: 'Whether the npx skills CLI installed and manages this skill.',
                    },
                    source: {
                      type: 'string',
                      description: 'For npx-managed skills, the source repository such as firecrawl/skills.',
                    },
                  },
                },
              },
            },
          },
          render: (_args, value) => {
            const skills = Array.isArray(value?.skills) ? value.skills : []
            if (skills.length === 0) return [{ type: 'text', text: 'No global skills are installed.' }]
            return [
              {
                type: 'text',
                text: skills
                  .map((skill) => {
                    const origin = skill.managedByNpx ? 'npx skills' : 'manual'
                    const source = skill.source === undefined ? '' : ` — ${skill.source}`
                    return `- ${skill.name} (${origin}, ${skill.scope})${source}`
                  })
                  .join('\n'),
              },
            ]
          },
        },
        async execute() {
          const snapshot = await readSnapshot()
          return {
            skills: snapshot.skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              scope: skill.scope,
              managedByNpx: skill.managedByNpx,
              ...(skill.npxSource === null ? {} : { source: skill.npxSource }),
            })),
          }
        },
      }),
    )
  })
}

/**
 * 按失败原因选 HTTP 状态码。
 *
 * @param {string | undefined} code skill-store 返回的错误码
 * @returns {number}
 */
function statusFor(code) {
  if (code === 'not-found') return 404
  if (code === 'invalid-scope' || code === 'invalid-id') return 400
  if (code === 'lock-unreadable') return 409
  return 500
}

/**
 * 安装操作的失败码 → HTTP 状态码。
 *
 * `not-saved` / `invalid-source` / `invalid-skill-name` / `unsupported-source` 是
 * 请求本身的问题（400）；`skill-not-found` 与仓库不存在是 404；
 * `already-installed` / `store-unreadable` 是当前状态不允许这次写入（409）；
 * 仓库不可用 422；限流 429；`unsupported-home` 与 `git-unavailable` 是本机环境
 * 问题（500）；其余（`npx-failed`、`fetch-failed`、`git-failed` 等上游失败）
 * 按 502 处理。
 *
 * @param {string | undefined} code skill-install 返回的错误码
 * @returns {number}
 */
function installStatusFor(code) {
  if (
    code === 'invalid-source' ||
    code === 'invalid-skill-name' ||
    code === 'not-saved' ||
    code === 'unsupported-source'
  ) {
    return 400
  }
  if (code === 'skill-not-found' || code === 'repo-not-found' || code === 'not-found') return 404
  if (code === 'already-installed' || code === 'store-unreadable') return 409
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
 *
 * @param {string | undefined} code
 * @returns {number}
 */
function repoStatusFor(code) {
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
 *
 * @param {string | undefined} code
 * @returns {number}
 */
function repoSkillsStatusFor(code) {
  if (code === 'invalid-source' || code === 'unsupported-source') return 400
  if (code === 'repo-unavailable') return 422
  if (code === 'repo-not-found') return 404
  if (code === 'rate-limited') return 429
  if (code === 'git-unavailable') return 500
  return 502
}

/**
 * 解析 GET 路由的查询串。
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {URLSearchParams}
 */
function parseQuery(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * 读取并解析 JSON 请求体。
 *
 * 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
 * 返回 `undefined` 让调用方直接返回；`null` 是合法 JSON，原样返回。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req, res) {
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    sendJson(res, 415, { ok: false, message: 'content-type 必须是 application/json' })
    return undefined
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendJson(res, 413, { ok: false, message: '请求体过大' })
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
    return undefined
  }
}

/**
 * 把任意错误转成可以展示的文本。
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 发送 JSON 响应；数据是实时事实，不缓存。 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 并带上唯一支持的方法。 */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/**
 * 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string | null>}
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}
