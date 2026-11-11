/**
 * GitHub 侧的网络读取：仓库树、SKILL.md 原文与请求头。
 *
 * - 树：`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`；
 * - 文件：`https://raw.githubusercontent.com/...`。
 *
 * 网络实现从参数注入（`fetchImpl`），所以本模块可以脱离网络单测；token 的
 * 来源规则见 `resolveToken()`。
 *
 * @module @buka/dsh-plugin-skills/repo/github
 */

import { errorText, failure } from './failure.ts'
import type { RepoSkillsFailure, RepoTreeEntry } from './types.ts'

/** 依次尝试的分支。很多仓库没有 `main`，所以先问 `HEAD`。 */
const BRANCHES = ['HEAD', 'main', 'master']

/** GitHub API 的请求超时。 */
const TREE_TIMEOUT_MS = 10_000

/** raw.githubusercontent.com 上单个文件的请求超时；失败只影响一个节点。 */
const RAW_TIMEOUT_MS = 8_000

/**
 * 解析 token：显式参数优先，缺省时读 `GITHUB_TOKEN` / `GH_TOKEN`；
 * 空串按「没有 token」处理，避免发出空的 Authorization 头。
 *
 * @param provided `fetchRepoSkills` 的 `token` 选项
 */
export function resolveToken(provided: unknown): string | null {
  if (provided !== undefined) {
    if (typeof provided !== 'string') return null
    const text = provided.trim()
    return text === '' ? null : text
  }
  for (const value of [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text !== '') return text
  }
  return null
}

/**
 * 按分支顺序拉取递归树。
 *
 * 404 只意味着这个分支不存在，继续试下一个；403 且额度用尽立即返回
 * `rate-limited`；其它非 2xx、网络异常、JSON 解析失败或没有 `tree` 数组
 * 都直接返回 `fetch-failed`，不再浪费后续分支的请求。
 */
export async function fetchRepoTree({
  owner,
  repo,
  token,
  fetchImpl,
}: {
  owner: string
  repo: string
  token: string | null
  fetchImpl: typeof fetch
}): Promise<
  | { ok: true; ref: string; sha: string; truncated: boolean; tree: RepoTreeEntry[] }
  | RepoSkillsFailure
> {
  for (const branch of BRANCHES) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    let response: Response
    try {
      response = await fetchImpl(url, {
        headers: apiHeaders(token),
        signal: AbortSignal.timeout(TREE_TIMEOUT_MS),
      })
    } catch (error) {
      return failure('fetch-failed', `GitHub tree request failed: ${errorText(error)}`)
    }

    if (response?.status === 404) continue
    if (response?.status === 403 && response.headers?.get('x-ratelimit-remaining') === '0') {
      return failure(
        'rate-limited',
        'GitHub API rate limit exhausted; retry later or set GITHUB_TOKEN.',
      )
    }
    if (!response?.ok) {
      return failure('fetch-failed', `GitHub API returned HTTP ${response?.status ?? 'unknown'}.`)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      return failure('fetch-failed', 'GitHub API returned invalid JSON.')
    }
    const record =
      data !== null && typeof data === 'object'
        ? (data as { sha?: unknown; truncated?: unknown; tree?: unknown })
        : null
    if (record === null || !Array.isArray(record.tree)) {
      return failure('fetch-failed', 'GitHub API tree response is missing the tree array.')
    }
    return {
      ok: true,
      ref: branch,
      sha: typeof record.sha === 'string' ? record.sha : '',
      truncated: record.truncated === true,
      tree: record.tree as RepoTreeEntry[],
    }
  }

  return failure('repo-not-found', 'Repository not found on GitHub (tried HEAD, main and master).')
}

/**
 * GitHub 的 `readFile`：从 raw.githubusercontent.com 取文件原文。
 *
 * 网络异常、超时与任何非 2xx 都返回 null（对调用方就是「这个文件读不到」）：
 * SKILL.md 读不到只影响一个节点的元数据，marketplace 清单读不到则由分类函数
 * 升级成 `fetch-failed`。
 */
export function createGithubReader({
  owner,
  repo,
  ref,
  token,
  fetchImpl,
}: {
  owner: string
  repo: string
  ref: string
  token: string | null
  fetchImpl: typeof fetch
}): (repoPath: string) => Promise<string | null> {
  return async function readFile(repoPath: string): Promise<string | null> {
    const segments = repoPath.split('/').map((segment) => encodeURIComponent(segment))
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${segments.join('/')}`
    try {
      const response = await fetchImpl(url, {
        headers: rawHeaders(token),
        signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
      })
      if (!response?.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }
}

/**
 * GitHub API 请求头。
 */
function apiHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'buka-skills',
  }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * raw.githubusercontent.com 的请求头；带 token 可以访问私有仓库。
 */
function rawHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'buka-skills' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  return headers
}
