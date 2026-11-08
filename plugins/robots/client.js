/**
 * `@buka/dsh-plugin-robots` 的浏览器一半：侧边栏的「机器人」页面。
 *
 * v2 语义：机器人是**插件自己创建并登记**的条目，而不是 DSH 里的全部工作区。
 * 机器人目录统一放在插件全局目录下（Host 的 `robotsDir`），登记表是
 * `<机器人根目录>/../robots.json`；页面只展示登记表里的机器人，DSH 里用户
 * 自己建的工作区不显示。每个机器人可以「挂载」成 DSH 工作区（之后出现在
 * 侧边栏工作区列表里），也可以从工作区列表摘掉而保留目录与登记记录。
 *
 * 分工是固定的：
 *
 * - 浏览器一半（本文件）负责「工作区身份」：挂载 / 删除工作区注册 / 打开会话
 *   都必须走 DSH 的 Client Service（`workspaces.create`、`workspaces.delete`、
 *   `uiWorkspace.openWorkspace`），这样侧边栏与主区域才会立刻同步；
 * - Host 一半负责「磁盘内容」：创建机器人目录、维护登记表、扫描项目级 skills、
 *   跑 `npx skills`、读写 `AGENTS.md`，浏览器只通过 `/buka-robots/*` 路由请求它。
 *
 * DSH 的面板由两处注册拼成（见 `@deepseek-ai/dsh-client-ui-sidebar` 与
 * `@deepseek-ai/dsh-client-ui-layout` 的契约）：
 *
 * - `sidebar.panellist` 里的一个图标组件：侧边栏负责按钮、tooltip 与选中态，
 *   图标只拿 `{ size, active }`；
 * - `main` 里以同一个 id 为 key 的页面组件：侧边栏点选时布局挂载它。
 *
 * 页面有两个视图，共用同一个标题行与工具栏：
 *
 * - 列表视图：最上面是固定的「通用型机器人」卡片（🤖 头像；职责写明它是没有
 *   其他更合适机器人时的兜底；唯一动作「进入工作区」会列出 DSH 里已有的工作区，
 *   选中一个就以标准模式打开它），
 *   下面是登记表里的机器人：逐个「新会话 / 挂载 / 配置 / 删除」。删除先摘掉
 *   工作区注册、再删插件记录，目录与文件保留；登记文件损坏时只允许刷新，
 *   新建/删除/挂载都会禁用。列表**不展示目录**（机器人根目录与各机器人路径
 *   都只在详情页出现）；每张卡片显示机器人的一行描述（工作流靠它决定是否
 *   选用该机器人）；新建不再占页面里的常驻输入行：标题行「刷新」右侧的
 *   「创建机器人」按钮打开对话框填名称与描述后提交；「设置」按钮打开设置
 *   对话框，里面的开关决定通用型机器人是否出现在列表里（设置存 Host 的
 *   settings.json）；
 * - 配置视图：标题左侧的返回按钮回到列表，右侧是「新会话 / 打开 Finder / 刷新」；
 *   正文用可切换的页签分成
 *   「描述」（一句话摘要，工作流用它决定是否选用这个机器人）、
 *   「AGENTS.md」（编辑目录下的 AGENTS.md，Host 同时维护 CLAUDE.md 软链接）
 *   与「Skills」（列出已安装的项目级 skills，并通过对话框选择来源里要安装的
 *   skills；来源可以直接用 Skills 插件的收藏仓库，该插件没装时这一块不显示）。
 *   「打开 Finder」把机器人目录交给系统文件管理器（Host 的 `/buka-robots/reveal`）。
 *
 * 视觉与交互直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`
 * （模块表里的静态项，不需要声明 external）：`Button` / `Input` / `Modal` /
 * `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标；textarea、
 * 复选框与滚动列表用原生元素 + 自带 CSS。
 * 页面布局沿用 Plugins / Skills 页面的结构：标题行 + 工具栏 + 960px 内容区 +
 * 卡片列表，颜色与尺寸只用主题 token。这样三个页面共享同一套控件手感。
 *
 * 客户端模块格式固定为 `window.__ModuleLoader__.load({ id, factory })`，
 * `id` 必须等于包名。工厂函数顶层只有纯声明（常量、文案、样式、辅助函数），
 * 不注册插槽、不发请求、不碰 DOM；所有副作用都在 `apply(ctx)` 里。
 */
window.__ModuleLoader__.load({
  id: '@buka/dsh-plugin-robots',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      Button,
      Input,
      Modal,
      SegmentedTabs,
      Tag,
      Tooltip,
      Toast,
      StateDot,
      IconChevronRightOutlineRegular,
      IconFolderOpenOutlineRegular,
      IconNewChatOutlineRegular,
      IconPlusOutlineRegular,
      IconRefreshOutlineRegular,
      IconSettingsOutlineRegular,
      IconTrashOutlineRegular,
      IconWarningOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** 词典命名空间。 */
    const NS = 'buka-robots'

    /** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
    const PANEL_ID = 'buka-robots'

    /** 「创建机器人」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
    const CREATE_FORM_ID = 'buka-robots-create-form'

    /** 与 Host 一半（`plugins/robots/lib/index.js`）的路由常量保持一致。 */
    const LIST_ROUTE = '/buka-robots/list'
    const CREATE_ROUTE = '/buka-robots/create'
    const AVATAR_ROUTE = '/buka-robots/avatar'
    const DESCRIPTION_ROUTE = '/buka-robots/description'
    const REMOVE_ROUTE = '/buka-robots/remove'
    const AGENTS_ROUTE = '/buka-robots/agents'
    const REVEAL_ROUTE = '/buka-robots/reveal'
    const AVAILABLE_ROUTE = '/buka-robots/skills/available'
    const INSTALL_ROUTE = '/buka-robots/skills/install'
    const SKILL_REMOVE_ROUTE = '/buka-robots/skills/remove'
    const WORKSPACES_ROUTE = '/buka-robots/workspaces'
    const SETTINGS_ROUTE = '/buka-robots/settings'

    /**
     * Skills 插件（`@buka/dsh-plugin-skills`）的收藏仓库路由。
     *
     * 两个插件不互相 import，只通过同一个 webServer 的包内路由通信：这里只读
     * 收藏清单（GET），Skills 插件没安装时请求 404，页面就把「收藏夹」整块隐藏。
     * 这是跨插件契约，改动时要和 `plugins/skills/lib/index.js` 同步。
     */
    const SKILLS_REPOS_ROUTE = '/buka-skills/repos'

    /** 详情页的三个页签；id / panelId 与 `SegmentedTabs` 的 ARIA 契约一致。 */
    const TABS = [
      { value: 'description', id: 'buka-robots-tab-description', panelId: 'buka-robots-panel-description' },
      { value: 'agents', id: 'buka-robots-tab-agents', panelId: 'buka-robots-panel-agents' },
      { value: 'skills', id: 'buka-robots-tab-skills', panelId: 'buka-robots-panel-skills' },
    ]

    /** 安装对话框里来源表单的 id：回车触发表单提交，读出候选 skills。 */
    const INSTALL_FORM_ID = 'buka-robots-install-form'

    /** 「更换头像」对话框里表单的 id：页脚「保存」按钮通过 `form` 属性提交它。 */
    const AVATAR_FORM_ID = 'buka-robots-avatar-form'

    /**
     * 描述长度上限（UTF-16 长度），与 Host 的 `ROBOT_DESCRIPTION_MAX_LENGTH`
     * 保持一致：描述是一行摘要，工作流靠它决定是否把节点交给这个机器人。
     */
    const ROBOT_DESCRIPTION_MAX_LENGTH = 500

    /**
     * 预设头像：id 与 Host 的 `lib/avatar.js` 一一对应（插件之间不互相 import，
     * 所以契约是「同一个 id」）。`labelKey` 指向词典里给读屏与 tooltip 用的名字；
     * 工作流节点图里还有一份同样的显示表，增删预设要同步两处。
     */
    const AVATARS = [
      { id: 'sprout', emoji: '🌱', color: '#34A853', labelKey: 'avatarSprout' },
      { id: 'sun', emoji: '☀️', color: '#F2A60C', labelKey: 'avatarSun' },
      { id: 'cat', emoji: '🐱', color: '#F2994A', labelKey: 'avatarCat' },
      { id: 'fox', emoji: '🦊', color: '#EB6A4E', labelKey: 'avatarFox' },
      { id: 'panda', emoji: '🐼', color: '#6B7280', labelKey: 'avatarPanda' },
      { id: 'owl', emoji: '🦉', color: '#8D6E63', labelKey: 'avatarOwl' },
      { id: 'whale', emoji: '🐳', color: '#4A90E2', labelKey: 'avatarWhale' },
      { id: 'octopus', emoji: '🐙', color: '#9B51E0', labelKey: 'avatarOctopus' },
      { id: 'bee', emoji: '🐝', color: '#D9A400', labelKey: 'avatarBee' },
      { id: 'rocket', emoji: '🚀', color: '#5B6BFF', labelKey: 'avatarRocket' },
      { id: 'dino', emoji: '🦖', color: '#27AE60', labelKey: 'avatarDino' },
      { id: 'ghost', emoji: '👻', color: '#94A3B8', labelKey: 'avatarGhost' },
      { id: 'penguin', emoji: '🐧', color: '#2D9CDB', labelKey: 'avatarPenguin' },
      { id: 'unicorn', emoji: '🦄', color: '#BB6BD9', labelKey: 'avatarUnicorn' },
      { id: 'mushroom', emoji: '🍄', color: '#EB5757', labelKey: 'avatarMushroom' },
    ]

    /**
     * 通用型机器人的固定头像：🤖 不再属于普通机器人的预设集合，只留给列表顶部
     * 那个「通用型机器人」入口，避免用户创建的机器人跟它撞脸。
     */
    const GENERAL_AVATAR = { emoji: '🤖', color: '#3B82F6' }

    /** id → 预设；Host 已把旧记录兜底成合法 id，这里只防脏数据。 */
    const AVATAR_BY_ID = new Map(AVATARS.map((preset) => [preset.id, preset]))

    /** 列表 / 默认值用第一个预设。 */
    const DEFAULT_AVATAR_ID = AVATARS[0].id

    /** 英文文案。 */
    const en = {
      panel: 'Robots',
      title: 'Robots',
      refresh: 'Refresh',
      loading: 'Loading…',
      loadFailed: 'Request failed:',
      empty:
        'No robots yet. Creating one adds a directory in the plugin folder and mounts it to the sidebar workspace list.',
      corruptNote: 'The robot registry cannot be read. Fix or delete the file, then refresh:',
      createPlaceholder: 'Robot name, e.g. writer',
      createFieldName: 'Robot name',
      create: 'Create robot',
      close: 'Close',
      creating: 'Creating…',
      avatar: 'Avatar',
      chooseAvatar: 'Choose an avatar',
      changeAvatar: 'Change avatar',
      avatarUpdated: 'Avatar updated.',
      avatarSaveFailed: 'Could not update the avatar:',
      descriptionLabel: 'Responsibilities',
      descriptionPlaceholder: 'e.g. Turns meeting notes into a three-point summary',
      descriptionHint:
        'Workflows read this line to decide whether to hand a node to this robot. State in one sentence what the robot is responsible for.',
      tabDescription: 'Responsibilities',
      descriptionSaved: 'Responsibilities saved.',
      descriptionSaveFailed: 'Could not save the responsibilities:',
      created: 'Created robot:',
      createExisting: 'Robot already existed:',
      createFailed: 'Could not create the robot:',
      createMountFailed:
        'The robot was created, but mounting it to a workspace failed. Use “Mount” to retry:',
      createEmpty: 'Enter a robot name first.',
      newSession: 'New session',
      reveal: 'Open in Finder',
      revealFailed: 'Could not open the folder:',
      openFailed: 'Could not open the robot:',
      openUnmounted: 'This robot is not mounted to a workspace yet. Click “Mount” first.',
      configure: 'Configure',
      generalTitle: 'General-purpose robot',
      generalIntro:
        'Runs general tasks in any existing workspace in standard mode; it has no directory, AGENTS.md or skills of its own, and is used when no specialized robot is available.',
      enterWorkspace: 'Enter workspace',
      chooseWorkspace: 'Choose a workspace',
      chooseWorkspaceHint: 'The general-purpose robot uses standard mode. Pick an existing workspace to enter.',
      loadingWorkspaces: 'Reading workspaces…',
      workspacesFailed: 'Could not read the workspace list:',
      workspacesEmpty: 'No workspaces yet. Create one in the sidebar first.',
      workspaceOpenFailed: 'Could not open the workspace:',
      settings: 'Settings',
      settingsTitle: 'Settings',
      generalSetting: 'General-purpose robot',
      generalSettingDesc:
        'Pinned to the 🤖 avatar and standard mode. It can enter any existing workspace and also appears in the workflow robot list (its responsibility says when to use it); turn it off to hide it from the robot list and from workflows.',
      settingsEnabled: 'Enabled',
      settingsDisabled: 'Disabled',
      settingsSaveFailed: 'Could not save the settings:',
      settingsDone: 'Done',
      mount: 'Mount',
      mounting: 'Mounting…',
      mounted: 'Mounted to a workspace:',
      mountFailed: 'Could not mount the robot:',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      cancel: 'Cancel',
      deleted: 'Removed robot:',
      deleteFailed: 'Could not remove the robot:',
      deleteHint:
        'Only the plugin record and the workspace registration are removed. The robot directory and files are kept.',
      skillsBadge: '{n} skills',
      agentsBadge: 'AGENTS.md',
      noAgentsBadge: 'No AGENTS.md',
      mountedBadge: 'Mounted',
      unmountedBadge: 'Not mounted',
      missingDir: 'Missing directory',
      missingDirHint: 'This robot directory no longer exists. You can delete the record and create it again.',
      missingDirDetail: 'This robot directory no longer exists, so skills and AGENTS.md operations will fail.',
      back: 'Back to robots',
      tabsLabel: 'Robot detail sections',
      tabAgents: 'AGENTS.md',
      tabSkills: 'Skills',
      skillsTitle: 'Installed skills',
      skillsIntroBefore: 'Project-level skills are installed with ',
      skillsIntroMiddle: ' into ',
      skillsIntroAfter: ' (plus a Claude Code link in .claude/skills).',
      sourcePlaceholder: 'Source, e.g. vercel-labs/agent-skills',
      installSkills: 'Install skills',
      installDialogTitle: 'Install skills',
      installSourceLabel: 'Source',
      loadSkills: 'List skills',
      loadingSkills: 'Reading skills…',
      installIdle: 'Enter a source, or pick a repository from the Skills favourites, then list its skills.',
      skillsFound: '{n} skills available',
      selectAllSkills: 'Select all',
      selectedSkills: 'Selected {n} of {m}',
      alreadyInstalled: 'Installed',
      installedHint: 'Skills that are already installed cannot be selected.',
      installSelected: 'Install selected',
      installSelectedCount: 'Install {n}',
      installingSkills: 'Installing {n}…',
      installEmptySelection: 'Select at least one skill.',
      favouritesLabel: 'Skills favourites',
      favouritesEmpty: 'No favourite repositories in the Skills plugin yet.',
      errAvailableFailed: 'Could not read the skill list:',
      errListUnparsed: 'Could not read a skill list from this source. See the command output below.',
      errInvalidSkills: 'Select valid skills.',
      skillInstalled: 'Installed skill from:',
      removeSkill: 'Remove',
      confirmRemoveSkill: 'Confirm remove',
      removing: 'Removing…',
      skillRemoved: 'Removed skill:',
      skillsEmpty: 'No project-level skills are installed in this robot yet.',
      skillErrorTitle: 'The skills command failed:',
      outputLabel: 'Command output',
      agentsTitle: 'AGENTS.md',
      agentsEditorLabel: 'AGENTS.md content',
      agentsPlaceholder: '# AGENTS.md',
      agentsMissingHint: 'This robot has no AGENTS.md yet. Saving creates it.',
      agentsTooLarge: 'The file is larger than 256 KiB. Edit it with an external editor.',
      save: 'Save',
      saving: 'Saving…',
      agentsSaved: 'Saved AGENTS.md.',
      agentsSaveFailed: 'Could not save AGENTS.md:',
      noWorkspacesCreate:
        'This client has no workspaces service, so the robot cannot be mounted to the workspace list.',
      noWorkspacesDelete: 'This client has no workspaces service, so the workspace registration cannot be removed.',
      noUiWorkspace: 'This client has no uiWorkspace service, so the robot conversation cannot be opened.',
      avatarSprout: 'Sprout',
      avatarSun: 'Sun',
      avatarCat: 'Cat',
      avatarFox: 'Fox',
      avatarPanda: 'Panda',
      avatarOwl: 'Owl',
      avatarWhale: 'Whale',
      avatarOctopus: 'Octopus',
      avatarBee: 'Bee',
      avatarRocket: 'Rocket',
      avatarDino: 'Dino',
      avatarGhost: 'Ghost',
      avatarPenguin: 'Penguin',
      avatarUnicorn: 'Unicorn',
      avatarMushroom: 'Mushroom',
      errInvalidName: 'Invalid name: use 1–64 characters, do not start with a dot, and avoid slashes.',
      errInvalidAvatar: 'That avatar is not available. Pick one from the list.',
      errNotDirectory: 'A file already exists at that path, so no directory could be created.',
      errUnknownRobot: 'This robot is no longer in the registry. Refresh and try again.',
      errMissingDirectory: 'The robot directory does not exist, so this operation cannot run.',
      errRegistryUnreadable:
        'The robot registry cannot be read, so this change was cancelled. Fix or delete the file, then refresh.',
      errTooLarge: 'AGENTS.md is larger than 512 KiB and cannot be saved.',
      errInvalidContent: 'The AGENTS.md content must be text.',
      errInvalidSource: 'Invalid source. Use an npx skills source such as owner/repo.',
      errInvalidSkill: 'Invalid skill name.',
      errNpxFailed: 'npx skills failed. See the command output below.',
    }

    /** 简体中文文案。 */
    const zh = {
      panel: '机器人',
      title: '机器人',
      refresh: '刷新',
      loading: '正在读取…',
      loadFailed: '请求失败：',
      empty: '还没有机器人。创建机器人会在插件目录下新建目录，并挂到侧边栏的工作区列表。',
      corruptNote: '机器人登记文件无法读取，请修复或删除该文件后刷新：',
      createPlaceholder: '机器人名称，如 writer',
      createFieldName: '机器人名称',
      create: '创建机器人',
      close: '关闭',
      creating: '创建中…',
      avatar: '头像',
      chooseAvatar: '选择头像',
      changeAvatar: '更换头像',
      avatarUpdated: '已更换头像。',
      avatarSaveFailed: '更换头像失败：',
      descriptionLabel: '职责',
      descriptionPlaceholder: '例如：负责把会议记录整理成三点结论',
      descriptionHint: '工作流会读它来决定是否把节点交给这个机器人；用一句话写清这个机器人负责什么。',
      tabDescription: '职责',
      descriptionSaved: '职责已保存。',
      descriptionSaveFailed: '保存职责失败：',
      created: '已创建机器人：',
      createExisting: '机器人已存在：',
      createFailed: '创建失败：',
      createMountFailed: '机器人已创建，但挂载到工作区失败，可点「挂载」重试：',
      createEmpty: '先填一个机器人名称。',
      newSession: '新会话',
      reveal: '打开 Finder',
      revealFailed: '打开文件夹失败：',
      openFailed: '打开失败：',
      openUnmounted: '这个机器人还没有挂载到工作区，先点「挂载」。',
      configure: '配置',
      generalTitle: '通用型机器人',
      generalIntro:
        '以标准模式在任意已有工作区里执行通用任务，自身没有目录、AGENTS.md 或 skills；没有专用机器人时使用。',
      enterWorkspace: '进入工作区',
      chooseWorkspace: '选择工作区',
      chooseWorkspaceHint: '通用型机器人使用标准模式，选一个已有的工作区进入。',
      loadingWorkspaces: '正在读取工作区…',
      workspacesFailed: '读取工作区失败：',
      workspacesEmpty: '还没有工作区，先在侧边栏新建一个。',
      workspaceOpenFailed: '打开工作区失败：',
      settings: '设置',
      settingsTitle: '设置',
      generalSetting: '通用型机器人',
      generalSettingDesc:
        '固定使用 🤖 头像与标准模式，可以进入任何已存在的工作区，并会出现在工作流的机器人清单里（职责里写明没有专用机器人时使用）；关掉后它既不会出现在机器人列表里，也不会暴露给工作流。',
      settingsEnabled: '启用',
      settingsDisabled: '停用',
      settingsSaveFailed: '保存设置失败：',
      settingsDone: '完成',
      mount: '挂载',
      mounting: '挂载中…',
      mounted: '已挂载到工作区：',
      mountFailed: '挂载失败：',
      delete: '删除',
      confirmDelete: '确认删除',
      cancel: '取消',
      deleted: '已移除机器人：',
      deleteFailed: '移除失败：',
      deleteHint: '只移除插件记录与工作区注册；机器人目录、文件保留。',
      skillsBadge: '{n} skills',
      agentsBadge: 'AGENTS.md',
      noAgentsBadge: '无 AGENTS.md',
      mountedBadge: '已挂载',
      unmountedBadge: '未挂载',
      missingDir: '目录缺失',
      missingDirHint: '这个机器人目录已经不存在了，可以删除记录后重新创建。',
      missingDirDetail: '这个机器人目录已经不存在了，skills 与 AGENTS.md 操作都会失败。',
      back: '返回机器人列表',
      tabsLabel: '机器人详情页签',
      tabAgents: 'AGENTS.md',
      tabSkills: '技能',
      skillsTitle: '已安装 skills',
      skillsIntroBefore: '项目级 skills 通过 ',
      skillsIntroMiddle: ' 安装到 ',
      skillsIntroAfter: '（并给 Claude Code 建 .claude/skills 链接）。',
      sourcePlaceholder: '来源，如 vercel-labs/agent-skills',
      installSkills: '安装 skills',
      installDialogTitle: '安装 skills',
      installSourceLabel: '来源',
      loadSkills: '读取 skills',
      loadingSkills: '正在读取 skills…',
      installIdle: '填一个来源，或从 Skills 收藏夹里选一个仓库，然后读取其中的 skills。',
      skillsFound: '共 {n} 个 skills',
      selectAllSkills: '全选',
      selectedSkills: '已选 {n} / {m}',
      alreadyInstalled: '已安装',
      installedHint: '已安装的 skill 不能重复勾选。',
      installSelected: '安装选中的',
      installSelectedCount: '安装 {n} 个',
      installingSkills: '正在安装 {n} 个…',
      installEmptySelection: '至少选一个 skill。',
      favouritesLabel: 'Skills 收藏夹',
      favouritesEmpty: 'Skills 插件里还没有收藏仓库。',
      errAvailableFailed: '读取 skill 清单失败：',
      errListUnparsed: '无法从这个来源读出 skill 清单，命令输出见下方。',
      errInvalidSkills: 'skills 不合法。',
      skillInstalled: '已安装 skill：',
      removeSkill: '移除',
      confirmRemoveSkill: '确认移除',
      removing: '移除中…',
      skillRemoved: '已移除 skill：',
      skillsEmpty: '这个机器人还没有安装项目级 skills。',
      skillErrorTitle: 'skills 命令执行失败：',
      outputLabel: '命令输出',
      agentsTitle: 'AGENTS.md',
      agentsEditorLabel: 'AGENTS.md 内容',
      agentsPlaceholder: '# AGENTS.md',
      agentsMissingHint: '这个机器人还没有 AGENTS.md，保存会新建它。',
      agentsTooLarge: '文件超过 256 KiB，请用外部编辑器修改。',
      save: '保存',
      saving: '保存中…',
      agentsSaved: '已保存 AGENTS.md。',
      agentsSaveFailed: '保存 AGENTS.md 失败：',
      noWorkspacesCreate: '当前客户端没有 workspaces 服务，无法把机器人挂载到工作区列表。',
      noWorkspacesDelete: '当前客户端没有 workspaces 服务，无法移除工作区注册。',
      noUiWorkspace: '当前客户端没有 uiWorkspace 服务，无法打开机器人会话。',
      avatarSprout: '嫩芽',
      avatarSun: '太阳',
      avatarCat: '小猫',
      avatarFox: '狐狸',
      avatarPanda: '熊猫',
      avatarOwl: '猫头鹰',
      avatarWhale: '鲸鱼',
      avatarOctopus: '章鱼',
      avatarBee: '蜜蜂',
      avatarRocket: '火箭',
      avatarDino: '恐龙',
      avatarGhost: '幽灵',
      avatarPenguin: '企鹅',
      avatarUnicorn: '独角兽',
      avatarMushroom: '蘑菇',
      errInvalidName: '名称不合法：1–64 个字符，不能以 . 开头，不能包含斜杠。',
      errInvalidAvatar: '这个头像不可用，请从列表里重新选一个。',
      errNotDirectory: '目标路径已存在且不是目录，无法创建。',
      errUnknownRobot: '这个机器人已不在登记表里，请刷新后重试。',
      errMissingDirectory: '机器人目录不存在，无法执行这个操作。',
      errRegistryUnreadable: '机器人登记文件无法读取，本次修改已取消；请修复或删除该文件后刷新。',
      errTooLarge: 'AGENTS.md 超过 512 KiB，无法保存。',
      errInvalidContent: 'AGENTS.md 内容必须是文本。',
      errInvalidSource: '来源不合法：请填 owner/repo 这类 npx skills 来源。',
      errInvalidSkill: 'skill 名称不合法。',
      errNpxFailed: 'npx skills 执行失败，输出见下方。',
    }

    /**
     * 页面样式：结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片
     * 列表），颜色与尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
     */
    const CSS = `
.buka-robots-page{--buka-robots-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-robots-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden auto;overscroll-behavior:contain}
@media (width<=767px){.buka-robots-page{--buka-robots-inset:20px}}
.buka-robots-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-robots-inset));max-width:none;margin-inline:calc(-1 * var(--buka-robots-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-robots-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-robots-headInner{width:100%;max-width:960px;margin-inline:auto;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px}
.buka-robots-heading{order:1;flex:1 1 auto;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:6px}
.buka-robots-title{margin:0;font-size:20px;font-weight:500;line-height:28px;overflow-wrap:anywhere}
.buka-robots-toolbar{order:2;display:flex;align-items:center;gap:8px}
.buka-robots-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:32px 0 48px}
.buka-robots-pageBody{display:flex;flex-direction:column;gap:24px}
.buka-robots-detail{display:flex;flex-direction:column;gap:32px;flex:1 1 auto;min-height:0}
.buka-robots-status,.buka-robots-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-robots-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-robots-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;margin:0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.buka-robots-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}
.buka-robots-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-robots-alert{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex;flex-direction:column}
.buka-robots-alertHead{display:flex;align-items:flex-start;gap:8px}
.buka-robots-alertHead>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-robots-output{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;width:100%;box-sizing:border-box}
.buka-robots-outputLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:2px}
.buka-robots-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;margin:0 2px;overflow-wrap:anywhere;word-break:break-all}
.buka-robots-back svg{transform:rotate(180deg)}
.buka-robots-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-robots-card{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px}
.buka-robots-cardHead{flex-direction:column;gap:6px;padding:8px;display:flex}
.buka-robots-titleRow{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}
.buka-robots-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
.buka-robots-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap;justify-content:flex-end}
.buka-robots-cardTitle{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
.buka-robots-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-robots-avatarButton{padding:0;margin:0;border:0;background:0 0;line-height:0;cursor:pointer}
@media (hover:hover){.buka-robots-avatarButton:hover{filter:brightness(.97)}}
.buka-robots-avatarButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-robots-avatarField{display:flex;flex-direction:column;gap:8px}
.buka-robots-avatarGrid{display:grid;grid-template-columns:repeat(8,40px);gap:8px;justify-content:start}
@media (width<=480px){.buka-robots-avatarGrid{grid-template-columns:repeat(4,40px)}}
.buka-robots-avatarOption{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer}
@media (hover:hover){.buka-robots-avatarOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-avatarOption.is-selected{border-color:var(--dsw-alias-brand-primary);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-robots-avatarOption:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-robots-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;padding-left:34px}
.buka-robots-workspaces{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0 -4px;padding:0}
.buka-robots-workspace{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:12px;padding:8px 10px;margin:0;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
@media (hover:hover){.buka-robots-workspace:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-workspace:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-workspace:disabled{cursor:default;opacity:.72}
.buka-robots-workspace>svg{flex:none;color:var(--dsw-alias-label-caption)}
.buka-robots-workspaceText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-robots-workspaceTitle{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-robots-workspacePath{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-robots-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:2px 0}
.buka-robots-settingText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.buka-robots-settingHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.buka-robots-settingTitle{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.buka-robots-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
.buka-robots-switch.is-on{background:var(--dsw-alias-brand-primary)}
.buka-robots-switch:disabled{cursor:default;opacity:.6}
.buka-robots-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-robots-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
.buka-robots-switch.is-on .buka-robots-switchThumb{transform:translateX(16px)}
@media (prefers-reduced-motion:reduce){.buka-robots-switch,.buka-robots-switchThumb{transition:none}}
.buka-robots-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.buka-robots-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
@media (hover:hover){.buka-robots-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-robots-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-robots-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-iconButton.buka-robots-iconDanger{color:var(--dsw-alias-state-error-primary)}
@media (hover:hover){.buka-robots-iconButton.buka-robots-iconDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}}
.buka-robots-sourceRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.buka-robots-input{flex:1 1 260px;display:flex;min-width:0}
.buka-robots-submit,.buka-robots-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-robots-dialogForm{display:flex;flex-direction:column;gap:16px}
.buka-robots-field{display:flex;flex-direction:column;gap:6px}
.buka-robots-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.buka-robots-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
.buka-robots-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.buka-robots-section{display:flex;flex-direction:column;gap:12px}
.buka-robots-agentsSection{flex:1 1 auto;min-height:0}
.buka-robots-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.buka-robots-sectionTitle{margin:0;font-size:15px;font-weight:600;line-height:22px}
.buka-robots-skillList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-robots-skillRow{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:var(--dsw-radius-md);padding:8px 8px;margin:0 -8px}
.buka-robots-skillHead{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.buka-robots-skillName{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.buka-robots-skillActions{flex:none;margin-left:auto;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap}
.buka-robots-skillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
.buka-robots-textarea{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:260px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:20px;padding:10px 12px;tab-size:2}
.buka-robots-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.buka-robots-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-textarea:disabled{opacity:.65}
.buka-robots-headingRow{display:flex;align-items:center;gap:6px;min-width:0}
.buka-robots-headingRow .buka-robots-title{flex:0 1 auto;min-width:0}
.buka-robots-headingTag{flex:none;display:inline-flex;align-items:center;margin-left:2px}
.buka-robots-descriptionInput{box-sizing:border-box;width:100%;min-height:60px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;tab-size:2}
.buka-robots-descriptionInput.is-tall{min-height:140px}
.buka-robots-descriptionInput::placeholder{color:var(--dsw-alias-label-caption)}
.buka-robots-descriptionInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-descriptionInput:disabled{opacity:.65}
.buka-robots-backButton{flex:none;margin-left:-4px}
.buka-robots-tabs{flex:100%;order:3;display:flex}
.buka-robots-tabList{width:fit-content;min-width:240px}
@media (width<=372px){.buka-robots-tabList{min-width:0}}
.buka-robots-panel{display:flex;flex-direction:column;gap:24px;flex:1 1 auto;min-height:0}
.buka-robots-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-candidatesHead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.buka-robots-candidates{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0;padding:4px;list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.buka-robots-candidate{display:flex;align-items:flex-start;gap:10px;padding:7px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}
@media (hover:hover){.buka-robots-candidate:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-candidate.isDisabled{cursor:not-allowed;opacity:.62}
.buka-robots-candidateInput{flex:none;margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary)}
.buka-robots-candidateText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-robots-candidateName{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-robots-candidateDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-robots-candidateTag{flex:none;margin-left:auto;padding-left:8px;display:inline-flex;align-items:center}
.buka-robots-favorites{display:flex;flex-wrap:wrap;gap:8px}
.buka-robots-selectAll{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
`

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
     * `npx-failed` 的响应里还有 `output`，一并挂到错误上供详情页展示。
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
        error.output = typeof body?.output === 'string' ? body.output : undefined
        throw error
      }
      return body
    }

    /**
     * Host 返回的错误码 → 可读文案；未知错误原样展示 message。
     *
     * @param {function(string): string} t 翻译函数
     * @param {unknown} failure 带 `code` 的错误
     * @returns {string}
     */
    function failureText(t, failure) {
      switch (failure?.code) {
        case 'invalid-name':
          return t('errInvalidName')
        case 'invalid-avatar':
          return t('errInvalidAvatar')
        case 'not-directory':
          return t('errNotDirectory')
        case 'unknown-robot':
          return t('errUnknownRobot')
        case 'missing-directory':
          return t('errMissingDirectory')
        case 'registry-unreadable':
          return t('errRegistryUnreadable')
        case 'too-large':
          return t('errTooLarge')
        case 'invalid-content':
          return t('errInvalidContent')
        case 'invalid-source':
          return t('errInvalidSource')
        case 'invalid-skill':
          return t('errInvalidSkill')
        case 'invalid-skills':
          return t('errInvalidSkills')
        case 'list-unparsed':
          return t('errListUnparsed')
        case 'npx-failed':
          return t('errNpxFailed')
        default:
          return messageOf(failure)
      }
    }

    /**
     * `{n} skills` 这类带数量的标签；占位符写在词典里，中英文各自组织语序。
     *
     * @param {number} count
     * @param {function(string): string} t 翻译函数
     * @returns {string}
     */
    function countBadge(count, t) {
      return String(t('skillsBadge')).replace('{n}', String(count))
    }

    /**
     * 机器人的 skills 列表；Host 字段缺失时回退空数组，避免渲染期抛错。
     *
     * @param {object} robot
     * @returns {object[]}
     */
    function skillsOf(robot) {
      return Array.isArray(robot?.skills) ? robot.skills : []
    }

    /**
     * 机器人的 AGENTS.md 摘要；缺失时给一个「不存在」的空结构。
     *
     * @param {object} robot
     * @returns {{ exists: boolean, bytes: number, modifiedAt: string | null, content: string, tooLarge: boolean }}
     */
    function agentsOf(robot) {
      const agents = robot?.agents
      if (agents === null || typeof agents !== 'object') {
        return { exists: false, bytes: 0, modifiedAt: null, content: '', tooLarge: false }
      }
      return {
        exists: agents.exists === true,
        bytes: typeof agents.bytes === 'number' ? agents.bytes : 0,
        modifiedAt: typeof agents.modifiedAt === 'string' ? agents.modifiedAt : null,
        content: typeof agents.content === 'string' ? agents.content : '',
        tooLarge: agents.tooLarge === true,
      }
    }

    /**
     * 机器人的 CLAUDE.md 链接摘要；缺失时按「没有链接」处理。
     *
     * @param {object} robot
     * @returns {{ exists: boolean, symlink: boolean, mode: string, target: string }}
     */
    function claudeOf(robot) {
      const claude = robot?.claude
      if (claude === null || typeof claude !== 'object') {
        return { exists: false, symlink: false, mode: 'missing', target: '' }
      }
      return {
        exists: claude.exists === true,
        symlink: claude.symlink === true,
        mode: typeof claude.mode === 'string' ? claude.mode : 'missing',
        target: typeof claude.target === 'string' ? claude.target : '',
      }
    }

    /**
     * 头像 id → 预设；不认识的 id 退回第一个预设（Host 的旧记录已兜底，这里只是
     * 防御脏数据，保证页面上永远有一个头像）。
     *
     * @param {unknown} id
     * @returns {{ id: string, emoji: string, color: string, labelKey: string }}
     */
    function avatarPreset(id) {
      return (typeof id === 'string' ? AVATAR_BY_ID.get(id) : undefined) ?? AVATARS[0]
    }

    /**
     * 机器人头像：emoji 画在预设色的浅底圆片里。[size] 是直径（px）。
     *
     * @param {unknown} id 头像 id
     * @param {number} size
     * @param {string} [className]
     * @returns {object} React 元素
     */
    function renderAvatar(id, size, className = '') {
      const preset = avatarPreset(id)
      return h(
        'span',
        {
          className: `buka-robots-avatar${className === '' ? '' : ` ${className}`}`,
          style: {
            width: `${size}px`,
            height: `${size}px`,
            fontSize: `${Math.max(9, Math.round(size * 0.6))}px`,
            backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
            borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`,
          },
          'aria-hidden': true,
        },
        preset.emoji,
      )
    }

    /**
     * 通用型机器人的固定头像：🤖 画在蓝色浅底圆片里，尺寸与普通头像一致。
     *
     * @param {number} size 直径（px）
     * @returns {object} React 元素
     */
    function renderGeneralAvatar(size) {
      return h(
        'span',
        {
          className: 'buka-robots-avatar',
          style: {
            width: `${size}px`,
            height: `${size}px`,
            fontSize: `${Math.max(9, Math.round(size * 0.6))}px`,
            backgroundColor: `color-mix(in srgb, ${GENERAL_AVATAR.color} 18%, transparent)`,
            borderColor: `color-mix(in srgb, ${GENERAL_AVATAR.color} 38%, transparent)`,
          },
          'aria-hidden': true,
        },
        GENERAL_AVATAR.emoji,
      )
    }

    /**
     * 侧边栏的图标：一个机器人头（圆角矩形 + 两眼 + 天线）。侧边栏只给尺寸与
     * 选中态；颜色通过 `currentColor` 继承面板行的前景色，不自己写死颜色。
     *
     * @param {{ size: number, active?: boolean }} props 侧边栏的图标入参
     * @returns {object} React 元素
     */
    function RobotsPanelIcon({ size }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
        },
        h('rect', {
          x: 2.7,
          y: 5.2,
          width: 10.6,
          height: 8.2,
          rx: 2.6,
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('circle', { cx: 5.9, cy: 9, r: 0.95, fill: 'currentColor' }),
        h('circle', { cx: 10.1, cy: 9, r: 0.95, fill: 'currentColor' }),
        h('path', {
          d: 'M8 5.2V3.1',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 8, cy: 2.4, r: 0.9, fill: 'currentColor' }),
      )
    }

    /**
     * 侧边栏「机器人」页面。
     *
     * 页面只保存 UI 状态；机器人列表（登记表）来自 Host 的 `/buka-robots/list`，
     * 挂载 / 摘除 / 打开工作区则通过注入的 `getService` 取 DSH 的 Client
     * Service，两者都失败时用 Toast 说明原因。
     *
     * @param {{ t: function, getService: function(string): any }} props 插槽注入的文案函数与服务解析函数
     * @returns {object} React 元素
     */
    function RobotsPage(props) {
      const t = props.t
      const getService = typeof props.getService === 'function' ? props.getService : () => null

      /** 列表请求：`data` 是成功的响应，`error` 是失败原因，`loading` 覆盖首载与刷新。 */
      const [list, setList] = React.useState({ data: null, error: null, loading: true })
      const [reloadKey, setReloadKey] = React.useState(0)

      /** 列表页状态。 */
      const [name, setName] = React.useState('')
      /** 创建对话框里的描述草稿；提交时随名字一起写入登记表。 */
      const [draftDescription, setDraftDescription] = React.useState('')
      const [dialogOpen, setDialogOpen] = React.useState(false)
      const [createError, setCreateError] = React.useState(null)
      const [creating, setCreating] = React.useState(false)
      const [confirming, setConfirming] = React.useState(null)
      const [busy, setBusy] = React.useState(null)

      /**
       * 头像状态：`draftAvatar` 是创建对话框 / 「更换头像」对话框里当前选中的
       * 预设；`avatarTarget` 非空时「更换头像」对话框打开，值是机器人名。
       */
      const [draftAvatar, setDraftAvatar] = React.useState(DEFAULT_AVATAR_ID)
      const [avatarOpen, setAvatarOpen] = React.useState(false)
      const [avatarTarget, setAvatarTarget] = React.useState(null)
      const [avatarSaving, setAvatarSaving] = React.useState(false)
      /** 「更换头像」对话框里的失败提示：请求失败时留在框里，不靠会被遮住的 Toast。 */
      const [avatarError, setAvatarError] = React.useState(null)

      /**
       * 「描述」页签的草稿与保存状态；草稿在进入详情时从机器人当前描述初始化，
       * 列表刷新不会覆盖用户正在编辑的内容。
       */
      const [descriptionDraft, setDescriptionDraft] = React.useState('')
      const [descriptionSaving, setDescriptionSaving] = React.useState(false)
      const [descriptionError, setDescriptionError] = React.useState(null)

      /** 详情页状态：`selectedName` 非空时显示配置视图，`tab` 是页签。 */
      const [selectedName, setSelectedName] = React.useState(null)
      const [tab, setTab] = React.useState('agents')
      const [agentsDraft, setAgentsDraft] = React.useState('')
      const [agentsSaving, setAgentsSaving] = React.useState(false)
      const [removing, setRemoving] = React.useState(null)
      const [confirmingSkill, setConfirmingSkill] = React.useState(null)
      const [skillError, setSkillError] = React.useState(null)

      /**
       * 「安装 skills」对话框的状态。
       *
       * - `candidates.status`：`idle` 还没读 / `loading` 读取中 / `ready` 有清单 /
       *   `error` 读取失败（带命令输出）；
       * - `installSelected`：勾选的 skill 名；每次读出清单时默认全选未安装的；
       * - `favourites.status`：`unavailable` 表示 Skills 插件没安装（整块隐藏，
       *   不是错误），`ready` 时 `repos` 是收藏仓库。
       */
      const [installOpen, setInstallOpen] = React.useState(false)
      const [installSource, setInstallSource] = React.useState('')
      const [installCandidates, setInstallCandidates] = React.useState({
        status: 'idle',
        skills: [],
        installed: [],
        error: null,
        output: '',
      })
      const [installSelected, setInstallSelected] = React.useState([])
      const [installError, setInstallError] = React.useState(null)
      const [installing, setInstalling] = React.useState(false)
      const [favourites, setFavourites] = React.useState({ status: 'idle', repos: [] })

      /** Toast 文案；同一时刻只保留最后一条。 */
      const [notice, setNotice] = React.useState(null)

      /**
       * 通用型机器人「进入工作区」对话框：`workspacesState` 是 Host 返回的工作区
       * 清单，`workspaceBusy` 是正在打开的工作区 id（防连点）。
       */
      const [workspacesOpen, setWorkspacesOpen] = React.useState(false)
      const [workspacesState, setWorkspacesState] = React.useState({ status: 'idle', items: [], error: null })
      const [workspaceBusy, setWorkspaceBusy] = React.useState(null)

      /** 设置对话框：通用型机器人开关的保存中 / 失败状态。 */
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [settingsSaving, setSettingsSaving] = React.useState(false)
      const [settingsError, setSettingsError] = React.useState(null)

      // 首次挂载与每次刷新（reloadKey 变化）都重新读 Host 的机器人登记表。
      React.useEffect(() => {
        let cancelled = false
        setList((prev) => ({ ...prev, loading: true, error: null }))
        requestJson(LIST_ROUTE).then(
          (body) => {
            if (!cancelled) setList({ data: body, error: null, loading: false })
          },
          (failure) => {
            if (!cancelled) setList((prev) => ({ ...prev, error: messageOf(failure), loading: false }))
          },
        )
        return () => {
          cancelled = true
        }
      }, [reloadKey])

      // 「进入工作区」对话框每次打开都重新读一遍工作区：用户可能刚在侧边栏
      // 新建 / 删除了工作区。关掉对话框后回来的响应直接丢弃。
      React.useEffect(() => {
        if (!workspacesOpen) return
        let cancelled = false
        setWorkspacesState({ status: 'loading', items: [], error: null })
        requestJson(WORKSPACES_ROUTE).then(
          (body) => {
            if (cancelled) return
            const items = Array.isArray(body?.workspaces) ? body.workspaces : []
            setWorkspacesState({ status: 'ready', items, error: null })
          },
          (failure) => {
            if (!cancelled) {
              setWorkspacesState({
                status: 'error',
                items: [],
                error: `${t('workspacesFailed')} ${messageOf(failure)}`,
              })
            }
          },
        )
        return () => {
          cancelled = true
        }
      }, [workspacesOpen])

      const data = list.data
      const robots = Array.isArray(data?.robots) ? data.robots : []
      const registry = typeof data?.registry === 'string' ? data.registry : ''
      const corrupt = data?.corrupt === true
      /** 通用型机器人开关；列表响应里带回来，设置对话框保存后局部更新。 */
      const generalEnabled = data?.general?.enabled === true
      const selectedRobot = selectedName === null ? null : (robots.find((robot) => robot.name === selectedName) ?? null)

      /** 任意写操作进行中：按钮据此统一禁用，避免并发请求互相覆盖。 */
      const mutating =
        creating ||
        busy !== null ||
        installing ||
        removing !== null ||
        agentsSaving ||
        avatarSaving ||
        descriptionSaving

      /**
       * 新建机器人时的默认头像：按预设顺序挑第一个还没被占用的，避免刚建的一批
       * 机器人全是一个样子（Host 也会在没传头像时做同样的分配）。
       *
       * @returns {string}
       */
      function nextAvatarId() {
        const used = new Set(robots.map((robot) => avatarPreset(robot.avatar).id))
        const free = AVATARS.find((preset) => !used.has(preset.id))
        return (free ?? AVATARS[0]).id
      }

      // 详情里的机器人被外部移除（刷新后不在登记表里）时回到列表页，避免停在
      // 一个永远加载不出来的配置页。
      React.useEffect(() => {
        if (data === null || selectedName === null) return
        if (!robots.some((robot) => robot.name === selectedName)) setSelectedName(null)
      }, [data, selectedName])

      /**
       * 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
       *
       * @param {'success' | 'error'} kind
       * @param {string} text
       */
      function flash(kind, text) {
        setNotice({ kind, text, seq: Date.now() + Math.random() })
      }

      /** 重新读一次机器人列表（新建 / 挂载 / 删除 / 安装 skill 之后都会调用）。 */
      function reload() {
        setReloadKey((key) => key + 1)
      }

      /**
       * 用 Host 的响应局部更新一个机器人，不整表刷新，避免详情页闪烁。
       *
       * @param {string} robotName 机器人登记名
       * @param {object} patch 要覆盖的字段
       */
      function patchRobot(robotName, patch) {
        setList((prev) => {
          if (prev.data === null || !Array.isArray(prev.data.robots)) return prev
          return {
            ...prev,
            data: {
              ...prev.data,
              robots: prev.data.robots.map((robot) => (robot.name === robotName ? { ...robot, ...patch } : robot)),
            },
          }
        })
      }

      /**
       * 取一个 DSH Client Service；插件上下文里不存在时返回 null，而不是抛错。
       *
       * @param {string} serviceName
       * @returns {any | null}
       */
      function service(serviceName) {
        try {
          return getService(serviceName)
        } catch {
          return null
        }
      }

      /**
       * 进入配置视图：从列表返回值初始化 AGENTS.md 草稿，并清掉上一个机器人的
       * 临时状态。之后刷新列表不会覆盖这份草稿（用户可能正在编辑）。
       *
       * @param {object} robot 一条机器人记录
       */
      function openDetail(robot) {
        setSelectedName(robot.name)
        setTab('agents')
        setAgentsDraft(agentsOf(robot).content)
        setDescriptionDraft(typeof robot.description === 'string' ? robot.description : '')
        setDescriptionError(null)
        setSkillError(null)
        setConfirmingSkill(null)
        setInstallOpen(false)
        setInstallError(null)
        setNotice(null)
      }

      /** 返回列表页，并清掉详情页临时状态。 */
      function backToList() {
        setSelectedName(null)
        setDescriptionError(null)
        setSkillError(null)
        setConfirmingSkill(null)
        setInstallOpen(false)
        setInstallError(null)
        setNotice(null)
      }

      /**
       * 切换详情页签；切换时收起 Toast，避免旧提示留在新页签上方。
       *
       * @param {string} next 页签名
       */
      function switchTab(next) {
        if (next === tab) return
        setNotice(null)
        setTab(next)
      }

      /**
       * 打开机器人会话：只有已挂载（有 workspaceId）才能打开；否则提示先挂载。
       * 打开走 DSH 的 `uiWorkspace.openWorkspace(workspaceId)`。
       *
       * @param {object} robot 一条机器人记录
       */
      async function openRobot(robot) {
        if (robot.mounted !== true || typeof robot.workspaceId !== 'string' || robot.workspaceId === '') {
          flash('error', t('openUnmounted'))
          return
        }
        const uiWorkspace = service('uiWorkspace')
        if (uiWorkspace === null || typeof uiWorkspace.openWorkspace !== 'function') {
          flash('error', t('noUiWorkspace'))
          return
        }
        setBusy(`open:${robot.name}`)
        try {
          await uiWorkspace.openWorkspace(robot.workspaceId)
        } catch (failure) {
          flash('error', `${t('openFailed')} ${messageOf(failure)}`)
        } finally {
          setBusy(null)
        }
      }

      /** 打开通用型机器人的「进入工作区」对话框；实际读取由上面的 effect 负责。 */
      function openWorkspacePicker() {
        if (mutating || workspaceBusy !== null) return
        setWorkspacesOpen(true)
      }

      /** 关闭「进入工作区」对话框；正在打开工作区时不响应关闭。 */
      function closeWorkspacePicker() {
        if (workspaceBusy !== null) return
        setWorkspacesOpen(false)
      }

      /**
       * 进入一个已有工作区：通用型机器人就是一个普通的标准模式会话，所以这里
       * 显式指定 `agentPreset: 'standard'`，不复用工作区里别的 preset 的空会话。
       * 打开成功后对话框关闭，主区域切到该工作区。
       *
       * @param {{ id: string, title: string, path: string }} workspace 工作区
       */
      async function enterWorkspace(workspace) {
        if (workspaceBusy !== null) return
        const uiWorkspace = service('uiWorkspace')
        if (uiWorkspace === null || typeof uiWorkspace.openWorkspace !== 'function') {
          flash('error', t('noUiWorkspace'))
          return
        }
        setWorkspaceBusy(workspace.id)
        setWorkspacesState((prev) => ({ ...prev, error: null }))
        try {
          await uiWorkspace.openWorkspace(workspace.id, undefined, { agentPreset: 'standard' })
          setWorkspacesOpen(false)
        } catch (failure) {
          setWorkspacesState((prev) => ({
            ...prev,
            error: `${t('workspaceOpenFailed')} ${messageOf(failure)}`,
          }))
        } finally {
          setWorkspaceBusy(null)
        }
      }

      /** 打开设置对话框；开关当前值来自列表响应里的 `general.enabled`。 */
      function openSettingsDialog() {
        setSettingsError(null)
        setSettingsOpen(true)
      }

      /** 关闭设置对话框；保存中不响应关闭。 */
      function closeSettingsDialog() {
        if (settingsSaving) return
        setSettingsOpen(false)
        setSettingsError(null)
      }

      /**
       * 启用 / 停用通用型机器人：写 Host 的设置文件，成功后只局部更新列表。
       * 停用后列表里的内置卡片立刻消失，再打开设置对话框仍可重新启用。
       *
       * @param {boolean} enabled 新的开关值
       */
      async function saveGeneralEnabled(enabled) {
        if (settingsSaving) return
        setSettingsSaving(true)
        setSettingsError(null)
        try {
          const body = await requestJson(SETTINGS_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ general: { enabled } }),
          })
          const saved = body?.general?.enabled === true
          setList((prev) =>
            prev.data === null ? prev : { ...prev, data: { ...prev.data, general: { enabled: saved } } },
          )
        } catch (failure) {
          setSettingsError(`${t('settingsSaveFailed')} ${messageOf(failure)}`)
        } finally {
          setSettingsSaving(false)
        }
      }

      /**
       * 用系统文件管理器打开机器人目录（macOS 上是 Finder）。
       *
       * 成功不弹提示：Finder 窗口本身就是反馈；失败用 Toast 说明。
       *
       * @param {object} robot 一条机器人记录
       */
      async function revealRobot(robot) {
        if (mutating) return
        setBusy(`reveal:${robot.name}`)
        try {
          await requestJson(REVEAL_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: robot.name }),
          })
        } catch (failure) {
          const extra = failure?.code === 'reveal-failed' ? '' : ` ${failureText(t, failure)}`
          flash('error', `${t('revealFailed')}${extra}`)
        } finally {
          setBusy(null)
        }
      }

      /**
       * 把机器人挂载成 DSH 工作区：目录已经由 Host 建好，这里只调用
       * `workspaces.create({ path })`，成功后刷新列表让卡片变成「已挂载」。
       *
       * @param {object} robot 一条机器人记录
       */
      async function mountRobot(robot) {
        const workspaces = service('workspaces')
        if (workspaces === null || typeof workspaces.create !== 'function') {
          flash('error', t('noWorkspacesCreate'))
          return
        }
        setBusy(`mount:${robot.name}`)
        try {
          await workspaces.create({ path: robot.path })
          flash('success', `${t('mounted')} ${robot.name}`)
          reload()
        } catch (failure) {
          flash('error', `${t('mountFailed')} ${messageOf(failure)}`)
        } finally {
          setBusy(null)
        }
      }

      /** 打开「创建机器人」对话框：清掉上一次的输入，并按现有机器人挑一个新头像。 */
      function openCreateDialog() {
        if (creating || corrupt) return
        setName('')
        setDraftDescription('')
        setDraftAvatar(nextAvatarId())
        setCreateError(null)
        setDialogOpen(true)
      }

      /** 关闭「创建机器人」对话框；提交中不响应关闭，避免请求回来时状态错位。 */
      function closeCreateDialog() {
        if (creating) return
        setDialogOpen(false)
        setCreateError(null)
      }

      /**
       * 打开「更换头像」对话框：草稿从机器人当前头像开始。
       *
       * @param {object} robot 一条机器人记录
       */
      function openAvatarDialog(robot) {
        if (mutating) return
        setAvatarTarget(robot.name)
        setDraftAvatar(avatarPreset(robot.avatar).id)
        setAvatarError(null)
        setAvatarOpen(true)
      }

      /** 关闭「更换头像」对话框；保存中不响应关闭。 */
      function closeAvatarDialog() {
        if (avatarSaving) return
        setAvatarOpen(false)
        setAvatarTarget(null)
        setAvatarError(null)
      }

      /** 保存头像：成功后只局部更新那一个机器人，详情页不闪烁。 */
      async function saveAvatar() {
        if (avatarTarget === null || avatarSaving) return
        setAvatarSaving(true)
        setAvatarError(null)
        try {
          const body = await requestJson(AVATAR_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: avatarTarget, avatar: draftAvatar }),
          })
          const saved = body?.robot?.avatar
          patchRobot(avatarTarget, { avatar: typeof saved === 'string' ? saved : draftAvatar })
          flash('success', t('avatarUpdated'))
          setAvatarOpen(false)
          setAvatarTarget(null)
        } catch (failure) {
          setAvatarError(`${t('avatarSaveFailed')} ${failureText(t, failure)}`)
        } finally {
          setAvatarSaving(false)
        }
      }

      /**
       * 描述草稿的规范化（与 Host 一致：折叠空白并 trim）；用来判断有没有改动。
       *
       * @param {unknown} value
       * @returns {string}
       */
      function normalizedDescription(value) {
        return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
      }

      /**
       * 保存「描述」页签：Host 折叠空白后写进登记表。工作流通过 `buka_robots`
       * 工具读它，决定是否把节点交给这个机器人；保存成功后只局部更新列表。
       */
      async function saveDescription() {
        if (selectedName === null || descriptionSaving) return
        setDescriptionSaving(true)
        setDescriptionError(null)
        try {
          const body = await requestJson(DESCRIPTION_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: selectedName, description: descriptionDraft }),
          })
          const saved = body?.robot?.description
          const next = typeof saved === 'string' ? saved : normalizedDescription(descriptionDraft)
          patchRobot(selectedName, { description: next })
          setDescriptionDraft(next)
          flash('success', t('descriptionSaved'))
        } catch (failure) {
          setDescriptionError(`${t('descriptionSaveFailed')} ${failureText(t, failure)}`)
        } finally {
          setDescriptionSaving(false)
        }
      }

      /**
       * 新建机器人：Host 先建目录并写入登记表，浏览器再把它挂载成工作区。
       * 挂载失败不会撤销机器人 —— 它会以「未挂载」留在列表里，可稍后点「挂载」。
       * 创建请求本身的失败留在对话框里原地提示，不用关掉重开。
       *
       * @param {object} event 表单提交事件
       */
      async function createRobot(event) {
        event.preventDefault()
        if (creating || corrupt) return
        const value = name.trim()
        if (value === '') {
          setCreateError(t('createEmpty'))
          return
        }
        setCreating(true)
        setCreateError(null)
        try {
          const body = await requestJson(CREATE_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: value, avatar: draftAvatar, description: draftDescription }),
          })
          setName('')
          setDialogOpen(false)
          const robotPath = body?.robot?.path
          if (typeof robotPath !== 'string' || robotPath === '') {
            flash('error', `${t('createFailed')} ${messageOf('host did not return the robot path')}`)
            reload()
            return
          }
          const workspaces = service('workspaces')
          if (workspaces === null || typeof workspaces.create !== 'function') {
            flash('error', t('noWorkspacesCreate'))
            reload()
            return
          }
          const created = body?.created !== false
          try {
            await workspaces.create({ path: robotPath })
            flash('success', `${created ? t('created') : t('createExisting')} ${value}`)
          } catch (failure) {
            // 目录与登记已经落盘，挂载失败只影响「已挂载」状态，刷新后仍可重试。
            flash('error', `${t('createMountFailed')} ${messageOf(failure)}`)
          }
          reload()
        } catch (failure) {
          setCreateError(`${t('createFailed')} ${failureText(t, failure)}`)
        } finally {
          setCreating(false)
        }
      }

      /**
       * 删除机器人：先摘掉 DSH 工作区注册（若已挂载），再删插件登记记录。
       * 机器人目录与文件保留，这也是二次确认文案要说明的语义。
       *
       * @param {object} robot 一条机器人记录
       */
      async function removeRobot(robot) {
        setBusy(`delete:${robot.name}`)
        try {
          if (robot.mounted === true && typeof robot.workspaceId === 'string' && robot.workspaceId !== '') {
            const workspaces = service('workspaces')
            if (workspaces === null || typeof workspaces.delete !== 'function') {
              flash('error', t('noWorkspacesDelete'))
              return
            }
            try {
              await workspaces.delete(robot.workspaceId)
            } catch (failure) {
              flash('error', `${t('deleteFailed')} ${messageOf(failure)}`)
              return
            }
          }
          try {
            await requestJson(REMOVE_ROUTE, {
              method: 'POST',
              body: JSON.stringify({ name: robot.name }),
            })
          } catch (failure) {
            // 工作区注册可能已经摘掉；刷新让卡片回到真实状态，确认按钮保留可重试。
            flash('error', `${t('deleteFailed')} ${failureText(t, failure)}`)
            reload()
            return
          }
          setConfirming(null)
          if (selectedName === robot.name) setSelectedName(null)
          reload()
          flash('success', `${t('deleted')} ${robot.name}`)
        } finally {
          setBusy(null)
        }
      }

      /**
       * 保存 AGENTS.md：Host 按机器人 name 解析目录并写文件，返回值里带字节数
       * 与修改时间，用来更新本地摘要。
       *
       * @param {object} robot 一条机器人记录
       */
      async function saveAgents(robot) {
        if (agentsSaving) return
        const content = agentsDraft
        if (content === agentsOf(robot).content) return
        setAgentsSaving(true)
        try {
          const body = await requestJson(AGENTS_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: robot.name, content }),
          })
          patchRobot(robot.name, {
            agents: {
              ...agentsOf(robot),
              exists: true,
              bytes: typeof body.bytes === 'number' ? body.bytes : agentsOf(robot).bytes,
              modifiedAt: typeof body.modifiedAt === 'string' ? body.modifiedAt : agentsOf(robot).modifiedAt,
              content,
              tooLarge: false,
            },
          })
          flash('success', t('agentsSaved'))
        } catch (failure) {
          flash('error', `${t('agentsSaveFailed')} ${failureText(t, failure)}`)
        } finally {
          setAgentsSaving(false)
        }
      }

      /**
       * 读 Skills 插件的收藏仓库。只读它已经存在的 `GET /buka-skills/repos`：
       * 两个插件之间不 import，这个路由回 404（插件没装）或任何失败都按
       * 「没有收藏夹」处理，页面不显示这一块也不报错。
       */
      function loadFavourites() {
        if (favourites.status === 'loading' || favourites.status === 'ready') return
        setFavourites((prev) => ({ ...prev, status: 'loading' }))
        requestJson(SKILLS_REPOS_ROUTE).then(
          (body) => {
            const repos = (Array.isArray(body?.repos) ? body.repos : [])
              .filter(
                (repo) =>
                  repo !== null &&
                  typeof repo === 'object' &&
                  typeof repo.source === 'string' &&
                  repo.source !== '',
              )
              .map((repo) => ({
                id: typeof repo.id === 'string' && repo.id !== '' ? repo.id : repo.source,
                source: repo.source,
                note: typeof repo.note === 'string' ? repo.note : '',
              }))
            setFavourites({ status: 'ready', repos })
          },
          () => setFavourites({ status: 'unavailable', repos: [] }),
        )
      }

      /** 打开「安装 skills」对话框：清掉上一次的来源、候选与勾选，并按需加载收藏夹。 */
      function openInstallDialog() {
        if (installing || corrupt) return
        setInstallSource('')
        setInstallCandidates({ status: 'idle', skills: [], installed: [], error: null, output: '' })
        setInstallSelected([])
        setInstallError(null)
        setInstallOpen(true)
        loadFavourites()
      }

      /** 关闭「安装 skills」对话框；安装中不响应关闭，避免请求回来时状态错位。 */
      function closeInstallDialog() {
        if (installing) return
        setInstallOpen(false)
        setInstallError(null)
      }

      /**
       * 读一个来源里的 skills 清单并默认勾选全部未安装的。
       *
       * @param {string} [sourceOverride] 收藏夹按钮传进来的来源；缺省用输入框内容
       */
      async function loadCandidates(sourceOverride) {
        if (installing || selectedRobot === null) return
        const value = (sourceOverride ?? installSource).trim()
        if (value === '') {
          setInstallCandidates({
            status: 'error',
            skills: [],
            installed: [],
            error: t('errInvalidSource'),
            output: '',
          })
          return
        }
        setInstallSource(value)
        setInstallCandidates({ status: 'loading', skills: [], installed: [], error: null, output: '' })
        setInstallError(null)
        try {
          const body = await requestJson(AVAILABLE_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: selectedRobot.name, source: value }),
          })
          const skills = (Array.isArray(body?.skills) ? body.skills : []).filter(
            (skill) => skill !== null && typeof skill === 'object' && typeof skill.name === 'string' && skill.name !== '',
          )
          const installed = new Set(
            (Array.isArray(body?.installed) ? body.installed : []).map((name) => String(name)),
          )
          // 列表里的 skills 可能还没重新扫描过：把机器人现有的也并进来，保证已安装项一定禁用。
          for (const skill of skillsOf(selectedRobot)) installed.add(String(skill.name))
          setInstallCandidates({
            status: 'ready',
            skills,
            installed: [...installed],
            error: null,
            output: '',
          })
          setInstallSelected(skills.filter((skill) => !installed.has(skill.name)).map((skill) => skill.name))
        } catch (failure) {
          setInstallCandidates({
            status: 'error',
            skills: [],
            installed: [],
            error: failureText(t, failure),
            output: typeof failure?.output === 'string' ? failure.output : '',
          })
        }
      }

      /**
       * 勾选 / 取消一个候选 skill。
       *
       * @param {string} skillName
       */
      function toggleCandidate(skillName) {
        setInstallSelected((prev) =>
          prev.includes(skillName) ? prev.filter((name) => name !== skillName) : [...prev, skillName],
        )
      }

      /**
       * 全选 / 取消全选（已安装的不参与）。
       *
       * @param {boolean} checked
       */
      function selectAllCandidates(checked) {
        const installed = new Set(installCandidates.installed)
        const selectable = installCandidates.skills
          .filter((skill) => !installed.has(skill.name))
          .map((skill) => skill.name)
        setInstallSelected(checked ? selectable : [])
      }

      /**
       * 安装勾选的 skills：Host 在机器人目录里跑
       * `npx skills add <source> --skill … -a universal -a claude-code -y`，
       * 同时落 `.agents/skills` 与 `.claude/skills`；成功响应带新的 skills 列表。
       */
      async function installSelectedSkills() {
        if (installing || selectedRobot === null) return
        if (installSelected.length === 0) {
          setInstallError({ message: t('installEmptySelection'), output: '' })
          return
        }
        setInstalling(true)
        setInstallError(null)
        try {
          const body = await requestJson(INSTALL_ROUTE, {
            method: 'POST',
            body: JSON.stringify({
              name: selectedRobot.name,
              source: installSource.trim(),
              skills: installSelected,
            }),
          })
          patchRobot(selectedRobot.name, {
            skills: Array.isArray(body.skills) ? body.skills : [],
            claude: body.claude !== null && typeof body.claude === 'object' ? body.claude : claudeOf(selectedRobot),
          })
          setInstallOpen(false)
          flash('success', `${t('skillInstalled')} ${installSource.trim()}`)
        } catch (failure) {
          setInstallError({
            message: failureText(t, failure),
            output: typeof failure?.output === 'string' ? failure.output : '',
          })
        } finally {
          setInstalling(false)
        }
      }

      /**
       * 移除项目级 skill：Host 执行 `npx skills remove <skill> -y` 并返回新的
       * skills 列表；请求体字段是 `{ name, skill }`（v2 契约）。
       *
       * @param {object} robot 一条机器人记录
       * @param {{ name: string }} skill 一条已安装的 skill
       */
      async function removeSkill(robot, skill) {
        if (removing !== null) return
        setRemoving(skill.name)
        setSkillError(null)
        try {
          const body = await requestJson(SKILL_REMOVE_ROUTE, {
            method: 'POST',
            body: JSON.stringify({ name: robot.name, skill: skill.name }),
          })
          patchRobot(robot.name, { skills: Array.isArray(body.skills) ? body.skills : [] })
          setConfirmingSkill(null)
          flash('success', `${t('skillRemoved')} ${skill.name}`)
        } catch (failure) {
          setSkillError({ message: failureText(t, failure), output: failure.output ?? '' })
        } finally {
          setRemoving(null)
        }
      }

      /**
       * 预设头像选择器：圆形 emoji 按钮的网格，选中项有描边。创建对话框与
       * 「更换头像」对话框共用；`disabled` 时整组不可点。
       *
       * @param {string} current 当前选中的头像 id
       * @param {boolean} disabled
       * @returns {object} React 元素
       */
      function renderAvatarPicker(current, disabled) {
        return h(
          'div',
          { className: 'buka-robots-avatarGrid', role: 'radiogroup', 'aria-label': t('chooseAvatar') },
          ...AVATARS.map((preset) =>
            h(
              'button',
              {
                key: preset.id,
                type: 'button',
                role: 'radio',
                'aria-checked': preset.id === current,
                'aria-label': t(preset.labelKey),
                title: t(preset.labelKey),
                className: `buka-robots-avatarOption${preset.id === current ? ' is-selected' : ''}`,
                disabled,
                onClick: () => setDraftAvatar(preset.id),
              },
              renderAvatar(preset.id, 30),
            ),
          ),
        )
      }

      /**
       * 挂载状态标签：已挂载用 success，未挂载用 neutral。
       *
       * @param {object} robot 一条机器人记录
       * @returns {object} React 元素
       */
      function renderMountedTag(robot) {
        return h(Tag, { tone: robot.mounted === true ? 'success' : 'neutral' },
          robot.mounted === true ? t('mountedBadge') : t('unmountedBadge'))
      }

      /**
       * 通用型机器人卡片：固定 🤖 头像 + 标准模式标签，唯一的动作是「进入工作区」。
       * 它没有目录、AGENTS.md 与 skills，所以不显示挂载状态、配置与删除。
       *
       * @returns {object} React 元素
       */
      function renderGeneralCard() {
        return h(
          'li',
          { className: 'buka-robots-card', key: '__general__' },
          h(
            'div',
            { className: 'buka-robots-cardHead' },
            h(
              'div',
              { className: 'buka-robots-titleRow' },
              h(
                'div',
                { className: 'buka-robots-titleCluster' },
                renderGeneralAvatar(26),
                h('span', { className: 'buka-robots-cardTitle' }, t('generalTitle')),
              ),
              h(
                'div',
                { className: 'buka-robots-titleActions' },
                h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    icon: h(IconChevronRightOutlineRegular, { size: 13 }),
                    disabled: mutating || workspaceBusy !== null,
                    'aria-label': `${t('enterWorkspace')} ${t('generalTitle')}`,
                    onClick: openWorkspacePicker,
                  },
                  t('enterWorkspace'),
                ),
              ),
            ),
            h('p', { className: 'buka-robots-intro' }, t('generalIntro')),
          ),
        )
      }

      /**
       * 一条机器人卡片：名称、skills / AGENTS.md / 挂载状态、路径、动作与删除确认。
       *
       * @param {object} robot 一条机器人记录
       * @returns {object} React 元素
       */
      function renderRobotCard(robot) {
        const skills = skillsOf(robot)
        const agents = agentsOf(robot)
        const confirmingThis = confirming === robot.name
        const missing = robot.exists === false
        const mounted = robot.mounted === true
        const anyBusy = mutating || corrupt

        const actions = confirmingThis
          ? [
              h(
                Button,
                {
                  key: 'confirm',
                  variant: 'outline',
                  size: 'sm',
                  className: 'buka-robots-danger',
                  icon: h(IconWarningOutlineRegular, { size: 13 }),
                  disabled: anyBusy,
                  onClick: () => removeRobot(robot),
                },
                t('confirmDelete'),
              ),
              h(
                Button,
                {
                  key: 'cancel',
                  variant: 'ghost',
                  size: 'sm',
                  disabled: mutating,
                  onClick: () => setConfirming(null),
                },
                t('cancel'),
              ),
            ]
          : [
              h(
                Button,
                {
                  key: 'open',
                  variant: 'outline',
                  size: 'sm',
                  icon: h(IconNewChatOutlineRegular, { size: 13 }),
                  disabled: mutating,
                  'aria-label': `${t('newSession')} ${robot.name}`,
                  onClick: () => openRobot(robot),
                },
                t('newSession'),
              ),
              mounted
                ? null
                : h(
                    Button,
                    {
                      key: 'mount',
                      variant: 'outline',
                      size: 'sm',
                      icon: busy === `mount:${robot.name}`
                        ? h(StateDot, { state: 'ongoing', size: 13 })
                        : h(IconPlusOutlineRegular, { size: 13 }),
                      disabled: anyBusy,
                      'aria-label': `${t('mount')} ${robot.name}`,
                      onClick: () => mountRobot(robot),
                    },
                    busy === `mount:${robot.name}` ? t('mounting') : t('mount'),
                  ),
              h(
                Button,
                {
                  key: 'configure',
                  variant: 'outline',
                  size: 'sm',
                  disabled: mutating,
                  'aria-label': `${t('configure')} ${robot.name}`,
                  onClick: () => openDetail(robot),
                },
                t('configure'),
              ),
              h(
                Tooltip,
                { key: 'delete', label: t('delete'), side: 'top', delayMs: 400 },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-robots-iconButton buka-robots-iconDanger',
                    'aria-label': `${t('delete')} ${robot.name}`,
                    disabled: anyBusy,
                    onClick: () => setConfirming(robot.name),
                  },
                  h(IconTrashOutlineRegular, { size: 16 }),
                ),
              ),
            ]

        return h(
          'li',
          { className: 'buka-robots-card', key: robot.name, 'aria-busy': busy !== null ? true : undefined },
          h(
            'div',
            { className: 'buka-robots-cardHead' },
            h(
              'div',
              { className: 'buka-robots-titleRow' },
              h(
                'div',
                { className: 'buka-robots-titleCluster' },
                renderAvatar(robot.avatar, 26),
                h('span', { className: 'buka-robots-cardTitle', title: robot.name }, String(robot.name ?? '')),
                renderMountedTag(robot),
                h(Tag, { tone: 'neutral' }, countBadge(skills.length, t)),
                h(Tag, { tone: agents.exists ? 'success' : 'neutral' }, agents.exists ? t('agentsBadge') : t('noAgentsBadge')),
                missing ? h(Tag, { tone: 'warning' }, t('missingDir')) : null,
              ),
              h('div', { className: 'buka-robots-titleActions' }, ...actions.filter(Boolean)),
            ),
            // 描述是工作流选择机器人的依据，列表里直接展示，避免必须点进详情才能比较。
            typeof robot.description === 'string' && robot.description !== ''
              ? h('p', { className: 'buka-robots-cardDesc' }, robot.description)
              : null,
            missing ? h('p', { className: 'buka-robots-hint' }, t('missingDirHint')) : null,
            confirmingThis ? h('p', { className: 'buka-robots-hint' }, t('deleteHint')) : null,
          ),
        )
      }

      /** 列表页：登记文件提示、加载 / 失败 / 空状态与机器人卡片（不展示目录）。 */
      function renderList() {
        const corruptNotice = corrupt
          ? h(
              'p',
              { className: 'buka-robots-notice', role: 'status' },
              h(IconWarningOutlineRegular, { size: 16 }),
              h(
                'span',
                null,
                t('corruptNote'),
                ' ',
                h('code', { className: 'buka-robots-inlineCode' }, registry),
              ),
            )
          : null

        return h(
          'div',
          { className: 'buka-robots-pageBody' },
          corruptNotice,
          list.error === null
            ? null
            : h(
                'p',
                { className: 'buka-robots-failure', role: 'alert' },
                h(StateDot, { state: 'error' }),
                `${t('loadFailed')} ${list.error}`,
              ),
          list.loading && data === null
            ? h(
                'p',
                { className: 'buka-robots-statusWithDot', role: 'status' },
                h(StateDot, { state: 'ongoing' }),
                t('loading'),
              )
            : null,
          data === null
            ? null
            : robots.length === 0 && !generalEnabled && !list.loading && !corrupt
              ? h('p', { className: 'buka-robots-empty' }, t('empty'))
              : h(
                  'ul',
                  { className: 'buka-robots-cards' },
                  generalEnabled ? renderGeneralCard() : null,
                  ...robots.map((robot) => renderRobotCard(robot)),
                ),
        )
      }

      /**
       * 技能区块：来源输入 + 安装按钮、失败输出、已安装列表与移除确认。
       *
       * @param {object} robot 一条机器人记录
       * @returns {object} React 元素
       */
      function renderSkills(robot) {
        const skills = skillsOf(robot)
        const anyBusy = mutating

        const rows = skills.map((skill, index) => {
          const confirmingThis = confirmingSkill === skill.name
          const removingThis = removing === skill.name
          const actions = removingThis
            ? h(
                'span',
                { className: 'buka-robots-statusWithDot' },
                h(StateDot, { state: 'ongoing', size: 13 }),
                t('removing'),
              )
            : confirmingThis
              ? [
                  h(
                    Button,
                    {
                      key: 'confirm',
                      variant: 'outline',
                      size: 'sm',
                      className: 'buka-robots-danger',
                      icon: h(IconWarningOutlineRegular, { size: 13 }),
                      disabled: anyBusy,
                      onClick: () => removeSkill(robot, skill),
                    },
                    t('confirmRemoveSkill'),
                  ),
                  h(
                    Button,
                    {
                      key: 'cancel',
                      variant: 'ghost',
                      size: 'sm',
                      disabled: anyBusy,
                      onClick: () => setConfirmingSkill(null),
                    },
                    t('cancel'),
                  ),
                ]
              : h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    className: 'buka-robots-danger',
                    icon: h(IconTrashOutlineRegular, { size: 13 }),
                    disabled: anyBusy,
                    'aria-label': `${t('removeSkill')} ${skill.name}`,
                    onClick: () => setConfirmingSkill(skill.name),
                  },
                  t('removeSkill'),
                )

          return h(
            'li',
            { className: 'buka-robots-skillRow', key: `${String(skill.name)}:${index}` },
            h(
              'div',
              { className: 'buka-robots-skillHead' },
              h('span', { className: 'buka-robots-skillName' }, String(skill.name)),
              typeof skill.source === 'string' && skill.source !== ''
                ? h(Tag, { tone: 'info' }, skill.source)
                : null,
              h('span', { className: 'buka-robots-skillActions' }, ...(Array.isArray(actions) ? actions : [actions])),
            ),
            typeof skill.description === 'string' && skill.description !== ''
              ? h('div', { className: 'buka-robots-skillDesc', title: skill.description }, skill.description)
              : null,
          )
        })

        return h(
          'section',
          { className: 'buka-robots-section', 'aria-busy': anyBusy ? true : undefined },
          h(
            'div',
            { className: 'buka-robots-sectionHead' },
            h('h2', { className: 'buka-robots-sectionTitle' }, t('skillsTitle')),
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                className: 'buka-robots-toolbarButton',
                icon: h(IconPlusOutlineRegular, { size: 13 }),
                disabled: mutating || corrupt || robot.exists === false,
                onClick: openInstallDialog,
              },
              t('installSkills'),
            ),
          ),
          h(
            'p',
            { className: 'buka-robots-intro' },
            t('skillsIntroBefore'),
            h('code', { className: 'buka-robots-inlineCode' }, 'npx skills add <source>'),
            t('skillsIntroMiddle'),
            h('code', { className: 'buka-robots-inlineCode' }, '.agents/skills'),
            t('skillsIntroAfter'),
          ),
          skillError === null
            ? null
            : h(
                'div',
                { className: 'buka-robots-alert', role: 'alert' },
                h(
                  'div',
                  { className: 'buka-robots-alertHead' },
                  h(IconWarningOutlineRegular, { size: 16 }),
                  h('span', null, `${t('skillErrorTitle')} ${skillError.message}`),
                ),
                typeof skillError.output === 'string' && skillError.output !== ''
                  ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'buka-robots-outputLabel' }, t('outputLabel')),
                      h('pre', { className: 'buka-robots-output' }, skillError.output),
                    )
                  : null,
              ),
          skills.length === 0
            ? h('p', { className: 'buka-robots-empty' }, t('skillsEmpty'))
            : h('ul', { className: 'buka-robots-skillList' }, ...rows),
        )
      }

      /**
       * AGENTS.md 页签：过大时只给提示；否则是可编辑 textarea + dirty 才可用的
       * 保存按钮。页面不展示目录与 CLAUDE.md 链接状态（链接由 Host 自动维护）。
       *
       * @param {object} robot 一条机器人记录
       * @returns {object} React 元素
       */
      function renderAgents(robot) {
        const agents = agentsOf(robot)
        const dirty = !agents.tooLarge && agentsDraft !== agents.content

        if (agents.tooLarge) {
          return h(
            'section',
            { className: 'buka-robots-section' },
            h('h2', { className: 'buka-robots-sectionTitle' }, t('agentsTitle')),
            h(
              'p',
              { className: 'buka-robots-notice', role: 'status' },
              h(IconWarningOutlineRegular, { size: 16 }),
              h('span', null, t('agentsTooLarge')),
            ),
          )
        }

        return h(
          'section',
          { className: 'buka-robots-section buka-robots-agentsSection', 'aria-busy': agentsSaving ? true : undefined },
          h(
            'div',
            { className: 'buka-robots-sectionHead' },
            h('h2', { className: 'buka-robots-sectionTitle' }, t('agentsTitle')),
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                type: 'button',
                className: 'buka-robots-submit',
                disabled: !dirty || mutating,
                onClick: () => saveAgents(robot),
              },
              agentsSaving ? t('saving') : t('save'),
            ),
          ),
          agents.exists
            ? null
            : h('p', { className: 'buka-robots-meta' }, t('agentsMissingHint')),
          h('textarea', {
            className: 'buka-robots-textarea',
            value: agentsDraft,
            placeholder: t('agentsPlaceholder'),
            'aria-label': t('agentsEditorLabel'),
            spellCheck: false,
            disabled: agentsSaving,
            onChange: (event) => setAgentsDraft(event.target.value),
          }),
        )
      }

      /**
       * 「描述」页签：一句话摘要 + 保存按钮。工作流通过 `buka_robots` 读这一行，
       * 决定是否把节点交给这个机器人；没有改动时保存按钮不可用。
       *
       * @param {object} robot 一条机器人记录
       * @returns {object} React 元素
       */
      function renderDescription(robot) {
        const current = typeof robot.description === 'string' ? robot.description : ''
        const dirty = normalizedDescription(descriptionDraft) !== current
        return h(
          'section',
          { className: 'buka-robots-section', 'aria-busy': descriptionSaving ? true : undefined },
          h(
            'div',
            { className: 'buka-robots-sectionHead' },
            h('h2', { className: 'buka-robots-sectionTitle' }, t('descriptionLabel')),
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                type: 'button',
                className: 'buka-robots-submit',
                disabled: !dirty || mutating,
                onClick: saveDescription,
              },
              descriptionSaving ? t('saving') : t('save'),
            ),
          ),
          h('p', { className: 'buka-robots-fieldHint' }, t('descriptionHint')),
          h('textarea', {
            className: 'buka-robots-descriptionInput is-tall',
            value: descriptionDraft,
            placeholder: t('descriptionPlaceholder'),
            maxLength: ROBOT_DESCRIPTION_MAX_LENGTH,
            rows: 4,
            disabled: descriptionSaving,
            'aria-label': t('descriptionLabel'),
            onChange: (event) => setDescriptionDraft(event.target.value),
          }),
          descriptionError === null
            ? null
            : h('p', { className: 'buka-robots-formError', role: 'alert' }, descriptionError),
        )
      }

      /**
       * 配置视图：缺目录提示 + 页签面板（AGENTS.md / Skills / 描述）。
       *
       * @param {object} robot 一条机器人记录
       * @returns {object} React 元素
       */
      function renderDetail(robot) {
        const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0]
        return h(
          'div',
          { className: 'buka-robots-pageBody buka-robots-detail' },
          robot.exists === false
            ? h(
                'p',
                { className: 'buka-robots-notice', role: 'status' },
                h(IconWarningOutlineRegular, { size: 16 }),
                h('span', null, t('missingDirDetail')),
              )
            : null,
          h(
            'div',
            {
              className: 'buka-robots-panel',
              role: 'tabpanel',
              id: activeTab.panelId,
              'aria-labelledby': activeTab.id,
            },
            tab === 'skills'
              ? renderSkills(robot)
              : tab === 'description'
                ? renderDescription(robot)
                : renderAgents(robot),
          ),
        )
      }

      /**
       * 「安装 skills」对话框：来源输入 + 收藏仓库入口 + 候选勾选列表。
       * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
       *
       * @returns {object} React 元素
       */
      function renderInstallDialog() {
        const candidates = installCandidates
        const installed = new Set(candidates.installed)
        const selectable = candidates.skills.filter((skill) => !installed.has(skill.name))
        const allSelected =
          selectable.length > 0 && selectable.every((skill) => installSelected.includes(skill.name))

        const favouritesBlock =
          favourites.status === 'ready'
            ? favourites.repos.length === 0
              ? h('p', { className: 'buka-robots-fieldHint' }, t('favouritesEmpty'))
              : h(
                  'div',
                  { className: 'buka-robots-field' },
                  h('span', { className: 'buka-robots-fieldLabel' }, t('favouritesLabel')),
                  h(
                    'div',
                    { className: 'buka-robots-favorites' },
                    ...favourites.repos.map((repo) =>
                      h(
                        Button,
                        {
                          key: repo.id,
                          variant: installSource === repo.source ? 'primary' : 'outline',
                          size: 'sm',
                          className: 'buka-robots-toolbarButton',
                          title: repo.note !== '' ? repo.note : repo.source,
                          disabled: installing || candidates.status === 'loading',
                          onClick: () => loadCandidates(repo.source),
                        },
                        repo.source,
                      ),
                    ),
                  ),
                )
            : null

        return h(
          'div',
          { className: 'buka-robots-dialogForm' },
          h(
            'form',
            {
              id: INSTALL_FORM_ID,
              className: 'buka-robots-field',
              onSubmit: (event) => {
                event.preventDefault()
                loadCandidates()
              },
            },
            h(
              'label',
              { className: 'buka-robots-fieldLabel', htmlFor: 'buka-robots-install-source' },
              t('installSourceLabel'),
            ),
            h(
              'div',
              { className: 'buka-robots-sourceRow' },
              h(Input, {
                id: 'buka-robots-install-source',
                className: 'buka-robots-input',
                type: 'text',
                value: installSource,
                placeholder: t('sourcePlaceholder'),
                autoComplete: 'off',
                spellCheck: false,
                disabled: installing,
                'data-modal-autofocus': '',
                onChange: (event) => setInstallSource(event.target.value),
              }),
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'sm',
                  type: 'submit',
                  className: 'buka-robots-submit',
                  icon:
                    candidates.status === 'loading'
                      ? h(StateDot, { state: 'ongoing', size: 13 })
                      : undefined,
                  disabled:
                    installing || candidates.status === 'loading' || installSource.trim() === '',
                },
                candidates.status === 'loading' ? t('loadingSkills') : t('loadSkills'),
              ),
            ),
          ),
          favouritesBlock,
          candidates.status === 'idle'
            ? h('p', { className: 'buka-robots-fieldHint' }, t('installIdle'))
            : null,
          candidates.status === 'loading'
            ? h(
                'p',
                { className: 'buka-robots-statusWithDot', role: 'status' },
                h(StateDot, { state: 'ongoing' }),
                t('loadingSkills'),
              )
            : null,
          candidates.status === 'error'
            ? h(
                'div',
                { className: 'buka-robots-alert', role: 'alert' },
                h(
                  'div',
                  { className: 'buka-robots-alertHead' },
                  h(IconWarningOutlineRegular, { size: 16 }),
                  h('span', null, `${t('errAvailableFailed')} ${candidates.error}`),
                ),
                candidates.output === ''
                  ? null
                  : h(
                      React.Fragment,
                      null,
                      h('span', { className: 'buka-robots-outputLabel' }, t('outputLabel')),
                      h('pre', { className: 'buka-robots-output' }, candidates.output),
                    ),
              )
            : null,
          candidates.status === 'ready'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'buka-robots-candidatesHead' },
                  h(
                    'span',
                    { className: 'buka-robots-fieldHint' },
                    `${String(t('skillsFound')).replace('{n}', String(candidates.skills.length))} · ${String(
                      t('selectedSkills'),
                    )
                      .replace('{n}', String(installSelected.length))
                      .replace('{m}', String(selectable.length))}`,
                  ),
                  selectable.length === 0
                    ? null
                    : h(
                        'label',
                        { className: 'buka-robots-selectAll' },
                        h('input', {
                          type: 'checkbox',
                          className: 'buka-robots-candidateInput',
                          checked: allSelected,
                          disabled: installing,
                          onChange: (event) => selectAllCandidates(event.target.checked),
                        }),
                        h('span', null, t('selectAllSkills')),
                      ),
                ),
                h(
                  'ul',
                  { className: 'buka-robots-candidates' },
                  ...candidates.skills.map((skill) => {
                    const isInstalled = installed.has(skill.name)
                    const checked = !isInstalled && installSelected.includes(skill.name)
                    return h(
                      'li',
                      { key: skill.name },
                      h(
                        'label',
                        {
                          className: `buka-robots-candidate${isInstalled ? ' isDisabled' : ''}`,
                          title:
                            typeof skill.description === 'string' && skill.description !== ''
                              ? skill.description
                              : String(skill.name),
                        },
                        h('input', {
                          type: 'checkbox',
                          className: 'buka-robots-candidateInput',
                          checked,
                          disabled: isInstalled || installing,
                          onChange: () => toggleCandidate(skill.name),
                        }),
                        h(
                          'span',
                          { className: 'buka-robots-candidateText' },
                          h('span', { className: 'buka-robots-candidateName' }, String(skill.name)),
                          typeof skill.description === 'string' && skill.description !== ''
                            ? h(
                                'span',
                                { className: 'buka-robots-candidateDesc' },
                                skill.description,
                              )
                            : null,
                        ),
                        isInstalled
                          ? h(
                              'span',
                              { className: 'buka-robots-candidateTag' },
                              h(Tag, { tone: 'neutral' }, t('alreadyInstalled')),
                            )
                          : null,
                      ),
                    )
                  }),
                ),
                installed.size === 0
                  ? null
                  : h('p', { className: 'buka-robots-fieldHint' }, t('installedHint')),
              )
            : null,
          installError === null
            ? null
            : h(
                'div',
                { className: 'buka-robots-alert', role: 'alert' },
                h(
                  'div',
                  { className: 'buka-robots-alertHead' },
                  h(IconWarningOutlineRegular, { size: 16 }),
                  h('span', null, `${t('skillErrorTitle')} ${installError.message}`),
                ),
                typeof installError.output === 'string' && installError.output !== ''
                  ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'buka-robots-outputLabel' }, t('outputLabel')),
                      h('pre', { className: 'buka-robots-output' }, installError.output),
                    )
                  : null,
              ),
        )
      }

      const refreshButton = h(
        Tooltip,
        { label: t('refresh'), side: 'bottom', delayMs: 500, disabled: list.loading },
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'buka-robots-toolbarButton',
            'aria-label': t('refresh'),
            'aria-busy': list.loading,
            disabled: list.loading || mutating,
            icon: list.loading
              ? h(StateDot, { state: 'ongoing', size: 13 })
              : h(IconRefreshOutlineRegular, { size: 13 }),
            onClick: reload,
          },
          t('refresh'),
        ),
      )

      // 「创建机器人」常驻标题行，「刷新」右侧、同一尺寸；名称在对话框里填。
      const createButton =
        selectedRobot === null
          ? h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                className: 'buka-robots-toolbarButton',
                icon: h(IconPlusOutlineRegular, { size: 13 }),
                'aria-label': t('create'),
                disabled: mutating || corrupt,
                onClick: openCreateDialog,
              },
              t('create'),
            )
          : null

      // 设置入口只在列表页显示：设置作用于整个页面（目前是通用型机器人开关），
      // 详情页的工具栏留给单个机器人。
      const settingsButton =
        selectedRobot === null
          ? h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                className: 'buka-robots-toolbarButton',
                icon: h(IconSettingsOutlineRegular, { size: 13 }),
                'aria-label': t('settings'),
                onClick: openSettingsDialog,
              },
              t('settings'),
            )
          : null

      const detailActions =
        selectedRobot === null
          ? null
          : [
              h(
                Button,
                {
                  key: 'open',
                  variant: 'outline',
                  size: 'sm',
                  className: 'buka-robots-toolbarButton',
                  icon: h(IconNewChatOutlineRegular, { size: 13 }),
                  disabled: mutating,
                  'aria-label': `${t('newSession')} ${selectedRobot.name}`,
                  onClick: () => openRobot(selectedRobot),
                },
                t('newSession'),
              ),
              h(
                Button,
                {
                  key: 'reveal',
                  variant: 'outline',
                  size: 'sm',
                  className: 'buka-robots-toolbarButton',
                  icon:
                    busy === `reveal:${selectedRobot.name}`
                      ? h(StateDot, { state: 'ongoing', size: 13 })
                      : h(IconFolderOpenOutlineRegular, { size: 13 }),
                  disabled: mutating || selectedRobot.exists === false,
                  'aria-label': `${t('reveal')} ${selectedRobot.name}`,
                  onClick: () => revealRobot(selectedRobot),
                },
                t('reveal'),
              ),
            ]

      return h(
        'div',
        { className: 'buka-robots-page' },
        h(
          'div',
          { className: 'buka-robots-head' },
          h(
            'div',
            { className: 'buka-robots-headInner' },
            h(
              'div',
              { className: 'buka-robots-heading' },
              h(
                'div',
                { className: 'buka-robots-headingRow' },
                selectedRobot === null
                  ? null
                  : h(
                      Tooltip,
                      { label: t('back'), side: 'top', delayMs: 400 },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'buka-robots-iconButton buka-robots-back buka-robots-backButton',
                          'aria-label': t('back'),
                          disabled: mutating,
                          onClick: backToList,
                        },
                        h(IconChevronRightOutlineRegular, { size: 16 }),
                      ),
                    ),
                selectedRobot === null
                  ? null
                  : h(
                      Tooltip,
                      { label: t('changeAvatar'), side: 'top', delayMs: 400 },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'buka-robots-avatarButton',
                          'aria-label': `${t('changeAvatar')} ${selectedRobot.name}`,
                          disabled: mutating,
                          onClick: () => openAvatarDialog(selectedRobot),
                        },
                        renderAvatar(selectedRobot.avatar, 32),
                      ),
                    ),
                h(
                  'h1',
                  { className: 'buka-robots-title' },
                  selectedRobot === null ? t('title') : String(selectedRobot.name ?? ''),
                ),
                selectedRobot === null
                  ? null
                  : h('span', { className: 'buka-robots-headingTag' }, renderMountedTag(selectedRobot)),
              ),
            ),
            h('div', { className: 'buka-robots-toolbar' }, detailActions, settingsButton, refreshButton, createButton),
            selectedRobot === null
              ? null
              : h(
                  'div',
                  { className: 'buka-robots-tabs' },
                  h(SegmentedTabs, {
                    size: 'sm',
                    className: 'buka-robots-tabList',
                    label: t('tabsLabel'),
                    value: tab,
                    onChange: switchTab,
                    items: [
                      {
                        value: TABS[0].value,
                        label: t('tabDescription'),
                        id: TABS[0].id,
                        panelId: TABS[0].panelId,
                      },
                      {
                        value: TABS[1].value,
                        label: t('tabAgents'),
                        id: TABS[1].id,
                        panelId: TABS[1].panelId,
                      },
                      {
                        value: TABS[2].value,
                        label: t('tabSkills'),
                        id: TABS[2].id,
                        panelId: TABS[2].panelId,
                      },
                    ],
                  }),
                ),
          ),
        ),
        h('div', { className: 'buka-robots-body' }, selectedRobot === null ? renderList() : renderDetail(selectedRobot)),
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
        // 「创建机器人」对话框：名称必填、回车可提交；创建失败留在框里提示，
        // 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
        h(
          Modal,
          {
            open: dialogOpen,
            onClose: closeCreateDialog,
            title: t('create'),
            closeLabel: t('close'),
            footer: h(
              React.Fragment,
              null,
              h(Button, { variant: 'outline', onClick: closeCreateDialog, disabled: creating }, t('cancel')),
              h(
                Button,
                {
                  variant: 'primary',
                  type: 'submit',
                  form: CREATE_FORM_ID,
                  disabled: creating || name.trim() === '',
                },
                creating ? t('creating') : t('create'),
              ),
            ),
          },
          h(
            'form',
            { id: CREATE_FORM_ID, className: 'buka-robots-dialogForm', onSubmit: createRobot },
            h(
              'div',
              { className: 'buka-robots-avatarField' },
              h('span', { className: 'buka-robots-fieldLabel' }, t('avatar')),
              renderAvatarPicker(draftAvatar, creating),
            ),
            h(
              'label',
              { className: 'buka-robots-field' },
              h('span', { className: 'buka-robots-fieldLabel' }, t('createFieldName')),
              h(Input, {
                className: 'buka-robots-fieldInput',
                type: 'text',
                value: name,
                placeholder: t('createPlaceholder'),
                autoComplete: 'off',
                spellCheck: false,
                maxLength: 64,
                disabled: creating,
                'data-modal-autofocus': '',
                onChange: (event) => setName(event.target.value),
              }),
            ),
            h(
              'label',
              { className: 'buka-robots-field' },
              h('span', { className: 'buka-robots-fieldLabel' }, t('descriptionLabel')),
              h('textarea', {
                className: 'buka-robots-descriptionInput',
                value: draftDescription,
                placeholder: t('descriptionPlaceholder'),
                maxLength: ROBOT_DESCRIPTION_MAX_LENGTH,
                rows: 2,
                disabled: creating,
                onChange: (event) => setDraftDescription(event.target.value),
              }),
              h('span', { className: 'buka-robots-fieldHint' }, t('descriptionHint')),
            ),
            createError === null ? null : h('p', { className: 'buka-robots-formError', role: 'alert' }, createError),
          ),
        ),
        // 「更换头像」对话框：从预设里选一个，保存后只更新登记表里的 avatar。
        h(
          Modal,
          {
            open: avatarOpen,
            onClose: closeAvatarDialog,
            title: avatarTarget === null ? t('changeAvatar') : `${t('changeAvatar')} · ${avatarTarget}`,
            closeLabel: t('close'),
            footer: h(
              React.Fragment,
              null,
              h(Button, { variant: 'outline', onClick: closeAvatarDialog, disabled: avatarSaving }, t('cancel')),
              h(
                Button,
                {
                  variant: 'primary',
                  type: 'submit',
                  form: AVATAR_FORM_ID,
                  disabled: avatarSaving || avatarTarget === null,
                },
                avatarSaving ? t('saving') : t('save'),
              ),
            ),
          },
          h(
            'form',
            {
              id: AVATAR_FORM_ID,
              className: 'buka-robots-dialogForm',
              onSubmit: (event) => {
                event.preventDefault()
                saveAvatar()
              },
            },
            h(
              'div',
              { className: 'buka-robots-avatarField' },
              h('span', { className: 'buka-robots-fieldLabel' }, t('chooseAvatar')),
              renderAvatarPicker(draftAvatar, avatarSaving),
            ),
            avatarError === null
              ? null
              : h('p', { className: 'buka-robots-formError', role: 'alert' }, avatarError),
          ),
        ),
        // 「安装 skills」对话框：选来源（或收藏仓库）→ 读出候选 → 勾选 → 只安装选中的。
        // 默认全选未安装的；已安装的置灰不可选；安装中不响应关闭。
        h(
          Modal,
          {
            open: installOpen,
            onClose: closeInstallDialog,
            title: t('installDialogTitle'),
            closeLabel: t('close'),
            footer: h(
              React.Fragment,
              null,
              h(Button, { variant: 'outline', onClick: closeInstallDialog, disabled: installing }, t('cancel')),
              h(
                Button,
                {
                  variant: 'primary',
                  type: 'button',
                  disabled: installing || installSelected.length === 0,
                  onClick: installSelectedSkills,
                },
                installing
                  ? String(t('installingSkills')).replace('{n}', String(installSelected.length))
                  : installSelected.length > 0
                    ? String(t('installSelectedCount')).replace('{n}', String(installSelected.length))
                    : t('installSelected'),
              ),
            ),
          },
          installOpen && selectedRobot !== null ? renderInstallDialog() : null,
        ),
        // 通用型机器人「进入工作区」对话框：列出 DSH 里已有的工作区，点一行就进入。
        // 每次打开都重新读，侧边栏刚新建 / 删除的工作区也能看到。
        h(
          Modal,
          {
            open: workspacesOpen,
            onClose: closeWorkspacePicker,
            title: t('chooseWorkspace'),
            closeLabel: t('close'),
            footer: h(
              React.Fragment,
              null,
              h(
                Button,
                { variant: 'outline', onClick: closeWorkspacePicker, disabled: workspaceBusy !== null },
                t('cancel'),
              ),
            ),
          },
          workspacesOpen
            ? h(
                'div',
                { className: 'buka-robots-dialogForm' },
                h('p', { className: 'buka-robots-fieldHint' }, t('chooseWorkspaceHint')),
                workspacesState.error === null
                  ? null
                  : h('p', { className: 'buka-robots-formError', role: 'alert' }, workspacesState.error),
                workspacesState.status === 'loading'
                  ? h(
                      'p',
                      { className: 'buka-robots-statusWithDot', role: 'status' },
                      h(StateDot, { state: 'ongoing' }),
                      t('loadingWorkspaces'),
                    )
                  : workspacesState.items.length === 0
                    ? workspacesState.status === 'ready'
                      ? h('p', { className: 'buka-robots-fieldHint' }, t('workspacesEmpty'))
                      : null
                    : h(
                        'div',
                        { className: 'buka-robots-workspaces' },
                        ...workspacesState.items.map((workspace) =>
                          h(
                            'button',
                            {
                              key: workspace.id,
                              type: 'button',
                              className: `buka-robots-workspace${workspaceBusy === workspace.id ? ' is-busy' : ''}`,
                              disabled: workspaceBusy !== null,
                              'aria-label': `${t('enterWorkspace')} ${workspace.title}`,
                              onClick: () => enterWorkspace(workspace),
                            },
                            h(
                              'span',
                              { className: 'buka-robots-workspaceText' },
                              h('span', { className: 'buka-robots-workspaceTitle' }, String(workspace.title ?? '')),
                              h('span', { className: 'buka-robots-workspacePath' }, String(workspace.path ?? '')),
                            ),
                            workspaceBusy === workspace.id
                              ? h(StateDot, { state: 'ongoing', size: 13 })
                              : h(IconChevronRightOutlineRegular, { size: 13 }),
                          ),
                        ),
                      ),
              )
            : null,
        ),
        // 设置对话框：目前只有一个「通用型机器人」开关，改动立即写 Host 的设置
        // 文件；停用后列表里的内置卡片消失，但这里始终可以重新启用。
        h(
          Modal,
          {
            open: settingsOpen,
            onClose: closeSettingsDialog,
            title: t('settingsTitle'),
            closeLabel: t('close'),
            footer: h(
              React.Fragment,
              null,
              h(
                Button,
                { variant: 'outline', onClick: closeSettingsDialog, disabled: settingsSaving },
                t('settingsDone'),
              ),
            ),
          },
          h(
            'div',
            { className: 'buka-robots-dialogForm' },
            h(
              'div',
              { className: 'buka-robots-settingRow' },
              h(
                'div',
                { className: 'buka-robots-settingText' },
                h(
                  'div',
                  { className: 'buka-robots-settingHead' },
                  h('span', { className: 'buka-robots-settingTitle' }, t('generalSetting')),
                  h(
                    Tag,
                    { tone: generalEnabled ? 'success' : 'neutral' },
                    generalEnabled ? t('settingsEnabled') : t('settingsDisabled'),
                  ),
                ),
                h('span', { className: 'buka-robots-settingDesc' }, t('generalSettingDesc')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': generalEnabled,
                  'aria-label': t('generalSetting'),
                  'aria-busy': settingsSaving,
                  className: `buka-robots-switch${generalEnabled ? ' is-on' : ''}`,
                  disabled: settingsSaving,
                  onClick: () => saveGeneralEnabled(!generalEnabled),
                },
                h('span', { className: 'buka-robots-switchThumb', 'aria-hidden': true }),
              ),
            ),
            settingsError === null
              ? null
              : h('p', { className: 'buka-robots-formError', role: 'alert' }, settingsError),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * 注册侧边栏条目与主面板页面，并在插件生效期注入文案与样式。
       *
       * @param {object} ctx 浏览器插件上下文
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS)

        /**
         * 页面从插件上下文里取 DSH 的 Client Service。`ctx.get` 在服务不存在
         * 时会抛错，这里统一收敛成 null，由页面给出可读提示。
         *
         * @param {string} serviceName
         * @returns {any | null}
         */
        function getService(serviceName) {
          try {
            return ctx.get(serviceName) ?? null
          } catch {
            return null
          }
        }

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-robots: dictionaries')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@buka/dsh-plugin-robots'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'buka-robots: styles')

        // 侧边栏图标：id 与 main 的 key 相同，点击与选中态由侧边栏自己完成。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => t('panel'),
              locale: NS,
            },
            RobotsPanelIcon,
          ),
        )

        // 主面板页面：布局按侧边栏选中的 id 挂载这里的组件；页面通过 inject
        // 拿到服务解析函数，其余文案由插槽按 locale 注入。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ getService }),
            },
            RobotsPage,
          ),
        )
      },
    }
  },
})
