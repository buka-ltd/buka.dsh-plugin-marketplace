/**
 * 「打工人」页面的项目级 skills 路由。
 *
 * 页面在这里列出某个来源里可安装的 skills、安装勾选项、移除已安装项；命令都
 * 在打工人目录里用 `npx skills` 执行，安装时同时落 `.agents/skills` 与
 * `.claude/skills`。命令输出只用于给人看，所以失败时把输出原样带回页面。
 *
 * @module @buka/dsh-plugin-workers/routes/skills
 */

import type { ServerResponse } from 'node:http'
import { createNpxRunner, parseSkillList } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'
import { ensureClaudeLink, scanProjectSkills } from '../worker-store.ts'
import {
  describeError,
  readJsonBody,
  rejected,
  sendError,
  sendJson,
  sendMethodNotAllowed,
} from './http.ts'
import { resolveWorker } from './target.ts'

/** 页面列出来源里可安装的 skills 用的路由。 */
const AVAILABLE_ROUTE = '/buka-workers/skills/available'

/** 页面安装项目级 skill 用的路由。 */
const INSTALL_ROUTE = '/buka-workers/skills/install'

/** 页面移除项目级 skill 用的路由。 */
const SKILL_REMOVE_ROUTE = '/buka-workers/skills/remove'

/** `add --list` 的输出需要整段解析，给列清单的 runner 单独放宽上限。 */
const LIST_OUTPUT_BYTES = 256 * 1024

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

/** skills 路由的依赖：打工人根目录与登记文件由入口传入。 */
export interface SkillRouteDeps {
  workersDir: string
  registryFile: string
}

/**
 * 注册项目级 skills 相关的精确路由。
 *
 */
export function registerSkillRoutes(webCtx: Context, deps: SkillRouteDeps): void {
  const { registryFile } = deps

  // 项目级安装与移除：cwd 每次按打工人目录传，超时 180 s，失败文案带子命令名。
  const runNpx = createNpxRunner({
    timeoutMs: NPX_TIMEOUT_MS,
    label: npxLabel,
    missingMessage: NPX_MISSING_MESSAGE,
    emptyOutputOnSetupFailure: true,
  })
  // `add --list` 的输出要整段解析：默认 runner 只留末尾 4 KB 会把列表头截掉。
  const runNpxList = createNpxRunner({
    timeoutMs: NPX_TIMEOUT_MS,
    maxOutputBytes: LIST_OUTPUT_BYTES,
    label: npxLabel,
    missingMessage: NPX_MISSING_MESSAGE,
    emptyOutputOnSetupFailure: true,
  })

  // npx skills 会整份重写工作区里的 skills-lock.json；同一工作区的安装与移除
  // 并发执行会互相覆盖条目。这里把 npx 调用排成一条全局队列，页面上的并发
  // 点击也安全（与 skills 插件的卸载队列同一做法）。
  let npxQueue: Promise<unknown> = Promise.resolve()
  function serializeNpx<T>(work: () => Promise<T>): Promise<T> {
    const run = npxQueue.then(work, work)
    npxQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 把 resolveWorker 的错误写成响应。 */
  function sendWorkerError(
    res: ServerResponse,
    error: { status: number; code: string; message: string },
  ): void {
    sendError(res, error.status, error.code, error.message)
  }

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

          const resolved = await resolveWorker(registryFile, body?.name)
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

          try {
            // CLI 只提供给人看的文本清单（`--json` 不能与 `--list` 同用），
            // 这里解析出 skill 名与描述；安装时再用 `--skill <name>` 选择。
            const result = await serializeNpx(() =>
              runNpxList(['add', source, '--list'], resolved.worker.path),
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
            const scanned = await scanProjectSkills(resolved.worker.path)
            webCtx.logger?.info?.(
              'buka-workers: 已读取 skill 清单（%s ← %s，%d 个）',
              resolved.worker.path,
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

          const resolved = await resolveWorker(registryFile, body?.name)
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

          try {
            // `-a universal` 落 `.agents/skills`，`-a claude-code` 再给 Claude Code
            // 建 `.claude/skills/<name>` 链接：一次调用同时满足两种约定。不用
            // `--all`：它还会按机器上装了哪些 agent 建额外目录。
            const args = ['add', source]
            for (const skill of selected) args.push('--skill', skill)
            args.push('-a', 'universal', '-a', 'claude-code', '-y')

            const result = await serializeNpx(() => runNpx(args, resolved.worker.path))
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
              source,
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

          const resolved = await resolveWorker(registryFile, body?.name)
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
            const result = await serializeNpx(() =>
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
}
