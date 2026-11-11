/**
 * 「收藏页状态跨重启恢复」的回归测试。
 *
 * `client.js` 是浏览器一半（`window.__ModuleLoader__` 模块），仓库里没有浏览器
 * 环境，所以和 bell 插件一样用源码断言守住几条容易回归的约定：
 *
 * - 缓存键固定、带 `dsh.` 前缀与版本号，版本不符时不迁移；
 * - 所有 localStorage 访问都有兜底（隐私模式 / 配额满不能让页面挂掉）；
 * - 首次渲染先用缓存恢复，之后写回；恢复出来的树会在后台用 Host 校正一次；
 * - 只有当前展开的仓库才缓存树，避免恢复出「展开着但空白」的卡片。
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

test('收藏页缓存键是带版本的 dsh. 键，版本不符按没有缓存处理', () => {
  assert.ok(source.includes("const VIEW_CACHE_KEY = 'dsh.buka-skills.view.v1'"), '缓存键变了或丢了')
  assert.ok(source.includes('const VIEW_CACHE_VERSION = 2'), '缓存格式版本丢了')
  // TS 版本从 JSON.parse 的结果取了类型化的 `record` 再比较，变量名不再是 `parsed`；
  // 只按「取 version 与常量比较」定位，不绑局部变量名。
  assert.match(
    source,
    /\.version !== VIEW_CACHE_VERSION/u,
    '版本不符时必须当作没有缓存，不能拿旧结构硬套',
  )
})

test('页面首次渲染先恢复展开状态与树，状态变化再写回', () => {
  assert.ok(source.includes('React.useState(readViewCache)'), '页面挂载时没有读缓存')
  for (const field of ['expandedRepos', 'collapsedDirs', 'trees']) {
    assert.ok(
      source.includes(`useState(restored?.${field} ?? {})`),
      `${field} 的初始值没有来自缓存，重开 DSH 会回到默认状态`,
    )
  }
  assert.ok(
    source.includes('writeViewCache({ expandedRepos, collapsedDirs, trees })'),
    '展开/收起后没有写回缓存',
  )
})

test('localStorage 不可用或写满时页面照常工作', () => {
  // 取 storage 本身有 try/catch；读、写各自也有。
  assert.ok(source.includes('function viewStorage()'), 'localStorage 访问没有统一兜底')
  // tsc 会把 `}` 与 `catch {` 拆到不同行，用 `\s*` 同时容忍单行与多行排版。
  assert.match(
    source,
    /try \{\s*raw = storage\.getItem\(VIEW_CACHE_KEY\);?\s*\}\s*catch \{/u,
    'getItem 没有兜底',
  )
  assert.match(source, /try \{\s*storage\.setItem\(VIEW_CACHE_KEY,/, 'setItem 没有兜底')
  assert.ok(source.includes('storage.removeItem(VIEW_CACHE_KEY)'), '配额写满时没有清掉旧缓存')
})

test('只缓存展开着且有树的仓库，避免恢复出空白卡片', () => {
  // tsc 会把单行守卫拆成 `if (...)` + `continue;` 两行，按「条件 + 动作」匹配。
  assert.match(
    source,
    /if \(expandedRepos\[id\] !== true\)\s*\{?\s*continue/u,
    '收起/未展开的仓库不该缓存树',
  )
  assert.ok(
    source.includes('expandedRepos[id] === true && cachedTrees[id] !== undefined'),
    '没拿到树的仓库不该恢复成展开状态',
  )
})

test('恢复后只向 Host 校正一次，不覆盖已显示的旧树', () => {
  assert.ok(source.includes('revalidatedRef'), '没有防止重复校正')
  assert.match(
    source,
    /if \(expandedRepos\[repo\.id\] === true\)\s*\{?\s*loadTree\(repo\)/u,
    '恢复出来的展开卡片没有用 Host 缓存校正',
  )
})
