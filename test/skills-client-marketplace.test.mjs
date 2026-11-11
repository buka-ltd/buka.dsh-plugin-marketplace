/**
 * 「收藏卡片显示来源类型 / 不可用徽标并自动探测」的回归测试。
 *
 * `client.js` 是浏览器一半（`window.__ModuleLoader__` 模块），仓库里没有浏览器
 * 环境，所以沿用 `test/skills-view-cache.test.mjs` 的源码断言风格，守住几条
 * 容易回归的约定：
 *
 * - 来源是否「可列出 skills」由 `isListableSource()` 判断，与 Host 的
 *   `classifyRepoSource()` 对应：GitHub / 任意 git 地址 / 本地绝对路径可列出，
 *   包名与网页子页面只能收藏、不能展开；
 * - 切到「收藏」Tab 后自动探测每个可列出的收藏，轻量请求带 `probe=1`，
 *   不阻塞列表、不写进 localStorage 的 view cache；
 * - `repo-unavailable` 是正常结论：转成 `kind: 'unavailable'` 的 ready 数据，
 *   卡片显示「不可用」徽标而不是弹错误；其它探测失败静默保留旧徽标；
 * - 徽标文案 key 与 Tag tone、kind 的优先级（展开后的树 > 探测结果）；
 * - 展开不可用仓库时 `treeFailureText` 有专门文案，本机没有 git 时也有；
 * - 顶部「刷新」对所有可列出的收藏强制重探，删除收藏时清理探测状态。
 *
 * `isListableSource()` / `repoUrl()` 是纯字符串函数，直接从源码里抽出来求值，
 * 用行为断言补住来源分类的边界；不需要真实浏览器。
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const CLIENT_BUILD = fileURLToPath(new URL('../.build/skills/client/', import.meta.url))
/**
 * 把源码压成与格式无关的形状：去掉每行缩进、合并连续空行。
 *
 * 这些测试按源码片段定位，而源码会随格式化工具改变缩进与空行，所以定位前
 * 两边都先归一。
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text.replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n')
}

/**
 * 列出编译产物目录下的全部文件（含子目录）。
 *
 * @param {string} dir 目录
 * @returns {string[]}
 */
function clientFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? clientFiles(full) : [full]
  })
}

/**
 * 浏览器一半现在分成多个模块，tsc 每个源文件产出一个 `.js`：按路径排序拼接，
 * 测试仍然按源码片段定位（缩进与空行由 `normalize()` 抹平）。
 *
 * @param {string} dir 编译产物目录
 * @returns {string}
 */
function readClientSource(dir) {
  return clientFiles(dir)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
}

const source = normalize(readClientSource(CLIENT_BUILD))

/**
 * 截取一段源码：从 `start` 标记开始，到它之后第一个 `end` 标记之前。
 *
 * @param {string} start 起始片段
 * @param {string} end 结束片段
 * @returns {string}
 */
function section(start, end) {
  const from = source.indexOf(normalize(start))
  assert.notEqual(from, -1, `源码里找不到：${start}`)
  const to = source.indexOf(normalize(end), from + start.length)
  assert.notEqual(to, -1, `源码里找不到结束标记：${end}`)
  return source.slice(from, to)
}

/**
 * 取出 client.js 里一个顶层函数的源码文本（连同闭合的 `}`）。
 *
 * 界面代码拆成多个模块后，函数不再都与相邻函数在同一个文件里，所以按函数
 * 自身取源码，而不是按「起点到某个后续标记」截取。
 *
 * @param {string} name 函数名
 * @returns {string}
 */
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `源码里找不到函数：${name}`)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`函数 ${name} 没有闭合`)
}

/**
 * 把 client.js 里的一个顶层函数（连同闭合的 `}`）抽出来求值，返回函数本身。
 *
 * 浏览器模块不能直接 import，但 `isListableSource()` / `repoUrl()` 只依赖
 * 字符串与正则，抽出来直接调用能得到真正的行为断言，而不是脆弱的字符串匹配。
 *
 * @param {string} name 函数名
 * @returns {Function}
 */
function loadFunction(name) {
  return new Function(`${functionSource(name)}; return ${name}`)()
}

/**
 * 截取以某个唯一片段为结尾的源码块：从它前面最近的 `start` 标记开始。
 *
 * 自动探测的 `useEffect` 前后都是同形状的 `React.useEffect`，起点写整段条件会
 * 随 tsc 的换行漂移；用唯一的依赖数组当结尾锚点、向前找最近的这个 `useEffect`
 * 更稳。
 *
 * @param {string} start 起点标记
 * @param {string} end 唯一的结尾标记
 * @returns {string}
 */
function blockBefore(start, end) {
  const to = source.indexOf(normalize(end))
  assert.notEqual(to, -1, `源码里找不到：${end}`)
  const from = source.lastIndexOf(normalize(start), to)
  assert.notEqual(from, -1, `源码里找不到：${start}`)
  return source.slice(from, to)
}

test('收藏 Tab 打开后自动探测可列出的收藏，探测请求带 probe=1', () => {
  assert.ok(
    source.includes('const [probes, setProbes] = React.useState({})'),
    '没有探测状态 probes',
  )

  const effect = blockBefore('React.useEffect(() => {', '}, [tab, savedData, probes])')
  assert.match(
    effect,
    /if \(!isListableSource\(repo\.source\)\)\s*\{?\s*continue/u,
    '探测必须只针对可列出 skills 的收藏（GitHub / git 地址 / 本地路径）',
  )
  assert.match(
    effect,
    /if \(probes\[repo\.id\] !== undefined\)\s*\{?\s*continue/u,
    '已经探测过的卡片不该重复发请求',
  )
  assert.ok(effect.includes('probeRepo(repo)'), '收藏 Tab 打开后没有自动探测')

  const probe = section('async function probeRepo(repo, options = {})', '\n\n      /**')
  assert.ok(probe.includes('&probe=1'), '探测请求没有带 probe=1 参数')
  assert.ok(probe.includes('REPO_SKILLS_ROUTE'), '探测没有走 repo-skills 路由')
  assert.ok(probe.includes("refresh ? '&refresh=1' : ''"), '强制探测没有带 refresh=1')
})

test('探测结果不进 localStorage 的收藏页 view cache', () => {
  assert.ok(
    source.includes('writeViewCache({ expandedRepos, collapsedDirs, trees })'),
    '写缓存的入参变了',
  )
  // tsc 产物的解构参数带尾逗号，按函数名定位，尾部交给下一个函数当结束锚点。
  const write = functionSource('writeViewCache')
  assert.ok(!write.includes('probes'), 'probes 是纯页面状态，不该写进 view cache')
  assert.ok(
    !source.includes('React.useState(readViewCache)?.probes'),
    '重启后不该恢复探测状态，重新探测即可',
  )
})

test('repo-unavailable 转成 kind:unavailable 的徽标，而不是错误提示', () => {
  const probe = section('async function probeRepo(repo, options = {})', '\n\n      /**')
  // `repo-unavailable` 走统一的 `errorCode(failure)` 解出，不再直接读 `failure?.code`。
  assert.match(
    probe,
    /if \(errorCode\(failure\) === 'repo-unavailable'\) \{/u,
    '没有单独处理 repo-unavailable',
  )
  assert.ok(
    probe.includes("data: { kind: 'unavailable' }, error: null"),
    'repo-unavailable 必须转成 kind:unavailable 的 ready 数据，才能显示徽标',
  )
  assert.ok(probe.includes("status: 'ready'"), '不可用结论要按 ready 处理，不能是 error')
  assert.ok(!probe.includes('flash('), '探测失败不能弹 Toast 错误')
  assert.ok(probe.includes('prev[repo.id]?.data ?? null'), '其它失败要保留旧徽标数据、静默处理')
  assert.ok(probe.includes("status: 'error'"), '其它失败仍记成 error，但不渲染错误')
})

test('徽标文案 key 与 Tag tone 与规格一致', () => {
  const kindTag = section('function kindTagOf(kind, t)', '\n\n    /**')
  assert.ok(kindTag.includes("case 'npx-skills':"), '缺少 npx-skills 分支')
  assert.ok(
    kindTag.includes("return { text: t('kindNpx'), tone: 'neutral' }"),
    'npx skills 徽标应该是 neutral',
  )
  assert.ok(
    kindTag.includes("case 'claude-code-marketplace':"),
    '缺少 claude-code-marketplace 分支',
  )
  assert.ok(
    kindTag.includes("return { text: t('kindMarketplace'), tone: 'info' }"),
    'Claude Code 市场徽标应该是 info',
  )
  assert.ok(kindTag.includes("case 'unavailable':"), '缺少 unavailable 分支')
  assert.ok(
    kindTag.includes("return { text: t('kindUnavailable'), tone: 'warning' }"),
    '不可用徽标应该是 warning',
  )
  assert.ok(kindTag.includes('default:'), '未知 kind 必须有默认分支')
  assert.ok(kindTag.includes('return null'), '未知 / 加载中不渲染徽标')
})

test('徽标 kind 优先用展开后的树，其次探测结果，标题后已安装标记前渲染', () => {
  assert.ok(
    source.includes('const kind = trees[repo.id]?.data?.kind ?? probes[repo.id]?.data?.kind'),
    '徽标 kind 没有优先取展开后的完整结果',
  )

  const saved = functionSource('renderSaved')
  const badgeAt = saved.indexOf(
    'kindTag === null ? null : h(Tag, { tone: kindTag.tone }, kindTag.text)',
  )
  assert.notEqual(badgeAt, -1, '收藏卡片没有渲染仓库类型徽标')
  assert.ok(saved.indexOf('buka-skills-cardTitle') < badgeAt, '徽标应在来源标题之后')
  assert.ok(badgeAt < saved.indexOf("t('installedBadge')"), '徽标应在已安装标记之前')
})

test('isListableSource 认 GitHub / 任意 git 地址 / 本地绝对路径', () => {
  const isListable = loadFunction('isListableSource')
  for (const value of [
    'vercel-labs/skills',
    'https://github.com/vercel-labs/skills',
    'https://github.com/vercel-labs/skills.git',
    'https://www.github.com/vercel-labs/skills/',
    'https://gitlab.com/group/repo',
    'https://example.com/group/repo.git',
    'ssh://git@github.com/vercel-labs/skills.git',
    'git://gitlab.com/group/repo.git',
    'git@gitlab.com:group/repo.git',
    'git@github.com:vercel-labs/skills',
    '/Users/me/repos/skills',
    'C:\\repos\\skills',
    'C:/repos/skills',
  ]) {
    assert.equal(isListable(value), true, `应能列出 skills：${value}`)
  }
})

test('isListableSource 排除包名与网页子页面', () => {
  const isListable = loadFunction('isListableSource')
  for (const value of [
    'notion',
    '@scope/pkg',
    'https://github.com/vercel-labs/skills/tree/main',
    'https://github.com/vercel-labs/skills/issues',
    'https://github.com/vercel-labs/skills/blob/main/README.md',
    'https://github.com/vercel-labs/skills?tab=readme-ov-file',
    'https://github.com/vercel-labs',
    '../relative/repo',
    'a/b/c',
    'ftp://example.com/repo.git',
    '',
  ]) {
    assert.equal(isListable(value), false, `不应能列出 skills：${value}`)
  }
})

test('收藏列表按 isListableSource 决定展开箭头与树，本地路径 / git 地址也能展开', () => {
  const saved = functionSource('renderSaved')
  assert.ok(
    saved.includes('const listable = isListableSource(repo.source)'),
    '收藏列表必须用 isListableSource 判断能否展开，而不是旧的 GitHub 判断',
  )
  assert.match(
    saved,
    // 归一化只去缩进，tsc 会把三元式拆成 `listable` / `? h('button', {` 两行；
    // `\s*` 同时容忍单行与多行两种排版。
    /listable\s*\?\s*h\(\s*'button',/u,
    '只有可列出的收藏才显示展开箭头',
  )
  assert.ok(
    saved.includes('expanded && listable ? renderTree(repo) : null'),
    '不可列出的收藏不该渲染树',
  )
})

test('repoUrl 只为 GitHub 简写与 http(s) 链接生成可打开链接', () => {
  const repoUrl = loadFunction('repoUrl')
  assert.equal(repoUrl('vercel-labs/skills'), 'https://github.com/vercel-labs/skills')
  assert.equal(repoUrl('https://gitlab.com/group/repo'), 'https://gitlab.com/group/repo')
  assert.equal(repoUrl('https://github.com/o/r/tree/main'), 'https://github.com/o/r/tree/main')
  for (const value of [
    'git@gitlab.com:group/repo.git',
    'ssh://git@github.com/o/r.git',
    'git://gitlab.com/group/repo.git',
    '/Users/me/repos/skills',
    'C:\\repos\\skills',
    'C:/repos/skills',
    'notion',
    '@scope/pkg',
    '',
  ]) {
    assert.equal(repoUrl(value), '', `不该为这个来源猜网页链接：${value}`)
  }
})

test('中英文都补齐了四个文案 key', () => {
  for (const key of ['kindNpx', 'kindMarketplace', 'kindUnavailable', 'treeUnavailable']) {
    const occurrences = source.split(`\n${key}:`).length - 1
    assert.equal(occurrences, 2, `${key} 应该在 en 与 zh 各有一份`)
  }
  assert.ok(source.includes("kindNpx: 'npx skills'"), 'kindNpx 文案不对')
  assert.ok(
    source.includes("kindMarketplace: 'Claude Code marketplace'"),
    '英文 kindMarketplace 文案不对',
  )
  assert.ok(source.includes("kindMarketplace: 'Claude Code 市场'"), '中文 kindMarketplace 文案不对')
  assert.ok(source.includes("kindUnavailable: 'unavailable'"), '英文 kindUnavailable 文案不对')
  assert.ok(source.includes("kindUnavailable: '不可用'"), '中文 kindUnavailable 文案不对')
  assert.ok(
    source.includes(
      "treeUnavailable: 'This repository is neither an npx skills repository nor a Claude Code marketplace.'",
    ),
    '英文 treeUnavailable 文案不对',
  )
  assert.ok(
    source.includes(
      "treeUnavailable: '这个仓库不可用：既不是 npx skills 仓库，也不是 Claude Code marketplace。'",
    ),
    '中文 treeUnavailable 文案不对',
  )
})

test('来源相关文案说明支持任意 git 地址与本地绝对路径', () => {
  for (const key of ['addPlaceholder', 'invalidSource', 'treeUnsupported', 'treeGitUnavailable']) {
    const occurrences = source.split(`\n${key}:`).length - 1
    assert.equal(occurrences, 2, `${key} 应该在 en 与 zh 各有一份`)
  }
  assert.ok(
    source.includes(
      "addPlaceholder: 'owner/repo, a GitHub/GitLab link, a git URL, or an absolute path'",
    ),
    '英文 addPlaceholder 文案不对',
  )
  assert.ok(
    source.includes("addPlaceholder: 'owner/repo、GitHub/GitLab 链接、git 地址或绝对路径'"),
    '中文 addPlaceholder 文案不对',
  )
  assert.ok(source.includes('a local absolute path'), '英文 invalidSource 没有提到本地绝对路径')
  assert.ok(
    source.includes('本地绝对路径、http(s) 链接或包名'),
    '中文 invalidSource 没有提到本地绝对路径',
  )
  assert.ok(
    source.includes('can be saved but not expanded'),
    '英文 invalidSource 没有说明包名不能展开',
  )
  assert.ok(source.includes('包名可以收藏但不能展开'), '中文 invalidSource 没有说明包名不能展开')
  assert.ok(
    source.includes("treeUnsupported: 'Package names and web links cannot list skills.'"),
    '英文 treeUnsupported 文案不对',
  )
  assert.ok(
    source.includes("treeUnsupported: '包名和网页链接不能列出 skills。'"),
    '中文 treeUnsupported 文案不对',
  )
  assert.ok(
    source.includes(
      "treeGitUnavailable: 'Git is not installed or not on PATH, so git repositories cannot be read.'",
    ),
    '英文 treeGitUnavailable 文案不对',
  )
  assert.ok(
    source.includes("treeGitUnavailable: '没有找到 git（不在 PATH 上），无法读取 git 仓库。'"),
    '中文 treeGitUnavailable 文案不对',
  )
})

test('展开不可用仓库时 treeFailureText 显示专门文案', () => {
  const failureText = section('function treeFailureText(t, failure)', '\n\n    /**')
  assert.ok(
    failureText.includes("case 'repo-unavailable':"),
    'treeFailureText 缺少 repo-unavailable 分支',
  )
  assert.ok(
    failureText.includes("return t('treeUnavailable')"),
    'repo-unavailable 没有用 treeUnavailable 文案',
  )
})

test('treeFailureText 认识 git-unavailable，git-failed 走默认分支带 Host message', () => {
  const failureText = section('function treeFailureText(t, failure)', '\n\n    /**')
  assert.ok(
    failureText.includes("case 'git-unavailable':"),
    'treeFailureText 缺少 git-unavailable 分支',
  )
  assert.ok(
    failureText.includes("return t('treeGitUnavailable')"),
    'git-unavailable 没有用 treeGitUnavailable 文案',
  )
  assert.ok(!failureText.includes("case 'git-failed':"), 'git-failed 不需要专门分支，走默认文案')
  assert.ok(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言的正是源码里的模板字符串字面量
    failureText.includes("return `${t('treeFailed')} ${messageOf(failure)}`"),
    'git-failed 应走默认分支带 Host 的 message',
  )
})

test('刷新对所有 listable 收藏强制重探，删除收藏时清理探测状态', () => {
  const reload = section('function reload()', '\n\n      /**')
  // tsc 会把单行 `if (...) probeRepo(...)` 拆成两行，按「条件 + 调用」匹配。
  assert.match(
    reload,
    /if \(isListableSource\(repo\.source\)\)\s*\{?\s*probeRepo\(repo, \{ refresh: true \}\)/u,
    '顶部「刷新」没有对所有可列出的收藏强制探测',
  )
  assert.ok(reload.includes('expandedRepos[repo.id] === true'), '刷新时仍应强制刷新已展开仓库的树')
  assert.ok(source.includes('setProbes(prune)'), '删除收藏时没有清理 probes')
})
