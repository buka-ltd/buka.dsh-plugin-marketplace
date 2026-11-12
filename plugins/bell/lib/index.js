import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// .build/bell/sounds.js
/**
* 提示音的可选清单与「怎么播」：纯数据加纯函数，不碰 DSH 上下文。
* 候选表、各平台播放命令、试听路由的路径与声音名校验都在这里。
*
* 单独成文件是为了能被单测直接导入：本文件零依赖，测试不需要构造 DSH 上下文。
*
* @module @buka/dsh-plugin-bell/sounds
*/
/**
* 「无」选项的哨兵值：设置页下拉框里的「无」写入这个值，表示该时机不播放。
* 它不是系统声音名，因此不会出现在 `SYSTEM_SOUNDS` 里。
*/
const SILENT = "none";
/** 设置页试听路由：Host 注册它、浏览器一半按同一字符串请求。 */
const PREVIEW_ROUTE = "/buka-bell/preview";
/**
* macOS 系统自带提示音清单；设置页下拉框的可选项与这里保持一致。
* 文件位置固定为 `/System/Library/Sounds/<name>.aiff`。
*/
const SYSTEM_SOUNDS = [
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
/**
* 插件自带的音频候选：配置值 → 相对包根的路径。
*
* 设置页下拉框里它排在系统声音之前，值写进 volatile 配置。文件随包发布
* （`package.json` 的 `files`），所以路径按 `import.meta.url` 定位。
* `ikun` 是网络二创梗语音片段，版权与使用范围见 README 的「素材版权」。
*/
const CUSTOM_SOUNDS = { ikun: "assets/voice.mp3" };
/** 四个时机的默认选择；`plan` 默认静音，`abort` 用插件自带的梗语音。 */
const DEFAULT_SOUND = {
	finish: "Basso",
	wait: "Submarine",
	plan: SILENT,
	abort: "ikun"
};
/** 提示音种类；顺序与设置页下拉框一致。 */
const CUES = [
	"finish",
	"wait",
	"plan",
	"abort"
];
/**
* 把 `CUSTOM_SOUNDS` 里的相对路径解析成插件包里的绝对路径。
* 打包后本文件位于 `lib/`，上一级就是包根，所以 `../assets/...` 仍然成立。
*/
function assetPath(relative) {
	return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}
/** 播放自带音频文件的候选命令；平台没有播放器时启动失败、静音。 */
const FILE_PLAYERS = {
	darwin: (file) => [["afplay", [file]]],
	win32: (file) => [["ffplay", [
		"-nodisp",
		"-autoexit",
		"-loglevel",
		"quiet",
		file
	]], ["mpv", [
		"--no-video",
		"--really-quiet",
		file
	]]],
	linux: (file) => [
		["paplay", [file]],
		["ffplay", [
			"-nodisp",
			"-autoexit",
			"-loglevel",
			"quiet",
			file
		]],
		["mpv", [
			"--no-video",
			"--really-quiet",
			file
		]]
	]
};
/**
* 非 macOS 平台的默认播放命令，按数组顺序尝试，前一个无法启动时换下一个。
* 设置里的 macOS 声音名在这些平台不可用，回退到这里的平台默认声音；
* 默认静音的种类（`none`）在任何平台都不会播放。
*/
const PLATFORM_COMMANDS = {
	win32: {
		finish: [["powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[System.Media.SystemSounds]::Exclamation.Play()"
		]]],
		wait: [["powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[System.Media.SystemSounds]::Asterisk.Play()"
		]]],
		plan: [["powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[System.Media.SystemSounds]::Question.Play()"
		]]],
		abort: [["powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[System.Media.SystemSounds]::Hand.Play()"
		]]]
	},
	linux: {
		finish: [
			["paplay", ["/usr/share/sounds/freedesktop/stereo/complete.oga"]],
			["canberra-gtk-play", ["-i", "complete"]],
			["aplay", ["/usr/share/sounds/alsa/Front_Center.wav"]]
		],
		wait: [
			["paplay", ["/usr/share/sounds/freedesktop/stereo/message.oga"]],
			["canberra-gtk-play", ["-i", "message"]],
			["aplay", ["/usr/share/sounds/alsa/Front_Center.wav"]]
		],
		plan: [
			["paplay", ["/usr/share/sounds/freedesktop/stereo/dialog-information.oga"]],
			["canberra-gtk-play", ["-i", "dialog-information"]],
			["aplay", ["/usr/share/sounds/alsa/Front_Center.wav"]]
		],
		abort: [
			["paplay", ["/usr/share/sounds/freedesktop/stereo/dialog-warning.oga"]],
			["canberra-gtk-play", ["-i", "dialog-warning"]],
			["aplay", ["/usr/share/sounds/alsa/Front_Center.wav"]]
		]
	}
};
/** 当前平台对应的播放器表；未知平台按 Linux 处理。 */
function filePlayers() {
	const platform = process.platform;
	if (platform === "darwin" || platform === "win32" || platform === "linux") return FILE_PLAYERS[platform];
	return FILE_PLAYERS.linux;
}
/**
* 读一个提示音当前选中的声音名。配置里是 volatile 引用，值要经 `.get()` 读；
* 单测直接注入字符串时也兼容。读不到时回退默认值。
*/
function selectedSound(config, cue) {
	const field = config?.[cue];
	if (field === void 0) return DEFAULT_SOUND[cue];
	if (typeof field === "string") return field === "" ? DEFAULT_SOUND[cue] : field;
	try {
		const value = field.get();
		if (typeof value === "string" && value !== "") return value;
	} catch {}
	return DEFAULT_SOUND[cue];
}
/** 自带音频的播放命令：按平台给文件播放器，环境里没有播放器时启动失败、静音。 */
function fileCommands(relative) {
	return filePlayers()(assetPath(relative));
}
/** 自带音频的名字，用于判断「选中值是不是插件自带音频」。 */
function customSound(sound) {
	return Object.hasOwn(CUSTOM_SOUNDS, sound) ? CUSTOM_SOUNDS[sound] : void 0;
}
/**
* 一种提示音的候选播放命令；选中「无」时没有候选。
*
* 自带音频优先：它不在 macOS 系统声音表里，任何平台都交给文件播放器。
* 系统声音在 macOS 上按名字播放 `/System/Library/Sounds/<name>.aiff`，名字不认识时
* 退回该时机的默认声音（默认音是自带音频时同样走文件播放器，默认静音的种类没有退路）；
* Windows / Linux 上没有系统声音表，用平台默认音。
*/
function commandFor(cue, sound) {
	if (sound === "none") return [];
	const custom = customSound(sound);
	if (custom !== void 0) return fileCommands(custom);
	if (process.platform === "darwin") {
		const name = SYSTEM_SOUNDS.includes(sound) ? sound : DEFAULT_SOUND[cue];
		if (name === "none") return [];
		const fallbackFile = customSound(name);
		if (fallbackFile !== void 0) return fileCommands(fallbackFile);
		return [["afplay", [`/System/Library/Sounds/${name}.aiff`]]];
	}
	const platform = process.platform;
	if (platform === "win32" || platform === "linux") {
		const commands = PLATFORM_COMMANDS[platform][cue];
		if (commands.length > 0) return commands;
	}
	return PLATFORM_COMMANDS.linux[cue];
}
/**
* 这个声音名能不能播放：自带音频的键，或 macOS 系统声音名。
*
* 试听路由用它挡住任意字符串：浏览器一半发什么就播什么是注入面。用
* `Object.hasOwn` 而不是 `in`，否则 `toString` 之类的原型链键会被当成候选。
*/
function isPlayableSound(sound) {
	if (typeof sound !== "string" || sound === "none") return false;
	return Object.hasOwn(CUSTOM_SOUNDS, sound) || SYSTEM_SOUNDS.includes(sound);
}
// .build/bell/player.js
/**
* 提示音的播放：spawn 宿主系统的声音工具，失败只记一次警告。
*
* @module @buka/dsh-plugin-bell/player
*/
/** 同类提示音的节流门：返回 true 表示这次可以响。 */
function createGate(cooldownMs) {
	let last = 0;
	return () => {
		const now = Date.now();
		if (now - last < cooldownMs) return false;
		last = now;
		return true;
	};
}
/**
* 生成播放器。提示音失败不能影响任务本身，所以每一步失败都只记一次警告。
*/
function createPlayer(ctx) {
	const warned = /* @__PURE__ */ new Set();
	function warnUnavailable(cue) {
		if (warned.has(cue)) return;
		warned.add(cue);
		try {
			ctx.logger.warn("buka-bell: no sound player is available for the %s cue; that moment will be silent", cue);
		} catch {}
	}
	return (cue, sound) => {
		const candidates = commandFor(cue, sound);
		if (candidates.length === 0) return;
		let index = 0;
		const attempt = () => {
			const candidate = candidates[index];
			if (candidate === void 0) {
				warnUnavailable(cue);
				return;
			}
			index += 1;
			const [command, args] = candidate;
			let child;
			try {
				child = spawn(command, [...args], {
					stdio: "ignore",
					detached: true,
					windowsHide: true
				});
			} catch {
				attempt();
				return;
			}
			child.once("error", attempt);
			child.unref();
		};
		attempt();
	};
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
/** 405，并带上这个路由支持的方法。 */
function sendMethodNotAllowed(res, allow) {
	res.statusCode = 405;
	res.setHeader("allow", allow);
	res.end();
}
process.platform;
// .build/bell/routes.js
/**
* 试听路由的注册：`POST /buka-bell/preview` 的信任栅栏与请求体解析。
*
* @module @buka/dsh-plugin-bell/routes
*/
/** 试听请求体只有 `{ sound }`；超过这个大小按恶意请求处理。 */
const MAX_PREVIEW_BODY_BYTES = 4096;
/**
* 注册四个提示音的试听路由。
*/
function registerPreviewRoutes(ctx, play) {
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
			path: PREVIEW_ROUTE,
			handler: async (req, res) => {
				if (rejected(req, res)) return;
				if (req.method !== "POST") {
					sendMethodNotAllowed(res, "POST");
					return;
				}
				const body = await readJsonBody(req, res, MAX_PREVIEW_BODY_BYTES);
				if (body === void 0) return;
				const sound = body?.sound;
				if (!isPlayableSound(sound)) {
					sendJson(res, 400, {
						ok: false,
						code: "unknown-sound",
						message: "unknown sound"
					});
					return;
				}
				play("finish", sound);
				sendJson(res, 200, { ok: true });
			}
		}), `buka-bell: POST ${PREVIEW_ROUTE}`);
	});
}
/**
* 读取并解析试听请求体。
*
* 失败时（content-type 不对、超过大小上限、不是合法 JSON）已经写好响应，
* 返回 `undefined` 让调用方直接返回。
*/
async function readJsonBody(req, res, maxBytes) {
	if (contentTypeOf(req) !== "application/json") {
		sendJson(res, 415, {
			ok: false,
			message: "content-type 必须是 application/json"
		});
		return;
	}
	const text = await readBoundedBody(req, maxBytes);
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
// .build/bell/watch.js
/**
* 四个提示时机的监听与判定状态机：只旁听 DSH 的生命周期事件，
* 按「运行时顶层 Agent 从 running 变回 idle」这一条主线决定该响哪一种提示音。
*
* 四个提示时机都来自 DSH 自己的生命周期，不轮询、不改会话日志：
*
* - 完成音：顶层 Agent（会话头不带 `origin: 'subagent'` 的 Agent）从
*   `running` 变回 `idle`，说明这一轮任务真正结束；子 Agent 也发
*   `agent/status`，所以必须按会话头的 subagent 标记过滤，否则每次工具子任务
*   结束都会响。用户手动终止不算任务结束：GUI 的终止按钮走 `session/cancel` →
*   `agent.cancel({ kind: 'user' })`，这一轮会以 `turn/end` 的
*   `reason.kind === 'aborted'` 收尾，随后才是 `agent/status` idle。
*   完成音监听会话日志里的 `turn/end` 记住最近一轮的结束原因，aborted 时
*   改由手动终止音处理（默认播放插件自带的「你干嘛~哎哟」）。
* - 等待音：`user-questions/request`（`ask_user_question`、plan review）
*   与 `approval/request`（审批）这两个 waterfall 事件，都是 DSH 正在
*   等用户回复时才会派发。监听器只旁听，必须调用 `next()` 把决定交给
*   真正的 answerer（Web UI / 自动审批），不能截胡。
* - 计划被退回音：plan review 卡片里点「要求修改」不会回答批准/拒绝选项，
*   而是由 Web UI 以 `ASK_CANCELLED` 取消这次提问；`dsh-plan-mode` 收到
*   取消后调用 `concludeTurn()`，这一轮随即以 `turn/end` `completed` 收尾。
*   插件在旁听 `user-questions/request` 时接住 `next()` 的拒绝结果，看到
*   `ASK_CANCELLED` 且请求带 `plan-review` 意图，就记下这个会话；等 idle
*   时改播计划被退回音，而不是当成任务完成的完成音。
* - 手动终止音：只在 `turn/end` 原因为 `aborted` 且取消来源是 `user`
*   （用户点终止按钮/停止快捷键）时播放。会话归档、父级取消、插件卸载
*   同样以 aborted 收尾，但它们不是用户手动停止，保持静音。
*
* @module @buka/dsh-plugin-bell/watch
*/
/** 同类提示音的最小间隔，避免多个会话同时结束时响成一片。 */
const COOLDOWN_MS = 500;
/**
* 判断 Agent 是不是运行时顶层会话；子 Agent（subagent）也发 `agent/status`，
* 但不应该触发完成音。
*
* 不用 `ctx.agents.roots()`：DSH 0.2.2-rc.2 已移除这个方法（运行时归属信息
* 不再对外暴露），在 rc.2 上调用会抛 `roots is not a function`。改看会话头的
* `origin`：subagent 子会话标为 `'subagent'`，普通会话与被恢复的 fork 不写
* 这个字段，仍是用户自己的顶层会话。
*/
function isRootAgent(agent) {
	try {
		return agent.session?.header?.origin !== "subagent";
	} catch {
		return false;
	}
}
/**
* 这个提问是不是 plan review：`dsh-plan-mode` 会在 `exit_plan_mode` 的提问上
* 设置 `intent.kind === 'plan-review'`，并带上待审的计划全文。
*/
function isPlanReview(request) {
	const questions = request?.questions;
	if (!Array.isArray(questions)) return false;
	return questions.some((question) => {
		return (question?.intent)?.kind === "plan-review";
	});
}
/**
* 读取提问被取消/失败时带回来的错误码。跨进程传输后可能是 Error，也可能是
* `{ name, code, message }` 形状的普通对象。
*/
function rejectionCode(error) {
	if (typeof error === "string") return error;
	if (error !== null && typeof error === "object") {
		const code = error.code;
		if (typeof code === "string") return code;
	}
}
/**
* 注册四个提示音的监听。
*/
function watch(ctx, config, play) {
	const running = /* @__PURE__ */ new Set();
	for (const agent of ctx.agents.list()) if (isRootAgent(agent) && agent.status === "running") running.add(agent.id);
	const gates = new Map(CUES.map((cue) => [cue, createGate(COOLDOWN_MS)]));
	/** 按当前配置播放一种提示音；选「无」时不响，也不占用节流门。 */
	function ring(cue) {
		const sound = selectedSound(config, cue);
		if (sound === "none") return;
		const gate = gates.get(cue);
		if (gate === void 0 || !gate()) return;
		play(cue, sound);
	}
	const lastTurnEnd = /* @__PURE__ */ new Map();
	const planRevise = /* @__PURE__ */ new Set();
	ctx.on("session/event", (session, event) => {
		if (event.type === "turn/start") {
			planRevise.delete(session.id);
			return;
		}
		if (event.type !== "turn/end") return;
		lastTurnEnd.set(session.id, event.data?.reason);
	});
	ctx.on("agent/status", ({ agent, status }) => {
		if (status === "running") {
			running.add(agent.id);
			return;
		}
		const reason = lastTurnEnd.get(agent.id);
		lastTurnEnd.delete(agent.id);
		const planReviseTurn = planRevise.delete(agent.id);
		if (!running.delete(agent.id)) return;
		if (!isRootAgent(agent)) return;
		if (reason?.kind === "aborted") {
			if (reason.reason?.kind !== "user") return;
			ring("abort");
			return;
		}
		if (planReviseTurn && reason?.kind === "completed") {
			ring("plan");
			return;
		}
		ring("finish");
	});
	ctx.on("agent/disposed", ({ agent }) => {
		running.delete(agent.id);
		lastTurnEnd.delete(agent.id);
		planRevise.delete(agent.id);
	});
	ctx.on("user-questions/request", (request, next) => {
		ring("wait");
		const answer = next();
		if (isPlanReview(request) && answer !== null && typeof answer?.then === "function") answer.then?.(void 0, (error) => {
			try {
				if (rejectionCode(error) !== "ASK_CANCELLED") return;
				const sessionId = request?.agent?.id;
				if (typeof sessionId === "string") planRevise.add(sessionId);
			} catch {}
		});
		return answer;
	}, { prepend: true });
	ctx.on("approval/request", (_request, next) => {
		ring("wait");
		return next();
	}, { prepend: true });
}
// .build/bell/index.js
/**
* 任务结束 / 等待用户操作 / 计划被退回 / 手动终止时播放系统提示音。
*
* 四个提示时机都来自 DSH 自己的生命周期，不轮询、不改会话日志：
*
* - 完成音：顶层 Agent（会话头不带 `origin: 'subagent'`）从 `running` 变回
*   `idle`，说明这一轮任务真正结束；子 Agent 也发 `agent/status`，所以必须按
*   会话头的 subagent 标记过滤，否则每次工具子任务结束都会响。
*   用户手动终止不算任务结束：GUI 的终止按钮走 `session/cancel` →
*   `agent.cancel({ kind: 'user' })`，这一轮会以 `turn/end` 的
*   `reason.kind === 'aborted'` 收尾，随后才是 `agent/status` idle。
*   完成音监听会话日志里的 `turn/end` 记住最近一轮的结束原因，aborted 时
*   改由手动终止音处理（默认播放插件自带的「你干嘛~哎哟」）。
* - 等待音：`user-questions/request`（`ask_user_question`、plan review）
*   与 `approval/request`（审批）这两个 waterfall 事件，都是 DSH 正在
*   等用户回复时才会派发。监听器只旁听，必须调用 `next()` 把决定交给
*   真正的 answerer（Web UI / 自动审批），不能截胡。
* - 计划被退回音：plan review 卡片里点「要求修改」不会回答批准/拒绝选项，
*   而是由 Web UI 以 `ASK_CANCELLED` 取消这次提问；`dsh-plan-mode` 收到
*   取消后调用 `concludeTurn()`，这一轮随即以 `turn/end` `completed` 收尾。
*   插件在旁听 `user-questions/request` 时接住 `next()` 的拒绝结果，看到
*   `ASK_CANCELLED` 且请求带 `plan-review` 意图，就记下这个会话；等 idle
*   时改播计划被退回音，而不是当成任务完成的完成音。
* - 手动终止音：只在 `turn/end` 原因为 `aborted` 且取消来源是 `user`
*   （用户点终止按钮/停止快捷键）时播放。会话归档、父级取消、插件卸载
*   同样以 aborted 收尾，但它们不是用户手动停止，保持静音。
*
* 播放交给宿主系统的声音工具（macOS `afplay`、Windows `SystemSounds`、
* Linux `paplay` 等），不占用 DSH 自己的 UI 与音频权限。系统声音之外，
* 插件还自带一个梗语音文件作为候选（`CUSTOM_SOUNDS`），它由能解码文件的
* 播放器播放，不走系统声音表。
*
* 声音选择放在插件 Config 的 volatile 字段里：设置页写入时 Loader 不重载
* 插件，只更新配置引用。四种提示音都可以选「无」（配置值 `none`），表示
* 这个时机不播放。
*
* 试听与选择是分开的两步：设置页先列出所有候选，点一下只播放一次
* （`POST /buka-bell/preview`，不写配置），听完再在列表里决定四个时机
* 各用哪个。路由沿用 web 组合的信任栅栏，只接受本机、已认证的浏览器请求。
*
* @module @buka/dsh-plugin-bell
*/
/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
const name = "sound-buka-bell";
/** 依赖的服务：列 live Agent 并用会话头的 `origin` 判断是不是顶层会话。 */
const inject = ["agents"];
/**
* 可在设置页改的四项声音。
*
* 只有 `volatile` 字段能被设置页热更新：Loader 把新值写进配置引用并派发
* `loader/volatile-update`，不会重启插件。
*/
const Config = z.object({
	/** 任务结束时播放的提示音名：macOS 系统声音名、自带的 `ikun`，或 `none`。 */
	finish: z.string().default(DEFAULT_SOUND.finish).volatile(),
	/** DSH 等待用户回答或审批时播放的提示音名：同上，或 `none`。 */
	wait: z.string().default(DEFAULT_SOUND.wait).volatile(),
	/** 计划评审被用户退回修改时播放的提示音名：同上，或 `none`。 */
	plan: z.string().default(DEFAULT_SOUND.plan).volatile(),
	/** 用户手动终止任务时播放的提示音名：同上，或 `none`。 */
	abort: z.string().default(DEFAULT_SOUND.abort).volatile()
});
/**
* 装配提示音插件：创建播放器，注册试听路由与四个时机的监听。
*/
function apply(ctx, config) {
	const play = createPlayer(ctx);
	registerPreviewRoutes(ctx, play);
	watch(ctx, config, play);
}
export { CUSTOM_SOUNDS, Config, SILENT, apply, inject, name };
