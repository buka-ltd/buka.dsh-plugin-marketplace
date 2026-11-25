import z from "@deepseek-ai/schemastery";
// packages/plugin-kit/lib/errors.js
/** 把任意错误转成可以展示给用户的文本。 */
function describeError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// packages/plugin-kit/lib/http.js
/**
* HTTP 路由的公共机制。
*
* 四个插件各自注册了几条 Host 路由，机制完全一样（读有上限的 JSON 请求体、
* 统一响应头、405），但**错误语义**按插件不同：有的回 `{ ok: false, message }`，
* 有的回 `{ ok: false, code, message }`。所以这里只共享机制，不共享错误口径——
* 各插件保留自己那层很薄的 `readJsonBody`，用这里的零件拼出来。
*/
/**
* 读请求的媒体类型：去掉参数、转小写。没有 content-type 时返回空字符串。
*/
function contentTypeOf(req) {
	const raw = req.headers["content-type"];
	return (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
/**
* 读取有上限的请求体；超过上限时丢弃剩余流并返回 `null`。
*
* 调用方拿 `null` 决定怎么回 413：状态码一样，响应体形状按插件自己的错误口径。
*/
async function readBoundedBody(req, maxBytes) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.byteLength;
		if (size > maxBytes) {
			req.resume();
			return null;
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks, size).toString("utf8");
}
/** 发送 JSON 响应。实时事实，不缓存。 */
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}
/** 发送带错误码的失败响应：`{ ok: false, code, message }`。 */
function sendError(res, status, code, message) {
	sendJson(res, status, {
		ok: false,
		code,
		message
	});
}
/** 405，并带上这个路由支持的方法。 */
function sendMethodNotAllowed(res, allow) {
	res.statusCode = 405;
	res.setHeader("allow", allow);
	res.end();
}
process.platform;
/**
* 解析 `/pen` 之后的原始输入。
*
* 与 `/plan` 对齐：不带参数表示开启，显式 `on` 也开启，`off` 关闭。
*
* @param rawInput 命令名之后的文本
* @returns 要执行的动作；语法不认识时返回 undefined
*/
function parsePenCommand(rawInput) {
	const input = typeof rawInput === "string" ? rawInput.trim().toLowerCase() : "";
	if (input === "" || input === "on") return "on";
	if (input === "off") return "off";
}
/**
* 把一次切换结果翻成命令卡片上的文本。
*
* @param action 刚才执行的动作
* @param snapshot 切换后的 Host 状态
* @param serverName MCP 服务名，用来拼出工具名前缀
* @returns 成功或失败结果
*/
function penCommandResult(action, snapshot, serverName) {
	if (action === "off") return {
		kind: "success",
		text: `Pen MCP 已关闭，本会话不再提供 mcp__${serverName}__* 工具。`
	};
	if (snapshot.status === "error") return {
		kind: "error",
		text: `Pen MCP 连接失败：${snapshot.message ?? "未知错误"}`
	};
	if (snapshot.status === "ready") return {
		kind: "success",
		text: `Pen MCP 已开启，本会话的下一轮消息可以使用 mcp__${serverName}__* 工具。`
	};
	return {
		kind: "success",
		text: "Pen MCP 已开启，会话开始后自动连接。"
	};
}
/**
* 执行一条 `/pen` 命令。
*
* @param source pen 状态源
* @param serverName MCP 服务名
* @param invocation 命令调用
* @returns 命令卡片上的结果
*/
async function runPenCommand(source, serverName, invocation) {
	const sessionId = typeof invocation.agent?.id === "string" ? invocation.agent.id : "";
	if (sessionId === "") return {
		kind: "error",
		text: "/pen 只能在一个会话里使用。"
	};
	const action = parsePenCommand(invocation.rawInput);
	if (action === void 0) return {
		kind: "error",
		text: "用法：/pen 开启 Pen MCP，/pen off 关闭。"
	};
	try {
		return penCommandResult(action, await source.setEnabled(sessionId, action === "on"), serverName);
	} catch (error) {
		return {
			kind: "error",
			text: `切换 Pen MCP 失败：${describeError(error)}`
		};
	}
}
/**
* 注册 `/pen` 命令；宿主没有 `commands` 服务时不注册。
*
* @param ctx 插件上下文
* @param source pen 状态源（Host 控制器）
* @param options 命令文案要用的配置
*/
function registerPenCommand(ctx, source, options) {
	ctx.inject(["commands"], (commandCtx) => {
		const commands = commandCtx.get("commands");
		if (commands === void 0 || typeof commands.register !== "function") {
			commandCtx.logger?.warn?.("pen: 宿主没有 commands 服务，/pen 命令不可用");
			return;
		}
		const dispose = commands.register({
			name: "pen",
			description: "开启或关闭本会话的 Pen MCP 工具：/pen 开启，/pen off 关闭。",
			handler: (invocation) => runPenCommand(source, options.serverName, invocation)
		});
		commandCtx.effect(() => dispose, "pen: /pen command");
	});
}
// .build/pen/state.js
/**
* 一个会话的 pen MCP 连接状态，以及浏览器一半读到的快照。
*
* 这里只有纯数据与纯函数：Host 的状态机在 `controller.ts`，路由在
* `routes.ts`。把快照形状单独放一层，测试与浏览器一半都不需要拉起 Cordis。
*
* @module @buka/dsh-plugin-pen/state
*/
/**
* 把一个会话状态投影成浏览器快照。
*
* - 未勾选 → `idle`；
* - 勾了但 Agent 还没创建 → `pending`（会话开始后自动连接）；
* - 已挂载 → `ready`；
* - 挂载失败 → `error`。
*
* @param state 会话状态；没有记录时视为未勾选
* @returns 供浏览器展示的快照
*/
function snapshotOf(state) {
	if (state === void 0 || !state.enabled) return {
		enabled: false,
		status: "idle"
	};
	if (state.error !== void 0) return {
		enabled: true,
		status: "error",
		message: state.error
	};
	if (state.mounted) return {
		enabled: true,
		status: "ready"
	};
	return {
		enabled: true,
		status: "pending"
	};
}
// .build/pen/controller.js
/**
* 按会话管理 pen MCP：勾选时把 `dsh-mcp-client` 挂进该 Agent 的作用域，
* 取消时卸载。工具只在勾选的会话里可见，不影响其它会话。
*
* 时机很关键：新会话框里的勾选发生在这条会话的 Agent 创建之前，所以不能
* 只靠「勾选时立刻挂载」。控制器记住勾选的会话 id，等 `agent/created` 再
* 挂载；该事件是串行的，且会话的排队输入会等监听器完成，因此勾选后的第一轮
* 消息就能看到工具。之后 Agent 被销毁时，作用域会连同 mcp-client 一起卸载。
*
* 挂载失败（例如 Pen.app 不在默认路径）不会让会话创建失败：错误记在会话
* 状态里并写日志，会话照常开始，只是没有 pen 工具。
*
* @module @buka/dsh-plugin-pen/controller
*/
/** 加载 DSH 自带的 mcp-client；按需加载，缺包时只影响 pen 功能。 */
let mcpClient;
function loadMcpClient() {
	mcpClient ??= import("@deepseek-ai/dsh-mcp-client").catch((error) => {
		mcpClient = void 0;
		throw error;
	});
	return mcpClient;
}
/** 把插件配置翻成 mcp-client 的 stdio 条目。 */
function stdioConfigOf(config) {
	return {
		transport: "stdio",
		serverName: config.serverName,
		command: config.command,
		args: [...config.args],
		env: { ...config.env },
		cwd: config.cwd,
		toolCallTimeoutMs: config.toolCallTimeoutMs,
		failOnStartupError: true
	};
}
/**
* 给挂载加一道自己的截止时间。
*
* `startupTimeoutMs` 在较早的 dsh-mcp-client 版本里还不是配置字段，所以不
* 交给它，而是在这里 race；超时后由调用方 dispose fiber，连接尝试随即结束。
*/
async function withDeadline(work, timeoutMs) {
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(/* @__PURE__ */ new Error(`连接 pen MCP 超时（${timeoutMs}ms）`));
		}, timeoutMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/** pen MCP 的会话控制器。 */
var PenController = class {
	ctx;
	config;
	sessions = /* @__PURE__ */ new Map();
	chains = /* @__PURE__ */ new Map();
	/**
	* @param ctx 插件上下文，需要 `agents` 与会话事件
	* @param config 解析后的插件配置
	*/
	constructor(ctx, config) {
		this.ctx = ctx;
		this.config = config;
	}
	/** 装配生命周期监听与卸载清理；由入口调用一次。 */
	watch() {
		this.ctx.on("agent/created", async ({ agent }) => {
			await this.onAgentCreated(agent);
		});
		this.ctx.on("agent/disposed", ({ agent }) => {
			this.onAgentDisposed(agent);
		});
		this.ctx.on("session/disposed", (session) => {
			this.onSessionDisposed(session.header.id);
		});
		this.ctx.effect(() => () => this.dispose(), "pen: mounts");
	}
	/** @inheritdoc */
	snapshot(sessionId) {
		return snapshotOf(this.stateOf(sessionId));
	}
	/** @inheritdoc */
	async setEnabled(sessionId, enabled) {
		return this.serialize(sessionId, async () => {
			const entry = this.entryOf(sessionId);
			if (!enabled) {
				entry.enabled = false;
				delete entry.error;
				await this.unmount(entry);
				return this.snapshot(sessionId);
			}
			entry.enabled = true;
			delete entry.error;
			if (entry.fiber === void 0) {
				const agent = this.ctx.agents.get(sessionId);
				if (agent !== void 0) await this.mount(entry, agent);
			}
			return this.snapshot(sessionId);
		});
	}
	/** 把内部状态投影成快照；不存在该会话时视为未勾选。 */
	stateOf(sessionId) {
		const entry = this.sessions.get(sessionId);
		if (entry === void 0) return void 0;
		return {
			enabled: entry.enabled,
			mounted: entry.fiber !== void 0,
			...entry.error === void 0 ? {} : { error: entry.error }
		};
	}
	/** 取或建立一个会话状态。 */
	entryOf(sessionId) {
		let entry = this.sessions.get(sessionId);
		if (entry === void 0) {
			entry = { enabled: false };
			this.sessions.set(sessionId, entry);
		}
		return entry;
	}
	/** 新 Agent 创建后，如果它的会话勾选了 pen，就挂载 MCP。 */
	async onAgentCreated(agent) {
		const sessionId = String(agent.id);
		const entry = this.sessions.get(sessionId);
		if (entry === void 0 || !entry.enabled) return;
		await this.serialize(sessionId, async () => {
			const current = this.sessions.get(sessionId);
			if (current === void 0 || !current.enabled || current.fiber !== void 0) return;
			await this.mount(current, agent);
		});
	}
	/** Agent 销毁时作用域已卸载 mcp-client，这里只清掉引用。 */
	onAgentDisposed(agent) {
		const entry = this.sessions.get(String(agent.id));
		if (entry === void 0) return;
		delete entry.fiber;
		delete entry.error;
	}
	/** 会话被移除时忘掉勾选，并确保连接关闭。 */
	onSessionDisposed(sessionId) {
		const id = String(sessionId);
		if (!this.sessions.has(id)) return;
		this.serialize(id, async () => {
			const entry = this.sessions.get(id);
			if (entry === void 0) return;
			this.sessions.delete(id);
			await this.unmount(entry);
		});
	}
	/** 在 Agent 作用域里挂载 mcp-client；失败只记录，不抛给 Agent 创建。 */
	async mount(entry, agent) {
		let fiber;
		try {
			const mcp = await loadMcpClient();
			fiber = agent.ctx.plugin(mcp, stdioConfigOf(this.config));
			entry.fiber = fiber;
			const ready = fiber.await();
			ready.catch(() => {});
			await withDeadline(ready, this.config.startupTimeoutMs);
			delete entry.error;
		} catch (error) {
			delete entry.fiber;
			entry.error = describeError(error);
			this.ctx.logger.warn(`pen: 连接 pen MCP 失败：${entry.error}`);
			if (fiber !== void 0) try {
				await fiber.dispose();
			} catch {}
		}
	}
	/** 卸载该会话的 mcp-client。 */
	async unmount(entry) {
		const fiber = entry.fiber;
		delete entry.fiber;
		if (fiber === void 0) return;
		try {
			await fiber.dispose();
		} catch (error) {
			this.ctx.logger.warn(`pen: 卸载 pen MCP 失败：${describeError(error)}`);
		}
	}
	/**
	* 串行化同一会话上的勾选、挂载与会话移除，避免两次点击或
	* `agent/created` 与 HTTP 请求同时改同一份状态。
	*/
	serialize(sessionId, work) {
		const run = (this.chains.get(sessionId) ?? Promise.resolve()).then(work, work);
		const tail = run.then(() => void 0, () => void 0);
		this.chains.set(sessionId, tail);
		tail.then(() => {
			if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId);
		});
		return run;
	}
	/** 插件卸载：等所有排队操作结束，再逐个关闭已挂载的连接。 */
	async dispose() {
		await Promise.allSettled([...this.chains.values()]);
		const entries = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(entries.map(async (entry) => this.unmount(entry)));
	}
};
// .build/pen/routes.js
/**
* 给浏览器一半用的包内 HTTP 路由：读一个会话的 pen 状态、勾选 / 取消勾选。
*
* 两条路由都沿用 web 组合的信任栅栏（`connection.requestRejection`）：
* 只接受本机、已认证的浏览器请求。请求体很小，超过 16 KiB 直接拒绝。
*
* @module @buka/dsh-plugin-pen/routes
*/
/** 读取状态的路由；浏览器一半按同一常量访问。 */
const STATE_ROUTE = "/pen/state";
/** 勾选 / 取消勾选的路由。 */
const TOGGLE_ROUTE = "/pen/toggle";
/** 两条路由的请求体都很小。 */
const MAX_BODY_BYTES = 16384;
/** 会话 id 的宽松上限；真实 id 远小于它。 */
const MAX_SESSION_ID_LENGTH = 128;
/** 解析 GET 查询串。 */
function queryOf(req) {
	try {
		return new URL(req.url ?? "/", "http://localhost").searchParams;
	} catch {
		return new URLSearchParams();
	}
}
/** 校验请求里的会话 id。 */
function sessionIdOf(value) {
	if (typeof value !== "string") return void 0;
	const id = value.trim();
	if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return void 0;
	return id;
}
/**
* 读 JSON 请求体；失败时已经写好响应，返回 `undefined` 让调用方直接返回。
*/
async function readJsonBody(req, res) {
	if (contentTypeOf(req) !== "application/json") {
		sendError(res, 415, "unsupported-media-type", "content-type 必须是 application/json");
		return;
	}
	const text = await readBoundedBody(req, MAX_BODY_BYTES);
	if (text === null) {
		sendError(res, 413, "body-too-large", "请求体过大");
		return;
	}
	try {
		return JSON.parse(text);
	} catch {
		sendError(res, 400, "invalid-json", "请求体不是合法 JSON");
		return;
	}
}
/**
* 注册两条路由。
*
* @param ctx 插件上下文
* @param source pen 状态源（Host 控制器）
*/
function registerRoutes(ctx, source) {
	ctx.inject(["webServer", "connection"], (webCtx) => {
		/** 复用 web 组合的信任栅栏；被拒绝时已经写好响应。 */
		function rejected(req, res) {
			let rejection;
			try {
				rejection = webCtx.connection.requestRejection(req);
			} catch {
				rejection = 500;
			}
			if (rejection === void 0) return false;
			res.statusCode = rejection;
			res.end();
			return true;
		}
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: STATE_ROUTE,
			handler: (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				const sessionId = sessionIdOf(queryOf(req).get("sessionId"));
				if (sessionId === void 0) {
					sendError(res, 400, "invalid-session", "sessionId 缺失或非法");
					return;
				}
				sendJson(res, 200, {
					ok: true,
					...source.snapshot(sessionId)
				});
			}
		}), `pen: GET ${STATE_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: TOGGLE_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const fields = body;
				const sessionId = sessionIdOf(fields?.sessionId);
				if (sessionId === void 0 || typeof fields?.enabled !== "boolean") {
					sendError(res, 400, "invalid-body", "需要 sessionId 与 enabled");
					return;
				}
				try {
					sendJson(res, 200, {
						ok: true,
						...await source.setEnabled(sessionId, fields.enabled)
					});
				} catch (error) {
					sendError(res, 500, "toggle-failed", describeError(error));
				}
			}
		}), `pen: POST ${TOGGLE_ROUTE}`);
	});
}
/** 插件配置：只在需要时启动 pen MCP。 */
const Config = z.object({
	/** MCP 服务名；决定工具名前缀 `mcp__<serverName>__`。 */
	serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("pencil"),
	/** stdio 可执行文件。 */
	command: z.string().min(1).default("/Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64"),
	/** 传给可执行文件的参数。 */
	args: z.array(z.string()).default([...["--app", "desktop"]]),
	/** 额外环境变量，合并到 DSH 清洗过的环境上。 */
	env: z.dict(z.string()).default({}),
	/** 子进程工作目录；空字符串表示继承 Host。 */
	cwd: z.string().default(""),
	/** 单次工具调用超时（毫秒）。 */
	toolCallTimeoutMs: z.number().min(1).default(6e4),
	/** 首次连接 + 拉取工具列表的预算（毫秒）；勾选后的首轮消息会等它。 */
	startupTimeoutMs: z.number().min(1).default(2e4)
});
// .build/pen/index.js
/**
* `@buka/dsh-plugin-pen` 的 Host 一半：把 pen MCP 变成按会话开启的能力。
*
* 两个入口都走同一个控制器：新会话框里的勾选框，以及会话进行中的 `/pen`
* 与 `/pen off` 命令。开启后，这条会话的 Agent 作用域里挂一个
* `@deepseek-ai/dsh-mcp-client`，工具（`mcp__pencil__*`）只对该会话可见；
* 没开启的会话看不到、也不会为它启动 pen 进程。具体时机与状态机在
* `controller.ts`，命令在 `command.ts`，HTTP 路由在 `routes.ts`。
*
* 本文件只装配：导出 Cordis 插件名、依赖、配置与 `apply`。
*
* @module @buka/dsh-plugin-pen
*/
/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
const name = "mcp-buka-pen";
/** 依赖的 DSH 服务：按会话拿 Agent、按会话事件跟进创建与销毁。 */
const inject = ["agents"];
/**
* 装配：建立控制器、监听 Agent 生命周期、注册浏览器一半用的路由。
*
* @param ctx 插件上下文
* @param config 解析后的配置
*/
function apply(ctx, config) {
	const pen = new PenController(ctx, config);
	pen.watch();
	registerPenCommand(ctx, pen, { serverName: config.serverName });
	registerRoutes(ctx, pen);
}
export { Config, apply, inject, name };
