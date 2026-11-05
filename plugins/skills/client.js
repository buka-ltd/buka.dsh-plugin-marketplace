/**
 * `@buka/dsh-plugin-skills` 的浏览器一半：侧边栏的「技能」页面。
 *
 * DSH 的面板由两处注册拼成（见 `@deepseek-ai/dsh-client-ui-sidebar` 与
 * `@deepseek-ai/dsh-client-ui-layout` 的契约）：
 *
 * - `sidebar.panellist` 里的一个图标组件：侧边栏负责按钮、tooltip 与选中态，
 *   图标只拿 `{ size, active }`；
 * - `main` 里以同一个 id 为 key 的页面组件：侧边栏点选时布局挂载它。
 *
 * 页面顶部只有两个 Tab，不放说明文字：
 *
 * - 「已安装」：两个全局 skills 根目录下现有的 skill，标注哪些由 npx skills
 *   管理，并提供按来源选择的卸载入口；
 * - 「收藏仓库」：用户自己记下的 npx skills 来源（`owner/repo`、GitHub 链接
 *   或包名），用于以后 `npx skills add` 时随手取用；可以复制安装命令、打开
 *   仓库、移除收藏。
 *
 * 视觉与交互直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`
 * （模块表里的静态项，不需要声明 external）：`Button` / `Input` /
 * `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标；页面
 * 布局、卡片与状态文字沿用 Plugins 页面（`dsh-client-ui-plugin-manager`）的
 * 结构：标题行 + 工具栏 + Tab 行，内容区 960px 宽、卡片列表、48px 图标块。
 * 这样两个页面共享同一套尺寸、圆角、颜色 token 与控件手感。
 *
 * 页面只做展示与触发：列表、卸载、收藏的读写都走 Host 一半注册的包内路由
 * （`/buka-skills/*`），不在浏览器里判断 npx 的安装方式，也不碰文件系统 ——
 * 这样「怎么卸载」「收藏存在哪」都只有一份实现。
 *
 * 客户端模块格式固定为 `window.__ModuleLoader__.load({ id, factory })`，
 * `id` 必须等于包名；React 与基座模块由浏览器模块表提供，不重复安装。
 */
window.__ModuleLoader__.load({
  id: '@buka/dsh-plugin-skills',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      Button,
      Input,
      SegmentedTabs,
      Tag,
      Tooltip,
      Toast,
      StateDot,
      IconBranchOutlineRegular,
      IconChevronRightOutlineRegular,
      IconCopyOutlineRegular,
      IconPlusOutlineRegular,
      IconRefreshOutlineRegular,
      IconTrashOutlineRegular,
      IconWarningOutlineRegular,
      writeClipboard,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** 词典命名空间。 */
    const NS = 'buka-skills'

    /** 侧边栏条目与主面板共用的 id：侧边栏注册的 id 必须与 `main` 的 key 相同。 */
    const PANEL_ID = 'buka-skills'

    /** 与 Host 一半的路由常量保持一致。 */
    const LIST_ROUTE = '/buka-skills/list'
    const UNINSTALL_ROUTE = '/buka-skills/uninstall'
    const REPOS_ROUTE = '/buka-skills/repos'
    const REPO_REMOVE_ROUTE = '/buka-skills/repos/remove'
    const REPO_SKILLS_ROUTE = '/buka-skills/repo-skills'

    /** Tab 与对应面板的固定 id（页面只挂载一份，不需要 `useId`）。 */
    const TABS = [
      { value: 'installed', id: 'buka-skills-tab-installed', panelId: 'buka-skills-panel-installed' },
      { value: 'repos', id: 'buka-skills-tab-repos', panelId: 'buka-skills-panel-repos' },
    ]

    /** 英文文案。 */
    const en = {
      panel: 'Skills',
      title: 'Skills',
      tabsLabel: 'Skill sections',
      tabInstalled: 'Installed',
      tabRepos: 'Saved repos',
      refresh: 'Refresh',
      loading: 'Loading…',
      loadFailed: 'Request failed:',
      empty: 'No global skills are installed.',
      badgeNpx: 'npx skills',
      badgeManual: 'manual',
      uninstall: 'Uninstall',
      uninstalling: 'Uninstalling…',
      confirmRemove: 'Uninstall',
      cancel: 'Cancel',
      confirmNpx:
        'npx skills will remove this skill: the copy in ~/.agents/skills, the links in agent directories, and its lockfile entry.',
      confirmLocal: 'This skill was not installed by npx skills, so its directory is deleted directly.',
      removedWithNpx: 'Removed with npx skills:',
      removedLocally: 'Deleted directly:',
      failed: 'Uninstall failed:',
      noLock: 'npx skills lockfile not found, so every skill is treated as manually installed:',
      corruptLock:
        'The npx skills lockfile exists but cannot be used, so skills under ~/.agents are shown as manual and cannot be uninstalled here until it is fixed:',
      warningsLabel: 'Some skill directories could not be read:',
      repoEmpty: 'No saved skill repositories yet.',
      addPlaceholder: 'owner/repo or a GitHub link',
      notePlaceholder: 'Note (optional)',
      add: 'Add',
      adding: 'Adding…',
      added: 'Saved:',
      removeRepo: 'Remove',
      removing: 'Removing…',
      removed: 'Removed:',
      duplicate: 'Already saved:',
      invalidSource: 'Invalid source: use owner/repo, a GitHub link, an http(s) link, or a package name.',
      invalidNote: 'The note is limited to 200 characters.',
      storeUnreadable: 'The saved-repos file cannot be parsed; fix or delete it first:',
      addFailed: 'Could not save:',
      removeFailed: 'Could not remove:',
      installedBadge: 'installed',
      copyCommand: 'Copy command',
      copied: 'Install command copied.',
      copyFailed: 'Could not copy to the clipboard:',
      expandRepo: 'Show skills',
      collapseRepo: 'Hide skills',
      treeLoading: 'Loading skills…',
      treeEmpty: 'No installable skills found in this repository.',
      treeFailed: 'Could not load skills:',
      treeNotFound: 'Repository not found or not accessible.',
      treeRateLimited: 'GitHub API rate limit reached. Try again later.',
      treeUnsupported: 'Only GitHub repositories can be listed.',
      retry: 'Retry',
    }

    /** 简体中文文案。 */
    const zh = {
      panel: '技能',
      title: '技能',
      tabsLabel: '技能页面分区',
      tabInstalled: '已安装',
      tabRepos: '收藏仓库',
      refresh: '刷新',
      loading: '正在读取…',
      loadFailed: '请求失败：',
      empty: '还没有安装任何全局 skill。',
      badgeNpx: 'npx skills',
      badgeManual: 'manual',
      uninstall: '卸载',
      uninstalling: '正在卸载…',
      confirmRemove: '确认卸载',
      cancel: '取消',
      confirmNpx: '这是 npx skills 安装的 skill：会删除 ~/.agents/skills 里的副本、各 agent 目录里的链接，以及 lockfile 记录。',
      confirmLocal: '这个 skill 不是 npx skills 安装的，将直接删除它的目录。',
      removedWithNpx: '已通过 npx skills 卸载：',
      removedLocally: '已直接删除：',
      failed: '卸载失败：',
      noLock: '没有找到 npx skills 的 lockfile，所有 skill 都会按手工安装处理：',
      corruptLock:
        'npx skills 的 lockfile 存在却无法使用：~/.agents 下的 skill 暂按手工安装展示，修好它之前不能在这里卸载：',
      warningsLabel: '部分 skills 目录无法读取：',
      repoEmpty: '还没有收藏任何仓库。',
      addPlaceholder: 'owner/repo 或 GitHub 链接',
      notePlaceholder: '备注（可选）',
      add: '添加',
      adding: '添加中…',
      added: '已收藏：',
      removeRepo: '移除',
      removing: '移除中…',
      removed: '已移除：',
      duplicate: '已经收藏过：',
      invalidSource: '来源格式不对：只支持 owner/repo、GitHub 链接、http(s) 链接或 npm 包名。',
      invalidNote: '备注最长 200 个字符。',
      storeUnreadable: '收藏文件无法解析，请先修复或删除它：',
      addFailed: '收藏失败：',
      removeFailed: '移除失败：',
      installedBadge: '已安装',
      copyCommand: '复制命令',
      copied: '已复制安装命令。',
      copyFailed: '复制失败，请手动执行：',
      expandRepo: '展开 skills',
      collapseRepo: '收起 skills',
      treeLoading: '正在获取 skills…',
      treeEmpty: '这个仓库里没有找到可安装的 skill。',
      treeFailed: '获取 skills 失败：',
      treeNotFound: '仓库不存在或无权访问。',
      treeRateLimited: 'GitHub 接口限流，稍后再试。',
      treeUnsupported: '只有 GitHub 仓库可以列出 skills。',
      retry: '重试',
    }

    /**
     * 页面样式：结构与 Plugins 页面一致（标题行、Tab 行、960px 内容区、
     * 卡片列表），颜色与尺寸只用主题 token 和 DSH 的圆角/焦点 token。
     */
    const CSS = `
.buka-skills-page{--buka-skills-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-skills-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden auto;overscroll-behavior:contain}
@media (width<=767px){.buka-skills-page{--buka-skills-inset:20px}}
.buka-skills-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-skills-inset));max-width:none;margin-inline:calc(-1 * var(--buka-skills-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-skills-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-skills-headInner{width:100%;max-width:960px;margin-inline:auto;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px}
.buka-skills-heading{order:1;min-width:0;max-width:100%}
.buka-skills-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.buka-skills-toolbar{order:2;display:flex;align-items:center;gap:8px}
.buka-skills-tabs{flex:100%;order:3;display:flex}
.buka-skills-tabList{width:fit-content;min-width:240px}
@media (width<=372px){.buka-skills-tabList{min-width:0}}
.buka-skills-body{box-sizing:border-box;width:100%;max-width:960px;flex:none;display:flex;flex-direction:column;padding:32px 0 48px}
.buka-skills-panel{display:flex;flex-direction:column;gap:24px}
.buka-skills-status,.buka-skills-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-skills-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-skills-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;margin:0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.buka-skills-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}
.buka-skills-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-skills-path{font-family:var(--ds-font-family-code);font-size:11px;overflow-wrap:anywhere}
.buka-skills-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-skills-card{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px}
.buka-skills-cardHead{flex-direction:column;gap:4px;padding:8px;display:flex}
.buka-skills-titleRow{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}
.buka-skills-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
.buka-skills-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex}
.buka-skills-cardTitle{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
.buka-skills-cardLink{color:inherit;text-decoration:none;cursor:pointer}
@media (hover:hover){.buka-skills-cardLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}}
.buka-skills-cardLink:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-skills-chevron{border-radius:var(--dsw-radius-sm);width:20px;height:20px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;margin-right:-2px;padding:0;display:inline-flex}
.buka-skills-chevron>svg{transition:transform .12s ease}
.buka-skills-chevron[aria-expanded=true]>svg{transform:rotate(90deg)}
@media (hover:hover){.buka-skills-chevron:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-skills-chevron:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-skills-tree{margin:2px 0 0;padding:0 0 0 28px;list-style:none;display:flex;flex-direction:column;gap:1px}
.buka-skills-treeItem{min-width:0;flex-direction:column;gap:1px;display:flex}
.buka-skills-treeToggle{box-sizing:border-box;width:100%;min-width:0;gap:6px;padding:2px 6px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;font-size:13px;line-height:20px;display:flex;align-items:center}
.buka-skills-treeToggle>svg{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s ease}
.buka-skills-treeToggle[aria-expanded=true]>svg{transform:rotate(90deg)}
@media (hover:hover){.buka-skills-treeToggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.buka-skills-treeToggle:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.buka-skills-treeName{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.buka-skills-treeCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px}
.buka-skills-treeGroup{margin:0;padding:0 0 0 16px;list-style:none;flex-direction:column;gap:1px;display:flex}
.buka-skills-treeSkill{min-width:0;border-radius:var(--dsw-radius-sm);flex-direction:column;padding:2px 6px;display:flex}
@media (hover:hover){.buka-skills-treeSkill:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-skills-treeSkillName{min-width:0;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;line-height:20px}
.buka-skills-treeSkillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:1;-webkit-box-orient:vertical;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere}
.buka-skills-treeArea{flex-direction:column;gap:2px;display:flex}
.buka-skills-treeStatus{padding:2px 6px 2px 34px}
.buka-skills-treeFailure{gap:8px;padding:2px 6px 2px 34px;display:flex;flex-wrap:wrap;align-items:center}
.buka-skills-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
.buka-skills-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-skills-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:12px;line-height:18px}
.buka-skills-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.buka-skills-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
@media (hover:hover){.buka-skills-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-skills-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-skills-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-skills-iconButton.buka-skills-iconDanger{color:var(--dsw-alias-state-error-primary)}
@media (hover:hover){.buka-skills-iconButton.buka-skills-iconDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}}
.buka-skills-form{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.buka-skills-addButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-skills-inputSource{flex:1 1 260px;display:flex;min-width:0}
.buka-skills-inputNote{flex:0 1 220px;display:flex;min-width:0}
`

    /**
     * 同名的 skill 可能同时存在于两个全局根，所以页面状态用「根 + 名称」做键。
     *
     * @param {object} entry 一条 skill
     * @returns {string}
     */
    function entryKey(entry) {
      return `${entry.scope}:${entry.id}`
    }

    /**
     * 标题行第二个标签：安装来源。
     *
     * - npx skills 管理：显示来源仓库（如 `vercel-labs/skills`），lockfile
     *   没写来源时退回 `npx skills`；
     * - 其它：`manual`。
     *
     * @param {object} entry 一条 skill
     * @param {function(string): string} t 翻译函数
     * @returns {{ text: string, tone: 'info' | 'outline' }}
     */
    function sourceTagOf(entry, t) {
      if (entry.managedByNpx !== true) return { text: t('badgeManual'), tone: 'outline' }
      const source = repoLabel(entry.npxSourceUrl) || repoLabel(entry.npxSource)
      return { text: source === '' ? t('badgeNpx') : source, tone: 'info' }
    }

    /**
     * 把各种 npx 来源写法收敛成可比较的键：`https://github.com/a/b.git`、
     * `github.com/a/b` 与 `a/b` 都是 `a/b`。Host 写进收藏文件的 `id` 也是
     * 这个键的小写形式，所以可以直接用来判断「收藏的仓库是否已安装」。
     *
     * @param {unknown} value 来源或来源链接
     * @returns {{ key: string, label: string }} 小写键与用于展示的文本
     */
    function normalizeRepo(value) {
      if (typeof value !== 'string') return { key: '', label: '' }
      const text = value.trim()
      if (text === '') return { key: '', label: '' }
      const label = text
        .replace(/^https?:\/\/(?:www\.)?github\.com\//iu, '')
        .replace(/^github\.com\//iu, '')
        .replace(/\.git$/iu, '')
        .replace(/\/+$/u, '')
      return { key: label.toLowerCase(), label }
    }

    /**
     * 展示用的来源文本；非字符串返回空串。
     *
     * @param {unknown} value
     * @returns {string}
     */
    function repoLabel(value) {
      return normalizeRepo(value).label
    }

    /**
     * 收藏项对应的可打开链接：GitHub 仓库拼成网页地址，http(s) 来源原样使用，
     * 纯包名（如 `notion`）没有可打开的仓库页，返回空串。
     *
     * @param {string} source 已规范化的来源
     * @returns {string}
     */
    function repoUrl(source) {
      if (typeof source !== 'string' || source === '') return ''
      if (/^https?:\/\//iu.test(source)) return source
      if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u.test(source)) {
        return `https://github.com/${source}`
      }
      return ''
    }

    /**
     * `npx skills add` 的命令行；收藏页的「复制命令」用它。
     *
     * @param {string} source 已规范化的来源
     * @returns {string}
     */
    function installCommand(source) {
      return `npx skills add ${source} -g`
    }

    /**
     * 这个来源能不能让 Host 去列 skills：只有 GitHub 的 `owner/repo` 可以。
     * 包名与非 GitHub 链接照样能收藏，只是没有可展开的树。
     *
     * @param {string} source 已规范化的来源
     * @returns {boolean}
     */
    function isGitHubRepo(source) {
      return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u.test(normalizeRepo(source).label)
    }

    /**
     * 一个树节点里的 skill 数；目录节点用它显示数量。
     *
     * @param {object} node Host 返回的树节点
     * @returns {number}
     */
    function countSkills(node) {
      if (node.type === 'skill') return 1
      const children = Array.isArray(node.children) ? node.children : []
      let total = 0
      for (const child of children) total += countSkills(child)
      return total
    }

    /**
     * tree 加载失败时的展示文本；已知错误码说清楚原因，其余带 Host 诊断。
     *
     * @param {function(string): string} t 翻译函数
     * @param {unknown} failure 带 `code` 的错误
     * @returns {string}
     */
    function treeFailureText(t, failure) {
      switch (failure?.code) {
        case 'repo-not-found':
          return t('treeNotFound')
        case 'rate-limited':
          return t('treeRateLimited')
        case 'unsupported-source':
          return t('treeUnsupported')
        case 'invalid-source':
          return t('invalidSource')
        default:
          return `${t('treeFailed')} ${messageOf(failure)}`
      }
    }

    /**
     * 把失败原因转成展示文本。
     *
     * @param {unknown} failure
     * @returns {string}
     */
    function messageOf(failure) {
      return failure instanceof Error ? failure.message : String(failure)
    }

    /**
     * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
     *
     * @param {string} url
     * @param {RequestInit & { body?: string }} [options]
     * @returns {Promise<any>}
     */
    async function requestJson(url, options = {}) {
      const headers = { accept: 'application/json' }
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } })
      const body = await response.json().catch(() => null)
      if (!response.ok || body === null || body.ok !== true) {
        const error = new Error(body?.message ?? `HTTP ${response.status}`)
        error.code = body?.code
        throw error
      }
      return body
    }

    /**
     * 一行右侧的操作区：卸载 / 二次确认 / 进行中。
     * 按钮样式与 Plugins 页面的卸载按钮一致（outline + 危险色）。
     *
     * @param {object} entry 一条 skill
     * @param {{ busy: string | null, confirming: string | null, t: function, onAsk: Function, onCancel: Function, onConfirm: Function }} state
     * @returns {object | object[]}
     */
    function rowActions(entry, state) {
      const { busy, confirming, t } = state
      const anyBusy = busy !== null
      if (busy === entryKey(entry)) {
        return h(
          'span',
          { className: 'buka-skills-statusWithDot' },
          h(StateDot, { state: 'ongoing' }),
          t('uninstalling'),
        )
      }
      if (confirming === entryKey(entry)) {
        return [
          h(
            Button,
            {
              key: 'confirm',
              variant: 'outline',
              size: 'sm',
              className: 'buka-skills-danger',
              icon: h(IconWarningOutlineRegular, { size: 13 }),
              onClick: state.onConfirm,
              disabled: anyBusy,
            },
            t('confirmRemove'),
          ),
          h(
            Button,
            {
              key: 'cancel',
              variant: 'ghost',
              size: 'sm',
              onClick: state.onCancel,
              disabled: anyBusy,
            },
            t('cancel'),
          ),
        ]
      }
      return h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          className: 'buka-skills-danger',
          icon: h(IconTrashOutlineRegular, { size: 13 }),
          'aria-label': `${t('uninstall')} ${entry.name}`,
          onClick: state.onAsk,
          disabled: anyBusy,
        },
        t('uninstall'),
      )
    }

    /**
     * 侧边栏的图标。侧边栏只给尺寸与选中态；颜色通过 `currentColor` 继承
     * 面板行的前景色，不自己写死颜色。
     *
     * @param {{ size: number, active?: boolean }} props 侧边栏的图标入参
     * @returns {object} React 元素
     */
    function SkillsPanelIcon({ size }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M8 2.4l1.35 3.25L12.6 7l-3.25 1.35L8 11.6 6.65 8.35 3.4 7l3.25-1.35z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M4.4 13.1h7.2',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * 侧边栏「技能」页面。
     *
     * @param {{ t: function }} props 插槽注入的文案函数
     * @returns {object} React 元素
     */
    function SkillsPage(props) {
      const t = props.t
      const [tab, setTab] = React.useState('installed')
      const [installed, setInstalled] = React.useState({ data: null, error: null, loading: true })
      const [saved, setSaved] = React.useState({ data: null, error: null, loading: true })
      const [reloadKey, setReloadKey] = React.useState(0)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [source, setSource] = React.useState('')
      const [note, setNote] = React.useState('')
      const [adding, setAdding] = React.useState(false)
      const [removing, setRemoving] = React.useState(null)
      // 收藏仓库的树：哪些卡片展开、各仓库拿到（或正在拿）的树、哪些目录收起来。
      // 按仓库 id 存，移除收藏后由下面的 prune 清掉，避免留下孤儿状态。
      const [expandedRepos, setExpandedRepos] = React.useState({})
      const [trees, setTrees] = React.useState({})
      const [collapsedDirs, setCollapsedDirs] = React.useState({})

      // 每次刷新（或首次挂载）重新读一次 Host 的扫描结果与收藏；两个 Tab 的
      // 数据一起刷新，切 Tab 时不再发请求。
      React.useEffect(() => {
        let cancelled = false
        setInstalled((prev) => ({ ...prev, loading: true, error: null }))
        setSaved((prev) => ({ ...prev, loading: true, error: null }))
        requestJson(LIST_ROUTE).then(
          (body) => {
            if (!cancelled) setInstalled({ data: body, error: null, loading: false })
          },
          (failure) => {
            if (!cancelled) setInstalled((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
          },
        )
        requestJson(REPOS_ROUTE).then(
          (body) => {
            if (!cancelled) setSaved({ data: body, error: null, loading: false })
          },
          (failure) => {
            if (!cancelled) setSaved((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
          },
        )
        return () => {
          cancelled = true
        }
      }, [reloadKey])

      const installedData = installed.data
      const skills = Array.isArray(installedData?.skills) ? installedData.skills : []
      const savedData = saved.data
      const repos = Array.isArray(savedData?.repos) ? savedData.repos : []
      const storeCorrupt = savedData !== null && savedData.corrupt === true
      const loading = tab === 'installed' ? installed.loading : saved.loading

      // 已安装的 skill 来自哪些仓库：收藏行据此标「已安装」。
      const installedRepos = React.useMemo(() => {
        const keys = new Set()
        for (const skill of skills) {
          for (const value of [skill.npxSource, skill.npxSourceUrl]) {
            const key = normalizeRepo(value).key
            if (key !== '') keys.add(key)
          }
        }
        return keys
      }, [installedData])

      // 收藏被移除（或宿主刷新后消失）时，把它的展开态与树一起丢掉。
      React.useEffect(() => {
        if (savedData === null) return
        const ids = new Set(repos.map((repo) => repo.id))
        const prune = (record) => {
          const kept = {}
          let dropped = false
          for (const [key, value] of Object.entries(record)) {
            if (ids.has(key)) kept[key] = value
            else dropped = true
          }
          return dropped ? kept : record
        }
        setExpandedRepos(prune)
        setTrees(prune)
        setCollapsedDirs(prune)
      }, [savedData])

      /**
       * 页面「刷新」：重读列表与收藏，并强制刷新已展开仓库的树；没展开的
       * 仓库继续用 Host 缓存，等下次展开再取，避免一次刷新打十几个请求。
       */
      function reload() {
        setReloadKey((key) => key + 1)
        for (const repo of repos) {
          if (expandedRepos[repo.id] === true) loadTree(repo, { refresh: true })
        }
      }

      /**
       * 取一个仓库的 skills 树。Host 侧有 TTL 缓存并负责拉 GitHub，这里只在
       * 展开与页面刷新时发请求；失败时保留旧数据，只更新错误状态。
       *
       * @param {{ id: string, source: string }} repo 一条收藏
       * @param {{ refresh?: boolean }} [options] 是否绕过 Host 缓存
       */
      async function loadTree(repo, options = {}) {
        const refresh = options.refresh === true
        setTrees((prev) => ({
          ...prev,
          [repo.id]: { status: 'loading', data: prev[repo.id]?.data ?? null, error: null },
        }))
        try {
          const query = `?source=${encodeURIComponent(repo.source)}${refresh ? '&refresh=1' : ''}`
          const body = await requestJson(`${REPO_SKILLS_ROUTE}${query}`)
          setTrees((prev) => ({ ...prev, [repo.id]: { status: 'ready', data: body, error: null } }))
        } catch (failure) {
          setTrees((prev) => ({
            ...prev,
            [repo.id]: { status: 'error', data: prev[repo.id]?.data ?? null, error: failure },
          }))
        }
      }

      /**
       * 展开 / 收起一个收藏仓库；首次展开时拉树，之后走状态里的数据。
       *
       * @param {{ id: string, source: string }} repo 一条收藏
       */
      function toggleRepo(repo) {
        const willExpand = expandedRepos[repo.id] !== true
        setExpandedRepos((prev) => {
          const next = { ...prev }
          if (willExpand) next[repo.id] = true
          else delete next[repo.id]
          return next
        })
        if (willExpand && trees[repo.id] === undefined) loadTree(repo)
      }

      /**
       * 收起 / 展开树里的一个目录。
       *
       * @param {{ id: string }} repo 一条收藏
       * @param {string} dirPath 目录节点的相对路径
       */
      function toggleDir(repo, dirPath) {
        setCollapsedDirs((prev) => {
          const repoDirs = { ...(prev[repo.id] ?? {}) }
          if (repoDirs[dirPath] === true) delete repoDirs[dirPath]
          else repoDirs[dirPath] = true
          return { ...prev, [repo.id]: repoDirs }
        })
      }

      /**
       * 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
       *
       * @param {'success' | 'error'} kind
       * @param {string} text
       */
      function flash(kind, text) {
        setNotice({ kind, text, seq: Date.now() + Math.random() })
      }

      /**
       * 请求 Host 卸载一条 skill；Host 会按 npx 管理与否选择方式。
       *
       * @param {object} entry 一条 skill
       */
      async function uninstall(entry) {
        setBusy(entryKey(entry))
        try {
          const body = await requestJson(UNINSTALL_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ scope: entry.scope, id: entry.id }),
          })
          flash(
            'success',
            `${body.method === 'npx' ? t('removedWithNpx') : t('removedLocally')} ${entry.name}`,
          )
          setConfirming(null)
          reload()
        } catch (failure) {
          flash('error', `${t('failed')} ${messageOf(failure)}`)
        } finally {
          setBusy(null)
        }
      }

      /**
       * 收藏一个仓库；Host 负责校验、去重与写文件。
       *
       * @param {object} event 表单提交事件
       */
      async function addRepo(event) {
        event.preventDefault()
        if (adding) return
        const value = source.trim()
        if (value === '') {
          flash('error', t('invalidSource'))
          return
        }
        setAdding(true)
        try {
          const body = await requestJson(REPOS_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ source: value, note }),
          })
          setSaved({ data: body, error: null, loading: false })
          setSource('')
          setNote('')
          flash('success', `${t('added')} ${body.repo?.source ?? value}`)
        } catch (failure) {
          const code = failure.code
          const text =
            code === 'duplicate'
              ? `${t('duplicate')} ${value}`
              : code === 'invalid-source'
                ? t('invalidSource')
                : code === 'invalid-note'
                  ? t('invalidNote')
                  : code === 'store-unreadable'
                    ? t('storeUnreadable')
                    : `${t('addFailed')} ${messageOf(failure)}`
          flash('error', text)
        } finally {
          setAdding(false)
        }
      }

      /**
       * 移除一条收藏；只动收藏文件，不碰已安装的 skill。
       *
       * @param {{ id: string, source: string }} repo 一条收藏
       */
      async function removeRepo(repo) {
        setRemoving(repo.id)
        try {
          const body = await requestJson(REPO_REMOVE_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ id: repo.id }),
          })
          setSaved((prev) => ({
            ...prev,
            data: { ...(prev.data ?? {}), ...body },
            error: null,
            loading: false,
          }))
          flash('success', `${t('removed')} ${repo.source}`)
        } catch (failure) {
          flash('error', `${t('removeFailed')} ${messageOf(failure)}`)
        } finally {
          setRemoving(null)
        }
      }

      /**
       * 复制 `npx skills add` 命令；剪贴板不可用时把命令放进提示里。
       *
       * @param {{ source: string }} repo 一条收藏
       */
      async function copyCommand(repo) {
        const command = installCommand(repo.source)
        const ok = await writeClipboard(command)
        if (ok) flash('success', t('copied'))
        else flash('error', `${t('copyFailed')} ${command}`)
      }

      /** 切 Tab 时清掉上一条提示，避免串台。 */
      function switchTab(next) {
        if (next === tab) return
        setNotice(null)
        setTab(next)
      }

      /** 「已安装」页：卡片列表、lockfile 提示与卸载按钮。 */
      function renderInstalled() {
        const rows = skills.map((entry) => {
          const source = sourceTagOf(entry, t)
          return h(
            'li',
            { className: 'buka-skills-card', key: `${entry.scope}:${entry.id}` },
            h(
              'div',
              { className: 'buka-skills-cardHead' },
              h(
                'div',
                { className: 'buka-skills-titleRow' },
                h(
                  'div',
                  { className: 'buka-skills-titleCluster' },
                  h('span', { className: 'buka-skills-cardTitle' }, entry.name),
                  h(Tag, { tone: 'neutral' }, entry.scope),
                  h(Tag, { tone: source.tone }, source.text),
                ),
                h(
                  'div',
                  { className: 'buka-skills-titleActions' },
                  rowActions(entry, {
                    busy,
                    confirming,
                    t,
                    onAsk: () => setConfirming(entryKey(entry)),
                    onCancel: () => setConfirming(null),
                    onConfirm: () => uninstall(entry),
                  }),
                ),
              ),
              typeof entry.description === 'string' && entry.description !== ''
                ? h('div', { className: 'buka-skills-cardDesc' }, entry.description)
                : null,
              confirming === entryKey(entry)
                ? h(
                    'p',
                    { className: 'buka-skills-hint' },
                    entry.managedByNpx === true ? t('confirmNpx') : t('confirmLocal'),
                  )
                : null,
            ),
          )
        })

        const rootsTip =
          installedData !== null && Array.isArray(installedData.roots) && installedData.roots.length > 0
            ? h(
                'p',
                { className: 'buka-skills-meta' },
                installedData.roots.map((root) => root.path).join(' · '),
              )
            : null

        return h(
          'div',
          { className: 'buka-skills-panel' },
          installed.error === null
            ? null
            : h(
                'p',
                { className: 'buka-skills-failure', role: 'alert' },
                h(StateDot, { state: 'error' }),
                `${t('loadFailed')} ${installed.error}`,
              ),
          installed.loading && installedData === null
            ? h(
                'p',
                { className: 'buka-skills-statusWithDot', role: 'status' },
                h(StateDot, { state: 'ongoing' }),
                t('loading'),
              )
            : null,
          installedData !== null && installedData.lock?.corrupt === true
            ? h(
                'p',
                { className: 'buka-skills-notice', role: 'status' },
                h(IconWarningOutlineRegular, { size: 16 }),
                h(
                  'span',
                  null,
                  t('corruptLock'),
                  ' ',
                  h('span', { className: 'buka-skills-path' }, String(installedData.lock?.path ?? '')),
                ),
              )
            : null,
          installedData !== null && installedData.lock?.exists === false
            ? h(
                'p',
                { className: 'buka-skills-status' },
                `${t('noLock')} `,
                h('span', { className: 'buka-skills-path' }, String(installedData.lock?.path ?? '')),
              )
            : null,
          installedData !== null && Array.isArray(installedData.warnings) && installedData.warnings.length > 0
            ? h(
                'p',
                { className: 'buka-skills-notice', role: 'status' },
                h(IconWarningOutlineRegular, { size: 16 }),
                h(
                  'span',
                  null,
                  `${t('warningsLabel')} `,
                  h('span', { className: 'buka-skills-path' }, installedData.warnings.join(' · ')),
                ),
              )
            : null,
          // 只有拿到过列表才决定「空」还是「列表」：读取失败时由上面的错误行
          // 说明原因，不能同时显示「还没有安装任何 skill」。
          installedData === null
            ? null
            : rows.length === 0 && !installed.loading
              ? h(
                  React.Fragment,
                  null,
                  h('p', { className: 'buka-skills-empty' }, t('empty')),
                  rootsTip,
                )
              : h('ul', { className: 'buka-skills-cards' }, ...rows),
        )
      }

      /**
       * 一个仓库展开后的内容：加载中 / 失败可重试 / 空 / 递归树。
       *
       * @param {{ id: string, source: string }} repo 一条收藏
       * @returns {object | null} React 元素
       */
      function renderTree(repo) {
        const state = trees[repo.id]
        if (state === undefined) return null
        // 刷新失败时保留上一次的树，只在上面加一行错误 + 重试，不把已经看到的
        // 内容整体换成错误页。
        const failure =
          state.status === 'error'
            ? h(
                'div',
                { className: 'buka-skills-treeFailure', role: 'alert' },
                h(StateDot, { state: 'error' }),
                h('span', null, treeFailureText(t, state.error)),
                h(
                  Button,
                  { variant: 'ghost', size: 'sm', onClick: () => loadTree(repo, { refresh: true }) },
                  t('retry'),
                ),
              )
            : null
        const loading =
          state.data === null
            ? h(
                'p',
                { className: 'buka-skills-statusWithDot buka-skills-treeStatus', role: 'status' },
                h(StateDot, { state: 'ongoing' }),
                t('treeLoading'),
              )
            : null
        if (state.data === null) return failure ?? loading
        const root = Array.isArray(state.data.root) ? state.data.root : []
        const body =
          root.length === 0
            ? h('p', { className: 'buka-skills-status buka-skills-treeStatus' }, t('treeEmpty'))
            : // 刷新时保留旧的树，只标 aria-busy，避免展开区域闪成空白。
              h(
                'ul',
                { className: 'buka-skills-tree', 'aria-busy': state.status === 'loading' ? true : undefined },
                ...root.map((node) => renderTreeNode(repo, node)),
              )
        return h('div', { className: 'buka-skills-treeArea' }, failure, body)
      }

      /**
       * 递归渲染树节点：目录可折叠，skill 是叶子（名称 + 一行描述）。
       *
       * @param {{ id: string }} repo 一条收藏
       * @param {object} node Host 返回的树节点
       * @returns {object} React 元素
       */
      function renderTreeNode(repo, node) {
        if (node.type === 'dir') {
          const collapsed = collapsedDirs[repo.id]?.[node.path] === true
          const children = Array.isArray(node.children) ? node.children : []
          return h(
            'li',
            { className: 'buka-skills-treeItem', key: node.path },
            h(
              'button',
              {
                type: 'button',
                className: 'buka-skills-treeToggle',
                'aria-expanded': !collapsed,
                onClick: () => toggleDir(repo, node.path),
              },
              h(IconChevronRightOutlineRegular, { size: 12 }),
              h('span', { className: 'buka-skills-treeName' }, node.name),
              h('span', { className: 'buka-skills-treeCount' }, `· ${countSkills(node)}`),
            ),
            collapsed
              ? null
              : h('ul', { className: 'buka-skills-treeGroup' }, ...children.map((child) => renderTreeNode(repo, child))),
          )
        }
        const description = typeof node.description === 'string' ? node.description : ''
        return h(
          'li',
          { className: 'buka-skills-treeItem', key: node.path },
          h(
            'div',
            { className: 'buka-skills-treeSkill', title: description === '' ? node.path : description },
            h('span', { className: 'buka-skills-treeSkillName' }, node.name),
            description === '' ? null : h('span', { className: 'buka-skills-treeSkillDesc' }, description),
          ),
        )
      }

      /** 「收藏仓库」页：添加表单、卡片列表与「已安装」标记。 */
      function renderSaved() {
        const rows = repos.map((repo) => {
          const link = repoUrl(repo.source)
          const listable = isGitHubRepo(repo.source)
          const installedAlready = installedRepos.has(repo.id)
          const expanded = expandedRepos[repo.id] === true
          return h(
            'li',
            { className: 'buka-skills-card', key: repo.id },
            h(
              'div',
              { className: 'buka-skills-cardHead' },
              h(
                'div',
                { className: 'buka-skills-titleRow' },
                h(
                  'div',
                  { className: 'buka-skills-titleCluster' },
                  // 只有 GitHub 仓库能列出 skills，其余来源不显示折叠箭头。
                  listable
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'buka-skills-chevron',
                          'aria-expanded': expanded,
                          'aria-label': `${expanded ? t('collapseRepo') : t('expandRepo')} ${repo.source}`,
                          onClick: () => toggleRepo(repo),
                        },
                        h(IconChevronRightOutlineRegular, { size: 14 }),
                      )
                    : null,
                  // 标题本身就是仓库链接：点标题直接打开仓库页。
                  link === ''
                    ? h('span', { className: 'buka-skills-cardTitle' }, repo.source)
                    : h(
                        'a',
                        {
                          className: 'buka-skills-cardTitle buka-skills-cardLink',
                          href: link,
                          target: '_blank',
                          rel: 'noreferrer noopener',
                        },
                        repo.source,
                      ),
                  installedAlready ? h(Tag, { tone: 'success' }, t('installedBadge')) : null,
                ),
                h(
                  'div',
                  { className: 'buka-skills-titleActions' },
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      icon: h(IconCopyOutlineRegular, { size: 13 }),
                      onClick: () => copyCommand(repo),
                    },
                    t('copyCommand'),
                  ),
                  h(
                    Tooltip,
                    { label: t('removeRepo'), side: 'top', delayMs: 400 },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'buka-skills-iconButton buka-skills-iconDanger',
                        'aria-label': `${t('removeRepo')} ${repo.source}`,
                        disabled: removing !== null,
                        onClick: () => removeRepo(repo),
                      },
                      removing === repo.id
                        ? h(StateDot, { state: 'ongoing', size: 14 })
                        : h(IconTrashOutlineRegular, { size: 16 }),
                    ),
                  ),
                ),
              ),
              typeof repo.note === 'string' && repo.note !== ''
                ? h('div', { className: 'buka-skills-cardDesc' }, repo.note)
                : null,
              expanded && listable ? renderTree(repo) : null,
            ),
          )
        })

        return h(
          'div',
          { className: 'buka-skills-panel' },
          saved.error === null
            ? null
            : h(
                'p',
                { className: 'buka-skills-failure', role: 'alert' },
                h(StateDot, { state: 'error' }),
                `${t('loadFailed')} ${saved.error}`,
              ),
          saved.loading && savedData === null
            ? h(
                'p',
                { className: 'buka-skills-statusWithDot', role: 'status' },
                h(StateDot, { state: 'ongoing' }),
                t('loading'),
              )
            : null,
          storeCorrupt
            ? h(
                'p',
                { className: 'buka-skills-notice', role: 'status' },
                h(IconWarningOutlineRegular, { size: 16 }),
                h(
                  'span',
                  null,
                  t('storeUnreadable'),
                  ' ',
                  h('span', { className: 'buka-skills-path' }, String(savedData?.file ?? '')),
                ),
              )
            : null,
          h(
            'form',
            { className: 'buka-skills-form', onSubmit: addRepo },
            h(Input, {
              className: 'buka-skills-inputSource',
              type: 'text',
              value: source,
              placeholder: t('addPlaceholder'),
              'aria-label': t('addPlaceholder'),
              autoComplete: 'off',
              spellCheck: false,
              disabled: adding || storeCorrupt,
              icon: h(IconBranchOutlineRegular, { size: 16 }),
              onChange: (event) => setSource(event.target.value),
            }),
            h(Input, {
              className: 'buka-skills-inputNote',
              type: 'text',
              value: note,
              placeholder: t('notePlaceholder'),
              'aria-label': t('notePlaceholder'),
              autoComplete: 'off',
              spellCheck: false,
              maxLength: 200,
              disabled: adding || storeCorrupt,
              onChange: (event) => setNote(event.target.value),
            }),
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                type: 'submit',
                className: 'buka-skills-addButton',
                icon: h(IconPlusOutlineRegular, { size: 13 }),
                disabled: adding || storeCorrupt || source.trim() === '',
              },
              adding ? t('adding') : t('add'),
            ),
          ),
          savedData === null
            ? null
            : rows.length === 0 && !saved.loading
              ? h('p', { className: 'buka-skills-empty' }, t('repoEmpty'))
              : h('ul', { className: 'buka-skills-cards' }, ...rows),
        )
      }

      const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0]

      return h(
        'div',
        { className: 'buka-skills-page' },
        h(
          'div',
          { className: 'buka-skills-head' },
          h(
            'div',
            { className: 'buka-skills-headInner' },
            h('div', { className: 'buka-skills-heading' }, h('h1', { className: 'buka-skills-title' }, t('title'))),
            h(
              'div',
              { className: 'buka-skills-toolbar' },
              h(
                Tooltip,
                { label: t('refresh'), side: 'bottom', delayMs: 500, disabled: loading },
                h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    'aria-label': t('refresh'),
                    'aria-busy': loading,
                    disabled: loading,
                    icon: loading ? h(StateDot, { state: 'ongoing', size: 13 }) : h(IconRefreshOutlineRegular, { size: 13 }),
                    onClick: reload,
                  },
                  t('refresh'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'buka-skills-tabs' },
              h(SegmentedTabs, {
                size: 'sm',
                className: 'buka-skills-tabList',
                label: t('tabsLabel'),
                value: tab,
                onChange: switchTab,
                items: [
                  { value: TABS[0].value, label: t('tabInstalled'), id: TABS[0].id, panelId: TABS[0].panelId },
                  { value: TABS[1].value, label: t('tabRepos'), id: TABS[1].id, panelId: TABS[1].panelId },
                ],
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'buka-skills-body' },
          h(
            'div',
            { role: 'tabpanel', id: activeTab.panelId, 'aria-labelledby': activeTab.id },
            tab === 'installed' ? renderInstalled() : renderSaved(),
          ),
        ),
        notice === null
          ? null
          : h(Toast, {
              key: notice.seq,
              text: notice.text,
              tone: notice.kind === 'success' ? 'success' : undefined,
              icon: notice.kind === 'success' ? undefined : h(IconWarningOutlineRegular, {}),
              holdMs: 3200,
              onDone: () => setNotice(null),
            }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * 注册侧边栏条目与主面板页面。
       *
       * @param {object} ctx 浏览器插件上下文
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-skills: dictionaries')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@buka/dsh-plugin-skills'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'buka-skills: styles')

        // 侧边栏图标：id 与 main 的 key 相同，点击由侧边栏自己完成。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel'),
              locale: NS,
            },
            SkillsPanelIcon,
          ),
        )

        // 主面板页面：布局按侧边栏选中的 id 挂载这里的组件。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            SkillsPage,
          ),
        )
      },
    }
  },
})
