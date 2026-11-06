/**
 * 侧边栏「机器人」页面的 Host 一半。
 *
 * v2 里机器人是**插件自己创建并登记**的对象，不是 DSH 的全部工作区：新建
 * 机器人时在插件全局目录下的 `robots/` 里建同名目录并写进 `robots.json`，
 * 再由浏览器一半把它挂到 DSH 工作区列表。Host 负责所有磁盘操作，提供六条
 * 包内 HTTP 路由给页面，全部按机器人 **name** 操作：
 *
 * | 路由 | 作用 |
 * | --- | --- |
 * | `GET /buka-robots/list` | 列出登记表里的机器人、挂载状态、skills 与 AGENTS.md |
 * | `POST /buka-robots/create` | 建目录 + AGENTS.md 模板，并把机器人插到登记表最前 |
 * | `POST /buka-robots/remove` | 从登记表移除（目录、文件与会话保留） |
 * | `POST /buka-robots/agents` | 写入某机器人的 AGENTS.md，并补 CLAUDE.md 链接 |
 * | `POST /buka-robots/skills/available` | 执行 `npx skills add <source> --list` 列出可安装的 skills |
 * | `POST /buka-robots/skills/install` | 只安装选中的 skills，同时落 `.agents/skills` 与 `.claude/skills` |
 * | `POST /buka-robots/skills/remove` | 在机器人目录里执行 `npx skills remove <skill> -y` |
 * | `POST /buka-robots/reveal` | 用系统文件管理器（macOS 的 Finder）打开机器人目录 |
 *
 * 工作区的注册、删除与打开必须走 DSH 自己的 Client Service（侧边栏才会同步），
 * 所以都在浏览器一半，这里不重复实现。另注册一个只读工具 `buka_robots`，
 * 让模型能回答「有哪些机器人、挂没挂载、各自装了什么」；修改类操作只留给
 * 页面上的用户。
 *
 * 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
 * （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-robots
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { NPX_TIMEOUT_MS, createNpxRunner, parseSkillList } from './npx.js'
import { revealDirectory } from './reveal.js'
import {
  AGENTS_MAX_WRITE_BYTES,
  addRobot,
  defaultRobotsRoot,
  ensureClaudeLink,
  isValidRobotName,
  listRobots,
  readRobotRegistry,
  removeRobot,
  resolveRobotRegistryFile,
  resolveRobotsDir,
  scanProjectSkills,
  writeAgentsFile,
} from './robot-store.js'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'page-buka-robots'

/** 依赖的服务：这里用它判断机器人是否已经挂到 DSH 工作区。 */
export const inject = ['workspaceRegistry']

/** 页面列出机器人用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-robots/list'

/** 页面新建机器人用的路由。 */
const CREATE_ROUTE = '/buka-robots/create'

/** 页面删除机器人（只删登记）用的路由。 */
const REMOVE_ROUTE = '/buka-robots/remove'

/** 页面写入 AGENTS.md 用的路由。 */
const AGENTS_ROUTE = '/buka-robots/agents'

/** 页面列出来源里可安装的 skills 用的路由。 */
const AVAILABLE_ROUTE = '/buka-robots/skills/available'

/** 页面安装项目级 skill 用的路由。 */
const INSTALL_ROUTE = '/buka-robots/skills/install'

/** 页面移除项目级 skill 用的路由。 */
const SKILL_REMOVE_ROUTE = '/buka-robots/skills/remove'

/** 页面「打开 Finder」用的路由。 */
const REVEAL_ROUTE = '/buka-robots/reveal'

/** 请求体上限：页面发送的 JSON 都很小，超过这个大小按恶意请求处理。 */
const MAX_BODY_BYTES = 1024 * 1024

/** 机器人根目录的默认位置：`<插件全局目录>/robots`。 */
const DEFAULT_ROBOTS_DIR = defaultRobotsRoot()

/** `add --list` 的输出需要整段解析，给列清单的 runner 单独放宽上限。 */
const LIST_OUTPUT_BYTES = 256 * 1024

/** 一次安装最多勾选的 skill 数，避免把命令行撑爆。 */
const MAX_SKILL_SELECTION = 100

/** skill 名/引用的最大长度。 */
const MAX_SKILL_NAME_LENGTH = 200

/** skill 来源的最大长度，避免把整段脚本塞进命令行。 */
const MAX_SOURCE_LENGTH = 500

/** 控制字符（含 NUL 与 DEL）不允许出现在 skill 来源里。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u

/**
 * 规范化一个 skill 名/引用。
 *
 * skill 名允许空格与中文（`npx skills add --skill "Convex Best Practices"` 是
 * 官方支持的写法），所以不能沿用目录名那套严格正则；但它是会被放进命令行的
 * 参数，必须拒绝控制字符与开头的 `-`（否则会被当成选项）。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSkillName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > MAX_SKILL_NAME_LENGTH) return null
  if (name.startsWith('-') || CONTROL_CHARS.test(name)) return null
  return name
}

/**
 * 规范化一次安装勾选的 skills：去掉空项与重复项，数量有上限。
 *
 * @param {unknown} value
 * @returns {string[] | null} 不合法时返回 null
 */
function normalizeSkillSelection(value) {
  if (!Array.isArray(value)) return null
  const names = []
  const seen = new Set()
  for (const entry of value) {
    const name = normalizeSkillName(entry)
    if (name === null) return null
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (names.length === 0 || names.length > MAX_SKILL_SELECTION) return null
  return names
}

/**
 * 可在设置页配置的机器人根目录。
 *
 * 机器人目录建在这里；登记文件固定为该目录同级的 `robots.json`，插件只管理
 * 登记表里列出的机器人，不碰用户自己的 DSH 工作区。
 */
export const Config = z.object({
  robotsDir: z
    .string()
    .default(DEFAULT_ROBOTS_DIR)
    .description('机器人根目录：机器人目录建在插件全局目录下；登记文件固定为该目录同级的 robots.json，支持 ~ 前缀。'),
})

/**
 * 注册 HTTP 路由与只读工具。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 提供 `workspaceRegistry` 的插件上下文
 * @param {{ robotsDir?: string } | undefined} [config] 插件行配置
 */
export function apply(ctx, config) {
  const robotsDir = resolveRobotsDir(config?.robotsDir)
  const registryFile = resolveRobotRegistryFile(robotsDir)
  const runNpx = createNpxRunner({ timeoutMs: NPX_TIMEOUT_MS })
  // `add --list` 的输出要整段解析：默认 runner 只留末尾 4 KB 会把列表头截掉。
  const runNpxList = createNpxRunner({ timeoutMs: NPX_TIMEOUT_MS, maxOutputBytes: LIST_OUTPUT_BYTES })

  // npx skills 会整份重写工作区里的 skills-lock.json；同一工作区的安装与移除
  // 并发执行会互相覆盖条目。这里把 npx 调用排成一条全局队列，页面上的并发
  // 点击也安全（与 skills 插件的卸载队列同一做法）。
  let npxQueue = Promise.resolve()
  function serializeNpx(work) {
    const run = npxQueue.then(work, work)
    npxQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // 登记文件的读改写（create / remove）也要串行：连点「创建」时后一次写入
  // 不能基于旧快照把前一次刚插进去的条目覆盖掉。
  let registryQueue = Promise.resolve()
  function serializeRegistry(work) {
    const run = registryQueue.then(work, work)
    registryQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * 登记文件损坏时的统一错误：写操作必须拒绝，不能覆盖用户文件。
   *
   * @returns {{ status: number, code: string, message: string }}
   */
  function registryUnreadableError() {
    return {
      status: 409,
      code: 'registry-unreadable',
      message: `机器人登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`,
    }
  }

  /**
   * 按 name 从登记表里取机器人，并确认它的目录还在。
   *
   * @param {unknown} name
   * @returns {Promise<{ robot: { name: string, path: string, createdAt: string }, error?: undefined } | { robot?: undefined, error: { status: number, code: string, message: string } }>}
   */
  async function resolveRobot(name) {
    const registry = await readRobotRegistry({ file: registryFile })
    if (registry.corrupt) return { error: registryUnreadableError() }

    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!isValidRobotName(trimmed)) {
      return {
        error: { status: 400, code: 'invalid-name', message: `机器人名称不合法：${String(name)}` },
      }
    }
    const robot = registry.robots.find((entry) => entry.name === trimmed)
    if (robot === undefined) {
      return {
        error: { status: 404, code: 'unknown-robot', message: `没有找到这个机器人：${trimmed}` },
      }
    }

    let stat
    try {
      stat = await fs.stat(robot.path)
    } catch {
      stat = undefined
    }
    if (stat === undefined || !stat.isDirectory()) {
      return {
        error: {
          status: 409,
          code: 'missing-directory',
          message: `机器人目录不存在或不是目录：${robot.path}`,
        },
      }
    }
    return { robot }
  }

  // ---- HTTP 路由：浏览器一半的列表与配置 ---------------------------------

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

    /** 把 resolveRobot 的错误写成响应。 */
    function sendRobotError(res, error) {
      sendError(res, error.status, error.code, error.message)
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
              const snapshot = await listRobots({
                file: registryFile,
                workspaceRegistry: ctx.workspaceRegistry,
                robotsDir,
              })
              sendJson(res, 200, { ok: true, ...snapshot })
            } catch (error) {
              webCtx.logger?.warn?.('buka-robots: 读取机器人列表失败：%s', describeError(error))
              sendError(res, 500, 'list-failed', `读取机器人列表失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: GET ${LIST_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: CREATE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const name = typeof body?.name === 'string' ? body.name.trim() : ''
            if (!isValidRobotName(name)) {
              sendError(
                res,
                400,
                'invalid-name',
                '机器人名称不合法：需要 1–64 个字符，不能以点开头，只能包含字母、数字、汉字与 ._-。',
              )
              return
            }

            try {
              const result = await serializeRegistry(() =>
                addRobot({ robotsDir, file: registryFile, name }),
              )
              webCtx.logger?.info?.('buka-robots: 已登记机器人 %s（%s）', result.robot.name, result.robot.path)
              sendJson(res, 200, { ok: true, robot: result.robot, created: result.created })
            } catch (error) {
              if (error?.code === 'invalid-name') {
                sendError(res, 400, 'invalid-name', describeError(error))
                return
              }
              if (error?.code === 'registry-unreadable') {
                sendError(res, 409, 'registry-unreadable', describeError(error))
                return
              }
              webCtx.logger?.warn?.('buka-robots: 创建机器人失败：%s', describeError(error))
              sendError(res, 500, 'create-failed', `创建机器人失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${CREATE_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: REMOVE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const name = typeof body?.name === 'string' ? body.name.trim() : ''
            if (!isValidRobotName(name)) {
              sendError(res, 400, 'invalid-name', `机器人名称不合法：${String(body?.name)}`)
              return
            }

            try {
              const result = await serializeRegistry(() =>
                removeRobot({ file: registryFile, name }),
              )
              if (result.removed) webCtx.logger?.info?.('buka-robots: 已移除机器人登记 %s', name)
              sendJson(res, 200, { ok: true, name, removed: result.removed })
            } catch (error) {
              if (error?.code === 'registry-unreadable') {
                sendError(res, 409, 'registry-unreadable', describeError(error))
                return
              }
              webCtx.logger?.warn?.('buka-robots: 移除机器人失败：%s', describeError(error))
              sendError(res, 500, 'remove-failed', `移除机器人失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${REMOVE_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: AGENTS_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const resolved = await resolveRobot(body?.name)
            if (resolved.error !== undefined) {
              sendRobotError(res, resolved.error)
              return
            }
            if (typeof body?.content !== 'string') {
              sendError(res, 400, 'invalid-content', 'content 必须是字符串')
              return
            }
            if (Buffer.byteLength(body.content, 'utf8') > AGENTS_MAX_WRITE_BYTES) {
              sendError(
                res,
                413,
                'too-large',
                `AGENTS.md 内容超过 ${Math.round(AGENTS_MAX_WRITE_BYTES / 1024)} KiB，请用外部编辑器修改。`,
              )
              return
            }

            try {
              const saved = await writeAgentsFile(resolved.robot.path, body.content)
              // 每次保存后补一次 CLAUDE.md 链接：旧机器人第一次保存时自动修复。
              const claude = await ensureClaudeLink(resolved.robot.path)
              webCtx.logger?.info?.('buka-robots: 已保存 AGENTS.md（%s）', resolved.robot.path)
              sendJson(res, 200, { ok: true, ...saved, claude })
            } catch (error) {
              webCtx.logger?.warn?.('buka-robots: 写入 AGENTS.md 失败：%s', describeError(error))
              sendError(res, 500, 'write-failed', `写入 AGENTS.md 失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${AGENTS_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: AVAILABLE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const resolved = await resolveRobot(body?.name)
            if (resolved.error !== undefined) {
              sendRobotError(res, resolved.error)
              return
            }
            const source = typeof body?.source === 'string' ? body.source.trim() : ''
            if (source === '' || source.length > MAX_SOURCE_LENGTH || CONTROL_CHARS.test(source)) {
              sendError(
                res,
                400,
                'invalid-source',
                `skill 来源不合法：需要 1–${MAX_SOURCE_LENGTH} 个字符且不含控制字符。`,
              )
              return
            }

            try {
              // CLI 只提供给人看的文本清单（`--json` 不能与 `--list` 同用），
              // 这里解析出 skill 名与描述；安装时再用 `--skill <name>` 选择。
              const result = await serializeNpx(() =>
                runNpxList(['add', source, '--list'], resolved.robot.path),
              )
              if (!result.ok) {
                sendJson(res, 502, {
                  ok: false,
                  code: 'npx-failed',
                  message: result.message ?? 'npx skills add --list 失败',
                  output: result.output ?? '',
                })
                return
              }
              const candidates = parseSkillList(result.output)
              if (candidates.length === 0) {
                sendJson(res, 502, {
                  ok: false,
                  code: 'list-unparsed',
                  message: '无法从这个来源读出 skill 清单，请检查来源后重试。',
                  output: result.output ?? '',
                })
                return
              }
              const scanned = await scanProjectSkills(resolved.robot.path)
              webCtx.logger?.info?.(
                'buka-robots: 已读取 skill 清单（%s ← %s，%d 个）',
                resolved.robot.path,
                source,
                candidates.length,
              )
              sendJson(res, 200, {
                ok: true,
                source,
                skills: candidates,
                installed: scanned.skills.map((skill) => skill.name),
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-robots: 读取 skill 清单失败：%s', describeError(error))
              sendError(res, 500, 'available-failed', `读取 skill 清单失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${AVAILABLE_ROUTE}`,
    )

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

            const resolved = await resolveRobot(body?.name)
            if (resolved.error !== undefined) {
              sendRobotError(res, resolved.error)
              return
            }
            const source = typeof body?.source === 'string' ? body.source.trim() : ''
            if (source === '' || source.length > MAX_SOURCE_LENGTH || CONTROL_CHARS.test(source)) {
              sendError(
                res,
                400,
                'invalid-source',
                `skill 来源不合法：需要 1–${MAX_SOURCE_LENGTH} 个字符且不含控制字符。`,
              )
              return
            }
            const selected = normalizeSkillSelection(body?.skills)
            if (selected === null) {
              sendError(
                res,
                400,
                'invalid-skills',
                `skills 必须是 1–${MAX_SKILL_SELECTION} 个合法的 skill 名。`,
              )
              return
            }

            try {
              // `-a universal` 落 `.agents/skills`，`-a claude-code` 再给 Claude Code
              // 建 `.claude/skills/<name>` 链接：一次调用同时满足两种约定。不用
              // `--all`：它还会按机器上装了哪些 agent 建额外目录。
              const args = ['add', source]
              for (const skill of selected) args.push('--skill', skill)
              args.push('-a', 'universal', '-a', 'claude-code', '-y')

              const result = await serializeNpx(() => runNpx(args, resolved.robot.path))
              if (!result.ok) {
                sendJson(res, 502, {
                  ok: false,
                  code: 'npx-failed',
                  message: result.message ?? 'npx skills add 失败',
                  output: result.output ?? '',
                })
                return
              }
              const scanned = await scanProjectSkills(resolved.robot.path)
              const claude = await ensureClaudeLink(resolved.robot.path)
              webCtx.logger?.info?.(
                'buka-robots: 已安装 %d 个 skill（%s ← %s）',
                selected.length,
                resolved.robot.path,
                source,
              )
              sendJson(res, 200, {
                ok: true,
                output: result.output ?? '',
                skills: scanned.skills,
                claude,
              })
            } catch (error) {
              webCtx.logger?.warn?.('buka-robots: 安装 skill 失败：%s', describeError(error))
              sendError(res, 500, 'install-failed', `安装 skill 失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${INSTALL_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: SKILL_REMOVE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const resolved = await resolveRobot(body?.name)
            if (resolved.error !== undefined) {
              sendRobotError(res, resolved.error)
              return
            }
            const skillName = normalizeSkillName(body?.skill)
            if (skillName === null) {
              sendError(res, 400, 'invalid-skill', `skill 名称不合法：${String(body?.skill)}`)
              return
            }

            try {
              const result = await serializeNpx(() =>
                runNpx(['remove', skillName, '-y'], resolved.robot.path),
              )
              if (!result.ok) {
                sendJson(res, 502, {
                  ok: false,
                  code: 'npx-failed',
                  message: result.message ?? 'npx skills remove 失败',
                  output: result.output ?? '',
                })
                return
              }
              const scanned = await scanProjectSkills(resolved.robot.path)
              webCtx.logger?.info?.(
                'buka-robots: 已移除 skill（%s ← %s）',
                resolved.robot.path,
                skillName,
              )
              sendJson(res, 200, { ok: true, output: result.output ?? '', skills: scanned.skills })
            } catch (error) {
              webCtx.logger?.warn?.('buka-robots: 移除 skill 失败：%s', describeError(error))
              sendError(res, 500, 'remove-failed', `移除 skill 失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${SKILL_REMOVE_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: REVEAL_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const resolved = await resolveRobot(body?.name)
            if (resolved.error !== undefined) {
              sendRobotError(res, resolved.error)
              return
            }

            try {
              await revealDirectory(resolved.robot.path)
              webCtx.logger?.info?.('buka-robots: 已打开机器人目录（%s）', resolved.robot.path)
              sendJson(res, 200, { ok: true, path: resolved.robot.path })
            } catch (error) {
              webCtx.logger?.warn?.('buka-robots: 打开机器人目录失败：%s', describeError(error))
              sendError(res, 500, 'reveal-failed', `打开机器人目录失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${REVEAL_ROUTE}`,
    )
  })

  // ---- 模型工具：只读列举登记表里的机器人 ---------------------------------

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(
      defineTool({
        name: 'buka_robots',
        description:
          'List the robots created by the Buka Robots page in the DSH sidebar. A robot is a directory the plugin created under its own cache directory (default ~/.cache/dsh-plugin-robots/robots) and registered in robots.json, then mounted as a DSH workspace. This is NOT the list of all DSH workspaces: only robots registered by the plugin appear, and each one reports whether it is currently mounted. Use it when the user asks which robots exist, which are mounted, what project-level skills a robot has, or whether it has an AGENTS.md. Creating or removing robots, mounting them, installing skills, and editing AGENTS.md are user actions on the Robots page.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              root: { type: 'string', required: true, description: 'Robots root directory.' },
              registry: {
                type: 'string',
                required: true,
                description: 'Absolute path of the plugin robots.json registry.',
              },
              corrupt: {
                type: 'boolean',
                required: true,
                description: 'Whether the registry file is unreadable; robots is then empty.',
              },
              robots: {
                type: 'array',
                required: true,
                description: 'Robots in registry order (newest first).',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true, description: 'Robot name.' },
                    path: { type: 'string', required: true, description: 'Absolute robot directory.' },
                    mounted: {
                      type: 'boolean',
                      required: true,
                      description: 'Whether a DSH workspace is mounted at this robot directory.',
                    },
                    workspaceId: {
                      required: true,
                      description: 'Mounted DSH workspace id, or null when not mounted.',
                      oneOf: [{ type: 'string' }, { type: 'null' }],
                    },
                    skills: {
                      type: 'array',
                      required: true,
                      description: 'Project-level skills installed in the robot directory.',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          name: { type: 'string', required: true, description: 'Skill name.' },
                        },
                      },
                    },
                    agentsFile: {
                      type: 'boolean',
                      required: true,
                      description: 'Whether the robot directory has an AGENTS.md.',
                    },
                  },
                },
              },
            },
          },
          render: (_args, value) => {
            if (value?.corrupt === true) {
              return [
                {
                  type: 'text',
                  text: `The robot registry is unreadable: ${String(value?.registry ?? '')}. Renew or remove that file, then refresh.`,
                },
              ]
            }
            const robots = Array.isArray(value?.robots) ? value.robots : []
            if (robots.length === 0) {
              return [{ type: 'text', text: 'No robots have been created yet.' }]
            }
            return [
              {
                type: 'text',
                text: robots
                  .map((robot) => {
                    const count = Array.isArray(robot.skills) ? robot.skills.length : 0
                    const skills = count === 1 ? '1 skill' : `${count} skills`
                    const agents = robot.agentsFile ? 'AGENTS.md' : 'no AGENTS.md'
                    const mounted = robot.mounted
                      ? `mounted as ${String(robot.workspaceId)}`
                      : 'not mounted'
                    return `- ${robot.name} (${robot.path}) · ${skills} · ${agents} · ${mounted}`
                  })
                  .join('\n'),
              },
            ]
          },
        },
        async execute() {
          const snapshot = await listRobots({
            file: registryFile,
            workspaceRegistry: ctx.workspaceRegistry,
            robotsDir,
          })
          return {
            root: snapshot.root,
            registry: snapshot.registry,
            corrupt: snapshot.corrupt,
            robots: snapshot.robots.map((robot) => ({
              name: robot.name,
              path: robot.path,
              mounted: robot.mounted,
              workspaceId: robot.workspaceId,
              skills: robot.skills.map((skill) => ({ name: skill.name })),
              agentsFile: robot.agents.exists,
            })),
          }
        },
      }),
    )
  })
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
    sendError(res, 415, 'invalid-content-type', 'content-type 必须是 application/json')
    return undefined
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendError(res, 413, 'too-large', '请求体过大')
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    sendError(res, 400, 'invalid-json', '请求体不是合法 JSON')
    return undefined
  }
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

/**
 * 发送 JSON 响应；数据是实时事实，不缓存。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * 统一的失败响应：`{ ok: false, code, message }`。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, code, message })
}

/**
 * 405 并带上唯一支持的方法。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} allow
 */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ ok: false, code: 'method-not-allowed', message: `只支持 ${allow}` }))
}
