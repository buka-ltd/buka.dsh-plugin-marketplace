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
    * 打工人页与工作流节点图原本各维护一份同样的显示表；插件之间不互相 import，
    * 所以统一收在这里，两个浏览器一半都从这里派生。id 与 Host 的
    * `plugins/workers/src/avatar.ts` 一一对应（那边只存 id，不存 emoji / 底色），
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
    * 两个浏览器一半的兜底不同：打工人页退回第一个预设，节点图当作没有头像，
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
    * 全部重载（这样内联回调仍能拿到事件类型），另外补一个宽松签名：打工人 / 技能
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
    * 浏览器一半的词典：工作流列表 / 工作流页 / 作业四视图 / 任务抽屉 / 附件。
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
    	expandText: "Show more",
    	collapseText: "Show less",
    	cancel: "Cancel",
    	unknown: "Unknown",
    	notFound: "This item does not exist or was removed.",
    	definitionMissing: "This workflow has no definition snapshot.",
    	graphAria: "Workflow graph",
    	more: "More",
    	yes: "Yes",
    	no: "No",
    	workflowDraft: "Draft",
    	workflowActive: "Available",
    	workflowRetired: "Disabled",
    	workflowRetiredHint: "Read-only; no new jobs",
    	workflowStatusFailed: "Could not update the workflow: ",
    	workflowEnabled: "Workflow enabled.",
    	workflowDisabled: "Workflow disabled.",
    	enableWorkflow: "Enable workflow",
    	disableWorkflow: "Disable",
    	workflowTabsAria: "Workflow views",
    	workflowVersionName: "Version",
    	statusRunning: "Running",
    	statusCompleted: "Completed",
    	statusFailed: "Failed",
    	statusCancelled: "Cancelled",
    	statusPending: "Queued",
    	statusReady: "Claimable",
    	statusBlocked: "Blocked",
    	actorWorker: "Worker",
    	actorHuman: "Human",
    	actorAssistant: "Assistant",
    	actorSession: "Session",
    	jobTitle: "Job",
    	jobCreatedAt: "Created",
    	jobUpdatedAt: "Updated",
    	workflowsEmpty: "No workflows yet.",
    	workflowsEmptyHint: "Ask an orchestration session to draft and save a workflow. It is ready to use as soon as it is saved.",
    	jobCount: "{n} jobs",
    	updatedAt: "Updated",
    	jobsTab: "Jobs",
    	definitionTab: "Definition",
    	jobsFilterAria: "Filter jobs",
    	jobsFilterAll: "All",
    	jobsFilterRunning: "Running",
    	jobsFilterCompleted: "Completed",
    	jobsFilterProblem: "Problems",
    	jobsEmpty: "No jobs yet.",
    	jobsEmptyHint: "Start one from the page with the requirement for this run.",
    	jobsEmptyRetired: "This workflow is disabled. Enable it before starting a new job.",
    	jobsFilterEmpty: "Nothing matches this filter.",
    	jobsFilterReset: "Show all",
    	jobNoTasks: "No tasks yet",
    	jobTaskProgress: "{done}/{total} done",
    	jobSeq: "Job #{seq}",
    	jobErrorTitle: "Error",
    	definitionInfo: "Definition info",
    	definitionHint: "Select a node or a connection to inspect it.",
    	definitionPositions: "Positions",
    	definitionStartContract: "Start contract",
    	definitionEndContract: "End contract",
    	definitionInitialTasks: "Initial tasks",
    	definitionInitialEmpty: "No initial tasks are defined.",
    	initialDeps: "{n} dependencies",
    	positionExecutor: "Executor",
    	taskTypesTitle: "Task types",
    	taskTypesEmpty: "This position declares no task types.",
    	taskTypePayload: "Input",
    	taskTypeOutput: "Output",
    	taskTypeRequires: "Requires",
    	taskTypeAssistant: "Assistant",
    	taskTypeModePlan: "Plan",
    	taskTypeUnset: "—",
    	schemaNoFields: "No fields.",
    	schemaFieldRequired: "required",
    	channelTitle: "Channel",
    	channelBack: "Back channel",
    	channelAllowedTypes: "Allowed task types",
    	channelAllTypes: "All task types",
    	startTaskTitle: "Start task",
    	startTaskShort: "Start",
    	endTaskTitle: "End task",
    	endTaskShort: "End",
    	startContractHint: "The start task turns the request into the structured input used by the rest of the job.",
    	endContractHint: "The end task delivers the final output to the starter.",
    	startPayloadHint: "What the person starting the job fills in.",
    	startOutputHint: "The structured input produced by the start task.",
    	endPayloadHint: "What the person starting the job agrees to receive.",
    	budgetMaxTasks: "Max tasks",
    	budgetMaxDuration: "Max duration",
    	budgetHours: "hours",
    	budgetUnset: "Not set",
    	graphStart: "Start",
    	graphEnd: "End",
    	graphWorker: "Worker position",
    	graphHuman: "Human position",
    	graphIdle: "Not started",
    	graphChannelForward: "Forward channel",
    	graphChannelBack: "Back channel",
    	graphChannelTaken: "Taken",
    	newJob: "New job",
    	newJobTitle: "New job",
    	newJobHint: "Tell the workflow what needs to be done. The start task turns it into the structured input for the rest of the job.",
    	newJobRawTitle: "What needs to be done",
    	newJobRawHint: "The request, as you would tell a person.",
    	newJobRawFallback: "Request",
    	newJobRawPlaceholder: "What should this job achieve?",
    	newJobStructuredTitle: "Structured input",
    	newJobStructuredHint: "The fields the start task produces. The host validates them against the contract, so the job can rely on them.",
    	newJobStructuredAdvanced: "Advanced: edit as JSON",
    	newJobSubmit: "Start job",
    	newJobSubmitting: "Starting…",
    	newJobStarted: "Job created.",
    	newJobFailed: "Could not start the job: ",
    	newJobJsonInvalid: "Structured input is not valid JSON: ",
    	fieldRequired: "{name} is required.",
    	fieldJsonInvalid: "{name} is not valid JSON: ",
    	fieldInvalidBoolean: "{name} must be true or false.",
    	fieldInvalidNumber: "{name} must be a number.",
    	fallbackJsonTitle: "JSON",
    	fallbackJsonHint: "No schema was provided; enter this field as JSON.",
    	overviewTab: "Overview",
    	flowTab: "Live flow",
    	boardTab: "Board",
    	outputsTab: "Assets",
    	jobTabsAria: "Job views",
    	overviewRequirement: "Request",
    	overviewRequirementEmpty: "No request was recorded.",
    	overviewStructured: "Structured input",
    	overviewStructuredEmpty: "The start task has not produced structured input yet.",
    	overviewFinal: "Final deliverable",
    	overviewFinalEmpty: "The job has not reached the end task yet.",
    	overviewFinalPending: "The end task has not delivered yet.",
    	overviewOpenFinalTask: "Open end task",
    	starter: "Starter",
    	overviewStarter: "Started by",
    	overviewWorkflow: "Workflow",
    	starterHuman: "Person (page)",
    	starterSession: "Session",
    	openStarterSession: "Open starter session",
    	cancelJob: "Cancel job",
    	cancelJobConfirm: "Unfinished tasks will stop. ",
    	cancelJobConfirmAction: "Confirm cancel",
    	retryDelivery: "Retry delivery",
    	deliveryRetryHint: "The end task is still waiting because delivery failed.",
    	deliveryRetryStarted: "Delivery retry requested.",
    	flowHint: "Select a node to see its tasks. Heavier lines have already been traversed.",
    	flowTaskCount: "{n} tasks",
    	flowBuiltinStart: "Start",
    	flowBuiltinEnd: "Deliver",
    	nodeTasksTitle: "{label} · tasks",
    	nodeTasksEmpty: "No tasks at this position yet.",
    	nodeTasksEmptyHint: "Tasks appear when this position is dispatched.",
    	boardStart: "Start",
    	boardEnd: "End",
    	boardStarter: "Starter",
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
    	outputsHint: "Everything tasks submitted for this job. The final deliverable is also shown on the Overview.",
    	outputsEmpty: "This job has no assets yet.",
    	outputsEmptyHint: "Files submitted with task results appear here.",
    	outputsFinal: "Final",
    	outputsUnlinked: "Other assets",
    	outputsOpenSource: "Source task",
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
    	attachmentPreviewPdfHint: "The PDF is embedded above; download it to keep a copy.",
    	taskDrawerTitle: "Task",
    	taskPosition: "Position",
    	taskType: "Type",
    	taskChannel: "Channel",
    	taskStatus: "Status",
    	taskClaimant: "Claimed by",
    	taskCreatedAt: "Created",
    	taskStartedAt: "Started",
    	taskFinishedAt: "Finished",
    	taskDepsTitle: "Dependencies",
    	taskDepsEmpty: "No dependencies.",
    	taskPayloadTitle: "Task input",
    	taskPayloadEmpty: "No input.",
    	taskAttemptsTitle: "Attempts",
    	taskAttemptsEmpty: "No attempts yet.",
    	taskDetailsTitle: "Details",
    	taskUnclaimed: "Not claimed",
    	taskAttemptStopReason: "Stop reason",
    	taskAttemptError: "Error",
    	taskResultTitle: "Result",
    	taskResultEmpty: "No result yet.",
    	taskResultText: "Note",
    	taskResultOutput: "Structured output",
    	taskResultAttachments: "Files",
    	finalDeliverableTitle: "Final deliverable",
    	taskActionsTitle: "Actions",
    	taskActionsEmpty: "No actions are available.",
    	actionClaim: "Claim",
    	actionCancel: "Cancel task",
    	actionRetry: "Retry",
    	actionSubmitComplete: "Submit result",
    	actionSubmitting: "Submitting…",
    	actionTextLabel: "Note (optional)",
    	actionFormTitle: "Fill in the result",
    	actionFormHint: "Fill in the fields this task type requires.",
    	actionFormNoSchema: "This task type has no output schema; enter the result as JSON.",
    	actionJsonInvalid: "Result is not valid JSON: ",
    	actionCancelConfirm: "Cancel this task? Tasks depending on it become blocked.",
    	actionCancelConfirmAction: "Confirm cancel",
    	taskActionDone: "Done.",
    	taskActionFailed: "Action failed: ",
    	openSession: "Open session",
    	openSessionFailed: "Could not open the session: ",
    	noUiWorkspace: "This client has no uiWorkspace service, so sessions cannot be opened.",
    	sessionLabel: "Session"
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
    	expandText: "展开",
    	collapseText: "收起",
    	cancel: "取消",
    	unknown: "未知",
    	notFound: "目标不存在或已被删除。",
    	definitionMissing: "这个工作流没有定义快照。",
    	graphAria: "工作流流程图",
    	more: "更多",
    	yes: "是",
    	no: "否",
    	workflowDraft: "草稿",
    	workflowActive: "可用",
    	workflowRetired: "已停用",
    	workflowRetiredHint: "只读，不能新建作业",
    	workflowStatusFailed: "更新工作流失败：",
    	workflowEnabled: "工作流已重新启用。",
    	workflowDisabled: "工作流已停用。",
    	enableWorkflow: "重新启用",
    	disableWorkflow: "停用",
    	workflowTabsAria: "工作流视图",
    	workflowVersionName: "版本",
    	statusRunning: "进行中",
    	statusCompleted: "已完成",
    	statusFailed: "失败",
    	statusCancelled: "已取消",
    	statusPending: "排队",
    	statusReady: "待认领",
    	statusBlocked: "阻塞",
    	actorWorker: "打工人",
    	actorHuman: "人",
    	actorAssistant: "助理",
    	actorSession: "会话",
    	jobTitle: "作业",
    	jobCreatedAt: "创建",
    	jobUpdatedAt: "更新于",
    	workflowsEmpty: "还没有工作流。",
    	workflowsEmptyHint: "让「工作流编排」会话起草并保存一个工作流；保存后即可直接使用。",
    	jobCount: "{n} 个作业",
    	updatedAt: "更新于",
    	jobsTab: "作业",
    	definitionTab: "定义结构",
    	jobsFilterAria: "筛选作业",
    	jobsFilterAll: "全部",
    	jobsFilterRunning: "进行中",
    	jobsFilterCompleted: "已完成",
    	jobsFilterProblem: "异常",
    	jobsEmpty: "还没有作业。",
    	jobsEmptyHint: "从页面新建一个作业，填上这次要解决的问题。",
    	jobsEmptyRetired: "这个工作流已停用；重新启用后才能新建作业。",
    	jobsFilterEmpty: "没有符合这个筛选的作业。",
    	jobsFilterReset: "显示全部",
    	jobNoTasks: "还没有任务",
    	jobTaskProgress: "已完成 {done}/{total}",
    	jobSeq: "作业 #{seq}",
    	jobErrorTitle: "错误",
    	definitionInfo: "定义信息",
    	definitionHint: "点节点或通道查看详情。",
    	definitionPositions: "岗位",
    	definitionStartContract: "开始契约",
    	definitionEndContract: "结束契约",
    	definitionInitialTasks: "初始任务",
    	definitionInitialEmpty: "没有定义初始任务。",
    	initialDeps: "依赖 {n}",
    	positionExecutor: "执行者",
    	taskTypesTitle: "任务类型",
    	taskTypesEmpty: "这个岗位没有声明任务类型。",
    	taskTypePayload: "输入",
    	taskTypeOutput: "产出",
    	taskTypeRequires: "依赖类型",
    	taskTypeAssistant: "助理",
    	taskTypeModePlan: "计划",
    	taskTypeUnset: "—",
    	schemaNoFields: "没有字段。",
    	schemaFieldRequired: "必填",
    	channelTitle: "通道",
    	channelBack: "回向通道",
    	channelAllowedTypes: "允许的任务类型",
    	channelAllTypes: "全部任务类型",
    	startTaskTitle: "开始任务",
    	startTaskShort: "开始",
    	endTaskTitle: "结束任务",
    	endTaskShort: "结束",
    	startContractHint: "开始任务把需求转换成后续任务使用的结构化输入。",
    	endContractHint: "结束任务把最终交付物交回启动者。",
    	startPayloadHint: "启动作业的人填写的内容。",
    	startOutputHint: "开始任务整理出的结构化输入。",
    	endPayloadHint: "启动者会收到的交付内容。",
    	budgetMaxTasks: "任务上限",
    	budgetMaxDuration: "最长时长",
    	budgetHours: "小时",
    	budgetUnset: "未设置",
    	graphStart: "开始",
    	graphEnd: "结束",
    	graphWorker: "打工人岗位",
    	graphHuman: "人岗位",
    	graphIdle: "未开始",
    	graphChannelForward: "前向通道",
    	graphChannelBack: "回向通道",
    	graphChannelTaken: "已走过",
    	newJob: "新建作业",
    	newJobTitle: "新建作业",
    	newJobHint: "告诉工作流这次要做什么；开始任务会把它整理成后续任务使用的结构化输入。",
    	newJobRawTitle: "这次要做什么",
    	newJobRawHint: "像跟人交代一样写清楚需求。",
    	newJobRawFallback: "需求描述",
    	newJobRawPlaceholder: "这次作业要完成什么？",
    	newJobStructuredTitle: "结构化输入",
    	newJobStructuredHint: "开始任务整理出的字段；Host 会按契约校验，后续任务依赖这些字段。",
    	newJobStructuredAdvanced: "高级：按 JSON 编辑",
    	newJobSubmit: "启动作业",
    	newJobSubmitting: "正在启动…",
    	newJobStarted: "作业已创建。",
    	newJobFailed: "启动作业失败：",
    	newJobJsonInvalid: "结构化输入不是合法 JSON：",
    	fieldRequired: "{name} 为必填。",
    	fieldJsonInvalid: "{name} 不是合法 JSON：",
    	fieldInvalidBoolean: "{name} 必须是 true 或 false。",
    	fieldInvalidNumber: "{name} 必须是数字。",
    	fallbackJsonTitle: "JSON",
    	fallbackJsonHint: "Host 没有提供 schema，按 JSON 填写这个字段。",
    	overviewTab: "概览",
    	flowTab: "实时流程",
    	boardTab: "看板",
    	outputsTab: "资产",
    	jobTabsAria: "作业视图",
    	overviewRequirement: "需求",
    	overviewRequirementEmpty: "没有记录需求。",
    	overviewStructured: "结构化输入",
    	overviewStructuredEmpty: "开始任务还没有产出结构化输入。",
    	overviewFinal: "最终交付物",
    	overviewFinalEmpty: "作业还没有进入结束任务。",
    	overviewFinalPending: "结束任务还没有交付。",
    	overviewOpenFinalTask: "查看结束任务",
    	starter: "启动者",
    	overviewStarter: "启动信息",
    	overviewWorkflow: "工作流",
    	starterHuman: "人（页面启动）",
    	starterSession: "会话",
    	openStarterSession: "打开启动者会话",
    	cancelJob: "取消作业",
    	cancelJobConfirm: "未完成的任务都会停止。",
    	cancelJobConfirmAction: "确认取消",
    	retryDelivery: "重试交付",
    	deliveryRetryHint: "结束任务仍在等待：交付没有成功。",
    	deliveryRetryStarted: "已发起重试交付。",
    	flowHint: "点节点查看这个岗位的任务；加重的通道表示已经走过。",
    	flowTaskCount: "{n} 个任务",
    	flowBuiltinStart: "开始",
    	flowBuiltinEnd: "交付",
    	nodeTasksTitle: "{label} · 任务",
    	nodeTasksEmpty: "这个岗位还没有任务。",
    	nodeTasksEmptyHint: "任务派发到这个岗位后会出现在这里。",
    	boardStart: "开始",
    	boardEnd: "结束",
    	boardStarter: "启动者",
    	boardColumnPending: "排队",
    	boardColumnReady: "待认领",
    	boardColumnRunning: "进行中",
    	boardColumnCompleted: "已完成",
    	boardColumnError: "异常",
    	boardNoTasks: "无任务",
    	boardEmpty: "这个作业还没有任务。",
    	boardEmptyHint: "启动任务完成后，任务会按定义派生出来。",
    	boardHint: "点卡片查看任务详情。",
    	boardCardDeps: "依赖 {n}",
    	boardCardAttempts: "重试 {n}",
    	boardCardAttachments: "附件 {n}",
    	boardCardWaiting: "等待 {duration}",
    	taskCount: "{n} 个任务",
    	outputsHint: "这个作业里任务提交的全部文件；最终交付物的内容也会在概览里展示。",
    	outputsEmpty: "这个作业还没有资产。",
    	outputsEmptyHint: "任务提交结果时附带的文件会出现在这里。",
    	outputsFinal: "最终",
    	outputsUnlinked: "其他资产",
    	outputsOpenSource: "来源任务",
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
    	attachmentPreviewPdfHint: "PDF 已在上方内嵌显示；需要副本请下载。",
    	taskDrawerTitle: "任务详情",
    	taskPosition: "岗位",
    	taskType: "类型",
    	taskChannel: "通道",
    	taskStatus: "状态",
    	taskClaimant: "承办者",
    	taskCreatedAt: "创建",
    	taskStartedAt: "开始",
    	taskFinishedAt: "结束",
    	taskDepsTitle: "依赖",
    	taskDepsEmpty: "没有依赖。",
    	taskPayloadTitle: "任务输入",
    	taskPayloadEmpty: "没有输入。",
    	taskAttemptsTitle: "执行记录",
    	taskAttemptsEmpty: "还没有执行记录。",
    	taskDetailsTitle: "更多信息",
    	taskUnclaimed: "未认领",
    	taskAttemptStopReason: "停止原因",
    	taskAttemptError: "错误",
    	taskResultTitle: "结果",
    	taskResultEmpty: "还没有结果。",
    	taskResultText: "说明",
    	taskResultOutput: "结构化产出",
    	taskResultAttachments: "附件",
    	finalDeliverableTitle: "最终交付物",
    	taskActionsTitle: "操作",
    	taskActionsEmpty: "当前没有可执行的操作。",
    	actionClaim: "认领",
    	actionCancel: "取消任务",
    	actionRetry: "重试",
    	actionSubmitComplete: "提交结果",
    	actionSubmitting: "正在提交…",
    	actionTextLabel: "说明（可选）",
    	actionFormTitle: "填写结果",
    	actionFormHint: "按任务类型要求的字段填写。",
    	actionFormNoSchema: "该任务类型没有产出 schema，按 JSON 填写结果。",
    	actionJsonInvalid: "结果不是合法 JSON：",
    	actionCancelConfirm: "取消这个任务？依赖它的任务会阻塞。",
    	actionCancelConfirmAction: "确认取消",
    	taskActionDone: "操作已完成。",
    	taskActionFailed: "操作失败：",
    	openSession: "打开会话",
    	openSessionFailed: "打开会话失败：",
    	noUiWorkspace: "当前客户端没有 uiWorkspace 服务，无法打开会话。",
    	sessionLabel: "会话"
    };
    // .build/workflows/client/routing.js
    /**
    * 页面地址：hash 路由的解析与写回。
    *
    * 只使用 hash，不接管 DSH 外壳的路由；刷新、浏览器前进 / 后退、把某个作业
    * 发给别人，都靠这一层。抽屉、选中项这类一次性的交互不写进地址。
    */
    /** 合法的作业视图。 */
    const JOB_VIEWS = [
    	"overview",
    	"flow",
    	"board",
    	"outputs"
    ];
    /** 合法的工作流页签。 */
    const WORKFLOW_TABS = ["jobs", "definition"];
    /**
    * 把地址里的 hash 解析成路由；认不出来时回工作流列表。
    *
    * @param hash `location.hash`，可带或不带 `#`
    * @returns 路由
    */
    function parseRouteHash(hash) {
    	let parts;
    	try {
    		parts = hash.replace(/^#/u, "").replace(/^\//u, "").split("/").filter((part) => part !== "").map((part) => decodeURIComponent(part));
    	} catch {
    		return { kind: "workflows" };
    	}
    	if (parts[0] === "workflow" && typeof parts[1] === "string" && parts[1] !== "") {
    		const tab = WORKFLOW_TABS.find((candidate) => candidate === parts[2]) ?? "jobs";
    		return {
    			kind: "workflow",
    			workflowId: parts[1],
    			tab
    		};
    	}
    	if (parts[0] === "job" && typeof parts[1] === "string" && parts[1] !== "" && typeof parts[2] === "string" && parts[2] !== "") {
    		const view = JOB_VIEWS.find((candidate) => candidate === parts[3]) ?? "overview";
    		return {
    			kind: "job",
    			workflowId: parts[1],
    			jobId: parts[2],
    			view
    		};
    	}
    	return { kind: "workflows" };
    }
    /**
    * 路由 → hash。
    *
    * @param route
    * @returns 以 `#/` 开头的地址片段
    */
    function routeHash(route) {
    	if (route.kind === "workflow") return `#/workflow/${encodeURIComponent(route.workflowId)}/${route.tab}`;
    	if (route.kind === "job") return `#/job/${encodeURIComponent(route.workflowId)}/${encodeURIComponent(route.jobId)}/${route.view}`;
    	return "#/workflows";
    }
    /**
    * 页面首次挂载时的路由；非浏览器环境回工作流列表。
    *
    * @returns 路由
    */
    function initialRoute() {
    	if (typeof window === "undefined") return { kind: "workflows" };
    	try {
    		return parseRouteHash(window.location.hash);
    	} catch {
    		return { kind: "workflows" };
    	}
    }
    /**
    * 把路由写回地址栏。hash 未变化时不产生历史记录。
    *
    * @param route
    */
    function writeRouteHash(route) {
    	if (typeof window === "undefined") return;
    	const hash = routeHash(route);
    	try {
    		if (window.location.hash === hash) return;
    		window.location.hash = hash;
    	} catch {}
    }
    /**
    * 两个路由是否指向同一个页面（忽略页签 / 视图）。
    *
    * @param left
    * @param right
    * @returns
    */
    function sameRoutePage(left, right) {
    	if (left.kind !== right.kind) return false;
    	if (left.kind === "workflows") return true;
    	if (left.kind === "workflow" && right.kind === "workflow") return left.workflowId === right.workflowId;
    	if (left.kind === "job" && right.kind === "job") return left.jobId === right.jobId;
    	return false;
    }
    // .build/workflows/client/types.js
    /**
    * 浏览器一半的共享类型与常量。
    *
    * 这里的形状全部是**客户端本地定义**：按 ADR 0015 的 v5 契约声明，不 import
    * 宿主一半的任何模块，避免把 node 依赖带进浏览器包。
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
    * 失败原因 → 展示文本；字符串原样，对象优先取 message。
    *
    * @param failure
    * @returns
    */
    function errorTextOf(failure) {
    	if (failure === null || failure === void 0) return "";
    	if (failure instanceof Error) return failure.message;
    	if (typeof failure === "string") return failure;
    	if (isRecord(failure) && typeof failure.message === "string") return failure.message;
    	return jsonText(failure);
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
    * 页面通用小部件：状态标签、加载 / 失败 / 空态、键值行、只读 schema 与二次确认按钮。
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
    /** 空态 + 一个动作。 */
    function renderEmptyAction(title, hint, action) {
    	return h("div", { className: "buka-workflows-emptyBox" }, h("p", { className: "buka-workflows-empty" }, title), hint === null || hint === "" ? null : h("p", { className: "buka-workflows-hint" }, hint), action);
    }
    /** 状态标签（任务 / 作业 / 工作流通用）。 */
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
    /** 抽屉头部：标题 / 状态 / 头像 / 元信息，右侧是动作与关闭。 */
    function renderDrawerHead(options) {
    	return h("div", { className: "buka-workflows-drawerHead" }, h("div", { className: "buka-workflows-drawerHeadRow" }, options.avatar ?? null, h("div", { className: "buka-workflows-drawerHeading" }, h("div", { className: "buka-workflows-drawerTitleRow" }, h("h2", { className: "buka-workflows-drawerTitle" }, options.title), options.tag ?? null), options.meta === void 0 || options.meta === null || options.meta === "" ? null : h("div", { className: "buka-workflows-drawerMeta" }, options.meta)), h("div", { className: "buka-workflows-drawerActions" }, options.actions ?? null, h("button", {
    		type: "button",
    		className: "buka-workflows-drawerClose",
    		"aria-label": options.closeLabel,
    		title: options.closeLabel,
    		onClick: options.onClose
    	}, h("span", { "aria-hidden": true }, "×")))));
    }
    /** 长说明：默认收成三行，需要时展开；短文本原样显示。 */
    function ClampedText(props) {
    	const [open, setOpen] = react.default.useState(false);
    	const long = props.text.length > 120 || props.text.includes("\n");
    	const className = props.className ?? "";
    	return h("div", { className: "buka-workflows-clamped" }, h("p", { className: `buka-workflows-clampedText${className === "" ? "" : ` ${className}`}${long && !open ? " is-clamped" : ""}` }, props.text), long ? h("button", {
    		type: "button",
    		className: "buka-workflows-textButton",
    		onClick: () => setOpen((value) => !value)
    	}, open ? props.collapseLabel : props.expandLabel) : null);
    }
    /** 抽屉里的折叠区：默认收起，展开后才铺技术细节。 */
    function renderFold(title, children) {
    	return h("details", { className: "buka-workflows-fold" }, h("summary", { className: "buka-workflows-foldSummary" }, title), h("div", { className: "buka-workflows-foldBody" }, children));
    }
    /** 一行指标条：值在上、标签在下。 */
    function renderStatStrip(rows) {
    	return h("div", { className: "buka-workflows-statStrip" }, ...rows.map(([label, value]) => h("div", {
    		key: label,
    		className: "buka-workflows-stat"
    	}, h("span", { className: "buka-workflows-statValue" }, value), h("span", { className: "buka-workflows-statLabel" }, label))));
    }
    /**
    * 契约字段的紧凑展示：字段名、类型与说明收在同一个可换行的小标签里。
    *
    * @param page 页面上下文
    * @param schema 契约
    * @returns React 元素
    */
    function renderContractFields(page, schema) {
    	const { t } = page;
    	const fields = schemaFields(schema);
    	if (fields.length === 0) return h("span", { className: "buka-workflows-hint" }, t("schemaNoFields"));
    	return h("div", { className: "buka-workflows-contractFields" }, ...fields.map((field) => {
    		const description = typeof field.schema.description === "string" && field.schema.description !== "" ? field.schema.description : "";
    		return h("span", {
    			key: field.name,
    			className: "buka-workflows-contractField"
    		}, h("code", { className: "buka-workflows-inlineCode" }, field.name), h("span", { className: "buka-workflows-contractType" }, schemaTypeLabel(field.schema)), field.required ? h("span", {
    			className: "buka-workflows-required",
    			title: t("schemaFieldRequired"),
    			"aria-label": t("schemaFieldRequired")
    		}, "*") : null, description === "" ? null : h("span", { className: "buka-workflows-contractDesc" }, description));
    	}));
    }
    /** 区块：标题 + 内容。 */
    function renderSection(title, children, extra) {
    	return h("section", { className: "buka-workflows-section" }, h("div", { className: "buka-workflows-sectionHead" }, h("h3", { className: "buka-workflows-sectionTitle" }, title), extra ?? null), children);
    }
    /** 执行者展示：打工人 / 人 + 名字。 */
    function renderExecutor(page, executor) {
    	const { t } = page;
    	if (!isRecord(executor)) return t("taskTypeUnset");
    	if (executor.kind === "human") return t("actorHuman");
    	const kind = executor.kind === "worker" ? t("actorWorker") : t("taskTypeUnset");
    	const name = typeof executor.name === "string" && executor.name !== "" ? executor.name : "";
    	return name === "" ? kind : `${kind} · ${name}`;
    }
    /** 字段类型 → 展示文本。 */
    function schemaTypeLabel(schema) {
    	if (Array.isArray(schema.enum)) return `enum(${schema.enum.map(String).join(" | ")})`;
    	if (schema.const !== void 0) return String(schema.const);
    	const type = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
    	return typeof type === "string" && type !== "" ? type : "any";
    }
    /**
    * 只读展示一个值：有 schema 时按字段逐行展示、字段名用说明替代；没有 schema
    * 时按对象自身的键逐行展示。展示层不重复渲染原始 JSON。
    *
    * @param page 页面上下文
    * @param schema 契约
    * @param value 值
    * @param emptyText 空值提示
    * @returns React 元素
    */
    function renderReadonlyValue(page, schema, value, emptyText) {
    	const { t } = page;
    	if (value === void 0 || value === null) return h("p", { className: "buka-workflows-hint" }, emptyText);
    	if (!isRecord(value)) return h("div", { className: "buka-workflows-values" }, h("div", { className: "buka-workflows-valueRow" }, h("div", { className: "buka-workflows-valueValue" }, renderValue(value, t))));
    	const fields = schemaFields(schema);
    	const entries = fields.length > 0 ? fields.map((field) => ({
    		name: field.name,
    		description: field.schema.description
    	})) : Object.keys(value).map((name) => ({
    		name,
    		description: void 0
    	}));
    	if (entries.length === 0) return h("p", { className: "buka-workflows-hint" }, emptyText);
    	return h("div", { className: "buka-workflows-values" }, ...entries.map((entry) => {
    		const description = typeof entry.description === "string" && entry.description !== "" ? entry.description : "";
    		return h("div", {
    			key: entry.name,
    			className: "buka-workflows-valueRow"
    		}, h("span", { className: "buka-workflows-valueKey" }, description === "" ? entry.name : description, description === "" ? null : h("code", { className: "buka-workflows-inlineCode" }, entry.name)), h("div", { className: "buka-workflows-valueValue" }, renderValue(value[entry.name], t)));
    	}));
    }
    /** 单个值的展示。 */
    function renderValue(value, t) {
    	if (value === void 0 || value === null || value === "") return h("span", { className: "buka-workflows-hint" }, t("taskTypeUnset"));
    	if (typeof value === "string") return value;
    	if (typeof value === "number" || typeof value === "boolean") return String(value);
    	return h("pre", { className: "buka-workflows-pre is-inline" }, jsonText(value));
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
    /** 二次确认按钮：第一次点击换成确认 / 取消，不弹系统对话框。 */
    function ConfirmButton(props) {
    	const [pending, setPending] = react.default.useState(false);
    	const variant = props.variant ?? "outline";
    	const className = props.className ?? "buka-workflows-smallButton";
    	if (!pending) return h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant,
    		size: "sm",
    		className,
    		disabled: props.disabled === true,
    		onClick: () => setPending(true)
    	}, props.label);
    	return h("span", { className: "buka-workflows-confirm" }, props.confirmText === void 0 ? null : h("span", { className: "buka-workflows-confirmText" }, props.confirmText), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: `${className} is-danger`,
    		disabled: props.disabled === true,
    		onClick: () => {
    			setPending(false);
    			props.onConfirm();
    		}
    	}, props.confirmLabel), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className,
    		disabled: props.disabled === true,
    		onClick: () => setPending(false)
    	}, props.cancelLabel));
    }
    // .build/workflows/client/components/attachments.js
    /**
    * 附件预览抽屉：头部是文件身份与下载 / 关闭，正文按 Host 返回的 `kind` 分派。
    */
    /** 附件预览抽屉。 */
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
    	}, renderDrawerHead({
    		title: viewer.name,
    		meta,
    		actions: h("a", {
    			className: "buka-workflows-drawerDownload",
    			href: attachmentUrl(jobId, viewer.id),
    			download: viewer.name
    		}, t("attachmentDownload")),
    		onClose: actions.closeAttachment,
    		closeLabel: t("attachmentPreviewClose")
    	}), h("div", { className: "buka-workflows-drawerBody" }, ...body));
    }
    /** 当前作业 id。 */
    function jobIdOf$1(page) {
    	if (page.state.route.kind === "job") return page.state.route.jobId;
    	return page.state.job.data?.job?.id ?? "";
    }
    // .build/workflows/client/avatars.js
    /**
    * 预设头像：id → emoji / 底色。
    *
    * 预设表统一在界面侧公共包里，与 workers 页共用同一份；图模型只带 id，
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
    * 打工人头像小圆片：emoji 画在预设色的浅底上。[size] 是直径（px），`className`
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
    // .build/workflows/client/model.js
    /**
    * 页面数据模型：把 Host 返回的定义快照 / 任务记录收口成看板与流程图直接消费的形状。
    *
    * 服务端只给「岗位、通道、任务」，坐标与分组都在客户端算（见 `graph/layout.ts`）。
    */
    /** 取当前工作流详情里的定义快照；执行者补上打工人登记里的展示字段。 */
    function currentDefinition(state) {
    	const detail = state.workflow.data;
    	const definition = detail?.workflow?.definition;
    	if (!isRecord(definition)) return null;
    	const executors = /* @__PURE__ */ new Map();
    	for (const position of detail?.graph?.positions ?? []) if (typeof position.id === "string" && isRecord(position.executor)) executors.set(position.id, position.executor);
    	if (executors.size === 0) return definition;
    	const positions = asArray(definition.positions).map((position) => typeof position.id === "string" && executors.has(position.id) ? {
    		...position,
    		executor: executors.get(position.id)
    	} : position);
    	return {
    		...definition,
    		positions
    	};
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
    /** 把定义里的通道归一化。 */
    function channelsOf(definition) {
    	return asArray(definition?.channels).filter((channel) => typeof channel?.id === "string" && channel.id !== "" && typeof channel.from === "string" && channel.from !== "" && typeof channel.to === "string" && channel.to !== "").map((channel) => ({
    		id: channel.id,
    		label: typeof channel.label === "string" && channel.label !== "" ? channel.label : channel.id,
    		from: channel.from,
    		to: channel.to,
    		types: asArray(channel.types).filter((type) => typeof type === "string"),
    		back: channel.back === true
    	}));
    }
    /** 按 id 找通道；找不到时返回 null。 */
    function channelOf(definition, channelId) {
    	if (typeof channelId !== "string" || channelId === "") return null;
    	return channelsOf(definition).find((channel) => channel.id === channelId) ?? null;
    }
    /** 岗位标签；开始 / 结束用内建文案。 */
    function positionLabel(definition, positionId, builtin) {
    	if (positionId === "start") return builtin.start;
    	if (positionId === "end") return builtin.end;
    	const found = positionsOf(definition).find((position) => position.id === positionId);
    	return found === void 0 ? String(positionId ?? "") : found.label;
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
    /** 当前作业的启动者（开始 / 结束任务的执行者）；没有作业时为 null。 */
    function currentStarter(state) {
    	return state.job.data?.job?.starter ?? null;
    }
    /**
    * 启动者的展示文本：人（页面启动）或会话。
    *
    * @param starter
    * @param t
    * @returns 未知启动者时返回空串
    */
    function starterText(starter, t) {
    	if (!isRecord(starter)) return "";
    	return starter.kind === "session" ? t("starterSession") : t("starterHuman");
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
    * 看板行：启动者（开始 + 结束任务）+ 岗位（定义顺序）。
    *
    * 内建开始 / 结束任务的执行者是同一个启动者，因此合并成一行；岗位行只放
    * 定义里仍存在的岗位，契约外任务由调用方补行。
    *
    * @param definition
    * @param tasks
    * @param builtin
    * @returns
    */
    function boardRows(definition, tasks, builtin) {
    	const positions = positionsOf(definition);
    	const known = new Set(positions.map((position) => position.id));
    	const starterTasks = sortTasks(tasks.filter((task) => task.position === "start" || task.position === "end"));
    	const rows = [{
    		id: "starter",
    		kind: "starter",
    		label: builtin.starter,
    		executor: null,
    		tasks: starterTasks
    	}, ...positions.map((position) => ({
    		id: position.id,
    		kind: "position",
    		label: position.label,
    		executor: position.executor,
    		tasks: sortTasks(tasks.filter((task) => task.position === position.id))
    	}))];
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
    			rows.push(row);
    		}
    		row.tasks.push(task);
    	}
    	return rows;
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
    		case "worker": return "actorWorker";
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
    	const jobChannels = Array.isArray(jobDefinition.channels) ? jobDefinition.channels : [];
    	const start = workflowDefinition.start ?? jobDefinition.start;
    	const end = workflowDefinition.end ?? jobDefinition.end;
    	return {
    		...workflowDefinition,
    		positions: merged,
    		...jobChannels.length > 0 ? { channels: jobChannels } : workflowDefinition.channels !== void 0 ? { channels: workflowDefinition.channels } : {},
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
    /**
    * 任务进度：节点卡片与作业列表共用。
    *
    * @param tasks
    * @returns
    */
    function taskProgress(tasks) {
    	const progress = {
    		done: 0,
    		total: tasks.length,
    		running: 0,
    		ready: 0,
    		failed: 0,
    		pending: 0
    	};
    	for (const task of tasks) switch (task.status) {
    		case "completed":
    			progress.done += 1;
    			break;
    		case "running":
    			progress.running += 1;
    			break;
    		case "ready":
    			progress.ready += 1;
    			break;
    		case "failed":
    		case "blocked":
    			progress.failed += 1;
    			break;
    		case "cancelled": break;
    		default: progress.pending += 1;
    	}
    	return progress;
    }
    /**
    * 实时流程里哪些通道已经被走过：任务记录自己走过的通道 id。
    *
    * @param tasks
    * @returns 通道 id 的集合
    */
    function takenChannels(tasks) {
    	const taken = /* @__PURE__ */ new Set();
    	for (const task of tasks) if (typeof task.channel === "string" && task.channel !== "") taken.add(task.channel);
    	return taken;
    }
    /**
    * 结束任务（最终交付物的来源）。
    *
    * @param tasks
    * @returns
    */
    function endTaskSummary(tasks) {
    	return tasks.find((task) => task.position === "end") ?? null;
    }
    /**
    * 作业列表筛选。
    *
    * @param jobs
    * @param filter
    * @returns
    */
    function filterJobs(jobs, filter) {
    	return jobs.filter((job) => {
    		switch (filter) {
    			case "running": return job.status === "running";
    			case "completed": return job.status === "completed";
    			case "problem": return job.status === "failed" || job.status === "cancelled";
    			default: return true;
    		}
    	});
    }
    /**
    * 作业列表排序：运行中优先，其次编号倒序。
    *
    * @param jobs
    * @returns
    */
    function sortJobs(jobs) {
    	return [...jobs].sort((left, right) => {
    		const leftRunning = left.status === "running" ? 0 : 1;
    		const rightRunning = right.status === "running" ? 0 : 1;
    		if (leftRunning !== rightRunning) return leftRunning - rightRunning;
    		const leftSeq = typeof left.seq === "number" ? left.seq : 0;
    		const rightSeq = typeof right.seq === "number" ? right.seq : 0;
    		if (leftSeq !== rightSeq) return rightSeq - leftSeq;
    		const leftTime = typeof left.updatedAt === "string" ? left.updatedAt : "";
    		return (typeof right.updatedAt === "string" ? right.updatedAt : "").localeCompare(leftTime);
    	});
    }
    /**
    * 任务类型 id → 展示名。
    *
    * @param definition
    * @returns
    */
    function taskTypeLabels(definition) {
    	const labels = /* @__PURE__ */ new Map();
    	for (const { type } of allTaskTypes(definition)) if (typeof type.id === "string") labels.set(type.id, type.label ?? type.id);
    	return labels;
    }
    /**
    * 资产池：附件按来源任务分组；结束任务产出的组排在最前。
    *
    * @param attachments
    * @param tasks
    * @param definition
    * @param builtin
    * @returns
    */
    function assetGroups(attachments, tasks, definition, builtin) {
    	const byTask = /* @__PURE__ */ new Map();
    	for (const task of tasks) byTask.set(task.id, task);
    	const positionLabels = new Map(positionsOf(definition).map((position) => [position.id, position.label]));
    	const groups = /* @__PURE__ */ new Map();
    	for (const attachment of attachments) {
    		const taskId = typeof attachment.sourceTaskId === "string" && attachment.sourceTaskId !== "" ? attachment.sourceTaskId : "";
    		const task = taskId === "" ? null : byTask.get(taskId) ?? null;
    		const key = taskId === "" ? "__unlinked" : taskId;
    		let group = groups.get(key);
    		if (group === void 0) {
    			const position = typeof task?.position === "string" ? task.position : "";
    			const builtinLabel = position === "start" ? builtin.start : position === "end" ? builtin.end : "";
    			const positionLabel = builtinLabel !== "" ? "" : position === "" ? "" : positionLabels.get(position) ?? position;
    			group = {
    				key,
    				taskId,
    				label: builtinLabel !== "" ? builtinLabel : task === null ? "" : task.typeLabel ?? task.type ?? taskId,
    				positionLabel,
    				final: position === "end",
    				items: []
    			};
    			groups.set(key, group);
    		}
    		group.items.push(attachment);
    	}
    	const sorted = [...groups.values()].sort((left, right) => {
    		if (left.final !== right.final) return left.final ? -1 : 1;
    		if (left.key === "__unlinked") return 1;
    		if (right.key === "__unlinked") return -1;
    		return 0;
    	});
    	for (const group of sorted) group.items.sort((left, right) => {
    		const leftTime = typeof left.createdAt === "string" ? left.createdAt : "";
    		const rightTime = typeof right.createdAt === "string" ? right.createdAt : "";
    		return leftTime.localeCompare(rightTime);
    	});
    	return sorted;
    }
    // .build/workflows/client/components/definition-drawer.js
    /**
    * 定义结构的右侧抽屉：全局信息、岗位、开始 / 结束节点与通道。
    *
    * 抽屉只回答一个问题：所选节点 / 通道在定义里是什么。身份放在头部，契约字段
    * 收成紧凑标签；预算、完整契约这类技术细节放进默认收起的折叠区。
    */
    /** 定义抽屉。 */
    function renderDefinitionDrawer(page) {
    	const { t, state, actions } = page;
    	if (state.route.kind !== "workflow" || state.route.tab !== "definition") return null;
    	const selection = state.definitionSelection;
    	if (selection === null) return null;
    	const detail = state.workflow.data;
    	const definition = currentDefinition(state);
    	if (definition === null) return null;
    	const workflow = detail?.workflow;
    	const builtin = {
    		start: t("graphStart"),
    		end: t("graphEnd")
    	};
    	const positions = positionsOf(definition);
    	const labels = taskTypeLabels(definition);
    	const title = titleOf(page, selection, definition);
    	const position = selection.kind === "position" ? positions.find((item) => item.id === selection.id) : void 0;
    	const avatar = position !== void 0 && typeof position.executor.avatar === "string" ? renderAvatar(position.executor.avatar, 28, "buka-workflows-drawerAvatar") : null;
    	const body = [];
    	if (selection.kind === "info") {
    		const types = allTaskTypes(definition);
    		body.push(renderStatStrip([
    			[t("workflowVersionName"), `v${workflow?.version ?? 0}`],
    			[t("definitionPositions"), String(positions.length)],
    			[t("taskTypesTitle"), String(types.length)],
    			[t("budgetMaxTasks"), budgetTasks(page, definition)],
    			[t("budgetMaxDuration"), budgetDuration(page, definition)]
    		]));
    		if (typeof workflow?.description === "string" && workflow.description !== "") body.push(h(ClampedText, {
    			key: "desc",
    			text: workflow.description,
    			className: "buka-workflows-drawerText",
    			expandLabel: t("expandText"),
    			collapseLabel: t("collapseText")
    		}));
    		body.push(renderSection(t("definitionInitialTasks"), Array.isArray(definition.start?.next) && definition.start.next.length > 0 ? h("ul", { className: "buka-workflows-initialList" }, ...definition.start.next.map((initial, index) => {
    			const channel = channelOf(definition, initial.channel);
    			return h("li", {
    				key: `${initial.channel ?? ""}-${index}`,
    				className: "buka-workflows-initialRow"
    			}, h("span", { className: "buka-workflows-initialMain" }, h("strong", null, channel === null ? initial.channel ?? "" : positionLabel(definition, channel.to, builtin)), h("span", { className: "buka-workflows-hint" }, [channel === null ? "" : `「${channel.label}」`, labels.get(initial.type ?? "") ?? initial.type ?? ""].filter((part) => part !== "").join(" · "))), h("span", { className: "buka-workflows-hint" }, fill(t, "initialDeps", { n: initial.dependsOn?.length ?? 0 })));
    		})) : h("p", { className: "buka-workflows-hint" }, t("definitionInitialEmpty"))));
    		body.push(renderFold(t("definitionStartContract"), h("div", { className: "buka-workflows-contractStack" }, contractBlock(page, t("taskTypePayload"), t("startPayloadHint"), definition.start?.task?.payload), contractBlock(page, t("taskTypeOutput"), t("startOutputHint"), definition.start?.task?.output))), renderFold(t("definitionEndContract"), contractBlock(page, t("taskTypePayload"), t("endPayloadHint"), definition.end?.task?.payload)));
    	} else if (selection.kind === "position") {
    		if (position === void 0) body.push(h("p", { className: "buka-workflows-hint" }, t("notFound")));
    		else {
    			if (position.description !== "") body.push(h(ClampedText, {
    				key: "desc",
    				text: position.description,
    				className: "buka-workflows-drawerText",
    				expandLabel: t("expandText"),
    				collapseLabel: t("collapseText")
    			}));
    			body.push(renderSection(t("taskTypesTitle"), position.taskTypes.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("taskTypesEmpty")) : h("div", { className: "buka-workflows-typeList" }, ...position.taskTypes.map((type) => renderTaskType(page, type, labels)))));
    		}
    	} else if (selection.kind === "start" || selection.kind === "end") {
    		const isStart = selection.kind === "start";
    		body.push(h("p", { className: "buka-workflows-drawerText" }, isStart ? t("startContractHint") : t("endContractHint")), renderSection(t("taskTypePayload"), h("div", { className: "buka-workflows-contractStack" }, h("p", { className: "buka-workflows-sectionHint" }, isStart ? t("startPayloadHint") : t("endPayloadHint")), renderContractFields(page, definition.start?.task?.payload))));
    		if (isStart) body.push(renderSection(t("taskTypeOutput"), h("div", { className: "buka-workflows-contractStack" }, h("p", { className: "buka-workflows-sectionHint" }, t("startOutputHint")), renderContractFields(page, definition.start?.task?.output))));
    	} else {
    		const channel = channelOf(definition, selection.id);
    		if (channel === null) body.push(h("p", { className: "buka-workflows-hint" }, t("notFound")));
    		else body.push(renderSection(t("channelAllowedTypes"), channel.types.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("channelAllTypes")) : h("div", { className: "buka-workflows-tagRow" }, ...channel.types.map((type) => h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    			key: type,
    			tone: "neutral"
    		}, labels.get(type) ?? type)))));
    	}
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: () => actions.selectDefinition(null),
    		title,
    		closeLabel: t("close"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer buka-workflows-inspector"
    	}, renderDrawerHead({
    		title,
    		avatar,
    		meta: headerMeta(page, selection, position, definition),
    		onClose: () => actions.selectDefinition(null),
    		closeLabel: t("close")
    	}), h("div", { className: "buka-workflows-drawerBody" }, ...body));
    }
    /** 头部第二行：执行者 / 通道 id 与端点 / 回向标记，没有可说的就留空。 */
    function headerMeta(page, selection, position, definition) {
    	const { t } = page;
    	if (selection.kind === "position") {
    		if (position === void 0) return null;
    		const text = renderExecutor(page, position.executor);
    		return text === t("taskTypeUnset") ? null : text;
    	}
    	if (selection.kind === "channel") {
    		const channel = channelOf(definition, selection.id);
    		if (channel === null) return null;
    		const builtin = {
    			start: t("graphStart"),
    			end: t("graphEnd")
    		};
    		const route = `${positionLabel(definition, channel.from, builtin)} → ${positionLabel(definition, channel.to, builtin)}`;
    		return [
    			channel.id,
    			route,
    			channel.back ? t("channelBack") : ""
    		].filter((part) => part !== "").join(" · ");
    	}
    	return null;
    }
    /** 抽屉标题。 */
    function titleOf(page, selection, definition) {
    	const { t } = page;
    	if (selection.kind === "info") return t("definitionInfo");
    	if (selection.kind === "start") return t("startTaskTitle");
    	if (selection.kind === "end") return t("endTaskTitle");
    	if (selection.kind === "position") return positionsOf(definition).find((item) => item.id === selection.id)?.label ?? selection.id;
    	const channel = channelOf(definition, selection.id);
    	return channel === null ? t("channelTitle") : channel.label;
    }
    /** 一个任务类型：标题 + 说明 + 输入 / 产出两行契约。 */
    function renderTaskType(page, type, labels) {
    	const { t } = page;
    	const id = typeof type.id === "string" ? type.id : "";
    	const requires = Array.isArray(type.requires) ? type.requires.flatMap((item) => Array.isArray(item.types) ? item.types : []) : [];
    	return h("article", {
    		key: id === "" ? type.label ?? "type" : id,
    		className: "buka-workflows-typeRow"
    	}, h("div", { className: "buka-workflows-typeRowHead" }, h("span", { className: "buka-workflows-typeName" }, type.label ?? id), id === "" ? null : h("code", { className: "buka-workflows-inlineCode" }, id), h("span", { className: "buka-workflows-typeTags" }, typeof type.assistant === "string" && type.assistant !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `${t("taskTypeAssistant")} · ${type.assistant}`) : null, type.mode === "plan" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("taskTypeModePlan")) : null)), typeof type.description === "string" && type.description !== "" ? h(ClampedText, {
    		text: type.description,
    		className: "buka-workflows-typeDesc",
    		expandLabel: t("expandText"),
    		collapseLabel: t("collapseText")
    	}) : null, h("div", { className: "buka-workflows-contractStack is-tight" }, contractLine(t("taskTypePayload"), contractOrDash(page, type.payload)), contractLine(t("taskTypeOutput"), contractOrDash(page, type.output))), requires.length === 0 ? null : contractLine(t("taskTypeRequires"), h("div", { className: "buka-workflows-tagRow" }, ...requires.map((required) => h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    		key: required,
    		tone: "neutral"
    	}, labels.get(required) ?? required)))));
    }
    /** 契约的一行：左侧短标签，右侧字段标签。 */
    function contractLine(label, content) {
    	return h("div", { className: "buka-workflows-contractLine" }, h("span", { className: "buka-workflows-contractLabel" }, label), h("div", { className: "buka-workflows-contractValue" }, content));
    }
    /** 有契约就渲染字段，没有契约给一个短横线占位。 */
    function contractOrDash(page, schema) {
    	return schema === null || schema === void 0 ? h("span", { className: "buka-workflows-hint" }, page.t("taskTypeUnset")) : renderContractFields(page, schema);
    }
    /** 带说明的契约块（开始 / 结束节点）。 */
    function contractBlock(page, label, hint, schema) {
    	return h("div", { className: "buka-workflows-contractBlock" }, h("span", { className: "buka-workflows-fieldLabel" }, label), h("p", { className: "buka-workflows-sectionHint" }, hint), renderContractFields(page, schema));
    }
    /** 预算：任务数。 */
    function budgetTasks(page, definition) {
    	const value = definition.budgets?.maxTasks;
    	return typeof value === "number" ? String(value) : page.t("budgetUnset");
    }
    /** 预算：最长时长。 */
    function budgetDuration(page, definition) {
    	const value = definition.budgets?.maxDurationHours;
    	return typeof value === "number" ? `${value} ${page.t("budgetHours")}` : page.t("budgetUnset");
    }
    // .build/workflows/client/components/board.js
    /**
    * 作业看板：行 = 启动者（开始 / 结束任务合并）+ 岗位，
    * 列 = 排队 / 待认领 / 进行中 / 已完成 / 异常。
    *
    * 宽屏是网格；窄屏退化成按状态分组的纵向列表。
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
    /** 看板视图。 */
    function renderBoard(page) {
    	const { t, state } = page;
    	const tasks = jobTasks(state);
    	if (tasks.length === 0) return renderEmpty(t("boardEmpty"), t("boardEmptyHint"));
    	const rows = boardRows(mergedDefinition(currentJobDefinition(state), currentDefinition(state)), tasks, { starter: t("boardStarter") }).filter((row) => row.kind === "position" || row.tasks.length > 0);
    	return h("div", { className: "buka-workflows-boardPane" }, h("p", { className: "buka-workflows-hint" }, t("boardHint")), page.narrow ? renderCompactBoard(page, rows) : h("div", { className: "buka-workflows-board" }, h("div", { className: "buka-workflows-boardGrid" }, h("div", {
    		className: "buka-workflows-boardHeader",
    		role: "row"
    	}, h("div", { className: "buka-workflows-boardRowHead" }, ""), ...COLUMNS.map((column) => h("div", {
    		key: column.key,
    		className: `buka-workflows-boardColumnHead is-${column.key}`,
    		role: "columnheader"
    	}, t(column.labelKey)))), ...rows.map((row) => renderBoardRow(page, row)))));
    }
    /** 网格里的一行。 */
    function renderBoardRow(page, row) {
    	const { t } = page;
    	const cellTasks = /* @__PURE__ */ new Map();
    	for (const task of row.tasks) {
    		const key = boardColumn(task.status);
    		const list = cellTasks.get(key);
    		if (list === void 0) cellTasks.set(key, [task]);
    		else list.push(task);
    	}
    	const executor = row.kind === "starter" ? starterText(currentStarter(page.state), t) : row.executor === null ? "" : renderExecutor(page, row.executor);
    	return h("div", {
    		key: row.id,
    		className: `buka-workflows-boardRow is-${row.kind}`,
    		role: "row"
    	}, h("div", { className: "buka-workflows-boardRowHead" }, h("span", { className: "buka-workflows-boardRowTitle" }, row.label), executor === "" ? null : h("span", { className: "buka-workflows-boardRowExecutor" }, executor), h("span", { className: "buka-workflows-boardRowMeta" }, row.tasks.length === 0 ? t("boardNoTasks") : fill(t, "taskCount", { n: row.tasks.length }))), ...COLUMNS.map((column) => {
    		const list = cellTasks.get(column.key) ?? [];
    		return h("div", {
    			key: column.key,
    			className: `buka-workflows-boardCell is-${column.key}`,
    			role: "cell"
    		}, ...list.map((task) => renderBoardCard(page, task, false)));
    	}));
    }
    /** 窄屏：按状态分组的纵向列表。 */
    function renderCompactBoard(page, rows) {
    	const { t } = page;
    	const labels = /* @__PURE__ */ new Map();
    	for (const row of rows) {
    		labels.set(row.id, row.label);
    		if (row.kind === "starter") {
    			labels.set("start", row.label);
    			labels.set("end", row.label);
    		}
    	}
    	const groups = COLUMNS.map((column) => ({
    		column,
    		tasks: rows.flatMap((row) => row.tasks).filter((task) => boardColumn(task.status) === column.key)
    	})).filter((group) => group.tasks.length > 0);
    	return h("div", { className: "buka-workflows-boardCompact" }, ...groups.map((group) => h("section", {
    		key: group.column.key,
    		className: "buka-workflows-boardGroup"
    	}, h("h4", { className: `buka-workflows-boardGroupTitle is-${group.column.key}` }, t(group.column.labelKey), h("span", { className: "buka-workflows-boardGroupCount" }, String(group.tasks.length))), h("ul", { className: "buka-workflows-taskList" }, ...group.tasks.map((task) => renderBoardCard(page, task, true, labels.get(task.position ?? "") ?? ""))))));
    }
    /** 看板卡片。 */
    function renderBoardCard(page, task, compact, positionLabel = "") {
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
    	return h(compact ? "li" : "div", {
    		key: task.id,
    		className: "buka-workflows-taskItem"
    	}, h("button", {
    		type: "button",
    		className: `buka-workflows-taskCard is-${task.status ?? "pending"}`,
    		onClick: () => actions.openTask(task.id)
    	}, compact && positionLabel !== "" ? h("span", { className: "buka-workflows-taskCardPosition" }, positionLabel) : null, h("span", { className: "buka-workflows-taskCardHead" }, h("span", { className: "buka-workflows-taskCardType" }, task.typeLabel ?? task.type ?? task.id), compact ? renderStatusTag(t, task.status, "task") : null), claimant === "" ? null : h("span", { className: "buka-workflows-taskCardMeta" }, `${t("taskClaimant")}: ${claimant}`), summary === "" ? null : h("span", { className: "buka-workflows-taskCardSummary" }, summary), meta.length === 0 ? null : h("span", { className: "buka-workflows-taskCardMeta" }, meta.join(" · "))));
    }
    // .build/workflows/client/graph/layout.js
    /** 估算文本宽度时的字宽：CJK 按一个字号，拉丁字母按半个多一点。 */
    const CJK_WIDTH = 13.5;
    const LATIN_WIDTH = 7.8;
    /** 文本与边框之间的安全余量。 */
    const LABEL_SLACK = 4;
    /** 节点最小 / 最大宽度。 */
    const MIN_NODE_WIDTH = 58;
    const MAX_NODE_WIDTH = 200;
    /** 节点高度。 */
    const NODE_HEIGHT = 34;
    /** 同层节点水平间距。 */
    const GAP_X = 18;
    /** 层间垂直间距。 */
    const GAP_Y = 42;
    /** 回向通道绕行的基础横向偏移。 */
    const BACK_OFFSET = 20;
    /** 多条回向通道之间的横向间隔。 */
    const BACK_STEP = 10;
    /** 同一对节点的多条前向通道之间的横向间隔。 */
    const LANE_STEP = 16;
    /** 回向通道绕行额外留白（单侧）。 */
    const BACK_EXTRA = 12;
    /**
    * 计算分层的上下坐标与通道路径。
    *
    * @param nodes 节点
    * @param rawEdges 通道
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
    	const rowWidth = Math.max(1, ...layerKeys.map((layer) => rowWidthOf(byLayer.get(layer) ?? [])));
    	const backCount = edges.filter((edge) => isBackEdge(edge, layers)).length;
    	const backPad = backCount === 0 ? 0 : BACK_OFFSET + Math.max(0, backCount - 1) * BACK_STEP + BACK_EXTRA;
    	const pairCounts = /* @__PURE__ */ new Map();
    	for (const edge of edges) {
    		const pair = `${edge.from}->${edge.to}`;
    		pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    	}
    	const lanePad = (Math.max(1, ...pairCounts.values()) - 1) * LANE_STEP;
    	const width = 48 + rowWidth + backPad * 2 + lanePad * 2;
    	const height = 48 + layerKeys.length * NODE_HEIGHT + Math.max(0, layerKeys.length - 1) * GAP_Y;
    	const byId = /* @__PURE__ */ new Map();
    	const laidOut = [];
    	layerKeys.forEach((layer, index) => {
    		const group = byLayer.get(layer) ?? [];
    		const groupWidth = rowWidthOf(group);
    		let cursor = (width - groupWidth) / 2;
    		for (const node of group) {
    			const nodeWidth = widthOf(node);
    			const laid = {
    				...node,
    				x: cursor + nodeWidth / 2,
    				y: 41 + index * 76,
    				layer,
    				width: nodeWidth,
    				height: NODE_HEIGHT
    			};
    			laidOut.push(laid);
    			byId.set(node.id, laid);
    			cursor += nodeWidth + GAP_X;
    		}
    	});
    	const laidOutEdges = [];
    	const usedKeys = /* @__PURE__ */ new Map();
    	const pairSeen = /* @__PURE__ */ new Map();
    	let backLane = 0;
    	for (const edge of edges) {
    		const from = byId.get(edge.from);
    		const to = byId.get(edge.to);
    		if (from === void 0 || to === void 0) continue;
    		const back = isBackEdge(edge, layers);
    		const baseKey = `${edge.from}->${edge.to}`;
    		const seen = usedKeys.get(baseKey) ?? 0;
    		usedKeys.set(baseKey, seen + 1);
    		const key = seen === 0 ? baseKey : `${baseKey}#${seen}`;
    		const pair = pairCounts.get(baseKey) ?? 1;
    		const lane = pairSeen.get(baseKey) ?? 0;
    		pairSeen.set(baseKey, lane + 1);
    		const types = Array.isArray(edge.types) ? edge.types.filter((type) => typeof type === "string") : [];
    		const geometry = back ? backEdgeGeometry(from, to, backLane, width) : forwardEdgeGeometry(from, to, pair <= 1 ? 0 : (lane - (pair - 1) / 2) * LANE_STEP);
    		if (back) backLane += 1;
    		laidOutEdges.push({
    			key,
    			id: edge.id,
    			label: typeof edge.label === "string" ? edge.label : "",
    			from: edge.from,
    			to: edge.to,
    			kind: back ? "back" : "forward",
    			types,
    			state: edge.state === "taken" ? "taken" : "open",
    			...geometry
    		});
    	}
    	return {
    		width,
    		height,
    		nodes: laidOut,
    		edges: laidOutEdges
    	};
    }
    /** 一个节点的宽度：由头像与岗位名内容决定，不预留固定留白。 */
    function widthOf(node) {
    	let content = 0;
    	for (const char of node.label) content += (char.codePointAt(0) ?? 0) >= 11904 ? CJK_WIDTH : LATIN_WIDTH;
    	const width = 20 + (node.kind === "position" ? 22 : 0) + content + LABEL_SLACK;
    	return Math.round(Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, width)));
    }
    /** 同一层排开后的总宽度。 */
    function rowWidthOf(group) {
    	let width = Math.max(0, group.length - 1) * GAP_X;
    	for (const node of group) width += widthOf(node);
    	return width;
    }
    /**
    * 是不是回向通道：显式标记，或指向同层 / 更上层。
    *
    * @param edge
    * @param layers
    * @returns
    */
    function isBackEdge(edge, layers) {
    	if (edge.back === true) return true;
    	return (layers.get(edge.to) ?? 0) <= (layers.get(edge.from) ?? 0);
    }
    /**
    * 最长路径分层：开始节点固定第 0 层，结束节点固定最后一层；回向通道不参与分层。
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
    * 向下的通道：从下层节点的底边中点连到目标节点的顶边中点；同一对节点的
    * 多条通道用 `offset` 错开车道。
    *
    * @param from
    * @param to
    * @param offset 横向车道偏移
    * @returns
    */
    function forwardEdgeGeometry(from, to, offset = 0) {
    	const x1 = from.x;
    	const y1 = from.y + from.height / 2;
    	const x2 = to.x;
    	const y2 = to.y - to.height / 2;
    	const control = Math.max(16, (y2 - y1) / 2);
    	const p0 = {
    		x: x1,
    		y: y1
    	};
    	const p1 = {
    		x: x1 + offset,
    		y: y1 + control
    	};
    	const p2 = {
    		x: x2 + offset,
    		y: y2 - control
    	};
    	const p3 = {
    		x: x2,
    		y: y2
    	};
    	const d = `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`;
    	const point = cubicPoint(p0, p1, p2, p3, .8);
    	const tangent = cubicTangent(p0, p1, p2, p3, .8);
    	return {
    		d,
    		hit: d,
    		arrow: {
    			x: point.x,
    			y: point.y,
    			angle: angleOf(tangent)
    		},
    		labelAt: cubicPoint(p0, p1, p2, p3, .5)
    	};
    }
    /**
    * 回向通道：从节点右侧绕出去，再回到目标的右侧，避免穿过中间的节点。
    *
    * @param from
    * @param to
    * @param lane 第几条回向通道，用来错开绕行线
    * @param width 画布宽度
    * @returns
    */
    function backEdgeGeometry(from, to, lane, width) {
    	const x1 = from.x + from.width / 2;
    	const y1 = from.y;
    	const x2 = to.x + to.width / 2;
    	const y2 = to.y;
    	const laneX = Math.min(width - 8, Math.max(x1, x2) + BACK_OFFSET + lane * BACK_STEP);
    	const p0 = {
    		x: x1,
    		y: y1
    	};
    	const p1 = {
    		x: laneX,
    		y: y1
    	};
    	const p2 = {
    		x: laneX,
    		y: y2
    	};
    	const p3 = {
    		x: x2,
    		y: y2
    	};
    	const d = `M ${fmt(x1)} ${fmt(y1)} C ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x2)} ${fmt(y2)}`;
    	const point = cubicPoint(p0, p1, p2, p3, .94);
    	const tangent = cubicTangent(p0, p1, p2, p3, .94);
    	return {
    		d,
    		hit: d,
    		arrow: {
    			x: point.x,
    			y: point.y,
    			angle: angleOf(tangent)
    		},
    		labelAt: cubicPoint(p0, p1, p2, p3, .5)
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
    * 流程图渲染：SVG 连线 + 绝对定位的节点卡片。
    *
    * 定义结构与实时流程共用同一套布局和卡片；区别只在节点 / 边的数据与
    * 点击后的动作。
    */
    /** 流程图组件：负责测量容器宽度做等比缩放。 */
    function GraphView(props) {
    	const { page, ...options } = props;
    	const { t } = page;
    	const layout = layoutGraph(options.nodes, options.edges);
    	const mode = options.mode ?? "definition";
    	const showLegend = options.showLegend ?? true;
    	const fit = options.fit ?? true;
    	const selectedNodeId = options.selectedNodeId ?? null;
    	const selectedChannelId = options.selectedChannelId ?? null;
    	const ref = react.default.useRef(null);
    	const [scale, setScale] = react.default.useState(1);
    	const [hoveredEdgeKey, setHoveredEdgeKey] = react.default.useState(null);
    	const hoveredEdge = layout.edges.find((edge) => edge.key === hoveredEdgeKey) ?? null;
    	react.default.useEffect(() => {
    		if (!fit) return void 0;
    		const element = ref.current;
    		if (element === null) return void 0;
    		const update = () => {
    			const available = element.clientWidth;
    			if (!Number.isFinite(available) || available <= 0) return;
    			setScale(Math.min(1, available / layout.width));
    		};
    		update();
    		if (typeof ResizeObserver !== "function") return void 0;
    		const observer = new ResizeObserver(update);
    		observer.observe(element);
    		return () => observer.disconnect();
    	}, [fit, layout.width]);
    	return h("div", { className: "buka-workflows-graphPane" }, h("div", {
    		ref,
    		className: "buka-workflows-graphViewport"
    	}, h("div", {
    		className: "buka-workflows-graphScaleBox",
    		style: {
    			width: `${Math.ceil(layout.width * scale)}px`,
    			height: `${Math.ceil(layout.height * scale)}px`
    		}
    	}, h("div", {
    		className: "buka-workflows-graphCanvas",
    		style: {
    			width: `${layout.width}px`,
    			height: `${layout.height}px`,
    			transform: scale === 1 ? void 0 : `scale(${scale})`,
    			transformOrigin: "top left"
    		},
    		role: "group",
    		"aria-label": t("graphAria")
    	}, h("svg", {
    		className: "buka-workflows-graphSvg",
    		width: layout.width,
    		height: layout.height,
    		viewBox: `0 0 ${layout.width} ${layout.height}`
    	}, ...layout.edges.map((edge) => {
    		const selected = selectedChannelId !== null && edge.id === selectedChannelId;
    		return h("g", {
    			key: edge.key,
    			className: `buka-workflows-edgeGroup is-${edge.kind}${edge.state === "taken" ? " is-taken" : ""}${selected ? " is-selected" : ""}`
    		}, h("path", {
    			key: `${edge.key}-path`,
    			className: `buka-workflows-edge is-${edge.kind}${edge.state === "taken" ? " is-taken" : ""}`,
    			d: edge.d
    		}), h("path", {
    			key: `${edge.key}-hit`,
    			className: "buka-workflows-hitPath",
    			d: edge.hit,
    			onMouseEnter: () => setHoveredEdgeKey(edge.key),
    			onMouseLeave: () => setHoveredEdgeKey((current) => current === edge.key ? null : current),
    			onFocus: () => setHoveredEdgeKey(edge.key),
    			onBlur: () => setHoveredEdgeKey((current) => current === edge.key ? null : current),
    			"aria-label": edge.label === "" ? edge.id : edge.label,
    			...options.onEdgeClick === null || options.onEdgeClick === void 0 ? {} : {
    				onClick: () => options.onEdgeClick(edge),
    				role: "button",
    				tabIndex: 0
    			}
    		}), edge.labelAt === null || edge.label === "" ? null : h("text", {
    			key: `${edge.key}-label`,
    			className: `buka-workflows-edgeLabel is-${edge.kind}${edge.state === "taken" ? " is-taken" : ""}`,
    			x: round(edge.labelAt.x),
    			y: round(edge.labelAt.y),
    			textAnchor: "middle",
    			dominantBaseline: "middle"
    		}, clipLabel(edge.label)), h("g", {
    			key: `${edge.key}-arrow`,
    			className: `buka-workflows-edgeArrow is-${edge.kind}${edge.state === "taken" ? " is-taken" : ""}`,
    			transform: `translate(${round(edge.arrow.x)} ${round(edge.arrow.y)}) rotate(${round(edge.arrow.angle)})`
    		}, h("path", { d: "M-4,-3.5 L4,0 L-4,3.5 Z" })));
    	})), ...layout.nodes.map((node) => {
    		const selected = selectedNodeId === node.id;
    		const status = node.status ?? "idle";
    		const stateName = mode === "live" ? ` is-${stateClass(status)}` : "";
    		const clickable = options.onNodeClick !== null && options.onNodeClick !== void 0;
    		const tag = node.kind === "position" ? node.executor?.kind === "human" ? "is-human" : "is-worker" : node.kind === "start" ? "is-start" : "is-end";
    		const corner = mode === "live" && typeof node.meta === "string" && node.meta !== "" ? h("span", {
    			key: "corner",
    			className: `buka-workflows-nodeCorner is-${stateClass(status)}`,
    			"aria-hidden": true
    		}, node.meta) : null;
    		return h("div", {
    			key: node.id,
    			className: "buka-workflows-nodeWrap",
    			style: {
    				left: `${node.x - node.width / 2}px`,
    				top: `${node.y - node.height / 2}px`,
    				width: `${node.width}px`,
    				height: `${node.height}px`
    			}
    		}, clickable ? h("button", {
    			type: "button",
    			className: `buka-workflows-node ${tag}${stateName}${selected ? " is-selected" : ""}`,
    			title: node.title ?? node.label,
    			"aria-pressed": selected,
    			onClick: () => options.onNodeClick(node.id)
    		}, renderAvatar(node.avatar, 16, "buka-workflows-nodeAvatar"), h("span", { className: "buka-workflows-nodeLabel" }, node.label), corner) : h("span", { className: `buka-workflows-node ${tag}${stateName}` }, renderAvatar(node.avatar, 16, "buka-workflows-nodeAvatar"), h("span", { className: "buka-workflows-nodeLabel" }, node.label), corner));
    	})), hoveredEdge === null || hoveredEdge.labelAt === null || hoveredEdge.label === "" || !isClipped(hoveredEdge.label) ? null : h("span", {
    		key: "edge-tip",
    		className: "buka-workflows-edgeTip",
    		style: {
    			left: `${hoveredEdge.labelAt.x * scale}px`,
    			top: `${(hoveredEdge.labelAt.y - 14) * scale}px`
    		}
    	}, hoveredEdge.label))), options.caption === null || options.caption === void 0 ? null : h("p", { className: "buka-workflows-hint buka-workflows-graphCaption" }, options.caption), showLegend ? renderGraphLegend(page, mode) : null);
    }
    /**
    * 画一张流程图。
    *
    * @param page
    * @param options
    * @returns React 元素
    */
    function renderWorkflowGraph(page, options) {
    	return h(GraphView, {
    		...options,
    		page
    	});
    }
    /**
    * 图例：节点类型、任务状态、连线。
    *
    * @param page
    * @param mode
    * @returns
    */
    function renderGraphLegend(page, mode = "definition") {
    	const { t } = page;
    	const types = [
    		["is-start", t("graphStart")],
    		["is-worker", t("graphWorker")],
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
    	const edges = [
    		["forward", t("graphChannelForward")],
    		["back", t("graphChannelBack")],
    		...mode === "live" ? [["taken", t("graphChannelTaken")]] : []
    	];
    	return h("div", { className: "buka-workflows-legend" }, h("span", { className: "buka-workflows-legendGroup" }, ...types.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendNode ${kind}`,
    		"aria-hidden": true
    	}), label))), mode === "live" ? h("span", { className: "buka-workflows-legendGroup" }, ...states.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendDot is-${kind}`,
    		"aria-hidden": true
    	}), label))) : null, h("span", { className: "buka-workflows-legendGroup" }, ...edges.map(([kind, label]) => h("span", {
    		key: kind,
    		className: "buka-workflows-legendItem"
    	}, h("span", {
    		className: `buka-workflows-legendLine is-${kind}`,
    		"aria-hidden": true
    	}), label))));
    }
    /** 数字保留两位小数，减少 DOM 字符串抖动。 */
    function round(value) {
    	return Math.round(value * 100) / 100;
    }
    /** 连线上的标签：过长时截断，悬停能看到全文。 */
    const LABEL_MAX = 14;
    /** 标签是否被截断（只有截断时才需要悬停提示）。 */
    function isClipped(label) {
    	return [...label].length > LABEL_MAX;
    }
    /** 截断后的画布标签。 */
    function clipLabel(label, max = LABEL_MAX) {
    	const chars = [...label];
    	return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
    }
    // .build/workflows/client/components/job-flow.js
    /**
    * 作业的实时流程：同一份任务数据按岗位聚合后画在定义图上。
    *
    * 节点表达「谁在做什么、做了多少、哪里在等认领、哪里出了问题」；点节点
    * 打开该岗位的任务列表（单任务直接进任务抽屉）。
    */
    /** 实时流程视图。 */
    function renderJobFlow(page) {
    	const { t, state, actions } = page;
    	const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state));
    	const tasks = jobTasks(state);
    	const positions = positionsOf(definition);
    	const taken = takenChannels(tasks);
    	const tasksOf = (positionId) => tasks.filter((task) => task.position === positionId);
    	const metaOf = (list) => {
    		const progress = taskProgress(list);
    		return progress.total === 0 ? "" : `${progress.done}/${progress.total}`;
    	};
    	/** 悬浮说明：角标只给数量，具体状态在 title 里展开。 */
    	const titleOf = (label, list) => {
    		const progress = taskProgress(list);
    		if (progress.total === 0) return label;
    		const parts = [`${progress.done}/${progress.total} ${t("statusCompleted")}`];
    		if (progress.ready > 0) parts.push(`${progress.ready} ${t("statusReady")}`);
    		if (progress.running > 0) parts.push(`${progress.running} ${t("statusRunning")}`);
    		if (progress.failed > 0) parts.push(`${progress.failed} ${t("statusFailed")}`);
    		if (progress.pending > 0) parts.push(`${progress.pending} ${t("statusPending")}`);
    		return `${label} · ${parts.join(" · ")}`;
    	};
    	const aggregateOf = (list) => {
    		if (list.length === 0) return "idle";
    		if (list.some((task) => task.status === "running")) return "running";
    		if (list.some((task) => task.status === "ready")) return "ready";
    		if (list.some((task) => task.status === "failed" || task.status === "blocked")) return "failed";
    		if (list.some((task) => task.status === "pending")) return "pending";
    		if (list.every((task) => task.status === "completed")) return "completed";
    		return "idle";
    	};
    	return renderWorkflowGraph(page, {
    		nodes: [
    			{
    				id: "start",
    				label: t("boardStart"),
    				kind: "start",
    				status: aggregateOf(tasksOf("start")),
    				meta: metaOf(tasksOf("start")),
    				title: titleOf(t("boardStart"), tasksOf("start"))
    			},
    			...positions.map((position) => {
    				const list = tasksOf(position.id);
    				return {
    					id: position.id,
    					label: position.label,
    					kind: "position",
    					executor: position.executor,
    					...typeof position.executor.avatar === "string" && position.executor.avatar !== "" ? { avatar: position.executor.avatar } : {},
    					status: aggregateOf(list),
    					meta: metaOf(list),
    					title: titleOf(position.label, list)
    				};
    			}),
    			{
    				id: "end",
    				label: t("boardEnd"),
    				kind: "end",
    				status: aggregateOf(tasksOf("end")),
    				meta: metaOf(tasksOf("end")),
    				title: titleOf(t("boardEnd"), tasksOf("end"))
    			}
    		],
    		edges: channelsOf(definition).map((channel) => ({
    			id: channel.id,
    			label: channel.label,
    			from: channel.from,
    			to: channel.to,
    			types: channel.types,
    			back: channel.back,
    			state: taken.has(channel.id) ? "taken" : "open"
    		})),
    		mode: "live",
    		caption: t("flowHint"),
    		onNodeClick: (id) => {
    			const label = id === "start" ? t("boardStart") : id === "end" ? t("boardEnd") : positions.find((position) => position.id === id)?.label ?? id;
    			actions.openPositionTasks(id, label);
    		}
    	});
    }
    // .build/workflows/client/components/job-outputs.js
    /**
    * 作业的「资产」Tab：资产池。
    *
    * 附件按来源任务分组；最终交付物的内容在概览里看，这里保留它并标「最终」。
    */
    /** 资产视图。 */
    function renderJobOutputs(page) {
    	const { t, state, actions } = page;
    	const loaded = state.attachments;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.status !== "ready" && loaded.data === null) return renderLoading(page);
    	const items = loaded.data ?? [];
    	if (items.length === 0) return renderEmpty(t("outputsEmpty"), t("outputsEmptyHint"));
    	const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state));
    	const groups = assetGroups(items, jobTasks(state), definition, {
    		start: t("boardStart"),
    		end: t("boardEnd")
    	});
    	const jobId = state.route.kind === "job" ? state.route.jobId : "";
    	return h("div", { className: "buka-workflows-outputsPane" }, h("p", { className: "buka-workflows-hint" }, t("outputsHint")), ...groups.map((group) => h("section", {
    		key: group.key,
    		className: "buka-workflows-outputGroup"
    	}, h("div", { className: "buka-workflows-outputGroupHead" }, h("span", { className: "buka-workflows-outputGroupTitle" }, group.label === "" ? t("outputsUnlinked") : group.label), group.positionLabel === "" ? null : h("span", { className: "buka-workflows-hint" }, group.positionLabel), group.final ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "success" }, t("outputsFinal")) : null, h("span", { className: "buka-workflows-outputGroupCount" }, String(group.items.length))), h("ul", { className: "buka-workflows-attachmentList" }, ...group.items.map((attachment) => renderAsset(page, jobId, attachment, group.taskId))))));
    }
    /** 一个资产。 */
    function renderAsset(page, jobId, attachment, taskId) {
    	const { t, actions } = page;
    	const meta = [
    		formatBytes(attachment.bytes),
    		attachment.mime,
    		typeof attachment.createdAt === "string" ? formatTime(attachment.createdAt) : "",
    		typeof attachment.createdBy === "string" && attachment.createdBy !== "" ? `${t("attachmentBy")} ${attachment.createdBy}` : ""
    	].filter((part) => typeof part === "string" && part !== "");
    	return h("li", {
    		key: attachment.id,
    		className: "buka-workflows-asset"
    	}, h("span", { className: "buka-workflows-assetMain" }, h("button", {
    		type: "button",
    		className: "buka-workflows-attachmentLink",
    		title: t("attachmentPreview"),
    		onClick: () => actions.openAttachment(attachment.id, attachment.name)
    	}, attachment.name), typeof attachment.description === "string" && attachment.description !== "" ? h("span", { className: "buka-workflows-attachmentDescription" }, attachment.description) : null, h("span", { className: "buka-workflows-attachmentMeta" }, meta.join(" · "))), h("span", { className: "buka-workflows-assetActions" }, taskId === "" ? null : h("button", {
    		type: "button",
    		className: "buka-workflows-textButton",
    		onClick: () => actions.openTask(taskId)
    	}, t("outputsOpenSource")), h("a", {
    		className: "buka-workflows-attachmentDownload",
    		href: attachmentUrl(jobId, attachment.id),
    		download: attachment.name
    	}, t("attachmentDownload"))));
    }
    // .build/workflows/client/components/job-overview.js
    /**
    * 作业概览：需求 / 输入、结构化输入、最终交付物与启动信息。
    *
    * 概览只回答「这次作业要做什么、交出了什么、谁启动的」；进度看实时流程，
    * 任务看板看任务，资产看文件。
    */
    /** 作业概览视图。 */
    function renderJobOverview(page) {
    	const { t, state, actions } = page;
    	const job = state.job.data?.job;
    	if (job === void 0) return renderEmpty(t("notFound"));
    	const definition = mergedDefinition(currentJobDefinition(state), currentDefinition(state));
    	const tasks = jobTasks(state);
    	const input = isRecord(job.input) ? job.input : {};
    	const rawInput = isRecord(input.raw) ? input.raw : "raw" in input || "structured" in input ? {} : input;
    	const structuredInput = isRecord(input.structured) ? input.structured : null;
    	const starter = isRecord(job.starter) ? job.starter : null;
    	const endTask = endTaskSummary(tasks);
    	const finalTask = state.finalTask;
    	const endSchema = isRecord(definition?.end?.task?.payload) ? definition?.end?.task?.payload : null;
    	const startSchema = isRecord(definition?.start?.task) ? definition?.start?.task : null;
    	return h("div", { className: "buka-workflows-overview" }, renderSection(t("overviewRequirement"), h("div", { className: "buka-workflows-overviewCard" }, renderReadonlyValue(page, isRecord(startSchema?.payload) ? startSchema.payload : null, rawInput, t("overviewRequirementEmpty")))), renderSection(t("overviewStructured"), h("div", { className: "buka-workflows-overviewCard" }, structuredInput === null ? h("p", { className: "buka-workflows-hint" }, t("overviewStructuredEmpty")) : renderReadonlyValue(page, isRecord(startSchema?.output) ? startSchema.output : null, structuredInput, t("overviewStructuredEmpty")))), renderSection(t("overviewFinal"), renderFinalDeliverable$1(page, finalTask.data, finalTask.status, endTask?.id ?? null, endSchema), endTask === null ? h("span", { className: "buka-workflows-hint" }, t("overviewFinalEmpty")) : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.openTask(endTask.id)
    	}, t("overviewOpenFinalTask"))), renderSection(t("overviewStarter"), h("div", { className: "buka-workflows-overviewCard" }, renderKv([
    		[t("overviewWorkflow"), `${job.workflowName ?? job.workflowId ?? ""}${typeof job.workflowVersion === "number" ? ` · v${job.workflowVersion}` : ""}`],
    		[t("starter"), starter === null ? t("taskTypeUnset") : starter.kind === "session" ? t("starterSession") : t("starterHuman")],
    		[t("jobCreatedAt"), formatTime(job.createdAt)],
    		[t("jobUpdatedAt"), formatTime(job.updatedAt)]
    	]), starter !== null && starter.kind === "session" && typeof starter.sessionId === "string" && starter.sessionId !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.openSession(starter.sessionId)
    	}, t("openStarterSession")) : null)), job.error === null || job.error === void 0 || job.error === "" ? null : renderSection(t("jobErrorTitle"), h("p", {
    		className: "buka-workflows-failure",
    		role: "alert"
    	}, errorTextOf(job.error))));
    }
    /** 最终交付物内容。 */
    function renderFinalDeliverable$1(page, task, status, endTaskId, schema) {
    	const { t, actions } = page;
    	if (endTaskId === null) return h("p", { className: "buka-workflows-hint" }, t("overviewFinalEmpty"));
    	if (task === null && (status === "loading" || status === "idle")) return h("p", { className: "buka-workflows-hint" }, t("loading"));
    	if (task === null) return h("p", { className: "buka-workflows-hint" }, t("overviewFinalPending"));
    	const result = isRecord(task.result) ? task.result : null;
    	const text = typeof result?.text === "string" ? result.text : "";
    	const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
    	const payloadSchema = isRecord(schema) ? schema : null;
    	return h("div", { className: "buka-workflows-overviewCard buka-workflows-finalCard" }, h("div", { className: "buka-workflows-finalHead" }, renderStatusTag(t, task.status, "task"), typeof task.positionLabel === "string" && task.positionLabel !== "" ? h("span", { className: "buka-workflows-hint" }, task.positionLabel) : null), renderReadonlyValue(page, payloadSchema, task.payload ?? null, t("overviewFinalPending")), text === "" ? null : h("pre", { className: "buka-workflows-pre" }, text), attachments.length === 0 ? null : h("ul", { className: "buka-workflows-attachmentList" }, ...attachments.map((attachment) => {
    		const name = attachment.name;
    		const jobId = page.state.route.kind === "job" ? page.state.route.jobId : "";
    		return h("li", {
    			key: attachment.id,
    			className: "buka-workflows-attachment"
    		}, renderAttachmentLink(page, attachment, actions.openAttachment), h("span", { className: "buka-workflows-attachmentMeta" }, formatBytes(attachment.bytes)), h("a", {
    			className: "buka-workflows-attachmentDownload",
    			href: attachmentUrl(jobId, attachment.id),
    			download: name
    		}, t("attachmentDownload")));
    	})));
    }
    // .build/workflows/client/components/job-detail.js
    /**
    * 作业详情：四个视图（概览 / 实时流程 / 看板 / 资产）的分发与交付重试提示。
    */
    /** 作业详情视图。 */
    function renderJobDetail(page) {
    	const { t, state, actions } = page;
    	const loaded = state.job;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.data === null) return renderLoading(page);
    	if (loaded.data.job === void 0) return renderEmpty(t("notFound"));
    	const view = state.route.kind === "job" ? state.route.view : "overview";
    	const body = view === "flow" ? renderJobFlow(page) : view === "board" ? renderBoard(page) : view === "outputs" ? renderJobOutputs(page) : renderJobOverview(page);
    	return h("div", { className: "buka-workflows-detail" }, page.state.job.data?.canRetryDelivery === true ? h("div", {
    		className: "buka-workflows-notice",
    		role: "status"
    	}, h("p", { className: "buka-workflows-noticeText" }, t("deliveryRetryHint")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.retryDelivery(),
    		disabled: state.busy === "retry-delivery"
    	}, t("retryDelivery"))) : null, body);
    }
    // .build/workflows/client/components/new-job-dialog.js
    /**
    * 新建作业对话框：先填需求（原始输入），再填启动任务的结构化输入。
    *
    * 结构化输入会按开始任务的 output schema 被 Host 校验，所以不能省略；这里把它
    * 解释成「启动任务整理出的字段」，而不是一个技术概念。
    */
    /** 新建作业对话框。 */
    function renderNewJobDialog(page) {
    	const { t, state, actions } = page;
    	const dialog = state.newJob;
    	const start = currentDefinition(state)?.start?.task;
    	const rawSchema = isRecord(start?.payload) ? start.payload : null;
    	const structuredSchema = isRecord(start?.output) ? start.output : null;
    	const rawHasFields = schemaFields(rawSchema).length > 0;
    	const structuredHasFields = schemaFields(structuredSchema).length > 0;
    	const rawSection = h("section", {
    		key: "raw",
    		className: "buka-workflows-dialogSection"
    	}, h("h3", { className: "buka-workflows-dialogSectionTitle" }, t("newJobRawTitle")), h("p", { className: "buka-workflows-fieldHint" }, t("newJobRawHint")), ...rawHasFields ? renderSchemaFields(page, {
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
    	}, t("newJobRawFallback"), h("span", { className: "buka-workflows-required" }, ` · ${t("schemaFieldRequired")}`)), h("textarea", {
    		id: "buka-workflows-newjob-raw-request",
    		className: "buka-workflows-textarea",
    		rows: 4,
    		value: dialog.raw.request ?? "",
    		placeholder: t("newJobRawPlaceholder"),
    		onChange: (event) => actions.setNewJobRaw("request", event.target.value)
    	}))]);
    	const structuredSection = h("section", {
    		key: "structured",
    		className: "buka-workflows-dialogSection"
    	}, h("h3", { className: "buka-workflows-dialogSectionTitle" }, t("newJobStructuredTitle")), h("p", { className: "buka-workflows-fieldHint" }, t("newJobStructuredHint")), ...structuredHasFields ? renderSchemaFields(page, {
    		schema: structuredSchema,
    		values: dialog.structured,
    		onChange: actions.setNewJobStructured,
    		idPrefix: "buka-workflows-newjob-structured"
    	}) : [h("details", {
    		key: "structured-json",
    		className: "buka-workflows-details"
    	}, h("summary", { className: "buka-workflows-detailsSummary" }, t("newJobStructuredAdvanced")), renderJsonFallback(page, dialog.structured.__json ?? "", (next) => actions.setNewJobStructured("__json", next), "buka-workflows-newjob-structured-json"))]);
    	const body = [
    		h("p", {
    			key: "hint",
    			className: "buka-workflows-hint"
    		}, t("newJobHint")),
    		rawSection,
    		structuredSection,
    		dialog.error === null ? null : h("p", {
    			key: "error",
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
    // .build/workflows/client/components/node-tasks-drawer.js
    /**
    * 实时流程里点开的节点任务列表。
    *
    * 单任务的节点直接进任务抽屉；多任务或空节点才用这个列表。
    */
    /** 节点任务列表抽屉。 */
    function renderNodeTasksDrawer(page) {
    	const { t, state, actions } = page;
    	const selection = state.nodeTasks;
    	if (selection === null) return null;
    	const tasks = sortTasks(jobTasks(state).filter((task) => task.position === selection.positionId));
    	const title = fill(t, "nodeTasksTitle", { label: selection.label });
    	const position = positionsOf(mergedDefinition(currentJobDefinition(state), currentDefinition(state))).find((item) => item.id === selection.positionId);
    	const avatar = position !== void 0 && typeof position.executor.avatar === "string" ? renderAvatar(position.executor.avatar, 28, "buka-workflows-drawerAvatar") : null;
    	const meta = [fill(t, "flowTaskCount", { n: tasks.length }), position === void 0 ? "" : renderExecutor(page, position.executor)].filter((part) => part !== "");
    	return h(ClientModal, {
    		open: true,
    		headless: true,
    		onClose: actions.closeNodeTasks,
    		title,
    		closeLabel: t("close"),
    		backdropBlur: false,
    		className: "buka-workflows-drawer buka-workflows-nodeTasks"
    	}, renderDrawerHead({
    		title,
    		avatar,
    		meta: meta.join(" · "),
    		onClose: actions.closeNodeTasks,
    		closeLabel: t("close")
    	}), h("div", { className: "buka-workflows-drawerBody" }, tasks.length === 0 ? renderEmpty(t("nodeTasksEmpty"), t("nodeTasksEmptyHint")) : h("ul", { className: "buka-workflows-taskList" }, ...tasks.map((task) => renderNodeTask(page, task)))));
    }
    /** 一个任务行。 */
    function renderNodeTask(page, task) {
    	const { t, actions } = page;
    	const claimant = claimantName(task.claimant, t);
    	const waiting = task.status === "ready" || task.status === "pending" ? formatWaiting(task.createdAt) : "";
    	return h("li", { key: task.id }, h("button", {
    		type: "button",
    		className: `buka-workflows-taskCard is-${task.status ?? "pending"}`,
    		onClick: () => actions.openTask(task.id)
    	}, h("span", { className: "buka-workflows-taskCardHead" }, h("span", { className: "buka-workflows-taskCardType" }, task.typeLabel ?? task.type ?? task.id), renderStatusTag(t, task.status, "task")), typeof task.resultSummary === "string" && task.resultSummary !== "" ? h("span", { className: "buka-workflows-taskCardSummary" }, task.resultSummary) : null, claimant === "" && waiting === "" ? null : h("span", { className: "buka-workflows-taskCardMeta" }, [claimant === "" ? "" : `${t("taskClaimant")}: ${claimant}`, waiting === "" ? "" : fill(t, "boardCardWaiting", { duration: waiting })].filter((part) => part !== "").join(" · "))));
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
    * 任务抽屉：先回答「这个任务现在怎么样、要做什么」，技术细节收进折叠区。
    *
    * 头部是身份与状态；正文按「结果 → 操作 → 输入 → 依赖」排序，执行记录与
    * 类型 / 时间这类审计信息默认收起。
    */
    /** 任务详情抽屉。 */
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
    	}, renderDrawerHead({
    		title,
    		avatar: task === null ? null : renderAvatar(executorAvatar(page, task), 28, "buka-workflows-drawerAvatar"),
    		tag: task === null ? null : renderStatusTag(t, task.status, "task"),
    		meta: task === null ? null : taskMeta(page, task),
    		actions: task === null ? null : renderSessionButton(page, task),
    		onClose: actions.closeTask,
    		closeLabel: t("close")
    	}), h("div", { className: "buka-workflows-drawerBody" }, ...body));
    }
    /** 头部第二行：岗位 · 入站通道 · 承办者。 */
    function taskMeta(page, task) {
    	const { t } = page;
    	return [
    		task.positionLabel ?? task.position ?? "",
    		typeof task.channelLabel === "string" && task.channelLabel !== "" ? `${t("taskChannel")}: ${task.channelLabel}` : "",
    		claimantName(task.claimant, t) || t("taskUnclaimed")
    	].filter((part) => part !== "").join(" · ");
    }
    /** 任务岗位对应的打工人头像。 */
    function executorAvatar(page, task) {
    	if (task.position === void 0 || task.position === "") return void 0;
    	const position = positionsOf(mergedDefinition(currentJobDefinition(page.state), currentDefinition(page.state))).find((item) => item.id === task.position);
    	return typeof position?.executor.avatar === "string" && position.executor.avatar !== "" ? position.executor.avatar : void 0;
    }
    /** 抽屉正文。 */
    function renderTaskBody(page, task) {
    	const { t, state } = page;
    	const typeDefinition = taskTypeOf(state, task);
    	const allowed = Array.isArray(task.allowedActions) ? task.allowedActions : [];
    	const human = isHumanTask(state, task);
    	const canClaim = allowed.includes("claim") && task.status === "ready";
    	const canComplete = allowed.includes("complete");
    	const showForm = human && (task.status === "ready" || task.status === "running") && allowed.length > 0;
    	const elements = [];
    	if (typeof task.typeDescription === "string" && task.typeDescription !== "") elements.push(h(ClampedText, {
    		key: "type-desc",
    		text: task.typeDescription,
    		className: "buka-workflows-drawerText",
    		expandLabel: t("expandText"),
    		collapseLabel: t("collapseText")
    	}));
    	if (showForm) elements.push(renderFormSection(page, task, allowed, canClaim, canComplete));
    	const isEnd = task.position === "end";
    	if (isEnd) elements.push(renderFinalDeliverable(page, task));
    	const result = renderTaskResult(page, task);
    	if (result !== null) elements.push(renderSection(t("taskResultTitle"), result));
    	if (!showForm) {
    		const actionsBlock = renderActionSection(page, allowed, canClaim, canComplete);
    		if (actionsBlock !== null) elements.push(actionsBlock);
    	}
    	if (!isEnd) {
    		const payloadSchema = isRecord(typeDefinition?.payload) ? typeDefinition.payload : null;
    		elements.push(renderSection(t("taskPayloadTitle"), h("div", { className: "buka-workflows-contractBody" }, renderReadonlyValue(page, payloadSchema, task.payload ?? null, t("taskPayloadEmpty")))));
    	}
    	const deps = Array.isArray(task.deps) ? task.deps : [];
    	if (deps.length > 0) elements.push(renderSection(t("taskDepsTitle"), h("ul", { className: "buka-workflows-depList" }, ...deps.map((dep) => h("li", {
    		key: dep.id,
    		className: "buka-workflows-depRow"
    	}, h("button", {
    		type: "button",
    		className: "buka-workflows-depLink",
    		onClick: () => page.actions.openTask(dep.id)
    	}, dep.typeLabel ?? dep.type ?? dep.id), renderStatusTag(t, dep.status, "task"), dep.resultSummary === null || dep.resultSummary === void 0 ? null : h("span", { className: "buka-workflows-depSummary" }, dep.resultSummary))))));
    	const attempts = Array.isArray(task.attempts) ? task.attempts : [];
    	elements.push(renderFold(t("taskAttemptsTitle"), attempts.length === 0 ? renderEmpty(t("taskAttemptsEmpty")) : h("ul", { className: "buka-workflows-attemptList" }, ...attempts.map((attempt) => renderAttempt(page, attempt)))));
    	elements.push(renderFold(t("taskDetailsTitle"), renderTaskDetails(page, task, typeDefinition)));
    	return elements;
    }
    /** 人任务的填写表单；对需要动手的人来说，这是抽屉里最该先看到的东西。 */
    function renderFormSection(page, task, allowed, canClaim, canComplete) {
    	const { t, state, actions } = page;
    	return renderSection(t("actionFormTitle"), h("div", { className: "buka-workflows-taskForm" }, h("p", { className: "buka-workflows-sectionHint" }, t("actionFormHint")), ...renderTaskForm(page, task), h("div", { className: "buka-workflows-formActions" }, ...actionButtons(page, allowed, canClaim), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.runTaskAction("complete"),
    		disabled: state.taskForm.submitting || !canComplete
    	}, state.taskForm.submitting ? t("actionSubmitting") : t("actionSubmitComplete")))));
    }
    /** 非表单任务的操作区；没有可用动作时整块不出现。 */
    function renderActionSection(page, allowed, canClaim, canComplete) {
    	const { t, state, actions } = page;
    	const buttons = actionButtons(page, allowed, canClaim);
    	if (canComplete) buttons.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "complete",
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.runTaskAction("complete"),
    		disabled: state.taskForm.submitting
    	}, t("actionSubmitComplete")));
    	if (buttons.length === 0) return null;
    	return renderSection(t("taskActionsTitle"), h("div", { className: "buka-workflows-formActions" }, ...buttons));
    }
    /** 认领 / 重试 / 取消；表单和操作区共用。 */
    function actionButtons(page, allowed, canClaim) {
    	const { t, state, actions } = page;
    	const buttons = [];
    	if (canClaim) buttons.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "claim",
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.runTaskAction("claim"),
    		disabled: state.taskForm.submitting
    	}, t("actionClaim")));
    	if (allowed.includes("retry")) buttons.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "retry",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.runTaskAction("retry"),
    		disabled: state.taskForm.submitting
    	}, t("actionRetry")));
    	if (allowed.includes("cancel")) buttons.push(h(ConfirmButton, {
    		key: "cancel",
    		label: t("actionCancel"),
    		confirmLabel: t("actionCancelConfirmAction"),
    		cancelLabel: t("cancel"),
    		confirmText: t("actionCancelConfirm"),
    		onConfirm: () => void actions.runTaskAction("cancel"),
    		disabled: state.taskForm.submitting
    	}));
    	return buttons;
    }
    /** 结束任务的交付物：置顶，并跳过重复的「任务输入」。 */
    function renderFinalDeliverable(page, task) {
    	const { t, state } = page;
    	const endSchema = currentJobDefinition(state)?.end?.task?.payload;
    	return renderSection(t("finalDeliverableTitle"), h("div", { className: "buka-workflows-deliverable" }, renderReadonlyValue(page, isRecord(endSchema) ? endSchema : null, task.payload ?? null, t("taskPayloadEmpty"))));
    }
    /** 执行记录的一行。 */
    function renderAttempt(page, attempt) {
    	const { t, actions } = page;
    	const meta = [formatTime(attempt.startedAt), attempt.finishedAt === null || attempt.finishedAt === void 0 ? "" : formatTime(attempt.finishedAt)].filter((part) => part !== "");
    	const error = errorTextOf(attempt.error);
    	return h("li", {
    		key: attempt.id,
    		className: "buka-workflows-attempt"
    	}, h("div", { className: "buka-workflows-attemptHead" }, renderStatusTag(t, attempt.status, "task"), attempt.stopReason === null || attempt.stopReason === void 0 ? null : h("span", { className: "buka-workflows-attemptMeta" }, `${t("taskAttemptStopReason")}: ${String(attempt.stopReason)}`), h("span", { className: "buka-workflows-attemptMeta" }, meta.join(" · ")), typeof attempt.sessionId === "string" && attempt.sessionId !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.openSession(attempt.sessionId)
    	}, t("openSession")) : null), typeof attempt.sessionId === "string" && attempt.sessionId !== "" ? h("span", { className: "buka-workflows-attemptMeta" }, `${t("sessionLabel")}: ${attempt.sessionId}`) : null, error === "" ? null : h("p", { className: "buka-workflows-failure" }, `${t("taskAttemptError")}: ${error}`));
    }
    /** 结果区：说明 + 结构化产出 + 附件。 */
    function renderTaskResult(page, task) {
    	const { t, actions, state } = page;
    	const result = isRecord(task.result) ? task.result : null;
    	if (result === null) return null;
    	const text = typeof result.text === "string" ? result.text : "";
    	const output = result.output;
    	const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    	const typeDefinition = taskTypeOf(state, task);
    	const outputSchema = isRecord(typeDefinition?.output) ? typeDefinition.output : null;
    	const blocks = [];
    	if (text !== "") blocks.push(h("p", {
    		key: "text",
    		className: "buka-workflows-resultText"
    	}, text));
    	if (output !== void 0 && output !== null) blocks.push(resultBlock(t("taskResultOutput"), h("div", { className: "buka-workflows-contractBody" }, renderReadonlyValue(page, outputSchema, output, t("taskResultEmpty")))));
    	if (attachments.length > 0) blocks.push(resultBlock(t("taskResultAttachments"), h("ul", { className: "buka-workflows-attachmentList" }, ...attachments.map((attachment) => {
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
    	if (blocks.length === 0) return null;
    	return h("div", { className: "buka-workflows-result" }, ...blocks);
    }
    /** 结果里的一个子块：小标签 + 内容。 */
    function resultBlock(label, content) {
    	return h("div", { className: "buka-workflows-resultBlock" }, h("span", { className: "buka-workflows-subLabel" }, label), content);
    }
    /** 折叠区里的审计信息：类型 ID、助理与三个时间点。 */
    function renderTaskDetails(page, task, typeDefinition) {
    	const { t } = page;
    	const rows = [];
    	if (typeof task.type === "string" && task.type !== "") rows.push([t("taskType"), h("code", { className: "buka-workflows-inlineCode" }, task.type)]);
    	if (typeof task.channel === "string" && task.channel !== "") rows.push([t("taskChannel"), h("code", { className: "buka-workflows-inlineCode" }, task.channel)]);
    	if (isRecord(typeDefinition) && typeof typeDefinition.assistant === "string" && typeDefinition.assistant !== "") rows.push([t("taskTypeAssistant"), typeDefinition.assistant]);
    	rows.push([t("taskCreatedAt"), formatTime(task.createdAt)]);
    	if (task.startedAt !== null && task.startedAt !== void 0) rows.push([t("taskStartedAt"), formatTime(task.startedAt)]);
    	if (task.finishedAt !== null && task.finishedAt !== void 0) rows.push([t("taskFinishedAt"), formatTime(task.finishedAt)]);
    	return renderKv(rows);
    }
    /** 任务抽屉头部右侧的会话入口（承办者会话）。 */
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
    /** 当前作业 id。 */
    function jobIdOf(page) {
    	if (page.state.route.kind === "job") return page.state.route.jobId;
    	return page.state.job.data?.job?.id ?? "";
    }
    // .build/workflows/client/components/workflow-definition.js
    /**
    * 工作流页的「定义结构」Tab：可交互的分层图；点节点 / 通道在右侧抽屉里看细节。
    */
    /** 定义结构视图。 */
    function renderWorkflowDefinition(page) {
    	const { t, state, actions } = page;
    	const loaded = state.workflow;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.data === null) return renderLoading(page);
    	const definition = currentDefinition(state);
    	if (definition === null) return renderEmpty(t("definitionMissing"));
    	const positions = positionsOf(definition);
    	const defined = channelsOf(definition);
    	const nodes = [
    		{
    			id: "start",
    			label: t("graphStart"),
    			kind: "start",
    			status: "idle"
    		},
    		...positions.map((position) => ({
    			id: position.id,
    			label: position.label,
    			kind: "position",
    			executor: position.executor,
    			...typeof position.executor.avatar === "string" && position.executor.avatar !== "" ? { avatar: position.executor.avatar } : {},
    			status: "idle",
    			title: `${position.label} · ${renderExecutor(page, position.executor)}`
    		})),
    		{
    			id: "end",
    			label: t("graphEnd"),
    			kind: "end",
    			status: "idle"
    		}
    	];
    	const edges = defined.map((channel) => ({
    		id: channel.id,
    		label: channel.label,
    		from: channel.from,
    		to: channel.to,
    		types: channel.types,
    		back: channel.back
    	}));
    	const selection = state.definitionSelection;
    	const selectedNodeId = selection !== null && selection.kind === "position" ? selection.id : selection !== null && (selection.kind === "start" || selection.kind === "end") ? selection.kind : null;
    	const selectedChannelId = selection !== null && selection.kind === "channel" ? selection.id : null;
    	return h("div", { className: "buka-workflows-definitionPane" }, h("div", { className: "buka-workflows-definitionToolbar" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconInfoOutlineRegular, { size: 13 }),
    		onClick: () => actions.selectDefinition({ kind: "info" })
    	}, t("definitionInfo")), h("span", { className: "buka-workflows-hint" }, t("definitionHint"))), renderWorkflowGraph(page, {
    		nodes,
    		edges,
    		mode: "definition",
    		selectedNodeId,
    		selectedChannelId,
    		onNodeClick: (id) => {
    			if (id === "start" || id === "end") actions.selectDefinition({ kind: id });
    			else actions.selectDefinition({
    				kind: "position",
    				id
    			});
    		},
    		onEdgeClick: (edge) => {
    			actions.selectDefinition({
    				kind: "channel",
    				id: edge.id
    			});
    		}
    	}));
    }
    // .build/workflows/client/components/workflow-jobs.js
    /**
    * 工作流页的「作业」Tab：筛选、作业列表与新建作业入口。
    */
    /** 筛选定义。 */
    const FILTERS = [
    	{
    		value: "all",
    		labelKey: "jobsFilterAll"
    	},
    	{
    		value: "running",
    		labelKey: "jobsFilterRunning"
    	},
    	{
    		value: "completed",
    		labelKey: "jobsFilterCompleted"
    	},
    	{
    		value: "problem",
    		labelKey: "jobsFilterProblem"
    	}
    ];
    /** 作业列表视图。 */
    function renderWorkflowJobs(page) {
    	const { t, state, actions } = page;
    	const loaded = state.workflow;
    	if (loaded.error !== null && loaded.data === null) return renderFailure(page, loaded.error, actions.refresh);
    	if (loaded.data === null) return renderLoading(page);
    	const workflow = loaded.data.workflow;
    	const workflowId = workflow?.id ?? "";
    	const retired = workflow?.status === "retired";
    	const jobs = Array.isArray(loaded.data.jobs) ? loaded.data.jobs : [];
    	const counts = {
    		all: jobs.length,
    		running: jobs.filter((job) => job.status === "running").length,
    		completed: jobs.filter((job) => job.status === "completed").length,
    		problem: jobs.filter((job) => job.status === "failed" || job.status === "cancelled").length
    	};
    	const visible = sortJobs(filterJobs(jobs, state.jobFilter));
    	const newJobAction = retired || workflowId === "" ? null : h("button", {
    		key: "new-job-empty",
    		type: "button",
    		className: "buka-workflows-textButton",
    		onClick: actions.openNewJob
    	}, t("newJob"));
    	if (jobs.length === 0) return renderEmptyAction(t("jobsEmpty"), retired ? t("jobsEmptyRetired") : t("jobsEmptyHint"), newJobAction);
    	return h("div", { className: "buka-workflows-jobsPane" }, h("div", {
    		className: "buka-workflows-filters",
    		role: "group",
    		"aria-label": t("jobsFilterAria")
    	}, ...FILTERS.map((filter) => h("button", {
    		key: filter.value,
    		type: "button",
    		className: `buka-workflows-filter${state.jobFilter === filter.value ? " is-active" : ""}`,
    		"aria-pressed": state.jobFilter === filter.value,
    		onClick: () => actions.setJobFilter(filter.value)
    	}, t(filter.labelKey), h("span", { className: "buka-workflows-filterCount" }, String(counts[filter.value]))))), visible.length === 0 ? renderEmptyAction(t("jobsFilterEmpty"), null, [h("button", {
    		key: "reset-filter",
    		type: "button",
    		className: "buka-workflows-textButton",
    		onClick: () => actions.setJobFilter("all")
    	}, t("jobsFilterReset"))]) : h("ul", { className: "buka-workflows-cards" }, ...visible.map((job) => renderJobCard(page, workflowId, job))));
    }
    /** 一张作业卡片。 */
    function renderJobCard(page, workflowId, job) {
    	const { t, actions } = page;
    	const total = Object.values(job.taskCounts ?? {}).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
    	const done = typeof job.taskCounts?.completed === "number" ? job.taskCounts.completed : 0;
    	const ready = typeof job.taskCounts?.ready === "number" ? job.taskCounts.ready : 0;
    	const running = typeof job.taskCounts?.running === "number" ? job.taskCounts.running : 0;
    	const problem = (job.taskCounts?.failed ?? 0) + (job.taskCounts?.blocked ?? 0) + (job.taskCounts?.cancelled ?? 0);
    	const parts = [
    		total > 0 ? fill(t, "jobTaskProgress", {
    			done,
    			total
    		}) : t("jobNoTasks"),
    		running > 0 ? `${t("statusRunning")} ${running}` : "",
    		ready > 0 ? `${t("statusReady")} ${ready}` : "",
    		problem > 0 ? `${t("jobsFilterProblem")} ${problem}` : "",
    		typeof job.updatedAt === "string" && job.updatedAt !== "" ? `${t("updatedAt")} ${formatTime(job.updatedAt)}` : typeof job.createdAt === "string" && job.createdAt !== "" ? `${t("jobCreatedAt")} ${formatTime(job.createdAt)}` : ""
    	].filter((part) => part !== "");
    	return h("li", { key: job.id }, h("button", {
    		type: "button",
    		className: "buka-workflows-card",
    		onClick: () => actions.openJob(workflowId, job.id)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, h("span", { className: "buka-workflows-seq" }, fill(t, "jobSeq", { seq: job.seq ?? 0 })), h("span", { className: "buka-workflows-cardTitle" }, job.inputSummary ?? job.id)), renderStatusTag(t, job.status, "job")), h("span", { className: "buka-workflows-meta" }, parts.join(" · ")), total > 0 ? h("span", {
    		className: "buka-workflows-progress",
    		"aria-hidden": true
    	}, h("span", {
    		className: `buka-workflows-progressBar is-${job.status ?? "pending"}`,
    		style: { width: `${Math.round(done / total * 100)}%` }
    	})) : null));
    }
    // .build/workflows/client/components/workflow-list.js
    /**
    * 工作流列表：名称、描述、版本、状态与作业数；停用的工作流灰显并排在后面。
    */
    /** 工作流列表视图。 */
    function renderWorkflowList(page) {
    	const { t, state, actions } = page;
    	const workflows = state.workflows;
    	if (workflows.error !== null && workflows.data === null) return renderFailure(page, workflows.error, actions.refresh);
    	if (workflows.status !== "ready" && workflows.data === null) return renderLoading(page);
    	const all = workflows.data ?? [];
    	if (all.length === 0) return renderEmpty(t("workflowsEmpty"), t("workflowsEmptyHint"));
    	const sorted = [...all].sort((left, right) => {
    		return (left.status === "retired" ? 1 : 0) - (right.status === "retired" ? 1 : 0);
    	});
    	return h("div", { className: "buka-workflows-listPane" }, h("ul", { className: "buka-workflows-cards" }, ...sorted.map((workflow) => renderWorkflowCard(page, workflow))));
    }
    /** 一张工作流卡片。 */
    function renderWorkflowCard(page, workflow) {
    	const { t, actions } = page;
    	const retired = workflow.status === "retired";
    	return h("li", { key: workflow.id }, h("button", {
    		type: "button",
    		className: `buka-workflows-card${retired ? " is-disabled" : ""}`,
    		onClick: () => actions.openWorkflow(workflow.id)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, h("span", { className: "buka-workflows-cardTitle" }, typeof workflow.name === "string" && workflow.name !== "" ? workflow.name : workflow.id), typeof workflow.version === "number" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `v${workflow.version}`) : null), retired ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("workflowRetired")) : null), typeof workflow.description === "string" && workflow.description !== "" ? h("span", { className: "buka-workflows-cardDesc" }, workflow.description) : null, h("span", { className: "buka-workflows-meta" }, [
    		fill(t, "jobCount", { n: typeof workflow.jobCount === "number" ? workflow.jobCount : 0 }),
    		typeof workflow.updatedAt === "string" && workflow.updatedAt !== "" ? `${t("updatedAt")} ${formatTime(workflow.updatedAt)}` : "",
    		retired ? t("workflowRetiredHint") : ""
    	].filter((part) => part !== "").join(" · "))));
    }
    // .build/workflows/client/components/page-shell.js
    /**
    * 页面外壳：返回、标题、状态、工具栏、页签、内容区、Toast 与抽屉 / 对话框。
    */
    /** 页面标题与副标题。 */
    function pageHeading(page) {
    	const { t, state } = page;
    	const route = state.route;
    	if (route.kind === "workflows") return {
    		title: t("title"),
    		subtitle: ""
    	};
    	if (route.kind === "workflow") return {
    		title: state.workflow.data?.workflow?.name ?? route.workflowId,
    		subtitle: ""
    	};
    	const job = state.job.data?.job;
    	const version = typeof job?.workflowVersion === "number" ? ` · v${job.workflowVersion}` : "";
    	return {
    		title: typeof job?.seq === "number" ? fill(t, "jobSeq", { seq: job.seq }) : t("jobTitle"),
    		subtitle: `${job?.workflowName ?? ""}${version}`
    	};
    }
    /**
    * 页面外壳。
    *
    * @param page
    * @returns React 元素
    */
    function renderPage(page) {
    	const { t, state, actions } = page;
    	const route = state.route;
    	const heading = pageHeading(page);
    	const workflowStatus = state.workflow.data?.workflow?.status;
    	const jobStatus = state.job.data?.job?.status;
    	const live = jobStatus === "running";
    	const retired = route.kind === "workflow" && workflowStatus === "retired";
    	const workflowAvailable = workflowStatus !== void 0 && workflowStatus !== "retired";
    	const tabs = route.kind === "workflow" ? [{
    		value: "jobs",
    		label: t("jobsTab"),
    		id: "buka-workflows-tab-jobs",
    		panelId: "buka-workflows-panel-jobs"
    	}, {
    		value: "definition",
    		label: t("definitionTab"),
    		id: "buka-workflows-tab-definition",
    		panelId: "buka-workflows-panel-definition"
    	}] : route.kind === "job" ? [
    		{
    			value: "overview",
    			label: t("overviewTab"),
    			id: "buka-workflows-tab-overview",
    			panelId: "buka-workflows-panel-overview"
    		},
    		{
    			value: "flow",
    			label: t("flowTab"),
    			id: "buka-workflows-tab-flow",
    			panelId: "buka-workflows-panel-flow"
    		},
    		{
    			value: "board",
    			label: t("boardTab"),
    			id: "buka-workflows-tab-board",
    			panelId: "buka-workflows-panel-board"
    		},
    		{
    			value: "outputs",
    			label: t("outputsTab"),
    			id: "buka-workflows-tab-outputs",
    			panelId: "buka-workflows-panel-outputs"
    		}
    	] : null;
    	const activeTab = route.kind === "workflow" ? route.tab : route.kind === "job" ? route.view : "";
    	const toolbar = [];
    	if (route.kind === "workflow") {
    		if (retired) toolbar.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "enable",
    			variant: "primary",
    			size: "sm",
    			className: "buka-workflows-toolbarButton",
    			onClick: () => void actions.setWorkflowEnabled(true),
    			disabled: state.busy === "workflow-status"
    		}, t("enableWorkflow")));
    		else toolbar.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "new-job",
    			variant: "primary",
    			size: "sm",
    			className: "buka-workflows-toolbarButton",
    			onClick: actions.openNewJob,
    			disabled: !workflowAvailable
    		}, t("newJob")));
    	}
    	if (route.kind === "job") toolbar.push(h(ConfirmButton, {
    		key: "cancel-job",
    		label: t("cancelJob"),
    		confirmLabel: t("cancelJobConfirmAction"),
    		cancelLabel: t("cancel"),
    		confirmText: t("cancelJobConfirm"),
    		onConfirm: () => void actions.cancelJob(),
    		disabled: state.busy === "cancel-job" || jobStatus !== "running"
    	}));
    	toolbar.push(h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "refresh",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		onClick: actions.refresh
    	}, t("refresh")));
    	if (route.kind === "workflow" && !retired && workflowStatus !== void 0) toolbar.push(h("details", {
    		key: "more",
    		className: "buka-workflows-more"
    	}, h("summary", { className: "buka-workflows-moreSummary" }, t("more")), h("div", { className: "buka-workflows-moreMenu" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: (event) => {
    			event.currentTarget.closest("details")?.removeAttribute("open");
    			actions.setWorkflowEnabled(false);
    		},
    		disabled: state.busy === "workflow-status"
    	}, t("disableWorkflow")))));
    	const body = route.kind === "workflows" ? renderWorkflowList(page) : route.kind === "workflow" ? route.tab === "definition" ? renderWorkflowDefinition(page) : renderWorkflowJobs(page) : renderJobDetail(page);
    	return h("div", { className: `buka-workflows-page${route.kind === "job" ? " is-wide" : route.kind === "workflow" ? " is-mid" : ""}` }, h("header", { className: "buka-workflows-head" }, h("div", { className: "buka-workflows-headInner" }, h("div", { className: "buka-workflows-titleRow" }, h("div", { className: "buka-workflows-titleGroup" }, route.kind === "workflows" ? null : h("button", {
    		type: "button",
    		className: "buka-workflows-back",
    		title: t("back"),
    		"aria-label": t("back"),
    		onClick: route.kind === "workflow" ? actions.backToWorkflows : actions.backToWorkflow
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 13 })), h("h1", { className: "buka-workflows-title" }, heading.title), route.kind === "workflow" && retired ? renderStatusTag(t, workflowStatus, "workflow") : null, route.kind === "job" ? h("span", { className: "buka-workflows-titleMeta" }, h("span", { className: "buka-workflows-titleSub" }, heading.subtitle), renderStatusTag(t, jobStatus, "job"), live ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : null) : null), h("div", { className: "buka-workflows-toolbar" }, ...toolbar)), tabs === null ? null : h("div", { className: "buka-workflows-tabs" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workflows-tabList",
    		label: route.kind === "workflow" ? t("workflowTabsAria") : t("jobTabsAria"),
    		value: activeTab,
    		onChange: (value) => {
    			if (route.kind === "workflow") actions.setWorkflowTab(value);
    			else if (route.kind === "job") actions.setJobView(value);
    		},
    		items: tabs
    	})))), h("div", {
    		key: routeHash(route),
    		className: `buka-workflows-body${route.kind === "job" ? " is-wide" : ""}`
    	}, body), renderNewJobDialog(page), renderDefinitionDrawer(page), renderNodeTasksDrawer(page), renderTaskDrawer(page), renderAttachmentDrawer(page), state.notice === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Toast, {
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
    * 页面动作：导航、页签、筛选、定义选中、工作流停用、作业启停、任务动作、
    * 会话与附件。
    *
    * 所有异步动作都走函数式 `setState`；动作失败只写页面错误 / Toast，不抛出去。
    */
    /** 空的可加载状态。 */
    function idle$1() {
    	return {
    		status: "idle",
    		data: null,
    		error: null
    	};
    }
    /**
    * 创建页面动作。
    *
    * @param store 状态与 setter
    * @param deps 词典与 Service 取值器
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
    			const route = {
    				kind: "workflow",
    				workflowId,
    				tab: "jobs"
    			};
    			writeRouteHash(route);
    			setState((current) => {
    				const keep = current.route.kind !== "workflows" && current.route.workflowId === workflowId && current.workflow.data !== null;
    				return {
    					...current,
    					route,
    					...keep ? {} : { workflow: idle$1() },
    					jobFilter: "all",
    					job: idle$1(),
    					finalTask: idle$1(),
    					attachments: idle$1(),
    					definitionSelection: null,
    					nodeTasks: null,
    					taskId: null,
    					task: idle$1(),
    					attachment: null,
    					tick: current.tick + 1
    				};
    			});
    		},
    		backToWorkflows() {
    			const route = { kind: "workflows" };
    			writeRouteHash(route);
    			setState((current) => ({
    				...current,
    				route,
    				workflow: idle$1(),
    				job: idle$1(),
    				finalTask: idle$1(),
    				attachments: idle$1(),
    				definitionSelection: null,
    				nodeTasks: null,
    				taskId: null,
    				task: idle$1(),
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		setWorkflowTab(tab) {
    			if (state.route.kind !== "workflow") return;
    			const route = {
    				...state.route,
    				tab
    			};
    			writeRouteHash(route);
    			setState((current) => ({
    				...current,
    				route,
    				...tab === "definition" ? {} : { definitionSelection: null }
    			}));
    		},
    		openJob(workflowId, jobId) {
    			const route = {
    				kind: "job",
    				workflowId,
    				jobId,
    				view: "overview"
    			};
    			writeRouteHash(route);
    			setState((current) => ({
    				...current,
    				route,
    				job: {
    					status: "loading",
    					data: null,
    					error: null
    				},
    				finalTask: idle$1(),
    				attachments: idle$1(),
    				definitionSelection: null,
    				nodeTasks: null,
    				taskId: null,
    				task: idle$1(),
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		backToWorkflow() {
    			const workflowId = workflowIdOf();
    			if (workflowId === "") {
    				const route = { kind: "workflows" };
    				writeRouteHash(route);
    				setState((current) => ({
    					...current,
    					route,
    					workflow: idle$1(),
    					job: idle$1(),
    					finalTask: idle$1(),
    					attachments: idle$1(),
    					taskId: null,
    					task: idle$1(),
    					attachment: null
    				}));
    				return;
    			}
    			const route = {
    				kind: "workflow",
    				workflowId,
    				tab: "jobs"
    			};
    			writeRouteHash(route);
    			setState((current) => ({
    				...current,
    				route,
    				job: idle$1(),
    				finalTask: idle$1(),
    				attachments: idle$1(),
    				nodeTasks: null,
    				taskId: null,
    				task: idle$1(),
    				attachment: null,
    				tick: current.tick + 1
    			}));
    		},
    		setJobView(view) {
    			if (state.route.kind !== "job") return;
    			const route = {
    				...state.route,
    				view
    			};
    			writeRouteHash(route);
    			setState((current) => ({
    				...current,
    				route,
    				nodeTasks: null
    			}));
    		},
    		setJobFilter(filter) {
    			setState((current) => ({
    				...current,
    				jobFilter: filter
    			}));
    		},
    		selectDefinition(selection) {
    			setState((current) => ({
    				...current,
    				definitionSelection: selection
    			}));
    		},
    		openPositionTasks(positionId, label) {
    			const list = jobTasks(state).filter((task) => task.position === positionId);
    			if (list.length === 1 && typeof list[0]?.id === "string") {
    				setState((current) => ({
    					...current,
    					nodeTasks: null,
    					taskId: list[0]?.id ?? null,
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
    				return;
    			}
    			setState((current) => ({
    				...current,
    				nodeTasks: {
    					positionId,
    					label
    				}
    			}));
    		},
    		closeNodeTasks() {
    			setState((current) => ({
    				...current,
    				nodeTasks: null
    			}));
    		},
    		async setWorkflowEnabled(active) {
    			const workflowId = workflowIdOf();
    			if (workflowId === "") return;
    			setState((current) => ({
    				...current,
    				busy: "workflow-status"
    			}));
    			try {
    				await postJson(WORKFLOW_ACTIVATE_ROUTE, {
    					id: workflowId,
    					active
    				});
    				const status = active ? "active" : "retired";
    				setState((current) => {
    					const detail = current.workflow.data;
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
    				flash("success", t(active ? "workflowEnabled" : "workflowDisabled"));
    			} catch (failure) {
    				setState((current) => ({
    					...current,
    					busy: null
    				}));
    				flash("error", `${t("workflowStatusFailed")} ${messageOf(failure)}`);
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
    				if (jobId !== "") writeRouteHash({
    					kind: "job",
    					workflowId,
    					jobId,
    					view: "overview"
    				});
    				setState((now) => {
    					const next = {
    						...now,
    						newJob: {
    							open: false,
    							raw: {},
    							structured: {},
    							error: null,
    							submitting: false
    						},
    						job: {
    							status: "loading",
    							data: null,
    							error: null
    						},
    						finalTask: idle$1(),
    						attachments: idle$1(),
    						taskId: null,
    						task: idle$1(),
    						attachment: null,
    						tick: now.tick + 1
    					};
    					return jobId === "" ? next : {
    						...next,
    						route: {
    							kind: "job",
    							workflowId,
    							jobId,
    							view: "overview"
    						}
    					};
    				});
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
    				nodeTasks: null,
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
    				task: idle$1(),
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
    * 页面数据 effect：工作流目录、工作流详情、作业详情、结束任务、任务详情、
    * 附件库、预览、hash 路由与轮询。
    *
    * 轮询沿用旧页面风格：有 `running` 作业时 1.5 秒一次，否则 5 秒一次。所有请求
    * 都可取消（路由切换 / 卸载时不再写状态）。
    */
    /** 路由完全相同。 */
    function routesEqual(left, right) {
    	if (left.kind !== right.kind) return false;
    	if (left.kind === "workflows") return true;
    	if (left.kind === "workflow" && right.kind === "workflow") return left.workflowId === right.workflowId && left.tab === right.tab;
    	if (left.kind === "job" && right.kind === "job") return left.workflowId === right.workflowId && left.jobId === right.jobId && left.view === right.view;
    	return false;
    }
    /** 空的可加载状态。 */
    function idle() {
    	return {
    		status: "idle",
    		data: null,
    		error: null
    	};
    }
    /**
    * 浏览器前进 / 后退：把新 hash 合进状态，只在跨页面时清掉旧数据。
    *
    * @param current 当前状态
    * @param next 新路由
    * @returns 新状态
    */
    function applyHashRoute(current, next) {
    	if (routesEqual(current.route, next)) return current;
    	if (sameRoutePage(current.route, next)) return {
    		...current,
    		route: next,
    		...next.kind === "workflow" && current.route.kind === "workflow" && next.tab === "jobs" ? { definitionSelection: null } : {},
    		...next.kind === "job" && current.route.kind === "job" && next.view !== "flow" ? { nodeTasks: null } : {}
    	};
    	const base = {
    		...current,
    		route: next,
    		definitionSelection: null,
    		nodeTasks: null,
    		taskId: null,
    		task: idle(),
    		attachment: null,
    		attachments: idle(),
    		finalTask: idle(),
    		newJob: {
    			open: false,
    			raw: {},
    			structured: {},
    			error: null,
    			submitting: false
    		}
    	};
    	if (next.kind === "workflows") return {
    		...base,
    		workflow: idle(),
    		job: idle()
    	};
    	const sameWorkflow = current.route.kind !== "workflows" && current.route.workflowId === next.workflowId && current.workflow.data !== null;
    	const job = next.kind === "job" ? current.route.kind === "job" && current.route.jobId === next.jobId && current.job.data !== null ? current.job : idle() : idle();
    	return {
    		...base,
    		workflow: sameWorkflow ? current.workflow : idle(),
    		job
    	};
    }
    /**
    * 挂载全部取数与轮询 effect。
    *
    * @param store 页面状态
    */
    function useWorkflowEffects(store) {
    	const { state, setState } = store;
    	const route = state.route;
    	const tick = state.tick;
    	react.default.useEffect(() => {
    		if (typeof window === "undefined") return void 0;
    		const onHash = () => {
    			setState((current) => applyHashRoute(current, parseRouteHash(window.location.hash)));
    		};
    		window.addEventListener("hashchange", onHash);
    		return () => window.removeEventListener("hashchange", onHash);
    	}, []);
    	const live = state.job.data?.job?.status === "running";
    	react.default.useEffect(() => {
    		const interval = setInterval(() => setState((current) => ({
    			...current,
    			tick: current.tick + 1
    		})), live ? LIVE_REFRESH_MS : REFRESH_MS);
    		return () => clearInterval(interval);
    	}, [live]);
    	const listView = route.kind === "workflows";
    	react.default.useEffect(() => {
    		if (!listView) return void 0;
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
    	}, [tick, listView]);
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
    	const endTask = (state.job.data?.tasks ?? []).find((task) => task.position === "end" && typeof task.id === "string");
    	const endTaskId = typeof endTask?.id === "string" ? endTask.id : "";
    	react.default.useEffect(() => {
    		if (jobId === "" || endTaskId === "") {
    			setState((current) => current.finalTask.status === "idle" && current.finalTask.data === null ? current : {
    				...current,
    				finalTask: idle()
    			});
    			return;
    		}
    		let cancelled = false;
    		setState((current) => ({
    			...current,
    			finalTask: {
    				...current.finalTask,
    				status: current.finalTask.data === null ? "loading" : current.finalTask.status
    			}
    		}));
    		requestJson(`${TASK_ROUTE}?jobId=${encodeURIComponent(jobId)}&taskId=${encodeURIComponent(endTaskId)}`).then((body) => {
    			if (cancelled) return;
    			if (!isRecord(body?.task)) return;
    			setState((current) => ({
    				...current,
    				finalTask: {
    					status: "ready",
    					data: body.task,
    					error: null
    				}
    			}));
    		}, (failure) => {
    			if (cancelled) return;
    			setState((current) => ({
    				...current,
    				finalTask: {
    					...current.finalTask,
    					status: "ready",
    					error: messageOf(failure)
    				}
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [
    		jobId,
    		endTaskId,
    		tick
    	]);
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
    	const outputsView = route.kind === "job" && route.view === "outputs";
    	react.default.useEffect(() => {
    		if (!outputsView || jobId === "") return void 0;
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
    		outputsView,
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
    		route: initialRoute(),
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
    		finalTask: {
    			status: "idle",
    			data: null,
    			error: null
    		},
    		jobFilter: "all",
    		definitionSelection: null,
    		nodeTasks: null,
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
    // .build/workflows/client/use-narrow.js
    /**
    * 视口宽度：窄屏时看板退化成按状态分组的纵向列表。
    *
    * 只在页面组件顶层调用一次，通过 `AppContext.narrow` 传给渲染函数；渲染函数
    * 自己不能调用 hook（它们在条件分支里被调用）。
    */
    /** 与 CSS 的 `@media (width<=767px)` 保持一致。 */
    const NARROW_QUERY = "(max-width: 767px)";
    /**
    * 当前视口是否窄屏。
    *
    * @returns 窄屏时为 true
    */
    function useIsNarrow() {
    	const [narrow, setNarrow] = react.default.useState(() => {
    		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    		try {
    			return window.matchMedia(NARROW_QUERY).matches;
    		} catch {
    			return false;
    		}
    	});
    	react.default.useEffect(() => {
    		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return void 0;
    		const media = window.matchMedia(NARROW_QUERY);
    		const update = () => setNarrow(media.matches);
    		update();
    		if (typeof media.addEventListener === "function") {
    			media.addEventListener("change", update);
    			return () => media.removeEventListener("change", update);
    		}
    	}, []);
    	return narrow;
    }
    // .build/workflows/client/page.js
    /**
    * 侧边栏「工作流」页面：装配状态、数据 effect 与动作，渲染只做分发。
    *
    * 导航只有一条链：工作流列表 → 工作流（作业 / 定义结构）→ 作业（概览 /
    * 实时流程 / 看板 / 资产）。不存在跨工作流的作业列表。
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
    	const narrow = useIsNarrow();
    	const actions = createActions(store, {
    		t,
    		getService
    	});
    	return renderPage({
    		t,
    		getService,
    		state: store.state,
    		actions,
    		narrow
    	});
    }
    // .build/workflows/client/styles.js
    /**
    * 页面样式：沿用 Workers / Skills 页的标题行 + 内容区 + 卡片结构；
    * 工作流页补定义图，作业页补贴纸摘要、实时流程、看板与资产池。
    */
    /** 页面样式。 */
    const CSS = `
    .buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
    @media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
    .buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:2;position:sticky;top:0}
    .buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
    .buka-workflows-page.is-mid .buka-workflows-headInner,.buka-workflows-page.is-mid .buka-workflows-body{max-width:1120px}
    .buka-workflows-page.is-wide .buka-workflows-headInner,.buka-workflows-page.is-wide .buka-workflows-body{max-width:1280px}
    .buka-workflows-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 16px;min-width:0}
    .buka-workflows-titleGroup{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
    .buka-workflows-title{font-size:20px;font-weight:500;line-height:28px;margin:0;overflow-wrap:anywhere}
    .buka-workflows-titleMeta{display:inline-flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
    .buka-workflows-titleSub{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;font-weight:400}
    .buka-workflows-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .buka-workflows-back{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
    .buka-workflows-back svg{transform:rotate(180deg)}
    @media (hover:hover){.buka-workflows-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-back:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-tabs{display:flex;align-items:center;gap:8px;padding:14px 0 0;min-width:0;overflow-x:auto;overscroll-behavior-x:contain}
    .buka-workflows-tabList{width:fit-content;max-width:100%}
    .buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;display:flex;flex-direction:column;padding:28px 0 48px;scrollbar-gutter:stable}
    .buka-workflows-more{position:relative;display:inline-flex}
    .buka-workflows-moreSummary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;background:0 0}
    .buka-workflows-moreSummary::-webkit-details-marker{display:none}
    .buka-workflows-moreMenu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;padding:6px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgb(0 0 0 / 16%);min-width:120px}
    .buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
    .buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
    .buka-workflows-emptyBox{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:8px 0}
    .buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-failureBox{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
    .buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;overflow-wrap:anywhere;word-break:break-all}
    .buka-workflows-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;width:100%;box-sizing:border-box}
    .buka-workflows-pre.is-tall{max-height:360px}
    .buka-workflows-pre.is-inline{max-height:160px;margin:2px 0}
    .buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:28px;padding:0 10px;font-size:12px;line-height:18px}
    .buka-workflows-smallButton.is-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
    .buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
    .buka-workflows-textButton{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-textButton:hover{text-decoration:underline}
    .buka-workflows-confirm{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
    .buka-workflows-confirmText{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
    .buka-workflows-notice{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
    .buka-workflows-noticeText{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px;flex:1 1 260px}
    .buka-workflows-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
    .buka-workflows-listPane{display:flex;flex-direction:column;gap:12px}
    .buka-workflows-listToolbar{display:flex;align-items:center;justify-content:flex-end;min-height:18px}
    .buka-workflows-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-xl);padding:10px 8px;margin:0 -8px;font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-card.is-disabled{opacity:.55}
    .buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    .buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
    .buka-workflows-cardTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
    .buka-workflows-cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:18px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .buka-workflows-cardTags{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap}
    .buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px 5px}
    .buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-progress{display:block;width:100%;height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:2px}
    .buka-workflows-progressBar{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
    .buka-workflows-progressBar.is-completed{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-progressBar.is-failed,.buka-workflows-progressBar.is-cancelled{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
    .buka-workflows-filter{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
    @media (hover:hover){.buka-workflows-filter:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-filter.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
    .buka-workflows-filterCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px;line-height:16px}
    .buka-workflows-filter.is-active .buka-workflows-filterCount{color:inherit}
    .buka-workflows-detail{display:flex;flex-direction:column;gap:20px;min-width:0}
    .buka-workflows-section{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    .buka-workflows-sectionTitle{font-size:15px;font-weight:600;line-height:22px;margin:0;color:var(--dsw-alias-label-primary)}
    .buka-workflows-kv{display:flex;flex-direction:column;gap:4px}
    .buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;line-height:18px}
    .buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);min-width:96px}
    .buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0;flex:1 1 auto}
    .buka-workflows-values{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-valueRow{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;line-height:20px}
    .buka-workflows-valueKey{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);min-width:120px;font-size:12px;line-height:18px}
    .buka-workflows-valueValue{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
    .buka-workflows-details{display:flex;flex-direction:column;gap:6px;min-width:0}
    .buka-workflows-detailsSummary{cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;width:fit-content;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-detailsSummary:hover{color:var(--dsw-alias-label-secondary)}
    .buka-workflows-details[open] .buka-workflows-detailsSummary{margin-bottom:4px}
    .buka-workflows-definitionPane{display:flex;flex-direction:column;gap:12px;min-width:0}
    .buka-workflows-definitionToolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .buka-workflows-graphPane{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-graphViewport{width:100%;overflow:hidden;overscroll-behavior:contain}
    .buka-workflows-graphScaleBox{position:relative;flex:none;margin:0 auto}
    .buka-workflows-graphCanvas{position:absolute;left:0;top:0;flex:none}
    .buka-workflows-graphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
    .buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.5;stroke-linecap:round;opacity:.7}
    .buka-workflows-edgeGroup.is-back .buka-workflows-edge{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:5 4;opacity:.9}
    .buka-workflows-edge.is-taken{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2;opacity:1}
    .buka-workflows-edgeGroup.is-selected .buka-workflows-edge{stroke:var(--dsw-alias-brand-primary);stroke-width:2.4;opacity:1}
    .buka-workflows-hitPath{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
    .buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.8;pointer-events:none}
    .buka-workflows-edgeArrow.is-back{fill:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-edgeArrow.is-taken{fill:var(--dsw-alias-brand-primary);opacity:1}
    .buka-workflows-edgeLabel{fill:var(--dsw-alias-label-tertiary);font-size:10px;paint-order:stroke;stroke:var(--dsw-alias-bg-base);stroke-width:3px;stroke-linejoin:round;pointer-events:none;user-select:none}
    .buka-workflows-edgeLabel.is-back{fill:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-edgeLabel.is-taken{fill:var(--dsw-alias-brand-primary)}
    .buka-workflows-edgeTip{position:absolute;z-index:4;transform:translate(-50%,-50%);padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 2px 10px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;white-space:nowrap;pointer-events:none}
    .buka-workflows-graphCaption{text-align:center}
    .buka-workflows-nodeWrap{position:absolute;z-index:2}
    .buka-workflows-node{position:relative;display:flex;align-items:center;gap:6px;width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;overflow:visible}
    button.buka-workflows-node{cursor:pointer}
    @media (hover:hover){button.buka-workflows-node:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    button.buka-workflows-node:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    .buka-workflows-node.is-start,.buka-workflows-node.is-end{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-style:dashed}
    .buka-workflows-node.is-human{border-color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-node.is-worker{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
    .buka-workflows-node.is-idle{border-style:dashed;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
    .buka-workflows-node.is-running{border-color:var(--dsw-alias-brand-primary);animation:buka-workflows-pulse 1.8s ease-out infinite}
    .buka-workflows-node.is-waiting{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent)}
    .buka-workflows-node.is-failed{border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}
    .buka-workflows-node.is-done{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}
    .buka-workflows-node.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
    @keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-node.is-running{animation:none}}
    .buka-workflows-nodeAvatar{flex:none}
    .buka-workflows-nodeCorner{position:absolute;top:-8px;right:-6px;z-index:1;display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:16px;box-sizing:border-box;padding:0 4px;border-radius:999px;font-family:var(--ds-font-family-code);font-size:9.5px;font-weight:600;line-height:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base)}
    .buka-workflows-nodeCorner.is-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-success-primary)}
    .buka-workflows-nodeCorner.is-running{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-brand-primary)}
    .buka-workflows-nodeCorner.is-waiting{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-nodeCorner.is-failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-error-primary)}
    .buka-workflows-nodeLabel{font-size:12.5px;font-weight:600;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}

    .buka-workflows-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;width:100%}
    .buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
    .buka-workflows-legendItem{display:inline-flex;align-items:center;gap:5px}
    .buka-workflows-legendNode{box-sizing:border-box;width:20px;height:10px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2)}
    .buka-workflows-legendNode.is-start,.buka-workflows-legendNode.is-end{border-style:dashed}
    .buka-workflows-legendNode.is-worker{border-color:var(--dsw-alias-brand-primary)}
    .buka-workflows-legendNode.is-human{border-color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
    .buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
    .buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption)}
    .buka-workflows-legendLine.is-back{border-top-color:var(--dsw-alias-state-warn-primary);border-top-style:dashed}
    .buka-workflows-legendLine.is-taken{border-top-color:var(--dsw-alias-brand-primary);border-top-width:2.2px}
    .buka-workflows-boardPane{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-board{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:8px}
    .buka-workflows-boardGrid{display:grid;grid-template-columns:148px repeat(5,minmax(150px,1fr));gap:6px;min-width:940px}
    .buka-workflows-boardHeader{display:contents}
    .buka-workflows-boardRowHead{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
    .buka-workflows-boardHeader>.buka-workflows-boardRowHead{background:transparent;padding-top:0}
    .buka-workflows-boardColumnHead{font-size:10.5px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:0 2px 4px}
    .buka-workflows-boardColumnHead.is-ready{color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-boardRow{display:contents}
    .buka-workflows-boardRowTitle{font-size:12px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-boardRowExecutor{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
    .buka-workflows-boardRowMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
    .buka-workflows-boardRow.is-starter .buka-workflows-boardRowHead{border-left:2px solid var(--dsw-alias-border-l2)}
    .buka-workflows-boardCell{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:52px;padding:4px;border-radius:var(--dsw-radius-sm);border:0.5px dashed var(--dsw-alias-border-l1)}
    .buka-workflows-boardCell.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
    .buka-workflows-boardCompact{display:flex;flex-direction:column;gap:16px}
    .buka-workflows-boardGroup{display:flex;flex-direction:column;gap:8px}
    .buka-workflows-boardGroupTitle{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary)}
    .buka-workflows-boardGroupTitle.is-ready{color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-boardGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px}
    .buka-workflows-taskList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-taskItem{display:flex;min-width:0}
    .buka-workflows-taskItem>.buka-workflows-taskCard{width:100%}
    .buka-workflows-taskCard{display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;text-align:left;padding:8px 9px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-taskCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-taskCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-taskCard.is-running{border-color:var(--dsw-alias-brand-primary)}
    .buka-workflows-taskCard.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent)}
    .buka-workflows-taskCard.is-failed,.buka-workflows-taskCard.is-blocked{border-color:var(--dsw-alias-state-error-primary)}
    .buka-workflows-taskCardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}
    .buka-workflows-taskCardType{font-size:12px;font-weight:500;line-height:18px;overflow-wrap:anywhere;min-width:0}
    .buka-workflows-taskCardPosition{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
    .buka-workflows-taskCardMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
    .buka-workflows-taskCardSummary{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .buka-workflows-overview{display:flex;flex-direction:column;gap:24px;min-width:0}
    .buka-workflows-overviewCard{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0}
    .buka-workflows-finalCard{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
    .buka-workflows-finalHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .buka-workflows-inlineGroup{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
    .buka-workflows-outputsPane{display:flex;flex-direction:column;gap:20px;min-width:0}
    .buka-workflows-outputGroup{display:flex;flex-direction:column;gap:8px;min-width:0}
    .buka-workflows-outputGroupHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-outputGroupTitle{font-size:13px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-outputGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px;margin-left:auto}
    .buka-workflows-asset{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
    .buka-workflows-assetMain{display:flex;flex-direction:column;gap:3px;min-width:180px;flex:1 1 auto}
    .buka-workflows-assetActions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none}
    .buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
    .buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
    .buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:18px;text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
    @media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
    .buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
    .buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1 1 auto;min-width:120px;overflow-wrap:anywhere}
    .buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11px;flex:none}
    .buka-workflows-attachmentDownload:hover{text-decoration:underline}
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
    .buka-workflows-result{display:flex;flex-direction:column;gap:12px}
    .buka-workflows-taskForm{display:flex;flex-direction:column;gap:10px}
    .buka-workflows-contractBody{display:flex;flex-direction:column;gap:8px;min-width:0}
    .buka-workflows-tagRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .buka-workflows-initialList{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
    .buka-workflows-initialRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-initialMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;font-size:12px;line-height:18px}
    .buka-workflows-clamped{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}
    .buka-workflows-clampedText{margin:0;width:100%;box-sizing:border-box;overflow-wrap:anywhere;white-space:pre-wrap}
    .buka-workflows-clampedText.is-clamped{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:normal}
    .buka-workflows-drawerText{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-required{color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:16px}
    .buka-workflows-typeList{display:flex;flex-direction:column;min-width:0}
    .buka-workflows-typeRow{display:flex;flex-direction:column;gap:5px;padding:12px 0;border-top:0.5px solid var(--dsw-alias-border-l1);min-width:0}
    .buka-workflows-typeRow:first-child{border-top:0;padding-top:0}
    .buka-workflows-typeRow:last-child{padding-bottom:0}
    .buka-workflows-typeRowHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-typeName{font-size:13px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
    .buka-workflows-typeTags{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
    .buka-workflows-typeDesc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;overflow-wrap:anywhere}
    .buka-workflows-contractStack{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-contractStack.is-tight{gap:5px}
    .buka-workflows-contractBlock{display:flex;flex-direction:column;gap:4px;min-width:0}
    .buka-workflows-contractLine{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;align-items:start;min-width:0}
    .buka-workflows-contractLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap;padding-top:2px}
    .buka-workflows-contractValue{display:flex;flex-direction:column;gap:4px;min-width:0}
    .buka-workflows-contractFields{display:flex;flex-wrap:wrap;gap:4px 6px;min-width:0}
    .buka-workflows-contractField{display:inline-flex;align-items:baseline;gap:5px;max-width:100%;padding:1px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:17px;min-width:0}
    .buka-workflows-contractField .buka-workflows-inlineCode{flex:none;background:0;padding:0;font-size:11px;line-height:17px}
    .buka-workflows-contractType{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10px;line-height:16px;flex:none}
    .buka-workflows-contractDesc{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;overflow-wrap:anywhere}
    .buka-workflows-statStrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:1px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-border-l1);overflow:hidden}
    .buka-workflows-stat{display:flex;flex-direction:column;gap:1px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);min-width:0}
    .buka-workflows-statValue{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .buka-workflows-statLabel{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-resultText{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
    .buka-workflows-resultBlock{display:flex;flex-direction:column;gap:5px;min-width:0}
    .buka-workflows-subLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;line-height:16px}
    .buka-workflows-deliverable{padding:10px 12px;border-radius:var(--dsw-radius-md);border:0.5px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 5%,transparent)}
    .buka-workflows-field{display:flex;flex-direction:column;gap:4px;min-width:0}
    .buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}
    .buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px;overflow-wrap:anywhere}
    .buka-workflows-input{width:100%}
    .buka-workflows-textarea,.buka-workflows-select{box-sizing:border-box;width:100%;padding:6px 8px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;line-height:18px;resize:vertical}
    .buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-formActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
    .buka-workflows-dialogForm{display:flex;flex-direction:column;gap:14px}
    .buka-workflows-dialogSection{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-dialogSectionTitle{margin:0;font-size:13px;font-weight:600;line-height:20px}
    .buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
    .buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(560px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
    .buka-workflows-inspector.buka-workflows-inspector{width:min(460px,100vw)}
    .buka-workflows-nodeTasks.buka-workflows-nodeTasks{width:min(480px,100vw)}
    @keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
    @media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
    .buka-workflows-drawerHead{flex:none;padding:14px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-drawerHeadRow{display:flex;align-items:flex-start;gap:10px;min-width:0}
    .buka-workflows-drawerHeading{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
    .buka-workflows-drawerAvatar{margin-top:3px}
    .buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .buka-workflows-drawerTitle{flex:0 1 auto;min-width:0;margin:0;font-size:15px;font-weight:600;line-height:22px;overflow-wrap:anywhere}
    .buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .buka-workflows-drawerActions{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto;min-width:0}
    .buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-drawerDownload:hover{text-decoration:underline}
    .buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}
    @media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px;overflow:auto;overscroll-behavior:contain;padding:16px 16px 28px}
    .buka-workflows-drawerBody .buka-workflows-sectionTitle{font-size:13px;line-height:20px}
    .buka-workflows-drawerBody .buka-workflows-valueKey{min-width:88px}
    .buka-workflows-drawerBody .buka-workflows-kvKey{min-width:80px}
    .buka-workflows-sectionHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:17px;overflow-wrap:anywhere}
    .buka-workflows-fold{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:10px;min-width:0}
    .buka-workflows-foldSummary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:20px;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-foldSummary:hover{color:var(--dsw-alias-label-primary)}
    .buka-workflows-fold[open] .buka-workflows-foldSummary{margin-bottom:8px;color:var(--dsw-alias-label-primary)}
    .buka-workflows-foldBody{display:flex;flex-direction:column;gap:10px;min-width:0}
    .buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    @media (width<=767px){
    .buka-workflows-title{font-size:18px;line-height:26px}
    .buka-workflows-titleSub{flex:1 1 100%}
    .buka-workflows-body{padding:20px 0 36px}
    .buka-workflows-sectionTitle{font-size:14px}
    .buka-workflows-overviewCard{padding:10px 12px}
    .buka-workflows-valueRow{flex-direction:column;gap:2px}
    }
    `;
    // .build/workflows/client/index.js
    /**
    * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的「工作流」页面。
    *
    * 页面只做一条链：工作流列表 → 工作流（作业 / 定义结构）→ 作业（概览 /
    * 实时流程 / 看板 / 资产）。
    *
    * - 工作流列表：名称、描述、版本、作业数；停用的工作流灰显并排在后面；
    * - 工作流页：作业（默认）按状态筛选；定义结构是可交互的分层图，点节点 / 连线
    *   在右侧抽屉里看岗位、任务类型、边与契约；
    * - 作业页：概览（需求 / 结构化输入、最终交付物、启动信息）、实时流程（任务
    *   状态叠在定义图上）、看板（岗位 × 状态）、资产（按来源任务分组的资产池）；
    *   点节点 / 卡片从右侧抽屉看任务，人任务按产出 schema 填表提交；
    * - 作业有 `running` 时每 1.5 秒刷新一次，否则 5 秒。
    *
    * 数据与动作来自 Host 的 `/buka-workflows/*` 路由；附件下载 / 预览走
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
