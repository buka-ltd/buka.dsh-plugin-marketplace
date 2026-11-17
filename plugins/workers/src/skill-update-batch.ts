/**
 * 「更新全部打工人」的批量编排。
 *
 * 页面只调一次接口；真正的顺序执行、过滤与汇总放在这里，便于单独测试：
 *
 * - 只对智能体（`driver === 'agent'`）、目录存在且确实装了 skill 的 worker
 *   执行；机器人没有目录，空 skills 的 worker 没有可更新项，都跳过；
 * - 按登记表顺序逐个执行，单个失败不中断后面的；
 * - 最后汇总每个 worker 的结果与整体成功 / 失败数。
 *
 * @module @buka/dsh-plugin-workers/skill-update-batch
 */

/** 批量更新需要的 worker 字段；`WorkerListEntry` 是它的超集。 */
export interface BatchWorker {
  readonly id: string
  readonly name: string
  readonly driver: string
  readonly path: string
  readonly exists: boolean
  readonly skills: ReadonlyArray<{ readonly name: string }>
}

/** Skills 服务返回的更新结果里本模块用到的部分。 */
interface UpdateSummary {
  readonly ok?: boolean
  readonly message?: string
  readonly updated?: readonly unknown[]
  readonly skipped?: readonly unknown[]
  readonly failed?: readonly unknown[]
}

/** 可注入的更新函数：目录由调用方解析后传入。 */
export type WorkerSkillsUpdater = (options: { dir: string }) => Promise<unknown>

/** 一个 worker 的更新结果。 */
export interface BatchWorkerResult {
  readonly id: string
  readonly name: string
  readonly ok: boolean
  readonly message: string
  readonly updated: number
  readonly failed: number
  readonly skipped: number
}

/** 批量更新的汇总。 */
export interface BatchUpdateResult {
  readonly results: BatchWorkerResult[]
  readonly updated: number
  readonly failed: number
  /** 因为没有目录、是机器人或没有 skill 而跳过的 worker 数。 */
  readonly skippedWorkers: number
}

/**
 * 顺序更新一批打工人。
 *
 * @param workers 登记表里的全部 worker（含机器人）
 * @param update Skills 服务的 `updateSkills({ dir })`
 */
export async function updateWorkersSequentially({
  workers,
  update,
}: {
  workers: readonly BatchWorker[]
  update: WorkerSkillsUpdater
}): Promise<BatchUpdateResult> {
  const targets = workers.filter(
    (worker) =>
      worker.driver === 'agent' &&
      worker.exists !== false &&
      Array.isArray(worker.skills) &&
      worker.skills.length > 0,
  )

  const results: BatchWorkerResult[] = []
  for (const worker of targets) {
    try {
      const result = (await update({ dir: worker.path })) as UpdateSummary | null | undefined
      results.push({
        id: worker.id,
        name: worker.name === '' ? worker.id : worker.name,
        ok: result?.ok !== false,
        message:
          typeof result?.message === 'string' && result.message !== ''
            ? result.message
            : result?.ok === false
              ? '更新失败。'
              : '已是最新。',
        updated: Array.isArray(result?.updated) ? result.updated.length : 0,
        failed: Array.isArray(result?.failed) ? result.failed.length : 0,
        skipped: Array.isArray(result?.skipped) ? result.skipped.length : 0,
      })
    } catch (error) {
      results.push({
        id: worker.id,
        name: worker.name === '' ? worker.id : worker.name,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        updated: 0,
        failed: 1,
        skipped: 0,
      })
    }
  }

  return {
    results,
    updated: results.reduce((total, one) => total + one.updated, 0),
    failed: results.filter((one) => !one.ok).length,
    skippedWorkers: workers.length - targets.length,
  }
}
