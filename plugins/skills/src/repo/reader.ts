/**
 * 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
 *
 * GitHub 仓库与其它 git 远端都先浅克隆到 DSH home 下的缓存目录，再把克隆
 * 目录当本地目录扫描；本地路径直接扫描目录。GitHub 不再调用 API 列树，所有
 * 远端来源都走同一条 git 路径。后面的发现规则与建树只认这个读取抽象，不再
 * 关心来源本身。
 *
 * 刷新克隆（`update: true`）失败时保留旧克隆继续使用，并把失败原因作为
 * `warning` 带回结果，由页面提示；首次克隆失败（含找不到 git）才返回错误。
 *
 * @module @buka/dsh-plugin-skills/repo/reader
 */

import type { GitRunner } from '../git-source.ts'
import { ensureGitClone } from '../git-source.ts'
import { openLocalRepo } from '../local-source.ts'
import type { Homes } from '../skill-store.ts'
import type { RepoOpenResult, RepoOrigin } from './types.ts'

/**
 * GitHub 仓库的 HTTPS 克隆地址。
 *
 * @param owner 仓库 owner
 * @param repo 仓库名
 */
export function githubCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`
}

/**
 * 打开一棵仓库树。
 *
 * 走到这里说明磁盘缓存没有命中（过期，或只有一条轻量探测结论），所以三种来源
 * 都重新读一次最新内容：本地路径重扫目录、远端来源先 `git fetch` 更新克隆
 * （失败时保留旧克隆并带 `warning`）。
 *
 * @param options.origin 规范化来源坐标
 * @param options.homes DSH home（克隆缓存目录在这里）
 * @param options.runGit 可注入的 git runner
 */
export async function openRepo({
  origin,
  homes,
  runGit,
}: {
  origin: RepoOrigin
  homes: Homes
  runGit?: GitRunner | undefined
}): Promise<RepoOpenResult> {
  if (origin.kind === 'local') return openLocalRepo(origin.root)

  const url = origin.kind === 'github' ? githubCloneUrl(origin.owner, origin.repo) : origin.url
  // 只有缓存未命中时才会调用本函数，所以每次读都顺手更新克隆；fetch 失败时
  // `ensureGitClone` 保留旧克隆，离线仍能展开，并把原因作为 warning 带回。
  const cloned = await ensureGitClone({ homes, url, runGit, update: true })
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
    ...(cloned.warning === undefined ? {} : { warning: cloned.warning }),
  }
}
