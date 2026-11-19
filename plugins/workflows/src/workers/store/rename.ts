/**
 * 执行者改名：只改展示名，不移动目录、不重建工作区。
 *
 * 标识符 `id` 是不可变引用键，也是智能体目录名；因此「改名」只更新登记表里的
 * `name`（可选展示名）。目录位置、工作区注册、AGENTS.md 与历史会话都保持原样，
 * 引用该执行者的工作流与作业也不会断链。工作区标题由构建 / 改名流程按展示名
 * 同步（见 `builder.ts`），本模块只碰登记表。
 *
 * @module @buka/dsh-plugin-workflows/workers/store/rename
 */

import { setWorkerName } from './registry.ts'
import type { WorkerRecord } from './types.ts'

/**
 * 改一个执行者的展示名；`id` 定位执行者且不可修改。
 *
 * - 名称规则与登记表一致：单行文本、不超过上限；空串表示清空（显示标识符）；
 * - 名称没变时 `renamed: false`，不写文件；
 * - 机器人只读；内建 clock 不可改；未知标识符抛 `code = 'unknown-worker'`；
 * - 目录不存在不影响改展示名——这里不碰磁盘。
 *
 */
export async function renameWorker({
  file,
  id,
  name,
}: {
  file?: string | undefined
  id?: string | undefined
  name?: string | undefined
} = {}): Promise<{
  worker: WorkerRecord
  previousName: string
  renamed: boolean
}> {
  return await setWorkerName({ file, id, name })
}
