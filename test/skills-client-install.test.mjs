/**
 * 「收藏仓库的 skills 树里一键安装单个 skill」的回归测试。
 *
 * `client.js` 是浏览器一半（`window.__ModuleLoader__` 模块），仓库里没有浏览器
 * 环境，所以沿用 `test/skills-client-marketplace.test.mjs` 的源码断言风格，
 * 守住几条容易回归的约定：
 *
 * - 安装走 Host 路由 `POST /buka-skills/install`，请求体只传来源与仓库里的路径，
 *   名字与是否存在由 Host 的仓库列表决定；
 * - skill 叶子右侧：未安装显示「安装」按钮，安装中显示状态点，已安装显示禁用的
 *   「已安装」按钮（与安装按钮同一操作位，外形一致但不可点）；
 * - 已安装按 `npx skills` 的目录名规则归一后与全局安装列表比较，不看来源；
 * - 安装成功只重读「已安装」列表，不重建仓库树；失败用 Toast 提示。
 *
 * `skillKeyOf()` 是纯字符串函数，直接从源码里抽出来求值，用行为断言补住边界。
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

/**
 * 把 client.js 里的一个顶层函数抽出来求值，返回函数本身。
 *
 * @param {string} name 函数名
 * @returns {Function}
 */
function loadFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `源码里找不到函数：${name}`)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        const body = source.slice(start, index + 1)
        return new Function(`${body}; return ${name}`)()
      }
    }
  }
  assert.fail(`函数 ${name} 没有闭合`)
}

test('安装走独立的 Host 路由，与卸载分开', () => {
  assert.ok(source.includes("const INSTALL_ROUTE = '/buka-skills/install'"), '缺少安装路由常量')
  const install = section('async function installSkill(repo, node)', '\n\n      /**')
  assert.ok(install.includes('requestJson(INSTALL_ROUTE, {'), '安装没有请求 Host 的安装路由')
  assert.ok(install.includes("method: 'POST'"), '安装必须是 POST')
  assert.ok(
    install.includes('JSON.stringify({ source: repo.source, path: node.path })'),
    '请求体只该带来源与仓库里的 SKILL.md 路径，名字交给 Host 判断',
  )
  assert.ok(!install.includes('skill:'), '浏览器不该自己决定要安装的名字')
})

test('skill 叶子的三种状态：安装按钮 / 安装中 / 已安装的禁用按钮', () => {
  const tree = section('function renderTreeNode(repo, node)', '\n      /**')
  assert.ok(tree.includes('const installed = installedSkillKeys.has(skillKeyOf(node.name))'), '没有按目录键判断已安装')
  assert.ok(tree.includes('const busy = installing === installKeyOf(repo, node)'), '没有按组合键判断安装中')
  assert.ok(tree.includes("icon: h(IconDownloadOutlineRegular, { size: 13 })"), '安装按钮没有下载图标')
  assert.ok(tree.includes("onClick: () => installSkill(repo, node)"), '安装按钮没有触发安装')
  assert.ok(tree.includes('disabled: installing !== null'), '安装请求进行中应禁用其它安装按钮')
  // 已安装的分支在「安装中」之前：它应该是一个禁用的按钮，不是 Tag。
  const installedBranch = tree.slice(tree.indexOf("className: 'buka-skills-treeSkillAction'"), tree.indexOf(': busy'))
  assert.ok(installedBranch.includes("h(IconCheckOutlineRegular, { size: 13 })"), '已安装按钮没有对勾图标')
  assert.ok(installedBranch.includes("t('installedBadge')"), '已安装按钮应显示「已安装」文案')
  assert.ok(installedBranch.includes('disabled: true'), '已安装应显示禁用的按钮')
  assert.ok(installedBranch.includes("variant: 'outline'"), '已安装按钮应与安装按钮同款（outline）')
  assert.ok(installedBranch.includes("size: 'sm'"), '已安装按钮应与安装按钮同尺寸（sm）')
  assert.ok(!installedBranch.includes('h(Tag'), '已安装不该再用 Tag 显示')
  assert.ok(tree.includes("t('installing')"), '安装中应显示「安装中…」')
  assert.ok(tree.includes("t('install')"), '未安装应显示「安装」')
  assert.ok(tree.includes("className: 'buka-skills-treeSkillAction'"), '缺少右侧操作区')
  assert.ok(tree.includes("className: 'buka-skills-treeSkillMain'"), '名称与描述应包在左侧主区里')
})

test('skillKeyOf 与 npx skills 的目录名规则一致（页面据此认已安装）', () => {
  const skillKeyOf = loadFunction('skillKeyOf')
  const cases = new Map([
    ['Web Design Guidelines', 'web-design-guidelines'],
    ['Convex Best Practices', 'convex-best-practices'],
    ['My_Skill.v2', 'my_skill.v2'],
    ['../etc', 'etc'],
    ['---', ''],
    ['', ''],
    [undefined, ''],
  ])
  for (const [input, expected] of cases) assert.equal(skillKeyOf(input), expected, String(input))
  assert.equal(skillKeyOf('x'.repeat(300)).length, 255)
})

test('已安装键集合来自全局列表的 id 与 name，按 npx 规则归一', () => {
  const memo = section('const installedSkillKeys = React.useMemo(', '}, [installedData])')
  assert.ok(memo.includes('for (const skill of skills)'), '没有遍历全局已安装列表')
  assert.ok(memo.includes('for (const value of [skill.id, skill.name])'), '应同时用目录名与展示名匹配')
  assert.ok(memo.includes('const key = skillKeyOf(value)'), '没有按目录名规则归一')
  assert.ok(memo.includes('if (key !== \'\') keys.add(key)'), '空键不该进集合')
})

test('安装成功只刷新已安装列表并弹 Toast；失败用页面底部 Toast', () => {
  const install = section('async function installSkill(repo, node)', '\n\n      /**')
  assert.ok(install.includes("flash('success', `${t('installedToast')} ${body.name ?? node.name}`)"), '成功提示文案不对')
  assert.ok(install.includes('await refreshInstalled()'), '安装成功后没有刷新已安装列表')
  assert.ok(install.includes("failure?.code === 'skill-not-found'"), 'skill 列表变化应有专门提示')
  assert.ok(install.includes("flash('error', text)"), '失败应弹 Toast')
  assert.ok(install.includes('setInstalling(installKeyOf(repo, node))'), '没有记录安装中的行')
  assert.ok(install.includes('setInstalling(null)'), '安装结束后没有清理状态')
  assert.ok(!install.includes('loadTree(repo'), '安装成功不该重建仓库树')

  const refresh = section('async function refreshInstalled()', '\n\n      /**')
  assert.ok(refresh.includes('requestJson(LIST_ROUTE)'), '没有重读已安装列表')
  assert.ok(refresh.includes('setInstalled({ data: body, error: null, loading: false })'), '没有更新已安装状态')
})

test('安装中/已完成的状态不写进 localStorage 的 view cache', () => {
  // 缓存只收展开状态、收起目录与树；安装状态与「已安装」标记都来自 Host。
  assert.ok(
    source.includes('writeViewCache({ expandedRepos, collapsedDirs, trees })'),
    'writeViewCache 的参数里混进了安装状态',
  )
  assert.ok(
    !source.includes('writeViewCache({ expandedRepos, collapsedDirs, trees, installing })'),
    '安装状态是纯页面状态，不该写进 view cache',
  )
  assert.ok(
    !source.includes('useState(restored?.installing'),
    '重启后不该恢复安装中的状态',
  )
})

test('中英文都补齐了安装相关文案', () => {
  for (const key of ['install', 'installing', 'installedToast', 'installFailed', 'installMissing']) {
    const occurrences = source.split(`\n      ${key}:`).length - 1
    assert.equal(occurrences, 2, `${key} 应该在 en 与 zh 各有一份`)
  }
  assert.ok(source.includes("install: 'Install'"), '英文 install 文案不对')
  assert.ok(source.includes("install: '安装'"), '中文 install 文案不对')
  assert.ok(source.includes("installing: 'Installing…'"), '英文 installing 文案不对')
  assert.ok(source.includes("installing: '安装中…'"), '中文 installing 文案不对')
  assert.ok(source.includes("installedToast: 'Installed:'"), '英文 installedToast 文案不对')
  assert.ok(source.includes("installedToast: '已安装：'"), '中文 installedToast 文案不对')
  assert.ok(source.includes("installFailed: 'Install failed:'"), '英文 installFailed 文案不对')
  assert.ok(source.includes("installFailed: '安装失败：'"), '中文 installFailed 文案不对')
})

test('树 skill 行改成左右布局，操作区在右侧', () => {
  assert.ok(
    source.includes('.buka-skills-treeSkill{min-width:0;border-radius:var(--dsw-radius-sm);flex-direction:row;'),
    '树 skill 行应改回横向布局',
  )
  assert.ok(source.includes('.buka-skills-treeSkillMain{'), '缺少左侧主区样式')
  assert.ok(source.includes('.buka-skills-treeSkillAction{'), '缺少右侧操作区样式')
})
