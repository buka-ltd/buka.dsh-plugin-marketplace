window.__ModuleLoader__.load({
  id: "@buka/dsh-plugin-workflows",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // \0rolldown/runtime.js
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __copyProps = (to, from, except, desc) => {
    	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
    		key = keys[i];
    		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
    			get: ((k) => from[k]).bind(null, key),
    			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    		});
    	}
    	return to;
    };
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
    	value: mod,
    	enumerable: true
    }) : target, mod));
    let react = require("react");
    react = __toESM(react, 1);
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    // packages/plugin-ui/lib/avatars.js
    /**
    * 预设头像：id → emoji / 底色 / 词典 key。
    *
    * 机器人页与工作流节点图原本各维护一份同样的显示表；插件之间不互相 import，
    * 所以统一收在这里，两个浏览器一半都从这里派生。id 与 Host 的
    * `plugins/robots/src/avatar.ts` 一一对应（那边只存 id，不存 emoji / 底色），
    * **id 是跨插件的稳定契约**：增删预设时两边一起改，顺序也不要动。
    *
    * @module plugin-ui/avatars
    */
    /**
    * 预设头像：顺序决定「新建时挑一个没被占用的头像」的优先顺位，也是名字哈希
    * 的取模空间；只增不改，删除会让旧登记表里的 id 落回默认。
    */
    const AVATARS = [
    	{
    		id: "sprout",
    		emoji: "🌱",
    		color: "#34A853",
    		labelKey: "avatarSprout"
    	},
    	{
    		id: "sun",
    		emoji: "☀️",
    		color: "#F2A60C",
    		labelKey: "avatarSun"
    	},
    	{
    		id: "cat",
    		emoji: "🐱",
    		color: "#F2994A",
    		labelKey: "avatarCat"
    	},
    	{
    		id: "fox",
    		emoji: "🦊",
    		color: "#EB6A4E",
    		labelKey: "avatarFox"
    	},
    	{
    		id: "panda",
    		emoji: "🐼",
    		color: "#6B7280",
    		labelKey: "avatarPanda"
    	},
    	{
    		id: "owl",
    		emoji: "🦉",
    		color: "#8D6E63",
    		labelKey: "avatarOwl"
    	},
    	{
    		id: "whale",
    		emoji: "🐳",
    		color: "#4A90E2",
    		labelKey: "avatarWhale"
    	},
    	{
    		id: "octopus",
    		emoji: "🐙",
    		color: "#9B51E0",
    		labelKey: "avatarOctopus"
    	},
    	{
    		id: "bee",
    		emoji: "🐝",
    		color: "#D9A400",
    		labelKey: "avatarBee"
    	},
    	{
    		id: "rocket",
    		emoji: "🚀",
    		color: "#5B6BFF",
    		labelKey: "avatarRocket"
    	},
    	{
    		id: "dino",
    		emoji: "🦖",
    		color: "#27AE60",
    		labelKey: "avatarDino"
    	},
    	{
    		id: "ghost",
    		emoji: "👻",
    		color: "#94A3B8",
    		labelKey: "avatarGhost"
    	},
    	{
    		id: "penguin",
    		emoji: "🐧",
    		color: "#2D9CDB",
    		labelKey: "avatarPenguin"
    	},
    	{
    		id: "unicorn",
    		emoji: "🦄",
    		color: "#BB6BD9",
    		labelKey: "avatarUnicorn"
    	},
    	{
    		id: "mushroom",
    		emoji: "🍄",
    		color: "#EB5757",
    		labelKey: "avatarMushroom"
    	}
    ];
    AVATARS.map((preset) => preset.id);
    /** id → 预设。 */
    const AVATAR_BY_ID = new Map(AVATARS.map((preset) => [preset.id, preset]));
    AVATARS[0].id;
    /**
    * 头像 id → 预设；不认识的 id 返回 `undefined`。
    *
    * 两个浏览器一半的兜底不同：机器人页退回第一个预设，节点图当作没有头像，
    * 所以这里只做查表，兜底留在各自的 `avatarPreset` 里。
    *
    * @param id 头像 id
    */
    function findAvatarPreset(id) {
    	return typeof id === "string" ? AVATAR_BY_ID.get(id) : void 0;
    }
    // packages/plugin-ui/lib/h.js
    /**
    * 创建 React 元素的小包装。
    *
    * 页面直接手写 `createElement`（不用 JSX）。短名保持 `React.createElement` 的
    * 全部重载（这样内联回调仍能拿到事件类型），另外补一个宽松签名：机器人 / 技能
    * 页有些 props 是自带的宽对象或带 `data-*` 的元素属性，类型系统不必逐个展开。
    *
    * @module plugin-ui/h
    */
    const looseCreateElement = (type, props, ...children) => react.default.createElement(type, props, ...children);
    /** `React.createElement` 的短名，附带一个宽松签名。 */
    const h = looseCreateElement;
    // packages/plugin-ui/lib/request.js
    /**
    * 与 Host 一半通信的 JSON 请求 / 错误处理。
    *
    * 四个插件的浏览器一半原本各有一份几乎相同的实现：请求返回 `{ ok, ... }`，
    * 非 2xx 或 `ok !== true` 时抛出带 `code`（以及 `npx` 类路由的 `output`）的
    * 错误，失败原因再用 `messageOf` 转成展示文本。差异只在各插件自己的错误码
    * 映射与请求参数，所以这里共享机制、不共享错误文案。
    *
    * @module plugin-ui/request
    */
    /**
    * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
    * `npx-failed` 的响应里还有 `output`，一并挂到错误上供详情页展示。
    *
    * @param url 路由地址
    * @param init 请求选项；`body` 是已经序列化好的 JSON 字符串
    */
    async function requestJson(url, init = {}) {
    	const headers = { accept: "application/json" };
    	if (init.body !== void 0) headers["content-type"] = "application/json";
    	const extraHeaders = init.headers ?? {};
    	const response = await fetch(url, {
    		...init,
    		headers: {
    			...headers,
    			...extraHeaders
    		}
    	});
    	const body = await response.json().catch(() => null);
    	if (!response.ok || body === null || body.ok !== true) {
    		const error = new Error(typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    		error.code = typeof body?.code === "string" ? body.code : void 0;
    		error.output = typeof body?.output === "string" ? body.output : void 0;
    		throw error;
    	}
    	return body;
    }
    // .build/workflows/client/element.js
    /** 图标组件运行时把额外属性透传给 `<svg>`，官方 IconProps 没有声明这些属性。 */
    function withAria(props) {
    	return props;
    }
    /** Modal 的 headless 模式不消费 closeLabel；运行时传了也会被忽略。 */
    const ClientModal = _deepseek_ai_dsh_client_ui_primitives.Modal;
    // .build/workflows/client/components/panel-icon.js
    /**
    * 侧边栏图标：两个节点与一条连接线。
    */
    /**
    * 侧边栏图标：两个节点与一条连接线。
    *
    * @param props
    * @returns React 元素
    */
    function WorkflowsPanelIcon({ size }) {
    	return h("svg", {
    		width: size,
    		height: size,
    		viewBox: "0 0 16 16",
    		fill: "none",
    		"aria-hidden": true
    	}, h("rect", {
    		x: 2,
    		y: 3,
    		width: 4.4,
    		height: 4.4,
    		rx: 1.4,
    		stroke: "currentColor",
    		strokeWidth: 1.2
    	}), h("rect", {
    		x: 9.6,
    		y: 8.6,
    		width: 4.4,
    		height: 4.4,
    		rx: 1.4,
    		stroke: "currentColor",
    		strokeWidth: 1.2
    	}), h("path", {
    		d: "M6.4 5.2h2.2a2 2 0 0 1 2 2v1.4",
    		stroke: "currentColor",
    		strokeWidth: 1.2,
    		strokeLinecap: "round"
    	}));
    }
    // .build/workflows/client/i18n.js
    /**
    * 侧边栏「工作流」页面的词典（英文 / 简体中文）。
    */
    /** 英文文案。 */
    const en = {
    	panel: "Workflows",
    	title: "Workflows",
    	welcome: "No workflow runs yet.",
    	welcomeHint: "Start a session with the workflow-orchestrator preset and ask it to run a workflow. The robot sessions it opens and the user nodes it waits at appear here as the graph advances.",
    	refresh: "Refresh",
    	loading: "Loading…",
    	loadFailed: "Request failed:",
    	empty: "No workflow runs have been recorded yet.",
    	back: "Back to runs",
    	error: "Error",
    	stopReason: "Stop reason",
    	openSession: "Open session",
    	openSessionFailed: "Could not open the node session:",
    	noUiWorkspace: "This client has no uiWorkspace service, so the node session cannot be opened.",
    	nodeSession: "Robot session",
    	nodeSessionsLegacy: "This node ran in more than one session (only in an older record); open the one you need.",
    	waitingForAnswer: "A robot is waiting for your answer",
    	waitingForApproval: "A robot is waiting for your approval",
    	openAnswerSession: "Open session to answer",
    	openApprovalSession: "Open session to approve",
    	modePlan: "Plan mode",
    	waitingForPlanReview: "A robot is waiting for you to review its plan",
    	planReviewBody: "Open the robot session to approve the plan or keep planning.",
    	openPlanReviewSession: "Open session to review",
    	waitingForUser: "Waiting for you",
    	userWaitingTitle: "The workflow is waiting for you",
    	userWaitingBody: "Answer in the session that started this workflow; the run continues once you submit.",
    	userChoice: "Choices",
    	userAnswers: "Additional questions",
    	userAnswerSkipped: "Not answered",
    	sessionLive: "Current session",
    	sessionCompacted: "History compacted",
    	sessionRecovering: "Recovering (attempt {n})",
    	sessionRecovered: "Recovered",
    	sessionCompactFailed: "History compaction failed; the prompt was sent without it:",
    	sessionReset: "Could not resume the old session, so a new one was started:",
    	unknown: "Unknown",
    	statusCompleted: "Completed",
    	statusRunning: "Running",
    	statusWaiting: "Waiting",
    	statusFailed: "Failed",
    	statusRejected: "Rejected",
    	statusCancelled: "Cancelled",
    	statusInterrupted: "Interrupted",
    	legendTypes: "Node types",
    	legendStates: "Node states",
    	legendEdges: "Edges",
    	legendTraversed: "Traversed",
    	legendPending: "Not taken",
    	legendFlow: "Flow",
    	legendDone: "Done",
    	legendRunning: "Running",
    	legendWaiting: "Waiting for you",
    	legendFailed: "Failed",
    	legendIdle: "Not run",
    	visitsLabel: "Visits",
    	typeStart: "Start",
    	typeRobot: "Robot",
    	typeUser: "User",
    	typeJoin: "Join",
    	typeEnd: "End",
    	stateIdle: "Not run",
    	stateUnavailable: "Questions unavailable",
    	inspector: "Node detail",
    	nodeNotRun: "This node has not run in this workflow.",
    	nodeStart: "Start",
    	startNodeHint: "The start node does not execute: it only gives the first real node its prompt through its outgoing edge. That prompt shows up in the first execution tab of the node it points to.",
    	nodeUnreachable: "Nothing in this definition leads to this node, so it never runs. New definitions reject unreachable nodes; this line only explains a run recorded before that rule.",
    	nodeExecutor: "Executor",
    	nodePrompt: "Prompt",
    	execution: "Execution",
    	executionInput: "Task info",
    	executionOutput: "Output result",
    	executionAttachments: "Attachments",
    	executionOutputAttachmentsOnly: "No text output; see the attachments below.",
    	attachmentDownload: "Download",
    	attachmentCount: "{n} attachments",
    	attachmentPreviewOpenHint: "Click the file name to preview it on the right.",
    	attachmentPreviewLoading: "Loading preview…",
    	attachmentPreviewFailed: "Could not load the preview:",
    	attachmentPreviewRetry: "Retry",
    	attachmentPreviewClose: "Close preview",
    	attachmentPreviewBinary: "This file cannot be previewed here.",
    	attachmentPreviewUnsupported: "This file type cannot be previewed.",
    	attachmentPreviewTruncated: "Only the beginning of the file is shown.",
    	attachmentPreviewEmpty: "This file is empty.",
    	attachmentPreviewImageFailed: "The image could not be displayed.",
    	attachmentPreviewPdfHint: "The PDF is embedded above; download it to keep a copy.",
    	copy: "Copy",
    	copied: "Copied",
    	code: "Code",
    	wrap: "Wrap",
    	unwrap: "Unwrap",
    	routeLabel: "Route",
    	executionNoInput: "This execution recorded no input.",
    	executionInputMissing: "No input was recorded for this execution. Older runs did not persist a per-entry prompt, so the definition template is not shown again.",
    	executionNoOutput: "This execution produced no text output.",
    	executionTimedOut: "Timed out",
    	executionAborted: "Node aborted the run",
    	executionPrev: "Previous step",
    	executionPrevNone: "This is the first execution in this run.",
    	executionNext: "Next step",
    	executionNextEnded: "The run ended after this execution.",
    	executionEnded: "Run ended",
    	executionStart: "Run start",
    	nodeExecutions: "Executions",
    	nodeTimeout: "Timeout",
    	nodeMaxVisits: "Max visits",
    	nodeEndStatus: "End status",
    	userDetail: "User detail",
    	finalDeliverable: "Final output",
    	finalDeliverableEmpty: "This run produced no robot output.",
    	finalDeliverableFrom: "From",
    	promptTruncated: "The prompt is truncated for display.",
    	noGraph: "This run has no saved definition snapshot, so the node graph cannot be drawn.",
    	graphEmpty: "The saved definition has no nodes.",
    	graphInteractHint: "Click a node for its details; click an edge for its configuration.",
    	close: "Close",
    	yes: "Yes",
    	no: "No",
    	edgeDrawerTitle: "Edge configuration",
    	edgeRules: "Configuration",
    	edgeRoute: "Route key",
    	edgeOption: "User option",
    	edgePrompt: "Entry prompt",
    	edgePromptHint: "Template variables are rendered when the run takes this edge.",
    	edgeNoPrompt: "This edge carries no prompt.",
    	edgeToneSuccess: "Success (green)",
    	edgeToneFailure: "Failure (red)",
    	edgeState: "Run state",
    	edgeTraversed: "Taken",
    	edgeTraversals: "Times taken",
    	edgeLoop: "Loop edge",
    	edgeRulesEmpty: "This edge has no extra configuration.",
    	edgeAriaLabel: "View the edge from {from} to {to}",
    	settings: "Archive settings",
    	archiveSettingsTitle: "Automatic archive",
    	archiveEnabled: "Automatic archive",
    	archiveEnabledDesc: "Finished runs leave the list after the archive time, and are deleted with their record after the delete time. Runs that are still going are never archived or deleted.",
    	settingsEnabled: "On",
    	settingsDisabled: "Off",
    	settingsLoading: "Reading settings…",
    	settingsLoadFailed: "Could not read settings:",
    	save: "Save",
    	saving: "Saving…",
    	cancel: "Cancel",
    	saved: "Settings saved.",
    	archiveAfterHours: "Archive after",
    	archiveAfterHoursHint: "In hours, counted from when the run finished. Default 24 hours (1 day).",
    	deleteAfterHours: "Delete after",
    	deleteAfterHoursHint: "In hours, counted from when the run finished; it must be later than the archive time. Default 168 hours (7 days).",
    	hoursUnit: "hours",
    	archiveDefaultsHint: "Defaults: archive after 1 day (24 hours), delete after 7 days (168 hours). Whole hours only.",
    	archiveInvalid: "The archive time must be a whole number of hours between 1 and 720.",
    	deleteInvalid: "The delete time must be a whole number of hours between 2 and 8760.",
    	deleteBeforeArchive: "The delete time must be later than the archive time.",
    	archiveView: "Archived",
    	archiveTitle: "Archived workflows",
    	archiveBack: "Back to list",
    	archiveEmpty: "No archived runs yet.",
    	archived: "Archived",
    	runsTab: "Runs",
    	templatesTab: "Templates",
    	tabsLabel: "Workflow pages",
    	templatesTitle: "Workflow templates",
    	templatesBack: "Back to templates",
    	templatesEmpty: "No workflow templates available.",
    	templatesHint: "Abstract workflow patterns for reference. Each template names roles (not real robots) and lists its process stages; use your real robots to design a workflow that fits the request.",
    	templatesStep: "Step",
    	templatesRole: "Role",
    	templatesAbstractRole: "Abstract role",
    	templatesTransitions: "Transitions",
    	templatesNoFlow: "This template has no flow.",
    	templatesPurpose: "Purpose",
    	templatesNoTransitions: "This node has no outgoing transitions."
    };
    /** 简体中文文案。 */
    const zh = {
    	panel: "工作流",
    	title: "工作流",
    	welcome: "还没有运行过工作流。",
    	welcomeHint: "用 workflow-orchestrator preset 新建一个会话，让它跑一个工作流；它启动的机器人会话与正在等待你介入的节点都会随执行推进显示在这里。",
    	refresh: "刷新",
    	loading: "正在读取…",
    	loadFailed: "请求失败：",
    	empty: "还没有记录任何工作流运行。",
    	back: "返回运行列表",
    	error: "错误",
    	stopReason: "停止原因",
    	openSession: "打开会话",
    	openSessionFailed: "打开节点会话失败：",
    	noUiWorkspace: "当前客户端没有 uiWorkspace 服务，无法打开节点会话。",
    	nodeSession: "机器人会话",
    	nodeSessionsLegacy: "这个节点在多个会话里执行过（仅存在于旧记录）；需要看哪次就打开哪个会话。",
    	waitingForAnswer: "机器人正在等待你回答",
    	waitingForApproval: "机器人正在等待你批准",
    	openAnswerSession: "打开会话回答",
    	openApprovalSession: "打开会话审批",
    	modePlan: "计划模式",
    	waitingForPlanReview: "机器人正在等待你审阅计划",
    	planReviewBody: "打开机器人会话，批准计划或继续计划。",
    	openPlanReviewSession: "打开会话审阅",
    	waitingForUser: "等待用户",
    	userWaitingTitle: "工作流正在等待你介入",
    	userWaitingBody: "请在工作流创建者的会话里作答；提交后流程会继续。",
    	userChoice: "选项",
    	userAnswers: "补充问题",
    	userAnswerSkipped: "未作答",
    	sessionLive: "当前会话",
    	sessionCompacted: "已压缩历史",
    	sessionRecovering: "恢复中（第 {n} 次）",
    	sessionRecovered: "已恢复",
    	sessionCompactFailed: "历史压缩失败，已直接继续：",
    	sessionReset: "旧会话无法续接，已新建会话：",
    	unknown: "未知",
    	statusCompleted: "已完成",
    	statusRunning: "运行中",
    	statusWaiting: "等待中",
    	statusFailed: "失败",
    	statusRejected: "已拒绝",
    	statusCancelled: "已取消",
    	statusInterrupted: "已中断",
    	legendTypes: "节点类型",
    	legendStates: "节点状态",
    	legendEdges: "连线",
    	legendTraversed: "已走过",
    	legendPending: "未走过",
    	legendFlow: "流程走向",
    	legendDone: "已完成",
    	legendRunning: "运行中",
    	legendWaiting: "等待用户",
    	legendFailed: "失败",
    	legendIdle: "未运行",
    	visitsLabel: "执行次数",
    	typeStart: "开始",
    	typeRobot: "机器人",
    	typeUser: "用户",
    	typeJoin: "汇合",
    	typeEnd: "终止",
    	stateIdle: "未运行",
    	stateUnavailable: "提问不可用",
    	inspector: "节点详情",
    	nodeNotRun: "这个节点在本次运行中还没有执行。",
    	nodeStart: "起点",
    	startNodeHint: "开始节点不执行：它只通过出边给第一个真实节点定义 prompt，那条 prompt 会出现在目标节点第一次执行的「任务信息」里。",
    	nodeUnreachable: "定义里没有任何连线能到达这个节点，所以它不会执行。新定义里这种节点会直接校验失败，这里只用于回看旧记录。",
    	nodeExecutor: "执行人",
    	nodePrompt: "提示词",
    	execution: "执行",
    	executionInput: "任务信息",
    	executionOutput: "输出结果",
    	executionAttachments: "附件",
    	executionOutputAttachmentsOnly: "这次执行没有文本输出，请查看下面的附件。",
    	attachmentDownload: "下载",
    	attachmentCount: "{n} 个附件",
    	attachmentPreviewOpenHint: "点击文件名可在右侧预览。",
    	attachmentPreviewLoading: "正在加载预览…",
    	attachmentPreviewFailed: "预览加载失败：",
    	attachmentPreviewRetry: "重试",
    	attachmentPreviewClose: "关闭预览",
    	attachmentPreviewBinary: "这种文件无法在此预览。",
    	attachmentPreviewUnsupported: "这种文件类型不支持预览。",
    	attachmentPreviewTruncated: "仅展示文件开头的一部分。",
    	attachmentPreviewEmpty: "文件内容为空。",
    	attachmentPreviewImageFailed: "图片无法显示。",
    	attachmentPreviewPdfHint: "PDF 已在上方内嵌显示；需要保存副本请下载。",
    	copy: "复制",
    	copied: "已复制",
    	code: "代码",
    	wrap: "换行",
    	unwrap: "不换行",
    	routeLabel: "路由",
    	executionNoInput: "这次执行没有记录输入。",
    	executionInputMissing: "这次执行没有记录输入；旧运行没有按次落盘提示词，所以这里不重复展示定义里的模板。",
    	executionNoOutput: "这次执行没有文本输出。",
    	executionTimedOut: "超时",
    	executionAborted: "节点主动终止运行",
    	executionPrev: "上一步",
    	executionPrevNone: "这是本次运行的第一次执行。",
    	executionNext: "下一步",
    	executionNextEnded: "这次执行后运行结束。",
    	executionEnded: "运行结束",
    	executionStart: "运行起点",
    	nodeExecutions: "执行记录",
    	nodeTimeout: "超时",
    	nodeMaxVisits: "最多访问",
    	nodeEndStatus: "终止状态",
    	userDetail: "用户说明",
    	finalDeliverable: "最终输出",
    	finalDeliverableEmpty: "这次运行没有机器人输出。",
    	finalDeliverableFrom: "来自",
    	promptTruncated: "提示词过长，仅展示前面一部分。",
    	noGraph: "这次运行没有保存定义快照，无法绘制节点图。",
    	graphEmpty: "保存的定义里没有节点。",
    	graphInteractHint: "点击节点查看详情，点击连线查看配置。",
    	close: "关闭",
    	yes: "是",
    	no: "否",
    	edgeDrawerTitle: "连线配置",
    	edgeRules: "配置",
    	edgeRoute: "路由键",
    	edgeOption: "用户选项",
    	edgePrompt: "进入提示词",
    	edgePromptHint: "提示词里的模板变量会在运行走到这条边时渲染。",
    	edgeNoPrompt: "这条边没有提示词。",
    	edgeToneSuccess: "成功（绿）",
    	edgeToneFailure: "失败（红）",
    	edgeState: "运行状态",
    	edgeTraversed: "是否走过",
    	edgeTraversals: "走过次数",
    	edgeLoop: "回边",
    	edgeRulesEmpty: "这条边没有可展开的配置。",
    	edgeAriaLabel: "查看从 {from} 到 {to} 的连线配置",
    	settings: "归档设置",
    	archiveSettingsTitle: "自动归档设置",
    	archiveEnabled: "自动归档",
    	archiveEnabledDesc: "结束的运行超过归档时间后从列表里隐藏；超过删除时间后连同记录一起删除。仍在运行的运行不会被归档或删除。",
    	settingsEnabled: "已启用",
    	settingsDisabled: "已停用",
    	settingsLoading: "正在读取设置…",
    	settingsLoadFailed: "读取设置失败：",
    	save: "保存",
    	saving: "正在保存…",
    	cancel: "取消",
    	saved: "设置已保存。",
    	archiveAfterHours: "归档时间",
    	archiveAfterHoursHint: "按小时计，从运行结束算起。默认 24 小时（1 天）。",
    	deleteAfterHours: "删除时间",
    	deleteAfterHoursHint: "按小时计，从运行结束算起，必须晚于归档时间。默认 168 小时（7 天）。",
    	hoursUnit: "小时",
    	archiveDefaultsHint: "默认：超过 1 天（24 小时）自动归档，超过 7 天（168 小时）自动删除。时间按整小时填写。",
    	archiveInvalid: "归档时间需为 1–720 之间的整数小时。",
    	deleteInvalid: "删除时间需为 2–8760 之间的整数小时。",
    	deleteBeforeArchive: "删除时间必须晚于归档时间。",
    	archiveView: "已归档",
    	archiveTitle: "已归档的工作流",
    	archiveBack: "返回列表",
    	archiveEmpty: "还没有已归档的运行。",
    	archived: "已归档",
    	runsTab: "运行",
    	templatesTab: "模板",
    	tabsLabel: "工作流页面",
    	templatesTitle: "工作流模板",
    	templatesBack: "返回模板列表",
    	templatesEmpty: "还没有工作流模板。",
    	templatesHint: "抽象的工作流范式，供设计真实工作流时参考。每个模板用角色名（而不是真实机器人）描述流程阶段；设计时请用你真正拥有的机器人替换角色。",
    	templatesStep: "步骤",
    	templatesRole: "角色",
    	templatesAbstractRole: "抽象角色",
    	templatesTransitions: "流转",
    	templatesNoFlow: "这个模板没有流程。",
    	templatesPurpose: "目的",
    	templatesNoTransitions: "这个节点没有流转去向。"
    };
    // .build/workflows/client/types.js
    /**
    * 浏览器一半的共享类型与常量：Host 路由响应形状、页面状态、路由与刷新间隔。
    */
    /** 运行记录里的 steps；空记录时返回空数组。 */
    function stepsOf(run) {
    	return Array.isArray(run?.steps) ? run.steps : [];
    }
    /** 判断普通对象。 */
    function isRecord(value) {
    	return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    /** 把 Host 返回的 JSON 收口成页面读取的形状（只读展示，不再校验输入）。 */
    function asRunDetail(body) {
    	return body;
    }
    /** 词典命名空间。 */
    const NS = "buka-workflows";
    /** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
    const PANEL_ID = "buka-workflows";
    /** 与 Host 一半（`lib/index.js`）的路由常量保持一致。 */
    const RUNS_ROUTE = "/buka-workflows/runs";
    const RUN_ROUTE = "/buka-workflows/run";
    const SETTINGS_ROUTE = "/buka-workflows/settings";
    const TEMPLATES_ROUTE = "/buka-workflows/templates";
    /** 页面刷新间隔：正在跑的运行也能看到节点进度。 */
    const REFRESH_MS = 5e3;
    /** 有运行在跑时缩短的刷新间隔：后台调度时这张图是唯一的观测点。 */
    const LIVE_REFRESH_MS = 1500;
    // .build/workflows/client/components/detail.js
    /**
    * 运行详情视图：图占据页面主体，节点 / 连线详情在右侧抽屉。
    */
    /**
    * 运行详情的共享数据：详情主体、节点抽屉、连线抽屉都从这里取。
    *
    * @returns 详情主体、节点抽屉与连线抽屉共用的数据；没有选中运行时是 null
    */
    function runDetailModel(page) {
    	const { detail } = page;
    	const data = detail.data;
    	if (data === null) return null;
    	const run = data.run;
    	if (run === null) return null;
    	const steps = stepsOf(run);
    	const nodeResults = Array.isArray(data.nodeResults) ? data.nodeResults : [];
    	const fullResults = new Map(nodeResults.map((result) => [`${String(result.seq)}:${String(result.nodeId)}`, result]));
    	const definition = data.definition;
    	const graph = data.graph;
    	return {
    		run,
    		steps,
    		nodeResults,
    		fullResults,
    		definition,
    		graph,
    		nodes: Array.isArray(graph?.nodes) ? graph.nodes : []
    	};
    }
    /**
    * 详情视图：图占据页面主体；节点详情在右侧抽屉里打开。
    *
    * @returns React 元素
    */
    function renderDetail(page) {
    	const { t, setSelectedId, detail, selectedNodeId, renderGraph, renderUserNotice, renderInteractionNotice, runDetailModel } = page;
    	if (detail.error !== null && detail.data === null) return h("p", {
    		className: "buka-workflows-failure",
    		role: "alert"
    	}, `${t("loadFailed")} ${detail.error}`);
    	if (detail.status === "loading" && detail.data === null) return h("p", {
    		className: "buka-workflows-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading"));
    	const model = runDetailModel();
    	if (model === null) return h("p", { className: "buka-workflows-empty" }, t("empty"));
    	const { run, graph, nodes } = model;
    	const activeNodeId = selectedNodeId !== null && nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null;
    	const graphBody = graph === null ? h("p", { className: "buka-workflows-empty" }, t("noGraph")) : renderGraph(graph, activeNodeId);
    	const notices = [renderUserNotice(run), renderInteractionNotice(run)].filter((notice) => notice !== null);
    	return h("div", { className: "buka-workflows-pageBody buka-workflows-detail" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "ghost",
    		size: "sm",
    		className: "buka-workflows-detailBackButton buka-workflows-back",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 14 }),
    		onClick: () => setSelectedId(null)
    	}, t("back")), ...notices, graphBody);
    }
    // .build/workflows/client/components/drawer-head.js
    /**
    * 右侧抽屉的头部：标题、meta、可选操作与关闭按钮。
    */
    /**
    * 右侧抽屉的头部：标题、meta、可选操作与关闭按钮。附件预览 / 连线配置共用。
    *
    * @param options 抽屉头部内容
    * @returns React 元素
    */
    function renderDrawerHead(_page, options) {
    	const meta = typeof options.meta === "string" ? options.meta : "";
    	const actions = Array.isArray(options.actions) ? options.actions : [];
    	return h("div", { className: "buka-workflows-drawerHead" }, h("div", { className: "buka-workflows-drawerTitleRow" }, options.icon ?? null, h("span", { className: "buka-workflows-drawerTitle" }, options.title)), meta === "" ? null : h("span", { className: "buka-workflows-drawerMeta" }, meta), h("div", { className: "buka-workflows-drawerActions" }, ...actions, h("button", {
    		type: "button",
    		className: "buka-workflows-drawerClose",
    		"aria-label": options.closeLabel,
    		title: options.closeLabel,
    		onClick: options.onClose
    	}, typeof _deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular === "function" ? h(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, withAria({
    		size: 16,
    		"aria-hidden": true
    	})) : null)));
    }
    // .build/workflows/client/format.js
    /**
    * 展示文本：状态 / 时间 / 耗时 / 字节数 / 截断与错误文案。
    */
    /**
    * 把失败原因转成展示文本。
    *
    * @param failure
    * @returns
    */
    function messageOf(failure) {
    	return failure instanceof Error ? failure.message : String(failure);
    }
    /**
    * 状态 → Tag tone。
    *
    * @param status
    * @returns
    */
    function statusTone(status) {
    	switch (status) {
    		case "completed": return "success";
    		case "running":
    		case "waiting": return "info";
    		case "failed":
    		case "rejected":
    		case "cancelled":
    		case "interrupted":
    		case "unavailable": return "warning";
    		default: return "neutral";
    	}
    }
    /**
    * 状态 → 本地化文案。
    *
    * @param t
    * @param status
    * @returns
    */
    function statusLabel(t, status) {
    	switch (status) {
    		case "completed": return t("statusCompleted");
    		case "running": return t("statusRunning");
    		case "waiting": return t("statusWaiting");
    		case "failed": return t("statusFailed");
    		case "rejected": return t("statusRejected");
    		case "cancelled": return t("statusCancelled");
    		case "interrupted": return t("statusInterrupted");
    		case "unavailable": return t("stateUnavailable");
    		case "idle": return t("stateIdle");
    		default: return t("unknown");
    	}
    }
    /**
    * 时间戳 → 本地时间。
    *
    * @param value
    * @returns
    */
    function formatTime(value) {
    	if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    	try {
    		return new Date(value).toLocaleString();
    	} catch {
    		return "—";
    	}
    }
    /**
    * 节点耗时。
    *
    * @param step
    * @returns
    */
    function formatDuration(step) {
    	const started = typeof step?.startedAt === "number" ? step.startedAt : null;
    	const finished = typeof step?.finishedAt === "number" ? step.finishedAt : null;
    	if (started === null || finished === null || finished < started) return "";
    	return formatMs(finished - started);
    }
    /**
    * 毫秒数 → 简短耗时。
    *
    * @param value
    * @returns
    */
    function formatMs(value) {
    	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
    	if (value < 1e3) return `${Math.max(1, Math.round(value))}ms`;
    	const seconds = value / 1e3;
    	if (seconds < 60) return `${seconds.toFixed(1)}s`;
    	return `${(seconds / 60).toFixed(1)}min`;
    }
    /**
    * 字节数 → 简短的附件大小。
    *
    * @param value
    * @returns
    */
    function formatBytes(value) {
    	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
    	if (value < 1024) return `${value} B`;
    	if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
    	if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MiB`;
    	return `${(value / 1073741824).toFixed(1)} GiB`;
    }
    /**
    * 按字符数截断长文本（prompt 可能有 256 KiB，不能整段渲染）。
    *
    * @param value
    * @param limit
    * @returns
    */
    function truncateText(value, limit) {
    	if (typeof value !== "string" || value === "") return {
    		text: "",
    		truncated: false
    	};
    	if (value.length <= limit) return {
    		text: value,
    		truncated: false
    	};
    	return {
    		text: value.slice(0, limit),
    		truncated: true
    	};
    }
    // .build/workflows/client/request.js
    /**
    * 附件地址：只用运行 id、执行序号、节点 id 与清单里的文件名。`mode` 只在
    * preview / inline 时写入，省略就是下载（保持原有的下载链接行为）。
    *
    * @param token
    * @param [mode]
    * @returns
    */
    function attachmentUrl(token, mode) {
    	const params = new URLSearchParams({
    		runId: typeof token?.runId === "string" ? token.runId : "",
    		seq: token?.seq === void 0 || token?.seq === null ? "" : String(token.seq),
    		nodeId: typeof token?.nodeId === "string" ? token.nodeId : "",
    		name: typeof token?.name === "string" ? token.name : ""
    	});
    	if (mode === "preview" || mode === "inline") params.set("mode", mode);
    	return `/buka-workflows/attachment?${params.toString()}`;
    }
    /**
    * 附件清单里的那条附件 → 路由参数。下载链接、预览请求与抽屉状态共用它。
    *
    * @param run
    * @param step
    * @param attachment
    * @returns
    */
    function attachmentToken(run, step, attachment) {
    	return {
    		runId: typeof run?.runId === "string" ? run.runId : "",
    		seq: step?.seq ?? "",
    		nodeId: typeof step?.nodeId === "string" ? step.nodeId : "",
    		name: typeof attachment?.name === "string" ? attachment.name : ""
    	};
    }
    // .build/workflows/client/components/attachments.js
    /**
    * 节点附件清单：文件名（点击打开右侧预览抽屉）、大小、描述与下载入口。
    */
    /**
    * 附件清单：文件名（点击打开右侧预览抽屉）、大小、描述与下载入口。
    *
    * @param t
    * @param run
    * @param step
    * @param attachments
    * @param [onOpen]
    * @returns
    */
    function renderAttachments(t, run, step, attachments, onOpen = null) {
    	if (!Array.isArray(attachments) || attachments.length === 0) return null;
    	return h("ul", { className: "buka-workflows-attachmentList" }, attachments.map((attachment, index) => {
    		const token = attachmentToken(run, step, attachment);
    		const name = typeof attachment?.name === "string" ? attachment.name : "attachment";
    		return h("li", {
    			key: `${String(attachment?.index ?? index)}-${name}`,
    			className: "buka-workflows-attachment"
    		}, h("button", {
    			type: "button",
    			className: "buka-workflows-attachmentLink",
    			title: t("attachmentPreviewOpenHint"),
    			onClick: () => {
    				if (typeof onOpen === "function") onOpen(run, step, attachment);
    			}
    		}, name), h("span", { className: "buka-workflows-attachmentMeta" }, formatBytes(attachment?.bytes)), typeof attachment?.description === "string" && attachment.description !== "" ? h("span", { className: "buka-workflows-attachmentDescription" }, attachment.description) : null, h("a", {
    			className: "buka-workflows-attachmentDownload",
    			href: attachmentUrl(token),
    			download: name
    		}, t("attachmentDownload")));
    	}));
    }
    // .build/workflows/client/node-model.js
    /**
    * 图模型 / 定义快照的读取：节点标题、类型、状态、出边与步骤概览。
    */
    /**
    * 节点步骤概要：创建者写的 summary，缺省时退回提示词的第一行。
    *
    * @param config
    * @returns
    */
    function summaryText(config) {
    	if (config === null || typeof config !== "object") return "";
    	const summary = typeof config.summary === "string" ? config.summary.trim() : "";
    	if (summary !== "") return summary;
    	const first = (typeof config.prompt === "string" ? config.prompt : "").split("\n").map((line) => line.trim()).find((line) => line !== "");
    	if (first === void 0) return "";
    	return truncateText(first, 160).text;
    }
    /**
    * 节点标题：步骤概要就是标题。机器人节点用创建者写的 summary（旧定义退回
    * 提示词第一行，再退回机器人名），用户介入节点用标题，终止节点用 id。
    *
    * @param node 图模型里的节点
    * @param config 定义快照里的节点
    * @returns
    */
    function nodeTitle(node, config) {
    	if (node.type === "robot") return summaryText(config) || node.robot || node.id;
    	if (node.type === "user") return node.title || node.id;
    	return node.id;
    }
    /**
    * 节点类型 → 本地化名称。
    *
    * @param t
    * @param type
    * @returns
    */
    function typeLabel(t, type) {
    	if (type === "start") return t("typeStart");
    	if (type === "robot") return t("typeRobot");
    	if (type === "user") return t("typeUser");
    	if (type === "join") return t("typeJoin");
    	if (type === "end") return t("typeEnd");
    	return String(type);
    }
    /**
    * 节点状态 → 卡片样式类。
    *
    * @param state
    * @returns
    */
    function stateClass(state) {
    	switch (state) {
    		case "completed": return "done";
    		case "running": return "running";
    		case "waiting": return "waiting";
    		case "failed":
    		case "rejected":
    		case "cancelled":
    		case "interrupted":
    		case "unavailable": return "failed";
    		default: return "idle";
    	}
    }
    /**
    * 从定义快照里取一个节点的原始配置（用于提示词、用户说明）。
    *
    * @param definition
    * @param id
    * @returns
    */
    function definitionNode(definition, id) {
    	if (definition === null || typeof definition !== "object") return null;
    	const plan = definition.plan;
    	if (plan !== null && typeof plan === "object" && plan.nodes !== null && typeof plan.nodes === "object") {
    		const node = plan.nodes[id];
    		if (node !== null && typeof node === "object") return node;
    	}
    	const raw = definition.definition;
    	if (raw !== null && typeof raw === "object" && Array.isArray(raw.nodes)) {
    		for (const node of raw.nodes) if (node !== null && typeof node === "object" && node.id === id) return node;
    	}
    	return null;
    }
    /**
    * 一个节点关联的唯一会话 id 列表（按展示顺序）：
    *
    * - 运行中 `run.current.sessionId` 排最前（当前会话优先展示）；
    * - `run.sessions[].entries` 里记录到这个节点的会话（新格式）；
    * - 旧记录没有逐次进入的 `entries` 时，退回机器人 / 首末节点归属；
    * - 该节点各次执行自己记下的 `sessionId`。
    *
    * 同一个机器人一次运行通常只有一个会话，所以正常情况下列表长度为 1；只有旧记录
    * 里一个节点在几个会话中执行过，才会出现多项（每一段历史都要有打开入口）。
    *
    * @param node 图模型里的节点
    * @param nodeSteps 该节点的执行记录
    * @param liveSession 运行中节点在 `run.current` 上的会话 id（没有则为空串）
    * @param run 运行记录
    * @returns
    */
    function collectNodeSessionIds(node, nodeSteps, liveSession, run) {
    	const ids = [];
    	const seen = /* @__PURE__ */ new Set();
    	/** @param value 候选会话 id */
    	const add = (value) => {
    		if (typeof value !== "string" || value === "" || seen.has(value)) return;
    		seen.add(value);
    		ids.push(value);
    	};
    	add(liveSession);
    	const sessions = Array.isArray(run?.sessions) ? run.sessions : [];
    	for (const session of sessions) {
    		if (session === null || typeof session !== "object") continue;
    		const entries = Array.isArray(session.entries) ? session.entries : [];
    		let listedHere = false;
    		for (const entry of entries) {
    			if (entry === null || typeof entry !== "object" || entry.nodeId !== node.id) continue;
    			listedHere = true;
    			add(typeof entry.sessionId === "string" ? entry.sessionId : session.sessionId);
    		}
    		if (listedHere) continue;
    		const sameRobot = node.type === "robot" && typeof node.robot === "string" && node.robot !== "" && session.robot === node.robot;
    		const touchesNode = session.firstNodeId === node.id || session.lastNodeId === node.id;
    		if (sameRobot || touchesNode) add(session.sessionId);
    	}
    	for (const step of nodeSteps) add(step?.sessionId);
    	return ids;
    }
    /**
    * 一行「键：值」。
    *
    * @param key
    * @param value
    * @returns React 元素
    */
    function kvRow(key, value) {
    	return h("div", { className: "buka-workflows-kvRow" }, h("span", { className: "buka-workflows-kvKey" }, key), h("span", { className: "buka-workflows-kvValue" }, value));
    }
    /**
    * 胶囊文案：机器人节点优先用创建者写的步骤概要（旧定义没有时退回机器人
    * 名），用户介入节点用标题，终止节点用 id。
    *
    * @param node
    * @returns
    */
    function capsuleText(t, node) {
    	if (node.type === "robot") return node.summary || node.robot || node.id;
    	if (node.type === "user") return node.title || node.id;
    	if (node.type === "start") return t("typeStart");
    	return node.id;
    }
    /**
    * 一条边在悬停时展示的名字。
    *
    * - 用户介入节点的边：先显示给用户看的选项文字（`labels`），这才是这条边
    *   对用户的意义；
    * - 机器人节点的边：创建者写的路由名 `names`；多条规则合并成一条边时按顺序
    *   并列；
    * - 没写名字的边：不展示，不拿目标 id 凑数。
    *
    * @param edge
    * @returns
    */
    function edgeLabel(edge) {
    	const labels = Array.isArray(edge?.labels) ? edge.labels.filter((label) => typeof label === "string" && label !== "") : [];
    	if (labels.length > 0) return labels.join(" / ");
    	const names = Array.isArray(edge?.names) ? edge.names.filter((name) => typeof name === "string" && name !== "") : [];
    	if (names.length > 0) return names.join(" / ");
    	return "";
    }
    /**
    * 边的外观色 class：只认图模型归一后的 `success` / `failure`。
    *
    * 颜色是纯展示属性（定义里的可选 `tone`），不参与路由；状态 class
    * （`is-traversed` / `is-static` / `is-hovered`）仍然各自控制线宽、实线与
    * 压暗，CSS 里让 tone 的颜色优先于它们。
    *
    * @param edge
    * @returns
    */
    function edgeToneClass(edge) {
    	if (edge?.tone === "success") return " is-success";
    	if (edge?.tone === "failure") return " is-failure";
    	return "";
    }
    /**
    * 一次用户执行的 route 展示文字：优先用所选边的 `label`（定义里用户看到的
    * 选项），找不到时退回路由键。机器人执行仍然显示路由名。
    *
    * @param node 图模型里的节点
    * @param config 定义快照里的节点
    * @param route 路由键
    * @returns
    */
    function routeText(node, config, route) {
    	if (node.type !== "user" || route === "") return route;
    	const edge = (Array.isArray(config?.next) ? config.next : []).find((item) => item?.name === route);
    	const label = typeof edge?.label === "string" ? edge.label.trim() : "";
    	return label === "" ? route : label;
    }
    /**
    * 节点类型 → Tag tone；颜色用于区分类型。
    *
    * @param type
    * @returns
    */
    function typeTone(type) {
    	if (type === "start") return "neutral";
    	if (type === "robot") return "info";
    	if (type === "user") return "warning";
    	if (type === "end") return "success";
    	return "neutral";
    }
    /**
    * 模板节点的可读标题：机器人用抽象角色名，用户用标题，起止用固定文案。
    *
    * @param node
    * @returns
    */
    function templateNodeLabel(t, node) {
    	if (node.type === "robot") return node.robot || node.summary || node.id || "";
    	if (node.type === "user") return node.title || node.id || "";
    	if (node.type === "start") return t("typeStart");
    	return t("typeEnd");
    }
    // .build/workflows/client/components/execution.js
    /**
    * 一次执行的 Tab 内容：输入、输出、附件、会话与前后步骤。
    */
    /**
    * 一次执行的 Tab 内容：当次输入（渲染后的提示词）、当次输出、会话，以及这次
    * 执行把运行带到了哪个节点的哪一次执行（点一下就能跳过去）。
    *
    * @param step
    * @param full 落盘的节点结果全文（旧记录可能没有）
    * @param config 定义快照里的节点
    * @param node 图模型里的节点
    * @param steps 整个运行按顺序记下的所有执行
    * @param definition 定义快照（下一步要拿目标节点的步骤概要）
    * @param graph 图模型（同上）
    * @param run 运行记录（最后一步用它找到终止节点）
    * @param [nodeSessionIds] 节点级已经展示过的会话 id（这里不再重复）
    * @returns React 元素
    */
    function renderExecution(page, step, full, config, node, steps, definition, graph, run, nodeSessionIds = []) {
    	const { t, openAttachment, openSession, focusExecution } = page;
    	const visit = typeof step.visit === "number" ? step.visit : 1;
    	const route = typeof step.route === "string" ? step.route.trim() : "";
    	let promptText = typeof full?.prompt === "string" && full.prompt !== "" ? full.prompt : "";
    	let inputMissing = false;
    	if (node.type === "user") {
    		const stepInput = typeof step.input === "string" ? step.input.trim() : "";
    		const pending = run !== null && typeof run === "object" && run.pendingUser !== null && typeof run.pendingUser === "object" && run.pendingUser.nodeId === node.id && run.pendingUser.visit === visit ? run.pendingUser : null;
    		const pendingText = typeof pending?.detail === "string" && pending.detail !== "" ? pending.detail : typeof pending?.title === "string" ? pending.title : "";
    		const detail = typeof config?.detail === "string" ? config.detail : "";
    		const title = typeof config?.title === "string" ? config.title : "";
    		promptText = stepInput !== "" ? stepInput : pendingText !== "" ? pendingText : detail !== "" ? detail : title;
    	} else if (promptText === "") {
    		if (visit === 1) promptText = typeof config?.prompt === "string" ? config.prompt : "";
    		else inputMissing = true;
    	}
    	const stepText = typeof step.text === "string" ? step.text : "";
    	const fullText = typeof full?.text === "string" ? full.text : "";
    	const outputText = fullText !== "" ? fullText : stepText;
    	const attachments = Array.isArray(full?.attachments) ? full.attachments : Array.isArray(step.attachments) ? step.attachments : [];
    	const duration = formatDuration(step);
    	const nextStep = steps.find((other) => other.seq === step.seq + 1) ?? null;
    	const nextNode = nextStep === null ? null : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === nextStep.nodeId) ?? null;
    	const nextTitle = nextStep === null ? "" : nextNode === null ? nextStep.nodeId : nodeTitle(nextNode, definitionNode(definition, nextStep.nodeId));
    	const nextVisit = nextStep !== null && typeof nextStep.visit === "number" ? nextStep.visit : 1;
    	const lastSeq = steps.reduce((max, other) => Math.max(max, other.seq), 0);
    	const result = run !== null && typeof run?.result === "object" ? run.result : null;
    	const endTarget = nextStep === null && step.seq === lastSeq && typeof result?.lastNode === "string" && result.lastNode !== step.nodeId ? result.lastNode : null;
    	const endNode = endTarget === null ? null : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === endTarget) ?? null;
    	const endTitle = endNode === null ? endTarget : nodeTitle(endNode, definitionNode(definition, endTarget ?? ""));
    	/** 下一步的目标：优先下一次执行，其次这次执行走到的终止节点。 */
    	const nextTarget = nextStep !== null ? {
    		nodeId: nextStep.nodeId,
    		seq: nextStep.seq,
    		title: nextTitle,
    		visit: `#${nextVisit}`
    	} : endTarget !== null ? {
    		nodeId: endTarget,
    		seq: null,
    		title: endTitle,
    		visit: null
    	} : null;
    	const prevStep = steps.find((other) => other.seq === step.seq - 1) ?? null;
    	const prevNode = prevStep === null ? null : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === prevStep.nodeId) ?? null;
    	const prevTitle = prevStep === null ? "" : prevNode === null ? prevStep.nodeId : nodeTitle(prevNode, definitionNode(definition, prevStep.nodeId));
    	const prevVisit = prevStep !== null && typeof prevStep.visit === "number" ? prevStep.visit : 1;
    	const startNode = (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === graph?.start) ?? null;
    	const firstTarget = prevStep === null && step.seq === 1 && startNode?.type === "start" && startNode.id !== step.nodeId ? {
    		nodeId: startNode.id,
    		seq: null,
    		title: t("typeStart"),
    		visit: null
    	} : null;
    	const prevTarget = prevStep !== null ? {
    		nodeId: prevStep.nodeId,
    		seq: prevStep.seq,
    		title: prevTitle,
    		visit: `#${prevVisit}`
    	} : firstTarget;
    	return h("div", {
    		key: `${String(step.seq)}-${String(step.nodeId)}`,
    		className: "buka-workflows-tabPanel",
    		role: "tabpanel"
    	}, h("div", { className: "buka-workflows-tabMeta" }, h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: statusTone(step.status) }, statusLabel(t, step.status)), route === "" ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `${t("routeLabel")}: ${routeText(node, config, route)}`), attachments.length === 0 ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, String(t("attachmentCount")).replace("{n}", String(attachments.length))), typeof step.startedAt === "number" ? h("span", { className: "buka-workflows-meta" }, formatTime(step.startedAt)) : null, duration === "" ? null : h("span", { className: "buka-workflows-meta" }, duration), step.compacted === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "success" }, t("sessionCompacted")) : null, step.recovered === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("sessionRecovered")) : null, step.timedOut === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, t("executionTimedOut")) : null, step.aborted === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, t("executionAborted")) : null), h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("executionInput")), promptText === "" ? h("p", { className: "buka-workflows-hint" }, t(inputMissing ? "executionInputMissing" : "executionNoInput")) : h("pre", { className: "buka-workflows-pre" }, promptText)), h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("executionOutput")), outputText === "" ? h("p", { className: "buka-workflows-hint" }, t(attachments.length === 0 ? "executionNoOutput" : "executionOutputAttachmentsOnly")) : h("pre", { className: "buka-workflows-pre" }, outputText)), attachments.length === 0 ? null : h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("executionAttachments")), renderAttachments(t, run, step, attachments, openAttachment)), typeof step.error === "string" && step.error !== "" ? h("p", {
    		className: "buka-workflows-failure",
    		role: "alert"
    	}, `${t("error")}: ${step.error}`) : null, typeof step.stopReason === "string" && step.stopReason !== "" && step.stopReason !== "completed" ? h("p", { className: "buka-workflows-warn" }, `${t("stopReason")}: ${step.stopReason}`) : null, typeof step.compactionError === "string" && step.compactionError !== "" ? h("p", { className: "buka-workflows-warn" }, `${t("sessionCompactFailed")} ${step.compactionError}`) : null, typeof step.sessionResetReason === "string" && step.sessionResetReason !== "" ? h("p", { className: "buka-workflows-warn" }, `${t("sessionReset")} ${step.sessionResetReason}`) : null, typeof step.sessionId === "string" && step.sessionId !== "" && !nodeSessionIds.includes(step.sessionId) ? h("div", { className: "buka-workflows-stepActions" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    		onClick: () => openSession(step)
    	}, t("openSession")), h("code", { className: "buka-workflows-inlineCode" }, step.sessionId)) : null, h("div", { className: "buka-workflows-executionNav" }, h("div", { className: "buka-workflows-navSide is-prev" }, h("span", { className: "buka-workflows-label" }, t("executionPrev")), prevTarget === null ? h("p", { className: "buka-workflows-hint" }, t("executionPrevNone")) : h("button", {
    		type: "button",
    		className: "buka-workflows-prevLink",
    		title: prevTarget.visit === null ? prevTarget.title : `${prevTarget.title} ${prevTarget.visit}`,
    		onClick: () => focusExecution(prevTarget.nodeId, prevTarget.seq)
    	}, h("span", {
    		className: "buka-workflows-prevArrow",
    		"aria-hidden": true
    	}, "←"), h("span", { className: "buka-workflows-prevTitle" }, prevTarget.title), prevTarget.visit === null ? h("span", { className: "buka-workflows-prevVisit" }, t("executionStart")) : h("span", { className: "buka-workflows-prevVisit" }, prevTarget.visit))), h("div", { className: "buka-workflows-navSide is-next" }, h("span", { className: "buka-workflows-label" }, t("executionNext")), nextTarget === null ? h("p", { className: "buka-workflows-hint" }, t("executionNextEnded")) : h("button", {
    		type: "button",
    		className: "buka-workflows-nextLink",
    		title: nextTarget.visit === null ? nextTarget.title : `${nextTarget.title} ${nextTarget.visit}`,
    		onClick: () => focusExecution(nextTarget.nodeId, nextTarget.seq)
    	}, h("span", { className: "buka-workflows-nextTitle" }, nextTarget.title), nextTarget.visit === null ? h("span", { className: "buka-workflows-nextVisit" }, t("executionEnded")) : h("span", { className: "buka-workflows-nextVisit" }, nextTarget.visit), h("span", {
    		className: "buka-workflows-nextArrow",
    		"aria-hidden": true
    	}, "→")))));
    }
    // .build/workflows/client/components/footer.js
    /**
    * 详情页底部的图例与说明。
    */
    /**
    * 详情页底部的图例与说明。它固定占据页面底部，不跟内容一起滚动，内容再长
    * 也不会把它顶下去。模板页没有执行状态，传入 false 省掉「节点状态」图例，
    * 连线图例也换成单一「流程走向」。
    *
    * @param [withStates]
    * @returns React 元素
    */
    function renderFooter(page, withStates = true) {
    	const { t, renderLegend } = page;
    	return h("footer", { className: "buka-workflows-footer" }, h("p", { className: "buka-workflows-hint" }, t("graphInteractHint")), renderLegend({ states: withStates }));
    }
    // .build/workflows/client/components/list.js
    /**
    * 运行列表视图。
    */
    /**
    * 列表视图。
    *
    * @returns React 元素
    */
    function renderList(page) {
    	const { t, list, setSelectedId, showArchived } = page;
    	if (list.error !== null && list.runs.length === 0) return h("div", { className: "buka-workflows-listPane" }, h("p", {
    		className: "buka-workflows-failure",
    		role: "alert"
    	}, `${t("loadFailed")} ${list.error}`));
    	if (list.status === "loading" && list.runs.length === 0) return h("div", { className: "buka-workflows-listPane" }, h("p", {
    		className: "buka-workflows-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")));
    	if (list.runs.length === 0) return h("div", { className: "buka-workflows-listPane" }, h("div", { className: "buka-workflows-emptyBox" }, h("p", { className: "buka-workflows-empty" }, showArchived ? t("archiveEmpty") : t("welcome")), showArchived ? null : h("p", { className: "buka-workflows-hint" }, t("welcomeHint"))));
    	return h("div", { className: "buka-workflows-listPane" }, h("ul", { className: "buka-workflows-cards" }, ...list.runs.map((run) => h("li", { key: run.runId }, h("button", {
    		type: "button",
    		className: "buka-workflows-card",
    		onClick: () => setSelectedId(run.runId)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, typeof run.seq === "number" ? h("span", { className: "buka-workflows-seq" }, `#${run.seq}`) : null, h("span", { className: "buka-workflows-cardTitle" }, run.goal || run.runId)), h("span", { className: "buka-workflows-cardTags" }, typeof run.archivedAt === "number" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("archived")) : null, run.waitingForUser === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, t("waitingForUser")) : null, h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: statusTone(run.status) }, statusLabel(t, run.status)))), h("span", { className: "buka-workflows-meta" }, `${run.runId} · ${formatTime(run.createdAt)}${typeof run.error === "string" && run.error !== "" ? ` · ${run.error}` : ""}`))))));
    }
    // .build/workflows/client/components/notices.js
    /**
    * 运行等待提示：用户介入 / 机器人提问与审批。
    */
    /**
    * 运行停在用户介入节点时的提示条：说明在等什么（标题 + 渲染后的说明），列出
    * 用户可选的出口与追加问题，并提供直达工作流创建者会话的入口。数据由
    * supervisor 写在 `run.pendingUser` 上。
    *
    * @param run 运行记录
    * @returns React 元素；没有等待中的用户介入时返回 null
    */
    function renderUserNotice(page, run) {
    	const { t, openSession } = page;
    	const pending = run !== null && typeof run === "object" && run.pendingUser !== null && typeof run.pendingUser === "object" ? run.pendingUser : null;
    	if (pending === null) return null;
    	const nodeId = typeof pending.nodeId === "string" ? pending.nodeId : "";
    	const title = typeof pending.title === "string" ? pending.title.trim() : "";
    	const detail = typeof pending.detail === "string" ? pending.detail.trim() : "";
    	const sessionId = typeof pending.sessionId === "string" ? pending.sessionId : "";
    	const requestedAt = typeof pending.requestedAt === "number" && Number.isFinite(pending.requestedAt) ? formatTime(pending.requestedAt) : "";
    	const body = [title, detail].filter((text) => text !== "").join("\n");
    	const options = Array.isArray(pending.options) ? pending.options.filter((option) => isRecord(option)) : [];
    	const questions = Array.isArray(pending.questions) ? pending.questions.filter((question) => isRecord(question)) : [];
    	return h("div", {
    		className: "buka-workflows-interactionNotice buka-workflows-userNotice",
    		role: "status"
    	}, h("div", { className: "buka-workflows-interactionHead" }, h("span", { className: "buka-workflows-interactionTitle" }, t("userWaitingTitle")), nodeId === "" ? null : h("code", { className: "buka-workflows-inlineCode" }, nodeId), requestedAt === "" ? null : h("span", { className: "buka-workflows-meta" }, requestedAt)), body === "" ? null : h("p", { className: "buka-workflows-interactionBody" }, body), options.length === 0 ? null : h("div", { className: "buka-workflows-userNoticeGroup" }, h("span", { className: "buka-workflows-label" }, t("userChoice")), h("ul", { className: "buka-workflows-userChoiceList" }, ...options.map((option, index) => {
    		const label = typeof option.label === "string" ? option.label.trim() : "";
    		const description = typeof option.description === "string" ? option.description.trim() : "";
    		return h("li", {
    			key: `${String(option.name ?? index)}-${label}`,
    			className: "buka-workflows-userChoice"
    		}, h("span", { className: "buka-workflows-userChoiceLabel" }, label === "" ? t("userAnswerSkipped") : label), description === "" ? null : h("span", { className: "buka-workflows-userChoiceDesc" }, description));
    	}))), questions.length === 0 ? null : h("div", { className: "buka-workflows-userNoticeGroup" }, h("span", { className: "buka-workflows-label" }, t("userAnswers")), h("ul", { className: "buka-workflows-userQuestionList" }, ...questions.map((question, index) => {
    		const id = typeof question.id === "string" ? question.id : String(index);
    		const header = typeof question.header === "string" ? question.header.trim() : "";
    		const text = typeof question.question === "string" ? question.question.trim() : "";
    		return h("li", {
    			key: id,
    			className: "buka-workflows-userQuestion"
    		}, header === "" ? null : h("span", { className: "buka-workflows-userQuestionHeader" }, header), text === "" ? null : h("span", { className: "buka-workflows-userQuestionText" }, text));
    	}))), sessionId === "" ? null : h("div", { className: "buka-workflows-interactionActions" }, h("span", { className: "buka-workflows-hint" }, t("userWaitingBody")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    		onClick: () => openSession({ sessionId })
    	}, t("openSession"))));
    }
    /**
    * 运行在等待用户时（机器人提问 / 请求批准）的提示条：说明在等什么，并提供
    * 直达当前机器人会话的入口。数据由 supervisor 写在 `run.pendingInteraction`。
    *
    * @param run 运行记录
    * @returns React 元素；没有等待中的交互时返回 null
    */
    function renderInteractionNotice(page, run) {
    	const { t, openSession } = page;
    	const interaction = run !== null && typeof run === "object" && run.pendingInteraction !== null && typeof run.pendingInteraction === "object" ? run.pendingInteraction : null;
    	if (interaction === null) return null;
    	const approval = interaction.kind === "approval";
    	const planReview = interaction.planReview === true && !approval;
    	const toolName = typeof interaction.toolName === "string" ? interaction.toolName.trim() : "";
    	const nodeId = typeof interaction.nodeId === "string" ? interaction.nodeId : "";
    	const sessionId = typeof interaction.sessionId === "string" ? interaction.sessionId : "";
    	const askedAt = typeof interaction.askedAt === "number" && Number.isFinite(interaction.askedAt) ? formatTime(interaction.askedAt) : "";
    	let body = "";
    	if (approval) {
    		const displayReason = typeof interaction.displayReason === "string" ? interaction.displayReason.trim() : "";
    		const reason = typeof interaction.reason === "string" ? interaction.reason.trim() : "";
    		body = displayReason !== "" ? displayReason : reason;
    	} else if (planReview) body = t("planReviewBody");
    	else {
    		const questions = Array.isArray(interaction.questions) ? interaction.questions : [];
    		const first = isRecord(questions[0]) ? questions[0] : null;
    		const question = typeof first?.question === "string" ? first.question.trim() : "";
    		const header = typeof first?.header === "string" ? first.header.trim() : "";
    		body = question !== "" ? question : header;
    	}
    	const title = planReview ? t("waitingForPlanReview") : approval ? `${t("waitingForApproval")}${toolName === "" ? "" : ` ${toolName}`}` : t("waitingForAnswer");
    	return h("div", {
    		className: "buka-workflows-interactionNotice",
    		role: "status"
    	}, h("div", { className: "buka-workflows-interactionHead" }, h("span", { className: "buka-workflows-interactionTitle" }, title), nodeId === "" ? null : h("code", { className: "buka-workflows-inlineCode" }, nodeId), askedAt === "" ? null : h("span", { className: "buka-workflows-meta" }, askedAt)), body === "" ? null : h("p", { className: "buka-workflows-interactionBody" }, body), sessionId === "" ? null : h("div", { className: "buka-workflows-interactionActions" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    		onClick: () => openSession({ sessionId })
    	}, t(planReview ? "openPlanReviewSession" : approval ? "openApprovalSession" : "openAnswerSession"))));
    }
    // .build/workflows/client/graph/geometry.js
    /**
    * 节点图的几何小工具：边名字的落点与 tooltip 定位。
    */
    /**
    * 边名字的落点：钉在这条线箭头的位置上，不跟着鼠标走。箭头要么在竖段中点、
    * 要么在目标端口前，所以名字不会压在节点上；拿不到 SVG 几何时返回 `null`，
    * 退回鼠标位置。
    *
    * @param path 悬浮中的命中区 path
    * @param arrow 这条线的方向箭头
    * @returns
    */
    function edgeTipAnchor(path, arrow) {
    	if (path === null || typeof path !== "object") return null;
    	const svg = path.ownerSVGElement;
    	if (svg === null || svg === void 0 || typeof svg !== "object") return null;
    	const svgRecord = svg;
    	if (typeof svgRecord.getBoundingClientRect !== "function") return null;
    	if (arrow === null || typeof arrow !== "object") return null;
    	const arrowRecord = arrow;
    	if (typeof arrowRecord.x !== "number" || typeof arrowRecord.y !== "number") return null;
    	const rect = svgRecord.getBoundingClientRect();
    	return {
    		left: rect.left + arrowRecord.x + 8,
    		top: rect.top + arrowRecord.y
    	};
    }
    /**
    * 边名字 tooltip 的位置：优先用钉住的中段落点，否则跟随鼠标；两种情况都夹
    * 在视口内，靠近右 / 下边缘时不会被裁掉。测试环境没有 `window`，此时直接
    * 用原值。
    *
    * @param tip
    * @returns
    */
    function edgeTipPosition(tip) {
    	const anchor = tip.anchor ?? null;
    	const left = anchor === null ? tip.x + 12 : anchor.left;
    	const top = anchor === null ? tip.y + 14 : anchor.top;
    	const width = typeof window !== "undefined" && typeof window.innerWidth === "number" ? window.innerWidth : 0;
    	const height = typeof window !== "undefined" && typeof window.innerHeight === "number" ? window.innerHeight : 0;
    	if (width <= 0 || height <= 0) return {
    		left: `${left}px`,
    		top: `${top}px`
    	};
    	const minTop = anchor === null ? 8 : 24;
    	const maxTop = height - (anchor === null ? 40 : 24);
    	return {
    		left: `${Math.max(8, Math.min(left, width - 248))}px`,
    		top: `${Math.max(minTop, Math.min(top, maxTop))}px`
    	};
    }
    // .build/workflows/client/components/page-shell.js
    /**
    * 页面外壳：页签、工具栏、内容区、页脚、抽屉与 Toast。
    */
    function renderPage(page) {
    	const { t, list, selectedId, detail, templates, showArchived, setShowArchived, reload, notice, setNotice, edgeTip, view, switchView, selectedTemplateId, openSettingsDialog, renderList, renderDetail, renderTemplatesList, renderTemplateDetail, renderFooter, renderSettingsDialog, renderAttachmentDrawer, renderRunNodeDrawer, renderTemplateNodeDrawer, renderEdgeDrawer } = page;
    	const selectedRun = selectedId !== null ? detail.data?.run ?? null : null;
    	const inTemplates = view === "templates";
    	const inTemplateDetail = inTemplates && selectedTemplateId !== null;
    	const selectedTemplate = inTemplateDetail ? templates.items.find((item) => item.id === selectedTemplateId) ?? null : null;
    	return h("div", { className: "buka-workflows-page" }, h("header", { className: "buka-workflows-head" }, h("div", { className: "buka-workflows-headInner" }, h("div", { className: "buka-workflows-titleRow" }, h("div", { className: "buka-workflows-tabbar" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workflows-tabList",
    		label: t("tabsLabel"),
    		value: view,
    		onChange: (value) => switchView(value),
    		items: [{
    			value: "runs",
    			label: t("runsTab"),
    			id: "buka-workflows-tab-runs",
    			panelId: "buka-workflows-panel-runs"
    		}, {
    			value: "templates",
    			label: t("templatesTab"),
    			id: "buka-workflows-tab-templates",
    			panelId: "buka-workflows-panel-templates"
    		}]
    	})), h("div", { className: "buka-workflows-toolbar" }, ...inTemplates ? selectedTemplate === null ? [] : [h("code", { className: "buka-workflows-inlineCode" }, selectedTemplate.id)] : selectedId === null ? [showArchived ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton buka-workflows-back",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 13 }),
    		onClick: () => setShowArchived(false)
    	}, t("archiveBack")) : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: 13 }),
    		onClick: () => setShowArchived(true)
    	}, list.archivedCount > 0 ? `${t("archiveView")} (${list.archivedCount})` : t("archiveView")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, { size: 13 }),
    		onClick: openSettingsDialog
    	}, t("settings"))] : [
    		typeof selectedRun?.archivedAt === "number" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("archived")) : null,
    		h("code", { className: "buka-workflows-inlineCode" }, selectedRun?.runId ?? selectedId),
    		h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: statusTone(selectedRun?.status ?? "") }, statusLabel(t, selectedRun?.status ?? ""))
    	], ...inTemplates ? [] : [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		onClick: reload
    	}, t("refresh"))])))), h("div", { className: "buka-workflows-body" }, inTemplates ? selectedTemplateId === null ? renderTemplatesList() : renderTemplateDetail() : selectedId === null ? renderList() : renderDetail()), inTemplateDetail ? renderFooter(false) : !inTemplates && selectedId !== null ? renderFooter() : null, renderSettingsDialog(), renderRunNodeDrawer(), renderTemplateNodeDrawer(), renderEdgeDrawer(), renderAttachmentDrawer(), notice === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Toast, {
    		key: notice.seq,
    		text: notice.text,
    		...notice.kind === "success" ? { tone: "success" } : {},
    		...notice.kind === "success" ? {} : { icon: h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}) },
    		holdMs: 3200,
    		onDone: () => setNotice(null)
    	}), edgeTip === null ? null : h("div", {
    		className: `buka-workflows-edgeTip${edgeTip.anchor ? " is-anchored" : ""}`,
    		role: "tooltip",
    		style: edgeTipPosition(edgeTip)
    	}, edgeTip.text));
    }
    // .build/workflows/client/components/settings-dialog.js
    /**
    * 自动归档设置对话框。
    */
    /**
    * 自动归档设置对话框：启用开关 + 归档 / 删除小时数 + 保存。打开时先读 Host
    * 的当前设置，输入按整小时校验；读 / 存失败都留在框里说明原因。
    *
    * @returns React 元素
    */
    function renderSettingsDialog(page) {
    	const { t, settingsOpen, settingsDraft, setSettingsDraft, settingsLoading, settingsSaving, settingsError, settingsValidationError, closeSettingsDialog, saveSettings } = page;
    	const draft = settingsDraft;
    	const validation = draft === null ? null : settingsValidationError(draft);
    	const saving = settingsSaving;
    	const canSave = !saving && !settingsLoading && draft !== null && validation === null;
    	/** @param text 错误文案 */
    	const formError = (text) => h("p", {
    		className: "buka-workflows-formError",
    		role: "alert"
    	}, text);
    	const body = [];
    	if (settingsLoading) body.push(h("p", { className: "buka-workflows-hint" }, t("settingsLoading")));
    	if (draft === null) {
    		if (!settingsLoading && settingsError !== null) body.push(formError(settingsError));
    	} else {
    		body.push(h("div", { className: "buka-workflows-settingRow" }, h("div", { className: "buka-workflows-settingText" }, h("div", { className: "buka-workflows-settingHead" }, h("span", { className: "buka-workflows-settingTitle" }, t("archiveEnabled")), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: draft.enabled ? "success" : "neutral" }, draft.enabled ? t("settingsEnabled") : t("settingsDisabled"))), h("span", { className: "buka-workflows-settingDesc" }, t("archiveEnabledDesc"))), h("button", {
    			type: "button",
    			role: "switch",
    			"aria-checked": draft.enabled,
    			"aria-label": t("archiveEnabled"),
    			className: `buka-workflows-switch${draft.enabled ? " is-on" : ""}`,
    			disabled: saving,
    			onClick: () => setSettingsDraft((current) => current === null ? current : {
    				...current,
    				enabled: !current.enabled
    			})
    		}, h("span", {
    			className: "buka-workflows-switchThumb",
    			"aria-hidden": true
    		}))), h("div", { className: "buka-workflows-hoursField" }, h("span", { className: "buka-workflows-fieldLabel" }, t("archiveAfterHours")), h("div", { className: "buka-workflows-hoursControl" }, h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    			type: "number",
    			min: 1,
    			max: 720,
    			step: 1,
    			value: draft.archiveHours,
    			disabled: saving || !draft.enabled,
    			className: "buka-workflows-hoursInput",
    			onChange: (event) => setSettingsDraft((current) => current === null ? current : {
    				...current,
    				archiveHours: String(event.target.value)
    			})
    		}), h("span", { className: "buka-workflows-hoursUnit" }, t("hoursUnit"))), h("span", { className: "buka-workflows-fieldHint" }, t("archiveAfterHoursHint"))), h("div", { className: "buka-workflows-hoursField" }, h("span", { className: "buka-workflows-fieldLabel" }, t("deleteAfterHours")), h("div", { className: "buka-workflows-hoursControl" }, h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    			type: "number",
    			min: 2,
    			max: 8760,
    			step: 1,
    			value: draft.deleteHours,
    			disabled: saving || !draft.enabled,
    			className: "buka-workflows-hoursInput",
    			onChange: (event) => setSettingsDraft((current) => current === null ? current : {
    				...current,
    				deleteHours: String(event.target.value)
    			})
    		}), h("span", { className: "buka-workflows-hoursUnit" }, t("hoursUnit"))), h("span", { className: "buka-workflows-fieldHint" }, t("deleteAfterHoursHint"))), h("p", { className: "buka-workflows-hint" }, t("archiveDefaultsHint")));
    		if (validation !== null) body.push(formError(validation));
    		if (settingsError !== null) body.push(formError(settingsError));
    	}
    	return h(ClientModal, {
    		open: settingsOpen,
    		onClose: closeSettingsDialog,
    		title: t("archiveSettingsTitle"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeSettingsDialog,
    			disabled: saving
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "button",
    			onClick: saveSettings,
    			disabled: !canSave
    		}, saving ? t("saving") : t("save")))
    	}, h("div", { className: "buka-workflows-dialogForm" }, ...body));
    }
    // .build/workflows/client/components/templates.js
    /**
    * 模板页签：模板列表、详情与共享数据。
    */
    /**
    * 模板页签里的模板列表。
    *
    * @returns React 元素
    */
    function renderTemplatesList(page) {
    	const { t, templates, setSelectedEdgeKey, setSelectedTemplateId, setSelectedTemplateNodeId } = page;
    	if (templates.error !== null && templates.items.length === 0) return h("div", { className: "buka-workflows-templateList" }, h("p", {
    		className: "buka-workflows-failure",
    		role: "alert"
    	}, `${t("loadFailed")} ${templates.error}`));
    	if (templates.status === "loading" && templates.items.length === 0) return h("div", { className: "buka-workflows-templateList" }, h("p", {
    		className: "buka-workflows-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")));
    	if (templates.items.length === 0) return h("div", { className: "buka-workflows-templateList" }, h("div", { className: "buka-workflows-emptyBox" }, h("p", { className: "buka-workflows-empty" }, t("templatesEmpty")), h("p", { className: "buka-workflows-hint" }, t("templatesHint"))));
    	return h("div", { className: "buka-workflows-templateList" }, h("p", { className: "buka-workflows-hint" }, t("templatesHint")), ...templates.items.map((template) => h("button", {
    		key: template.id,
    		type: "button",
    		className: "buka-workflows-templateCard",
    		onClick: () => {
    			setSelectedTemplateNodeId(null);
    			setSelectedEdgeKey(null);
    			setSelectedTemplateId(template.id);
    		}
    	}, h("span", { className: "buka-workflows-templateHead" }, h("span", { className: "buka-workflows-templateTitle" }, template.name), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, template.id), h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {
    		size: 14,
    		className: "buka-workflows-templateChevron"
    	})), h("p", { className: "buka-workflows-templateDesc" }, template.description))));
    }
    /**
    * 模板详情的共享数据：详情主体与两个抽屉都从这里取。
    *
    * @returns
    */
    function templateDetailModel(page) {
    	const { templates, selectedTemplateId } = page;
    	if (selectedTemplateId === null) return null;
    	const template = templates.items.find((item) => item.id === selectedTemplateId) ?? null;
    	if (template === null) return null;
    	const graph = template.graph !== null && typeof template.graph === "object" ? template.graph : null;
    	return {
    		template,
    		graph,
    		nodes: Array.isArray(graph?.nodes) ? graph.nodes : []
    	};
    }
    /**
    * 模板详情：名字 + 描述 + 分层二维图；节点信息和连线配置都在右侧抽屉里。
    *
    * @returns React 元素
    */
    function renderTemplateDetail(page) {
    	const { t, setSelectedEdgeKey, setSelectedTemplateId, selectedTemplateNodeId, setSelectedTemplateNodeId, renderGraph, templateDetailModel } = page;
    	const model = templateDetailModel();
    	if (model === null) return h("p", { className: "buka-workflows-empty" }, t("templatesEmpty"));
    	const { template, graph, nodes } = model;
    	const activeNodeId = selectedTemplateNodeId !== null && nodes.some((node) => node.id === selectedTemplateNodeId) ? selectedTemplateNodeId : null;
    	const graphBody = graph === null || nodes.length === 0 ? h("p", { className: "buka-workflows-empty" }, t("templatesNoFlow")) : renderGraph(graph, activeNodeId, (id) => setSelectedTemplateNodeId(id), { states: false });
    	return h("div", { className: "buka-workflows-pageBody buka-workflows-detail buka-workflows-templateDetail" }, h("div", { className: "buka-workflows-templateHead" }, h("button", {
    		type: "button",
    		className: "buka-workflows-templateBackButton buka-workflows-back",
    		"aria-label": t("templatesBack"),
    		onClick: () => {
    			setSelectedTemplateId(null);
    			setSelectedTemplateNodeId(null);
    			setSelectedEdgeKey(null);
    		}
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 16 })), h("span", { className: "buka-workflows-templateTitle" }, template.name), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, template.id)), h("p", { className: "buka-workflows-templateDesc" }, template.description), graphBody);
    }
    // .build/workflows/client/drawers/attachment.js
    /**
    * 附件预览抽屉：预览正文、下载入口与关闭。
    */
    /**
    * Markdown 预览里的链接不接管运行页：http(s) 在新窗口打开，其它协议直接
    * 拦掉；无论哪种都不让页面跳走。
    *
    * @param event
    */
    function interceptAttachmentLink(_page, event) {
    	event.preventDefault();
    	const target = event.target;
    	const anchor = target !== null && typeof target.closest === "function" ? target.closest("a[href]") : null;
    	if (anchor === null) return;
    	const href = anchor.getAttribute("href") ?? "";
    	if (!/^https?:\/\//iu.test(href)) return;
    	if (typeof window !== "undefined" && typeof window.open === "function") window.open(href, "_blank", "noopener,noreferrer");
    }
    /**
    * 文字预览用的 labels：复制按钮，以及代码工具栏的代码 / 换行 / 不换行。
    *
    * @returns
    */
    function attachmentPreviewLabels(page) {
    	const { t } = page;
    	return { code: {
    		copyLabel: t("copy"),
    		copiedLabel: t("copied"),
    		toolbarLabels: {
    			codeLabel: t("code"),
    			wrapLabel: t("wrap"),
    			unwrapLabel: t("unwrap")
    		}
    	} };
    }
    /**
    * 抽屉里的下载链接：与列表里的下载入口同一个路由，不带 mode。
    *
    * @param viewer
    * @returns
    */
    function renderAttachmentDownload(page, viewer) {
    	const { t } = page;
    	return h("a", {
    		className: "buka-workflows-drawerDownload",
    		href: attachmentUrl(viewer),
    		download: viewer.name
    	}, typeof _deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular === "function" ? h(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, withAria({
    		size: 14,
    		"aria-hidden": true
    	})) : null, h("span", null, t("attachmentDownload")));
    }
    /**
    * 抽屉正文：按 Host 返回的 `attachment.kind` 分成文字 / 图片 / PDF / 其它。
    *
    * @param viewer
    * @returns
    */
    function renderAttachmentPreviewBody(page, viewer) {
    	const { t, attachmentView, attachmentPreview, setAttachmentPreview, fetchAttachmentPreview, interceptAttachmentLink, attachmentPreviewLabels, renderAttachmentDownload } = page;
    	const preview = attachmentPreview;
    	if (preview.status === "idle") return [];
    	if (preview.status === "loading") return [h("div", {
    		className: "buka-workflows-drawerStatus",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), h("span", null, t("attachmentPreviewLoading")))];
    	if (preview.status === "failed") return [h("p", {
    		className: "buka-workflows-failure",
    		role: "alert"
    	}, preview.error ?? t("attachmentPreviewFailed")), h("div", { className: "buka-workflows-drawerActions" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => fetchAttachmentPreview(attachmentView)
    	}, t("attachmentPreviewRetry")), renderAttachmentDownload(viewer))];
    	const data = preview.data !== null && typeof preview.data === "object" ? preview.data : {};
    	if (data.kind === "image") return [h("img", {
    		className: "buka-workflows-drawerImage",
    		src: attachmentUrl(viewer, "inline"),
    		alt: viewer.name,
    		onError: () => setAttachmentPreview({
    			status: "failed",
    			data: null,
    			error: t("attachmentPreviewImageFailed")
    		})
    	})];
    	if (data.kind === "pdf") return [h("iframe", {
    		className: "buka-workflows-drawerFrame",
    		src: attachmentUrl(viewer, "inline"),
    		title: viewer.name
    	}), h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewPdfHint"))];
    	if (data.kind === "text") {
    		const text = typeof data.text === "string" ? data.text : "";
    		const children = [];
    		const markdownFile = /\.(md|markdown)$/iu.test(viewer.name);
    		if (text === "") children.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewEmpty")));
    		else if (markdownFile && typeof _deepseek_ai_dsh_client_ui_primitives.MarkdownText === "function") children.push(h("div", {
    			className: "buka-workflows-drawerMarkdown",
    			onClickCapture: interceptAttachmentLink
    		}, h(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
    			text,
    			omitHtml: true,
    			labels: attachmentPreviewLabels()
    		})));
    		else if (!markdownFile && typeof _deepseek_ai_dsh_client_ui_primitives.CodeBlock === "function" && typeof _deepseek_ai_dsh_client_ui_primitives.languageForPath === "function") children.push(h(_deepseek_ai_dsh_client_ui_primitives.CodeBlock, {
    			code: text,
    			lang: (0, _deepseek_ai_dsh_client_ui_primitives.languageForPath)(viewer.name),
    			lineNumbers: true,
    			showHeader: true,
    			copyLabel: t("copy"),
    			copiedLabel: t("copied"),
    			className: "buka-workflows-drawerCode"
    		}));
    		else children.push(h("pre", { className: "buka-workflows-pre" }, text));
    		if (data.truncated === true) children.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewTruncated")));
    		return children;
    	}
    	if (data.kind === "binary") return [h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewBinary")), h("div", { className: "buka-workflows-drawerActions" }, renderAttachmentDownload(viewer))];
    	return [h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewUnsupported")), h("div", { className: "buka-workflows-drawerActions" }, renderAttachmentDownload(viewer))];
    }
    /**
    * 右侧附件预览抽屉：头部是文件身份与下载 / 关闭，正文按预览状态分派。
    *
    * @returns
    */
    function renderAttachmentDrawer(page) {
    	const { t, attachmentView, closeAttachment, renderAttachmentDownload, renderAttachmentPreviewBody, renderDrawerHead } = page;
    	const viewer = attachmentView;
    	if (viewer === null) return null;
    	const meta = [formatBytes(viewer.bytes), viewer.description].filter((item) => typeof item === "string" && item !== "");
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: closeAttachment,
    		title: viewer.name,
    		closeLabel: t("attachmentPreviewClose"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer"
    	}, renderDrawerHead({
    		title: viewer.name,
    		meta: meta.join(" · "),
    		icon: typeof _deepseek_ai_dsh_client_ui_primitives.FileTypeIcon === "function" ? h(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
    			path: viewer.name,
    			size: 18
    		}) : null,
    		actions: [renderAttachmentDownload(viewer)],
    		closeLabel: t("attachmentPreviewClose"),
    		onClose: closeAttachment
    	}), h("div", { className: "buka-workflows-drawerBody" }, ...renderAttachmentPreviewBody(viewer)));
    }
    // .build/workflows/client/drawers/edge.js
    /**
    * 连线配置抽屉：合并规则的提示词 / 外观色与运行走过情况。
    */
    /**
    * 一条边的原始配置规则：从定义快照 / 模板节点里找 `from` 节点的 `next` 中
    * `to` 等于目标节点的全部规则。合并成一条线时逐条保留，不丢 prompt / tone。
    *
    * @param edge
    * @param definition
    * @returns
    */
    function edgeRulesFor(_page, edge, definition) {
    	const node = definitionNode(definition, edge.from ?? "");
    	return (Array.isArray(node?.next) ? node.next : []).filter((rule) => rule !== null && typeof rule === "object" && rule.to === edge.to);
    }
    /**
    * 连线配置里的一条规则。
    *
    * @param rule
    * @param key
    * @returns React 元素
    */
    function renderEdgeRule(page, rule, key) {
    	const { t } = page;
    	const name = typeof rule.name === "string" ? rule.name.trim() : "";
    	const label = typeof rule.label === "string" ? rule.label.trim() : "";
    	const description = typeof rule.description === "string" ? rule.description.trim() : "";
    	const tone = rule.tone === "success" || rule.tone === "failure" ? rule.tone : "";
    	const prompt = truncateText(typeof rule.prompt === "string" ? rule.prompt : "", 4e3);
    	return h("div", {
    		key,
    		className: "buka-workflows-edgeRule"
    	}, h("div", { className: "buka-workflows-edgeRuleHead" }, name === "" ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `${t("edgeRoute")}: ${name}`), label === "" ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, `${t("edgeOption")}: ${label}`), tone === "" ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: tone === "success" ? "success" : "warning" }, t(tone === "success" ? "edgeToneSuccess" : "edgeToneFailure"))), description === "" ? null : h("span", { className: "buka-workflows-edgeRuleDesc" }, description), h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("edgePrompt")), prompt.text === "" ? h("p", { className: "buka-workflows-hint" }, t("edgeNoPrompt")) : h("pre", { className: "buka-workflows-pre" }, prompt.text), prompt.truncated ? h("p", { className: "buka-workflows-hint" }, t("promptTruncated")) : null, prompt.text === "" ? null : h("p", { className: "buka-workflows-hint" }, t("edgePromptHint"))));
    }
    /**
    * 连线配置抽屉：来源 → 目标、每条合并规则的路由键 / 选项 / 说明 / 提示词 /
    * 外观色，以及运行页面的走过情况。模板页不展示运行状态。
    *
    * @returns
    */
    function renderEdgeDrawer(page) {
    	const { t, selectedId, selectedEdgeKey, setSelectedEdgeKey, selectedTemplateId, capsuleText, templateNodeLabel, runDetailModel, templateDetailModel, renderDrawerHead, edgeRulesFor, renderEdgeRule } = page;
    	if (selectedEdgeKey === null) return null;
    	if (selectedId === null && selectedTemplateId === null) return null;
    	const templateModel = templateDetailModel();
    	const runModel = templateModel === null ? runDetailModel() : null;
    	const model = templateModel ?? runModel;
    	if (model === null) return null;
    	const graph = model.graph;
    	if (graph === null) return null;
    	const edge = graph.edges.find((item) => item.key === selectedEdgeKey) ?? null;
    	if (edge === null) return null;
    	const nodes = graph.nodes;
    	const fromNode = nodes.find((node) => node.id === edge.from) ?? null;
    	const toNode = nodes.find((node) => node.id === edge.to) ?? null;
    	const labelOf = templateModel === null ? capsuleText : templateNodeLabel;
    	const fromLabel = fromNode === null ? edge.from : labelOf(fromNode);
    	const toLabel = toNode === null ? edge.to : labelOf(toNode);
    	const rules = edgeRulesFor(edge, templateModel === null ? runModel === null ? null : runModel.definition : { definition: { nodes: templateModel.template.nodes ?? [] } });
    	const fallback = rules.length > 0 || edge.prompt === "" && (!Array.isArray(edge.names) || edge.names.length === 0) && (!Array.isArray(edge.labels) || edge.labels.length === 0) && edge.tone === "" ? rules : [{
    		name: Array.isArray(edge.names) ? edge.names.join(" / ") : "",
    		label: Array.isArray(edge.labels) ? edge.labels.join(" / ") : "",
    		description: "",
    		prompt: typeof edge.prompt === "string" ? edge.prompt : "",
    		tone: edge.tone
    	}];
    	const meta = `${fromLabel} → ${toLabel}${edge.loop === true ? ` · ${t("edgeLoop")}` : ""}`;
    	const stateRows = templateModel !== null ? null : h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("edgeState")), h("div", { className: "buka-workflows-kv" }, kvRow(t("edgeTraversed"), edge.traversed === true ? t("yes") : t("no")), kvRow(t("edgeTraversals"), String(edge.traversals ?? 0))));
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: () => setSelectedEdgeKey(null),
    		title: t("edgeDrawerTitle"),
    		closeLabel: t("close"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer"
    	}, renderDrawerHead({
    		title: t("edgeDrawerTitle"),
    		meta,
    		closeLabel: t("close"),
    		onClose: () => setSelectedEdgeKey(null)
    	}), h("div", { className: "buka-workflows-drawerBody" }, stateRows, h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("edgeRules")), fallback.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("edgeRulesEmpty")) : h("div", { className: "buka-workflows-edgeRules" }, ...fallback.map((rule, index) => renderEdgeRule(rule, `${edge.key}-${index}`))))));
    }
    // .build/workflows/client/avatars.js
    /**
    * 预设头像：id → emoji / 底色。
    *
    * 预设表统一在界面侧公共包里，与 robots 页共用同一份；图模型只带 id，
    * 不认识的 id 当作没有头像。
    */
    /**
    * 头像 id → 预设；不认识的 id 返回 null（图上就不画头像）。
    *
    * @param id
    * @returns
    */
    function avatarPreset(id) {
    	const preset = findAvatarPreset(id);
    	return preset === void 0 ? null : {
    		emoji: preset.emoji,
    		color: preset.color
    	};
    }
    /**
    * 机器人头像小圆片：emoji 画在预设色的浅底上。[size] 是直径（px），`className`
    * 给胶囊 / 详情标题这类不同位置补间距。
    *
    * @param avatar 头像 id
    * @param size
    * @param [className]
    * @returns React 元素；没有头像时返回 null
    */
    function renderAvatar(avatar, size, className = "") {
    	const preset = avatarPreset(avatar);
    	if (preset === null) return null;
    	return h("span", {
    		className: `buka-workflows-avatar${className === "" ? "" : ` ${className}`}`,
    		style: {
    			width: `${size}px`,
    			height: `${size}px`,
    			fontSize: `${Math.max(8, Math.round(size * .62))}px`,
    			backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
    			borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`
    		},
    		"aria-hidden": true
    	}, preset.emoji);
    }
    // .build/workflows/client/drawers/node.js
    /**
    * 运行详情的节点抽屉内容。
    */
    /**
    * 节点抽屉的内容：节点配置与按执行拆开的 Tab（输入 / 输出 / 会话 / 下一步）。
    *
    * @param node
    * @param definition
    * @param graph
    * @param steps
    * @param fullResults
    * @param run 运行记录
    * @param [onClose] 关闭抽屉的回调
    * @returns React 元素
    */
    function renderNodePanel(page, node, definition, graph, steps, fullResults, run, onClose = null) {
    	const { t, executionIndex, setExecutionIndex, openAttachment, openSession, focusExecution, renderExecution } = page;
    	if (node === null) return h("p", { className: "buka-workflows-hint" }, t("nodeNotRun"));
    	const config = definitionNode(definition, node.id);
    	const nodeSteps = steps.filter((step) => step.nodeId === node.id);
    	const state = typeof node.state === "string" ? node.state : "idle";
    	const rows = [];
    	if (node.type === "robot") {
    		rows.push(kvRow(t("nodeExecutor"), node.robot || "—"));
    		if (typeof node.timeoutMs === "number") rows.push(kvRow(t("nodeTimeout"), formatMs(node.timeoutMs) || "—"));
    		if (typeof node.maxVisits === "number") rows.push(kvRow(t("nodeMaxVisits"), String(node.maxVisits)));
    	} else if (node.type === "user") {
    		rows.push(kvRow(t("typeUser"), node.title || "—"));
    		const pendingUser = run !== null && typeof run === "object" && run.pendingUser !== null && typeof run.pendingUser === "object" ? run.pendingUser : null;
    		let detail = "";
    		if (pendingUser !== null && pendingUser.nodeId === node.id && typeof pendingUser.detail === "string") detail = pendingUser.detail;
    		if (detail === "" && typeof config?.detail === "string") detail = config.detail;
    		if (detail === "" && typeof node.detail === "string") detail = node.detail;
    		if (detail === "") {
    			const lastUserStep = nodeSteps.filter((step) => step.type === "user").pop();
    			if (typeof lastUserStep?.input === "string") detail = lastUserStep.input;
    		}
    		const detailText = detail.trim();
    		if (detailText !== "") rows.push(kvRow(t("userDetail"), detailText));
    	} else if (node.type === "end") rows.push(kvRow(t("nodeEndStatus"), statusLabel(t, node.endStatus ?? "completed")));
    	const template = truncateText(config?.prompt, 4e3);
    	const isStart = node.type === "start";
    	const title = isStart ? t("typeStart") : nodeTitle(node, config);
    	const current = (run !== null && Array.isArray(run.active) ? run.active.filter((entry) => entry !== null && typeof entry === "object") : run !== null && typeof run === "object" && run.current !== null && typeof run.current === "object" ? [run.current] : []).find((entry) => entry.nodeId === node.id) ?? null;
    	const isLiveNode = current !== null && current.nodeId === node.id;
    	const liveSession = isLiveNode && typeof current.sessionId === "string" ? current.sessionId : "";
    	const nodeSessionIds = collectNodeSessionIds(node, nodeSteps, liveSession, run);
    	const liveStartedAt = isLiveNode && typeof current.startedAt === "number" && Number.isFinite(current.startedAt) ? current.startedAt : null;
    	const liveDuration = liveStartedAt === null ? "" : formatMs(Date.now() - liveStartedAt);
    	const duration = liveDuration !== "" ? liveDuration : formatMs(node.durationMs);
    	const recoveryAttempts = isLiveNode && typeof current.recoveryAttempts === "number" && Number.isFinite(current.recoveryAttempts) ? current.recoveryAttempts : 1;
    	const recoveringText = isLiveNode && current.recovering === true ? String(t("sessionRecovering")).replace("{n}", String(recoveryAttempts)) : "";
    	let finalStep = null;
    	let finalText = "";
    	let finalAttachments = [];
    	if (node.type === "end" && node.state !== "idle") for (let index = steps.length - 1; index >= 0; index -= 1) {
    		const candidate = steps[index];
    		if (candidate === void 0 || candidate.type !== "robot") continue;
    		const full = fullResults.get(`${String(candidate.seq)}:${candidate.nodeId}`) ?? null;
    		const text = typeof full?.text === "string" && full.text !== "" ? full.text : typeof candidate.text === "string" ? candidate.text : "";
    		const attachments = Array.isArray(full?.attachments) ? full.attachments : Array.isArray(candidate.attachments) ? candidate.attachments : [];
    		if (text === "" && attachments.length === 0) continue;
    		finalStep = candidate;
    		finalText = text;
    		finalAttachments = attachments;
    		break;
    	}
    	const finalNode = finalStep === null ? null : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === finalStep.nodeId) ?? null;
    	const finalTitle = finalStep === null ? "" : finalNode === null ? finalStep.nodeId : nodeTitle(finalNode, definitionNode(definition, finalStep.nodeId));
    	const finalVisit = finalStep !== null && typeof finalStep.visit === "number" ? finalStep.visit : 1;
    	const activeIndex = nodeSteps.length === 0 ? -1 : executionIndex === null ? nodeSteps.length - 1 : Math.min(Math.max(executionIndex, 0), nodeSteps.length - 1);
    	const activeStep = activeIndex === -1 ? null : nodeSteps[activeIndex] ?? null;
    	const activeFull = activeStep === null ? null : fullResults.get(`${String(activeStep.seq)}:${String(activeStep.nodeId)}`) ?? null;
    	const executions = nodeSteps.length === 0 || activeStep === null ? h("p", { className: "buka-workflows-hint" }, t("nodeNotRun")) : h("div", { className: "buka-workflows-executions" }, h("div", {
    		className: "buka-workflows-tabs",
    		role: "tablist",
    		"aria-label": t("nodeExecutions")
    	}, ...nodeSteps.map((step, index) => {
    		const visit = typeof step.visit === "number" ? step.visit : index + 1;
    		return h("button", {
    			key: `${String(step.seq)}-${String(step.nodeId)}`,
    			type: "button",
    			role: "tab",
    			"aria-selected": index === activeIndex,
    			className: `buka-workflows-tab${index === activeIndex ? " is-active" : ""}`,
    			title: `${t("execution")} ${visit} · ${statusLabel(t, step.status)}`,
    			onClick: () => setExecutionIndex(index)
    		}, h("span", {
    			className: `buka-workflows-tabDot is-${stateClass(step.status)}`,
    			"aria-hidden": true
    		}), `#${visit}`);
    	})), renderExecution(activeStep, activeFull, config, node, steps, definition, graph, run, nodeSessionIds));
    	const sessionBar = node.type !== "robot" || nodeSessionIds.length === 0 ? null : h("div", { className: "buka-workflows-sessionBar" }, h("span", { className: "buka-workflows-label" }, t("nodeSession")), nodeSessionIds.length === 1 ? [
    		h("code", {
    			key: "session",
    			className: "buka-workflows-inlineCode"
    		}, nodeSessionIds[0]),
    		liveSession !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    			key: "live",
    			tone: "info"
    		}, t("sessionLive")) : null,
    		h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "open",
    			variant: "outline",
    			size: "sm",
    			className: "buka-workflows-smallButton",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    			onClick: () => openSession({ sessionId: nodeSessionIds[0] })
    		}, t("openSession"))
    	] : [h("span", {
    		key: "hint",
    		className: "buka-workflows-hint"
    	}, t("nodeSessionsLegacy")), h("span", {
    		key: "list",
    		className: "buka-workflows-sessionList"
    	}, ...nodeSessionIds.map((sessionId) => h("span", {
    		key: sessionId,
    		className: "buka-workflows-sessionRow"
    	}, h("code", { className: "buka-workflows-inlineCode" }, sessionId), sessionId === liveSession ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("sessionLive")) : null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    		onClick: () => openSession({ sessionId })
    	}, t("openSession")))))]);
    	return h("div", {
    		className: "buka-workflows-inspector",
    		role: "region",
    		"aria-label": t("inspector")
    	}, h("div", { className: "buka-workflows-inspectorHead" }, renderAvatar(node.avatar, 22, "buka-workflows-inspectorAvatar"), h("span", { className: "buka-workflows-inspectorTitle" }, title), title === node.id ? null : h("code", { className: "buka-workflows-inspectorId" }, node.id), node.id === graph?.start ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("nodeStart")) : null, isStart ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: typeTone(node.type) }, typeLabel(t, node.type)), node.type === "robot" && node.mode === "plan" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("modePlan")) : null, isStart ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: statusTone(state) }, statusLabel(t, state)), recoveringText === "" ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, recoveringText), node.visits > 1 ? h("span", { className: "buka-workflows-meta" }, `×${node.visits}`) : null, duration === "" ? null : h("span", { className: "buka-workflows-meta" }, duration), onClose === null ? null : h("button", {
    		type: "button",
    		className: "buka-workflows-inspectorClose buka-workflows-drawerClose",
    		"aria-label": t("close"),
    		title: t("close"),
    		onClick: onClose
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 16 }))), rows.length === 0 ? null : h("div", { className: "buka-workflows-kv" }, ...rows), sessionBar, isStart ? h("p", { className: "buka-workflows-hint" }, t("startNodeHint")) : null, node.type === "end" && node.state !== "idle" ? h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("finalDeliverable")), finalStep === null ? h("p", { className: "buka-workflows-hint" }, t("finalDeliverableEmpty")) : finalText === "" ? h("p", { className: "buka-workflows-hint" }, t("executionOutputAttachmentsOnly")) : h("pre", { className: "buka-workflows-pre" }, finalText), finalStep === null ? null : renderAttachments(t, run, finalStep, finalAttachments, openAttachment), finalStep === null ? null : h("button", {
    		type: "button",
    		className: "buka-workflows-nextLink",
    		title: `${finalTitle} #${String(finalVisit)}`,
    		onClick: () => focusExecution(finalStep.nodeId, finalStep.seq)
    	}, h("span", {
    		className: "buka-workflows-nextArrow",
    		"aria-hidden": true
    	}, "←"), h("span", { className: "buka-workflows-nextTitle" }, `${t("finalDeliverableFrom")} ${finalTitle}`), h("span", { className: "buka-workflows-nextVisit" }, `#${String(finalVisit)}`))) : null, node.unreachable === true ? h("p", { className: "buka-workflows-hint" }, t("nodeUnreachable")) : null, nodeSteps.length === 0 && template.text !== "" ? h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("nodePrompt")), h("pre", { className: "buka-workflows-pre" }, template.text), template.truncated ? h("p", { className: "buka-workflows-hint" }, t("promptTruncated")) : null) : null, node.type === "end" || isStart ? null : h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("nodeExecutions")), executions));
    }
    // .build/workflows/client/drawers/node-drawers.js
    /**
    * 运行 / 模板详情的节点抽屉外壳。
    */
    /** 关闭运行详情的节点抽屉。 */
    function closeRunNodeDrawer(page) {
    	const { setSelectedNodeId, setExecutionIndex } = page;
    	setSelectedNodeId(null);
    	setExecutionIndex(null);
    }
    /** 关闭模板详情的节点抽屉。 */
    function closeTemplateNodeDrawer(page) {
    	const { setSelectedTemplateNodeId } = page;
    	setSelectedTemplateNodeId(null);
    }
    /**
    * 运行详情的节点抽屉：内容沿用原来的节点面板，关闭按钮放到面板标题行。
    *
    * @returns
    */
    function renderRunNodeDrawer(page) {
    	const { t, selectedId, selectedNodeId, capsuleText, renderNodePanel, runDetailModel, closeRunNodeDrawer } = page;
    	if (selectedId === null || selectedNodeId === null) return null;
    	const model = runDetailModel();
    	if (model === null) return null;
    	const node = model.nodes.find((item) => item.id === selectedNodeId) ?? null;
    	if (node === null) return null;
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: closeRunNodeDrawer,
    		title: capsuleText(node),
    		closeLabel: t("close"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer buka-workflows-nodeDrawer"
    	}, h("div", { className: "buka-workflows-drawerBody" }, renderNodePanel(node, model.definition, model.graph, model.steps, model.fullResults, model.run, closeRunNodeDrawer)));
    }
    /**
    * 模板详情的节点抽屉。
    *
    * @returns
    */
    function renderTemplateNodeDrawer(page) {
    	const { t, selectedTemplateId, selectedTemplateNodeId, templateNodeLabel, renderTemplateNodePanel, templateDetailModel, closeTemplateNodeDrawer } = page;
    	if (selectedTemplateId === null || selectedTemplateNodeId === null) return null;
    	const model = templateDetailModel();
    	if (model === null) return null;
    	const node = model.nodes.find((item) => item.id === selectedTemplateNodeId) ?? null;
    	if (node === null) return null;
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: closeTemplateNodeDrawer,
    		title: templateNodeLabel(node),
    		closeLabel: t("close"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer buka-workflows-nodeDrawer"
    	}, h("div", { className: "buka-workflows-drawerBody" }, renderTemplateNodePanel(node, model.template, closeTemplateNodeDrawer)));
    }
    // .build/workflows/client/drawers/template-node.js
    /**
    * 模板详情的节点抽屉内容。
    */
    /**
    * 模板节点抽屉的内容：说明这个节点「做什么 / 什么时候需要它」，并把它的出边
    * 连同条件列成流转去向。
    *
    * @param node 图模型里的节点
    * @param template 模板对象（含原始 nodes）
    * @param [onClose] 关闭抽屉的回调
    * @returns React 元素
    */
    function renderTemplateNodePanel(page, node, template, onClose = null) {
    	const { t, templateNodeLabel } = page;
    	if (node === null) return h("p", { className: "buka-workflows-hint" }, t("templatesNoFlow"));
    	const rawNodes = Array.isArray(template?.nodes) ? template.nodes : [];
    	const config = rawNodes.find((item) => item?.id === node.id) ?? null;
    	const byId = new Map(rawNodes.map((item) => [item.id, item]));
    	const rows = [];
    	if (node.type === "robot") {
    		rows.push(kvRow(t("templatesRole"), node.robot || "—"));
    		if (typeof node.summary === "string" && node.summary !== "") rows.push(kvRow(t("templatesPurpose"), node.summary));
    	} else if (node.type === "user") {
    		if (typeof node.title === "string" && node.title !== "") rows.push(kvRow(t("typeUser"), node.title));
    		if (typeof node.detail === "string" && node.detail !== "") rows.push(kvRow(t("templatesPurpose"), node.detail));
    	} else if (node.type === "end") rows.push(kvRow(t("nodeEndStatus"), statusLabel(t, node.endStatus ?? "completed")));
    	const transitions = (Array.isArray(config?.next) ? config.next : []).map((rule) => {
    		const target = byId.get(rule.to);
    		const label = typeof rule.label === "string" && rule.label !== "" ? rule.label : typeof rule.name === "string" && rule.name !== "" ? rule.name : "";
    		const condition = typeof rule.description === "string" && rule.description !== "" ? rule.description : typeof rule.prompt === "string" && rule.prompt !== "" ? rule.prompt : "";
    		const head = label === "" ? rule.to : `${label} → ${target === void 0 ? rule.to : templateNodeLabel(target)}`;
    		return h("div", {
    			key: `${String(rule.name ?? "")}-${String(rule.to)}`,
    			className: "buka-workflows-templateTransition"
    		}, h("span", { className: "buka-workflows-templateTransitionHead" }, h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, head)), condition === "" ? null : h("span", { className: "buka-workflows-templateTransitionBody" }, condition));
    	});
    	const title = templateNodeLabel(node);
    	return h("div", {
    		className: "buka-workflows-inspector",
    		role: "region",
    		"aria-label": t("inspector")
    	}, h("div", { className: "buka-workflows-inspectorHead" }, h("span", { className: "buka-workflows-inspectorTitle" }, title), title === node.id ? null : h("code", { className: "buka-workflows-inspectorId" }, node.id), node.type === "start" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("nodeStart")) : null, node.type === "robot" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("templatesAbstractRole")) : null, h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: typeTone(node.type) }, typeLabel(t, node.type)), onClose === null ? null : h("button", {
    		type: "button",
    		className: "buka-workflows-inspectorClose buka-workflows-drawerClose",
    		"aria-label": t("close"),
    		title: t("close"),
    		onClick: onClose
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 16 }))), node.type === "start" ? h("p", { className: "buka-workflows-hint" }, t("startNodeHint")) : null, rows.length === 0 ? null : h("div", { className: "buka-workflows-kv" }, ...rows), h("div", { className: "buka-workflows-inspectorSection" }, h("span", { className: "buka-workflows-label" }, t("templatesTransitions")), transitions.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("templatesNoTransitions")) : h("div", { className: "buka-workflows-templateTransitions" }, ...transitions)));
    }
    // .build/workflows/client/graph/legend.js
    /**
    * 节点图例：节点类型、节点状态与连线。
    */
    /**
    * 图例：节点类型（胶囊颜色）、节点状态（胶囊左侧圆点）与连线。模板页没有执行状态，
    * 传入 `{ states: false }` 时省略「节点状态」一组；连线也不再区分「已走过 / 未走过」，
    * 只留一条「流程走向」的实线样例。
    *
    * @param [options]
    * @returns React 元素
    */
    function renderLegend(page, options = {}) {
    	const { t } = page;
    	const states = [
    		["done", t("legendDone")],
    		["running", t("legendRunning")],
    		["waiting", t("legendWaiting")],
    		["failed", t("legendFailed")],
    		["idle", t("legendIdle")]
    	];
    	return h("div", { className: "buka-workflows-legend" }, h("span", { className: "buka-workflows-legendGroup" }, h("span", { className: "buka-workflows-legendTitle" }, t("legendTypes")), ...[
    		"start",
    		"robot",
    		"user",
    		"join",
    		"end"
    	].map((type) => h("span", {
    		key: type,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendCapsule is-${type}`,
    		"aria-hidden": true
    	}), typeLabel(t, type)))), options.states === false ? null : h("span", { className: "buka-workflows-legendGroup" }, h("span", { className: "buka-workflows-legendTitle" }, t("legendStates")), ...states.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendDot is-${kind}`,
    		"aria-hidden": true
    	}), label))), h("span", { className: "buka-workflows-legendGroup" }, h("span", { className: "buka-workflows-legendTitle" }, t("legendEdges")), ...options.states === false ? [h("span", {
    		key: "flow",
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: "buka-workflows-legendLine is-static",
    		"aria-hidden": true
    	}), t("legendFlow"))] : ["traversed", ""].map((kind, index) => {
    		const labels = [t("legendTraversed"), t("legendPending")];
    		return h("span", {
    			key: `${kind || "pending"}-${index}`,
    			className: "buka-workflows-legendItem"
    		}, h("span", {
    			className: `buka-workflows-legendLine${kind === "" ? "" : ` is-${kind}`}`,
    			"aria-hidden": true
    		}), labels[index]);
    	})));
    }
    // .build/workflows/client/graph/render-graph.js
    /**
    * 分层二维节点图：节点按坐标绝对定位，SVG 画可绕行的连线。
    */
    /**
    * 分层二维节点图：节点按坐标绝对定位（同一层的并行节点在同一排），SVG 画
    * 从节点上 / 下端口进出、可向左右两侧绕行的连线。
    *
    * @param graph 路由返回的图模型（含节点坐标与连线）
    * @param activeNodeId 当前选中 / 抽屉中的节点
    * @param [onNodeSelect] 点胶囊时的回调；不传则回退到运行详情的选中逻辑
    * @param [options] 传 `{ states: false }` 时按「没有执行状态」画：模板是参考流程，胶囊保持类型配色，不套「未运行」的灰虚线
    * @returns React 元素
    */
    function renderGraph(page, graph, activeNodeId, onNodeSelect = null, options = {}) {
    	const { t, setSelectedNodeId, setExecutionIndex, edgeTip, setEdgeTip, selectedEdgeKey, setSelectedEdgeKey, setSelectedTemplateNodeId, capsuleText } = page;
    	const showStates = options.states !== false;
    	const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    	if (nodes.length === 0) return h("p", { className: "buka-workflows-empty" }, t("graphEmpty"));
    	const edges = Array.isArray(graph.edges) ? graph.edges : [];
    	const nodeWidth = typeof graph.nodeWidth === "number" ? graph.nodeWidth : 260;
    	const nodeHeight = typeof graph.nodeHeight === "number" ? graph.nodeHeight : 28;
    	const legacyRows = Array.isArray(graph.rows) ? graph.rows : [];
    	const legacy = !Array.isArray(graph.positions) && legacyRows.length > 0;
    	const legacyDotX = typeof graph.dotX === "number" ? graph.dotX : 14;
    	const legacyRailWidth = typeof graph.width === "number" ? graph.width : legacyDotX;
    	const positions = legacy ? legacyRows.map((row) => ({
    		id: row.id ?? "",
    		layer: typeof row.index === "number" ? row.index : 0,
    		x: legacyRailWidth + nodeWidth / 2,
    		y: typeof row.y === "number" ? row.y : 0
    	})) : Array.isArray(graph.positions) ? graph.positions : [];
    	const nodeById = new Map(nodes.map((node) => [node.id, node]));
    	const width = legacy ? legacyRailWidth + nodeWidth : typeof graph.width === "number" ? graph.width : 0;
    	const height = typeof graph.height === "number" ? graph.height : 0;
    	const hoveredEdgeKey = edgeTip === null ? null : edgeTip.key;
    	const drawableEdges = edges.filter((edge) => typeof edge.d === "string" && edge.d !== "");
    	const hoveredEdge = hoveredEdgeKey === null ? null : drawableEdges.find((edge) => edge.key === hoveredEdgeKey) ?? null;
    	/**
    	* 一条边的可见线 / 箭头的公共类名：保留运行状态、tone、选中与悬浮压暗。
    	*
    	* @param edge
    	* @param extra
    	* @returns
    	*/
    	function edgeClass(edge, extra = "") {
    		return `buka-workflows-edge is-${edge.kind}${showStates ? "" : " is-static"}${edge.traversed === true ? " is-traversed" : ""}${edgeToneClass(edge)}${selectedEdgeKey === edge.key ? " is-selected" : ""}${extra}`;
    	}
    	/**
    	* 点一条边：与节点抽屉互斥，关闭悬停名字，再打开 / 收起连线配置抽屉。
    	*
    	* @param edge
    	*/
    	function selectEdge(edge) {
    		setEdgeTip(null);
    		setSelectedNodeId(null);
    		setExecutionIndex(null);
    		setSelectedTemplateNodeId(null);
    		setSelectedEdgeKey(selectedEdgeKey === edge.key ? null : edge.key);
    	}
    	return h("div", { className: "buka-workflows-graphPane" }, h("div", {
    		className: "buka-workflows-vgraph",
    		style: {
    			width: `${width}px`,
    			height: `${height}px`
    		}
    	}, h("svg", {
    		className: "buka-workflows-vgraphSvg",
    		width,
    		height,
    		viewBox: `0 0 ${width} ${height}`,
    		role: "group",
    		"aria-label": t("legendEdges")
    	}, ...drawableEdges.filter((edge) => edge !== hoveredEdge).map((edge) => h("path", {
    		key: edge.key,
    		className: edgeClass(edge, hoveredEdge === null ? "" : " is-dimmed"),
    		d: edge.d
    	})), hoveredEdge === null ? null : h("path", {
    		key: hoveredEdge.key,
    		className: edgeClass(hoveredEdge, " is-hovered"),
    		d: hoveredEdge.d
    	}), ...edges.map((edge) => {
    		const arrow = edge.arrow;
    		if (arrow === null || typeof arrow !== "object") return null;
    		if (typeof arrow.x !== "number" || typeof arrow.y !== "number") return null;
    		const hovered = hoveredEdgeKey === edge.key;
    		return h("g", {
    			key: `arrow-${edge.key}`,
    			className: `buka-workflows-edgeArrow is-${edge.kind}${showStates ? "" : " is-static"}${edge.traversed === true ? " is-traversed" : ""}${edgeToneClass(edge)}${selectedEdgeKey === edge.key ? " is-selected" : ""}${hovered ? " is-hovered" : ""}${hoveredEdge !== null && !hovered ? " is-dimmed" : ""}`,
    			transform: `translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle ?? 90})`
    		}, h("path", { d: "M-3.5,-4 L3.5,0 L-3.5,4 Z" }));
    	}), ...edges.map((edge) => {
    		if (typeof edge.d !== "string" || edge.d === "") return null;
    		const label = edgeLabel(edge);
    		const fromNode = nodeById.get(edge.from) ?? null;
    		const toNode = nodeById.get(edge.to) ?? null;
    		const show = label === "" ? null : (event) => {
    			const arrow = edge.arrow;
    			const anchor = arrow !== null && typeof arrow === "object" && typeof arrow.x === "number" && typeof arrow.y === "number" ? edgeTipAnchor(event.currentTarget, arrow) : null;
    			setEdgeTip({
    				key: edge.key,
    				kind: edge.kind,
    				text: label,
    				x: event.clientX,
    				y: event.clientY,
    				anchor
    			});
    		};
    		return h("path", {
    			key: `hit-${edge.key}`,
    			className: "buka-workflows-edgeHit",
    			d: edge.d,
    			"data-edge-key": edge.key,
    			role: "button",
    			tabIndex: 0,
    			"aria-label": String(t("edgeAriaLabel")).replace("{from}", fromNode === null ? edge.from : capsuleText(fromNode)).replace("{to}", toNode === null ? edge.to : capsuleText(toNode)),
    			onClick: () => selectEdge(edge),
    			onKeyDown: (event) => {
    				if (event.key !== "Enter" && event.key !== " ") return;
    				event.preventDefault();
    				selectEdge(edge);
    			},
    			onMouseEnter: show ?? void 0,
    			onMouseLeave: label === "" ? void 0 : () => setEdgeTip((current) => current !== null && current.key === edge.key ? null : current)
    		});
    	}), ...positions.map((position) => {
    		const node = nodeById.get(position.id);
    		if (node === void 0) return null;
    		return h("circle", {
    			key: `dot-${position.id}`,
    			className: `buka-workflows-vgraphDot is-${stateClass(node.state)}`,
    			cx: legacy ? legacyDotX : position.x - nodeWidth / 2 - 10,
    			cy: position.y,
    			r: 4
    		});
    	})), ...positions.map((position) => {
    		const node = nodeById.get(position.id);
    		if (node === void 0) return null;
    		const state = typeof node.state === "string" ? node.state : "idle";
    		const kind = stateClass(state);
    		const selected = activeNodeId === node.id;
    		return h("div", {
    			key: node.id,
    			className: "buka-workflows-vgraphNode",
    			style: {
    				left: `${position.x - nodeWidth / 2}px`,
    				top: `${position.y - nodeHeight / 2}px`,
    				width: `${nodeWidth}px`,
    				height: `${nodeHeight}px`
    			}
    		}, h("button", {
    			type: "button",
    			className: `buka-workflows-capsule is-${node.type}${showStates && kind === "idle" ? " is-idle" : ""}${showStates && kind === "running" ? " is-running" : ""}${selected ? " is-selected" : ""}${typeof node.avatar === "string" && node.avatar !== "" ? " has-avatar" : ""}`,
    			title: showStates ? `${node.id} · ${typeLabel(t, node.type)} · ${statusLabel(t, state)}` : `${node.id} · ${typeLabel(t, node.type)}`,
    			"aria-pressed": selected,
    			onClick: () => {
    				setEdgeTip(null);
    				setSelectedEdgeKey(null);
    				if (onNodeSelect !== null) onNodeSelect(node.id);
    				else {
    					setSelectedNodeId(node.id);
    					setExecutionIndex(null);
    				}
    			}
    		}, renderAvatar(node.avatar, 20, "buka-workflows-capsuleAvatar"), h("span", { className: "buka-workflows-capsuleText" }, capsuleText(node))), node.visits > 1 ? h("span", {
    			className: "buka-workflows-visitBadge",
    			title: `${t("visitsLabel")}: ${node.visits}`
    		}, `×${node.visits}`) : null);
    	})));
    }
    // .build/workflows/client/state/use-attachments.js
    /**
    * 附件预览抽屉的 effect 与动作：打开 / 关闭、拉取预览。
    */
    /**
    * 抽屉预览的进行中请求。只用模块级的一个变量保存：页面只挂一份，它不参与
    * 渲染，新的请求先中止旧的，关闭抽屉时也中止。
    */
    let attachmentAbort = null;
    /**
    * 附件预览的 effect 与动作。
    *
    * @param state 页面状态
    * @param t 词典翻译函数
    * @returns 附件预览动作
    */
    function useAttachmentsEffects(state, t) {
    	const { attachmentView, setAttachmentView, setAttachmentPreview, selectedId } = state;
    	const { view } = state;
    	/**
    	* 中止抽屉里进行中的预览请求（如果有）。
    	*/
    	function abortAttachmentPreview() {
    		if (attachmentAbort === null) return;
    		attachmentAbort.abort();
    		attachmentAbort = null;
    	}
    	/**
    	* 在右侧抽屉里打开附件预览。同一个附件重复点击也会重新拉取一次。
    	*
    	* @param run
    	* @param step
    	* @param attachment
    	*/
    	function openAttachment(run, step, attachment) {
    		const runId = typeof run?.runId === "string" ? run.runId : "";
    		const name = typeof attachment?.name === "string" ? attachment.name : "";
    		if (runId === "" || name === "") return;
    		setAttachmentView({
    			runId,
    			seq: step?.seq ?? null,
    			nodeId: typeof step?.nodeId === "string" ? step.nodeId : "",
    			name,
    			bytes: typeof attachment?.bytes === "number" ? attachment.bytes : null,
    			description: typeof attachment?.description === "string" ? attachment.description : ""
    		});
    		setAttachmentPreview({
    			status: "loading",
    			data: null,
    			error: null
    		});
    	}
    	/** 关闭附件预览抽屉：中止进行中的请求并恢复空闲状态。 */
    	function closeAttachment() {
    		abortAttachmentPreview();
    		setAttachmentView(null);
    		setAttachmentPreview({
    			status: "idle",
    			data: null,
    			error: null
    		});
    	}
    	/**
    	* 拉取一次附件预览。新的请求先中止旧的；被中止的请求不再写状态。
    	*
    	* @param viewer
    	*/
    	function fetchAttachmentPreview(viewer) {
    		if (viewer === null || typeof viewer !== "object") return;
    		abortAttachmentPreview();
    		const controller = typeof AbortController === "function" ? new AbortController() : null;
    		attachmentAbort = controller;
    		setAttachmentPreview((previous) => ({
    			status: "loading",
    			data: previous?.status === "ready" ? previous.data : null,
    			error: null
    		}));
    		const init = { headers: { accept: "application/json" } };
    		if (controller !== null) init.signal = controller.signal;
    		fetch(attachmentUrl(viewer, "preview"), init).then(async (response) => {
    			const parsed = await response.json().catch(() => null);
    			const body = isRecord(parsed) ? parsed : null;
    			if (!response.ok || body === null || body.ok !== true) {
    				const failure = new Error(typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    				failure.code = body?.code;
    				throw failure;
    			}
    			return body;
    		}).then((body) => {
    			if (controller?.signal.aborted) return;
    			const attachment = body.attachment;
    			if (!isRecord(attachment)) {
    				setAttachmentPreview({
    					status: "failed",
    					data: null,
    					error: t("attachmentPreviewFailed")
    				});
    				return;
    			}
    			setAttachmentPreview({
    				status: "ready",
    				data: attachment,
    				error: null
    			});
    		}).catch((failure) => {
    			if (controller?.signal.aborted) return;
    			setAttachmentPreview({
    				status: "failed",
    				data: null,
    				error: `${t("attachmentPreviewFailed")} ${messageOf(failure)}`
    			});
    		}).finally(() => {
    			if (attachmentAbort === controller) attachmentAbort = null;
    		});
    	}
    	react.default.useEffect(() => {
    		if (attachmentView === null) return void 0;
    		fetchAttachmentPreview(attachmentView);
    		return () => {
    			abortAttachmentPreview();
    		};
    	}, [attachmentView]);
    	react.default.useEffect(() => {
    		if (attachmentView === null) return;
    		if (view === "runs" && selectedId !== null && selectedId === attachmentView.runId) return;
    		closeAttachment();
    	}, [
    		selectedId,
    		view,
    		attachmentView
    	]);
    	return {
    		openAttachment,
    		closeAttachment,
    		fetchAttachmentPreview
    	};
    }
    // .build/workflows/client/state/use-page-state.js
    /**
    * 页面全部 useState 的声明。
    *
    * 集中在一处，保证 useState 的调用顺序与页面演进历史一致（既有的渲染冒烟测试
    * 按这个顺序注入状态）；effects / actions 由其它模块接收这份状态。
    */
    /**
    * 声明页面的全部 useState。
    *
    * @returns 页面状态
    */
    function usePageState() {
    	/** 列表状态。 */
    	const [list, setList] = react.default.useState({
    		status: "loading",
    		runs: [],
    		archivedCount: 0,
    		error: null
    	});
    	/** 当前查看的 runId；null 表示列表视图。 */
    	const [selectedId, setSelectedId] = react.default.useState(null);
    	/** 详情状态。 */
    	const [detail, setDetail] = react.default.useState({
    		status: "idle",
    		data: null,
    		error: null
    	});
    	/** 手动刷新与定时刷新都递增它。 */
    	const [tick, setTick] = react.default.useState(0);
    	/** Toast 文案。 */
    	const [notice, setNotice] = react.default.useState(null);
    	/** 节点图里打开抽屉的节点 id；null 表示节点抽屉关闭。 */
    	const [selectedNodeId, setSelectedNodeId] = react.default.useState(null);
    	/** 详情里选中的第几次执行；null 表示默认看最近一次。 */
    	const [executionIndex, setExecutionIndex] = react.default.useState(null);
    	/**
    	* 鼠标悬停的边名字：`{ key, kind, text, x, y }`。悬停只显示名字；点击边
    	* 打开连线配置抽屉。
    	*/
    	const [edgeTip, setEdgeTip] = react.default.useState(null);
    	/** 列表是否只看已归档的运行。 */
    	const [showArchived, setShowArchived] = react.default.useState(false);
    	/** 自动归档设置对话框是否打开。 */
    	const [settingsOpen, setSettingsOpen] = react.default.useState(false);
    	/** 设置草稿；小时存字符串，输入框直接绑它。null 表示还没读到设置。 */
    	const [settingsDraft, setSettingsDraft] = react.default.useState(null);
    	/** 正在读取设置。 */
    	const [settingsLoading, setSettingsLoading] = react.default.useState(false);
    	/** 正在保存设置。 */
    	const [settingsSaving, setSettingsSaving] = react.default.useState(false);
    	/** 设置相关的错误文案。 */
    	const [settingsError, setSettingsError] = react.default.useState(null);
    	/** 页面顶部的页签：运行 / 模板。 */
    	const [view, setView] = react.default.useState("runs");
    	/** 模板目录状态。 */
    	const [templates, setTemplates] = react.default.useState({
    		status: "loading",
    		items: [],
    		error: null
    	});
    	/** 模板页里选中的模板 id；null 表示模板列表。 */
    	const [selectedTemplateId, setSelectedTemplateId] = react.default.useState(null);
    	/** 模板详情里打开抽屉的节点 id；null 表示节点抽屉关闭。 */
    	const [selectedTemplateNodeId, setSelectedTemplateNodeId] = react.default.useState(null);
    	/**
    	* 右侧附件预览抽屉正在看的附件：
    	* `{ runId, seq, nodeId, name, bytes, description }`；null 表示抽屉关闭。
    	* 放在所有既有 hook 之后追加，避免打乱测试与既有状态的顺序。
    	*/
    	const [attachmentView, setAttachmentView] = react.default.useState(null);
    	/** 抽屉里的预览请求状态；`data` 是 Host 返回的 attachment 对象。 */
    	const [attachmentPreview, setAttachmentPreview] = react.default.useState({
    		status: "idle",
    		data: null,
    		error: null
    	});
    	/**
    	* 连线配置抽屉里选中的边 key；null 表示连线抽屉关闭。与节点抽屉互斥。
    	* 仍放在所有既有 hook 之后追加，避免打乱测试与既有状态的顺序。
    	*/
    	const [selectedEdgeKey, setSelectedEdgeKey] = react.default.useState(null);
    	return {
    		list,
    		setList,
    		selectedId,
    		setSelectedId,
    		detail,
    		setDetail,
    		tick,
    		setTick,
    		notice,
    		setNotice,
    		selectedNodeId,
    		setSelectedNodeId,
    		executionIndex,
    		setExecutionIndex,
    		edgeTip,
    		setEdgeTip,
    		showArchived,
    		setShowArchived,
    		settingsOpen,
    		setSettingsOpen,
    		settingsDraft,
    		setSettingsDraft,
    		settingsLoading,
    		setSettingsLoading,
    		settingsSaving,
    		setSettingsSaving,
    		settingsError,
    		setSettingsError,
    		view,
    		setView,
    		templates,
    		setTemplates,
    		selectedTemplateId,
    		setSelectedTemplateId,
    		selectedTemplateNodeId,
    		setSelectedTemplateNodeId,
    		attachmentView,
    		setAttachmentView,
    		attachmentPreview,
    		setAttachmentPreview,
    		selectedEdgeKey,
    		setSelectedEdgeKey
    	};
    }
    // .build/workflows/client/state/use-runs.js
    /**
    * 运行列表 / 详情 / 模板目录的加载与定时刷新。
    */
    /**
    * 运行列表、选中运行详情与模板目录的加载 / 定时刷新。
    *
    * @param state 页面状态
    */
    function useRunsEffects(state) {
    	const { tick, setTick, showArchived, selectedId, list, detail, setList, setDetail, setTemplates } = state;
    	react.default.useEffect(() => {
    		let cancelled = false;
    		setList((previous) => ({
    			...previous,
    			status: previous.runs.length > 0 ? previous.status : "loading"
    		}));
    		requestJson(RUNS_ROUTE + (showArchived ? "?archived=1" : "")).then((body) => {
    			if (cancelled) return;
    			setList({
    				status: "ready",
    				runs: Array.isArray(body.runs) ? body.runs : [],
    				archivedCount: typeof body.archivedCount === "number" ? body.archivedCount : 0,
    				error: null
    			});
    		}, (failure) => {
    			if (cancelled) return;
    			setList((previous) => ({
    				...previous,
    				status: "ready",
    				error: messageOf(failure)
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [tick, showArchived]);
    	react.default.useEffect(() => {
    		if (selectedId === null) {
    			setDetail({
    				status: "idle",
    				data: null,
    				error: null
    			});
    			return;
    		}
    		let cancelled = false;
    		setDetail((previous) => ({
    			status: previous.data === null ? "loading" : previous.status,
    			data: previous.data,
    			error: null
    		}));
    		requestJson(`${RUN_ROUTE}?runId=${encodeURIComponent(selectedId)}`).then((body) => {
    			if (cancelled) return;
    			setDetail({
    				status: "ready",
    				data: asRunDetail(body),
    				error: null
    			});
    		}, (failure) => {
    			if (cancelled) return;
    			setDetail((previous) => ({
    				...previous,
    				status: "ready",
    				error: messageOf(failure)
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [selectedId, tick]);
    	react.default.useEffect(() => {
    		let cancelled = false;
    		requestJson(TEMPLATES_ROUTE).then((body) => {
    			if (cancelled) return;
    			setTemplates({
    				status: "ready",
    				items: Array.isArray(body.templates) ? body.templates : [],
    				error: null
    			});
    		}, (failure) => {
    			if (cancelled) return;
    			setTemplates({
    				status: "ready",
    				items: [],
    				error: messageOf(failure)
    			});
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, []);
    	const live = Array.isArray(list.runs) && list.runs.some((run) => run?.status === "running" || run?.status === "waiting") || detail.data?.run?.status === "running" || detail.data?.run?.status === "waiting";
    	react.default.useEffect(() => {
    		const timer = setInterval(() => setTick((value) => value + 1), live ? LIVE_REFRESH_MS : REFRESH_MS);
    		return () => clearInterval(timer);
    	}, [live]);
    }
    /**
    * 运行列表的刷新动作。
    *
    * @param state 页面状态
    * @returns 刷新动作
    */
    function createRunsActions(state) {
    	return { reload() {
    		state.setTick((value) => value + 1);
    	} };
    }
    // .build/workflows/client/state/use-sessions.js
    /**
    * 节点会话入口：打开 DSH 会话，必要时先刷新客户端会话列表。
    */
    /**
    * 节点会话的打开入口。
    *
    * @param deps DSH Client Service 取值器、词典与 Toast
    * @returns 会话动作
    */
    function createSessionActions({ getService, t, flash }) {
    	/**
    	* 取一个 DSH Client Service；不存在时返回 null。
    	*
    	* @param serviceName
    	* @returns
    	*/
    	function service(serviceName) {
    		try {
    			const found = getService(serviceName);
    			return isRecord(found) ? found : null;
    		} catch {
    			return null;
    		}
    	}
    	/**
    	* 客户端会话列表里还没有这个会话时，先做一次全量刷新。
    	*
    	* 宿主释放机器人 agent 后会给客户端发 `api-session/removed`，旧版本留下的
    	* 记录、或补通告失败时，这个节点会话可能已经不在客户端列表里；此时
    	* `uiWorkspace.openSession()` 会抛 `sessions.retain: unknown session`。
    	* 这里补一次 `sessions.refresh()`，把宿主仍然持久化的会话重新拉回来。
    	*
    	* @param sessionId
    	* @returns
    	*/
    	async function refreshSessionsIfUnknown(sessionId) {
    		const sessions = service("sessions");
    		if (sessions === null || typeof sessions.refresh !== "function") return;
    		let known = false;
    		try {
    			const list = sessions.list;
    			const getSnapshot = isRecord(list) ? list.getSnapshot : void 0;
    			const state = typeof getSnapshot === "function" ? getSnapshot() : null;
    			const byId = isRecord(state) && isRecord(state.byId) ? state.byId : null;
    			known = byId !== null && byId[sessionId] !== void 0;
    		} catch {
    			known = false;
    		}
    		if (known) return;
    		try {
    			await sessions.refresh();
    		} catch (failure) {
    			console.warn("buka-workflows: refreshing the session list failed:", failure);
    		}
    	}
    	/**
    	* 打开某个节点会话。
    	*
    	* @param step
    	* @returns
    	*/
    	async function openSession(step) {
    		const sessionId = typeof step?.sessionId === "string" ? step.sessionId : "";
    		if (sessionId === "") return;
    		const uiWorkspace = service("uiWorkspace");
    		if (uiWorkspace === null || typeof uiWorkspace.openSession !== "function") {
    			flash("error", t("noUiWorkspace"));
    			return;
    		}
    		try {
    			await refreshSessionsIfUnknown(sessionId);
    			uiWorkspace.openSession(sessionId);
    		} catch (failure) {
    			flash("error", `${t("openSessionFailed")} ${messageOf(failure)}`);
    		}
    	}
    	return { openSession };
    }
    // .build/workflows/client/state/use-settings.js
    /**
    * 自动归档设置对话框的动作：校验、读取与保存。
    */
    /**
    * 自动归档设置对话框的读写动作。
    *
    * @param state 页面状态
    * @param deps 词典、Toast 与列表刷新
    * @returns 设置对话框动作
    */
    function createSettingsActions(state, { t, flash, reload }) {
    	const { settingsSaving, setSettingsOpen, setSettingsError, setSettingsDraft, setSettingsLoading, settingsDraft, setSettingsSaving } = state;
    	/**
    	* 校验设置草稿里的两个小时数：必须是整数、落在范围内，且删除晚于归档。
    	*
    	* @param draft
    	* @returns 错误文案；null 表示通过
    	*/
    	function settingsValidationError(draft) {
    		const archiveText = String(draft.archiveHours ?? "").trim();
    		const deleteText = String(draft.deleteHours ?? "").trim();
    		if (!/^\d+$/u.test(archiveText)) return t("archiveInvalid");
    		const archiveHours = Number(archiveText);
    		if (archiveHours < 1 || archiveHours > 720) return t("archiveInvalid");
    		if (!/^\d+$/u.test(deleteText)) return t("deleteInvalid");
    		const deleteHours = Number(deleteText);
    		if (deleteHours < 2 || deleteHours > 8760) return t("deleteInvalid");
    		if (deleteHours <= archiveHours) return t("deleteBeforeArchive");
    		return null;
    	}
    	/**
    	* 打开自动归档设置对话框：先清空草稿，再读 Host 的当前设置。读失败时留在
    	* 对话框里说明原因；读取期间显示 loading。
    	*/
    	async function openSettingsDialog() {
    		setSettingsOpen(true);
    		setSettingsError(null);
    		setSettingsDraft(null);
    		setSettingsLoading(true);
    		try {
    			const body = await requestJson(SETTINGS_ROUTE);
    			const settings = isRecord(body.settings) ? body.settings : {};
    			setSettingsDraft({
    				enabled: settings.enabled === true,
    				archiveHours: String(settings.archiveAfterHours ?? 24),
    				deleteHours: String(settings.deleteAfterHours ?? 168)
    			});
    		} catch (failure) {
    			setSettingsError(`${t("settingsLoadFailed")} ${messageOf(failure)}`);
    		} finally {
    			setSettingsLoading(false);
    		}
    	}
    	/** 关闭设置对话框；保存中不响应关闭。 */
    	function closeSettingsDialog() {
    		if (settingsSaving) return;
    		setSettingsOpen(false);
    		setSettingsError(null);
    		setSettingsDraft(null);
    	}
    	/**
    	* 保存自动归档设置：校验通过后写回 Host，成功后关闭对话框并刷新列表（归档
    	* 结果可能刚刚变化）。
    	*/
    	async function saveSettings() {
    		const draft = settingsDraft;
    		if (draft === null || settingsValidationError(draft) !== null) return;
    		setSettingsSaving(true);
    		setSettingsError(null);
    		try {
    			const response = await fetch(SETTINGS_ROUTE, {
    				method: "POST",
    				headers: {
    					"content-type": "application/json",
    					accept: "application/json"
    				},
    				body: JSON.stringify({
    					enabled: draft.enabled,
    					archiveAfterHours: Number(draft.archiveHours),
    					deleteAfterHours: Number(draft.deleteHours)
    				})
    			});
    			const parsed = await response.json().catch(() => null);
    			const body = isRecord(parsed) ? parsed : null;
    			if (!response.ok || body === null || body.ok !== true) {
    				const error = new Error(typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    				error.code = body?.code;
    				throw error;
    			}
    			setSettingsOpen(false);
    			setSettingsDraft(null);
    			flash("success", t("saved"));
    			reload();
    		} catch (failure) {
    			setSettingsError(`${t("settingsSaveFailed")} ${messageOf(failure)}`);
    		} finally {
    			setSettingsSaving(false);
    		}
    	}
    	return {
    		settingsValidationError,
    		openSettingsDialog,
    		closeSettingsDialog,
    		saveSettings
    	};
    }
    // .build/workflows/client/state/use-ui.js
    /**
    * 页面交互 effect 与动作：Toast、页签切换与执行聚焦。
    */
    /**
    * 页面交互 effect：换运行收起抽屉、滚动 / 尺寸变化收起悬浮边名字。
    *
    * @param state 页面状态
    */
    function useUiEffects(state) {
    	const { selectedId, edgeTip, setSelectedNodeId, setExecutionIndex, setEdgeTip, setSelectedEdgeKey } = state;
    	react.default.useEffect(() => {
    		setSelectedNodeId(null);
    		setExecutionIndex(null);
    		setEdgeTip(null);
    		setSelectedEdgeKey(null);
    	}, [selectedId]);
    	const hasEdgeTip = edgeTip !== null;
    	react.default.useEffect(() => {
    		if (!hasEdgeTip) return void 0;
    		const hide = () => setEdgeTip(null);
    		window.addEventListener("scroll", hide, true);
    		window.addEventListener("resize", hide);
    		return () => {
    			window.removeEventListener("scroll", hide, true);
    			window.removeEventListener("resize", hide);
    		};
    	}, [hasEdgeTip]);
    }
    /**
    * 页面交互动作。
    *
    * @param state 页面状态
    * @returns 交互动作
    */
    function createUiActions(state) {
    	const { setNotice, setSelectedNodeId, setExecutionIndex, detail, view, setView, setSelectedTemplateId, setSelectedTemplateNodeId, setSelectedEdgeKey, setSelectedId } = state;
    	/**
    	* 用 Toast 显示一次操作结果。
    	*
    	* @param kind
    	* @param text
    	*/
    	function flash(kind, text) {
    		setNotice({
    			kind,
    			text,
    			seq: Date.now() + Math.random()
    		});
    	}
    	/** 切换运行 / 模板页签；从详情页切回列表时也清掉选中项。 */
    	const switchView = (next) => {
    		if (next === view) return;
    		setNotice(null);
    		setSelectedTemplateNodeId(null);
    		setSelectedEdgeKey(null);
    		if (next === "templates") setSelectedTemplateId(null);
    		else setSelectedId(null);
    		setView(next);
    	};
    	/**
    	* 聚焦到一次执行（或一个没有执行记录的节点）：选中目标节点，并打开它的
    	* 那一次执行；终止节点没有执行记录，就只切换节点。
    	*
    	* @param nodeId
    	* @param [seq] 目标执行的 seq
    	*/
    	function focusExecution(nodeId, seq = null) {
    		const list = stepsOf(detail.data?.run).filter((other) => other.nodeId === nodeId);
    		const index = seq === null ? -1 : list.findIndex((other) => other?.seq === seq);
    		setSelectedNodeId(nodeId);
    		setExecutionIndex(index < 0 ? null : index);
    	}
    	return {
    		switchView,
    		focusExecution,
    		flash
    	};
    }
    // .build/workflows/client/page.js
    /**
    * 侧边栏「工作流」页面：装配状态 hooks 与渲染函数，页面本身只做组装。
    */
    /**
    * 侧边栏「工作流」页面。
    *
    * @param props
    * @returns React 元素
    */
    function WorkflowsPage(props) {
    	const t = props.t;
    	const getService = typeof props.getService === "function" ? props.getService : () => null;
    	const state = usePageState();
    	useRunsEffects(state);
    	useUiEffects(state);
    	const attachments = useAttachmentsEffects(state, t);
    	const runs = createRunsActions(state);
    	const ui = createUiActions(state);
    	const settings = createSettingsActions(state, {
    		t,
    		flash: ui.flash,
    		reload: runs.reload
    	});
    	const sessions = createSessionActions({
    		getService,
    		t,
    		flash: ui.flash
    	});
    	const model = {};
    	Object.assign(model, state, runs, ui, settings, sessions, attachments, {
    		t,
    		getService,
    		capsuleText: (node) => capsuleText(t, node),
    		templateNodeLabel: (node) => templateNodeLabel(t, node),
    		renderLegend: (options) => renderLegend(model, options),
    		renderGraph: (graph, activeNodeId, onNodeSelect, options) => renderGraph(model, graph, activeNodeId, onNodeSelect, options),
    		renderExecution: renderExecution.bind(null, model),
    		renderNodePanel: renderNodePanel.bind(null, model),
    		renderList: () => renderList(model),
    		renderUserNotice: (run) => renderUserNotice(model, run),
    		renderInteractionNotice: (run) => renderInteractionNotice(model, run),
    		runDetailModel: () => runDetailModel(model),
    		renderDetail: () => renderDetail(model),
    		renderTemplatesList: () => renderTemplatesList(model),
    		renderTemplateNodePanel: renderTemplateNodePanel.bind(null, model),
    		templateDetailModel: () => templateDetailModel(model),
    		renderTemplateDetail: () => renderTemplateDetail(model),
    		renderFooter: (withStates) => renderFooter(model, withStates),
    		renderSettingsDialog: () => renderSettingsDialog(model),
    		interceptAttachmentLink: interceptAttachmentLink.bind(null, model),
    		attachmentPreviewLabels: () => attachmentPreviewLabels(model),
    		renderAttachmentDownload: (viewer) => renderAttachmentDownload(model, viewer),
    		renderAttachmentPreviewBody: (viewer) => renderAttachmentPreviewBody(model, viewer),
    		renderDrawerHead: renderDrawerHead.bind(null, model),
    		renderAttachmentDrawer: () => renderAttachmentDrawer(model),
    		closeRunNodeDrawer: () => closeRunNodeDrawer(model),
    		closeTemplateNodeDrawer: () => closeTemplateNodeDrawer(model),
    		renderRunNodeDrawer: () => renderRunNodeDrawer(model),
    		renderTemplateNodeDrawer: () => renderTemplateNodeDrawer(model),
    		edgeRulesFor: edgeRulesFor.bind(null, model),
    		renderEdgeRule: renderEdgeRule.bind(null, model),
    		renderEdgeDrawer: () => renderEdgeDrawer(model)
    	});
    	return renderPage(model);
    }
    // .build/workflows/client/styles.js
    /**
    * 页面样式：沿用 Robots / Skills 页的标题行 + 960px 内容区 + 卡片结构。
    */
    /** 页面样式：沿用 Robots / Skills 页的标题行 + 960px 内容区 + 卡片结构。 */
    const CSS = `
    .buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
    @media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
    .buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));max-width:none;margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
    .buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
    .buka-workflows-titleRow{display:flex;flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:16px;min-width:0}
    .buka-workflows-toolbar{flex:none;display:flex;align-items:center;gap:8px}
    .buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:32px 0 24px}
    .buka-workflows-pageBody{display:flex;flex-direction:column;gap:20px}
    .buka-workflows-detail{display:flex;flex-direction:column;gap:28px}
    .buka-workflows-status,.buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
    .buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
    .buka-workflows-emptyBox{display:flex;flex-direction:column;gap:10px;padding:8px 0}
    .buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-warn{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
    .buka-workflows-listPane{display:flex;flex-direction:column;gap:16px}
    .buka-workflows-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-xl);padding:12px 8px;margin:0 -8px;font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    .buka-workflows-cardTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
    .buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:6px;min-width:0}
    .buka-workflows-cardTags{display:flex;align-items:center;gap:6px;flex:none}
    .buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px 5px}
    .buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
    .buka-workflows-steps{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
    .buka-workflows-step{display:flex;flex-direction:column;gap:8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:12px}
    .buka-workflows-stepHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
    .buka-workflows-node{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-stepMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-left:auto;overflow-wrap:anywhere}
    .buka-workflows-stepActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;overflow-wrap:anywhere;word-break:break-all}
    .buka-workflows-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;width:100%;box-sizing:border-box}
    .buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:28px;padding:0 10px;font-size:12px;line-height:18px}
    .buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
    .buka-workflows-back svg{transform:rotate(180deg)}
    .buka-workflows-graphPane{flex:none;min-width:0;width:max-content;max-width:none;margin-inline:auto}
    .buka-workflows-vgraph{position:relative;flex:none}
    .buka-workflows-vgraphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
    .buka-workflows-vgraphNode{position:absolute;z-index:2;display:flex;align-items:center}
    .buka-workflows-capsule{flex:1 1 auto;display:inline-flex;align-items:center;width:100%;height:100%;box-sizing:border-box;margin:0;padding:3px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;overflow:hidden;white-space:nowrap}
    .buka-workflows-capsuleText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
    .buka-workflows-vgraphNode .buka-workflows-visitBadge{position:absolute;right:-6px;top:50%;transform:translateY(-50%);margin-left:0;padding-left:4px;background:var(--dsw-alias-bg-base)}
    .buka-workflows-vgraphNode .buka-workflows-capsule.is-selected{outline-offset:1px}
    .buka-workflows-capsule.is-robot{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
    .buka-workflows-capsule.has-avatar{padding-left:4px}
    .buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
    .buka-workflows-capsuleAvatar{margin-right:6px}
    .buka-workflows-inspectorAvatar{margin-right:2px}
    .buka-workflows-capsule.is-user{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-capsule.is-end{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
    .buka-workflows-capsule.is-join{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
    .buka-workflows-capsule.is-start{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-capsule.is-idle{border-color:var(--dsw-alias-border-l2);border-style:dashed;color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-capsule.is-running{animation:buka-workflows-pulse 1.8s ease-out infinite}
    .buka-workflows-visitBadge{flex:none;margin-left:6px;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
    @media (hover:hover){.buka-workflows-capsule:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-capsule:focus-visible,.buka-workflows-capsule.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    @keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-capsule.is-running{animation:none}}
    .buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.25;stroke-dasharray:4 4;stroke-linecap:round;opacity:.6;transition:stroke-width .16s ease,opacity .16s ease,stroke .16s ease}
    .buka-workflows-edge.is-static{stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5;stroke-dasharray:none;opacity:.85}
    .buka-workflows-edge.is-traversed{stroke:var(--dsw-alias-brand-primary);stroke-width:1.75;stroke-dasharray:none;opacity:1}
    .buka-workflows-edge.is-selected{stroke:var(--dsw-alias-brand-primary);stroke-width:2.5;stroke-dasharray:none;opacity:1}
    .buka-workflows-edge.is-hovered{stroke-width:2.5;opacity:1;stroke-dasharray:none}
    .buka-workflows-edge.is-next.is-hovered{stroke:var(--dsw-alias-brand-primary)}
    .buka-workflows-edge.is-success{stroke:var(--dsw-alias-state-success-primary)}
    .buka-workflows-edge.is-failure{stroke:var(--dsw-alias-state-error-primary)}
    .buka-workflows-edge.is-success.is-hovered{stroke:var(--dsw-alias-state-success-primary)}
    .buka-workflows-edge.is-failure.is-hovered{stroke:var(--dsw-alias-state-error-primary)}
    .buka-workflows-edge.is-dimmed:not(.is-hovered){opacity:.5}
    .buka-workflows-edgeHit{fill:none;stroke:transparent;stroke-width:14;stroke-linecap:round;pointer-events:stroke;cursor:pointer}
    .buka-workflows-edgeHit:focus-visible{stroke:var(--dsw-alias-brand-primary);stroke-width:4;opacity:.25;outline:none}
    .buka-workflows-edgeTip{position:fixed;z-index:1000;max-width:240px;box-sizing:border-box;padding:4px 9px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:16px;font-weight:500;box-shadow:0 4px 12px rgba(17,20,28,.12);pointer-events:none;overflow-wrap:anywhere}
    .buka-workflows-edgeTip.is-anchored{transform:translateY(-50%)}
    .buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.7;transition:opacity .16s ease,fill .16s ease}
    .buka-workflows-edgeArrow.is-static{fill:var(--dsw-alias-label-tertiary);opacity:.85}
    .buka-workflows-edgeArrow.is-traversed{fill:var(--dsw-alias-brand-primary);opacity:1}
    .buka-workflows-edgeArrow.is-selected{fill:var(--dsw-alias-brand-primary);opacity:1}
    .buka-workflows-edgeArrow.is-hovered{opacity:1}
    .buka-workflows-edgeArrow.is-next.is-hovered{fill:var(--dsw-alias-brand-primary)}
    .buka-workflows-edgeArrow.is-success{fill:var(--dsw-alias-state-success-primary)}
    .buka-workflows-edgeArrow.is-failure{fill:var(--dsw-alias-state-error-primary)}
    .buka-workflows-edgeArrow.is-success.is-hovered{fill:var(--dsw-alias-state-success-primary)}
    .buka-workflows-edgeArrow.is-failure.is-hovered{fill:var(--dsw-alias-state-error-primary)}
    .buka-workflows-edgeArrow.is-dimmed:not(.is-hovered){opacity:.5}
    .buka-workflows-vgraphDot{stroke:var(--dsw-alias-bg-layer-1);stroke-width:1.5;fill:var(--dsw-alias-state-idle-primary)}
    .buka-workflows-vgraphDot.is-running{fill:var(--dsw-alias-brand-primary)}
    .buka-workflows-vgraphDot.is-waiting{fill:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-vgraphDot.is-done{fill:var(--dsw-alias-state-success-primary)}
    .buka-workflows-vgraphDot.is-failed{fill:var(--dsw-alias-state-error-primary)}
    .buka-workflows-footer{box-sizing:border-box;width:100%;max-width:960px;margin-inline:auto;flex:none;display:flex;flex-direction:column;gap:10px;padding:14px 0 24px;border-top:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
    .buka-workflows-footer .buka-workflows-hint{margin:0}
    .buka-workflows-legend{display:flex;flex-wrap:wrap;gap:10px 24px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
    .buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
    .buka-workflows-legendTitle{color:var(--dsw-alias-label-secondary);font-weight:500}
    .buka-workflows-legendItem{display:inline-flex;align-items:center;gap:5px}
    .buka-workflows-legendCapsule{box-sizing:border-box;width:26px;height:11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}
    .buka-workflows-legendCapsule.is-robot{border-color:var(--dsw-alias-brand-primary)}
    .buka-workflows-legendCapsule.is-user{border-color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-legendCapsule.is-end{border-color:var(--dsw-alias-state-success-primary)}
    .buka-workflows-legendCapsule.is-join{border-color:var(--dsw-alias-state-business-primary)}
    .buka-workflows-legendCapsule.is-start{border-color:var(--dsw-alias-border-l2)}
    .buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
    .buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
    .buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption);border-top-style:dashed}
    .buka-workflows-legendLine.is-static{border-top-color:var(--dsw-alias-label-tertiary);border-top-style:solid}
    .buka-workflows-legendLine.is-traversed{border-top-color:var(--dsw-alias-brand-primary);border-top-style:solid}
    .buka-workflows-inspector{display:flex;flex-direction:column;gap:14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:14px 16px}
    .buka-workflows-inspectorHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
    .buka-workflows-inspectorTitle{flex:1 1 auto;min-width:0;font-size:15px;font-weight:500;line-height:22px;overflow-wrap:anywhere}
    .buka-workflows-inspectorId{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-markdown-code-block);border-radius:var(--dsw-radius-sm);padding:1px 5px;overflow-wrap:anywhere}
    .buka-workflows-inspectorClose{margin-left:auto}
    .buka-workflows-inspectorSection{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-nodeDrawer .buka-workflows-inspector{border:0;background:0 0;padding:0}
    .buka-workflows-edgeRules{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-edgeRule{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
    .buka-workflows-edgeRuleHead{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
    .buka-workflows-edgeRuleDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-edgeRule .buka-workflows-pre{max-height:200px;margin-top:6px}
    .buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
    .buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:18px;text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
    @media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
    .buka-workflows-attachmentLink:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    .buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
    .buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1;min-width:120px}
    .buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11px;flex:none}
    .buka-workflows-attachmentDownload:hover{text-decoration:underline}
    .buka-workflows-executions{display:flex;flex-direction:column;gap:12px}
    .buka-workflows-tabs{display:flex;flex-wrap:wrap;gap:6px}
    .buka-workflows-tab{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:2px 10px;cursor:pointer}
    @media (hover:hover){.buka-workflows-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-tab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-tab.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base)}
    .buka-workflows-tabDot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
    .buka-workflows-tabDot.is-done{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-tabDot.is-failed{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-tabDot.is-running{background:var(--dsw-alias-brand-primary)}
    .buka-workflows-tabDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-tabPanel{display:flex;flex-direction:column;gap:12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:12px}
    .buka-workflows-tabMeta{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .buka-workflows-kv{display:flex;flex-direction:column;gap:4px}
    .buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;line-height:18px}
    .buka-workflows-sessionBar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
    .buka-workflows-sessionBar .buka-workflows-inlineCode{font-size:12px}
    .buka-workflows-sessionList{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0}
    .buka-workflows-sessionRow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
    .buka-workflows-interactionNotice{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:100%;padding:12px 14px;border:0.5px solid var(--dsw-alias-state-warn-primary);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
    .buka-workflows-interactionHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
    .buka-workflows-interactionTitle{flex:1 1 auto;min-width:0;color:var(--dsw-alias-state-warn-primary);font-size:13px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-interactionBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
    .buka-workflows-interactionActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .buka-workflows-userNotice{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-userNoticeGroup{display:flex;flex-direction:column;gap:6px}
    .buka-workflows-userChoiceList,.buka-workflows-userQuestionList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-userChoice,.buka-workflows-userQuestion{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-userChoiceLabel,.buka-workflows-userQuestionHeader{color:var(--dsw-alias-label-primary);font-weight:500}
    .buka-workflows-userChoiceDesc{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .buka-workflows-userQuestionText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);min-width:72px}
    .buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
    .buka-workflows-executionNav{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-secondary);display:flex;justify-content:space-between;gap:16px}
    .buka-workflows-navSide{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
    .buka-workflows-navSide.is-next{align-items:flex-end;text-align:right}
    .buka-workflows-navSide .buka-workflows-hint{margin:0}
    .buka-workflows-prevLink,.buka-workflows-nextLink{display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary);cursor:pointer;border-radius:var(--dsw-radius-sm);max-width:100%}
    .buka-workflows-prevLink:hover,.buka-workflows-nextLink:hover{text-decoration:underline}
    .buka-workflows-prevLink:focus-visible,.buka-workflows-nextLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    .buka-workflows-prevArrow,.buka-workflows-nextArrow{color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-prevTitle,.buka-workflows-nextTitle{font-size:12px;font-weight:500}
    .buka-workflows-prevVisit,.buka-workflows-nextVisit{color:var(--dsw-alias-label-secondary)}
    .buka-workflows-dialogForm{display:flex;flex-direction:column;gap:16px}
    .buka-workflows-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:2px 0}
    .buka-workflows-settingText{display:flex;flex-direction:column;gap:4px;min-width:0}
    .buka-workflows-settingHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .buka-workflows-settingTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}
    .buka-workflows-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
    .buka-workflows-switch.is-on{background:var(--dsw-alias-brand-primary)}
    .buka-workflows-switch:disabled{cursor:default;opacity:.6}
    .buka-workflows-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .buka-workflows-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
    .buka-workflows-switch.is-on .buka-workflows-switchThumb{transform:translateX(16px)}
    @media (prefers-reduced-motion:reduce){.buka-workflows-switch,.buka-workflows-switchThumb{transition:none}}
    .buka-workflows-hoursField{display:flex;flex-direction:column;gap:6px}
    .buka-workflows-hoursControl{display:flex;align-items:center;gap:8px}
    .buka-workflows-hoursInput{width:88px}
    .buka-workflows-hoursUnit{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
    .buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
    .buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-tabbar{flex:1 1 auto;min-width:0}
    .buka-workflows-tabList{width:fit-content;min-width:240px}
    @media (width<=372px){.buka-workflows-tabList{min-width:0}}
    .buka-workflows-templateList{display:flex;flex-direction:column;gap:16px}
    .buka-workflows-templateCard{display:flex;flex-direction:column;gap:8px;width:100%;box-sizing:border-box;text-align:left;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-md);padding:14px 16px;font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-templateCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-templateCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-templateHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
    .buka-workflows-templateTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
    .buka-workflows-templateChevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-templateDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-templateDetail{display:flex;flex-direction:column;gap:20px}
    .buka-workflows-flow{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
    .buka-workflows-flowStep{display:flex;flex-direction:column;gap:6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:10px 12px}
    .buka-workflows-flowHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
    .buka-workflows-flowIndex{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-flowSummary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-flowTransitions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
    .buka-workflows-templateBackButton{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;background:0 0;color:var(--dsw-alias-label-caption);cursor:pointer;border-radius:var(--dsw-radius-sm);padding:0;margin-left:-4px}
    @media (hover:hover){.buka-workflows-templateBackButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-templateBackButton:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workflows-templateBackButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-workflows-detailBackButton{align-self:flex-start}
    .buka-workflows-templateTransitions{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-templateTransition{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
    .buka-workflows-templateTransitionHead{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
    .buka-workflows-templateTransitionBody{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(560px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
    @keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
    @media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
    .buka-workflows-drawerHead{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 18px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:8px;min-width:0}
    .buka-workflows-drawerTitle{flex:1 1 auto;min-width:0;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-drawerActions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
    .buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-drawerDownload:hover{text-decoration:underline}
    .buka-workflows-drawerDownload:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    .buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-left:auto;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
    @media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-drawerClose:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto;overscroll-behavior:contain;padding:16px 18px 24px}
    .buka-workflows-drawerStatus{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
    .buka-workflows-drawerMarkdown{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-drawerCode{margin:0}
    .buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    `;
    // .build/workflows/client/index.js
    /**
    * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的「工作流」页面。
    *
    * 这一半只做**只读观测**：workflow 由编排 preset（默认 `workflow-orchestrator`）
    * 的会话现场创建，没有可复用的流程列表，也没有“从这里启动流程”的入口。页面
    * 展示落盘的运行记录：
    *
    * - 列表：最近运行的状态、目标、runId、开始时间；
    * - 详情：分层二维节点图占据页面主体，并行的节点在同一排；点节点从右侧抽屉看
    *   节点详情（按「第几次执行」拆成 Tab），点连线从右侧抽屉看这条边的配置；
    * - 每个节点可以「打开会话」，复用 DSH 的 `uiWorkspace.openSession(sessionId)`；
    *   客户端会话列表里还没有这个会话时先补一次 `sessions.refresh()`。
    *
    * 运行记录由 Host 的 `/buka-workflows/runs` 与 `/buka-workflows/run` 两条只读
    * 路由提供，附件下载走 `/buka-workflows/attachment`；有运行在跑时每 1.5 秒刷新一次（否则 5 秒），后台运行也能看到进度。
    *
    *
    * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
    * 那层外壳由构建脚本 `scripts/build-clients.ts` 生成，源码里不写死包名。
    */
    const inject = ["slots", "locale"];
    /**
    * 注册侧边栏条目与主面板页面，并注入文案与样式。
    *
    * @param ctx 浏览器插件上下文
    */
    function apply(ctx) {
    	const t = ctx.locale.bind(NS);
    	/**
    	* 页面从插件上下文里取 DSH 的 Client Service；不存在时返回 null。
    	*
    	* @param serviceName
    	* @returns
    	*/
    	function getService(serviceName) {
    		try {
    			return ctx.get(serviceName) ?? null;
    		} catch {
    			return null;
    		}
    	}
    	ctx.effect(() => ctx.locale.register(NS, {
    		zh,
    		en
    	}), "buka-workflows: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-workflows";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-workflows: styles");
    	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    		name: "sidebar.panellist",
    		id: PANEL_ID,
    		order: 31,
    		label: () => t("panel"),
    		locale: NS
    	}, WorkflowsPanelIcon));
    	ctx.slots.inject("main", () => ctx.slots.register({
    		name: "main",
    		key: PANEL_ID,
    		locale: NS,
    		inject: () => ({ getService })
    	}, WorkflowsPage));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
