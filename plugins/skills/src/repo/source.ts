/**
 * 来源字符串 → 可列出的来源坐标。
 *
 * 判定顺序由 `repo-store.ts` 的 `classifyRepoSource()` 决定；这里只负责把判定
 * 结果里的 GitHub 来源继续解析成 `owner/repo`，并给展示树提供来源的展示名。
 *
 * @module @buka/dsh-plugin-skills/repo/source
 */

import path from 'node:path'

import { MAX_SOURCE_LENGTH } from '../repo-store.ts'
import type { RepoOrigin } from './types.ts'

/** GitHub 用户名/组织名的粗略校验（足够挡住路径与作用域包名）。 */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** GitHub 仓库名的粗略校验。 */
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/u

/**
 * 从任意来源字符串里取出 GitHub 仓库。
 *
 * 接受 `owner/repo`、`github.com/owner/repo` 与 `https://github.com/owner/repo`
 * （可带 `www.`、`.git` 与结尾斜杠，GitHub 子页面链接按前两段取仓库）。
 * 作用域 npm 包（`@scope/pkg`）、普通包名（`notion`）与其它站点的链接返回 null。
 *
 * @param source 任意来源字符串
 */
export function githubRepoOf(source: unknown): { owner: string; repo: string } | null {
  if (typeof source !== 'string') return null
  const text = source.trim()
  if (text === '' || text.length > MAX_SOURCE_LENGTH) return null

  if (/^https?:\/\//iu.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null
    return splitRepo(url.pathname)
  }

  const bare = /^(?:www\.)?github\.com\/(.+)$/iu.exec(text)
  if (bare !== null) return splitRepo(bare[1] ?? '')

  if (text.split('/').length !== 2) return null
  return splitRepo(text)
}

/**
 * 从 `owner/repo[/...]` 里取前两段并校验；末尾的 `.git` 去掉。
 */
function splitRepo(text: string): { owner: string; repo: string } | null {
  const segments = text.split('/').filter((segment) => segment !== '')
  const owner = segments[0]
  const repo = segments[1]
  if (owner === undefined || repo === undefined) return null
  const normalizedRepo = repo.toLowerCase().endsWith('.git') ? repo.slice(0, -4) : repo
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(normalizedRepo)) return null
  return { owner, repo: normalizedRepo }
}

/**
 * 来源的展示名：只给根目录 SKILL.md 的节点名兜底（没有 frontmatter name 时）。
 */
export function originName(origin: RepoOrigin): string {
  if (origin.kind === 'github') return origin.repo
  if (origin.kind === 'local') {
    const base = path.basename(origin.root)
    return base === '' ? origin.root : base
  }
  // git 地址取最后一段：`.../group/repo.git` 与 `git@host:group/repo.git` 都适用。
  const stripped = origin.url.replace(/\/+$/u, '').replace(/\.git$/iu, '')
  const parts = stripped.split(/[/:]/u).filter((part) => part !== '')
  const segment = parts.at(-1)
  return segment === undefined ? origin.url : segment
}
