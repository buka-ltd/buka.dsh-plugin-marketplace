/**
 * 工作流插件的设置：运行记录的自动归档策略。
 *
 * 设置文件放在运行目录的父目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/settings.json`，
 * 即 `runs/` 的同级。它和运行记录分开：删运行不会碰设置，换 `runsDir`
 * （Config）时设置跟着新的运行目录走。原子写、权限 0600；文件缺失或损坏时
 * 按默认值处理，页面照常可用，下一次保存会把文件重建成合法内容。
 *
 * 默认策略：结束超过 24 小时（1 天）的运行归档，超过 168 小时（7 天）的
 * 运行连同目录一起删除。时间按整小时填写；删除必须晚于归档，否则删除会
 * 先于归档发生，归档就没有意义。
 *
 * 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-workflows/settings
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 设置文件名；与 `runs/` 同级。 */
export const SETTINGS_FILE = 'settings.json'

/** 设置文件格式版本。 */
export const SETTINGS_VERSION = 1

/** 默认开启自动归档。 */
export const DEFAULT_ARCHIVE_ENABLED = true

/** 默认归档时间：24 小时（1 天）。 */
export const DEFAULT_ARCHIVE_AFTER_HOURS = 24

/** 默认删除时间：168 小时（7 天）。 */
export const DEFAULT_DELETE_AFTER_HOURS = 168

/** 归档时间下限（小时）。 */
export const MIN_ARCHIVE_HOURS = 1

/** 归档时间上限（小时）：30 天。 */
export const MAX_ARCHIVE_HOURS = 720

/** 删除时间下限（小时）。 */
export const MIN_DELETE_HOURS = 2

/** 删除时间上限（小时）：365 天。 */
export const MAX_DELETE_HOURS = 8760

/**
 * 由运行目录得到设置文件路径：设置放在 `runs/` 的父目录。
 *
 * @param {string} runsDir 运行记录根目录
 * @returns {string}
 */
export function resolveSettingsFile(runsDir) {
  if (typeof runsDir !== 'string' || runsDir.trim() === '') {
    throw new Error('缺少工作流运行目录')
  }
  return path.join(path.dirname(path.resolve(runsDir)), SETTINGS_FILE)
}

/**
 * 默认设置；文件缺失 / 损坏时也返回它。
 *
 * @returns {{ version: number, archive: { enabled: boolean, archiveAfterHours: number, deleteAfterHours: number } }}
 */
export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    archive: {
      enabled: DEFAULT_ARCHIVE_ENABLED,
      archiveAfterHours: DEFAULT_ARCHIVE_AFTER_HOURS,
      deleteAfterHours: DEFAULT_DELETE_AFTER_HOURS,
    },
  }
}

/**
 * 把任意读到的值规范成设置对象。字段不合法时按默认值处理（手改坏了不影响
 * 页面）；删除时间回落到不晚于归档时间时，两项一起回落默认值，避免出现
 * 「先删除、再归档」的策略。
 *
 * @param {unknown} value
 * @returns {{ version: number, archive: { enabled: boolean, archiveAfterHours: number, deleteAfterHours: number } }}
 */
export function normalizeSettings(value) {
  const settings = defaultSettings()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return settings
  const archive = value.archive
  if (archive === null || typeof archive !== 'object' || Array.isArray(archive)) return settings
  if (typeof archive.enabled === 'boolean') settings.archive.enabled = archive.enabled
  const archiveAfterHours = integerInRange(archive.archiveAfterHours, MIN_ARCHIVE_HOURS, MAX_ARCHIVE_HOURS)
  if (archiveAfterHours !== null) settings.archive.archiveAfterHours = archiveAfterHours
  const deleteAfterHours = integerInRange(archive.deleteAfterHours, MIN_DELETE_HOURS, MAX_DELETE_HOURS)
  if (deleteAfterHours !== null) settings.archive.deleteAfterHours = deleteAfterHours
  if (settings.archive.deleteAfterHours <= settings.archive.archiveAfterHours) {
    settings.archive.archiveAfterHours = DEFAULT_ARCHIVE_AFTER_HOURS
    settings.archive.deleteAfterHours = DEFAULT_DELETE_AFTER_HOURS
  }
  return settings
}

/**
 * 只规范化归档部分（运行存储直接用它，避免每次再包一层）。
 *
 * @param {unknown} value
 * @returns {{ enabled: boolean, archiveAfterHours: number, deleteAfterHours: number }}
 */
export function normalizeRetention(value) {
  return normalizeSettings({ archive: value }).archive
}

/**
 * 校验页面 / API 传来的归档设置（平铺字段），返回可写盘的设置对象或一条
 * 中文错误。只认整小时：归档 1–720、删除 2–8760，且删除必须晚于归档。
 *
 * @param {unknown} input
 * @returns {{ ok: true, archive: { enabled: boolean, archiveAfterHours: number, deleteAfterHours: number } } | { ok: false, message: string }}
 */
export function validateSettingsInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '设置必须是 JSON 对象' }
  }
  const enabled = input.enabled
  if (typeof enabled !== 'boolean') {
    return { ok: false, message: 'enabled 必须是布尔值' }
  }
  const archiveAfterHours = integerInRange(input.archiveAfterHours, MIN_ARCHIVE_HOURS, MAX_ARCHIVE_HOURS)
  if (archiveAfterHours === null) {
    return {
      ok: false,
      message: `archiveAfterHours 必须是 ${MIN_ARCHIVE_HOURS}–${MAX_ARCHIVE_HOURS} 之间的整数小时`,
    }
  }
  const deleteAfterHours = integerInRange(input.deleteAfterHours, MIN_DELETE_HOURS, MAX_DELETE_HOURS)
  if (deleteAfterHours === null) {
    return {
      ok: false,
      message: `deleteAfterHours 必须是 ${MIN_DELETE_HOURS}–${MAX_DELETE_HOURS} 之间的整数小时`,
    }
  }
  if (deleteAfterHours <= archiveAfterHours) {
    return { ok: false, message: 'deleteAfterHours 必须大于 archiveAfterHours' }
  }
  return { ok: true, archive: { enabled, archiveAfterHours, deleteAfterHours } }
}

/**
 * 读设置。文件不存在、读不了、不是合法 JSON 或字段不合法都回落到默认值，
 * 不抛错：设置是锦上添花，不能因为一个坏文件让页面打不开。
 *
 * @param {{ file: string }} options 设置文件绝对路径
 * @returns {Promise<{ version: number, archive: { enabled: boolean, archiveAfterHours: number, deleteAfterHours: number }, file: string }>}
 */
export async function readSettings({ file } = {}) {
  const target = requireSettingsFile(file)
  let text
  try {
    text = await fs.readFile(target, 'utf8')
  } catch {
    return { ...defaultSettings(), file: target }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ...defaultSettings(), file: target }
  }
  return { ...normalizeSettings(parsed), file: target }
}

/**
 * 原子写设置（临时文件 + rename，权限 0600）。目录不存在会先建好；失败时
 * 清理临时文件，原文件保持不变。
 *
 * @param {{ file: string, settings: unknown }} options
 * @returns {Promise<{ file: string, settings: { version: number, archive: { enabled: boolean, archiveAfterHours: number, deleteAfterHours: number } } }>}
 */
export async function writeSettings({ file, settings } = {}) {
  const target = requireSettingsFile(file)
  const normalized = normalizeSettings(settings)
  await fs.mkdir(path.dirname(target), { recursive: true })

  const temporary = `${target}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try {
      await fs.chmod(temporary, 0o600)
    } catch {
      // 平台不支持时忽略
    }
    await fs.rename(temporary, target)
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true })
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error
  }
  return { file: target, settings: normalized }
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
function integerInRange(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) return null
  return value
}

/**
 * 校验设置文件路径。
 *
 * @param {unknown} file
 * @returns {string}
 */
function requireSettingsFile(file) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new Error('缺少工作流设置文件路径')
  }
  return path.resolve(file)
}
