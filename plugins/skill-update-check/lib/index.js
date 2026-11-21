import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promises } from "node:fs";
import path from "node:path";
// .build/skill-update-check/check.js
/**
* 当前工作区项目技能的更新检查与更新。
*
* DSH 的工作区目录里，由 `npx skills` 管理的项目 skill 记录在
* `skills-lock.json`（version 1 / 2）。插件只做两件事：调用 `skills` 包自带的
* CLI（与 `npx skills` 同一套实现）跑 `check -p -y`，把输出里的
* `↑ <name> has an update` 收成列表；用户确认后，对选中的 skill 逐个跑
* `update <name> -p -y`。
*
* 检查的退出码约定与 CLI 一致：0 表示全部最新，1 表示有更新或本地修改（正常
* 结论），其它退出码或进程没启动起来才算检查失败。检查是只读的：CLI 只读
* lock、读安装目录、拉取来源里的 skill 列表。更新会改写 lock 与安装目录，所以
* 只更新检查刚刚确认为「有更新」的那几个 skill，并且串行执行。
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
/** `skills update` 的固定参数：项目作用域、非交互；skill 名插在它们前面。 */
const UPDATE_FLAGS = ["-p", "-y"];
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
* CLI 没有 `--json`，但这三类行是稳定的：
* `↑ <name> has an update`、`✎ <name> has local changes` 与
* `✗ Failed to check skills from <source>`。解析前先去掉 ANSI 颜色码，避免
* 名字里混入转义。
*
* @param output CLI 的 stdout + stderr
* @returns 有更新的 skill 名、有本地修改的 skill 名与检查失败的来源
*/
function parseCheckOutput(output) {
	const updates = /* @__PURE__ */ new Set();
	const modified = /* @__PURE__ */ new Set();
	const failedSources = [];
	for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
		const line = rawLine.trim();
		const update = /^↑ (.+) has an update$/u.exec(line);
		if (update?.[1] !== void 0) {
			updates.add(update[1].trim());
			continue;
		}
		const changed = /^✎ (.+) has local changes$/u.exec(line);
		if (changed?.[1] !== void 0) {
			modified.add(changed[1].trim());
			continue;
		}
		const failed = /^✗ Failed to check skills from (.+)$/u.exec(line);
		if (failed?.[1] !== void 0) failedSources.push(failed[1].trim());
	}
	return {
		updates,
		modified,
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
			names: [],
			sources: {}
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
	const sources = {};
	for (const [name, raw] of Object.entries(record.skills)) {
		if (name.trim() === "") continue;
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
		const source = raw.source;
		if (typeof source !== "string" || source.trim() === "") continue;
		names.push(name);
		sources[name] = source.trim();
	}
	return {
		ok: true,
		names,
		sources
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
	const parsed = parseCheckOutput(output);
	const modified = [...parsed.modified].sort((left, right) => left.localeCompare(right));
	const modifiedSet = new Set(modified);
	const updates = [...parsed.updates].filter((name) => !modifiedSet.has(name)).sort((left, right) => left.localeCompare(right));
	const sources = {};
	for (const name of updates) {
		const source = lock.sources[name];
		if (source !== void 0) sources[name] = source;
	}
	return {
		ok: true,
		status: updates.length === 0 ? "up-to-date" : "updates",
		dir,
		total: lock.names.length,
		updates,
		...modified.length === 0 ? {} : { modified },
		...Object.keys(sources).length === 0 ? {} : { sources },
		checkedAt
	};
}
/**
* 逐个更新指定的项目 skill。
*
* 只跑 `skills update <name> -p -y`，不自己改 lock 或安装目录：更新逻辑、
* 来源解析与 lock 迁移都由 CLI 维护。任何一项失败都不影响后面的，失败项带上
* 输出尾部。名字由调用方先用一次检查筛过，所以这里不再判断它是否有更新。
*
* @param options 工作区目录、要更新的名字与 CLI runner
* @returns 成功与失败的 skill
*/
async function applySkillUpdates(options) {
	const dir = path.resolve(options.dir);
	const updated = [];
	const failed = [];
	for (const name of options.names) {
		const result = await options.runner([
			"update",
			name,
			...UPDATE_FLAGS
		], { cwd: dir });
		if (result.exitCode === 0) {
			updated.push(name);
			continue;
		}
		const base = result.exitCode === null ? `skills update 无法启动：${result.error ?? "未知原因"}` : `skills update 失败（退出码 ${result.exitCode}）`;
		const detail = lastOutputLine(stripAnsi(joinOutput(result)).slice(-4e3));
		failed.push({
			name,
			message: detail === "" ? base : `${base} ${detail}`
		});
	}
	return {
		updated,
		failed
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
* 带缓存、并发合并与串行更新的检查器。
*
* 检查：同一个工作区在 {@link CHECK_TTL_MS} 内只跑一次 CLI；多个会话同时挂载
* 时共用同一个进行中的 Promise。只缓存成功结果，失败在下一次请求时重试。
*
* 更新：先强制检查一次，只更新检查确认为「有更新」的 skill；更新会改写共享的
* lock 与安装目录，所以同一实例内的更新一律排队串行，绝不并发。更新完丢弃该
* 工作区的缓存并重新检查，把新快照一起返回。
*/
var SkillChecker = class {
	#runner;
	#updateRunner;
	#ttlMs;
	#now;
	#cache = /* @__PURE__ */ new Map();
	#inFlight = /* @__PURE__ */ new Map();
	/** 更新的串行队列：`skills update` 会整份重写 lockfile，不能并发。 */
	#updateQueue = Promise.resolve();
	constructor(options = {}) {
		this.#runner = options.runner ?? createSkillsCliRunner();
		this.#updateRunner = options.updateRunner ?? options.runner ?? createSkillsCliRunner({ timeoutMs: 18e4 });
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
	/**
	* 更新一个工作区里的项目 skill；省略 `skills` 表示检查得到的全部。
	*
	* 请求里的名字会先与一次强制检查的结果求交集：已经是最新、或者不在
	* `skills-lock.json` 里的名字不会传给 CLI。更新结束后重新检查并把结果带给
	* 调用方；单个 skill 失败不改变请求的整体成功。
	*
	* @param dir 工作区目录
	* @param options 要更新的 skill 名；省略表示全部
	* @returns 更新报告，或检查 / 更新本身的失败
	*/
	update(dir, options = {}) {
		const work = () => this.#applyUpdate(dir, options);
		const run = this.#updateQueue.then(work, work);
		this.#updateQueue = run.then(() => void 0, () => void 0);
		return run;
	}
	/**
	* 丢弃一个工作区的检查缓存，下一次 `check()` 重新跑 CLI。
	*
	* @param dir 工作区目录
	*/
	invalidate(dir) {
		this.#cache.delete(path.resolve(dir));
	}
	/** 排进队列之后的实际更新流程。 */
	async #applyUpdate(dir, options) {
		const before = await this.check(dir, { refresh: true });
		if (!before.ok) return before;
		const pending = new Set(before.updates);
		const requested = options.skills ?? before.updates;
		const names = [];
		for (const name of requested) {
			if (!pending.has(name) || names.includes(name)) continue;
			names.push(name);
		}
		const checkedDir = before.dir ?? path.resolve(dir);
		if (names.length === 0) return {
			ok: true,
			updated: [],
			failed: [],
			snapshot: before,
			message: "没有待更新的 skill。"
		};
		const applied = await applySkillUpdates({
			dir: checkedDir,
			names,
			runner: this.#updateRunner
		});
		this.invalidate(dir);
		const after = await this.check(dir, { refresh: true });
		const snapshot = after.ok ? after : snapshotWithout(before, applied.updated, this.#now());
		return {
			ok: true,
			updated: applied.updated,
			failed: applied.failed,
			snapshot,
			message: applied.failed.length === 0 ? `已更新 ${applied.updated.length} 个 skill。` : `已更新 ${applied.updated.length} 个 skill，${applied.failed.length} 个失败。`
		};
	}
};
/** 更新后的重新检查失败时，用更新前的快照减去成功项兜底。 */
function snapshotWithout(before, updated, checkedAt) {
	const removed = new Set(updated);
	const updates = before.updates.filter((name) => !removed.has(name));
	return {
		...before,
		status: updates.length === 0 ? "up-to-date" : "updates",
		updates,
		checkedAt
	};
}
/** 取输出的最后一行非空文本；用于把 CLI 的失败原因拼进消息。 */
function lastOutputLine(output) {
	return output.trim().split(/\r?\n/u).at(-1)?.trim() ?? "";
}
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
* 浏览器一半用的两条包内 HTTP 路由：检查与更新当前会话所在工作区的项目技能。
*
* - `GET /buka-skill-update-check/status` 检查；`refresh=1` 跳过 5 分钟缓存。
* - `POST /buka-skill-update-check/update` 更新；请求体是
*   `{ sessionId, skills? }`，省略 `skills` 表示更新检查得到的全部。名字会先
*   与一次强制检查的结果求交集，Host 不接受浏览器指定的路径。
*
* 路由只接受会话 id，不接受路径：当前工作区由 Host 从 `sessions` 与
* `workspaceRegistry` 解析，浏览器无法借此读写任意目录。请求沿用 web 组合的
* 信任栅栏（`connection.requestRejection`），只接受本机、已认证的浏览器请求。
*
* @module @buka/dsh-plugin-skill-update-check/routes
*/
/** 浏览器一半按同一常量访问。 */
const CHECK_ROUTE = "/buka-skill-update-check/status";
/** 更新路由；请求体只有会话 id 与若干 skill 名。 */
const UPDATE_ROUTE = "/buka-skill-update-check/update";
/** 会话 id 的宽松上限；真实 id 远小于它。 */
const MAX_SESSION_ID_LENGTH = 128;
/** 单个 skill 名的长度上限；真实名字远小于它。 */
const MAX_SKILL_NAME_LENGTH = 200;
/** 一次请求里最多接受的 skill 名数量，防止异常请求撑大请求体。 */
const MAX_SKILLS = 500;
/** 更新请求体的上限；只装一个会话 id 与若干名字。 */
const MAX_BODY_BYTES = 65536;
/**
* 注册检查与更新路由。
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
		/** 会话 id → 工作区目录；解析不出来时返回 undefined。 */
		function resolveDirFor(sessionId) {
			let session;
			try {
				session = webCtx.sessions.get(sessionId);
			} catch {
				session = void 0;
			}
			const registry = registryOf(webCtx);
			return resolveWorkspaceDir({
				sessionId,
				...session === void 0 ? {} : { session },
				...registry === void 0 ? {} : { registry }
			});
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
				const dir = resolveDirFor(sessionId);
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
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: UPDATE_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const record = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
				const sessionId = sessionIdOf(record.sessionId);
				if (sessionId === void 0) {
					sendError(res, 400, "invalid-session", "sessionId 缺失或非法");
					return;
				}
				const skills = skillsOf(record.skills);
				if (skills === null) {
					sendError(res, 400, "invalid-request", "skills 必须是 skill 名组成的非空数组");
					return;
				}
				const dir = resolveDirFor(sessionId);
				if (dir === void 0) {
					sendError(res, 409, "no-workspace", "当前会话没有可更新的工作区目录");
					return;
				}
				try {
					const result = await deps.checker.update(dir, skills === void 0 ? {} : { skills });
					sendJson(res, result.ok ? 200 : result.code === "cli-unavailable" ? 503 : 500, result);
				} catch (error) {
					sendError(res, 500, "update-failed", describeError(error));
				}
			}
		}), `buka-skill-update-check: POST ${UPDATE_ROUTE}`);
	});
}
/**
* 读取并解析 JSON 请求体。
*
* 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
* 返回 `undefined` 让调用方直接返回；合法 JSON 原样返回；`null` 也是合法 JSON。
*/
async function readJsonBody(req, res) {
	if (contentTypeOf(req) !== "application/json") {
		sendError(res, 415, "invalid-request", "content-type 必须是 application/json");
		return;
	}
	const text = await readBoundedBody(req, MAX_BODY_BYTES);
	if (text === null) {
		sendError(res, 413, "invalid-request", "请求体过大");
		return;
	}
	try {
		return JSON.parse(text);
	} catch {
		sendError(res, 400, "invalid-request", "请求体不是合法 JSON");
		return;
	}
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
/**
* 校验请求里的 skill 名数组。
*
* @returns 省略时 `undefined`（更新全部）；非法时 `null`；否则是去重后的名字
*/
function skillsOf(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SKILLS) return null;
	const names = [];
	for (const item of value) {
		if (typeof item !== "string") return null;
		const name = item.trim();
		if (name === "" || name.length > MAX_SKILL_NAME_LENGTH) return null;
		if (!names.includes(name)) names.push(name);
	}
	return names;
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
* 浏览器一半只传会话 id 与要更新的 skill 名，Host 解析出当前工作区后调用
* `skills` 包自带的 CLI 检查项目技能是否有上游更新，并在用户确认后逐个更新；
* 浏览器在新建会话输入框下方显示 warn 色提示，点击弹出更新弹窗。具体检查与
* 更新逻辑在 `check.ts`，工作区解析在 `workspace.ts`，HTTP 路由在 `routes.ts`。
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
