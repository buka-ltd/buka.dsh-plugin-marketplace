import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { createReadStream, promises } from "node:fs";
import os from "node:os";
import z from "@deepseek-ai/schemastery";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { defineTool } from "@deepseek-ai/dsh-tools";
// .build/workflows/access.js
/**
* 工作流工具的可见性判定。
*
* 工具本身注册在 Host 上，默认每个会话都能看到。这里把可见性收窄到配置里
* 点名的 agent preset，并且只放行该 preset 的**根会话**：由编排器 spawn 出来
* 的子会话（打工人节点）拿不到工具，避免打工人在节点里自己去开新工作流。
*
* 另外可以按工作区放行（`orchestratorWorkspaces`）：在点名目录（含子目录）
* 里启动的会话直接可见，不必切到编排 preset——开发者工作区就是这种用法。
*
* 纯函数，不 import DSH 包，便于单测。
*
* @module @buka/dsh-plugin-workflows/access
*/
/**
* 判断某个 agent 能否看到 / 调用工作流工具。
*
* - `allowed` 与 `allowedWorkspaces` 都为空：不做收窄（兼容没有 preset 服务的组成）。
* - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，保持可见。
* - 会话 cwd 落在 `allowedWorkspaces` 的某个目录下：直接放行（开发者工作区）。
* - 其余情况：只有「点名 preset 的根会话」可见。
*
* @param input 判定入参
* @returns 可见性、命中的 preset 与原因
*/
function resolveWorkflowAccess(input = {}) {
	const allowed = normalizePresets(input.allowed);
	const workspaces = normalizeWorkspaces(input.allowedWorkspaces);
	if (allowed.length === 0 && workspaces.length === 0) return {
		visible: true,
		preset: null,
		reason: "open"
	};
	const sessions = input.sessions;
	const agentPresets = input.agentPresets;
	if (typeof sessions?.get !== "function") return {
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
	if (isInsideWorkspace(typeof session.header?.cwd === "string" ? session.header.cwd : "", workspaces)) return {
		visible: true,
		preset: null,
		reason: "workspace"
	};
	if (typeof agentPresets?.presetForSession !== "function") return {
		visible: true,
		preset: null,
		reason: "unavailable"
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
* 规范化配置里的工作区目录：去掉空串与非字符串。
*
* @param value 配置里的原始值
* @returns 规范化的目录列表
*/
function normalizeWorkspaces(value) {
	if (!Array.isArray(value)) return [];
	const roots = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const root = normalizeWorkspacePath(entry);
		if (root !== "" && !roots.includes(root)) roots.push(root);
	}
	return roots;
}
/**
* 会话 cwd 是否落在某个工作区目录下（含目录本身）。
*
* @param cwd 会话的工作目录
* @param workspaces 放行的工作区目录
* @returns 命中任何一个目录即为 true
*/
function isInsideWorkspace(cwd, workspaces) {
	if (workspaces.length === 0 || typeof cwd !== "string" || cwd.trim() === "") return false;
	const target = normalizeWorkspacePath(cwd);
	if (target === "") return false;
	const separator = path.sep;
	for (const workspace of workspaces) {
		if (target === workspace) return true;
		const prefix = workspace.endsWith(separator) ? workspace : `${workspace}${separator}`;
		if (target.startsWith(prefix)) return true;
	}
	return false;
}
/**
* 规范化一个目录：转绝对路径、去掉末尾的 `/` 与 `\\`。
*
* @param value 原始路径
* @returns 规范化路径；空串表示无效
*/
function normalizeWorkspacePath(value) {
	const text = value.trim();
	if (text === "") return "";
	const absolute = path.resolve(text);
	if (absolute === path.sep) return absolute;
	return absolute.replace(/[\\/]+$/u, "");
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
// .build/workflows/engine/types.js
/**
* 引擎依赖的宿主服务形状与公共类型。
*
* 跨插件只走服务：workers 服务按 `.tmp/workflow-v4-api.md` 最后一节的契约收窄成
* 结构类型；启动者会话投递用宿主 `sessionController` / `agents` 的「解析 live
* agent + followup」能力（与官方 schedule 插件同一机制）。
*
* @module @buka/dsh-plugin-workflows/engine/types
*/
/** 引擎对外抛出的输入 / 状态错误。 */
var WorkflowError = class extends Error {
	/** 稳定错误码，路由与工具会原样透传。 */
	code;
	constructor(code, message) {
		super(message);
		this.name = "WorkflowError";
		this.code = code;
	}
};
/** 把任意错误转成一句话。 */
function describeError$1(error) {
	return error instanceof Error ? error.message : String(error);
}
// .build/workflows/commands/job.js
/**
* `/job` 命令：普通会话启动作业，启动者 = 当前会话。
*
* 语法：
*
* - `/job`：列出可用工作流与它们的启动输入要求；
* - `/job <workflowId> <原始输入>`：创建作业，启动任务回到本会话执行（下一轮
*   agent 按提示调用 `buka_task_complete` 交回结构化输入）。
*
* 宿主 `commands` 服务没有注册 API 时返回 false，由 `index.ts` 记录日志；页面与
* `buka_job_start` 工具仍是可用入口（spec §13.2 的降级路径）。
*
* @module @buka/dsh-plugin-workflows/commands/job
*/
/**
* 注册 `/job` 命令。
*
* @param deps 上下文与引擎 getter
* @returns 注册成功返回 true；宿主不支持命令注册时返回 false
*/
function registerJobCommand({ ctx, ready }) {
	const commands = ctx.get("commands");
	if (commands === void 0 || commands === null || typeof commands.register !== "function") return false;
	const dispose = commands.register({
		name: "job",
		description: "启动一个工作流作业：/job <workflowId> <原始输入>。不带参数时列出可用的工作流。",
		async handler(invocation) {
			const engine = await ready();
			const agentId = typeof invocation.agent?.id === "string" ? invocation.agent.id : "";
			if (agentId === "") return {
				kind: "error",
				text: "/job 需要在一个会话里使用（启动者 = 当前会话）"
			};
			const raw = typeof invocation.rawInput === "string" ? invocation.rawInput.trim() : "";
			if (raw === "") return {
				kind: "success",
				text: describeAvailableWorkflows(engine)
			};
			const space = raw.search(/\s/u);
			const workflowId = (space < 0 ? raw : raw.slice(0, space)).trim();
			const request = space < 0 ? "" : raw.slice(space + 1).trim();
			if (workflowId === "" || request === "") return {
				kind: "error",
				text: "用法：/job <workflowId> <原始输入>；不带参数可列出可用的工作流"
			};
			try {
				const job = await engine.createJobFromSession({
					workflowId,
					rawInput: { request },
					sessionId: agentId
				});
				return {
					kind: "success",
					text: `已创建作业 #${job.seq}「${job.workflowName}」。启动任务会作为一条新消息发到本会话：按提示把原始输入转换成结构化输入，并调用 buka_task_complete 提交。`
				};
			} catch (error) {
				return {
					kind: "error",
					text: error instanceof WorkflowError ? error.message : `创建工作流作业失败：${describeError$1(error)}`
				};
			}
		}
	});
	ctx.effect(() => dispose, "buka-workflows: /job command");
	return true;
}
/** 列出可用工作流与启动输入要求。 */
function describeAvailableWorkflows(engine) {
	const workflows = engine.listWorkflowSummaries().filter((workflow) => workflow.status === "active");
	if (workflows.length === 0) return "没有可用的工作流。让编排会话保存一份定义，或在「工作流」页面重新启用一个已停用的工作流。";
	const lines = ["可用的工作流："];
	for (const workflow of workflows) {
		const id = typeof workflow.id === "string" ? workflow.id : "";
		const name = typeof workflow.name === "string" ? workflow.name : id;
		lines.push(`- ${id}「${name}」`);
	}
	lines.push("用法：/job <workflowId> <原始输入>");
	return lines.join("\n");
}
// .build/workflows/domain/ids.js
/**
* 记录 id 生成与时间戳。
*
* 形态遵循 `.tmp/workflow-v4-spec.md` §7.1：`task-<base36 time>-<uuid8>`；
* 其余记录沿用同一风格。启动任务固定使用保留 id `start-task`，不经过这里。
*
* @module @buka/dsh-plugin-workflows/domain/ids
*/
/**
* 启动任务的保留 id。
*
* 定义格式里用 `dependsOn: ["$start"]` 引用启动任务，但**记录 id 必须能当
* 文件名**：storageDomain 的 json 后端按记录 id 分文件，只接受
* `[a-zA-Z0-9_-]`，`$start` 会被宿主拒绝（`per-record key ... is not path-safe`）。
* 所以落盘的启动任务 id 用 `start-task`，创建初始任务时把 `$start` 映射成它。
*/
const START_TASK_ID = "start-task";
/** 一段 base36 时间戳。 */
function timeSegment() {
	return Date.now().toString(36);
}
/** 八位 uuid 片段。 */
function uuidSegment() {
	return randomUUID().replace(/-/gu, "").slice(0, 8);
}
/**
* 生成一条带前缀的记录 id。
*
* @param prefix 记录类型前缀，例如 `task`
* @returns `<prefix>-<base36 time>-<uuid8>`
*/
function newRecordId(prefix) {
	return `${prefix}-${timeSegment()}-${uuidSegment()}`;
}
/**
* 新工作流 id。
*
* @returns `wf-…`
*/
function newWorkflowId() {
	return newRecordId("wf");
}
/**
* 新作业 id。
*
* @returns `job-…`
*/
function newJobId() {
	return newRecordId("job");
}
/**
* 新任务 id（启动任务除外）。
*
* @returns `task-…`
*/
function newTaskId() {
	return newRecordId("task");
}
/**
* 新执行记录 id。
*
* @returns `att-…`
*/
function newAttemptId() {
	return newRecordId("att");
}
/**
* 新附件 id。
*
* @returns `att-file-…`
*/
function newAttachmentId() {
	return newRecordId("att-file");
}
/**
* 当前时间的 ISO 字符串。
*
* @returns ISO 时间戳
*/
function nowIso() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
// .build/workflows/attachments/index.js
/**
* 作业附件库：文件落盘、元数据、读取与「按数据流授权」的可见集合。
*
* 规则来自 `.tmp/workflow-v4-spec.md` §10 与 ADR 0012：
*
* - 附件属于作业，每条附件必须有来源任务 / 岗位；
* - 文件本体放在作业目录的 `attachments/` 下，记录里只存文件名；
* - 附件对「产出它的任务、直接或传递依赖它的任务（下游）、启动者、看板页面」
*   可见；引擎在任务上下文与检索时按这个集合过滤。
*
* 路径安全：相对路径基于任务执行者（打工人）的工作区；绝对路径必须位于工作区
* 内；符号链接先 `realpath` 再判断。
*
* @module @buka/dsh-plugin-workflows/attachments
*/
/** 单个附件默认上限：8 MiB。 */
const DEFAULT_MAX_ATTACHMENT_BYTES = 8388608;
/** 每次任务完成默认附件总量上限：64 MiB。 */
const DEFAULT_MAX_TASK_ATTACHMENTS_BYTES = 67108864;
/** prompt 内联单个文本附件的默认上限：32 KiB。 */
const DEFAULT_MAX_INLINE_ATTACHMENT_BYTES = 32768;
/** 页面附件预览一次读取的文本上限：64 KiB。 */
const DEFAULT_PREVIEW_TEXT_BYTES = 65536;
/** 附件清单里文件名允许的最大 UTF-8 字节数。 */
const MAX_NAME_BYTES = 160;
/** 描述允许的最大字符数。 */
const MAX_DESCRIPTION_LENGTH$1 = 500;
/** 可直接 inline 预览的图片扩展名 → MIME；其它类型按文本嗅探或下载。 */
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
/**
* 把任意错误转成一句话。
*
* @param error 任意错误
* @returns 一句话错误
*/
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 按 UTF-8 字节数截断文本，不切断码点。
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
* 正整数或默认值。
*
* @param value 待校验的值
* @param fallback 默认值
* @returns 正整数或默认值
*/
function positive$1(value, fallback) {
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
	name = clipUtf8(name, MAX_NAME_BYTES);
	return name === "" ? "attachment" : name;
}
/**
* 预览类型：按扩展名先划分可 inline 的图片 / PDF，其余交给文本嗅探。
*
* @param name 附件文件名
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
* 规范化一个附件请求；非法项抛出带下标的错误。
*
* @param raw 结果里的 `attachments`
* @param maxCount 数量上限
* @returns 规范化后的附件请求
*/
function normalizeAttachmentRequests(raw, maxCount) {
	if (raw === void 0 || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error("attachments must be an array of file paths or { path, name?, description? } objects");
	const limit = positive$1(maxCount, 20);
	if (raw.length > limit) throw new Error(`attachments must contain at most ${limit} files`);
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
* @param request 附件请求
* @param workspace 打工人工作区（可省略）
* @returns 真实源文件路径与字节数
*/
async function resolveSource(request, workspace) {
	const display = request.path;
	let candidate;
	if (path.isAbsolute(request.path)) candidate = request.path;
	else if (typeof workspace === "string" && workspace !== "") candidate = path.resolve(workspace, request.path);
	else candidate = path.resolve(request.path);
	let source;
	try {
		source = await promises.realpath(candidate);
	} catch (error) {
		throw new Error(`attachment source "${display}" is not readable: ${describeError(error)}`, { cause: error });
	}
	if (typeof workspace === "string" && workspace !== "" && !path.isAbsolute(request.path)) {
		let root;
		try {
			root = await promises.realpath(workspace);
		} catch {
			throw new Error(`attachment source "${display}" is outside the worker workspace`);
		}
		if (!isInside(root, source)) throw new Error(`attachment source "${display}" is outside the worker workspace`);
	}
	let stat;
	try {
		stat = await promises.stat(source);
	} catch (error) {
		throw new Error(`attachment source "${display}" is not readable: ${describeError(error)}`, { cause: error });
	}
	if (!stat.isFile()) throw new Error(`attachment source "${display}" is not a regular file`);
	return {
		source,
		bytes: stat.size
	};
}
/**
* 文件名去重：`report.md`、`report-2.md`（大小写不敏感）。
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
		if (!used.has(candidate.toLowerCase())) {
			used.add(candidate.toLowerCase());
			return candidate;
		}
		index += 1;
	}
	const fallback = `${base}-${Date.now()}${extension}`;
	used.add(fallback.toLowerCase());
	return fallback;
}
/**
* 把一组附件复制进作业附件库，返回附件记录。
*
* 失败时不留下半套文件：已复制的文件与已生成的记录一起回滚（记录由调用方写入，
* 这里只负责文件）。记录里 `path` 是 `attachments/` 下的文件名。
*
* @param input 源清单、作业目录与限额
* @returns 新的附件记录
*/
async function ingestAttachments(input) {
	const directory = path.join(input.jobDirectory, "attachments");
	const requests = normalizeAttachmentRequests(input.raw, input.limits.maxCount);
	if (requests.length === 0) return [];
	const maxBytes = positive$1(input.limits.maxBytes, DEFAULT_MAX_ATTACHMENT_BYTES);
	const maxTotalBytes = positive$1(input.limits.maxTotalBytes, DEFAULT_MAX_TASK_ATTACHMENTS_BYTES);
	await promises.mkdir(directory, { recursive: true });
	const records = [];
	const copied = [];
	const used = /* @__PURE__ */ new Set();
	let total = 0;
	try {
		for (const request of requests) {
			const resolved = await resolveSource(request, input.workspace);
			if (resolved.bytes > maxBytes) throw new Error(`attachment "${request.path}" is too large (${resolved.bytes} bytes; limit is ${maxBytes})`);
			if (total + resolved.bytes > maxTotalBytes) throw new Error(`task attachments exceed the total size limit (${maxTotalBytes} bytes)`);
			const id = newAttachmentId();
			const name = uniqueAttachmentName(sanitizeAttachmentName(request.name, request.path), used);
			const fileName = `${id}-${name}`;
			const destination = path.join(directory, fileName);
			await promises.copyFile(resolved.source, destination, promises.constants.COPYFILE_EXCL);
			const stat = await promises.stat(destination);
			if (stat.size > maxBytes) throw new Error(`attachment "${request.path}" grew beyond the ${maxBytes}-byte limit`);
			total += stat.size;
			if (total > maxTotalBytes) throw new Error(`task attachments exceed the total size limit (${maxTotalBytes} bytes)`);
			const sha256 = await hashFile(destination);
			const preview = attachmentPreviewInfo(name);
			copied.push(destination);
			records.push({
				id,
				jobId: input.jobId,
				name,
				bytes: stat.size,
				mime: preview.kind === "text" ? "application/octet-stream" : preview.mime,
				sha256,
				description: request.description ?? "",
				sourceTaskId: input.taskId,
				sourcePositionId: input.position,
				createdBy: input.createdBy,
				createdAt: nowIso(),
				path: fileName
			});
		}
	} catch (error) {
		await Promise.all(copied.map((file) => promises.rm(file, { force: true }).catch(() => void 0)));
		throw error;
	}
	return records;
}
/**
* 计算文件 sha256。
*
* @param file 文件路径
* @returns 十六进制摘要
*/
async function hashFile(file) {
	const buffer = await promises.readFile(file);
	return createHash("sha256").update(buffer).digest("hex");
}
/**
* 解析附件的绝对路径；只允许作业附件目录里的单个文件名。
*
* @param jobDirectory 作业根目录
* @param relative 记录里的 `path`
* @returns 绝对路径
* @throws 越界或非法文件名时抛出
*/
function resolveAttachmentFile(jobDirectory, relative) {
	if (relative === "" || relative.includes("/") || relative.includes("\\") || relative === "..") throw new Error(`invalid attachment path: ${JSON.stringify(relative)}`);
	return path.join(jobDirectory, "attachments", relative);
}
/**
* 读取文本附件用于 prompt 内联；二进制或超过上限时不返回文本。
*
* @param file 附件绝对路径
* @param maxBytes 内联字节上限
* @returns 可内联时带文本，否则带原因
*/
async function readInlineText(file, maxBytes = DEFAULT_MAX_INLINE_ATTACHMENT_BYTES) {
	const limit = positive$1(maxBytes, DEFAULT_MAX_INLINE_ATTACHMENT_BYTES);
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
* @returns 一段内容
*/
async function readAttachmentRange(file, options = {}) {
	const stat = await promises.stat(file);
	if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${file}`);
	const offset = typeof options.offset === "number" && Number.isInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
	const maxBytes = positive$1(options.maxBytes, DEFAULT_PREVIEW_TEXT_BYTES);
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
/**
* 一个任务可见的附件：自己产出的，以及它直接 / 传递依赖的任务产出的。
*
* @param tasks 作业里的全部任务
* @param currentTaskId 当前任务 id
* @param attachments 作业附件库
* @returns 可见附件（顺序与附件库一致）
*/
function visibleAttachmentsForTask(tasks, currentTaskId, attachments) {
	const visible = visibleTaskIds(tasks, currentTaskId);
	return attachments.filter((attachment) => visible.has(attachment.sourceTaskId));
}
/**
* 可见任务集合：当前任务 + 它的依赖闭包。
*
* @param tasks 作业里的全部任务
* @param currentTaskId 当前任务 id
* @returns 可见来源任务 id
*/
function visibleTaskIds(tasks, currentTaskId) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const visible = /* @__PURE__ */ new Set();
	const queue = [currentTaskId];
	while (queue.length > 0) {
		const taskId = queue.pop();
		if (visible.has(taskId)) continue;
		visible.add(taskId);
		const task = byId.get(taskId);
		for (const dependency of task?.deps ?? []) queue.push(dependency);
	}
	return visible;
}
/**
* 检索附件：按名称 / 描述匹配，只返回可见集合里的条目。
*
* @param attachments 作业附件库
* @param visible 可见附件 id / 来源集合
* @param query 关键词
* @returns 匹配的附件
*/
function searchAttachments(attachments, visible, query) {
	const needle = query.trim().toLowerCase();
	return attachments.filter((attachment) => {
		if (!visible.has(attachment.id)) return false;
		if (needle === "") return true;
		return attachment.name.toLowerCase().includes(needle) || attachment.description.toLowerCase().includes(needle) || attachment.sourceTaskId.toLowerCase().includes(needle);
	});
}
// .build/workflows/output.js
/**
* 受限 JSON Schema 子集：定义校验、运行期结果校验与模板路径检查。
*
* 工作流 v4 里任务类型用 `payload` / `output` 声明创建者必须填的内容与
* 执行者必须交回的结构化结果；开始 / 结束节点也各自声明任务契约。本模块
* 只处理声明与值之间的纯逻辑（不读盘、不依赖 DSH）：
*
* - `parseOutputSchema`：定义校验时使用的 JSON Schema 子集检查。工作流定义
*   由编排 agent 生成，所以这里只放行一组可移植关键字，避免把任意 schema
*   直接当成工具参数；
* - `schemaProblems`：运行期按声明的 schema 校验 payload / output；
* - `resolveOutputPath`：定义校验时检查 `{{start.output.<path>}}` 这类模板
*   引用的路径是否真的在目标 schema 里；
* - `schemaJson`：给 prompt 用的 schema 序列化。
*
* 本模块不修改调用方传入的对象。
*
* @module @buka/dsh-plugin-workflows/output
*/
/** 单份 schema 序列化后的字节上限。 */
const MAX_OUTPUT_SCHEMA_BYTES = 16384;
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
* 校验并规范化一份 payload / output schema。
*
* 顶层必须是 `type: "object"`：任务的 payload 与结构化结果都是 JSON 对象，
* 页面表单与 `buka_task_complete` 都按对象读写。返回只包含合法关键字的新对象；
* 无法构成 schema 时返回 null（错误已记录）。
*
* @param raw 声明的 schema
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
		fail(`${path}.type`, "must be \"object\": task payload and results are JSON objects");
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
					fail(`${path}.properties.${name}`, "must match [A-Za-z0-9_-] and be at most 64 characters so prompts can address it by path");
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
* 判断 prompt 里的路径是否真的在声明的 schema 里。
*
* 规则：
* - 对象按 `properties` 下钻；未声明的字段直接报错（即使 additionalProperties
*   允许，模板引用也必须是显式声明过的字段）；
* - 数组只允许数字下标，并且必须声明了 `items` 才能继续下钻；
* - `oneOf` 的路径必须在所有分支里都存在，避免某一支运行到一半才失败。
*
* @param schema 声明的 schema
* @param segments 路径段（不含 `start.output` 前缀）
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
* 按声明的 schema 校验一个值。
*
* @param schema 声明的 schema
* @param data 待校验的值
* @returns 可读问题列表；空数组表示通过
*/
function schemaProblems(schema, data) {
	const problems = [];
	checkValue(schema, data, "", problems, 0);
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
	const label = path === "" ? "payload" : path;
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
* 把 schema 序列化成 prompt 里展示的 JSON 文本。
*
* @param schema 声明的 schema
* @returns 格式化后的 JSON
*/
function schemaJson(schema) {
	return JSON.stringify(schema, null, 2);
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
* - `{{nodes.<id>.data.<path>}}`：打工人通过 `structured_output` 回报的结构化结果；
* - 需要时也可以引用 `{{nodes.<id>.worker}}`、`{{nodes.<id>.sessionId}}`。
*
* 路径不存在时抛错（而不是静默变空串），这样定义写错时在对应节点立刻失败，
* 不会把空提示词交给打工人。
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
// .build/workflows/definition/payload.js
/**
* payload 模板：路径解析、引用遍历与执行开始时的递归渲染。
*
* 工作流 v4 的 payload 是 JSON 对象，字符串里可以写模板占位符：
*
* - `{{start.output.<path>}}`：启动任务交回的结构化输入；
* - `{{task.<id>.output.<path>}}`：依赖任务的结构化结果；
* - `{{task.<id>.text}}`：依赖任务的文本结果。
*
* 渲染在执行开始时进行（`renderPayload`）；定义校验阶段用 `inspectPayload`
* 只提取路径、不求值，再按目标 schema / 已存在任务检查。路径不存在时抛错
* （而不是静默变空串），避免把空提示词交给执行者。
*
* @module @buka/dsh-plugin-workflows/definition/payload
*/
/** 一个任务 id 里允许的字符（`$start` 走 `start.` 前缀，不在这里）。 */
const TASK_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/u;
/**
* 解析一个模板占位符路径。
*
* @param path 占位符里的点号路径
* @returns 合法时是结构化的引用；不认识的前缀返回 null
*/
function parseTemplatePath(path) {
	const segments = path.split(".");
	const head = segments[0];
	if (head === "start") {
		if (segments[1] !== "output") return null;
		return {
			kind: "start",
			segments: segments.slice(2)
		};
	}
	if (head !== "task") return null;
	const taskId = segments[1] ?? "";
	const field = segments[2];
	if (!TASK_ID_PATTERN.test(taskId)) return null;
	if (field === "text") {
		if (segments.length !== 3) return null;
		return {
			kind: "task",
			taskId,
			field: "text",
			segments: []
		};
	}
	if (field === "output") return {
		kind: "task",
		taskId,
		field: "output",
		segments: segments.slice(3)
	};
	return null;
}
/** 递归遍历一个 JSON 值，收集字符串里的模板引用。 */
function walkTemplateValue(value, out) {
	if (typeof value === "string") {
		const inspected = inspectTemplate(value);
		for (const path of inspected.paths) out.push({
			path,
			reference: parseTemplatePath(path)
		});
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) walkTemplateValue(item, out);
		return;
	}
	if (typeof value === "object" && value !== null) for (const item of Object.values(value)) walkTemplateValue(item, out);
}
/**
* 提取 payload 里的全部模板引用与语法错误；不求值。
*
* @param payload 待检查的 payload
* @returns 引用与语法错误
*/
function inspectPayload(payload) {
	const references = [];
	const syntaxErrors = [];
	walkTemplateValue(payload, references);
	collectSyntaxErrors(payload, syntaxErrors);
	return {
		references,
		syntaxErrors
	};
}
/** 递归收集模板语法错误。 */
function collectSyntaxErrors(value, errors) {
	if (typeof value === "string") {
		for (const error of inspectTemplate(value).errors) errors.push(error);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectSyntaxErrors(item, errors);
		return;
	}
	if (typeof value === "object" && value !== null) for (const item of Object.values(value)) collectSyntaxErrors(item, errors);
}
/**
* 判断一个值是否含模板占位符。
*
* 定义校验用它在 schema 检查时跳过「运行时才有值」的子树。
*
* @param value 待判断的值
* @returns 含占位符时为 true
*/
function containsTemplate(value) {
	if (typeof value === "string") return inspectTemplate(value).paths.length > 0;
	if (Array.isArray(value)) return value.some((item) => containsTemplate(item));
	if (typeof value === "object" && value !== null) return Object.values(value).some((item) => containsTemplate(item));
	return false;
}
/**
* 递归渲染 payload：字符串里的占位符按 `renderTemplate` 求值，容器逐项递归，
* 其它值原样返回。返回新对象，不修改入参。
*
* @param payload 含模板的 payload
* @param context 模板上下文（`start` / `task`）
* @returns 渲染后的 payload
*/
function renderPayload(payload, context) {
	if (typeof payload === "string") return renderTemplate(payload, context);
	if (Array.isArray(payload)) return payload.map((item) => renderPayload(item, context));
	if (typeof payload === "object" && payload !== null) {
		const rendered = {};
		for (const [key, value] of Object.entries(payload)) rendered[key] = renderPayload(value, context);
		return rendered;
	}
	return payload;
}
/**
* 组装模板上下文：
*
* ```json
* { "start": { "output": {...} }, "task": { "<id>": { "output": {...}, "text": "…" } } }
* ```
*
* `start` 与 `task` 都是普通对象，所以 `getPath` 可以按点号路径取值。
*
* @param input 启动任务的结构化输入与依赖任务结果
* @returns 模板上下文
*/
function buildTemplateContext(input) {
	const tasks = {};
	for (const [taskId, value] of input.tasks ?? []) tasks[taskId] = {
		...value.output === void 0 ? {} : { output: value.output },
		...value.text === void 0 ? {} : { text: value.text }
	};
	return {
		start: { output: input.startOutput ?? null },
		task: tasks
	};
}
// .build/workflows/definition/validate.js
/**
* 工作流 v4 定义校验（`.tmp/workflow-v4-spec.md` §5.8）。
*
* 纯函数：不读盘、不依赖 DSH。打工人存在性由调用方传入 `workers` 目录，
* 这样 `buka_workflow_save` 用 workers 服务的登记表，单测用固定目录。
*
* 校验分两步：先解析出规范化定义，再跑跨节点规则（可达性、回边、模板引用）。
* 错误带定位路径，尽量一次返回全部问题；结构缺得太多时提前返回。
*
* @module @buka/dsh-plugin-workflows/definition/validate
*/
/** 岗位 id 与任务类型 id 的形状。 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
/** 内建节点 id。 */
const START_ID = "start";
const END_ID = "end";
/** 收集错误。 */
var Issues = class {
	list = [];
	add(path, message) {
		this.list.push({
			path,
			message
		});
	}
	get failed() {
		return this.list.length > 0;
	}
};
/**
* 校验一份工作流 v4 定义。
*
* @param raw 待校验的原始定义（来自工具参数或 storageDomain）
* @param options 打工人目录
* @returns 规范化定义，或全部校验错误
*/
function validateWorkflowDefinition(raw, options) {
	const issues = new Issues();
	if (!isPlainObject$1(raw)) {
		issues.add("", "workflow definition must be a JSON object");
		return {
			ok: false,
			issues: issues.list
		};
	}
	if (raw.version !== 4) issues.add("version", "must be 4");
	const name = readName(raw, "name", "", issues);
	const description = readOptionalString(raw, "description", "description", issues) ?? "";
	const budgets = readBudgets(raw.budgets, issues);
	const positions = readPositions(raw.positions, options.workers, issues);
	const positionById = new Map(positions.map((position) => [position.id, position]));
	const typeById = /* @__PURE__ */ new Map();
	for (const position of positions) for (const taskType of position.taskTypes) typeById.set(taskType.id, taskType);
	for (const [positionIndex, position] of positions.entries()) for (const [taskTypeIndex, taskType] of position.taskTypes.entries()) for (const [requirementIndex, requirement] of (taskType.requires ?? []).entries()) for (const requiredType of requirement.types) {
		if (typeById.has(requiredType)) continue;
		issues.add(`positions[${positionIndex}].taskTypes[${taskTypeIndex}].requires[${requirementIndex}].types`, `unknown task type "${requiredType}": requires may only reference task types declared in this workflow`);
	}
	const edges = readEdges(raw.edges, positionById, typeById, issues);
	const start = readStart(raw.start, positionById, typeById, issues);
	const end = readEnd(raw.end, issues);
	checkEdges(edges, positions, issues);
	checkReachability(edges, positions, issues);
	checkStartNext(start, positionById, typeById, edges, issues);
	checkEnd(edges, positions, issues);
	if (issues.failed) return {
		ok: false,
		issues: issues.list
	};
	if (name === null || budgets === null || start === null || end === null) return {
		ok: false,
		issues: issues.list
	};
	return {
		ok: true,
		definition: {
			version: 4,
			name,
			...description === "" ? {} : { description },
			budgets,
			start,
			end,
			positions,
			edges
		}
	};
}
/** 读取必填字符串字段。 */
function readName(source, key, path, issues) {
	const value = source[key];
	const at = path === "" ? key : `${path}.${key}`;
	if (typeof value !== "string" || value.trim() === "") {
		issues.add(at, "must be a non-empty string");
		return null;
	}
	return value.trim();
}
/** 读取可选字符串字段。 */
function readOptionalString(source, key, path, issues) {
	const value = source[key];
	if (value === void 0 || value === null) return null;
	if (typeof value !== "string") {
		issues.add(path, "must be a string");
		return null;
	}
	return value;
}
/** 解析预算。 */
function readBudgets(raw, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add("budgets", "must declare maxTasks and maxDurationHours");
		return null;
	}
	let valid = true;
	const maxTasks = raw.maxTasks;
	if (typeof maxTasks !== "number" || !Number.isInteger(maxTasks) || maxTasks < 1) {
		issues.add("budgets.maxTasks", "must be a positive integer");
		valid = false;
	}
	const maxDurationHours = raw.maxDurationHours;
	if (typeof maxDurationHours !== "number" || !Number.isFinite(maxDurationHours) || maxDurationHours <= 0) {
		issues.add("budgets.maxDurationHours", "must be a positive number of hours");
		valid = false;
	}
	if (!valid) return null;
	return {
		maxTasks,
		maxDurationHours
	};
}
/** 解析岗位列表。 */
function readPositions(raw, workers, issues) {
	if (!Array.isArray(raw) || raw.length === 0) {
		issues.add("positions", "must be a non-empty array");
		return [];
	}
	const positions = [];
	const seenPositions = /* @__PURE__ */ new Set();
	const seenTypes = /* @__PURE__ */ new Set();
	for (const [index, entry] of raw.entries()) {
		const path = `positions[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(path, "must be an object");
			continue;
		}
		const id = readPositionId(entry, path, seenPositions, issues);
		if (id === null) continue;
		const label = readName(entry, "label", path, issues);
		const description = readOptionalString(entry, "description", `${path}.description`, issues);
		const executor = readExecutor(entry.executor, `${path}.executor`, workers, issues);
		const taskTypes = readTaskTypes(entry.taskTypes, `${path}.taskTypes`, id, executor, workers, seenTypes, issues);
		if (label === null || executor === null) continue;
		if (taskTypes.length === 0) issues.add(`${path}.taskTypes`, "a position must declare at least one task type");
		positions.push({
			id,
			label,
			...description === null || description === "" ? {} : { description },
			executor,
			taskTypes
		});
	}
	return positions;
}
/** 读取岗位 id 并检查唯一性 / 保留字。 */
function readPositionId(entry, path, seen, issues) {
	const id = entry.id;
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		issues.add(`${path}.id`, "must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
		return null;
	}
	if (id === START_ID || id === END_ID) {
		issues.add(`${path}.id`, `"${id}" is reserved by the built-in start/end nodes`);
		return null;
	}
	if (seen.has(id)) {
		issues.add(`${path}.id`, `duplicate position id "${id}"`);
		return null;
	}
	seen.add(id);
	return id;
}
/** 解析岗位执行者。 */
function readExecutor(raw, path, workers, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add(path, "must be { kind: \"worker\", name } or { kind: \"human\" }");
		return null;
	}
	if (raw.kind === "human") return { kind: "human" };
	if (raw.kind !== "worker") {
		issues.add(`${path}.kind`, "must be \"worker\" or \"human\"");
		return null;
	}
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (name === "") {
		issues.add(`${path}.name`, "must be a non-empty worker name");
		return null;
	}
	if (!workers.has(name)) {
		issues.add(`${path}.name`, `unknown worker "${name}": register it with the Buka Workers plugin first`);
		return null;
	}
	return {
		kind: "worker",
		name
	};
}
/** 解析一个岗位的任务类型列表。 */
function readTaskTypes(raw, path, positionId, executor, workers, seenTypes, issues) {
	if (!Array.isArray(raw) || raw.length === 0) {
		issues.add(path, "must be a non-empty array");
		return [];
	}
	const taskTypes = [];
	for (const [index, entry] of raw.entries()) {
		const at = `${path}[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(at, "must be an object");
			continue;
		}
		const taskType = readTaskType(entry, at, positionId, executor, workers, seenTypes, issues);
		if (taskType !== null) taskTypes.push(taskType);
	}
	return taskTypes;
}
/** 解析一个任务类型。 */
function readTaskType(entry, path, positionId, executor, workers, seenTypes, issues) {
	const id = entry.id;
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		issues.add(`${path}.id`, "must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
		return null;
	}
	if (seenTypes.has(id)) {
		issues.add(`${path}.id`, `duplicate task type id "${id}": task type ids are unique in a workflow`);
		return null;
	}
	seenTypes.add(id);
	const label = readName(entry, "label", path, issues);
	const description = readOptionalString(entry, "description", `${path}.description`, issues);
	const payload = readSchema(entry.payload, `${path}.payload`, issues) ?? { type: "object" };
	const output = readSchema(entry.output, `${path}.output`, issues) ?? { type: "object" };
	const requires = readRequires(entry.requires, `${path}.requires`, issues);
	const assistant = readAssistant(entry.assistant, `${path}.assistant`, positionId, executor, workers, issues);
	const mode = readMode(entry.mode, `${path}.mode`, path, executor, workers, issues);
	if (label === null) return null;
	return {
		id,
		label,
		...description === null || description === "" ? {} : { description },
		payload,
		output,
		...requires === void 0 ? {} : { requires },
		...assistant === void 0 ? {} : { assistant },
		...mode === void 0 ? {} : { mode }
	};
}
/** 解析 schema 字段。 */
function readSchema(raw, path, issues) {
	if (raw === void 0 || raw === null) return null;
	return parseOutputSchema(raw, path, (at, message) => issues.add(at, message));
}
/** 解析 `requires`。 */
function readRequires(raw, path, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (!Array.isArray(raw)) {
		issues.add(path, "must be an array of { types: [...] } requirements");
		return;
	}
	const requirements = [];
	for (const [index, entry] of raw.entries()) {
		const at = `${path}[${index}]`;
		if (!isPlainObject$1(entry) || !Array.isArray(entry.types) || entry.types.length === 0) {
			issues.add(at, "must be { types: [<task type ids>] } with at least one type");
			continue;
		}
		const types = [];
		for (const [typeIndex, value] of entry.types.entries()) {
			if (typeof value !== "string" || value.trim() === "") {
				issues.add(`${at}.types[${typeIndex}]`, "must be a non-empty task type id");
				continue;
			}
			types.push(value.trim());
		}
		if (types.length > 0) requirements.push({ types });
	}
	return requirements.length > 0 ? requirements : void 0;
}
/** 解析助理字段；只对人岗位有效。 */
function readAssistant(raw, path, positionId, executor, workers, issues) {
	if (raw === void 0) return void 0;
	if (executor !== null && executor.kind !== "human") {
		issues.add(path, `assistant is only valid on human positions (position "${positionId}")`);
		return;
	}
	if (raw === null) return null;
	if (typeof raw !== "string" || raw.trim() === "") {
		issues.add(path, "must be a worker name or null");
		return;
	}
	const name = raw.trim();
	const worker = workers.get(name);
	if (worker === void 0) {
		issues.add(path, `unknown assistant worker "${name}": register it with the Buka Workers plugin first`);
		return;
	}
	if (worker.driver !== "agent") {
		issues.add(path, `assistant "${name}" must be an agent, not a robot`);
		return;
	}
	if (!worker.assistant) {
		issues.add(path, `worker "${name}" is not marked as an assistant in the Buka Workers plugin`);
		return;
	}
	return name;
}
/** 解析 plan 模式；只对智能体有效。 */
function readMode(raw, path, ownerPath, executor, workers, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (raw !== "plan") {
		issues.add(path, "must be \"plan\" or null");
		return;
	}
	if (executor === null) return void 0;
	if (executor.kind !== "worker") {
		issues.add(path, "mode \"plan\" is only valid for agent positions");
		return;
	}
	const worker = workers.get(executor.name);
	if (worker === void 0 || worker.driver !== "agent") {
		issues.add(`${ownerPath}.executor`, "mode \"plan\" requires an agent executor");
		return;
	}
	return "plan";
}
/** 解析边列表。 */
function readEdges(raw, positionById, typeById, issues) {
	if (!Array.isArray(raw)) {
		issues.add("edges", "must be an array");
		return [];
	}
	const edges = [];
	const seen = /* @__PURE__ */ new Set();
	for (const [index, entry] of raw.entries()) {
		const path = `edges[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(path, "must be an object");
			continue;
		}
		const from = typeof entry.from === "string" ? entry.from.trim() : "";
		const to = typeof entry.to === "string" ? entry.to.trim() : "";
		if (!isKnownNode(from, positionById)) {
			issues.add(`${path}.from`, `unknown node "${String(entry.from)}"`);
			continue;
		}
		if (!isKnownNode(to, positionById)) {
			issues.add(`${path}.to`, `unknown node "${String(entry.to)}"`);
			continue;
		}
		if (from === END_ID) {
			issues.add(`${path}.from`, "the built-in end node cannot dispatch tasks");
			continue;
		}
		if (to === START_ID) {
			issues.add(`${path}.to`, "the built-in start node cannot receive tasks");
			continue;
		}
		if (from === to) {
			issues.add(path, "an edge must connect two different nodes");
			continue;
		}
		const key = `${from}->${to}`;
		if (seen.has(key)) {
			issues.add(path, `duplicate edge "${key}"`);
			continue;
		}
		seen.add(key);
		const types = readEdgeTypes(entry.types, `${path}.types`, to, positionById, typeById, issues);
		if (entry.back !== void 0 && typeof entry.back !== "boolean") issues.add(`${path}.back`, "must be true or false");
		edges.push({
			from,
			to,
			...types === void 0 ? {} : { types },
			...entry.back === true ? { back: true } : {}
		});
	}
	return edges;
}
/** 判断节点是否存在（岗位或内建 start / end）。 */
function isKnownNode(id, positionById) {
	return id === START_ID || id === END_ID || positionById.has(id);
}
/** 解析边上的任务类型白名单。 */
function readEdgeTypes(raw, path, to, positionById, typeById, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (to === END_ID) {
		issues.add(path, "the built-in end node has a single contract; an edge into it cannot whitelist types");
		return;
	}
	const target = positionById.get(to);
	if (target === void 0) return void 0;
	if (!Array.isArray(raw) || raw.length === 0) {
		issues.add(path, "must be a non-empty array of task type ids");
		return;
	}
	const allowed = new Set(target.taskTypes.map((taskType) => taskType.id));
	const types = [];
	for (const [index, value] of raw.entries()) {
		if (typeof value !== "string" || value.trim() === "") {
			issues.add(`${path}[${index}]`, "must be a non-empty task type id");
			continue;
		}
		const type = value.trim();
		if (!allowed.has(type) || !typeById.has(type)) {
			issues.add(`${path}[${index}]`, `"${type}" is not a task type of position "${to}"`);
			continue;
		}
		if (!types.includes(type)) types.push(type);
	}
	return types.length > 0 ? types : void 0;
}
/** 解析开始节点。 */
function readStart(raw, positionById, typeById, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add("start", "must declare the built-in start node task contract");
		return null;
	}
	const task = isPlainObject$1(raw.task) ? raw.task : null;
	if (task === null) {
		issues.add("start.task", "must declare payload and output schemas");
		return null;
	}
	const payload = readSchema(task.payload, "start.task.payload", issues) ?? { type: "object" };
	const output = readSchema(task.output, "start.task.output", issues);
	if (output === null) {
		issues.add("start.task.output", "is required: it is the structured input later tasks consume");
		return null;
	}
	const routes = readStartRoutes(raw.next, "start.next", positionById, typeById, output, issues);
	return {
		task: {
			payload,
			output
		},
		next: routes
	};
}
/** 解析 `start.next` 模板列表。 */
function readStartRoutes(raw, path, positionById, typeById, startOutput, issues) {
	if (!Array.isArray(raw) || raw.length === 0) {
		issues.add(path, "must be a non-empty array of initial task templates");
		return [];
	}
	const routes = [];
	for (const [index, entry] of raw.entries()) {
		const at = `${path}[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(at, "must be an object");
			continue;
		}
		const position = typeof entry.position === "string" ? entry.position.trim() : "";
		const target = positionById.get(position);
		if (target === void 0) {
			issues.add(`${at}.position`, `unknown position "${String(entry.position)}"`);
			continue;
		}
		const type = typeof entry.type === "string" ? entry.type.trim() : "";
		const taskType = typeById.get(type);
		if (taskType === void 0 || !target.taskTypes.some((candidate) => candidate.id === type)) {
			issues.add(`${at}.type`, `"${String(entry.type)}" is not a task type of position "${position}"`);
			continue;
		}
		if (!isPlainObject$1(entry.payload)) {
			issues.add(`${at}.payload`, "must be an object");
			continue;
		}
		const dependsOn = readStartDependsOn(entry.dependsOn, `${at}.dependsOn`, issues);
		validateRoutePayload(entry.payload, `${at}.payload`, taskType, startOutput, issues);
		routes.push({
			position,
			type,
			payload: entry.payload,
			...dependsOn === void 0 ? {} : { dependsOn }
		});
	}
	return routes;
}
/** 解析初始任务的 `dependsOn`：目前只允许且必须包含 `$start`。 */
function readStartDependsOn(raw, path, issues) {
	if (!Array.isArray(raw) || raw.length === 0) {
		issues.add(path, "must be [\"$start\"]: initial tasks explicitly depend on the start task");
		return;
	}
	let valid = true;
	const deps = [];
	for (const [index, value] of raw.entries()) {
		if (value !== "$start") {
			issues.add(`${path}[${index}]`, "initial tasks can only depend on \"$start\"; they are created after the start task completes");
			valid = false;
			continue;
		}
		if (deps.includes("$start")) {
			issues.add(`${path}[${index}]`, "duplicate \"$start\" dependency");
			valid = false;
			continue;
		}
		deps.push("$start");
	}
	if (!deps.includes("$start")) {
		issues.add(path, "must include \"$start\": initial tasks explicitly depend on the start task");
		valid = false;
	}
	return valid ? deps : void 0;
}
/** 按任务类型的 payload schema 校验模板 payload（含模板的子树留给运行期）。 */
function validateRoutePayload(payload, path, taskType, startOutput, issues) {
	const inspection = inspectPayload(payload);
	for (const error of inspection.syntaxErrors) issues.add(path, error);
	for (const reference of inspection.references) {
		if (reference.reference === null) {
			issues.add(path, `template "{{${reference.path}}}" must reference start.output; initial tasks may only use {{start.output.<path>}}`);
			continue;
		}
		if (reference.reference.kind !== "start") {
			issues.add(path, `template "{{${reference.path}}}" must reference start.output: no other task exists yet`);
			continue;
		}
		const reason = resolveOutputPath(startOutput, reference.reference.segments);
		if (reason !== null) issues.add(path, `template "{{${reference.path}}}" ${reason}`);
	}
	checkTemplatedPayload(taskType.payload, payload, path, issues);
}
/**
* 按 schema 校验可能含模板的值。
*
* 含模板的子树跳过类型 / 枚举检查（值要到执行时才有），但对象 / 数组的结构、
* required 与 additionalProperties 仍然检查。
*/
function checkTemplatedPayload(schema, value, path, issues) {
	if (Array.isArray(schema.oneOf)) {
		if (!schema.oneOf.some((branch) => {
			const probe = new Issues();
			checkTemplatedPayload(branch, value, path, probe);
			return !probe.failed;
		})) issues.add(path, "does not match any oneOf variant");
		return;
	}
	if (typeof value === "string" && containsTemplate(value)) return;
	if (Array.isArray(schema.enum) || Object.hasOwn(schema, "const")) {
		if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) issues.add(path, `must be one of ${JSON.stringify(schema.enum)}`);
		if (Object.hasOwn(schema, "const") && schema.const !== value) issues.add(path, `must equal ${JSON.stringify(schema.const)}`);
		return;
	}
	const type = typeof schema.type === "string" ? schema.type : "";
	if (type === "object") {
		if (!isPlainObject$1(value)) {
			issues.add(path, "must be an object");
			return;
		}
		const properties = isPlainObject$1(schema.properties) ? schema.properties : {};
		for (const name of Array.isArray(schema.required) ? schema.required : []) if (!Object.hasOwn(value, name)) issues.add(`${path}.${name}`, "missing required field");
		if (schema.additionalProperties === false) {
			for (const name of Object.keys(value)) if (!Object.hasOwn(properties, name)) issues.add(`${path}.${name}`, "unexpected field (additionalProperties is false)");
		}
		for (const [name, child] of Object.entries(properties)) {
			if (!Object.hasOwn(value, name)) continue;
			checkTemplatedPayload(child, value[name], `${path}.${name}`, issues);
		}
		return;
	}
	if (type === "array") {
		if (!Array.isArray(value)) {
			issues.add(path, "must be an array");
			return;
		}
		if (isPlainObject$1(schema.items)) value.forEach((item, index) => {
			checkTemplatedPayload(schema.items, item, `${path}[${index}]`, issues);
		});
		return;
	}
	if (type === "") return;
	if (value === null ? type !== "null" : typeof value !== type) {
		const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
		issues.add(path, `expected ${type}, got ${actual}`);
	}
}
/** 解析结束节点。 */
function readEnd(raw, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add("end", "must declare the built-in end node task contract");
		return null;
	}
	const task = isPlainObject$1(raw.task) ? raw.task : null;
	if (task === null) {
		issues.add("end.task", "must declare the payload schema of the final deliverable");
		return null;
	}
	const payload = readSchema(task.payload, "end.task.payload", issues);
	if (payload === null) {
		issues.add("end.task.payload", "is required: it describes the final deliverable");
		return null;
	}
	return { task: { payload } };
}
/**
* 边与节点的结构检查：回边闭合、环上至少一条回边、start/end 关系。
*
* 规则按 spec：环上的边必须有显式标记，回边必须真的闭合一个环。一个环只需要
* 一条 `back: true`（例：`qa -> dev` 标 back，`dev -> qa` 是环里向前的边，
* 不必再标），所以按强连通分量检查：每个多节点分量至少有一条内部回边。
*/
function checkEdges(edges, positions, issues) {
	const nodes = /* @__PURE__ */ new Set([
		START_ID,
		END_ID,
		...positions.map((position) => position.id)
	]);
	const adjacency = /* @__PURE__ */ new Map();
	for (const node of nodes) adjacency.set(node, /* @__PURE__ */ new Set());
	for (const edge of edges) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
		adjacency.get(edge.from)?.add(edge.to);
	}
	const reach = (from) => {
		const seen = /* @__PURE__ */ new Set();
		const queue = [from];
		while (queue.length > 0) {
			const node = queue.pop();
			for (const next of adjacency.get(node) ?? []) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		return seen;
	};
	const reachability = /* @__PURE__ */ new Map();
	for (const node of nodes) reachability.set(node, reach(node));
	for (const [index, edge] of edges.entries()) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
		if (edge.back !== true) continue;
		if (reachability.get(edge.to)?.has(edge.from) === true) continue;
		issues.add(`edges[${index}].back`, `edge "${edge.from} -> ${edge.to}" does not close a cycle and cannot be marked back`);
	}
	const grouped = /* @__PURE__ */ new Set();
	for (const node of nodes) {
		if (grouped.has(node)) continue;
		const members = /* @__PURE__ */ new Set([node]);
		for (const other of nodes) {
			if (other === node || grouped.has(other)) continue;
			if (reachability.get(node)?.has(other) !== true) continue;
			if (reachability.get(other)?.has(node) !== true) continue;
			members.add(other);
		}
		if (members.size < 2) continue;
		for (const member of members) grouped.add(member);
		if (edges.flatMap((edge, index) => edge.back === true && members.has(edge.from) && members.has(edge.to) ? [index] : []).length > 0) continue;
		const first = edges.findIndex((edge) => members.has(edge.from) && members.has(edge.to));
		const cycle = [...members].join(" -> ");
		issues.add(`edges[${Math.max(first, 0)}].back`, `cycle "${cycle}" has no explicit back edge: mark the edge that closes it with "back": true`);
	}
}
/** 可达性：每个岗位都能从 start 到达，也能到达 end。 */
function checkReachability(edges, positions, issues) {
	const nodes = /* @__PURE__ */ new Set([
		START_ID,
		END_ID,
		...positions.map((position) => position.id)
	]);
	const forward = /* @__PURE__ */ new Map();
	const reverse = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		forward.set(node, /* @__PURE__ */ new Set());
		reverse.set(node, /* @__PURE__ */ new Set());
	}
	for (const edge of edges) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
		forward.get(edge.from)?.add(edge.to);
		reverse.get(edge.to)?.add(edge.from);
	}
	const fromStart = walkFrom(START_ID, forward);
	const toEnd = walkFrom(END_ID, reverse);
	for (const position of positions) {
		if (!fromStart.has(position.id)) issues.add(`positions.${position.id}`, "is unreachable from the built-in start node: add an edge path from start");
		if (!toEnd.has(position.id)) issues.add(`positions.${position.id}`, "cannot reach the built-in end node: add an edge path to end");
	}
}
/** 从某个节点出发的可达集合。 */
function walkFrom(from, adjacency) {
	const seen = /* @__PURE__ */ new Set();
	const queue = [from];
	while (queue.length > 0) {
		const node = queue.pop();
		for (const next of adjacency.get(node) ?? []) {
			if (seen.has(next) || next === from) continue;
			seen.add(next);
			queue.push(next);
		}
	}
	return seen;
}
/** `start.next` 的跨节点检查：直接后继、边白名单、模板只引用 start.output。 */
function checkStartNext(start, positionById, typeById, edges, issues) {
	if (start === null) return;
	for (const [index, route] of start.next.entries()) {
		if (positionById.get(route.position) === void 0) continue;
		if (typeById.get(route.type) === void 0) continue;
		const edge = edges.find((candidate) => candidate.from === START_ID && candidate.to === route.position);
		if (edge === void 0) {
			issues.add(`start.next[${index}].position`, `initial tasks must target a direct successor of the start node: no "start -> ${route.position}" edge`);
			continue;
		}
		if (edge.types !== void 0 && !edge.types.includes(route.type)) issues.add(`start.next[${index}].type`, `edge "start -> ${route.position}" does not allow task type "${route.type}"`);
	}
}
/** 结束节点检查：至少一条入边；能派发结束任务的岗位必须与 end 有边。 */
function checkEnd(edges, positions, issues) {
	const intoEnd = edges.filter((edge) => edge.to === END_ID);
	if (intoEnd.length === 0) issues.add("edges", "at least one position must have an edge into the built-in end node");
	for (const [index, edge] of intoEnd.entries()) {
		if (edge.from === START_ID) {
			issues.add(`edges.end[${index}]`, "the start node cannot dispatch the end task; only positions can");
			continue;
		}
		if (positions.every((position) => position.id !== edge.from)) issues.add(`edges.end[${index}].from`, `unknown position "${edge.from}"`);
	}
}
/**
* 判断一个任务类型是否允许某个派发（边白名单）。
*
* 引擎创建任务时复用这里的规则。
*
* @param edge 边
* @param type 任务类型 id
* @returns 允许时为 true
*/
function edgeAllowsType(edge, type) {
	return edge.types === void 0 || edge.types.includes(type);
}
/**
* 在定义里找一条从 `from` 到 `to` 的边。
*
* @param definition 定义
* @param from 创建者岗位
* @param to 目标岗位
* @returns 边；不存在时是 undefined
*/
function findEdge(definition, from, to) {
	return definition.edges.find((edge) => edge.from === from && edge.to === to);
}
/**
* 按岗位 id 取岗位。
*
* @param definition 定义
* @param positionId 岗位 id
* @returns 岗位；不存在时是 undefined
*/
function findPosition(definition, positionId) {
	return definition.positions.find((position) => position.id === positionId);
}
/**
* 按任务类型 id 取类型定义。
*
* @param definition 定义
* @param typeId 任务类型 id
* @returns 任务类型；不存在时是 undefined
*/
function findTaskType(definition, typeId) {
	for (const position of definition.positions) for (const taskType of position.taskTypes) if (taskType.id === typeId) return taskType;
}
/**
* 按 schema 校验一个可能含模板的值，返回带路径的问题列表。
*
* 引擎创建任务时复用：payload 里的模板子树只做结构检查，类型与枚举留给执行时。
*
* @param schema 任务类型的 payload schema
* @param value 待校验的 payload
* @returns 问题列表；空数组表示通过
*/
function templatedPayloadIssues(schema, value) {
	const issues = new Issues();
	checkTemplatedPayload(schema, value, "payload", issues);
	return issues.list;
}
// .build/workflows/domain/status.js
/**
* 任务 / 作业状态机：合法的状态转换矩阵。
*
* 规则来自 `.tmp/workflow-v4-spec.md` §6.3 / §7.2 / §7.8：
*
* - 任务依赖完成才 `ready`；依赖被取消 / 阻塞时 `blocked`；
* - 认领把 `ready` 变成 `running`；
* - 技术失败进 `failed`，重试把同一个任务退回 `ready`（新增执行记录，历史保留）；
* - 失败任务被用户放弃（取消）后，依赖它的任务 `blocked`；
* - 业务「不通过」不是状态：结果里写 `result: "fail"`，由执行者再派新任务。
*
* 纯函数，不依赖任何服务，便于单测。
*
* @module @buka/dsh-plugin-workflows/domain/status
*/
/** 全部任务状态。 */
const TASK_STATUSES = Object.freeze([
	"pending",
	"ready",
	"running",
	"completed",
	"failed",
	"blocked",
	"cancelled"
]);
/** 任务终态：不再变化，也不再阻塞作业结算。 */
const TERMINAL_TASK_STATUSES = Object.freeze([
	"completed",
	"failed",
	"blocked",
	"cancelled"
]);
Object.freeze([
	"pending",
	"ready",
	"running"
]);
/** 合法任务状态转换矩阵；数组为空表示终态。 */
const TASK_TRANSITIONS = Object.freeze({
	pending: [
		"ready",
		"blocked",
		"cancelled"
	],
	ready: [
		"running",
		"completed",
		"blocked",
		"cancelled"
	],
	running: [
		"completed",
		"failed",
		"cancelled",
		"ready"
	],
	completed: [],
	failed: ["ready", "cancelled"],
	blocked: ["cancelled"],
	cancelled: []
});
Object.freeze([
	"running",
	"completed",
	"failed",
	"cancelled"
]);
/** 作业终态。 */
const TERMINAL_JOB_STATUSES = Object.freeze([
	"completed",
	"failed",
	"cancelled"
]);
/** 合法作业状态转换矩阵。 */
const JOB_TRANSITIONS = Object.freeze({
	running: [
		"completed",
		"failed",
		"cancelled"
	],
	completed: [],
	failed: [],
	cancelled: []
});
/**
* 判断任务状态是否终态。
*
* @param status 任务状态
* @returns 是终态时为 true
*/
function isTerminalTaskStatus(status) {
	return TERMINAL_TASK_STATUSES.includes(status);
}
/**
* 判断任务状态是否非终态。
*
* @param status 任务状态
* @returns 非终态时为 true
*/
function isOpenTaskStatus(status) {
	return !isTerminalTaskStatus(status);
}
/**
* 判断作业状态是否终态。
*
* @param status 作业状态
* @returns 是终态时为 true
*/
function isTerminalJobStatus(status) {
	return TERMINAL_JOB_STATUSES.includes(status);
}
/**
* 判断一次任务状态转换是否合法。
*
* @param from 当前状态
* @param to 目标状态
* @returns 合法时为 true
*/
function canTransitionTask(from, to) {
	return TASK_TRANSITIONS[from].includes(to);
}
/**
* 判断一次作业状态转换是否合法。
*
* @param from 当前状态
* @param to 目标状态
* @returns 合法时为 true
*/
function canTransitionJob(from, to) {
	return JOB_TRANSITIONS[from].includes(to);
}
/**
* 断言一次任务状态转换合法，非法时抛出带任务 id 的错误。
*
* @param taskId 任务 id
* @param from 当前状态
* @param to 目标状态
* @throws 转换非法时抛出
*/
function assertTaskTransition(taskId, from, to) {
	if (canTransitionTask(from, to)) return;
	throw new Error(`task ${taskId}: illegal status transition ${from} -> ${to}`);
}
/**
* 断言一次作业状态转换合法，非法时抛出带作业 id 的错误。
*
* @param jobId 作业 id
* @param from 当前状态
* @param to 目标状态
* @throws 转换非法时抛出
*/
function assertJobTransition(jobId, from, to) {
	if (canTransitionJob(from, to)) return;
	throw new Error(`job ${jobId}: illegal status transition ${from} -> ${to}`);
}
// .build/workflows/program/clock.js
/**
* 机器人驱动：v1 只有内建 `clock`。
*
* `clock` 任务在 payload 里带 `until`（ISO 时间）；到点完成，不建会话、不占
* 打工人实例。重启时按 `until` 重新计时：已过则立即完成。
*
* @module @buka/dsh-plugin-workflows/program/clock
*/
/** 内建 `clock` 驱动 id；与 workers 登记表里的 program id 一致。 */
const CLOCK_PROGRAM_ID = "clock";
/** Node `setTimeout` 的最大延迟；超过时分段计时。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
/**
* 解析 payload 里的 `until`。
*
* @param payload 任务 payload
* @returns 时间戳（毫秒）；不合法时是 null
*/
function clockUntil(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const raw = payload.until;
	if (typeof raw !== "string" || raw.trim() === "") return null;
	const parsed = Date.parse(raw);
	return Number.isNaN(parsed) ? null : parsed;
}
/**
* 等一段时间；`AbortSignal` 取消时 reject。
*
* @param delayMs 延迟毫秒
* @param signal 取消信号
* @returns 无返回值
*/
function sleep(delayMs, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(/* @__PURE__ */ new Error("clock task was cancelled"));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, Math.min(delayMs, MAX_TIMER_DELAY_MS));
		timer.unref?.();
		const onAbort = () => {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("clock task was cancelled"));
		};
		signal.addEventListener?.("abort", onAbort, { once: true });
	});
}
/** v1 可用的 program 驱动表。 */
const PROGRAM_DRIVERS = /* @__PURE__ */ new Map([[CLOCK_PROGRAM_ID, {
	id: CLOCK_PROGRAM_ID,
	async run({ payload, signal }) {
		const until = clockUntil(payload);
		if (until === null) throw new Error("clock task payload must contain an ISO timestamp \"until\"");
		while (Date.now() < until) {
			if (signal.aborted) throw new Error("clock task was cancelled");
			await sleep(until - Date.now(), signal);
		}
		return { output: { completedAt: (/* @__PURE__ */ new Date()).toISOString() } };
	}
}]]);
/**
* 取一个 program 驱动。
*
* @param programId 驱动 id
* @returns 驱动；未知时是 undefined
*/
function programDriver(programId) {
	return PROGRAM_DRIVERS.get(programId);
}
// .build/workflows/engine/prompt.js
/**
* 任务执行上下文组装（`.tmp/workflow-v4-spec.md` §7.6）。
*
* 一个任务 = 一条全新会话，上下文由引擎按依赖与任务契约组装：
*
* 1. 岗位说明；
* 2. 任务类型说明；
* 3. 渲染后的 payload；
* 4. 依赖任务摘要与可见附件清单；
* 5. 产出契约（output schema + `buka_task_complete` + 附件规则）；
* 6. 可派发的直接后继岗位 / 类型白名单。
*
* 同时负责开始任务的「原始输入 → 结构化输入」提示与结束任务的投递文本。
*
* @module @buka/dsh-plugin-workflows/engine/prompt
*/
/** 依赖摘要里单段文本的上限。 */
const PREVIEW_BYTES = 1200;
/**
* 按任务类型取岗位（任务的岗位在定义里唯一）。
*
* @param definition 定义
* @param positionId 岗位 id
* @returns 岗位；不存在时 undefined
*/
function positionOf(definition, positionId) {
	return definition.positions.find((position) => position.id === positionId);
}
/**
* 任务类型的展示名。
*
* @param definition 定义
* @param typeId 任务类型 id
* @returns 展示名；未知时用 id
*/
function taskTypeLabel(definition, typeId) {
	if (typeId === "start") return "启动任务";
	if (typeId === "end") return "结束任务";
	return findTaskType(definition, typeId)?.label ?? typeId;
}
/**
* 岗位的展示名。
*
* @param definition 定义
* @param positionId 岗位 id
* @returns 展示名；内建节点给中文名
*/
function positionLabel(definition, positionId) {
	if (positionId === "start") return "开始";
	if (positionId === "end") return "结束";
	return positionOf(definition, positionId)?.label ?? positionId;
}
/**
* 渲染一个任务的 payload 模板。
*
* @param payload 原始 payload（可能含模板）
* @param tasks 作业里的全部任务
* @returns 渲染后的 payload
*/
function renderTaskPayload(payload, tasks) {
	const start = tasks.find((task) => task.id === START_TASK_ID);
	const values = /* @__PURE__ */ new Map();
	for (const task of tasks) values.set(task.id, {
		...task.result?.output === null || task.result?.output === void 0 ? {} : { output: task.result.output },
		...task.result?.text === void 0 ? {} : { text: task.result.text }
	});
	return renderPayload(payload, buildTemplateContext({
		startOutput: start?.result?.output ?? null,
		tasks: values
	}));
}
/**
* 一段任务结果的摘要（id / 类型 / 状态 / 文本 / 结构化结果）。
*
* @param task 任务记录
* @param definition 作业定义
* @returns 可读摘要
*/
function summarizeTaskResult(task, definition) {
	const lines = [`- task ${task.id} [${task.status}] ${positionLabel(definition, task.position)} / ${taskTypeLabel(definition, task.type)}`];
	if (task.error !== null) lines.push(`  error: ${clipUtf8(task.error, PREVIEW_BYTES)}`);
	const text = task.result?.text ?? "";
	if (text.trim() !== "") lines.push(`  text: ${clipUtf8(text.trim(), PREVIEW_BYTES)}`);
	if (task.result?.output !== null && task.result?.output !== void 0) lines.push(`  output: ${clipUtf8(JSON.stringify(task.result.output), PREVIEW_BYTES)}`);
	return lines.join("\n");
}
/**
* 可派发的直接后继：目标岗位 + 允许的任务类型。
*
* @param definition 定义
* @param fromPosition 创建者岗位
* @returns 后继说明
*/
function successorLines(definition, fromPosition) {
	const lines = [];
	for (const edge of definition.edges) {
		if (edge.from !== fromPosition) continue;
		if (edge.to === "end") {
			lines.push("- end（结束任务：payload 为最终交付物，投递即完成）");
			continue;
		}
		const position = positionOf(definition, edge.to);
		if (position === void 0) continue;
		const labels = (edge.types ? edge.types : position.taskTypes.map((taskType) => taskType.id)).map((type) => `${type}（${taskTypeLabel(definition, type)}）`).join("、");
		lines.push(`- ${position.id}（${position.label}）: ${labels}`);
	}
	return lines;
}
/**
* 组装一个 agent 任务的完整 prompt。
*
* @param input 任务、定义与依赖信息
* @returns prompt 文本
*/
function buildExecutionPrompt(input) {
	const { job, task, position, taskType } = input;
	const definition = job.definition;
	const payload = renderTaskPayload(task.payload, input.tasks);
	const dependencies = task.deps.map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId)).filter((candidate) => candidate !== void 0);
	const dependencyText = dependencies.length === 0 ? "（无依赖任务）" : dependencies.map((dependency) => summarizeTaskResult(dependency, definition)).join("\n");
	const attachments = visibleAttachmentsForTask(input.tasks, task.id, input.attachments);
	const attachmentLines = attachments.length === 0 ? "（依赖任务没有可见附件）" : attachments.map((attachment) => `- ${attachment.id} · ${attachment.name} (${attachment.bytes} bytes${attachment.mime === "" ? "" : `, ${attachment.mime}`})${attachment.description === "" ? "" : ` · ${attachment.description}`}`).join("\n");
	const successors = successorLines(definition, position.id);
	return [
		`你正在执行工作流${`作业 #${job.seq}「${job.workflowName}」 · task ${task.id}`}。`,
		"",
		"## 岗位",
		`- ${position.label}（${position.id}）${position.description === void 0 ? "" : `：${position.description}`}`,
		"",
		"## 任务类型",
		`- ${taskType.label}（${taskType.id}）${taskType.description === void 0 ? "" : `：${taskType.description}`}`,
		"",
		"## 任务 payload",
		"```json",
		JSON.stringify(payload, null, 2),
		"```",
		"",
		"## 依赖任务结果",
		dependencyText,
		"",
		"## 可见附件",
		attachmentLines,
		input.workspace === void 0 ? "" : `附件源文件路径相对你的工作目录：${input.workspace}`,
		"",
		"## 产出契约",
		"完成后必须调用 `buka_task_complete` 提交结果：",
		"- `output`：一个 JSON 对象，匹配下面的 schema；",
		"- `text`：可选，一段给人看的文本摘要；",
		"- `attachments`：可选，需要归档的独立文件清单（`{ path, name?, description? }`，path 相对你的工作目录）；附件不是答案本身。",
		"```json",
		schemaJson(taskType.output),
		"```",
		"",
		"## 你可以派发的任务",
		"执行期间可以随时调用 `buka_task_create` 往本作业看板创建任务（可多次），参数：position、type、payload、deps。",
		"deps 只能引用本作业里已创建的任务 id（包括刚创建但未完成的任务）；依赖图不能成环。",
		...successors.length === 0 ? ["- （本岗位没有后继岗位）"] : successors,
		"",
		"## 只读工具",
		"`buka_job_board` 读取整个作业看板，`buka_task_get` 读取某个任务与依赖结果，`buka_job_attachments` 检索 / 读取可见附件。",
		taskType.mode === "plan" ? "本次任务以 plan 模式开始：先探索并提交计划，用户批准后继续实施。" : ""
	].filter((line) => line !== "").join("\n");
}
/**
* 开始任务的执行提示：把原始输入转换成第一个结构化输入。
*
* @param job 作业
* @returns prompt 文本
*/
function buildStartTaskPrompt(job) {
	const start = job.definition.start;
	return [
		`工作流「${job.workflowName}」的启动任务（作业 #${job.seq}）由你执行：把原始输入转换成第一个结构化输入，后续任务只读这份结构化输入。`,
		"",
		"## 原始输入",
		"```json",
		JSON.stringify(job.input.raw, null, 2),
		"```",
		"",
		"## 产出契约（启动任务）",
		"完成后调用 `buka_task_complete` 提交 `output`，它是一个 JSON 对象，匹配下面的 schema：",
		"```json",
		schemaJson(start.task.output),
		"```",
		job.definition.description === void 0 ? "" : `工作流说明：${job.definition.description}`
	].filter((line) => line !== "").join("\n");
}
/**
* 结束任务的投递文本：把最终交付物交给启动者。
*
* @param job 作业
* @param task 结束任务
* @returns 投递文本
*/
function buildEndDeliveryText(job, task) {
	return [
		`工作流「${job.workflowName}」的作业 #${job.seq} 已完成，最终交付物如下：`,
		"```json",
		JSON.stringify(task.payload, null, 2),
		"```"
	].join("\n");
}
/**
* 助理承办人任务的 prompt。
*
* @param input 任务与定义
* @returns prompt 文本
*/
function buildAssistantPrompt(input) {
	const { job, task, position, taskType } = input;
	const payload = renderTaskPayload(task.payload, input.tasks);
	const dependencies = task.deps.map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId)).filter((candidate) => candidate !== void 0);
	const dependencyText = dependencies.length === 0 ? "（无依赖任务）" : dependencies.map((dependency) => summarizeTaskResult(dependency, job.definition)).join("\n");
	return [
		`你被指派为工作流「${job.workflowName}」作业 #${job.seq} 的人任务助理。执行者是人：${position.label}（${position.id}）。`,
		"你的职责：代表这条任务与人沟通（按你自己的 skill 选择方式），拿到人给出的决定 / 结果后，调用 `buka_task_complete` 提交。",
		"你只能读取并完成这条任务，不能往工作流派任务。",
		"",
		"## 任务类型",
		`- ${taskType.label}（${taskType.id}）${taskType.description === void 0 ? "" : `：${taskType.description}`}`,
		"",
		"## 任务 payload",
		"```json",
		JSON.stringify(payload, null, 2),
		"```",
		"",
		"## 依赖任务结果",
		dependencyText,
		"",
		"## 产出契约",
		"完成后调用 `buka_task_complete`，`output` 必须是匹配下面 schema 的 JSON 对象：",
		"```json",
		schemaJson(taskType.output),
		"```",
		"如果人迟迟不回复或你无法完成，直接结束本轮即可：任务会回到待认领，由人自己处理。"
	].filter((line) => line !== "").join("\n");
}
// .build/workflows/engine/board.js
/**
* 页面 / 工具用的只读投影：任务摘要、任务详情、作业摘要、定义摘要与看板计数。
*
* 形状以 `.tmp/workflow-v4-api.md` 为准；`GET /job` 的 `definition` 带完整
* positions[].taskTypes，客户端不需要再拉工作流兜底。
*
* @module @buka/dsh-plugin-workflows/engine/board
*/
/** 摘要文本上限。 */
const SUMMARY_BYTES = 240;
/** 把打工人登记里的 driver / avatar 补到执行者上（只用于展示）。 */
function executorView(executor, workers) {
	if (executor.kind === "human" || workers === void 0) return executor;
	const worker = workers.get(executor.name);
	return {
		...executor,
		...worker === void 0 ? {} : { driver: worker.driver },
		...worker?.avatar === void 0 ? {} : { avatar: worker.avatar }
	};
}
/** 任务计数。 */
function countTasks(tasks) {
	const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
	for (const task of tasks) counts[task.status] += 1;
	return counts;
}
/**
* 任务摘要（看板 / 列表用）。
*
* @param task 任务
* @param definition 作业定义
* @returns 契约形状的任务摘要
*/
function taskSummary(task, definition) {
	return {
		id: task.id,
		position: task.position,
		type: task.type,
		typeLabel: taskTypeLabel(definition, task.type),
		status: task.status,
		deps: [...task.deps],
		createdAt: task.createdAt,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		claimant: task.claimant,
		attemptCount: task.attemptIds.length,
		attachmentCount: task.result?.attachmentIds.length ?? 0,
		resultSummary: task.result === null ? null : clipUtf8(task.result.text.trim(), SUMMARY_BYTES) || (task.result.output === null ? null : clipUtf8(JSON.stringify(task.result.output), SUMMARY_BYTES))
	};
}
/**
* 一次执行记录投影。
*
* @param attempt 执行记录
* @returns 契约形状
*/
function attemptSummary(attempt) {
	return {
		id: attempt.id,
		sessionId: attempt.sessionId,
		status: attempt.status,
		stopReason: attempt.stopReason,
		startedAt: attempt.startedAt,
		finishedAt: attempt.finishedAt,
		error: attempt.error
	};
}
/**
* 判断一条任务在当前作业状态下允许哪些操作。
*
* @param job 作业
* @param task 任务
* @returns `cancel | retry | claim | complete` 的子集
*/
function allowedTaskActions(job, task) {
	if (job.status !== "running") return [];
	switch (task.status) {
		case "pending": return ["cancel"];
		case "ready": return task.assignee.kind === "human" ? ["claim", "cancel"] : ["cancel"];
		case "running": return task.assignee.kind === "human" ? ["complete", "cancel"] : ["cancel"];
		case "failed": return ["retry", "cancel"];
		case "blocked": return ["cancel"];
		default: return [];
	}
}
/**
* 任务详情投影。
*
* @param input 作业、任务、执行记录与附件
* @returns 契约形状
*/
function taskDetail(input) {
	const { job, task } = input;
	const definition = job.definition;
	const taskType = findTaskType(definition, task.type);
	const dependencyTasks = task.deps.map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId)).filter((candidate) => candidate !== void 0);
	const attachments = input.attachments.filter((attachment) => task.result?.attachmentIds.includes(attachment.id));
	return {
		id: task.id,
		jobId: task.jobId,
		position: task.position,
		positionLabel: positionLabel(definition, task.position),
		type: task.type,
		typeLabel: taskTypeLabel(definition, task.type),
		typeDescription: taskType?.description ?? "",
		status: task.status,
		payload: task.payload,
		deps: dependencyTasks.map((dependency) => taskSummary(dependency, definition)),
		createdAt: task.createdAt,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		claimant: task.claimant,
		attempts: input.attempts.map(attemptSummary),
		result: task.result === null ? null : {
			text: task.result.text,
			output: task.result.output,
			attachments: attachments.map((attachment) => ({
				id: attachment.id,
				name: attachment.name,
				bytes: attachment.bytes,
				mime: attachment.mime,
				sha256: attachment.sha256,
				description: attachment.description,
				sourceTaskId: attachment.sourceTaskId,
				sourcePositionId: attachment.sourcePositionId,
				createdBy: attachment.createdBy,
				createdAt: attachment.createdAt
			}))
		},
		allowedActions: allowedTaskActions(job, task)
	};
}
/**
* 作业摘要（工作流详情里的作业列表）。
*
* @param job 作业
* @param tasks 作业任务
* @returns 契约形状
*/
function jobSummary(job, tasks) {
	return {
		id: job.id,
		seq: job.seq,
		status: job.status,
		inputSummary: job.inputSummary,
		taskCounts: countTasks(tasks),
		createdAt: job.createdAt,
		updatedAt: job.updatedAt
	};
}
/**
* 作业定义摘要：图 + 完整岗位 / 任务类型契约（客户端按钉住版本渲染表单）。
*
* @param definition 定义
* @returns 契约形状
*/
function jobDefinition(definition, workers) {
	return {
		name: definition.name,
		...definition.description === void 0 ? {} : { description: definition.description },
		positions: definition.positions.map((position) => ({
			id: position.id,
			label: position.label,
			...position.description === void 0 ? {} : { description: position.description },
			executor: executorView(position.executor, workers),
			taskTypes: position.taskTypes.map((taskType) => ({
				id: taskType.id,
				label: taskType.label,
				...taskType.description === void 0 ? {} : { description: taskType.description },
				payload: taskType.payload,
				output: taskType.output,
				...taskType.requires === void 0 ? {} : { requires: taskType.requires },
				...taskType.assistant === void 0 ? {} : { assistant: taskType.assistant },
				...taskType.mode === void 0 ? {} : { mode: taskType.mode }
			}))
		})),
		edges: definition.edges,
		start: { label: "开始" },
		end: { label: "结束" }
	};
}
/**
* 工作流详情里的图（positions / edges / start / end）。
*
* @param definition 定义
* @returns 契约形状
*/
function workflowGraph(definition, workers) {
	return {
		positions: jobDefinition(definition, workers).positions.map((position) => ({
			id: position.id,
			label: position.label,
			executor: position.executor
		})),
		edges: definition.edges.map((edge) => ({
			from: edge.from,
			to: edge.to,
			types: edge.types ?? [],
			back: edge.back === true
		})),
		start: { label: "开始" },
		end: { label: "结束" }
	};
}
/**
* 是否还存在待投递的结束任务（页面「重试交付」的判定条件）。
*
* @param tasks 作业任务
* @returns 有待投递结束任务时为 true
*/
function canRetryDelivery(tasks) {
	return tasks.some((task) => task.position === "end" && (task.status === "ready" || task.status === "failed"));
}
// .build/workflows/engine/events.js
/**
* 作业事件时间线：`<dataDir>/jobs/<jobId>/events.jsonl`。
*
* 只用于回看 / 排查，不是权威状态（权威状态在 storageDomain）。写失败只记日志，
* 绝不影响作业推进。
*
* @module @buka/dsh-plugin-workflows/engine/events
*/
/**
* 追加一条作业事件。
*
* @param store 存储（提供作业目录）
* @param logger 日志
* @param jobId 作业 id
* @param type 事件类型（`job/created`、`task/claimed` 等）
* @param data 事件数据
* @returns 无返回值
*/
async function appendJobEvent(store, logger, jobId, type, data) {
	try {
		const paths = await store.ensureJobDirectories(jobId);
		const line = `${JSON.stringify({
			at: nowIso(),
			type,
			data
		})}\n`;
		await promises.appendFile(paths.events, line, "utf8");
	} catch (error) {
		logger?.warn?.(`buka-workflows: could not append job event ${type}: ${describeError$1(error)}`);
	}
}
// .build/workflows/engine/session.js
/**
* 启动者会话投递与打工人句柄读取。
*
* 开始 / 结束任务的执行者是启动者。启动者可能是普通会话：插件通过宿主
* `sessionController.resolveAgent(sessionId)`（没有时退回 `agents.get`）拿到 live
* agent，构造一条用户消息 `followup` 进去，再用 `sessions.flush` 等持久化确认。
* 这与官方 `@deepseek-ai/dsh-schedule` 的提醒投递是同一机制。
*
* 消息形状按 DSH 的 `UserMessage` 结构构造（id / role / content / source）；
* 不 import `@deepseek-ai/dsh-llm`，避免插件多一个运行时依赖。
*
* @module @buka/dsh-plugin-workflows/engine/session
*/
/**
* 构造一条用户消息。
*
* @param text 消息正文
* @returns UserMessage 形状的对象
*/
function createUserMessage(text) {
	return {
		id: randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: { kind: "user" }
	};
}
/**
* 取一个会话的 live agent：先问 web 的 sessionController（会 resume），
* 再退回 agents 注册表里的 live 实例。
*
* @param ctx 插件上下文
* @param sessionId 会话 id
* @returns live agent
* @throws 该组成里无法恢复会话时抛出
*/
async function resolveLiveAgent(ctx, sessionId) {
	const controller = ctx.get("sessionController");
	if (controller !== void 0 && controller !== null && typeof controller.resolveAgent === "function") {
		const resolved = await controller.resolveAgent(sessionId);
		if (resolved !== void 0 && resolved !== null) {
			if ("error" in resolved && resolved.error !== void 0) throw new Error(`cannot resume starter session "${sessionId}": ${describeError$1(resolved.error)}`);
			if (resolved.agent !== void 0) return resolved.agent;
		}
	}
	const live = ctx.get("agents")?.get?.(sessionId);
	if (live !== void 0) return live;
	throw new Error(`cannot resume starter session "${sessionId}" in this composition (no live agent and no sessionController)`);
}
/**
* 宿主会话投递实现。
*
* @param ctx 插件上下文
* @returns 投递器
*/
function createHostSessionDelivery(ctx) {
	return { async deliver(sessionId, text) {
		const agent = await resolveLiveAgent(ctx, sessionId);
		const sessions = ctx.get("sessions");
		const before = sessions?.get?.(sessionId);
		const startSeq = typeof before?.seq === "number" ? before.seq : null;
		if (typeof agent.followup !== "function") throw new Error(`starter session "${sessionId}" cannot accept a follow-up message`);
		agent.followup(createUserMessage(text));
		if (typeof sessions?.flush === "function" && agent.session !== void 0) try {
			await sessions.flush(agent.session);
		} catch {}
		return startSeq;
	} };
}
/**
* 读一次打工人句柄的观测结果。
*
* @param handle workers 句柄
* @param sinceSeq 起点 seq
* @returns 本轮快照
*/
function readHandleResult(handle, sinceSeq) {
	let raw;
	if (typeof handle.readResult === "function") {
		const value = handle.readResult({ sinceSeq });
		if (value !== null && typeof value === "object" && !Array.isArray(value)) raw = value;
	}
	return {
		text: typeof raw?.text === "string" ? raw.text : "",
		stopReason: typeof raw?.stopReason === "string" ? raw.stopReason : null,
		turnEnded: raw?.turnEnded === true,
		startSeq: typeof raw?.startSeq === "number" && Number.isInteger(raw.startSeq) ? raw.startSeq : null
	};
}
/**
* 读句柄的起点 seq。
*
* @param handle workers 句柄
* @returns 起点 seq；未知时是 null
*/
function handleStartSeq(handle) {
	return typeof handle.startSeq === "number" && Number.isInteger(handle.startSeq) ? handle.startSeq : null;
}
/**
* 读句柄的会话 id。
*
* @param handle workers 句柄
* @returns 会话 id；未知时是 null
*/
function handleSessionId(handle) {
	return typeof handle.sessionId === "string" && handle.sessionId !== "" ? handle.sessionId : null;
}
/**
* 等待一段会话轮次观测的定时器；返回取消函数。
*
* @param intervalMs 轮询间隔
* @param check 每次轮询的回调；返回 true 时停止
* @returns 取消函数
*/
function poll(intervalMs, check) {
	let stopped = false;
	let timer = null;
	const tick = async () => {
		if (stopped) return;
		let done = false;
		try {
			done = await check();
		} catch {
			done = true;
		}
		if (stopped || done) return;
		timer = setTimeout(tick, intervalMs);
		timer.unref?.();
	};
	timer = setTimeout(tick, intervalMs);
	timer.unref?.();
	return () => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
	};
}
// .build/workflows/engine/tasks.js
/**
* 任务创建校验与记录构造（`.tmp/workflow-v4-spec.md` §7.3 / §7.4）。
*
* 创建任务的入口只有两个：引擎按 `start.next` 生成初始任务；执行中的任务通过
* `buka_task_create` 派生任务。这里实现两条路径共享的纯校验：
*
* 1. 目标岗位是创建者岗位的直接后继（边存在；`start` / `end` 同理）；
* 2. 任务类型是目标岗位声明的类型（结束任务用 `end.task`）；
* 3. 边写了类型白名单时，类型在白名单里；
* 4. payload 符合类型 schema，模板只引用已存在的数据路径；
* 5. 依赖 id 属于本作业、已存在、不是自己、依赖图不成环；`requires` 满足；
* 6. 作业预算未超。
*
* @module @buka/dsh-plugin-workflows/engine/tasks
*/
/**
* 解析岗位执行者，构造任务记录里钉住的执行者。
*
* @param definition 定义
* @param positionId 岗位 id
* @param job 作业
* @param workers 打工人登记表
* @returns 钉住的执行者
*/
function resolveExecutor(definition, positionId, job, workers) {
	if (positionId === "start" || positionId === "end") return job.starter.kind === "human" ? { kind: "human" } : {
		kind: "session",
		sessionId: job.starter.sessionId
	};
	const position = findPosition(definition, positionId);
	if (position === void 0) throw new WorkflowError("unknown-position", `unknown position "${positionId}"`);
	if (position.executor.kind === "human") return { kind: "human" };
	const worker = workers.get(position.executor.name);
	if (worker === void 0) throw new WorkflowError("unknown-worker", `position "${positionId}" uses worker "${position.executor.name}", which is not registered`);
	return {
		kind: "worker",
		name: worker.name,
		driver: worker.driver,
		...worker.program === void 0 ? {} : { program: worker.program },
		...worker.avatar === void 0 ? {} : { avatar: worker.avatar }
	};
}
/**
* 校验模板引用：只允许 start.output 与已存在任务的 output / text。
*
* @param payload payload
* @param tasks 作业里已创建的任务
* @param definition 定义
* @param startOutputSchema 启动任务 output schema
* @returns 错误消息列表
*/
function templateReferenceIssues(payload, tasks, definition, startOutputSchema) {
	const issues = [];
	const byId = new Map(tasks.map((task) => [task.id, task]));
	for (const reference of inspectPayload(payload).references) {
		const parsed = reference.reference;
		if (parsed === null) {
			issues.push(`template "{{${reference.path}}}" must be start.output, task.<id>.output or task.<id>.text`);
			continue;
		}
		if (parsed.kind === "start") {
			const reason = resolveOutputPath(startOutputSchema, parsed.segments);
			if (reason !== null) issues.push(`template "{{${reference.path}}}" ${reason}`);
			continue;
		}
		const task = byId.get(parsed.taskId);
		if (task === void 0) {
			issues.push(`template "{{${reference.path}}}" references task "${parsed.taskId}", which does not exist in this job`);
			continue;
		}
		if (parsed.field === "text") continue;
		const type = findTaskType(definition, task.type);
		if (type === void 0) continue;
		const reason = resolveOutputPath(type.output, parsed.segments);
		if (reason !== null) issues.push(`template "{{${reference.path}}}" ${reason}`);
	}
	return issues;
}
/**
* 判断一个任务在加入新依赖后依赖图是否成环。
*
* 新任务的依赖只能指向已创建任务，所以只需检查已有任务的依赖闭包；但如果已有
* 数据被外部改坏，仍在创建时报错而不是拖到调度。
*
* @param tasks 已有任务
* @returns 依赖图里的环（任务 id）；无环时是 null
*/
function findDependencyCycle(tasks) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const visiting = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	let cycle = null;
	const visit = (taskId, path) => {
		if (visiting.has(taskId)) {
			cycle = [...path.slice(path.indexOf(taskId)), taskId];
			return true;
		}
		if (visited.has(taskId)) return false;
		visiting.add(taskId);
		const task = byId.get(taskId);
		for (const dependency of task?.deps ?? []) if (byId.has(dependency) && visit(dependency, [...path, taskId])) return true;
		visiting.delete(taskId);
		visited.add(taskId);
		return false;
	};
	for (const task of tasks) if (visit(task.id, [])) break;
	return cycle;
}
/**
* 校验并构造一条派生任务。
*
* @param input 创建者、目标岗位、类型、payload 与依赖
* @returns 新任务记录与初始状态
* @throws `WorkflowError`（code 稳定）表示创建被拒绝
*/
function buildCreatedTask(input) {
	const { job, creator, position, type, payload, deps, tasks, workers } = input;
	const definition = job.definition;
	if (job.status !== "running") throw new WorkflowError("job-not-running", `job ${job.id} is not running`);
	if (creator.status !== "running") throw new WorkflowError("creator-not-running", `task ${creator.id} is not running; only an executing task can create tasks`);
	if (position === "start") throw new WorkflowError("invalid-target", "tasks cannot be dispatched to the built-in start node");
	const edge = findEdge(definition, creator.position, position);
	if (edge === void 0) throw new WorkflowError("no-edge", `no edge "${creator.position} -> ${position}": the executing position cannot dispatch this target`);
	const taskType = resolveTargetTaskType(definition, position, type);
	if (!edgeAllowsType(edge, taskType.id)) throw new WorkflowError("type-not-allowed", `edge "${creator.position} -> ${position}" does not allow task type "${taskType.id}"`);
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new WorkflowError("invalid-payload", "payload must be a JSON object");
	const schemaIssues = templatedPayloadIssues(taskType.payload, payload);
	if (schemaIssues.length > 0) throw new WorkflowError("invalid-payload", `payload does not match task type "${taskType.id}": ${schemaIssues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
	const startType = definition.start.task.output;
	const templateIssues = templateReferenceIssues(payload, tasks, definition, startType);
	if (templateIssues.length > 0) throw new WorkflowError("invalid-template", templateIssues.join("; "));
	const taskId = newTaskId();
	const dependencyIds = [];
	for (const dependency of deps) {
		if (typeof dependency !== "string" || dependency.trim() === "") throw new WorkflowError("invalid-dependency", "deps must be non-empty task ids");
		if (dependency === taskId) throw new WorkflowError("invalid-dependency", "a task cannot depend on itself");
		if (dependencyIds.includes(dependency)) throw new WorkflowError("invalid-dependency", `duplicate dependency "${dependency}"`);
		if (tasks.find((task) => task.id === dependency) === void 0) throw new WorkflowError("unknown-dependency", `dependency "${dependency}" does not exist in this job (no future references)`);
		dependencyIds.push(dependency);
	}
	if (findDependencyCycle(tasks) !== null) throw new WorkflowError("dependency-cycle", "the job task dependency graph already contains a cycle");
	for (const requirement of taskType.requires ?? []) if (!tasks.some((task) => dependencyIds.includes(task.id) && requirement.types.includes(task.type))) throw new WorkflowError("requires-not-met", `task type "${taskType.id}" requires a dependency of type: ${requirement.types.join(" | ")}`);
	const budget = definition.budgets.maxTasks;
	if (tasks.length + 1 > budget) throw new WorkflowError("budget-exceeded", `workflow budget maxTasks=${budget} would be exceeded (job ${job.id} already has ${tasks.length} tasks)`);
	const now = nowIso();
	const ready = dependencyIds.every((dependency) => tasks.find((task) => task.id === dependency)?.status === "completed");
	return {
		task: {
			id: taskId,
			jobId: job.id,
			position,
			type: taskType.id,
			payload,
			deps: dependencyIds,
			status: ready ? "ready" : "pending",
			createdBy: {
				taskId: creator.id,
				position: creator.position
			},
			assignee: resolveExecutor(definition, position, job, workers),
			claimant: null,
			attemptIds: [],
			result: null,
			error: null,
			assistantBlocked: false,
			createdAt: now,
			startedAt: null,
			finishedAt: null,
			updatedAt: now
		},
		ready
	};
}
/**
* 解析目标任务类型；`end` 用内建契约，既不是岗位类型也不存在。
*
* @param definition 定义
* @param position 目标岗位
* @param type 请求的类型 id
* @returns 任务类型（end 返回合成契约）
*/
function resolveTargetTaskType(definition, position, type) {
	if (position === "end") {
		if (type !== "end" && type !== "") throw new WorkflowError("invalid-type", `end tasks use the built-in end contract; "type" must be "end" (got "${type}")`);
		return {
			id: "end",
			label: "结束任务",
			description: "把最终交付物交给启动者，投递即完成。",
			payload: definition.end.task.payload,
			output: { type: "object" }
		};
	}
	const taskType = findTaskType(definition, type);
	const positionDef = definition.positions.find((candidate) => candidate.id === position);
	if (taskType === void 0 || positionDef?.taskTypes.every((candidate) => candidate.id !== type)) throw new WorkflowError("invalid-type", `"${type}" is not a task type of position "${position}"`);
	return taskType;
}
/**
* 生成 `start.next` 发布的初始任务。
*
* 启动任务已完成：结构化输入是它们的唯一依赖（定义里的 `$start`，落盘为
* `START_TASK_ID`），所以初始状态都是 `ready`（本版不允许依赖别的初始任务）。
*
* @param input 作业、启动任务、模板、已有任务与打工人表
* @returns 新任务记录
*/
function buildInitialTasks(input) {
	const { job, startTask, workers } = input;
	const definition = job.definition;
	const tasks = [...input.tasks];
	const created = [];
	for (const [index, route] of definition.start.next.entries()) {
		if (tasks.length + 1 > definition.budgets.maxTasks) throw new WorkflowError("budget-exceeded", `workflow budget maxTasks=${definition.budgets.maxTasks} would be exceeded by initial task ${index}`);
		const task = buildInitialTask({
			job,
			route,
			startTask,
			tasks,
			workers,
			definition
		});
		tasks.push(task);
		created.push(task);
	}
	return created;
}
/** 构造单条初始任务。 */
function buildInitialTask(input) {
	const { job, route, startTask, tasks, workers, definition } = input;
	if (findPosition(definition, route.position) === void 0) throw new WorkflowError("unknown-position", `start.next targets unknown position "${route.position}"`);
	const taskType = resolveTargetTaskType(definition, route.position, route.type);
	const edge = findEdge(definition, "start", route.position);
	if (edge === void 0 || !edgeAllowsType(edge, taskType.id)) throw new WorkflowError("no-edge", `start.next dispatches to "${route.position}" but no edge allows task type "${taskType.id}"`);
	const templateIssues = templateReferenceIssues(route.payload, tasks, definition, definition.start.task.output);
	if (templateIssues.length > 0) throw new WorkflowError("invalid-template", templateIssues.join("; "));
	const now = nowIso();
	return {
		id: newTaskId(),
		jobId: job.id,
		position: route.position,
		type: taskType.id,
		payload: route.payload,
		deps: [START_TASK_ID],
		status: "ready",
		createdBy: {
			taskId: startTask.id,
			position: "start"
		},
		assignee: resolveExecutor(definition, route.position, job, workers),
		claimant: null,
		attemptIds: [],
		result: null,
		error: null,
		assistantBlocked: false,
		createdAt: now,
		startedAt: null,
		finishedAt: null,
		updatedAt: now
	};
}
// .build/workflows/engine/engine.js
/**
* 工作流引擎：作业创建、调度、执行、派发校验、结算、取消、重试与恢复。
*
* 设计要点（`.tmp/workflow-v4-spec.md` §6-§12、ADR 0006-0012）：
*
* - 任务是唯一执行单元；任务依赖纯显式，依赖图无环；
* - 一个智能体岗位一次只跑一条任务（FIFO），机器人直接完成，
*   人任务由被点名的助理承办或停在「待认领」；
* - 记状态变更全部串行化到 per-job 队列；长等待的会话 / 定时器在队列外执行，
*   完成时再回队列提交状态；
* - 一个任务一条新会话，不复用、不压缩；重启时只续接同一条会话。
*
* @module @buka/dsh-plugin-workflows/engine
*/
/** 任务结果文本在记录里的预览上限。 */
const RESULT_PREVIEW_BYTES = 4096;
/** 打工人登记表缓存时间。 */
const WORKER_CACHE_MS = 5e3;
/** 从 workers 服务读登记表，转成本插件关心的形状。 */
function parseWorkerCatalog(raw) {
	const catalog = /* @__PURE__ */ new Map();
	const entries = Array.isArray(raw) ? raw : raw !== null && typeof raw === "object" && Array.isArray(raw.workers) ? raw.workers ?? [] : [];
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") continue;
		const record = entry;
		const name = typeof record.name === "string" ? record.name.trim() : "";
		if (name === "") continue;
		const driver = record.driver === "robot" || record.driver === "program" ? "robot" : "agent";
		catalog.set(name, {
			name,
			driver,
			...typeof record.program === "string" && record.program !== "" ? { program: record.program } : {},
			assistant: record.assistant === true,
			...typeof record.description === "string" ? { description: record.description } : {},
			...typeof record.avatar === "string" ? { avatar: record.avatar } : {},
			...typeof record.path === "string" && record.path !== "" ? { path: record.path } : {}
		});
	}
	return catalog;
}
/** 一句话输入摘要。 */
function summarizeInput(input) {
	if (input !== null && typeof input === "object" && !Array.isArray(input)) {
		const request = input.request;
		if (typeof request === "string" && request.trim() !== "") return clipUtf8(request.trim(), 240);
	}
	return clipUtf8(JSON.stringify(input), 240);
}
/** 引擎。 */
var WorkflowEngine = class {
	store;
	options;
	logger;
	workersOf;
	delivery;
	active = /* @__PURE__ */ new Map();
	sessionTasks = /* @__PURE__ */ new Map();
	busyAssistants = /* @__PURE__ */ new Set();
	deliveryBlocked = /* @__PURE__ */ new Set();
	catalog = /* @__PURE__ */ new Map();
	catalogAt = 0;
	started = false;
	disposed = false;
	constructor(deps) {
		this.store = deps.store;
		this.options = deps.options;
		this.logger = deps.logger;
		this.workersOf = deps.workers;
		this.delivery = deps.delivery;
	}
	/** 启动引擎：刷新打工人登记表并恢复未完成的作业。 */
	async start() {
		if (this.started || this.disposed) return;
		this.started = true;
		await this.refreshWorkers(true);
		await this.recover();
	}
	/** 停掉所有等待中的执行与定时器。 */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const execution of this.active.values()) {
			execution.stopPoll?.();
			if (execution.timeout !== null) clearTimeout(execution.timeout);
			execution.controller.abort();
			try {
				if (execution.handle !== null && typeof execution.handle.cancel === "function") execution.handle.cancel("host is shutting down");
			} catch {}
			this.disposeHandle(execution.handle);
		}
		this.active.clear();
		this.sessionTasks.clear();
	}
	/** 释放一个 workers 句柄。 */
	disposeHandle(handle) {
		if (handle === null) return;
		try {
			if (typeof handle.dispose === "function") handle.dispose();
		} catch {}
	}
	/**
	* 刷新打工人登记表（默认 5s 缓存）。
	*
	* 空表不缓存：workers 插件可能晚于本插件注册服务，缓存空表会让定义图 / 作业页
	* 一直拿不到头像，直到某个写操作恰好触发下一次刷新。
	*/
	async refreshWorkers(force = false) {
		if (!force && this.catalog.size > 0 && Date.now() - this.catalogAt < WORKER_CACHE_MS) return this.catalog;
		const workers = this.workersOf();
		if (workers === null) {
			this.catalog = /* @__PURE__ */ new Map();
			this.catalogAt = Date.now();
			return this.catalog;
		}
		try {
			const listed = typeof workers.list === "function" ? await workers.list() : void 0;
			this.catalog = parseWorkerCatalog(listed ?? workers);
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not read the workers registry: ${describeError$1(error)}`);
			this.catalog = /* @__PURE__ */ new Map();
		}
		this.catalogAt = Date.now();
		return this.catalog;
	}
	/** 取打工人登记表（按名字）。 */
	async workers() {
		return await this.refreshWorkers();
	}
	/**
	* 校验并保存工作流定义：没有 id 时新建（默认启用），有 id 时追加一个版本。
	*
	* @param input 定义与可选工作流 id
	* @returns 保存后的工作流记录
	*/
	async saveWorkflow(input) {
		const workers = await this.workers();
		const validated = validateWorkflowDefinition(input.definition, { workers });
		if (!validated.ok) throw new WorkflowError("invalid-definition", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
		const definition = validated.definition;
		if (input.workflowId !== void 0 && input.workflowId !== "") {
			if (this.store.getWorkflow(input.workflowId) === void 0) throw new WorkflowError("not-found", `workflow not found: ${input.workflowId}`);
			return await this.store.saveWorkflowVersion(input.workflowId, definition);
		}
		return await this.store.createWorkflow({
			name: definition.name,
			description: definition.description ?? "",
			definition,
			status: "active"
		});
	}
	/**
	* 工作流列表投影。
	*
	* @returns 工作流摘要
	*/
	listWorkflowSummaries() {
		return this.store.listWorkflows().map((workflow) => {
			return {
				id: workflow.id,
				name: workflow.name,
				description: workflow.description,
				version: workflow.latestVersion,
				status: workflow.status,
				jobCount: this.store.countJobs(workflow.id),
				updatedAt: workflow.updatedAt
			};
		});
	}
	/**
	* 读工作流详情（含某个版本的完整定义）。
	*
	* 展示投影要在读取时刷新打工人登记表：图上岗位头像来自 workers 服务，而服务
	* 可能晚于本插件就绪。
	*
	* @param workflowId 工作流 id
	* @param version 版本；省略取最新
	* @returns 工作流详情；不存在时 null
	*/
	async readWorkflowDetail(workflowId, version) {
		const found = this.store.readWorkflowVersion(workflowId, version);
		if (found === null) return null;
		const workers = await this.workers();
		const jobs = this.store.listJobs(workflowId).map((job) => jobSummary(job, this.store.listTasks(job.id)));
		return {
			workflow: {
				id: found.record.id,
				name: found.versionRecord.definition.name,
				description: found.versionRecord.definition.description ?? "",
				version: found.version,
				status: found.record.status,
				definition: found.versionRecord.definition
			},
			graph: workflowGraph(found.versionRecord.definition, workers),
			jobs
		};
	}
	/**
	* 停用 / 重新启用工作流。
	*
	* @param workflowId 工作流 id
	* @param active 是否可用
	* @returns 更新后的记录
	*/
	async setWorkflowActive(workflowId, active) {
		if (this.store.getWorkflow(workflowId) === void 0) throw new WorkflowError("not-found", `workflow not found: ${workflowId}`);
		return await this.store.activateWorkflow(workflowId, active);
	}
	/**
	* 页面人启动作业：原始输入与结构化输入一起提交，启动任务即刻完成。
	*
	* @param input 工作流、原始输入与结构化输入
	* @returns 新作业
	*/
	async createJobFromHuman(input) {
		const { workflow, definition } = this.requireStartableWorkflow(input.workflowId);
		const workers = await this.workers();
		const inputProblems = schemaProblems(definition.start.task.payload, input.rawInput);
		if (inputProblems.length > 0) throw new WorkflowError("invalid-input", `raw input: ${inputProblems.join("; ")}`);
		const structuredProblems = schemaProblems(definition.start.task.output, input.structuredInput);
		if (structuredProblems.length > 0) throw new WorkflowError("invalid-input", `structured input: ${structuredProblems.join("; ")}`);
		const job = await this.insertJob({
			workflow,
			definition,
			starter: { kind: "human" },
			rawInput: input.rawInput,
			structuredInput: input.structuredInput
		});
		try {
			await this.store.runExclusive(job.id, async () => {
				const now = nowIso();
				const startTask = {
					id: START_TASK_ID,
					jobId: job.id,
					position: "start",
					type: "start",
					payload: input.rawInput,
					deps: [],
					status: "completed",
					createdBy: null,
					assignee: { kind: "human" },
					claimant: {
						kind: "human",
						name: "本地用户",
						sessionId: null
					},
					attemptIds: [],
					result: {
						output: input.structuredInput,
						text: "",
						textBytes: 0,
						textFile: null,
						attachmentIds: []
					},
					error: null,
					assistantBlocked: false,
					createdAt: now,
					startedAt: now,
					finishedAt: now,
					updatedAt: now
				};
				await this.store.insertTask(startTask);
				await this.appendEvent(job.id, "job/created", {
					seq: job.seq,
					starter: "human"
				});
				await this.appendEvent(job.id, "task/completed", {
					taskId: startTask.id,
					type: "start"
				});
				const initial = buildInitialTasks({
					job,
					startTask,
					tasks: [startTask],
					workers
				});
				for (const task of initial) {
					await this.store.insertTask(task);
					await this.appendEvent(job.id, "task/created", {
						taskId: task.id,
						position: task.position,
						type: task.type,
						deps: task.deps
					});
				}
				await this.recomputeLocked(job.id);
			});
		} catch (error) {
			await this.store.updateJob(job.id, (current) => ({
				...current,
				status: "failed",
				error: describeError$1(error),
				finishedAt: nowIso(),
				updatedAt: nowIso()
			})).catch(() => void 0);
			throw error;
		}
		return this.store.getJob(job.id) ?? job;
	}
	/**
	* 会话启动作业：启动任务回到启动者会话执行（下一轮 agent 提交结构化输入）。
	*
	* @param input 工作流、原始输入与启动者会话
	* @returns 新作业
	*/
	async createJobFromSession(input) {
		const { workflow, definition } = this.requireStartableWorkflow(input.workflowId);
		const inputProblems = schemaProblems(definition.start.task.payload, input.rawInput);
		if (inputProblems.length > 0) throw new WorkflowError("invalid-input", `raw input: ${inputProblems.join("; ")}`);
		const job = await this.insertJob({
			workflow,
			definition,
			starter: {
				kind: "session",
				sessionId: input.sessionId
			},
			rawInput: input.rawInput
		});
		await this.store.runExclusive(job.id, async () => {
			const now = nowIso();
			const startTask = {
				id: START_TASK_ID,
				jobId: job.id,
				position: "start",
				type: "start",
				payload: input.rawInput,
				deps: [],
				status: "pending",
				createdBy: null,
				assignee: {
					kind: "session",
					sessionId: input.sessionId
				},
				claimant: null,
				attemptIds: [],
				result: null,
				error: null,
				assistantBlocked: false,
				createdAt: now,
				startedAt: null,
				finishedAt: null,
				updatedAt: now
			};
			await this.store.insertTask(startTask);
			await this.appendEvent(job.id, "job/created", {
				seq: job.seq,
				starter: "session"
			});
			await this.recomputeLocked(job.id);
		});
		return this.store.getJob(job.id) ?? job;
	}
	/** 取一个可启动的工作流：必须存在且未停用。 */
	requireStartableWorkflow(workflowId) {
		const found = this.store.readWorkflowVersion(workflowId);
		if (found === null) throw new WorkflowError("not-found", `workflow not found: ${workflowId}`);
		if (found.record.status !== "active") throw new WorkflowError("workflow-retired", `workflow "${found.record.name}" is not enabled; enable it before starting a job`);
		return {
			workflow: found.record,
			definition: found.versionRecord.definition
		};
	}
	/** 插入作业记录。 */
	async insertJob(input) {
		const seq = await this.store.allocateJobSeq(input.workflow.id);
		const now = nowIso();
		const version = this.store.readWorkflowVersion(input.workflow.id)?.version ?? input.workflow.latestVersion;
		const job = {
			id: newJobId(),
			seq,
			workflowId: input.workflow.id,
			workflowVersion: version,
			workflowName: input.definition.name,
			workflowDescription: input.definition.description ?? "",
			definition: input.definition,
			status: "running",
			starter: input.starter,
			input: {
				raw: input.rawInput,
				...input.structuredInput === void 0 ? {} : { structured: input.structuredInput }
			},
			inputSummary: summarizeInput(input.rawInput),
			error: null,
			createdAt: now,
			updatedAt: now,
			finishedAt: null
		};
		await this.store.ensureJobDirectories(job.id);
		await this.store.insertJob(job);
		return job;
	}
	/**
	* 作业详情（契约形状）。
	*
	* 与工作流详情一样，展示投影在读取时刷新打工人登记表，让岗位头像保持最新。
	*
	* @param jobId 作业 id
	* @returns 作业详情；不存在时 null
	*/
	async jobDetail(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0) return null;
		const workers = await this.workers();
		const tasks = this.store.listTasks(jobId);
		return {
			job: {
				id: job.id,
				seq: job.seq,
				status: job.status,
				workflowId: job.workflowId,
				workflowName: job.workflowName,
				workflowVersion: job.workflowVersion,
				starter: job.starter,
				input: job.input,
				createdAt: job.createdAt,
				updatedAt: job.updatedAt,
				error: job.error
			},
			definition: jobDefinition(job.definition, workers),
			tasks: tasks.map((task) => taskSummary(task, job.definition)),
			canRetryDelivery: canRetryDelivery(tasks)
		};
	}
	/**
	* 作业列表（某个工作流下）。
	*
	* @param workflowId 工作流 id
	* @returns 作业摘要
	*/
	listJobSummaries(workflowId) {
		return this.store.listJobs(workflowId).map((job) => jobSummary(job, this.store.listTasks(job.id)));
	}
	/**
	* 任务详情（契约形状）。
	*
	* @param jobId 作业 id
	* @param taskId 任务 id
	* @returns 任务详情；不存在时 null
	*/
	taskDetail(jobId, taskId) {
		const job = this.store.getJob(jobId);
		if (job === void 0) return null;
		const task = this.store.getTask(taskId);
		if (task === void 0 || task.jobId !== jobId) return null;
		return taskDetail({
			job,
			task,
			tasks: this.store.listTasks(jobId),
			attempts: this.store.listAttempts(taskId),
			attachments: this.store.listAttachments(jobId)
		});
	}
	/**
	* 作业附件库（页面展示全部附件与来源任务）。
	*
	* @param jobId 作业 id
	* @returns 附件元数据
	*/
	listJobAttachments(jobId) {
		return this.store.listAttachments(jobId);
	}
	/**
	* 取附件元数据（路由下载 / 预览用）。
	*
	* @param jobId 作业 id
	* @param attachmentId 附件 id
	* @returns 附件文件与元数据；不存在时 null
	*/
	openAttachment(jobId, attachmentId) {
		const record = this.store.getAttachment(attachmentId);
		if (record === void 0 || record.jobId !== jobId) return null;
		try {
			return {
				record,
				file: resolveAttachmentFile(this.store.paths(jobId).root, record.path)
			};
		} catch {
			return null;
		}
	}
	/**
	* 执行会话可见的附件检索结果。
	*
	* @param sessionId 会话 id
	* @param query 关键词
	* @returns 可见附件
	*/
	searchAttachmentsForSession(sessionId, query) {
		const reference = this.sessionTasks.get(sessionId);
		if (reference === void 0) return [];
		const visible = visibleTaskIds(this.store.listTasks(reference.jobId), reference.taskId);
		const attachments = this.store.listAttachments(reference.jobId);
		return searchAttachments(attachments, new Set(attachments.map((item) => item.id)), query).filter((attachment) => visible.has(attachment.sourceTaskId));
	}
	/**
	* 执行会话按 id 读取一个可见附件（元数据 + 有界文本）。
	*
	* @param sessionId 会话 id
	* @param attachmentId 附件 id
	* @returns 附件信息；不可见 / 不存在时 null
	*/
	async readAttachmentForSession(sessionId, attachmentId) {
		const reference = this.sessionTasks.get(sessionId);
		if (reference === void 0) return null;
		const visible = visibleTaskIds(this.store.listTasks(reference.jobId), reference.taskId);
		const record = this.store.getAttachment(attachmentId);
		if (record === void 0 || record.jobId !== reference.jobId) return null;
		if (!visible.has(record.sourceTaskId)) return null;
		const base = {
			id: record.id,
			name: record.name,
			bytes: record.bytes,
			mime: record.mime,
			description: record.description,
			sourceTaskId: record.sourceTaskId,
			sourcePositionId: record.sourcePositionId,
			createdAt: record.createdAt
		};
		try {
			const inline = await readInlineText(resolveAttachmentFile(this.store.paths(record.jobId).root, record.path), this.options.maxInlineAttachmentBytes);
			return {
				...base,
				...inline.available ? { text: inline.text } : { reason: inline.reason ?? "binary" }
			};
		} catch {
			return {
				...base,
				reason: "unreadable"
			};
		}
	}
	/**
	* 一个会话正在执行的任务（工具可见性 / 结果收口用）。
	*
	* @param sessionId 会话 id
	* @returns 作业与任务 id；没有时 null
	*/
	taskForSession(sessionId) {
		return this.sessionTasks.get(sessionId) ?? null;
	}
	/**
	* 某个会话作为启动者的作业 id（最近创建的优先）。
	*
	* @param sessionId 会话 id
	* @returns 作业 id；没有时 null
	*/
	jobIdForSession(sessionId) {
		let found = null;
		for (const job of this.store.allJobs()) {
			if (job.starter.kind !== "session" || job.starter.sessionId !== sessionId) continue;
			if (found === null || job.createdAt > found.createdAt) found = job;
		}
		return found?.id ?? null;
	}
	/**
	* 会话能否查看某个作业（启动者或执行中的任务会话）。
	*
	* @param sessionId 会话 id
	* @param jobId 作业 id
	* @returns 可以查看时为 true
	*/
	canViewJob(sessionId, jobId) {
		const reference = this.sessionTasks.get(sessionId);
		if (reference !== void 0) return reference.jobId === jobId;
		return this.jobIdForSession(sessionId) === jobId;
	}
	/**
	* 执行中的任务创建派生任务。
	*
	* @param input 会话、目标岗位、类型、payload 与依赖
	* @returns 新任务
	*/
	async createTaskFromSession(input) {
		const reference = this.sessionTasks.get(input.sessionId);
		if (reference === void 0) throw new WorkflowError("no-task", "this session is not executing a workflow task; only an executing task can create tasks");
		const workers = await this.workers();
		return await this.store.runExclusive(reference.jobId, async () => {
			const job = this.store.getJob(reference.jobId);
			if (job === void 0) throw new WorkflowError("not-found", "job not found");
			const tasks = this.store.listTasks(job.id);
			const creator = tasks.find((task) => task.id === reference.taskId);
			if (creator === void 0) throw new WorkflowError("not-found", "task not found");
			const created = buildCreatedTask({
				job,
				creator,
				position: input.position,
				type: input.type,
				payload: input.payload,
				deps: input.deps,
				tasks,
				workers
			});
			await this.store.insertTask(created.task);
			await this.appendEvent(job.id, "task/created", {
				taskId: created.task.id,
				position: created.task.position,
				type: created.task.type,
				deps: created.task.deps,
				createdBy: creator.id
			});
			await this.recomputeLocked(job.id);
			return this.store.getTask(created.task.id) ?? created.task;
		});
	}
	/**
	* 执行中的任务 / 助理提交结果。
	*
	* @param input 会话、结构化结果、文本与附件
	* @returns 任务与作业的最新状态
	*/
	async completeTaskFromSession(input) {
		const reference = this.sessionTasks.get(input.sessionId);
		if (reference === void 0) throw new WorkflowError("no-task", "this session is not executing a workflow task");
		return await this.store.runExclusive(reference.jobId, async () => {
			const job = this.store.getJob(reference.jobId);
			if (job === void 0) throw new WorkflowError("not-found", "job not found");
			const task = this.store.getTask(reference.taskId);
			if (task === void 0) throw new WorkflowError("not-found", "task not found");
			if (task.status !== "running") throw new WorkflowError("task-not-running", `task ${task.id} is ${task.status}; it cannot be completed again`);
			if (task.id === "start-task") {
				if (this.store.listTasks(job.id).length + job.definition.start.next.length + 1 > job.definition.budgets.maxTasks) throw new WorkflowError("budget-exceeded", `workflow budget maxTasks=${job.definition.budgets.maxTasks} would be exceeded by the initial tasks`);
			}
			const problems = this.outputProblemsFor(job, task, input.output);
			if (problems.length > 0) throw new WorkflowError("invalid-output", `output does not match the task contract: ${problems.join("; ")}`);
			const claimant = task.claimant;
			const workspace = this.workspaceFor(task);
			const updated = await this.completeTaskLocked(job, task, {
				output: input.output,
				text: input.text,
				attachments: input.attachments,
				workspace,
				createdBy: claimant?.name ?? "执行者"
			});
			this.sessionTasks.delete(input.sessionId);
			await this.recomputeLocked(job.id);
			return {
				task: updated,
				job: this.store.getJob(job.id) ?? job
			};
		});
	}
	/**
	* 页面：人认领一条待认领任务。
	*
	* @param jobId 作业 id
	* @param taskId 任务 id
	* @returns 更新后的任务
	*/
	async claimTaskAsHuman(jobId, taskId) {
		return await this.store.runExclusive(jobId, async () => {
			const job = this.requireRunningJob(jobId);
			const task = this.requireTask(jobId, taskId);
			if (task.assignee.kind !== "human") throw new WorkflowError("not-human-task", `task ${taskId} is not a human task`);
			if (task.status !== "ready") throw new WorkflowError("not-ready", `task ${taskId} is ${task.status}; only ready tasks can be claimed`);
			assertTaskTransition(taskId, task.status, "running");
			const now = nowIso();
			const attemptId = newAttemptId();
			const attempt = {
				id: attemptId,
				jobId,
				taskId,
				sessionId: null,
				startSeq: null,
				status: "running",
				stopReason: null,
				error: null,
				promptFile: null,
				startedAt: now,
				finishedAt: null
			};
			await this.store.insertAttempt(attempt);
			const updated = await this.store.updateTask(taskId, (current) => ({
				...current,
				status: "running",
				claimant: {
					kind: "human",
					name: "本地用户",
					sessionId: null
				},
				attemptIds: [...current.attemptIds, attemptId],
				startedAt: current.startedAt ?? now,
				updatedAt: now
			}));
			await this.appendEvent(jobId, "task/claimed", {
				taskId,
				claimant: "human"
			});
			await this.recomputeLocked(job.id);
			return updated;
		});
	}
	/**
	* 页面：人填表提交一条人任务。
	*
	* @param input 作业、任务、结构化结果、文本与附件
	* @returns 更新后的任务
	*/
	async completeTaskAsHuman(input) {
		return await this.store.runExclusive(input.jobId, async () => {
			const job = this.requireRunningJob(input.jobId);
			const task = this.requireTask(input.jobId, input.taskId);
			if (task.assignee.kind !== "human") throw new WorkflowError("not-human-task", `task ${input.taskId} is not a human task`);
			if (task.status !== "running" && task.status !== "ready") throw new WorkflowError("invalid-status", `task ${input.taskId} is ${task.status}; a human task can only be completed from ready/running`);
			let prepared = task;
			if (task.status === "ready") {
				const now = nowIso();
				const attempt = {
					id: newAttemptId(),
					jobId: job.id,
					taskId: task.id,
					sessionId: null,
					startSeq: null,
					status: "running",
					stopReason: null,
					error: null,
					promptFile: null,
					startedAt: now,
					finishedAt: null
				};
				await this.store.insertAttempt(attempt);
				prepared = await this.store.updateTask(task.id, (current) => ({
					...current,
					claimant: {
						kind: "human",
						name: "本地用户",
						sessionId: null
					},
					attemptIds: [...current.attemptIds, attempt.id],
					updatedAt: now
				}));
			}
			const problems = this.outputProblemsFor(job, prepared, input.output);
			if (problems.length > 0) throw new WorkflowError("invalid-output", `output does not match the task contract: ${problems.join("; ")}`);
			const updated = await this.completeTaskLocked(job, prepared, {
				output: input.output,
				text: input.text,
				attachments: input.attachments,
				workspace: void 0,
				createdBy: "本地用户"
			});
			await this.recomputeLocked(job.id);
			return updated;
		});
	}
	/**
	* 取消一条任务。
	*
	* @param jobId 作业 id
	* @param taskId 任务 id
	* @returns 更新后的任务
	*/
	async cancelTask(jobId, taskId) {
		return await this.store.runExclusive(jobId, async () => {
			const job = this.requireRunningJob(jobId, true);
			const task = this.requireTask(jobId, taskId);
			if (task.status === "completed" || task.status === "cancelled") throw new WorkflowError("invalid-status", `task ${taskId} is already ${task.status}`);
			assertTaskTransition(taskId, task.status, "cancelled");
			const now = nowIso();
			this.cancelActive(taskId, "task was cancelled");
			const updated = await this.store.updateTask(taskId, (current) => ({
				...current,
				status: "cancelled",
				finishedAt: now,
				updatedAt: now
			}));
			await this.closeRunningAttempts(taskId, "cancelled", "task was cancelled");
			this.dropSessionTask(taskId);
			await this.appendEvent(jobId, "task/cancelled", { taskId });
			await this.recomputeLocked(job.id);
			return updated;
		});
	}
	/**
	* 重试一条技术失败的任务：新增一次执行记录。
	*
	* @param jobId 作业 id
	* @param taskId 任务 id
	* @returns 更新后的任务
	*/
	async retryTask(jobId, taskId) {
		return await this.store.runExclusive(jobId, async () => {
			const job = this.requireRunningJob(jobId);
			const task = this.requireTask(jobId, taskId);
			if (task.status !== "failed") throw new WorkflowError("not-failed", `task ${taskId} is ${task.status}; only failed tasks can be retried`);
			assertTaskTransition(taskId, "failed", "ready");
			const updated = await this.store.updateTask(taskId, (current) => ({
				...current,
				status: "ready",
				error: null,
				claimant: null,
				assistantBlocked: false,
				finishedAt: null,
				updatedAt: nowIso()
			}));
			await this.appendEvent(jobId, "task/retried", { taskId });
			await this.recomputeLocked(job.id);
			return updated;
		});
	}
	/**
	* 取消作业：取消全部非终态任务。
	*
	* @param jobId 作业 id
	* @returns 更新后的作业
	*/
	async cancelJob(jobId) {
		return await this.store.runExclusive(jobId, async () => {
			const job = this.store.getJob(jobId);
			if (job === void 0) throw new WorkflowError("not-found", `job not found: ${jobId}`);
			if (isTerminalJobStatus(job.status)) return job;
			assertJobTransition(jobId, job.status, "cancelled");
			const now = nowIso();
			for (const task of this.store.listTasks(jobId)) {
				if (!isOpenTaskStatus(task.status)) continue;
				this.cancelActive(task.id, "job was cancelled");
				if (task.claimant?.kind === "assistant") this.busyAssistants.delete(task.claimant.name);
				await this.store.updateTask(task.id, (current) => ({
					...current,
					status: "cancelled",
					finishedAt: now,
					updatedAt: now
				}));
				await this.closeRunningAttempts(task.id, "cancelled", "job was cancelled");
				this.dropSessionTask(task.id);
			}
			const updated = await this.store.updateJob(jobId, (current) => ({
				...current,
				status: "cancelled",
				error: null,
				finishedAt: now,
				updatedAt: now
			}));
			await this.appendEvent(jobId, "job/cancelled", {});
			return updated;
		});
	}
	/**
	* 页面：重试结束任务投递。
	*
	* @param jobId 作业 id
	* @returns 更新后的作业
	*/
	async retryDelivery(jobId) {
		return await this.store.runExclusive(jobId, async () => {
			const job = this.requireRunningJob(jobId);
			const endTasks = this.store.listTasks(jobId).filter((task) => task.position === "end" && task.status === "ready");
			if (endTasks.length === 0) throw new WorkflowError("no-pending-delivery", "this job has no end task waiting for delivery");
			for (const task of endTasks) this.deliveryBlocked.delete(task.id);
			await this.appendEvent(jobId, "delivery/retry", { taskIds: endTasks.map((task) => task.id) });
			await this.recomputeLocked(job.id);
			return this.store.getJob(job.id) ?? job;
		});
	}
	/** 重启恢复：重建调度、续接 running 任务、补算 clock、重试交付。 */
	async recover() {
		const jobs = this.store.allJobs().filter((job) => job.status === "running");
		for (const job of jobs) try {
			await this.store.runExclusive(job.id, async () => {
				await this.recoverJobLocked(job.id);
			});
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not recover job ${job.id}: ${describeError$1(error)}`);
		}
	}
	/** 恢复一个作业：running 任务续接 / 失败，然后重新调度。 */
	async recoverJobLocked(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0 || job.status !== "running") return;
		for (const task of this.store.listTasks(jobId)) {
			if (task.status !== "running") continue;
			const attempt = this.store.listAttempts(task.id).find((entry) => entry.status === "running");
			if (attempt !== void 0) await this.store.updateAttempt(attempt.id, (current) => ({
				...current,
				status: "failed",
				error: "host restarted while this attempt was running",
				finishedAt: nowIso()
			}));
			if (task.position === "start") {
				if (job.starter.kind === "session" && attempt !== void 0) {
					this.resumeStartTask(job, task, attempt);
					continue;
				}
				await this.failTaskLocked(jobId, task.id, "host restarted before the start task finished");
				continue;
			}
			if (task.position === "end") continue;
			const executor = task.assignee;
			if (executor.kind === "worker" && executor.driver === "robot") {
				if (attempt !== void 0) this.launchProgram(jobId, task.id, attempt.id, executor.program ?? "");
				continue;
			}
			if (attempt === void 0) {
				await this.failTaskLocked(jobId, task.id, "host restarted and the execution attempt was lost");
				continue;
			}
			const sessionId = attempt.sessionId;
			if (sessionId === null || executor.kind !== "worker") {
				await this.failTaskLocked(jobId, task.id, "host restarted and the execution session was lost");
				continue;
			}
			if (!await this.resumeAgentAttempt(jobId, task, attempt, executor.name, sessionId)) {
				if (task.claimant?.kind === "assistant") await this.releaseAssistantLocked(jobId, task, "assistant session could not be resumed");
				else await this.failTaskLocked(jobId, task.id, "host restarted and the execution session could not be resumed");
			}
		}
		const tasks = this.store.listTasks(jobId);
		const startTask = tasks.find((task) => task.id === START_TASK_ID);
		if (startTask !== void 0 && startTask.status === "completed" && tasks.length === 1 && job.definition.start.next.length > 0) try {
			await this.spawnInitialTasksLocked(job, startTask);
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not rebuild initial tasks for job ${jobId}: ${describeError$1(error)}`);
		}
		await this.recomputeLocked(jobId);
	}
	/** 重新投递启动任务提示词。 */
	async resumeStartTask(job, task, attempt) {
		const starter = job.starter;
		if (starter.kind !== "session") return;
		try {
			const startSeq = await this.delivery.deliver(starter.sessionId, buildStartTaskPrompt(job));
			await this.store.runExclusive(job.id, async () => {
				await this.store.updateAttempt(attempt.id, (current) => ({
					...current,
					status: "running",
					error: null,
					finishedAt: null,
					sessionId: starter.sessionId,
					startSeq: startSeq ?? current.startSeq
				}));
				this.sessionTasks.set(starter.sessionId, {
					jobId: job.id,
					taskId: task.id
				});
			});
		} catch (error) {
			await this.store.runExclusive(job.id, async () => {
				await this.failTaskLocked(job.id, task.id, `could not resume the start task: ${describeError$1(error)}`);
				await this.recomputeLocked(job.id);
			});
		}
	}
	/** 续接一个 agent / 助理任务会话。 */
	async resumeAgentAttempt(jobId, task, attempt, worker, sessionId) {
		const workers = this.workersOf();
		if (workers === null || typeof workers.openSession !== "function") return false;
		let handle;
		try {
			handle = await workers.openSession({
				worker,
				sessionId
			});
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not resume session ${sessionId}: ${describeError$1(error)}`);
			return false;
		}
		const startSeq = handleStartSeq(handle) ?? attempt.startSeq ?? 0;
		await this.store.updateAttempt(attempt.id, (current) => ({
			...current,
			status: "running",
			error: null,
			finishedAt: null,
			startSeq
		}));
		this.sessionTasks.set(sessionId, {
			jobId,
			taskId: task.id
		});
		this.trackExecution({
			jobId,
			taskId: task.id,
			attemptId: attempt.id,
			kind: task.claimant?.kind === "assistant" ? "assistant" : "agent",
			sessionId,
			handle,
			startSeq,
			worker
		});
		return true;
	}
	/** 重算就绪、调度可执行任务、检查预算与结算。 */
	async recomputeLocked(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0 || job.status !== "running") return;
		if (this.overDurationBudget(job)) {
			await this.failJobForBudget(job);
			return;
		}
		const tasks = this.store.listTasks(jobId);
		const byId = new Map(tasks.map((task) => [task.id, task]));
		const now = nowIso();
		for (const task of tasks) {
			if (task.status !== "pending") continue;
			let blocked = false;
			let allCompleted = true;
			for (const dependency of task.deps) {
				const dep = byId.get(dependency);
				if (dep === void 0) continue;
				if (dep.status === "blocked" || dep.status === "cancelled") blocked = true;
				if (dep.status !== "completed") allCompleted = false;
			}
			if (blocked) {
				if (!canTransitionTask(task.status, "blocked")) continue;
				await this.store.updateTask(task.id, (current) => ({
					...current,
					status: "blocked",
					finishedAt: now,
					updatedAt: now
				}));
				await this.appendEvent(jobId, "task/blocked", { taskId: task.id });
				continue;
			}
			if (!allCompleted) continue;
			await this.store.updateTask(task.id, (current) => ({
				...current,
				status: "ready",
				updatedAt: now
			}));
			await this.appendEvent(jobId, "task/ready", { taskId: task.id });
		}
		const launches = await this.scheduleReadyLocked(jobId);
		await this.settleLocked(jobId);
		for (const launch of launches) this.launch(launch);
	}
	/** 生成可执行任务：结束任务投递、启动任务、agent / robot / 助理任务。 */
	async scheduleReadyLocked(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0 || job.status !== "running") return [];
		const tasks = this.store.listTasks(jobId);
		const ready = tasks.filter((task) => task.status === "ready");
		if (ready.length === 0) return [];
		const workers = await this.workers();
		const launches = [];
		const busyPositions = /* @__PURE__ */ new Set();
		for (const task of tasks) if (task.status === "running") busyPositions.add(task.position);
		const sorted = [...ready].sort((left, right) => left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt));
		for (const task of sorted) {
			if (task.position === "end") {
				if (this.deliveryBlocked.has(task.id)) continue;
				const launch = await this.claimForDelivery(job, task);
				if (launch !== null) launches.push(launch);
				continue;
			}
			if (task.position === "start") {
				if (job.starter.kind !== "session") continue;
				if (busyPositions.has("start")) continue;
				const launch = await this.claimStartTask(job, task);
				if (launch !== null) {
					busyPositions.add("start");
					launches.push(launch);
				}
				continue;
			}
			const executor = task.assignee;
			if (executor.kind === "human") {
				const assistantName = this.assistantFor(job.definition, task.type);
				if (assistantName === null || task.assistantBlocked) continue;
				if (this.busyAssistants.has(assistantName)) continue;
				const launch = await this.claimAssistantTask(job, task, assistantName, tasks);
				if (launch !== null) {
					this.busyAssistants.add(assistantName);
					launches.push(launch);
				}
				continue;
			}
			if (executor.kind !== "worker") continue;
			if (executor.driver === "robot") {
				const programId = executor.program ?? "";
				const launch = await this.claimProgramTask(job, task, programId);
				if (launch !== null) launches.push(launch);
				continue;
			}
			if (busyPositions.has(task.position)) continue;
			const launch = await this.claimAgentTask(job, task, tasks, workers);
			if (launch !== null) {
				busyPositions.add(task.position);
				launches.push(launch);
			}
		}
		return launches;
	}
	/** 取人任务类型点名的助理。 */
	assistantFor(definition, typeId) {
		for (const position of definition.positions) for (const taskType of position.taskTypes) if (taskType.id === typeId) return typeof taskType.assistant === "string" && taskType.assistant !== "" ? taskType.assistant : null;
		return null;
	}
	/** 为一次执行准备 attempt 记录。 */
	async createAttempt(input) {
		const attempt = {
			id: newAttemptId(),
			jobId: input.jobId,
			taskId: input.taskId,
			sessionId: null,
			startSeq: null,
			status: "running",
			stopReason: null,
			error: null,
			promptFile: input.promptFile,
			startedAt: nowIso(),
			finishedAt: null
		};
		await this.store.insertAttempt(attempt);
		return attempt;
	}
	/** 认领任务为 running（写 attempt id 与认领者）。 */
	async claimTaskRecord(job, task, claimant, attemptId) {
		assertTaskTransition(task.id, task.status, "running");
		const now = nowIso();
		const updated = await this.store.updateTask(task.id, (current) => ({
			...current,
			status: "running",
			claimant,
			attemptIds: [...current.attemptIds, attemptId],
			startedAt: current.startedAt ?? now,
			updatedAt: now
		}));
		await this.appendEvent(job.id, "task/claimed", {
			taskId: task.id,
			claimant: claimant.kind,
			name: claimant.name
		});
		return updated;
	}
	/** 认领 agent 任务并写 prompt。 */
	async claimAgentTask(job, task, tasks, workers) {
		const position = positionOf(job.definition, task.position);
		if (position === void 0 || position.executor.kind !== "worker") return null;
		const taskType = this.taskTypeOf(job.definition, task.type);
		if (taskType === void 0) {
			await this.failTaskLocked(job.id, task.id, `task type "${task.type}" is not declared in the workflow`);
			return null;
		}
		const prompt = buildExecutionPrompt({
			job,
			task,
			position,
			taskType,
			tasks,
			attachments: this.store.listAttachments(job.id),
			workspace: workers.get(position.executor.name)?.path
		});
		const attempt = await this.createAttempt({
			jobId: job.id,
			taskId: task.id,
			promptFile: null
		});
		const promptFile = await this.store.writeText(job.id, "prompts", attempt.id, prompt).catch(() => null);
		if (promptFile !== null) await this.store.updateAttempt(attempt.id, (current) => ({
			...current,
			promptFile
		}));
		await this.claimTaskRecord(job, task, {
			kind: "worker",
			name: position.executor.name,
			sessionId: null
		}, attempt.id);
		return {
			kind: "agent",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id,
			worker: position.executor.name,
			prompt,
			planMode: taskType.mode === "plan"
		};
	}
	/** 认领助理承办的人任务。 */
	async claimAssistantTask(job, task, assistantName, tasks) {
		const position = positionOf(job.definition, task.position);
		const taskType = this.taskTypeOf(job.definition, task.type);
		if (position === void 0 || taskType === void 0) return null;
		const prompt = buildAssistantPrompt({
			job,
			task,
			position,
			taskType,
			tasks,
			attachments: this.store.listAttachments(job.id),
			workspace: void 0
		});
		const attempt = await this.createAttempt({
			jobId: job.id,
			taskId: task.id,
			promptFile: null
		});
		const promptFile = await this.store.writeText(job.id, "prompts", attempt.id, prompt).catch(() => null);
		if (promptFile !== null) await this.store.updateAttempt(attempt.id, (current) => ({
			...current,
			promptFile
		}));
		await this.claimTaskRecord(job, task, {
			kind: "assistant",
			name: assistantName,
			sessionId: null
		}, attempt.id);
		return {
			kind: "assistant",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id,
			worker: assistantName,
			prompt,
			planMode: false
		};
	}
	/** 认领 program 任务。 */
	async claimProgramTask(job, task, programId) {
		const attempt = await this.createAttempt({
			jobId: job.id,
			taskId: task.id,
			promptFile: null
		});
		await this.claimTaskRecord(job, task, {
			kind: "worker",
			name: task.assignee.kind === "worker" ? task.assignee.name : programId,
			sessionId: null
		}, attempt.id);
		return {
			kind: "program",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id,
			programId
		};
	}
	/** 认领启动任务（会话启动者）。 */
	async claimStartTask(job, task) {
		if (job.starter.kind !== "session") return null;
		const attempt = await this.createAttempt({
			jobId: job.id,
			taskId: task.id,
			promptFile: null
		});
		await this.claimTaskRecord(job, task, {
			kind: "worker",
			name: "starter",
			sessionId: job.starter.sessionId
		}, attempt.id);
		return {
			kind: "start",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id,
			sessionId: job.starter.sessionId,
			prompt: buildStartTaskPrompt(job)
		};
	}
	/** 为结束任务准备一次投递。 */
	async claimForDelivery(job, task) {
		const attempt = await this.createAttempt({
			jobId: job.id,
			taskId: task.id,
			promptFile: null
		});
		await this.appendEvent(job.id, "delivery/attempt", {
			taskId: task.id,
			attemptId: attempt.id
		});
		return {
			kind: "delivery",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id
		};
	}
	/** 在队列外启动一次执行。 */
	launch(launch) {
		if (this.disposed) return;
		switch (launch.kind) {
			case "agent":
			case "assistant":
				this.launchAgent(launch);
				return;
			case "program":
				this.launchProgram(launch.jobId, launch.taskId, launch.attemptId, launch.programId);
				return;
			case "start":
				this.launchStart(launch);
				return;
			case "delivery": this.runDelivery(launch.jobId, launch.taskId, launch.attemptId);
		}
	}
	/** 启动一个 agent / 助理会话。 */
	async launchAgent(launch) {
		const workers = this.workersOf();
		if (workers === null || typeof workers.dispatchSession !== "function") {
			await this.failOutside(launch.jobId, launch.taskId, "the Buka Workers service with dispatchSession() is unavailable; install or update @buka/dsh-plugin-workers");
			return;
		}
		const task = this.store.getTask(launch.taskId);
		if (task === void 0 || task.status !== "running") return;
		let handle;
		try {
			handle = await workers.dispatchSession({
				worker: launch.worker,
				prompt: launch.prompt,
				title: `工作流任务 ${task.id}`,
				agentPreset: this.options.workerPreset,
				approval: "ask",
				planMode: launch.planMode,
				newSessionId: randomUUID()
			});
		} catch (error) {
			await this.failOutside(launch.jobId, launch.taskId, `could not start the task session: ${describeError$1(error)}`);
			return;
		}
		const sessionId = handleSessionId(handle);
		const startSeq = handleStartSeq(handle) ?? 0;
		await this.store.runExclusive(launch.jobId, async () => {
			const current = this.store.getTask(launch.taskId);
			if (current === void 0 || current.status !== "running") {
				this.disposeHandle(handle);
				return;
			}
			await this.store.updateAttempt(launch.attemptId, (attempt) => ({
				...attempt,
				sessionId,
				startSeq
			}));
			if (sessionId !== null) {
				this.sessionTasks.set(sessionId, {
					jobId: launch.jobId,
					taskId: launch.taskId
				});
				await this.store.updateTask(launch.taskId, (record) => ({
					...record,
					claimant: record.claimant === null ? record.claimant : {
						...record.claimant,
						sessionId
					},
					updatedAt: nowIso()
				}));
			}
		});
		this.trackExecution({
			jobId: launch.jobId,
			taskId: launch.taskId,
			attemptId: launch.attemptId,
			kind: launch.kind,
			sessionId,
			handle,
			startSeq,
			worker: launch.worker
		});
	}
	/** 注册一个等待中的执行（轮询会话轮次、硬超时）。 */
	trackExecution(input) {
		const controller = new AbortController();
		const execution = {
			jobId: input.jobId,
			taskId: input.taskId,
			attemptId: input.attemptId,
			kind: input.kind,
			sessionId: input.sessionId,
			handle: input.handle,
			stopPoll: null,
			controller,
			timeout: null
		};
		const finish = () => {
			execution.stopPoll?.();
			if (execution.timeout !== null) clearTimeout(execution.timeout);
			this.active.delete(input.taskId);
			this.disposeHandle(input.handle);
			if (input.sessionId !== null) {
				if (this.sessionTasks.get(input.sessionId)?.taskId === input.taskId) this.sessionTasks.delete(input.sessionId);
			}
		};
		execution.stopPoll = poll(this.options.pollIntervalMs, async () => {
			const task = this.store.getTask(input.taskId);
			if (task === void 0 || task.status !== "running") {
				finish();
				return true;
			}
			const snapshot = readHandleResult(input.handle, input.startSeq);
			if (!snapshot.turnEnded) return false;
			finish();
			if (input.kind === "assistant") await this.releaseAssistantOutside(input.jobId, input.taskId, snapshot, input.worker);
			else await this.failOutside(input.jobId, input.taskId, `the task session ended without calling buka_task_complete (stopReason: ${snapshot.stopReason ?? "unknown"})`);
			return true;
		});
		this.active.set(input.taskId, execution);
		if (this.options.taskTimeoutMs > 0) {
			execution.timeout = setTimeout(() => {
				this.timeoutOutside(input.jobId, input.taskId, input.worker);
			}, this.options.taskTimeoutMs);
			execution.timeout.unref?.();
		}
	}
	/** 启动 program 任务。 */
	async launchProgram(jobId, taskId, attemptId, programId) {
		const task = this.store.getTask(taskId);
		if (task === void 0 || task.status !== "running") return;
		const driver = programDriver(programId === "" ? "clock" : programId);
		if (driver === void 0) {
			await this.failOutside(jobId, taskId, `unknown robot driver "${programId}"`);
			return;
		}
		const job = this.store.getJob(jobId);
		if (job === void 0) return;
		const controller = new AbortController();
		this.active.set(taskId, {
			jobId,
			taskId,
			attemptId,
			kind: "program",
			sessionId: null,
			handle: null,
			stopPoll: null,
			controller,
			timeout: null
		});
		try {
			const tasks = this.store.listTasks(jobId);
			const payload = renderTaskPayload(task.payload, tasks);
			const result = await driver.run({
				payload,
				signal: controller.signal
			});
			await this.store.runExclusive(jobId, async () => {
				this.active.delete(taskId);
				const current = this.store.getTask(taskId);
				if (current === void 0 || current.status !== "running") return;
				const outputProblems = this.outputProblemsFor(job, current, result.output);
				if (outputProblems.length > 0) await this.failTaskLocked(jobId, taskId, `program output is invalid: ${outputProblems.join("; ")}`);
				else await this.completeTaskLocked(job, current, {
					output: result.output,
					text: "",
					attachments: [],
					workspace: void 0,
					createdBy: current.claimant?.name ?? programId
				});
				await this.recomputeLocked(jobId);
			});
		} catch (error) {
			await this.failOutside(jobId, taskId, `program task failed: ${describeError$1(error)}`);
		}
	}
	/** 投递启动任务提示词到启动者会话。 */
	async launchStart(launch) {
		try {
			const startSeq = await this.delivery.deliver(launch.sessionId, launch.prompt);
			await this.store.runExclusive(launch.jobId, async () => {
				const task = this.store.getTask(launch.taskId);
				if (task === void 0 || task.status !== "running") return;
				await this.store.updateAttempt(launch.attemptId, (attempt) => ({
					...attempt,
					sessionId: launch.sessionId,
					startSeq
				}));
				this.sessionTasks.set(launch.sessionId, {
					jobId: launch.jobId,
					taskId: launch.taskId
				});
				await this.store.updateTask(launch.taskId, (record) => ({
					...record,
					claimant: {
						kind: "worker",
						name: "starter",
						sessionId: launch.sessionId
					},
					updatedAt: nowIso()
				}));
			});
			if (this.options.taskTimeoutMs > 0) setTimeout(() => {
				this.timeoutOutside(launch.jobId, launch.taskId, "starter");
			}, this.options.taskTimeoutMs).unref?.();
		} catch (error) {
			await this.failOutside(launch.jobId, launch.taskId, `could not deliver the start task prompt to the starter session: ${describeError$1(error)}`);
		}
	}
	/** 结束任务投递。 */
	async runDelivery(jobId, taskId, attemptId) {
		const job = this.store.getJob(jobId);
		const task = this.store.getTask(taskId);
		if (job === void 0 || task === void 0 || task.status !== "ready") {
			await this.finishAttemptOutside(attemptId, "cancelled", "cancelled before delivery");
			return;
		}
		let delivered = true;
		let error = null;
		if (job.starter.kind === "session") try {
			await this.delivery.deliver(job.starter.sessionId, buildEndDeliveryText(job, task));
		} catch (caught) {
			delivered = false;
			error = describeError$1(caught);
		}
		await this.store.runExclusive(jobId, async () => {
			const current = this.store.getTask(taskId);
			if (current === void 0) return;
			if (!delivered) {
				this.deliveryBlocked.add(taskId);
				await this.store.updateAttempt(attemptId, (attempt) => ({
					...attempt,
					status: "failed",
					error,
					finishedAt: nowIso()
				}));
				await this.appendEvent(jobId, "delivery/failed", {
					taskId,
					error
				});
				return;
			}
			await this.store.updateAttempt(attemptId, (attempt) => ({
				...attempt,
				status: "completed",
				stopReason: "delivered",
				finishedAt: nowIso()
			}));
			const text = JSON.stringify(current.payload);
			await this.completeRecordNoRecompute(job, current, {
				output: null,
				text,
				attachmentIds: [],
				createdBy: job.starter.kind === "human" ? "本地用户" : "starter"
			});
			await this.appendEvent(jobId, "delivery/completed", { taskId });
			await this.recomputeLocked(jobId);
		});
	}
	/** 尝试结束任务之外的其它任务在超时后失败。 */
	async timeoutOutside(jobId, taskId, worker) {
		await this.store.runExclusive(jobId, async () => {
			const task = this.store.getTask(taskId);
			if (task === void 0 || task.status !== "running") return;
			const execution = this.active.get(taskId);
			execution?.controller.abort();
			if (execution?.handle != null && typeof execution.handle.cancel === "function") try {
				execution.handle.cancel("task timed out");
			} catch {}
			this.active.delete(taskId);
			if (execution?.stopPoll != null) execution.stopPoll();
			await this.failTaskLocked(jobId, taskId, `task timed out after ${this.options.taskTimeoutMs}ms (worker: ${worker})`);
			await this.recomputeLocked(jobId);
		});
	}
	/** 队列外失败：重新进队列提交。 */
	async failOutside(jobId, taskId, reason) {
		try {
			await this.store.runExclusive(jobId, async () => {
				await this.failTaskLocked(jobId, taskId, reason);
				await this.recomputeLocked(jobId);
			});
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not mark task ${taskId} failed: ${describeError$1(error)}`);
		}
	}
	/** 助理失败（会话结束但未提交）：回到待认领。 */
	async releaseAssistantOutside(jobId, taskId, snapshot, worker) {
		try {
			await this.store.runExclusive(jobId, async () => {
				this.busyAssistants.delete(worker);
				await this.releaseAssistantLocked(jobId, this.requireTask(jobId, taskId), `assistant session ended without completing the task (stopReason: ${snapshot.stopReason ?? "unknown"})`);
				await this.recomputeLocked(jobId);
			});
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not release assistant task ${taskId}: ${describeError$1(error)}`);
		}
	}
	/** 助理失败后把任务放回「待认领」。 */
	async releaseAssistantLocked(jobId, task, reason) {
		const now = nowIso();
		const current = this.store.getTask(task.id);
		if (current === void 0 || current.status !== "running") return;
		this.dropSessionTask(task.id);
		await this.store.updateTask(task.id, (record) => ({
			...record,
			status: "ready",
			claimant: null,
			assistantBlocked: true,
			updatedAt: now
		}));
		await this.closeRunningAttempts(task.id, "failed", reason);
		await this.appendEvent(jobId, "task/assistant-failed", {
			taskId: task.id,
			reason
		});
	}
	/** 标记任务技术失败。 */
	async failTaskLocked(jobId, taskId, reason) {
		const task = this.store.getTask(taskId);
		if (task === void 0) return;
		if (task.status !== "running" && task.status !== "ready") return;
		const now = nowIso();
		this.dropSessionTask(taskId);
		this.active.delete(taskId);
		if (task.claimant?.kind === "assistant") this.busyAssistants.delete(task.claimant.name);
		const nextStatus = "failed";
		if (canTransitionTask(task.status, nextStatus)) await this.store.updateTask(taskId, (current) => ({
			...current,
			status: nextStatus,
			error: reason,
			finishedAt: now,
			updatedAt: now
		}));
		await this.closeRunningAttempts(taskId, "failed", reason);
		await this.appendEvent(jobId, "task/failed", {
			taskId,
			error: reason
		});
	}
	/** 关闭任务下所有 running 执行记录。 */
	async closeRunningAttempts(taskId, status, error) {
		for (const attempt of this.store.listAttempts(taskId)) {
			if (attempt.status !== "running") continue;
			await this.store.updateAttempt(attempt.id, (current) => ({
				...current,
				status,
				error,
				finishedAt: nowIso()
			}));
		}
	}
	/** 完成一条任务并写入结果 / 附件。 */
	async completeTaskLocked(job, task, input) {
		const jobDirectory = this.store.paths(job.id).root;
		const attachmentRecords = await ingestAttachments({
			raw: input.attachments,
			jobId: job.id,
			jobDirectory,
			taskId: task.id,
			position: task.position,
			createdBy: input.createdBy,
			workspace: input.workspace,
			limits: {
				maxBytes: this.options.maxAttachmentBytes,
				maxTotalBytes: this.options.maxTaskAttachmentsBytes,
				maxCount: this.options.maxAttachmentsPerTask
			}
		});
		for (const attachment of attachmentRecords) await this.store.insertAttachment(attachment);
		const attemptId = task.attemptIds.at(-1) ?? newAttemptId();
		const text = clipUtf8(input.text, this.options.maxResultTextBytes);
		const textFile = text.trim() === "" ? null : await this.store.writeText(job.id, "results", attemptId, text).catch(() => null);
		const result = {
			output: input.output,
			text: clipUtf8(text, RESULT_PREVIEW_BYTES),
			textBytes: Buffer.byteLength(text, "utf8"),
			textFile,
			attachmentIds: attachmentRecords.map((attachment) => attachment.id)
		};
		if (task.claimant?.kind === "assistant") this.busyAssistants.delete(task.claimant.name);
		const now = nowIso();
		if (task.id === "start-task") await this.store.updateJob(job.id, (current) => ({
			...current,
			input: {
				...current.input,
				structured: input.output
			},
			updatedAt: now
		}));
		if (!canTransitionTask(task.status, "completed")) throw new WorkflowError("invalid-status", `task ${task.id} is ${task.status}, cannot complete`);
		const updated = await this.store.updateTask(task.id, (current) => ({
			...current,
			status: "completed",
			result,
			error: null,
			finishedAt: now,
			updatedAt: now
		}));
		if (this.store.getAttempt(attemptId) !== void 0) await this.store.updateAttempt(attemptId, (current) => ({
			...current,
			status: current.status === "running" ? "completed" : current.status,
			stopReason: current.status === "running" ? "completed" : current.stopReason,
			finishedAt: current.finishedAt ?? now
		}));
		this.active.delete(task.id);
		this.dropSessionTask(task.id);
		await this.appendEvent(job.id, "task/completed", {
			taskId: task.id,
			type: task.type
		});
		if (task.id === "start-task") await this.spawnInitialTasksLocked(job, updated);
		return updated;
	}
	/** 完成结束任务（无 recompute，由调用方继续）。 */
	async completeRecordNoRecompute(job, task, result) {
		const now = nowIso();
		const text = clipUtf8(result.text, this.options.maxResultTextBytes);
		const resultRecord = {
			output: result.output,
			text: clipUtf8(text, RESULT_PREVIEW_BYTES),
			textBytes: Buffer.byteLength(text, "utf8"),
			textFile: null,
			attachmentIds: [...result.attachmentIds]
		};
		if (!canTransitionTask(task.status, "completed")) return;
		await this.store.updateTask(task.id, (current) => ({
			...current,
			status: "completed",
			result: resultRecord,
			claimant: current.claimant ?? {
				kind: job.starter.kind === "human" ? "human" : "worker",
				name: result.createdBy,
				sessionId: job.starter.kind === "session" ? job.starter.sessionId : null
			},
			error: null,
			finishedAt: now,
			updatedAt: now
		}));
	}
	/** 启动任务完成后创建初始任务。 */
	async spawnInitialTasksLocked(job, startTask) {
		const workers = await this.workers();
		const initial = buildInitialTasks({
			job,
			startTask,
			tasks: this.store.listTasks(job.id),
			workers
		});
		for (const task of initial) {
			await this.store.insertTask(task);
			await this.appendEvent(job.id, "task/created", {
				taskId: task.id,
				position: task.position,
				type: task.type,
				deps: task.deps
			});
		}
	}
	/** 结算：没有非终态任务时决定作业最终状态。 */
	async settleLocked(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0 || job.status !== "running") return;
		if (this.overDurationBudget(job)) {
			await this.failJobForBudget(job);
			return;
		}
		const tasks = this.store.listTasks(jobId);
		if (tasks.some((task) => task.status === "failed")) return;
		if (tasks.some((task) => isOpenTaskStatus(task.status))) return;
		const hasEndCompleted = tasks.some((task) => task.position === "end" && task.status === "completed");
		const hasFailure = tasks.some((task) => task.status === "blocked" || task.status === "failed" || task.status === "cancelled" && task.error !== null);
		const now = nowIso();
		if (hasEndCompleted && !hasFailure) {
			assertJobTransition(jobId, job.status, "completed");
			await this.store.updateJob(jobId, (current) => ({
				...current,
				status: "completed",
				error: null,
				finishedAt: now,
				updatedAt: now
			}));
			await this.appendEvent(jobId, "job/completed", {});
			return;
		}
		const reason = hasEndCompleted ? "a task failed or was blocked, so the job ended as failed" : "no end task was completed, so the job ended as failed";
		assertJobTransition(jobId, job.status, "failed");
		await this.store.updateJob(jobId, (current) => ({
			...current,
			status: "failed",
			error: reason,
			finishedAt: now,
			updatedAt: now
		}));
		await this.appendEvent(jobId, "job/failed", { error: reason });
	}
	/** 是否超过最长时长预算。 */
	overDurationBudget(job) {
		return Date.now() - Date.parse(job.createdAt) > job.definition.budgets.maxDurationHours * 3600 * 1e3;
	}
	/** 超预算：取消非终态任务，作业 failed。 */
	async failJobForBudget(job) {
		const now = nowIso();
		for (const task of this.store.listTasks(job.id)) {
			if (!isOpenTaskStatus(task.status)) continue;
			this.cancelActive(task.id, "workflow budget exceeded");
			await this.store.updateTask(task.id, (current) => ({
				...current,
				status: "cancelled",
				finishedAt: now,
				updatedAt: now
			}));
			await this.closeRunningAttempts(task.id, "cancelled", "workflow budget exceeded");
			this.dropSessionTask(task.id);
		}
		const reason = `workflow exceeded its maxDurationHours budget (${job.definition.budgets.maxDurationHours}h)`;
		await this.store.updateJob(job.id, (current) => ({
			...current,
			status: "failed",
			error: reason,
			finishedAt: now,
			updatedAt: now
		}));
		await this.appendEvent(job.id, "job/budget-exceeded", { error: reason });
	}
	/** 取一个运行中的作业，否则抛错。 */
	requireRunningJob(jobId, allowTerminal = false) {
		const job = this.store.getJob(jobId);
		if (job === void 0) throw new WorkflowError("not-found", `job not found: ${jobId}`);
		if (!allowTerminal && job.status !== "running") throw new WorkflowError("job-not-running", `job ${jobId} is ${job.status}`);
		return job;
	}
	/** 取一条属于该作业的任务。 */
	requireTask(jobId, taskId) {
		const task = this.store.getTask(taskId);
		if (task === void 0 || task.jobId !== jobId) throw new WorkflowError("not-found", `task not found: ${taskId}`);
		return task;
	}
	/** 按 id 取任务类型。 */
	taskTypeOf(definition, typeId) {
		for (const position of definition.positions) for (const taskType of position.taskTypes) if (taskType.id === typeId) return taskType;
	}
	/** 按任务契约校验结构化结果。 */
	outputProblemsFor(job, task, output) {
		const definition = job.definition;
		if (task.position === "end") return [];
		if (task.id === "start-task") return schemaProblems(definition.start.task.output, output);
		const taskType = this.taskTypeOf(definition, task.type);
		if (taskType === void 0) return [`unknown task type "${task.type}"`];
		return schemaProblems(taskType.output, output);
	}
	/** 任务执行者的工作区（打工人目录）。 */
	workspaceFor(task) {
		if (task.assignee.kind === "worker") return this.catalog.get(task.assignee.name)?.path;
		if (task.claimant !== null && task.claimant.kind === "assistant") return this.catalog.get(task.claimant.name)?.path;
	}
	/** 取消一条任务的等待中执行。 */
	cancelActive(taskId, reason) {
		const execution = this.active.get(taskId);
		if (execution === void 0) return;
		execution.stopPoll?.();
		if (execution.timeout !== null) clearTimeout(execution.timeout);
		execution.controller.abort();
		try {
			if (execution.handle !== null && typeof execution.handle.cancel === "function") execution.handle.cancel(reason);
		} catch {}
		this.disposeHandle(execution.handle);
		this.active.delete(taskId);
		if (execution.sessionId !== null) this.sessionTasks.delete(execution.sessionId);
	}
	/** 从 session→task 索引里删掉某条任务。 */
	dropSessionTask(taskId) {
		for (const [sessionId, reference] of this.sessionTasks) if (reference.taskId === taskId) this.sessionTasks.delete(sessionId);
	}
	/** 关闭 attempt（投递取消等）。 */
	async finishAttemptOutside(attemptId, status, error) {
		try {
			await this.store.updateAttempt(attemptId, (current) => ({
				...current,
				status,
				error,
				finishedAt: nowIso()
			}));
		} catch {}
	}
	/** 追加作业事件。 */
	async appendEvent(jobId, type, data) {
		await appendJobEvent(this.store, this.logger, jobId, type, data);
	}
};
// .build/workflows/migration.js
/**
* v4 硬切换迁移：一次性删除旧工作流数据，之后不再按格式版本清空用户资产。
*
* 旧版把运行记录写在 `<dataDir>/runs/`、归档设置写在 `<dataDir>/settings.json`；
* v4 的作业 / 任务进 `ctx.storageDomain`，大文本与附件进 `<dataDir>/jobs/`。
* 首次启动删除旧目录，并写一个标记；标记存在时不再触碰数据目录。
*
* @module @buka/dsh-plugin-workflows/migration
*/
/** 迁移标记文件名。 */
const MIGRATION_MARKER = ".v4-migrated";
/** 旧版本遗留在数据目录下的路径。 */
const LEGACY_PATHS = ["runs", "settings.json"];
/**
* 执行硬切换迁移；幂等。
*
* @param options 数据目录与日志
* @returns 无返回值
*/
async function runMigrations(options) {
	const { dataDir, logger } = options;
	await promises.mkdir(dataDir, { recursive: true });
	const marker = path.join(dataDir, MIGRATION_MARKER);
	try {
		await promises.access(marker);
		return;
	} catch {}
	const removed = [];
	for (const name of LEGACY_PATHS) {
		const target = path.join(dataDir, name);
		try {
			await promises.rm(target, {
				recursive: true,
				force: true
			});
			removed.push(name);
		} catch (error) {
			logger?.warn?.(`buka-workflows: could not remove legacy path ${target}`, error);
		}
	}
	await promises.mkdir(path.join(dataDir, "jobs"), { recursive: true });
	await promises.writeFile(marker, `${(/* @__PURE__ */ new Date()).toISOString()}\n`, "utf8");
	if (removed.length > 0) logger?.info?.(`buka-workflows: migrated to v4, removed legacy data: ${removed.join(", ")}`);
}
// .build/workflows/options.js
/**
* 插件配置与数据目录解析。
*
* v4 只有少量运行参数：数据目录（大文本 / 附件 / 迁移标记）、任务超时、
* 轮询间隔、附件限额、编排 preset / 工作区与打工人会话 preset。作业 / 任务
* 元数据进 `ctx.storageDomain`，不在这里配置。
*
* @module @buka/dsh-plugin-workflows/options
*/
/** 插件全局目录名。 */
const PLUGIN_CACHE_DIR = "dsh-plugin-workflows";
/** 默认数据目录名。 */
const DEFAULTS = {
	/** 不设默认超时：任务耗时取决于模型速度与任务大小，硬截止容易误杀。 */
	taskTimeoutMs: 0,
	pollIntervalMs: 1500,
	maxAttachmentBytes: 8388608,
	maxAttachmentsPerTask: 20,
	maxTaskAttachmentsBytes: 67108864,
	maxInlineAttachmentBytes: 32768,
	maxResultTextBytes: 2097152,
	orchestratorPresets: ["workflow-orchestrator"],
	orchestratorWorkspaces: [],
	workerPreset: "standard"
};
/** 插件配置。 */
const Config = z.object({
	dataDir: z.string().default(defaultDataDir()).description("插件数据目录：渲染后的 prompt、结果全文、作业附件与迁移标记。作业 / 任务元数据在 storageDomain 里。支持 ~ 前缀。"),
	taskTimeoutMs: z.number().step(1).min(0).default(DEFAULTS.taskTimeoutMs).description("单个任务的默认硬超时（毫秒）；0 表示不超时。"),
	pollIntervalMs: z.number().step(1).min(100).default(DEFAULTS.pollIntervalMs).description("观察任务会话是否结束轮的轮询间隔（毫秒）。"),
	maxAttachmentBytes: z.number().step(1).min(1).default(DEFAULTS.maxAttachmentBytes).description("单个附件的字节上限。"),
	maxAttachmentsPerTask: z.number().step(1).min(1).default(DEFAULTS.maxAttachmentsPerTask).description("一次任务完成最多提交的附件数量。"),
	maxTaskAttachmentsBytes: z.number().step(1).min(1).default(DEFAULTS.maxTaskAttachmentsBytes).description("一次任务完成的附件总量字节上限。"),
	maxInlineAttachmentBytes: z.number().step(1).min(1).default(DEFAULTS.maxInlineAttachmentBytes).description("可在 prompt 里内联的单个文本附件字节上限。"),
	maxResultTextBytes: z.number().step(1).min(1).default(DEFAULTS.maxResultTextBytes).description("写入作业目录的结果全文上限；超出部分截断并在记录里标注。"),
	orchestratorPresets: z.array(z.string()).default(DEFAULTS.orchestratorPresets).description("能保存 / 读取工作流定义的 agent preset 名单。留空表示不做收窄（所有会话可见）。推荐只保留随插件发布的 `workflow-orchestrator`。"),
	orchestratorWorkspaces: z.array(z.string()).default(DEFAULTS.orchestratorWorkspaces).description("按工作区放行工作流定义工具：在这些目录（含子目录，支持 ~ 前缀）里启动的会话，即使 preset 不在 orchestratorPresets 里也能保存 / 读取定义。留空表示只按 preset 判定。"),
	workerPreset: z.string().default(DEFAULTS.workerPreset).description("智能体任务会话使用的 agent preset。")
});
/**
* 合并配置与默认值。
*
* @param config 插件配置（可能缺省）
* @returns 合并后的配置
*/
function resolveOptions(config) {
	const orchestratorPresets = Array.isArray(config?.orchestratorPresets) ? config.orchestratorPresets.map((preset) => String(preset).trim()).filter((preset) => preset !== "") : DEFAULTS.orchestratorPresets;
	const workerPreset = typeof config?.workerPreset === "string" ? config.workerPreset.trim() : "";
	return {
		dataDir: resolveDataDir(config?.dataDir),
		taskTimeoutMs: nonNegative(config?.taskTimeoutMs) ?? DEFAULTS.taskTimeoutMs,
		pollIntervalMs: positive(config?.pollIntervalMs) ?? DEFAULTS.pollIntervalMs,
		maxAttachmentBytes: positive(config?.maxAttachmentBytes) ?? DEFAULTS.maxAttachmentBytes,
		maxAttachmentsPerTask: positive(config?.maxAttachmentsPerTask) ?? DEFAULTS.maxAttachmentsPerTask,
		maxTaskAttachmentsBytes: positive(config?.maxTaskAttachmentsBytes) ?? DEFAULTS.maxTaskAttachmentsBytes,
		maxInlineAttachmentBytes: positive(config?.maxInlineAttachmentBytes) ?? DEFAULTS.maxInlineAttachmentBytes,
		maxResultTextBytes: positive(config?.maxResultTextBytes) ?? DEFAULTS.maxResultTextBytes,
		orchestratorPresets,
		orchestratorWorkspaces: resolveWorkspaceRoots(config?.orchestratorWorkspaces),
		workerPreset: workerPreset === "" ? DEFAULTS.workerPreset : workerPreset
	};
}
/**
* 解析按工作区放行的目录：去空、展开 ~、转绝对路径、去掉末尾分隔符。
*
* @param value 配置里的目录列表
* @param env 环境变量
* @returns 规范化后的绝对路径列表
*/
function resolveWorkspaceRoots(value, env = process.env) {
	if (!Array.isArray(value)) return [];
	const roots = [];
	for (const entry of value) {
		const text = typeof entry === "string" ? entry.trim() : "";
		if (text === "") continue;
		const expanded = text === "~" || text.startsWith("~/") || text.startsWith("~\\") ? path.join(homeDir(env), text.slice(1)) : text;
		const absolute = path.resolve(expanded);
		const root = absolute.length > 1 && absolute.endsWith(path.sep) ? absolute.slice(0, -1) : absolute;
		if (!roots.includes(root)) roots.push(root);
	}
	return roots;
}
/**
* 解析数据目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows`。
*
* @param value 配置里的目录（支持 ~ 前缀）
* @param env 环境变量
* @returns 绝对路径
*/
function resolveDataDir(value, env = process.env) {
	const text = typeof value === "string" ? value.trim() : "";
	if (text === "") return defaultDataDir(env);
	if (text === "~") return path.join(homeDir(env), ".cache", PLUGIN_CACHE_DIR);
	if (text.startsWith("~/") || text.startsWith("~\\")) return path.resolve(homeDir(env), text.slice(2));
	return path.resolve(text);
}
/**
* 默认数据目录。
*
* @param env 环境变量
* @returns 默认数据目录
*/
function defaultDataDir(env = process.env) {
	const cacheHome = typeof env.XDG_CACHE_HOME === "string" && env.XDG_CACHE_HOME.trim() !== "" ? env.XDG_CACHE_HOME.trim() : path.join(homeDir(env), ".cache");
	return path.join(cacheHome, PLUGIN_CACHE_DIR);
}
/**
* 用户主目录。
*
* @param env 环境变量
* @returns 主目录
*/
function homeDir(env) {
	const home = typeof env.HOME === "string" ? env.HOME.trim() : "";
	return home === "" ? os.homedir() : home;
}
/**
* 正整数字段或默认值。
*
* @param value 待校验的值
* @returns 正整数或 undefined
*/
function positive(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
/**
* 非负整数字段或默认值。
*
* @param value 待校验的值
* @returns 非负整数或 undefined
*/
function nonNegative(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : void 0;
}
// .build/workflows/http.js
/**
* HTTP 小工具：响应写出、请求体读取与附件流式下载。
*
* @module @buka/dsh-plugin-workflows/http
*/
/** 设置请求体上限：工作流定义可能较大，但仍要防止无界读取。 */
const MAX_BODY_BYTES = 262144;
/**
* 把附件文件写进响应：默认下载，`inline` 时按给定 MIME 内联并附带安全头。
*
* @param res HTTP 响应
* @param attachment 附件文件
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
// .build/workflows/routes/index.js
/**
* 浏览器一半的 HTTP 路由（`.tmp/workflow-v4-api.md`）：
* 工作流 / 作业 / 任务 / 附件与动作。
*
* 所有路由沿用 web 组合的信任栅栏（`ctx.connection.requestRejection`），只接受
* 本机同源请求；失败统一 `{ ok: false, code, message }`。
*
* @module @buka/dsh-plugin-workflows/routes
*/
/** 路由路径。 */
const ROUTES = {
	workflows: "/buka-workflows/workflows",
	workflow: "/buka-workflows/workflow",
	workflowActivate: "/buka-workflows/workflow/activate",
	jobs: "/buka-workflows/jobs",
	jobStart: "/buka-workflows/job/start",
	job: "/buka-workflows/job",
	jobAction: "/buka-workflows/job/action",
	task: "/buka-workflows/task",
	taskAction: "/buka-workflows/task/action",
	attachments: "/buka-workflows/attachments",
	attachment: "/buka-workflows/attachment"
};
/** 错误码 → HTTP 状态码。 */
function statusForError(error) {
	if (error instanceof WorkflowError) switch (error.code) {
		case "not-found": return 404;
		case "workflow-not-active":
		case "workflow-retired": return 409;
		case "job-not-running":
		case "task-not-running":
		case "invalid-status":
		case "not-ready":
		case "not-failed":
		case "no-pending-delivery": return 409;
		default: return 400;
	}
	return 500;
}
/** 统一错误响应。 */
function sendRouteError(res, error, logger, fallbackCode = "internal") {
	const status = statusForError(error);
	const code = error instanceof WorkflowError ? error.code : fallbackCode;
	const message = describeError$1(error);
	if (status >= 500) logger?.warn?.(`buka-workflows: request failed: ${message}`);
	if (!res.headersSent) sendError(res, status, code, message);
	else res.destroy(error instanceof Error ? error : void 0);
}
/** 查询参数。 */
function query(req) {
	return new URL(req.url ?? "/", "http://localhost").searchParams;
}
/**
* 注册全部浏览器路由。
*
* @param deps 上下文与引擎 getter
*/
function registerWorkflowRoutes({ ctx, ready }) {
	ctx.inject(["webServer", "connection"], (webCtx) => {
		/** 信任栅栏；被拒绝时响应已写出。 */
		const rejected = (req, res) => {
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
		};
		/** 注册一条精确路由。 */
		const route = (path, handler) => {
			webCtx.effect(() => webCtx.webServer.register({
				kind: "exact",
				path,
				handler: async (req, res) => {
					if (rejected(req, res)) return;
					try {
						await handler(req, res);
					} catch (error) {
						sendRouteError(res, error, webCtx.logger);
					}
				}
			}), `buka-workflows: ${path}`);
		};
		route(ROUTES.workflows, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			sendJson(res, 200, {
				ok: true,
				workflows: (await ready()).listWorkflowSummaries()
			});
		});
		route(ROUTES.workflow, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			const params = query(req);
			const workflowId = (params.get("id") ?? "").trim();
			const versionRaw = params.get("version");
			const version = versionRaw === null || versionRaw === "" ? void 0 : Number.parseInt(versionRaw, 10);
			if (workflowId === "") return sendError(res, 400, "invalid-id", "id is required");
			if (version !== void 0 && (!Number.isInteger(version) || version < 1)) return sendError(res, 400, "invalid-version", "version must be a positive integer");
			const detail = await (await ready()).readWorkflowDetail(workflowId, version);
			if (detail === null) return sendError(res, 404, "not-found", `workflow not found: ${workflowId}`);
			sendJson(res, 200, {
				ok: true,
				...detail
			});
		});
		route(ROUTES.workflowActivate, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed(res, "POST");
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const record = body;
			const id = typeof record.id === "string" ? record.id.trim() : "";
			if (id === "") return sendError(res, 400, "invalid-id", "id is required");
			if (typeof record.active !== "boolean") return sendError(res, 400, "invalid-active", "active must be a boolean");
			const workflow = await (await ready()).setWorkflowActive(id, record.active);
			sendJson(res, 200, {
				ok: true,
				workflow: {
					id: workflow.id,
					status: workflow.status
				}
			});
		});
		route(ROUTES.jobs, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			const workflowId = (query(req).get("workflowId") ?? "").trim();
			if (workflowId === "") return sendError(res, 400, "invalid-id", "workflowId is required");
			sendJson(res, 200, {
				ok: true,
				jobs: (await ready()).listJobSummaries(workflowId)
			});
		});
		route(ROUTES.jobStart, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed(res, "POST");
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const record = body;
			const workflowId = typeof record.workflowId === "string" ? record.workflowId.trim() : "";
			if (workflowId === "") return sendError(res, 400, "invalid-id", "workflowId is required");
			const job = await (await ready()).createJobFromHuman({
				workflowId,
				rawInput: record.rawInput ?? {},
				structuredInput: record.structuredInput ?? {}
			});
			sendJson(res, 200, {
				ok: true,
				jobId: job.id,
				seq: job.seq
			});
		});
		route(ROUTES.job, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			const jobId = (query(req).get("id") ?? "").trim();
			if (jobId === "") return sendError(res, 400, "invalid-id", "id is required");
			const detail = await (await ready()).jobDetail(jobId);
			if (detail === null) return sendError(res, 404, "not-found", `job not found: ${jobId}`);
			sendJson(res, 200, {
				ok: true,
				...detail
			});
		});
		route(ROUTES.jobAction, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed(res, "POST");
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const record = body;
			const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
			if (jobId === "") return sendError(res, 400, "invalid-id", "jobId is required");
			const engine = await ready();
			if (record.action === "cancel") {
				const job = await engine.cancelJob(jobId);
				sendJson(res, 200, {
					ok: true,
					job: {
						id: job.id,
						status: job.status
					}
				});
				return;
			}
			if (record.action === "retry-delivery") {
				const job = await engine.retryDelivery(jobId);
				sendJson(res, 200, {
					ok: true,
					job: {
						id: job.id,
						status: job.status
					}
				});
				return;
			}
			sendError(res, 400, "invalid-action", "action must be cancel or retry-delivery");
		});
		route(ROUTES.task, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			const params = query(req);
			const jobId = (params.get("jobId") ?? "").trim();
			const taskId = (params.get("taskId") ?? "").trim();
			if (jobId === "" || taskId === "") return sendError(res, 400, "invalid-id", "jobId and taskId are required");
			const detail = (await ready()).taskDetail(jobId, taskId);
			if (detail === null) return sendError(res, 404, "not-found", "task not found");
			sendJson(res, 200, {
				ok: true,
				task: detail
			});
		});
		route(ROUTES.taskAction, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed(res, "POST");
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const record = body;
			const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
			const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
			if (jobId === "" || taskId === "") return sendError(res, 400, "invalid-id", "jobId and taskId are required");
			const engine = await ready();
			switch (record.action) {
				case "cancel": {
					const task = await engine.cancelTask(jobId, taskId);
					sendJson(res, 200, {
						ok: true,
						task: {
							id: task.id,
							status: task.status
						}
					});
					return;
				}
				case "retry": {
					const task = await engine.retryTask(jobId, taskId);
					sendJson(res, 200, {
						ok: true,
						task: {
							id: task.id,
							status: task.status
						}
					});
					return;
				}
				case "claim": {
					const task = await engine.claimTaskAsHuman(jobId, taskId);
					sendJson(res, 200, {
						ok: true,
						task: {
							id: task.id,
							status: task.status
						}
					});
					return;
				}
				case "complete": {
					const task = await engine.completeTaskAsHuman({
						jobId,
						taskId,
						output: record.output ?? {},
						text: typeof record.text === "string" ? record.text : "",
						attachments: record.attachments
					});
					sendJson(res, 200, {
						ok: true,
						task: {
							id: task.id,
							status: task.status
						}
					});
					return;
				}
				default: sendError(res, 400, "invalid-action", "action must be cancel, retry, claim or complete");
			}
		});
		route(ROUTES.attachments, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			const params = query(req);
			const jobId = (params.get("jobId") ?? "").trim();
			if (jobId === "") return sendError(res, 400, "invalid-id", "jobId is required");
			const limit = parseLimit(params.get("limit"));
			sendJson(res, 200, {
				ok: true,
				attachments: (await ready()).listJobAttachments(jobId).slice(0, limit)
			});
		});
		route(ROUTES.attachment, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed(res, "GET");
			const params = query(req);
			const jobId = (params.get("jobId") ?? "").trim();
			const attachmentId = (params.get("attachmentId") ?? "").trim();
			const mode = params.get("mode") ?? "download";
			if (jobId === "" || attachmentId === "") return sendError(res, 400, "invalid-id", "jobId and attachmentId are required");
			if (mode !== "download" && mode !== "preview" && mode !== "inline") return sendError(res, 400, "invalid-mode", "mode must be download, preview or inline");
			const opened = (await ready()).openAttachment(jobId, attachmentId);
			if (opened === null) return sendError(res, 404, "not-found", "attachment not found");
			const preview = attachmentPreviewInfo(opened.record.name);
			if (mode === "download") {
				pipeAttachment(res, {
					path: opened.file,
					name: opened.record.name,
					bytes: opened.record.bytes
				}, { log: (error) => webCtx.logger?.warn?.(`buka-workflows: attachment read failed: ${describeError$1(error)}`) });
				return;
			}
			if (mode === "inline") {
				if (preview.kind !== "image" && preview.kind !== "pdf") {
					sendError(res, 415, "unsupported-preview", "this attachment type cannot be previewed inline");
					return;
				}
				pipeAttachment(res, {
					path: opened.file,
					name: opened.record.name,
					bytes: opened.record.bytes
				}, {
					inline: true,
					mime: preview.mime,
					log: (error) => webCtx.logger?.warn?.(`buka-workflows: attachment read failed: ${describeError$1(error)}`)
				});
				return;
			}
			if (preview.kind !== "text") {
				sendJson(res, 200, {
					ok: true,
					attachment: {
						name: opened.record.name,
						bytes: opened.record.bytes,
						kind: preview.kind,
						mime: preview.mime
					}
				});
				return;
			}
			const range = await readAttachmentRange(opened.file, { maxBytes: DEFAULT_PREVIEW_TEXT_BYTES });
			if (range.text === null) {
				sendJson(res, 200, {
					ok: true,
					attachment: {
						name: opened.record.name,
						bytes: opened.record.bytes,
						kind: "binary",
						mime: null
					}
				});
				return;
			}
			sendJson(res, 200, {
				ok: true,
				attachment: {
					name: opened.record.name,
					bytes: opened.record.bytes,
					kind: "text",
					mime: "text/plain",
					text: range.text,
					truncated: range.truncated,
					read: range.read,
					offset: range.offset
				}
			});
		});
	});
}
// .build/workflows/store/dirs.js
/**
* 作业目录布局与路径安全。
*
* 元数据进 `ctx.storageDomain`；大文本（渲染后的 prompt、结果全文）与附件文件
* 放插件数据目录下的作业目录：
*
* ```text
* <dataDir>/jobs/<jobId>/
*   prompts/<attemptId>.md
*   results/<attemptId>.txt
*   attachments/<attachmentId>-<name>
*   events.jsonl
* ```
*
* 记录里只存相对路径，避免宿主机迁移目录后引用失效。所有 id 先校验成单个路径
* 段再拼路径，防止 `../` 越界。
*
* @module @buka/dsh-plugin-workflows/store/dirs
*/
/** 单个 id 允许的字符；记录 id 都是 `[a-z]+-...`（启动任务也是 `start-task`）。 */
const SAFE_SEGMENT = /^[A-Za-z0-9$][A-Za-z0-9._-]*$/u;
/**
* 校验一个 id / 文件名是单个安全的路径段。
*
* @param value 待校验的 id
* @param label 出错信息里用的名称
* @returns 原值
* @throws id 不合法时抛出
*/
function assertSafeSegment(value, label = "id") {
	if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
	return value;
}
/**
* 计算一个作业的目录布局。
*
* @param dataDir 插件数据目录
* @param jobId 作业 id
* @returns 目录布局
*/
function jobPaths(dataDir, jobId) {
	const root = path.join(dataDir, "jobs", assertSafeSegment(jobId, "job id"));
	return {
		root,
		prompts: path.join(root, "prompts"),
		results: path.join(root, "results"),
		attachments: path.join(root, "attachments"),
		events: path.join(root, "events.jsonl")
	};
}
/**
* 建好一个作业的目录。
*
* @param paths 目录布局
* @returns 无返回值
*/
async function ensureJobDirectories(paths) {
	await Promise.all([
		promises.mkdir(paths.prompts, { recursive: true }),
		promises.mkdir(paths.results, { recursive: true }),
		promises.mkdir(paths.attachments, { recursive: true })
	]);
}
/**
* 把作业目录内的相对路径解析成绝对路径，并确保仍在作业根目录内。
*
* @param paths 目录布局
* @param relative 记录里的相对路径
* @returns 绝对路径
* @throws 越界时抛出
*/
function resolveJobFile(paths, relative) {
	const absolute = path.resolve(paths.root, relative);
	const rel = path.relative(paths.root, absolute);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`path escapes the job directory: ${relative}`);
	return absolute;
}
/**
* 写一份大文本到作业目录，返回相对作业根目录的路径。
*
* @param paths 目录布局
* @param kind `prompts` / `results`
* @param name 文件名（单个安全段）
* @param text 文本
* @returns 相对作业根目录的路径
*/
async function writeJobText(paths, kind, name, text) {
	const directory = kind === "prompts" ? paths.prompts : paths.results;
	const file = path.join(directory, `${assertSafeSegment(name, "file name")}.txt`);
	await promises.writeFile(file, text, "utf8");
	return path.relative(paths.root, file);
}
/**
* 读一份作业目录里的大文本。
*
* @param paths 目录布局
* @param relative 相对路径
* @returns 文本；文件不存在时是 null
*/
async function readJobText(paths, relative) {
	try {
		return await promises.readFile(resolveJobFile(paths, relative), "utf8");
	} catch {
		return null;
	}
}
// .build/workflows/store/queue.js
/**
* per-job 串行队列：同一个作业的状态变更排队执行，避免并发认领 / 创建竞争。
*
* 不同作业互不阻塞。队列只保证「同一 key 的异步任务按调用顺序串行」；任务抛错
* 不会中断后续任务（下一个任务照常执行）。
*
* @module @buka/dsh-plugin-workflows/store/queue
*/
/** 按 key 串行执行异步任务的队列。 */
var KeyedQueue = class {
	/** 每个 key 的队尾（永远 settle，便于挂下一个任务）。 */
	chains = /* @__PURE__ */ new Map();
	/**
	* 把任务排到某个 key 的队尾。
	*
	* @param key 队列 key（作业 id）
	* @param task 要执行的异步任务
	* @returns 任务自身的结果 / 错误
	*/
	run(key, task) {
		const result = (this.chains.get(key) ?? Promise.resolve()).then(task, task);
		const tail = result.then(() => void 0, () => void 0);
		this.chains.set(key, tail);
		tail.then(() => {
			if (this.chains.get(key) === tail) this.chains.delete(key);
		});
		return result;
	}
	/**
	* 当前排队的 key 数量（诊断 / 测试用）。
	*
	* @returns 队列数量
	*/
	get size() {
		return this.chains.size;
	}
};
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a$1;
/* @__NO_SIDE_EFFECTS__ */
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
const $ZodError = /* @__PURE__ */ $constructor("$ZodError", initializer$1);
const $ZodRealError = /* @__PURE__ */ $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
const _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
const _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) {
			if (def.inclusive) bag.maximum = def.value;
			else bag.exclusiveMaximum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) {
			if (def.inclusive) bag.minimum = def.value;
			else bag.exclusiveMinimum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
const version = {
	major: 4,
	minor: 4,
	patch: 3
};
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
	def.inclusive = false;
	$ZodUnion.init(inst, def);
	const _super = inst._zod.parse;
	defineLazy(inst._zod, "propValues", () => {
		const propValues = {};
		for (const option of def.options) {
			const pv = option._zod.propValues;
			if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
			for (const [k, v] of Object.entries(pv)) {
				if (!propValues[k]) propValues[k] = /* @__PURE__ */ new Set();
				for (const val of v) propValues[k].add(val);
			}
		}
		return propValues;
	});
	const disc = cached(() => {
		const opts = def.options;
		const map = /* @__PURE__ */ new Map();
		for (const o of opts) {
			const values = o._zod.propValues?.[def.discriminator];
			if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
			for (const v of values) {
				if (map.has(v)) throw new Error(`Duplicate discriminator value "${String(v)}"`);
				map.set(v, o);
			}
		}
		return map;
	});
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				code: "invalid_type",
				expected: "object",
				input,
				inst
			});
			return payload;
		}
		const opt = disc.value.get(input?.[def.discriminator]);
		if (opt) return opt._zod.run(payload, ctx);
		if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
		payload.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: def.discriminator,
			options: Array.from(disc.value.keys()),
			input,
			path: [def.discriminator],
			inst
		});
		return payload;
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values) {
			payload.value = {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				unrecognized = unrecognized ?? [];
				unrecognized.push(key);
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized
			});
		} else {
			payload.value = {};
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process$1(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process$1(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, _params) => {
	const def = schema._zod.def;
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof val === "bigint") {
		if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
		else vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process$1(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process$1(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process$1(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process$1(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process$1(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process$1(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
const recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = keyType._zod.bag?.patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = process$1(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process$1(def.keyType, ctx, {
			...params,
			path: [...params.path, "propertyNames"]
		});
		json.additionalProperties = process$1(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	if (keyValues) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues;
	}
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process$1(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
const _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(/* @__PURE__ */ _gt(value, params));
		},
		gte(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		min(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		lt(value, params) {
			return this.check(/* @__PURE__ */ _lt(value, params));
		},
		lte(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		max(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(/* @__PURE__ */ _gt(0, params));
		},
		nonnegative(params) {
			return this.check(/* @__PURE__ */ _gte(0, params));
		},
		negative(params) {
			return this.check(/* @__PURE__ */ _lt(0, params));
		},
		nonpositive(params) {
			return this.check(/* @__PURE__ */ _lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		step(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object(shape, params) {
	const def = {
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	};
	return new ZodObject(def);
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
	ZodUnion.init(inst, def);
	$ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
	return new ZodDiscriminatedUnion({
		type: "union",
		options,
		discriminator,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
	return new ZodEnum({
		type: "enum",
		entries,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
/** 域名称；与 storage backend 里的 unit 名一致。 */
const WORKFLOW_DOMAIN_NAME = "buka_workflow";
/** 宽松对象：嵌套结构的完整校验在各自的使用路径上做。 */
const looseObject = record(string(), unknown());
/** 任务 / 作业 / 工作流状态。 */
const workflowStatusSchema = _enum([
	"draft",
	"active",
	"retired"
]);
const jobStatusSchema = _enum([
	"running",
	"completed",
	"failed",
	"cancelled"
]);
const taskStatusSchema = _enum([
	"pending",
	"ready",
	"running",
	"completed",
	"failed",
	"blocked",
	"cancelled"
]);
/** 执行者：打工人或人。 */
const workerExecutorShape = {
	name: string(),
	driver: _enum([
		"agent",
		"robot",
		"program"
	]),
	program: string().optional(),
	avatar: string().optional()
};
const storedExecutorSchema = discriminatedUnion("kind", [
	object({
		kind: literal("worker"),
		...workerExecutorShape
	}).passthrough(),
	object({
		kind: literal("robot"),
		...workerExecutorShape
	}).passthrough(),
	object({ kind: literal("human") }).passthrough(),
	object({
		kind: literal("session"),
		sessionId: string()
	}).passthrough()
]);
/** 承办者。 */
const claimantSchema = object({
	kind: _enum([
		"human",
		"worker",
		"assistant",
		"robot"
	]),
	name: string(),
	sessionId: string().nullable()
}).passthrough();
/** 启动者。 */
const starterSchema = discriminatedUnion("kind", [object({ kind: literal("human") }).passthrough(), object({
	kind: literal("session"),
	sessionId: string()
}).passthrough()]);
/** 任务结果。 */
const taskResultSchema = object({
	output: unknown().nullable(),
	text: string(),
	textBytes: number().int().nonnegative(),
	textFile: string().nullable(),
	attachmentIds: array(string())
}).passthrough();
/** 工作流版本快照。 */
const workflowVersionSchema = object({
	version: number().int().positive(),
	definition: looseObject,
	createdAt: string()
}).passthrough();
/** workflows 表记录。 */
const workflowRecordSchema = object({
	id: string().min(1),
	name: string(),
	description: string(),
	status: workflowStatusSchema,
	latestVersion: number().int().positive(),
	versions: record(string(), workflowVersionSchema),
	jobSeq: number().int().nonnegative(),
	createdAt: string(),
	updatedAt: string()
}).passthrough();
/** jobs 表记录。 */
const jobRecordSchema = object({
	id: string().min(1),
	seq: number().int().positive(),
	workflowId: string().min(1),
	workflowVersion: number().int().positive(),
	workflowName: string(),
	workflowDescription: string(),
	definition: looseObject,
	status: jobStatusSchema,
	starter: starterSchema,
	input: object({
		raw: unknown(),
		structured: unknown().optional()
	}).passthrough(),
	inputSummary: string(),
	error: string().nullable(),
	createdAt: string(),
	updatedAt: string(),
	finishedAt: string().nullable()
}).passthrough();
/** tasks 表记录。 */
const taskRecordSchema = object({
	id: string().min(1),
	jobId: string().min(1),
	position: string().min(1),
	type: string().min(1),
	payload: unknown(),
	deps: array(string()),
	status: taskStatusSchema,
	createdBy: object({
		taskId: string(),
		position: string()
	}).passthrough().nullable(),
	assignee: storedExecutorSchema,
	claimant: claimantSchema.nullable(),
	attemptIds: array(string()),
	result: taskResultSchema.nullable(),
	error: string().nullable(),
	assistantBlocked: boolean(),
	createdAt: string(),
	startedAt: string().nullable(),
	finishedAt: string().nullable(),
	updatedAt: string()
}).passthrough();
/** attempts 表记录。 */
const attemptRecordSchema = object({
	id: string().min(1),
	jobId: string().min(1),
	taskId: string().min(1),
	sessionId: string().nullable(),
	startSeq: number().int().nonnegative().nullable(),
	status: _enum([
		"running",
		"completed",
		"failed",
		"cancelled"
	]),
	stopReason: string().nullable(),
	error: string().nullable(),
	promptFile: string().nullable(),
	startedAt: string(),
	finishedAt: string().nullable()
}).passthrough();
/** attachments 表记录。 */
const attachmentRecordSchema = object({
	id: string().min(1),
	jobId: string().min(1),
	name: string(),
	bytes: number().int().nonnegative(),
	mime: string(),
	sha256: string(),
	description: string(),
	sourceTaskId: string().min(1),
	sourcePositionId: string().min(1),
	createdBy: string(),
	createdAt: string(),
	path: string(),
	tags: array(string()).optional()
}).passthrough();
/**
* `buka-workflow` 域声明。表记录类型与 `domain/types.ts` 的 TS 接口一一对应；
* zod 输出只用于运行时校验，消费方仍用 TS 接口。
*/
const workflowDomain = defineDomain({
	name: WORKFLOW_DOMAIN_NAME,
	version: 2,
	compatibleVersions: [1],
	layout: "per-record",
	tables: {
		workflows: domainTable(workflowRecordSchema),
		jobs: domainTable(jobRecordSchema),
		tasks: domainTable(taskRecordSchema),
		attempts: domainTable(attemptRecordSchema),
		attachments: domainTable(attachmentRecordSchema)
	}
});
// .build/workflows/store/index.js
/**
* 业务存储：`ctx.storageDomain` 上的 workflows / jobs / tasks / attempts /
* attachments 读写，以及 per-job 串行队列与作业目录。
*
* 记录全部是不可变数据：更新一律用表句柄的原子 `update`（传入纯函数），
* 或构造新记录 `put`。读是同步内存读，写返回时已落盘。
*
* 本模块不 import 任何 DSH 服务类型；`openWorkflowStore`（`store/open.ts`）
* 负责把真实宿主域接进来，单测直接传内存实现。
*
* @module @buka/dsh-plugin-workflows/store
*/
/** 把术语改名前的 `kind: "robot"` 归一成 `worker`；其它记录原样返回。 */
function normalizeStoredExecutor(executor) {
	if (executor === null || typeof executor !== "object") return executor;
	if (executor.kind !== "robot") return executor;
	const record = executor;
	const driver = record.driver === "robot" || record.driver === "program" ? "robot" : "agent";
	return {
		kind: "worker",
		name: record.name,
		driver,
		...record.program === void 0 ? {} : { program: record.program },
		...record.avatar === void 0 ? {} : { avatar: record.avatar }
	};
}
/** 把术语改名前的承办者 `kind: "robot"` 归一成 `worker`。 */
function normalizeClaimant(claimant) {
	if (claimant === null || claimant.kind !== "robot") return claimant;
	return {
		...claimant,
		kind: "worker"
	};
}
/** 把定义快照里岗位执行者的 `kind: "robot"` 归一成 `worker`。 */
function normalizeDefinitionExecutors(definition) {
	if (definition === null || typeof definition !== "object" || !Array.isArray(definition.positions)) return definition;
	let changed = false;
	const positions = definition.positions.map((position) => {
		if (position.executor.kind !== "robot") return position;
		changed = true;
		return {
			...position,
			executor: {
				kind: "worker",
				name: position.executor.name
			}
		};
	});
	return changed ? {
		...definition,
		positions
	} : definition;
}
/** 存储根对象。 */
var WorkflowStore = class {
	domain;
	dataDir;
	logger;
	queue = new KeyedQueue();
	constructor(options) {
		this.domain = options.domain;
		this.dataDir = options.dataDir;
		this.logger = options.logger;
	}
	/** 存储域版本；迁移入口在 `init` 里按它检查。 */
	get domainVersion() {
		return 2;
	}
	/**
	* 把术语改名前的旧记录（执行者 / 承办者 `kind: "robot"`、driver `"program"`）
	* 归一成当前取值。只改标记为旧值的记录，幂等；迁移后字段与新建记录一致。
	*/
	async normalizeLegacyWorkerKinds() {
		let tasks = 0;
		for (const [id, record] of this.domain.table("tasks").entries()) {
			const assignee = normalizeStoredExecutor(record.assignee);
			const claimant = normalizeClaimant(record.claimant);
			if (assignee === record.assignee && claimant === record.claimant) continue;
			await this.domain.table("tasks").update(id, (current) => ({
				...current,
				assignee,
				claimant
			}));
			tasks += 1;
		}
		let jobs = 0;
		for (const [id, record] of this.domain.table("jobs").entries()) {
			const definition = normalizeDefinitionExecutors(record.definition);
			if (definition === record.definition) continue;
			await this.domain.table("jobs").update(id, (current) => ({
				...current,
				definition
			}));
			jobs += 1;
		}
		let workflows = 0;
		for (const [id, record] of this.domain.table("workflows").entries()) {
			let changed = false;
			const versions = {};
			for (const [version, snapshot] of Object.entries(record.versions)) {
				const definition = normalizeDefinitionExecutors(snapshot.definition);
				if (definition !== snapshot.definition) changed = true;
				versions[version] = {
					...snapshot,
					definition
				};
			}
			if (!changed) continue;
			await this.domain.table("workflows").update(id, (current) => ({
				...current,
				versions
			}));
			workflows += 1;
		}
		if (tasks > 0 || jobs > 0 || workflows > 0) this.logger?.info?.(`buka-workflows: normalized legacy worker fields (${tasks} task(s), ${jobs} job(s), ${workflows} workflow(s))`);
	}
	/** 打开域之后的初始化：键唯一性、旧草稿启用、作业编号回填。 */
	async init() {
		for (const [key, record] of this.domain.table("workflows").entries()) if (key !== record.id) throw new Error(`workflows: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("jobs").entries()) if (key !== record.id) throw new Error(`jobs: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("tasks").entries()) if (key !== record.id) throw new Error(`tasks: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("attempts").entries()) if (key !== record.id) throw new Error(`attempts: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("attachments").entries()) if (key !== record.id) throw new Error(`attachments: stored key "${key}" differs from record id`);
		await this.normalizeLegacyWorkerKinds();
		let promoted = 0;
		for (const [id, record] of this.domain.table("workflows").entries()) {
			if (record.status !== "draft") continue;
			await this.domain.table("workflows").update(id, (current) => ({
				...current,
				status: "active"
			}));
			promoted += 1;
		}
		if (promoted > 0) this.logger?.info?.(`buka-workflows: enabled ${promoted} legacy draft workflow(s)`);
		const maxSeq = /* @__PURE__ */ new Map();
		for (const [, job] of this.domain.table("jobs").entries()) maxSeq.set(job.workflowId, Math.max(maxSeq.get(job.workflowId) ?? 0, job.seq));
		for (const [workflowId, seq] of maxSeq) {
			const workflow = this.domain.table("workflows").get(workflowId);
			if (workflow === void 0) {
				this.logger?.warn?.(`buka-workflows: job ${workflowId} has no workflow record`);
				continue;
			}
			if (workflow.jobSeq >= seq) continue;
			await this.domain.table("workflows").update(workflowId, (current) => ({
				...current,
				jobSeq: seq,
				updatedAt: nowIso()
			}));
		}
	}
	/**
	* 关闭存储域。
	*
	* @returns 无返回值
	*/
	async close() {
		await this.domain.close();
	}
	/**
	* 新建一条工作流（版本 1，默认启用）。
	*
	* @param input 名称、描述与定义
	* @returns 新建的记录
	*/
	async createWorkflow(input) {
		const createdAt = nowIso();
		const versionRecord = {
			version: 1,
			definition: input.definition,
			createdAt
		};
		const record = {
			id: newWorkflowId(),
			name: input.name,
			description: input.description,
			status: input.status ?? "active",
			latestVersion: 1,
			versions: { "1": versionRecord },
			jobSeq: 0,
			createdAt,
			updatedAt: createdAt
		};
		await this.domain.table("workflows").put(record.id, record);
		return record;
	}
	/**
	* 取一条工作流记录。
	*
	* @param workflowId 工作流 id
	* @returns 记录；不存在时是 undefined
	*/
	getWorkflow(workflowId) {
		return this.domain.table("workflows").get(workflowId);
	}
	/**
	* 全部工作流记录（按更新时间倒序）。
	*
	* @returns 工作流记录
	*/
	listWorkflows() {
		return [...this.domain.table("workflows").entries()].map(([, record]) => record).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}
	/**
	* 保存一个工作流新版本；名称 / 描述同步为最新定义里的值。
	*
	* @param workflowId 工作流 id
	* @param definition 已校验的定义
	* @returns 更新后的记录
	* @throws 工作流不存在时抛出
	*/
	async saveWorkflowVersion(workflowId, definition) {
		const updatedAt = nowIso();
		return await this.domain.table("workflows").update(workflowId, (current) => {
			const version = current.latestVersion + 1;
			return {
				...current,
				latestVersion: version,
				versions: {
					...current.versions,
					[String(version)]: {
						version,
						definition,
						createdAt: updatedAt
					}
				},
				name: definition.name,
				description: definition.description ?? "",
				updatedAt
			};
		});
	}
	/**
	* 改工作流状态；`retired` 表示停用，`active` 表示可用。
	*
	* @param workflowId 工作流 id
	* @param status 新状态
	* @returns 更新后的记录
	*/
	async setWorkflowStatus(workflowId, status) {
		return await this.domain.table("workflows").update(workflowId, (current) => ({
			...current,
			status,
			updatedAt: nowIso()
		}));
	}
	/**
	* 停用 / 重新启用；停用后状态是 `retired`。
	*
	* @param workflowId 工作流 id
	* @param active 是否可用
	* @returns 更新后的记录
	*/
	async activateWorkflow(workflowId, active) {
		return await this.setWorkflowStatus(workflowId, active ? "active" : "retired");
	}
	/**
	* 取工作流的某个版本（默认最新）。
	*
	* @param workflowId 工作流 id
	* @param version 版本号；省略取最新
	* @returns 工作流与版本记录；不存在时是 null
	*/
	readWorkflowVersion(workflowId, version) {
		const record = this.getWorkflow(workflowId);
		if (record === void 0) return null;
		const target = version ?? record.latestVersion;
		const versionRecord = record.versions[String(target)];
		if (versionRecord === void 0) return null;
		return {
			record,
			version: target,
			versionRecord
		};
	}
	/**
	* 在当前工作流内分配下一个作业编号（原子递增）。
	*
	* @param workflowId 工作流 id
	* @returns 递增后的作业编号
	*/
	async allocateJobSeq(workflowId) {
		return (await this.domain.table("workflows").update(workflowId, (current) => ({
			...current,
			jobSeq: current.jobSeq + 1,
			updatedAt: nowIso()
		}))).jobSeq;
	}
	/**
	* 统计工作流下的作业数。
	*
	* @param workflowId 工作流 id
	* @returns 作业数
	*/
	countJobs(workflowId) {
		let count = 0;
		for (const [, job] of this.domain.table("jobs").entries()) if (job.workflowId === workflowId) count += 1;
		return count;
	}
	/**
	* 插入一条作业记录。
	*
	* @param job 作业记录
	* @returns 无返回值
	*/
	async insertJob(job) {
		await this.domain.table("jobs").put(job.id, job);
	}
	/**
	* 取作业记录。
	*
	* @param jobId 作业 id
	* @returns 作业；不存在时是 undefined
	*/
	getJob(jobId) {
		return this.domain.table("jobs").get(jobId);
	}
	/**
	* 列出某个工作流下的作业（按编号倒序）。
	*
	* @param workflowId 工作流 id
	* @returns 作业记录
	*/
	listJobs(workflowId) {
		const jobs = [];
		for (const [, job] of this.domain.table("jobs").entries()) if (job.workflowId === workflowId) jobs.push(job);
		return jobs.sort((left, right) => right.seq - left.seq);
	}
	/**
	* 全部作业（恢复时用）。
	*
	* @returns 作业记录
	*/
	allJobs() {
		return [...this.domain.table("jobs").entries()].map(([, job]) => job);
	}
	/**
	* 原子更新作业记录。
	*
	* @param jobId 作业 id
	* @param update 纯函数：当前记录 → 新记录
	* @returns 新记录
	*/
	async updateJob(jobId, update) {
		return await this.domain.table("jobs").update(jobId, update);
	}
	/**
	* 插入一条任务记录。
	*
	* @param task 任务记录
	* @returns 无返回值
	*/
	async insertTask(task) {
		await this.domain.table("tasks").put(task.id, task);
	}
	/**
	* 取任务记录。
	*
	* @param taskId 任务 id
	* @returns 任务；不存在时是 undefined
	*/
	getTask(taskId) {
		return this.domain.table("tasks").get(taskId);
	}
	/**
	* 列出某个作业的全部任务（按创建时间升序）。
	*
	* @param jobId 作业 id
	* @returns 任务记录
	*/
	listTasks(jobId) {
		const tasks = [];
		for (const [, task] of this.domain.table("tasks").entries()) if (task.jobId === jobId) tasks.push(task);
		return tasks.sort((left, right) => left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt));
	}
	/**
	* 原子更新一条任务记录。
	*
	* @param taskId 任务 id
	* @param update 纯函数：当前记录 → 新记录
	* @returns 新记录
	*/
	async updateTask(taskId, update) {
		return await this.domain.table("tasks").update(taskId, update);
	}
	/**
	* 插入一条执行记录。
	*
	* @param attempt 执行记录
	* @returns 无返回值
	*/
	async insertAttempt(attempt) {
		await this.domain.table("attempts").put(attempt.id, attempt);
	}
	/**
	* 取执行记录。
	*
	* @param attemptId 执行记录 id
	* @returns 执行记录；不存在时是 undefined
	*/
	getAttempt(attemptId) {
		return this.domain.table("attempts").get(attemptId);
	}
	/**
	* 按 id 顺序列出某个任务的执行记录。
	*
	* @param taskId 任务 id
	* @returns 执行记录
	*/
	listAttempts(taskId) {
		const attempts = [];
		for (const [, attempt] of this.domain.table("attempts").entries()) if (attempt.taskId === taskId) attempts.push(attempt);
		return attempts.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
	}
	/**
	* 原子更新一条执行记录。
	*
	* @param attemptId 执行记录 id
	* @param update 纯函数：当前记录 → 新记录
	* @returns 新记录
	*/
	async updateAttempt(attemptId, update) {
		return await this.domain.table("attempts").update(attemptId, update);
	}
	/**
	* 插入一条附件元数据。
	*
	* @param attachment 附件记录
	* @returns 无返回值
	*/
	async insertAttachment(attachment) {
		await this.domain.table("attachments").put(attachment.id, attachment);
	}
	/**
	* 取附件元数据。
	*
	* @param attachmentId 附件 id
	* @returns 附件；不存在时是 undefined
	*/
	getAttachment(attachmentId) {
		return this.domain.table("attachments").get(attachmentId);
	}
	/**
	* 列出某个作业的附件库（按创建时间升序）。
	*
	* @param jobId 作业 id
	* @returns 附件记录
	*/
	listAttachments(jobId) {
		const attachments = [];
		for (const [, attachment] of this.domain.table("attachments").entries()) if (attachment.jobId === jobId) attachments.push(attachment);
		return attachments.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}
	/**
	* 串行执行一个作业的状态变更。
	*
	* @param jobId 作业 id
	* @param task 异步任务
	* @returns 任务结果
	*/
	runExclusive(jobId, task) {
		return this.queue.run(jobId, task);
	}
	/**
	* 当前有排队任务的作业数（诊断 / 测试用）。
	*
	* @returns 队列数量
	*/
	get queueSize() {
		return this.queue.size;
	}
	/**
	* 计算作业目录布局。
	*
	* @param jobId 作业 id
	* @returns 目录布局
	*/
	paths(jobId) {
		return jobPaths(this.dataDir, jobId);
	}
	/**
	* 建好作业目录。
	*
	* @param jobId 作业 id
	* @returns 目录布局
	*/
	async ensureJobDirectories(jobId) {
		const paths = this.paths(jobId);
		await ensureJobDirectories(paths);
		return paths;
	}
	/**
	* 写一份大文本到作业目录。
	*
	* @param jobId 作业 id
	* @param kind prompt / 结果
	* @param name 文件名
	* @param text 文本
	* @returns 相对作业根目录的路径
	*/
	async writeText(jobId, kind, name, text) {
		return await writeJobText(this.paths(jobId), kind, name, text);
	}
	/**
	* 读一份作业目录里的大文本。
	*
	* @param jobId 作业 id
	* @param relative 相对路径
	* @returns 文本；不存在时是 null
	*/
	async readText(jobId, relative) {
		return await readJobText(this.paths(jobId), relative);
	}
	/**
	* 校验并返回一个安全的作业 id（路由参数用）。
	*
	* @param jobId 作业 id
	* @returns 原值
	*/
	assertJobId(jobId) {
		return assertSafeSegment(jobId, "job id");
	}
};
// .build/workflows/store/open.js
/**
* 从宿主 `ctx.storageDomain` 打开 `buka-workflow` 域，构造 `WorkflowStore`。
*
* storageDomain 不放进 cordis `inject`：缺少它的组合里插件仍应加载，只在真正
* 需要存储时给出明确错误。打开后把 `Domain.close()` 挂到插件生命周期上。
*
* @module @buka/dsh-plugin-workflows/store/open
*/
/**
* 打开存储域并初始化。
*
* @param ctx 插件上下文
* @param options 数据目录与日志
* @returns 已初始化的存储
* @throws 宿主缺少 storageDomain 服务 / 打开失败时抛出
*/
function openWorkflowStore(ctx, options) {
	const facility = (() => {
		try {
			return ctx.get("storageDomain");
		} catch {
			return;
		}
	})();
	if (facility === void 0 || facility === null || typeof facility.open !== "function") return Promise.reject(/* @__PURE__ */ new Error("the host storage domain service is unavailable in this composition (ctx.storageDomain is missing); update DeepSeek Harness or enable the dsh-storage-domain plugin"));
	let domain;
	ctx.effect(() => () => {
		if (domain !== void 0) domain.close().catch(() => void 0);
	}, "buka-workflows: close workflow storage domain");
	return (async () => {
		domain = await facility.open(workflowDomain);
		const store = new WorkflowStore({
			domain,
			dataDir: options.dataDir,
			logger: options.logger
		});
		try {
			await store.init();
		} catch (error) {
			await domain.close().catch(() => void 0);
			domain = void 0;
			throw error;
		}
		return store;
	})();
}
// .build/workflows/tools/index.js
/**
* 模型工具注册（`.tmp/workflow-v4-spec.md` §13.2）。
*
* 可见性：
* - 工作流定义工具只对配置点名的编排 preset 根会话可见；
* - 启动 / 状态 / 取消工具对普通会话可见（启动者 = 当前会话）；
* - 执行工具（建任务 / 提交结果 / 看板 / 任务 / 附件）只对引擎创建的任务会话、
*   助理会话与启动者会话可见，并在 `execute` 里按会话再校验一次。
*
* @module @buka/dsh-plugin-workflows/tools
*/
/** 把已知 JSON 兼容的运行时对象标成工具输出的 json 类型。 */
function toolJson(value) {
	return value;
}
/** 一段模型可读文本。 */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** 取调用会话 id。 */
function sessionIdOf(context) {
	return typeof context.agent?.id === "string" ? context.agent.id : "";
}
/** 定义格式的简短帮助（给编排 agent）。 */
const DEFINITION_HELP = `Workflow definition (v4) JSON shape:
{
  "version": 4, "name": "...", "description": "...",
  "budgets": { "maxTasks": 200, "maxDurationHours": 72 },
  "start": {
    "task": {
      "payload": <JSON Schema object: the raw input form>,
      "output":  <JSON Schema object: the first structured input>
    },
    "next": [
      { "position": "<position id>", "type": "<task type id>",
        "payload": { ...templates... }, "dependsOn": ["$start"] }
    ]
  },
  "end": { "task": { "payload": <JSON Schema object: the final deliverable> } },
  "positions": [
    { "id": "dev", "label": "研发", "description": "...",
      "executor": { "kind": "worker", "name": "<registered worker>" } | { "kind": "human" },
      "taskTypes": [
        { "id": "dev.implement", "label": "开发", "description": "...",
          "payload": <JSON Schema object>, "output": <JSON Schema object>,
          "requires": [{ "types": ["qa.prepare"] }], "assistant": "<assistant worker>" | null,
          "mode": "plan" | null }
      ] }
  ],
  "edges": [
    { "from": "start", "to": "dev" },
    { "from": "qa", "to": "dev", "types": ["dev.rework"], "back": true },
    { "from": "deploy", "to": "end" }
  ]
}
Rules: schemas use the restricted subset (type/description/properties/required/additionalProperties/items/enum/const/oneOf; top-level type must be "object"). Every position must be reachable from start and able to reach end. A cycle needs at least one explicitly marked back edge; a back edge must close a cycle. start.next entries must depend on "$start" and target a direct successor of start. Task payload templates may reference {{start.output.<path>}}, {{task.<id>.output.<path>}} and {{task.<id>.text}}. Edges carry no prompt: instructions live in task payloads and task type contracts.`;
/**
* 注册全部工作流工具。
*
* @param deps 上下文、引擎 getter 与可见性条件
*/
function registerWorkflowTools(deps) {
	const { ctx, ready, orchestratorVisible, executionVisible, starterVisible, assertOrchestrator } = deps;
	/** 注册一个工具。 */
	const register = (tool, when) => {
		ctx.tools.register(tool, when === void 0 ? void 0 : { when });
	};
	register(defineTool({
		name: "buka_workflow_save",
		description: `Validate and save a workflow definition as a new version. New workflows are enabled immediately. Only the orchestration preset can see this tool. Pass the complete v4 definition; without "id" a new workflow is created.\n\n${DEFINITION_HELP}`,
		parameters: {
			definition: {
				type: "json",
				required: true,
				description: "The complete workflow v4 definition object."
			},
			id: {
				type: "string",
				description: "Existing workflow id; omit to create a new workflow."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					workflowId: {
						type: "string",
						required: true
					},
					version: {
						type: "number",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(`已保存工作流「${String(value.name)}」（${String(value.workflowId)}，版本 ${String(value.version)}，状态 ${String(value.status)}）。`)
		},
		async execute(args, exec) {
			assertOrchestrator(exec.agent);
			const workflow = await (await ready()).saveWorkflow({
				definition: args.definition,
				...typeof args.id === "string" && args.id.trim() !== "" ? { workflowId: args.id.trim() } : {}
			});
			return {
				workflowId: workflow.id,
				version: workflow.latestVersion,
				name: workflow.name,
				status: workflow.status
			};
		}
	}), orchestratorVisible);
	register(defineTool({
		name: "buka_workflow_list",
		description: "List saved workflows (id, name, version, status, job count). Use buka_workflow_get to read a full definition.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { workflows: {
					type: "json",
					required: true
				} }
			},
			render: (_args, value) => text(Array.isArray(value.workflows) && value.workflows.length > 0 ? value.workflows.map((workflow) => {
				const record = workflow;
				return `- ${String(record.id)}「${String(record.name)}」v${String(record.version)} ${String(record.status)}（${String(record.jobCount)} 个作业）`;
			}).join("\n") : "还没有保存过工作流。")
		},
		async execute(_args, exec) {
			assertOrchestrator(exec.agent);
			return { workflows: toolJson((await ready()).listWorkflowSummaries()) };
		}
	}), orchestratorVisible);
	register(defineTool({
		name: "buka_workflow_get",
		description: "Read one saved workflow definition (optionally a specific version).",
		parameters: {
			id: {
				type: "string",
				required: true,
				description: "Workflow id."
			},
			version: {
				type: "number",
				description: "Version number; defaults to the latest."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					workflow: {
						type: "json",
						required: true
					},
					jobs: {
						type: "json",
						required: true
					}
				}
			},
			render: (_args, value) => {
				const record = value.workflow;
				const definition = record.definition;
				return text(`工作流 ${String(record.id)}「${String(record.name)}」v${String(record.version)}（${String(record.status)}）\n\n${JSON.stringify(definition, null, 2)}`);
			}
		},
		async execute(args, exec) {
			assertOrchestrator(exec.agent);
			const detail = await (await ready()).readWorkflowDetail(args.id, typeof args.version === "number" ? args.version : void 0);
			if (detail === null) throw new Error(`workflow not found: ${args.id}`);
			return {
				workflow: toolJson(detail.workflow),
				jobs: toolJson(detail.jobs)
			};
		}
	}), orchestratorVisible);
	register(defineTool({
		name: "buka_job_start",
		description: "Start a workflow job from this session. The starter is this session: the start task comes back as a new message in this conversation, asking you to convert the raw request into the first structured input and submit it with buka_task_complete. Use /job instead when the host supports commands.",
		parameters: {
			workflowId: {
				type: "string",
				required: true,
				description: "Workflow id to start."
			},
			request: {
				type: "string",
				required: true,
				description: "The raw request / input text."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					jobId: {
						type: "string",
						required: true
					},
					seq: {
						type: "number",
						required: true
					},
					workflowName: {
						type: "string",
						required: true
					},
					message: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(String(value.message))
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_job_start must be called from a session");
			const job = await (await ready()).createJobFromSession({
				workflowId: args.workflowId,
				rawInput: { request: args.request },
				sessionId
			});
			return {
				jobId: job.id,
				seq: job.seq,
				workflowName: job.workflowName,
				message: `已创建作业 #${job.seq}「${job.workflowName}」。启动任务会作为一条新消息发到本会话；按它给的结构化输入契约调用 buka_task_complete 提交后，作业进入看板调度。`
			};
		}
	}));
	register(defineJobStatusTool(ready), starterVisible);
	register(defineJobCancelTool(ready), starterVisible);
	register(defineTaskCreateTool(ready), executionVisible);
	register(defineTaskCompleteTool(ready), executionVisible);
	register(defineBoardTool(ready), executionVisible);
	register(defineTaskGetTool(ready), executionVisible);
	register(defineAttachmentsTool(ready), executionVisible);
}
/** 作业状态工具。 */
function defineJobStatusTool(ready) {
	return defineTool({
		name: "buka_job_status",
		description: "Read one workflow job (status, task counts) or, without jobId, the job started by this session.",
		parameters: { jobId: {
			type: "string",
			description: "Job id; defaults to this session’s job."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					job: {
						type: "json",
						required: true
					},
					tasks: {
						type: "json",
						required: true
					}
				}
			},
			render: (_args, value) => {
				const job = value.job;
				const tasks = Array.isArray(value.tasks) ? value.tasks : [];
				const counts = /* @__PURE__ */ new Map();
				for (const task of tasks) {
					const status = String(task.status);
					counts.set(status, (counts.get(status) ?? 0) + 1);
				}
				return text(`作业 #${String(job.seq)}「${String(job.workflowName)}」状态 ${String(job.status)}\n任务：${[...counts].map(([status, count]) => `${status}=${count}`).join(" ") || "（无）"}`);
			}
		},
		async execute(args, exec) {
			const engine = await ready();
			const sessionId = sessionIdOf(exec);
			const jobId = typeof args.jobId === "string" && args.jobId.trim() !== "" ? args.jobId.trim() : engine.jobIdForSession(sessionId);
			if (jobId === null) throw new Error("this session has not started a workflow job");
			const detail = await engine.jobDetail(jobId);
			if (detail === null) throw new Error(`job not found: ${jobId}`);
			return {
				job: toolJson(detail.job),
				tasks: toolJson(detail.tasks)
			};
		}
	});
}
/** 取消作业工具。 */
function defineJobCancelTool(ready) {
	return defineTool({
		name: "buka_job_cancel",
		description: "Cancel a running workflow job started by this session (or the given job id).",
		parameters: { jobId: {
			type: "string",
			description: "Job id; defaults to this session’s job."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					jobId: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(`作业 ${String(value.jobId)} 已取消（状态 ${String(value.status)}）。`)
		},
		async execute(args, exec) {
			const engine = await ready();
			const sessionId = sessionIdOf(exec);
			const jobId = typeof args.jobId === "string" && args.jobId.trim() !== "" ? args.jobId.trim() : engine.jobIdForSession(sessionId);
			if (jobId === null) throw new Error("this session has not started a workflow job");
			if (!engine.canViewJob(sessionId, jobId)) throw new Error("this session cannot cancel that job");
			const job = await engine.cancelJob(jobId);
			return {
				jobId: job.id,
				status: job.status
			};
		}
	});
}
/** 派生任务工具。 */
function defineTaskCreateTool(ready) {
	return defineTool({
		name: "buka_task_create",
		description: "Create a task on the current job board (callable any number of times while executing a task). The engine validates the target position, task type, edge whitelist, payload schema, dependencies (must exist in this job, no cycles) and the workflow budget.",
		parameters: {
			position: {
				type: "string",
				required: true,
				description: "Target position id (or \"end\" for the end task)."
			},
			type: {
				type: "string",
				required: true,
				description: "Task type id declared by the target position (\"end\" for the end task)."
			},
			payload: {
				type: "json",
				required: true,
				description: "Task payload matching the task type payload schema; templates are rendered when the task starts."
			},
			deps: {
				type: "array",
				items: { type: "string" },
				description: "Task ids in this job that must complete first."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					taskId: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(`已创建任务 ${String(value.taskId)}（状态 ${String(value.status)}）。`)
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_task_create must be called from a task session");
			const task = await (await ready()).createTaskFromSession({
				sessionId,
				position: args.position,
				type: args.type,
				payload: args.payload ?? {},
				deps: Array.isArray(args.deps) ? args.deps : []
			});
			return {
				taskId: task.id,
				status: task.status
			};
		}
	});
}
/** 提交结果工具。 */
function defineTaskCompleteTool(ready) {
	return defineTool({
		name: "buka_task_complete",
		description: "Submit the structured result of the task this session is executing. The engine validates `output` against the task type output schema (invalid output is returned as an error so you can correct it in the same turn), copies any attachments into the job attachment library, and advances the workflow.",
		parameters: {
			output: {
				type: "json",
				required: true,
				description: "Structured result matching the task type output schema."
			},
			text: {
				type: "string",
				description: "Optional human-readable summary."
			},
			attachments: {
				type: "array",
				items: { type: "json" },
				description: "Optional files to archive: strings or { path, name?, description? }. Paths are relative to your workspace."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					taskId: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						required: true
					},
					jobStatus: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(`已提交任务 ${String(value.taskId)}（${String(value.status)}）；作业状态 ${String(value.jobStatus)}。`)
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_task_complete must be called from a task session");
			const result = await (await ready()).completeTaskFromSession({
				sessionId,
				output: args.output ?? {},
				text: typeof args.text === "string" ? args.text : "",
				attachments: args.attachments
			});
			return {
				taskId: result.task.id,
				status: result.task.status,
				jobStatus: result.job.status
			};
		}
	});
}
/** 看板工具。 */
function defineBoardTool(ready) {
	return defineTool({
		name: "buka_job_board",
		description: "Read the read-only board of the job this session is executing: every task with status, dependencies, claimant and result summary. Useful to gather task ids when creating tasks across branches.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					job: {
						type: "json",
						required: true
					},
					tasks: {
						type: "json",
						required: true
					}
				}
			},
			render: (_args, value) => {
				const job = value.job;
				const tasks = Array.isArray(value.tasks) ? value.tasks : [];
				const lines = [`作业 #${String(job.seq)}「${String(job.workflowName)}」状态 ${String(job.status)}`];
				for (const task of tasks) {
					const record = task;
					lines.push(`- ${String(record.id)} ${String(record.position)}/${String(record.typeLabel)} [${String(record.status)}] deps=${Array.isArray(record.deps) ? record.deps.join(",") : ""}`);
				}
				return text(lines.join("\n"));
			}
		},
		async execute(_args, exec) {
			const sessionId = sessionIdOf(exec);
			const engine = await ready();
			const reference = engine.taskForSession(sessionId);
			if (reference === null) throw new Error("this session is not executing a workflow task");
			const detail = await engine.jobDetail(reference.jobId);
			if (detail === null) throw new Error("job not found");
			return {
				job: toolJson(detail.job),
				tasks: toolJson(detail.tasks)
			};
		}
	});
}
/** 任务读取工具。 */
function defineTaskGetTool(ready) {
	return defineTool({
		name: "buka_task_get",
		description: "Read one task of the job this session is executing: payload, dependencies, attempts, result and attachments.",
		parameters: { taskId: {
			type: "string",
			required: true,
			description: "Task id on the current job board."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { task: {
					type: "json",
					required: true
				} }
			},
			render: (_args, value) => text(JSON.stringify(value.task, null, 2))
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			const engine = await ready();
			const reference = engine.taskForSession(sessionId);
			if (reference === null) throw new Error("this session is not executing a workflow task");
			const detail = engine.taskDetail(reference.jobId, args.taskId);
			if (detail === null) throw new Error(`task not found: ${args.taskId}`);
			return { task: toolJson(detail) };
		}
	});
}
/** 附件工具。 */
function defineAttachmentsTool(ready) {
	return defineTool({
		name: "buka_job_attachments",
		description: "Search or read the attachments this task is allowed to see (its own output plus the tasks it depends on, directly or transitively). Pass no arguments to list visible attachments; pass attachmentId to read one (metadata plus bounded inline text).",
		parameters: {
			query: {
				type: "string",
				description: "Optional keyword to filter by name / description."
			},
			attachmentId: {
				type: "string",
				description: "Attachment id to read."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { attachments: {
					type: "json",
					required: true
				} }
			},
			render: (_args, value) => text(JSON.stringify(value.attachments, null, 2))
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			const engine = await ready();
			if (typeof args.attachmentId === "string" && args.attachmentId.trim() !== "") {
				const attachment = await engine.readAttachmentForSession(sessionId, args.attachmentId.trim());
				if (attachment === null) throw new Error(`attachment not found or not visible to this task: ${args.attachmentId}`);
				return { attachments: toolJson([attachment]) };
			}
			const query = typeof args.query === "string" ? args.query : "";
			return { attachments: toolJson(engine.searchAttachmentsForSession(sessionId, query)) };
		}
	});
}
// .build/workflows/index.js
/**
* `@buka/dsh-plugin-workflows` 宿主一半入口：只做装配。
*
* 工作流是持久定义，作业是运行容器；任务级看板、显式依赖、内建开始 / 结束、
* 人任务与助理都由引擎驱动。业务状态进 `ctx.storageDomain`，大文本与附件进
* 插件数据目录，旧的运行目录由 `migration.ts` 在首次启动时删除。
*
* 装配顺序：
*
* 1. 解析配置；
* 2. `ensureReady`：硬切换迁移 → 打开 storageDomain → 构造引擎 → 恢复未完成作业；
* 3. 注册工具（可见性按编排 preset / 编排工作区 / 任务会话收窄）；
* 4. 注册 `/job` 命令（宿主不支持命令注册时降级为工具）；
* 5. 注册浏览器路由。
*
* `storageDomain` 不放进 `inject`：缺少它的组合里插件仍然加载，只在真正需要
* 存储时给出明确错误。
*
* @module @buka/dsh-plugin-workflows
*/
/** Cordis 插件名；与 cordis.patch.yml 的补丁行 id 保持一致。 */
const name = "tool-buka-workflows";
/** 依赖的服务：工具注册表。其余服务（storageDomain / webServer / commands / bukaWorkers）按需可选获取。 */
const inject = ["tools"];
/**
* 装配插件。
*
* @param ctx 插件上下文
* @param config 插件配置
*/
function apply(ctx, config) {
	const options = resolveOptions(config);
	let engine;
	let ready;
	/** 引擎与存储当前实例；卸载时按登记顺序释放。 */
	ctx.effect(() => () => {
		engine?.dispose();
		engine = void 0;
	}, "buka-workflows: dispose engine");
	/**
	* 初始化：迁移 → 打开存储 → 构造引擎 → 恢复。只做一次。
	*
	* @returns 就绪的引擎
	*/
	function ensureReady() {
		ready ??= (async () => {
			await runMigrations({
				dataDir: options.dataDir,
				logger: ctx.logger
			});
			const created = new WorkflowEngine({
				ctx,
				store: await openWorkflowStore(ctx, {
					dataDir: options.dataDir,
					logger: ctx.logger
				}),
				options,
				logger: ctx.logger,
				workers: () => ctx.get("bukaWorkers") ?? null,
				delivery: createHostSessionDelivery(ctx)
			});
			engine = created;
			await created.start();
			return created;
		})();
		return ready;
	}
	ensureReady().catch((error) => {
		ctx.logger?.warn?.(`buka-workflows: 初始化工作流存储失败：${describeError$1(error)}`);
	});
	/** 判定某个 agent 能否看到 / 调用工作流定义工具（编排 preset 根会话）。 */
	function accessOf(agent) {
		return resolveWorkflowAccess({
			allowed: options.orchestratorPresets,
			allowedWorkspaces: options.orchestratorWorkspaces,
			agentId: typeof agent?.id === "string" ? agent.id : "",
			sessions: ctx.get("sessions"),
			agentPresets: ctx.get("agentPresets")
		});
	}
	/** 定义工具可见性（同步判定，供每一步的 when 使用）。 */
	const orchestratorVisible = (context) => accessOf(context.agent).visible;
	/** 执行会话可见性：该会话正在执行一条任务（启动 / agent / 助理）。 */
	const executionVisible = async (context) => {
		const sessionId = typeof context.agent?.id === "string" ? context.agent.id : "";
		if (sessionId === "") return false;
		return (await ensureReady()).taskForSession(sessionId) !== null;
	};
	/** 启动者 / 执行会话可见性：作业状态与取消。 */
	const starterVisible = async (context) => {
		const sessionId = typeof context.agent?.id === "string" ? context.agent.id : "";
		if (sessionId === "") return false;
		const current = await ensureReady();
		return current.taskForSession(sessionId) !== null || current.jobIdForSession(sessionId) !== null;
	};
	registerWorkflowTools({
		ctx,
		ready: ensureReady,
		options,
		orchestratorVisible,
		executionVisible,
		starterVisible,
		assertOrchestrator: (agent) => {
			const access = accessOf(agent);
			if (access.visible) return;
			throw new Error(`workflow definition tools are only available to the ${options.orchestratorPresets.join(" / ")} preset or to sessions started in the configured orchestrator workspaces (reason: ${access.reason})`);
		}
	});
	if (!registerJobCommand({
		ctx,
		ready: ensureReady
	})) ctx.logger?.info?.("buka-workflows: the host commands service cannot register /job; ordinary sessions can use the buka_job_start tool instead");
	registerWorkflowRoutes({
		ctx,
		ready: ensureReady
	});
}
export { Config, apply, defaultDataDir, inject, name, resolveDataDir };
