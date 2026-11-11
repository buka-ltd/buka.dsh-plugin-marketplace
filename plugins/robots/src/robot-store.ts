/**
 * 机器人（插件自建目录）的登记表、目录与文件操作。
 *
 * 实现按职责拆在 `store/` 下：
 *
 * - `store/paths.ts`：插件全局目录、路径展开、名称校验与 fs 小工具；
 * - `store/types.ts`：登记表 / 列表 / 文件摘要的数据结构；
 * - `store/registry.ts`：登记表读写与条目增删（原子写、权限 0600、损坏拒绝写）；
 * - `store/agents.ts`：AGENTS.md 读写、模板与 CLAUDE.md 链接；
 * - `store/rename.ts`：重命名（改目录 + 就地更新登记表）；
 * - `store/list.ts`：列表汇总（目录 / 挂载状态 / skills / AGENTS.md）；
 * - `store/project-skills.ts`：项目级 skills 扫描。
 *
 * 本文件保留原来的模块路径与全部导出，内部与测试的 import 不需要改动。
 *
 * @module @buka/dsh-plugin-robots/robot-store
 */

export {
  emptyAgentsFile,
  ensureClaudeLink,
  readAgentsFile,
  readClaudeLink,
  writeAgentsFile,
} from './store/agents.ts'
export { listRobots } from './store/list.ts'
export {
  AGENTS_FILE,
  AGENTS_MAX_READ_BYTES,
  AGENTS_MAX_WRITE_BYTES,
  CLAUDE_FILE,
  defaultRobotsRoot,
  isValidRobotName,
  PLUGIN_CACHE_DIR,
  pluginCacheDir,
  ROBOT_DESCRIPTION_MAX_LENGTH,
  ROBOT_REGISTRY_FILE,
  ROBOT_REGISTRY_VERSION,
  resolveRobotRegistryFile,
  resolveRobotsDir,
  robotDirectory,
} from './store/paths.ts'
export { parseFrontmatter, scanProjectSkills } from './store/project-skills.ts'
export {
  addRobot,
  isValidRobotDescription,
  normalizeRobotDescription,
  readRobotRegistry,
  removeRobot,
  setRobotAvatar,
  setRobotDescription,
  writeRobotRegistry,
} from './store/registry.ts'
export { renameRobot } from './store/rename.ts'
export type {
  AgentsFileInfo,
  ClaudeLinkInfo,
  RobotListEntry,
  RobotRecord,
  RobotRecordInput,
  WorkspaceRegistryLike,
} from './store/types.ts'
