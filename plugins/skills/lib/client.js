window.__ModuleLoader__.load({
  id: "@buka/dsh-plugin-skills",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // \0rolldown/runtime.js
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __copyProps = (to, from, except, desc) => {
    	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
    		key = keys[i];
    		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
    			get: ((k) => from[k]).bind(null, key),
    			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    		});
    	}
    	return to;
    };
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
    	value: mod,
    	enumerable: true
    }) : target, mod));
    let react = require("react");
    react = __toESM(react, 1);
    // packages/plugin-ui/lib/avatars.js
    /**
    * 预设头像：id → emoji / 底色 / 词典 key。
    *
    * 执行者页与工作流节点图原本各维护一份同样的显示表；插件之间不互相 import，
    * 所以统一收在这里，两个浏览器一半都从这里派生。id 与 Host 的
    * `plugins/workflows/src/workers/avatar.ts` 一一对应（那边只存 id，不存 emoji / 底色），
    * **id 是跨插件的稳定契约**：增删预设时两边一起改，顺序也不要动。
    *
    * @module plugin-ui/avatars
    */
    /**
    * 预设头像：顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是名字哈希
    * 的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
    */
    const AVATARS = [
    	{
    		id: "sprout",
    		emoji: "🌱",
    		color: "#34A853",
    		labelKey: "avatarSprout"
    	},
    	{
    		id: "sun",
    		emoji: "☀️",
    		color: "#F2A60C",
    		labelKey: "avatarSun"
    	},
    	{
    		id: "cat",
    		emoji: "🐱",
    		color: "#F2994A",
    		labelKey: "avatarCat"
    	},
    	{
    		id: "fox",
    		emoji: "🦊",
    		color: "#EB6A4E",
    		labelKey: "avatarFox"
    	},
    	{
    		id: "panda",
    		emoji: "🐼",
    		color: "#6B7280",
    		labelKey: "avatarPanda"
    	},
    	{
    		id: "owl",
    		emoji: "🦉",
    		color: "#8D6E63",
    		labelKey: "avatarOwl"
    	},
    	{
    		id: "whale",
    		emoji: "🐳",
    		color: "#4A90E2",
    		labelKey: "avatarWhale"
    	},
    	{
    		id: "octopus",
    		emoji: "🐙",
    		color: "#9B51E0",
    		labelKey: "avatarOctopus"
    	},
    	{
    		id: "bee",
    		emoji: "🐝",
    		color: "#D9A400",
    		labelKey: "avatarBee"
    	},
    	{
    		id: "rocket",
    		emoji: "🚀",
    		color: "#5B6BFF",
    		labelKey: "avatarRocket"
    	},
    	{
    		id: "dino",
    		emoji: "🦖",
    		color: "#27AE60",
    		labelKey: "avatarDino"
    	},
    	{
    		id: "ghost",
    		emoji: "👻",
    		color: "#94A3B8",
    		labelKey: "avatarGhost"
    	},
    	{
    		id: "penguin",
    		emoji: "🐧",
    		color: "#2D9CDB",
    		labelKey: "avatarPenguin"
    	},
    	{
    		id: "unicorn",
    		emoji: "🦄",
    		color: "#BB6BD9",
    		labelKey: "avatarUnicorn"
    	},
    	{
    		id: "mushroom",
    		emoji: "🍄",
    		color: "#EB5757",
    		labelKey: "avatarMushroom"
    	}
    ];
    AVATARS.map((preset) => preset.id);
    new Map(AVATARS.map((preset) => [preset.id, preset]));
    AVATARS[0].id;
    // packages/plugin-ui/lib/h.js
    /**
    * 创建 React 元素的小包装。
    *
    * 页面直接手写 `createElement`（不用 JSX）。短名保持 `React.createElement` 的
    * 全部重载（这样内联回调仍能拿到事件类型），另外补一个宽松签名：执行者 / 技能
    * 页有些 props 是自带的宽对象或带 `data-*` 的元素属性，类型系统不必逐个展开。
    *
    * @module plugin-ui/h
    */
    const looseCreateElement = (type, props, ...children) => react.default.createElement(type, props, ...children);
    /** `React.createElement` 的短名，附带一个宽松签名。 */
    const h = looseCreateElement;
    // packages/plugin-ui/lib/request.js
    /**
    * 与 Host 一半通信的 JSON 请求 / 错误处理。
    *
    * 四个插件的浏览器一半原本各有一份几乎相同的实现：请求返回 `{ ok, ... }`，
    * 非 2xx 或 `ok !== true` 时抛出带 `code`（以及 `npx` 类路由的 `output`）的
    * 错误，失败原因再用 `messageOf` 转成展示文本。差异只在各插件自己的错误码
    * 映射与请求参数，所以这里共享机制、不共享错误文案。
    *
    * @module plugin-ui/request
    */
    /**
    * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
    * `npx-failed` 的响应里还有 `output`，一并挂到错误上供详情页展示。
    *
    * @param url 路由地址
    * @param init 请求选项；`body` 是已经序列化好的 JSON 字符串
    */
    async function requestJson(url, init = {}) {
    	const { allowFailureBody = false, ...requestInit } = init;
    	const headers = { accept: "application/json" };
    	if (requestInit.body !== void 0) headers["content-type"] = "application/json";
    	const extraHeaders = requestInit.headers ?? {};
    	const response = await fetch(url, {
    		...requestInit,
    		headers: {
    			...headers,
    			...extraHeaders
    		}
    	});
    	const body = await response.json().catch(() => null);
    	if (!response.ok || body === null || body.ok !== true && !allowFailureBody) {
    		const error = new Error(typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    		error.code = typeof body?.code === "string" ? body.code : void 0;
    		error.output = typeof body?.output === "string" ? body.output : void 0;
    		throw error;
    	}
    	return body;
    }
    /**
    * 把失败原因转成展示文本。
    *
    * @param failure 捕获到的任意失败值
    */
    function messageOf(failure) {
    	return failure instanceof Error ? failure.message : String(failure);
    }
    // packages/plugin-ui/lib/worker-label.js
    /**
    * 执行者展示名的统一写法：两个插件都用「名称 · 标识符」消歧。
    *
    * 标识符是不可变引用键，名称是可选展示名；只读接口可能只给其中一个，也可能
    * 直接给算好的 `displayName`。这里按「名称 → displayName → 标识符」取展示名，
    * 标识符缺失时退回带过来的 `name`（v7 旧作业快照的形状）。
    *
    * @module @buka/plugin-ui/worker-label
    */
    /** 取一个字段的 trim 值；不是字符串或为空时给空串。 */
    function text(value) {
    	return typeof value === "string" ? value.trim() : "";
    }
    /**
    * 执行者展示名：名称非空时用它，否则用算好的 `displayName`，再否则用标识符。
    *
    */
    function workerDisplayName(worker) {
    	const name = text(worker?.name);
    	if (name !== "") return name;
    	const display = text(worker?.displayName);
    	if (display !== "") return display;
    	return text(worker?.id);
    }
    /**
    * 「展示名 · 标识符」：列表、详情与对话框里用来消歧。展示名等于标识符
    * （没设置名称）时只显示标识符，避免出现 `writer · writer`。
    *
    */
    function workerIdentityLabel(worker) {
    	const id = text(worker?.id) || text(worker?.name);
    	const display = workerDisplayName(worker);
    	if (id === "") return display;
    	return display === "" || display === id ? id : `${display} · ${id}`;
    }
    // .build/skills/client/primitives.js
    /**
    * 从 DSH 的浏览器模块表取基座组件。
    *
    * 不能写成静态 import：`scripts/build-clients.ts` 只把 react 系列声明为 external，
    * 静态 import `@deepseek-ai/dsh-client-ui-primitives` 会被打包器拉进产物（它带 CSS
    * module，打包会直接失败）。用函数包一层 `require`，打包器无法静态解析，产物里
    * 保留运行时 `require` —— 与迁移前手写 `window.__ModuleLoader__` 外壳时的形状一致。
    *
    * 整个浏览器一半只在这里取一次基座模块：页面、面板与对话框都从这里拿组件。
    *
    * @module @buka/dsh-plugin-skills/client/primitives
    */
    /**
    * 从 DSH 的浏览器模块表取基座组件。
    *
    * @param id 模块 id
    */
    function loadPrimitives(id) {
    	return require(id);
    }
    const { Button, Input, SegmentedTabs, Tag, Tooltip, Toast, StateDot, IconBranchOutlineRegular, IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconDownloadOutlineRegular, IconFolderOpenOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSkillOutlineRegular, IconTrashOutlineRegular, IconUserOutlineRegular, IconWarningOutlineRegular, IconWorkspaceTreeOutlineRegular, Modal } = loadPrimitives("@deepseek-ai/dsh-client-ui-primitives");
    // .build/skills/client/components/panel-icon.js
    /**
    * 侧边栏的图标。
    *
    * 复用基座自带的 skill 图标（文档 + 星芒），与 DSH 自己的 skill 界面
    * 保持同一套图形；侧边栏只给尺寸与选中态，颜色通过 `currentColor`
    * 继承面板行的前景色，不自己写死颜色。
    *
    * @module @buka/dsh-plugin-skills/client/components/panel-icon
    */
    /**
    * 侧边栏的图标。
    *
    * @param props 侧边栏的图标入参
    */
    function SkillsPanelIcon({ size }) {
    	return h(IconSkillOutlineRegular, { size });
    }
    // .build/skills/client/constants.js
    /**
    * 页面的固定 id 与 Tab 定义。
    *
    * 侧边栏条目与主面板共用 `PANEL_ID`；两个 Tab 的 id / panelId 是固定的，
    * 页面只挂载一份，不需要 `useId`。
    *
    * @module @buka/dsh-plugin-skills/client/constants
    */
    /** 侧边栏条目与主面板共用的 id：侧边栏注册的 id 必须与 `main` 的 key 相同。 */
    const PANEL_ID = "buka-skills";
    /** 收藏对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
    const SAVE_FORM_ID = "buka-skills-save-form";
    /**
    * Tab 与对应面板的固定 id（页面只挂载一份，不需要 `useId`）。
    *
    * 「技能仓库」在前、默认选中；「全局技能」列出已安装的 skill。
    */
    const TABS = [{
    	value: "repos",
    	labelKey: "tabRepos",
    	id: "buka-skills-tab-repos",
    	panelId: "buka-skills-panel-repos"
    }, {
    	value: "installed",
    	labelKey: "tabInstalled",
    	id: "buka-skills-tab-installed",
    	panelId: "buka-skills-panel-installed"
    }];
    // .build/skills/client/api.js
    /**
    * 与 Host 一半的 HTTP 接口。
    *
    * 页面只做展示与触发：列表、卸载、安装、收藏的读写都走 Host 注册的包内路由，
    * 不在浏览器里判断 npx 的安装方式，也不碰文件系统。路由常量与 Host
    * `src/routes.ts` 保持一致。
    *
    * @module @buka/dsh-plugin-skills/client/api
    */
    /** 与 Host 一半的路由常量保持一致。 */
    const LIST_ROUTE = "/buka-skills/list";
    const TARGETS_ROUTE = "/buka-skills/targets";
    const INSTALL_ROUTE = "/buka-skills/install";
    const REPOS_ROUTE = "/buka-skills/repos";
    const REPO_REMOVE_ROUTE = "/buka-skills/repos/remove";
    const REPO_SKILLS_ROUTE = "/buka-skills/repo-skills";
    const CHECK_ROUTE = "/buka-skills/check";
    const ICON_ROUTE = "/buka-skills/icon";
    const UPDATE_ROUTE = "/buka-skills/update";
    /**
    * 取错误上的 `code` 字段（Host 的失败响应带它）。
    */
    function errorCode(failure) {
    	const code = failure?.code;
    	return typeof code === "string" ? code : void 0;
    }
    // .build/skills/client/keys.js
    /**
    * 页面里用到的键与计数：安装目录键、行键、树节点里的 skill 数。
    *
    * 这些函数都是纯字符串 / 纯树操作，页面状态与各个面板共用；安装目录键的规则
    * 与 `npx skills` 的初始化规则一致，见 `skillKeyOf()`。
    *
    * @module @buka/dsh-plugin-skills/client/keys
    */
    /**
    * 同名的 skill 可能同时存在于两个全局根，所以页面状态用「根 + 名称」做键。
    *
    * @param entry 一条 skill
    */
    function entryKey(entry) {
    	return `${entry.scope}:${entry.id}`;
    }
    /**
    * skill 名对应的安装目录键，规则与 `npx skills` 的 sanitizeName() / Host 的
    * `skillDirName()` 一致：小写，非 `[a-z0-9._]` 的连续字符换成连字符，去掉
    * 首尾的 `.` 与 `-`，最多 255 字符。用来判断仓库树里的 skill 是否已安装。
    *
    * @param name skill 名
    */
    function skillKeyOf(name) {
    	if (typeof name !== "string") return "";
    	return name.toLowerCase().replace(/[^a-z0-9._]+/gu, "-").replace(/^[.-]+|[.-]+$/gu, "").slice(0, 255);
    }
    /**
    * 一条树里的 skill 与它所在收藏的组合键：安装中只让这一行显示进度，
    * 其它行继续可读（但按钮统一禁用，Host 侧安装/卸载本来也是串行的）。
    *
    * @param repo 一条收藏
    * @param node Host 返回的 skill 节点
    */
    function installKeyOf(repo, node) {
    	return `${repo.id}\n${typeof node?.path === "string" ? node.path : ""}`;
    }
    /**
    * 一个树节点里的 skill 数；目录节点用它显示数量。
    *
    * @param node Host 返回的树节点
    */
    function countSkills(node) {
    	let total = node.type === "skill" ? 1 : 0;
    	for (const child of Array.isArray(node.children) ? node.children : []) total += countSkills(child);
    	return total;
    }
    /**
    * 一个树节点里的全部 skill 叶子；目录与 skill 子节点按深度优先展开。
    *
    * 目录行上的「全部安装」用它收集要装的 skill；目录节点的 `path` 只是展示
    * 分组键，skill 叶子的 `path` 是包含 SKILL.md 的目录路径，直接交给安装路由。
    *
    * @param node Host 返回的树节点
    */
    function skillLeavesOf(node) {
    	const children = Array.isArray(node.children) ? node.children : [];
    	if (node.type === "skill") return [node, ...children.flatMap((child) => skillLeavesOf(child))];
    	return children.flatMap((child) => skillLeavesOf(child));
    }
    /**
    * 对话框里一类目标的条目；快照缺字段时当作空列表。
    *
    * @param kind 目标类型
    * @param snapshot 目标列表快照
    */
    function targetItemsOf(kind, snapshot) {
    	const list = kind === "worker" ? snapshot?.workers : snapshot?.workspaces;
    	return Array.isArray(list?.items) ? [...list.items] : [];
    }
    /**
    * 目标条目的选择键：执行者用不可变标识符（旧版退回 `name`），工作区用路径。
    *
    * @param kind 目标类型
    * @param item 一条目标
    */
    function targetKeyOf(kind, item) {
    	const record = item;
    	if (kind === "worker") {
    		const id = typeof record?.id === "string" ? record.id.trim() : "";
    		if (id !== "") return id;
    		return typeof record?.name === "string" ? record.name.trim() : "";
    	}
    	const value = record?.path;
    	return typeof value === "string" ? value : "";
    }
    /**
    * 目标条目的展示标签：执行者按「名称 · 标识符」消歧，工作区用标题（缺省回退
    * 路径）。
    *
    * @param kind 目标类型
    * @param item 一条目标
    */
    function targetLabelOf(kind, item) {
    	const record = item;
    	if (kind === "worker") return workerIdentityLabel(record);
    	const title = typeof record?.title === "string" ? record.title.trim() : "";
    	return title !== "" ? title : typeof record?.path === "string" ? record.path : "";
    }
    /**
    * 目标条目的路径副标题；执行者 / 工作区都有，缺失时返回空串。
    *
    * @param item 一条目标
    */
    function targetPathOf(item) {
    	const record = item;
    	return typeof record?.path === "string" ? record.path : "";
    }
    // .build/skills/client/repo-source.js
    /**
    * 收藏来源的展示与分类判断。
    *
    * 只做纯字符串判断：是否可打开网页、是否能让 Host 去列 skills。真正的来源
    * 分类在 Host 的 `repo-store.ts`，这里只按同一套规则给页面做即时反馈。
    * 仓库头像的缓存与更新在 Host（`/buka-skills/icon`），这里只拼请求地址。
    *
    * @module @buka/dsh-plugin-skills/client/repo-source
    */
    /** GitHub owner 的写法：网页链接、SCP 地址与已经规范化的 `owner/repo`。 */
    const GITHUB_OWNER_PATTERNS = [
    	/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\//iu,
    	/^(?:[A-Za-z0-9._-]+@)?github\.com:([A-Za-z0-9][A-Za-z0-9._-]*)\//iu,
    	/^([A-Za-z0-9][A-Za-z0-9._-]*)\/[A-Za-z0-9._-]+$/u
    ];
    /**
    * 把各种 npx 来源写法收敛成可比较的键：`https://github.com/a/b.git`、
    * `github.com/a/b` 与 `a/b` 都是 `a/b`。Host 写进收藏文件的 `id` 也是
    * 这个键的小写形式，所以可以直接用来判断「收藏的仓库是否已安装」。
    *
    * @param value 来源或来源链接
    * @returns 小写键与用于展示的文本
    */
    function normalizeRepo(value) {
    	if (typeof value !== "string") return {
    		key: "",
    		label: ""
    	};
    	const text = value.trim();
    	if (text === "") return {
    		key: "",
    		label: ""
    	};
    	const label = text.replace(/^https?:\/\/(?:www\.)?github\.com\//iu, "").replace(/^github\.com\//iu, "").replace(/\.git$/iu, "").replace(/\/+$/u, "");
    	return {
    		key: label.toLowerCase(),
    		label
    	};
    }
    /**
    * 展示用的来源文本；非字符串返回空串。
    */
    function repoLabel(value) {
    	return normalizeRepo(value).label;
    }
    /**
    * 收藏项对应的可打开链接：GitHub 仓库拼成网页地址，http(s) 来源原样使用；
    * ssh/git 地址、SCP 形式、本地绝对路径与包名都没有可打开的网页（标题显示
    * 为纯文本，不猜链接），返回空串。
    *
    * @param source 已规范化的来源
    */
    function repoUrl(source) {
    	if (typeof source !== "string" || source === "") return "";
    	if (/^https?:\/\//iu.test(source)) return source;
    	if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u.test(source)) return `https://github.com/${source}`;
    	return "";
    }
    /**
    * GitHub 仓库的 owner 段：GitHub 的仓库头像就是 owner 的头像，所以只从
    * GitHub 来源里取第一段。本地路径、其它 git 远端、包名与网页书签都没有
    * 可靠的头像地址，返回空串。
    *
    * @param value 来源或来源链接
    * @returns owner；没有时返回空串
    */
    function githubOwnerOf(value) {
    	if (typeof value !== "string") return "";
    	const text = value.trim();
    	if (text === "") return "";
    	for (const pattern of GITHUB_OWNER_PATTERNS) {
    		const match = pattern.exec(text);
    		if (match?.[1] !== void 0 && match[1] !== "") return match[1];
    	}
    	return "";
    }
    /**
    * 仓库图标地址：Host 的头像缓存路由；没有可靠 owner 时返回空串，调用方回退到
    * 内置图标。Host 命中磁盘缓存就直接返回，未命中才去 GitHub 拉一次。
    *
    * @param value 来源或来源链接
    */
    function repoIconUrl(value) {
    	const owner = githubOwnerOf(value);
    	return owner === "" ? "" : `${ICON_ROUTE}?owner=${encodeURIComponent(owner)}`;
    }
    /**
    * 直连 GitHub 的头像地址。只在 Host 图标路由不可用时作为退路：旧版 Host 还没
    * 注册 `/buka-skills/icon` 时页面仍能显示头像，重启 DSH 后再回到缓存路由。
    *
    * @param value 来源或来源链接
    */
    function repoDirectIconUrl(value) {
    	const owner = githubOwnerOf(value);
    	return owner === "" ? "" : `https://github.com/${owner}.png?size=80`;
    }
    /**
    * 这个来源能不能让 Host 去列 skills，与 Host `repo-store.js` 的
    * `classifyRepoSource()` 对应：`github`、`git`、`local` 三种可以列出，
    * `web`、`package` 只能当书签。
    *
    * 能列出的写法：GitHub 的 `owner/repo`、GitHub 以外的任意 http(s) 链接、
    * `ssh://` / `git://` 地址、SCP 形式（`git@host:path`）、POSIX 绝对路径
    * 与 Windows 绝对路径；npm 包名（`notion`、`@scope/pkg`）和 GitHub 子页面
    * （如 `https://github.com/o/r/tree/main`）照样能收藏，只是没有可展开的树。
    *
    * @param source 已规范化的来源
    */
    function isListableSource(source) {
    	const text = typeof source === "string" ? source.trim() : "";
    	if (text === "") return false;
    	if (/^https?:\/\/(?:www\.)?github\.com\//iu.test(text)) return /^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/iu.test(text.replace(/\/+$/u, ""));
    	if (/^(?:https?|ssh|git):\/\//iu.test(text)) return true;
    	if (/^\//u.test(text) || /^[A-Za-z]:[\\/]/u.test(text) || /^\\\\[^\\]+\\/u.test(text)) return true;
    	if (/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]+:(?!\/\/)\S+$/u.test(text)) return true;
    	return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u.test(text);
    }
    // .build/skills/client/view-cache.js
    /**
    * 收藏页的本地缓存：展开过哪些仓库、收起了哪些目录、每个仓库上次拿到的树。
    *
    * 放在浏览器 localStorage 里（和 DSH 自己的 `dsh.sessions.current` 等页面状态
    * 同一个 origin），这样关掉 DSH 再打开时能先按上次的样子渲染，不用等 Host
    * 重新拉取仓库。键名沿用 DSH 的 `dsh.` 前缀并带版本号。
    *
    * 缓存是纯页面状态、可重建：所有 localStorage 访问都有兜底（隐私模式 / 配额
    * 满是不能让页面挂掉），形状不对就当没有缓存。
    *
    * @module @buka/dsh-plugin-skills/client/view-cache
    */
    /**
    * 收藏页本地缓存的键：展开过哪些仓库、收起了哪些目录、每个仓库上次拿到的
    * skills 树。放在浏览器 localStorage 里（和 DSH 自己的 `dsh.sessions.current`
    * 等页面状态同一个 origin），这样关掉 DSH 再打开时能先按上次的样子渲染，
    * 不用等 Host 重新拉取仓库。键名沿用 DSH 的 `dsh.` 前缀并带版本号。
    */
    const VIEW_CACHE_KEY = "dsh.buka-skills.view.v1";
    /**
    * 本地缓存的格式版本；版本不符就当没有缓存，不做迁移。
    *
    * v3：技能叶子改为包含 SKILL.md 的目录（v2 及更早缓存里的叶子指向 SKILL.md
    * 文件，还会多套一层目录），旧树直接丢弃重新拉。
    */
    const VIEW_CACHE_VERSION = 3;
    /**
    * 取 localStorage；隐私模式、没有 window 或 storage 被禁用时返回 null。
    * 缓存是可重建的页面状态，任何访问失败都不该让页面挂掉。
    */
    function viewStorage() {
    	try {
    		if (typeof window === "undefined") return null;
    		return window.localStorage ?? null;
    	} catch {
    		return null;
    	}
    }
    /**
    * 读收藏页的本地缓存。
    *
    * 形状不对、版本不符、JSON 坏了都直接当没有缓存：这里只恢复「看起来对」
    * 的状态，不尝试修数据。树的校验只到 `root` 是数组为止，渲染层本来就容忍
    * 缺字段（描述、children 都有兜底）。
    */
    function readViewCache() {
    	const storage = viewStorage();
    	if (storage === null) return null;
    	let raw;
    	try {
    		raw = storage.getItem(VIEW_CACHE_KEY);
    	} catch {
    		return null;
    	}
    	if (raw === null) return null;
    	let parsed;
    	try {
    		parsed = JSON.parse(raw);
    	} catch {
    		return null;
    	}
    	if (parsed === null || typeof parsed !== "object") return null;
    	const record = parsed;
    	if (record.version !== VIEW_CACHE_VERSION) return null;
    	const expandedRepos = {};
    	if (Array.isArray(record.expanded)) {
    		for (const id of record.expanded) if (typeof id === "string" && id !== "") expandedRepos[id] = true;
    	}
    	const collapsedDirs = {};
    	if (record.collapsedDirs !== null && typeof record.collapsedDirs === "object" && !Array.isArray(record.collapsedDirs)) for (const [id, dirs] of Object.entries(record.collapsedDirs)) {
    		if (dirs === null || typeof dirs !== "object" || Array.isArray(dirs)) continue;
    		const kept = {};
    		for (const [dir, collapsed] of Object.entries(dirs)) if (collapsed === true) kept[dir] = true;
    		if (Object.keys(kept).length > 0) collapsedDirs[id] = kept;
    	}
    	const trees = {};
    	if (record.trees !== null && typeof record.trees === "object" && !Array.isArray(record.trees)) for (const [id, data] of Object.entries(record.trees)) {
    		if (data === null || typeof data !== "object" || !Array.isArray(data.root)) continue;
    		trees[id] = {
    			status: "ready",
    			data,
    			error: null
    		};
    	}
    	return {
    		expandedRepos,
    		collapsedDirs,
    		trees
    	};
    }
    /**
    * 写收藏页的本地缓存。
    *
    * 只缓存当前展开着的仓库的树：收起的卡片重开 DSH 后仍按原来的路径重新取，
    * 不会拿一份旧树冒充新数据；恢复出来的展开卡片也一定带内容，不会展开成
    * 一片空白。配额写不下时直接丢掉整份缓存——下次打开只是回到默认的收起
    * 状态，不影响功能。
    */
    function writeViewCache({ expandedRepos, collapsedDirs, trees }) {
    	const storage = viewStorage();
    	if (storage === null) return;
    	const cachedTrees = {};
    	for (const [id, state] of Object.entries(trees)) {
    		if (expandedRepos[id] !== true) continue;
    		if (state?.data === null || state?.data === void 0) continue;
    		cachedTrees[id] = state.data;
    	}
    	const expanded = Object.keys(expandedRepos).filter((id) => expandedRepos[id] === true && cachedTrees[id] !== void 0);
    	const cachedCollapsed = {};
    	for (const id of expanded) {
    		const dirs = collapsedDirs[id];
    		if (dirs !== void 0) cachedCollapsed[id] = dirs;
    	}
    	const remove = () => {
    		try {
    			storage.removeItem(VIEW_CACHE_KEY);
    		} catch {}
    	};
    	if (expanded.length === 0) {
    		remove();
    		return;
    	}
    	const payload = {
    		version: VIEW_CACHE_VERSION,
    		expanded,
    		collapsedDirs: cachedCollapsed,
    		trees: cachedTrees
    	};
    	try {
    		storage.setItem(VIEW_CACHE_KEY, JSON.stringify(payload));
    	} catch {
    		remove();
    	}
    }
    // .build/skills/client/state.js
    /**
    * 页面状态与请求：一个 Hook 管住「技能仓库」与「全局技能」两个面板的数据。
    *
    * 页面只做展示与触发：列表、卸载、安装、收藏的读写都走 Host 一半注册的包内
    * 路由（`/buka-skills/*`），不在浏览器里判断 npx 的安装方式，也不碰文件系统 ——
    * 这样「怎么卸载」「怎么安装」「收藏存在哪」都只有一份实现。收藏页的展开状态与
    * 上次拿到的树属于纯页面状态，缓存在 localStorage（`dsh.buka-skills.view.v1`）：
    * 关闭 DSH 再打开时先按上次的样子渲染，再找 Host 校正，不用干等网络。
    *
    * 面板组件只消费这里返回的状态与动作，不自己发请求。
    *
    * @module @buka/dsh-plugin-skills/client/state
    */
    /**
    * 页面的全部状态、副作用与请求。
    *
    * @param t 翻译函数
    */
    function useSkillsPageState(t) {
    	const [tab, setTab] = react.default.useState("repos");
    	const [installed, setInstalled] = react.default.useState({
    		data: null,
    		error: null,
    		loading: true
    	});
    	const [saved, setSaved] = react.default.useState({
    		data: null,
    		error: null,
    		loading: true
    	});
    	const [reloadKey, setReloadKey] = react.default.useState(0);
    	const pendingCheckRef = react.default.useRef(true);
    	const [notice, setNotice] = react.default.useState(null);
    	const [busy, setBusy] = react.default.useState(null);
    	const [checking, setChecking] = react.default.useState(false);
    	const [updating, setUpdating] = react.default.useState(false);
    	const [checkResults, setCheckResults] = react.default.useState({});
    	const [checkMessage, setCheckMessage] = react.default.useState(null);
    	const [confirming, setConfirming] = react.default.useState(null);
    	const [source, setSource] = react.default.useState("");
    	const [note, setNote] = react.default.useState("");
    	const [adding, setAdding] = react.default.useState(false);
    	const [dialogOpen, setDialogOpen] = react.default.useState(false);
    	const [addError, setAddError] = react.default.useState(null);
    	const [removing, setRemoving] = react.default.useState(null);
    	const [installing, setInstalling] = react.default.useState(null);
    	const [targetDialog, setTargetDialog] = react.default.useState(null);
    	const [targets, setTargets] = react.default.useState({
    		data: null,
    		error: null,
    		loading: false
    	});
    	const [targetChoice, setTargetChoice] = react.default.useState("");
    	const [targetInstalling, setTargetInstalling] = react.default.useState(false);
    	const [targetError, setTargetError] = react.default.useState(null);
    	const targetRequestRef = react.default.useRef(0);
    	const [restored] = react.default.useState(readViewCache);
    	const [expandedRepos, setExpandedRepos] = react.default.useState(restored?.expandedRepos ?? {});
    	const [trees, setTrees] = react.default.useState(restored?.trees ?? {});
    	const [collapsedDirs, setCollapsedDirs] = react.default.useState(restored?.collapsedDirs ?? {});
    	const [probes, setProbes] = react.default.useState({});
    	react.default.useEffect(() => {
    		let cancelled = false;
    		pendingCheckRef.current = true;
    		setInstalled((prev) => ({
    			...prev,
    			loading: true,
    			error: null
    		}));
    		setSaved((prev) => ({
    			...prev,
    			loading: true,
    			error: null
    		}));
    		requestJson(LIST_ROUTE).then((body) => {
    			if (!cancelled) setInstalled({
    				data: body,
    				error: null,
    				loading: false
    			});
    		}, (failure) => {
    			if (!cancelled) setInstalled((prev) => ({
    				...prev,
    				error: messageOf(failure),
    				loading: false
    			}));
    		});
    		requestJson(REPOS_ROUTE).then((body) => {
    			if (!cancelled) setSaved({
    				data: body,
    				error: null,
    				loading: false
    			});
    		}, (failure) => {
    			if (!cancelled) setSaved((prev) => ({
    				...prev,
    				error: messageOf(failure),
    				loading: false
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [reloadKey]);
    	const installedData = installed.data;
    	const skills = Array.isArray(installedData?.skills) ? installedData.skills : [];
    	const savedData = saved.data;
    	const repos = Array.isArray(savedData?.repos) ? savedData.repos : [];
    	const storeCorrupt = savedData !== null && savedData.corrupt === true;
    	const loading = tab === "installed" ? installed.loading : saved.loading;
    	const hasUpdates = Object.values(checkResults).some((entry) => entry.status === "update");
    	react.default.useEffect(() => {
    		if (installed.loading || installedData === null) return;
    		if (!pendingCheckRef.current) return;
    		if (checking || updating) return;
    		pendingCheckRef.current = false;
    		if (skills.length === 0) return;
    		checkUpdates();
    	}, [
    		installed.loading,
    		installedData,
    		skills.length,
    		checking,
    		updating
    	]);
    	const installedRepos = react.default.useMemo(() => {
    		const keys = /* @__PURE__ */ new Set();
    		for (const skill of skills) for (const value of [skill.npxSource, skill.npxSourceUrl]) {
    			const key = normalizeRepo(value).key;
    			if (key !== "") keys.add(key);
    		}
    		return keys;
    	}, [installedData]);
    	const installedSkillKeys = react.default.useMemo(() => {
    		const keys = /* @__PURE__ */ new Set();
    		for (const skill of skills) for (const value of [skill.id, skill.name]) {
    			const key = skillKeyOf(value);
    			if (key !== "") keys.add(key);
    		}
    		return keys;
    	}, [installedData]);
    	react.default.useEffect(() => {
    		if (savedData === null) return;
    		const ids = new Set(repos.map((repo) => repo.id));
    		const prune = (record) => {
    			const kept = {};
    			let dropped = false;
    			for (const [key, value] of Object.entries(record)) if (ids.has(key)) kept[key] = value;
    			else dropped = true;
    			return dropped ? kept : record;
    		};
    		setExpandedRepos(prune);
    		setTrees(prune);
    		setCollapsedDirs(prune);
    		setProbes(prune);
    	}, [savedData]);
    	react.default.useEffect(() => {
    		writeViewCache({
    			expandedRepos,
    			collapsedDirs,
    			trees
    		});
    	}, [
    		expandedRepos,
    		collapsedDirs,
    		trees
    	]);
    	const revalidatedRef = react.default.useRef(false);
    	react.default.useEffect(() => {
    		if (tab !== "repos" || savedData === null || revalidatedRef.current) return;
    		revalidatedRef.current = true;
    		for (const repo of repos) if (expandedRepos[repo.id] === true) loadTree(repo);
    	}, [tab, savedData]);
    	react.default.useEffect(() => {
    		if (tab !== "repos" || savedData === null) return;
    		for (const repo of repos) {
    			if (!isListableSource(repo.source)) continue;
    			if (probes[repo.id] !== void 0) continue;
    			probeRepo(repo);
    		}
    	}, [
    		tab,
    		savedData,
    		probes
    	]);
    	/**
    	* 页面「刷新」：重读列表与收藏，并强制刷新已展开仓库的树；没展开的
    	* 仓库继续用 Host 缓存，等下次展开再取，避免一次刷新打十几个请求。
    	* 所有可列出的收藏同时强制重探仓库类型（刷新徽标），失败保留旧徽标。
    	*/
    	function reload() {
    		setReloadKey((key) => key + 1);
    		for (const repo of repos) {
    			if (expandedRepos[repo.id] === true) loadTree(repo, { refresh: true });
    			if (isListableSource(repo.source)) probeRepo(repo, { refresh: true });
    		}
    	}
    	/**
    	* 取一个仓库的 skills 树。Host 侧有 TTL 缓存并负责拉取仓库内容，这里只在
    	* 展开与页面刷新时发请求；失败时保留旧数据，只更新错误状态。
    	*
    	* @param repo 一条收藏
    	* @param options 是否绕过 Host 缓存
    	*/
    	async function loadTree(repo, options = {}) {
    		const refresh = options.refresh === true;
    		setTrees((prev) => ({
    			...prev,
    			[repo.id]: {
    				status: "loading",
    				data: prev[repo.id]?.data ?? null,
    				error: null
    			}
    		}));
    		try {
    			const query = `?source=${encodeURIComponent(repo.source)}${refresh ? "&refresh=1" : ""}`;
    			const body = await requestJson(`${REPO_SKILLS_ROUTE}${query}`);
    			setTrees((prev) => ({
    				...prev,
    				[repo.id]: {
    					status: "ready",
    					data: body,
    					error: null
    				}
    			}));
    		} catch (failure) {
    			setTrees((prev) => ({
    				...prev,
    				[repo.id]: {
    					status: "error",
    					data: prev[repo.id]?.data ?? null,
    					error: failure
    				}
    			}));
    		}
    	}
    	/**
    	* 探测一个仓库的类型（npx 仓库 / 不可用）。Host 只读仓库树，比展开轻得多，
    	* 所以收藏页打开后可以对所有可列出的收藏各发一次。
    	*
    	* 「不可用」是正常结论而不是错误：Host 返回 `repo-unavailable` 时转成
    	* `{ kind: 'unavailable' }` 的 ready 数据，让卡片显示「不可用」徽标，不弹
    	* 错误；其它失败保留旧徽标、静默，等用户展开时再看完整的错误信息。
    	*
    	* @param repo 一条收藏
    	* @param options 是否绕过 Host 缓存
    	*/
    	async function probeRepo(repo, options = {}) {
    		const refresh = options.refresh === true;
    		setProbes((prev) => ({
    			...prev,
    			[repo.id]: {
    				status: "loading",
    				data: prev[repo.id]?.data ?? null,
    				error: null
    			}
    		}));
    		try {
    			const query = `?source=${encodeURIComponent(repo.source)}&probe=1${refresh ? "&refresh=1" : ""}`;
    			const body = await requestJson(`${REPO_SKILLS_ROUTE}${query}`);
    			setProbes((prev) => ({
    				...prev,
    				[repo.id]: {
    					status: "ready",
    					data: body,
    					error: null
    				}
    			}));
    		} catch (failure) {
    			if (errorCode(failure) === "repo-unavailable") {
    				setProbes((prev) => ({
    					...prev,
    					[repo.id]: {
    						status: "ready",
    						data: { kind: "unavailable" },
    						error: null
    					}
    				}));
    				return;
    			}
    			setProbes((prev) => ({
    				...prev,
    				[repo.id]: {
    					status: "error",
    					data: prev[repo.id]?.data ?? null,
    					error: failure
    				}
    			}));
    		}
    	}
    	/**
    	* 展开 / 收起一个收藏仓库；首次展开时拉树，之后走状态里的数据。
    	*
    	* @param repo 一条收藏
    	*/
    	function toggleRepo(repo) {
    		const willExpand = expandedRepos[repo.id] !== true;
    		setExpandedRepos((prev) => {
    			const next = { ...prev };
    			if (willExpand) next[repo.id] = true;
    			else delete next[repo.id];
    			return next;
    		});
    		if (willExpand && trees[repo.id] === void 0) loadTree(repo);
    	}
    	/**
    	* 收起 / 展开树里的一个目录。
    	*
    	* @param repo 一条收藏
    	* @param dirPath 目录节点的相对路径
    	*/
    	function toggleDir(repo, dirPath) {
    		setCollapsedDirs((prev) => {
    			const repoDirs = { ...prev[repo.id] ?? {} };
    			if (repoDirs[dirPath] === true) delete repoDirs[dirPath];
    			else repoDirs[dirPath] = true;
    			return {
    				...prev,
    				[repo.id]: repoDirs
    			};
    		});
    	}
    	/**
    	* 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
    	*/
    	function flash(kind, text) {
    		setNotice({
    			kind,
    			text,
    			seq: Date.now() + Math.random()
    		});
    	}
    	/**
    	* 请求 Host 卸载一条 skill；Host 会按 npx 管理与否选择方式。
    	*
    	* @param entry 一条 skill
    	*/
    	async function uninstall(entry) {
    		setBusy(entryKey(entry));
    		try {
    			flash("success", `${(await requestJson("/buka-skills/uninstall", {
    				method: "POST",
    				body: JSON.stringify({
    					scope: entry.scope,
    					id: entry.id
    				})
    			})).method === "npx" ? t("removedWithNpx") : t("removedLocally")} ${entry.name}`);
    			setConfirming(null);
    			reload();
    		} catch (failure) {
    			flash("error", `${t("failed")} ${messageOf(failure)}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/**
    	* 把 Host 返回的检查结果按已安装行的键索引：Host 只给名字，页面用
    	* `skillKeyOf()` 与目录名 / 展示名两个来源匹配。
    	*/
    	function indexCheckResults(results) {
    		const indexed = {};
    		for (const result of results) {
    			const wanted = skillKeyOf(result.name);
    			if (wanted === "") continue;
    			const entry = skills.find((one) => skillKeyOf(one.name) === wanted || skillKeyOf(one.id) === wanted);
    			if (entry !== void 0) indexed[entryKey(entry)] = result;
    		}
    		return indexed;
    	}
    	/**
    	* 检查全局 skill 的更新；由列表落地后的自动检查调用，结果只影响「全局技能」
    	* 面板的状态标记与提示。
    	*/
    	async function checkUpdates() {
    		if (checking || updating) return;
    		setChecking(true);
    		setCheckMessage(null);
    		try {
    			const body = await requestJson(CHECK_ROUTE);
    			setCheckResults(indexCheckResults(Array.isArray(body.results) ? body.results : []));
    			setCheckMessage(typeof body.message === "string" ? body.message : null);
    		} catch (failure) {
    			flash("error", `${t("checkFailed")} ${messageOf(failure)}`);
    		} finally {
    			setChecking(false);
    		}
    	}
    	/**
    	* 应用可用的更新：Host 只处理 `update` 状态，`modified` 会跳过并在结果里说明。
    	*/
    	async function updateSkills() {
    		if (checking || updating) return;
    		setUpdating(true);
    		setCheckMessage(null);
    		try {
    			const body = await requestJson(UPDATE_ROUTE, { method: "POST" });
    			const failed = Array.isArray(body.failed) ? body.failed.length : 0;
    			const message = typeof body.message === "string" && body.message !== "" ? body.message : failed > 0 ? t("updateFailed") : t("statusUpToDate");
    			flash(failed > 0 ? "error" : "success", message);
    			await refreshInstalled();
    			const checked = await requestJson(CHECK_ROUTE);
    			setCheckResults(indexCheckResults(Array.isArray(checked.results) ? checked.results : []));
    			setCheckMessage(typeof checked.message === "string" ? checked.message : null);
    		} catch (failure) {
    			flash("error", `${t("updateFailed")} ${messageOf(failure)}`);
    		} finally {
    			setUpdating(false);
    		}
    	}
    	/**
    	* 只重读「全局技能」列表：安装成功后调用，让新 skill 立刻出现在列表里，
    	* 技能仓库页的「已安装」标记也随之更新。不刷新仓库树与探测，省掉一轮网络请求。
    	*/
    	async function refreshInstalled() {
    		try {
    			const body = await requestJson(LIST_ROUTE);
    			setInstalled({
    				data: body,
    				error: null,
    				loading: false
    			});
    		} catch (failure) {
    			setInstalled((prev) => ({
    				...prev,
    				error: messageOf(failure),
    				loading: false
    			}));
    		}
    	}
    	/**
    	* 安装树里的一个 skill：Host 校验来源是收藏、skill 在仓库列表里，然后交给
    	* `npx skills add` 装到全局 `~/.agents/skills`。成功后只刷新已安装列表，
    	* 树保持展开，用户能接着装下一个。
    	*
    	* @param repo 一条收藏
    	* @param node Host 返回的 skill 节点
    	*/
    	async function installSkill(repo, node) {
    		if (installing !== null) return;
    		setInstalling(installKeyOf(repo, node));
    		try {
    			const body = await requestJson(INSTALL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					source: repo.source,
    					path: node.path
    				})
    			});
    			flash("success", `${t("installedToast")} ${body.name ?? node.name}`);
    			await refreshInstalled();
    		} catch (failure) {
    			flash("error", errorCode(failure) === "skill-not-found" ? t("installMissing") : `${t("installFailed")} ${messageOf(failure)}`);
    		} finally {
    			setInstalling(null);
    		}
    	}
    	/**
    	* 安装一个目录里的全部 skill：把目录下每个 skill 的仓库路径一起交给 Host，
    	* 由 Host 逐个走 `npx skills`，全局安装时已装过的会跳过。成功后只刷新已
    	* 安装列表，树保持展开，用户能接着装别的目录。
    	*
    	* @param repo 一条收藏
    	* @param node 树里的目录节点
    	*/
    	async function installDir(repo, node) {
    		if (installing !== null || targetInstalling) return;
    		const paths = skillLeavesOf(node).map((leaf) => leaf.path);
    		if (paths.length === 0) return;
    		setInstalling(installKeyOf(repo, node));
    		try {
    			const body = await requestJson(INSTALL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					source: repo.source,
    					paths
    				})
    			});
    			const installed = body.installed?.length ?? 0;
    			const skipped = body.skipped?.length ?? 0;
    			flash("success", installed === 0 ? t("dirAllInstalled") : `${t("installedDirToast")} ${installed}${skipped > 0 ? ` · ${t("skippedInstalledToast")} ${skipped}` : ""}`);
    			await refreshInstalled();
    		} catch (failure) {
    			await refreshInstalled();
    			flash("error", errorCode(failure) === "skill-not-found" ? t("installMissing") : `${t("installFailed")} ${messageOf(failure)}`);
    		} finally {
    			setInstalling(null);
    		}
    	}
    	/**
    	* 读一次目标列表；成功后默认选中第一项，让「安装」按钮直接可用。
    	*
    	* @param kind 目标类型
    	*/
    	async function loadTargets(kind) {
    		const request = ++targetRequestRef.current;
    		setTargets((prev) => ({
    			data: prev.data,
    			error: null,
    			loading: true
    		}));
    		try {
    			const body = await requestJson(TARGETS_ROUTE);
    			if (request !== targetRequestRef.current) return;
    			setTargets({
    				data: body,
    				error: null,
    				loading: false
    			});
    			const first = targetItemsOf(kind, body)[0];
    			setTargetChoice((prev) => prev === "" ? targetKeyOf(kind, first) : prev);
    		} catch (failure) {
    			if (request !== targetRequestRef.current) return;
    			setTargets((prev) => ({
    				data: prev.data,
    				error: messageOf(failure),
    				loading: false
    			}));
    		}
    	}
    	/**
    	* 打开「安装到执行者 / 工作区」对话框。
    	*
    	* @param kind 目标类型
    	* @param repo 一条收藏
    	* @param node Host 返回的 skill 或目录节点
    	*/
    	function openTargetDialog(kind, repo, node) {
    		if (installing !== null || targetInstalling) return;
    		targetRequestRef.current += 1;
    		setTargetDialog({
    			kind,
    			repo,
    			node
    		});
    		setTargetChoice("");
    		setTargetError(null);
    		setTargets({
    			data: null,
    			error: null,
    			loading: false
    		});
    		loadTargets(kind);
    	}
    	/** 清空对话框状态；安装成功时也用它，因为此时 `targetInstalling` 还是 true。 */
    	function resetTargetDialog() {
    		targetRequestRef.current += 1;
    		setTargetDialog(null);
    		setTargetChoice("");
    		setTargetError(null);
    		setTargets({
    			data: null,
    			error: null,
    			loading: false
    		});
    	}
    	/** 关闭对话框；安装中不响应，避免请求回来时状态错位。 */
    	function closeTargetDialog() {
    		if (targetInstalling) return;
    		resetTargetDialog();
    	}
    	/** 重新读取当前对话框的目标列表。 */
    	function reloadTargets() {
    		if (targetDialog === null || targetInstalling) return;
    		loadTargets(targetDialog.kind);
    	}
    	/**
    	* 把当前选中的 skill / 目录安装到选中的执行者 / 工作区。Host 会把选择换回
    	* 登记表里的可信目录；目录会把其下每个 skill 的路径一起传上去。成功后关掉
    	* 对话框并提示，失败留在框里显示（与「收藏」对话框一致）。
    	*/
    	async function installToTarget() {
    		if (targetDialog === null || targetInstalling) return;
    		const kind = targetDialog.kind;
    		const choice = targetChoice;
    		if (choice === "") return;
    		const label = targetLabelOf(kind, targetItemsOf(kind, targets.data).find((item) => targetKeyOf(kind, item) === choice)) || choice;
    		const node = targetDialog.node;
    		setTargetInstalling(true);
    		setTargetError(null);
    		try {
    			const body = await requestJson(INSTALL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					source: targetDialog.repo.source,
    					...node.type === "dir" ? { paths: skillLeavesOf(node).map((leaf) => leaf.path) } : { path: node.path },
    					target: kind,
    					...kind === "worker" ? { worker: choice } : { workspace: choice }
    				})
    			});
    			resetTargetDialog();
    			if (node.type === "dir") flash("success", `${t(kind === "worker" ? "installedDirToWorker" : "installedDirToWorkspace")} ${label} · ${body.installed?.length ?? 0}`);
    			else flash("success", `${t(kind === "worker" ? "installedToWorker" : "installedToWorkspace")} ${body.name ?? node.name} → ${label}`);
    		} catch (failure) {
    			const text = errorCode(failure) === "skill-not-found" ? t("installMissing") : `${t("installFailed")} ${messageOf(failure)}`;
    			setTargetError(text);
    		} finally {
    			setTargetInstalling(false);
    		}
    	}
    	/**
    	* 打开「收藏」对话框：清掉上一次的失败提示与残留输入。
    	* 收藏文件坏掉时不能写，按钮本身已禁用，这里再兜一次。
    	*/
    	function openSaveDialog() {
    		if (adding || storeCorrupt) return;
    		setAddError(null);
    		setSource("");
    		setNote("");
    		setDialogOpen(true);
    	}
    	/** 关闭「收藏」对话框；提交中不允许关闭，避免请求回来时状态错位。 */
    	function closeSaveDialog() {
    		if (adding) return;
    		setDialogOpen(false);
    		setAddError(null);
    		setSource("");
    		setNote("");
    	}
    	/**
    	* 收藏一个仓库；Host 负责校验、去重与写文件。对话框内的失败留在对话框里
    	* 显示，用户可以直接改了再提交，不用关掉重开。
    	*
    	* @param event 表单提交事件
    	*/
    	async function addRepo(event) {
    		event.preventDefault();
    		if (adding) return;
    		const value = source.trim();
    		if (value === "") return;
    		setAdding(true);
    		setAddError(null);
    		try {
    			const body = await requestJson(REPOS_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					source: value,
    					note
    				})
    			});
    			setSaved({
    				data: body,
    				error: null,
    				loading: false
    			});
    			setDialogOpen(false);
    			setSource("");
    			setNote("");
    			flash("success", `${t("added")} ${body.repo?.source ?? value}`);
    		} catch (failure) {
    			const code = errorCode(failure);
    			const text = code === "duplicate" ? `${t("duplicate")} ${value}` : code === "invalid-source" ? t("invalidSource") : code === "invalid-note" ? t("invalidNote") : code === "store-unreadable" ? t("storeUnreadable") : `${t("addFailed")} ${messageOf(failure)}`;
    			setAddError(text);
    		} finally {
    			setAdding(false);
    		}
    	}
    	/**
    	* 删除一条收藏；只动收藏文件，不碰已安装的 skill。
    	*
    	* @param repo 一条收藏
    	*/
    	async function removeRepo(repo) {
    		setRemoving(repo.id);
    		try {
    			const body = await requestJson(REPO_REMOVE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({ id: repo.id })
    			});
    			setSaved((prev) => ({
    				...prev,
    				data: {
    					...prev.data ?? {},
    					...body
    				},
    				error: null,
    				loading: false
    			}));
    			flash("success", `${t("removed")} ${repo.source}`);
    		} catch (failure) {
    			flash("error", `${t("removeFailed")} ${messageOf(failure)}`);
    		} finally {
    			setRemoving(null);
    		}
    	}
    	/** 切 Tab 时清掉上一条提示，避免串台。 */
    	function switchTab(next) {
    		if (next === tab) return;
    		setNotice(null);
    		setTab(next);
    	}
    	return {
    		t,
    		tab,
    		installed,
    		installedData,
    		saved,
    		savedData,
    		skills,
    		repos,
    		storeCorrupt,
    		loading,
    		notice,
    		setNotice,
    		busy,
    		checking,
    		updating,
    		checkResults,
    		checkMessage,
    		hasUpdates,
    		updateSkills,
    		confirming,
    		setConfirming,
    		source,
    		setSource,
    		note,
    		setNote,
    		adding,
    		dialogOpen,
    		addError,
    		removing,
    		expandedRepos,
    		trees,
    		collapsedDirs,
    		probes,
    		installedRepos,
    		installedSkillKeys,
    		installing,
    		targetDialog,
    		targets,
    		targetChoice,
    		targetInstalling,
    		targetError,
    		reload,
    		loadTree,
    		probeRepo,
    		toggleRepo,
    		toggleDir,
    		uninstall,
    		refreshInstalled,
    		installSkill,
    		installDir,
    		openTargetDialog,
    		closeTargetDialog,
    		setTargetChoice,
    		reloadTargets,
    		installToTarget,
    		openSaveDialog,
    		closeSaveDialog,
    		addRepo,
    		removeRepo,
    		switchTab
    	};
    }
    // .build/skills/client/components/repo-avatar.js
    /**
    * 仓库头像：Host 图标缓存路由返回的 GitHub owner 头像，拿不到时回退到调用方
    * 给的内置图标。
    *
    * 加载顺序：Host 图标缓存路由 → 直连 GitHub → 内置图标。旧版 Host 还没注册
    * 图标路由时（或路由暂时不可用）自动退回直连，避免页面上的头像整体消失。
    *
    * Host 有磁盘缓存时直接返回；缓存过期也在后台静默更新，不阻塞列表渲染。
    * 头像只用于识别来源，不承载文案，所以 `alt` 留空并按装饰图处理；最终加载
    * 失败（离线、来源不是 GitHub、两次都拉不到）时不再重试，显示内置图标。失败
    * 记在具体的 URL 上，来源换了会重新尝试。
    *
    * @module @buka/dsh-plugin-skills/client/components/repo-avatar
    */
    /**
    * GitHub 仓库头像；没有头像时显示回退图标。
    *
    * @param props 来源、尺寸与回退图标
    */
    function RepoAvatar(props) {
    	const routeUrl = repoIconUrl(props.source);
    	const directUrl = repoDirectIconUrl(props.source);
    	const [failedRoute, setFailedRoute] = (0, react.useState)(null);
    	const [failedDirect, setFailedDirect] = (0, react.useState)(null);
    	const src = failedRoute === routeUrl && directUrl !== "" ? directUrl : routeUrl;
    	if (routeUrl === "" || failedDirect === src || failedRoute === routeUrl && directUrl === "") return props.fallback;
    	return h("img", {
    		className: "buka-skills-avatar",
    		src,
    		alt: "",
    		"aria-hidden": true,
    		width: props.size,
    		height: props.size,
    		loading: "lazy",
    		decoding: "async",
    		referrerPolicy: "no-referrer",
    		onError: () => {
    			if (src === routeUrl) setFailedRoute(routeUrl);
    			else setFailedDirect(src);
    		}
    	});
    }
    // .build/skills/client/components/installed-panel.js
    /**
    * 「全局技能」面板：两个全局根下的 skill 卡片、自动检查后的状态与更新入口、
    * lockfile 提示与卸载按钮。
    *
    * 检查由页面在列表落地后自动发起，结果按 `update` / `modified` / `up-to-date` /
    * `unsupported-source` / `failed` 在每行标题旁标出；检查 / 更新进行中统一禁用
    * 按钮。数据与动作由页面状态（`useSkillsPageState`）提供。
    *
    * @module @buka/dsh-plugin-skills/client/components/installed-panel
    */
    /**
    * 标题行第二个标签：安装来源。
    *
    * - npx skills 管理：显示来源仓库（如 `vercel-labs/skills`），lockfile
    *   没写来源时退回 `npx skills`；
    * - 其它：`manual`。
    *
    * @param entry 一条 skill
    * @param t 翻译函数
    */
    function sourceTagOf(entry, t) {
    	if (entry.managedByNpx !== true) return {
    		text: t("badgeManual"),
    		tone: "outline"
    	};
    	const source = repoLabel(entry.npxSourceUrl) || repoLabel(entry.npxSource);
    	return {
    		text: source === "" ? t("badgeNpx") : source,
    		tone: "info"
    	};
    }
    /**
    * 检查结果 → 行内状态标签；没有结果（还没检查、手工安装）时不显示。
    */
    function statusTagOf(result, t) {
    	switch (result?.status) {
    		case "update": return {
    			text: t("statusUpdate"),
    			tone: "info"
    		};
    		case "modified": return {
    			text: t("statusModified"),
    			tone: "warning"
    		};
    		case "up-to-date": return {
    			text: t("statusUpToDate"),
    			tone: "success"
    		};
    		case "unsupported-source": return {
    			text: t("statusUnsupported"),
    			tone: "warning"
    		};
    		case "failed": return {
    			text: t("statusFailed"),
    			tone: "warning"
    		};
    		default: return null;
    	}
    }
    /**
    * 一行右侧的操作区：卸载 / 二次确认 / 进行中。
    * 按钮样式与 Plugins 页面的卸载按钮一致（outline + 危险色）。
    *
    * @param entry 一条 skill
    */
    function rowActions(entry, state) {
    	const { busy, confirming, t } = state;
    	const anyBusy = busy !== null;
    	if (busy === entryKey(entry)) return h("span", { className: "buka-skills-statusWithDot" }, h(StateDot, { state: "ongoing" }), t("uninstalling"));
    	if (confirming === entryKey(entry)) return [h(Button, {
    		key: "confirm",
    		variant: "outline",
    		size: "sm",
    		className: "buka-skills-danger",
    		icon: h(IconWarningOutlineRegular, { size: 13 }),
    		onClick: state.onConfirm,
    		disabled: anyBusy
    	}, t("confirmRemove")), h(Button, {
    		key: "cancel",
    		variant: "ghost",
    		size: "sm",
    		onClick: state.onCancel,
    		disabled: anyBusy
    	}, t("cancel"))];
    	return h(Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-skills-danger",
    		icon: h(IconTrashOutlineRegular, { size: 13 }),
    		"aria-label": `${t("uninstall")} ${entry.name}`,
    		onClick: state.onAsk,
    		disabled: anyBusy
    	}, t("uninstall"));
    }
    /**
    * 「全局技能」页：卡片列表、lockfile 提示与卸载按钮。
    *
    * @param state 页面状态与动作
    */
    function renderInstalled(state) {
    	const { t, skills, busy, checking, updating, checkResults, checkMessage, hasUpdates, updateSkills, confirming, setConfirming, uninstall, installed, installedData } = state;
    	const anyCheckBusy = checking || updating;
    	const rows = skills.map((entry) => {
    		const source = sourceTagOf(entry, t);
    		const status = statusTagOf(checkResults[entryKey(entry)], t);
    		return h("li", {
    			className: "buka-skills-card",
    			key: `${entry.scope}:${entry.id}`
    		}, h("div", { className: "buka-skills-cardHead" }, h("span", {
    			className: "buka-skills-cardLead",
    			"aria-hidden": true
    		}, h(RepoAvatar, {
    			source: entry.npxSourceUrl ?? entry.npxSource,
    			size: 24,
    			fallback: h(IconSkillOutlineRegular, { size: 16 })
    		})), h("div", { className: "buka-skills-cardMain" }, h("div", { className: "buka-skills-titleRow" }, h("div", { className: "buka-skills-titleCluster" }, h("span", {
    			className: "buka-skills-cardTitle",
    			title: entry.name
    		}, entry.name), status === null ? null : h(Tag, { tone: status.tone }, status.text), h(Tag, { tone: "neutral" }, entry.scope), h(Tag, { tone: source.tone }, source.text)), h("div", { className: "buka-skills-titleActions" }, rowActions(entry, {
    			busy,
    			confirming,
    			t,
    			onAsk: () => setConfirming(entryKey(entry)),
    			onCancel: () => setConfirming(null),
    			onConfirm: () => uninstall(entry)
    		}))), typeof entry.description === "string" && entry.description !== "" ? h("div", {
    			className: "buka-skills-cardDesc",
    			title: entry.description
    		}, entry.description) : null, confirming === entryKey(entry) ? h("p", { className: "buka-skills-hint" }, entry.managedByNpx === true ? t("confirmNpx") : t("confirmLocal")) : null)));
    	});
    	const rootsTip = installedData !== null && Array.isArray(installedData.roots) && installedData.roots.length > 0 ? h("p", { className: "buka-skills-meta" }, installedData.roots.map((root) => root.path).join(" · ")) : null;
    	const emptyState = h("div", { className: "buka-skills-emptyState" }, h("span", {
    		className: "buka-skills-emptyIcon",
    		"aria-hidden": true
    	}, h(IconSkillOutlineRegular, { size: 28 })), h("p", { className: "buka-skills-emptyTitle" }, t("empty")), h("p", { className: "buka-skills-emptyHint" }, t("emptyHint")), rootsTip);
    	return h("div", { className: "buka-skills-panel" }, h("div", { className: "buka-skills-panelActions" }, checking ? h("p", {
    		className: "buka-skills-statusWithDot",
    		role: "status"
    	}, h(StateDot, {
    		state: "ongoing",
    		size: 13
    	}), t("checkingUpdates")) : checkMessage === null ? null : h("p", {
    		className: "buka-skills-meta",
    		role: "status"
    	}, checkMessage), h(Button, {
    		variant: "primary",
    		size: "sm",
    		icon: updating ? h(StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : void 0,
    		disabled: anyCheckBusy || !hasUpdates,
    		onClick: () => void updateSkills()
    	}, updating ? t("updatingSkills") : t("updateSkills"))), installed.error === null ? null : h("p", {
    		className: "buka-skills-failure",
    		role: "alert"
    	}, h(StateDot, { state: "error" }), `${t("loadFailed")} ${installed.error}`), installed.loading && installedData === null ? h("p", {
    		className: "buka-skills-statusWithDot",
    		role: "status"
    	}, h(StateDot, { state: "ongoing" }), t("loading")) : null, installedData !== null && installedData.lock?.corrupt === true ? h("p", {
    		className: "buka-skills-notice",
    		role: "status"
    	}, h(IconWarningOutlineRegular, { size: 16 }), h("span", null, t("corruptLock"), " ", h("span", { className: "buka-skills-path" }, String(installedData.lock?.path ?? "")))) : null, installedData !== null && installedData.lock?.exists === false ? h("p", { className: "buka-skills-status" }, `${t("noLock")} `, h("span", { className: "buka-skills-path" }, String(installedData.lock?.path ?? ""))) : null, installedData !== null && Array.isArray(installedData.warnings) && installedData.warnings.length > 0 ? h("p", {
    		className: "buka-skills-notice",
    		role: "status"
    	}, h(IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("warningsLabel")} `, h("span", { className: "buka-skills-path" }, installedData.warnings.join(" · ")))) : null, installedData === null ? null : rows.length === 0 && !installed.loading ? emptyState : h("ul", { className: "buka-skills-cards" }, ...rows));
    }
    // .build/skills/client/components/save-dialog.js
    /**
    * 「收藏仓库」对话框：仓库必填、备注可选；提交失败留在框里提示，
    * 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
    *
    * @module @buka/dsh-plugin-skills/client/components/save-dialog
    */
    /**
    * 收藏对话框里「仓库」输入框的 props。
    *
    * `data-modal-autofocus` 是 Modal 的焦点约定；Input 的类型没有声明 data-* 属性，
    * 单独抽成变量再传给 `h(Input, …)`，避免对象字面量的多余属性检查。
    */
    function sourceInputProps(placeholder, value, disabled, onChange) {
    	return {
    		className: "buka-skills-fieldInput",
    		type: "text",
    		value,
    		placeholder,
    		autoComplete: "off",
    		spellCheck: false,
    		disabled,
    		"data-modal-autofocus": "",
    		icon: h(IconBranchOutlineRegular, { size: 16 }),
    		onChange: (event) => onChange(event.target.value)
    	};
    }
    /**
    * 「收藏」对话框：仓库必填、备注可选；提交失败留在框里提示，
    * 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
    *
    * @param props 页面状态与动作
    */
    function renderSaveDialog(props) {
    	const { t, dialogOpen, closeSaveDialog, adding, source, setSource, note, setNote, addError, addRepo } = props;
    	return h(Modal, {
    		open: dialogOpen,
    		onClose: closeSaveDialog,
    		title: t("dialogTitle"),
    		closeLabel: t("close"),
    		footer: h(react.Fragment, null, h(Button, {
    			variant: "outline",
    			onClick: closeSaveDialog,
    			disabled: adding
    		}, t("cancel")), h(Button, {
    			variant: "primary",
    			type: "submit",
    			form: SAVE_FORM_ID,
    			disabled: adding || source.trim() === ""
    		}, adding ? t("adding") : t("add")))
    	}, h("form", {
    		id: SAVE_FORM_ID,
    		className: "buka-skills-saveForm",
    		onSubmit: addRepo
    	}, h("label", { className: "buka-skills-field" }, h("span", { className: "buka-skills-fieldLabel" }, t("fieldSource")), h(Input, sourceInputProps(t("addPlaceholder"), source, adding, (value) => setSource(value)))), h("label", { className: "buka-skills-field" }, h("span", { className: "buka-skills-fieldLabel" }, t("fieldNote")), h(Input, {
    		className: "buka-skills-fieldInput",
    		type: "text",
    		value: note,
    		placeholder: t("notePlaceholder"),
    		autoComplete: "off",
    		spellCheck: false,
    		maxLength: 200,
    		disabled: adding,
    		onChange: (event) => setNote(event.target.value)
    	})), addError === null ? null : h("p", {
    		className: "buka-skills-formError",
    		role: "alert"
    	}, addError)));
    }
    // .build/skills/client/components/tree.js
    /**
    * 收藏卡片展开后的树：加载中 / 失败可重试 / 空 / 递归树。
    *
    * 树的状态来自页面（`trees`、`collapsedDirs`、`installing`、目标安装状态与
    * 已安装键集合），这里只负责渲染与把点击转回页面动作，因此用
    * `createTreeRenderer()` 把这份状态绑成 `renderTree` / `renderTreeNode` 两个
    * 函数，供「收藏」面板复用。
    *
    * 目录与 skill 叶子都带三个安装入口：目录行装的是**目录下全部 skill**（有的
    * 仓库里一个插件 / 合集就是一个目录，逐个点 skill 太慢），skill 行只装自己。
    *
    * @module @buka/dsh-plugin-skills/client/components/tree
    */
    /**
    * tree 加载失败时的展示文本；已知错误码说清楚原因，其余带 Host 诊断。
    * `git-unavailable`（本机没有 git）有专门文案；`git-failed` 走默认分支，
    * 带上 Host 给的具体原因（clone/fetch 的 stderr）。
    *
    * @param t 翻译函数
    * @param failure 带 `code` 的错误
    */
    function treeFailureText(t, failure) {
    	switch (errorCode(failure)) {
    		case "repo-not-found": return t("treeNotFound");
    		case "repo-unavailable": return t("treeUnavailable");
    		case "rate-limited": return t("treeRateLimited");
    		case "unsupported-source": return t("treeUnsupported");
    		case "git-unavailable": return t("treeGitUnavailable");
    		case "invalid-source": return t("invalidSource");
    		default: return `${t("treeFailed")} ${messageOf(failure)}`;
    	}
    }
    /**
    * 目录下的 skill 是不是全部已全局安装。
    *
    * 部分已安装时目录按钮保持「全部安装」可用：Host 会跳过已装过的，只装剩下的，
    * 所以这里不能只看「有一个已安装」就禁用。
    *
    * @param dir 目录节点
    * @param installedSkillKeys 已安装 skill 的目录键集合
    */
    function allSkillsInstalled(dir, installedSkillKeys) {
    	const leaves = skillLeavesOf(dir);
    	return leaves.length > 0 && leaves.every((leaf) => installedSkillKeys.has(skillKeyOf(leaf.name)));
    }
    /**
    * 把页面状态绑成树渲染函数。
    *
    * @param props 渲染树需要的页面状态与动作
    */
    function createTreeRenderer(props) {
    	const { t, trees, collapsedDirs, installedSkillKeys, installing, targetInstalling, loadTree, toggleDir, installSkill, installDir, openTargetDialog } = props;
    	/**
    	* 一个仓库展开后的内容：加载中 / 失败可重试 / 空 / 递归树。
    	*
    	* @param repo 一条收藏
    	*/
    	function renderTree(repo) {
    		const state = trees[repo.id];
    		if (state === void 0) return null;
    		const failure = state.status === "error" ? h("div", {
    			className: "buka-skills-treeFailure",
    			role: "alert"
    		}, h(StateDot, { state: "error" }), h("span", null, treeFailureText(t, state.error)), h(Button, {
    			variant: "ghost",
    			size: "sm",
    			onClick: () => loadTree(repo, { refresh: true })
    		}, t("retry"))) : null;
    		const loading = state.data === null ? h("p", {
    			className: "buka-skills-statusWithDot buka-skills-treeStatus",
    			role: "status"
    		}, h(StateDot, { state: "ongoing" }), t("treeLoading")) : null;
    		if (state.data === null) return failure ?? loading;
    		const warning = typeof state.data.warning === "string" && state.data.warning !== "" ? h("p", {
    			className: "buka-skills-notice",
    			role: "status"
    		}, h(IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("treeRefreshWarning")} ${state.data.warning}`)) : null;
    		const root = Array.isArray(state.data.root) ? state.data.root : [];
    		const body = root.length === 0 ? h("p", { className: "buka-skills-status buka-skills-treeStatus" }, t("treeEmpty")) : h("ul", {
    			className: "buka-skills-tree",
    			"aria-busy": state.status === "loading" ? true : void 0
    		}, ...root.map((node) => renderTreeNode(repo, node)));
    		return h("div", { className: "buka-skills-treeArea" }, failure, warning, body);
    	}
    	/**
    	* 一个节点右侧的三个安装入口，目录与 skill 叶子共用。
    	*
    	* 目录行把「全局安装」换成「全部安装」（装目录下全部 skill），其余两个入口
    	* 在两种行上含义相同：选一个执行者 / 工作区作为目标。三个按钮在任一安装
    	* 进行中统一禁用；只有全局入口会在已安装时变成禁用的「全局已安装」，
    	* 执行者 / 工作区是每次临时选的目标，不做已安装判断。
    	*
    	* @param repo 一条收藏
    	* @param node 目录或 skill 节点
    	* @param installed 这个节点是否已全局安装（目录要求全部 skill 都已安装）
    	* @param busy 这个节点是否正在安装
    	* @param onInstall 点「全局安装 / 全部安装」时执行的动作
    	*/
    	function renderActions(repo, node, installed, busy, onInstall) {
    		const installLabel = node.type === "dir" ? t("installAll") : t("installGlobal");
    		return h("div", { className: "buka-skills-treeSkillAction" }, installed ? h(Button, {
    			variant: "outline",
    			size: "sm",
    			disabled: true,
    			icon: h(IconCheckOutlineRegular, { size: 13 }),
    			"aria-label": `${t("installedBadgeGlobal")} ${node.name}`
    		}, t("installedBadgeGlobal")) : busy ? h("span", {
    			className: "buka-skills-statusWithDot",
    			role: "status"
    		}, h(StateDot, { state: "ongoing" }), t("installing")) : h(Button, {
    			variant: "outline",
    			size: "sm",
    			icon: h(IconDownloadOutlineRegular, { size: 13 }),
    			"aria-label": `${installLabel} ${node.name}`,
    			disabled: installing !== null || targetInstalling,
    			onClick: onInstall
    		}, installLabel), h(Button, {
    			variant: "ghost",
    			size: "sm",
    			icon: h(IconUserOutlineRegular, { size: 13 }),
    			"aria-label": `${t("installWorker")} ${node.name}`,
    			disabled: installing !== null || targetInstalling,
    			onClick: () => openTargetDialog("worker", repo, node)
    		}, t("installWorker")), h(Button, {
    			variant: "ghost",
    			size: "sm",
    			icon: h(IconWorkspaceTreeOutlineRegular, { size: 13 }),
    			"aria-label": `${t("installWorkspace")} ${node.name}`,
    			disabled: installing !== null || targetInstalling,
    			onClick: () => openTargetDialog("workspace", repo, node)
    		}, t("installWorkspace")));
    	}
    	/**
    	* 递归渲染树节点：目录可折叠并带「全部安装」，skill 是叶子（名称 + 一行
    	* 描述 + 三个安装入口）。skill 叶子下如果还有嵌套 skill（目录自己带
    	* SKILL.md 又套了子 skill），子节点继续按树渲染在行下方。
    	*
    	* @param repo 一条收藏
    	* @param node Host 返回的树节点
    	*/
    	function renderTreeNode(repo, node) {
    		if (node.type === "dir") {
    			const collapsed = collapsedDirs[repo.id]?.[node.path] === true;
    			const children = Array.isArray(node.children) ? node.children : [];
    			return h("li", {
    				className: "buka-skills-treeItem",
    				key: node.path
    			}, h("div", { className: "buka-skills-treeDir" }, h("button", {
    				type: "button",
    				className: "buka-skills-treeToggle",
    				"aria-expanded": !collapsed,
    				onClick: () => toggleDir(repo, node.path)
    			}, h(IconChevronRightOutlineRegular, { size: 12 }), h("span", {
    				className: "buka-skills-treeDirIcon",
    				"aria-hidden": true
    			}, h(IconFolderOpenOutlineRegular, { size: 14 })), h("span", { className: "buka-skills-treeName" }, node.name), h("span", { className: "buka-skills-treeCount" }, `· ${countSkills(node)}`)), renderActions(repo, node, allSkillsInstalled(node, installedSkillKeys), installing === installKeyOf(repo, node), () => installDir(repo, node))), collapsed ? null : h("ul", { className: "buka-skills-treeGroup" }, ...children.map((child) => renderTreeNode(repo, child))));
    		}
    		const description = typeof node.description === "string" ? node.description : "";
    		const installed = installedSkillKeys.has(skillKeyOf(node.name));
    		const busy = installing === installKeyOf(repo, node);
    		const children = Array.isArray(node.children) ? node.children : [];
    		return h("li", {
    			className: "buka-skills-treeItem",
    			key: node.path
    		}, h("div", {
    			className: "buka-skills-treeSkill",
    			title: description === "" ? node.path : description
    		}, h("span", {
    			className: "buka-skills-treeSkillIcon",
    			"aria-hidden": true
    		}, h(IconSkillOutlineRegular, { size: 14 })), h("div", { className: "buka-skills-treeSkillMain" }, h("span", { className: "buka-skills-treeSkillName" }, node.name), description === "" ? null : h("span", { className: "buka-skills-treeSkillDesc" }, description)), renderActions(repo, node, installed, busy, () => installSkill(repo, node))), children.length === 0 ? null : h("ul", { className: "buka-skills-treeGroup" }, ...children.map((child) => renderTreeNode(repo, child))));
    	}
    	return {
    		renderTree,
    		renderTreeNode
    	};
    }
    // .build/skills/client/components/saved-panel.js
    /**
    * 「收藏」面板：收藏卡片、仓库类型徽标、已安装标记与展开后的树。
    *
    * 新增收藏不再是页面里的常驻输入行：标题行右侧「刷新」旁边的「收藏」按钮打开
    * 对话框（`save-dialog.ts`），这里只负责列表渲染与删除入口。展开后的树由
    * `components/tree.ts` 的渲染函数提供。
    *
    * @module @buka/dsh-plugin-skills/client/components/saved-panel
    */
    /**
    * 收藏卡片标题行的仓库类型徽标：npx skills / 不可用。
    *
    * kind 由 Host 给出：展开后拿到的完整结果与轻量探测都带它。两处都没有
    * （还没探测完、探测失败）时不显示徽标，也不渲染占位的「…」。
    *
    * @param kind Host 返回的仓库类型
    * @param t 翻译函数
    */
    function kindTagOf(kind, t) {
    	switch (kind) {
    		case "npx-skills": return {
    			text: t("kindNpx"),
    			tone: "neutral"
    		};
    		case "unavailable": return {
    			text: t("kindUnavailable"),
    			tone: "warning"
    		};
    		default: return null;
    	}
    }
    /**
    * 「技能仓库」页：卡片列表与「已安装」标记；新增走标题行右侧的「收藏」按钮。
    *
    * @param state 页面状态与动作
    */
    function renderSaved(state) {
    	const { t, repos, installedRepos, expandedRepos, trees, probes, removing, toggleRepo, removeRepo, saved, savedData, storeCorrupt } = state;
    	const { renderTree } = createTreeRenderer(state);
    	const rows = repos.map((repo) => {
    		const link = repoUrl(repo.source);
    		const listable = isListableSource(repo.source);
    		const installedAlready = installedRepos.has(repo.id);
    		const expanded = expandedRepos[repo.id] === true;
    		const kindTag = kindTagOf(trees[repo.id]?.data?.kind ?? probes[repo.id]?.data?.kind, t);
    		const warning = probes[repo.id]?.data?.warning ?? trees[repo.id]?.data?.warning;
    		return h("li", {
    			className: "buka-skills-card",
    			key: repo.id
    		}, h("div", { className: "buka-skills-cardHead" }, h("span", { className: "buka-skills-chevronSlot" }, listable ? h("button", {
    			type: "button",
    			className: "buka-skills-chevron",
    			"aria-expanded": expanded,
    			"aria-label": `${expanded ? t("collapseRepo") : t("expandRepo")} ${repo.source}`,
    			onClick: () => toggleRepo(repo)
    		}, h(IconChevronRightOutlineRegular, { size: 14 })) : null), h("span", {
    			className: "buka-skills-cardLead",
    			"aria-hidden": true
    		}, h(RepoAvatar, {
    			source: repo.source,
    			size: 24,
    			fallback: h(IconBranchOutlineRegular, { size: 16 })
    		})), h("div", { className: "buka-skills-cardMain" }, h("div", { className: "buka-skills-titleRow" }, h("div", { className: "buka-skills-titleCluster" }, link === "" ? h("span", { className: "buka-skills-cardTitle" }, repo.source) : h("a", {
    			className: "buka-skills-cardTitle buka-skills-cardLink",
    			href: link,
    			target: "_blank",
    			rel: "noreferrer noopener"
    		}, repo.source), kindTag === null ? null : h(Tag, { tone: kindTag.tone }, kindTag.text), installedAlready ? h(Tag, { tone: "success" }, t("installedBadge")) : null), h("div", { className: "buka-skills-titleActions" }, removing === repo.id ? h("span", { className: "buka-skills-statusWithDot" }, h(StateDot, { state: "ongoing" }), t("removing")) : h(Button, {
    			variant: "outline",
    			size: "sm",
    			className: "buka-skills-danger",
    			icon: h(IconTrashOutlineRegular, { size: 13 }),
    			"aria-label": `${t("removeRepo")} ${repo.source}`,
    			onClick: () => removeRepo(repo),
    			disabled: removing !== null
    		}, t("removeRepo")))), typeof repo.note === "string" && repo.note !== "" ? h("div", {
    			className: "buka-skills-cardDesc",
    			title: repo.note
    		}, repo.note) : null, typeof warning === "string" && warning !== "" ? h("p", {
    			className: "buka-skills-notice",
    			role: "status"
    		}, h(IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("treeRefreshWarning")} ${warning}`)) : null, expanded && listable ? renderTree(repo) : null)));
    	});
    	return h("div", { className: "buka-skills-panel" }, saved.error === null ? null : h("p", {
    		className: "buka-skills-failure",
    		role: "alert"
    	}, h(StateDot, { state: "error" }), `${t("loadFailed")} ${saved.error}`), saved.loading && savedData === null ? h("p", {
    		className: "buka-skills-statusWithDot",
    		role: "status"
    	}, h(StateDot, { state: "ongoing" }), t("loading")) : null, storeCorrupt ? h("p", {
    		className: "buka-skills-notice",
    		role: "status"
    	}, h(IconWarningOutlineRegular, { size: 16 }), h("span", null, t("storeUnreadable"), " ", h("span", { className: "buka-skills-path" }, String(savedData?.file ?? "")))) : null, savedData === null ? null : rows.length === 0 && !saved.loading ? h("div", { className: "buka-skills-emptyState" }, h("span", {
    		className: "buka-skills-emptyIcon",
    		"aria-hidden": true
    	}, h(IconBranchOutlineRegular, { size: 28 })), h("p", { className: "buka-skills-emptyTitle" }, t("repoEmpty")), h("p", { className: "buka-skills-emptyHint" }, t("repoEmptyHint"))) : h("ul", { className: "buka-skills-cards" }, ...rows));
    }
    // .build/skills/client/components/target-dialog.js
    /**
    * 「安装到执行者 / 工作区」对话框：读取目标列表、单选，确认后安装。
    *
    * 选中项可以是单个 skill，也可以是目录（装其下全部 skill）；标题下的说明行
    * 分别显示「目标 skill」或「目标目录 · 数量」。
    *
    * 目标列表来自 Host 的 `GET /buka-skills/targets`：执行者只列智能体且目录
    * 存在的条目，工作区列 DSH 注册过的目录。Host 在安装时会再用标识符 / 路径回去
    * 解析一次，所以这里展示的列表只用于选择。
    *
    * @module @buka/dsh-plugin-skills/client/components/target-dialog
    */
    /**
    * 一类目标不可用 / 为空时的说明文案。
    *
    * @param kind 目标类型
    * @param available 服务是否可用
    * @param t 翻译函数
    */
    function emptyText(kind, available, t) {
    	if (kind === "worker") return available ? t("targetEmptyWorkers") : t("targetWorkersUnavailable");
    	return available ? t("targetEmptyWorkspaces") : t("targetWorkspacesUnavailable");
    }
    /**
    * 目标列表主体：加载中 / 读取失败可重试 / 不可用 / 空 / 单选列表。
    *
    * @param props 页面状态与动作
    * @param kind 目标类型
    */
    function renderBody(props, kind) {
    	const { t, targets, choice, installing, setChoice, reloadTargets } = props;
    	const list = kind === "worker" ? targets.data?.workers : targets.data?.workspaces;
    	const items = targetItemsOf(kind, targets.data);
    	if (targets.loading && targets.data === null) return h("p", {
    		className: "buka-skills-statusWithDot",
    		role: "status"
    	}, h(StateDot, { state: "ongoing" }), t("targetLoading"));
    	if (targets.error !== null) return h("div", {
    		className: "buka-skills-targetFailure",
    		role: "alert"
    	}, h("p", { className: "buka-skills-failure" }, h(StateDot, { state: "error" }), `${t("targetLoadFailed")} ${targets.error}`), h(Button, {
    		variant: "ghost",
    		size: "sm",
    		disabled: installing,
    		onClick: reloadTargets
    	}, t("retry")));
    	if (list?.available === false || items.length === 0) return h("p", { className: "buka-skills-targetHint" }, emptyText(kind, list?.available !== false, t));
    	return h("ul", { className: "buka-skills-targetList" }, ...items.map((item) => {
    		const key = targetKeyOf(kind, item);
    		const label = targetLabelOf(kind, item);
    		const itemPath = targetPathOf(item);
    		const selected = key === choice;
    		const record = item;
    		const description = typeof record?.description === "string" ? record.description : "";
    		return h("li", { key }, h("button", {
    			type: "button",
    			className: `buka-skills-targetOption${selected ? " isSelected" : ""}`,
    			"aria-pressed": selected,
    			title: description !== "" ? description : itemPath,
    			disabled: installing,
    			onClick: () => setChoice(key)
    		}, h("span", { className: "buka-skills-targetName" }, label), itemPath === "" ? null : h("span", { className: "buka-skills-targetPath" }, itemPath)));
    	}));
    }
    /**
    * 「安装到执行者 / 工作区」对话框。
    *
    * @param props 页面状态与动作
    */
    function renderTargetDialog(props) {
    	const { t, dialog, targets, choice, error, installing, closeTargetDialog, installToTarget } = props;
    	const kind = dialog?.kind ?? "worker";
    	const items = targetItemsOf(kind, targets.data);
    	const canInstall = dialog !== null && choice !== "" && items.length > 0 && !installing;
    	return h(Modal, {
    		open: dialog !== null,
    		onClose: closeTargetDialog,
    		title: t(kind === "worker" ? "targetWorkerTitle" : "targetWorkspaceTitle"),
    		closeLabel: t("close"),
    		footer: h(react.Fragment, null, h(Button, {
    			variant: "outline",
    			onClick: closeTargetDialog,
    			disabled: installing
    		}, t("cancel")), h(Button, {
    			variant: "primary",
    			type: "button",
    			disabled: !canInstall,
    			icon: installing ? h(StateDot, {
    				state: "ongoing",
    				size: 13
    			}) : void 0,
    			onClick: () => {
    				installToTarget();
    			}
    		}, installing ? t("targetInstalling") : t("targetInstall")))
    	}, dialog === null ? null : h("div", { className: "buka-skills-targetBody" }, h("p", { className: "buka-skills-meta" }, dialog.node.type === "dir" ? `${t("targetForDir")} ${dialog.node.name} · ${countSkills(dialog.node)}` : `${t("targetFor")} ${dialog.node.name}`), renderBody(props, kind), error === null ? null : h("div", {
    		className: "buka-skills-targetFailure",
    		role: "alert"
    	}, h(IconWarningOutlineRegular, { size: 16 }), h("span", null, error))));
    }
    // .build/skills/client/components/skills-page.js
    /**
    * 侧边栏「Skills」页面：标题行、工具栏、两个 Tab 与页脚的 Toast / 对话框。
    *
    * 页面本身只做装配：状态与请求在 `state.ts`，两个面板分别在
    * `components/installed-panel.ts` 与 `components/saved-panel.ts`，
    * 收藏对话框在 `components/save-dialog.ts`，安装目标选择框在
    * `components/target-dialog.ts`。
    *
    * @module @buka/dsh-plugin-skills/client/components/skills-page
    */
    /**
    * 侧边栏「Skills」页面。
    *
    * @param props 插槽注入的文案函数
    */
    function SkillsPage(props) {
    	const t = props.t;
    	const state = useSkillsPageState(t);
    	const { tab, storeCorrupt, loading, notice, setNotice, dialogOpen, adding, source, setSource, note, setNote, addError, targetDialog, targets, targetChoice, targetInstalling, targetError, reload, openSaveDialog, closeSaveDialog, addRepo, switchTab, closeTargetDialog, setTargetChoice, reloadTargets, installToTarget } = state;
    	const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0];
    	return h("div", { className: "buka-skills-page" }, h("div", { className: "buka-skills-head" }, h("div", { className: "buka-skills-headInner" }, h("div", { className: "buka-skills-heading" }, h("h1", { className: "buka-skills-title" }, t("title")), h("p", { className: "buka-skills-subtitle" }, t("subtitle"))), h("div", { className: "buka-skills-toolbar" }, h(Tooltip, {
    		label: t("refresh"),
    		side: "bottom",
    		delayMs: 500,
    		disabled: loading,
    		children: h(Button, {
    			variant: "outline",
    			size: "sm",
    			className: "buka-skills-toolbarButton",
    			"aria-label": t("refresh"),
    			"aria-busy": loading,
    			disabled: loading,
    			icon: loading ? h(StateDot, {
    				state: "ongoing",
    				size: 13
    			}) : h(IconRefreshOutlineRegular, { size: 13 }),
    			onClick: reload
    		}, t("refresh"))
    	}), h(Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-skills-toolbarButton",
    		icon: h(IconPlusOutlineRegular, { size: 13 }),
    		"aria-label": t("add"),
    		disabled: storeCorrupt,
    		onClick: openSaveDialog
    	}, t("add"))), h("div", { className: "buka-skills-tabs" }, h(SegmentedTabs, {
    		size: "sm",
    		className: "buka-skills-tabList",
    		label: t("tabsLabel"),
    		value: tab,
    		onChange: (value) => switchTab(value),
    		items: [{
    			value: TABS[0].value,
    			label: t(TABS[0].labelKey),
    			id: TABS[0].id,
    			panelId: TABS[0].panelId
    		}, {
    			value: TABS[1].value,
    			label: t(TABS[1].labelKey),
    			id: TABS[1].id,
    			panelId: TABS[1].panelId
    		}]
    	})))), h("div", { className: "buka-skills-body" }, h("div", {
    		role: "tabpanel",
    		id: activeTab.panelId,
    		"aria-labelledby": activeTab.id
    	}, tab === "installed" ? renderInstalled(state) : renderSaved(state))), notice === null ? null : h(Toast, {
    		key: notice.seq,
    		text: notice.text,
    		...notice.kind === "success" ? { tone: "success" } : {},
    		...notice.kind === "success" ? {} : { icon: h(IconWarningOutlineRegular, {}) },
    		holdMs: 3200,
    		onDone: () => setNotice(null)
    	}), renderSaveDialog({
    		t,
    		dialogOpen,
    		closeSaveDialog,
    		adding,
    		source,
    		setSource,
    		note,
    		setNote,
    		addError,
    		addRepo
    	}), renderTargetDialog({
    		t,
    		dialog: targetDialog,
    		targets,
    		choice: targetChoice,
    		error: targetError,
    		installing: targetInstalling,
    		closeTargetDialog,
    		setChoice: setTargetChoice,
    		reloadTargets,
    		installToTarget
    	}));
    }
    // .build/skills/client/dictionary.js
    /**
    * 页面词典：英文与简体中文各一份，键完全相同。
    *
    * `apply()` 把两份词典注册到 `NS` 命名空间；页面里的 `t()` 由
    * `ctx.locale.bind(NS)` 提供。
    *
    * @module @buka/dsh-plugin-skills/client/dictionary
    */
    /** 词典命名空间。 */
    const NS = "buka-skills";
    /** 英文文案。 */
    const en = {
    	panel: "Skills",
    	title: "Skills",
    	subtitle: "Manage the global skills shared by every session, and save the sources you install from.",
    	tabsLabel: "Skill sections",
    	tabInstalled: "Global skills",
    	tabRepos: "Skill repositories",
    	refresh: "Refresh",
    	loading: "Loading…",
    	loadFailed: "Request failed:",
    	empty: "No global skills are installed.",
    	emptyHint: "Pick a source in the Skill repositories tab to install one, or run npx skills add in a terminal.",
    	badgeNpx: "npx skills",
    	badgeManual: "manual",
    	uninstall: "Uninstall",
    	uninstalling: "Uninstalling…",
    	confirmRemove: "Uninstall",
    	cancel: "Cancel",
    	close: "Close",
    	confirmNpx: "npx skills will remove this skill: the copy in ~/.agents/skills, the links in agent directories, and its lockfile entry.",
    	confirmLocal: "This skill was not installed by npx skills, so its directory is deleted directly.",
    	removedWithNpx: "Removed with npx skills:",
    	removedLocally: "Deleted directly:",
    	failed: "Uninstall failed:",
    	noLock: "npx skills lockfile not found, so every skill is treated as manually installed:",
    	corruptLock: "The npx skills lockfile exists but cannot be used, so skills under ~/.agents are shown as manual and cannot be uninstalled here until it is fixed:",
    	warningsLabel: "Some skill directories could not be read:",
    	repoEmpty: "No saved skill repositories yet.",
    	repoEmptyHint: "Save a repository from the button in the top-right corner to browse and install its skills.",
    	dialogTitle: "Save repository",
    	fieldSource: "Repository",
    	fieldNote: "Note",
    	addPlaceholder: "owner/repo, a GitHub/GitLab link, a git URL, or an absolute path",
    	notePlaceholder: "Optional",
    	add: "Save",
    	adding: "Saving…",
    	added: "Saved:",
    	removeRepo: "Delete",
    	removing: "Deleting…",
    	removed: "Deleted:",
    	duplicate: "Already saved:",
    	invalidSource: "Invalid source: use owner/repo, a GitHub/GitLab or other git URL, a local absolute path, an http(s) link, or a package name. Package names can be saved but not expanded.",
    	invalidNote: "The note is limited to 200 characters.",
    	storeUnreadable: "The saved-repos file cannot be parsed; fix or delete it first:",
    	addFailed: "Could not save:",
    	removeFailed: "Could not remove:",
    	installedBadge: "installed",
    	installedBadgeGlobal: "Installed globally",
    	installGlobal: "Install globally",
    	installAll: "Install all",
    	installWorker: "Install to worker",
    	installWorkspace: "Install to workspace",
    	installing: "Installing…",
    	installedToast: "Installed:",
    	installedDirToast: "Installed skills in this directory:",
    	skippedInstalledToast: "skipped already installed:",
    	dirAllInstalled: "Every skill in this directory is already installed.",
    	installFailed: "Install failed:",
    	installMissing: "This skill is no longer in the repository list. Refresh the repository and try again.",
    	targetWorkerTitle: "Install to worker",
    	targetWorkspaceTitle: "Install to workspace",
    	targetFor: "Skill:",
    	targetForDir: "Directory:",
    	targetLoading: "Loading targets…",
    	targetLoadFailed: "Could not load install targets:",
    	targetEmptyWorkers: "No agents are available. Install the workers plugin or create one first.",
    	targetEmptyWorkspaces: "No workspaces are registered yet.",
    	targetWorkersUnavailable: "The workers plugin (@buka/dsh-plugin-workers) is not installed, so skills cannot be installed into a worker.",
    	targetWorkspacesUnavailable: "This composition has no workspace registry, so skills cannot be installed into a workspace.",
    	targetInstall: "Install",
    	targetInstalling: "Installing…",
    	installedToWorker: "Installed to worker:",
    	installedToWorkspace: "Installed to workspace:",
    	installedDirToWorker: "Installed all skills in this directory to worker:",
    	installedDirToWorkspace: "Installed all skills in this directory to workspace:",
    	expandRepo: "Show skills",
    	collapseRepo: "Hide skills",
    	treeLoading: "Loading skills…",
    	treeEmpty: "No installable skills found in this repository.",
    	treeFailed: "Could not load skills:",
    	treeNotFound: "Repository not found or not accessible.",
    	treeRateLimited: "GitHub API rate limit reached. Try again later.",
    	treeUnsupported: "Package names and web links cannot list skills.",
    	treeUnavailable: "No installable skills found: expected SKILL.md files under the repository root \"skills/\".",
    	treeGitUnavailable: "Git is not installed or not on PATH, so git repositories cannot be read.",
    	treeRefreshWarning: "Could not refresh the local clone; showing the cached copy:",
    	kindNpx: "npx skills",
    	kindUnavailable: "unavailable",
    	checkingUpdates: "Checking…",
    	updateSkills: "Update",
    	updatingSkills: "Updating…",
    	statusUpdate: "update available",
    	statusModified: "local changes",
    	statusUpToDate: "up to date",
    	statusUnsupported: "source unavailable",
    	statusFailed: "check failed",
    	checkFailed: "Could not check for updates:",
    	updateFailed: "Update failed:",
    	retry: "Retry"
    };
    /** 简体中文文案。 */
    const zh = {
    	panel: "Skills",
    	title: "Skills",
    	subtitle: "管理对所有会话生效的全局 skills，并收藏常用的来源。",
    	tabsLabel: "Skills 页面分区",
    	tabInstalled: "全局技能",
    	tabRepos: "技能仓库",
    	refresh: "刷新",
    	loading: "正在读取…",
    	loadFailed: "请求失败：",
    	empty: "还没有安装任何全局 skill。",
    	emptyHint: "在「技能仓库」里挑一个来源安装，或在终端运行 npx skills add。",
    	badgeNpx: "npx skills",
    	badgeManual: "manual",
    	uninstall: "卸载",
    	uninstalling: "正在卸载…",
    	confirmRemove: "确认卸载",
    	cancel: "取消",
    	close: "关闭",
    	confirmNpx: "这是 npx skills 安装的 skill：会删除 ~/.agents/skills 里的副本、各 agent 目录里的链接，以及 lockfile 记录。",
    	confirmLocal: "这个 skill 不是 npx skills 安装的，将直接删除它的目录。",
    	removedWithNpx: "已通过 npx skills 卸载：",
    	removedLocally: "已直接删除：",
    	failed: "卸载失败：",
    	noLock: "没有找到 npx skills 的 lockfile，所有 skill 都会按手工安装处理：",
    	corruptLock: "npx skills 的 lockfile 存在却无法使用：~/.agents 下的 skill 暂按手工安装展示，修好它之前不能在这里卸载：",
    	warningsLabel: "部分 skills 目录无法读取：",
    	repoEmpty: "还没有收藏任何仓库。",
    	repoEmptyHint: "点右上角的「收藏」添加来源，之后就能在这里浏览并安装它的 skills。",
    	dialogTitle: "收藏",
    	fieldSource: "仓库",
    	fieldNote: "备注",
    	addPlaceholder: "owner/repo、GitHub/GitLab 链接、git 地址或绝对路径",
    	notePlaceholder: "可选",
    	add: "收藏",
    	adding: "收藏中…",
    	added: "已收藏：",
    	removeRepo: "删除",
    	removing: "删除中…",
    	removed: "已删除：",
    	duplicate: "已经收藏过：",
    	invalidSource: "来源格式不对：支持 owner/repo、GitHub/GitLab 等 git 地址、本地绝对路径、http(s) 链接或包名；包名可以收藏但不能展开。",
    	invalidNote: "备注最长 200 个字符。",
    	storeUnreadable: "收藏文件无法解析，请先修复或删除它：",
    	addFailed: "收藏失败：",
    	removeFailed: "删除失败：",
    	installedBadge: "已安装",
    	installedBadgeGlobal: "全局已安装",
    	installGlobal: "全局安装",
    	installAll: "全部安装",
    	installWorker: "安装到执行者",
    	installWorkspace: "安装到工作区",
    	installing: "安装中…",
    	installedToast: "已安装：",
    	installedDirToast: "已安装该目录下的 skill：",
    	skippedInstalledToast: "跳过已安装：",
    	dirAllInstalled: "这个目录下的 skill 都已安装。",
    	installFailed: "安装失败：",
    	installMissing: "仓库列表里已经找不到这个 skill，刷新仓库后再试。",
    	targetWorkerTitle: "安装到执行者",
    	targetWorkspaceTitle: "安装到工作区",
    	targetFor: "目标 skill：",
    	targetForDir: "目标目录：",
    	targetLoading: "正在读取目标…",
    	targetLoadFailed: "读取目标失败：",
    	targetEmptyWorkers: "没有可用的智能体；装好执行者插件并创建执行者后再试。",
    	targetEmptyWorkspaces: "还没有注册任何工作区。",
    	targetWorkersUnavailable: "没有找到执行者插件（@buka/dsh-plugin-workers），无法安装到执行者。",
    	targetWorkspacesUnavailable: "当前运行环境没有工作区注册表，无法安装到工作区。",
    	targetInstall: "安装",
    	targetInstalling: "安装中…",
    	installedToWorker: "已安装到执行者：",
    	installedToWorkspace: "已安装到工作区：",
    	installedDirToWorker: "已将该目录下的 skill 安装到执行者：",
    	installedDirToWorkspace: "已将该目录下的 skill 安装到工作区：",
    	expandRepo: "展开 skills",
    	collapseRepo: "收起 skills",
    	treeLoading: "正在获取 skills…",
    	treeEmpty: "这个仓库里没有找到可安装的 skill。",
    	treeFailed: "获取 skills 失败：",
    	treeNotFound: "仓库不存在或无权访问。",
    	treeRateLimited: "GitHub 接口限流，稍后再试。",
    	treeUnsupported: "包名和网页链接不能列出 skills。",
    	treeUnavailable: "没有找到可安装的 skill：需要仓库根 skills/ 下的 SKILL.md。",
    	treeGitUnavailable: "没有找到 git（不在 PATH 上），无法读取 git 仓库。",
    	treeRefreshWarning: "刷新本地克隆失败，当前显示的是缓存副本：",
    	kindNpx: "npx skills",
    	kindUnavailable: "不可用",
    	checkingUpdates: "检查中…",
    	updateSkills: "更新",
    	updatingSkills: "更新中…",
    	statusUpdate: "有更新",
    	statusModified: "本地已修改",
    	statusUpToDate: "已是最新",
    	statusUnsupported: "来源不可用",
    	statusFailed: "检查失败",
    	checkFailed: "检查更新失败：",
    	updateFailed: "更新失败：",
    	retry: "重试"
    };
    // .build/skills/client/styles.js
    /**
    * 页面的 CSS 常量。
    *
    * 视觉基准是 Plugins 页面（`dsh-client-ui-plugin-manager`）：标题行 + 工具栏
    * + Tab 行、960px 内容区、卡片列表、40px 图标块、行内标签。颜色与尺寸只用
    * 主题 token 和 DSH 的圆角/焦点 token，不写死色值。
    *
    * `.buka-skills-page` 自己就是滚动容器。DSH 的滚动条是**占位**的经典滚动条：
    * 「全局技能」比视口高、出现滚动条，「技能仓库」没有；滚动条一出现/一消失，
    * 内容盒就窄/宽一个滚动条宽度，居中的标题、Tab 行和列表整体左右平移
    * 半个滚动条宽度——切 Tab 时看起来就是整页左右抖一下。`scrollbar-gutter:
    * stable` 常驻预留滚动条槽位，两个 Tab 内容盒等宽，版面不再跟着滚动条跳。
    *
    * 卡片把「图标块 + 主区（标题行 / 描述 / 展开的树）+ 行内操作」拆开：
    * 标题行固定 40px 高，与图标块等高，所以展开树时图标不会跟着内容上下跳。
    *
    * @module @buka/dsh-plugin-skills/client/styles
    */
    /** 页面样式。 */
    const CSS = `
    .buka-skills-page{--buka-skills-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-skills-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden auto;scrollbar-gutter:stable;overscroll-behavior:contain}
    @media (width<=767px){.buka-skills-page{--buka-skills-inset:20px}}
    .buka-skills-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-skills-inset));max-width:none;margin-inline:calc(-1 * var(--buka-skills-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-skills-inset) 8px;background:var(--dsw-alias-bg-base);border-bottom:0.5px solid var(--dsw-alias-border-l1);z-index:1;position:sticky;top:0}
    .buka-skills-headInner{width:100%;max-width:960px;margin-inline:auto;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px}
    .buka-skills-heading{order:1;min-width:0;max-width:100%}
    .buka-skills-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
    .buka-skills-subtitle{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-wrap:pretty}
    .buka-skills-toolbar{order:2;display:flex;align-items:center;gap:8px}
    .buka-skills-tabs{flex:100%;order:3;display:flex}
    .buka-skills-tabList{width:fit-content;min-width:240px}
    @media (width<=372px){.buka-skills-tabList{min-width:0}}
    .buka-skills-body{box-sizing:border-box;width:100%;max-width:960px;flex:none;display:flex;flex-direction:column;padding:24px 0 48px}
    .buka-skills-panel{display:flex;flex-direction:column;gap:16px}
    .buka-skills-panelActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .buka-skills-panelActions>.buka-skills-meta{flex:1 1 auto}
    .buka-skills-panelActions>.buka-skills-statusWithDot{flex:1 1 auto}
    .buka-skills-status{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
    .buka-skills-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
    .buka-skills-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;margin:0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
    .buka-skills-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}
    .buka-skills-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
    .buka-skills-path{font-family:var(--ds-font-family-code);font-size:11px;overflow-wrap:anywhere}
    .buka-skills-emptyState{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:48px 24px;text-align:center}
    .buka-skills-emptyIcon{color:var(--dsw-alias-label-caption);display:inline-flex}
    .buka-skills-emptyTitle{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:500;line-height:20px}
    .buka-skills-emptyHint{margin:0;max-width:44ch;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-wrap:balance}
    .buka-skills-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
    .buka-skills-card{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px}
    .buka-skills-cardHead{gap:8px;padding:8px;display:flex;align-items:flex-start}
    /* 图标列：固定 40px，头像/回退图标在列内水平、垂直居中；标题行与它等高。 */
    .buka-skills-cardLead{flex:none;justify-content:center;align-items:center;width:40px;min-height:40px;display:inline-flex}
    .buka-skills-cardMain{flex:1 1 auto;min-width:0;flex-direction:column;gap:4px;display:flex}
    .buka-skills-titleRow{justify-content:space-between;align-items:center;gap:8px;min-width:0;min-height:40px;display:flex}
    .buka-skills-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
    .buka-skills-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex}
    .buka-skills-avatar{flex:none;border-radius:50%;object-fit:cover;display:inline-block}
    .buka-skills-cardTitle{min-width:0;max-width:min(100%,32em);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
    .buka-skills-cardLink{color:inherit;text-decoration:none;cursor:pointer}
    @media (hover:hover){.buka-skills-cardLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}}
    .buka-skills-cardLink:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .buka-skills-chevronSlot{flex:none;justify-content:center;align-items:center;width:20px;min-height:40px;display:inline-flex}
    .buka-skills-chevron{border-radius:var(--dsw-radius-sm);width:20px;height:20px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}
    .buka-skills-chevron>svg{transition:transform .12s ease}
    .buka-skills-chevron[aria-expanded=true]>svg{transform:rotate(90deg)}
    @media (hover:hover){.buka-skills-chevron:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-skills-chevron:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-skills-tree{margin:2px 0 0 2px;padding:0 0 0 18px;border-left:0.5px solid var(--dsw-alias-border-l1);list-style:none;display:flex;flex-direction:column;gap:1px}
    .buka-skills-treeItem{min-width:0;flex-direction:column;gap:1px;display:flex}
    .buka-skills-treeToggle{box-sizing:border-box;flex:1 1 auto;min-width:0;gap:6px;padding:2px 6px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;font-size:13px;line-height:20px;display:flex;align-items:center}
    .buka-skills-treeToggle>svg{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s ease}
    .buka-skills-treeToggle[aria-expanded=true]>svg{transform:rotate(90deg)}
    @media (hover:hover){.buka-skills-treeToggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
    .buka-skills-treeToggle:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
    .buka-skills-treeName{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
    .buka-skills-treeCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px}
    .buka-skills-treeGroup{margin:0;padding:0 0 0 16px;border-left:0.5px solid var(--dsw-alias-border-l1);list-style:none;flex-direction:column;gap:1px;display:flex}
    .buka-skills-treeDir{min-width:0;border-radius:var(--dsw-radius-sm);flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;padding:2px 6px;display:flex}
    @media (hover:hover){.buka-skills-treeDir:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-skills-treeSkill{min-width:0;border-radius:var(--dsw-radius-sm);flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;padding:2px 6px;display:flex}
    @media (hover:hover){.buka-skills-treeSkill:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-skills-treeSkillIcon,.buka-skills-treeDirIcon{flex:none;color:var(--dsw-alias-label-caption);display:inline-flex;align-items:center}
    .buka-skills-treeSkillMain{min-width:0;flex:1 1 160px;flex-direction:column;display:flex}
    .buka-skills-treeSkillName{min-width:0;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;line-height:20px}
    .buka-skills-treeSkillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:1;-webkit-box-orient:vertical;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere}
    .buka-skills-treeSkillAction{flex:0 1 auto;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:4px;display:flex}
    .buka-skills-treeArea{flex-direction:column;gap:2px;display:flex}
    .buka-skills-treeStatus{padding:2px 6px 2px 28px}
    .buka-skills-treeFailure{gap:8px;padding:2px 6px 2px 28px;display:flex;flex-wrap:wrap;align-items:center}
    .buka-skills-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
    .buka-skills-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-skills-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:12px;line-height:18px}
    .buka-skills-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
    .buka-skills-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
    .buka-skills-saveForm{display:flex;flex-direction:column;gap:16px}
    .buka-skills-field{display:flex;flex-direction:column;gap:6px}
    .buka-skills-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
    .buka-skills-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
    .buka-skills-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
    .buka-skills-targetBody{flex-direction:column;gap:12px;display:flex}
    .buka-skills-targetList{flex-direction:column;gap:4px;max-height:300px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}
    .buka-skills-targetOption{box-sizing:border-box;width:100%;border:1px solid transparent;border-radius:var(--dsw-radius-md);background:0 0;color:inherit;text-align:left;cursor:pointer;font:inherit;flex-direction:column;gap:2px;padding:8px 10px;display:flex}
    @media (hover:hover){.buka-skills-targetOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-skills-targetOption:focus-visible{border-radius:var(--dsw-radius-md);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-skills-targetOption:disabled{cursor:default;opacity:.6}
    .buka-skills-targetOption.isSelected{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}
    .buka-skills-targetName{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
    .buka-skills-targetPath{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .buka-skills-targetHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
    .buka-skills-targetFailure{color:var(--dsw-alias-state-error-primary);align-items:flex-start;gap:8px;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
    .buka-skills-targetFailure>svg{flex:none;margin-top:2px}
    `;
    // .build/skills/client/index.js
    /**
    * `@buka/dsh-plugin-skills` 的浏览器一半：侧边栏的「Skills」页面。
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
    * - 「技能仓库」（默认选中）：用户自己记下的 skill 来源（`owner/repo`、
    *   GitHub/GitLab 等 git 地址、本地绝对路径或包名），用于以后安装时随手
    *   取用；点标题打开仓库，卡片右侧的「删除」按钮与已安装列表的卸载按钮
    *   同款（outline + 危险色）。
    *   来源只认仓库根 `skills/` 下（任意层级）的 SKILL.md：打开技能仓库后会对
    *   每个可列出 skills 的仓库静默探测类型（`probe=1`，只读仓库树，不阻塞
    *   列表），标题行标出「npx skills」或「不可用」。展开后的每个 skill 右侧有
    *   三个入口：「全局安装」「安装到执行者」「安装到工作区」。后两个打开对话框，
    *   分别列出 `ctx.bukaWorkers` 的智能体与 `ctx.workspaceRegistry` 的已注册
    *   工作区；只有全局安装会在已装过时变成禁用的「全局已安装」按钮（带对勾
    *   图标）。目录行也有这三个入口，全局入口叫「全部安装」：一次把目录下每个
    *   skill 交给 Host 逐个安装，已装过的跳过。
    * - 「全局技能」：两个全局 skills 根目录下现有的 skill，标注哪些由 skills 库
    *   管理，并提供按来源选择的卸载入口。列表落地后自动检查更新，结果按
    *   `update` / `modified` / `up-to-date` / `unsupported-source` / `failed`
    *   在行内标出；有更新时页面提供「更新」按钮。
    *
    * 新增收藏不再是页面里的常驻输入行：标题行右侧「刷新」旁边的「收藏」按钮
    * 打开一个对话框，填「仓库」与「备注」后提交；两个按钮尺寸一致。
    *
    * 视觉与交互直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`
    * （模块表里的静态项，不需要声明 external）：`Button` / `Input` /
    * `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标；页面
    * 布局、卡片与状态文字沿用 Plugins 页面（`dsh-client-ui-plugin-manager`）的
    * 结构：标题行 + 工具栏 + Tab 行，内容区 960px 宽、卡片列表、48px 图标块。
    * 这样两个页面共享同一套尺寸、圆角、颜色 token 与控件手感。
    *
    * 页面只做展示与触发：列表、卸载、安装、收藏的读写都走 Host 一半注册的包内
    * 路由（`/buka-skills/*`），不在浏览器里判断 npx 的安装方式，也不碰文件系统 ——
    * 这样「怎么卸载」「怎么安装」「收藏存在哪」都只有一份实现。收藏页的展开状态与
    * 上次拿到的树属于纯页面状态，缓存在 localStorage（`dsh.buka-skills.view.v1`）：
    * 关闭 DSH 再打开时先按上次的样子渲染，再找 Host 校正，不用干等网络。
    *
    * 本文件只做装配：页面在 `components/skills-page.ts`，状态与请求在 `state.ts`，
    * 词典在 `dictionary.ts`，样式在 `styles.ts`，基座组件在 `primitives.ts`。
    * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
    * 那层外壳由构建脚本 `scripts/build-clients.ts` 生成，源码里不写死包名。
    *
    * @module @buka/dsh-plugin-skills/client
    */
    /** 浏览器一半依赖的两个客户端服务。 */
    const inject = ["slots", "locale"];
    /**
    * 注册侧边栏条目与主面板页面。
    *
    * @param ctx 浏览器插件上下文
    */
    function apply(ctx) {
    	const t = ctx.locale.bind(NS);
    	ctx.effect(() => ctx.locale.register(NS, {
    		zh,
    		en
    	}), "buka-skills: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-skills";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-skills: styles");
    	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    		name: "sidebar.panellist",
    		id: PANEL_ID,
    		order: 20,
    		label: () => t("panel"),
    		locale: NS
    	}, SkillsPanelIcon));
    	ctx.slots.inject("main", () => ctx.slots.register({
    		name: "main",
    		key: PANEL_ID,
    		locale: NS
    	}, SkillsPage));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
