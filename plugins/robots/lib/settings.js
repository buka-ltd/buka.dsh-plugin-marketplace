/**
 * 机器人插件的设置：目前只有「是否启用通用型机器人」一项。
 *
 * 设置文件放在登记表旁边：`<robotsDir>/../settings.json`（与 `robots.json`
 * 同一层），原子写、权限 0600。它和登记表分开，避免把开关混进「哪些算机器人」
 * 的唯一来源；文件缺失或损坏时按默认值（启用）处理，页面照常可用，下一次
 * 保存会把文件重建成合法内容。
 *
 * 通用型机器人本身不写进登记表：它没有目录、没有 AGENTS.md，也不是插件在
 * `robots.json` 里管理的对象，只是页面里的一个固定入口。启用时它由插件以
 * 固定名字暴露给工作流（`buka_robots` 清单的兜底项、`avatarMap()` 与
 * `startSession()`）；停用后这三处都不再提供它。
 *
 * 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-robots/settings
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 设置文件名；与登记表同级。 */
export const SETTINGS_FILE = 'settings.json'

/** 设置文件格式版本。 */
export const SETTINGS_VERSION = 1

/** 通用型机器人默认启用。 */
export const DEFAULT_GENERAL_ROBOT_ENABLED = true

/**
 * 由机器人根目录得到设置文件路径（登记表也是同一层）。
 *
 * @param {string} robotsDir 机器人根目录
 * @returns {string}
 */
export function resolveSettingsFile(robotsDir) {
  if (typeof robotsDir !== 'string' || robotsDir.trim() === '') {
    throw new Error('缺少机器人根目录')
  }
  return path.join(path.dirname(path.resolve(robotsDir)), SETTINGS_FILE)
}

/**
 * 默认设置；文件缺失 / 损坏时也返回它。
 *
 * @returns {{ version: number, generalRobot: { enabled: boolean } }}
 */
export function defaultSettings() {
  return { version: SETTINGS_VERSION, generalRobot: { enabled: DEFAULT_GENERAL_ROBOT_ENABLED } }
}

/**
 * 把任意读到的值规范成设置对象：只认 `generalRobot.enabled === boolean`，
 * 其余一律按默认值处理（手改坏了也不影响页面）。
 *
 * @param {unknown} value
 * @returns {{ version: number, generalRobot: { enabled: boolean } }}
 */
function normalizeSettings(value) {
  const settings = defaultSettings()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return settings
  const generalRobot = value.generalRobot
  if (generalRobot === null || typeof generalRobot !== 'object' || Array.isArray(generalRobot)) return settings
  if (typeof generalRobot.enabled === 'boolean') settings.generalRobot.enabled = generalRobot.enabled
  return settings
}

/**
 * 读设置。文件不存在、读不了、不是合法 JSON 或字段不合法都回落到默认值，
 * 不抛错：设置是锦上添花，不能因为一个坏文件让机器人页面打不开。
 *
 * @param {{ file: string }} options 设置文件绝对路径
 * @returns {Promise<{ version: number, generalRobot: { enabled: boolean }, file: string }>}
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
 * 原子写设置（临时文件 + rename，权限 0600）。目录不存在会先建好；失败时清理
 * 临时文件，原文件保持不变。
 *
 * @param {{ file: string, settings: { generalRobot?: { enabled?: unknown } } }} options
 * @returns {Promise<{ file: string, settings: { version: number, generalRobot: { enabled: boolean } } }>}
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
 * 改「是否启用通用型机器人」；其余设置保持不变。返回值是写入后的完整设置。
 *
 * @param {{ file: string, enabled: boolean }} options
 * @returns {Promise<{ file: string, settings: { version: number, generalRobot: { enabled: boolean } } }>}
 */
export async function setGeneralRobotEnabled({ file, enabled } = {}) {
  if (typeof enabled !== 'boolean') {
    const error = new Error(`通用型机器人开关必须是布尔值：${String(enabled)}`)
    throw Object.assign(error, { code: 'invalid-settings' })
  }
  const current = await readSettings({ file })
  return await writeSettings({
    file,
    settings: { ...current, generalRobot: { ...current.generalRobot, enabled } },
  })
}

/**
 * 校验设置文件路径。
 *
 * @param {unknown} file
 * @returns {string}
 */
function requireSettingsFile(file) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new Error('缺少机器人设置文件路径')
  }
  return path.resolve(file)
}
