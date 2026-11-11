/**
 * `@buka/dsh-plugin-skills` 对外提供的 Host Service：`ctx.bukaSkills`。
 *
 * 页面和 `buka_skills` 工具只消费其中一部分能力；其他插件通过 Cordis 的
 * 服务注入拿到同一个实例：
 *
 * ```js
 * export const inject = ['bukaSkills']
 * export function apply(ctx) {
 *   const repos = await ctx.bukaSkills.listRepositories()
 * }
 * ```
 *
 * 三个公开方法形成一条从「收藏」到「仓库内容」的链：
 *
 * - `listRepositories()`：收藏的来源，附带探测出的类型（npx skills 仓库 /
 *   Claude Code marketplace / 不可用 / 暂时判不出）与预计 skill 数。来源可以是
 *   GitHub 仓库、任意 git 远端或本地绝对路径，都能探测与列出；
 * - `listSkills({ source })`：某个仓库里所有可安装的 skill（扁平列表）；
 * - `listPlugins({ source })`：Claude Code marketplace 里的插件，每个插件带
 *   自己的 skill 列表；对非 marketplace 仓库返回 `not-a-marketplace`。
 *
 * 所有仓库访问都复用 `src/repo-skills.ts` 的 TTL 缓存与错误码，并且按仓库
 * 来源合并并发请求：页面展开卡片、另一个插件同时调服务时，同一个仓库只会
 * 拉一次（GitHub 走 API，git 远端浅克隆，本地路径直接扫描）。
 * 服务本身不写任何状态，收藏的增删仍由本插件的路由负责（这是用户操作，不是
 * 对外能力）。
 *
 * 说明：这里用 `ctx.provide()` 注册实例，而不是 `export default class extends
 * Service`。原因是本包入口必须同时导出 `apply` 来注册路由与工具（Cordis 的
 * 插件入口两种形态不能混用），而且本仓库的单测不安装 `@deepseek-ai/*`，
 * 服务实现需要保持可被 `node --test` 直接 import。`ctx.provide` 是 Service
 * 基类底层的同一个原语：消费侧完全一致（`inject: ['bukaSkills']` /
 * `ctx.bukaSkills`），卸载时同样自动摘除并唤醒依赖方。
 *
 * @module @buka/dsh-plugin-skills/service
 */

import type {
  DirNode,
  RepoKind,
  RepoProbeResult,
  RepoSkillsFailure,
  RepoSkillsResult,
  TreeNode,
} from './repo-skills.ts'
import { fetchRepoSkills, probeRepoKind } from './repo-skills.ts'
import type { SavedRepo } from './repo-store.ts'
import { listSavedRepos } from './repo-store.ts'
import type { Homes } from './skill-store.ts'
import { resolveHomes } from './skill-store.ts'

/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaSkills`。 */
export const SERVICE_NAME = 'bukaSkills'

/** `listRepositories()` 并发探测的上限：收藏列表再长也不一次打开太多连接。 */
const PROBE_CONCURRENCY = 4

/**
 * 对外暴露的仓库类型。`unknown` 表示探测失败（网络 / 限流 / 非法来源），
 * 具体原因在条目的 `code` 与 `error` 里。
 */
export type RepositoryKind = RepoKind | 'unknown'

/**
 * 一个可安装 skill。`path` 是它在仓库里的完整路径（`.../SKILL.md`）；
 * `plugin` 是仓库清单里显式声明它所属的插件名，没有归入任何插件时为 null
 * （npx skills 仓库与 Claude Code marketplace 都适用）。
 */
export interface SkillRef {
  name: string
  description: string
  path: string
  plugin: string | null
}

/**
 * marketplace 里的一个插件。没有可列 skill 的插件也会出现，`skills` 为空数组。
 */
export interface PluginRef {
  name: string
  root: string
  description: string
  skills: SkillRef[]
}

/** 收藏 + 探测结论。`skills` 是探测出的预计数量（`unknown` 时为 null）。 */
export interface RepositoryView extends SavedRepo {
  kind: RepositoryKind
  skills: number | null
  code?: string
  error?: string
}

/**
 * 所有仓库级操作共用的失败形状，错误码与 `src/repo-skills.ts` 一致，另加
 * 服务层的 `not-a-marketplace`。
 */
export interface ServiceFailure {
  ok: false
  code:
    | 'invalid-source'
    | 'unsupported-source'
    | 'repo-not-found'
    | 'rate-limited'
    | 'fetch-failed'
    | 'git-unavailable'
    | 'git-failed'
    | 'repo-unavailable'
    | 'not-a-marketplace'
  message: string
}

/**
 * 收藏仓库列表的返回值。`corrupt` 说明收藏文件存在但无法解析（此时
 * `repositories` 为空，调用方不能据此写回）。
 */
export interface RepositoryList {
  file: string
  exists: boolean
  corrupt: boolean
  repositories: RepositoryView[]
}

/**
 * `listRepositories` 等服务方法的可选参数：`refresh` 绕过 TTL；其余字段给
 * 测试或特殊调用方覆盖网络/时钟（生产调用不传）。
 */
export interface ServiceOptions {
  refresh?: boolean
  fetchImpl?: typeof fetch
  token?: string
  now?: number
  ttlMs?: number
}

/** `listSkills()` 成功时的返回值。 */
export interface SkillListResult {
  ok: true
  source: string
  kind: RepositoryKind
  ref: string
  sha: string
  fetchedAt: number
  cached: boolean
  truncated: boolean
  skills: SkillRef[]
}

/** `listPlugins()` 成功时的返回值。 */
export interface PluginListResult {
  ok: true
  source: string
  kind: 'claude-code-marketplace'
  ref: string
  sha: string
  fetchedAt: number
  cached: boolean
  truncated: boolean
  plugins: PluginRef[]
}

/**
 * 收藏仓库与仓库内容的只读服务。
 *
 * @example
 * const service = new SkillsCatalogService()
 * const { repositories } = await service.listRepositories()
 * const markets = repositories.filter((one) => one.kind === 'claude-code-marketplace')
 * const { plugins } = await service.listPlugins({ source: markets[0].source })
 */
export class SkillsCatalogService {
  /** 同一来源的完整树请求合并表。 */
  #treeInFlight = new Map<string, Promise<RepoSkillsResult | RepoSkillsFailure>>()
  /** 同一来源的类型探测请求合并表。 */
  #probeInFlight = new Map<string, Promise<RepoProbeResult | RepoSkillsFailure>>()

  /** DSH home 解析结果；收藏文件与缓存都放在它下面。 */
  readonly homes: Homes
  /** 默认网络实现；测试可以注入假 fetch。 */
  readonly fetchImpl: typeof fetch

  constructor({
    homes = resolveHomes(),
    fetchImpl = fetch,
  }: { homes?: Homes; fetchImpl?: typeof fetch } = {}) {
    this.homes = homes
    this.fetchImpl = fetchImpl
  }

  /**
   * 列出收藏的来源，并逐个探测类型与 skill 数量。
   *
   * 探测走 `probeRepoKind()`：GitHub 只拉仓库树（必要时再拉 marketplace.json），
   * git 远端先浅克隆到缓存目录，本地绝对路径直接扫描目录；都不拉任何
   * `SKILL.md` 原文。结论按 30 分钟 TTL 缓存，`refresh: true` 时绕过缓存重新
   * 探测。同一条来源的并发探测会被合并。
   *
   * 失败不会让整个列表失败：条目退回 `kind: 'unknown'`，并带上探测错误码与
   * 原因（npm 包名、GitHub 子页面等不可列出的来源也会落到这里），其他收藏照常
   * 返回。
   */
  async listRepositories({ refresh = false, ...io }: ServiceOptions = {}): Promise<RepositoryList> {
    const store = await listSavedRepos({ homes: this.homes })
    const repositories = await mapLimit(
      store.repos,
      PROBE_CONCURRENCY,
      async (repo): Promise<RepositoryView> => {
        const probed = await this.probeRepositoryKind({ ...io, source: repo.source, refresh })
        if (probed.ok) return { ...repo, kind: probed.kind, skills: probed.skills }
        if (probed.code === 'repo-unavailable') return { ...repo, kind: 'unavailable', skills: 0 }
        return { ...repo, kind: 'unknown', skills: null, code: probed.code, error: probed.message }
      },
    )
    return { file: store.file, exists: store.exists, corrupt: store.corrupt, repositories }
  }

  /**
   * 列出一个仓库里所有可安装的 skill。
   *
   * 列表扁平化：npx skills 仓库按 `npx skills` 的发现规则列，仓库清单里显式
   * 声明的插件分组同样用 `plugin` 标出；Claude Code marketplace 把每个插件下
   * 的 skill 一起列出来。结果与页面展开的树来自同一次拉取（同一份缓存），
   * 所以两处不会互相矛盾。
   */
  async listSkills({
    source,
    refresh = false,
    ...io
  }: ServiceOptions & { source?: unknown } = {}): Promise<SkillListResult | ServiceFailure> {
    const fetched = await this.fetchRepositorySkills({ ...io, source, refresh })
    if (!fetched.ok) return fetched
    return {
      ok: true,
      source: fetched.source,
      kind: fetched.kind,
      ref: fetched.ref,
      sha: fetched.sha,
      fetchedAt: fetched.fetchedAt,
      cached: fetched.cached,
      truncated: fetched.truncated,
      skills: flattenSkillTree(fetched),
    }
  }

  /**
   * 列出 Claude Code marketplace 里声明的插件，每个插件带自己的 skill 列表。
   *
   * 清单来自仓库根的 `.claude-plugin/marketplace.json`：没有 skill 的插件也会
   * 出现（`skills: []`），因为它们可能只提供 commands / agents。对 npx skills
   * 仓库、不可用仓库或探测失败的仓库返回 `not-a-marketplace` / 对应仓库错误，
   * 调用方可以先调 `listRepositories()` 判断类型再调用。
   */
  async listPlugins({
    source,
    refresh = false,
    ...io
  }: ServiceOptions & { source?: unknown } = {}): Promise<PluginListResult | ServiceFailure> {
    const fetched = await this.fetchRepositorySkills({ ...io, source, refresh })
    if (!fetched.ok) return fetched
    if (fetched.kind !== 'claude-code-marketplace') {
      return {
        ok: false,
        code: 'not-a-marketplace',
        message: `${fetched.source} is ${fetched.kind}, not a Claude Code plugin marketplace.`,
      }
    }

    const treeByRoot = new Map<string, DirNode>()
    for (const node of fetched.root) {
      if (node.type === 'dir') treeByRoot.set(node.path, node)
    }
    const plugins = (fetched.marketplace?.plugins ?? []).map((plugin): PluginRef => {
      const node = treeByRoot.get(plugin.root === '' ? '.' : plugin.root)
      return {
        name: plugin.name,
        root: plugin.root,
        description: plugin.description,
        skills: node === undefined ? [] : flattenSkills(node.children, plugin.name),
      }
    })
    plugins.sort((a, b) => compareName(a.name, b.name))

    return {
      ok: true,
      source: fetched.source,
      kind: fetched.kind,
      ref: fetched.ref,
      sha: fetched.sha,
      fetchedAt: fetched.fetchedAt,
      cached: fetched.cached,
      truncated: fetched.truncated,
      plugins,
    }
  }

  /**
   * 拉取一个仓库的完整 skills 树（带缓存与并发合并）。
   *
   * @internal 路由适配器用；其他插件优先用 `listSkills()` / `listPlugins()`。
   */
  fetchRepositorySkills({
    source,
    refresh = false,
    ...io
  }: ServiceOptions & { source?: unknown } = {}): Promise<RepoSkillsResult | RepoSkillsFailure> {
    return this.#coalesce(this.#treeInFlight, source, refresh, () =>
      fetchRepoSkills({
        ...io,
        homes: this.homes,
        source,
        refresh,
        fetchImpl: io.fetchImpl ?? this.fetchImpl,
      }),
    )
  }

  /**
   * 只探测一个仓库的类型（带缓存与并发合并）。
   *
   * @internal 路由适配器与 `listRepositories()` 用。
   */
  probeRepositoryKind({
    source,
    refresh = false,
    ...io
  }: ServiceOptions & { source?: unknown } = {}): Promise<RepoProbeResult | RepoSkillsFailure> {
    return this.#coalesce(this.#probeInFlight, source, refresh, () =>
      probeRepoKind({
        ...io,
        homes: this.homes,
        source,
        refresh,
        fetchImpl: io.fetchImpl ?? this.fetchImpl,
      }),
    )
  }

  /**
   * 同一来源的并发请求共用一次网络拉取；`refresh` 请求不合并，保证「刷新」
   * 真的重新拉。请求 settle 后从表里移除，失败也不会留下毒化的 promise。
   */
  #coalesce<T>(
    inFlight: Map<string, Promise<unknown>>,
    source: unknown,
    refresh: boolean,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = String(source)
    if (!refresh) {
      const pending = inFlight.get(key)
      if (pending !== undefined) return pending as Promise<T>
    }
    const run = work()
    if (!refresh) {
      inFlight.set(key, run)
      run.then(
        () => inFlight.delete(key),
        () => inFlight.delete(key),
      )
    }
    return run
  }
}

/**
 * 把 `fetchRepoSkills()` 返回的树摊平成 skill 列表。
 *
 * 树根的目录节点都是插件分组（marketplace 的插件，或 npx 仓库清单里显式
 * 声明的插件），用节点名作为 `plugin`；平铺在根上的 skill `plugin` 为 null。
 */
function flattenSkillTree(fetched: { root: TreeNode[] }): SkillRef[] {
  return fetched.root.flatMap((node) =>
    node.type === 'dir' ? flattenSkills(node.children, node.name) : flattenSkills([node], null),
  )
}

/**
 * 深度优先摊平一棵树里的 skill 节点，保留树里的排序。
 */
function flattenSkills(nodes: TreeNode[], plugin: string | null, out: SkillRef[] = []): SkillRef[] {
  for (const node of nodes) {
    if (node.type === 'skill') {
      out.push({ name: node.name, description: node.description, path: node.path, plugin })
    } else {
      flattenSkills(node.children, plugin, out)
    }
  }
  return out
}

/**
 * 与页面一致的大小写不敏感排序；完全相同时再用原始大小写稳定排序。
 */
function compareName(a: string, b: string): number {
  const folded = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return folded !== 0 ? folded : a.localeCompare(b)
}

/**
 * 以固定并发跑一批异步任务，结果顺序与输入一致。
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index] as T, index)
    }
  }

  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}
