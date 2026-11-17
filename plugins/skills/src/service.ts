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
 *   const checked = await ctx.bukaSkills.checkSkills({ dir: '/path/to/worker' })
 * }
 * ```
 *
 * 公开方法：
 *
 * - `listRepositories()`：收藏的来源，附带探测出的类型（标准 npx 仓库 /
 *   不可用 / 暂时判不出）与预计 skill 数。来源可以是 GitHub 仓库、任意 git
 *   远端或本地绝对路径；远端一律浅克隆到本地缓存再扫描；
 * - `listSkills({ source })`：某个仓库里所有可安装的 skill（扁平列表）；
 * - `checkSkills({ dir? })`：检查全局（省略 `dir`）或某个目标目录里的 skill
 *   状态（`update` / `modified` / `up-to-date` / `unsupported-source` /
 *   `failed`）；
 * - `updateSkills({ dir? })`：只应用 `update` 状态，`modified` 默认跳过；
 * - `runSerialized(work)`：借用同一条串行队列执行一段写入，供其他插件在写
 *   同一份 `skills-lock.json` 前排队。
 *
 * 所有仓库访问都复用 `src/repo-skills.ts` 的 TTL 缓存与错误码，并且按仓库
 * 来源合并并发请求。检查 / 更新与安装 / 卸载共用同一条串行队列：底层都会整份
 * 重写 `skills-lock.json`，并发执行会互相覆盖条目。
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
  RepoKind,
  RepoProbeResult,
  RepoSkillsFailure,
  RepoSkillsResult,
  TreeNode,
} from './repo-skills.ts'
import { fetchRepoSkills, probeRepoKind } from './repo-skills.ts'
import type { SavedRepo } from './repo-store.ts'
import { listSavedRepos } from './repo-store.ts'
import { createSerialQueue } from './serial-queue.ts'
import type { Homes } from './skill-store.ts'
import { resolveHomes } from './skill-store.ts'
import type {
  SkillCheckResult,
  SkillsCliRunner,
  SkillUpdateFailure,
  SkillUpdateResult,
} from './skill-update.ts'
import { checkSkills, updateSkills } from './skill-update.ts'

/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaSkills`。 */
export const SERVICE_NAME = 'bukaSkills'

/** `listRepositories()` 并发探测的上限：收藏列表再长也不一次打开太多连接。 */
const PROBE_CONCURRENCY = 4

/** 对外暴露的仓库类型。`unknown` 表示探测失败，具体原因在 `code` / `error`。 */
export type RepositoryKind = RepoKind | 'unknown'

/** 一个可安装 skill；`path` 是它在仓库里的完整路径。 */
export interface SkillRef {
  name: string
  description: string
  path: string
}

/** 收藏 + 探测结论。`skills` 是探测出的预计数量（`unknown` 时为 null）。 */
export interface RepositoryView extends SavedRepo {
  kind: RepositoryKind
  skills: number | null
  code?: string
  error?: string
  warning?: string
}

/** 所有仓库级操作共用的失败形状，错误码与 `src/repo-skills.ts` 一致。 */
export interface ServiceFailure {
  ok: false
  code: string
  message: string
  output?: string
}

/** 收藏仓库列表的返回值。 */
export interface RepositoryList {
  file: string
  exists: boolean
  corrupt: boolean
  repositories: RepositoryView[]
}

/** `listRepositories` 等服务方法的可选参数。 */
export interface ServiceOptions {
  refresh?: boolean
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
  warning?: string
}

/** 检查 / 更新的入参：省略 `dir` 表示全局。 */
export interface SkillScopeOptions {
  /** 目标目录（打工人目录或工作区目录）；省略表示全局。 */
  dir?: string
  /** 绕过仓库缓存重新拉取来源。 */
  refresh?: boolean
}

/** 服务构造参数。 */
export interface SkillsCatalogOptions {
  homes?: Homes
  /** 与安装 / 卸载共用的串行队列；不传时服务自建一条。 */
  serialize?: <T>(work: () => Promise<T>) => Promise<T>
  /** `skills` CLI 的执行函数；测试可注入。 */
  cli?: SkillsCliRunner
}

/**
 * 收藏仓库与仓库内容的只读服务。
 *
 * @example
 * const service = new SkillsCatalogService()
 * const { repositories } = await service.listRepositories()
 * const { results } = await service.checkSkills()
 */
export class SkillsCatalogService {
  /** 同一来源的完整树请求合并表。 */
  #treeInFlight = new Map<string, Promise<RepoSkillsResult | RepoSkillsFailure>>()
  /** 同一来源的类型探测请求合并表。 */
  #probeInFlight = new Map<string, Promise<RepoProbeResult | RepoSkillsFailure>>()
  /** 安装 / 卸载 / 检查 / 更新共用的串行队列。 */
  #serialize: <T>(work: () => Promise<T>) => Promise<T>

  /** DSH home 解析结果；收藏文件与缓存都放在它下面。 */
  readonly homes: Homes
  /** `skills` CLI 的执行函数。 */
  readonly cli: SkillsCliRunner | undefined

  constructor({ homes = resolveHomes(), serialize, cli }: SkillsCatalogOptions = {}) {
    this.homes = homes
    this.#serialize = serialize ?? createSerialQueue()
    this.cli = cli
  }

  /**
   * 列出收藏的来源，并逐个探测类型与 skill 数量。
   *
   * 失败不会让整个列表失败：条目退回 `kind: 'unknown'`，并带上探测错误码与
   * 原因，其他收藏照常返回。
   */
  async listRepositories({ refresh = false, ...io }: ServiceOptions = {}): Promise<RepositoryList> {
    const store = await listSavedRepos({ homes: this.homes })
    const repositories = await mapLimit(
      store.repos,
      PROBE_CONCURRENCY,
      async (repo): Promise<RepositoryView> => {
        const probed = await this.probeRepositoryKind({ ...io, source: repo.source, refresh })
        if (probed.ok) {
          return {
            ...repo,
            kind: probed.kind,
            skills: probed.skills,
            ...(probed.warning === undefined ? {} : { warning: probed.warning }),
          }
        }
        if (probed.code === 'repo-unavailable') return { ...repo, kind: 'unavailable', skills: 0 }
        return { ...repo, kind: 'unknown', skills: null, code: probed.code, error: probed.message }
      },
    )
    return { file: store.file, exists: store.exists, corrupt: store.corrupt, repositories }
  }

  /**
   * 列出一个仓库里所有可安装的 skill（扁平列表）。
   *
   * 结果与页面展开的树来自同一次拉取（同一份缓存），所以两处不会互相矛盾。
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
      skills: flattenSkillTree(fetched.root),
      ...(fetched.warning === undefined ? {} : { warning: fetched.warning }),
    }
  }

  /**
   * 检查全局或某个目标目录里的 skill 状态。
   *
   * 与安装 / 卸载共用串行队列，避免检查时底层 CLI / lock 与其它写入交错。
   *
   * @param options `dir` 由调用方解析后传入；省略表示全局
   */
  checkSkills({
    dir,
    refresh,
  }: SkillScopeOptions = {}): Promise<SkillCheckResult | SkillUpdateFailure> {
    return this.#serialize(() =>
      checkSkills({
        homes: this.homes,
        catalog: this,
        ...(dir === undefined ? {} : { dir }),
        ...(refresh === undefined ? {} : { refresh }),
        ...(this.cli === undefined ? {} : { cli: this.cli }),
      }),
    )
  }

  /**
   * 检查并更新全局或某个目标目录里的 skill；只应用 `update` 状态。
   *
   * @param options `dir` 由调用方解析后传入；省略表示全局
   */
  updateSkills({
    dir,
    refresh,
  }: SkillScopeOptions = {}): Promise<SkillUpdateResult | SkillUpdateFailure> {
    return this.#serialize(() =>
      updateSkills({
        homes: this.homes,
        catalog: this,
        ...(dir === undefined ? {} : { dir }),
        ...(refresh === undefined ? {} : { refresh }),
        ...(this.cli === undefined ? {} : { cli: this.cli }),
      }),
    )
  }

  /**
   * 用安装 / 卸载 / 检查 / 更新共用的串行队列执行一段工作。
   *
   * 其他插件在重写同一份 `skills-lock.json` 前，应通过这里排队，避免与
   * Skills 插件自己的写入并发。
   *
   * @param work 要排队执行的工作
   */
  runSerialized<T>(work: () => Promise<T>): Promise<T> {
    return this.#serialize(work)
  }

  /**
   * 拉取一个仓库的完整 skills 树（带缓存与并发合并）。
   *
   * @internal 路由适配器用；其他插件优先用 `listSkills()`。
   */
  fetchRepositorySkills({
    source,
    refresh = false,
    ...io
  }: ServiceOptions & { source?: unknown } = {}): Promise<RepoSkillsResult | RepoSkillsFailure> {
    return this.#coalesce(this.#treeInFlight, source, refresh, () =>
      fetchRepoSkills({ ...io, homes: this.homes, source, refresh }),
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
      probeRepoKind({ ...io, homes: this.homes, source, refresh }),
    )
  }

  /**
   * 同一来源的并发请求共用一次读取；`refresh` 请求不合并，保证「刷新」真的
   * 重新拉。请求 settle 后从表里移除，失败也不会留下毒化的 promise。
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
 * 把展示树摊平成 skill 列表，保留树里的排序。
 */
function flattenSkillTree(root: TreeNode[]): SkillRef[] {
  const out: SkillRef[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'skill') {
        out.push({ name: node.name, description: node.description, path: node.path })
      } else {
        walk(node.children)
      }
    }
  }
  walk(root)
  return out
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
