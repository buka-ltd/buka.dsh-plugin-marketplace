/**
 * 「收藏仓库的 skills 树里一键安装单个 skill」的回归测试。
 *
 * `client.js` 是浏览器一半（`window.__ModuleLoader__` 模块），仓库里没有浏览器
 * 环境，所以沿用 `test/skills-client-marketplace.test.mjs` 的源码断言风格，
 * 守住几条容易回归的约定：
 *
 * - 安装走 Host 路由 `POST /buka-skills/install`，请求体只传来源与仓库里的路径，
 *   名字与是否存在由 Host 的仓库列表决定；
 * - skill 叶子右侧固定三个入口：「全局安装」「安装到打工人」「安装到工作区」；
 * - 只有全局入口在已安装时变成禁用的「全局已安装」按钮，全局安装中显示状态点；
 * - 已安装按 `npx skills` 的目录名规则归一后与全局安装列表比较，不看来源；
 * - 安装成功只重读「已安装」列表，不重建仓库树；失败用 Toast 提示；
 * - 打工人 / 工作区先读目标列表，确认后带 `target` 请求同一条安装路由。
 *
 * `skillKeyOf()` 是纯字符串函数，直接从源码里抽出来求值，用行为断言补住边界。
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

test('skill 叶子：全局安装 / 安装到打工人 / 安装到工作区三个入口', () => {
  const tree = section(
    'function renderTreeNode(repo, node)',
    'return { renderTree, renderTreeNode }',
  )
  assert.ok(
    tree.includes('const installed = installedSkillKeys.has(skillKeyOf(node.name))'),
    '没有按目录键判断全局已安装',
  )
  assert.ok(
    tree.includes('const busy = installing === installKeyOf(repo, node)'),
    '没有按组合键判断安装中',
  )
  assert.ok(
    tree.includes('icon: h(IconDownloadOutlineRegular, { size: 13 })'),
    '全局安装按钮没有下载图标',
  )
  assert.ok(tree.includes('onClick: () => installSkill(repo, node)'), '全局安装按钮没有触发安装')
  assert.ok(
    tree.includes('disabled: installing !== null || targetInstalling'),
    '有安装请求进行中时应禁用安装按钮',
  )
  // 已安装的分支在「安装中」之前：它应该是一个禁用的按钮，不是 Tag。
  const installedBranch = tree.slice(
    tree.indexOf("className: 'buka-skills-treeSkillAction'"),
    tree.indexOf(': busy'),
  )
  assert.ok(
    installedBranch.includes('h(IconCheckOutlineRegular, { size: 13 })'),
    '全局已安装按钮没有对勾图标',
  )
  assert.ok(
    installedBranch.includes("t('installedBadgeGlobal')"),
    '全局已安装按钮应显示「全局已安装」文案',
  )
  assert.ok(installedBranch.includes('disabled: true'), '全局已安装应显示禁用的按钮')
  assert.ok(
    installedBranch.includes("variant: 'outline'"),
    '全局已安装按钮应与安装按钮同款（outline）',
  )
  assert.ok(installedBranch.includes("size: 'sm'"), '全局已安装按钮应与安装按钮同尺寸（sm）')
  assert.ok(!installedBranch.includes('h(Tag'), '已安装不该再用 Tag 显示')
  assert.ok(tree.includes("t('installing')"), '安装中应显示「安装中…」')
  assert.ok(tree.includes("t('installGlobal')"), '未安装应显示「全局安装」')
  assert.ok(tree.includes("t('installWorker')"), '缺少「安装到打工人」入口')
  assert.ok(tree.includes("t('installWorkspace')"), '缺少「安装到工作区」入口')
  assert.ok(
    tree.includes("openTargetDialog('worker', repo, node)"),
    '「安装到打工人」没有打开目标选择框',
  )
  assert.ok(
    tree.includes("openTargetDialog('workspace', repo, node)"),
    '「安装到工作区」没有打开目标选择框',
  )
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
  assert.ok(
    memo.includes('for (const value of [skill.id, skill.name])'),
    '应同时用目录名与展示名匹配',
  )
  assert.ok(memo.includes('const key = skillKeyOf(value)'), '没有按目录名规则归一')
  // 守卫语句会被 tsc 拆成两行（`if (...) {` 块也可能换行），只按「条件 + 动作」
  // 的单行正则定位，不依赖大括号与换行位置。
  assert.match(memo, /if \(key !== ''\)\s*\{?\s*keys\.add\(key\)/u, '空键不该进集合')
})

test('安装成功只刷新已安装列表并弹 Toast；失败用页面底部 Toast', () => {
  const install = section('async function installSkill(repo, node)', '\n\n      /**')
  assert.ok(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言的正是源码里的模板字符串字面量
    install.includes("flash('success', `${t('installedToast')} ${body.name ?? node.name}`)"),
    '成功提示文案不对',
  )
  assert.ok(install.includes('await refreshInstalled()'), '安装成功后没有刷新已安装列表')
  // `skill-not-found` 现在由 `errorCode(failure)` 解出（与其它路由失败的处理统一）。
  assert.match(install, /errorCode\(failure\) === 'skill-not-found'/u, 'skill 列表变化应有专门提示')
  assert.ok(install.includes("flash('error', text)"), '失败应弹 Toast')
  assert.ok(install.includes('setInstalling(installKeyOf(repo, node))'), '没有记录安装中的行')
  assert.ok(install.includes('setInstalling(null)'), '安装结束后没有清理状态')
  assert.ok(!install.includes('loadTree(repo'), '安装成功不该重建仓库树')

  const refresh = section('async function refreshInstalled()', '\n\n      /**')
  assert.ok(refresh.includes('requestJson(LIST_ROUTE)'), '没有重读已安装列表')
  assert.ok(
    refresh.includes('setInstalled({ data: body, error: null, loading: false })'),
    '没有更新已安装状态',
  )
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
  assert.ok(!source.includes('useState(restored?.installing'), '重启后不该恢复安装中的状态')
})

test('中英文词典键完全一致，安装相关文案齐全', () => {
  const dictionary = normalize(readFileSync(path.join(CLIENT_BUILD, 'dictionary.js'), 'utf8'))
  const en = dictionary.slice(dictionary.indexOf('const en = {'), dictionary.indexOf('const zh ='))
  const zh = dictionary.slice(dictionary.indexOf('const zh ='), dictionary.indexOf('export {'))
  const keysOf = (block) =>
    [...block.matchAll(/^([A-Za-z0-9_]+):/gmu)].map((match) => match[1]).sort()
  assert.deepEqual(keysOf(zh), keysOf(en), 'en 与 zh 的键必须完全相同')
  for (const key of [
    'installedBadgeGlobal',
    'installGlobal',
    'installWorker',
    'installWorkspace',
    'installing',
    'installedToast',
    'installFailed',
    'installMissing',
    'targetWorkerTitle',
    'targetWorkspaceTitle',
    'targetLoading',
    'targetLoadFailed',
    'targetEmptyWorkers',
    'targetEmptyWorkspaces',
    'targetWorkersUnavailable',
    'targetWorkspacesUnavailable',
    'targetInstall',
    'targetInstalling',
    'installedToWorker',
    'installedToWorkspace',
  ]) {
    assert.ok(keysOf(en).includes(key), `缺少英文文案：${key}`)
  }
  assert.ok(source.includes("installGlobal: 'Install globally'"), '英文 installGlobal 文案不对')
  assert.ok(source.includes("installGlobal: '全局安装'"), '中文 installGlobal 文案不对')
  assert.ok(source.includes("installedBadgeGlobal: 'Installed globally'"), '英文全局已安装文案不对')
  assert.ok(source.includes("installedBadgeGlobal: '全局已安装'"), '中文全局已安装文案不对')
  assert.ok(source.includes("targetInstalling: 'Installing…'"), '英文 targetInstalling 文案不对')
  assert.ok(source.includes("targetInstalling: '安装中…'"), '中文 targetInstalling 文案不对')
})

test('安装到打工人 / 工作区：先读目标列表，确认后带 target 请求 Host', () => {
  assert.ok(source.includes("const TARGETS_ROUTE = '/buka-skills/targets'"), '缺少目标列表路由常量')
  const load = section('async function loadTargets(kind)', 'function openTargetDialog(')
  assert.ok(load.includes('requestJson(TARGETS_ROUTE)'), '没有读取目标列表')
  assert.ok(load.includes('setTargets('), '没有记录目标列表状态')

  const open = section('function openTargetDialog(kind, repo, node)', 'function resetTargetDialog(')
  assert.ok(open.includes('setTargetDialog({ kind, repo, node })'), '没有打开目标对话框')
  assert.ok(open.includes("setTargetChoice('')"), '打开对话框时没有清空上一次的选择')
  assert.ok(open.includes('loadTargets(kind)'), '打开对话框时没有读取目标列表')

  const install = section('async function installToTarget()', 'function openSaveDialog()')
  assert.ok(install.includes('requestJson(INSTALL_ROUTE, {'), '没有请求 Host 的安装路由')
  assert.ok(install.includes('target: kind'), '请求体没有带安装目标')
  assert.ok(install.includes('worker: choice'), '打工人目标没有带名字')
  assert.ok(install.includes('workspace: choice'), '工作区目标没有带路径')
  assert.ok(install.includes("'installedToWorker'"), '缺少安装到打工人的成功文案')
  assert.ok(install.includes("'installedToWorkspace'"), '缺少安装到工作区的成功文案')
  assert.ok(install.includes('setTargetError(text)'), '失败应留在对话框里提示')
  assert.ok(!install.includes('refreshInstalled()'), '项目级安装不该刷新全局已安装列表')
})

test('目标选择对话框复用基座 Modal，并列出可选目标', () => {
  assert.ok(source.includes('renderTargetDialog'), '页面没有渲染目标对话框')
  assert.ok(source.includes("'targetWorkerTitle'"), '缺少打工人对话框标题')
  assert.ok(source.includes("'targetWorkspaceTitle'"), '缺少工作区对话框标题')
  assert.ok(source.includes('targetItemsOf(kind, targets.data)'), '没有取目标条目')
  assert.ok(source.includes("'aria-pressed': selected"), '目标选项没有单选语义')
  assert.ok(source.includes('setChoice(key)'), '点击目标没有更新选择')
})

test('树 skill 行改成左右布局，操作区在右侧', () => {
  assert.ok(
    source.includes(
      '.buka-skills-treeSkill{min-width:0;border-radius:var(--dsw-radius-sm);flex-direction:row;',
    ),
    '树 skill 行应改回横向布局',
  )
  assert.ok(source.includes('.buka-skills-treeSkillMain{'), '缺少左侧主区样式')
  assert.ok(source.includes('.buka-skills-treeSkillAction{'), '缺少右侧操作区样式')
})
