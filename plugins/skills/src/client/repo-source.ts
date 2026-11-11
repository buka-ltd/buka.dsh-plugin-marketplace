/**
 * 收藏来源的展示与分类判断。
 *
 * 只做纯字符串判断：是否可打开网页、是否能让 Host 去列 skills。真正的来源
 * 分类在 Host 的 `repo-store.ts`，这里只按同一套规则给页面做即时反馈。
 *
 * @module @buka/dsh-plugin-skills/client/repo-source
 */

/**
 * 把各种 npx 来源写法收敛成可比较的键：`https://github.com/a/b.git`、
 * `github.com/a/b` 与 `a/b` 都是 `a/b`。Host 写进收藏文件的 `id` 也是
 * 这个键的小写形式，所以可以直接用来判断「收藏的仓库是否已安装」。
 *
 * @param value 来源或来源链接
 * @returns 小写键与用于展示的文本
 */
function normalizeRepo(value: unknown): { key: string; label: string } {
  if (typeof value !== 'string') return { key: '', label: '' }
  const text = value.trim()
  if (text === '') return { key: '', label: '' }
  const label = text
    .replace(/^https?:\/\/(?:www\.)?github\.com\//iu, '')
    .replace(/^github\.com\//iu, '')
    .replace(/\.git$/iu, '')
    .replace(/\/+$/u, '')
  return { key: label.toLowerCase(), label }
}

/**
 * 展示用的来源文本；非字符串返回空串。
 */
function repoLabel(value: unknown): string {
  return normalizeRepo(value).label
}

/**
 * 收藏项对应的可打开链接：GitHub 仓库拼成网页地址，http(s) 来源原样使用；
 * ssh/git 地址、SCP 形式、本地绝对路径与包名都没有可打开的网页（标题显示
 * 为纯文本，不猜链接），返回空串。
 *
 * @param source 已规范化的来源
 */
function repoUrl(source: string): string {
  if (typeof source !== 'string' || source === '') return ''
  if (/^https?:\/\//iu.test(source)) return source
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u.test(source)) {
    return `https://github.com/${source}`
  }
  return ''
}

/**
 * 这个来源能不能让 Host 去列 skills，与 Host `repo-store.js` 的
 * `classifyRepoSource()` 对应：`github`、`git`、`local` 三种可以列出，
 * `web`、`package` 只能当书签。
 *
 * 能列出的写法：GitHub 的 `owner/repo`、GitHub 以外的任意 http(s) 链接、
 * `ssh://` / `git://` 地址、SCP 形式（`git@host:path`）、POSIX 绝对路径
 * 与 Windows 绝对路径；npm 包名（`notion`、`@scope/pkg`）和 GitHub 子页面
 * （如 `https://github.com/o/r/tree/main`）照样能收藏，只是没有可展开的树。
 *
 * @param source 已规范化的来源
 */
function isListableSource(source: unknown): boolean {
  const text = typeof source === 'string' ? source.trim() : ''
  if (text === '') return false
  // GitHub 网页链接：只有仓库根本身（`/owner/repo`，可带 `.git` 与结尾斜杠）
  // 能列出；`/tree/...` 之类的子页面、带查询串的链接在 Host 侧归为 `web`。
  if (/^https?:\/\/(?:www\.)?github\.com\//iu.test(text)) {
    return /^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/iu.test(
      text.replace(/\/+$/u, ''),
    )
  }
  // 其它 http(s) 链接与显式的 git 协议都按 git 远端处理。
  if (/^(?:https?|ssh|git):\/\//iu.test(text)) return true
  // 本地绝对路径：POSIX `/…`、Windows 盘符 `C:\` / `C:/` 与 UNC 路径。
  if (/^\//u.test(text) || /^[A-Za-z]:[\\/]/u.test(text) || /^\\\\[^\\]+\\/u.test(text)) return true
  // SCP 形式 `[user@]host:path`；盘符已在上面排除，避免把 `C:` 当主机名。
  if (/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]+:(?!\/\/)\S+$/u.test(text)) return true
  // GitHub `owner/repo`（Host 把它规范化成这个形式）。
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u.test(text)
}

export { isListableSource, normalizeRepo, repoLabel, repoUrl }
