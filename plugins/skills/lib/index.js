import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { constants, promises } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
// packages/plugin-kit/lib/npx.js
/**
* 定位并执行 `npx skills`：安装、卸载与列清单共用。
*
* 桌面版 DSH 从 Finder / Dock 启动时，进程的 PATH 可能与登录 shell 不同（没有
* mise / nvm / Homebrew 的 shim），所以这里不直接 `spawn('npx')`，而是：
*
* 1. 先按 `PATH` 找 `npx`；
* 2. 再按常见 Node 安装位置找（mise、nvm、Volta、Homebrew、系统目录）；
* 3. 只有 `node` 时，用 node 直接跑 npm 自带的 `npx-cli.js`。
*
* 找不到任何入口就返回可读的失败原因，绝不让 npx 管理的 skill 退化成直接删
* 目录 —— 那会留下 lockfile 记录与其它 agent 目录里的链接。
*
* 子进程超时时先解析失败响应再杀进程组：npm exec 可能再 fork 一个子进程，
* 只杀直接子进程会让继承的管道一直开着、请求永远不返回。
*
* 两个插件的已知差异都保留成显式参数，不在这里悄悄统一：
*
* - 工作目录：skills 的全局安装固定在 `agentsHome` 下，workers 每次调用传项目
*   目录（`cwd` 既可以在工厂里绑定，也可以在调用时覆盖）；
* - 超时：skills 用默认的 120 s，workers 显式传 180 s；
* - 失败信息：找不到 npx 时的完整文案由调用方传入；命令名默认是
*   `npx skills`，workers 传一个按子命令生成的函数；
* - 「没跑到子进程」的失败（找不到 npx、spawn 直接抛错）是否带 `output: ''`：
*   workers 的返回形状要求有，skills 原本没有。
*
* 本模块只依赖 Node 内置模块，便于单独测试。
*/
/** 页面展示与失败信息里保留的命令输出上限。 */
const MAX_OUTPUT_BYTES = 4e3;
/** Windows 上 npm 的启动器是 `npx.cmd`，其余平台是 `npx`。 */
const NPX_EXECUTABLE = process.platform === "win32" ? "npx.cmd" : "npx";
/** 失败信息里的默认命令名。 */
const DEFAULT_NPX_LABEL = "npx skills";
/** CSI 转义序列（颜色、光标显隐、清行等）；ANSI 控制字符是这里要清理的目标。 */
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;
/** 命令输出里的回车符。 */
const CARRIAGE_RETURN = /\r/gu;
/**
* 生成调用 `npx skills` 的函数。
*
* 参数与 `uninstallGlobalSkill` / workers 安装路由里的 `runNpx` 一致：传入子命令
* 参数，解析为 `{ ok, message?, output? }`；不抛错（工作目录缺失属于调用方
* 编程错误，会直接抛出）。
*
* @param options 工作目录、超时、输出上限、失败文案等全部差异
* @returns 调用 `npx skills` 的函数
*/
function createNpxRunner(options) {
	const baseEnv = options.env ?? process.env;
	const timeoutMs = options.timeoutMs ?? 12e4;
	const maxOutputBytes = normalizeMaxOutputBytes(options.maxOutputBytes);
	return async function runNpx(args, cwd) {
		const commandArgs = Array.isArray(args) ? args : [];
		const workingDirectory = typeof cwd === "string" && cwd !== "" ? cwd : options.cwd;
		if (typeof workingDirectory !== "string" || workingDirectory === "") throw new Error("执行 npx 需要工作目录");
		const label = labelOf(options.label, commandArgs);
		const setupFailure = (message) => options.emptyOutputOnSetupFailure === true ? {
			ok: false,
			message,
			output: ""
		} : {
			ok: false,
			message
		};
		const resolved = await resolveNpxCommand(baseEnv);
		if (resolved === null) return setupFailure(options.missingMessage);
		return await new Promise((resolve) => {
			let child;
			let timer;
			let settled = false;
			/** 只结算一次：超时后 close 事件仍可能到来。 */
			const settle = (value) => {
				if (settled) return;
				settled = true;
				if (timer !== void 0) clearTimeout(timer);
				resolve(value);
			};
			try {
				child = spawn(resolved.command, [
					...resolved.prefixArgs,
					"--yes",
					"skills",
					...commandArgs
				], {
					cwd: workingDirectory,
					env: {
						...baseEnv,
						PATH: resolved.pathValue
					},
					stdio: [
						"ignore",
						"pipe",
						"pipe"
					],
					windowsHide: true,
					detached: process.platform !== "win32",
					shell: process.platform === "win32"
				});
			} catch (error) {
				settle(setupFailure(errorText$6(error)));
				return;
			}
			let output = "";
			const collect = (chunk) => {
				output = (output + chunk.toString()).slice(-maxOutputBytes);
			};
			child.stdout?.on("data", collect);
			child.stderr?.on("data", collect);
			timer = setTimeout(() => {
				const text = cleanOutput(output, maxOutputBytes);
				settle({
					ok: false,
					message: `${label} 超时（${Math.round(timeoutMs / 1e3)}s）`,
					output: text
				});
				killTree(child);
			}, timeoutMs);
			child.once("error", (error) => {
				settle({
					ok: false,
					message: errorText$6(error),
					output: cleanOutput(output, maxOutputBytes)
				});
			});
			child.once("close", (code, signal) => {
				const text = cleanOutput(output, maxOutputBytes);
				if (code === 0) {
					settle({
						ok: true,
						output: text
					});
					return;
				}
				const reason = signal === null || signal === void 0 ? `${label} 退出码 ${String(code)}` : `${label} 被信号 ${signal} 终止`;
				settle({
					ok: false,
					message: reason,
					output: text
				});
			});
		});
	};
}
/**
* 清理命令输出：去掉 ANSI 颜色、光标控制与回车，保留末尾一段。
*
* @param text 任意输出值；非字符串按空串处理
* @param maxBytes 保留的末尾字节数；默认 {@link MAX_OUTPUT_BYTES}
* @returns 清理后的文本
*/
function cleanOutput(text, maxBytes = MAX_OUTPUT_BYTES) {
	const limit = normalizeMaxOutputBytes(maxBytes);
	return (typeof text === "string" ? text : "").replace(ANSI_ESCAPE, "").replace(CARRIAGE_RETURN, "").trim().slice(-limit);
}
/**
* 找到可执行的 npx；找不到时返回 null。
*
* @param env 子进程环境
* @returns npx 入口；找不到时是 `null`
*/
async function resolveNpxCommand(env = process.env) {
	const dirs = await candidateDirs(env);
	const pathValue = dirs.join(path.delimiter);
	const npx = await findExecutable(NPX_EXECUTABLE, dirs);
	if (npx !== null) return {
		command: npx,
		prefixArgs: [],
		pathValue
	};
	const node = await findExecutable("node", dirs);
	if (node === null) return null;
	const npxCli = path.resolve(path.dirname(node), "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");
	if (await exists(npxCli)) return {
		command: node,
		prefixArgs: [npxCli],
		pathValue
	};
	return null;
}
/**
* 失败信息里的命令名：默认 `npx skills`；传函数时按本次调用的参数生成。
*
* @param label 配置的命令名
* @param args 本次调用的参数
* @returns 命令名
*/
function labelOf(label, args) {
	if (typeof label === "function") return label(args);
	if (typeof label === "string" && label !== "") return label;
	return DEFAULT_NPX_LABEL;
}
/**
* 输出上限归一化：不合法时回落到 {@link MAX_OUTPUT_BYTES}。
*
* @param value 配置的上限
* @returns 正整数上限
*/
function normalizeMaxOutputBytes(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : MAX_OUTPUT_BYTES;
}
/**
* 杀掉子进程；POSIX 上连同它的进程组，避免 npm exec 的子进程继续占着管道。
*
* @param child 要杀掉的子进程
*/
function killTree(child) {
	try {
		if (process.platform !== "win32" && typeof child.pid === "number") {
			process.kill(-child.pid, "SIGKILL");
			return;
		}
	} catch {}
	try {
		child.kill("SIGKILL");
	} catch {}
}
/**
* @param error 任意错误
* @returns 可以展示的错误文本
*/
function errorText$6(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* 收集可能放着 node/npx 的目录，按优先级去重。
*
* @param env 子进程环境
* @returns 候选目录
*/
async function candidateDirs(env) {
	const dirs = [];
	const seen = /* @__PURE__ */ new Set();
	const add = (dir) => {
		if (typeof dir !== "string" || dir === "" || seen.has(dir)) return;
		seen.add(dir);
		dirs.push(dir);
	};
	for (const dir of (env.PATH ?? "").split(path.delimiter)) add(dir);
	add(path.join(os.homedir(), ".local", "share", "mise", "shims"));
	add(path.join(os.homedir(), ".volta", "bin"));
	for (const base of [path.join(os.homedir(), ".local", "share", "mise", "installs", "node"), path.join(os.homedir(), ".nvm", "versions", "node")]) try {
		for (const version of await promises.readdir(base)) add(path.join(base, version, "bin"));
	} catch {}
	if (process.platform === "win32") {
		add(path.join(env.APPDATA ?? "", "npm"));
		add(path.join(env.LOCALAPPDATA ?? "", "Programs", "nodejs"));
		add(path.join(env.ProgramFiles ?? "", "nodejs"));
	} else for (const dir of [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin"
	]) add(dir);
	return dirs;
}
/**
* 在候选目录里找一个可执行文件。
*
* @param name 可执行文件名（不带路径）
* @param dirs 候选目录
* @returns 可执行文件路径；找不到时是 `null`
*/
async function findExecutable(name, dirs) {
	for (const dir of dirs) {
		const candidate = path.join(dir, name);
		try {
			if (!(await promises.stat(candidate)).isFile()) continue;
			await promises.access(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return null;
}
/**
* @param target 路径
* @returns 路径存在时为 true
*/
async function exists(target) {
	try {
		await promises.access(target);
		return true;
	} catch {
		return false;
	}
}
// packages/plugin-kit/lib/store.js
/**
* 插件的落盘小工具：原子写 JSON 与安全读取。
*
* 四个插件各自维护过一份「临时文件 + rename」的写法：临时文件名有三种方案，
* 权限 0600 只有一部分地方显式收紧。这里统一成「同目录临时文件 → rename、文件
* 权限 0600」，调用方只保留自己的业务语义（写什么、何时写、损坏怎么处理）。
*
* 目录权限不在统一之列：有的调用方需要把新建目录收紧到 0700（收藏与缓存
* 目录），有的保持默认，所以 `writeJsonAtomic` 用 `dirMode` 显式接收。
*
* 本模块只依赖 Node 内置模块，便于单独测试。
*/
/**
* 原子写 JSON：先写同目录临时文件，再 rename；失败时清理临时文件。
*
* 文件权限固定 0600：写入时带上 mode，再显式 chmod 一次（umask 可能削弱创建
* 权限；Windows 上 chmod 基本是空操作）。内容格式是两空格缩进 + 末尾换行，
* 与插件里原有的落盘格式一致。
*
* @param file 目标文件（目录不存在时会先创建）
* @param value 要写入的值
* @param options 目录权限等可选项
*/
async function writeJsonAtomic(file, value, options = {}) {
	const dir = path.dirname(file);
	if (options.dirMode === void 0) await promises.mkdir(dir, { recursive: true });
	else await promises.mkdir(dir, {
		recursive: true,
		mode: options.dirMode
	});
	const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		try {
			await promises.chmod(temporary, 384);
		} catch {}
		await promises.rename(temporary, file);
	} catch (error) {
		try {
			await promises.rm(temporary, { force: true });
		} catch {}
		throw error;
	}
}
// .build/skills/homes.js
/**
* DSH home 路径的解析。
*
* 两个全局 skills 根、`npx skills` 的 lockfile、插件自己的缓存与收藏文件都
* 放在这两个目录下，所以解析规则集中在这里：`DSH_AGENTS_HOME` / `DSH_HOME`
* 未设置时退回 `~/.agents` 与 `~/.dsh`，与 DSH 自己的默认值一致。
*
* @module @buka/dsh-plugin-skills/homes
*/
/** 共享 agent 配置目录名；`DSH_AGENTS_HOME` 未设置时用它拼出 `~/.agents`。 */
const AGENTS_DIR = ".agents";
/**
* 按 DSH home-paths 的习惯处理环境变量：去掉首尾空白，展开开头的 `~`。
*
* @param value 原始环境变量值
* @returns 规范化后的路径；空值时返回 null
*/
function envPath(value) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text === "") return null;
	if (text === "~") return os.homedir();
	if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2));
	return text;
}
/**
* 解析两个全局根目录的位置。与 DSH 自己的默认值保持一致：
* `dshHome` 取 `DSH_HOME` 或 `~/.dsh`，`agentsHome` 取 `DSH_AGENTS_HOME` 或 `~/.agents`。
*
* @param env 环境变量；测试时可传入
*/
function resolveHomes(env = process.env) {
	const home = os.homedir();
	return {
		agentsHome: envPath(env.DSH_AGENTS_HOME) ?? path.join(home, ".agents"),
		dshHome: envPath(env.DSH_HOME) ?? path.join(home, ".dsh")
	};
}
// .build/skills/http.js
/**
* 包内 HTTP 路由用到的请求 / 响应工具。
*
* 都是与业务无关的薄封装：解析查询串、读有上限的 JSON 请求体、发 JSON、
* 405 响应，以及把错误转成可展示的文本。路由处理自己不做这些细节。
*
* @module @buka/dsh-plugin-skills/http
*/
/** 卸载请求体很小（只有 scope 与 id），超过这个大小按恶意请求处理。 */
const MAX_BODY_BYTES = 65536;
/**
* 解析 GET 路由的查询串。
*/
function parseQuery(req) {
	try {
		return new URL(req.url ?? "/", "http://localhost").searchParams;
	} catch {
		return new URLSearchParams();
	}
}
/**
* 读取并解析 JSON 请求体。
*
* 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
* 返回 `undefined` 让调用方直接返回；`null` 是合法 JSON，原样返回。
*/
async function readJsonBody(req, res) {
	if (String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		sendJson(res, 415, {
			ok: false,
			message: "content-type 必须是 application/json"
		});
		return;
	}
	const text = await readBoundedBody(req);
	if (text === null) {
		sendJson(res, 413, {
			ok: false,
			message: "请求体过大"
		});
		return;
	}
	try {
		return JSON.parse(text);
	} catch {
		sendJson(res, 400, {
			ok: false,
			message: "请求体不是合法 JSON"
		});
		return;
	}
}
/**
* 把任意错误转成可以展示的文本。
*/
function describeError$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/** 发送 JSON 响应；数据是实时事实，不缓存。 */
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}
/** 405 并带上唯一支持的方法。 */
function sendMethodNotAllowed(res, allow) {
	res.statusCode = 405;
	res.setHeader("allow", allow);
	res.end();
}
/**
* 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
*/
async function readBoundedBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.byteLength;
		if (size > MAX_BODY_BYTES) {
			req.resume();
			return null;
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks, size).toString("utf8");
}
// .build/skills/install-targets.js
/**
* 全局之外的安装目标：打工人目录与工作区目录。
*
* 收藏页的「安装到打工人 / 安装到工作区」需要两份列表，两份都来自别的插件或
* 宿主服务，不能由浏览器传路径：
*
* - 打工人：`ctx.bukaWorkers`（workers 插件提供）的 `list()`。只保留智能体、
*   目录存在的打工人；机器人没有目录，装不了项目级 skill。
* - 工作区：`ctx.workspaceRegistry`（DSH 自带）的 `list()`，取已注册工作区的
*   规范路径与标题。
*
* 安装时按名字 / 路径在这两份列表里重新解析，解析结果只来自 Host 这次读到的
* 登记表。浏览器传来的字符串永远只当日志里的选择依据，不会被直接拼进
* `npx skills add` 的工作目录。
*
* 两个服务都是可选的：没装 workers 插件或运行在 headless 组合里时，对应列表
* 标记成 `available: false`，页面给出说明而不是整页失败。
*
* @module @buka/dsh-plugin-skills/install-targets
*/
/**
* 把任意错误转成一句话，避免服务抛出的非 Error 值让页面显示 `[object Object]`。
*
* @param error 抛出的值
*/
function describeError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* 安全地取一个可选服务：`ctx.get()` 在服务未提供时返回 undefined。
*
* @param ctx 插件上下文
* @param name 服务名
*/
function optionalService(ctx, name) {
	try {
		return ctx.get?.(name) ?? void 0;
	} catch {
		return;
	}
}
/**
* 规范化打工人列表：只要智能体、目录存在、名字与路径都非空的条目。
*
* workers 插件的 `list()` 返回 `workers` 数组，字段随版本可能增减；这里按字段
* 读取而不是依赖固定类型，旧版本缺 `exists` 时按「存在」处理（安装时还会再
* 确认一次目录）。
*
* @param result `bukaWorkers.list()` 的返回值
*/
function normalizeWorkers(result) {
	const workers = result?.workers;
	if (!Array.isArray(workers)) return [];
	const byName = /* @__PURE__ */ new Map();
	for (const value of workers) {
		if (value === null || typeof value !== "object") continue;
		const record = value;
		if (record.driver === "robot" || record.exists === false) continue;
		const name = typeof record.name === "string" ? record.name.trim() : "";
		const workerPath = typeof record.path === "string" ? record.path.trim() : "";
		if (name === "" || workerPath === "" || byName.has(name)) continue;
		byName.set(name, {
			name,
			path: workerPath,
			description: typeof record.description === "string" ? record.description : ""
		});
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
/**
* 规范化工作区列表：路径非空的都保留，标题缺失时用目录名兜底。
*
* @param result `workspaceRegistry.list()` 的返回值
*/
function normalizeWorkspaces(result) {
	if (!Array.isArray(result)) return [];
	const byPath = /* @__PURE__ */ new Map();
	for (const value of result) {
		if (value === null || typeof value !== "object") continue;
		const record = value;
		const workspacePath = typeof record.path === "string" ? record.path.trim() : "";
		if (workspacePath === "" || byPath.has(workspacePath)) continue;
		const title = typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim() : path.basename(workspacePath);
		byPath.set(workspacePath, {
			id: typeof record.id === "string" ? record.id : "",
			title,
			path: workspacePath
		});
	}
	return [...byPath.values()].sort((left, right) => left.title.localeCompare(right.title));
}
/**
* 读打工人列表；服务缺失时 `available: false`，读取失败时带上原因。
*
* @param ctx 插件上下文
*/
async function readWorkers(ctx) {
	const service = optionalService(ctx, "bukaWorkers");
	if (service === void 0 || typeof service?.list !== "function") return {
		available: false,
		error: null,
		items: []
	};
	try {
		return {
			available: true,
			error: null,
			items: normalizeWorkers(await service.list())
		};
	} catch (error) {
		return {
			available: true,
			error: describeError(error),
			items: []
		};
	}
}
/**
* 读工作区列表；注册表缺失时 `available: false`，读取失败时带上原因。
*
* 注册表的 `list()` 是同步的；服务尚未启动时可能抛错，按读取失败处理。
*
* @param ctx 插件上下文
*/
function readWorkspaces(ctx) {
	const registry = optionalService(ctx, "workspaceRegistry");
	if (registry === void 0 || typeof registry?.list !== "function") return {
		available: false,
		error: null,
		items: []
	};
	try {
		return {
			available: true,
			error: null,
			items: normalizeWorkspaces(registry.list())
		};
	} catch (error) {
		return {
			available: true,
			error: describeError(error),
			items: []
		};
	}
}
/**
* 收集页面选择框需要的两份目标列表。
*
* @param ctx 插件上下文
*/
async function listInstallTargets(ctx) {
	return {
		workers: await readWorkers(ctx),
		workspaces: readWorkspaces(ctx)
	};
}
/**
* 确认目标目录仍然存在，并把解析结果整理成安装流程使用的形状。
*
* @param directory 候选目录
* @param label 展示名（打工人名 / 工作区标题）
*/
async function confirmDirectory(directory, label) {
	let stat;
	try {
		stat = await promises.stat(directory);
	} catch {
		return {
			ok: false,
			code: "missing-target",
			message: `目标目录不存在：${directory}`
		};
	}
	if (!stat.isDirectory()) return {
		ok: false,
		code: "missing-target",
		message: `目标路径不是目录：${directory}`
	};
	return {
		ok: true,
		path: directory,
		label
	};
}
/**
* 安装时把浏览器选中的目标解析成一个可信目录。
*
* - 打工人按名字在 `ctx.bukaWorkers` 的列表里找；
* - 工作区按路径（也接受 id）在 `ctx.workspaceRegistry` 的列表里找。
*
* 找不到、服务缺失或目录已消失都返回稳定的错误码，由路由映射成 HTTP 状态码。
*
* @param ctx 插件上下文
* @param request 浏览器选中的目标
*/
async function resolveInstallTarget(ctx, request) {
	if (request?.target === "worker") {
		const name = typeof request.worker === "string" ? request.worker.trim() : "";
		if (name === "") return {
			ok: false,
			code: "invalid-target",
			message: "缺少打工人名称"
		};
		const workers = await readWorkers(ctx);
		if (!workers.available) return {
			ok: false,
			code: "workers-unavailable",
			message: "没有找到打工人插件（@buka/dsh-plugin-workers），无法安装到打工人"
		};
		if (workers.error !== null) return {
			ok: false,
			code: "workers-unavailable",
			message: workers.error
		};
		const found = workers.items.find((worker) => worker.name === name);
		if (found === void 0) return {
			ok: false,
			code: "unknown-worker",
			message: `没有找到这个打工人（可能只支持智能体）：${name}`
		};
		return confirmDirectory(found.path, found.name);
	}
	if (request?.target === "workspace") {
		const wanted = typeof request.workspace === "string" ? request.workspace.trim() : "";
		if (wanted === "") return {
			ok: false,
			code: "invalid-target",
			message: "缺少工作区路径"
		};
		const workspaces = readWorkspaces(ctx);
		if (!workspaces.available) return {
			ok: false,
			code: "workspaces-unavailable",
			message: "当前运行环境没有工作区注册表，无法安装到工作区"
		};
		if (workspaces.error !== null) return {
			ok: false,
			code: "workspaces-unavailable",
			message: workspaces.error
		};
		const found = workspaces.items.find((workspace) => workspace.path === wanted || workspace.id !== "" && workspace.id === wanted);
		if (found === void 0) return {
			ok: false,
			code: "unknown-workspace",
			message: `没有找到这个工作区（可能已被移除）：${wanted}`
		};
		return confirmDirectory(found.path, found.title);
	}
	return {
		ok: false,
		code: "invalid-target",
		message: `未知的安装目标：${String(request?.target)}`
	};
}
// .build/skills/frontmatter.js
/**
* SKILL.md 的 YAML frontmatter 解析。
*
* 只实现本项目需要的子集：单行标量、引号标量、`|` 保留换行块与 `>` 折行块，
* 以及 `metadata.internal` 的内部 skill 标记。frontmatter 缺失、没有对应字段、
* 或内容不是合法 frontmatter 时，字段返回空串 / false；解析失败不影响 skill
* 本身的列出，只影响展示用的元数据。
*
* 本模块只依赖字符串，不碰文件系统，便于单独测试。
*
* @module @buka/dsh-plugin-skills/frontmatter
*/
/**
* 从 SKILL.md 的 YAML frontmatter 里取 name 与 description。
*
* 只实现本项目需要的子集：单行标量、引号标量、`|` 保留换行块与 `>` 折行块。
* frontmatter 缺失、没有对应字段、或内容不是合法 frontmatter 时，两个字段都
* 返回空串；解析失败不影响 skill 本身的列出，只影响展示用的元数据。
*
* @param text SKILL.md 全文
*/
function parseFrontmatter(text) {
	const front = frontmatterLines(text);
	if (front === null) return {
		name: "",
		description: ""
	};
	return {
		name: parseFrontmatterField(front, "name"),
		description: parseFrontmatterField(front, "description")
	};
}
/**
* 取 frontmatter 内部的行（不含两侧 `---`）；不是合法 frontmatter 时返回 null。
*
* @param text SKILL.md 全文
*/
function frontmatterLines(text) {
	if (typeof text !== "string") return null;
	const lines = text.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n").split("\n");
	if (lines[0]?.trim() !== "---") return null;
	let end = -1;
	for (let index = 1; index < lines.length; index += 1) if (lines[index]?.trim() === "---") {
		end = index;
		break;
	}
	if (end < 0) return null;
	return lines.slice(1, end);
}
/**
* `metadata.internal: true` 的 skill 是内部 skill：`npx skills` 默认不列出它、
* 也不安装它（除非用户显式按名字请求）。这里跟随 CLI 的判定，只认 frontmatter
* 里 `metadata` 映射下的布尔 true（带引号的 `"true"` 是字符串，不算）。
*
* @param text SKILL.md 全文
*/
function parseFrontmatterInternal(text) {
	const front = frontmatterLines(text);
	if (front === null) return false;
	for (let index = 0; index < front.length; index += 1) {
		const match = /^metadata\s*:\s*(.*)$/u.exec(front[index] ?? "");
		if (match === null) continue;
		const inline = (match[1] ?? "").trim();
		if (inline.startsWith("{")) return /(?:^|[,{])\s*internal\s*:\s*(?:true|True|TRUE)\s*(?:[,}]|$)/u.test(inline);
		let childIndent = -1;
		for (let next = index + 1; next < front.length; next += 1) {
			const row = front[next] ?? "";
			if (row.trim() === "") continue;
			const indent = (/^\s*/u.exec(row)?.[0] ?? "").length;
			if (indent === 0) break;
			if (childIndent < 0) childIndent = indent;
			if (indent !== childIndent) continue;
			if (/^\s+internal\s*:\s*(?:true|True|TRUE)\s*(?:#.*)?$/u.test(row)) return true;
		}
		return false;
	}
	return false;
}
/**
* 取 frontmatter 里的一个顶层标量字段；缺失时返回空串。
*
* 字段值支持单行标量、引号标量与 YAML 的 `|` / `>` 块。只认同级缩进，
* 因此缩进在别的键下面的同名键不会被误取。
*
* @param front frontmatter 内部的行（不含两侧 `---`）
* @param key 字段名
*/
function parseFrontmatterField(front, key) {
	for (let index = 0; index < front.length; index += 1) {
		const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(front[index] ?? "");
		if (match === null || (match[1] ?? "") !== key) continue;
		const inline = (match[2] ?? "").trim();
		if (/^[|>][+-]?$/u.test(inline)) {
			const block = [];
			for (let next = index + 1; next < front.length; next += 1) {
				const row = front[next] ?? "";
				if (row.trim() === "") {
					block.push("");
					continue;
				}
				if (!/^\s+/u.test(row)) break;
				block.push(row.replace(/^\s+/u, ""));
			}
			if (inline.startsWith(">")) return block.map((row) => row.trim()).join(" ").replace(/\s+/gu, " ").trim();
			return block.join("\n").trim();
		}
		return stripQuotes(inline);
	}
	return "";
}
/**
* 从 SKILL.md 的 YAML frontmatter 里取 description。
*
* 保留这个导出是为了让已有的调用方（页面上的描述回退）不必关心 name；
* 实际解析交给 `parseFrontmatter()`，行为与之前一致。
*
* @param text SKILL.md 全文
*/
function parseFrontmatterDescription(text) {
	return parseFrontmatter(text).description;
}
/**
* 去掉 YAML 标量两侧的引号；普通标量原样返回。
*/
function stripQuotes(value) {
	if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) try {
		return JSON.parse(value);
	} catch {
		return value.slice(1, -1);
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
	return value;
}
// .build/skills/npx-lock.js
/**
* `npx skills` 全局 lockfile 的解析。
*
* `npx skills` 把全局安装记录写进自己的 lockfile：默认是
* `~/.agents/.skill-lock.json`，但设置了 `XDG_STATE_HOME` 时改写到
* `$XDG_STATE_HOME/skills/.skill-lock.json`（与 CLI 的 `getSkillLockPath()` 一致，
* 所以这里必须按同样的规则解析）。lockfile 是 `version: 3`，键是 skill 名。
*
* @module @buka/dsh-plugin-skills/npx-lock
*/
/** `npx skills` 的 lockfile 文件名。 */
const NPX_LOCK_FILE = ".skill-lock.json";
/**
* `npx skills` 的全局 lockfile 位置，规则与 CLI 的 `getSkillLockPath()` 一致：
* 设置了 `XDG_STATE_HOME` 时在 `$XDG_STATE_HOME/skills/`，否则在 `~/.agents/`。
*/
function lockFileFor(homes, env = process.env) {
	const xdgStateHome = envPath(env.XDG_STATE_HOME);
	return xdgStateHome === null ? path.join(homes.agentsHome, NPX_LOCK_FILE) : path.join(xdgStateHome, "skills", NPX_LOCK_FILE);
}
/**
* 读 `npx skills` 的全局 lockfile。
*
* - 文件不存在：`exists: false`，所有 skill 按手工安装展示；
* - 存在但无法解析 / 结构不对 / 版本比本模块认识的旧：`corrupt: true`，
*   `skills` 为空。此时**不能**据此判断某个 skill 不是 npx 管理的（CLI 会忽略
*   旧版本 lockfile，而旧记录里仍可能写着安装来源），卸载前要求先修复它。
*
* @param file lockfile 绝对路径
*/
async function readNpxLock(file) {
	let text;
	try {
		text = await promises.readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return {
			exists: false,
			path: file,
			version: null,
			skills: {},
			corrupt: false
		};
		return {
			exists: true,
			path: file,
			version: null,
			skills: {},
			corrupt: true
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			exists: true,
			path: file,
			version: null,
			skills: {},
			corrupt: true
		};
	}
	if (parsed === null || typeof parsed !== "object") return {
		exists: true,
		path: file,
		version: null,
		skills: {},
		corrupt: true
	};
	const record = parsed;
	if (record.skills === null || typeof record.skills !== "object") return {
		exists: true,
		path: file,
		version: null,
		skills: {},
		corrupt: true
	};
	const version = typeof record.version === "number" ? record.version : null;
	if (version === null || version < 3) return {
		exists: true,
		path: file,
		version,
		skills: {},
		corrupt: true
	};
	return {
		exists: true,
		path: file,
		version,
		skills: record.skills,
		corrupt: false
	};
}
/**
* 从 lockfile 记录里取出安装目录名（`skills/<name>/SKILL.md` 的 `<name>` 段）。
*
* @param skillPath lockfile 的 `skillPath`
*/
function folderOfSkillPath(skillPath) {
	if (typeof skillPath !== "string") return null;
	const segments = skillPath.split("/").filter((segment) => segment !== "");
	if (segments.length < 2 || segments[segments.length - 1] !== "SKILL.md") return null;
	return segments[segments.length - 2] ?? null;
}
/**
* 某个安装目录名对应的 npx lockfile 记录；找不到时返回 null。
*
* 先按 lock 键匹配（CLI 的规范目录名就是键），再兼容「规范目录名与键不同」的
* 情况：lock 记录的 `skillPath` 目录段也能说明它装进了哪个目录。列表与卸载都
* 用这一个判定，避免页面标了「npx skills」却走了直接删除分支。
*
* @param lock lockfile 的解析结果
* @param id 安装目录名
*/
function npxRecordFor(lock, id) {
	const direct = lock.skills[id];
	if (direct !== void 0) return direct !== null && typeof direct === "object" ? direct : {};
	for (const value of Object.values(lock.skills)) {
		if (value === null || typeof value !== "object") continue;
		if (folderOfSkillPath(value.skillPath) === id) return value;
	}
	return null;
}
// .build/skills/skill-store.js
/**
* 全局 skills 的读取与卸载。
*
* DSH 的 `dsh-skill-filesystem` 按固定优先级扫描几个本地根目录，其中两个是
* 「全局」的，对所有会话生效：
*
* | 来源 | 根目录 | 谁在写 |
* | --- | --- | --- |
* | `user-agents` | `<DSH_AGENTS_HOME 或 ~/.agents>/skills` | `npx skills -g` 与手工安装 |
* | `user-dsh` | `<DSH_HOME 或 ~/.dsh>/skills` | 手工安装 |
*
* `npx skills` 把全局安装记录写进自己的 lockfile：默认是
* `~/.agents/.skill-lock.json`，但设置了 `XDG_STATE_HOME` 时改写到
* `$XDG_STATE_HOME/skills/.skill-lock.json`（与 CLI 的 `getSkillLockPath()` 一致，
* 所以这里必须按同样的规则解析）。lockfile 是 `version: 3`，键是 skill 名。
*
* CLI 还把 skill 的「规范副本」放在 `~/.agents/skills/<name>`，其它 agent 目录
* （如 `~/.claude/skills`）只是指向规范副本的符号链接。因此「是否被 npx skills
* 管理」由两条一起判定：skill 位于 `~/.agents/skills` 下，且能在 lockfile 里
* 找到对应记录。
*
* 描述优先取 `ctx.skills.list()` 的摘要；摘要缺失（注册表不可用、路径未命中）
* 时回退到直接解析 `SKILL.md` 的 YAML frontmatter，保证页面上总能显示
* skill 自己的 description。
*
* home 路径与 lockfile 解析分别由 `src/homes.ts`、`src/npx-lock.ts` 提供，
* frontmatter 解析在 `src/frontmatter.ts`；这里只保留扫描、汇总与卸载。
*
* 本模块只依赖 Node 内置模块，不 import DSH 包，便于单独测试。
*
* @module @buka/dsh-plugin-skills/skill-store
*/
/**
* 两个全局 skills 根目录，按 DSH 的优先级排列（`user-dsh` 高于 `user-agents`）。
*/
function globalRoots(homes) {
	return [{
		scope: "dsh",
		skillsDir: path.join(homes.dshHome, "skills")
	}, {
		scope: "agents",
		skillsDir: path.join(homes.agentsHome, "skills")
	}];
}
/**
* skill 目录名只允许字母、数字、点、下划线与连字符，且不能以点开头。
* 这样 `..`、路径分隔符和隐藏目录都不会被当成 skill 名传给删除逻辑。
*/
function isSafeSkillId(id) {
	return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id);
}
/**
* 判断路径是否存在（含符号链接目标）。
*/
async function pathExists$1(target) {
	try {
		await promises.access(target);
		return true;
	} catch {
		return false;
	}
}
function errorText$5(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* 扫描一个 skills 根目录的**直接子项**，与 `dsh-skill-filesystem` 的目录结构一致：
* 目录形式的 `<name>/SKILL.md`，或平铺的 `<name>.md`；不递归，跳过隐藏项与
* 根目录下的 `SKILL.md`。同一名字既有目录又有平铺文件时保留目录。
*/
async function scanRoot(root) {
	let dirents;
	try {
		dirents = await promises.readdir(root.skillsDir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	const byId = /* @__PURE__ */ new Map();
	for (const dirent of dirents) {
		if (dirent.name.startsWith(".")) continue;
		const full = path.join(root.skillsDir, dirent.name);
		let stat;
		try {
			stat = await promises.stat(full);
		} catch {
			continue;
		}
		let entry;
		if (stat.isDirectory()) {
			const file = path.join(full, "SKILL.md");
			if (!await pathExists$1(file)) continue;
			entry = {
				id: dirent.name,
				scope: root.scope,
				kind: "directory",
				path: full,
				file
			};
		} else if (stat.isFile() && dirent.name.endsWith(".md") && dirent.name !== "SKILL.md") entry = {
			id: dirent.name.slice(0, -3),
			scope: root.scope,
			kind: "file",
			path: full,
			file: full
		};
		else continue;
		const existing = byId.get(entry.id);
		if (existing === void 0 || existing.kind === "file" && entry.kind === "directory") byId.set(entry.id, entry);
	}
	return [...byId.values()];
}
/**
* 直接读 SKILL.md 取 description；文件读不了时返回空串。
*
* @param file SKILL.md 绝对路径
*/
async function readSkillDescription(file) {
	try {
		return parseFrontmatterDescription(await promises.readFile(file, "utf8"));
	} catch {
		return "";
	}
}
/**
* 收集两个全局根目录下的全部 skills，并标注哪些由 `npx skills` 管理。
*
* `summaries` 来自 `ctx.skills.list()`：用它补上 DSH 解析过的 `description` 等
* 元数据；列表本身以磁盘扫描为准，这样刚删掉的条目不会因为 registry 缓存而
* 继续出现，刚装上的条目也不依赖 watcher 的时序。某个根读不了时跳过它，
* 在 `warnings` 里说明，而不是让整页失败。
*/
async function collectGlobalSkills({ homes = resolveHomes(), summaries = [], env = process.env } = {}) {
	const lock = await readNpxLock(lockFileFor(homes, env));
	const roots = globalRoots(homes);
	const scanned = [];
	const warnings = [];
	for (const root of roots) try {
		scanned.push(...await scanRoot(root));
	} catch (error) {
		warnings.push(`${root.skillsDir}: ${errorText$5(error)}`);
	}
	const idCounts = /* @__PURE__ */ new Map();
	for (const entry of scanned) idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
	const byFile = /* @__PURE__ */ new Map();
	const byName = /* @__PURE__ */ new Map();
	for (const summary of summaries) {
		if (typeof summary?.name !== "string") continue;
		byName.set(summary.name, summary);
		if (typeof summary.path === "string") byFile.set(path.resolve(summary.path), summary);
	}
	const skills = [];
	for (const entry of scanned) {
		const summary = byFile.get(path.resolve(entry.file)) ?? (idCounts.get(entry.id) === 1 ? byName.get(entry.id) : void 0) ?? null;
		const summaryName = summary?.name;
		const name = typeof summaryName === "string" ? summaryName : entry.id;
		const npx = entry.scope === "agents" ? npxRecordFor(lock, entry.id) : null;
		const summaryDescription = summary?.description;
		const description = typeof summaryDescription === "string" && summaryDescription !== "" ? summaryDescription : await readSkillDescription(entry.file);
		skills.push({
			id: entry.id,
			name,
			description,
			scope: entry.scope,
			kind: entry.kind,
			path: entry.path,
			managedByNpx: npx !== null,
			npxSource: typeof npx?.source === "string" ? npx.source : null,
			npxSourceUrl: typeof npx?.sourceUrl === "string" ? npx.sourceUrl : null,
			npxInstalledAt: typeof npx?.installedAt === "string" ? npx.installedAt : null,
			npxUpdatedAt: typeof npx?.updatedAt === "string" ? npx.updatedAt : null
		});
	}
	skills.sort((a, b) => a.name.localeCompare(b.name));
	return {
		skills,
		homes,
		roots: roots.map((root) => ({
			scope: root.scope,
			path: root.skillsDir
		})),
		lock: {
			exists: lock.exists,
			path: lock.path,
			version: lock.version,
			corrupt: lock.corrupt
		},
		warnings
	};
}
/**
* 按「来源」选卸载方式：
*
* - `npx skills` 管理（位于 `~/.agents/skills` 且在该工具的 lockfile 里）：
*   交给 `npx skills remove <name> --global --yes`，由它同时清理规范副本、
*   各 agent 目录里的链接与 lockfile 记录；
* - 其它（手工安装，或 `~/.dsh/skills` 下的 skill）：直接删除扫描到的目录或文件。
*
* lockfile 存在却读不出来时，agents 根下的 skill 一律拒绝卸载：这时无法判断
* 它是否由 npx 管理，直接删目录会留下 lock 记录与悬空链接。两种方式都会在
* 最后确认目标真的消失了；工具退出码为 0 但目录仍在时按失败上报。
*/
async function uninstallGlobalSkill({ homes = resolveHomes(), scope, id, runNpx, env = process.env }) {
	if (scope !== "agents" && scope !== "dsh") return {
		ok: false,
		code: "invalid-scope",
		message: `未知的 skills 位置：${String(scope)}`
	};
	if (!isSafeSkillId(id)) return {
		ok: false,
		code: "invalid-id",
		message: `非法的 skill 名称：${String(id)}`
	};
	if (typeof runNpx !== "function") return {
		ok: false,
		code: "no-runner",
		message: "缺少执行 npx 的能力"
	};
	const root = globalRoots(homes).find((one) => one.scope === scope);
	if (root === void 0) return {
		ok: false,
		code: "invalid-scope",
		message: `未知的 skills 位置：${String(scope)}`
	};
	let entry;
	try {
		entry = (await scanRoot(root)).find((one) => one.id === id);
	} catch (error) {
		return {
			ok: false,
			code: "scan-failed",
			message: `无法读取 ${root.skillsDir}：${errorText$5(error)}`
		};
	}
	if (entry === void 0) return {
		ok: false,
		code: "not-found",
		message: `没有找到这个 skill，可能已经被删除：${id}`
	};
	if (entry.scope === "agents") {
		const lock = await readNpxLock(lockFileFor(homes, env));
		if (lock.corrupt) return {
			ok: false,
			code: "lock-unreadable",
			message: `无法读取 npx skills 的 lockfile（${lock.path}），无法判断这个 skill 是否由它管理；请先修复或删除该文件，再用 npx skills 处理`
		};
		if (npxRecordFor(lock, id) !== null) {
			let result;
			try {
				result = await runNpx([
					"remove",
					id,
					"--global",
					"--yes"
				]);
			} catch (error) {
				return {
					ok: false,
					code: "npx-failed",
					message: errorText$5(error)
				};
			}
			if (!result?.ok) return {
				ok: false,
				code: "npx-failed",
				message: result?.message ?? "npx skills remove 失败",
				output: result?.output ?? ""
			};
			if (await pathExists$1(entry.path)) return {
				ok: false,
				code: "npx-incomplete",
				message: "npx skills remove 已退出，但 skill 目录仍然存在",
				output: result.output ?? ""
			};
			return {
				ok: true,
				method: "npx",
				output: result.output ?? ""
			};
		}
	}
	try {
		await promises.rm(entry.path, {
			recursive: true,
			force: true
		});
	} catch (error) {
		return {
			ok: false,
			code: "remove-failed",
			message: errorText$5(error)
		};
	}
	if (await pathExists$1(entry.path)) return {
		ok: false,
		code: "remove-incomplete",
		message: "删除后 skill 仍然存在"
	};
	return {
		ok: true,
		method: "local"
	};
}
// .build/skills/repo-store.js
/**
* 「收藏的 skill 来源」的读写。
*
* 页面第二个 Tab 让用户记下以后想用的 skill 来源，方便随时取用。这份清单是
* 用户自己的书签，和已安装的 skill 无关：装不装、装在哪，仍由 `npx skills` 决定。
*
* 来源分五类（`classifyRepoSource()`）：
*
* - `github`：GitHub 仓库（`owner/repo`、GitHub 链接、`git@github.com:o/r.git`），
*   规范化为 `owner/repo`；
* - `git`：任意 git 远端（GitHub 之外的 http(s)/ssh/git 地址、`git@host:path`），
*   保留原样（只去掉结尾斜杠）；
* - `local`：本地绝对路径（POSIX `/…`、Windows 盘符、`file://` URL），规范化为
*   绝对路径；
* - `web`：已知不是仓库的网页链接（如 GitHub 仓库的子页面），只当书签；
* - `package`：npm 包名（如 `notion`、`@scope/pkg`），只当书签。
*
* 前三种能让 Host 列出仓库里的 skills 并展开成树，后两种不能。
*
* 数据放在 DSH home 下的一个 JSON 文件里（`<DSH_HOME 或 ~/.dsh>/buka-skills/repos.json`），
* 不放进 `~/.agents/skills`，避免被当成 skill 根目录的一部分；也不进 session 事件。
*
* - 写入是原子的（同目录临时文件 + rename），失败不会留下半个文件；
* - 文件存在但无法解析时**不覆盖**：返回 `corrupt`，页面提示用户先修复，
*   否则「添加一条」会悄悄清掉其它收藏；
* - 来源在写入前规范化，用规范化后的小写值做 `id`，因此同一仓库的大小写/链接
*   形式不会重复收藏。
*
* 本模块只依赖 Node 内置模块，便于单独测试。
*
* @module @buka/dsh-plugin-skills/repo-store
*/
/** 收藏文件所在目录（DSH home 下），与 skills 根目录分开。 */
const REPO_STORE_DIR = "buka-skills";
/** 收藏文件名。 */
const REPO_STORE_FILE = "repos.json";
/** `owner/repo`：GitHub 仓库的简写，也是 `npx skills add` 最常用的来源。 */
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u;
/** npm 作用域包名，如 `@scope/pkg`；同上，交给 npx 解析。 */
const SCOPED_PACKAGE = /^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/u;
/** 无斜杠的 npm 包名，如 `notion`。 */
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/** 带协议头的远端地址；`file://` 单独按本地路径处理。 */
const REMOTE_URL = /^(?:https?|ssh|git):\/\//iu;
/** GitHub 的仓库链接（可带协议与 `www.`，可带 `.git` 与结尾斜杠）。 */
const GITHUB_REPO = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/iu;
/** GitHub 的 SCP / ssh 形式，如 `git@github.com:owner/repo.git`。 */
const GITHUB_SCP = /^(?:ssh:\/\/)?git@github\.com[:/]([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/iu;
/**
* SCP 形式的 git 地址：`[user@]host:path`。host 至少两个字符，避免把盘符
* `C:` 误判成主机名；`(?!\/\/)` 排除 `https://` 这类协议头。
*/
const GIT_SCP = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]+:(?!\/\/)\S+$/u;
/** 本地绝对路径：POSIX 以 `/` 开头；Windows 盘符/UNC 只在 win32 上算。 */
const POSIX_ABSOLUTE = /^\//u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\[^\\]+\\/u;
/** 控制字符（含换行、制表符）一律不允许，JSON 里也不该出现。 */
const CONTROL = /[\u0000-\u001f\u007f]/u;
/**
* 收藏文件的绝对路径。
*
* @param homes `resolveHomes()` 的结果
*/
function repoStoreFile(homes) {
	return path.join(homes.dshHome, REPO_STORE_DIR, REPO_STORE_FILE);
}
/**
* 解析并规范化一个 skill 来源。
*
* 接受：
* - GitHub 仓库：`owner/repo`、`github.com/owner/repo`、`https://github.com/owner/repo`、
*   `git@github.com:owner/repo.git`（统一收敛成 `owner/repo`）；
* - 任意 git 地址：非 GitHub 的 http(s)、`ssh://`、`git://`、`git@host:path`
*   （保留原样，由 Host 交给 `git clone`）；
* - 本地绝对路径：POSIX `/…`、Windows `C:\…` / `C:/…`（仅 win32）、`file://` URL；
* - 其它网页链接（目前只识别 GitHub 子页面，如 `/tree/…`）与 npm 包名，只能当书签。
*
* 拒绝控制字符、超长文本与 `-` 开头的字符串：来源最终会出现在
* `npx skills add <source>` / `git clone <source>` 命令里，不能以选项形式被解析。
* 非本地路径还拒绝空白；本地绝对路径允许空格（Host 用 fs 直接读，不经过 shell）。
*/
function classifyRepoSource(value) {
	if (typeof value !== "string") return { ok: false };
	const text = value.trim();
	if (text === "" || text.length > 300) return { ok: false };
	if (CONTROL.test(text) || text.startsWith("-")) return { ok: false };
	if (/^file:\/\//iu.test(text)) {
		const localPath = localPathOfFileUrl(text);
		return localPath === null ? { ok: false } : localSource(localPath);
	}
	if (isLocalAbsolutePath(text)) return localSource(text);
	const github = githubRepoParts(text);
	if (github !== null) return githubSource(github.owner, github.repo);
	if (REMOTE_URL.test(text)) {
		let url;
		try {
			url = new URL(text);
		} catch {
			return { ok: false };
		}
		const source = trimTrailingSlashes(text);
		if (isGithubHost(url.hostname)) return {
			ok: true,
			kind: "web",
			source,
			listable: false
		};
		return {
			ok: true,
			kind: "git",
			source,
			listable: true
		};
	}
	if (GIT_SCP.test(text)) return {
		ok: true,
		kind: "git",
		source: trimTrailingSlashes(text),
		listable: true
	};
	if (/\s/u.test(text)) return { ok: false };
	if (OWNER_REPO.test(text)) {
		const [owner, repo] = text.split("/");
		if (owner !== void 0 && repo !== void 0) return githubSource(owner, repo);
		return { ok: false };
	}
	if (SCOPED_PACKAGE.test(text) || PACKAGE.test(text)) return {
		ok: true,
		kind: "package",
		source: text,
		listable: false
	};
	return { ok: false };
}
/**
* 规范化并校验一个 skill 来源；不合法时返回 null。
*
* 保留这个入口是为了兼容既有调用方和单测：它只返回规范化后的来源字符串，
* 需要知道来源种类（GitHub / git / 本地 / 网页 / 包名）时用
* `classifyRepoSource()`。
*/
function normalizeRepoSource(value) {
	const classified = classifyRepoSource(value);
	return classified.ok ? classified.source : null;
}
/**
* 从 `owner/repo` 形式或 GitHub 链接里取仓库两段；不是 GitHub 仓库时返回 null。
*
* @param text 已 trim 的来源
*/
function githubRepoParts(text) {
	for (const pattern of [GITHUB_REPO, GITHUB_SCP]) {
		const match = pattern.exec(text);
		if (match !== null) {
			const owner = match[1];
			const repo = match[2];
			if (owner !== void 0 && repo !== void 0) return {
				owner,
				repo
			};
		}
	}
	return null;
}
/**
* @param hostname `new URL()` 解析出的主机名
*/
function isGithubHost(hostname) {
	return hostname === "github.com" || hostname === "www.github.com";
}
/**
* `file://` URL → 本地绝对路径；不是本机绝对路径（如带远端主机名）时返回 null。
*/
function localPathOfFileUrl(text) {
	let localPath;
	try {
		localPath = fileURLToPath(text);
	} catch {
		return null;
	}
	return isLocalAbsolutePath(localPath) ? localPath : null;
}
/**
* 是不是本平台的绝对路径。Windows 形式只在 win32 上算：在 POSIX 上把
* `C:\foo` 当成路径没有意义，也会和 SCP 形式混淆。
*/
function isLocalAbsolutePath(text) {
	if (POSIX_ABSOLUTE.test(text)) return true;
	if (process.platform !== "win32") return false;
	return WINDOWS_ABSOLUTE.test(text) || UNC_ABSOLUTE.test(text);
}
/**
* 把绝对路径规范化：折叠 `.` / `..` 与重复分隔符，去掉结尾斜杠（根保留）。
*/
function canonicalLocalPath(text) {
	let normalized;
	try {
		normalized = path.normalize(text);
	} catch {
		return null;
	}
	if (!path.isAbsolute(normalized)) return null;
	const root = path.parse(normalized).root;
	if (normalized === root) return normalized;
	return normalized.replace(/[\\/]+$/u, "");
}
function githubSource(owner, repo) {
	return {
		ok: true,
		kind: "github",
		source: `${owner}/${repo}`,
		listable: true
	};
}
function localSource(text) {
	const normalized = canonicalLocalPath(text);
	if (normalized === null || normalized.length > 300) return { ok: false };
	return {
		ok: true,
		kind: "local",
		source: normalized,
		listable: true
	};
}
/**
* 去掉结尾斜杠；整串都是斜杠时保持原样。
*/
function trimTrailingSlashes(text) {
	const stripped = text.replace(/\/+$/u, "");
	return stripped === "" ? text : stripped;
}
/**
* 收藏项的去重键：规范化后的小写值。列表、添加与删除都用它，保证
* `Foo/Bar`、`https://github.com/foo/bar` 与 `foo/bar` 是同一条。
*
* @param source 已规范化的来源
*/
function repoKey(source) {
	return source.toLowerCase();
}
/**
* 校验备注：缺省为空串，超长或非字符串都算不合法。
*/
function normalizeNote(note) {
	if (note === void 0 || note === null) return {
		ok: true,
		note: ""
	};
	if (typeof note !== "string") return { ok: false };
	const text = note.trim();
	if (text.length > 200) return { ok: false };
	return {
		ok: true,
		note: text
	};
}
function errorText$4(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* 读收藏文件。
*
* 返回结构里 `exists` 说明文件是否在磁盘上，`corrupt` 说明文件存在却不可用
* （不是 JSON、结构不对、版本比本模块新）。`corrupt` 时 `repos` 为空，
* 调用方**不能**据此写回文件。
*
* @param file 收藏文件绝对路径
*/
async function readStore(file) {
	let text;
	try {
		text = await promises.readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return {
			exists: false,
			corrupt: false,
			repos: []
		};
		return {
			exists: true,
			corrupt: true,
			repos: []
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			exists: true,
			corrupt: true,
			repos: []
		};
	}
	if (parsed === null || typeof parsed !== "object") return {
		exists: true,
		corrupt: true,
		repos: []
	};
	const record = parsed;
	if (!Array.isArray(record.repos)) return {
		exists: true,
		corrupt: true,
		repos: []
	};
	const version = typeof record.version === "number" ? record.version : null;
	if (version === null || version < 1 || version > 1) return {
		exists: true,
		corrupt: true,
		repos: []
	};
	const repos = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of record.repos) {
		if (raw === null || typeof raw !== "object") continue;
		const item = raw;
		const source = normalizeRepoSource(item.source);
		if (source === null) continue;
		const id = repoKey(source);
		if (seen.has(id)) continue;
		seen.add(id);
		const note = normalizeNote(item.note);
		repos.push({
			id,
			source,
			note: note.ok ? note.note : "",
			addedAt: typeof item.addedAt === "string" && !Number.isNaN(Date.parse(item.addedAt)) ? item.addedAt : ""
		});
	}
	return {
		exists: true,
		corrupt: false,
		repos
	};
}
/**
* 原子写回收藏文件：先写同目录临时文件再 rename，中途失败不会留下半个文件。
*/
async function writeStore(file, repos) {
	await writeJsonAtomic(file, {
		version: 1,
		repos
	}, { dirMode: 448 });
}
/**
* 列出收藏的仓库。
*/
async function listSavedRepos({ homes = resolveHomes() } = {}) {
	const file = repoStoreFile(homes);
	return {
		file,
		...await readStore(file)
	};
}
/**
* 收藏一个仓库。
*
* 重复（规范化后同名）返回 `duplicate`，文件不可读返回 `store-unreadable`。
* 新条目排在最前面。
*/
async function addSavedRepo({ homes = resolveHomes(), source, note } = {}) {
	const normalized = normalizeRepoSource(source);
	if (normalized === null) return {
		ok: false,
		code: "invalid-source",
		message: "来源格式不对：支持 owner/repo、GitHub/GitLab 等链接、任意 git 地址、本地绝对路径（含 file://）或 npm 包名"
	};
	const normalizedNote = normalizeNote(note);
	if (!normalizedNote.ok) return {
		ok: false,
		code: "invalid-note",
		message: `备注不能超过 200 个字符`
	};
	const file = repoStoreFile(homes);
	const store = await readStore(file);
	if (store.corrupt) return {
		ok: false,
		code: "store-unreadable",
		message: `收藏文件无法解析（${file}），请先修复或删除它再添加`
	};
	const id = repoKey(normalized);
	if (store.repos.some((one) => one.id === id)) return {
		ok: false,
		code: "duplicate",
		message: `已经收藏过 ${normalized}`,
		repos: store.repos,
		file
	};
	const repo = {
		id,
		source: normalized,
		note: normalizedNote.note,
		addedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	const repos = [repo, ...store.repos];
	try {
		await writeStore(file, repos);
	} catch (error) {
		return {
			ok: false,
			code: "write-failed",
			message: `无法写入 ${file}：${errorText$4(error)}`
		};
	}
	return {
		ok: true,
		repo,
		repos,
		file
	};
}
/**
* 移除一条收藏；`id` 是列表里给出的去重键（大小写不敏感）。
*/
async function removeSavedRepo({ homes = resolveHomes(), id } = {}) {
	if (typeof id !== "string" || id.trim() === "" || id.length > 300) return {
		ok: false,
		code: "invalid-id",
		message: `非法的收藏 id：${String(id)}`
	};
	const key = id.trim().toLowerCase();
	const file = repoStoreFile(homes);
	const store = await readStore(file);
	if (store.corrupt) return {
		ok: false,
		code: "store-unreadable",
		message: `收藏文件无法解析（${file}），请先修复或删除它再操作`
	};
	const repos = store.repos.filter((one) => one.id !== key);
	if (repos.length === store.repos.length) return {
		ok: false,
		code: "not-found",
		message: `没有收藏 ${String(id)}`,
		repos: store.repos,
		file
	};
	try {
		await writeStore(file, repos);
	} catch (error) {
		return {
			ok: false,
			code: "write-failed",
			message: `无法写入 ${file}：${errorText$4(error)}`
		};
	}
	return {
		ok: true,
		repos,
		file
	};
}
/**
* 安装时指定的 `npx skills` agent。
*
* 不指定 agent 时（`-y`）CLI 会把 skill 装到**本机检测到的所有 agent** 目录里：
* DSH 只关心 `~/.agents/skills`，而纯 DSH 机器上检测不到任何 agent 时它甚至会
* 给全部 agent 各建一份链接。`universal` 是 CLI 自带的「通用 agent」，读写的就是
* 规范副本 `~/.agents/skills`，指定它只写这一处，不碰其它 agent 目录。
*
* 新版本 CLI 若改掉了这个 agent 名，`npx skills add` 会以 `Invalid agents` 失败，
* 调用方会退回不带 agent 的默认命令（见 `installGlobalSkill()` /
* `installProjectSkill()`）。
*/
const INSTALL_AGENT = "universal";
/**
* `npx skills` 的全局规范副本目录（`~/.agents/skills` 的上级），DSH 的
* `user-agents` 根也在这里。`npx` 自己的规则是 `homedir()/.agents/skills`，
* 不接受别的路径覆盖。
*/
function npxGlobalAgentsHome() {
	return path.join(os.homedir(), AGENTS_DIR);
}
/**
* skill 名对应的安装目录名，规则与 `npx skills` 的 `sanitizeName()` 完全一致：
* 小写，非 `[a-z0-9._]` 的连续字符换成连字符，去掉首尾的 `.` 与 `-`，最多 255 字符。
*
* 用来在安装后确认真正的目录，也用于页面判断「这个 skill 是不是已经装过」。
*
* @param name skill 名
* @returns 目录名；名字不合法时可能是空串
*/
function skillDirName(name) {
	if (typeof name !== "string") return "";
	return name.toLowerCase().replace(/[^a-z0-9._]+/gu, "-").replace(/^[.-]+|[.-]+$/gu, "").slice(0, 255);
}
/**
* 这个 skill 名能不能交给 `npx skills add --skill`：
*
* - 非空、不超过 255 字符；
* - 不能以 `-` 或空白开头（会被命令行解析成选项）；
* - 不能含控制字符；
* - 必须能 sanitize 出非空目录名。
*
* 空格是允许的：仓库里确实有 `Convex Best Practices` 这类带空格的名字，
* `npx skills` 支持按引号传入的名字安装。
*
* @param name skill 名
*/
function isInstallableSkillName(name) {
	if (typeof name !== "string") return false;
	if (name === "" || name.length > 255) return false;
	if (/^[-\s]/u.test(name)) return false;
	if (/[\u0000-\u001f\u007f]/u.test(name)) return false;
	return skillDirName(name) !== "";
}
/**
* 判断路径是否存在（含符号链接目标）。
*/
async function pathExists(target) {
	try {
		await promises.access(target);
		return true;
	} catch {
		return false;
	}
}
function errorText$3(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* 两个全局根里是否已经有这个 skill（目录名或展示名命中）。
*
* 同一名字同时存在于 `~/.agents/skills` 与 `~/.dsh/skills` 时 DSH 会列两行，
* 这里也当作已安装：再装一次要么出现第三份，要么被其中一个根遮住，先拒绝并
* 让用户去「已安装」里处理。
*
* @param id 安装目录名
* @param name skill 展示名
*/
async function findInstalledElsewhere(homes, id, name) {
	const wanted = /* @__PURE__ */ new Set([id, name]);
	for (const root of globalRoots(homes)) {
		let entries;
		try {
			entries = await scanRoot(root);
		} catch (error) {
			return {
				status: "failed",
				message: `无法读取 ${root.skillsDir}：${errorText$3(error)}`
			};
		}
		const found = entries.find((entry) => wanted.has(entry.id));
		if (found !== void 0) return {
			status: "installed",
			scope: root.scope,
			id: found.id
		};
	}
	return { status: "absent" };
}
/**
* 这次失败是不是「CLI 不认识 `universal` agent」。
*
* CLI 的报错形如 `Invalid agents: universal`，并且退出码非 0；命中时退回不带
* agent 的默认命令，而不是把一次可安装的请求判死。
*/
function isInvalidAgentFailure(result) {
	const text = `${result?.message ?? ""}\n${result?.output ?? ""}`;
	return /Invalid agents?:/iu.test(text);
}
/**
* 安装前共用的来源 / 名字校验：全局、打工人、工作区三处都必须过这一关。
*
* @param source 仓库来源
* @param name skill 名
*/
function checkSourceAndName(source, name) {
	if (typeof source !== "string" || source.trim() === "") return {
		ok: false,
		result: {
			ok: false,
			code: "invalid-source",
			message: "缺少仓库来源"
		}
	};
	const trimmedSource = source.trim();
	if (trimmedSource.startsWith("-")) return {
		ok: false,
		result: {
			ok: false,
			code: "invalid-source",
			message: `来源不能以 - 开头：${trimmedSource}`
		}
	};
	if (!isInstallableSkillName(name)) return {
		ok: false,
		result: {
			ok: false,
			code: "invalid-skill-name",
			message: `这个 skill 的名字不能用于安装：${typeof name === "string" ? name : String(name)}`
		}
	};
	return {
		ok: true,
		source: trimmedSource,
		name
	};
}
/**
* 把单个 skill 从某个 `npx skills` 来源安装到全局 `~/.agents/skills`。
*
* 失败码：
*
* - `invalid-source`：来源为空或以 `-` 开头（会被当成命令选项）；
* - `invalid-skill-name`：名字不能安全地交给 `npx skills add --skill`；
* - `no-runner`：调用方没给执行能力；
* - `unsupported-home`：`DSH_AGENTS_HOME` 指到了 `npx` 不会写入的位置；
* - `scan-failed`：读全局 skills 目录失败，无法判断是否已安装；
* - `already-installed`：两个全局根里已经有同名 skill；
* - `npx-failed`：`npx skills add` 失败，`output` 带命令输出；
* - `install-incomplete`：命令退出码为 0 但目标目录或 `SKILL.md` 不在。
*/
async function installGlobalSkill({ homes = resolveHomes(), canonicalAgentsHome = npxGlobalAgentsHome(), source, name, runNpx }) {
	const checked = checkSourceAndName(source, name);
	if (!checked.ok) return checked.result;
	const { source: trimmedSource, name: skillName } = checked;
	if (typeof runNpx !== "function") return {
		ok: false,
		code: "no-runner",
		message: "缺少执行 npx 的能力"
	};
	if (path.resolve(canonicalAgentsHome) !== path.resolve(homes.agentsHome)) return {
		ok: false,
		code: "unsupported-home",
		message: `npx skills 把全局 skill 装到 ${path.join(canonicalAgentsHome, "skills")}，而 DSH 现在扫描的是 ${path.join(homes.agentsHome, "skills")}（DSH_AGENTS_HOME）；为避免装到看不见的位置，这里不执行安装`
	};
	const id = skillDirName(skillName);
	const existing = await findInstalledElsewhere(homes, id, skillName);
	if (existing.status === "failed") return {
		ok: false,
		code: "scan-failed",
		message: existing.message
	};
	if (existing.status === "installed") return {
		ok: false,
		code: "already-installed",
		message: `这个 skill 已经全局安装（${existing.scope}）：${existing.id}；如需重装，请先在「已安装」里卸载`
	};
	let result;
	try {
		result = await runNpx([
			"add",
			trimmedSource,
			"--skill",
			skillName,
			"--global",
			"--yes",
			"-a",
			INSTALL_AGENT
		]);
		if (!result?.ok && isInvalidAgentFailure(result)) result = await runNpx([
			"add",
			trimmedSource,
			"--skill",
			skillName,
			"--global",
			"--yes"
		]);
	} catch (error) {
		return {
			ok: false,
			code: "npx-failed",
			message: errorText$3(error)
		};
	}
	if (!result?.ok) return {
		ok: false,
		code: "npx-failed",
		message: result?.message ?? "npx skills add 失败",
		output: result?.output ?? ""
	};
	const target = path.join(canonicalAgentsHome, "skills", id);
	if (!await pathExists(path.join(target, "SKILL.md"))) return {
		ok: false,
		code: "install-incomplete",
		message: `npx skills add 已退出，但没有在 ${target} 找到 SKILL.md`,
		output: result.output ?? ""
	};
	return {
		ok: true,
		id,
		name: skillName,
		target: "global",
		scope: "agents",
		path: target,
		output: result.output ?? ""
	};
}
/**
* 把单个 skill 从某个 `npx skills` 来源安装到打工人或工作区目录。
*
* 目标目录由调用方（`install-targets.ts`）从 Host 的登记表解析，浏览器不能
* 直接指定路径。项目级安装不检查「已安装」：同一个 skill 装进另一个打工人 /
* 工作区是正常操作，重复执行交给 `npx skills` 自己处理。
*
* 打工人目录按 workers 插件的约定同时落 `.agents/skills` 与 `.claude/skills`
* （`-a universal -a claude-code`）；工作区只写 DSH 会扫描的 `.agents/skills`，
* 不碰用户其它 agent 目录。
*
* 失败码在全局安装的基础上增加：
*
* - `invalid-target`：目标目录为空；
* - `missing-target`：目标目录不存在或不是目录；
* - `no-target`：调用方没给目标目录；
* - `npx-failed` / `install-incomplete`：与全局安装相同。
*/
async function installProjectSkill({ targetDir, target = "workspace", source, name, runNpx }) {
	const checked = checkSourceAndName(source, name);
	if (!checked.ok) return checked.result;
	const { source: trimmedSource, name: skillName } = checked;
	if (typeof runNpx !== "function") return {
		ok: false,
		code: "no-runner",
		message: "缺少执行 npx 的能力"
	};
	if (typeof targetDir !== "string" || targetDir.trim() === "") return {
		ok: false,
		code: "no-target",
		message: "缺少安装目标目录"
	};
	const directory = targetDir.trim();
	let stat;
	try {
		stat = await promises.stat(directory);
	} catch {
		return {
			ok: false,
			code: "missing-target",
			message: `目标目录不存在：${directory}`
		};
	}
	if (!stat.isDirectory()) return {
		ok: false,
		code: "missing-target",
		message: `目标路径不是目录：${directory}`
	};
	const agents = target === "worker" ? ["universal", "claude-code"] : ["universal"];
	const args = [
		"add",
		trimmedSource,
		"--skill",
		skillName
	];
	for (const agent of agents) args.push("-a", agent);
	args.push("-y");
	let result;
	try {
		result = await runNpx(args, directory);
		if (!result?.ok && isInvalidAgentFailure(result)) result = await runNpx([
			"add",
			trimmedSource,
			"--skill",
			skillName,
			"-y"
		], directory);
	} catch (error) {
		return {
			ok: false,
			code: "npx-failed",
			message: errorText$3(error)
		};
	}
	if (!result?.ok) return {
		ok: false,
		code: "npx-failed",
		message: result?.message ?? "npx skills add 失败",
		output: result?.output ?? ""
	};
	const id = skillDirName(skillName);
	const targetPath = path.join(directory, AGENTS_DIR, "skills", id);
	if (!await pathExists(path.join(targetPath, "SKILL.md"))) return {
		ok: false,
		code: "install-incomplete",
		message: `npx skills add 已退出，但没有在 ${targetPath} 找到 SKILL.md`,
		output: result.output ?? ""
	};
	return {
		ok: true,
		id,
		name: skillName,
		target,
		path: targetPath,
		output: result.output ?? ""
	};
}
/**
* 页面「安装」按钮的完整流程：校验来源是收藏、skill 在仓库列表里，再按
* `target` 交给全局安装或某个打工人 / 工作区的项目级安装。
*
* 浏览器只传来源与 skill 的仓库路径：名字、是否真的存在都以 Host 这次读到的
* 仓库列表为准；打工人 / 工作区也只传页面选中的名字或路径，真正的工作目录由
* `resolveTarget()` 从 Host 的登记表解析，避免页面缓存过期或请求被伪造时装错
* 位置。
*/
async function installSavedSkill({ homes = resolveHomes(), canonicalAgentsHome = npxGlobalAgentsHome(), catalog, source, skillPath, name, target = "global", worker, workspace, resolveTarget, runNpx }) {
	if (target !== "global" && target !== "worker" && target !== "workspace") return {
		ok: false,
		code: "invalid-target",
		message: `未知的安装目标：${String(target)}`
	};
	const resolver = typeof resolveTarget === "function" ? resolveTarget : null;
	if (target !== "global" && resolver === null) return {
		ok: false,
		code: "no-target-resolver",
		message: "缺少解析安装目标的能力"
	};
	const normalized = normalizeRepoSource(source);
	if (normalized === null) return {
		ok: false,
		code: "invalid-source",
		message: "来源格式不对，无法安装"
	};
	let store;
	try {
		store = await listSavedRepos({ homes });
	} catch (error) {
		return {
			ok: false,
			code: "store-unreadable",
			message: errorText$3(error)
		};
	}
	if (store.corrupt) return {
		ok: false,
		code: "store-unreadable",
		message: `收藏文件无法解析（${store.file}），请先修复或删除它再安装`
	};
	const repo = store.repos.find((one) => repoKey(one.source) === repoKey(normalized));
	if (repo === void 0) return {
		ok: false,
		code: "not-saved",
		message: `只允许安装收藏过的来源，请先收藏再安装：${normalized}`
	};
	if (catalog === void 0 || typeof catalog?.listSkills !== "function") return {
		ok: false,
		code: "no-catalog",
		message: "缺少读取仓库的能力"
	};
	let targetDir = null;
	if (target !== "global") {
		const resolved = await resolver({
			target,
			worker,
			workspace
		});
		if (!resolved.ok) return {
			ok: false,
			code: resolved.code,
			message: resolved.message
		};
		targetDir = resolved.path;
	}
	let listed;
	try {
		listed = await catalog.listSkills({ source: repo.source });
	} catch (error) {
		return {
			ok: false,
			code: "fetch-failed",
			message: errorText$3(error)
		};
	}
	if (!listed?.ok) return {
		ok: false,
		code: listed?.code ?? "fetch-failed",
		message: listed?.message ?? "无法读取这个仓库的 skill 列表"
	};
	const skills = Array.isArray(listed.skills) ? listed.skills : [];
	const requestedPath = typeof skillPath === "string" ? skillPath : "";
	const requestedName = typeof name === "string" ? name : "";
	const match = requestedPath === "" ? skills.find((one) => one?.name === requestedName) : skills.find((one) => one?.path === requestedPath);
	if (match === void 0) return {
		ok: false,
		code: "skill-not-found",
		message: "仓库列表里没有这个 skill，仓库可能已经更新，请刷新后再试"
	};
	if (target === "global") {
		const installed = await installGlobalSkill({
			homes,
			canonicalAgentsHome,
			source: repo.source,
			name: match.name,
			runNpx
		});
		if (!installed.ok) return installed;
		return {
			...installed,
			repo: repo.source,
			plugin: match.plugin ?? null
		};
	}
	const installed = await installProjectSkill({
		targetDir: targetDir ?? "",
		target,
		source: repo.source,
		name: match.name,
		runNpx
	});
	if (!installed.ok) return installed;
	return {
		...installed,
		repo: repo.source,
		plugin: match.plugin ?? null
	};
}
// .build/skills/routes.js
/**
* 给浏览器一半的侧边栏「Skills」页面用的包内 HTTP 路由。
*
* 七个路由：
*
* - `GET /buka-skills/list` 列出全局 skills；
* - `POST /buka-skills/uninstall` 卸载一个；
* - `GET /buka-skills/targets` 列出可安装的打工人（`ctx.bukaWorkers`）与工作区
*   （`ctx.workspaceRegistry`）；
* - `POST /buka-skills/install` 把某个收藏仓库里的一个 skill 安装到全局、
*   某个打工人目录或某个工作区目录；
* - `GET /buka-skills/repos` 列出用户收藏的仓库，
* - `POST /buka-skills/repos` 收藏一个，
* - `POST /buka-skills/repos/remove` 移除一个，
* - `GET /buka-skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
*   `probe=1` 时只探测仓库类型：npx skills / Claude Code marketplace / 不可用）。
*
* 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
* （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
*
* @module @buka/dsh-plugin-skills/routes
*/
/** 页面读取列表用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = "/buka-skills/list";
/** 页面卸载 skill 用的路由。 */
const UNINSTALL_ROUTE = "/buka-skills/uninstall";
/** 页面读取可安装目标（打工人 / 工作区）用的路由。 */
const TARGETS_ROUTE = "/buka-skills/targets";
/** 页面把收藏仓库里的一个 skill 安装到全局 / 打工人 / 工作区用的路由。 */
const INSTALL_ROUTE = "/buka-skills/install";
/** 收藏仓库的列表 / 添加路由。 */
const REPOS_ROUTE = "/buka-skills/repos";
/** 收藏仓库的移除路由。 */
const REPO_REMOVE_ROUTE = "/buka-skills/repos/remove";
/** 收藏仓库的 skills 树路由。 */
const REPO_SKILLS_ROUTE = "/buka-skills/repo-skills";
/**
* 注册全部路由。
*
* @param ctx 提供 `webServer` 与 `connection` 的插件上下文
* @param deps 入口装配好的共享依赖
*/
function registerRoutes(ctx, deps) {
	const { homes, runNpx, catalog, readSnapshot, serializeNpx } = deps;
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
			path: LIST_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				try {
					sendJson(res, 200, {
						ok: true,
						...await readSnapshot()
					});
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: GET ${LIST_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: UNINSTALL_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const fields = body;
				try {
					const result = await serializeNpx(() => uninstallGlobalSkill({
						homes,
						scope: fields?.scope,
						id: fields?.id,
						runNpx
					}));
					if (result.ok) webCtx.logger?.info?.("buka-skills: 已卸载 %s（%s）", String(fields?.id), result.method);
					sendJson(res, result.ok ? 200 : statusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: POST ${UNINSTALL_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: TARGETS_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				try {
					sendJson(res, 200, {
						ok: true,
						...await listInstallTargets(webCtx)
					});
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: GET ${TARGETS_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: INSTALL_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const fields = body;
				try {
					const result = await serializeNpx(() => installSavedSkill({
						homes,
						catalog,
						source: fields?.source,
						skillPath: fields?.path,
						target: fields?.target,
						worker: fields?.worker,
						workspace: fields?.workspace,
						resolveTarget: (request) => resolveInstallTarget(webCtx, request),
						runNpx
					}));
					if (result.ok) webCtx.logger?.info?.("buka-skills: 已安装 %s（%s，%s）", String(result.name), String(result.repo), result.target ?? "global");
					sendJson(res, result.ok ? 200 : installStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: POST ${INSTALL_ROUTE}`);
		let repoQueue = Promise.resolve();
		function serializeRepo(work) {
			const run = repoQueue.then(work, work);
			repoQueue = run.then(() => void 0, () => void 0);
			return run;
		}
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: REPOS_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method === "GET") {
					try {
						sendJson(res, 200, {
							ok: true,
							...await listSavedRepos({ homes })
						});
					} catch (error) {
						sendJson(res, 500, {
							ok: false,
							message: describeError$1(error)
						});
					}
					return;
				}
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "GET, POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const fields = body;
				try {
					const result = await serializeRepo(() => addSavedRepo({
						homes,
						source: fields?.source,
						note: fields?.note
					}));
					if (result.ok) webCtx.logger?.info?.("buka-skills: 已收藏仓库 %s", String(fields?.source));
					sendJson(res, result.ok ? 200 : repoStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: ${REPOS_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: REPO_REMOVE_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const fields = body;
				try {
					const result = await serializeRepo(() => removeSavedRepo({
						homes,
						id: fields?.id
					}));
					if (result.ok) webCtx.logger?.info?.("buka-skills: 已移除收藏 %s", String(fields?.id));
					sendJson(res, result.ok ? 200 : repoStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: POST ${REPO_REMOVE_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: REPO_SKILLS_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				const query = parseQuery(req);
				const source = query.get("source") ?? "";
				const refresh = query.get("refresh") === "1";
				const probe = query.get("probe") === "1";
				try {
					const result = probe ? await catalog.probeRepositoryKind({
						source,
						refresh
					}) : await catalog.fetchRepositorySkills({
						source,
						refresh
					});
					sendJson(res, result.ok ? 200 : repoSkillsStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `buka-skills: GET ${REPO_SKILLS_ROUTE}`);
	});
}
/**
* 按失败原因选 HTTP 状态码。
*
* @param code skill-store 返回的错误码
*/
function statusFor(code) {
	if (code === "not-found") return 404;
	if (code === "invalid-scope" || code === "invalid-id") return 400;
	if (code === "lock-unreadable") return 409;
	return 500;
}
/**
* 安装操作的失败码 → HTTP 状态码。
*
* `not-saved` / `invalid-source` / `invalid-skill-name` / `invalid-target` /
* `invalid-worker` / `invalid-workspace` 是请求本身的问题（400）；
* `skill-not-found`、仓库不存在、`unknown-worker` / `unknown-workspace` 是 404；
* `already-installed` / `store-unreadable` / `missing-target` /
* `workers-unavailable` / `workspaces-unavailable` / `no-target-resolver` 是当前
* 状态不允许这次写入（409）；仓库不可用 422；限流 429；`unsupported-home` 与
* `git-unavailable` 是本机环境问题（500）；其余（`npx-failed`、`fetch-failed`、
* `git-failed`、`install-incomplete` 等上游失败）按 502 处理。
*
* @param code skill-install 返回的错误码
*/
function installStatusFor(code) {
	if (code === "invalid-source" || code === "invalid-skill-name" || code === "not-saved" || code === "unsupported-source" || code === "invalid-target" || code === "invalid-worker" || code === "invalid-workspace") return 400;
	if (code === "skill-not-found" || code === "repo-not-found" || code === "not-found" || code === "unknown-worker" || code === "unknown-workspace") return 404;
	if (code === "already-installed" || code === "store-unreadable" || code === "missing-target" || code === "workers-unavailable" || code === "workspaces-unavailable" || code === "no-target-resolver") return 409;
	if (code === "repo-unavailable") return 422;
	if (code === "rate-limited") return 429;
	if (code === "unsupported-home" || code === "git-unavailable") return 500;
	return 502;
}
/**
* 收藏操作的失败码 → HTTP 状态码。
*
* `duplicate` 与 `store-unreadable` 都是 409：请求本身合法，只是当前状态
* 不允许这次写入（已经收藏过 / 收藏文件需要先修复）。
*/
function repoStatusFor(code) {
	if (code === "not-found") return 404;
	if (code === "invalid-id" || code === "invalid-source" || code === "invalid-note") return 400;
	if (code === "duplicate" || code === "store-unreadable") return 409;
	return 500;
}
/**
* 仓库 skills 路由的失败码 → HTTP 状态码。
*
* `unsupported-source` 用 400：来源本身合法，但这个来源（npm 包名 / 已知不是
* 仓库的网页链接）没有可以让 Host 列举的仓库树，请求方不该重试。
* `repo-unavailable` 用 422：请求格式没问题，只是这个仓库既不是 npx skills
* 也不是 Claude Code marketplace，改来源才有意义。
*
* `git-unavailable`（本机没有 git）用 500：这是 Host 环境问题，与来源无关；
* `git-failed`（clone/fetch 失败）用 502：上游 git 服务或网络的问题，和 GitHub
* 的 `fetch-failed` 同级。
*/
function repoSkillsStatusFor(code) {
	if (code === "invalid-source" || code === "unsupported-source") return 400;
	if (code === "repo-unavailable") return 422;
	if (code === "repo-not-found") return 404;
	if (code === "rate-limited") return 429;
	if (code === "git-unavailable") return 500;
	return 502;
}
// .build/skills/serial-queue.js
/**
* 串行执行器：把多次异步操作排成一条队列，前一个 settle 后再跑下一个。
*
* 两个地方用到它，原因相同：底层的写入不是为并发准备的。
*
* - `npx skills` 会整份重写共享的 lockfile，安装与卸载并发执行可能互相覆盖条目；
* - 收藏文件是整份 JSON，两次「添加」并发会互相覆盖整个文件。
*
* 失败不会卡住队列：下一个任务照样执行，错误由各自的调用方处理。
*
* @module @buka/dsh-plugin-skills/serial-queue
*/
/**
* 创建一个串行队列，返回「把任务排进队列」的函数。
*
* @returns 串行执行的包装函数
*/
function createSerialQueue() {
	let queue = Promise.resolve();
	return function serialize(work) {
		const run = queue.then(work, work);
		queue = run.then(() => void 0, () => void 0);
		return run;
	};
}
// .build/skills/repo/marketplace.js
/**
* Claude Code marketplace 清单（`.claude-plugin/marketplace.json`）的解析与校验。
*
* 清单在仓库里的固定路径、插件名与插件 root 的合法形状都集中在这里；分组与
* 缓存校验复用同一套规则，保证「写进缓存」与「从缓存读回」的判断一致。
*
* @module @buka/dsh-plugin-skills/repo/marketplace
*/
/** Claude Code marketplace 清单在仓库里的固定路径。 */
const MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
/**
* Claude Code 单插件清单在插件根下的固定路径；npx skills 仓库按它声明的
* `skills` 做展示分组，与 CLI 的 `getPluginGroupings()` 一致。
*/
const PLUGIN_MANIFEST_PATH = ".claude-plugin/plugin.json";
/** marketplace 插件名的格式；与 Claude Code 的插件命名规则一致。 */
const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
/** 控制字符（含换行、制表符）不允许出现在路径里。 */
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
/**
* 解析 Claude Code marketplace 清单。
*
* 顶层不是对象、或者 `plugins` 不是数组时整份按不合法处理（返回 null，调用方
* 判定为不可用）。单个插件的 name / source 不合法只跳过该插件：宁可少列一个，
* 也不要让一份有瑕疵的清单整份失败。
*/
function parseMarketplace(text) {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
	const record = data;
	if (!Array.isArray(record.plugins)) return null;
	const metadata = record.metadata;
	const pluginRoot = normalizeRelativePath(metadata?.pluginRoot);
	const plugins = [];
	const roots = /* @__PURE__ */ new Set();
	for (const entry of record.plugins) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
		const item = entry;
		const pluginName = normalizePluginName(item.name);
		if (pluginName === null) continue;
		const root = resolvePluginRoot(item.source, pluginRoot);
		if (root === null || roots.has(root)) continue;
		roots.add(root);
		plugins.push({
			name: pluginName,
			root,
			description: typeof item.description === "string" ? item.description : ""
		});
	}
	return {
		name: typeof record.name === "string" ? record.name : "",
		plugins
	};
}
/**
* 校验 marketplace 插件名：trim 后必须匹配插件命名规则。
*/
function normalizePluginName(value) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!PLUGIN_NAME_PATTERN.test(text)) return null;
	return text;
}
/**
* 校验一个安全的仓库内相对路径；不合法时返回 null。
*
* 拒绝绝对路径、反斜杠、控制字符、空段、`.` / `..` 段与超长路径。空串表示
* 仓库根，是合法的相对路径。
*/
function normalizeRelativePath(value) {
	if (typeof value !== "string") return null;
	if (value === "") return "";
	if (value.length > 300) return null;
	if (value.startsWith("/") || value.includes("\\") || CONTROL_PATTERN.test(value)) return null;
	if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	return value;
}
/**
* 把一个插件的 `source` 解析成仓库内相对路径；只接受仓库内的本地 source。
*
* - `'.'` → 仓库根（`''`）；
* - `'./x'` → `'x'`；
* - 不含 `/` 的裸名 → `${metadata.pluginRoot}/${source}`（没有合法 pluginRoot
*   则跳过）；裸名指目录名，可能与 entry 的显示名不同；
* - 其它（含 `/` 但不以 `./` 开头、对象形式的 github / npm / url source）→ 跳过，
*   因为它们不在这个仓库里，Host 无法列出其中的 skill。
*
* @param pluginRoot `metadata.pluginRoot` 的校验结果
*/
function resolvePluginRoot(source, pluginRoot) {
	if (typeof source !== "string") return null;
	if (source === ".") return "";
	if (source.startsWith("./")) return normalizeRelativePath(source.slice(2));
	if (source.includes("/")) return null;
	if (pluginRoot === null) return null;
	return normalizeRelativePath(pluginRoot === "" ? source : `${pluginRoot}/${source}`);
}
/**
* 校验缓存里的 marketplace 清单；缺失或结构不合法时返回 null。
*
* 插件名与 root 都按写入前同一套规则重新校验：缓存可能被手工改过，不能让
* 非法路径或名字从缓存里重新变成对外服务的返回值。
*/
function normalizeCachedMarketplace(value) {
	if (value === null || value === void 0) return null;
	if (typeof value !== "object" || Array.isArray(value)) return null;
	const record = value;
	if (typeof record.name !== "string") return null;
	if (!Array.isArray(record.plugins)) return null;
	const plugins = [];
	for (const entry of record.plugins) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
		const item = entry;
		const name = normalizePluginName(item.name);
		const root = normalizeRelativePath(item.root);
		if (name === null || root === null) return null;
		if (typeof item.description !== "string") return null;
		plugins.push({
			name,
			root,
			description: item.description
		});
	}
	return {
		name: record.name,
		plugins
	};
}
/** 缓存有效期：30 分钟。GitHub 的树变化不频繁，过期后按需重拉。 */
const REPO_SKILLS_CACHE_TTL_MS = 18e5;
/** 合法的仓库分类；与缓存条目的 `kind` 字段同值。 */
const REPO_KINDS = /* @__PURE__ */ new Set([
	"npx-skills",
	"claude-code-marketplace",
	"unavailable"
]);
/**
* 缓存文件的绝对路径。
*
* @param homes `resolveHomes()` 的结果
*/
function repoSkillsCacheFile(homes) {
	return path.join(homes.dshHome, "buka-skills", "cache", "repo-skills.json");
}
/**
* 读缓存；文件不存在、损坏、版本不符或结构不对都返回空对象。
*
* 缓存随时可以重建，所以这里不区分「坏文件」与「没有文件」，也不报错。
* v1 的缓存没有 `kind` / `complete`，因版本不符自动丢弃并重建。
*/
async function readCache(file) {
	let parsed;
	try {
		parsed = JSON.parse(await promises.readFile(file, "utf8"));
	} catch {
		return {};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const record = parsed;
	if (record.version !== 5) return {};
	if (record.entries === null || typeof record.entries !== "object" || Array.isArray(record.entries)) return {};
	const entries = {};
	for (const [id, raw] of Object.entries(record.entries)) {
		const entry = normalizeCacheEntry(raw);
		if (entry === null) continue;
		if (repoKey(entry.source) !== id) continue;
		entries[id] = entry;
	}
	return entries;
}
/**
* 校验并复制一条缓存记录；结构不合法时返回 null。
*
* 除旧字段外还要求 `kind` 属于三种仓库类型、`complete` 是布尔值：缺字段的
* v1 形状或手改坏的条目都按未命中处理，整条丢弃。`marketplace` 是 v3 新增的
* 清单快照：缺失或为 null 视为没有清单（兼容手写的旧形状缓存），存在但不是
* 合法清单时整条丢弃，避免把损坏数据当成插件列表返回。
*/
function normalizeCacheEntry(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw;
	if (typeof record.source !== "string" || record.source === "") return null;
	if (typeof record.kind !== "string" || !REPO_KINDS.has(record.kind)) return null;
	if (typeof record.ref !== "string" || typeof record.sha !== "string") return null;
	if (typeof record.fetchedAt !== "number" || !Number.isFinite(record.fetchedAt)) return null;
	if (typeof record.truncated !== "boolean") return null;
	if (typeof record.skills !== "number" || !Number.isInteger(record.skills) || record.skills < 0) return null;
	if (typeof record.complete !== "boolean") return null;
	if (!isValidTree(record.root)) return null;
	const marketplace = normalizeCachedMarketplace(record.marketplace);
	if (marketplace === null && record.marketplace !== null && record.marketplace !== void 0) return null;
	return {
		source: record.source,
		kind: record.kind,
		ref: record.ref,
		sha: record.sha,
		fetchedAt: record.fetchedAt,
		truncated: record.truncated,
		root: record.root,
		skills: record.skills,
		complete: record.complete,
		marketplace
	};
}
/**
* 校验缓存里的树结构。缓存可能被手工改过，结构不对就当作未命中重拉。
*/
function isValidTree(root) {
	if (!Array.isArray(root)) return false;
	const stack = [{
		nodes: root,
		depth: 0
	}];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === void 0) break;
		const { nodes, depth } = current;
		if (depth > 64) return false;
		for (const node of nodes) {
			if (node === null || typeof node !== "object") return false;
			const record = node;
			if (typeof record.name !== "string" || typeof record.path !== "string") return false;
			if (record.type === "dir") {
				if (!Array.isArray(record.children)) return false;
				stack.push({
					nodes: record.children,
					depth: depth + 1
				});
			} else if (record.type === "skill") {
				if (typeof record.description !== "string") return false;
			} else return false;
		}
	}
	return true;
}
/**
* 缓存是否仍然有效：`refresh` 已在调用处处理，这里只判断 TTL。
*/
function isFresh(entry, now, ttlMs) {
	if (entry === void 0) return false;
	return now - entry.fetchedAt < ttlMs;
}
/**
* 写探测的轻量缓存：目标 id 已有完整树缓存时**不覆盖**。
*
* 探测刷新（`refresh: true`）同样遵守这条规则，避免把展开时拿到的完整树降级。
* 「是否已有完整树」在串行化的读改写里重新判断，因此并发探测不会拿旧快照
* 覆盖掉刚写进去的完整树。
*/
async function writeProbeCache(file, id, entry) {
	try {
		await updateCache(file, (current) => {
			const existing = current[id];
			if (existing !== void 0 && existing.complete === true) return void 0;
			return {
				...current,
				[id]: entry
			};
		});
	} catch {}
}
/**
* 缓存写队列：同一个缓存文件的「读最新内容 → 改 → 原子写」串行执行。
*
* 不加队列时，两个并发探测各自用开始时读到的旧快照整文件重写，后写的会
* 悄悄丢掉先写的条目。缓存丢了只会多打一次 GitHub，但没必要。
*/
const cacheWrites = /* @__PURE__ */ new Map();
/**
* 串行更新缓存文件。`update` 返回 `undefined` 表示这次不写。
*/
function updateCache(file, update) {
	const run = (cacheWrites.get(file) ?? Promise.resolve()).then(async () => {
		const next = update(await readCache(file));
		if (next !== void 0) await writeCache(file, next);
	}, async () => {
		const next = update(await readCache(file));
		if (next !== void 0) await writeCache(file, next);
	});
	cacheWrites.set(file, run.then(() => void 0, () => void 0));
	return run;
}
/**
* 原子重写缓存文件：同目录临时文件 + rename，mode 0600。
*
* 只在 `updateCache()` 的串行段里调用，调用方不要直接写文件。
*/
async function writeCache(file, entries) {
	await writeJsonAtomic(file, {
		version: 5,
		entries
	}, { dirMode: 448 });
}
// .build/skills/repo/failure.js
/**
* 统一的失败返回与错误文本：`repo-skills` 各模块共用。
*
* 错误码集合与模块契约一致：`git-unavailable` 表示本机没有可执行的 git；
* `git-failed` 表示 clone / fetch / 读克隆目录失败。两者只可能出现在 git
* 来源上，其余错误码对三种来源通用。
*
* @module @buka/dsh-plugin-skills/repo/failure
*/
/**
* 统一的失败返回，保证错误码集合与模块契约一致。
*/
function failure$2(code, message) {
	return {
		ok: false,
		code,
		message
	};
}
/**
* 「既不是 npx skills 仓库，也不是 Claude Code marketplace」的统一失败返回。
*/
function repoUnavailable() {
	return failure$2("repo-unavailable", "Repository is neither an npx skills repository nor a Claude Code plugin marketplace.");
}
/**
* 把任意错误转成可以展示的文本。
*/
function errorText$2(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// .build/skills/repo/discovery.js
/**
* `npx skills` 的 SKILL.md 发现规则，以及据此判定仓库类型。
*
* 发现规则与 `npx skills` CLI 的 `findSkillMdPaths()` 保持一致（文件名必须是
* `SKILL.md`、优先级前缀、container 层级、跳过的目录），**展示方式也照 CLI 的
* 清单来**：npx 仓库不按仓库的物理目录分组。像 `skills/<bucket>/<skill>/
* SKILL.md` 这种 catalog 布局，bucket 只对发现有用。
*
* 收藏的仓库有两类，判定顺序固定（用户要求）：先按 `npx skills` 的优先级前缀
* （标准布局）判定 npx skills 仓库；没命中再看仓库根有没有
* `.claude-plugin/marketplace.json`，有合法清单就按 Claude Code marketplace
* 处理；两者都不是时，npx 的兜底规则（任意不超过 6 段的 SKILL.md）仍然算 npx
* skills 仓库；最后才标记为不可用（`repo-unavailable`）。兜底排在 marketplace
* 之后，是因为它太宽松：`plugins/<plugin>/skills/<name>/SKILL.md` 正好 5 段，
* 会命中；若它在前，marketplace 永远显示成 npx。判定本身只看这棵树，不依赖
* 清单文件；npx 仓库展开时才读清单做插件分组，判定不受影响。
*
* @module @buka/dsh-plugin-skills/repo/discovery
*/
/**
* 优先级前缀，顺序必须与 `npx skills` CLI 的 `PRIORITY_PREFIXES` 一致：
* 越靠前的容器目录越优先；空串表示「根目录或一层目录」。
*/
const PRIORITY_PREFIXES = [
	"",
	"skills/",
	"skills/.curated/",
	"skills/.experimental/",
	"skills/.system/",
	".agents/skills/",
	".claude/skills/",
	".cline/skills/",
	".codebuddy/skills/",
	".codex/skills/",
	".commandcode/skills/",
	".continue/skills/",
	".factory/skills/",
	".github/skills/",
	".goose/skills/",
	".grok/skills/",
	".iflow/skills/",
	".junie/skills/",
	".kilo/skills/",
	".kilocode/skills/",
	".kimchi/skills/",
	".kiro/skills/",
	".minimax/skills/",
	".mux/skills/",
	".neovate/skills/",
	".opencode/skills/",
	".openhands/skills/",
	".pi/skills/",
	".posit/assistant/skills/",
	".qoder/skills/",
	".roo/skills/",
	".trae/skills/",
	".windsurf/skills/",
	".zcode/skills/",
	".zencoder/skills/"
];
/** 与 CLI 相同的跳过目录，只在 container 下的嵌套候选里生效。 */
const SKIP_DIRS$1 = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"__pycache__"
]);
/**
* 路径的 basename 是否就是 `SKILL.md`（大小写不敏感）。
*
* 不能写成 `endsWith('skill.md')`：那会把 `.changeset/foo-skill.md`、
* `my-skill.md` 这类普通 Markdown 也当成 skill。`npx skills` CLI 的
* `findSkillMdPaths()` 用的是 basename 比较。
*
* @param value 仓库内路径
*/
function isSkillMdPath(value) {
	if (typeof value !== "string") return false;
	return value.slice(value.lastIndexOf("/") + 1).toLowerCase() === "skill.md";
}
/** 树节点是否是带字符串路径的 blob；用于把 unknown 树收窄成可读路径。 */
function isBlobEntry(entry) {
	return entry.type === "blob" && typeof entry.path === "string";
}
/** 树里所有 blob 的完整路径。 */
function treeBlobPaths(tree) {
	return tree.filter(isBlobEntry).map((entry) => entry.path);
}
/**
* 收集树里所有 SKILL.md blob 的完整路径。
*
* @param tree GitHub 树节点数组
*/
function allSkillMdPaths(tree) {
	return treeBlobPaths(tree).filter(isSkillMdPath);
}
/**
* 只按优先级前缀发现 SKILL.md，返回命中的完整路径集合。
*
* 分类时用它判断 npx 规则是不是**真的**发现了这个仓库：`findSkillMdPaths()`
* 末尾还有一条很宽松的兜底（任意 ≤6 段的 SKILL.md），Claude Code marketplace
* 的 `plugins/<plugin>/skills/<name>/SKILL.md` 正好会被它命中。若兜底也算
* 「npx 仓库」，marketplace 就永远轮不到，所以先用优先级前缀判定。
*
* 另外，catalog 布局（`skills/<bucket>/<skill>/SKILL.md`）命中前缀后不再把
* bucket 目录留到展示层：npx 的清单是扁平的，bucket 只对发现有用。
*/
function findPrioritySkillMdPaths(allSkillMds) {
	const lowerPaths = new Set(allSkillMds.map((one) => one.toLowerCase()));
	const found = /* @__PURE__ */ new Set();
	for (const prefix of PRIORITY_PREFIXES) {
		const isContainer = prefix !== "";
		for (const skillMd of allSkillMds) {
			if (!skillMd.startsWith(prefix)) continue;
			const rest = skillMd.slice(prefix.length);
			if (rest.toLowerCase() === "skill.md") {
				found.add(skillMd);
				continue;
			}
			const parts = rest.split("/");
			if (parts.length === 2 && (parts[1] ?? "").toLowerCase() === "skill.md") {
				found.add(skillMd);
				continue;
			}
			const skillDirs = parts.slice(0, -1);
			const hasAncestorSkill = skillDirs.slice(0, -1).some((_, index) => {
				const ancestor = skillDirs.slice(0, index + 1).join("/");
				return lowerPaths.has(`${prefix}${ancestor}/SKILL.md`.toLowerCase());
			});
			if (isContainer && parts.length >= 3 && parts.length <= 4 && (parts.at(-1) ?? "").toLowerCase() === "skill.md" && skillDirs.every((part) => !SKIP_DIRS$1.has(part)) && !hasAncestorSkill) found.add(skillMd);
		}
	}
	return found;
}
/**
* 照搬 `npx skills` CLI 的 `findSkillMdPaths()`，返回可安装 skill 的
* `SKILL.md` 完整路径列表（顺序同 CLI：优先级前缀顺序 → 树顺序）。
*
* 与 CLI 一样返回扁平路径：容器前缀（`skills/`、`.agents/skills/` 等）和
* catalog 布局里的 bucket 目录都只用于发现，不进展示路径；展示分组由
* `readSkillGroupings()` 按仓库清单决定。CLI 的 `subpath` 参数这里不需要，
* 等价于空串。
*
* @param tree GitHub 树节点数组
*/
function findSkillMdPaths(tree) {
	const allSkillMds = allSkillMdPaths(tree);
	if (allSkillMds.length === 0) return [];
	const found = findPrioritySkillMdPaths(allSkillMds);
	if (found.size > 0) return [...found];
	return allSkillMds.filter((skillMd) => skillMd.split("/").length <= 6);
}
/**
* 判定仓库属于哪种技能仓库，顺序固定：npx skills → marketplace → 不可用。
*
* npx 的**优先级前缀**命中任何一个 SKILL.md 就直接按 npx skills 处理，
* **不再拉** marketplace.json；只有优先级规则一个都没命中时才看仓库根有没有
* `.claude-plugin/marketplace.json`。兜底的宽松规则留到最后：marketplace 的
* `plugins/<plugin>/skills/<name>/SKILL.md` 也会被兜底命中，若它先于
* marketplace 判定，这类仓库就永远显示成 npx（详见 `findPrioritySkillMdPaths`）。
*
* tree 里说 marketplace 文件在、却读不到时返回 `fetch-failed`（而不是
* 「不可用」），避免把网络 / 读文件问题误判成仓库类型。
*/
async function classifyRepo({ tree, reader }) {
	const allSkillMds = allSkillMdPaths(tree);
	if (findPrioritySkillMdPaths(allSkillMds).size > 0) return { kind: "npx-skills" };
	if (tree.some((entry) => entry !== null && typeof entry === "object" && entry.type === "blob" && entry.path === ".claude-plugin/marketplace.json")) {
		const text = await reader.readFile(MARKETPLACE_PATH);
		if (text === null) return { failure: failure$2("fetch-failed", "Failed to read the Claude Code marketplace manifest from the repository.") };
		const marketplace = parseMarketplace(text);
		if (marketplace !== null) return {
			kind: "claude-code-marketplace",
			marketplace
		};
	}
	if (allSkillMds.some((skillMd) => skillMd.split("/").length <= 6)) return { kind: "npx-skills" };
	return { kind: "unavailable" };
}
// .build/skills/repo/github.js
/**
* GitHub 侧的网络读取：仓库树、SKILL.md 原文与请求头。
*
* - 树：`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`；
* - 文件：`https://raw.githubusercontent.com/...`。
*
* 网络实现从参数注入（`fetchImpl`），所以本模块可以脱离网络单测；token 的
* 来源规则见 `resolveToken()`。
*
* @module @buka/dsh-plugin-skills/repo/github
*/
/** 依次尝试的分支。很多仓库没有 `main`，所以先问 `HEAD`。 */
const BRANCHES = [
	"HEAD",
	"main",
	"master"
];
/** GitHub API 的请求超时。 */
const TREE_TIMEOUT_MS = 1e4;
/** raw.githubusercontent.com 上单个文件的请求超时；失败只影响一个节点。 */
const RAW_TIMEOUT_MS = 8e3;
/**
* 解析 token：显式参数优先，缺省时读 `GITHUB_TOKEN` / `GH_TOKEN`；
* 空串按「没有 token」处理，避免发出空的 Authorization 头。
*
* @param provided `fetchRepoSkills` 的 `token` 选项
*/
function resolveToken(provided) {
	if (provided !== void 0) {
		if (typeof provided !== "string") return null;
		const text = provided.trim();
		return text === "" ? null : text;
	}
	for (const value of [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]) {
		if (typeof value !== "string") continue;
		const text = value.trim();
		if (text !== "") return text;
	}
	return null;
}
/**
* 按分支顺序拉取递归树。
*
* 404 只意味着这个分支不存在，继续试下一个；403 且额度用尽立即返回
* `rate-limited`；其它非 2xx、网络异常、JSON 解析失败或没有 `tree` 数组
* 都直接返回 `fetch-failed`，不再浪费后续分支的请求。
*/
async function fetchRepoTree({ owner, repo, token, fetchImpl }) {
	for (const branch of BRANCHES) {
		const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
		let response;
		try {
			response = await fetchImpl(url, {
				headers: apiHeaders(token),
				signal: AbortSignal.timeout(TREE_TIMEOUT_MS)
			});
		} catch (error) {
			return failure$2("fetch-failed", `GitHub tree request failed: ${errorText$2(error)}`);
		}
		if (response?.status === 404) continue;
		if (response?.status === 403 && response.headers?.get("x-ratelimit-remaining") === "0") return failure$2("rate-limited", "GitHub API rate limit exhausted; retry later or set GITHUB_TOKEN.");
		if (!response?.ok) return failure$2("fetch-failed", `GitHub API returned HTTP ${response?.status ?? "unknown"}.`);
		let data;
		try {
			data = await response.json();
		} catch {
			return failure$2("fetch-failed", "GitHub API returned invalid JSON.");
		}
		const record = data !== null && typeof data === "object" ? data : null;
		if (record === null || !Array.isArray(record.tree)) return failure$2("fetch-failed", "GitHub API tree response is missing the tree array.");
		return {
			ok: true,
			ref: branch,
			sha: typeof record.sha === "string" ? record.sha : "",
			truncated: record.truncated === true,
			tree: record.tree
		};
	}
	return failure$2("repo-not-found", "Repository not found on GitHub (tried HEAD, main and master).");
}
/**
* GitHub 的 `readFile`：从 raw.githubusercontent.com 取文件原文。
*
* 网络异常、超时与任何非 2xx 都返回 null（对调用方就是「这个文件读不到」）：
* SKILL.md 读不到只影响一个节点的元数据，marketplace 清单读不到则由分类函数
* 升级成 `fetch-failed`。
*/
function createGithubReader({ owner, repo, ref, token, fetchImpl }) {
	return async function readFile(repoPath) {
		const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${repoPath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
		try {
			const response = await fetchImpl(url, {
				headers: rawHeaders(token),
				signal: AbortSignal.timeout(RAW_TIMEOUT_MS)
			});
			if (!response?.ok) return null;
			return await response.text();
		} catch {
			return null;
		}
	};
}
/**
* GitHub API 请求头。
*/
function apiHeaders(token) {
	const headers = {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "buka-skills"
	};
	if (token !== null) headers.Authorization = `Bearer ${token}`;
	return headers;
}
/**
* raw.githubusercontent.com 的请求头；带 token 可以访问私有仓库。
*/
function rawHeaders(token) {
	const headers = { "User-Agent": "buka-skills" };
	if (token !== null) headers.Authorization = `Bearer ${token}`;
	return headers;
}
// .build/skills/git-source.js
/**
* 任意 git 远端来源：把收藏的 git 地址浅克隆到 DSH 缓存目录，再当本地目录扫描。
*
* GitHub 之外的仓库（GitLab、自建 Gitea、`ssh://` / `git@host:path` 等）没有统一
* 的公开 API 可列树，本机装了 git 时最直接的办法就是 `git clone --depth 1`：
* 只拉一个提交，代价可控，之后 `repo-skills.js` 用 `local-source.js` 扫目录即可。
*
* 克隆放在 `<DSH_HOME>/buka-skills/cache/git/<sha256(url) 前 32 位>`：
* - 用 URL 的哈希做目录名，避免不同地址拼出同一个路径，也避免把密码、分支等
*   写进目录名；
* - 目录名就是进程内并发锁的键：同一地址的并发展开共用一次克隆，不用 `Map`
*   再存一份 URL 到目录的映射。
*
* 刷新（`update: true`）先 `git fetch --depth 1 origin` 再 `reset --hard
* FETCH_HEAD`；失败时**保留旧克隆继续用**——离线或远端临时不可达时，用户
* 仍能看到上次缓存的仓库树，而不是一个错误。首次克隆失败（含找不到 git）
* 才返回错误；浏览器端据此提示安装 git 或检查地址。
*
* 克隆目录不会被自动清理：删除收藏不会删缓存，用户需要时自己删
* `buka-skills/cache/git/`。这是有意的取舍——重新克隆一个远端仓库比留几百 MB
* 缓存更贵。
*
* `runGit` 可注入：单测用假 runner 复制 fixture 目录，不联网、也不依赖本机
* git；默认 runner 用 `execFile`，带超时、`maxBuffer` 与
* `GIT_TERMINAL_PROMPT=0`（避免卡在交互式认证）。
*
* @module @buka/dsh-plugin-skills/git-source
*/
/** 首次克隆的超时；大仓库要拉完整棵浅树，给得比 fetch 宽。 */
const CLONE_TIMEOUT_MS = 6e4;
/** fetch / reset / rev-parse 的超时：只走增量，不该很久。 */
const FETCH_TIMEOUT_MS = 15e3;
/** git 输出的上限；超过时 execFile 会报错而不是把内存吃光。 */
const MAX_BUFFER = 10485760;
/** 目录名取 sha256 的前 32 个十六进制字符（128 位），足够避免碰撞。 */
const CLONE_DIR_HASH_LENGTH = 32;
/**
* 一个 git 地址对应的克隆目录。
*
* @param homes `resolveHomes()` 的结果
* @param url 已规范化的 git 地址
*/
function gitCloneDir(homes, url) {
	const hash = createHash("sha256").update(url).digest("hex").slice(0, CLONE_DIR_HASH_LENGTH);
	return path.join(homes.dshHome, "buka-skills", "cache", "git", hash);
}
/**
* 确保一个 git 地址已经浅克隆到缓存目录，并返回它的目录与 HEAD sha。
*
* 目录已存在且 `update === false` 时直接复用；`update === true` 时尝试 fetch +
* reset，失败保留旧克隆。目录不存在时克隆到同目录下的临时目录，成功后再
* rename，避免并发读到半个克隆。同一目录的并发调用在进程内合并成一次。
*
* @param options.url 已规范化的 git 地址
*/
function ensureGitClone({ homes, url, runGit = runGitDefault, update = false }) {
	const dir = gitCloneDir(homes, url);
	const running = pendingClones.get(dir);
	if (running !== void 0) return running;
	const task = prepareClone({
		dir,
		url,
		runGit,
		update
	}).finally(() => {
		pendingClones.delete(dir);
	});
	pendingClones.set(dir, task);
	return task;
}
/**
* 同一克隆目录的进程内锁：键是目录，值是正在进行的 prepareClone。
*/
const pendingClones = /* @__PURE__ */ new Map();
/**
* `ensureGitClone()` 的实际工作，永不 reject（失败也变成 `{ ok: false }`）。
*/
async function prepareClone({ dir, url, runGit, update }) {
	try {
		if (await isDirectory(dir)) {
			if (update === true) await updateClone(dir, runGit);
			return {
				ok: true,
				dir,
				sha: await headSha(dir, runGit)
			};
		}
		const parent = path.dirname(dir);
		await promises.mkdir(parent, {
			recursive: true,
			mode: 448
		});
		const temp = path.join(parent, `.${path.basename(dir)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
		try {
			await runGit([
				"clone",
				"--depth",
				"1",
				"--single-branch",
				"--no-tags",
				"--",
				url,
				temp
			], {});
		} catch (error) {
			await promises.rm(temp, {
				recursive: true,
				force: true
			}).catch(() => {});
			return gitFailure(error);
		}
		try {
			await promises.rename(temp, dir);
		} catch (error) {
			await promises.rm(temp, {
				recursive: true,
				force: true
			}).catch(() => {});
			if (await isDirectory(dir)) return {
				ok: true,
				dir,
				sha: await headSha(dir, runGit)
			};
			return gitFailure(error);
		}
		return {
			ok: true,
			dir,
			sha: await headSha(dir, runGit)
		};
	} catch (error) {
		return gitFailure(error);
	}
}
/**
* 尝试更新已有克隆；失败时静默保留旧克隆（离线可用）。
*/
async function updateClone(dir, runGit) {
	try {
		await runGit([
			"-C",
			dir,
			"fetch",
			"--depth",
			"1",
			"origin"
		], { cwd: dir });
		await runGit([
			"-C",
			dir,
			"reset",
			"--hard",
			"FETCH_HEAD"
		], { cwd: dir });
	} catch {}
}
/**
* 取 HEAD 的 sha；失败留空串（请求方只把它当展示信息）。
*/
async function headSha(dir, runGit) {
	try {
		const result = await runGit([
			"-C",
			dir,
			"rev-parse",
			"HEAD"
		], { cwd: dir });
		if (typeof result?.stdout !== "string") return "";
		return result.stdout.trim().split(/\s+/u)[0] ?? "";
	} catch {
		return "";
	}
}
/**
* 目录是否存在且确实是目录；不存在、权限不足都算「没有」。
*/
async function isDirectory(dir) {
	try {
		return (await promises.stat(dir)).isDirectory();
	} catch {
		return false;
	}
}
/**
* 把 git 失败转成对外错误码。
*
* `execFile` 的 `error.code` 在 spawn 失败时是字符串（`ENOENT` 表示 PATH 里没有
* git），在非零退出时是数字退出码；后者统一算 `git-failed`，message 带上 stderr
* 尾部，方便用户看出是认证、地址还是网络问题。
*/
function gitFailure(error) {
	if (error !== null && typeof error === "object" && error.code === "ENOENT") return failure$1("git-unavailable", "Git executable not found; install git or add it to PATH.");
	const tail = lastLines((typeof error?.stderr === "string" ? error.stderr : "").trim(), 3);
	return failure$1("git-failed", tail === "" ? `git failed: ${errorText$1(error)}` : `git failed: ${tail}`);
}
/**
* 取文本最后几行，并限制长度，避免把整份 git 输出塞进错误消息。
*/
function lastLines(text, count) {
	if (text === "") return "";
	return text.split(/\r?\n/u).filter((line) => line.trim() !== "").slice(-count).join("\n").slice(0, 500);
}
/**
* 默认 git runner：`execFile` + 超时 + 受限输出 + 禁用交互式认证。
*/
function runGitDefault(args, { cwd } = {}) {
	const timeout = args.includes("clone") ? CLONE_TIMEOUT_MS : FETCH_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		execFile("git", args, {
			...cwd === void 0 ? {} : { cwd },
			timeout,
			maxBuffer: MAX_BUFFER,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0"
			}
		}, (error, stdout, stderr) => {
			if (error !== null) {
				error.stderr = String(stderr ?? "");
				reject(error);
				return;
			}
			resolve({
				stdout: String(stdout ?? ""),
				stderr: String(stderr ?? "")
			});
		});
	});
}
function failure$1(code, message) {
	return {
		ok: false,
		code,
		message
	};
}
function errorText$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/** 与 repo-skills 的 SKIP_DIRS 保持一致；本地模块内另写一份避免循环 import。 */
const SKIP_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"__pycache__"
]);
/**
* 打开一个本地目录来源。
*
* @param root 已规范化的本地绝对路径
*/
async function openLocalRepo(root) {
	let stats;
	try {
		stats = await promises.stat(root);
	} catch (error) {
		const code = error?.code;
		if (code === "ENOENT" || code === "ENOTDIR") return failure("repo-not-found", `Local path does not exist: ${root}`);
		return failure("fetch-failed", `Could not read local path ${root}: ${errorText(error)}`);
	}
	if (!stats.isDirectory()) return failure("repo-not-found", `Local path is not a directory: ${root}`);
	try {
		const scanned = await scanLocalTree(root);
		const realRoot = await promises.realpath(root).catch(() => root);
		return {
			ok: true,
			ref: "worktree",
			sha: "",
			truncated: scanned.truncated,
			tree: scanned.tree,
			readFile: createFileReader(realRoot)
		};
	} catch (error) {
		return failure("fetch-failed", `Could not scan local path ${root}: ${errorText(error)}`);
	}
}
/**
* 递归扫描目录，把文件收成 GitHub 树同形状的 `{ type: 'blob', path }` 数组。
*
* 用显式栈而不是递归，避免很深的目录把调用栈打爆。深度超限只是不再深入该
* 目录（继续扫其它分支）；条数超限才整轮停止，因为再扫也不会有结果被收下。
*/
async function scanLocalTree(root) {
	const tree = [];
	const queue = [{
		abs: root,
		rel: "",
		depth: 0
	}];
	let truncated = false;
	let hitEntryCap = false;
	while (queue.length > 0 && !hitEntryCap) {
		const current = queue.pop();
		if (current === void 0) break;
		let entries;
		try {
			entries = await readDirectory(current.abs);
		} catch (error) {
			if (current.rel === "") throw error;
			continue;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				if (current.depth + 1 > 32) {
					truncated = true;
					continue;
				}
				queue.push({
					abs: path.join(current.abs, entry.name),
					rel: joinRelative(current.rel, entry.name),
					depth: current.depth + 1
				});
				continue;
			}
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			if (tree.length >= 2e4) {
				truncated = true;
				hitEntryCap = true;
				break;
			}
			tree.push({
				type: "blob",
				path: joinRelative(current.rel, entry.name)
			});
		}
	}
	tree.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return {
		tree,
		truncated
	};
}
/**
* 读完一个目录的全部条目后关闭句柄；`opendir` 的迭代在异常时也要释放。
*/
async function readDirectory(abs) {
	const dir = await promises.opendir(abs);
	const entries = [];
	try {
		for await (const entry of dir) entries.push(entry);
	} finally {
		await dir.close().catch(() => {});
	}
	return entries;
}
/**
* 造一个只在 root 内读文件的 `readFile(repoPath)`。
*
* 返回 null 表示「读不到」而不是抛错：文件不存在、不是普通文件、超过大小上限
* 或读取失败都一样，调用方只需把它当成一个没有元数据的 SKILL.md。
*
* 路径先做字面检查，再按 `realpath` 复核一次：仓库（尤其是刚 clone 下来的
* 不可信仓库）里可能有指向 root 之外的符号链接，不能把本机任意文件当成仓库
* 内容读出来。
*
* @param root 真实路径（已展开符号链接）
*/
function createFileReader(root) {
	return async function readFile(repoPath) {
		const resolved = resolveInside(root, repoPath);
		if (resolved === null) return null;
		try {
			const real = await promises.realpath(resolved);
			const relative = path.relative(root, real);
			if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
			const stats = await promises.stat(real);
			if (!stats.isFile() || stats.size > 1048576) return null;
			return await promises.readFile(real, "utf8");
		} catch {
			return null;
		}
	};
}
/**
* 把仓库内相对路径解析成 root 内的绝对路径；任何可能逃出 root 的写法返回 null。
*
* 拒绝反斜杠（路径分隔符不一致会绕过检查）、绝对路径、`.` / `..` / 空段。
* 解析后再用 `path.relative` 复核一次，双保险。
*/
function resolveInside(root, repoPath) {
	if (typeof repoPath !== "string" || repoPath === "") return null;
	if (repoPath.includes("\\") || repoPath.includes("\0")) return null;
	if (path.isAbsolute(repoPath)) return null;
	const segments = repoPath.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	const resolved = path.resolve(root, ...segments);
	const relative = path.relative(root, resolved);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return resolved;
}
/**
* 拼相对路径；root 下直接用文件名，否则用 `/` 连接。
*
* @param dir 当前相对目录（root 为空串）
*/
function joinRelative(dir, name) {
	return dir === "" ? name : `${dir}/${name}`;
}
function failure(code, message) {
	return {
		ok: false,
		code,
		message
	};
}
function errorText(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// .build/skills/repo/reader.js
/**
* 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
*
* GitHub 用 API 拉树、raw.githubusercontent.com 读文件；git 来源先浅克隆到缓存
* 目录再当本地目录扫描；本地来源直接扫描目录。后面的发现规则、分类与建树只认
* 这个读取抽象，不再关心来源本身。
*
* @module @buka/dsh-plugin-skills/repo/reader
*/
/**
* 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
*
* GitHub 用 API 拉树、raw.githubusercontent.com 读文件；git 来源先浅克隆到缓存
* 目录再当本地目录扫描；本地来源直接扫描目录。
*
* 走到这里说明磁盘缓存没有命中（过期，或只有一条轻量探测结论），所以三种来源
* 都重新读一次最新内容：GitHub 重拉 tree、本地路径重扫目录、git 来源先
* `git fetch` 更新克隆（离线时 `ensureGitClone` 保留旧克隆）。
*/
async function openRepo({ origin, fetchImpl, token, homes, runGit }) {
	if (origin.kind === "github") {
		const tree = await fetchRepoTree({
			owner: origin.owner,
			repo: origin.repo,
			token,
			fetchImpl
		});
		if (!tree.ok) return tree;
		return {
			ok: true,
			ref: tree.ref,
			sha: tree.sha,
			truncated: tree.truncated,
			tree: tree.tree,
			readFile: createGithubReader({
				owner: origin.owner,
				repo: origin.repo,
				ref: tree.ref,
				token,
				fetchImpl
			})
		};
	}
	if (origin.kind === "local") return openLocalRepo(origin.root);
	const cloned = await ensureGitClone({
		homes,
		url: origin.url,
		runGit,
		update: true
	});
	if (!cloned.ok) return cloned;
	const opened = await openLocalRepo(cloned.dir);
	if (!opened.ok) return opened;
	return {
		ok: true,
		ref: "HEAD",
		sha: cloned.sha,
		truncated: opened.truncated,
		tree: opened.tree,
		readFile: opened.readFile
	};
}
// .build/skills/repo/source.js
/**
* 来源字符串 → 可列出的来源坐标。
*
* 判定顺序由 `repo-store.ts` 的 `classifyRepoSource()` 决定；这里只负责把判定
* 结果里的 GitHub 来源继续解析成 `owner/repo`，并给展示树提供来源的展示名。
*
* @module @buka/dsh-plugin-skills/repo/source
*/
/** GitHub 用户名/组织名的粗略校验（足够挡住路径与作用域包名）。 */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/** GitHub 仓库名的粗略校验。 */
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/u;
/**
* 从任意来源字符串里取出 GitHub 仓库。
*
* 接受 `owner/repo`、`github.com/owner/repo` 与 `https://github.com/owner/repo`
* （可带 `www.`、`.git` 与结尾斜杠，GitHub 子页面链接按前两段取仓库）。
* 作用域 npm 包（`@scope/pkg`）、普通包名（`notion`）与其它站点的链接返回 null。
*
* @param source 任意来源字符串
*/
function githubRepoOf(source) {
	if (typeof source !== "string") return null;
	const text = source.trim();
	if (text === "" || text.length > 300) return null;
	if (/^https?:\/\//iu.test(text)) {
		let url;
		try {
			url = new URL(text);
		} catch {
			return null;
		}
		if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
		return splitRepo(url.pathname);
	}
	const bare = /^(?:www\.)?github\.com\/(.+)$/iu.exec(text);
	if (bare !== null) return splitRepo(bare[1] ?? "");
	if (text.split("/").length !== 2) return null;
	return splitRepo(text);
}
/**
* 从 `owner/repo[/...]` 里取前两段并校验；末尾的 `.git` 去掉。
*/
function splitRepo(text) {
	const segments = text.split("/").filter((segment) => segment !== "");
	const owner = segments[0];
	const repo = segments[1];
	if (owner === void 0 || repo === void 0) return null;
	const normalizedRepo = repo.toLowerCase().endsWith(".git") ? repo.slice(0, -4) : repo;
	if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(normalizedRepo)) return null;
	return {
		owner,
		repo: normalizedRepo
	};
}
/**
* 来源的展示名：只给根目录 SKILL.md 的节点名兜底（没有 frontmatter name 时）。
*/
function originName(origin) {
	if (origin.kind === "github") return origin.repo;
	if (origin.kind === "local") {
		const base = path.basename(origin.root);
		return base === "" ? origin.root : base;
	}
	const segment = origin.url.replace(/\/+$/u, "").replace(/\.git$/iu, "").split(/[/:]/u).filter((part) => part !== "").at(-1);
	return segment === void 0 ? origin.url : segment;
}
// .build/skills/repo/groupings.js
/**
* npx skills 仓库的展示分组：读仓库根的清单，得到「skill 目录 → 插件名」。
*
* 与 `npx skills` CLI 的 `getPluginGroupings()` 一致：
*
* - 只读仓库根的 `.claude-plugin/marketplace.json` 与 `.claude-plugin/plugin.json`；
* - 只认同仓库内的本地插件：`source` 必须缺省或以 `./` 开头，远程/对象 source 跳过；
* - 只认清单里**显式声明**的 `skills` 目录（每项以 `./` 开头），其余 skill 不进组；
* - 清单缺失、JSON 不合法或形状不对都不报错，当作没有分组 —— 分组只是展示优化，
*   不能让整棵树失败。
*
* @module @buka/dsh-plugin-skills/repo/groupings
*/
/**
* 读仓库根的插件清单，返回「skill 目录 → 插件名」，用于 npx 仓库的展示分组。
*
* 与 `npx skills` CLI 的 `getPluginGroupings()` 一致：
*
* - 只读仓库根的 `.claude-plugin/marketplace.json` 与 `.claude-plugin/plugin.json`；
* - 只认同仓库内的本地插件：`source` 必须缺省或以 `./` 开头，远程/对象 source 跳过；
* - 只认清单里**显式声明**的 `skills` 目录（每项以 `./` 开头），其余 skill 不进组；
* - 清单缺失、JSON 不合法或形状不对都不报错，当作没有分组 —— 分组只是展示优化，
*   不能让整棵树失败。
*
* @returns key 是仓库内 skill 目录（'' 表示仓库根），value 是插件名
*/
async function readSkillGroupings({ tree, reader }) {
	const paths = new Set(treeBlobPaths(tree));
	const groupings = /* @__PURE__ */ new Map();
	if (paths.has(".claude-plugin/marketplace.json")) {
		const manifest = await readJsonObject(reader, MARKETPLACE_PATH);
		if (manifest !== null) applyMarketplaceGroupings(manifest, groupings);
	}
	if (paths.has(".claude-plugin/plugin.json")) {
		const manifest = await readJsonObject(reader, PLUGIN_MANIFEST_PATH);
		if (manifest !== null) applyPluginGroupings(manifest, groupings);
	}
	return groupings;
}
/**
* 读一个仓库内 JSON 文件；读不到、不是 JSON 或顶层不是对象时返回 null。
*/
async function readJsonObject(reader, repoPath) {
	let text;
	try {
		text = await reader.readFile(repoPath);
	} catch {
		return null;
	}
	if (typeof text !== "string") return null;
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	return data !== null && typeof data === "object" && !Array.isArray(data) ? data : null;
}
/**
* marketplace 清单里的插件分组：每个插件的 `skills` 数组显式列出的目录。
*/
function applyMarketplaceGroupings(manifest, out) {
	const metadata = manifest.metadata;
	const pluginRoot = manifestDir(metadata?.pluginRoot);
	if (pluginRoot === null) return;
	const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
	for (const entry of plugins) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
		const item = entry;
		const name = normalizeGroupName(item.name);
		if (name === null) continue;
		const base = manifestDir(item.source);
		if (base === null) continue;
		for (const dir of declaredSkillDirs(item.skills, joinRepoPath(pluginRoot, base))) out.set(dir, name);
	}
}
/**
* 插件根 `.claude-plugin/plugin.json` 的分组：清单 name 就是组名，`skills`
* 显式列出的目录相对插件根（仓库根）。
*/
function applyPluginGroupings(manifest, out) {
	const name = normalizeGroupName(manifest.name);
	if (name === null) return;
	for (const dir of declaredSkillDirs(manifest.skills, "")) out.set(dir, name);
}
/**
* 分组用的插件名：CLI 直接用清单里的 `name`，这里只 trim、限长并拒绝控制字符，
* 不套 Claude Code 插件的命名规则（清单里更宽松的名字也照常分组）。
*/
function normalizeGroupName(value) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text === "" || text.length > 300 || CONTROL_PATTERN.test(text)) return null;
	return text;
}
/**
* 解析清单里的一个本地目录：缺省表示插件根，字符串必须以 `./` 开头。
*
* 与 CLI 一致：undefined → 空串（插件根），合法 `./...` → 规范化后的相对路径，
* 其它（`.`、`../x`、远程 source、非字符串）→ null（跳过这个 entry）。
*
* @returns 规范化相对路径（'' 表示根），或 null 表示跳过
*/
function manifestDir(value) {
	if (value === void 0) return "";
	if (typeof value !== "string" || !value.startsWith("./")) return null;
	return normalizeManifestPath(value.slice(2));
}
/**
* 清单里声明的 skills 路径列表（CLI 允许字符串或字符串数组）。
*
* @param base 相对于仓库根的插件根
* @returns 仓库内 skill 目录
*/
function declaredSkillDirs(declared, base) {
	const list = Array.isArray(declared) ? declared : typeof declared === "string" ? [declared] : [];
	const dirs = [];
	for (const item of list) {
		if (typeof item !== "string" || !item.startsWith("./")) continue;
		const rel = normalizeManifestPath(item.slice(2));
		if (rel === null) continue;
		dirs.push(joinRepoPath(base, rel));
	}
	return dirs;
}
/**
* 规范化清单里的相对路径：去掉开头 / 结尾的多余 `/`，再要求它是安全的相对路径。
*
* @param value 已去掉 `./` 前缀的路径
*/
function normalizeManifestPath(value) {
	const trimmed = value.replace(/^\/+|\/+$/gu, "");
	if (trimmed === "") return "";
	return normalizeRelativePath(trimmed);
}
/**
* 拼两段仓库内相对路径，空串表示仓库根。
*/
function joinRepoPath(base, rel) {
	if (base === "") return rel;
	if (rel === "") return base;
	return `${base}/${rel}`;
}
// .build/skills/repo/tree.js
/**
* 把仓库内容装配成可展示的树：读 SKILL.md 元数据、按清单分组、排序。
*
* npx skills 仓库与 Claude Code marketplace 两条展示规则都在这里：
*
* - npx：展示方式与 `npx skills add --list` 一致 —— 清单里显式归到插件的
*   skill 放进以插件名命名的目录节点（同名插件的 skill 合并到同一组），其余
*   skill 平铺在根上；**不按仓库的物理目录分组**。`metadata.internal: true`
*   的内部 skill 默认不列（与 CLI 一致）；同名 skill 不去重（npx 的 GitHub
*   快路径也只是逐个列出），保留它们是为了不隐藏仓库里真实存在的文件。
* - marketplace：每个插件一个目录节点，skill 是它的直接子节点。
*
* 元数据走统一的 `reader.readFile()`：本地 / git 来源因此不碰网络，GitHub
* 来源仍是 raw 请求 + frontmatter 解析 + 固定并发。
*
* @module @buka/dsh-plugin-skills/repo/tree
*/
/** 同时拉取 SKILL.md 的并发上限，避免一次打开几十个连接。 */
const SKILL_MD_CONCURRENCY = 6;
/**
* 按分类结果把仓库内容拉成可展示的树；只用于完整展开，探测不需要。
*
* SKILL.md 元数据走同一个 `reader.readFile()`：本地 / git 来源因此不碰网络，
* GitHub 来源仍是 raw 请求 + frontmatter 解析 + 6 并发。
*
* npx 分支还会读仓库根的 `.claude-plugin/plugin.json` / `marketplace.json`
* 做展示分组（读不到或不合法就当没有分组，不影响列表）。marketplace 分支的
* 插件清单在分类时已经解析过，这里直接用。
*/
async function loadRepoContent({ tree, reader, classification, repoName }) {
	if (classification.kind === "npx-skills") return buildNpxTree(await mapLimit$1(findSkillMdPaths(tree), SKILL_MD_CONCURRENCY, (skillMd) => readSkillMetadata(skillMd, reader)), await readSkillGroupings({
		tree,
		reader
	}), repoName);
	const groups = collectMarketplaceSkills(tree, classification.marketplace);
	const paths = groups.flatMap((group) => group.skills.map((skill) => skill.path));
	const fetched = await mapLimit$1(paths, SKILL_MD_CONCURRENCY, (skillPath) => readSkillFile(reader, skillPath));
	const metas = /* @__PURE__ */ new Map();
	paths.forEach((skillPath, index) => {
		metas.set(skillPath, fetched[index]);
	});
	return {
		root: buildMarketplaceTree(groups, metas),
		skills: paths.length
	};
}
/**
* 按仓库内完整路径读取并解析一个 SKILL.md；失败时 name/description 都留空。
*
* 这是 npx 与 marketplace 两条流程共用的底层：npx 流再根据完整路径算展示用的
* 名称回退，marketplace 流直接用仓库完整路径。`reader` 屏蔽了来源差异
* （GitHub raw、本地文件或 git 克隆目录里的文件）。
*
* @param skillMd 仓库内的完整 SKILL.md 路径
*/
async function readSkillFile(reader, skillMd) {
	let text;
	try {
		text = await reader.readFile(skillMd);
	} catch {
		text = null;
	}
	try {
		const meta = parseFrontmatter(text ?? "");
		return {
			name: typeof meta.name === "string" ? meta.name : "",
			description: typeof meta.description === "string" ? meta.description : "",
			internal: parseFrontmatterInternal(text ?? "")
		};
	} catch {
		return {
			name: "",
			description: "",
			internal: false
		};
	}
}
/**
* 读取一个 SKILL.md 并解析 name/description；失败时两个字段都留空。
*
* @param skillMd 仓库内的完整 SKILL.md 路径
*/
async function readSkillMetadata(skillMd, reader) {
	const meta = await readSkillFile(reader, skillMd);
	return {
		fullPath: skillMd,
		name: typeof meta.name === "string" ? meta.name.trim() : "",
		description: typeof meta.description === "string" ? meta.description.trim() : "",
		internal: meta.internal === true
	};
}
/**
* 以固定并发跑一批异步任务，结果顺序与输入一致。
*/
async function mapLimit$1(items, limit, worker) {
	const results = new Array(items.length);
	let cursor = 0;
	async function run() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await worker(items[index], index);
		}
	}
	const workers = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workers }, () => run()));
	return results;
}
/**
* 把 npx skills 仓库的发现结果拼成展示树。
*
* 展示方式与 `npx skills add --list` 一致：清单里显式归到插件的 skill 放进
* 以插件名命名的目录节点（同名插件的 skill 合并到同一组），其余 skill 平铺在
* 根上；**不按仓库的物理目录分组**。`metadata.internal: true` 的内部 skill
* 默认不列（与 CLI 一致）；同名 skill 不去重（npx 的 GitHub 快路径也只是逐个
* 列出），保留它们是为了不隐藏仓库里真实存在的文件。
*
* - 目录节点的 `name` 与 `path` 都是插件名；
* - skill 节点的 `path` 用仓库里的完整路径（如 `skills/engineering/x/SKILL.md`）；
* - 名称缺失时用 skill 所在目录名兜底，根目录的 `SKILL.md` 用仓库名。
*
* @param groupings skill 目录 → 插件名（`readSkillGroupings()` 的结果）
*/
function buildNpxTree(entries, groupings, repoName) {
	const groups = /* @__PURE__ */ new Map();
	const plain = [];
	let skills = 0;
	for (const entry of entries) {
		if (entry.internal === true) continue;
		skills += 1;
		const node = {
			type: "skill",
			name: entry.name === "" ? fallbackSkillName(entry.fullPath, repoName) : entry.name,
			path: entry.fullPath,
			description: entry.description
		};
		const plugin = groupings.get(skillDirOf(entry.fullPath));
		if (plugin === void 0) {
			plain.push(node);
			continue;
		}
		const children = groups.get(plugin);
		if (children === void 0) groups.set(plugin, [node]);
		else children.push(node);
	}
	const root = [...[...groups].map(([name, children]) => ({
		type: "dir",
		name,
		path: name,
		children
	})), ...plain];
	sortTree(root);
	return {
		root,
		skills
	};
}
/**
* SKILL.md 所在的仓库内目录；仓库根 `SKILL.md` 返回空串。
*/
function skillDirOf(skillMd) {
	const slash = skillMd.lastIndexOf("/");
	return slash < 0 ? "" : skillMd.slice(0, slash);
}
/**
* skill 名称缺失时的兜底：skill 目录名；仓库根 `SKILL.md` 用仓库名。
*/
function fallbackSkillName(skillMd, repoName) {
	const dir = skillDirOf(skillMd);
	if (dir === "") return repoName;
	return dir.slice(dir.lastIndexOf("/") + 1);
}
/**
* 把树里的 SKILL.md 按 marketplace 插件分组。
*
* 每个插件扫它 root 下的**所有** SKILL.md（不只是 `skills/` 一层）：marketplace
* 的插件目录结构比 npx skills 自由，可能由 plugin.json 或 entry 指定自定义
* skills 目录。按插件 root 从深到浅分配，每条完整路径只归第一个插件（根插件
* 最后兜底）；`rel` 任一段落在 SKIP_DIRS 里的路径跳过。
*
* @param tree GitHub 树节点数组
*/
function collectMarketplaceSkills(tree, marketplace) {
	const skillMds = allSkillMdPaths(tree);
	const ordered = [...marketplace.plugins].sort((a, b) => pathDepth(b.root) - pathDepth(a.root));
	const groups = [];
	const claimed = /* @__PURE__ */ new Set();
	for (const plugin of ordered) {
		const skills = [];
		for (const skillPath of skillMds) {
			if (claimed.has(skillPath)) continue;
			let rel;
			if (plugin.root === "") rel = skillPath;
			else {
				if (!skillPath.startsWith(`${plugin.root}/`)) continue;
				rel = skillPath.slice(plugin.root.length + 1);
			}
			if (rel.split("/").some((segment) => SKIP_DIRS$1.has(segment))) continue;
			claimed.add(skillPath);
			skills.push({
				path: skillPath,
				rel
			});
		}
		if (skills.length > 0) groups.push({
			pluginName: plugin.name,
			pluginRoot: plugin.root,
			skills
		});
	}
	return groups;
}
/**
* marketplace 预计的 skill 数量；探测用，不拉原文。
*/
function countMarketplaceSkills(tree, marketplace) {
	return collectMarketplaceSkills(tree, marketplace).reduce((total, group) => total + group.skills.length, 0);
}
/**
* 相对路径的深度；空串（仓库根）算 0。
*/
function pathDepth(root) {
	return root === "" ? 0 : root.split("/").length;
}
/**
* 建 marketplace 的插件分组树：每个插件一个目录节点，skill 是它的直接子节点。
*
* 目录节点的 `path` 是插件 root（仓库根用 `.`），skill 节点保留仓库完整路径。
* skill 名称优先 frontmatter `name`；为空时回退到 `rel` 的倒数第二段目录名，
* `rel` 不足两段（插件根 `SKILL.md`）时回退到插件名。
*
* @param metas key 是完整路径
*/
function buildMarketplaceTree(groups, metas) {
	const nodes = groups.map((group) => ({
		type: "dir",
		name: group.pluginName,
		path: group.pluginRoot === "" ? "." : group.pluginRoot,
		children: group.skills.map((skill) => {
			const meta = metas.get(skill.path) ?? {
				name: "",
				description: ""
			};
			const segments = skill.rel.split("/");
			const fallback = segments.length >= 2 ? segments.at(-2) ?? group.pluginName : group.pluginName;
			return {
				type: "skill",
				name: meta.name === "" ? fallback : meta.name,
				path: skill.path,
				description: meta.description
			};
		})
	}));
	sortTree(nodes);
	return nodes;
}
/**
* 递归排序：目录在前、skill 在后，同类按 `name` 的大小写不敏感升序。
*/
function sortTree(nodes) {
	nodes.sort((a, b) => {
		if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
		return compareName$1(a.name, b.name);
	});
	for (const node of nodes) if (node.type === "dir") sortTree(node.children);
}
/**
* 大小写不敏感的 `localeCompare`；完全相同时再用原始大小写稳定排序。
*/
function compareName$1(a, b) {
	const folded = a.localeCompare(b, void 0, { sensitivity: "base" });
	return folded !== 0 ? folded : a.localeCompare(b);
}
// .build/skills/repo-skills.js
/**
* 「收藏的来源里有哪些 skills」：拉取、缓存与建树的入口。
*
* 页面第二个 Tab 的收藏项可能指向一个包含多个 skill 的仓库，来源可以是 GitHub
* 仓库、任意 git 远端或本地绝对路径。展开成 tree 的第一步都是拿到「仓库树 +
* 按仓库内路径读文件」：
*
* - GitHub：`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` 拿整棵树，
*   `https://raw.githubusercontent.com/.../SKILL.md` 拿文件原文；
* - 任意 git 远端：先 `git clone --depth 1` 到缓存目录（`src/git-source.ts`），
*   再把克隆目录当本地目录扫描；
* - 本地绝对路径：直接扫描目录（`src/local-source.ts`）。
*
* 三种来源最终都收敛成 `{ tree, readFile }` 的读取抽象（`openRepo()`），后面的
* 发现规则、分类与建树只认这个抽象，不再关心来源本身。
*
* 发现规则与 `npx skills` CLI 的 `findSkillMdPaths()` 保持一致（文件名必须是
* `SKILL.md`、优先级前缀、container 层级、跳过的目录），**展示方式也照 CLI 的
* 清单来**：npx 仓库不按仓库的物理目录分组。像 `skills/<bucket>/<skill>/
* SKILL.md` 这种 catalog 布局，bucket 只对发现有用，CLI 列出来的是扁平的 skill
* 列表；这里同样把 skill 平铺在根上，只有仓库根的 `.claude-plugin/plugin.json`
* 或 `.claude-plugin/marketplace.json` 里**显式声明**了某个 skill 目录属于哪个
* 插件时，才按插件名分组（与 CLI 的 `getPluginGroupings()` 一致）。skill 节点的
* `path` 仍保留仓库里的完整路径，方便排查。
*
* 收藏的仓库有两类，判定顺序固定（用户要求）：先按 `npx skills` 的优先级前缀
* （标准布局）判定 npx skills 仓库；没命中再看仓库根有没有
* `.claude-plugin/marketplace.json`，有合法清单就按 Claude Code marketplace
* 处理，只列各本地插件子树里的 SKILL.md（commands / agents 不列，用户决策），
* 每个插件一个目录节点；两者都不是时，npx 的兜底规则（任意不超过 6 段的
* SKILL.md）仍然算 npx skills 仓库；最后才标记为不可用（`repo-unavailable`）。
* 兜底排在 marketplace 之后，是因为它太宽松：`plugins/<plugin>/skills/<name>/
* SKILL.md` 正好 5 段，会命中；若它在前，marketplace 永远显示成 npx。判定本身
* 只看这棵树，不依赖清单文件；npx 仓库展开时才读清单做插件分组，判定不受影响。
*
* `probeRepoKind()` 只跑上面这套判定（只拉 tree，必要时拉 marketplace.json），
* 给收藏卡片显示徽标用，不拉任何 SKILL.md 原文。探测写下的轻量结论用
* `complete: false` 标记（`root` 固定为 `[]`），展开时才补成完整树。
*
* 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
* 按规范化来源（`owner/repo`、本地绝对路径或 git 地址）的小写键存整棵树，TTL
* 30 分钟；git 来源的克隆目录另由 `src/git-source.ts` 管理。缓存是**可重建的易失数据**：
* 文件损坏、版本不符或单条结构不合法时都直接当作未命中并重拉重写，不像收藏
* 文件那样拒绝覆盖。写入仍是原子写（同目录临时文件 + rename），避免留下半个
* 文件。SKILL.md 拉取失败只影响那一个节点的名称/描述，不会让整棵树失败。
* marketplace 的清单（`.claude-plugin/marketplace.json`）也随完整树一起缓存，
* 这样「列出市场里有哪些插件」不必重拉：树里没有 skill 的插件不会建节点，
* 但清单仍在，调用方可以列出它们并给一个空 skill 列表。
*
* 本模块只做两个入口的编排；实现按职责拆在 `src/repo/` 下：GitHub API
* （`github.ts`）、来源坐标（`source.ts`）、三种来源的读取抽象（`reader.ts`）、
* 发现规则与仓库分类（`discovery.ts`）、marketplace 清单（`marketplace.ts`）、
* 展示分组（`groupings.ts`）、建树（`tree.ts`）、缓存（`cache.ts`）。依赖只有
* Node 内置模块与这些本地模块，可单独测试；网络、时钟、git 子进程与缓存目录
* 都从参数注入。
*
* @module @buka/dsh-plugin-skills/repo-skills
*/
/**
* 拉取并缓存一个来源的 skill 树。
*
* `source` 先经 `classifyRepoSource()` 解析成三种可列出的来源之一：GitHub 仓库、
* 任意 git 远端、本地绝对路径；`@scope/pkg`、`notion` 与已知不是仓库的网页链接
* （如 GitHub 子页面）返回 `unsupported-source`。缓存命中时完全不访问来源；
* GitHub 来源依次尝试 `HEAD`、`main`、`master`，git 来源复用已经克隆的目录。
*
* 仓库分类顺序固定：npx skills → Claude Code marketplace → 不可用。用于展示
* 的目录节点路径已经去掉容器前缀，skill 节点保留完整仓库路径；marketplace
* 的根节点是「一个插件一个目录」。网络失败、限流、仓库不存在、找不到 git 等
* 情况都返回 `{ ok: false, code, message }`，不向调用方抛异常；缓存写入失败
* 则忽略，因为它随时可以重建。
*
* 命中探测写下的轻量缓存（`complete: false`）时仍会重新拉一次 tree，把完整树
* 补进缓存；命中 `kind: 'unavailable'` 且未过期时直接返回 `repo-unavailable`。
*/
async function fetchRepoSkills({ homes = resolveHomes(), source, refresh = false, fetchImpl = fetch, token, now = Date.now(), ttlMs = REPO_SKILLS_CACHE_TTL_MS, runGit } = {}) {
	const request = await resolveTarget({
		homes,
		source,
		token,
		now
	});
	if (request.ok !== true) return request.failure;
	const { origin, canonical, timestamp, resolvedToken, file, id, cached } = request;
	if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
		if (cached.kind === "unavailable") return repoUnavailable();
		if (cached.complete === true) return cachedResult(canonical, cached);
	}
	const reader = await openRepo({
		origin,
		fetchImpl,
		token: resolvedToken,
		homes,
		runGit
	});
	if (!reader.ok) return reader;
	const classification = await classifyRepo({
		tree: reader.tree,
		reader
	});
	if ("failure" in classification) return classification.failure;
	if (classification.kind === "unavailable") {
		try {
			await updateCache(file, (current) => ({
				...current,
				[id]: lightEntry({
					source: canonical,
					kind: "unavailable",
					tree: reader,
					timestamp,
					skills: 0
				})
			}));
		} catch {}
		return repoUnavailable();
	}
	const content = await loadRepoContent({
		tree: reader.tree,
		reader,
		classification,
		repoName: originName(origin)
	});
	const entry = {
		source: canonical,
		kind: classification.kind,
		ref: reader.ref,
		sha: reader.sha,
		fetchedAt: timestamp,
		truncated: reader.truncated,
		skills: content.skills,
		complete: true,
		root: content.root,
		marketplace: classification.kind === "claude-code-marketplace" ? classification.marketplace : null
	};
	try {
		await updateCache(file, (current) => ({
			...current,
			[id]: entry
		}));
	} catch {}
	return {
		ok: true,
		source: canonical,
		kind: classification.kind,
		ref: reader.ref,
		sha: reader.sha,
		fetchedAt: timestamp,
		cached: false,
		truncated: reader.truncated,
		root: content.root,
		skills: content.skills,
		marketplace: entry.marketplace
	};
}
/**
* 只探测一个来源属于哪种技能仓库，不拉任何 SKILL.md 原文。
*
* 收藏卡片打开后会自动调用它来显示徽标，所以这里只拿 tree（本地路径 / git 克隆
* 是扫目录，GitHub 是拉 tree），必要时再读一份 `marketplace.json`。失败码与
* `fetchRepoSkills` 完全一致；判定为不可用时返回 `repo-unavailable`（命中已缓存
* 的不可用结论时同样不访问来源）。
*
* 写缓存总是写轻量条目（`complete: false`，`root: []`），并且**不覆盖**已存在
* 的完整树缓存：探测刷新不该把展开时拿到的完整数据降级掉。
*/
async function probeRepoKind({ homes = resolveHomes(), source, refresh = false, fetchImpl = fetch, token, now = Date.now(), ttlMs = REPO_SKILLS_CACHE_TTL_MS, runGit } = {}) {
	const request = await resolveTarget({
		homes,
		source,
		token,
		now
	});
	if (request.ok !== true) return request.failure;
	const { origin, canonical, timestamp, resolvedToken, file, id, cached } = request;
	if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
		if (cached.kind === "unavailable") return repoUnavailable();
		return probeResult(canonical, cached, true);
	}
	const reader = await openRepo({
		origin,
		fetchImpl,
		token: resolvedToken,
		homes,
		runGit
	});
	if (!reader.ok) return reader;
	const classification = await classifyRepo({
		tree: reader.tree,
		reader
	});
	if ("failure" in classification) return classification.failure;
	const kind = classification.kind;
	const marketplace = classification.kind === "claude-code-marketplace" ? classification.marketplace : null;
	const skills = kind === "unavailable" ? 0 : kind === "npx-skills" ? findSkillMdPaths(reader.tree).length : countMarketplaceSkills(reader.tree, marketplace ?? {
		name: "",
		plugins: []
	});
	await writeProbeCache(file, id, lightEntry({
		source: canonical,
		kind,
		tree: reader,
		timestamp,
		skills
	}));
	if (kind === "unavailable") return repoUnavailable();
	return {
		ok: true,
		source: canonical,
		kind,
		skills,
		cached: false,
		ref: reader.ref,
		sha: reader.sha,
		fetchedAt: timestamp,
		truncated: reader.truncated
	};
}
/**
* 校验来源、解析 token 并读缓存：两个入口共用的前半段。
*
* 来源种类由 `classifyRepoSource()` 判定：`web` / `package` 直接返回
* `unsupported-source`（它们没有可列出的仓库树，也没有缓存条目）。
*/
async function resolveTarget({ homes, source, token, now }) {
	const classified = classifyRepoSource(source);
	if (!classified.ok) return {
		ok: false,
		failure: failure$2("invalid-source", "Invalid source: expected a GitHub owner/repo, a git URL, or an absolute path.")
	};
	if (classified.listable !== true) return {
		ok: false,
		failure: failure$2("unsupported-source", "Unsupported source: only GitHub repositories, git remotes, and local absolute paths can be listed.")
	};
	const canonical = classified.source;
	let origin;
	if (classified.kind === "github") {
		const repo = githubRepoOf(canonical);
		if (repo === null) return {
			ok: false,
			failure: failure$2("invalid-source", "Invalid source: expected a GitHub owner/repo.")
		};
		origin = {
			kind: "github",
			owner: repo.owner,
			repo: repo.repo
		};
	} else if (classified.kind === "local") origin = {
		kind: "local",
		root: canonical
	};
	else origin = {
		kind: "git",
		url: canonical
	};
	const timestamp = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
	const resolvedToken = resolveToken(token);
	const file = repoSkillsCacheFile(homes);
	const entries = await readCache(file);
	const id = repoKey(canonical);
	return {
		ok: true,
		origin,
		canonical,
		timestamp,
		resolvedToken,
		file,
		entries,
		id,
		cached: entries[id]
	};
}
/**
* 完整树缓存命中的返回；`kind` 原样带回，调用方不用再探测。
*/
function cachedResult(canonical, entry) {
	return {
		ok: true,
		source: canonical,
		kind: entry.kind,
		ref: entry.ref,
		sha: entry.sha,
		fetchedAt: entry.fetchedAt,
		cached: true,
		truncated: entry.truncated,
		root: entry.root,
		skills: entry.skills,
		marketplace: entry.marketplace ?? null
	};
}
/**
* 探测缓存的返回；没有 `root`，`skills` 是预计数量。
*/
function probeResult(canonical, entry, cached) {
	return {
		ok: true,
		source: canonical,
		kind: entry.kind,
		skills: entry.skills,
		cached,
		ref: entry.ref,
		sha: entry.sha,
		fetchedAt: entry.fetchedAt,
		truncated: entry.truncated
	};
}
/**
* 探测写下的轻量缓存条目：`root` 固定为空，`complete: false`。
*/
function lightEntry({ source, kind, tree, timestamp, skills }) {
	return {
		source,
		kind,
		ref: tree.ref,
		sha: tree.sha,
		fetchedAt: timestamp,
		truncated: tree.truncated,
		skills,
		complete: false,
		root: [],
		marketplace: null
	};
}
// .build/skills/service.js
/**
* `@buka/dsh-plugin-skills` 对外提供的 Host Service：`ctx.bukaSkills`。
*
* 页面和 `buka_skills` 工具只消费其中一部分能力；其他插件通过 Cordis 的
* 服务注入拿到同一个实例：
*
* ```js
* export const inject = ['bukaSkills']
* export function apply(ctx) {
*   const repos = await ctx.bukaSkills.listRepositories()
* }
* ```
*
* 三个公开方法形成一条从「收藏」到「仓库内容」的链：
*
* - `listRepositories()`：收藏的来源，附带探测出的类型（npx skills 仓库 /
*   Claude Code marketplace / 不可用 / 暂时判不出）与预计 skill 数。来源可以是
*   GitHub 仓库、任意 git 远端或本地绝对路径，都能探测与列出；
* - `listSkills({ source })`：某个仓库里所有可安装的 skill（扁平列表）；
* - `listPlugins({ source })`：Claude Code marketplace 里的插件，每个插件带
*   自己的 skill 列表；对非 marketplace 仓库返回 `not-a-marketplace`。
*
* 所有仓库访问都复用 `src/repo-skills.ts` 的 TTL 缓存与错误码，并且按仓库
* 来源合并并发请求：页面展开卡片、另一个插件同时调服务时，同一个仓库只会
* 拉一次（GitHub 走 API，git 远端浅克隆，本地路径直接扫描）。
* 服务本身不写任何状态，收藏的增删仍由本插件的路由负责（这是用户操作，不是
* 对外能力）。
*
* 说明：这里用 `ctx.provide()` 注册实例，而不是 `export default class extends
* Service`。原因是本包入口必须同时导出 `apply` 来注册路由与工具（Cordis 的
* 插件入口两种形态不能混用），而且本仓库的单测不安装 `@deepseek-ai/*`，
* 服务实现需要保持可被 `node --test` 直接 import。`ctx.provide` 是 Service
* 基类底层的同一个原语：消费侧完全一致（`inject: ['bukaSkills']` /
* `ctx.bukaSkills`），卸载时同样自动摘除并唤醒依赖方。
*
* @module @buka/dsh-plugin-skills/service
*/
/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaSkills`。 */
const SERVICE_NAME = "bukaSkills";
/** `listRepositories()` 并发探测的上限：收藏列表再长也不一次打开太多连接。 */
const PROBE_CONCURRENCY = 4;
/**
* 收藏仓库与仓库内容的只读服务。
*
* @example
* const service = new SkillsCatalogService()
* const { repositories } = await service.listRepositories()
* const markets = repositories.filter((one) => one.kind === 'claude-code-marketplace')
* const { plugins } = await service.listPlugins({ source: markets[0].source })
*/
var SkillsCatalogService = class {
	/** 同一来源的完整树请求合并表。 */
	#treeInFlight = /* @__PURE__ */ new Map();
	/** 同一来源的类型探测请求合并表。 */
	#probeInFlight = /* @__PURE__ */ new Map();
	/** DSH home 解析结果；收藏文件与缓存都放在它下面。 */
	homes;
	/** 默认网络实现；测试可以注入假 fetch。 */
	fetchImpl;
	constructor({ homes = resolveHomes(), fetchImpl = fetch } = {}) {
		this.homes = homes;
		this.fetchImpl = fetchImpl;
	}
	/**
	* 列出收藏的来源，并逐个探测类型与 skill 数量。
	*
	* 探测走 `probeRepoKind()`：GitHub 只拉仓库树（必要时再拉 marketplace.json），
	* git 远端先浅克隆到缓存目录，本地绝对路径直接扫描目录；都不拉任何
	* `SKILL.md` 原文。结论按 30 分钟 TTL 缓存，`refresh: true` 时绕过缓存重新
	* 探测。同一条来源的并发探测会被合并。
	*
	* 失败不会让整个列表失败：条目退回 `kind: 'unknown'`，并带上探测错误码与
	* 原因（npm 包名、GitHub 子页面等不可列出的来源也会落到这里），其他收藏照常
	* 返回。
	*/
	async listRepositories({ refresh = false, ...io } = {}) {
		const store = await listSavedRepos({ homes: this.homes });
		const repositories = await mapLimit(store.repos, PROBE_CONCURRENCY, async (repo) => {
			const probed = await this.probeRepositoryKind({
				...io,
				source: repo.source,
				refresh
			});
			if (probed.ok) return {
				...repo,
				kind: probed.kind,
				skills: probed.skills
			};
			if (probed.code === "repo-unavailable") return {
				...repo,
				kind: "unavailable",
				skills: 0
			};
			return {
				...repo,
				kind: "unknown",
				skills: null,
				code: probed.code,
				error: probed.message
			};
		});
		return {
			file: store.file,
			exists: store.exists,
			corrupt: store.corrupt,
			repositories
		};
	}
	/**
	* 列出一个仓库里所有可安装的 skill。
	*
	* 列表扁平化：npx skills 仓库按 `npx skills` 的发现规则列，仓库清单里显式
	* 声明的插件分组同样用 `plugin` 标出；Claude Code marketplace 把每个插件下
	* 的 skill 一起列出来。结果与页面展开的树来自同一次拉取（同一份缓存），
	* 所以两处不会互相矛盾。
	*/
	async listSkills({ source, refresh = false, ...io } = {}) {
		const fetched = await this.fetchRepositorySkills({
			...io,
			source,
			refresh
		});
		if (!fetched.ok) return fetched;
		return {
			ok: true,
			source: fetched.source,
			kind: fetched.kind,
			ref: fetched.ref,
			sha: fetched.sha,
			fetchedAt: fetched.fetchedAt,
			cached: fetched.cached,
			truncated: fetched.truncated,
			skills: flattenSkillTree(fetched)
		};
	}
	/**
	* 列出 Claude Code marketplace 里声明的插件，每个插件带自己的 skill 列表。
	*
	* 清单来自仓库根的 `.claude-plugin/marketplace.json`：没有 skill 的插件也会
	* 出现（`skills: []`），因为它们可能只提供 commands / agents。对 npx skills
	* 仓库、不可用仓库或探测失败的仓库返回 `not-a-marketplace` / 对应仓库错误，
	* 调用方可以先调 `listRepositories()` 判断类型再调用。
	*/
	async listPlugins({ source, refresh = false, ...io } = {}) {
		const fetched = await this.fetchRepositorySkills({
			...io,
			source,
			refresh
		});
		if (!fetched.ok) return fetched;
		if (fetched.kind !== "claude-code-marketplace") return {
			ok: false,
			code: "not-a-marketplace",
			message: `${fetched.source} is ${fetched.kind}, not a Claude Code plugin marketplace.`
		};
		const treeByRoot = /* @__PURE__ */ new Map();
		for (const node of fetched.root) if (node.type === "dir") treeByRoot.set(node.path, node);
		const plugins = (fetched.marketplace?.plugins ?? []).map((plugin) => {
			const node = treeByRoot.get(plugin.root === "" ? "." : plugin.root);
			return {
				name: plugin.name,
				root: plugin.root,
				description: plugin.description,
				skills: node === void 0 ? [] : flattenSkills(node.children, plugin.name)
			};
		});
		plugins.sort((a, b) => compareName(a.name, b.name));
		return {
			ok: true,
			source: fetched.source,
			kind: fetched.kind,
			ref: fetched.ref,
			sha: fetched.sha,
			fetchedAt: fetched.fetchedAt,
			cached: fetched.cached,
			truncated: fetched.truncated,
			plugins
		};
	}
	/**
	* 拉取一个仓库的完整 skills 树（带缓存与并发合并）。
	*
	* @internal 路由适配器用；其他插件优先用 `listSkills()` / `listPlugins()`。
	*/
	fetchRepositorySkills({ source, refresh = false, ...io } = {}) {
		return this.#coalesce(this.#treeInFlight, source, refresh, () => fetchRepoSkills({
			...io,
			homes: this.homes,
			source,
			refresh,
			fetchImpl: io.fetchImpl ?? this.fetchImpl
		}));
	}
	/**
	* 只探测一个仓库的类型（带缓存与并发合并）。
	*
	* @internal 路由适配器与 `listRepositories()` 用。
	*/
	probeRepositoryKind({ source, refresh = false, ...io } = {}) {
		return this.#coalesce(this.#probeInFlight, source, refresh, () => probeRepoKind({
			...io,
			homes: this.homes,
			source,
			refresh,
			fetchImpl: io.fetchImpl ?? this.fetchImpl
		}));
	}
	/**
	* 同一来源的并发请求共用一次网络拉取；`refresh` 请求不合并，保证「刷新」
	* 真的重新拉。请求 settle 后从表里移除，失败也不会留下毒化的 promise。
	*/
	#coalesce(inFlight, source, refresh, work) {
		const key = String(source);
		if (!refresh) {
			const pending = inFlight.get(key);
			if (pending !== void 0) return pending;
		}
		const run = work();
		if (!refresh) {
			inFlight.set(key, run);
			run.then(() => inFlight.delete(key), () => inFlight.delete(key));
		}
		return run;
	}
};
/**
* 把 `fetchRepoSkills()` 返回的树摊平成 skill 列表。
*
* 树根的目录节点都是插件分组（marketplace 的插件，或 npx 仓库清单里显式
* 声明的插件），用节点名作为 `plugin`；平铺在根上的 skill `plugin` 为 null。
*/
function flattenSkillTree(fetched) {
	return fetched.root.flatMap((node) => node.type === "dir" ? flattenSkills(node.children, node.name) : flattenSkills([node], null));
}
/**
* 深度优先摊平一棵树里的 skill 节点，保留树里的排序。
*/
function flattenSkills(nodes, plugin, out = []) {
	for (const node of nodes) if (node.type === "skill") out.push({
		name: node.name,
		description: node.description,
		path: node.path,
		plugin
	});
	else flattenSkills(node.children, plugin, out);
	return out;
}
/**
* 与页面一致的大小写不敏感排序；完全相同时再用原始大小写稳定排序。
*/
function compareName(a, b) {
	const folded = a.localeCompare(b, void 0, { sensitivity: "base" });
	return folded !== 0 ? folded : a.localeCompare(b);
}
/**
* 以固定并发跑一批异步任务，结果顺序与输入一致。
*/
async function mapLimit(items, limit, worker) {
	const results = new Array(items.length);
	let cursor = 0;
	async function run() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await worker(items[index], index);
		}
	}
	const workers = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workers }, () => run()));
	return results;
}
// .build/skills/snapshot.js
/**
* 已安装 skills 的快照：路由与模型工具共用同一份读取逻辑。
*
* skills 注册表读取失败时仍然返回磁盘扫描结果，只是描述为空：页面与工具
* 都不该因为注册表故障而看不到已安装的 skill。
*
* @module @buka/dsh-plugin-skills/snapshot
*/
/**
* 读取快照。skills 注册表读取失败时仍然返回磁盘扫描结果，只是描述为空：
* 页面不该因为注册表故障而看不到已安装的 skill。
*
* @param ctx 提供 `skills` 的插件上下文
* @param homes 两个全局根目录
*/
async function readSnapshot(ctx, homes) {
	let summaries = [];
	try {
		summaries = await ctx.skills.list({ cwd: homes.agentsHome });
	} catch (error) {
		ctx.logger?.warn?.("buka-skills: 无法读取 skills 注册表：%s", describeError$1(error));
	}
	return collectGlobalSkills({
		homes,
		summaries
	});
}
// .build/skills/tools.js
/**
* 模型工具：只读列举全局 skills。
*
* 一个只读工具 `buka_skills`，让模型能回答「本机装了哪些全局 skill、它们
* 是不是 npx skills 装的」。安装与卸载都是写操作，只留给页面上的用户按钮，
* 不开放给模型。
*
* @module @buka/dsh-plugin-skills/tools
*/
/**
* 注册只读工具。
*
* @param ctx 提供 `tools` 的插件上下文
* @param deps 入口装配好的共享依赖
*/
function registerTools(ctx, deps) {
	const { readSnapshot } = deps;
	ctx.inject(["tools"], (toolCtx) => {
		toolCtx.tools.register(defineTool({
			name: "buka_skills",
			description: "List the skills installed globally for every DSH session (~/.agents/skills and ~/.dsh/skills) and mark the ones the npx skills CLI installed and manages. Use it when the user asks which global skills exist or how one of them got installed. Uninstalling is a user action on the Skills page in the DSH sidebar.",
			parameters: {},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { skills: {
						type: "array",
						required: true,
						description: "Global skills, sorted by name.",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: {
									type: "string",
									required: true,
									description: "Skill name from its frontmatter."
								},
								description: {
									type: "string",
									required: true,
									description: "Skill description from its frontmatter."
								},
								scope: {
									type: "string",
									required: true,
									description: "agents for ~/.agents/skills or dsh for ~/.dsh/skills."
								},
								managedByNpx: {
									type: "boolean",
									required: true,
									description: "Whether the npx skills CLI installed and manages this skill."
								},
								source: {
									type: "string",
									description: "For npx-managed skills, the source repository such as firecrawl/skills."
								}
							}
						}
					} }
				},
				render: (_args, value) => {
					const skills = Array.isArray(value?.skills) ? value.skills : [];
					if (skills.length === 0) return [{
						type: "text",
						text: "No global skills are installed."
					}];
					return [{
						type: "text",
						text: skills.map((skill) => {
							const origin = skill.managedByNpx ? "npx skills" : "manual";
							const source = skill.source === void 0 ? "" : ` — ${skill.source}`;
							return `- ${skill.name} (${origin}, ${skill.scope})${source}`;
						}).join("\n")
					}];
				}
			},
			async execute() {
				return { skills: (await readSnapshot()).skills.map((skill) => ({
					name: skill.name,
					description: skill.description,
					scope: skill.scope,
					managedByNpx: skill.managedByNpx,
					...skill.npxSource === null ? {} : { source: skill.npxSource }
				})) };
			}
		}));
	});
}
// .build/skills/index.js
/**
* 全局 skills 管理插件：Host 一半。
*
* 提供三件东西：
*
* - 包内 HTTP 路由，给浏览器一半的侧边栏「Skills」页面用：
*   `GET /buka-skills/list` 列出全局 skills，`POST /buka-skills/uninstall` 卸载一个，
*   `GET /buka-skills/targets` 列出可安装的打工人（可选的 `ctx.bukaWorkers`）与
*   工作区（`ctx.workspaceRegistry`），`POST /buka-skills/install` 把某个收藏仓库
*   里的一个 skill 安装到全局、某个打工人目录或某个工作区目录；
*   `GET /buka-skills/repos` 列出用户收藏的仓库，
*   `POST /buka-skills/repos` 收藏一个，`POST /buka-skills/repos/remove` 移除一个，
*   `GET /buka-skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
*   `probe=1` 时只探测仓库类型：npx skills / Claude Code marketplace / 不可用）。
*   收藏的仓库既可以是 npx skills 仓库，也可以是 Claude Code marketplace 仓库：
*   前者按 `npx skills` 的发现规则列 SKILL.md，后者只列 marketplace 里各本地
*   插件子树中的 SKILL.md（commands / agents 不列）。收藏来源可以是 GitHub
*   仓库、任意 git 远端（Host 用 `git clone --depth 1` 拉到缓存目录再扫描）或
*   本地绝对路径（直接扫描目录）。列表数据来自同一份磁盘扫描
*   （`src/skill-store.ts`），收藏来自 `src/repo-store.ts` 的 JSON 文件，
*   仓库 skills 由 `src/repo-skills.ts` 按 TTL 缓存仓库树，安装由
*   `src/skill-install.ts` 交给 `npx skills add`（与卸载共用串行队列）；
* - 一个只读工具 `buka_skills`，让模型能回答「本机装了哪些全局 skill、它们
*   是不是 npx skills 装的」。安装与卸载都是写操作，只留给页面上的用户按钮，
*   不开放给模型。
* - 一个 Host Service `ctx.bukaSkills`（`src/service.ts`）：把收藏的仓库、
*   仓库里的 skill 列表与 marketplace 插件列表开放给其他插件。页面与工具
*   也复用同一个服务实例，因此两处的缓存与并发请求是同一份。
*
* 本文件只做装配：路由在 `src/routes.ts`，模型工具在 `src/tools.ts`，快照读取
* 在 `src/snapshot.ts`，请求体 / 响应工具在 `src/http.ts`，串行队列在
* `src/serial-queue.ts`。路由在 `webServer` 就绪后注册，并沿用 web 组合的
* 信任栅栏（`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
*
* @module @buka/dsh-plugin-skills
*/
/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
const name = "skill-buka-skills";
/** 依赖的服务：列举 skill 需要 skills 注册表；页面与工具各自按可选依赖挂载。 */
const inject = ["skills"];
/**
* 注册路由与只读工具。
*
* @param ctx 提供 `skills` 的插件上下文
*/
function apply(ctx) {
	const homes = resolveHomes();
	const runNpx = createNpxRunner({
		cwd: homes.agentsHome,
		timeoutMs: 18e4,
		missingMessage: `没有找到 npx。请先安装 Node.js（含 npm），或手动管理 ${path.join(homes.agentsHome, "skills")} 下的 skill。`
	});
	const catalog = new SkillsCatalogService({ homes });
	ctx.provide(SERVICE_NAME, catalog);
	/** 读取一份已安装 skills 快照；路由与工具共用。 */
	const snapshot = () => readSnapshot(ctx, homes);
	registerRoutes(ctx, {
		homes,
		runNpx,
		catalog,
		readSnapshot: snapshot,
		serializeNpx: createSerialQueue()
	});
	registerTools(ctx, { readSnapshot: snapshot });
}
export { apply, inject, name };
