/**
 * 全局技能检查结果本地缓存的回归测试。
 *
 * 检查是静默的，页面上的状态标记靠这份缓存先恢复出来，所以这里守住几条
 * 容易回归的约定：按键原样往返、版本不符不迁移、坏数据不炸页面、
 * localStorage 不可用 / 写满时照常工作。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { readCheckCache, writeCheckCache } from '../.build/skills/client/check-cache.js'

const KEY = 'dsh.buka-skills.checks.v1'

/**
 * 把 `window.localStorage` 换成内存实现，返回清理函数。
 *
 * @param {Storage} storage 假 storage
 * @returns {() => void}
 */
function useStorage(storage) {
  globalThis.window = { localStorage: storage }
  return () => {
    delete globalThis.window
  }
}

/**
 * 内存版 Storage；只需实现缓存用到的三个方法。
 *
 * @param {Record<string, string>} [initial] 初始内容
 * @returns {Storage & { readonly entries: Map<string, string> }}
 */
function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null
    },
    key(index) {
      return [...entries.keys()][index] ?? null
    },
    removeItem(key) {
      entries.delete(key)
    },
    setItem(key, value) {
      entries.set(key, String(value))
    },
  }
}

test('检查结果按键原样写回与恢复', (t) => {
  const cleanup = useStorage(memoryStorage())
  t.after(cleanup)

  const results = {
    'agents:review': {
      name: 'review',
      source: 'acme/skills',
      status: 'update',
    },
    'dsh:manual': { name: 'manual', status: 'up-to-date' },
  }
  writeCheckCache(results)
  assert.deepEqual(readCheckCache(), results)
})

test('没有缓存、版本不符或 JSON 损坏时当作没有缓存', (t) => {
  const storage = memoryStorage()
  const cleanup = useStorage(storage)
  t.after(cleanup)

  assert.equal(readCheckCache(), null)

  storage.setItem(
    KEY,
    JSON.stringify({ version: 999, results: { 'agents:a': { status: 'update' } } }),
  )
  assert.equal(readCheckCache(), null, '版本不符不能硬套旧结构')

  storage.setItem(KEY, 'not json')
  assert.equal(readCheckCache(), null)

  storage.setItem(KEY, JSON.stringify({ version: 1, results: [] }))
  assert.equal(readCheckCache(), null)
})

test('坏条目被丢掉，合法条目照常恢复', (t) => {
  const storage = memoryStorage()
  const cleanup = useStorage(storage)
  t.after(cleanup)

  storage.setItem(
    KEY,
    JSON.stringify({
      version: 1,
      results: {
        'agents:good': { name: 'good', status: 'update' },
        'agents:no-status': { name: 'no-status' },
        'agents:not-object': 'nope',
      },
    }),
  )
  assert.deepEqual(readCheckCache(), { 'agents:good': { name: 'good', status: 'update' } })
})

test('结果为空时删掉缓存，不留下过期空记录', (t) => {
  const storage = memoryStorage()
  const cleanup = useStorage(storage)
  t.after(cleanup)

  writeCheckCache({ 'agents:a': { name: 'a', status: 'update' } })
  assert.equal(storage.entries.has(KEY), true)
  writeCheckCache({})
  assert.equal(storage.entries.has(KEY), false)
})

test('没有 window 或 localStorage 被禁用时不抛错', (t) => {
  t.after(() => {
    delete globalThis.window
  })

  assert.equal(readCheckCache(), null)
  assert.doesNotThrow(() => writeCheckCache({ 'agents:a': { status: 'update' } }))

  globalThis.window = {
    get localStorage() {
      throw new Error('blocked')
    },
  }
  assert.equal(readCheckCache(), null)
  assert.doesNotThrow(() => writeCheckCache({ 'agents:a': { status: 'update' } }))
})

test('读取失败按没有缓存处理，写入失败清掉旧缓存', (t) => {
  const storage = memoryStorage()
  const cleanup = useStorage(storage)
  t.after(cleanup)

  const originalGetItem = storage.getItem
  storage.getItem = () => {
    throw new Error('read failed')
  }
  assert.equal(readCheckCache(), null)
  storage.getItem = originalGetItem

  writeCheckCache({ 'agents:a': { status: 'update' } })
  storage.setItem = () => {
    throw new Error('quota exceeded')
  }
  assert.doesNotThrow(() => writeCheckCache({ 'agents:a': { status: 'update' } }))
  assert.equal(storage.entries.has(KEY), false, '写不下时要清掉旧缓存')
})
