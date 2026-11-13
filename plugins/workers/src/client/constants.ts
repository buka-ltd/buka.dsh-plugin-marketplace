/**
 * 「打工人」页面的常量：词典命名空间、插槽 id、路由、页签与表单 id。
 *
 * @module @buka/dsh-plugin-workers/client/constants
 */

/** 词典命名空间。 */
export const NS = 'buka-workers'

/** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
export const PANEL_ID = 'buka-workers'

/** 「创建打工人」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
export const CREATE_FORM_ID = 'buka-workers-create-form'

/**
 * 「重命名打工人」对话框里表单的 id：页脚「保存」按钮通过 `form` 提交它，
 * 这样回车与点保存走同一套校验。
 */
export const RENAME_FORM_ID = 'buka-workers-rename-form'

/** 与 Host 一半（`plugins/workers/lib/index.js`）的路由常量保持一致。 */
export const LIST_ROUTE = '/buka-workers/list'
export const CREATE_ROUTE = '/buka-workers/create'
export const RENAME_ROUTE = '/buka-workers/rename'
export const AVATAR_ROUTE = '/buka-workers/avatar'
export const DESCRIPTION_ROUTE = '/buka-workers/description'
export const MODELS_ROUTE = '/buka-workers/models'
export const MODEL_ROUTE = '/buka-workers/model'
export const ASSISTANT_ROUTE = '/buka-workers/assistant'
export const REMOVE_ROUTE = '/buka-workers/remove'
export const AGENTS_ROUTE = '/buka-workers/agents'
export const REVEAL_ROUTE = '/buka-workers/reveal'
export const AVAILABLE_ROUTE = '/buka-workers/skills/available'
export const INSTALL_ROUTE = '/buka-workers/skills/install'
export const SKILL_REMOVE_ROUTE = '/buka-workers/skills/remove'

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
    value: 'description',
    id: 'buka-workers-tab-description',
    panelId: 'buka-workers-panel-description',
  },
  { value: 'model', id: 'buka-workers-tab-model', panelId: 'buka-workers-panel-model' },
  { value: 'agents', id: 'buka-workers-tab-agents', panelId: 'buka-workers-panel-agents' },
  { value: 'skills', id: 'buka-workers-tab-skills', panelId: 'buka-workers-panel-skills' },
] as const

/** 安装对话框里来源表单的 id：回车触发表单提交，读出候选 skills。 */
export const INSTALL_FORM_ID = 'buka-workers-install-form'

/** 「更换头像」对话框里表单的 id：页脚「保存」按钮通过 `form` 属性提交它。 */
export const AVATAR_FORM_ID = 'buka-workers-avatar-form'

/**
 * 描述长度上限（UTF-16 长度），与 Host 的 `WORKER_DESCRIPTION_MAX_LENGTH`
 * 保持一致：描述是一行摘要，工作流靠它决定是否把节点交给这个打工人。
 */
export const WORKER_DESCRIPTION_MAX_LENGTH = 500
