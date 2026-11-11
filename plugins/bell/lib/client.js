window.__ModuleLoader__.load({
  id: "@buka/dsh-plugin-bell",
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
    new Map(AVATARS.map((preset) => [preset.id, preset]));
    AVATARS[0].id;
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
    // .build/bell/client/preview.js
    /**
    * 设置页的试听请求：把候选声音名发给 Host，只播放一次，不写配置。
    *
    * @module @buka/dsh-plugin-bell/client/preview
    */
    /** 与 Host 侧一致的试听路由：播放一次，不写配置。 */
    const PREVIEW_ROUTE = "/buka-bell/preview";
    /**
    * 请求 Host 播放一个候选声音。只负责试听，选中与否由列表页各自的写入
    * 决定，所以这里不发 `configForms` 请求。
    */
    async function previewSound(sound) {
    	await requestJson(PREVIEW_ROUTE, {
    		method: "POST",
    		body: JSON.stringify({ sound }),
    		signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(5e3) : null
    	});
    }
    // .build/bell/client/components/settings.js
    /**
    * 设置页的提示音表单与两级页面组件。
    *
    * @module @buka/dsh-plugin-bell/client/settings
    */
    /** 与 Host 侧 `SILENT` 一致：设置页的「无」选项值。 */
    const NONE = "none";
    /** 四个提示时机；顺序与设置页一致。 */
    const FIELDS = [
    	"finish",
    	"wait",
    	"plan",
    	"abort"
    ];
    /** 与 Host 侧 `SYSTEM_SOUNDS` 保持一致的可选声音。 */
    const SOUNDS = [
    	"Basso",
    	"Blow",
    	"Bottle",
    	"Frog",
    	"Funk",
    	"Glass",
    	"Hero",
    	"Morse",
    	"Ping",
    	"Pop",
    	"Purr",
    	"Sosumi",
    	"Submarine",
    	"Tink"
    ];
    /** 全部可试听的候选：自带音频在前，系统声音在后（「无」不试听）。 */
    const PREVIEWABLE = [...[{
    	value: "ikun",
    	label: "你干嘛~哎哟"
    }], ...SOUNDS.map((name) => ({
    	value: name,
    	label: name
    }))];
    /** 声音列表页里的完整选项：「无」在最前，然后是所有能试听的候选。 */
    const PICKER_OPTIONS = [{
    	value: NONE,
    	label: ""
    }, ...PREVIEWABLE];
    /**
    * 设置页的提示音表单：两级页面。
    *
    * 第一级是四行（任务结束 / 等待输入 / 计划被退回 / 手动终止），行上显示
    * 当前声音；点一行整页进入该时机的**声音列表页**。第二级里点一项就同时
    * 选中并试听（写配置 + 请求 Host 播一次），不自动返回；点「返回」才回到
    * 四行页面，可以连着听几个再定。
    */
    function BellSettings({ t, useBellForm, setSound }) {
    	const state = useBellForm((snapshot) => snapshot);
    	const [failed, setFailed] = react.default.useState(false);
    	const [view, setView] = react.default.useState(null);
    	const [previewFailed, setPreviewFailed] = react.default.useState(false);
    	const ready = state.status === "ready" && state.value !== void 0 && state.writable !== false;
    	/** 某个时机当前选中的值；配置还没就绪时按「无」显示。 */
    	const current = (field) => ready ? state.value?.[field] ?? NONE : NONE;
    	/** 配置值 → 展示文案。自带音频与系统声音用手写文案，未知值原样显示。 */
    	const labelOf = (value) => {
    		if (value === NONE) return t("none");
    		const found = PREVIEWABLE.find((sound) => sound.value === value);
    		return found === void 0 ? value : found.label;
    	};
    	/** 试听一个候选：只播一次；失败时在列表底部提示。 */
    	const preview = (sound) => {
    		setPreviewFailed(false);
    		Promise.resolve(previewSound(sound)).then(void 0, () => setPreviewFailed(true));
    	};
    	/** 列表里点一项 = 选中 + 试听；不自动返回，方便连着听几个再定。 */
    	const choose = (field, value) => {
    		setFailed(false);
    		setPreviewFailed(false);
    		if (value !== NONE) preview(value);
    		Promise.resolve(setSound(field, value)).then((saved) => {
    			if (saved === false) setFailed(true);
    		}, () => setFailed(true));
    	};
    	/** 返回四行页面，顺手清掉试听错误。 */
    	const back = () => {
    		setView(null);
    		setPreviewFailed(false);
    	};
    	if (view !== null) {
    		const field = view;
    		return react.default.createElement("section", { className: "buka-bell-section" }, react.default.createElement("button", {
    			type: "button",
    			className: "buka-bell-back",
    			onClick: back
    		}, `← ${t("back")}`), react.default.createElement("h2", { className: "buka-bell-heading" }, t(field)), react.default.createElement("p", { className: "buka-bell-intro" }, t("pickHint")), ready ? null : react.default.createElement("p", { className: "buka-bell-muted" }, t(state.status === "unavailable" ? "unavailable" : "loading")), react.default.createElement("div", { className: "buka-bell-soundList" }, ...PICKER_OPTIONS.map((option) => {
    			const picked = current(field) === option.value;
    			return react.default.createElement("label", {
    				className: "buka-bell-soundRow",
    				key: option.value,
    				"data-checked": picked ? "true" : void 0,
    				"data-disabled": ready ? void 0 : "true"
    			}, react.default.createElement("input", {
    				type: "radio",
    				className: "buka-bell-radio",
    				name: `buka-bell-sound-${field}`,
    				value: option.value,
    				checked: picked,
    				disabled: !ready,
    				onClick: () => {
    					if (picked && option.value !== NONE) preview(option.value);
    				},
    				onChange: () => choose(field, option.value)
    			}), react.default.createElement("span", { className: "buka-bell-soundName" }, labelOf(option.value)));
    		})), failed ? react.default.createElement("p", {
    			className: "buka-bell-error",
    			role: "alert"
    		}, t("saveFailed")) : null, previewFailed ? react.default.createElement("p", {
    			className: "buka-bell-error",
    			role: "alert"
    		}, t("previewFailed")) : null);
    	}
    	const rows = FIELDS.map((field) => react.default.createElement("button", {
    		type: "button",
    		className: "buka-bell-row",
    		key: field,
    		disabled: !ready,
    		"aria-label": `${t(field)}：${labelOf(current(field))}`,
    		onClick: () => {
    			setFailed(false);
    			setPreviewFailed(false);
    			setView(field);
    		}
    	}, react.default.createElement("span", { className: "buka-bell-label" }, t(field)), react.default.createElement("span", { className: "buka-bell-rowValue" }, labelOf(current(field))), react.default.createElement("span", {
    		className: "buka-bell-rowChevron",
    		"aria-hidden": "true"
    	}, "›")));
    	return react.default.createElement("section", { className: "buka-bell-section" }, react.default.createElement("h2", { className: "buka-bell-heading" }, t("title")), react.default.createElement("p", { className: "buka-bell-intro" }, t("intro")), ready ? null : react.default.createElement("p", { className: "buka-bell-muted" }, t(state.status === "unavailable" ? "unavailable" : "loading")), react.default.createElement("div", { className: "buka-bell-rows" }, ...rows), failed ? react.default.createElement("p", {
    		className: "buka-bell-error",
    		role: "alert"
    	}, t("saveFailed")) : null);
    }
    // .build/bell/client/dictionaries.js
    /**
    * 设置页的文案词典：英文为键集合，简体中文按 `Record<keyof typeof en, string>`
    * 补齐，漏译由类型检查兜住。
    *
    * @module @buka/dsh-plugin-bell/client/dictionaries
    */
    /** 词典命名空间。 */
    const NS = "buka-bell";
    /** 英文文案。 */
    const en = {
    	nav: "Notification sounds",
    	title: "Notification sounds",
    	intro: "Choose which sound plays when a task finishes, when DSH waits for your input, when a plan is sent back for changes, or when you stop a task manually. Click a moment to open its sound list: clicking a sound selects it and plays it right away. “None” turns that moment off. Only the plan sound is off by default; the manual-stop sound uses the bundled clip.",
    	pickHint: "Pick one: the sound is selected and played right away. Back returns to the four moments.",
    	back: "Back",
    	previewFailed: "Could not play the preview. Try again.",
    	finish: "Task finished",
    	wait: "Waiting for input",
    	plan: "Plan sent back for changes",
    	abort: "Task stopped manually",
    	none: "None",
    	saveFailed: "Could not save the sound. Try again.",
    	loading: "Loading sound settings…",
    	unavailable: "This plugin has no editable configuration in the current profile."
    };
    /** 简体中文文案。 */
    const zh = {
    	nav: "提示音",
    	title: "提示音",
    	intro: "选择任务结束、DSH 等待你输入、计划被退回修改、手动终止任务时播放的提示音。点一行进入该时机的播放列表：点一项即选中并试听，点「返回」回来。「无」表示这个时机不播放；计划被退回默认静音，手动终止默认播放插件自带的「你干嘛~哎哟」。",
    	pickHint: "单选：选中哪个就试听哪个；点「返回」回到上一页。",
    	back: "返回",
    	previewFailed: "试听失败，请重试。",
    	finish: "任务结束",
    	wait: "等待输入",
    	plan: "计划被退回修改",
    	abort: "手动终止",
    	none: "无",
    	saveFailed: "保存失败，请重试。",
    	loading: "正在读取提示音设置…",
    	unavailable: "当前 profile 里这个插件没有可编辑的配置。"
    };
    // .build/bell/client/styles.js
    /**
    * 页面样式常量。
    *
    * @module @buka/dsh-plugin-bell/client/styles
    */
    /** 页面样式：只用主题 token，类名带插件前缀，避免影响其他页面。 */
    const CSS = `
    .buka-bell-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
    .buka-bell-heading{margin:0;font-size:18px;font-weight:600}
    .buka-bell-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
    .buka-bell-rows{display:flex;flex-direction:column;margin-top:4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
    .buka-bell-row{display:flex;align-items:center;gap:16px;width:100%;padding:16px 4px;border:0;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
    .buka-bell-row:hover:not(:disabled){background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
    .buka-bell-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
    .buka-bell-row:disabled{opacity:.55;cursor:default}
    .buka-bell-label{flex:1;min-width:0;font-size:14px;line-height:20px}
    .buka-bell-rowValue{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-secondary)}
    .buka-bell-rowChevron{flex:none;font-size:15px;line-height:1;color:var(--dsw-alias-label-secondary)}
    .buka-bell-back{align-self:flex-start;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
    .buka-bell-back:hover{text-decoration:underline}
    .buka-bell-back:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    .buka-bell-soundList{display:flex;flex-direction:column;margin-top:4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
    .buka-bell-soundRow{display:flex;align-items:center;gap:10px;width:100%;padding:11px 4px;border-bottom:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
    .buka-bell-soundRow:hover{background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
    .buka-bell-soundRow[data-checked='true']{color:var(--dsw-alias-brand-primary)}
    .buka-bell-soundRow[data-disabled='true']{opacity:.55;cursor:default}
    .buka-bell-radio{appearance:none;-webkit-appearance:none;box-sizing:border-box;display:grid;place-content:center;flex:none;width:14px;height:14px;margin:0;border:1px solid var(--dsw-alias-border-l4);border-radius:50%;background-color:var(--dsw-alias-bg-layer-1);cursor:pointer}
    .buka-bell-radio::before{content:'';width:6px;height:6px;border-radius:50%;background-color:var(--dsw-alias-brand-primary);transform:scale(0);transition:transform .12s ease}
    .buka-bell-radio:checked{border-color:var(--dsw-alias-brand-primary)}
    .buka-bell-radio:checked::before{transform:scale(1)}
    .buka-bell-radio:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    .buka-bell-radio:disabled{cursor:default}
    .buka-bell-soundName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .buka-bell-muted{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
    .buka-bell-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
    `;
    // .build/bell/client/index.js
    /**
    * `@buka/dsh-plugin-bell` 的浏览器一半：在 设置 → 提示音 里选四个声音。
    *
    * 页面本身不保存任何状态：读写都走 DSH 的设置表单服务 `ctx.configForms`
    * （Host 设置的浏览器镜像）。交互是两级的：设置页是四行，点一行进入该时机的
    * **独立声音列表页**；列表里点一项就同时「选中 + 试听」——写入配置并请求
    * Host 播放一次（`POST /buka-bell/preview`），不自动返回，只有点「返回」才
    * 回到四行页面，方便连着听几个再定。「无」表示那个时机不响。
    *
    * 不用 Modal、也不在行内展开：设置本身就是浮层，再叠一层弹窗或撑开页面都
    * 破坏操作预期；整页替换成列表最简单，也最像「进入一个页面」。
    *
    * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
    * 那层外壳由构建脚本 `scripts/build-clients.ts` 生成，源码里不写死包名。
    */
    /** Host 插件行 id：设置表单按这个命名空间读写 Host 的 volatile 配置。 */
    const NAMESPACE = "sound-buka-bell";
    /** 浏览器一半依赖的三个客户端服务。 */
    const inject = [
    	"slots",
    	"locale",
    	"configForms"
    ];
    /**
    * 注册设置页入口。
    */
    function apply(ctx) {
    	const t = ctx.locale.bind(NS);
    	ctx.effect(() => ctx.locale.register(NS, {
    		zh,
    		en
    	}), "buka-bell: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-bell";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-bell: styles");
    	const form = ctx.configForms.get(NAMESPACE);
    	const bellForm = {
    		getSnapshot: () => form.getSnapshot(),
    		subscribe: (listener) => form.subscribe(listener)
    	};
    	ctx.slots.inject("settings.section", () => ctx.slots.register({
    		name: "settings.section",
    		id: "buka-bell",
    		order: 16,
    		label: () => t("nav"),
    		locale: NS,
    		inject: () => ({
    			hooks: { bellForm },
    			setSound: (field, value) => form.set(field, value)
    		})
    	}, BellSettings));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
