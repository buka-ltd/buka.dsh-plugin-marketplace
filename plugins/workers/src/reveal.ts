/**
 * 在系统文件管理器里打开打工人目录。
 *
 * 「打开 Finder」按钮只把目录交给操作系统，不读写任何文件：macOS 用 `open`，
 * Windows 用 `explorer`，其余平台用 `xdg-open`。子进程 detached 且忽略
 * stdio，启动成功就返回，不等文件管理器退出（Finder 会一直开着）。
 *
 * 本模块只依赖 Node 内置模块，便于单独测试平台映射与参数校验。
 *
 * @module @buka/dsh-plugin-workers/reveal
 */

import { spawn } from 'node:child_process'

/**
 * 当前平台（或指定平台）打开目录用的命令。
 *
 */
export function revealCommand(platform: NodeJS.Platform | string = process.platform): {
  command: string
} {
  if (platform === 'darwin') return { command: 'open' }
  if (platform === 'win32') return { command: 'explorer' }
  return { command: 'xdg-open' }
}

/**
 * 用系统文件管理器打开一个目录。
 *
 * 只保证「命令启动成功」；目录不存在、文件管理器拒绝等失败在这里抛错，
 * 由路由转成可展示的错误。路径为空时直接拒绝，不会执行任何命令。
 *
 */
export async function revealDirectory(target: unknown): Promise<void> {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('缺少要打开的目录路径')
  }
  const path = target.trim()
  const { command } = revealCommand()

  await new Promise<void>((resolve, reject) => {
    let child: import('node:child_process').ChildProcess
    try {
      child = spawn(command, [path], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }

    // 先等 `spawn`：只有进程真的启动才算成功，`ENOENT` 会走 error 事件。
    let settled = false
    const settle = (error?: unknown) => {
      if (settled) return
      settled = true
      if (error !== undefined && error !== null) {
        reject(error)
        return
      }
      // 不等待文件管理器退出：detached 子进程与当前进程解耦。
      child.unref?.()
      resolve()
    }
    child.once('error', settle)
    child.once('spawn', () => settle())
  })
}
