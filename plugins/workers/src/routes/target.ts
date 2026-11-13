/**
 * 按 name 解析打工人并确认目录仍在。
 *
 * 打工人路由与 skills 路由共用的前置步骤：登记表损坏、名称不合法、条目不存在
 * 与目录缺失各自映射成稳定的错误码，由调用方按 HTTP 状态码回给页面。
 *
 * @module @buka/dsh-plugin-workers/routes/target
 */

import { promises as fs } from 'node:fs'
import type { WorkerRecord } from '../store/types.ts'
import { isValidWorkerName, readWorkerRegistry } from '../worker-store.ts'

/** 路由错误的统一形状：状态码 + 错误码 + 可展示文案。 */
export interface WorkerRouteError {
  status: number
  code: string
  message: string
}

/**
 * 登记文件损坏时的统一错误：写操作必须拒绝，不能覆盖用户文件。
 *
 */
function registryUnreadableError(registryFile: string): WorkerRouteError {
  return {
    status: 409,
    code: 'registry-unreadable',
    message: `打工人登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`,
  }
}

/**
 * 按 name 从登记表里取打工人，并确认它的目录还在。
 *
 */
export async function resolveWorker(
  registryFile: string,
  name: unknown,
): Promise<
  { worker: WorkerRecord; error?: undefined } | { worker?: undefined; error: WorkerRouteError }
> {
  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) return { error: registryUnreadableError(registryFile) }

  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!isValidWorkerName(trimmed)) {
    return {
      error: { status: 400, code: 'invalid-name', message: `打工人名称不合法：${String(name)}` },
    }
  }
  const worker = registry.workers.find((entry) => entry.name === trimmed)
  if (worker === undefined) {
    return {
      error: { status: 404, code: 'unknown-worker', message: `没有找到这个打工人：${trimmed}` },
    }
  }
  // 机器人没有目录、没有 AGENTS.md / skills / 会话：只读。
  if (worker.driver === 'robot') {
    return {
      error: {
        status: 409,
        code: 'robot-worker',
        message: `机器人只读，不能执行这个操作：${trimmed}`,
      },
    }
  }

  let stat: import('node:fs').Stats | undefined
  try {
    stat = await fs.stat(worker.path)
  } catch {
    stat = undefined
  }
  if (stat === undefined || !stat.isDirectory()) {
    return {
      error: {
        status: 409,
        code: 'missing-directory',
        message: `打工人目录不存在或不是目录：${worker.path}`,
      },
    }
  }
  return { worker }
}
