/**
 * 打工人（插件自建目录）的登记表、目录与文件操作。
 *
 * 实现按职责拆在 `store/` 下：
 *
 * - `store/paths.ts`：插件全局目录、路径展开、标识符校验（新 / 旧兼容）与
 *   fs 小工具；
 * - `store/types.ts`：登记表 / 列表 / 文件摘要的数据结构与展示名回退；
 * - `store/builtin.ts`：内建机器人（clock）的登记数据；
 * - `store/registry.ts`：登记表读写与条目增删（version 4、旧表迁移、原子写、
 *   权限 0600、损坏拒绝写、内建打工人补写）；
 * - `store/agents.ts`：AGENTS.md 读写、模板与 CLAUDE.md 链接；
 * - `store/rename.ts`：改名（只改展示名，不移动目录）；
 * - `store/delete.ts`：删除事务（目录改名回收 → 删工作区注册 → 删登记 → 清理；失败回滚）；
 * - `store/list.ts`：列表汇总（目录 / 挂载状态 / skills / AGENTS.md）；
 * - `store/project-skills.ts`：项目级 skills 扫描。
 *
 * 本文件保留原来的模块路径与全部导出，内部与测试的 import 不需要改动。
 *
 * @module @buka/dsh-plugin-workers/worker-store
 */

export {
  emptyAgentsFile,
  ensureClaudeLink,
  readAgentsFile,
  readClaudeLink,
  writeAgentsFile,
} from './store/agents.ts'
export {
  BUILTIN_WORKERS,
  builtinWorker,
  CLOCK_WORKER_ID,
  isBuiltinWorkerId,
  withBuiltinWorkers,
} from './store/builtin.ts'
export type { DeleteWorkerResult, WorkerWorkspaceMatch } from './store/delete.ts'
export {
  deleteOutsideRootError,
  deleteWorker,
  findWorkerWorkspace,
  workspaceUnavailableError,
} from './store/delete.ts'
export { listWorkers } from './store/list.ts'
export { migrateWorkerStore } from './store/migrate.ts'
export {
  AGENTS_FILE,
  AGENTS_MAX_READ_BYTES,
  AGENTS_MAX_WRITE_BYTES,
  CLAUDE_FILE,
  defaultWorkersRoot,
  isLegacyWorkerId,
  isResolvableWorkerId,
  isValidWorkerId,
  LEGACY_PLUGIN_CACHE_DIR,
  legacyPluginCacheDir,
  PLUGIN_CACHE_DIR,
  pluginCacheDir,
  resolveWorkerRegistryFile,
  resolveWorkersDir,
  WORKER_DESCRIPTION_MAX_LENGTH,
  WORKER_REGISTRY_FILE,
  WORKER_REGISTRY_LEGACY_VERSIONS,
  WORKER_REGISTRY_VERSION,
  workerDirectory,
} from './store/paths.ts'
export { parseFrontmatter, scanProjectSkills } from './store/project-skills.ts'
export {
  addWorker,
  ensureBuiltinWorkers,
  idTakenError,
  invalidIdError,
  invalidNameError,
  isValidWorkerDescription,
  isValidWorkerName,
  normalizeWorkerDescription,
  normalizeWorkerName,
  normalizeWorkerNameInput,
  readWorkerRegistry,
  removeWorker,
  setWorkerAvatar,
  setWorkerDescription,
  setWorkerModel,
  setWorkerName,
  WORKER_NAME_MAX_LENGTH,
  writeWorkerRegistry,
} from './store/registry.ts'
export { renameWorker } from './store/rename.ts'
export type {
  AgentsFileInfo,
  ClaudeLinkInfo,
  WorkerDriver,
  WorkerListEntry,
  WorkerModelSelection,
  WorkerRecord,
  WorkerRecordInput,
  WorkspaceRegistryLike,
} from './store/types.ts'
export { workerDisplayName } from './store/types.ts'
