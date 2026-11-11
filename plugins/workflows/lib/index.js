import { defineTool } from "@deepseek-ai/dsh-tools";
import os from "node:os";
import path from "node:path";
import z from "@deepseek-ai/schemastery";
import { isUtf8 } from "node:buffer";
import { createReadStream, promises } from "node:fs";
import { randomUUID } from "node:crypto";
// .build/workflows/access.js
/**
* 判断某个 agent 能否看到 / 调用工作流工具。
*
* - `allowed` 为空：不做收窄（兼容没有 preset 服务的组成）。
* - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，保持可见。
* - 其余情况：只有「点名 preset 的根会话」可见。
*
* @param input 判定入参
* @returns 可见性、命中的 preset 与原因
*/
function resolveWorkflowAccess(input = {}) {
	const allowed = normalizePresets(input.allowed);
	if (allowed.length === 0) return {
		visible: true,
		preset: null,
		reason: "open"
	};
	const sessions = input.sessions;
	const agentPresets = input.agentPresets;
	if (typeof sessions?.get !== "function" || typeof agentPresets?.presetForSession !== "function") return {
		visible: true,
		preset: null,
		reason: "unavailable"
	};
	const agentId = typeof input.agentId === "string" ? input.agentId : "";
	const session = agentId === "" ? void 0 : sessions.get(agentId);
	if (session === void 0 || session === null) return {
		visible: false,
		preset: null,
		reason: "no-session"
	};
	if (session.header?.parentSession !== void 0) return {
		visible: false,
		preset: null,
		reason: "child-session"
	};
	const preset = agentPresets.presetForSession(session) ?? null;
	if (preset === null) return {
		visible: false,
		preset: null,
		reason: "no-preset"
	};
	return allowed.includes(preset) ? {
		visible: true,
		preset,
		reason: "allowed"
	} : {
		visible: false,
		preset,
		reason: "denied"
	};
}
/**
* 规范化配置里的 preset 名单：去掉空串与非字符串。
*
* @param value 配置里的原始值
* @returns 去重前的合法 preset 名单
*/
function normalizePresets(value) {
	if (!Array.isArray(value)) return [];
	const presets = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const preset = entry.trim();
		if (preset !== "") presets.push(preset);
	}
	return presets;
}
// .build/workflows/attachments.js
/**
* 工作流节点附件：输入规范化、从机器人工作区复制到节点目录、文本读取。
*
* 节点在结构化结果里返回 `attachments`，这里负责把结果里的清单变成落盘文件。本模块
* 不 import 任何 DSH 包，也不决定运行目录布局；目录与清单的持久化由
* `run-store.js` 负责，便于单测。
*
* 路径安全规则：相对路径基于机器人工作区；绝对路径必须位于机器人工作区或
* 当前运行目录内；符号链接会先 `realpath` 再判断，不能借它越界。
*
* @module @buka/dsh-plugin-workflows/attachments
*/
/** 单个附件默认上限：8 MiB。 */
const DEFAULT_MAX_ATTACHMENT_BYTES = 8388608;
/** 每次执行默认附件总量上限：64 MiB。 */
const DEFAULT_MAX_NODE_ATTACHMENTS_BYTES = 67108864;
/** prompt 内联单个文本附件的默认上限：32 KiB。 */
const DEFAULT_MAX_INLINE_ATTACHMENT_BYTES = 32768;
/** 运行页附件预览一次读取的文本上限：64 KiB。 */
const DEFAULT_PREVIEW_TEXT_BYTES = 65536;
/**
* 可直接 inline 预览的图片扩展名 → MIME。
*
* 只列白名单：其它类型一律按文本嗅探或走下载，不把任意内容标成可执行 /
* 可内联的 MIME。
*/
const IMAGE_MIME_BY_EXTENSION = /* @__PURE__ */ new Map([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".bmp", "image/bmp"],
	[".ico", "image/x-icon"],
	[".svg", "image/svg+xml"]
]);
/** 清单里文件名允许的最大 UTF-8 字节数。 */
const MAX_NAME_BYTES = 160;
/** 清单里描述允许的最大字符数。 */
const MAX_DESCRIPTION_LENGTH$1 = 500;
/**
* 把任意错误转成一句话。
*
* @param error 任意错误
* @returns 一句话错误
*/
function describeError$4(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 按 UTF-8 字节数截断文本，不切断码点。
*
* @param text 原文
* @param maxBytes 字节上限
* @returns 截断后的文本
*/
function clipUtf8$1(text, maxBytes) {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let used = 0;
	let output = "";
	for (const character of text) {
		const bytes = Buffer.byteLength(character, "utf8");
		if (used + bytes > maxBytes) break;
		output += character;
		used += bytes;
	}
	return output;
}
/**
* 正整数或默认值。
*
* @param value 待校验的值
* @param fallback 不合法时使用的默认值
* @returns 正整数或默认值
*/
function positive$2(value, fallback) {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
/**
* 文件名清洗：保留 Unicode basename，去掉路径分隔符、控制字符与 Windows
* 非法字符，空名回退 `attachment`。
*
* @param value 请求里给的名字
* @param fallbackSource 源文件路径，用于在没给名字时取 basename
* @returns 清洗后的文件名
*/
function sanitizeAttachmentName(value, fallbackSource = "") {
	let name = (typeof value === "string" && value.trim() !== "" ? value.trim() : path.basename(String(fallbackSource).replace(/\\/gu, "/"))).replace(/\\/gu, "/").split("/").pop() ?? "";
	name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/gu, "-").replace(/[.\s]+$/u, "").trim();
	if (name === "" || name === "." || name === "..") name = "attachment";
	name = clipUtf8$1(name, MAX_NAME_BYTES);
	return name === "" ? "attachment" : name;
}
/**
* 预览类型：按扩展名先划分可 inline 的图片 / PDF，其余交给文本嗅探。
*
* 返回的 `kind: 'text'` 只表示「按文本尝试」；真正的二进制由读取内容后的
* UTF-8 / NUL 判定改成 `binary`。这里不读磁盘，便于单测。
*
* @param name 附件清单里的文件名
* @returns 预览类型与对应的 MIME
*/
function attachmentPreviewInfo(name) {
	const extension = path.extname(typeof name === "string" ? name : "").toLowerCase();
	if (extension === ".pdf") return {
		kind: "pdf",
		mime: "application/pdf"
	};
	const mime = IMAGE_MIME_BY_EXTENSION.get(extension);
	if (mime !== void 0) return {
		kind: "image",
		mime
	};
	return {
		kind: "text",
		mime: "text/plain"
	};
}
/**
* 同名附件去重：`report.md`、`report-2.md`。大小写不敏感，兼容大小写不敏感
* 的文件系统。
*
* @param name 原始文件名
* @param used 已占用的文件名（小写）
* @returns 去重后的文件名
*/
function uniqueAttachmentName(name, used) {
	const key = name.toLowerCase();
	if (!used.has(key)) {
		used.add(key);
		return name;
	}
	const extension = path.extname(name);
	const base = extension === "" ? name : name.slice(0, -extension.length);
	let index = 2;
	while (index < 1e4) {
		const candidate = `${base}-${index}${extension}`;
		const candidateKey = candidate.toLowerCase();
		if (!used.has(candidateKey)) {
			used.add(candidateKey);
			return candidate;
		}
		index += 1;
	}
	const fallback = `${base}-${Date.now()}${extension}`;
	used.add(fallback.toLowerCase());
	return fallback;
}
/**
* 规范化一个附件请求；非法项抛出带下标的错误。
*
* @param raw 结果里的 `attachments`
* @param options 可选上限
* @returns 规范化后的附件请求
*/
function normalizeAttachmentRequests(raw, options = {}) {
	if (raw === void 0 || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error("attachments must be an array of file paths or { path, name?, description? } objects");
	const maxCount = positive$2(options.maxCount, 20);
	if (raw.length > maxCount) throw new Error(`attachments must contain at most ${maxCount} files`);
	const requests = [];
	raw.forEach((item, index) => {
		let source;
		let name;
		let description;
		if (typeof item === "string") source = item;
		else if (item !== null && typeof item === "object" && !Array.isArray(item)) {
			const record = item;
			source = record.path;
			name = record.name;
			description = record.description;
		} else throw new Error(`attachments[${index}] must be a file path string or a { path, name?, description? } object`);
		if (typeof source !== "string" || source.trim() === "") throw new Error(`attachments[${index}].path must be a non-empty file path`);
		if (source.includes("\0")) throw new Error(`attachments[${index}].path contains an invalid NUL character`);
		if (name !== void 0 && name !== null && typeof name !== "string") throw new Error(`attachments[${index}].name must be a string`);
		if (description !== void 0 && description !== null && typeof description !== "string") throw new Error(`attachments[${index}].description must be a string`);
		const request = { path: source.trim() };
		if (typeof name === "string" && name.trim() !== "") request.name = name.trim();
		if (typeof description === "string" && description.trim() !== "") request.description = description.trim().slice(0, MAX_DESCRIPTION_LENGTH$1);
		requests.push(request);
	});
	return requests;
}
/**
* 判断一个路径是否在根目录内。
*
* @param root 根目录
* @param candidate 待判断的路径
* @returns 在根目录内时为 true
*/
function isInside(root, candidate) {
	const relative = path.relative(root, candidate);
	return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
/**
* 解析并校验附件源文件。
*
* @param request 规范化后的附件请求
* @param roots 机器人工作区与当前运行目录
* @returns 真实源文件路径与字节数
*/
async function resolveSource(request, roots) {
	const display = request.path;
	let candidate;
	if (path.isAbsolute(request.path)) candidate = request.path;
	else if (typeof roots.workspace === "string" && roots.workspace !== "") candidate = path.resolve(roots.workspace, request.path);
	else throw new Error(`cannot resolve attachment "${display}": the robot session did not report a workspace`);
	let source;
	try {
		source = await promises.realpath(candidate);
	} catch (error) {
		throw new Error(`attachment source "${display}" is not readable: ${describeError$4(error)}`, { cause: error });
	}
	const allowedRoots = [];
	for (const root of [roots.workspace, roots.runDirectory]) {
		if (typeof root !== "string" || root === "") continue;
		try {
			allowedRoots.push(await promises.realpath(root));
		} catch {}
	}
	if (!allowedRoots.some((root) => isInside(root, source))) throw new Error(`attachment source "${display}" is outside the robot workspace and the current run directory`);
	let stat;
	try {
		stat = await promises.stat(source);
	} catch (error) {
		throw new Error(`attachment source "${display}" is not readable: ${describeError$4(error)}`, { cause: error });
	}
	if (!stat.isFile()) throw new Error(`attachment source "${display}" is not a regular file`);
	return {
		source,
		bytes: stat.size
	};
}
/**
* 把一组附件复制到目的地，返回稳定清单。
*
* 复制前会清空目的地，失败时也清空，避免留下半套附件。清单顺序与输入一致；
* 名字冲突时自动追加 `-2`、`-3`。
*
* @param input 附件清单与目标目录等
* @returns 稳定清单（顺序与输入一致）
*/
async function writeAttachments(input) {
	const requests = normalizeAttachmentRequests(input.raw, { maxCount: input.maxCount });
	const maxBytes = positive$2(input.maxBytes, DEFAULT_MAX_ATTACHMENT_BYTES);
	const maxTotalBytes = positive$2(input.maxTotalBytes, DEFAULT_MAX_NODE_ATTACHMENTS_BYTES);
	const roots = {
		workspace: input.workspace,
		runDirectory: input.runDirectory
	};
	const manifest = [];
	const used = /* @__PURE__ */ new Set();
	let total = 0;
	await promises.rm(input.destination, {
		recursive: true,
		force: true
	});
	if (requests.length === 0) return manifest;
	await promises.mkdir(input.destination, { recursive: true });
	try {
		for (const [index, request] of requests.entries()) {
			const resolved = await resolveSource(request, roots);
			if (resolved.bytes > maxBytes) throw new Error(`attachment "${request.path}" is too large (${resolved.bytes} bytes; limit is ${maxBytes} bytes)`);
			if (total + resolved.bytes > maxTotalBytes) throw new Error(`node attachments exceed the total size limit (${maxTotalBytes} bytes)`);
			const name = uniqueAttachmentName(sanitizeAttachmentName(request.name, request.path), used);
			const destination = path.join(input.destination, name);
			await promises.copyFile(resolved.source, destination, promises.constants.COPYFILE_EXCL);
			const stat = await promises.stat(destination);
			if (stat.size > maxBytes) throw new Error(`attachment "${request.path}" grew beyond the ${maxBytes}-byte limit while being copied`);
			total += stat.size;
			if (total > maxTotalBytes) throw new Error(`node attachments exceed the total size limit (${maxTotalBytes} bytes)`);
			const entry = {
				index,
				name,
				bytes: stat.size
			};
			if (request.description !== void 0) entry.description = request.description;
			manifest.push(entry);
		}
	} catch (error) {
		await promises.rm(input.destination, {
			recursive: true,
			force: true
		}).catch(() => void 0);
		throw error;
	}
	return manifest;
}
/**
* 读取文本附件用于 prompt 内联；二进制或超过上限时不返回文本。
*
* @param file 附件绝对路径
* @param maxBytes 内联字节上限
* @returns 可内联时带文本，否则带原因
*/
async function readInlineText(file, maxBytes) {
	const limit = positive$2(maxBytes, DEFAULT_MAX_INLINE_ATTACHMENT_BYTES);
	const stat = await promises.stat(file);
	if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${file}`);
	if (stat.size > limit) return {
		available: false,
		reason: "too-large",
		bytes: stat.size
	};
	const buffer = await promises.readFile(file);
	if (!isUtf8(buffer) || buffer.includes(0)) return {
		available: false,
		reason: "binary",
		bytes: stat.size
	};
	return {
		available: true,
		text: buffer.toString("utf8"),
		bytes: stat.size
	};
}
/**
* 读取附件的一段内容；文本按 UTF-8 解码，二进制返回 null 文本。
*
* @param file 附件绝对路径
* @param options 起始偏移与读取字节数
* @returns 一段内容；文本按 UTF-8 解码，二进制返回 null 文本
*/
async function readAttachmentRange(file, options = {}) {
	const stat = await promises.stat(file);
	if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${file}`);
	const offset = typeof options.offset === "number" && Number.isInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
	const maxBytes = positive$2(options.maxBytes, 65536);
	const start = Math.min(offset, stat.size);
	const length = Math.max(0, Math.min(maxBytes, stat.size - start));
	let buffer = Buffer.alloc(0);
	if (length > 0) {
		const handle = await promises.open(file, "r");
		try {
			const target = Buffer.alloc(length);
			const { bytesRead } = await handle.read(target, 0, length, start);
			buffer = target.subarray(0, bytesRead);
		} finally {
			await handle.close();
		}
	}
	const truncated = start + buffer.length < stat.size;
	const available = isUtf8(buffer) && !buffer.includes(0);
	let text = available ? buffer.toString("utf8") : null;
	if (!available && truncated) for (let trim = 1; trim <= 3 && trim < buffer.length; trim += 1) {
		const candidate = buffer.subarray(0, buffer.length - trim);
		if (isUtf8(candidate) && !candidate.includes(0)) {
			text = candidate.toString("utf8");
			break;
		}
	}
	return {
		text,
		binary: text === null,
		truncated,
		bytes: stat.size,
		offset: start,
		read: buffer.length
	};
}
// .build/workflows/options.js
/**
* 插件配置与运行目录解析：Config schema、默认值与 runs 目录。
*/
/** 插件全局目录名。 */
const PLUGIN_CACHE_DIR = "dsh-plugin-workflows";
/** 默认配置。 */
const DEFAULTS = {
	runsDir: defaultRunsDir(),
	maxRuns: 200,
	nodeTimeoutMs: 0,
	maxSteps: 64,
	maxNodeTextBytes: 65536,
	maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
	maxAttachmentsPerNode: 20,
	maxNodeAttachmentsBytes: DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
	maxInlineAttachmentBytes: DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
	orchestratorPresets: ["workflow-orchestrator"],
	robotPreset: "standard"
};
/**
* 可配置的运行记录目录与限额。
*/
const Config = z.object({
	runsDir: z.string().default(DEFAULTS.runsDir).description("运行记录目录；每次运行在它下面建一个子目录。支持 ~ 前缀。"),
	maxRuns: z.number().step(1).min(1).default(DEFAULTS.maxRuns).description("已归档运行最多保留多少条；超出时从最旧的已归档运行开始删除。未归档记录不受这个上限影响。"),
	nodeTimeoutMs: z.number().step(1).min(0).default(DEFAULTS.nodeTimeoutMs).description("单个机器人节点的默认硬超时（毫秒）；0 表示不超时。默认不超时，建议由定义按节点显式设置 timeoutMs。"),
	maxSteps: z.number().step(1).min(1).default(DEFAULTS.maxSteps).description("单次工作流的最大节点步数。"),
	maxNodeTextBytes: z.number().step(1).min(1).default(DEFAULTS.maxNodeTextBytes).description("每个节点结果全文落盘时的字节上限。"),
	maxAttachmentBytes: z.number().step(1).min(1).default(DEFAULTS.maxAttachmentBytes).description("单个节点附件的字节上限。"),
	maxAttachmentsPerNode: z.number().step(1).min(1).default(DEFAULTS.maxAttachmentsPerNode).description("每次执行最多允许的附件数量。"),
	maxNodeAttachmentsBytes: z.number().step(1).min(1).default(DEFAULTS.maxNodeAttachmentsBytes).description("每次执行的附件总量字节上限。"),
	maxInlineAttachmentBytes: z.number().step(1).min(1).default(DEFAULTS.maxInlineAttachmentBytes).description("可在 prompt 中用 .text 内联的单个文本附件字节上限。"),
	orchestratorPresets: z.array(z.string()).default(DEFAULTS.orchestratorPresets).description("能看到并调用工作流工具的 agent preset 名单。留空表示不做收窄（所有会话可见）；推荐只保留随插件发布的 `workflow-orchestrator`。"),
	robotPreset: z.string().default(DEFAULTS.robotPreset).description("机器人节点会话使用的 agent preset。编排器跑在专用 preset 上，机器人节点不能继承它，否则会带上编排 persona 且缺少工作工具。")
});
/**
* 合并配置与默认值，并解析 runs 目录。
*
* @param config 插件配置
* @returns 合并默认值之后的配置
*/
function resolveOptions(config) {
	const orchestratorPresets = Array.isArray(config?.orchestratorPresets) ? config.orchestratorPresets.map((preset) => String(preset).trim()).filter((preset) => preset !== "") : DEFAULTS.orchestratorPresets;
	const robotPreset = typeof config?.robotPreset === "string" ? config.robotPreset.trim() : "";
	return {
		runsDir: resolveRunsDir(config?.runsDir),
		maxRuns: positive$1(config?.maxRuns) ?? DEFAULTS.maxRuns,
		nodeTimeoutMs: positive$1(config?.nodeTimeoutMs) ?? DEFAULTS.nodeTimeoutMs,
		maxSteps: positive$1(config?.maxSteps) ?? DEFAULTS.maxSteps,
		maxNodeTextBytes: positive$1(config?.maxNodeTextBytes) ?? DEFAULTS.maxNodeTextBytes,
		maxAttachmentBytes: positive$1(config?.maxAttachmentBytes) ?? DEFAULTS.maxAttachmentBytes,
		maxAttachmentsPerNode: positive$1(config?.maxAttachmentsPerNode) ?? DEFAULTS.maxAttachmentsPerNode,
		maxNodeAttachmentsBytes: positive$1(config?.maxNodeAttachmentsBytes) ?? DEFAULTS.maxNodeAttachmentsBytes,
		maxInlineAttachmentBytes: positive$1(config?.maxInlineAttachmentBytes) ?? DEFAULTS.maxInlineAttachmentBytes,
		orchestratorPresets,
		robotPreset: robotPreset === "" ? DEFAULTS.robotPreset : robotPreset
	};
}
/**
* 解析 runs 目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/runs`。
*
* @param value 配置里的目录（支持 ~ 前缀）
* @param env 环境变量
* @returns 绝对路径
*/
function resolveRunsDir(value, env = process.env) {
	const text = typeof value === "string" ? value.trim() : "";
	if (text === "") return defaultRunsDir(env);
	if (text === "~") return path.join(homeDir(env), `.cache`, PLUGIN_CACHE_DIR, "runs");
	if (text.startsWith("~/") || text.startsWith("~\\")) return path.resolve(homeDir(env), text.slice(2));
	return path.resolve(text);
}
/**
* 默认运行目录。
*
* @param env 环境变量
* @returns 默认 runs 目录
*/
function defaultRunsDir(env = process.env) {
	const cacheHome = typeof env.XDG_CACHE_HOME === "string" && env.XDG_CACHE_HOME.trim() !== "" ? env.XDG_CACHE_HOME.trim() : path.join(homeDir(env), ".cache");
	return path.join(cacheHome, PLUGIN_CACHE_DIR, "runs");
}
/**
* @param env 环境变量
* @returns 用户主目录
*/
function homeDir(env) {
	const home = typeof env.HOME === "string" ? env.HOME.trim() : "";
	return home === "" ? os.homedir() : home;
}
/**
* @param value 待校验的值
* @returns 正整数或 undefined
*/
function positive$1(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
// .build/workflows/templates.js
/**
* 抽象工作流模板目录。
*
* `nodes` 复用可运行定义的节点图形状（start / robot / user / end + 出边），但有
* 三点刻意不同，用来强调「这是参考」：robot 节点的 `robot` 是抽象角色名、没有
* `output`；边上的 `prompt` 只描述交付关系，不写具体任务；整体不含 `goal`。
*/
const WORKFLOW_TEMPLATES = [
	{
		id: "develop-test",
		name: "开发与测试",
		description: "当需求涉及代码或配置改动，并且要走完「开发 → 测试 → 验收 → 合并 → 配置 → 构建部署 → 生产回归」的完整交付链路时参考。它演示了几种常见情况：开发被拆成多个仓库并行、测试不通过打回开发循环、测试需要用户介入操作、以及「当前条件无法完成需求测试」时交用户决定是否调整需求或放弃。参考时把「开发 / 测试 / 运维」替换成你真正拥有的机器人（先用 buka_robots 看清单），并给每个机器人节点补上它要交回的结果 schema。",
		nodes: [
			{
				id: "start",
				type: "start",
				next: [{
					to: "plan",
					name: "begin",
					prompt: "按需求拆解改动范围，确定涉及哪些仓库，并规划开发顺序。"
				}]
			},
			{
				id: "plan",
				type: "robot",
				robot: "开发",
				summary: "拆解需求，规划各仓库的改动范围",
				next: [{
					to: "dev-backend",
					name: "后端",
					prompt: "实现后端服务改动（仓库 A），本地自测通过后交回。"
				}, {
					to: "dev-frontend",
					name: "前端",
					prompt: "实现前端页面改动（仓库 B），本地自测通过后交回。"
				}]
			},
			{
				id: "dev-backend",
				type: "robot",
				robot: "开发",
				summary: "实现后端服务改动（仓库 A）并自测",
				next: [{
					to: "merge",
					name: "完成",
					prompt: "后端改动完成，进入集成步骤。"
				}]
			},
			{
				id: "dev-frontend",
				type: "robot",
				robot: "开发",
				summary: "实现前端页面改动（仓库 B）并自测",
				next: [{
					to: "merge",
					name: "完成",
					prompt: "前端改动完成，进入集成步骤。"
				}]
			},
			{
				id: "merge",
				type: "robot",
				robot: "开发",
				summary: "集成各仓库改动并部署到测试环境（只有一个仓库时无需合并）",
				next: [{
					to: "test",
					name: "已部署",
					prompt: "改动已集成并部署到测试环境，请验证是否满足需求。"
				}]
			},
			{
				id: "test",
				type: "robot",
				robot: "测试",
				summary: "验证改动是否满足需求",
				next: [
					{
						to: "accept",
						name: "通过",
						prompt: "测试通过，进入验收。"
					},
					{
						to: "dev-backend",
						name: "不通过",
						prompt: "测试不通过，按失败信息回到开发修复后重新提交。"
					},
					{
						to: "user-help",
						name: "需用户介入",
						prompt: "测试需要用户完成某项操作后才能继续。"
					},
					{
						to: "user-blocked",
						name: "无法完成",
						prompt: "当前条件无法完成需求测试，交用户决定下一步。"
					}
				]
			},
			{
				id: "user-help",
				type: "user",
				title: "需要用户介入操作",
				detail: "测试环节需要你完成某个操作（提供账号、配置环境、确认外部依赖等）后才能继续。",
				next: [{
					to: "test",
					name: "resume",
					label: "已完成，继续测试"
				}]
			},
			{
				id: "user-blocked",
				type: "user",
				title: "条件无法完成需求测试",
				detail: "当前条件（环境 / 数据 / 依赖 / 需求本身）下无法完成需求测试，请决定下一步。",
				next: [{
					to: "plan",
					name: "adjust",
					label: "调整需求后重来"
				}, {
					to: "end-rejected",
					name: "abandon",
					label: "放弃本次需求"
				}]
			},
			{
				id: "accept",
				type: "user",
				title: "验收",
				detail: "改动已通过测试，请验收确认是否可以进入发布流程。",
				next: [{
					to: "config",
					name: "ok",
					label: "验收通过"
				}, {
					to: "dev-backend",
					name: "rework",
					label: "验收不通过"
				}]
			},
			{
				id: "config",
				type: "robot",
				robot: "运维",
				summary: "按发布要求调整配置",
				next: [{
					to: "deploy",
					name: "完成",
					prompt: "配置已就绪，请构建并部署到生产。"
				}]
			},
			{
				id: "deploy",
				type: "robot",
				robot: "运维",
				summary: "构建并部署到生产",
				next: [{
					to: "regression",
					name: "已部署",
					prompt: "已部署到生产，请做生产环境回归验证。"
				}]
			},
			{
				id: "regression",
				type: "robot",
				robot: "测试",
				summary: "生产环境回归验证",
				next: [{
					to: "end-done",
					name: "通过",
					prompt: "回归通过，发布完成。"
				}, {
					to: "config",
					name: "回滚/修复",
					prompt: "回归发现问题，回到配置 / 修复后再重新部署。"
				}]
			},
			{
				id: "end-done",
				type: "end",
				status: "completed"
			},
			{
				id: "end-rejected",
				type: "end",
				status: "rejected"
			}
		]
	},
	{
		id: "draft-review",
		name: "起草与审校",
		description: "当交付物是一份需要质量把关的文字内容（文档、方案、文案、公告等）时参考。它演示「起草 → 审校 → 人工定稿」的主流程，以及审校不通过退回重写、审校需要用户澄清事实等分支。参考时把「起草 / 审校」替换成真实的机器人，并给节点补上各自的结果 schema。",
		nodes: [
			{
				id: "start",
				type: "start",
				next: [{
					to: "draft",
					name: "begin",
					prompt: "按需求起草内容并交回全文。"
				}]
			},
			{
				id: "draft",
				type: "robot",
				robot: "起草",
				summary: "起草内容",
				next: [{
					to: "review",
					name: "完成",
					prompt: "起草完成，请审校内容质量与准确性。"
				}]
			},
			{
				id: "review",
				type: "robot",
				robot: "审校",
				summary: "审校内容",
				next: [
					{
						to: "finalize",
						name: "通过",
						prompt: "审校通过，请用户确认定稿。"
					},
					{
						to: "draft",
						name: "需修改",
						prompt: "审校不通过，按修改意见重写后重新提交。"
					},
					{
						to: "clarify",
						name: "需澄清",
						prompt: "内容需要用户澄清事实 / 口径后才能继续审校。"
					}
				]
			},
			{
				id: "clarify",
				type: "user",
				title: "澄清需求",
				detail: "审校过程中有些事实或口径需要你澄清，请说明后继续。",
				next: [{
					to: "draft",
					name: "resume",
					label: "已澄清，继续修改"
				}]
			},
			{
				id: "finalize",
				type: "user",
				title: "确认定稿",
				detail: "内容已经过审校，请确认是否定稿。",
				next: [{
					to: "done",
					name: "ok",
					label: "定稿"
				}, {
					to: "draft",
					name: "revise",
					label: "继续修改"
				}]
			},
			{
				id: "done",
				type: "end",
				status: "completed"
			}
		]
	},
	{
		id: "research-report",
		name: "调研与报告",
		description: "当任务需要先搜集资料、再汇总结论交给用户确认时参考。它演示「调研 → 报告 → 人工确认」的主流程，以及调研缺资料需用户提供、报告缺材料回调研补充、用户不满意可重写或补充调研等分支。参考时把「调研 / 报告」替换成真实机器人，并给节点补上结果 schema。",
		nodes: [
			{
				id: "start",
				type: "start",
				next: [{
					to: "research",
					name: "begin",
					prompt: "围绕主题搜集资料，整理出关键事实与来源。"
				}]
			},
			{
				id: "research",
				type: "robot",
				robot: "调研",
				summary: "搜集资料",
				next: [{
					to: "report",
					name: "完成",
					prompt: "资料充分，请把材料汇总成结论报告。"
				}, {
					to: "user-source",
					name: "需用户提供",
					prompt: "缺少关键资料或访问权限，需要用户提供后才能继续。"
				}]
			},
			{
				id: "user-source",
				type: "user",
				title: "提供资料 / 权限",
				detail: "调研缺少关键资料或访问权限，请你提供后继续。",
				next: [{
					to: "research",
					name: "resume",
					label: "已提供，继续调研"
				}]
			},
			{
				id: "report",
				type: "robot",
				robot: "报告",
				summary: "汇总报告",
				next: [{
					to: "confirm",
					name: "完成",
					prompt: "报告完成，请用户确认结论。"
				}, {
					to: "research",
					name: "缺材料",
					prompt: "材料不足，请补充调研后再完善报告。"
				}]
			},
			{
				id: "confirm",
				type: "user",
				title: "确认结论",
				detail: "请查看调研结论，确认是否接受。",
				next: [
					{
						to: "done",
						name: "ok",
						label: "接受"
					},
					{
						to: "research",
						name: "more",
						label: "补充调研"
					},
					{
						to: "report",
						name: "rewrite",
						label: "重写报告"
					}
				]
			},
			{
				id: "done",
				type: "end",
				status: "completed"
			}
		]
	},
	{
		id: "collect-analyze",
		name: "采集与分析",
		description: "当需要先采集数据或素材、再分析产出结论，并且结论需要人工把关时参考。它演示「采集 → 分析 → 人工确认」的主流程，以及采集缺数据源需用户提供、分析发现素材不足回采集补充、用户不满意可重分析或重采集等分支。参考时把「采集 / 分析」替换成真实机器人，并给节点补上结果 schema。",
		nodes: [
			{
				id: "start",
				type: "start",
				next: [{
					to: "collect",
					name: "begin",
					prompt: "采集任务所需的数据或素材，整理后交回。"
				}]
			},
			{
				id: "collect",
				type: "robot",
				robot: "采集",
				summary: "采集数据 / 素材",
				next: [{
					to: "analyze",
					name: "完成",
					prompt: "采集完成，请分析数据并给出结论。"
				}, {
					to: "user-data",
					name: "需用户协助",
					prompt: "缺少数据源或访问凭证，需要用户提供后才能继续采集。"
				}]
			},
			{
				id: "user-data",
				type: "user",
				title: "提供数据 / 凭证",
				detail: "采集缺少数据源或访问凭证，请你提供后继续。",
				next: [{
					to: "collect",
					name: "resume",
					label: "已提供，继续采集"
				}]
			},
			{
				id: "analyze",
				type: "robot",
				robot: "分析",
				summary: "分析并出结论",
				next: [{
					to: "confirm",
					name: "完成",
					prompt: "分析完成，请用户确认结论。"
				}, {
					to: "collect",
					name: "素材不足",
					prompt: "素材不足，请补充采集后再分析。"
				}]
			},
			{
				id: "confirm",
				type: "user",
				title: "确认结论",
				detail: "请查看分析结论，确认是否接受。",
				next: [
					{
						to: "done",
						name: "ok",
						label: "接受"
					},
					{
						to: "analyze",
						name: "redo",
						label: "重新分析"
					},
					{
						to: "collect",
						name: "recollect",
						label: "重新采集"
					}
				]
			},
			{
				id: "done",
				type: "end",
				status: "completed"
			}
		]
	},
	{
		id: "parallel-fanout",
		name: "并行分派与汇合",
		description: "当一项工作可以拆成多个互不依赖的任务、并行执行后再汇总结果时参考：一个规划节点 fan-out 出多个任务（每个任务一个机器人并行跑），join 节点等所有实际启动的任务都完成后放行到下游汇总。参考时把「规划 / 执行 / 汇总」替换成真实机器人，并给节点补上各自的结果 schema 与具体 prompt。",
		nodes: [
			{
				id: "start",
				type: "start",
				next: [{
					to: "plan",
					name: "begin",
					prompt: "拆解需求，规划并行任务。"
				}]
			},
			{
				id: "plan",
				type: "robot",
				robot: "规划",
				summary: "拆解需求，规划并行任务",
				next: [
					{
						to: "task-a",
						name: "任务A",
						prompt: "完成并行任务 A。"
					},
					{
						to: "task-b",
						name: "任务B",
						prompt: "完成并行任务 B。"
					},
					{
						to: "task-c",
						name: "任务C",
						prompt: "完成并行任务 C。"
					}
				]
			},
			{
				id: "task-a",
				type: "robot",
				robot: "执行",
				summary: "并行任务 A"
			},
			{
				id: "task-b",
				type: "robot",
				robot: "执行",
				summary: "并行任务 B"
			},
			{
				id: "task-c",
				type: "robot",
				robot: "执行",
				summary: "并行任务 C"
			},
			{
				id: "merge",
				type: "join",
				inputs: [
					"task-a",
					"task-b",
					"task-c"
				],
				next: [{
					to: "summarize",
					prompt: "全部并行任务完成，汇总结果。"
				}]
			},
			{
				id: "summarize",
				type: "robot",
				robot: "汇总",
				summary: "汇总各并行任务的结果",
				next: [{
					to: "end",
					name: "完成"
				}]
			},
			{
				id: "end",
				type: "end",
				status: "completed"
			}
		]
	}
];
/**
* 模板清单（含完整 `nodes`）。浏览器「模板」页签与 Host 路由直接用它。
*
* @returns 模板清单
*/
function listTemplates() {
	return WORKFLOW_TEMPLATES;
}
/**
* 按 id 取一份模板；找不到返回 null。
*
* @param id 模板 id
* @returns 找到的模板；不存在时是 `null`
*/
function findTemplate(id) {
	if (typeof id !== "string") return null;
	const target = id.trim();
	return WORKFLOW_TEMPLATES.find((template) => template.id === target) ?? null;
}
/**
* 模板的摘要（不含 `nodes`）：给编排 agent 的清单，让它在选模板时先看
* 名字与「什么时候该参考」。
*
* @param templates 模板清单
* @returns 模板摘要
*/
function summarizeTemplates(templates = WORKFLOW_TEMPLATES) {
	return templates.map((template) => ({
		id: template.id,
		name: template.name,
		description: template.description
	}));
}
/**
* 把一份模板转成给模型看的可读流程：名字 + 描述 + 按拓扑顺序排的节点流。
* 只做展示，不校验结构（校验见 `validateTemplates`）。
*
* @param template 模板
* @returns 给模型看的可读流程
*/
function describeTemplate(template) {
	const lines = [`workflow template "${template.name}" (id: ${template.id})`, template.description];
	const nodes = Array.isArray(template.nodes) ? template.nodes : [];
	if (nodes.length === 0) return lines.join("\n");
	lines.push("abstract flow (roles are placeholders — map them to real robots):");
	const order = topoOrder(nodes);
	for (const id of order) {
		const node = nodes.find((item) => item.id === id);
		if (node === void 0) continue;
		const role = node.type === "robot" && typeof node.robot === "string" ? ` role=${node.robot}` : "";
		const title = typeof node.title === "string" && node.title !== "" ? ` "${node.title}"` : "";
		const routes = (Array.isArray(node.next) ? node.next : []).map((rule) => {
			const label = typeof rule.label === "string" && rule.label !== "" ? ` (label: ${rule.label})` : "";
			return typeof rule.name === "string" ? `${rule.name}→${rule.to}${label}` : `→${rule.to}`;
		}).filter((text) => text !== "");
		const inputsText = node.type === "join" ? `  inputs=${(Array.isArray(node.inputs) ? node.inputs : []).join(", ")}` : "";
		lines.push(`- ${node.id} [${node.type}${role}]${title}${inputsText}${routes.length === 0 ? "" : `  edges=${routes.join(" | ")}`}`);
	}
	return lines.join("\n");
}
/**
* 节点的拓扑排序：模板里允许环（例如「测试 → 开发」回边），排序只保证 start 在前、
* 并尽量按出边顺序排列；环内节点按首次出现位置排。
*
* @param nodes 模板节点数组
* @returns 拓扑排序后的节点 id
*/
function topoOrder(nodes) {
	const ids = nodes.map((node) => node.id);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const start = nodes.find((node) => node.type === "start");
	const order = [];
	const seen = /* @__PURE__ */ new Set();
	const visit = (id) => {
		if (id === void 0 || seen.has(id)) return;
		seen.add(id);
		order.push(id);
		const node = byId.get(id);
		for (const rule of Array.isArray(node?.next) ? node.next : []) if (typeof rule?.to === "string" && rule.to !== "") visit(rule.to);
	};
	visit(start === void 0 ? ids[0] : start.id);
	for (const id of ids) visit(id);
	return order;
}
// .build/workflows/render.js
/**
* 工具结果与错误的展示文本：工具输出收口、计划 / 运行 / 状态等渲染。
*/
/** 把运行时值收口成工具输出接受的 JSON 形状（值本身已经是可序列化的）。 */
function jsonValue(value) {
	return value;
}
/** 判断普通对象。 */
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 定义错误的单行文本。
*
* @param errors 定义错误列表
* @returns 单行文本
*/
function formatErrors(errors) {
	return errors.map((error) => `${error.path}: ${error.message}`).join("; ");
}
/**
* `buka_workflow_plan` 的展示文本。
*
* @param value 工具返回值
* @returns 展示文本
*/
function renderPlanResult(value) {
	const record = isRecord$2(value) ? value : {};
	const errors = Array.isArray(record.errors) ? record.errors : [];
	const warnings = Array.isArray(record.warnings) ? record.warnings : [];
	if (record.ok !== true) {
		const lines = [`workflow definition is invalid (${errors.length} error${errors.length === 1 ? "" : "s"}):`];
		for (const rawError of errors) {
			const error = isRecord$2(rawError) ? rawError : {};
			lines.push(`- ${String(error.path)}: ${String(error.message)}`);
		}
		for (const warning of warnings) lines.push(`! ${String(warning)}`);
		return lines.join("\n");
	}
	const summary = isRecord$2(record.summary) ? record.summary : {};
	const nodes = Array.isArray(summary.nodes) ? summary.nodes : [];
	const lines = [`workflow definition is valid: start=${String(summary.start)}, ${nodes.length} node${nodes.length === 1 ? "" : "s"}, maxSteps=${String(summary.maxSteps)}`];
	if (typeof summary.goal === "string" && summary.goal !== "") lines.push(`goal: ${summary.goal}`);
	for (const rawNode of nodes) {
		const node = isRecord$2(rawNode) ? rawNode : {};
		const robot = node.robot === void 0 ? "" : ` robot=${String(node.robot)}`;
		const title = typeof node.title === "string" && node.title !== "" ? ` "${node.title}"` : "";
		const routes = Array.isArray(node.routes) ? node.routes.map((rawRoute) => {
			if (typeof rawRoute === "string") return rawRoute;
			const route = isRecord$2(rawRoute) ? rawRoute : {};
			return `${String(route.name ?? "")}: ${String(route.label ?? "")}`;
		}).filter((route) => route !== "") : [];
		const questions = Array.isArray(node.questions) ? node.questions.filter((id) => typeof id === "string" && id !== "") : [];
		const detail = [routes.length === 0 ? "" : ` routes=${routes.join(" | ")}`, questions.length === 0 ? "" : ` questions=${questions.join(" | ")}`].join("");
		lines.push(`- ${String(node.id)} [${String(node.type)}${robot}]${title}${detail}`);
	}
	for (const warning of warnings) lines.push(`! ${String(warning)}`);
	return lines.join("\n");
}
/**
* 运行的序号标签：`#12 `；旧记录没有序号时是空串。
*
* @param run 运行记录（只读 seq）
* @returns 序号标签
*/
function runSeqLabel(run) {
	const record = isRecord$2(run) ? run : {};
	return typeof record.seq === "number" && Number.isInteger(record.seq) && record.seq > 0 ? `#${record.seq} ` : "";
}
/**
* 一次运行的展示文本。
*
* @param run 运行记录
* @returns 展示文本
*/
function renderRun(run) {
	if (run === null || run === void 0) return "No workflow run was recorded.";
	const record = isRecord$2(run) ? run : {};
	const lines = [`workflow ${runSeqLabel(record)}${String(record.runId)} — ${String(record.status)}`];
	if (typeof record.goal === "string" && record.goal !== "") lines.push(`goal: ${record.goal}`);
	const steps = Array.isArray(record.steps) ? record.steps : [];
	if (steps.length === 0) lines.push("no steps completed");
	for (const rawStep of steps) {
		const step = isRecord$2(rawStep) ? rawStep : {};
		const robot = typeof step.robot === "string" && step.robot !== "" ? ` robot=${step.robot}` : "";
		const session = typeof step.sessionId === "string" && step.sessionId !== "" ? ` session=${step.sessionId}` : "";
		const reason = typeof step.stopReason === "string" ? ` (${step.stopReason})` : "";
		const route = typeof step.route === "string" && step.route !== "" ? ` route=${step.route}` : "";
		const attachments = Array.isArray(step.attachments) && step.attachments.length > 0 ? ` attachments=${step.attachments.length}` : "";
		lines.push(`- ${String(step.nodeId)} [${String(step.type)}${robot}] ${String(step.status)}${reason}${route}${attachments}${session}`);
	}
	if (record.result !== null && record.result !== void 0) lines.push(`result: ${JSON.stringify(record.result)}`);
	if (typeof record.error === "string" && record.error !== "") lines.push(`error: ${record.error}`);
	if (record.pendingUser !== null && record.pendingUser !== void 0) {
		const pendingUser = isRecord$2(record.pendingUser) ? record.pendingUser : {};
		lines.push(`waiting at user node: ${String(pendingUser.title ?? pendingUser.nodeId)}`);
	}
	if (record.pendingInteraction !== null && record.pendingInteraction !== void 0) {
		const pending = isRecord$2(record.pendingInteraction) ? record.pendingInteraction : {};
		const session = typeof pending.sessionId === "string" ? ` in session ${pending.sessionId}` : "";
		if (pending.kind === "approval") {
			const reason = typeof pending.reason === "string" && pending.reason !== "" ? `: ${pending.reason}` : "";
			lines.push(`waiting for the user to approve ${String(pending.toolName ?? "a tool")}${session}${reason}`);
		} else {
			const first = Array.isArray(pending.questions) ? pending.questions[0] : null;
			const question = isRecord$2(first) ? first : {};
			const text = question.question || question.header || "";
			lines.push(`waiting for the user to answer${session}${text === "" ? "" : `: ${String(text)}`}`);
		}
	}
	return lines.join("\n");
}
/**
* `buka_workflow_start` 的展示文本：后台运行只报 runId，前台运行给出终态摘要。
*
* @param value 工具返回值
* @returns 展示文本
*/
function renderStart(value) {
	const record = isRecord$2(value) ? value : {};
	if (record.mode === "background") return [`workflow ${typeof record.seq === "number" && Number.isInteger(record.seq) && record.seq > 0 ? `#${record.seq} ` : ""}${String(record.runId)} started in the background`, "the host observer keeps scheduling node sessions; follow it with buka_workflow_status or the sidebar page"].join("\n");
	return renderRun(record.run ?? null);
}
/**
* `buka_workflow_cancel` 的展示文本。
*
* @param value 工具返回值
* @returns 展示文本
*/
function renderCancel(value) {
	const record = isRecord$2(value) ? value : {};
	const run = isRecord$2(record.run) ? record.run : null;
	if (record.cancelled === true) return `workflow ${String(run?.runId ?? "")} cancellation signalled`;
	if (run === null) return "No workflow run was found.";
	return `workflow ${String(run.runId)} is not live (status: ${String(run.status)}); nothing to cancel`;
}
/**
* `buka_workflow_templates` 的展示文本：无 id 时列目录，有 id 时给一份模板的
* 可读流程。
*
* @param value 工具返回值
* @returns 展示文本
*/
function renderTemplates(value) {
	const record = isRecord$2(value) ? value : {};
	const template = isRecord$2(record.template) ? record.template : null;
	if (template !== null) return describeTemplate(template);
	const templates = Array.isArray(record.templates) ? record.templates : [];
	if (templates.length === 0) return "No workflow templates are available.";
	const lines = ["workflow template catalog (abstract reference, not runnable definitions):"];
	for (const rawTemplate of templates) {
		const entry = isRecord$2(rawTemplate) ? rawTemplate : {};
		lines.push(`- ${String(entry.id)} — ${String(entry.name)}: ${String(entry.description)}`);
	}
	lines.push("pass an id to read one template in full; map its abstract roles to real robots before starting.");
	return lines.join("\n");
}
/**
* `buka_workflow_status` 的展示文本。
*
* @param value 工具返回值
* @returns 展示文本
*/
function renderStatus(value) {
	const record = isRecord$2(value) ? value : {};
	if (record.run !== null && record.run !== void 0) return renderRun(record.run);
	const runs = Array.isArray(record.runs) ? record.runs : [];
	if (runs.length === 0) return "No workflow runs have been recorded yet.";
	const lines = ["recent workflow runs:"];
	for (const rawRun of runs) {
		const run = isRecord$2(rawRun) ? rawRun : {};
		const finished = run.finishedAt === null || run.finishedAt === void 0 ? "running" : new Date(run.finishedAt).toISOString();
		const waiting = run.waitingForUser === true ? " · waiting for user" : "";
		lines.push(`- ${runSeqLabel(run)}${String(run.runId)} ${String(run.status)}${waiting} (${finished})${run.goal ? ` — ${String(run.goal)}` : ""}`);
	}
	return lines.join("\n");
}
/**
* @param error 任意错误
* @returns 一句话错误
*/
function describeError$3(error) {
	return error instanceof Error ? error.message : String(error);
}
// .build/workflows/output.js
/**
* 节点结果 JSON 的 schema：定义校验、运行期校验与 prompt 结果契约。
*
* 工作流的 robot 节点在定义里用 `output` 声明它交回的 JSON 对象长什么样。
* 本模块只处理声明与结果之间的纯逻辑（不读盘、不依赖 DSH）：
*
* - `parseOutputSchema`：定义校验时使用的 JSON Schema 子集检查。定义由模型现场
*   生成，所以这里只放行一组可移植关键字，避免把任意 schema 直接当成工具参数；
* - `buildResultSchema`：把声明的 `output` 与引擎字段合并成真正交给
*   `structured_output` 的 schema。`next` 由出边名生成；`abort` 是每个 robot
*   节点内置的主动终止能力；`attachments` 是每个 robot 节点内置的能力，总是
*   可选出现（不是主输出，只放独立数据 / 文件）；
* - `outputProblems`：运行期按声明的 `output` 校验节点交回的结果；
* - `resolveOutputPath`：定义校验时检查 prompt 里 `{{nodes.<id>.data.<path>}}`
*   的路径是否真的在目标节点的 `output` 里；
* - `renderOutputContract`：给节点 prompt 追加一段固定契约（schema + 最终文本
*   与附件的边界）。
*
* 本模块不修改调用方传入的定义对象：`buildResultSchema` 会 clone 后再合并。
*
* @module @buka/dsh-plugin-workflows/output
*/
/** 单份 `output` schema 序列化后的字节上限。 */
const MAX_OUTPUT_SCHEMA_BYTES = 16384;
/** 引擎保留、不允许在 `output` 里声明的顶层字段。 */
const RESERVED_OUTPUT_FIELDS = Object.freeze([
	"next",
	"attachments",
	"abort"
]);
/** 属性名必须能被 prompt 模板的点号路径寻址。 */
const PROPERTY_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
/** 允许的子 schema 类型。 */
const SCHEMA_TYPES = /* @__PURE__ */ new Set([
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
]);
/** 允许的 schema 关键字。 */
const ALLOWED_KEYWORDS = /* @__PURE__ */ new Set([
	"type",
	"description",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const",
	"oneOf"
]);
/** `description` 的最大字符数。 */
const MAX_DESCRIPTION_LENGTH = 1e3;
/** 运行期校验的递归深度上限（定义已经过 parseOutputSchema，正常不会触发）。 */
const MAX_CHECK_DEPTH = 32;
/**
* 判断一个值是不是普通对象。
*
* @param value 待判断的值
* @returns 是普通对象时为 true
*/
function isPlainObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 判断一个值是否是 JSON 原始值。
*
* @param value 待判断的值
* @returns 是 JSON 原始值时为 true
*/
function isPrimitive(value) {
	return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
/**
* 校验并规范化一个 robot 节点的 `output`。
*
* 返回只包含合法关键字的新对象；无法构成 schema 时返回 null（错误已记录）。
*
* @param raw 声明的 `output`
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的 schema；不合法时是 `null`
*/
function parseOutputSchema(raw, path, fail) {
	if (!isPlainObject$1(raw)) {
		fail(path, "must be a JSON Schema object");
		return null;
	}
	if (raw.type !== "object") {
		fail(`${path}.type`, "must be \"object\": a robot node always returns a JSON object");
		return null;
	}
	const schema = walkSchema(raw, path, 1, { properties: 0 }, fail);
	if (schema === null) return null;
	if (Buffer.byteLength(JSON.stringify(schema), "utf8") > 16384) {
		fail(path, `must be at most ${Math.round(MAX_OUTPUT_SCHEMA_BYTES / 1024)} KiB when serialized`);
		return null;
	}
	return schema;
}
/**
* 递归校验一个子 schema。
*
* @param raw 子 schema
* @param path 出错时使用的路径前缀
* @param depth 当前嵌套深度（顶层算第 1 层）
* @param state 所有 properties 的累计计数
* @param fail 记录错误的回调
* @returns 规范化后的子 schema；不合法时是 `null`
*/
function walkSchema(raw, path, depth, state, fail) {
	if (!isPlainObject$1(raw)) {
		fail(path, "must be a JSON Schema object");
		return null;
	}
	if (depth > 8) {
		fail(path, `must not be nested deeper than 8 levels`);
		return null;
	}
	let invalid = false;
	for (const key of Object.keys(raw)) {
		if (ALLOWED_KEYWORDS.has(key)) continue;
		fail(`${path}.${key}`, `is not a supported JSON Schema keyword (allowed: ${[...ALLOWED_KEYWORDS].join(", ")})`);
		invalid = true;
	}
	if (invalid) return null;
	const schema = {};
	if (raw.description !== void 0) {
		if (typeof raw.description !== "string") {
			fail(`${path}.description`, "must be a string");
			return null;
		}
		if (raw.description.length > MAX_DESCRIPTION_LENGTH) {
			fail(`${path}.description`, `must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
			return null;
		}
		schema.description = raw.description;
	}
	if (raw.oneOf !== void 0) {
		for (const key of Object.keys(raw)) {
			if (key === "oneOf" || key === "description") continue;
			fail(`${path}.${key}`, "cannot be combined with oneOf");
			invalid = true;
		}
		if (invalid) return null;
		if (!Array.isArray(raw.oneOf) || raw.oneOf.length === 0) {
			fail(`${path}.oneOf`, "must be a non-empty array of schemas");
			return null;
		}
		const branches = [];
		for (const [index, branch] of raw.oneOf.entries()) {
			const parsed = walkSchema(branch, `${path}.oneOf[${index}]`, depth + 1, state, fail);
			if (parsed === null) return null;
			branches.push(parsed);
		}
		return {
			...schema,
			oneOf: branches
		};
	}
	const type = typeof raw.type === "string" ? raw.type : "";
	if (!SCHEMA_TYPES.has(type)) {
		fail(`${path}.type`, `must be one of: ${[...SCHEMA_TYPES].join(", ")}`);
		return null;
	}
	schema.type = type;
	if (raw.enum !== void 0) {
		if (!Array.isArray(raw.enum) || raw.enum.length === 0) {
			fail(`${path}.enum`, "must be a non-empty array of primitive values");
			return null;
		}
		const values = [];
		const seen = /* @__PURE__ */ new Set();
		for (const [index, value] of raw.enum.entries()) {
			if (!isPrimitive(value)) {
				fail(`${path}.enum[${index}]`, "must be a string, number, boolean or null");
				return null;
			}
			const key = `${typeof value}:${JSON.stringify(value)}`;
			if (seen.has(key)) {
				fail(`${path}.enum[${index}]`, "must not repeat a value");
				return null;
			}
			seen.add(key);
			values.push(value);
		}
		schema.enum = values;
	}
	if (raw.const !== void 0) {
		if (!isPrimitive(raw.const)) {
			fail(`${path}.const`, "must be a string, number, boolean or null");
			return null;
		}
		schema.const = raw.const;
	}
	if (type === "object") {
		const properties = {};
		const names = [];
		if (raw.properties !== void 0) {
			if (!isPlainObject$1(raw.properties)) {
				fail(`${path}.properties`, "must be an object");
				return null;
			}
			for (const [name, value] of Object.entries(raw.properties)) {
				if (!PROPERTY_NAME_PATTERN.test(name)) {
					fail(`${path}.properties.${name}`, "must match [A-Za-z0-9_-] and be at most 64 characters so prompts can address it as {{nodes.<id>.data.<field>}}");
					invalid = true;
					continue;
				}
				if (depth === 1 && RESERVED_OUTPUT_FIELDS.includes(name)) {
					fail(`${path}.properties.${name}`, name === "next" ? "is added by the workflow from the outgoing edge names; do not declare it in output" : name === "abort" ? "is the built-in way to end the run when this node cannot complete its task; do not declare it in output" : "is always available as the built-in attachments capability; do not declare it in output");
					invalid = true;
					continue;
				}
				state.properties += 1;
				if (state.properties > 64) {
					fail(path, `must declare at most 64 properties in total`);
					return null;
				}
				const parsed = walkSchema(value, `${path}.properties.${name}`, depth + 1, state, fail);
				if (parsed === null) {
					invalid = true;
					continue;
				}
				properties[name] = parsed;
				names.push(name);
			}
		}
		if (invalid) return null;
		if (names.length > 0) schema.properties = properties;
		if (raw.required !== void 0) {
			if (!Array.isArray(raw.required)) {
				fail(`${path}.required`, "must be an array of property names");
				return null;
			}
			const required = [];
			const seen = /* @__PURE__ */ new Set();
			for (const [index, name] of raw.required.entries()) {
				if (typeof name !== "string" || !PROPERTY_NAME_PATTERN.test(name)) {
					fail(`${path}.required[${index}]`, "must be a property name declared in properties");
					return null;
				}
				if (!Object.hasOwn(properties, name)) {
					fail(`${path}.required[${index}]`, `"${name}" is not declared in properties`);
					return null;
				}
				if (seen.has(name)) {
					fail(`${path}.required[${index}]`, `"${name}" is listed more than once`);
					return null;
				}
				seen.add(name);
				required.push(name);
			}
			if (required.length > 0) schema.required = required;
		}
		if (raw.additionalProperties !== void 0) {
			if (typeof raw.additionalProperties !== "boolean") {
				fail(`${path}.additionalProperties`, "must be true or false");
				return null;
			}
			schema.additionalProperties = raw.additionalProperties;
		}
		return schema;
	}
	if (raw.properties !== void 0 || raw.required !== void 0 || raw.additionalProperties !== void 0) {
		fail(path, "properties / required / additionalProperties are only allowed on object schemas");
		return null;
	}
	if (type === "array") {
		if (raw.items !== void 0) {
			const parsed = walkSchema(raw.items, `${path}.items`, depth + 1, state, fail);
			if (parsed === null) return null;
			schema.items = parsed;
		}
		return schema;
	}
	if (raw.items !== void 0) {
		fail(`${path}.items`, "is only allowed on array schemas");
		return null;
	}
	return schema;
}
/**
* 一个 robot 节点可用于 JSON `next` 的路由键（出边 name）。
*
* @param node 已规范化的节点
* @returns 可用的路由键
*/
function routeNamesOf(node) {
	return (Array.isArray(node?.next) ? node.next : []).map((rule) => typeof rule?.name === "string" ? rule.name.trim() : "").filter((name) => name !== "");
}
/**
* 生成 attachments 数组的 schema（每次返回新对象，避免被调用方修改）。
*
* attachments 是每个 robot 节点内置的能力：用来交回与答案相互独立的数据 / 文件，
* 不是主输出通道。
*
* @returns attachments 数组的 schema
*/
function attachmentSchema() {
	return {
		type: "array",
		description: "Optional independent data or files this node produced (binary artifacts, archives, traces, large datasets). Supplementary only: never put the answer itself in an attachment. Paths are relative to your workspace; the workflow copies each file into this execution's node directory.",
		items: { oneOf: [{
			type: "string",
			description: "Path to a file, relative to your workspace."
		}, {
			type: "object",
			additionalProperties: false,
			properties: {
				path: {
					type: "string",
					description: "Path to a file, relative to your workspace."
				},
				name: {
					type: "string",
					description: "Optional destination name; defaults to the source file name."
				},
				description: {
					type: "string",
					description: "Optional one-line description shown with the attachment."
				}
			},
			required: ["path"]
		}] }
	};
}
/**
* 构造真正交给 `structured_output` 的 schema。
*
* 新定义以声明的 `output` 为底，合并 `next`（有出边时 enum）、内置的 `abort`
* 与内置的 `attachments`；升级前已在跑的快照没有 `output`，退回旧的宽松对象
* schema，保证未完成的运行能继续。`next` 不放进 `required`：节点可以用 `abort`
* 代替它。返回值是新对象，不会修改节点。
*
* @param node 已规范化的节点
* @returns 交给 `structured_output` 的 schema
*/
function buildResultSchema(node) {
	const schema = (isPlainObject$1(node?.output) ? structuredClone(node.output) : null) ?? {
		type: "object",
		additionalProperties: true,
		properties: {}
	};
	if (!isPlainObject$1(schema.properties)) schema.properties = {};
	const routes = routeNamesOf(node);
	if (routes.length > 0) schema.properties.next = {
		oneOf: [{
			type: "string",
			enum: routes,
			description: "A single route key; the workflow follows exactly one edge."
		}, {
			type: "array",
			items: {
				type: "string",
				enum: routes
			},
			description: "One or more route keys (non-empty); the workflow starts every listed edge as a concurrent branch. Use this to fan out parallel work that a join node collects later."
		}],
		description: "Route key(s) from the workflow definition; selects the edge(s) to follow next. Use \"abort\" instead when you cannot complete this node's task."
	};
	schema.properties.abort = {
		type: "string",
		description: "Set this instead of \"next\" (or instead of a normal result on a terminal node) when you cannot complete this task: a short reason why. The workflow ends and the run is recorded as failed. Abort does not need to satisfy the declared output fields."
	};
	schema.properties.attachments = attachmentSchema();
	return schema;
}
/**
* 判断 prompt 里的 `data.<path>` 是否真的在声明的 `output` 里。
*
* 返回 null 表示存在；否则返回可以拼进错误信息的原因片段。
*
* 规则：
* - 对象按 `properties` 下钻；未声明的字段直接报错（即使 additionalProperties
*   允许，模板引用也必须是显式声明过的字段）；
* - 数组只允许数字下标，并且必须声明了 `items` 才能继续下钻；
* - `oneOf` 的路径必须在所有分支里都存在，避免某一支运行到一半才失败。
*
* @param schema 节点声明的 output schema
* @param segments `data` 之后的路径段
* @returns 存在时是 `null`，否则是可以拼进错误信息的原因片段
*/
function resolveOutputPath(schema, segments) {
	let current = schema;
	const walked = [];
	for (const segment of segments) {
		if (!isPlainObject$1(current)) return "points into a value that is not an object";
		if (Array.isArray(current.oneOf)) {
			for (const branch of current.oneOf) if (resolveOutputPath(branch, segments.slice(walked.length)) !== null) return "is not declared in every oneOf variant";
			return null;
		}
		if (current.type === "array") {
			if (!/^\d+$/u.test(segment)) return "uses a non-numeric segment on an array";
			if (!isPlainObject$1(current.items)) return "descends into an array that does not declare \"items\"";
			current = current.items;
			walked.push(segment);
			continue;
		}
		if (current.type !== "object") return "points into a value that is not an object";
		const properties = isPlainObject$1(current.properties) ? current.properties : {};
		if (!Object.hasOwn(properties, segment)) return "is not declared";
		current = properties[segment];
		walked.push(segment);
	}
	return null;
}
/**
* 按声明的 `output` 校验节点交回的结果。
*
* 引擎保留的顶层 `next` / `abort` / `attachments` 不参与声明字段校验：`next`
* 与 `abort` 由结果解析单独处理，`attachments` 是内置能力。返回可读问题列表，
* 空数组表示通过。
*
* @param node 已规范化的节点
* @param data 节点交回的结果
* @returns 可读问题列表；空数组表示通过
*/
function outputProblems(node, data) {
	if (!isPlainObject$1(node?.output)) return [];
	const problems = [];
	if (!isPlainObject$1(data)) {
		problems.push("result: expected a JSON object");
		return problems;
	}
	checkValue(node.output, data, "", problems, 0);
	return problems;
}
/**
* 递归校验一个值。
*
* @param schema 声明或构建出的 schema
* @param value 待校验的值
* @param path 出错时使用的路径前缀
* @param problems 问题列表
* @param depth 当前递归深度
* @returns 无返回值
*/
function checkValue(schema, value, path, problems, depth) {
	if (depth > MAX_CHECK_DEPTH) return;
	const label = path === "" ? "result" : path;
	if (Array.isArray(schema.oneOf)) {
		if (!schema.oneOf.some((branch) => {
			const branchProblems = [];
			checkValue(branch, value, path, branchProblems, depth + 1);
			return branchProblems.length === 0;
		})) problems.push(`${label}: does not match any oneOf variant`);
		return;
	}
	if (Array.isArray(schema.enum)) {
		if (!schema.enum.some((candidate) => candidate === value)) {
			problems.push(`${label}: must be one of ${JSON.stringify(schema.enum)}`);
			return;
		}
	}
	if (Object.hasOwn(schema, "const") && schema.const !== value) {
		problems.push(`${label}: must equal ${JSON.stringify(schema.const)}`);
		return;
	}
	switch (typeof schema.type === "string" ? schema.type : "") {
		case "object": {
			if (!isPlainObject$1(value)) {
				problems.push(`${label}: expected object, got ${actualType(value)}`);
				return;
			}
			const properties = isPlainObject$1(schema.properties) ? schema.properties : {};
			for (const name of Array.isArray(schema.required) ? schema.required : []) {
				if (Object.hasOwn(value, name)) continue;
				problems.push(`${joinPath(path, name)}: missing required field`);
			}
			if (schema.additionalProperties === false) for (const name of Object.keys(value)) {
				if (Object.hasOwn(properties, name)) continue;
				if (depth === 0 && RESERVED_OUTPUT_FIELDS.includes(name)) continue;
				problems.push(`${joinPath(path, name)}: unexpected field (additionalProperties is false)`);
			}
			for (const [name, child] of Object.entries(properties)) {
				if (!Object.hasOwn(value, name)) continue;
				checkValue(child, value[name], joinPath(path, name), problems, depth + 1);
			}
			return;
		}
		case "array":
			if (!Array.isArray(value)) {
				problems.push(`${label}: expected array, got ${actualType(value)}`);
				return;
			}
			if (isPlainObject$1(schema.items)) value.forEach((item, index) => {
				checkValue(schema.items, item, `${path}[${index}]`, problems, depth + 1);
			});
			return;
		case "string":
			if (typeof value !== "string") problems.push(`${label}: expected string, got ${actualType(value)}`);
			return;
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${label}: expected number, got ${actualType(value)}`);
			return;
		case "integer":
			if (!Number.isInteger(value)) problems.push(`${label}: expected integer, got ${actualType(value)}`);
			return;
		case "boolean":
			if (typeof value !== "boolean") problems.push(`${label}: expected boolean, got ${actualType(value)}`);
			return;
		case "null":
			if (value !== null) problems.push(`${label}: expected null, got ${actualType(value)}`);
			return;
		default: return;
	}
}
/**
* 路径拼接：顶层字段直接用名字，嵌套用点号，数组下标紧跟在父路径后面。
*
* @param path 父路径
* @param name 字段名
* @returns 拼接后的路径
*/
function joinPath(path, name) {
	return path === "" ? name : `${path}.${name}`;
}
/**
* 值的实际类型，用于错误信息。
*
* @param value 待判断的值
* @returns 值的实际类型
*/
function actualType(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
	return typeof value;
}
/**
* 节点 prompt 末尾追加的结果契约。
*
* 升级前的快照没有 `output`，返回空串，保持旧 prompt 不变。
*
* @param node 已规范化的节点
* @returns 追加到 prompt 末尾的契约；旧快照是空串
*/
function renderOutputContract(node) {
	if (!isPlainObject$1(node?.output)) return "";
	const schema = buildResultSchema(node);
	return [
		"---",
		"Result contract (added by the workflow):",
		"Finish by calling the structured_output tool with one JSON object that matches this schema:",
		"```json",
		JSON.stringify(schema, null, 2),
		"```",
		"When this node has outgoing edges, the object must contain exactly one of \"next\" and \"abort\": \"next\" is a declared route name, or a non-empty list of route names to start several edges as concurrent branches; \"abort\" is a short non-empty reason.",
		"If you cannot complete this task, do not choose a route you do not believe in: submit \"abort\" with a short non-empty reason instead. The workflow ends immediately, the run is recorded as failed, and the declared output fields and attachments are not required.",
		"The final assistant text is this step's output shown on the run page; put the actual answer in the final text and the declared fields.",
		"The \"attachments\" list is a built-in capability for independent data or files this node produced (archives, traces, images, large datasets); it is not a place for the answer itself."
	].join("\n");
}
// .build/workflows/template.js
/**
* 节点 prompt 的模板渲染。
*
* 只支持 `{{path}}` 形式的简单取值，不做表达式求值——workflow 定义由 agent
* 现场生成，必须保证这里不可能执行任意代码。可用路径：
*
* - `{{goal}}` / `{{runId}}` / `{{step}}`；
* - `{{nodes.<id>.text}}`：该节点最近一次执行的最终文本；
* - `{{nodes.<id>.data.<path>}}`：机器人通过 `structured_output` 回报的结构化结果；
* - 需要时也可以引用 `{{nodes.<id>.robot}}`、`{{nodes.<id>.sessionId}}`。
*
* 路径不存在时抛错（而不是静默变空串），这样定义写错时在对应节点立刻失败，
* 不会把空提示词交给机器人。
*
* 定义校验阶段用 `inspectTemplate` 只提取路径、不求值，再按目标节点声明的
* `output` schema 检查 `{{nodes.<id>.data.<path>}}` 是否真的存在。
*
* @module @buka/dsh-plugin-workflows/template
*/
/** 模板占位符。 */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/gu;
/** 合法路径：点号分隔的简单标识符。 */
const PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u;
/** 模板错误：带出错路径，便于定位是哪个占位符。 */
var TemplateError = class extends Error {
	/** 出错的模板路径；没有具体路径时是 `undefined`。 */
	path;
	constructor(message, path) {
		super(message);
		this.name = "TemplateError";
		this.path = path;
	}
};
/**
* 解析一个占位符里的路径（不含花括号）。
*
* @param raw 占位符原文
* @returns 合法时带 `path`，非法时带 `error`
*/
function parsePlaceholder(raw) {
	const path = String(raw).trim();
	if (path === "") return { error: "empty template placeholder" };
	if (!PATH_PATTERN.test(path)) return { error: `invalid template path "${path}"` };
	return { path };
}
/**
* 列出模板里出现的所有占位符路径，并收集语法错误；不求值。
*
* 定义校验用它检查 `{{nodes.<id>.data.<path>}}` 是否落在目标节点声明的
* `output` 里；规则与运行时 `renderTemplate` 保持一致。
*
* @param template 模板原文
* @returns 占位符路径与语法错误
*/
function inspectTemplate(template) {
	if (typeof template !== "string") return {
		paths: [],
		errors: ["template must be a string"]
	};
	const paths = [];
	const errors = [];
	template.replace(PLACEHOLDER, (_match, raw) => {
		const parsed = parsePlaceholder(raw);
		if (parsed.error !== void 0) {
			errors.push(parsed.error);
			return "";
		}
		paths.push(parsed.path);
		return "";
	});
	return {
		paths,
		errors
	};
}
/**
* 渲染一个 prompt 模板。
*
* @param template 模板原文
* @param context 例如 `{ goal, nodes, step, runId }`
* @returns 渲染后的文本
*/
function renderTemplate(template, context) {
	if (typeof template !== "string") throw new TemplateError("template must be a string");
	return template.replace(PLACEHOLDER, (_match, raw) => {
		const parsed = parsePlaceholder(raw);
		if (parsed.error !== void 0) throw new TemplateError(parsed.error, String(raw).trim());
		const path = parsed.path;
		const value = getPath(context, path);
		if (value === void 0) throw new TemplateError(`template path "${path}" is not available yet`, path);
		return formatValue(value);
	});
}
/**
* 按点号路径取值；中途遇到 null / undefined 时返回 undefined。
*
* @param source 取值来源
* @param path 点号路径
* @returns 取到的值；路径不存在时是 `undefined`
*/
function getPath(source, path) {
	let current = source;
	for (const key of path.split(".")) {
		if (current === null || current === void 0) return void 0;
		if (typeof current !== "object") return void 0;
		current = current[key];
	}
	return current;
}
/**
* 把模板值转成文本：字符串原样，对象转 JSON，null 视作空串。
*
* 附件值可能带一个内部错误标记（例如二进制或超过内联上限），此时直接抛出
* `TemplateError`，而不是把标记对象 JSON 化后塞进 prompt。
*
* @param value 模板值
* @returns 文本
*/
function formatValue(value) {
	if (typeof value === "string") return value;
	if (value === null) return "";
	if (typeof value === "object" && typeof value.__bukaTemplateError === "string") throw new TemplateError(value.__bukaTemplateError);
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}
/** 节点 id 的合法字符集。 */
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u;
/** 机器名称的最大长度。 */
const MAX_ROBOT_NAME_LENGTH = 128;
/** prompt 的字节上限。 */
const MAX_PROMPT_BYTES = 262144;
/** 用户节点说明的最大字符数。 */
const MAX_USER_DETAIL_LENGTH = 4e3;
/** 问题正文 / 标题的最大字符数。 */
const MAX_QUESTION_TEXT_LENGTH = 1e3;
const MAX_QUESTION_HEADER_LENGTH = 200;
/** 单个问题最多多少个选项。 */
const MAX_QUESTION_OPTIONS = 20;
/** 问题 id 的合法字符集。 */
const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
/** route 问题的保留 id；用户节点的出边选项共用这个 id。 */
const ROUTE_QUESTION_ID = "route";
/** 终止节点允许的状态。 */
const END_STATUSES$1 = /* @__PURE__ */ new Set([
	"completed",
	"failed",
	"rejected"
]);
/** 节点类型。 */
const NODE_TYPES$1 = /* @__PURE__ */ new Set([
	"start",
	"robot",
	"user",
	"join",
	"end"
]);
/**
* 机器人节点可选的会话模式。`plan` 进入 DSH 的 plan 模式（先探索、交计划，
* 原生审阅批准后再继续）；`goal` 暂未实现，定义里出现会被明确拒绝。
*/
const ROBOT_MODES = /* @__PURE__ */ new Set(["plan"]);
/** format 3 的移除提示：旧 gate 节点被用户介入节点取代。 */
const GATE_REMOVED = "gate was replaced by the user node in workflow format 3; use { \"type\": \"user\", \"title\", \"detail\"?, \"next\"?, \"questions\"? }";
/** format 2 的移除提示：机器人节点不再有 `report`。 */
const REPORT_REMOVED = "report was removed in workflow format 2; every robot node always returns JSON";
/** format 2 的移除提示：边不再有 `when`。 */
const WHEN_REMOVED = "when was removed; select the next edge with the JSON \"next\" route";
/** 机器人节点 prompt 移除提示。 */
const NODE_PROMPT_REMOVED = "robot nodes no longer carry a prompt; define it on the edge entering this node";
/**
* 边可选的展示色。它只影响运行页 / 模板页上那条线的颜色，不参与路由、
* 调度或结果校验，所以只有「成功」与「失败」两个语义值。
*/
const EDGE_TONES = /* @__PURE__ */ new Set(["success", "failure"]);
/**
* 判断一个值是不是普通对象。
*
* @param value 待判断的值
* @returns 是普通对象时为 true
*/
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 校验一份工作流定义。
*
* 返回 `{ ok, errors, warnings, plan }`：`ok` 为 true 时 `plan` 可执行；
* 否则 `errors` 里是 `{ path, message }` 列表，`plan` 为 null。
*
* @param input agent 传入的定义
* @param options 部署侧步数上限
* @returns 校验结果；`ok` 为 true 时 `plan` 可执行
*/
function validateDefinition(input, options = {}) {
	const errors = [];
	const warnings = [];
	const fail = (path, message) => errors.push({
		path,
		message
	});
	if (!isPlainObject(input)) {
		fail("definition", "must be a JSON object");
		return {
			ok: false,
			errors,
			warnings,
			plan: null
		};
	}
	const ceiling = normalizeStepCeiling(options.maxSteps);
	const goal = readGoal(input.goal, fail);
	const maxSteps = readMaxSteps(input.maxSteps, ceiling, fail);
	const declaredStart = typeof input.start === "string" ? input.start.trim() : "";
	if (declaredStart !== "") fail("start", "the legacy top-level \"start\" format was removed; add a node with type \"start\"");
	const nodes = /* @__PURE__ */ new Map();
	const order = [];
	if (!Array.isArray(input.nodes)) fail("nodes", "must be a non-empty array of node objects");
	else if (input.nodes.length === 0) fail("nodes", "must contain at least one node");
	else if (input.nodes.length > 200) fail("nodes", `must contain at most 200 nodes`);
	else input.nodes.forEach((raw, index) => {
		const node = parseNode(raw, `nodes[${index}]`, fail);
		if (node === null) return;
		if (nodes.has(node.id)) {
			fail(`nodes[${index}].id`, `duplicate node id "${node.id}"`);
			return;
		}
		nodes.set(node.id, node);
		order.push(node.id);
	});
	const startIds = order.filter((id) => nodes.get(id)?.type === "start");
	let start = "";
	if (startIds.length === 0) {
		if (declaredStart === "") fail("start", "a workflow definition needs exactly one node with type \"start\"");
	} else {
		if (startIds.length > 1) for (const id of startIds.slice(1)) fail(`nodes[${order.indexOf(id)}]`, "the definition may contain exactly one start node");
		start = startIds[0] ?? "";
		const startIndex = order.indexOf(start);
		const startNode = nodes.get(start);
		if (startNode !== void 0) {
			if (!Array.isArray(startNode.next) || startNode.next.length === 0) fail(`nodes[${startIndex}].next`, "a start node needs at least one outgoing edge");
			else startNode.next.forEach((rule, ruleIndex) => {
				const target = nodes.get(rule.to);
				if (target !== void 0 && target.type !== "robot") fail(`nodes[${startIndex}].next[${ruleIndex}].to`, "the start edge must enter a robot node");
				if (typeof rule.prompt !== "string" || rule.prompt.trim() === "") fail(`nodes[${startIndex}].next[${ruleIndex}].prompt`, "the start edge must carry the first robot prompt");
			});
		}
	}
	const edges = [];
	for (const [index, id] of order.entries()) {
		const node = nodes.get(id);
		for (const [ruleIndex, rule] of (node?.next ?? []).entries()) edges.push({
			edge: rule,
			path: `nodes[${index}].next[${ruleIndex}]`
		});
	}
	for (const { edge, path } of edges) {
		const target = nodes.get(edge.to);
		if (target === void 0) {
			fail(path, `transition to unknown node "${edge.to}"`);
			continue;
		}
		if (target.type === "start") {
			fail(path, "an edge cannot point at the start node");
			continue;
		}
		if (target.type === "join") {
			fail(path, "an edge cannot point at a join node; joins collect their inputs via the \"inputs\" list");
			continue;
		}
		if (target.type === "robot") {
			if (typeof edge.prompt !== "string" || edge.prompt.trim() === "") fail(`${path}.prompt`, "an edge entering a robot node must carry its prompt");
		} else if (typeof edge.prompt === "string" && edge.prompt !== "") fail(`${path}.prompt`, "an edge prompt is only supported when the edge enters a robot node");
	}
	const inputJoins = /* @__PURE__ */ new Map();
	for (const [index, id] of order.entries()) {
		const node = nodes.get(id);
		if (node === void 0 || node.type !== "join") continue;
		for (const [inputIndex, input] of (node.inputs ?? []).entries()) {
			const target = nodes.get(input);
			if (target === void 0) {
				fail(`nodes[${index}].inputs[${inputIndex}]`, `references unknown node "${input}"`);
				continue;
			}
			if (target.type !== "robot") {
				fail(`nodes[${index}].inputs[${inputIndex}]`, `a join can only wait for robot nodes; "${input}" is a ${target.type} node`);
				continue;
			}
			const list = inputJoins.get(input);
			if (list === void 0) inputJoins.set(input, [id]);
			else list.push(id);
		}
	}
	if (errors.length === 0) {
		const reachable = reachableNodes(nodes, start, inputJoins);
		for (const [index, id] of order.entries()) {
			if (reachable.has(id)) continue;
			fail(`nodes[${index}]`, `node "${id}" is not reachable from start, so it would never run`);
		}
		if (errors.length === 0) validatePromptReferences(nodes, promptTemplates(nodes, order), fail);
		const hasRobot = order.some((id) => nodes.get(id)?.type === "robot");
		if (errors.length === 0 && !hasRobot) warnings.push("the workflow has no robot node, so nothing will be delegated");
	}
	if (errors.length === 0) {
		const cyclic = cyclicNodes(nodes, order, inputJoins);
		for (const id of order) {
			const node = nodes.get(id);
			if (node === void 0 || node.type !== "robot") continue;
			if (node.maxVisits !== void 0) continue;
			if (!cyclic.has(id)) continue;
			warnings.push(`node "${id}" is part of a cycle and does not set maxVisits; the run is only bounded by maxSteps (${maxSteps}). Add maxVisits to stop a no-progress loop.`);
		}
	}
	if (errors.length > 0) return {
		ok: false,
		errors,
		warnings,
		plan: null
	};
	return {
		ok: true,
		errors,
		warnings,
		plan: {
			goal,
			start,
			maxSteps,
			nodes: Object.fromEntries(nodes),
			order
		}
	};
}
/**
* 转成给模型看的一份摘要（不包含 prompt 正文）。
*
* 机器人节点额外带 `routes`：离开它的每条边的 `name`，也就是机器人结果里的
* `next` 可以取的值。用户节点带 `title`、`routes`（每条边 `{ name, label }`）
* 与 `questions`（追加问题的 id）。
*
* @param plan 校验通过后的计划
* @returns 给模型看的摘要
*/
function describePlan(plan) {
	return {
		start: plan.start,
		maxSteps: plan.maxSteps,
		goal: plan.goal,
		nodes: plan.order.map((id) => {
			const node = plan.nodes[id];
			const summary = {
				id,
				type: node.type
			};
			if (node.robot !== void 0) summary.robot = node.robot;
			if (node.type === "end") summary.status = node.status;
			if (node.type === "robot") {
				if (node.mode === "plan") summary.mode = "plan";
				summary.routes = (Array.isArray(node.next) ? node.next : []).map((rule) => rule.name).filter((name) => typeof name === "string" && name !== "");
			}
			if (node.type === "user") {
				summary.title = node.title;
				summary.routes = (Array.isArray(node.next) ? node.next : []).map((rule) => ({
					name: rule.name,
					label: rule.label
				}));
				summary.questions = (Array.isArray(node.questions) ? node.questions : []).map((question) => question.id);
			}
			if (node.type === "join") {
				summary.inputs = [...node.inputs ?? []];
				summary.next = Array.isArray(node.next) && node.next.length > 0 ? node.next[0]?.to : null;
			}
			return summary;
		})
	};
}
/**
* 收集一个节点的所有出边目标。
*
* @param node 已规范化的节点
* @returns 出边目标 id
*/
function targetsOf(node) {
	const targets = [];
	if (Array.isArray(node.next)) {
		for (const rule of node.next) if (typeof rule?.to === "string" && rule.to !== "") targets.push(rule.to);
	}
	return targets;
}
/**
* 一个节点在图上的全部出边目标：普通 `next` 出边，加上「任务 → 引用它的 join」
* 的隐式入边（join.inputs 里列出该任务的那些 join）。join 自己只有 `next` 出边。
*
* @param node 已规范化的节点
* @param inputJoins 任务节点 id → 引用它的 join id 列表
* @returns 出边目标 id（含隐式 join 边）
*/
function allTargetsOf(node, inputJoins) {
	const targets = targetsOf(node);
	if (node.type === "robot") for (const joinId of inputJoins.get(node.id) ?? []) targets.push(joinId);
	return targets;
}
/**
* 从 start 出发按出边做一次 BFS。
*
* @param nodes 节点表
* @param start 起始节点 id
* @param inputJoins 任务节点 id → 引用它的 join id 列表
* @returns 从 start 可达的节点 id
*/
function reachableNodes(nodes, start, inputJoins) {
	const seen = /* @__PURE__ */ new Set();
	const queue = [start];
	while (queue.length > 0) {
		const id = queue.shift();
		if (id === void 0) break;
		if (seen.has(id)) continue;
		seen.add(id);
		const node = nodes.get(id);
		if (node === void 0) continue;
		queue.push(...allTargetsOf(node, inputJoins));
	}
	return seen;
}
/**
* 找出所有「在环上」的节点（从自己出发沿出边可以走回自己）。
*
* @param nodes 节点表
* @param order 节点声明顺序
* @param inputJoins 任务节点 id → 引用它的 join id 列表
* @returns 在环上的节点 id
*/
function cyclicNodes(nodes, order, inputJoins) {
	const cyclic = /* @__PURE__ */ new Set();
	for (const id of order) {
		const node = nodes.get(id);
		if (node === void 0) continue;
		const queue = [...allTargetsOf(node, inputJoins)];
		const seen = /* @__PURE__ */ new Set();
		while (queue.length > 0) {
			const next = queue.shift();
			if (next === void 0) break;
			if (next === id) {
				cyclic.add(id);
				break;
			}
			if (seen.has(next)) continue;
			seen.add(next);
			const target = nodes.get(next);
			if (target !== void 0) queue.push(...allTargetsOf(target, inputJoins));
		}
	}
	return cyclic;
}
/**
* 读取 goal：可选，默认空串。
*
* @param value 定义里的 goal
* @param fail 记录错误的回调
* @returns 规范化后的 goal
*/
function readGoal(value, fail) {
	if (value === void 0 || value === null) return "";
	if (typeof value !== "string") {
		fail("goal", "must be a string");
		return "";
	}
	const goal = value.trim();
	if (goal.length > 4e3) fail("goal", "must be at most 4000 characters");
	return goal;
}
/**
* 读取并裁剪 maxSteps。
*
* @param value 定义里的 maxSteps
* @param ceiling 部署侧上限
* @param fail 记录错误的回调
* @returns 裁剪后的步数上限
*/
function readMaxSteps(value, ceiling, fail) {
	if (value === void 0 || value === null) return ceiling;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		fail("maxSteps", "must be a positive integer");
		return ceiling;
	}
	if (value > ceiling) fail("maxSteps", `must be at most ${ceiling}`);
	return Math.min(value, ceiling);
}
/**
* 部署侧上限的规范化。
*
* @param value 部署侧配置的上限
* @returns 规范化后的上限
*/
function normalizeStepCeiling(value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return 64;
	return Math.min(value, 256);
}
/**
* 解析一个节点；无法构成节点时返回 null（错误已记录）。
*
* @param raw 原始节点
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的节点；不合法时是 `null`
*/
function parseNode(raw, path, fail) {
	if (!isPlainObject(raw)) {
		fail(path, "must be an object");
		return null;
	}
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!NODE_ID_PATTERN.test(id)) fail(`${path}.id`, "must be 1-64 letters, digits, \".\", \"_\" or \"-\", starting with a letter or digit");
	const type = typeof raw.type === "string" ? raw.type.trim() : "";
	if (type === "gate") {
		fail(`${path}.type`, GATE_REMOVED);
		return null;
	}
	if (!NODE_TYPES$1.has(type)) {
		fail(`${path}.type`, "must be \"start\", \"robot\", \"user\" or \"end\"");
		return null;
	}
	if (!NODE_ID_PATTERN.test(id)) return null;
	if (type === "start") return parseStartNode(raw, id, path, fail);
	if (type === "robot") return parseRobotNode(raw, id, path, fail);
	if (type === "user") return parseUserNode(raw, id, path, fail);
	if (type === "join") return parseJoinNode(raw, id, path, fail);
	return parseEndNode(raw, id, path, fail);
}
/**
* @param raw 原始节点
* @param id 节点 id
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的开始节点
*/
function parseStartNode(raw, id, path, fail) {
	rejectOutputOnFixedNode(raw, path, fail);
	rejectModeOnFixedNode(raw, path, fail);
	return {
		id,
		type: "start",
		next: parseEdgeList(raw.next, `${path}.next`, fail, { allowString: false })
	};
}
/**
* @param raw 原始节点
* @param id 节点 id
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的机器人节点
*/
function parseRobotNode(raw, id, path, fail) {
	const robot = typeof raw.robot === "string" ? raw.robot.trim() : "";
	if (robot === "") fail(`${path}.robot`, "must be a non-empty robot name");
	else if (robot.length > MAX_ROBOT_NAME_LENGTH) fail(`${path}.robot`, `must be at most ${MAX_ROBOT_NAME_LENGTH} characters`);
	if (raw.prompt !== void 0 && raw.prompt !== null) fail(`${path}.prompt`, NODE_PROMPT_REMOVED);
	if (raw.report !== void 0) fail(`${path}.report`, REPORT_REMOVED);
	if (raw.summary !== void 0 && raw.summary !== null && typeof raw.summary !== "string") fail(`${path}.summary`, "must be a string");
	const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
	if (summary.length > 500) fail(`${path}.summary`, `must be at most 500 characters`);
	const summaryText = summary.slice(0, 500);
	let mode;
	if (raw.mode !== void 0 && raw.mode !== null) {
		const rawMode = typeof raw.mode === "string" ? raw.mode.trim() : "";
		if (rawMode === "goal") fail(`${path}.mode`, "mode \"goal\" is not supported yet; only \"plan\" is available");
		else if (!ROBOT_MODES.has(rawMode)) fail(`${path}.mode`, "must be \"plan\"");
		else mode = "plan";
	}
	let output;
	if (raw.output === void 0) fail(`${path}.output`, "is required: declare the JSON result schema for this robot node");
	else {
		const parsedOutput = parseOutputSchema(raw.output, `${path}.output`, fail);
		if (parsedOutput !== null) output = parsedOutput;
	}
	const agentOptions = parseAgentOptions(raw.agentOptions, `${path}.agentOptions`, fail);
	const timeoutMs = parsePositiveInteger(raw.timeoutMs, `${path}.timeoutMs`, fail, 864e5);
	const maxVisits = parsePositiveInteger(raw.maxVisits, `${path}.maxVisits`, fail, 1e3);
	const next = parseEdgeList(raw.next, `${path}.next`, fail, {
		allowString: false,
		requireNames: true
	});
	return {
		id,
		type: "robot",
		robot,
		summary: summaryText,
		...mode === void 0 ? {} : { mode },
		...output === void 0 ? {} : { output },
		agentOptions,
		timeoutMs,
		maxVisits,
		next
	};
}
/**
* 解析一个用户介入节点：说明 + 用户选项出边 + 可选的追加问题。
*
* 用户的选项就是出边：每条边都要有 `name`（路由键）与 `label`（显示给用户
* 的文字），`description` 可选。`questions` 用来收集额外的反馈 / 信息，回答
* 会按问题 id 落盘，后续 prompt 可以用模板引用。
*
* @param raw 原始节点
* @param id 节点 id
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的用户介入节点
*/
function parseUserNode(raw, id, path, fail) {
	rejectOutputOnFixedNode(raw, path, fail);
	rejectModeOnFixedNode(raw, path, fail);
	if (raw.onApprove !== void 0 || raw.onReject !== void 0) fail(`${path}.onApprove`, "onApprove / onReject were removed in workflow format 3; declare the choices as edges in \"next\" with a label");
	let title;
	if (typeof raw.title !== "string" || raw.title.trim() === "") {
		fail(`${path}.title`, "must be a non-empty title");
		title = "";
	} else title = raw.title.trim().slice(0, 200);
	if (raw.detail !== void 0 && raw.detail !== null && typeof raw.detail !== "string") fail(`${path}.detail`, "must be a string");
	const detail = typeof raw.detail === "string" ? raw.detail.trim() : "";
	if (detail.length > 4e3) fail(`${path}.detail`, `must be at most ${MAX_USER_DETAIL_LENGTH} characters`);
	const detailText = detail.slice(0, MAX_USER_DETAIL_LENGTH);
	const next = parseEdgeList(raw.next, `${path}.next`, fail, {
		allowString: false,
		requireNames: true,
		userEdges: true
	});
	const questions = parseUserQuestions(raw.questions, `${path}.questions`, fail);
	if (next.length === 0 && questions.length === 0) fail(path, "a user node needs at least one outgoing edge (a choice) or one extra question; otherwise there is nothing to wait for");
	return {
		id,
		type: "user",
		title,
		detail: detailText,
		next,
		questions
	};
}
/**
* 解析用户节点追加的问题。
*
* @param raw 原始 questions
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的问题列表
*/
function parseUserQuestions(raw, path, fail) {
	if (raw === void 0 || raw === null) return [];
	if (!Array.isArray(raw)) {
		fail(path, "must be an array of questions");
		return [];
	}
	if (raw.length > 4) fail(path, `must contain at most 4 questions`);
	const questions = [];
	const ids = /* @__PURE__ */ new Set([ROUTE_QUESTION_ID]);
	raw.slice(0, 4).forEach((question, index) => {
		const questionPath = `${path}[${index}]`;
		if (!isPlainObject(question)) {
			fail(questionPath, "must be an object");
			return;
		}
		const questionId = typeof question.id === "string" ? question.id.trim() : "";
		if (!QUESTION_ID_PATTERN.test(questionId)) fail(`${questionPath}.id`, "must be 1-64 letters, digits, \"_\" or \"-\"");
		else if (ids.has(questionId)) fail(`${questionPath}.id`, `duplicate question id "${questionId}"; ids must be unique and "route" is reserved`);
		else ids.add(questionId);
		const text = typeof question.question === "string" ? question.question.trim() : "";
		if (text === "") fail(`${questionPath}.question`, "must be a non-empty question");
		else if (text.length > MAX_QUESTION_TEXT_LENGTH) fail(`${questionPath}.question`, `must be at most ${MAX_QUESTION_TEXT_LENGTH} characters`);
		if (question.header !== void 0 && question.header !== null && typeof question.header !== "string") fail(`${questionPath}.header`, "must be a string");
		const header = typeof question.header === "string" ? question.header.trim() : "";
		if (header.length > MAX_QUESTION_HEADER_LENGTH) fail(`${questionPath}.header`, `must be at most ${MAX_QUESTION_HEADER_LENGTH} characters`);
		if (question.multiSelect !== void 0 && typeof question.multiSelect !== "boolean") fail(`${questionPath}.multiSelect`, "must be a boolean");
		const options = [];
		if (question.options !== void 0 && question.options !== null) {
			if (!Array.isArray(question.options)) fail(`${questionPath}.options`, "must be an array of { label, description? }");
			else {
				if (question.options.length > MAX_QUESTION_OPTIONS) fail(`${questionPath}.options`, `must contain at most ${MAX_QUESTION_OPTIONS} options`);
				const labels = /* @__PURE__ */ new Set();
				question.options.slice(0, MAX_QUESTION_OPTIONS).forEach((option, optionIndex) => {
					const optionPath = `${questionPath}.options[${optionIndex}]`;
					if (!isPlainObject(option)) {
						fail(optionPath, "must be an object");
						return;
					}
					const label = typeof option.label === "string" ? option.label.trim() : "";
					if (label === "") fail(`${optionPath}.label`, "must be a non-empty label");
					else if (label.length > 120) fail(`${optionPath}.label`, `must be at most 120 characters`);
					else if (labels.has(label)) fail(`${optionPath}.label`, `duplicate option label "${label}" on the same question`);
					else labels.add(label);
					if (option.description !== void 0 && option.description !== null && typeof option.description !== "string") fail(`${optionPath}.description`, "must be a string");
					const description = typeof option.description === "string" ? option.description.trim().slice(0, 500) : "";
					options.push(description === "" ? { label } : {
						label,
						description
					});
				});
			}
		}
		questions.push({
			id: questionId,
			header: header.slice(0, MAX_QUESTION_HEADER_LENGTH),
			question: text.slice(0, MAX_QUESTION_TEXT_LENGTH),
			multiSelect: question.multiSelect === true,
			options
		});
	});
	return questions;
}
/**
* 解析一个 join 节点（并发汇合屏障）：它本身不建会话、不产出结果，只等待
* `inputs` 里列出的任务节点全部完成后放行一次，沿唯一一条出边继续。
*
* join 的入边不是节点图上的 `next`，而是 `inputs`（任务节点 id 列表），所以一个
* 任务可以同时被多个 join 引用；出边恰好一条，`prompt` 是下游机器人进入时的
* 指令（与 start 一致）。join 没有 output / robot / questions。
*
* @param raw 原始节点
* @param id 节点 id
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的 join 节点
*/
function parseJoinNode(raw, id, path, fail) {
	rejectOutputOnFixedNode(raw, path, fail);
	rejectModeOnFixedNode(raw, path, fail);
	if (raw.robot !== void 0) fail(`${path}.robot`, "is only supported on robot nodes");
	if (raw.summary !== void 0) fail(`${path}.summary`, "is only supported on robot nodes");
	if (raw.prompt !== void 0 && raw.prompt !== null) fail(`${path}.prompt`, "a join node does not carry a prompt; define it on the single outgoing edge");
	if (raw.questions !== void 0) fail(`${path}.questions`, "is only supported on user nodes");
	const inputs = [];
	if (!Array.isArray(raw.inputs) || raw.inputs.length === 0) fail(`${path}.inputs`, "must be a non-empty array of node ids this join waits for");
	else {
		const seen = /* @__PURE__ */ new Set();
		raw.inputs.forEach((input, index) => {
			const inputPath = `${path}.inputs[${index}]`;
			const name = typeof input === "string" ? input.trim() : "";
			if (!NODE_ID_PATTERN.test(name)) fail(inputPath, "must be a valid node id");
			else if (seen.has(name)) fail(inputPath, `duplicate input "${name}"; a join cannot wait for the same node twice`);
			else {
				seen.add(name);
				inputs.push(name);
			}
		});
	}
	const next = parseEdgeList(raw.next, `${path}.next`, fail, { allowString: false });
	if (next.length !== 1) fail(`${path}.next`, "a join node needs exactly one outgoing edge");
	return {
		id,
		type: "join",
		inputs,
		next
	};
}
/**
* @param raw 原始节点
* @param id 节点 id
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的终止节点
*/
function parseEndNode(raw, id, path, fail) {
	rejectOutputOnFixedNode(raw, path, fail);
	rejectModeOnFixedNode(raw, path, fail);
	const status = typeof raw.status === "string" ? raw.status : void 0;
	if (raw.status !== void 0 && (status === void 0 || !END_STATUSES$1.has(status))) fail(`${path}.status`, "must be \"completed\", \"failed\" or \"rejected\"");
	return {
		id,
		type: "end",
		status: status !== void 0 && END_STATUSES$1.has(status) ? status : "completed"
	};
}
/**
* 解析机器人节点可选使用的模型路由。
*
* @param raw 原始 agentOptions
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @returns 规范化后的模型路由；没有时是 `undefined`
*/
function parseAgentOptions(raw, path, fail) {
	if (raw === void 0 || raw === null) return void 0;
	if (!isPlainObject(raw)) {
		fail(path, "must be an object");
		return;
	}
	const allowed = /* @__PURE__ */ new Set([
		"provider",
		"model",
		"reasoningEffort",
		"maxTokens"
	]);
	const options = {};
	for (const key of Object.keys(raw)) {
		if (!allowed.has(key)) {
			fail(`${path}.${key}`, "is not a supported agent option");
			continue;
		}
		const value = raw[key];
		if (key === "maxTokens") {
			if (typeof value !== "number" || !Number.isInteger(value) || value < 1) fail(`${path}.${key}`, "must be a positive integer");
			else options.maxTokens = value;
			continue;
		}
		if (typeof value !== "string" || value.trim() === "") {
			fail(`${path}.${key}`, "must be a non-empty string");
			continue;
		}
		if (key === "provider") options.provider = value.trim();
		else if (key === "model") options.model = value.trim();
		else options.reasoningEffort = value.trim();
	}
	return Object.keys(options).length > 0 ? options : void 0;
}
/**
* 解析节点出口：边对象数组（省略表示没有出边）。
*
* 机器人节点、用户节点和 start 节点都不接受字符串简写；每条边上的 `name`
* 是路由键，离开机器人 / 用户节点时必须唯一且非空。用户节点的边还额外要求
* `label`（显示给用户的选项文字）唯一，并支持 `description`。
*
* @param raw 原始 next
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @param options 是否允许字符串简写、是否要求 name / label
* @returns 规范化后的出边列表
*/
function parseEdgeList(raw, path, fail, { allowString, requireNames = false, userEdges = false }) {
	if (raw === void 0 || raw === null) return [];
	if (typeof raw === "string") {
		if (!allowString) {
			fail(path, "must be an array of edges { to, name, prompt }; the string shorthand was removed in workflow format 2");
			return [];
		}
		const to = raw.trim();
		if (to === "") {
			fail(path, "must be a non-empty node id");
			return [];
		}
		return [{ to }];
	}
	if (!Array.isArray(raw)) {
		fail(path, allowString ? "must be a node id, an array of edges, or omitted" : "must be an array of edges { to, name, prompt }");
		return [];
	}
	const rules = [];
	const names = /* @__PURE__ */ new Set();
	const labels = /* @__PURE__ */ new Set();
	raw.forEach((rule, index) => {
		const rulePath = `${path}[${index}]`;
		if (!isPlainObject(rule)) {
			fail(rulePath, "must be an object");
			return;
		}
		if (rule.when !== void 0) fail(`${rulePath}.when`, WHEN_REMOVED);
		const to = typeof rule.to === "string" ? rule.to.trim() : "";
		if (to === "") fail(`${rulePath}.to`, "must be a non-empty node id");
		const edge = { to };
		parseEdgeExtras(edge, rule, rulePath, fail, userEdges);
		if (requireNames) {
			const rawName = rule.name;
			const hasInvalidName = rawName !== void 0 && rawName !== null && typeof rawName !== "string";
			if (edge.name === void 0 && !hasInvalidName) fail(`${rulePath}.name`, userEdges ? "every edge leaving a user node needs a unique non-empty name; it is the route key for this choice" : "every edge leaving a robot node needs a unique non-empty name; the robot returns it as the JSON \"next\" route");
			else if (typeof edge.name === "string") {
				if (names.has(edge.name)) fail(`${rulePath}.name`, `duplicate edge name "${edge.name}" on the same node; the JSON "next" route must be unambiguous`);
				else names.add(edge.name);
			}
		}
		if (userEdges) {
			const rawLabel = rule.label;
			const hasInvalidLabel = rawLabel !== void 0 && rawLabel !== null && typeof rawLabel !== "string";
			if (edge.label === void 0 && !hasInvalidLabel) fail(`${rulePath}.label`, "every edge leaving a user node needs a non-empty label: the option text the user sees");
			else if (typeof edge.label === "string") {
				if (labels.has(edge.label)) fail(`${rulePath}.label`, `duplicate option label "${edge.label}" on the same node; the user choice must be unambiguous`);
				else labels.add(edge.label);
			}
		}
		rules.push(edge);
	});
	return rules;
}
/**
* 解析边上的可选字段：`name`（路由键 / 悬停展示）、`prompt`（进入目标节点时的
* 提示词）、`tone`（成功 / 失败的外观色，纯展示），以及用户节点出边专用的
* `label` / `description`。
*
* @param edge 正在构建的边
* @param raw 原始边对象
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @param userEdges 是否允许用户节点的选项字段
* @returns 同一个边对象
*/
function parseEdgeExtras(edge, raw, path, fail, userEdges = false) {
	if (raw.name !== void 0 && raw.name !== null && typeof raw.name !== "string") fail(`${path}.name`, "must be a string");
	else if (typeof raw.name === "string") {
		const name = raw.name.trim();
		if (name.length > 120) fail(`${path}.name`, `must be at most 120 characters`);
		if (name !== "") edge.name = name;
	}
	if (raw.prompt !== void 0 && raw.prompt !== null && typeof raw.prompt !== "string") fail(`${path}.prompt`, "must be a string");
	else if (typeof raw.prompt === "string" && raw.prompt.trim() !== "") {
		if (Buffer.byteLength(raw.prompt, "utf8") > 262144) fail(`${path}.prompt`, `must be at most ${Math.round(MAX_PROMPT_BYTES / 1024)} KiB`);
		edge.prompt = raw.prompt;
	}
	if (raw.tone !== void 0 && raw.tone !== null) {
		const tone = typeof raw.tone === "string" ? raw.tone.trim() : "";
		if (!EDGE_TONES.has(tone)) fail(`${path}.tone`, "must be \"success\" or \"failure\"");
		else edge.tone = "success" === tone ? "success" : "failure";
	}
	if (!userEdges && (raw.label !== void 0 || raw.description !== void 0)) {
		fail(`${path}.label`, "label / description are only supported on edges leaving a user node");
		return edge;
	}
	if (userEdges) {
		if (raw.label !== void 0 && raw.label !== null && typeof raw.label !== "string") fail(`${path}.label`, "must be a string");
		else if (typeof raw.label === "string") {
			const label = raw.label.trim();
			if (label === "") fail(`${path}.label`, "must be a non-empty label");
			else if (label.length > 120) fail(`${path}.label`, `must be at most 120 characters`);
			else edge.label = label;
		}
		if (raw.description !== void 0 && raw.description !== null && typeof raw.description !== "string") fail(`${path}.description`, "must be a string");
		else if (typeof raw.description === "string" && raw.description.trim() !== "") {
			const description = raw.description.trim();
			if (description.length > 500) fail(`${path}.description`, `must be at most 500 characters`);
			else edge.description = description;
		}
	}
	return edge;
}
/**
* start / user / end 节点的输出由引擎定义，不接受 `output`。
*
* @param raw 原始节点
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
*/
function rejectOutputOnFixedNode(raw, path, fail) {
	if (raw.output === void 0) return;
	fail(`${path}.output`, "is only supported on robot nodes; start, user and end nodes have fixed outputs");
}
/**
* 会话模式只属于机器人节点：其它节点的执行由引擎定义，不接受 `mode`。
*
* @param raw 原始节点
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
*/
function rejectModeOnFixedNode(raw, path, fail) {
	if (raw.mode === void 0) return;
	fail(`${path}.mode`, "is only supported on robot nodes");
}
/**
* 收集所有需要做模板引用校验的文本：边 prompt 与用户节点的 detail。
*
* @param nodes 节点表
* @param order 节点声明顺序
* @returns 需要校验的模板文本
*/
function promptTemplates(nodes, order) {
	const templates = [];
	for (const [index, id] of order.entries()) {
		const node = nodes.get(id);
		for (const [ruleIndex, rule] of (node?.next ?? []).entries()) {
			if (typeof rule.prompt !== "string" || rule.prompt === "") continue;
			templates.push({
				template: rule.prompt,
				path: `nodes[${index}].next[${ruleIndex}].prompt`
			});
		}
		if (node?.type === "user" && typeof node.detail === "string" && node.detail !== "") templates.push({
			template: node.detail,
			path: `nodes[${index}].detail`
		});
	}
	return templates;
}
/**
* 校验边 prompt 与用户节点 detail 里的模板变量。
*
* 只检查「引用的节点存在、字段在目标节点的 output / 用户回答里、节点类型匹配」，
* 不推断这个节点在这条边上是否已经执行过——那属于运行时。
*
* @param nodes 节点表
* @param templates 需要校验的模板文本
* @param fail 记录错误的回调
*/
function validatePromptReferences(nodes, templates, fail) {
	for (const { template, path } of templates) {
		const inspected = inspectTemplate(template);
		if (inspected.errors.length > 0) {
			for (const message of inspected.errors) fail(path, message);
			continue;
		}
		for (const placeholder of inspected.paths) {
			const problem = referenceProblem(nodes, placeholder);
			if (problem !== null) fail(path, problem);
		}
	}
}
/**
* 单个模板路径的引用检查。
*
* @param nodes 节点表
* @param path 模板路径
* @returns 没有问题时为 `null`，否则是可以拼进错误信息的原因片段
*/
function referenceProblem(nodes, path) {
	const segments = path.split(".");
	const root = segments[0];
	if (root === "goal" || root === "step" || root === "runId") {
		if (segments.length === 1) return null;
		return `template path "${path}" cannot be descended into: "${root}" is not an object`;
	}
	if (root !== "nodes") return `unknown template path "${path}"; available: {{goal}}, {{step}}, {{runId}}, {{nodes.<id>...}}`;
	if (segments.length < 3) return `template path "${path}" is incomplete; use {{nodes.<id>.<field>}}`;
	const id = segments[1];
	const node = nodes.get(id);
	if (node === void 0) return `template path "${path}" references unknown node "${id}"`;
	if (node.type === "join") return `template path "${path}" references join node "${id}", which provides no output; a join is a pure barrier`;
	const field = segments[2];
	const rest = segments.slice(3);
	const robotOnly = () => `template path "${path}" reads "${field}", which only robot nodes provide`;
	const userOnly = () => `template path "${path}" reads "${field}", which only user nodes provide`;
	if (field === "data") {
		if (node.type !== "robot") return robotOnly();
		if (rest.length === 0) return null;
		if (rest[0] === "next") return `template path "${path}" uses reserved field "next"; use {{nodes.${id}.route}}`;
		if (rest[0] === "attachments") return `template path "${path}" uses reserved field "attachments"; use {{nodes.${id}.attachments.<index>...}}`;
		if (node.output === void 0 || node.output === null) return `template path "${path}" cannot be checked because node "${id}" has no declared output schema`;
		const reason = resolveOutputPath(node.output, rest);
		if (reason === null) return null;
		return `template path "${path}" ${reason} in node "${id}".output`;
	}
	if (field === "attachments") return node.type === "robot" ? null : robotOnly();
	if (field === "answers") {
		if (node.type !== "user") return userOnly();
		if (rest.length === 0) return null;
		const questionId = rest[0];
		const declared = new Set((Array.isArray(node.questions) ? node.questions : []).map((question) => question.id));
		const hasRoute = Array.isArray(node.next) && node.next.length > 0;
		if (questionId === "route") {
			if (!hasRoute) return `template path "${path}" reads the reserved route answer, but node "${id}" has no choices`;
		} else if (!declared.has(questionId)) return `template path "${path}" references unknown question id "${questionId}" on node "${id}"; available: ${[hasRoute ? ROUTE_QUESTION_ID : null, ...declared].filter(Boolean).join(", ")}`;
		if (rest.length === 1) return null;
		if (rest[1] !== "selected" && rest[1] !== "custom") return `template path "${path}" reads "${rest[1]}", which is not an answer field; use .selected or .custom`;
		if (rest.length > 2) return `template path "${path}" descends into "${rest[1]}", which is not an object`;
		return null;
	}
	if (field === "text" || field === "route") {
		if (node.type !== "robot" && node.type !== "user") return `template path "${path}" reads "${field}", which only robot and user nodes provide`;
		if (rest.length > 0) return `template path "${path}" descends into "${field}", which is not an object`;
		return null;
	}
	if (field === "robot" || field === "sessionId") {
		if (node.type !== "robot") return robotOnly();
		if (rest.length > 0) return `template path "${path}" descends into "${field}", which is not an object`;
		return null;
	}
	if (field === "decision") return "template path \"" + path + "\" reads \"decision\" from the removed gate node; use a user node and read {{nodes.<id>.route}} / {{nodes.<id>.answers.<questionId>...}}";
	return `template path "${path}" uses unknown node output "${field}"; available: text, data, route, attachments, robot, sessionId (robot), text, route, answers (user)`;
}
/**
* 读取可选正整数。
*
* @param raw 原始值
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @param max 上限
* @returns 合法时是正整数，否则 `undefined`
*/
function parsePositiveInteger(raw, path, fail, max) {
	if (raw === void 0 || raw === null) return void 0;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
		fail(path, "must be a positive integer");
		return;
	}
	if (raw > max) {
		fail(path, `must be at most ${max}`);
		return max;
	}
	return raw;
}
/** 节点中心之间的水平步长（px）。 */
const PITCH = 300;
/** 相邻两层节点中心之间的垂直步长（px）。 */
const LAYER_PITCH = 84;
/** 侧边 lane 与同层横穿线的圆角半径（px）。 */
const CORNER = 12;
/**
* 保留两位小数，让坐标与 SVG 路径在测试里稳定可比。
*
* @param value 原始值
* @returns 保留两位小数后的值
*/
function round(value) {
	return Math.round(value * 100) / 100;
}
/** 终止节点允许的最终状态。 */
const END_STATUSES = /* @__PURE__ */ new Set([
	"completed",
	"failed",
	"rejected"
]);
/** 卡片上最终文本 / 任务预览的最大字符数。 */
const PREVIEW_LIMIT = 160;
/**
* 把多行文本压成一行预览。
*
* @param value 原始值
* @param limit 字符上限
* @returns 单行预览
*/
function previewLine(value, limit) {
	if (typeof value !== "string") return "";
	const collapsed = value.replace(/\s+/gu, " ").trim();
	if (collapsed === "") return "";
	if (collapsed.length <= limit) return collapsed;
	return `${collapsed.slice(0, Math.max(0, limit - 1))}…`;
}
/** 节点类型。 */
const NODE_TYPES = /* @__PURE__ */ new Set([
	"start",
	"robot",
	"user",
	"join",
	"end"
]);
/**
* 读取定义快照里的节点表。
*
* 优先用 `plan`（宿主校验后的规范化结果），退回原始 `definition`。
* 两者都没有时返回 null，调用方会用 steps 兜底。
*
* @param definition 运行记录里的定义快照
* @returns 起始节点与规范化后的节点表；没有可用定义时是 `null`
*/
function readDefinitionNodes(definition) {
	if (!isPlainObject(definition)) return null;
	const plan = isPlainObject(definition.plan) ? definition.plan : null;
	if (plan !== null && isPlainObject(plan.nodes)) {
		const planNodes = plan.nodes;
		const ids = Array.isArray(plan.order) ? plan.order.filter((id) => typeof id === "string" && isPlainObject(planNodes[id])) : Object.keys(planNodes);
		const nodes = [];
		const seen = /* @__PURE__ */ new Set();
		for (const id of ids) {
			if (seen.has(id)) continue;
			seen.add(id);
			nodes.push(normalizeNode(id, planNodes[id]));
		}
		if (nodes.length > 0) return {
			start: typeof plan.start === "string" && plan.start !== "" ? plan.start : nodes[0]?.id ?? null,
			nodes
		};
	}
	const raw = isPlainObject(definition.definition) ? definition.definition : null;
	if (raw === null || !Array.isArray(raw.nodes)) return null;
	const nodes = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of raw.nodes) {
		if (!isPlainObject(item)) continue;
		const id = typeof item.id === "string" ? item.id.trim() : "";
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		nodes.push(normalizeNode(id, item));
	}
	if (nodes.length === 0) return null;
	const startNode = nodes.find((node) => node.type === "start");
	return {
		start: typeof raw.start === "string" && raw.start !== "" ? raw.start : startNode?.id ?? nodes[0]?.id ?? null,
		nodes
	};
}
/**
* 规范化一个节点，只保留展示与路由需要的信息（不含 prompt 正文）。
*
* @param id 节点 id
* @param raw 原始节点
* @returns 规范化后的节点配置
*/
function normalizeNode(id, raw) {
	const type = typeof raw.type === "string" && NODE_TYPES.has(raw.type) ? raw.type : "robot";
	const node = {
		id,
		type
	};
	if (type === "start") {
		node.next = normalizeNext(raw.next);
		return node;
	}
	if (type === "robot") {
		node.robot = typeof raw.robot === "string" ? raw.robot : "";
		node.summary = typeof raw.summary === "string" ? raw.summary : "";
		if (raw.mode === "plan") node.mode = "plan";
		node.task = previewLine(raw.prompt, 160);
		node.next = normalizeNext(raw.next);
		if (Number.isFinite(raw.timeoutMs)) node.timeoutMs = raw.timeoutMs;
		if (Number.isFinite(raw.maxVisits)) node.maxVisits = raw.maxVisits;
		return node;
	}
	if (type === "user") {
		node.title = typeof raw.title === "string" ? raw.title : "";
		node.detail = typeof raw.detail === "string" ? raw.detail : "";
		node.next = normalizeNext(raw.next);
		node.questions = Array.isArray(raw.questions) ? raw.questions : [];
		return node;
	}
	if (type === "join") {
		node.inputs = Array.isArray(raw.inputs) ? raw.inputs : [];
		node.next = normalizeNext(raw.next);
		return node;
	}
	node.endStatus = typeof raw.status === "string" && END_STATUSES.has(raw.status) ? raw.status : "completed";
	return node;
}
/**
* 规范化节点的 `next`：边对象数组（新格式）或字符串 / 字符串数组（旧记录）。
*
* 图模型保留给观测者看的 `name`、用户选项的 `label`、边的 `prompt` 与外观色
* `tone`；路由条件不在这里解析。`tone` 只有 `success` / `failure` 会被保留，
* 旧记录 / 手工改动里的其它值归一成空串（不画颜色）。
*
* @param raw 原始 next
* @returns 规范化后的出边列表
*/
function normalizeNext(raw) {
	if (typeof raw === "string" && raw.trim() !== "") return [{
		to: raw.trim(),
		name: "",
		label: "",
		prompt: "",
		tone: ""
	}];
	if (!Array.isArray(raw)) return [];
	const rules = [];
	for (const rule of raw) {
		if (typeof rule === "string" && rule.trim() !== "") {
			rules.push({
				to: rule.trim(),
				name: "",
				label: "",
				prompt: "",
				tone: ""
			});
			continue;
		}
		if (!isPlainObject(rule)) continue;
		const to = typeof rule.to === "string" ? rule.to.trim() : "";
		if (to === "") continue;
		const tone = typeof rule.tone === "string" ? rule.tone.trim() : "";
		rules.push({
			to,
			name: typeof rule.name === "string" ? rule.name.trim() : "",
			label: typeof rule.label === "string" ? rule.label.trim() : "",
			prompt: typeof rule.prompt === "string" ? rule.prompt : "",
			tone: tone === "success" || tone === "failure" ? tone : ""
		});
	}
	return rules;
}
/**
* 构建图模型（不含坐标）。
*
* @param input `run` / `definition` 是运行记录里的两份快照；`avatars` 是
*   「机器人名 → 头像 id」表（由 robots 服务提供），有值的 robot 节点会带上
*   `avatar`，没有这一项（robots 插件没装 / 机器人已删除）时是 null
* @returns 图模型；没有可用运行记录时是 `null`
*/
function buildRunGraph(input) {
	if (!isPlainObject(input)) return null;
	const run = isPlainObject(input.run) ? input.run : null;
	if (run === null || typeof run.runId !== "string") return null;
	const avatars = isPlainObject(input.avatars) ? input.avatars : null;
	const steps = Array.isArray(run.steps) ? run.steps.filter(isPlainObject) : [];
	const source = readDefinitionNodes(input.definition);
	const configs = /* @__PURE__ */ new Map();
	const order = [];
	let start = null;
	if (source !== null) {
		start = source.start;
		for (const node of source.nodes) {
			if (configs.has(node.id)) continue;
			configs.set(node.id, node);
			order.push(node.id);
		}
	}
	const synthetic = configs.size === 0;
	if (synthetic) {
		for (const step of steps) {
			const id = typeof step.nodeId === "string" ? step.nodeId : "";
			if (id === "" || configs.has(id)) continue;
			configs.set(id, {
				id,
				type: step.type === "user" ? "user" : "robot",
				robot: typeof step.robot === "string" ? step.robot : "",
				next: []
			});
			order.push(id);
		}
		start = order[0] ?? null;
	}
	if (configs.size === 0) return null;
	const stepsByNode = /* @__PURE__ */ new Map();
	for (const step of steps) {
		const id = typeof step.nodeId === "string" ? step.nodeId : "";
		if (id === "" || !configs.has(id)) continue;
		const list = stepsByNode.get(id);
		if (list === void 0) stepsByNode.set(id, [step]);
		else list.push(step);
	}
	const result = isPlainObject(run.result) ? run.result : null;
	const lastNode = typeof result?.lastNode === "string" ? result.lastNode : null;
	const actives = Array.isArray(run.active) ? run.active.filter(isPlainObject) : isPlainObject(run.current) ? [run.current] : [];
	const pendingUser = isPlainObject(run.pendingUser) ? run.pendingUser : null;
	const inputJoins = /* @__PURE__ */ new Map();
	for (const id of order) {
		const config = configs.get(id);
		if (config?.type !== "join") continue;
		for (const input of Array.isArray(config.inputs) ? config.inputs : []) {
			if (typeof input !== "string" || !configs.has(input)) continue;
			const list = inputJoins.get(input);
			if (list === void 0) inputJoins.set(input, [id]);
			else list.push(id);
		}
	}
	/**
	* 节点的出边目标（含 join 的隐式入边：任务 → 引用它的 join）。
	*
	* @param config 节点配置
	* @returns 出边目标 id
	*/
	function targetsOf(config) {
		if (config.type === "start" || config.type === "robot" || config.type === "user" || config.type === "join") {
			const targets = (config.next ?? []).map((rule) => rule.to);
			if (config.type === "robot") targets.push(...inputJoins.get(config.id) ?? []);
			return targets;
		}
		return [];
	}
	const adjacency = new Map(order.map((id) => [id, []]));
	for (const id of order) {
		const config = configs.get(id);
		if (config === void 0) continue;
		adjacency.set(id, targetsOf(config).filter((target) => configs.has(target)));
	}
	const reachable = /* @__PURE__ */ new Map();
	for (const id of order) {
		const seen = /* @__PURE__ */ new Set();
		const queue = [...adjacency.get(id) ?? []];
		while (queue.length > 0) {
			const next = queue.shift();
			if (typeof next !== "string" || seen.has(next)) continue;
			seen.add(next);
			queue.push(...adjacency.get(next) ?? []);
		}
		reachable.set(id, seen);
	}
	const orderIndex = new Map(order.map((id, index) => [id, index]));
	const componentOf = /* @__PURE__ */ new Map();
	const components = [];
	for (const id of order) {
		if (componentOf.has(id)) continue;
		const members = order.filter((other) => !componentOf.has(other) && (other === id || reachable.get(id)?.has(other) === true && reachable.get(other)?.has(id) === true));
		const index = components.length;
		for (const member of members) componentOf.set(member, index);
		components.push(members);
	}
	const componentEdges = components.map(() => /* @__PURE__ */ new Set());
	const indegree = components.map(() => 0);
	for (const id of order) {
		const from = componentOf.get(id);
		for (const target of adjacency.get(id) ?? []) {
			const to = componentOf.get(target);
			if (to === void 0 || to === from || from === void 0) continue;
			if (componentEdges[from]?.has(to) === true) continue;
			componentEdges[from]?.add(to);
			indegree[to] = (indegree[to] ?? 0) + 1;
		}
	}
	const priority = components.map((members) => members.reduce((min, member) => Math.min(min, orderIndex.get(member) ?? Infinity), Infinity));
	const startComponent = start === null ? void 0 : componentOf.get(start);
	if (startComponent !== void 0) priority[startComponent] = -1;
	const ready = [];
	for (let index = 0; index < components.length; index += 1) if (indegree[index] === 0) ready.push(index);
	ready.sort((left, right) => (priority[left] ?? 0) - (priority[right] ?? 0));
	const layoutOrder = [];
	while (ready.length > 0) {
		const index = ready.shift();
		if (index === void 0) break;
		const members = [...components[index] ?? []].sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
		layoutOrder.push(...members);
		for (const next of componentEdges[index] ?? []) {
			indegree[next] = (indegree[next] ?? 0) - 1;
			if (indegree[next] !== 0) continue;
			ready.push(next);
			ready.sort((left, right) => (priority[left] ?? 0) - (priority[right] ?? 0));
		}
	}
	for (const id of order) if (!layoutOrder.includes(id)) layoutOrder.push(id);
	/**
	* 一个节点在这次运行中的状态。
	*
	* @param config 节点配置
	* @returns 节点状态
	*/
	function stateOf(config) {
		if (config.type === "start") return "completed";
		if (config.type === "join" && config.next?.length === 0) return "idle";
		if (pendingUser !== null && pendingUser.nodeId === config.id) return "waiting";
		if (actives.some((active) => active.nodeId === config.id)) return "running";
		const nodeSteps = stepsByNode.get(config.id) ?? [];
		if (nodeSteps.length > 0) {
			const status = nodeSteps[nodeSteps.length - 1]?.status;
			return typeof status === "string" && status !== "" ? status : "completed";
		}
		if (config.type === "end" && lastNode === config.id) return typeof result?.status === "string" ? result.status : "completed";
		return "idle";
	}
	const nodes = layoutOrder.map((id) => {
		const config = configs.get(id);
		const nodeSteps = stepsByNode.get(id) ?? [];
		const lastStep = nodeSteps.length > 0 ? nodeSteps[nodeSteps.length - 1] ?? null : null;
		const unreachable = start !== null && id !== start && reachable.get(start)?.has(id) !== true;
		let durationMs = 0;
		for (const step of nodeSteps) {
			const startedAt = typeof step.startedAt === "number" ? step.startedAt : null;
			const finishedAt = typeof step.finishedAt === "number" ? step.finishedAt : null;
			if (startedAt !== null && finishedAt !== null && finishedAt >= startedAt) durationMs += finishedAt - startedAt;
		}
		return {
			id,
			type: config.type,
			state: stateOf(config),
			unreachable,
			visits: nodeSteps.length,
			lastSeq: typeof lastStep?.seq === "number" ? lastStep.seq : null,
			startedAt: typeof nodeSteps[0]?.startedAt === "number" ? nodeSteps[0].startedAt : null,
			finishedAt: typeof lastStep?.finishedAt === "number" ? lastStep.finishedAt : null,
			durationMs,
			stopReason: typeof lastStep?.stopReason === "string" ? lastStep.stopReason : null,
			sessionId: typeof lastStep?.sessionId === "string" && lastStep.sessionId !== "" ? lastStep.sessionId : null,
			error: typeof lastStep?.error === "string" && lastStep.error !== "" ? lastStep.error : null,
			task: config.type === "robot" ? config.task ?? "" : "",
			summary: config.type === "robot" ? config.summary ?? "" : null,
			outputText: previewLine(lastStep?.text, PREVIEW_LIMIT),
			robot: config.type === "robot" ? config.robot ?? null : null,
			avatar: config.type === "robot" && avatars !== null && typeof config.robot === "string" && typeof avatars[config.robot] === "string" ? avatars[config.robot] : null,
			title: config.type === "user" ? config.title ?? null : null,
			detail: config.type === "user" ? config.detail ?? null : null,
			questions: config.type === "user" ? config.questions ?? [] : null,
			endStatus: config.type === "end" ? config.endStatus ?? null : null,
			timeoutMs: config.type === "robot" && Number.isFinite(config.timeoutMs) ? config.timeoutMs : null,
			maxVisits: config.type === "robot" && Number.isFinite(config.maxVisits) ? config.maxVisits : null,
			mode: config.type === "robot" && config.mode === "plan" ? "plan" : null,
			inputs: config.type === "join" ? config.inputs ?? [] : null,
			next: config.type === "robot" || config.type === "start" || config.type === "user" || config.type === "join" ? config.next : []
		};
	});
	/** 这次运行实际走过的节点顺序（含正在执行的节点）。 */
	const sequence = [];
	const pushSequence = (id) => {
		if (typeof id !== "string" || id === "") return;
		if (sequence[sequence.length - 1] === id) return;
		sequence.push(id);
	};
	for (const step of steps) pushSequence(step.nodeId);
	for (const active of actives) pushSequence(active.nodeId);
	if (pendingUser !== null) pushSequence(pendingUser.nodeId);
	/** 每对相邻节点在这次运行里走了几次；循环会让同一对出现多次。 */
	const pairCounts = /* @__PURE__ */ new Map();
	/**
	* @param from 来源节点 id
	* @param to 目标节点 id
	*/
	function countPair(from, to) {
		const key = `${from}->${to}`;
		pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
	}
	for (let index = 0; index + 1 < sequence.length; index += 1) countPair(sequence[index], sequence[index + 1]);
	if (configs.get(start ?? "")?.type === "start" && sequence.length > 0 && sequence[0] !== start) countPair(start, sequence[0]);
	const last = sequence.length > 0 ? sequence[sequence.length - 1] ?? null : null;
	if (last !== null && lastNode !== null && lastNode !== last) countPair(last, lastNode);
	/**
	* @param from 来源节点 id
	* @param to 目标节点 id
	* @returns 这条边是否属于环
	*/
	function inCycle(from, to) {
		if (from === to) return true;
		return reachable.get(to)?.has(from) === true;
	}
	const edgesByKey = /* @__PURE__ */ new Map();
	/**
	* @param from 来源节点 id
	* @param to 目标节点 id
	* @param kind 边类型
	* @param name 边上写的路由键
	* @param prompt 进入目标节点时要发的提示词（只作诊断，不渲染）
	* @param label 用户节点选项显示给用户的文字
	* @param tone 边上可选的外观色：`success` / `failure`（只用于渲染）
	*/
	function pushEdge(from, to, kind, name, prompt, label, tone) {
		if (from === void 0 || to === void 0) return;
		if (!configs.has(from) || !configs.has(to)) return;
		const key = `${from}->${to}#${kind}`;
		const edgeName = typeof name === "string" ? name.trim() : "";
		const edgePrompt = typeof prompt === "string" ? prompt : "";
		const edgeLabel = typeof label === "string" ? label.trim() : "";
		const edgeTone = tone === "success" || tone === "failure" ? tone : "";
		const existing = edgesByKey.get(key);
		if (existing !== void 0) {
			if (edgeName !== "" && !existing.names.includes(edgeName)) existing.names.push(edgeName);
			if (edgeLabel !== "" && !existing.labels.includes(edgeLabel)) existing.labels.push(edgeLabel);
			if (existing.prompt === "" && edgePrompt !== "") existing.prompt = edgePrompt;
			if (existing.tone === "" && edgeTone !== "") existing.tone = edgeTone;
			return;
		}
		const traversals = pairCounts.get(`${from}->${to}`) ?? 0;
		edgesByKey.set(key, {
			key,
			from,
			to,
			kind,
			names: edgeName === "" ? [] : [edgeName],
			labels: edgeLabel === "" ? [] : [edgeLabel],
			prompt: edgePrompt,
			tone: edgeTone,
			traversed: traversals > 0,
			traversals,
			loop: inCycle(from, to)
		});
	}
	if (synthetic) for (let index = 0; index + 1 < order.length; index += 1) pushEdge(order[index], order[index + 1], "next");
	else for (const id of order) {
		const config = configs.get(id);
		if (config === void 0) continue;
		if (config.type === "robot" || config.type === "start" || config.type === "user" || config.type === "join") for (const rule of config.next ?? []) pushEdge(id, rule.to, "next", rule.name, rule.prompt, rule.label, rule.tone);
		if (config.type === "join") {
			for (const input of Array.isArray(config.inputs) ? config.inputs : []) if (typeof input === "string") pushEdge(input, id, "next", "", "", "");
		}
	}
	return {
		start,
		order: layoutOrder,
		nodes,
		edges: [...edgesByKey.values()]
	};
}
/**
* 计算分层二维节点图的坐标与每条边的 SVG 路径。
*
* 节点按深度分层：只统计「更早节点 → 更晚节点」的前向边做最长路径分层，所以并行
* 分支的自然落在同一排，回边不参与分层。同一层内按父节点横坐标的均值排序并居中，
* 再强制最小间距，得到确定性的横向坐标。连线从节点上 / 下端口进出：相邻层之间的边
* 直接连成直线或贝塞尔曲线，跨多层 / 回边 / 自环按端点位置选择**左侧或右侧**的 lane；
* 同一侧的 lane 按层区间分配，互不重叠。方向箭头画在竖段中点（跨层边）或目标端口
* 前方（相邻层曲线）。
*
* @param graph 图模型
* @returns 布局结果（尺寸、层、坐标与每条边的路径）
*/
function layoutRunGraph(graph) {
	const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	const allEdges = Array.isArray(graph?.edges) ? graph.edges : [];
	const empty = {
		width: 0,
		height: 0,
		nodeWidth: 260,
		nodeHeight: 28,
		layerGap: 56,
		layers: [],
		positions: [],
		edges: []
	};
	if (nodes.length === 0) return empty;
	const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
	const incoming = new Map(nodes.map((node) => [node.id, []]));
	for (const edge of allEdges) {
		if (edge.from === edge.to) continue;
		const fromIndex = indexOf.get(edge.from);
		const toIndex = indexOf.get(edge.to);
		if (fromIndex === void 0 || toIndex === void 0 || fromIndex >= toIndex) continue;
		const list = incoming.get(edge.to);
		if (list !== void 0 && !list.includes(edge.from)) list.push(edge.from);
	}
	const layerOf = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		let layer = 0;
		for (const from of incoming.get(node.id) ?? []) {
			const fromLayer = layerOf.get(from);
			if (typeof fromLayer === "number") layer = Math.max(layer, fromLayer + 1);
		}
		layerOf.set(node.id, layer);
	}
	const byLayer = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		const layer = layerOf.get(node.id) ?? 0;
		const list = byLayer.get(layer);
		if (list === void 0) byLayer.set(layer, [node]);
		else list.push(node);
	}
	const layerIndexes = [...byLayer.keys()].sort((left, right) => left - right);
	const xOf = /* @__PURE__ */ new Map();
	for (const layer of layerIndexes) {
		const desired = (byLayer.get(layer) ?? []).map((node) => {
			const parents = (incoming.get(node.id) ?? []).filter((id) => (layerOf.get(id) ?? layer) < layer);
			if (parents.length === 0) return {
				node,
				desired: (indexOf.get(node.id) ?? 0) * PITCH
			};
			let sum = 0;
			for (const parent of parents) sum += xOf.get(parent) ?? 0;
			return {
				node,
				desired: sum / parents.length
			};
		});
		desired.sort((left, right) => left.desired - right.desired || (indexOf.get(left.node.id) ?? 0) - (indexOf.get(right.node.id) ?? 0));
		let previous = -Infinity;
		const xs = desired.map((item) => {
			const x = Math.max(item.desired, previous + PITCH);
			previous = x;
			return x;
		});
		const shift = desired.reduce((sum, item) => sum + item.desired, 0) / desired.length - xs.reduce((sum, x) => sum + x, 0) / xs.length;
		desired.forEach((item, position) => {
			xOf.set(item.node.id, (xs[position] ?? 0) + shift);
		});
	}
	const yOf = /* @__PURE__ */ new Map();
	for (const layer of layerIndexes) yOf.set(layer, 32 + layer * LAYER_PITCH + 14);
	const contentMinX = Math.min(...nodes.map((node) => (xOf.get(node.id) ?? 0) - 130));
	const contentMaxX = Math.max(...nodes.map((node) => (xOf.get(node.id) ?? 0) + 130));
	const contentCenter = (contentMinX + contentMaxX) / 2;
	/**
	* @param id 节点 id
	* @returns 节点坐标
	*/
	function nodeAt(id) {
		const layer = layerOf.get(id) ?? 0;
		return {
			id,
			layer,
			x: xOf.get(id) ?? 0,
			y: yOf.get(layer) ?? 46
		};
	}
	const sideOf = /* @__PURE__ */ new Map();
	const laneEdges = [];
	for (const edge of allEdges) {
		if (indexOf.get(edge.from) === void 0 || indexOf.get(edge.to) === void 0) continue;
		const from = nodeAt(edge.from);
		const to = nodeAt(edge.to);
		if (to.layer - from.layer === 1) {
			sideOf.set(edge.key, "center");
			continue;
		}
		const side = (from.x + to.x) / 2 < contentCenter ? "left" : "right";
		sideOf.set(edge.key, side);
		const start = Math.min(from.layer, to.layer);
		const end = from.layer === to.layer ? start + .5 : Math.max(from.layer, to.layer);
		laneEdges.push({
			edge,
			from,
			to,
			side,
			start,
			end,
			span: end - start
		});
	}
	laneEdges.sort((left, right) => left.span - right.span || left.start - right.start || (indexOf.get(left.edge.from) ?? 0) - (indexOf.get(right.edge.from) ?? 0));
	const occupied = {
		left: [],
		right: []
	};
	const laneOf = /* @__PURE__ */ new Map();
	for (const item of laneEdges) {
		const list = occupied[item.side];
		let lane = 1;
		while (list.some((other) => other.lane === lane && other.start < item.end && item.start < other.end)) lane += 1;
		list.push({
			lane,
			start: item.start,
			end: item.end
		});
		laneOf.set(item.edge.key, lane);
	}
	const maxLeft = occupied.left.reduce((max, item) => Math.max(max, item.lane), 0);
	const maxRight = occupied.right.reduce((max, item) => Math.max(max, item.lane), 0);
	const leftLaneX = (lane) => contentMinX - 32 - (lane - 1) * 14;
	const rightLaneX = (lane) => contentMaxX + 32 + (lane - 1) * 14;
	const leftEdge = contentMinX - 32 - Math.max(0, maxLeft - 1) * 14 - 32;
	const rightEdge = contentMaxX + 32 + Math.max(0, maxRight - 1) * 14 + 32;
	const shiftX = -leftEdge;
	const width = rightEdge - leftEdge;
	const height = (layerIndexes[layerIndexes.length - 1] ?? 0) * LAYER_PITCH + 28 + 64;
	const positions = nodes.map((node) => {
		const layer = layerOf.get(node.id) ?? 0;
		return {
			id: node.id,
			layer,
			x: round((xOf.get(node.id) ?? 0) + shiftX),
			y: round(yOf.get(layer) ?? 46)
		};
	});
	const positionById = new Map(positions.map((position) => [position.id, position]));
	const layers = layerIndexes.map((index) => ({
		index,
		y: round(yOf.get(index) ?? 0)
	}));
	const edges = allEdges.map((edge) => {
		const from = positionById.get(edge.from);
		const to = positionById.get(edge.to);
		if (from === void 0 || to === void 0) return {
			...edge,
			lane: 0,
			side: "center",
			d: "",
			arrow: null
		};
		const side = sideOf.get(edge.key) ?? "center";
		const lane = laneOf.get(edge.key) ?? 0;
		let laneX = 0;
		if (side === "left") laneX = round(leftLaneX(lane) + shiftX);
		else if (side === "right") laneX = round(rightLaneX(lane) + shiftX);
		return {
			...edge,
			lane,
			side,
			...edgeGeometry(from, to, side, laneX)
		};
	});
	return {
		width: round(width),
		height: round(height),
		nodeWidth: 260,
		nodeHeight: 28,
		layerGap: 56,
		layers,
		positions,
		edges
	};
}
/**
* 一条边的路径与方向箭头位置。
*
* - 相邻层：同一横坐标直连；不同横坐标用贝塞尔曲线，从源节点底部进入目标顶部。
* - 侧边 lane：从端口出发先圆角拐到 lane，再竖直到目标附近拐入端口；箭头在竖段中点。
* - 自环：从节点顶部绕同侧 lane 回到节点底部。
* - 同层非自环：从上方绕过整行。箭头方向由路径方向决定。
*
* @param from 来源节点坐标
* @param to 目标节点坐标
* @param side 走线位置
* @param laneX lane 的横坐标
* @returns SVG 路径与箭头位置
*/
function edgeGeometry(from, to, side, laneX) {
	const half = 14;
	if (side === "center") {
		const start = {
			x: from.x,
			y: from.y + half
		};
		const end = {
			x: to.x,
			y: to.y - half
		};
		if (start.x === end.x) return {
			d: `M${round(start.x)},${round(start.y)} L${round(end.x)},${round(end.y)}`,
			arrow: {
				x: round(start.x),
				y: round((start.y + end.y) / 2),
				angle: 90
			}
		};
		const middleY = (start.y + end.y) / 2;
		return {
			d: `M${round(start.x)},${round(start.y)} C${round(start.x)},${round(middleY)} ${round(end.x)},${round(middleY)} ${round(end.x)},${round(end.y)}`,
			arrow: {
				x: round(end.x),
				y: round(end.y - Math.min(12, (end.y - start.y) / 2)),
				angle: 90
			}
		};
	}
	const x = round(laneX);
	if (from.id === to.id) {
		const top = {
			x: from.x,
			y: from.y - half
		};
		const bottom = {
			x: from.x,
			y: from.y + half
		};
		return {
			d: `M${round(top.x)},${round(top.y)} C${x},${round(top.y - 18)} ${x},${round(bottom.y + 18)} ${round(bottom.x)},${round(bottom.y)}`,
			arrow: {
				x,
				y: round(from.y),
				angle: 90
			}
		};
	}
	if (to.layer === from.layer) {
		const above = round(from.y - half - 20);
		const start = {
			x: from.x,
			y: from.y - half
		};
		const end = {
			x: to.x,
			y: to.y - half
		};
		return {
			d: `M${round(start.x)},${round(start.y)} C${round(start.x)},${above} ${x},${above} ${x},${above} L${round(end.x)},${above} C${round(end.x)},${above} ${round(end.x)},${round(end.y)} ${round(end.x)},${round(end.y)}`,
			arrow: {
				x: round((start.x + end.x) / 2),
				y: above,
				angle: end.x > start.x ? 0 : 180
			}
		};
	}
	if (to.layer > from.layer) {
		const start = {
			x: from.x,
			y: from.y + half
		};
		const end = {
			x: to.x,
			y: to.y - half
		};
		return {
			d: `M${round(start.x)},${round(start.y)} C${round(start.x)},${round(start.y + CORNER)} ${x},${round(start.y + CORNER)} ${x},${round(start.y + 24)} L${x},${round(end.y - 24)} C${x},${round(end.y - CORNER)} ${round(end.x)},${round(end.y - CORNER)} ${round(end.x)},${round(end.y)}`,
			arrow: {
				x,
				y: round((start.y + end.y) / 2),
				angle: 90
			}
		};
	}
	const start = {
		x: from.x,
		y: from.y - half
	};
	const end = {
		x: to.x,
		y: to.y + half
	};
	return {
		d: `M${round(start.x)},${round(start.y)} C${round(start.x)},${round(start.y - CORNER)} ${x},${round(start.y - CORNER)} ${x},${round(start.y - 24)} L${x},${round(end.y + 24)} C${x},${round(end.y + CORNER)} ${round(end.x)},${round(end.y + CORNER)} ${round(end.x)},${round(end.y)}`,
		arrow: {
			x,
			y: round((start.y + end.y) / 2),
			angle: -90
		}
	};
}
/**
* 把一份抽象工作流模板画成图模型（不含坐标）。
*
* 模板不是运行：没有 steps / current / pendingUser，所以复用 `buildRunGraph` 的
* 拓扑排序、成环合并与边合并，用一个「空运行」喂进去。得到节点后统一改成
* `idle` 状态（start 也不再标成 completed），让图读作「静态参考结构」而不是
* 「执行进度」。调用方再把结果交给 `layoutRunGraph` 计算分层坐标与 SVG 路径。
*
* @param template 模板对象（含 `id` 与 `nodes`）
* @returns 图模型；模板没有节点时是 `null`
*/
function buildTemplateGraph(template) {
	const nodes = isPlainObject(template) && Array.isArray(template.nodes) ? template.nodes : [];
	if (nodes.length === 0) return null;
	const model = buildRunGraph({
		run: { runId: `template:${isPlainObject(template) && typeof template.id === "string" ? template.id : ""}` },
		definition: { definition: { nodes } },
		avatars: null
	});
	if (model === null) return null;
	model.nodes = model.nodes.map((node) => ({
		...node,
		state: "idle",
		visits: 0,
		unreachable: false
	}));
	return model;
}
// .build/workflows/http.js
/**
* HTTP 小工具：响应写出、请求体读取与附件流式下载。
*/
/** 设置请求体上限：只有几个字段。 */
const MAX_BODY_BYTES = 8192;
/**
* 把附件文件写进响应：默认下载，`inline` 时按给定 MIME 内联并附带安全头。
*
* @param res HTTP 响应
* @param attachment 清单里的附件
* @param options 内联 / MIME / 日志
*/
function pipeAttachment(res, attachment, options = {}) {
	res.statusCode = 200;
	res.setHeader("content-type", options.mime ?? "application/octet-stream");
	res.setHeader("content-length", String(attachment.bytes));
	res.setHeader("content-disposition", attachmentDisposition(attachment.name, options.inline === true));
	res.setHeader("x-content-type-options", "nosniff");
	res.setHeader("cache-control", "no-store");
	if (options.mime === "image/svg+xml") res.setHeader("content-security-policy", "script-src 'none'; object-src 'none'");
	const stream = createReadStream(attachment.path);
	res.on("close", () => stream.destroy());
	stream.on("error", (error) => {
		options.log?.(error);
		if (!res.headersSent) sendError(res, 500, "read-failed", "attachment could not be read");
		else res.destroy(error);
	});
	stream.pipe(res);
}
/**
* 附件的响应头：ASCII 回退 + 完整 UTF-8 文件名。
*
* @param name 文件名
* @param inline 是否内联展示（预览）而不是下载
* @returns content-disposition 值
*/
function attachmentDisposition(name, inline = false) {
	const ascii = name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
	const encoded = encodeURIComponent(name).replace(/'/gu, "%27");
	return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
/**
* 设置对象 → 浏览器用的平铺字段。页面不关心 `version` 与内部包装。
*
* @param settings 设置
* @returns 平铺字段
*/
function settingsPayload(settings) {
	return {
		enabled: settings.archive.enabled,
		archiveAfterHours: settings.archive.archiveAfterHours,
		deleteAfterHours: settings.archive.deleteAfterHours
	};
}
/**
* 读取 JSON 请求体；content-type 不对、太大或不是合法 JSON 时已经写好响应，
* 返回 undefined。
*
* @param req HTTP 请求
* @param res HTTP 响应
* @returns 解析后的值；失败时是 undefined
*/
async function readJsonBody(req, res) {
	if (String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		sendError(res, 415, "invalid-content-type", "content-type 必须是 application/json");
		return;
	}
	const text = await readBoundedBody(req);
	if (text === null) {
		sendError(res, 413, "too-large", "请求体过大");
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
* 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
*
* @param req HTTP 请求
* @returns 请求体文本；过大时是 null
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
/**
* 查询参数里的条数上限。
*
* @param value limit 参数
* @returns 条数上限
*/
function parseLimit(value) {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isInteger(parsed) || parsed < 1) return 50;
	return Math.min(parsed, 100);
}
/**
* 发送 JSON 响应。
*
* @param res HTTP 响应
* @param status 状态码
* @param payload 响应体
*/
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}
/**
* 统一的失败响应：`{ ok: false, code, message }`。
*
* @param res HTTP 响应
* @param status 状态码
* @param code 错误码
* @param message 错误文案
*/
function sendError(res, status, code, message) {
	sendJson(res, status, {
		ok: false,
		code,
		message
	});
}
/**
* 405 并带上唯一支持的方法。
*
* @param res HTTP 响应
* @param allow 允许的方法
*/
function sendMethodNotAllowed(res, allow) {
	res.statusCode = 405;
	res.setHeader("allow", allow);
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify({
		ok: false,
		code: "method-not-allowed",
		message: `only ${allow} is supported`
	}));
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
/**
* 读一个 JSON 文件；文件缺失、不可读、不是合法 JSON 或内容不是对象时返回 null。
*
* 只接受「普通对象」：数组、`null` 与标量都按读不到处理，调用方据此回落到
* 默认值。需要区分「文件缺失」与「文件损坏」的调用方保留自己的读取逻辑。
*
* @param file 目标文件
* @returns 解析后的 JSON 对象；缺失 / 损坏时是 `null`
*/
async function readJsonFile(file) {
	try {
		const text = await promises.readFile(file, "utf8");
		const value = JSON.parse(text);
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}
// .build/workflows/settings.js
/**
* 工作流插件的设置：运行记录的自动归档策略。
*
* 设置文件放在运行目录的父目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/settings.json`，
* 即 `runs/` 的同级。它和运行记录分开：删运行不会碰设置，换 `runsDir`
* （Config）时设置跟着新的运行目录走。原子写、权限 0600；文件缺失或损坏时
* 按默认值处理，页面照常可用，下一次保存会把文件重建成合法内容。
*
* 默认策略：结束超过 24 小时（1 天）的运行归档，超过 168 小时（7 天）的
* 运行连同目录一起删除。时间按整小时填写；删除必须晚于归档，否则删除会
* 先于归档发生，归档就没有意义。
*
* 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-workflows/settings
*/
/** 设置文件名；与 `runs/` 同级。 */
const SETTINGS_FILE = "settings.json";
/** 删除时间上限（小时）：365 天。 */
const MAX_DELETE_HOURS = 8760;
/**
* 由运行目录得到设置文件路径：设置放在 `runs/` 的父目录。
*
* @param runsDir 运行记录根目录
* @returns 设置文件绝对路径
*/
function resolveSettingsFile(runsDir) {
	if (typeof runsDir !== "string" || runsDir.trim() === "") throw new Error("缺少工作流运行目录");
	return path.join(path.dirname(path.resolve(runsDir)), SETTINGS_FILE);
}
/**
* 默认设置；文件缺失 / 损坏时也返回它。
*
* @returns 默认设置
*/
function defaultSettings() {
	return {
		version: 1,
		archive: {
			enabled: true,
			archiveAfterHours: 24,
			deleteAfterHours: 168
		}
	};
}
/**
* 把任意读到的值规范成设置对象。字段不合法时按默认值处理（手改坏了不影响
* 页面）；删除时间回落到不晚于归档时间时，两项一起回落默认值，避免出现
* 「先删除、再归档」的策略。
*
* @param value 任意读到的值
* @returns 规范后的设置
*/
function normalizeSettings(value) {
	const settings = defaultSettings();
	if (value === null || typeof value !== "object" || Array.isArray(value)) return settings;
	const archive = value.archive;
	if (archive === null || typeof archive !== "object" || Array.isArray(archive)) return settings;
	const archiveRecord = archive;
	if (typeof archiveRecord.enabled === "boolean") settings.archive.enabled = archiveRecord.enabled;
	const archiveAfterHours = integerInRange(archiveRecord.archiveAfterHours, 1, 720);
	if (archiveAfterHours !== null) settings.archive.archiveAfterHours = archiveAfterHours;
	const deleteAfterHours = integerInRange(archiveRecord.deleteAfterHours, 2, MAX_DELETE_HOURS);
	if (deleteAfterHours !== null) settings.archive.deleteAfterHours = deleteAfterHours;
	if (settings.archive.deleteAfterHours <= settings.archive.archiveAfterHours) {
		settings.archive.archiveAfterHours = 24;
		settings.archive.deleteAfterHours = 168;
	}
	return settings;
}
/**
* 只规范化归档部分（运行存储直接用它，避免每次再包一层）。
*
* @param value 任意读到的值
* @returns 规范后的归档策略
*/
function normalizeRetention(value) {
	return normalizeSettings({ archive: value }).archive;
}
/**
* 校验页面 / API 传来的归档设置（平铺字段），返回可写盘的设置对象或一条
* 中文错误。只认整小时：归档 1–720、删除 2–8760，且删除必须晚于归档。
*
* @param input 页面 / API 传来的值
* @returns 校验通过时带可写盘的设置，否则带一条中文错误
*/
function validateSettingsInput(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return {
		ok: false,
		message: "设置必须是 JSON 对象"
	};
	const record = input;
	const enabled = record.enabled;
	if (typeof enabled !== "boolean") return {
		ok: false,
		message: "enabled 必须是布尔值"
	};
	const archiveAfterHours = integerInRange(record.archiveAfterHours, 1, 720);
	if (archiveAfterHours === null) return {
		ok: false,
		message: `archiveAfterHours 必须是 1–720 之间的整数小时`
	};
	const deleteAfterHours = integerInRange(record.deleteAfterHours, 2, MAX_DELETE_HOURS);
	if (deleteAfterHours === null) return {
		ok: false,
		message: `deleteAfterHours 必须是 2–${MAX_DELETE_HOURS} 之间的整数小时`
	};
	if (deleteAfterHours <= archiveAfterHours) return {
		ok: false,
		message: "deleteAfterHours 必须大于 archiveAfterHours"
	};
	return {
		ok: true,
		archive: {
			enabled,
			archiveAfterHours,
			deleteAfterHours
		}
	};
}
/**
* 读设置。文件不存在、读不了、不是合法 JSON 或字段不合法都回落到默认值，
* 不抛错：设置是锦上添花，不能因为一个坏文件让页面打不开。
*
* @param options 设置文件绝对路径
* @returns 设置内容与来源文件
*/
async function readSettings({ file } = {}) {
	const target = requireSettingsFile(file);
	return {
		...normalizeSettings(await readJsonFile(target)),
		file: target
	};
}
/**
* 原子写设置（临时文件 + rename，权限 0600）。目录不存在会先建好；失败时
* 清理临时文件，原文件保持不变。
*
* @param options 设置文件路径与要写入的值
* @returns 写入后的设置与来源文件
*/
async function writeSettings({ file, settings } = {}) {
	const target = requireSettingsFile(file);
	const normalized = normalizeSettings(settings);
	await writeJsonAtomic(target, normalized);
	return {
		file: target,
		settings: normalized
	};
}
/**
* @param value 待校验的值
* @param min 下限（含）
* @param max 上限（含）
* @returns 合法时是整数，否则 `null`
*/
function integerInRange(value, min, max) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
	return value;
}
/**
* 校验设置文件路径。
*
* @param file 传入的路径
* @returns 绝对路径
*/
function requireSettingsFile(file) {
	if (typeof file !== "string" || file.trim() === "") throw new Error("缺少工作流设置文件路径");
	return path.resolve(file);
}
// .build/workflows/routes.js
/**
* 浏览器一半的只读路由：运行列表 / 详情 / 附件读取 / 自动归档设置 / 模板目录。
*
* 页面只读取落盘的运行记录，不提供“运行工作流”：workflow 由 agent 在会话里
* 现场创建；唯一的写入口是自动归档设置（settings 文件）。路由沿用 web 组合
* 的信任栅栏，只接受本机、已认证的浏览器请求。
*/
/** 浏览器一半读取运行列表的路由。 */
const RUNS_ROUTE = "/buka-workflows/runs";
/** 浏览器一半读取单次运行详情的路由。 */
const RUN_ROUTE = "/buka-workflows/run";
/** 浏览器一半读取 / 预览节点附件的路由。 */
const ATTACHMENT_ROUTE = "/buka-workflows/attachment";
/** 浏览器一半读 / 写自动归档设置的路由。 */
const SETTINGS_ROUTE = "/buka-workflows/settings";
/** 浏览器一半读取工作流模板目录的路由。 */
const TEMPLATES_ROUTE = "/buka-workflows/templates";
/**
* 注册浏览器一半的所有只读路由。
*
* @param deps 上下文、存储、设置文件路径与初始化函数
*/
function registerWorkflowRoutes({ ctx, store, settingsFile, ensureReady }) {
	ctx.inject(["webServer", "connection"], (webCtx) => {
		/**
		* 复用 web 组合的信任栅栏；被拒绝时已经写好响应。
		*
		* @param req
		* @param res
		* @returns
		*/
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
		/**
		* 读取查询参数。
		*
		* @param req
		* @returns
		*/
		function requestUrl(req) {
			return new URL(req.url ?? "/", "http://localhost");
		}
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: RUNS_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				try {
					await ensureReady();
					const params = requestUrl(req).searchParams;
					const limit = parseLimit(params.get("limit"));
					const archived = params.get("archived") === "1";
					const [runs, archivedCount] = await Promise.all([store.listRuns(limit, { archived }), store.countArchived()]);
					sendJson(res, 200, {
						ok: true,
						runs,
						archivedCount
					});
				} catch (error) {
					webCtx.logger?.warn?.("buka-workflows: 读取运行列表失败：%s", describeError$3(error));
					sendError(res, 500, "list-failed", `读取运行列表失败：${describeError$3(error)}`);
				}
			}
		}), `buka-workflows: GET ${RUNS_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: SETTINGS_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method === "GET") {
					try {
						sendJson(res, 200, {
							ok: true,
							settings: settingsPayload(await readSettings({ file: settingsFile }))
						});
					} catch (error) {
						webCtx.logger?.warn?.("buka-workflows: 读取归档设置失败：%s", describeError$3(error));
						sendError(res, 500, "settings-failed", `读取归档设置失败：${describeError$3(error)}`);
					}
					return;
				}
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "GET, POST");
					return;
				}
				const body = await readJsonBody(req, res);
				if (body === void 0) return;
				const parsed = validateSettingsInput(body);
				if (!parsed.ok) {
					sendError(res, 400, "invalid-settings", parsed.message);
					return;
				}
				try {
					await ensureReady();
					const saved = await writeSettings({
						file: settingsFile,
						settings: {
							version: 1,
							archive: parsed.archive
						}
					});
					store.setRetention(saved.settings.archive);
					await store.sweep();
					webCtx.logger?.info?.("buka-workflows: 自动归档设置已更新（%s，归档 %s 小时，删除 %s 小时）", saved.settings.archive.enabled ? "启用" : "停用", saved.settings.archive.archiveAfterHours, saved.settings.archive.deleteAfterHours);
					sendJson(res, 200, {
						ok: true,
						settings: settingsPayload(saved.settings),
						archivedCount: await store.countArchived()
					});
				} catch (error) {
					webCtx.logger?.warn?.("buka-workflows: 保存归档设置失败：%s", describeError$3(error));
					sendError(res, 500, "settings-failed", `保存归档设置失败：${describeError$3(error)}`);
				}
			}
		}), `buka-workflows: GET/POST ${SETTINGS_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: TEMPLATES_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				try {
					sendJson(res, 200, {
						ok: true,
						templates: listTemplates().map((template) => {
							const model = buildTemplateGraph(template);
							return {
								...template,
								graph: model === null ? null : {
									...model,
									...layoutRunGraph(model)
								}
							};
						})
					});
				} catch (error) {
					webCtx.logger?.warn?.("buka-workflows: 读取工作流模板失败：%s", describeError$3(error));
					sendError(res, 500, "templates-failed", `读取工作流模板失败：${describeError$3(error)}`);
				}
			}
		}), `buka-workflows: GET ${TEMPLATES_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: RUN_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				const runId = requestUrl(req).searchParams.get("runId") ?? "";
				if (runId.trim() === "") {
					sendError(res, 400, "invalid-run-id", "runId is required");
					return;
				}
				try {
					await ensureReady();
					const run = await store.readRun(runId.trim());
					if (run === null) {
						sendError(res, 404, "not-found", `workflow run not found: ${runId}`);
						return;
					}
					const [definition, nodeResults] = await Promise.all([store.readDefinition(run.runId), store.readNodeResults(run.runId)]);
					const model = buildRunGraph({
						run,
						definition,
						avatars: await robotAvatars(ctx)
					});
					sendJson(res, 200, {
						ok: true,
						run,
						definition,
						nodeResults,
						graph: model === null ? null : {
							...model,
							...layoutRunGraph(model)
						}
					});
				} catch (error) {
					webCtx.logger?.warn?.("buka-workflows: 读取运行详情失败：%s", describeError$3(error));
					sendError(res, 500, "read-failed", `读取运行详情失败：${describeError$3(error)}`);
				}
			}
		}), `buka-workflows: GET ${RUN_ROUTE}`);
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: ATTACHMENT_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "GET") {
					sendMethodNotAllowed(res, "GET");
					return;
				}
				const params = requestUrl(req).searchParams;
				const runId = (params.get("runId") ?? "").trim();
				const nodeId = (params.get("nodeId") ?? "").trim();
				const name = params.get("name") ?? "";
				const seq = Number.parseInt(params.get("seq") ?? "", 10);
				const mode = params.get("mode") ?? "download";
				if (mode !== "download" && mode !== "preview" && mode !== "inline") {
					sendError(res, 400, "invalid-mode", "mode must be download, preview or inline");
					return;
				}
				if (runId === "" || nodeId === "" || name === "") {
					sendError(res, 400, "invalid-attachment", "runId, seq, nodeId and name are required");
					return;
				}
				if (!Number.isInteger(seq) || seq <= 0) {
					sendError(res, 400, "invalid-seq", "seq must be a positive integer");
					return;
				}
				if (runId === "." || runId === ".." || runId.includes("/") || runId.includes("\\")) {
					sendError(res, 400, "invalid-run-id", "runId must be a single path segment");
					return;
				}
				try {
					await ensureReady();
					let attachment = null;
					try {
						attachment = await store.openAttachment(runId, seq, nodeId, name);
					} catch {
						attachment = null;
					}
					if (attachment === null) {
						sendError(res, 404, "not-found", "attachment not found");
						return;
					}
					const preview = attachmentPreviewInfo(attachment.name);
					if (mode === "download") {
						pipeAttachment(res, attachment, { log: (error) => webCtx.logger?.warn?.("buka-workflows: 读取附件失败：%s", describeError$3(error)) });
						return;
					}
					if (mode === "inline") {
						if (preview.kind !== "image" && preview.kind !== "pdf") {
							sendError(res, 415, "unsupported-preview", "this attachment type cannot be previewed inline");
							return;
						}
						pipeAttachment(res, attachment, {
							inline: true,
							mime: preview.mime,
							log: (error) => webCtx.logger?.warn?.("buka-workflows: 读取附件失败：%s", describeError$3(error))
						});
						return;
					}
					if (preview.kind !== "text") {
						sendJson(res, 200, {
							ok: true,
							attachment: {
								name: attachment.name,
								bytes: attachment.bytes,
								kind: preview.kind,
								mime: preview.mime
							}
						});
						return;
					}
					const range = await readAttachmentRange(attachment.path, { maxBytes: DEFAULT_PREVIEW_TEXT_BYTES });
					if (range.text === null) {
						sendJson(res, 200, {
							ok: true,
							attachment: {
								name: attachment.name,
								bytes: attachment.bytes,
								kind: "binary",
								mime: null
							}
						});
						return;
					}
					sendJson(res, 200, {
						ok: true,
						attachment: {
							name: attachment.name,
							bytes: attachment.bytes,
							kind: "text",
							mime: "text/plain",
							text: range.text,
							truncated: range.truncated,
							read: range.read,
							offset: range.offset
						}
					});
				} catch (error) {
					webCtx.logger?.warn?.("buka-workflows: 读取附件失败：%s", describeError$3(error));
					if (!res.headersSent) sendError(res, 500, "read-failed", `attachment could not be read: ${describeError$3(error)}`);
					else res.destroy(error);
				}
			}
		}), `buka-workflows: GET ${ATTACHMENT_ROUTE}`);
	});
}
/**
* 取「机器人名 → 头像 id」表，给运行页的节点图用。
*
* robots 插件没装、服务没有 `avatarMap()` 或登记表损坏时返回 null；这只是展示
* 细节，绝不能因为它让运行详情接口失败。
*
* @param ctx 插件上下文
* @returns 机器人名 → 头像 id；不可用时是 null
*/
async function robotAvatars(ctx) {
	try {
		const robots = ctx.get("bukaRobots");
		if (robots === null || robots === void 0 || typeof robots.avatarMap !== "function") return null;
		const map = await robots.avatarMap();
		if (map === null || typeof map !== "object" || Array.isArray(map)) return null;
		return map;
	} catch {
		return null;
	}
}
// .build/workflows/run-attachments.js
/**
* 运行目录里的附件：把节点交回的附件复制进本次执行的节点目录，并按清单读取 /
* 打开。
*
* 低层的文件复制与读取在 attachments.ts；这里只负责运行目录布局
* （`nodes/<seq>-<id>/attachments`）、清单查找与路径安全校验。
*/
/** 每次执行的节点目录里附件目录名。 */
const ATTACHMENTS_DIR = "attachments";
/**
* 把任意错误转成一句话。
*
* @param error 任意错误
* @returns 一句话错误
*/
function describeError$2(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 清单里的附件名必须是一段安全路径；Unicode 文件名允许，分隔符与控制字符
* 不允许。
*
* @param name 清单里的附件名
* @returns 是安全的一段路径时为 true
*/
function isSafeAttachmentName(name) {
	if (typeof name !== "string" || name === "" || name === "." || name === "..") return false;
	if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
	return !/[\u0000-\u001f\u007f]/u.test(name);
}
/**
* @param root 根目录
* @param candidate 待判断的路径
* @returns 在根目录内时为 true
*/
function isInsideDirectory(root, candidate) {
	const relative = path.relative(root, candidate);
	return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
/**
* 把节点返回的附件复制到该次执行的节点目录，返回稳定清单。
*
* @param options 节点目录、运行目录、原始清单与限额
* @returns 稳定清单
*/
async function writeNodeAttachmentsToRun(options) {
	return await writeAttachments({
		raw: options.raw,
		workspace: options.workspace ?? "",
		runDirectory: options.runDirectory,
		destination: path.join(options.nodeDirectory, ATTACHMENTS_DIR),
		maxBytes: options.maxBytes,
		maxTotalBytes: options.maxTotalBytes,
		maxCount: options.maxCount
	});
}
/**
* 把附件清单转成模板上下文：每个附件带绝对路径；文本附件在大小上限内
* 额外带 `text` 供 prompt 内联。
*
* @param options 附件目录、清单与内联上限
* @returns 模板上下文里的附件值
*/
async function attachmentTemplateValues(options) {
	if (!Array.isArray(options.manifest)) return [];
	const directory = options.attachmentsDirectory;
	const values = [];
	for (const [fallbackIndex, rawEntry] of options.manifest.entries()) {
		if (rawEntry === null || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
		const entry = rawEntry;
		const name = typeof entry.name === "string" ? entry.name : "";
		if (!isSafeAttachmentName(name)) continue;
		const index = typeof entry.index === "number" && Number.isInteger(entry.index) ? entry.index : fallbackIndex;
		const file = path.join(directory, name);
		const value = {
			index,
			name,
			bytes: typeof entry.bytes === "number" && Number.isFinite(entry.bytes) ? entry.bytes : 0,
			path: file
		};
		if (typeof entry.description === "string" && entry.description !== "") value.description = entry.description;
		try {
			const inline = await readInlineText(file, options.maxInlineTextBytes);
			if (inline.available) value.text = inline.text;
			else value.text = { __bukaTemplateError: `attachment "${name}" is ${inline.reason === "binary" ? "binary" : "larger than the inline attachment limit"}; use .path or buka_workflow_execution_attachment instead` };
		} catch (error) {
			value.text = { __bukaTemplateError: `attachment "${name}" could not be read: ${describeError$2(error)}` };
		}
		values.push(value);
	}
	return values;
}
/**
* 读取一个附件的一段内容。`name` 必须出现在该次执行的清单里。
*
* @param options 节点结果、节点目录、附件名与读取范围
* @returns 附件的一段内容；找不到时是 `null`
*/
async function readRunAttachment(options) {
	const entry = findAttachmentEntry(options.nodeResult, options.name);
	if (entry === null) return null;
	const entryName = typeof entry.name === "string" ? entry.name : "";
	const file = await attachmentFilePath(options.nodeDirectory, entryName);
	const range = await readAttachmentRange(file, {
		offset: options.offset,
		maxBytes: options.maxBytes
	});
	return {
		index: typeof entry.index === "number" && Number.isInteger(entry.index) ? entry.index : 0,
		name: entryName,
		description: typeof entry.description === "string" ? entry.description : null,
		bytes: range.bytes,
		path: file,
		text: range.text,
		binary: range.binary,
		truncated: range.truncated,
		offset: range.offset,
		read: range.read
	};
}
/**
* 打开一个附件用于下载：只返回清单里的文件，并确认它仍在附件目录内。
*
* @param options 节点结果、节点目录与附件名
* @returns 可下载附件；找不到时是 `null`
*/
async function openRunAttachment(options) {
	const entry = findAttachmentEntry(options.nodeResult, options.name);
	if (entry === null) return null;
	const entryName = typeof entry.name === "string" ? entry.name : "";
	const file = await attachmentFilePath(options.nodeDirectory, entryName);
	return {
		path: file,
		name: entryName,
		bytes: (await promises.stat(file)).size,
		description: typeof entry.description === "string" ? entry.description : null,
		index: typeof entry.index === "number" && Number.isInteger(entry.index) ? entry.index : 0
	};
}
/**
* 在节点结果的附件清单里按名字找一个附件。
*
* @param nodeResult 节点结果
* @param name 附件名
* @returns 清单里的附件项；找不到时是 `null`
*/
function findAttachmentEntry(nodeResult, name) {
	if (typeof name !== "string" || !isSafeAttachmentName(name)) return null;
	const entry = (Array.isArray(nodeResult?.attachments) ? nodeResult.attachments : []).find((item) => item !== null && typeof item === "object" && item.name === name);
	return entry === void 0 ? null : entry;
}
/**
* 附件文件的真实路径；符号链接解析后必须仍在 attachments 目录内。
*
* @param nodeDirectory 该次执行的节点目录
* @param name 附件名
* @returns 真实文件路径
*/
async function attachmentFilePath(nodeDirectory, name) {
	if (!isSafeAttachmentName(name)) throw new Error("invalid attachment name");
	const directory = path.join(nodeDirectory, ATTACHMENTS_DIR);
	const realDirectory = await promises.realpath(directory);
	const realFile = await promises.realpath(path.join(directory, name));
	if (!isInsideDirectory(realDirectory, realFile)) throw new Error(`attachment "${name}" is outside the node attachment directory`);
	if (!(await promises.stat(realFile)).isFile()) throw new Error(`attachment "${name}" is not a regular file`);
	return realFile;
}
// .build/workflows/run-store.js
/**
* 工作流运行的落盘存储。
*
* 每次运行占一个目录，内容如下：
*
* ```text
* runs/sequence.json  运行序号计数器（不是运行目录，只记录下一个序号）
* runs/<runId>/
*   definition.json  本次一次性定义的快照（goal、节点、创建者、时间）
*   run.json         权威状态快照：原子写（临时文件 + rename）
*   events.jsonl     追加事件：node/start、node/end、user/answered、run/end …
*   nodes/<seq>-<id>/
*     result.json       节点结果全文（run.json 里只留预览；机器人会话的只读
*                       工具从这里读某次执行的 prompt / 输出）
*     attachments/      该次执行的附件文件
* ```
*
* 旧记录的 `nodes/<seq>-<id>.json` 仍然可以读取（新执行只写目录布局），
* 所以格式 2 的已有运行不需要迁移或删除。
*
* 每次运行有一个持久递增的序号 `seq`（从 1 开始，写在 run.json 里）：删除旧
* 运行不会让编号回退；启动时会给没有序号的旧记录按创建时间回填，再把计数器
* 推到最大值之后。序号只用于展示与引用，不影响执行。
*
* 运行数据带格式版本（`WORKFLOW_FORMAT_VERSION`）：启动时版本不符、或
* `run.json` / `definition.json` 缺失损坏的运行目录会被整个删除（旧格式没有
* 迁移路径）；全部删光时序号计数器也一起丢掉，下次从 #1 开始。
*
* 未完成的运行由 `WorkflowSupervisor` 在启动时尝试恢复（只续接同一会话，不新开
* 会话）；确实无法恢复时才调用 `markInterrupted`，保留记录供回看。结束的
* 运行按自动归档设置处理：超过归档时间的运行写上 `archivedAt` 并从默认列表
* 隐藏；超过删除时间的运行目录直接删除。仍在运行的记录永远不会被归档或删除；
* `maxRuns` 只限制已归档记录的数量（从最旧的已归档运行开始删）。
*
* @module @buka/dsh-plugin-workflows/run-store
*/
/** 状态快照文件名。 */
const RUN_FILE = "run.json";
/** 定义快照文件名。 */
const DEFINITION_FILE = "definition.json";
/** 事件流文件名。 */
const EVENTS_FILE = "events.jsonl";
/** 节点结果目录名。 */
const NODES_DIR = "nodes";
/** 每次执行的节点目录里结果文件名。 */
const NODE_RESULT_FILE = "result.json";
/** 运行序号计数器文件名；放在 runs 目录里，但不是运行目录。 */
const SEQUENCE_FILE = "sequence.json";
/** 一个小时的毫秒数：归档设置的时间单位。 */
const HOUR_MS = 36e5;
/**
* 把任意错误转成一句话。
*
* @param error 任意错误
* @returns 一句话错误
*/
function describeError$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 判断一条运行记录是否与当前格式不兼容；兼容时返回 null，否则返回原因。
*
* @param run 运行记录
* @param definition 定义快照
* @returns 不兼容时是原因，否则 `null`
*/
function incompatibleReason(run, definition) {
	if (run === null) return "run.json 缺失或损坏";
	if (run.version !== 3) return `run.json 版本为 ${String(run.version)}`;
	if (definition === null) return "definition.json 缺失或损坏";
	if (definition.version !== 3) return `definition.json 版本为 ${String(definition.version)}`;
	return null;
}
/**
* 按 UTF-8 字节数截断文本，避免把一个多字节字符切成两半。
*
* @param text 原文
* @param maxBytes 字节上限
* @returns 截断后的文本与是否截断
*/
function truncateUtf8(text, maxBytes) {
	if (typeof text !== "string") return {
		text: "",
		truncated: false
	};
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return {
		text,
		truncated: false
	};
	let clipped = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
	clipped = clipped.replace(/\uFFFD$/u, "");
	return {
		text: clipped,
		truncated: true
	};
}
/**
* 计龄基准：优先结束时间，其次最后更新时间，再次创建时间；读不到记录时用
* 目录的 mtime 兜底。归档 / 删除都按这个时间算，运行中的记录不会被处理。
*
* @param run 运行记录
* @param fallback 记录缺失时使用的计龄时间
* @returns 计龄基准时间
*/
function ageAnchor(run, fallback) {
	for (const value of [
		run?.finishedAt,
		run?.updatedAt,
		run?.createdAt
	]) if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	return fallback;
}
/**
* 正整数选项或默认值。
*
* @param value 待校验的值
* @param fallback 不合法时使用的默认值
* @returns 正整数或默认值
*/
function positiveOption(value, fallback) {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
/**
* 运行记录存储。
*/
var WorkflowRunStore = class {
	constructor(options) {
		if (typeof options?.dir !== "string" || options.dir.trim() === "") throw new Error("WorkflowRunStore requires a runs directory");
		this.dir = path.resolve(options.dir);
		this.maxRuns = typeof options.maxRuns === "number" && Number.isInteger(options.maxRuns) && options.maxRuns > 0 ? options.maxRuns : 200;
		this.maxAttachmentBytes = positiveOption(options.maxAttachmentBytes, DEFAULT_MAX_ATTACHMENT_BYTES);
		this.maxAttachmentsPerNode = positiveOption(options.maxAttachmentsPerNode, 20);
		this.maxNodeAttachmentsBytes = positiveOption(options.maxNodeAttachmentsBytes, DEFAULT_MAX_NODE_ATTACHMENTS_BYTES);
		this.maxInlineAttachmentBytes = positiveOption(options.maxInlineAttachmentBytes, DEFAULT_MAX_INLINE_ATTACHMENT_BYTES);
		this.retention = normalizeRetention(options.retention);
		this.logger = options.logger;
		this.sequenceQueue = Promise.resolve();
		this.sweepQueue = Promise.resolve();
	}
	/**
	* 建目录、删掉格式不兼容的旧运行、回填序号、按自动归档设置清理；未完成
	* 运行交给观察者恢复。
	*
	* @returns 初始化完成的 promise
	*/
	async init() {
		this.ready ??= this.#initialize();
		return await this.ready;
	}
	/** @returns 初始化完成的 promise */
	async #initialize() {
		await promises.mkdir(this.dir, { recursive: true });
		await this.#purgeIncompatibleRuns();
		await this.backfillSeq();
		await this.sweep();
	}
	/**
	* 删除格式版本不兼容（或 run.json / definition.json 缺失、损坏）的运行目录。
	* 运行时文件（settings.json）在 runs 目录之外，永远不会被这里碰到。
	*
	* 如果所有运行目录都被删掉，一并删除序号计数器，让下一次运行从 #1 重新
	* 开始；只要还有当前版本的运行留着，就保持计数器原样。
	*
	* @returns 无返回值
	*/
	async #purgeIncompatibleRuns() {
		const runIds = await this.listRunIds();
		if (runIds.length === 0) return;
		let removed = 0;
		for (const runId of runIds) {
			const directory = this.runDirectory(runId);
			if (!this.#isOwnRunDirectory(directory)) continue;
			const reason = incompatibleReason(await readJsonFile(path.join(directory, RUN_FILE)), await readJsonFile(path.join(directory, DEFINITION_FILE)));
			if (reason === null) continue;
			try {
				await promises.rm(directory, {
					recursive: true,
					force: true
				});
				removed += 1;
				this.logger?.info?.(`buka-workflows: 删除格式不兼容的运行记录（${runId}：${reason}）`);
			} catch (error) {
				this.logger?.warn?.(`buka-workflows: 删除格式不兼容的运行记录失败（${runId}）：${describeError$1(error)}`);
			}
		}
		if (removed === 0) return;
		this.logger?.info?.(`buka-workflows: 共删除 ${removed} 条格式不兼容的运行记录`);
		if ((await this.listRunIds()).length === 0) try {
			await promises.rm(this.sequenceFile(), { force: true });
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: 重置运行序号失败：${describeError$1(error)}`);
		}
	}
	/**
	* 更新自动归档策略（页面保存设置后调用）。
	*
	* @param retention 新的归档策略
	*/
	setRetention(retention) {
		this.retention = normalizeRetention(retention);
	}
	/**
	* 一次运行的目录。
	*
	* @param runId 运行 id
	* @returns 运行目录
	*/
	runDirectory(runId) {
		return path.join(this.dir, runId);
	}
	/**
	* 序号计数器文件。
	*
	* @returns 序号计数器文件
	*/
	sequenceFile() {
		return path.join(this.dir, SEQUENCE_FILE);
	}
	/**
	* 分配下一个运行序号（从 1 开始）。计数器缺失时按现有运行的最大序号 +
	* 1 初始化；分配串行执行，避免并发创建拿到同一个号。
	*
	* @returns 下一个运行序号
	*/
	allocateSeq() {
		const job = this.sequenceQueue.then(() => this.#allocateSeqOnce());
		this.sequenceQueue = job.catch(() => void 0);
		return job;
	}
	/** @returns 下一个运行序号 */
	async #allocateSeqOnce() {
		await promises.mkdir(this.dir, { recursive: true });
		const state = await this.#readSequence();
		const next = state === null ? await this.#nextSeqFromRuns() : state.next;
		await this.#writeSequence(next + 1);
		return next;
	}
	/**
	* 新建一次运行：写定义快照、状态快照与首条事件。
	*
	* @param input 运行记录、定义快照与可选计划
	*/
	async create({ run, definition, plan }) {
		run.version = 3;
		const directory = this.runDirectory(run.runId);
		await promises.mkdir(directory, { recursive: true });
		await writeJsonAtomic(path.join(directory, DEFINITION_FILE), {
			version: 3,
			runId: run.runId,
			createdAt: run.createdAt,
			createdBy: run.createdBy,
			goal: run.goal,
			definition,
			...plan === void 0 ? {} : { plan }
		});
		await writeJsonAtomic(path.join(directory, RUN_FILE), run);
		await this.appendEvent(run.runId, "run/created", {
			goal: run.goal,
			...Number.isInteger(run.seq) ? { seq: run.seq } : {},
			...run.createdBy === void 0 ? {} : { createdBy: run.createdBy }
		});
	}
	/**
	* 写状态快照。
	*
	* @param run 运行记录
	*/
	async save(run) {
		await writeJsonAtomic(path.join(this.runDirectory(run.runId), RUN_FILE), run);
	}
	/**
	* 追加一条事件。
	*
	* @param runId 运行 id
	* @param type 事件类型
	* @param data 事件数据
	*/
	async appendEvent(runId, type, data = {}) {
		const directory = this.runDirectory(runId);
		await promises.mkdir(directory, { recursive: true });
		const line = `${JSON.stringify({
			time: Date.now(),
			type,
			data
		})}\n`;
		await promises.appendFile(path.join(directory, EVENTS_FILE), line, {
			encoding: "utf8",
			mode: 384
		});
	}
	/**
	* 一次执行的节点目录：`nodes/<seq>-<nodeId>/`。
	*
	* `runId` / `nodeId` 必须是单段路径，`seq` 必须是正整数；调用方不能用路径
	* 片段逃出 `nodes/`。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @returns 节点目录
	*/
	nodeDirectory(runId, seq, nodeId) {
		if (typeof runId !== "string" || runId === "") throw new Error("runId is required");
		if (runId === "." || runId === ".." || runId.includes("/") || runId.includes("\\")) throw new Error("runId must be a single path segment");
		if (!Number.isInteger(seq) || seq <= 0) throw new Error("seq must be a positive integer");
		if (typeof nodeId !== "string" || nodeId === "") throw new Error("nodeId is required");
		if (nodeId === "." || nodeId === ".." || nodeId.includes("/") || nodeId.includes("\\")) throw new Error("nodeId must be a single path segment");
		return path.join(this.runDirectory(runId), NODES_DIR, `${seq}-${nodeId}`);
	}
	/**
	* 保存一个节点结果全文。新记录写到节点目录的 `result.json`；旧记录中的
	* `nodes/<seq>-<nodeId>.json` 只读不删。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @param payload 节点结果
	*/
	async saveNodeResult(runId, seq, nodeId, payload) {
		const directory = this.nodeDirectory(runId, seq, nodeId);
		await promises.mkdir(directory, { recursive: true });
		await writeJsonAtomic(path.join(directory, NODE_RESULT_FILE), {
			version: 3,
			runId,
			seq,
			nodeId,
			savedAt: Date.now(),
			...payload
		});
	}
	/**
	* 读取一次运行的状态快照。
	*
	* @param runId 运行 id
	* @returns 运行记录；缺失 / 损坏时是 `null`
	*/
	async readRun(runId) {
		if (typeof runId !== "string" || runId === "") return null;
		if (runId === "sequence.json") return null;
		try {
			const text = await promises.readFile(path.join(this.runDirectory(runId), RUN_FILE), "utf8");
			const run = JSON.parse(text);
			if (typeof run?.runId !== "string" || typeof run?.status !== "string") return null;
			return run;
		} catch {
			return null;
		}
	}
	/**
	* 读取一次运行的定义快照。
	*
	* @param runId 运行 id
	* @returns 定义快照；缺失 / 损坏时是 `null`
	*/
	async readDefinition(runId) {
		if (typeof runId !== "string" || runId === "") return null;
		try {
			const text = await promises.readFile(path.join(this.runDirectory(runId), DEFINITION_FILE), "utf8");
			const value = JSON.parse(text);
			return value !== null && typeof value === "object" ? value : null;
		} catch {
			return null;
		}
	}
	/**
	* 读取一次运行的全部节点结果，按 seq 升序。新目录布局与旧 JSON 文件同时
	* 扫描；同一 `seq:nodeId` 以新目录为准。
	*
	* @param runId 运行 id
	* @returns 全部节点结果，按 seq 升序
	*/
	async readNodeResults(runId) {
		if (typeof runId !== "string" || runId === "") return [];
		const directory = path.join(this.runDirectory(runId), NODES_DIR);
		let entries;
		try {
			entries = await promises.readdir(directory, { withFileTypes: true });
		} catch {
			return [];
		}
		const byKey = /* @__PURE__ */ new Map();
		/** @param value 一条节点结果 */
		const remember = (value) => {
			const key = `${String(value.seq ?? "")}:${String(value.nodeId ?? "")}`;
			if (!byKey.has(key)) byKey.set(key, value);
		};
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const value = await readJsonFile(path.join(directory, entry.name, NODE_RESULT_FILE));
			if (value !== null) remember(value);
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			const value = await readJsonFile(path.join(directory, entry.name));
			if (value !== null) remember(value);
		}
		return [...byKey.values()].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
	}
	/**
	* 读取某一次执行的节点结果全文。优先新目录 `result.json`，找不到时回退
	* 旧版 `nodes/<seq>-<nodeId>.json`。文件缺失、损坏或参数不合法时返回 null。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @returns 节点结果；缺失 / 参数不合法时是 `null`
	*/
	async readNodeResult(runId, seq, nodeId) {
		let directory;
		try {
			directory = this.nodeDirectory(runId, seq, nodeId);
		} catch {
			return null;
		}
		const fresh = await readJsonFile(path.join(directory, NODE_RESULT_FILE));
		if (fresh !== null) return fresh;
		return await readJsonFile(path.join(this.runDirectory(runId), NODES_DIR, `${seq}-${nodeId}.json`));
	}
	/**
	* 把节点返回的附件复制到该次执行的节点目录，返回稳定清单。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @param raw `structured_output.attachments`
	* @param options 机器人工作区
	* @returns 稳定清单
	*/
	async writeNodeAttachments(runId, seq, nodeId, raw, options = {}) {
		return await writeNodeAttachmentsToRun({
			runDirectory: this.runDirectory(runId),
			nodeDirectory: this.nodeDirectory(runId, seq, nodeId),
			raw,
			workspace: typeof options.workspace === "string" ? options.workspace : "",
			maxBytes: this.maxAttachmentBytes,
			maxTotalBytes: this.maxNodeAttachmentsBytes,
			maxCount: this.maxAttachmentsPerNode
		});
	}
	/**
	* 把附件清单转成模板上下文：每个附件带绝对路径；文本附件在大小上限内
	* 额外带 `text` 供 prompt 内联。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @param manifest 附件清单
	* @returns 模板上下文里的附件值
	*/
	async attachmentValues(runId, seq, nodeId, manifest) {
		return await attachmentTemplateValues({
			attachmentsDirectory: path.join(this.nodeDirectory(runId, seq, nodeId), ATTACHMENTS_DIR),
			manifest,
			maxInlineTextBytes: this.maxInlineAttachmentBytes
		});
	}
	/**
	* 读取一个附件的一段内容。`name` 必须出现在该次执行的清单里。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @param name 附件名
	* @param options 起始偏移与读取字节数
	* @returns 附件的一段内容；找不到时是 `null`
	*/
	async readAttachment(runId, seq, nodeId, name, options = {}) {
		return await readRunAttachment({
			nodeResult: await this.readNodeResult(runId, seq, nodeId),
			nodeDirectory: this.nodeDirectory(runId, seq, nodeId),
			name,
			offset: options.offset,
			maxBytes: options.maxBytes
		});
	}
	/**
	* 打开一个附件用于下载：只返回清单里的文件，并确认它仍在附件目录内。
	*
	* @param runId 运行 id
	* @param seq 执行序号
	* @param nodeId 节点 id
	* @param name 附件名
	* @returns 可下载附件；找不到时是 `null`
	*/
	async openAttachment(runId, seq, nodeId, name) {
		return await openRunAttachment({
			nodeResult: await this.readNodeResult(runId, seq, nodeId),
			nodeDirectory: this.nodeDirectory(runId, seq, nodeId),
			name
		});
	}
	/**
	* 列出运行目录名（忽略序号计数器文件）。
	*
	* @returns 运行目录名
	*/
	async listRunIds() {
		let entries;
		try {
			entries = await promises.readdir(this.dir, { withFileTypes: true });
		} catch {
			return [];
		}
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => name !== SEQUENCE_FILE);
	}
	/**
	* 最近的运行摘要，按创建时间倒序。默认只列未归档的运行；`archived: true`
	* 时只列已归档的运行（供页面的「查看已归档」用）。
	*
	* @param limit 最多返回多少条
	* @param options 是否只看已归档
	* @returns 运行摘要
	*/
	async listRuns(limit = 20, options = {}) {
		const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
		const archivedOnly = options.archived === true;
		const runs = [];
		for (const runId of await this.listRunIds()) {
			const run = await this.readRun(runId);
			if (run === null) continue;
			const archived = typeof run.archivedAt === "number";
			if (archived !== archivedOnly) continue;
			runs.push({
				runId: run.runId,
				seq: typeof run.seq === "number" && Number.isInteger(run.seq) && run.seq > 0 ? run.seq : null,
				goal: run.goal ?? "",
				status: run.status,
				createdAt: run.createdAt ?? null,
				finishedAt: run.finishedAt ?? null,
				archivedAt: archived ? run.archivedAt : null,
				lastNode: run.active?.[0]?.nodeId ?? run.current?.nodeId ?? run.result?.lastNode ?? null,
				error: run.error ?? null,
				waitingForUser: Boolean(run.pendingInteraction || run.pendingUser)
			});
		}
		runs.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
		return runs.slice(0, max);
	}
	/**
	* 已归档运行的条数：页面用它决定是否显示「查看已归档」入口。
	*
	* @returns 已归档运行条数
	*/
	async countArchived() {
		let count = 0;
		for (const runId of await this.listRunIds()) {
			const run = await this.readRun(runId);
			if (run !== null && typeof run.archivedAt === "number") count += 1;
		}
		return count;
	}
	/**
	* 所有仍在进行（running / waiting）的运行，按创建时间升序。观察者启动恢复
	* 先用它，能恢复就继续跑，不能恢复再调用 `markInterrupted`。
	*
	* @returns 未完成的运行，按创建时间升序
	*/
	async listUnfinished() {
		const runs = [];
		for (const runId of await this.listRunIds()) {
			const run = await this.readRun(runId);
			if (run === null) continue;
			if (run.status !== "running" && run.status !== "waiting") continue;
			runs.push(run);
		}
		runs.sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
		return runs;
	}
	/**
	* 把一个无法恢复的进行中运行标成 interrupted，保留记录供回看。
	*
	* @param runId 运行 id
	* @param reason 中断原因
	* @returns 是否确实改了状态
	*/
	async markInterrupted(runId, reason) {
		const run = await this.readRun(runId);
		if (run === null) return false;
		if (run.status !== "running" && run.status !== "waiting") return false;
		const now = Date.now();
		run.status = "interrupted";
		run.updatedAt = now;
		run.finishedAt = now;
		run.current = null;
		run.active = [];
		run.pendingUser = null;
		run.pendingInteraction = null;
		run.error = typeof reason === "string" && reason !== "" ? reason : "host restarted before this workflow finished";
		run.result = {
			status: "interrupted",
			lastNode: run.result?.lastNode ?? null
		};
		try {
			await this.save(run);
			await this.appendEvent(runId, "run/interrupted", { reason: run.error });
			return true;
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: 标记中断运行失败（${runId}）：${describeError$1(error)}`);
			return false;
		}
	}
	/**
	* 把所有无法恢复的进行中运行标成 interrupted。观察者不可用（例如 robots
	* 服务缺失）时用它兜底。
	*
	* @param reason 中断原因
	* @returns 标成 interrupted 的运行数
	*/
	async markAllInterrupted(reason) {
		let count = 0;
		for (const run of await this.listUnfinished()) if (await this.markInterrupted(run.runId, reason)) count += 1;
		return count;
	}
	/**
	* 给没有序号的历史运行按创建时间回填编号，并把计数器推到最大值之后。
	* 只在启动时执行一次；已经有序号的记录保持原样。
	*
	* @returns 无返回值
	*/
	async backfillSeq() {
		const unnumbered = [];
		let maxSeq = 0;
		for (const runId of await this.listRunIds()) {
			const run = await this.readRun(runId);
			if (run === null) continue;
			if (typeof run.seq === "number" && Number.isInteger(run.seq) && run.seq > 0) {
				maxSeq = Math.max(maxSeq, run.seq);
				continue;
			}
			unnumbered.push(run);
		}
		if (unnumbered.length === 0) {
			if (maxSeq > 0 && await this.#readSequence() === null) await this.#writeSequence(maxSeq + 1);
			return;
		}
		const state = await this.#readSequence();
		let next = Math.max(maxSeq + 1, state?.next ?? 1);
		unnumbered.sort((left, right) => {
			const diff = ageAnchor(left, 0) - ageAnchor(right, 0);
			return diff !== 0 ? diff : String(left.runId).localeCompare(String(right.runId));
		});
		for (const run of unnumbered) {
			run.seq = next;
			next += 1;
			try {
				await this.save(run);
			} catch (error) {
				this.logger?.warn?.(`buka-workflows: 回填运行序号失败（${run.runId}）：${describeError$1(error)}`);
			}
		}
		await this.#writeSequence(next);
	}
	/**
	* 按自动归档设置处理所有运行：超删除时间的删目录，超归档时间的写
	* `archivedAt`；运行中（running / waiting）的记录永远跳过。关闭自动归档
	* 后不做按时间的归档 / 删除，但 `maxRuns` 上限仍然生效（只删已归档记录）。
	*
	* @param options 测试注入的当前时间
	* @returns 清扫完成的 promise
	*/
	sweep(options = {}) {
		const job = this.sweepQueue.then(() => this.#sweepOnce(options));
		this.sweepQueue = job.catch(() => void 0);
		return job;
	}
	/**
	* 一次清扫的实际逻辑；只由 `sweep` 串行调用。
	*
	* @param options 测试注入的当前时间
	* @returns 无返回值
	*/
	async #sweepOnce({ now = Date.now() } = {}) {
		const retention = this.retention;
		const entries = [];
		for (const runId of await this.listRunIds()) {
			const directory = this.runDirectory(runId);
			let stat;
			try {
				stat = await promises.stat(directory);
			} catch {
				continue;
			}
			const run = await this.readRun(runId);
			const active = run !== null && (run.status === "running" || run.status === "waiting");
			entries.push({
				runId,
				directory,
				run,
				anchor: ageAnchor(run, stat.mtimeMs),
				active,
				deleted: false
			});
		}
		if (retention.enabled) {
			const archiveCutoff = now - retention.archiveAfterHours * HOUR_MS;
			const deleteCutoff = now - retention.deleteAfterHours * HOUR_MS;
			for (const entry of entries) {
				if (entry.active) continue;
				if (entry.anchor <= deleteCutoff) {
					await this.#removeRun(entry);
					continue;
				}
				if (entry.run === null || typeof entry.run.archivedAt === "number") continue;
				if (entry.anchor > archiveCutoff) continue;
				entry.run.archivedAt = now;
				try {
					await this.save(entry.run);
					await this.appendEvent(entry.runId, "run/archived", { archivedAt: now });
				} catch (error) {
					this.logger?.warn?.(`buka-workflows: 归档运行失败（${entry.runId}）：${describeError$1(error)}`);
				}
			}
		}
		await this.#pruneArchivedOverflow(entries);
	}
	/**
	* `maxRuns` 只限制已归档记录：超出时从最旧的已归档运行开始删除。未归档的
	* 运行（还在保留期内）不会被这个上限删掉。
	*
	* @param entries 本次清扫的运行快照
	* @returns 无返回值
	*/
	async #pruneArchivedOverflow(entries) {
		const remaining = entries.filter((entry) => !entry.deleted);
		const overflow = remaining.length - this.maxRuns;
		if (overflow <= 0) return;
		const archived = remaining.filter((entry) => !entry.active && entry.run !== null && typeof entry.run.archivedAt === "number").sort((left, right) => left.anchor - right.anchor);
		for (const entry of archived.slice(0, overflow)) await this.#removeRun(entry);
	}
	/**
	* 删除一个运行目录；只允许删 runs 目录下的直接子目录，避免误删用户文件。
	*
	* @param entry 要删除的运行快照
	* @returns 无返回值
	*/
	async #removeRun(entry) {
		if (entry.deleted) return;
		if (!this.#isOwnRunDirectory(entry.directory)) return;
		try {
			await promises.rm(entry.directory, {
				recursive: true,
				force: true
			});
			entry.deleted = true;
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: 清理旧运行失败（${entry.directory}）：${describeError$1(error)}`);
		}
	}
	/**
	* 读序号计数器；文件缺失 / 损坏 / 值不合法时返回 null，由调用方按现有运行
	* 推导下一个序号。
	*
	* @returns 计数器内容；缺失 / 损坏时是 `null`
	*/
	async #readSequence() {
		try {
			const text = await promises.readFile(this.sequenceFile(), "utf8");
			const value = JSON.parse(text);
			if (!Number.isInteger(value?.next) || value.next < 1) return null;
			return { next: value.next };
		} catch {
			return null;
		}
	}
	/**
	* 写序号计数器。
	*
	* @param next 下一个序号
	* @returns 无返回值
	*/
	async #writeSequence(next) {
		await writeJsonAtomic(this.sequenceFile(), {
			version: 3,
			next
		});
	}
	/**
	* 从现有运行推导下一个序号：最大 seq + 1（没有记录时从 1 开始）。
	*
	* @returns 下一个序号
	*/
	async #nextSeqFromRuns() {
		let maxSeq = 0;
		for (const runId of await this.listRunIds()) {
			const run = await this.readRun(runId);
			if (run !== null && typeof run.seq === "number" && Number.isInteger(run.seq) && run.seq > maxSeq) maxSeq = run.seq;
		}
		return maxSeq + 1;
	}
	/**
	* 只允许删除 runsDir 下的直接子目录，避免误删用户文件。
	*
	* @param directory 目录路径
	* @returns 是 runsDir 的直接子目录时为 true
	*/
	#isOwnRunDirectory(directory) {
		const resolved = path.resolve(directory);
		return resolved.startsWith(`${this.dir}${path.sep}`) && resolved !== this.dir;
	}
};
// .build/workflows/session-tools.js
/**
* 机器人节点会话里的四个只读工作流工具。
*
* 这些工具注册在 workflows 插件上，但只对「运行记录里出现过的机器人会话」可见
* （可见性由 supervisor 维护的 sessionId → runId 索引决定）。工具不写运行记录，
* 也不允许切换运行：每个工具都从调用者会话反查它所属的那一次运行。
*
* - `buka_workflow_overview`：紧凑的节点图 + 节点概要/状态 + 执行序号列表；
* - `buka_workflow_execution_input`：某次执行实际收到的输入；
* - `buka_workflow_execution_output`：某次执行的输出与附件清单；
* - `buka_workflow_execution_attachment`：列出附件，或分段读取一个附件。
*
* 总览刻意不返回 prompt / 最终文本 / 附件内容 / 边的 prompt，避免把整份运行记录塞进
* 上下文；需要细节时按执行序号单独取。本模块不 import DSH 包，`defineTool`
* 由入口注入，便于用假 store 单测。
*
* @module @buka/dsh-plugin-workflows/session-tools
*/
/** 判断普通对象。 */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 总览里目标 / 节点概要 / 错误的最大字符数。 */
const GOAL_LIMIT = 240;
const SUMMARY_LIMIT = 160;
const ERROR_LIMIT = 300;
const EDGE_NAME_LIMIT = 80;
/** 附件工具一次读取的默认 / 最大字节数。 */
const DEFAULT_ATTACHMENT_READ_BYTES = 65536;
const MAX_ATTACHMENT_READ_BYTES = 262144;
/**
* 压成一行并截断。
*
* @param value 原始值
* @param max 字符上限
* @returns 单行文本
*/
function clipText$1(value, max) {
	if (typeof value !== "string") return "";
	const text = value.replace(/\s+/gu, " ").trim();
	if (text === "") return "";
	return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}
/**
* 字节数 → 简短大小。
*
* @param value 字节数
* @returns 简短大小
*/
function formatBytes(value) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "?";
	if (value < 1024) return `${value} B`;
	if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
	if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MiB`;
	return `${(value / 1073741824).toFixed(1)} GiB`;
}
/**
* 节点结果里的附件清单，只保留展示需要的字段。
*
* @param value 节点结果里的 `attachments`
* @returns 展示用的附件清单
*/
function attachmentManifest(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.name === "string").map((entry, fallbackIndex) => ({
		index: typeof entry.index === "number" && Number.isInteger(entry.index) ? entry.index : fallbackIndex,
		name: entry.name,
		bytes: typeof entry.bytes === "number" && Number.isFinite(entry.bytes) ? entry.bytes : 0,
		description: typeof entry.description === "string" && entry.description !== "" ? entry.description : null
	}));
}
/**
* 附件清单的展示文本。
*
* @param attachments 附件清单
* @returns 展示文本行
*/
function attachmentLines(attachments) {
	return attachments.map((entry) => {
		const description = entry.description === null ? "" : ` — ${entry.description}`;
		return `- #${entry.index} ${entry.name} (${formatBytes(entry.bytes)})${description}`;
	});
}
/**
* 时间戳 → ISO 字符串。
*
* @param value 时间戳
* @returns ISO 字符串；非法时是 `null`
*/
function isoTime(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	try {
		return new Date(value).toISOString();
	} catch {
		return null;
	}
}
/**
* 按 id 从定义快照里取节点；优先用规范化后的 plan。
*
* @param definition 定义快照
* @param nodeId 节点 id
* @returns 节点；找不到时是 `null`
*/
function definitionNode(definition, nodeId) {
	if (typeof nodeId !== "string" || nodeId === "") return null;
	const plan = isRecord$1(definition) ? definition.plan : void 0;
	const planned = isRecord$1(plan) && isRecord$1(plan.nodes) ? plan.nodes[nodeId] : void 0;
	if (planned !== null && typeof planned === "object") return planned;
	const raw = isRecord$1(definition) ? definition.definition : void 0;
	return (isRecord$1(raw) && Array.isArray(raw.nodes) ? raw.nodes : []).find((node) => node !== null && typeof node === "object" && node.id === nodeId) ?? null;
}
/**
* 读取运行；不存在时给出明确错误。
*
* @param store 运行存储
* @param runId 运行 id
* @returns 运行记录
*/
async function readRunOrThrow(store, runId) {
	const run = await store.readRun(runId);
	if (run === null || run === void 0) throw new Error(`workflow run "${runId}" is no longer available; it may have been archived or deleted`);
	return run;
}
/**
* 校验执行序号。
*
* @param value 执行序号
* @returns 合法的执行序号
*/
function requireSeq(value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error("seq must be a positive integer execution number from the buka_workflow_overview execution list");
	return value;
}
/**
* 一次执行的当前状态：正在跑的节点还没进 run.steps。
*
* @param run 运行记录
* @param current 活跃节点
* @returns 执行状态
*/
function currentStatus(run, current) {
	if (current?.type === "user") return run.pendingUser?.nodeId === current.nodeId ? "waiting" : "running";
	return "running";
}
/**
* 运行中的活跃节点列表：并发用 run.active，旧记录退回单值 run.current。
*
* @param run 运行记录
* @returns 活跃节点列表
*/
function activesOf(run) {
	if (Array.isArray(run.active)) return run.active.filter((entry) => entry !== null && typeof entry === "object");
	if (run.current !== null && typeof run.current === "object") return [run.current];
	return [];
}
/**
* 执行列表，按 seq 升序；包含正在执行的 current。
*
* @param run 运行记录
* @returns 执行列表
*/
function executionList(run) {
	const steps = Array.isArray(run.steps) ? run.steps : [];
	const list = [];
	for (const step of steps) {
		if (step === null || typeof step !== "object") continue;
		list.push({
			seq: typeof step.seq === "number" && Number.isInteger(step.seq) ? step.seq : null,
			nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
			visit: typeof step.visit === "number" && Number.isInteger(step.visit) ? step.visit : null,
			type: typeof step.type === "string" ? step.type : null,
			robot: typeof step.robot === "string" && step.robot !== "" ? step.robot : null,
			status: typeof step.status === "string" && step.status !== "" ? step.status : "unknown",
			route: typeof step.route === "string" && step.route !== "" ? step.route : null,
			routeTo: typeof step.routeTo === "string" && step.routeTo !== "" ? step.routeTo : null,
			attachments: Array.isArray(step.attachments) ? step.attachments.length : 0,
			startedAt: isoTime(step.startedAt),
			finishedAt: isoTime(step.finishedAt)
		});
	}
	for (const current of activesOf(run)) {
		if (list.some((item) => item.seq === current.seq)) continue;
		list.push({
			seq: typeof current.seq === "number" && Number.isInteger(current.seq) ? current.seq : null,
			nodeId: typeof current.nodeId === "string" ? current.nodeId : "",
			visit: typeof current.visit === "number" && Number.isInteger(current.visit) ? current.visit : null,
			type: typeof current.type === "string" ? current.type : null,
			robot: typeof current.robot === "string" && current.robot !== "" ? current.robot : null,
			status: currentStatus(run, current),
			route: null,
			routeTo: null,
			attachments: 0,
			startedAt: isoTime(current.startedAt),
			finishedAt: null
		});
	}
	list.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
	return list;
}
/**
* 按 seq 找一次执行；优先 run.steps，其次 current。
*
* @param run 运行记录
* @param seq 执行序号
* @returns 命中的执行；找不到时是 `null`
*/
function findExecution(run, seq) {
	const step = (Array.isArray(run.steps) ? run.steps : []).find((item) => item !== null && typeof item === "object" && item.seq === seq);
	if (step !== void 0) return {
		step,
		running: false
	};
	const current = activesOf(run).find((item) => item.seq === seq);
	if (current !== void 0) return {
		step: {
			...current,
			status: currentStatus(run, current),
			stopReason: null
		},
		running: true
	};
	return null;
}
/**
* 总览的返回值：只保留图结构与状态，不夹带执行内容。
*
* @param run 运行记录
* @param definition 定义快照
* @returns 总览返回值
*/
function overviewValue(run, definition) {
	const model = buildRunGraph({
		run,
		definition
	});
	const actives = activesOf(run);
	const current = actives[0] ?? null;
	const pendingUser = run.pendingUser;
	const pendingInteraction = run.pendingInteraction;
	const nodes = (Array.isArray(model?.nodes) ? model.nodes : []).map((node) => ({
		id: typeof node.id === "string" ? node.id : "",
		type: typeof node.type === "string" ? node.type : null,
		state: typeof node.state === "string" ? node.state : "idle",
		visits: Number.isInteger(node.visits) ? node.visits : 0,
		lastSeq: Number.isInteger(node.lastSeq) ? node.lastSeq : null,
		summary: node.type === "robot" ? clipText$1(node.summary, SUMMARY_LIMIT) : node.type === "user" ? clipText$1(node.title, SUMMARY_LIMIT) : null,
		robot: node.type === "robot" && typeof node.robot === "string" && node.robot !== "" ? node.robot : null,
		unreachable: node.unreachable === true
	}));
	const edges = (Array.isArray(model?.edges) ? model.edges : []).map((edge) => ({
		from: typeof edge.from === "string" ? edge.from : "",
		to: typeof edge.to === "string" ? edge.to : "",
		kind: typeof edge.kind === "string" ? edge.kind : "next",
		names: (Array.isArray(edge.names) ? edge.names : []).map((name) => clipText$1(name, EDGE_NAME_LIMIT)).filter((name) => name !== ""),
		traversed: edge.traversed === true,
		traversals: Number.isInteger(edge.traversals) ? edge.traversals : 0,
		loop: edge.loop === true
	}));
	return {
		run: {
			runId: typeof run.runId === "string" ? run.runId : "",
			seq: Number.isInteger(run.seq) ? run.seq : null,
			status: typeof run.status === "string" ? run.status : "unknown",
			goal: clipText$1(run.goal, GOAL_LIMIT),
			createdAt: isoTime(run.createdAt),
			finishedAt: isoTime(run.finishedAt),
			current: current !== null ? {
				nodeId: typeof current.nodeId === "string" ? current.nodeId : "",
				seq: Number.isInteger(current.seq) ? current.seq : null,
				type: typeof current.type === "string" ? current.type : null,
				visit: Number.isInteger(current.visit) ? current.visit : null,
				robot: typeof current.robot === "string" && current.robot !== "" ? current.robot : null
			} : null,
			active: actives.map((active) => ({
				nodeId: typeof active.nodeId === "string" ? active.nodeId : "",
				seq: Number.isInteger(active.seq) ? active.seq : null,
				type: typeof active.type === "string" ? active.type : null,
				visit: Number.isInteger(active.visit) ? active.visit : null,
				robot: typeof active.robot === "string" && active.robot !== "" ? active.robot : null
			})),
			pendingUser: pendingUser !== null && pendingUser !== void 0 ? {
				nodeId: typeof pendingUser.nodeId === "string" ? pendingUser.nodeId : "",
				title: clipText$1(pendingUser.title, SUMMARY_LIMIT)
			} : null,
			pendingInteraction: pendingInteraction !== null && pendingInteraction !== void 0 ? {
				kind: typeof pendingInteraction.kind === "string" ? pendingInteraction.kind : null,
				nodeId: typeof pendingInteraction.nodeId === "string" ? pendingInteraction.nodeId : "",
				seq: Number.isInteger(pendingInteraction.seq) ? pendingInteraction.seq : null
			} : null,
			error: clipText$1(run.error, ERROR_LIMIT) || null
		},
		nodes,
		edges,
		executions: executionList(run)
	};
}
/**
* 总览的紧凑文本。
*
* @param value 总览返回值
* @returns 展示文本
*/
function renderOverview(value) {
	const valueRecord = isRecord$1(value) ? value : {};
	const run = isRecord$1(valueRecord.run) ? valueRecord.run : {};
	const seq = run.seq;
	const lines = [`workflow ${typeof seq === "number" && Number.isInteger(seq) ? `#${seq} ` : ""}${run.runId ?? ""} — ${run.status ?? "unknown"}`];
	if (typeof run.goal === "string" && run.goal !== "") lines.push(`goal: ${run.goal}`);
	if (typeof run.createdAt === "string" && run.createdAt !== "") lines.push(`created: ${run.createdAt}`);
	if (typeof run.finishedAt === "string" && run.finishedAt !== "") lines.push(`finished: ${run.finishedAt}`);
	const actives = Array.isArray(run.active) ? run.active : [];
	const currentList = actives.length > 0 ? actives : run.current ? [run.current] : [];
	for (const current of currentList) {
		const item = isRecord$1(current) ? current : {};
		const currentSeq = item.seq;
		const suffix = typeof currentSeq === "number" && Number.isInteger(currentSeq) ? ` (execution #${currentSeq})` : "";
		lines.push(`current: ${String(item.nodeId)}${suffix}`);
	}
	if (run.pendingUser !== null && run.pendingUser !== void 0) {
		const pending = isRecord$1(run.pendingUser) ? run.pendingUser : {};
		lines.push(`waiting at user node: ${String(pending.title || pending.nodeId)}`);
	}
	if (run.pendingInteraction !== null && run.pendingInteraction !== void 0) {
		const pending = isRecord$1(run.pendingInteraction) ? run.pendingInteraction : {};
		lines.push(`waiting for user: ${String(pending.kind ?? "interaction")} at ${String(pending.nodeId)}`);
	}
	if (typeof run.error === "string" && run.error !== "") lines.push(`error: ${run.error}`);
	const nodes = Array.isArray(valueRecord.nodes) ? valueRecord.nodes : [];
	lines.push("nodes:");
	if (nodes.length === 0) lines.push("- (none)");
	for (const rawNode of nodes) {
		const node = isRecord$1(rawNode) ? rawNode : {};
		const state = node.state === "idle" ? "not reached" : String(node.state);
		const markers = [];
		if (node.unreachable === true) markers.push("unreachable");
		const visits = node.visits;
		if (typeof visits === "number" && visits > 1) markers.push(`×${visits}`);
		const lastSeq = node.lastSeq;
		if (typeof lastSeq === "number" && Number.isInteger(lastSeq)) markers.push(`last=#${lastSeq}`);
		const robot = node.robot === null || node.robot === void 0 ? "" : ` ${String(node.robot)}`;
		const summary = node.summary === null || node.summary === void 0 || node.summary === "" ? "" : ` — ${String(node.summary)}`;
		lines.push(`- ${String(node.id)} [${String(node.type ?? "unknown")}${robot}] ${state}${markers.length > 0 ? ` ${markers.join(" ")}` : ""}${summary}`);
	}
	const edges = Array.isArray(valueRecord.edges) ? valueRecord.edges : [];
	lines.push("edges:");
	if (edges.length === 0) lines.push("- (none)");
	for (const rawEdge of edges) {
		const edge = isRecord$1(rawEdge) ? rawEdge : {};
		const names = Array.isArray(edge.names) ? edge.names : [];
		const nameText = names.length > 0 ? ` ${names.map((name) => String(name)).join(" / ")}` : "";
		const markers = [];
		if (edge.loop === true) markers.push("loop");
		const traversals = edge.traversals;
		if (edge.traversed === true) markers.push(`×${String(traversals)}`);
		lines.push(`- ${String(edge.from)} -> ${String(edge.to)} [${String(edge.kind)}${nameText}]${markers.length > 0 ? ` ${markers.join(" ")}` : ""}`);
	}
	const executions = Array.isArray(valueRecord.executions) ? valueRecord.executions : [];
	lines.push("executions:");
	if (executions.length === 0) lines.push("- (none)");
	for (const rawExecution of executions) {
		const execution = isRecord$1(rawExecution) ? rawExecution : {};
		const robot = execution.robot === null || execution.robot === void 0 ? "" : ` ${String(execution.robot)}`;
		const route = execution.route === null || execution.route === void 0 ? "" : ` route=${String(execution.route)}`;
		const time = execution.finishedAt ?? execution.startedAt;
		const stamp = typeof time === "string" && time !== "" ? ` ${time}` : "";
		const attachmentsCount = execution.attachments;
		const attachments = typeof attachmentsCount === "number" && attachmentsCount > 0 ? ` attachments=${attachmentsCount}` : "";
		lines.push(`- #${String(execution.seq ?? "?")} ${String(execution.nodeId)} [${String(execution.type ?? "unknown")}${robot}] ${String(execution.status)}${route}${attachments}${stamp}`);
	}
	return lines.join("\n");
}
/**
* 输入工具的展示文本。
*
* @param value 输入工具返回值
* @returns 展示文本
*/
function renderExecutionInput(value) {
	const record = isRecord$1(value) ? value : {};
	const robot = record.robot === null || record.robot === void 0 ? "" : ` · robot "${String(record.robot)}"`;
	const lines = [
		`execution #${String(record.seq ?? "?")} · ${String(record.type ?? "unknown")} "${String(record.nodeId ?? "")}"${robot} · ${String(record.status ?? "unknown")}`,
		"",
		typeof record.input === "string" && record.input !== "" ? record.input : "(empty input)"
	];
	if (record.truncated === true) lines.push("", "(input was truncated when it was recorded)");
	return lines.join("\n");
}
/**
* 输出工具的展示文本。正文优先；正文为空时才展示结构化 JSON，避免重复。
*
* @param value 输出工具返回值
* @returns 展示文本
*/
function renderExecutionOutput(value) {
	const record = isRecord$1(value) ? value : {};
	const robot = record.robot === null || record.robot === void 0 ? "" : ` · robot "${String(record.robot)}"`;
	const stop = typeof record.stopReason === "string" && record.stopReason !== "" ? ` (${record.stopReason})` : "";
	const route = typeof record.route === "string" && record.route !== "" ? ` route=${record.route}` : "";
	const lines = [`execution #${String(record.seq ?? "?")} · ${String(record.type ?? "unknown")} "${String(record.nodeId ?? "")}"${robot} · ${String(record.status ?? "unknown")}${stop}${route}`, ""];
	if (typeof record.output === "string" && record.output !== "") lines.push(record.output);
	else if (record.structured !== null && record.structured !== void 0) lines.push(JSON.stringify(record.structured, null, 2));
	else lines.push("(no output text)");
	if (typeof record.error === "string" && record.error !== "") lines.push("", `error: ${record.error}`);
	if (record.truncated === true) lines.push("", "(output was truncated when it was recorded)");
	const attachments = Array.isArray(record.attachments) ? record.attachments : [];
	if (attachments.length > 0) {
		lines.push("", "attachments:");
		lines.push(...attachmentLines(attachmentManifest(attachments)));
		lines.push(`use buka_workflow_execution_attachment with seq=${String(record.seq ?? "?")} and name to read one; binary/large files stay on disk`);
	}
	return lines.join("\n");
}
/**
* 附件工具的展示文本：列表或单文件内容。
*
* @param value 附件工具返回值
* @returns 展示文本
*/
function renderExecutionAttachment(value) {
	const record = isRecord$1(value) ? value : {};
	const robot = record.robot === null || record.robot === void 0 ? "" : ` · robot "${String(record.robot)}"`;
	const lines = [`execution #${String(record.seq ?? "?")} · ${String(record.type ?? "unknown")} "${String(record.nodeId ?? "")}"${robot} · ${String(record.status ?? "unknown")}`, ""];
	const attachment = record.attachment;
	if (attachment === null || attachment === void 0) {
		const attachments = Array.isArray(record.attachments) ? record.attachments : [];
		if (attachments.length === 0) lines.push("(no attachments)");
		else {
			lines.push("attachments:");
			lines.push(...attachmentLines(attachmentManifest(attachments)));
			lines.push("");
			lines.push("pass name to read one attachment");
		}
		return lines.join("\n");
	}
	const attachmentRecord = isRecord$1(attachment) ? attachment : {};
	const description = typeof attachmentRecord.description === "string" && attachmentRecord.description !== "" ? ` — ${attachmentRecord.description}` : "";
	lines.push(`attachment #${String(attachmentRecord.index ?? "?")} ${String(attachmentRecord.name ?? "")} (${formatBytes(attachmentRecord.bytes)})${description}`);
	if (typeof attachmentRecord.path === "string" && attachmentRecord.path !== "") lines.push(`path: ${attachmentRecord.path}`);
	lines.push("");
	if (attachmentRecord.binary === true) lines.push("(binary file; read it from the path instead of embedding it in a prompt)");
	else if (typeof attachmentRecord.text === "string" && attachmentRecord.text !== "") lines.push(attachmentRecord.text);
	else lines.push("(empty text)");
	if (attachmentRecord.truncated === true) {
		const offset = attachmentRecord.offset;
		const read = attachmentRecord.read;
		const next = (typeof offset === "number" && Number.isInteger(offset) ? offset : 0) + (typeof read === "number" && Number.isInteger(read) ? read : 0);
		lines.push("", `(truncated; continue with offset=${next})`);
	}
	return lines.join("\n");
}
/**
* 四个工具共用的可见性条件：只对工作流机器人会话可见。
*
* 条件在每一步都会执行；`ensureIndex` 只建一次索引。任何索引构建失败都按
* “不可见”处理，不能让一个坏运行记录让会话的 step preparation 失败。
*
* @param input 索引构建与运行反查
* @returns 工具可见性条件
*/
function createSessionToolVisibility({ ensureIndex, resolveSession } = {
	ensureIndex: async () => void 0,
	resolveSession: () => null
}) {
	if (typeof ensureIndex !== "function") throw new TypeError("createSessionToolVisibility: ensureIndex is required");
	if (typeof resolveSession !== "function") throw new TypeError("createSessionToolVisibility: resolveSession is required");
	return async (context) => {
		if (context?.signal?.aborted) return false;
		try {
			await ensureIndex();
		} catch {
			return false;
		}
		if (context?.signal?.aborted) return false;
		const binding = resolveSession(context?.agent?.id ?? "");
		return binding !== null && binding !== void 0;
	};
}
/**
* 创建四个只读工具。
*
* @param input 工具工厂、运行存储与会话反查
* @returns 注册用的四个工具定义
*/
function createWorkflowSessionTools({ defineTool, store, resolveSession }) {
	if (typeof defineTool !== "function") throw new TypeError("createWorkflowSessionTools: defineTool is required");
	if (store === null || typeof store !== "object") throw new TypeError("createWorkflowSessionTools: store is required");
	if (typeof resolveSession !== "function") throw new TypeError("createWorkflowSessionTools: resolveSession is required");
	/**
	* 官方 `defineTool` 的泛型会从 schema 反推精确返回值；这里的工具定义按运行时
	* 形状书写，统一在这个边界收口（运行时仍由 DSH 按其 schema 校验）。
	*/
	function tool(definition) {
		return defineTool(definition);
	}
	/**
	* 从调用者会话反查运行；解析不到时说明这些工具只属于工作流机器人会话。
	*
	* @param exec 工具执行上下文
	* @returns 运行 id
	*/
	function runIdOf(exec) {
		const agent = isRecord$1(exec) && isRecord$1(exec.agent) ? exec.agent : null;
		const sessionId = agent !== null && typeof agent.id === "string" ? agent.id : "";
		const binding = sessionId === "" ? null : resolveSession(sessionId);
		const runId = typeof binding?.runId === "string" ? binding.runId : "";
		if (runId === "") throw new Error("workflow inspection tools are only available to robot sessions that belong to a workflow run");
		return runId;
	}
	return [
		tool({
			name: "buka_workflow_overview",
			description: "Inspect the workflow run this robot session belongs to. Returns a compact node graph (node ids, types, summaries, states, edges), the current status, and the numbered execution list in execution order. It never returns prompts, final texts, edge prompts or other execution details: use buka_workflow_execution_input / buka_workflow_execution_output with an execution number from this list when you need the details of one execution.",
			parameters: {},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						run: {
							type: "json",
							required: true,
							description: "Compact run status and pointers."
						},
						nodes: {
							type: "json",
							required: true,
							description: "Workflow nodes with state and summary."
						},
						edges: {
							type: "json",
							required: true,
							description: "Workflow edges without prompts."
						},
						executions: {
							type: "json",
							required: true,
							description: "Executions in sequence order."
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: renderOverview(value)
				}]
			},
			async execute(_args, exec) {
				const runId = runIdOf(exec);
				return overviewValue(await readRunOrThrow(store, runId), await store.readDefinition(runId));
			}
		}),
		tool({
			name: "buka_workflow_execution_input",
			description: "Read the exact input recorded for one execution of the workflow run this robot session belongs to. Use the execution number (seq) from the buka_workflow_overview execution list. A robot execution returns the rendered prompt that was sent to that robot session; a user execution returns the title, rendered instruction and choices that were shown to the user. Read-only.",
			parameters: { seq: {
				type: "number",
				required: true,
				description: "Execution number (seq) from the buka_workflow_overview execution list."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						seq: {
							type: "number",
							required: true
						},
						nodeId: {
							type: "string",
							required: true
						},
						visit: {
							oneOf: [{ type: "number" }, { type: "null" }],
							required: true
						},
						type: {
							type: "string",
							required: true
						},
						robot: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						status: {
							type: "string",
							required: true
						},
						input: {
							type: "string",
							required: true
						},
						truncated: {
							type: "boolean",
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: renderExecutionInput(value)
				}]
			},
			async execute(args, exec) {
				const runId = runIdOf(exec);
				const seq = requireSeq(args?.seq);
				const run = await readRunOrThrow(store, runId);
				const found = findExecution(run, seq);
				if (found === null) throw new Error(`execution #${seq} was not found in workflow run "${runId}"; use the execution list from buka_workflow_overview`);
				const step = found.step;
				if (step.type === "user") {
					const node = definitionNode(await store.readDefinition(runId), typeof step.nodeId === "string" ? step.nodeId : "");
					const pending = found.running && run.pendingUser?.nodeId === step.nodeId ? run.pendingUser : null;
					const title = pending?.title ?? (typeof node?.title === "string" ? node.title : "");
					const detail = typeof pending?.detail === "string" && pending.detail !== "" ? pending.detail : typeof step.input === "string" && step.input !== "" ? step.input : typeof node?.detail === "string" ? node.detail : "";
					const optionLines = (Array.isArray(pending?.options) ? pending.options : Array.isArray(node?.next) ? node.next : []).filter((option) => option !== null && typeof option === "object" && typeof option.label === "string").map((option) => `- ${String(option.label)}${typeof option.description === "string" && option.description !== "" ? `: ${option.description}` : ""}`);
					const parts = [title, detail];
					if (optionLines.length > 0) parts.push(`choices:\n${optionLines.join("\n")}`);
					return {
						seq,
						nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
						visit: Number.isInteger(step.visit) ? step.visit : null,
						type: "user",
						robot: null,
						status: found.running ? "waiting" : typeof step.status === "string" ? step.status : "unknown",
						input: parts.filter((part) => typeof part === "string" && part !== "").join("\n"),
						truncated: false
					};
				}
				const result = await store.readNodeResult(runId, seq, typeof step.nodeId === "string" ? step.nodeId : "");
				let input = typeof result?.prompt === "string" ? result.prompt : "";
				const runningActive = found.running ? activesOf(run).find((item) => item.seq === seq) : void 0;
				if (input === "" && runningActive !== void 0 && typeof runningActive.prompt === "string") input = runningActive.prompt;
				if (input === "") throw new Error(`execution #${seq} (node "${step.nodeId}") has no recorded input in workflow run "${runId}"`);
				return {
					seq,
					nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
					visit: Number.isInteger(step.visit) ? step.visit : null,
					type: typeof step.type === "string" ? step.type : "robot",
					robot: typeof step.robot === "string" && step.robot !== "" ? step.robot : null,
					status: typeof step.status === "string" ? step.status : "unknown",
					input,
					truncated: result?.promptTruncated === true
				};
			}
		}),
		tool({
			name: "buka_workflow_execution_output",
			description: "Read the recorded output of one execution of the workflow run this robot session belongs to. Use the execution number (seq) from the buka_workflow_overview execution list. A robot execution returns its final text, structured JSON result, attachment manifest, route, stop reason and error; a node that aborted the workflow reports stopReason \"aborted\" with its reason in error. A user execution returns the readable answer transcript plus the chosen route and recorded answers. A running execution has no output yet. Use buka_workflow_execution_attachment to read an attachment. Read-only.",
			parameters: { seq: {
				type: "number",
				required: true,
				description: "Execution number (seq) from the buka_workflow_overview execution list."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						seq: {
							type: "number",
							required: true
						},
						nodeId: {
							type: "string",
							required: true
						},
						visit: {
							oneOf: [{ type: "number" }, { type: "null" }],
							required: true
						},
						type: {
							type: "string",
							required: true
						},
						robot: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						status: {
							type: "string",
							required: true
						},
						stopReason: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						output: {
							type: "string",
							required: true
						},
						structured: {
							type: "json",
							required: true
						},
						attachments: {
							type: "array",
							required: true,
							description: "Attachment manifest for this execution; use buka_workflow_execution_attachment to read one.",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									index: {
										type: "number",
										required: true
									},
									name: {
										type: "string",
										required: true
									},
									bytes: {
										type: "number",
										required: true
									},
									description: {
										oneOf: [{ type: "string" }, { type: "null" }],
										required: true
									}
								}
							}
						},
						route: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						routeTo: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						error: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						truncated: {
							type: "boolean",
							required: true
						},
						finishedAt: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: renderExecutionOutput(value)
				}]
			},
			async execute(args, exec) {
				const runId = runIdOf(exec);
				const seq = requireSeq(args?.seq);
				const found = findExecution(await readRunOrThrow(store, runId), seq);
				if (found === null) throw new Error(`execution #${seq} was not found in workflow run "${runId}"; use the execution list from buka_workflow_overview`);
				const step = found.step;
				if (step.type === "user") {
					if (found.running) throw new Error(`execution #${seq} (user "${step.nodeId}") is still waiting for the user and has no output yet`);
					const answers = Array.isArray(step.answers) ? step.answers : [];
					return {
						seq,
						nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
						visit: Number.isInteger(step.visit) ? step.visit : null,
						type: "user",
						robot: null,
						status: typeof step.status === "string" ? step.status : "unknown",
						stopReason: null,
						output: typeof step.text === "string" ? step.text : "",
						structured: {
							route: typeof step.route === "string" && step.route !== "" ? step.route : null,
							routeTo: typeof step.routeTo === "string" && step.routeTo !== "" ? step.routeTo : null,
							answers
						},
						attachments: [],
						route: typeof step.route === "string" && step.route !== "" ? step.route : null,
						routeTo: typeof step.routeTo === "string" && step.routeTo !== "" ? step.routeTo : null,
						error: typeof step.error === "string" && step.error !== "" ? step.error : null,
						truncated: false,
						finishedAt: isoTime(step.finishedAt)
					};
				}
				if (found.running) throw new Error(`execution #${seq} (node "${step.nodeId}") is still running and has no output yet`);
				const result = await store.readNodeResult(runId, seq, typeof step.nodeId === "string" ? step.nodeId : "");
				if (result === null) throw new Error(`execution #${seq} (node "${step.nodeId}") has no recorded output in workflow run "${runId}"`);
				return {
					seq,
					nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
					visit: Number.isInteger(step.visit) ? step.visit : null,
					type: typeof step.type === "string" ? step.type : "robot",
					robot: typeof step.robot === "string" && step.robot !== "" ? step.robot : null,
					status: typeof step.status === "string" ? step.status : "unknown",
					stopReason: typeof result.stopReason === "string" ? result.stopReason : typeof step.stopReason === "string" ? step.stopReason : null,
					output: typeof result.text === "string" ? result.text : "",
					structured: result.structured ?? step.data ?? null,
					attachments: attachmentManifest(result.attachments),
					route: typeof step.route === "string" && step.route !== "" ? step.route : null,
					routeTo: typeof step.routeTo === "string" && step.routeTo !== "" ? step.routeTo : null,
					error: typeof result.error === "string" && result.error !== "" ? result.error : typeof step.error === "string" && step.error !== "" ? step.error : null,
					truncated: result.textTruncated === true,
					finishedAt: isoTime(step.finishedAt ?? result.finishedAt)
				};
			}
		}),
		tool({
			name: "buka_workflow_execution_attachment",
			description: "List or read the attachment files recorded for one execution of the workflow run this robot session belongs to. Use the execution number (seq) from the buka_workflow_overview execution list. Omit name to list the attachment manifest; pass name to read one file. Text is returned up to maxBytes (default 64 KiB) and can be continued with offset; binary files return metadata and an absolute path instead of text. Read-only: only attachments recorded for this run are accessible.",
			parameters: {
				seq: {
					type: "number",
					required: true,
					description: "Execution number (seq) from the buka_workflow_overview execution list."
				},
				name: {
					type: "string",
					description: "Attachment name from the manifest. Omit to list all attachments."
				},
				offset: {
					type: "number",
					description: "Byte offset for reading a text attachment. Defaults to 0."
				},
				maxBytes: {
					type: "number",
					description: "Maximum bytes to read (default 64 KiB, capped at 256 KiB)."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						seq: {
							type: "number",
							required: true
						},
						nodeId: {
							type: "string",
							required: true
						},
						type: {
							type: "string",
							required: true
						},
						robot: {
							oneOf: [{ type: "string" }, { type: "null" }],
							required: true
						},
						status: {
							type: "string",
							required: true
						},
						attachments: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									index: {
										type: "number",
										required: true
									},
									name: {
										type: "string",
										required: true
									},
									bytes: {
										type: "number",
										required: true
									},
									description: {
										oneOf: [{ type: "string" }, { type: "null" }],
										required: true
									}
								}
							}
						},
						attachment: {
							oneOf: [{
								type: "object",
								additionalProperties: false,
								properties: {
									index: {
										type: "number",
										required: true
									},
									name: {
										type: "string",
										required: true
									},
									description: {
										oneOf: [{ type: "string" }, { type: "null" }],
										required: true
									},
									bytes: {
										type: "number",
										required: true
									},
									path: {
										type: "string",
										required: true
									},
									text: {
										oneOf: [{ type: "string" }, { type: "null" }],
										required: true
									},
									binary: {
										type: "boolean",
										required: true
									},
									truncated: {
										type: "boolean",
										required: true
									},
									offset: {
										type: "number",
										required: true
									},
									read: {
										type: "number",
										required: true
									}
								}
							}, { type: "null" }],
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: renderExecutionAttachment(value)
				}]
			},
			async execute(args, exec) {
				const runId = runIdOf(exec);
				const seq = requireSeq(args?.seq);
				const found = findExecution(await readRunOrThrow(store, runId), seq);
				if (found === null) throw new Error(`execution #${seq} was not found in workflow run "${runId}"; use the execution list from buka_workflow_overview`);
				const step = found.step;
				if (found.running) throw new Error(`execution #${seq} (node "${step.nodeId}") is still running and has no attachments yet`);
				if (step.type === "user") {
					if (typeof args?.name === "string" && args.name.trim() !== "") throw new Error(`execution #${seq} (user "${step.nodeId}") has no attachments`);
					return {
						seq,
						nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
						type: "user",
						robot: null,
						status: found.running ? "waiting" : typeof step.status === "string" ? step.status : "unknown",
						attachments: [],
						attachment: null
					};
				}
				const result = await store.readNodeResult(runId, seq, typeof step.nodeId === "string" ? step.nodeId : "");
				if (result === null) throw new Error(`execution #${seq} (node "${step.nodeId}") has no recorded output in workflow run "${runId}"`);
				const attachments = attachmentManifest(result.attachments);
				const name = typeof args?.name === "string" ? args.name.trim() : "";
				if (name === "") return {
					seq,
					nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
					type: typeof step.type === "string" ? step.type : "robot",
					robot: typeof step.robot === "string" && step.robot !== "" ? step.robot : null,
					status: typeof step.status === "string" ? step.status : "unknown",
					attachments,
					attachment: null
				};
				const rawOffset = args?.offset;
				if (rawOffset !== void 0 && (typeof rawOffset !== "number" || !Number.isInteger(rawOffset) || rawOffset < 0)) throw new Error("offset must be a non-negative integer");
				const rawMaxBytes = args?.maxBytes;
				if (rawMaxBytes !== void 0 && (typeof rawMaxBytes !== "number" || !Number.isInteger(rawMaxBytes) || rawMaxBytes <= 0)) throw new Error("maxBytes must be a positive integer");
				const maxBytes = typeof rawMaxBytes === "number" && Number.isInteger(rawMaxBytes) ? Math.min(rawMaxBytes, MAX_ATTACHMENT_READ_BYTES) : DEFAULT_ATTACHMENT_READ_BYTES;
				const attachment = await store.readAttachment(runId, seq, step.nodeId, name, {
					offset: typeof rawOffset === "number" && Number.isInteger(rawOffset) ? rawOffset : 0,
					maxBytes
				});
				if (attachment === null) {
					const available = attachments.map((entry) => entry.name).join(", ");
					throw new Error(`attachment "${name}" was not found for execution #${seq}; available: ${available === "" ? "(none)" : available}`);
				}
				return {
					seq,
					nodeId: typeof step.nodeId === "string" ? step.nodeId : "",
					type: typeof step.type === "string" ? step.type : "robot",
					robot: typeof step.robot === "string" && step.robot !== "" ? step.robot : null,
					status: typeof step.status === "string" ? step.status : "unknown",
					attachments,
					attachment
				};
			}
		})
	];
}
// .build/workflows/run.js
/**
* 工作流运行期的纯函数与错误类型（workflow format 3）。
*
* 这些工具从旧的阻塞执行器 `engine.js` 里搬出来，供 Host 侧观察者
* `supervisor.js` 复用：渲染机器人节点的提示词、给机器人会话起标题、构造用户
* 介入节点的提问批次与解析回答、把运行记录转成工具返回值等。本模块不 import
* 任何 DSH 包，也不读写磁盘，便于单测。
*
* format 3 里机器人节点没有自己的 prompt：每次进入都渲染「进入它的那条边」上的
* prompt，所以 `renderNodePrompt` 只接受 edgePrompt 一个来源；用户节点则把
* `detail` 渲染后交给原生提问卡，用户的选项就是出边。
*
* @module @buka/dsh-plugin-workflows/run
*/
/** 运行级错误：节点失败、超出步数、缺少服务等。 */
var WorkflowRunError = class extends Error {
	/**
	* @param message 错误信息
	* @param options 可选原因
	*/
	constructor(message, options) {
		super(message);
		this.name = "WorkflowRunError";
		if (options?.cause !== void 0) this.cause = options.cause;
	}
};
/** 运行被取消。 */
var WorkflowCancelledError = class extends Error {
	/**
	* @param message 错误信息
	*/
	constructor(message) {
		super(message);
		this.name = "WorkflowCancelledError";
	}
};
/**
* 渲染一个机器人节点的最终提示词。
*
* format 2 只在进入节点的边上定义 prompt：`edgePrompt` 必须存在，渲染后也不能为
* 空；不存在节点自身 prompt 的兼容回退。渲染完成后追加节点声明的结果契约
* （`output` 合并 `next` 与附件能力后的 schema）；升级前没有 `output` 的快照
* 不追加，保持旧提示词。
*
* @param node 已规范化的机器人节点
* @param edgePrompt 走到进入这条边时携带的 prompt 模板
* @param values 已完成节点的结果，供 `{{nodes.<id>...}}` 引用
* @param plan 运行计划
* @param step 当前步数
* @param runId 运行 id
* @returns 渲染后的提示词
*/
function renderNodePrompt(node, edgePrompt, values, plan, step, runId) {
	if (typeof edgePrompt !== "string" || edgePrompt === "") throw new WorkflowRunError(`robot node "${node.id}" has no prompt on its incoming edge`);
	const prompt = renderTemplate(edgePrompt, {
		goal: plan.goal,
		nodes: values,
		step,
		runId
	});
	if (prompt.trim() === "") throw new WorkflowRunError(`robot node "${node.id}" has no prompt on its incoming edge`);
	const contract = renderOutputContract(node);
	return contract === "" ? prompt : `${prompt}\n\n${contract}`;
}
/**
* 渲染用户节点的说明（`detail`）。说明可以引用前面节点的文本 / 结构化结果 /
* 用户回答；为空时返回空串，调用方在提问卡里退回 `title`。
*
* @param node 已规范化的用户节点
* @param values 已完成节点的结果，供 `{{nodes.<id>...}}` 引用
* @param plan 运行计划
* @param step 当前步数
* @param runId 运行 id
* @returns 渲染后的说明；为空时是空串
*/
function renderUserDetail(node, values, plan, step, runId) {
	const template = typeof node.detail === "string" ? node.detail : "";
	if (template.trim() === "") return "";
	return renderTemplate(template, {
		goal: plan.goal,
		nodes: values,
		step,
		runId
	});
}
/**
* 机器人会话的标题：`运行目标 · 机器人`。
*
* 机器人会话的第一条用户消息来源是 `buka-robot`，DSH 的自动标题只看 `user`
* 来源的消息，所以不会给这类会话生成标题。工作流在进入节点时显式命名，
* 侧边栏里才能一眼看出这段对话属于哪次运行、哪个机器人。
*
* 标题按 UTF-8 字节裁剪：机器人名优先保留，运行目标裁到剩余预算里；运行没有
* goal 时退回 `工作流 <runId>`。
*
* @param run 运行记录（只用到 goal / runId）
* @param node 机器人节点（只用到 robot）
* @returns 会话标题
*/
function robotSessionTitle(run, node) {
	const robot = typeof node?.robot === "string" ? node.robot.trim() : "";
	const goal = typeof run?.goal === "string" ? run.goal.replace(/\s+/gu, " ").trim() : "";
	const runId = typeof run?.runId === "string" ? run.runId.trim() : "";
	const base = goal !== "" ? goal : runId !== "" ? `工作流 ${runId}` : "工作流";
	if (robot === "") return clipUtf8(base, 80);
	const suffix = ` · ${robot}`;
	const suffixBytes = Buffer.byteLength(suffix, "utf8");
	if (suffixBytes >= 80) return clipUtf8(robot, 80);
	const clipped = clipUtf8(base, 80 - suffixBytes).trimEnd();
	return clipped === "" ? clipUtf8(robot, 80) : `${clipped}${suffix}`;
}
/**
* 按 UTF-8 字节裁剪，不切断码点。
*
* @param text 原文
* @param maxBytes 字节上限
* @returns 截断后的文本
*/
function clipUtf8(text, maxBytes) {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let used = 0;
	let output = "";
	for (const character of text) {
		const bytes = Buffer.byteLength(character, "utf8");
		if (used + bytes > maxBytes) break;
		output += character;
		used += bytes;
	}
	return output;
}
/**
* 用户节点问题批次里的 route 问题 id：用户的选项就是节点的出边。
*
* @param node 已规范化的用户节点
* @param detail 已渲染的说明（为空时用 title 作为问题正文）
* @returns 传给 ctx.userQuestions.ask() 的问题数组
*/
function buildUserQuestions(node, detail) {
	const questions = [];
	const edges = Array.isArray(node.next) ? node.next : [];
	const title = typeof node.title === "string" ? node.title : "";
	if (edges.length > 0) questions.push({
		id: ROUTE_QUESTION_ID,
		header: title,
		question: typeof detail === "string" && detail.trim() !== "" ? detail.trim() : title,
		options: edges.map((edge) => typeof edge.description === "string" && edge.description !== "" ? {
			label: edge.label ?? "",
			description: edge.description
		} : { label: edge.label ?? "" })
	});
	for (const question of Array.isArray(node.questions) ? node.questions : []) {
		const item = {
			id: question.id,
			question: question.question
		};
		if (typeof question.header === "string" && question.header !== "") item.header = question.header;
		if (Array.isArray(question.options) && question.options.length > 0) item.options = question.options.map((option) => typeof option.description === "string" && option.description !== "" ? {
			label: option.label,
			description: option.description
		} : { label: option.label });
		if (question.multiSelect === true) item.multiSelect = true;
		questions.push(item);
	}
	return questions;
}
/**
* 解析用户节点的回答。
*
* 返回 `{ ok: true, route, answers, text }`；`route` 是选中的出边（没有出边时为
* null）。用户没有做出选择（跳过 / 只写了自定义文本）时返回
* `{ cancelled: true, answers, text }`，让运行以 cancelled 结束。答案是
* `{ id, selected, custom }` 数组，`custom` 缺省补空串，方便模板直接取值。
*
* @param node 已规范化的用户节点
* @param answer 原生提问卡的原始回答
* @returns 解析结果
*/
function resolveUserAnswer(node, answer) {
	const received = /* @__PURE__ */ new Map();
	for (const item of Array.isArray(answer?.answers) ? answer.answers : []) {
		if (typeof item?.id !== "string") continue;
		const selected = Array.isArray(item.selected) ? item.selected.filter((label) => typeof label === "string" && label !== "") : [];
		const custom = typeof item.custom === "string" ? item.custom.trim() : "";
		received.set(item.id, {
			selected,
			custom
		});
	}
	const answers = [];
	const edges = Array.isArray(node.next) ? node.next : [];
	let route = null;
	let cancelled = false;
	const lines = [];
	if (edges.length > 0) {
		const raw = received.get("route") ?? {
			selected: [],
			custom: ""
		};
		answers.push({
			id: ROUTE_QUESTION_ID,
			selected: [...raw.selected],
			custom: ""
		});
		if (raw.selected.length === 0) cancelled = true;
		else if (raw.selected.length > 1) return {
			ok: false,
			error: `the route choice must be a single option, received ${raw.selected.length}`,
			answers,
			text: ""
		};
		else {
			const label = raw.selected[0];
			const edge = edges.find((item) => item.label === label);
			if (edge === void 0) return {
				ok: false,
				error: `received an unknown choice "${label}"`,
				answers,
				text: ""
			};
			route = edge;
			lines.push(`选择：${label}`);
		}
	}
	for (const question of Array.isArray(node.questions) ? node.questions : []) {
		const raw = received.get(question.id) ?? {
			selected: [],
			custom: ""
		};
		answers.push({
			id: question.id,
			selected: [...raw.selected],
			custom: raw.custom
		});
		const heading = question.header !== "" ? question.header : question.question;
		const parts = [];
		if (raw.selected.length > 0) parts.push(raw.selected.join("、"));
		if (raw.custom !== "") parts.push(`（${raw.custom}）`);
		if (parts.length > 0) lines.push(`${heading}：${parts.join("")}`);
	}
	return {
		ok: true,
		cancelled,
		route,
		answers,
		text: cancelled && edges.length > 0 ? "" : lines.join("\n")
	};
}
/**
* 把规范化后的答案数组转成按问题 id 索引的对象（模板 / 运行记录用）。
*
* @param answers 规范化后的回答数组
* @returns 按问题 id 索引的对象
*/
function answersValue(answers) {
	const value = {};
	for (const answer of answers) value[answer.id] = {
		selected: [...answer.selected],
		custom: answer.custom
	};
	return value;
}
/**
* 把运行记录转成工具返回值（不携带完整节点文本）。
*
* @param run 运行记录
* @returns 工具返回值
*/
function toToolRun(run) {
	return {
		runId: run.runId,
		seq: Number.isInteger(run.seq) ? run.seq : null,
		status: run.status,
		goal: run.goal,
		createdAt: run.createdAt,
		finishedAt: run.finishedAt ?? null,
		current: run.current ?? null,
		active: Array.isArray(run.active) ? run.active.map((entry) => ({ ...entry })) : [],
		pendingUser: run.pendingUser ?? null,
		pendingInteraction: run.pendingInteraction ?? null,
		sessions: Array.isArray(run.sessions) ? run.sessions.map((session) => ({ ...session })) : [],
		steps: Array.isArray(run.steps) ? run.steps.map((step) => ({ ...step })) : [],
		result: run.result ?? null,
		error: run.error ?? null
	};
}
// .build/workflows/engine/supervisor-types.js
/**
* 观察者的类型、常量与构造原语。
*
* 运行上下文、会话句柄、dispatch 登记项等内部形状都在这里；上层模块只通过
* `WorkflowSupervisor` 的字段与方法协作。
*/
/** 判断普通对象。 */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 启动恢复等待 robots 服务出现的上限。 */
const ROBOTS_WAIT_MS = 5e3;
/** 这些结束原因视为“会话中断”，可以尝试续跑；`max-tokens` / `blocked` 直接失败。 */
const RECOVERABLE_STOP_REASONS = /* @__PURE__ */ new Set([
	"aborted",
	"interrupted",
	"error"
]);
/**
* plan 节点的一轮结束时仍停在计划阶段、又没有弹出审阅卡时，发出的唯一一次
* 协议提示。它不是行为提示词，只把节点拉回 plan 模式的正常收尾路径。
*/
const PLAN_REVIEW_NUDGE = "You are still in plan mode. Present your finished plan through the exit_plan_mode tool so the user can approve it; do not submit this node's structured result before the plan is approved.";
/**
* @param error
* @returns
*/
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* @param value
* @returns
*/
function positive(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
/**
* @returns
*/
function createRunId() {
	return `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
/**
* @returns
*/
function deferred() {
	let resolve;
	let reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve(value) {
			this.settled = true;
			resolve(value);
		},
		reject(error) {
			this.settled = true;
			reject(error);
		},
		settled: false
	};
}
// .build/workflows/engine/supervisor-advance.js
/**
* 运行推进：按边路由到下一个节点，并在全部结束时收尾。
*/
/**
* @param ctx
* @returns
*/
function advance(host, ctx) {
	return host.enqueue(ctx.runId, () => host.advanceInner(ctx));
}
/**
* 消费 frontier 里的待处理 next-hop：robot 节点 dispatch 后继续（非阻塞），
* user 节点在前台模式等用户作答，end 收尾一个分支；join 不进入 frontier（由
* 屏障激活）。frontier 与活跃任务都为空时结束运行。
*
* @param ctx
* @returns
*/
async function advanceInner(host, ctx) {
	while (!ctx.closed && !ctx.cancelled && ctx.frontier.length > 0) {
		const next = ctx.frontier.shift();
		if (next === void 0) break;
		const node = ctx.plan.nodes[next.nodeId];
		if (node === void 0) {
			await host.fail(ctx, new WorkflowRunError(`workflow node "${next.nodeId}" is missing`));
			return;
		}
		if (node.type === "end") {
			await host.arriveEnd(ctx, node);
			continue;
		}
		if (node.type === "user") {
			await host.runUser(ctx, node);
			continue;
		}
		if (node.type === "robot") {
			await host.startRobotNode(ctx, node, next.edgePrompt);
			continue;
		}
		if (node.type === "join") {
			await host.fail(ctx, new WorkflowRunError(`join node "${node.id}" must not be reached directly`));
			return;
		}
		await host.fail(ctx, new WorkflowRunError(`unsupported node type "${String(node.type)}"`));
		return;
	}
	await host.maybeFinish(ctx);
}
/**
* 一个分支到达 end：记录该分支终止。所有活跃任务与待处理 next-hop 都清空、
* 且没有 pending join 时才结束整个运行。
*
* @param ctx
* @param node
* @returns
*/
async function arriveEnd(host, ctx, node) {
	if (ctx.closed || ctx.cancelled) return;
	ctx.lastEnd = node;
	await host.maybeFinish(ctx);
}
/**
* 没有任何活跃任务 / 待处理 next-hop / pending join 时收尾。
*
* @param ctx
* @returns
*/
async function maybeFinish(host, ctx) {
	if (ctx.closed || ctx.cancelled) return;
	if (ctx.frontier.length > 0) return;
	if (Array.isArray(ctx.run.active) && ctx.run.active.length > 0) return;
	if (ctx.run.pendingUser !== null && ctx.run.pendingUser !== void 0) return;
	if (ctx.joins.size > 0) return;
	const lastEnd = ctx.lastEnd ?? null;
	const nodeId = lastEnd !== null && typeof lastEnd.id === "string" ? lastEnd.id : null;
	const status = lastEnd !== null && typeof lastEnd.status === "string" ? lastEnd.status : "completed";
	await host.finish(ctx, status, { nodeId });
}
/**
* @param ctx
* @param status
* @param [extra]
* @returns
*/
async function finish(host, ctx, status, extra = {}) {
	if (ctx.closed) return ctx.run;
	ctx.closed = true;
	const run = ctx.run;
	run.status = status;
	run.updatedAt = Date.now();
	run.finishedAt = run.updatedAt;
	run.current = null;
	run.active = [];
	run.pendingUser = null;
	run.pendingInteraction = null;
	run.result = {
		status,
		lastNode: extra.nodeId ?? null,
		...extra.message === void 0 ? {} : { message: extra.message },
		...extra.aborted === true ? { aborted: true } : {},
		...status === "failed" && run.error !== null ? { error: run.error } : {}
	};
	for (const entry of host.dispatchEntriesForRun(ctx.runId)) {
		host.clearEntryPlanMode(entry);
		host.removeEntry(entry);
		try {
			await entry.handle?.dispose?.();
		} catch {}
	}
	try {
		await host.save(ctx);
		await host.store.appendEvent(ctx.runId, "run/end", {
			status,
			result: run.result
		});
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 写入运行结束状态失败（${ctx.runId}）：${describeError(error)}`);
	}
	host.runs.delete(ctx.runId);
	if (!ctx.done.settled) ctx.done.resolve(toToolRun(run));
	return run;
}
/**
* @param ctx
* @param error
* @returns
*/
async function fail(host, ctx, error) {
	if (ctx.closed) return ctx.run;
	const activeNodeId = host.activeNodeId(ctx);
	if (error instanceof WorkflowCancelledError || ctx.cancelled === true) return await host.finish(ctx, "cancelled", {
		nodeId: activeNodeId,
		message: describeError(error)
	});
	ctx.run.error = describeError(error);
	host.logger?.warn?.(`buka-workflows: run ${ctx.runId} failed: ${ctx.run.error}`);
	return await host.finish(ctx, "failed", { nodeId: activeNodeId });
}
// .build/workflows/engine/supervisor-sessions.js
/**
* 运行记录里的机器人会话台账：节点进入 / 结果摘要与会话索引的读写工具。
*/
/**
* 只保留运行页展示需要的问题字段，并限制体积。
*
* @param questions
* @returns
*/
function normalizeQuestions(questions) {
	if (!Array.isArray(questions)) return [];
	return questions.slice(0, 5).map((rawQuestion) => {
		const question = isRecord(rawQuestion) ? rawQuestion : {};
		return {
			id: clipText(question.id, 64),
			header: clipText(question.header, 200),
			question: clipText(question.question, 1e3),
			multiSelect: question.multiSelect === true,
			options: Array.isArray(question.options) ? question.options.slice(0, 20).map((rawOption) => {
				return { label: clipText((isRecord(rawOption) ? rawOption : {}).label, 200) };
			}) : []
		};
	}).filter((question) => question.question !== "" || question.header !== "");
}
/**
* @param value
* @param max
* @returns
*/
function clipText(value, max) {
	if (typeof value !== "string") return "";
	const text = value.trim();
	return text.length > max ? text.slice(0, max) : text;
}
/**
* @param run
* @param robot
* @returns
*/
function findRobotSession(run, robot) {
	if (!Array.isArray(run?.sessions) || typeof robot !== "string" || robot === "") return void 0;
	return run.sessions.find((entry) => entry?.robot === robot);
}
/**
* 记录一次进入：每个 robot 一个会话条目，entries 里保留每次进入的节点 / 序号。
*
* @param run
* @param robot
* @param input
* @returns
*/
function rememberSessionEntry(run, robot, { nodeId, visit, seq, sessionId, at, resumed, compacted }) {
	if (typeof robot !== "string" || robot === "") return;
	if (!Array.isArray(run.sessions)) run.sessions = [];
	let existing = findRobotSession(run, robot);
	if (existing === void 0) {
		existing = {
			robot,
			sessionId: sessionId ?? "",
			firstNodeId: nodeId,
			lastNodeId: nodeId,
			visits: 0,
			createdAt: at,
			entries: []
		};
		run.sessions.push(existing);
	}
	if (typeof sessionId === "string" && sessionId !== "") {
		if (existing.sessionId !== sessionId && existing.sessionId !== "") existing.resets = (existing.resets ?? 0) + 1;
		existing.sessionId = sessionId;
	}
	existing.lastNodeId = nodeId;
	existing.lastVisit = visit;
	if (!Array.isArray(existing.entries)) existing.entries = [];
	if (existing.entries.some((entry) => entry?.nodeId === nodeId && entry?.seq === seq && entry?.sessionId === (sessionId ?? null))) return;
	existing.visits = (typeof existing.visits === "number" && Number.isInteger(existing.visits) ? existing.visits : 0) + 1;
	existing.entries.push({
		nodeId,
		visit,
		seq,
		sessionId: sessionId ?? null,
		at,
		resumed,
		compacted
	});
	if (existing.entries.length > 500) existing.entries.splice(0, existing.entries.length - 500);
}
/**
* 完成一次进入后更新会话摘要。
*
* @param run
* @param robot
* @param input
* @returns
*/
function updateRobotSession(run, robot, { nodeId, visit, sessionId, at }) {
	const existing = findRobotSession(run, robot);
	if (existing === void 0) return;
	existing.lastNodeId = nodeId;
	existing.lastVisit = visit;
	existing.updatedAt = at;
	if (typeof sessionId === "string" && sessionId !== "" && existing.sessionId === "") existing.sessionId = sessionId;
}
// .build/workflows/engine/supervisor-dispatch.js
/**
* 机器人节点的 dispatch：创建 / 复用会话、登记句柄、超时与句柄校验。
*/
/**
* 进入一个 robot 节点：落盘 current + 运行中的节点结果，再非阻塞 dispatch。
*
* @param ctx
* @param node
* @param edgePrompt
* @returns
*/
async function startRobotNode(host, ctx, node, edgePrompt) {
	const run = ctx.run;
	const nodeId = node.id ?? "";
	const seq = ctx.seq + 1;
	if (seq > ctx.plan.maxSteps) {
		await host.fail(ctx, new WorkflowRunError(`workflow exceeded its ${ctx.plan.maxSteps}-step limit`));
		return;
	}
	const visit = (ctx.visits.get(nodeId) ?? 0) + 1;
	if (node.type === "robot" && node.maxVisits !== void 0 && visit > node.maxVisits) {
		await host.fail(ctx, new WorkflowRunError(`robot node "${nodeId}" exceeded its ${node.maxVisits}-visit limit`));
		return;
	}
	let prompt;
	try {
		prompt = renderNodePrompt(node, edgePrompt, ctx.values, ctx.plan, seq, run.runId);
	} catch (error) {
		await host.fail(ctx, error);
		return;
	}
	const timeoutMs = positive(node.timeoutMs) ?? positive(host.options.nodeTimeoutMs) ?? 0;
	const startedAt = Date.now();
	ctx.seq = seq;
	ctx.stepCount = seq;
	ctx.visits.set(nodeId, visit);
	run.pendingInteraction = null;
	const current = {
		nodeId,
		visit,
		seq,
		type: "robot",
		robot: node.robot,
		prompt,
		sessionId: null,
		startSeq: null,
		startedAt,
		attempt: 1,
		recoveryAttempts: 0,
		...node.mode === "plan" ? { mode: "plan" } : {},
		...timeoutMs > 0 ? { timeoutMs } : {}
	};
	if (!Array.isArray(run.active)) run.active = [];
	run.active.push(current);
	run.status = "running";
	await host.save(ctx);
	await host.store.appendEvent(run.runId, "node/start", {
		nodeId,
		visit,
		type: "robot",
		...node.robot === void 0 ? {} : { robot: node.robot },
		...node.mode === "plan" ? { mode: "plan" } : {}
	});
	await host.saveRunningNodeResult(ctx, current, node, prompt, startedAt);
	const robots = host.robots ?? host.ctx?.get?.("bukaRobots") ?? null;
	if (robots === null || !host.canDispatch(robots)) {
		await host.completeNode(ctx, current, node, {
			sessionId: null,
			text: "",
			stopReason: "error",
			error: "robot node needs a Buka Robots service with dispatchSession(); install or update @buka/dsh-plugin-robots"
		}, {});
		return;
	}
	if (node.mode === "plan" && robots.supportsPlanMode !== true) {
		await host.completeNode(ctx, current, node, {
			sessionId: null,
			text: "",
			stopReason: "error",
			error: "plan mode robot nodes need @buka/dsh-plugin-robots 0.9.0 or newer (supportsPlanMode is missing); update the Buka Robots plugin"
		}, {});
		return;
	}
	const previous = findRobotSession(run, node.robot);
	const previousSessionId = typeof previous?.sessionId === "string" && previous.sessionId !== "" ? previous.sessionId : "";
	const newSessionId = previousSessionId === "" ? randomUUID() : "";
	const dispatchKey = previousSessionId !== "" ? previousSessionId : newSessionId;
	current.sessionId = dispatchKey;
	current.startSeq = null;
	host.rememberSession(run.runId, dispatchKey);
	await host.save(ctx);
	const entry = {
		runId: run.runId,
		seq,
		startSeq: null,
		handle: null,
		early: [],
		claimed: false,
		recoveryRequested: false,
		disposedEarly: false,
		resultExhausted: false,
		timer: null,
		timeoutMs,
		planMode: node.mode === "plan",
		planReviewAsked: false,
		planNudged: false
	};
	host.dispatchBySession.set(dispatchKey, entry);
	let handle;
	try {
		const creator = host.creatorAgent(ctx);
		handle = await host.dispatchRobot(robots, {
			robot: node.robot,
			prompt,
			...creator === void 0 ? {} : { agent: creator },
			...host.options.robotPreset === "" ? {} : { agentPreset: host.options.robotPreset },
			outputSchema: buildResultSchema(node),
			routes: routeNamesOf(node),
			abortable: true,
			title: robotSessionTitle(run, node),
			...node.agentOptions === void 0 ? {} : { agentOptions: node.agentOptions },
			approval: "ask",
			signal: ctx.controller.signal,
			planMode: node.mode === "plan",
			...previousSessionId !== "" ? { sessionId: previousSessionId } : { newSessionId }
		});
	} catch (error) {
		host.dispatchBySession.delete(dispatchKey);
		current.sessionId = null;
		await host.completeNode(ctx, current, node, {
			sessionId: null,
			text: "",
			stopReason: "error",
			error: describeError(error)
		}, {});
		return;
	}
	current.sessionId = typeof handle.sessionId === "string" ? handle.sessionId : null;
	current.startSeq = typeof handle.startSeq === "number" && Number.isInteger(handle.startSeq) ? handle.startSeq : null;
	if (current.sessionId !== null) host.rememberSession(run.runId, current.sessionId);
	current.resumed = handle.resumed === true;
	current.compacted = handle.compacted === true;
	current.timeoutStartedAt = Date.now();
	if (typeof handle.resumeError === "string" && handle.resumeError !== "") current.sessionResetReason = handle.resumeError;
	if (typeof handle.compactionError === "string" && handle.compactionError !== "") current.compactionError = handle.compactionError;
	entry.handle = handle;
	entry.startSeq = typeof handle.startSeq === "number" && Number.isInteger(handle.startSeq) ? handle.startSeq : null;
	if (typeof current.sessionId === "string" && current.sessionId !== dispatchKey) {
		host.dispatchBySession.delete(dispatchKey);
		host.dispatchBySession.set(current.sessionId, entry);
	}
	rememberSessionEntry(run, node.robot, {
		nodeId,
		visit,
		seq,
		sessionId: current.sessionId,
		at: Date.now(),
		resumed: handle.resumed === true,
		compacted: handle.compacted === true
	});
	await host.save(ctx);
	await host.store.appendEvent(run.runId, "node/session", {
		nodeId,
		visit,
		sessionId: current.sessionId,
		resumed: handle.resumed === true
	});
	await host.store.appendEvent(run.runId, "node/dispatch", {
		nodeId,
		visit,
		seq,
		sessionId: current.sessionId,
		resumed: handle.resumed === true,
		compacted: handle.compacted === true
	});
	host.armTimeout(ctx, entry);
	const early = entry.early.splice(0);
	if (entry.disposedEarly === true) {
		entry.recoveryRequested = true;
		host.enqueue(ctx.runId, () => host.recoverNode(entry, "the robot session was disposed"));
		return;
	}
	for (const item of early) if (item.kind === "turn") {
		if (typeof item.event?.seq === "number" && entry.startSeq !== null && item.event.seq >= entry.startSeq) host.enqueue(ctx.runId, () => host.processTurn(entry, item.session, item.event));
	}
}
/**
* @param robots
* @param request
* @returns
*/
async function dispatchRobot(host, robots, request) {
	const dispatch = robots.dispatchSession;
	if (dispatch === void 0) throw new WorkflowRunError("the Buka Robots service cannot dispatch sessions");
	const handle = await host.requireVisibleHandle(await dispatch(request));
	if (typeof handle?.resumeError === "string" && handle.resumeError !== "") await host.rejectHandle(handle, `the Buka Robots service replaced an unresumable robot session with a new one (${handle.resumeError}); workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`);
	if (typeof request.sessionId === "string" && request.sessionId !== "") await host.requireSameSession(handle, request.sessionId);
	return handle;
}
/**
* 只有显式配置了 timeoutMs 才计时；默认不设 timer。
*
* @param ctx
* @param entry
* @returns
*/
function armTimeout(host, ctx, entry) {
	const current = host.findActive(ctx, entry.seq);
	const timeoutMs = positive(entry.timeoutMs);
	if (timeoutMs === void 0 || current === null) return;
	const startedAt = typeof current.timeoutStartedAt === "number" ? current.timeoutStartedAt : typeof current.startedAt === "number" ? current.startedAt : Date.now();
	const remaining = Math.max(0, timeoutMs - (Date.now() - startedAt));
	entry.timer = setTimeout(() => {
		entry.timer = null;
		host.enqueue(ctx.runId, () => host.onTimeout(ctx, entry, timeoutMs));
	}, remaining);
	entry.timer.unref?.();
}
/**
* 显式超时：取消当前轮，把节点记成超时失败；不进入恢复重试。
*
* @param ctx
* @param entry
* @param timeoutMs
* @returns
*/
async function onTimeout(host, ctx, entry, timeoutMs) {
	if (ctx.closed || ctx.cancelled || entry.claimed === true) return;
	const current = host.findActive(ctx, entry.seq);
	if (current === null) return;
	entry.claimed = true;
	host.removeEntry(entry);
	let result = { text: "" };
	try {
		result = await entry.handle?.cancel?.("timeout") ?? { text: "" };
	} catch {}
	host.clearEntryPlanMode(entry);
	try {
		await entry.handle?.dispose?.();
	} catch {}
	const node = ctx.plan.nodes[current.nodeId ?? ""];
	if (node === void 0) {
		await host.fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`));
		return;
	}
	await host.store.appendEvent(ctx.runId, "node/timeout", {
		nodeId: node.id,
		visit: current.visit,
		timeoutMs
	});
	await host.completeNode(ctx, current, node, {
		...result,
		sessionId: current.sessionId ?? null,
		stopReason: "timeout",
		error: `robot node "${node.id}" timed out after ${timeoutMs}ms`
	}, { timedOut: true });
}
/**
* 工作流只接受可见的普通会话。旧版 robots 插件在创建失败时可能返回
* `mode: 'subagent'` 的隐藏句柄；这里先释放它，再让节点按失败结束，
* 绝不把它当成节点会话继续调度。
*
* @param handle
* @returns
*/
async function requireVisibleHandle(host, handle) {
	if (handle?.mode !== "subagent") return handle;
	return await host.rejectHandle(handle, "the Buka Robots service returned a hidden subagent session; workflow robot sessions must be visible top-level sessions. Upgrade @buka/dsh-plugin-robots.");
}
/**
* 旧版 robots 服务在续接失败时可能换一个新会话：`resumeError` 非空，或
* 返回的 sessionId 与请求的不一致。工作流不接受替代会话。
*
* @param handle
* @param sessionId
* @returns
*/
async function requireSameSession(host, handle, sessionId) {
	if (typeof handle?.resumeError === "string" && handle.resumeError !== "") await host.rejectHandle(handle, `the Buka Robots service replaced an unresumable robot session with a new one (${handle.resumeError}); workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`);
	if (handle?.sessionId !== sessionId) await host.rejectHandle(handle, `the Buka Robots service returned robot session "${String(handle?.sessionId)}" instead of the requested "${sessionId}"; workflow stopped without opening a new session. Upgrade @buka/dsh-plugin-robots.`);
}
/**
* 释放一个不可接受的句柄，并让调用方以明确的错误终止节点。
*
* @param handle
* @param message
* @returns
*/
async function rejectHandle(_host, handle, message) {
	try {
		await handle?.dispose?.();
	} catch {}
	throw new WorkflowRunError(message);
}
// .build/workflows/engine/supervisor-events.js
/**
* 观察者的事件订阅：会话事件、人类交互旁听与会话释放清理。
*/
/** 注册全局事件订阅。 */
function subscribe(host) {
	if (typeof host.ctx?.on !== "function") return;
	const offs = [];
	try {
		offs.push(host.ctx.on("session/event", (session, event) => host.onSessionEvent(session, event), { global: true }));
	} catch {
		offs.push(host.ctx.on("session/event", (session, event) => host.onSessionEvent(session, event)));
	}
	offs.push(host.ctx.on("session/disposed", (session) => host.onSessionDisposed(session)));
	offs.push(host.ctx.on("agent/disposed", (payload) => host.onAgentDisposed(payload)));
	for (const event of ["user-questions/request", "approval/request"]) try {
		offs.push(host.ctx.on(event, (request, next) => host.onHumanRequest(event, request, next), { prepend: true }));
	} catch {}
	host.unsubscribes = offs;
}
/**
* 旁听机器人会话里的提问 / 审批，记录成 run.pendingInteraction，供运行页展示。
*
* 不截胡：先调用 `next()` 让真正的 answerer（Web UI / 自动审批）处理，再异步
* 记录/清除；返回值原样交回 waterfall。
*
* @param event
* @param request
* @param next
* @returns
*/
function onHumanRequest(host, event, request, next) {
	const answer = next();
	if (host.disposed) return answer;
	const requestRecord = isRecord(request) ? request : {};
	const agent = isRecord(requestRecord.agent) ? requestRecord.agent : null;
	const agentId = agent !== null ? agent.id : void 0;
	const entry = typeof agentId === "string" ? host.dispatchBySession.get(agentId) : void 0;
	if (entry === void 0) return answer;
	const ctx = host.runs.get(entry.runId);
	if (ctx === void 0 || ctx.closed || ctx.cancelled) return answer;
	const interactionId = randomUUID();
	const kind = event === "approval/request" ? "approval" : "question";
	const planReview = event === "user-questions/request" && Array.isArray(requestRecord.questions) && requestRecord.questions.some((question) => isRecord(question) && isRecord(question.intent) && question.intent.kind === "plan-review");
	if (planReview) entry.planReviewAsked = true;
	host.enqueue(entry.runId, () => host.recordInteraction(ctx, entry, kind, request, interactionId, planReview));
	const settle = () => {
		host.enqueue(entry.runId, () => host.clearInteraction(ctx, interactionId));
	};
	Promise.resolve(answer).then(settle, settle);
	return answer;
}
/**
* 把一次提问 / 审批写进运行记录。
*
* @param ctx
* @param entry
* @param kind
* @param request
* @param interactionId
* @param [planReview]
* @returns
*/
async function recordInteraction(host, ctx, entry, kind, request, interactionId, planReview = false) {
	if (ctx.closed || ctx.cancelled) return;
	const current = host.findActive(ctx, entry.seq);
	if (current === null) return;
	const requestRecord = isRecord(request) ? request : {};
	const questions = kind === "question" ? normalizeQuestions(requestRecord.questions) : void 0;
	if (kind === "question" && (questions === void 0 || questions.length === 0)) return;
	ctx.run.pendingInteraction = {
		id: interactionId,
		kind,
		nodeId: current.nodeId,
		visit: current.visit,
		seq: current.seq,
		robot: current.robot ?? null,
		sessionId: current.sessionId ?? null,
		askedAt: Date.now(),
		...planReview ? { planReview: true } : {},
		...questions === void 0 ? {} : { questions },
		...kind === "approval" ? {
			toolName: clipText(requestRecord.toolName, 120),
			reason: clipText(requestRecord.reason, 2e3),
			displayReason: clipText(requestRecord.displayReason, 1e3) || void 0,
			callId: typeof requestRecord.callId === "string" ? requestRecord.callId : void 0
		} : {}
	};
	try {
		await host.save(ctx);
		await host.store.appendEvent(ctx.runId, "interaction/asked", {
			kind,
			nodeId: current.nodeId,
			visit: current.visit,
			sessionId: current.sessionId ?? null
		});
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 保存等待中的交互失败：${describeError(error)}`);
	}
}
/**
* 清除一次提问 / 审批；id 不匹配时说明已经有新的交互，不能误清。
*
* @param ctx
* @param interactionId
* @returns
*/
async function clearInteraction(host, ctx, interactionId) {
	if (ctx.closed) return;
	if (ctx.run.pendingInteraction?.id !== interactionId) return;
	ctx.run.pendingInteraction = null;
	try {
		await host.save(ctx);
		await host.store.appendEvent(ctx.runId, "interaction/settled", { id: interactionId });
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 清除等待中的交互失败：${describeError(error)}`);
	}
}
/**
* @param session
* @param event
* @returns
*/
function onSessionEvent(host, session, event) {
	if (host.disposed || event?.type !== "turn/end") return;
	const sessionId = typeof session?.id === "string" ? session.id : "";
	if (sessionId === "") return;
	const entry = host.dispatchBySession.get(sessionId);
	if (entry === void 0) return;
	if (entry.startSeq === null) {
		if (entry.early.length < 40) entry.early.push({
			kind: "turn",
			session,
			event
		});
		return;
	}
	if (typeof event.seq !== "number" || event.seq < entry.startSeq) return;
	host.enqueue(entry.runId, () => host.processTurn(entry, session, event));
}
/**
* @param session
* @returns
*/
function onSessionDisposed(host, session) {
	if (host.disposed) return;
	const sessionId = typeof session?.id === "string" ? session.id : "";
	const entry = sessionId === "" ? void 0 : host.dispatchBySession.get(sessionId);
	if (entry === void 0 || entry.claimed === true || entry.recoveryRequested === true) return;
	if (entry.startSeq === null) {
		entry.disposedEarly = true;
		return;
	}
	entry.recoveryRequested = true;
	host.enqueue(entry.runId, () => host.recoverNode(entry, "the robot session was disposed"));
}
/**
* @param payload
* @returns
*/
function onAgentDisposed(host, payload) {
	const payloadRecord = isRecord(payload) ? payload : {};
	const session = (isRecord(payloadRecord.agent) ? payloadRecord.agent : null)?.session ?? payloadRecord.session ?? null;
	if (session === null || session === void 0) return;
	host.onSessionDisposed(session);
}
/**
* 从 dispatch 表里移除并释放这一轮的句柄。
*
* @param ctx
* @param sessionId
* @returns
*/
function disposeEntry(host, ctx, sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") return;
	const entry = host.dispatchBySession.get(sessionId);
	if (entry === void 0 || entry.runId !== ctx.runId) return;
	host.clearEntryPlanMode(entry);
	host.removeEntry(entry);
	try {
		Promise.resolve(entry.handle?.dispose?.()).catch(() => void 0);
	} catch {}
}
// .build/workflows/engine/supervisor-lifecycle.js
/**
* 观察者的生命周期：启动 / 取消 / 释放运行，以及机器人服务接入。
*/
/**
* 注入 robots 服务；晚到时会唤醒等待启动恢复的调用方。
*
* @param robots
* @returns
*/
function attachRobots(host, robots) {
	if (host.disposed || robots === void 0 || robots === null) return;
	host.robots = robots;
	const waiters = host.robotsWaiters.splice(0);
	for (const waiter of waiters) waiter(robots);
}
/**
* 确保「机器人会话 → 运行」索引已从落盘运行记录构建。
*
* 工具可见性条件在每一步都会调用它；构建只做一次，失败只记警告并保留已有
* 映射，避免一个坏运行记录让整个会话的 step preparation 失败。
*
* @returns
*/
async function ensureSessionIndex(host) {
	if (host.store.ready !== null && host.store.ready !== void 0) try {
		await host.store.ready;
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 运行存储初始化失败，跳过机器人会话索引：${describeError(error)}`);
		host.sessionIndexPromise = Promise.resolve();
		return;
	}
	if (host.sessionIndexPromise === null) host.sessionIndexPromise = host.buildSessionIndex().catch((error) => {
		host.logger?.warn?.(`buka-workflows: 构建机器人会话索引失败：${describeError(error)}`);
	});
	await host.sessionIndexPromise;
}
/**
* 查一个机器人会话属于哪次运行；不属于任何运行（例如手动机器人会话）时返回
* null。
*
* @param sessionId
* @returns
*/
function sessionRun(host, sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") return null;
	return host.sessionRuns.get(sessionId) ?? null;
}
/**
* 记录一个机器人会话所属运行。运行结束后仍保留：用户从侧边栏重新打开会话时，
* 四个只读工具仍然可用。
*
* @param runId
* @param sessionId
* @returns
*/
function rememberSession(host, runId, sessionId) {
	if (typeof runId !== "string" || runId === "") return;
	if (typeof sessionId !== "string" || sessionId === "") return;
	host.sessionRuns.set(sessionId, { runId });
}
/**
* 启动一次运行。
*
* 后台模式在第一个节点 dispatch 后返回；前台模式（含 user 节点）返回 `done`
* promise，调用方 await 到终止状态。
*
* @param input 计划、定义快照、创建者 agent 与可选信号 / 回调
* @returns 终态运行记录，或后台运行的 { run, runId, seq }
*/
async function start(host, input) {
	const { plan, definition, agent, mode = "background", signal, onRunCreated } = input;
	if (typeof agent?.id !== "string" || agent.id === "") throw new WorkflowRunError("a workflow run needs the creating agent");
	if (mode === "background" && plan.order.some((id) => plan.nodes[id]?.type === "user")) throw new WorkflowRunError("user nodes require a foreground run with an active caller turn");
	const runId = createRunId();
	const seq = await host.store.allocateSeq();
	const now = Date.now();
	/** @type {Record<string, any>} */
	const run = {
		version: 3,
		runId,
		seq,
		goal: plan.goal,
		status: "running",
		createdAt: now,
		updatedAt: now,
		finishedAt: null,
		createdBy: { sessionId: agent.id },
		active: [],
		pendingUser: null,
		pendingInteraction: null,
		steps: [],
		sessions: [],
		result: null,
		error: null
	};
	await host.store.create({
		run,
		definition,
		plan
	});
	onRunCreated?.(runId);
	const ctx = host.createContext({
		run,
		plan,
		definition,
		mode,
		agent,
		signal
	});
	host.runs.set(runId, ctx);
	if (ctx.cancelled) {
		await host.enqueue(runId, () => host.finish(ctx, "cancelled", { message: "workflow caller aborted" }));
		return mode === "foreground" ? await ctx.done.promise : {
			run,
			runId,
			seq
		};
	}
	const startNode = plan.nodes[plan.start];
	if (startNode === void 0) {
		await host.enqueue(runId, () => host.fail(ctx, new WorkflowRunError("workflow start node is missing")));
		return mode === "foreground" ? await ctx.done.promise : {
			run,
			runId,
			seq
		};
	}
	if (startNode.type !== "start") {
		await host.enqueue(runId, () => host.fail(ctx, new WorkflowRunError("workflow start node is not a start node")));
		return mode === "foreground" ? await ctx.done.promise : {
			run,
			runId,
			seq
		};
	}
	const startEdges = Array.isArray(startNode.next) ? startNode.next : [];
	if (startEdges.length === 0) {
		await host.enqueue(runId, () => host.fail(ctx, new WorkflowRunError("start node has no outgoing edge")));
		return mode === "foreground" ? await ctx.done.promise : {
			run,
			runId,
			seq
		};
	}
	ctx.frontier = startEdges.map((rule) => ({
		nodeId: rule.to,
		edgePrompt: typeof rule.prompt === "string" && rule.prompt !== "" ? rule.prompt : null
	}));
	if (startEdges.length > 1) host.activateJoins(ctx, startEdges.map((rule) => rule.to));
	await host.enqueue(runId, () => host.advanceInner(ctx));
	if (mode === "foreground") return await ctx.done.promise;
	return {
		run,
		runId,
		seq
	};
}
/**
* 取消一次仍在观察中的运行。
*
* @param runId
* @param [reason]
* @returns
*/
async function cancel(host, runId, reason = "cancelled by the workflow orchestrator") {
	const ctx = host.runs.get(runId);
	if (ctx === void 0) {
		const run = await host.store.readRun(runId);
		if (run !== null && (run.status === "running" || run.status === "waiting")) return await host.store.markInterrupted(runId, reason);
		return false;
	}
	ctx.cancelled = true;
	try {
		ctx.controller.abort(reason);
	} catch {}
	await host.enqueue(runId, async () => {
		if (!ctx.closed) await host.finish(ctx, "cancelled", { message: reason });
	});
	return true;
}
/**
* 插件卸载：取消活动轮次、清定时器，但保留 running 记录供下次加载恢复。
*
* @returns
*/
async function dispose(host) {
	if (host.disposed) return;
	host.disposed = true;
	for (const off of host.unsubscribes ?? []) try {
		off();
	} catch {}
	host.unsubscribes = null;
	for (const ctx of host.runs.values()) {
		for (const entry of host.dispatchEntriesForRun(ctx.runId)) {
			if (entry.timer !== null) clearTimeout(entry.timer);
			try {
				await entry.handle?.cancel?.("workflow plugin disposed");
			} catch {}
			try {
				await entry.handle?.dispose?.();
			} catch {}
		}
		ctx.controller.abort("workflow plugin disposed");
		if (ctx.mode === "foreground" && !ctx.done.settled) ctx.done.resolve(toToolRun(ctx.run));
	}
	host.runs.clear();
	host.dispatchBySession.clear();
	host.sessionRuns.clear();
	host.queues.clear();
}
// .build/workflows/routing.js
/**
* 机器人节点结果的解析与路由（workflow format 2）。
*
* 机器人节点总是交回一个 JSON 对象，结果有两条出口：
*
* - `next` 必须精确匹配某一条出边的 `name`，执行器就沿着那条边走，并渲染该边上
*   的 prompt；没有出边的终止机器人节点不需要 `next`，此时 `resolveRoute` 返回
*   `{ rule: null }`，流程正常结束；
* - `abort` 是主动终止：节点用非空字符串说明自己无法完成，执行器直接结束运行，
*   不选任何边。`resolveAbort` 必须先于 `resolveRoute` 调用；两者同时出现时按
*   无效结果处理，供观察者要求机器人在同一会话里重新交回结果。
*
* @module @buka/dsh-plugin-workflows/routing
*/
/** 主动终止原因的最大字符数；超出部分截断，避免把 run.json 撑大。 */
const MAX_ABORT_REASON_LENGTH = 2e3;
/**
* 解析机器人结果里的 `abort` 主动终止字段。
*
* 返回：
* - `null`：结果没有 `abort`，按 `next` 处理；
* - `{ abort: { reason } }`：合法的主动终止；
* - `{ error: { kind, message } }`：`next` / `abort` 同时出现，或 `abort` 不是
*   非空字符串，`kind` 直接作为结果追问的 reason。
*
* @param data 机器人交回的 JSON 对象
* @returns 没有 abort 时是 `null`，否则是合法 abort 或无效结果
*/
function resolveAbort(data) {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	if (!Object.hasOwn(data, "abort")) return null;
	if (Object.hasOwn(data, "next")) return { error: {
		kind: "ambiguous-result",
		message: "the result carries both \"next\" and \"abort\"; submit exactly one of them"
	} };
	const raw = data.abort;
	if (typeof raw !== "string") return { error: {
		kind: "invalid-abort",
		message: "\"abort\" must be a string containing the reason this node cannot complete its task"
	} };
	const reason = raw.trim();
	if (reason === "") return { error: {
		kind: "invalid-abort",
		message: "\"abort\" must be a non-empty reason"
	} };
	return { abort: { reason: reason.length > 2e3 ? reason.slice(0, MAX_ABORT_REASON_LENGTH) : reason } };
}
/**
* 按机器人结果里的 `next` 选择出边（format 2 起，format 3 支持并发 fan-out）。
*
* 结果里的 `next` 可以是一个路由键（单线，向后兼容），也可以是一个路由键数组
* （fan-out：同时沿所有列出的出边并发执行）。调用方必须先处理 `resolveAbort`：
* 合法 abort 不进入路由。
*
* 返回：
* - `{ rules }`：命中一条或多条出边（数组，按定义顺序）；
* - `{ rules: [] }`：节点没有出边，流程到此结束；
* - `{ error, routes }`：缺少 / 未知 / 重复 `next`，`routes` 是允许的名字列表。
*
* @param node 已规范化的节点
* @param data 机器人交回的 JSON 对象
* @returns 命中的出边数组，或路由错误
*/
function resolveRoutes(node, data) {
	const rules = Array.isArray(node?.next) ? node.next : [];
	if (rules.length === 0) return { rules: [] };
	const routes = [];
	for (const rule of rules) if (typeof rule?.name === "string" && rule.name !== "") routes.push(rule.name);
	const rawNext = typeof data === "object" && data !== null ? data.next : void 0;
	if (typeof rawNext === "string") {
		const name = rawNext.trim();
		if (name === "") return {
			error: `the result has no "next" route; set "next" to one of: ${formatRoutes(routes)}`,
			routes
		};
		const matches = rules.filter((rule) => rule?.name === name);
		if (matches.length !== 1) return {
			error: matches.length === 0 ? `unknown route "${name}"; "next" must be one of: ${formatRoutes(routes)}` : `route "${name}" is ambiguous; "next" must be one of: ${formatRoutes(routes)}`,
			routes
		};
		return { rules: matches };
	}
	if (Array.isArray(rawNext)) {
		if (rawNext.length === 0) return {
			error: `the result has an empty "next" route list; set "next" to one or more of: ${formatRoutes(routes)}`,
			routes
		};
		const selected = [];
		const seen = /* @__PURE__ */ new Set();
		for (const raw of rawNext) {
			if (typeof raw !== "string") return {
				error: `the "next" route list must contain only route names; set it to one or more of: ${formatRoutes(routes)}`,
				routes
			};
			const name = raw.trim();
			if (name === "") return {
				error: `the "next" route list contains an empty name; use one or more of: ${formatRoutes(routes)}`,
				routes
			};
			if (seen.has(name)) return {
				error: `the "next" route list repeats "${name}"; each route can only be selected once`,
				routes
			};
			seen.add(name);
			const matches = rules.filter((rule) => rule?.name === name);
			if (matches.length !== 1) return {
				error: matches.length === 0 ? `unknown route "${name}"; "next" must be one of: ${formatRoutes(routes)}` : `route "${name}" is ambiguous; "next" must be one of: ${formatRoutes(routes)}`,
				routes
			};
			selected.push(matches[0]);
		}
		return { rules: selected };
	}
	return {
		error: `the result has no "next" route; set "next" to one of: ${formatRoutes(routes)}`,
		routes
	};
}
/**
* 把可选路由名拼成给模型看的列表。
*
* @param routes 可选路由名
* @returns 给模型看的列表
*/
function formatRoutes(routes) {
	return routes.length === 0 ? "(none)" : routes.map((route) => JSON.stringify(route)).join(", ");
}
// .build/workflows/engine/supervisor-node.js
/**
* 机器人节点的完成：写 step / 附件 / 结果，并按路由决定下一步。
*/
/**
* 正常 / 失败地落一条 robot step，并把它的出口（单线或 fan-out）推进 frontier，
* 同时更新 join 屏障：并发 fan-out 激活 join、任务完成喂给引用它的 join。
*
* @param ctx
* @param current 要终结的活跃节点
* @param node
* @param result
* @param extra
* @returns
*/
async function completeNode(host, ctx, current, node, result, extra) {
	if (ctx.closed || ctx.cancelled) return;
	const run = ctx.run;
	const sessionId = typeof result.sessionId === "string" ? result.sessionId : current.sessionId ?? null;
	const finishedAt = Date.now();
	const startedAt = typeof current.startedAt === "number" ? current.startedAt : finishedAt;
	const preview = truncateUtf8(result.text ?? "", host.options.previewBytes);
	let aborted = extra.aborted === true;
	let stopReason = aborted ? "aborted" : typeof result.stopReason === "string" ? result.stopReason : "error";
	const recovered = extra.recovered === true || current.recovered === true;
	const recoveryAttempts = Number.isInteger(extra.recoveryAttempts) ? extra.recoveryAttempts : Number.isInteger(current.recoveryAttempts) ? current.recoveryAttempts : 0;
	let routes = aborted ? null : extra.routes;
	if (routes === void 0 && stopReason === "completed") {
		const resolvedAbort = resolveAbort(result.structured);
		if (resolvedAbort?.abort !== void 0) {
			aborted = true;
			stopReason = "aborted";
			routes = null;
			result = {
				...result,
				stopReason: "aborted",
				error: resolvedAbort.abort.reason
			};
		} else if (resolvedAbort?.error !== void 0) {
			await host.fail(ctx, new WorkflowRunError(`invalid workflow result: ${resolvedAbort.error.message}`));
			return;
		} else {
			const resolved = resolveRoutes(node, result.structured);
			if (resolved.error !== void 0) {
				await host.fail(ctx, new WorkflowRunError(`invalid workflow route: ${resolved.error}`));
				return;
			}
			routes = resolved.rules ?? null;
		}
	}
	let nodeAttachments = [];
	let attachmentValues = [];
	const structured = isRecord(result.structured) ? result.structured : null;
	if (stopReason === "completed" && structured !== null && structured.attachments !== void 0) try {
		nodeAttachments = await host.store.writeNodeAttachments(run.runId, current.seq ?? 0, node.id ?? "", structured.attachments, { workspace: extra.workspace });
		attachmentValues = await host.store.attachmentValues(run.runId, current.seq ?? 0, node.id ?? "", nodeAttachments);
		result = {
			...result,
			structured: {
				...structured,
				attachments: nodeAttachments
			}
		};
	} catch (error) {
		stopReason = "error";
		routes = null;
		result = {
			...result,
			stopReason: "error",
			error: `could not store node attachments: ${describeError(error)}`
		};
	}
	const routeList = Array.isArray(routes) ? routes : [];
	const routeName = routeList.length === 1 && typeof routeList[0]?.name === "string" ? routeList[0].name : null;
	const routeTo = routeList.length === 1 && typeof routeList[0]?.to === "string" ? routeList[0].to : null;
	const step = {
		seq: current.seq,
		nodeId: node.id ?? "",
		visit: current.visit,
		type: "robot",
		robot: node.robot,
		sessionId,
		...node.mode === "plan" ? { mode: "plan" } : {},
		status: stopReason === "completed" ? "completed" : "failed",
		stopReason,
		...aborted ? { aborted: true } : {},
		route: routeName,
		routeTo,
		routes: routeList.map((rule) => ({
			name: typeof rule?.name === "string" ? rule.name : null,
			to: typeof rule?.to === "string" ? rule.to : null
		})),
		startedAt,
		finishedAt,
		text: preview.text,
		textTruncated: preview.truncated,
		data: result.structured ?? null,
		error: result.error ?? null,
		attachments: nodeAttachments,
		resumed: current.resumed === true || result.resumed === true,
		compacted: current.compacted === true || result.compacted === true,
		...typeof current.compactionError === "string" && current.compactionError !== "" ? { compactionError: current.compactionError } : {},
		...typeof result.compactionError === "string" && result.compactionError !== "" ? { compactionError: result.compactionError } : {},
		...typeof current.sessionResetReason === "string" && current.sessionResetReason !== "" ? { sessionResetReason: current.sessionResetReason } : {},
		...recovered ? {
			recovered: true,
			recoveryAttempts
		} : {},
		...extra.timedOut === true ? { timedOut: true } : {}
	};
	run.steps.push(step);
	host.removeActive(ctx, current);
	run.pendingInteraction = null;
	run.updatedAt = finishedAt;
	ctx.stepCount = run.steps.length;
	ctx.values[node.id ?? ""] = {
		text: typeof result.text === "string" ? result.text : "",
		data: result.structured ?? null,
		robot: node.robot,
		sessionId: sessionId ?? "",
		route: routeName,
		attachments: attachmentValues
	};
	updateRobotSession(run, node.robot, {
		nodeId: node.id ?? "",
		visit: current.visit ?? 0,
		sessionId,
		at: finishedAt
	});
	const fullText = truncateUtf8(result.text ?? "", host.options.maxNodeTextBytes);
	const promptText = truncateUtf8(current.prompt ?? "", host.options.maxNodeTextBytes);
	try {
		await host.store.saveNodeResult(run.runId, current.seq ?? 0, node.id ?? "", {
			nodeId: node.id,
			visit: current.visit,
			robot: node.robot,
			sessionId,
			...node.mode === "plan" ? { mode: "plan" } : {},
			status: step.status,
			stopReason,
			...aborted ? { aborted: true } : {},
			error: result.error ?? null,
			structured: result.structured ?? null,
			attachments: nodeAttachments,
			resumed: step.resumed,
			compacted: step.compacted,
			...step.compactionError === void 0 ? {} : { compactionError: step.compactionError },
			...step.sessionResetReason === void 0 ? {} : { sessionResetReason: step.sessionResetReason },
			...step.recovered === true ? {
				recovered: true,
				recoveryAttempts: step.recoveryAttempts
			} : {},
			...step.timedOut === true ? { timedOut: true } : {},
			prompt: promptText.text,
			promptTruncated: promptText.truncated,
			text: fullText.text,
			textTruncated: fullText.truncated,
			startedAt,
			finishedAt
		});
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 保存节点结果失败（${run.runId}/${node.id}）：${describeError(error)}`);
	}
	host.disposeEntry(ctx, sessionId);
	await host.save(ctx);
	await host.store.appendEvent(run.runId, "node/end", {
		nodeId: node.id,
		visit: current.visit,
		stopReason,
		...aborted ? { aborted: true } : {},
		...node.mode === "plan" ? { mode: "plan" } : {},
		sessionId,
		resumed: step.resumed,
		compacted: step.compacted,
		...step.recovered === true ? { recovered: true } : {},
		...step.timedOut === true ? { timedOut: true } : {}
	});
	if (stopReason !== "completed") {
		const detail = typeof result.error === "string" && result.error !== "" ? result.error : `robot node "${node.id}" ended with ${stopReason}`;
		const message = aborted ? `workflow node "${node.id}" aborted the run: ${detail}` : detail;
		run.error = message;
		await host.finish(ctx, "failed", {
			nodeId: node.id,
			message,
			aborted
		});
		return;
	}
	if (routeList.length > 0) {
		const targets = routeList.map((rule) => rule.to);
		if (routeList.length > 1) host.activateJoins(ctx, targets);
		for (const rule of routeList) {
			await host.store.appendEvent(run.runId, "route", {
				nodeId: node.id,
				route: typeof rule?.name === "string" ? rule.name : null,
				to: typeof rule?.to === "string" ? rule.to : null
			});
			ctx.frontier.push({
				nodeId: rule.to,
				edgePrompt: typeof rule.prompt === "string" && rule.prompt !== "" ? rule.prompt : null
			});
		}
	}
	await host.contributeJoins(ctx, node.id);
	await host.advanceInner(ctx);
}
// .build/workflows/engine/supervisor-resume.js
/**
* 中断节点的续跑：在原会话里发续跑提示，续接失败则终止节点。
*/
async function resumeActive(host, ctx, current) {
	const runId = ctx.runId;
	const run = ctx.run;
	if (current.type !== "robot") {
		await host.store.markInterrupted(runId, `cannot recover a ${String(current.type)} node after a restart`);
		return "interrupted";
	}
	if (typeof current.prompt !== "string" || current.prompt === "") {
		await host.store.markInterrupted(runId, "this run predates observer recovery data and cannot be resumed safely");
		return "interrupted";
	}
	const node = ctx.plan.nodes[current.nodeId ?? ""];
	if (node === void 0) {
		await host.store.markInterrupted(runId, `workflow node "${current.nodeId ?? ""}" is missing from the definition`);
		return "interrupted";
	}
	const robots = host.robots ?? host.ctx?.get?.("bukaRobots") ?? null;
	const sessionId = typeof current.sessionId === "string" ? current.sessionId : "";
	const interrupt = async (message) => {
		await host.store.markInterrupted(runId, message);
		return "interrupted";
	};
	if (sessionId === "") return await interrupt(`workflow node "${node.id}" has no robot session id; workflow stopped without opening a new session`);
	host.rememberSession(runId, sessionId);
	if (robots === null || typeof robots.openSession !== "function") return await interrupt(`workflow node "${node.id}" cannot resume robot session "${sessionId}": the Buka Robots service cannot open robot sessions; workflow stopped without opening a new session`);
	let handle = null;
	try {
		handle = await host.requireVisibleHandle(await robots.openSession(host.sessionRequest(ctx, node, sessionId)));
		await host.requireSameSession(handle, sessionId);
		const check = handle.readResult({ sinceSeq: current.startSeq ?? 0 });
		if (Number.isInteger(current.startSeq) && check.turnEnded === true && (typeof check.stopReason !== "string" || !RECOVERABLE_STOP_REASONS.has(check.stopReason))) {
			current.recovering = false;
			const recoveredEntry = {
				runId,
				seq: current.seq ?? 0,
				startSeq: current.startSeq ?? null,
				handle,
				early: [],
				claimed: true,
				recoveryRequested: false,
				disposedEarly: false,
				resultExhausted: false,
				timer: null,
				timeoutMs: current.timeoutMs ?? 0,
				planMode: node.mode === "plan",
				planReviewAsked: false,
				planNudged: false
			};
			host.dispatchBySession.set(sessionId, recoveredEntry);
			let result = check;
			let routes = null;
			if (check.structured === void 0) result = {
				...check,
				stopReason: "error",
				error: "the robot session did not submit a structured JSON result"
			};
			else {
				const abort = resolveAbort(check.structured);
				if (abort?.abort !== void 0) {
					await host.abortNode(ctx, current, node, check, abort.abort.reason, {
						recovered: true,
						recoveryAttempts: 1,
						workspace: typeof handle.cwd === "string" ? handle.cwd : void 0
					});
					return "recovered";
				}
				if (abort?.error !== void 0) result = {
					...check,
					stopReason: "error",
					error: `invalid workflow result for node "${node.id}": ${abort.error.message}`
				};
				else {
					const problems = outputProblems(node, check.structured);
					if (problems.length > 0) result = {
						...check,
						stopReason: "error",
						error: `invalid workflow output for node "${node.id}": ${problems.slice(0, 3).join("; ")}`
					};
					else {
						const resolved = resolveRoutes(node, check.structured);
						if (resolved.error !== void 0) result = {
							...check,
							stopReason: "error",
							error: `invalid workflow route: ${resolved.error}`
						};
						else routes = resolved.rules ?? null;
					}
				}
			}
			if (await host.handlePlanGate(ctx, recoveredEntry, current, node, result)) return "recovered";
			host.clearEntryPlanMode(recoveredEntry);
			host.removeEntry(recoveredEntry);
			try {
				await handle.dispose?.();
			} catch {}
			await host.completeNode(ctx, current, node, result, {
				recovered: true,
				recoveryAttempts: 1,
				routes,
				workspace: typeof handle.cwd === "string" ? handle.cwd : void 0
			});
			return "recovered";
		}
		await handle.send(recoveryPrompt(node, "the host restarted before this node finished"), { compactFirst: true });
		current.startSeq = typeof handle.startSeq === "number" && Number.isInteger(handle.startSeq) ? handle.startSeq : current.startSeq;
		current.recovering = false;
		current.recovered = true;
		current.resumed = true;
		current.recoveryAttempts = 1;
		const entry = {
			runId,
			seq: current.seq ?? 0,
			recoveryRequested: false,
			startSeq: current.startSeq ?? null,
			handle,
			early: [],
			claimed: false,
			disposedEarly: false,
			resultExhausted: false,
			timer: null,
			timeoutMs: current.timeoutMs ?? 0,
			planMode: node.mode === "plan",
			planReviewAsked: false,
			planNudged: false
		};
		rememberSessionEntry(run, node.robot, {
			nodeId: node.id ?? "",
			visit: current.visit ?? 0,
			seq: current.seq ?? 0,
			sessionId: current.sessionId ?? null,
			at: Date.now(),
			resumed: true,
			compacted: current.compacted === true
		});
		host.dispatchBySession.set(sessionId, entry);
		await host.save(ctx);
		await host.store.appendEvent(runId, "node/resume", {
			nodeId: node.id,
			visit: current.visit,
			sessionId: current.sessionId,
			attempt: 1,
			reason: "host restart"
		});
		host.armTimeout(ctx, entry);
		return "recovered";
	} catch (error) {
		if (node.mode === "plan") host.clearEntryPlanMode({
			planMode: true,
			handle
		});
		try {
			await handle?.dispose?.();
		} catch {}
		host.dispatchBySession.delete(sessionId);
		host.logger?.warn?.(`buka-workflows: 恢复运行 ${runId} 的会话 ${sessionId} 失败，终止运行：${describeError(error)}`);
		return await interrupt(`workflow node "${node.id}" could not resume robot session "${sessionId}" after restart: ${describeError(error)}; workflow stopped without opening a new session`);
	}
}
/**
* 会话中断后发进同一会话的续跑提示。
*
* @param node
* @param reason
* @returns
*/
function recoveryPrompt(node, reason) {
	const routes = routeNamesOf(node);
	const routeText = routes.length > 0 ? ` The final JSON object must include exactly one of "next" (one of: ${routes.join(", ")}) and "abort".` : " The final JSON object may include \"abort\" if you cannot complete the task.";
	return `Your previous execution of workflow node "${node.id}" was interrupted before it delivered a result (${reason}). Continue from the work already done in this session and finish the assigned task now. When you are done, submit the final JSON object by calling the structured_output tool; it must match this node's declared output schema.${routeText} If you cannot complete this task, submit "abort" with a short non-empty reason instead of choosing a route. Put the actual answer in the final text; do not put it only in an attachment.`;
}
// .build/workflows/engine/supervisor-recovery.js
/**
* 宿主重启后的运行恢复：未完成运行逐个尝试续接，无法续接的节点终止运行。
*/
/**
* 启动恢复：把上次进程留下的 running / waiting 运行接回来。等待用户作答的
* user 运行没有调用者 turn，无法重建原生提问，直接标 interrupted。
*
* @returns
*/
async function resumeAll(host) {
	if (host.disposed) return {
		recovered: 0,
		interrupted: 0
	};
	if (!host.recovered && host.store.ready !== null && host.store.ready !== void 0) {
		await host.store.ready;
		host.sessionIndexPromise = null;
		host.sessionRuns.clear();
	}
	await host.ensureSessionIndex();
	if (host.recovered) return {
		recovered: 0,
		interrupted: 0
	};
	host.recovered = true;
	const robots = await host.waitForRobots();
	if (robots === null || typeof robots.dispatchSession !== "function") return {
		recovered: 0,
		interrupted: await host.store.markAllInterrupted("the Buka Robots service is unavailable or too old (dispatchSession is missing), so unfinished workflow runs cannot be resumed")
	};
	const runs = await host.store.listUnfinished();
	let recovered = 0;
	let interrupted = 0;
	let next = 0;
	const worker = async () => {
		while (next < runs.length) {
			const run = runs[next];
			next += 1;
			if (run === void 0) continue;
			try {
				const result = await host.recoverRun(run);
				if (result === "recovered") recovered += 1;
				else if (result === "interrupted") interrupted += 1;
			} catch (error) {
				host.logger?.warn?.(`buka-workflows: 恢复运行 ${run.runId} 失败：${describeError(error)}`);
			}
		}
	};
	const workers = Array.from({ length: Math.min(4, runs.length) }, () => worker());
	await Promise.all(workers);
	return {
		recovered,
		interrupted
	};
}
/**
* @param run
* @returns
*/
async function recoverRun(host, run) {
	const runId = typeof run?.runId === "string" ? run.runId : "";
	if (runId === "" || host.runs.has(runId)) return "skipped";
	if (run.status === "waiting" || run.pendingUser !== null && run.pendingUser !== void 0 || run.current?.type === "user") {
		await host.store.markInterrupted(runId, "the run was waiting for the user when the host restarted; a user-question prompt cannot be recreated");
		return "interrupted";
	}
	const definition = await host.store.readDefinition(runId);
	const planValue = definition?.plan;
	if (!isRecord(planValue) || !isRecord(planValue.nodes)) {
		await host.store.markInterrupted(runId, "the workflow definition snapshot is missing or corrupt");
		return "interrupted";
	}
	const plan = planValue;
	const planOrder = Array.isArray(plan.order) ? plan.order : Object.keys(plan.nodes);
	if (run.status === "waiting" || planOrder.some((id) => plan.nodes[id]?.type === "user")) {
		await host.store.markInterrupted(runId, "this run contains user nodes; their questions need an active caller turn and cannot be recreated after a restart");
		return "interrupted";
	}
	const ctx = host.createContext({
		run,
		plan,
		definition,
		mode: "background"
	});
	try {
		const nodeResults = await host.store.readNodeResults(runId);
		const byKey = new Map(nodeResults.map((result) => [`${String(result.seq)}:${String(result.nodeId)}`, result]));
		for (const step of Array.isArray(run.steps) ? run.steps : []) {
			const full = byKey.get(`${String(step.seq)}:${String(step.nodeId)}`);
			if (full === void 0) continue;
			const stepNodeId = step.nodeId ?? "";
			const current = ctx.values[stepNodeId];
			if (current === void 0) continue;
			if (typeof full.text === "string" && full.text !== "") current.text = full.text;
			if (current.data === null && full.structured !== void 0) current.data = full.structured;
			if (Array.isArray(full.attachments)) current.attachments = await host.store.attachmentValues(runId, typeof step.seq === "number" && Number.isInteger(step.seq) ? step.seq : 0, stepNodeId, full.attachments);
		}
	} catch {}
	host.runs.set(runId, ctx);
	run.status = "running";
	run.pendingInteraction = null;
	await host.save(ctx);
	await host.store.appendEvent(runId, "run/recover", {
		status: run.status,
		activeCount: Array.isArray(run.active) ? run.active.length : 0
	});
	const actives = Array.isArray(run.active) ? run.active.filter((entry) => entry?.type === "robot") : [];
	if (actives.length === 0) {
		const frontier = host.deriveFrontier(ctx);
		if (frontier.length === 0) {
			await host.finish(ctx, "completed");
			return "recovered";
		}
		ctx.frontier = frontier;
		await host.advance(ctx);
		return "recovered";
	}
	for (const current of actives) if (await host.resumeActive(ctx, current) !== "recovered") {
		host.runs.delete(runId);
		return "interrupted";
	}
	return "recovered";
}
/**
* 会话中断 / 异常：只续接同一会话继续；续接失败直接终止节点和运行，不新开会话。
*
* @param entry
* @param reason
* @returns
*/
async function recoverNode(host, entry, reason) {
	const ctx = host.runs.get(entry.runId);
	if (ctx === void 0 || ctx.closed || ctx.cancelled) return;
	const current = host.findActive(ctx, entry.seq);
	if (current === null) return;
	const node = ctx.plan.nodes[current.nodeId ?? ""];
	if (node === void 0) {
		await host.fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`));
		return;
	}
	ctx.run.pendingInteraction = null;
	entry.claimed = true;
	host.removeEntry(entry);
	try {
		await entry.handle?.dispose?.();
	} catch {}
	const sessionId = typeof current.sessionId === "string" ? current.sessionId : "";
	const robots = host.robots ?? host.ctx?.get?.("bukaRobots") ?? null;
	const stop = async (message, session = sessionId === "" ? null : sessionId) => {
		await host.completeNode(ctx, current, node, {
			sessionId: session,
			text: "",
			stopReason: "error",
			error: message
		}, {});
	};
	if (sessionId === "") {
		await stop(`workflow node "${node.id}" has no robot session id; workflow stopped without opening a new session`);
		return;
	}
	host.rememberSession(ctx.runId, sessionId);
	if (robots === null || typeof robots.openSession !== "function") {
		await stop(`workflow node "${node.id}" cannot resume robot session "${sessionId}": the Buka Robots service cannot open robot sessions; workflow stopped without opening a new session`);
		return;
	}
	current.recoveryAttempts = 1;
	current.recovering = true;
	await host.save(ctx);
	await host.store.appendEvent(ctx.runId, "node/recover", {
		nodeId: node.id,
		visit: current.visit,
		attempt: 1,
		reason
	});
	let handle = null;
	try {
		handle = await host.requireVisibleHandle(await robots.openSession(host.sessionRequest(ctx, node, sessionId)));
		await host.requireSameSession(handle, sessionId);
		const check = handle.readResult({ sinceSeq: current.startSeq ?? 0 });
		if (Number.isInteger(current.startSeq) && check.turnEnded === true && (typeof check.stopReason !== "string" || !RECOVERABLE_STOP_REASONS.has(check.stopReason))) {
			current.recovering = false;
			const recoveredEntry = {
				runId: ctx.runId,
				seq: current.seq ?? 0,
				startSeq: current.startSeq ?? null,
				handle,
				early: [],
				claimed: true,
				recoveryRequested: false,
				disposedEarly: false,
				resultExhausted: false,
				timer: null,
				timeoutMs: current.timeoutMs ?? 0,
				planMode: node.mode === "plan",
				planReviewAsked: false,
				planNudged: false
			};
			host.dispatchBySession.set(sessionId, recoveredEntry);
			let result = check;
			let routes = null;
			if (check.structured === void 0) result = {
				...check,
				stopReason: "error",
				error: "the robot session did not submit a structured JSON result"
			};
			else {
				const abort = resolveAbort(check.structured);
				if (abort?.abort !== void 0) {
					await host.abortNode(ctx, current, node, check, abort.abort.reason, {
						recovered: true,
						recoveryAttempts: 1,
						workspace: typeof handle.cwd === "string" ? handle.cwd : void 0
					});
					return;
				}
				if (abort?.error !== void 0) result = {
					...check,
					stopReason: "error",
					error: `invalid workflow result for node "${node.id}": ${abort.error.message}`
				};
				else {
					const problems = outputProblems(node, check.structured);
					if (problems.length > 0) result = {
						...check,
						stopReason: "error",
						error: `invalid workflow output for node "${node.id}": ${problems.slice(0, 3).join("; ")}`
					};
					else {
						const resolved = resolveRoutes(node, check.structured);
						if (resolved.error !== void 0) result = {
							...check,
							stopReason: "error",
							error: `invalid workflow route: ${resolved.error}`
						};
						else routes = resolved.rules ?? null;
					}
				}
			}
			if (await host.handlePlanGate(ctx, recoveredEntry, current, node, result)) return;
			host.clearEntryPlanMode(recoveredEntry);
			host.removeEntry(recoveredEntry);
			try {
				await handle.dispose?.();
			} catch {}
			await host.completeNode(ctx, current, node, result, {
				recovered: true,
				recoveryAttempts: 1,
				routes,
				workspace: typeof handle.cwd === "string" ? handle.cwd : void 0
			});
			return;
		}
		await handle.send(recoveryPrompt(node, reason), { compactFirst: true });
		current.startSeq = typeof handle.startSeq === "number" && Number.isInteger(handle.startSeq) ? handle.startSeq : current.startSeq;
		current.recovering = false;
		current.recovered = true;
		current.resumed = true;
		current.compacted = handle.compacted === true || current.compacted === true;
		if (typeof handle.compactionError === "string" && handle.compactionError !== "") current.compactionError = handle.compactionError;
		const recoveredEntry = {
			runId: ctx.runId,
			seq: current.seq ?? 0,
			startSeq: current.startSeq ?? null,
			handle,
			early: [],
			claimed: false,
			recoveryRequested: false,
			disposedEarly: false,
			resultExhausted: false,
			timer: null,
			timeoutMs: current.timeoutMs ?? 0,
			planMode: node.mode === "plan",
			planReviewAsked: false,
			planNudged: false
		};
		rememberSessionEntry(ctx.run, node.robot, {
			nodeId: node.id ?? "",
			visit: current.visit ?? 0,
			seq: current.seq ?? 0,
			sessionId: current.sessionId ?? null,
			at: Date.now(),
			resumed: true,
			compacted: current.compacted === true
		});
		host.dispatchBySession.set(sessionId, recoveredEntry);
		await host.save(ctx);
		await host.store.appendEvent(ctx.runId, "node/resume", {
			nodeId: node.id,
			visit: current.visit,
			sessionId: current.sessionId,
			attempt: 1
		});
		host.armTimeout(ctx, recoveredEntry);
		return;
	} catch (error) {
		if (node.mode === "plan") host.clearEntryPlanMode({
			planMode: true,
			handle
		});
		try {
			await handle?.dispose?.();
		} catch {}
		current.recovering = false;
		await stop(`workflow node "${node.id}" could not resume robot session "${sessionId}": ${describeError(error)}; workflow stopped without opening a new session`);
	}
}
// .build/workflows/engine/supervisor-state.js
/**
* 观察者的共享状态操作：运行上下文、dispatch 台账、步骤落盘与 join 推进的
* 底层读写。
*/
/**
* @param input 运行记录、计划、定义快照、模式、agent 与可选信号
* @returns 本次运行的观察上下文
*/
function createContext(host, input) {
	const { run, plan, definition, mode, agent, signal } = input;
	const ctx = {
		runId: run.runId,
		run,
		plan,
		definition,
		mode,
		agent,
		controller: new AbortController(),
		frontier: [],
		joins: /* @__PURE__ */ new Map(),
		lastEnd: null,
		values: {},
		visits: /* @__PURE__ */ new Map(),
		seq: 0,
		stepCount: 0,
		done: deferred(),
		cancelled: false,
		closed: false
	};
	if (!Array.isArray(ctx.run.active)) {
		ctx.run.active = ctx.run.current !== null && ctx.run.current !== void 0 ? [ctx.run.current] : [];
		ctx.run.current = null;
	}
	host.rebuildFromSteps(ctx);
	if (signal !== void 0) {
		if (signal.aborted === true) {
			ctx.cancelled = true;
			ctx.controller.abort("workflow caller aborted");
		} else signal.addEventListener("abort", () => {
			host.cancel(ctx.runId, "cancelled by the workflow caller");
		}, { once: true });
	}
	return ctx;
}
/**
* 从已落盘的 steps / 节点结果重建模板上下文、访问次数与序号。
*
* @param ctx
* @returns
*/
function rebuildFromSteps(_host, ctx) {
	const steps = Array.isArray(ctx.run.steps) ? ctx.run.steps : [];
	ctx.stepCount = steps.length;
	ctx.seq = 0;
	ctx.visits = /* @__PURE__ */ new Map();
	ctx.values = {};
	for (const step of steps) {
		const seq = typeof step?.seq === "number" ? step.seq : 0;
		if (seq > ctx.seq) ctx.seq = seq;
		const nodeId = typeof step?.nodeId === "string" ? step.nodeId : "";
		if (nodeId === "") continue;
		ctx.visits.set(nodeId, (ctx.visits.get(nodeId) ?? 0) + 1);
		if (step.type === "user") {
			ctx.values[nodeId] = {
				route: typeof step.route === "string" ? step.route : null,
				routeTo: typeof step.routeTo === "string" ? step.routeTo : null,
				answers: answersValue(Array.isArray(step.answers) ? step.answers : []),
				text: typeof step.text === "string" ? step.text : ""
			};
			continue;
		}
		ctx.values[nodeId] = {
			text: typeof step.text === "string" ? step.text : "",
			data: step.data ?? null,
			robot: step.robot ?? null,
			sessionId: typeof step.sessionId === "string" ? step.sessionId : "",
			route: typeof step.route === "string" ? step.route : null,
			attachments: Array.isArray(step.attachments) ? step.attachments : []
		};
	}
}
/**
* 每个 run 的推进串行化。
*
* @param runId
* @param task
* @returns
*/
function enqueue(host, runId, task) {
	const next = (host.queues.get(runId) ?? Promise.resolve()).then(task, task).catch((error) => {
		const ctx = host.runs.get(runId);
		host.logger?.warn?.(`buka-workflows: run ${runId} 推进失败：${describeError(error)}`);
		if (ctx !== void 0 && !ctx.closed) return host.fail(ctx, error);
	});
	host.queues.set(runId, next);
	const cleanup = () => {
		if (host.queues.get(runId) === next) host.queues.delete(runId);
	};
	next.then(cleanup, cleanup);
	return next;
}
/**
* 从已落盘的 step 推导恢复后的 frontier（没有 step 时从 start 的全部出边开始）。
*
* @param ctx
* @returns
*/
function deriveFrontier(_host, ctx) {
	const steps = Array.isArray(ctx.run.steps) ? ctx.run.steps : [];
	if (steps.length === 0) {
		const startNode = ctx.plan.nodes[ctx.plan.start];
		if (startNode === void 0 || startNode.type !== "start") return [];
		return (Array.isArray(startNode.next) ? startNode.next : []).map((rule) => ({
			nodeId: rule.to,
			edgePrompt: typeof rule.prompt === "string" && rule.prompt !== "" ? rule.prompt : null
		}));
	}
	const last = steps[steps.length - 1];
	if (last === void 0) return [];
	const node = ctx.plan.nodes[last.nodeId ?? ""];
	if (node === void 0) return [];
	const routes = Array.isArray(last.routes) && last.routes.length > 0 ? last.routes : typeof last.route === "string" && last.route !== "" ? [{
		name: last.route,
		to: typeof last.routeTo === "string" ? last.routeTo : null
	}] : [];
	const edges = Array.isArray(node.next) ? node.next : [];
	return routes.map((route) => edges.find((rule) => rule.name === route.name)).filter((edge) => edge !== void 0).map((edge) => ({
		nodeId: edge.to,
		edgePrompt: typeof edge.prompt === "string" && edge.prompt !== "" ? edge.prompt : null
	}));
}
/**
* 当前（第一个）活跃节点的 id，用于失败 / 取消记录里的 lastNode。
*
* @param ctx
* @returns
*/
function activeNodeId(_host, ctx) {
	const first = (Array.isArray(ctx.run.active) ? ctx.run.active : []).find((entry) => typeof entry?.nodeId === "string");
	return first !== void 0 ? first.nodeId ?? null : null;
}
/**
* 按序号在 run.active 里找活跃的机器人节点。
*
* @param ctx
* @param seq
* @returns
*/
function findActive(_host, ctx, seq) {
	return (Array.isArray(ctx.run.active) ? ctx.run.active : []).find((entry) => entry?.seq === seq) ?? null;
}
/**
* 从 run.active 里移除一个已终结的活跃节点。
*
* @param ctx
* @param current
* @returns
*/
function removeActive(_host, ctx, current) {
	if (!Array.isArray(ctx.run.active)) return;
	const index = ctx.run.active.findIndex((entry) => entry === current || entry?.seq === current.seq);
	if (index >= 0) ctx.run.active.splice(index, 1);
}
/**
* 并发 fan-out 激活 join：把每个 join 的「本次启动子集」（inputs ∩ 已启动任务）
* 记为待完成集合。join 放行条件就是这些任务全部完成；没被启动的 input 不计入。
*
* @param ctx
* @param startedIds 本次 fan-out 启动的任务节点 id
* @returns
*/
function activateJoins(_host, ctx, startedIds) {
	const started = new Set(startedIds);
	for (const id of ctx.plan.order) {
		const node = ctx.plan.nodes[id];
		if (node === void 0 || node.type !== "join") continue;
		const awaiting = new Set((node.inputs ?? []).filter((input) => started.has(input)));
		if (awaiting.size > 0) ctx.joins.set(id, awaiting);
	}
}
/**
* 一个任务完成：喂给引用它的所有 join，等待集合清空的 join 放行一次（沿唯一出边
* 推进 frontier）。不在这里调用 #advanceInner，由 #completeNode 收尾统一推进。
*
* @param ctx
* @param nodeId 完成的任务节点 id
* @returns
*/
async function contributeJoins(host, ctx, nodeId) {
	for (const [joinId, awaiting] of ctx.joins) {
		if (!awaiting.has(nodeId)) continue;
		awaiting.delete(nodeId);
		if (awaiting.size !== 0) continue;
		ctx.joins.delete(joinId);
		const join = ctx.plan.nodes[joinId];
		const edge = Array.isArray(join?.next) ? join.next[0] : null;
		if (edge !== void 0 && edge !== null && typeof edge.to === "string") ctx.frontier.push({
			nodeId: edge.to,
			edgePrompt: typeof edge.prompt === "string" && edge.prompt !== "" ? edge.prompt : null
		});
		await host.store.appendEvent(ctx.runId, "join/fire", { joinId });
	}
}
/**
* @param ctx
* @returns
*/
async function save(host, ctx) {
	ctx.run.updatedAt = Date.now();
	await host.store.save(ctx.run);
}
/**
* @param ctx
* @param current 活跃节点
* @param node
* @param prompt
* @param startedAt
* @returns
*/
async function saveRunningNodeResult(host, ctx, current, node, prompt, startedAt) {
	const promptText = truncateUtf8(prompt, host.options.maxNodeTextBytes);
	try {
		await host.store.saveNodeResult(ctx.runId, current.seq ?? 0, node.id ?? "", {
			nodeId: node.id,
			visit: current.visit,
			robot: node.robot,
			status: "running",
			prompt: promptText.text,
			promptTruncated: promptText.truncated,
			attachments: [],
			startedAt
		});
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 保存运行中节点结果失败（${ctx.runId}/${node.id}）：${describeError(error)}`);
	}
}
/**
* @param ctx
* @param node
* @param sessionId
* @returns
*/
function sessionRequest(host, ctx, node, sessionId) {
	const creator = host.creatorAgent(ctx);
	return {
		robot: node.robot,
		sessionId,
		outputSchema: buildResultSchema(node),
		routes: routeNamesOf(node),
		abortable: true,
		title: robotSessionTitle(ctx.run, node),
		...node.agentOptions === void 0 ? {} : { agentOptions: node.agentOptions },
		approval: "ask",
		signal: ctx.controller.signal,
		...creator === void 0 ? {} : { agent: creator },
		...host.options.robotPreset === "" ? {} : { agentPreset: host.options.robotPreset },
		...node.mode === "plan" ? {} : { planMode: false }
	};
}
/**
* @param ctx
* @returns
*/
function creatorAgent(host, ctx) {
	const agents = host.ctx?.get?.("agents") ?? host.ctx?.agents;
	if (!isRecord(agents) || typeof agents.get !== "function") return void 0;
	const sessionId = ctx.run?.createdBy?.sessionId;
	if (typeof sessionId !== "string" || sessionId === "") return void 0;
	try {
		const get = agents.get;
		return get(sessionId) ?? void 0;
	} catch {
		return;
	}
}
/**
* 观察者需要非阻塞的 dispatchSession；旧版 robots 只有 startSession（会自己
* await 一轮），不能交给观察者，所以明确按失败处理并提示升级。
*
* @param robots
* @returns
*/
function canDispatch(_host, robots) {
	return typeof robots?.dispatchSession === "function";
}
/**
* @param runId
* @returns
*/
function dispatchEntriesForRun(host, runId) {
	return [...host.dispatchBySession.values()].filter((entry) => entry.runId === runId);
}
/**
* @param entry
* @returns
*/
function removeEntry(host, entry) {
	if (entry.timer !== null) {
		clearTimeout(entry.timer);
		entry.timer = null;
	}
	for (const [key, value] of host.dispatchBySession) if (value === entry) host.dispatchBySession.delete(key);
}
/**
* 节点结束 / 运行终止时尽力关闭该 entry 进入的 plan 模式。
*
* 失败只记日志：模式清理不能改变节点结果；下一次进入同一机器人时 supervisor
* 会按节点的 `mode` 重新归一，所以这里只是避免把 plan 状态留在用户可见的
* 会话里。超时 / 取消时 turn 可能还没关闭，`set(false)` 会排队；不影响结果。
*
* @param entry
* @returns
*/
function clearEntryPlanMode(host, entry) {
	if (entry?.planMode !== true) return;
	entry.planMode = false;
	const handle = entry.handle;
	if (handle === null || handle === void 0 || typeof handle.setPlanMode !== "function") return;
	try {
		handle.setPlanMode(false);
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: could not leave plan mode for the robot session: ${describeError(error)}`);
	}
}
/**
* @returns
*/
async function waitForRobots(host) {
	if (host.robots !== null) return host.robots;
	const existing = host.ctx?.get?.("bukaRobots") ?? null;
	if (existing !== null) {
		host.attachRobots(existing);
		return existing;
	}
	return await new Promise((resolve) => {
		let timer;
		const finish = (value) => {
			clearTimeout(timer);
			const index = host.robotsWaiters.indexOf(waiter);
			if (index >= 0) host.robotsWaiters.splice(index, 1);
			resolve(value);
		};
		const waiter = (robots) => finish(robots);
		host.robotsWaiters.push(waiter);
		timer = setTimeout(() => finish(null), ROBOTS_WAIT_MS);
		timer.unref?.();
	});
}
/**
* 从所有运行记录重建「机器人会话 → 运行」索引。
*
* `run.steps` 覆盖已结束的执行，`run.sessions` 覆盖每个机器人的会话摘要，
* `run.current` 覆盖运行中尚未形成 step 的节点；旧记录缺其中一项时其他来源
* 仍能兜底。
*
* @returns
*/
async function buildSessionIndex(host) {
	const remember = (runId, sessionId) => {
		if (typeof sessionId !== "string" || sessionId === "") return;
		host.sessionRuns.set(sessionId, { runId });
	};
	for (const runId of await host.store.listRunIds()) {
		const run = await host.store.readRun(runId);
		if (run === null) continue;
		const effectiveRunId = typeof run.runId === "string" && run.runId !== "" ? run.runId : runId;
		for (const step of Array.isArray(run.steps) ? run.steps : []) remember(effectiveRunId, step?.sessionId);
		for (const session of Array.isArray(run.sessions) ? run.sessions : []) {
			remember(effectiveRunId, session?.sessionId);
			for (const entry of Array.isArray(session?.entries) ? session.entries : []) remember(effectiveRunId, entry?.sessionId);
		}
		for (const current of Array.isArray(run.active) ? run.active : []) remember(effectiveRunId, current?.sessionId);
		remember(effectiveRunId, run.current?.sessionId);
	}
}
// .build/workflows/engine/supervisor-turn.js
/**
* 机器人会话一轮结束后的处理：读结果、校验路由、计划模式门禁与重试。
*/
/**
* 处理一次 `turn/end`：读结果、校验 JSON/next、正常完成或异常恢复。
*
* @param entry
* @param session
* @param event
* @returns
*/
async function processTurn(host, entry, _session, event) {
	if (entry.claimed === true) return;
	entry.claimed = true;
	if (entry.timer !== null) {
		clearTimeout(entry.timer);
		entry.timer = null;
	}
	const ctx = host.runs.get(entry.runId);
	if (ctx === void 0 || ctx.closed || ctx.cancelled) return;
	const current = host.findActive(ctx, entry.seq);
	if (current === null) return;
	if (entry.startSeq !== null && typeof event.seq === "number" && event.seq < entry.startSeq) {
		entry.claimed = false;
		return;
	}
	const node = ctx.plan.nodes[current.nodeId ?? ""];
	if (node === void 0) {
		await host.fail(ctx, new WorkflowRunError(`workflow node "${current.nodeId}" is missing`));
		return;
	}
	const handle = entry.handle;
	if (handle === null) return;
	let result;
	try {
		result = await handle.readResult({ sinceSeq: entry.startSeq ?? 0 });
	} catch (error) {
		entry.claimed = false;
		entry.recoveryRequested = true;
		await host.recoverNode(entry, `could not read the robot session result: ${describeError(error)}`);
		return;
	}
	const abort = result.structured === void 0 ? null : resolveAbort(result.structured);
	if (abort?.abort !== void 0) {
		if (ctx.run.pendingInteraction !== null) {
			ctx.run.pendingInteraction = null;
			await host.save(ctx);
		}
		await host.abortNode(ctx, current, node, result, abort.abort.reason, { workspace: typeof entry.handle?.cwd === "string" ? entry.handle.cwd : void 0 });
		return;
	}
	if (typeof result.stopReason === "string" && RECOVERABLE_STOP_REASONS.has(result.stopReason) && result.stopReason !== "completed") {
		entry.claimed = false;
		entry.recoveryRequested = true;
		await host.recoverNode(entry, `the robot session ended with ${result.stopReason}`);
		return;
	}
	if (ctx.run.pendingInteraction !== null) {
		ctx.run.pendingInteraction = null;
		await host.save(ctx);
	}
	if (await host.handlePlanGate(ctx, entry, current, node, result)) return;
	const workspace = typeof entry.handle?.cwd === "string" ? entry.handle.cwd : void 0;
	if (result.structured === void 0) {
		if (await host.retryResult(ctx, entry, node, {
			reason: "missing-json",
			routes: routeNamesOf(node)
		})) return;
		result = {
			...result,
			stopReason: "error",
			error: typeof result.error === "string" && result.error !== "" ? result.error : "the node did not submit a structured JSON result"
		};
		await host.completeNode(ctx, current, node, result, {
			routes: null,
			workspace
		});
		return;
	}
	if (abort?.error !== void 0) {
		if (await host.retryResult(ctx, entry, node, {
			reason: abort.error.kind,
			routes: routeNamesOf(node)
		})) return;
		result = {
			...result,
			stopReason: "error",
			error: `invalid workflow result for node "${node.id}": ${abort.error.message}`
		};
		await host.completeNode(ctx, current, node, result, {
			routes: null,
			workspace
		});
		return;
	}
	const problems = outputProblems(node, result.structured);
	if (problems.length > 0) {
		const detail = problems.slice(0, 3).join("; ");
		if (await host.retryResult(ctx, entry, node, {
			reason: "invalid-output",
			routes: routeNamesOf(node),
			detail
		})) return;
		result = {
			...result,
			stopReason: "error",
			error: `invalid workflow output for node "${node.id}": ${detail}`
		};
		await host.completeNode(ctx, current, node, result, {
			routes: null,
			workspace
		});
		return;
	}
	const route = resolveRoutes(node, result.structured);
	if (route.error !== void 0) {
		if (await host.retryResult(ctx, entry, node, {
			reason: "invalid-next",
			routes: route.routes
		})) return;
		result = {
			...result,
			stopReason: "error",
			error: `invalid workflow route: ${route.error}`
		};
		await host.completeNode(ctx, current, node, result, {
			routes: null,
			workspace
		});
		return;
	}
	await host.completeNode(ctx, current, node, result, {
		routes: route.rules,
		workspace
	});
}
/**
* plan 节点的模式门禁：一轮结束时如果会话仍停在 plan 模式，这一轮不能按
* 普通结果路由。
*
* 三种情况：
* - 用户关闭了原生审阅卡（`planReviewAsked`）：不抢答，保持节点等待，用户在
*   机器人会话里的下一条消息继续这一节点；
* - 机器人自己停在计划阶段：发一次有界提示，要求先把计划交给
*   `exit_plan_mode` 审阅；第二次仍如此则节点失败；
* - 已经批准 / 用户手动退出 / 读不到模式：返回 false，走原有结果处理。
*
* @param ctx
* @param entry
* @param current
* @param node
* @param result
* @returns true 表示已处理，调用方不要再路由
*/
async function handlePlanGate(host, ctx, entry, current, node, result) {
	if (node.mode !== "plan") return false;
	if ((typeof entry.handle?.getPlanMode === "function" ? entry.handle.getPlanMode() : null)?.active !== true) return false;
	if (entry.planReviewAsked === true) {
		entry.planReviewAsked = false;
		entry.claimed = false;
		await host.save(ctx);
		host.armTimeout(ctx, entry);
		await host.store.appendEvent(ctx.runId, "node/plan-review-wait", {
			nodeId: current.nodeId,
			visit: current.visit
		});
		return true;
	}
	const handle = entry.handle;
	if (entry.planNudged !== true && handle !== null && typeof handle.send === "function") {
		entry.planNudged = true;
		try {
			const next = await handle.send(PLAN_REVIEW_NUDGE, { compactFirst: false });
			entry.startSeq = typeof next === "number" && Number.isInteger(next) ? next : entry.startSeq;
			current.startSeq = entry.startSeq;
			entry.claimed = false;
			await host.save(ctx);
			host.armTimeout(ctx, entry);
			await host.store.appendEvent(ctx.runId, "node/plan-review-nudge", {
				nodeId: current.nodeId,
				visit: current.visit
			});
			return true;
		} catch (error) {
			entry.planNudged = false;
			host.logger?.warn?.(`buka-workflows: could not ask the robot to present its plan（${ctx.runId}/${node.id}）：${describeError(error)}`);
		}
	}
	await host.completeNode(ctx, current, node, {
		...result,
		stopReason: "error",
		error: `workflow node "${node.id}" ended its turn in plan mode without presenting a plan for review`
	}, {
		routes: null,
		workspace: typeof entry.handle?.cwd === "string" ? entry.handle.cwd : void 0
	});
	return true;
}
/**
* 在同一会话里要求机器人重新提交结果 / 修正 next。
*
* @param ctx
* @param entry
* @param node
* @param input
* @returns true 表示已经发出重试
*/
async function retryResult(host, ctx, entry, node, input) {
	const { reason, routes, detail } = input;
	const handle = entry.handle;
	const prompt = handle?.retryReport?.({
		reason,
		routes,
		detail,
		abortable: true
	});
	if (handle === null || typeof prompt !== "string" || prompt.trim() === "") return false;
	try {
		await handle.send(prompt, { compactFirst: false });
		const nextSeq = handle.startSeq;
		entry.startSeq = typeof nextSeq === "number" && Number.isInteger(nextSeq) ? nextSeq : entry.startSeq;
		const current = host.findActive(ctx, entry.seq);
		if (current !== null) current.startSeq = entry.startSeq;
		entry.claimed = false;
		await host.save(ctx);
		host.armTimeout(ctx, entry);
		await host.store.appendEvent(ctx.runId, "node/result-retry", {
			nodeId: node.id,
			visit: current?.visit ?? null,
			reason,
			routes
		});
		return true;
	} catch (error) {
		host.logger?.warn?.(`buka-workflows: 重新要求机器人提交结果失败（${ctx.runId}/${node.id}）：${describeError(error)}`);
		return false;
	}
}
/**
* 把节点主动终止落成一条失败的 robot step，并结束整个运行（fail-fast 取消其余分支）。
*
* @param ctx
* @param current 要终结的活跃节点
* @param node
* @param result
* @param reason 节点给出的无法完成原因
* @param [extra]
* @returns
*/
async function abortNode(host, ctx, current, node, result, reason, extra = {}) {
	await host.completeNode(ctx, current, node, {
		...result,
		stopReason: "aborted",
		error: reason
	}, {
		...extra,
		routes: null,
		aborted: true
	});
}
// .build/workflows/engine/supervisor-user.js
/**
* 用户介入节点：在原生提问卡上等用户作答，再把答案写回运行。
*/
/**
* 执行一个用户介入节点（仅前台模式）。原生提问卡要求调用者会话有活跃 turn。
*
* 用户的选项就是节点的出边（`label` 显示给用户）；`questions` 收集额外的
* 反馈 / 信息。回答会落成一条 user step，后续 prompt 可以用模板引用答案。
*
* @param ctx
* @param node
* @returns
*/
async function runUser(host, ctx, node) {
	if (ctx.mode !== "foreground") {
		await host.fail(ctx, new WorkflowRunError(`user node "${node.id}" requires a foreground run`));
		return;
	}
	const userQuestions = host.ctx?.get?.("userQuestions") ?? null;
	if (userQuestions === null || typeof userQuestions.ask !== "function") {
		await host.fail(ctx, new WorkflowRunError("user node needs the user-questions service"));
		return;
	}
	const run = ctx.run;
	const seq = ctx.seq + 1;
	if (seq > ctx.plan.maxSteps) {
		await host.fail(ctx, new WorkflowRunError(`workflow exceeded its ${ctx.plan.maxSteps}-step limit`));
		return;
	}
	const visit = (ctx.visits.get(node.id) ?? 0) + 1;
	const startedAt = Date.now();
	let detail;
	try {
		detail = renderUserDetail(node, ctx.values, ctx.plan, seq, run.runId);
	} catch (error) {
		await host.fail(ctx, error);
		return;
	}
	ctx.seq = seq;
	ctx.visits.set(node.id, visit);
	run.status = "waiting";
	run.pendingUser = {
		nodeId: node.id,
		visit,
		seq,
		title: node.title,
		detail,
		options: (Array.isArray(node.next) ? node.next : []).map((rule) => ({
			name: rule.name,
			label: rule.label,
			...typeof rule.description === "string" && rule.description !== "" ? { description: rule.description } : {}
		})),
		questions: (Array.isArray(node.questions) ? node.questions : []).map((question) => ({
			...question,
			options: (Array.isArray(question.options) ? question.options : []).map((option) => ({ ...option }))
		})),
		requestedAt: startedAt,
		sessionId: typeof ctx.agent?.id === "string" ? ctx.agent.id : null
	};
	await host.save(ctx);
	await host.store.appendEvent(run.runId, "user/waiting", { nodeId: node.id });
	let answer;
	try {
		answer = await userQuestions.ask({
			questions: buildUserQuestions(node, detail),
			agent: ctx.agent,
			signal: ctx.controller.signal
		});
	} catch (error) {
		run.pendingUser = null;
		run.current = null;
		const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
		if (ctx.cancelled === true || ctx.controller.signal.aborted === true || code === "ASK_CANCELLED") {
			await host.finish(ctx, "cancelled", {
				nodeId: node.id,
				message: `user node "${node.id}" was cancelled before the user answered`
			});
			return;
		}
		if (code === "NO_PROVIDER") {
			await host.fail(ctx, new WorkflowRunError(`user node "${node.id}" could not ask the user: no user-questions answerer is available in this composition`, { cause: error }));
			return;
		}
		await host.fail(ctx, new WorkflowRunError(`user node "${node.id}" could not ask the user: ${describeError(error)}`, { cause: error }));
		return;
	}
	const resolved = resolveUserAnswer(node, answer);
	const finishedAt = Date.now();
	if (resolved.error !== void 0) {
		run.pendingUser = null;
		run.current = null;
		await host.fail(ctx, new WorkflowRunError(`invalid answer for user node "${node.id}": ${resolved.error}`));
		return;
	}
	const cancelled = resolved.cancelled === true;
	const route = resolved.route ?? null;
	run.pendingUser = null;
	run.current = null;
	run.status = "running";
	run.steps.push({
		seq,
		nodeId: node.id,
		visit,
		type: "user",
		robot: null,
		sessionId: null,
		status: cancelled ? "cancelled" : "completed",
		route: cancelled ? null : route?.name ?? null,
		routeTo: cancelled ? null : route?.to ?? null,
		answers: resolved.answers,
		input: detail,
		text: resolved.text,
		startedAt,
		finishedAt,
		error: null
	});
	run.updatedAt = finishedAt;
	ctx.stepCount = run.steps.length;
	ctx.values[node.id] = {
		route: cancelled ? null : route?.name ?? null,
		routeTo: cancelled ? null : route?.to ?? null,
		answers: answersValue(resolved.answers),
		text: resolved.text
	};
	await host.save(ctx);
	await host.store.appendEvent(run.runId, "user/answered", {
		nodeId: node.id,
		...cancelled ? { cancelled: true } : { route: route?.name ?? null }
	});
	if (cancelled) {
		await host.finish(ctx, "cancelled", {
			nodeId: node.id,
			message: `user node "${node.id}" was submitted without a choice; the run was cancelled`
		});
		return;
	}
	if (route === null) {
		await host.maybeFinish(ctx);
		return;
	}
	ctx.frontier.push({
		nodeId: route.to,
		edgePrompt: typeof route.prompt === "string" && route.prompt !== "" ? route.prompt : null
	});
}
// .build/workflows/supervisor.js
/**
* 工作流观察者（Host 生命周期服务）。
*
* 这里不在任何会话的 `result` promise 上等待：节点 prompt 投进机器人会话后
* 立即返回，观察者订阅全局 `session/event`，等这一轮 `turn/end` 后读会话日志、
* 校验 JSON 的 `next`、写 step 并按边路由到下一个节点。会话异常终止
* （disposed / interrupted）时，观察者尝试 resume 同一会话、发“继续”prompt；
* 续接失败直接终止运行并写明原因，不新开会话；宿主重启后由 `resumeAll()`
* 从落盘的 `run.json` 继续，续接失败则标成 interrupted。
*
* 一个 run 同时只有一个活跃节点；每个 run 的推进串行化，避免事件竞争导致
* 重复 dispatch。运行状态以磁盘上的 run.json 为权威，内存里只有活跃句柄。
* 节点正常完成时会把结果里的附件复制到该次执行的节点目录，并把清单写进
* run.steps / 节点结果 / 模板上下文。
*
* 观察者还维护 `sessionId → runId` 索引，供机器人会话里的四个只读工具判断
* 可见性：启动时从 `run.steps` / `run.sessions` 重建，dispatch / 恢复时实时
* 补充，运行结束后保留，所以重新打开机器人会话仍能查看这次运行。
*
* @module @buka/dsh-plugin-workflows/supervisor
*/
var WorkflowSupervisor = class {
	/**
	* @param input 上下文、运行存储、限额选项与可选日志器
	*/
	constructor({ ctx, store, options = {}, logger }) {
		this.ctx = ctx;
		this.store = store;
		this.options = {
			nodeTimeoutMs: positive(options.nodeTimeoutMs) ?? 0,
			maxNodeTextBytes: positive(options.maxNodeTextBytes) ?? 65536,
			previewBytes: positive(options.previewBytes) ?? 4e3,
			robotPreset: typeof options.robotPreset === "string" ? options.robotPreset : ""
		};
		this.logger = logger;
		this.runs = /* @__PURE__ */ new Map();
		this.dispatchBySession = /* @__PURE__ */ new Map();
		/**
		* 机器人会话 id → 所属运行。运行结束后重新打开会话时，四个只读工具靠它
		* 判断可见性；启动时从运行记录重建，dispatch / 恢复时实时补充。
		*
		* @type
		*/
		this.sessionRuns = /* @__PURE__ */ new Map();
		this.sessionIndexPromise = null;
		this.queues = /* @__PURE__ */ new Map();
		this.unsubscribes = null;
		this.disposed = false;
		this.robots = null;
		this.robotsWaiters = [];
		this.recovered = false;
		this.subscribe();
	}
	createContext(input) {
		return createContext(this, input);
	}
	rebuildFromSteps(ctx) {
		rebuildFromSteps(this, ctx);
	}
	enqueue(runId, task) {
		return enqueue(this, runId, task);
	}
	deriveFrontier(ctx) {
		return deriveFrontier(this, ctx);
	}
	activeNodeId(ctx) {
		return activeNodeId(this, ctx);
	}
	findActive(ctx, seq) {
		return findActive(this, ctx, seq);
	}
	removeActive(ctx, current) {
		removeActive(this, ctx, current);
	}
	activateJoins(ctx, startedIds) {
		activateJoins(this, ctx, startedIds);
	}
	async contributeJoins(ctx, nodeId) {
		return contributeJoins(this, ctx, nodeId);
	}
	async save(ctx) {
		return save(this, ctx);
	}
	async saveRunningNodeResult(ctx, current, node, prompt, startedAt) {
		return saveRunningNodeResult(this, ctx, current, node, prompt, startedAt);
	}
	sessionRequest(ctx, node, sessionId) {
		return sessionRequest(this, ctx, node, sessionId);
	}
	creatorAgent(ctx) {
		return creatorAgent(this, ctx);
	}
	canDispatch(robots) {
		return canDispatch(this, robots);
	}
	dispatchEntriesForRun(runId) {
		return dispatchEntriesForRun(this, runId);
	}
	removeEntry(entry) {
		removeEntry(this, entry);
	}
	clearEntryPlanMode(entry) {
		clearEntryPlanMode(this, entry);
	}
	async waitForRobots() {
		return waitForRobots(this);
	}
	async buildSessionIndex() {
		return buildSessionIndex(this);
	}
	subscribe() {
		subscribe(this);
	}
	onHumanRequest(event, request, next) {
		return onHumanRequest(this, event, request, next);
	}
	async recordInteraction(ctx, entry, kind, request, interactionId, planReview = false) {
		return recordInteraction(this, ctx, entry, kind, request, interactionId, planReview);
	}
	async clearInteraction(ctx, interactionId) {
		return clearInteraction(this, ctx, interactionId);
	}
	onSessionEvent(session, event) {
		onSessionEvent(this, session, event);
	}
	onSessionDisposed(session) {
		onSessionDisposed(this, session);
	}
	onAgentDisposed(payload) {
		onAgentDisposed(this, payload);
	}
	disposeEntry(ctx, sessionId) {
		disposeEntry(this, ctx, sessionId);
	}
	attachRobots(robots) {
		attachRobots(this, robots);
	}
	async ensureSessionIndex() {
		return ensureSessionIndex(this);
	}
	sessionRun(sessionId) {
		return sessionRun(this, sessionId);
	}
	rememberSession(runId, sessionId) {
		rememberSession(this, runId, sessionId);
	}
	async start(input) {
		return start(this, input);
	}
	async cancel(runId, reason = "cancelled by the workflow orchestrator") {
		return cancel(this, runId, reason);
	}
	async dispose() {
		return dispose(this);
	}
	async resumeAll() {
		return resumeAll(this);
	}
	async recoverRun(run) {
		return recoverRun(this, run);
	}
	async recoverNode(entry, reason) {
		return recoverNode(this, entry, reason);
	}
	async resumeActive(ctx, current) {
		return resumeActive(this, ctx, current);
	}
	advance(ctx) {
		return advance(this, ctx);
	}
	async advanceInner(ctx) {
		return advanceInner(this, ctx);
	}
	async arriveEnd(ctx, node) {
		return arriveEnd(this, ctx, node);
	}
	async maybeFinish(ctx) {
		return maybeFinish(this, ctx);
	}
	async finish(ctx, status, extra = {}) {
		return finish(this, ctx, status, extra);
	}
	async fail(ctx, error) {
		return fail(this, ctx, error);
	}
	async startRobotNode(ctx, node, edgePrompt) {
		return startRobotNode(this, ctx, node, edgePrompt);
	}
	async dispatchRobot(robots, request) {
		return dispatchRobot(this, robots, request);
	}
	armTimeout(ctx, entry) {
		armTimeout(this, ctx, entry);
	}
	async onTimeout(ctx, entry, timeoutMs) {
		return onTimeout(this, ctx, entry, timeoutMs);
	}
	async requireVisibleHandle(handle) {
		return requireVisibleHandle(this, handle);
	}
	async requireSameSession(handle, sessionId) {
		return requireSameSession(this, handle, sessionId);
	}
	async rejectHandle(handle, message) {
		return rejectHandle(this, handle, message);
	}
	async processTurn(entry, _session, event) {
		return processTurn(this, entry, _session, event);
	}
	async handlePlanGate(ctx, entry, current, node, result) {
		return handlePlanGate(this, ctx, entry, current, node, result);
	}
	async retryResult(ctx, entry, node, input) {
		return retryResult(this, ctx, entry, node, input);
	}
	async abortNode(ctx, current, node, result, reason, extra = {}) {
		return abortNode(this, ctx, current, node, result, reason, extra);
	}
	async completeNode(ctx, current, node, result, extra) {
		return completeNode(this, ctx, current, node, result, extra);
	}
	async runUser(ctx, node) {
		return runUser(this, ctx, node);
	}
};
// .build/workflows/tools.js
/**
* 编排 agent 能看到 / 调用的工具注册：plan / start / status / cancel / templates。
*
* 工具定义与结果渲染分离：schema 在这里，展示文本在 render.ts。
*/
/** 模型可读的定义格式说明。 */
const DEFINITION_HELP = `A one-off workflow definition is a JSON object:
{
  "goal": "optional overall goal, available to prompts as {{goal}}",
  "maxSteps": 64,
  "nodes": [ ... ]
}

Node types:
- start: { "id", "type": "start", "next": [{ "to": "<robot id>", "name": "short edge name", "prompt": "..." }] }
  Exactly one start node. It never executes and does not count as a step; its single outgoing edge carries the prompt for the first real node, which must be a robot node.
- robot: { "id", "type": "robot", "robot": "<robot name>", "output": { ... }, "summary": "one-line step summary shown in the run page", "mode"?: "plan", "agentOptions"?: {...}, "timeoutMs"?, "maxVisits"?, "next"?: [edge, ...] }
  Each robot keeps ONE session for the whole run: the first time any node uses that robot, its session is created; every later entry (another node, or a loop back to the same node) first compacts that session's history and then sends the new edge prompt into the same session. The robot keeps continuity across entries while its context stays bounded.
  A robot node has NO prompt of its own: every edge entering it carries the prompt for that entry. This is how the same robot node gets a different instruction when a loop sends work back to it.
  Set "mode": "plan" when the robot should plan before acting. Its session is switched to DSH plan mode before the first prompt: the robot explores, presents the plan through the native plan review card, and only after the user approves does it carry out the plan and submit the node's structured result. This is ONE node, not a separate approval node: do not add a user node just to approve the plan when the native review is what you want. Plan mode is guidance, not a hard sandbox, and it needs the commands service (the /plan command), the user-questions service and a compatible Buka Robots plugin. The output contract and "next" routes are unchanged; include the plan in an "output" field if later nodes need it.
  "output" is REQUIRED: a JSON Schema object with "type": "object" that declares the result JSON fields. Allowed keywords: type, description, properties, required, additionalProperties (boolean), items, enum, const, oneOf; property names use [A-Za-z0-9_-]. Do NOT declare "next", "abort" or "attachments" inside output: the engine adds "next" from the outgoing edge names (used only when the node chooses to continue), always adds the built-in "abort" escape, and always adds the built-in "attachments" capability.
  Give every robot node a short "summary": the run page shows it as the step's title.
  "timeoutMs" is optional and there is NO default timeout: a slow model, a large task or a slow network must not be killed by a guessed deadline. Only set it when the node genuinely has a hard time bound.
  Every robot node must finish by calling structured_output with one JSON object matching that schema (a plain-text JSON object is also accepted and validated the same way). When the node has outgoing edges, that JSON MUST contain exactly one of "next" and "abort": "next" is one of the outgoing edge names, or a non-empty list of them to start several edges as concurrent branches (fan-out). The engine reads "next" and follows each edge automatically; no other agent decides the route. A terminal robot node (no outgoing edges) still submits JSON but does not need "next". Any node may instead return {"abort": "<short non-empty reason>"} when it cannot complete the task: the run ends as failed immediately, no edge is followed, and the declared output fields are not required. A missing/invalid JSON result, an invalid "abort", or both "next" and "abort" together is asked again in the same session, then the node fails.
  The engine appends this declared result contract to every node prompt, so the edge prompt should only state the task and explain what each outgoing edge name means; do not repeat the field list. The abort escape is part of that contract, so do not invent a route or an end node just to model "cannot".
  A node may also return optional "attachments": an array of file paths (relative to its workspace) or { "path", "name"?, "description"? } objects. Attachments are a built-in capability for independent data or files (binaries, archives, traces, large datasets); they are NOT a channel for the answer itself. The node's final text is this step's output shown on the run page: tell the robot to put the actual answer there and in the declared fields, never only in an attachment. The workflow copies those files into that execution's node directory so later nodes can read them; attachments are copied only when the node completes normally, not when it aborts.
  The outgoing edge names are the only valid values for "next"; "abort" is not a route.
- user: { "id", "type": "user", "title": "...", "detail"?: "...", "next"?: [{ "to": "<node id>", "name": "route key", "label": "option text", "description"?: "...", "prompt"?: "..." }], "questions"?: [{ "id", "header"?, "question", "multiSelect"?, "options"?: [{ "label", "description"? }] }] }
  A user-intervention checkpoint: the run pauses, shows "title" plus "detail" (templates allowed) to the user through the native question card, and waits. Use it for a decision (the user's options are the outgoing edges), for a manual operation only a human can do (one edge, e.g. label "Done"), or for reviewing a result only a human can see and returning feedback (add "questions"). "title" is required; a user node needs at least one outgoing edge or one extra question.
  User edges are the choices: "name" is a unique route key, "label" is the required, unique text the user sees, "description" is optional. The chosen edge's name is available to later prompts as the route of this node; an edge entering a robot node must carry its prompt.
  "questions" (max 4) collect extra answers in the same batch: each needs a unique "id" (not "route"), a required "question", optional "header", "multiSelect", and "options" [ { "label", "description"? } ]. Answers are stored by question id, so later prompts can read the selected labels and custom text. User nodes need the creating session to have an active turn: a definition containing a user node runs in the foreground, and is marked interrupted if DSH restarts while it waits.
- end: { "id", "type": "end", "status"?: "completed" | "failed" | "rejected" }
- join: { "id", "type": "join", "inputs": ["<robot node id>", ...], "next": [{ "to": "<node id>", "prompt"?: "..." }] }
  A barrier that collects concurrent fan-out branches. It has no robot, no output, no prompt and no result. It fires ONCE when every one of its "inputs" that was actually started in that fan-out has completed, then continues down its single outgoing edge (whose "prompt" is the instruction for the next robot node). Inputs that were never started are ignored, so it waits only for the branches that really ran. One task may appear in several joins (its completion feeds all of them), which gives overlapping groups: with tasks 1..8 available and a fan-out that starts 1..6, X = {1,2,3,7} fires when 1,2,3 finish and Y = {3,4,5,6,8} fires when 3,4,5,6 finish, even though 7 and 8 never started. "inputs" must be robot node ids, and its single outgoing edge enters a robot node (with a prompt) or an end node. Any branch aborting or failing fails the whole run and cancels its siblings (fail-fast).

"next" is an array of edge rules: { "to": "<node id>", "name": "route key", "prompt"?: "prompt for the target robot node", "tone"?: "success" | "failure" }; user-choice edges add "label" (and optional "description").
Every edge leaving a robot node needs a unique "name" within that node; that name is the route value the robot returns in JSON "next". Every edge leaving a user node needs a unique "name" and a unique "label"; the label is the option the user clicks. Edges entering a robot node must carry "prompt"; edges entering a user or end node must not. The prompt is rendered only when that edge is taken; its template variables are checked at plan time (the referenced node must exist and every data path must be declared in that node's "output").
"tone" is optional and purely cosmetic: it draws that edge green ("success") or red ("failure") on the run page and changes nothing about routing, validation or execution. Set it where a branch clearly means success or failure - especially when a node has two outgoing edges whose names alone do not make the difference obvious.
The start node's edge is the prompt for the first robot node; a loop edge back to a robot node is how a revisit gets different instructions.
Every node must be reachable from the start node: a node nothing leads to would never run, so it is rejected instead of being drawn as a second entry. Edges may not point back at the start node.
A loop node should set "maxVisits": the run warns when a robot node is on a cycle without it, because then only maxSteps bounds the loop.

"report" and "when" were removed in workflow format 2, and the gate node was replaced by the user node in workflow format 3; the validator rejects all three. Robot routing is driven solely by the JSON "next" route; "abort" is a failure escape that ends the run, not a route.

Prompt templates only interpolate these paths (no expressions):
{{goal}}, {{step}}, {{nodes.<node id>.text}}, {{nodes.<node id>.data.<path>}}, {{nodes.<node id>.route}},
for a user node: {{nodes.<user id>.answers.<question id>.selected}}, {{nodes.<user id>.answers.<question id>.custom}} (or the whole answer object via {{nodes.<user id>.answers}}); the reserved question id "route" holds the chosen option's label,
and for an attachment of a completed node: {{nodes.<node id>.attachments.<index>.text}}, .path, .name, .bytes, .description.
The engine validates templates at plan time: the referenced node must exist, and every {{nodes.<node id>.data.<path>}} must be declared in that node's "output" (objects by properties, arrays by numeric index plus "items", oneOf in every variant). Plain {{nodes.<id>.data}} passes the whole result object. Use .text only for small UTF-8 text files; binary or oversized attachments need .path or buka_workflow_execution_attachment. Use buka_robots first to see the available robot names. Use buka_workflow_plan to validate before starting.`;
/** "计划"工具的描述。 */
const PLAN_DESCRIPTION = `Validate a one-off workflow definition without running it, and return the normalized node graph or precise errors. Use it after buka_robots and before buka_workflow_start. This tool is only visible to the workflow-orchestrator preset; other sessions must not create workflows.\n\n${DEFINITION_HELP}`;
/** "启动"工具的描述。 */
const START_DESCRIPTION = `Create and run a one-off workflow as a scheduled run. Every robot keeps one session for the whole run (spawned in the plugin-configured worker preset); later entries compact that session before sending the new prompt. Every robot node declares its result schema in "output"; the engine installs that schema on structured_output (adding "next", the built-in "abort" escape and the built-in attachments array) and appends the result contract to the node prompt. When a node has outgoing edges the JSON carries exactly one of "next" (the outgoing edge name) and "abort", and the observer follows "next" automatically; "abort" ends the run as failed with the node's reason and follows no edge. User nodes pause the run on the native question card: the user's choices are the outgoing edges, and optional extra questions collect feedback that later prompts can read; the answer is returned to the run automatically. There is no default node timeout: a session is allowed to finish at its own pace, and only an explicit robot timeoutMs creates a hard deadline. The definition is stored under the plugin run directory together with the run record, node results and node attachments, and the read-only sidebar page observes them live. Attachments are a built-in capability for independent data/files, not a way to move the answer out of the result, and are copied only when the node completes normally; a node's final text is the step output shown on the run page.

Robot sessions are normal sessions: they run as runtime roots, use the deployment's normal approval policy (an explicit approval:'never' is headless only), and may request tool approvals or ask the user questions. The workflow does not inject behavior instructions; it only provides the task prompt, the declared result contract and the meaning of each route. A robot node with "mode": "plan" is the one mode-specific exception: its session enters DSH plan mode before the prompt, the robot presents its plan through the native plan review card, and after approval it carries out the plan and submits the node result. The review card lives in the robot's own session, so the run page shows a waiting notice with an open-session action; a run without user nodes may still be background. If the robot ends its turn while still in plan mode without presenting a plan, the observer sends one bounded nudge and then fails the node with an explicit reason. Plan mode is soft guidance, not a sandbox; it needs the commands service (the /plan command), the user-questions service and a compatible Buka Robots plugin, checked before the run starts.

A host-level observer (not the robot session itself) watches session events: when the active session finishes its turn, it reads the JSON result and follows "next". If the JSON is missing, does not match the declared output, has an invalid "next", carries an invalid "abort", or carries both "next" and "abort", the observer asks the same session to correct it a bounded number of times, then fails the node. A valid "abort" ends the run as failed at that node without resuming an interrupted session. If that session is interrupted or disposed, the observer resumes it with a continuation prompt and continues; if it cannot be resumed, the node and run fail with an explicit error and no substitute session is opened. A run that is still going when DSH restarts is resumed from its persisted state (runs that contain user nodes are marked interrupted because their question card needs an active caller turn). Old-format run data is deleted on startup by WORKFLOW_FORMAT_VERSION.

Every run gets a persistent, increasing sequence number (seq, starting at 1) that the sidebar page and buka_workflow_status show as #N. A definition WITHOUT user nodes starts in the background: the call returns after the first node is dispatched with a runId and that seq, and the observer keeps the run going, so it never blocks your turn. Poll it with buka_workflow_status (or watch the sidebar page). A definition WITH user nodes must run inside this call, because the native question card needs an active turn: the call returns only after the run reaches a terminal state.

Only the workflow-orchestrator preset can see this tool; robot node sessions run in the worker preset and cannot start nested workflows. Requires the Buka Robots plugin for robot nodes.\n\n${DEFINITION_HELP}`;
/** "状态"工具的描述。 */
const STATUS_DESCRIPTION = "Read one persisted workflow run by id, or list the most recent runs (each labelled with its persistent sequence number, #N). Runs are recorded on disk by buka_workflow_start; each robot step shows its JSON route (next), and a step that aborted the run is marked aborted with the node reason in error; a user node waiting for the user is reported as pendingUser, and a robot session question or tool approval as pendingInteraction. Unfinished runs are resumed by the host observer after a restart (except runs that contain user nodes). Background runs keep advancing while you poll.";
/** "取消"工具的描述。 */
const CANCEL_DESCRIPTION = "Cancel one still-running workflow run started by buka_workflow_start. Cancelling a finished run is a no-op; the run record is updated on disk.";
/** "模板"工具的描述。 */
const TEMPLATES_DESCRIPTION = `Read the abstract workflow template catalog for reference while designing a real one-off workflow. Templates are NOT runnable definitions: each robot node carries an abstract role name (e.g. a role like "development" or "testing"), has no output schema, and no goal. Each template has a description telling you when to reference it. Use this tool first with no arguments to see the catalog (id, name, description), then pass an id to read one template's full abstract node flow. To build the real workflow, run buka_robots to see the robots you actually own, map each abstract role to a real robot, add the required output schema to every robot node, and write concrete edge prompts for the task; adapt the flow to the requirement instead of copying it verbatim. The sidebar "templates" tab shows the same catalog.`;
/**
* 注册编排 agent 的工作流工具。
*
* @param deps 上下文、配置与已建好的存储 / 观察者
*/
function registerWorkflowTools({ ctx, options, store, supervisor, ensureReady, assertOrchestrator, visibleWhen }) {
	ctx.tools.register(defineTool({
		name: "buka_workflow_plan",
		description: PLAN_DESCRIPTION,
		parameters: { definition: {
			type: "object",
			additionalProperties: true,
			required: true,
			description: "The complete ephemeral workflow definition (JSON object) described in the tool description."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true,
						description: "Whether the definition can run."
					},
					errors: {
						type: "array",
						required: true,
						description: "Validation errors.",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: {
									type: "string",
									required: true
								},
								message: {
									type: "string",
									required: true
								}
							}
						}
					},
					warnings: {
						type: "array",
						required: true,
						description: "Non-fatal problems such as a workflow without any robot node.",
						items: { type: "string" }
					},
					summary: {
						type: "json",
						required: true,
						description: "Normalized node graph, or null when invalid."
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderPlanResult(value)
			}]
		},
		async execute(args) {
			const parsed = validateDefinition(args.definition, { maxSteps: options.maxSteps });
			return {
				ok: parsed.ok,
				errors: parsed.errors.slice(0, 50).map((error) => ({
					path: error.path,
					message: error.message
				})),
				warnings: parsed.warnings,
				summary: parsed.ok ? jsonValue(describePlan(parsed.plan)) : null
			};
		}
	}), { when: visibleWhen });
	ctx.tools.register(defineTool({
		name: "buka_workflow_start",
		description: START_DESCRIPTION,
		parameters: { definition: {
			type: "object",
			additionalProperties: true,
			required: true,
			description: "The complete ephemeral workflow definition (JSON object) described in the tool description."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					run: {
						type: "json",
						required: true,
						description: "The final run record when the call ran the workflow itself; null for a background run."
					},
					runId: {
						type: "string",
						required: true,
						description: "Run id used for buka_workflow_status / buka_workflow_cancel."
					},
					seq: {
						type: "number",
						required: true,
						description: "Persistent run sequence number (starts at 1 and never goes back when old runs are deleted)."
					},
					mode: {
						type: "string",
						required: true,
						description: "'background' when the observer keeps scheduling node sessions after this call returns; 'foreground' when the call waited for a terminal state."
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderStart(value)
			}]
		},
		async execute(args, exec) {
			const agent = exec.agent;
			if (agent === void 0 || agent === null) throw new Error("buka_workflow_start requires a calling agent; start it from a DSH session rather than a service call");
			assertOrchestrator(agent);
			const parsed = validateDefinition(args.definition, { maxSteps: options.maxSteps });
			if (!parsed.ok) throw new Error(`invalid workflow definition: ${formatErrors(parsed.errors)}`);
			const plan = parsed.plan;
			const robots = ctx.get("bukaRobots");
			if (plan.order.some((id) => plan.nodes[id]?.type === "robot") && (robots === void 0 || robots === null || typeof robots.dispatchSession !== "function")) throw new Error("robot nodes need a Buka Robots service with dispatchSession(); install or update @buka/dsh-plugin-robots first");
			const userQuestions = ctx.get("userQuestions");
			const needsUser = plan.order.some((id) => plan.nodes[id]?.type === "user");
			if (needsUser && (userQuestions === void 0 || userQuestions === null || typeof userQuestions.ask !== "function")) throw new Error("user nodes need the user-questions service, which is unavailable in this composition");
			if (plan.order.some((id) => {
				const node = plan.nodes[id];
				return node !== void 0 && node.type === "robot" && node.mode === "plan";
			})) {
				const commands = ctx.get("commands");
				if (commands === void 0 || commands === null || typeof commands.execute !== "function") throw new Error("plan mode robot nodes need the commands service (the `/plan` command entry), which is unavailable in this composition");
				if (robots === void 0 || robots === null || robots.supportsPlanMode !== true) throw new Error("plan mode robot nodes need @buka/dsh-plugin-robots 0.9.0 or newer (supportsPlanMode is missing); update the Buka Robots plugin");
				if (userQuestions === void 0 || userQuestions === null || typeof userQuestions.ask !== "function") throw new Error("plan mode robot nodes need the user-questions service for the native plan review card, which is unavailable in this composition");
			}
			await ensureReady();
			if (needsUser) {
				const run = await supervisor.start({
					plan,
					definition: args.definition,
					agent,
					mode: "foreground",
					signal: exec.signal
				});
				return {
					run: jsonValue(run),
					runId: typeof run.runId === "string" ? run.runId : "",
					seq: typeof run.seq === "number" && Number.isInteger(run.seq) ? run.seq : 0,
					mode: "foreground"
				};
			}
			const started = await supervisor.start({
				plan,
				definition: args.definition,
				agent,
				mode: "background"
			});
			const runId = typeof started?.runId === "string" ? started.runId : "";
			if (runId === "") throw new Error("workflow failed to start");
			const createdRun = await store.readRun(runId);
			return {
				run: null,
				runId,
				seq: createdRun !== null && typeof createdRun.seq === "number" && Number.isInteger(createdRun.seq) ? createdRun.seq : typeof started.seq === "number" ? started.seq : 0,
				mode: "background"
			};
		}
	}), { when: visibleWhen });
	ctx.tools.register(defineTool({
		name: "buka_workflow_status",
		description: STATUS_DESCRIPTION,
		parameters: { run_id: {
			type: "string",
			description: "Run id returned by buka_workflow_start. Omit to list the most recent runs."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					run: {
						type: "json",
						required: true,
						description: "One run record, or null."
					},
					runs: {
						type: "json",
						required: true,
						description: "Recent run summaries when no run id was given."
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderStatus(value)
			}]
		},
		async execute(args) {
			await ensureReady();
			const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
			if (runId !== "") return {
				run: jsonValue(await store.readRun(runId)),
				runs: []
			};
			return {
				run: null,
				runs: jsonValue(await store.listRuns(10))
			};
		}
	}), { when: visibleWhen });
	ctx.tools.register(defineTool({
		name: "buka_workflow_cancel",
		description: CANCEL_DESCRIPTION,
		parameters: { run_id: {
			type: "string",
			required: true,
			description: "Run id returned by buka_workflow_start."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					cancelled: {
						type: "boolean",
						required: true,
						description: "Whether a live run was signalled."
					},
					run: {
						type: "json",
						required: true,
						description: "The run record read back from disk, or null."
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderCancel(value)
			}]
		},
		async execute(args, exec) {
			assertOrchestrator(exec.agent);
			const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
			if (runId === "") throw new Error("run_id is required");
			await ensureReady();
			return {
				cancelled: await supervisor.cancel(runId, "cancelled by the workflow orchestrator"),
				run: jsonValue(await store.readRun(runId))
			};
		}
	}), { when: visibleWhen });
	ctx.tools.register(defineTool({
		name: "buka_workflow_templates",
		description: TEMPLATES_DESCRIPTION,
		parameters: { id: {
			type: "string",
			description: "Template id from the catalog; omit to list every template (id, name, description)."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					templates: {
						type: "array",
						required: true,
						description: "The template catalog as { id, name, description } summaries.",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true
								},
								name: {
									type: "string",
									required: true
								},
								description: {
									type: "string",
									required: true
								}
							}
						}
					},
					template: {
						type: "json",
						required: true,
						description: "The full template (id, name, description, nodes) when an id was given and matched; otherwise null."
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderTemplates(value)
			}]
		},
		async execute(args) {
			const id = typeof args.id === "string" ? args.id.trim() : "";
			const templates = listTemplates();
			const template = id === "" ? null : findTemplate(id);
			return {
				templates: summarizeTemplates(templates),
				template: template === null ? null : jsonValue(template)
			};
		}
	}), { when: visibleWhen });
}
// .build/workflows/index.js
/**
* `@buka/dsh-plugin-workflows`：由编排 preset 现场创建的一次性工作流。
*
* 创建 / 启动 / 状态 / 取消工具注册在 Host 上，但只对配置里点名的 agent preset
* （默认随插件发布的 `workflow-orchestrator`）的根会话可见；机器人节点会话另外
* 获得四个只读观测工具（运行总览 / 执行输入 / 执行输出与附件清单 / 附件读取），可见性按运行记录里的
* sessionId 判定。编排 agent 审视任务后，把一份节点定义连同目标交给
* `buka_workflow_start`，插件现场校验并顺序执行：同一个 robot 在一次运行里只开
* 一个会话（落到普通工作 preset），再次进入时先 compact 压缩历史、再把新的边
* prompt 发进同一会话；每个 robot 节点交回一个 JSON，`next` 选中的出边就是下一跳；
* user 节点在原生提问卡里等用户做决策 / 完成操作 / 给出反馈，用户的选项就是出边。
* robot 节点可选 `mode: "plan"`：进入前把会话切到 DSH plan 模式，机器人先探索并
* 交计划，用户在原生计划审阅卡里批准后在同一会话继续实施，再交回结构化结果。
*
* 不含 user 节点的定义在后台跑：工具立刻返回 runId，节点会话由 Host 侧观察者
* 继续调度，浏览器里只读的运行页负责观察。含 user 节点的定义必须在调用者的
* turn 内跑完，因为原生提问卡要求会话有活跃的 turn。
*
* 运行数据落盘到插件目录下的 `runs/`（定义快照、状态快照、事件流、节点结果、节点附件），
* 既是回看依据，也是恢复的权威状态：Host 侧观察者（lib/supervisor.js）订阅全局
* 会话事件推进运行，会话中断只续接同一会话，续接失败即终止运行；宿主重启后
* 未完成的运行会尝试恢复，无法续接时标成 `interrupted`。等待用户作答的
* user 运行无法重建原生提问，也会标成 `interrupted`。
* 每次运行有一个持久递增的序号（`runs/sequence.json` 计数器），页面与工具输出
* 都显示 `#N`；结束的运行按自动归档设置（`runs/` 同级的 `settings.json`，默认
* 24 小时归档、168 小时删除）自动隐藏或删除，运行中的记录不会被处理。
*
* 跨插件依赖只走服务：`ctx.get('bukaRobots')`；取不到时在启动 robot 节点前
* 报一条明确的安装提示。运行页的节点图还会用它提供的 `avatarMap()` 画出机器人
* 头像（取不到时图照常画，只是不带头像）。
*
* @module @buka/dsh-plugin-workflows
*/
/** 自动归档的巡检间隔：设置按小时计，每小时扫一次足够。 */
const SWEEP_INTERVAL_MS = 36e5;
/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 不是一回事。 */
const name = "tool-buka-workflows";
/** 依赖的服务：只需要工具注册表；robots / userQuestions 在调用时按需获取。 */
const inject = ["tools"];
function apply(ctx, config) {
	const options = resolveOptions(config);
	const settingsFile = resolveSettingsFile(options.runsDir);
	const store = new WorkflowRunStore({
		dir: options.runsDir,
		maxRuns: options.maxRuns,
		maxAttachmentBytes: options.maxAttachmentBytes,
		maxAttachmentsPerNode: options.maxAttachmentsPerNode,
		maxNodeAttachmentsBytes: options.maxNodeAttachmentsBytes,
		maxInlineAttachmentBytes: options.maxInlineAttachmentBytes,
		retention: defaultSettings().archive,
		logger: ctx.logger
	});
	const supervisor = new WorkflowSupervisor({
		ctx,
		store,
		options: {
			nodeTimeoutMs: options.nodeTimeoutMs,
			maxNodeTextBytes: options.maxNodeTextBytes,
			robotPreset: options.robotPreset
		},
		logger: ctx.logger
	});
	ctx.inject(["bukaRobots"], (robotsCtx) => {
		supervisor.attachRobots(robotsCtx.bukaRobots);
	});
	ctx.effect(() => () => {
		supervisor.dispose().catch((error) => {
			ctx.logger?.warn?.(`buka-workflows: 释放观察者失败：${describeError$3(error)}`);
		});
	}, "buka-workflows: dispose observer");
	/** 自动归档巡检定时器；存储初始化完成后启动，插件卸载时停掉。 */
	let sweepTimer = null;
	ctx.effect(() => () => {
		if (sweepTimer !== null) clearInterval(sweepTimer);
		sweepTimer = null;
	}, "buka-workflows: stop archive sweeper");
	/** 启动每小时巡检：自动归档 / 删除只依赖这一个定时器与启动时的一次扫描。 */
	function startSweeper() {
		if (sweepTimer !== null) return;
		sweepTimer = setInterval(() => {
			store.sweep().catch((error) => {
				ctx.logger?.warn?.(`buka-workflows: 自动归档巡检失败：${describeError$3(error)}`);
			});
		}, SWEEP_INTERVAL_MS);
		sweepTimer.unref?.();
	}
	/**
	* 存储初始化（建目录、回填序号、按设置清理）只做一次；随后由观察者恢复上次
	* 进程留下的未完成运行。归档设置从设置文件读取，页面保存后会立即更新策略
	* 并再扫一次。
	*/
	let ready;
	function ensureReady() {
		ready ??= (async () => {
			const settings = await readSettings({ file: settingsFile });
			store.setRetention(settings.archive);
			await store.init();
			startSweeper();
			const existing = ctx.get("bukaRobots");
			if (existing !== void 0 && existing !== null) supervisor.attachRobots(existing);
			await supervisor.resumeAll();
		})();
		return ready;
	}
	ensureReady().catch((error) => {
		ctx.logger?.warn?.(`buka-workflows: 初始化运行记录失败：${describeError$3(error)}`);
	});
	/**
	* 判定某个 agent 能否看到 / 调用工作流工具。
	*
	* 只放行配置里点名的 preset 的根会话；preset 服务不可用时保持可见。
	*
	* @param agent
	* @returns
	*/
	function accessOf(agent) {
		return resolveWorkflowAccess({
			allowed: options.orchestratorPresets,
			agentId: typeof agent?.id === "string" ? agent.id : "",
			sessions: ctx.get("sessions"),
			agentPresets: ctx.get("agentPresets")
		});
	}
	/** 工具在每一步的可见性条件。 */
	const visibleWhen = (context) => accessOf(context?.agent).visible;
	/**
	* 调用时兜底再校验一次：即便绕过可见性判断直接调用也要被挡住。
	*
	* @param agent
	* @returns
	*/
	function assertOrchestrator(agent) {
		const access = accessOf(agent);
		if (access.visible) return access;
		throw new Error(`workflow tools are only available to the ${options.orchestratorPresets.join(" / ")} preset (reason: ${access.reason})`);
	}
	registerWorkflowTools({
		ctx,
		options,
		store,
		supervisor,
		ensureReady,
		assertOrchestrator,
		visibleWhen
	});
	const sessionTools = createWorkflowSessionTools({
		defineTool,
		store,
		resolveSession: (sessionId) => supervisor.sessionRun(sessionId)
	});
	const sessionToolVisibleWhen = createSessionToolVisibility({
		ensureIndex: () => supervisor.ensureSessionIndex(),
		resolveSession: (sessionId) => supervisor.sessionRun(sessionId)
	});
	for (const tool of sessionTools) ctx.tools.register(tool, { when: sessionToolVisibleWhen });
	registerWorkflowRoutes({
		ctx,
		store,
		settingsFile,
		ensureReady
	});
}
export { Config, apply, defaultRunsDir, inject, name, renderCancel, renderPlanResult, renderRun, renderStart, renderStatus, renderTemplates, resolveRunsDir };
