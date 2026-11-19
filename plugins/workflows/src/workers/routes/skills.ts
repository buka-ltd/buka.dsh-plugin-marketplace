/**
 * 「执行者」页面的项目级 skills 路由。
 *
 * 页面只从 Skills 插件的「技能仓库」里选来源：先读收藏列表，再把某个收藏仓库
 * 的 skill 清单列出来。安装与移除仍在执行者目录里用 `npx skills` 执行，安装时
 * 同时落 `.agents/skills` 与 `.claude/skills`；命令输出只用于给人看，失败时把
 * 输出原样带回页面。浏览器不能再提交任意第三方来源：来源必须已收藏。
 *
 * @module @buka/dsh-plugin-workflows/workers/routes/skills
 */

import type { ServerResponse } from 'node:http'
import { createNpxRunner } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'
import type { SerialQueueService } from '../serial-runner.ts'
import { preferSharedQueue } from '../serial-runner.ts'
import { updateWorkersSequentially } from '../skill-update-batch.ts'
import { reportSkillUpdate } from '../skill-update-report.ts'
import { ensureClaudeLink, listWorkers, scanProjectSkills } from '../worker-store.ts'
import {
  describeError,
  readJsonBody,
  rejected,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from './http.ts'
import { resolveWorker } from './target.ts'

/** 页面列出「技能仓库」收藏来源用的路由。 */
const SKILL_REPOS_ROUTE = '/buka-workers/skills/repos'

/** 页面列出一个收藏仓库里可安装的 skills 用的路由。 */
const AVAILABLE_ROUTE = '/buka-workers/skills/available'

/** 页面安装项目级 skill 用的路由。 */
const INSTALL_ROUTE = '/buka-workers/skills/install'

/** 页面移除项目级 skill 用的路由。 */
const SKILL_REMOVE_ROUTE = '/buka-workers/skills/remove'

/** 单个执行者的 skill 更新入口（可选 `skills` 只更新其中几项）。 */
const SKILL_UPDATE_ROUTE = '/buka-workers/skills/update'

/** 单个执行者的 skill 检查入口：页面进入「技能」页签时自动调用。 */
const SKILL_CHECK_ROUTE = '/buka-workers/skills/check'

/** 列表页「更新全部执行者」。 */
const SKILL_UPDATE_ALL_ROUTE = '/buka-workers/skills/update-all'

/** 项目级安装 / 移除的最长等待时间；比全局版 npx runner 默认的 120 s 更宽。 */
const NPX_TIMEOUT_MS = 180_000

/**
 * 失败信息里指代这条命令的名称：`npx skills add` / `npx skills remove`。
 *
 * @param args 本次调用的子命令参数
 * @returns 带子命令名的命令名
 */
function npxLabel(args: string[]): string {
  const command = typeof args[0] === 'string' && args[0] !== '' ? args[0] : '命令'
  return `npx skills ${command}`
}

/** 找不到 npx 时的失败文案：项目级安装与移除共用。 */
const NPX_MISSING_MESSAGE = '没有找到 npx。请先安装 Node.js（含 npm），再重试安装或移除 skill。'

/** 一次安装最多勾选的 skill 数，避免把命令行撑爆。 */
const MAX_SKILL_SELECTION = 100

/** skill 名/引用的最大长度。 */
const MAX_SKILL_NAME_LENGTH = 200

/** skill 来源的最大长度，避免把整段脚本塞进命令行。 */
const MAX_SOURCE_LENGTH = 500

/** 控制字符（含 NUL 与 DEL）不允许出现在 skill 来源里。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 这里要拒绝的正是控制字符本身
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u

/**
 * 规范化一个 skill 名/引用。
 *
 * skill 名允许空格与中文（`npx skills add --skill "Convex Best Practices"` 是
 * 官方支持的写法），所以不能沿用目录名那套严格正则；但它是会被放进命令行的
 * 参数，必须拒绝控制字符与开头的 `-`（否则会被当成选项）。
 *
 */
function normalizeSkillName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > MAX_SKILL_NAME_LENGTH) return null
  if (name.startsWith('-') || CONTROL_CHARS.test(name)) return null
  return name
}

/**
 * 规范化一次安装勾选的 skills：去掉空项与重复项，数量有上限。
 *
 */
function normalizeSkillSelection(value: unknown): string[] | null {
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

/** skills 路由的依赖：执行者根目录与登记文件由入口传入。 */
export interface SkillRouteDeps {
  workersDir: string
  registryFile: string
}

/** Skills 插件服务返回的一条收藏仓库；只声明本路由用到的字段。 */
interface SavedRepositoryView {
  id?: unknown
  source?: unknown
  note?: unknown
  kind?: unknown
  skills?: unknown
}

/** 规范化后的收藏仓库：页面用它渲染仓库列表，Host 用它校验来源。 */
interface SavedRepository {
  id: string
  source: string
  note: string
  kind: string
  skills: number | null
}

/** 收藏仓库列表：`corrupt` 表示收藏文件无法解析。 */
interface SavedRepositoryList {
  corrupt: boolean
  repositories: SavedRepository[]
}

/** Skills 插件的 Host Service 里本路由用到的部分。 */
interface SkillsHostService extends SerialQueueService {
  listRepositories?(): Promise<{
    corrupt?: boolean
    repositories?: ReadonlyArray<SavedRepositoryView>
  }>
  listSkills?(options: { source: string }): Promise<{
    ok?: boolean
    code?: unknown
    message?: unknown
    skills?: ReadonlyArray<{ name?: unknown; description?: unknown }>
  }>
  updateSkills?(options: { dir: string; skills?: readonly string[] }): Promise<unknown>
  checkSkills?(options: { dir: string }): Promise<unknown>
}

/** 从 web 上下文取可选的 `bukaSkills` 服务；插件没装时返回 null。 */
function skillsService(ctx: Context): SkillsHostService | null {
  try {
    return (ctx.get?.('bukaSkills') ?? null) as SkillsHostService | null
  } catch {
    return null
  }
}

/**
 * 读收藏的「技能仓库」；服务插件比这个版本旧、没有 `listRepositories()` 时
 * 按「没有收藏」处理，而不是把整个列表报成失败。
 *
 * @param service Skills 插件的 Host Service
 * @returns 规范化后的收藏仓库与收藏文件状态
 */
async function readSavedRepositories(service: SkillsHostService): Promise<SavedRepositoryList> {
  const listed =
    typeof service.listRepositories === 'function' ? await service.listRepositories() : null
  const repositories: SavedRepository[] = []
  for (const repo of Array.isArray(listed?.repositories) ? listed.repositories : []) {
    if (repo === null || typeof repo !== 'object') continue
    if (typeof repo.source !== 'string' || repo.source === '') continue
    repositories.push({
      id: typeof repo.id === 'string' && repo.id !== '' ? repo.id : repo.source,
      source: repo.source,
      note: typeof repo.note === 'string' ? repo.note : '',
      kind: typeof repo.kind === 'string' && repo.kind !== '' ? repo.kind : 'unknown',
      skills: typeof repo.skills === 'number' && Number.isFinite(repo.skills) ? repo.skills : null,
    })
  }
  return { corrupt: listed?.corrupt === true, repositories }
}

/**
 * 在收藏列表里按来源找一条；页面总是回传收藏条目的 `source`，所以精确匹配即可。
 *
 * @param saved 收藏仓库列表
 * @param source 页面回传的来源
 */
function findSavedRepository(saved: SavedRepositoryList, source: string): SavedRepository | null {
  return saved.repositories.find((repo) => repo.source === source) ?? null
}

/**
 * 把一个仓库的 skill 清单规范化成页面的候选条目。
 *
 * @param service Skills 插件的 Host Service
 * @param source 已确认收藏的来源
 */
async function listRepositorySkills(
  service: SkillsHostService,
  source: string,
): Promise<
  | { ok: true; skills: Array<{ name: string; description: string }> }
  | { ok: false; code: string; message: string }
> {
  if (typeof service.listSkills !== 'function') {
    return {
      ok: false,
      code: 'skills-unavailable',
      message: '这个 Skills 插件版本不支持读取技能仓库。',
    }
  }
  const listed = await service.listSkills({ source })
  if (listed?.ok !== true) {
    return {
      ok: false,
      code: typeof listed?.code === 'string' ? listed.code : 'fetch-failed',
      message:
        typeof listed?.message === 'string' && listed.message !== ''
          ? listed.message
          : '无法读取这个技能仓库的 skill 列表。',
    }
  }
  const skills: Array<{ name: string; description: string }> = []
  for (const skill of Array.isArray(listed.skills) ? listed.skills : []) {
    if (skill === null || typeof skill !== 'object') continue
    if (typeof skill.name !== 'string' || skill.name === '') continue
    skills.push({
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : '',
    })
  }
  return { ok: true, skills }
}

/**
 * 取检查 / 更新所需的服务；插件没装或版本太旧时写好 503 并返回 null。
 *
 * @param ctx web 上下文
 * @param res 响应
 * @param action 失败文案里的动作描述
 * @param capability 需要的服务方法
 */
function requireSkillsService<
  K extends 'updateSkills' | 'checkSkills' | 'listRepositories' | 'listSkills',
>(
  ctx: Context,
  res: ServerResponse,
  action: string,
  capability: K,
): (SkillsHostService & Record<K, NonNullable<SkillsHostService[K]>>) | null {
  const service = skillsService(ctx)
  if (service !== null && typeof service[capability] === 'function') {
    return service as SkillsHostService & Record<K, NonNullable<SkillsHostService[K]>>
  }
  sendError(
    res,
    503,
    'skills-unavailable',
    `没有找到 Skills 插件（@buka/dsh-plugin-skills），无法${action} skills。`,
  )
  return null
}

/**
 * 注册项目级 skills 相关的精确路由。
 *
 */
export function registerSkillRoutes(webCtx: Context, deps: SkillRouteDeps): void {
  const { registryFile } = deps

  // 项目级安装与移除：cwd 每次按执行者目录传，超时 180 s，失败文案带子命令名。
  const runNpx = createNpxRunner({
    timeoutMs: NPX_TIMEOUT_MS,
    label: npxLabel,
    missingMessage: NPX_MISSING_MESSAGE,
    emptyOutputOnSetupFailure: true,
  })

  // npx skills 会整份重写工作区里的 skills-lock.json；同一工作区的安装与移除
  // 并发执行会互相覆盖条目。优先借用 Skills 服务的共用队列（与它的安装 /
  // 卸载 / 检查 / 更新同一条）；插件没装时退回这条本地队列，至少保证本页面
  // 内的写入不并发。
  let npxQueue: Promise<unknown> = Promise.resolve()
  function serializeNpx<T>(work: () => Promise<T>): Promise<T> {
    const run = npxQueue.then(work, work)
    npxQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 每次请求重新取服务：插件可能晚于路由启动。 */
  function serialRunner(): <T>(work: () => Promise<T>) => Promise<T> {
    return preferSharedQueue(skillsService(webCtx), serializeNpx)
  }

  /** 把 resolveWorker 的错误写成响应。 */
  function sendWorkerError(
    res: ServerResponse,
    error: { status: number; code: string; message: string },
  ): void {
    sendError(res, error.status, error.code, error.message)
  }

  // 「技能仓库」收藏列表：只读 Skills 插件已经保存的来源，页面不再接受手填
  // 的第三方仓库。探测出的 kind / skills 数来自 Skills 服务的缓存。
  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: SKILL_REPOS_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          const service = requireSkillsService(webCtx, res, '读取技能仓库里的', 'listRepositories')
          if (service === null) return

          try {
            const saved = await readSavedRepositories(service)
            sendJson(res, 200, { ok: true, ...saved })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 读取技能仓库失败：%s', describeError(error))
            sendError(res, 502, 'repos-failed', `读取技能仓库失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: GET ${SKILL_REPOS_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: AVAILABLE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveWorker(registryFile, body?.id)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
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
          const service = requireSkillsService(webCtx, res, '读取技能仓库里的', 'listSkills')
          if (service === null) return

          try {
            const saved = await readSavedRepositories(service)
            if (saved.corrupt) {
              sendError(
                res,
                409,
                'repos-unreadable',
                '技能仓库文件无法解析，无法确认这个来源是否已收藏。请先在 Skills 页面修复或删除收藏文件。',
              )
              return
            }
            const repository = findSavedRepository(saved, source)
            if (repository === null) {
              sendError(
                res,
                400,
                'not-saved',
                `只允许安装「技能仓库」里收藏过的来源，请先在 Skills 页面收藏：${source}`,
              )
              return
            }
            const listed = await listRepositorySkills(service, repository.source)
            if (!listed.ok) {
              sendJson(res, 502, {
                ok: false,
                code: listed.code,
                message: listed.message,
              })
              return
            }
            if (listed.skills.length === 0) {
              sendJson(res, 502, {
                ok: false,
                code: 'list-empty',
                message: '这个技能仓库里没有可安装的 skill，请换一个收藏来源或刷新 Skills 页面。',
              })
              return
            }
            const scanned = await scanProjectSkills(resolved.worker.path)
            webCtx.logger?.info?.(
              'buka-workers: 已读取 skill 清单（%s ← %s，%d 个）',
              resolved.worker.path,
              repository.source,
              listed.skills.length,
            )
            sendJson(res, 200, {
              ok: true,
              source: repository.source,
              skills: listed.skills,
              installed: scanned.skills.map((skill) => skill.name),
            })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 读取 skill 清单失败：%s', describeError(error))
            sendError(res, 500, 'available-failed', `读取 skill 清单失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${AVAILABLE_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: INSTALL_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveWorker(registryFile, body?.id)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
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
          const service = requireSkillsService(webCtx, res, '从技能仓库安装', 'listSkills')
          if (service === null) return

          try {
            const saved = await readSavedRepositories(service)
            if (saved.corrupt) {
              sendError(
                res,
                409,
                'repos-unreadable',
                '技能仓库文件无法解析，无法确认这个来源是否已收藏。请先在 Skills 页面修复或删除收藏文件。',
              )
              return
            }
            const repository = findSavedRepository(saved, source)
            if (repository === null) {
              sendError(
                res,
                400,
                'not-saved',
                `只允许安装「技能仓库」里收藏过的来源，请先在 Skills 页面收藏：${source}`,
              )
              return
            }
            // 名字与是否存在都以 Host 这次读到的仓库列表为准：页面缓存可能过期，
            // 也不能靠伪造请求把任意名字塞进命令行。
            const listed = await listRepositorySkills(service, repository.source)
            if (!listed.ok) {
              sendJson(res, 502, {
                ok: false,
                code: listed.code,
                message: listed.message,
              })
              return
            }
            const available = new Set(listed.skills.map((skill) => skill.name))
            const missing = selected.filter((skill) => !available.has(skill))
            if (missing.length > 0) {
              sendError(
                res,
                400,
                'skill-not-found',
                `技能仓库里没有这些 skill：${missing.join('、')}。仓库可能已更新，请重新读取后再试。`,
              )
              return
            }

            // `-a universal` 落 `.agents/skills`，`-a claude-code` 再给 Claude Code
            // 建 `.claude/skills/<name>` 链接：一次调用同时满足两种约定。不用
            // `--all`：它还会按机器上装了哪些 agent 建额外目录。
            const args = ['add', repository.source]
            for (const skill of selected) args.push('--skill', skill)
            args.push('-a', 'universal', '-a', 'claude-code', '-y')

            const result = await serialRunner()(() => runNpx(args, resolved.worker.path))
            if (!result.ok) {
              sendJson(res, 502, {
                ok: false,
                code: 'npx-failed',
                message: result.message ?? 'npx skills add 失败',
                output: result.output ?? '',
              })
              return
            }
            const scanned = await scanProjectSkills(resolved.worker.path)
            const claude = await ensureClaudeLink(resolved.worker.path)
            webCtx.logger?.info?.(
              'buka-workers: 已安装 %d 个 skill（%s ← %s）',
              selected.length,
              resolved.worker.path,
              repository.source,
            )
            sendJson(res, 200, {
              ok: true,
              output: result.output ?? '',
              skills: scanned.skills,
              claude,
            })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 安装 skill 失败：%s', describeError(error))
            sendError(res, 500, 'install-failed', `安装 skill 失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${INSTALL_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: SKILL_REMOVE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveWorker(registryFile, body?.id)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
            return
          }
          const skillName = normalizeSkillName(body?.skill)
          if (skillName === null) {
            sendError(res, 400, 'invalid-skill', `skill 名称不合法：${String(body?.skill)}`)
            return
          }

          try {
            const result = await serialRunner()(() =>
              runNpx(['remove', skillName, '-y'], resolved.worker.path),
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
            const scanned = await scanProjectSkills(resolved.worker.path)
            webCtx.logger?.info?.(
              'buka-workers: 已移除 skill（%s ← %s）',
              resolved.worker.path,
              skillName,
            )
            sendJson(res, 200, { ok: true, output: result.output ?? '', skills: scanned.skills })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 移除 skill 失败：%s', describeError(error))
            sendError(res, 500, 'remove-failed', `移除 skill 失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${SKILL_REMOVE_ROUTE}`,
  )

  // ---- 执行者 skill 检查 / 更新 ---------------------------------------------

  // 进入「技能」页签时页面自动调用：只检查、不写盘，结果按 skill 名带回页面，
  // 行内据此显示「有更新 / 已最新 / 本地已修改 / …」。
  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: SKILL_CHECK_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveWorker(registryFile, body?.id)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
            return
          }
          const service = requireSkillsService(webCtx, res, '检查这个执行者的', 'checkSkills')
          if (service === null) return

          try {
            const result = await service.checkSkills({ dir: resolved.worker.path })
            const report = reportSkillUpdate(result)
            if (report.failure !== null) {
              sendJson(res, report.status, {
                ok: false,
                ...(report.failure.code === undefined ? {} : { code: report.failure.code }),
                message: report.failure.message,
                ...(report.failure.output === undefined ? {} : { output: report.failure.output }),
              })
              return
            }
            sendJson(res, 200, { ok: true, check: result })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 检查 skill 更新失败：%s', describeError(error))
            sendError(res, 502, 'check-failed', `检查 skill 更新失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${SKILL_CHECK_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: SKILL_UPDATE_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const body = await readJsonBody(req, res)
          if (body === undefined) return

          const resolved = await resolveWorker(registryFile, body?.id)
          if (resolved.error !== undefined) {
            sendWorkerError(res, resolved.error)
            return
          }
          // 可选的 `skills` 把一次更新收窄到页面上的某一行；不传表示全部。
          const only = body?.skills === undefined ? undefined : normalizeSkillSelection(body.skills)
          if (body?.skills !== undefined && only === null) {
            sendError(
              res,
              400,
              'invalid-skills',
              `skills 必须是 1–${MAX_SKILL_SELECTION} 个合法的 skill 名。`,
            )
            return
          }
          const service = requireSkillsService(webCtx, res, '更新这个执行者的', 'updateSkills')
          if (service === null) return

          try {
            const result = await service.updateSkills({
              dir: resolved.worker.path,
              ...(only === undefined || only === null ? {} : { skills: only }),
            })
            const report = reportSkillUpdate(result)
            if (report.failure !== null) {
              webCtx.logger?.warn?.(
                'buka-workers: 更新 skill 失败（%s）：%s',
                resolved.worker.path,
                report.failure.message,
              )
              sendJson(res, report.status, {
                ok: false,
                ...(report.failure.code === undefined ? {} : { code: report.failure.code }),
                message: report.failure.message,
                ...(report.failure.output === undefined ? {} : { output: report.failure.output }),
              })
              return
            }
            const scanned = await scanProjectSkills(resolved.worker.path)
            webCtx.logger?.info?.(
              'buka-workers: 已更新 skill（%s，失败 %d 个）',
              resolved.worker.path,
              report.failed,
            )
            sendJson(res, 200, { ok: report.ok, update: result, skills: scanned.skills })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 更新 skill 失败：%s', describeError(error))
            sendError(res, 502, 'update-failed', `更新 skill 失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${SKILL_UPDATE_ROUTE}`,
  )

  webCtx.effect(
    () =>
      webCtx.webServer.register({
        kind: 'exact',
        path: SKILL_UPDATE_ALL_ROUTE,
        handler: async (req, res) => {
          if (rejected(webCtx, req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const service = requireSkillsService(webCtx, res, '更新执行者的', 'updateSkills')
          if (service === null) return

          try {
            const listed = await listWorkers({
              file: registryFile,
              workersDir: deps.workersDir,
            })
            if (listed.corrupt) {
              sendError(
                res,
                409,
                'registry-unreadable',
                `执行者登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`,
              )
              return
            }
            // 只更新智能体、目录存在且确实装了 skill 的执行者；顺序执行，
            // 单个失败不中断，汇总见 `skill-update-batch.ts`。
            const updateSkills = service.updateSkills.bind(service)
            const batch = await updateWorkersSequentially({
              workers: listed.workers,
              update: (options) => updateSkills(options),
            })
            webCtx.logger?.info?.(
              'buka-workers: 已更新全部执行者（%d 个 worker，%d 个失败）',
              batch.results.length,
              batch.failed,
            )
            sendJson(res, 200, { ok: true, ...batch })
          } catch (error) {
            webCtx.logger?.warn?.('buka-workers: 更新全部执行者失败：%s', describeError(error))
            sendError(res, 502, 'update-failed', `更新全部执行者失败：${describeError(error)}`)
          }
        },
      }),
    `buka-workers: POST ${SKILL_UPDATE_ALL_ROUTE}`,
  )
}
