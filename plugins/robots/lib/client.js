window.__ModuleLoader__.load({
  id: "@buka/dsh-plugin-robots",
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
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    // packages/plugin-ui/lib/avatars.js
    /**
    * 预设头像：id → emoji / 底色 / 词典 key。
    *
    * 机器人页与工作流节点图原本各维护一份同样的显示表；插件之间不互相 import，
    * 所以统一收在这里，两个浏览器一半都从这里派生。id 与 Host 的
    * `plugins/robots/src/avatar.ts` 一一对应（那边只存 id，不存 emoji / 底色），
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
    /** id → 预设。 */
    const AVATAR_BY_ID = new Map(AVATARS.map((preset) => [preset.id, preset]));
    /** 列表 / 默认值用第一个预设。 */
    const DEFAULT_AVATAR_ID = AVATARS[0].id;
    /**
    * 头像 id → 预设；不认识的 id 返回 `undefined`。
    *
    * 两个浏览器一半的兜底不同：机器人页退回第一个预设，节点图当作没有头像，
    * 所以这里只做查表，兜底留在各自的 `avatarPreset` 里。
    *
    * @param id 头像 id
    */
    function findAvatarPreset(id) {
    	return typeof id === "string" ? AVATAR_BY_ID.get(id) : void 0;
    }
    // packages/plugin-ui/lib/h.js
    /**
    * 创建 React 元素的小包装。
    *
    * 页面直接手写 `createElement`（不用 JSX）。短名保持 `React.createElement` 的
    * 全部重载（这样内联回调仍能拿到事件类型），另外补一个宽松签名：机器人 / 技能
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
    async function requestJson$1(url, init = {}) {
    	const headers = { accept: "application/json" };
    	if (init.body !== void 0) headers["content-type"] = "application/json";
    	const extraHeaders = init.headers ?? {};
    	const response = await fetch(url, {
    		...init,
    		headers: {
    			...headers,
    			...extraHeaders
    		}
    	});
    	const body = await response.json().catch(() => null);
    	if (!response.ok || body === null || body.ok !== true) {
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
    // .build/robots/client/avatar.js
    /**
    * 预设头像与头像渲染。
    *
    * 预设表（id / emoji / 底色 / 词典 key）统一在界面侧公共包里，机器人页与
    * 工作流节点图都从那里派生；这里只保留机器人页自己的兜底与渲染。头像 id 与
    * Host 的 `avatar.ts` 一一对应（插件之间不互相 import，所以契约是
    * 「同一个 id」）。
    *
    * @module @buka/dsh-plugin-robots/client/avatar
    */
    /**
    * 头像 id → 预设；不认识的 id 退回第一个预设（Host 的旧记录已兜底，这里只是
    * 防御脏数据，保证页面上永远有一个头像）。
    *
    */
    function avatarPreset(id) {
    	return findAvatarPreset(id) ?? AVATARS[0];
    }
    /**
    * 机器人头像：emoji 画在预设色的浅底圆片里。[size] 是直径（px）。
    *
    */
    function renderAvatar(id, size, className = "") {
    	const preset = avatarPreset(id);
    	return h("span", {
    		className: `buka-robots-avatar${className === "" ? "" : ` ${className}`}`,
    		style: {
    			width: `${size}px`,
    			height: `${size}px`,
    			fontSize: `${Math.max(9, Math.round(size * .6))}px`,
    			backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
    			borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`
    		},
    		"aria-hidden": true
    	}, preset.emoji);
    }
    /**
    * 侧边栏的图标：一个机器人头（圆角矩形 + 两眼 + 天线）。侧边栏只给尺寸与
    * 选中态；颜色通过 `currentColor` 继承面板行的前景色，不自己写死颜色。
    *
    */
    function RobotsPanelIcon({ size }) {
    	return h("svg", {
    		width: size,
    		height: size,
    		viewBox: "0 0 16 16",
    		fill: "none",
    		"aria-hidden": true
    	}, h("rect", {
    		x: 2.7,
    		y: 5.2,
    		width: 10.6,
    		height: 8.2,
    		rx: 2.6,
    		stroke: "currentColor",
    		strokeWidth: 1.2
    	}), h("circle", {
    		cx: 5.9,
    		cy: 9,
    		r: .95,
    		fill: "currentColor"
    	}), h("circle", {
    		cx: 10.1,
    		cy: 9,
    		r: .95,
    		fill: "currentColor"
    	}), h("path", {
    		d: "M8 5.2V3.1",
    		stroke: "currentColor",
    		strokeWidth: 1.2,
    		strokeLinecap: "round"
    	}), h("circle", {
    		cx: 8,
    		cy: 2.4,
    		r: .9,
    		fill: "currentColor"
    	}));
    }
    // .build/robots/client/api.js
    /**
    * 「机器人」页面与 Host 通信的请求 / 错误处理。
    *
    * 所有 `/buka-robots/*` 路由都返回 `{ ok, ... }`；非 2xx 或 `ok !== true` 时
    * 抛出带 `code` 的错误，页面再按错误码翻成可读文案。
    *
    * @module @buka/dsh-plugin-robots/client/api
    */
    /** 读带错误码的错误的 `code`；不是对象或没有字符串 `code` 时返回 undefined。 */
    function errorCode(failure) {
    	if (failure === null || typeof failure !== "object" || !("code" in failure)) return void 0;
    	const code = failure.code;
    	return typeof code === "string" ? code : void 0;
    }
    /** 读失败响应里的命令输出；没有时返回空串。 */
    function outputOf(failure) {
    	if (failure === null || typeof failure !== "object" || !("output" in failure)) return "";
    	const output = failure.output;
    	return typeof output === "string" ? output : "";
    }
    /**
    * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
    * 实现统一在界面侧公共包里，这里只补上本插件的默认响应类型。
    *
    */
    function requestJson(url, init = {}) {
    	return requestJson$1(url, init);
    }
    /**
    * Host 返回的错误码 → 可读文案；未知错误原样展示 message。
    *
    */
    function failureText(t, failure) {
    	switch (errorCode(failure)) {
    		case "invalid-name": return t("errInvalidName");
    		case "invalid-avatar": return t("errInvalidAvatar");
    		case "not-directory": return t("errNotDirectory");
    		case "unknown-robot": return t("errUnknownRobot");
    		case "name-taken": return t("errNameTaken");
    		case "invalid-update": return t("errInvalidUpdate");
    		case "path-outside-root": return t("errPathOutsideRoot");
    		case "missing-directory": return t("errMissingDirectory");
    		case "registry-unreadable": return t("errRegistryUnreadable");
    		case "program-robot": return t("errProgramRobot");
    		case "builtin-robot": return t("errBuiltinRobot");
    		case "invalid-assistant": return t("errInvalidAssistant");
    		case "invalid-driver": return t("errInvalidDriver");
    		case "too-large": return t("errTooLarge");
    		case "invalid-content": return t("errInvalidContent");
    		case "invalid-source": return t("errInvalidSource");
    		case "invalid-skill": return t("errInvalidSkill");
    		case "invalid-skills": return t("errInvalidSkills");
    		case "list-unparsed": return t("errListUnparsed");
    		case "npx-failed": return t("errNpxFailed");
    		default: return messageOf(failure);
    	}
    }
    /**
    * `{n} skills` 这类带数量的标签；占位符写在词典里，中英文各自组织语序。
    *
    */
    function countBadge(count, t) {
    	return String(t("skillsBadge")).replace("{n}", String(count));
    }
    /** 是否 program 型机器人（只读、没有目录与会话）。 */
    function isProgramRobot(robot) {
    	return robot?.driver === "program";
    }
    /**
    * 机器人的 skills 列表；Host 字段缺失时回退空数组，避免渲染期抛错。
    *
    */
    function skillsOf(robot) {
    	return Array.isArray(robot?.skills) ? robot.skills : [];
    }
    /**
    * 机器人的 AGENTS.md 摘要；缺失时给一个「不存在」的空结构。
    *
    */
    function agentsOf(robot) {
    	const agents = robot?.agents;
    	if (agents === null || typeof agents !== "object") return {
    		exists: false,
    		bytes: 0,
    		modifiedAt: null,
    		content: "",
    		tooLarge: false
    	};
    	return {
    		exists: agents.exists === true,
    		bytes: typeof agents.bytes === "number" ? agents.bytes : 0,
    		modifiedAt: typeof agents.modifiedAt === "string" ? agents.modifiedAt : null,
    		content: typeof agents.content === "string" ? agents.content : "",
    		tooLarge: agents.tooLarge === true
    	};
    }
    /**
    * 机器人的 CLAUDE.md 链接摘要；缺失时按「没有链接」处理。
    *
    */
    function claudeOf(robot) {
    	const claude = robot?.claude;
    	if (claude === null || typeof claude !== "object") return {
    		exists: false,
    		symlink: false,
    		mode: "missing",
    		target: ""
    	};
    	return {
    		exists: claude.exists === true,
    		symlink: claude.symlink === true,
    		mode: typeof claude.mode === "string" ? claude.mode : "missing",
    		target: typeof claude.target === "string" ? claude.target : ""
    	};
    }
    // .build/robots/client/constants.js
    /**
    * 「机器人」页面的常量：词典命名空间、插槽 id、路由、页签与表单 id。
    *
    * @module @buka/dsh-plugin-robots/client/constants
    */
    /** 词典命名空间。 */
    const NS = "buka-robots";
    /** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
    const PANEL_ID = "buka-robots";
    /** 「创建机器人」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
    const CREATE_FORM_ID = "buka-robots-create-form";
    /**
    * 「重命名机器人」对话框里表单的 id：页脚「保存」按钮通过 `form` 提交它，
    * 这样回车与点保存走同一套校验。
    */
    const RENAME_FORM_ID = "buka-robots-rename-form";
    /** 与 Host 一半（`plugins/robots/lib/index.js`）的路由常量保持一致。 */
    const LIST_ROUTE = "/buka-robots/list";
    const CREATE_ROUTE = "/buka-robots/create";
    const RENAME_ROUTE = "/buka-robots/rename";
    const AVATAR_ROUTE = "/buka-robots/avatar";
    const DESCRIPTION_ROUTE = "/buka-robots/description";
    const ASSISTANT_ROUTE = "/buka-robots/assistant";
    const REMOVE_ROUTE = "/buka-robots/remove";
    const AGENTS_ROUTE = "/buka-robots/agents";
    const REVEAL_ROUTE = "/buka-robots/reveal";
    const AVAILABLE_ROUTE = "/buka-robots/skills/available";
    const INSTALL_ROUTE = "/buka-robots/skills/install";
    const SKILL_REMOVE_ROUTE = "/buka-robots/skills/remove";
    /**
    * Skills 插件（`@buka/dsh-plugin-skills`）的收藏仓库路由。
    *
    * 两个插件不互相 import，只通过同一个 webServer 的包内路由通信：这里只读
    * 收藏清单（GET），Skills 插件没安装时请求 404，页面就把「收藏夹」整块隐藏。
    * 这是跨插件契约，改动时要和 `plugins/skills/lib/index.js` 同步。
    */
    const SKILLS_REPOS_ROUTE = "/buka-skills/repos";
    /** 详情页的三个页签；id / panelId 与 `SegmentedTabs` 的 ARIA 契约一致。 */
    const TABS = [
    	{
    		value: "description",
    		id: "buka-robots-tab-description",
    		panelId: "buka-robots-panel-description"
    	},
    	{
    		value: "agents",
    		id: "buka-robots-tab-agents",
    		panelId: "buka-robots-panel-agents"
    	},
    	{
    		value: "skills",
    		id: "buka-robots-tab-skills",
    		panelId: "buka-robots-panel-skills"
    	}
    ];
    /** 安装对话框里来源表单的 id：回车触发表单提交，读出候选 skills。 */
    const INSTALL_FORM_ID = "buka-robots-install-form";
    /** 「更换头像」对话框里表单的 id：页脚「保存」按钮通过 `form` 属性提交它。 */
    const AVATAR_FORM_ID = "buka-robots-avatar-form";
    // .build/robots/client/actions/detail.js
    /**
    * 「机器人」详情页的动作：更换头像、重命名、保存职责描述。
    *
    * @module @buka/dsh-plugin-robots/client/actions/detail
    */
    /**
    * 构造详情页动作。
    *
    */
    function createDetailActions(state, t) {
    	const { mutating, avatarTarget, setAvatarTarget, draftAvatar, setDraftAvatar, avatarSaving, setAvatarSaving, setAvatarError, setAvatarOpen, selectedRobot, setRenameDraft, setRenameError, setRenameOpen, renameSaving, renameDraft, setRenameSaving, agentsDraft, setAgentsDraft, selectedName, setSelectedName, descriptionDraft, setDescriptionDraft, descriptionSaving, setDescriptionSaving, setDescriptionError, patchRobot, flash, reload, corrupt } = state;
    	/**
    	* 打开「更换头像」对话框：草稿从机器人当前头像开始。
    	*
    	*/
    	function openAvatarDialog(robot) {
    		if (mutating) return;
    		setAvatarTarget(robot.name);
    		setDraftAvatar(avatarPreset(robot.avatar).id);
    		setAvatarError(null);
    		setAvatarOpen(true);
    	}
    	/** 关闭「更换头像」对话框；保存中不响应关闭。 */
    	function closeAvatarDialog() {
    		if (avatarSaving) return;
    		setAvatarOpen(false);
    		setAvatarTarget(null);
    		setAvatarError(null);
    	}
    	/** 保存头像：成功后只局部更新那一个机器人，详情页不闪烁。 */
    	async function saveAvatar() {
    		if (avatarTarget === null || avatarSaving) return;
    		setAvatarSaving(true);
    		setAvatarError(null);
    		try {
    			const saved = (await requestJson(AVATAR_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: avatarTarget,
    					avatar: draftAvatar
    				})
    			}))?.robot?.avatar;
    			patchRobot(avatarTarget, { avatar: typeof saved === "string" ? saved : draftAvatar });
    			flash("success", t("avatarUpdated"));
    			setAvatarOpen(false);
    			setAvatarTarget(null);
    		} catch (failure) {
    			setAvatarError(`${t("avatarSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setAvatarSaving(false);
    		}
    	}
    	/**
    	* 打开「重命名机器人」对话框：草稿从当前名称开始，用户直接改成新名。
    	* 登记文件损坏、目录缺失或写操作进行中时不打开（入口按钮也会禁用）。
    	*/
    	function openRenameDialog() {
    		if (selectedRobot === null || mutating || corrupt || selectedRobot.exists === false) return;
    		setRenameDraft(selectedRobot.name);
    		setRenameError(null);
    		setRenameOpen(true);
    	}
    	/** 关闭「重命名机器人」对话框；保存中不响应关闭。 */
    	function closeRenameDialog() {
    		if (renameSaving) return;
    		setRenameOpen(false);
    		setRenameError(null);
    	}
    	/**
    	* 重命名机器人：Host 会把目录改到新名并重建 DSH 工作区。
    	*
    	* 成功后只局部更新列表里的这一条（name / path / mounted / workspaceId /
    	* agents），没被用户改过的 AGENTS.md 草稿跟着 Host 同步后的内容走，再把
    	* `selectedName` 切到新名让配置视图留在同一个机器人上，最后用 `reload()`
    	* 对账；标题是旧名的详情页会因此自然刷新。失败留在对话框里提示。
    	*
    	*/
    	async function renameRobot(event) {
    		event.preventDefault();
    		if (selectedRobot === null || renameSaving) return;
    		const previousName = selectedRobot.name;
    		const previousAgents = agentsOf(selectedRobot);
    		const nextName = renameDraft.trim();
    		if (nextName === "") {
    			setRenameError(t("renameEmpty"));
    			return;
    		}
    		if (nextName === previousName) {
    			setRenameError(t("renameSame"));
    			return;
    		}
    		setRenameSaving(true);
    		setRenameError(null);
    		try {
    			const body = await requestJson(RENAME_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: previousName,
    					newName: nextName
    				})
    			});
    			const renamed = body?.robot;
    			const savedName = typeof renamed?.name === "string" && renamed.name !== "" ? renamed.name : nextName;
    			const patch = {
    				name: savedName,
    				mounted: body?.mounted === true,
    				workspaceId: typeof body?.workspaceId === "string" ? body.workspaceId : null
    			};
    			if (typeof renamed?.path === "string" && renamed.path !== "") patch.path = renamed.path;
    			const savedAgents = body?.agents;
    			if (savedAgents !== null && typeof savedAgents === "object") patch.agents = savedAgents;
    			patchRobot(previousName, patch);
    			if (typeof savedAgents?.content === "string" && agentsDraft === previousAgents.content && savedAgents.content !== agentsDraft) setAgentsDraft(savedAgents.content);
    			setRenameOpen(false);
    			setRenameDraft("");
    			setSelectedName(savedName);
    			flash("success", `${t("renamed")} ${savedName}`);
    			reload();
    		} catch (failure) {
    			setRenameError(`${t("renameSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setRenameSaving(false);
    		}
    	}
    	/**
    	* 描述草稿的规范化（与 Host 一致：折叠空白并 trim）；用来判断有没有改动。
    	*
    	*/
    	function normalizedDescription(value) {
    		return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
    	}
    	/**
    	* 保存「描述」页签：Host 折叠空白后写进登记表。工作流通过 `buka_robots`
    	* 工具读它，决定是否把节点交给这个机器人；保存成功后只局部更新列表。
    	*/
    	async function saveDescription() {
    		if (selectedName === null || descriptionSaving) return;
    		setDescriptionSaving(true);
    		setDescriptionError(null);
    		try {
    			const saved = (await requestJson(DESCRIPTION_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: selectedName,
    					description: descriptionDraft
    				})
    			}))?.robot?.description;
    			const next = typeof saved === "string" ? saved : normalizedDescription(descriptionDraft);
    			patchRobot(selectedName, { description: next });
    			setDescriptionDraft(next);
    			flash("success", t("descriptionSaved"));
    		} catch (failure) {
    			setDescriptionError(`${t("descriptionSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setDescriptionSaving(false);
    		}
    	}
    	return {
    		openAvatarDialog,
    		closeAvatarDialog,
    		saveAvatar,
    		openRenameDialog,
    		closeRenameDialog,
    		renameRobot,
    		normalizedDescription,
    		saveDescription
    	};
    }
    // .build/robots/client/actions/robots.js
    /**
    * 「机器人」页面的机器人管理动作：打开会话、挂载、创建、删除、保存 AGENTS.md。
    *
    * 这些动作只调 Host 路由与 DSH Client Service，然后更新 `useRobotsState` 的
    * 状态；不包含任何渲染。
    *
    * @module @buka/dsh-plugin-robots/client/actions/robots
    */
    /**
    * 构造机器人管理动作。
    *
    */
    function createRobotActions(state, t) {
    	const { setBusy, flash, reload, patchRobot, service, mutating, creating, name, setName, draftDescription, draftAvatar, nextAvatarId, setDialogOpen, setCreateError, setCreating, setConfirming, selectedName, setSelectedName, agentsDraft, agentsSaving, setAgentsSaving, corrupt, setDraftDescription, setDraftAvatar } = state;
    	/**
    	* 打开机器人会话：只有已挂载（有 workspaceId）才能打开；否则提示先挂载。
    	* 打开走 DSH 的 `uiWorkspace.openWorkspace(workspaceId)`。
    	*
    	*/
    	async function openRobot(robot) {
    		if (isProgramRobot(robot)) {
    			flash("error", t("programReadOnly"));
    			return;
    		}
    		if (robot.mounted !== true || typeof robot.workspaceId !== "string" || robot.workspaceId === "") {
    			flash("error", t("openUnmounted"));
    			return;
    		}
    		const uiWorkspace = service("uiWorkspace");
    		if (uiWorkspace === null || typeof uiWorkspace.openWorkspace !== "function") {
    			flash("error", t("noUiWorkspace"));
    			return;
    		}
    		setBusy(`open:${robot.name}`);
    		try {
    			await uiWorkspace.openWorkspace(robot.workspaceId);
    		} catch (failure) {
    			flash("error", `${t("openFailed")} ${messageOf(failure)}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/**
    	* 用系统文件管理器打开机器人目录（macOS 上是 Finder）。
    	*
    	* 成功不弹提示：Finder 窗口本身就是反馈；失败用 Toast 说明。
    	*
    	*/
    	async function revealRobot(robot) {
    		if (mutating) return;
    		if (isProgramRobot(robot)) {
    			flash("error", t("programReadOnly"));
    			return;
    		}
    		setBusy(`reveal:${robot.name}`);
    		try {
    			await requestJson(REVEAL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({ name: robot.name })
    			});
    		} catch (failure) {
    			const extra = errorCode(failure) === "reveal-failed" ? "" : ` ${failureText(t, failure)}`;
    			flash("error", `${t("revealFailed")}${extra}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/**
    	* 把机器人挂载成 DSH 工作区：目录已经由 Host 建好，这里只调用
    	* `workspaces.create({ path })`，成功后刷新列表让卡片变成「已挂载」。
    	*
    	*/
    	async function mountRobot(robot) {
    		if (isProgramRobot(robot)) {
    			flash("error", t("programReadOnly"));
    			return;
    		}
    		const workspaces = service("workspaces");
    		if (workspaces === null || typeof workspaces.create !== "function") {
    			flash("error", t("noWorkspacesCreate"));
    			return;
    		}
    		setBusy(`mount:${robot.name}`);
    		try {
    			await workspaces.create({ path: robot.path });
    			flash("success", `${t("mounted")} ${robot.name}`);
    			reload();
    		} catch (failure) {
    			flash("error", `${t("mountFailed")} ${messageOf(failure)}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/** 打开「创建机器人」对话框：清掉上一次的输入，并按现有机器人挑一个新头像。 */
    	function openCreateDialog() {
    		if (creating || corrupt) return;
    		setName("");
    		setDraftDescription("");
    		setDraftAvatar(nextAvatarId());
    		setCreateError(null);
    		setDialogOpen(true);
    	}
    	/** 关闭「创建机器人」对话框；提交中不响应关闭，避免请求回来时状态错位。 */
    	function closeCreateDialog() {
    		if (creating) return;
    		setDialogOpen(false);
    		setCreateError(null);
    	}
    	/**
    	* 新建机器人：Host 先建目录并写入登记表，浏览器再把它挂载成工作区。
    	* 挂载失败不会撤销机器人 —— 它会以「未挂载」留在列表里，可稍后点「挂载」。
    	* 创建请求本身的失败留在对话框里原地提示，不用关掉重开。
    	*
    	*/
    	async function createRobot(event) {
    		event.preventDefault();
    		if (creating || corrupt) return;
    		const value = name.trim();
    		if (value === "") {
    			setCreateError(t("createEmpty"));
    			return;
    		}
    		setCreating(true);
    		setCreateError(null);
    		try {
    			const body = await requestJson(CREATE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: value,
    					avatar: draftAvatar,
    					description: draftDescription
    				})
    			});
    			setName("");
    			setDialogOpen(false);
    			const robotPath = body?.robot?.path;
    			if (typeof robotPath !== "string" || robotPath === "") {
    				flash("error", `${t("createFailed")} ${messageOf("host did not return the robot path")}`);
    				reload();
    				return;
    			}
    			const workspaces = service("workspaces");
    			if (workspaces === null || typeof workspaces.create !== "function") {
    				flash("error", t("noWorkspacesCreate"));
    				reload();
    				return;
    			}
    			const created = body?.created !== false;
    			try {
    				await workspaces.create({ path: robotPath });
    				flash("success", `${created ? t("created") : t("createExisting")} ${value}`);
    			} catch (failure) {
    				flash("error", `${t("createMountFailed")} ${messageOf(failure)}`);
    			}
    			reload();
    		} catch (failure) {
    			setCreateError(`${t("createFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setCreating(false);
    		}
    	}
    	/**
    	* 删除机器人：先摘掉 DSH 工作区注册（若已挂载），再删插件登记记录。
    	* 机器人目录与文件保留，这也是二次确认文案要说明的语义。
    	*
    	*/
    	async function removeRobot(robot) {
    		if (isProgramRobot(robot)) {
    			flash("error", t("programReadOnly"));
    			return;
    		}
    		setBusy(`delete:${robot.name}`);
    		try {
    			if (robot.mounted === true && typeof robot.workspaceId === "string" && robot.workspaceId !== "") {
    				const workspaces = service("workspaces");
    				if (workspaces === null || typeof workspaces.delete !== "function") {
    					flash("error", t("noWorkspacesDelete"));
    					return;
    				}
    				try {
    					await workspaces.delete(robot.workspaceId);
    				} catch (failure) {
    					flash("error", `${t("deleteFailed")} ${messageOf(failure)}`);
    					return;
    				}
    			}
    			try {
    				await requestJson(REMOVE_ROUTE, {
    					method: "POST",
    					body: JSON.stringify({ name: robot.name })
    				});
    			} catch (failure) {
    				flash("error", `${t("deleteFailed")} ${failureText(t, failure)}`);
    				reload();
    				return;
    			}
    			setConfirming(null);
    			if (selectedName === robot.name) setSelectedName(null);
    			reload();
    			flash("success", `${t("deleted")} ${robot.name}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/**
    	* 保存 AGENTS.md：Host 按机器人 name 解析目录并写文件，返回值里带字节数
    	* 与修改时间，用来更新本地摘要。
    	*
    	*/
    	async function saveAgents(robot) {
    		if (agentsSaving) return;
    		if (isProgramRobot(robot)) {
    			flash("error", t("programReadOnly"));
    			return;
    		}
    		const content = agentsDraft;
    		if (content === agentsOf(robot).content) return;
    		setAgentsSaving(true);
    		try {
    			const body = await requestJson(AGENTS_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: robot.name,
    					content
    				})
    			});
    			patchRobot(robot.name, { agents: {
    				...agentsOf(robot),
    				exists: true,
    				bytes: typeof body.bytes === "number" ? body.bytes : agentsOf(robot).bytes,
    				modifiedAt: typeof body.modifiedAt === "string" ? body.modifiedAt : agentsOf(robot).modifiedAt,
    				content,
    				tooLarge: false
    			} });
    			flash("success", t("agentsSaved"));
    		} catch (failure) {
    			flash("error", `${t("agentsSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setAgentsSaving(false);
    		}
    	}
    	/**
    	* 标记 / 取消助理：只有 agent 型机器人可以设（program 机器人由服务端拒绝）。
    	*
    	*/
    	async function toggleAssistant(robot) {
    		if (mutating || isProgramRobot(robot)) return;
    		const next = robot.assistant !== true;
    		setBusy(`assistant:${robot.name}`);
    		try {
    			const saved = (await requestJson(ASSISTANT_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: robot.name,
    					assistant: next
    				})
    			}))?.robot?.assistant;
    			patchRobot(robot.name, { assistant: typeof saved === "boolean" ? saved : next });
    			flash("success", next ? t("assistantSet") : t("assistantCleared"));
    		} catch (failure) {
    			flash("error", `${t("assistantSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	return {
    		openRobot,
    		revealRobot,
    		mountRobot,
    		openCreateDialog,
    		closeCreateDialog,
    		createRobot,
    		removeRobot,
    		saveAgents,
    		toggleAssistant
    	};
    }
    // .build/robots/client/actions/skills.js
    /**
    * 「机器人」页面的项目级 skills 动作：读收藏仓库、列候选、安装与移除。
    *
    * @module @buka/dsh-plugin-robots/client/actions/skills
    */
    /**
    * 构造 skills 动作。
    *
    */
    function createSkillActions(state, t) {
    	const { favourites, setFavourites, setInstallOpen, installCandidates, setInstallCandidates, installSource, setInstallSource, installSelected, setInstallSelected, setInstallError, installing, setInstalling, selectedRobot, patchRobot, flash, corrupt, removing, setRemoving, setConfirmingSkill, setSkillError } = state;
    	/**
    	* 读 Skills 插件的收藏仓库。只读它已经存在的 `GET /buka-skills/repos`：
    	* 两个插件之间不 import，这个路由回 404（插件没装）或任何失败都按
    	* 「没有收藏夹」处理，页面不显示这一块也不报错。
    	*/
    	function loadFavourites() {
    		if (favourites.status === "loading" || favourites.status === "ready") return;
    		setFavourites((prev) => ({
    			...prev,
    			status: "loading"
    		}));
    		requestJson(SKILLS_REPOS_ROUTE).then((body) => {
    			const repos = (Array.isArray(body?.repos) ? body.repos : []).filter((repo) => repo !== null && typeof repo === "object" && typeof repo.source === "string" && repo.source !== "").map((repo) => ({
    				id: typeof repo.id === "string" && repo.id !== "" ? repo.id : repo.source ?? "",
    				source: repo.source ?? "",
    				note: typeof repo.note === "string" ? repo.note : ""
    			}));
    			setFavourites({
    				status: "ready",
    				repos
    			});
    		}, () => setFavourites({
    			status: "unavailable",
    			repos: []
    		}));
    	}
    	/** 打开「安装 skills」对话框：清掉上一次的来源、候选与勾选，并按需加载收藏夹。 */
    	function openInstallDialog() {
    		if (installing || corrupt) return;
    		setInstallSource("");
    		setInstallCandidates({
    			status: "idle",
    			skills: [],
    			installed: [],
    			error: null,
    			output: ""
    		});
    		setInstallSelected([]);
    		setInstallError(null);
    		setInstallOpen(true);
    		loadFavourites();
    	}
    	/** 关闭「安装 skills」对话框；安装中不响应关闭，避免请求回来时状态错位。 */
    	function closeInstallDialog() {
    		if (installing) return;
    		setInstallOpen(false);
    		setInstallError(null);
    	}
    	/**
    	* 读一个来源里的 skills 清单并默认勾选全部未安装的。
    	*
    	*/
    	async function loadCandidates(sourceOverride) {
    		if (installing || selectedRobot === null) return;
    		const value = (sourceOverride ?? installSource).trim();
    		if (value === "") {
    			setInstallCandidates({
    				status: "error",
    				skills: [],
    				installed: [],
    				error: t("errInvalidSource"),
    				output: ""
    			});
    			return;
    		}
    		setInstallSource(value);
    		setInstallCandidates({
    			status: "loading",
    			skills: [],
    			installed: [],
    			error: null,
    			output: ""
    		});
    		setInstallError(null);
    		try {
    			const body = await requestJson(AVAILABLE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: selectedRobot.name,
    					source: value
    				})
    			});
    			const skills = (Array.isArray(body?.skills) ? body.skills : []).filter((skill) => skill !== null && typeof skill === "object" && typeof skill.name === "string" && skill.name !== "");
    			const installed = new Set((Array.isArray(body?.installed) ? body.installed : []).map((name) => String(name)));
    			for (const skill of skillsOf(selectedRobot)) installed.add(String(skill.name));
    			setInstallCandidates({
    				status: "ready",
    				skills,
    				installed: [...installed],
    				error: null,
    				output: ""
    			});
    			setInstallSelected(skills.filter((skill) => !installed.has(skill.name)).map((skill) => skill.name));
    		} catch (failure) {
    			setInstallCandidates({
    				status: "error",
    				skills: [],
    				installed: [],
    				error: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		}
    	}
    	/**
    	* 勾选 / 取消一个候选 skill。
    	*
    	*/
    	function toggleCandidate(skillName) {
    		setInstallSelected((prev) => prev.includes(skillName) ? prev.filter((name) => name !== skillName) : [...prev, skillName]);
    	}
    	/**
    	* 全选 / 取消全选（已安装的不参与）。
    	*
    	*/
    	function selectAllCandidates(checked) {
    		const installed = new Set(installCandidates.installed);
    		const selectable = installCandidates.skills.filter((skill) => !installed.has(skill.name)).map((skill) => skill.name);
    		setInstallSelected(checked ? selectable : []);
    	}
    	/**
    	* 安装勾选的 skills：Host 在机器人目录里跑
    	* `npx skills add <source> --skill … -a universal -a claude-code -y`，
    	* 同时落 `.agents/skills` 与 `.claude/skills`；成功响应带新的 skills 列表。
    	*/
    	async function installSelectedSkills() {
    		if (installing || selectedRobot === null) return;
    		if (installSelected.length === 0) {
    			setInstallError({
    				message: t("installEmptySelection"),
    				output: ""
    			});
    			return;
    		}
    		setInstalling(true);
    		setInstallError(null);
    		try {
    			const body = await requestJson(INSTALL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: selectedRobot.name,
    					source: installSource.trim(),
    					skills: installSelected
    				})
    			});
    			patchRobot(selectedRobot.name, {
    				skills: Array.isArray(body.skills) ? body.skills : [],
    				claude: body.claude !== null && typeof body.claude === "object" ? body.claude : claudeOf(selectedRobot)
    			});
    			setInstallOpen(false);
    			flash("success", `${t("skillInstalled")} ${installSource.trim()}`);
    		} catch (failure) {
    			setInstallError({
    				message: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		} finally {
    			setInstalling(false);
    		}
    	}
    	/**
    	* 移除项目级 skill：Host 执行 `npx skills remove <skill> -y` 并返回新的
    	* skills 列表；请求体字段是 `{ name, skill }`（v2 契约）。
    	*
    	*/
    	async function removeSkill(robot, skill) {
    		if (removing !== null) return;
    		setRemoving(skill.name);
    		setSkillError(null);
    		try {
    			const body = await requestJson(SKILL_REMOVE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					name: robot.name,
    					skill: skill.name
    				})
    			});
    			patchRobot(robot.name, { skills: Array.isArray(body.skills) ? body.skills : [] });
    			setConfirmingSkill(null);
    			flash("success", `${t("skillRemoved")} ${skill.name}`);
    		} catch (failure) {
    			setSkillError({
    				message: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		} finally {
    			setRemoving(null);
    		}
    	}
    	return {
    		loadFavourites,
    		openInstallDialog,
    		closeInstallDialog,
    		loadCandidates,
    		toggleCandidate,
    		selectAllCandidates,
    		installSelectedSkills,
    		removeSkill
    	};
    }
    // .build/robots/client/state.js
    /**
    * 「机器人」页面的全部 UI 状态与派生值。
    *
    * 页面只保存 UI 状态；机器人列表（登记表）来自 Host 的 `/buka-robots/list`。
    * 状态集中在 `useRobotsState` 里，视图与动作模块只读写它，不各自持有副本。
    *
    * @module @buka/dsh-plugin-robots/client/state
    */
    /**
    * 页面状态：列表、详情、各个对话框的草稿 / 失败提示，以及派生的 robots 等。
    *
    */
    function useRobotsState(props) {
    	const getService = typeof props.getService === "function" ? props.getService : () => null;
    	/** 列表请求：`data` 是成功的响应，`error` 是失败原因，`loading` 覆盖首载与刷新。 */
    	const [list, setList] = react.default.useState({
    		data: null,
    		error: null,
    		loading: true
    	});
    	const [reloadKey, setReloadKey] = react.default.useState(0);
    	/** 列表页状态。 */
    	const [name, setName] = react.default.useState("");
    	/** 创建对话框里的描述草稿；提交时随名字一起写入登记表。 */
    	const [draftDescription, setDraftDescription] = react.default.useState("");
    	const [dialogOpen, setDialogOpen] = react.default.useState(false);
    	const [createError, setCreateError] = react.default.useState(null);
    	const [creating, setCreating] = react.default.useState(false);
    	const [confirming, setConfirming] = react.default.useState(null);
    	const [busy, setBusy] = react.default.useState(null);
    	/**
    	* 头像状态：`draftAvatar` 是创建对话框 / 「更换头像」对话框里当前选中的
    	* 预设；`avatarTarget` 非空时「更换头像」对话框打开，值是机器人名。
    	*/
    	const [draftAvatar, setDraftAvatar] = react.default.useState(DEFAULT_AVATAR_ID);
    	const [avatarOpen, setAvatarOpen] = react.default.useState(false);
    	const [avatarTarget, setAvatarTarget] = react.default.useState(null);
    	const [avatarSaving, setAvatarSaving] = react.default.useState(false);
    	/** 「更换头像」对话框里的失败提示：请求失败时留在框里，不靠会被遮住的 Toast。 */
    	const [avatarError, setAvatarError] = react.default.useState(null);
    	/**
    	* 「描述」页签的草稿与保存状态；草稿在进入详情时从机器人当前描述初始化，
    	* 列表刷新不会覆盖用户正在编辑的内容。
    	*/
    	const [descriptionDraft, setDescriptionDraft] = react.default.useState("");
    	const [descriptionSaving, setDescriptionSaving] = react.default.useState(false);
    	const [descriptionError, setDescriptionError] = react.default.useState(null);
    	/**
    	* 「重命名机器人」对话框：`renameDraft` 是新名称草稿，默认带出当前名称；
    	* 失败提示留在对话框里，提交中不响应关闭。
    	*/
    	const [renameOpen, setRenameOpen] = react.default.useState(false);
    	const [renameDraft, setRenameDraft] = react.default.useState("");
    	const [renameSaving, setRenameSaving] = react.default.useState(false);
    	const [renameError, setRenameError] = react.default.useState(null);
    	/** 详情页状态：`selectedName` 非空时显示配置视图，`tab` 是页签。 */
    	const [selectedName, setSelectedName] = react.default.useState(null);
    	const [tab, setTab] = react.default.useState("agents");
    	const [agentsDraft, setAgentsDraft] = react.default.useState("");
    	const [agentsSaving, setAgentsSaving] = react.default.useState(false);
    	const [removing, setRemoving] = react.default.useState(null);
    	const [confirmingSkill, setConfirmingSkill] = react.default.useState(null);
    	const [skillError, setSkillError] = react.default.useState(null);
    	/**
    	* 「安装 skills」对话框的状态。
    	*
    	* - `candidates.status`：`idle` 还没读 / `loading` 读取中 / `ready` 有清单 /
    	*   `error` 读取失败（带命令输出）；
    	* - `installSelected`：勾选的 skill 名；每次读出清单时默认全选未安装的；
    	* - `favourites.status`：`unavailable` 表示 Skills 插件没安装（整块隐藏，
    	*   不是错误），`ready` 时 `repos` 是收藏仓库。
    	*/
    	const [installOpen, setInstallOpen] = react.default.useState(false);
    	const [installSource, setInstallSource] = react.default.useState("");
    	const [installCandidates, setInstallCandidates] = react.default.useState({
    		status: "idle",
    		skills: [],
    		installed: [],
    		error: null,
    		output: ""
    	});
    	const [installSelected, setInstallSelected] = react.default.useState([]);
    	const [installError, setInstallError] = react.default.useState(null);
    	const [installing, setInstalling] = react.default.useState(false);
    	const [favourites, setFavourites] = react.default.useState({
    		status: "idle",
    		repos: []
    	});
    	/** Toast 文案；同一时刻只保留最后一条。 */
    	const [notice, setNotice] = react.default.useState(null);
    	/** 列表筛选：只看带 `assistant` 标记的机器人。 */
    	const [assistantOnly, setAssistantOnly] = react.default.useState(false);
    	react.default.useEffect(() => {
    		let cancelled = false;
    		setList((prev) => ({
    			...prev,
    			loading: true,
    			error: null
    		}));
    		requestJson(LIST_ROUTE).then((body) => {
    			if (!cancelled) setList({
    				data: body,
    				error: null,
    				loading: false
    			});
    		}, (failure) => {
    			if (!cancelled) setList((prev) => ({
    				...prev,
    				error: messageOf(failure),
    				loading: false
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [reloadKey]);
    	const data = list.data;
    	const robots = Array.isArray(data?.robots) ? data.robots : [];
    	const registry = typeof data?.registry === "string" ? data.registry : "";
    	const corrupt = data?.corrupt === true;
    	const selectedRobot = selectedName === null ? null : robots.find((robot) => robot.name === selectedName) ?? null;
    	/** 任意写操作进行中：按钮据此统一禁用，避免并发请求互相覆盖。 */
    	const mutating = creating || busy !== null || installing || removing !== null || agentsSaving || avatarSaving || descriptionSaving || renameSaving;
    	/**
    	* 新建机器人时的默认头像：按预设顺序挑第一个还没被占用的，避免刚建的一批
    	* 机器人全是一个样子（Host 也会在没传头像时做同样的分配）。
    	*
    	*/
    	function nextAvatarId() {
    		const used = new Set(robots.map((robot) => avatarPreset(robot.avatar).id));
    		return (AVATARS.find((preset) => !used.has(preset.id)) ?? AVATARS[0]).id;
    	}
    	react.default.useEffect(() => {
    		if (data === null || selectedName === null) return;
    		if (!robots.some((robot) => robot.name === selectedName)) setSelectedName(null);
    	}, [data, selectedName]);
    	/**
    	* 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
    	*
    	*/
    	function flash(kind, text) {
    		setNotice({
    			kind,
    			text,
    			seq: Date.now() + Math.random()
    		});
    	}
    	/** 重新读一次机器人列表（新建 / 挂载 / 删除 / 安装 skill 之后都会调用）。 */
    	function reload() {
    		setReloadKey((key) => key + 1);
    	}
    	/**
    	* 用 Host 的响应局部更新一个机器人，不整表刷新，避免详情页闪烁。
    	*
    	*/
    	function patchRobot(robotName, patch) {
    		setList((prev) => {
    			if (prev.data === null || !Array.isArray(prev.data.robots)) return prev;
    			return {
    				...prev,
    				data: {
    					...prev.data,
    					robots: prev.data.robots.map((robot) => robot.name === robotName ? {
    						...robot,
    						...patch
    					} : robot)
    				}
    			};
    		});
    	}
    	/**
    	* 取一个 DSH Client Service；插件上下文里不存在时返回 null，而不是抛错。
    	*
    	*/
    	function service(serviceName) {
    		try {
    			return getService(serviceName) ?? null;
    		} catch {
    			return null;
    		}
    	}
    	/**
    	* 进入配置视图：从列表返回值初始化 AGENTS.md 草稿，并清掉上一个机器人的
    	* 临时状态。之后刷新列表不会覆盖这份草稿（用户可能正在编辑）。
    	*
    	*/
    	function openDetail(robot) {
    		if (robot.driver === "program") return;
    		setSelectedName(robot.name);
    		setTab("agents");
    		setAgentsDraft(agentsOf(robot).content);
    		setDescriptionDraft(typeof robot.description === "string" ? robot.description : "");
    		setDescriptionError(null);
    		setSkillError(null);
    		setConfirmingSkill(null);
    		setInstallOpen(false);
    		setInstallError(null);
    		setRenameOpen(false);
    		setRenameError(null);
    		setNotice(null);
    	}
    	/** 返回列表页，并清掉详情页临时状态。 */
    	function backToList() {
    		setSelectedName(null);
    		setDescriptionError(null);
    		setSkillError(null);
    		setConfirmingSkill(null);
    		setInstallOpen(false);
    		setInstallError(null);
    		setRenameOpen(false);
    		setRenameError(null);
    		setNotice(null);
    	}
    	/**
    	* 切换详情页签；切换时收起 Toast，避免旧提示留在新页签上方。
    	*
    	*/
    	function switchTab(next) {
    		if (next === tab) return;
    		setNotice(null);
    		setTab(next);
    	}
    	return {
    		list,
    		setList,
    		reloadKey,
    		setReloadKey,
    		name,
    		setName,
    		draftDescription,
    		setDraftDescription,
    		dialogOpen,
    		setDialogOpen,
    		createError,
    		setCreateError,
    		creating,
    		setCreating,
    		confirming,
    		setConfirming,
    		busy,
    		setBusy,
    		draftAvatar,
    		setDraftAvatar,
    		avatarOpen,
    		setAvatarOpen,
    		avatarTarget,
    		setAvatarTarget,
    		avatarSaving,
    		setAvatarSaving,
    		avatarError,
    		setAvatarError,
    		descriptionDraft,
    		setDescriptionDraft,
    		descriptionSaving,
    		setDescriptionSaving,
    		descriptionError,
    		setDescriptionError,
    		renameOpen,
    		setRenameOpen,
    		renameDraft,
    		setRenameDraft,
    		renameSaving,
    		setRenameSaving,
    		renameError,
    		setRenameError,
    		selectedName,
    		setSelectedName,
    		tab,
    		setTab,
    		agentsDraft,
    		setAgentsDraft,
    		agentsSaving,
    		setAgentsSaving,
    		removing,
    		setRemoving,
    		confirmingSkill,
    		setConfirmingSkill,
    		skillError,
    		setSkillError,
    		installOpen,
    		setInstallOpen,
    		installSource,
    		setInstallSource,
    		installCandidates,
    		setInstallCandidates,
    		installSelected,
    		setInstallSelected,
    		installError,
    		setInstallError,
    		installing,
    		setInstalling,
    		favourites,
    		setFavourites,
    		notice,
    		setNotice,
    		assistantOnly,
    		setAssistantOnly,
    		data,
    		robots,
    		registry,
    		corrupt,
    		selectedRobot,
    		mutating,
    		nextAvatarId,
    		flash,
    		reload,
    		patchRobot,
    		service,
    		openDetail,
    		backToList,
    		switchTab
    	};
    }
    // .build/robots/client/components/install-dialog.js
    /**
    * 「安装 skills」对话框：来源输入 + 收藏仓库入口 + 候选勾选列表。
    *
    * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
    *
    * @module @buka/dsh-plugin-robots/client/components/install-dialog
    */
    /**
    * 对话框内容：来源输入 + 收藏仓库入口 + 候选勾选列表。
    * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
    *
    */
    function InstallDialog({ t, state, skillActions }) {
    	const { installCandidates, installSelected, favourites, installSource, setInstallSource, installing, installError } = state;
    	const { loadCandidates, toggleCandidate, selectAllCandidates } = skillActions;
    	const candidates = installCandidates;
    	const installed = new Set(candidates.installed);
    	const selectable = candidates.skills.filter((skill) => !installed.has(skill.name));
    	const allSelected = selectable.length > 0 && selectable.every((skill) => installSelected.includes(skill.name));
    	const favouritesBlock = favourites.status === "ready" ? favourites.repos.length === 0 ? h("p", { className: "buka-robots-fieldHint" }, t("favouritesEmpty")) : h("div", { className: "buka-robots-field" }, h("span", { className: "buka-robots-fieldLabel" }, t("favouritesLabel")), h("div", { className: "buka-robots-favorites" }, ...favourites.repos.map((repo) => h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: repo.id,
    		variant: installSource === repo.source ? "primary" : "outline",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		title: repo.note !== "" ? repo.note : repo.source,
    		disabled: installing || candidates.status === "loading",
    		onClick: () => loadCandidates(repo.source)
    	}, repo.source)))) : null;
    	return h("div", { className: "buka-robots-dialogForm" }, h("form", {
    		id: INSTALL_FORM_ID,
    		className: "buka-robots-field",
    		onSubmit: (event) => {
    			event.preventDefault();
    			loadCandidates();
    		}
    	}, h("label", {
    		className: "buka-robots-fieldLabel",
    		htmlFor: "buka-robots-install-source"
    	}, t("installSourceLabel")), h("div", { className: "buka-robots-sourceRow" }, h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		id: "buka-robots-install-source",
    		className: "buka-robots-input",
    		type: "text",
    		value: installSource,
    		placeholder: t("sourcePlaceholder"),
    		autoComplete: "off",
    		spellCheck: false,
    		disabled: installing,
    		"data-modal-autofocus": "",
    		onChange: (event) => setInstallSource(event.target.value)
    	}), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		type: "submit",
    		className: "buka-robots-submit",
    		icon: candidates.status === "loading" ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : void 0,
    		disabled: installing || candidates.status === "loading" || installSource.trim() === ""
    	}, candidates.status === "loading" ? t("loadingSkills") : t("loadSkills")))), favouritesBlock, candidates.status === "idle" ? h("p", { className: "buka-robots-fieldHint" }, t("installIdle")) : null, candidates.status === "loading" ? h("p", {
    		className: "buka-robots-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loadingSkills")) : null, candidates.status === "error" ? h("div", {
    		className: "buka-robots-alert",
    		role: "alert"
    	}, h("div", { className: "buka-robots-alertHead" }, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("errAvailableFailed")} ${candidates.error}`)), candidates.output === "" ? null : h(react.default.Fragment, null, h("span", { className: "buka-robots-outputLabel" }, t("outputLabel")), h("pre", { className: "buka-robots-output" }, candidates.output))) : null, candidates.status === "ready" ? h(react.default.Fragment, null, h("div", { className: "buka-robots-candidatesHead" }, h("span", { className: "buka-robots-fieldHint" }, `${String(t("skillsFound")).replace("{n}", String(candidates.skills.length))} · ${String(t("selectedSkills")).replace("{n}", String(installSelected.length)).replace("{m}", String(selectable.length))}`), selectable.length === 0 ? null : h("label", { className: "buka-robots-selectAll" }, h("input", {
    		type: "checkbox",
    		className: "buka-robots-candidateInput",
    		checked: allSelected,
    		disabled: installing,
    		onChange: (event) => selectAllCandidates(event.target.checked)
    	}), h("span", null, t("selectAllSkills")))), h("ul", { className: "buka-robots-candidates" }, ...candidates.skills.map((skill) => {
    		const isInstalled = installed.has(skill.name);
    		const checked = !isInstalled && installSelected.includes(skill.name);
    		return h("li", { key: skill.name }, h("label", {
    			className: `buka-robots-candidate${isInstalled ? " isDisabled" : ""}`,
    			title: typeof skill.description === "string" && skill.description !== "" ? skill.description : String(skill.name)
    		}, h("input", {
    			type: "checkbox",
    			className: "buka-robots-candidateInput",
    			checked,
    			disabled: isInstalled || installing,
    			onChange: () => toggleCandidate(skill.name)
    		}), h("span", { className: "buka-robots-candidateText" }, h("span", { className: "buka-robots-candidateName" }, String(skill.name)), typeof skill.description === "string" && skill.description !== "" ? h("span", { className: "buka-robots-candidateDesc" }, skill.description) : null), isInstalled ? h("span", { className: "buka-robots-candidateTag" }, h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("alreadyInstalled"))) : null));
    	})), installed.size === 0 ? null : h("p", { className: "buka-robots-fieldHint" }, t("installedHint"))) : null, installError === null ? null : h("div", {
    		className: "buka-robots-alert",
    		role: "alert"
    	}, h("div", { className: "buka-robots-alertHead" }, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("skillErrorTitle")} ${installError.message}`)), typeof installError.output === "string" && installError.output !== "" ? h(react.default.Fragment, null, h("span", { className: "buka-robots-outputLabel" }, t("outputLabel")), h("pre", { className: "buka-robots-output" }, installError.output)) : null));
    }
    /**
    * 「安装 skills」对话框的 Modal 外壳。
    *
    */
    function InstallSkillsModal({ t, state, skillActions }) {
    	const { installOpen, selectedRobot, installSelected, installing } = state;
    	const { closeInstallDialog, installSelectedSkills } = skillActions;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: installOpen,
    		onClose: closeInstallDialog,
    		title: t("installDialogTitle"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeInstallDialog,
    			disabled: installing
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "button",
    			disabled: installing || installSelected.length === 0,
    			onClick: installSelectedSkills
    		}, installing ? String(t("installingSkills")).replace("{n}", String(installSelected.length)) : installSelected.length > 0 ? String(t("installSelectedCount")).replace("{n}", String(installSelected.length)) : t("installSelected")))
    	}, installOpen && selectedRobot !== null ? h(InstallDialog, {
    		t,
    		state,
    		skillActions
    	}) : null);
    }
    // .build/robots/client/components/common.js
    /**
    * 「机器人」页面共用的小组件：头像选择器与挂载状态标签。
    *
    * @module @buka/dsh-plugin-robots/client/components/common
    */
    /**
    * 预设头像选择器：圆形 emoji 按钮的网格，选中项有描边。创建对话框与
    * 「更换头像」对话框共用；`disabled` 时整组不可点。
    *
    */
    function AvatarPicker({ t, current, disabled, onSelect }) {
    	return h("div", {
    		className: "buka-robots-avatarGrid",
    		role: "radiogroup",
    		"aria-label": t("chooseAvatar")
    	}, ...AVATARS.map((preset) => h("button", {
    		key: preset.id,
    		type: "button",
    		role: "radio",
    		"aria-checked": preset.id === current,
    		"aria-label": t(preset.labelKey),
    		title: t(preset.labelKey),
    		className: `buka-robots-avatarOption${preset.id === current ? " is-selected" : ""}`,
    		disabled,
    		onClick: () => onSelect(preset.id)
    	}, renderAvatar(preset.id, 30))));
    }
    /**
    * 挂载状态标签：已挂载用 success，未挂载用 neutral。
    *
    */
    function MountedTag({ t, robot }) {
    	return h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: robot.mounted === true ? "success" : "neutral" }, robot.mounted === true ? t("mountedBadge") : t("unmountedBadge"));
    }
    // .build/robots/client/components/page-header.js
    /**
    * 「机器人」页面标题行：返回 / 头像 / 标题 / 重命名、工具栏与详情页签。
    *
    * @module @buka/dsh-plugin-robots/client/components/page-header
    */
    /**
    * 渲染标题行、工具栏与详情页签。
    *
    */
    function PageHeader({ t, state, actions, detail }) {
    	const { selectedRobot, mutating, corrupt, list, busy, tab, reload, switchTab, backToList, assistantOnly, setAssistantOnly } = state;
    	const { openCreateDialog, openRobot, revealRobot } = actions;
    	const { openAvatarDialog, openRenameDialog } = detail;
    	const program = selectedRobot?.driver === "program";
    	const refreshButton = h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: t("refresh"),
    		side: "bottom",
    		delayMs: 500,
    		disabled: list.loading
    	}, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		"aria-label": t("refresh"),
    		"aria-busy": list.loading,
    		disabled: list.loading || mutating,
    		icon: list.loading ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		onClick: reload
    	}, t("refresh")));
    	const filterButton = selectedRobot === null ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		"aria-pressed": assistantOnly === true,
    		"aria-label": assistantOnly === true ? t("showAllRobots") : t("filterAssistants"),
    		disabled: mutating,
    		onClick: () => setAssistantOnly(assistantOnly !== true)
    	}, assistantOnly === true ? t("showAllRobots") : t("filterAssistants")) : null;
    	const createButton = selectedRobot === null ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
    		"aria-label": t("create"),
    		disabled: mutating || corrupt,
    		onClick: openCreateDialog
    	}, t("create")) : null;
    	const detailActions = selectedRobot === null || program ? null : [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "open",
    		variant: "outline",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    		disabled: mutating,
    		"aria-label": `${t("newSession")} ${selectedRobot.name}`,
    		onClick: () => openRobot(selectedRobot)
    	}, t("newSession")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "reveal",
    		variant: "outline",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		icon: busy === `reveal:${selectedRobot.name}` ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: 13 }),
    		disabled: mutating || selectedRobot.exists === false,
    		"aria-label": `${t("reveal")} ${selectedRobot.name}`,
    		onClick: () => revealRobot(selectedRobot)
    	}, t("reveal"))];
    	return h("div", { className: "buka-robots-head" }, h("div", { className: "buka-robots-headInner" }, h("div", { className: "buka-robots-heading" }, h("div", { className: "buka-robots-headingRow" }, selectedRobot === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: t("back"),
    		side: "top",
    		delayMs: 400
    	}, h("button", {
    		type: "button",
    		className: "buka-robots-iconButton buka-robots-back buka-robots-backButton",
    		"aria-label": t("back"),
    		disabled: mutating,
    		onClick: backToList
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 16 }))), selectedRobot === null || program ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: t("changeAvatar"),
    		side: "top",
    		delayMs: 400
    	}, h("button", {
    		type: "button",
    		className: "buka-robots-avatarButton",
    		"aria-label": `${t("changeAvatar")} ${selectedRobot.name}`,
    		disabled: mutating,
    		onClick: () => openAvatarDialog(selectedRobot)
    	}, renderAvatar(selectedRobot.avatar, 32))), h("h1", { className: "buka-robots-title" }, selectedRobot === null ? t("title") : String(selectedRobot.name ?? "")), selectedRobot === null || program ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: `${t("renameLabel")} ${selectedRobot.name}`,
    		side: "top",
    		delayMs: 400
    	}, h("button", {
    		type: "button",
    		className: "buka-robots-iconButton",
    		"aria-label": `${t("renameLabel")} ${selectedRobot.name}`,
    		disabled: mutating || corrupt || selectedRobot.exists === false,
    		onClick: openRenameDialog
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 16 }))), selectedRobot === null ? null : h("span", { className: "buka-robots-headingTag" }, program ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("driverProgram")) : h(MountedTag, {
    		t,
    		robot: selectedRobot
    	}), selectedRobot.assistant === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "success" }, t("assistantBadge")) : null))), h("div", { className: "buka-robots-toolbar" }, detailActions, filterButton, refreshButton, createButton), selectedRobot === null ? null : h("div", { className: "buka-robots-tabs" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-robots-tabList",
    		label: t("tabsLabel"),
    		value: tab,
    		onChange: switchTab,
    		items: [
    			{
    				value: TABS[0].value,
    				label: t("tabDescription"),
    				id: TABS[0].id,
    				panelId: TABS[0].panelId
    			},
    			{
    				value: TABS[1].value,
    				label: t("tabAgents"),
    				id: TABS[1].id,
    				panelId: TABS[1].panelId
    			},
    			{
    				value: TABS[2].value,
    				label: t("tabSkills"),
    				id: TABS[2].id,
    				panelId: TABS[2].panelId
    			}
    		]
    	}))));
    }
    // .build/robots/client/components/robot-detail.js
    /**
    * 「机器人」详情页：职责、AGENTS.md 与 skills 三个页签。
    *
    * @module @buka/dsh-plugin-robots/client/components/robot-detail
    */
    /**
    * 技能区块：来源输入 + 安装按钮、失败输出、已安装列表与移除确认。
    *
    */
    function SkillsSection({ t, robot, state, skillActions }) {
    	const { mutating, confirmingSkill, removing, skillError, setConfirmingSkill, corrupt } = state;
    	const { removeSkill, openInstallDialog } = skillActions;
    	const skills = skillsOf(robot);
    	const anyBusy = mutating;
    	const rows = skills.map((skill, index) => {
    		const confirmingThis = confirmingSkill === skill.name;
    		const actions = removing === skill.name ? h("span", { className: "buka-robots-statusWithDot" }, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}), t("removing")) : confirmingThis ? [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "confirm",
    			variant: "outline",
    			size: "sm",
    			className: "buka-robots-danger",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			onClick: () => removeSkill(robot, skill)
    		}, t("confirmRemoveSkill")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "cancel",
    			variant: "ghost",
    			size: "sm",
    			disabled: anyBusy,
    			onClick: () => setConfirmingSkill(null)
    		}, t("cancel"))] : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			size: "sm",
    			className: "buka-robots-danger",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			"aria-label": `${t("removeSkill")} ${skill.name}`,
    			onClick: () => setConfirmingSkill(skill.name)
    		}, t("removeSkill"));
    		return h("li", {
    			className: "buka-robots-skillRow",
    			key: `${String(skill.name)}:${index}`
    		}, h("div", { className: "buka-robots-skillHead" }, h("span", { className: "buka-robots-skillName" }, String(skill.name)), typeof skill.source === "string" && skill.source !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, skill.source) : null, h("span", { className: "buka-robots-skillActions" }, ...Array.isArray(actions) ? actions : [actions])), typeof skill.description === "string" && skill.description !== "" ? h("div", {
    			className: "buka-robots-skillDesc",
    			title: skill.description
    		}, skill.description) : null);
    	});
    	return h("section", {
    		className: "buka-robots-section",
    		"aria-busy": anyBusy ? true : void 0
    	}, h("div", { className: "buka-robots-sectionHead" }, h("h2", { className: "buka-robots-sectionTitle" }, t("skillsTitle")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-robots-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
    		disabled: mutating || corrupt || robot.exists === false,
    		onClick: openInstallDialog
    	}, t("installSkills"))), h("p", { className: "buka-robots-intro" }, t("skillsIntroBefore"), h("code", { className: "buka-robots-inlineCode" }, "npx skills add <source>"), t("skillsIntroMiddle"), h("code", { className: "buka-robots-inlineCode" }, ".agents/skills"), t("skillsIntroAfter")), skillError === null ? null : h("div", {
    		className: "buka-robots-alert",
    		role: "alert"
    	}, h("div", { className: "buka-robots-alertHead" }, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("skillErrorTitle")} ${skillError.message}`)), typeof skillError.output === "string" && skillError.output !== "" ? h(react.default.Fragment, null, h("span", { className: "buka-robots-outputLabel" }, t("outputLabel")), h("pre", { className: "buka-robots-output" }, skillError.output)) : null), skills.length === 0 ? h("p", { className: "buka-robots-empty" }, t("skillsEmpty")) : h("ul", { className: "buka-robots-skillList" }, ...rows));
    }
    /**
    * AGENTS.md 页签：过大时只给提示；否则是可编辑 textarea + dirty 才可用的
    * 保存按钮。页面不展示目录与 CLAUDE.md 链接状态（链接由 Host 自动维护）。
    *
    */
    function AgentsSection({ t, robot, state, actions }) {
    	const { agentsDraft, setAgentsDraft, agentsSaving, mutating } = state;
    	const { saveAgents } = actions;
    	const agents = agentsOf(robot);
    	const dirty = !agents.tooLarge && agentsDraft !== agents.content;
    	if (agents.tooLarge) return h("section", { className: "buka-robots-section" }, h("h2", { className: "buka-robots-sectionTitle" }, t("agentsTitle")), h("p", {
    		className: "buka-robots-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("agentsTooLarge"))));
    	return h("section", {
    		className: "buka-robots-section buka-robots-agentsSection",
    		"aria-busy": agentsSaving ? true : void 0
    	}, h("div", { className: "buka-robots-sectionHead" }, h("h2", { className: "buka-robots-sectionTitle" }, t("agentsTitle")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		type: "button",
    		className: "buka-robots-submit",
    		disabled: !dirty || mutating,
    		onClick: () => saveAgents(robot)
    	}, agentsSaving ? t("saving") : t("save"))), agents.exists ? null : h("p", { className: "buka-robots-meta" }, t("agentsMissingHint")), h("textarea", {
    		className: "buka-robots-textarea",
    		value: agentsDraft,
    		placeholder: t("agentsPlaceholder"),
    		"aria-label": t("agentsEditorLabel"),
    		spellCheck: false,
    		disabled: agentsSaving,
    		onChange: (event) => setAgentsDraft(event.target.value)
    	}));
    }
    /**
    * 「描述」页签：一句话摘要 + 保存按钮。工作流通过 `buka_robots` 读这一行，
    * 决定是否把节点交给这个机器人；没有改动时保存按钮不可用。
    *
    */
    function DescriptionSection({ t, robot, state, detailActions }) {
    	const { descriptionDraft, setDescriptionDraft, descriptionSaving, descriptionError, mutating } = state;
    	const { normalizedDescription, saveDescription } = detailActions;
    	const current = typeof robot.description === "string" ? robot.description : "";
    	const dirty = normalizedDescription(descriptionDraft) !== current;
    	return h("section", {
    		className: "buka-robots-section",
    		"aria-busy": descriptionSaving ? true : void 0
    	}, h("div", { className: "buka-robots-sectionHead" }, h("h2", { className: "buka-robots-sectionTitle" }, t("descriptionLabel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		type: "button",
    		className: "buka-robots-submit",
    		disabled: !dirty || mutating,
    		onClick: saveDescription
    	}, descriptionSaving ? t("saving") : t("save"))), h("p", { className: "buka-robots-fieldHint" }, t("descriptionHint")), h("textarea", {
    		className: "buka-robots-descriptionInput is-tall",
    		value: descriptionDraft,
    		placeholder: t("descriptionPlaceholder"),
    		maxLength: 500,
    		rows: 4,
    		disabled: descriptionSaving,
    		"aria-label": t("descriptionLabel"),
    		onChange: (event) => setDescriptionDraft(event.target.value)
    	}), descriptionError === null ? null : h("p", {
    		className: "buka-robots-formError",
    		role: "alert"
    	}, descriptionError));
    }
    /**
    * 配置视图：缺目录提示 + 页签面板（AGENTS.md / Skills / 描述）。
    *
    */
    function RobotDetail({ t, robot, state, actions, detailActions, skillActions }) {
    	const { tab } = state;
    	const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0];
    	return h("div", { className: "buka-robots-pageBody buka-robots-detail" }, robot.exists === false ? h("p", {
    		className: "buka-robots-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("missingDirDetail"))) : null, h("div", {
    		className: "buka-robots-panel",
    		role: "tabpanel",
    		id: activeTab.panelId,
    		"aria-labelledby": activeTab.id
    	}, tab === "skills" ? h(SkillsSection, {
    		t,
    		robot,
    		state,
    		skillActions
    	}) : tab === "description" ? h(DescriptionSection, {
    		t,
    		robot,
    		state,
    		detailActions
    	}) : h(AgentsSection, {
    		t,
    		robot,
    		state,
    		actions
    	})));
    }
    // .build/robots/client/components/robot-dialogs.js
    /**
    * 「机器人」页面里的创建 / 更换头像 / 重命名对话框。
    *
    * 三个对话框都由页面状态控制 `open`，提交中不响应关闭；失败提示留在框里，
    * 避免被 Toast 遮住。
    *
    * @module @buka/dsh-plugin-robots/client/components/robot-dialogs
    */
    /**
    * 创建机器人对话框。
    *
    */
    function CreateRobotDialog({ t, state, actions }) {
    	const { dialogOpen, creating, name, setName, draftDescription, setDraftDescription, draftAvatar, setDraftAvatar, createError } = state;
    	const { createRobot, closeCreateDialog } = actions;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: dialogOpen,
    		onClose: closeCreateDialog,
    		title: t("create"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeCreateDialog,
    			disabled: creating
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "submit",
    			form: CREATE_FORM_ID,
    			disabled: creating || name.trim() === ""
    		}, creating ? t("creating") : t("create")))
    	}, h("form", {
    		id: CREATE_FORM_ID,
    		className: "buka-robots-dialogForm",
    		onSubmit: createRobot
    	}, h("div", { className: "buka-robots-avatarField" }, h("span", { className: "buka-robots-fieldLabel" }, t("avatar")), h(AvatarPicker, {
    		t,
    		current: draftAvatar,
    		disabled: creating,
    		onSelect: setDraftAvatar
    	})), h("label", { className: "buka-robots-field" }, h("span", { className: "buka-robots-fieldLabel" }, t("createFieldName")), h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		className: "buka-robots-fieldInput",
    		type: "text",
    		value: name,
    		placeholder: t("createPlaceholder"),
    		autoComplete: "off",
    		spellCheck: false,
    		maxLength: 64,
    		disabled: creating,
    		"data-modal-autofocus": "",
    		onChange: (event) => setName(event.target.value)
    	})), h("label", { className: "buka-robots-field" }, h("span", { className: "buka-robots-fieldLabel" }, t("descriptionLabel")), h("textarea", {
    		className: "buka-robots-descriptionInput",
    		value: draftDescription,
    		placeholder: t("descriptionPlaceholder"),
    		maxLength: 500,
    		rows: 2,
    		disabled: creating,
    		onChange: (event) => setDraftDescription(event.target.value)
    	}), h("span", { className: "buka-robots-fieldHint" }, t("descriptionHint"))), createError === null ? null : h("p", {
    		className: "buka-robots-formError",
    		role: "alert"
    	}, createError)));
    }
    /**
    * 更换头像对话框。
    *
    */
    function AvatarDialog({ t, state, detail }) {
    	const { avatarOpen, avatarSaving, avatarTarget, draftAvatar, setDraftAvatar, avatarError } = state;
    	const { closeAvatarDialog, saveAvatar } = detail;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: avatarOpen,
    		onClose: closeAvatarDialog,
    		title: avatarTarget === null ? t("changeAvatar") : `${t("changeAvatar")} · ${avatarTarget}`,
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeAvatarDialog,
    			disabled: avatarSaving
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "submit",
    			form: AVATAR_FORM_ID,
    			disabled: avatarSaving || avatarTarget === null
    		}, avatarSaving ? t("saving") : t("save")))
    	}, h("form", {
    		id: AVATAR_FORM_ID,
    		className: "buka-robots-dialogForm",
    		onSubmit: (event) => {
    			event.preventDefault();
    			saveAvatar();
    		}
    	}, h("div", { className: "buka-robots-avatarField" }, h("span", { className: "buka-robots-fieldLabel" }, t("chooseAvatar")), h(AvatarPicker, {
    		t,
    		current: draftAvatar,
    		disabled: avatarSaving,
    		onSelect: setDraftAvatar
    	})), avatarError === null ? null : h("p", {
    		className: "buka-robots-formError",
    		role: "alert"
    	}, avatarError)));
    }
    /**
    * 重命名机器人对话框。
    *
    */
    function RenameDialog({ t, state, detail }) {
    	const { renameOpen, renameSaving, selectedRobot, renameDraft, setRenameDraft, renameError } = state;
    	const { closeRenameDialog, renameRobot } = detail;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: renameOpen,
    		onClose: closeRenameDialog,
    		title: t("rename"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeRenameDialog,
    			disabled: renameSaving
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "submit",
    			form: RENAME_FORM_ID,
    			disabled: renameSaving || selectedRobot === null || renameDraft.trim() === "" || renameDraft.trim() === selectedRobot.name
    		}, renameSaving ? t("saving") : t("save")))
    	}, renameOpen && selectedRobot !== null ? h("form", {
    		id: RENAME_FORM_ID,
    		className: "buka-robots-dialogForm",
    		onSubmit: renameRobot
    	}, h("label", { className: "buka-robots-field" }, h("span", { className: "buka-robots-fieldLabel" }, t("renameFieldLabel")), h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		className: "buka-robots-fieldInput",
    		type: "text",
    		value: renameDraft,
    		placeholder: String(selectedRobot.name ?? ""),
    		autoComplete: "off",
    		spellCheck: false,
    		maxLength: 64,
    		disabled: renameSaving,
    		"data-modal-autofocus": "",
    		onChange: (event) => setRenameDraft(event.target.value)
    	})), h("p", { className: "buka-robots-fieldHint" }, t("renameHint")), renameError === null ? null : h("p", {
    		className: "buka-robots-formError",
    		role: "alert"
    	}, renameError)) : null);
    }
    // .build/robots/client/components/robot-list.js
    /**
    * 「机器人」列表：机器人卡片与列表状态。
    *
    * 列表不展示目录；每张卡片显示名称、驱动类型、skills / AGENTS.md / 挂载状态、
    * 一句职责与行内动作。整行点击进入详情，行内动作区自己挡住冒泡。
    *
    * program 型机器人（clock）只读：卡片展示驱动与职责，没有新会话 / 挂载 /
    * 删除 / 助理入口，也不进入配置视图。agent 型机器人可以标记 / 取消助理。
    *
    * @module @buka/dsh-plugin-robots/client/components/robot-list
    */
    /**
    * 一条机器人卡片：名称、驱动 / 助理 / skills / AGENTS.md / 挂载状态、职责与
    * 动作与删除确认。program 型机器人只读。
    *
    */
    function RobotCard({ t, robot, state, actions: robotActions }) {
    	const { confirming, setConfirming, busy, mutating, corrupt, openDetail } = state;
    	const { openRobot, mountRobot, removeRobot, toggleAssistant } = robotActions;
    	const skills = skillsOf(robot);
    	const agents = agentsOf(robot);
    	const program = isProgramRobot(robot);
    	const confirmingThis = confirming === robot.name;
    	const missing = !program && robot.exists === false;
    	const mounted = robot.mounted === true;
    	const anyBusy = mutating || corrupt;
    	const canOpen = !mutating && !program;
    	const actions = program ? [] : confirmingThis ? [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "confirm",
    		variant: "outline",
    		size: "sm",
    		className: "buka-robots-danger",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }),
    		disabled: anyBusy,
    		onClick: () => removeRobot(robot)
    	}, t("confirmDelete")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "cancel",
    		variant: "ghost",
    		size: "sm",
    		disabled: mutating,
    		onClick: () => setConfirming(null)
    	}, t("cancel"))] : [
    		h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "open",
    			variant: "outline",
    			size: "sm",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    			disabled: mutating,
    			"aria-label": `${t("newSession")} ${robot.name}`,
    			onClick: () => openRobot(robot)
    		}, t("newSession")),
    		mounted ? null : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "mount",
    			variant: "outline",
    			size: "sm",
    			icon: busy === `mount:${robot.name}` ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    				state: "ongoing",
    				size: 13
    			}) : h(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			"aria-label": `${t("mount")} ${robot.name}`,
    			onClick: () => mountRobot(robot)
    		}, busy === `mount:${robot.name}` ? t("mounting") : t("mount")),
    		h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "assistant",
    			variant: "outline",
    			size: "sm",
    			disabled: anyBusy || busy === `assistant:${robot.name}`,
    			"aria-label": `${robot.assistant === true ? t("clearAssistant") : t("setAssistant")} ${robot.name}`,
    			onClick: () => toggleAssistant(robot)
    		}, busy === `assistant:${robot.name}` ? t("saving") : robot.assistant === true ? t("clearAssistant") : t("setAssistant")),
    		h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "delete",
    			variant: "outline",
    			size: "sm",
    			className: "buka-robots-danger",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			"aria-label": `${t("delete")} ${robot.name}`,
    			onClick: () => setConfirming(robot.name)
    		}, t("delete"))
    	];
    	return h("li", {
    		className: `buka-robots-card${canOpen ? " is-clickable" : ""}${program ? " is-program" : ""}`,
    		key: robot.name,
    		"aria-busy": busy !== null ? true : void 0,
    		onClick: () => {
    			if (canOpen) openDetail(robot);
    		}
    	}, h("div", { className: "buka-robots-cardHead" }, h("div", { className: "buka-robots-titleRow" }, h("div", { className: "buka-robots-titleCluster" }, renderAvatar(robot.avatar, 26), h("button", {
    		type: "button",
    		className: "buka-robots-cardTitle",
    		title: robot.name,
    		"aria-label": `${t("openDetail")} ${robot.name}`,
    		disabled: !canOpen,
    		onClick: (event) => {
    			event.stopPropagation();
    			if (canOpen) openDetail(robot);
    		}
    	}, String(robot.name ?? "")), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: program ? "info" : "neutral" }, program ? t("driverProgram") : t("driverAgent")), robot.assistant === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "success" }, t("assistantBadge")) : null, program ? null : h(MountedTag, {
    		t,
    		robot
    	}), program ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, countBadge(skills.length, t)), program ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: agents.exists ? "success" : "neutral" }, agents.exists ? t("agentsBadge") : t("noAgentsBadge")), missing ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, t("missingDir")) : null), h("div", {
    		className: "buka-robots-titleActions",
    		onClick: (event) => event.stopPropagation()
    	}, ...actions.filter(Boolean))), typeof robot.description === "string" && robot.description !== "" ? h("p", { className: "buka-robots-cardDesc" }, robot.description) : null, program ? h("p", { className: "buka-robots-hint" }, t("programReadOnly")) : null, missing ? h("p", { className: "buka-robots-hint" }, t("missingDirHint")) : null, confirmingThis ? h("p", { className: "buka-robots-hint" }, t("deleteHint")) : null));
    }
    /** 列表页：登记文件提示、加载 / 失败 / 空状态与机器人卡片（不展示目录）。 */
    function RobotList({ t, state, actions }) {
    	const { corrupt, registry, list, data, robots, assistantOnly } = state;
    	const visible = assistantOnly ? robots.filter((robot) => robot.assistant === true) : robots;
    	const corruptNotice = corrupt ? h("p", {
    		className: "buka-robots-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("corruptNote"), " ", h("code", { className: "buka-robots-inlineCode" }, registry))) : null;
    	return h("div", { className: "buka-robots-pageBody" }, corruptNotice, list.error === null ? null : h("p", {
    		className: "buka-robots-failure",
    		role: "alert"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), `${t("loadFailed")} ${list.error}`), list.loading && data === null ? h("p", {
    		className: "buka-robots-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")) : null, data === null ? null : visible.length === 0 && !list.loading && !corrupt ? h("p", { className: "buka-robots-empty" }, assistantOnly ? t("assistantEmpty") : t("empty")) : h("ul", { className: "buka-robots-cards" }, ...visible.map((robot) => h(RobotCard, {
    		t,
    		robot,
    		state,
    		actions,
    		key: robot.name
    	}))));
    }
    // .build/robots/client/components/robots-page.js
    /**
    * 侧边栏「机器人」页面。
    *
    * 页面只保存 UI 状态；机器人列表（登记表）来自 Host 的 `/buka-robots/list`，
    * 挂载 / 摘除 / 打开工作区则通过注入的 `getService` 取 DSH 的 Client
    * Service，两者都失败时用 Toast 说明原因。
    *
    * 本文件只做装配：状态在 `state.ts`，动作在 `actions/`，各视图与对话框在
    * `components/`。
    *
    * @module @buka/dsh-plugin-robots/client/components/robots-page
    */
    /**
    * 侧边栏「机器人」页面。
    *
    */
    function RobotsPage(props) {
    	const t = props.t;
    	const state = useRobotsState({ getService: typeof props.getService === "function" ? props.getService : () => null });
    	const actions = createRobotActions(state, t);
    	const detail = createDetailActions(state, t);
    	const skillActions = createSkillActions(state, t);
    	const { selectedRobot, notice, setNotice } = state;
    	return h("div", { className: "buka-robots-page" }, h(PageHeader, {
    		t,
    		state,
    		actions,
    		detail
    	}), h("div", { className: "buka-robots-body" }, selectedRobot === null ? h(RobotList, {
    		t,
    		state,
    		actions
    	}) : h(RobotDetail, {
    		t,
    		robot: selectedRobot,
    		state,
    		actions,
    		detailActions: detail,
    		skillActions
    	})), notice === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Toast, {
    		key: notice.seq,
    		text: notice.text,
    		tone: notice.kind === "success" ? "success" : void 0,
    		icon: notice.kind === "success" ? void 0 : h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
    		holdMs: 3200,
    		onDone: () => setNotice(null)
    	}), h(CreateRobotDialog, {
    		t,
    		state,
    		actions
    	}), h(AvatarDialog, {
    		t,
    		state,
    		detail
    	}), h(RenameDialog, {
    		t,
    		state,
    		detail
    	}), h(InstallSkillsModal, {
    		t,
    		state,
    		skillActions
    	}));
    }
    // .build/robots/client/i18n.js
    /**
    * 「机器人」页面的英文与简体中文词典。
    *
    * @module @buka/dsh-plugin-robots/client/i18n
    */
    /** 英文文案。 */
    const en = {
    	panel: "Robots",
    	title: "Robots",
    	refresh: "Refresh",
    	loading: "Loading…",
    	loadFailed: "Request failed:",
    	empty: "No robots yet. Creating one adds a directory in the plugin folder and mounts it to the sidebar workspace list.",
    	corruptNote: "The robot registry cannot be read. Fix or delete the file, then refresh:",
    	createPlaceholder: "Robot name, e.g. writer",
    	createFieldName: "Robot name",
    	create: "Create robot",
    	close: "Close",
    	creating: "Creating…",
    	avatar: "Avatar",
    	chooseAvatar: "Choose an avatar",
    	changeAvatar: "Change avatar",
    	avatarUpdated: "Avatar updated.",
    	avatarSaveFailed: "Could not update the avatar:",
    	descriptionLabel: "Responsibilities",
    	descriptionPlaceholder: "e.g. Turns meeting notes into a three-point summary",
    	descriptionHint: "Workflows read this line to decide whether to hand a node to this robot. State in one sentence what the robot is responsible for.",
    	tabDescription: "Responsibilities",
    	descriptionSaved: "Responsibilities saved.",
    	descriptionSaveFailed: "Could not save the responsibilities:",
    	created: "Created robot:",
    	createExisting: "Robot already existed:",
    	createFailed: "Could not create the robot:",
    	createMountFailed: "The robot was created, but mounting it to a workspace failed. Use “Mount” to retry:",
    	createEmpty: "Enter a robot name first.",
    	rename: "Rename robot",
    	renameLabel: "Rename",
    	renameFieldLabel: "New name",
    	renameHint: "Renaming moves the robot directory and re-creates the DSH workspace. Earlier conversations are kept, but they are no longer listed under this robot.",
    	renameEmpty: "Enter a new name first.",
    	renameSame: "The new name is the same as the current name.",
    	renameSaveFailed: "Could not rename the robot:",
    	renamed: "Renamed robot:",
    	newSession: "New session",
    	reveal: "Open in Finder",
    	revealFailed: "Could not open the folder:",
    	openFailed: "Could not open the robot:",
    	openUnmounted: "This robot is not mounted to a workspace yet. Click “Mount” first.",
    	openDetail: "Open details",
    	mount: "Mount",
    	mounting: "Mounting…",
    	mounted: "Mounted to a workspace:",
    	mountFailed: "Could not mount the robot:",
    	delete: "Delete",
    	confirmDelete: "Confirm delete",
    	cancel: "Cancel",
    	deleted: "Removed robot:",
    	deleteFailed: "Could not remove the robot:",
    	deleteHint: "Only the plugin record and the workspace registration are removed. The robot directory and files are kept.",
    	skillsBadge: "{n} skills",
    	agentsBadge: "AGENTS.md",
    	noAgentsBadge: "No AGENTS.md",
    	mountedBadge: "Mounted",
    	unmountedBadge: "Not mounted",
    	driverAgent: "Agent",
    	driverProgram: "Program",
    	assistantBadge: "Assistant",
    	setAssistant: "Make assistant",
    	clearAssistant: "Stop being assistant",
    	assistantSet: "This robot is now an assistant.",
    	assistantCleared: "This robot is no longer an assistant.",
    	assistantSaveFailed: "Could not change the assistant flag:",
    	filterAssistants: "Assistants only",
    	showAllRobots: "All robots",
    	assistantEmpty: "No robot is marked as an assistant yet.",
    	programReadOnly: "Program robots are driven by the plugin: they have no directory and cannot be opened, edited or installed with skills.",
    	missingDir: "Missing directory",
    	missingDirHint: "This robot directory no longer exists. You can delete the record and create it again.",
    	missingDirDetail: "This robot directory no longer exists, so skills and AGENTS.md operations will fail.",
    	back: "Back to robots",
    	tabsLabel: "Robot detail sections",
    	tabAgents: "AGENTS.md",
    	tabSkills: "Skills",
    	skillsTitle: "Installed skills",
    	skillsIntroBefore: "Project-level skills are installed with ",
    	skillsIntroMiddle: " into ",
    	skillsIntroAfter: " (plus a Claude Code link in .claude/skills).",
    	sourcePlaceholder: "Source, e.g. vercel-labs/agent-skills",
    	installSkills: "Install skills",
    	installDialogTitle: "Install skills",
    	installSourceLabel: "Source",
    	loadSkills: "List skills",
    	loadingSkills: "Reading skills…",
    	installIdle: "Enter a source, or pick a repository from the Skills favourites, then list its skills.",
    	skillsFound: "{n} skills available",
    	selectAllSkills: "Select all",
    	selectedSkills: "Selected {n} of {m}",
    	alreadyInstalled: "Installed",
    	installedHint: "Skills that are already installed cannot be selected.",
    	installSelected: "Install selected",
    	installSelectedCount: "Install {n}",
    	installingSkills: "Installing {n}…",
    	installEmptySelection: "Select at least one skill.",
    	favouritesLabel: "Skills favourites",
    	favouritesEmpty: "No favourite repositories in the Skills plugin yet.",
    	errAvailableFailed: "Could not read the skill list:",
    	errListUnparsed: "Could not read a skill list from this source. See the command output below.",
    	errInvalidSkills: "Select valid skills.",
    	skillInstalled: "Installed skill from:",
    	removeSkill: "Remove",
    	confirmRemoveSkill: "Confirm remove",
    	removing: "Removing…",
    	skillRemoved: "Removed skill:",
    	skillsEmpty: "No project-level skills are installed in this robot yet.",
    	skillErrorTitle: "The skills command failed:",
    	outputLabel: "Command output",
    	agentsTitle: "AGENTS.md",
    	agentsEditorLabel: "AGENTS.md content",
    	agentsPlaceholder: "# AGENTS.md",
    	agentsMissingHint: "This robot has no AGENTS.md yet. Saving creates it.",
    	agentsTooLarge: "The file is larger than 256 KiB. Edit it with an external editor.",
    	save: "Save",
    	saving: "Saving…",
    	agentsSaved: "Saved AGENTS.md.",
    	agentsSaveFailed: "Could not save AGENTS.md:",
    	noWorkspacesCreate: "This client has no workspaces service, so the robot cannot be mounted to the workspace list.",
    	noWorkspacesDelete: "This client has no workspaces service, so the workspace registration cannot be removed.",
    	noUiWorkspace: "This client has no uiWorkspace service, so the robot conversation cannot be opened.",
    	avatarSprout: "Sprout",
    	avatarSun: "Sun",
    	avatarCat: "Cat",
    	avatarFox: "Fox",
    	avatarPanda: "Panda",
    	avatarOwl: "Owl",
    	avatarWhale: "Whale",
    	avatarOctopus: "Octopus",
    	avatarBee: "Bee",
    	avatarRocket: "Rocket",
    	avatarDino: "Dino",
    	avatarGhost: "Ghost",
    	avatarPenguin: "Penguin",
    	avatarUnicorn: "Unicorn",
    	avatarMushroom: "Mushroom",
    	errInvalidName: "Invalid name: use 1–64 characters, do not start with a dot, and avoid slashes.",
    	errInvalidAvatar: "That avatar is not available. Pick one from the list.",
    	errNotDirectory: "A file already exists at that path, so no directory could be created.",
    	errUnknownRobot: "This robot is no longer in the registry. Refresh and try again.",
    	errNameTaken: "That name is already taken. Pick another one.",
    	errInvalidUpdate: "This request is missing the update flag, so the name was not changed.",
    	errPathOutsideRoot: "The robot directory is outside the robots folder, so it cannot be renamed. Fix the registry entry first.",
    	errMissingDirectory: "The robot directory does not exist, so this operation cannot run.",
    	errRegistryUnreadable: "The robot registry cannot be read, so this change was cancelled. Fix or delete the file, then refresh.",
    	errProgramRobot: "Program robots are read-only: they have no directory or session, so this change is not available.",
    	errBuiltinRobot: "Built-in robots cannot be created, changed or removed.",
    	errInvalidAssistant: "The assistant flag must be true or false.",
    	errInvalidDriver: "Only agent robots can be created; program robots are built into the plugin.",
    	errTooLarge: "AGENTS.md is larger than 512 KiB and cannot be saved.",
    	errInvalidContent: "The AGENTS.md content must be text.",
    	errInvalidSource: "Invalid source. Use an npx skills source such as owner/repo.",
    	errInvalidSkill: "Invalid skill name.",
    	errNpxFailed: "npx skills failed. See the command output below."
    };
    /** 简体中文文案。 */
    const zh = {
    	panel: "机器人",
    	title: "机器人",
    	refresh: "刷新",
    	loading: "正在读取…",
    	loadFailed: "请求失败：",
    	empty: "还没有机器人。创建机器人会在插件目录下新建目录，并挂到侧边栏的工作区列表。",
    	corruptNote: "机器人登记文件无法读取，请修复或删除该文件后刷新：",
    	createPlaceholder: "机器人名称，如 writer",
    	createFieldName: "机器人名称",
    	create: "创建机器人",
    	close: "关闭",
    	creating: "创建中…",
    	avatar: "头像",
    	chooseAvatar: "选择头像",
    	changeAvatar: "更换头像",
    	avatarUpdated: "已更换头像。",
    	avatarSaveFailed: "更换头像失败：",
    	descriptionLabel: "职责",
    	descriptionPlaceholder: "例如：负责把会议记录整理成三点结论",
    	descriptionHint: "工作流会读它来决定是否把节点交给这个机器人；用一句话写清这个机器人负责什么。",
    	tabDescription: "职责",
    	descriptionSaved: "职责已保存。",
    	descriptionSaveFailed: "保存职责失败：",
    	created: "已创建机器人：",
    	createExisting: "机器人已存在：",
    	createFailed: "创建失败：",
    	createMountFailed: "机器人已创建，但挂载到工作区失败，可点「挂载」重试：",
    	createEmpty: "先填一个机器人名称。",
    	rename: "重命名机器人",
    	renameLabel: "重命名",
    	renameFieldLabel: "新名称",
    	renameHint: "重命名会改机器人目录名并重建 DSH 工作区；已有会话仍保留，但不再列在这个机器人下。",
    	renameEmpty: "先填一个新名称。",
    	renameSame: "新名称与当前名称相同。",
    	renameSaveFailed: "重命名失败：",
    	renamed: "已重命名为：",
    	newSession: "新会话",
    	reveal: "打开 Finder",
    	revealFailed: "打开文件夹失败：",
    	openFailed: "打开失败：",
    	openUnmounted: "这个机器人还没有挂载到工作区，先点「挂载」。",
    	openDetail: "打开详情",
    	mount: "挂载",
    	mounting: "挂载中…",
    	mounted: "已挂载到工作区：",
    	mountFailed: "挂载失败：",
    	delete: "删除",
    	confirmDelete: "确认删除",
    	cancel: "取消",
    	deleted: "已移除机器人：",
    	deleteFailed: "移除失败：",
    	deleteHint: "只移除插件记录与工作区注册；机器人目录、文件保留。",
    	skillsBadge: "{n} skills",
    	agentsBadge: "AGENTS.md",
    	noAgentsBadge: "无 AGENTS.md",
    	mountedBadge: "已挂载",
    	unmountedBadge: "未挂载",
    	driverAgent: "Agent 型",
    	driverProgram: "程序型",
    	assistantBadge: "助理",
    	setAssistant: "设为助理",
    	clearAssistant: "取消助理",
    	assistantSet: "已设为助理。",
    	assistantCleared: "已取消助理。",
    	assistantSaveFailed: "修改助理标记失败：",
    	filterAssistants: "只看助理",
    	showAllRobots: "全部机器人",
    	assistantEmpty: "还没有标记为助理的机器人。",
    	programReadOnly: "program 机器人由插件驱动：没有目录，不能开会话、编辑或安装 skills。",
    	missingDir: "目录缺失",
    	missingDirHint: "这个机器人目录已经不存在了，可以删除记录后重新创建。",
    	missingDirDetail: "这个机器人目录已经不存在了，skills 与 AGENTS.md 操作都会失败。",
    	back: "返回机器人列表",
    	tabsLabel: "机器人详情页签",
    	tabAgents: "AGENTS.md",
    	tabSkills: "技能",
    	skillsTitle: "已安装 skills",
    	skillsIntroBefore: "项目级 skills 通过 ",
    	skillsIntroMiddle: " 安装到 ",
    	skillsIntroAfter: "（并给 Claude Code 建 .claude/skills 链接）。",
    	sourcePlaceholder: "来源，如 vercel-labs/agent-skills",
    	installSkills: "安装 skills",
    	installDialogTitle: "安装 skills",
    	installSourceLabel: "来源",
    	loadSkills: "读取 skills",
    	loadingSkills: "正在读取 skills…",
    	installIdle: "填一个来源，或从 Skills 收藏夹里选一个仓库，然后读取其中的 skills。",
    	skillsFound: "共 {n} 个 skills",
    	selectAllSkills: "全选",
    	selectedSkills: "已选 {n} / {m}",
    	alreadyInstalled: "已安装",
    	installedHint: "已安装的 skill 不能重复勾选。",
    	installSelected: "安装选中的",
    	installSelectedCount: "安装 {n} 个",
    	installingSkills: "正在安装 {n} 个…",
    	installEmptySelection: "至少选一个 skill。",
    	favouritesLabel: "Skills 收藏夹",
    	favouritesEmpty: "Skills 插件里还没有收藏仓库。",
    	errAvailableFailed: "读取 skill 清单失败：",
    	errListUnparsed: "无法从这个来源读出 skill 清单，命令输出见下方。",
    	errInvalidSkills: "skills 不合法。",
    	skillInstalled: "已安装 skill：",
    	removeSkill: "移除",
    	confirmRemoveSkill: "确认移除",
    	removing: "移除中…",
    	skillRemoved: "已移除 skill：",
    	skillsEmpty: "这个机器人还没有安装项目级 skills。",
    	skillErrorTitle: "skills 命令执行失败：",
    	outputLabel: "命令输出",
    	agentsTitle: "AGENTS.md",
    	agentsEditorLabel: "AGENTS.md 内容",
    	agentsPlaceholder: "# AGENTS.md",
    	agentsMissingHint: "这个机器人还没有 AGENTS.md，保存会新建它。",
    	agentsTooLarge: "文件超过 256 KiB，请用外部编辑器修改。",
    	save: "保存",
    	saving: "保存中…",
    	agentsSaved: "已保存 AGENTS.md。",
    	agentsSaveFailed: "保存 AGENTS.md 失败：",
    	noWorkspacesCreate: "当前客户端没有 workspaces 服务，无法把机器人挂载到工作区列表。",
    	noWorkspacesDelete: "当前客户端没有 workspaces 服务，无法移除工作区注册。",
    	noUiWorkspace: "当前客户端没有 uiWorkspace 服务，无法打开机器人会话。",
    	avatarSprout: "嫩芽",
    	avatarSun: "太阳",
    	avatarCat: "小猫",
    	avatarFox: "狐狸",
    	avatarPanda: "熊猫",
    	avatarOwl: "猫头鹰",
    	avatarWhale: "鲸鱼",
    	avatarOctopus: "章鱼",
    	avatarBee: "蜜蜂",
    	avatarRocket: "火箭",
    	avatarDino: "恐龙",
    	avatarGhost: "幽灵",
    	avatarPenguin: "企鹅",
    	avatarUnicorn: "独角兽",
    	avatarMushroom: "蘑菇",
    	errInvalidName: "名称不合法：1–64 个字符，不能以 . 开头，不能包含斜杠。",
    	errInvalidAvatar: "这个头像不可用，请从列表里重新选一个。",
    	errNotDirectory: "目标路径已存在且不是目录，无法创建。",
    	errUnknownRobot: "这个机器人已不在登记表里，请刷新后重试。",
    	errNameTaken: "这个名称已被占用，请换一个。",
    	errInvalidUpdate: "请求缺少 update 标记，名称未修改。",
    	errPathOutsideRoot: "机器人目录不在机器人根目录下，无法重命名；请先修复登记表。",
    	errMissingDirectory: "机器人目录不存在，无法执行这个操作。",
    	errRegistryUnreadable: "机器人登记文件无法读取，本次修改已取消；请修复或删除该文件后刷新。",
    	errProgramRobot: "program 机器人只读：没有目录与会话，不能执行这个操作。",
    	errBuiltinRobot: "内建机器人不可创建、修改或删除。",
    	errInvalidAssistant: "助理标记必须是 true 或 false。",
    	errInvalidDriver: "只能创建 agent 型机器人；program 型机器人由插件内建。",
    	errTooLarge: "AGENTS.md 超过 512 KiB，无法保存。",
    	errInvalidContent: "AGENTS.md 内容必须是文本。",
    	errInvalidSource: "来源不合法：请填 owner/repo 这类 npx skills 来源。",
    	errInvalidSkill: "skill 名称不合法。",
    	errNpxFailed: "npx skills 执行失败，输出见下方。"
    };
    // .build/robots/client/styles.js
    /**
    * 「机器人」页面的样式。
    *
    * 结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片列表），颜色与
    * 尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
    *
    * @module @buka/dsh-plugin-robots/client/styles
    */
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
    .buka-robots-card.is-clickable{cursor:pointer}
    @media (hover:hover){.buka-robots-card.is-clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-robots-card.is-clickable:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-robots-cardHead{flex-direction:column;gap:6px;padding:8px;display:flex}
    .buka-robots-titleRow{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}
    .buka-robots-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
    .buka-robots-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap;justify-content:flex-end}
    .buka-robots-cardTitle{box-sizing:border-box;min-width:0;max-width:100%;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:14px;font-weight:500;line-height:20px;text-align:left;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
    .buka-robots-cardTitle:disabled{cursor:default}
    .buka-robots-cardTitle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm)}
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
    `;
    // .build/robots/client/index.js
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
    * - 列表视图：按 `driver` 展示驱动标签（agent / program），agent 型机器人可标记
    *   / 取消助理，列表可按助理筛选。整行点击（或点机器人名 / 键盘 Tab 到标题）
    *   进入详情，行内动作是「新会话 / 挂载 / 设为助理 / 删除」。删除先摘掉工作区
    *   注册、再删插件记录，目录与文件保留；登记文件损坏时只允许刷新，新建/删除/
    *   挂载都会禁用。列表**不展示目录**（机器人根目录与各机器人路径都只在详情页
    *   出现）；每张卡片显示机器人的一行描述（工作流靠它决定是否选用该机器人）；
    *   标题行「刷新」右侧的「创建机器人」按钮打开对话框填名称与描述后提交；全新
    *   安装时插件会自动补上「软件工程师」与「质量保障工程师」两个预设机器人。
    *   program 型机器人（内建 clock）只读：卡片展示驱动与描述，没有新会话 / 挂载 /
    *   删除 / 助理入口，也不能编辑 AGENTS.md 或安装 skills；
    * - 配置视图：标题左侧的返回按钮回到列表，右侧是「新会话 / 打开 Finder / 刷新」；
    *   机器人名旁的铅笔按钮打开「重命名机器人」对话框：改的是机器人目录名，Host 会
    *   在新路径重建 DSH 工作区，已有会话日志保留但不再列在这个机器人下。正文用
    *   可切换的页签分成
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
    * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
    * 那层外壳由构建脚本 `scripts/build-clients.ts` 在构建时生成，源码里不写死包名。
    * 模块顶层只有纯声明（常量、文案、样式、辅助函数），不注册插槽、不发请求、
    * 不碰 DOM；所有副作用都在 `apply(ctx)` 里。
    */
    const inject = ["slots", "locale"];
    /**
    * 注册侧边栏条目与主面板页面，并在插件生效期注入文案与样式。
    */
    function apply(ctx) {
    	const t = ctx.locale.bind(NS);
    	/**
    	* 页面从插件上下文里取 DSH 的 Client Service。`ctx.get` 在服务不存在
    	* 时会抛错，这里统一收敛成 null，由页面给出可读提示。
    	*
    	*/
    	function getService(serviceName) {
    		try {
    			return ctx.get(serviceName) ?? null;
    		} catch {
    			return null;
    		}
    	}
    	ctx.effect(() => ctx.locale.register(NS, {
    		zh,
    		en
    	}), "buka-robots: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-robots";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-robots: styles");
    	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    		name: "sidebar.panellist",
    		id: PANEL_ID,
    		order: 30,
    		label: () => t("panel"),
    		locale: NS
    	}, RobotsPanelIcon));
    	ctx.slots.inject("main", () => ctx.slots.register({
    		name: "main",
    		key: PANEL_ID,
    		locale: NS,
    		inject: () => ({ getService })
    	}, RobotsPage));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
