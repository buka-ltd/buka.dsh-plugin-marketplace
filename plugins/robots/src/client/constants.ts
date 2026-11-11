/**
 * 「机器人」页面的常量：词典命名空间、插槽 id、路由、页签与表单 id。
 *
 * @module @buka/dsh-plugin-robots/client/constants
 */

/** 词典命名空间。 */
export const NS = 'buka-robots'

/** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
export const PANEL_ID = 'buka-robots'

/** 「创建机器人」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
export const CREATE_FORM_ID = 'buka-robots-create-form'

/**
 * 「重命名机器人」对话框里表单的 id：页脚「保存」按钮通过 `form` 提交它，
 * 这样回车与点保存走同一套校验。
 */
export const RENAME_FORM_ID = 'buka-robots-rename-form'

/** 与 Host 一半（`plugins/robots/lib/index.js`）的路由常量保持一致。 */
export const LIST_ROUTE = '/buka-robots/list'
export const CREATE_ROUTE = '/buka-robots/create'
export const RENAME_ROUTE = '/buka-robots/rename'
export const AVATAR_ROUTE = '/buka-robots/avatar'
export const DESCRIPTION_ROUTE = '/buka-robots/description'
export const REMOVE_ROUTE = '/buka-robots/remove'
export const AGENTS_ROUTE = '/buka-robots/agents'
export const REVEAL_ROUTE = '/buka-robots/reveal'
export const AVAILABLE_ROUTE = '/buka-robots/skills/available'
export const INSTALL_ROUTE = '/buka-robots/skills/install'
export const SKILL_REMOVE_ROUTE = '/buka-robots/skills/remove'

/**
 * Skills 插件（`@buka/dsh-plugin-skills`）的收藏仓库路由。
 *
 * 两个插件不互相 import，只通过同一个 webServer 的包内路由通信：这里只读
 * 收藏清单（GET），Skills 插件没安装时请求 404，页面就把「收藏夹」整块隐藏。
 * 这是跨插件契约，改动时要和 `plugins/skills/lib/index.js` 同步。
 */
export const SKILLS_REPOS_ROUTE = '/buka-skills/repos'

/** 详情页的三个页签；id / panelId 与 `SegmentedTabs` 的 ARIA 契约一致。 */
export const TABS = [
  {
    value: 'description',
    id: 'buka-robots-tab-description',
    panelId: 'buka-robots-panel-description',
  },
  { value: 'agents', id: 'buka-robots-tab-agents', panelId: 'buka-robots-panel-agents' },
  { value: 'skills', id: 'buka-robots-tab-skills', panelId: 'buka-robots-panel-skills' },
] as const

/** 安装对话框里来源表单的 id：回车触发表单提交，读出候选 skills。 */
export const INSTALL_FORM_ID = 'buka-robots-install-form'

/** 「更换头像」对话框里表单的 id：页脚「保存」按钮通过 `form` 属性提交它。 */
export const AVATAR_FORM_ID = 'buka-robots-avatar-form'

/**
 * 描述长度上限（UTF-16 长度），与 Host 的 `ROBOT_DESCRIPTION_MAX_LENGTH`
 * 保持一致：描述是一行摘要，工作流靠它决定是否把节点交给这个机器人。
 */
export const ROBOT_DESCRIPTION_MAX_LENGTH = 500
