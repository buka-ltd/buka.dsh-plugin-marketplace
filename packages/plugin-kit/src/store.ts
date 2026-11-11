/**
 * 插件的落盘小工具：原子写 JSON 与安全读取。
 *
 * 四个插件各自维护过一份「临时文件 + rename」的写法：临时文件名有三种方案，
 * 权限 0600 只有一部分地方显式收紧。这里统一成「同目录临时文件 → rename、文件
 * 权限 0600」，调用方只保留自己的业务语义（写什么、何时写、损坏怎么处理）。
 *
 * 目录权限不在统一之列：有的调用方需要把新建目录收紧到 0700（收藏与缓存
 * 目录），有的保持默认，所以 `writeJsonAtomic` 用 `dirMode` 显式接收。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 原子写 JSON 的可选项。 */
export interface WriteJsonAtomicOptions {
  /**
   * 目标目录不存在时创建它的权限。不传时用 `fs.mkdir` 的默认值（受 umask
   * 影响），与原来没有显式 mode 的调用方一致。
   */
  readonly dirMode?: number
}

/**
 * 原子写 JSON：先写同目录临时文件，再 rename；失败时清理临时文件。
 *
 * 文件权限固定 0600：写入时带上 mode，再显式 chmod 一次（umask 可能削弱创建
 * 权限；Windows 上 chmod 基本是空操作）。内容格式是两空格缩进 + 末尾换行，
 * 与插件里原有的落盘格式一致。
 *
 * @param file 目标文件（目录不存在时会先创建）
 * @param value 要写入的值
 * @param options 目录权限等可选项
 */
export async function writeJsonAtomic(
  file: string,
  value: unknown,
  options: WriteJsonAtomicOptions = {},
): Promise<void> {
  const dir = path.dirname(file)
  if (options.dirMode === undefined) {
    await fs.mkdir(dir, { recursive: true })
  } else {
    await fs.mkdir(dir, { recursive: true, mode: options.dirMode })
  }

  const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    try {
      await fs.chmod(temporary, 0o600)
    } catch {
      // 平台不支持时忽略
    }
    await fs.rename(temporary, file)
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true })
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error
  }
}

/**
 * 读一个 JSON 文件；文件缺失、不可读、不是合法 JSON 或内容不是对象时返回 null。
 *
 * 只接受「普通对象」：数组、`null` 与标量都按读不到处理，调用方据此回落到
 * 默认值。需要区分「文件缺失」与「文件损坏」的调用方保留自己的读取逻辑。
 *
 * @param file 目标文件
 * @returns 解析后的 JSON 对象；缺失 / 损坏时是 `null`
 */
export async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.readFile(file, 'utf8')
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
