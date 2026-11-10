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
import { readFileSync } from 'node:fs'
import test from 'node:test'

const PACKAGE_ROOT = new URL('../plugins/skills/', import.meta.url)
const source = readFileSync(new URL('client.js', PACKAGE_ROOT), 'utf8')

test('收藏页缓存键是带版本的 dsh. 键，版本不符按没有缓存处理', () => {
  assert.ok(source.includes("const VIEW_CACHE_KEY = 'dsh.buka-skills.view.v1'"), '缓存键变了或丢了')
  assert.ok(source.includes('const VIEW_CACHE_VERSION = 2'), '缓存格式版本丢了')
  assert.ok(
    source.includes('parsed.version !== VIEW_CACHE_VERSION'),
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
  assert.match(source, /try \{\s*raw = storage\.getItem\(VIEW_CACHE_KEY\)\s*\} catch \{/, 'getItem 没有兜底')
  assert.match(source, /try \{\s*storage\.setItem\(VIEW_CACHE_KEY,/, 'setItem 没有兜底')
  assert.ok(source.includes('storage.removeItem(VIEW_CACHE_KEY)'), '配额写满时没有清掉旧缓存')
})

test('只缓存展开着且有树的仓库，避免恢复出空白卡片', () => {
  assert.ok(
    source.includes('if (expandedRepos[id] !== true) continue'),
    '收起/未展开的仓库不该缓存树',
  )
  assert.ok(
    source.includes('expandedRepos[id] === true && cachedTrees[id] !== undefined'),
    '没拿到树的仓库不该恢复成展开状态',
  )
})

test('恢复后只向 Host 校正一次，不覆盖已显示的旧树', () => {
  assert.ok(source.includes('revalidatedRef'), '没有防止重复校正')
  assert.ok(
    source.includes('if (expandedRepos[repo.id] === true) loadTree(repo)'),
    '恢复出来的展开卡片没有用 Host 缓存校正',
  )
})
