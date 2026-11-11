/**
 * 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
 *
 * GitHub 用 API 拉树、raw.githubusercontent.com 读文件；git 来源先浅克隆到缓存
 * 目录再当本地目录扫描；本地来源直接扫描目录。后面的发现规则、分类与建树只认
 * 这个读取抽象，不再关心来源本身。
 *
 * @module @buka/dsh-plugin-skills/repo/reader
 */

import type { GitRunner } from '../git-source.ts'
import { ensureGitClone } from '../git-source.ts'
import { openLocalRepo } from '../local-source.ts'
import type { Homes } from '../skill-store.ts'
import { createGithubReader, fetchRepoTree } from './github.ts'
import type { RepoOpenResult, RepoOrigin } from './types.ts'

/**
 * 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
 *
 * GitHub 用 API 拉树、raw.githubusercontent.com 读文件；git 来源先浅克隆到缓存
 * 目录再当本地目录扫描；本地来源直接扫描目录。
 *
 * 走到这里说明磁盘缓存没有命中（过期，或只有一条轻量探测结论），所以三种来源
 * 都重新读一次最新内容：GitHub 重拉 tree、本地路径重扫目录、git 来源先
 * `git fetch` 更新克隆（离线时 `ensureGitClone` 保留旧克隆）。
 */
export async function openRepo({
  origin,
  fetchImpl,
  token,
  homes,
  runGit,
}: {
  origin: RepoOrigin
  fetchImpl: typeof fetch
  token: string | null
  homes: Homes
  runGit?: GitRunner | undefined
}): Promise<RepoOpenResult> {
  if (origin.kind === 'github') {
    const tree = await fetchRepoTree({ owner: origin.owner, repo: origin.repo, token, fetchImpl })
    if (!tree.ok) return tree
    return {
      ok: true,
      ref: tree.ref,
      sha: tree.sha,
      truncated: tree.truncated,
      tree: tree.tree,
      readFile: createGithubReader({
        owner: origin.owner,
        repo: origin.repo,
        ref: tree.ref,
        token,
        fetchImpl,
      }),
    }
  }

  if (origin.kind === 'local') return openLocalRepo(origin.root)

  // 只有缓存未命中时才会调用本函数，所以每次读都顺手更新克隆；fetch 失败时
  // `ensureGitClone` 保留旧克隆，离线仍能展开。
  const cloned = await ensureGitClone({ homes, url: origin.url, runGit, update: true })
  if (!cloned.ok) return cloned
  const opened = await openLocalRepo(cloned.dir)
  if (!opened.ok) return opened
  return {
    ok: true,
    // 克隆目录是某个提交的工作区快照；ref 固定写 HEAD，sha 来自 rev-parse。
    ref: 'HEAD',
    sha: cloned.sha,
    truncated: opened.truncated,
    tree: opened.tree,
    readFile: opened.readFile,
  }
}
