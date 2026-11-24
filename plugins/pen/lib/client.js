window.__ModuleLoader__.load({
  id: "@buka/dsh-plugin-pen",
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
    // .build/pen/client/dictionary.js
    /**
    * 勾选框与会话标题标记的文案。
    *
    * 两处可见文字都是品牌名，不做翻译：勾选框是「Pen」（前面是 Pen 的 logo，见
    * `logo.ts`），会话标题旁是「Pen MCP」。只有 tooltip 的说明随 DSH 的界面
    * 语言切换。
    *
    * @module @buka/dsh-plugin-pen/client/dictionary
    */
    /** 界面文案的命名空间；插槽的 `locale` 与 `ctx.locale.bind` 共用它。 */
    const NS = "buka-pen";
    /** 会话标题旁标记的文字：同样是不翻译的品牌名。 */
    const MARK_LABEL = "Pen MCP";
    /** 中文文案。 */
    const zh = {
    	hint: "勾选后，这个会话会加载 Pen（pen.dev）的 MCP 工具；不勾选则完全不启动 Pen MCP。",
    	hintPending: "会话开始后自动连接 Pen MCP。",
    	hintConnecting: "正在连接 Pen MCP…",
    	hintReady: "这个会话已加载 Pen MCP 工具（mcp__pencil__*）。",
    	hintFailed: "Pen MCP 连接失败："
    };
    /** 英文文案。 */
    const en = {
    	hint: "When checked, this session loads the Pen (pen.dev) MCP tools. Unchecked, no Pen MCP server is started at all.",
    	hintPending: "Pen MCP connects when the session starts.",
    	hintConnecting: "Connecting to Pen MCP…",
    	hintReady: "This session has the Pen MCP tools (mcp__pencil__*).",
    	hintFailed: "Could not connect to Pen MCP: "
    };
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
    	},
    	{
    		id: "robot",
    		emoji: "🤖",
    		color: "#2F80ED",
    		labelKey: "avatarRobot"
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
    // .build/pen/client/api.js
    /**
    * 与 Host 一半的 HTTP 接口。
    *
    * 浏览器只读状态、发勾选：挂载与卸载 pen MCP 全在 Host 完成。路由常量与
    * `src/routes.ts` 保持一致。
    *
    * @module @buka/dsh-plugin-pen/client/api
    */
    /** 与 Host 一致的读状态路由。 */
    const STATE_ROUTE = "/buka-pen/state";
    /** 与 Host 一致的勾选路由。 */
    const TOGGLE_ROUTE = "/buka-pen/toggle";
    /**
    * 把响应体收成快照；`message` 只在存在时带上，满足可选字段的严格类型。
    */
    function snapshotOfBody(body) {
    	return {
    		enabled: body.enabled,
    		status: body.status,
    		...typeof body.message === "string" ? { message: body.message } : {}
    	};
    }
    /**
    * 读一个会话的 pen 状态。
    *
    * @param sessionId 会话 id
    * @returns 当前快照
    */
    async function readPenState(sessionId) {
    	return snapshotOfBody(await requestJson(`${STATE_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`));
    }
    /**
    * 勾选或取消勾选。
    *
    * @param sessionId 会话 id
    * @param enabled 是否启用
    * @returns 操作后的快照
    */
    async function setPenEnabled(sessionId, enabled) {
    	return snapshotOfBody(await requestJson(TOGGLE_ROUTE, {
    		method: "POST",
    		body: JSON.stringify({
    			sessionId,
    			enabled
    		})
    	}));
    }
    // .build/pen/client/mark.js
    /**
    * 会话标题右侧的「Pen MCP」标记：标识这条会话已开启 Pen。
    *
    * 插槽 `conversation.session.header.actions` 紧挨在标题之后、官方工具按钮之前，
    * 是「标题右侧」这个位置。标记只在**该会话**勾选过 Pen 时出现；插件没启用时
    * 浏览器一半根本不会加载，所以「插件开着」这条不需要额外判断。
    *
    * 显示成一行普通文字（官方描边图标 + 品牌名），不做胶囊、不加悬浮提示：它只
    * 回答「这条会话开没开 Pen」。勾选只发生在空会话，会话开始后勾选框不再出现，
    * 所以状态不会在标记挂载后再变，读一次 Host 状态就够了。
    *
    * @module @buka/dsh-plugin-pen/client/mark
    */
    /** 图标边长（像素），与 12px 文字放在一行里。 */
    const ICON_SIZE = 14;
    /**
    * 渲染标题旁的 Pen MCP 标记；会话没开启 Pen 时不占位置。
    *
    * @param props 会话 id
    * @returns 标记，或 null
    */
    function PenMark({ sessionId }) {
    	const [snapshot, setSnapshot] = (0, react.useState)(null);
    	(0, react.useEffect)(() => {
    		if (sessionId === void 0) {
    			setSnapshot(null);
    			return;
    		}
    		let live = true;
    		readPenState(sessionId).then((next) => {
    			if (live) setSnapshot(next);
    		}).catch(() => {
    			if (live) setSnapshot(null);
    		});
    		return () => {
    			live = false;
    		};
    	}, [sessionId]);
    	if (sessionId === void 0 || snapshot?.enabled !== true) return null;
    	return h("span", { className: "buka-pen-mark" }, h(_deepseek_ai_dsh_client_ui_primitives.IconListPenOutlineRegular, {
    		size: ICON_SIZE,
    		className: "buka-pen-mark-icon"
    	}), MARK_LABEL);
    }
    // .build/pen/client/styles.js
    /**
    * 勾选框与标题标记的样式。
    *
    * 勾选框的尺寸、颜色与 hover / focus 行为照抄 DSH 新会话行的官方 worktree
    * 勾选框（13px / 28px 高、14px 复选框、`--dsw-*` 主题变量），保证两种配色下
    * 都跟旁边的控件对齐。标题标记照抄会话标题行里的次级信息（12px、第三级文字
    * 颜色、4px 图标间距），和标题、官方动作按钮排在同一行。
    *
    * @module @buka/dsh-plugin-pen/client/styles
    */
    /** 注入到 `document.head` 的样式表。 */
    const CSS = `.buka-pen-root{flex:none;align-items:center;gap:2px;min-width:0;display:inline-flex}
    .buka-pen-toggle{border-radius:var(--dsw-radius-sm);min-width:0;height:28px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
    @media (hover:hover){.buka-pen-toggle:hover:not([data-disabled]){background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-pen-toggle[data-disabled]{color:var(--dsw-alias-label-dimmed);cursor:default}
    .buka-pen-brand{align-items:center;gap:4px;min-width:0;display:inline-flex}
    .buka-pen-logo{width:12px;height:auto;flex:none;display:block;object-fit:contain}
    .buka-pen-toggle:has(.buka-pen-checkbox:focus-visible){outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .buka-pen-checkbox{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:inherit;flex:none;margin:0}
    .buka-pen-checkbox:focus-visible{outline:none}
    .buka-pen-warning{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:700;line-height:1}
    .buka-pen-mark{flex:none;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px;font-weight:500;line-height:18px;display:inline-flex}
    .buka-pen-mark-icon{flex:none;display:block}
    `;
    // .build/pen/client/logo.js
    /**
    * Pen 标记：透明背景的银色笔尖，显示在勾选框文字前。
    *
    * 源图是用户提供的 Pen logo，裁切为 64×77 后内联成 data URL。这样浏览器一半
    * 不依赖额外的静态资源路由，刷新页面即可显示；`assets/pen-logo.png` 保留同
    * 一份文件，便于以后替换。
    *
    * @module @buka/dsh-plugin-pen/client/logo
    */
    /** 内联的 Pen 标记（PNG data URL）。 */
    const PEN_LOGO = "data:image/png;base64,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";
    // .build/pen/client/toggle.js
    /**
    * 新会话行右上角的「Pen」勾选框。
    *
    * 插槽 `conversation.hero.options` 只在有会话（包括还没发消息的空会话）时
    * 渲染，正好是用户决定「这条会话要不要 pen」的位置。勾选状态存在 Host：
    * 组件挂载时读一次，点击时写一次；写操作返回的新快照直接替换本地状态。
    *
    * 可见文字固定为 `{logo} Pen`：前面是内联的 Pen 标记，后面是品牌名，不做
    * 翻译；tooltip 才随界面语言切换。
    *
    * 勾选时 Agent 往往还没创建（空会话），Host 会记住会话 id，等
    * `agent/created` 再挂载 MCP；所以这里显示 `pending` 是正常状态，不是失败。
    *
    * @module @buka/dsh-plugin-pen/client/toggle
    */
    /** 根据状态给出 tooltip。 */
    function hintOf(status, snapshot, t) {
    	if (status === "error") {
    		const message = snapshot?.message ?? "";
    		return message === "" ? t("hintFailed") : `${t("hintFailed")} ${message}`;
    	}
    	if (snapshot?.enabled !== true) return t("hint");
    	if (status === "ready") return t("hintReady");
    	if (status === "connecting") return t("hintConnecting");
    	return t("hintPending");
    }
    /**
    * 渲染勾选框；没有会话 id 时不显示。
    *
    * @param props 会话 id 与翻译函数
    * @returns 勾选框，或 null
    */
    function PenToggle({ sessionId, t }) {
    	const [snapshot, setSnapshot] = (0, react.useState)(null);
    	const [busy, setBusy] = (0, react.useState)(false);
    	(0, react.useEffect)(() => {
    		if (sessionId === void 0) return void 0;
    		let live = true;
    		readPenState(sessionId).then((next) => {
    			if (live) setSnapshot(next);
    		}).catch(() => {
    			if (live) setSnapshot(null);
    		});
    		return () => {
    			live = false;
    		};
    	}, [sessionId]);
    	if (sessionId === void 0) return null;
    	const enabled = snapshot?.enabled === true;
    	const status = busy ? "connecting" : snapshot?.status ?? "idle";
    	const hint = hintOf(status, snapshot, t);
    	const change = (event) => {
    		const checked = event.currentTarget.checked;
    		setBusy(true);
    		setSnapshot(checked ? {
    			enabled: true,
    			status: "connecting"
    		} : {
    			enabled: false,
    			status: "idle"
    		});
    		setPenEnabled(sessionId, checked).then((next) => {
    			setSnapshot(next);
    		}).catch((error) => {
    			setSnapshot({
    				enabled: !checked,
    				status: "error",
    				message: messageOf(error)
    			});
    		}).finally(() => {
    			setBusy(false);
    		});
    	};
    	return h("span", { className: "buka-pen-root" }, h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: hint,
    		side: "bottom",
    		delayMs: 500
    	}, h("label", {
    		className: "buka-pen-toggle",
    		"data-disabled": busy ? "" : void 0
    	}, h("input", {
    		type: "checkbox",
    		className: "buka-pen-checkbox",
    		checked: enabled,
    		disabled: busy,
    		onChange: change
    	}), h("span", { className: "buka-pen-brand" }, h("img", {
    		className: "buka-pen-logo",
    		src: PEN_LOGO,
    		alt: "",
    		"aria-hidden": "true",
    		draggable: false
    	}), "Pen"))), status === "error" ? h("span", { className: "buka-pen-warning" }, "!") : null);
    }
    // .build/pen/client/index.js
    /**
    * `@buka/dsh-plugin-pen` 的浏览器一半：新会话行里的「Pen」勾选框，以及会话
    * 标题右侧的「Pen MCP」标记。
    *
    * 注册两个插槽：
    *
    * - `conversation.hero.options`——官方 worktree 勾选框就在这里，位置在新会话框
    *   右上角、工作区与预设控件之后；只在空会话（新会话）阶段出现。
    * - `conversation.session.header.actions`——紧挨会话标题的右侧、官方工具按钮
    *   之前；标记只在这一会话勾选过 Pen 时显示，补上「会话开始后看不到勾选框」
    *   的信息缺口。
    *
    * 勾选框在 `toggle.ts`，标题标记在 `mark.ts`，请求在 `api.ts`，文案在
    * `dictionary.ts`，样式在 `styles.ts`。
    *
    * 本文件只导出 `inject` 与 `apply`；`window.__ModuleLoader__.load(...)` 外壳
    * 由构建脚本生成。
    *
    * @module @buka/dsh-plugin-pen/client
    */
    /** 浏览器一半依赖的客户端服务。 */
    const inject = ["slots", "locale"];
    /**
    * 注册词典、样式、勾选框与标题标记。
    *
    * @param ctx 浏览器插件上下文
    */
    function apply(ctx) {
    	ctx.effect(() => ctx.locale.register(NS, {
    		zh,
    		en
    	}), "buka-pen: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-pen";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-pen: styles");
    	ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({
    		name: "conversation.hero.options",
    		id: "buka-pen",
    		order: 20,
    		label: () => "Pen",
    		locale: NS
    	}, PenToggle));
    	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    		name: "conversation.session.header.actions",
    		id: "buka-pen-mark",
    		order: 10,
    		label: () => MARK_LABEL
    	}, PenMark));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
