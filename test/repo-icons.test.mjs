/**
 * 仓库头像缓存的单测：有缓存先用缓存，过期后后台静默更新。
 *
 * 不联网：`fetch` 全部注入；缓存落在临时 DSH home 下。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createIconCache,
  ICON_TTL_MS,
  iconCacheFile,
  isSafeIconOwner,
} from '../plugins/skills/src/repo-icons.ts'

/** 一个合法的 1x1 PNG（只用到文件头做类型嗅探）。 */
const PNG_ONE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 第二张图：文件头相同、末尾多几个字节，用来确认缓存真的被替换。 */
const PNG_TWO = Buffer.concat([PNG_ONE, Buffer.from('v2')])

/** 建一个临时 DSH home。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-icons-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { dshHome: path.join(root, 'dsh') }
}

/** 构造一个图片响应。 */
function imageResponse(data) {
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  })
}

/**
 * 按顺序消费预设响应的假 fetch；记录每次调用。
 *
 * 预设项可以是 Response，也可以是返回 Response 的函数。
 */
function createFetch(...responses) {
  const calls = []
  const queue = [...responses]
  const fetch = async (url, init = {}) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (next === undefined) return new Response('missing', { status: 404 })
    return typeof next === 'function' ? next() : next
  }
  return { fetch, calls }
}

test('owner 只接受 GitHub 用户名 / 组织名字符', () => {
  assert.equal(isSafeIconOwner('octocat'), true)
  assert.equal(isSafeIconOwner('Vercel-Labs'), true)
  assert.equal(isSafeIconOwner('a.b_c-d'), true)
  assert.equal(isSafeIconOwner(''), false)
  assert.equal(isSafeIconOwner('../etc/passwd'), false)
  assert.equal(isSafeIconOwner('-starts-with-dash'), false)
  assert.equal(isSafeIconOwner('has space'), false)
  assert.equal(isSafeIconOwner('中文'), false)
  assert.equal(isSafeIconOwner(123), false)
})

test('没有缓存时拉一次并落盘；之后大小写不同的 owner 共用同一份缓存', async (t) => {
  const homes = await tempHomes(t)
  const fake = createFetch(imageResponse(PNG_ONE))
  const cache = createIconCache({ homes, fetch: fake.fetch })

  const first = await cache.load('Vercel-Labs')
  assert.ok(first)
  assert.equal(first.contentType, 'image/png')
  assert.deepEqual(first.data, PNG_ONE)
  assert.equal(fake.calls.length, 1)
  assert.match(fake.calls[0].url, /^https:\/\/github\.com\/Vercel-Labs\.png\?size=80$/u)

  const file = iconCacheFile(homes, 'Vercel-Labs')
  assert.equal(file, path.join(homes.dshHome, 'buka-skills', 'cache', 'icons', 'vercel-labs.img'))
  assert.deepEqual(await fs.readFile(file), PNG_ONE)

  const second = await cache.load('vercel-labs')
  assert.ok(second)
  assert.deepEqual(second.data, PNG_ONE)
  assert.equal(fake.calls.length, 1, '命中缓存不再拉外网')
})

test('缓存过期：本次先回旧图，后台静默换成新图', async (t) => {
  const homes = await tempHomes(t)
  const fake = createFetch(imageResponse(PNG_ONE), imageResponse(PNG_TWO))
  let now = Date.now()
  const cache = createIconCache({ homes, fetch: fake.fetch, now: () => now })

  await cache.load('octocat')
  now += ICON_TTL_MS + 1000

  const stale = await cache.load('octocat')
  assert.ok(stale)
  assert.deepEqual(stale.data, PNG_ONE, '过期时先给缓存里的旧图')
  await cache.whenIdle()
  assert.equal(fake.calls.length, 2, '后台补拉一次')
  assert.deepEqual(await fs.readFile(iconCacheFile(homes, 'octocat')), PNG_TWO)

  // 写回后的 mtime 是真实时间；把注入的时钟拨回真实时间再读。
  now = Date.now()
  const fresh = await cache.load('octocat')
  assert.ok(fresh)
  assert.deepEqual(fresh.data, PNG_TWO, '刷新后的下一次读取拿到新图')
  assert.equal(fake.calls.length, 2, '新图未被判过期，不再拉外网')
})

test('后台更新失败时继续用旧图，不把页面拖进错误', async (t) => {
  const homes = await tempHomes(t)
  const fake = createFetch(imageResponse(PNG_ONE), new Response('boom', { status: 500 }))
  let now = Date.now()
  const cache = createIconCache({ homes, fetch: fake.fetch, now: () => now })

  await cache.load('octocat')
  now += ICON_TTL_MS + 1000

  const stale = await cache.load('octocat')
  assert.ok(stale)
  assert.deepEqual(stale.data, PNG_ONE)
  await cache.whenIdle()

  const again = await cache.load('octocat')
  assert.ok(again)
  assert.deepEqual(again.data, PNG_ONE, '更新失败不影响已有缓存')
})

test('没有缓存且拉取失败时返回 null，页面回退到内置图标', async (t) => {
  const homes = await tempHomes(t)
  const fake = createFetch(new Response('nope', { status: 404 }))
  const cache = createIconCache({ homes, fetch: fake.fetch })

  assert.equal(await cache.load('missing'), null)
  assert.equal(fake.calls.length, 1)
  await fs.access(iconCacheFile(homes, 'missing')).then(
    () => assert.fail('拉取失败不应写缓存'),
    () => {},
  )
})

test('响应不是支持的图片格式时不写缓存', async (t) => {
  const homes = await tempHomes(t)
  const fake = createFetch(new Response('<html>not an image</html>', { status: 200 }))
  const cache = createIconCache({ homes, fetch: fake.fetch })

  assert.equal(await cache.load('octocat'), null)
  assert.equal(fake.calls.length, 1)
})

test('缓存文件损坏时按未命中处理并重拉', async (t) => {
  const homes = await tempHomes(t)
  const file = iconCacheFile(homes, 'octocat')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'not an image')

  const fake = createFetch(imageResponse(PNG_ONE))
  const cache = createIconCache({ homes, fetch: fake.fetch })
  const image = await cache.load('octocat')
  assert.ok(image)
  assert.deepEqual(image.data, PNG_ONE)
  assert.equal(fake.calls.length, 1)
})

test('并发请求同一个 owner 只拉一次', async (t) => {
  const homes = await tempHomes(t)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let calls = 0
  const fetch = async () => {
    calls += 1
    await gate
    return imageResponse(PNG_ONE)
  }
  const cache = createIconCache({ homes, fetch })

  const first = cache.load('octocat')
  const second = cache.load('octocat')
  release()
  const [a, b] = await Promise.all([first, second])
  assert.ok(a)
  assert.ok(b)
  assert.deepEqual(a.data, b.data)
  assert.equal(calls, 1)
})
