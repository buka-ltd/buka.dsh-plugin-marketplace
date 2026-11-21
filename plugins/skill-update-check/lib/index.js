import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promises } from "node:fs";
import path from "node:path";
// .build/skill-update-check/check.js
/**
* 当前工作区项目技能的更新检查。
*
* DSH 的工作区目录里，由 `npx skills` 管理的项目 skill 记录在
* `skills-lock.json`（version 1 / 2）。插件只做一件事：调用 `skills` 包自带的
* CLI（与 `npx skills` 同一套实现）跑 `check -p -y`，把输出里的
* `↑ <name> has an update` 收成列表。
*
* 退出码约定与 CLI 一致：0 表示全部最新，1 表示有更新或本地修改（正常结论），
* 其它退出码或进程没启动起来才算检查失败。检查不写任何文件：CLI 只读 lock、
* 读安装目录、拉取来源里的 skill 列表。
*
* 全局 skill 与手工安装的 skill 不在范围内；那是 Skills 插件页面的职责。
*
* 本模块不 import React 与 DSH 包，`node --test` 可以直接 import。
*
* @module @buka/dsh-plugin-skill-update-check/check
*/
/** 项目级 lock 文件名与支持的版本。 */
const PROJECT_LOCK_FILE = "skills-lock.json";
/** CLI 输出上限；正常输出很小，这里只防异常刷屏。 */
const MAX_OUTPUT_BYTES = 1048576;
/** `skills check` 的固定参数：只检查项目作用域，非交互。 */
const CHECK_ARGS = [
	"check",
	"-p",
	"-y"
];
/**
* 去掉 ANSI 颜色 / 控制序列。
*
* @param text 原始文本
* @returns 不含 ANSI 转义的文本
*/
function stripAnsi(text) {
	return text.replace(/\u001b\[[0-9;]*m/gu, "");
}
/**
* 解析 `skills check` 的文本输出。
*
* CLI 没有 `--json`，但这两类行是稳定的：
* `↑ <name> has an update` 与 `✗ Failed to check skills from <source>`。
* 解析前先去掉 ANSI 颜色码，避免名字里混入转义。
*
* @param output CLI 的 stdout + stderr
* @returns 有更新的 skill 名与检查失败的来源
*/
function parseCheckOutput(output) {
	const updates = /* @__PURE__ */ new Set();
	const failedSources = [];
	for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
		const line = rawLine.trim();
		const update = /^↑ (.+) has an update$/u.exec(line);
		if (update?.[1] !== void 0) {
			updates.add(update[1].trim());
			continue;
		}
		const failed = /^✗ Failed to check skills from (.+)$/u.exec(line);
		if (failed?.[1] !== void 0) failedSources.push(failed[1].trim());
	}
	return {
		updates,
		failedSources
	};
}
/**
* 读取一个工作区的 `skills-lock.json`。
*
* 文件不存在表示这个工作区没有 npx 管理的项目 skill，是正常情况；文件损坏
* 或版本不认识时整体失败，绝不猜测状态。
*
* @param dir 工作区目录
* @returns lock 里的 skill 名，或失败原因
*/
async function readProjectLock(dir) {
	const file = path.join(dir, PROJECT_LOCK_FILE);
	let text;
	try {
		text = await promises.readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return {
			ok: true,
			names: []
		};
		return {
			ok: false,
			code: "lock-unreadable",
			message: `无法读取 ${file}：${errorText(error)}`
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			code: "lock-unreadable",
			message: `${file} 不是合法的 JSON：${errorText(error)}`
		};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {
		ok: false,
		code: "lock-unreadable",
		message: `${file} 不是合法的 JSON 对象。`
	};
	const record = parsed;
	if (record.version !== 1 && record.version !== 2 || record.skills === null || typeof record.skills !== "object" || Array.isArray(record.skills)) return {
		ok: false,
		code: "lock-unreadable",
		message: `${file} 的版本或结构不受支持。`
	};
	const names = [];
	for (const [name, raw] of Object.entries(record.skills)) {
		if (name.trim() === "") continue;
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
		const source = raw.source;
		if (typeof source !== "string" || source.trim() === "") continue;
		names.push(name);
	}
	return {
		ok: true,
		names
	};
}
/**
* 检查一个工作区里的项目 skill 是否有上游更新。
*
* @param options 工作区目录、CLI runner 与时钟
* @returns 检查快照，或失败原因
*/
async function checkProjectSkills(options) {
	const dir = path.resolve(options.dir);
	const now = options.now ?? Date.now;
	const lock = await readProjectLock(dir);
	if (!lock.ok) return lock;
	const checkedAt = now();
	if (lock.names.length === 0) return {
		ok: true,
		status: "no-project-skills",
		dir,
		total: 0,
		updates: [],
		checkedAt
	};
	const result = await (options.runner ?? createSkillsCliRunner())(CHECK_ARGS, { cwd: dir });
	const output = joinOutput(result);
	const failureOutput = stripAnsi(output).slice(-4e3);
	if (result.exitCode === null) return {
		ok: false,
		code: "cli-unavailable",
		message: `skills check 无法启动：${result.error ?? "未知原因"}`,
		...failureOutput === "" ? {} : { output: failureOutput }
	};
	if (result.exitCode > 1) return {
		ok: false,
		code: "check-failed",
		message: `skills check 失败（退出码 ${result.exitCode}）`,
		...failureOutput === "" ? {} : { output: failureOutput }
	};
	const updates = [...parseCheckOutput(output).updates].sort((left, right) => left.localeCompare(right));
	return {
		ok: true,
		status: updates.length === 0 ? "up-to-date" : "updates",
		dir,
		total: lock.names.length,
		updates,
		checkedAt
	};
}
/**
* 解析 `skills` 包自带 CLI 的绝对路径。
*
* 通过包的 `exports` 子路径解析，插件被安装到 profile 后仍能取到同一份依赖。
*
* @returns CLI 入口的绝对路径
*/
function resolveSkillsCliPath() {
	return createRequire(import.meta.url).resolve("skills/bin/cli.mjs");
}
/**
* 创建默认的 CLI 执行函数：`node <cli> check ...`，关闭遥测与颜色。
*
* 用 `node` 直接执行插件依赖里的 CLI，不经过 `npx`，也不依赖 PATH；与
* `npx skills` 使用的是同一份实现。
*
* @param options 超时、CLI 路径与基础环境
* @returns 调用 CLI 的函数
*/
function createSkillsCliRunner(options = {}) {
	const timeoutMs = options.timeoutMs ?? 12e4;
	const baseEnv = options.env ?? process.env;
	return (args, { cwd }) => new Promise((resolve) => {
		let cliPath;
		try {
			cliPath = options.cliPath ?? resolveSkillsCliPath();
		} catch (error) {
			resolve({
				exitCode: null,
				stdout: "",
				stderr: "",
				error: `找不到 skills CLI：${errorText(error)}`
			});
			return;
		}
		execFile(process.execPath, [cliPath, ...args], {
			cwd,
			timeout: timeoutMs,
			maxBuffer: MAX_OUTPUT_BYTES,
			env: {
				...baseEnv,
				DISABLE_TELEMETRY: "1",
				DO_NOT_TRACK: "1",
				NO_COLOR: "1",
				FORCE_COLOR: "0"
			}
		}, (error, stdout, stderr) => {
			resolve({
				exitCode: error === null ? 0 : typeof error.code === "number" ? error.code ?? null : null,
				stdout: String(stdout ?? ""),
				stderr: String(stderr ?? ""),
				...error === null ? {} : { error: error.message }
			});
		});
	});
}
/**
* 带缓存与并发合并的检查器。
*
* 同一个工作区在 {@link CHECK_TTL_MS} 内只跑一次 CLI；多个会话同时挂载时
* 共用同一个进行中的 Promise。只缓存成功结果，失败在下一次请求时重试。
*/
var SkillChecker = class {
	#runner;
	#ttlMs;
	#now;
	#cache = /* @__PURE__ */ new Map();
	#inFlight = /* @__PURE__ */ new Map();
	constructor(options = {}) {
		this.#runner = options.runner ?? createSkillsCliRunner();
		this.#ttlMs = options.ttlMs ?? 3e5;
		this.#now = options.now ?? Date.now;
	}
	/**
	* 检查一个工作区；`refresh` 为 true 时跳过缓存。
	*
	* @param dir 工作区目录
	* @param options 是否强制刷新
	* @returns 检查结果
	*/
	check(dir, options = {}) {
		const key = path.resolve(dir);
		if (options.refresh !== true) {
			const cached = this.#cache.get(key);
			if (cached !== void 0 && this.#now() - cached.at < this.#ttlMs) return Promise.resolve(cached.snapshot);
		}
		const running = this.#inFlight.get(key);
		if (running !== void 0) return running;
		const work = checkProjectSkills({
			dir: key,
			runner: this.#runner,
			now: this.#now
		}).then((result) => {
			if (result.ok) this.#cache.set(key, {
				at: this.#now(),
				snapshot: result
			});
			return result;
		}).finally(() => {
			this.#inFlight.delete(key);
		});
		this.#inFlight.set(key, work);
		return work;
	}
};
/** 拼 CLI 的 stdout / stderr；空片段不留下多余换行。 */
function joinOutput(result) {
	return [result.stdout, result.stderr].filter((text) => text !== "").join("\n");
}
/** 读错误对象上的可展示文本。 */
function errorText(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// packages/plugin-kit/lib/errors.js
/** 把任意错误转成可以展示给用户的文本。 */
function describeError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// packages/plugin-kit/lib/http.js
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
// .build/skill-update-check/workspace.js
/**
* 从会话解析「当前工作区」的目录。
*
* 浏览器一半只传会话 id，路径解析全在 Host：优先用工作区注册表里
* `sessionIds` 包含该会话的那条记录；拿不到时退回会话 header 的 `cwd`，并在
* 已注册工作区里找包含它的最长路径。这样即使会话是在工作区子目录里创建的，
* 检查的仍是工作区根目录的 `skills-lock.json`。
*
* 本模块只依赖 Node 内置模块，`node --test` 可以直接 import。
*
* @module @buka/dsh-plugin-skill-update-check/workspace
*/
/**
* 解析当前会话所在的工作区目录。
*
* @param input 会话 id、会话快照与可选的工作区注册表
* @returns 绝对目录；无法解析时返回 `undefined`
*/
function resolveWorkspaceDir(input) {
	const workspaces = listWorkspaces(input.registry);
	const attached = workspaces.find((workspace) => workspace.sessionIds.includes(input.sessionId));
	if (attached !== void 0) return attached.path;
	const cwd = absolutePath(input.session?.header?.cwd);
	if (cwd === void 0) return void 0;
	let best;
	for (const workspace of workspaces) {
		if (!isInside(cwd, workspace.path)) continue;
		if (best === void 0 || workspace.path.length > best.length) best = workspace.path;
	}
	return best ?? cwd;
}
/** 读注册表并只保留有绝对路径的条目；注册表不可用时返回空数组。 */
function listWorkspaces(registry) {
	if (registry === void 0) return [];
	let listed;
	try {
		listed = registry.list();
	} catch {
		return [];
	}
	if (!Array.isArray(listed)) return [];
	const workspaces = [];
	for (const raw of listed) {
		if (raw === null || typeof raw !== "object") continue;
		const dir = absolutePath(raw.path);
		if (dir === void 0) continue;
		workspaces.push({
			path: dir,
			sessionIds: Array.isArray(raw.sessionIds) ? raw.sessionIds : []
		});
	}
	return workspaces;
}
/** 只接受非空的绝对路径。 */
function absolutePath(value) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	if (text === "" || !path.isAbsolute(text)) return void 0;
	return path.resolve(text);
}
/** `target` 是否等于 `root` 或位于它下面。 */
function isInside(target, root) {
	const relative = path.relative(root, target);
	return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
// .build/skill-update-check/routes.js
/**
* 浏览器一半用的一条包内 HTTP 路由：检查当前会话所在工作区的项目技能。
*
* 路由只接受会话 id，不接受路径：当前工作区由 Host 从 `sessions` 与
* `workspaceRegistry` 解析，浏览器无法借此读取任意目录。请求沿用 web 组合的
* 信任栅栏（`connection.requestRejection`），只接受本机、已认证的浏览器请求。
*
* `refresh=1` 跳过 5 分钟缓存，对应提示上的一次点击。
*
* @module @buka/dsh-plugin-skill-update-check/routes
*/
/** 浏览器一半按同一常量访问。 */
const CHECK_ROUTE = "/buka-skill-update-check/status";
/** 会话 id 的宽松上限；真实 id 远小于它。 */
const MAX_SESSION_ID_LENGTH = 128;
/**
* 注册检查路由。
*
* @param ctx 插件上下文
* @param deps 入口装配好的检查器
*/
function registerRoutes(ctx, deps) {
	ctx.inject([
		"webServer",
		"connection",
		"sessions"
	], (webCtx) => {
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
			path: CHECK_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				const params = queryOf(req);
				const sessionId = sessionIdOf(params.get("sessionId"));
				if (sessionId === void 0) {
					sendError(res, 400, "invalid-session", "sessionId 缺失或非法");
					return;
				}
				let session;
				try {
					session = webCtx.sessions.get(sessionId);
				} catch {
					session = void 0;
				}
				const registry = registryOf(webCtx);
				const dir = resolveWorkspaceDir({
					sessionId,
					session,
					...registry === void 0 ? {} : { registry }
				});
				if (dir === void 0) {
					sendJson(res, 200, {
						ok: true,
						status: "unavailable",
						total: 0,
						updates: [],
						checkedAt: Date.now(),
						message: "当前会话没有可检查的工作区目录。"
					});
					return;
				}
				try {
					const checked = await deps.checker.check(dir, { refresh: params.get("refresh") === "1" });
					sendJson(res, checked.ok ? 200 : checked.code === "cli-unavailable" ? 503 : 500, checked);
				} catch (error) {
					sendError(res, 500, "check-failed", describeError(error));
				}
			}
		}), `buka-skill-update-check: GET ${CHECK_ROUTE}`);
	});
}
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
/** 工作区注册表是可选服务；取不到时退回会话 header 的 cwd。 */
function registryOf(ctx) {
	try {
		return ctx.get("workspaceRegistry");
	} catch {
		return;
	}
}
// .build/skill-update-check/index.js
/**
* `@buka/dsh-plugin-skill-update-check` 的 Host 一半。
*
* 浏览器一半只传会话 id，Host 解析出当前工作区后调用 `skills` 包自带的 CLI
* 检查项目技能是否有上游更新；有更新时浏览器在新建会话输入框下方显示
* warn 色提示。具体检查逻辑在 `check.ts`，工作区解析在 `workspace.ts`，
* HTTP 路由在 `routes.ts`。
*
* 本文件只装配：导出 Cordis 插件名、依赖与 `apply`。
*
* @module @buka/dsh-plugin-skill-update-check
*/
/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
const name = "check-buka-skill-update";
/** 依赖的服务：按会话解析当前工作区。 */
const inject = ["sessions"];
/**
* 装配：建立检查器并注册浏览器一半用的路由。
*
* @param ctx 插件上下文
*/
function apply(ctx) {
	registerRoutes(ctx, { checker: new SkillChecker() });
}
export { apply, inject, name };
