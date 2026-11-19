/**
 * 「执行者」页签的常量：词典命名空间、路由、页签与表单 id。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/constants
 */

/** 词典命名空间（面板合并后仍独立，供 `home.ts` 绑定执行者文案）。 */
export const NS = 'buka-workers'

/** 「创建执行者」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
export const CREATE_FORM_ID = 'buka-workers-create-form'

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

/**
 * DSH 内置 `@deepseek-ai/dsh-client-ui-open-in-app` 的跨插件 HTTP 契约：
 * 应用清单、应用图标与「用某个应用打开目录」。不在插件间 import，只在浏览器
 * 里 fetch 这三个包内路由；路由不可用（Web / headless / 非桌面组合）时页面
 * 退回 `/buka-workers/reveal`。
 */
export const OPEN_IN_APP_APPS_ROUTE = '/open-in-app/apps'
export const OPEN_IN_APP_OPEN_ROUTE = '/open-in-app/open'
export const OPEN_IN_APP_ICON_ROUTE = '/open-in-app/icon'

/** 与内置 open-in-app 共享的「上次选中的应用」localStorage 键（JSON 字符串）。 */
export const OPEN_IN_APP_CHOICE_KEY = 'dsh.open-in-app.choice'
export const SKILL_REPOS_ROUTE = '/buka-workers/skills/repos'
export const AVAILABLE_ROUTE = '/buka-workers/skills/available'
export const INSTALL_ROUTE = '/buka-workers/skills/install'
export const SKILL_REMOVE_ROUTE = '/buka-workers/skills/remove'
export const SKILL_CHECK_ROUTE = '/buka-workers/skills/check'
export const SKILL_UPDATE_ROUTE = '/buka-workers/skills/update'
export const SKILL_UPDATE_ALL_ROUTE = '/buka-workers/skills/update-all'

/**
 * 来源只来自 Skills 插件的「技能仓库」：两个插件不互相 import，Host 通过
 * `ctx.bukaSkills` 读收藏、`listSkills()` 读仓库内容；浏览器不再手填来源。
 */

/** 详情页的页签；id / panelId 与 `DetailTabs` 的 ARIA 契约一致。 */
export const TABS = [
  {
    value: 'settings',
    id: 'buka-workers-tab-settings',
    panelId: 'buka-workers-panel-settings',
  },
  { value: 'files', id: 'buka-workers-tab-files', panelId: 'buka-workers-panel-files' },
  { value: 'skills', id: 'buka-workers-tab-skills', panelId: 'buka-workers-panel-skills' },
] as const

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
