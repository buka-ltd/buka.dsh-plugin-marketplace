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
    * 浏览器一半的词典：工作流列表 / 详情 / 作业看板 / 任务抽屉 / 附件 / 时间线。
    *
    * 键固定为英文，值与 `locale` 的长期文案解耦；`t` 由 `locale.bind(NS)` 提供。
    */
    /** 把词典里的 `{name}` 占位符换成值。 */
    function fill(t, key, values) {
    	let text = t(key);
    	for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    	return text;
    }
    /** 英文文案。 */
    const en = {
    	panel: "Workflows",
    	title: "Workflows",
    	refresh: "Refresh",
    	loading: "Loading…",
    	loadFailed: "Request failed: ",
    	retry: "Retry",
    	back: "Back",
    	close: "Close",
    	cancel: "Cancel",
    	unknown: "Unknown",
    	notFound: "This item does not exist or was removed.",
    	definitionMissing: "The host did not return a definition snapshot.",
    	graphAria: "Workflow graph",
    	workflowDraft: "Draft",
    	workflowActive: "Active",
    	workflowRetired: "Retired",
    	statusDraft: "Draft",
    	statusActive: "Active",
    	statusRetired: "Retired",
    	statusRunning: "Running",
    	statusCompleted: "Completed",
    	statusFailed: "Failed",
    	statusCancelled: "Cancelled",
    	statusPending: "Queued",
    	statusReady: "Claimable",
    	statusBlocked: "Blocked",
    	actorRobot: "Robot",
    	actorHuman: "Human",
    	actorAssistant: "Assistant",
    	actorSession: "Session",
    	workflowsTitle: "Workflows",
    	workflowsHint: "A workflow is a durable definition. Each job is one run of it.",
    	workflowsEmpty: "No workflows yet.",
    	workflowsEmptyHint: "Save a workflow with buka_workflow_save from an orchestration preset session. Once it is active you can start jobs here.",
    	autoRefreshLive: "Auto-refreshing every 1.5s while the job is running.",
    	autoRefreshIdle: "Auto-refreshing every 5s.",
    	jobCount: "{n} jobs",
    	updatedAt: "Updated",
    	backToWorkflows: "Back to workflows",
    	newJob: "New job",
    	activate: "Activate",
    	deactivate: "Deactivate",
    	activateDone: "Workflow updated.",
    	activateFailed: "Could not update the workflow: ",
    	workflowVersion: "Version",
    	graphTitle: "Flow",
    	graphStart: "Start",
    	graphEnd: "End",
    	graphRobot: "Robot position",
    	graphHuman: "Human position",
    	graphIdle: "Not started",
    	graphEdgeForward: "Can dispatch",
    	graphEdgeBack: "Back edge",
    	graphLegendTypes: "Nodes",
    	graphLegendStates: "Task state",
    	graphLegendEdges: "Edges",
    	positionsTitle: "Positions",
    	positionsEmpty: "This workflow has no positions.",
    	positionExecutor: "Executor",
    	positionTypes: "Task types",
    	taskTypesTitle: "Task types",
    	taskTypePayload: "Input",
    	taskTypeOutput: "Output",
    	taskTypeRequires: "Requires",
    	taskTypeAssistant: "Assistant",
    	taskTypeMode: "Mode",
    	taskTypeModePlan: "Plan",
    	taskTypeUnset: "—",
    	schemaNoFields: "No fields.",
    	schemaFieldRequired: "required",
    	edgesTitle: "Edges",
    	edgesEmpty: "This workflow has no edges.",
    	edgeAllTypes: "All task types",
    	edgeBack: "Back edge",
    	startContractTitle: "Start task",
    	startContractHint: "The start task turns raw input into structured input. When a job starts from this page, both are filled in the form.",
    	endContractTitle: "End task",
    	endContractHint: "Delivers the final output to the starter. Delivery completes the task.",
    	budgetsTitle: "Budgets",
    	budgetMaxTasks: "Max tasks",
    	budgetMaxDuration: "Max duration",
    	budgetHours: "hours",
    	budgetUnset: "Not set",
    	workflowJobsTitle: "Jobs",
    	workflowJobsEmpty: "No jobs yet.",
    	workflowJobsEmptyHint: "Use \"New job\" to start one from this page.",
    	jobSeq: "Job #{seq}",
    	jobInput: "Input",
    	jobTaskCounts: "Tasks",
    	jobCreatedAt: "Created",
    	newJobTitle: "New job",
    	newJobHint: "Fill in the raw input and the structured input. Submitting completes the start task.",
    	newJobRawTitle: "Raw input",
    	newJobRawHint: "What you want to get done.",
    	newJobStructuredTitle: "Structured input",
    	newJobStructuredHint: "The start task output contract: this becomes the structured input.",
    	newJobSubmit: "Start job",
    	newJobSubmitting: "Starting…",
    	newJobStarted: "Job created.",
    	newJobFailed: "Could not start the job: ",
    	newJobRawFallback: "Request",
    	newJobStructuredFallback: "Structured input (JSON)",
    	newJobJsonInvalid: "Structured input is not valid JSON: ",
    	fieldRequired: "{name} is required.",
    	fieldJsonInvalid: "{name} is not valid JSON: ",
    	fieldInvalidBoolean: "{name} must be true or false.",
    	fieldInvalidNumber: "{name} must be a number.",
    	fallbackJsonTitle: "JSON",
    	fallbackJsonHint: "No schema was provided; enter this field as JSON.",
    	backToWorkflow: "Back to workflow",
    	jobTitle: "Job",
    	starter: "Starter",
    	starterHuman: "Person (page)",
    	starterSession: "Session",
    	openStarterSession: "Open starter session",
    	cancelJob: "Cancel job",
    	cancelJobConfirm: "Cancel this job? All unfinished tasks will be cancelled.",
    	retryDelivery: "Retry delivery",
    	deliveryRetryHint: "The end task is still waiting to be claimed because delivery did not succeed. Retry the delivery.",
    	deliveryRetryStarted: "Delivery retry requested.",
    	jobUpdatedAt: "Updated",
    	jobErrorTitle: "Error",
    	jobViewsAria: "Job views",
    	boardTab: "Board",
    	graphTab: "Flow",
    	tasksTab: "Tasks",
    	attachmentsTab: "Attachments",
    	timelineTab: "Timeline",
    	boardStart: "Start",
    	boardEnd: "End",
    	boardColumnPending: "Queued",
    	boardColumnReady: "Claimable",
    	boardColumnRunning: "In progress",
    	boardColumnCompleted: "Completed",
    	boardColumnError: "Problems",
    	boardNoTasks: "No tasks",
    	boardEmpty: "This job has no tasks yet.",
    	boardEmptyHint: "Tasks are created from the definition after the start task completes.",
    	boardHint: "Select a card to open the task details.",
    	boardCardDeps: "{n} deps",
    	boardCardAttempts: "Attempts {n}",
    	boardCardAttachments: "{n} files",
    	boardCardWaiting: "Waiting {duration}",
    	taskCount: "{n} tasks",
    	jobGraphHint: "Select a position node to open one of its tasks.",
    	tasksEmpty: "No tasks yet.",
    	tasksHint: "Select a row to open the task details.",
    	tasksTableType: "Type",
    	tasksTablePosition: "Position",
    	tasksTableStatus: "Status",
    	tasksTableClaimant: "Claimed by",
    	tasksTableCreated: "Created",
    	attachmentsTitle: "Attachments",
    	attachmentsEmpty: "This job has no attachments yet.",
    	attachmentsHint: "Attachments come from task output. Select a file name to preview it.",
    	attachmentSource: "Source",
    	attachmentBy: "Created by",
    	attachmentPreview: "Preview",
    	attachmentDownload: "Download",
    	attachmentPreviewLoading: "Loading preview…",
    	attachmentPreviewFailed: "Could not load the preview: ",
    	attachmentPreviewRetry: "Retry",
    	attachmentPreviewClose: "Close preview",
    	attachmentPreviewBinary: "This file cannot be previewed here. Download it instead.",
    	attachmentPreviewUnsupported: "This file type cannot be previewed.",
    	attachmentPreviewTruncated: "Only the beginning of the file is shown.",
    	attachmentPreviewEmpty: "The file is empty.",
    	attachmentPreviewImageFailed: "The image could not be displayed.",
    	attachmentPreviewPdfHint: "The PDF is embedded above; download it to keep a copy.",
    	timelineTitle: "Timeline",
    	timelineEmpty: "No events yet.",
    	timelineJobCreated: "Job created",
    	timelineJobUpdated: "Job updated",
    	timelineTaskCreated: "Task created",
    	timelineTaskStarted: "Task started",
    	timelineTaskFinished: "Task finished",
    	timelineTaskFailed: "Task failed",
    	timelineTaskCancelled: "Task cancelled",
    	taskDrawerTitle: "Task",
    	taskPosition: "Position",
    	taskType: "Type",
    	taskStatus: "Status",
    	taskId: "Task id",
    	taskClaimant: "Claimed by",
    	taskCreatedAt: "Created",
    	taskStartedAt: "Started",
    	taskFinishedAt: "Finished",
    	taskDepsTitle: "Dependencies",
    	taskDepsEmpty: "No dependencies.",
    	taskPayloadTitle: "Input (payload)",
    	taskPayloadEmpty: "No payload.",
    	taskAttemptsTitle: "Attempts",
    	taskAttemptsEmpty: "No attempts yet.",
    	taskAttemptSession: "Session",
    	taskAttemptStopReason: "Stop reason",
    	taskAttemptError: "Error",
    	taskResultTitle: "Result",
    	taskResultEmpty: "No result yet.",
    	taskResultText: "Text",
    	taskResultOutput: "Structured output",
    	taskResultAttachments: "Result files",
    	finalDeliverableTitle: "Final deliverable",
    	taskActionsTitle: "Actions",
    	taskActionsEmpty: "No actions are available.",
    	actionClaim: "Claim",
    	actionComplete: "Submit",
    	actionCancel: "Cancel task",
    	actionRetry: "Retry",
    	actionSubmitComplete: "Submit result",
    	actionSubmitting: "Submitting…",
    	actionTextLabel: "Note (optional)",
    	actionFormTitle: "Fill in the result",
    	actionFormHint: "Fill in the output contract declared by this task type.",
    	actionFormNoSchema: "This task type has no output schema; enter the result as JSON.",
    	actionJsonInvalid: "Result is not valid JSON: ",
    	actionCancelConfirm: "Cancel this task? Tasks depending on it become blocked.",
    	taskActionDone: "Done.",
    	taskActionFailed: "Action failed: ",
    	openSession: "Open session",
    	openSessionFailed: "Could not open the session: ",
    	noUiWorkspace: "This client has no uiWorkspace service, so sessions cannot be opened.",
    	sessionLabel: "Session",
    	payloadLabel: "Payload"
    };
    /** 简体中文文案。 */
    const zh = {
    	panel: "工作流",
    	title: "工作流",
    	refresh: "刷新",
    	loading: "正在读取…",
    	loadFailed: "请求失败：",
    	retry: "重试",
    	back: "返回",
    	close: "关闭",
    	cancel: "取消",
    	unknown: "未知",
    	notFound: "目标不存在或已被删除。",
    	definitionMissing: "Host 没有返回定义快照。",
    	graphAria: "工作流流程图",
    	workflowDraft: "草稿",
    	workflowActive: "已激活",
    	workflowRetired: "已停用",
    	statusDraft: "草稿",
    	statusActive: "已激活",
    	statusRetired: "已停用",
    	statusRunning: "进行中",
    	statusCompleted: "已完成",
    	statusFailed: "失败",
    	statusCancelled: "已取消",
    	statusPending: "排队",
    	statusReady: "待认领",
    	statusBlocked: "阻塞",
    	actorRobot: "机器人",
    	actorHuman: "人",
    	actorAssistant: "助理",
    	actorSession: "会话",
    	workflowsTitle: "工作流",
    	workflowsHint: "工作流是持久定义；作业是它的一次执行。",
    	workflowsEmpty: "还没有工作流。",
    	workflowsEmptyHint: "在编排 preset 的会话里用 buka_workflow_save 保存一个工作流；激活后就能从这里新建作业。",
    	autoRefreshLive: "作业运行中，每 1.5 秒自动刷新。",
    	autoRefreshIdle: "每 5 秒自动刷新。",
    	jobCount: "{n} 个作业",
    	updatedAt: "更新于",
    	backToWorkflows: "返回工作流列表",
    	newJob: "新建作业",
    	activate: "激活",
    	deactivate: "停用",
    	activateDone: "工作流状态已更新。",
    	activateFailed: "更新工作流失败：",
    	workflowVersion: "版本",
    	graphTitle: "流程图",
    	graphStart: "开始",
    	graphEnd: "结束",
    	graphRobot: "机器人岗位",
    	graphHuman: "人岗位",
    	graphIdle: "未开始",
    	graphEdgeForward: "可派发",
    	graphEdgeBack: "回边",
    	graphLegendTypes: "节点",
    	graphLegendStates: "任务状态",
    	graphLegendEdges: "连线",
    	positionsTitle: "岗位",
    	positionsEmpty: "这个工作流还没有岗位。",
    	positionExecutor: "执行者",
    	positionTypes: "任务类型",
    	taskTypesTitle: "任务类型",
    	taskTypePayload: "输入",
    	taskTypeOutput: "产出",
    	taskTypeRequires: "依赖类型",
    	taskTypeAssistant: "助理",
    	taskTypeMode: "模式",
    	taskTypeModePlan: "计划",
    	taskTypeUnset: "—",
    	schemaNoFields: "没有字段。",
    	schemaFieldRequired: "必填",
    	edgesTitle: "边",
    	edgesEmpty: "这个工作流还没有边。",
    	edgeAllTypes: "全部任务类型",
    	edgeBack: "回边",
    	startContractTitle: "开始任务",
    	startContractHint: "开始任务把原始输入转换成结构化输入；从本页启动作业时两者都在表单里填写。",
    	endContractTitle: "结束任务",
    	endContractHint: "把最终交付物投递给启动者；投递成功即完成。",
    	budgetsTitle: "预算",
    	budgetMaxTasks: "任务上限",
    	budgetMaxDuration: "最长时长",
    	budgetHours: "小时",
    	budgetUnset: "未设置",
    	workflowJobsTitle: "作业",
    	workflowJobsEmpty: "还没有作业。",
    	workflowJobsEmptyHint: "点「新建作业」从页面启动一次。",
    	jobSeq: "作业 #{seq}",
    	jobInput: "输入",
    	jobTaskCounts: "任务",
    	jobCreatedAt: "创建",
    	newJobTitle: "新建作业",
    	newJobHint: "填写原始输入与结构化输入；提交即完成启动任务。",
    	newJobRawTitle: "原始输入",
    	newJobRawHint: "你想完成什么。",
    	newJobStructuredTitle: "结构化输入",
    	newJobStructuredHint: "开始任务的产出契约；它会成为这次作业的结构化输入。",
    	newJobSubmit: "启动作业",
    	newJobSubmitting: "正在启动…",
    	newJobStarted: "作业已创建。",
    	newJobFailed: "启动作业失败：",
    	newJobRawFallback: "需求描述",
    	newJobStructuredFallback: "结构化输入（JSON）",
    	newJobJsonInvalid: "结构化输入不是合法 JSON：",
    	fieldRequired: "{name} 为必填。",
    	fieldJsonInvalid: "{name} 不是合法 JSON：",
    	fieldInvalidBoolean: "{name} 必须是 true 或 false。",
    	fieldInvalidNumber: "{name} 必须是数字。",
    	fallbackJsonTitle: "JSON",
    	fallbackJsonHint: "Host 没有提供 schema，按 JSON 填写这个字段。",
    	backToWorkflow: "返回工作流",
    	jobTitle: "作业",
    	starter: "启动者",
    	starterHuman: "人（页面启动）",
    	starterSession: "会话",
    	openStarterSession: "打开启动者会话",
    	cancelJob: "取消作业",
    	cancelJobConfirm: "确定取消这个作业？未完成的任务都会取消。",
    	retryDelivery: "重试交付",
    	deliveryRetryHint: "结束任务仍在「待认领」：交付没有成功。可以重试交付。",
    	deliveryRetryStarted: "已发起重试交付。",
    	jobUpdatedAt: "更新于",
    	jobErrorTitle: "错误",
    	jobViewsAria: "作业视图",
    	boardTab: "看板",
    	graphTab: "流程图",
    	tasksTab: "任务",
    	attachmentsTab: "附件库",
    	timelineTab: "时间线",
    	boardStart: "开始",
    	boardEnd: "结束",
    	boardColumnPending: "排队",
    	boardColumnReady: "待认领",
    	boardColumnRunning: "进行中",
    	boardColumnCompleted: "已完成",
    	boardColumnError: "异常",
    	boardNoTasks: "无任务",
    	boardEmpty: "这个作业还没有任务。",
    	boardEmptyHint: "启动任务完成后，任务会按定义派生出来。",
    	boardHint: "点击卡片查看任务详情。",
    	boardCardDeps: "依赖 {n}",
    	boardCardAttempts: "重试 {n}",
    	boardCardAttachments: "附件 {n}",
    	boardCardWaiting: "等待 {duration}",
    	taskCount: "{n} 个任务",
    	jobGraphHint: "点击岗位节点打开它的一个任务。",
    	tasksEmpty: "还没有任务。",
    	tasksHint: "点击一行查看任务详情。",
    	tasksTableType: "类型",
    	tasksTablePosition: "岗位",
    	tasksTableStatus: "状态",
    	tasksTableClaimant: "承办者",
    	tasksTableCreated: "创建",
    	attachmentsTitle: "附件库",
    	attachmentsEmpty: "这个作业还没有附件。",
    	attachmentsHint: "附件来自任务产出；点文件名预览。",
    	attachmentSource: "来源",
    	attachmentBy: "产出者",
    	attachmentPreview: "预览",
    	attachmentDownload: "下载",
    	attachmentPreviewLoading: "正在加载预览…",
    	attachmentPreviewFailed: "预览加载失败：",
    	attachmentPreviewRetry: "重试",
    	attachmentPreviewClose: "关闭预览",
    	attachmentPreviewBinary: "这种文件无法在此预览，请下载。",
    	attachmentPreviewUnsupported: "这种文件类型不支持预览。",
    	attachmentPreviewTruncated: "仅展示文件开头的一部分。",
    	attachmentPreviewEmpty: "文件内容为空。",
    	attachmentPreviewImageFailed: "图片无法显示。",
    	attachmentPreviewPdfHint: "PDF 已在上方内嵌显示；需要副本请下载。",
    	timelineTitle: "时间线",
    	timelineEmpty: "还没有事件。",
    	timelineJobCreated: "作业创建",
    	timelineJobUpdated: "作业更新",
    	timelineTaskCreated: "任务创建",
    	timelineTaskStarted: "开始执行",
    	timelineTaskFinished: "任务完成",
    	timelineTaskFailed: "任务失败",
    	timelineTaskCancelled: "任务取消",
    	taskDrawerTitle: "任务详情",
    	taskPosition: "岗位",
    	taskType: "类型",
    	taskStatus: "状态",
    	taskId: "任务 id",
    	taskClaimant: "承办者",
    	taskCreatedAt: "创建",
    	taskStartedAt: "开始",
    	taskFinishedAt: "结束",
    	taskDepsTitle: "依赖",
    	taskDepsEmpty: "没有依赖。",
    	taskPayloadTitle: "输入（payload）",
    	taskPayloadEmpty: "没有 payload。",
    	taskAttemptsTitle: "执行记录",
    	taskAttemptsEmpty: "还没有执行记录。",
    	taskAttemptSession: "会话",
    	taskAttemptStopReason: "停止原因",
    	taskAttemptError: "错误",
    	taskResultTitle: "结果",
    	taskResultEmpty: "还没有结果。",
    	taskResultText: "文本",
    	taskResultOutput: "结构化产出",
    	taskResultAttachments: "结果附件",
    	finalDeliverableTitle: "最终交付物",
    	taskActionsTitle: "操作",
    	taskActionsEmpty: "当前没有可执行的操作。",
    	actionClaim: "认领",
    	actionComplete: "提交",
    	actionCancel: "取消任务",
    	actionRetry: "重试",
    	actionSubmitComplete: "提交结果",
    	actionSubmitting: "正在提交…",
    	actionTextLabel: "说明（可选）",
    	actionFormTitle: "填写结果",
    	actionFormHint: "按任务类型声明的产出契约填写。",
    	actionFormNoSchema: "该任务类型没有产出 schema，按 JSON 填写结果。",
    	actionJsonInvalid: "结果不是合法 JSON：",
    	actionCancelConfirm: "确定取消这个任务？依赖它的任务会阻塞。",
    	taskActionDone: "操作已完成。",
    	taskActionFailed: "操作失败：",
    	openSession: "打开会话",
    	openSessionFailed: "打开会话失败：",
    	noUiWorkspace: "当前客户端没有 uiWorkspace 服务，无法打开会话。",
    	sessionLabel: "会话",
    	payloadLabel: "Payload"
    };
    // .build/workflows/client/format.js
    /**
    * 展示文本：状态 / 时间 / 耗时 / 字节数 / 截断 / JSON 与错误文案。
    *
    * 时间在 HTTP 契约里是 ISO 字符串；旧数据可能是毫秒时间戳，这里两种都接受。
    */
    /**
    * 把失败原因转成展示文本。
    *
    * @param failure
    * @returns
    */
    function messageOf(failure) {
    	if (failure instanceof Error) return failure.message;
    	return String(failure);
    }
    /**
    * 工作流状态 → 词典 key。
    *
    * @param status
    * @returns
    */
    function workflowStatusKey(status) {
    	switch (status) {
    		case "active": return "workflowActive";
    		case "retired": return "workflowRetired";
    		case "draft": return "workflowDraft";
    		default: return "unknown";
    	}
    }
    /**
    * 作业 / 任务状态 → 词典 key。
    *
    * @param status
    * @returns
    */
    function statusKey(status) {
    	switch (status) {
    		case "running": return "statusRunning";
    		case "completed": return "statusCompleted";
    		case "failed": return "statusFailed";
    		case "cancelled": return "statusCancelled";
    		case "pending": return "statusPending";
    		case "ready": return "statusReady";
    		case "blocked": return "statusBlocked";
    		default: return "unknown";
    	}
    }
    /**
    * 状态 → Tag tone。
    *
    * @param status
    * @returns
    */
    function statusTone(status) {
    	switch (status) {
    		case "completed":
    		case "active": return "success";
    		case "running": return "info";
    		case "ready":
    		case "failed":
    		case "blocked": return "warning";
    		default: return "neutral";
    	}
    }
    /**
    * 状态 → 看板 / 节点圆点的 CSS 状态名。
    *
    * @param status
    * @returns
    */
    function stateClass(status) {
    	switch (status) {
    		case "running": return "running";
    		case "ready": return "waiting";
    		case "completed": return "done";
    		case "failed":
    		case "blocked": return "failed";
    		default: return "idle";
    	}
    }
    /**
    * ISO 时间 / 毫秒时间戳 → 本地时间。
    *
    * @param value
    * @returns
    */
    function formatTime(value) {
    	const date = toDate(value);
    	if (date === null) return "—";
    	try {
    		return date.toLocaleString();
    	} catch {
    		return "—";
    	}
    }
    /**
    * 把一个时间值解析成 Date。
    *
    * @param value
    * @returns
    */
    function toDate(value) {
    	if (typeof value === "number" && Number.isFinite(value)) {
    		const date = new Date(value);
    		return Number.isNaN(date.getTime()) ? null : date;
    	}
    	if (typeof value !== "string" || value === "") return null;
    	const date = new Date(value);
    	return Number.isNaN(date.getTime()) ? null : date;
    }
    /**
    * 从创建到现在的等待时长；没有终点时用当前时间。
    *
    * @param since
    * @param [until]
    * @returns
    */
    function formatWaiting(since, until = null) {
    	const started = toDate(since);
    	if (started === null) return "";
    	const finished = until === null ? /* @__PURE__ */ new Date() : toDate(until);
    	if (finished === null) return "";
    	return formatMs(finished.getTime() - started.getTime());
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
    	const minutes = seconds / 60;
    	if (minutes < 60) return `${minutes.toFixed(1)}min`;
    	return `${(minutes / 60).toFixed(1)}h`;
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
    * 任意值 → 可读 JSON；循环引用 / 不可序列化时退回字符串。
    *
    * @param value
    * @returns
    */
    function jsonText(value) {
    	if (value === void 0) return "";
    	if (value === null) return "null";
    	try {
    		return JSON.stringify(value, null, 2);
    	} catch {
    		return String(value);
    	}
    }
    /**
    * 任务状态 → 看板列 key。
    *
    * @param status
    * @returns
    */
    function boardColumn(status) {
    	switch (status) {
    		case "ready": return "ready";
    		case "running": return "running";
    		case "completed": return "completed";
    		case "failed":
    		case "blocked":
    		case "cancelled": return "error";
    		default: return "pending";
    	}
    }
    /**
    * 翻译状态；未知状态直接展示原值。
    *
    * @param t
    * @param status
    * @returns
    */
    function statusLabel(t, status) {
    	const key = statusKey(status);
    	if (key !== "unknown") return t(key);
    	return typeof status === "string" && status !== "" ? status : t("unknown");
    }
    // .build/workflows/client/types.js
    /**
    * 浏览器一半的共享类型与常量。
    *
    * 这里的形状全部是**客户端本地定义**：按 `.tmp/workflow-v4-api.md` 的 HTTP
    * 契约声明，不 import 宿主一半的任何模块，避免把 node 依赖带进浏览器包。
    *
    * 契约字段一律按「可能缺失」处理（响应来自新版 / 旧版 Host 都可能），页面
    * 只做防御式读取，不做完整校验。
    */
    /** 侧边栏条目的词典命名空间，也是 `main` 插槽的 locale。 */
    const NS = "buka-workflows";
    /** 侧边栏条目 id；与 `main` 插槽的 key 必须相同。 */
    const PANEL_ID = "buka-workflows";
    /** 工作流列表。 */
    const WORKFLOWS_ROUTE = "/buka-workflows/workflows";
    /** 工作流详情（定义快照 + 图 + 作业列表）。 */
    const WORKFLOW_ROUTE = "/buka-workflows/workflow";
    /** 激活 / 停用工作流。 */
    const WORKFLOW_ACTIVATE_ROUTE = "/buka-workflows/workflow/activate";
    /** 某个工作流下的作业列表。 */
    const JOBS_ROUTE = "/buka-workflows/jobs";
    /** 作业详情（含任务摘要）。 */
    const JOB_ROUTE = "/buka-workflows/job";
    /** 页面人启动作业。 */
    const JOB_START_ROUTE = "/buka-workflows/job/start";
    /** 作业动作：cancel / retry-delivery。 */
    const JOB_ACTION_ROUTE = "/buka-workflows/job/action";
    /** 任务详情（payload / 依赖 / 执行记录 / 结果 / 操作）。 */
    const TASK_ROUTE = "/buka-workflows/task";
    /** 任务动作：cancel / retry / claim / complete。 */
    const TASK_ACTION_ROUTE = "/buka-workflows/task/action";
    /** 作业附件库。 */
    const ATTACHMENTS_ROUTE = "/buka-workflows/attachments";
    /** 单个附件的下载 / 预览 / 内联地址。 */
    const ATTACHMENT_ROUTE = "/buka-workflows/attachment";
    /** 有运行中作业时的刷新间隔（沿用旧页面风格）。 */
    const LIVE_REFRESH_MS = 1500;
    /** 没有运行中作业时的刷新间隔。 */
    const REFRESH_MS = 5e3;
    /** 判断普通对象。 */
    function isRecord(value) {
    	return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    /** 安全数组。 */
    function asArray(value) {
    	return Array.isArray(value) ? value : [];
    }
    // .build/workflows/client/request.js
    /**
    * Host 路由的请求封装：JSON 请求、POST 动作与附件地址。
    *
    * 所有请求都走界面侧公共包的 `requestJson`（同源、`ok !== true` 即抛错），
    * 信任栅栏由 Host 一半负责。
    */
    /**
    * 发一个 POST JSON 请求。
    *
    * @param url 路由地址
    * @param body 已经序列化的请求体对象
    */
    function postJson(url, body) {
    	return requestJson(url, {
    		method: "POST",
    		body: JSON.stringify(body)
    	});
    }
    /**
    * 附件地址：作业附件库里的附件 id + `mode`。
    *
    * `mode` 省略即下载；`preview` 取预览元数据 / 文本；`inline` 直接取图片 / PDF
    * 正文。沿用旧附件路由的 mode 语义。
    *
    * @param jobId 作业 id
    * @param attachmentId 附件 id
    * @param [mode] 下载 / 预览 / 内联
    * @returns
    */
    function attachmentUrl(jobId, attachmentId, mode) {
    	const params = new URLSearchParams({
    		jobId: typeof jobId === "string" ? jobId : "",
    		attachmentId: typeof attachmentId === "string" ? attachmentId : ""
    	});
    	if (mode === "preview" || mode === "inline") params.set("mode", mode);
    	return `${ATTACHMENT_ROUTE}?${params.toString()}`;
    }
    // .build/workflows/client/schema.js
    /**
    * 受限 JSON Schema → 表单：人任务产出、页面启动作业的原始 / 结构化输入共用。
    *
    * schema 是 spec §5.4 的子集（object / array / string / number / integer /
    * boolean / enum / const / oneOf），不是完整的 JSON Schema 实现。
    */
    /** 多行输入更合适的字段名。 */
    const MULTILINE_NAMES = /* @__PURE__ */ new Set([
    	"request",
    	"requirement",
    	"acceptance",
    	"summary",
    	"description",
    	"note",
    	"focus",
    	"detail",
    	"content",
    	"text",
    	"prompt"
    ]);
    /**
    * 取出 schema 的字段列表；没有 properties 时返回空数组。
    *
    * @param schema
    * @returns
    */
    function schemaFields(schema) {
    	const properties = isRecord(schema?.properties) ? schema.properties : {};
    	const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((name) => typeof name === "string") : []);
    	return Object.entries(properties).map(([name, value]) => ({
    		name,
    		schema: isRecord(value) ? value : {},
    		required: required.has(name)
    	}));
    }
    /**
    * 字段的类型名（处理 `type` 是数组与 `oneOf` 的简化）。
    *
    * @param schema
    * @returns
    */
    function fieldKind(schema) {
    	const value = schema.const !== void 0 ? schema.const : void 0;
    	if (schema.enum !== void 0 || value !== void 0) return "enum";
    	const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
    	if (oneOf.length === 1 && isRecord(oneOf[0])) return fieldKind(oneOf[0]);
    	switch (Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type) {
    		case "boolean": return "boolean";
    		case "number":
    		case "integer": return "number";
    		case "object":
    		case "array": return "json";
    		default: return "string";
    	}
    }
    /**
    * 字段是否用多行输入。
    *
    * @param field
    * @returns
    */
    function isMultilineField(field) {
    	return field.schema.type !== "object" && field.schema.type !== "array" && MULTILINE_NAMES.has(field.name);
    }
    /**
    * 枚举候选值。
    *
    * @param schema
    * @returns
    */
    function enumOptions(schema) {
    	if (Array.isArray(schema.enum)) return schema.enum.map((item) => ({
    		value: String(item),
    		label: String(item)
    	}));
    	if (schema.const !== void 0) return [{
    		value: String(schema.const),
    		label: String(schema.const)
    	}];
    	const first = (Array.isArray(schema.oneOf) ? schema.oneOf : []).find((item) => isRecord(item) && Array.isArray(item.enum));
    	return first === void 0 ? [] : enumOptions(first);
    }
    /**
    * 渲染一组 schema 字段。受控输入：值来自 `values`，变化交给 `onChange`。
    *
    * @param page 页面上下文（只用到词典）
    * @param options schema、值、变化回调与 id 前缀
    * @returns 表单字段数组
    */
    function renderSchemaFields(page, options) {
    	const { t } = page;
    	const fields = schemaFields(options.schema);
    	if (fields.length === 0) return [h("p", {
    		className: "buka-workflows-hint",
    		key: "no-fields"
    	}, t("schemaNoFields"))];
    	return fields.map((field) => renderField(page, field, options));
    }
    /**
    * 单个字段。
    *
    * @param page
    * @param field
    * @param options
    * @returns
    */
    function renderField(page, field, options) {
    	const { t } = page;
    	const id = `${options.idPrefix}-${field.name}`;
    	const value = options.values[field.name] ?? "";
    	const kind = fieldKind(field.schema);
    	const onChange = (next) => options.onChange(field.name, next);
    	let control;
    	if (kind === "enum") {
    		const choices = enumOptions(field.schema);
    		control = h("select", {
    			id,
    			className: "buka-workflows-select",
    			value,
    			onChange: (event) => onChange(event.target.value)
    		}, h("option", { value: "" }, "—"), ...choices.map((choice) => h("option", {
    			key: choice.value,
    			value: choice.value
    		}, choice.label)));
    	} else if (kind === "boolean") control = h("select", {
    		id,
    		className: "buka-workflows-select",
    		value,
    		onChange: (event) => onChange(event.target.value)
    	}, h("option", { value: "" }, "—"), h("option", { value: "true" }, "true"), h("option", { value: "false" }, "false"));
    	else if (kind === "json") control = h("textarea", {
    		id,
    		className: "buka-workflows-textarea",
    		rows: 4,
    		value,
    		spellcheck: "false",
    		onChange: (event) => onChange(event.target.value)
    	});
    	else if (kind === "number") control = h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		id,
    		type: "number",
    		value,
    		className: "buka-workflows-input",
    		onChange: (event) => onChange(event.target.value)
    	});
    	else if (isMultilineField(field)) control = h("textarea", {
    		id,
    		className: "buka-workflows-textarea",
    		rows: 3,
    		value,
    		onChange: (event) => onChange(event.target.value)
    	});
    	else control = h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		id,
    		type: "text",
    		value,
    		className: "buka-workflows-input",
    		onChange: (event) => onChange(event.target.value)
    	});
    	return h("div", {
    		key: field.name,
    		className: "buka-workflows-field"
    	}, h("label", {
    		className: "buka-workflows-fieldLabel",
    		htmlFor: id
    	}, field.name, field.required ? h("span", { className: "buka-workflows-required" }, ` · ${t("schemaFieldRequired")}`) : null), control, kind === "json" ? h("p", { className: "buka-workflows-fieldHint" }, t("fallbackJsonHint")) : null);
    }
    /**
    * 把表单值解析成 schema 约定的对象。必填缺失 / 类型不对 / JSON 非法时返回错误。
    *
    * @param schema
    * @param values
    * @param t
    * @returns 解析结果
    */
    function parseSchemaValues(schema, values, t) {
    	const fields = schemaFields(schema);
    	if (fields.length === 0) {
    		const text = Object.values(values).join("").trim();
    		if (text === "") return { value: {} };
    		const parsed = parseJson(text);
    		return isRecord(parsed) ? { value: parsed } : { error: fill(t, "fieldJsonInvalid", { name: "" }) };
    	}
    	const output = {};
    	for (const field of fields) {
    		const raw = (values[field.name] ?? "").trim();
    		if (raw === "") {
    			if (field.required) return { error: fill(t, "fieldRequired", { name: field.name }) };
    			continue;
    		}
    		const kind = fieldKind(field.schema);
    		if (kind === "boolean") {
    			if (raw !== "true" && raw !== "false") return { error: fill(t, "fieldInvalidBoolean", { name: field.name }) };
    			output[field.name] = raw === "true";
    		} else if (kind === "number") {
    			const asNumber = Number(raw);
    			if (!Number.isFinite(asNumber)) return { error: fill(t, "fieldInvalidNumber", { name: field.name }) };
    			output[field.name] = field.schema.type === "integer" ? Math.trunc(asNumber) : asNumber;
    		} else if (kind === "json") {
    			const parsed = parseJson(raw);
    			if (parsed === void 0) return { error: fill(t, "fieldJsonInvalid", { name: field.name }) };
    			output[field.name] = parsed;
    		} else if (kind === "enum") output[field.name] = coerceEnum(field.schema, raw);
    		else output[field.name] = raw;
    	}
    	return { value: output };
    }
    /**
    * 枚举值按原 schema 的类型还原（数字枚举保持数字）。
    *
    * @param schema
    * @param raw
    * @returns
    */
    function coerceEnum(schema, raw) {
    	const direct = (Array.isArray(schema.enum) ? schema.enum : []).find((value) => String(value) === raw);
    	if (direct !== void 0) return direct;
    	if (typeof schema.const !== "undefined" && String(schema.const) === raw) return schema.const;
    	const first = (Array.isArray(schema.oneOf) ? schema.oneOf : []).find((item) => isRecord(item) && Array.isArray(item.enum));
    	if (first !== void 0) return coerceEnum(first, raw);
    	return raw;
    }
    /**
    * 解析 JSON；非法时返回 `undefined`（合法 `undefined` 本身也不在 JSON 里）。
    *
    * @param text
    * @returns
    */
    function parseJson(text) {
    	try {
    		return JSON.parse(text);
    	} catch {
    		return;
    	}
    }
    /**
    * 没有 schema 时给一个「整段 JSON」的 textarea 字段。
    *
    * @param page
    * @param value
    * @param onChange
    * @param id
    * @returns
    */
    function renderJsonFallback(page, value, onChange, id) {
    	const { t } = page;
    	return h("div", { className: "buka-workflows-field" }, h("label", {
    		className: "buka-workflows-fieldLabel",
    		htmlFor: id
    	}, t("fallbackJsonTitle")), h("textarea", {
    		id,
    		className: "buka-workflows-textarea",
    		rows: 6,
    		value,
    		spellcheck: "false",
    		onChange: (event) => onChange(event.target.value)
    	}), h("p", { className: "buka-workflows-fieldHint" }, t("fallbackJsonHint")));
    }
    // .build/workflows/client/components/parts.js
    /**
    * 页面通用小部件：状态标签、加载 / 失败 / 空态、键值行、只读 schema 与 JSON 块。
    */
    /** 加载态。 */
    function renderLoading(page) {
    	return h("p", {
    		className: "buka-workflows-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), page.t("loading"));
    }
    /** 失败态；`retry` 存在时给一个重试按钮。 */
    function renderFailure(page, error, retry) {
    	const { t } = page;
    	return h("div", {
    		className: "buka-workflows-failureBox",
    		role: "alert"
    	}, h("p", { className: "buka-workflows-failure" }, `${t("loadFailed")} ${error}`), retry === null || retry === void 0 ? null : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: retry
    	}, t("retry")));
    }
    /** 空态。 */
    function renderEmpty(title, hint) {
    	return h("div", { className: "buka-workflows-emptyBox" }, h("p", { className: "buka-workflows-empty" }, title), hint === null || hint === void 0 || hint === "" ? null : h("p", { className: "buka-workflows-hint" }, hint));
    }
    /** 状态标签（任务 / 作业通用）。 */
    function renderStatusTag(t, status, kind = "task") {
    	const label = kind === "workflow" ? t(workflowStatusKey(status)) : statusLabel(t, status);
    	return h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: statusTone(status) }, label);
    }
    /** 键值行。 */
    function renderKv(rows) {
    	return h("div", { className: "buka-workflows-kv" }, ...rows.map(([key, value], index) => h("div", {
    		key: `${key}-${index}`,
    		className: "buka-workflows-kvRow"
    	}, h("span", { className: "buka-workflows-kvKey" }, key), h("span", { className: "buka-workflows-kvValue" }, value))));
    }
    /** 区块：标题 + 内容。 */
    function renderSection(title, children, extra) {
    	return h("section", { className: "buka-workflows-section" }, h("div", { className: "buka-workflows-sectionHead" }, h("h3", { className: "buka-workflows-sectionTitle" }, title), extra ?? null), children);
    }
    /** 执行者展示：机器人 / 人 + 名字。 */
    function renderExecutor(page, executor) {
    	const { t } = page;
    	if (!isRecord(executor)) return t("taskTypeUnset");
    	if (executor.kind === "human") return t("actorHuman");
    	const kind = executor.kind === "robot" ? t("actorRobot") : t("taskTypeUnset");
    	const name = typeof executor.name === "string" && executor.name !== "" ? executor.name : "";
    	return name === "" ? kind : `${kind} · ${name}`;
    }
    /** 只读展示一组 schema 字段。 */
    function renderSchema(page, schema) {
    	const { t } = page;
    	const fields = schemaFields(schema);
    	if (fields.length === 0) return h("p", { className: "buka-workflows-hint" }, t("schemaNoFields"));
    	return h("ul", { className: "buka-workflows-schemaList" }, ...fields.map((field) => h("li", {
    		key: field.name,
    		className: "buka-workflows-schemaField"
    	}, h("code", { className: "buka-workflows-inlineCode" }, field.name), h("span", { className: "buka-workflows-schemaType" }, schemaTypeLabel(field.schema)), field.required ? h("span", { className: "buka-workflows-required" }, t("schemaFieldRequired")) : null)));
    }
    /** 字段类型 → 展示文本。 */
    function schemaTypeLabel(schema) {
    	if (Array.isArray(schema.enum)) return `enum(${schema.enum.map(String).join(" | ")})`;
    	if (schema.const !== void 0) return String(schema.const);
    	const type = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
    	return typeof type === "string" && type !== "" ? type : "any";
    }
    /** JSON 块；空值显示提示。 */
    function renderJsonBlock(value, emptyText, maxHeight = false) {
    	const text = jsonText(value);
    	if (text === "") return h("p", { className: "buka-workflows-hint" }, emptyText);
    	return h("pre", { className: `buka-workflows-pre${maxHeight ? " is-tall" : ""}` }, text);
    }
    /** 可点击的附件名按钮。 */
    function renderAttachmentLink(page, attachment, onOpen) {
    	const id = typeof attachment.id === "string" ? attachment.id : "";
    	const name = typeof attachment.name === "string" ? attachment.name : "";
    	if (id === "") return null;
    	return h("button", {
    		type: "button",
    		className: "buka-workflows-attachmentLink",
    		title: page.t("attachmentPreview"),
    		onClick: () => onOpen(id, name)
    	}, name === "" ? id : name);
    }
    /** 时间文本（null 显示 —）。 */
    function timeText(value) {
    	return formatTime(value);
    }
    // .build/workflows/client/components/attachments.js
    /**
    * 作业附件库与附件预览抽屉。
    */
    /**
    * 附件库视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderAttachments(page) {
    	const { t, state, actions } = page;
    	const loaded = state.attachments;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.status !== "ready" && loaded.data === null) return renderLoading(page);
    	const items = loaded.data ?? [];
    	if (items.length === 0) return renderEmpty(t("attachmentsEmpty"), t("attachmentsHint"));
    	const jobId = jobIdOf$1(page);
    	return h("div", { className: "buka-workflows-listPane" }, h("p", { className: "buka-workflows-hint" }, t("attachmentsHint")), h("ul", { className: "buka-workflows-attachmentList" }, ...items.map((attachment) => renderAttachmentRow(page, jobId, attachment))));
    }
    /**
    * 附件库的一行。
    *
    * @param page
    * @param jobId
    * @param attachment
    * @returns React 元素
    */
    function renderAttachmentRow(page, jobId, attachment) {
    	const { t, actions, state } = page;
    	const meta = [
    		formatBytes(attachment.bytes),
    		attachment.mime,
    		formatTime(attachment.createdAt)
    	].filter((part) => typeof part === "string" && part !== "");
    	const sourcePosition = typeof attachment.sourcePositionId === "string" && attachment.sourcePositionId !== "" ? attachment.sourcePositionId : "";
    	const sourceKnown = typeof attachment.sourceTaskId === "string" && attachment.sourceTaskId !== "" && (state.job.data?.tasks ?? []).some((task) => task.id === attachment.sourceTaskId);
    	return h("li", {
    		key: attachment.id,
    		className: "buka-workflows-attachment"
    	}, h("span", { className: "buka-workflows-attachmentMain" }, h("button", {
    		type: "button",
    		className: "buka-workflows-attachmentLink",
    		title: t("attachmentPreview"),
    		onClick: () => actions.openAttachment(attachment.id, attachment.name)
    	}, attachment.name), sourceKnown ? h("button", {
    		type: "button",
    		className: "buka-workflows-attachmentSource",
    		onClick: () => actions.openTask(typeof attachment.sourceTaskId === "string" ? attachment.sourceTaskId : "")
    	}, `${t("attachmentSource")}: ${sourcePosition || attachment.sourceTaskId}`) : sourcePosition === "" ? null : h("span", { className: "buka-workflows-attachmentSource" }, `${t("attachmentSource")}: ${sourcePosition}`), typeof attachment.description === "string" && attachment.description !== "" ? h("span", { className: "buka-workflows-attachmentDescription" }, attachment.description) : null), h("span", { className: "buka-workflows-attachmentMeta" }, meta.join(" · ")), h("a", {
    		className: "buka-workflows-attachmentDownload",
    		href: attachmentUrl(jobId, attachment.id),
    		download: attachment.name
    	}, t("attachmentDownload")));
    }
    /**
    * 附件预览抽屉：头部是文件身份与下载 / 关闭，正文按 Host 返回的 `kind` 分派。
    *
    * @param page
    * @returns React 元素；没有打开附件时为 null
    */
    function renderAttachmentDrawer(page) {
    	const { t, state, actions } = page;
    	const viewer = state.attachment;
    	if (viewer === null) return null;
    	const jobId = jobIdOf$1(page);
    	const preview = viewer.data;
    	const meta = [preview !== null && typeof preview.bytes === "number" ? formatBytes(preview.bytes) : "", preview !== null && typeof preview.mime === "string" ? preview.mime : ""].filter((part) => part !== "").join(" · ");
    	const body = [];
    	if (viewer.status === "loading") body.push(h("p", {
    		className: "buka-workflows-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("attachmentPreviewLoading")));
    	else if (viewer.status === "failed") {
    		body.push(h("p", {
    			className: "buka-workflows-failure",
    			role: "alert"
    		}, viewer.error ?? t("attachmentPreviewFailed")));
    		body.push(h("div", { className: "buka-workflows-drawerActions" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			size: "sm",
    			className: "buka-workflows-smallButton",
    			onClick: () => actions.openAttachment(viewer.id, viewer.name)
    		}, t("attachmentPreviewRetry"))));
    	} else if (preview !== null) {
    		if (preview.kind === "image") body.push(h("img", {
    			className: "buka-workflows-drawerImage",
    			src: attachmentUrl(jobId, viewer.id, "inline"),
    			alt: viewer.name
    		}));
    		else if (preview.kind === "pdf") {
    			body.push(h("iframe", {
    				className: "buka-workflows-drawerFrame",
    				src: attachmentUrl(jobId, viewer.id, "inline"),
    				title: viewer.name
    			}));
    			body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewPdfHint")));
    		} else if (preview.kind === "text") {
    			const text = typeof preview.text === "string" ? preview.text : "";
    			body.push(text === "" ? h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewEmpty")) : h("pre", { className: "buka-workflows-pre" }, text));
    			if (preview.truncated === true) body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewTruncated")));
    		} else if (preview.kind === "binary") body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewBinary")));
    		else body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewUnsupported")));
    	}
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: actions.closeAttachment,
    		title: viewer.name,
    		closeLabel: t("attachmentPreviewClose"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer"
    	}, h("div", { className: "buka-workflows-drawerHead" }, h("div", { className: "buka-workflows-drawerTitleRow" }, h("span", { className: "buka-workflows-drawerTitle" }, viewer.name)), meta === "" ? null : h("span", { className: "buka-workflows-drawerMeta" }, meta), h("div", { className: "buka-workflows-drawerActions" }, h("a", {
    		className: "buka-workflows-drawerDownload",
    		href: attachmentUrl(jobId, viewer.id),
    		download: viewer.name
    	}, t("attachmentDownload")), h("button", {
    		type: "button",
    		className: "buka-workflows-drawerClose",
    		"aria-label": t("attachmentPreviewClose"),
    		title: t("attachmentPreviewClose"),
    		onClick: actions.closeAttachment
    	}, h("span", { "aria-hidden": true }, "×")))), h("div", { className: "buka-workflows-drawerBody" }, ...body));
    }
    /**
    * 当前作业 id。
    *
    * @param page
    * @returns
    */
    function jobIdOf$1(page) {
    	if (page.state.route.kind === "job") return page.state.route.jobId;
    	return page.state.job.data?.job?.id ?? "";
    }
    // .build/workflows/client/model.js
    /**
    * 页面数据模型：把 Host 返回的定义快照 / 任务记录收口成看板与流程图直接消费的形状。
    *
    * 服务端只给「岗位、边、任务」，坐标与分组都在客户端算（见 `graph/layout.ts`）。
    */
    /** 取当前工作流详情里的定义快照。 */
    function currentDefinition(state) {
    	const definition = state.workflow.data?.workflow?.definition;
    	return isRecord(definition) ? definition : null;
    }
    /** 取当前作业绑定的定义快照（任务类型的唯一来源）。 */
    function currentJobDefinition(state) {
    	const detail = state.job.data;
    	if (detail === null) return null;
    	const definition = detail.definition;
    	if (!isRecord(definition)) return null;
    	return definition;
    }
    /** 把定义里的岗位归一化。 */
    function positionsOf(definition) {
    	const list = asArray(definition?.positions);
    	const out = [];
    	for (const position of list) {
    		const id = typeof position?.id === "string" ? position.id : "";
    		if (id === "") continue;
    		out.push({
    			id,
    			label: typeof position.label === "string" && position.label !== "" ? position.label : id,
    			description: typeof position.description === "string" ? position.description : "",
    			executor: isRecord(position.executor) ? position.executor : {},
    			taskTypes: asArray(position.taskTypes)
    		});
    	}
    	return out;
    }
    /** 把定义里的边归一化。 */
    function edgesOf(definition) {
    	return asArray(definition?.edges).filter((edge) => typeof edge?.from === "string" && edge.from !== "" && typeof edge.to === "string" && edge.to !== "").map((edge) => ({
    		from: edge.from,
    		to: edge.to,
    		types: asArray(edge.types).filter((type) => typeof type === "string"),
    		back: edge.back === true
    	}));
    }
    /**
    * 图 / 看板里的岗位顺序：定义顺序优先；作业详情精简版只有岗位数组。
    *
    * @param definition
    * @returns
    */
    function graphPositions(definition) {
    	return positionsOf(definition).map((position) => ({
    		id: position.id,
    		label: position.label,
    		executor: position.executor
    	}));
    }
    /**
    * 展开所有任务类型（跨岗位）并记下所属岗位。
    *
    * @param definition
    * @returns
    */
    function allTaskTypes(definition) {
    	const out = [];
    	for (const position of positionsOf(definition)) for (const type of position.taskTypes) if (typeof type?.id === "string" && type.id !== "") out.push({
    		position,
    		type
    	});
    	return out;
    }
    /**
    * 找任务类型定义。作业详情精简版可能不含 `taskTypes`，此时回退到工作流完整定义。
    *
    * @param jobDefinition 作业详情里的定义
    * @param workflowDefinition 工作流完整定义（可选）
    * @param positionId 岗位 id
    * @param typeId 任务类型 id
    * @returns
    */
    function findTaskType(jobDefinition, workflowDefinition, positionId, typeId) {
    	for (const definition of [jobDefinition, workflowDefinition]) {
    		if (definition === null) continue;
    		const position = positionsOf(definition).find((item) => item.id === positionId);
    		if (position === void 0) continue;
    		const found = position.taskTypes.find((type) => type.id === typeId);
    		if (found !== void 0) return found;
    	}
    	return null;
    }
    /** 任务是否属于「人岗位」。 */
    function isHumanPosition(definition, positionId) {
    	const position = positionsOf(definition).find((item) => item.id === positionId);
    	return position !== void 0 && position.executor.kind === "human";
    }
    /** 任务类型 → 该岗位的输出 schema。 */
    function outputSchemaFor(jobDefinition, workflowDefinition, task) {
    	if (task === null) return null;
    	const type = findTaskType(jobDefinition, workflowDefinition, task.position, task.type);
    	return isRecord(type?.output) ? type.output : null;
    }
    /** 当前作业里的任务；没有详情时给空数组。 */
    function jobTasks(state) {
    	const tasks = state.job.data?.tasks;
    	return Array.isArray(tasks) ? tasks.filter((task) => typeof task?.id === "string") : [];
    }
    /**
    * 任务摘要的展示顺序：创建时间升序，同一时间按 id 稳定排序。
    *
    * @param tasks
    * @returns
    */
    function sortTasks(tasks) {
    	return [...tasks].sort((left, right) => {
    		const leftTime = typeof left.createdAt === "string" ? left.createdAt : "";
    		const rightTime = typeof right.createdAt === "string" ? right.createdAt : "";
    		if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    		return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    	});
    }
    /**
    * 看板行：开始 + 岗位（定义顺序）+ 结束。
    *
    * @param definition
    * @param tasks
    * @param builtin
    * @returns
    */
    function boardRows(definition, tasks, builtin) {
    	const positions = positionsOf(definition);
    	const known = new Set(positions.map((position) => position.id));
    	const startTasks = tasks.filter((task) => task.position === "start");
    	const endTasks = tasks.filter((task) => task.position === "end");
    	const rows = [
    		{
    			id: "start",
    			kind: "start",
    			label: builtin.start,
    			executor: null,
    			tasks: startTasks
    		},
    		...positions.map((position) => ({
    			id: position.id,
    			kind: "position",
    			label: position.label,
    			executor: position.executor,
    			tasks: sortTasks(tasks.filter((task) => task.position === position.id))
    		})),
    		{
    			id: "end",
    			kind: "end",
    			label: builtin.end,
    			executor: null,
    			tasks: endTasks
    		}
    	];
    	const extras = tasks.filter((task) => task.position !== "start" && task.position !== "end" && (typeof task.position !== "string" || !known.has(task.position)));
    	for (const task of sortTasks(extras)) {
    		const id = typeof task.position === "string" ? task.position : "(unknown)";
    		let row = rows.find((item) => item.id === id);
    		if (row === void 0) {
    			row = {
    				id,
    				kind: "position",
    				label: id,
    				executor: null,
    				tasks: []
    			};
    			rows.splice(rows.length - 1, 0, row);
    		}
    		row.tasks.push(task);
    	}
    	return rows;
    }
    /**
    * 作业看板里某一行的状态汇总（给流程图节点着色）。
    *
    * @param tasks
    * @returns
    */
    function aggregateStatus(tasks) {
    	if (tasks.length === 0) return "idle";
    	if (tasks.some((task) => task.status === "running")) return "running";
    	if (tasks.some((task) => task.status === "ready")) return "ready";
    	if (tasks.some((task) => task.status === "failed" || task.status === "blocked")) return "failed";
    	if (tasks.some((task) => task.status === "pending")) return "pending";
    	if (tasks.every((task) => task.status === "completed")) return "completed";
    	if (tasks.some((task) => task.status === "cancelled")) return "cancelled";
    	return "completed";
    }
    /**
    * 任务统计：看板卡片与作业列表共用。
    *
    * @param tasks
    * @returns
    */
    function countTasks(tasks) {
    	const counts = {
    		pending: 0,
    		ready: 0,
    		running: 0,
    		completed: 0,
    		failed: 0,
    		blocked: 0,
    		cancelled: 0
    	};
    	for (const task of tasks) {
    		const status = typeof task.status === "string" ? task.status : "pending";
    		counts[status] = (counts[status] ?? 0) + 1;
    	}
    	return counts;
    }
    /**
    * 作业摘要的一行统计文案。
    *
    * @param counts
    * @param t
    * @returns
    */
    function taskCountsText(counts, t) {
    	if (counts === null) return "";
    	const parts = [];
    	if (counts.running) parts.push(`${t("statusRunning")} ${counts.running}`);
    	if (counts.ready) parts.push(`${t("statusReady")} ${counts.ready}`);
    	if (counts.pending) parts.push(`${t("statusPending")} ${counts.pending}`);
    	if (counts.completed) parts.push(`${t("statusCompleted")} ${counts.completed}`);
    	const problem = (counts.failed ?? 0) + (counts.blocked ?? 0) + (counts.cancelled ?? 0);
    	if (problem > 0) parts.push(`${t("statusFailed")} ${problem}`);
    	return parts.join(" · ");
    }
    /**
    * 承办者的展示名。
    *
    * @param claimant
    * @param t
    * @returns
    */
    function claimantName(claimant, t) {
    	if (!isRecord(claimant)) return "";
    	const name = typeof claimant.name === "string" ? claimant.name : "";
    	if (name !== "") return name;
    	return typeof claimant.kind === "string" ? t(actorKindKeySafe(claimant.kind)) : "";
    }
    /**
    * 承办者种类 → 词典 key（避免 format 与 model 相互依赖的重复）。
    *
    * @param kind
    * @returns
    */
    function actorKindKeySafe(kind) {
    	switch (kind) {
    		case "robot": return "actorRobot";
    		case "human": return "actorHuman";
    		case "assistant": return "actorAssistant";
    		default: return "unknown";
    	}
    }
    /**
    * 作业详情里的 `definition` 与工作流定义合并（作业精简版缺 taskTypes 时回退）。
    *
    * @param jobDefinition
    * @param workflowDefinition
    * @returns
    */
    function mergedDefinition(jobDefinition, workflowDefinition) {
    	if (jobDefinition === null) return workflowDefinition;
    	if (workflowDefinition === null) return jobDefinition;
    	const byId = new Map(positionsOf(jobDefinition).map((position) => [position.id, position]));
    	const merged = positionsOf(workflowDefinition).map((position) => {
    		const fromJob = byId.get(position.id);
    		return {
    			id: position.id,
    			label: fromJob?.label ?? position.label,
    			description: position.description,
    			executor: fromJob !== void 0 && Object.keys(fromJob.executor).length > 0 ? fromJob.executor : position.executor,
    			taskTypes: position.taskTypes
    		};
    	});
    	const jobEdges = Array.isArray(jobDefinition.edges) ? jobDefinition.edges : [];
    	const start = jobDefinition.start ?? workflowDefinition.start;
    	const end = jobDefinition.end ?? workflowDefinition.end;
    	return {
    		...workflowDefinition,
    		positions: merged,
    		...jobEdges.length > 0 ? { edges: jobEdges } : workflowDefinition.edges !== void 0 ? { edges: workflowDefinition.edges } : {},
    		...start !== void 0 ? { start } : {},
    		...end !== void 0 ? { end } : {}
    	};
    }
    /**
    * 任务详情里「是不是人任务」。
    *
    * @param state
    * @param task
    * @returns
    */
    function isHumanTask(state, task) {
    	return isHumanPosition(mergedDefinition(currentJobDefinition(state), currentDefinition(state)), task?.position);
    }
    /**
    * 任务详情对应的任务类型定义（抽屉展示 assistant / mode / 产出 schema）。
    *
    * @param state
    * @param task
    * @returns
    */
    function taskTypeOf(state, task) {
    	return findTaskType(currentJobDefinition(state), currentDefinition(state), task?.position, task?.type);
    }
    // .build/workflows/client/components/board.js
    /**
    * 作业看板：行 = 岗位（含开始 / 结束），列 = 排队 / 待认领 / 进行中 / 已完成 / 异常。
    */
    /** 看板列。 */
    const COLUMNS = [
    	{
    		key: "pending",
    		labelKey: "boardColumnPending"
    	},
    	{
    		key: "ready",
    		labelKey: "boardColumnReady"
    	},
    	{
    		key: "running",
    		labelKey: "boardColumnRunning"
    	},
    	{
    		key: "completed",
    		labelKey: "boardColumnCompleted"
    	},
    	{
    		key: "error",
    		labelKey: "boardColumnError"
    	}
    ];
    /**
    * 看板视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderBoard(page) {
    	const { t, state } = page;
    	const tasks = jobTasks(state);
    	if (tasks.length === 0) return renderEmpty(t("boardEmpty"), t("boardEmptyHint"));
    	const rows = boardRows(mergedDefinition(currentJobDefinition(state), currentDefinition(state)), tasks, {
    		start: t("boardStart"),
    		end: t("boardEnd")
    	});
    	return h("div", { className: "buka-workflows-boardPane" }, h("p", { className: "buka-workflows-hint" }, t("boardHint")), h("div", { className: "buka-workflows-board" }, h("div", { className: "buka-workflows-boardGrid" }, h("div", {
    		className: "buka-workflows-boardHeader",
    		role: "row"
    	}, h("div", { className: "buka-workflows-boardRowHead" }, ""), ...COLUMNS.map((column) => h("div", {
    		key: column.key,
    		className: "buka-workflows-boardColumnHead",
    		role: "columnheader"
    	}, t(column.labelKey)))), ...rows.map((row) => {
    		const rowTasks = row.tasks;
    		const counts = countTasks(rowTasks);
    		const cellTasks = /* @__PURE__ */ new Map();
    		for (const task of rowTasks) {
    			const key = boardColumn(task.status);
    			const list = cellTasks.get(key);
    			if (list === void 0) cellTasks.set(key, [task]);
    			else list.push(task);
    		}
    		return h("div", {
    			key: row.id,
    			className: `buka-workflows-boardRow is-${row.kind}`,
    			role: "row"
    		}, h("div", { className: "buka-workflows-boardRowHead" }, h("span", { className: "buka-workflows-boardRowTitle" }, row.label), row.executor === null ? null : h("span", { className: "buka-workflows-boardRowExecutor" }, renderExecutor(page, row.executor)), h("span", { className: "buka-workflows-boardRowMeta" }, rowTasks.length === 0 ? t("boardNoTasks") : fill(t, "taskCount", { n: rowTasks.length }) + (counts.running ? ` · ${t("statusRunning")} ${counts.running}` : ""))), ...COLUMNS.map((column) => {
    			const list = cellTasks.get(column.key) ?? [];
    			return h("div", {
    				key: column.key,
    				className: `buka-workflows-boardCell is-${column.key}`,
    				role: "cell"
    			}, ...list.map((task) => renderBoardCard(page, task)));
    		}));
    	}))));
    }
    /**
    * 看板卡片。
    *
    * @param page
    * @param task
    * @returns React 元素
    */
    function renderBoardCard(page, task) {
    	const { t, actions } = page;
    	const meta = [];
    	if (Array.isArray(task.deps) && task.deps.length > 0) meta.push(fill(t, "boardCardDeps", { n: task.deps.length }));
    	if (typeof task.attemptCount === "number" && task.attemptCount > 1) meta.push(fill(t, "boardCardAttempts", { n: task.attemptCount }));
    	if (typeof task.attachmentCount === "number" && task.attachmentCount > 0) meta.push(fill(t, "boardCardAttachments", { n: task.attachmentCount }));
    	const claimant = claimantName(task.claimant, t);
    	if (task.status === "ready" || task.status === "pending") {
    		const waiting = formatWaiting(task.createdAt);
    		if (waiting !== "") meta.push(fill(t, "boardCardWaiting", { duration: waiting }));
    	}
    	const summary = typeof task.resultSummary === "string" ? task.resultSummary : "";
    	return h("button", {
    		key: task.id,
    		type: "button",
    		className: `buka-workflows-taskCard is-${task.status ?? "pending"}`,
    		onClick: () => actions.openTask(task.id)
    	}, h("span", { className: "buka-workflows-taskCardHead" }, h("span", { className: "buka-workflows-taskCardType" }, task.typeLabel ?? task.type ?? task.id), renderStatusTag(t, task.status, "task")), claimant === "" ? null : h("span", { className: "buka-workflows-taskCardMeta" }, `${t("taskClaimant")}: ${claimant}`), summary === "" ? null : h("span", { className: "buka-workflows-taskCardSummary" }, summary), meta.length === 0 ? null : h("span", { className: "buka-workflows-taskCardMeta" }, meta.join(" · ")), h("span", { className: "buka-workflows-taskCardStatus" }, statusLabel(page.t, task.status)));
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
    // .build/workflows/client/graph/layout.js
    /**
    * 流程图布局：岗位 / 内建开始结束节点按层排布，连线绕行。
    *
    * 这里不依赖宿主一半的 `src/graph.ts`：坐标全部在浏览器侧按定义快照计算，
    * 服务端只给「岗位 + 边 + 任务状态」。
    */
    /** 节点宽度。 */
    const NODE_WIDTH = 208;
    /** 节点高度。 */
    const NODE_HEIGHT = 34;
    /** 同层节点水平间距。 */
    const GAP_X = 28;
    /** 回边绕行需要的右侧额外空间。 */
    const BACK_EXTRA = 72;
    /**
    * 计算分层坐标与连线路径。
    *
    * @param nodes 节点
    * @param rawEdges 边
    * @returns 布局结果
    */
    function layoutGraph(nodes, rawEdges) {
    	const nodeIds = new Set(nodes.map((node) => node.id));
    	const edges = rawEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    	const layers = assignLayers(nodes, edges);
    	const byLayer = /* @__PURE__ */ new Map();
    	for (const node of nodes) {
    		const layer = layers.get(node.id) ?? 0;
    		const group = byLayer.get(layer);
    		if (group === void 0) byLayer.set(layer, [node]);
    		else group.push(node);
    	}
    	const layerKeys = [...byLayer.keys()].sort((left, right) => left - right);
    	const width = Math.max(NODE_WIDTH, ...layerKeys.map((layer) => {
    		const count = byLayer.get(layer)?.length ?? 0;
    		return count * NODE_WIDTH + Math.max(0, count - 1) * GAP_X;
    	})) + 40 + BACK_EXTRA;
    	const height = layerKeys.length === 0 ? 74 : (layerKeys.length - 1) * 108 + NODE_HEIGHT + 40;
    	const byId = /* @__PURE__ */ new Map();
    	const laidOut = [];
    	layerKeys.forEach((layer, index) => {
    		const group = byLayer.get(layer) ?? [];
    		const groupWidth = group.length * NODE_WIDTH + Math.max(0, group.length - 1) * GAP_X;
    		const startX = (width - groupWidth) / 2;
    		const y = 37 + index * 108;
    		group.forEach((node, position) => {
    			const x = startX + NODE_WIDTH / 2 + position * 236;
    			const laid = {
    				...node,
    				x,
    				y,
    				layer,
    				width: NODE_WIDTH,
    				height: NODE_HEIGHT
    			};
    			laidOut.push(laid);
    			byId.set(node.id, laid);
    		});
    	});
    	const laidOutEdges = [];
    	const usedKeys = /* @__PURE__ */ new Map();
    	for (const edge of edges) {
    		const from = byId.get(edge.from);
    		const to = byId.get(edge.to);
    		if (from === void 0 || to === void 0) continue;
    		const back = edge.back === true || to.layer <= from.layer;
    		const baseKey = `${edge.from}->${edge.to}`;
    		const seen = usedKeys.get(baseKey) ?? 0;
    		usedKeys.set(baseKey, seen + 1);
    		const key = seen === 0 ? baseKey : `${baseKey}#${seen}`;
    		const types = Array.isArray(edge.types) ? edge.types.filter((type) => typeof type === "string") : [];
    		const label = types.length > 0 ? types.join(", ") : back ? "" : "";
    		laidOutEdges.push({
    			key,
    			from: edge.from,
    			to: edge.to,
    			kind: back ? "back" : "forward",
    			label,
    			...edgeGeometry(from, to, back)
    		});
    	}
    	return {
    		width,
    		height,
    		nodeWidth: NODE_WIDTH,
    		nodeHeight: NODE_HEIGHT,
    		nodes: laidOut,
    		edges: laidOutEdges
    	};
    }
    /**
    * 最长路径分层：开始节点固定第 0 层，结束节点固定最后一层；回边不参与分层。
    *
    * @param nodes
    * @param edges
    * @returns 节点 id → 层号
    */
    function assignLayers(nodes, edges) {
    	const layers = /* @__PURE__ */ new Map();
    	const first = nodes[0];
    	if (nodes.some((node) => node.id === "start")) layers.set("start", 0);
    	else if (first !== void 0) layers.set(first.id, 0);
    	const forward = edges.filter((edge) => edge.back !== true);
    	for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    		let changed = false;
    		for (const edge of forward) {
    			const fromLayer = layers.get(edge.from);
    			if (fromLayer === void 0) continue;
    			const next = fromLayer + 1;
    			const current = layers.get(edge.to);
    			if (current === void 0 || current < next) {
    				layers.set(edge.to, next);
    				changed = true;
    			}
    		}
    		if (!changed) break;
    	}
    	if (nodes.some((node) => node.id === "end")) {
    		let maxLayer = 0;
    		for (const [id, layer] of layers) if (id !== "end") maxLayer = Math.max(maxLayer, layer);
    		layers.set("end", maxLayer + 1);
    	}
    	for (const node of nodes) if (!layers.has(node.id)) layers.set(node.id, node.id === "start" ? 0 : 1);
    	return layers;
    }
    /**
    * 一条边的路径与箭头位置。
    *
    * @param from
    * @param to
    * @param back
    * @returns
    */
    function edgeGeometry(from, to, back) {
    	if (!back) {
    		const x1 = from.x;
    		const y1 = from.y + from.height / 2;
    		const x2 = to.x;
    		const y2 = to.y - to.height / 2;
    		const control = Math.max(24, (y2 - y1) / 2);
    		const p0 = {
    			x: x1,
    			y: y1
    		};
    		const p1 = {
    			x: x1,
    			y: y1 + control
    		};
    		const p2 = {
    			x: x2,
    			y: y2 - control
    		};
    		const p3 = {
    			x: x2,
    			y: y2
    		};
    		const point = cubicPoint(p0, p1, p2, p3, .55);
    		const tangent = cubicTangent(p0, p1, p2, p3, .55);
    		return {
    			d: `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`,
    			arrow: {
    				x: point.x,
    				y: point.y,
    				angle: angleOf(tangent)
    			}
    		};
    	}
    	const x1 = from.x + from.width / 2;
    	const y1 = from.y;
    	const x2 = to.x + to.width / 2;
    	const y2 = to.y;
    	const reach = Math.max(x1, x2) + 56;
    	const p0 = {
    		x: x1,
    		y: y1
    	};
    	const p1 = {
    		x: reach,
    		y: y1
    	};
    	const p2 = {
    		x: reach,
    		y: y2
    	};
    	const p3 = {
    		x: x2,
    		y: y2
    	};
    	const point = cubicPoint(p0, p1, p2, p3, .5);
    	const tangent = cubicTangent(p0, p1, p2, p3, .5);
    	return {
    		d: `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`,
    		arrow: {
    			x: point.x,
    			y: point.y,
    			angle: angleOf(tangent)
    		}
    	};
    }
    /** 三次贝塞尔取点。 */
    function cubicPoint(p0, p1, p2, p3, t) {
    	const mt = 1 - t;
    	return {
    		x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    		y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
    	};
    }
    /** 三次贝塞尔切线。 */
    function cubicTangent(p0, p1, p2, p3, t) {
    	const mt = 1 - t;
    	return {
    		x: 3 * mt ** 2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x),
    		y: 3 * mt ** 2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y)
    	};
    }
    /** 切线 → 角度（度）。 */
    function angleOf(vector) {
    	return Math.atan2(vector.y, vector.x) * 180 / Math.PI;
    }
    /** 数字保留两位小数，减少 DOM 字符串抖动。 */
    function fmt(value) {
    	return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    // .build/workflows/client/graph/render.js
    /**
    * 流程图渲染：SVG 连线 + 绝对定位的胶囊节点。
    */
    /**
    * 画一张流程图。节点是岗位 / 开始 / 结束，边是定义里的白名单与回边。
    *
    * @param page
    * @param options
    * @returns React 元素
    */
    function renderWorkflowGraph(page, options) {
    	const { t } = page;
    	const layout = layoutGraph(options.nodes, options.edges);
    	const selectedId = options.selectedId ?? null;
    	const onNodeClick = options.onNodeClick ?? null;
    	const idle = layout.nodes.every((node) => (node.status ?? "idle") === "idle");
    	return h("div", { className: "buka-workflows-graphPane" }, h("div", {
    		className: "buka-workflows-vgraph",
    		style: {
    			width: `${layout.width}px`,
    			height: `${layout.height}px`
    		},
    		role: "group",
    		"aria-label": t("graphAria")
    	}, h("svg", {
    		className: "buka-workflows-vgraphSvg",
    		width: layout.width,
    		height: layout.height,
    		viewBox: `0 0 ${layout.width} ${layout.height}`
    	}, ...layout.edges.map((edge) => h("path", {
    		key: edge.key,
    		className: `buka-workflows-edge is-${edge.kind}`,
    		d: edge.d
    	})), ...layout.edges.map((edge) => h("g", {
    		key: `arrow-${edge.key}`,
    		className: `buka-workflows-edgeArrow is-${edge.kind}`,
    		transform: `translate(${edge.arrow.x} ${edge.arrow.y}) rotate(${edge.arrow.angle})`
    	}, h("path", { d: "M-4,-3.6 L4,0 L-4,3.6 Z" })))), ...layout.nodes.map((node) => {
    		const isSelected = selectedId === node.id;
    		const status = node.status ?? "idle";
    		const clickable = onNodeClick !== null;
    		const tag = node.kind === "position" ? node.executor?.kind === "human" ? "is-human" : "is-robot" : node.kind === "start" ? "is-start" : "is-end";
    		return h("div", {
    			key: node.id,
    			className: "buka-workflows-vgraphNode",
    			style: {
    				left: `${node.x - node.width / 2}px`,
    				top: `${node.y - node.height / 2}px`,
    				width: `${node.width}px`,
    				height: `${node.height}px`
    			}
    		}, clickable ? h("button", {
    			type: "button",
    			className: `buka-workflows-capsule ${tag} is-${stateClass(status)}${idle ? " is-idle" : ""}${isSelected ? " is-selected" : ""}${typeof node.avatar === "string" && node.avatar !== "" ? " has-avatar" : ""}`,
    			title: node.title ?? node.label,
    			"aria-pressed": isSelected,
    			onClick: () => onNodeClick(node.id)
    		}, renderAvatar(node.avatar, 20, "buka-workflows-capsuleAvatar"), h("span", { className: "buka-workflows-capsuleText" }, h("span", { className: "buka-workflows-capsuleLabel" }, node.label), typeof node.meta === "string" && node.meta !== "" ? h("span", { className: "buka-workflows-capsuleMeta" }, node.meta) : null)) : h("span", {
    			className: `buka-workflows-capsule ${tag} is-${stateClass(status)}${idle ? " is-idle" : ""}${typeof node.avatar === "string" && node.avatar !== "" ? " has-avatar" : ""}`,
    			title: node.title ?? node.label
    		}, renderAvatar(node.avatar, 20, "buka-workflows-capsuleAvatar"), h("span", { className: "buka-workflows-capsuleText" }, h("span", { className: "buka-workflows-capsuleLabel" }, node.label), typeof node.meta === "string" && node.meta !== "" ? h("span", { className: "buka-workflows-capsuleMeta" }, node.meta) : null)));
    	})), options.caption === null || options.caption === void 0 ? null : h("p", { className: "buka-workflows-hint buka-workflows-graphCaption" }, options.caption), renderGraphLegend(page));
    }
    /**
    * 图例：节点类型、任务状态、连线。
    *
    * @param page
    * @returns
    */
    function renderGraphLegend(page) {
    	const { t } = page;
    	const types = [
    		["is-start", t("graphStart")],
    		["is-robot", t("graphRobot")],
    		["is-human", t("graphHuman")],
    		["is-end", t("graphEnd")]
    	];
    	const states = [
    		["done", t("statusCompleted")],
    		["running", t("statusRunning")],
    		["waiting", t("statusReady")],
    		["failed", t("statusFailed")],
    		["idle", t("graphIdle")]
    	];
    	const edges = [["forward", t("graphEdgeForward")], ["back", t("graphEdgeBack")]];
    	return h("div", { className: "buka-workflows-legend" }, h("span", { className: "buka-workflows-legendGroup" }, h("span", { className: "buka-workflows-legendTitle" }, t("graphLegendTypes")), ...types.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendCapsule ${kind}`,
    		"aria-hidden": true
    	}), label))), h("span", { className: "buka-workflows-legendGroup" }, h("span", { className: "buka-workflows-legendTitle" }, t("graphLegendStates")), ...states.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendDot is-${kind}`,
    		"aria-hidden": true
    	}), label))), h("span", { className: "buka-workflows-legendGroup" }, h("span", { className: "buka-workflows-legendTitle" }, t("graphLegendEdges")), ...edges.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendLine is-${kind}`,
    		"aria-hidden": true
    	}), label))));
    }
    // .build/workflows/client/components/job-graph.js
    /**
    * 作业流程图：同一份任务数据按岗位汇总状态后画在定义图上。
    */
    /**
    * 作业流程图视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderJobGraph(page) {
    	const { t, state, actions } = page;
    	const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state));
    	const tasks = jobTasks(state);
    	const positions = positionsOf(definition);
    	/** 某个节点的任务。 */
    	function tasksOf(positionId) {
    		return tasks.filter((task) => task.position === positionId);
    	}
    	/** 节点徽标：已完成 / 总数。 */
    	function metaOf(positionId) {
    		const list = tasksOf(positionId);
    		if (list.length === 0) return "";
    		return `${list.filter((task) => task.status === "completed").length}/${list.length}`;
    	}
    	/** 点节点：打开该岗位最近活动的任务。 */
    	function openFirst(positionId) {
    		const list = tasksOf(positionId);
    		for (const status of [
    			"running",
    			"ready",
    			"pending",
    			"failed",
    			"blocked",
    			"completed",
    			"cancelled"
    		]) {
    			const found = list.find((task) => task.status === status);
    			if (found !== void 0) {
    				actions.openTask(found.id);
    				return;
    			}
    		}
    	}
    	return renderWorkflowGraph(page, {
    		nodes: [
    			{
    				id: "start",
    				label: t("boardStart"),
    				kind: "start",
    				status: aggregateStatus(tasksOf("start")),
    				meta: metaOf("start")
    			},
    			...positions.map((position) => {
    				const id = position.id;
    				const avatar = position.executor.avatar;
    				return {
    					id,
    					label: position.label,
    					kind: "position",
    					executor: position.executor,
    					...typeof avatar === "string" && avatar !== "" ? { avatar } : {},
    					status: aggregateStatus(tasksOf(id)),
    					meta: metaOf(id),
    					title: `${id} · ${t("tasksTablePosition")}`
    				};
    			}),
    			{
    				id: "end",
    				label: t("boardEnd"),
    				kind: "end",
    				status: aggregateStatus(tasksOf("end")),
    				meta: metaOf("end")
    			}
    		],
    		edges: edgesOf(definition).map((edge) => ({
    			from: edge.from,
    			to: edge.to,
    			types: edge.types,
    			back: edge.back
    		})),
    		onNodeClick: openFirst,
    		caption: t("jobGraphHint")
    	});
    }
    // .build/workflows/client/components/task-list.js
    /**
    * 作业的任务列表视图。
    */
    /**
    * 任务列表视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderTaskList(page) {
    	const { t, state, actions } = page;
    	const tasks = sortTasks(jobTasks(state));
    	if (tasks.length === 0) return renderEmpty(t("tasksEmpty"), t("boardEmptyHint"));
    	const positions = positionsOf(mergedDefinition(currentJobDefinition(state), currentDefinition(state)));
    	const positionLabel = (id) => {
    		if (id === "start") return t("boardStart");
    		if (id === "end") return t("boardEnd");
    		const found = positions.find((position) => position.id === id);
    		return found === void 0 ? String(id ?? "") : found.label;
    	};
    	return h("div", { className: "buka-workflows-tablePane" }, h("p", { className: "buka-workflows-hint" }, t("tasksHint")), h("table", { className: "buka-workflows-table" }, h("thead", null, h("tr", null, h("th", null, t("tasksTableType")), h("th", null, t("tasksTablePosition")), h("th", null, t("tasksTableStatus")), h("th", null, t("tasksTableClaimant")), h("th", null, t("tasksTableCreated")))), h("tbody", null, ...tasks.map((task) => h("tr", {
    		key: task.id,
    		className: "buka-workflows-tableRow",
    		tabIndex: 0,
    		onClick: () => actions.openTask(task.id),
    		onKeyDown: (event) => {
    			if (event.key !== "Enter" && event.key !== " ") return;
    			event.preventDefault();
    			actions.openTask(task.id);
    		}
    	}, h("td", null, task.typeLabel ?? task.type ?? task.id), h("td", null, task.position === void 0 ? "" : positionLabel(task.position)), h("td", null, renderStatusTag(t, task.status, "task")), h("td", null, claimantName(task.claimant, t) || statusLabel(t, "unknown")), h("td", { className: "buka-workflows-tableTime" }, formatTime(task.createdAt)))))));
    }
    // .build/workflows/client/components/timeline.js
    /**
    * 作业时间线：由作业与任务的时间戳派生（不额外请求事件表）。
    */
    /**
    * 时间线视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderTimeline(page) {
    	const { t, state } = page;
    	const job = state.job.data?.job;
    	const tasks = jobTasks(state);
    	const positions = positionsOf(mergedDefinition(currentJobDefinition(state), currentDefinition(state)));
    	const positionLabel = (id) => {
    		if (id === "start") return t("boardStart");
    		if (id === "end") return t("boardEnd");
    		const found = positions.find((position) => position.id === id);
    		return found === void 0 ? String(id ?? "") : found.label;
    	};
    	const events = [];
    	/**
    	* @param key
    	* @param value 时间
    	* @param label
    	* @param detail
    	* @param tone
    	*/
    	function push(key, value, label, detail, tone = "neutral") {
    		const date = toDate(value);
    		if (date === null) return;
    		events.push({
    			key,
    			at: date.getTime(),
    			label,
    			detail,
    			tone
    		});
    	}
    	push("job-created", job?.createdAt, t("timelineJobCreated"), t("jobTitle"), "info");
    	for (const task of tasks) {
    		const name = `${task.typeLabel ?? task.type ?? task.id} · ${positionLabel(task.position)}`;
    		push(`task-created-${task.id}`, task.createdAt, t("timelineTaskCreated"), name);
    		push(`task-started-${task.id}`, task.startedAt, t("timelineTaskStarted"), name, "info");
    		if (task.status === "failed" || task.status === "blocked") push(`task-failed-${task.id}`, task.finishedAt, t("timelineTaskFailed"), name, "warning");
    		else if (task.status === "cancelled") push(`task-cancelled-${task.id}`, task.finishedAt, t("timelineTaskCancelled"), name, "warning");
    		else push(`task-finished-${task.id}`, task.finishedAt, t("timelineTaskFinished"), name, "success");
    	}
    	push("job-updated", job?.updatedAt, t("timelineJobUpdated"), "", "neutral");
    	events.sort((left, right) => left.at - right.at || left.key.localeCompare(right.key));
    	if (events.length === 0) return renderEmpty(t("timelineEmpty"));
    	return h("ol", { className: "buka-workflows-timeline" }, ...events.map((event) => h("li", {
    		key: event.key,
    		className: `buka-workflows-timelineItem is-${event.tone}`
    	}, h("span", {
    		className: "buka-workflows-timelineDot",
    		"aria-hidden": true
    	}), h("div", { className: "buka-workflows-timelineBody" }, h("div", { className: "buka-workflows-timelineHead" }, h("span", { className: "buka-workflows-timelineLabel" }, event.label), h("span", { className: "buka-workflows-timelineTime" }, formatTime(event.at))), event.detail === "" ? null : h("span", { className: "buka-workflows-timelineDetail" }, event.detail)))));
    }
    // .build/workflows/client/components/job-detail.js
    /**
    * 作业详情：头部摘要 + 看板 / 流程图 / 任务 / 附件库 / 时间线五个视图。
    */
    /**
    * 作业详情视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderJobDetail(page) {
    	const { t, state, actions } = page;
    	const loaded = state.job;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.data === null) return renderLoading(page);
    	const job = loaded.data.job;
    	if (job === void 0) return renderEmpty(t("notFound"));
    	const tasks = jobTasks(state);
    	const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state));
    	const needsDeliveryRetry = job.status === "running" && tasks.some((task) => task.position === "end" && task.status === "ready");
    	const starter = isRecord(job.starter) ? job.starter : null;
    	return h("div", { className: "buka-workflows-detail" }, h("div", { className: "buka-workflows-jobHead" }, h("div", { className: "buka-workflows-jobTitleGroup" }, h("span", { className: "buka-workflows-seq" }, fill(t, "jobSeq", { seq: job.seq ?? 0 })), h("h2", { className: "buka-workflows-jobTitle" }, job.workflowName ?? job.workflowId ?? t("jobTitle")), typeof job.workflowVersion === "number" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `v${job.workflowVersion}`) : null, renderStatusTag(t, job.status, "job")), h("div", { className: "buka-workflows-jobMeta" }, `${t("jobCreatedAt")} ${formatTime(job.createdAt)}`, ` · ${t("jobUpdatedAt")} ${formatTime(job.updatedAt)}`, starter === null ? "" : ` · ${t("starter")}: ${starter.kind === "session" ? `${t("starterSession")}${typeof starter.sessionId === "string" ? ` ${starter.sessionId}` : ""}` : t("starterHuman")}`), starter !== null && starter.kind === "session" && typeof starter.sessionId === "string" && starter.sessionId !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.openSession(starter.sessionId)
    	}, t("openStarterSession")) : null), needsDeliveryRetry ? h("div", {
    		className: "buka-workflows-deliveryNotice",
    		role: "status"
    	}, h("p", { className: "buka-workflows-warn" }, t("deliveryRetryHint")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		onClick: () => void actions.retryDelivery(),
    		disabled: state.busy === "retry-delivery"
    	}, t("retryDelivery"))) : null, job.error === null || job.error === void 0 ? null : renderSection(t("jobErrorTitle"), h("pre", { className: "buka-workflows-pre" }, jsonText(job.error))), renderSection(t("jobInput"), h("pre", { className: "buka-workflows-pre is-tall" }, jsonText(job.input ?? {}))), h("div", { className: "buka-workflows-viewTabs" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workflows-tabList",
    		label: t("jobViewsAria"),
    		value: state.jobView,
    		onChange: (value) => actions.setJobView(value),
    		items: [
    			{
    				value: "board",
    				labelKey: "boardTab"
    			},
    			{
    				value: "graph",
    				labelKey: "graphTab"
    			},
    			{
    				value: "tasks",
    				labelKey: "tasksTab"
    			},
    			{
    				value: "attachments",
    				labelKey: "attachmentsTab"
    			},
    			{
    				value: "timeline",
    				labelKey: "timelineTab"
    			}
    		].map((tab) => ({
    			value: tab.value,
    			label: t(tab.labelKey),
    			id: `buka-workflows-tab-${tab.value}`,
    			panelId: `buka-workflows-panel-${tab.value}`
    		}))
    	})), h("div", { className: "buka-workflows-viewBody" }, state.jobView === "board" ? renderBoard(page) : state.jobView === "graph" ? renderJobGraph(page) : state.jobView === "tasks" ? renderTaskList(page) : state.jobView === "attachments" ? renderAttachments(page) : renderTimeline(page)), definition === null ? h("p", { className: "buka-workflows-hint" }, t("definitionMissing")) : null);
    }
    // .build/workflows/client/components/new-job-dialog.js
    /**
    * 新建作业对话框：人启动 = 原始输入 + 结构化输入。
    */
    /**
    * 新建作业对话框。
    *
    * @param page
    * @returns React 元素
    */
    function renderNewJobDialog(page) {
    	const { t, state, actions } = page;
    	const dialog = state.newJob;
    	const start = currentDefinition(state)?.start?.task;
    	const rawSchema = isRecord(start?.payload) ? start.payload : null;
    	const structuredSchema = isRecord(start?.output) ? start.output : null;
    	const rawHasFields = schemaFields(rawSchema).length > 0;
    	const structuredHasFields = schemaFields(structuredSchema).length > 0;
    	const body = [
    		h("p", { className: "buka-workflows-hint" }, t("newJobHint")),
    		h("div", { className: "buka-workflows-field" }, h("span", { className: "buka-workflows-fieldLabel" }, t("newJobRawTitle")), h("p", { className: "buka-workflows-fieldHint" }, t("newJobRawHint"))),
    		...rawHasFields ? renderSchemaFields(page, {
    			schema: rawSchema,
    			values: dialog.raw,
    			onChange: actions.setNewJobRaw,
    			idPrefix: "buka-workflows-newjob-raw"
    		}) : [h("div", {
    			key: "raw-fallback",
    			className: "buka-workflows-field"
    		}, h("label", {
    			className: "buka-workflows-fieldLabel",
    			htmlFor: "buka-workflows-newjob-raw-request"
    		}, t("newJobRawFallback")), h("textarea", {
    			id: "buka-workflows-newjob-raw-request",
    			className: "buka-workflows-textarea",
    			rows: 3,
    			value: dialog.raw.request ?? "",
    			onChange: (event) => actions.setNewJobRaw("request", event.target.value)
    		}))],
    		h("div", { className: "buka-workflows-field" }, h("span", { className: "buka-workflows-fieldLabel" }, t("newJobStructuredTitle")), h("p", { className: "buka-workflows-fieldHint" }, t("newJobStructuredHint"))),
    		...structuredHasFields ? renderSchemaFields(page, {
    			schema: structuredSchema,
    			values: dialog.structured,
    			onChange: actions.setNewJobStructured,
    			idPrefix: "buka-workflows-newjob-structured"
    		}) : [renderJsonFallback(page, dialog.structured.__json ?? "", (next) => actions.setNewJobStructured("__json", next), "buka-workflows-newjob-structured-json")],
    		dialog.error === null ? null : h("p", {
    			className: "buka-workflows-formError",
    			role: "alert"
    		}, dialog.error)
    	];
    	return h(ClientModal, {
    		open: dialog.open,
    		onClose: actions.closeNewJob,
    		title: t("newJobTitle"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: actions.closeNewJob,
    			disabled: dialog.submitting
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "button",
    			onClick: actions.submitNewJob,
    			disabled: dialog.submitting
    		}, dialog.submitting ? t("newJobSubmitting") : t("newJobSubmit")))
    	}, h("div", { className: "buka-workflows-dialogForm" }, ...body));
    }
    // .build/workflows/client/components/task-form.js
    /**
    * 任务结果表单：按任务类型的 `output` schema 渲染（人任务 / 认领后提交共用）。
    */
    /**
    * 渲染结果表单：schema 字段 + 说明 + 错误提示。
    *
    * @param page
    * @param task
    * @returns React 元素数组
    */
    function renderTaskForm(page, task) {
    	const { t, state, actions } = page;
    	const workflowDefinition = currentDefinition(state);
    	const schema = outputSchemaFor(mergedDefinition(currentJobDefinition(state), workflowDefinition), workflowDefinition, task);
    	const form = state.taskForm;
    	const elements = [];
    	if (schemaFields(schema).length > 0) elements.push(...renderSchemaFields(page, {
    		schema,
    		values: form.values,
    		onChange: actions.setTaskField,
    		idPrefix: `buka-workflows-task-${task.id}`
    	}));
    	else elements.push(h("p", {
    		className: "buka-workflows-hint",
    		key: "no-schema"
    	}, t("actionFormNoSchema")), renderJsonFallback(page, form.values.__json ?? "", (next) => actions.setTaskField("__json", next), `buka-workflows-task-${task.id}-json`));
    	elements.push(h("div", {
    		key: "text",
    		className: "buka-workflows-field"
    	}, h("label", {
    		className: "buka-workflows-fieldLabel",
    		htmlFor: `buka-workflows-task-${task.id}-text`
    	}, t("actionTextLabel")), h("textarea", {
    		id: `buka-workflows-task-${task.id}-text`,
    		className: "buka-workflows-textarea",
    		rows: 2,
    		value: form.text,
    		onChange: (event) => actions.setTaskText(event.target.value)
    	})));
    	if (form.error !== null) elements.push(h("p", {
    		key: "error",
    		className: "buka-workflows-formError",
    		role: "alert"
    	}, form.error));
    	return elements;
    }
    // .build/workflows/client/components/task-drawer.js
    /**
    * 任务抽屉：payload、依赖、执行记录、结果、附件与按 `allowedActions` 展示的操作。
    */
    /**
    * 任务详情抽屉。
    *
    * @param page
    * @returns React 元素；没有打开任务时为 null
    */
    function renderTaskDrawer(page) {
    	const { t, state, actions } = page;
    	if (state.taskId === null) return null;
    	const loaded = state.task;
    	const body = [];
    	if (loaded.error !== null && loaded.data === null) body.push(renderFailure(page, loaded.error, actions.refresh));
    	else if (loaded.data === null) body.push(renderLoading(page));
    	else body.push(...renderTaskBody(page, loaded.data));
    	const task = loaded.data;
    	const title = task === null ? t("taskDrawerTitle") : `${task.typeLabel ?? task.type ?? task.id}`;
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: actions.closeTask,
    		title,
    		closeLabel: t("close"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer"
    	}, h("div", { className: "buka-workflows-drawerHead" }, h("div", { className: "buka-workflows-drawerTitleRow" }, h("span", { className: "buka-workflows-drawerTitle" }, title), task === null ? null : renderStatusTag(t, task.status, "task")), task === null ? null : h("span", { className: "buka-workflows-drawerMeta" }, `${t("taskId")}: ${task.id}`), h("div", { className: "buka-workflows-drawerActions" }, task === null ? null : renderSessionButton(page, task), h("button", {
    		type: "button",
    		className: "buka-workflows-drawerClose",
    		"aria-label": t("close"),
    		title: t("close"),
    		onClick: actions.closeTask
    	}, h("span", { "aria-hidden": true }, "×")))), h("div", { className: "buka-workflows-drawerBody" }, ...body));
    }
    /**
    * 抽屉正文。
    *
    * @param page
    * @param task
    * @returns
    */
    function renderTaskBody(page, task) {
    	const { t, state, actions } = page;
    	const positionLabel = typeof task.positionLabel === "string" && task.positionLabel !== "" ? task.positionLabel : task.position ?? "";
    	const typeDefinition = taskTypeOf(state, task);
    	const claimant = claimantName(task.claimant, t);
    	const allowed = Array.isArray(task.allowedActions) ? task.allowedActions : [];
    	const human = isHumanTask(state, task);
    	const canClaim = allowed.includes("claim") && task.status === "ready";
    	const canComplete = allowed.includes("complete");
    	const showForm = human && (task.status === "ready" || task.status === "running") && allowed.length > 0;
    	const elements = [];
    	elements.push(renderKv([
    		[t("taskPosition"), positionLabel === "" ? t("taskTypeUnset") : positionLabel],
    		[t("taskType"), task.typeLabel ?? task.type ?? t("taskTypeUnset")],
    		[t("taskStatus"), statusLabel(t, task.status)],
    		[t("taskClaimant"), claimant === "" ? t("taskTypeUnset") : claimant],
    		[t("taskCreatedAt"), formatTime(task.createdAt)],
    		[t("taskStartedAt"), formatTime(task.startedAt)],
    		[t("taskFinishedAt"), formatTime(task.finishedAt)],
    		[t("taskTypeAssistant"), isRecord(typeDefinition) && typeof typeDefinition.assistant === "string" ? typeDefinition.assistant : t("taskTypeUnset")]
    	]));
    	if (typeof task.typeDescription === "string" && task.typeDescription !== "") elements.push(h("p", {
    		key: "type-desc",
    		className: "buka-workflows-hint"
    	}, task.typeDescription));
    	const deps = Array.isArray(task.deps) ? task.deps : [];
    	elements.push(renderSection(t("taskDepsTitle"), deps.length === 0 ? renderEmpty(t("taskDepsEmpty")) : h("ul", { className: "buka-workflows-depList" }, ...deps.map((dep) => h("li", {
    		key: dep.id,
    		className: "buka-workflows-depRow"
    	}, h("button", {
    		type: "button",
    		className: "buka-workflows-depLink",
    		onClick: () => actions.openTask(dep.id)
    	}, dep.typeLabel ?? dep.type ?? dep.id), renderStatusTag(t, dep.status, "task"), dep.resultSummary === null || dep.resultSummary === void 0 ? null : h("span", { className: "buka-workflows-depSummary" }, dep.resultSummary))))));
    	elements.push(renderSection(t("taskPayloadTitle"), renderJsonBlock(task.payload ?? null, t("taskPayloadEmpty"))));
    	const attempts = Array.isArray(task.attempts) ? task.attempts : [];
    	elements.push(renderSection(t("taskAttemptsTitle"), attempts.length === 0 ? renderEmpty(t("taskAttemptsEmpty")) : h("ul", { className: "buka-workflows-attemptList" }, ...attempts.map((attempt) => renderAttempt(page, attempt)))));
    	elements.push(renderSection(t("taskResultTitle"), renderTaskResult(page, task)));
    	const actionsList = [];
    	if (canClaim) actionsList.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "claim",
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.runTaskAction("claim"),
    		disabled: state.taskForm.submitting
    	}, t("actionClaim")));
    	if (allowed.includes("retry")) actionsList.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "retry",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.runTaskAction("retry"),
    		disabled: state.taskForm.submitting
    	}, t("actionRetry")));
    	if (allowed.includes("cancel")) actionsList.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "cancel",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => {
    			if (typeof window !== "undefined" && typeof window.confirm === "function") {
    				if (!window.confirm(t("actionCancelConfirm"))) return;
    			}
    			actions.runTaskAction("cancel");
    		},
    		disabled: state.taskForm.submitting
    	}, t("actionCancel")));
    	const actionBlock = [];
    	if (showForm) actionBlock.push(renderSection(t("actionFormTitle"), h("div", { className: "buka-workflows-taskForm" }, h("p", { className: "buka-workflows-hint" }, t("actionFormHint")), ...renderTaskForm(page, task), h("div", { className: "buka-workflows-formActions" }, ...actionsList, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.runTaskAction("complete"),
    		disabled: state.taskForm.submitting || !canComplete
    	}, state.taskForm.submitting ? t("actionSubmitting") : t("actionSubmitComplete"))))));
    	else if (actionsList.length > 0) actionBlock.push(renderSection(t("taskActionsTitle"), h("div", { className: "buka-workflows-formActions" }, ...actionsList)));
    	else if (allowed.includes("complete")) actionBlock.push(renderSection(t("taskActionsTitle"), h("div", { className: "buka-workflows-formActions" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.runTaskAction("complete"),
    		disabled: state.taskForm.submitting
    	}, t("actionSubmitComplete")))));
    	else actionBlock.push(renderSection(t("taskActionsTitle"), renderEmpty(t("taskActionsEmpty"))));
    	elements.push(...actionBlock);
    	if (task.position === "end") elements.unshift(renderSection(t("finalDeliverableTitle"), renderJsonBlock(task.payload ?? null, t("taskPayloadEmpty"))));
    	if (typeof task.claimant?.sessionId === "string" && task.claimant.sessionId !== "") elements.unshift(h("div", {
    		key: "session",
    		className: "buka-workflows-sessionBar"
    	}, h("span", { className: "buka-workflows-label" }, t("sessionLabel")), h("code", { className: "buka-workflows-inlineCode" }, task.claimant.sessionId), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.openSession(task.claimant?.sessionId)
    	}, t("openSession"))));
    	return elements;
    }
    /**
    * 执行记录的一行。
    *
    * @param page
    * @param attempt
    * @returns
    */
    function renderAttempt(page, attempt) {
    	const { t, actions } = page;
    	const meta = [formatTime(attempt.startedAt), attempt.finishedAt === null || attempt.finishedAt === void 0 ? "" : formatTime(attempt.finishedAt)].filter((part) => part !== "");
    	const error = attempt.error === null || attempt.error === void 0 ? "" : jsonText(attempt.error);
    	return h("li", {
    		key: attempt.id,
    		className: "buka-workflows-attempt"
    	}, h("div", { className: "buka-workflows-attemptHead" }, h("code", { className: "buka-workflows-inlineCode" }, attempt.id), renderStatusTag(t, attempt.status, "task"), attempt.stopReason === null || attempt.stopReason === void 0 ? null : h("span", { className: "buka-workflows-attemptMeta" }, `${t("taskAttemptStopReason")}: ${String(attempt.stopReason)}`), h("span", { className: "buka-workflows-attemptMeta" }, meta.join(" · "))), typeof attempt.sessionId === "string" && attempt.sessionId !== "" ? h("div", { className: "buka-workflows-sessionRow" }, h("span", { className: "buka-workflows-attemptMeta" }, `${t("sessionLabel")}: ${attempt.sessionId}`), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.openSession(attempt.sessionId)
    	}, t("openSession"))) : null, error === "" ? null : h("p", { className: "buka-workflows-failure" }, `${t("taskAttemptError")}: ${error}`));
    }
    /**
    * 结果区：文本 + 结构化产出 + 附件。
    *
    * @param page
    * @param task
    * @returns
    */
    function renderTaskResult(page, task) {
    	const { t, actions } = page;
    	const result = isRecord(task.result) ? task.result : null;
    	if (result === null) return renderEmpty(t("taskResultEmpty"));
    	const text = typeof result.text === "string" ? result.text : "";
    	const output = result.output;
    	const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    	return h("div", { className: "buka-workflows-result" }, text === "" ? null : renderSection(t("taskResultText"), h("pre", { className: "buka-workflows-pre" }, text)), output === void 0 || output === null ? null : renderSection(t("taskResultOutput"), renderJsonBlock(output, t("taskResultEmpty"))), attachments.length === 0 ? null : renderSection(t("taskResultAttachments"), h("ul", { className: "buka-workflows-attachmentList" }, ...attachments.map((attachment) => {
    		const name = typeof attachment.name === "string" ? attachment.name : String(attachment.id);
    		return h("li", {
    			key: String(attachment.id),
    			className: "buka-workflows-attachment"
    		}, renderAttachmentLink(page, attachment, actions.openAttachment), h("span", { className: "buka-workflows-attachmentMeta" }, [formatBytes(attachment.bytes), attachment.mime].filter(Boolean).join(" · ")), typeof attachment.description === "string" && attachment.description !== "" ? h("span", { className: "buka-workflows-attachmentDescription" }, attachment.description) : null, h("a", {
    			className: "buka-workflows-attachmentDownload",
    			href: attachmentUrl(jobIdOf(page), attachment.id),
    			download: name
    		}, t("attachmentDownload")));
    	}))));
    }
    /**
    * 任务抽屉头部右侧的会话入口（承办者会话）。
    *
    * @param page
    * @param task
    * @returns
    */
    function renderSessionButton(page, task) {
    	const sessionId = task.claimant?.sessionId;
    	if (typeof sessionId !== "string" || sessionId === "") return null;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void page.actions.openSession(sessionId)
    	}, page.t("openSession"));
    }
    /**
    * 当前作业 id。
    *
    * @param page
    * @returns
    */
    function jobIdOf(page) {
    	if (page.state.route.kind === "job") return page.state.route.jobId;
    	return page.state.job.data?.job?.id ?? "";
    }
    // .build/workflows/client/components/workflow-detail.js
    /**
    * 工作流详情：流程图 + 岗位 / 任务类型 / 边 / 开始结束契约 / 预算 + 作业列表。
    */
    /**
    * 工作流详情视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderWorkflowDetail(page) {
    	const { t, state, actions } = page;
    	const loaded = state.workflow;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.data === null) return renderLoading(page);
    	const detail = loaded.data;
    	const workflow = detail.workflow;
    	if (workflow === void 0) return renderEmpty(t("notFound"), t("definitionMissing"));
    	const definition = workflow.definition ?? null;
    	const graphPositionsList = Array.isArray(detail.graph?.positions) ? detail.graph.positions : graphPositions(definition);
    	const graphEdges = Array.isArray(detail.graph?.edges) ? detail.graph.edges : definition?.edges;
    	const nodes = [
    		{
    			id: "start",
    			label: detail.graph?.start?.label ?? t("graphStart"),
    			kind: "start",
    			status: "idle"
    		},
    		...graphPositionsList.filter((position) => typeof position?.id === "string" && position.id !== "").map((position) => ({
    			id: position.id,
    			label: typeof position.label === "string" && position.label !== "" ? position.label : position.id,
    			kind: "position",
    			executor: position.executor ?? null,
    			...typeof position.executor?.avatar === "string" && position.executor.avatar !== "" ? { avatar: position.executor.avatar } : {},
    			status: "idle",
    			meta: renderExecutor(page, position.executor)
    		})),
    		{
    			id: "end",
    			label: detail.graph?.end?.label ?? t("graphEnd"),
    			kind: "end",
    			status: "idle"
    		}
    	];
    	const edges = (Array.isArray(graphEdges) ? graphEdges : []).map((edge) => ({
    		from: typeof edge.from === "string" ? edge.from : "",
    		to: typeof edge.to === "string" ? edge.to : "",
    		types: Array.isArray(edge.types) ? edge.types.filter((type) => typeof type === "string") : [],
    		back: edge.back === true
    	}));
    	const jobs = Array.isArray(detail.jobs) ? detail.jobs : [];
    	const allTypes = allTaskTypes(definition);
    	return h("div", { className: "buka-workflows-detail" }, h("div", { className: "buka-workflows-workflowHead" }, h("div", { className: "buka-workflows-workflowTitleGroup" }, h("h2", { className: "buka-workflows-workflowTitle" }, typeof workflow.name === "string" && workflow.name !== "" ? workflow.name : workflow.id), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `v${workflow.version ?? 0}`), renderStatusTag(t, workflow.status, "workflow")), typeof workflow.description === "string" && workflow.description !== "" ? h("p", { className: "buka-workflows-workflowDesc" }, workflow.description) : null), renderSection(t("graphTitle"), nodes.length === 0 ? renderEmpty(t("definitionMissing")) : renderWorkflowGraph(page, {
    		nodes,
    		edges
    	})), renderSection(`${t("positionsTitle")} / ${t("taskTypesTitle")}`, positionsOf(definition).length === 0 ? renderEmpty(t("positionsEmpty")) : h("div", { className: "buka-workflows-positionList" }, ...positionsOf(definition).map((position) => h("article", {
    		key: position.id,
    		className: "buka-workflows-positionCard"
    	}, h("div", { className: "buka-workflows-positionHead" }, h("code", { className: "buka-workflows-inlineCode" }, position.id), h("span", { className: "buka-workflows-positionLabel" }, position.label), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, renderExecutor(page, position.executor))), position.description === "" ? null : h("p", { className: "buka-workflows-positionDesc" }, position.description), position.taskTypes.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("taskTypesTitle")) : h("div", { className: "buka-workflows-typeList" }, ...position.taskTypes.map((type) => h("details", {
    		key: String(type.id),
    		className: "buka-workflows-typeCard"
    	}, h("summary", { className: "buka-workflows-typeHead" }, h("code", { className: "buka-workflows-inlineCode" }, String(type.id)), h("span", { className: "buka-workflows-typeLabel" }, type.label ?? String(type.id)), typeof type.assistant === "string" && type.assistant !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `${t("taskTypeAssistant")} · ${type.assistant}`) : null, type.mode === "plan" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("taskTypeModePlan")) : null), typeof type.description === "string" && type.description !== "" ? h("p", { className: "buka-workflows-typeDesc" }, type.description) : null, h("div", { className: "buka-workflows-typeColumns" }, h("div", { className: "buka-workflows-typeColumn" }, h("span", { className: "buka-workflows-fieldLabel" }, t("taskTypePayload")), renderSchema(page, type.payload)), h("div", { className: "buka-workflows-typeColumn" }, h("span", { className: "buka-workflows-fieldLabel" }, t("taskTypeOutput")), renderSchema(page, type.output))), Array.isArray(type.requires) && type.requires.length > 0 ? h("div", { className: "buka-workflows-requiresRow" }, h("span", { className: "buka-workflows-fieldLabel" }, t("taskTypeRequires")), ...type.requires.map((require$1, index) => h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    		key: `${index}`,
    		tone: "neutral"
    	}, (Array.isArray(require$1?.types) ? require$1.types : []).join(" / ")))) : null)))))), h("span", { className: "buka-workflows-hint" }, `${allTypes.length} ${t("taskTypesTitle")}`)), renderSection(t("edgesTitle"), edgesOf(definition).length === 0 ? renderEmpty(t("edgesEmpty")) : h("ul", { className: "buka-workflows-edgeList" }, ...edgesOf(definition).map((edge, index) => h("li", {
    		key: `${edge.from}-${edge.to}-${index}`,
    		className: "buka-workflows-edgeRow"
    	}, h("code", { className: "buka-workflows-inlineCode" }, edge.from), h("span", {
    		className: "buka-workflows-edgeArrowText",
    		"aria-hidden": true
    	}, "→"), h("code", { className: "buka-workflows-inlineCode" }, edge.to), edge.types.length === 0 ? h("span", { className: "buka-workflows-hint" }, t("edgeAllTypes")) : h("span", { className: "buka-workflows-edgeTypes" }, ...edge.types.map((type) => h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    		key: type,
    		tone: "neutral"
    	}, type))), edge.back ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, t("edgeBack")) : null)))), h("div", { className: "buka-workflows-contractGrid" }, renderSection(t("startContractTitle"), h("div", { className: "buka-workflows-contractBody" }, h("p", { className: "buka-workflows-hint" }, t("startContractHint")), h("div", { className: "buka-workflows-typeColumns" }, h("div", { className: "buka-workflows-typeColumn" }, h("span", { className: "buka-workflows-fieldLabel" }, t("taskTypePayload")), renderSchema(page, definition?.start?.task?.payload)), h("div", { className: "buka-workflows-typeColumn" }, h("span", { className: "buka-workflows-fieldLabel" }, t("taskTypeOutput")), renderSchema(page, definition?.start?.task?.output))))), renderSection(t("endContractTitle"), h("div", { className: "buka-workflows-contractBody" }, h("p", { className: "buka-workflows-hint" }, t("endContractHint")), renderSchema(page, definition?.end?.task?.payload)))), renderSection(t("budgetsTitle"), renderKv([[t("budgetMaxTasks"), typeof definition?.budgets?.maxTasks === "number" ? String(definition.budgets.maxTasks) : t("budgetUnset")], [t("budgetMaxDuration"), typeof definition?.budgets?.maxDurationHours === "number" ? `${definition.budgets.maxDurationHours} ${t("budgetHours")}` : t("budgetUnset")]])), renderSection(t("workflowJobsTitle"), jobs.length === 0 ? renderEmpty(t("workflowJobsEmpty"), t("workflowJobsEmptyHint")) : h("ul", { className: "buka-workflows-cards" }, ...jobs.map((job) => h("li", { key: job.id }, h("button", {
    		type: "button",
    		className: "buka-workflows-card",
    		onClick: () => actions.openJob(workflowIdOf(page), job.id)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, h("span", { className: "buka-workflows-seq" }, fill(t, "jobSeq", { seq: job.seq ?? 0 })), h("span", { className: "buka-workflows-cardTitle" }, job.inputSummary ?? job.id)), h("span", { className: "buka-workflows-cardTags" }, renderStatusTag(t, job.status, "job"))), h("span", { className: "buka-workflows-meta" }, [taskCountsText(job.taskCounts ?? null, t), timeText(job.createdAt)].filter((part) => part !== "").join(" · "))))))));
    }
    /**
    * 当前工作流 id。
    *
    * @param page
    * @returns
    */
    function workflowIdOf(page) {
    	if (page.state.route.kind === "workflow") return page.state.route.workflowId;
    	return page.state.workflow.data?.workflow?.id ?? "";
    }
    // .build/workflows/client/components/workflow-list.js
    /**
    * 工作流列表：名称、描述、版本、状态与作业数。
    */
    /**
    * 工作流列表视图。
    *
    * @param page
    * @returns React 元素
    */
    function renderWorkflowList(page) {
    	const { t, state, actions } = page;
    	const workflows = state.workflows;
    	if (workflows.error !== null && workflows.data === null) return renderFailure(page, workflows.error, actions.refresh);
    	if (workflows.status !== "ready" && workflows.data === null) return renderLoading(page);
    	const items = workflows.data ?? [];
    	if (items.length === 0) return renderEmpty(t("workflowsEmpty"), t("workflowsEmptyHint"));
    	return h("div", { className: "buka-workflows-listPane" }, h("p", { className: "buka-workflows-hint" }, t("workflowsHint")), h("ul", { className: "buka-workflows-cards" }, ...items.map((workflow) => h("li", { key: workflow.id }, h("button", {
    		type: "button",
    		className: "buka-workflows-card",
    		onClick: () => actions.openWorkflow(workflow.id)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, h("span", { className: "buka-workflows-cardTitle" }, typeof workflow.name === "string" && workflow.name !== "" ? workflow.name : workflow.id), typeof workflow.version === "number" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `v${workflow.version}`) : null), h("span", { className: "buka-workflows-cardTags" }, renderStatusTag(t, workflow.status, "workflow"))), typeof workflow.description === "string" && workflow.description !== "" ? h("span", { className: "buka-workflows-cardDesc" }, workflow.description) : null, h("span", { className: "buka-workflows-meta" }, [fill(t, "jobCount", { n: typeof workflow.jobCount === "number" ? workflow.jobCount : 0 }), typeof workflow.updatedAt === "string" && workflow.updatedAt !== "" ? `${t("updatedAt")} ${formatTime(workflow.updatedAt)}` : ""].filter((part) => part !== "").join(" · ")))))));
    }
    // .build/workflows/client/components/page-shell.js
    /**
    * 页面外壳：面包屑返回、标题、工具栏、内容区、页脚、Toast 与抽屉 / 对话框。
    */
    /**
    * 页面外壳。
    *
    * @param page
    * @returns React 元素
    */
    function renderPage(page) {
    	const { t, state, actions } = page;
    	const route = state.route;
    	const backButton = route.kind === "workflows" ? null : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton buka-workflows-back",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 13 }),
    		onClick: route.kind === "workflow" ? actions.backToWorkflows : actions.backToWorkflow
    	}, route.kind === "workflow" ? t("backToWorkflows") : t("backToWorkflow"));
    	const title = route.kind === "workflows" ? t("title") : route.kind === "workflow" ? state.workflow.data?.workflow?.name ?? route.workflowId : fill(t, "jobSeq", { seq: state.job.data?.job?.seq ?? 0 });
    	const workflowStatus = state.workflow.data?.workflow?.status;
    	const jobStatus = state.job.data?.job?.status;
    	const live = jobStatus === "running";
    	return h("div", { className: `buka-workflows-page${route.kind === "job" ? " is-wide" : ""}` }, h("header", { className: "buka-workflows-head" }, h("div", { className: "buka-workflows-headInner" }, h("div", { className: "buka-workflows-titleRow" }, h("div", { className: "buka-workflows-titleGroup" }, backButton, h("h1", { className: "buka-workflows-title" }, title)), h("div", { className: "buka-workflows-toolbar" }, ...route.kind === "workflow" ? [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "activate",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		onClick: () => void actions.activateWorkflow(workflowStatus !== "active"),
    		disabled: state.busy === "activate" || workflowStatus === void 0
    	}, workflowStatus === "active" ? t("deactivate") : t("activate")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "new-job",
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		onClick: actions.openNewJob,
    		disabled: workflowStatus !== "active"
    	}, t("newJob"))] : [], ...route.kind === "job" ? [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "cancel-job",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		onClick: () => {
    			if (typeof window !== "undefined" && typeof window.confirm === "function") {
    				if (!window.confirm(t("cancelJobConfirm"))) return;
    			}
    			actions.cancelJob();
    		},
    		disabled: state.busy === "cancel-job" || jobStatus !== "running"
    	}, t("cancelJob"))] : [], h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		onClick: actions.refresh
    	}, t("refresh")))))), h("div", { className: `buka-workflows-body${route.kind === "job" ? " is-wide" : ""}` }, route.kind === "workflows" ? renderWorkflowList(page) : route.kind === "workflow" ? renderWorkflowDetail(page) : renderJobDetail(page)), h("footer", { className: "buka-workflows-footer" }, h("p", {
    		className: "buka-workflows-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: live ? "ongoing" : "idle" }), live ? t("autoRefreshLive") : t("autoRefreshIdle"))), renderNewJobDialog(page), renderTaskDrawer(page), renderAttachmentDrawer(page), state.notice === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Toast, {
    		key: state.notice.seq,
    		text: state.notice.text,
    		...state.notice.kind === "success" ? { tone: "success" } : {},
    		...state.notice.kind === "success" ? {} : { icon: h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}) },
    		holdMs: 3200,
    		onDone: actions.dismissNotice
    	}));
    }
    // .build/workflows/client/state/use-actions.js
    /**
    * 页面动作：导航、取数后的写回、工作流激活、作业启停、任务动作、会话与附件。
    *
    * 所有异步动作都走函数式 `setState`；动作失败只写页面错误 / Toast，不抛出去。
    */
    /**
    * 创建页面动作。
    *
    * @param store 状态与 setter
    * @param deps 词典、Service 取值器与 Toast
    * @returns 动作集合
    */
    function createActions(store, deps) {
    	const { t, getService } = deps;
    	const { state, setState } = store;
    	/** 当前作业 id（作业详情路由或已加载的作业详情）。 */
    	function jobIdOf(current = state) {
    		if (current.route.kind === "job") return current.route.jobId;
    		return current.job.data?.job?.id ?? "";
    	}
    	/** 当前工作流 id。 */
    	function workflowIdOf(current = state) {
    		if (current.route.kind === "workflow") return current.route.workflowId;
    		if (current.route.kind === "job") return current.route.workflowId;
    		return current.workflow.data?.workflow?.id ?? "";
    	}
    	/** 用 Toast 显示一次操作结果。 */
    	function flash(kind, text) {
    		setState((current) => ({
    			...current,
    			notice: {
    				kind,
    				text,
    				seq: Date.now() + Math.random()
    			}
    		}));
    	}
    	/** 手动刷新：递增 tick 触发所有数据 effect。 */
    	function refresh() {
    		setState((current) => ({
    			...current,
    			tick: current.tick + 1
    		}));
    	}
    	return {
    		t,
    		getService,
    		flash,
    		refresh,
    		dismissNotice: () => setState((current) => ({
    			...current,
    			notice: null
    		})),
    		openWorkflow(workflowId) {
    			setState((current) => ({
    				...current,
    				route: {
    					kind: "workflow",
    					workflowId
    				},
    				workflow: {
    					status: "loading",
    					data: null,
    					error: null
    				},
    				job: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				taskId: null,
    				task: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		backToWorkflows() {
    			setState((current) => ({
    				...current,
    				route: { kind: "workflows" },
    				workflow: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				job: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				taskId: null,
    				task: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		openJob(workflowId, jobId) {
    			setState((current) => ({
    				...current,
    				route: {
    					kind: "job",
    					workflowId,
    					jobId
    				},
    				job: {
    					status: "loading",
    					data: null,
    					error: null
    				},
    				jobView: "board",
    				taskId: null,
    				task: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		backToWorkflow() {
    			const workflowId = workflowIdOf();
    			if (workflowId === "") {
    				setState((current) => ({
    					...current,
    					route: { kind: "workflows" }
    				}));
    				return;
    			}
    			setState((current) => ({
    				...current,
    				route: {
    					kind: "workflow",
    					workflowId
    				},
    				job: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				taskId: null,
    				task: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		setJobView(view) {
    			setState((current) => ({
    				...current,
    				jobView: view
    			}));
    		},
    		async activateWorkflow(active) {
    			const workflowId = workflowIdOf();
    			if (workflowId === "") return;
    			setState((current) => ({
    				...current,
    				busy: "activate"
    			}));
    			try {
    				await postJson(WORKFLOW_ACTIVATE_ROUTE, {
    					id: workflowId,
    					active
    				});
    				setState((current) => {
    					const detail = current.workflow.data;
    					const status = active ? "active" : "retired";
    					const nextDetail = detail === null || detail.workflow === void 0 ? current.workflow : {
    						...current.workflow,
    						data: {
    							...detail,
    							workflow: {
    								...detail.workflow,
    								status
    							}
    						}
    					};
    					const nextWorkflows = current.workflows.data === null ? current.workflows : {
    						...current.workflows,
    						data: current.workflows.data.map((item) => item.id === workflowId ? {
    							...item,
    							status
    						} : item)
    					};
    					return {
    						...current,
    						busy: null,
    						tick: current.tick + 1,
    						workflow: nextDetail,
    						workflows: nextWorkflows
    					};
    				});
    				flash("success", t("activateDone"));
    			} catch (failure) {
    				setState((current) => ({
    					...current,
    					busy: null
    				}));
    				flash("error", `${t("activateFailed")} ${messageOf(failure)}`);
    			}
    		},
    		openNewJob() {
    			setState((current) => ({
    				...current,
    				newJob: {
    					open: true,
    					raw: {},
    					structured: {},
    					error: null,
    					submitting: false
    				}
    			}));
    		},
    		closeNewJob() {
    			setState((current) => ({
    				...current,
    				newJob: {
    					open: false,
    					raw: {},
    					structured: {},
    					error: null,
    					submitting: false
    				}
    			}));
    		},
    		setNewJobRaw(name, value) {
    			setState((current) => ({
    				...current,
    				newJob: {
    					...current.newJob,
    					raw: {
    						...current.newJob.raw,
    						[name]: value
    					},
    					error: null
    				}
    			}));
    		},
    		setNewJobStructured(name, value) {
    			setState((current) => ({
    				...current,
    				newJob: {
    					...current.newJob,
    					structured: {
    						...current.newJob.structured,
    						[name]: value
    					},
    					error: null
    				}
    			}));
    		},
    		async submitNewJob() {
    			const current = state;
    			const definition = currentDefinition(current);
    			const workflowId = workflowIdOf(current);
    			if (workflowId === "") return;
    			const start = definition?.start?.task;
    			const rawSchema = isRecord(start?.payload) ? start.payload : null;
    			const structuredSchema = isRecord(start?.output) ? start.output : null;
    			const draft = current.newJob;
    			let rawInput;
    			if (schemaFields(rawSchema).length > 0) {
    				const parsed = parseSchemaValues(rawSchema, draft.raw, t);
    				if ("error" in parsed) {
    					setState((now) => ({
    						...now,
    						newJob: {
    							...now.newJob,
    							error: parsed.error
    						}
    					}));
    					return;
    				}
    				rawInput = parsed.value;
    			} else {
    				const request = (draft.raw.request ?? "").trim();
    				if (request === "") {
    					setState((now) => ({
    						...now,
    						newJob: {
    							...now.newJob,
    							error: fill(t, "fieldRequired", { name: t("newJobRawFallback") })
    						}
    					}));
    					return;
    				}
    				rawInput = { request };
    			}
    			let structuredInput;
    			if (schemaFields(structuredSchema).length > 0) {
    				const parsed = parseSchemaValues(structuredSchema, draft.structured, t);
    				if ("error" in parsed) {
    					setState((now) => ({
    						...now,
    						newJob: {
    							...now.newJob,
    							error: parsed.error
    						}
    					}));
    					return;
    				}
    				structuredInput = parsed.value;
    			} else {
    				const text = (draft.structured.__json ?? "").trim();
    				if (text === "") structuredInput = {};
    				else {
    					const parsed = parseJson(text);
    					if (!isRecord(parsed)) {
    						setState((now) => ({
    							...now,
    							newJob: {
    								...now.newJob,
    								error: `${t("newJobJsonInvalid")} ${text.slice(0, 120)}`
    							}
    						}));
    						return;
    					}
    					structuredInput = parsed;
    				}
    			}
    			setState((now) => ({
    				...now,
    				newJob: {
    					...now.newJob,
    					submitting: true,
    					error: null
    				}
    			}));
    			try {
    				const body = await postJson(JOB_START_ROUTE, {
    					workflowId,
    					rawInput,
    					structuredInput
    				});
    				const jobId = typeof body.jobId === "string" ? body.jobId : "";
    				setState((now) => ({
    					...now,
    					newJob: {
    						open: false,
    						raw: {},
    						structured: {},
    						error: null,
    						submitting: false
    					},
    					route: jobId === "" ? now.route : {
    						kind: "job",
    						workflowId,
    						jobId
    					},
    					job: {
    						status: "loading",
    						data: null,
    						error: null
    					},
    					jobView: "board",
    					tick: now.tick + 1
    				}));
    				flash("success", t("newJobStarted"));
    			} catch (failure) {
    				setState((now) => ({
    					...now,
    					newJob: {
    						...now.newJob,
    						submitting: false,
    						error: `${t("newJobFailed")} ${messageOf(failure)}`
    					}
    				}));
    			}
    		},
    		async cancelJob() {
    			const jobId = jobIdOf();
    			if (jobId === "") return;
    			setState((current) => ({
    				...current,
    				busy: "cancel-job"
    			}));
    			try {
    				await postJson(JOB_ACTION_ROUTE, {
    					jobId,
    					action: "cancel"
    				});
    				setState((current) => ({
    					...current,
    					busy: null,
    					tick: current.tick + 1
    				}));
    			} catch (failure) {
    				setState((current) => ({
    					...current,
    					busy: null
    				}));
    				flash("error", `${t("taskActionFailed")} ${messageOf(failure)}`);
    			}
    		},
    		async retryDelivery() {
    			const jobId = jobIdOf();
    			if (jobId === "") return;
    			setState((current) => ({
    				...current,
    				busy: "retry-delivery"
    			}));
    			try {
    				await postJson(JOB_ACTION_ROUTE, {
    					jobId,
    					action: "retry-delivery"
    				});
    				setState((current) => ({
    					...current,
    					busy: null,
    					tick: current.tick + 1
    				}));
    				flash("success", t("deliveryRetryStarted"));
    			} catch (failure) {
    				setState((current) => ({
    					...current,
    					busy: null
    				}));
    				flash("error", `${t("taskActionFailed")} ${messageOf(failure)}`);
    			}
    		},
    		openTask(taskId) {
    			setState((current) => ({
    				...current,
    				taskId,
    				task: {
    					status: "loading",
    					data: null,
    					error: null
    				},
    				taskForm: {
    					values: {},
    					text: "",
    					error: null,
    					submitting: false
    				}
    			}));
    		},
    		closeTask() {
    			setState((current) => ({
    				...current,
    				taskId: null,
    				task: {
    					status: "idle",
    					data: null,
    					error: null
    				},
    				taskForm: {
    					values: {},
    					text: "",
    					error: null,
    					submitting: false
    				}
    			}));
    		},
    		setTaskField(name, value) {
    			setState((current) => ({
    				...current,
    				taskForm: {
    					...current.taskForm,
    					values: {
    						...current.taskForm.values,
    						[name]: value
    					},
    					error: null
    				}
    			}));
    		},
    		setTaskText(text) {
    			setState((current) => ({
    				...current,
    				taskForm: {
    					...current.taskForm,
    					text,
    					error: null
    				}
    			}));
    		},
    		async runTaskAction(action) {
    			const current = state;
    			const task = current.task.data;
    			if (task === null) return;
    			const jobId = typeof task.jobId === "string" ? task.jobId : jobIdOf(current);
    			if (jobId === "") return;
    			const taskId = task.id;
    			let output = null;
    			if (action === "complete") {
    				const workflowDefinition = currentDefinition(current);
    				const schema = outputSchemaFor(mergedDefinition(currentJobDefinition(current), workflowDefinition), workflowDefinition, task);
    				const form = current.taskForm;
    				if (schemaFields(schema).length > 0) {
    					const parsed = parseSchemaValues(schema, form.values, t);
    					if ("error" in parsed) {
    						setState((now) => ({
    							...now,
    							taskForm: {
    								...now.taskForm,
    								error: parsed.error
    							}
    						}));
    						return;
    					}
    					output = parsed.value;
    				} else {
    					const text = (form.values.__json ?? "").trim();
    					if (text === "") {
    						setState((now) => ({
    							...now,
    							taskForm: {
    								...now.taskForm,
    								error: fill(t, "fieldRequired", { name: t("actionFormTitle") })
    							}
    						}));
    						return;
    					}
    					const parsed = parseJson(text);
    					if (!isRecord(parsed)) {
    						setState((now) => ({
    							...now,
    							taskForm: {
    								...now.taskForm,
    								error: `${t("actionJsonInvalid")} ${text}`
    							}
    						}));
    						return;
    					}
    					output = parsed;
    				}
    			}
    			setState((now) => ({
    				...now,
    				taskForm: {
    					...now.taskForm,
    					submitting: true,
    					error: null
    				}
    			}));
    			try {
    				const body = {
    					jobId,
    					taskId,
    					action
    				};
    				if (output !== null) body.output = output;
    				if (action === "complete" && current.taskForm.text.trim() !== "") body.text = current.taskForm.text.trim();
    				await postJson(TASK_ACTION_ROUTE, body);
    				setState((now) => ({
    					...now,
    					taskForm: {
    						...now.taskForm,
    						submitting: false,
    						error: null
    					},
    					task: {
    						...now.task,
    						status: "loading"
    					},
    					tick: now.tick + 1
    				}));
    				flash("success", t("taskActionDone"));
    			} catch (failure) {
    				setState((now) => ({
    					...now,
    					taskForm: {
    						...now.taskForm,
    						submitting: false,
    						error: `${t("taskActionFailed")} ${messageOf(failure)}`
    					}
    				}));
    			}
    		},
    		async openSession(sessionId) {
    			const id = typeof sessionId === "string" ? sessionId : "";
    			if (id === "") return;
    			const uiWorkspace = service(getService, "uiWorkspace");
    			if (uiWorkspace === null || typeof uiWorkspace.openSession !== "function") {
    				flash("error", t("noUiWorkspace"));
    				return;
    			}
    			try {
    				await refreshSessionsIfUnknown(getService, id);
    				uiWorkspace.openSession(id);
    			} catch (failure) {
    				flash("error", `${t("openSessionFailed")} ${messageOf(failure)}`);
    			}
    		},
    		openAttachment(attachmentId, name) {
    			setState((current) => ({
    				...current,
    				attachment: {
    					id: attachmentId,
    					name,
    					status: "loading",
    					data: null,
    					error: null
    				}
    			}));
    		},
    		closeAttachment() {
    			setState((current) => ({
    				...current,
    				attachment: null
    			}));
    		}
    	};
    }
    /**
    * 取一个 DSH Client Service；不存在时返回 null。
    *
    * @param getService
    * @param name
    * @returns
    */
    function service(getService, name) {
    	try {
    		const found = getService(name);
    		return isRecord(found) ? found : null;
    	} catch {
    		return null;
    	}
    }
    /**
    * 客户端会话列表里还没有这个会话时，先做一次全量刷新（与旧页面一致）。
    *
    * @param getService
    * @param sessionId
    * @returns
    */
    async function refreshSessionsIfUnknown(getService, sessionId) {
    	const sessions = service(getService, "sessions");
    	if (sessions === null || typeof sessions.refresh !== "function") return;
    	let known = false;
    	try {
    		const list = sessions.list;
    		const getSnapshot = isRecord(list) ? list.getSnapshot : void 0;
    		const snapshot = typeof getSnapshot === "function" ? getSnapshot() : null;
    		const byId = isRecord(snapshot) && isRecord(snapshot.byId) ? snapshot.byId : null;
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
    // .build/workflows/client/state/use-effects.js
    /**
    * 页面数据 effect：工作流目录、工作流详情、作业详情、任务详情、附件库、预览与轮询。
    *
    * 轮询沿用旧页面风格：有 `running` 作业时 1.5 秒一次，否则 5 秒一次。所有请求
    * 都可取消（路由切换 / 卸载时不再写状态）。
    */
    /**
    * 挂载全部取数与轮询 effect。
    *
    * @param store 页面状态
    */
    function useWorkflowEffects(store) {
    	const { state, setState } = store;
    	const route = state.route;
    	const tick = state.tick;
    	const live = state.job.data?.job?.status === "running";
    	react.default.useEffect(() => {
    		const interval = setInterval(() => setState((current) => ({
    			...current,
    			tick: current.tick + 1
    		})), live ? LIVE_REFRESH_MS : REFRESH_MS);
    		return () => clearInterval(interval);
    	}, [live]);
    	react.default.useEffect(() => {
    		let cancelled = false;
    		setState((current) => ({
    			...current,
    			workflows: {
    				...current.workflows,
    				status: current.workflows.data === null ? "loading" : current.workflows.status
    			}
    		}));
    		requestJson(WORKFLOWS_ROUTE).then((body) => {
    			if (cancelled) return;
    			const list = Array.isArray(body.workflows) ? body.workflows : [];
    			setState((current) => ({
    				...current,
    				workflows: {
    					status: "ready",
    					data: list,
    					error: null
    				}
    			}));
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				workflows: {
    					...current.workflows,
    					status: "ready",
    					error: messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [tick]);
    	const workflowId = route.kind === "workflows" ? "" : route.workflowId;
    	react.default.useEffect(() => {
    		if (workflowId === "") return void 0;
    		let cancelled = false;
    		setState((current) => ({
    			...current,
    			workflow: {
    				...current.workflow,
    				status: current.workflow.data === null ? "loading" : current.workflow.status
    			}
    		}));
    		requestJson(`${WORKFLOW_ROUTE}?id=${encodeURIComponent(workflowId)}`).then((body) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				workflow: {
    					status: "ready",
    					data: body,
    					error: null
    				}
    			}));
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				workflow: {
    					...current.workflow,
    					status: "ready",
    					error: messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [workflowId, tick]);
    	const jobId = route.kind === "job" ? route.jobId : "";
    	react.default.useEffect(() => {
    		if (jobId === "") return void 0;
    		let cancelled = false;
    		setState((current) => ({
    			...current,
    			job: {
    				...current.job,
    				status: current.job.data === null ? "loading" : current.job.status
    			}
    		}));
    		requestJson(`${JOB_ROUTE}?id=${encodeURIComponent(jobId)}`).then((body) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				job: {
    					status: "ready",
    					data: body,
    					error: null
    				}
    			}));
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				job: {
    					...current.job,
    					status: "ready",
    					error: messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [jobId, tick]);
    	react.default.useEffect(() => {
    		if (route.kind !== "workflow") return void 0;
    		let cancelled = false;
    		requestJson(`${JOBS_ROUTE}?workflowId=${encodeURIComponent(route.workflowId)}`).then((body) => {
    			if (cancelled) return;
    			const jobs = Array.isArray(body.jobs) ? body.jobs : [];
    			setState((current) => {
    				const detail = current.workflow.data;
    				if (detail === null) return current;
    				return {
    					...current,
    					workflow: {
    						...current.workflow,
    						data: {
    							...detail,
    							jobs
    						}
    					}
    				};
    			});
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				workflow: {
    					...current.workflow,
    					error: current.workflow.error ?? messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [route, tick]);
    	const taskId = state.taskId;
    	react.default.useEffect(() => {
    		if (taskId === null || jobId === "") return void 0;
    		let cancelled = false;
    		setState((current) => ({
    			...current,
    			task: {
    				...current.task,
    				status: current.task.data === null ? "loading" : current.task.status
    			}
    		}));
    		requestJson(`${TASK_ROUTE}?jobId=${encodeURIComponent(jobId)}&taskId=${encodeURIComponent(taskId)}`).then((body) => {
    			if (cancelled) return;
    			if (!isRecord(body?.task)) return;
    			setState((current) => ({
    				...current,
    				task: {
    					status: "ready",
    					data: body.task,
    					error: null
    				}
    			}));
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				task: {
    					...current.task,
    					status: "ready",
    					error: messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [
    		taskId,
    		jobId,
    		tick
    	]);
    	const attachmentsView = state.jobView === "attachments" && jobId !== "";
    	react.default.useEffect(() => {
    		if (!attachmentsView) return void 0;
    		let cancelled = false;
    		setState((current) => ({
    			...current,
    			attachments: {
    				...current.attachments,
    				status: current.attachments.data === null ? "loading" : current.attachments.status
    			}
    		}));
    		requestJson(`${ATTACHMENTS_ROUTE}?jobId=${encodeURIComponent(jobId)}`).then((body) => {
    			if (cancelled) return;
    			const list = Array.isArray(body.attachments) ? body.attachments : [];
    			setState((current) => ({
    				...current,
    				attachments: {
    					status: "ready",
    					data: list,
    					error: null
    				}
    			}));
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				attachments: {
    					...current.attachments,
    					status: "ready",
    					error: messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [
    		attachmentsView,
    		jobId,
    		tick
    	]);
    	const attachmentId = state.attachment?.id ?? null;
    	const attachmentLoading = state.attachment?.status === "loading";
    	react.default.useEffect(() => {
    		if (attachmentId === null || !attachmentLoading) return void 0;
    		const controller = typeof AbortController === "function" ? new AbortController() : null;
    		const init = { headers: { accept: "application/json" } };
    		if (controller !== null) init.signal = controller.signal;
    		fetch(attachmentUrl(jobId, attachmentId, "preview"), init).then(async (response) => {
    			const parsed = await response.json().catch(() => null);
    			if (!response.ok || !isRecord(parsed) || parsed.ok !== true) throw new Error(isRecord(parsed) && typeof parsed.message === "string" ? parsed.message : `HTTP ${response.status}`);
    			const attachment = parsed.attachment;
    			if (!isRecord(attachment)) throw new Error("invalid attachment preview");
    			return attachment;
    		}).then((preview) => {
    			setState((current) => {
    				if (current.attachment === null || current.attachment.id !== attachmentId) return current;
    				return {
    					...current,
    					attachment: {
    						...current.attachment,
    						status: "ready",
    						data: preview,
    						error: null
    					}
    				};
    			});
    		}, (failure) => {
    			if (controller?.signal.aborted === true) return;
    			setState((current) => {
    				if (current.attachment === null || current.attachment.id !== attachmentId) return current;
    				return {
    					...current,
    					attachment: {
    						...current.attachment,
    						status: "failed",
    						data: null,
    						error: `${messageOf(failure)}`
    					}
    				};
    			});
    		});
    		return () => {
    			controller?.abort();
    		};
    	}, [
    		attachmentId,
    		attachmentLoading,
    		jobId
    	]);
    }
    // .build/workflows/client/state/use-page-state.js
    /**
    * 页面全部状态的声明与初值。
    *
    * 页面只用**一个** `useState` 装下整个状态对象：这样渲染冒烟测试注入一份
    * 状态即可覆盖任意页面，不需要按 hook 调用顺序对表；异步动作全部走函数式
    * `setState`，也不会丢更新。
    */
    /**
    * 页面初始状态。
    *
    * @returns 可以交给 `useState` 的状态对象
    */
    function createInitialState() {
    	return {
    		route: { kind: "workflows" },
    		workflows: {
    			status: "idle",
    			data: null,
    			error: null
    		},
    		workflow: {
    			status: "idle",
    			data: null,
    			error: null
    		},
    		job: {
    			status: "idle",
    			data: null,
    			error: null
    		},
    		jobView: "board",
    		attachments: {
    			status: "idle",
    			data: null,
    			error: null
    		},
    		taskId: null,
    		task: {
    			status: "idle",
    			data: null,
    			error: null
    		},
    		taskForm: {
    			values: {},
    			text: "",
    			error: null,
    			submitting: false
    		},
    		newJob: {
    			open: false,
    			raw: {},
    			structured: {},
    			error: null,
    			submitting: false
    		},
    		attachment: null,
    		busy: null,
    		notice: null,
    		tick: 0
    	};
    }
    /**
    * 声明页面状态。
    *
    * @returns 状态与 setter
    */
    function usePageState() {
    	const [state, setState] = react.default.useState(createInitialState);
    	return {
    		state,
    		setState
    	};
    }
    // .build/workflows/client/page.js
    /**
    * 侧边栏「工作流」页面：装配状态、数据 effect 与动作，渲染只做分发。
    *
    * 导航只有一条链：工作流列表 → 工作流详情（图 + 岗位 / 类型 / 边 + 作业列表）
    * → 作业详情（看板 / 流程图 / 任务 / 附件库 / 时间线）。不存在跨工作流的作业
    * 列表。
    */
    /**
    * 侧边栏「工作流」页面。
    *
    * @param props 词典与 Client Service 取值器
    * @returns React 元素
    */
    function WorkflowsPage(props) {
    	const t = props.t;
    	const getService = typeof props.getService === "function" ? props.getService : () => null;
    	const store = usePageState();
    	useWorkflowEffects(store);
    	const actions = createActions(store, {
    		t,
    		getService
    	});
    	return renderPage({
    		t,
    		getService,
    		state: store.state,
    		actions
    	});
    }
    // .build/workflows/client/styles.js
    /**
    * 页面样式：沿用 Robots / Skills 页的标题行 + 内容区 + 卡片结构，并补上
    * v4 的看板、流程图、任务抽屉、附件库与时间线。
    */
    /** 页面样式。 */
    const CSS = `
    .buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
    @media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
    .buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));max-width:none;margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
    .buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
    .buka-workflows-page.is-wide .buka-workflows-headInner{max-width:1280px}
    .buka-workflows-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px;min-width:0}
    .buka-workflows-titleGroup{display:flex;align-items:center;gap:10px;min-width:0}
    .buka-workflows-title{font-size:16px;font-weight:600;line-height:24px;margin:0;overflow-wrap:anywhere}
    .buka-workflows-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:24px 0 24px}
    .buka-workflows-body.is-wide{max-width:1280px}
    .buka-workflows-footer{box-sizing:border-box;width:100%;max-width:1280px;margin-inline:auto;flex:none;display:flex;align-items:center;padding:10px 0 20px;border-top:0.5px solid var(--dsw-alias-border-l1)}
    .buka-workflows-back svg{transform:rotate(180deg)}
    .buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
    .buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
    .buka-workflows-emptyBox{display:flex;flex-direction:column;gap:8px;padding:8px 0}
    .buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-failureBox{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
    .buka-workflows-warn{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
    .buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;overflow-wrap:anywhere;word-break:break-all}
    .buka-workflows-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;width:100%;box-sizing:border-box}
    .buka-workflows-pre.is-tall{max-height:360px}
    .buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:28px;padding:0 10px;font-size:12px;line-height:18px}
    .buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
    .buka-workflows-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
    .buka-workflows-listPane{display:flex;flex-direction:column;gap:14px}
    .buka-workflows-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-xl);padding:12px 8px;margin:0 -8px;font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    .buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
    .buka-workflows-cardTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
    .buka-workflows-cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-cardTags{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap}
    .buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px 5px}
    .buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-detail{display:flex;flex-direction:column;gap:20px;min-width:0}
    .buka-workflows-section{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    .buka-workflows-sectionTitle{font-size:13px;font-weight:600;line-height:20px;margin:0;color:var(--dsw-alias-label-primary)}
    .buka-workflows-kv{display:flex;flex-direction:column;gap:4px}
    .buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;line-height:18px}
    .buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);min-width:88px}
    .buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
    .buka-workflows-workflowHead,.buka-workflows-jobHead{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-workflowTitleGroup,.buka-workflows-jobTitleGroup{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-workflowTitle,.buka-workflows-jobTitle{font-size:18px;font-weight:600;line-height:26px;margin:0;overflow-wrap:anywhere}
    .buka-workflows-workflowDesc{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-jobMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-deliveryNotice{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
    .buka-workflows-positionList{display:flex;flex-direction:column;gap:10px}
    .buka-workflows-positionCard{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-positionHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-positionLabel{font-size:14px;font-weight:500;line-height:20px}
    .buka-workflows-positionDesc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-typeList{display:flex;flex-direction:column;gap:6px}
    .buka-workflows-typeCard{padding:8px 10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
    .buka-workflows-typeHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer;min-width:0}
    .buka-workflows-typeLabel{font-size:13px;font-weight:500;line-height:20px}
    .buka-workflows-typeDesc{margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-typeColumns{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:8px}
    .buka-workflows-typeColumn{display:flex;flex-direction:column;gap:6px;min-width:0}
    .buka-workflows-requiresRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}
    .buka-workflows-schemaList{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
    .buka-workflows-schemaField{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;line-height:18px}
    .buka-workflows-schemaType{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px}
    .buka-workflows-required{color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:16px}
    .buka-workflows-edgeList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-edgeRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-edgeArrowText{color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-edgeTypes{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
    .buka-workflows-contractGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
    .buka-workflows-contractBody{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-field{display:flex;flex-direction:column;gap:4px;min-width:0}
    .buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
    .buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .buka-workflows-input{width:100%}
    .buka-workflows-textarea,.buka-workflows-select{box-sizing:border-box;width:100%;padding:6px 8px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;line-height:18px;resize:vertical}
    .buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-formActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
    .buka-workflows-dialogForm{display:flex;flex-direction:column;gap:12px}
    .buka-workflows-viewTabs{display:flex;align-items:center;min-width:0}
    .buka-workflows-tabList{width:fit-content;min-width:280px}
    .buka-workflows-viewBody{display:flex;flex-direction:column;gap:12px;min-width:0}
    .buka-workflows-boardPane{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-board{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:8px}
    .buka-workflows-boardGrid{display:grid;grid-template-columns:156px repeat(5,minmax(168px,1fr));gap:6px;min-width:1020px}
    .buka-workflows-boardHeader{display:contents}
    .buka-workflows-boardRowHead{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
    .buka-workflows-boardHeader>.buka-workflows-boardRowHead{background:transparent;padding-top:0}
    .buka-workflows-boardColumnHead{font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:0 2px 4px}
    .buka-workflows-boardRow{display:contents}
    .buka-workflows-boardRowTitle{font-size:12px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-boardRowExecutor{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
    .buka-workflows-boardRowMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
    .buka-workflows-boardRow.is-start .buka-workflows-boardRowHead,.buka-workflows-boardRow.is-end .buka-workflows-boardRowHead{border-left:2px solid var(--dsw-alias-border-l2)}
    .buka-workflows-boardCell{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:52px;padding:4px;border-radius:var(--dsw-radius-sm);border:0.5px dashed var(--dsw-alias-border-l1)}
    .buka-workflows-taskCard{display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;text-align:left;padding:8px 9px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-taskCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-taskCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-taskCard.is-running{border-color:var(--dsw-alias-brand-primary)}
    .buka-workflows-taskCard.is-failed,.buka-workflows-taskCard.is-blocked{border-color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-taskCardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}
    .buka-workflows-taskCardType{font-size:12px;font-weight:500;line-height:18px;overflow-wrap:anywhere;min-width:0}
    .buka-workflows-taskCardMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
    .buka-workflows-taskCardSummary{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .buka-workflows-taskCardStatus{display:none}
    .buka-workflows-tablePane{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}
    .buka-workflows-table th{text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);padding:6px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l2);white-space:nowrap}
    .buka-workflows-table td{padding:7px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l1);vertical-align:middle;overflow-wrap:anywhere}
    .buka-workflows-tableRow{cursor:pointer}
    .buka-workflows-tableRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .buka-workflows-tableRow:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
    .buka-workflows-tableTime{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
    .buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
    .buka-workflows-attachmentMain{display:flex;flex-direction:column;gap:2px;min-width:160px;flex:1 1 auto}
    .buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:18px;text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
    @media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
    .buka-workflows-attachmentSource{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;text-align:left;cursor:pointer;overflow-wrap:anywhere}
    .buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
    .buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1 1 auto;min-width:120px;overflow-wrap:anywhere}
    .buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11px;flex:none}
    .buka-workflows-attachmentDownload:hover{text-decoration:underline}
    .buka-workflows-timeline{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
    .buka-workflows-timelineItem{display:flex;gap:10px;padding:0 0 14px;position:relative}
    .buka-workflows-timelineItem::before{content:'';position:absolute;left:4px;top:12px;bottom:0;width:1px;background:var(--dsw-alias-border-l2)}
    .buka-workflows-timelineItem:last-child::before{display:none}
    .buka-workflows-timelineDot{flex:none;width:9px;height:9px;margin-top:4px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);z-index:1}
    .buka-workflows-timelineItem.is-success .buka-workflows-timelineDot{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-timelineItem.is-warning .buka-workflows-timelineDot{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-timelineItem.is-info .buka-workflows-timelineDot{background:var(--dsw-alias-brand-primary)}
    .buka-workflows-timelineBody{display:flex;flex-direction:column;gap:2px;min-width:0}
    .buka-workflows-timelineHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
    .buka-workflows-timelineLabel{font-size:12px;font-weight:500;line-height:18px}
    .buka-workflows-timelineTime{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
    .buka-workflows-timelineDetail{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .buka-workflows-depList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-depRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px}
    .buka-workflows-depLink{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;text-align:left}
    .buka-workflows-depLink:hover{text-decoration:underline}
    .buka-workflows-depSummary{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:1 1 100%;overflow-wrap:anywhere}
    .buka-workflows-attemptList{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
    .buka-workflows-attempt{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
    .buka-workflows-attemptHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-attemptMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .buka-workflows-sessionRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-sessionBar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
    .buka-workflows-result{display:flex;flex-direction:column;gap:12px}
    .buka-workflows-taskForm{display:flex;flex-direction:column;gap:10px}
    .buka-workflows-graphPane{display:flex;flex-direction:column;gap:10px;min-width:0;align-items:center}
    .buka-workflows-vgraph{position:relative;flex:none;margin-inline:auto}
    .buka-workflows-vgraphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
    .buka-workflows-vgraphNode{position:absolute;z-index:2;display:flex;align-items:center}
    .buka-workflows-capsule{flex:1 1 auto;display:inline-flex;align-items:center;width:100%;height:100%;box-sizing:border-box;margin:0;padding:3px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;overflow:hidden;white-space:nowrap}
    button.buka-workflows-capsule{cursor:pointer}
    .buka-workflows-capsule.has-avatar{padding-left:4px}
    .buka-workflows-capsuleAvatar{margin-right:6px}
    .buka-workflows-capsuleText{flex:1 1 auto;display:flex;align-items:center;gap:6px;min-width:0}
    .buka-workflows-capsuleLabel{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
    .buka-workflows-capsuleMeta{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px;line-height:16px}
    .buka-workflows-capsule.is-start,.buka-workflows-capsule.is-end{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-capsule.is-robot{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
    .buka-workflows-capsule.is-human{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-capsule.is-end{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
    .buka-workflows-capsule.is-idle{border-style:dashed}
    .buka-workflows-capsule.is-running{animation:buka-workflows-pulse 1.8s ease-out infinite}
    .buka-workflows-capsule.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    @media (hover:hover){button.buka-workflows-capsule:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    button.buka-workflows-capsule:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    @keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-capsule.is-running{animation:none}}
    .buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
    .buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.5;stroke-linecap:round;opacity:.75}
    .buka-workflows-edge.is-back{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:4 4;opacity:.8}
    .buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.8}
    .buka-workflows-edgeArrow.is-back{fill:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-graphCaption{text-align:center}
    .buka-workflows-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 20px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;width:100%}
    .buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
    .buka-workflows-legendTitle{color:var(--dsw-alias-label-secondary);font-weight:500}
    .buka-workflows-legendItem{display:inline-flex;align-items:center;gap:5px}
    .buka-workflows-legendCapsule{box-sizing:border-box;width:26px;height:11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}
    .buka-workflows-legendCapsule.is-robot{border-color:var(--dsw-alias-brand-primary)}
    .buka-workflows-legendCapsule.is-human{border-color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-legendCapsule.is-end{border-color:var(--dsw-alias-state-success-primary)}
    .buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
    .buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
    .buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption)}
    .buka-workflows-legendLine.is-back{border-top-color:var(--dsw-alias-state-warn-primary);border-top-style:dashed}
    .buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(600px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
    @keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
    @media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
    .buka-workflows-drawerHead{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 18px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:8px;min-width:0}
    .buka-workflows-drawerTitle{flex:1 1 auto;min-width:0;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-drawerActions{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
    .buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-drawerDownload:hover{text-decoration:underline}
    .buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-left:auto;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}
    @media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px;overflow:auto;overscroll-behavior:contain;padding:16px 18px 28px}
    .buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    `;
    // .build/workflows/client/index.js
    /**
    * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的「工作流」页面。
    *
    * 页面只做一条链：工作流列表 → 工作流详情 → 作业详情。
    *
    * - 工作流列表：名称、描述、版本、状态与作业数；
    * - 工作流详情：流程图（岗位 + 内建开始 / 结束）、岗位 / 任务类型 / 边 /
    *   开始结束契约 / 预算的只读展示、作业列表，以及激活 / 停用与新建作业；
    * - 作业详情：默认看板（行 = 岗位含开始 / 结束，列 = 排队 / 待认领 / 进行中 /
    *   已完成 / 异常），另有流程图、任务列表、附件库与时间线；点卡片从右侧抽屉看
    *   任务（payload、依赖、执行记录、结果、附件与允许的操作），人任务按产出
    *   schema 填表提交；
    * - 作业有 `running` 时每 1.5 秒刷新一次，否则 5 秒。
    *
    * 数据来自 Host 的 `/buka-workflows/*` 只读路由；附件下载 / 预览走
    * `/buka-workflows/attachment`。会话入口复用 `uiWorkspace.openSession(sessionId)`，
    * 客户端会话列表里还没有这个会话时先补一次 `sessions.refresh()`。
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
