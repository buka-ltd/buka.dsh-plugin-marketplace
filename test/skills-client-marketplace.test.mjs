/**
 * 「收藏卡片显示仓库类型 / 不可用徽标并自动探测」的回归测试。
 *
 * `client.js` 是浏览器一半（`window.__ModuleLoader__` 模块），仓库里没有浏览器
 * 环境，所以沿用 `test/skills-view-cache.test.mjs` 的源码断言风格，守住几条
 * 容易回归的约定：
 *
 * - 切到「收藏」Tab 后自动探测每个 GitHub 收藏，轻量请求带 `probe=1`，
 *   不阻塞列表、不写进 localStorage 的 view cache；
 * - `repo-unavailable` 是正常结论：转成 `kind: 'unavailable'` 的 ready 数据，
 *   卡片显示「不可用」徽标而不是弹错误；其它探测失败静默保留旧徽标；
 * - 徽标文案 key 与 Tag tone、kind 的优先级（展开后的树 > 探测结果）；
 * - 展开不可用仓库时 `treeFailureText` 有专门文案；
 * - 顶部「刷新」对所有可列出的收藏强制重探，删除收藏时清理探测状态。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const PACKAGE_ROOT = new URL('../plugins/skills/', import.meta.url)
const source = readFileSync(new URL('client.js', PACKAGE_ROOT), 'utf8')

/**
 * 截取一段源码：从 `start` 标记开始，到它之后第一个 `end` 标记之前。
 *
 * @param {string} start 起始片段
 * @param {string} end 结束片段
 * @returns {string}
 */
function section(start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `源码里找不到：${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.notEqual(to, -1, `源码里找不到结束标记：${end}`)
  return source.slice(from, to)
}

test('收藏 Tab 打开后自动探测 GitHub 收藏，探测请求带 probe=1', () => {
  assert.ok(source.includes('const [probes, setProbes] = React.useState({})'), '没有探测状态 probes')

  const effect = section(
    "React.useEffect(() => {\n        if (tab !== 'repos' || savedData === null) return",
    '}, [tab, savedData, probes])',
  )
  assert.ok(
    effect.includes('if (!isGitHubRepo(repo.source)) continue'),
    '探测必须只针对可列出 skills 的 GitHub 收藏',
  )
  assert.ok(
    effect.includes('if (probes[repo.id] !== undefined) continue'),
    '已经探测过的卡片不该重复发请求',
  )
  assert.ok(effect.includes('probeRepo(repo)'), '收藏 Tab 打开后没有自动探测')

  const probe = section('async function probeRepo(repo, options = {})', '\n\n      /**')
  assert.ok(probe.includes('&probe=1'), '探测请求没有带 probe=1 参数')
  assert.ok(probe.includes('REPO_SKILLS_ROUTE'), '探测没有走 repo-skills 路由')
  assert.ok(probe.includes('refresh ? \'&refresh=1\' : \'\''), '强制探测没有带 refresh=1')
})

test('探测结果不进 localStorage 的收藏页 view cache', () => {
  assert.ok(source.includes('writeViewCache({ expandedRepos, collapsedDirs, trees })'), '写缓存的入参变了')
  const write = section(
    'function writeViewCache({ expandedRepos, collapsedDirs, trees })',
    '\n\n    /**',
  )
  assert.ok(!write.includes('probes'), 'probes 是纯页面状态，不该写进 view cache')
  assert.ok(
    !source.includes('React.useState(readViewCache)?.probes'),
    '重启后不该恢复探测状态，重新探测即可',
  )
})

test('repo-unavailable 转成 kind:unavailable 的徽标，而不是错误提示', () => {
  const probe = section('async function probeRepo(repo, options = {})', '\n\n      /**')
  assert.ok(probe.includes("if (failure?.code === 'repo-unavailable') {"), '没有单独处理 repo-unavailable')
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
  assert.ok(kindTag.includes("case 'claude-code-marketplace':"), '缺少 claude-code-marketplace 分支')
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

  const saved = source.slice(source.indexOf('function renderSaved()'), source.indexOf('const activeTab'))
  const badgeAt = saved.indexOf('kindTag === null ? null : h(Tag, { tone: kindTag.tone }, kindTag.text)')
  assert.notEqual(badgeAt, -1, '收藏卡片没有渲染仓库类型徽标')
  assert.ok(saved.indexOf('buka-skills-cardTitle') < badgeAt, '徽标应在来源标题之后')
  assert.ok(badgeAt < saved.indexOf("t('installedBadge')"), '徽标应在已安装标记之前')
})

test('中英文都补齐了四个文案 key', () => {
  for (const key of ['kindNpx', 'kindMarketplace', 'kindUnavailable', 'treeUnavailable']) {
    const occurrences = source.split(`\n      ${key}:`).length - 1
    assert.equal(occurrences, 2, `${key} 应该在 en 与 zh 各有一份`)
  }
  assert.ok(source.includes("kindNpx: 'npx skills'"), 'kindNpx 文案不对')
  assert.ok(source.includes("kindMarketplace: 'Claude Code marketplace'"), '英文 kindMarketplace 文案不对')
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

test('展开不可用仓库时 treeFailureText 显示专门文案', () => {
  const failureText = section('function treeFailureText(t, failure)', '\n\n    /**')
  assert.ok(failureText.includes("case 'repo-unavailable':"), 'treeFailureText 缺少 repo-unavailable 分支')
  assert.ok(failureText.includes("return t('treeUnavailable')"), 'repo-unavailable 没有用 treeUnavailable 文案')
})

test('刷新对所有 listable 收藏强制重探，删除收藏时清理探测状态', () => {
  const reload = section('function reload()', '\n\n      /**')
  assert.ok(
    reload.includes('if (isGitHubRepo(repo.source)) probeRepo(repo, { refresh: true })'),
    '顶部「刷新」没有对所有可列出的收藏强制探测',
  )
  assert.ok(reload.includes('expandedRepos[repo.id] === true'), '刷新时仍应强制刷新已展开仓库的树')
  assert.ok(source.includes('setProbes(prune)'), '删除收藏时没有清理 probes')
})
