/**
 * 旧打工人数据的自动迁移：目录、登记文件名与登记格式。
 *
 * 插件从 `@buka/dsh-plugin-robots` 改名为 `@buka/dsh-plugin-workers`，术语也
 * 从「机器人 / agent 型 / program 型」改成「打工人 / 智能体 / 机器人」。为了
 * 不让已有打工人丢在旧缓存目录里，启动时做三件事（都幂等）：
 *
 * 1. 默认布局下，把 `~/.cache/dsh-plugin-robots` 整个搬到
 *    `~/.cache/dsh-plugin-workers`；目标已存在时不覆盖；
 * 2. 目录里旧的 `robots/` 与 `robots.json` 改成 `workers/` 与 `workers.json`；
 * 3. 登记表是 version 1 / 2 时重写成 version 3（`driver: "program"` → `"robot"`）。
 *
 * 自定义 `workersDir` 时只做第 3 步：插件不知道用户的旧目录在哪，也不该猜。
 *
 * @module @buka/dsh-plugin-workers/store/migrate
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  defaultWorkersRoot,
  legacyPluginCacheDir,
  pluginCacheDir,
  WORKER_REGISTRY_VERSION,
} from './paths.ts'
import { readWorkerRegistry, writeWorkerRegistry } from './registry.ts'

/** 迁移日志的最小形状。 */
export interface MigrationLogger {
  info?(message: string, ...args: readonly unknown[]): void
  warn?(message: string, ...args: readonly unknown[]): void
}

/** 迁移入参。 */
export interface MigrateWorkerStoreOptions {
  /** 新的打工人根目录（已解析成绝对路径）。 */
  readonly workersDir: string
  /** 新的登记文件（已解析成绝对路径）。 */
  readonly registryFile: string
  /** 测试注入的进程环境。 */
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly logger?: MigrationLogger | undefined
}

/** 返回路径本身与它的 realpath（能解析时）；用于匹配登记表里存过的规范路径。 */
async function pathVariants(target: string): Promise<string[]> {
  const variants = [target]
  try {
    const real = await fs.realpath(target)
    if (real !== target) variants.push(real)
  } catch {
    // 目录还没建 / 已被移走时只比较原值。
  }
  return variants
}

/** 判断路径是否存在。 */
async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * 把旧插件的缓存目录搬到新位置；目标已存在或源不存在时什么都不做。
 *
 * @returns 是否发生了搬运
 */
async function moveLegacyCache(
  env: NodeJS.ProcessEnv,
  logger: MigrationLogger | undefined,
): Promise<boolean> {
  const current = pluginCacheDir(env)
  const legacy = legacyPluginCacheDir(env)
  if (path.resolve(current) === path.resolve(legacy)) return false
  if (!(await exists(legacy)) || (await exists(current))) return false

  try {
    await fs.rename(legacy, current)
  } catch (error) {
    // 跨设备或权限限制下 rename 会失败：退化成递归复制，复制成功后再删旧目录。
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw error
    await fs.mkdir(path.dirname(current), { recursive: true })
    await fs.cp(legacy, current, { recursive: true, force: false, errorOnExist: false })
    await fs.rm(legacy, { recursive: true, force: true })
  }
  logger?.info?.('buka-workers: 已把旧插件缓存目录迁移到 %s', current)
  return true
}

/**
 * 把旧文件名改成新文件名；目标已存在时保留目标、不动源。
 */
async function renameIfMissing(from: string, to: string): Promise<boolean> {
  if (path.resolve(from) === path.resolve(to)) return false
  if (!(await exists(from)) || (await exists(to))) return false
  await fs.rename(from, to)
  return true
}

/**
 * 读登记文件的原始版本号；文件不存在或读不出时返回 null。
 */
async function readStoredVersion(file: string): Promise<number | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'number' ? version : null
  } catch {
    return null
  }
}

/**
 * 把旧格式登记表重写成当前版本，并把落在旧根目录里的 `path` 平移到新根目录。
 * 已经是最新且路径无需平移、或文件损坏时什么都不做（损坏的文件绝不能被覆盖）。
 */
async function upgradeRegistry(
  registryFile: string,
  legacyRoots: readonly string[],
  workersDir: string,
  logger: MigrationLogger | undefined,
): Promise<boolean> {
  const stored = await readStoredVersion(registryFile)
  if (stored === null) return false
  const registry = await readWorkerRegistry({ file: registryFile })
  if (registry.corrupt) {
    logger?.warn?.('buka-workers: 登记文件无法读取，跳过格式迁移：%s', registryFile)
    return false
  }
  let changed = stored < WORKER_REGISTRY_VERSION
  const workers = registry.workers.map((worker) => {
    if (worker.driver !== 'agent' || worker.path === '') return worker
    for (const legacyRoot of legacyRoots) {
      if (path.resolve(legacyRoot) === path.resolve(workersDir)) continue
      const relative = path.relative(legacyRoot, worker.path)
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue
      changed = true
      return { ...worker, path: path.join(workersDir, relative) }
    }
    return worker
  })
  if (!changed) return false
  await writeWorkerRegistry({ file: registryFile, workers })
  if (stored < WORKER_REGISTRY_VERSION) {
    logger?.info?.(
      'buka-workers: 登记表已从 version %s 迁移到 version %s',
      stored,
      WORKER_REGISTRY_VERSION,
    )
  } else {
    logger?.info?.('buka-workers: 已把登记表里的旧目录路径平移到新根目录')
  }
  return true
}

/**
 * 执行一次启动迁移；幂等，失败由调用方记日志。
 *
 * @param options 新的根目录、登记文件与环境
 */
export async function migrateWorkerStore(options: MigrateWorkerStoreOptions): Promise<void> {
  const env = options.env ?? process.env
  const workersDir = path.resolve(options.workersDir)
  const registryFile = path.resolve(options.registryFile)
  const usingDefaultLayout = workersDir === path.resolve(defaultWorkersRoot(env))

  const cacheDir = path.dirname(workersDir)
  const baseName = path.basename(workersDir)
  const legacySiblingRoot = path.join(cacheDir, 'robots')
  const legacySiblingRegistry = path.join(cacheDir, 'robots.json')
  // 登记表里的 path 是创建时 realpath 过的；macOS 的 /var → /private/var 这类
  // 符号链接前缀会让字符串比较失败，所以把 realpath 也一并作为候选。
  const legacyRoots = [
    ...new Set([
      ...(await pathVariants(path.join(legacyPluginCacheDir(env), 'robots'))),
      ...(await pathVariants(legacySiblingRoot)),
    ]),
  ]

  if (usingDefaultLayout) await moveLegacyCache(env, options.logger)

  // 默认布局与「自定义 workersDir 但目录名就叫 workers」都按同一套文件名改名；
  // 用户直接把 workersDir 指到旧目录（.../robots）时只改登记文件，不动目录。
  if (usingDefaultLayout || baseName === 'workers') {
    const renamedRoot = await renameIfMissing(legacySiblingRoot, workersDir)
    const renamedRegistry = await renameIfMissing(legacySiblingRegistry, registryFile)
    if (renamedRoot || renamedRegistry) {
      options.logger?.info?.('buka-workers: 已把 robots 目录 / 登记文件改名为 workers')
    }
  } else if (baseName === 'robots') {
    await renameIfMissing(legacySiblingRegistry, registryFile)
  }

  await upgradeRegistry(registryFile, legacyRoots, workersDir, options.logger)
}
