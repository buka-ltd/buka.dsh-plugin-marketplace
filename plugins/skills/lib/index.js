import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promises } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { installSkills, removeSkills } from "skills";
import { createHash } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
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
// packages/plugin-ui/lib/worker-label.js
/**
* 执行者展示名的统一写法：两个插件都用「名称 · 标识符」消歧。
*
* 标识符是不可变引用键，名称是可选展示名；只读接口可能只给其中一个，也可能
* 直接给算好的 `displayName`。这里按「名称 → displayName → 标识符」取展示名，
* 标识符缺失时退回带过来的 `name`（v7 旧作业快照的形状）。
*
* @module @buka/plugin-ui/worker-label
*/
/** 取一个字段的 trim 值；不是字符串或为空时给空串。 */
function text(value) {
	return typeof value === "string" ? value.trim() : "";
}
/**
* 执行者展示名：名称非空时用它，否则用算好的 `displayName`，再否则用标识符。
*
*/
function workerDisplayName(worker) {
	const name = text(worker?.name);
	if (name !== "") return name;
	const display = text(worker?.displayName);
	if (display !== "") return display;
	return text(worker?.id);
}
/**
* 「展示名 · 标识符」：列表、详情与对话框里用来消歧。展示名等于标识符
* （没设置名称）时只显示标识符，避免出现 `writer · writer`。
*
*/
function workerIdentityLabel(worker) {
	const id = text(worker?.id) || text(worker?.name);
	const display = workerDisplayName(worker);
	if (id === "") return display;
	return display === "" || display === id ? id : `${display} · ${id}`;
}
// .build/skills/install-targets.js
/**
* 全局之外的安装目标：执行者目录与工作区目录。
*
* 收藏页的「安装到执行者 / 安装到工作区」需要两份列表，两份都来自别的插件或
* 宿主服务，不能由浏览器传路径：
*
* - 执行者：`ctx.workflowWorkers`（workers 插件提供）的 `list()`。只保留智能体、
*   目录存在的执行者；机器人没有目录，装不了项目级 skill。引用键是不可变的
*   标识符 `id`，`name` 只是可选展示名（可以为空），旧版没有 `id` 时退回
*   `name`。
* - 工作区：`ctx.workspaceRegistry`（DSH 自带）的 `list()`，取已注册工作区的
*   规范路径与标题。
*
* 安装时按标识符 / 路径在这两份列表里重新解析，解析结果只来自 Host 这次读到的
* 登记表。浏览器传来的字符串永远只当日志里的选择依据，不会被直接拼进
* 安装 / 更新时使用的工作目录。
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
* 取一条执行者记录的引用键：非空 `id`；旧版记录没有 `id` 时退回非空 `name`。
*
* `name` 只是可选展示名，不能单独作为新记录的键；只有仍只返回 `name` 的旧版
* workers 才用它兜底。
*
* @param record `workflowWorkers.list()` 的一条记录
*/
function workerKeyOf(record) {
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (id !== "") return id;
	return typeof record.name === "string" ? record.name.trim() : "";
}
/**
* 规范化执行者列表：只要智能体、目录存在、标识符与路径都非空的条目。
*
* workers 插件的 `list()` 返回 `workers` 数组，字段随版本可能增减；这里按字段
* 读取而不是依赖固定类型，旧版本缺 `exists` 时按「存在」处理（安装时还会再
* 确认一次目录）。`name` 可以为空，按原值带回页面展示。
*
* @param result `workflowWorkers.list()` 的返回值
*/
function normalizeWorkers(result) {
	const workers = result?.workers;
	if (!Array.isArray(workers)) return [];
	const byKey = /* @__PURE__ */ new Map();
	for (const value of workers) {
		if (value === null || typeof value !== "object") continue;
		const record = value;
		if (record.driver === "robot" || record.exists === false) continue;
		const key = workerKeyOf(record);
		const workerPath = typeof record.path === "string" ? record.path.trim() : "";
		if (key === "" || workerPath === "" || byKey.has(key)) continue;
		byKey.set(key, {
			id: key,
			name: typeof record.name === "string" ? record.name : "",
			path: workerPath,
			description: typeof record.description === "string" ? record.description : ""
		});
	}
	return [...byKey.values()].sort((left, right) => left.id.localeCompare(right.id));
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
* 读执行者列表；服务缺失时 `available: false`，读取失败时带上原因。
*
* @param ctx 插件上下文
*/
async function readWorkers(ctx) {
	const service = optionalService(ctx, "workflowWorkers");
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
* @param label 展示标签（执行者按「名称 · 标识符」消歧，工作区用标题）
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
* - 执行者按标识符在 `ctx.workflowWorkers` 的列表里找（旧版记录没有 `id` 时，
*   浏览器传的仍是 `name`）；
* - 工作区按路径（也接受 id）在 `ctx.workspaceRegistry` 的列表里找。
*
* 找不到、服务缺失或目录已消失都返回稳定的错误码，由路由映射成 HTTP 状态码。
*
* @param ctx 插件上下文
* @param request 浏览器选中的目标
*/
async function resolveInstallTarget(ctx, request) {
	if (request?.target === "worker") {
		const wanted = typeof request.worker === "string" ? request.worker.trim() : "";
		if (wanted === "") return {
			ok: false,
			code: "invalid-target",
			message: "缺少执行者标识符"
		};
		const workers = await readWorkers(ctx);
		if (!workers.available) return {
			ok: false,
			code: "workers-unavailable",
			message: "没有找到执行者插件（@buka/dsh-plugin-workers），无法安装到执行者"
		};
		if (workers.error !== null) return {
			ok: false,
			code: "workers-unavailable",
			message: workers.error
		};
		const found = workers.items.find((worker) => worker.id === wanted);
		if (found === void 0) return {
			ok: false,
			code: "unknown-worker",
			message: `没有找到这个执行者（可能只支持智能体）：${wanted}`
		};
		return confirmDirectory(found.path, workerIdentityLabel(found));
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
// .build/skills/repo-icons.js
/**
* 仓库头像缓存：把 GitHub owner 的头像落盘到 DSH home，页面通过包内路由读取。
*
* 头像只用来识别来源。以前页面直接把 `<img>` 指向 `github.com/<owner>.png`，
* 每次打开页面都要重新走一次外网；这里改成 Host 先查本地缓存：
*
* - 有缓存：立刻返回旧图，不访问外网；
* - 缓存超过 TTL：仍然立刻返回旧图，同时在后台静默拉一次新图写回；
* - 没有缓存：同步拉一次，失败就让页面回退到内置图标。
*
* 缓存按 owner 去重（GitHub 仓库头像就是 owner 头像），一个 owner 一个文件。
* 图标是可重建的易失数据：文件损坏、内容不是支持的图片格式时按未命中处理；
* 写入是同目录临时文件 + rename，读到的永远是完整图片。
*
* @module @buka/dsh-plugin-skills/repo-icons
*/
/** 页面读取仓库头像用的路由。 */
const ICON_ROUTE = "/skills/icon";
/** 拉头像的超时：头像很小，10 秒足够。 */
const ICON_FETCH_TIMEOUT_MS = 1e4;
/** 头像大小上限；GitHub 的 80px 头像远小于这个值。 */
const MAX_ICON_BYTES = 524288;
/** 缓存目录与文件名（owner 小写后加固定后缀）。 */
const ICON_DIR = "icons";
const ICON_SUFFIX = ".img";
/** 合法的 GitHub owner：首字符字母数字，其余只允许字母数字、点、下划线、连字符。 */
const OWNER_PATTERN$1 = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/**
* owner 是否安全：只允许 GitHub 用户名 / 组织名里的字符，避免拼出缓存路径之外
* 的文件名。
*/
function isSafeIconOwner(value) {
	return typeof value === "string" && value.length <= 100 && OWNER_PATTERN$1.test(value);
}
/** 头像缓存目录。 */
function iconCacheDir(homes) {
	return path.join(homes.dshHome, "buka-skills", "cache", ICON_DIR);
}
/** 一个 owner 的缓存文件路径；owner 统一小写，大小写不同的写法共用同一份缓存。 */
function iconCacheFile(homes, owner) {
	return path.join(iconCacheDir(homes), `${owner.toLowerCase()}${ICON_SUFFIX}`);
}
/** PNG 文件头。 */
const PNG_SIGNATURE = Buffer.from([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
]);
/**
* 从图片头判断类型；只接受页面能安全显示的位图格式。
*
* @param data 图片字节
*/
function sniffContentType(data) {
	if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
	if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
	if (data.length >= 6 && data.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
	if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
	return null;
}
/**
* 读缓存；文件缺失、损坏、不是支持的图片或超过大小上限都按未命中处理。
*
* @param file 缓存文件
*/
async function readCachedIcon(file) {
	try {
		const stats = await promises.stat(file);
		if (!stats.isFile() || stats.size === 0 || stats.size > MAX_ICON_BYTES) return null;
		const data = await promises.readFile(file);
		const contentType = sniffContentType(data);
		if (contentType === null) return null;
		return {
			data,
			contentType,
			mtimeMs: stats.mtimeMs
		};
	} catch {
		return null;
	}
}
/**
* 原子写图标：同目录临时文件 → rename；失败时清理临时文件。
*
* @param file 目标文件
* @param data 图片字节
*/
async function writeIconAtomic(file, data) {
	const dir = path.dirname(file);
	await promises.mkdir(dir, {
		recursive: true,
		mode: 448
	});
	const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await promises.writeFile(temporary, data, { mode: 384 });
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
/**
* 从 GitHub 拉一张 owner 头像。
*
* 只接受能嗅探出 PNG / JPEG / GIF / WebP 的响应；网络失败、非 2xx、超大响应
* 都返回 null，由调用方回退到缓存或内置图标。
*
* @param owner GitHub owner（调用方已校验）
* @param fetchImpl 可注入的 fetch
*/
async function fetchGithubIcon(owner, fetchImpl) {
	let response;
	try {
		response = await fetchImpl(`https://github.com/${owner}.png?size=80`, {
			redirect: "follow",
			headers: {
				accept: "image/*",
				"user-agent": "buka-dsh-plugin-skills"
			},
			signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS)
		});
	} catch {
		return null;
	}
	if (!response.ok) return null;
	const declared = Number(response.headers.get("content-length") ?? "");
	if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return null;
	let data;
	try {
		data = Buffer.from(await response.arrayBuffer());
	} catch {
		return null;
	}
	if (data.length === 0 || data.length > MAX_ICON_BYTES) return null;
	const contentType = sniffContentType(data);
	return contentType === null ? null : {
		data,
		contentType
	};
}
/**
* 建一个图标缓存实例。
*
* @param deps DSH home 与可注入的 fetch / 时钟
*/
function createIconCache(deps) {
	const fetchImpl = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;
	const inFlight = /* @__PURE__ */ new Map();
	/**
	* 拉取并写回一张头像；同一 owner 的并发调用合并。
	*
	* @param owner 已校验的 owner
	*/
	function refresh(owner) {
		const key = owner.toLowerCase();
		const existing = inFlight.get(key);
		if (existing !== void 0) return existing;
		const run = (async () => {
			const image = await fetchGithubIcon(owner, fetchImpl);
			if (image === null) return null;
			try {
				await writeIconAtomic(iconCacheFile(deps.homes, owner), image.data);
			} catch {}
			return image;
		})();
		inFlight.set(key, run);
		const clear = () => {
			if (inFlight.get(key) === run) inFlight.delete(key);
		};
		run.then(clear, clear);
		return run;
	}
	async function load(owner) {
		if (!isSafeIconOwner(owner)) return null;
		const cached = await readCachedIcon(iconCacheFile(deps.homes, owner));
		if (cached === null) return refresh(owner);
		if (now() - cached.mtimeMs >= 18e5) refresh(owner).catch(() => {});
		return {
			data: cached.data,
			contentType: cached.contentType
		};
	}
	async function whenIdle() {
		await Promise.allSettled([...inFlight.values()]);
	}
	return {
		load,
		whenIdle
	};
}
process.platform;
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
* - `skills` 库管理（位于 `~/.agents/skills` 且在该工具的 lockfile 里）：
*   交给 `removeSkills()`，由它同时清理规范副本、各 agent 目录里的链接与
*   lockfile 记录；
* - 其它（手工安装，或 `~/.dsh/skills` 下的 skill）：直接删除扫描到的目录或文件。
*
* lockfile 存在却读不出来时，agents 根下的 skill 一律拒绝卸载：这时无法判断
* 它是否由库管理，直接删目录会留下 lock 记录与悬空链接。两种方式都会在最后
* 确认目标真的消失了。
*/
async function uninstallGlobalSkill({ homes = resolveHomes(), scope, id, remove = removeSkills, env = process.env }) {
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
	if (typeof remove !== "function") return {
		ok: false,
		code: "no-remover",
		message: "缺少删除 skill 的能力"
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
				result = await remove([id], {
					scope: "global",
					config: { telemetry: false }
				});
			} catch (error) {
				return {
					ok: false,
					code: "remove-failed",
					message: errorText$5(error)
				};
			}
			if (result.failed.length > 0) return {
				ok: false,
				code: "remove-failed",
				message: result.failed.map((one) => `${one.skill}：${one.message}`).join("；")
			};
			if (result.removed.length === 0 && result.notFound.length > 0) return {
				ok: false,
				code: "not-found",
				message: `没有找到这个 skill：${id}`
			};
			if (await pathExists$1(entry.path)) return {
				ok: false,
				code: "remove-incomplete",
				message: "已执行删除，但 skill 目录仍然存在"
			};
			return {
				ok: true,
				method: "npx"
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
* 「技能仓库」Tab 让用户记下以后想用的 skill 来源，方便随时取用。这份清单是
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
/** 安装时指定的 agent：`universal` 读写 `~/.agents/skills`（项目里是 `.agents/skills`）。 */
const INSTALL_AGENT = "universal";
/** 执行者额外落一份 `.claude/skills` 链接。 */
const WORKER_CLAUDE_AGENT = "claude-code";
/**
* 库的全局规范副本目录（`~/.agents/skills` 的上级），DSH 的 `user-agents`
* 根也在这里。`skills` 的规则是 `homedir()/.agents/skills`，不接受别的路径覆盖。
*/
function npxGlobalAgentsHome() {
	return path.join(os.homedir(), AGENTS_DIR);
}
/**
* skill 名对应的安装目录名，规则与 `skills` 的 `sanitizeName()` 完全一致：
* 小写，非 `[a-z0-9._]` 的连续字符换成连字符，去掉首尾的 `.` 与 `-`，最多 255 字符。
*
* @param name skill 名
* @returns 目录名；名字不合法时可能是空串
*/
function skillDirName(name) {
	if (typeof name !== "string") return "";
	return name.toLowerCase().replace(/[^a-z0-9._]+/gu, "-").replace(/^[.-]+|[.-]+$/gu, "").slice(0, 255);
}
/**
* 这个 skill 名能不能交给安装库：
*
* - 非空、不超过 255 字符；
* - 不能以 `-` 或空白开头（会被当成命令行选项）；
* - 不能含控制字符；
* - 必须能 sanitize 出非空目录名。
*
* 空格是允许的：仓库里确实有 `Convex Best Practices` 这类带空格的名字。
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
* 安装前共用的来源 / 名字校验：全局、执行者、工作区三处都必须过这一关。
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
* 库的全局副本目录与 DSH 扫描的目录是否一致；不一致时返回拒绝理由。
*/
function globalHomeMismatch$1(homes, canonicalAgentsHome) {
	if (path.resolve(canonicalAgentsHome) === path.resolve(homes.agentsHome)) return null;
	return `skills 把全局 skill 装到 ${path.join(canonicalAgentsHome, "skills")}，而 DSH 现在扫描的是 ${path.join(homes.agentsHome, "skills")}（DSH_AGENTS_HOME）；为避免装到看不见的位置，这里不执行安装`;
}
/**
* 安装后的结果核对：库报告成功的条目里选 universal（或第一个），确认目标
* 目录里真的有 `SKILL.md`。
*/
async function installedPathOf(result, fallbackDir, id) {
	if (result.failed.length > 0) {
		const first = result.failed[0];
		return {
			ok: false,
			message: `${first?.skill ?? ""}（${first?.agent ?? ""}）：${first?.message ?? "安装失败"}`
		};
	}
	const chosen = result.installed.find((one) => one.agent === "universal") ?? result.installed[0];
	const target = chosen?.canonicalPath ?? chosen?.path ?? path.join(fallbackDir, id);
	if (!await pathExists(path.join(target, "SKILL.md"))) return {
		ok: false,
		message: `安装已结束，但没有在 ${target} 找到 SKILL.md`
	};
	return {
		ok: true,
		path: target
	};
}
/**
* 把单个 skill 从某个来源安装到全局 `~/.agents/skills`。
*
* 失败码：
*
* - `invalid-source`：来源为空或以 `-` 开头；
* - `invalid-skill-name`：名字不能安全地交给安装库；
* - `no-installer`：调用方没给安装能力；
* - `unsupported-home`：`DSH_AGENTS_HOME` 指到了库不会写入的位置；
* - `scan-failed`：读全局 skills 目录失败，无法判断是否已安装；
* - `already-installed`：两个全局根里已经有同名 skill；
* - `install-failed`：安装库失败，`output` 带库返回的失败说明；
* - `install-incomplete`：库报告成功但目标目录 / `SKILL.md` 不在。
*/
async function installGlobalSkill({ homes = resolveHomes(), canonicalAgentsHome = npxGlobalAgentsHome(), source, name, install = installSkills }) {
	const checked = checkSourceAndName(source, name);
	if (!checked.ok) return checked.result;
	const { source: trimmedSource, name: skillName } = checked;
	if (typeof install !== "function") return {
		ok: false,
		code: "no-installer",
		message: "缺少安装 skill 的能力"
	};
	if (path.resolve(canonicalAgentsHome) !== path.resolve(homes.agentsHome)) return {
		ok: false,
		code: "unsupported-home",
		message: globalHomeMismatch$1(homes, canonicalAgentsHome) ?? ""
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
		message: `这个 skill 已经全局安装（${existing.scope}）：${existing.id}；如需重装，请先在「全局技能」里卸载`
	};
	let result;
	try {
		result = await install(trimmedSource, {
			skills: [skillName],
			scope: "global",
			agents: [INSTALL_AGENT],
			config: { telemetry: false }
		});
	} catch (error) {
		return {
			ok: false,
			code: "install-failed",
			message: errorText$3(error)
		};
	}
	const target = await installedPathOf(result, path.join(canonicalAgentsHome, "skills"), id);
	if (!target.ok) return {
		ok: false,
		code: result.failed.length > 0 ? "install-failed" : "install-incomplete",
		message: target.message
	};
	return {
		ok: true,
		id,
		name: skillName,
		target: "global",
		scope: "agents",
		path: target.path,
		output: ""
	};
}
/**
* 把单个 skill 从某个来源安装到执行者或工作区目录。
*
* 目标目录由调用方（`install-targets.ts`）从 Host 的登记表解析，浏览器不能
* 直接指定路径。项目级安装不检查「已安装」：同一个 skill 装进另一个执行者 /
* 工作区是正常操作，重复执行交给安装库自己处理。
*
* 执行者目录按 workers 插件的约定同时落 `.agents/skills` 与 `.claude/skills`
* （`agents: ['universal', 'claude-code']`）；工作区只写 DSH 会扫描的
* `.agents/skills`，不碰用户其它 agent 目录。
*/
async function installProjectSkill({ targetDir, target = "workspace", source, name, install = installSkills }) {
	const checked = checkSourceAndName(source, name);
	if (!checked.ok) return checked.result;
	const { source: trimmedSource, name: skillName } = checked;
	if (typeof install !== "function") return {
		ok: false,
		code: "no-installer",
		message: "缺少安装 skill 的能力"
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
	const agents = target === "worker" ? [INSTALL_AGENT, WORKER_CLAUDE_AGENT] : [INSTALL_AGENT];
	let result;
	try {
		result = await install(trimmedSource, {
			skills: [skillName],
			scope: "project",
			cwd: directory,
			agents,
			config: { telemetry: false }
		});
	} catch (error) {
		return {
			ok: false,
			code: "install-failed",
			message: errorText$3(error)
		};
	}
	const id = skillDirName(skillName);
	const targetPath = await installedPathOf(result, path.join(directory, AGENTS_DIR, "skills"), id);
	if (!targetPath.ok) return {
		ok: false,
		code: result.failed.length > 0 ? "install-failed" : "install-incomplete",
		message: targetPath.message
	};
	return {
		ok: true,
		id,
		name: skillName,
		target,
		path: targetPath.path,
		output: ""
	};
}
/**
* 单条安装与目录安装共用的前半段：校验来源是收藏、解析目标目录、读仓库列表。
*
* 顺序有意保持：目标先解析，目标不存在时不必为了列仓库去打一次网络请求；
* 来源与目标都以 Host 这次读到的数据为准，浏览器传来的只是标识符 / 路径。
*
* @returns 成功时给出规范化来源、仓库里的 skill 列表与（项目级安装时的）目标目录
*/
async function resolveSavedInstall({ homes, catalog, source, target, worker, workspace, resolveTarget }) {
	if (target !== "global" && resolveTarget === null) return {
		ok: false,
		result: {
			ok: false,
			code: "no-target-resolver",
			message: "缺少解析安装目标的能力"
		}
	};
	const normalized = normalizeRepoSource(source);
	if (normalized === null) return {
		ok: false,
		result: {
			ok: false,
			code: "invalid-source",
			message: "来源格式不对，无法安装"
		}
	};
	let store;
	try {
		store = await listSavedRepos({ homes });
	} catch (error) {
		return {
			ok: false,
			result: {
				ok: false,
				code: "store-unreadable",
				message: errorText$3(error)
			}
		};
	}
	if (store.corrupt) return {
		ok: false,
		result: {
			ok: false,
			code: "store-unreadable",
			message: `收藏文件无法解析（${store.file}），请先修复或删除它再安装`
		}
	};
	const repo = store.repos.find((one) => repoKey(one.source) === repoKey(normalized));
	if (repo === void 0) return {
		ok: false,
		result: {
			ok: false,
			code: "not-saved",
			message: `只允许安装收藏过的来源，请先收藏再安装：${normalized}`
		}
	};
	if (catalog === void 0 || typeof catalog?.listSkills !== "function") return {
		ok: false,
		result: {
			ok: false,
			code: "no-catalog",
			message: "缺少读取仓库的能力"
		}
	};
	let targetDir = null;
	if (target !== "global" && resolveTarget !== null) {
		const resolved = await resolveTarget({
			target,
			worker,
			workspace
		});
		if (!resolved.ok) return {
			ok: false,
			result: {
				ok: false,
				code: resolved.code,
				message: resolved.message
			}
		};
		targetDir = resolved.path;
	}
	let listed;
	try {
		listed = await catalog.listSkills({ source: repo.source });
	} catch (error) {
		return {
			ok: false,
			result: {
				ok: false,
				code: "fetch-failed",
				message: errorText$3(error)
			}
		};
	}
	if (!listed?.ok) return {
		ok: false,
		result: {
			ok: false,
			code: listed?.code ?? "fetch-failed",
			message: listed?.message ?? "无法读取这个仓库的 skill 列表"
		}
	};
	const skills = Array.isArray(listed.skills) ? listed.skills : [];
	return {
		ok: true,
		context: {
			repoSource: repo.source,
			skills,
			targetDir
		}
	};
}
/**
* 页面「安装」按钮的完整流程：校验来源是收藏、skill 在仓库列表里，再按
* `target` 交给全局安装或某个执行者 / 工作区的项目级安装。
*
* 浏览器只传来源与 skill 的仓库路径：名字、是否真的存在都以 Host 这次读到的
* 仓库列表为准；执行者只传标识符、工作区只传路径，真正的工作目录由
* `resolveTarget()` 从 Host 的登记表解析，避免页面缓存过期或请求被伪造时装错
* 位置。
*/
async function installSavedSkill({ homes = resolveHomes(), canonicalAgentsHome = npxGlobalAgentsHome(), catalog, source, skillPath, name, target = "global", worker, workspace, resolveTarget, install = installSkills }) {
	if (target !== "global" && target !== "worker" && target !== "workspace") return {
		ok: false,
		code: "invalid-target",
		message: `未知的安装目标：${String(target)}`
	};
	const prepared = await resolveSavedInstall({
		homes,
		catalog,
		source,
		target,
		worker,
		workspace,
		resolveTarget: typeof resolveTarget === "function" ? resolveTarget : null
	});
	if (!prepared.ok) return prepared.result;
	const { repoSource, skills, targetDir } = prepared.context;
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
			source: repoSource,
			name: match.name,
			install
		});
		if (!installed.ok) return installed;
		return {
			...installed,
			repo: repoSource
		};
	}
	const installed = await installProjectSkill({
		targetDir: targetDir ?? "",
		target,
		source: repoSource,
		name: match.name,
		install
	});
	if (!installed.ok) return installed;
	return {
		...installed,
		repo: repoSource
	};
}
/**
* 目录行「安装全部」：把目录里每个 skill 依次装到全局或选中的执行者 / 工作区。
*
* 任何一个失败都不会中断后面的，结果按 installed / skipped / failed 分组返回；
* 有失败时整体 `ok: false`，`message` 列出每个失败的名字与原因。
*/
async function installSavedSkillGroup({ homes = resolveHomes(), canonicalAgentsHome = npxGlobalAgentsHome(), catalog, source, skillPaths, target = "global", worker, workspace, resolveTarget, install = installSkills }) {
	if (target !== "global" && target !== "worker" && target !== "workspace") return {
		ok: false,
		code: "invalid-target",
		message: `未知的安装目标：${String(target)}`,
		batch: true,
		target: "global",
		installed: [],
		skipped: [],
		failed: []
	};
	const settle = (code, message) => ({
		ok: false,
		code,
		message,
		batch: true,
		target,
		installed: [],
		skipped: [],
		failed: []
	});
	const paths = requestedSkillPaths(skillPaths);
	if (paths === null || paths.length === 0) return settle("invalid-skill-paths", `目录安装需要一组 skill 路径（最多 200 个），且不能为空`);
	if (typeof install !== "function") return settle("no-installer", "缺少安装 skill 的能力");
	if (target === "global") {
		const mismatch = globalHomeMismatch$1(homes, canonicalAgentsHome);
		if (mismatch !== null) return settle("unsupported-home", mismatch);
	}
	const prepared = await resolveSavedInstall({
		homes,
		catalog,
		source,
		target,
		worker,
		workspace,
		resolveTarget: typeof resolveTarget === "function" ? resolveTarget : null
	});
	if (!prepared.ok) return settle(prepared.result.code ?? "fetch-failed", prepared.result.message ?? "无法安装");
	const { repoSource, skills, targetDir } = prepared.context;
	const byPath = new Map(skills.map((one) => [one.path, one]));
	const selected = [];
	for (const wanted of paths) {
		const found = byPath.get(wanted);
		if (found === void 0) return settle("skill-not-found", "仓库列表里没有目录下的这个 skill，仓库可能已经更新，请刷新后再试");
		selected.push(found);
	}
	const installed = [];
	const skipped = [];
	const failed = [];
	for (const skill of selected) {
		const one = target === "global" ? await installGlobalSkill({
			homes,
			canonicalAgentsHome,
			source: repoSource,
			name: skill.name,
			install
		}) : await installProjectSkill({
			targetDir: targetDir ?? "",
			target,
			source: repoSource,
			name: skill.name,
			install
		});
		if (one.ok) {
			const entry = { name: skill.name };
			if (one.id !== void 0) entry.id = one.id;
			if (one.path !== void 0) entry.path = one.path;
			installed.push(entry);
			continue;
		}
		if (one.code === "already-installed") {
			skipped.push({ name: skill.name });
			continue;
		}
		failed.push({
			name: skill.name,
			code: one.code ?? "install-failed",
			message: one.message ?? "安装失败"
		});
	}
	if (failed.length > 0) return {
		ok: false,
		code: failed[0]?.code ?? "install-failed",
		message: failed.map((one) => `${one.name}（${one.message}）`).join("；"),
		batch: true,
		target,
		repo: repoSource,
		installed,
		skipped,
		failed
	};
	return {
		ok: true,
		batch: true,
		target,
		repo: repoSource,
		installed,
		skipped,
		failed
	};
}
/**
* 目录安装请求里的 skill 路径：必须是字符串数组、去重、数量不超过上限。
*
* @returns 规范化后的路径；形状不对或超过上限时返回 null
*/
function requestedSkillPaths(value) {
	if (!Array.isArray(value)) return null;
	const paths = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of value) {
		if (typeof item !== "string" || item === "") return null;
		if (seen.has(item)) continue;
		seen.add(item);
		paths.push(item);
	}
	if (paths.length > 200) return null;
	return paths;
}
// .build/skills/routes.js
/**
* 给浏览器一半的侧边栏「Skills」页面用的包内 HTTP 路由。
*
* 路由：
*
* - `GET /skills/list` 列出全局 skills；
* - `POST /skills/uninstall` 卸载一个；
* - `GET /skills/check` 检查全局 skill 的更新；
* - `POST /skills/update` 应用可用的更新（`skills` 给出名字时只处理这些）；
* - `GET /skills/targets` 列出可安装的执行者（`ctx.workflowWorkers`）与工作区
*   （`ctx.workspaceRegistry`）；
* - `POST /skills/install` 把某个收藏仓库里的一个 skill（或目录里的一组
*   skill）安装到全局、某个执行者目录或某个工作区目录；
* - `GET /skills/repos` 列出用户收藏的仓库，
* - `POST /skills/repos` 收藏一个，
* - `POST /skills/repos/remove` 移除一个，
* - `GET /skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
*   `probe=1` 时只探测仓库类型：标准 npx 仓库 / 不可用）；
* - `GET /skills/icon?owner=…` 返回 GitHub owner 的仓库头像：先读本地缓存，
*   过期时先回旧图、再在后台静默更新。
*
* 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
* （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
*
* @module @buka/dsh-plugin-skills/routes
*/
/** 页面读取列表用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = "/skills/list";
/** 页面卸载 skill 用的路由。 */
const UNINSTALL_ROUTE = "/skills/uninstall";
/** 页面读取可安装目标（执行者 / 工作区）用的路由。 */
const TARGETS_ROUTE = "/skills/targets";
/** 页面把收藏仓库里的一个 skill（或目录里的一组 skill）安装到全局 / 执行者 / 工作区用的路由。 */
const INSTALL_ROUTE = "/skills/install";
/** 收藏仓库的列表 / 添加路由。 */
const REPOS_ROUTE = "/skills/repos";
/** 收藏仓库的移除路由。 */
const REPO_REMOVE_ROUTE = "/skills/repos/remove";
/** 收藏仓库的 skills 树路由。 */
const REPO_SKILLS_ROUTE = "/skills/repo-skills";
/** 已安装 skill 的检查路由。 */
const CHECK_ROUTE = "/skills/check";
/** 已安装 skill 的更新路由。 */
const UPDATE_ROUTE = "/skills/update";
/**
* 注册全部路由。
*
* @param ctx 提供 `webServer` 与 `connection` 的插件上下文
* @param deps 入口装配好的共享依赖
*/
function registerRoutes(ctx, deps) {
	const { homes, catalog, readSnapshot, serializeSkills } = deps;
	const icons = createIconCache({ homes });
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
		}), `skills: GET ${LIST_ROUTE}`);
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
					const result = await serializeSkills(() => uninstallGlobalSkill({
						homes,
						scope: fields?.scope,
						id: fields?.id
					}));
					if (result.ok) webCtx.logger?.info?.("skills: 已卸载 %s（%s）", String(fields?.id), result.method);
					sendJson(res, result.ok ? 200 : statusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `skills: POST ${UNINSTALL_ROUTE}`);
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
		}), `skills: GET ${TARGETS_ROUTE}`);
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
					const result = await serializeSkills(() => Array.isArray(fields?.paths) ? installSavedSkillGroup({
						homes,
						catalog,
						source: fields?.source,
						skillPaths: fields?.paths,
						target: fields?.target,
						worker: fields?.worker,
						workspace: fields?.workspace,
						resolveTarget: (request) => resolveInstallTarget(webCtx, request)
					}) : installSavedSkill({
						homes,
						catalog,
						source: fields?.source,
						skillPath: fields?.path,
						target: fields?.target,
						worker: fields?.worker,
						workspace: fields?.workspace,
						resolveTarget: (request) => resolveInstallTarget(webCtx, request)
					}));
					if (result.ok) {
						const count = "installed" in result && Array.isArray(result.installed) ? result.installed.length : 1;
						webCtx.logger?.info?.("skills: 已安装 %d 个 skill（%s，%s）", count, String("repo" in result ? result.repo : ""), result.target ?? "global");
					}
					sendJson(res, result.ok ? 200 : installStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `skills: POST ${INSTALL_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: CHECK_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				try {
					const result = await catalog.checkSkills({});
					sendJson(res, result.ok ? 200 : updateStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `skills: GET ${CHECK_ROUTE}`);
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
				const fields = body;
				const skills = Array.isArray(fields?.skills) ? fields.skills.filter((name) => typeof name === "string") : void 0;
				try {
					const result = await catalog.updateSkills(skills === void 0 ? {} : { skills });
					if (result.ok) webCtx.logger?.info?.("skills: 更新完成（%d 个成功，%d 个失败）", result.updated.length, result.failed.length);
					sendJson(res, result.ok ? 200 : updateStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `skills: POST ${UPDATE_ROUTE}`);
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
					if (result.ok) webCtx.logger?.info?.("skills: 已收藏仓库 %s", String(fields?.source));
					sendJson(res, result.ok ? 200 : repoStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `skills: ${REPOS_ROUTE}`);
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
					if (result.ok) webCtx.logger?.info?.("skills: 已移除收藏 %s", String(fields?.id));
					sendJson(res, result.ok ? 200 : repoStatusFor(result.code), result);
				} catch (error) {
					sendJson(res, 500, {
						ok: false,
						message: describeError$1(error)
					});
				}
			}
		}), `skills: POST ${REPO_REMOVE_ROUTE}`);
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
		}), `skills: GET ${REPO_SKILLS_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: ICON_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				const query = parseQuery(req);
				try {
					const image = await icons.load(query.get("owner") ?? "");
					if (image === null) {
						res.statusCode = 404;
						res.setHeader("cache-control", "no-store");
						res.end();
						return;
					}
					res.statusCode = 200;
					res.setHeader("content-type", image.contentType);
					res.setHeader("content-length", String(image.data.byteLength));
					res.setHeader("cache-control", "private, max-age=300");
					res.end(image.data);
				} catch {
					res.statusCode = 500;
					res.setHeader("cache-control", "no-store");
					res.end();
				}
			}
		}), `skills: GET ${ICON_ROUTE}`);
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
* `not-saved` / `invalid-source` / `invalid-skill-name` / `invalid-skill-paths` /
* `invalid-target` /
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
	if (code === "invalid-source" || code === "invalid-skill-name" || code === "invalid-skill-paths" || code === "not-saved" || code === "unsupported-source" || code === "invalid-target" || code === "invalid-worker" || code === "invalid-workspace") return 400;
	if (code === "skill-not-found" || code === "repo-not-found" || code === "not-found" || code === "unknown-worker" || code === "unknown-workspace") return 404;
	if (code === "already-installed" || code === "store-unreadable" || code === "missing-target" || code === "workers-unavailable" || code === "workspaces-unavailable" || code === "no-target-resolver") return 409;
	if (code === "repo-unavailable") return 422;
	if (code === "rate-limited") return 429;
	if (code === "unsupported-home" || code === "git-unavailable") return 500;
	return 502;
}
/**
* 检查 / 更新的失败码 → HTTP 状态码。
*
* `unsupported-home` 是本机环境配置问题（500）；`check-failed` / `lock-unreadable`
* 是当前状态无法完成（409 / 502）。其它校验类错误按 400。
*/
function updateStatusFor(code) {
	if (code === "invalid-dir" || code === "invalid-source") return 400;
	if (code === "lock-unreadable") return 409;
	if (code === "unsupported-home") return 500;
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
* `repo-unavailable` 用 422：请求格式没问题，只是这个仓库根 `skills/` 下没有
* 可安装的 skill，改来源才有意义。
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
* - `skills` 的安装 / 卸载 / 更新会整份重写共享的 lockfile，并发执行可能互相覆盖条目；
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
/** 缓存有效期：30 分钟。仓库树变化不频繁，过期后按需重拉。 */
const REPO_SKILLS_CACHE_TTL_MS = 18e5;
/** 合法的仓库分类；与缓存条目的 `kind` 字段同值。 */
const REPO_KINDS = /* @__PURE__ */ new Set(["npx-skills", "unavailable"]);
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
	if (record.version !== 7) return {};
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
* 除旧字段外还要求 `kind` 属于两种仓库类型、`complete` 是布尔值：缺字段的
* 旧形状或手改坏的条目都按未命中处理，整条丢弃。
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
	return {
		source: record.source,
		kind: record.kind,
		ref: record.ref,
		sha: record.sha,
		fetchedAt: record.fetchedAt,
		truncated: record.truncated,
		root: record.root,
		skills: record.skills,
		complete: record.complete
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
			if (record.type === "dir" || record.type === "skill") {
				if (!Array.isArray(record.children)) return false;
				if (record.type === "skill" && typeof record.description !== "string") return false;
				stack.push({
					nodes: record.children,
					depth: depth + 1
				});
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
* 悄悄丢掉先写的条目。缓存丢了只多拉一次仓库，但没必要。
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
		version: 7,
		entries
	}, { dirMode: 448 });
}
/** 与仓库树扫描保持一致的跳过目录。 */
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
* `my-skill.md` 这类普通 Markdown 也当成 skill。
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
* @param tree 仓库树节点数组
*/
function allSkillMdPaths(tree) {
	return treeBlobPaths(tree).filter(isSkillMdPath);
}
/**
* 一个仓库内路径是否落在 `skills/` 下、且中间没有跳过目录。
*
* @param skillMd 仓库内的完整 SKILL.md 路径
*/
function isUnderSkillsDir(skillMd) {
	const segments = skillMd.split("/");
	if (segments[0] !== "skills" || segments.length < 2) return false;
	return segments.slice(1, -1).every((segment) => segment !== "" && !SKIP_DIRS$1.has(segment));
}
/**
* 发现仓库里可安装的 skill：`skills/` 下任意层级的 `SKILL.md`。
*
* 根 `SKILL.md`、agent 目录与仓库里其它位置的 `SKILL.md` 一律忽略。返回的
* 顺序与树一致，展示树再按名字排序。
*
* @param tree 仓库树节点数组
*/
function findSkillMdPaths(tree) {
	return allSkillMdPaths(tree).filter(isUnderSkillsDir);
}
/**
* 判定仓库是否可用：根 `skills/` 下至少有一个 `SKILL.md`。
*
* 不读任何文件，只看树。没有可安装 skill 的仓库（包括只有根 `SKILL.md`、
* 只有 `.claude/skills/**`、或 Claude Code marketplace 布局的仓库）统一
* 标记为 `unavailable`。
*
* @param tree 仓库树节点数组
*/
function classifyRepo(tree) {
	return findSkillMdPaths(tree).length > 0 ? { kind: "npx-skills" } : { kind: "unavailable" };
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
* 「仓库根 skills/ 下没有可安装的 skill」的统一失败返回。
*/
function repoUnavailable() {
	return failure$2("repo-unavailable", "Repository has no installable skills: expected SKILL.md files under the repository root \"skills/\" directory.");
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
			if (update === true) {
				const warning = await updateClone(dir, runGit);
				return {
					ok: true,
					dir,
					sha: await headSha(dir, runGit),
					...warning === null ? {} : {
						stale: true,
						warning
					}
				};
			}
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
* 尝试更新已有克隆；失败时保留旧克隆（离线可用），返回失败原因。
*
* @returns 成功时 null，失败时可展示的警告文案
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
		return null;
	} catch (error) {
		return `Failed to refresh the local clone; showing the cached copy: ${gitFailure(error).message}`;
	}
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
	return failure$1("git-failed", tail === "" ? `git failed: ${errorText$2(error)}` : `git failed: ${tail}`);
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
function errorText$2(error) {
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
		return failure("fetch-failed", `Could not read local path ${root}: ${errorText$1(error)}`);
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
		return failure("fetch-failed", `Could not scan local path ${root}: ${errorText$1(error)}`);
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
function errorText$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// .build/skills/repo/reader.js
/**
* 打开一棵仓库树：把三种来源都收敛成 `{ tree, readFile }`。
*
* GitHub 仓库与其它 git 远端都先浅克隆到 DSH home 下的缓存目录，再把克隆
* 目录当本地目录扫描；本地路径直接扫描目录。GitHub 不再调用 API 列树，所有
* 远端来源都走同一条 git 路径。后面的发现规则与建树只认这个读取抽象，不再
* 关心来源本身。
*
* 刷新克隆（`update: true`）失败时保留旧克隆继续使用，并把失败原因作为
* `warning` 带回结果，由页面提示；首次克隆失败（含找不到 git）才返回错误。
*
* @module @buka/dsh-plugin-skills/repo/reader
*/
/**
* GitHub 仓库的 HTTPS 克隆地址。
*
* @param owner 仓库 owner
* @param repo 仓库名
*/
function githubCloneUrl(owner, repo) {
	return `https://github.com/${owner}/${repo}.git`;
}
/**
* 打开一棵仓库树。
*
* 走到这里说明磁盘缓存没有命中（过期，或只有一条轻量探测结论），所以三种来源
* 都重新读一次最新内容：本地路径重扫目录、远端来源先 `git fetch` 更新克隆
* （失败时保留旧克隆并带 `warning`）。
*
* @param options.origin 规范化来源坐标
* @param options.homes DSH home（克隆缓存目录在这里）
* @param options.runGit 可注入的 git runner
*/
async function openRepo({ origin, homes, runGit }) {
	if (origin.kind === "local") return openLocalRepo(origin.root);
	const cloned = await ensureGitClone({
		homes,
		url: origin.kind === "github" ? githubCloneUrl(origin.owner, origin.repo) : origin.url,
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
		readFile: opened.readFile,
		...cloned.warning === void 0 ? {} : { warning: cloned.warning }
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
// .build/skills/repo/tree.js
/**
* 把仓库内容装配成可展示的树：读 SKILL.md 元数据、按目录建树、排序。
*
* 只处理一种布局：仓库根 `skills/` 下的 skill（允许任意层级子目录）。一个
* 包含 `SKILL.md` 的目录就是技能叶子：叶子用该目录的仓库路径（如
* `skills/engineering/code-review`），不再为 `SKILL.md` 文件单独建节点；
* 不含 `SKILL.md` 的目录只作分组，保留物理目录结构。叶子下如果还有嵌套
* skill（目录自己带 `SKILL.md` 又套了子 skill），它们挂在叶子的 `children`
* 上。页面上的「全部安装」因此可以直接收集叶子路径。`metadata.internal: true`
* 的内部 skill 不列。
*
* 元数据走统一的 `reader.readFile()`：本地路径与本地克隆都不碰网络。
*
* @module @buka/dsh-plugin-skills/repo/tree
*/
/** 同时读取 SKILL.md 的并发上限，避免一次打开几十个文件 / 连接。 */
const SKILL_MD_CONCURRENCY = 6;
/**
* 按仓库树把 skill 文件读成可展示的树。
*
* @param tree 仓库树
* @param reader 仓库读取抽象（本地目录或浅克隆）
* @param repoName 仓库名；`skills/SKILL.md` 缺名称时的兜底
*/
async function loadRepoContent({ tree, reader, repoName }) {
	return buildTree(await mapLimit$1(findSkillMdPaths(tree), SKILL_MD_CONCURRENCY, (skillMd) => readSkillMetadata(skillMd, reader)), repoName);
}
/**
* 按仓库内完整路径读取并解析一个 SKILL.md；失败时 name/description 都留空。
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
* 把发现结果装配成按物理目录分层的树。
*
* 一个目录只要有自己的 `SKILL.md`，它就是技能叶子：节点路径取目录路径，
* 不再生成 `SKILL.md` 子节点。目录里的其它子目录（含子 skill）作为叶子的
* `children`；没有 `SKILL.md` 的目录只当分组。
*
* @param entries 发现阶段读到的元数据
* @param repoName 仓库名
*/
function buildTree(entries, repoName) {
	const root = {
		name: "",
		path: "skills",
		dirs: /* @__PURE__ */ new Map(),
		skill: void 0
	};
	let skills = 0;
	for (const entry of entries) {
		if (entry.internal === true) continue;
		skills += 1;
		const segments = entry.fullPath.split("/").slice(1, -1);
		let current = root;
		let pathSoFar = "skills";
		for (const segment of segments) {
			pathSoFar = `${pathSoFar}/${segment}`;
			const existing = current.dirs.get(segment);
			if (existing === void 0) {
				const created = {
					name: segment,
					path: pathSoFar,
					dirs: /* @__PURE__ */ new Map(),
					skill: void 0
				};
				current.dirs.set(segment, created);
				current = created;
			} else current = existing;
		}
		current.skill = entry;
	}
	return {
		root: finishRoot(root, repoName),
		skills
	};
}
/**
* 把中间根节点转成展示列表。根目录 `skills` 自己不单独显示：它有自己的
* SKILL.md 时，根部那个 skill 用 `children` 包住其余节点。
*/
function finishRoot(builder, repoName) {
	const children = finishChildren(builder, repoName);
	if (builder.skill === void 0) return children;
	return [skillNodeOf(builder, repoName, children)];
}
/**
* 递归装配一个目录下的子节点：有 `SKILL.md` 的子目录是 skill 叶子，否则是
* 分组目录。
*/
function finishChildren(builder, repoName) {
	const nodes = [];
	for (const dir of builder.dirs.values()) {
		const children = finishChildren(dir, repoName);
		nodes.push(dir.skill === void 0 ? {
			type: "dir",
			name: dir.name,
			path: dir.path,
			children
		} : skillNodeOf(dir, repoName, children));
	}
	sortTree(nodes);
	return nodes;
}
/** 把一个带 `SKILL.md` 的目录装配成 skill 节点；名称缺失时回退目录名。 */
function skillNodeOf(builder, repoName, children) {
	const entry = builder.skill;
	const segments = builder.path.split("/").slice(1);
	return {
		type: "skill",
		name: entry.name === "" ? fallbackSkillName(segments, repoName) : entry.name,
		path: builder.path,
		description: entry.description,
		children
	};
}
/**
* skill 名称缺失时的兜底：所在目录名；`skills/SKILL.md` 用仓库名。
*/
function fallbackSkillName(segments, repoName) {
	return segments.at(-1) ?? repoName;
}
/**
* 递归排序：目录在前、skill 在后，同类按 `name` 的大小写不敏感升序；
* 叶子下嵌套的子节点同样递归排序。
*/
function sortTree(nodes) {
	nodes.sort((a, b) => {
		if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
		return compareName(a.name, b.name);
	});
	for (const node of nodes) sortTree(node.children);
}
/**
* 大小写不敏感的 `localeCompare`；完全相同时再用原始大小写稳定排序。
*/
function compareName(a, b) {
	const folded = a.localeCompare(b, void 0, { sensitivity: "base" });
	return folded !== 0 ? folded : a.localeCompare(b);
}
// .build/skills/repo-skills.js
/**
* 「收藏的来源里有哪些 skills」：拉取、缓存与建树的入口。
*
* 收藏只支持仓库根 `skills/` 下（允许任意层级子目录）的 `SKILL.md`：
*
* - GitHub 仓库与任意 git 远端：先 `git clone --depth 1` 到 DSH home 下的缓存
*   目录（`src/git-source.ts`），再把克隆目录当本地目录扫描；
* - 本地绝对路径：直接扫描目录（`src/local-source.ts`）。
*
* 三种来源最终都收敛成 `{ tree, readFile }` 的读取抽象（`openRepo()`），后面的
* 发现规则与建树只认这个抽象，不再关心来源本身。GitHub 不再调用 API 列树，
* 所有远端来源走同一条本地浅克隆路径。
*
* 刷新克隆失败时保留旧克隆继续展示，并把错误原因作为 `warning` 带上；首次
* 克隆失败（含找不到 git）才返回错误。
*
* 缓存放在 DSH home 下（`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`），
* 按规范化来源（`owner/repo`、本地绝对路径或 git 地址）的小写键存整棵树，TTL
* 30 分钟。缓存是**可重建的易失数据**：文件损坏、版本不符或单条结构不合法时
* 都直接当作未命中并重拉重写，不像收藏文件那样拒绝覆盖。写入仍是原子写
* （同目录临时文件 + rename），避免留下半个文件。
*
* 本模块只做两个入口的编排；实现按职责拆在 `src/repo/` 下：来源坐标
* （`source.ts`）、读取抽象（`reader.ts`）、发现规则与仓库分类
* （`discovery.ts`）、建树（`tree.ts`）、缓存（`cache.ts`）。依赖只有 Node
* 内置模块与这些本地模块，可单独测试；时钟、git 子进程与缓存目录都从参数注入。
*
* @module @buka/dsh-plugin-skills/repo-skills
*/
/**
* 拉取并缓存一个来源的 skill 树。
*
* `source` 先经 `classifyRepoSource()` 解析成三种可列出的来源之一：GitHub 仓库、
* 任意 git 远端、本地绝对路径；`@scope/pkg`、`notion` 与已知不是仓库的网页链接
* 返回 `unsupported-source`。缓存命中时完全不访问来源。
*
* 仓库分类只看树：根 `skills/` 下有 `SKILL.md` 就是标准 npx 仓库，否则不可用
* （`repo-unavailable`）。网络失败、找不到 git、克隆失败等情况返回
* `{ ok: false, code, message }`，不向调用方抛异常；缓存写入失败则忽略，因为
* 它随时可以重建。刷新克隆失败时结果仍成功，并带 `warning`。
*
* 命中探测写下的轻量缓存（`complete: false`）时仍会重新拉一次 tree，把完整树
* 补进缓存；命中 `kind: 'unavailable'` 且未过期时直接返回 `repo-unavailable`。
*/
async function fetchRepoSkills({ homes = resolveHomes(), source, refresh = false, now = Date.now(), ttlMs = REPO_SKILLS_CACHE_TTL_MS, runGit } = {}) {
	const request = await resolveTarget({
		homes,
		source,
		now
	});
	if (request.ok !== true) return request.failure;
	const { origin, canonical, timestamp, file, id, cached } = request;
	if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
		if (cached.kind === "unavailable") return repoUnavailable();
		if (cached.complete === true) return cachedResult(canonical, cached);
	}
	const reader = await openRepo({
		origin,
		homes,
		runGit
	});
	if (!reader.ok) return reader;
	const classification = classifyRepo(reader.tree);
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
		root: content.root
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
		...reader.warning === void 0 ? {} : { warning: reader.warning }
	};
}
/**
* 只探测一个来源属于哪种技能仓库，不拉任何 `SKILL.md` 原文。
*
* 收藏卡片打开后会自动调用它来显示徽标，所以这里只拿树（远端是浅克隆的
* 目录扫描、本地路径直接扫描）。失败码与 `fetchRepoSkills` 完全一致；判定为
* 不可用时返回 `repo-unavailable`（命中已缓存的不可用结论时同样不访问来源）。
*
* 写缓存总是写轻量条目（`complete: false`，`root: []`），并且**不覆盖**已存在
* 的完整树缓存：探测刷新不该把展开时拿到的完整数据降级掉。
*/
async function probeRepoKind({ homes = resolveHomes(), source, refresh = false, now = Date.now(), ttlMs = REPO_SKILLS_CACHE_TTL_MS, runGit } = {}) {
	const request = await resolveTarget({
		homes,
		source,
		now
	});
	if (request.ok !== true) return request.failure;
	const { origin, canonical, timestamp, file, id, cached } = request;
	if (refresh !== true && isFresh(cached, timestamp, ttlMs)) {
		if (cached.kind === "unavailable") return repoUnavailable();
		return probeResult(canonical, cached, true);
	}
	const reader = await openRepo({
		origin,
		homes,
		runGit
	});
	if (!reader.ok) return reader;
	const classification = classifyRepo(reader.tree);
	if ("failure" in classification) return classification.failure;
	const kind = classification.kind;
	const skills = kind === "unavailable" ? 0 : findSkillMdPaths(reader.tree).length;
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
		truncated: reader.truncated,
		...reader.warning === void 0 ? {} : { warning: reader.warning }
	};
}
/**
* 校验来源并读缓存：两个入口共用的前半段。
*
* 来源种类由 `classifyRepoSource()` 判定：`web` / `package` 直接返回
* `unsupported-source`（它们没有可列出的仓库树，也没有缓存条目）。
*/
async function resolveTarget({ homes, source, now }) {
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
	const file = repoSkillsCacheFile(homes);
	const entries = await readCache(file);
	const id = repoKey(canonical);
	return {
		ok: true,
		origin,
		canonical,
		timestamp,
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
		skills: entry.skills
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
		root: []
	};
}
// .build/skills/skill-hash.js
/**
* 已安装 skill 的内容哈希：与 `skills` CLI 的 `computedHash` 规则一致。
*
* `skills-lock.json` 记录了安装完成时 skill 目录的 `computedHash`。比较它和
* 磁盘上的当前内容，就能判断本地是否被改过（`modified`），从而在更新时跳过
* 用户的手工修改。
*
* 规则（见 `skills` 包 README 的 “Lock File Content Hash”）：
*
* 1. 收集目录里的文件，排除 `metadata.json` 与 `.git` / `__pycache__` /
*    `__py_packages__` 目录；符号链接按它指向的内容计算，坏链、循环链与指向
*    目录外的链接排除；
* 2. 相对路径用 `/` 分隔；
* 3. 文本文件（不含 NUL 字节）把 CRLF 换成 LF，二进制文件保持原样；
* 4. 按路径的 UTF-8 字节排序（不是 locale 排序）；
* 5. 依次喂入 `path`、NUL、内容字节数（十进制 ASCII）、NUL、内容，算 SHA-256；
* 6. 输出小写十六进制。
*
* @module @buka/dsh-plugin-skills/skill-hash
*/
/** 不参与哈希的目录名。 */
const SKIPPED_DIRS = /* @__PURE__ */ new Set([
	".git",
	"__pycache__",
	"__py_packages__"
]);
/** 不参与哈希的文件名。 */
const SKIPPED_FILES = /* @__PURE__ */ new Set(["metadata.json"]);
/**
* 计算一个 skill 目录的内容哈希。
*
* @param root skill 目录绝对路径
*/
async function computeSkillFolderHash(root) {
	const files = await collectFiles(await promises.realpath(root));
	files.sort((left, right) => Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)));
	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file.relativePath);
		hash.update(Buffer.from([0]));
		hash.update(String(file.content.length));
		hash.update(Buffer.from([0]));
		hash.update(file.content);
	}
	return hash.digest("hex");
}
/**
* 递归收集目录里的文件；符号链接按目标处理，坏链 / 越界链接跳过。
*
* @param root 已展开符号链接的 skill 根目录
*/
async function collectFiles(root) {
	const files = [];
	const visited = /* @__PURE__ */ new Set();
	async function walk(directory, prefix) {
		let entries;
		try {
			entries = await promises.readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(directory, entry.name);
			const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isSymbolicLink()) {
				let real;
				try {
					real = await promises.realpath(full);
				} catch {
					continue;
				}
				if (!isInside(root, real)) continue;
				let stat;
				try {
					stat = await promises.stat(real);
				} catch {
					continue;
				}
				if (stat.isDirectory()) {
					if (visited.has(real)) continue;
					visited.add(real);
					await walk(real, relativePath);
				} else if (stat.isFile()) {
					const content = await readHashable(real);
					if (content !== null) files.push({
						relativePath,
						content
					});
				}
				continue;
			}
			if (entry.isDirectory()) {
				if (SKIPPED_DIRS.has(entry.name)) continue;
				await walk(full, relativePath);
				continue;
			}
			if (!entry.isFile() || SKIPPED_FILES.has(entry.name)) continue;
			const content = await readHashable(full);
			if (content !== null) files.push({
				relativePath,
				content
			});
		}
	}
	await walk(root, "");
	return files;
}
/**
* 读一个文件的哈希内容：文本文件统一换行，二进制保持原样。
*
* @param file 文件绝对路径
*/
async function readHashable(file) {
	try {
		const raw = await promises.readFile(file);
		return raw.includes(0) ? raw : normalizeNewlines(raw);
	} catch {
		return null;
	}
}
/**
* 把 CRLF 换成 LF；直接按字节处理，避免重新解码破坏内容。
*
* @param raw 文件原始字节
*/
function normalizeNewlines(raw) {
	const out = Buffer.allocUnsafe(raw.length);
	let length = 0;
	for (let index = 0; index < raw.length; index += 1) {
		const byte = raw[index];
		if (byte === 13 && raw[index + 1] === 10) continue;
		out[length] = byte;
		length += 1;
	}
	return out.subarray(0, length);
}
/**
* `target` 是否在 `root` 之内（含 root 自身）。
*/
function isInside(root, target) {
	const relative = path.relative(root, target);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
// .build/skills/skill-update.js
/**
* 已安装 skill 的检查与更新。
*
* 状态模型（不引入版本号）：
*
* - `update`：上游有更新；
* - `modified`：本地文件与 lock 里的 `computedHash` 不一致（只对目标目录的
*   项目级 skill 有意义，全局 lock 不记内容哈希）；
* - `up-to-date`：已是最新；
* - `unsupported-source`：来源不再可解析（典型是旧 Claude Code marketplace
*   安装：skill 不在仓库根 `skills/` 下），无法再自动检查；
* - `failed`：检查本身失败，带原因。
*
* 检查与更新复用 `skills` 包自带的 CLI（`skills check` / `skills update`），
* 因为更新逻辑、来源解析与 lock 迁移都由它维护；调用时关闭遥测。全局作用域
* 只在 `~/.agents` 是 DSH 扫描的全局根时可用——CLI 固定写自己的全局目录，
* 路径不一致时宁可拒绝，也不改到用户看不到的位置。
*
* 更新只应用 `update`；`modified` 默认跳过并说明原因，绝不覆盖本地修改。
* 手工安装（不在 npx lock 里）的条目不在候选内，也不参与检查 / 更新。
*
* @module @buka/dsh-plugin-skills/skill-update
*/
/** CLI 单次调用的超时：与安装流程的 180 s 保持一致。 */
const SKILL_UPDATE_TIMEOUT_MS = 18e4;
/** CLI 输出的上限；正常输出很小，这里只防异常刷屏。 */
const MAX_OUTPUT_BYTES = 10485760;
/** 项目级 lock 文件名与版本。 */
const PROJECT_LOCK_FILE = "skills-lock.json";
/**
* 解析 `skills check` 的文本输出。
*
* CLI 没有 `--json`，但这两类行是稳定的：`↑ <name> has an update` 与
* `✎ <name> has local changes`。解析前先去掉 ANSI 颜色码，避免名字里混入转义。
*
* @param output CLI 的 stdout + stderr
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
* 去掉 ANSI 颜色 / 控制序列。
*
* @param text 原始文本
*/
function stripAnsi(text) {
	return text.replace(/\u001b\[[0-9;]*m/gu, "");
}
/**
* 解析 `skills` 包自带 CLI 的绝对路径。
*
* 通过包的 `exports` 子路径解析，插件被安装到 profile 后仍能取到同一份依赖。
*/
function resolveSkillsCliPath() {
	return createRequire(import.meta.url).resolve("skills/bin/cli.mjs");
}
/**
* 创建默认的 CLI 执行函数：`node <cli> ...args`，关闭遥测与颜色。
*
* 用 `node` 直接执行包的入口，不经过 `npx`，也不依赖 PATH 里的全局命令。
*/
function createSkillsCliRunner({ timeoutMs = SKILL_UPDATE_TIMEOUT_MS, cliPath = resolveSkillsCliPath(), env = process.env } = {}) {
	return (args, options = {}) => new Promise((resolve) => {
		execFile(process.execPath, [cliPath, ...args], {
			...options.cwd === void 0 ? {} : { cwd: options.cwd },
			timeout: timeoutMs,
			maxBuffer: MAX_OUTPUT_BYTES,
			env: {
				...env,
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
* 检查全局或某个目标目录里的 skill 状态。
*
* @param deps 仓库读取能力、CLI runner 与作用域
*/
async function checkSkills(deps) {
	const { homes = resolveHomes(), catalog, cli = createSkillsCliRunner(), refresh } = deps;
	const prepared = await collectCandidates({
		homes,
		dir: deps.dir
	});
	if (!prepared.ok) return prepared;
	const { scope, candidates } = prepared;
	if (candidates.length === 0) return {
		ok: true,
		scope,
		...scope === "project" && deps.dir !== void 0 ? { dir: deps.dir } : {},
		results: [],
		message: "没有由 npx 管理、且仍安装在磁盘上的 skill，无需检查。"
	};
	if (scope === "global") {
		const mismatch = globalHomeMismatch(homes);
		if (mismatch !== null) return {
			ok: false,
			code: "unsupported-home",
			message: mismatch
		};
	}
	const checked = await runCheckCli({
		scope,
		dir: deps.dir,
		cli
	});
	if (!checked.ok) return checked;
	const { updates, modified, failedSources } = parseCheckOutput(checked.output);
	const checks = await evaluateCandidates({
		candidates,
		updates,
		modified,
		failedSources,
		catalog,
		...refresh === void 0 ? {} : { refresh }
	});
	return {
		ok: true,
		scope,
		...scope === "project" && deps.dir !== void 0 ? { dir: deps.dir } : {},
		results: checks
	};
}
/**
* 检查并更新：只应用 `update` 状态，`modified` 默认跳过。
*
* 更新逐个执行，任何一个失败都不影响后面的；每个失败项带上 CLI 输出。
* 没有可更新项时明确返回「已是最新」。
*
* @param deps 同 `checkSkills()`
*/
async function updateSkills(deps) {
	const { homes = resolveHomes(), catalog, cli = createSkillsCliRunner(), refresh } = deps;
	const prepared = await collectCandidates({
		homes,
		dir: deps.dir
	});
	if (!prepared.ok) return prepared;
	const { scope } = prepared;
	const only = deps.skills === void 0 ? void 0 : new Set(deps.skills);
	const candidates = only === void 0 ? prepared.candidates : prepared.candidates.filter((candidate) => only.has(candidate.name));
	const base = {
		scope,
		...scope === "project" && deps.dir !== void 0 ? { dir: deps.dir } : {}
	};
	if (candidates.length === 0) return {
		ok: true,
		...base,
		updated: [],
		skipped: [],
		failed: [],
		message: only !== void 0 && prepared.candidates.length > 0 ? "没有要更新的 skill。" : "没有由 npx 管理、且仍安装在磁盘上的 skill，无需更新。"
	};
	if (scope === "global") {
		const mismatch = globalHomeMismatch(homes);
		if (mismatch !== null) return {
			ok: false,
			code: "unsupported-home",
			message: mismatch
		};
	}
	const checked = await runCheckCli({
		scope,
		dir: deps.dir,
		cli
	});
	if (!checked.ok) return checked;
	const { updates, modified, failedSources } = parseCheckOutput(checked.output);
	const checks = await evaluateCandidates({
		candidates,
		updates,
		modified,
		failedSources,
		catalog,
		...refresh === void 0 ? {} : { refresh }
	});
	const updated = [];
	const skipped = [];
	const failed = [];
	let attempted = 0;
	for (const entry of checks) {
		if (entry.status === "update") {
			attempted += 1;
			const result = await cli([
				"update",
				entry.name,
				scope === "global" ? "-g" : "-p",
				"-y"
			], cliOptions(scope, deps.dir));
			const output = [result.stdout, result.stderr].filter((text) => text !== "").join("\n");
			if (result.exitCode === 0) {
				updated.push({ name: entry.name });
				continue;
			}
			failed.push({
				name: entry.name,
				message: result.exitCode === null ? `skills update 无法启动：${result.error ?? "未知原因"}` : `skills update 失败（退出码 ${result.exitCode}）`,
				...output === "" ? {} : { output }
			});
			continue;
		}
		if (entry.status === "modified") {
			skipped.push({
				name: entry.name,
				status: "modified",
				reason: "本地文件已被修改，默认跳过更新，避免覆盖你的改动。"
			});
			continue;
		}
		if (entry.status === "unsupported-source") {
			skipped.push({
				name: entry.name,
				status: "unsupported-source",
				reason: "来源里已经没有可再解析的 skill（常见于旧 marketplace 安装），无法自动更新。"
			});
			continue;
		}
		if (entry.status === "failed") failed.push({
			name: entry.name,
			message: entry.message ?? "检查失败，已跳过更新。",
			...entry.output === void 0 ? {} : { output: entry.output }
		});
	}
	let message;
	if (attempted === 0) message = skipped.length === 0 ? "所有 skill 都已是最新。" : `没有可更新的 skill（${skipped.length} 个已跳过）；其余已是最新。`;
	else message = `已更新 ${updated.length} 个 skill${failed.length === 0 ? "。" : `，${failed.length} 个失败。`}`;
	return {
		ok: true,
		...base,
		updated,
		skipped,
		failed,
		message
	};
}
/**
* 收集候选并确定作用域。
*/
async function collectCandidates({ homes, dir }) {
	if (dir !== void 0) {
		const project = await projectCandidates(dir);
		return project.ok ? {
			ok: true,
			scope: "project",
			candidates: project.candidates
		} : project;
	}
	return {
		ok: true,
		scope: "global",
		candidates: await globalCandidates(homes)
	};
}
/** 全局候选：位于 `~/.agents/skills` 且出现在 npx lock 里的 skill。 */
async function globalCandidates(homes) {
	const snapshot = await collectGlobalSkills({ homes });
	const candidates = [];
	for (const skill of snapshot.skills) {
		if (skill.managedByNpx !== true) continue;
		const source = skill.npxSource ?? skill.npxSourceUrl;
		if (typeof source !== "string" || source === "") continue;
		candidates.push({
			name: skill.name,
			id: skill.id,
			source,
			sourceUrl: skill.npxSourceUrl,
			installedPath: skill.path,
			computedHash: null
		});
	}
	return candidates;
}
/**
* 项目级候选：目标目录的 `skills-lock.json` 里 tracked、且目录仍在的 skill。
*
* lock 里没有的目录按手工安装处理，不参与检查 / 更新。
*/
async function projectCandidates(dir) {
	const lockPath = path.join(dir, PROJECT_LOCK_FILE);
	let parsed;
	try {
		parsed = JSON.parse(await promises.readFile(lockPath, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return {
			ok: true,
			candidates: []
		};
		return {
			ok: false,
			code: "lock-unreadable",
			message: `无法读取 ${lockPath}：${errorText(error)}`
		};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {
		ok: false,
		code: "lock-unreadable",
		message: `${lockPath} 不是合法的 JSON 对象。`
	};
	const record = parsed;
	if (record.version !== 1 && record.version !== 2 || record.skills === null || typeof record.skills !== "object" || Array.isArray(record.skills)) return {
		ok: false,
		code: "lock-unreadable",
		message: `${lockPath} 的版本或结构不受支持。`
	};
	const candidates = [];
	for (const [name, raw] of Object.entries(record.skills)) {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
		const entry = raw;
		const source = typeof entry.source === "string" ? entry.source : "";
		if (source === "") continue;
		const id = skillDirName(name);
		if (id === "") continue;
		const installedPath = path.join(dir, ".agents", "skills", id);
		try {
			await promises.access(path.join(installedPath, "SKILL.md"));
		} catch {
			continue;
		}
		candidates.push({
			name,
			id,
			source,
			sourceUrl: typeof entry.sourceUrl === "string" ? entry.sourceUrl : null,
			installedPath,
			computedHash: typeof entry.computedHash === "string" ? entry.computedHash : null
		});
	}
	return {
		ok: true,
		candidates
	};
}
/**
* 跑一次 `skills check`。
*
* 退出码 1 是正常结论（发现更新或本地修改），0 表示没有；其它退出码或进程
* 没启动起来时整体失败。
*/
async function runCheckCli({ scope, dir, cli }) {
	const result = await cli([
		"check",
		scope === "global" ? "-g" : "-p",
		"-y"
	], cliOptions(scope, dir));
	const output = [result.stdout, result.stderr].filter((text) => text !== "").join("\n");
	if (result.exitCode === null || result.exitCode > 1) return {
		ok: false,
		code: "check-failed",
		message: result.exitCode === null ? `skills check 无法启动：${result.error ?? "未知原因"}` : `skills check 失败（退出码 ${result.exitCode}）`,
		...output === "" ? {} : { output }
	};
	return {
		ok: true,
		output
	};
}
/**
* 把 CLI 结论、来源可解析性与本地修改合成每个 skill 的状态。
*
* 来源不可解析（repo-unavailable / unsupported-source）或仓库根 `skills/` 下
* 已经没有这个 skill 时记为 `unsupported-source`；读取来源本身失败记为
* `failed`。CLI 检查失败的来源，其下候选也记为 `failed`。
*/
async function evaluateCandidates({ candidates, updates, modified, failedSources, catalog, refresh }) {
	const sources = /* @__PURE__ */ new Map();
	const loweredFailedSources = failedSources.map((source) => stripAnsi(source).toLowerCase());
	const namesIn = (set, candidate) => {
		for (const value of set) {
			const lowered = value.toLowerCase();
			if (lowered === candidate.name.toLowerCase() || lowered === candidate.id.toLowerCase()) return true;
		}
		return false;
	};
	const entries = [];
	for (const candidate of candidates) {
		let source = sources.get(candidate.source);
		if (source === void 0) {
			source = await resolveSourceSupport(catalog, candidate.source, refresh);
			sources.set(candidate.source, source);
		}
		const state = source.state;
		const supported = state !== "supported" || source.names.has(candidate.name.toLowerCase()) || source.names.has(candidate.id.toLowerCase());
		if (state === "supported" && !supported) {
			entries.push({
				name: candidate.name,
				source: candidate.source,
				status: "unsupported-source",
				message: "仓库根 skills/ 下已经找不到这个 skill（常见于旧 marketplace 安装）。"
			});
			continue;
		}
		const failedByCli = loweredFailedSources.length > 0 && loweredFailedSources.some((source) => source === candidate.source.toLowerCase() || candidate.sourceUrl !== null && source === candidate.sourceUrl.toLowerCase());
		if (state === "unsupported") {
			entries.push({
				name: candidate.name,
				source: candidate.source,
				status: "unsupported-source",
				message: "来源里已经没有可再解析的 skill（常见于旧 marketplace 安装）。"
			});
			continue;
		}
		if (state === "failed") {
			entries.push({
				name: candidate.name,
				source: candidate.source,
				status: "failed",
				message: source.message ?? "无法读取来源。"
			});
			continue;
		}
		if (failedByCli) {
			entries.push({
				name: candidate.name,
				source: candidate.source,
				status: "failed",
				message: "skills check 无法检查这个来源。"
			});
			continue;
		}
		if (namesIn(modified, candidate)) {
			entries.push({
				name: candidate.name,
				source: candidate.source,
				status: "modified"
			});
			continue;
		}
		if (namesIn(updates, candidate)) {
			entries.push({
				name: candidate.name,
				source: candidate.source,
				status: "update"
			});
			continue;
		}
		if (candidate.computedHash !== null) {
			const current = await computeSkillFolderHash(candidate.installedPath).catch(() => null);
			if (current !== null && current !== candidate.computedHash) {
				entries.push({
					name: candidate.name,
					source: candidate.source,
					status: "modified"
				});
				continue;
			}
		}
		entries.push({
			name: candidate.name,
			source: candidate.source,
			status: "up-to-date"
		});
	}
	return entries;
}
async function resolveSourceSupport(catalog, source, refresh) {
	let listed;
	try {
		listed = await catalog.listSkills({
			source,
			...refresh === void 0 ? {} : { refresh }
		});
	} catch (error) {
		return {
			state: "failed",
			message: errorText(error),
			names: /* @__PURE__ */ new Set()
		};
	}
	if (!listed.ok) {
		if (listed.code === "repo-unavailable" || listed.code === "unsupported-source") return {
			state: "unsupported",
			names: /* @__PURE__ */ new Set()
		};
		return {
			state: "failed",
			message: listed.message ?? "无法读取来源。",
			names: /* @__PURE__ */ new Set()
		};
	}
	const names = /* @__PURE__ */ new Set();
	for (const skill of listed.skills ?? []) {
		names.add(skill.name.toLowerCase());
		names.add(skillDirName(skill.name).toLowerCase());
	}
	return {
		state: "supported",
		names
	};
}
/**
* 全局更新固定写 `~/.agents`；DSH 扫描别的目录时拒绝执行，避免改到看不见的位置。
*/
function globalHomeMismatch(homes) {
	const canonical = path.join(os.homedir(), ".agents");
	if (path.resolve(homes.agentsHome) === path.resolve(canonical)) return null;
	return `skills CLI 只更新 ${path.join(canonical, "skills")}，而 DSH 现在扫描 ${path.join(homes.agentsHome, "skills")}（DSH_AGENTS_HOME）；为避免更新到看不见的位置，这里不执行。`;
}
/**
* CLI 的 cwd 选项：项目级必须传目标目录，全局不传。
*/
function cliOptions(scope, dir) {
	return scope === "project" && dir !== void 0 ? { cwd: dir } : void 0;
}
function errorText(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// .build/skills/service.js
/**
* `@buka/dsh-plugin-skills` 对外提供的 Host Service：`ctx.skillCatalog`。
*
* 页面和 `skill_list` 工具只消费其中一部分能力；其他插件通过 Cordis 的
* 服务注入拿到同一个实例：
*
* ```js
* export const inject = ['skillCatalog']
* export function apply(ctx) {
*   const repos = await ctx.skillCatalog.listRepositories()
*   const checked = await ctx.skillCatalog.checkSkills({ dir: '/path/to/worker' })
* }
* ```
*
* 公开方法：
*
* - `listRepositories()`：收藏的来源，附带探测出的类型（标准 npx 仓库 /
*   不可用 / 暂时判不出）与预计 skill 数。来源可以是 GitHub 仓库、任意 git
*   远端或本地绝对路径；远端一律浅克隆到本地缓存再扫描；
* - `listSkills({ source })`：某个仓库里所有可安装的 skill（扁平列表）；
* - `checkSkills({ dir? })`：检查全局（省略 `dir`）或某个目标目录里的 skill
*   状态（`update` / `modified` / `up-to-date` / `unsupported-source` /
*   `failed`）；
* - `updateSkills({ dir?, skills? })`：只应用 `update` 状态，`modified` 默认
*   跳过；`skills` 按名字把候选收窄到指定项（页面行内更新用）；
* - `runSerialized(work)`：借用同一条串行队列执行一段写入，供其他插件在写
*   同一份 `skills-lock.json` 前排队。
*
* 所有仓库访问都复用 `src/repo-skills.ts` 的 TTL 缓存与错误码，并且按仓库
* 来源合并并发请求。检查 / 更新与安装 / 卸载共用同一条串行队列：底层都会整份
* 重写 `skills-lock.json`，并发执行会互相覆盖条目。
*
* 说明：这里用 `ctx.provide()` 注册实例，而不是 `export default class extends
* Service`。原因是本包入口必须同时导出 `apply` 来注册路由与工具（Cordis 的
* 插件入口两种形态不能混用），而且本仓库的单测不安装 `@deepseek-ai/*`，
* 服务实现需要保持可被 `node --test` 直接 import。`ctx.provide` 是 Service
* 基类底层的同一个原语：消费侧完全一致（`inject: ['skillCatalog']` /
* `ctx.skillCatalog`），卸载时同样自动摘除并唤醒依赖方。
*
* @module @buka/dsh-plugin-skills/service
*/
/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.skillCatalog`。 */
const SERVICE_NAME = "skillCatalog";
/** `listRepositories()` 并发探测的上限：收藏列表再长也不一次打开太多连接。 */
const PROBE_CONCURRENCY = 4;
/**
* 收藏仓库与仓库内容的只读服务。
*
* @example
* const service = new SkillsCatalogService()
* const { repositories } = await service.listRepositories()
* const { results } = await service.checkSkills()
*/
var SkillsCatalogService = class {
	/** 同一来源的完整树请求合并表。 */
	#treeInFlight = /* @__PURE__ */ new Map();
	/** 同一来源的类型探测请求合并表。 */
	#probeInFlight = /* @__PURE__ */ new Map();
	/** 安装 / 卸载 / 检查 / 更新共用的串行队列。 */
	#serialize;
	/** DSH home 解析结果；收藏文件与缓存都放在它下面。 */
	homes;
	/** `skills` CLI 的执行函数。 */
	cli;
	constructor({ homes = resolveHomes(), serialize, cli } = {}) {
		this.homes = homes;
		this.#serialize = serialize ?? createSerialQueue();
		this.cli = cli;
	}
	/**
	* 列出收藏的来源，并逐个探测类型与 skill 数量。
	*
	* 失败不会让整个列表失败：条目退回 `kind: 'unknown'`，并带上探测错误码与
	* 原因，其他收藏照常返回。
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
				skills: probed.skills,
				...probed.warning === void 0 ? {} : { warning: probed.warning }
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
	* 列出一个仓库里所有可安装的 skill（扁平列表）。
	*
	* 结果与页面展开的树来自同一次拉取（同一份缓存），所以两处不会互相矛盾。
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
			skills: flattenSkillTree(fetched.root),
			...fetched.warning === void 0 ? {} : { warning: fetched.warning }
		};
	}
	/**
	* 检查全局或某个目标目录里的 skill 状态。
	*
	* 与安装 / 卸载共用串行队列，避免检查时底层 CLI / lock 与其它写入交错。
	*
	* @param options `dir` 由调用方解析后传入；省略表示全局
	*/
	checkSkills({ dir, refresh } = {}) {
		return this.#serialize(() => checkSkills({
			homes: this.homes,
			catalog: this,
			...dir === void 0 ? {} : { dir },
			...refresh === void 0 ? {} : { refresh },
			...this.cli === void 0 ? {} : { cli: this.cli }
		}));
	}
	/**
	* 检查并更新全局或某个目标目录里的 skill；只应用 `update` 状态。
	*
	* @param options `dir` 由调用方解析后传入；省略表示全局
	*/
	updateSkills({ dir, refresh, skills } = {}) {
		return this.#serialize(() => updateSkills({
			homes: this.homes,
			catalog: this,
			...dir === void 0 ? {} : { dir },
			...refresh === void 0 ? {} : { refresh },
			...skills === void 0 ? {} : { skills },
			...this.cli === void 0 ? {} : { cli: this.cli }
		}));
	}
	/**
	* 用安装 / 卸载 / 检查 / 更新共用的串行队列执行一段工作。
	*
	* 其他插件在重写同一份 `skills-lock.json` 前，应通过这里排队，避免与
	* Skills 插件自己的写入并发。
	*
	* @param work 要排队执行的工作
	*/
	runSerialized(work) {
		return this.#serialize(work);
	}
	/**
	* 拉取一个仓库的完整 skills 树（带缓存与并发合并）。
	*
	* @internal 路由适配器用；其他插件优先用 `listSkills()`。
	*/
	fetchRepositorySkills({ source, refresh = false, ...io } = {}) {
		return this.#coalesce(this.#treeInFlight, source, refresh, () => fetchRepoSkills({
			...io,
			homes: this.homes,
			source,
			refresh
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
			refresh
		}));
	}
	/**
	* 同一来源的并发请求共用一次读取；`refresh` 请求不合并，保证「刷新」真的
	* 重新拉。请求 settle 后从表里移除，失败也不会留下毒化的 promise。
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
* 把展示树摊平成 skill 列表，保留树里的排序。
*/
function flattenSkillTree(root) {
	const out = [];
	const walk = (nodes) => {
		for (const node of nodes) {
			if (node.type === "skill") out.push({
				name: node.name,
				description: node.description,
				path: node.path
			});
			walk(node.children);
		}
	};
	walk(root);
	return out;
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
		ctx.logger?.warn?.("skills: 无法读取 skills 注册表：%s", describeError$1(error));
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
* 一个只读工具 `skill_list`，让模型能回答「本机装了哪些全局 skill、它们
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
			name: "skill_list",
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
*   `GET /skills/list` 列出全局 skills，`POST /skills/uninstall` 卸载一个，
*   `GET /skills/icon` 返回缓存的 GitHub owner 头像（过期后台静默更新），
*   `GET /skills/check` 供页面自动检查更新，`POST /skills/update` 应用更新
*   （请求体带 `skills` 时只处理这些名字），
*   `GET /skills/targets` 列出可安装的执行者（可选的 `ctx.workflowWorkers`）与
*   工作区（`ctx.workspaceRegistry`），`POST /skills/install` 把某个收藏仓库
*   里的一个 skill 安装到全局、某个执行者目录或某个工作区目录；
*   `GET /skills/repos` 列出用户收藏的仓库，
*   `POST /skills/repos` 收藏一个，`POST /skills/repos/remove` 移除一个，
*   `GET /skills/repo-skills` 列出某个收藏仓库里可安装的 skills（带缓存；
*   `probe=1` 时只探测仓库类型：标准 npx 仓库 / 不可用）。收藏只认仓库根
*   `skills/` 下（任意层级子目录）的 SKILL.md；来源可以是 GitHub 仓库、任意
*   git 远端（都浅克隆到本地缓存再扫描）或本地绝对路径（直接扫描目录）。
*   列表数据来自同一份磁盘扫描（`src/skill-store.ts`），收藏来自
*   `src/repo-store.ts` 的 JSON 文件，仓库 skills 由 `src/repo-skills.ts` 按
*   TTL 缓存仓库树；安装 / 卸载走 `skills` 包的库 API，检查 / 更新走同一包
*   自带的 CLI，四类写入共用一条串行队列；
* - 一个只读工具 `skill_list`，让模型能回答「本机装了哪些全局 skill、它们
*   是不是 npx skills 装的」。安装与卸载都是写操作，只留给页面上的用户按钮，
*   不开放给模型。
* - 一个 Host Service `ctx.skillCatalog`（`src/service.ts`）：把收藏的仓库、
*   仓库里的 skill 列表，以及按目录检查 / 更新的能力开放给其他插件。
*   页面与工具也复用同一个服务实例，因此两处的缓存与并发请求是同一份。
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
	const serialize = createSerialQueue();
	const catalog = new SkillsCatalogService({
		homes,
		serialize,
		cli: createSkillsCliRunner()
	});
	ctx.provide(SERVICE_NAME, catalog);
	/** 读取一份已安装 skills 快照；路由与工具共用。 */
	const snapshot = () => readSnapshot(ctx, homes);
	registerRoutes(ctx, {
		homes,
		catalog,
		readSnapshot: snapshot,
		serializeSkills: serialize
	});
	registerTools(ctx, { readSnapshot: snapshot });
}
export { apply, inject, name };
