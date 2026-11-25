/**
 * 仓库头像的浏览器一半：先走 Host 缓存路由，路由不可用时退到直连 GitHub。
 *
 * 这条回归守住「Host 升级后还没重启时头像不能整体消失」：客户端必须保留
 * 直连退路，同时默认请求 `/skills/icon`。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const CLIENT_BUILD = fileURLToPath(new URL('../.build/skills/client/', import.meta.url))

test('仓库头像默认走 Host 缓存路由，并保留直连 GitHub 的退路', () => {
  const api = readFileSync(path.join(CLIENT_BUILD, 'api.js'), 'utf8')
  const source = readFileSync(path.join(CLIENT_BUILD, 'repo-source.js'), 'utf8')
  const avatar = readFileSync(path.join(CLIENT_BUILD, 'components', 'repo-avatar.js'), 'utf8')

  assert.ok(api.includes("const ICON_ROUTE = '/skills/icon'"), '缓存路由地址变了')
  assert.match(source, /\$\{ICON_ROUTE\}\?owner=/u, '默认地址不再走 Host 缓存路由')
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言的正是源码里的模板字符串字面量
  assert.ok(source.includes('https://github.com/${owner}.png?size=80'), '直连 GitHub 的退路丢了')
  assert.ok(avatar.includes('repoDirectIconUrl(props.source)'), '头像组件没有把直连地址当作退路')
  assert.ok(avatar.includes('failedRoute === routeUrl'), '路由加载失败后没有切换到直连')
})
