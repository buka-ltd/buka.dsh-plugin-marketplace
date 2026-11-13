/**
 * 全局 skills 管理插件：Host 一半。
 *
 * 提供三件东西：
 *
 * - 包内 HTTP 路由，给浏览器一半的侧边栏「Skills」页面用：
 *   `GET /buka-skills/list` 列出全局 skills，`POST /buka-skills/uninstall` 卸载一个，
 *   `GET /buka-skills/targets` 列出可安装的打工人（可选的 `ctx.bukaWorkers`）与
 *   工作区（`ctx.workspaceRegistry`），`POST /buka-skills/install` 把某个收藏仓库
 *   里的一个 skill 安装到全局、某个打工人目录或某个工作区目录；
 *   `GET /buka-skills/repos` 列出用户收藏的仓库，
 *   `POST /buka-skills/repos` 收藏一个，`POST /buka-skills/repos/remove` 移除一个，
 *   `GET /buka-skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
 *   `probe=1` 时只探测仓库类型：npx skills / Claude Code marketplace / 不可用）。
 *   收藏的仓库既可以是 npx skills 仓库，也可以是 Claude Code marketplace 仓库：
 *   前者按 `npx skills` 的发现规则列 SKILL.md，后者只列 marketplace 里各本地
 *   插件子树中的 SKILL.md（commands / agents 不列）。收藏来源可以是 GitHub
 *   仓库、任意 git 远端（Host 用 `git clone --depth 1` 拉到缓存目录再扫描）或
 *   本地绝对路径（直接扫描目录）。列表数据来自同一份磁盘扫描
 *   （`src/skill-store.ts`），收藏来自 `src/repo-store.ts` 的 JSON 文件，
 *   仓库 skills 由 `src/repo-skills.ts` 按 TTL 缓存仓库树，安装由
 *   `src/skill-install.ts` 交给 `npx skills add`（与卸载共用串行队列）；
 * - 一个只读工具 `buka_skills`，让模型能回答「本机装了哪些全局 skill、它们
 *   是不是 npx skills 装的」。安装与卸载都是写操作，只留给页面上的用户按钮，
 *   不开放给模型。
 * - 一个 Host Service `ctx.bukaSkills`（`src/service.ts`）：把收藏的仓库、
 *   仓库里的 skill 列表与 marketplace 插件列表开放给其他插件。页面与工具
 *   也复用同一个服务实例，因此两处的缓存与并发请求是同一份。
 *
 * 本文件只做装配：路由在 `src/routes.ts`，模型工具在 `src/tools.ts`，快照读取
 * 在 `src/snapshot.ts`，请求体 / 响应工具在 `src/http.ts`，串行队列在
 * `src/serial-queue.ts`。路由在 `webServer` 就绪后注册，并沿用 web 组合的
 * 信任栅栏（`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-skills
 */

import path from 'node:path'
import { createNpxRunner } from '@buka/plugin-kit'
import type { Context } from '@deepseek-ai/cordis'

import { resolveHomes } from './homes.ts'
import { registerRoutes } from './routes.ts'
import { createSerialQueue } from './serial-queue.ts'
import { SERVICE_NAME, SkillsCatalogService } from './service.ts'
import { readSnapshot } from './snapshot.ts'
import { registerTools } from './tools.ts'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'skill-buka-skills'

/** 依赖的服务：列举 skill 需要 skills 注册表；页面与工具各自按可选依赖挂载。 */
export const inject = ['skills']

/**
 * 注册路由与只读工具。
 *
 * @param ctx 提供 `skills` 的插件上下文
 */
export function apply(ctx: Context): void {
  const homes = resolveHomes()
  // 安装 / 卸载：cwd 默认固定在 agentsHome，打工人 / 工作区安装会显式传自己的
  // 工作目录。超时放宽到 180 s：从 GitHub 拉取仓库再写项目级 skills 会比纯全局
  // 安装多一步，和 workers 插件的项目级安装保持一致。
  // 找不到 npx 的文案里带出 skill 的实际落点，方便用户手动管理。
  const runNpx = createNpxRunner({
    cwd: homes.agentsHome,
    timeoutMs: 180_000,
    missingMessage: `没有找到 npx。请先安装 Node.js（含 npm），或手动管理 ${path.join(homes.agentsHome, 'skills')} 下的 skill。`,
  })

  // 对外服务：其他插件的 `inject: ['bukaSkills']` 拿到的就是这个实例。
  // 服务本身不注册 effect，会随本插件 fiber 卸载自动从 ctx 上摘除。
  const catalog = new SkillsCatalogService({ homes })
  ctx.provide(SERVICE_NAME, catalog)

  /** 读取一份已安装 skills 快照；路由与工具共用。 */
  const snapshot = (): ReturnType<typeof readSnapshot> => readSnapshot(ctx, homes)

  // 仓库级请求的并发合并与 TTL 缓存都在服务里：页面路由与外部插件调服务时
  // 共用同一份在途请求，同一仓库不会重复打 GitHub。

  // npx skills 会整份重写共享的 lockfile，安装与卸载并发执行可能互相覆盖条目；
  // 这里把两类请求排成一条队列，页面上的并发点击也安全。
  const serializeNpx = createSerialQueue()

  registerRoutes(ctx, { homes, runNpx, catalog, readSnapshot: snapshot, serializeNpx })
  registerTools(ctx, { readSnapshot: snapshot })
}
