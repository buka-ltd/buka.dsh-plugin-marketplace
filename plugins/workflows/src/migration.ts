/**
 * v4 硬切换迁移：一次性删除旧工作流数据，之后不再按格式版本清空用户资产。
 *
 * 旧版把运行记录写在 `<dataDir>/runs/`、归档设置写在 `<dataDir>/settings.json`；
 * v4 的作业 / 任务进 `ctx.storageDomain`，大文本与附件进 `<dataDir>/jobs/`。
 * 首次启动删除旧目录，并写一个标记；标记存在时不再触碰数据目录。
 *
 * @module @buka/dsh-plugin-workflows/migration
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 迁移标记文件名。 */
const MIGRATION_MARKER = '.v4-migrated'

/** 旧版本遗留在数据目录下的路径。 */
const LEGACY_PATHS = ['runs', 'settings.json'] as const

/** 迁移日志的最小形状。 */
export interface MigrationLogger {
  info?(message: string, ...args: readonly unknown[]): void
  warn?(message: string, ...args: readonly unknown[]): void
}

/** 迁移入参。 */
export interface RunMigrationsOptions {
  /** 插件数据目录（默认 `~/.cache/dsh-plugin-workflows`）。 */
  readonly dataDir: string
  readonly logger?: MigrationLogger | undefined
}

/**
 * 执行硬切换迁移；幂等。
 *
 * @param options 数据目录与日志
 * @returns 无返回值
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const { dataDir, logger } = options
  await fs.mkdir(dataDir, { recursive: true })

  const marker = path.join(dataDir, MIGRATION_MARKER)
  try {
    await fs.access(marker)
    return
  } catch {
    // 首次运行 v4：继续清理。
  }

  const removed: string[] = []
  for (const name of LEGACY_PATHS) {
    const target = path.join(dataDir, name)
    try {
      await fs.rm(target, { recursive: true, force: true })
      removed.push(name)
    } catch (error) {
      logger?.warn?.(`buka-workflows: could not remove legacy path ${target}`, error)
    }
  }

  await fs.mkdir(path.join(dataDir, 'jobs'), { recursive: true })
  await fs.writeFile(marker, `${new Date().toISOString()}\n`, 'utf8')

  if (removed.length > 0) {
    logger?.info?.(`buka-workflows: migrated to v4, removed legacy data: ${removed.join(', ')}`)
  }
}
