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
    /** 会话标题旁标记的文字：同样是不翻译的品牌名。 */
    const MARK_LABEL = "Pen MCP";
    /** 中文文案。 */
    const zh = {
    	hint: "勾选后，这个会话会加载 Pen（pen.dev）的 MCP 工具；会话中随时可用 /pen 开启、/pen off 关闭。",
    	hintPending: "会话开始后自动连接 Pen MCP。",
    	hintConnecting: "正在连接 Pen MCP…",
    	hintReady: "这个会话已加载 Pen MCP 工具（mcp__pencil__*）。",
    	hintFailed: "Pen MCP 连接失败："
    };
    /** 英文文案。 */
    const en = {
    	hint: "When checked, this session loads the Pen (pen.dev) MCP tools. During a session, /pen enables them and /pen off disables them.",
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
    const STATE_ROUTE = "/pen/state";
    /** 与 Host 一致的勾选路由。 */
    const TOGGLE_ROUTE = "/pen/toggle";
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
    // .build/pen/client/logo.js
    /**
    * Pen 官方 logo（笔尖 / nib）的描边版本。
    *
    * 形状照着 Pen（pen.dev）的笔尖 logo 描摹：宽顶、直边、底部收成尖，中间一个
    * 圆点和一条竖线。这里以前内联的是 `assets/pen-logo.png` 的 PNG data URL，
    * 12px 下会糊成一个灰点；改成矢量描边后，勾选框与标题标记都用 `currentColor`
    * 跟随主题，任意尺寸都清晰。
    *
    * 与 `plugins/pen/icon.svg`（市场图标）共用同一组路径；改形状时两处一起改。
    *
    * @module @buka/dsh-plugin-pen/client/logo
    */
    /** 原始画布：与 Pen 笔尖 logo 的宽高比一致（64×77）。 */
    const VIEWBOX = "0 0 64 77";
    /** 描边粗细（原始画布单位）；缩到 12–14px 时约为 1px。 */
    const STROKE_WIDTH = 4.6;
    /** 外轮廓：宽顶、直边、底部收尖。 */
    const OUTLINE = "M9.5 4.5h45a3 3 0 0 1 3 3V37L32 73.5 6.5 37V7.5a3 3 0 0 1 3-3Z";
    /** 笔尖的圆点与分缝。 */
    const CIRCLE = {
    	cx: 32,
    	cy: 27.5,
    	r: 8
    };
    const SEAM = "M32 36v29";
    /** 画布宽高比；用来按高度算宽度。 */
    const ASPECT = 64 / 77;
    /**
    * 渲染 Pen 笔尖描边图标。
    *
    * @param props 高度与 class
    * @returns 跟随文字颜色的 SVG
    */
    function PenLogo({ height = 14, className }) {
    	return h("svg", {
    		className,
    		width: Math.round(height * ASPECT * 100) / 100,
    		height,
    		viewBox: VIEWBOX,
    		fill: "none",
    		stroke: "currentColor",
    		strokeWidth: STROKE_WIDTH,
    		strokeLinejoin: "round",
    		strokeLinecap: "round",
    		"aria-hidden": "true"
    	}, h("path", { d: OUTLINE }), h("circle", CIRCLE), h("path", { d: SEAM }));
    }
    // .build/pen/client/mark.js
    /**
    * 会话标题右侧的「Pen MCP」标记：标识这条会话已开启 Pen。
    *
    * 插槽 `conversation.session.header.actions` 紧挨在标题之后、官方工具按钮之前，
    * 是「标题右侧」这个位置。标记只在**该会话**开启 Pen 时出现；插件没启用时
    * 浏览器一半根本不会加载，所以「插件开着」这条不需要额外判断。
    *
    * 显示成一行普通文字（Pen 笔尖描边图标 + 品牌名），不做胶囊、不加悬浮提示：
    * 它只回答「这条会话开没开 Pen」。图标是内联 SVG，跟随主题文字颜色。
    *
    * 会话进行中还能用 `/pen` 与 `/pen off` 命令切换，所以状态不再是「挂载后不
    * 变」：每条命令都会在会话里留下 `command/run`、`command/done` 事件，标记借
    * 标准插槽 prop `useChat` 观察命令节点，命令一落地就重新读 Host 状态。没有
    * `useChat` 时（例如测试桩）退化成挂载时读一次。
    *
    * @module @buka/dsh-plugin-pen/client/mark
    */
    /** 图标高度（像素），与 12px 文字放在一行里。 */
    const ICON_SIZE = 14;
    /**
    * 最近一条命令的「身份 + 状态」签名。
    *
    * 从后往前找第一个命令节点即可：普通消息与流式输出都不会改变它，所以标记
    * 不会跟着每个 token 发请求；命令从 `run` 变成 `done` 时签名变化，正好在
    * 切换完成后重新读一次 Host 状态。
    *
    * @param snapshot 当前 Chat 快照
    * @returns 用于判断是否需要重新读 Host 状态的字符串；没有命令时为空
    */
    function penCommandSignature(snapshot) {
    	const nodes = snapshot.legacy?.nodes;
    	if (!Array.isArray(nodes)) return "";
    	for (let index = nodes.length - 1; index >= 0; index -= 1) {
    		const node = nodes[index];
    		if (node?.kind !== "command") continue;
    		const done = node.data?.outcome !== void 0 && node.data?.outcome !== null;
    		return `${String(node.data?.commandId ?? index)}:${done ? "done" : "run"}`;
    	}
    	return "";
    }
    /**
    * 渲染标题旁的 Pen MCP 标记；会话没开启 Pen 时不占位置。
    *
    * @param props 会话 id 与 Chat 快照 hook
    * @returns 标记，或 null
    */
    function PenMark({ sessionId, useChat }) {
    	const signature = useChat === void 0 ? "" : useChat(penCommandSignature);
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
    	}, [sessionId, signature]);
    	if (sessionId === void 0 || snapshot?.enabled !== true) return null;
    	return h("span", { className: "buka-pen-mark" }, h(PenLogo, {
    		height: ICON_SIZE,
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
    .buka-pen-logo{flex:none;display:block}
    .buka-pen-toggle:has(.buka-pen-checkbox:focus-visible){outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .buka-pen-checkbox{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:inherit;flex:none;margin:0}
    .buka-pen-checkbox:focus-visible{outline:none}
    .buka-pen-warning{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:700;line-height:1}
    .buka-pen-mark{flex:none;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px;font-weight:500;line-height:18px;display:inline-flex}
    .buka-pen-mark-icon{flex:none;display:block}
    `;
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
    	}), h("span", { className: "buka-pen-brand" }, h(PenLogo, {
    		className: "buka-pen-logo",
    		height: 14
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
    *   之前；标记只在这一会话开启 Pen 时显示，补上「会话开始后看不到勾选框」
    *   的信息缺口，并会随 `/pen`、`/pen off` 命令的结果刷新。
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
    	ctx.effect(() => ctx.locale.register("pen", {
    		zh,
    		en
    	}), "pen: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-pen";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "pen: styles");
    	ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({
    		name: "conversation.hero.options",
    		id: "pen",
    		order: 20,
    		label: () => "Pen",
    		locale: "pen"
    	}, PenToggle));
    	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    		name: "conversation.session.header.actions",
    		id: "pen-mark",
    		order: 10,
    		label: () => MARK_LABEL
    	}, PenMark));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
