/**
 * 「执行者」页签的常量：词典命名空间、路由、页签与表单 id。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/constants
 */

/** 词典命名空间（面板合并后仍独立，供 `home.ts` 绑定执行者文案）。 */
export const NS = 'buka-workers'

/** 「创建执行者」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
export const CREATE_FORM_ID = 'buka-workers-create-form'

/**
 * 「重命名执行者」对话框里表单的 id：页脚「保存」按钮通过 `form` 提交它，
 * 这样回车与点保存走同一套校验。
 */
export const RENAME_FORM_ID = 'buka-workers-rename-form'

/** 与 Host 一半（`src/workers/` 的 `/buka-workers/*` 路由）的路由常量保持一致。 */
export const LIST_ROUTE = '/buka-workers/list'
export const CREATE_ROUTE = '/buka-workers/create'
export const RENAME_ROUTE = '/buka-workers/rename'
export const AVATAR_ROUTE = '/buka-workers/avatar'
export const FILES_ROUTE = '/buka-workers/files'
export const FILE_ROUTE = '/buka-workers/file'
export const DESCRIPTION_ROUTE = '/buka-workers/description'
export const MODELS_ROUTE = '/buka-workers/models'
export const MODEL_ROUTE = '/buka-workers/model'
export const REMOVE_IMPACT_ROUTE = '/buka-workers/remove-impact'
export const REMOVE_ROUTE = '/buka-workers/remove'
export const REVEAL_ROUTE = '/buka-workers/reveal'
export const AVAILABLE_ROUTE = '/buka-workers/skills/available'
export const INSTALL_ROUTE = '/buka-workers/skills/install'
export const SKILL_REMOVE_ROUTE = '/buka-workers/skills/remove'
export const SKILL_UPDATE_ROUTE = '/buka-workers/skills/update'
export const SKILL_UPDATE_ALL_ROUTE = '/buka-workers/skills/update-all'

/**
 * Skills 插件（`@buka/dsh-plugin-skills`）的收藏仓库路由。
 *
 * 两个插件不互相 import，只通过同一个 webServer 的包内路由通信：这里只读
 * 收藏清单（GET），Skills 插件没安装时请求 404，页面就把「收藏夹」整块隐藏。
 * 这是跨插件契约，改动时要和 `plugins/skills/lib/index.js` 同步。
 */
export const SKILLS_REPOS_ROUTE = '/buka-skills/repos'

/** 详情页的页签；id / panelId 与 `SegmentedTabs` 的 ARIA 契约一致。 */
export const TABS = [
  {
    value: 'settings',
    id: 'buka-workers-tab-settings',
    panelId: 'buka-workers-panel-settings',
  },
  { value: 'files', id: 'buka-workers-tab-files', panelId: 'buka-workers-panel-files' },
  { value: 'skills', id: 'buka-workers-tab-skills', panelId: 'buka-workers-panel-skills' },
] as const

/** 安装对话框里来源表单的 id：回车触发表单提交，读出候选 skills。 */
export const INSTALL_FORM_ID = 'buka-workers-install-form'

/** 「更换头像」对话框里表单的 id：页脚「保存」按钮通过 `form` 属性提交它。 */
export const AVATAR_FORM_ID = 'buka-workers-avatar-form'

/**
 * 描述长度上限（UTF-16 长度），与 Host 的 `WORKER_DESCRIPTION_MAX_LENGTH`
 * 保持一致：描述是一行摘要，工作流靠它决定是否把节点交给这个执行者。
 */
export const WORKER_DESCRIPTION_MAX_LENGTH = 500

/**
 * 新标识符的字符集（与 Host 的 `isValidWorkerId` 一致）：小写字母开头，
 * 后面可以跟小写字母、数字、`_` 与 `-`，总长 1–64。
 */
const WORKER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

/** 标识符是否是合法的新标识符（创建对话框用；已有旧标识符不受此约束）。 */
export function isValidWorkerId(value: unknown): boolean {
  return typeof value === 'string' && WORKER_ID_PATTERN.test(value.trim())
}

/** 展示名上限（UTF-16 长度），与 Host 的 `WORKER_NAME_MAX_LENGTH` 一致。 */
export const WORKER_NAME_MAX_LENGTH = 64
