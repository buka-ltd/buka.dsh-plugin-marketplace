/**
 * @buka/dsh-plugin-workflows 自动归档设置模块的单测。
 *
 * 覆盖默认值、文件路径、读写回落、字段规范化与页面 / API 的入参校验；全部
 * 使用临时目录，不启动 DSH。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  DEFAULT_ARCHIVE_AFTER_HOURS,
  DEFAULT_ARCHIVE_ENABLED,
  DEFAULT_DELETE_AFTER_HOURS,
  defaultSettings,
  MAX_ARCHIVE_HOURS,
  MAX_DELETE_HOURS,
  MIN_ARCHIVE_HOURS,
  MIN_DELETE_HOURS,
  normalizeRetention,
  normalizeSettings,
  readSettings,
  resolveSettingsFile,
  validateSettingsInput,
  writeSettings,
} from '../plugins/workflows/src/settings.ts'

test('settings: defaults archive after 1 day and delete after 7 days', () => {
  assert.equal(DEFAULT_ARCHIVE_ENABLED, true)
  assert.equal(DEFAULT_ARCHIVE_AFTER_HOURS, 24)
  assert.equal(DEFAULT_DELETE_AFTER_HOURS, 168)
  assert.deepEqual(defaultSettings(), {
    version: 1,
    archive: { enabled: true, archiveAfterHours: 24, deleteAfterHours: 168 },
  })
  assert.equal(MIN_ARCHIVE_HOURS, 1)
  assert.equal(MAX_ARCHIVE_HOURS, 720)
  assert.equal(MIN_DELETE_HOURS, 2)
  assert.equal(MAX_DELETE_HOURS, 8760)
})

test('settings: the file lives next to the runs directory', () => {
  assert.equal(resolveSettingsFile('/tmp/buka/runs'), path.join('/tmp/buka', 'settings.json'))
  assert.equal(resolveSettingsFile('/tmp/buka/runs/'), path.join('/tmp/buka', 'settings.json'))
  assert.throws(() => resolveSettingsFile(''), /缺少工作流运行目录/)
})

test('settings: normalization falls back per field and never deletes before archiving', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings())
  assert.deepEqual(normalizeSettings('nope'), defaultSettings())
  assert.deepEqual(normalizeSettings({ archive: 'nope' }), defaultSettings())

  const partial = normalizeSettings({ archive: { enabled: false } })
  assert.equal(partial.archive.enabled, false)
  assert.equal(partial.archive.archiveAfterHours, 24)
  assert.equal(partial.archive.deleteAfterHours, 168)

  const customized = normalizeSettings({
    archive: { enabled: true, archiveAfterHours: 48, deleteAfterHours: 96 },
  })
  assert.deepEqual(customized.archive, {
    enabled: true,
    archiveAfterHours: 48,
    deleteAfterHours: 96,
  })

  // 字段不是整小时 / 超出范围：该字段回落默认值。
  const messy = normalizeSettings({
    archive: { enabled: 'yes', archiveAfterHours: 1.5, deleteAfterHours: MAX_DELETE_HOURS + 1 },
  })
  assert.deepEqual(messy.archive, { enabled: true, archiveAfterHours: 24, deleteAfterHours: 168 })

  // 删除不晚于归档是无效策略：两项一起回落默认值，不能出现「先删除再归档」。
  const inverted = normalizeSettings({
    archive: { enabled: true, archiveAfterHours: 100, deleteAfterHours: 50 },
  })
  assert.deepEqual(inverted.archive, {
    enabled: true,
    archiveAfterHours: 24,
    deleteAfterHours: 168,
  })

  assert.deepEqual(
    normalizeRetention({ enabled: false, archiveAfterHours: 2, deleteAfterHours: 3 }),
    {
      enabled: false,
      archiveAfterHours: 2,
      deleteAfterHours: 3,
    },
  )
})

test('settings: validates the page payload as whole hours', () => {
  const ok = validateSettingsInput({ enabled: true, archiveAfterHours: 24, deleteAfterHours: 168 })
  assert.deepEqual(ok, {
    ok: true,
    archive: { enabled: true, archiveAfterHours: 24, deleteAfterHours: 168 },
  })

  const cases = [
    [null, /JSON 对象/],
    [{ enabled: 'true', archiveAfterHours: 24, deleteAfterHours: 168 }, /enabled 必须是布尔值/],
    [{ enabled: true, archiveAfterHours: 0, deleteAfterHours: 168 }, /archiveAfterHours/],
    [{ enabled: true, archiveAfterHours: 1.5, deleteAfterHours: 168 }, /archiveAfterHours/],
    [{ enabled: true, archiveAfterHours: 24, deleteAfterHours: 1 }, /deleteAfterHours/],
    [{ enabled: true, archiveAfterHours: 24, deleteAfterHours: 24 }, /必须大于 archiveAfterHours/],
    [
      { enabled: true, archiveAfterHours: 700, deleteAfterHours: 600 },
      /必须大于 archiveAfterHours/,
    ],
  ]
  for (const [input, pattern] of cases) {
    const result = validateSettingsInput(input)
    assert.equal(result.ok, false)
    assert.match(result.message, pattern)
  }
})

test('settings: reads defaults when missing or broken and writes atomically', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'buka-workflows-settings-'))
  const file = path.join(dir, 'nested', 'settings.json')

  assert.deepEqual(await readSettings({ file }), { ...defaultSettings(), file: path.resolve(file) })

  const written = await writeSettings({
    file,
    settings: {
      version: 1,
      archive: { enabled: false, archiveAfterHours: 48, deleteAfterHours: 240 },
    },
  })
  assert.deepEqual(written.settings, {
    version: 1,
    archive: { enabled: false, archiveAfterHours: 48, deleteAfterHours: 240 },
  })
  assert.deepEqual(await readSettings({ file }), { ...written.settings, file: path.resolve(file) })

  if (process.platform !== 'win32') {
    const stat = await fs.stat(file)
    assert.equal(stat.mode & 0o777, 0o600, 'settings file is private')
  }

  // 坏 JSON：回落到默认值，不抛错。
  await fs.writeFile(file, '{not json')
  assert.deepEqual((await readSettings({ file })).archive, defaultSettings().archive)

  // 非法字段：该字段回落；保存时同样会规范化再写。
  await fs.writeFile(file, JSON.stringify({ version: 1, archive: { archiveAfterHours: 0 } }))
  const normalized = await readSettings({ file })
  assert.equal(normalized.archive.archiveAfterHours, 24)
  assert.equal(normalized.archive.deleteAfterHours, 168)

  await fs.rm(dir, { recursive: true, force: true })
})
