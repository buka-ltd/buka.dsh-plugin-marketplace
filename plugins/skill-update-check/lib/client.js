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
    // .build/skill-update-check/client/api.js
    /**
    * 与 Host 一半的 HTTP 接口。
    *
    * 浏览器只传会话 id、`refresh=1` 与要更新的 skill 名：当前工作区、lock 读取、
    * `skills` CLI 的检查与更新全在 Host 完成。路由常量与 `src/routes.ts` 保持一致。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/api
    */
    /** 与 Host 一致的检查路由。 */
    const CHECK_ROUTE = "/skill-update-check/status";
    /** 与 Host 一致的更新路由。 */
    const UPDATE_ROUTE = "/skill-update-check/update";
    /**
    * 检查一个会话所在工作区的项目技能。
    *
    * @param sessionId 会话 id
    * @param refresh 是否跳过 Host 的 5 分钟缓存
    * @returns 检查结果
    */
    async function readSkillUpdates(sessionId, refresh = false) {
    	const query = `sessionId=${encodeURIComponent(sessionId)}${refresh ? "&refresh=1" : ""}`;
    	return snapshotOf(await requestJson(`${CHECK_ROUTE}?${query}`));
    }
    /**
    * 更新一个会话所在工作区的项目技能。
    *
    * 省略 `skills` 表示更新检查得到的全部；单个 skill 失败不会让请求抛错，
    * 失败项在响应的 `failed` 里。
    *
    * @param sessionId 会话 id
    * @param skills 要更新的 skill 名；省略表示全部
    * @returns 更新报告，其中 `snapshot` 是更新后的检查结果
    */
    async function updateSkillUpdates(sessionId, skills) {
    	const record = recordOf(await requestJson(UPDATE_ROUTE, {
    		method: "POST",
    		body: JSON.stringify({
    			sessionId,
    			...skills === void 0 ? {} : { skills }
    		})
    	}));
    	return {
    		ok: true,
    		updated: namesOf(record.updated),
    		failed: failuresOf(record.failed),
    		snapshot: snapshotOf(record.snapshot),
    		...typeof record.message === "string" ? { message: record.message } : {}
    	};
    }
    /**
    * 把请求错误和它附带的 CLI 输出尾部合成一行可展示文本。
    *
    * @param error 捕获到的请求错误
    */
    function failureText(error) {
    	const message = messageOf(error);
    	const output = error?.output;
    	if (typeof output !== "string") return message;
    	const line = output.trim().split(/\r?\n/u).at(-1)?.trim() ?? "";
    	return line === "" ? message : `${message} ${line}`;
    }
    /** 把未知值收窄成记录；数组与原始值按空记录处理。 */
    function recordOf(value) {
    	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    /** 把响应里的快照字段逐项收窄；缺失或类型不对时退回保守值。 */
    function snapshotOf(value) {
    	const body = recordOf(value);
    	const modified = namesOf(body.modified);
    	const sources = sourcesOf(body.sources);
    	return {
    		ok: true,
    		status: statusOf(body.status),
    		total: numberOr(body.total, 0),
    		updates: namesOf(body.updates),
    		...modified.length === 0 ? {} : { modified },
    		...Object.keys(sources).length === 0 ? {} : { sources },
    		checkedAt: numberOr(body.checkedAt, Date.now()),
    		...typeof body.message === "string" ? { message: body.message } : {}
    	};
    }
    /** 只保留「skill 名 → 非空来源」的条目。 */
    function sourcesOf(value) {
    	const sources = {};
    	for (const [name, source] of Object.entries(recordOf(value))) {
    		if (name.trim() === "" || typeof source !== "string" || source.trim() === "") continue;
    		sources[name] = source.trim();
    	}
    	return sources;
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
    /** 把响应里的失败项收窄成 `{ name, message }`，跳过结构不对的条目。 */
    function failuresOf(value) {
    	if (!Array.isArray(value)) return [];
    	const failures = [];
    	for (const item of value) {
    		const record = recordOf(item);
    		if (typeof record.name !== "string" || record.name.trim() === "") continue;
    		failures.push({
    			name: record.name.trim(),
    			message: typeof record.message === "string" ? record.message : ""
    		});
    	}
    	return failures;
    }
    /** 数字字段的保守读取。 */
    function numberOr(value, fallback) {
    	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    }
    // .build/skill-update-check/client/update-jobs.js
    /**
    * 后台更新任务的状态机（不依赖浏览器 API，`node --test` 可以直接 import）。
    *
    * 更新请求挂在页面级实例上，而不是弹窗的组件 state：关掉弹窗、切换会话都不会
    * 取消它。提示条与弹窗订阅同一份状态，所以点完更新可以立刻关掉弹窗；更新结束
    * 后把 Host 返回的新快照交给订阅者，计数随之刷新。
    *
    * 同一会话同时只允许一个任务：Host 本来就会串行执行 `skills update`，这里再挡
    * 一道，避免重复点击产生多余请求。整次请求失败时保留原来的列表，失败原因留给
    * 弹窗展示。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/update-jobs
    */
    /**
    * 按会话保存更新任务的小状态机。
    *
    * 每个会话只保留最近一个任务：重复 `start()` 在运行中会被忽略，结束后再点则
    * 覆盖上一次结果。订阅者拿到的始终是该会话的最新状态。
    */
    var SkillUpdateJobs = class {
    	#run;
    	#describe;
    	#now;
    	#jobs = /* @__PURE__ */ new Map();
    	#listeners = /* @__PURE__ */ new Set();
    	constructor(options) {
    		this.#run = options.run;
    		this.#describe = options.describe ?? ((error) => String(error));
    		this.#now = options.now ?? Date.now;
    	}
    	/**
    	* 读一个会话最近的更新任务。
    	*
    	* @param sessionId 会话 id
    	* @returns 任务状态；这个会话还没更新过时是 `undefined`
    	*/
    	jobOf(sessionId) {
    		return this.#jobs.get(sessionId);
    	}
    	/**
    	* 订阅任务状态变化。
    	*
    	* @param listener 每次状态变化时调用
    	* @returns 取消订阅
    	*/
    	subscribe(listener) {
    		this.#listeners.add(listener);
    		return () => {
    			this.#listeners.delete(listener);
    		};
    	}
    	/**
    	* 开始更新；这个会话已有任务在跑时不重复发起。
    	*
    	* @param sessionId 会话 id
    	* @param names 要更新的 skill 名
    	*/
    	start(sessionId, names) {
    		if (names.length === 0) return;
    		if (this.#jobs.get(sessionId)?.status === "running") return;
    		const requested = [...names];
    		this.#publish({
    			sessionId,
    			names: requested,
    			status: "running",
    			updated: [],
    			failed: [],
    			snapshot: null,
    			failure: null,
    			finishedAt: null
    		});
    		this.#run(sessionId, requested).then((report) => {
    			this.#publish({
    				sessionId,
    				names: requested,
    				status: "done",
    				updated: report.updated,
    				failed: report.failed,
    				snapshot: report.snapshot,
    				failure: null,
    				finishedAt: this.#now()
    			});
    		}, (error) => {
    			this.#publish({
    				sessionId,
    				names: requested,
    				status: "failed",
    				updated: [],
    				failed: [],
    				snapshot: null,
    				failure: this.#describe(error),
    				finishedAt: this.#now()
    			});
    		});
    	}
    	/** 写入状态并通知所有订阅者。 */
    	#publish(job) {
    		this.#jobs.set(job.sessionId, job);
    		for (const listener of this.#listeners) listener(job);
    	}
    };
    // .build/skill-update-check/client/update-store.js
    /**
    * 页面级的后台更新实例：把 {@link SkillUpdateJobs} 状态机接到真实请求上。
    *
    * 弹窗与提示条都 import 这一个实例，所以弹窗关闭、重新打开甚至切换会话后，
    * 更新状态仍然只有一份。状态机本身在 `update-jobs.ts`，不依赖浏览器 API。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/update-store
    */
    /** 页面级的唯一 store：弹窗与提示条共用。 */
    const updateStore = new SkillUpdateJobs({
    	run: (sessionId, names) => updateSkillUpdates(sessionId, names),
    	describe: failureText
    });
    // .build/skill-update-check/client/dialog.js
    /**
    * 点击输入框下方提示后弹出的「SKILL 更新」弹窗。
    *
    * 弹窗直接渲染提示已经拿到的检查快照：数据还新鲜（与 Host 一样按 5 分钟算）时
    * 立刻显示，不再发请求、不再进 loading。只有快照缺失或超过缓存时长时才在后台
    * 补一次检查，旧列表保持可见；补检查失败也不会清空已有结论。「重新检查」是唯一
    * 会强制跳过 Host 缓存的入口。
    *
    * 每一行是技能名加它在 `skills-lock.json` 里记录的来源仓库（没有来源时只显示
    * 名字），右侧一个「更新」；页脚一个「全部更新」。更新请求交给
    * `update-store.ts`：发起后弹窗可以随时关闭，更新在后台继续，提示条会显示
    * 「正在更新 N 个技能」；重新打开弹窗也能看到进行中的状态与结果。
    *
    * 单个 skill 失败不会中断整批：失败原因留在列表下方，成功的项从列表里消失。
    * 更新进行中禁用「更新 / 全部更新 / 重新检查」，但不拦关闭。没有可更新项时按
    * 检查结论区分「都已是最新」与「没有可检查的项目技能」，不会把「没检查成」说成
    * 「已是最新」。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/dialog
    */
    /**
    * 快照仍然新鲜、不需要后台复查的时长。
    *
    * 与 Host 的 `CHECK_TTL_MS` 一致：超过它之后 Host 的缓存也过期，后台复查才会
    * 真正跑一次 CLI；在这之内打开弹窗只是渲染已有结果。
    */
    const FRESH_MS = 3e5;
    /** 更新结束后弹窗仍然展示结果的时长。 */
    const NOTICE_MS = 3e4;
    /**
    * 渲染「SKILL 更新」弹窗。
    *
    * @param props 快照、失败原因、会话、翻译函数与关闭回调
    * @returns 弹窗；关闭时为 `null`
    */
    function SkillUpdatesDialog(props) {
    	const { open, sessionId, t, snapshot, failure: checkFailure, onClose, onSnapshot } = props;
    	const [checkError, setCheckError] = (0, react.useState)(null);
    	const [checking, setChecking] = (0, react.useState)(false);
    	const [job, setJob] = (0, react.useState)(null);
    	const generation = (0, react.useRef)(0);
    	const onSnapshotRef = (0, react.useRef)(onSnapshot);
    	onSnapshotRef.current = onSnapshot;
    	const latest = (0, react.useRef)({
    		snapshot,
    		checkFailure
    	});
    	latest.current = {
    		snapshot,
    		checkFailure
    	};
    	(0, react.useEffect)(() => {
    		if (sessionId === void 0) {
    			setJob(null);
    			return;
    		}
    		setJob(updateStore.jobOf(sessionId) ?? null);
    		return updateStore.subscribe((next) => {
    			if (next.sessionId === sessionId) setJob(next);
    		});
    	}, [sessionId]);
    	/**
    	* 检查一次；`refresh` 为 true 时跳过 Host 缓存，只有「重新检查」这样做。
    	*
    	* 失败时保留已有列表，只把原因显示出来；还没有任何结论时才把失败同步给提示。
    	*
    	* @param refresh 是否强制跳过 Host 缓存
    	*/
    	function load(refresh) {
    		if (sessionId === void 0) return;
    		const current = ++generation.current;
    		setChecking(true);
    		setCheckError(null);
    		readSkillUpdates(sessionId, refresh).then((next) => {
    			if (generation.current !== current) return;
    			onSnapshotRef.current(next, null);
    		}).catch((error) => {
    			if (generation.current !== current) return;
    			const text = failureText(error);
    			setCheckError({
    				kind: "check",
    				text
    			});
    			if (latest.current.snapshot === null) onSnapshotRef.current(null, text);
    		}).finally(() => {
    			if (generation.current === current) setChecking(false);
    		});
    	}
    	(0, react.useEffect)(() => {
    		if (!open || sessionId === void 0) return void 0;
    		setCheckError(null);
    		const { snapshot: current, checkFailure: failed } = latest.current;
    		if (current !== null && Date.now() - current.checkedAt < FRESH_MS) return void 0;
    		if (current === null && failed !== null) return void 0;
    		if (updateStore.jobOf(sessionId)?.status === "running") return void 0;
    		load(false);
    	}, [open, sessionId]);
    	if (!open) return null;
    	const status = snapshot?.status;
    	const updates = status === "updates" && snapshot !== null ? snapshot.updates : [];
    	const modified = snapshot?.modified ?? [];
    	const updating = job !== null && job.status === "running" ? job : null;
    	const busy = checking || updating !== null;
    	const hasUpdates = updates.length > 0;
    	const failures = job !== null && job.status === "done" ? job.failed : [];
    	const shownFailure = checkError ?? (job !== null && job.status === "failed" && job.failure !== null ? {
    		kind: "update",
    		text: job.failure
    	} : null) ?? (checkFailure === null ? null : {
    		kind: "check",
    		text: checkFailure
    	});
    	const notice = job !== null && job.status === "done" && job.finishedAt !== null && Date.now() - job.finishedAt < NOTICE_MS ? job.updated.length > 0 ? t("updatedNames", { names: job.updated.join(t("separator")) }) : job.failed.length === 0 ? t("nothingUpdated") : null : null;
    	/** 发起更新；请求挂在 store 上，关掉弹窗也会继续。 */
    	const update = (names) => {
    		if (sessionId === void 0 || busy || names.length === 0) return;
    		setCheckError(null);
    		updateStore.start(sessionId, names);
    	};
    	const failureLine = shownFailure === null ? null : h("p", {
    		className: "skill-update-check-failure",
    		role: "alert"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    		state: "error",
    		size: 13
    	}), `${t(shownFailure.kind === "check" ? "error" : "updateFailed")} ${shownFailure.text}`);
    	const checkingLine = checking ? h("p", {
    		className: "skill-update-check-status",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    		state: "ongoing",
    		size: 13
    	}), t("checking")) : null;
    	const updatingLine = updating === null ? null : h("p", {
    		className: "skill-update-check-status",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    		state: "ongoing",
    		size: 13
    	}), updating.names.length === 1 ? `${t("updating")} ${updating.names[0]}` : t("updatingCount", { count: updating.names.length }));
    	const updatingHint = updating === null ? null : h("p", { className: "skill-update-check-hint" }, t("updatingHint"));
    	const noticeLine = notice === null ? null : h("p", {
    		className: "skill-update-check-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    		state: "done",
    		size: 13
    	}), notice);
    	const failureLines = failures.map((item) => h("p", {
    		key: `failed-${item.name}`,
    		className: "skill-update-check-failure",
    		role: "alert"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    		state: "error",
    		size: 13
    	}), `${item.name} · ${item.message}`));
    	const rows = updates.map((name) => {
    		const source = snapshot?.sources?.[name];
    		const rowUpdating = updating !== null && updating.names.length === 1 && updating.names[0] === name;
    		return h("li", {
    			key: name,
    			className: "skill-update-check-row"
    		}, h("span", { className: "skill-update-check-rowMain" }, h("span", {
    			className: "skill-update-check-name",
    			title: name
    		}, name), source === void 0 ? null : h("span", {
    			className: "skill-update-check-source",
    			title: source
    		}, source)), rowUpdating ? h("span", { className: "skill-update-check-rowStatus" }, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}), t("updating")) : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			size: "sm",
    			disabled: busy,
    			"aria-label": `${t("update")} ${name}`,
    			onClick: () => update([name])
    		}, t("update")));
    	});
    	const modifiedLine = modified.length === 0 ? null : h("p", { className: "skill-update-check-modified" }, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    		state: "warning",
    		size: 13
    	}), `${t("modifiedTitle")} ${modified.join(t("separator"))}`);
    	const emptyState = snapshot !== null && !checking && !hasUpdates ? status === "up-to-date" ? h("div", { className: "skill-update-check-empty" }, h("span", {
    		className: "skill-update-check-emptyIcon",
    		"aria-hidden": true
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 28 })), h("p", { className: "skill-update-check-emptyTitle" }, t("upToDateTitle")), h("p", { className: "skill-update-check-emptyHint" }, t("upToDateHint"))) : h("div", { className: "skill-update-check-empty" }, h("span", {
    		className: "skill-update-check-emptyIconNeutral",
    		"aria-hidden": true
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 24 })), h("p", { className: "skill-update-check-emptyTitle" }, t("nothingToCheckTitle")), h("p", { className: "skill-update-check-emptyHint" }, snapshot.message ?? t("nothingToCheckHint"))) : null;
    	const body = h("div", { className: "skill-update-check-dialog" }, failureLine, checkingLine, updatingLine, updatingHint, noticeLine, failureLines, modifiedLine, hasUpdates ? h("ul", { className: "skill-update-check-list" }, ...rows) : emptyState);
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open,
    		onClose,
    		title: t("dialogTitle"),
    		closeLabel: t("close"),
    		className: "skill-update-check-modal",
    		contentClassName: "skill-update-check-modalContent",
    		footer: h(react.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "ghost",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
    			disabled: busy,
    			onClick: () => load(true)
    		}, t("recheck")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: onClose
    		}, t("close")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			disabled: busy || !hasUpdates,
    			icon: updating === null ? void 0 : h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    				state: "ongoing",
    				size: 13
    			}),
    			onClick: () => update(updates)
    		}, updating === null ? t("updateAll") : t("updating")))
    	}, body);
    }
    // .build/skill-update-check/client/badge.js
    /**
    * 新建会话输入框下方统计行最右侧（「上下文已用」圆环之后）的 warn 色提示。
    *
    * 有更新时显示 `{count} 个技能可更新`。点击提示会打开「SKILL 更新」弹窗
    * （`dialog.ts`），里面列出过期的项目技能，每一行一个「更新」，页脚一个
    * 「全部更新」。tooltip 列出前几个 skill 名并提示点击。
    *
    * 更新在后台进行：弹窗发起后请求挂在 `update-store.ts` 上，用户随时可以关掉
    * 弹窗；这期间提示条改成「正在更新 N 个技能」，结束后短暂显示「已更新 N 个
    * 技能」，再把 Host 返回的新快照同步给计数。
    *
    * 弹窗直接复用这里拿到的快照，打开时不再重新检查，所以不会出现加载态。
    * 检查失败时提示缩成一个 `!`，tooltip 给出原因；点击同样打开弹窗并显示原因。
    * 没有项目技能、全部最新或正在首次检查时都不占位置。
    *
    * 组件挂载（以及切换会话）时检查一次；检查全在 Host 完成，这里不碰文件系统，
    * 也不跑命令。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/badge
    */
    /** 更新结束后提示条停留的时长。 */
    const COMPLETED_MS = 4e3;
    /**
    * 渲染更新提示与它打开的弹窗；没有更新且弹窗未打开时不渲染。
    *
    * @param props 会话 id 与翻译函数
    * @returns 提示按钮（可能附带弹窗），或 null
    */
    function SkillUpdatesBadge({ sessionId, t }) {
    	const [snapshot, setSnapshot] = (0, react.useState)(null);
    	const [failure, setFailure] = (0, react.useState)(null);
    	const [open, setOpen] = (0, react.useState)(false);
    	const [job, setJob] = (0, react.useState)(null);
    	/** 后台更新刚结束时短暂显示的「已更新 N 个技能」。 */
    	const [completed, setCompleted] = (0, react.useState)(null);
    	const generation = (0, react.useRef)(0);
    	(0, react.useEffect)(() => {
    		if (sessionId === void 0) {
    			generation.current += 1;
    			setSnapshot(null);
    			setFailure(null);
    			setOpen(false);
    			return;
    		}
    		const current = ++generation.current;
    		setSnapshot(null);
    		setFailure(null);
    		readSkillUpdates(sessionId).then((next) => {
    			if (generation.current === current) setSnapshot(next);
    		}).catch((error) => {
    			if (generation.current === current) setFailure(failureText(error));
    		});
    		return () => {
    			if (generation.current === current) generation.current += 1;
    		};
    	}, [sessionId]);
    	(0, react.useEffect)(() => {
    		if (sessionId === void 0) {
    			setJob(null);
    			return;
    		}
    		setJob(updateStore.jobOf(sessionId) ?? null);
    		return updateStore.subscribe((next) => {
    			if (next.sessionId !== sessionId) return;
    			setJob(next);
    			if (next.status === "done" && next.snapshot !== null) {
    				generation.current += 1;
    				setSnapshot(next.snapshot);
    				setFailure(next.failure);
    			}
    		});
    	}, [sessionId]);
    	(0, react.useEffect)(() => {
    		if (job === null || job.status !== "done" || job.finishedAt === null) return void 0;
    		if (job.updated.length === 0 || job.failed.length > 0) return void 0;
    		const remaining = job.finishedAt + COMPLETED_MS - Date.now();
    		if (remaining <= 0) return void 0;
    		setCompleted({ count: job.updated.length });
    		const timer = setTimeout(() => setCompleted(null), remaining);
    		return () => clearTimeout(timer);
    	}, [job]);
    	if (sessionId === void 0) return null;
    	/**
    	* 弹窗检查的结果同步回提示：计数、`!` 状态与弹窗保持一致。
    	*
    	* @param next 新快照；检查失败时为 null
    	* @param nextFailure 检查失败的原因
    	*/
    	const sync = (next, nextFailure) => {
    		generation.current += 1;
    		setSnapshot(next);
    		setFailure(nextFailure);
    	};
    	const dialog = h(SkillUpdatesDialog, {
    		open,
    		sessionId,
    		t,
    		snapshot,
    		failure,
    		onClose: () => setOpen(false),
    		onSnapshot: sync
    	});
    	/** 提示按钮的外壳：相同的样式、可访问性与点击行为。 */
    	const badgeButton = (state, label, content) => h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label,
    		side: "top",
    		align: "end",
    		delayMs: 300,
    		portal: true,
    		maxWidth: 360
    	}, h("button", {
    		type: "button",
    		className: "skill-update-check-badge",
    		"data-state": state,
    		"aria-label": label,
    		"aria-haspopup": "dialog",
    		"aria-expanded": open,
    		onClick: () => setOpen(true)
    	}, content));
    	if (job !== null && job.status === "running") {
    		const count = job.names.length;
    		const label = count === 1 ? t("updatingBadgeOne") : count > 0 ? t("updatingBadge", { count }) : t("updating");
    		const names = job.names.slice(0, 5).join(t("separator"));
    		const hint = names === "" ? label : `${label} · ${names}`;
    		return h(react.Fragment, null, badgeButton("updating", hint, h(react.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 12
    		}), h("span", { className: "skill-update-check-text" }, label))), dialog);
    	}
    	if (completed !== null && !open) {
    		const label = completed.count === 1 ? t("updatedBadgeOne") : t("updatedBadge", { count: completed.count });
    		return h(react.Fragment, null, badgeButton("done", label, h(react.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 13 }), h("span", { className: "skill-update-check-text" }, label))), dialog);
    	}
    	if (failure !== null) return h(react.Fragment, null, badgeButton("error", `${t("error")} ${failure} · ${t("hintOpen")}`, h(react.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }), h("span", { className: "skill-update-check-errorMark" }, "!"))), dialog);
    	if (snapshot === null || snapshot.status !== "updates" || snapshot.updates.length === 0) return open ? dialog : null;
    	const count = snapshot.updates.length;
    	const label = `${count} ${count === 1 ? t("badgeOne") : t("badgeMany")}`;
    	const shown = snapshot.updates.slice(0, 5);
    	const extra = count - shown.length;
    	const names = `${shown.join(t("separator"))}${extra > 0 ? "…" : ""}`;
    	const hint = `${t("hint")} ${names} · ${t("hintOpen")}`;
    	return h(react.Fragment, null, badgeButton("updates", hint, h(react.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }), h("span", { className: "skill-update-check-text" }, label))), dialog);
    }
    // .build/skill-update-check/client/dictionary.js
    /**
    * 提示与更新弹窗的文案：英文与简体中文各一份，键完全相同。
    *
    * `apply()` 把两份词典注册到 `NS` 命名空间；组件里的 `t()` 由
    * `ctx.locale.bind(NS)` 提供。`{count}` / `{names}` 这类占位符由词典服务替换。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/dictionary
    */
    /** 词典命名空间。 */
    const NS = "skill-update-check";
    /** 英文文案。 */
    const en = {
    	label: "SKILL updates",
    	badgeOne: "skill update",
    	badgeMany: "skill updates",
    	hint: "Updates available:",
    	hintOpen: "Click to review and update.",
    	separator: ", ",
    	error: "Update check failed:",
    	dialogTitle: "SKILL updates",
    	close: "Close",
    	recheck: "Check again",
    	update: "Update",
    	updateAll: "Update all",
    	updating: "Updating…",
    	updatingCount: "Updating {count} skills…",
    	updatingHint: "It keeps running in the background; you can close this dialog.",
    	updatingBadge: "Updating {count} skills",
    	updatingBadgeOne: "Updating 1 skill",
    	updatedBadge: "Updated {count} skills",
    	updatedBadgeOne: "Updated 1 skill",
    	checking: "Checking…",
    	upToDateTitle: "All project skills are up to date.",
    	upToDateHint: "Nothing left to update in this workspace.",
    	modifiedTitle: "Local changes — not updated:",
    	nothingToCheckTitle: "Nothing to check.",
    	nothingToCheckHint: "This workspace has no skills-lock.json, or no project skills managed by npx skills.",
    	nothingUpdated: "Nothing to update.",
    	updatedNames: "Updated: {names}.",
    	updateFailed: "Update failed:"
    };
    /** 简体中文文案。 */
    const zh = {
    	label: "SKILL 更新",
    	badgeOne: "个技能可更新",
    	badgeMany: "个技能可更新",
    	hint: "有更新的项目技能：",
    	hintOpen: "点击查看并更新。",
    	separator: "、",
    	error: "检查技能更新失败：",
    	dialogTitle: "SKILL 更新",
    	close: "关闭",
    	recheck: "重新检查",
    	update: "更新",
    	updateAll: "全部更新",
    	updating: "更新中…",
    	updatingCount: "正在更新 {count} 个技能…",
    	updatingHint: "更新在后台继续，可以关闭弹窗。",
    	updatingBadge: "正在更新 {count} 个技能",
    	updatingBadgeOne: "正在更新 1 个技能",
    	updatedBadge: "已更新 {count} 个技能",
    	updatedBadgeOne: "已更新 1 个技能",
    	checking: "正在检查…",
    	upToDateTitle: "项目技能都已是最新的。",
    	upToDateHint: "当前工作区没有待更新的技能。",
    	modifiedTitle: "有本地修改，未参与更新：",
    	nothingToCheckTitle: "没有可检查的项目技能。",
    	nothingToCheckHint: "当前工作区没有 skills-lock.json，或里面没有由 npx skills 管理的项目技能。",
    	nothingUpdated: "没有可更新的技能。",
    	updatedNames: "已更新：{names}。",
    	updateFailed: "更新失败："
    };
    // .build/skill-update-check/client/styles.js
    /**
    * 提示与更新弹窗的样式。
    *
    * 提示是输入框卡片下方统计行里的环境提示条：24px 高、12px 字号。颜色用
    * DSH 主题 token：有更新时是 `--dsw-alias-state-warn-primary`，检查失败时
    * 退到 `--dsw-alias-state-error-primary`。浅色 tint 用 `color-mix` 从同一个
    * token 派生，两种主题都跟着走。
    *
    * 统计行是 flex 容器：`activity` / `usage` 两个统计条目由插槽渲染，之后的
    * 「上下文已用」圆环由输入框自己追加。提示要排在这个圆环之后，而插槽只能
    * 决定条目之间的顺序，所以用 flex 的 `order` 把它放到所有默认项（含圆环）
    * 后面。圆环不在时效果同样成立：提示仍然在统计行最右端。
    *
    * 弹窗复用 `Modal` 的标题 / 遮罩 / 页脚布局，这里只排内容：一行一个过期
    * skill，名字在左、按钮在右；空状态居中。颜色与圆角只用主题 token。
    *
    * @module @buka/dsh-plugin-skill-update-check/client/styles
    */
    /** 注入到 `document.head` 的样式表。 */
    const CSS = `.skill-update-check-badge{order:1;align-items:center;gap:5px;height:24px;min-width:0;max-width:200px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border:none;border-radius:var(--dsw-radius-sm);padding:0 8px;font-size:12px;font-weight:600;line-height:18px;display:inline-flex}
    @media (hover:hover){.skill-update-check-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}}
    .skill-update-check-badge[data-state=error]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
    @media (hover:hover){.skill-update-check-badge[data-state=error]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}}
    .skill-update-check-badge[data-state=done]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
    @media (hover:hover){.skill-update-check-badge[data-state=done]:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent)}}
    .skill-update-check-badge:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    .skill-update-check-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .skill-update-check-errorMark{font-size:12px;font-weight:700;line-height:1}
    .skill-update-check-modal{max-height:100%}
    .skill-update-check-modalContent{min-height:0;overflow:auto}
    .skill-update-check-dialog{box-sizing:border-box;width:100%;min-width:0;flex-direction:column;gap:10px;display:flex}
    .skill-update-check-status{color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;margin:0;font-size:13px;line-height:20px;display:flex}
    .skill-update-check-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
    .skill-update-check-notice{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;margin:0;font-size:13px;line-height:20px;display:flex}
    .skill-update-check-failure{color:var(--dsw-alias-state-error-primary);align-items:flex-start;gap:6px;margin:0;font-size:13px;line-height:20px;display:flex;overflow-wrap:anywhere}
    .skill-update-check-failure>:first-child{flex:none;margin-top:3px}
    .skill-update-check-list{flex-direction:column;gap:2px;max-height:320px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}
    .skill-update-check-row{border-radius:var(--dsw-radius-md);align-items:center;gap:12px;min-height:40px;padding:4px 8px;display:flex}
    @media (hover:hover){.skill-update-check-row:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .skill-update-check-rowMain{flex:1 1 auto;min-width:0;flex-direction:column;gap:1px;display:flex}
    .skill-update-check-name{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:hidden}
    .skill-update-check-source{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;overflow:hidden}
    .skill-update-check-rowStatus{flex:none;color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;font-size:12px;line-height:18px;display:inline-flex}
    .skill-update-check-empty{flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:40px 16px;text-align:center;display:flex}
    .skill-update-check-emptyIcon{color:var(--dsw-alias-state-success-primary);display:inline-flex}
    .skill-update-check-emptyIconNeutral{color:var(--dsw-alias-label-tertiary);display:inline-flex}
    .skill-update-check-emptyTitle{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:500;line-height:20px}
    .skill-update-check-emptyHint{margin:0;max-width:40ch;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-wrap:balance}
    .skill-update-check-modified{color:var(--dsw-alias-state-warn-primary);align-items:center;gap:6px;margin:0;font-size:12px;line-height:18px;display:flex;overflow-wrap:anywhere}
    `;
    // .build/skill-update-check/client/index.js
    /**
    * `@buka/dsh-plugin-skill-update-check` 的浏览器一半。
    *
    * 只注册一个插槽：`conversation.composer.dock`——新建会话输入框卡片下方的
    * 统计行。提示在统计行里用 flex `order` 排到「上下文已用」圆环之后
    * （见 `styles.ts`）。组件在 `badge.ts`，点击后弹出的更新弹窗在 `dialog.ts`，
    * 更新任务在页面级的 `update-store.ts`（关掉弹窗也会继续），请求在 `api.ts`，
    * 文案在 `dictionary.ts`，样式在 `styles.ts`。提示只在当前工作区有项目技能
    * 更新时出现；点击打开弹窗，可逐个或一次性更新。
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
    	}), "skill-update-check: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-skill-update-check";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "skill-update-check: styles");
    	ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
    		name: "conversation.composer.dock",
    		id: "skill-update-check",
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
