import z from "@deepseek-ai/schemastery";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { constants, createReadStream, promises } from "node:fs";
import os from "node:os";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { execFile, spawn } from "node:child_process";
// .build/workflows/access.js
/**
* 工作流工具的可见性判定。
*
* 工具本身注册在 Host 上，默认每个会话都能看到。这里把可见性收窄到配置里
* 点名的 agent preset，并且只放行该 preset 的**根会话**：由编排器 spawn 出来
* 的子会话（执行者节点）拿不到工具，避免执行者在节点里自己去开新工作流。
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
	const allowed = normalizePresets$1(input.allowed);
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
function normalizePresets$1(value) {
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
* 结构类型；发起人会话投递用宿主 `sessionController` / `agents` 的「解析 live
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
function describeError$4(error) {
	return error instanceof Error ? error.message : String(error);
}
// .build/workflows/commands/job.js
/**
* `/job` 命令：普通会话启动作业，发起人 = 当前会话。
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
				text: "/job 需要在一个会话里使用（发起人 = 当前会话）"
			};
			const raw = typeof invocation.rawInput === "string" ? invocation.rawInput.trim() : "";
			if (raw === "") return {
				kind: "success",
				text: await describeAvailableWorkflows(engine)
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
					content: { request },
					sessionId: agentId
				});
				return {
					kind: "success",
					text: `已创建作业 #${job.seq}「${job.workflowName}」，任务已进入看板调度。作业结束后最终报告会回到本会话，调用 buka_task_complete 确认收到。`
				};
			} catch (error) {
				return {
					kind: "error",
					text: error instanceof WorkflowError ? error.message : `创建工作流作业失败：${describeError$4(error)}`
				};
			}
		}
	});
	ctx.effect(() => dispose, "buka-workflows: /job command");
	return true;
}
/** 列出可用工作流与启动输入要求。 */
async function describeAvailableWorkflows(engine) {
	const workflows = (await engine.listWorkflowSummaries()).filter((workflow) => workflow.status === "active");
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
* 启动任务 id 的保留前缀，也是旧作业里启动任务的完整 id。
*
* 定义格式里用 `$start` 引用启动任务，但**记录 id 必须能当文件名**：
* storageDomain 的 json 后端按记录 id 分文件，只接受 `[a-zA-Z0-9_-]`，
* `$start` 会被宿主拒绝（`per-record key ... is not path-safe`）。新作业用
* `start-task-<jobId>`（见 `startTaskId`）；旧的作业快照仍用这个保留 id。
*/
const START_TASK_ID = "start-task";
/**
* 新作业的启动任务 id。
*
* 任务表按记录 id 做键，`START_TASK_ID` 是所有旧作业共用的保留 id：同一张
* 表里第二个作业的启动任务会覆盖第一个。新作业改用带作业 id 的键；旧作业
* 继续读 `start-task`，依赖字段不需要迁移。
*
* @param jobId 作业 id
* @returns 路径安全的启动任务 id
*/
function startTaskId(jobId) {
	return `${START_TASK_ID}-${jobId}`;
}
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
* - 附件对「产出它的任务、直接或传递依赖它的任务（下游）、发起人、看板页面」
*   可见；引擎在任务上下文与检索时按这个集合过滤。
*
* 路径安全：相对路径基于任务主体（执行者）的工作区；绝对路径必须位于工作区
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
/** 页面附件预览一次读取的 Markdown 上限：1 MiB（需完整渲染，比普通文本宽）。 */
const DEFAULT_PREVIEW_MARKDOWN_BYTES = 1048576;
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
function describeError$3(error) {
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
* 预览类型：按扩展名先划分可 inline 的图片 / PDF，Markdown 单独一类，其余交给
* 文本嗅探。
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
	if (extension === ".md" || extension === ".markdown") return {
		kind: "markdown",
		mime: "text/markdown"
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
function isInside$1(root, candidate) {
	const relative = path.relative(root, candidate);
	return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
/**
* 解析并校验附件源文件。
*
* @param request 附件请求
* @param workspace 执行者工作区（可省略）
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
		throw new Error(`attachment source "${display}" is not readable: ${describeError$3(error)}`, { cause: error });
	}
	if (typeof workspace === "string" && workspace !== "" && !path.isAbsolute(request.path)) {
		let root;
		try {
			root = await promises.realpath(workspace);
		} catch {
			throw new Error(`attachment source "${display}" is outside the worker workspace`);
		}
		if (!isInside$1(root, source)) throw new Error(`attachment source "${display}" is outside the worker workspace`);
	}
	let stat;
	try {
		stat = await promises.stat(source);
	} catch (error) {
		throw new Error(`attachment source "${display}" is not readable: ${describeError$3(error)}`, { cause: error });
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
// .build/workflows/domain/identity.js
/**
* 执行者引用的读取：v8 写 `id`，v7 作业快照写 `name`。
*
* 阶段 1 只做身份模型：旧快照里的 `name` 字段保存的就是当时的引用键（老打工
* 人的标识符 = 原名字），所以读取时按 `id ?? name` 兜底即可，不需要迁移作业
* 快照。展示名来自 workers 登记表，不从这里读。
*
* @module @buka/dsh-plugin-workflows/domain/identity
*/
/**
* 取一条执行者引用的标识符。
*
* @param value 主体、任务主体或交回方式
* @returns 标识符；两边都为空时是 null
*/
function workerRef(value) {
	if (value === null || value === void 0) return null;
	const id = typeof value.id === "string" ? value.id.trim() : "";
	if (id !== "") return id;
	const name = typeof value.name === "string" ? value.name.trim() : "";
	return name === "" ? null : name;
}
/**
* 取岗位主体的标识符。
*
* @param executor 岗位主体
* @returns 执行者标识符；人是 null
*/
function executorRef(executor) {
	if (executor === null || executor === void 0) return null;
	if (executor.kind === "human") return null;
	return workerRef(executor);
}
/**
* 取任务钉住的主体的标识符。
*
* @param executor 任务主体
* @returns 执行者标识符；人或会话是 null
*/
function storedExecutorRef(executor) {
	if (executor === null || executor === void 0) return null;
	const kind = executor.kind;
	if (kind === "human" || kind === "session") return null;
	return workerRef(executor);
}
/**
* 取交回方式里助理的标识符。
*
* @param delivery 交回方式
* @returns 助理标识符；交回发起人时是 null
*/
function deliveryWorkerRef(delivery) {
	if (delivery === null || delivery === void 0 || delivery.kind !== "assistant") return null;
	return workerRef(delivery);
}
// .build/workflows/json-schema.js
/**
* 受限 JSON Schema 子集：任务内容、动作表单与作业输入共用的声明格式。
*
* 工作流 v7 里任务类型用 `content` 声明创建者必须提供的任务内容，人任务类型
* 的动作用 `input` 声明表单，开始 / 结束节点也各自声明任务内容格式。本模块
* 只处理声明与值之间的纯逻辑（不读盘、不依赖 DSH）：
*
* - `parseJsonSchema`：定义校验时使用的 JSON Schema 子集检查。工作流定义
*   由编排 agent 生成，所以这里只放行一组可移植关键字，避免把任意 schema
*   直接当成工具参数；
* - `schemaProblems`：运行期按声明的 schema 校验任务内容与动作表单；
* - `resolveSchemaPath`：定义校验时检查 `{{content.<path>}}` 这类模板引用
*   的路径是否真的在目标 schema 里；
* - `schemaJson`：给提示词用的 schema 序列化。
*
* 本模块不修改调用方传入的对象。
*
* @module @buka/dsh-plugin-workflows/json-schema
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
/** 运行期校验的递归深度上限（定义已经过 parseJsonSchema，正常不会触发）。 */
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
* 校验并规范化一份 schema。
*
* 顶层默认必须是 `type: "object"`；任务内容允许其它类型，所以任务类型与结束
* 节点的 `content` 用 `root: "value"` 解析。返回只包含合法关键字的新对象；
* 无法构成 schema 时返回 null（错误已记录）。
*
* @param raw 声明的 schema
* @param path 出错时使用的路径前缀
* @param fail 记录错误的回调
* @param options 顶层类型约束
* @returns 规范化后的 schema；不合法时是 `null`
*/
function parseJsonSchema(raw, path, fail, options = {}) {
	if (!isPlainObject$1(raw)) {
		fail(path, "must be a JSON Schema object");
		return null;
	}
	if ((options.root ?? "object") === "object" && raw.type !== "object") {
		fail(`${path}.type`, "must be \"object\": forms and job input are JSON objects");
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
function resolveSchemaPath(schema, segments) {
	let current = schema;
	const walked = [];
	for (const segment of segments) {
		if (!isPlainObject$1(current)) return "points into a value that is not an object";
		if (Array.isArray(current.oneOf)) {
			for (const branch of current.oneOf) if (resolveSchemaPath(branch, segments.slice(walked.length)) !== null) return "is not declared in every oneOf variant";
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
* @param rootLabel 顶层取的名字（错误信息里的根路径）；默认 `payload`
* @returns 可读问题列表；空数组表示通过
*/
function schemaProblems(schema, data, rootLabel = "payload") {
	const problems = [];
	checkValue(schema, data, "", problems, 0, rootLabel);
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
* @param rootLabel 顶层取的名字
* @returns 无返回值
*/
function checkValue(schema, value, path, problems, depth, rootLabel) {
	if (depth > MAX_CHECK_DEPTH) return;
	const label = path === "" ? rootLabel : path;
	if (Array.isArray(schema.oneOf)) {
		if (!schema.oneOf.some((branch) => {
			const branchProblems = [];
			checkValue(branch, value, path, branchProblems, depth + 1, rootLabel);
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
				checkValue(child, value[name], joinPath(path, name), problems, depth + 1, rootLabel);
			}
			return;
		}
		case "array":
			if (!Array.isArray(value)) {
				problems.push(`${label}: expected array, got ${actualType(value)}`);
				return;
			}
			if (isPlainObject$1(schema.items)) value.forEach((item, index) => {
				checkValue(schema.items, item, `${path}[${index}]`, problems, depth + 1, rootLabel);
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
// .build/workflows/program/clock.js
/**
* 机器人驱动：v1 只有内建 `clock`。
*
* `clock` 任务在任务内容里带 `until`（ISO 时间）；到点完成，不建会话、不占
* 执行者实例。重启时按 `until` 重新计时：已过则立即完成。
*
* @module @buka/dsh-plugin-workflows/program/clock
*/
/** 内建 `clock` 驱动 id；与 workers 登记表里的 program id 一致。 */
const CLOCK_PROGRAM_ID = "clock";
/** Node `setTimeout` 的最大延迟；超过时分段计时。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
/**
* 解析任务内容里的 `until`。
*
* @param content 任务内容
* @returns 时间戳（毫秒）；不合法时是 null
*/
function clockUntil(content) {
	if (content === null || typeof content !== "object" || Array.isArray(content)) return null;
	const raw = content.until;
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
	content: {
		type: "object",
		description: "Task content for the clock robot: when the task should complete.",
		properties: { until: {
			type: "string",
			description: "ISO 8601 timestamp, for example 2026-11-16T09:00:00+08:00."
		} },
		required: ["until"]
	},
	async run({ content, signal }) {
		const until = clockUntil(content);
		if (until === null) throw new Error("clock task content must contain an ISO timestamp \"until\"");
		while (Date.now() < until) {
			if (signal.aborted) throw new Error("clock task was cancelled");
			await sleep(until - Date.now(), signal);
		}
		return { text: `clock 到点：${(/* @__PURE__ */ new Date()).toISOString()}` };
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
// .build/workflows/program/contracts.js
/**
* 机器人（program）的内容契约。
*
* 契约属于程序本身，不写进工作流定义，也不进任务记录：
*
* - **保存工作流**：挂机器人的任务类型必须声明 `content` schema，并覆盖程序要求的
*   必填字段（`programRequiredContent`）；
* - **创建任务**：渲染后的任务内容按同一份 schema 校验，不合法直接拒绝；
* - **执行前**：再校验一次，兜住旧作业与手改数据。
*
* @module @buka/dsh-plugin-workflows/program/contracts
*/
/**
* 归一 program id：登记表缺 `program` 时按内建 clock 处理（与引擎执行一致）。
*
* @param program 执行者登记表里的 program 字段
* @returns program id
*/
function normalizeProgramId(program) {
	const id = typeof program === "string" ? program.trim() : "";
	return id === "" ? CLOCK_PROGRAM_ID : id;
}
/**
* 判断一个程序是否由本插件注册。
*
* @param program program id
* @returns 已注册时为 true
*/
function isKnownProgram(program) {
	return programDriver(normalizeProgramId(program)) !== void 0;
}
/**
* 一个程序接收的任务内容契约。
*
* @param program program id（可省略，按 clock 处理）
* @returns 契约 schema；未知程序或驱动不声明契约时是 undefined
*/
function programContentSchema(program) {
	return programDriver(normalizeProgramId(program))?.content;
}
/**
* 程序要求任务内容必须提供的顶层字段。
*
* 只读顶层 `required`；`oneOf` 联合类型的必填字段交给创建 / 执行前的完整校验，
* 保存时不猜，避免把合法定义挡在外面。
*
* @param program program id
* @returns 必填字段名；没有契约时是空数组
*/
function programRequiredContent(program) {
	const schema = programContentSchema(program);
	if (schema === void 0 || Array.isArray(schema.oneOf)) return [];
	return Array.isArray(schema.required) ? [...schema.required] : [];
}
/**
* 按程序的契约校验任务内容。
*
* @param program program id
* @param content 渲染后的任务内容
* @returns 可读问题；空数组表示通过
*/
function programContentProblems(program, content) {
	const schema = programContentSchema(program);
	if (schema === void 0) return [];
	return schemaProblems(schema, content, "content");
}
// .build/workflows/workers/store/builtin.js
/**
* 内建机器人。
*
* 机器人是固定程序（接收输入 → 产出输出），没有目录、AGENTS.md 与
* 项目 skills；目前有 `clock` 与 `engine`，由 workflows 插件执行驱动。它们
* 登记在 workers 插件里、在页面上只读展示，用户不能创建或删除。内建机器人的
* 标识符固定；展示名可以是标识符，也可以是一个可读的名字。
*
* `engine` 是工作流引擎自己：它只处理内建开始节点，岗位不能引用它。展示名是
* `Workflow引擎`，默认头像 🤖（预设 id `robot`）。
*
* 本模块只依赖类型与常量，可被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-workflows/workers/store/builtin
*/
/** 内建定时执行者的标识符，也是它的 program id。 */
const CLOCK_WORKER_ID = "clock";
/** 工作流引擎的标识符，也是它的 program id。 */
const ENGINE_WORKER_ID = "engine";
/** 引擎 program id；与 worker 标识符同源。 */
const ENGINE_PROGRAM_ID = ENGINE_WORKER_ID;
/**
* 内建机器人清单（按登记顺序）。
*
* `createdAt` 是固定的登记时刻：内建执行者不随安装时间变化，重复补写也不会
* 让它看起来是新的。
*/
const BUILTIN_WORKERS = Object.freeze([{
	id: CLOCK_WORKER_ID,
	name: CLOCK_WORKER_ID,
	driver: "robot",
	path: "",
	program: CLOCK_WORKER_ID,
	createdAt: "2026-11-12T00:00:00.000Z",
	avatar: "",
	description: "到点完成任务的定时执行者：任务内容带 until，到点后自动完成。等待彼此独立，建议把该任务类型的 concurrency 设为 10，避免多个等待互相排队。"
}, {
	id: ENGINE_WORKER_ID,
	name: "Workflow引擎",
	driver: "robot",
	path: "",
	program: ENGINE_PROGRAM_ID,
	createdAt: "2026-11-20T00:00:00.000Z",
	avatar: "robot",
	description: "工作流引擎：接受开始任务类型，校验作业输入并创建初始任务；只处理内建开始节点。"
}]);
/** 按标识符取内建机器人；不是内建执行者时返回 undefined。 */
function builtinWorker(id) {
	if (typeof id !== "string") return void 0;
	const trimmed = id.trim();
	return BUILTIN_WORKERS.find((worker) => worker.id === trimmed);
}
/** 标识符是否属于内建（不可创建 / 删除 / 改动的）机器人。 */
function isBuiltinWorkerId(id) {
	return builtinWorker(id) !== void 0;
}
/**
* 标识符是否只能由内建节点使用。
*
* 引擎是开始节点的处理人；岗位如果把引擎当执行者，会得到一个只会初始化
* 作业、不会执行岗位任务的机器人。定义校验直接拒绝这种引用。
*/
function isSystemOnlyWorkerId(id) {
	return typeof id === "string" && id.trim() === "engine";
}
/**
* 把内建执行者的记录换成清单里的规范记录，并把清单里缺的补到末尾。
*
* 内建执行者的名称、头像与描述由 `BUILTIN_WORKERS` 决定：登记表里可能还留着
* 旧版本写下的值，视图只以清单为准。只影响内存里的视图：页面与 `list()` 用它
* 保证内建执行者总是可见且展示一致；写回由 `ensureBuiltinWorkers` 负责。
*/
function withBuiltinWorkers(workers) {
	const ids = new Set(workers.map((worker) => worker.id));
	return [...workers.map((worker) => builtinWorker(worker.id) ?? worker), ...BUILTIN_WORKERS.filter((worker) => !ids.has(worker.id))];
}
/** 生成「内建执行者不可改动」错误。 */
function builtinWorkerError(id) {
	const error = /* @__PURE__ */ new Error(`内建执行者不可创建、修改或删除：${String(id)}`);
	return Object.assign(error, { code: "builtin-worker" });
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
* - `{{nodes.<id>.data.<path>}}`：执行者通过 `structured_output` 回报的结构化结果；
* - 需要时也可以引用 `{{nodes.<id>.worker}}`、`{{nodes.<id>.sessionId}}`。
*
* 路径不存在时默认抛错（而不是静默变空串），这样定义写错时在对应节点立刻失败，
* 不会把空提示词交给执行者。确实允许运行时缺失的路径（表单非必填字段）要在末尾
* 加 `?` 显式声明：`{{input.remark?}}` 取不到值时渲染成空串。`?` 不进入路径本身，
* 保存校验看到的仍是 `input.remark`，写错路径照样被拒。
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
* 末尾的 `?` 表示可选路径：解析结果里 `path` 不含 `?`，由 `optional` 单独表示。
*
* @param raw 占位符原文
* @returns 合法时带 `path` 与 `optional`，非法时带 `error`
*/
function parsePlaceholder(raw) {
	const text = String(raw).trim();
	if (text === "") return { error: "empty template placeholder" };
	const optional = text.endsWith("?");
	const path = optional ? text.slice(0, -1).trim() : text;
	if (path === "") return { error: `invalid template path "${text}"` };
	if (!PATH_PATTERN.test(path)) return { error: `invalid template path "${text}"` };
	return {
		path,
		optional
	};
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
		if (value === void 0) {
			if (parsed.optional) return "";
			throw new TemplateError(`template path "${path}" is not available yet; add "?" to the path to render an empty string when it is missing`, path);
		}
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
* 任务内容模板：路径解析、引用遍历与渲染。
*
* 只有两处声明会写模板：开始节点的初始任务、人任务类型的动作。可用占位符：
*
* - `{{content.<path>}}`：正在完成的这张任务的任务内容（开始节点是发起人填的内容，
*   人任务类型是上游给这张任务的内容）；
* - `{{input.<path>}}`：动作表单里填的值（开始节点的初始任务没有表单）。
*
* 渲染在创建任务时进行；定义校验阶段用 `inspectPayload` 只提取路径、不求值，
* 再按对应的 schema 检查。路径不存在时默认抛错（而不是静默变空串），避免把空内容
* 交给主体；确实允许运行时缺失的路径（表单非必填字段）在末尾加 `?` 显式声明，
* 例如 `{{input.remark?}}` 取不到值时渲染成空串，`?` 不进入路径本身。
*
* @module @buka/dsh-plugin-workflows/definition/payload
*/
/**
* 解析一个模板占位符路径。
*
* @param path 占位符里的点号路径
* @returns 合法时是结构化的引用；不认识的前缀返回 null
*/
function parseTemplatePath(path) {
	const segments = path.split(".");
	const head = segments[0];
	if (head === "content") return {
		kind: "content",
		segments: segments.slice(1)
	};
	if (head === "input") return {
		kind: "input",
		segments: segments.slice(1)
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
* 提取一个值里的全部模板引用与语法错误；不求值。
*
* @param payload 待检查的值
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
* 递归渲染：字符串里的占位符按 `renderTemplate` 求值，容器逐项递归，其它值原样返回。
*
* @param payload 含模板的值
* @param context 模板上下文（`content` / `input`）
* @returns 渲染后的值
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
* 组装模板上下文。
*
* @param input 任务内容与动作表单
* @returns 可直接交给 `renderPayload` 的上下文
*/
function buildTemplateContext(input) {
	return {
		content: input.content ?? null,
		input: input.input ?? null
	};
}
// .build/workflows/definition/validate.js
/**
* 工作流 v8 定义校验。
*
* 纯函数：不读盘、不依赖 DSH。执行者存在性由调用方传入 `workers` 目录（按
* 标识符建索引），这样 `buka_workflow_save` 用 workers 服务的登记表，单测用
* 固定目录。
*
* 校验分两步：先解析出规范化定义，再跑跨节点规则（通道、可达性、动作、模板引用）。
* 错误带定位路径，尽量一次返回全部问题；结构缺得太多时提前返回。
*
* @module @buka/dsh-plugin-workflows/definition/validate
*/
/** 岗位 id 与任务类型 id 的形状。 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
/** 通道 id 的形状：小写点分，首尾是字母或数字，便于在对话与报错里引用。 */
const CHANNEL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
/** 内建节点 id。 */
const START_ID = "start";
const END_ID = "end";
/** 收集错误与提示。 */
var Issues = class {
	list = [];
	warnings = [];
	add(path, message) {
		this.list.push({
			path,
			message
		});
	}
	/** 记录一条不拦截保存的提示。 */
	warn(path, message) {
		this.warnings.push({
			path,
			message
		});
	}
	get failed() {
		return this.list.length > 0;
	}
};
/**
* 拒绝对象上的未知字段。
*
* 以前未知字段被静默剥离，拼错的开关（例如 `workTree`）等于悄悄关掉一个保护；
* 内建任务类型上禁用 `actions` / `assistant` / `plan` / `agentPreset` /
* `concurrency` / `worktree` 也靠这条规则落地。
*/
function checkUnknownKeys(raw, allowed, path, issues) {
	const known = new Set(allowed);
	for (const key of Object.keys(raw)) {
		if (known.has(key)) continue;
		issues.add(path === "" ? key : `${path}.${key}`, "unexpected field");
	}
}
/**
* 校验一份工作流 v8 定义。
*
* @param raw 待校验的原始定义（来自工具参数或 storageDomain）
* @param options 执行者目录
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
	checkUnknownKeys(raw, [
		"version",
		"name",
		"description",
		"budgets",
		"positions",
		"channels",
		"start",
		"end"
	], "", issues);
	if (raw.version !== 8) issues.add("version", "must be 8");
	const name = readName(raw, "name", "", issues);
	const description = readOptionalString(raw, "description", "description", issues) ?? "";
	const budgets = readBudgets(raw.budgets, issues);
	const positions = readPositions(raw.positions, options.workers, options.presets, issues);
	const positionById = new Map(positions.map((position) => [position.id, position]));
	const typeById = /* @__PURE__ */ new Map();
	for (const position of positions) for (const taskType of position.taskTypes) typeById.set(taskType.id, taskType);
	const channels = readChannels(raw.channels, positionById, typeById, issues);
	const channelById = new Map(channels.map((channel) => [channel.id, channel]));
	const start = readStart(raw.start, issues);
	const end = readEnd(raw.end, issues);
	checkChannels(channels, positions, issues);
	checkReachability(channels, positions, issues);
	checkEnd(channels, positions, issues);
	const endContent = end?.content;
	checkStartRoutes(start, positionById, typeById, channelById, endContent, issues);
	checkActions(positions, positionById, typeById, channelById, endContent, issues);
	checkRobotCreates(positions, positionById, typeById, channelById, endContent, issues);
	checkConcurrencyWarnings(positions, options.workers, issues);
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
			version: 8,
			name,
			...description === "" ? {} : { description },
			budgets,
			start,
			end,
			positions,
			channels
		},
		warnings: issues.warnings
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
	checkUnknownKeys(raw, ["maxTasks", "maxDurationHours"], "budgets", issues);
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
function readPositions(raw, workers, presets, issues) {
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
		checkUnknownKeys(entry, [
			"id",
			"label",
			"note",
			"executor",
			"taskTypes"
		], path, issues);
		const id = readPositionId(entry, path, seenPositions, issues);
		if (id === null) continue;
		const label = readName(entry, "label", path, issues);
		const note = readOptionalString(entry, "note", `${path}.note`, issues);
		const executor = readExecutor(entry.executor, `${path}.executor`, id, workers, issues);
		const taskTypes = readTaskTypes(entry.taskTypes, `${path}.taskTypes`, id, executor, workers, presets, seenTypes, issues);
		if (label === null || executor === null) continue;
		if (taskTypes.length === 0) issues.add(`${path}.taskTypes`, "a position must declare at least one task type");
		positions.push({
			id,
			label,
			...note === null || note === "" ? {} : { note },
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
/** 解析岗位主体。 */
function readExecutor(raw, path, positionId, workers, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add(path, "must be { kind: \"worker\", id } or { kind: \"human\" }");
		return null;
	}
	checkUnknownKeys(raw, [
		"kind",
		"id",
		"name"
	], path, issues);
	if (raw.kind === "human") return { kind: "human" };
	if (raw.kind !== "worker") {
		issues.add(`${path}.kind`, "must be \"worker\" or \"human\"");
		return null;
	}
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (id === "") {
		issues.add(`${path}.id`, "must be a non-empty worker identifier");
		return null;
	}
	const worker = workers.get(id);
	if (worker === void 0) {
		issues.add(`${path}.id`, `unknown worker identifier "${id}" for position "${positionId}": register it with the Buka Workers plugin first`);
		return null;
	}
	if (isSystemOnlyWorkerId(worker.id)) {
		issues.add(`${path}.id`, `"${worker.id}" is the built-in system executor of the start node and cannot fill a position`);
		return null;
	}
	if (worker.driver === "robot" && !isKnownProgram(worker.program)) {
		issues.add(`${path}.id`, `robot identifier "${id}" of position "${positionId}" uses program "${normalizeProgramId(worker.program)}", which no installed plugin provides`);
		return null;
	}
	return {
		kind: "worker",
		id
	};
}
/** 解析一个岗位的任务类型列表。 */
function readTaskTypes(raw, path, positionId, executor, workers, presets, seenTypes, issues) {
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
		const taskType = readTaskType(entry, at, positionId, executor, workers, presets, seenTypes, issues);
		if (taskType !== null) taskTypes.push(taskType);
	}
	return taskTypes;
}
/** 解析一个任务类型。 */
function readTaskType(entry, path, positionId, executor, workers, presets, seenTypes, issues) {
	checkUnknownKeys(entry, [
		"id",
		"label",
		"definition",
		"content",
		"actions",
		"creates",
		"assistant",
		"plan",
		"agentPreset",
		"concurrency",
		"worktree"
	], path, issues);
	const id = entry.id;
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		issues.add(`${path}.id`, "must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
		return null;
	}
	if (id === START_ID || id === END_ID) {
		issues.add(`${path}.id`, `"${id}" is reserved by the built-in task type of the ${id} node`);
		return null;
	}
	if (seenTypes.has(id)) {
		issues.add(`${path}.id`, `duplicate task type id "${id}": task type ids are unique in a workflow`);
		return null;
	}
	seenTypes.add(id);
	const label = readName(entry, "label", path, issues);
	const definition = readOptionalString(entry, "definition", `${path}.definition`, issues);
	const content = readSchema(entry.content, `${path}.content`, issues, "value");
	const human = executor?.kind === "human";
	const actions = readActions(entry.actions, `${path}.actions`, human, issues);
	const creates = readRobotCreates(entry.creates, `${path}.creates`, executor, workers, issues);
	const assistant = readAssistant(entry.assistant, `${path}.assistant`, positionId, id, executor, workers, issues);
	const plan = readPlan(entry.plan, `${path}.plan`, path, executor, workers, issues);
	const agentPreset = readAgentPreset(entry.agentPreset, `${path}.agentPreset`, path, executor, workers, presets, issues);
	const concurrency = readConcurrency(entry.concurrency, `${path}.concurrency`, executor, issues);
	const worktree = readWorktree(entry.worktree, `${path}.worktree`, path, executor, workers, issues);
	if (label === null) return null;
	const taskType = {
		id,
		label,
		...definition === null || definition === "" ? {} : { definition },
		...content === null ? {} : { content },
		...actions === void 0 ? {} : { actions },
		...creates === void 0 ? {} : { creates },
		...assistant === void 0 ? {} : { assistant },
		...plan === void 0 ? {} : { plan },
		...agentPreset === void 0 ? {} : { agentPreset },
		...concurrency === void 0 ? {} : { concurrency },
		...worktree === void 0 ? {} : { worktree }
	};
	if (content !== null || entry.content === void 0 || entry.content === null) checkRobotContent(taskType, path, executor, workers, issues);
	return taskType;
}
/**
* 机器人岗位的任务类型必须覆盖程序声明的内容契约。
*
* 契约属于程序（见 `program/contracts.ts`）；这里只检查作者声明的 `content`
* schema 是否覆盖了程序要求的必填字段，实际内容在创建任务与执行前再校验。
* `oneOf` 联合类型不在这里猜，交给运行期校验。
*/
function checkRobotContent(taskType, path, executor, workers, issues) {
	if (executor === null || executor.kind !== "worker") return;
	const id = executorRef(executor);
	const worker = id === null ? void 0 : workers.get(id);
	if (worker === void 0 || worker.driver !== "robot") return;
	const program = normalizeProgramId(worker.program);
	const required = programRequiredContent(program);
	if (required.length === 0) return;
	const fields = required.map((name) => `"${name}"`).join(", ");
	const schema = taskType.content;
	if (schema === void 0) {
		issues.add(`${path}.content`, `robot "${worker.id}" (program "${program}") needs task content: declare a content schema with required ${fields}`);
		return;
	}
	if (Array.isArray(schema.oneOf)) return;
	if (schema.type !== "object") {
		issues.add(`${path}.content.type`, `must be "object": robot "${worker.id}" (program "${program}") reads task content fields ${fields}`);
		return;
	}
	const declared = new Set(Array.isArray(schema.required) ? schema.required : []);
	const missing = required.filter((name) => !declared.has(name));
	if (missing.length > 0) issues.add(`${path}.content.required`, `must include ${missing.map((name) => `"${name}"`).join(", ")}: robot "${worker.id}" (program "${program}") needs it`);
}
/** 主体是不是机器人（登记表里 driver 为 robot）。 */
function isRobotExecutor(executor, workers) {
	if (executor === null || executor.kind !== "worker") return false;
	const id = executorRef(executor);
	return id === null ? false : workers.get(id)?.driver === "robot";
}
/**
* 解析机器人任务类型的「完成后创建」。
*
* 只有机器人岗位能声明：agent 任务用 `buka_task_create` 动态创建，人任务用动作。
*/
function readRobotCreates(raw, path, executor, workers, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (!isRobotExecutor(executor, workers)) {
		issues.add(path, "creates are only valid on robot positions");
		return;
	}
	return readCreations(raw, path, issues) ?? void 0;
}
/** 解析 schema 字段；任务内容允许非对象顶层，表单与作业输入要求对象。 */
function readSchema(raw, path, issues, root = "object") {
	if (raw === void 0 || raw === null) return null;
	return parseJsonSchema(raw, path, (at, message) => issues.add(at, message), { root });
}
/** 解析任务类型上的动作列表。 */
function readActions(raw, path, human, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (!human) {
		issues.add(path, "actions are only valid on human positions");
		return;
	}
	if (!Array.isArray(raw)) {
		issues.add(path, "must be an array of actions");
		return;
	}
	const actions = [];
	const seen = /* @__PURE__ */ new Set();
	for (const [index, entry] of raw.entries()) {
		const at = `${path}[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(at, "must be an object");
			continue;
		}
		checkUnknownKeys(entry, [
			"id",
			"label",
			"input",
			"creates"
		], at, issues);
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		if (id === "" || !ID_PATTERN.test(id)) {
			issues.add(`${at}.id`, "must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
			continue;
		}
		if (seen.has(id)) {
			issues.add(`${at}.id`, `duplicate action id "${id}" in this task type`);
			continue;
		}
		seen.add(id);
		const label = readName(entry, "label", at, issues);
		if (label === null) continue;
		const input = readSchema(entry.input, `${at}.input`, issues);
		const creates = readCreations(entry.creates, `${at}.creates`, issues);
		if (creates === null) continue;
		actions.push({
			id,
			label,
			...input === null ? {} : { input },
			creates
		});
	}
	return actions.length > 0 ? actions : void 0;
}
/** 解析一组创建声明（结构层；通道与模板在第二遍校验）。 */
function readCreations(raw, path, issues) {
	if (!Array.isArray(raw)) {
		issues.add(path, "must be an array (it may be empty)");
		return null;
	}
	const creations = [];
	for (const [index, entry] of raw.entries()) {
		const at = `${path}[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(at, "must be an object");
			continue;
		}
		checkUnknownKeys(entry, [
			"channel",
			"type",
			"content"
		], at, issues);
		const channel = typeof entry.channel === "string" ? entry.channel.trim() : "";
		if (channel === "") {
			issues.add(`${at}.channel`, "must be a channel id");
			continue;
		}
		const type = entry.type === void 0 || entry.type === null ? void 0 : typeof entry.type === "string" && entry.type.trim() !== "" ? entry.type.trim() : null;
		if (type === null) {
			issues.add(`${at}.type`, "must be a task type id (omit it only for the end task)");
			continue;
		}
		creations.push({
			channel,
			...type === void 0 ? {} : { type },
			...entry.content === void 0 ? {} : { content: entry.content }
		});
	}
	return creations;
}
/**
* 解析助理字段；只对人岗位有效。
*
* 助理是工作流上的点名：只要求标识符已登记且是智能体，不要求执行者身上带
* 任何标记（ADR 0022）。
*/
function readAssistant(raw, path, positionId, taskTypeId, executor, workers, issues) {
	if (raw === void 0) return void 0;
	if (executor !== null && executor.kind !== "human") {
		issues.add(path, `assistant is only valid on human positions (position "${positionId}")`);
		return;
	}
	if (raw === null) return null;
	if (typeof raw !== "string" || raw.trim() === "") {
		issues.add(path, "must be a worker identifier or null");
		return;
	}
	const id = raw.trim();
	const worker = workers.get(id);
	if (worker === void 0) {
		issues.add(path, `unknown assistant worker identifier "${id}" for task type "${positionId}.${taskTypeId}": register it with the Buka Workers plugin first`);
		return;
	}
	if (worker.driver !== "agent") {
		issues.add(path, `assistant identifier "${id}" of task type "${positionId}.${taskTypeId}" must be an agent, not a robot`);
		return;
	}
	return id;
}
/**
* 解析计划模式开关；只对智能体岗位有效。
*
* `plan` 是会话内状态，与执行者预设正交：同一个任务类型可以既 `plan: true`
* 又指定 `agentPreset`。
*/
function readPlan(raw, path, ownerPath, executor, workers, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (typeof raw !== "boolean") {
		issues.add(path, "must be true or false");
		return;
	}
	if (!raw) return void 0;
	if (executor === null) return void 0;
	if (executor.kind !== "worker") {
		issues.add(path, "plan is only valid for agent positions");
		return;
	}
	const executorId = executorRef(executor);
	const worker = executorId === null ? void 0 : workers.get(executorId);
	if (worker === void 0 || worker.driver !== "agent") {
		issues.add(`${ownerPath}.executor`, "plan requires an agent executor");
		return;
	}
	return true;
}
/**
* 解析任务类型的执行者预设 id；只对智能体岗位有效。
*
* 有预设目录时校验 id 存在；目录缺失（composition 里没有 `agentPresets` 服务）
* 时只校验形状。存在但激活失败（broken）的预设在保存时接受，派发时挂载失败按
* 任务失败处理。
*/
function readAgentPreset(raw, path, ownerPath, executor, workers, presets, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (typeof raw !== "string" || raw.trim() === "") {
		issues.add(path, "must be an agent preset id");
		return;
	}
	const id = raw.trim();
	if (executor === null) return void 0;
	if (executor.kind !== "worker") {
		issues.add(path, "agentPreset is only valid for agent positions");
		return;
	}
	const executorId = executorRef(executor);
	const worker = executorId === null ? void 0 : workers.get(executorId);
	if (worker === void 0 || worker.driver !== "agent") {
		issues.add(`${ownerPath}.executor`, "agentPreset requires an agent executor");
		return;
	}
	if (presets !== void 0 && !presets.has(id)) {
		const available = [...presets].sort().join(", ");
		issues.add(path, `unknown agent preset "${id}": ${available === "" ? "no agent preset is available in this composition" : `available presets are ${available}`}`);
		return;
	}
	return id;
}
/**
* 解析并发度：同一作业内这类任务最多同时进行几条。
*
* 只对智能体 / 机器人岗位有意义；人任务不占引擎的并发额度，声明在人工岗位上
* 直接拒绝，避免作者以为它改变了人工任务的排队方式。
*/
function readConcurrency(raw, path, executor, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
		issues.add(path, "must be a positive integer (1 means one task at a time)");
		return;
	}
	if (executor !== null && executor.kind !== "worker") {
		issues.add(path, "concurrency is only valid for agent or robot positions: human tasks do not use the engine quota");
		return;
	}
	return raw;
}
/**
* 解析工作树模式；只对智能体岗位有效。
*
* 三个取值：`none`（不注入提示词，等价于省略，任何岗位都接受）、`guard`
* （只做工作区保护检查）、`create`（让执行者自己创建 worktree）。后两者只对
* 智能体岗位有效。这里只校验配置形状，不校验宿主是否启用了工作树插件：定义
* 可能在启用插件的机器上编写、在没启用的组合里执行，也可能反过来。真正生效
* 与否由执行时探测；`create` 不可用时降级为 `guard`。
*/
function readWorktree(raw, path, ownerPath, executor, workers, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (raw !== "none" && raw !== "guard" && raw !== "create") {
		issues.add(path, "must be \"none\", \"guard\", or \"create\"");
		return;
	}
	if (raw === "none") return void 0;
	if (executor === null) return void 0;
	if (executor.kind !== "worker") {
		issues.add(path, "worktree is only valid on agent positions");
		return;
	}
	const executorId = executorRef(executor);
	const worker = executorId === null ? void 0 : workers.get(executorId);
	if (worker === void 0 || worker.driver !== "agent") {
		issues.add(`${ownerPath}.executor`, "worktree requires an agent executor");
		return;
	}
	return raw;
}
/**
* 并行任务的目录风险提示：不拦截保存。
*
* 同一执行者的多个任务可以同时改同一个目录；作者把任务类型并发度调高、又没
* 有让这些任务用工作树隔离（`worktree: "create"`）时，提示一次。工作树插件是否
* 启用要到执行时才知道，所以这里只按定义声明判断。
*/
function checkConcurrencyWarnings(positions, workers, issues) {
	for (const position of positions) {
		if (position.executor.kind !== "worker") continue;
		const executorId = executorRef(position.executor);
		const worker = executorId === null ? void 0 : workers.get(executorId);
		if (worker === void 0 || worker.driver !== "agent") continue;
		const total = position.taskTypes.reduce((sum, taskType) => sum + (taskType.concurrency ?? 1), 0);
		if (total <= 1) continue;
		const unisolated = position.taskTypes.filter((taskType) => taskType.worktree !== "create").map((taskType) => taskType.id);
		if (unisolated.length === 0) continue;
		issues.warn(`positions.${position.id}`, `task types can run ${total} tasks in parallel in one job, but ${unisolated.map((id) => `"${id}"`).join(", ")} do not set worktree "create": concurrent tasks of "${worker.id}" may modify the same directory`);
	}
}
/** 解析通道列表。 */
function readChannels(raw, positionById, typeById, issues) {
	if (!Array.isArray(raw)) {
		issues.add("channels", "must be an array");
		return [];
	}
	const channels = [];
	const seen = /* @__PURE__ */ new Set();
	for (const [index, entry] of raw.entries()) {
		const path = `channels[${index}]`;
		if (!isPlainObject$1(entry)) {
			issues.add(path, "must be an object");
			continue;
		}
		checkUnknownKeys(entry, [
			"id",
			"label",
			"from",
			"to",
			"types",
			"back"
		], path, issues);
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		if (id === "" || !CHANNEL_ID_PATTERN.test(id)) {
			issues.add(`${path}.id`, "must be a lowercase identifier (letters, digits, dots, hyphens or underscores), e.g. \"qa.dev.rework\"");
			continue;
		}
		if (seen.has(id)) {
			issues.add(`${path}.id`, `duplicate channel id "${id}"`);
			continue;
		}
		const label = typeof entry.label === "string" ? entry.label.trim() : "";
		if (label === "") {
			issues.add(`${path}.label`, "must be a non-empty display label");
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
			issues.add(path, "a channel must connect two different nodes");
			continue;
		}
		seen.add(id);
		const types = readChannelTypes(entry.types, `${path}.types`, to, positionById, typeById, issues);
		if (entry.back !== void 0 && typeof entry.back !== "boolean") issues.add(`${path}.back`, "must be true or false");
		channels.push({
			id,
			label,
			from,
			to,
			...types === void 0 ? {} : { types },
			...entry.back === true ? { back: true } : {}
		});
	}
	return channels;
}
/** 判断节点是否存在（岗位或内建 start / end）。 */
function isKnownNode(id, positionById) {
	return id === START_ID || id === END_ID || positionById.has(id);
}
/** 解析通道上的任务类型白名单。 */
function readChannelTypes(raw, path, to, positionById, typeById, issues) {
	if (raw === void 0 || raw === null) return void 0;
	if (to === END_ID) {
		issues.add(path, "the built-in end node has a single contract; a channel into it cannot whitelist types");
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
function readStart(raw, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add("start", "must declare the built-in start node task contract");
		return null;
	}
	checkUnknownKeys(raw, ["content", "next"], "start", issues);
	const content = readSchema(raw.content, "start.content", issues);
	const next = readCreations(raw.next, "start.next", issues);
	if (next === null || next.length === 0) {
		issues.add("start.next", "must declare at least one initial task");
		return null;
	}
	return {
		...content === null ? {} : { content },
		next
	};
}
/** 解析结束节点。 */
function readEnd(raw, issues) {
	if (!isPlainObject$1(raw)) {
		issues.add("end", "must declare the built-in end node task contract");
		return null;
	}
	checkUnknownKeys(raw, ["content"], "end", issues);
	const content = readSchema(raw.content, "end.content", issues, "value");
	return { ...content === null ? {} : { content } };
}
/** 校验开始节点的初始任务。 */
function checkStartRoutes(start, positionById, typeById, channelById, endContent, issues) {
	if (start === null) return;
	for (const [index, creation] of start.next.entries()) checkCreation(creation, `start.next[${index}]`, START_ID, start.content, void 0, endContent, {
		positionById,
		typeById,
		channelById,
		issues
	});
}
/** 校验所有人任务类型上的动作。 */
function checkActions(positions, positionById, typeById, channelById, endContent, issues) {
	for (const position of positions) for (const taskType of position.taskTypes) for (const [index, action] of (taskType.actions ?? []).entries()) for (const [creationIndex, creation] of action.creates.entries()) checkCreation(creation, `positions.${position.id}.taskTypes.${taskType.id}.actions[${index}].creates[${creationIndex}]`, position.id, taskType.content, action.input, endContent, {
		positionById,
		typeById,
		channelById,
		issues
	});
}
/** 校验机器人任务类型的「完成后创建」。 */
function checkRobotCreates(positions, positionById, typeById, channelById, endContent, issues) {
	for (const position of positions) for (const taskType of position.taskTypes) for (const [index, creation] of (taskType.creates ?? []).entries()) checkCreation(creation, `positions.${position.id}.taskTypes.${taskType.id}.creates[${index}]`, position.id, taskType.content, void 0, endContent, {
		positionById,
		typeById,
		channelById,
		issues
	});
}
/** 校验一条创建声明：通道、目标类型、任务内容模板。 */
function checkCreation(creation, path, node, creatorContent, actionInput, endContent, context) {
	const { issues, channelById, positionById, typeById } = context;
	const channel = channelById.get(creation.channel);
	if (channel === void 0) {
		issues.add(`${path}.channel`, `unknown channel "${creation.channel}"`);
		return;
	}
	if (channel.from !== node) {
		issues.add(`${path}.channel`, `channel "${channel.id}" starts at "${channel.from}", not at "${node}"`);
		return;
	}
	if (channel.to === END_ID) {
		if (creation.type !== void 0 && creation.type !== END_ID) issues.add(`${path}.type`, "the end task has no task type; omit \"type\" for channels into end");
		checkContent(creation.content, path, endContent, creatorContent, actionInput, issues);
		return;
	}
	const target = positionById.get(channel.to);
	if (target === void 0) {
		issues.add(`${path}.channel`, `channel "${channel.id}" does not lead to a position`);
		return;
	}
	if (creation.type === void 0) {
		issues.add(`${path}.type`, `must name a task type of position "${target.id}"`);
		return;
	}
	const taskType = typeById.get(creation.type);
	if (taskType === void 0 || !target.taskTypes.some((candidate) => candidate.id === creation.type)) {
		issues.add(`${path}.type`, `"${creation.type}" is not a task type of position "${target.id}"`);
		return;
	}
	if (!channelAllowsType(channel, taskType.id)) {
		issues.add(`${path}.type`, `channel "${channel.id}" does not allow task type "${taskType.id}"`);
		return;
	}
	checkContent(creation.content, path, taskType.content, creatorContent, actionInput, issues);
}
/**
* 校验任务内容：模板引用 + 按目标 schema 的结构检查。
*
* @param content 声明的任务内容（可含模板）
* @param path 定位路径
* @param target 目标任务内容的 schema
* @param creatorContent 声明方任务自己的 content schema
* @param actionInput 动作表单 schema（开始节点没有）
* @param issues 错误收集
*/
function checkContent(content, path, target, creatorContent, actionInput, issues) {
	const value = content ?? {};
	const inspection = inspectPayload(value);
	for (const error of inspection.syntaxErrors) issues.add(`${path}.content`, error);
	for (const reference of inspection.references) {
		const parsed = reference.reference;
		if (parsed === null) {
			issues.add(`${path}.content`, `template "{{${reference.path}}}" must reference content.<path> or input.<path>`);
			continue;
		}
		const schema = parsed.kind === "content" ? creatorContent : actionInput;
		if (schema === void 0) {
			issues.add(`${path}.content`, `template "{{${reference.path}}}" cannot be resolved: the creating task declares no ${parsed.kind === "content" ? "content schema" : "input form"}`);
			continue;
		}
		const reason = resolveSchemaPath(schema, parsed.segments);
		if (reason !== null) issues.add(`${path}.content`, `template "{{${reference.path}}}" ${reason}`);
	}
	if (target === void 0) return;
	checkTemplatedContent(target, value, `${path}.content`, issues);
}
/**
* 按 schema 校验可能含模板的值。
*
* 含模板的子树跳过类型 / 枚举检查（值要到执行时才有），但对象 / 数组的结构、
* required 与 additionalProperties 仍然检查。
*/
function checkTemplatedContent(schema, value, path, issues) {
	if (Array.isArray(schema.oneOf)) {
		if (!schema.oneOf.some((branch) => {
			const probe = new Issues();
			checkTemplatedContent(branch, value, path, probe);
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
			checkTemplatedContent(child, value[name], `${path}.${name}`, issues);
		}
		return;
	}
	if (type === "array") {
		if (!Array.isArray(value)) {
			issues.add(path, "must be an array");
			return;
		}
		if (isPlainObject$1(schema.items)) value.forEach((item, index) => {
			checkTemplatedContent(schema.items, item, `${path}[${index}]`, issues);
		});
		return;
	}
	if (type === "") return;
	if (value === null ? type !== "null" : typeof value !== type) {
		const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
		issues.add(path, `expected ${type}, got ${actual}`);
	}
}
/**
* 通道与节点的结构检查：回向通道闭合、环上至少一条回向通道、同一对节点的
* `back` 一致。
*
* 规则按 ADR 0015：环上的通道必须有显式标记，回向通道必须真的闭合一个环。
* 一个环只需要一条 `back: true`（例：`qa -> dev` 标 back，`dev -> qa` 是环里
* 向前的通道，不必再标），所以按强连通分量检查：每个多节点分量至少有一条
* 内部回向通道。同一对有序节点可以有多条通道，但 `back` 必须一致。
*/
function checkChannels(channels, positions, issues) {
	const nodes = /* @__PURE__ */ new Set([
		START_ID,
		END_ID,
		...positions.map((position) => position.id)
	]);
	const adjacency = /* @__PURE__ */ new Map();
	for (const node of nodes) adjacency.set(node, /* @__PURE__ */ new Set());
	for (const channel of channels) {
		if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue;
		adjacency.get(channel.from)?.add(channel.to);
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
	for (const [index, channel] of channels.entries()) {
		if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue;
		if (channel.back !== true) continue;
		if (reachability.get(channel.to)?.has(channel.from) === true) continue;
		issues.add(`channels[${index}].back`, `channel "${channel.id}" (${channel.from} -> ${channel.to}) does not close a cycle and cannot be marked back`);
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
		if (channels.flatMap((channel, index) => channel.back === true && members.has(channel.from) && members.has(channel.to) ? [index] : []).length > 0) continue;
		const first = channels.findIndex((channel) => members.has(channel.from) && members.has(channel.to));
		const cycle = [...members].join(" -> ");
		issues.add(`channels[${Math.max(first, 0)}].back`, `cycle "${cycle}" has no explicit back channel: mark the channel that closes it with "back": true`);
	}
	const pairs = /* @__PURE__ */ new Map();
	for (const [index, channel] of channels.entries()) {
		if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue;
		const key = `${channel.from}\u0000${channel.to}`;
		const group = pairs.get(key);
		const item = {
			index,
			back: channel.back === true,
			from: channel.from,
			to: channel.to
		};
		if (group === void 0) pairs.set(key, [item]);
		else group.push(item);
	}
	for (const group of pairs.values()) {
		const first = group[0];
		if (first === void 0 || group.length < 2) continue;
		for (const item of group.slice(1)) {
			if (item.back === first.back) continue;
			issues.add(`channels[${item.index}].back`, `channels between "${item.from}" and "${item.to}" must agree on "back"`);
		}
	}
}
/** 可达性：每个岗位都能从 start 到达，也能到达 end。 */
function checkReachability(channels, positions, issues) {
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
	for (const channel of channels) {
		if (!nodes.has(channel.from) || !nodes.has(channel.to)) continue;
		forward.get(channel.from)?.add(channel.to);
		reverse.get(channel.to)?.add(channel.from);
	}
	const fromStart = walkFrom(START_ID, forward);
	const toEnd = walkFrom(END_ID, reverse);
	for (const position of positions) {
		if (!fromStart.has(position.id)) issues.add(`positions.${position.id}`, "is unreachable from the built-in start node: add a channel path from start");
		if (!toEnd.has(position.id)) issues.add(`positions.${position.id}`, "cannot reach the built-in end node: add a channel path to end");
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
/** 结束节点检查：至少一条入向通道；能派发结束任务的岗位必须与 end 有通道。 */
function checkEnd(channels, positions, issues) {
	const intoEnd = channels.flatMap((channel, index) => channel.to === END_ID ? [{
		channel,
		index
	}] : []);
	if (intoEnd.length === 0) issues.add("channels", "at least one position must have a channel into the built-in end node");
	for (const { channel, index } of intoEnd) {
		if (channel.from === START_ID) {
			issues.add(`channels[${index}].from`, "the start node cannot dispatch the end task; only positions can");
			continue;
		}
		if (positions.every((position) => position.id !== channel.from)) issues.add(`channels[${index}].from`, `unknown position "${channel.from}"`);
	}
}
/**
* 判断一个任务类型是否允许某个派发（通道白名单）。
*
* 引擎创建任务时复用这里的规则。
*
* @param channel 通道
* @param type 任务类型 id
* @returns 允许时为 true
*/
function channelAllowsType(channel, type) {
	return channel.types === void 0 || channel.types.includes(type);
}
/**
* 按 id 取一条通道。
*
* @param definition 定义
* @param channelId 通道 id
* @returns 通道；不存在时是 undefined
*/
function findChannel(definition, channelId) {
	return definition.channels.find((channel) => channel.id === channelId);
}
/**
* 从某个节点出发的全部通道。
*
* @param definition 定义
* @param from 起点节点 id
* @returns 通道列表
*/
function channelsFrom(definition, from) {
	return definition.channels.filter((channel) => channel.from === from);
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
* 按 schema 校验任务内容，返回带路径的问题列表。
*
* 引擎创建任务时复用：模板子树只做结构检查，类型与枚举留给创建之后。
*
* @param schema 任务类型的 content schema
* @param value 待校验的任务内容
* @returns 问题列表；空数组表示通过
*/
function contentIssues(schema, value) {
	const issues = new Issues();
	checkTemplatedContent(schema, value, "content", issues);
	return issues.list;
}
// .build/workflows/domain/availability.js
/**
* 派生的「不可用」状态：工作流 / 作业引用的执行者已不在登记表里。
*
* 不可用不落盘，由读取方按引用能否解析实时计算；重新绑定一个已存在的执行者
* 后自动恢复。它与「停用」不同：停用是人为收起，不可用是引用断了。
*
* 引用来源：
*
* - 工作流定义：岗位主体、任务类型的助理；
* - 作业快照：钉住的定义 + 交回方式里的助理（v7 快照用 `name` 兜底）。
*
* @module @buka/dsh-plugin-workflows/domain/availability
*/
/** 空的可用性结果（没有缺失引用）。 */
const AVAILABLE = {
	available: true,
	missingWorkers: []
};
/** 判断登记表里有没有这个标识符。 */
function hasWorker(workers, id) {
	return workers.has(id);
}
/** 追加一条缺失引用；同一个标识符在同一位置只记一次。 */
function collect(missing, seen, entry) {
	const key = `${entry.role}:${entry.positionId ?? ""}:${entry.taskTypeId ?? ""}:${entry.id}`;
	if (seen.has(key)) return;
	seen.add(key);
	missing.push(entry);
}
/**
* 计算一份工作流定义里的缺失引用。
*
* @param definition 工作流定义（v8）或作业钉住的旧快照（v7）
* @param workers 执行者登记表（按标识符）
* @returns 可用性：缺哪些标识符、分别在哪
*/
function definitionAvailability(definition, workers) {
	const missing = [];
	const seen = /* @__PURE__ */ new Set();
	for (const position of definition.positions) {
		const executorId = executorRef(position.executor);
		if (executorId !== null && !hasWorker(workers, executorId)) collect(missing, seen, {
			id: executorId,
			role: "executor",
			positionId: position.id,
			positionLabel: position.label
		});
		for (const taskType of position.taskTypes) {
			const assistantId = typeof taskType.assistant === "string" ? taskType.assistant.trim() : "";
			if (assistantId !== "" && !hasWorker(workers, assistantId)) collect(missing, seen, {
				id: assistantId,
				role: "assistant",
				positionId: position.id,
				positionLabel: position.label,
				taskTypeId: taskType.id,
				taskTypeLabel: taskType.label
			});
		}
	}
	if (missing.length === 0) return AVAILABLE;
	return {
		available: false,
		missingWorkers: missing
	};
}
/**
* 计算一个作业的派生可用性：钉住的定义 + 交回方式的助理。
*
* @param job 作业记录
* @param workers 执行者登记表（按标识符）
* @returns 可用性
*/
function jobAvailability(job, workers) {
	const missing = [...definitionAvailability(job.definition, workers).missingWorkers];
	const deliveryId = deliveryWorkerRef(job.delivery);
	if (deliveryId !== null && !hasWorker(workers, deliveryId)) missing.push({
		id: deliveryId,
		role: "delivery"
	});
	if (missing.length === 0) return AVAILABLE;
	return {
		available: false,
		missingWorkers: missing
	};
}
/**
* 把缺失引用拼成一句可展示的原因（工具 / 报错都用它）。
*
* @param availability 可用性
* @returns 一句话；可用时是空串
*/
function describeUnavailable(availability) {
	if (availability.available) return "";
	return availability.missingWorkers.map((entry) => {
		if (entry.role === "delivery") return `delivery assistant "${entry.id}"`;
		if (entry.role === "assistant") return `task type "${entry.taskTypeId ?? entry.id}" assistant "${entry.id}"`;
		return `position "${entry.positionLabel ?? entry.positionId ?? ""}" executor "${entry.id}"`;
	}).join("; ");
}
/**
* 判断一份工作流定义是否引用了某个执行者标识符。
*
* 引用 = 岗位主体、任务类型助理（定义里是字符串）。
*
* @param definition 工作流定义 / 作业快照
* @param id 执行者标识符
* @returns 引用时为 true
*/
function definitionReferencesWorker(definition, id) {
	if (typeof id !== "string" || id === "") return false;
	for (const position of definition.positions) {
		if (executorRef(position.executor) === id) return true;
		for (const taskType of position.taskTypes) if (typeof taskType.assistant === "string" && taskType.assistant.trim() === id) return true;
	}
	return false;
}
/**
* 判断一个作业是否引用了某个执行者标识符：钉住的定义 + 交回方式。
*
* v7 作业快照用 `name` 兜底，读取时统一按标识符比较。
*
* @param job 作业记录
* @param id 执行者标识符
* @returns 引用时为 true
*/
function jobReferencesWorker(job, id) {
	if (definitionReferencesWorker(job.definition, id)) return true;
	return deliveryWorkerRef(job.delivery) === id;
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
- 代办失败的作业直接 `failed`，任务不退回 `ready`（ADR 0022）；
* - 失败任务被用户放弃（取消）后，依赖它的任务 `blocked`；
* - 失败作业可以重启（ADR 0023）：作业 `failed → running`；失败任务回到 `ready`，
*   因作业终止被取消的任务回到 `pending`，被阻塞的任务等依赖恢复后再 `pending`；
*   人主动取消的任务不复活。
* - 业务「不通过」不是状态：结果里写 `result: "fail"`，由主体再派新任务。
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
		"cancelled"
	],
	completed: [],
	failed: ["ready", "cancelled"],
	blocked: ["cancelled", "pending"],
	cancelled: ["pending"]
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
/** 合法作业状态转换矩阵；`failed -> running` 是人的显式重启（ADR 0023）。 */
const JOB_TRANSITIONS = Object.freeze({
	running: [
		"completed",
		"failed",
		"cancelled"
	],
	completed: [],
	failed: ["running"],
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
// .build/workflows/engine/prompt.js
/**
* 任务执行上下文组装。
*
* 一个任务 = 一条全新会话。执行提示词包含固定顺序的几段：
*
* 1. 工作流基准规则（引擎注入的能力说明：读写资产、创建后续任务、提交结果）；
* 2. 工作树规则（仅任务类型的 `worktree` 不是 `none` 时出现：`create` 要求
*    执行者自己按仓库调用 `create_worktree`，`guard` 只要求发现未提交修改时
*    先停下来问用户）；
* 3. 任务类型的定义：这个任务类型是谁、要做什么、有什么预设信息；
* 4. 任务内容：创建者这一次给出的东西。
*
* 岗位名、通道 id、作业编号、依赖清单等属于编排与页面层的信息，不进入执行
* 提示词，避免把「岗位 / 通道」这些构建工作流的概念暴露给执行者。
*
* 派发时拆成两条消息投递：规则 + 内容走非用户来源的上下文，只有任务类型
* 的定义按用户身份投递（宿主只在这类消息里识别 `/skill-name` 手势）。落盘的
* prompt 文件仍保存完整文本。
*
* 同时负责结束任务的投递文本。
*
* @module @buka/dsh-plugin-workflows/engine/prompt
*/
/** 基准规则：能力说明，不暴露岗位 / 通道。 */
const BASELINE_RULES = [
	"## 工作流规则",
	"- 读取资产：`buka_job_attachments` 列出并读取本任务可用的附件；`buka_job_board` 查看本作业的任务，`buka_task_get` 读取某个任务。",
	"- 写入资产：提交结果时用 `buka_task_complete` 的 `attachments` 归档产出文件（path 相对你的工作目录）；`text` 写一段给人看的总结。",
	"- 创建后续任务：`buka_task_targets` 列出当前可创建的任务，`buka_task_create` 按 `target` 和 `content` 创建（不传 `deps` 时默认依赖本任务）；是否需要创建、创建什么，见下面的任务类型的定义。",
	"- 完成任务：用 `buka_task_complete` 交回一段总结；结果没有结构化契约。"
].join("\n");
/** 工作树生效时的规则：执行者自己按仓库调用 `create_worktree`，不要直接改原检出。 */
const WORKTREE_RULES = ["## 工作树", "本任务需要改动代码时，不要直接修改原检出：先进入要修改的仓库目录，调用 `create_worktree` 新建并进入它的 Git 工作树，之后的读写和命令都在这个工作树里进行。任务涉及多个仓库时，对每个仓库分别创建 worktree；需要换仓库时先用 `working_directory` 切到那个仓库的目录。同一个仓库只创建一个工作树，任务结束前不要删除检出。"].join("\n");
/** 保护检查规则：不创建 worktree，先看工作区有没有未提交的修改，有就停下来问。 */
const WORKTREE_GUARD_RULES = ["## 工作区", "本任务不创建新的工作树。开始前先检查当前工作区以及任务要修改的每个仓库是否有未提交的修改；如果有，必须停下来询问用户，得到明确答复前不要开始改动。"].join("\n");
/** 人任务助理的基准规则：代人处理，动作由人确认。 */
const ASSISTANT_RULES = [
	"## 工作流规则",
	"- 你代表人与工作人员沟通，拿到人的决定后用 `buka_task_complete` 提交。",
	"- 读取资产：`buka_job_attachments` 列出并读取本任务可用的附件。",
	"- 写入资产：提交结果时用 `attachments` 归档产出文件（path 相对你的工作目录）。",
	"- 需要创建后续任务时，用 `buka_task_actions` 看这个任务可选的动作，用 `buka_task_complete` 带上 `action` 与 `input`。"
].join("\n");
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
/** 工作树段：按实际形态选一条规则；没有配置工作树返回 null。 */
function worktreeSection(mode) {
	if (mode === "create") return WORKTREE_RULES;
	if (mode === "guard") return WORKTREE_GUARD_RULES;
	return null;
}
/** 有内容时给出一段；空串 / 缺省时整段省略。 */
function textSection(title, text) {
	const trimmed = typeof text === "string" ? text.trim() : "";
	return trimmed === "" ? null : `## ${title}\n${trimmed}`;
}
/** 任务内容段：字符串原样，其余按 JSON 展示。 */
function contentSection(content) {
	if (typeof content === "string") return ["## 任务内容", content].join("\n");
	return [
		"## 任务内容",
		"```json",
		JSON.stringify(content, null, 2),
		"```"
	].join("\n");
}
/** 把非空段用空行拼起来。 */
function joinSections(sections) {
	return sections.filter((section) => section !== null).join("\n\n");
}
/**
* 按作者拆分执行提示。
*
* @param input 任务、岗位与任务类型
* @returns 完整文本、上下文段与用户提示段
*/
function buildExecutionPromptSections(input) {
	const { taskType, task } = input;
	const definition = typeof taskType.definition === "string" ? taskType.definition.trim() : "";
	const content = contentSection(task.content);
	const worktree = worktreeSection(input.worktree);
	return {
		context: joinSections([
			BASELINE_RULES,
			worktree,
			content
		]),
		userPrompt: definition === "" ? null : definition,
		prompt: joinSections([
			BASELINE_RULES,
			worktree,
			definition === "" ? null : `## 任务类型的定义\n${definition}`,
			content
		])
	};
}
/**
* 结束任务的投递文本：把最终报告交给发起人，等待确认。
*
* @param job 作业
* @param task 结束任务
* @returns 投递文本
*/
function buildEndDeliveryText(job, task) {
	return [
		`工作流「${job.workflowName}」的作业 #${job.seq} 已经运行到最后一步，最终报告如下：`,
		"",
		contentSection(task.content),
		"",
		"如果这份报告就是你要的结果，调用 `buka_task_complete` 确认收到，作业即结束。"
	].join("\n");
}
/**
* 助理承办人任务的 prompt。
*
* @param input 任务、岗位与任务类型
* @returns prompt 文本
*/
function buildAssistantPrompt(input) {
	const { taskType, task } = input;
	return joinSections([
		ASSISTANT_RULES,
		textSection("任务类型的定义", taskType.definition),
		contentSection(task.content)
	]);
}
// .build/workflows/engine/board.js
/**
* 页面 / 工具用的只读投影：任务摘要、任务详情、作业摘要、定义摘要与看板计数。
*
* 形状以 ADR 0015 为准；`GET /job` 的 `definition` 带完整
* positions[].taskTypes，客户端不需要再拉工作流兜底。
*
* @module @buka/dsh-plugin-workflows/engine/board
*/
/** 摘要文本上限。 */
const SUMMARY_BYTES = 240;
/**
* 把执行者登记里的展示名 / driver / avatar 补到主体上（只用于展示）。
*
* 旧作业快照只有 `name`（当时的标识符）；这里统一投影出 `id`，并优先用登记
* 表里算好的展示名覆盖 `name`。登记表查不到时保留快照里的值并标记
* `missing: true`，交给页面显示占位头像与「已删除」。
*/
function executorView(executor, workers) {
	if (executor.kind === "human") return executor;
	const id = executorRef(executor);
	const worker = id === null ? void 0 : workers?.get(id);
	if (worker === void 0) return {
		...executor,
		...id === null ? {} : { id },
		...workers === void 0 ? {} : { missing: true }
	};
	return {
		...executor,
		...id === null ? {} : { id },
		name: worker.displayName,
		driver: worker.driver,
		...worker.avatar === void 0 ? {} : { avatar: worker.avatar }
	};
}
/**
* 交回方式的展示投影：助理用展示名覆盖 `name`，保留 `id` 供页面消歧；
* 助理已不在登记表里时标 `missing: true`。
*
* @param delivery 钉住的交回方式
* @param workers 执行者登记表
* @returns 契约形状的交回方式
*/
function deliveryView(delivery, workers) {
	if (delivery.kind !== "assistant") return delivery;
	const id = deliveryWorkerRef(delivery);
	const worker = id === null ? void 0 : workers?.get(id);
	if (worker === void 0) return {
		kind: "assistant",
		...id === null ? {} : { id },
		...delivery.name === void 0 ? {} : { name: delivery.name },
		...workers === void 0 ? {} : { missing: true }
	};
	return {
		kind: "assistant",
		...id === null ? {} : { id },
		name: worker.displayName
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
		channel: task.channel,
		status: task.status,
		deps: [...task.deps],
		createdAt: task.createdAt,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		claimant: task.claimant,
		attemptCount: task.attemptIds.length,
		attachmentCount: task.result?.attachmentIds.length ?? 0,
		resultSummary: task.result === null ? null : clipUtf8(task.result.text.trim(), SUMMARY_BYTES) || null
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
	const channel = task.channel === null ? void 0 : findChannel(definition, task.channel);
	const dependencyTasks = task.deps.map((dependencyId) => input.tasks.find((candidate) => candidate.id === dependencyId)).filter((candidate) => candidate !== void 0);
	const attachments = input.attachments.filter((attachment) => task.result?.attachmentIds.includes(attachment.id));
	return {
		id: task.id,
		jobId: task.jobId,
		position: task.position,
		positionLabel: positionLabel(definition, task.position),
		type: task.type,
		typeLabel: taskTypeLabel(definition, task.type),
		channel: task.channel,
		channelLabel: channel?.label ?? "",
		status: task.status,
		content: task.content,
		deps: dependencyTasks.map((dependency) => taskSummary(dependency, definition)),
		createdAt: task.createdAt,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		claimant: task.claimant,
		attempts: input.attempts.map(attemptSummary),
		result: task.result === null ? null : {
			text: task.result.text,
			...task.result.action === void 0 ? {} : { action: task.result.action },
			...task.result.input === void 0 ? {} : { input: task.result.input },
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
* @param availability 派生的可用性（缺引用时页面标不可用）
* @returns 契约形状
*/
function jobSummary(job, tasks, availability) {
	return {
		id: job.id,
		seq: job.seq,
		status: job.status,
		inputSummary: job.inputSummary,
		definitionVersion: job.definition.version,
		delivery: job.delivery,
		taskCounts: countTasks(tasks),
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		...availability === void 0 ? {} : { availability }
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
		version: definition.version,
		name: definition.name,
		...definition.description === void 0 ? {} : { description: definition.description },
		positions: definition.positions.map((position) => ({
			id: position.id,
			label: position.label,
			...position.note === void 0 ? {} : { note: position.note },
			executor: executorView(position.executor, workers),
			taskTypes: position.taskTypes.map((taskType) => ({
				id: taskType.id,
				label: taskType.label,
				...taskType.definition === void 0 ? {} : { definition: taskType.definition },
				...taskType.content === void 0 ? {} : { content: taskType.content },
				...taskType.actions === void 0 ? {} : { actions: taskType.actions },
				...taskType.creates === void 0 ? {} : { creates: taskType.creates },
				...taskType.assistant === void 0 ? {} : { assistant: taskType.assistant },
				...taskType.plan === void 0 ? {} : { plan: taskType.plan },
				...taskType.agentPreset === void 0 ? {} : { agentPreset: taskType.agentPreset },
				...taskType.concurrency === void 0 ? {} : { concurrency: taskType.concurrency },
				...taskType.worktree === void 0 ? {} : { worktree: taskType.worktree }
			}))
		})),
		channels: definition.channels,
		start: {
			label: "开始",
			...definition.start.content === void 0 ? {} : { content: definition.start.content }
		},
		end: {
			label: "结束",
			...definition.end.content === void 0 ? {} : { content: definition.end.content }
		}
	};
}
/**
* 工作流详情里的图（positions / channels / start / end）。
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
		channels: definition.channels.map((channel) => ({
			id: channel.id,
			label: channel.label,
			from: channel.from,
			to: channel.to,
			types: channel.types ?? [],
			back: channel.back === true
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
		logger?.warn?.(`buka-workflows: could not append job event ${type}: ${describeError$4(error)}`);
	}
}
// .build/workflows/engine/session.js
/**
* 发起人会话投递与执行者句柄读取。
*
* 开始 / 结束任务的主体是发起人。发起人可能是普通会话：插件通过宿主
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
			if ("error" in resolved && resolved.error !== void 0) throw new Error(`cannot resume starter session "${sessionId}": ${describeError$4(resolved.error)}`);
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
* 读一次执行者句柄的观测结果。
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
* 任务创建校验与记录构造。
*
* 创建任务的入口有三个：引擎按 `start.next` 生成初始任务、执行中的任务通过
* `buka_task_create` 派生任务、人任务的动作创建任务。三者共享同一套校验：
*
* 1. 通道存在、起点是创建任务的节点；
* 2. 任务类型是目标岗位声明的类型（结束任务用 `end` 契约）；
* 3. 通道写了类型白名单时，类型在白名单里；
* 4. 任务内容符合目标任务类型的 content schema；
* 5. 依赖 id 属于本作业、已存在、不是自己、依赖图不成环；
* 6. 作业预算未超。
*
* @module @buka/dsh-plugin-workflows/engine/tasks
*/
/**
* 解析节点主体，构造任务记录里钉住的主体。
*
* 开始 / 结束任务的主体都是发起人；结束任务选了「交给助理」时是那个助理。
*
* @param definition 定义
* @param positionId 岗位 id
* @param job 作业
* @param workers 执行者登记表
* @returns 钉住的主体
*/
function resolveExecutor(definition, positionId, job, workers) {
	if (positionId === "start") return {
		kind: "worker",
		id: ENGINE_WORKER_ID,
		driver: "robot",
		program: ENGINE_PROGRAM_ID
	};
	if (positionId === "end") {
		if (job.delivery.kind === "assistant") {
			const deliveryId = deliveryWorkerRef(job.delivery);
			const worker = deliveryId === null ? void 0 : workers.get(deliveryId);
			if (worker === void 0) throw new WorkflowError("unknown-worker", `the delivery assistant identifier "${deliveryId ?? ""}" is not registered`);
			return {
				kind: "worker",
				id: worker.id,
				driver: worker.driver,
				...worker.program === void 0 ? {} : { program: worker.program },
				...worker.avatar === void 0 ? {} : { avatar: worker.avatar }
			};
		}
		return job.starter.kind === "human" ? { kind: "human" } : {
			kind: "session",
			sessionId: job.starter.sessionId
		};
	}
	const position = findPosition(definition, positionId);
	if (position === void 0) throw new WorkflowError("unknown-position", `unknown position "${positionId}"`);
	if (position.executor.kind === "human") return { kind: "human" };
	const executorId = executorRef(position.executor);
	const worker = executorId === null ? void 0 : workers.get(executorId);
	if (worker === void 0) throw new WorkflowError("unknown-worker", `position "${positionId}" uses worker identifier "${executorId ?? ""}", which is not registered`);
	return {
		kind: "worker",
		id: worker.id,
		driver: worker.driver,
		...worker.program === void 0 ? {} : { program: worker.program },
		...worker.avatar === void 0 ? {} : { avatar: worker.avatar }
	};
}
/**
* 按机器人的内容契约校验任务内容。
*
* 契约属于程序本身（见 `program/contracts.ts`）；任务类型声明的 schema 是作者
* 视角的格式约束，两者都不通过就拒绝创建。
*
* @param assignee 任务钉住的主体
* @param content 渲染后的任务内容
* @throws `WorkflowError('invalid-content')` 内容不满足机器人契约
*/
function assertRobotContent(assignee, content) {
	if (assignee.kind !== "worker" || assignee.driver !== "robot") return;
	const problems = programContentProblems(assignee.program, content);
	if (problems.length === 0) return;
	const program = normalizeProgramId(assignee.program);
	throw new WorkflowError("invalid-content", `content does not match robot identifier "${storedExecutorRef(assignee) ?? ""}" (program "${program}"): ${problems.join("; ")}`);
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
* @param input 创建者、通道、类型、任务内容与依赖
* @returns 新任务记录与初始状态
* @throws `WorkflowError`（code 稳定）表示创建被拒绝
*/
function buildCreatedTask(input) {
	const { job, creator, channel: channelId, type, content, deps, tasks, workers } = input;
	const definition = job.definition;
	if (job.status !== "running") throw new WorkflowError("job-not-running", `job ${job.id} is not running`);
	if (creator.status !== "running") throw new WorkflowError("creator-not-running", `task ${creator.id} is not ${creator.status}; only a running task can create tasks`);
	const channel = resolveDispatchChannel(definition, creator.position, channelId);
	const position = channel.to;
	if (position === "start") throw new WorkflowError("invalid-target", "tasks cannot be dispatched to the built-in start node");
	const taskType = resolveTargetTaskType(definition, position, type);
	if (!channelAllowsType(channel, taskType.id)) throw new WorkflowError("type-not-allowed", `channel "${channel.id}" (${channel.from} -> ${channel.to}) does not allow task type "${taskType.id}"`);
	const problems = contentProblems(taskType, content);
	if (problems.length > 0) throw new WorkflowError("invalid-content", `content does not match task type "${taskType.id}": ${problems.join("; ")}`);
	const assignee = resolveExecutor(definition, position, job, workers);
	assertRobotContent(assignee, content);
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
			channel: channel.id,
			content,
			deps: dependencyIds,
			status: ready ? "ready" : "pending",
			createdBy: {
				taskId: creator.id,
				position: creator.position
			},
			assignee,
			claimant: null,
			attemptIds: [],
			result: null,
			error: null,
			createdAt: now,
			startedAt: null,
			finishedAt: null,
			updatedAt: now
		},
		ready
	};
}
/**
* 按任务类型校验任务内容，返回可读的问题列表。
*
* @param taskType 目标任务类型（结束任务是合成契约）
* @param content 任务内容
* @returns 问题列表；空表示通过
*/
function contentProblems(taskType, content) {
	if (taskType.content === void 0) return [];
	return contentIssues(taskType.content, content).map((issue) => `${issue.path} ${issue.message}`);
}
/**
* 解析一条可用的派发通道：必须存在、从创建者岗位出发。
*
* @param definition 定义
* @param from 创建者岗位（启动任务是 `start`）
* @param channelId 请求的通道 id
* @returns 通道
* @throws `WorkflowError` 通道不存在或起点不符
*/
function resolveDispatchChannel(definition, from, channelId) {
	const channel = findChannel(definition, channelId);
	if (channel === void 0) {
		const available = channelsFrom(definition, from);
		throw new WorkflowError("no-channel", `unknown channel "${channelId}"; channels from "${from}": ${available.length === 0 ? "(none)" : available.map((item) => `${item.id}「${item.label}」-> ${item.to}`).join(", ")}`);
	}
	if (channel.from !== from) throw new WorkflowError("channel-not-own", `channel "${channel.id}" starts at "${channel.from}"; this task is at "${from}"`);
	return channel;
}
/**
* 解析目标岗位与任务类型（结束任务用内建契约）。
*
* @param definition 定义
* @param position 目标岗位
* @param type 请求的类型 id
* @returns 目标岗位与任务类型
*/
function resolveTarget(definition, position, type) {
	if (position === "end") return {
		position,
		taskType: resolveTargetTaskType(definition, position, type)
	};
	const taskType = findTaskType(definition, type);
	const positionDef = definition.positions.find((candidate) => candidate.id === position);
	if (taskType === void 0 || positionDef?.taskTypes.every((candidate) => candidate.id !== type)) throw new WorkflowError("invalid-type", `"${type}" is not a task type of position "${position}"`);
	return {
		position,
		taskType
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
			definition: "把作业的最终报告交给发起人；发起人确认收到后完成。",
			...definition.end.content === void 0 ? {} : { content: definition.end.content }
		};
	}
	const taskType = findTaskType(definition, type);
	const positionDef = definition.positions.find((candidate) => candidate.id === position);
	if (taskType === void 0 || positionDef?.taskTypes.every((candidate) => candidate.id !== type)) throw new WorkflowError("invalid-type", `"${type}" is not a task type of position "${position}"`);
	return taskType;
}
/**
* 渲染一条创建声明：解析通道、目标类型与任务内容。
*
* @param definition 定义
* @param from 声明所在的节点（`start` 或岗位 id）
* @param creation 创建声明
* @param context 模板上下文（`content` / `input`）
* @returns 渲染好的目标、通道与任务内容
*/
function renderCreation(definition, from, creation, context) {
	const channel = resolveDispatchChannel(definition, from, creation.channel);
	const position = channel.to;
	if (position === "start") throw new WorkflowError("invalid-target", "tasks cannot be dispatched to the start node");
	const { taskType } = resolveTarget(definition, position, position === "end" ? "end" : creation.type ?? "");
	if (position !== "end" && !channelAllowsType(channel, taskType.id)) throw new WorkflowError("type-not-allowed", `channel "${channel.id}" does not allow task type "${taskType.id}"`);
	const rendered = renderPayload(creation.content ?? {}, buildTemplateContext({
		content: context.content ?? null,
		input: context.input ?? null
	}));
	const problems = contentProblems(taskType, rendered);
	if (problems.length > 0) throw new WorkflowError("invalid-content", `content does not match task type "${taskType.id}": ${problems.join("; ")}`);
	return {
		channel,
		position,
		taskType,
		content: rendered
	};
}
/**
* 生成 `start.next` 发布的初始任务。
*
* 启动任务已完成：它们的唯一依赖是本次作业的启动任务，所以初始状态都是
* `ready`。
*
* @param input 作业、启动任务、已有任务与执行者表
* @returns 新任务记录
*/
function buildInitialTasks(input) {
	const { job, startTask, workers } = input;
	const definition = job.definition;
	const tasks = [...input.tasks];
	const created = [];
	for (const [index, creation] of definition.start.next.entries()) {
		if (tasks.length + 1 > definition.budgets.maxTasks) throw new WorkflowError("budget-exceeded", `workflow budget maxTasks=${definition.budgets.maxTasks} would be exceeded by initial task ${index}`);
		const parsed = renderCreation(definition, "start", creation, { content: startTask.content });
		const now = nowIso();
		const assignee = resolveExecutor(definition, parsed.position, job, workers);
		assertRobotContent(assignee, parsed.content);
		const task = {
			id: newTaskId(),
			jobId: job.id,
			position: parsed.position,
			type: parsed.taskType.id,
			channel: parsed.channel.id,
			content: parsed.content,
			deps: [startTask.id],
			status: "ready",
			createdBy: {
				taskId: startTask.id,
				position: "start"
			},
			assignee,
			claimant: null,
			attemptIds: [],
			result: null,
			error: null,
			createdAt: now,
			startedAt: null,
			finishedAt: null,
			updatedAt: now
		};
		tasks.push(task);
		created.push(task);
	}
	return created;
}
// .build/workflows/engine/worktree.js
/**
* 工作树能力探测。
*
* 任务类型上的 `worktree` 开关不自己建检出：执行者可能同时改动多个仓库，
* 具体从哪个仓库、建几个 worktree 由执行者按任务判断。插件只负责确认宿主
* 同时提供了工作树服务与 `create_worktree` 工具，并在提示词里教执行者使用；
* 缺少任一能力时忽略开关，改用工作区保护提示。
*
* 探测放在执行时而不是保存定义时：插件可能后装 / 卸载，同一份定义在不同
* 组合里应当按实际能力执行。
*
* @module @buka/dsh-plugin-workflows/engine/worktree
*/
/** 宿主是否同时启用了工作树服务和 `create_worktree` 模型工具。 */
function worktreeToolAvailable(ctx) {
	try {
		const tools = ctx?.get?.("tools");
		if (typeof tools?.get !== "function") return false;
		if (tools.get("create_worktree") === void 0) return false;
		return typeof (ctx?.get?.("worktrees"))?.create === "function";
	} catch {
		return false;
	}
}
// .build/workflows/engine/engine.js
/**
* 工作流引擎：作业创建、调度、执行、派发校验、结算、取消、重试与恢复。
*
* 设计要点（ADR 0006-0015）：
*
* - 任务是唯一执行单元；任务依赖纯显式，依赖图无环；
* - 并发度属于任务类型（同一作业内按类型计数，默认 1），岗位只是定义的书写
*   载体；人任务不占引擎额度，助理仍一次一条；机器人直接完成；
* - 记状态变更全部串行化到 per-job 队列；长等待的会话 / 定时器在队列外执行，
*   完成时再回队列提交状态；
* - 一个任务一条新会话，不复用、不压缩；重启时只续接同一条会话。
*
* @module @buka/dsh-plugin-workflows/engine
*/
/** 任务结果文本在记录里的预览上限。 */
const RESULT_PREVIEW_BYTES = 4096;
/** 执行者登记表缓存时间。 */
const WORKER_CACHE_MS = 5e3;
/**
* 任务完成后再等多久释放会话句柄。
*
* `buka_task_complete` 是在会话的当前轮里调用的：立即释放会把这一轮掐断，模型
* 的收尾回复不会生成。任务结果已经记好，所以先等这一轮落定再释放；等待本身
* 有上限，避免一直挂在会话上。正常模型的收尾回复远短于 5 分钟，这个上限只兜底
* 「turn 永不结束」。
*/
const RETIRE_GRACE_MS = 3e5;
/**
* 作业快照仍可读的版本范围。
*
* v7 快照不迁移：主体 / 交回方式里的 `name` 按旧字段兜底；v8 是当前格式。
*/
function isSupportedJobDefinitionVersion(version) {
	return version >= 7 && version <= 8;
}
/** 从 workers 服务读登记表，转成本插件关心的形状。 */
function parseWorkerCatalog(raw) {
	const catalog = /* @__PURE__ */ new Map();
	const entries = Array.isArray(raw) ? raw : raw !== null && typeof raw === "object" && Array.isArray(raw.workers) ? raw.workers ?? [] : [];
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") continue;
		const record = entry;
		const name = typeof record.name === "string" ? record.name.trim() : "";
		const id = typeof record.id === "string" && record.id.trim() !== "" ? record.id.trim() : name;
		if (id === "") continue;
		const displayName = typeof record.displayName === "string" && record.displayName.trim() !== "" ? record.displayName.trim() : name !== "" ? name : id;
		const driver = record.driver === "robot" || record.driver === "program" ? "robot" : "agent";
		catalog.set(id, {
			id,
			name,
			displayName,
			driver,
			...typeof record.program === "string" && record.program !== "" ? { program: record.program } : {},
			...typeof record.description === "string" ? { description: record.description } : {},
			...typeof record.avatar === "string" ? { avatar: record.avatar } : {},
			...typeof record.path === "string" && record.path !== "" ? { path: record.path } : {},
			...driver === "agent" && typeof record.agentPreset === "string" && record.agentPreset !== "" ? { agentPreset: record.agentPreset } : {}
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
	ctx;
	store;
	options;
	logger;
	workersOf;
	delivery;
	worktreeAvailableOf;
	/** 任务完成后等当前轮落定的最长时长；见 `EngineDeps.retireGraceMs`。 */
	retireGraceMs;
	active = /* @__PURE__ */ new Map();
	/** 任务已完成、等当前轮落定后再释放的句柄。 */
	retiring = /* @__PURE__ */ new Set();
	sessionTasks = /* @__PURE__ */ new Map();
	busyAssistants = /* @__PURE__ */ new Set();
	deliveryBlocked = /* @__PURE__ */ new Set();
	catalog = /* @__PURE__ */ new Map();
	catalogAt = 0;
	started = false;
	disposed = false;
	constructor(deps) {
		this.ctx = deps.ctx;
		this.store = deps.store;
		this.options = deps.options;
		this.logger = deps.logger;
		this.workersOf = deps.workers;
		this.delivery = deps.delivery;
		this.worktreeAvailableOf = deps.worktreeAvailable ?? (() => worktreeToolAvailable(deps.ctx));
		this.retireGraceMs = deps.retireGraceMs ?? RETIRE_GRACE_MS;
	}
	/** 启动引擎：刷新执行者登记表并恢复未完成的作业。 */
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
		for (const handle of this.retiring) this.disposeHandle(handle);
		this.retiring.clear();
		this.sessionTasks.clear();
	}
	/**
	* 任务完成后的延迟释放：先等当前轮落定，再释放会话句柄。
	*
	* 等待有上限（`RETIRE_GRACE_MS`）；引擎停用 / 宿主退出时 `dispose()` 会立即
	* 释放仍在等待的句柄。
	*
	*/
	retireHandle(handle) {
		this.retiring.add(handle);
		const settle = typeof handle.whenIdle === "function" ? Promise.resolve().then(() => handle.whenIdle?.()) : Promise.resolve();
		let timer;
		const grace = new Promise((resolve) => {
			timer = setTimeout(resolve, this.retireGraceMs);
			timer.unref?.();
		});
		Promise.race([settle, grace]).catch(() => void 0).finally(() => {
			if (timer !== void 0) clearTimeout(timer);
			this.retiring.delete(handle);
			this.disposeHandle(handle);
		});
	}
	/** 释放一个 workers 句柄。 */
	disposeHandle(handle) {
		if (handle === null) return;
		try {
			if (typeof handle.dispose === "function") handle.dispose();
		} catch {}
	}
	/**
	* 刷新执行者登记表（默认 5s 缓存）。
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
			this.logger?.warn?.(`buka-workflows: could not read the workers registry: ${describeError$4(error)}`);
			this.catalog = /* @__PURE__ */ new Map();
		}
		this.catalogAt = Date.now();
		return this.catalog;
	}
	/** 取执行者登记表（按标识符）。 */
	async workers() {
		return await this.refreshWorkers();
	}
	/**
	* 宿主有没有工作树能力（`ctx.worktrees` 服务 + `create_worktree` 工具）。
	*
	* 探测放在执行时而不是保存定义时：插件可能后装 / 卸载，同一份定义在不同
	* 组合里应当按实际能力执行。探测抛错按「没有启用」处理。
	*/
	worktreeAvailable() {
		try {
			return this.worktreeAvailableOf() === true;
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not detect the worktree plugin: ${describeError$4(error)}`);
			return false;
		}
	}
	/**
	* 校验并保存工作流定义：没有 id 时新建（默认启用），有 id 时追加一个版本。
	*
	* @param input 定义与可选工作流 id
	* @returns 保存后的工作流记录
	*/
	async saveWorkflow(input) {
		const workers = await this.workers();
		const presets = await this.availablePresetIds();
		const validated = validateWorkflowDefinition(input.definition, {
			workers,
			presets
		});
		if (!validated.ok) throw new WorkflowError("invalid-definition", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
		const definition = validated.definition;
		return {
			...input.workflowId !== void 0 && input.workflowId !== "" ? await this.saveExistingVersion(input.workflowId, definition) : await this.store.createWorkflow({
				name: definition.name,
				description: definition.description ?? "",
				definition,
				status: "active"
			}),
			warnings: validated.warnings
		};
	}
	/** 追加一个工作流版本；工作流不存在时报错。 */
	async saveExistingVersion(workflowId, definition) {
		if (this.store.getWorkflow(workflowId) === void 0) throw new WorkflowError("not-found", `workflow not found: ${workflowId}`);
		return await this.store.saveWorkflowVersion(workflowId, definition);
	}
	/**
	* 当前可用的执行者预设 id；composition 里没有 `agentPresets` 服务时返回
	* `undefined`（无法判定，保存时只校验字段形状）。
	*/
	async availablePresetIds() {
		let service;
		try {
			service = this.ctx?.get?.("agentPresets");
		} catch {
			service = void 0;
		}
		if (service === null || service === void 0 || typeof service.list !== "function") return;
		try {
			const rows = await service.list();
			if (!Array.isArray(rows)) return void 0;
			const ids = [];
			for (const row of rows) {
				if (row === null || typeof row !== "object") continue;
				const id = row.id;
				if (typeof id === "string" && id.trim() !== "") ids.push(id.trim());
			}
			return new Set(ids);
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not read the agent preset roster: ${describeError$4(error)}`);
			return;
		}
	}
	/**
	* 工作流列表投影。
	*
	* 读时现取执行者登记表，给每条工作流算派生的可用性：引用了已不存在的
	* 执行者时标不可用并列出缺失的标识符（不落盘）。
	*
	* @returns 工作流摘要
	*/
	async listWorkflowSummaries() {
		const workers = await this.workers();
		return this.store.listWorkflows().map((workflow) => {
			const latest = this.store.readWorkflowVersion(workflow.id);
			const availability = latest === null ? {
				available: true,
				missingWorkers: []
			} : definitionAvailability(latest.versionRecord.definition, workers);
			return {
				id: workflow.id,
				name: workflow.name,
				description: workflow.description,
				version: workflow.latestVersion,
				definitionVersion: latest?.versionRecord.definition.version,
				status: workflow.status,
				jobCount: this.store.countJobs(workflow.id),
				updatedAt: workflow.updatedAt,
				availability
			};
		});
	}
	/**
	* 读工作流详情（含某个版本的完整定义）。
	*
	* 展示投影要在读取时刷新执行者登记表：图上岗位头像来自 workers 服务，而服务
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
		const jobs = this.store.listJobs(workflowId).map((job) => jobSummary(job, this.store.listTasks(job.id), jobAvailability(job, workers)));
		return {
			workflow: {
				id: found.record.id,
				name: found.versionRecord.definition.name,
				description: found.versionRecord.definition.description ?? "",
				version: found.version,
				status: found.record.status,
				definition: found.versionRecord.definition,
				availability: definitionAvailability(found.versionRecord.definition, workers)
			},
			graph: workflowGraph(found.versionRecord.definition, workers),
			assistants: [...workers.values()].filter((worker) => worker.driver === "agent").map((worker) => ({
				id: worker.id,
				name: worker.displayName,
				...worker.description === void 0 ? {} : { description: worker.description },
				...worker.avatar === void 0 ? {} : { avatar: worker.avatar }
			})),
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
	* 页面人启动作业：发起人填的任务内容就是启动任务的内容，启动任务即刻完成。
	*
	* @param input 工作流、任务内容与交回方式
	* @returns 新作业
	*/
	async createJobFromHuman(input) {
		const { workflow, definition } = this.requireStartableWorkflow(input.workflowId);
		const workers = await this.refreshWorkers(true);
		this.assertDefinitionAvailable(definition, workers, workflow.name);
		return await this.startJob({
			workflow,
			definition,
			workers,
			starter: { kind: "human" },
			content: input.content,
			delivery: this.resolveDelivery(definition, input.delivery, { kind: "human" }, workers)
		});
	}
	/**
	* 会话启动作业：发起人会话给出任务内容，启动任务即刻完成。
	*
	* @param input 工作流、任务内容、发起人会话与交回方式
	* @returns 新作业
	*/
	async createJobFromSession(input) {
		const { workflow, definition } = this.requireStartableWorkflow(input.workflowId);
		const workers = await this.refreshWorkers(true);
		this.assertDefinitionAvailable(definition, workers, workflow.name);
		const starter = {
			kind: "session",
			sessionId: input.sessionId
		};
		return await this.startJob({
			workflow,
			definition,
			workers,
			starter,
			content: input.content,
			delivery: this.resolveDelivery(definition, input.delivery, starter, workers)
		});
	}
	/**
	* 建作业 + 启动任务 + 初始任务。
	*
	* 作业与启动任务都由引擎程序创建（ADR 0030）：作业先落盘，随后引擎程序按
	* 开始任务类型的参数 schema 校验输入；失败时保留 `failed` 作业与 `failed`
	* 启动任务，调用方拿到带 job id 的错误。
	*/
	async startJob(input) {
		const { definition, workers, starter } = input;
		const job = await this.insertJob({
			workflow: input.workflow,
			definition,
			starter,
			content: input.content,
			delivery: input.delivery,
			...input.restartedFrom === void 0 ? {} : { restartedFrom: input.restartedFrom }
		});
		try {
			await this.store.runExclusive(job.id, async () => {
				const now = nowIso();
				await this.appendEvent(job.id, "job/created", {
					seq: job.seq,
					starter: starter.kind
				});
				try {
					this.checkStartContent(definition, input.content);
					const startTask = this.startTaskRecord(job, input.content, now);
					const initial = buildInitialTasks({
						job,
						startTask,
						tasks: [startTask],
						workers
					});
					await this.store.insertTask(startTask);
					await this.appendEvent(job.id, "task/created", {
						taskId: startTask.id,
						position: "start",
						type: "start",
						channel: null,
						deps: []
					});
					await this.appendEvent(job.id, "task/completed", {
						taskId: startTask.id,
						type: "start"
					});
					for (const task of initial) {
						await this.store.insertTask(task);
						await this.appendEvent(job.id, "task/created", {
							taskId: task.id,
							position: task.position,
							type: task.type,
							channel: task.channel,
							deps: task.deps
						});
					}
					await this.recomputeLocked(job.id);
				} catch (error) {
					const reason = describeError$4(error);
					const failed = this.startTaskRecord(job, input.content, now, reason);
					if (this.store.getTask(failed.id) === void 0) {
						await this.store.insertTask(failed);
						await this.appendEvent(job.id, "task/created", {
							taskId: failed.id,
							position: "start",
							type: "start",
							channel: null,
							deps: []
						});
						await this.appendEvent(job.id, "task/failed", {
							taskId: failed.id,
							error: reason
						});
					}
					const current = this.store.getJob(job.id);
					if (current !== void 0 && current.status === "running") await this.failJobLocked(current, reason, "job/start-failed", { taskId: failed.id });
					throw this.startFailure(error, job.id);
				}
			});
		} catch (error) {
			const current = this.store.getJob(job.id);
			if (current !== void 0 && current.status === "running") await this.store.updateJob(job.id, (record) => ({
				...record,
				status: "failed",
				error: describeError$4(error),
				finishedAt: nowIso(),
				updatedAt: nowIso()
			})).catch(() => void 0);
			throw error;
		}
		return this.store.getJob(job.id) ?? job;
	}
	/** 启动任务记录：引擎是主体与承办者；成功时已完成，失败时带错误。 */
	startTaskRecord(job, content, now, error = null) {
		const failed = error !== null;
		return {
			id: startTaskId(job.id),
			jobId: job.id,
			position: "start",
			type: "start",
			channel: null,
			content,
			deps: [],
			status: failed ? "failed" : "completed",
			createdBy: null,
			assignee: {
				kind: "worker",
				id: ENGINE_WORKER_ID,
				driver: "robot",
				program: ENGINE_PROGRAM_ID
			},
			claimant: {
				kind: "worker",
				name: ENGINE_WORKER_ID,
				sessionId: null
			},
			attemptIds: [],
			result: failed ? null : {
				text: "",
				textBytes: 0,
				textFile: null,
				attachmentIds: []
			},
			error,
			createdAt: now,
			startedAt: now,
			finishedAt: now,
			updatedAt: now
		};
	}
	/** 把启动失败包装成带 job id 的稳定错误（Q16：留痕 + 抛错）。 */
	startFailure(error, jobId) {
		if (error instanceof WorkflowError) return new WorkflowError(error.code, `${error.message} (job ${jobId})`);
		return new WorkflowError("start-failed", `job ${jobId} could not be initialized: ${describeError$4(error)}`);
	}
	/** 校验发起人给的任务内容。 */
	checkStartContent(definition, content) {
		const schema = definition.start.content;
		if (schema === void 0) return;
		const problems = contentIssues(schema, content);
		if (problems.length > 0) throw new WorkflowError("invalid-input", `content does not match the workflow input: ${problems.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
	}
	/** 校验交回方式：被点名的助理必须存在且是智能体（不看任何标记）。 */
	resolveDelivery(_definition, delivery, _starter, workers) {
		if (delivery === void 0 || delivery.kind === "starter") return { kind: "starter" };
		const id = deliveryWorkerRef(delivery);
		const worker = id === null ? void 0 : workers.get(id);
		if (worker === void 0) throw new WorkflowError("invalid-delivery", `unknown assistant identifier "${id ?? ""}"`);
		if (worker.driver !== "agent") throw new WorkflowError("invalid-delivery", `assistant identifier "${worker.id}" must be an agent`);
		return {
			kind: "assistant",
			id: worker.id
		};
	}
	/**
	* 启动作业前检查派生可用性：引用了已不存在的执行者时拒绝启动，并列出
	* 缺哪个标识符。读取既有定义本身不校验，只在真正要跑的时候收紧。
	*
	*/
	assertDefinitionAvailable(definition, workers, workflowName) {
		const availability = definitionAvailability(definition, workers);
		if (availability.available) return;
		throw new WorkflowError("workflow-unavailable", `workflow "${workflowName}" cannot start: it references missing worker identifiers (${describeUnavailable(availability)}); rebind those positions or task types to registered workers first`);
	}
	/** 取一个可启动的工作流：必须存在、未停用、且定义是当前版本。 */
	requireStartableWorkflow(workflowId) {
		const found = this.store.readWorkflowVersion(workflowId);
		if (found === null) throw new WorkflowError("not-found", `workflow not found: ${workflowId}`);
		if (found.record.status !== "active") throw new WorkflowError("workflow-retired", `workflow "${found.record.name}" is not enabled; enable it before starting a job`);
		if (found.versionRecord.definition.version !== 8) throw new WorkflowError("definition-outdated", `workflow "${found.record.name}" is not on the current definition version; ask the orchestrator to rewrite it before starting a job`);
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
			input: input.content,
			delivery: input.delivery,
			inputSummary: summarizeInput(input.content),
			error: null,
			restartCount: 0,
			budgetStartedAt: now,
			...input.restartedFrom === void 0 ? {} : { restartedFrom: input.restartedFrom },
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
	* 与工作流详情一样，展示投影在读取时刷新执行者登记表，让岗位头像保持最新。
	*
	* @param jobId 作业 id
	* @returns 作业详情；不存在时 null
	*/
	async jobDetail(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0) return null;
		if (!isSupportedJobDefinitionVersion(job.definition.version)) return null;
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
				delivery: deliveryView(job.delivery, workers),
				createdAt: job.createdAt,
				updatedAt: job.updatedAt,
				error: job.error,
				restartCount: job.restartCount ?? 0,
				restartedFrom: job.restartedFrom ?? null
			},
			definition: jobDefinition(job.definition, workers),
			tasks: tasks.map((task) => taskSummary(task, job.definition)),
			canRetryDelivery: canRetryDelivery(tasks),
			restart: this.restartView(job, tasks),
			availability: jobAvailability(job, workers)
		};
	}
	/**
	* 重启选项的可用性投影。
	*
	* 只有 `failed` 作业能重启；没有失败任务时只能从头开始；工作流不能按当前
	* 定义启动时（不存在 / 停用 / 不是当前格式）只能从失败位置继续。
	*
	* @param job 作业
	* @param tasks 作业任务
	* @returns 两个选项的可用性与不可用原因代码
	*/
	restartView(job, tasks) {
		if (job.status !== "failed") return {
			failed: {
				available: false,
				reason: "job-not-failed"
			},
			scratch: {
				available: false,
				reason: "job-not-failed"
			}
		};
		if (tasks.some((task) => task.position === "start" && task.status === "failed")) return {
			failed: {
				available: false,
				reason: "start-task-failed"
			},
			scratch: {
				available: false,
				reason: "start-task-failed"
			}
		};
		const scratchProblem = this.scratchRestartProblem(job);
		return {
			failed: tasks.some((task) => task.status === "failed") ? { available: true } : {
				available: false,
				reason: "no-failed-tasks"
			},
			scratch: scratchProblem === null ? { available: true } : {
				available: false,
				reason: scratchProblem
			}
		};
	}
	/** 当前工作流能否作为「从头开始」的定义来源；返回原因代码，可用时为 null。 */
	scratchRestartProblem(job) {
		const found = this.store.readWorkflowVersion(job.workflowId);
		if (found === null) return "workflow-not-found";
		if (found.record.status !== "active") return "workflow-retired";
		if (found.versionRecord.definition.version !== 8) return "definition-outdated";
		return null;
	}
	/**
	* 作业列表（某个工作流下）。
	*
	* 每条作业都带派生的可用性：钉住的定义或交回方式引用了已不存在的执行者时，
	* 页面据此标注「不可用」。
	*
	* @param workflowId 工作流 id
	* @returns 作业摘要
	*/
	async listJobSummaries(workflowId) {
		const workers = await this.workers();
		return this.store.listJobs(workflowId).map((job) => jobSummary(job, this.store.listTasks(job.id), jobAvailability(job, workers)));
	}
	/**
	* 一个执行者标识符的引用面：给 Workers 插件删除前算阻塞与影响面。
	*
	* 引用 = 工作流任一版本定义、或作业钉住的定义里出现该标识符（岗位主体、
	* 任务类型助理），或作业的交回方式点名了它。运行中的作业阻塞删除；已结束
	* 的作业只计数；工作流（含停用）全部列出但不阻塞。
	*
	* @param id 执行者标识符
	* @returns 引用摘要
	*/
	async workerUsage(id) {
		const target = typeof id === "string" ? id.trim() : "";
		if (target === "") return {
			runningJobs: [],
			workflows: [],
			finishedJobs: 0
		};
		const workflows = [];
		for (const record of this.store.listWorkflows()) if (Object.values(record.versions).some((snapshot) => definitionReferencesWorker(snapshot.definition, target))) workflows.push({
			workflowId: record.id,
			name: record.name,
			status: record.status
		});
		const runningJobs = [];
		let finishedJobs = 0;
		for (const job of this.store.allJobs()) {
			if (!jobReferencesWorker(job, target)) continue;
			if (job.status === "running") runningJobs.push({
				jobId: job.id,
				jobSeq: job.seq,
				workflowId: job.workflowId,
				workflowName: job.workflowName,
				jobName: job.workflowName
			});
			else finishedJobs += 1;
		}
		return {
			runningJobs,
			workflows,
			finishedJobs
		};
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
	* 某个会话作为发起人的作业 id（最近创建的优先）。
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
	* 会话能否查看某个作业（发起人或执行中的任务会话）。
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
	* 执行中的任务沿一条通道创建派生任务。
	*
	* @param input 会话、通道、类型、任务内容与依赖
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
				channel: input.channel,
				type: input.type,
				content: input.content,
				deps: input.deps,
				tasks,
				workers
			});
			await this.store.insertTask(created.task);
			await this.appendEvent(job.id, "task/created", {
				taskId: created.task.id,
				position: created.task.position,
				type: created.task.type,
				channel: created.task.channel,
				deps: created.task.deps,
				createdBy: creator.id
			});
			await this.recomputeLocked(job.id);
			return this.store.getTask(created.task.id) ?? created.task;
		});
	}
	/**
	* 当前任务可以创建的下游目标：只给任务类型与任务内容格式，不暴露岗位 / 通道。
	*
	* @param sessionId 任务会话
	* @returns 目标列表；没有可创建目标时为空
	*/
	creatableTargetsForSession(sessionId) {
		const reference = this.sessionTasks.get(sessionId);
		if (reference === void 0) return [];
		const job = this.store.getJob(reference.jobId);
		const task = this.store.getTask(reference.taskId);
		if (job === void 0 || task === void 0) return [];
		const definition = job.definition;
		const targets = /* @__PURE__ */ new Map();
		for (const channel of definition.channels) {
			if (channel.from !== task.position) continue;
			if (channel.to === "end") {
				targets.set("end", {
					target: "end",
					label: "结束任务",
					...definition.end.content === void 0 ? {} : { content: definition.end.content }
				});
				continue;
			}
			const types = channel.types !== void 0 && channel.types.length > 0 ? channel.types : definition.positions.find((position) => position.id === channel.to)?.taskTypes.map((taskType) => taskType.id) ?? [];
			for (const typeId of types) {
				if (targets.has(typeId)) continue;
				const taskType = findTaskType(definition, typeId);
				if (taskType === void 0) continue;
				targets.set(typeId, {
					target: typeId,
					label: taskType.label,
					...taskType.content === void 0 ? {} : { content: taskType.content }
				});
			}
		}
		return [...targets.values()];
	}
	/**
	* 当前任务可以点的动作（人任务）；助理代人处理时用。
	*
	* @param sessionId 任务会话
	* @returns 动作列表与表单 schema；非人任务为空
	*/
	taskActionsForSession(sessionId) {
		const reference = this.sessionTasks.get(sessionId);
		if (reference === void 0) return [];
		const job = this.store.getJob(reference.jobId);
		const task = this.store.getTask(reference.taskId);
		if (job === void 0 || task === void 0) return [];
		return (this.taskTypeOf(job.definition, task.type)?.actions ?? []).map((action) => ({
			id: action.id,
			label: action.label,
			...action.input === void 0 ? {} : { input: action.input }
		}));
	}
	/**
	* 执行中的任务按目标创建派生任务：通道由引擎解析，调用方不需要知道通道。
	*
	* @param input 会话、目标、任务内容与依赖
	* @returns 新任务
	*/
	async createTaskFromTarget(input) {
		const reference = this.sessionTasks.get(input.sessionId);
		if (reference === void 0) throw new WorkflowError("no-task", "this session is not executing a workflow task; only an executing task can create tasks");
		const job = this.store.getJob(reference.jobId);
		const creator = this.store.getTask(reference.taskId);
		if (job === void 0 || creator === void 0) throw new WorkflowError("not-found", "task not found");
		const channel = this.resolveTaskRoute(job.definition, creator.position, input.target);
		return await this.createTaskFromSession({
			sessionId: input.sessionId,
			channel,
			type: input.target,
			content: input.content,
			deps: input.deps.length > 0 ? input.deps : [creator.id]
		});
	}
	/** 把一个可创建目标解析成从当前节点出发的通道。 */
	resolveTaskRoute(definition, from, target) {
		const owner = target === "end" ? void 0 : definition.positions.find((position) => position.taskTypes.some((taskType) => taskType.id === target));
		if (target !== "end" && owner === void 0) throw new WorkflowError("invalid-target", `task "${target}" is not declared by this workflow`);
		const channels = definition.channels.filter((channel) => {
			if (channel.from !== from) return false;
			if (target === "end") return channel.to === "end";
			if (channel.to !== owner?.id) return false;
			return channel.types === void 0 || channel.types.length === 0 || channel.types.includes(target);
		});
		const [channel] = channels;
		if (channel === void 0) throw new WorkflowError("invalid-target", `task "${target}" cannot be created from this task`);
		if (channels.length > 1) throw new WorkflowError("invalid-target", `task "${target}" has more than one route from this task; ask the orchestrator to disambiguate`);
		return channel.id;
	}
	/**
	* 执行中的任务 / 助理提交结果。
	*
	* @param input 会话、文本与附件
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
			const claimant = task.claimant;
			const createdBy = claimant === null || claimant.kind === "human" ? claimant?.name ?? "工作人员" : this.workerDisplayName(claimant.name);
			const updated = task.assignee.kind === "human" ? await this.completeHumanTaskLocked(job, task, {
				action: input.action,
				input: input.input,
				text: input.text,
				attachments: input.attachments,
				createdBy
			}) : await this.completeTaskLocked(job, task, {
				text: input.text,
				attachments: input.attachments,
				workspace: this.workspaceFor(task),
				createdBy
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
	* 页面：人点一个动作提交一条人任务。
	*
	* 动作可以省略——那就是「只留结果、不创建任务」的提交。
	*
	* @param input 作业、任务、动作、表单、文本与附件
	* @returns 更新后的任务
	*/
	async completeTaskAsHuman(input) {
		return await this.store.runExclusive(input.jobId, async () => {
			const job = this.requireRunningJob(input.jobId);
			const task = this.requireTask(input.jobId, input.taskId);
			if (task.assignee.kind !== "human") throw new WorkflowError("not-human-task", `task ${input.taskId} is not a human task`);
			if (task.status !== "running" && task.status !== "ready") throw new WorkflowError("invalid-status", `task ${input.taskId} is ${task.status}; a human task can only be completed from ready/running`);
			const updated = await this.completeHumanTaskLocked(job, task, {
				action: input.action,
				input: input.input,
				text: input.text,
				attachments: input.attachments,
				createdBy: "本地用户"
			});
			await this.recomputeLocked(job.id);
			return updated;
		});
	}
	/**
	* 人任务的提交：校验动作与表单、创建动作声明的任务、写入结果。
	*
	* 先渲染并校验全部创建，任何一条不合法都不落盘、也不完成任务。
	*/
	async completeHumanTaskLocked(job, task, input) {
		const taskType = this.taskTypeOf(job.definition, task.type);
		const actionId = typeof input.action === "string" ? input.action.trim() : "";
		const action = actionId === "" ? void 0 : taskType?.actions?.find((candidate) => candidate.id === actionId);
		if (actionId !== "" && action === void 0) throw new WorkflowError("invalid-action", `task type "${task.type}" has no action "${actionId}"`);
		const form = input.input ?? {};
		if (action?.input !== void 0) {
			const problems = schemaProblems(action.input, form);
			if (problems.length > 0) throw new WorkflowError("invalid-input", `input does not match the action contract: ${problems.join("; ")}`);
		}
		const workers = await this.workers();
		const rendered = this.renderDeclaredLocked({
			definition: job.definition,
			from: task.position,
			creations: action?.creates ?? [],
			content: task.content,
			input: form
		});
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
				status: "running",
				claimant: {
					kind: "human",
					name: "本地用户",
					sessionId: null
				},
				attemptIds: [...current.attemptIds, attempt.id],
				startedAt: current.startedAt ?? now,
				updatedAt: now
			}));
		}
		await this.insertDeclaredLocked({
			job,
			creator: prepared,
			rendered,
			workers
		});
		return await this.completeTaskLocked(job, prepared, {
			text: input.text,
			attachments: input.attachments,
			workspace: void 0,
			createdBy: input.createdBy,
			...action === void 0 ? {} : { action: {
				id: action.id,
				label: action.label
			} },
			...action?.input === void 0 ? {} : { input: form }
		});
	}
	/**
	* 渲染一组创建声明（不落盘）。
	*
	* 人任务动作与机器人任务完成后共用：先一次性渲染、校验全部声明，任何一条
	* 不合法都不落盘，调用方可以据此保持任务状态不变。
	*/
	renderDeclaredLocked(input) {
		return input.creations.map((creation) => renderCreation(input.definition, input.from, creation, {
			content: input.content,
			...input.input === void 0 ? {} : { input: input.input }
		}));
	}
	/**
	* 落盘一组已经渲染好的创建，并写入创建事件。
	*
	* 创建的任务依赖 `creator`。
	*/
	async insertDeclaredLocked(input) {
		let known = this.store.listTasks(input.job.id);
		const created = [];
		for (const parsed of input.rendered) {
			const built = buildCreatedTask({
				job: input.job,
				creator: input.creator,
				channel: parsed.channel.id,
				type: parsed.taskType.id,
				content: parsed.content,
				deps: [input.creator.id],
				tasks: known,
				workers: input.workers
			});
			await this.store.insertTask(built.task);
			known = [...known, built.task];
			created.push(built.task);
			await this.appendEvent(input.job.id, "task/created", {
				taskId: built.task.id,
				position: built.task.position,
				type: built.task.type,
				channel: built.task.channel,
				deps: built.task.deps,
				createdBy: input.creator.id
			});
		}
		return created;
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
				error: null,
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
					error: null,
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
	/**
	* 重启一个失败作业。
	*
	* - `failed`：同一作业就地恢复——失败任务回 `ready`，因作业终止被取消的任务
	*   回 `pending`，被阻塞的任务等依赖恢复后回 `pending`；人主动取消的任务与
	*   已完成的任务不动；作业回 `running`，预算从重启时刻重新计时。
	* - `scratch`：按原作业输入、用工作流当前启用版本新建一个作业；原作业留在
	*   `failed` 作为现场，新作业记录来源作业 id 与人的发起人。
	*
	* 只有 `failed` 作业能重启；其它状态抛稳定错误码 `job-not-failed`。
	*
	* @param jobId 原作业 id
	* @param mode 重启方式
	* @returns 继续运行的作业与被重启的原作业
	*/
	async restartJob(jobId, mode) {
		const job = this.store.getJob(jobId);
		if (job === void 0) throw new WorkflowError("not-found", `job not found: ${jobId}`);
		if (job.status !== "failed") throw new WorkflowError("job-not-failed", `job ${jobId} is ${job.status}; only failed jobs can be restarted`);
		if (this.store.listTasks(jobId).some((task) => task.position === "start" && task.status === "failed")) throw new WorkflowError("start-task-failed", `job ${jobId} failed on its start task; the input cannot be retried — start a new job with corrected input instead`);
		if (mode === "scratch") return await this.restartJobFromScratch(job);
		return await this.restartJobInPlace(job);
	}
	/** 从失败位置恢复：同一个作业回到 running。 */
	async restartJobInPlace(source) {
		return await this.store.runExclusive(source.id, async () => {
			const job = this.store.getJob(source.id);
			if (job === void 0) throw new WorkflowError("not-found", `job not found: ${source.id}`);
			if (job.status !== "failed") throw new WorkflowError("job-not-failed", `job ${job.id} is ${job.status}; only failed jobs can be restarted`);
			const tasks = this.store.listTasks(job.id);
			if (!tasks.some((task) => task.status === "failed")) throw new WorkflowError("no-failed-tasks", `job ${job.id} has no failed task to resume; start a new job from scratch instead`);
			const now = nowIso();
			for (const task of tasks) this.deliveryBlocked.delete(task.id);
			let ready = 0;
			let queued = 0;
			for (const task of tasks) {
				if (task.status === "failed") {
					assertTaskTransition(task.id, "failed", "ready");
					await this.store.updateTask(task.id, (current) => ({
						...current,
						status: "ready",
						error: null,
						claimant: null,
						finishedAt: null,
						updatedAt: now
					}));
					await this.appendEvent(job.id, "task/restarted", {
						taskId: task.id,
						from: "failed",
						to: "ready"
					});
					ready += 1;
					continue;
				}
				if (task.status === "cancelled" && task.error !== null) {
					assertTaskTransition(task.id, "cancelled", "pending");
					await this.store.updateTask(task.id, (current) => ({
						...current,
						status: "pending",
						error: null,
						claimant: null,
						finishedAt: null,
						updatedAt: now
					}));
					await this.appendEvent(job.id, "task/restarted", {
						taskId: task.id,
						from: "cancelled",
						to: "pending"
					});
					queued += 1;
				}
			}
			let unblocked = 0;
			let changed = true;
			while (changed) {
				changed = false;
				const byId = new Map(this.store.listTasks(job.id).map((task) => [task.id, task]));
				for (const task of byId.values()) {
					if (task.status !== "blocked") continue;
					if (task.deps.some((dependencyId) => {
						const dependency = byId.get(dependencyId);
						if (dependency === void 0) return false;
						if (dependency.status === "failed" || dependency.status === "blocked") return true;
						return dependency.status === "cancelled" && dependency.error === null;
					})) continue;
					assertTaskTransition(task.id, "blocked", "pending");
					await this.store.updateTask(task.id, (current) => ({
						...current,
						status: "pending",
						error: null,
						claimant: null,
						finishedAt: null,
						updatedAt: now
					}));
					await this.appendEvent(job.id, "task/restarted", {
						taskId: task.id,
						from: "blocked",
						to: "pending"
					});
					unblocked += 1;
					changed = true;
					break;
				}
			}
			assertJobTransition(job.id, job.status, "running");
			const updated = await this.store.updateJob(job.id, (current) => ({
				...current,
				status: "running",
				error: null,
				finishedAt: null,
				restartCount: (current.restartCount ?? 0) + 1,
				budgetStartedAt: now,
				updatedAt: now
			}));
			await this.appendEvent(job.id, "job/restarted", {
				mode: "failed",
				restartCount: updated.restartCount ?? 1,
				readyTasks: ready,
				queuedTasks: queued,
				unblockedTasks: unblocked
			});
			await this.recomputeLocked(job.id);
			return {
				mode: "failed",
				job: this.store.getJob(job.id) ?? updated,
				source: job
			};
		});
	}
	/** 从头开始：按原作业输入、用当前启用版本新建一个作业，原作业留在 failed。 */
	async restartJobFromScratch(source) {
		const { workflow, definition } = this.requireStartableWorkflow(source.workflowId);
		const workers = await this.refreshWorkers(true);
		this.assertDefinitionAvailable(definition, workers, workflow.name);
		const delivery = this.resolveDelivery(definition, source.delivery, { kind: "human" }, workers);
		const job = await this.startJob({
			workflow,
			definition,
			workers,
			starter: { kind: "human" },
			content: source.input,
			delivery,
			restartedFrom: source.id
		});
		await this.store.runExclusive(source.id, async () => {
			await this.appendEvent(source.id, "job/restarted", {
				mode: "scratch",
				newJobId: job.id,
				newJobSeq: job.seq
			});
		});
		return {
			mode: "scratch",
			job,
			source: this.store.getJob(source.id) ?? source
		};
	}
	/** 重启恢复：重建调度、续接 running 任务、补算 clock、重试交付。 */
	async recover() {
		const jobs = this.store.allJobs().filter((job) => job.status === "running" && isSupportedJobDefinitionVersion(job.definition.version));
		for (const job of jobs) try {
			await this.store.runExclusive(job.id, async () => {
				await this.recoverJobLocked(job.id);
			});
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not recover job ${job.id}: ${describeError$4(error)}`);
		}
	}
	/** 恢复一个作业：running 任务续接 / 失败，然后重新调度。 */
	async recoverJobLocked(jobId) {
		const job = this.store.getJob(jobId);
		if (job === void 0 || job.status !== "running") return;
		for (const task of this.store.listTasks(jobId)) {
			const currentJob = this.store.getJob(jobId);
			if (currentJob === void 0 || currentJob.status !== "running") break;
			if (task.status !== "running") continue;
			const assistant = task.claimant?.kind === "assistant" ? task.claimant.name : null;
			const attempt = this.store.listAttempts(task.id).find((entry) => entry.status === "running");
			if (attempt !== void 0) await this.store.updateAttempt(attempt.id, (current) => ({
				...current,
				status: "failed",
				error: "host restarted while this attempt was running",
				finishedAt: nowIso()
			}));
			if (task.position === "end") continue;
			const executor = task.assignee;
			if (executor.kind === "worker" && executor.driver === "robot") {
				if (attempt !== void 0) this.launchProgram(jobId, task.id, attempt.id, executor.program ?? "");
				continue;
			}
			if (attempt === void 0) {
				if (assistant === null) await this.failTaskLocked(jobId, task.id, "host restarted and the execution attempt was lost");
				else {
					this.busyAssistants.delete(assistant);
					await this.failAssistantLocked(jobId, task, assistant, "host restarted and the execution attempt was lost");
				}
				continue;
			}
			const sessionId = attempt.sessionId;
			if (sessionId === null || executor.kind !== "worker" && assistant === null) {
				if (assistant === null) await this.failTaskLocked(jobId, task.id, "host restarted and the execution session was lost");
				else {
					this.busyAssistants.delete(assistant);
					await this.failAssistantLocked(jobId, task, assistant, "host restarted and the execution session was lost");
				}
				continue;
			}
			const executorId = storedExecutorRef(executor) ?? "";
			if (!await this.resumeAgentAttempt(jobId, task, attempt, assistant ?? executorId, sessionId)) {
				if (assistant === null) await this.failTaskLocked(jobId, task.id, "host restarted and the execution session could not be resumed");
				else {
					this.busyAssistants.delete(assistant);
					await this.failAssistantLocked(jobId, task, assistant, "host restarted and the assistant session could not be resumed");
				}
			}
		}
		const tasks = this.store.listTasks(jobId);
		const startTask = tasks.find((task) => task.position === "start");
		if (startTask !== void 0 && startTask.status === "completed" && tasks.length === 1 && job.definition.start.next.length > 0) try {
			await this.spawnInitialTasksLocked(job, startTask);
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not rebuild initial tasks for job ${jobId}: ${describeError$4(error)}`);
		}
		await this.recomputeLocked(jobId);
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
			this.logger?.warn?.(`buka-workflows: could not resume session ${sessionId}: ${describeError$4(error)}`);
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
		const workers = await this.refreshWorkers();
		const launches = [];
		const runningByType = /* @__PURE__ */ new Map();
		for (const task of tasks) if (task.status === "running") runningByType.set(task.type, (runningByType.get(task.type) ?? 0) + 1);
		const concurrencyOf = (task) => task.type === "end" ? 1 : findTaskType(job.definition, task.type)?.concurrency ?? 1;
		const hasCapacity = (task) => (runningByType.get(task.type) ?? 0) < concurrencyOf(task);
		const takeCapacity = (task) => {
			runningByType.set(task.type, (runningByType.get(task.type) ?? 0) + 1);
		};
		const sorted = [...ready].sort((left, right) => left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt));
		for (const task of sorted) {
			if (task.position === "end") {
				if (task.assignee.kind === "human") continue;
				if (task.assignee.kind === "session") {
					if (this.deliveryBlocked.has(task.id)) continue;
					const launch = await this.claimForDelivery(job, task);
					if (launch !== null) launches.push(launch);
					continue;
				}
				if (!hasCapacity(task)) continue;
				const missing = this.missingWorkerOf(task, workers);
				if (missing !== null) {
					await this.failMissingWorkerTask(job, task, missing);
					continue;
				}
				const launch = await this.claimAgentTask(job, task, tasks);
				if (launch !== null) {
					takeCapacity(task);
					launches.push(launch);
				}
				continue;
			}
			const executor = task.assignee;
			if (executor.kind === "human") {
				const assistantName = this.assistantFor(job.definition, task.type);
				if (assistantName === null) continue;
				if (!workers.has(assistantName)) continue;
				if (this.busyAssistants.has(assistantName)) continue;
				const launch = await this.claimAssistantTask(job, task, assistantName);
				if (launch !== null) {
					this.busyAssistants.add(assistantName);
					launches.push(launch);
				}
				continue;
			}
			if (executor.kind !== "worker") continue;
			if (executor.driver === "robot") {
				if (!hasCapacity(task)) continue;
				const programId = executor.program ?? "";
				const launch = await this.claimProgramTask(job, task, programId);
				if (launch !== null) {
					takeCapacity(task);
					launches.push(launch);
				}
				continue;
			}
			const missing = this.missingWorkerOf(task, workers);
			if (missing !== null) {
				await this.failMissingWorkerTask(job, task, missing);
				continue;
			}
			if (!hasCapacity(task)) continue;
			const launch = await this.claimAgentTask(job, task, tasks);
			if (launch !== null) {
				takeCapacity(task);
				launches.push(launch);
			}
		}
		return launches;
	}
	/**
	* 任务主体是否已不在登记表里：机器人不走登记表（由 `program` 驱动），
	* 只检查智能体执行者。返回缺失的标识符，没有缺失时返回 null。
	*
	*/
	missingWorkerOf(task, workers) {
		if (task.assignee.kind !== "worker") return null;
		if (task.assignee.driver !== "agent") return null;
		const id = storedExecutorRef(task.assignee) ?? "";
		if (id === "") return "";
		return workers.has(id) ? null : id;
	}
	/**
	* 缺失执行者的任务派发失败：写明是哪条任务、哪个岗位、缺哪个标识符；
	* 任务进入可重试的失败状态，其它分支照常推进。
	*
	*/
	async failMissingWorkerTask(job, task, identifier) {
		const position = positionLabel(job.definition, task.position);
		const type = taskTypeLabel(job.definition, task.type);
		const id = identifier === "" ? "(unknown)" : identifier;
		if (task.status === "ready") {
			const attempt = await this.createAttempt({
				jobId: job.id,
				taskId: task.id,
				promptFile: null
			});
			await this.claimTaskRecord(job, task, {
				kind: "worker",
				name: id,
				sessionId: null
			}, attempt.id);
		}
		await this.failTaskLocked(job.id, task.id, `task "${task.id}" (position "${position}" / ${task.position}, type "${type}" / ${task.type}) cannot be dispatched: worker identifier "${id}" is not registered in the Buka Workers registry; rebind the workflow to an existing worker and retry the task`);
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
	async claimAgentTask(job, task, _tasks) {
		if (task.assignee.kind !== "worker") return null;
		const taskType = task.position === "end" ? resolveTargetTaskType(job.definition, "end", "") : this.taskTypeOf(job.definition, task.type);
		if (taskType === void 0) {
			await this.failTaskLocked(job.id, task.id, `task type "${task.type}" is not declared in the workflow`);
			return null;
		}
		const planMode = taskType.plan === true;
		const agentPreset = typeof taskType.agentPreset === "string" && taskType.agentPreset !== "" ? taskType.agentPreset : null;
		const worktree = taskType.worktree === "create" ? this.worktreeAvailable() ? "create" : "guard" : taskType.worktree === "guard" ? "guard" : void 0;
		const sections = buildExecutionPromptSections({
			task,
			taskType,
			...worktree === void 0 ? {} : { worktree }
		});
		const prompt = sections.prompt;
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
			name: storedExecutorRef(task.assignee) ?? "",
			sessionId: null
		}, attempt.id);
		return {
			kind: "agent",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id,
			worker: storedExecutorRef(task.assignee) ?? "",
			prompt,
			userPrompt: planMode ? null : sections.userPrompt,
			planMode,
			agentPreset
		};
	}
	/** 认领助理承办的人任务。 */
	async claimAssistantTask(job, task, assistantName) {
		const taskType = this.taskTypeOf(job.definition, task.type);
		if (taskType === void 0) return null;
		const prompt = buildAssistantPrompt({
			task,
			taskType
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
			userPrompt: null,
			planMode: false,
			agentPreset: null
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
			name: storedExecutorRef(task.assignee) ?? programId,
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
	/** 为结束任务准备一次投递：认领任务，投递后等发起人确认。 */
	async claimForDelivery(job, task) {
		if (job.starter.kind !== "session") return null;
		const attempt = await this.createAttempt({
			jobId: job.id,
			taskId: task.id,
			promptFile: null
		});
		await this.appendEvent(job.id, "delivery/attempt", {
			taskId: task.id,
			attemptId: attempt.id
		});
		await this.claimTaskRecord(job, task, {
			kind: "worker",
			name: "starter",
			sessionId: job.starter.sessionId
		}, attempt.id);
		return {
			kind: "delivery",
			jobId: job.id,
			taskId: task.id,
			attemptId: attempt.id,
			sessionId: job.starter.sessionId
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
			case "delivery": this.runDelivery(launch.jobId, launch.taskId, launch.attemptId, launch.sessionId);
		}
	}
	/** 启动一个 agent / 助理会话。 */
	async launchAgent(launch) {
		const workers = this.workersOf();
		if (workers === null || typeof workers.dispatchSession !== "function") {
			await this.failOutside(launch.jobId, launch.taskId, "the workers service (ctx.bukaWorkers) with dispatchSession() is unavailable in this composition; update the plugin or check the composition");
			return;
		}
		const task = this.store.getTask(launch.taskId);
		if (task === void 0 || task.status !== "running") return;
		const newSessionId = randomUUID();
		this.sessionTasks.set(newSessionId, {
			jobId: launch.jobId,
			taskId: launch.taskId
		});
		const workerPreset = this.catalog.get(launch.worker)?.agentPreset;
		const agentPreset = launch.agentPreset ?? (typeof workerPreset === "string" && workerPreset !== "" ? workerPreset : this.options.workerPreset);
		let handle;
		try {
			handle = await workers.dispatchSession({
				worker: launch.worker,
				prompt: launch.prompt,
				...launch.userPrompt === null ? {} : { userPrompt: launch.userPrompt },
				title: `工作流任务 ${task.id}`,
				agentPreset,
				approval: "ask",
				planMode: launch.planMode,
				newSessionId
			});
		} catch (error) {
			this.unbindSessionTask(newSessionId, launch.taskId);
			await this.failOutside(launch.jobId, launch.taskId, `could not start the task session: ${describeError$4(error)}`);
			return;
		}
		const sessionId = handleSessionId(handle);
		const startSeq = handleStartSeq(handle) ?? 0;
		await this.store.runExclusive(launch.jobId, async () => {
			const current = this.store.getTask(launch.taskId);
			if (current === void 0 || current.status !== "running") {
				this.unbindSessionTask(newSessionId, launch.taskId);
				if (sessionId !== null) this.unbindSessionTask(sessionId, launch.taskId);
				this.disposeHandle(handle);
				return;
			}
			await this.store.updateAttempt(launch.attemptId, (attempt) => ({
				...attempt,
				sessionId,
				startSeq
			}));
			if (sessionId !== null) {
				if (sessionId !== newSessionId) {
					this.unbindSessionTask(newSessionId, launch.taskId);
					this.sessionTasks.set(sessionId, {
						jobId: launch.jobId,
						taskId: launch.taskId
					});
				}
				await this.store.updateTask(launch.taskId, (record) => ({
					...record,
					claimant: record.claimant === null ? record.claimant : {
						...record.claimant,
						sessionId
					},
					updatedAt: nowIso()
				}));
			} else this.unbindSessionTask(newSessionId, launch.taskId);
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
		const finish = (status) => {
			execution.stopPoll?.();
			if (execution.timeout !== null) clearTimeout(execution.timeout);
			this.active.delete(input.taskId);
			if (status === "completed") this.retireHandle(input.handle);
			else this.disposeHandle(input.handle);
			if (input.sessionId !== null) this.unbindSessionTask(input.sessionId, input.taskId);
		};
		let waiting = false;
		execution.stopPoll = poll(this.options.pollIntervalMs, async () => {
			const task = this.store.getTask(input.taskId);
			if (task === void 0 || task.status !== "running") {
				finish(task?.status);
				return true;
			}
			const snapshot = readHandleResult(input.handle, input.startSeq);
			if (!snapshot.turnEnded) return false;
			if (input.kind !== "assistant" && snapshot.stopReason === "completed") {
				if (!waiting) {
					waiting = true;
					this.logger?.info?.(`buka-workflows: task ${input.taskId} is waiting for the session to continue after the turn completed`);
				}
				return false;
			}
			finish(task.status);
			if (input.kind === "assistant") await this.failAssistantOutside(input.jobId, input.taskId, snapshot, input.worker);
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
		const program = normalizeProgramId(programId);
		const driver = programDriver(program);
		if (driver === void 0) {
			await this.failOutside(jobId, taskId, `unknown robot driver "${program}"`);
			return;
		}
		const problems = programContentProblems(program, task.content);
		if (problems.length > 0) {
			await this.failOutside(jobId, taskId, `robot program "${program}" cannot run this task: ${problems.join("; ")}`);
			return;
		}
		if (this.store.getJob(jobId) === void 0) return;
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
			const result = await driver.run({
				content: task.content,
				signal: controller.signal
			});
			await this.store.runExclusive(jobId, async () => {
				this.active.delete(taskId);
				const currentJob = this.store.getJob(jobId);
				const current = this.store.getTask(taskId);
				if (currentJob === void 0 || current === void 0 || current.status !== "running") return;
				const workers = await this.workers();
				const taskType = this.taskTypeOf(currentJob.definition, current.type);
				const rendered = this.renderDeclaredLocked({
					definition: currentJob.definition,
					from: current.position,
					creations: taskType?.creates ?? [],
					content: current.content
				});
				await this.insertDeclaredLocked({
					job: currentJob,
					creator: current,
					rendered,
					workers
				});
				await this.completeTaskLocked(currentJob, current, {
					text: result.text,
					attachments: [],
					workspace: void 0,
					createdBy: current.claimant === null ? programId : this.workerDisplayName(current.claimant.name)
				});
				await this.recomputeLocked(jobId);
			});
		} catch (error) {
			await this.failOutside(jobId, taskId, `program task failed: ${describeError$4(error)}`);
		}
	}
	/** 结束任务投递：把最终报告送到发起人会话，等它确认。 */
	async runDelivery(jobId, taskId, attemptId, sessionId) {
		const job = this.store.getJob(jobId);
		const task = this.store.getTask(taskId);
		if (job === void 0 || task === void 0 || task.status !== "running") {
			await this.finishAttemptOutside(attemptId, "cancelled", "cancelled before delivery");
			return;
		}
		const displaced = this.sessionTasks.get(sessionId);
		this.sessionTasks.set(sessionId, {
			jobId,
			taskId
		});
		let delivered = true;
		let error = null;
		let startSeq = null;
		try {
			startSeq = await this.delivery.deliver(sessionId, buildEndDeliveryText(job, task));
		} catch (caught) {
			delivered = false;
			error = describeError$4(caught);
		}
		try {
			await this.store.runExclusive(jobId, async () => {
				if (this.store.getTask(taskId) === void 0) {
					this.restoreSessionTask(sessionId, taskId, displaced);
					return;
				}
				if (!delivered) {
					this.deliveryBlocked.add(taskId);
					this.restoreSessionTask(sessionId, taskId, displaced);
					await this.store.updateAttempt(attemptId, (attempt) => ({
						...attempt,
						status: "failed",
						error,
						finishedAt: nowIso()
					}));
					await this.store.updateTask(taskId, (record) => ({
						...record,
						status: "ready",
						claimant: null,
						updatedAt: nowIso()
					}));
					await this.appendEvent(jobId, "delivery/failed", {
						taskId,
						error
					});
					return;
				}
				await this.store.updateAttempt(attemptId, (attempt) => ({
					...attempt,
					sessionId,
					...startSeq === null ? {} : { startSeq }
				}));
				await this.appendEvent(jobId, "delivery/delivered", { taskId });
			});
		} catch (caught) {
			this.restoreSessionTask(sessionId, taskId, displaced);
			throw caught;
		}
	}
	/** 解绑会话 → 任务句柄，只在它仍指向这个任务时执行（避免误删更新的绑定）。 */
	unbindSessionTask(sessionId, taskId) {
		if (this.sessionTasks.get(sessionId)?.taskId !== taskId) return;
		this.sessionTasks.delete(sessionId);
	}
	/** 结束投递没有落地：解绑当前绑定，并把投递前那条仍在跑的任务还回去。 */
	restoreSessionTask(sessionId, taskId, displaced) {
		if (displaced !== void 0) {
			const task = this.store.getTask(displaced.taskId);
			if (task !== void 0 && task.status === "running") {
				if (this.sessionTasks.get(sessionId)?.taskId !== taskId) return;
				this.sessionTasks.set(sessionId, displaced);
				return;
			}
		}
		this.unbindSessionTask(sessionId, taskId);
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
			const assistant = task.claimant?.kind === "assistant" ? task.claimant.name : null;
			if (assistant === null) await this.failTaskLocked(jobId, taskId, `task timed out after ${this.options.taskTimeoutMs}ms (worker: ${worker})`);
			else {
				this.busyAssistants.delete(assistant);
				await this.failAssistantLocked(jobId, task, assistant, `the task timed out after ${this.options.taskTimeoutMs}ms`);
			}
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
			this.logger?.warn?.(`buka-workflows: could not mark task ${taskId} failed: ${describeError$4(error)}`);
		}
	}
	/** 代办失败（会话结束未提交）：任务与整个作业一起失败。 */
	async failAssistantOutside(jobId, taskId, snapshot, assistant) {
		try {
			await this.store.runExclusive(jobId, async () => {
				this.busyAssistants.delete(assistant);
				await this.failAssistantLocked(jobId, this.requireTask(jobId, taskId), assistant, `assistant session ended without completing the task (stopReason: ${snapshot.stopReason ?? "unknown"})`);
				await this.recomputeLocked(jobId);
			});
		} catch (error) {
			this.logger?.warn?.(`buka-workflows: could not fail the job for assistant task ${taskId}: ${describeError$4(error)}`);
		}
	}
	/** 代办失败的作业错误：写明是哪条任务、哪个代办者、什么原因。 */
	assistantFailureReason(job, task, assistant, cause) {
		const position = positionLabel(job.definition, task.position);
		const type = taskTypeLabel(job.definition, task.type);
		const worker = assistant === "" ? "(unknown)" : `${this.workerDisplayName(assistant)} (${assistant})`;
		return `delegated task "${task.id}" (position "${position}" / ${task.position}, type "${type}" / ${task.type}) failed: assistant ${worker} did not hand back a result: ${cause}`;
	}
	/**
	* 代办失败：任务标失败，整个作业进 `failed`，其余非终态任务取消。
	*
	* 被点名的智能体代办代表人的决策；没交出结果说明这个作业的结果不可信，
	* 不再退回「待认领」让人接手（ADR 0022，取代 ADR 0010 第 6 条）。
	*/
	async failAssistantLocked(jobId, task, assistant, cause) {
		const job = this.store.getJob(jobId);
		if (job === void 0 || job.status !== "running") return;
		const reason = this.assistantFailureReason(job, task, assistant, cause);
		await this.failTaskLocked(jobId, task.id, reason);
		await this.failJobLocked(job, reason, "job/assistant-failed", {
			taskId: task.id,
			assistant
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
			text: clipUtf8(text, RESULT_PREVIEW_BYTES),
			textBytes: Buffer.byteLength(text, "utf8"),
			textFile,
			attachmentIds: attachmentRecords.map((attachment) => attachment.id),
			...input.action === void 0 ? {} : { action: input.action },
			...input.input === void 0 ? {} : { input: input.input }
		};
		if (task.claimant?.kind === "assistant") this.busyAssistants.delete(task.claimant.name);
		const now = nowIso();
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
		return updated;
	}
	/** 启动任务完成后创建初始任务（崩溃恢复时补建）。 */
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
				channel: task.channel,
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
		const hasFailure = tasks.some((task) => task.status === "blocked" || task.status === "failed" || task.status === "cancelled" && (task.error !== null || this.store.listAttempts(task.id).some((attempt) => attempt.status === "failed")));
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
	/** 是否超过最长时长预算；计时起点缺省按作业创建时间（重启后重置）。 */
	overDurationBudget(job) {
		const startedAt = job.budgetStartedAt ?? job.createdAt;
		return Date.now() - Date.parse(startedAt) > job.definition.budgets.maxDurationHours * 3600 * 1e3;
	}
	/** 超预算：取消非终态任务，作业 failed。 */
	async failJobForBudget(job) {
		const reason = `workflow exceeded its maxDurationHours budget (${job.definition.budgets.maxDurationHours}h)`;
		await this.failJobLocked(job, reason, "job/budget-exceeded");
	}
	/**
	* 失败整个作业：取消所有非终态任务（写清终止原因），作业进 `failed`，
	* 追加作业事件。代办失败与超预算共用这一条路径。
	*/
	async failJobLocked(job, reason, event, data = {}) {
		const now = nowIso();
		for (const task of this.store.listTasks(job.id)) {
			if (!isOpenTaskStatus(task.status)) continue;
			if (task.claimant?.kind === "assistant") this.busyAssistants.delete(task.claimant.name);
			this.cancelActive(task.id, reason);
			await this.store.updateTask(task.id, (current) => ({
				...current,
				status: "cancelled",
				error: reason,
				finishedAt: now,
				updatedAt: now
			}));
			await this.closeRunningAttempts(task.id, "cancelled", reason);
			this.dropSessionTask(task.id);
			await this.appendEvent(job.id, "task/cancelled", {
				taskId: task.id,
				error: reason
			});
		}
		await this.store.updateJob(job.id, (current) => ({
			...current,
			status: "failed",
			error: reason,
			finishedAt: now,
			updatedAt: now
		}));
		await this.appendEvent(job.id, event, {
			error: reason,
			...data
		});
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
	/** 执行者标识符 → 展示名（登记表查不到时退回标识符）。 */
	workerDisplayName(id) {
		const worker = this.catalog.get(id);
		return worker === void 0 ? id : worker.displayName;
	}
	/** 任务主体的工作区（执行者目录）。 */
	workspaceFor(task) {
		if (task.assignee.kind === "worker") {
			const id = storedExecutorRef(task.assignee);
			return id === null ? void 0 : this.catalog.get(id)?.path;
		}
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
		if (execution.sessionId !== null) this.unbindSessionTask(execution.sessionId, taskId);
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
* 轮询间隔、附件限额、编排 preset / 工作区与执行者会话 preset。作业 / 任务
* 元数据进 `ctx.storageDomain`，不在这里配置。
*
* @module @buka/dsh-plugin-workflows/options
*/
/** 插件全局目录名。 */
const PLUGIN_CACHE_DIR$1 = "dsh-plugin-workflows";
/** 默认数据目录名。 */
const DEFAULTS = {
	/** 不设默认超时：任务耗时取决于模型速度与任务大小，硬截止容易误杀；0 也允许任务无限等待会话回复。 */
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
/** 工作流一半的配置字段；合并后的插件入口把它与执行者配置拼成一份 `Config`。 */
const workflowConfigFields = {
	dataDir: z.string().default(defaultDataDir()).description("插件数据目录：渲染后的 prompt、结果全文、作业附件与迁移标记。作业 / 任务元数据在 storageDomain 里。支持 ~ 前缀。"),
	taskTimeoutMs: z.number().step(1).min(0).default(DEFAULTS.taskTimeoutMs).description("单个任务的默认硬超时（毫秒）；0 表示不超时，任务可以一直等待会话回复。"),
	pollIntervalMs: z.number().step(1).min(100).default(DEFAULTS.pollIntervalMs).description("观察任务会话是否结束轮的轮询间隔（毫秒）。"),
	maxAttachmentBytes: z.number().step(1).min(1).default(DEFAULTS.maxAttachmentBytes).description("单个附件的字节上限。"),
	maxAttachmentsPerTask: z.number().step(1).min(1).default(DEFAULTS.maxAttachmentsPerTask).description("一次任务完成最多提交的附件数量。"),
	maxTaskAttachmentsBytes: z.number().step(1).min(1).default(DEFAULTS.maxTaskAttachmentsBytes).description("一次任务完成的附件总量字节上限。"),
	maxInlineAttachmentBytes: z.number().step(1).min(1).default(DEFAULTS.maxInlineAttachmentBytes).description("可在 prompt 里内联的单个文本附件字节上限。"),
	maxResultTextBytes: z.number().step(1).min(1).default(DEFAULTS.maxResultTextBytes).description("写入作业目录的结果全文上限；超出部分截断并在记录里标注。"),
	orchestratorPresets: z.array(z.string()).default(DEFAULTS.orchestratorPresets).description("能保存 / 读取工作流定义的 agent preset 名单。留空表示不做收窄（所有会话可见）。推荐只保留随插件发布的 `workflow-orchestrator`。"),
	orchestratorWorkspaces: z.array(z.string()).default(DEFAULTS.orchestratorWorkspaces).description("按工作区放行工作流定义工具：在这些目录（含子目录，支持 ~ 前缀）里启动的会话，即使 preset 不在 orchestratorPresets 里也能保存 / 读取定义。留空表示只按 preset 判定。"),
	workerPreset: z.string().default(DEFAULTS.workerPreset).description("智能体任务会话的兜底 agent preset：任务类型的 agentPreset 优先，其次是执行者登记的默认；两者都没配置时用它。")
};
z.object(workflowConfigFields);
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
		const expanded = text === "~" || text.startsWith("~/") || text.startsWith("~\\") ? path.join(homeDir$1(env), text.slice(1)) : text;
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
	if (text === "~") return path.join(homeDir$1(env), ".cache", PLUGIN_CACHE_DIR$1);
	if (text.startsWith("~/") || text.startsWith("~\\")) return path.resolve(homeDir$1(env), text.slice(2));
	return path.resolve(text);
}
/**
* 默认数据目录。
*
* @param env 环境变量
* @returns 默认数据目录
*/
function defaultDataDir(env = process.env) {
	const cacheHome = typeof env.XDG_CACHE_HOME === "string" && env.XDG_CACHE_HOME.trim() !== "" ? env.XDG_CACHE_HOME.trim() : path.join(homeDir$1(env), ".cache");
	return path.join(cacheHome, PLUGIN_CACHE_DIR$1);
}
/**
* 用户主目录。
*
* @param env 环境变量
* @returns 主目录
*/
function homeDir$1(env) {
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
const MAX_BODY_BYTES$1 = 262144;
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
		if (!res.headersSent) sendError$1(res, 500, "read-failed", "attachment could not be read");
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
async function readJsonBody$1(req, res) {
	if (String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		sendError$1(res, 415, "invalid-content-type", "content-type 必须是 application/json");
		return;
	}
	const text = await readBoundedBody$1(req);
	if (text === null) {
		sendError$1(res, 413, "too-large", "请求体过大");
		return;
	}
	try {
		return JSON.parse(text);
	} catch {
		sendError$1(res, 400, "invalid-json", "请求体不是合法 JSON");
		return;
	}
}
/**
* 读取有上限的请求体；超过上限时丢弃剩余流并返回 null。
*
* @param req HTTP 请求
* @returns 请求体文本；过大时是 null
*/
async function readBoundedBody$1(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.byteLength;
		if (size > MAX_BODY_BYTES$1) {
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
function sendJson$1(res, status, payload) {
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
function sendError$1(res, status, code, message) {
	sendJson$1(res, status, {
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
function sendMethodNotAllowed$1(res, allow) {
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
* 浏览器一半的 HTTP 路由（ADR 0015 / 0017 的 v6 契约）：
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
	jobRestart: "/buka-workflows/job/restart",
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
		case "workflow-retired":
		case "workflow-unavailable": return 409;
		case "job-not-running":
		case "task-not-running":
		case "invalid-status":
		case "not-ready":
		case "not-failed":
		case "no-pending-delivery":
		case "job-not-failed":
		case "no-failed-tasks":
		case "start-task-failed":
		case "definition-outdated": return 409;
		default: return 400;
	}
	return 500;
}
/** 统一错误响应。 */
function sendRouteError(res, error, logger, fallbackCode = "internal") {
	const status = statusForError(error);
	const code = error instanceof WorkflowError ? error.code : fallbackCode;
	const message = describeError$4(error);
	if (status >= 500) logger?.warn?.(`buka-workflows: request failed: ${message}`);
	if (!res.headersSent) sendError$1(res, status, code, message);
	else res.destroy(error instanceof Error ? error : void 0);
}
/** 查询参数。 */
function query$1(req) {
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
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			sendJson$1(res, 200, {
				ok: true,
				workflows: await (await ready()).listWorkflowSummaries()
			});
		});
		route(ROUTES.workflow, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			const params = query$1(req);
			const workflowId = (params.get("id") ?? "").trim();
			const versionRaw = params.get("version");
			const version = versionRaw === null || versionRaw === "" ? void 0 : Number.parseInt(versionRaw, 10);
			if (workflowId === "") return sendError$1(res, 400, "invalid-id", "id is required");
			if (version !== void 0 && (!Number.isInteger(version) || version < 1)) return sendError$1(res, 400, "invalid-version", "version must be a positive integer");
			const detail = await (await ready()).readWorkflowDetail(workflowId, version);
			if (detail === null) return sendError$1(res, 404, "not-found", `workflow not found: ${workflowId}`);
			sendJson$1(res, 200, {
				ok: true,
				...detail
			});
		});
		route(ROUTES.workflowActivate, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed$1(res, "POST");
			const body = await readJsonBody$1(req, res);
			if (body === void 0) return;
			const record = body;
			const id = typeof record.id === "string" ? record.id.trim() : "";
			if (id === "") return sendError$1(res, 400, "invalid-id", "id is required");
			if (typeof record.active !== "boolean") return sendError$1(res, 400, "invalid-active", "active must be a boolean");
			const workflow = await (await ready()).setWorkflowActive(id, record.active);
			sendJson$1(res, 200, {
				ok: true,
				workflow: {
					id: workflow.id,
					status: workflow.status
				}
			});
		});
		route(ROUTES.jobs, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			const workflowId = (query$1(req).get("workflowId") ?? "").trim();
			if (workflowId === "") return sendError$1(res, 400, "invalid-id", "workflowId is required");
			sendJson$1(res, 200, {
				ok: true,
				jobs: await (await ready()).listJobSummaries(workflowId)
			});
		});
		route(ROUTES.jobStart, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed$1(res, "POST");
			const body = await readJsonBody$1(req, res);
			if (body === void 0) return;
			const record = body;
			const workflowId = typeof record.workflowId === "string" ? record.workflowId.trim() : "";
			if (workflowId === "") return sendError$1(res, 400, "invalid-id", "workflowId is required");
			const job = await (await ready()).createJobFromHuman({
				workflowId,
				content: record.content ?? {},
				delivery: record.delivery ?? { kind: "starter" }
			});
			sendJson$1(res, 200, {
				ok: true,
				jobId: job.id,
				seq: job.seq
			});
		});
		route(ROUTES.job, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			const jobId = (query$1(req).get("id") ?? "").trim();
			if (jobId === "") return sendError$1(res, 400, "invalid-id", "id is required");
			const detail = await (await ready()).jobDetail(jobId);
			if (detail === null) return sendError$1(res, 404, "not-found", `job not found: ${jobId}`);
			sendJson$1(res, 200, {
				ok: true,
				...detail
			});
		});
		route(ROUTES.jobAction, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed$1(res, "POST");
			const body = await readJsonBody$1(req, res);
			if (body === void 0) return;
			const record = body;
			const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
			if (jobId === "") return sendError$1(res, 400, "invalid-id", "jobId is required");
			const engine = await ready();
			if (record.action === "cancel") {
				const job = await engine.cancelJob(jobId);
				sendJson$1(res, 200, {
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
				sendJson$1(res, 200, {
					ok: true,
					job: {
						id: job.id,
						status: job.status
					}
				});
				return;
			}
			sendError$1(res, 400, "invalid-action", "action must be cancel or retry-delivery");
		});
		route(ROUTES.jobRestart, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed$1(res, "POST");
			const body = await readJsonBody$1(req, res);
			if (body === void 0) return;
			const record = body;
			const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
			if (jobId === "") return sendError$1(res, 400, "invalid-id", "jobId is required");
			const mode = record.mode;
			if (mode !== "failed" && mode !== "scratch") return sendError$1(res, 400, "invalid-mode", "mode must be failed or scratch");
			const outcome = await (await ready()).restartJob(jobId, mode);
			sendJson$1(res, 200, {
				ok: true,
				mode: outcome.mode,
				jobId: outcome.job.id,
				seq: outcome.job.seq,
				sourceJobId: outcome.source.id,
				sourceSeq: outcome.source.seq
			});
		});
		route(ROUTES.task, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			const params = query$1(req);
			const jobId = (params.get("jobId") ?? "").trim();
			const taskId = (params.get("taskId") ?? "").trim();
			if (jobId === "" || taskId === "") return sendError$1(res, 400, "invalid-id", "jobId and taskId are required");
			const detail = (await ready()).taskDetail(jobId, taskId);
			if (detail === null) return sendError$1(res, 404, "not-found", "task not found");
			sendJson$1(res, 200, {
				ok: true,
				task: detail
			});
		});
		route(ROUTES.taskAction, async (req, res) => {
			if (req.method !== "POST") return sendMethodNotAllowed$1(res, "POST");
			const body = await readJsonBody$1(req, res);
			if (body === void 0) return;
			const record = body;
			const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
			const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
			if (jobId === "" || taskId === "") return sendError$1(res, 400, "invalid-id", "jobId and taskId are required");
			const engine = await ready();
			switch (record.action) {
				case "cancel": {
					const task = await engine.cancelTask(jobId, taskId);
					sendJson$1(res, 200, {
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
					sendJson$1(res, 200, {
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
					sendJson$1(res, 200, {
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
						action: typeof record.selectedAction === "string" ? record.selectedAction : void 0,
						input: record.input,
						text: typeof record.text === "string" ? record.text : "",
						attachments: record.attachments
					});
					sendJson$1(res, 200, {
						ok: true,
						task: {
							id: task.id,
							status: task.status
						}
					});
					return;
				}
				default: sendError$1(res, 400, "invalid-action", "action must be cancel, retry, claim or complete");
			}
		});
		route(ROUTES.attachments, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			const params = query$1(req);
			const jobId = (params.get("jobId") ?? "").trim();
			if (jobId === "") return sendError$1(res, 400, "invalid-id", "jobId is required");
			const limit = parseLimit(params.get("limit"));
			sendJson$1(res, 200, {
				ok: true,
				attachments: (await ready()).listJobAttachments(jobId).slice(0, limit)
			});
		});
		route(ROUTES.attachment, async (req, res) => {
			if (req.method !== "GET") return sendMethodNotAllowed$1(res, "GET");
			const params = query$1(req);
			const jobId = (params.get("jobId") ?? "").trim();
			const attachmentId = (params.get("attachmentId") ?? "").trim();
			const mode = params.get("mode") ?? "download";
			if (jobId === "" || attachmentId === "") return sendError$1(res, 400, "invalid-id", "jobId and attachmentId are required");
			if (mode !== "download" && mode !== "preview" && mode !== "inline") return sendError$1(res, 400, "invalid-mode", "mode must be download, preview or inline");
			const engine = await ready();
			const opened = engine.openAttachment(jobId, attachmentId);
			if (opened === null) return sendError$1(res, 404, "not-found", "attachment not found");
			const preview = attachmentPreviewInfo(opened.record.name);
			if (mode === "download") {
				pipeAttachment(res, {
					path: opened.file,
					name: opened.record.name,
					bytes: opened.record.bytes
				}, { log: (error) => webCtx.logger?.warn?.(`buka-workflows: attachment read failed: ${describeError$4(error)}`) });
				return;
			}
			if (mode === "inline") {
				if (preview.kind !== "image" && preview.kind !== "pdf") {
					sendError$1(res, 415, "unsupported-preview", "this attachment type cannot be previewed inline");
					return;
				}
				pipeAttachment(res, {
					path: opened.file,
					name: opened.record.name,
					bytes: opened.record.bytes
				}, {
					inline: true,
					mime: preview.mime,
					log: (error) => webCtx.logger?.warn?.(`buka-workflows: attachment read failed: ${describeError$4(error)}`)
				});
				return;
			}
			if (preview.kind !== "text" && preview.kind !== "markdown") {
				sendJson$1(res, 200, {
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
			const maxBytes = preview.kind === "markdown" ? DEFAULT_PREVIEW_MARKDOWN_BYTES : DEFAULT_PREVIEW_TEXT_BYTES;
			const range = await readAttachmentRange(opened.file, { maxBytes });
			if (range.text === null) {
				sendJson$1(res, 200, {
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
			const attachment = {
				name: opened.record.name,
				bytes: opened.record.bytes,
				kind: preview.kind,
				mime: preview.mime,
				text: range.text,
				truncated: range.truncated,
				read: range.read,
				offset: range.offset
			};
			if (preview.kind === "markdown") attachment.images = engine.listJobAttachments(jobId).filter((record) => attachmentPreviewInfo(record.name).kind === "image").map((record) => ({
				id: record.id,
				name: record.name
			}));
			sendJson$1(res, 200, {
				ok: true,
				attachment
			});
		});
	});
}
// .build/workflows/service.js
/**
* `@buka/dsh-plugin-workflows` 对外提供的只读查询服务：`ctx.bukaWorkflows`。
*
* 目前只有一个能力：`workerUsage(id)`。Workers 插件在删除执行者前用它算出
* 影响面与唯一阻塞条件（引用该标识符的运行中作业）；取不到服务时视为没有
* 作业引用。
*
* 服务只读，不改变工作流 / 作业状态，也不落盘任何派生状态：可用性由读取方
* 按引用能否解析实时计算。
*
* @module @buka/dsh-plugin-workflows/service
*/
/** 服务名；消费方用 `ctx.get(SERVICE_NAME)` 读取，运行时是 `ctx.bukaWorkflows`。 */
const SERVICE_NAME$1 = "bukaWorkflows";
/** 查询服务：等价于转发给就绪后的引擎。 */
var WorkflowQueryService = class {
	#ready;
	/**
	* @param options.ready 等存储 / 引擎就绪后返回引擎
	*/
	constructor(options) {
		this.#ready = options.ready;
	}
	/**
	* 一个执行者标识符被工作流 / 作业引用的情况。
	*
	* @param id 执行者标识符
	* @returns 运行中作业、引用它的工作流与已结束作业数
	*/
	async workerUsage(id) {
		return await (await this.#ready()).workerUsage(id);
	}
};
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
/** 主体：工作人员或执行者；v8 写 `id`，v7 作业快照写 `name`。 */
const workerExecutorShape = {
	id: string().optional(),
	name: string().optional(),
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
/** 发起人。 */
const starterSchema = discriminatedUnion("kind", [object({ kind: literal("human") }).passthrough(), object({
	kind: literal("session"),
	sessionId: string()
}).passthrough()]);
/** 任务结果；v6 及更早的记录带 output，打开后按旧版本作业处理。 */
const taskResultSchema = object({
	output: unknown().nullable().optional(),
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
	input: unknown(),
	delivery: unknown().optional(),
	inputSummary: string(),
	error: string().nullable(),
	restartCount: number().int().nonnegative().optional(),
	budgetStartedAt: string().optional(),
	restartedFrom: string().nullable().optional(),
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
	channel: string().nullable().optional(),
	content: unknown().optional(),
	payload: unknown().optional(),
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
	version: 3,
	compatibleVersions: [1, 2],
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
	const id = typeof record.id === "string" && record.id !== "" ? record.id : void 0;
	const name = typeof record.name === "string" && record.name !== "" ? record.name : void 0;
	return {
		kind: "worker",
		...id === void 0 ? {} : { id },
		...name === void 0 ? {} : { name },
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
/** 把定义快照里岗位主体的 `kind: "robot"` 归一成 `worker`（不改版本与引用字段）。 */
function normalizeDefinitionExecutors(definition) {
	if (definition === null || typeof definition !== "object" || !Array.isArray(definition.positions)) return definition;
	let changed = false;
	const positions = definition.positions.map((position) => {
		const executor = position.executor;
		if (executor.kind !== "robot") return position;
		changed = true;
		const id = typeof executor.id === "string" && executor.id !== "" ? executor.id : void 0;
		const name = typeof executor.name === "string" && executor.name !== "" ? executor.name : void 0;
		return {
			...position,
			executor: {
				kind: "worker",
				...id === void 0 ? {} : { id },
				...name === void 0 ? {} : { name }
			}
		};
	});
	return changed ? {
		...definition,
		positions
	} : definition;
}
/**
* 把 v7 工作流定义升到 v8：岗位主体的 `name` 改名为 `id`，值不变。
*
* 老执行者的标识符就是它当时登记的名字，所以这里只是字段改名；任务类型
* `assistant` 的值与交回方式本来就是引用键，不需要转换。迁移幂等：v8 定义
* 原样返回，不产生写入。
*/
function migrateWorkflowDefinitionToV8(definition) {
	if (definition === null || typeof definition !== "object") return definition;
	if (definition.version !== 7) return definition;
	const record = definition;
	if (!Array.isArray(record.positions)) return {
		...definition,
		version: 8
	};
	const positions = record.positions.map((position) => {
		const executor = position.executor;
		if (executor === null || executor === void 0 || executor.kind !== "worker" && executor.kind !== "robot") return position;
		const id = workerRef(executor);
		return {
			...position,
			executor: {
				kind: "worker",
				...id === null ? {} : { id }
			}
		};
	});
	return {
		...record,
		version: 8,
		positions
	};
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
		return 3;
	}
	/**
	* 把术语改名前的旧记录（主体 / 承办者 `kind: "robot"`、driver `"program"`）
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
		if (tasks > 0 || jobs > 0) this.logger?.info?.(`buka-workflows: normalized legacy worker fields (${tasks} task(s), ${jobs} job(s))`);
	}
	/**
	* 把 workflows 表里 v7 的定义快照升到 v8：主体的 `name` 改名成 `id`。
	*
	* 作业快照（jobs.definition）保持 v7 形状，读取时按旧字段兜底；这里只动
	* 工作流定义。迁移幂等：v8 定义不产生写入，重复打开不再汇报条数。
	*/
	async migrateWorkflowDefinitionsToV8() {
		let workflows = 0;
		let definitions = 0;
		for (const [id, record] of this.domain.table("workflows").entries()) {
			let changed = false;
			const versions = {};
			for (const [version, snapshot] of Object.entries(record.versions)) {
				const definition = migrateWorkflowDefinitionToV8(snapshot.definition);
				if (definition !== snapshot.definition) {
					changed = true;
					definitions += 1;
				}
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
		if (definitions > 0) this.logger?.info?.(`buka-workflows: migrated ${definitions} workflow definition(s) to v8 (${workflows} workflow(s))`);
	}
	/** 打开域之后的初始化：键唯一性、旧草稿启用、作业编号回填。 */
	async init() {
		for (const [key, record] of this.domain.table("workflows").entries()) if (key !== record.id) throw new Error(`workflows: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("jobs").entries()) if (key !== record.id) throw new Error(`jobs: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("tasks").entries()) if (key !== record.id) throw new Error(`tasks: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("attempts").entries()) if (key !== record.id) throw new Error(`attempts: stored key "${key}" differs from record id`);
		for (const [key, record] of this.domain.table("attachments").entries()) if (key !== record.id) throw new Error(`attachments: stored key "${key}" differs from record id`);
		await this.normalizeLegacyWorkerKinds();
		await this.migrateWorkflowDefinitionsToV8();
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
* 模型工具注册（ADR 0015）。
*
* 可见性：
* - 工作流定义工具只对配置点名的编排 preset 根会话可见；
* - 启动 / 状态 / 取消工具对普通会话可见（发起人 = 当前会话）；
* - 执行工具（建任务 / 提交结果 / 看板 / 任务 / 附件）只对引擎创建的任务会话、
*   助理会话与发起人会话可见，并在 `execute` 里按会话再校验一次。
*
* @module @buka/dsh-plugin-workflows/tools
*/
/**
* 把已知 JSON 兼容的运行时对象标成工具输出的 json 类型。
*
* @param value 运行时的 JSON 对象
* @returns 工具输出可接受的 json 值
*/
function toolJson(value) {
	return value;
}
/** 模型可读的任务投影：不带岗位 / 通道等编排信息。 */
function taskForModel(task, withContent = false) {
	const result = task.result;
	return {
		id: task.id,
		type: task.typeLabel ?? task.type,
		status: task.status,
		deps: task.deps,
		...withContent ? { content: task.content } : {},
		...result === null || result === void 0 ? {} : {
			text: result.text,
			...result.action === void 0 ? {} : { action: result.action },
			...result.input === void 0 ? {} : { input: result.input },
			attachments: Array.isArray(result.attachments) ? result.attachments.map((attachment) => ({
				id: attachment.id,
				name: attachment.name,
				bytes: attachment.bytes,
				mime: attachment.mime,
				description: attachment.description
			})) : []
		}
	};
}
/** 一段模型可读文本。 */
function text$1(value) {
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
const DEFINITION_HELP = `Workflow definition (v8) JSON shape:
{
  "version": 8, "name": "...", "description": "...",
  "budgets": { "maxTasks": 200, "maxDurationHours": 72 },
  "start": {
    "content": <JSON Schema object: what the starter fills in>,
    "next": [
      { "channel": "<channel id leaving start>", "type": "<task type id>",
        "content": { ...templates over {{content.<path}}...} }
    ]
  },
  "end": { "content": <JSON Schema object: the final report> },
  "positions": [
    { "id": "dev", "label": "研发", "note": "<optional note for whoever maintains this flow>",
      "executor": { "kind": "worker", "id": "<worker identifier>" } | { "kind": "human" },
      "taskTypes": [
        { "id": "dev.implement", "label": "开发",
          "definition": "<what this kind of task is and what to do; preset facts live here>",
          "content": <JSON Schema object: the task content the creator must supply>,
          "creates": [   // robot positions only: tasks created when this task finishes
            { "channel": "<channel id from this position>", "type": "<task type id>",
              "content": { "field": "{{content.until}}" } }
          ],
          "assistant": "<assistant worker identifier>" | null, "plan": true,
          "agentPreset": "<agent preset id>",   // agent positions only
          "concurrency": 2,                     // agent / robot positions only, default 1
          "worktree": "none" | "guard" | "create",   // agent positions only
          "actions": [   // human positions only
            { "id": "pass", "label": "通过",
              "input": <JSON Schema object: the form the human fills, optional>,
              "creates": [ { "channel": "<channel id from this position>", "type": "<task type id>",
                             "content": { "field": "{{input.reason}}" } } ] }
          ] }
      ] }
  ],
  "channels": [
    { "id": "start.dev", "label": "受理", "from": "start", "to": "dev" },
    { "id": "dev.qa", "label": "提测", "from": "dev", "to": "qa", "types": ["qa.verify"] },
    { "id": "qa.dev.rework", "label": "返工", "from": "qa", "to": "dev", "types": ["dev.fix"], "back": true },
    { "id": "deploy.end", "label": "交付", "from": "deploy", "to": "end" }
  ]
}
The start and end nodes are two built-in task types, one declared per workflow: "start" accepts only "content" (the job input schema) and "next" (its creation declarations, at least one), "end" accepts only "content" (the final report schema). Their id, label and definition are fixed; "actions", "assistant", "plan", "agentPreset", "concurrency" and "worktree" are invalid there. Unknown fields are rejected everywhere in the definition. The start task is handled by the built-in "engine" worker; the end task is handled by the starter (or the delivery assistant chosen when the job starts). Rules: schemas use the restricted subset (type/description/properties/required/additionalProperties/items/enum/const/oneOf; top-level type must be "object"). A position whose executor is a robot (for example clock) must declare a content schema for every task type that covers the program's input contract: clock reads an object with required "until" (ISO 8601 timestamp), and saving the definition rejects task types that do not declare it. Robot task types may also declare "creates": when the robot finishes a task, the engine creates those tasks along the channels, and each created task depends on the finished task; their content templates may only use {{content.<path>}} (the robot's task content). A task type's "definition" is preset information the executor must know (for example the CI pipeline of each service); the per-task "content" is what the creator supplies. An agent task type may set "worktree" to one of three values: "none" injects no worktree prompt (omitting it means none), "guard" only tells the executor to check that the workspace and every repository it will modify is clean and to stop and ask the user when there are uncommitted changes, and "create" tells the executor to create and enter new Git worktrees itself with create_worktree (one per repository it modifies, so a task may touch several repositories). "create" only takes effect when the user has enabled the worktree plugin; when it is not enabled it degrades to "guard". An agent task type may set "plan": true to start the session in DSH plan mode, and "agentPreset" to the id of the agent preset its session starts with (the task type overrides the worker default, which overrides the plugin option; plan mode and the preset are independent). An agent or robot task type may set "concurrency" to a positive integer: the maximum number of tasks of that type running at once inside one job (default 1, waiting tasks start FIFO). Concurrency is per task type, not per position, and human tasks do not use the engine quota. Prompt-like text must NOT mention positions, channels, workflows or graph structure — the executor only knows its own task, the tools and its content. A channel is a named dispatch route: "id" is a lowercase unique identifier, "label" is the human-readable name shown in the graph (the engine never reads it), "from"/"to" are node ids (a position, or the built-in "start"/"end"). Craft tasks by channel + type in declared creations; the runtime tools use task-type targets. Channels into "end" cannot whitelist types and need no "type". Every position must be reachable from start and able to reach end. A cycle needs at least one explicitly marked back channel; channels between the same ordered pair must agree on "back". Templates may only reference {{content.<path>}} (the content of the task being completed) and {{input.<path>}} (the action form). A placeholder path ending in "?" renders an empty string when the value is missing, for optional form fields; a path without "?" is strict and fails when missing. The referenced path must exist in the schema either way. Human task types carry "actions"; a submission may also create nothing. The end task is acknowledged by the starter, so its content is the final report.`;
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
		description: `Validate and save a workflow definition as a new version. New workflows are enabled immediately. Only the orchestration preset can see this tool. Pass the complete v8 definition; executors and assistants reference workers by their immutable identifier; without "id" a new workflow is created.\n\n${DEFINITION_HELP}`,
		parameters: {
			definition: {
				type: "json",
				required: true,
				description: "The complete workflow v8 definition object."
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
					},
					warnings: {
						type: "json",
						required: true
					}
				}
			},
			render: (_args, value) => {
				const warnings = Array.isArray(value.warnings) ? value.warnings : [];
				const lines = [`已保存工作流「${String(value.name)}」（${String(value.workflowId)}，版本 ${String(value.version)}，状态 ${String(value.status)}）。`];
				if (warnings.length > 0) {
					lines.push("提示（不拦截保存）：");
					for (const warning of warnings) lines.push(`- ${String(warning.path ?? "")}: ${String(warning.message ?? "")}`);
				}
				return text$1(lines.join("\n"));
			}
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
				status: workflow.status,
				warnings: workflow.warnings.map((warning) => ({
					path: warning.path,
					message: warning.message
				}))
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
			render: (_args, value) => text$1(Array.isArray(value.workflows) && value.workflows.length > 0 ? value.workflows.map((workflow) => {
				const record = workflow;
				return `- ${String(record.id)}「${String(record.name)}」v${String(record.version)} ${String(record.status)}（${String(record.jobCount)} 个作业）`;
			}).join("\n") : "还没有保存过工作流。")
		},
		async execute(_args, exec) {
			assertOrchestrator(exec.agent);
			return { workflows: toolJson(await (await ready()).listWorkflowSummaries()) };
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
				return text$1(`工作流 ${String(record.id)}「${String(record.name)}」v${String(record.version)}（${String(record.status)}）\n\n${JSON.stringify(definition, null, 2)}`);
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
		description: "Start a workflow job from this session. The starter is this session: supply the workflow input as `content` (it must match the workflow start.content schema). If the input or initialization fails, a failed job and a failed start task are kept as a trace and the error names the job; such a job cannot be restarted. The job runs on the board; the final report is delivered back into this conversation and you confirm it with buka_task_complete. Use /job instead when the host supports commands.",
		parameters: {
			workflowId: {
				type: "string",
				required: true,
				description: "Workflow id to start."
			},
			content: {
				type: "json",
				description: "Workflow input matching the start.content schema; omit for no input."
			},
			delivery: {
				type: "json",
				description: "How the end task comes back: {\"kind\":\"starter\"} (default) or {\"kind\":\"assistant\",\"id\":\"<assistant worker identifier>\"}."
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
			render: (_args, value) => text$1(String(value.message))
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_job_start must be called from a session");
			const job = await (await ready()).createJobFromSession({
				workflowId: args.workflowId,
				content: args.content ?? {},
				sessionId,
				delivery: args.delivery
			});
			return {
				jobId: job.id,
				seq: job.seq,
				workflowName: job.workflowName,
				message: `已创建作业 #${job.seq}「${job.workflowName}」，任务已进入看板调度。作业结束后最终报告会回到本会话，调用 buka_task_complete 确认收到。`
			};
		}
	}));
	register(defineJobStatusTool(ready), starterVisible);
	register(defineJobCancelTool(ready), starterVisible);
	register(defineTaskTargetsTool(ready), executionVisible);
	register(defineTaskActionsTool(ready), executionVisible);
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
				return text$1(`作业 #${String(job.seq)}「${String(job.workflowName)}」状态 ${String(job.status)}\n任务：${[...counts].map(([status, count]) => `${status}=${count}`).join(" ") || "（无）"}`);
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
			render: (_args, value) => text$1(`作业 ${String(value.jobId)} 已取消（状态 ${String(value.status)}）。`)
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
/** 可创建目标工具。 */
function defineTaskTargetsTool(ready) {
	return defineTool({
		name: "buka_task_targets",
		description: "List the tasks this task can create next in the current job. Each target carries the content schema it expects. Call this before buka_task_create.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { targets: {
					type: "json",
					required: true
				} }
			},
			render: (_args, value) => text$1(JSON.stringify(value.targets, null, 2))
		},
		async execute(_args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_task_targets must be called from a task session");
			return { targets: toolJson((await ready()).creatableTargetsForSession(sessionId)) };
		}
	});
}
/** 人任务动作工具。 */
function defineTaskActionsTool(ready) {
	return defineTool({
		name: "buka_task_actions",
		description: "List the actions the human task this session is handling can take: each action carries a label and, when it needs input, a form schema. Pick one, fill the form, then call buka_task_complete with `action` (and `input`).",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { actions: {
					type: "json",
					required: true
				} }
			},
			render: (_args, value) => text$1(JSON.stringify(value.actions, null, 2))
		},
		async execute(_args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_task_actions must be called from a task session");
			return { actions: toolJson((await ready()).taskActionsForSession(sessionId)) };
		}
	});
}
/** 派生任务工具。 */
function defineTaskCreateTool(ready) {
	return defineTool({
		name: "buka_task_create",
		description: "Create a task in the current job (callable any number of times while executing a task). Call buka_task_targets first to see the available targets and their content schema. Dependencies default to the current task when omitted. The engine validates the content, dependencies (must exist in this job, no cycles) and the workflow budget.",
		parameters: {
			target: {
				type: "string",
				required: true,
				description: "Target id from buka_task_targets (\"end\" for the final delivery task)."
			},
			content: {
				type: "json",
				required: true,
				description: "Task content matching the target content schema."
			},
			deps: {
				type: "array",
				items: { type: "string" },
				description: "Task ids in this job that must complete first; omit to depend on this task."
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
			render: (_args, value) => text$1(`已创建任务 ${String(value.taskId)}（状态 ${String(value.status)}）。`)
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_task_create must be called from a task session");
			const target = typeof args.target === "string" ? args.target.trim() : "";
			if (target === "") throw new Error("buka_task_create requires a target from buka_task_targets");
			const task = await (await ready()).createTaskFromTarget({
				sessionId,
				target,
				content: args.content ?? {},
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
		description: "Submit the result of the task this session is executing: a summary `text` plus optional attachments. There is no structured result schema. Assistants of a human task also pass `action` (from buka_task_actions) and the action `input`.",
		parameters: {
			text: {
				type: "string",
				required: true,
				description: "Human-readable summary of the result."
			},
			action: {
				type: "string",
				description: "Human tasks only: the action id from buka_task_actions."
			},
			input: {
				type: "json",
				description: "Human tasks only: the form values for the chosen action."
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
			render: (_args, value) => text$1(`已提交任务 ${String(value.taskId)}（${String(value.status)}）；作业状态 ${String(value.jobStatus)}。`)
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (sessionId === "") throw new Error("buka_task_complete must be called from a task session");
			const result = await (await ready()).completeTaskFromSession({
				sessionId,
				text: typeof args.text === "string" ? args.text : "",
				action: typeof args.action === "string" ? args.action : void 0,
				input: args.input,
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
		description: "Read the tasks of the job this session is executing: id, type, status, dependencies, result text and attachments. Useful to gather task ids when creating follow-up tasks.",
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
				const lines = [`作业 #${String(job.seq)} 状态 ${String(job.status)}`];
				for (const task of tasks) {
					const record = task;
					lines.push(`- ${String(record.id)} ${String(record.type)} [${String(record.status)}] deps=${Array.isArray(record.deps) ? record.deps.join(",") : ""}`);
				}
				return text$1(lines.join("\n"));
			}
		},
		async execute(_args, exec) {
			const sessionId = sessionIdOf(exec);
			const engine = await ready();
			const reference = engine.taskForSession(sessionId);
			if (reference === null) throw new Error("this session is not executing a workflow task");
			const detail = await engine.jobDetail(reference.jobId);
			if (detail === null) throw new Error("job not found");
			const job = detail.job;
			const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
			return {
				job: toolJson({
					seq: job.seq,
					status: job.status
				}),
				tasks: toolJson(tasks.map((task) => taskForModel(task)))
			};
		}
	});
}
/** 任务读取工具。 */
function defineTaskGetTool(ready) {
	return defineTool({
		name: "buka_task_get",
		description: "Read one task of the job this session is executing: content, dependencies, result and attachments.",
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
			render: (_args, value) => text$1(JSON.stringify(value.task, null, 2))
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			const engine = await ready();
			const reference = engine.taskForSession(sessionId);
			if (reference === null) throw new Error("this session is not executing a workflow task");
			const detail = engine.taskDetail(reference.jobId, args.taskId);
			if (detail === null) throw new Error(`task not found: ${args.taskId}`);
			return { task: toolJson(taskForModel(detail, true)) };
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
			render: (_args, value) => text$1(JSON.stringify(value.attachments, null, 2))
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
// .build/workflows/assembly.js
/**
* `@buka/dsh-plugin-workflows` 工作流一半的宿主装配。
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
* 5. 注册浏览器路由；
* 6. 提供只读服务 `ctx.bukaWorkflows`（`workerUsage(id)`），供执行者删除前
*    计算引用面与唯一阻塞（运行中作业）。
*
* `storageDomain` 不放进 `inject`：缺少它的组合里插件仍然加载，只在真正需要
* 存储时给出明确错误。
*
* 本文件只导出装配函数；合并后的插件入口（`../index.ts`）负责把两份装配拼在一起。
*
* @module @buka/dsh-plugin-workflows/assembly
*/
/**
* 装配工作流一半。
*
* @param ctx 插件上下文
* @param config 合并插件配置
*/
function applyWorkflows(ctx, config) {
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
		ctx.logger?.warn?.(`buka-workflows: 初始化工作流存储失败：${describeError$4(error)}`);
	});
	ctx.provide(SERVICE_NAME$1, new WorkflowQueryService({ ready: ensureReady }));
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
	/** 发起人 / 执行会话可见性：作业状态与取消。 */
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
// .build/workflows/workers/access.js
/**
* 判断某个 agent 能否看到 / 调用执行者工具。
*
* - `allowed` 为空：配置显式关掉了收窄（所有会话可见，不推荐）。
* - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，收紧为不可见。
* - 其余情况：只有「点名 preset 的根会话」可见。
*
*/
function resolveWorkerBuildAccess(input = {}) {
	const allowed = normalizePresets(input.allowed);
	if (allowed.length === 0) return {
		visible: true,
		preset: null,
		reason: "open"
	};
	const sessions = input.sessions;
	const agentPresets = input.agentPresets;
	if (typeof sessions?.get !== "function" || typeof agentPresets?.presetForSession !== "function") return {
		visible: false,
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
// .build/workflows/workers/engine/session-runtime.js
/**
* 执行者会话的运行时小工具：等取消落定、组装消息、合并模型路由。
*
* 服务是非阻塞的：不再等轮次结束（观察者订阅会话事件），这里只保留真正被
* 调用到的函数；这些函数不读写服务状态，只操作传进来的 live agent。
*
* @module @buka/dsh-plugin-workflows/workers/engine/session-runtime
*/
/** 取消后等待 agent 落定（写入 turn/end）的最长时间。 */
const SETTLE_AFTER_CANCEL_MS = 2e3;
/**
* 从 composition 里取一个可选服务：先走 `ctx.get`（cordis 里表示服务可以
* 不存在），拿不到再读直接挂载的同名字段（旧式 / 测试替身上下文）。服务形状
* 以本文件实际调用为准。
*
* 直接属性读取在 cordis 里表示「必需注入」：服务不存在、或被 `isolate`
* 隔离在别的作用域时，会抛 `cannot get property "…" without inject`。可选
* 服务的缺失是正常状态，绝不能把异常带进调用方，所以这里把整段读取包进
* try/catch，失败时按不存在处理。
*/
function optionalService(ctx, name) {
	const viaGet = ctx?.get?.(name);
	if (viaGet !== void 0) return viaGet;
	try {
		return ctx?.[name];
	} catch {
		return;
	}
}
/**
* 一件完整的 user 消息：`followup` / `inject` 都要求 `role` 与 `id`，否则会话
* 历史在请求模型时无法转换成消息。
*
* @param text 消息正文
* @param sourceKind 消息来源；决定宿主按什么身份处理它
* @returns UserMessage 形状的对象
*/
function followupMessage(text, sourceKind = "buka-worker") {
	return {
		id: randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: { kind: sourceKind }
	};
}
/**
* 插件作者生成的上下文（工作流规则 + 任务内容）：用 `inject` 投递，来源不是
* `user`，不唤醒会话，也不会触发 `/skill-name` 手势。
*
* @param text 上下文正文
* @returns 非用户来源的消息
*/
function contextMessage(text) {
	return followupMessage(text, "buka-worker");
}
/**
* 流程维护者写的提示（任务类型的 `definition`）：用 `followup` 投递，来源是
* `user`。宿主只在这类消息里识别 `/skill-name` 手势，所以它也是
* `disable-model-invocation: true` skill 的唯一入口。
*
* @param text 用户身份提示
* @returns 用户来源的消息
*/
function userMessage(text) {
	return followupMessage(text, "user");
}
/**
* 取消后给 agent 一点时间落定 turn/end，避免读不到最后的文本。
*
*/
async function waitForSettle(agent) {
	let timer;
	try {
		await Promise.race([Promise.resolve(agent.whenIdle()), new Promise((resolve) => {
			timer = setTimeout(resolve, SETTLE_AFTER_CANCEL_MS);
		})]);
	} catch {} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/**
*/
async function disposeHandle(handle) {
	try {
		await handle.dispose();
	} catch {}
}
/**
* 合并模型路由。
*
*/
function mergeAgentOptions(defaults, overrides) {
	const merged = { ...defaults };
	if (overrides === void 0 || overrides === null) return merged;
	const entries = overrides;
	const target = merged;
	for (const key of [
		"provider",
		"model",
		"reasoningEffort",
		"maxTokens"
	]) {
		const value = entries[key];
		if (value === void 0 || value === null) continue;
		target[key] = value;
	}
	return merged;
}
/**
*/
function describeError$2(error) {
	return error instanceof Error ? error.message : String(error);
}
// .build/workflows/workers/model-catalog.js
/**
* 智能体可配置的模型目录：把宿主 LLM 注册表投影成页面用的按提供方分组清单。
*
* 目录只用于「给智能体选一个模型」：`available: false` 表示当前组合没有
* `ctx.llm`（模型目录不可用）；单个提供方读取失败时只记录 failure，其它提供方
* 仍然可用。模型保存只校验形状，不校验目录成员资格——模型可能暂时不可用
* （凭据缺失 / 目录未加载），保存的选择要保留下来，等目录恢复后再显示名称。
*
* @module @buka/dsh-plugin-workflows/workers/model-catalog
*/
/** 读字符串字段并 trim；不是字符串时返回空串。 */
function readString(value) {
	return typeof value === "string" ? value.trim() : "";
}
/** 把宿主默认选择投影成配置形状；缺 provider / model 时返回 null。 */
function readDefaultSelection(defaultModel) {
	const selection = defaultModel?.currentSelection?.();
	if (selection === null || selection === void 0) return null;
	const provider = readString(selection.provider);
	const model = readString(selection.model);
	if (provider === "" || model === "") return null;
	const reasoningEffort = readString(selection.reasoningEffort);
	return {
		provider,
		model,
		...reasoningEffort === "" ? {} : { reasoningEffort }
	};
}
/** 把一个提供方的模型目录展开成页面形状。 */
async function readGroup(llm, provider, signal) {
	const id = readString(provider.id);
	const models = typeof llm.listModels === "function" ? await llm.listModels(id) : [];
	const entries = await Promise.all(models.map(async (model) => {
		const modelId = readString(model.id);
		if (modelId === "") return null;
		const name = readString(model.name) || modelId;
		const description = readString(model.description);
		let reasoning;
		try {
			const resolved = typeof llm.resolveModelInfo === "function" ? await llm.resolveModelInfo(id, modelId, signal) : void 0;
			const efforts = (resolved?.reasoning?.efforts ?? []).map((effort) => {
				const effortId = readString(effort.id);
				if (effortId === "") return null;
				const effortName = readString(effort.name) || effortId;
				const effortDescription = readString(effort.description);
				return {
					id: effortId,
					name: effortName,
					...effortDescription === "" ? {} : { description: effortDescription }
				};
			}).filter((effort) => effort !== null);
			const defaultEffort = readString(resolved?.reasoning?.defaultEffort);
			if (efforts.length > 0) reasoning = {
				efforts,
				...defaultEffort === "" ? {} : { defaultEffort }
			};
		} catch {}
		return {
			id: modelId,
			name,
			...description === "" ? {} : { description },
			...reasoning === void 0 ? {} : { reasoning }
		};
	}));
	return {
		id,
		name: readString(provider.name) || id,
		models: entries.filter((entry) => entry !== null)
	};
}
/**
* 读取当前组合的模型目录。
*
* @param ctx 宿主上下文
* @param signal 可选取消信号（页面关闭时由路由传入）
*/
async function buildWorkerModelCatalog(ctx, signal) {
	signal?.throwIfAborted?.();
	const llm = optionalService(ctx, "llm");
	const defaultSelection = readDefaultSelection(optionalService(ctx, "agentDefaultModel"));
	if (llm === void 0 || typeof llm.listProviders !== "function") return {
		available: false,
		default: defaultSelection,
		groups: [],
		failures: []
	};
	const providers = llm.listProviders();
	const settled = await Promise.all(providers.map(async (provider) => {
		const id = readString(provider.id);
		const name = readString(provider.name) || id;
		if (id === "") return {
			kind: "failure",
			failure: {
				id,
				name,
				message: "empty provider id"
			}
		};
		try {
			return {
				kind: "group",
				group: await readGroup(llm, provider, signal)
			};
		} catch (error) {
			return {
				kind: "failure",
				failure: {
					id,
					name,
					message: error instanceof Error ? error.message : String(error)
				}
			};
		}
	}));
	return {
		available: true,
		default: defaultSelection,
		groups: settled.filter((entry) => entry.kind === "group").map((entry) => entry.group).filter((group) => group.models.length > 0),
		failures: settled.filter((entry) => entry.kind === "failure").map((entry) => entry.failure)
	};
}
// .build/workflows/workers/store/git.js
/**
* 执行者目录的 git 仓库初始化。
*
* 每个智能执行者的目录默认是一个独立 git 仓库：这是「分享」的基础——本地有
* 仓库，用户才能给它接上 GitHub / GitLab 等远端，再推送或让别人克隆。初始化
* 只在目录还不是仓库时发生：
*
* - 目录里已有 `.git`（普通仓库的目录，或 worktree / submodule 的 `.git` 文件）：
*   原样保留，不重跑、不覆盖；
* - 目录位于另一个仓库的工作树里（某个祖先目录有 `.git`）：**不建嵌套仓库**，
*   让目录里的文件继续由外层仓库管理；
* - 其余情况执行 `git init --quiet`；分支名交给用户自己的 `init.defaultBranch`；
* - 没装 git、没有写权限等失败一律降级成结果对象，不打断执行者的创建与列表。
*
* 初始化**不提交**：没有配置 `user.name` / `user.email` 的机器也能完成，首个
* 提交由用户自己决定。同一目录的并发调用在进程内合并成一次。
*
* @module @buka/dsh-plugin-workflows/workers/store/git
*/
/** 仓库元数据目录名；worktree / submodule 里它是指向真实 git 目录的文件。 */
const GIT_ENTRY = ".git";
/** `git init` 的超时；本地建目录通常几毫秒，慢盘留足余量就够了。 */
const INIT_TIMEOUT_MS = 1e4;
/** git 输出的上限；init 正常没有输出，这里只是防御。 */
const MAX_BUFFER = 1048576;
/** 同一目录正在进行的初始化；并发调用共享同一个结果。 */
const pendingInits = /* @__PURE__ */ new Map();
/**
* 确保一个执行者目录已经是一个 git 仓库。
*
* 幂等、永不 reject：已在仓库里、目录不存在、没装 git、`git init` 失败都返回
* 结果对象，由调用方决定是否提示；没装 git 时下次加载会重新尝试。目录不存在
* 或路径为空时不做任何写操作。
*
* @param directory 执行者目录的绝对路径
* @param options.runGit 注入的 git runner（单测用）
*/
function ensureWorkerGitRepo(directory, { runGit = runGitDefault } = {}) {
	const resolved = typeof directory === "string" ? directory.trim() : "";
	if (resolved === "") return Promise.resolve({
		ok: false,
		status: "missing",
		path: "",
		error: "缺少执行者目录"
	});
	const target = path.resolve(resolved);
	const running = pendingInits.get(target);
	if (running !== void 0) return running;
	const task = initRepository(target, runGit).finally(() => {
		pendingInits.delete(target);
	});
	pendingInits.set(target, task);
	return task;
}
/**
* `ensureWorkerGitRepo` 的实际工作，永不 reject。
*
*/
async function initRepository(directory, runGit) {
	if (!await isDirectory$1(directory)) return {
		ok: false,
		status: "missing",
		path: directory,
		error: `执行者目录不存在：${directory}`
	};
	if (await hasGitEntry(directory)) return {
		ok: true,
		status: "exists",
		path: directory
	};
	if (await hasGitAncestor(directory)) return {
		ok: true,
		status: "nested",
		path: directory
	};
	try {
		await runGit(["init", "--quiet"], { cwd: directory });
		return {
			ok: true,
			status: "created",
			path: directory
		};
	} catch (error) {
		if (isMissingGit(error)) return {
			ok: false,
			status: "unavailable",
			path: directory,
			error: "未找到 git 可执行文件；安装 git 或把它加入 PATH 后，下次加载会再试。"
		};
		return {
			ok: false,
			status: "failed",
			path: directory,
			error: gitFailureText(error)
		};
	}
}
/**
* 目录里是否有 `.git`；`lstat` 让 worktree / submodule 的 `.git` 文件也算数。
*
*/
async function hasGitEntry(directory) {
	try {
		await promises.lstat(path.join(directory, GIT_ENTRY));
		return true;
	} catch {
		return false;
	}
}
/**
* 某个祖先目录是否是仓库的根（工作树里已有 `.git`）。
*
* 从父目录开始逐级向上，遇到文件系统根为止；只看 `.git` 是否存在，不调用 git，
* 所以列表加载时不会有额外进程。
*/
async function hasGitAncestor(directory) {
	let current = path.dirname(directory);
	for (;;) {
		if (await hasGitEntry(current)) return true;
		const parent = path.dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}
/** 路径存在且是目录。 */
async function isDirectory$1(target) {
	try {
		return (await promises.stat(target)).isDirectory();
	} catch {
		return false;
	}
}
/**
* spawn 失败时 `execFile` 的 `error.code` 是字符串（`ENOENT` 表示 PATH 里没有
* git）；非零退出的 `code` 是数字退出码。
*
*/
function isMissingGit(error) {
	return error !== null && typeof error === "object" && error.code === "ENOENT";
}
/**
* 把 git 失败转成可展示的一行原因：优先用 stderr 的最后几行。
*
*/
function gitFailureText(error) {
	const tail = lastLines(trimmedString(error?.stderr), 3);
	if (tail !== "") return `git init 失败：${tail}`;
	const message = trimmedString(error?.message);
	if (message !== "") return `git init 失败：${message}`;
	return `git init 失败：${String(error)}`;
}
/** 非字符串按空串处理并去掉首尾空白。 */
function trimmedString(value) {
	return typeof value === "string" ? value.trim() : "";
}
/**
* 取文本最后几行并限制长度，避免把整份 git 输出塞进错误消息。
*
*/
function lastLines(text, count) {
	if (text === "") return "";
	return text.split(/\r?\n/u).filter((line) => line.trim() !== "").slice(-count).join("\n").slice(0, 500);
}
/**
* 默认 git runner：`execFile` + 超时 + 受限输出 + 禁用交互式认证。
*
* 初始化前清掉 `GIT_DIR` / `GIT_WORK_TREE`：宿主如果从 git 钩子等环境里启动，
* 这两个变量会把 `git init` 指向别处，执行者目录反而建不出仓库。
*/
function runGitDefault(args, { cwd } = {}) {
	const env = {
		...process.env,
		GIT_TERMINAL_PROMPT: "0"
	};
	delete env.GIT_DIR;
	delete env.GIT_WORK_TREE;
	return new Promise((resolve, reject) => {
		execFile("git", args, {
			...cwd === void 0 ? {} : { cwd },
			timeout: INIT_TIMEOUT_MS,
			maxBuffer: MAX_BUFFER,
			env,
			windowsHide: true
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
// .build/workflows/workers/store/paths.js
/**
* 执行者存储层的路径、标识符与文件系统小工具。
*
* 插件全局目录固定在 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workers`，默认
* 执行者根目录是它下面的 `workers`，登记文件是根目录同级的 `workers.json`。
* 路径展开、标识符校验（新格式 / 旧格式兼容）与 realpath 兜底都集中在这里，
* 便于用临时目录单测。
*
* @module @buka/dsh-plugin-workflows/workers/store/paths
*/
/** 每个执行者工作区里的协作说明文件名。 */
const AGENTS_FILE = "AGENTS.md";
/**
* Claude Code 读取的项目说明文件名。执行者目录里固定把它做成指向 AGENTS.md
* 的符号链接，两份工具读同一份内容；平台不允许建链接时改写 `@AGENTS.md`。
*/
const CLAUDE_FILE = "CLAUDE.md";
/** 允许通过页面写回 AGENTS.md 的上限（512 KiB）；超出由路由返回 413。 */
const AGENTS_MAX_WRITE_BYTES = 524288;
/** 插件全局目录名；位于 `${XDG_CACHE_HOME:-~/.cache}` 下。 */
const PLUGIN_CACHE_DIR = "dsh-plugin-workers";
/** 登记文件名；固定放在执行者根目录的父目录里。 */
const WORKER_REGISTRY_FILE = "workers.json";
/** 仍可读取的旧版登记表版本；读入时迁移到当前版本。 */
const WORKER_REGISTRY_LEGACY_VERSIONS = [
	1,
	2,
	3
];
/** 旧插件的全局目录名；启动时一次性搬到 `PLUGIN_CACHE_DIR`。 */
const LEGACY_PLUGIN_CACHE_DIR = "dsh-plugin-robots";
/**
* 新标识符的合法字符集：小写字母开头，后面可以跟小写字母、数字、`_` 与 `-`，
* 总长 1–64。标识符同时是目录名与引用键，所以只允许不需要转义的 ASCII。
*/
const WORKER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/**
* 旧登记表里的名字（迁移后成为旧标识符）的合法字符集：字母、数字（含汉字等
* Unicode 字母/数字）开头，后面可以跟 `._-`。点开头、路径分隔符与 NUL 都被
* 这个正则排除。
*/
const LEGACY_WORKER_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
/**
* 取用户 home 目录：优先用注入环境里的 `HOME`，否则用 `os.homedir()`。
* 测试传临时 env 时不会碰真实 home。
*
*/
function homeDir(env) {
	const configured = typeof env?.HOME === "string" ? env.HOME.trim() : "";
	if (configured !== "" && configured !== "~" && !configured.startsWith("~/") && !configured.startsWith("~\\")) return configured;
	return os.homedir();
}
/**
* 展开开头的 `~`；其它值原样返回。
*
*/
function expandPath(value, env) {
	const text = value.trim();
	if (text === "~") return homeDir(env);
	if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(homeDir(env), text.slice(2));
	return text;
}
/**
* 读一个可选的路径型环境变量：去空白、展开 `~`，空值返回 null。
*
*/
function envPath(value, env) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text === "") return null;
	return expandPath(text, env);
}
/**
* 插件全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workers`。
*
*/
function pluginCacheDir(env = process.env) {
	const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), ".cache");
	return path.join(cacheHome, PLUGIN_CACHE_DIR);
}
/**
* 旧插件的全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`。
*
* 只用于一次性迁移（见 `store/migrate.ts`）；新代码不要再往这里写。
*/
function legacyPluginCacheDir(env = process.env) {
	const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), ".cache");
	return path.join(cacheHome, LEGACY_PLUGIN_CACHE_DIR);
}
/**
* 执行者根目录的默认位置：`<插件全局目录>/workers`。
*
*/
function defaultWorkersRoot(env = process.env) {
	return path.join(pluginCacheDir(env), "workers");
}
/**
* 把配置里的根目录解析成绝对路径：空值回退默认目录，展开开头的 `~`，
* 相对路径按当前进程目录解析。
*
*/
function resolveWorkersDir(configured, env = process.env) {
	const text = typeof configured === "string" ? configured.trim() : "";
	if (text === "") return path.resolve(defaultWorkersRoot(env));
	return path.resolve(expandPath(text, env));
}
/**
* 登记文件路径：固定为执行者根目录的**同级** `workers.json`。
*
*/
function resolveWorkerRegistryFile(workersDir) {
	const base = typeof workersDir === "string" && workersDir.trim() !== "" ? path.resolve(workersDir) : path.resolve(defaultWorkersRoot());
	return path.join(path.dirname(base), WORKER_REGISTRY_FILE);
}
/**
* 判断一个值是不是**新**执行者标识符。
*
* 规则：trim 后匹配 `^[a-z][a-z0-9_-]{0,63}$`。只有创建新执行者时使用这条
* 严格规则；读写已有条目时用 `isResolvableWorkerId`，它同时接受迁移来的旧
* 标识符（旧登记表里的名字，可能含汉字、大写或 `._`）。
*
*/
function isValidWorkerId(id) {
	if (typeof id !== "string") return false;
	return WORKER_ID_PATTERN.test(id.trim());
}
/**
* 判断一个值是不是迁移来的**旧**标识符（旧登记表里的 `name`）。
*
* 旧标识符不受新字符集约束：trim 后 1–64 个字符，不能是 `.` / `..`，不能以
* `.` 开头，不能包含 `/`、`\`、NUL，允许 Unicode 字母、数字与 `._-`。
*
*/
function isLegacyWorkerId(id) {
	if (typeof id !== "string") return false;
	const text = id.trim();
	if (text.length < 1 || text.length > 64) return false;
	if (text === "." || text === "..") return false;
	return LEGACY_WORKER_ID_PATTERN.test(text);
}
/**
* 判断一个标识符能否用来定位已有执行者：新标识符或迁移来的旧标识符都接受。
*
* 更新 / 改名 / 删除 / 解析路由都走这条判定；创建新执行者只走
* `isValidWorkerId`，避免新记录再落一个旧格式的标识符。
*
*/
function isResolvableWorkerId(id) {
	return isValidWorkerId(id) || isLegacyWorkerId(id);
}
/**
* 执行者标识符对应的绝对目录；标识符不合法或解析后跑出根目录时返回 null。
*
*/
function workerDirectory(workersDir, id) {
	if (!isResolvableWorkerId(id)) return null;
	if (typeof workersDir !== "string" || workersDir.trim() === "") return null;
	const base = path.resolve(workersDir);
	const target = path.resolve(base, id.trim());
	const relative = path.relative(base, target);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return target;
}
/**
* 校验并规范化登记文件路径。
*
*/
function requireRegistryFile(file) {
	if (typeof file !== "string" || file.trim() === "") throw new Error("缺少执行者登记文件路径");
	return path.resolve(file);
}
/**
* 判断路径存在且是目录。
*
*/
async function isDirectory(target) {
	if (typeof target !== "string" || target === "") return false;
	try {
		return (await promises.stat(target)).isDirectory();
	} catch {
		return false;
	}
}
/**
* 判断路径是否存在。
*
*/
async function pathExists(target) {
	try {
		await promises.access(target);
		return true;
	} catch {
		return false;
	}
}
/**
* `fs.realpath`，失败时回退到调用方给的路径。
*
*/
async function realpathOr(target, fallback) {
	return await realpathOrNull(target) ?? fallback;
}
/**
* `fs.realpath`，失败时返回 null。
*
*/
async function realpathOrNull(target) {
	try {
		return await promises.realpath(target);
	} catch {
		return null;
	}
}
// .build/workflows/workers/store/agents.js
/**
* 执行者目录里的说明文件：AGENTS.md 的读写、模板，以及 CLAUDE.md 链接。
*
* 执行者目录固定放一份 `AGENTS.md`；Claude Code 的 `CLAUDE.md` 默认做成指向
* 它的符号链接（平台不支持时写 `@AGENTS.md`）。新建执行者时顺带补目录与模板。
*
* @module @buka/dsh-plugin-workflows/workers/store/agents
*/
/**
* 确保执行者目录存在，并补一份 AGENTS.md 模板（不覆盖已有的）。
*
* 模板里的路径用目录的规范绝对路径（`fs.realpath`，失败回退解析值），与
* 登记进 `workers.json` 的路径、DSH 工作区记录里的路径保持一致。
*
*/
async function ensureWorkerDirectory(directory, label) {
	await promises.mkdir(directory, { recursive: true });
	if (!(await promises.stat(directory)).isDirectory()) {
		const error = /* @__PURE__ */ new Error(`目标路径已存在且不是目录：${directory}`);
		throw Object.assign(error, { code: "not-directory" });
	}
	const canonical = await realpathOr(directory, directory);
	const agentsFile = path.join(canonical, AGENTS_FILE);
	if (!await pathExists(agentsFile)) await promises.writeFile(agentsFile, workerAgentsTemplate(label, canonical), "utf8");
	await ensureClaudeLink(canonical);
	await ensureWorkerGitRepo(canonical);
	return canonical;
}
/**
* 执行者目录里 CLAUDE.md 的状态。
*
* `mode`：`symlink`（指向同目录 AGENTS.md 的符号链接）、`import`（平台不支持
* 建链接时写下的 `@AGENTS.md`）、`file`（用户自己的普通文件）、`foreign-link`
* （指向别处的符号链接）、`missing`（不存在）。
*
*/
async function readClaudeLink(directory) {
	if (typeof directory !== "string" || directory.trim() === "") return {
		exists: false,
		symlink: false,
		mode: "missing",
		target: ""
	};
	const base = path.resolve(directory);
	const file = path.join(base, CLAUDE_FILE);
	let stat;
	try {
		stat = await promises.lstat(file);
	} catch {
		return {
			exists: false,
			symlink: false,
			mode: "missing",
			target: ""
		};
	}
	if (stat.isSymbolicLink()) {
		let target = "";
		try {
			target = await promises.readlink(file);
		} catch {
			target = "";
		}
		const linked = target !== "" && path.resolve(base, target) === path.join(base, "AGENTS.md");
		return {
			exists: true,
			symlink: linked,
			mode: linked ? "symlink" : "foreign-link",
			target
		};
	}
	try {
		if (stat.size <= 256) {
			if ((await promises.readFile(file, "utf8")).trim() === `@AGENTS.md`) return {
				exists: true,
				symlink: false,
				mode: "import",
				target: AGENTS_FILE
			};
		}
	} catch {}
	return {
		exists: true,
		symlink: false,
		mode: "file",
		target: ""
	};
}
/**
* 确保 `<执行者目录>/CLAUDE.md` 指向 `AGENTS.md`。
*
* - 已经是指向 AGENTS.md 的符号链接：原样返回，不重建；
* - 已存在其它文件 / 链接：**不覆盖**，原样返回状态，交给页面提示；
* - 不存在：优先建相对符号链接；平台不允许（如 Windows 未开开发者模式）时
*   退回一份只有 `@AGENTS.md` 的说明文件，Claude Code 仍会导入同一份内容。
*
*/
async function ensureClaudeLink(directory) {
	if (typeof directory !== "string" || directory.trim() === "") return {
		exists: false,
		symlink: false,
		mode: "missing",
		target: ""
	};
	const base = path.resolve(directory);
	const current = await readClaudeLink(base);
	if (current.exists) return current;
	const file = path.join(base, CLAUDE_FILE);
	try {
		await promises.symlink(AGENTS_FILE, file, "file");
		return {
			exists: true,
			symlink: true,
			mode: "symlink",
			target: AGENTS_FILE
		};
	} catch {
		try {
			await promises.writeFile(file, `@${AGENTS_FILE}\n`, "utf8");
			return {
				exists: true,
				symlink: false,
				mode: "import",
				target: AGENTS_FILE
			};
		} catch {
			return {
				exists: false,
				symlink: false,
				mode: "missing",
				target: ""
			};
		}
	}
}
/**
* 空的 AGENTS.md 摘要；文件不存在或读不了时用它，保证响应结构稳定。
*
*/
function emptyAgentsFile() {
	return {
		exists: false,
		bytes: 0,
		modifiedAt: null,
		content: "",
		tooLarge: false
	};
}
/**
* 读 `<path>/AGENTS.md`。
*
* 文件存在且不超过 256 KiB 时返回全文；超过上限时只返回大小与
* `tooLarge: true`，`content` 为空串（页面不会把大文件塞进 textarea）。
*
*/
async function readAgentsFile(workspacePath) {
	if (typeof workspacePath !== "string" || workspacePath.trim() === "") return emptyAgentsFile();
	const file = path.join(workspacePath, AGENTS_FILE);
	let stat;
	try {
		stat = await promises.stat(file);
	} catch {
		return emptyAgentsFile();
	}
	if (!stat.isFile()) return emptyAgentsFile();
	const modifiedAt = new Date(stat.mtimeMs).toISOString();
	if (stat.size > 262144) return {
		exists: true,
		bytes: stat.size,
		modifiedAt,
		content: "",
		tooLarge: true
	};
	try {
		const content = await promises.readFile(file, "utf8");
		return {
			exists: true,
			bytes: Buffer.byteLength(content, "utf8"),
			modifiedAt,
			content,
			tooLarge: false
		};
	} catch {
		return {
			exists: true,
			bytes: stat.size,
			modifiedAt,
			content: "",
			tooLarge: false
		};
	}
}
/**
* 直接写 `<path>/AGENTS.md`（UTF-8），返回写入的字节数与新的修改时间。
* 上限检查由路由做（512 KiB）；目录不存在时这里会抛错，由路由转成 409/500。
*
*/
async function writeAgentsFile(workspacePath, content) {
	if (typeof workspacePath !== "string" || workspacePath === "") throw new Error("缺少工作区目录");
	const text = typeof content === "string" ? content : String(content ?? "");
	const file = path.join(workspacePath, AGENTS_FILE);
	await promises.writeFile(file, text, "utf8");
	const stat = await promises.stat(file);
	return {
		bytes: Buffer.byteLength(text, "utf8"),
		modifiedAt: new Date(stat.mtimeMs).toISOString()
	};
}
/**
* 新执行者的 AGENTS.md 模板；路径是磁盘上的真实值，`label` 是展示名
* （名称为空时用标识符）。
*
*/
function workerAgentsTemplate(label, workerPath) {
	return `# AGENTS.md

这是「${label}」执行者的协作说明。这个目录同时是一个 DSH 工作区。

## 项目

- 路径：\`${workerPath}\`
- 用途：

## 约定

- 动手前先读仓库里已有的文档、脚本与测试。
- 提交信息用 Conventional Commits；一个 commit 只做一件事。
`;
}
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
				settle(setupFailure(errorText(error)));
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
					message: errorText(error),
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
	if (await exists$1(npxCli)) return {
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
function errorText(error) {
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
async function exists$1(target) {
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
// .build/workflows/workers/avatar.js
/**
* 执行者头像的 Host 侧契约：预设 id、默认分配与校验。
*
* 头像在登记表里只存一个 id（例如 `panda`），显示由两个浏览器一半各自维护一份
* 同一 id → emoji / 底色的映射：`src/client/workers/` 的执行者页与
* `src/client/` 的工作流节点图。因此 **id 是跨半边的稳定契约**，增删预设时要
* 同步两处客户端。
*
* 默认分配是确定性的：没有指定头像的执行者按不可变标识符哈希到一个预设，这样
* 旧登记表里的执行者也有稳定头像，改名不会让头像漂移；新建执行者优先挑一个还
* 没被占用的预设，避免刚创建的一批执行者全是一个样子。
*
* 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-workflows/workers/avatar
*/
/**
* 预设头像 id。顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是标识符
* 哈希的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
*
* `robot`（🤖）是内建执行者 `engine` 的默认头像，按「只增不改」追加在末尾；
* 历史遗留的 `worker` id 仍在预设之外，会按标识符哈希落回其它预设。
*
*/
const AVATAR_IDS = Object.freeze([
	"sprout",
	"sun",
	"cat",
	"fox",
	"panda",
	"owl",
	"whale",
	"octopus",
	"bee",
	"rocket",
	"dino",
	"ghost",
	"penguin",
	"unicorn",
	"mushroom",
	"robot"
]);
/** 没有任何可用 id 时的兜底头像。 */
const DEFAULT_AVATAR_ID = AVATAR_IDS[0];
/** id → 是否属于预设集合。 */
const AVATAR_ID_SET = new Set(AVATAR_IDS);
/**
* 这个值是不是一个预设头像 id。
*
*/
function isAvatarId(value) {
	return typeof value === "string" && AVATAR_ID_SET.has(value);
}
/**
* 标识符 → 稳定哈希（FNV-1a，按 Unicode 码点遍历；迁移来的旧标识符可能含汉字）。
*
*/
function hashName(id) {
	let hash = 2166136261;
	for (const char of String(id ?? "")) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
/**
* 标识符对应的确定性头像：同一个标识符永远得到同一个头像。
*
*/
function defaultAvatarFor(id) {
	return AVATAR_IDS[hashName(id) % AVATAR_IDS.length] ?? DEFAULT_AVATAR_ID;
}
/**
* 新建执行者时的默认头像：先按标识符哈希，如果这个 id 已经被别的执行者用了，
* 就按预设顺序挑第一个没被占用的；全被占用时回到标识符哈希的结果。
*
*/
function pickDefaultAvatar(id, used = []) {
	const taken = new Set(used);
	const preferred = defaultAvatarFor(id);
	if (!taken.has(preferred)) return preferred;
	for (const id of AVATAR_IDS) if (!taken.has(id)) return id;
	return preferred;
}
/**
* 读取登记表里的头像值并规范化：合法的 id 原样返回，缺省 / 非法值按执行者标识符兜底。
*
*/
function resolveAvatar(value, workerId) {
	return isAvatarId(value) ? value : defaultAvatarFor(workerId);
}
/** 登记表里能读到的版本：当前版本 + 仍需要迁移的旧版本。 */
const READABLE_VERSIONS = /* @__PURE__ */ new Set([4, ...WORKER_REGISTRY_LEGACY_VERSIONS]);
/** 判断值是不是普通对象（不是数组 / null）。 */
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* 规范化一份模型选择；缺字段、空串或超长时返回 undefined。
*
* 只校验形状，不校验目录成员资格：模型可能暂时不可用（凭据缺失 / 目录未加载），
* 保存的选择仍然保留，等目录恢复后再匹配。
*/
function normalizeWorkerModel(value) {
	if (!isRecord(value)) return void 0;
	const provider = typeof value.provider === "string" ? value.provider.trim() : "";
	const model = typeof value.model === "string" ? value.model.trim() : "";
	if (provider === "" || model === "") return void 0;
	if (provider.length > 200 || model.length > 200) return;
	const reasoningEffort = typeof value.reasoningEffort === "string" ? value.reasoningEffort.trim() : "";
	if (reasoningEffort.length > 200) return void 0;
	return {
		provider,
		model,
		...reasoningEffort === "" ? {} : { reasoningEffort }
	};
}
/**
* 规范化执行者预设 id：trim 后为空或类型不对时返回 undefined。
*
* 只校验形状：预设可能只在另一台机器上存在；保存的选择仍然保留，派发时挂载
* 失败按任务失败处理（ADR 0032）。
*/
function normalizeAgentPreset(value) {
	if (typeof value !== "string") return void 0;
	const id = value.trim();
	if (id === "" || id.length > 128) return void 0;
	return id;
}
/**
* 规范化展示名：折叠连续空白并 trim；非字符串按空串处理。
*
* 名称只用于展示，不要求唯一；空串表示「未设置」，展示时回退到标识符。
*
*/
function normalizeWorkerName(value) {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/gu, " ").trim();
}
/**
* 展示名是否合法：字符串且规范化后不超过上限。
*
*/
function isValidWorkerName(value) {
	return typeof value === "string" && normalizeWorkerName(value).length <= 64;
}
/**
* 写入口用的展示名规范化：缺省 / null 表示「未设置」；类型不对或超长抛
* `code = 'invalid-name'`。
*
*/
function normalizeWorkerNameInput(value) {
	if (value === void 0 || value === null) return "";
	if (!isValidWorkerName(value)) throw invalidNameError(value);
	return normalizeWorkerName(value);
}
/**
* 读登记表里的一个条目并迁移成当前形状；不合法时返回 undefined。
*
* - version 1 / 2 / 3 条目没有 `id`：`id` 取旧 `name`（旧标识符，可能含汉字 /
*   大写 / `._`），`name` 置空；
* - version 4 条目必须同时有能定位的 `id`；`name` 是可选展示名；
* - `driver` 缺失（version 1 旧条目）或取值写坏时按 `agent` 处理；
*   version 2 的 `program` 取值迁移成 `robot`；
* - 机器人条目必须有非空 `program` id，智能体条目必须有非空 `path`；
* - 旧表里的 `assistant` 字段直接丢弃，不进入记录。
*/
function readEntry(entry, version) {
	const legacy = version < 4;
	let id;
	if (legacy) {
		if (!isLegacyWorkerId(entry.name)) return void 0;
		id = entry.name.trim();
	} else {
		if (!isResolvableWorkerId(entry.id)) return void 0;
		id = entry.id.trim();
	}
	const name = legacy ? "" : normalizeWorkerName(entry.name).slice(0, 64);
	const rawDriver = entry.driver;
	const driver = rawDriver === "robot" || rawDriver === "program" ? "robot" : "agent";
	const program = driver === "robot" && typeof entry.program === "string" ? entry.program.trim() : "";
	if (driver === "robot" && program === "") return void 0;
	const workerPath = typeof entry.path === "string" ? entry.path.trim() : "";
	if (driver === "agent" && workerPath === "") return void 0;
	const model = driver === "agent" ? normalizeWorkerModel(entry.model) : void 0;
	const agentPreset = driver === "agent" ? normalizeAgentPreset(entry.agentPreset) : void 0;
	return {
		id,
		name,
		driver,
		path: workerPath,
		program,
		createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
		avatar: typeof entry.avatar === "string" ? entry.avatar.trim() : "",
		description: normalizeWorkerDescription(entry.description).slice(0, 500),
		...model === void 0 ? {} : { model },
		...agentPreset === void 0 ? {} : { agentPreset }
	};
}
/**
* 把一条待写入记录规范化成完整记录；缺省字段按当前格式补齐。
*
* - `driver` 缺省按 `agent`；
* - agent 记录补 `path`、清空 `program`；robot 记录补 `program`、清空 `path`；
* - `avatar` 总是落成具体预设 id（旧记录第一次写回时顺带补齐），默认头像按
*   标识符哈希，改名不会让头像漂移；
* - 描述折叠空白并截断。
*/
function normalizeRecord(worker) {
	const driver = worker.driver === "robot" ? "robot" : "agent";
	const model = driver === "agent" ? normalizeWorkerModel(worker.model) : void 0;
	const agentPreset = driver === "agent" ? normalizeAgentPreset(worker.agentPreset) : void 0;
	const id = typeof worker.id === "string" ? worker.id.trim() : "";
	return {
		id,
		name: normalizeWorkerName(worker.name).slice(0, 64),
		driver,
		path: driver === "agent" && typeof worker.path === "string" ? worker.path : "",
		program: driver === "robot" && typeof worker.program === "string" ? worker.program.trim() : "",
		createdAt: worker.createdAt,
		avatar: resolveAvatar(worker.avatar, id),
		description: normalizeWorkerDescription(worker.description).slice(0, 500),
		...model === void 0 ? {} : { model },
		...agentPreset === void 0 ? {} : { agentPreset }
	};
}
/**
* 读执行者登记表。
*
* - 文件不存在：`{ version: 4, workers: [], file }`（内建执行者由调用方合并）；
* - 读不了 / 不是合法 JSON / 版本不可读 / `workers` 不是数组：`corrupt: true`
*   且 `workers: []`（写操作必须据此拒绝，绝不覆盖原文件）；
* - version 1 旧表按 `driver: "agent"` 迁移；
*   version 2 的 `driver: "program"` 读成 `"robot"`；
*   version 1 / 2 / 3 的旧名字迁移成 `id`，`name` 置空；
* - 条目必须有能定位的 `id`（智能体还要有非空 `path`，机器人要有 `program`），
*   否则过滤掉；重复标识符只保留第一个。
* - `avatar` 是预设头像 id；旧登记表没有这个字段（或在别处被改坏）时留空，
*   展示 / 写入时由 `resolveAvatar` 按标识符兜底成一个确定的预设。
*
*/
async function readWorkerRegistry({ file } = {}) {
	const target = requireRegistryFile(file);
	let text;
	try {
		text = await promises.readFile(target, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return {
			version: 4,
			workers: [],
			file: target
		};
		return {
			version: 4,
			workers: [],
			corrupt: true,
			file: target
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			version: 4,
			workers: [],
			corrupt: true,
			file: target
		};
	}
	if (!isRecord(parsed)) return {
		version: 4,
		workers: [],
		corrupt: true,
		file: target
	};
	if (typeof parsed.version !== "number" || !READABLE_VERSIONS.has(parsed.version)) return {
		version: 4,
		workers: [],
		corrupt: true,
		file: target
	};
	const entries = parsed.version <= 2 && Array.isArray(parsed.robots) ? parsed.robots : parsed.workers;
	if (!Array.isArray(entries)) return {
		version: 4,
		workers: [],
		corrupt: true,
		file: target
	};
	const workers = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		const worker = readEntry(entry, parsed.version);
		if (worker === void 0 || seen.has(worker.id)) continue;
		seen.add(worker.id);
		workers.push(worker);
	}
	return {
		version: 4,
		workers,
		file: target
	};
}
/**
* 原子写执行者登记表（临时文件 + rename，权限 0600）。
*
* 目录不存在会先建好；写入失败时清理临时文件，原登记文件保持不变。写入总是
* 落成当前版本（version 4），旧记录缺的 `id` / `name` / `driver` 在这里补齐，
* 旧表残留的 `assistant` 不落盘。
*
*/
async function writeWorkerRegistry({ file, workers } = {}) {
	const target = requireRegistryFile(file);
	await writeJsonAtomic(target, {
		version: 4,
		workers: (Array.isArray(workers) ? workers : []).map((entry) => {
			const worker = normalizeRecord(entry);
			if (worker.driver === "robot") return {
				id: worker.id,
				name: worker.name,
				driver: worker.driver,
				program: worker.program,
				createdAt: worker.createdAt,
				avatar: worker.avatar,
				description: worker.description
			};
			return {
				id: worker.id,
				name: worker.name,
				driver: worker.driver,
				path: worker.path,
				createdAt: worker.createdAt,
				avatar: worker.avatar,
				description: worker.description,
				...worker.model === void 0 ? {} : { model: worker.model },
				...worker.agentPreset === void 0 ? {} : { agentPreset: worker.agentPreset }
			};
		})
	});
	return { file: target };
}
/**
* 把内建机器人补进登记表（幂等）。
*
* 只补缺的条目，不动已有条目与顺序；登记表损坏时拒绝写入、返回 `corrupt`。
*
*/
async function ensureBuiltinWorkers({ file } = {}) {
	const target = requireRegistryFile(file);
	const registry = await readWorkerRegistry({ file: target });
	if (registry.corrupt) return {
		added: [],
		corrupt: true
	};
	const ids = new Set(registry.workers.map((worker) => worker.id));
	const missing = BUILTIN_WORKERS.filter((worker) => !ids.has(worker.id));
	if (missing.length === 0) return { added: [] };
	await writeWorkerRegistry({
		file: target,
		workers: [...registry.workers, ...missing]
	});
	return { added: missing.map((worker) => worker.id) };
}
/**
* 生成「标识符不合法」错误。
*
*/
function invalidIdError(id) {
	const error = /* @__PURE__ */ new Error(`执行者标识符不合法：${String(id)}（新标识符需匹配 ^[a-z][a-z0-9_-]{0,63}$）`);
	return Object.assign(error, { code: "invalid-id" });
}
/**
* 生成「展示名不合法」错误。
*
*/
function invalidNameError(name) {
	const error = /* @__PURE__ */ new Error(`执行者名称不合法：需要不超过 64 个字符的单行文本（收到 ${String(name)}）`);
	return Object.assign(error, { code: "invalid-name" });
}
/**
* 生成「标识符已被占用」错误。
*
*/
function idTakenError(id) {
	const error = /* @__PURE__ */ new Error(`执行者标识符已被占用：${id}`);
	return Object.assign(error, { code: "id-taken" });
}
/**
* 生成「描述不合法」错误。
*
*/
function invalidDescriptionError(description) {
	const error = /* @__PURE__ */ new Error(`执行者描述不合法：需要不超过 500 个字符的单行文本（收到 ${String(description)}）`);
	return Object.assign(error, { code: "invalid-description" });
}
/**
* 生成「机器人只读」错误。
*
*/
function robotWorkerError(id) {
	const error = /* @__PURE__ */ new Error(`机器人只读，不能修改或打开会话：${String(id)}`);
	return Object.assign(error, { code: "robot-worker" });
}
/**
* 生成「模型选择不合法」错误。
*
*/
function invalidModelError(model) {
	const error = /* @__PURE__ */ new Error(`模型选择不合法：需要非空的 provider 与 model（收到 ${JSON.stringify(model)}）`);
	return Object.assign(error, { code: "invalid-model" });
}
/**
* 生成「执行者预设不合法」错误。
*
*/
function invalidAgentPresetError(preset) {
	const error = /* @__PURE__ */ new Error(`执行者预设不合法：需要非空的预设 id（收到 ${JSON.stringify(preset)}）`);
	return Object.assign(error, { code: "invalid-agent-preset" });
}
/**
* 规范化执行者描述：把换行 / 连续空白折叠成一个空格并 trim。描述是给工作流
* 选择执行者看的「一行摘要」（与 skill 的 description 类似），所以不保留排版。
* 非字符串按空描述处理。
*
*/
function normalizeWorkerDescription(value) {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/gu, " ").trim();
}
/**
* 生成「登记文件损坏」错误；写操作遇到它必须拒绝，不能覆盖用户文件。
*
*/
function registryUnreadableError$1(file) {
	const error = /* @__PURE__ */ new Error(`执行者登记文件无法读取：${file}。请修复或删除该文件后重试。`);
	return Object.assign(error, { code: "registry-unreadable" });
}
/**
* 生成「头像不合法」错误。
*
*/
function invalidAvatarError(avatar) {
	const error = /* @__PURE__ */ new Error(`头像不合法：${String(avatar)}`);
	return Object.assign(error, { code: "invalid-avatar" });
}
/**
* 生成「执行者不在登记表里」错误。
*
*/
function unknownWorkerError(id) {
	const error = /* @__PURE__ */ new Error(`执行者不在登记表里：${id}`);
	return Object.assign(error, { code: "unknown-worker" });
}
/**
* 新建一个智能体：按标识符建目录、补 AGENTS.md 模板、把条目插到登记表最前。
*
* - `id` 必填，必须匹配新标识符字符集；标识符已登记时抛 `id-taken`（id 冲突
*   必须拒绝，不会静默复用已有条目）；
* - 内建机器人（clock）的标识符不可创建；
* - 头像：传入合法 id 就用它，否则按标识符挑一个还没被占用的预设；新建的
*   执行者一定带头像；
* - 描述可选，存成一行摘要（空白折叠）；
* - 展示名可选，空串表示未设置；
* - 标识符不合法抛 `code = 'invalid-id'`；内建 id 抛 `code = 'builtin-worker'`；
*   登记文件损坏抛 `code = 'registry-unreadable'`（不覆盖原文件）；
* - 新条目的 `path` 是创建后的规范绝对路径（`fs.realpath`，失败回退解析值），
*   这样和工作区注册表里的路径能直接对齐。
*
*/
async function addWorker({ workersDir, file, id, name, avatar, description } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isValidWorkerId(id)) throw invalidIdError(id);
	const workerId = id.trim();
	if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId);
	const workerName = normalizeWorkerNameInput(name);
	const rawDescription = description === void 0 || description === null ? "" : description;
	if (typeof rawDescription !== "string") throw invalidDescriptionError(rawDescription);
	const cleanDescription = normalizeWorkerDescription(rawDescription);
	if (cleanDescription.length > 500) throw invalidDescriptionError(rawDescription);
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	if (registry.workers.find((worker) => worker.id === workerId) !== void 0) throw idTakenError(workerId);
	const target = workerDirectory(workersDir, workerId);
	if (target === null) throw invalidIdError(workerId);
	const canonical = await ensureWorkerDirectory(target, workerName === "" ? workerId : workerName);
	const used = registry.workers.map((worker) => resolveAvatar(worker.avatar, worker.id));
	const worker = {
		id: workerId,
		name: workerName,
		driver: "agent",
		path: canonical,
		program: "",
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		avatar: isAvatarId(avatar) ? avatar : pickDefaultAvatar(workerId, used),
		description: cleanDescription
	};
	await writeWorkerRegistry({
		file: registryFile,
		workers: [worker, ...registry.workers]
	});
	return {
		worker,
		created: true
	};
}
/**
* 定位一个已有执行者：接受新标识符与迁移来的旧标识符。
*
*/
function findWorker(registry, id) {
	return registry.workers.find((worker) => worker.id === id);
}
/**
* 改一个智能体的展示名：只动登记表里的 `name` 字段，不碰目录与工作区。
*
* - `id` 是标识符（新格式或迁移来的旧标识符都接受），不可修改；
* - 展示名可随时改、不要求唯一；空串表示清空（之后显示标识符）；
* - 名称没变时返回 `renamed: false`，不写文件；
* - 标识符不合法抛 `code = 'invalid-id'`；展示名不合法抛
*   `code = 'invalid-name'`；id 不在登记表里抛 `code = 'unknown-worker'`；
*   机器人只读，抛 `code = 'robot-worker'`。
*
*/
async function setWorkerName({ file, id, name } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isResolvableWorkerId(id)) throw invalidIdError(id);
	const workerId = id.trim();
	const nextName = normalizeWorkerNameInput(name);
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const current = findWorker(registry, workerId);
	if (current === void 0) throw unknownWorkerError(workerId);
	if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId);
	if (current.driver !== "agent") throw robotWorkerError(workerId);
	if (current.name === nextName) return {
		worker: current,
		previousName: current.name,
		renamed: false
	};
	const worker = {
		...current,
		name: nextName
	};
	await writeWorkerRegistry({
		file: registryFile,
		workers: registry.workers.map((entry) => entry.id === workerId ? worker : entry)
	});
	return {
		worker,
		previousName: current.name,
		renamed: true
	};
}
/**
* 改一个智能体的头像：只动登记表里的 `avatar` 字段，不碰目录与工作区。
*
* - 头像 id 不属于预设集合抛 `code = 'invalid-avatar'`；
* - 标识符不在登记表里抛 `code = 'unknown-worker'`；
* - 机器人只读，抛 `code = 'robot-worker'`；
* - 登记文件损坏抛 `code = 'registry-unreadable'`。
*
*/
async function setWorkerAvatar({ file, id, avatar } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isResolvableWorkerId(id)) throw invalidIdError(id);
	if (!isAvatarId(avatar)) throw invalidAvatarError(avatar);
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const workerId = id.trim();
	const current = findWorker(registry, workerId);
	if (current === void 0) throw unknownWorkerError(workerId);
	if (current.driver !== "agent") throw robotWorkerError(workerId);
	const worker = {
		...current,
		avatar
	};
	await writeWorkerRegistry({
		file: registryFile,
		workers: registry.workers.map((entry) => entry.id === workerId ? worker : entry)
	});
	return { worker };
}
/**
* 改一个智能体新会话使用的模型：只动登记表里的 `model` 字段，不碰目录与工作区。
*
* - `model: null` 表示清除配置、跟随宿主默认模型；
* - provider / model 必须是非空字符串，超长或类型不对抛 `code = 'invalid-model'`；
* - 标识符不在登记表里抛 `code = 'unknown-worker'`；
* - 机器人只读，抛 `code = 'robot-worker'`；
* - 登记文件损坏抛 `code = 'registry-unreadable'`。
*/
async function setWorkerModel({ file, id, model } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isResolvableWorkerId(id)) throw invalidIdError(id);
	const next = model === null || model === void 0 ? void 0 : normalizeWorkerModel(model);
	if (model !== null && model !== void 0 && next === void 0) throw invalidModelError(model);
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const workerId = id.trim();
	const current = findWorker(registry, workerId);
	if (current === void 0) throw unknownWorkerError(workerId);
	if (current.driver !== "agent") throw robotWorkerError(workerId);
	const worker = { ...current };
	if (next === void 0) delete worker.model;
	else worker.model = next;
	await writeWorkerRegistry({
		file: registryFile,
		workers: registry.workers.map((entry) => entry.id === workerId ? worker : entry)
	});
	return { worker };
}
/**
* 改一个智能体新会话的默认执行者预设：只动登记表里的 `agentPreset` 字段。
*
* - `agentPreset: null` 表示清除配置、跟随工作流插件的 `workerPreset`；
* - 非空字符串原样保存；空串 / 类型不对抛 `code = 'invalid-agent-preset'`；
*   预设是否存在由路由用 `agentPresets` 服务校验（服务缺失时只校验形状）；
* - 标识符不在登记表里抛 `code = 'unknown-worker'`；
* - 机器人只读，抛 `code = 'robot-worker'`；
* - 登记文件损坏抛 `code = 'registry-unreadable'`。
*/
async function setWorkerPreset({ file, id, agentPreset } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isResolvableWorkerId(id)) throw invalidIdError(id);
	const next = agentPreset === null || agentPreset === void 0 ? void 0 : normalizeAgentPreset(agentPreset);
	if (agentPreset !== null && agentPreset !== void 0 && next === void 0) throw invalidAgentPresetError(agentPreset);
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const workerId = id.trim();
	const current = findWorker(registry, workerId);
	if (current === void 0) throw unknownWorkerError(workerId);
	if (current.driver !== "agent") throw robotWorkerError(workerId);
	const worker = { ...current };
	if (next === void 0) delete worker.agentPreset;
	else worker.agentPreset = next;
	await writeWorkerRegistry({
		file: registryFile,
		workers: registry.workers.map((entry) => entry.id === workerId ? worker : entry)
	});
	return { worker };
}
/**
* 改一个智能体的描述：只动登记表里的 `description` 字段，不碰目录与工作区。
*
* 描述是给工作流选择执行者看的一行摘要（类似 skill 的 description），存储前
* 会折叠空白；空串表示清空。超过上限抛 `code = 'invalid-description'`。
* 机器人只读，抛 `code = 'robot-worker'`。
*
*/
async function setWorkerDescription({ file, id, description } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isResolvableWorkerId(id)) throw invalidIdError(id);
	if (typeof description !== "string") throw invalidDescriptionError(description);
	const clean = normalizeWorkerDescription(description);
	if (clean.length > 500) throw invalidDescriptionError(description);
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const workerId = id.trim();
	const current = findWorker(registry, workerId);
	if (current === void 0) throw unknownWorkerError(workerId);
	if (current.driver !== "agent") throw robotWorkerError(workerId);
	const worker = {
		...current,
		description: clean
	};
	await writeWorkerRegistry({
		file: registryFile,
		workers: registry.workers.map((entry) => entry.id === workerId ? worker : entry)
	});
	return { worker };
}
// .build/workflows/workers/store/delete.js
/**
* 删除执行者：登记条目、执行者目录与工作区注册行一起清掉（硬删，不归档）。
*
* 事务顺序（见 ADR 0021）：
*
* 1. 校验目录在执行者根目录下；
* 2. 把目录原子改名为同级回收名；
* 3. 删工作区注册行；
* 4. 删登记条目；
* 5. 尽力删除回收目录。
*
* 第 2～4 步任一步失败都把目录改回原名、登记条目保持原样；工作区注册行已经
* 删掉时用 `create` 尽力恢复。内建 clock 与 `driver: robot` 的条目不可删。
*
* 唯一阻塞条件（引用该标识符的运行中作业）由路由通过 `bukaWorkflows` 服务
* 检查，本模块只处理磁盘与登记表。
*
* @module @buka/dsh-plugin-workflows/workers/store/delete
*/
/** 目录不在执行者根目录下：拒绝删除，避免误删任意路径。 */
function deleteOutsideRootError(target) {
	const error = /* @__PURE__ */ new Error(`执行者目录不在执行者根目录下，拒绝删除：${target}`);
	return Object.assign(error, { code: "outside-root" });
}
/** 工作区注册服务不可用：无法安全摘掉注册行。 */
function workspaceUnavailableError() {
	return Object.assign(/* @__PURE__ */ new Error("工作区注册服务不可用，无法确认或摘掉执行者的工作区注册，拒绝删除；请刷新后重试。"), { code: "workspace-unavailable" });
}
/** 判断 `child` 是否在 `root` 目录下（不含 root 本身）。 */
function isInside(root, child) {
	const relative = path.relative(root, child);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
	return true;
}
/**
* 按规范路径在已注册工作区里找执行者目录。
*
* 工作区路径用 `path.resolve` 与 `fs.realpath` 两种形式比较，缓存目录本身是
* 符号链接时也能对齐；注册表不可用时抛 `workspace-unavailable`。
*
*/
async function findWorkerWorkspace(workspaceRegistry, workerPath) {
	if (workspaceRegistry === void 0 || workspaceRegistry === null) throw workspaceUnavailableError();
	let entries;
	try {
		const listed = workspaceRegistry.list();
		entries = Array.isArray(listed) ? listed : [];
	} catch {
		throw workspaceUnavailableError();
	}
	const resolved = path.resolve(workerPath);
	const real = await realpathOrNull(workerPath);
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") continue;
		if (typeof entry.path !== "string" || entry.path.trim() === "") continue;
		const candidate = path.resolve(entry.path);
		if (candidate === resolved || real !== null && candidate === real) return {
			id: entry.id,
			path: candidate
		};
		const candidateReal = await realpathOrNull(entry.path);
		if (real !== null && candidateReal === real) return {
			id: entry.id,
			path: candidate
		};
	}
	return null;
}
/**
* 硬删一个执行者：目录、登记条目与工作区注册行一起删除。
*
* - 标识符不合法抛 `code = 'invalid-id'`；不在登记表里抛 `code = 'unknown-worker'`；
* - 内建 clock 抛 `code = 'builtin-worker'`，其它机器人抛 `code = 'robot-worker'`；
* - 目录不在执行者根目录下抛 `code = 'outside-root'`；
* - 工作区注册服务不可用抛 `code = 'workspace-unavailable'`；
* - 目录不存在时只删登记与注册行，不报错。
*
*/
async function deleteWorker({ workersDir, file, id, workspaceRegistry } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isResolvableWorkerId(id)) throw invalidIdError(id);
	const workerId = id.trim();
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const worker = registry.workers.find((entry) => entry.id === workerId);
	if (worker === void 0) throw unknownWorkerError(workerId);
	if (isBuiltinWorkerId(workerId)) throw builtinWorkerError(workerId);
	if (worker.driver !== "agent") throw robotWorkerError(workerId);
	const root = typeof workersDir === "string" && workersDir.trim() !== "" ? path.resolve(workersDir) : null;
	if (root === null) throw invalidIdError(workerId);
	const expected = workerDirectory(root, workerId);
	if (expected === null) throw invalidIdError(workerId);
	const rootCanonical = await realpathOr(root, root);
	const expectedCanonical = await realpathOr(expected, expected);
	const sourcePath = await realpathOr(worker.path, path.resolve(worker.path));
	if (!isInside(rootCanonical, expectedCanonical) || !isInside(rootCanonical, sourcePath)) throw deleteOutsideRootError(worker.path);
	const workspace = await findWorkerWorkspace(workspaceRegistry, worker.path);
	let recycledPath = null;
	if (await isDirectory(sourcePath)) {
		recycledPath = `${sourcePath}.deleted-${Date.now()}-${randomUUID().slice(0, 8)}`;
		await promises.rename(sourcePath, recycledPath);
	}
	const rollbackDirectory = async () => {
		if (recycledPath === null) return;
		try {
			await promises.rename(recycledPath, sourcePath);
		} catch {}
	};
	if (workspace !== null) {
		if (typeof workspaceRegistry?.delete !== "function") {
			await rollbackDirectory();
			throw workspaceUnavailableError();
		}
		try {
			await workspaceRegistry.delete(workspace.id);
		} catch (error) {
			await rollbackDirectory();
			throw error;
		}
	}
	try {
		await writeWorkerRegistry({
			file: registryFile,
			workers: registry.workers.filter((entry) => entry.id !== workerId)
		});
	} catch (error) {
		await rollbackDirectory();
		if (workspace !== null && typeof workspaceRegistry?.create === "function") try {
			await workspaceRegistry.create(worker.path, worker.name === "" ? workerId : worker.name);
		} catch {}
		throw error;
	}
	if (recycledPath !== null) try {
		await promises.rm(recycledPath, {
			recursive: true,
			force: true
		});
	} catch {}
	return {
		worker,
		path: worker.path,
		workspaceId: workspace === null ? null : String(workspace.id),
		directoryRemoved: recycledPath !== null
	};
}
// .build/workflows/workers/store/project-skills.js
/**
* 扫描工作区里的项目级 skills。
*
* 三个根目录：`<path>/.agents/skills`、`<path>/.claude/skills`、
* `<path>/.dsh/skills`（`<name>/SKILL.md` 或平铺的 `<name>.md`）；`source`
* 从项目级 `skills-lock.json` 里补。单个条目读不了时跳过，整次扫描不抛错。
*
* @module @buka/dsh-plugin-workflows/workers/store/project-skills
*/
/**
* 项目级 skills 的三个根目录（相对工作区），按扫描优先级排列。
* `.agents/skills` 是 `npx skills` 的默认落点，`.claude/skills` 是 Claude Code
* 的约定；同一个 skill 同时落两处时按名字去重，只展示一条。
*/
const PROJECT_SKILL_ROOTS = [
	path.join(".agents", "skills"),
	path.join(".claude", "skills"),
	path.join(".dsh", "skills")
];
/** `npx skills add` 在项目里写下的 lockfile 名。 */
const PROJECT_LOCK_FILE = "skills-lock.json";
/**
* 极简 YAML frontmatter 解析：只取顶层的 `name` 与 `description`。
*
* 支持单行标量与单/双引号标量；没有 frontmatter、frontmatter 未闭合或
* 两个字段都不存在时返回空对象。解析失败不抛错——skill 仍然要被列出来，
* 只是元数据回退到目录名与空描述。
*
*/
function parseFrontmatter(text) {
	if (typeof text !== "string") return {};
	const lines = text.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n").split("\n");
	if (lines[0]?.trim() !== "---") return {};
	let end = -1;
	for (let index = 1; index < lines.length; index += 1) if (lines[index]?.trim() === "---") {
		end = index;
		break;
	}
	if (end < 0) return {};
	const result = {};
	for (const line of lines.slice(1, end)) {
		const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
		if (match === null) continue;
		const key = match[1];
		if (key !== "name" && key !== "description") continue;
		if (result[key] !== void 0) continue;
		result[key] = stripQuotes(match[2]?.trim() ?? "");
	}
	return result;
}
/**
* 去掉 YAML 标量两侧的引号；普通标量原样返回。
*
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
/**
* 扫描一个工作区的项目级 skills。
*
* 两个根目录里的条目都算：带 `SKILL.md` 的子目录，以及根下平铺的 `<name>.md`。
* 名字优先取 frontmatter，缺省回退目录名/文件名；`source` 从
* `<path>/skills-lock.json` 的 `skills.<name>` 里取 `source`（缺省回退
* `sourceUrl`），取不到就是 null。单个条目读不了（坏链接、权限、ENOTDIR）
* 时跳过，整次扫描不抛错。
*
*/
async function scanProjectSkills(workspacePath) {
	if (typeof workspacePath !== "string" || workspacePath.trim() === "") return { skills: [] };
	const base = path.resolve(workspacePath);
	const lock = await readProjectLock(base);
	const byName = /* @__PURE__ */ new Map();
	for (const relativeRoot of PROJECT_SKILL_ROOTS) {
		const skillsDir = path.join(base, relativeRoot);
		for (const dirent of await readDirents(skillsDir)) {
			if (dirent.name.startsWith(".")) continue;
			const full = path.join(skillsDir, dirent.name);
			let stat;
			try {
				stat = await promises.stat(full);
			} catch {
				continue;
			}
			let file;
			let kind;
			let fallbackName;
			if (stat.isDirectory()) {
				file = path.join(full, "SKILL.md");
				kind = "directory";
				fallbackName = dirent.name;
			} else if (stat.isFile() && dirent.name.endsWith(".md")) {
				file = full;
				kind = "file";
				fallbackName = dirent.name.slice(0, -3);
			} else continue;
			let text;
			try {
				text = await promises.readFile(file, "utf8");
			} catch {
				continue;
			}
			const front = parseFrontmatter(text);
			const name = typeof front.name === "string" && front.name !== "" ? front.name : fallbackName;
			const entry = {
				name,
				description: typeof front.description === "string" ? front.description : "",
				source: lockSource(lock, name, fallbackName),
				kind
			};
			const existing = byName.get(name);
			if (existing === void 0 || existing.kind === "file" && entry.kind === "directory") byName.set(name, entry);
		}
	}
	return { skills: [...byName.values()].map(({ name, description, source }) => ({
		name,
		description,
		source
	})).sort((left, right) => left.name.localeCompare(right.name)) };
}
/**
* 读项目级 `skills-lock.json` 的 `skills` 表；文件缺失、非法 JSON 或结构
* 不对时按空表处理（只是所有 skill 都显示为没有来源）。
*
*/
async function readProjectLock(workspacePath) {
	let text;
	try {
		text = await promises.readFile(path.join(workspacePath, PROJECT_LOCK_FILE), "utf8");
	} catch {
		return {};
	}
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object") return {};
		const skills = parsed.skills;
		if (skills === null || typeof skills !== "object" || Array.isArray(skills)) return {};
		return skills;
	} catch {
		return {};
	}
}
/**
* 从 lockfile 的 `skills` 表里取一个条目的来源。
*
* 依次尝试 skill 的展示名与安装目录名（frontmatter 里的名字可能和目录不同），
* 条目里优先 `source`、其次 `sourceUrl`；都没有就返回 null。
*
*/
function lockSource(lock, ...names) {
	for (const name of names) {
		const record = lock[name];
		if (record === null || typeof record !== "object") continue;
		if ("source" in record && typeof record.source === "string" && record.source.trim() !== "") return record.source.trim();
		if ("sourceUrl" in record && typeof record.sourceUrl === "string" && record.sourceUrl.trim() !== "") return record.sourceUrl.trim();
	}
	return null;
}
/**
* 读目录项；目录不存在或不是目录时当作空目录。
*
*/
async function readDirents(dir) {
	try {
		return await promises.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}
// .build/workflows/workers/store/list.js
/**
* 执行者列表：登记表 + 目录 / 挂载状态 + 项目级 skills 与 AGENTS.md。
*
* 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
* realpath 规范值），执行者路径用 `fs.realpath`（失败回退 `path.resolve`）。
*
* 机器人没有目录：不扫描 skills / AGENTS.md，`exists` 为 false，
* 页面按 `driver` 只读展示。内建机器人在视图里补上，即使登记表还没
* 落盘也能看到。目录、头像与引用一律按不可变标识符 `id` 解析。
*
* @module @buka/dsh-plugin-workflows/workers/store/list
*/
/** 没有目录的执行者（机器人）的 CLAUDE.md 摘要。 */
function emptyClaude() {
	return {
		exists: false,
		symlink: false,
		mode: "missing",
		target: ""
	};
}
/**
* 汇总登记表里的执行者：目录是否存在、是否已挂到 DSH 工作区，以及每个
* 智能体自己的项目级 skills 与 AGENTS.md。
*
* 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
* realpath 规范值），执行者路径用 `fs.realpath`（失败回退 `path.resolve`）。
* 登记文件损坏时返回 `corrupt: true` 与空列表。
*
*/
async function listWorkers({ file, workspaceRegistry, workersDir } = {}) {
	const registryFile = requireRegistryFile(file);
	const root = typeof workersDir === "string" && workersDir.trim() !== "" ? path.resolve(workersDir) : path.join(path.dirname(registryFile), "workers");
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) return {
		root,
		registry: registryFile,
		corrupt: true,
		workers: []
	};
	const workspaceByPath = await indexWorkspaces(workspaceRegistry);
	const workers = [];
	for (const entry of withBuiltinWorkers(registry.workers)) {
		if (entry.driver === "robot") {
			workers.push(programEntry(entry));
			continue;
		}
		workers.push(await agentEntry(entry, workspaceByPath));
	}
	return {
		root,
		registry: registryFile,
		corrupt: false,
		workers
	};
}
/** 机器人：没有目录、skills 与 AGENTS.md。 */
function programEntry(entry) {
	return {
		...entry,
		builtin: isBuiltinWorkerId(entry.id),
		avatar: resolveAvatar(entry.avatar, entry.id),
		exists: false,
		mounted: false,
		workspaceId: null,
		skills: [],
		agents: emptyAgentsFile(),
		claude: emptyClaude()
	};
}
/** 智能体：目录 / 挂载 / skills / AGENTS.md 汇总。 */
async function agentEntry(entry, workspaceByPath) {
	const canonical = await realpathOr(entry.path, path.resolve(entry.path));
	const workspace = workspaceByPath.get(canonical) ?? workspaceByPath.get(path.resolve(entry.path));
	const exists = await isDirectory(canonical);
	if (exists) await ensureWorkerGitRepo(canonical);
	let skills = [];
	try {
		skills = (await scanProjectSkills(canonical)).skills;
	} catch {
		skills = [];
	}
	let agents = emptyAgentsFile();
	try {
		agents = await readAgentsFile(canonical);
	} catch {
		agents = emptyAgentsFile();
	}
	let claude = emptyClaude();
	try {
		claude = exists && agents.exists ? await ensureClaudeLink(canonical) : await readClaudeLink(canonical);
	} catch {
		claude = emptyClaude();
	}
	return {
		...entry,
		avatar: resolveAvatar(entry.avatar, entry.id),
		exists,
		mounted: workspace !== void 0,
		workspaceId: workspace === void 0 ? null : String(workspace.id),
		skills,
		agents,
		claude
	};
}
/**
* 建「规范路径 → 工作区」索引。工作区路径同时按 `path.resolve` 与
* `fs.realpath` 登记（后者成功时才登记），执行者侧用 realpath 对齐，
* 这样缓存目录本身是符号链接时也能正确判断挂载。
*
*/
async function indexWorkspaces(workspaceRegistry) {
	const index = /* @__PURE__ */ new Map();
	let workspaces = [];
	try {
		const snapshot = workspaceRegistry?.list?.();
		workspaces = Array.isArray(snapshot) ? snapshot : [];
	} catch {
		workspaces = [];
	}
	for (const workspace of workspaces) {
		if (workspace === null || typeof workspace !== "object") continue;
		if (typeof workspace.path !== "string" || workspace.path.trim() === "") continue;
		const resolved = path.resolve(workspace.path);
		if (!index.has(resolved)) index.set(resolved, workspace);
		const real = await realpathOrNull(workspace.path);
		if (real !== null && !index.has(real)) index.set(real, workspace);
	}
	return index;
}
// .build/workflows/workers/store/migrate.js
/**
* 旧执行者数据的自动迁移：目录、登记文件名与登记格式。
*
* 插件从 `@buka/dsh-plugin-robots` 改名为 `@buka/dsh-plugin-workers`，术语也
* 从「机器人 / agent 型 / program 型」改成「执行者 / 智能体 / 机器人」。为了
* 不让已有执行者丢在旧缓存目录里，启动时做三件事（都幂等）：
*
* 1. 默认布局下，把 `~/.cache/dsh-plugin-robots` 整个搬到
*    `~/.cache/dsh-plugin-workers`；目标已存在时不覆盖；
* 2. 目录里旧的 `robots/` 与 `robots.json` 改成 `workers/` 与 `workers.json`；
* 3. 登记表是 version 1 / 2 / 3 时重写成 version 4（`id` 取旧 `name`、`name`
*    置空；`driver: "program"` → `"robot"`）。
*
* 自定义 `workersDir` 时只做第 3 步：插件不知道用户的旧目录在哪，也不该猜。
*
* @module @buka/dsh-plugin-workflows/workers/store/migrate
*/
/** 返回路径本身与它的 realpath（能解析时）；用于匹配登记表里存过的规范路径。 */
async function pathVariants(target) {
	const variants = [target];
	try {
		const real = await promises.realpath(target);
		if (real !== target) variants.push(real);
	} catch {}
	return variants;
}
/** 判断路径是否存在。 */
async function exists(target) {
	try {
		await promises.access(target);
		return true;
	} catch {
		return false;
	}
}
/**
* 把旧插件的缓存目录搬到新位置；目标已存在或源不存在时什么都不做。
*
* @returns 是否发生了搬运
*/
async function moveLegacyCache(env, logger) {
	const current = pluginCacheDir(env);
	const legacy = legacyPluginCacheDir(env);
	if (path.resolve(current) === path.resolve(legacy)) return false;
	if (!await exists(legacy) || await exists(current)) return false;
	try {
		await promises.rename(legacy, current);
	} catch (error) {
		const code = error instanceof Error && "code" in error ? String(error.code) : "";
		if (code !== "EXDEV" && code !== "EPERM" && code !== "EACCES") throw error;
		await promises.mkdir(path.dirname(current), { recursive: true });
		await promises.cp(legacy, current, {
			recursive: true,
			force: false,
			errorOnExist: false
		});
		await promises.rm(legacy, {
			recursive: true,
			force: true
		});
	}
	logger?.info?.("buka-workers: 已把旧插件缓存目录迁移到 %s", current);
	return true;
}
/**
* 把旧文件名改成新文件名；目标已存在时保留目标、不动源。
*/
async function renameIfMissing(from, to) {
	if (path.resolve(from) === path.resolve(to)) return false;
	if (!await exists(from) || await exists(to)) return false;
	await promises.rename(from, to);
	return true;
}
/**
* 读登记文件的原始版本号；文件不存在或读不出时返回 null。
*/
async function readStoredVersion(file) {
	try {
		const parsed = JSON.parse(await promises.readFile(file, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const version = parsed.version;
		return typeof version === "number" ? version : null;
	} catch {
		return null;
	}
}
/**
* 把旧格式登记表重写成当前版本，并把落在旧根目录里的 `path` 平移到新根目录。
* 旧条目迁移后的 `id` 就是它原来的 `name`，所以路径平移按同一段相对路径计算；
* 已经是最新且路径无需平移、或文件损坏时什么都不做（损坏的文件绝不能被覆盖）。
*/
async function upgradeRegistry(registryFile, legacyRoots, workersDir, logger) {
	const stored = await readStoredVersion(registryFile);
	if (stored === null) return false;
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) {
		logger?.warn?.("buka-workers: 登记文件无法读取，跳过格式迁移：%s", registryFile);
		return false;
	}
	let changed = stored < 4;
	const workers = registry.workers.map((worker) => {
		if (worker.driver !== "agent" || worker.path === "") return worker;
		for (const legacyRoot of legacyRoots) {
			if (path.resolve(legacyRoot) === path.resolve(workersDir)) continue;
			const relative = path.relative(legacyRoot, worker.path);
			if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
			changed = true;
			return {
				...worker,
				path: path.join(workersDir, relative)
			};
		}
		return worker;
	});
	if (!changed) return false;
	await writeWorkerRegistry({
		file: registryFile,
		workers
	});
	if (stored < 4) logger?.info?.("buka-workers: 登记表已从 version %s 迁移到 version %s", stored, 4);
	else logger?.info?.("buka-workers: 已把登记表里的旧目录路径平移到新根目录");
	return true;
}
/**
* 执行一次启动迁移；幂等，失败由调用方记日志。
*
* @param options 新的根目录、登记文件与环境
*/
async function migrateWorkerStore(options) {
	const env = options.env ?? process.env;
	const workersDir = path.resolve(options.workersDir);
	const registryFile = path.resolve(options.registryFile);
	const usingDefaultLayout = workersDir === path.resolve(defaultWorkersRoot(env));
	const cacheDir = path.dirname(workersDir);
	const baseName = path.basename(workersDir);
	const legacySiblingRoot = path.join(cacheDir, "robots");
	const legacySiblingRegistry = path.join(cacheDir, "robots.json");
	const legacyRoots = [.../* @__PURE__ */ new Set([...await pathVariants(path.join(legacyPluginCacheDir(env), "robots")), ...await pathVariants(legacySiblingRoot)])];
	if (usingDefaultLayout) await moveLegacyCache(env, options.logger);
	if (usingDefaultLayout || baseName === "workers") {
		const renamedRoot = await renameIfMissing(legacySiblingRoot, workersDir);
		const renamedRegistry = await renameIfMissing(legacySiblingRegistry, registryFile);
		if (renamedRoot || renamedRegistry) options.logger?.info?.("buka-workers: 已把 robots 目录 / 登记文件改名为 workers");
	} else if (baseName === "robots") await renameIfMissing(legacySiblingRegistry, registryFile);
	await upgradeRegistry(registryFile, legacyRoots, workersDir, options.logger);
}
// .build/workflows/workers/store/rename.js
/**
* 执行者改名：只改展示名，不移动目录、不重建工作区。
*
* 标识符 `id` 是不可变引用键，也是智能体目录名；因此「改名」只更新登记表里的
* `name`（可选展示名）。目录位置、工作区注册、AGENTS.md 与历史会话都保持原样，
* 引用该执行者的工作流与作业也不会断链。工作区标题由构建 / 改名流程按展示名
* 同步（见 `builder.ts`），本模块只碰登记表。
*
* @module @buka/dsh-plugin-workflows/workers/store/rename
*/
/**
* 改一个执行者的展示名；`id` 定位执行者且不可修改。
*
* - 名称规则与登记表一致：单行文本、不超过上限；空串表示清空（显示标识符）；
* - 名称没变时 `renamed: false`，不写文件；
* - 机器人只读；内建 clock 不可改；未知标识符抛 `code = 'unknown-worker'`；
* - 目录不存在不影响改展示名——这里不碰磁盘。
*
*/
async function renameWorker({ file, id, name } = {}) {
	return await setWorkerName({
		file,
		id,
		name
	});
}
// .build/workflows/workers/store/types.js
/**
* 执行者存储层的数据结构。
*
* 登记表是 version 4：每个执行者有不可变标识符 `id`（目录名与引用键）、可选
* 展示名 `name`（空串表示未设置、显示标识符）与 `driver`（agent / robot）。
* 智能体有目录、AGENTS.md 与项目 skills；机器人是固定程序，没有目录，只登记
* `program` id（稳定契约，v1 只有 `clock`）。助理不是执行者身上的标记，而是
* 工作流上的点名（见 workflows 的 ADR 0022）。
*
* @module @buka/dsh-plugin-workflows/workers/store/types
*/
/**
* 执行者的展示名：`name` 非空时用它，否则回退到标识符。
*
*/
function workerDisplayName(worker) {
	const name = typeof worker.name === "string" ? worker.name.trim() : "";
	if (name !== "") return name;
	return typeof worker.id === "string" ? worker.id : "";
}
// .build/workflows/workers/model-apply.js
/**
* 给执行者目录里新建的会话套用登记的模型。
*
* 页面「新会话」走 DSH 的工作区流程，不会经过 workers 的会话服务；用户在侧边栏
* 直接打开执行者工作区时也不会。因此 Host 监听 `agent/created`：如果会话的 cwd 是
* 某个已登记智能体的目录、且会话还没有自己的模型（没有 `model/selection` /
* `request/header` 事件），就把登记的模型选进这条会话。
*
* 只调用 live agent 的 `model.select()`，不动宿主默认模型；用户之后在会话里用
* `/model` 切换，或恢复一条已有选择的会话，都不会被覆盖。
*
* @module @buka/dsh-plugin-workflows/workers/model-apply
*/
/** 判断两个路径是否指向同一个目录（容忍 symlink / realpath 差异）。 */
async function sameDirectory(left, right) {
	if (path.resolve(left) === path.resolve(right)) return true;
	try {
		return await promises.realpath(left) === await promises.realpath(right);
	} catch {
		return false;
	}
}
/**
* 读 live agent 当前的模型路由；读不出来时返回 null。
*/
function currentSelection(agent) {
	try {
		const value = agent.model?.current?.();
		if (value === null || typeof value !== "object") return null;
		const provider = typeof value.provider === "string" ? value.provider.trim() : "";
		const model = typeof value.model === "string" ? value.model.trim() : "";
		if (provider === "" || model === "") return null;
		const effort = typeof value.reasoningEffort === "string" ? value.reasoningEffort.trim() : "";
		return {
			provider,
			model,
			...effort === "" ? {} : { reasoningEffort: effort }
		};
	} catch {
		return null;
	}
}
/** 两条选择是否指向同一条模型路由（忽略推理强度）。 */
function sameRoute(left, right) {
	return left.provider === right.provider && left.model === right.model;
}
/**
* 会话是否已经选过 / 用过模型。
*
* `model/selection` 是显式选择；`request/header` 说明会话已经用某个模型发过请求。
* 两者任一存在都表示这条会话有自己的模型，不能再拿执行者登记覆盖。新建的空白
* 会话两个事件都没有——此时 `model.current()` 可能只是宿主默认值，正是要换掉的。
*/
function hasRecordedModel(agent) {
	const session = agent.session;
	let events = [];
	try {
		events = session?.snapshotEvents?.(0) ?? session?.ownEvents?.() ?? [];
	} catch {
		return true;
	}
	return events.some((event) => event !== null && typeof event === "object" && ["model/selection", "request/header"].includes(String(event.type ?? "")));
}
/** 给新建的 agent 套用执行者目录对应的模型。 */
async function applyWorkerModel(ctx, registryFile, payload) {
	const agent = payload?.agent;
	if (agent?.model?.select === void 0) return;
	const header = agent.session?.header;
	if (header?.origin === "subagent") return;
	const cwd = header?.cwd;
	if (typeof cwd !== "string" || cwd.trim() === "") return;
	if (hasRecordedModel(agent)) return;
	const current = currentSelection(agent);
	if (current !== null) {
		const hostDefault = readDefaultSelection(optionalService(ctx, "agentDefaultModel"));
		if (hostDefault === null || !sameRoute(current, hostDefault)) return;
	}
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) return;
	let target;
	for (const worker of registry.workers) {
		if (worker.driver !== "agent" || worker.model === void 0) continue;
		if (await sameDirectory(worker.path, cwd)) {
			target = worker;
			break;
		}
	}
	if (target?.model === void 0) return;
	agent.model.select({
		provider: target.model.provider,
		model: target.model.model,
		...target.model.reasoningEffort === void 0 ? {} : { reasoningEffort: target.model.reasoningEffort }
	});
	ctx.logger?.info?.("buka-workers: 已为执行者 %s 的新会话选择模型 %s/%s", target.id, target.model.provider, target.model.model);
}
/**
* 注册 `agent/created` 监听；插件卸载时随 effect 一起撤销。
*
* @param ctx 宿主上下文
* @param registryFile 执行者登记文件
*/
function registerWorkerModelEnforcement(ctx, registryFile) {
	ctx.effect(() => ctx.on("agent/created", (payload) => applyWorkerModel(ctx, registryFile, payload).then(() => void 0).catch((error) => {
		ctx.logger?.warn?.("buka-workers: 应用智能体模型失败：%s", error instanceof Error ? error.message : String(error));
	})), "buka-workers: apply worker model on agent/created");
}
/**
* 复用 web 组合的信任栅栏；被拒绝时已经写好响应。
*
*/
function rejected(webCtx, req, res) {
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
* 读取并解析 JSON 请求体。
*
* 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
* 返回 `undefined` 让调用方直接返回；`null` 是合法 JSON，原样返回。
*
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
*/
async function readBoundedBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.byteLength;
		if (size > 1048576) {
			req.resume();
			return null;
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks, size).toString("utf8");
}
/**
* 读带错误码的错误；HTTP 路由按 `code` 映射状态码。
*
*/
function errorCode(error) {
	if (error === null || typeof error !== "object") return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/**
* 把任意错误转成可以展示的文本。
*
*/
function describeError$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* 发送 JSON 响应；数据是实时事实，不缓存。
*
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
*/
function sendMethodNotAllowed(res, allow) {
	res.statusCode = 405;
	res.setHeader("allow", allow);
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify({
		ok: false,
		code: "method-not-allowed",
		message: `只支持 ${allow}`
	}));
}
// .build/workflows/workers/store/files.js
/**
* 执行者目录的只读文件浏览：目录树与单文件内容。
*
* 浏览器一半的「文件」页签只读：目录树列出执行者目录下的文件与子目录，点一个
* 文件在右侧展示内容。页面没有编辑 / 保存入口，写入仍由 builder 工具完成。
*
* 安全边界：所有路径都相对执行者目录，`path` 参数先规范化再经 realpath 校验，
* 符号链接不能把读取带到目录外；`AGENTS.md` / `CLAUDE.md` 这类目录内链接照常
* 展示。
*
* @module @buka/dsh-plugin-workflows/workers/store/files
*/
/** 目录树的最大深度（根目录算第 0 层）。 */
const MAX_TREE_DEPTH = 8;
/** 目录树最多返回的条目数（目录 + 文件），超出时 `truncated` 为 true。 */
const MAX_TREE_ENTRIES = 600;
/** 页面直接预览一个文件的上限（256 KiB）；超过只给大小提示。 */
const FILE_MAX_READ_BYTES = 262144;
/** 判定二进制时探测的开头字节数。 */
const BINARY_PROBE_BYTES = 8192;
/** 不进入的目录：既不是执行者内容，也可能非常大。 */
const SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set([".git", "node_modules"]);
/** 把相对目录与名字拼成 `/` 分隔的相对路径。 */
function joinRelative(directory, name) {
	return directory === "" ? name : `${directory}/${name}`;
}
/** 排序：目录在前、文件在后，同类按名称。 */
function compareNodes(left, right) {
	if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
	return left.name.localeCompare(right.name);
}
/**
* 列出执行者目录的树。读不到的目录直接跳过，不让一个坏条目拖垮整棵树。
*
* @param root 执行者目录的绝对路径
* @returns 目录树与截断标记
*/
async function listWorkerFiles(root) {
	let rootReal;
	try {
		rootReal = await promises.realpath(root);
	} catch {
		return {
			nodes: [],
			truncated: false
		};
	}
	const budget = {
		remaining: MAX_TREE_ENTRIES,
		truncated: false
	};
	return {
		nodes: await walk(rootReal, "", 0, budget),
		truncated: budget.truncated
	};
}
/**
* 递归读取一层目录。
*
* @param rootReal 执行者目录的 realpath
* @param relativeDirectory 当前目录的相对路径（根为 `''`）
* @param depth 当前深度
* @param budget 共享的遍历预算
* @returns 排好序的节点
*/
async function walk(rootReal, relativeDirectory, depth, budget) {
	if (depth > MAX_TREE_DEPTH) {
		budget.truncated = true;
		return [];
	}
	const directory = relativeDirectory === "" ? rootReal : path.join(rootReal, ...relativeDirectory.split("/"));
	let entries;
	try {
		entries = await promises.readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	const nodes = [];
	for (const entry of entries) {
		if (budget.remaining <= 0) {
			budget.truncated = true;
			break;
		}
		if (entry.isDirectory()) {
			if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
			budget.remaining -= 1;
			const relativePath = joinRelative(relativeDirectory, entry.name);
			nodes.push({
				name: entry.name,
				path: relativePath,
				kind: "directory",
				children: await walk(rootReal, relativePath, depth + 1, budget)
			});
			continue;
		}
		if (entry.isSymbolicLink()) {
			const target = await insideRoot(rootReal, path.join(directory, entry.name));
			if (target === null) continue;
			try {
				const stat = await promises.stat(target);
				if (!stat.isFile()) continue;
				budget.remaining -= 1;
				nodes.push({
					name: entry.name,
					path: joinRelative(relativeDirectory, entry.name),
					kind: "file",
					bytes: stat.size
				});
			} catch {}
			continue;
		}
		if (!entry.isFile()) continue;
		let bytes;
		try {
			bytes = (await promises.stat(path.join(directory, entry.name))).size;
		} catch {
			bytes = void 0;
		}
		budget.remaining -= 1;
		nodes.push({
			name: entry.name,
			path: joinRelative(relativeDirectory, entry.name),
			kind: "file",
			...bytes === void 0 ? {} : { bytes }
		});
	}
	return nodes.sort(compareNodes);
}
/**
* 解析并校验一个相对路径：拒绝绝对路径、`..` 与空串。
*
* @param value 页面传入的相对路径
* @returns 规范化后的相对路径；不合法时返回 null
*/
function normalizeRelative(value) {
	if (typeof value !== "string") return null;
	const text = value.replace(/\\/gu, "/");
	if (text === "" || text.includes("\0")) return null;
	if (text.startsWith("/")) return null;
	const normalized = path.posix.normalize(text);
	if (normalized === "." || normalized === "" || normalized.startsWith("../")) return null;
	return normalized;
}
/**
* 目标 realpath 必须仍在执行者目录内；越界或读不到返回 null。
*
* @param rootReal 执行者目录的 realpath
* @param absolute 目标绝对路径
* @returns realpath 或 null
*/
async function insideRoot(rootReal, absolute) {
	let target;
	try {
		target = await promises.realpath(absolute);
	} catch {
		return null;
	}
	const relative = path.relative(rootReal, target);
	if (relative === "") return target;
	if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return target;
}
/** 文件开头疑似二进制：含 NUL 或不是合法 UTF-8。 */
function looksBinary(buffer) {
	if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) return true;
	return !isUtf8(buffer);
}
/**
* 读取一个文件的只读内容。
*
* @param root 执行者目录的绝对路径
* @param relative 页面给的相对路径
* @returns 内容或稳定错误
*/
async function readWorkerFile(root, relative) {
	const normalized = normalizeRelative(relative);
	if (normalized === null) return {
		ok: false,
		error: {
			code: "invalid-path",
			message: `文件路径不合法：${String(relative)}`
		}
	};
	let rootReal;
	try {
		rootReal = await promises.realpath(root);
	} catch {
		return {
			ok: false,
			error: {
				code: "file-not-found",
				message: `执行者目录不存在：${root}`
			}
		};
	}
	const absolute = path.resolve(rootReal, ...normalized.split("/"));
	const relativeCheck = path.relative(rootReal, absolute);
	if (relativeCheck === "" || relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) return {
		ok: false,
		error: {
			code: "outside-root",
			message: `文件不在执行者目录内：${normalized}`
		}
	};
	const target = await insideRoot(rootReal, absolute);
	if (target === null) {
		let exists = false;
		try {
			await promises.lstat(absolute);
			exists = true;
		} catch {
			exists = false;
		}
		return exists ? {
			ok: false,
			error: {
				code: "outside-root",
				message: `文件不在执行者目录内：${normalized}`
			}
		} : {
			ok: false,
			error: {
				code: "file-not-found",
				message: `文件不存在：${normalized}`
			}
		};
	}
	let stat;
	try {
		stat = await promises.stat(target);
	} catch {
		return {
			ok: false,
			error: {
				code: "file-not-found",
				message: `文件不存在：${normalized}`
			}
		};
	}
	if (!stat.isFile()) return {
		ok: false,
		error: {
			code: "not-a-file",
			message: `不是文件：${normalized}`
		}
	};
	if (stat.size > 262144) return {
		ok: true,
		file: {
			path: normalized,
			bytes: stat.size,
			content: "",
			tooLarge: true,
			binary: false
		}
	};
	let buffer;
	try {
		buffer = await promises.readFile(target);
	} catch {
		return {
			ok: false,
			error: {
				code: "file-not-found",
				message: `文件不存在：${normalized}`
			}
		};
	}
	if (buffer.byteLength > 262144) return {
		ok: true,
		file: {
			path: normalized,
			bytes: buffer.byteLength,
			content: "",
			tooLarge: true,
			binary: false
		}
	};
	if (looksBinary(buffer)) return {
		ok: true,
		file: {
			path: normalized,
			bytes: buffer.byteLength,
			content: "",
			tooLarge: false,
			binary: true
		}
	};
	return {
		ok: true,
		file: {
			path: normalized,
			bytes: buffer.byteLength,
			content: buffer.toString("utf8"),
			tooLarge: false,
			binary: false
		}
	};
}
// .build/workflows/workers/routes/target.js
/**
* 按标识符解析执行者并确认目录仍在。
*
* 执行者路由与 skills 路由共用的前置步骤：登记表损坏、标识符不合法、条目不存在
* 与目录缺失各自映射成稳定的错误码，由调用方按 HTTP 状态码回给页面。标识符
* 接受新格式与迁移来的旧格式（`isResolvableWorkerId`）。
*
* @module @buka/dsh-plugin-workflows/workers/routes/target
*/
/**
* 登记文件损坏时的统一错误：写操作必须拒绝，不能覆盖用户文件。
*
*/
function registryUnreadableError(registryFile) {
	return {
		status: 409,
		code: "registry-unreadable",
		message: `执行者登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`
	};
}
/**
* 按标识符从登记表里取执行者，并确认它的目录还在。
*
*/
async function resolveWorker(registryFile, id) {
	const registry = await readWorkerRegistry({ file: registryFile });
	if (registry.corrupt) return { error: registryUnreadableError(registryFile) };
	const trimmed = typeof id === "string" ? id.trim() : "";
	if (!isResolvableWorkerId(trimmed)) return { error: {
		status: 400,
		code: "invalid-id",
		message: `执行者标识符不合法：${String(id)}`
	} };
	const worker = registry.workers.find((entry) => entry.id === trimmed);
	if (worker === void 0) return { error: {
		status: 404,
		code: "unknown-worker",
		message: `没有找到这个执行者：${trimmed}`
	} };
	if (worker.driver === "robot") return { error: {
		status: 409,
		code: "robot-worker",
		message: `机器人只读，不能执行这个操作：${trimmed}`
	} };
	let stat;
	try {
		stat = await promises.stat(worker.path);
	} catch {
		stat = void 0;
	}
	if (stat === void 0 || !stat.isDirectory()) return { error: {
		status: 409,
		code: "missing-directory",
		message: `执行者目录不存在或不是目录：${worker.path}`
	} };
	return { worker };
}
// .build/workflows/workers/routes/files.js
/**
* 「执行者」页面「文件」页签的只读路由：目录树与单文件内容。
*
* 只注册 GET；路径与执行者 id 都从查询参数读取，不接受请求体。读取范围限定在
* 执行者目录内（见 `store/files.ts` 的 realpath 校验）。
*
* @module @buka/dsh-plugin-workflows/workers/routes/files
*/
/** 页面读取执行者目录树用的路由。 */
const TREE_ROUTE = "/buka-workers/files";
/** 页面读取单个文件内容用的路由。 */
const FILE_ROUTE = "/buka-workers/file";
/** 从请求地址读取查询参数。 */
function query(req) {
	return new URL(req.url ?? "/", "http://localhost").searchParams;
}
/** 把 resolveWorker 的错误写成响应。 */
function sendWorkerError(res, error) {
	sendError(res, error.status, error.code, error.message);
}
/** 读取错误的错误码 → HTTP 状态码。 */
function statusForFileError(code) {
	switch (code) {
		case "file-not-found": return 404;
		default: return 400;
	}
}
/**
* 注册「文件」页签用到的两个只读路由。
*
* @param webCtx web 上下文
* @param deps 登记表路径等依赖
*/
function registerFileRoutes(webCtx, deps) {
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: TREE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			const id = query(req).get("id") ?? "";
			try {
				const resolved = await resolveWorker(deps.registryFile, id);
				if (resolved.error !== void 0) {
					sendWorkerError(res, resolved.error);
					return;
				}
				const tree = await listWorkerFiles(resolved.worker.path);
				sendJson(res, 200, {
					ok: true,
					root: resolved.worker.path,
					nodes: tree.nodes,
					truncated: tree.truncated
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取执行者目录失败：%s", describeError$1(error));
				sendError(res, 500, "files-failed", `读取执行者目录失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: GET ${TREE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: FILE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			const params = query(req);
			const id = params.get("id") ?? "";
			const relative = params.get("path") ?? "";
			try {
				const resolved = await resolveWorker(deps.registryFile, id);
				if (resolved.error !== void 0) {
					sendWorkerError(res, resolved.error);
					return;
				}
				const result = await readWorkerFile(resolved.worker.path, relative);
				if (!result.ok) {
					const { code, message } = result.error;
					sendError(res, statusForFileError(code), code, message);
					return;
				}
				sendJson(res, 200, {
					ok: true,
					...result.file,
					maxBytes: FILE_MAX_READ_BYTES
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取执行者文件失败：%s", describeError$1(error));
				sendError(res, 500, "file-failed", `读取执行者文件失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: GET ${FILE_ROUTE}`);
}
// .build/workflows/workers/serial-runner.js
/**
* 串行执行器的选择：优先借用 Skills 服务的共用队列。
*
* available / install / remove 与 Skills 的检查 / 更新都会整份重写
* `skills-lock.json`。Skills 插件在的时候必须共用它的队列；没装时退回本插件
* 自己的串行队列，至少保证本页面内的写入不并发。
*
* @module @buka/dsh-plugin-workflows/workers/serial-runner
*/
/**
* 取一个串行执行器：优先用服务提供的共用队列，没有时用本地队列。
*
* @param service Skills 服务；插件没装时是 null / undefined
* @param fallback 本插件自己的串行队列
*/
function preferSharedQueue(service, fallback) {
	if (service === null || service === void 0) return fallback;
	const shared = service.runSerialized;
	if (typeof shared !== "function") return fallback;
	return shared.bind(service);
}
// .build/workflows/workers/skill-update-batch.js
/**
* 「更新全部执行者」的批量编排。
*
* 页面只调一次接口；真正的顺序执行、过滤与汇总放在这里，便于单独测试：
*
* - 只对智能体（`driver === 'agent'`）、目录存在且确实装了 skill 的 worker
*   执行；机器人没有目录，空 skills 的 worker 没有可更新项，都跳过；
* - 按登记表顺序逐个执行，单个失败不中断后面的；
* - 最后汇总每个 worker 的结果、更新成功数与失败 skill 数。
*
* @module @buka/dsh-plugin-workflows/workers/skill-update-batch
*/
/**
* 顺序更新一批执行者。
*
* @param workers 登记表里的全部 worker（含机器人）
* @param update Skills 服务的 `updateSkills({ dir })`
*/
async function updateWorkersSequentially({ workers, update }) {
	const targets = workers.filter((worker) => worker.driver === "agent" && worker.exists !== false && Array.isArray(worker.skills) && worker.skills.length > 0);
	const results = [];
	for (const worker of targets) try {
		const result = await update({ dir: worker.path });
		const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
		const ok = result?.ok !== false && failed === 0;
		results.push({
			id: worker.id,
			name: worker.name === "" ? worker.id : worker.name,
			ok,
			message: typeof result?.message === "string" && result.message !== "" ? result.message : ok ? "已是最新。" : "更新失败。",
			updated: Array.isArray(result?.updated) ? result.updated.length : 0,
			failed,
			skipped: Array.isArray(result?.skipped) ? result.skipped.length : 0
		});
	} catch (error) {
		results.push({
			id: worker.id,
			name: worker.name === "" ? worker.id : worker.name,
			ok: false,
			message: error instanceof Error ? error.message : String(error),
			updated: 0,
			failed: 1,
			skipped: 0
		});
	}
	return {
		results,
		updated: results.reduce((total, one) => total + one.updated, 0),
		failed: results.reduce((total, one) => total + (one.ok ? 0 : Math.max(one.failed, 1)), 0),
		skippedWorkers: workers.length - targets.length
	};
}
// .build/workflows/workers/skill-update-report.js
/**
* 把 Skills 服务的更新结果翻译成路由响应。
*
* `updateSkills()` 有两种失败：整体失败（`ok:false`，带错误码与 message）与
* 逐项失败（`ok:true`，`failed` 数组里是失败的 skill）。前者要让请求方看到
* 错误状态，后者是请求成功、只是部分 skill 没更新成功，所以回 200，但用
* `ok:false` 明确结果。
*
* @module @buka/dsh-plugin-workflows/workers/skill-update-report
*/
/**
* 更新服务的失败码 → HTTP 状态码，与 Skills 插件的 `updateStatusFor` 一致。
*
* @param code 服务返回的错误码
*/
function skillUpdateErrorStatus(code) {
	if (code === "invalid-dir" || code === "invalid-source") return 400;
	if (code === "lock-unreadable") return 409;
	if (code === "unsupported-home") return 500;
	return 502;
}
/** 读一个字符串字段；不是非空字符串时返回 undefined。 */
function text(record, key) {
	const value = record[key];
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* 读一次 `updateSkills()` 的结果。
*
* @param result Skills 服务返回的更新结果
* @returns 状态码、整体是否成功与失败 skill 数
*/
function reportSkillUpdate(result) {
	const record = result !== null && typeof result === "object" ? result : {};
	if (record.ok === false) {
		const code = text(record, "code");
		const message = text(record, "message") ?? "更新 skill 失败。";
		const output = typeof record.output === "string" ? record.output : void 0;
		return {
			status: skillUpdateErrorStatus(code),
			ok: false,
			failure: {
				...code === void 0 ? {} : { code },
				message,
				...output === void 0 ? {} : { output }
			},
			failed: 0
		};
	}
	const failed = Array.isArray(record.failed) ? record.failed.length : 0;
	return {
		status: 200,
		ok: failed === 0,
		failure: null,
		failed
	};
}
// .build/workflows/workers/routes/skills.js
/**
* 「执行者」页面的项目级 skills 路由。
*
* 页面只从 Skills 插件的「技能仓库」里选来源：先读收藏列表，再把某个收藏仓库
* 的 skill 清单列出来。安装与移除仍在执行者目录里用 `npx skills` 执行，安装时
* 同时落 `.agents/skills` 与 `.claude/skills`；命令输出只用于给人看，失败时把
* 输出原样带回页面。浏览器不能再提交任意第三方来源：来源必须已收藏。
*
* @module @buka/dsh-plugin-workflows/workers/routes/skills
*/
/** 页面列出「技能仓库」收藏来源用的路由。 */
const SKILL_REPOS_ROUTE = "/buka-workers/skills/repos";
/** 页面列出一个收藏仓库里可安装的 skills 用的路由。 */
const AVAILABLE_ROUTE = "/buka-workers/skills/available";
/** 页面安装项目级 skill 用的路由。 */
const INSTALL_ROUTE = "/buka-workers/skills/install";
/** 页面移除项目级 skill 用的路由。 */
const SKILL_REMOVE_ROUTE = "/buka-workers/skills/remove";
/** 单个执行者的 skill 更新入口（可选 `skills` 只更新其中几项）。 */
const SKILL_UPDATE_ROUTE = "/buka-workers/skills/update";
/** 单个执行者的 skill 检查入口：页面进入「技能」页签时自动调用。 */
const SKILL_CHECK_ROUTE = "/buka-workers/skills/check";
/** 列表页「更新全部执行者」。 */
const SKILL_UPDATE_ALL_ROUTE = "/buka-workers/skills/update-all";
/** 项目级安装 / 移除的最长等待时间；比全局版 npx runner 默认的 120 s 更宽。 */
const NPX_TIMEOUT_MS = 18e4;
/**
* 失败信息里指代这条命令的名称：`npx skills add` / `npx skills remove`。
*
* @param args 本次调用的子命令参数
* @returns 带子命令名的命令名
*/
function npxLabel(args) {
	return `npx skills ${typeof args[0] === "string" && args[0] !== "" ? args[0] : "命令"}`;
}
/** 找不到 npx 时的失败文案：项目级安装与移除共用。 */
const NPX_MISSING_MESSAGE = "没有找到 npx。请先安装 Node.js（含 npm），再重试安装或移除 skill。";
/** 一次安装最多勾选的 skill 数，避免把命令行撑爆。 */
const MAX_SKILL_SELECTION = 100;
/** skill 名/引用的最大长度。 */
const MAX_SKILL_NAME_LENGTH = 200;
/** skill 来源的最大长度，避免把整段脚本塞进命令行。 */
const MAX_SOURCE_LENGTH = 500;
/** 控制字符（含 NUL 与 DEL）不允许出现在 skill 来源里。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
/**
* 规范化一个 skill 名/引用。
*
* skill 名允许空格与中文（`npx skills add --skill "Convex Best Practices"` 是
* 官方支持的写法），所以不能沿用目录名那套严格正则；但它是会被放进命令行的
* 参数，必须拒绝控制字符与开头的 `-`（否则会被当成选项）。
*
*/
function normalizeSkillName(value) {
	if (typeof value !== "string") return null;
	const name = value.trim();
	if (name === "" || name.length > MAX_SKILL_NAME_LENGTH) return null;
	if (name.startsWith("-") || CONTROL_CHARS.test(name)) return null;
	return name;
}
/**
* 规范化一次安装勾选的 skills：去掉空项与重复项，数量有上限。
*
*/
function normalizeSkillSelection(value) {
	if (!Array.isArray(value)) return null;
	const names = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of value) {
		const name = normalizeSkillName(entry);
		if (name === null) return null;
		if (seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	if (names.length === 0 || names.length > MAX_SKILL_SELECTION) return null;
	return names;
}
/** 从 web 上下文取可选的 `bukaSkills` 服务；插件没装时返回 null。 */
function skillsService(ctx) {
	try {
		return ctx.get?.("bukaSkills") ?? null;
	} catch {
		return null;
	}
}
/**
* 读收藏的「技能仓库」；服务插件比这个版本旧、没有 `listRepositories()` 时
* 按「没有收藏」处理，而不是把整个列表报成失败。
*
* @param service Skills 插件的 Host Service
* @returns 规范化后的收藏仓库与收藏文件状态
*/
async function readSavedRepositories(service) {
	const listed = typeof service.listRepositories === "function" ? await service.listRepositories() : null;
	const repositories = [];
	for (const repo of Array.isArray(listed?.repositories) ? listed.repositories : []) {
		if (repo === null || typeof repo !== "object") continue;
		if (typeof repo.source !== "string" || repo.source === "") continue;
		repositories.push({
			id: typeof repo.id === "string" && repo.id !== "" ? repo.id : repo.source,
			source: repo.source,
			note: typeof repo.note === "string" ? repo.note : "",
			kind: typeof repo.kind === "string" && repo.kind !== "" ? repo.kind : "unknown",
			skills: typeof repo.skills === "number" && Number.isFinite(repo.skills) ? repo.skills : null
		});
	}
	return {
		corrupt: listed?.corrupt === true,
		repositories
	};
}
/**
* 在收藏列表里按来源找一条；页面总是回传收藏条目的 `source`，所以精确匹配即可。
*
* @param saved 收藏仓库列表
* @param source 页面回传的来源
*/
function findSavedRepository(saved, source) {
	return saved.repositories.find((repo) => repo.source === source) ?? null;
}
/**
* 把一个仓库的 skill 清单规范化成页面的候选条目。
*
* @param service Skills 插件的 Host Service
* @param source 已确认收藏的来源
*/
async function listRepositorySkills(service, source) {
	if (typeof service.listSkills !== "function") return {
		ok: false,
		code: "skills-unavailable",
		message: "这个 Skills 插件版本不支持读取技能仓库。"
	};
	const listed = await service.listSkills({ source });
	if (listed?.ok !== true) return {
		ok: false,
		code: typeof listed?.code === "string" ? listed.code : "fetch-failed",
		message: typeof listed?.message === "string" && listed.message !== "" ? listed.message : "无法读取这个技能仓库的 skill 列表。"
	};
	const skills = [];
	for (const skill of Array.isArray(listed.skills) ? listed.skills : []) {
		if (skill === null || typeof skill !== "object") continue;
		if (typeof skill.name !== "string" || skill.name === "") continue;
		skills.push({
			name: skill.name,
			description: typeof skill.description === "string" ? skill.description : ""
		});
	}
	return {
		ok: true,
		skills
	};
}
/**
* 取检查 / 更新所需的服务；插件没装或版本太旧时写好 503 并返回 null。
*
* @param ctx web 上下文
* @param res 响应
* @param action 失败文案里的动作描述
* @param capability 需要的服务方法
*/
function requireSkillsService(ctx, res, action, capability) {
	const service = skillsService(ctx);
	if (service !== null && typeof service[capability] === "function") return service;
	sendError(res, 503, "skills-unavailable", `没有找到 Skills 插件（@buka/dsh-plugin-skills），无法${action} skills。`);
	return null;
}
/**
* 注册项目级 skills 相关的精确路由。
*
*/
function registerSkillRoutes(webCtx, deps) {
	const { registryFile } = deps;
	const runNpx = createNpxRunner({
		timeoutMs: NPX_TIMEOUT_MS,
		label: npxLabel,
		missingMessage: NPX_MISSING_MESSAGE,
		emptyOutputOnSetupFailure: true
	});
	let npxQueue = Promise.resolve();
	function serializeNpx(work) {
		const run = npxQueue.then(work, work);
		npxQueue = run.then(() => void 0, () => void 0);
		return run;
	}
	/** 每次请求重新取服务：插件可能晚于路由启动。 */
	function serialRunner() {
		return preferSharedQueue(skillsService(webCtx), serializeNpx);
	}
	/** 把 resolveWorker 的错误写成响应。 */
	function sendWorkerError(res, error) {
		sendError(res, error.status, error.code, error.message);
	}
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: SKILL_REPOS_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			const service = requireSkillsService(webCtx, res, "读取技能仓库里的", "listRepositories");
			if (service === null) return;
			try {
				sendJson(res, 200, {
					ok: true,
					...await readSavedRepositories(service)
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取技能仓库失败：%s", describeError$1(error));
				sendError(res, 502, "repos-failed", `读取技能仓库失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: GET ${SKILL_REPOS_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: AVAILABLE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveWorker(registryFile, body?.id);
			if (resolved.error !== void 0) {
				sendWorkerError(res, resolved.error);
				return;
			}
			const source = typeof body?.source === "string" ? body.source.trim() : "";
			if (source === "" || source.length > MAX_SOURCE_LENGTH || CONTROL_CHARS.test(source)) {
				sendError(res, 400, "invalid-source", `skill 来源不合法：需要 1–${MAX_SOURCE_LENGTH} 个字符且不含控制字符。`);
				return;
			}
			const service = requireSkillsService(webCtx, res, "读取技能仓库里的", "listSkills");
			if (service === null) return;
			try {
				const saved = await readSavedRepositories(service);
				if (saved.corrupt) {
					sendError(res, 409, "repos-unreadable", "技能仓库文件无法解析，无法确认这个来源是否已收藏。请先在 Skills 页面修复或删除收藏文件。");
					return;
				}
				const repository = findSavedRepository(saved, source);
				if (repository === null) {
					sendError(res, 400, "not-saved", `只允许安装「技能仓库」里收藏过的来源，请先在 Skills 页面收藏：${source}`);
					return;
				}
				const listed = await listRepositorySkills(service, repository.source);
				if (!listed.ok) {
					sendJson(res, 502, {
						ok: false,
						code: listed.code,
						message: listed.message
					});
					return;
				}
				if (listed.skills.length === 0) {
					sendJson(res, 502, {
						ok: false,
						code: "list-empty",
						message: "这个技能仓库里没有可安装的 skill，请换一个收藏来源或刷新 Skills 页面。"
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.worker.path);
				webCtx.logger?.info?.("buka-workers: 已读取 skill 清单（%s ← %s，%d 个）", resolved.worker.path, repository.source, listed.skills.length);
				sendJson(res, 200, {
					ok: true,
					source: repository.source,
					skills: listed.skills,
					installed: scanned.skills.map((skill) => skill.name)
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取 skill 清单失败：%s", describeError$1(error));
				sendError(res, 500, "available-failed", `读取 skill 清单失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${AVAILABLE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: INSTALL_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveWorker(registryFile, body?.id);
			if (resolved.error !== void 0) {
				sendWorkerError(res, resolved.error);
				return;
			}
			const source = typeof body?.source === "string" ? body.source.trim() : "";
			if (source === "" || source.length > MAX_SOURCE_LENGTH || CONTROL_CHARS.test(source)) {
				sendError(res, 400, "invalid-source", `skill 来源不合法：需要 1–${MAX_SOURCE_LENGTH} 个字符且不含控制字符。`);
				return;
			}
			const selected = normalizeSkillSelection(body?.skills);
			if (selected === null) {
				sendError(res, 400, "invalid-skills", `skills 必须是 1–${MAX_SKILL_SELECTION} 个合法的 skill 名。`);
				return;
			}
			const service = requireSkillsService(webCtx, res, "从技能仓库安装", "listSkills");
			if (service === null) return;
			try {
				const saved = await readSavedRepositories(service);
				if (saved.corrupt) {
					sendError(res, 409, "repos-unreadable", "技能仓库文件无法解析，无法确认这个来源是否已收藏。请先在 Skills 页面修复或删除收藏文件。");
					return;
				}
				const repository = findSavedRepository(saved, source);
				if (repository === null) {
					sendError(res, 400, "not-saved", `只允许安装「技能仓库」里收藏过的来源，请先在 Skills 页面收藏：${source}`);
					return;
				}
				const listed = await listRepositorySkills(service, repository.source);
				if (!listed.ok) {
					sendJson(res, 502, {
						ok: false,
						code: listed.code,
						message: listed.message
					});
					return;
				}
				const available = new Set(listed.skills.map((skill) => skill.name));
				const missing = selected.filter((skill) => !available.has(skill));
				if (missing.length > 0) {
					sendError(res, 400, "skill-not-found", `技能仓库里没有这些 skill：${missing.join("、")}。仓库可能已更新，请重新读取后再试。`);
					return;
				}
				const args = ["add", repository.source];
				for (const skill of selected) args.push("--skill", skill);
				args.push("-a", "universal", "-a", "claude-code", "-y");
				const result = await serialRunner()(() => runNpx(args, resolved.worker.path));
				if (!result.ok) {
					sendJson(res, 502, {
						ok: false,
						code: "npx-failed",
						message: result.message ?? "npx skills add 失败",
						output: result.output ?? ""
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.worker.path);
				const claude = await ensureClaudeLink(resolved.worker.path);
				webCtx.logger?.info?.("buka-workers: 已安装 %d 个 skill（%s ← %s）", selected.length, resolved.worker.path, repository.source);
				sendJson(res, 200, {
					ok: true,
					output: result.output ?? "",
					skills: scanned.skills,
					claude
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 安装 skill 失败：%s", describeError$1(error));
				sendError(res, 500, "install-failed", `安装 skill 失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${INSTALL_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: SKILL_REMOVE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveWorker(registryFile, body?.id);
			if (resolved.error !== void 0) {
				sendWorkerError(res, resolved.error);
				return;
			}
			const skillName = normalizeSkillName(body?.skill);
			if (skillName === null) {
				sendError(res, 400, "invalid-skill", `skill 名称不合法：${String(body?.skill)}`);
				return;
			}
			try {
				const result = await serialRunner()(() => runNpx([
					"remove",
					skillName,
					"-y"
				], resolved.worker.path));
				if (!result.ok) {
					sendJson(res, 502, {
						ok: false,
						code: "npx-failed",
						message: result.message ?? "npx skills remove 失败",
						output: result.output ?? ""
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.worker.path);
				webCtx.logger?.info?.("buka-workers: 已移除 skill（%s ← %s）", resolved.worker.path, skillName);
				sendJson(res, 200, {
					ok: true,
					output: result.output ?? "",
					skills: scanned.skills
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 移除 skill 失败：%s", describeError$1(error));
				sendError(res, 500, "remove-failed", `移除 skill 失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${SKILL_REMOVE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: SKILL_CHECK_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveWorker(registryFile, body?.id);
			if (resolved.error !== void 0) {
				sendWorkerError(res, resolved.error);
				return;
			}
			const service = requireSkillsService(webCtx, res, "检查这个执行者的", "checkSkills");
			if (service === null) return;
			try {
				const result = await service.checkSkills({ dir: resolved.worker.path });
				const report = reportSkillUpdate(result);
				if (report.failure !== null) {
					sendJson(res, report.status, {
						ok: false,
						...report.failure.code === void 0 ? {} : { code: report.failure.code },
						message: report.failure.message,
						...report.failure.output === void 0 ? {} : { output: report.failure.output }
					});
					return;
				}
				sendJson(res, 200, {
					ok: true,
					check: result
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 检查 skill 更新失败：%s", describeError$1(error));
				sendError(res, 502, "check-failed", `检查 skill 更新失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${SKILL_CHECK_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: SKILL_UPDATE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveWorker(registryFile, body?.id);
			if (resolved.error !== void 0) {
				sendWorkerError(res, resolved.error);
				return;
			}
			const only = body?.skills === void 0 ? void 0 : normalizeSkillSelection(body.skills);
			if (body?.skills !== void 0 && only === null) {
				sendError(res, 400, "invalid-skills", `skills 必须是 1–${MAX_SKILL_SELECTION} 个合法的 skill 名。`);
				return;
			}
			const service = requireSkillsService(webCtx, res, "更新这个执行者的", "updateSkills");
			if (service === null) return;
			try {
				const result = await service.updateSkills({
					dir: resolved.worker.path,
					...only === void 0 || only === null ? {} : { skills: only }
				});
				const report = reportSkillUpdate(result);
				if (report.failure !== null) {
					webCtx.logger?.warn?.("buka-workers: 更新 skill 失败（%s）：%s", resolved.worker.path, report.failure.message);
					sendJson(res, report.status, {
						ok: false,
						...report.failure.code === void 0 ? {} : { code: report.failure.code },
						message: report.failure.message,
						...report.failure.output === void 0 ? {} : { output: report.failure.output }
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.worker.path);
				webCtx.logger?.info?.("buka-workers: 已更新 skill（%s，失败 %d 个）", resolved.worker.path, report.failed);
				sendJson(res, 200, {
					ok: report.ok,
					update: result,
					skills: scanned.skills
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 更新 skill 失败：%s", describeError$1(error));
				sendError(res, 502, "update-failed", `更新 skill 失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${SKILL_UPDATE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: SKILL_UPDATE_ALL_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const service = requireSkillsService(webCtx, res, "更新执行者的", "updateSkills");
			if (service === null) return;
			try {
				const listed = await listWorkers({
					file: registryFile,
					workersDir: deps.workersDir
				});
				if (listed.corrupt) {
					sendError(res, 409, "registry-unreadable", `执行者登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`);
					return;
				}
				const updateSkills = service.updateSkills.bind(service);
				const batch = await updateWorkersSequentially({
					workers: listed.workers,
					update: (options) => updateSkills(options)
				});
				webCtx.logger?.info?.("buka-workers: 已更新全部执行者（%d 个 worker，%d 个失败）", batch.results.length, batch.failed);
				sendJson(res, 200, {
					ok: true,
					...batch
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 更新全部执行者失败：%s", describeError$1(error));
				sendError(res, 502, "update-failed", `更新全部执行者失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${SKILL_UPDATE_ALL_ROUTE}`);
}
// .build/workflows/workers/builder.js
/**
* 「执行者」preset 的写操作：创建 / 修改执行者，并把它挂到工作区。
*
* 页面上的新建流程是「建目录 + 登记 + `workspaces.create` 挂载」；这里把同一套
* 事实操作收成一个函数，供 `buka_worker_build` 工具调用（工具只对构建 preset
* 的根会话可见，见 `access.js`）。与 `worker-store.js` 的分工：
*
* - 目录、登记表、AGENTS.md 的底层读写仍由 `worker-store.js` 负责；
* - 本模块负责「一次构建」的语义：参数规范化、已存在执行者必须显式
*   `update: true` 才允许覆盖、写 AGENTS.md 后补 CLAUDE.md 链接、按规范路径
*   判断是否已挂载并只在需要时创建 DSH 工作区；
* - 改名（`update: true` 且传了 `name`）只改展示名：目录不移动、工作区注册
*   不重建，只把已挂载工作区的标题同步成新的展示名；
* - 挂载失败不让整个构建失败：执行者已经建好了，返回 `mounted: false` 与
*   `mountError`，由调用方告诉用户去页面点「挂载」。
*
* 只在 `index.js` 里被包进登记表串行队列调用；本模块自身不 import DSH 包，
* 用临时目录就能单测。
*
* @module @buka/dsh-plugin-workflows/workers/builder
*/
/** 构建请求的错误码；工具层按这些码给出可读提示。 */
const BUILD_ERROR_CODES = Object.freeze({
	invalidId: "invalid-id",
	invalidName: "invalid-name",
	invalidAvatar: "invalid-avatar",
	invalidDescription: "invalid-description",
	invalidAgents: "invalid-agents",
	invalidUpdate: "invalid-update",
	agentsTooLarge: "agents-too-large",
	registryUnreadable: "registry-unreadable",
	workerExists: "worker-exists",
	builtinWorker: "builtin-worker",
	robotWorker: "robot-worker",
	unknownWorker: "unknown-worker",
	idTaken: "id-taken"
});
/**
* 带错误码的构建错误。
*
*/
function buildError(code, message) {
	return Object.assign(new Error(message), { code });
}
/**
* 规范化一次构建请求；不合法时抛带错误码的 `Error`。
*
* - `id` 必填且不可修改：创建时必须是新标识符字符集，更新时也接受迁移来的
*   旧标识符（由 `buildWorker` 按「是否已登记」区分）；
* - `name` 是可选展示名：缺省 / null 表示「不改」（新建时为空）；给了就必须
*   是单行文本，空白会折叠；空串表示清空，展示时回退到标识符；
* - `avatar` 缺省 / 空串表示「不指定」（新建时自动分配）；给了就必须是预设 id；
* - `description` 是一行摘要，空白会折叠；缺省 / 空串表示「不改」（新建时为空）；
* - `agents` 是完整 AGENTS.md 文本，只有全空白时视为「不写」，避免误清空；
* - `update` 必须是布尔值，缺省按 `false` 处理。
*
*/
function normalizeBuildRequest(input = {}) {
	const rawId = typeof input.id === "string" ? input.id.trim() : "";
	if (rawId === "" || !isResolvableWorkerId(rawId)) throw buildError(BUILD_ERROR_CODES.invalidId, "invalid worker identifier: pass the immutable id of the worker; a new id must match ^[a-z][a-z0-9_-]{0,63}$.");
	const nameProvided = input.name !== void 0 && input.name !== null;
	let name = "";
	if (nameProvided) {
		if (!isValidWorkerName(input.name)) throw buildError(BUILD_ERROR_CODES.invalidName, "invalid worker name: use a single line of at most 64 characters, or leave it empty to show the identifier.");
		name = normalizeWorkerName(input.name);
	}
	let avatar = "";
	if (input.avatar !== void 0 && input.avatar !== null && input.avatar !== "") {
		if (!isAvatarId(input.avatar)) throw buildError(BUILD_ERROR_CODES.invalidAvatar, `unknown avatar id "${String(input.avatar)}"; use one of: ${AVATAR_IDS.join(", ")}.`);
		avatar = input.avatar;
	}
	let description = "";
	if (input.description !== void 0 && input.description !== null && typeof input.description !== "string") throw buildError(BUILD_ERROR_CODES.invalidDescription, "description must be a single-line string.");
	if (typeof input.description === "string") {
		description = normalizeWorkerDescription(input.description);
		if (description.length > 500) throw buildError(BUILD_ERROR_CODES.invalidDescription, `description is ${description.length} characters; the limit is 500. Shorten it to one sentence.`);
	}
	if (input.agents !== void 0 && input.agents !== null && typeof input.agents !== "string") throw buildError(BUILD_ERROR_CODES.invalidAgents, "agents must be a string containing the complete AGENTS.md markdown.");
	const rawAgents = typeof input.agents === "string" ? input.agents : "";
	const agents = rawAgents.trim() === "" ? "" : rawAgents;
	const agentsBytes = Buffer.byteLength(agents, "utf8");
	if (agentsBytes > 524288) throw buildError(BUILD_ERROR_CODES.agentsTooLarge, `AGENTS.md is ${agentsBytes} bytes; the limit is ${AGENTS_MAX_WRITE_BYTES} bytes. Shorten it or use the page editor.`);
	if (input.update !== void 0 && typeof input.update !== "boolean") throw buildError(BUILD_ERROR_CODES.invalidUpdate, "update must be a boolean.");
	const update = input.update === true;
	return {
		id: rawId,
		name,
		nameProvided,
		avatar,
		description,
		agents,
		agentsBytes,
		update
	};
}
/**
* `fs.realpath`，不存在时回退原值。
*
*/
async function canonicalPath(target) {
	try {
		return await promises.realpath(target);
	} catch {
		return path.resolve(target);
	}
}
/**
* 找执行者目录对应的已注册工作区。
*
* 工作区登记的路径本身就是规范绝对路径；执行者目录也走 `fs.realpath`，
* 两者直接比较，符号链接不会造成重复挂载。
*
*/
async function currentMount({ workspaceRegistry, workerPath } = {}) {
	if (typeof workspaceRegistry?.list !== "function") return null;
	const target = await canonicalPath(workerPath);
	let workspaces;
	try {
		workspaces = workspaceRegistry.list();
	} catch {
		return null;
	}
	for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
		if (typeof workspace?.path !== "string") continue;
		if (path.resolve(workspace.path) === target) return workspace;
	}
	return null;
}
/**
* 把已挂载工作区的标题同步成执行者当前展示名。
*
* 标题只是展示：同步失败（工作区记录不提供 `setTitle`、写入失败）不影响构建
* 结果，目录、登记表与引用都不受影响。
*
*/
async function syncWorkspaceTitle(workspace, title) {
	if (workspace === null || typeof workspace?.setTitle !== "function") return;
	const text = typeof title === "string" ? title.trim() : "";
	if (text === "") return;
	if (typeof workspace.title === "string" && workspace.title === text) return;
	try {
		await workspace.setTitle(text);
	} catch {}
}
/**
* 只同步已挂载工作区的标题，不新建工作区注册。
*
* 改名只改展示名：目录、工作区注册行与引用都不变；原先没挂载的执行者也不会
* 因为改名被顺手挂上。未挂载时返回 `mounted: false`、`workspaceId: null`。
*
*/
async function syncWorkerTitle({ workspaceRegistry, workerPath, title } = {}) {
	const existing = await currentMount({
		workspaceRegistry,
		workerPath
	});
	if (existing === null) return {
		mounted: false,
		workspaceId: null,
		mountError: null
	};
	await syncWorkspaceTitle(existing, title);
	return {
		mounted: true,
		workspaceId: existing.id ?? null,
		mountError: null
	};
}
/**
* 确保执行者目录已挂成 DSH 工作区。
*
* 已挂载时不动它（不重命名、不重排），只按需同步工作区标题；未挂载时用
* `workspaceRegistry.create(path, title)` 注册，标题用执行者展示名（空名时传
* 标识符）。挂载失败（注册表不可用、目录冲突等）不抛错，而是返回失败原因，
* 让执行者本身仍然可用。
*
*/
async function mountWorker({ workspaceRegistry, workerPath, title } = {}) {
	const existing = await currentMount({
		workspaceRegistry,
		workerPath
	});
	if (existing !== null) {
		await syncWorkspaceTitle(existing, title);
		return {
			mounted: true,
			workspaceId: existing.id ?? null,
			mountError: null
		};
	}
	if (typeof workspaceRegistry?.create !== "function") return {
		mounted: false,
		workspaceId: null,
		mountError: "the workspace registry is unavailable in this composition"
	};
	try {
		return {
			mounted: true,
			workspaceId: (await workspaceRegistry.create(workerPath, title))?.id ?? null,
			mountError: null
		};
	} catch (error) {
		return {
			mounted: false,
			workspaceId: null,
			mountError: describeError(error)
		};
	}
}
/**
* 创建或更新一个执行者，并确保它已挂到工作区。
*
* - `id` 必填且不可修改；已登记的标识符没有 `update: true` 时拒绝，避免模型
*   顺手覆盖用户的执行者；新建时 `id` 必须匹配新标识符字符集；
* - 已存在且 `update: true`：只改传了的字段（名称 / 头像 / 描述 / AGENTS.md），
*   目录与 `createdAt` 不变；描述为空串表示保留原描述；
* - 传了 `name` 且与当前展示名不同：只改展示名（`renamed: true`），目录不动、
*   工作区注册不重建，只同步已挂载工作区的标题；
* - 新建：按标识符建目录、写默认模板（没给 `agents` 时）、登记、按需写
*   AGENTS.md；
* - 所有情况都补 `CLAUDE.md` 链接（新建时），再确保工作区挂载。
*
*/
async function buildWorker({ workersDir, file, id, name, avatar, description, agents, update, workspaceRegistry } = {}) {
	const request = normalizeBuildRequest({
		id,
		name,
		avatar,
		description,
		agents,
		update
	});
	if (isBuiltinWorkerId(request.id)) throw buildError(BUILD_ERROR_CODES.builtinWorker, `"${request.id}" is a built-in robot identifier and cannot be created, changed or removed; robots are registered by the plugin.`);
	const registry = await readWorkerRegistry({ file });
	if (registry.corrupt) throw buildError(BUILD_ERROR_CODES.registryUnreadable, `the worker registry is unreadable: ${String(file)}. Fix or remove that file, then try again.`);
	const existing = registry.workers.find((worker) => worker.id === request.id);
	let worker;
	let created = false;
	let updated = false;
	let renamed = false;
	let previousName = null;
	if (existing === void 0) {
		if (!isValidWorkerId(request.id)) throw buildError(BUILD_ERROR_CODES.invalidId, `invalid new worker identifier "${request.id}": use ^[a-z][a-z0-9_-]{0,63}$.`);
		worker = (await addWorker({
			workersDir,
			file,
			id: request.id,
			name: request.nameProvided ? request.name : "",
			avatar: request.avatar,
			description: request.description
		})).worker;
		created = true;
		if (request.agents !== "") await writeAgentsFile(worker.path, request.agents);
	} else {
		if (existing.driver !== "agent") throw buildError(BUILD_ERROR_CODES.robotWorker, `"${request.id}" is a robot: robots are read-only and cannot be changed by this tool.`);
		if (!request.update) throw buildError(BUILD_ERROR_CODES.workerExists, `worker "${request.id}" already exists; pass update: true only when the user asked to change that worker.`);
		worker = existing;
		if (request.nameProvided && request.name !== existing.name) {
			const result = await setWorkerName({
				file,
				id: request.id,
				name: request.name
			});
			worker = result.worker;
			renamed = result.renamed;
			previousName = result.renamed ? result.previousName : null;
			updated = updated || result.renamed;
		}
		if (request.avatar !== "" && request.avatar !== worker.avatar) {
			worker = (await setWorkerAvatar({
				file,
				id: request.id,
				avatar: request.avatar
			})).worker;
			updated = true;
		}
		if (request.description !== "" && request.description !== worker.description) {
			worker = (await setWorkerDescription({
				file,
				id: request.id,
				description: request.description
			})).worker;
			updated = true;
		}
		if (request.agents !== "") {
			await ensureWorkerDirectory(worker.path, workerDisplayName(worker));
			await writeAgentsFile(worker.path, request.agents);
			updated = true;
		}
		if (request.agents === "" && await pathIsDirectory(worker.path)) try {
			await ensureClaudeLink(worker.path);
		} catch {}
	}
	const mount = await mountWorker({
		workspaceRegistry,
		workerPath: worker.path,
		title: workerDisplayName(worker)
	});
	return {
		worker: {
			id: worker.id,
			name: worker.name,
			driver: "agent",
			path: worker.path,
			avatar: worker.avatar,
			description: worker.description ?? "",
			createdAt: worker.createdAt
		},
		created,
		updated,
		renamed,
		previousName,
		agentsBytes: request.agents === "" ? 0 : request.agentsBytes,
		...mount
	};
}
/** 路径是否存在且是目录；用于决定要不要补 CLAUDE.md 链接。 */
async function pathIsDirectory(target) {
	try {
		return (await promises.stat(target)).isDirectory();
	} catch {
		return false;
	}
}
/**
* 把任意错误转成可以展示的文本。
*
*/
function describeError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// .build/workflows/workers/reveal.js
/**
* 在系统文件管理器里打开执行者目录。
*
* 「打开 Finder」按钮只把目录交给操作系统，不读写任何文件：macOS 用 `open`，
* Windows 用 `explorer`，其余平台用 `xdg-open`。子进程 detached 且忽略
* stdio，启动成功就返回，不等文件管理器退出（Finder 会一直开着）。
*
* 本模块只依赖 Node 内置模块，便于单独测试平台映射与参数校验。
*
* @module @buka/dsh-plugin-workflows/workers/reveal
*/
/**
* 当前平台（或指定平台）打开目录用的命令。
*
*/
function revealCommand(platform = process.platform) {
	if (platform === "darwin") return { command: "open" };
	if (platform === "win32") return { command: "explorer" };
	return { command: "xdg-open" };
}
/**
* 用系统文件管理器打开一个目录。
*
* 只保证「命令启动成功」；目录不存在、文件管理器拒绝等失败在这里抛错，
* 由路由转成可展示的错误。路径为空时直接拒绝，不会执行任何命令。
*
*/
async function revealDirectory(target) {
	if (typeof target !== "string" || target.trim() === "") throw new Error("缺少要打开的目录路径");
	const path = target.trim();
	const { command } = revealCommand();
	await new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(command, [path], {
				detached: true,
				stdio: "ignore",
				windowsHide: true
			});
		} catch (error) {
			reject(error);
			return;
		}
		let settled = false;
		const settle = (error) => {
			if (settled) return;
			settled = true;
			if (error !== void 0 && error !== null) {
				reject(error);
				return;
			}
			child.unref?.();
			resolve();
		};
		child.once("error", settle);
		child.once("spawn", () => settle());
	});
}
// .build/workflows/workers/routes/workers.js
/**
* 「执行者」页面的执行者相关 HTTP 路由。
*
* 负责登记表与目录的执行者管理接口：列表、创建、头像、描述、模型、
* 改展示名、移除、写 AGENTS.md 与打开 Finder。工作区身份（挂载 / 删除注册 /
* 打开会话）都由浏览器一半走 DSH Client Service，这里只处理磁盘事实。
*
* 执行者按不可变标识符 `id` 寻址；`name` 只是可选展示名。创建时 `id` 必填，
* 之后任何入口都不能改它。机器人（内建 clock）只读：创建 / 删除 / 改名 /
* 改字段都会被拒绝。
*
* @module @buka/dsh-plugin-workflows/workers/routes/workers
*/
/** 页面列出执行者用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = "/buka-workers/list";
/** 页面新建执行者用的路由。 */
const CREATE_ROUTE = "/buka-workers/create";
/** 页面给执行者换头像用的路由。 */
const AVATAR_ROUTE = "/buka-workers/avatar";
/** 页面编辑执行者描述用的路由。 */
const DESCRIPTION_ROUTE = "/buka-workers/description";
/** 页面读取可选模型目录用的路由。 */
const MODELS_ROUTE = "/buka-workers/models";
/** 页面给智能体设置新会话模型用的路由。 */
const MODEL_ROUTE = "/buka-workers/model";
/** 页面读取可用执行者预设（界面写作「模式」）列表用的路由。 */
const PRESETS_ROUTE = "/buka-workers/presets";
/** 页面给智能体设置默认执行者预设用的路由。 */
const PRESET_ROUTE = "/buka-workers/preset";
/** 页面改执行者展示名（不移动目录）用的路由。 */
const RENAME_ROUTE = "/buka-workers/rename";
/** 页面读取删除影响面（阻塞作业 / 受影响工作流 / 历史作业数）用的路由。 */
const REMOVE_IMPACT_ROUTE = "/buka-workers/remove-impact";
/** 页面删除执行者（登记 + 目录 + 工作区注册）用的路由。 */
const REMOVE_ROUTE = "/buka-workers/remove";
/** 页面「打开 Finder」用的路由。 */
const REVEAL_ROUTE = "/buka-workers/reveal";
/**
* 把 `agentPresets.list()` 的返回值收窄成页面稳定使用的形状。
*
* 服务不可用 / 返回值坏掉时按空列表处理；激活失败（broken）的预设保留，页面
* 把它标灰并显示原因。
*/
function normalizeAgentPresets(raw) {
	if (!Array.isArray(raw)) return [];
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of raw) {
		if (entry === null || typeof entry !== "object") continue;
		const record = entry;
		const id = typeof record.id === "string" ? record.id.trim() : "";
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		rows.push({
			id,
			name: typeof record.name === "string" ? record.name : "",
			description: typeof record.description === "string" ? record.description : "",
			broken: typeof record.broken === "string" ? record.broken : null
		});
	}
	return rows;
}
/** 把服务返回值收窄成稳定形状：缺字段按空值处理，不让页面拿到坏结构。 */
function normalizeWorkerUsage(raw) {
	const record = raw ?? {};
	return {
		runningJobs: Array.isArray(record.runningJobs) ? record.runningJobs.filter((entry) => entry !== null && typeof entry === "object").map((entry) => ({
			jobId: typeof entry.jobId === "string" ? entry.jobId : "",
			jobSeq: typeof entry.jobSeq === "number" ? entry.jobSeq : 0,
			workflowId: typeof entry.workflowId === "string" ? entry.workflowId : "",
			workflowName: typeof entry.workflowName === "string" ? entry.workflowName : "",
			jobName: typeof entry.jobName === "string" ? entry.jobName : ""
		})) : [],
		workflows: Array.isArray(record.workflows) ? record.workflows.filter((entry) => entry !== null && typeof entry === "object").map((entry) => ({
			workflowId: typeof entry.workflowId === "string" ? entry.workflowId : "",
			name: typeof entry.name === "string" ? entry.name : "",
			status: typeof entry.status === "string" ? entry.status : ""
		})) : [],
		finishedJobs: typeof record.finishedJobs === "number" ? record.finishedJobs : 0
	};
}
/**
* 注册执行者管理相关的精确路由。
*
*/
function registerWorkerRoutes(hostCtx, webCtx, deps) {
	const { workersDir, registryFile, serializeRegistry } = deps;
	const ctx = hostCtx;
	/**
	* 跨插件读取一个执行者的引用面。
	*
	* 工作流一半按可选服务处理：取不到服务时视为「没有作业引用」。
	* 服务存在但读取失败时向上抛，删除与影响面都中止，
	* 避免在未知引用的情况下误删。
	*
	*/
	async function readWorkerUsage(id) {
		const service = optionalService(ctx, "bukaWorkflows");
		if (service === null || service === void 0 || typeof service.workerUsage !== "function") return {
			runningJobs: [],
			workflows: [],
			finishedJobs: 0
		};
		return normalizeWorkerUsage(await service.workerUsage(id));
	}
	/** 把 resolveWorker 的错误写成响应。 */
	function sendWorkerError(res, error) {
		sendError(res, error.status, error.code, error.message);
	}
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: LIST_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			try {
				sendJson(res, 200, {
					ok: true,
					...await listWorkers({
						file: registryFile,
						workspaceRegistry: ctx.workspaceRegistry,
						workersDir
					})
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取执行者列表失败：%s", describeError$1(error));
				sendError(res, 500, "list-failed", `读取执行者列表失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: GET ${LIST_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: CREATE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isValidWorkerId(id)) {
				sendError(res, 400, "invalid-id", "执行者标识符不合法：需要匹配 ^[a-z][a-z0-9_-]{0,63}$（小写字母开头，可带小写字母、数字、_ 与 -）。");
				return;
			}
			if (body?.driver !== void 0 && body.driver !== "agent") {
				sendError(res, 400, "invalid-driver", "只能创建智能体；机器人由插件内建登记，不能创建。");
				return;
			}
			const avatar = typeof body?.avatar === "string" ? body.avatar.trim() : "";
			if (body?.description !== void 0 && typeof body.description !== "string") {
				sendError(res, 400, "invalid-description", "description 必须是字符串");
				return;
			}
			const description = typeof body?.description === "string" ? body.description : "";
			try {
				const result = await serializeRegistry(() => addWorker({
					workersDir,
					file: registryFile,
					id,
					name: body?.name,
					avatar,
					description
				}));
				webCtx.logger?.info?.("buka-workers: 已登记执行者 %s（%s，%s）", result.worker.id, result.worker.name, result.worker.path);
				sendJson(res, 200, {
					ok: true,
					worker: result.worker,
					created: result.created
				});
			} catch (error) {
				if (errorCode(error) === "invalid-id") {
					sendError(res, 400, "invalid-id", describeError$1(error));
					return;
				}
				if (errorCode(error) === "invalid-name") {
					sendError(res, 400, "invalid-name", describeError$1(error));
					return;
				}
				if (errorCode(error) === "id-taken") {
					sendError(res, 409, "id-taken", describeError$1(error));
					return;
				}
				if (errorCode(error) === "invalid-description") {
					sendError(res, 400, "invalid-description", `描述需要不超过 500 个字符的单行文本。`);
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$1(error));
					return;
				}
				if (errorCode(error) === "builtin-worker" || errorCode(error) === "robot-worker") {
					sendError(res, 409, String(errorCode(error)), describeError$1(error));
					return;
				}
				webCtx.logger?.warn?.("buka-workers: 创建执行者失败：%s", describeError$1(error));
				sendError(res, 500, "create-failed", `创建执行者失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${CREATE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: AVATAR_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			const avatar = typeof body?.avatar === "string" ? body.avatar.trim() : "";
			try {
				const result = await serializeRegistry(() => setWorkerAvatar({
					file: registryFile,
					id,
					avatar
				}));
				webCtx.logger?.info?.("buka-workers: 执行者 %s 的头像改为 %s", id, avatar);
				sendJson(res, 200, {
					ok: true,
					worker: result.worker
				});
			} catch (error) {
				if (errorCode(error) === "invalid-avatar") {
					sendError(res, 400, "invalid-avatar", describeError$1(error));
					return;
				}
				if (errorCode(error) === "invalid-id") {
					sendError(res, 400, "invalid-id", describeError$1(error));
					return;
				}
				if (errorCode(error) === "unknown-worker") {
					sendError(res, 404, "unknown-worker", describeError$1(error));
					return;
				}
				if (errorCode(error) === "robot-worker") {
					sendError(res, 409, "robot-worker", describeError$1(error));
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$1(error));
					return;
				}
				webCtx.logger?.warn?.("buka-workers: 修改执行者头像失败：%s", describeError$1(error));
				sendError(res, 500, "avatar-failed", `修改执行者头像失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${AVATAR_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: DESCRIPTION_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			const description = body?.description;
			if (typeof description !== "string") {
				sendError(res, 400, "invalid-description", "description 必须是字符串");
				return;
			}
			try {
				const result = await serializeRegistry(() => setWorkerDescription({
					file: registryFile,
					id,
					description
				}));
				webCtx.logger?.info?.("buka-workers: 已更新执行者 %s 的描述", id);
				sendJson(res, 200, {
					ok: true,
					worker: result.worker
				});
			} catch (error) {
				if (errorCode(error) === "invalid-description") {
					sendError(res, 400, "invalid-description", `描述需要不超过 500 个字符的单行文本。`);
					return;
				}
				if (errorCode(error) === "invalid-id") {
					sendError(res, 400, "invalid-id", describeError$1(error));
					return;
				}
				if (errorCode(error) === "unknown-worker") {
					sendError(res, 404, "unknown-worker", describeError$1(error));
					return;
				}
				if (errorCode(error) === "robot-worker") {
					sendError(res, 409, "robot-worker", describeError$1(error));
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$1(error));
					return;
				}
				webCtx.logger?.warn?.("buka-workers: 更新执行者描述失败：%s", describeError$1(error));
				sendError(res, 500, "description-failed", `更新执行者描述失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${DESCRIPTION_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: MODELS_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			const controller = new AbortController();
			res.on("close", () => controller.abort());
			try {
				sendJson(res, 200, {
					ok: true,
					...await buildWorkerModelCatalog(ctx, controller.signal)
				});
			} catch (error) {
				if (controller.signal.aborted) return;
				webCtx.logger?.warn?.("buka-workers: 读取模型目录失败：%s", describeError$1(error));
				sendError(res, 500, "models-failed", `读取模型目录失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: GET ${MODELS_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: MODEL_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			const model = body?.model;
			if (model !== null && model !== void 0 && (typeof model !== "object" || Array.isArray(model))) {
				sendError(res, 400, "invalid-model", "model 必须是对象或 null");
				return;
			}
			try {
				const result = await serializeRegistry(() => setWorkerModel({
					file: registryFile,
					id,
					model: model === null || model === void 0 ? null : model
				}));
				webCtx.logger?.info?.("buka-workers: 智能体 %s 的模型已更新", id);
				sendJson(res, 200, {
					ok: true,
					worker: result.worker
				});
			} catch (error) {
				if (errorCode(error) === "invalid-model") {
					sendError(res, 400, "invalid-model", describeError$1(error));
					return;
				}
				if (errorCode(error) === "invalid-id") {
					sendError(res, 400, "invalid-id", describeError$1(error));
					return;
				}
				if (errorCode(error) === "unknown-worker") {
					sendError(res, 404, "unknown-worker", describeError$1(error));
					return;
				}
				if (errorCode(error) === "robot-worker") {
					sendError(res, 409, "robot-worker", describeError$1(error));
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$1(error));
					return;
				}
				webCtx.logger?.warn?.("buka-workers: 更新智能体模型失败：%s", describeError$1(error));
				sendError(res, 500, "model-failed", `更新智能体模型失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${MODEL_ROUTE}`);
	/** 读一次 `agentPresets` 服务声明的预设；服务缺失时返回 `null`。 */
	async function listAgentPresets() {
		const service = optionalService(ctx, "agentPresets");
		if (service === null || service === void 0 || typeof service.list !== "function") return null;
		return normalizeAgentPresets(await service.list());
	}
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: PRESETS_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			try {
				const presets = await listAgentPresets();
				sendJson(res, 200, {
					ok: true,
					available: presets !== null,
					presets: presets ?? []
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取执行者预设失败：%s", describeError$1(error));
				sendError(res, 500, "presets-failed", `读取执行者预设失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: GET ${PRESETS_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: PRESET_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			const agentPreset = body?.agentPreset;
			if (agentPreset !== null && agentPreset !== void 0 && typeof agentPreset !== "string") {
				sendError(res, 400, "invalid-agent-preset", "agentPreset 必须是字符串或 null");
				return;
			}
			const nextPreset = agentPreset === null || agentPreset === void 0 ? null : agentPreset.trim();
			try {
				if (nextPreset !== null && nextPreset !== "") {
					const presets = await listAgentPresets();
					if (presets !== null && !presets.some((preset) => preset.id === nextPreset)) {
						sendError(res, 400, "unknown-agent-preset", `执行者预设不存在：${nextPreset}`);
						return;
					}
				}
				const result = await serializeRegistry(() => setWorkerPreset({
					file: registryFile,
					id,
					agentPreset: nextPreset
				}));
				webCtx.logger?.info?.("buka-workers: 智能体 %s 的执行者预设已更新", id);
				sendJson(res, 200, {
					ok: true,
					worker: result.worker
				});
			} catch (error) {
				const code = errorCode(error);
				if (code === "invalid-agent-preset" || code === "invalid-id" || code === "unknown-agent-preset") {
					sendError(res, 400, code, describeError$1(error));
					return;
				}
				if (code === "unknown-worker") {
					sendError(res, 404, "unknown-worker", describeError$1(error));
					return;
				}
				if (code === "robot-worker" || code === "registry-unreadable") {
					sendError(res, 409, code, describeError$1(error));
					return;
				}
				webCtx.logger?.warn?.("buka-workers: 更新执行者预设失败：%s", describeError$1(error));
				sendError(res, 500, "preset-failed", `更新执行者预设失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${PRESET_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: RENAME_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			const name = body?.name;
			if (name !== void 0 && name !== null && typeof name !== "string") {
				sendError(res, 400, "invalid-name", "name 必须是字符串");
				return;
			}
			const nextName = typeof name === "string" ? name : "";
			try {
				const result = await serializeRegistry(async () => {
					const registry = await readWorkerRegistry({ file: registryFile });
					if (registry.corrupt) throw Object.assign(/* @__PURE__ */ new Error("registry corrupt"), { code: "registry-unreadable" });
					if (!registry.workers.some((worker) => worker.id === id)) throw Object.assign(/* @__PURE__ */ new Error(`no worker with id ${id}`), { code: "unknown-worker" });
					const renamed = await renameWorker({
						file: registryFile,
						id,
						name: nextName
					});
					const mount = await syncWorkerTitle({
						workspaceRegistry: ctx.workspaceRegistry,
						workerPath: renamed.worker.path,
						title: workerDisplayName(renamed.worker)
					});
					return {
						...renamed,
						mount
					};
				});
				webCtx.logger?.info?.("buka-workers: 执行者 %s 的展示名改为 %s", result.worker.id, result.worker.name);
				sendJson(res, 200, {
					ok: true,
					id: result.worker.id,
					name: result.worker.name,
					previousName: result.previousName,
					renamed: result.renamed,
					worker: result.worker,
					mounted: result.mount.mounted,
					workspaceId: typeof result.mount.workspaceId === "string" ? result.mount.workspaceId : null,
					mountError: result.mount.mountError
				});
			} catch (error) {
				switch (errorCode(error)) {
					case "invalid-id":
					case "invalid-name":
					case "invalid-update":
						sendError(res, 400, String(errorCode(error)), describeError$1(error));
						return;
					case "unknown-worker":
						sendError(res, 404, "unknown-worker", describeError$1(error));
						return;
					case "registry-unreadable":
						sendError(res, 409, "registry-unreadable", describeError$1(error));
						return;
					case "builtin-worker":
						sendError(res, 409, "builtin-worker", describeError$1(error));
						return;
					case "robot-worker":
						sendError(res, 409, "robot-worker", describeError$1(error));
						return;
					default:
						webCtx.logger?.warn?.("buka-workers: 改展示名失败：%s", describeError$1(error));
						sendError(res, 500, "rename-failed", `改展示名失败：${describeError$1(error)}`);
				}
			}
		}
	}), `buka-workers: POST ${RENAME_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: REMOVE_IMPACT_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			try {
				const registry = await readWorkerRegistry({ file: registryFile });
				if (registry.corrupt) {
					sendError(res, 409, "registry-unreadable", `执行者登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`);
					return;
				}
				const worker = registry.workers.find((entry) => entry.id === id);
				if (worker === void 0) {
					sendError(res, 404, "unknown-worker", `没有找到这个执行者：${id}`);
					return;
				}
				if (worker.driver !== "agent") {
					sendError(res, 409, "robot-worker", `机器人只读，不能删除：${id}`);
					return;
				}
				const workspace = await findWorkerWorkspace(ctx.workspaceRegistry, worker.path).catch(() => null);
				const usage = await readWorkerUsage(id);
				sendJson(res, 200, {
					ok: true,
					id,
					name: workerDisplayName(worker),
					path: worker.path,
					mounted: workspace !== null,
					workspaceId: workspace === null ? null : String(workspace.id),
					blockers: { runningJobs: usage.runningJobs },
					workflows: usage.workflows,
					finishedJobs: usage.finishedJobs
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 读取删除影响面失败：%s", describeError$1(error));
				sendError(res, 500, "remove-impact-failed", `读取删除影响面失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${REMOVE_IMPACT_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: REMOVE_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const id = typeof body?.id === "string" ? body.id.trim() : "";
			if (!isResolvableWorkerId(id)) {
				sendError(res, 400, "invalid-id", `执行者标识符不合法：${String(body?.id)}`);
				return;
			}
			try {
				const usage = await readWorkerUsage(id);
				if (usage.runningJobs.length > 0) {
					sendJson(res, 409, {
						ok: false,
						code: "worker-in-use",
						message: "有引用这个执行者的运行中作业，删除会打断它们；请先在作业页主动终止这些作业，再回来删除。",
						jobs: usage.runningJobs
					});
					return;
				}
				const result = await serializeRegistry(() => deleteWorker({
					workersDir,
					file: registryFile,
					id,
					workspaceRegistry: ctx.workspaceRegistry
				}));
				webCtx.logger?.info?.("buka-workers: 已删除执行者 %s（目录 %s，工作区注册 %s）", result.worker.id, result.path, result.workspaceId ?? "无");
				sendJson(res, 200, {
					ok: true,
					id,
					removed: true,
					path: result.path,
					workspaceId: result.workspaceId,
					directoryRemoved: result.directoryRemoved,
					workflows: usage.workflows,
					finishedJobs: usage.finishedJobs
				});
			} catch (error) {
				switch (errorCode(error)) {
					case "invalid-id":
						sendError(res, 400, "invalid-id", describeError$1(error));
						return;
					case "registry-unreadable":
					case "builtin-worker":
					case "robot-worker":
					case "outside-root":
					case "workspace-unavailable":
						sendError(res, 409, String(errorCode(error)), describeError$1(error));
						return;
					case "unknown-worker":
						sendError(res, 404, "unknown-worker", describeError$1(error));
						return;
					default:
						webCtx.logger?.warn?.("buka-workers: 删除执行者失败：%s", describeError$1(error));
						sendError(res, 500, "remove-failed", `删除执行者失败：${describeError$1(error)}`);
				}
			}
		}
	}), `buka-workers: POST ${REMOVE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: REVEAL_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveWorker(registryFile, body?.id);
			if (resolved.error !== void 0) {
				sendWorkerError(res, resolved.error);
				return;
			}
			try {
				await revealDirectory(resolved.worker.path);
				webCtx.logger?.info?.("buka-workers: 已打开执行者目录（%s）", resolved.worker.path);
				sendJson(res, 200, {
					ok: true,
					path: resolved.worker.path
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-workers: 打开执行者目录失败：%s", describeError$1(error));
				sendError(res, 500, "reveal-failed", `打开执行者目录失败：${describeError$1(error)}`);
			}
		}
	}), `buka-workers: POST ${REVEAL_ROUTE}`);
}
// .build/workflows/workers/routes.js
/**
* 「执行者」页面的 HTTP 路由装配。
*
* 路由本身按职责拆在 `routes/workers.ts`、`routes/files.ts` 与
* `routes/skills.ts`；这里只做两件事：等 `webServer` / `connection` 就绪，
* 然后把三组精确路由注册到同一个 web 上下文上。
*
* @module @buka/dsh-plugin-workflows/workers/routes
*/
/**
* 在 `webServer` 就绪后注册页面用到的全部精确路由。
*
*/
function registerRoutes(ctx, deps) {
	ctx.inject(["webServer", "connection"], (webCtx) => {
		registerWorkerRoutes(ctx, webCtx, deps);
		registerFileRoutes(webCtx, deps);
		registerSkillRoutes(webCtx, deps);
	});
}
/**
* 预设执行者清单（按显示顺序）。
*
*/
const PRESET_WORKERS = Object.freeze([{
	id: "software-engineer",
	name: "软件工程师",
	avatar: "rocket",
	description: "负责软件功能的设计与实现：写代码、修 bug、重构、跑测试、整理提交；用于编码、实现需求、修缺陷等开发任务。",
	agents: `# AGENTS.md

这是「软件工程师」执行者的协作说明。这个目录同时是一个 DSH 工作区。

## 职责

负责软件功能的设计与实现：编写代码、修复缺陷、重构、跑测试、整理提交。

## 约定

- 动手前先读仓库里已有的文档、脚本与测试，并遵循项目自己的 AGENTS.md 与架构约定。
- 提交信息用 Conventional Commits；一个 commit 只做一件事。
- 改完代码要跑相关测试，确认没有引入回归再交回结果。
- 不扩大改动范围：只做被委派的事，不顺手改无关代码。
- 交付时说明改了什么、为什么这样改、以及验证方式。
`
}, {
	id: "qa-engineer",
	name: "质量保障工程师",
	avatar: "owl",
	description: "负责质量保障：设计并执行测试、检查覆盖率、回归验证、审查变更是否引入风险；用于测试、验收、质量把关等任务。",
	agents: `# AGENTS.md

这是「质量保障工程师」执行者的协作说明。这个目录同时是一个 DSH 工作区。

## 职责

负责质量保障：设计并执行测试、检查覆盖率、回归验证、审查变更是否引入风险。

## 约定

- 测试优先：先理解预期行为与边界条件，再写或跑测试。
- 覆盖关键路径与边界用例；对不确定的行为先确认预期，再下结论。
- 发现问题给出可复现的步骤、预期与实际差异、以及风险等级，不直接改实现。
- 回归时对照变更范围，确认没有顺带破坏已有行为。
- 交付时给出结论（通过 / 有问题）与依据，而不是只报现象。
`
}]);
/**
* 全新安装时把预设执行者补进登记表（幂等）。
*
* 只在登记表**一个执行者都没有**时才做种子初始化：这样全新安装立刻有两个
* 起步执行者，而已有执行者的用户不会被塞进预设，删除预设后也不会在下次启动
* 被补回。登记表损坏时直接拒绝，绝不覆盖用户文件。
*
*/
async function seedPresetWorkers({ workersDir, file, workspaceRegistry } = {}) {
	const registry = await readWorkerRegistry({ file });
	if (registry.corrupt) return {
		corrupt: true,
		seeded: []
	};
	if (registry.workers.filter((worker) => worker.driver === "agent").length > 0) return {
		corrupt: false,
		seeded: []
	};
	const seeded = [];
	for (const preset of PRESET_WORKERS) {
		const result = await buildWorker({
			workersDir,
			file,
			id: preset.id,
			name: preset.name,
			avatar: preset.avatar,
			description: preset.description,
			agents: preset.agents,
			workspaceRegistry
		});
		if (result.created) seeded.push(result.worker.id);
	}
	return {
		corrupt: false,
		seeded
	};
}
// .build/workflows/workers/seed.js
/**
* 全新安装时的预设执行者初始化。
*
* 登记表为空时补上「软件工程师」与「质量保障工程师」两个预设执行者；与页面上的
* 首次新建共用同一个登记表写队列，避免抢写。初始化异步完成、不阻塞启动，失败
* 只记日志。
*
* @module @buka/dsh-plugin-workflows/workers/seed
*/
/**
* 在登记表为空时初始化预设执行者；`enabled: false` 时跳过。
*
*/
function seedWorkersOnStartup({ ctx, workersDir, registryFile, serializeRegistry, enabled }) {
	if (!enabled) return;
	serializeRegistry(() => seedPresetWorkers({
		workersDir,
		file: registryFile,
		workspaceRegistry: ctx.workspaceRegistry
	}).then((result) => {
		if (result.seeded.length > 0) ctx.logger?.info?.("buka-workers: 已初始化预设执行者：%s", result.seeded.join("、"));
	})).catch((error) => {
		ctx.logger?.warn?.("buka-workers: 初始化预设执行者失败：%s", describeError$1(error));
	});
}
// .build/workflows/workers/engine/errors.js
/**
* 执行者会话的内部错误类型。
*
* @module @buka/dsh-plugin-workflows/workers/engine/errors
*/
/** 执行者会话被超时 / 取消时抛出的内部错误。 */
var WorkerSessionStop = class extends Error {
	/** 停止原因：超时或取消。 */
	kind;
	/**
	*/
	constructor(kind, message) {
		super(message);
		this.name = "WorkerSessionStop";
		this.kind = kind;
	}
};
// .build/workflows/workers/engine/session-events.js
/**
* 执行者会话日志的读取。
*
* 只按字段读 DSH 的会话事件（`assistant/message` / `turn/end`），不依赖上游
* 事件类型的完整定义，这样本模块可以脱离 DSH 依赖被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-workflows/workers/engine/session-events
*/
/**
* 会话日志里 `sinceSeq` 之后的事件；没有事件源时返回空数组。
*
*/
function sessionEvents(session, sinceSeq = 0) {
	if (typeof session?.snapshotEvents === "function") return session.snapshotEvents(sinceSeq);
	if (typeof session?.ownEvents === "function") return session.ownEvents();
	return [];
}
/**
* 从会话日志里取一次轮次（`sinceSeq` 之后）的 assistant 文本、结束原因，以及
* 这一轮是否真的写下了 `turn/end`。观察者恢复时靠 `turnEnded` 判断上一轮是
* 已经完成、还是被中断后需要续跑。
*
*/
function readSessionTurn(session, sinceSeq = 0) {
	const events = sessionEvents(session, sinceSeq);
	let text = "";
	let reason;
	let turnEnded = false;
	let turnEndSeq = null;
	for (const event of events) {
		if (typeof event?.seq === "number" && event.seq < sinceSeq) continue;
		if (event?.type === "assistant/message") {
			const content = event?.data?.message?.content;
			const parts = Array.isArray(content) ? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text) : [];
			if (parts.length > 0) text = parts.join("\n");
		} else if (event?.type === "turn/end") {
			reason = event?.data?.reason;
			turnEnded = true;
			turnEndSeq = typeof event?.seq === "number" ? event.seq : null;
		}
	}
	return {
		text,
		stopReason: mapTurnEnd(reason),
		turnEnded,
		turnEndSeq
	};
}
/**
* 从会话日志读 plan 模式状态。
*
* DSH 的 plan 模式把状态记成 `plan/mode` 事件（整值替换），最后一条就是当前
* 提交状态；读不到事件时按未激活处理。这样不需要拿到被 `isolate` 在会话
* preset 里的 planMode 服务实例，profile 根部的插件也能判断某个会话是否还
* 停在 plan 模式。
*
*/
function readPlanModeActive(session) {
	const events = sessionEvents(session);
	let active = false;
	for (const event of events) if (event?.type === "plan/mode" && typeof event?.data?.active === "boolean") active = event.data.active;
	return active;
}
/**
* 把 `turn/end.reason` 映射成节点结果里的 stopReason。
*
*/
function mapTurnEnd(reason) {
	const kind = reason?.kind;
	switch (kind) {
		case "completed":
		case "error":
		case "max-tokens":
		case "aborted":
		case "interrupted":
		case "blocked":
		case "forked": return kind;
		default: return typeof kind === "string" ? kind : "completed";
	}
}
/**
* 会话当前的事件序号；续接时用它排除旧轮次。
*
*/
function seqOf(agent) {
	const seq = agent?.session?.seq;
	return typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
}
// .build/workflows/workers/engine/summary.js
/**
* 执行者列表的摘要投影。
*
* @module @buka/dsh-plugin-workflows/workers/engine/summary
*/
/**
* 执行者列表里的一行：去掉 AGENTS.md 正文等大字段，只保留编排需要的摘要。
*
* `id` 是不可变标识符（引用键），`name` 是可选展示名（空串表示未设置，展示时
* 回退到 `id`）；两者都原样给出，让消费方自己决定显示哪个。`driver` /
* `program` 是工作流的主体契约：智能体可以开会话，机器人（clock）由工作流
* 按 `program` 驱动、不建会话。机器人没有目录，`exists` / `mounted` 恒为
* false，`skills` 为空。助理不是这里的一个字段：它由工作流对人任务类型的
* 点名决定。
*
*/
function summarizeWorker(worker) {
	const agents = worker?.agents ?? {};
	return {
		id: typeof worker?.id === "string" ? worker.id : "",
		name: typeof worker?.name === "string" ? worker.name : "",
		displayName: workerDisplayName(worker ?? {}),
		driver: worker?.driver === "robot" ? "robot" : "agent",
		program: typeof worker?.program === "string" ? worker.program : "",
		builtin: isBuiltinWorkerId(worker?.id),
		path: worker?.path ?? "",
		createdAt: worker?.createdAt ?? null,
		avatar: resolveAvatar(worker?.avatar, worker?.id),
		description: typeof worker?.description === "string" ? worker.description : "",
		...typeof worker?.agentPreset === "string" && worker.agentPreset !== "" ? { agentPreset: worker.agentPreset } : {},
		exists: worker?.exists === true,
		mounted: worker?.mounted === true,
		workspaceId: worker?.workspaceId ?? null,
		skills: Array.isArray(worker?.skills) ? worker.skills.map((skill) => ({
			name: typeof skill?.name === "string" ? skill.name : "",
			description: typeof skill?.description === "string" ? skill.description : ""
		})) : [],
		agents: {
			exists: agents.exists === true,
			bytes: typeof agents.bytes === "number" ? agents.bytes : 0,
			modifiedAt: agents.modifiedAt ?? null
		}
	};
}
// .build/workflows/workers/service.js
/**
* 执行者一半对外提供的 Host Service：`ctx.bukaWorkers`。
*
* 能力（工作流插件与将来的编排器使用）：
*
* - `list()`：执行者登记表 + 目录状态 + 挂载状态 + 已装 skills，摘要里带
*   `driver`（agent / robot）/ `program`；
* - `avatarMap()`：执行者标识符 → 预设头像 id（只读登记表，工作流节点图用它）；
* - `dispatchSession(request)`：在执行者目录下**新开**一条会话并投递一段提示词，
*   立即返回观测句柄；不在服务里等待这一轮结束，也不设默认超时；
* - `openSession(request)`：只续接（resume / attach）一条已有会话，不发 prompt；
*   观察者恢复时先用它检查上一轮是否其实已经结束，确认要继续时再调句柄的
*   `send`。
*
* 一个任务一条新会话：`dispatchSession` 不复用上一条任务的会话；`openSession`
* 只续接同一条会话，**不压缩**。压缩、结构化结果校验与结果追问都在工作流侧
* （`buka_task_complete`），本服务不再注册 `structured_output` 工具。
*
* 机器人（clock）没有会话：`dispatchSession` / `openSession` 会拒绝
* 它们，执行由工作流按 `driver` + `program` 驱动。
*
* 唯一的会话后端是普通顶层会话：`cwd` 是执行者目录，执行者自己的 AGENTS.md /
* 项目 skills 照常生效，会话挂到执行者工作区并出现在 DSH 侧边栏。创建或续接
* 失败时直接抛错，不退回 subagent 子会话，也不另开新会话。
*
* 通过 `ctx.provide('bukaWorkers', new WorkerSessionService(...))` 注册，消费方
* 用 `inject: ['bukaWorkers']` 或 `ctx.get('bukaWorkers')` 获取。
*
* @module @buka/dsh-plugin-workflows/workers/service
*/
/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaWorkers`。 */
const SERVICE_NAME = "bukaWorkers";
/** plan 模式入口不可用时给用户看的错误文案。 */
const PLAN_MODE_UNAVAILABLE = "plan mode is unavailable in this composition; install or update @deepseek-ai/dsh-plan-mode to use a worker task type with \"plan\": true";
/**
* 命令是否解析并成功执行：没解析到（undefined）或结果是成功以外的 kind 都算
* 没成功，返回失败原因。
*
*/
function commandFailure(execution) {
	const kind = execution.result?.kind;
	if (kind === void 0 || kind === "success") return void 0;
	return typeof kind === "string" ? kind : "error";
}
/**
* 释放 agent 后重新通告会话时，读取宿主会话列表的最长时间。
*
* 通告只是可读性补偿，不能因为宿主列表很慢就拖住释放流程。
*/
const ANNOUNCE_SESSION_TIMEOUT_MS = 2e3;
var WorkerSessionService = class {
	/** Host 上下文：取 agents / approval 等可选服务。 */
	ctx;
	/** 执行者根目录。 */
	workersDir;
	/** 登记文件绝对路径。 */
	registryFile;
	/** 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。 */
	supportsPlanMode;
	/**
	*/
	constructor(options) {
		this.ctx = options.ctx;
		this.workersDir = options.workersDir;
		this.registryFile = options.registryFile;
		/**
		* 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。工作流的
		* plan 节点在启动前用它判断是否需要提示用户升级 workers 插件；旧版本没有
		* 这个字段，planMode 请求会被静默忽略。
		*/
		this.supportsPlanMode = true;
	}
	/**
	* 列出执行者。
	*
	*/
	async list() {
		const snapshot = await listWorkers({
			file: this.registryFile,
			workspaceRegistry: this.ctx?.workspaceRegistry,
			workersDir: this.workersDir
		});
		return {
			root: snapshot.root,
			registry: snapshot.registry,
			corrupt: snapshot.corrupt,
			workers: snapshot.workers.map((worker) => summarizeWorker(worker))
		};
	}
	/**
	* 执行者名 → 头像 id。给工作流这类只关心「谁在执行」的消费方用：只读登记表，
	* 不扫描每个执行者目录里的 skills / AGENTS.md，所以可以频繁调用。
	*
	* 内建机器人（clock）也在这里，工作流把它画在节点上。旧登记表里
	* 缺头像的执行者按标识符兜底成一个确定的预设。登记表损坏时返回空表。
	*
	*/
	async avatarMap() {
		const registry = await readWorkerRegistry({ file: this.registryFile });
		const map = {};
		if (!registry.corrupt) for (const worker of withBuiltinWorkers(registry.workers)) map[worker.id] = resolveAvatar(worker.avatar, worker.id);
		return map;
	}
	/**
	* 非阻塞地把一段 prompt 投进一条**新的**执行者会话，返回一个可观测句柄；
	* 不在服务里等待这一轮结束，也不设默认超时。工作流观察者负责订阅
	* `session/event` 并在 `turn/end` 后读结果、决定路由；会话异常终止时由观察者
	* 重新 open/dispatch。硬超时由调用方（观察者）自己计时后调用句柄的 `cancel()`。
	*
	* 一个任务一条新会话：这里不接受 `sessionId`，恢复只能走 `openSession`。
	*
	* 请求带 `userPrompt` 时，`prompt` 作为上下文用 `inject` 投递（来源不是
	* `user`，不唤醒会话），`userPrompt` 用 `followup` 以用户身份投递并唤醒这一轮；
	* 不带时只投一条 followup，行为与旧版一致。
	*
	*/
	async dispatchSession(request = {}) {
		if (typeof request.prompt !== "string" || request.prompt.trim() === "") throw new Error("dispatchSession requires a non-empty prompt");
		if ("sessionId" in request && request.sessionId !== void 0) throw new Error("dispatchSession always starts a new worker session; use openSession() to resume an existing session");
		this.#assertPlanModeRequest(request);
		const worker = await this.#resolveWorker(request.worker);
		const agentOptions = mergeAgentOptions(this.#workerAgentOptions(worker), request.agentOptions);
		if (typeof agentOptions.provider !== "string" || typeof agentOptions.model !== "string") throw new Error("no model route is available for the worker session: pass agentOptions.provider/model or configure a default model");
		const signal = request.signal;
		signal?.throwIfAborted?.();
		return await this.#startDispatch({
			request,
			worker,
			agentOptions,
			signal
		});
	}
	/**
	* 只打开（resume / attach）一条已有执行者会话，不发 prompt、不压缩。观察者
	* 恢复时先用它检查上一轮是否其实已经结束；确认要继续时再调句柄的 `send`。
	*
	*/
	async openSession(request = {}) {
		const sessionId = typeof request.sessionId === "string" ? request.sessionId.trim() : "";
		if (sessionId === "") throw new Error("openSession requires a sessionId");
		this.#assertPlanModeRequest(request);
		const worker = await this.#resolveWorker(request.worker);
		const agentOptions = mergeAgentOptions(this.#workerAgentOptions(worker), request.agentOptions);
		if (typeof agentOptions.provider !== "string" || typeof agentOptions.model !== "string") throw new Error("no model route is available for the worker session: pass agentOptions.provider/model or configure a default model");
		const signal = request.signal;
		signal?.throwIfAborted?.();
		const prepared = await this.#resumeAgent({
			request,
			worker,
			agentOptions,
			signal,
			sessionId
		});
		try {
			await this.#applyPlanMode(prepared.agent, request, request.signal);
		} catch (error) {
			try {
				await prepared.handle?.dispose?.();
			} catch {}
			throw error;
		}
		return this.#observeHandle({
			agent: prepared.agent,
			handle: prepared.handle,
			sessionId: prepared.sessionId,
			worker,
			resumed: true,
			startSeq: seqOf(prepared.agent)
		});
	}
	/**
	* 把创建失败包装成给用户看的错误：说明没有隐藏兜底、也没有替代会话。
	*
	*/
	#creationError(worker, error, signal) {
		if (signal?.aborted === true) return error instanceof Error ? error : new Error(describeError$2(error));
		return new Error(`could not create a visible worker session for worker "${worker.id}": ${describeError$2(error)}; refusing to fall back to a hidden subagent or a replacement session`, { cause: error });
	}
	/**
	* 用调用方给的 `title` 给执行者会话命名。
	*
	* 执行者会话的第一条用户消息来源是 `buka-worker`，而 DSH 的自动标题只看
	* `source.kind === 'user'` 的消息，所以这类会话不会自己长出标题：侧边栏与
	* 会话列表里一直显示「未命名」。工作流进入节点时会把「运行目标 · 执行者」
	* 作为 `title` 传进来，这里用 `sessionTitle.rename()` 写一条显式标题。
	*
	* 续接已有会话时只在还没有标题的情况下补写，不覆盖用户手动改过的名字。
	*
	*/
	#titleSession(agent, title) {
		const text = typeof title === "string" ? title.trim() : "";
		if (text === "") return;
		const session = agent?.session;
		if (session === void 0 || session === null) return;
		const service = optionalService(this.ctx, "sessionTitle");
		if (typeof service?.rename !== "function") return;
		try {
			if (typeof service.get === "function" && service.get(session) !== void 0) return;
			service.rename(session, text);
		} catch (error) {
			this.ctx?.logger?.warn?.(`buka-workers: could not title worker session "${String(session?.id ?? "")}": ${describeError$2(error)}`);
		}
	}
	/**
	* 给新会话 / 续接会话装上执行者自己的工作 preset。
	*
	* 普通顶层会话和 `agents.resume()` 都不会自动套 composition，所以由服务显式
	* 挂载；结果契约（结构化输出）已移到工作流侧，这里不再注册任何工具。
	*
	*/
	async #composeSession(childCtx, agent, request, { resume }) {
		const presets = childCtx?.get?.("agentPresets") ?? childCtx?.agentPresets;
		if (presets !== void 0 && presets !== null) {
			const recorded = resume && typeof presets.presetForSession === "function" ? presets.presetForSession(agent?.session) : null;
			const requested = typeof request.agentPreset === "string" ? request.agentPreset.trim() : "";
			const preset = typeof recorded === "string" && recorded !== "" ? recorded : requested !== "" ? requested : typeof presets.defaultId === "string" ? presets.defaultId : "";
			if (preset !== "" && typeof presets.mount === "function") await presets.mount(childCtx, preset);
			else if (typeof presets.composeFrom === "function" && request.agent?.ctx !== void 0) presets.composeFrom(childCtx, request.agent.ctx);
		}
	}
	/**
	* 新建一个普通顶层执行者会话并完成标题、审批策略、工作区挂载；不发送 prompt。
	*
	*/
	async #createVisibleAgent({ request, worker, agentOptions, signal }) {
		const agents = optionalService(this.ctx, "agents");
		if (typeof agents?.create !== "function") throw new Error("the agent service is unavailable, so a worker session cannot be created");
		const requestedSessionId = typeof request.newSessionId === "string" ? request.newSessionId.trim() : "";
		const sessionId = requestedSessionId !== "" ? requestedSessionId : randomUUID();
		const requestedPreset = typeof request.agentPreset === "string" ? request.agentPreset.trim() : "";
		const handle = await agents.create({
			sessionId,
			meta: {
				cwd: worker.path,
				...requestedPreset === "" ? {} : { agentPreset: requestedPreset }
			},
			agentOptions,
			signal,
			setup: async (childCtx, agent) => {
				await this.#composeSession(childCtx, agent, request, { resume: false });
			}
		});
		const agent = handle.agent;
		await this.#assertVisibleAgent(agent, handle);
		this.#titleSession(agent, request.title);
		if (request.approval === "never") try {
			this.ctx?.get?.("approval")?.setPolicy?.(agent, "never");
		} catch {}
		await this.#attachSessionToWorkspace(sessionId, worker);
		return {
			sessionId,
			agent,
			handle
		};
	}
	/**
	* resume 一条已有执行者会话并完成标题、审批策略、工作区挂载；不发 prompt、
	* 不压缩（一个任务一条会话，恢复只续接同一条）。
	*
	* 续接出来的会话是**运行时根会话**：DSH 的人类交互要求根 agent，所以这里
	* 不传 `parentAgent`（与 `agents.create` 的顶层会话一致）。历史会话如果是
	* 旧版 `origin: 'subagent'` 的隐藏会话，直接拒绝：dispose 后抛错，不新开。
	*
	*/
	async #resumeAgent({ request, worker, agentOptions, signal, sessionId }) {
		const agents = optionalService(this.ctx, "agents");
		if (typeof agents?.resume !== "function") throw new Error("the agent service cannot resume a worker session in this composition");
		let handle;
		try {
			handle = await agents.resume({
				resumeSessionId: sessionId,
				agentOptions,
				signal,
				setup: async (childCtx, agent) => {
					await this.#composeSession(childCtx, agent, request, { resume: true });
				}
			});
		} catch (error) {
			if (signal?.aborted === true) throw new WorkerSessionStop("aborted", "worker session was cancelled");
			throw new Error(`could not resume worker session "${sessionId}" for worker "${worker.id}": ${describeError$2(error)}; refusing to start a new worker session`, { cause: error });
		}
		const agent = handle.agent;
		await this.#assertVisibleAgent(agent, handle);
		this.#titleSession(agent, request.title);
		if (request.approval === "never") try {
			this.ctx?.get?.("approval")?.setPolicy?.(agent, "never");
		} catch {}
		await this.#attachSessionToWorkspace(sessionId, worker);
		return {
			sessionId,
			agent,
			handle
		};
	}
	/**
	* 拒绝 DSH 侧边栏不显示的隐藏会话（`origin: 'subagent'`）。
	*
	* 旧版本的工作流兜底可能把执行者节点落成 subagent 子会话；这类会话即使
	* 打开也只在主区域显示，不能作为工作流节点会话。命中时先释放 agent，再抛错。
	*
	*/
	async #assertVisibleAgent(agent, handle) {
		if (agent?.session?.header?.origin !== "subagent") return;
		await disposeHandle(handle);
		throw new Error("refusing to use a hidden subagent worker session; worker sessions must be visible top-level sessions");
	}
	/**
	* 命令注册表服务：DSH 里 plan 模式的入口就是用户对会话执行的 `/plan` 命令，
	* 服务按 `agent` 作用域解析命令。返回 undefined 表示这个组合没有可用的命令
	* 入口。
	*
	*/
	#commandsService() {
		const commands = optionalService(this.ctx, "commands");
		if (commands === void 0 || typeof commands.execute !== "function") return void 0;
		return commands;
	}
	/**
	* 创建 / 恢复会话之前检查请求能否满足：要求进入 plan 模式但组合里没有命令
	* 入口时直接失败，避免留下一个没人接管模式的会话。命令是否真的能对目标
	* agent 执行，要等 agent 创建后才能确认，由 `#applyPlanMode()` 负责。
	*
	*/
	#assertPlanModeRequest(request) {
		if (request?.planMode !== true) return;
		if (this.#commandsService() === void 0) throw new Error(PLAN_MODE_UNAVAILABLE);
	}
	/**
	* 在投递第一轮 prompt 之前进入 / 清除 plan 模式。
	*
	* `true` 进入、`false` 确保退出、省略表示不改变。DSH 的 plan 模式是会话级
	* 状态，对 profile 根部插件唯一可用的入口是命令：对目标 agent 执行
	* `/plan`（与用户在会话里输入 `/plan` 完全相同），退出用 `/plan off`。
	* 不能直接读 `planMode` 服务实例——在 web/desktop 的组合里它被 `isolate`
	* 在会话 preset 内，根作用域既看不到、也不该依赖它。
	*
	* 进入必须发生在第一轮之前：此时没有开放 turn，命令会立即写入 `plan/mode`，
	* 第一步的请求组装就能看到 `plan:policy` 与 `exit_plan_mode`。退出是
	* best-effort：命令不可用或执行失败只记日志，不影响普通节点。
	*
	*/
	async #applyPlanMode(agent, request, signal) {
		const requested = request?.planMode;
		if (requested !== true && requested !== false) return;
		const commands = this.#commandsService();
		if (commands === void 0) {
			if (requested === true) throw new Error(PLAN_MODE_UNAVAILABLE);
			return;
		}
		if (requested === false && !readPlanModeActive(agent?.session)) return;
		const line = requested === true ? "/plan" : "/plan off";
		try {
			const execution = await commands.execute(agent, line, [], signal ?? new AbortController().signal);
			if (execution === void 0) {
				if (requested === true) throw new Error(PLAN_MODE_UNAVAILABLE);
			} else {
				const failure = commandFailure(execution);
				if (failure !== void 0) {
					if (requested === true) throw new Error(`plan mode could not be entered: the /plan command reported "${failure}"; refusing to run the node in normal mode`);
					this.ctx?.logger?.warn?.(`buka-workers: /plan off reported "${failure}" for worker session "${String(agent?.id ?? "")}"`);
				}
			}
		} catch (error) {
			if (requested === true) throw error;
			this.ctx?.logger?.warn?.(`buka-workers: could not leave plan mode for worker session "${String(agent?.id ?? "")}": ${describeError$2(error)}`);
		}
	}
	/**
	* 新会话的非阻塞 dispatch：建会话、投 prompt、返回句柄；不等待这一轮结束。
	*
	*/
	async #startDispatch({ request, worker, agentOptions, signal }) {
		let prepared;
		try {
			prepared = await this.#createVisibleAgent({
				request,
				worker,
				agentOptions,
				signal
			});
		} catch (error) {
			throw this.#creationError(worker, error, signal);
		}
		try {
			await this.#applyPlanMode(prepared.agent, request, signal);
		} catch (error) {
			try {
				await prepared.handle?.dispose?.();
			} catch {}
			throw error;
		}
		const startSeq = seqOf(prepared.agent);
		const userPrompt = typeof request.userPrompt === "string" ? request.userPrompt : "";
		if (userPrompt.trim() === "") prepared.agent.followup(followupMessage(request.prompt ?? ""));
		else {
			prepared.agent.inject(contextMessage(request.prompt ?? ""));
			prepared.agent.followup(userMessage(userPrompt));
		}
		return this.#observeHandle({
			agent: prepared.agent,
			handle: prepared.handle,
			sessionId: prepared.sessionId,
			worker,
			resumed: false,
			startSeq
		});
	}
	/**
	* 把一次非阻塞 dispatch / open 包装成观察者句柄。句柄只持有这一个 live agent
	* 的操作，不负责等待；`readResult` 从会话日志读，`cancel` 只取消当前轮。
	*
	*/
	#observeHandle({ agent, handle, sessionId, worker, resumed, startSeq }) {
		const service = this;
		let disposed = false;
		const dispose = async () => {
			if (disposed) return;
			disposed = true;
			await service.#releaseAgent(handle, sessionId ?? "");
		};
		const observer = {
			mode: "session",
			sessionId: typeof agent?.id === "string" && agent.id !== "" ? agent.id : sessionId ?? "",
			worker: worker.id,
			cwd: worker.path,
			resumed,
			startSeq,
			/**
			* 从日志读这一轮的结果；`sinceSeq` 之前的轮次不算。
			*
			*/
			readResult({ sinceSeq = observer.startSeq } = {}) {
				const turn = readSessionTurn(agent?.session, sinceSeq);
				return {
					sessionId: observer.sessionId,
					text: turn.text,
					stopReason: turn.stopReason,
					turnEnded: turn.turnEnded,
					startSeq: sinceSeq,
					...turn.turnEndSeq === null ? {} : { turnEndSeq: turn.turnEndSeq }
				};
			},
			/**
			* 在同一会话里再发一条消息（恢复续跑 / plan 审阅跟进用）。返回新的起点 seq。
			* 不再有压缩：续接就是往同一条会话里继续投消息。
			*
			*/
			async send(text) {
				if (typeof text !== "string" || text.trim() === "") throw new Error("send requires a non-empty prompt");
				const next = seqOf(agent);
				agent.followup(followupMessage(text));
				observer.startSeq = next;
				return next;
			},
			/**
			* 等当前轮落定：工作流在任务完成后用它避免立刻释放句柄、打断模型收尾。
			*
			*/
			async whenIdle() {
				try {
					return await agent.whenIdle();
				} catch (error) {
					service.ctx?.logger?.warn?.(`buka-workers: could not wait for worker session "${observer.sessionId}" to settle: ${describeError$2(error)}`);
				}
			},
			/**
			* 读当前 live agent 的 plan 模式状态：从会话日志的 `plan/mode` 事件折叠，
			* 读不到时按未激活处理。工作流观察者用它判断一个 plan 节点结束一轮时
			* 是否仍停在计划阶段。
			*
			*/
			getPlanMode() {
				const session = agent?.session;
				if (session === void 0 || session === null) return null;
				try {
					return { active: readPlanModeActive(session) };
				} catch (error) {
					service.ctx?.logger?.warn?.(`buka-workers: could not read plan mode for session "${observer.sessionId}": ${describeError$2(error)}`);
					return null;
				}
			},
			/**
			* 尽力进入 / 退出当前 live agent 的 plan 模式。工作流在节点结束时清除
			* 自己进入的 plan 模式：只有日志显示仍在 plan 模式时才发 `/plan off`；
			* 命令失败只记日志，不改变节点结果。
			*
			*/
			setPlanMode(active) {
				const commands = service.#commandsService();
				if (commands === void 0) return;
				if (active !== true && !readPlanModeActive(agent?.session)) return;
				const line = active === true ? "/plan" : "/plan off";
				const warn = (error) => {
					service.ctx?.logger?.warn?.(`buka-workers: could not ${active === true ? "enter" : "leave"} plan mode for worker session "${observer.sessionId}": ${describeError$2(error)}`);
				};
				try {
					const pending = commands.execute(agent, line, [], new AbortController().signal);
					Promise.resolve(pending).catch(warn);
				} catch (error) {
					warn(error);
				}
			},
			/**
			* 取消当前轮；等它落定后把已经写下的文本读回来。
			*
			*/
			async cancel(reason) {
				try {
					agent.cancel({
						kind: "hook",
						reason: typeof reason === "string" && reason !== "" ? reason : "worker session cancelled"
					}, { keepInbox: true });
				} catch {}
				await waitForSettle(agent);
				return observer.readResult();
			},
			dispose
		};
		return observer;
	}
	/**
	* 释放一次 dispatch / 续接对应的 live agent，并把这个仍然持久化的会话补通告
	* 回客户端。会话日志由 DSH 保存，释放 agent 只影响这一轮的内存占用。
	*
	* `#assertVisibleAgent` 拒绝隐藏 subagent 时走的是普通 `disposeHandle`：
	* 那类会话本来就不该出现在侧边栏。
	*
	*/
	async #releaseAgent(handle, sessionId) {
		await disposeHandle(handle);
		await this.#announceDurableSession(sessionId);
	}
	/**
	* 把刚释放 agent 的执行者会话重新通告给客户端（`api-session/added`）。
	*
	* DSH 在 `session/disposed` 时会向客户端发 `api-session/removed`，而执行者
	* 会话的 agent 是每个节点结束就释放的：只发 removed 的话，会话会从侧边栏
	* 消失，运行页「打开会话」也会因为客户端列表里没有这个 id 而报
	* `sessions.retain: unknown session`。会话本身还在磁盘上，所以这里用宿主
	* `sessionController.list()` 取回它（此时是冷会话的 summary）并补发一次
	* `api-session/added`，客户端就把它当作普通历史会话保留下来。
	*
	* 通告只是可读性补偿：服务缺失（headless 组合）、列表读取失败、事件参数
	* 不可序列化时都只记日志，绝不影响节点结果。
	*
	*/
	async #announceDurableSession(sessionId) {
		const id = typeof sessionId === "string" ? sessionId.trim() : "";
		if (id === "") return;
		const ctx = this.ctx;
		if (ctx === null || ctx === void 0 || typeof ctx.emit !== "function") return;
		const controller = optionalService(ctx, "sessionController");
		if (controller === null || controller === void 0 || typeof controller.list !== "function") return;
		let summary;
		try {
			const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ANNOUNCE_SESSION_TIMEOUT_MS) : new AbortController().signal;
			const result = await controller.list({}, signal);
			summary = (Array.isArray(result?.items) ? result.items : []).find((item) => item?.sessionId === id);
		} catch (error) {
			ctx.logger?.warn?.(`buka-workers: could not read the session list while re-announcing worker session "${id}": ${describeError$2(error)}`);
			return;
		}
		if (summary === void 0) return;
		try {
			ctx.emit("api-session/added", summary);
		} catch (error) {
			ctx.logger?.warn?.(`buka-workers: could not re-announce worker session "${id}" after releasing its agent: ${describeError$2(error)}`);
		}
	}
	/**
	* 把执行者会话挂到执行者自己的工作区。会话 header 的 `cwd` 必须等于工作区
	* 路径（DSH 的 attach 会校验），执行者目录正好满足。
	*
	* 挂不上（例如执行者还没挂载成工作区）不算致命错误：会话仍能通过 runId /
	* 页面打开，只是不会出现在侧边栏。
	*
	*/
	async #attachSessionToWorkspace(sessionId, worker) {
		const registry = this.ctx?.get?.("workspaceRegistry") ?? this.ctx?.workspaceRegistry;
		if (registry === void 0 || registry === null) return;
		try {
			let workspace;
			if (typeof registry.resolveByPath === "function") workspace = await registry.resolveByPath(worker.path);
			if (workspace === void 0 || workspace === null) {
				if (typeof registry.list === "function") {
					const list = registry.list();
					workspace = Array.isArray(list) ? list.find((entry) => entry?.path === worker.path) : void 0;
				}
			}
			if (workspace !== void 0 && workspace !== null && typeof workspace.attachSession === "function") await workspace.attachSession(sessionId);
		} catch (error) {
			this.ctx?.logger?.warn?.(`buka-workers: could not attach worker session "${sessionId}" to the worker workspace: ${describeError$2(error)}`);
		}
	}
	/**
	* 按标识符解析执行者并在登记表 / 磁盘上确认。
	*
	* 请求里的 `worker` 字段是执行者标识符；展示名不参与解析——名称可以随时改、
	* 也不要求唯一，把它当引用键会把会话派给错的人。机器人没有目录、也不建会话：
	* 它们由工作流按 `program` 驱动，这里直接拒绝，让调用方知道该走 program 路径。
	*
	*/
	async #resolveWorker(workerRef) {
		const trimmed = typeof workerRef === "string" ? workerRef.trim() : "";
		if (trimmed === "") throw new Error(`invalid worker identifier: ${String(workerRef)}`);
		const registry = await readWorkerRegistry({ file: this.registryFile });
		if (!registry.corrupt) {
			const worker = registry.workers.find((entry) => entry.id === trimmed);
			if (worker !== void 0) {
				if (worker.driver === "robot") throw new Error(`worker "${worker.id}" is a robot and has no session; drive it by its "program" id instead of dispatching a session`);
				let stat;
				try {
					stat = await promises.stat(worker.path);
				} catch {
					stat = void 0;
				}
				if (stat === void 0 || !stat.isDirectory()) throw new Error(`worker directory does not exist: ${worker.path}`);
				return {
					id: worker.id,
					name: workerDisplayName(worker),
					path: worker.path,
					model: worker.model ?? null
				};
			}
		}
		if (registry.corrupt) throw new Error(`worker registry is unreadable: ${this.registryFile}`);
		if (!isResolvableWorkerId(trimmed)) throw new Error(`invalid worker identifier: ${String(workerRef)}`);
		throw new Error(`unknown worker: ${trimmed}`);
	}
	/**
	* 一个执行者新会话的模型路由：配置了模型就用配置，否则回落到宿主默认。
	*
	*/
	#workerAgentOptions(worker) {
		if (worker.model === null || worker.model === void 0) return this.#defaultAgentOptions();
		return {
			provider: worker.model.provider,
			model: worker.model.model,
			...worker.model.reasoningEffort === void 0 ? {} : { reasoningEffort: worker.model.reasoningEffort }
		};
	}
	/**
	* 默认模型路由：来自宿主默认模型选择。
	*
	*/
	#defaultAgentOptions() {
		const selection = optionalService(this.ctx, "agentDefaultModel")?.currentSelection?.();
		if (selection === void 0 || selection === null) return {};
		return {
			...typeof selection.provider === "string" ? { provider: selection.provider } : {},
			...typeof selection.model === "string" ? { model: selection.model } : {},
			...typeof selection.reasoningEffort === "string" ? { reasoningEffort: selection.reasoningEffort } : {}
		};
	}
};
// .build/workflows/workers/build-tool.js
/**
* `buka_worker_build` 工具的定义与执行包装。
*
* 放在独立模块里，`defineTool` 与真正的构建函数都由入口注入（与 `service.js`
* 一致），这样工具的参数 / 结果映射可以脱离 DSH 运行时用假 `defineTool` 单测；
* 可见性判定与登记表串行队列留在 `index.js`，那里才知道 `sessions` /
* `agentPresets` 服务与队列。
*
* 工具只对「执行者」preset 的根会话可见（由入口的 `when` 与
* `assertAccess` 保证）；页面上的新建 / 配置流程不受影响。
*
* @module @buka/dsh-plugin-workflows/workers/build-tool
*/
/** 工具名；入口注册与日志都用它。 */
const WORKER_BUILD_TOOL_NAME = "buka_worker_build";
/**
* 构造 `buka_worker_build` 工具。
*
*/
function createWorkerBuildTool({ defineTool, avatarIds, runBuild, assertAccess } = {}) {
	if (typeof defineTool !== "function") throw new TypeError("createWorkerBuildTool: defineTool is required");
	if (typeof runBuild !== "function") throw new TypeError("createWorkerBuildTool: runBuild is required");
	if (typeof assertAccess !== "function") throw new TypeError("createWorkerBuildTool: assertAccess is required");
	const avatars = Array.isArray(avatarIds) && avatarIds.length > 0 ? avatarIds.join(", ") : "";
	return defineTool({
		name: WORKER_BUILD_TOOL_NAME,
		description: `Create or update one worker of the Buka Workers page and mount it as a DSH workspace. A worker has an immutable identifier (id) and an optional display name. The id is the reference key used by workflows and the directory name: the plugin creates workers/<id> (default ~/.cache/dsh-plugin-workers/workers/<id>), whose AGENTS.md tells every session in it who the worker is and how it works. The display name is only shown in the UI and can be changed at any time; when it is empty the id is shown. Use this only in the Workflow preset, after understanding what the user wants the worker to do and after showing them the proposed id, display name, avatar, description and AGENTS.md and getting their approval. Call buka_workers first so you do not duplicate an existing worker. The tool creates the directory, registers the worker, writes the provided AGENTS.md (the plugin template is used when agents is omitted on create), keeps the CLAUDE.md link, and mounts the worker as a workspace. An existing id is rejected unless update: true is passed; pass it only when the user asked to change that worker, and omit the fields that should stay unchanged. To change the display name, pass the same id together with the new name and update: true — this does not move the directory or re-register the workspace, and earlier conversations stay listed under the worker. The id itself can never be changed. Installing project-level skills is a page action (Workers page → the worker → 技能) and is not done by this tool; recommend sources instead. Each worker also needs a one-sentence description: it is what a workflow orchestrator reads to decide whether to delegate a node to that worker (like a skill description). Avatar ids: ${avatars}. Workers created here are agents.`,
		parameters: {
			id: {
				type: "string",
				required: true,
				description: "Immutable worker identifier. New ids must match ^[a-z][a-z0-9_-]{0,63}$ (lowercase letters, digits, \"_\" and \"-\", starting with a letter). It becomes the directory workers/<id> and the reference key used by workflows; it cannot be changed after creation. Pass the current id to update an existing worker."
			},
			name: {
				type: "string",
				description: "Optional display name (a single line of at most 64 characters); it is only shown in the UI, need not be unique, and can be changed later. Empty means no display name, so the id is shown. On update, omit it to keep the current name, or pass an empty string to clear it."
			},
			avatar: {
				type: "string",
				description: "Optional avatar id from the list in the description. Omit to let the plugin pick one that is not used yet."
			},
			description: {
				type: "string",
				required: true,
				description: "One sentence describing what this worker does and when to use it; a workflow orchestrator reads it to pick workers for nodes. Empty string keeps the current description when update: true (and leaves it empty on create)."
			},
			agents: {
				type: "string",
				description: "Complete AGENTS.md markdown (role, inputs, workflow, output format, boundaries). Omit on create to keep the plugin template; omit on update to keep the current file."
			},
			update: {
				type: "boolean",
				description: "Set true only when the user asked to change a worker that already exists (including changing its display name). Without it, an existing id is rejected."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true,
						description: "Immutable worker identifier."
					},
					name: {
						type: "string",
						required: true,
						description: "Display name; empty when none is set (the id is shown instead)."
					},
					path: {
						type: "string",
						required: true,
						description: "Absolute worker directory."
					},
					avatar: {
						type: "string",
						required: true,
						description: "Avatar id stored for the worker."
					},
					description: {
						type: "string",
						required: true,
						description: "One-sentence description stored for the worker; empty when none was set."
					},
					created: {
						type: "boolean",
						required: true,
						description: "Whether this call created the worker."
					},
					updated: {
						type: "boolean",
						required: true,
						description: "Whether this call changed an existing worker."
					},
					renamed: {
						type: "boolean",
						required: true,
						description: "Whether this call changed the display name of an existing worker. The directory and workspace registration are unchanged."
					},
					previousName: {
						required: true,
						description: "Display name before this call when it changed the display name, otherwise null.",
						oneOf: [{ type: "string" }, { type: "null" }]
					},
					agentsBytes: {
						type: "number",
						required: true,
						description: "Bytes of AGENTS.md written by this call; 0 when the file was left untouched."
					},
					mounted: {
						type: "boolean",
						required: true,
						description: "Whether a DSH workspace is now mounted at the worker directory."
					},
					workspaceId: {
						required: true,
						description: "Mounted workspace id, or null when the worker is not mounted.",
						oneOf: [{ type: "string" }, { type: "null" }]
					},
					mountError: {
						required: true,
						description: "Why mounting failed, or null when the worker is mounted.",
						oneOf: [{ type: "string" }, { type: "null" }]
					}
				}
			},
			render: (_args, value) => {
				const id = String(value?.id ?? "");
				const name = typeof value?.name === "string" ? value.name : "";
				const display = name === "" ? id : name;
				const identity = name === "" ? id : `${name} (${id})`;
				const previousName = typeof value?.previousName === "string" && value.previousName !== "" ? value.previousName : null;
				const renamed = value?.renamed === true && previousName !== null;
				const action = value?.created === true ? "Created worker" : renamed ? `Renamed worker: ${previousName === "" ? display : previousName} → ${display}` : value?.updated === true ? "Updated worker" : "Worker ready";
				const description = String(value?.description ?? "");
				const lines = [renamed ? `${action} (id ${id}) · ${String(value?.path ?? "")} · avatar ${String(value?.avatar ?? "")}` : `${action}: ${identity} (${String(value?.path ?? "")}) · avatar ${String(value?.avatar ?? "")}`, `Description: ${description === "" ? "(none)" : description}`];
				if (renamed) lines.push("Only the display name changed: the directory and the workspace registration were kept.");
				if (typeof value?.agentsBytes === "number" && value.agentsBytes > 0) lines.push(`AGENTS.md written: ${value.agentsBytes} bytes.`);
				if (value?.mounted === true) {
					const workspaceId = typeof value?.workspaceId === "string" ? ` ${value.workspaceId}` : "";
					lines.push(`Mounted as a workspace${workspaceId}.`);
				} else lines.push(`Not mounted: ${String(value?.mountError ?? "unknown error")}. The user can mount it from the Workers page.`);
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		async execute(args, exec) {
			assertAccess(exec?.agent);
			const result = await runBuild(args ?? {});
			return {
				id: result.worker.id,
				name: result.worker.name,
				path: result.worker.path,
				avatar: result.worker.avatar,
				description: result.worker.description,
				created: result.created,
				updated: result.updated,
				renamed: result.renamed === true,
				previousName: typeof result.previousName === "string" ? result.previousName : null,
				agentsBytes: result.agentsBytes,
				mounted: result.mounted,
				workspaceId: typeof result.workspaceId === "string" ? result.workspaceId : null,
				mountError: result.mountError
			};
		}
	});
}
// .build/workflows/workers/list-tool.js
/**
* `buka_workers` 工具的定义与执行包装。
*
* 只读工具，列出插件登记表里的执行者：标识符、展示名、目录、一句职责、挂载
* 状态、AGENTS.md 是否存在，以及项目级 skills 清单。
*
* 执行者有不可变标识符 `id`（工作流的引用键、目录名）和可选展示名 `name`
* （空串表示未设置，展示时回退到 `id`）。输出两个字段都给；文本摘要用
* 「展示名（id）」帮调用方消歧。
*
* 技能清单对所有能拿到该工具的调用方可见：合并包只发布一个 `Workflow` 预设，
* 它同时承担建执行者与排流程，「定岗只看一句职责、技能清单只用于推荐」的
* 纪律由该预设的 persona 约束，不再在工具层隐藏。
*
* 与 `build-tool.js` 一致，`defineTool` 与 `listWorkers` 由入口注入，工具定义
* 可以脱离 DSH 运行时用假实现单测。
*
* @module @buka/dsh-plugin-workflows/workers/list-tool
*/
/** 工具名；入口注册与文档都用它。 */
const WORKERS_LIST_TOOL_NAME = "buka_workers";
/**
* 构造 `buka_workers` 工具。
*
*/
function createWorkersListTool({ defineTool, listWorkers, registryFile, workersDir, workspaceRegistry } = {}) {
	if (typeof defineTool !== "function") throw new TypeError("createWorkersListTool: defineTool is required");
	if (typeof listWorkers !== "function") throw new TypeError("createWorkersListTool: listWorkers is required");
	return defineTool({
		name: WORKERS_LIST_TOOL_NAME,
		description: "List the subjects a workflow can delegate a node to: agents created by the Buka Workers page and the built-in robots (v1: clock). Each worker has an immutable identifier (id) and an optional display name (name); the id is the reference key used by workflows and the directory name, while the name is only shown in the UI and falls back to the id when empty. An agent is a directory the plugin created under its own cache directory (default ~/.cache/dsh-plugin-workers/workers/<id>) and registered in workers.json, then mounted as a DSH workspace; a robot is a fixed program with no directory and no session. This is NOT the list of all DSH workspaces: only workers registered by the plugin appear. Each worker reports its id, display name, driver (agent or robot), whether it is currently mounted, its one-sentence responsibility statement (what a workflow orchestrator reads to decide which worker should run a node), its project-level skills and whether it has an AGENTS.md. Use this tool when the user asks which workers exist, which are mounted, what a worker is responsible for, what project-level skills it has, or whether it has an AGENTS.md. This tool is read-only: creating, updating or renaming a worker from a chat is available only to the Workflow preset through buka_worker_build; robots (clock) cannot be created or removed. Removing workers, mounting them, installing skills and editing AGENTS.md remain user actions on the Workers page.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					root: {
						type: "string",
						required: true,
						description: "Workers root directory."
					},
					registry: {
						type: "string",
						required: true,
						description: "Absolute path of the plugin workers.json registry."
					},
					corrupt: {
						type: "boolean",
						required: true,
						description: "Whether the registry file is unreadable; workers is then empty."
					},
					workers: {
						type: "array",
						required: true,
						description: "Workers in registry order (newest first).",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true,
									description: "Immutable worker identifier: the reference key and the worker directory name."
								},
								name: {
									type: "string",
									required: true,
									description: "Display name; empty when none is set, in which case the id is shown."
								},
								path: {
									type: "string",
									required: true,
									description: "Absolute worker directory."
								},
								description: {
									type: "string",
									required: true,
									description: "One-sentence description of what the worker does and when to use it; empty when none was set."
								},
								driver: {
									type: "string",
									required: true,
									description: "How the worker runs: \"agent\" is a DSH session with a directory and skills, \"robot\" is a fixed program (no directory, no session; v1 only clock).",
									enum: ["agent", "robot"]
								},
								program: {
									required: true,
									description: "Program id for a robot (for example \"clock\"); empty string for agents.",
									oneOf: [{ type: "string" }, { type: "null" }]
								},
								mounted: {
									type: "boolean",
									required: true,
									description: "Whether a DSH workspace is mounted at this worker directory."
								},
								workspaceId: {
									required: true,
									description: "Mounted DSH workspace id, or null when not mounted.",
									oneOf: [{ type: "string" }, { type: "null" }]
								},
								skills: {
									type: "array",
									description: "Project-level skills installed in the worker directory.",
									items: {
										type: "object",
										additionalProperties: false,
										properties: { name: {
											type: "string",
											required: true,
											description: "Skill name."
										} }
									}
								},
								agentsFile: {
									type: "boolean",
									required: true,
									description: "Whether the worker directory has an AGENTS.md."
								}
							}
						}
					}
				}
			},
			render: (_args, value) => {
				if (value?.corrupt === true) return [{
					type: "text",
					text: `The worker registry is unreadable: ${String(value?.registry ?? "")}. Renew or remove that file, then refresh.`
				}];
				const workers = Array.isArray(value?.workers) ? value.workers : [];
				if (workers.length === 0) return [{
					type: "text",
					text: "No workers have been created yet."
				}];
				return [{
					type: "text",
					text: workers.map((worker) => {
						const id = String(worker.id ?? "");
						const name = typeof worker.name === "string" ? worker.name : "";
						const identity = name === "" ? id : `${name} (${id})`;
						const agents = worker.agentsFile ? "AGENTS.md" : "no AGENTS.md";
						const mounted = worker.mounted ? `mounted as ${String(worker.workspaceId)}` : "not mounted";
						const parts = [`- ${identity} — ${typeof worker.description === "string" && worker.description !== "" ? worker.description : "(no description)"}${typeof worker.path === "string" && worker.path !== "" ? ` (${worker.path})` : ""}`];
						if (worker.driver === "robot") {
							const program = typeof worker.program === "string" && worker.program !== "" ? `: ${worker.program}` : "";
							parts.push(`program${program}`);
						}
						if (Array.isArray(worker.skills)) {
							const count = worker.skills.length;
							parts.push(count === 1 ? "1 skill" : `${count} skills`);
						}
						parts.push(agents, mounted);
						return parts.join(" · ");
					}).join("\n")
				}];
			}
		},
		async execute(_args) {
			const snapshot = await listWorkers({
				file: registryFile,
				workspaceRegistry,
				workersDir
			});
			const workers = snapshot.workers.map((worker) => {
				return {
					id: worker.id,
					name: typeof worker.name === "string" ? worker.name : "",
					path: worker.path,
					description: worker.description ?? "",
					driver: worker.driver === "robot" ? "robot" : "agent",
					program: worker.driver === "robot" && worker.program !== "" ? worker.program : null,
					mounted: worker.mounted,
					workspaceId: worker.workspaceId,
					agentsFile: worker.agents.exists,
					skills: worker.skills.map((skill) => ({ name: skill.name }))
				};
			});
			return {
				root: snapshot.root,
				registry: snapshot.registry,
				corrupt: snapshot.corrupt,
				workers
			};
		}
	});
}
// .build/workflows/workers/tools.js
/**
* 「执行者」页面的模型工具装配。
*
* 注册两个工具：
*
* - 只读的 `buka_workers`：让模型回答「有哪些执行者、挂没挂载、是否写了
*   AGENTS.md、装了什么技能」；
* - 写工具 `buka_worker_build`：按标识符创建 / 修改执行者（改名只改展示名）、
*   写 AGENTS.md 并挂到工作区，但**只对随包发布的 `Workflow` 预设的根会话
*   可见**（Config.builderPresets）。
*
* 可见性判定放在本模块，入口只负责传入 preset 名单与登记表写队列。
*
* @module @buka/dsh-plugin-workflows/workers/tools
*/
/**
* 注册只读列举工具与「执行者」preset 的写工具。
*
*/
function registerWorkerTools(ctx, deps) {
	const { workersDir, registryFile, builderPresets, serializeRegistry } = deps;
	/**
	* 取可见性判定要用的 `sessions` / `agentPresets` 服务。
	*
	* 宿主 `sessions.get` 的参数是品牌类型 `SessionId`，判定只按字符串读会话头，
	* 这里收窄成 `access.ts` 需要的最小形状（运行时不区分品牌类型）。
	*/
	function accessServices() {
		const sessions = ctx.get("sessions");
		const agentPresets = ctx.get("agentPresets");
		return {
			sessions: sessions === void 0 ? void 0 : { get: (id) => sessions.get(id) },
			agentPresets
		};
	}
	/**
	* 判定某个 agent 能否看到 / 调用执行者工具。
	*
	* 走 `sessions` + `agentPresets` 两个服务，与工作流插件同一做法；区别是
	* 写操作在服务缺失时收紧为不可见（见 `lib/access.js`）。
	*
	*/
	function builderAccessOf(agent) {
		const services = accessServices();
		return resolveWorkerBuildAccess({
			allowed: builderPresets,
			agentId: typeof agent?.id === "string" ? agent.id : "",
			sessions: services.sessions,
			agentPresets: services.agentPresets
		});
	}
	/** 工具在每一步的可见性条件。 */
	const builderVisibleWhen = (context) => builderAccessOf(context?.agent).visible;
	/**
	* 调用时兜底再校验一次：即便绕过 `when` 直接调用也要被挡住。
	*
	*/
	function assertWorkerBuilder(agent) {
		const access = builderAccessOf(agent);
		if (access.visible) return access;
		throw new Error(`buka_worker_build is only available to the ${builderPresets.join(" / ")} preset (reason: ${access.reason})`);
	}
	ctx.inject(["tools"], (toolCtx) => {
		toolCtx.tools.register(createWorkersListTool({
			defineTool,
			listWorkers,
			registryFile,
			workersDir,
			workspaceRegistry: ctx.workspaceRegistry
		}));
		const buildTool = createWorkerBuildTool({
			defineTool,
			avatarIds: AVATAR_IDS,
			assertAccess: assertWorkerBuilder,
			runBuild: async (args) => {
				const result = await serializeRegistry(() => buildWorker({
					workersDir,
					file: registryFile,
					id: args?.id,
					name: args?.name,
					avatar: args?.avatar,
					description: args?.description,
					agents: args?.agents,
					update: args?.update,
					workspaceRegistry: ctx.workspaceRegistry
				}));
				ctx.logger?.info?.("buka-workers: %s 执行者 %s（%s，%s）", result.created ? "已创建" : result.renamed ? `已改展示名（原 ${result.previousName ?? ""}）` : "已更新", result.worker.id, result.worker.name, result.worker.path);
				return result;
			}
		});
		toolCtx.tools.register(buildTool, { when: builderVisibleWhen });
	});
}
// .build/workflows/workers/index.js
/**
* 执行者一半的宿主装配：`@buka/dsh-plugin-workflows` 合并包的执行者部分。
*
* 执行者是**插件自己创建并登记**的对象，不是 DSH 的全部工作区：新建
* 执行者时在插件全局目录下的 `workers/` 里按不可变标识符建目录并写进
* `workers.json`，再由浏览器一半把它挂到 DSH 工作区列表。Host 负责所有磁盘
* 操作，提供一组包内 HTTP 路由给页面；执行者一律按 **id**（标识符）寻址，
* `name` 只是可选展示名，改名不移动目录：
*
* | 路由 | 作用 |
* | --- | --- |
* | `GET /buka-workers/list` | 列出登记表里的执行者、挂载状态、skills 与 AGENTS.md |
* | `POST /buka-workers/create` | 按标识符建目录 + AGENTS.md 模板，并把执行者（含可选展示名 / 描述）插到登记表最前 |
* | `POST /buka-workers/avatar` | 只改登记表里的头像 id |
* | `POST /buka-workers/description` | 只改登记表里的一行描述（工作流用它选执行者） |
* | `GET /buka-workers/models` | 读宿主模型目录（按提供方分组，供「模型」页签选择） |
* | `POST /buka-workers/model` | 设置 / 清除智能体新会话使用的模型 |
* | `POST /buka-workers/rename` | 只改展示名 + 同步工作区标题（不移动目录、不重建工作区） |
* | `POST /buka-workers/remove-impact` | 删除影响面：阻塞的运行中作业、受影响的工作流、历史作业数与目录 |
* | `POST /buka-workers/remove` | 硬删登记条目 + 执行者目录 + 工作区注册；有 running 作业引用时 409 |
* | `GET /buka-workers/files` | 只读列出执行者目录树（跳过 `.git` / `node_modules`） |
* | `GET /buka-workers/file` | 只读读取执行者目录里的一个文本文件（`path` 限定在目录内） |
* | `GET /buka-workers/skills/repos` | 读 Skills 插件的「技能仓库」：收藏来源、类型与预计 skill 数 |
* | `POST /buka-workers/skills/available` | 只从已收藏来源里列出可安装的 skills（不再接受手填第三方来源） |
* | `POST /buka-workers/skills/install` | 只安装收藏仓库里选中的 skills，同时落 `.agents/skills` 与 `.claude/skills` |
* | `POST /buka-workers/skills/remove` | 在执行者目录里执行 `npx skills remove <skill> -y` |
* | `POST /buka-workers/skills/check` | 只读检查执行者目录里项目级 skill 的更新状态（进入「技能」页签时自动调用） |
* | `POST /buka-workers/skills/update` | 更新执行者的项目级 skill（可用 `skills` 收窄到某一项） |
* | `POST /buka-workers/skills/update-all` | 列表页「更新全部执行者」：顺序更新所有符合条件的执行者 |
* | `POST /buka-workers/reveal` | 兜底：用系统文件管理器打开执行者目录（页面优先用内核 open-in-app 的应用清单） |
*
* 工作区的注册、删除与打开必须走 DSH 自己的 Client Service（侧边栏才会同步），
* 所以都在浏览器一半，这里不重复实现。另注册两个模型工具：只读的 `buka_workers`
* 让模型回答「有哪些执行者、挂没挂载、是否写了 AGENTS.md、装了什么技能」
* （见 `lib/list-tool.js`）；写工具 `buka_worker_build`（见 `lib/builder.js`、
* `lib/build-tool.js`）按标识符创建 / 修改执行者（改名只改展示名）、写 AGENTS.md
* 并挂到工作区，但**只对随包发布的 `Workflow` 预设的根会话可见**
* （Config.builderPresets，判定见 `lib/access.js`）。删除执行者与安装 skills
* 仍然只留给用户；页面上的「文件」页签只读，不提供编辑 / 保存。
*
* 删除通过可选的 `ctx.bukaWorkflows` 服务读引用面（同一合并包内始终存在；
* 兜底分支仍按服务缺失处理）。唯一阻塞是引用该标识符的运行中作业。
*
* 另通过 `ctx.provide('bukaWorkers', ...)` 对外提供一个 Host Service（见
* `lib/service.js`）：`list()` 列出执行者（每条带 `id` / `name`，以及内建
* 机器人 clock 的 `driver` / `program`），`avatarMap()` 按标识符
* 给出执行者头像，`dispatchSession()` 新开一条会话并返回观测句柄，
* `openSession()` 只续接同一条会话（不压缩）。工作流引擎用它把每个任务交给
* 一个执行者、并在节点图上画出执行者头像。
*
* 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
* （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
*
* 本文件只导出装配函数与配置字段定义；合并后的插件入口
* （`../index.ts`）负责把两份装配拼在一起。
*
* @module @buka/dsh-plugin-workflows/workers
*/
/** 执行者根目录的默认位置：`<插件全局目录>/workers`。 */
const DEFAULT_WORKERS_DIR = defaultWorkersRoot();
/**
* 能看到并调用 `buka_worker_build` 的 preset 名单；默认是随包发布的唯一
* `Workflow` 预设（id `workflow-orchestrator`，同时承担工作流编排）。
*/
const DEFAULT_BUILDER_PRESETS = ["workflow-orchestrator"];
/** 执行者一半的配置字段；合并后的插件入口把它与工作流配置拼成一份 `Config`。 */
const workerConfigFields = {
	workersDir: z.string().default(DEFAULT_WORKERS_DIR).description("执行者根目录：执行者目录建在插件全局目录下；登记文件固定为该目录同级的 workers.json，支持 ~ 前缀。"),
	builderPresets: z.array(z.string()).default(DEFAULT_BUILDER_PRESETS).description("能看到并调用 buka_worker_build（创建 / 修改执行者）的 agent preset 名单。留空表示不按 preset 收窄（所有会话可见，不推荐）；推荐只保留随插件发布的 `workflow-orchestrator`（Workflow）。"),
	seedPresets: z.boolean().default(true).description("全新安装（登记表为空）时是否自动补上「软件工程师」与「质量保障工程师」两个预设执行者；设为 false 则不初始化预设。")
};
/**
* 装配执行者一半：注册服务、HTTP 路由与模型工具。
*
* @param ctx 插件上下文
* @param config 合并插件配置
*/
function applyWorkers(ctx, config) {
	const workersDir = resolveWorkersDir(config?.workersDir);
	const registryFile = resolveWorkerRegistryFile(workersDir);
	ctx.provide(SERVICE_NAME, new WorkerSessionService({
		ctx,
		workersDir,
		registryFile
	}));
	let registryQueue = Promise.resolve();
	function serializeRegistry(work) {
		const run = registryQueue.then(work, work);
		registryQueue = run.then(() => void 0, () => void 0);
		return run;
	}
	serializeRegistry(async () => {
		await migrateWorkerStore({
			workersDir,
			registryFile,
			logger: ctx.logger
		});
		return ensureBuiltinWorkers({ file: registryFile });
	}).then((result) => {
		if (result.corrupt) ctx.logger?.warn?.("buka-workers: 登记文件损坏，跳过内建执行者登记：%s", registryFile);
		else if (result.added.length > 0) ctx.logger?.info?.("buka-workers: 已登记内建执行者：%s", result.added.join("、"));
	}).catch((error) => {
		ctx.logger?.warn?.("buka-workers: 启动迁移或登记内建执行者失败：%s", describeError$1(error));
	});
	seedWorkersOnStartup({
		ctx,
		workersDir,
		registryFile,
		serializeRegistry,
		enabled: config?.seedPresets !== false
	});
	const builderPresets = normalizePresets(config?.builderPresets ?? DEFAULT_BUILDER_PRESETS);
	registerRoutes(ctx, {
		workersDir,
		registryFile,
		serializeRegistry
	});
	registerWorkerTools(ctx, {
		workersDir,
		registryFile,
		builderPresets,
		serializeRegistry
	});
	registerWorkerModelEnforcement(ctx, registryFile);
}
// .build/workflows/index.js
/**
* `@buka/dsh-plugin-workflows` 宿主一半入口：只做装配。
*
* 合并包承载两半能力：
*
* - **执行者**（`workers/`）：插件全局目录下的登记表与目录、AGENTS.md、项目
*   skills、模型选择，`buka_workers` / `buka_worker_build` 两个模型工具，
*   `/buka-workers/*` 页面路由，以及对外服务 `ctx.bukaWorkers`。
* - **工作流**（`assembly.ts`）：持久工作流定义、作业与任务级看板、显式依赖、
*   内建开始 / 结束、人任务与助理，`buka_workflow_*` 工具与 `/job` 命令，
*   `/buka-workflows/*` 页面路由，以及只读服务 `ctx.bukaWorkflows`
*   （`workerUsage(id)` 供删除执行者算引用面）。
*
* 两半只在服务层互连：工作流引擎经 `ctx.get('bukaWorkers')` 读登记表与开
* 执行者会话，执行者删除路由经 `ctx.get('bukaWorkflows')` 算影响面。合并后
* 两者始终存在，原有「服务缺失」兜底分支保留（零行为变化）。随包发布唯一
* 编排预设 `workflow-orchestrator`（显示名 `Workflow`），写工具与定义工具都
* 只对该预设的根会话可见（分别由 `builderPresets` / `orchestratorPresets`
* 配置，默认同一名单）。
*
* @module @buka/dsh-plugin-workflows
*/
/** Cordis 插件名；与 cordis.patch.yml 的补丁行 id 保持一致。 */
const name = "tool-buka-workflows";
/** 依赖的服务：工具注册表与工作区注册（判断执行者是否已挂到 DSH 工作区）。其余服务按需可选获取。 */
const inject = ["tools", "workspaceRegistry"];
/** 合并后的插件配置：执行者字段 + 工作流字段。 */
const Config = z.object({
	...workflowConfigFields,
	...workerConfigFields
});
/**
* 装配合并插件：先执行者一半，再工作流一半。
*
* @param ctx 插件上下文
* @param config 插件配置
*/
function apply(ctx, config) {
	applyWorkers(ctx, config);
	applyWorkflows(ctx, config);
}
export { Config, apply, defaultDataDir, inject, name, resolveDataDir };
