/**
 * 侧边栏「机器人」页面的 Host 一半。
 *
 * v2 里机器人是**插件自己创建并登记**的对象，不是 DSH 的全部工作区：新建
 * 机器人时在插件全局目录下的 `robots/` 里建同名目录并写进 `robots.json`，
 * 再由浏览器一半把它挂到 DSH 工作区列表。Host 负责所有磁盘操作，提供一组
 * 包内 HTTP 路由给页面，除工作区 / 设置外都按机器人 **name** 操作：
 *
 * | 路由 | 作用 |
 * | --- | --- |
 * | `GET /buka-robots/list` | 列出登记表里的机器人、挂载状态、skills 与 AGENTS.md |
 * | `POST /buka-robots/create` | 建目录 + AGENTS.md 模板，并把机器人（含可选描述）插到登记表最前 |
 * | `POST /buka-robots/avatar` | 只改登记表里的头像 id |
 * | `POST /buka-robots/description` | 只改登记表里的一行描述（工作流用它选机器人） |
 * | `POST /buka-robots/rename` | 改机器人目录名 + 更新登记表 + 按新路径重建 DSH 工作区 |
 * | `POST /buka-robots/remove` | 从登记表移除（目录、文件与会话保留） |
 * | `POST /buka-robots/agents` | 写入某机器人的 AGENTS.md，并补 CLAUDE.md 链接 |
 * | `POST /buka-robots/skills/available` | 执行 `npx skills add <source> --list` 列出可安装的 skills |
 * | `POST /buka-robots/skills/install` | 只安装选中的 skills，同时落 `.agents/skills` 与 `.claude/skills` |
 * | `POST /buka-robots/skills/remove` | 在机器人目录里执行 `npx skills remove <skill> -y` |
 * | `POST /buka-robots/reveal` | 用系统文件管理器（macOS 的 Finder）打开机器人目录 |
 *
 * 工作区的注册、删除与打开必须走 DSH 自己的 Client Service（侧边栏才会同步），
 * 所以都在浏览器一半，这里不重复实现。另注册两个模型工具：只读的 `buka_robots`
 * 让模型回答「有哪些机器人、挂没挂载、是否写了 AGENTS.md、装了什么技能」
 * （见 `lib/list-tool.js`；工作流编排 preset 固定看不到技能清单）；写工具
 * `buka_robot_build`（见 `lib/builder.js`、`lib/build-tool.js`）负责创建 /
 * 修改 / 重命名机器人、写 AGENTS.md 并挂到工作区，但**只对随包发布的
 * 「机器人构建」preset 的根会话可见**（Config.builderPresets，判定见
 * `lib/access.js`）。删除机器人、安装 skills、页面上的编辑仍然只留给用户。
 *
 * 另通过 `ctx.provide('bukaRobots', ...)` 对外提供一个 Host Service（见
 * `lib/service.js`）：`list()` 列出机器人，`avatarMap()` 给出机器人头像，
 * `startSession()` 在机器人目录下开一个会话（或按 sessionId 续接已有会话）并返回结果。工作流插件用它
 * 把每个节点交给一个机器人、并在节点图上画出机器人头像；
 * 注册在这里而不是拆成第二个插件，是因为本包入口需要同时保留页面路由与工具。
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

import { normalizePresets, resolveRobotBuildAccess, resolveRobotSkillsVisibility } from './access.js'
import { AVATAR_IDS } from './avatar.js'
import { buildRobot } from './builder.js'
import { createRobotBuildTool } from './build-tool.js'
import { createRobotsListTool } from './list-tool.js'
import { NPX_TIMEOUT_MS, createNpxRunner, parseSkillList } from './npx.js'
import { seedPresetRobots } from './presets.js'
import { revealDirectory } from './reveal.js'
import {
  AGENTS_MAX_WRITE_BYTES,
  addRobot,
  defaultRobotsRoot,
  ensureClaudeLink,
  isValidRobotName,
  listRobots,
  readAgentsFile,
  readRobotRegistry,
  removeRobot,
  ROBOT_DESCRIPTION_MAX_LENGTH,
  setRobotAvatar,
  setRobotDescription,
  resolveRobotRegistryFile,
  resolveRobotsDir,
  scanProjectSkills,
  writeAgentsFile,
} from './robot-store.js'
import { RobotSessionService, SERVICE_NAME } from './service.js'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'page-buka-robots'

/** 依赖的服务：这里用它判断机器人是否已经挂到 DSH 工作区。 */
export const inject = ['workspaceRegistry']

/** 页面列出机器人用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = '/buka-robots/list'

/** 页面新建机器人用的路由。 */
const CREATE_ROUTE = '/buka-robots/create'

/** 页面给机器人换头像用的路由。 */
const AVATAR_ROUTE = '/buka-robots/avatar'

/** 页面编辑机器人描述用的路由。 */
const DESCRIPTION_ROUTE = '/buka-robots/description'

/** 页面重命名机器人（改目录 + 重建工作区）用的路由。 */
const RENAME_ROUTE = '/buka-robots/rename'

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

/**
 * 随本插件发布的「机器人构建」preset；`buka_robot_build` 默认只对这个
 * preset 的根会话可见（见 Config.builderPresets）。
 */
const DEFAULT_BUILDER_PRESETS = ['robot-builder']

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
  resultRetries: z
    .number()
    .step(1)
    .min(0)
    .max(5)
    .default(2)
    .description(
      '所有机器人节点都必须交回一个 JSON 结果（工作流节点用 outputSchema 约束其结构）；没有交回时，在原会话里要求它按格式重新回复的次数上限；0 表示不重试。',
    ),
  builderPresets: z
    .array(z.string())
    .default(DEFAULT_BUILDER_PRESETS)
    .description(
      '能看到并调用 buka_robot_build（创建 / 修改机器人）的 agent preset 名单。留空表示不按 preset 收窄（所有会话可见，不推荐）；推荐只保留随插件发布的 `robot-builder`。',
    ),
  seedPresets: z
    .boolean()
    .default(true)
    .description(
      '全新安装（登记表为空）时是否自动补上「软件工程师」与「质量保障工程师」两个预设机器人；设为 false 则不初始化预设。',
    ),
})

/**
 * 注册 HTTP 路由、只读工具与「机器人构建」preset 的写工具。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 提供 `workspaceRegistry` 的插件上下文
 * @param {{ robotsDir?: string, resultRetries?: number, builderPresets?: string[], seedPresets?: boolean } | undefined} [config] 插件行配置
 */
export function apply(ctx, config) {
  const robotsDir = resolveRobotsDir(config?.robotsDir)
  const registryFile = resolveRobotRegistryFile(robotsDir)
  const runNpx = createNpxRunner({ timeoutMs: NPX_TIMEOUT_MS })
  // `add --list` 的输出要整段解析：默认 runner 只留末尾 4 KB 会把列表头截掉。
  const runNpxList = createNpxRunner({ timeoutMs: NPX_TIMEOUT_MS, maxOutputBytes: LIST_OUTPUT_BYTES })

  // 对外服务：工作流插件通过 ctx.bukaRobots 列出机器人、开启机器人会话。
  ctx.provide(
    SERVICE_NAME,
    new RobotSessionService({
      ctx,
      robotsDir,
      registryFile,
      defineTool,
      resultRetries: config?.resultRetries,
    }),
  )

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

  // 全新安装（登记表为空）时补上两个预设机器人；串行进队列，避免与页面上的
  // 首次新建抢写。异步完成、不阻塞启动，失败只记日志。`seedPresets: false` 时跳过。
  if (config?.seedPresets !== false) {
    void serializeRegistry(() =>
      seedPresetRobots({ robotsDir, file: registryFile, workspaceRegistry: ctx.workspaceRegistry }).then(
        (result) => {
          if (result.seeded.length > 0) {
            ctx.logger?.info?.('buka-robots: 已初始化预设机器人：%s', result.seeded.join('、'))
          }
        },
      ),
    ).catch((error) => {
      ctx.logger?.warn?.('buka-robots: 初始化预设机器人失败：%s', describeError(error))
    })
  }

  // ---- 机器人构建 preset 的可见性 ---------------------------------------

  /** 能看到 / 调用 `buka_robot_build` 的 preset 名单（Config 可覆盖）。 */
  const builderPresets = normalizePresets(config?.builderPresets ?? DEFAULT_BUILDER_PRESETS)

  /**
   * 判定某个 agent 能否看到 / 调用机器人构建工具。
   *
   * 走 `sessions` + `agentPresets` 两个服务，与工作流插件同一做法；区别是
   * 写操作在服务缺失时收紧为不可见（见 `lib/access.js`）。
   *
   * @param {{ id?: string } | null | undefined} agent
   * @returns {{ visible: boolean, preset: string | null, reason: string }}
   */
  function builderAccessOf(agent) {
    return resolveRobotBuildAccess({
      allowed: builderPresets,
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: ctx.get('sessions'),
      agentPresets: ctx.get('agentPresets'),
    })
  }

  /** 工具在每一步的可见性条件。 */
  const builderVisibleWhen = (context) => builderAccessOf(context?.agent).visible

  /**
   * 判定某个 agent 能否看到 `buka_robots` 输出的机器人技能清单。
   *
   * 工作流编排 preset 固定看不到：编排者只按一句职责选人，不按技能清单。
   *
   * @param {{ id?: string } | null | undefined} agent
   * @returns {boolean}
   */
  function skillsVisibleFor(agent) {
    return resolveRobotSkillsVisibility({
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: ctx.get('sessions'),
      agentPresets: ctx.get('agentPresets'),
    }).visible
  }

  /**
   * 调用时兜底再校验一次：即便绕过 `when` 直接调用也要被挡住。
   *
   * @param {{ id?: string } | null | undefined} agent
   * @returns {{ visible: boolean, preset: string | null, reason: string }}
   */
  function assertRobotBuilder(agent) {
    const access = builderAccessOf(agent)
    if (access.visible) return access
    throw new Error(
      `buka_robot_build is only available to the ${builderPresets.join(' / ')} preset (reason: ${access.reason})`,
    )
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
            // 头像可选：不传 / 传了非法 id 时由 addRobot 按名字分配默认头像。
            const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''
            if (body?.description !== undefined && typeof body.description !== 'string') {
              sendError(res, 400, 'invalid-description', 'description 必须是字符串')
              return
            }
            const description = typeof body?.description === 'string' ? body.description : ''

            try {
              const result = await serializeRegistry(() =>
                addRobot({ robotsDir, file: registryFile, name, avatar, description }),
              )
              webCtx.logger?.info?.('buka-robots: 已登记机器人 %s（%s）', result.robot.name, result.robot.path)
              sendJson(res, 200, { ok: true, robot: result.robot, created: result.created })
            } catch (error) {
              if (error?.code === 'invalid-name') {
                sendError(res, 400, 'invalid-name', describeError(error))
                return
              }
              if (error?.code === 'invalid-description') {
                sendError(
                  res,
                  400,
                  'invalid-description',
                  `描述需要不超过 ${ROBOT_DESCRIPTION_MAX_LENGTH} 个字符的单行文本。`,
                )
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
          path: AVATAR_ROUTE,
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
            const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''

            try {
              const result = await serializeRegistry(() =>
                setRobotAvatar({ file: registryFile, name, avatar }),
              )
              webCtx.logger?.info?.('buka-robots: 机器人 %s 的头像改为 %s', name, avatar)
              sendJson(res, 200, { ok: true, robot: result.robot })
            } catch (error) {
              if (error?.code === 'invalid-avatar') {
                sendError(res, 400, 'invalid-avatar', describeError(error))
                return
              }
              if (error?.code === 'invalid-name') {
                sendError(res, 400, 'invalid-name', describeError(error))
                return
              }
              if (error?.code === 'unknown-robot') {
                sendError(res, 404, 'unknown-robot', describeError(error))
                return
              }
              if (error?.code === 'registry-unreadable') {
                sendError(res, 409, 'registry-unreadable', describeError(error))
                return
              }
              webCtx.logger?.warn?.('buka-robots: 修改机器人头像失败：%s', describeError(error))
              sendError(res, 500, 'avatar-failed', `修改机器人头像失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${AVATAR_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: DESCRIPTION_ROUTE,
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
            if (typeof body?.description !== 'string') {
              sendError(res, 400, 'invalid-description', 'description 必须是字符串')
              return
            }

            try {
              const result = await serializeRegistry(() =>
                setRobotDescription({ file: registryFile, name, description: body.description }),
              )
              webCtx.logger?.info?.('buka-robots: 已更新机器人 %s 的描述', name)
              sendJson(res, 200, { ok: true, robot: result.robot })
            } catch (error) {
              if (error?.code === 'invalid-description') {
                sendError(
                  res,
                  400,
                  'invalid-description',
                  `描述需要不超过 ${ROBOT_DESCRIPTION_MAX_LENGTH} 个字符的单行文本。`,
                )
                return
              }
              if (error?.code === 'invalid-name') {
                sendError(res, 400, 'invalid-name', describeError(error))
                return
              }
              if (error?.code === 'unknown-robot') {
                sendError(res, 404, 'unknown-robot', describeError(error))
                return
              }
              if (error?.code === 'registry-unreadable') {
                sendError(res, 409, 'registry-unreadable', describeError(error))
                return
              }
              webCtx.logger?.warn?.('buka-robots: 更新机器人描述失败：%s', describeError(error))
              sendError(res, 500, 'description-failed', `更新机器人描述失败：${describeError(error)}`)
            }
          },
        }),
      `buka-robots: POST ${DESCRIPTION_ROUTE}`,
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: RENAME_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              sendMethodNotAllowed(res, 'POST')
              return
            }
            const body = await readJsonBody(req, res)
            if (body === undefined) return

            const name = typeof body?.name === 'string' ? body.name.trim() : ''
            const newName = typeof body?.newName === 'string' ? body.newName.trim() : ''
            if (!isValidRobotName(name)) {
              sendError(res, 400, 'invalid-name', `机器人名称不合法：${String(body?.name)}`)
              return
            }
            if (!isValidRobotName(newName)) {
              sendError(res, 400, 'invalid-name', `新机器人名称不合法：${String(body?.newName)}`)
              return
            }
            if (name === newName) {
              sendError(res, 400, 'invalid-name', '新名称与当前名称相同')
              return
            }

            try {
              // 与构建工具走同一条 buildRobot 路径：目录改名、登记表更新、
              // 工作区重建（旧会话保留但不再挂在该机器人下）语义完全一致。
              const result = await serializeRegistry(() =>
                buildRobot({
                  robotsDir,
                  file: registryFile,
                  name,
                  newName,
                  update: true,
                  workspaceRegistry: ctx.workspaceRegistry,
                }),
              )
              webCtx.logger?.info?.(
                'buka-robots: 机器人 %s 已重命名为 %s（%s）',
                name,
                result.robot.name,
                result.robot.path,
              )
              // 带上改名后的 AGENTS.md 摘要：Host 会把未改过的模板同步成新名 /
              // 新路径，页面据此重设草稿，避免「保存」把旧模板写回去。
              const agents = await readAgentsFile(result.robot.path)
              sendJson(res, 200, {
                ok: true,
                previousName: result.previousName,
                renamed: result.renamed,
                robot: result.robot,
                agents,
                mounted: result.mounted,
                workspaceId: typeof result.workspaceId === 'string' ? result.workspaceId : null,
                mountError: result.mountError,
              })
            } catch (error) {
              switch (error?.code) {
                case 'invalid-name':
                  sendError(res, 400, 'invalid-name', describeError(error))
                  return
                case 'invalid-update':
                  sendError(res, 400, 'invalid-update', describeError(error))
                  return
                case 'unknown-robot':
                  sendError(res, 404, 'unknown-robot', describeError(error))
                  return
                case 'name-taken':
                  sendError(res, 409, 'name-taken', describeError(error))
                  return
                case 'missing-directory':
                  sendError(res, 409, 'missing-directory', describeError(error))
                  return
                case 'path-outside-root':
                  sendError(res, 409, 'path-outside-root', describeError(error))
                  return
                case 'registry-unreadable':
                  sendError(res, 409, 'registry-unreadable', describeError(error))
                  return
                default:
                  webCtx.logger?.warn?.('buka-robots: 重命名机器人失败：%s', describeError(error))
                  sendError(res, 500, 'rename-failed', `重命名机器人失败：${describeError(error)}`)
              }
            }
          },
        }),
      `buka-robots: POST ${RENAME_ROUTE}`,
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

  // ---- 模型工具：只读列举 + 「机器人构建」preset 的写工具 -------------------

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(
      createRobotsListTool({
        defineTool,
        listRobots,
        registryFile,
        robotsDir,
        workspaceRegistry: ctx.workspaceRegistry,
        isSkillsVisible: skillsVisibleFor,
      }),
    )

    // ---- 「机器人构建」preset 的写工具 -----------------------------------
    //
    // 只对 Config.builderPresets 点名的 preset 根会话可见；页面上的新建 /
    // 配置流程不受影响，两条路径写的是同一份登记表与目录。
    const buildTool = createRobotBuildTool({
      defineTool,
      avatarIds: AVATAR_IDS,
      assertAccess: assertRobotBuilder,
      runBuild: async (args) => {
        const result = await serializeRegistry(() =>
          buildRobot({
            robotsDir,
            file: registryFile,
            name: args?.name,
            avatar: args?.avatar,
            description: args?.description,
            agents: args?.agents,
            update: args?.update,
            newName: args?.newName,
            workspaceRegistry: ctx.workspaceRegistry,
          }),
        )
        ctx.logger?.info?.(
          'buka-robots: %s 机器人 %s（%s）',
          result.created ? '已创建' : result.renamed ? `已重命名（原 ${result.previousName}）` : '已更新',
          result.robot.name,
          result.robot.path,
        )
        return result
      },
    })
    toolCtx.tools.register(buildTool, { when: builderVisibleWhen })
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
