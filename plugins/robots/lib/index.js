import z from "@deepseek-ai/schemastery";
import { constants, promises } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
// .build/robots/access.js
/**
* 判断某个 agent 能否看到 / 调用机器人构建工具。
*
* - `allowed` 为空：配置显式关掉了收窄（所有会话可见，不推荐）。
* - 组成里没有 `sessions` / `agentPresets` 服务：无法判定，收紧为不可见。
* - 其余情况：只有「点名 preset 的根会话」可见。
*
*/
function resolveRobotBuildAccess(input = {}) {
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
* 判断某个 agent 能否看到 `buka_robots` 返回的机器人技能清单。
*
* 工作流编排 preset 固定隐藏（见 `WORKFLOW_ORCHESTRATOR_PRESET`）：编排者拿到的
* 只有每个机器人的一句职责，不需要、也不应该知道它们装了哪些 skill。
*
* - 组成里没有 `sessions` / `agentPresets` 服务：识别不出调用方，保持可见
*   （只读信息的收窄，失败时不连累普通会话）。
* - 其余情况：只有 `workflow-orchestrator` 看不到技能清单。
*
*/
function resolveRobotSkillsVisibility(input = {}) {
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
		visible: true,
		preset: null,
		reason: "no-session"
	};
	const preset = agentPresets.presetForSession(session) ?? null;
	if (preset === null) return {
		visible: true,
		preset: null,
		reason: "no-preset"
	};
	return preset === "workflow-orchestrator" ? {
		visible: false,
		preset,
		reason: "hidden"
	} : {
		visible: true,
		preset,
		reason: "visible"
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
// .build/robots/store/paths.js
/**
* 机器人存储层的路径、名称与文件系统小工具。
*
* 插件全局目录固定在 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`，默认
* 机器人根目录是它下面的 `robots`，登记文件是根目录同级的 `robots.json`。
* 路径展开、名称校验与 realpath 兜底都集中在这里，便于用临时目录单测。
*
* @module @buka/dsh-plugin-robots/store/paths
*/
/** 每个机器人工作区里的协作说明文件名。 */
const AGENTS_FILE = "AGENTS.md";
/**
* Claude Code 读取的项目说明文件名。机器人目录里固定把它做成指向 AGENTS.md
* 的符号链接，两份工具读同一份内容；平台不允许建链接时改写 `@AGENTS.md`。
*/
const CLAUDE_FILE = "CLAUDE.md";
/** 允许通过页面写回 AGENTS.md 的上限（512 KiB）；超出由路由返回 413。 */
const AGENTS_MAX_WRITE_BYTES = 524288;
/** 插件全局目录名；位于 `${XDG_CACHE_HOME:-~/.cache}` 下。 */
const PLUGIN_CACHE_DIR = "dsh-plugin-robots";
/** 登记文件名；固定放在机器人根目录的父目录里。 */
const ROBOT_REGISTRY_FILE = "robots.json";
/** 仍可读取的旧版登记表版本；读入时迁移到当前版本。 */
const ROBOT_REGISTRY_LEGACY_VERSIONS = [1];
/**
* 机器人名称的合法字符集：字母、数字（含汉字等 Unicode 字母/数字）开头，
* 后面可以跟 `._-`。点开头、路径分隔符与 NUL 都被这个正则排除。
*/
const ROBOT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
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
* 插件全局目录：`${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots`。
*
*/
function pluginCacheDir(env = process.env) {
	const cacheHome = envPath(env?.XDG_CACHE_HOME, env) ?? path.join(homeDir(env), ".cache");
	return path.join(cacheHome, PLUGIN_CACHE_DIR);
}
/**
* 机器人根目录的默认位置：`<插件全局目录>/robots`。
*
*/
function defaultRobotsRoot(env = process.env) {
	return path.join(pluginCacheDir(env), "robots");
}
/**
* 把配置里的根目录解析成绝对路径：空值回退默认目录，展开开头的 `~`，
* 相对路径按当前进程目录解析。
*
*/
function resolveRobotsDir(configured, env = process.env) {
	const text = typeof configured === "string" ? configured.trim() : "";
	if (text === "") return path.resolve(defaultRobotsRoot(env));
	return path.resolve(expandPath(text, env));
}
/**
* 登记文件路径：固定为机器人根目录的**同级** `robots.json`。
*
*/
function resolveRobotRegistryFile(robotsDir) {
	const base = typeof robotsDir === "string" && robotsDir.trim() !== "" ? path.resolve(robotsDir) : path.resolve(defaultRobotsRoot());
	return path.join(path.dirname(base), ROBOT_REGISTRY_FILE);
}
/**
* 判断一个名字能否直接当作机器人目录名。
*
* 规则（与页面后端的校验一致）：trim 后 1–64 个字符；不能是 `.` / `..`；
* 不能以 `.` 开头；不能包含 `/`、`\`、NUL；只允许字母、数字、汉字与 `._-`。
*
*/
function isValidRobotName(name) {
	if (typeof name !== "string") return false;
	const text = name.trim();
	if (text.length < 1 || text.length > 64) return false;
	if (text === "." || text === "..") return false;
	return ROBOT_NAME_PATTERN.test(text);
}
/**
* 机器人名字对应的绝对目录；名字不合法或解析后跑出根目录时返回 null。
*
*/
function robotDirectory(robotsDir, name) {
	if (!isValidRobotName(name)) return null;
	if (typeof robotsDir !== "string" || robotsDir.trim() === "") return null;
	const base = path.resolve(robotsDir);
	const target = path.resolve(base, name.trim());
	const relative = path.relative(base, target);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return target;
}
/**
* 校验并规范化登记文件路径。
*
*/
function requireRegistryFile(file) {
	if (typeof file !== "string" || file.trim() === "") throw new Error("缺少机器人登记文件路径");
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
// .build/robots/store/agents.js
/**
* 机器人目录里的说明文件：AGENTS.md 的读写、模板，以及 CLAUDE.md 链接。
*
* 机器人目录固定放一份 `AGENTS.md`；Claude Code 的 `CLAUDE.md` 默认做成指向
* 它的符号链接（平台不支持时写 `@AGENTS.md`）。新建机器人时顺带补目录与模板。
*
* @module @buka/dsh-plugin-robots/store/agents
*/
/**
* 确保机器人目录存在，并补一份 AGENTS.md 模板（不覆盖已有的）。
*
* 模板里的路径用目录的规范绝对路径（`fs.realpath`，失败回退解析值），与
* 登记进 `robots.json` 的路径、DSH 工作区记录里的路径保持一致。
*
*/
async function ensureRobotDirectory(directory, name) {
	await promises.mkdir(directory, { recursive: true });
	if (!(await promises.stat(directory)).isDirectory()) {
		const error = /* @__PURE__ */ new Error(`目标路径已存在且不是目录：${directory}`);
		throw Object.assign(error, { code: "not-directory" });
	}
	const canonical = await realpathOr(directory, directory);
	const agentsFile = path.join(canonical, AGENTS_FILE);
	if (!await pathExists(agentsFile)) await promises.writeFile(agentsFile, robotAgentsTemplate(name, canonical), "utf8");
	await ensureClaudeLink(canonical);
	return canonical;
}
/**
* 机器人目录里 CLAUDE.md 的状态。
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
* 确保 `<机器人目录>/CLAUDE.md` 指向 `AGENTS.md`。
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
* 新机器人的 AGENTS.md 模板；路径与名字都是磁盘上的真实值。
*
*/
function robotAgentsTemplate(name, robotPath) {
	return `# AGENTS.md

这是「${name}」机器人的协作说明。这个目录同时是一个 DSH 工作区。

## 项目

- 路径：\`${robotPath}\`
- 用途：

## 约定

- 动手前先读仓库里已有的文档、脚本与测试。
- 提交信息用 Conventional Commits；一个 commit 只做一件事。
`;
}
// .build/robots/store/builtin.js
/**
* 内建 program 型机器人。
*
* program 型机器人是固定程序（接收输入 → 产出输出），没有目录、AGENTS.md 与
* 项目 skills；v1 只有内建 `clock`，由 workflows 插件执行驱动。它们登记在
* robots 插件里、在页面上只读展示，用户不能创建或删除。
*
* 本模块只依赖类型与常量，可被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-robots/store/builtin
*/
/** 内建定时机器人的名字，也是它的 program id。 */
const CLOCK_ROBOT_NAME = "clock";
/**
* 内建 program 机器人清单（按登记顺序）。
*
* `createdAt` 是固定的登记时刻：内建机器人不随安装时间变化，重复补写也不会
* 让它看起来是新的。
*/
const BUILTIN_ROBOTS = Object.freeze([{
	name: CLOCK_ROBOT_NAME,
	driver: "program",
	path: "",
	program: CLOCK_ROBOT_NAME,
	createdAt: "2026-11-12T00:00:00.000Z",
	avatar: "",
	description: "到点完成任务的定时机器人：任务 payload 带 until，到点后自动完成。",
	assistant: false
}]);
/** 按名字取内建程序机器人；不是内建机器人时返回 undefined。 */
function builtinRobot(name) {
	if (typeof name !== "string") return void 0;
	const trimmed = name.trim();
	return BUILTIN_ROBOTS.find((robot) => robot.name === trimmed);
}
/** 名字是否属于内建（不可创建 / 删除 / 改动的）程序机器人。 */
function isBuiltinRobotName(name) {
	return builtinRobot(name) !== void 0;
}
/**
* 把登记表里缺的内建机器人补到末尾。
*
* 只影响内存里的视图：页面与 `list()` 用它保证内建机器人总是可见；写回由
* `ensureBuiltinRobots` 负责。
*/
function withBuiltinRobots(robots) {
	const names = new Set(robots.map((robot) => robot.name));
	return [...robots, ...BUILTIN_ROBOTS.filter((robot) => !names.has(robot.name))];
}
/** 生成「内建机器人不可改动」错误。 */
function builtinRobotError(name) {
	const error = /* @__PURE__ */ new Error(`内建机器人不可创建、修改或删除：${String(name)}`);
	return Object.assign(error, { code: "builtin-robot" });
}
// .build/robots/avatar.js
/**
* 机器人头像的 Host 侧契约：预设 id、默认分配与校验。
*
* 头像在登记表里只存一个 id（例如 `panda`），显示由两个浏览器一半各自维护一份
* 同一 id → emoji / 底色的映射（本仓库不允许插件之间互相 import）：
* `plugins/robots/client.js` 的机器人页与 `plugins/workflows/client.js` 的工作流
* 节点图。因此 **id 是跨插件的稳定契约**，增删预设时要同步两处客户端。
*
* 默认分配是确定性的：没有指定头像的机器人按名字哈希到一个预设，这样旧登记表
* 里的机器人也有稳定头像；新建机器人优先挑一个还没被占用的预设，避免刚创建
* 的一批机器人全是一个样子。
*
* 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-robots/avatar
*/
/**
* 预设头像 id。顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是名字哈希
* 的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
*
* 这里**没有** 🤖 机器人 emoji：那是历史遗留的「通用型机器人」专属头像，通用型
* 机器人已移除，`robot` 这个 id 不再使用；旧登记表里残留的 `robot` id 会按名字
* 哈希落回其它预设。
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
	"mushroom"
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
* 名字 → 稳定哈希（FNV-1a，按 Unicode 码点遍历，中文名也能均匀分布）。
*
*/
function hashName(name) {
	let hash = 2166136261;
	for (const char of String(name ?? "")) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
/**
* 名字对应的确定性头像：同一个名字永远得到同一个 id。
*
*/
function defaultAvatarFor(name) {
	return AVATAR_IDS[hashName(name) % AVATAR_IDS.length] ?? DEFAULT_AVATAR_ID;
}
/**
* 新建机器人时的默认头像：先按名字哈希，如果这个 id 已经被别的机器人用了，
* 就按预设顺序挑第一个没被占用的；全被占用时回到名字哈希的结果。
*
*/
function pickDefaultAvatar(name, used = []) {
	const taken = new Set(used);
	const preferred = defaultAvatarFor(name);
	if (!taken.has(preferred)) return preferred;
	for (const id of AVATAR_IDS) if (!taken.has(id)) return id;
	return preferred;
}
/**
* 读取登记表里的头像值并规范化：合法的 id 原样返回，缺省 / 非法值按名字兜底。
*
*/
function resolveAvatar(value, name) {
	return isAvatarId(value) ? value : defaultAvatarFor(name);
}
// .build/robots/store/project-skills.js
/**
* 扫描工作区里的项目级 skills。
*
* 三个根目录：`<path>/.agents/skills`、`<path>/.claude/skills`、
* `<path>/.dsh/skills`（`<name>/SKILL.md` 或平铺的 `<name>.md`）；`source`
* 从项目级 `skills-lock.json` 里补。单个条目读不了时跳过，整次扫描不抛错。
*
* @module @buka/dsh-plugin-robots/store/project-skills
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
* - 工作目录：skills 的全局安装固定在 `agentsHome` 下，robots 每次调用传项目
*   目录（`cwd` 既可以在工厂里绑定，也可以在调用时覆盖）；
* - 超时：skills 用默认的 120 s，robots 显式传 180 s；
* - 失败信息：找不到 npx 时的完整文案由调用方传入；命令名默认是
*   `npx skills`，robots 传一个按子命令生成的函数；
* - 「没跑到子进程」的失败（找不到 npx、spawn 直接抛错）是否带 `output: ''`：
*   robots 的返回形状要求有，skills 原本没有。
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
* 参数与 `uninstallGlobalSkill` / robots 安装路由里的 `runNpx` 一致：传入子命令
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
* 解析 `npx skills add <source> --list` 的输出。
*
* CLI 只提供给人看的 Clack 文本（`--json` 不能与 `--list` 同用），非 TTY 下
* 形如：
*
* ```text
* │  Available Skills
* │
* │    web-design-guidelines
* │
* │      Review UI code for Web Interface Guidelines compliance.
* ```
*
* 所以按缩进区分：`│` 列之后 4 空格是 skill 名，6 空格是描述（描述可能续行）。
* 只解析 `Available Skills` 之后、`Use --skill` 之前的段落；解析不到时返回
* 空数组，由调用方决定是「来源里没有 skill」还是「输出格式变了」。
*
* @param text 命令输出
* @returns skill 名与描述；解析不到时是空数组
*/
function parseSkillList(text) {
	const lines = cleanOutput(text, Number.MAX_SAFE_INTEGER).split("\n");
	const start = lines.findIndex((line) => /Available Skills/u.test(line));
	if (start < 0) return [];
	const byName = /* @__PURE__ */ new Map();
	let current = null;
	for (const raw of lines.slice(start + 1)) {
		if (/Use --skill/u.test(raw)) break;
		const line = raw.replace(/^[\u2502\u2503|]/u, "");
		if (line.trim() === "") continue;
		if (current !== null && /^\s{6,}\S/u.test(line)) {
			const piece = line.trim();
			current.description = current.description === "" ? piece : `${current.description} ${piece}`;
			continue;
		}
		if (/^\s{2,5}\S/u.test(line)) {
			const name = line.trim();
			if (name === "") continue;
			current = {
				name,
				description: ""
			};
			if (!byName.has(name)) byName.set(name, current);
		}
	}
	return [...byName.values()];
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
// .build/robots/store/registry.js
/**
* 机器人登记表：读写、迁移、原子写、条目增删与描述规范化。
*
* 登记文件是插件唯一的机器人清单；写操作遇到损坏的登记文件必须拒绝，绝不覆盖
* 用户文件。新建的机器人目录由 `agents.ts` 的 `ensureRobotDirectory` 补模板。
*
* 格式为 version 2（`driver` / `assistant`）；读 version 1 旧表时在内存里迁移，
* 下一次写入落盘成新格式。内建 program 机器人（clock）由 `BUILTIN_ROBOTS`
* 提供：读旧表时补到视图里，写回前由 `ensureBuiltinRobots` 落盘一次。
*
* @module @buka/dsh-plugin-robots/store/registry
*/
/** 登记表里能读到的版本：当前版本 + 仍需要迁移的旧版本。 */
const READABLE_VERSIONS = /* @__PURE__ */ new Set([2, ...ROBOT_REGISTRY_LEGACY_VERSIONS]);
/** 判断值是不是普通对象（不是数组 / null）。 */
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* 读登记表里的一个条目并迁移成当前形状；不合法时返回 undefined。
*
* - `driver` 缺失（version 1 旧条目）或取值写坏时按 `agent` 处理；
* - program 条目必须有非空 `program` id，agent 条目必须有非空 `path`；
* - `assistant` 只对 agent 生效：program 机器人不能被标记成助理。
*/
function readEntry(entry) {
	if (!isValidRobotName(entry.name)) return void 0;
	const name = entry.name.trim();
	const driver = entry.driver === "program" ? "program" : "agent";
	const program = driver === "program" && typeof entry.program === "string" ? entry.program.trim() : "";
	if (driver === "program" && program === "") return void 0;
	const robotPath = typeof entry.path === "string" ? entry.path.trim() : "";
	if (driver === "agent" && robotPath === "") return void 0;
	return {
		name,
		driver,
		path: robotPath,
		program,
		createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
		avatar: typeof entry.avatar === "string" ? entry.avatar.trim() : "",
		description: normalizeRobotDescription(entry.description).slice(0, 500),
		assistant: driver === "agent" && entry.assistant === true
	};
}
/**
* 把一条待写入记录规范化成完整记录；缺省字段按当前格式补齐。
*
* - `driver` 缺省按 `agent`；
* - agent 记录补 `path`、清空 `program`；program 记录补 `program`、清空 `path`；
* - `avatar` 总是落成具体预设 id（旧记录第一次写回时顺带补齐）；
* - 描述折叠空白并截断；`assistant` 只对 agent 生效。
*/
function normalizeRecord(robot) {
	const driver = robot.driver === "program" ? "program" : "agent";
	return {
		name: robot.name,
		driver,
		path: driver === "agent" && typeof robot.path === "string" ? robot.path : "",
		program: driver === "program" && typeof robot.program === "string" ? robot.program.trim() : "",
		createdAt: robot.createdAt,
		avatar: resolveAvatar(robot.avatar, robot.name),
		description: normalizeRobotDescription(robot.description).slice(0, 500),
		assistant: driver === "agent" && robot.assistant === true
	};
}
/**
* 读机器人登记表。
*
* - 文件不存在：`{ version: 2, robots: [], file }`（内建机器人由调用方合并）；
* - 读不了 / 不是合法 JSON / 版本不可读 / `robots` 不是数组：`corrupt: true`
*   且 `robots: []`（写操作必须据此拒绝，绝不覆盖原文件）；
* - version 1 旧表按 `driver: "agent"`、`assistant: false` 迁移；
* - 条目必须同时有合法 `name`（agent 还要有非空 `path`，program 要有 `program`），
*   否则过滤掉；同名条目只保留第一个。
* - `avatar` 是预设头像 id；旧登记表没有这个字段（或在别处被改坏）时留空，
*   展示 / 写入时由 `resolveAvatar` 按名字兜底成一个确定的预设。
*
*/
async function readRobotRegistry({ file } = {}) {
	const target = requireRegistryFile(file);
	let text;
	try {
		text = await promises.readFile(target, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return {
			version: 2,
			robots: [],
			file: target
		};
		return {
			version: 2,
			robots: [],
			corrupt: true,
			file: target
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			version: 2,
			robots: [],
			corrupt: true,
			file: target
		};
	}
	if (!isRecord(parsed)) return {
		version: 2,
		robots: [],
		corrupt: true,
		file: target
	};
	if (typeof parsed.version !== "number" || !READABLE_VERSIONS.has(parsed.version) || !Array.isArray(parsed.robots)) return {
		version: 2,
		robots: [],
		corrupt: true,
		file: target
	};
	const robots = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of parsed.robots) {
		if (!isRecord(entry)) continue;
		const robot = readEntry(entry);
		if (robot === void 0 || seen.has(robot.name)) continue;
		seen.add(robot.name);
		robots.push(robot);
	}
	return {
		version: 2,
		robots,
		file: target
	};
}
/**
* 原子写机器人登记表（临时文件 + rename，权限 0600）。
*
* 目录不存在会先建好；写入失败时清理临时文件，原登记文件保持不变。写入总是
* 落成当前版本（version 2），旧记录缺的 `driver` / `assistant` 在这里补齐。
*
*/
async function writeRobotRegistry({ file, robots } = {}) {
	const target = requireRegistryFile(file);
	await writeJsonAtomic(target, {
		version: 2,
		robots: (Array.isArray(robots) ? robots : []).map((entry) => {
			const robot = normalizeRecord(entry);
			if (robot.driver === "program") return {
				name: robot.name,
				driver: robot.driver,
				program: robot.program,
				createdAt: robot.createdAt,
				avatar: robot.avatar,
				description: robot.description,
				assistant: false
			};
			return {
				name: robot.name,
				driver: robot.driver,
				path: robot.path,
				createdAt: robot.createdAt,
				avatar: robot.avatar,
				description: robot.description,
				assistant: robot.assistant
			};
		})
	});
	return { file: target };
}
/**
* 把内建 program 机器人补进登记表（幂等）。
*
* 只补缺的条目，不动已有条目与顺序；登记表损坏时拒绝写入、返回 `corrupt`。
*
*/
async function ensureBuiltinRobots({ file } = {}) {
	const target = requireRegistryFile(file);
	const registry = await readRobotRegistry({ file: target });
	if (registry.corrupt) return {
		added: [],
		corrupt: true
	};
	const names = new Set(registry.robots.map((robot) => robot.name));
	const missing = BUILTIN_ROBOTS.filter((robot) => !names.has(robot.name));
	if (missing.length === 0) return { added: [] };
	await writeRobotRegistry({
		file: target,
		robots: [...registry.robots, ...missing]
	});
	return { added: missing.map((robot) => robot.name) };
}
/**
* 生成「名称不合法」错误。
*
*/
function invalidNameError(name) {
	const error = /* @__PURE__ */ new Error(`机器人名称不合法：${String(name)}`);
	return Object.assign(error, { code: "invalid-name" });
}
/**
* 生成「描述不合法」错误。
*
*/
function invalidDescriptionError(description) {
	const error = /* @__PURE__ */ new Error(`机器人描述不合法：需要不超过 500 个字符的单行文本（收到 ${String(description)}）`);
	return Object.assign(error, { code: "invalid-description" });
}
/**
* 生成「助理标记不合法」错误。
*
*/
function invalidAssistantError(assistant) {
	const error = /* @__PURE__ */ new Error(`助理标记不合法：需要布尔值（收到 ${String(assistant)}）`);
	return Object.assign(error, { code: "invalid-assistant" });
}
/**
* 生成「program 机器人只读」错误。
*
*/
function programRobotError(name) {
	const error = /* @__PURE__ */ new Error(`program 型机器人只读，不能修改或打开会话：${String(name)}`);
	return Object.assign(error, { code: "program-robot" });
}
/**
* 规范化机器人描述：把换行 / 连续空白折叠成一个空格并 trim。描述是给工作流
* 选择机器人看的「一行摘要」（与 skill 的 description 类似），所以不保留排版。
* 非字符串按空描述处理。
*
*/
function normalizeRobotDescription(value) {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/gu, " ").trim();
}
/**
* 生成「登记文件损坏」错误；写操作遇到它必须拒绝，不能覆盖用户文件。
*
*/
function registryUnreadableError$1(file) {
	const error = /* @__PURE__ */ new Error(`机器人登记文件无法读取：${file}。请修复或删除该文件后重试。`);
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
* 生成「机器人不在登记表里」错误。
*
*/
function unknownRobotError(name) {
	const error = /* @__PURE__ */ new Error(`机器人不在登记表里：${name}`);
	return Object.assign(error, { code: "unknown-robot" });
}
/**
* 新建（或复用）一个 agent 型机器人：建目录、补 AGENTS.md 模板、把条目插到
* 登记表最前。
*
* - 内建 program 机器人（clock）不可创建，program 条目不可被同名复用；
* - 头像：传入合法 id 就用它，否则按名字挑一个还被占用的预设；新建的机器人
*   一定带头像；
* - 描述可选，存成一行摘要（空白折叠）；新建时写进条目，同名已登记时保留原描述；
* - 同名已登记：不重复建条目，`created: false`；目录被外部删掉时重新建目录；
* - 名称不合法抛 `code = 'invalid-name'`；内建名抛 `code = 'builtin-robot'`；
*   登记文件损坏抛 `code = 'registry-unreadable'`（不覆盖原文件）；
* - 新条目的 `path` 是创建后的规范绝对路径（`fs.realpath`，失败回退解析值），
*   这样和工作区注册表里的路径能直接对齐。
*
*/
async function addRobot({ robotsDir, file, name, avatar, description } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isValidRobotName(name)) throw invalidNameError(name);
	if (isBuiltinRobotName(name)) throw builtinRobotError(name);
	const rawDescription = description === void 0 || description === null ? "" : description;
	if (typeof rawDescription !== "string") throw invalidDescriptionError(rawDescription);
	const cleanDescription = normalizeRobotDescription(rawDescription);
	if (cleanDescription.length > 500) throw invalidDescriptionError(rawDescription);
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const trimmed = name.trim();
	const existing = registry.robots.find((robot) => robot.name === trimmed);
	if (existing !== void 0) {
		if (existing.driver !== "agent") throw programRobotError(trimmed);
		await ensureRobotDirectory(existing.path, trimmed);
		return {
			robot: {
				...existing,
				avatar: resolveAvatar(existing.avatar, existing.name)
			},
			created: false
		};
	}
	const target = robotDirectory(robotsDir, trimmed);
	if (target === null) throw invalidNameError(trimmed);
	const canonical = await ensureRobotDirectory(target, trimmed);
	const used = registry.robots.map((robot) => resolveAvatar(robot.avatar, robot.name));
	const robot = {
		name: trimmed,
		driver: "agent",
		path: canonical,
		program: "",
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		avatar: isAvatarId(avatar) ? avatar : pickDefaultAvatar(trimmed, used),
		description: cleanDescription,
		assistant: false
	};
	await writeRobotRegistry({
		file: registryFile,
		robots: [robot, ...registry.robots.filter((entry) => entry.name !== trimmed)]
	});
	return {
		robot,
		created: true
	};
}
/**
* 改一个 agent 机器人的头像：只动登记表里的 `avatar` 字段，不碰目录与工作区。
*
* - 头像 id 不属于预设集合抛 `code = 'invalid-avatar'`；
* - 名字不在登记表里抛 `code = 'unknown-robot'`；
* - program 机器人只读，抛 `code = 'program-robot'`；
* - 登记文件损坏抛 `code = 'registry-unreadable'`。
*
*/
async function setRobotAvatar({ file, name, avatar } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isValidRobotName(name)) throw invalidNameError(name);
	if (!isAvatarId(avatar)) throw invalidAvatarError(avatar);
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const trimmed = name.trim();
	const current = registry.robots.find((robot) => robot.name === trimmed);
	if (current === void 0) throw unknownRobotError(trimmed);
	if (current.driver !== "agent") throw programRobotError(trimmed);
	const robot = {
		...current,
		avatar
	};
	await writeRobotRegistry({
		file: registryFile,
		robots: registry.robots.map((entry) => entry.name === trimmed ? robot : entry)
	});
	return { robot };
}
/**
* 改一个 agent 机器人的描述：只动登记表里的 `description` 字段，不碰目录与工作区。
*
* 描述是给工作流选择机器人看的一行摘要（类似 skill 的 description），存储前
* 会折叠空白；空串表示清空。超过上限抛 `code = 'invalid-description'`。
* program 机器人只读，抛 `code = 'program-robot'`。
*
*/
async function setRobotDescription({ file, name, description } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isValidRobotName(name)) throw invalidNameError(name);
	if (typeof description !== "string") throw invalidDescriptionError(description);
	const clean = normalizeRobotDescription(description);
	if (clean.length > 500) throw invalidDescriptionError(description);
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const trimmed = name.trim();
	const current = registry.robots.find((robot) => robot.name === trimmed);
	if (current === void 0) throw unknownRobotError(trimmed);
	if (current.driver !== "agent") throw programRobotError(trimmed);
	const robot = {
		...current,
		description: clean
	};
	await writeRobotRegistry({
		file: registryFile,
		robots: registry.robots.map((entry) => entry.name === trimmed ? robot : entry)
	});
	return { robot };
}
/**
* 设置 / 取消一个 agent 机器人的助理标记。
*
* 只有 agent 型机器人可以是助理（人任务的承办者）；program 机器人只读，抛
* `code = 'program-robot'`。`assistant` 必须是布尔值，否则抛
* `code = 'invalid-assistant'`。
*
*/
async function setRobotAssistant({ file, name, assistant } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isValidRobotName(name)) throw invalidNameError(name);
	if (typeof assistant !== "boolean") throw invalidAssistantError(assistant);
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const trimmed = name.trim();
	const current = registry.robots.find((robot) => robot.name === trimmed);
	if (current === void 0) throw unknownRobotError(trimmed);
	if (current.driver !== "agent") throw programRobotError(trimmed);
	const robot = {
		...current,
		assistant
	};
	await writeRobotRegistry({
		file: registryFile,
		robots: registry.robots.map((entry) => entry.name === trimmed ? robot : entry)
	});
	return { robot };
}
/**
* 从登记表移除一个 agent 机器人：**目录不删**（目录、文件与会话都保留）。
*
* - 内建 program 机器人（clock）与其它 program 机器人只读，拒绝移除；
* - 登记文件损坏抛 `code = 'registry-unreadable'`；未知名字返回
*   `{ removed: false }`，不写文件。
*
*/
async function removeRobot({ file, name } = {}) {
	const registryFile = requireRegistryFile(file);
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const trimmed = typeof name === "string" ? name.trim() : "";
	const current = registry.robots.find((robot) => robot.name === trimmed);
	if (current === void 0) return { removed: false };
	if (isBuiltinRobotName(trimmed)) throw builtinRobotError(trimmed);
	if (current.driver !== "agent") throw programRobotError(trimmed);
	await writeRobotRegistry({
		file: registryFile,
		robots: registry.robots.filter((robot) => robot.name !== trimmed)
	});
	return { removed: true };
}
// .build/robots/store/list.js
/**
* 机器人列表：登记表 + 目录 / 挂载状态 + 项目级 skills 与 AGENTS.md。
*
* 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
* realpath 规范值），机器人路径用 `fs.realpath`（失败回退 `path.resolve`）。
*
* program 型机器人没有目录：不扫描 skills / AGENTS.md，`exists` 为 false，
* 页面按 `driver` 只读展示。内建 program 机器人在视图里补上，即使登记表还没
* 落盘也能看到。
*
* @module @buka/dsh-plugin-robots/store/list
*/
/** 没有目录的机器人（program 型）的 CLAUDE.md 摘要。 */
function emptyClaude() {
	return {
		exists: false,
		symlink: false,
		mode: "missing",
		target: ""
	};
}
/**
* 汇总登记表里的机器人：目录是否存在、是否已挂到 DSH 工作区，以及每个
* agent 型机器人自己的项目级 skills 与 AGENTS.md。
*
* 「挂载」按规范路径比较：工作区路径用 `path.resolve`（DSH 记录本身就是
* realpath 规范值），机器人路径用 `fs.realpath`（失败回退 `path.resolve`）。
* 登记文件损坏时返回 `corrupt: true` 与空列表。
*
*/
async function listRobots({ file, workspaceRegistry, robotsDir } = {}) {
	const registryFile = requireRegistryFile(file);
	const root = typeof robotsDir === "string" && robotsDir.trim() !== "" ? path.resolve(robotsDir) : path.join(path.dirname(registryFile), "robots");
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) return {
		root,
		registry: registryFile,
		corrupt: true,
		robots: []
	};
	const workspaceByPath = await indexWorkspaces(workspaceRegistry);
	const robots = [];
	for (const entry of withBuiltinRobots(registry.robots)) {
		if (entry.driver === "program") {
			robots.push(programEntry(entry));
			continue;
		}
		robots.push(await agentEntry(entry, workspaceByPath));
	}
	return {
		root,
		registry: registryFile,
		corrupt: false,
		robots
	};
}
/** program 型机器人：没有目录、skills 与 AGENTS.md。 */
function programEntry(entry) {
	return {
		...entry,
		avatar: resolveAvatar(entry.avatar, entry.name),
		exists: false,
		mounted: false,
		workspaceId: null,
		skills: [],
		agents: emptyAgentsFile(),
		claude: emptyClaude()
	};
}
/** agent 型机器人：目录 / 挂载 / skills / AGENTS.md 汇总。 */
async function agentEntry(entry, workspaceByPath) {
	const canonical = await realpathOr(entry.path, path.resolve(entry.path));
	const workspace = workspaceByPath.get(canonical) ?? workspaceByPath.get(path.resolve(entry.path));
	const exists = await isDirectory(canonical);
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
		avatar: resolveAvatar(entry.avatar, entry.name),
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
* `fs.realpath` 登记（后者成功时才登记），机器人侧用 realpath 对齐，
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
// .build/robots/store/rename.js
/**
* 机器人重命名：移动目录并就地更新登记表。
*
* 工作区重建由 `builder.ts` 负责；本模块只动磁盘与登记表，失败时把目录改回
* 旧名，保证磁盘与登记表仍然一致。
*
* @module @buka/dsh-plugin-robots/store/rename
*/
/**
* 重命名一个机器人：把机器人目录改名为新名字，并就地更新登记表里的
* `name` 与 `path`。
*
* - 名称规则与新建一致；新名等于旧名时按 no-op 返回（`renamed: false`），
*   不碰磁盘与登记表；
* - 新名不能与登记表里其它机器人重名，也不能与 `robotsDir` 下已存在的目录
*   重名（抛 `code = 'name-taken'`），避免两个登记条目指向同一个目录；
* - 大小写不敏感的文件系统（macOS 默认）上允许只改大小写：目标路径与旧目录
*   是同一个目录时继续改名，而不是误判成「目标已存在」；
* - 只移动 `robotsDir` 的直接子目录：登记表被手改到别处时拒绝
*   （`code = 'path-outside-root'`），不会把用户目录搬进机器人根目录；
* - 条目里的 `createdAt` / `avatar` / `description` 不变，`avatar` 按**旧名**
*   解析成具体 id 后写回，避免旧记录缺头像时改名让头像跟着名字哈希漂移；
* - `AGENTS.md` 仍与旧名 / 旧路径生成的模板完全一致时改写为新模板，用户改过
*   就保持原样（不覆盖用户内容）；
* - 登记表写失败时把目录改回旧名再抛错，失败后磁盘与登记表仍然一致。
*
* 目录改名后 `CLAUDE.md` 的相对软链接自然继续有效；工作区重建由
* `builder.js` 负责（本模块不 import DSH 包）。
*
*/
async function renameRobot({ robotsDir, file, name, newName } = {}) {
	const registryFile = requireRegistryFile(file);
	if (!isValidRobotName(name)) throw invalidNameError(name);
	const trimmed = name.trim();
	const nextName = typeof newName === "string" ? newName.trim() : "";
	if (!isValidRobotName(nextName)) throw invalidNameError(newName);
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) throw registryUnreadableError$1(registryFile);
	const current = registry.robots.find((robot) => robot.name === trimmed);
	if (current === void 0) throw unknownRobotError(trimmed);
	if (current.driver !== "agent") throw programRobotError(trimmed);
	if (isBuiltinRobotName(nextName)) throw builtinRobotError(nextName);
	if (nextName === current.name) return {
		robot: {
			...current,
			avatar: resolveAvatar(current.avatar, current.name)
		},
		previousName: current.name,
		renamed: false,
		agentsRewritten: false
	};
	if (registry.robots.some((robot) => robot.name === nextName)) throw Object.assign(/* @__PURE__ */ new Error(`机器人名称已被占用：${nextName}`), { code: "name-taken" });
	const configuredRoot = typeof robotsDir === "string" && robotsDir.trim() !== "" ? path.resolve(robotsDir) : path.resolve(defaultRobotsRoot());
	const root = await realpathOr(configuredRoot, configuredRoot);
	const oldDirectory = path.resolve(current.path);
	if (await realpathOr(path.dirname(oldDirectory), path.dirname(oldDirectory)) !== root) throw Object.assign(/* @__PURE__ */ new Error(`机器人目录不在机器人根目录下，拒绝重命名：${oldDirectory}`), { code: "path-outside-root" });
	if (!await isDirectory(oldDirectory)) throw Object.assign(/* @__PURE__ */ new Error(`机器人目录不存在或不是目录：${oldDirectory}`), { code: "missing-directory" });
	const target = path.join(root, nextName);
	let targetExists = false;
	try {
		await promises.lstat(target);
		targetExists = true;
	} catch {
		targetExists = false;
	}
	if (targetExists) {
		const [targetReal, oldReal] = await Promise.all([realpathOrNull(target), realpathOrNull(oldDirectory)]);
		if (targetReal === null || oldReal === null || targetReal !== oldReal) throw Object.assign(/* @__PURE__ */ new Error(`目标目录已存在，无法重命名为 ${nextName}：${target}`), { code: "name-taken" });
	}
	try {
		await promises.rename(oldDirectory, target);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw Object.assign(/* @__PURE__ */ new Error(`重命名机器人目录失败：${reason}`), {
			code: "rename-failed",
			cause: error
		});
	}
	const canonical = await realpathOr(target, target);
	const next = {
		...current,
		name: nextName,
		path: canonical,
		avatar: resolveAvatar(current.avatar, current.name)
	};
	try {
		await writeRobotRegistry({
			file: registryFile,
			robots: registry.robots.map((robot) => robot.name === current.name ? next : robot)
		});
	} catch (error) {
		try {
			await promises.rename(canonical, oldDirectory);
		} catch {}
		throw error;
	}
	let agentsRewritten = false;
	try {
		const agentsFile = path.join(canonical, AGENTS_FILE);
		if (await promises.readFile(agentsFile, "utf8") === robotAgentsTemplate(current.name, oldDirectory)) {
			await promises.writeFile(agentsFile, robotAgentsTemplate(nextName, canonical), "utf8");
			agentsRewritten = true;
		}
	} catch {}
	try {
		await ensureClaudeLink(canonical);
	} catch {}
	return {
		robot: {
			...next,
			avatar: resolveAvatar(next.avatar, next.name)
		},
		previousName: current.name,
		renamed: true,
		agentsRewritten
	};
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
function describeError$2(error) {
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
// .build/robots/builder.js
/**
* 「机器人构建」preset 的写操作：创建 / 修改机器人，并把它挂到工作区。
*
* 页面上的新建流程是「建目录 + 登记 + `workspaces.create` 挂载」；这里把同一套
* 事实操作收成一个函数，供 `buka_robot_build` 工具调用（工具只对构建 preset
* 的根会话可见，见 `access.js`）。与 `robot-store.js` 的分工：
*
* - 目录、登记表、AGENTS.md 的底层读写仍由 `robot-store.js` 负责；
* - 本模块负责「一次构建」的语义：参数规范化、已存在机器人必须显式
*   `update: true` 才允许覆盖、写 AGENTS.md 后补 CLAUDE.md 链接、按规范路径
*   判断是否已挂载并只在需要时创建 DSH 工作区；
* - 挂载失败不让整个构建失败：机器人已经建好了，返回 `mounted: false` 与
*   `mountError`，由调用方告诉用户去页面点「挂载」。
*
* 只在 `index.js` 里被包进登记表串行队列调用；本模块自身不 import DSH 包，
* 用临时目录就能单测。
*
* @module @buka/dsh-plugin-robots/builder
*/
/** 构建请求的错误码；工具层按这些码给出可读提示。 */
const BUILD_ERROR_CODES = Object.freeze({
	invalidName: "invalid-name",
	invalidAvatar: "invalid-avatar",
	invalidDescription: "invalid-description",
	invalidAgents: "invalid-agents",
	invalidUpdate: "invalid-update",
	agentsTooLarge: "agents-too-large",
	registryUnreadable: "registry-unreadable",
	robotExists: "robot-exists",
	builtinRobot: "builtin-robot",
	programRobot: "program-robot",
	unknownRobot: "unknown-robot",
	nameTaken: "name-taken",
	missingDirectory: "missing-directory",
	pathOutsideRoot: "path-outside-root"
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
* - `name` 先 trim 再按机器人名称规则校验；
* - `avatar` 缺省 / 空串表示「不指定」（新建时自动分配）；给了就必须是预设 id；
* - `description` 是一行摘要，空白会折叠；缺省 / 空串表示「不改」（新建时为空）；
* - `agents` 是完整 AGENTS.md 文本，只有全空白时视为「不写」，避免误清空；
* - `update` 必须是布尔值，缺省按 `false` 处理；
* - `newName` 是可选的新名字：给了就必须合法，且必须 `update: true`（改名只针对
*   已存在的机器人）；与 `name` 相同时按「不改名」处理。
*
*/
function normalizeBuildRequest(input = {}) {
	const name = typeof input.name === "string" ? input.name.trim() : "";
	if (!isValidRobotName(name)) throw buildError(BUILD_ERROR_CODES.invalidName, "invalid robot name: use 1-64 characters, do not start with a dot, and allow only letters, digits, Chinese, \".\", \"_\" and \"-\".");
	let avatar = "";
	if (input.avatar !== void 0 && input.avatar !== null && input.avatar !== "") {
		if (!isAvatarId(input.avatar)) throw buildError(BUILD_ERROR_CODES.invalidAvatar, `unknown avatar id "${String(input.avatar)}"; use one of: ${AVATAR_IDS.join(", ")}.`);
		avatar = input.avatar;
	}
	let description = "";
	if (input.description !== void 0 && input.description !== null && typeof input.description !== "string") throw buildError(BUILD_ERROR_CODES.invalidDescription, "description must be a single-line string.");
	if (typeof input.description === "string") {
		description = normalizeRobotDescription(input.description);
		if (description.length > 500) throw buildError(BUILD_ERROR_CODES.invalidDescription, `description is ${description.length} characters; the limit is 500. Shorten it to one sentence.`);
	}
	if (input.agents !== void 0 && input.agents !== null && typeof input.agents !== "string") throw buildError(BUILD_ERROR_CODES.invalidAgents, "agents must be a string containing the complete AGENTS.md markdown.");
	const rawAgents = typeof input.agents === "string" ? input.agents : "";
	const agents = rawAgents.trim() === "" ? "" : rawAgents;
	const agentsBytes = Buffer.byteLength(agents, "utf8");
	if (agentsBytes > 524288) throw buildError(BUILD_ERROR_CODES.agentsTooLarge, `AGENTS.md is ${agentsBytes} bytes; the limit is ${AGENTS_MAX_WRITE_BYTES} bytes. Shorten it or use the page editor.`);
	if (input.update !== void 0 && typeof input.update !== "boolean") throw buildError(BUILD_ERROR_CODES.invalidUpdate, "update must be a boolean.");
	const update = input.update === true;
	let newName = "";
	if (input.newName !== void 0 && input.newName !== null && typeof input.newName !== "string") throw buildError(BUILD_ERROR_CODES.invalidName, "newName must be a string.");
	if (typeof input.newName === "string" && input.newName.trim() !== "") {
		newName = input.newName.trim();
		if (!isValidRobotName(newName)) throw buildError(BUILD_ERROR_CODES.invalidName, "invalid new robot name: use 1-64 characters, do not start with a dot, and allow only letters, digits, Chinese, \".\", \"_\" and \"-\".");
		if (!update) throw buildError(BUILD_ERROR_CODES.invalidUpdate, "renaming an existing robot requires update: true; pass it only when the user asked to rename that robot.");
	}
	return {
		name,
		avatar,
		description,
		agents,
		agentsBytes,
		update,
		newName
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
* 找机器人目录对应的已注册工作区。
*
* 工作区登记的路径本身就是规范绝对路径；机器人目录也走 `fs.realpath`，
* 两者直接比较，符号链接不会造成重复挂载。
*
*/
async function currentMount({ workspaceRegistry, robotPath } = {}) {
	if (typeof workspaceRegistry?.list !== "function") return null;
	const target = await canonicalPath(robotPath);
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
* 确保机器人目录已挂成 DSH 工作区。
*
* 已挂载时不动它（不重命名、不重排）；未挂载时用 `workspaceRegistry.create()`
* 注册，标题交给注册表按目录名生成。挂载失败（注册表不可用、目录冲突等）不抛错，
* 而是返回失败原因，让机器人本身仍然可用。
*
*/
async function mountRobot({ workspaceRegistry, robotPath } = {}) {
	const existing = await currentMount({
		workspaceRegistry,
		robotPath
	});
	if (existing !== null) return {
		mounted: true,
		workspaceId: existing.id ?? null,
		mountError: null
	};
	if (typeof workspaceRegistry?.create !== "function") return {
		mounted: false,
		workspaceId: null,
		mountError: "the workspace registry is unavailable in this composition"
	};
	try {
		return {
			mounted: true,
			workspaceId: (await workspaceRegistry.create(robotPath))?.id ?? null,
			mountError: null
		};
	} catch (error) {
		return {
			mounted: false,
			workspaceId: null,
			mountError: describeError$1(error)
		};
	}
}
/**
* 创建、修改或重命名一个机器人，并确保它已挂到工作区。
*
* - 名字已存在且没有传 `update: true`：拒绝，避免模型顺手覆盖用户的机器人；
* - 已存在且 `update: true`：只改传了的字段（头像 / 描述 / AGENTS.md），目录与
*   `createdAt` 不变；描述为空串表示保留原描述；
* - 传了 `newName` 且与 `name` 不同：先把机器人目录改名、就地更新登记表，再
*   应用其它字段；改名前已挂载时删除旧工作区注册，最后按新路径重挂
*   （新工作区 id / 标题 = 新名；旧会话日志保留，但不再挂在这个机器人下）；
*   `newName` 必须配 `update: true`，且 `name` 必须已存在；
* - 新建：建目录、写默认模板（没给 `agents` 时）、登记、按需写 AGENTS.md；
* - 所有情况都补 `CLAUDE.md` 链接，再确保工作区挂载。
*
*/
async function buildRobot({ robotsDir, file, name, avatar, description, agents, update, newName, workspaceRegistry } = {}) {
	const request = normalizeBuildRequest({
		name,
		avatar,
		description,
		agents,
		update,
		newName
	});
	if (isBuiltinRobotName(request.name)) throw buildError(BUILD_ERROR_CODES.builtinRobot, `"${request.name}" is a built-in program robot and cannot be created, changed or removed; program robots are registered by the plugin.`);
	if (request.newName !== "" && isBuiltinRobotName(request.newName)) throw buildError(BUILD_ERROR_CODES.builtinRobot, `"${request.newName}" is a built-in program robot name and cannot be used as a new robot name.`);
	const registry = await readRobotRegistry({ file });
	if (registry.corrupt) throw buildError(BUILD_ERROR_CODES.registryUnreadable, `the robot registry is unreadable: ${String(file)}. Fix or remove that file, then try again.`);
	const existing = registry.robots.find((robot) => robot.name === request.name);
	if (existing !== void 0 && existing.driver !== "agent") throw buildError(BUILD_ERROR_CODES.programRobot, `"${request.name}" is a program robot: program robots are read-only and cannot be changed by this tool.`);
	if (existing !== void 0 && !request.update) throw buildError(BUILD_ERROR_CODES.robotExists, `robot "${request.name}" already exists; pass update: true only when the user asked to change that robot.`);
	let activeName = request.name;
	let renamed = false;
	let previousName = null;
	if (request.newName !== "" && request.newName !== request.name) {
		if (existing === void 0) throw buildError(BUILD_ERROR_CODES.unknownRobot, `cannot rename "${request.name}": no robot with that name exists.`);
		const mountBefore = await currentMount({
			workspaceRegistry,
			robotPath: existing.path
		});
		const moved = await renameRobot({
			robotsDir,
			file,
			name: request.name,
			newName: request.newName
		});
		renamed = moved.renamed;
		previousName = moved.renamed ? moved.previousName : null;
		activeName = moved.robot.name;
		if (renamed && mountBefore !== null && typeof workspaceRegistry?.delete === "function") try {
			await workspaceRegistry.delete(mountBefore.id);
		} catch {}
	}
	const added = await addRobot({
		robotsDir,
		file,
		name: activeName,
		avatar: request.avatar,
		description: request.description
	});
	let robot = added.robot;
	const created = added.created;
	let updated = renamed;
	if (!created && request.avatar !== "" && request.avatar !== robot.avatar) {
		robot = (await setRobotAvatar({
			file,
			name: activeName,
			avatar: request.avatar
		})).robot;
		updated = true;
	}
	if (!created && request.description !== "" && request.description !== robot.description) {
		robot = (await setRobotDescription({
			file,
			name: activeName,
			description: request.description
		})).robot;
		updated = true;
	}
	if (request.agents !== "") {
		await writeAgentsFile(robot.path, request.agents);
		updated = updated || !created;
	}
	await ensureClaudeLink(robot.path);
	const mount = await mountRobot({
		workspaceRegistry,
		robotPath: robot.path
	});
	return {
		robot: {
			name: robot.name,
			driver: "agent",
			path: robot.path,
			avatar: robot.avatar,
			description: robot.description ?? "",
			createdAt: robot.createdAt,
			assistant: robot.assistant === true
		},
		created,
		updated,
		renamed,
		previousName,
		agentsBytes: request.agents === "" ? 0 : request.agentsBytes,
		...mount
	};
}
/**
* 把任意错误转成可以展示的文本。
*
*/
function describeError$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// .build/robots/reveal.js
/**
* 在系统文件管理器里打开机器人目录。
*
* 「打开 Finder」按钮只把目录交给操作系统，不读写任何文件：macOS 用 `open`，
* Windows 用 `explorer`，其余平台用 `xdg-open`。子进程 detached 且忽略
* stdio，启动成功就返回，不等文件管理器退出（Finder 会一直开着）。
*
* 本模块只依赖 Node 内置模块，便于单独测试平台映射与参数校验。
*
* @module @buka/dsh-plugin-robots/reveal
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
// .build/robots/routes/target.js
/**
* 按 name 解析机器人并确认目录仍在。
*
* 机器人路由与 skills 路由共用的前置步骤：登记表损坏、名称不合法、条目不存在
* 与目录缺失各自映射成稳定的错误码，由调用方按 HTTP 状态码回给页面。
*
* @module @buka/dsh-plugin-robots/routes/target
*/
/**
* 登记文件损坏时的统一错误：写操作必须拒绝，不能覆盖用户文件。
*
*/
function registryUnreadableError(registryFile) {
	return {
		status: 409,
		code: "registry-unreadable",
		message: `机器人登记文件无法读取：${registryFile}。请修复或删除该文件后刷新。`
	};
}
/**
* 按 name 从登记表里取机器人，并确认它的目录还在。
*
*/
async function resolveRobot(registryFile, name) {
	const registry = await readRobotRegistry({ file: registryFile });
	if (registry.corrupt) return { error: registryUnreadableError(registryFile) };
	const trimmed = typeof name === "string" ? name.trim() : "";
	if (!isValidRobotName(trimmed)) return { error: {
		status: 400,
		code: "invalid-name",
		message: `机器人名称不合法：${String(name)}`
	} };
	const robot = registry.robots.find((entry) => entry.name === trimmed);
	if (robot === void 0) return { error: {
		status: 404,
		code: "unknown-robot",
		message: `没有找到这个机器人：${trimmed}`
	} };
	if (robot.driver === "program") return { error: {
		status: 409,
		code: "program-robot",
		message: `program 型机器人只读，不能执行这个操作：${trimmed}`
	} };
	let stat;
	try {
		stat = await promises.stat(robot.path);
	} catch {
		stat = void 0;
	}
	if (stat === void 0 || !stat.isDirectory()) return { error: {
		status: 409,
		code: "missing-directory",
		message: `机器人目录不存在或不是目录：${robot.path}`
	} };
	return { robot };
}
// .build/robots/routes/robots.js
/**
* 「机器人」页面的机器人相关 HTTP 路由。
*
* 负责登记表与目录的机器人管理接口：列表、创建、头像、描述、助理标记、重命名、
* 移除、写 AGENTS.md 与打开 Finder。工作区身份（挂载 / 删除注册 / 打开会话）都由
* 浏览器一半走 DSH Client Service，这里只处理磁盘事实。
*
* program 型机器人（内建 clock）只读：创建 / 删除 / 改名 / 改字段都会被拒绝，
* 助理标记只对 agent 型机器人开放。
*
* @module @buka/dsh-plugin-robots/routes/robots
*/
/** 页面列出机器人用的路由；浏览器一半按同一常量访问。 */
const LIST_ROUTE = "/buka-robots/list";
/** 页面新建机器人用的路由。 */
const CREATE_ROUTE = "/buka-robots/create";
/** 页面给机器人换头像用的路由。 */
const AVATAR_ROUTE = "/buka-robots/avatar";
/** 页面编辑机器人描述用的路由。 */
const DESCRIPTION_ROUTE = "/buka-robots/description";
/** 页面标记 / 取消助理（只有 agent 机器人可设）用的路由。 */
const ASSISTANT_ROUTE = "/buka-robots/assistant";
/** 页面重命名机器人（改目录 + 重建工作区）用的路由。 */
const RENAME_ROUTE = "/buka-robots/rename";
/** 页面删除机器人（只删登记）用的路由。 */
const REMOVE_ROUTE = "/buka-robots/remove";
/** 页面写入 AGENTS.md 用的路由。 */
const AGENTS_ROUTE = "/buka-robots/agents";
/** 页面「打开 Finder」用的路由。 */
const REVEAL_ROUTE = "/buka-robots/reveal";
/**
* 注册机器人管理相关的精确路由。
*
*/
function registerRobotRoutes(hostCtx, webCtx, deps) {
	const { robotsDir, registryFile, serializeRegistry } = deps;
	const ctx = hostCtx;
	/** 把 resolveRobot 的错误写成响应。 */
	function sendRobotError(res, error) {
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
					...await listRobots({
						file: registryFile,
						workspaceRegistry: ctx.workspaceRegistry,
						robotsDir
					})
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-robots: 读取机器人列表失败：%s", describeError$2(error));
				sendError(res, 500, "list-failed", `读取机器人列表失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: GET ${LIST_ROUTE}`);
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
			const name = typeof body?.name === "string" ? body.name.trim() : "";
			if (!isValidRobotName(name)) {
				sendError(res, 400, "invalid-name", "机器人名称不合法：需要 1–64 个字符，不能以点开头，只能包含字母、数字、汉字与 ._-。");
				return;
			}
			if (body?.driver !== void 0 && body.driver !== "agent") {
				sendError(res, 400, "invalid-driver", "只能创建 agent 型机器人；program 型机器人由插件内建登记，不能创建。");
				return;
			}
			const avatar = typeof body?.avatar === "string" ? body.avatar.trim() : "";
			if (body?.description !== void 0 && typeof body.description !== "string") {
				sendError(res, 400, "invalid-description", "description 必须是字符串");
				return;
			}
			const description = typeof body?.description === "string" ? body.description : "";
			try {
				const result = await serializeRegistry(() => addRobot({
					robotsDir,
					file: registryFile,
					name,
					avatar,
					description
				}));
				webCtx.logger?.info?.("buka-robots: 已登记机器人 %s（%s）", result.robot.name, result.robot.path);
				sendJson(res, 200, {
					ok: true,
					robot: result.robot,
					created: result.created
				});
			} catch (error) {
				if (errorCode(error) === "invalid-name") {
					sendError(res, 400, "invalid-name", describeError$2(error));
					return;
				}
				if (errorCode(error) === "invalid-description") {
					sendError(res, 400, "invalid-description", `描述需要不超过 500 个字符的单行文本。`);
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$2(error));
					return;
				}
				if (errorCode(error) === "builtin-robot" || errorCode(error) === "program-robot") {
					sendError(res, 409, String(errorCode(error)), describeError$2(error));
					return;
				}
				webCtx.logger?.warn?.("buka-robots: 创建机器人失败：%s", describeError$2(error));
				sendError(res, 500, "create-failed", `创建机器人失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${CREATE_ROUTE}`);
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
			const name = typeof body?.name === "string" ? body.name.trim() : "";
			if (!isValidRobotName(name)) {
				sendError(res, 400, "invalid-name", `机器人名称不合法：${String(body?.name)}`);
				return;
			}
			const avatar = typeof body?.avatar === "string" ? body.avatar.trim() : "";
			try {
				const result = await serializeRegistry(() => setRobotAvatar({
					file: registryFile,
					name,
					avatar
				}));
				webCtx.logger?.info?.("buka-robots: 机器人 %s 的头像改为 %s", name, avatar);
				sendJson(res, 200, {
					ok: true,
					robot: result.robot
				});
			} catch (error) {
				if (errorCode(error) === "invalid-avatar") {
					sendError(res, 400, "invalid-avatar", describeError$2(error));
					return;
				}
				if (errorCode(error) === "invalid-name") {
					sendError(res, 400, "invalid-name", describeError$2(error));
					return;
				}
				if (errorCode(error) === "unknown-robot") {
					sendError(res, 404, "unknown-robot", describeError$2(error));
					return;
				}
				if (errorCode(error) === "program-robot") {
					sendError(res, 409, "program-robot", describeError$2(error));
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$2(error));
					return;
				}
				webCtx.logger?.warn?.("buka-robots: 修改机器人头像失败：%s", describeError$2(error));
				sendError(res, 500, "avatar-failed", `修改机器人头像失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${AVATAR_ROUTE}`);
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
			const name = typeof body?.name === "string" ? body.name.trim() : "";
			if (!isValidRobotName(name)) {
				sendError(res, 400, "invalid-name", `机器人名称不合法：${String(body?.name)}`);
				return;
			}
			const description = body?.description;
			if (typeof description !== "string") {
				sendError(res, 400, "invalid-description", "description 必须是字符串");
				return;
			}
			try {
				const result = await serializeRegistry(() => setRobotDescription({
					file: registryFile,
					name,
					description
				}));
				webCtx.logger?.info?.("buka-robots: 已更新机器人 %s 的描述", name);
				sendJson(res, 200, {
					ok: true,
					robot: result.robot
				});
			} catch (error) {
				if (errorCode(error) === "invalid-description") {
					sendError(res, 400, "invalid-description", `描述需要不超过 500 个字符的单行文本。`);
					return;
				}
				if (errorCode(error) === "invalid-name") {
					sendError(res, 400, "invalid-name", describeError$2(error));
					return;
				}
				if (errorCode(error) === "unknown-robot") {
					sendError(res, 404, "unknown-robot", describeError$2(error));
					return;
				}
				if (errorCode(error) === "program-robot") {
					sendError(res, 409, "program-robot", describeError$2(error));
					return;
				}
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$2(error));
					return;
				}
				webCtx.logger?.warn?.("buka-robots: 更新机器人描述失败：%s", describeError$2(error));
				sendError(res, 500, "description-failed", `更新机器人描述失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${DESCRIPTION_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: ASSISTANT_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const name = typeof body?.name === "string" ? body.name.trim() : "";
			if (!isValidRobotName(name)) {
				sendError(res, 400, "invalid-name", `机器人名称不合法：${String(body?.name)}`);
				return;
			}
			const assistant = body?.assistant;
			if (typeof assistant !== "boolean") {
				sendError(res, 400, "invalid-assistant", "assistant 必须是布尔值");
				return;
			}
			try {
				const result = await serializeRegistry(() => setRobotAssistant({
					file: registryFile,
					name,
					assistant
				}));
				webCtx.logger?.info?.("buka-robots: 机器人 %s 的助理标记改为 %s", name, String(assistant));
				sendJson(res, 200, {
					ok: true,
					robot: result.robot
				});
			} catch (error) {
				switch (errorCode(error)) {
					case "invalid-name":
					case "invalid-assistant":
						sendError(res, 400, String(errorCode(error)), describeError$2(error));
						return;
					case "unknown-robot":
						sendError(res, 404, "unknown-robot", describeError$2(error));
						return;
					case "program-robot":
						sendError(res, 409, "program-robot", describeError$2(error));
						return;
					case "registry-unreadable":
						sendError(res, 409, "registry-unreadable", describeError$2(error));
						return;
					default:
						webCtx.logger?.warn?.("buka-robots: 修改助理标记失败：%s", describeError$2(error));
						sendError(res, 500, "assistant-failed", `修改助理标记失败：${describeError$2(error)}`);
				}
			}
		}
	}), `buka-robots: POST ${ASSISTANT_ROUTE}`);
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
			const name = typeof body?.name === "string" ? body.name.trim() : "";
			const newName = typeof body?.newName === "string" ? body.newName.trim() : "";
			if (!isValidRobotName(name)) {
				sendError(res, 400, "invalid-name", `机器人名称不合法：${String(body?.name)}`);
				return;
			}
			if (!isValidRobotName(newName)) {
				sendError(res, 400, "invalid-name", `新机器人名称不合法：${String(body?.newName)}`);
				return;
			}
			if (name === newName) {
				sendError(res, 400, "invalid-name", "新名称与当前名称相同");
				return;
			}
			try {
				const result = await serializeRegistry(() => buildRobot({
					robotsDir,
					file: registryFile,
					name,
					newName,
					update: true,
					workspaceRegistry: ctx.workspaceRegistry
				}));
				webCtx.logger?.info?.("buka-robots: 机器人 %s 已重命名为 %s（%s）", name, result.robot.name, result.robot.path);
				const agents = await readAgentsFile(result.robot.path);
				sendJson(res, 200, {
					ok: true,
					previousName: result.previousName,
					renamed: result.renamed,
					robot: result.robot,
					agents,
					mounted: result.mounted,
					workspaceId: typeof result.workspaceId === "string" ? result.workspaceId : null,
					mountError: result.mountError
				});
			} catch (error) {
				switch (errorCode(error)) {
					case "invalid-name":
						sendError(res, 400, "invalid-name", describeError$2(error));
						return;
					case "invalid-update":
						sendError(res, 400, "invalid-update", describeError$2(error));
						return;
					case "unknown-robot":
						sendError(res, 404, "unknown-robot", describeError$2(error));
						return;
					case "name-taken":
						sendError(res, 409, "name-taken", describeError$2(error));
						return;
					case "missing-directory":
						sendError(res, 409, "missing-directory", describeError$2(error));
						return;
					case "path-outside-root":
						sendError(res, 409, "path-outside-root", describeError$2(error));
						return;
					case "registry-unreadable":
						sendError(res, 409, "registry-unreadable", describeError$2(error));
						return;
					case "builtin-robot":
						sendError(res, 409, "builtin-robot", describeError$2(error));
						return;
					case "program-robot":
						sendError(res, 409, "program-robot", describeError$2(error));
						return;
					default:
						webCtx.logger?.warn?.("buka-robots: 重命名机器人失败：%s", describeError$2(error));
						sendError(res, 500, "rename-failed", `重命名机器人失败：${describeError$2(error)}`);
				}
			}
		}
	}), `buka-robots: POST ${RENAME_ROUTE}`);
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
			const name = typeof body?.name === "string" ? body.name.trim() : "";
			if (!isValidRobotName(name)) {
				sendError(res, 400, "invalid-name", `机器人名称不合法：${String(body?.name)}`);
				return;
			}
			try {
				const result = await serializeRegistry(() => removeRobot({
					file: registryFile,
					name
				}));
				if (result.removed) webCtx.logger?.info?.("buka-robots: 已移除机器人登记 %s", name);
				sendJson(res, 200, {
					ok: true,
					name,
					removed: result.removed
				});
			} catch (error) {
				if (errorCode(error) === "registry-unreadable") {
					sendError(res, 409, "registry-unreadable", describeError$2(error));
					return;
				}
				if (errorCode(error) === "builtin-robot" || errorCode(error) === "program-robot") {
					sendError(res, 409, String(errorCode(error)), describeError$2(error));
					return;
				}
				webCtx.logger?.warn?.("buka-robots: 移除机器人失败：%s", describeError$2(error));
				sendError(res, 500, "remove-failed", `移除机器人失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${REMOVE_ROUTE}`);
	webCtx.effect(() => webCtx.webServer.register({
		kind: "exact",
		path: AGENTS_ROUTE,
		handler: async (req, res) => {
			if (rejected(webCtx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			const body = await readJsonBody(req, res);
			if (body === void 0) return;
			const resolved = await resolveRobot(registryFile, body?.name);
			if (resolved.error !== void 0) {
				sendRobotError(res, resolved.error);
				return;
			}
			if (typeof body?.content !== "string") {
				sendError(res, 400, "invalid-content", "content 必须是字符串");
				return;
			}
			if (Buffer.byteLength(body.content, "utf8") > 524288) {
				sendError(res, 413, "too-large", `AGENTS.md 内容超过 ${Math.round(AGENTS_MAX_WRITE_BYTES / 1024)} KiB，请用外部编辑器修改。`);
				return;
			}
			try {
				const saved = await writeAgentsFile(resolved.robot.path, body.content);
				const claude = await ensureClaudeLink(resolved.robot.path);
				webCtx.logger?.info?.("buka-robots: 已保存 AGENTS.md（%s）", resolved.robot.path);
				sendJson(res, 200, {
					ok: true,
					...saved,
					claude
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-robots: 写入 AGENTS.md 失败：%s", describeError$2(error));
				sendError(res, 500, "write-failed", `写入 AGENTS.md 失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${AGENTS_ROUTE}`);
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
			const resolved = await resolveRobot(registryFile, body?.name);
			if (resolved.error !== void 0) {
				sendRobotError(res, resolved.error);
				return;
			}
			try {
				await revealDirectory(resolved.robot.path);
				webCtx.logger?.info?.("buka-robots: 已打开机器人目录（%s）", resolved.robot.path);
				sendJson(res, 200, {
					ok: true,
					path: resolved.robot.path
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-robots: 打开机器人目录失败：%s", describeError$2(error));
				sendError(res, 500, "reveal-failed", `打开机器人目录失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${REVEAL_ROUTE}`);
}
// .build/robots/routes/skills.js
/**
* 「机器人」页面的项目级 skills 路由。
*
* 页面在这里列出某个来源里可安装的 skills、安装勾选项、移除已安装项；命令都
* 在机器人目录里用 `npx skills` 执行，安装时同时落 `.agents/skills` 与
* `.claude/skills`。命令输出只用于给人看，所以失败时把输出原样带回页面。
*
* @module @buka/dsh-plugin-robots/routes/skills
*/
/** 页面列出来源里可安装的 skills 用的路由。 */
const AVAILABLE_ROUTE = "/buka-robots/skills/available";
/** 页面安装项目级 skill 用的路由。 */
const INSTALL_ROUTE = "/buka-robots/skills/install";
/** 页面移除项目级 skill 用的路由。 */
const SKILL_REMOVE_ROUTE = "/buka-robots/skills/remove";
/** `add --list` 的输出需要整段解析，给列清单的 runner 单独放宽上限。 */
const LIST_OUTPUT_BYTES = 262144;
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
	const runNpxList = createNpxRunner({
		timeoutMs: NPX_TIMEOUT_MS,
		maxOutputBytes: LIST_OUTPUT_BYTES,
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
	/** 把 resolveRobot 的错误写成响应。 */
	function sendRobotError(res, error) {
		sendError(res, error.status, error.code, error.message);
	}
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
			const resolved = await resolveRobot(registryFile, body?.name);
			if (resolved.error !== void 0) {
				sendRobotError(res, resolved.error);
				return;
			}
			const source = typeof body?.source === "string" ? body.source.trim() : "";
			if (source === "" || source.length > MAX_SOURCE_LENGTH || CONTROL_CHARS.test(source)) {
				sendError(res, 400, "invalid-source", `skill 来源不合法：需要 1–${MAX_SOURCE_LENGTH} 个字符且不含控制字符。`);
				return;
			}
			try {
				const result = await serializeNpx(() => runNpxList([
					"add",
					source,
					"--list"
				], resolved.robot.path));
				if (!result.ok) {
					sendJson(res, 502, {
						ok: false,
						code: "npx-failed",
						message: result.message ?? "npx skills add --list 失败",
						output: result.output ?? ""
					});
					return;
				}
				const candidates = parseSkillList(result.output);
				if (candidates.length === 0) {
					sendJson(res, 502, {
						ok: false,
						code: "list-unparsed",
						message: "无法从这个来源读出 skill 清单，请检查来源后重试。",
						output: result.output ?? ""
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.robot.path);
				webCtx.logger?.info?.("buka-robots: 已读取 skill 清单（%s ← %s，%d 个）", resolved.robot.path, source, candidates.length);
				sendJson(res, 200, {
					ok: true,
					source,
					skills: candidates,
					installed: scanned.skills.map((skill) => skill.name)
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-robots: 读取 skill 清单失败：%s", describeError$2(error));
				sendError(res, 500, "available-failed", `读取 skill 清单失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${AVAILABLE_ROUTE}`);
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
			const resolved = await resolveRobot(registryFile, body?.name);
			if (resolved.error !== void 0) {
				sendRobotError(res, resolved.error);
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
			try {
				const args = ["add", source];
				for (const skill of selected) args.push("--skill", skill);
				args.push("-a", "universal", "-a", "claude-code", "-y");
				const result = await serializeNpx(() => runNpx(args, resolved.robot.path));
				if (!result.ok) {
					sendJson(res, 502, {
						ok: false,
						code: "npx-failed",
						message: result.message ?? "npx skills add 失败",
						output: result.output ?? ""
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.robot.path);
				const claude = await ensureClaudeLink(resolved.robot.path);
				webCtx.logger?.info?.("buka-robots: 已安装 %d 个 skill（%s ← %s）", selected.length, resolved.robot.path, source);
				sendJson(res, 200, {
					ok: true,
					output: result.output ?? "",
					skills: scanned.skills,
					claude
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-robots: 安装 skill 失败：%s", describeError$2(error));
				sendError(res, 500, "install-failed", `安装 skill 失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${INSTALL_ROUTE}`);
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
			const resolved = await resolveRobot(registryFile, body?.name);
			if (resolved.error !== void 0) {
				sendRobotError(res, resolved.error);
				return;
			}
			const skillName = normalizeSkillName(body?.skill);
			if (skillName === null) {
				sendError(res, 400, "invalid-skill", `skill 名称不合法：${String(body?.skill)}`);
				return;
			}
			try {
				const result = await serializeNpx(() => runNpx([
					"remove",
					skillName,
					"-y"
				], resolved.robot.path));
				if (!result.ok) {
					sendJson(res, 502, {
						ok: false,
						code: "npx-failed",
						message: result.message ?? "npx skills remove 失败",
						output: result.output ?? ""
					});
					return;
				}
				const scanned = await scanProjectSkills(resolved.robot.path);
				webCtx.logger?.info?.("buka-robots: 已移除 skill（%s ← %s）", resolved.robot.path, skillName);
				sendJson(res, 200, {
					ok: true,
					output: result.output ?? "",
					skills: scanned.skills
				});
			} catch (error) {
				webCtx.logger?.warn?.("buka-robots: 移除 skill 失败：%s", describeError$2(error));
				sendError(res, 500, "remove-failed", `移除 skill 失败：${describeError$2(error)}`);
			}
		}
	}), `buka-robots: POST ${SKILL_REMOVE_ROUTE}`);
}
// .build/robots/routes.js
/**
* 「机器人」页面的 HTTP 路由装配。
*
* 路由本身按职责拆在 `routes/robots.ts` 与 `routes/skills.ts`；这里只做两件事：
* 等 `webServer` / `connection` 就绪，然后把两组精确路由注册到同一个 web
* 上下文上。
*
* @module @buka/dsh-plugin-robots/routes
*/
/**
* 在 `webServer` 就绪后注册页面用到的全部精确路由。
*
*/
function registerRoutes(ctx, deps) {
	ctx.inject(["webServer", "connection"], (webCtx) => {
		registerRobotRoutes(ctx, webCtx, deps);
		registerSkillRoutes(webCtx, deps);
	});
}
/**
* 预设机器人清单（按显示顺序）。
*
*/
const PRESET_ROBOTS = Object.freeze([{
	name: "软件工程师",
	avatar: "rocket",
	description: "负责软件功能的设计与实现：写代码、修 bug、重构、跑测试、整理提交；用于编码、实现需求、修缺陷等开发任务。",
	agents: `# AGENTS.md

这是「软件工程师」机器人的协作说明。这个目录同时是一个 DSH 工作区。

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
	name: "质量保障工程师",
	avatar: "owl",
	description: "负责质量保障：设计并执行测试、检查覆盖率、回归验证、审查变更是否引入风险；用于测试、验收、质量把关等任务。",
	agents: `# AGENTS.md

这是「质量保障工程师」机器人的协作说明。这个目录同时是一个 DSH 工作区。

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
* 全新安装时把预设机器人补进登记表（幂等）。
*
* 只在登记表**一个机器人都没有**时才做种子初始化：这样全新安装立刻有两个
* 起步机器人，而已有机器人的用户不会被塞进预设，删除预设后也不会在下次启动
* 被补回。登记表损坏时直接拒绝，绝不覆盖用户文件。
*
*/
async function seedPresetRobots({ robotsDir, file, workspaceRegistry } = {}) {
	const registry = await readRobotRegistry({ file });
	if (registry.corrupt) return {
		corrupt: true,
		seeded: []
	};
	if (registry.robots.filter((robot) => robot.driver === "agent").length > 0) return {
		corrupt: false,
		seeded: []
	};
	const seeded = [];
	for (const preset of PRESET_ROBOTS) {
		const result = await buildRobot({
			robotsDir,
			file,
			name: preset.name,
			avatar: preset.avatar,
			description: preset.description,
			agents: preset.agents,
			workspaceRegistry
		});
		if (result.created) seeded.push(result.robot.name);
	}
	return {
		corrupt: false,
		seeded
	};
}
// .build/robots/seed.js
/**
* 全新安装时的预设机器人初始化。
*
* 登记表为空时补上「软件工程师」与「质量保障工程师」两个预设机器人；与页面上的
* 首次新建共用同一个登记表写队列，避免抢写。初始化异步完成、不阻塞启动，失败
* 只记日志。
*
* @module @buka/dsh-plugin-robots/seed
*/
/**
* 在登记表为空时初始化预设机器人；`enabled: false` 时跳过。
*
*/
function seedRobotsOnStartup({ ctx, robotsDir, registryFile, serializeRegistry, enabled }) {
	if (!enabled) return;
	serializeRegistry(() => seedPresetRobots({
		robotsDir,
		file: registryFile,
		workspaceRegistry: ctx.workspaceRegistry
	}).then((result) => {
		if (result.seeded.length > 0) ctx.logger?.info?.("buka-robots: 已初始化预设机器人：%s", result.seeded.join("、"));
	})).catch((error) => {
		ctx.logger?.warn?.("buka-robots: 初始化预设机器人失败：%s", describeError$2(error));
	});
}
// .build/robots/engine/errors.js
/**
* 机器人会话的内部错误类型。
*
* @module @buka/dsh-plugin-robots/engine/errors
*/
/** 机器人会话被超时 / 取消时抛出的内部错误。 */
var RobotSessionStop = class extends Error {
	/** 停止原因：超时或取消。 */
	kind;
	/**
	*/
	constructor(kind, message) {
		super(message);
		this.name = "RobotSessionStop";
		this.kind = kind;
	}
};
// .build/robots/engine/session-events.js
/**
* 机器人会话日志的读取。
*
* 只按字段读 DSH 的会话事件（`assistant/message` / `turn/end`），不依赖上游
* 事件类型的完整定义，这样本模块可以脱离 DSH 依赖被 `node --test` 直接 import。
*
* @module @buka/dsh-plugin-robots/engine/session-events
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
// .build/robots/engine/session-runtime.js
/**
* 机器人会话的运行时小工具：等取消落定、组装消息、合并模型路由。
*
* 服务是非阻塞的：不再等轮次结束（观察者订阅会话事件），这里只保留真正被
* 调用到的函数；这些函数不读写服务状态，只操作传进来的 live agent。
*
* @module @buka/dsh-plugin-robots/engine/session-runtime
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
* 一件完整的 user 消息：`followup` 要求 `role` 与 `id`，否则会话历史在请求
* 模型时无法转换成消息。
*
*/
function followupMessage(text, sourceKind = "buka-robot") {
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
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
// .build/robots/engine/summary.js
/**
* 机器人列表的摘要投影。
*
* @module @buka/dsh-plugin-robots/engine/summary
*/
/**
* 机器人列表里的一行：去掉 AGENTS.md 正文等大字段，只保留编排需要的摘要。
*
* `driver` / `assistant` / `program` 是工作流的执行者契约：agent 型可以开会话，
* program 型（clock）由工作流按 `program` 驱动、不建会话。program 型没有目录，
* `exists` / `mounted` 恒为 false，`skills` 为空。
*
*/
function summarizeRobot(robot) {
	const agents = robot?.agents ?? {};
	return {
		name: robot?.name ?? "",
		driver: robot?.driver === "program" ? "program" : "agent",
		program: typeof robot?.program === "string" ? robot.program : "",
		assistant: robot?.assistant === true,
		path: robot?.path ?? "",
		createdAt: robot?.createdAt ?? null,
		avatar: resolveAvatar(robot?.avatar, robot?.name),
		description: typeof robot?.description === "string" ? robot.description : "",
		exists: robot?.exists === true,
		mounted: robot?.mounted === true,
		workspaceId: robot?.workspaceId ?? null,
		skills: Array.isArray(robot?.skills) ? robot.skills.map((skill) => ({
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
// .build/robots/service.js
/**
* `@buka/dsh-plugin-robots` 对外提供的 Host Service：`ctx.bukaRobots`。
*
* 能力（工作流插件与将来的编排器使用）：
*
* - `list()`：机器人登记表 + 目录状态 + 挂载状态 + 已装 skills，摘要里带
*   `driver`（agent / program）/ `assistant` / `program`；
* - `avatarMap()`：机器人名 → 预设头像 id（只读登记表，工作流节点图用它）；
* - `dispatchSession(request)`：在机器人目录下**新开**一条会话并投递一段提示词，
*   立即返回观测句柄；不在服务里等待这一轮结束，也不设默认超时；
* - `openSession(request)`：只续接（resume / attach）一条已有会话，不发 prompt；
*   观察者恢复时先用它检查上一轮是否其实已经结束，确认要继续时再调句柄的
*   `send`。
*
* 一个任务一条新会话：`dispatchSession` 不复用上一条任务的会话；`openSession`
* 只续接同一条会话，**不压缩**。压缩、结构化结果校验与结果追问都在工作流侧
* （`buka_task_complete`），本服务不再注册 `structured_output` 工具。
*
* program 型机器人（clock）没有会话：`dispatchSession` / `openSession` 会拒绝
* 它们，执行由工作流按 `driver` + `program` 驱动。
*
* 唯一的会话后端是普通顶层会话：`cwd` 是机器人目录，机器人自己的 AGENTS.md /
* 项目 skills 照常生效，会话挂到机器人工作区并出现在 DSH 侧边栏。创建或续接
* 失败时直接抛错，不退回 subagent 子会话，也不另开新会话。
*
* 通过 `ctx.provide('bukaRobots', new RobotSessionService(...))` 注册，消费方
* 用 `inject: ['bukaRobots']` 或 `ctx.get('bukaRobots')` 获取。
*
* @module @buka/dsh-plugin-robots/service
*/
/** 服务名；消费方用 `inject: [SERVICE_NAME]`，运行时读 `ctx.bukaRobots`。 */
const SERVICE_NAME = "bukaRobots";
/** plan 模式入口不可用时给用户看的错误文案。 */
const PLAN_MODE_UNAVAILABLE = "plan mode is unavailable in this composition; install or update @deepseek-ai/dsh-plan-mode to use a robot node with mode \"plan\"";
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
var RobotSessionService = class {
	/** Host 上下文：取 agents / approval 等可选服务。 */
	ctx;
	/** 机器人根目录。 */
	robotsDir;
	/** 登记文件绝对路径。 */
	registryFile;
	/** 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。 */
	supportsPlanMode;
	/**
	*/
	constructor(options) {
		this.ctx = options.ctx;
		this.robotsDir = options.robotsDir;
		this.registryFile = options.registryFile;
		/**
		* 能力标志：本版本支持在 dispatch / resume 时切换 DSH plan 模式。工作流的
		* plan 节点在启动前用它判断是否需要提示用户升级 robots 插件；旧版本没有
		* 这个字段，planMode 请求会被静默忽略。
		*/
		this.supportsPlanMode = true;
	}
	/**
	* 列出机器人。
	*
	*/
	async list() {
		const snapshot = await listRobots({
			file: this.registryFile,
			workspaceRegistry: this.ctx?.workspaceRegistry,
			robotsDir: this.robotsDir
		});
		return {
			root: snapshot.root,
			registry: snapshot.registry,
			corrupt: snapshot.corrupt,
			robots: snapshot.robots.map((robot) => summarizeRobot(robot))
		};
	}
	/**
	* 机器人名 → 头像 id。给工作流这类只关心「谁在执行」的消费方用：只读登记表，
	* 不扫描每个机器人目录里的 skills / AGENTS.md，所以可以频繁调用。
	*
	* 内建 program 机器人（clock）也在这里，工作流把它画在节点上。旧登记表里
	* 缺头像的机器人按名字兜底成一个确定的预设。登记表损坏时返回空表。
	*
	*/
	async avatarMap() {
		const registry = await readRobotRegistry({ file: this.registryFile });
		const map = {};
		if (!registry.corrupt) for (const robot of withBuiltinRobots(registry.robots)) map[robot.name] = resolveAvatar(robot.avatar, robot.name);
		return map;
	}
	/**
	* 非阻塞地把一段 prompt 投进一条**新的**机器人会话，返回一个可观测句柄；
	* 不在服务里等待这一轮结束，也不设默认超时。工作流观察者负责订阅
	* `session/event` 并在 `turn/end` 后读结果、决定路由；会话异常终止时由观察者
	* 重新 open/dispatch。硬超时由调用方（观察者）自己计时后调用句柄的 `cancel()`。
	*
	* 一个任务一条新会话：这里不接受 `sessionId`，恢复只能走 `openSession`。
	*
	*/
	async dispatchSession(request = {}) {
		if (typeof request.prompt !== "string" || request.prompt.trim() === "") throw new Error("dispatchSession requires a non-empty prompt");
		if ("sessionId" in request && request.sessionId !== void 0) throw new Error("dispatchSession always starts a new robot session; use openSession() to resume an existing session");
		this.#assertPlanModeRequest(request);
		const robot = await this.#resolveRobot(request.robot);
		const agentOptions = mergeAgentOptions(this.#defaultAgentOptions(), request.agentOptions);
		if (typeof agentOptions.provider !== "string" || typeof agentOptions.model !== "string") throw new Error("no model route is available for the robot session: pass agentOptions.provider/model or configure a default model");
		const signal = request.signal;
		signal?.throwIfAborted?.();
		return await this.#startDispatch({
			request,
			robot,
			agentOptions,
			signal
		});
	}
	/**
	* 只打开（resume / attach）一条已有机器人会话，不发 prompt、不压缩。观察者
	* 恢复时先用它检查上一轮是否其实已经结束；确认要继续时再调句柄的 `send`。
	*
	*/
	async openSession(request = {}) {
		const sessionId = typeof request.sessionId === "string" ? request.sessionId.trim() : "";
		if (sessionId === "") throw new Error("openSession requires a sessionId");
		this.#assertPlanModeRequest(request);
		const robot = await this.#resolveRobot(request.robot);
		const agentOptions = mergeAgentOptions(this.#defaultAgentOptions(), request.agentOptions);
		if (typeof agentOptions.provider !== "string" || typeof agentOptions.model !== "string") throw new Error("no model route is available for the robot session: pass agentOptions.provider/model or configure a default model");
		const signal = request.signal;
		signal?.throwIfAborted?.();
		const prepared = await this.#resumeAgent({
			request,
			robot,
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
			robot,
			resumed: true,
			startSeq: seqOf(prepared.agent)
		});
	}
	/**
	* 把创建失败包装成给用户看的错误：说明没有隐藏兜底、也没有替代会话。
	*
	*/
	#creationError(robot, error, signal) {
		if (signal?.aborted === true) return error instanceof Error ? error : new Error(describeError(error));
		return new Error(`could not create a visible robot session for robot "${robot.name}": ${describeError(error)}; refusing to fall back to a hidden subagent or a replacement session`, { cause: error });
	}
	/**
	* 用调用方给的 `title` 给机器人会话命名。
	*
	* 机器人会话的第一条用户消息来源是 `buka-robot`，而 DSH 的自动标题只看
	* `source.kind === 'user'` 的消息，所以这类会话不会自己长出标题：侧边栏与
	* 会话列表里一直显示「未命名」。工作流进入节点时会把「运行目标 · 机器人」
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
			this.ctx?.logger?.warn?.(`buka-robots: could not title robot session "${String(session?.id ?? "")}": ${describeError(error)}`);
		}
	}
	/**
	* 给新会话 / 续接会话装上机器人自己的工作 preset。
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
	* 新建一个普通顶层机器人会话并完成标题、审批策略、工作区挂载；不发送 prompt。
	*
	*/
	async #createVisibleAgent({ request, robot, agentOptions, signal }) {
		const agents = optionalService(this.ctx, "agents");
		if (typeof agents?.create !== "function") throw new Error("the agent service is unavailable, so a robot session cannot be created");
		const requestedSessionId = typeof request.newSessionId === "string" ? request.newSessionId.trim() : "";
		const sessionId = requestedSessionId !== "" ? requestedSessionId : randomUUID();
		const requestedPreset = typeof request.agentPreset === "string" ? request.agentPreset.trim() : "";
		const handle = await agents.create({
			sessionId,
			meta: {
				cwd: robot.path,
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
		await this.#attachSessionToWorkspace(sessionId, robot);
		return {
			sessionId,
			agent,
			handle
		};
	}
	/**
	* resume 一条已有机器人会话并完成标题、审批策略、工作区挂载；不发 prompt、
	* 不压缩（一个任务一条会话，恢复只续接同一条）。
	*
	* 续接出来的会话是**运行时根会话**：DSH 的人类交互要求根 agent，所以这里
	* 不传 `parentAgent`（与 `agents.create` 的顶层会话一致）。历史会话如果是
	* 旧版 `origin: 'subagent'` 的隐藏会话，直接拒绝：dispose 后抛错，不新开。
	*
	*/
	async #resumeAgent({ request, robot, agentOptions, signal, sessionId }) {
		const agents = optionalService(this.ctx, "agents");
		if (typeof agents?.resume !== "function") throw new Error("the agent service cannot resume a robot session in this composition");
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
			if (signal?.aborted === true) throw new RobotSessionStop("aborted", "robot session was cancelled");
			throw new Error(`could not resume robot session "${sessionId}" for robot "${robot.name}": ${describeError(error)}; refusing to start a new robot session`, { cause: error });
		}
		const agent = handle.agent;
		await this.#assertVisibleAgent(agent, handle);
		this.#titleSession(agent, request.title);
		if (request.approval === "never") try {
			this.ctx?.get?.("approval")?.setPolicy?.(agent, "never");
		} catch {}
		await this.#attachSessionToWorkspace(sessionId, robot);
		return {
			sessionId,
			agent,
			handle
		};
	}
	/**
	* 拒绝 DSH 侧边栏不显示的隐藏会话（`origin: 'subagent'`）。
	*
	* 旧版本的工作流兜底可能把机器人节点落成 subagent 子会话；这类会话即使
	* 打开也只在主区域显示，不能作为工作流节点会话。命中时先释放 agent，再抛错。
	*
	*/
	async #assertVisibleAgent(agent, handle) {
		if (agent?.session?.header?.origin !== "subagent") return;
		await disposeHandle(handle);
		throw new Error("refusing to use a hidden subagent robot session; robot sessions must be visible top-level sessions");
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
					this.ctx?.logger?.warn?.(`buka-robots: /plan off reported "${failure}" for robot session "${String(agent?.id ?? "")}"`);
				}
			}
		} catch (error) {
			if (requested === true) throw error;
			this.ctx?.logger?.warn?.(`buka-robots: could not leave plan mode for robot session "${String(agent?.id ?? "")}": ${describeError(error)}`);
		}
	}
	/**
	* 新会话的非阻塞 dispatch：建会话、投 prompt、返回句柄；不等待这一轮结束。
	*
	*/
	async #startDispatch({ request, robot, agentOptions, signal }) {
		let prepared;
		try {
			prepared = await this.#createVisibleAgent({
				request,
				robot,
				agentOptions,
				signal
			});
		} catch (error) {
			throw this.#creationError(robot, error, signal);
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
		prepared.agent.followup(followupMessage(request.prompt ?? ""));
		return this.#observeHandle({
			agent: prepared.agent,
			handle: prepared.handle,
			sessionId: prepared.sessionId,
			robot,
			resumed: false,
			startSeq
		});
	}
	/**
	* 把一次非阻塞 dispatch / open 包装成观察者句柄。句柄只持有这一个 live agent
	* 的操作，不负责等待；`readResult` 从会话日志读，`cancel` 只取消当前轮。
	*
	*/
	#observeHandle({ agent, handle, sessionId, robot, resumed, startSeq }) {
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
			robot: robot.name,
			cwd: robot.path,
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
					service.ctx?.logger?.warn?.(`buka-robots: could not read plan mode for session "${observer.sessionId}": ${describeError(error)}`);
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
					service.ctx?.logger?.warn?.(`buka-robots: could not ${active === true ? "enter" : "leave"} plan mode for robot session "${observer.sessionId}": ${describeError(error)}`);
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
						reason: typeof reason === "string" && reason !== "" ? reason : "robot session cancelled"
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
	* 把刚释放 agent 的机器人会话重新通告给客户端（`api-session/added`）。
	*
	* DSH 在 `session/disposed` 时会向客户端发 `api-session/removed`，而机器人
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
			ctx.logger?.warn?.(`buka-robots: could not read the session list while re-announcing robot session "${id}": ${describeError(error)}`);
			return;
		}
		if (summary === void 0) return;
		try {
			ctx.emit("api-session/added", summary);
		} catch (error) {
			ctx.logger?.warn?.(`buka-robots: could not re-announce robot session "${id}" after releasing its agent: ${describeError(error)}`);
		}
	}
	/**
	* 把机器人会话挂到机器人自己的工作区。会话 header 的 `cwd` 必须等于工作区
	* 路径（DSH 的 attach 会校验），机器人目录正好满足。
	*
	* 挂不上（例如机器人还没挂载成工作区）不算致命错误：会话仍能通过 runId /
	* 页面打开，只是不会出现在侧边栏。
	*
	*/
	async #attachSessionToWorkspace(sessionId, robot) {
		const registry = this.ctx?.get?.("workspaceRegistry") ?? this.ctx?.workspaceRegistry;
		if (registry === void 0 || registry === null) return;
		try {
			let workspace;
			if (typeof registry.resolveByPath === "function") workspace = await registry.resolveByPath(robot.path);
			if (workspace === void 0 || workspace === null) {
				if (typeof registry.list === "function") {
					const list = registry.list();
					workspace = Array.isArray(list) ? list.find((entry) => entry?.path === robot.path) : void 0;
				}
			}
			if (workspace !== void 0 && workspace !== null && typeof workspace.attachSession === "function") await workspace.attachSession(sessionId);
		} catch (error) {
			this.ctx?.logger?.warn?.(`buka-robots: could not attach robot session "${sessionId}" to the robot workspace: ${describeError(error)}`);
		}
	}
	/**
	* 解析机器人名称并在登记表 / 磁盘上确认。
	*
	* program 型机器人没有目录、也不建会话：它们由工作流按 `program` 驱动，
	* 这里直接拒绝，让调用方知道该走 program 路径。
	*
	*/
	async #resolveRobot(name) {
		const trimmed = typeof name === "string" ? name.trim() : "";
		if (!isValidRobotName(trimmed)) throw new Error(`invalid robot name: ${String(name)}`);
		const registry = await readRobotRegistry({ file: this.registryFile });
		if (!registry.corrupt) {
			const robot = registry.robots.find((entry) => entry.name === trimmed);
			if (robot !== void 0) {
				if (robot.driver === "program") throw new Error(`robot "${robot.name}" is a program robot and has no session; drive it by its "program" id instead of dispatching a session`);
				let stat;
				try {
					stat = await promises.stat(robot.path);
				} catch {
					stat = void 0;
				}
				if (stat === void 0 || !stat.isDirectory()) throw new Error(`robot directory does not exist: ${robot.path}`);
				return {
					name: robot.name,
					path: robot.path
				};
			}
		}
		if (registry.corrupt) throw new Error(`robot registry is unreadable: ${this.registryFile}`);
		throw new Error(`unknown robot: ${trimmed}`);
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
// .build/robots/build-tool.js
/**
* `buka_robot_build` 工具的定义与执行包装。
*
* 放在独立模块里，`defineTool` 与真正的构建函数都由入口注入（与 `service.js`
* 一致），这样工具的参数 / 结果映射可以脱离 DSH 运行时用假 `defineTool` 单测；
* 可见性判定与登记表串行队列留在 `index.js`，那里才知道 `sessions` /
* `agentPresets` 服务与队列。
*
* 工具只对「机器人构建」preset 的根会话可见（由入口的 `when` 与
* `assertAccess` 保证）；页面上的新建 / 配置流程不受影响。
*
* @module @buka/dsh-plugin-robots/build-tool
*/
/** 工具名；入口注册与日志都用它。 */
const ROBOT_BUILD_TOOL_NAME = "buka_robot_build";
/**
* 构造 `buka_robot_build` 工具。
*
*/
function createRobotBuildTool({ defineTool, avatarIds, runBuild, assertAccess } = {}) {
	if (typeof defineTool !== "function") throw new TypeError("createRobotBuildTool: defineTool is required");
	if (typeof runBuild !== "function") throw new TypeError("createRobotBuildTool: runBuild is required");
	if (typeof assertAccess !== "function") throw new TypeError("createRobotBuildTool: assertAccess is required");
	const avatars = Array.isArray(avatarIds) && avatarIds.length > 0 ? avatarIds.join(", ") : "";
	return defineTool({
		name: ROBOT_BUILD_TOOL_NAME,
		description: `Create, update or rename one robot of the Buka Robots plugin and mount it as a DSH workspace. A robot is a directory the plugin manages (by default ~/.cache/dsh-plugin-robots/robots/<name>) whose AGENTS.md tells every session in it who the robot is and how it works. Use this only in the robot-builder preset, after understanding what the user wants the robot to do and after showing them the proposed name, avatar, description and AGENTS.md and getting their approval. Call buka_robots first so you do not duplicate an existing robot. The tool creates the directory, registers the robot, writes the provided AGENTS.md (the plugin template is used when agents is omitted on create), keeps the CLAUDE.md link, and mounts the robot as a workspace. An existing robot name is rejected unless update: true is passed; pass it only when the user asked to change that robot, and omit the fields that should stay unchanged. To rename that existing robot, also pass newName: the directory is renamed and its DSH workspace is re-registered at the new path, so earlier conversations stay in history but are no longer listed under the robot — confirm the new name with the user first. Installing project-level skills is a page action (Robots page → the robot → 技能) and is not done by this tool; recommend sources instead. Each robot also needs a one-sentence description: it is what a workflow orchestrator reads to decide whether to delegate a node to that robot (like a skill description). Avatar ids: ${avatars}. Robots created here are agent robots; the assistant flag starts false and can be turned on for an agent robot on the Robots page.`,
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Robot name: 1-64 characters, letters, digits or Chinese plus \".\", \"_\" and \"-\"; it becomes the directory name and the mounted workspace title."
			},
			avatar: {
				type: "string",
				description: "Optional avatar id from the list in the description. Omit to let the plugin pick one that is not used yet."
			},
			description: {
				type: "string",
				required: true,
				description: "One sentence describing what this robot does and when to use it; a workflow orchestrator reads it to pick robots for nodes. Empty string keeps the current description when update: true (and leaves it empty on create)."
			},
			agents: {
				type: "string",
				description: "Complete AGENTS.md markdown (role, inputs, workflow, output format, boundaries). Omit on create to keep the plugin template; omit on update to keep the current file."
			},
			update: {
				type: "boolean",
				description: "Set true only when the user asked to change a robot that already exists. Without it, an existing name is rejected."
			},
			newName: {
				type: "string",
				description: "Optional new name when the user asked to rename an existing robot: pass name as the current name, newName as the new one, and update: true. Renaming moves the robot directory and re-registers its DSH workspace; earlier conversations stay in history but are no longer listed under the robot, so confirm with the user first. Same rules as name: 1-64 characters, letters, digits or Chinese plus \".\", \"_\" and \"-\"."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					name: {
						type: "string",
						required: true,
						description: "Robot name."
					},
					path: {
						type: "string",
						required: true,
						description: "Absolute robot directory."
					},
					avatar: {
						type: "string",
						required: true,
						description: "Avatar id stored for the robot."
					},
					description: {
						type: "string",
						required: true,
						description: "One-sentence description stored for the robot; empty when none was set."
					},
					assistant: {
						type: "boolean",
						required: true,
						description: "Whether the robot is marked as an assistant. Robots created by this tool are agent robots and start with false."
					},
					created: {
						type: "boolean",
						required: true,
						description: "Whether this call created the robot."
					},
					updated: {
						type: "boolean",
						required: true,
						description: "Whether this call changed an existing robot."
					},
					renamed: {
						type: "boolean",
						required: true,
						description: "Whether this call renamed an existing robot (moved its directory and re-registered its workspace)."
					},
					previousName: {
						required: true,
						description: "Robot name before this call when it renamed the robot, otherwise null.",
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
						description: "Whether a DSH workspace is now mounted at the robot directory."
					},
					workspaceId: {
						required: true,
						description: "Mounted workspace id, or null when the robot is not mounted.",
						oneOf: [{ type: "string" }, { type: "null" }]
					},
					mountError: {
						required: true,
						description: "Why mounting failed, or null when the robot is mounted.",
						oneOf: [{ type: "string" }, { type: "null" }]
					}
				}
			},
			render: (_args, value) => {
				const previousName = typeof value?.previousName === "string" && value.previousName !== "" ? value.previousName : null;
				const renamed = value?.renamed === true && previousName !== null;
				const action = value?.created === true ? "Created robot" : renamed ? `Renamed robot: ${previousName} → ${String(value?.name ?? "")}` : value?.updated === true ? "Updated robot" : "Robot ready";
				const description = String(value?.description ?? "");
				const lines = [renamed ? `${action} (${String(value?.path ?? "")}) · avatar ${String(value?.avatar ?? "")}` : `${action}: ${String(value?.name ?? "")} (${String(value?.path ?? "")}) · avatar ${String(value?.avatar ?? "")}`, `Description: ${description === "" ? "(none)" : description}`];
				if (renamed) lines.push("The workspace was re-registered at the new path; earlier conversations stay in history but are no longer listed under the robot.");
				if (typeof value?.agentsBytes === "number" && value.agentsBytes > 0) lines.push(`AGENTS.md written: ${value.agentsBytes} bytes.`);
				if (value?.mounted === true) {
					const id = typeof value?.workspaceId === "string" ? ` ${value.workspaceId}` : "";
					lines.push(`Mounted as a workspace${id}.`);
				} else lines.push(`Not mounted: ${String(value?.mountError ?? "unknown error")}. The user can mount it from the Robots page.`);
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
				name: result.robot.name,
				path: result.robot.path,
				avatar: result.robot.avatar,
				description: result.robot.description,
				assistant: result.robot.assistant === true,
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
// .build/robots/list-tool.js
/**
* `buka_robots` 工具的定义与执行包装。
*
* 只读工具，列出插件登记表里的机器人：名字、目录、一句职责、挂载状态、
* AGENTS.md 是否存在，以及（对允许的调用方）项目级 skills 清单。
*
* 技能清单按调用方的 agent preset 收窄：工作流编排者只按机器人的一句职责
* 选人，不应该看到它们装了哪些 skill（见 `access.js` 的
* `resolveRobotSkillsVisibility`）。隐藏时输出里直接没有 `skills` 字段，
* 渲染文本里也不会出现技能数量，避免它从「0 skills」「3 skills」反推。
*
* 与 `build-tool.js` 一致，`defineTool` 与 `listRobots` 由入口注入，工具定义
* 可以脱离 DSH 运行时用假实现单测。
*
* @module @buka/dsh-plugin-robots/list-tool
*/
/** 工具名；入口注册与文档都用它。 */
const ROBOTS_LIST_TOOL_NAME = "buka_robots";
/**
* 构造 `buka_robots` 工具。
*
*/
function createRobotsListTool({ defineTool, listRobots, registryFile, robotsDir, workspaceRegistry, isSkillsVisible } = {}) {
	if (typeof defineTool !== "function") throw new TypeError("createRobotsListTool: defineTool is required");
	if (typeof listRobots !== "function") throw new TypeError("createRobotsListTool: listRobots is required");
	return defineTool({
		name: ROBOTS_LIST_TOOL_NAME,
		description: "List the subjects a workflow can delegate a node to: agent robots created by the Buka Robots page and the built-in program robots (v1: clock). An agent robot is a directory the plugin created under its own cache directory (default ~/.cache/dsh-plugin-robots/robots) and registered in robots.json, then mounted as a DSH workspace; a program robot is a fixed program with no directory and no session. This is NOT the list of all DSH workspaces: only robots registered by the plugin appear. Each robot reports its driver (agent or program), whether it is an assistant (agent robots only: they take over human tasks), whether it is currently mounted, its one-sentence responsibility statement (what a workflow orchestrator reads to decide which robot should run a node), its project-level skills and whether it has an AGENTS.md. Skills are reported only to callers whose preset may see them. Use this tool when the user asks which robots exist, which are mounted, which are assistants, what a robot is responsible for, what project-level skills it has, or whether it has an AGENTS.md. This tool is read-only: creating, updating or renaming a robot from a chat is available only to the robot-builder preset through buka_robot_build; program robots (clock) cannot be created or removed. Removing robots, mounting them, installing skills, editing AGENTS.md and setting the assistant flag remain user actions on the Robots page.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					root: {
						type: "string",
						required: true,
						description: "Robots root directory."
					},
					registry: {
						type: "string",
						required: true,
						description: "Absolute path of the plugin robots.json registry."
					},
					corrupt: {
						type: "boolean",
						required: true,
						description: "Whether the registry file is unreadable; robots is then empty."
					},
					robots: {
						type: "array",
						required: true,
						description: "Robots in registry order (newest first).",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: {
									type: "string",
									required: true,
									description: "Robot name."
								},
								path: {
									type: "string",
									required: true,
									description: "Absolute robot directory."
								},
								description: {
									type: "string",
									required: true,
									description: "One-sentence description of what the robot does and when to use it; empty when none was set."
								},
								driver: {
									type: "string",
									required: true,
									description: "How the robot runs: \"agent\" is a DSH session with a directory and skills, \"program\" is a fixed program (no directory, no session; v1 only clock).",
									enum: ["agent", "program"]
								},
								assistant: {
									type: "boolean",
									required: true,
									description: "Whether this agent robot is an assistant that can take over human tasks. Program robots are never assistants."
								},
								program: {
									required: true,
									description: "Program id for a program robot (for example \"clock\"); empty string for agent robots.",
									oneOf: [{ type: "string" }, { type: "null" }]
								},
								mounted: {
									type: "boolean",
									required: true,
									description: "Whether a DSH workspace is mounted at this robot directory."
								},
								workspaceId: {
									required: true,
									description: "Mounted DSH workspace id, or null when not mounted.",
									oneOf: [{ type: "string" }, { type: "null" }]
								},
								skills: {
									type: "array",
									description: "Project-level skills installed in the robot directory; omitted for callers whose preset may not see skills (for example the workflow orchestrator).",
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
									description: "Whether the robot directory has an AGENTS.md."
								}
							}
						}
					}
				}
			},
			render: (_args, value) => {
				if (value?.corrupt === true) return [{
					type: "text",
					text: `The robot registry is unreadable: ${String(value?.registry ?? "")}. Renew or remove that file, then refresh.`
				}];
				const robots = Array.isArray(value?.robots) ? value.robots : [];
				if (robots.length === 0) return [{
					type: "text",
					text: "No robots have been created yet."
				}];
				return [{
					type: "text",
					text: robots.map((robot) => {
						const agents = robot.agentsFile ? "AGENTS.md" : "no AGENTS.md";
						const mounted = robot.mounted ? `mounted as ${String(robot.workspaceId)}` : "not mounted";
						const description = typeof robot.description === "string" && robot.description !== "" ? robot.description : "(no description)";
						const location = typeof robot.path === "string" && robot.path !== "" ? ` (${robot.path})` : "";
						const parts = [`- ${robot.name} — ${description}${location}`];
						if (robot.driver === "program") {
							const program = typeof robot.program === "string" && robot.program !== "" ? `: ${robot.program}` : "";
							parts.push(`program${program}`);
						}
						if (robot.assistant === true) parts.push("assistant");
						if (Array.isArray(robot.skills)) {
							const count = robot.skills.length;
							parts.push(count === 1 ? "1 skill" : `${count} skills`);
						}
						parts.push(agents, mounted);
						return parts.join(" · ");
					}).join("\n")
				}];
			}
		},
		async execute(_args, exec) {
			const snapshot = await listRobots({
				file: registryFile,
				workspaceRegistry,
				robotsDir
			});
			const showSkills = typeof isSkillsVisible === "function" ? isSkillsVisible(exec?.agent) === true : true;
			const robots = snapshot.robots.map((robot) => {
				const entry = {
					name: robot.name,
					path: robot.path,
					description: robot.description ?? "",
					driver: robot.driver === "program" ? "program" : "agent",
					assistant: robot.assistant === true,
					program: robot.driver === "program" && robot.program !== "" ? robot.program : null,
					mounted: robot.mounted,
					workspaceId: robot.workspaceId,
					agentsFile: robot.agents.exists
				};
				if (showSkills) entry.skills = robot.skills.map((skill) => ({ name: skill.name }));
				return entry;
			});
			return {
				root: snapshot.root,
				registry: snapshot.registry,
				corrupt: snapshot.corrupt,
				robots
			};
		}
	});
}
// .build/robots/tools.js
/**
* 「机器人」页面的模型工具装配。
*
* 注册两个工具：
*
* - 只读的 `buka_robots`：让模型回答「有哪些机器人、挂没挂载、是否写了
*   AGENTS.md、装了什么技能」（工作流编排 preset 固定看不到技能清单）；
* - 写工具 `buka_robot_build`：创建 / 修改 / 重命名机器人、写 AGENTS.md 并挂到
*   工作区，但**只对随包发布的「机器人构建」preset 的根会话可见**
*   （Config.builderPresets）。
*
* 可见性判定放在本模块，入口只负责传入 preset 名单与登记表写队列。
*
* @module @buka/dsh-plugin-robots/tools
*/
/**
* 注册只读列举工具与「机器人构建」preset 的写工具。
*
*/
function registerRobotTools(ctx, deps) {
	const { robotsDir, registryFile, builderPresets, serializeRegistry } = deps;
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
	* 判定某个 agent 能否看到 / 调用机器人构建工具。
	*
	* 走 `sessions` + `agentPresets` 两个服务，与工作流插件同一做法；区别是
	* 写操作在服务缺失时收紧为不可见（见 `lib/access.js`）。
	*
	*/
	function builderAccessOf(agent) {
		const services = accessServices();
		return resolveRobotBuildAccess({
			allowed: builderPresets,
			agentId: typeof agent?.id === "string" ? agent.id : "",
			sessions: services.sessions,
			agentPresets: services.agentPresets
		});
	}
	/** 工具在每一步的可见性条件。 */
	const builderVisibleWhen = (context) => builderAccessOf(context?.agent).visible;
	/**
	* 判定某个 agent 能否看到 `buka_robots` 输出的机器人技能清单。
	*
	* 工作流编排 preset 固定看不到：编排者只按一句职责选人，不按技能清单。
	*
	*/
	function skillsVisibleFor(agent) {
		const services = accessServices();
		return resolveRobotSkillsVisibility({
			agentId: typeof agent?.id === "string" ? agent.id : "",
			sessions: services.sessions,
			agentPresets: services.agentPresets
		}).visible;
	}
	/**
	* 调用时兜底再校验一次：即便绕过 `when` 直接调用也要被挡住。
	*
	*/
	function assertRobotBuilder(agent) {
		const access = builderAccessOf(agent);
		if (access.visible) return access;
		throw new Error(`buka_robot_build is only available to the ${builderPresets.join(" / ")} preset (reason: ${access.reason})`);
	}
	ctx.inject(["tools"], (toolCtx) => {
		toolCtx.tools.register(createRobotsListTool({
			defineTool,
			listRobots,
			registryFile,
			robotsDir,
			workspaceRegistry: ctx.workspaceRegistry,
			isSkillsVisible: skillsVisibleFor
		}));
		const buildTool = createRobotBuildTool({
			defineTool,
			avatarIds: AVATAR_IDS,
			assertAccess: assertRobotBuilder,
			runBuild: async (args) => {
				const result = await serializeRegistry(() => buildRobot({
					robotsDir,
					file: registryFile,
					name: args?.name,
					avatar: args?.avatar,
					description: args?.description,
					agents: args?.agents,
					update: args?.update,
					newName: args?.newName,
					workspaceRegistry: ctx.workspaceRegistry
				}));
				ctx.logger?.info?.("buka-robots: %s 机器人 %s（%s）", result.created ? "已创建" : result.renamed ? `已重命名（原 ${result.previousName}）` : "已更新", result.robot.name, result.robot.path);
				return result;
			}
		});
		toolCtx.tools.register(buildTool, { when: builderVisibleWhen });
	});
}
// .build/robots/index.js
/**
* 侧边栏「机器人」页面的 Host 一半。
*
* v2 里机器人是**插件自己创建并登记**的对象，不是 DSH 的全部工作区：新建
* 机器人时在插件全局目录下的 `robots/` 里建同名目录并写进 `robots.json`，
* 再由浏览器一半把它挂到 DSH 工作区列表。Host 负责所有磁盘操作，提供一组
* 包内 HTTP 路由给页面，除工作区 / 设置外都按机器人 **name** 操作：
*
* | 路由 | 作用 |
* | --- | --- |
* | `GET /buka-robots/list` | 列出登记表里的机器人、挂载状态、skills 与 AGENTS.md |
* | `POST /buka-robots/create` | 建目录 + AGENTS.md 模板，并把机器人（含可选描述）插到登记表最前 |
* | `POST /buka-robots/avatar` | 只改登记表里的头像 id |
* | `POST /buka-robots/description` | 只改登记表里的一行描述（工作流用它选机器人） |
* | `POST /buka-robots/assistant` | 标记 / 取消 agent 机器人的助理身份（program 只读） |
* | `POST /buka-robots/rename` | 改机器人目录名 + 更新登记表 + 按新路径重建 DSH 工作区 |
* | `POST /buka-robots/remove` | 从登记表移除（目录、文件与会话保留） |
* | `POST /buka-robots/agents` | 写入某机器人的 AGENTS.md，并补 CLAUDE.md 链接 |
* | `POST /buka-robots/skills/available` | 执行 `npx skills add <source> --list` 列出可安装的 skills |
* | `POST /buka-robots/skills/install` | 只安装选中的 skills，同时落 `.agents/skills` 与 `.claude/skills` |
* | `POST /buka-robots/skills/remove` | 在机器人目录里执行 `npx skills remove <skill> -y` |
* | `POST /buka-robots/reveal` | 用系统文件管理器（macOS 的 Finder）打开机器人目录 |
*
* 工作区的注册、删除与打开必须走 DSH 自己的 Client Service（侧边栏才会同步），
* 所以都在浏览器一半，这里不重复实现。另注册两个模型工具：只读的 `buka_robots`
* 让模型回答「有哪些机器人、挂没挂载、是否写了 AGENTS.md、装了什么技能」
* （见 `lib/list-tool.js`；工作流编排 preset 固定看不到技能清单）；写工具
* `buka_robot_build`（见 `lib/builder.js`、`lib/build-tool.js`）负责创建 /
* 修改 / 重命名机器人、写 AGENTS.md 并挂到工作区，但**只对随包发布的
* 「机器人构建」preset 的根会话可见**（Config.builderPresets，判定见
* `lib/access.js`）。删除机器人、安装 skills、页面上的编辑仍然只留给用户。
*
* 另通过 `ctx.provide('bukaRobots', ...)` 对外提供一个 Host Service（见
* `lib/service.js`）：`list()` 列出机器人（含内建 program 机器人 clock 的
* `driver` / `assistant` / `program`），`avatarMap()` 给出机器人头像，
* `dispatchSession()` 新开一条会话并返回观测句柄，`openSession()` 只续接同一条
* 会话（不压缩）。工作流插件用它把每个任务交给一个机器人、并在节点图上画出
* 机器人头像；注册在这里而不是拆成第二个插件，是因为本包入口需要同时保留页面
* 路由与工具。
*
* 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
* （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
*
* @module @buka/dsh-plugin-robots
*/
/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
const name = "page-buka-robots";
/** 依赖的服务：这里用它判断机器人是否已经挂到 DSH 工作区。 */
const inject = ["workspaceRegistry"];
/** 机器人根目录的默认位置：`<插件全局目录>/robots`。 */
const DEFAULT_ROBOTS_DIR = defaultRobotsRoot();
/**
* 随本插件发布的「机器人构建」preset；`buka_robot_build` 默认只对这个
* preset 的根会话可见（见 Config.builderPresets）。
*/
const DEFAULT_BUILDER_PRESETS = ["robot-builder"];
/**
* 可在设置页配置的机器人根目录。
*
* 机器人目录建在这里；登记文件固定为该目录同级的 `robots.json`，插件只管理
* 登记表里列出的机器人，不碰用户自己的 DSH 工作区。
*/
const Config = z.object({
	robotsDir: z.string().default(DEFAULT_ROBOTS_DIR).description("机器人根目录：机器人目录建在插件全局目录下；登记文件固定为该目录同级的 robots.json，支持 ~ 前缀。"),
	builderPresets: z.array(z.string()).default(DEFAULT_BUILDER_PRESETS).description("能看到并调用 buka_robot_build（创建 / 修改机器人）的 agent preset 名单。留空表示不按 preset 收窄（所有会话可见，不推荐）；推荐只保留随插件发布的 `robot-builder`。"),
	seedPresets: z.boolean().default(true).description("全新安装（登记表为空）时是否自动补上「软件工程师」与「质量保障工程师」两个预设机器人；设为 false 则不初始化预设。")
});
/**
* 注册 HTTP 路由、只读工具与「机器人构建」preset 的写工具。
*
*/
function apply(ctx, config) {
	const robotsDir = resolveRobotsDir(config?.robotsDir);
	const registryFile = resolveRobotRegistryFile(robotsDir);
	ctx.provide(SERVICE_NAME, new RobotSessionService({
		ctx,
		robotsDir,
		registryFile
	}));
	let registryQueue = Promise.resolve();
	function serializeRegistry(work) {
		const run = registryQueue.then(work, work);
		registryQueue = run.then(() => void 0, () => void 0);
		return run;
	}
	serializeRegistry(() => ensureBuiltinRobots({ file: registryFile })).then((result) => {
		if (result.corrupt) ctx.logger?.warn?.("buka-robots: 登记文件损坏，跳过内建机器人登记：%s", registryFile);
		else if (result.added.length > 0) ctx.logger?.info?.("buka-robots: 已登记内建机器人：%s", result.added.join("、"));
	}).catch((error) => {
		ctx.logger?.warn?.("buka-robots: 登记内建机器人失败：%s", describeError$2(error));
	});
	seedRobotsOnStartup({
		ctx,
		robotsDir,
		registryFile,
		serializeRegistry,
		enabled: config?.seedPresets !== false
	});
	const builderPresets = normalizePresets(config?.builderPresets ?? DEFAULT_BUILDER_PRESETS);
	registerRoutes(ctx, {
		robotsDir,
		registryFile,
		serializeRegistry
	});
	registerRobotTools(ctx, {
		robotsDir,
		registryFile,
		builderPresets,
		serializeRegistry
	});
}
export { Config, apply, inject, name };
