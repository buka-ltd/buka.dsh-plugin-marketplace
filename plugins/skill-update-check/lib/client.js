window.__ModuleLoader__.load({
  id: "@buka/dsh-plugin-skill-update-check",
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
    // .build/skill-update-check/client/api.js
    /**
    * 与 Host 一半的 HTTP 接口。
    *
    * 浏览器只传会话 id 与「是否强制刷新」：当前工作区、lock 读取与 `skills`
    * CLI 全在 Host 完成。路由常量与 `src/routes.ts` 保持一致。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/api
    */
    /** 与 Host 一致的检查路由。 */
    const CHECK_ROUTE = "/buka-skill-update-check/status";
    /**
    * 检查一个会话所在工作区的项目技能。
    *
    * @param sessionId 会话 id
    * @param refresh 是否跳过 Host 的 5 分钟缓存
    * @returns 检查结果
    */
    async function readSkillUpdates(sessionId, refresh = false) {
    	const query = `sessionId=${encodeURIComponent(sessionId)}${refresh ? "&refresh=1" : ""}`;
    	const body = await requestJson(`${CHECK_ROUTE}?${query}`);
    	return {
    		ok: true,
    		status: statusOf(body.status),
    		total: numberOr(body.total, 0),
    		updates: namesOf(body.updates),
    		checkedAt: numberOr(body.checkedAt, Date.now()),
    		...typeof body.dir === "string" ? { dir: body.dir } : {},
    		...typeof body.message === "string" ? { message: body.message } : {}
    	};
    }
    /** 把响应里的状态收窄到已知值；未知值按不可用处理，不显示提示。 */
    function statusOf(value) {
    	return value === "updates" || value === "up-to-date" || value === "no-project-skills" || value === "unavailable" ? value : "unavailable";
    }
    /** 只保留响应里的非空字符串 skill 名。 */
    function namesOf(value) {
    	if (!Array.isArray(value)) return [];
    	const names = [];
    	for (const item of value) {
    		if (typeof item !== "string") continue;
    		const name = item.trim();
    		if (name !== "") names.push(name);
    	}
    	return names;
    }
    /** 数字字段的保守读取。 */
    function numberOr(value, fallback) {
    	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    }
    // .build/skill-update-check/client/badge.js
    /**
    * 新建会话输入框下方统计行最右侧（「上下文已用」圆环之后）的 warn 色提示。
    *
    * 只在有更新时出现：`{count} 个技能可更新`，tooltip 列出前几个 skill 与
    * 「点击重新检查」。检查失败时缩成一个 `!`，tooltip 给出原因；没有项目技能、
    * 全部最新或正在首次检查时都不占位置。
    *
    * 组件挂载（以及切换会话）时检查一次；点击提示会强制刷新 Host 缓存。
    * 检查全在 Host 完成，这里不碰文件系统，也不跑命令。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/badge
    */
    /** 把请求错误和它附带的 CLI 输出尾部合成一行可展示文本。 */
    function failureText(error) {
    	const message = messageOf(error);
    	const output = error?.output;
    	if (typeof output !== "string") return message;
    	const line = output.trim().split(/\r?\n/u).at(-1)?.trim() ?? "";
    	return line === "" ? message : `${message} ${line}`;
    }
    /**
    * 渲染更新提示；没有更新时不渲染。
    *
    * @param props 会话 id 与翻译函数
    * @returns 提示按钮，或 null
    */
    function SkillUpdatesBadge({ sessionId, t }) {
    	const [snapshot, setSnapshot] = (0, react.useState)(null);
    	const [failure, setFailure] = (0, react.useState)(null);
    	const [busy, setBusy] = (0, react.useState)(false);
    	const generation = (0, react.useRef)(0);
    	(0, react.useEffect)(() => {
    		if (sessionId === void 0) {
    			generation.current += 1;
    			setSnapshot(null);
    			setFailure(null);
    			setBusy(false);
    			return;
    		}
    		const current = ++generation.current;
    		setSnapshot(null);
    		setFailure(null);
    		setBusy(true);
    		readSkillUpdates(sessionId).then((next) => {
    			if (generation.current === current) setSnapshot(next);
    		}).catch((error) => {
    			if (generation.current === current) setFailure(failureText(error));
    		}).finally(() => {
    			if (generation.current === current) setBusy(false);
    		});
    		return () => {
    			if (generation.current === current) generation.current += 1;
    		};
    	}, [sessionId]);
    	if (sessionId === void 0) return null;
    	/** 点击提示：绕过 Host 缓存重新检查。 */
    	const recheck = () => {
    		if (busy) return;
    		const current = ++generation.current;
    		setBusy(true);
    		readSkillUpdates(sessionId, true).then((next) => {
    			if (generation.current !== current) return;
    			setSnapshot(next);
    			setFailure(null);
    		}).catch((error) => {
    			if (generation.current === current) setFailure(failureText(error));
    		}).finally(() => {
    			if (generation.current === current) setBusy(false);
    		});
    	};
    	if (failure !== null) return h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: `${t("error")} ${failure}`,
    		side: "top",
    		align: "start",
    		delayMs: 300,
    		portal: true,
    		maxWidth: 320
    	}, h("button", {
    		type: "button",
    		className: "buka-skill-update-check-badge",
    		"data-state": "error",
    		"data-busy": busy ? "" : void 0,
    		"aria-label": t("errorShort"),
    		"aria-busy": busy,
    		onClick: recheck
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }), h("span", { className: "buka-skill-update-check-errorMark" }, "!")));
    	if (snapshot === null || snapshot.status !== "updates" || snapshot.updates.length === 0) return null;
    	const count = snapshot.updates.length;
    	const label = `${count} ${count === 1 ? t("badgeOne") : t("badgeMany")}`;
    	const shown = snapshot.updates.slice(0, 5);
    	const extra = count - shown.length;
    	const names = `${shown.join(t("separator"))}${extra > 0 ? "…" : ""}`;
    	const hint = `${t("hint")} ${names} · ${t("hintRecheck")}`;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: hint,
    		side: "top",
    		align: "start",
    		delayMs: 300,
    		portal: true,
    		maxWidth: 360
    	}, h("button", {
    		type: "button",
    		className: "buka-skill-update-check-badge",
    		"data-state": "updates",
    		"data-busy": busy ? "" : void 0,
    		"aria-label": `${label}. ${hint}`,
    		"aria-busy": busy,
    		onClick: recheck
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }), h("span", { className: "buka-skill-update-check-text" }, label)));
    }
    // .build/skill-update-check/client/dictionary.js
    /**
    * 提示的文案：英文与简体中文各一份，键完全相同。
    *
    * `apply()` 把两份词典注册到 `NS` 命名空间；组件里的 `t()` 由
    * `ctx.locale.bind(NS)` 提供。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/dictionary
    */
    /** 词典命名空间。 */
    const NS = "buka-skill-update-check";
    /** 英文文案。 */
    const en = {
    	label: "SKILL update notice",
    	badgeOne: "skill update",
    	badgeMany: "skill updates",
    	hint: "Updates available:",
    	hintRecheck: "Click to check again.",
    	separator: ", ",
    	error: "Update check failed:",
    	errorShort: "Skill update check failed"
    };
    /** 简体中文文案。 */
    const zh = {
    	label: "SKILL 更新提示",
    	badgeOne: "个技能可更新",
    	badgeMany: "个技能可更新",
    	hint: "有更新的项目技能：",
    	hintRecheck: "点击重新检查。",
    	separator: "、",
    	error: "检查技能更新失败：",
    	errorShort: "技能更新检查失败"
    };
    // .build/skill-update-check/client/styles.js
    /**
    * 提示的样式。
    *
    * 这是输入框卡片下方统计行里的环境提示条：24px 高、12px 字号。颜色用
    * DSH 主题 token：有更新时是 `--dsw-alias-state-warn-primary`，检查失败时
    * 退到 `--dsw-alias-state-error-primary`。浅色 tint 用 `color-mix` 从同一个
    * token 派生，两种主题都跟着走。
    *
    * 统计行是 flex 容器：`activity` / `usage` 两个统计条目由插槽渲染，之后的
    * 「上下文已用」圆环由输入框自己追加。提示要排在这个圆环之后，而插槽只能
    * 决定条目之间的顺序，所以用 flex 的 `order` 把它放到所有默认项（含圆环）
    * 后面。圆环不在时效果同样成立：提示仍然在统计行最右端。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/styles
    */
    /** 注入到 `document.head` 的样式表。 */
    const CSS = `.buka-skill-update-check-badge{order:1;align-items:center;gap:5px;height:24px;min-width:0;max-width:200px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border:none;border-radius:var(--dsw-radius-sm);padding:0 8px;font-size:12px;font-weight:600;line-height:18px;display:inline-flex}
    @media (hover:hover){.buka-skill-update-check-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}}
    .buka-skill-update-check-badge[data-state=error]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
    @media (hover:hover){.buka-skill-update-check-badge[data-state=error]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}}
    .buka-skill-update-check-badge[data-busy]{cursor:progress;opacity:.65}
    .buka-skill-update-check-badge:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    .buka-skill-update-check-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .buka-skill-update-check-errorMark{font-size:12px;font-weight:700;line-height:1}
    `;
    // .build/skill-update-check/client/index.js
    /**
    * `@buka/dsh-plugin-skill-update-check` 的浏览器一半。
    *
    * 只注册一个插槽：`conversation.composer.dock`——新建会话输入框卡片下方的
    * 统计行。提示在统计行里用 flex `order` 排到「上下文已用」圆环之后
    * （见 `styles.ts`）。组件在 `badge.ts`，请求在 `api.ts`，文案在
    * `dictionary.ts`，样式在 `styles.ts`。提示只在当前工作区有项目技能更新时
    * 出现，点击可重新检查。
    *
    * 本文件只导出 `inject` 与 `apply`；`window.__ModuleLoader__.load(...)` 外壳
    * 由构建脚本生成。
    *
    * @module @buka/dsh-plugin-skill-update-check/client
    */
    /** 浏览器一半依赖的两个客户端服务。 */
    const inject = ["slots", "locale"];
    /**
    * 注册词典、样式与输入框下方的提示。
    *
    * @param ctx 浏览器插件上下文
    */
    function apply(ctx) {
    	const t = ctx.locale.bind(NS);
    	ctx.effect(() => ctx.locale.register(NS, {
    		zh,
    		en
    	}), "buka-skill-update-check: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-skill-update-check";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-skill-update-check: styles");
    	ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
    		name: "conversation.composer.dock",
    		id: "buka-skill-update-check",
    		order: 20,
    		label: () => t("label"),
    		locale: NS
    	}, SkillUpdatesBadge));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
