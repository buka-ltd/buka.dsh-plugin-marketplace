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
    * 执行者页与工作流节点图原本各维护一份同样的显示表；插件之间不互相 import，
    * 所以统一收在这里，两个浏览器一半都从这里派生。id 与 Host 的
    * `plugins/workflows/src/workers/avatar.ts` 一一对应（那边只存 id，不存 emoji / 底色），
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
    /** 列表 / 默认值用第一个预设。 */
    const DEFAULT_AVATAR_ID = AVATARS[0].id;
    /**
    * 头像 id → 预设；不认识的 id 返回 `undefined`。
    *
    * 两个浏览器一半的兜底不同：执行者页退回第一个预设，节点图当作没有头像，
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
    * 全部重载（这样内联回调仍能拿到事件类型），另外补一个宽松签名：执行者 / 技能
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
    async function requestJson$1(url, init = {}) {
    	const { allowFailureBody = false, ...requestInit } = init;
    	const headers = { accept: "application/json" };
    	if (requestInit.body !== void 0) headers["content-type"] = "application/json";
    	const extraHeaders = requestInit.headers ?? {};
    	const response = await fetch(url, {
    		...requestInit,
    		headers: {
    			...headers,
    			...extraHeaders
    		}
    	});
    	const body = await response.json().catch(() => null);
    	if (!response.ok || body === null || body.ok !== true && !allowFailureBody) {
    		const error = new Error(typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    		error.code = typeof body?.code === "string" ? body.code : void 0;
    		error.output = typeof body?.output === "string" ? body.output : void 0;
    		throw error;
    	}
    	return body;
    }
    /**
    * 把失败原因转成展示文本。
    *
    * @param failure 捕获到的任意失败值
    */
    function messageOf$1(failure) {
    	return failure instanceof Error ? failure.message : String(failure);
    }
    // packages/plugin-ui/lib/tab-label.js
    /**
    * 页签标签：按选中态字重预留宽度，切换页签时整条页签栏不改宽。
    *
    * `SegmentedTabs` 的列宽由标签的 max-content 决定，选中态把字重从 400 提到
    * 500 / 600 后标签变宽，整条页签栏会跟着变宽（例如「AGENTS.md」比其它页签
    * 长时最明显）。这里把可见文本与一份不可见的加粗副本叠在同一个网格单元里，
    * 列宽始终按加粗副本计算，可见文本的字重怎么变都不影响布局。
    *
    * @module plugin-ui/tab-label
    */
    /** 不可见副本的字重：不低于 `SegmentedTabs` 选中态的字重（sm 500、md 600）。 */
    const RESERVED_WEIGHT = 600;
    /**
    * 一个页签标签，宽度已按选中态预留。
    *
    * @param props.text 可见文案
    * @returns 叠了加粗测量副本的标签
    */
    function TabLabel({ text }) {
    	return h("span", { style: {
    		display: "inline-grid",
    		alignItems: "center"
    	} }, h("span", { style: {
    		gridArea: "1 / 1",
    		whiteSpace: "nowrap"
    	} }, text), h("span", {
    		"aria-hidden": true,
    		style: {
    			gridArea: "1 / 1",
    			whiteSpace: "nowrap",
    			visibility: "hidden",
    			fontWeight: RESERVED_WEIGHT
    		}
    	}, text));
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
    const en$1 = {
    	panel: "Workflows",
    	topTabWorkflow: "Workflow",
    	topTabWorker: "Worker",
    	topTabsAria: "Main views",
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
    	workflowOutdated: "Needs upgrade",
    	workerUnavailable: "Unavailable",
    	workerUnavailableHint: "A worker referenced by this workflow or job no longer exists. Start and dispatch stay blocked until an existing worker is bound again.",
    	workerDeleted: "Deleted",
    	workerMissingExecutor: "Position \"{position}\" references missing worker identifier \"{id}\".",
    	workerMissingAssistant: "Task type \"{type}\" references missing assistant identifier \"{id}\".",
    	workerMissingDelivery: "The delivery assistant \"{id}\" no longer exists.",
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
    	definitionTab: "Structure",
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
    	jobLegacy: "Old version",
    	jobLegacyHint: "This job was created by an old definition version and is read-only.",
    	jobsEmptyOutdated: "This workflow uses an old definition version; ask the orchestrator to rewrite it before starting a job.",
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
    	definitionTabsAria: "Definition sections",
    	definitionTabOverview: "Overview",
    	definitionTabContract: "Contracts",
    	positionTaskTypes: "Task types it handles",
    	initialContent: "Creates a task with content",
    	initialNoContent: "Creates a task",
    	positionExecutor: "Executor",
    	taskTypesTitle: "Task types",
    	taskTypesEmpty: "This position declares no task types.",
    	taskTypeContent: "Content",
    	taskTypeActions: "Actions",
    	taskTypeCreates: "Creates",
    	taskTypeAssistant: "Assistant",
    	taskTypeModePlan: "Plan",
    	taskTypeUnset: "—",
    	schemaNoFields: "No fields.",
    	schemaFieldRequired: "required",
    	channelTitle: "Channel",
    	channelBack: "Back channel",
    	channelSender: "Sender",
    	channelReceiver: "Receiver",
    	channelAllowedTypes: "Allowed task types",
    	channelAllTypes: "All task types",
    	startTaskTitle: "Start task",
    	startTaskShort: "Start",
    	endTaskTitle: "End task",
    	endTaskShort: "End",
    	startContractHint: "The start task turns the request into the structured input used by the rest of the job.",
    	endContractHint: "The end task delivers the final output to the starter.",
    	startContentTitle: "Job input",
    	startPayloadHint: "What the person starting the job fills in.",
    	endContentTitle: "Final report",
    	endPayloadHint: "The final report the starter agrees to receive.",
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
    	newJobContentTitle: "Job input",
    	newJobContentHint: "This is what the workflow receives; tasks are created from it.",
    	newJobDeliveryTitle: "How the final report comes back",
    	newJobDeliveryHint: "Hand it back to you, or let an assistant receive it for you.",
    	newJobDeliveryStarter: "Back to me",
    	newJobDeliveryAssistant: "To my assistant",
    	newJobTitle: "New job",
    	newJobHint: "Tell the workflow what needs to be done this time.",
    	newJobSubmit: "Start job",
    	newJobSubmitting: "Starting…",
    	newJobStarted: "Job created.",
    	newJobFailed: "Could not start the job: ",
    	newJobJsonInvalid: "Job input is not valid JSON: ",
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
    	overviewFinal: "Final deliverable",
    	overviewFinalEmpty: "The job has not reached the end task yet.",
    	overviewFinalPending: "The end task has not delivered yet.",
    	overviewOpenFinalTask: "Open end task",
    	starter: "Starter",
    	overviewStarter: "Started by",
    	overviewWorkflow: "Workflow",
    	overviewDelivery: "Final report",
    	starterHuman: "Person (page)",
    	starterSession: "Session",
    	openStarterSession: "Open starter session",
    	cancelJob: "Cancel job",
    	cancelJobConfirm: "Unfinished tasks will stop. ",
    	cancelJobConfirmAction: "Confirm cancel",
    	retryDelivery: "Retry delivery",
    	deliveryRetryHint: "The end task is still waiting because delivery failed.",
    	deliveryRetryStarted: "Delivery retry requested.",
    	restartJob: "Restart job",
    	restartEntryHint: "This job failed. You can resume from the failure or start over from the same input.",
    	restartTitle: "Restart job",
    	restartHint: "Only a failed job can be restarted. Pick how to continue; the job page will refresh with the result.",
    	restartFromFailed: "Resume from the failure",
    	restartFromFailedHint: "Continue in this job: the failed task is dispatched again, tasks that the job failure cancelled are queued again, and completed tasks keep their results and attempts. Tasks a person cancelled stay cancelled. The duration budget restarts now.",
    	restartFromFailedTasks: "Failed tasks to re-dispatch",
    	restartScratch: "Start over",
    	restartScratchHint: "Create a new job from the same input using the definition version this workflow has enabled now. The failed job stays as it is so you can still inspect it.",
    	restartUnavailable: "Unavailable",
    	restartSubmitting: "Restarting…",
    	restartFailed: "Could not restart the job: ",
    	restartFromFailedStarted: "Job resumed from the failure.",
    	restartScratchStarted: "New job created from the same input.",
    	restartCount: "Restarts",
    	restartSource: "Restarted from",
    	restartSourceJob: "Job #{seq}",
    	restartSourceOpen: "Open the job it came from",
    	restartReasonJobNotFailed: "Only a failed job can be restarted.",
    	restartReasonNoFailedTasks: "This job has no failed task; start over in a new job instead.",
    	restartReasonWorkflowNotFound: "The workflow no longer exists.",
    	restartReasonWorkflowRetired: "The workflow is disabled; enable it before starting over.",
    	restartReasonDefinitionOutdated: "The workflow is not on the current definition version.",
    	restartReasonUnknown: "This option is not available.",
    	flowHint: "Select a node to see its tasks. Heavier lines have already been traversed.",
    	flowWaitingUser: "A session here is waiting for you; open it to reply.",
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
    	attachmentMarkdownCodeCopy: "Copy",
    	attachmentMarkdownCodeCopied: "Copied",
    	attachmentMarkdownCodeTitle: "Code",
    	attachmentMarkdownCodeWrap: "Wrap",
    	attachmentMarkdownCodeUnwrap: "Unwrap",
    	attachmentMarkdownFootnotes: "Footnotes",
    	taskDrawerTitle: "Task",
    	taskPosition: "Position",
    	taskType: "Type",
    	taskChannel: "Channel",
    	taskStatus: "Status",
    	taskDelegatedTo: "Delegated to",
    	taskWaitingForYou: "Waiting for you",
    	taskYouAreHandling: "You are handling this",
    	taskCreatedAt: "Created",
    	taskStartedAt: "Started",
    	taskFinishedAt: "Finished",
    	taskDepsTitle: "Dependencies",
    	taskDepsEmpty: "No dependencies.",
    	taskContentTitle: "Task content",
    	taskContentEmpty: "No content.",
    	taskAttemptsTitle: "Attempts",
    	taskAttemptsEmpty: "No attempts yet.",
    	taskDetailsTitle: "Details",
    	taskAttemptStopReason: "Stop reason",
    	taskAttemptError: "Error",
    	taskResultTitle: "Result",
    	taskResultEmpty: "No result yet.",
    	taskResultText: "Note",
    	taskResultAction: "Action",
    	taskResultInput: "Form",
    	taskResultAttachments: "Files",
    	finalDeliverableTitle: "Final deliverable",
    	taskActionsTitle: "Actions",
    	taskActionsEmpty: "No actions are available.",
    	actionClaim: "Claim",
    	actionCancel: "Cancel task",
    	actionRetry: "Retry",
    	actionSubmitAction: "Apply this action",
    	actionSubmitCompleteOnly: "Submit result only",
    	actionSubmitting: "Submitting…",
    	actionTextLabel: "Summary (optional)",
    	actionFormTitle: "What happens next",
    	actionFormHint: "Pick an action, fill in its form if it has one, then submit.",
    	actionFormNoActions: "This task has no actions; submitting records a result only.",
    	actionFormNoSchema: "This action takes no structured form.",
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
    const zh$1 = {
    	panel: "工作流",
    	topTabWorkflow: "工作流",
    	topTabWorker: "执行者",
    	topTabsAria: "主视图",
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
    	workflowOutdated: "待升级",
    	workerUnavailable: "不可用",
    	workerUnavailableHint: "这个工作流或作业引用的执行者已不存在。重新绑定一个已存在的执行者之前，启动作业与任务派发都会保持阻塞。",
    	workerDeleted: "已删除",
    	workerMissingExecutor: "岗位「{position}」引用的执行者标识符「{id}」已不存在。",
    	workerMissingAssistant: "任务类型「{type}」引用的助理标识符「{id}」已不存在。",
    	workerMissingDelivery: "交回方式里的助理「{id}」已不存在。",
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
    	actorWorker: "执行者",
    	actorHuman: "工作人员",
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
    	definitionTab: "结构图",
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
    	jobLegacy: "旧版本",
    	jobLegacyHint: "这个作业由旧版本定义创建，只能查看，不能打开。",
    	jobsEmptyOutdated: "这个工作流还是旧的定义版本；先让编排会话按当前格式重写，再启动作业。",
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
    	definitionTabsAria: "定义分区",
    	definitionTabOverview: "概览",
    	definitionTabContract: "契约",
    	positionTaskTypes: "可处理的任务类型",
    	initialContent: "创建带任务内容的任务",
    	initialNoContent: "创建任务（无内容）",
    	positionExecutor: "主体",
    	taskTypesTitle: "任务类型",
    	taskTypesEmpty: "这个岗位没有声明任务类型。",
    	taskTypeContent: "任务内容",
    	taskTypeActions: "动作",
    	taskTypeCreates: "完成后创建",
    	taskTypeAssistant: "助理",
    	taskTypeModePlan: "计划",
    	taskTypeUnset: "—",
    	schemaNoFields: "没有字段。",
    	schemaFieldRequired: "必填",
    	channelTitle: "通道",
    	channelBack: "回向通道",
    	channelSender: "发送方",
    	channelReceiver: "接收方",
    	channelAllowedTypes: "允许的任务类型",
    	channelAllTypes: "全部任务类型",
    	startTaskTitle: "开始任务",
    	startTaskShort: "开始",
    	endTaskTitle: "结束任务",
    	endTaskShort: "结束",
    	startContractHint: "开始任务把需求转换成后续任务使用的结构化输入。",
    	endContractHint: "结束任务把最终交付物交回发起人。",
    	startContentTitle: "作业输入",
    	startPayloadHint: "启动作业的人填写的内容。",
    	endContentTitle: "最终报告",
    	endPayloadHint: "发起人会收到的最终报告。",
    	budgetMaxTasks: "任务上限",
    	budgetMaxDuration: "最长时长",
    	budgetHours: "小时",
    	budgetUnset: "未设置",
    	graphStart: "开始",
    	graphEnd: "结束",
    	graphWorker: "执行者岗位",
    	graphHuman: "人岗位",
    	graphIdle: "未开始",
    	graphChannelForward: "前向通道",
    	graphChannelBack: "回向通道",
    	graphChannelTaken: "已走过",
    	newJob: "新建作业",
    	newJobContentTitle: "作业输入",
    	newJobContentHint: "工作流收到的内容；初始任务由它生成。",
    	newJobDeliveryTitle: "最终报告怎么交回",
    	newJobDeliveryHint: "交回你自己，或让助理代收。",
    	newJobDeliveryStarter: "交回我",
    	newJobDeliveryAssistant: "交给我的助理",
    	newJobTitle: "新建作业",
    	newJobHint: "告诉工作流这次要做什么。",
    	newJobSubmit: "启动作业",
    	newJobSubmitting: "正在启动…",
    	newJobStarted: "作业已创建。",
    	newJobFailed: "启动作业失败：",
    	newJobJsonInvalid: "作业输入不是合法 JSON：",
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
    	overviewFinal: "最终交付物",
    	overviewFinalEmpty: "作业还没有进入结束任务。",
    	overviewFinalPending: "结束任务还没有交付。",
    	overviewOpenFinalTask: "查看结束任务",
    	starter: "发起人",
    	overviewStarter: "启动信息",
    	overviewWorkflow: "工作流",
    	overviewDelivery: "最终报告",
    	starterHuman: "人（页面启动）",
    	starterSession: "会话",
    	openStarterSession: "打开发起人会话",
    	cancelJob: "取消作业",
    	cancelJobConfirm: "未完成的任务都会停止。",
    	cancelJobConfirmAction: "确认取消",
    	retryDelivery: "重试交付",
    	deliveryRetryHint: "结束任务仍在等待：交付没有成功。",
    	deliveryRetryStarted: "已发起重试交付。",
    	restartJob: "重启作业",
    	restartEntryHint: "这个作业已经失败。你可以从失败位置继续，或按原输入从头开始。",
    	restartTitle: "重启作业",
    	restartHint: "只有失败的作业能重启。选择继续方式；完成后作业页会自动刷新。",
    	restartFromFailed: "从失败位置开始",
    	restartFromFailedHint: "在同一个作业里继续：失败的任务重新派发，因作业失败被取消的任务重新排队，已完成的任务保留结果与执行记录。人主动取消的任务保持取消。最长时长预算从现在重新计时。",
    	restartFromFailedTasks: "会重新派发的失败任务",
    	restartScratch: "从头开始",
    	restartScratchHint: "按原作业输入、用这个工作流当前启用的定义版本新建一个作业。原作业保持失败现场，仍可查看。",
    	restartUnavailable: "不可用",
    	restartSubmitting: "正在重启…",
    	restartFailed: "重启作业失败：",
    	restartFromFailedStarted: "作业已从失败位置继续。",
    	restartScratchStarted: "已按原输入新建作业。",
    	restartCount: "重启次数",
    	restartSource: "来源作业",
    	restartSourceJob: "作业 #{seq}",
    	restartSourceOpen: "打开来源作业",
    	restartReasonJobNotFailed: "只有失败的作业能重启。",
    	restartReasonNoFailedTasks: "这个作业没有失败任务，请从头开始新建作业。",
    	restartReasonWorkflowNotFound: "工作流已不存在。",
    	restartReasonWorkflowRetired: "工作流已停用；启用后才能从头开始。",
    	restartReasonDefinitionOutdated: "工作流不在当前定义版本。",
    	restartReasonUnknown: "这个选项不可用。",
    	flowHint: "点节点查看这个岗位的任务；加重的通道表示已经走过。",
    	flowWaitingUser: "有会话在等你回复，打开会话继续。",
    	flowTaskCount: "{n} 个任务",
    	flowBuiltinStart: "开始",
    	flowBuiltinEnd: "交付",
    	nodeTasksTitle: "{label} · 任务",
    	nodeTasksEmpty: "这个岗位还没有任务。",
    	nodeTasksEmptyHint: "任务派发到这个岗位后会出现在这里。",
    	boardStart: "开始",
    	boardEnd: "结束",
    	boardStarter: "发起人",
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
    	attachmentMarkdownCodeCopy: "复制",
    	attachmentMarkdownCodeCopied: "已复制",
    	attachmentMarkdownCodeTitle: "代码",
    	attachmentMarkdownCodeWrap: "换行",
    	attachmentMarkdownCodeUnwrap: "不换行",
    	attachmentMarkdownFootnotes: "脚注",
    	taskDrawerTitle: "任务详情",
    	taskPosition: "岗位",
    	taskType: "类型",
    	taskChannel: "通道",
    	taskStatus: "状态",
    	taskDelegatedTo: "代办",
    	taskWaitingForYou: "待你办理",
    	taskYouAreHandling: "你在办理",
    	taskCreatedAt: "创建",
    	taskStartedAt: "开始",
    	taskFinishedAt: "结束",
    	taskDepsTitle: "依赖",
    	taskDepsEmpty: "没有依赖。",
    	taskContentTitle: "任务内容",
    	taskContentEmpty: "没有任务内容。",
    	taskAttemptsTitle: "执行记录",
    	taskAttemptsEmpty: "还没有执行记录。",
    	taskDetailsTitle: "更多信息",
    	taskAttemptStopReason: "停止原因",
    	taskAttemptError: "错误",
    	taskResultTitle: "结果",
    	taskResultEmpty: "还没有结果。",
    	taskResultText: "说明",
    	taskResultAction: "动作",
    	taskResultInput: "表单",
    	taskResultAttachments: "附件",
    	finalDeliverableTitle: "最终交付物",
    	taskActionsTitle: "操作",
    	taskActionsEmpty: "当前没有可执行的操作。",
    	actionClaim: "认领",
    	actionCancel: "取消任务",
    	actionRetry: "重试",
    	actionSubmitAction: "执行这个动作",
    	actionSubmitCompleteOnly: "只提交结果",
    	actionSubmitting: "正在提交…",
    	actionTextLabel: "说明（可选）",
    	actionFormTitle: "接下来做什么",
    	actionFormHint: "选一个动作；有表单的填完再提交。",
    	actionFormNoActions: "这个任务没有动作，提交只会记下结果。",
    	actionFormNoSchema: "这个动作没有结构化表单。",
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
    * 这里的形状全部是**客户端本地定义**：按 ADR 0015 / 0017 的 v6 契约声明，不 import
    * 宿主一半的任何模块，避免把 node 依赖带进浏览器包。
    *
    * 契约字段一律按「可能缺失」处理（响应来自新版 / 旧版 Host 都可能），页面
    * 只做防御式读取，不做完整校验。
    */
    /** 侧边栏条目的词典命名空间，也是 `main` 插槽的 locale。 */
    const NS$1 = "buka-workflows";
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
    /** 重启失败作业：failed（从失败位置）/ scratch（从头开始）。 */
    const JOB_RESTART_ROUTE = "/buka-workflows/job/restart";
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
    /** 没有注入会话状态钩子时复用的空快照。 */
    const EMPTY_SESSION_STATUS = /* @__PURE__ */ new Map();
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
    	return requestJson$1(url, {
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
    /**
    * 附件的绝对 inline 地址：Markdown 渲染器只接受绝对 URL，这里按页面 base 补全。
    *
    * @param jobId 作业 id
    * @param attachmentId 附件 id
    * @returns 绝对 inline 地址
    */
    function absoluteAttachmentUrl(jobId, attachmentId) {
    	return new URL(attachmentUrl(jobId, attachmentId, "inline"), document.baseURI).href;
    }
    // .build/workflows/client/model.js
    /**
    * 页面数据模型：把 Host 返回的定义快照 / 任务记录收口成看板与流程图直接消费的形状。
    *
    * 服务端只给「岗位、通道、任务」，坐标与分组都在客户端算（见 `graph/layout.ts`）。
    */
    /**
    * 读取执行者引用的身份；同时容忍 v8 的 `id` 与 v7 快照的 `name`。
    *
    * @param ref 主体、交回方式或助理
    * @returns 标识符与展示名
    */
    function workerIdentity(ref) {
    	const id = typeof ref?.id === "string" && ref.id !== "" ? ref.id : typeof ref?.name === "string" ? ref.name : "";
    	return {
    		id,
    		displayName: typeof ref?.displayName === "string" && ref.displayName !== "" ? ref.displayName : typeof ref?.name === "string" && ref.name !== "" ? ref.name : id
    	};
    }
    /**
    * 展示「展示名 · 标识符」；名称为空（等于标识符）时只显示标识符。
    *
    * @param ref 执行者引用
    * @returns 展示文本；没有引用时是空串
    */
    function workerIdentityText(ref) {
    	return workerIdentityLabel(ref);
    }
    /**
    * 当前页面的派生可用性：作业页取作业的，工作流页取工作流详情的。
    *
    * @param state 页面状态
    * @returns 可用性；还没加载或 Host 没给时 null
    */
    function currentAvailability(state) {
    	if (state.route.kind === "job") return state.job.data?.availability ?? null;
    	return state.workflow.data?.workflow?.availability ?? null;
    }
    /**
    * 缺失的执行者引用。
    *
    * @param state 页面状态
    * @returns 缺失引用数组；可用时是空数组
    */
    function missingWorkersOf(state) {
    	const availability = currentAvailability(state);
    	return Array.isArray(availability?.missingWorkers) ? availability.missingWorkers : [];
    }
    /**
    * 判断一条执行者引用是否已不存在（历史展示据此显示「已删除」与占位头像）。
    *
    * @param state 页面状态
    * @param ref 执行者标识符（v7 快照里是当时的名字）
    * @returns 缺失时为 true
    */
    function isWorkerMissing(state, ref) {
    	if (typeof ref !== "string" || ref === "") return false;
    	return missingWorkersOf(state).some((entry) => entry.id === ref);
    }
    /**
    * 一条缺失引用的可读说明（工作流 / 作业的不可用提示）。
    *
    * @param t 翻译函数
    * @param entry 缺失引用
    * @returns 一句话
    */
    function describeMissingWorker(t, entry) {
    	if (entry.role === "delivery") return fill(t, "workerMissingDelivery", { id: entry.id });
    	if (entry.role === "assistant") return fill(t, "workerMissingAssistant", {
    		type: entry.taskTypeLabel ?? entry.taskTypeId ?? "",
    		id: entry.id
    	});
    	return fill(t, "workerMissingExecutor", {
    		position: entry.positionLabel ?? entry.positionId ?? "",
    		id: entry.id
    	});
    }
    /**
    * 助理引用 → 展示身份；展示名来自工作流详情里的助理列表。
    *
    * @param state 页面状态
    * @param id 助理标识符
    * @returns 展示身份
    */
    function assistantIdentity(state, id) {
    	return workerIdentity({
    		id,
    		name: asArray(state.workflow.data?.assistants).find((assistant) => (assistant.id ?? assistant.name) === id)?.name
    	});
    }
    /**
    * 结束任务的交回方式 → 展示身份。
    *
    * @param delivery 交回方式
    * @returns 展示身份；交回发起人或没有助理时 id 为空
    */
    function deliveryIdentity(delivery) {
    	if (!isRecord(delivery) || delivery.kind !== "assistant") return {
    		id: "",
    		displayName: ""
    	};
    	return workerIdentity(delivery);
    }
    /** 取当前工作流详情里的定义快照；主体补上执行者登记里的展示字段。 */
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
    			note: typeof position.note === "string" ? position.note : "",
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
    /**
    * 人任务类型里的一个动作。
    *
    * @param type 任务类型定义
    * @param actionId 动作 id
    * @returns 动作；不存在时 null
    */
    function actionOf(type, actionId) {
    	if (type === null || actionId === null) return null;
    	return (Array.isArray(type.actions) ? type.actions : []).find((action) => action.id === actionId) ?? null;
    }
    /** 当前作业里的任务；没有详情时给空数组。 */
    function jobTasks(state) {
    	const tasks = state.job.data?.tasks;
    	return Array.isArray(tasks) ? tasks.filter((task) => typeof task?.id === "string") : [];
    }
    /** 当前作业的发起人（开始 / 结束任务的主体）；没有作业时为 null。 */
    function currentStarter(state) {
    	return state.job.data?.job?.starter ?? null;
    }
    /**
    * 发起人的展示文本：人（页面启动）或会话。
    *
    * @param starter
    * @param t
    * @returns 未知发起人时返回空串
    */
    function starterText(starter, t) {
    	if (!isRecord(starter)) return "";
    	return starter.kind === "session" ? t("starterSession") : t("starterHuman");
    }
    /** 从工作流详情里找一条作业摘要。 */
    function jobSummary(workflow, jobId) {
    	if (workflow === null || typeof jobId !== "string" || jobId === "") return null;
    	return (Array.isArray(workflow.jobs) ? workflow.jobs : []).find((job) => job?.id === jobId) ?? null;
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
    * 看板行：发起人（开始 + 结束任务）+ 岗位（定义顺序）。
    *
    * 内建开始 / 结束任务的主体是同一个发起人，因此合并成一行；岗位行只放
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
    * 人任务点名的助理标识符：从任务类型定义取，没有点名时 null。
    *
    * @param state 页面状态
    * @param task 任务
    * @returns 助理标识符；没有点名时 null
    */
    function taskAssistantId(state, task) {
    	const assistant = taskTypeOf(state, task)?.assistant;
    	return typeof assistant === "string" && assistant.trim() !== "" ? assistant.trim() : null;
    }
    /** 岗位主体（当前作业定义 + 工作流定义合并后）。 */
    function positionExecutorOf(state, positionId) {
    	return positionsOf(mergedDefinition(currentJobDefinition(state), currentDefinition(state))).find((position) => position.id === positionId)?.executor ?? null;
    }
    /**
    * 任务「谁在办」：人任务说代办 / 待你办理 / 你在办理，执行者任务只说执行者。
    *
    * 承办者（谁接走任务）不再展示；人任务的助理来自任务类型定义的点名。
    *
    * @param state 页面状态
    * @param task 任务摘要或详情
    * @returns 展示口径；开始 / 结束任务或无法解析时是 `none`
    */
    function taskActor(state, task) {
    	const position = typeof task.position === "string" ? task.position : "";
    	if (position === "" || position === "start" || position === "end") return { kind: "none" };
    	if (isHumanTask(state, task)) {
    		const assistantId = taskAssistantId(state, task);
    		if (assistantId !== null) return {
    			kind: "assistant",
    			assistantId
    		};
    		if (task.status === "running") return { kind: "handling" };
    		if (task.status === "ready" || task.status === "pending") return { kind: "waiting" };
    		return { kind: "none" };
    	}
    	const executor = positionExecutorOf(state, position);
    	if (executor === null || executor.kind !== "worker") return { kind: "none" };
    	const text = workerIdentityText(executor);
    	if (text === "") return { kind: "none" };
    	const identity = workerIdentity(executor);
    	return {
    		kind: "executor",
    		text,
    		missing: executor.missing === true || identity.id !== "" && isWorkerMissing(state, identity.id)
    	};
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
    			note: position.note,
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
    /**
    * 派生不可用的提示条：列出缺口位置与缺失的标识符。
    *
    * @param page 页面上下文
    * @param availability 可用性；可用或没加载时返回 null
    * @returns 提示条或 null
    */
    function renderAvailabilityNotice(page, availability) {
    	if (availability === null || availability === void 0) return null;
    	if (availability.available !== false) return null;
    	const missing = Array.isArray(availability.missingWorkers) ? availability.missingWorkers : [];
    	const { t } = page;
    	return h("div", {
    		className: "buka-workflows-unavailableNotice",
    		role: "alert"
    	}, h("strong", { className: "buka-workflows-unavailableTitle" }, t("workerUnavailable")), h("p", { className: "buka-workflows-unavailableHint" }, t("workerUnavailableHint")), h("ul", { className: "buka-workflows-unavailableList" }, ...missing.map((entry, index) => h("li", { key: `${entry.role ?? "executor"}-${entry.id}-${index}` }, describeMissingWorker(t, entry)))));
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
    /** 抽屉里的分区页签：内容随页签切换；只有一个分区时不画页签。 */
    function DrawerTabs(props) {
    	const [active, setActive] = react.default.useState(props.tabs[0]?.id ?? "");
    	const current = props.tabs.find((tab) => tab.id === active) ?? props.tabs[0];
    	return h("div", { className: "buka-workflows-drawerTabbed" }, props.tabs.length < 2 ? null : h("div", { className: "buka-workflows-drawerTabBar" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workflows-tabList",
    		label: props.label,
    		value: current?.id ?? "",
    		items: props.tabs.map((tab) => ({
    			value: tab.id,
    			label: h(TabLabel, { text: tab.label }),
    			id: `buka-workflows-drawer-tab-${tab.id}`,
    			panelId: `buka-workflows-drawer-panel-${tab.id}`
    		})),
    		onChange: (value) => setActive(value)
    	})), h("div", { className: "buka-workflows-drawerTabPanel" }, current?.content ?? null));
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
    /** 主体展示：工作人员 / 执行者 + 「展示名 · 标识符」；已删执行者标「已删除」。 */
    function renderExecutor(page, executor) {
    	const { t } = page;
    	if (!isRecord(executor)) return t("taskTypeUnset");
    	if (executor.kind === "human") return t("actorHuman");
    	const kind = executor.kind === "worker" ? t("actorWorker") : t("taskTypeUnset");
    	const label = workerIdentityText(executor);
    	if (label === "") return kind;
    	const ref = typeof executor.id === "string" && executor.id !== "" ? executor.id : typeof executor.name === "string" ? executor.name : "";
    	return executor.missing === true || isWorkerMissing(page.state, ref) ? `${kind} · ${label} · ${t("workerDeleted")}` : `${kind} · ${label}`;
    }
    /** 助理引用展示：展示名 · 标识符；名称未知时只显示标识符，已删标「已删除」。 */
    function renderAssistant(page, id) {
    	const label = workerIdentityText(assistantIdentity(page.state, id));
    	return isWorkerMissing(page.state, id) ? `${label} · ${page.t("workerDeleted")}` : label;
    }
    /**
    * 任务「谁在办」：人任务说「代办：某人」/「待你办理」/「你在办理」，
    * 执行者任务只给执行者。
    */
    function renderTaskActor(page, task) {
    	const { t } = page;
    	const actor = taskActor(page.state, task);
    	switch (actor.kind) {
    		case "assistant": return `${t("taskDelegatedTo")}: ${renderAssistant(page, actor.assistantId)}`;
    		case "waiting": return t("taskWaitingForYou");
    		case "handling": return t("taskYouAreHandling");
    		case "executor": return actor.missing ? `${actor.text} · ${t("workerDeleted")}` : actor.text;
    		default: return "";
    	}
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
    		} else if (preview.kind === "markdown") {
    			const text = typeof preview.text === "string" ? preview.text : "";
    			if (text === "") body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewEmpty")));
    			else {
    				const labels = {
    					code: {
    						copyLabel: t("attachmentMarkdownCodeCopy"),
    						copiedLabel: t("attachmentMarkdownCodeCopied"),
    						toolbarLabels: {
    							codeLabel: t("attachmentMarkdownCodeTitle"),
    							wrapLabel: t("attachmentMarkdownCodeWrap"),
    							unwrapLabel: t("attachmentMarkdownCodeUnwrap")
    						}
    					},
    					footnotes: t("attachmentMarkdownFootnotes")
    				};
    				body.push(h(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
    					text,
    					streaming: false,
    					labels,
    					pathImages: { resolve: (value) => resolveMarkdownImage(jobId, preview.images, value) }
    				}));
    			}
    		} else if (preview.kind === "binary") body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewBinary")));
    		else body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewUnsupported")));
    		if ((preview.kind === "text" || preview.kind === "markdown") && preview.truncated === true) body.push(h("p", { className: "buka-workflows-hint" }, t("attachmentPreviewTruncated")));
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
    /**
    * 把 Markdown 正文里的相对图片目标解析成同作业附件库图片附件的 inline URL。
    * 只按文件名（路径最后一段）精确匹配；未命中返回 `undefined`，渲染器保留原目标。
    *
    * @param jobId 作业 id
    * @param images preview 响应带回的同作业图片附件清单
    * @param destination 正文里原样书写的图片目标
    * @returns inline URL 或 undefined
    */
    function resolveMarkdownImage(jobId, images, destination) {
    	const name = markdownImageName(destination);
    	if (name === void 0 || images === void 0) return void 0;
    	const hit = images.find((image) => image.name === name);
    	if (hit === void 0) return void 0;
    	return absoluteAttachmentUrl(jobId, hit.id);
    }
    /**
    * 从图片目标里取出文件名：去掉查询 / 片段、解码百分号转义、取路径最后一段；
    * 带协议（http 等，Windows 盘符除外）或解码失败时返回 undefined。
    *
    * @param destination 正文里原样书写的图片目标
    * @returns 文件名或 undefined
    */
    function markdownImageName(destination) {
    	const suffix = destination.search(/[?#]/u);
    	const raw = suffix === -1 ? destination : destination.slice(0, suffix);
    	if (raw.length === 0) return void 0;
    	let decoded;
    	try {
    		decoded = decodeURIComponent(raw);
    	} catch {
    		return;
    	}
    	if (/^[a-z][a-z\d+.-]*:/iu.test(decoded) && !/^[a-z]:[/\\]/iu.test(decoded)) return void 0;
    	const segment = decoded.replace(/\\/gu, "/").split("/").pop();
    	return segment === void 0 || segment === "" ? void 0 : segment;
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
    function avatarPreset$1(id) {
    	const preset = findAvatarPreset(id);
    	return preset === void 0 ? null : {
    		emoji: preset.emoji,
    		color: preset.color
    	};
    }
    /**
    * 执行者头像小圆片：emoji 画在预设色的浅底上。[size] 是直径（px），`className`
    * 给胶囊 / 详情标题这类不同位置补间距。
    *
    * @param avatar 头像 id
    * @param size
    * @param [className]
    * @returns React 元素；没有头像时返回 null
    */
    function renderAvatar$1(avatar, size, className = "") {
    	if (avatar === "__missing-worker__") return renderMissingAvatar(size, className);
    	const preset = avatarPreset$1(avatar);
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
    /** 已删执行者的占位头像 id；图节点只带 id，渲染时换成灰色问号。 */
    const MISSING_AVATAR_ID = "__missing-worker__";
    /**
    * 已删执行者的占位头像：灰色圆片 + 问号，与预设头像同样尺寸。
    *
    * @param size 直径（px）
    * @param className 额外类名
    * @returns React 元素
    */
    function renderMissingAvatar(size, className = "") {
    	return h("span", {
    		className: `buka-workflows-avatar buka-workflows-avatarMissing${className === "" ? "" : ` ${className}`}`,
    		style: {
    			width: `${size}px`,
    			height: `${size}px`,
    			fontSize: `${Math.max(8, Math.round(size * .62))}px`
    		},
    		"aria-hidden": true
    	}, "?");
    }
    // .build/workflows/client/components/definition-drawer.js
    /**
    * 结构图的右侧抽屉：全局信息、岗位、开始 / 结束节点与通道。
    *
    * 抽屉只回答一个问题：所选节点 / 通道在定义里是什么。身份放在头部，正文按
    * 页签分区：岗位看可处理的任务类型（卡片），开始 / 结束看契约，通道看发送方、
    * 接收方与允许的任务类型，定义信息看概览、初始任务与契约。
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
    	const avatar = position !== void 0 && typeof position.executor.avatar === "string" ? renderAvatar$1(position.executor.avatar, 28, "buka-workflows-drawerAvatar") : null;
    	const tabs = definitionTabs(page, selection, {
    		definition,
    		workflow,
    		positions,
    		labels,
    		builtin
    	});
    	const backChannel = selection.kind === "channel" && channelOf(definition, selection.id)?.back === true ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("channelBack")) : null;
    	const lead = selection.kind === "position" && position !== void 0 && position.note !== "" ? h(ClampedText, {
    		key: "desc",
    		text: position.note,
    		className: "buka-workflows-drawerText",
    		expandLabel: t("expandText"),
    		collapseLabel: t("collapseText")
    	}) : null;
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
    		...backChannel === null ? {} : { tag: backChannel },
    		meta: headerMeta(page, selection, position, definition),
    		onClose: () => actions.selectDefinition(null),
    		closeLabel: t("close")
    	}), h("div", { className: "buka-workflows-drawerBody" }, lead, h(DrawerTabs, {
    		key: selectionKey(selection),
    		label: t("definitionTabsAria"),
    		tabs
    	})));
    }
    /** 按所选对象给出页签。 */
    function definitionTabs(page, selection, context) {
    	const { t } = page;
    	const { definition, workflow, positions, labels, builtin } = context;
    	if (selection.kind === "info") {
    		const overview = [renderStatStrip([
    			[t("workflowVersionName"), `v${workflow?.version ?? 0}`],
    			[t("definitionPositions"), String(positions.length)],
    			[t("taskTypesTitle"), String(allTaskTypes(definition).length)],
    			[t("budgetMaxTasks"), budgetTasks(page, definition)],
    			[t("budgetMaxDuration"), budgetDuration(page, definition)]
    		])];
    		if (typeof workflow?.description === "string" && workflow.description !== "") overview.push(h(ClampedText, {
    			key: "desc",
    			text: workflow.description,
    			className: "buka-workflows-drawerText",
    			expandLabel: t("expandText"),
    			collapseLabel: t("collapseText")
    		}));
    		return [
    			{
    				id: "overview",
    				label: t("definitionTabOverview"),
    				content: h("div", { className: "buka-workflows-drawerStack" }, ...overview)
    			},
    			{
    				id: "initial",
    				label: t("definitionInitialTasks"),
    				content: initialTasks(page, definition, labels, builtin)
    			},
    			{
    				id: "contract",
    				label: t("definitionTabContract"),
    				content: h("div", { className: "buka-workflows-drawerStack" }, renderFold(t("definitionStartContract"), h("div", { className: "buka-workflows-contractStack" }, contractBlock(page, t("startContentTitle"), t("startPayloadHint"), definition.start?.content))), renderFold(t("definitionEndContract"), contractBlock(page, t("endContentTitle"), t("endPayloadHint"), definition.end?.content)))
    			}
    		];
    	}
    	if (selection.kind === "position") {
    		const position = positions.find((item) => item.id === selection.id);
    		if (position === void 0) return [{
    			id: "missing",
    			label: t("positionTaskTypes"),
    			content: h("p", { className: "buka-workflows-hint" }, t("notFound"))
    		}];
    		return [{
    			id: "types",
    			label: t("positionTaskTypes"),
    			content: h("div", { className: "buka-workflows-drawerStack" }, h("h3", { className: "buka-workflows-sectionTitle" }, t("positionTaskTypes")), position.taskTypes.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("taskTypesEmpty")) : h("div", { className: "buka-workflows-typeList" }, ...position.taskTypes.map((type) => renderTaskType(page, type, definition, labels))))
    		}];
    	}
    	if (selection.kind === "start" || selection.kind === "end") {
    		if (!(selection.kind === "start")) return [{
    			id: "deliverable",
    			label: t("finalDeliverableTitle"),
    			content: h("div", { className: "buka-workflows-contractStack" }, h("p", { className: "buka-workflows-sectionHint" }, t("endPayloadHint")), renderContractFields(page, definition.end?.content))
    		}];
    		return [{
    			id: "input",
    			label: t("startContentTitle"),
    			content: h("div", { className: "buka-workflows-contractStack" }, h("p", { className: "buka-workflows-sectionHint" }, t("startPayloadHint")), renderContractFields(page, definition.start?.content))
    		}];
    	}
    	const channel = channelOf(definition, selection.id);
    	if (channel === null) return [{
    		id: "missing",
    		label: t("channelTitle"),
    		content: h("p", { className: "buka-workflows-hint" }, t("notFound"))
    	}];
    	return [{
    		id: "info",
    		label: t("channelTitle"),
    		content: h("div", { className: "buka-workflows-drawerStack" }, renderKv([[t("channelSender"), channelEndpoint(page, definition, positions, channel.from, builtin)], [t("channelReceiver"), channelEndpoint(page, definition, positions, channel.to, builtin)]]), h("div", { className: "buka-workflows-section" }, h("h3", { className: "buka-workflows-sectionTitle" }, t("channelAllowedTypes")), channel.types.length === 0 ? h("p", { className: "buka-workflows-hint" }, t("channelAllTypes")) : h("div", { className: "buka-workflows-tagRow" }, ...channel.types.map((type) => h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    			key: type,
    			tone: "neutral"
    		}, labels.get(type) ?? type)))))
    	}];
    }
    /** 初始任务列表。 */
    function initialTasks(page, definition, labels, builtin) {
    	const { t } = page;
    	if (!Array.isArray(definition.start?.next) || definition.start.next.length === 0) return h("p", { className: "buka-workflows-hint" }, t("definitionInitialEmpty"));
    	return h("ul", { className: "buka-workflows-initialList" }, ...definition.start.next.map((initial, index) => {
    		const channel = channelOf(definition, initial.channel);
    		return h("li", {
    			key: `${initial.channel ?? ""}-${index}`,
    			className: "buka-workflows-initialRow"
    		}, h("span", { className: "buka-workflows-initialMain" }, h("strong", null, channel === null ? initial.channel ?? "" : positionLabel(definition, channel.to, builtin)), h("span", { className: "buka-workflows-hint" }, [channel === null ? "" : `「${channel.label}」`, labels.get(initial.type ?? "") ?? initial.type ?? ""].filter((part) => part !== "").join(" · "))), h("span", { className: "buka-workflows-hint" }, initial.content === void 0 ? t("initialNoContent") : t("initialContent")));
    	}));
    }
    /** 通道端点：岗位标签 + 主体；内建开始 / 结束节点只有标签。 */
    function channelEndpoint(page, definition, positions, nodeId, builtin) {
    	const label = positionLabel(definition, nodeId, builtin);
    	if (nodeId === "start" || nodeId === "end") return label;
    	const position = positions.find((item) => item.id === nodeId);
    	if (position === void 0) return label;
    	const executor = renderExecutor(page, position.executor);
    	if (executor === page.t("taskTypeUnset")) return label;
    	return h("span", { className: "buka-workflows-inlineGroup" }, h("span", null, label), h("span", { className: "buka-workflows-hint" }, executor));
    }
    /** 头部第二行：主体 / 通道 id 与端点 / 回向标记，没有可说的就留空。 */
    function headerMeta(page, selection, position, definition) {
    	const { t } = page;
    	if (selection.kind === "position") {
    		if (position === void 0) return null;
    		const text = renderExecutor(page, position.executor);
    		return text === t("taskTypeUnset") ? null : text;
    	}
    	if (selection.kind === "channel") {
    		const channel = channelOf(definition, selection.id);
    		return channel === null ? null : channel.id;
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
    /** 页签的 `key`：换一个所选对象就重置到默认页签。 */
    function selectionKey(selection) {
    	return selection.kind === "position" || selection.kind === "channel" ? `${selection.kind}:${selection.id}` : selection.kind;
    }
    /** 一个任务类型：一张卡片，标题 + 说明 + 输入 / 产出两行契约。 */
    function renderTaskType(page, type, definition, labels) {
    	const { t } = page;
    	const id = typeof type.id === "string" ? type.id : "";
    	const actions = Array.isArray(type.actions) ? type.actions : [];
    	const creates = Array.isArray(type.creates) ? type.creates : [];
    	return h("article", {
    		key: id === "" ? type.label ?? "type" : id,
    		className: "buka-workflows-typeCard"
    	}, h("div", { className: "buka-workflows-typeRowHead" }, h("span", { className: "buka-workflows-typeName" }, type.label ?? id), id === "" ? null : h("code", { className: "buka-workflows-inlineCode" }, id), h("span", { className: "buka-workflows-typeTags" }, typeof type.assistant === "string" && type.assistant !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `${t("taskTypeAssistant")} · ${renderAssistant(page, type.assistant)}`) : null, type.mode === "plan" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("taskTypeModePlan")) : null)), typeof type.definition === "string" && type.definition !== "" ? h(ClampedText, {
    		text: type.definition,
    		className: "buka-workflows-typeDesc",
    		expandLabel: t("expandText"),
    		collapseLabel: t("collapseText")
    	}) : null, h("div", { className: "buka-workflows-contractStack is-tight" }, contractLine(t("taskTypeContent"), contractOrDash(page, type.content))), actions.length === 0 ? null : contractLine(t("taskTypeActions"), h("div", { className: "buka-workflows-tagRow" }, ...actions.map((action) => h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    		key: String(action.id ?? action.label),
    		tone: "neutral"
    	}, action.label ?? String(action.id ?? ""))))), creates.length === 0 ? null : contractLine(t("taskTypeCreates"), h("div", { className: "buka-workflows-tagRow" }, ...creates.map((creation, index) => {
    		const typeId = typeof creation.type === "string" ? creation.type : "";
    		const target = typeId === "" || typeId === "end" ? t("endTaskTitle") : labels.get(typeId) ?? typeId;
    		const channel = channelOf(definition, creation.channel ?? "");
    		return h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    			key: `${creation.channel ?? ""}-${typeId}-${index}`,
    			tone: "neutral"
    		}, channel === null ? target : `${target} · ${channel.label}`);
    	}))));
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
    * 作业看板：行 = 发起人（开始 / 结束任务合并）+ 岗位，
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
    	}, t(column.labelKey)))), ...rows.flatMap((row, index) => index === 0 ? [renderBoardRow(page, row)] : [renderBoardDivider(`${row.id}-divider`), renderBoardRow(page, row)]))));
    }
    /** 行与行之间的分割虚线：横跨整行，单独占一个 grid 行。 */
    function renderBoardDivider(key) {
    	return h("div", {
    		key,
    		className: "buka-workflows-boardDivider",
    		"aria-hidden": "true"
    	});
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
    	const actor = renderTaskActor(page, task);
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
    	}, compact && positionLabel !== "" ? h("span", { className: "buka-workflows-taskCardPosition" }, positionLabel) : null, h("span", { className: "buka-workflows-taskCardHead" }, h("span", { className: "buka-workflows-taskCardType" }, task.typeLabel ?? task.type ?? task.id), compact ? renderStatusTag(t, task.status, "task") : null), actor === "" ? null : h("span", { className: "buka-workflows-taskCardMeta" }, actor), summary === "" ? null : h("span", { className: "buka-workflows-taskCardSummary" }, summary), meta.length === 0 ? null : h("span", { className: "buka-workflows-taskCardMeta" }, meta.join(" · "))));
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
    /** 画布上下留白。 */
    const PAD = 24;
    /** 画布左右留白。 */
    const SIDE_PAD = 24;
    /** 回向通道绕行的基础横向偏移。 */
    const BACK_OFFSET = 20;
    /** 多条回向通道之间的横向间隔。 */
    const BACK_STEP = 12;
    /** 同一对节点的多条前向通道之间的横向间隔。 */
    const LANE_STEP = 16;
    /** 并行前向通道的标签沿曲线错开的起点 / 跨度，避免彼此压字。 */
    const PARALLEL_LABEL_START = .26;
    const PARALLEL_LABEL_SPREAD = .48;
    /** 回向通道绕行额外留白（单侧）。 */
    const BACK_EXTRA = 12;
    /** 同一节点侧边多个端口展开的最大高度。 */
    const BACK_PORT_SPAN = 20;
    /** 同一节点侧边相邻端口之间的间距。 */
    const BACK_PORT_STEP = 10;
    /** 前向通道在节点底边 / 顶边相邻端口之间的间距。 */
    const PORT_STEP = 9;
    /** 前向通道端口离节点圆角的最小距离。 */
    const PORT_INSET = 4;
    /** 箭头离节点边缘的距离。 */
    const ARROW_INSET = 5;
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
    	const rowOf = /* @__PURE__ */ new Map();
    	layerKeys.forEach((layer, index) => {
    		rowOf.set(layer, index);
    	});
    	const rowCount = layerKeys.length;
    	const rowWidth = Math.max(1, ...layerKeys.map((layer) => rowWidthOf(byLayer.get(layer) ?? [])));
    	const rowTop = (row) => PAD + row * 76;
    	const rowBottom = (row) => rowTop(row) + NODE_HEIGHT;
    	const width0 = 48 + rowWidth;
    	const height = 48 + rowCount * NODE_HEIGHT + Math.max(0, rowCount - 1) * GAP_Y;
    	const byId = /* @__PURE__ */ new Map();
    	const laidOut = [];
    	layerKeys.forEach((layer, index) => {
    		const group = byLayer.get(layer) ?? [];
    		const groupWidth = rowWidthOf(group);
    		let cursor = (width0 - groupWidth) / 2;
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
    	if (laidOut.length === 0) return {
    		width: width0,
    		height,
    		nodes: laidOut,
    		edges: []
    	};
    	const rows = /* @__PURE__ */ new Map();
    	let nodeLeft = Number.POSITIVE_INFINITY;
    	let nodeRight = Number.NEGATIVE_INFINITY;
    	for (const node of laidOut) {
    		const group = rows.get(node.layer);
    		if (group === void 0) rows.set(node.layer, [node]);
    		else group.push(node);
    		nodeLeft = Math.min(nodeLeft, node.x - node.width / 2);
    		nodeRight = Math.max(nodeRight, node.x + node.width / 2);
    	}
    	const bands = /* @__PURE__ */ new Map();
    	const slotOf = (band, assign) => {
    		const list = bands.get(band);
    		if (list === void 0) bands.set(band, [assign]);
    		else list.push(assign);
    	};
    	const backPlans = planBackEdges(edges, layers, rowOf, rowCount, byId, rows, slotOf);
    	const straddlePlans = planStraddleEdges(edges, layers, rowOf, byId, rows, slotOf);
    	for (const [band, list] of bands) {
    		const top = band < 0 ? 0 : rowBottom(band);
    		const bottom = band >= rowCount - 1 ? height : rowTop(band + 1);
    		const count = list.length;
    		list.forEach((assign, slot) => {
    			assign(top + (slot + 1) * (bottom - top) / (count + 1));
    		});
    	}
    	const ports = assignForwardPorts(edges, layers, byId, straddlePlans);
    	assignSidePorts([...sidePortRequestsOfBack(backPlans), ...sidePortRequestsOfStraddle(straddlePlans)]);
    	for (const plan of backPlans.values()) {
    		if (plan.from.layer === plan.to.layer) continue;
    		const low = plan.sourceSide ? plan.from.y : plan.sourceTrackY;
    		const high = plan.targetSide ? plan.to.y : plan.targetTrackY;
    		plan.yLow = Math.min(low, high);
    		plan.yHigh = Math.max(low, high);
    	}
    	for (const plan of straddlePlans.values()) {
    		const low = plan.sourceSide ? plan.from.y : plan.sourceTrackY;
    		const high = plan.targetSide ? plan.to.y : plan.targetTrackY;
    		plan.yLow = Math.min(low, high);
    		plan.yHigh = Math.max(low, high);
    	}
    	const detours = [...backPlans.values(), ...straddlePlans.values()];
    	assignDetourLanes(detours);
    	const pairCounts = /* @__PURE__ */ new Map();
    	for (const edge of edges) {
    		const pair = `${edge.from}->${edge.to}`;
    		pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    	}
    	const pairSeen = /* @__PURE__ */ new Map();
    	const forwardOffsets = /* @__PURE__ */ new Map();
    	const forwardLabelTs = /* @__PURE__ */ new Map();
    	let curveLeft = nodeLeft;
    	let curveRight = nodeRight;
    	for (const [index, edge] of edges.entries()) {
    		if (isBackEdge(edge, layers) || straddlePlans.has(index)) continue;
    		const from = byId.get(edge.from);
    		const to = byId.get(edge.to);
    		if (from === void 0 || to === void 0) continue;
    		const pair = `${edge.from}->${edge.to}`;
    		const total = pairCounts.get(pair) ?? 1;
    		const seen = pairSeen.get(pair) ?? 0;
    		pairSeen.set(pair, seen + 1);
    		const offset = total <= 1 ? 0 : (seen - (total - 1) / 2) * LANE_STEP;
    		forwardOffsets.set(index, offset);
    		forwardLabelTs.set(index, total <= 1 ? .5 : PARALLEL_LABEL_START + PARALLEL_LABEL_SPREAD * seen / (total - 1));
    		const source = ports.source[index] ?? 0;
    		const target = ports.target[index] ?? 0;
    		curveLeft = Math.min(curveLeft, Math.min(from.x + source, to.x + target) + Math.min(0, offset));
    		curveRight = Math.max(curveRight, Math.max(from.x + source, to.x + target) + Math.max(0, offset));
    	}
    	let maxLaneLeft = -1;
    	let maxLaneRight = -1;
    	for (const plan of detours) if (plan.side === "left") maxLaneLeft = Math.max(maxLaneLeft, plan.lane);
    	else maxLaneRight = Math.max(maxLaneRight, plan.lane);
    	const padLeft = maxLaneLeft < 0 ? 0 : BACK_OFFSET + maxLaneLeft * BACK_STEP + BACK_EXTRA;
    	const padRight = maxLaneRight < 0 ? 0 : BACK_OFFSET + maxLaneRight * BACK_STEP + BACK_EXTRA;
    	const width = width0 + padLeft + padRight;
    	const dx = SIDE_PAD + padLeft - nodeLeft;
    	if (dx !== 0) {
    		for (const node of laidOut) node.x += dx;
    		curveLeft += dx;
    		curveRight += dx;
    	}
    	const laidOutEdges = [];
    	const usedKeys = /* @__PURE__ */ new Map();
    	for (const [index, edge] of edges.entries()) {
    		const from = byId.get(edge.from);
    		const to = byId.get(edge.to);
    		if (from === void 0 || to === void 0) continue;
    		const back = isBackEdge(edge, layers);
    		const backPlan = backPlans.get(index);
    		const straddle = straddlePlans.get(index);
    		const baseKey = `${edge.from}->${edge.to}`;
    		const seen = usedKeys.get(baseKey) ?? 0;
    		usedKeys.set(baseKey, seen + 1);
    		const key = seen === 0 ? baseKey : `${baseKey}#${seen}`;
    		const types = Array.isArray(edge.types) ? edge.types.filter((type) => typeof type === "string") : [];
    		const lanePlan = straddle ?? backPlan;
    		const laneX = lanePlan === void 0 ? 0 : lanePlan.side === "right" ? curveRight + BACK_OFFSET + lanePlan.lane * BACK_STEP : curveLeft - BACK_OFFSET - lanePlan.lane * BACK_STEP;
    		const source = ports.source[index] ?? 0;
    		const target = ports.target[index] ?? 0;
    		const geometry = back && backPlan !== void 0 ? backEdgeGeometry(backPlan, laneX) : straddle !== void 0 ? straddleEdgeGeometry(straddle, laneX, source, target) : forwardEdgeGeometry(from, to, forwardOffsets.get(index) ?? 0, forwardLabelTs.get(index) ?? .5, source, target);
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
    * 给回向通道选边、分端口。全部用节点中心坐标判断，结果与横向平移无关。
    *
    * @param edges
    * @param layers
    * @param rowOf 层号 → 行下标
    * @param rowCount 行数
    * @param byId
    * @param rows
    * @param slotOf 登记层间横向轨道
    * @returns 通道下标 → 走线计划
    */
    function planBackEdges(edges, layers, rowOf, rowCount, byId, rows, slotOf) {
    	const plans = [];
    	for (const [index, edge] of edges.entries()) {
    		if (!isBackEdge(edge, layers)) continue;
    		const from = byId.get(edge.from);
    		const to = byId.get(edge.to);
    		if (from === void 0 || to === void 0) continue;
    		const sameLayer = from.layer === to.layer;
    		const left = blockerCount(from, "left", rows) + (sameLayer ? 0 : blockerCount(to, "left", rows));
    		const right = blockerCount(from, "right", rows) + (sameLayer ? 0 : blockerCount(to, "right", rows));
    		plans.push({
    			index,
    			from,
    			to,
    			side: left < right ? "left" : "right",
    			lane: 0,
    			yLow: Math.min(from.y, to.y),
    			yHigh: Math.max(from.y, to.y),
    			sourceSide: true,
    			targetSide: true,
    			trackBelow: true,
    			trackY: 0,
    			sourceTrackY: 0,
    			targetTrackY: 0,
    			sourceOffset: 0,
    			targetOffset: 0,
    			entryOffset: 0
    		});
    	}
    	for (const plan of plans) {
    		if (plan.from.layer === plan.to.layer) continue;
    		plan.sourceSide = blockerCount(plan.from, plan.side, rows) === 0;
    		plan.targetSide = blockerCount(plan.to, plan.side, rows) === 0;
    		if (!plan.sourceSide) slotOf(rowOf.get(plan.from.layer) ?? 0, (y) => {
    			plan.sourceTrackY = y;
    		});
    		if (!plan.targetSide) slotOf(rowOf.get(plan.to.layer) ?? 0, (y) => {
    			plan.targetTrackY = y;
    		});
    	}
    	for (const plan of plans) {
    		if (plan.from.layer !== plan.to.layer) continue;
    		const row = rowOf.get(plan.from.layer) ?? 0;
    		plan.trackBelow = row < rowCount - 1;
    		slotOf(plan.trackBelow ? row : row - 1, (y) => {
    			plan.trackY = y;
    			plan.yLow = Math.min(plan.from.y, y);
    			plan.yHigh = Math.max(plan.from.y, y);
    		});
    	}
    	assignSameLayerEntries(plans);
    	const byIndex = /* @__PURE__ */ new Map();
    	for (const plan of plans) byIndex.set(plan.index, plan);
    	return byIndex;
    }
    /**
    * 跨层前向通道：跳过中间层的边不能垂直穿过中间层的节点。
    *
    * 优先从源节点侧边出线（该侧没有同排节点遮挡时），沿所有节点外侧的纵向车道
    * 绕过中间层，再从目标侧边进线；侧边被挡住时退回层间空隙的横向轨道。
    * 车道与回向通道共用，按 y 区间复用。
    *
    * @param edges
    * @param layers
    * @param rowOf
    * @param byId
    * @param rows
    * @param slotOf
    * @returns 通道下标 → 走线计划
    */
    function planStraddleEdges(edges, layers, rowOf, byId, rows, slotOf) {
    	const plans = [];
    	for (const [index, edge] of edges.entries()) {
    		if (!isStraddleEdge(edge, layers)) continue;
    		const from = byId.get(edge.from);
    		const to = byId.get(edge.to);
    		if (from === void 0 || to === void 0) continue;
    		let innerLeft = Number.POSITIVE_INFINITY;
    		let innerRight = Number.NEGATIVE_INFINITY;
    		for (const [layer, group] of rows) {
    			if (layer <= from.layer || layer >= to.layer) continue;
    			for (const node of group) {
    				innerLeft = Math.min(innerLeft, node.x - node.width / 2);
    				innerRight = Math.max(innerRight, node.x + node.width / 2);
    			}
    		}
    		const side = Math.abs(from.x - innerLeft) + Math.abs(to.x - innerLeft) < Math.abs(innerRight - from.x) + Math.abs(innerRight - to.x) ? "left" : "right";
    		const plan = {
    			index,
    			from,
    			to,
    			side,
    			lane: 0,
    			yLow: from.y,
    			yHigh: to.y,
    			sourceSide: blockerCount(from, side, rows) === 0,
    			targetSide: blockerCount(to, side, rows) === 0,
    			sourceTrackY: 0,
    			targetTrackY: 0,
    			sourceOffset: 0,
    			targetOffset: 0
    		};
    		const fromRow = rowOf.get(from.layer) ?? 0;
    		const toRow = rowOf.get(to.layer) ?? fromRow + 1;
    		if (!plan.sourceSide) slotOf(fromRow, (y) => {
    			plan.sourceTrackY = y;
    		});
    		if (!plan.targetSide) slotOf(toRow - 1, (y) => {
    			plan.targetTrackY = y;
    		});
    		plans.push(plan);
    	}
    	const byIndex = /* @__PURE__ */ new Map();
    	for (const plan of plans) byIndex.set(plan.index, plan);
    	return byIndex;
    }
    /**
    * 跨层前向通道的走线：侧边出 / 侧边入时直接沿车道上下；被挡住的一侧退回
    * 底边 / 顶边的层间空隙轨道。
    *
    * @param plan
    * @param laneX 车道的 x
    * @param sourcePort 源节点底边的端口偏移（仅底边出线时用）
    * @param targetPort 目标节点顶边的端口偏移（仅顶边入线时用）
    * @returns
    */
    function straddleEdgeGeometry(plan, laneX, sourcePort, targetPort) {
    	const { from, to, side } = plan;
    	const sx = plan.sourceSide ? sidePortX(from, side, plan.sourceOffset) : from.x + sourcePort;
    	const sy = plan.sourceSide ? from.y + plan.sourceOffset : from.y + from.height / 2;
    	const tx = plan.targetSide ? sidePortX(to, side, plan.targetOffset) : to.x + targetPort;
    	const ty = plan.targetSide ? to.y + plan.targetOffset : to.y - to.height / 2;
    	const points = [[sx, sy]];
    	if (!plan.sourceSide) points.push([sx, plan.sourceTrackY]);
    	points.push([laneX, plan.sourceSide ? sy : plan.sourceTrackY]);
    	points.push([laneX, plan.targetSide ? ty : plan.targetTrackY]);
    	if (!plan.targetSide) points.push([tx, plan.targetTrackY]);
    	points.push([tx, ty]);
    	const d = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${fmt(x)} ${fmt(y)}`).join(" ");
    	return {
    		d,
    		hit: d,
    		arrow: plan.targetSide ? {
    			x: tx + (side === "right" ? ARROW_INSET : -5),
    			y: ty,
    			angle: side === "right" ? 180 : 0
    		} : {
    			x: tx,
    			y: ty - ARROW_INSET,
    			angle: 90
    		},
    		labelAt: plan.targetSide ? {
    			x: (tx + laneX) / 2,
    			y: ty - to.height / 2 - 7
    		} : {
    			x: tx + (laneX - tx) * .55,
    			y: plan.targetTrackY
    		}
    	};
    }
    /**
    * 给前向通道分配端口的横向偏移：同一节点上的多条出线 / 入线按对端位置错开，
    * 多条通道不会挤在底边 / 顶边的同一点上。
    *
    * 跨层通道按它绕行的外侧方向排序：从右侧车道绕回来的接最右端口，从左侧绕的
    * 接最左端口，横向折回时不会横穿同节点的其它入线。
    *
    * @param edges
    * @param layers
    * @param byId
    * @param straddlePlans 跨层通道的走线计划
    * @returns 每条通道在源节点与目标节点上的横向偏移
    */
    function assignForwardPorts(edges, layers, byId, straddlePlans) {
    	const source = new Array(edges.length).fill(0);
    	const target = new Array(edges.length).fill(0);
    	const outs = /* @__PURE__ */ new Map();
    	const ins = /* @__PURE__ */ new Map();
    	for (const [index, edge] of edges.entries()) {
    		if (isBackEdge(edge, layers)) continue;
    		const plan = straddlePlans.get(index);
    		if (plan?.sourceSide !== true) {
    			const outList = outs.get(edge.from);
    			if (outList === void 0) outs.set(edge.from, [index]);
    			else outList.push(index);
    		}
    		if (plan?.targetSide !== true) {
    			const inList = ins.get(edge.to);
    			if (inList === void 0) ins.set(edge.to, [index]);
    			else inList.push(index);
    		}
    	}
    	const xOf = (id) => id === void 0 ? 0 : byId.get(id)?.x ?? 0;
    	const PORT_FAR = 1e6;
    	const detourKey = (index) => {
    		const plan = straddlePlans.get(index);
    		if (plan === void 0) return null;
    		return plan.side === "right" ? PORT_FAR : -1e6;
    	};
    	const outKey = (index) => detourKey(index) ?? xOf(edges[index]?.to);
    	const inKey = (index) => detourKey(index) ?? xOf(edges[index]?.from);
    	for (const [nodeId, list] of outs) {
    		const node = byId.get(nodeId);
    		if (node === void 0) continue;
    		const sorted = [...list].sort((left, right) => outKey(left) - outKey(right) || left - right);
    		const offsets = portOffsets(sorted.length, node);
    		sorted.forEach((index, slot) => {
    			source[index] = offsets[slot] ?? 0;
    		});
    	}
    	for (const [nodeId, list] of ins) {
    		const node = byId.get(nodeId);
    		if (node === void 0) continue;
    		const sorted = [...list].sort((left, right) => inKey(left) - inKey(right) || left - right);
    		const offsets = portOffsets(sorted.length, node);
    		sorted.forEach((index, slot) => {
    			target[index] = offsets[slot] ?? 0;
    		});
    	}
    	return {
    		source,
    		target
    	};
    }
    /**
    * 同一节点上 N 条前向通道的端口偏移：沿胶囊的直边均匀铺开，左右顺序与对端一致。
    *
    * @param count 通道数
    * @param node 节点
    * @returns 从最左到最右的偏移
    */
    function portOffsets(count, node) {
    	if (count <= 1) return [0];
    	const limit = Math.max(0, (node.width - node.height) / 2 - PORT_INSET);
    	const span = Math.min(limit * 2, (count - 1) * PORT_STEP);
    	const step = span / (count - 1);
    	return Array.from({ length: count }, (_, slot) => -span / 2 + slot * step);
    }
    /**
    * 是不是跨层前向通道：显式回向不算，目标比源低两层及以上才算。
    *
    * @param edge
    * @param layers
    * @returns
    */
    function isStraddleEdge(edge, layers) {
    	if (edge.back === true) return false;
    	return (layers.get(edge.to) ?? 0) - (layers.get(edge.from) ?? 0) >= 2;
    }
    /**
    * 节点同一行里，朝某一侧出线会穿过几个兄弟节点；越少越好。
    *
    * @param node
    * @param side
    * @param rows
    * @returns
    */
    function blockerCount(node, side, rows) {
    	const row = rows.get(node.layer) ?? [];
    	let count = 0;
    	for (const other of row) {
    		if (other.id === node.id) continue;
    		if (side === "right" ? other.x > node.x : other.x < node.x) count += 1;
    	}
    	return count;
    }
    /**
    * 按纵向区间分配车道：短绕行先占内圈，长绕行套在外圈；区间不重叠的绕行复用同一条。
    *
    * @param plans 回向通道与跨层前向通道
    */
    function assignDetourLanes(plans) {
    	for (const side of ["left", "right"]) {
    		const list = plans.filter((plan) => plan.side === side);
    		list.sort((left, right) => left.yHigh - left.yLow - (right.yHigh - right.yLow) || left.yLow - right.yLow || left.index - right.index);
    		const lanes = [];
    		for (const plan of list) {
    			let lane = 0;
    			while (lane < lanes.length) {
    				if ((lanes[lane] ?? []).every((interval) => plan.yHigh < interval.low || plan.yLow > interval.high)) break;
    				lane += 1;
    			}
    			if (lane === lanes.length) lanes.push([]);
    			const used = lanes[lane];
    			if (used !== void 0) used.push({
    				low: plan.yLow,
    				high: plan.yHigh
    			});
    			plan.lane = lane;
    		}
    	}
    }
    /**
    * 同一节点的同侧端口沿侧边上下错开；顺序按另一端的位置排，避免两条线在节点口重叠。
    *
    * @param requests 回向通道与跨层通道的侧边端口
    */
    function assignSidePorts(requests) {
    	const groups = /* @__PURE__ */ new Map();
    	for (const request of requests) {
    		const key = `${request.node.id}\u0000${request.side}`;
    		const group = groups.get(key);
    		if (group === void 0) groups.set(key, [request]);
    		else group.push(request);
    	}
    	for (const group of groups.values()) {
    		group.sort((left, right) => left.otherY - right.otherY || left.index - right.index || (left.role === right.role ? 0 : left.role === "source" ? -1 : 1));
    		const count = group.length;
    		const span = count <= 1 ? 0 : Math.min(BACK_PORT_SPAN, (count - 1) * BACK_PORT_STEP);
    		group.forEach((request, slot) => {
    			const offset = count <= 1 ? 0 : span / 2 - span * slot / (count - 1);
    			request.set(offset);
    		});
    	}
    }
    /**
    * 回向通道在节点侧边的端口请求。
    *
    * @param plans
    * @returns
    */
    function sidePortRequestsOfBack(plans) {
    	const requests = [];
    	for (const plan of plans.values()) {
    		if (plan.sourceSide) requests.push({
    			side: plan.side,
    			node: plan.from,
    			role: "source",
    			otherY: plan.to.y,
    			index: plan.index,
    			set: (offset) => {
    				plan.sourceOffset = offset;
    			}
    		});
    		if (plan.from.layer !== plan.to.layer && plan.targetSide) requests.push({
    			side: plan.side,
    			node: plan.to,
    			role: "target",
    			otherY: plan.from.y,
    			index: plan.index,
    			set: (offset) => {
    				plan.targetOffset = offset;
    			}
    		});
    	}
    	return requests;
    }
    /**
    * 跨层通道在节点侧边的端口请求：只有从侧边出 / 入的那一端才占侧边端口。
    *
    * @param plans
    * @returns
    */
    function sidePortRequestsOfStraddle(plans) {
    	const requests = [];
    	for (const plan of plans.values()) {
    		if (plan.sourceSide) requests.push({
    			side: plan.side,
    			node: plan.from,
    			role: "source",
    			otherY: plan.to.y,
    			index: plan.index,
    			set: (offset) => {
    				plan.sourceOffset = offset;
    			}
    		});
    		if (plan.targetSide) requests.push({
    			side: plan.side,
    			node: plan.to,
    			role: "target",
    			otherY: plan.from.y,
    			index: plan.index,
    			set: (offset) => {
    				plan.targetOffset = offset;
    			}
    		});
    	}
    	return requests;
    }
    /**
    * 同层回绕从目标的底边 / 顶边进入：入口偏离中点，避免和中间的向前箭头叠在一起；
    * 同一个目标的多条回连分在两侧。
    *
    * @param plans
    */
    function assignSameLayerEntries(plans) {
    	const counts = /* @__PURE__ */ new Map();
    	for (const plan of plans) {
    		if (plan.from.layer !== plan.to.layer) continue;
    		const count = counts.get(plan.to.id) ?? 0;
    		counts.set(plan.to.id, count + 1);
    		const reach = Math.min(16, plan.to.width / 4);
    		plan.entryOffset = (plan.side === "right" ? 1 : -1) * (count % 2 === 0 ? reach : -reach);
    	}
    }
    /**
    * 回向通道：从侧边出线，沿节点外侧的车道折回目标侧边。全程只有水平/垂直线段。
    *
    * @param plan
    * @param laneX 车道的 x
    * @returns
    */
    function backEdgeGeometry(plan, laneX) {
    	const { from, to, side } = plan;
    	const sx = plan.sourceSide ? sidePortX(from, side, plan.sourceOffset) : from.x;
    	const sy = plan.sourceSide ? from.y + plan.sourceOffset : from.y + from.height / 2;
    	if (from.layer === to.layer) return sameLayerBackGeometry(plan, laneX, sx, sy);
    	const tx = plan.targetSide ? sidePortX(to, side, plan.targetOffset) : to.x;
    	const ty = plan.targetSide ? to.y + plan.targetOffset : to.y + to.height / 2;
    	const points = [[sx, sy]];
    	if (!plan.sourceSide) points.push([sx, plan.sourceTrackY]);
    	points.push([laneX, plan.sourceSide ? sy : plan.sourceTrackY]);
    	points.push([laneX, plan.targetSide ? ty : plan.targetTrackY]);
    	if (!plan.targetSide) points.push([tx, plan.targetTrackY]);
    	points.push([tx, ty]);
    	const d = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${fmt(x)} ${fmt(y)}`).join(" ");
    	return {
    		d,
    		hit: d,
    		arrow: plan.targetSide ? {
    			x: tx + (side === "right" ? ARROW_INSET : -5),
    			y: ty,
    			angle: side === "right" ? 180 : 0
    		} : {
    			x: tx,
    			y: ty + ARROW_INSET,
    			angle: -90
    		},
    		labelAt: {
    			x: laneX,
    			y: (sy + ty) / 2
    		}
    	};
    }
    /**
    * 同层回向通道：从侧边绕到下一行（没有下一行时绕到上一行）的轨道，再从目标底边 / 顶边进入。
    *
    * @param plan
    * @param laneX
    * @param sx 出线点 x
    * @param sy 出线点 y
    * @returns
    */
    function sameLayerBackGeometry(plan, laneX, sx, sy) {
    	const { to } = plan;
    	const tx = to.x + plan.entryOffset;
    	const radius = to.height / 2;
    	const straight = to.width / 2 - radius;
    	const cap = Math.max(0, Math.abs(plan.entryOffset) - straight);
    	const reach = Math.sqrt(Math.max(0, radius * radius - cap * cap));
    	const edgeY = plan.trackBelow ? to.y + reach : to.y - reach;
    	const d = `M ${fmt(sx)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(sy)} L ${fmt(laneX)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(plan.trackY)} L ${fmt(tx)} ${fmt(edgeY)}`;
    	return {
    		d,
    		hit: d,
    		arrow: {
    			x: tx,
    			y: plan.trackBelow ? edgeY + ARROW_INSET : edgeY - ARROW_INSET,
    			angle: plan.trackBelow ? -90 : 90
    		},
    		labelAt: {
    			x: (laneX + tx) / 2,
    			y: plan.trackY
    		}
    	};
    }
    /**
    * 节点侧边的出线点：纵向偏移后落在胶囊形的圆弧上。
    *
    * @param node
    * @param side
    * @param offset 相对节点中心的纵向偏移
    * @returns
    */
    function sidePortX(node, side, offset) {
    	const radius = node.height / 2;
    	const reach = Math.sqrt(Math.max(0, radius * radius - offset * offset));
    	const distance = node.width / 2 - radius + reach;
    	return node.x + (side === "right" ? distance : -distance);
    }
    /**
    * 向下的通道：从源节点底边连到目标节点顶边；同一对节点的多条通道用 `offset`
    * 错开曲线车道，标签在曲线上用 `labelT` 错开高度。
    *
    * @param from
    * @param to
    * @param offset 横向车道偏移
    * @param labelT 标签在曲线上的位置（0 起点，1 终点）
    * @param sourcePort 源节点底边的端口偏移
    * @param targetPort 目标节点顶边的端口偏移
    * @returns
    */
    function forwardEdgeGeometry(from, to, offset = 0, labelT = .5, sourcePort = 0, targetPort = 0) {
    	const x1 = from.x + sourcePort;
    	const y1 = from.y + from.height / 2;
    	const x2 = to.x + targetPort;
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
    		labelAt: cubicPoint(p0, p1, p2, p3, labelT)
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
    * 结构图与实时流程共用同一套布局和卡片；区别只在节点 / 边的数据与
    * 点击后的动作。
    */
    /** 流程图组件：负责测量容器宽度做等比缩放。 */
    function GraphView(props) {
    	const { page, ...options } = props;
    	const { t } = page;
    	const layout = react.default.useMemo(() => layoutGraph(options.nodes, options.edges), [options.nodes, options.edges]);
    	const mode = options.mode ?? "definition";
    	const showLegend = options.showLegend ?? true;
    	const caption = options.caption ?? null;
    	const fit = options.fit ?? true;
    	const selectedNodeId = options.selectedNodeId ?? null;
    	const selectedChannelId = options.selectedChannelId ?? null;
    	const ref = react.default.useRef(null);
    	const svgRef = react.default.useRef(null);
    	const [scale, setScale] = react.default.useState(1);
    	const [hoveredTip, setHoveredTip] = react.default.useState(null);
    	const hoveredEdge = layout.edges.find((edge) => edge.key === hoveredTip?.key) ?? null;
    	const orderedEdges = hoveredEdge === null ? layout.edges : [...layout.edges.filter((edge) => edge.key !== hoveredEdge.key), hoveredEdge];
    	const edgeTip = hoveredEdge === null || hoveredTip === null || hoveredEdge.label === "" ? null : {
    		edge: hoveredEdge,
    		placement: edgeTipPlacement(hoveredTip, hoveredEdge.label)
    	};
    	/** 鼠标进入通道时，把气泡锚在指针旁边。 */
    	const showEdgeTip = (edge, x, y) => {
    		setHoveredTip({
    			key: edge.key,
    			x,
    			y
    		});
    	};
    	/** 鼠标沿通道移动时更新锚点；位移小于 2px 不重绘。 */
    	const moveEdgeTip = (edge, x, y) => {
    		setHoveredTip((current) => {
    			if (current === null || current.key !== edge.key) return {
    				key: edge.key,
    				x,
    				y
    			};
    			return Math.abs(current.x - x) < 2 && Math.abs(current.y - y) < 2 ? current : {
    				key: edge.key,
    				x,
    				y
    			};
    		});
    	};
    	/** 键盘聚焦时没有指针坐标，改用连线标签位置作为锚点。 */
    	const focusEdgeTip = (edge) => {
    		const box = svgRef.current?.getBoundingClientRect();
    		const at = edge.labelAt;
    		if (box === void 0 || at === null) return;
    		showEdgeTip(edge, box.left + at.x * scale, box.top + at.y * scale);
    	};
    	const hideEdgeTip = (edge) => {
    		setHoveredTip((current) => current !== null && current.key === edge.key ? null : current);
    	};
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
    		className: "buka-workflows-graphViewport",
    		onScroll: () => setHoveredTip(null)
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
    		ref: svgRef,
    		className: "buka-workflows-graphSvg",
    		width: layout.width,
    		height: layout.height,
    		viewBox: `0 0 ${layout.width} ${layout.height}`
    	}, ...orderedEdges.map((edge) => {
    		const selected = selectedChannelId !== null && edge.id === selectedChannelId;
    		const hovered = hoveredEdge !== null && hoveredEdge.key === edge.key;
    		const dimmed = hoveredEdge !== null && !hovered && !selected;
    		return h("g", {
    			key: edge.key,
    			className: `buka-workflows-edgeGroup is-${edge.kind}${edge.state === "taken" ? " is-taken" : ""}${selected ? " is-selected" : ""}${hovered ? " is-hovered" : ""}${dimmed ? " is-dimmed" : ""}`
    		}, h("path", {
    			key: `${edge.key}-path`,
    			className: `buka-workflows-edge is-${edge.kind}${edge.state === "taken" ? " is-taken" : ""}`,
    			d: edge.d
    		}), h("path", {
    			key: `${edge.key}-hit`,
    			className: "buka-workflows-hitPath",
    			d: edge.hit,
    			onMouseEnter: (event) => showEdgeTip(edge, event.clientX, event.clientY),
    			onMouseMove: (event) => moveEdgeTip(edge, event.clientX, event.clientY),
    			onMouseLeave: () => hideEdgeTip(edge),
    			onFocus: () => focusEdgeTip(edge),
    			onBlur: () => hideEdgeTip(edge),
    			"aria-label": edge.label === "" ? edge.id : edge.label,
    			...options.onEdgeClick === null || options.onEdgeClick === void 0 ? {} : {
    				onClick: () => options.onEdgeClick(edge),
    				role: "button",
    				tabIndex: 0
    			}
    		}), edge.labelAt === null || edge.label === "" || !selected && edge.kind !== "forward" ? null : h("text", {
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
    		const attention = mode === "live" && node.awaitingUser === true ? h("span", {
    			key: "attention",
    			className: "buka-workflows-nodeAttention",
    			"aria-hidden": true
    		}) : null;
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
    		}, renderAvatar$1(node.avatar, 16, "buka-workflows-nodeAvatar"), h("span", { className: "buka-workflows-nodeLabel" }, node.label), corner, attention) : h("span", { className: `buka-workflows-node ${tag}${stateName}` }, renderAvatar$1(node.avatar, 16, "buka-workflows-nodeAvatar"), h("span", { className: "buka-workflows-nodeLabel" }, node.label), corner, attention));
    	})))), edgeTip === null ? null : h("span", {
    		key: "edge-tip",
    		className: `buka-workflows-edgeTip is-${edgeTip.edge.kind}${edgeTip.placement.flipped ? " is-flipped" : ""}`,
    		style: edgeTip.placement.style
    	}, edgeTip.edge.label), caption === null && !showLegend ? null : h("div", { className: "buka-workflows-graphFooter" }, caption === null ? null : h("p", { className: "buka-workflows-hint buka-workflows-graphHint" }, caption), showLegend ? renderGraphLegend(page, mode) : null));
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
    /** 连线上的标签：主流程线常显，回向通道选中时也显示；过长时截断。 */
    const LABEL_MAX = 14;
    /** 截断后的画布标签。 */
    function clipLabel(label, max = LABEL_MAX) {
    	const chars = [...label];
    	return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
    }
    /** 气泡与鼠标之间的间距。 */
    const TIP_GAP = 14;
    /** 气泡离视口边缘的安全距离。 */
    const TIP_MARGIN = 8;
    /** 气泡的半高，用于上下夹取。 */
    const TIP_HALF_HEIGHT = 12;
    /** 气泡最大宽度。 */
    const TIP_MAX_WIDTH = 280;
    /**
    * 气泡的定位：默认在鼠标右下方展开，右边放不下时翻到左边，
    * 垂直方向夹在视口内。气泡是独立图层，不压在连线上。
    *
    * @param anchor 鼠标 / 聚焦位置（视口坐标）
    * @param label 通道名
    * @returns 定位结果
    */
    function edgeTipPlacement(anchor, label) {
    	const { width, height } = viewportSize();
    	const flipped = width > 0 && anchor.x + TIP_GAP + tipWidthOf(label) + TIP_MARGIN > width;
    	const top = height > 0 ? Math.min(Math.max(anchor.y, 20), height - TIP_MARGIN - TIP_HALF_HEIGHT) : anchor.y;
    	return {
    		flipped,
    		style: {
    			left: `${round(flipped ? anchor.x - TIP_GAP : anchor.x + TIP_GAP)}px`,
    			top: `${round(top)}px`,
    			transform: flipped ? "translate(-100%,-50%)" : "translateY(-50%)"
    		}
    	};
    }
    /** 估算气泡宽度：中文按字号算，拉丁字母按半宽算。 */
    function tipWidthOf(label) {
    	let width = 0;
    	for (const char of label) width += (char.codePointAt(0) ?? 0) >= 11904 ? 11 : 6.5;
    	return Math.min(TIP_MAX_WIDTH, width + 20);
    }
    /** 视口尺寸；测试环境没有窗口时返回 0，退化成不翻转。 */
    function viewportSize() {
    	if (typeof window === "undefined") return {
    		width: 0,
    		height: 0
    	};
    	return {
    		width: window.innerWidth,
    		height: window.innerHeight
    	};
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
    	/**
    	* 这个任务的会话是否在等用户：有未处理的交互（审批 / plan 审阅 / 提问），
    	* 或回合已结束、会话空闲。只认运行中的任务与真实存在的会话。
    	*/
    	const awaitsUser = (task) => {
    		if (task.status !== "running") return false;
    		const sessionId = task.claimant?.sessionId;
    		if (typeof sessionId !== "string" || sessionId === "") return false;
    		const status = page.sessionStatus.get(sessionId);
    		if (status === void 0) return false;
    		return status.pendingInteraction !== void 0 && status.pendingInteraction !== null || status.running === false;
    	};
    	/** 岗位下任一任务在等用户，就给节点亮小红点。 */
    	const attentionOf = (list) => list.some(awaitsUser);
    	const metaOf = (list) => {
    		const progress = taskProgress(list);
    		return progress.total === 0 ? "" : `${progress.done}/${progress.total}`;
    	};
    	/** 悬浮说明：角标只给数量，具体状态在 title 里展开。 */
    	const titleOf = (label, list) => {
    		const progress = taskProgress(list);
    		if (progress.total === 0) return attentionOf(list) ? `${label} · ${t("flowWaitingUser")}` : label;
    		const parts = [`${progress.done}/${progress.total} ${t("statusCompleted")}`];
    		if (progress.ready > 0) parts.push(`${progress.ready} ${t("statusReady")}`);
    		if (progress.running > 0) parts.push(`${progress.running} ${t("statusRunning")}`);
    		if (progress.failed > 0) parts.push(`${progress.failed} ${t("statusFailed")}`);
    		if (progress.pending > 0) parts.push(`${progress.pending} ${t("statusPending")}`);
    		const title = `${label} · ${parts.join(" · ")}`;
    		return attentionOf(list) ? `${title} · ${t("flowWaitingUser")}` : title;
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
    				title: titleOf(t("boardStart"), tasksOf("start")),
    				awaitingUser: attentionOf(tasksOf("start"))
    			},
    			...positions.map((position) => {
    				const list = tasksOf(position.id);
    				return {
    					id: position.id,
    					label: position.label,
    					kind: "position",
    					executor: position.executor,
    					...position.executor.missing === true ? { avatar: MISSING_AVATAR_ID } : typeof position.executor.avatar === "string" && position.executor.avatar !== "" ? { avatar: position.executor.avatar } : {},
    					status: aggregateOf(list),
    					meta: metaOf(list),
    					title: titleOf(position.label, list),
    					awaitingUser: attentionOf(list)
    				};
    			}),
    			{
    				id: "end",
    				label: t("boardEnd"),
    				kind: "end",
    				status: aggregateOf(tasksOf("end")),
    				meta: metaOf(tasksOf("end")),
    				title: titleOf(t("boardEnd"), tasksOf("end")),
    				awaitingUser: attentionOf(tasksOf("end"))
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
    	const input = job.input ?? {};
    	const starter = isRecord(job.starter) ? job.starter : null;
    	const endTask = endTaskSummary(tasks);
    	const finalTask = state.finalTask;
    	const endSchema = isRecord(definition?.end?.content) ? definition?.end?.content : null;
    	const startSchema = isRecord(definition?.start?.content) ? definition?.start?.content : null;
    	const restartedFrom = typeof job.restartedFrom === "string" && job.restartedFrom !== "" ? job.restartedFrom : null;
    	const sourceJob = jobSummary(state.workflow.data, restartedFrom);
    	const restartCount = typeof job.restartCount === "number" ? job.restartCount : 0;
    	const workflowId = typeof job.workflowId === "string" && job.workflowId !== "" ? job.workflowId : state.route.kind === "job" ? state.route.workflowId : "";
    	const starterRows = [
    		[t("overviewWorkflow"), `${job.workflowName ?? job.workflowId ?? ""}${typeof job.workflowVersion === "number" ? ` · v${job.workflowVersion}` : ""}`],
    		[t("starter"), starter === null ? t("taskTypeUnset") : starter.kind === "session" ? t("starterSession") : t("starterHuman")],
    		[t("overviewDelivery"), job.delivery?.kind === "assistant" ? `${t("newJobDeliveryAssistant")} · ${workerIdentityText(deliveryIdentity(job.delivery))}${job.delivery.missing === true || isWorkerMissing(state, workerIdentity(deliveryIdentity(job.delivery)).id) ? ` · ${t("workerDeleted")}` : ""}` : t("newJobDeliveryStarter")],
    		[t("jobCreatedAt"), formatTime(job.createdAt)],
    		[t("jobUpdatedAt"), formatTime(job.updatedAt)]
    	];
    	if (restartCount > 0) starterRows.push([t("restartCount"), String(restartCount)]);
    	if (restartedFrom !== null) starterRows.push([t("restartSource"), typeof sourceJob?.seq === "number" ? fill(t, "restartSourceJob", { seq: sourceJob.seq }) : restartedFrom]);
    	return h("div", { className: "buka-workflows-overview" }, renderSection(t("overviewRequirement"), h("div", { className: "buka-workflows-overviewCard" }, renderReadonlyValue(page, isRecord(startSchema) ? startSchema : null, input, t("overviewRequirementEmpty")))), renderSection(t("overviewFinal"), renderFinalDeliverable$1(page, finalTask.data, finalTask.status, endTask?.id ?? null, endSchema), endTask === null ? h("span", { className: "buka-workflows-hint" }, t("overviewFinalEmpty")) : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.openTask(endTask.id)
    	}, t("overviewOpenFinalTask"))), renderSection(t("overviewStarter"), h("div", { className: "buka-workflows-overviewCard" }, renderKv(starterRows), restartedFrom !== null && workflowId !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.openJob(workflowId, restartedFrom)
    	}, t("restartSourceOpen")) : null, starter !== null && starter.kind === "session" && typeof starter.sessionId === "string" && starter.sessionId !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
    	return h("div", { className: "buka-workflows-overviewCard buka-workflows-finalCard" }, h("div", { className: "buka-workflows-finalHead" }, renderStatusTag(t, task.status, "task"), typeof task.positionLabel === "string" && task.positionLabel !== "" ? h("span", { className: "buka-workflows-hint" }, task.positionLabel) : null), renderReadonlyValue(page, payloadSchema, task.content ?? null, t("overviewFinalPending")), text === "" ? null : h("pre", { className: "buka-workflows-pre" }, text), attachments.length === 0 ? null : h("ul", { className: "buka-workflows-attachmentList" }, ...attachments.map((attachment) => {
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
    	const job = loaded.data.job;
    	if (job === void 0) return renderEmpty(t("notFound"));
    	const view = state.route.kind === "job" ? state.route.view : "overview";
    	const body = view === "flow" ? renderJobFlow(page) : view === "board" ? renderBoard(page) : view === "outputs" ? renderJobOutputs(page) : renderJobOverview(page);
    	return h("div", { className: "buka-workflows-detail" }, job.status === "failed" ? h("div", {
    		className: "buka-workflows-notice",
    		role: "status"
    	}, h("p", { className: "buka-workflows-noticeText" }, t("restartEntryHint")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: actions.openRestart
    	}, t("restartJob"))) : null, page.state.job.data?.canRetryDelivery === true ? h("div", {
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
    * 新建作业对话框：填发起人的任务内容，并选择结束任务怎么交回。
    *
    * 任务内容按开始节点的 `content` schema 校验；交回方式只有两档——交回发起人，
    * 或交给一个助理代收。
    */
    /** 新建作业对话框。 */
    function renderNewJobDialog(page) {
    	const { t, state, actions } = page;
    	const dialog = state.newJob;
    	const definition = currentDefinition(state);
    	const contentSchema = isRecord(definition?.start?.content) ? definition.start.content : null;
    	const hasFields = schemaFields(contentSchema).length > 0;
    	const assistants = asArray(state.workflow.data?.assistants).filter((assistant) => typeof assistant.id === "string" && assistant.id !== "" || typeof assistant.name === "string" && assistant.name !== "");
    	const contentSection = h("section", {
    		key: "content",
    		className: "buka-workflows-dialogSection"
    	}, h("h3", { className: "buka-workflows-dialogSectionTitle" }, t("newJobContentTitle")), h("p", { className: "buka-workflows-fieldHint" }, t("newJobContentHint")), ...hasFields ? renderSchemaFields(page, {
    		schema: contentSchema,
    		values: dialog.content,
    		onChange: actions.setNewJobContent,
    		idPrefix: "buka-workflows-newjob-content"
    	}) : [renderJsonFallback(page, dialog.content.__json ?? "", (next) => actions.setNewJobContent("__json", next), "buka-workflows-newjob-content-json")]);
    	const deliverySection = h("section", {
    		key: "delivery",
    		className: "buka-workflows-dialogSection"
    	}, h("h3", { className: "buka-workflows-dialogSectionTitle" }, t("newJobDeliveryTitle")), h("p", { className: "buka-workflows-fieldHint" }, t("newJobDeliveryHint")), h("div", { className: "buka-workflows-field" }, h("select", {
    		className: "buka-workflows-select",
    		value: dialog.delivery,
    		onChange: (event) => actions.setNewJobDelivery(event.target.value)
    	}, h("option", { value: "starter" }, t("newJobDeliveryStarter")), ...assistants.map((assistant) => {
    		const identity = workerIdentity(assistant);
    		return h("option", {
    			key: identity.id,
    			value: `assistant:${identity.id}`
    		}, `${t("newJobDeliveryAssistant")} · ${workerIdentityText(assistant)}`);
    	}))));
    	const body = [
    		h("p", {
    			key: "hint",
    			className: "buka-workflows-hint"
    		}, t("newJobHint")),
    		contentSection,
    		deliverySection,
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
    	const avatar = position?.executor.missing === true ? renderAvatar$1(MISSING_AVATAR_ID, 28, "buka-workflows-drawerAvatar") : position !== void 0 && typeof position.executor.avatar === "string" ? renderAvatar$1(position.executor.avatar, 28, "buka-workflows-drawerAvatar") : null;
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
    	const actor = renderTaskActor(page, task);
    	const waiting = task.status === "ready" || task.status === "pending" ? formatWaiting(task.createdAt) : "";
    	return h("li", { key: task.id }, h("button", {
    		type: "button",
    		className: `buka-workflows-taskCard is-${task.status ?? "pending"}`,
    		onClick: () => actions.openTask(task.id)
    	}, h("span", { className: "buka-workflows-taskCardHead" }, h("span", { className: "buka-workflows-taskCardType" }, task.typeLabel ?? task.type ?? task.id), renderStatusTag(t, task.status, "task")), typeof task.resultSummary === "string" && task.resultSummary !== "" ? h("span", { className: "buka-workflows-taskCardSummary" }, task.resultSummary) : null, actor === "" && waiting === "" ? null : h("span", { className: "buka-workflows-taskCardMeta" }, [actor, waiting === "" ? "" : fill(t, "boardCardWaiting", { duration: waiting })].filter((part) => part !== "").join(" · "))));
    }
    // .build/workflows/client/components/restart-dialog.js
    /**
    * 重启失败作业对话框：两个选项——从失败位置开始 / 从头开始。
    *
    * 可用性与不可用原因由服务端 `restart` 投影给出，客户端只按它置灰与显示原因，
    * 不自己判断作业状态或工作流能否启动。
    */
    /** 服务端原因代码 → 词典 key。 */
    const REASON_KEYS = {
    	"job-not-failed": "restartReasonJobNotFailed",
    	"no-failed-tasks": "restartReasonNoFailedTasks",
    	"workflow-not-found": "restartReasonWorkflowNotFound",
    	"workflow-retired": "restartReasonWorkflowRetired",
    	"definition-outdated": "restartReasonDefinitionOutdated"
    };
    /** 渲染一个不可用原因；未知代码退回通用文案。 */
    function reasonText(page, option) {
    	const reason = typeof option?.reason === "string" ? option.reason : "";
    	return page.t(REASON_KEYS[reason] ?? "restartReasonUnknown");
    }
    /** 一个重启选项。 */
    function renderOption(input) {
    	const { page, option } = input;
    	const { t, state, actions } = page;
    	const available = option?.available === true;
    	const submitting = state.restart.submitting === input.mode;
    	const busy = state.restart.submitting !== false;
    	return h("section", {
    		key: input.mode,
    		className: "buka-workflows-dialogSection"
    	}, h("h3", { className: "buka-workflows-dialogSectionTitle" }, input.title), h("p", { className: "buka-workflows-fieldHint" }, input.hint), input.extra ?? null, available ? null : h("p", { className: "buka-workflows-hint" }, `${t("restartUnavailable")} · ${reasonText(page, option)}`), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		disabled: !available || busy,
    		onClick: () => void actions.restartJob(input.mode)
    	}, submitting ? t("restartSubmitting") : input.title));
    }
    /** 重启失败作业对话框。 */
    function renderRestartDialog(page) {
    	const { t, state, actions } = page;
    	const dialog = state.restart;
    	const restart = state.job.data?.restart;
    	const failedTasks = jobTasks(state).filter((task) => task.status === "failed");
    	const failedTaskList = failedTasks.length === 0 ? null : h("div", { className: "buka-workflows-restartTasks" }, h("p", { className: "buka-workflows-hint" }, t("restartFromFailedTasks")), h("ul", { className: "buka-workflows-restartTaskList" }, ...failedTasks.map((task) => h("li", {
    		key: task.id,
    		className: "buka-workflows-restartTask"
    	}, typeof task.typeLabel === "string" && task.typeLabel !== "" ? task.typeLabel : task.type ?? task.id))));
    	const body = [
    		h("p", {
    			key: "hint",
    			className: "buka-workflows-hint"
    		}, t("restartHint")),
    		renderOption({
    			page,
    			mode: "failed",
    			title: t("restartFromFailed"),
    			hint: t("restartFromFailedHint"),
    			option: restart?.failed,
    			...failedTaskList === null ? {} : { extra: failedTaskList }
    		}),
    		renderOption({
    			page,
    			mode: "scratch",
    			title: t("restartScratch"),
    			hint: t("restartScratchHint"),
    			option: restart?.scratch
    		}),
    		dialog.error === null ? null : h("p", {
    			key: "error",
    			className: "buka-workflows-formError",
    			role: "alert"
    		}, dialog.error)
    	];
    	return h(ClientModal, {
    		open: dialog.open,
    		onClose: actions.closeRestart,
    		title: t("restartTitle"),
    		closeLabel: t("close"),
    		footer: h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: actions.closeRestart,
    			disabled: dialog.submitting !== false
    		}, t("cancel"))
    	}, h("div", { className: "buka-workflows-dialogForm" }, ...body));
    }
    // .build/workflows/client/components/task-form.js
    /**
    * 人任务动作表单：按所选动作的 `input` schema 渲染；没有表单的动作不需要填。
    *
    * 表单值放在 `state.taskForm.values`，切换动作时保留（提交只取当前动作的字段）。
    */
    /**
    * 渲染动作表单：schema 字段 + 备注文本 + 错误提示。
    *
    * @param page 页面上下文
    * @param task 任务（只用于生成元素 id）
    * @param schema 所选动作的 input schema；null 表示这个动作没有表单
    * @returns React 元素数组
    */
    function renderTaskForm(page, task, schema) {
    	const { t, state, actions } = page;
    	const form = state.taskForm;
    	const elements = [];
    	const typed = isRecord(schema) ? schema : null;
    	if (typed !== null && schemaFields(typed).length > 0) elements.push(...renderSchemaFields(page, {
    		schema: typed,
    		values: form.values,
    		onChange: actions.setTaskField,
    		idPrefix: `buka-workflows-task-${task.id}`
    	}));
    	else if (typed !== null) elements.push(h("div", {
    		key: "json",
    		className: "buka-workflows-field"
    	}, renderJsonFallback(page, form.values.__json ?? "", (next) => actions.setTaskField("__json", next), `buka-workflows-task-${task.id}-json`)));
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
    		avatar: task === null ? null : renderAvatar$1(executorAvatar(page, task), 28, "buka-workflows-drawerAvatar"),
    		tag: task === null ? null : renderStatusTag(t, task.status, "task"),
    		meta: task === null ? null : taskMeta(page, task),
    		actions: task === null ? null : renderSessionButton(page, task),
    		onClose: actions.closeTask,
    		closeLabel: t("close")
    	}), h("div", { className: "buka-workflows-drawerBody" }, ...body));
    }
    /** 头部第二行：岗位 · 入站通道 · 代办 / 主体。 */
    function taskMeta(page, task) {
    	const { t } = page;
    	return [
    		task.positionLabel ?? task.position ?? "",
    		typeof task.channelLabel === "string" && task.channelLabel !== "" ? `${t("taskChannel")}: ${task.channelLabel}` : "",
    		renderTaskActor(page, task)
    	].filter((part) => part !== "").join(" · ");
    }
    /** 任务岗位对应的执行者头像。 */
    function executorAvatar(page, task) {
    	if (task.position === void 0 || task.position === "") return void 0;
    	const position = positionsOf(mergedDefinition(currentJobDefinition(page.state), currentDefinition(page.state))).find((item) => item.id === task.position);
    	if (position?.executor.missing === true) return MISSING_AVATAR_ID;
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
    		const contentSchema = isRecord(typeDefinition?.content) ? typeDefinition.content : null;
    		elements.push(renderSection(t("taskContentTitle"), h("div", { className: "buka-workflows-contractBody" }, renderReadonlyValue(page, contentSchema, task.content ?? null, t("taskContentEmpty")))));
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
    	elements.push(renderFold(t("taskDetailsTitle"), renderTaskDetails(page, task)));
    	return elements;
    }
    /** 人任务的填写表单：先选动作，再按动作的表单填，最后提交。 */
    function renderFormSection(page, task, allowed, canClaim, canComplete) {
    	const { t, state, actions } = page;
    	const typeDefinition = taskTypeOf(state, task);
    	const actionList = Array.isArray(typeDefinition?.actions) ? typeDefinition.actions : [];
    	const selected = actionList.find((action) => action.id === state.taskForm.action) ?? null;
    	const inputSchema = isRecord(selected?.input) ? selected.input : null;
    	const hasActions = actionList.length > 0;
    	return renderSection(t("actionFormTitle"), h("div", { className: "buka-workflows-taskForm" }, h("p", { className: "buka-workflows-sectionHint" }, hasActions ? t("actionFormHint") : t("actionFormNoActions")), hasActions ? h("div", { className: "buka-workflows-actionRow" }, ...actionList.map((action) => h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: String(action.id ?? action.label),
    		variant: state.taskForm.action === action.id ? "primary" : "outline",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => actions.selectTaskAction(String(action.id ?? "")),
    		disabled: state.taskForm.submitting
    	}, action.label ?? String(action.id ?? "")))) : null, ...renderTaskForm(page, task, inputSchema), h("div", { className: "buka-workflows-formActions" }, ...actionButtons(page, allowed, canClaim), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workflows-smallButton",
    		onClick: () => void actions.runTaskAction("complete"),
    		disabled: state.taskForm.submitting || !canComplete
    	}, state.taskForm.submitting ? t("actionSubmitting") : state.taskForm.action === null ? t("actionSubmitCompleteOnly") : t("actionSubmitAction")))));
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
    	const endSchema = currentJobDefinition(state)?.end?.content;
    	return renderSection(t("finalDeliverableTitle"), h("div", { className: "buka-workflows-deliverable" }, renderReadonlyValue(page, isRecord(endSchema) ? endSchema : null, task.content ?? null, t("taskContentEmpty"))));
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
    	const { t, actions } = page;
    	const result = isRecord(task.result) ? task.result : null;
    	if (result === null) return null;
    	const text = typeof result.text === "string" ? result.text : "";
    	const action = isRecord(result.action) ? result.action : null;
    	const input = result.input;
    	const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    	const blocks = [];
    	if (action !== null && typeof action.label === "string") blocks.push(h("p", {
    		key: "action",
    		className: "buka-workflows-resultMeta"
    	}, `${t("taskResultAction")}: ${action.label}`));
    	if (text !== "") blocks.push(h("p", {
    		key: "text",
    		className: "buka-workflows-resultText"
    	}, text));
    	if (input !== void 0 && input !== null) blocks.push(resultBlock(t("taskResultInput"), h("div", { className: "buka-workflows-contractBody" }, renderReadonlyValue(page, null, input, t("taskResultEmpty")))));
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
    /** 折叠区里的审计信息：类型 ID、通道与三个时间点。 */
    function renderTaskDetails(page, task) {
    	const { t } = page;
    	const rows = [];
    	if (typeof task.type === "string" && task.type !== "") rows.push([t("taskType"), h("code", { className: "buka-workflows-inlineCode" }, task.type)]);
    	if (typeof task.channel === "string" && task.channel !== "") rows.push([t("taskChannel"), h("code", { className: "buka-workflows-inlineCode" }, task.channel)]);
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
    * 工作流页的「结构图」Tab：可交互的分层图；点节点 / 通道在右侧抽屉里看细节。
    */
    /** 结构图视图。 */
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
    			...position.executor.missing === true ? { avatar: MISSING_AVATAR_ID } : typeof position.executor.avatar === "string" && position.executor.avatar !== "" ? { avatar: position.executor.avatar } : {},
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
    	}, t("definitionInfo"))), renderWorkflowGraph(page, {
    		nodes,
    		edges,
    		mode: "definition",
    		caption: t("definitionHint"),
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
    	const unavailable = workflow?.availability?.available === false;
    	const jobs = Array.isArray(loaded.data.jobs) ? loaded.data.jobs : [];
    	const counts = {
    		all: jobs.length,
    		running: jobs.filter((job) => job.status === "running").length,
    		completed: jobs.filter((job) => job.status === "completed").length,
    		problem: jobs.filter((job) => job.status === "failed" || job.status === "cancelled").length
    	};
    	const visible = sortJobs(filterJobs(jobs, state.jobFilter));
    	const outdated = typeof state.workflow.data?.workflow?.definition?.version === "number" && state.workflow.data?.workflow?.definition?.version !== 8;
    	const newJobAction = retired || outdated || unavailable || workflowId === "" ? null : h("button", {
    		key: "new-job-empty",
    		type: "button",
    		className: "buka-workflows-textButton",
    		onClick: actions.openNewJob
    	}, t("newJob"));
    	if (jobs.length === 0) return renderEmptyAction(t("jobsEmpty"), outdated ? t("jobsEmptyOutdated") : retired ? t("jobsEmptyRetired") : t("jobsEmptyHint"), newJobAction);
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
    	const oldVersion = typeof job.definitionVersion === "number" && job.definitionVersion !== 8;
    	const legacy = typeof job.definitionVersion === "number" && job.definitionVersion < 7;
    	const total = Object.values(job.taskCounts ?? {}).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
    	const unavailable = job.availability?.available === false;
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
    		className: `buka-workflows-card${legacy ? " is-disabled" : ""}`,
    		disabled: legacy,
    		title: legacy ? t("jobLegacyHint") : void 0,
    		onClick: legacy ? void 0 : () => actions.openJob(workflowId, job.id)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, h("span", { className: "buka-workflows-seq" }, fill(t, "jobSeq", { seq: job.seq ?? 0 })), h("span", { className: "buka-workflows-cardTitle" }, job.inputSummary ?? job.id)), h("span", { className: "buka-workflows-cardTags" }, oldVersion ? h("span", { className: "buka-workflows-tag" }, t("jobLegacy")) : null, unavailable ? h("span", { className: "buka-workflows-tag" }, t("workerUnavailable")) : null, renderStatusTag(t, job.status, "job"))), h("span", { className: "buka-workflows-meta" }, parts.join(" · ")), total > 0 ? h("span", {
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
    	const unavailable = workflow.availability?.available === false;
    	const missing = Array.isArray(workflow.availability?.missingWorkers) ? workflow.availability?.missingWorkers : [];
    	const outdated = typeof workflow.definitionVersion === "number" && workflow.definitionVersion !== 8;
    	return h("li", { key: workflow.id }, h("button", {
    		type: "button",
    		className: `buka-workflows-card${retired ? " is-disabled" : ""}`,
    		onClick: () => actions.openWorkflow(workflow.id)
    	}, h("span", { className: "buka-workflows-cardHead" }, h("span", { className: "buka-workflows-cardTitleGroup" }, h("span", { className: "buka-workflows-cardTitle" }, typeof workflow.name === "string" && workflow.name !== "" ? workflow.name : workflow.id), typeof workflow.version === "number" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, `v${workflow.version}`) : null), outdated ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warn" }, t("workflowOutdated")) : null, retired ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("workflowRetired")) : null, unavailable ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warn" }, t("workerUnavailable")) : null), typeof workflow.description === "string" && workflow.description !== "" ? h("span", { className: "buka-workflows-cardDesc" }, workflow.description) : null, h("span", { className: "buka-workflows-meta" }, [
    		fill(t, "jobCount", { n: typeof workflow.jobCount === "number" ? workflow.jobCount : 0 }),
    		typeof workflow.updatedAt === "string" && workflow.updatedAt !== "" ? `${t("updatedAt")} ${formatTime(workflow.updatedAt)}` : "",
    		retired ? t("workflowRetiredHint") : "",
    		unavailable ? missing.map((entry) => describeMissingWorker(t, entry)).join("; ") : ""
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
    		title: "",
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
    	const workflowAvailability = state.workflow.data?.workflow?.availability;
    	const jobAvailability = state.job.data?.availability;
    	const availability = route.kind === "job" ? jobAvailability : workflowAvailability;
    	const unavailable = availability?.available === false;
    	const workflowAvailable = workflowStatus !== void 0 && workflowStatus !== "retired" && !unavailable;
    	const tabs = route.kind === "workflow" ? [{
    		value: "jobs",
    		label: h(TabLabel, { text: t("jobsTab") }),
    		id: "buka-workflows-tab-jobs",
    		panelId: "buka-workflows-panel-jobs"
    	}, {
    		value: "definition",
    		label: h(TabLabel, { text: t("definitionTab") }),
    		id: "buka-workflows-tab-definition",
    		panelId: "buka-workflows-panel-definition"
    	}] : route.kind === "job" ? [
    		{
    			value: "overview",
    			label: h(TabLabel, { text: t("overviewTab") }),
    			id: "buka-workflows-tab-overview",
    			panelId: "buka-workflows-panel-overview"
    		},
    		{
    			value: "flow",
    			label: h(TabLabel, { text: t("flowTab") }),
    			id: "buka-workflows-tab-flow",
    			panelId: "buka-workflows-panel-flow"
    		},
    		{
    			value: "board",
    			label: h(TabLabel, { text: t("boardTab") }),
    			id: "buka-workflows-tab-board",
    			panelId: "buka-workflows-panel-board"
    		},
    		{
    			value: "outputs",
    			label: h(TabLabel, { text: t("outputsTab") }),
    			id: "buka-workflows-tab-outputs",
    			panelId: "buka-workflows-panel-outputs"
    		}
    	] : null;
    	const activeTab = route.kind === "workflow" ? route.tab : route.kind === "job" ? route.view : "";
    	/** 结构图与实时流程是整块画布：画布撑满正文，图例固定在底部。 */
    	const graphView = route.kind === "workflow" && route.tab === "definition" || route.kind === "job" && route.view === "flow";
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
    	return h("div", { className: `buka-workflows-page${graphView ? " is-graph" : ""}` }, h("header", { className: "buka-workflows-head" }, h("div", { className: "buka-workflows-headInner" }, h("div", { className: "buka-workflows-bar" }, h("div", { className: "buka-workflows-barTabs" }, page.topTabs), h("div", { className: "buka-workflows-toolbar" }, ...toolbar)), route.kind === "workflows" ? null : h("div", { className: "buka-workflows-titleRow" }, h("div", { className: "buka-workflows-titleGroup" }, h("button", {
    		type: "button",
    		className: "buka-workflows-back",
    		title: t("back"),
    		"aria-label": t("back"),
    		onClick: route.kind === "workflow" ? actions.backToWorkflows : actions.backToWorkflow
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 13 })), h("h1", { className: "buka-workflows-title" }, heading.title), route.kind === "workflow" && retired ? renderStatusTag(t, workflowStatus, "workflow") : null, route.kind === "workflow" && unavailable ? h("span", { className: "buka-workflows-titleMeta" }, h("span", { className: "buka-workflows-unavailableTag" }, t("workerUnavailable"))) : null, route.kind === "job" && unavailable ? h("span", { className: "buka-workflows-titleMeta" }, h("span", { className: "buka-workflows-unavailableTag" }, t("workerUnavailable"))) : null, route.kind === "job" ? h("span", { className: "buka-workflows-titleMeta" }, h("span", { className: "buka-workflows-titleSub" }, heading.subtitle), renderStatusTag(t, jobStatus, "job"), live ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : null) : null), tabs === null ? null : h("div", { className: "buka-workflows-tabs" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workflows-tabList",
    		label: route.kind === "workflow" ? t("workflowTabsAria") : t("jobTabsAria"),
    		value: activeTab,
    		onChange: (value) => {
    			if (route.kind === "workflow") actions.setWorkflowTab(value);
    			else if (route.kind === "job") actions.setJobView(value);
    		},
    		items: tabs
    	}))))), h("div", {
    		key: routeHash(route),
    		className: `buka-workflows-body${graphView ? " is-graph" : ""}`
    	}, renderAvailabilityNotice(page, availability), body), renderNewJobDialog(page), renderRestartDialog(page), renderDefinitionDrawer(page), renderNodeTasksDrawer(page), renderTaskDrawer(page), renderAttachmentDrawer(page), state.notice === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Toast, {
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
    						action: null,
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
    					content: {},
    					delivery: "starter",
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
    					content: {},
    					delivery: "starter",
    					error: null,
    					submitting: false
    				}
    			}));
    		},
    		setNewJobContent(name, value) {
    			setState((current) => ({
    				...current,
    				newJob: {
    					...current.newJob,
    					content: {
    						...current.newJob.content,
    						[name]: value
    					},
    					error: null
    				}
    			}));
    		},
    		setNewJobDelivery(value) {
    			setState((current) => ({
    				...current,
    				newJob: {
    					...current.newJob,
    					delivery: value,
    					error: null
    				}
    			}));
    		},
    		async submitNewJob() {
    			const current = state;
    			const workflowId = workflowIdOf(current);
    			if (workflowId === "") return;
    			const start = currentDefinition(current)?.start;
    			const contentSchema = isRecord(start?.content) ? start.content : null;
    			const draft = current.newJob;
    			let content;
    			if (schemaFields(contentSchema).length > 0) {
    				const parsed = parseSchemaValues(contentSchema, draft.content, t);
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
    				content = parsed.value;
    			} else {
    				const json = (draft.content.__json ?? "").trim();
    				if (json === "") content = {};
    				else {
    					const parsed = parseJson(json);
    					if (!isRecord(parsed)) {
    						setState((now) => ({
    							...now,
    							newJob: {
    								...now.newJob,
    								error: `${t("newJobJsonInvalid")} ${json.slice(0, 120)}`
    							}
    						}));
    						return;
    					}
    					content = parsed;
    				}
    			}
    			const delivery = draft.delivery.startsWith("assistant:") && draft.delivery.length > 10 ? {
    				kind: "assistant",
    				id: draft.delivery.slice(10)
    			} : { kind: "starter" };
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
    					content,
    					delivery
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
    							content: {},
    							delivery: "starter",
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
    		openRestart() {
    			setState((current) => ({
    				...current,
    				restart: {
    					open: true,
    					submitting: false,
    					error: null
    				}
    			}));
    		},
    		closeRestart() {
    			setState((current) => ({
    				...current,
    				restart: {
    					open: false,
    					submitting: false,
    					error: null
    				}
    			}));
    		},
    		async restartJob(mode) {
    			const current = state;
    			const jobId = jobIdOf(current);
    			if (jobId === "") return;
    			const workflowId = workflowIdOf(current);
    			setState((now) => ({
    				...now,
    				restart: {
    					...now.restart,
    					submitting: mode,
    					error: null
    				}
    			}));
    			try {
    				const body = await postJson(JOB_RESTART_ROUTE, {
    					jobId,
    					mode
    				});
    				const nextJobId = typeof body.jobId === "string" && body.jobId !== "" ? body.jobId : jobId;
    				if (mode === "scratch") writeRouteHash({
    					kind: "job",
    					workflowId,
    					jobId: nextJobId,
    					view: "overview"
    				});
    				setState((now) => {
    					const base = {
    						...now,
    						restart: {
    							open: false,
    							submitting: false,
    							error: null
    						},
    						job: mode === "scratch" ? {
    							status: "loading",
    							data: null,
    							error: null
    						} : {
    							...now.job,
    							status: "loading"
    						},
    						finalTask: idle$1(),
    						attachments: idle$1(),
    						taskId: null,
    						task: idle$1(),
    						attachment: null,
    						tick: now.tick + 1
    					};
    					return mode === "scratch" ? {
    						...base,
    						route: {
    							kind: "job",
    							workflowId,
    							jobId: nextJobId,
    							view: "overview"
    						}
    					} : base;
    				});
    				flash("success", t(mode === "scratch" ? "restartScratchStarted" : "restartFromFailedStarted"));
    			} catch (failure) {
    				setState((now) => ({
    					...now,
    					restart: {
    						...now.restart,
    						submitting: false,
    						error: `${t("restartFailed")} ${messageOf(failure)}`
    					}
    				}));
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
    					action: null,
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
    					action: null,
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
    		selectTaskAction(actionId) {
    			setState((current) => ({
    				...current,
    				taskForm: {
    					...current.taskForm,
    					action: actionId === "" ? null : actionId,
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
    			let input = null;
    			let selectedAction = null;
    			if (action === "complete") {
    				const workflowDefinition = currentDefinition(current);
    				mergedDefinition(currentJobDefinition(current), workflowDefinition);
    				const form = current.taskForm;
    				const selected = actionOf(taskTypeOf(current, task), form.action);
    				selectedAction = typeof selected?.id === "string" && selected.id !== "" ? selected.id : null;
    				if (selectedAction !== null && isRecord(selected?.input)) {
    					const parsed = parseSchemaValues(selected.input, form.values, t);
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
    					input = parsed.value;
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
    				if (selectedAction !== null) body.selectedAction = selectedAction;
    				if (input !== null) body.input = input;
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
    			content: {},
    			delivery: "starter",
    			error: null,
    			submitting: false
    		},
    		restart: {
    			open: false,
    			submitting: false,
    			error: null
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
    		requestJson$1(WORKFLOWS_ROUTE).then((body) => {
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
    		requestJson$1(`${WORKFLOW_ROUTE}?id=${encodeURIComponent(workflowId)}`).then((body) => {
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
    		requestJson$1(`${JOB_ROUTE}?id=${encodeURIComponent(jobId)}`).then((body) => {
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
    		requestJson$1(`${TASK_ROUTE}?jobId=${encodeURIComponent(jobId)}&taskId=${encodeURIComponent(endTaskId)}`).then((body) => {
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
    		requestJson$1(`${TASK_ROUTE}?jobId=${encodeURIComponent(jobId)}&taskId=${encodeURIComponent(taskId)}`).then((body) => {
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
    		requestJson$1(`${ATTACHMENTS_ROUTE}?jobId=${encodeURIComponent(jobId)}`).then((body) => {
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
    			action: null,
    			values: {},
    			text: "",
    			error: null,
    			submitting: false
    		},
    		newJob: {
    			open: false,
    			content: {},
    			delivery: "starter",
    			error: null,
    			submitting: false
    		},
    		restart: {
    			open: false,
    			submitting: false,
    			error: null
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
    * 「工作流」页签（首页 Workflow Tab 的内容）：装配状态、数据 effect 与动作，
    * 渲染只做分发。
    *
    * 导航只有一条链：工作流列表 → 工作流（作业 / 结构图）→ 作业（概览 /
    * 实时流程 / 看板 / 资产）。不存在跨工作流的作业列表。
    */
    /** 组合里没有会话状态钩子时使用：始终返回空快照，功能静默降级。 */
    const useEmptySessionStatus = (selector) => selector(EMPTY_SESSION_STATUS);
    /**
    * 「工作流」页签（首页 Workflow Tab 的内容）。
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
    	const sessionStatus = (typeof props.useSessionStatus === "function" ? props.useSessionStatus : useEmptySessionStatus)((snapshot) => snapshot);
    	const topTabs = props.topTabs ?? null;
    	return renderPage({
    		t,
    		getService,
    		state: store.state,
    		actions,
    		narrow,
    		topTabs,
    		sessionStatus
    	});
    }
    // .build/workflows/client/workers/api.js
    /**
    * 「执行者」页面与 Host 通信的请求 / 错误处理。
    *
    * 所有 `/buka-workers/*` 路由都返回 `{ ok, ... }`；非 2xx 或 `ok !== true` 时
    * 抛出带 `code` 的错误，页面再按错误码翻成可读文案。逐项更新是例外：请求
    * 成功但部分 skill 失败时回 200 + `ok:false`，由调用方读取 `update.failed`。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/api
    */
    /** 读带错误码的错误的 `code`；不是对象或没有字符串 `code` 时返回 undefined。 */
    function errorCode(failure) {
    	if (failure === null || typeof failure !== "object" || !("code" in failure)) return void 0;
    	const code = failure.code;
    	return typeof code === "string" ? code : void 0;
    }
    /** 读失败响应里的命令输出；没有时返回空串。 */
    function outputOf(failure) {
    	if (failure === null || typeof failure !== "object" || !("output" in failure)) return "";
    	const output = failure.output;
    	return typeof output === "string" ? output : "";
    }
    /**
    * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
    * 实现统一在界面侧公共包里，这里只补上本插件的默认响应类型。
    *
    */
    function requestJson(url, init = {}) {
    	return requestJson$1(url, init);
    }
    /**
    * 读允许 `ok:false` 的 2xx 响应。
    *
    * 更新的「逐项失败」是请求成功、部分 skill 失败：路由回 200 但 `ok:false`，
    * 页面需要拿到 `update.failed` 里的原因再决定提示方式，所以不能按普通请求
    * 直接抛错。
    */
    function requestUpdateJson(url, init = {}) {
    	return requestJson$1(url, {
    		...init,
    		allowFailureBody: true
    	});
    }
    /**
    * Host 返回的错误码 → 可读文案；未知错误原样展示 message。
    *
    */
    function failureText(t, failure) {
    	switch (errorCode(failure)) {
    		case "invalid-id": return t("errInvalidId");
    		case "invalid-name": return t("errInvalidName");
    		case "id-taken": return t("errIdTaken");
    		case "invalid-avatar": return t("errInvalidAvatar");
    		case "not-directory": return t("errNotDirectory");
    		case "unknown-worker": return t("errUnknownWorker");
    		case "invalid-update": return t("errInvalidUpdate");
    		case "missing-directory": return t("errMissingDirectory");
    		case "registry-unreadable": return t("errRegistryUnreadable");
    		case "robot-worker": return t("errRobotWorker");
    		case "builtin-worker": return t("errBuiltinWorker");
    		case "worker-in-use": return t("deleteBlockedByJobs");
    		case "outside-root": return t("errOutsideRoot");
    		case "workspace-unavailable": return t("errWorkspaceUnavailable");
    		case "invalid-model": return t("errInvalidModel");
    		case "invalid-driver": return t("errInvalidDriver");
    		case "too-large": return t("errTooLarge");
    		case "invalid-content": return t("errInvalidContent");
    		case "invalid-source": return t("errInvalidSource");
    		case "invalid-skill": return t("errInvalidSkill");
    		case "invalid-skills": return t("errInvalidSkills");
    		case "list-unparsed": return t("errListUnparsed");
    		case "npx-failed": return t("errNpxFailed");
    		case "skills-unavailable": return t("errSkillsUnavailable");
    		case "update-failed": return t("errUpdateFailed");
    		default: return messageOf$1(failure);
    	}
    }
    /**
    * `{n} skills` 这类带数量的标签；占位符写在词典里，中英文各自组织语序。
    *
    */
    function countBadge(count, t) {
    	return String(t("skillsBadge")).replace("{n}", String(count));
    }
    /** 是否机器人（只读、没有目录与会话）。 */
    function isRobotWorker(worker) {
    	return worker?.driver === "robot";
    }
    /**
    * 工作流状态 → 可读文案。
    *
    * 执行者页与工作流页是两个词典命名空间，这里只认识删除影响面里会出现的
    * `active` / `retired` / `draft`；其它值原样显示，避免把状态吞成空白。
    *
    */
    function workflowStatusText(t, status) {
    	switch (status) {
    		case "active": return t("workflowStatusActive");
    		case "retired": return t("workflowStatusRetired");
    		case "draft": return t("workflowStatusDraft");
    		default: return typeof status === "string" ? status : "";
    	}
    }
    /**
    * 执行者的 skills 列表；Host 字段缺失时回退空数组，避免渲染期抛错。
    *
    */
    function skillsOf(worker) {
    	return Array.isArray(worker?.skills) ? worker.skills : [];
    }
    /**
    * 执行者的 CLAUDE.md 链接摘要；缺失时按「没有链接」处理。
    *
    */
    function claudeOf(worker) {
    	const claude = worker?.claude;
    	if (claude === null || typeof claude !== "object") return {
    		exists: false,
    		symlink: false,
    		mode: "missing",
    		target: ""
    	};
    	return {
    		exists: claude.exists === true,
    		symlink: claude.symlink === true,
    		mode: typeof claude.mode === "string" ? claude.mode : "missing",
    		target: typeof claude.target === "string" ? claude.target : ""
    	};
    }
    // .build/workflows/client/workers/avatar.js
    /**
    * 预设头像与头像渲染。
    *
    * 预设表（id / emoji / 底色 / 词典 key）统一在界面侧公共包里，执行者页与
    * 工作流节点图都从那里派生；这里只保留执行者页自己的兜底与渲染。头像 id 与
    * Host 的 `avatar.ts` 一一对应（插件之间不互相 import，所以契约是
    * 「同一个 id」）。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/avatar
    */
    /**
    * 头像 id → 预设；不认识的 id 退回第一个预设（Host 的旧记录已兜底，这里只是
    * 防御脏数据，保证页面上永远有一个头像）。
    *
    */
    function avatarPreset(id) {
    	return findAvatarPreset(id) ?? AVATARS[0];
    }
    /**
    * 执行者头像：emoji 画在预设色的浅底圆片里。[size] 是直径（px）。
    *
    */
    function renderAvatar(id, size, className = "") {
    	const preset = avatarPreset(id);
    	return h("span", {
    		className: `buka-workers-avatar${className === "" ? "" : ` ${className}`}`,
    		style: {
    			width: `${size}px`,
    			height: `${size}px`,
    			fontSize: `${Math.max(9, Math.round(size * .6))}px`,
    			backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
    			borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`
    		},
    		"aria-hidden": true
    	}, preset.emoji);
    }
    // .build/workflows/client/workers/constants.js
    /**
    * 「执行者」页签的常量：词典命名空间、路由、页签与表单 id。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/constants
    */
    /** 词典命名空间（面板合并后仍独立，供 `home.ts` 绑定执行者文案）。 */
    const NS = "buka-workers";
    /** 「创建执行者」对话框里表单的 id：页脚按钮通过 `form` 属性提交它。 */
    const CREATE_FORM_ID = "buka-workers-create-form";
    /**
    * 「重命名执行者」对话框里表单的 id：页脚「保存」按钮通过 `form` 提交它，
    * 这样回车与点保存走同一套校验。
    */
    const RENAME_FORM_ID = "buka-workers-rename-form";
    /** 与 Host 一半（`src/workers/` 的 `/buka-workers/*` 路由）的路由常量保持一致。 */
    const LIST_ROUTE = "/buka-workers/list";
    const CREATE_ROUTE = "/buka-workers/create";
    const RENAME_ROUTE = "/buka-workers/rename";
    const AVATAR_ROUTE = "/buka-workers/avatar";
    const FILES_ROUTE = "/buka-workers/files";
    const FILE_ROUTE = "/buka-workers/file";
    const DESCRIPTION_ROUTE = "/buka-workers/description";
    const MODELS_ROUTE = "/buka-workers/models";
    const REMOVE_IMPACT_ROUTE = "/buka-workers/remove-impact";
    const REMOVE_ROUTE = "/buka-workers/remove";
    const REVEAL_ROUTE = "/buka-workers/reveal";
    const AVAILABLE_ROUTE = "/buka-workers/skills/available";
    const INSTALL_ROUTE = "/buka-workers/skills/install";
    const SKILL_REMOVE_ROUTE = "/buka-workers/skills/remove";
    const SKILL_UPDATE_ROUTE = "/buka-workers/skills/update";
    const SKILL_UPDATE_ALL_ROUTE = "/buka-workers/skills/update-all";
    /**
    * Skills 插件（`@buka/dsh-plugin-skills`）的收藏仓库路由。
    *
    * 两个插件不互相 import，只通过同一个 webServer 的包内路由通信：这里只读
    * 收藏清单（GET），Skills 插件没安装时请求 404，页面就把「收藏夹」整块隐藏。
    * 这是跨插件契约，改动时要和 `plugins/skills/lib/index.js` 同步。
    */
    const SKILLS_REPOS_ROUTE = "/buka-skills/repos";
    /** 详情页的页签；id / panelId 与 `SegmentedTabs` 的 ARIA 契约一致。 */
    const TABS = [
    	{
    		value: "settings",
    		id: "buka-workers-tab-settings",
    		panelId: "buka-workers-panel-settings"
    	},
    	{
    		value: "files",
    		id: "buka-workers-tab-files",
    		panelId: "buka-workers-panel-files"
    	},
    	{
    		value: "skills",
    		id: "buka-workers-tab-skills",
    		panelId: "buka-workers-panel-skills"
    	}
    ];
    /** 安装对话框里来源表单的 id：回车触发表单提交，读出候选 skills。 */
    const INSTALL_FORM_ID = "buka-workers-install-form";
    /** 「更换头像」对话框里表单的 id：页脚「保存」按钮通过 `form` 属性提交它。 */
    const AVATAR_FORM_ID = "buka-workers-avatar-form";
    /**
    * 新标识符的字符集（与 Host 的 `isValidWorkerId` 一致）：小写字母开头，
    * 后面可以跟小写字母、数字、`_` 与 `-`，总长 1–64。
    */
    const WORKER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
    /** 标识符是否是合法的新标识符（创建对话框用；已有旧标识符不受此约束）。 */
    function isValidWorkerId(value) {
    	return typeof value === "string" && WORKER_ID_PATTERN.test(value.trim());
    }
    // .build/workflows/client/workers/actions/detail.js
    /**
    * 「执行者」详情页的动作：更换头像、改展示名、保存职责描述。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/actions/detail
    */
    /**
    * 构造详情页动作。
    *
    */
    function createDetailActions(state, t) {
    	const { mutating, avatarTarget, setAvatarTarget, draftAvatar, setDraftAvatar, avatarSaving, setAvatarSaving, setAvatarError, setAvatarOpen, selectedWorker, setRenameDraft, setRenameError, setRenameOpen, renameSaving, renameDraft, setRenameSaving, selectedId, descriptionDraft, setDescriptionDraft, descriptionSaving, setDescriptionSaving, setDescriptionError, modelDraft, setModelDraft, modelSaving, setModelSaving, setModelError, patchWorker, flash, reload, corrupt } = state;
    	/**
    	* 打开「更换头像」对话框：草稿从执行者当前头像开始。
    	*
    	*/
    	function openAvatarDialog(worker) {
    		if (mutating) return;
    		setAvatarTarget(worker.id);
    		setDraftAvatar(avatarPreset(worker.avatar).id);
    		setAvatarError(null);
    		setAvatarOpen(true);
    	}
    	/** 关闭「更换头像」对话框；保存中不响应关闭。 */
    	function closeAvatarDialog() {
    		if (avatarSaving) return;
    		setAvatarOpen(false);
    		setAvatarTarget(null);
    		setAvatarError(null);
    	}
    	/** 保存头像：成功后只局部更新那一个执行者，详情页不闪烁。 */
    	async function saveAvatar() {
    		if (avatarTarget === null || avatarSaving) return;
    		setAvatarSaving(true);
    		setAvatarError(null);
    		try {
    			const saved = (await requestJson(AVATAR_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: avatarTarget,
    					avatar: draftAvatar
    				})
    			}))?.worker?.avatar;
    			patchWorker(avatarTarget, { avatar: typeof saved === "string" ? saved : draftAvatar });
    			flash("success", t("avatarUpdated"));
    			setAvatarOpen(false);
    			setAvatarTarget(null);
    		} catch (failure) {
    			setAvatarError(`${t("avatarSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setAvatarSaving(false);
    		}
    	}
    	/**
    	* 打开「重命名执行者」对话框：草稿从当前展示名开始，用户直接改成新名称。
    	* 登记文件损坏或写操作进行中时不打开（入口按钮也会禁用）；目录缺失不影响
    	* 改展示名。
    	*/
    	function openRenameDialog() {
    		if (selectedWorker === null || mutating || corrupt) return;
    		setRenameDraft(selectedWorker.name);
    		setRenameError(null);
    		setRenameOpen(true);
    	}
    	/** 关闭「重命名执行者」对话框；保存中不响应关闭。 */
    	function closeRenameDialog() {
    		if (renameSaving) return;
    		setRenameOpen(false);
    		setRenameError(null);
    	}
    	/**
    	* 改展示名：Host 只更新登记表里的 `name`，目录与工作区注册保持不变，已挂载
    	* 工作区的标题同步成新名称。成功后只局部更新列表里的这一条，`selectedId`
    	* 不变，详情页留在同一个执行者上；失败留在对话框里提示。
    	*
    	*/
    	async function renameWorker(event) {
    		event.preventDefault();
    		if (selectedWorker === null || renameSaving) return;
    		const previousName = selectedWorker.name;
    		const nextName = renameDraft.trim();
    		if (nextName === previousName) {
    			setRenameError(t("renameSame"));
    			return;
    		}
    		setRenameSaving(true);
    		setRenameError(null);
    		try {
    			const saved = (await requestJson(RENAME_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: selectedWorker.id,
    					name: nextName
    				})
    			}))?.worker;
    			const savedName = typeof saved?.name === "string" ? saved.name : nextName;
    			patchWorker(selectedWorker.id, { name: savedName });
    			setRenameOpen(false);
    			setRenameDraft("");
    			const display = savedName === "" ? selectedWorker.id : savedName;
    			flash("success", `${t("renamed")} ${display}`);
    			reload();
    		} catch (failure) {
    			setRenameError(`${t("renameSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setRenameSaving(false);
    		}
    	}
    	/**
    	* 描述草稿的规范化（与 Host 一致：折叠空白并 trim）；用来判断有没有改动。
    	*
    	*/
    	function normalizedDescription(value) {
    		return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
    	}
    	/**
    	* 保存「描述」页签：Host 折叠空白后写进登记表。工作流通过 `buka_workers`
    	* 工具读它，决定是否把节点交给这个执行者；保存成功后只局部更新列表。
    	*/
    	async function saveDescription() {
    		if (selectedId === null || descriptionSaving) return;
    		setDescriptionSaving(true);
    		setDescriptionError(null);
    		try {
    			const saved = (await requestJson(DESCRIPTION_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: selectedId,
    					description: descriptionDraft
    				})
    			}))?.worker?.description;
    			const next = typeof saved === "string" ? saved : normalizedDescription(descriptionDraft);
    			patchWorker(selectedId, { description: next });
    			setDescriptionDraft(next);
    			flash("success", t("descriptionSaved"));
    		} catch (failure) {
    			setDescriptionError(`${t("descriptionSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setDescriptionSaving(false);
    		}
    	}
    	/**
    	* 保存智能体的模型选择；`null` 表示跟随宿主默认模型。
    	*
    	*/
    	async function saveWorkerModel() {
    		if (selectedId === null || modelSaving) return;
    		setModelSaving(true);
    		setModelError(null);
    		try {
    			const saved = (await requestJson("/buka-workers/model", {
    				method: "POST",
    				body: JSON.stringify({
    					id: selectedId,
    					model: modelDraft
    				})
    			}))?.worker?.model ?? null;
    			patchWorker(selectedId, { model: saved });
    			setModelDraft(saved);
    			flash("success", t("modelSaved"));
    		} catch (failure) {
    			setModelError(`${t("modelSaveFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setModelSaving(false);
    		}
    	}
    	return {
    		openAvatarDialog,
    		closeAvatarDialog,
    		saveAvatar,
    		openRenameDialog,
    		closeRenameDialog,
    		renameWorker,
    		normalizedDescription,
    		saveDescription,
    		saveWorkerModel
    	};
    }
    // .build/workflows/client/workers/actions/skills.js
    /**
    * 「执行者」页面的项目级 skills 动作：读收藏仓库、列候选、安装与移除。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/actions/skills
    */
    /**
    * 构造 skills 动作。
    *
    */
    function createSkillActions(state, t) {
    	const { favourites, setFavourites, setInstallOpen, installCandidates, setInstallCandidates, installSource, setInstallSource, installSelected, setInstallSelected, setInstallError, installing, setInstalling, selectedWorker, patchWorker, reload, flash, corrupt, removing, setRemoving, setConfirmingSkill, setSkillError, updatingSkills, setUpdatingSkills, updatingAllSkills, setUpdatingAllSkills } = state;
    	/**
    	* 读 Skills 插件的收藏仓库。只读它已经存在的 `GET /buka-skills/repos`：
    	* 两个插件之间不 import，这个路由回 404（插件没装）或任何失败都按
    	* 「没有收藏夹」处理，页面不显示这一块也不报错。
    	*/
    	function loadFavourites() {
    		if (favourites.status === "loading" || favourites.status === "ready") return;
    		setFavourites((prev) => ({
    			...prev,
    			status: "loading"
    		}));
    		requestJson(SKILLS_REPOS_ROUTE).then((body) => {
    			const repos = (Array.isArray(body?.repos) ? body.repos : []).filter((repo) => repo !== null && typeof repo === "object" && typeof repo.source === "string" && repo.source !== "").map((repo) => ({
    				id: typeof repo.id === "string" && repo.id !== "" ? repo.id : repo.source ?? "",
    				source: repo.source ?? "",
    				note: typeof repo.note === "string" ? repo.note : ""
    			}));
    			setFavourites({
    				status: "ready",
    				repos
    			});
    		}, () => setFavourites({
    			status: "unavailable",
    			repos: []
    		}));
    	}
    	/** 打开「安装 skills」对话框：清掉上一次的来源、候选与勾选，并按需加载收藏夹。 */
    	function openInstallDialog() {
    		if (installing || corrupt) return;
    		setInstallSource("");
    		setInstallCandidates({
    			status: "idle",
    			skills: [],
    			installed: [],
    			error: null,
    			output: ""
    		});
    		setInstallSelected([]);
    		setInstallError(null);
    		setInstallOpen(true);
    		loadFavourites();
    	}
    	/** 关闭「安装 skills」对话框；安装中不响应关闭，避免请求回来时状态错位。 */
    	function closeInstallDialog() {
    		if (installing) return;
    		setInstallOpen(false);
    		setInstallError(null);
    	}
    	/**
    	* 读一个来源里的 skills 清单并默认勾选全部未安装的。
    	*
    	*/
    	async function loadCandidates(sourceOverride) {
    		if (installing || selectedWorker === null) return;
    		const value = (sourceOverride ?? installSource).trim();
    		if (value === "") {
    			setInstallCandidates({
    				status: "error",
    				skills: [],
    				installed: [],
    				error: t("errInvalidSource"),
    				output: ""
    			});
    			return;
    		}
    		setInstallSource(value);
    		setInstallCandidates({
    			status: "loading",
    			skills: [],
    			installed: [],
    			error: null,
    			output: ""
    		});
    		setInstallError(null);
    		try {
    			const body = await requestJson(AVAILABLE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: selectedWorker.id,
    					source: value
    				})
    			});
    			const skills = (Array.isArray(body?.skills) ? body.skills : []).filter((skill) => skill !== null && typeof skill === "object" && typeof skill.name === "string" && skill.name !== "");
    			const installed = new Set((Array.isArray(body?.installed) ? body.installed : []).map((name) => String(name)));
    			for (const skill of skillsOf(selectedWorker)) installed.add(String(skill.name));
    			setInstallCandidates({
    				status: "ready",
    				skills,
    				installed: [...installed],
    				error: null,
    				output: ""
    			});
    			setInstallSelected(skills.filter((skill) => !installed.has(skill.name)).map((skill) => skill.name));
    		} catch (failure) {
    			setInstallCandidates({
    				status: "error",
    				skills: [],
    				installed: [],
    				error: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		}
    	}
    	/**
    	* 勾选 / 取消一个候选 skill。
    	*
    	*/
    	function toggleCandidate(skillName) {
    		setInstallSelected((prev) => prev.includes(skillName) ? prev.filter((name) => name !== skillName) : [...prev, skillName]);
    	}
    	/**
    	* 全选 / 取消全选（已安装的不参与）。
    	*
    	*/
    	function selectAllCandidates(checked) {
    		const installed = new Set(installCandidates.installed);
    		const selectable = installCandidates.skills.filter((skill) => !installed.has(skill.name)).map((skill) => skill.name);
    		setInstallSelected(checked ? selectable : []);
    	}
    	/**
    	* 安装勾选的 skills：Host 在执行者目录里跑
    	* `npx skills add <source> --skill … -a universal -a claude-code -y`，
    	* 同时落 `.agents/skills` 与 `.claude/skills`；成功响应带新的 skills 列表。
    	*/
    	async function installSelectedSkills() {
    		if (installing || selectedWorker === null) return;
    		if (installSelected.length === 0) {
    			setInstallError({
    				message: t("installEmptySelection"),
    				output: ""
    			});
    			return;
    		}
    		setInstalling(true);
    		setInstallError(null);
    		try {
    			const body = await requestJson(INSTALL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: selectedWorker.id,
    					source: installSource.trim(),
    					skills: installSelected
    				})
    			});
    			patchWorker(selectedWorker.id, {
    				skills: Array.isArray(body.skills) ? body.skills : [],
    				claude: body.claude !== null && typeof body.claude === "object" ? body.claude : claudeOf(selectedWorker)
    			});
    			setInstallOpen(false);
    			flash("success", `${t("skillInstalled")} ${installSource.trim()}`);
    		} catch (failure) {
    			setInstallError({
    				message: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		} finally {
    			setInstalling(false);
    		}
    	}
    	/**
    	* 更新一个执行者的项目级 skills：Host 通过 Skills 插件的 `ctx.bukaSkills`
    	* 检查并更新目录，`modified` 会跳过。逐项失败时路由回 200 但 `ok:false`，
    	* 页面展示第一个失败 skill 的原因与输出；整体失败走请求异常分支。
    	*/
    	async function updateWorkerSkills(worker) {
    		if (updatingSkills || updatingAllSkills) return;
    		setUpdatingSkills(true);
    		setSkillError(null);
    		try {
    			const body = await requestUpdateJson(SKILL_UPDATE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({ id: worker.id })
    			});
    			if (Array.isArray(body.skills)) patchWorker(worker.id, { skills: body.skills });
    			const summary = body.update;
    			const failed = Array.isArray(summary?.failed) ? summary.failed : [];
    			const first = failed[0];
    			if (body.ok === false || failed.length > 0) {
    				const message = typeof first?.message === "string" && first.message !== "" ? first.message : typeof summary?.message === "string" && summary.message !== "" ? summary.message : t("errUpdateFailed");
    				setSkillError({
    					message,
    					output: typeof first?.output === "string" ? first.output : ""
    				});
    				flash("error", message);
    				return;
    			}
    			const message = summary?.message;
    			flash("success", typeof message === "string" && message !== "" ? message : t("skillsUpToDate"));
    		} catch (failure) {
    			setSkillError({
    				message: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		} finally {
    			setUpdatingSkills(false);
    		}
    	}
    	/**
    	* 列表页「更新全部执行者」：Host 只对智能体、目录存在且有 skill 的 worker
    	* 顺序执行，单个失败不中断；页面用汇总提示结果并刷新列表。
    	*/
    	async function updateAllWorkers() {
    		if (updatingSkills || updatingAllSkills) return;
    		setUpdatingAllSkills(true);
    		try {
    			const body = await requestJson(SKILL_UPDATE_ALL_ROUTE, { method: "POST" });
    			const results = Array.isArray(body.results) ? body.results : [];
    			const failed = Number(body.failed ?? results.filter((one) => one.ok === false).length);
    			const updated = Number(body.updated ?? 0);
    			const skipped = Number(body.skippedWorkers ?? 0);
    			const summary = t("updateAllSummary").replace("{n}", String(updated)).replace("{f}", String(failed)).replace("{s}", String(skipped));
    			flash(failed > 0 ? "error" : "success", summary);
    			reload();
    		} catch (failure) {
    			flash("error", `${t("errUpdateFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setUpdatingAllSkills(false);
    		}
    	}
    	/**
    	* 移除项目级 skill：Host 执行 `npx skills remove <skill> -y` 并返回新的
    	* skills 列表；请求体字段是 `{ name, skill }`（路由契约）。
    	*
    	*/
    	async function removeSkill(worker, skill) {
    		if (removing !== null) return;
    		setRemoving(skill.name);
    		setSkillError(null);
    		try {
    			const body = await requestJson(SKILL_REMOVE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: worker.id,
    					skill: skill.name
    				})
    			});
    			patchWorker(worker.id, { skills: Array.isArray(body.skills) ? body.skills : [] });
    			setConfirmingSkill(null);
    			flash("success", `${t("skillRemoved")} ${skill.name}`);
    		} catch (failure) {
    			setSkillError({
    				message: failureText(t, failure),
    				output: outputOf(failure)
    			});
    		} finally {
    			setRemoving(null);
    		}
    	}
    	return {
    		loadFavourites,
    		openInstallDialog,
    		closeInstallDialog,
    		loadCandidates,
    		toggleCandidate,
    		selectAllCandidates,
    		installSelectedSkills,
    		removeSkill,
    		updateWorkerSkills,
    		updateAllWorkers
    	};
    }
    // .build/workflows/client/workers/actions/workers.js
    /**
    * 「执行者」页面的执行者管理动作：打开会话、挂载、创建、删除。
    *
    * 这些动作只调 Host 路由与 DSH Client Service，然后更新 `useWorkersState` 的
    * 状态；不包含任何渲染。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/actions/workers
    */
    /**
    * 构造执行者管理动作。
    *
    */
    function createWorkerActions(state, t) {
    	const { setBusy, flash, reload, service, mutating, creating, createId, setCreateId, createName, setCreateName, draftDescription, draftAvatar, nextAvatarId, setDialogOpen, setCreateError, setCreating, deleteDialog, setDeleteDialog, selectedId, setSelectedId, corrupt, setDraftDescription, setDraftAvatar } = state;
    	/**
    	* 打开执行者会话：只有已挂载（有 workspaceId）才能打开；否则提示先挂载。
    	* 打开走 DSH 的 `uiWorkspace.openWorkspace(workspaceId)`。
    	*
    	*/
    	async function openWorker(worker) {
    		if (isRobotWorker(worker)) {
    			flash("error", t("robotReadOnly"));
    			return;
    		}
    		if (worker.mounted !== true || typeof worker.workspaceId !== "string" || worker.workspaceId === "") {
    			flash("error", t("openUnmounted"));
    			return;
    		}
    		const uiWorkspace = service("uiWorkspace");
    		if (uiWorkspace === null || typeof uiWorkspace.openWorkspace !== "function") {
    			flash("error", t("noUiWorkspace"));
    			return;
    		}
    		setBusy(`open:${worker.id}`);
    		try {
    			await uiWorkspace.openWorkspace(worker.workspaceId);
    		} catch (failure) {
    			flash("error", `${t("openFailed")} ${messageOf$1(failure)}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/**
    	* 用系统文件管理器打开执行者目录（macOS 上是 Finder）。
    	*
    	* 成功不弹提示：Finder 窗口本身就是反馈；失败用 Toast 说明。
    	*
    	*/
    	async function revealWorker(worker) {
    		if (mutating) return;
    		if (isRobotWorker(worker)) {
    			flash("error", t("robotReadOnly"));
    			return;
    		}
    		setBusy(`reveal:${worker.id}`);
    		try {
    			await requestJson(REVEAL_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({ id: worker.id })
    			});
    		} catch (failure) {
    			const extra = errorCode(failure) === "reveal-failed" ? "" : ` ${failureText(t, failure)}`;
    			flash("error", `${t("revealFailed")}${extra}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/**
    	* 把执行者挂载成 DSH 工作区：目录已经由 Host 建好，这里只调用
    	* `workspaces.create({ path })`，成功后刷新列表让卡片变成「已挂载」。
    	*
    	*/
    	async function mountWorker(worker) {
    		if (isRobotWorker(worker)) {
    			flash("error", t("robotReadOnly"));
    			return;
    		}
    		const workspaces = service("workspaces");
    		if (workspaces === null || typeof workspaces.create !== "function") {
    			flash("error", t("noWorkspacesCreate"));
    			return;
    		}
    		setBusy(`mount:${worker.id}`);
    		try {
    			await workspaces.create({ path: worker.path });
    			flash("success", `${t("mounted")} ${workerDisplayName(worker)}`);
    			reload();
    		} catch (failure) {
    			flash("error", `${t("mountFailed")} ${messageOf$1(failure)}`);
    		} finally {
    			setBusy(null);
    		}
    	}
    	/** 打开「创建执行者」对话框：清掉上一次的输入，并按现有执行者挑一个新头像。 */
    	function openCreateDialog() {
    		if (creating || corrupt) return;
    		setCreateId("");
    		setCreateName("");
    		setDraftDescription("");
    		setDraftAvatar(nextAvatarId());
    		setCreateError(null);
    		setDialogOpen(true);
    	}
    	/** 关闭「创建执行者」对话框；提交中不响应关闭，避免请求回来时状态错位。 */
    	function closeCreateDialog() {
    		if (creating) return;
    		setDialogOpen(false);
    		setCreateError(null);
    	}
    	/**
    	* 新建执行者：Host 先建目录并写入登记表，浏览器再把它挂载成工作区。
    	* 挂载失败不会撤销执行者 —— 它会以「未挂载」留在列表里，可稍后点「挂载」。
    	* 创建请求本身的失败留在对话框里原地提示，不用关掉重开。
    	*
    	*/
    	async function createWorker(event) {
    		event.preventDefault();
    		if (creating || corrupt) return;
    		const value = createId.trim();
    		const displayName = createName.trim();
    		if (value === "") {
    			setCreateError(t("createEmptyId"));
    			return;
    		}
    		setCreating(true);
    		setCreateError(null);
    		try {
    			const body = await requestJson(CREATE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({
    					id: value,
    					name: displayName,
    					avatar: draftAvatar,
    					description: draftDescription
    				})
    			});
    			setCreateId("");
    			setCreateName("");
    			setDialogOpen(false);
    			const workerPath = body?.worker?.path;
    			if (typeof workerPath !== "string" || workerPath === "") {
    				flash("error", `${t("createFailed")} ${messageOf$1("host did not return the worker path")}`);
    				reload();
    				return;
    			}
    			const workspaces = service("workspaces");
    			if (workspaces === null || typeof workspaces.create !== "function") {
    				flash("error", t("noWorkspacesCreate"));
    				reload();
    				return;
    			}
    			const created = body?.created !== false;
    			try {
    				await workspaces.create({ path: workerPath });
    				const createdLabel = workerIdentityLabel(body?.worker ?? {
    					id: value,
    					name: displayName
    				});
    				flash("success", `${created ? t("created") : t("createExisting")} ${createdLabel}`);
    			} catch (failure) {
    				flash("error", `${t("createMountFailed")} ${messageOf$1(failure)}`);
    			}
    			reload();
    		} catch (failure) {
    			setCreateError(`${t("createFailed")} ${failureText(t, failure)}`);
    		} finally {
    			setCreating(false);
    		}
    	}
    	/** 空的删除弹窗状态。 */
    	function emptyDeleteDialog() {
    		return {
    			target: null,
    			impact: null,
    			loading: false,
    			error: null,
    			saving: false
    		};
    	}
    	/**
    	* 读一次删除影响面；同一时刻只保留最后一次打开的执行者。
    	*
    	*/
    	async function loadDeleteImpact(worker) {
    		try {
    			const impact = await requestJson(REMOVE_IMPACT_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({ id: worker.id })
    			});
    			setDeleteDialog((prev) => prev.target?.id === worker.id ? {
    				...prev,
    				impact,
    				loading: false
    			} : prev);
    		} catch (failure) {
    			setDeleteDialog((prev) => prev.target?.id === worker.id ? {
    				...prev,
    				loading: false,
    				error: `${t("deleteImpactFailed")} ${failureText(t, failure)}`
    			} : prev);
    		}
    	}
    	/**
    	* 打开一个引用了该执行者的运行中作业。
    	*
    	* 只写 hash：首页按 hash 切到「工作流」页签，工作流页再按 hash 打开具体
    	* 作业（同一个面板里没有别的面板需要先切换）。
    	*
    	*/
    	function openJob(job) {
    		if (typeof window !== "undefined") {
    			const workflowId = encodeURIComponent(job.workflowId);
    			const jobId = encodeURIComponent(job.jobId);
    			window.location.hash = `#/job/${workflowId}/${jobId}/overview`;
    		}
    	}
    	/**
    	* 打开删除确认弹窗：先拉影响面，列出阻塞的作业、会变成不可用的工作流、
    	* 历史作业数量与将被删除的目录。删除是硬删，目录里的 AGENTS.md 与项目
    	* skills 会一起消失（弹窗文案会写明）。
    	*
    	*/
    	async function openDeleteDialog(worker) {
    		if (isRobotWorker(worker)) {
    			flash("error", t("robotReadOnly"));
    			return;
    		}
    		setDeleteDialog({
    			target: worker,
    			impact: null,
    			loading: true,
    			error: null,
    			saving: false
    		});
    		await loadDeleteImpact(worker);
    	}
    	/** 关闭删除弹窗；提交中不响应关闭。 */
    	function closeDeleteDialog() {
    		setDeleteDialog((prev) => prev.saving ? prev : emptyDeleteDialog());
    	}
    	/**
    	* 确认删除：Host 在一个事务里删登记条目、执行者目录与工作区注册行。
    	* 有引用该标识符的运行中作业时 Host 返回 409 `worker-in-use`，这里刷新
    	* 影响面并保留弹窗，不提供强制删除。
    	*
    	*/
    	async function confirmDeleteWorker() {
    		const target = deleteDialog.target;
    		if (target === null || deleteDialog.saving) return;
    		if ((deleteDialog.impact?.blockers.runningJobs.length ?? 0) > 0) return;
    		setDeleteDialog((prev) => ({
    			...prev,
    			saving: true,
    			error: null
    		}));
    		try {
    			await requestJson(REMOVE_ROUTE, {
    				method: "POST",
    				body: JSON.stringify({ id: target.id })
    			});
    		} catch (failure) {
    			const blocked = errorCode(failure) === "worker-in-use";
    			setDeleteDialog((prev) => ({
    				...prev,
    				saving: false,
    				error: blocked ? t("deleteBlockedByJobs") : `${t("deleteFailed")} ${failureText(t, failure)}`
    			}));
    			if (blocked) await loadDeleteImpact(target);
    			reload();
    			return;
    		}
    		setDeleteDialog(emptyDeleteDialog());
    		if (selectedId === target.id) setSelectedId(null);
    		reload();
    		flash("success", `${t("deleted")} ${workerDisplayName(target)}`);
    	}
    	return {
    		openWorker,
    		revealWorker,
    		mountWorker,
    		openCreateDialog,
    		closeCreateDialog,
    		createWorker,
    		openJob,
    		openDeleteDialog,
    		closeDeleteDialog,
    		confirmDeleteWorker
    	};
    }
    // .build/workflows/client/workers/state.js
    /**
    * 「执行者」页面的全部 UI 状态与派生值。
    *
    * 页面只保存 UI 状态；执行者列表（登记表）来自 Host 的 `/buka-workers/list`。
    * 状态集中在 `useWorkersState` 里，视图与动作模块只读写它，不各自持有副本。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/state
    */
    /** 「文件」页签的初始状态。 */
    const EMPTY_FILES = {
    	workerId: null,
    	treeStatus: "idle",
    	tree: null,
    	truncated: false,
    	treeError: null,
    	selectedPath: "",
    	contentStatus: "idle",
    	content: null,
    	contentError: null
    };
    /** 深度优先找第一个文件；没有文件时返回空串。 */
    function firstFilePath(nodes) {
    	for (const node of nodes) {
    		if (node.kind === "file") return node.path;
    		const nested = firstFilePath(node.children ?? []);
    		if (nested !== "") return nested;
    	}
    	return "";
    }
    /** 按名字找文件（如根目录的 AGENTS.md）；没有时返回空串。 */
    function findFilePath(nodes, name) {
    	for (const node of nodes) {
    		if (node.kind === "file" && node.name === name) return node.path;
    		const nested = findFilePath(node.children ?? [], name);
    		if (nested !== "") return nested;
    	}
    	return "";
    }
    /** 默认打开 AGENTS.md；没有就退到第一个文件。 */
    function defaultFilePath(nodes) {
    	const agents = findFilePath(nodes, "AGENTS.md");
    	return agents === "" ? firstFilePath(nodes) : agents;
    }
    /**
    * 页面状态：列表、详情、各个对话框的草稿 / 失败提示，以及派生的 workers 等。
    *
    */
    function useWorkersState(props) {
    	const getService = typeof props.getService === "function" ? props.getService : () => null;
    	/** 列表请求：`data` 是成功的响应，`error` 是失败原因，`loading` 覆盖首载与刷新。 */
    	const [list, setList] = react.default.useState({
    		data: null,
    		error: null,
    		loading: true
    	});
    	const [reloadKey, setReloadKey] = react.default.useState(0);
    	/** 创建对话框里的标识符草稿（必填、创建后不可改）与可选展示名。 */
    	const [createId, setCreateId] = react.default.useState("");
    	const [createName, setCreateName] = react.default.useState("");
    	/** 创建对话框里的描述草稿；提交时随标识符一起写入登记表。 */
    	const [draftDescription, setDraftDescription] = react.default.useState("");
    	const [dialogOpen, setDialogOpen] = react.default.useState(false);
    	const [createError, setCreateError] = react.default.useState(null);
    	const [creating, setCreating] = react.default.useState(false);
    	/**
    	* 删除确认弹窗：先读影响面（阻塞作业 / 会变成不可用的工作流 / 历史作业数 /
    	* 将被删除的目录），确认按钮在 `saving` 或存在阻塞作业时禁用。
    	*/
    	const [deleteDialog, setDeleteDialog] = react.default.useState({
    		target: null,
    		impact: null,
    		loading: false,
    		error: null,
    		saving: false
    	});
    	const [busy, setBusy] = react.default.useState(null);
    	/**
    	* 头像状态：`draftAvatar` 是创建对话框 / 「更换头像」对话框里当前选中的
    	* 预设；`avatarTarget` 非空时「更换头像」对话框打开，值是执行者标识符。
    	*/
    	const [draftAvatar, setDraftAvatar] = react.default.useState(DEFAULT_AVATAR_ID);
    	const [avatarOpen, setAvatarOpen] = react.default.useState(false);
    	const [avatarTarget, setAvatarTarget] = react.default.useState(null);
    	const [avatarSaving, setAvatarSaving] = react.default.useState(false);
    	/** 「更换头像」对话框里的失败提示：请求失败时留在框里，不靠会被遮住的 Toast。 */
    	const [avatarError, setAvatarError] = react.default.useState(null);
    	/**
    	* 「描述」页签的草稿与保存状态；草稿在进入详情时从执行者当前描述初始化，
    	* 列表刷新不会覆盖用户正在编辑的内容。
    	*/
    	const [descriptionDraft, setDescriptionDraft] = react.default.useState("");
    	const [descriptionSaving, setDescriptionSaving] = react.default.useState(false);
    	const [descriptionError, setDescriptionError] = react.default.useState(null);
    	/**
    	* 「重命名执行者」对话框：`renameDraft` 是新展示名草稿，默认带出当前名称；
    	* 失败提示留在对话框里，提交中不响应关闭。
    	*/
    	const [renameOpen, setRenameOpen] = react.default.useState(false);
    	const [renameDraft, setRenameDraft] = react.default.useState("");
    	const [renameSaving, setRenameSaving] = react.default.useState(false);
    	const [renameError, setRenameError] = react.default.useState(null);
    	/**
    	* 「模型」页签：目录按需加载；`modelDraft` 为 null 表示跟随宿主默认模型，
    	* 保存失败留在页签里，不用会被滚走的 Toast。
    	*/
    	const [modelCatalog, setModelCatalog] = react.default.useState({
    		status: "idle",
    		data: null,
    		error: null
    	});
    	const [modelDraft, setModelDraft] = react.default.useState(null);
    	const [modelSaving, setModelSaving] = react.default.useState(false);
    	const [modelError, setModelError] = react.default.useState(null);
    	/** 详情页状态：`selectedId` 非空时显示配置视图，`tab` 是页签。 */
    	const [selectedId, setSelectedId] = react.default.useState(null);
    	const [tab, setTab] = react.default.useState("settings");
    	const [files, setFiles] = react.default.useState(EMPTY_FILES);
    	const [removing, setRemoving] = react.default.useState(null);
    	const [confirmingSkill, setConfirmingSkill] = react.default.useState(null);
    	const [skillError, setSkillError] = react.default.useState(null);
    	/**
    	* 「安装 skills」对话框的状态。
    	*
    	* - `candidates.status`：`idle` 还没读 / `loading` 读取中 / `ready` 有清单 /
    	*   `error` 读取失败（带命令输出）；
    	* - `installSelected`：勾选的 skill 名；每次读出清单时默认全选未安装的；
    	* - `favourites.status`：`unavailable` 表示 Skills 插件没安装（整块隐藏，
    	*   不是错误），`ready` 时 `repos` 是收藏仓库。
    	*/
    	const [installOpen, setInstallOpen] = react.default.useState(false);
    	const [installSource, setInstallSource] = react.default.useState("");
    	const [installCandidates, setInstallCandidates] = react.default.useState({
    		status: "idle",
    		skills: [],
    		installed: [],
    		error: null,
    		output: ""
    	});
    	const [installSelected, setInstallSelected] = react.default.useState([]);
    	const [installError, setInstallError] = react.default.useState(null);
    	const [installing, setInstalling] = react.default.useState(false);
    	const [favourites, setFavourites] = react.default.useState({
    		status: "idle",
    		repos: []
    	});
    	/** Toast 文案；同一时刻只保留最后一条。 */
    	const [notice, setNotice] = react.default.useState(null);
    	const [updatingSkills, setUpdatingSkills] = react.default.useState(false);
    	const [updatingAllSkills, setUpdatingAllSkills] = react.default.useState(false);
    	react.default.useEffect(() => {
    		let cancelled = false;
    		setList((prev) => ({
    			...prev,
    			loading: true,
    			error: null
    		}));
    		requestJson(LIST_ROUTE).then((body) => {
    			if (!cancelled) setList({
    				data: body,
    				error: null,
    				loading: false
    			});
    		}, (failure) => {
    			if (!cancelled) setList((prev) => ({
    				...prev,
    				error: messageOf$1(failure),
    				loading: false
    			}));
    		});
    		return () => {
    			cancelled = true;
    		};
    	}, [reloadKey]);
    	const data = list.data;
    	const workers = Array.isArray(data?.workers) ? data.workers : [];
    	const registry = typeof data?.registry === "string" ? data.registry : "";
    	const corrupt = data?.corrupt === true;
    	const selectedWorker = selectedId === null ? null : workers.find((worker) => worker.id === selectedId) ?? null;
    	/** 任意写操作进行中：按钮据此统一禁用，避免并发请求互相覆盖。 */
    	const mutating = creating || busy !== null || installing || updatingSkills || updatingAllSkills || removing !== null || avatarSaving || descriptionSaving || renameSaving || modelSaving || deleteDialog.saving;
    	/**
    	* 新建执行者时的默认头像：按预设顺序挑第一个还没被占用的，避免刚建的一批
    	* 执行者全是一个样子（Host 也会在没传头像时做同样的分配）。
    	*
    	*/
    	function nextAvatarId() {
    		const used = new Set(workers.map((worker) => avatarPreset(worker.avatar).id));
    		return (AVATARS.find((preset) => !used.has(preset.id)) ?? AVATARS[0]).id;
    	}
    	react.default.useEffect(() => {
    		if (data === null || selectedId === null) return;
    		if (!workers.some((worker) => worker.id === selectedId)) setSelectedId(null);
    	}, [data, selectedId]);
    	/**
    	* 用 Toast 显示一次操作结果；同一时刻只保留最后一条。
    	*
    	*/
    	function flash(kind, text) {
    		setNotice({
    			kind,
    			text,
    			seq: Date.now() + Math.random()
    		});
    	}
    	/** 重新读一次执行者列表（新建 / 挂载 / 删除 / 安装 skill 之后都会调用）。 */
    	function reload() {
    		setReloadKey((key) => key + 1);
    	}
    	/**
    	* 按需读取模型目录：同一时间只发一个请求；`force` 用于目录刷新。
    	*
    	*/
    	function loadModelCatalog(force = false) {
    		if (!force && (modelCatalog.status === "loading" || modelCatalog.status === "ready")) return;
    		setModelCatalog((prev) => ({
    			status: "loading",
    			data: prev.data,
    			error: null
    		}));
    		requestJson(MODELS_ROUTE).then((body) => setModelCatalog({
    			status: "ready",
    			data: body,
    			error: null
    		}), (failure) => setModelCatalog((prev) => ({
    			status: "error",
    			data: prev.data,
    			error: messageOf$1(failure)
    		})));
    	}
    	/**
    	* 用 Host 的响应局部更新一个执行者，不整表刷新，避免详情页闪烁。
    	*
    	*/
    	function patchWorker(workerId, patch) {
    		setList((prev) => {
    			if (prev.data === null || !Array.isArray(prev.data.workers)) return prev;
    			return {
    				...prev,
    				data: {
    					...prev.data,
    					workers: prev.data.workers.map((worker) => worker.id === workerId ? {
    						...worker,
    						...patch
    					} : worker)
    				}
    			};
    		});
    	}
    	/**
    	* 取一个 DSH Client Service；插件上下文里不存在时返回 null，而不是抛错。
    	*
    	*/
    	function service(serviceName) {
    		try {
    			return getService(serviceName) ?? null;
    		} catch {
    			return null;
    		}
    	}
    	/**
    	* 读取一个执行者的目录树，并自动打开 AGENTS.md（没有就打开第一个文件）。
    	*
    	*/
    	function loadFiles(worker) {
    		const workerId = worker.id;
    		setFiles({
    			...EMPTY_FILES,
    			workerId,
    			treeStatus: "loading"
    		});
    		requestJson(`${FILES_ROUTE}?id=${encodeURIComponent(workerId)}`).then((body) => {
    			const tree = Array.isArray(body.nodes) ? body.nodes : [];
    			const selected = defaultFilePath(tree);
    			setFiles({
    				...EMPTY_FILES,
    				workerId,
    				treeStatus: "ready",
    				tree,
    				truncated: body.truncated === true,
    				selectedPath: selected,
    				...selected === "" ? {} : { contentStatus: "loading" }
    			});
    			if (selected !== "") loadFileContent(workerId, selected);
    		}, (failure) => {
    			setFiles((prev) => prev.workerId === workerId ? {
    				...prev,
    				treeStatus: "error",
    				tree: null,
    				treeError: messageOf$1(failure)
    			} : prev);
    		});
    	}
    	/**
    	* 读取一个文件的只读内容；同一执行者、同一路径的旧响应才不会覆盖新选择。
    	*
    	*/
    	function loadFileContent(workerId, relative) {
    		setFiles((prev) => prev.workerId === workerId ? {
    			...prev,
    			selectedPath: relative,
    			contentStatus: "loading",
    			content: null,
    			contentError: null
    		} : prev);
    		requestJson(`${FILE_ROUTE}?id=${encodeURIComponent(workerId)}&path=${encodeURIComponent(relative)}`).then((body) => {
    			setFiles((prev) => prev.workerId === workerId && prev.selectedPath === relative ? {
    				...prev,
    				contentStatus: "ready",
    				content: body,
    				contentError: null
    			} : prev);
    		}, (failure) => {
    			setFiles((prev) => prev.workerId === workerId && prev.selectedPath === relative ? {
    				...prev,
    				contentStatus: "error",
    				content: null,
    				contentError: messageOf$1(failure)
    			} : prev);
    		});
    	}
    	/** 打开目录树里的一个文件。 */
    	function openFile(worker, relative) {
    		loadFileContent(worker.id, relative);
    	}
    	/**
    	* 进入配置视图：清掉上一个执行者的临时状态，并预读「文件」页签的目录树。
    	*
    	*/
    	function openDetail(worker) {
    		if (worker.driver === "robot") return;
    		setSelectedId(worker.id);
    		setTab("settings");
    		setFiles(EMPTY_FILES);
    		loadModelCatalog();
    		loadFiles(worker);
    		setDescriptionDraft(typeof worker.description === "string" ? worker.description : "");
    		setDescriptionError(null);
    		setSkillError(null);
    		setConfirmingSkill(null);
    		setInstallOpen(false);
    		setInstallError(null);
    		setRenameOpen(false);
    		setRenameError(null);
    		setModelDraft(worker.model ?? null);
    		setModelError(null);
    		setNotice(null);
    	}
    	/** 返回列表页，并清掉详情页临时状态。 */
    	function backToList() {
    		setSelectedId(null);
    		setFiles(EMPTY_FILES);
    		setDescriptionError(null);
    		setSkillError(null);
    		setConfirmingSkill(null);
    		setInstallOpen(false);
    		setInstallError(null);
    		setRenameOpen(false);
    		setRenameError(null);
    		setModelError(null);
    		setNotice(null);
    	}
    	/**
    	* 切换详情页签；切换时收起 Toast，避免旧提示留在新页签上方。
    	*
    	*/
    	function switchTab(next) {
    		if (next === tab) return;
    		setNotice(null);
    		setTab(next);
    		if (next === "settings") loadModelCatalog();
    		if (next === "files" && selectedWorker !== null) loadFiles(selectedWorker);
    	}
    	return {
    		list,
    		setList,
    		reloadKey,
    		setReloadKey,
    		createId,
    		setCreateId,
    		createName,
    		setCreateName,
    		draftDescription,
    		setDraftDescription,
    		dialogOpen,
    		setDialogOpen,
    		createError,
    		setCreateError,
    		creating,
    		setCreating,
    		deleteDialog,
    		setDeleteDialog,
    		busy,
    		setBusy,
    		draftAvatar,
    		setDraftAvatar,
    		avatarOpen,
    		setAvatarOpen,
    		avatarTarget,
    		setAvatarTarget,
    		avatarSaving,
    		setAvatarSaving,
    		avatarError,
    		setAvatarError,
    		descriptionDraft,
    		setDescriptionDraft,
    		descriptionSaving,
    		setDescriptionSaving,
    		descriptionError,
    		setDescriptionError,
    		renameOpen,
    		setRenameOpen,
    		renameDraft,
    		setRenameDraft,
    		renameSaving,
    		setRenameSaving,
    		renameError,
    		setRenameError,
    		modelCatalog,
    		setModelCatalog,
    		modelDraft,
    		setModelDraft,
    		modelSaving,
    		setModelSaving,
    		modelError,
    		setModelError,
    		loadModelCatalog,
    		selectedId,
    		setSelectedId,
    		tab,
    		setTab,
    		files,
    		loadFiles,
    		openFile,
    		removing,
    		setRemoving,
    		confirmingSkill,
    		setConfirmingSkill,
    		skillError,
    		setSkillError,
    		installOpen,
    		setInstallOpen,
    		installSource,
    		setInstallSource,
    		installCandidates,
    		setInstallCandidates,
    		installSelected,
    		setInstallSelected,
    		installError,
    		setInstallError,
    		installing,
    		setInstalling,
    		updatingSkills,
    		setUpdatingSkills,
    		updatingAllSkills,
    		setUpdatingAllSkills,
    		favourites,
    		setFavourites,
    		notice,
    		setNotice,
    		data,
    		workers,
    		registry,
    		corrupt,
    		selectedWorker,
    		mutating,
    		nextAvatarId,
    		flash,
    		reload,
    		patchWorker,
    		service,
    		openDetail,
    		backToList,
    		switchTab
    	};
    }
    // .build/workflows/client/workers/components/install-dialog.js
    /**
    * 「安装 skills」对话框：来源输入 + 收藏仓库入口 + 候选勾选列表。
    *
    * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/install-dialog
    */
    /**
    * 对话框内容：来源输入 + 收藏仓库入口 + 候选勾选列表。
    * 默认勾选全部未安装的 skill；已安装的置灰不可选（设计契约）。
    *
    */
    function InstallDialog({ t, state, skillActions }) {
    	const { installCandidates, installSelected, favourites, installSource, setInstallSource, installing, installError } = state;
    	const { loadCandidates, toggleCandidate, selectAllCandidates } = skillActions;
    	const candidates = installCandidates;
    	const installed = new Set(candidates.installed);
    	const selectable = candidates.skills.filter((skill) => !installed.has(skill.name));
    	const allSelected = selectable.length > 0 && selectable.every((skill) => installSelected.includes(skill.name));
    	const favouritesBlock = favourites.status === "ready" ? favourites.repos.length === 0 ? h("p", { className: "buka-workers-fieldHint" }, t("favouritesEmpty")) : h("div", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("favouritesLabel")), h("div", { className: "buka-workers-favorites" }, ...favourites.repos.map((repo) => h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: repo.id,
    		variant: installSource === repo.source ? "primary" : "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		title: repo.note !== "" ? repo.note : repo.source,
    		disabled: installing || candidates.status === "loading",
    		onClick: () => loadCandidates(repo.source)
    	}, repo.source)))) : null;
    	return h("div", { className: "buka-workers-dialogForm" }, h("form", {
    		id: INSTALL_FORM_ID,
    		className: "buka-workers-field",
    		onSubmit: (event) => {
    			event.preventDefault();
    			loadCandidates();
    		}
    	}, h("label", {
    		className: "buka-workers-fieldLabel",
    		htmlFor: "buka-workers-install-source"
    	}, t("installSourceLabel")), h("div", { className: "buka-workers-sourceRow" }, h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		id: "buka-workers-install-source",
    		className: "buka-workers-input",
    		type: "text",
    		value: installSource,
    		placeholder: t("sourcePlaceholder"),
    		autoComplete: "off",
    		spellCheck: false,
    		disabled: installing,
    		"data-modal-autofocus": "",
    		onChange: (event) => setInstallSource(event.target.value)
    	}), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		type: "submit",
    		className: "buka-workers-submit",
    		icon: candidates.status === "loading" ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : void 0,
    		disabled: installing || candidates.status === "loading" || installSource.trim() === ""
    	}, candidates.status === "loading" ? t("loadingSkills") : t("loadSkills")))), favouritesBlock, candidates.status === "idle" ? h("p", { className: "buka-workers-fieldHint" }, t("installIdle")) : null, candidates.status === "loading" ? h("p", {
    		className: "buka-workers-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loadingSkills")) : null, candidates.status === "error" ? h("div", {
    		className: "buka-workers-alert",
    		role: "alert"
    	}, h("div", { className: "buka-workers-alertHead" }, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("errAvailableFailed")} ${candidates.error}`)), candidates.output === "" ? null : h(react.default.Fragment, null, h("span", { className: "buka-workers-outputLabel" }, t("outputLabel")), h("pre", { className: "buka-workers-output" }, candidates.output))) : null, candidates.status === "ready" ? h(react.default.Fragment, null, h("div", { className: "buka-workers-candidatesHead" }, h("span", { className: "buka-workers-fieldHint" }, `${String(t("skillsFound")).replace("{n}", String(candidates.skills.length))} · ${String(t("selectedSkills")).replace("{n}", String(installSelected.length)).replace("{m}", String(selectable.length))}`), selectable.length === 0 ? null : h("label", { className: "buka-workers-selectAll" }, h("input", {
    		type: "checkbox",
    		className: "buka-workers-candidateInput",
    		checked: allSelected,
    		disabled: installing,
    		onChange: (event) => selectAllCandidates(event.target.checked)
    	}), h("span", null, t("selectAllSkills")))), h("ul", { className: "buka-workers-candidates" }, ...candidates.skills.map((skill) => {
    		const isInstalled = installed.has(skill.name);
    		const checked = !isInstalled && installSelected.includes(skill.name);
    		return h("li", { key: skill.name }, h("label", {
    			className: `buka-workers-candidate${isInstalled ? " isDisabled" : ""}`,
    			title: typeof skill.description === "string" && skill.description !== "" ? skill.description : String(skill.name)
    		}, h("input", {
    			type: "checkbox",
    			className: "buka-workers-candidateInput",
    			checked,
    			disabled: isInstalled || installing,
    			onChange: () => toggleCandidate(skill.name)
    		}), h("span", { className: "buka-workers-candidateText" }, h("span", { className: "buka-workers-candidateName" }, String(skill.name)), typeof skill.description === "string" && skill.description !== "" ? h("span", { className: "buka-workers-candidateDesc" }, skill.description) : null), isInstalled ? h("span", { className: "buka-workers-candidateTag" }, h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, t("alreadyInstalled"))) : null));
    	})), installed.size === 0 ? null : h("p", { className: "buka-workers-fieldHint" }, t("installedHint"))) : null, installError === null ? null : h("div", {
    		className: "buka-workers-alert",
    		role: "alert"
    	}, h("div", { className: "buka-workers-alertHead" }, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("skillErrorTitle")} ${installError.message}`)), typeof installError.output === "string" && installError.output !== "" ? h(react.default.Fragment, null, h("span", { className: "buka-workers-outputLabel" }, t("outputLabel")), h("pre", { className: "buka-workers-output" }, installError.output)) : null));
    }
    /**
    * 「安装 skills」对话框的 Modal 外壳。
    *
    */
    function InstallSkillsModal({ t, state, skillActions }) {
    	const { installOpen, selectedWorker, installSelected, installing } = state;
    	const { closeInstallDialog, installSelectedSkills } = skillActions;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: installOpen,
    		onClose: closeInstallDialog,
    		title: t("installDialogTitle"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeInstallDialog,
    			disabled: installing
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "button",
    			disabled: installing || installSelected.length === 0,
    			onClick: installSelectedSkills
    		}, installing ? String(t("installingSkills")).replace("{n}", String(installSelected.length)) : installSelected.length > 0 ? String(t("installSelectedCount")).replace("{n}", String(installSelected.length)) : t("installSelected")))
    	}, installOpen && selectedWorker !== null ? h(InstallDialog, {
    		t,
    		state,
    		skillActions
    	}) : null);
    }
    // .build/workflows/client/workers/components/common.js
    /**
    * 「执行者」页面共用的小组件：头像选择器与挂载状态标签。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/common
    */
    /**
    * 预设头像选择器：圆形 emoji 按钮的网格，选中项有描边。创建对话框与
    * 「更换头像」对话框共用；`disabled` 时整组不可点。
    *
    */
    function AvatarPicker({ t, current, disabled, onSelect }) {
    	return h("div", {
    		className: "buka-workers-avatarGrid",
    		role: "radiogroup",
    		"aria-label": t("chooseAvatar")
    	}, ...AVATARS.map((preset) => h("button", {
    		key: preset.id,
    		type: "button",
    		role: "radio",
    		"aria-checked": preset.id === current,
    		"aria-label": t(preset.labelKey),
    		title: t(preset.labelKey),
    		className: `buka-workers-avatarOption${preset.id === current ? " is-selected" : ""}`,
    		disabled,
    		onClick: () => onSelect(preset.id)
    	}, renderAvatar(preset.id, 30))));
    }
    /**
    * 挂载状态标签：已挂载用 success，未挂载用 neutral。
    *
    */
    function MountedTag({ t, worker }) {
    	return h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: worker.mounted === true ? "success" : "neutral" }, worker.mounted === true ? t("mountedBadge") : t("unmountedBadge"));
    }
    // .build/workflows/client/workers/components/page-header.js
    /**
    * 「执行者」页面标题行：返回 / 头像 / 标题 / 重命名、工具栏与详情页签。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/page-header
    */
    /**
    * 渲染标题行、工具栏与详情页签。
    *
    */
    function PageHeader({ t, state, actions, detail, skillActions, topTabs }) {
    	const { selectedWorker, mutating, corrupt, list, busy, tab, reload, switchTab, backToList, updatingAllSkills } = state;
    	const { openCreateDialog, openWorker, revealWorker } = actions;
    	const { updateAllWorkers } = skillActions;
    	const { openAvatarDialog, openRenameDialog } = detail;
    	const robot = selectedWorker?.driver === "robot";
    	const refreshButton = h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: t("refresh"),
    		side: "bottom",
    		delayMs: 500,
    		disabled: list.loading
    	}, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		"aria-label": t("refresh"),
    		"aria-busy": list.loading,
    		disabled: list.loading || mutating,
    		icon: list.loading ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		onClick: reload
    	}, t("refresh")));
    	const updateAllButton = selectedWorker === null ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: updatingAllSkills ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		disabled: mutating || corrupt || updatingAllSkills,
    		onClick: () => updateAllWorkers()
    	}, updatingAllSkills ? t("updatingAllWorkers") : t("updateAllWorkers")) : null;
    	const createButton = selectedWorker === null ? h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
    		"aria-label": t("create"),
    		disabled: mutating || corrupt,
    		onClick: openCreateDialog
    	}, t("create")) : null;
    	const detailActions = selectedWorker === null || robot ? null : [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "open",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    		disabled: mutating,
    		"aria-label": `${t("newSession")} ${workerDisplayName(selectedWorker)}`,
    		onClick: () => openWorker(selectedWorker)
    	}, t("newSession")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		key: "reveal",
    		variant: "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: busy === `reveal:${selectedWorker.id}` ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: 13 }),
    		disabled: mutating || selectedWorker.exists === false,
    		"aria-label": `${t("reveal")} ${workerDisplayName(selectedWorker)}`,
    		onClick: () => revealWorker(selectedWorker)
    	}, t("reveal"))];
    	return h("div", { className: "buka-workers-head" }, h("div", { className: "buka-workers-headInner" }, h("div", { className: "buka-workers-bar" }, h("div", { className: "buka-workers-barTabs" }, topTabs), h("div", { className: "buka-workers-toolbar" }, detailActions, updateAllButton, refreshButton, createButton)), selectedWorker === null ? null : h("div", { className: "buka-workers-titleRow" }, h("div", { className: "buka-workers-heading" }, h("div", { className: "buka-workers-headingRow" }, selectedWorker === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: t("back"),
    		side: "top",
    		delayMs: 400
    	}, h("button", {
    		type: "button",
    		className: "buka-workers-iconButton buka-workers-back buka-workers-backButton",
    		"aria-label": t("back"),
    		disabled: mutating,
    		onClick: backToList
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 16 }))), selectedWorker === null || robot ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: t("changeAvatar"),
    		side: "top",
    		delayMs: 400
    	}, h("button", {
    		type: "button",
    		className: "buka-workers-avatarButton",
    		"aria-label": `${t("changeAvatar")} ${workerDisplayName(selectedWorker)}`,
    		disabled: mutating,
    		onClick: () => openAvatarDialog(selectedWorker)
    	}, renderAvatar(selectedWorker.avatar, 32))), h("h1", { className: "buka-workers-title" }, selectedWorker === null ? t("title") : workerIdentityLabel(selectedWorker)), selectedWorker === null || robot ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
    		label: `${t("renameLabel")} ${workerDisplayName(selectedWorker)}`,
    		side: "top",
    		delayMs: 400
    	}, h("button", {
    		type: "button",
    		className: "buka-workers-iconButton",
    		"aria-label": `${t("renameLabel")} ${workerDisplayName(selectedWorker)}`,
    		disabled: mutating || corrupt,
    		onClick: openRenameDialog
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 16 }))), selectedWorker === null ? null : h("span", { className: "buka-workers-headingTag" }, robot ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "info" }, t("driverRobot")) : h(MountedTag, {
    		t,
    		worker: selectedWorker
    	})))), h("div", { className: "buka-workers-tabs" }, h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workers-tabList",
    		label: t("tabsLabel"),
    		value: tab,
    		onChange: switchTab,
    		items: [
    			{
    				value: TABS[0].value,
    				label: h(TabLabel, { text: t("tabSettings") }),
    				id: TABS[0].id,
    				panelId: TABS[0].panelId
    			},
    			{
    				value: TABS[1].value,
    				label: h(TabLabel, { text: t("tabFiles") }),
    				id: TABS[1].id,
    				panelId: TABS[1].panelId
    			},
    			{
    				value: TABS[2].value,
    				label: h(TabLabel, { text: t("tabSkills") }),
    				id: TABS[2].id,
    				panelId: TABS[2].panelId
    			}
    		]
    	})))));
    }
    // .build/workflows/client/workers/components/worker-detail.js
    /**
    * 「执行者」详情页：职责、模型、文件与 skills 四个页签。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/worker-detail
    */
    /**
    * 技能区块：来源输入 + 安装按钮、失败输出、已安装列表与移除确认。
    *
    */
    function SkillsSection({ t, worker, state, skillActions }) {
    	const { mutating, confirmingSkill, removing, skillError, setConfirmingSkill, corrupt, updatingSkills } = state;
    	const { removeSkill, openInstallDialog, updateWorkerSkills } = skillActions;
    	const skills = skillsOf(worker);
    	const anyBusy = mutating;
    	const rows = skills.map((skill, index) => {
    		const confirmingThis = confirmingSkill === skill.name;
    		const actions = removing === skill.name ? h("span", { className: "buka-workers-statusWithDot" }, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}), t("removing")) : confirmingThis ? [h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "confirm",
    			variant: "outline",
    			size: "sm",
    			className: "buka-workers-danger",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			onClick: () => removeSkill(worker, skill)
    		}, t("confirmRemoveSkill")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "cancel",
    			variant: "ghost",
    			size: "sm",
    			disabled: anyBusy,
    			onClick: () => setConfirmingSkill(null)
    		}, t("cancel"))] : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			size: "sm",
    			className: "buka-workers-danger",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			"aria-label": `${t("removeSkill")} ${skill.name}`,
    			onClick: () => setConfirmingSkill(skill.name)
    		}, t("removeSkill"));
    		return h("li", {
    			className: "buka-workers-skillRow",
    			key: `${String(skill.name)}:${index}`
    		}, h("div", { className: "buka-workers-skillHead" }, h("span", { className: "buka-workers-skillName" }, String(skill.name)), typeof skill.source === "string" && skill.source !== "" ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, {
    			tone: "info",
    			className: "buka-workers-skillSource"
    		}, skill.source) : null, h("span", { className: "buka-workers-skillActions" }, ...Array.isArray(actions) ? actions : [actions])), typeof skill.description === "string" && skill.description !== "" ? h("div", {
    			className: "buka-workers-skillDesc",
    			title: skill.description
    		}, skill.description) : null);
    	});
    	return h("section", {
    		className: "buka-workers-section",
    		"aria-busy": anyBusy ? true : void 0
    	}, h("div", { className: "buka-workers-sectionHead" }, h("h2", { className: "buka-workers-sectionTitle" }, t("skillsTitle")), h("div", { className: "buka-workers-sectionActions" }, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: updatingSkills ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		disabled: mutating || corrupt || worker.exists === false || skills.length === 0,
    		onClick: () => updateWorkerSkills(worker)
    	}, updatingSkills ? t("updatingSkills") : t("updateSkills")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: h(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
    		disabled: mutating || corrupt || worker.exists === false,
    		onClick: openInstallDialog
    	}, t("installSkills")))), h("p", { className: "buka-workers-intro" }, t("skillsIntroBefore"), h("code", { className: "buka-workers-inlineCode" }, "npx skills add <source>"), t("skillsIntroMiddle"), h("code", { className: "buka-workers-inlineCode" }, ".agents/skills"), t("skillsIntroAfter")), skillError === null ? null : h("div", {
    		className: "buka-workers-alert",
    		role: "alert"
    	}, h("div", { className: "buka-workers-alertHead" }, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, `${t("skillErrorTitle")} ${skillError.message}`)), typeof skillError.output === "string" && skillError.output !== "" ? h(react.default.Fragment, null, h("span", { className: "buka-workers-outputLabel" }, t("outputLabel")), h("pre", { className: "buka-workers-output" }, skillError.output)) : null), skills.length === 0 ? h("p", { className: "buka-workers-empty" }, t("skillsEmpty")) : h("ul", { className: "buka-workers-skillList" }, ...rows));
    }
    /** 文件预览最多渲染的行数；更长的文件只显示前这么多行。 */
    const FILE_PREVIEW_MAX_LINES = 2e3;
    /** 按行拆分文件内容，兼容 CRLF；末尾换行不额外算一行。 */
    function contentLines(text) {
    	const lines = text.replace(/\r\n?/gu, "\n").split("\n");
    	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    	return lines;
    }
    /** 文件大小的人读写法。 */
    function formatFileSize(bytes) {
    	if (!Number.isFinite(bytes) || bytes < 0) return "";
    	if (bytes < 1024) return `${bytes} B`;
    	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
    	return `${(bytes / 1048576).toFixed(1)} MiB`;
    }
    /** `ReadBlock` 的本地化 chrome；占位符用简单替换，避免把 `t` 的签名放宽。 */
    function readBlockLabels(t) {
    	return {
    		codeLabel: t("filesCode"),
    		wrapLabel: t("filesWrap"),
    		unwrapLabel: t("filesUnwrap"),
    		copy: t("filesCopy"),
    		copied: t("filesCopied"),
    		window: (shown, total) => t("filesWindow").replace("{shown}", String(shown)).replace("{total}", String(total)),
    		collapseAria: t("filesCollapseAria"),
    		expandAria: (hidden) => t("filesExpandAria").replace("{n}", String(hidden)),
    		collapse: t("filesCollapse"),
    		expand: t("filesExpand")
    	};
    }
    /**
    * 目录树里的一个节点：目录用原生 `<details>` 折叠（不需要 React 状态），
    * 文件是可点选的只读按钮。
    *
    */
    function FileTreeNode({ node, selectedPath, onOpen, depth = 0 }) {
    	const indent = { paddingLeft: `${depth * 12 + 8}px` };
    	if (node.kind === "directory") return h("li", { className: "buka-workers-fileTreeItem" }, h("details", { className: "buka-workers-fileTreeDir" }, h("summary", {
    		className: "buka-workers-fileTreeSummary",
    		style: indent
    	}, h(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
    		kind: "folder",
    		size: 14
    	}), h("span", { className: "buka-workers-fileTreeName" }, node.name)), node.children === void 0 || node.children.length === 0 ? null : h("ul", { className: "buka-workers-fileTreeList" }, ...node.children.map((child) => h(FileTreeNode, {
    		key: child.path,
    		node: child,
    		selectedPath,
    		onOpen,
    		depth: depth + 1
    	})))));
    	return h("li", { className: "buka-workers-fileTreeItem" }, h("button", {
    		type: "button",
    		className: `buka-workers-fileTreeFile${node.path === selectedPath ? " is-selected" : ""}`,
    		style: indent,
    		title: node.path,
    		"aria-pressed": node.path === selectedPath,
    		onClick: () => onOpen(node.path)
    	}, h(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
    		path: node.name,
    		size: 14
    	}), h("span", { className: "buka-workers-fileTreeName" }, node.name)));
    }
    /**
    * 右侧只读预览：加载 / 失败 / 过大 / 二进制 / 代码内容。
    *
    */
    function FilePreview({ t, state }) {
    	const { files } = state;
    	const content = files.content;
    	if (files.selectedPath === "") return h("div", { className: "buka-workers-filePreview" }, h("p", { className: "buka-workers-empty" }, t("filesSelectFile")));
    	if (files.contentStatus === "loading" || files.contentStatus === "idle") return h("div", {
    		className: "buka-workers-filePreview",
    		role: "status"
    	}, h("p", { className: "buka-workers-statusWithDot" }, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")));
    	if (files.contentStatus === "error") return h("div", { className: "buka-workers-filePreview" }, h("p", {
    		className: "buka-workers-failure",
    		role: "alert"
    	}, `${t("filesReadFailed")} ${files.contentError ?? ""}`));
    	if (content === null) return h("div", { className: "buka-workers-filePreview" }, h("p", { className: "buka-workers-empty" }, t("filesSelectFile")));
    	const meta = h("div", { className: "buka-workers-filePreviewHead" }, h("span", { className: "buka-workers-filePreviewPath" }, content.path), h("span", { className: "buka-workers-filePreviewMeta" }, formatFileSize(content.bytes)));
    	if (content.tooLarge) return h("div", { className: "buka-workers-filePreview" }, meta, h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("filesTooLarge").replace("{n}", formatFileSize(content.bytes)))));
    	if (content.binary) return h("div", { className: "buka-workers-filePreview" }, meta, h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("filesBinary"))));
    	const lines = contentLines(content.content);
    	const shown = lines.slice(0, FILE_PREVIEW_MAX_LINES);
    	return h("div", { className: "buka-workers-filePreview" }, meta, lines.length > shown.length ? h("p", { className: "buka-workers-fieldHint" }, t("filesLinesTruncated").replace("{n}", String(shown.length))) : null, shown.length === 0 ? h("p", { className: "buka-workers-empty" }, t("filesEmptyFile")) : h(_deepseek_ai_dsh_client_ui_primitives.ReadBlock, {
    		label: content.path,
    		lines: shown.map((text, index) => ({
    			number: index + 1,
    			text
    		})),
    		totalLines: shown.length,
    		maxLines: shown.length,
    		lang: (0, _deepseek_ai_dsh_client_ui_primitives.languageForPath)(content.path) || void 0,
    		labels: readBlockLabels(t),
    		className: "buka-workers-fileCode"
    	}));
    }
    /**
    * 「文件」页签：左侧执行者目录树，右侧只读代码内容。
    *
    * 页面不提供编辑 / 保存入口；写入仍由 builder 工具完成。
    *
    */
    function FilesSection({ t, worker, state }) {
    	const { files, loadFiles, openFile } = state;
    	const tree = files.tree ?? [];
    	const loading = files.treeStatus === "loading" || files.treeStatus === "idle";
    	const onOpen = (path) => openFile(worker, path);
    	return h("section", {
    		className: "buka-workers-section buka-workers-filesSection",
    		"aria-busy": loading ? true : void 0
    	}, h("div", { className: "buka-workers-sectionHead" }, h("div", { className: "buka-workers-filesHeading" }, h("h2", { className: "buka-workers-sectionTitle" }, t("filesTitle")), h("p", { className: "buka-workers-fieldHint" }, t("filesHint"))), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		size: "sm",
    		className: "buka-workers-toolbarButton",
    		icon: loading ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    			state: "ongoing",
    			size: 13
    		}) : h(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }),
    		disabled: loading,
    		onClick: () => loadFiles(worker)
    	}, t("refresh"))), worker.exists === false ? h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("missingDirDetail"))) : null, files.treeStatus === "error" ? h("p", {
    		className: "buka-workers-failure",
    		role: "alert"
    	}, `${t("filesLoadFailed")} ${files.treeError ?? ""}`) : files.treeStatus === "ready" && tree.length === 0 ? h("p", { className: "buka-workers-empty" }, t("filesEmpty")) : h("div", { className: "buka-workers-filesLayout" }, h("div", {
    		className: "buka-workers-fileTree",
    		role: "group",
    		"aria-label": t("filesTreeAria")
    	}, files.truncated ? h("p", { className: "buka-workers-fieldHint" }, t("filesTruncated")) : null, loading && files.tree === null ? h("p", {
    		className: "buka-workers-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")) : h("ul", { className: "buka-workers-fileTreeList" }, ...tree.map((node) => h(FileTreeNode, {
    		key: node.path,
    		node,
    		selectedPath: files.selectedPath,
    		onOpen
    	})))), h(FilePreview, {
    		t,
    		state
    	})));
    }
    /**
    * 「设置」页签：把职责与模型收在同一个页面里。
    *
    * 两块各自保留自己的保存按钮：职责写登记表的 `description`，模型写新会话的
    * 模型选择，失败的提示也各自留在自己的区块里；进入页签时会预读模型目录。
    *
    */
    function SettingsSection({ t, worker, state, detailActions }) {
    	return h("div", { className: "buka-workers-settings" }, h(DescriptionSection, {
    		t,
    		worker,
    		state,
    		detailActions
    	}), h(ModelSection, {
    		t,
    		worker,
    		state,
    		detailActions
    	}));
    }
    /**
    * 「描述」页签：一句话摘要 + 保存按钮。工作流通过 `buka_workers` 读这一行，
    * 决定是否把节点交给这个执行者；没有改动时保存按钮不可用。
    *
    */
    function DescriptionSection({ t, worker, state, detailActions }) {
    	const { descriptionDraft, setDescriptionDraft, descriptionSaving, descriptionError, mutating } = state;
    	const { normalizedDescription, saveDescription } = detailActions;
    	const current = typeof worker.description === "string" ? worker.description : "";
    	const dirty = normalizedDescription(descriptionDraft) !== current;
    	return h("section", {
    		className: "buka-workers-section",
    		"aria-busy": descriptionSaving ? true : void 0
    	}, h("div", { className: "buka-workers-sectionHead" }, h("h2", { className: "buka-workers-sectionTitle" }, t("descriptionLabel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		size: "sm",
    		type: "button",
    		className: "buka-workers-submit",
    		disabled: !dirty || mutating,
    		onClick: saveDescription
    	}, descriptionSaving ? t("saving") : t("save"))), h("p", { className: "buka-workers-fieldHint" }, t("descriptionHint")), h("textarea", {
    		className: "buka-workers-descriptionInput is-tall",
    		value: descriptionDraft,
    		placeholder: t("descriptionPlaceholder"),
    		maxLength: 500,
    		rows: 4,
    		disabled: descriptionSaving,
    		"aria-label": t("descriptionLabel"),
    		onChange: (event) => setDescriptionDraft(event.target.value)
    	}), descriptionError === null ? null : h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, descriptionError));
    }
    /**
    * 「模型」页签：给智能体选新会话使用的模型。
    *
    * 目录按需从 Host 读取；`modelDraft === null` 表示跟随宿主默认模型。保存后只影响
    * 之后新开的会话，已有会话保留自己的模型（可在会话里用 `/model` 切换）。
    *
    */
    function ModelSection({ t, worker, state, detailActions }) {
    	const { modelCatalog, modelDraft, setModelDraft, modelSaving, modelError, loadModelCatalog } = state;
    	const { saveWorkerModel } = detailActions;
    	const catalog = modelCatalog.data;
    	const available = catalog?.available === true;
    	const groups = catalog?.groups ?? [];
    	const currentGroup = modelDraft === null ? void 0 : groups.find((group) => group.id === modelDraft.provider);
    	const currentModel = modelDraft === null || currentGroup === void 0 ? void 0 : currentGroup.models.find((model) => model.id === modelDraft.model);
    	const savedEffort = modelDraft?.reasoningEffort;
    	const efforts = currentModel?.reasoning?.efforts ?? [];
    	const effortKnown = savedEffort === void 0 || efforts.some((effort) => effort.id === savedEffort);
    	const showEffort = efforts.length > 0 || savedEffort !== void 0;
    	const savedSelection = worker.model ?? null;
    	const dirty = modelDraft === null || savedSelection === null ? modelDraft !== savedSelection : modelDraft.provider !== savedSelection.provider || modelDraft.model !== savedSelection.model || (modelDraft.reasoningEffort ?? "") !== (savedSelection.reasoningEffort ?? "");
    	/** 模型选择的展示名：目录里有就用名称，否则退回 provider / model id。 */
    	function labelFor(selection) {
    		const group = groups.find((entry) => entry.id === selection.provider);
    		const model = group?.models.find((entry) => entry.id === selection.model);
    		return model === void 0 || group === void 0 ? `${selection.provider} / ${selection.model}` : `${group.name} · ${model.name}`;
    	}
    	function pickProvider(providerId) {
    		if (providerId === "") {
    			setModelDraft(null);
    			return;
    		}
    		const first = groups.find((entry) => entry.id === providerId)?.models[0];
    		setModelDraft({
    			provider: providerId,
    			model: first?.id ?? ""
    		});
    	}
    	function pickModel(modelId) {
    		if (modelDraft === null) return;
    		setModelDraft({
    			provider: modelDraft.provider,
    			model: modelId
    		});
    	}
    	function pickEffort(effortId) {
    		if (modelDraft === null) return;
    		setModelDraft({
    			provider: modelDraft.provider,
    			model: modelDraft.model,
    			...effortId === "" ? {} : { reasoningEffort: effortId }
    		});
    	}
    	const providerOptions = [h("option", {
    		key: "default",
    		value: ""
    	}, t("modelFollowDefault")), ...groups.map((group) => h("option", {
    		key: group.id,
    		value: group.id
    	}, group.name))];
    	if (modelDraft !== null && currentGroup === void 0) providerOptions.push(h("option", {
    		key: `saved:${modelDraft.provider}`,
    		value: modelDraft.provider
    	}, `${modelDraft.provider} / ${modelDraft.model}`));
    	const modelOptions = modelDraft === null || currentGroup === void 0 ? [] : [...currentGroup.models.map((model) => h("option", {
    		key: model.id,
    		value: model.id
    	}, model.name))];
    	if (modelDraft !== null && currentModel === void 0) modelOptions.push(h("option", {
    		key: `saved:${modelDraft.model}`,
    		value: modelDraft.model
    	}, modelDraft.model));
    	const effortOptions = [h("option", {
    		key: "default",
    		value: ""
    	}, t("modelEffortDefault")), ...efforts.map((effort) => h("option", {
    		key: effort.id,
    		value: effort.id
    	}, effort.name))];
    	if (modelDraft !== null && savedEffort !== void 0 && !effortKnown) effortOptions.push(h("option", {
    		key: `saved:${savedEffort}`,
    		value: savedEffort
    	}, savedEffort));
    	return h("section", { className: "buka-workers-modelSection" }, h("h2", { className: "buka-workers-sectionTitle" }, t("modelTitle")), h("p", { className: "buka-workers-fieldHint" }, t("modelHint")), modelCatalog.status === "loading" && catalog === null ? h("p", {
    		className: "buka-workers-fieldHint",
    		role: "status"
    	}, t("loading")) : null, modelCatalog.status === "error" ? h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, `${t("modelLoadFailed")} ${modelCatalog.error ?? ""}`) : null, catalog !== null && !available ? h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, t("modelUnavailable")) : null, available && groups.length === 0 ? h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, t("modelEmpty")) : null, catalog !== null && catalog.failures.length > 0 ? h("p", { className: "buka-workers-hint" }, `${t("modelSomeFailed")} ${catalog.failures.map((failure) => failure.name).join("、")}`) : null, available ? [
    		h("label", {
    			key: "provider",
    			className: "buka-workers-field"
    		}, h("span", { className: "buka-workers-fieldLabel" }, t("modelProvider")), h("select", {
    			className: "buka-workers-select",
    			value: modelDraft?.provider ?? "",
    			"aria-label": t("modelProvider"),
    			disabled: modelSaving,
    			onChange: (event) => pickProvider(event.target.value)
    		}, ...providerOptions)),
    		modelDraft === null ? null : h("label", {
    			key: "model",
    			className: "buka-workers-field"
    		}, h("span", { className: "buka-workers-fieldLabel" }, t("modelModelLabel")), h("select", {
    			className: "buka-workers-select",
    			value: modelDraft.model,
    			"aria-label": t("modelModelLabel"),
    			disabled: modelSaving,
    			onChange: (event) => pickModel(event.target.value)
    		}, ...modelOptions)),
    		modelDraft === null || !showEffort ? null : h("label", {
    			key: "effort",
    			className: "buka-workers-field"
    		}, h("span", { className: "buka-workers-fieldLabel" }, t("modelEffort")), h("select", {
    			className: "buka-workers-select",
    			value: savedEffort ?? "",
    			"aria-label": t("modelEffort"),
    			disabled: modelSaving,
    			onChange: (event) => pickEffort(event.target.value)
    		}, ...effortOptions)),
    		h("p", {
    			key: "current",
    			className: "buka-workers-fieldHint"
    		}, modelDraft === null ? t("modelFollowDefaultHint") : `${t("modelCurrent")} ${labelFor(modelDraft)}`),
    		modelError === null ? null : h("p", {
    			key: "error",
    			className: "buka-workers-formError",
    			role: "alert"
    		}, modelError),
    		h("div", {
    			key: "save",
    			className: "buka-workers-formActions"
    		}, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			size: "sm",
    			disabled: !dirty || modelSaving,
    			onClick: () => void saveWorkerModel()
    		}, modelSaving ? t("saving") : t("save")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "ghost",
    			size: "sm",
    			disabled: modelSaving,
    			onClick: () => loadModelCatalog(true)
    		}, t("refresh")))
    	] : null);
    }
    /**
    * 配置视图：缺目录提示 + 页签面板（设置 / 文件 / 技能）。
    *
    */
    function WorkerDetail({ t, worker, state, detailActions, skillActions }) {
    	const { tab } = state;
    	const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0];
    	return h("div", { className: "buka-workers-pageBody buka-workers-detail" }, worker.exists === false ? h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("missingDirDetail"))) : null, h("div", {
    		className: "buka-workers-panel",
    		role: "tabpanel",
    		id: activeTab.panelId,
    		"aria-labelledby": activeTab.id
    	}, tab === "skills" ? h(SkillsSection, {
    		t,
    		worker,
    		state,
    		skillActions
    	}) : tab === "files" ? h(FilesSection, {
    		t,
    		worker,
    		state
    	}) : h(SettingsSection, {
    		t,
    		worker,
    		state,
    		detailActions
    	})));
    }
    // .build/workflows/client/workers/components/worker-dialogs.js
    /**
    * 「执行者」页面里的创建 / 更换头像 / 重命名对话框。
    *
    * 三个对话框都由页面状态控制 `open`，提交中不响应关闭；失败提示留在框里，
    * 避免被 Toast 遮住。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/worker-dialogs
    */
    /**
    * 创建执行者对话框。
    *
    */
    function CreateWorkerDialog({ t, state, actions }) {
    	const { dialogOpen, creating, createId, setCreateId, createName, setCreateName, workers, draftDescription, setDraftDescription, draftAvatar, setDraftAvatar, createError } = state;
    	const { createWorker, closeCreateDialog } = actions;
    	const idValue = createId.trim();
    	const idTaken = workers.some((worker) => worker.id === idValue);
    	const canCreate = isValidWorkerId(idValue) && !idTaken;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: dialogOpen,
    		onClose: closeCreateDialog,
    		title: t("create"),
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeCreateDialog,
    			disabled: creating
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "submit",
    			form: CREATE_FORM_ID,
    			disabled: creating || !canCreate
    		}, creating ? t("creating") : t("create")))
    	}, h("form", {
    		id: CREATE_FORM_ID,
    		className: "buka-workers-dialogForm",
    		onSubmit: createWorker
    	}, h("div", { className: "buka-workers-avatarField" }, h("span", { className: "buka-workers-fieldLabel" }, t("avatar")), h(AvatarPicker, {
    		t,
    		current: draftAvatar,
    		disabled: creating,
    		onSelect: setDraftAvatar
    	})), h("label", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("createFieldId")), h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		className: "buka-workers-fieldInput",
    		type: "text",
    		value: createId,
    		placeholder: t("createIdPlaceholder"),
    		autoComplete: "off",
    		spellCheck: false,
    		maxLength: 64,
    		disabled: creating,
    		"data-modal-autofocus": "",
    		onChange: (event) => setCreateId(event.target.value)
    	}), idValue !== "" && !isValidWorkerId(idValue) ? h("span", { className: "buka-workers-formError" }, t("errInvalidId")) : idTaken ? h("span", { className: "buka-workers-formError" }, t("errIdTaken")) : h("span", { className: "buka-workers-fieldHint" }, t("createIdHint"))), h("label", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("createFieldName")), h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		className: "buka-workers-fieldInput",
    		type: "text",
    		value: createName,
    		placeholder: t("createNamePlaceholder"),
    		autoComplete: "off",
    		spellCheck: false,
    		maxLength: 64,
    		disabled: creating,
    		onChange: (event) => setCreateName(event.target.value)
    	}), h("span", { className: "buka-workers-fieldHint" }, t("createNameHint"))), h("label", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("descriptionLabel")), h("textarea", {
    		className: "buka-workers-descriptionInput",
    		value: draftDescription,
    		placeholder: t("descriptionPlaceholder"),
    		maxLength: 500,
    		rows: 2,
    		disabled: creating,
    		onChange: (event) => setDraftDescription(event.target.value)
    	}), h("span", { className: "buka-workers-fieldHint" }, t("descriptionHint"))), createError === null ? null : h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, createError)));
    }
    /**
    * 更换头像对话框。
    *
    */
    function AvatarDialog({ t, state, detail }) {
    	const { avatarOpen, avatarSaving, avatarTarget, draftAvatar, setDraftAvatar, avatarError, selectedWorker } = state;
    	const { closeAvatarDialog, saveAvatar } = detail;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: avatarOpen,
    		onClose: closeAvatarDialog,
    		title: avatarTarget === null || selectedWorker === null ? t("changeAvatar") : `${t("changeAvatar")} · ${workerIdentityLabel(selectedWorker)}`,
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeAvatarDialog,
    			disabled: avatarSaving
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "submit",
    			form: AVATAR_FORM_ID,
    			disabled: avatarSaving || avatarTarget === null
    		}, avatarSaving ? t("saving") : t("save")))
    	}, h("form", {
    		id: AVATAR_FORM_ID,
    		className: "buka-workers-dialogForm",
    		onSubmit: (event) => {
    			event.preventDefault();
    			saveAvatar();
    		}
    	}, h("div", { className: "buka-workers-avatarField" }, h("span", { className: "buka-workers-fieldLabel" }, t("chooseAvatar")), h(AvatarPicker, {
    		t,
    		current: draftAvatar,
    		disabled: avatarSaving,
    		onSelect: setDraftAvatar
    	})), avatarError === null ? null : h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, avatarError)));
    }
    /**
    * 重命名执行者对话框。
    *
    */
    function RenameDialog({ t, state, detail }) {
    	const { renameOpen, renameSaving, selectedWorker, renameDraft, setRenameDraft, renameError } = state;
    	const { closeRenameDialog, renameWorker } = detail;
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: renameOpen,
    		onClose: closeRenameDialog,
    		title: selectedWorker === null ? t("rename") : `${t("rename")} · ${workerIdentityLabel(selectedWorker)}`,
    		closeLabel: t("close"),
    		footer: h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "outline",
    			onClick: closeRenameDialog,
    			disabled: renameSaving
    		}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			variant: "primary",
    			type: "submit",
    			form: RENAME_FORM_ID,
    			disabled: renameSaving || selectedWorker === null || renameDraft.trim() === selectedWorker.name
    		}, renameSaving ? t("saving") : t("save")))
    	}, renameOpen && selectedWorker !== null ? h("form", {
    		id: RENAME_FORM_ID,
    		className: "buka-workers-dialogForm",
    		onSubmit: renameWorker
    	}, h("label", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("renameFieldLabel")), h(_deepseek_ai_dsh_client_ui_primitives.Input, {
    		className: "buka-workers-fieldInput",
    		type: "text",
    		value: renameDraft,
    		placeholder: String(selectedWorker.name ?? selectedWorker.id ?? ""),
    		autoComplete: "off",
    		spellCheck: false,
    		maxLength: 64,
    		disabled: renameSaving,
    		"data-modal-autofocus": "",
    		onChange: (event) => setRenameDraft(event.target.value)
    	})), h("p", { className: "buka-workers-fieldHint" }, t("renameHint")), renameError === null ? null : h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, renameError)) : null);
    }
    /**
    * 删除执行者确认弹窗。
    *
    * 删除是硬删：登记条目、执行者目录与工作区注册行一起消失，目录里的
    * AGENTS.md 与项目 skills 也会一起消失。弹窗先列出影响面（阻塞的作业、
    * 会变成不可用的工作流、历史作业数量、将被删除的目录）；存在引用该执行者的
    * 运行中作业时禁用确认，只能先去作业页主动终止它们。
    *
    */
    function DeleteWorkerDialog({ t, state, actions }) {
    	const { deleteDialog } = state;
    	const { closeDeleteDialog, confirmDeleteWorker, openJob } = actions;
    	const target = deleteDialog.target;
    	const impact = deleteDialog.impact;
    	const runningJobs = impact?.blockers.runningJobs ?? [];
    	const blocked = runningJobs.length > 0;
    	const workflows = impact?.workflows ?? [];
    	const footer = target === null ? null : h(react.default.Fragment, null, h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		onClick: closeDeleteDialog,
    		disabled: deleteDialog.saving
    	}, t("cancel")), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "primary",
    		className: "buka-workers-danger",
    		disabled: blocked || deleteDialog.saving || deleteDialog.loading,
    		onClick: () => void confirmDeleteWorker()
    	}, deleteDialog.saving ? t("deleting") : t("deleteConfirm")));
    	return h(_deepseek_ai_dsh_client_ui_primitives.Modal, {
    		open: target !== null,
    		onClose: closeDeleteDialog,
    		title: target === null ? t("deleteTitle") : `${t("deleteTitle")} · ${workerIdentityLabel(target)}`,
    		closeLabel: t("close"),
    		footer
    	}, target === null ? null : h("div", { className: "buka-workers-dialogForm" }, h("p", { className: "buka-workers-fieldHint" }, t("deleteHardDeleteNote")), deleteDialog.loading ? h("p", { className: "buka-workers-fieldHint" }, t("deleteImpactLoading")) : null, impact === null ? null : h(react.default.Fragment, null, h("p", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("deleteDir")), h("code", { className: "buka-workers-inlineCode" }, impact.path)), h("p", { className: "buka-workers-fieldHint" }, impact.mounted ? t("deleteMounted") : t("deleteNotMounted")), h("p", { className: "buka-workers-fieldHint" }, `${t("deleteFinishedJobs")} ${String(impact.finishedJobs)}`), h("div", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, `${t("deleteAffectedWorkflows")} ${String(workflows.length)}`), workflows.length === 0 ? h("span", { className: "buka-workers-fieldHint" }, t("deleteNoWorkflows")) : h("ul", { className: "buka-workers-plainList" }, ...workflows.map((workflow) => h("li", { key: workflow.workflowId }, `${workflow.name || workflow.workflowId} · ${workflowStatusText(t, workflow.status)}`)))), blocked ? h("div", { className: "buka-workers-field" }, h("span", { className: "buka-workers-fieldLabel" }, t("deleteBlockedTitle")), h("ul", { className: "buka-workers-plainList" }, ...runningJobs.map((job) => h("li", {
    		key: job.jobId,
    		className: "buka-workers-jobBlocker"
    	}, h("span", null, `${job.jobName || job.workflowName || job.workflowId} #${String(job.jobSeq)}`), h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    		variant: "outline",
    		onClick: () => openJob(job)
    	}, t("deleteOpenJob"))))), h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, t("deleteBlockedByJobs"))) : null), deleteDialog.error === null ? null : h("p", {
    		className: "buka-workers-formError",
    		role: "alert"
    	}, deleteDialog.error)));
    }
    // .build/workflows/client/workers/components/worker-list.js
    /**
    * 「执行者」列表：执行者卡片与列表状态。
    *
    * 列表不展示目录；每张卡片显示名称、驱动类型、skills / 挂载状态、
    * 一句职责与行内动作。整行点击进入详情，行内动作区自己挡住冒泡。
    *
    * 机器人（clock）只读：卡片展示驱动与职责，没有新会话 / 挂载 /
    * 删除入口，也不进入配置视图。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/worker-list
    */
    /**
    * 一条执行者卡片：名称、驱动 / skills / 挂载状态、职责与
    * 动作与删除确认。机器人只读。
    *
    */
    function WorkerCard({ t, worker, state, actions: workerActions }) {
    	const { busy, mutating, corrupt, openDetail } = state;
    	const { openWorker, mountWorker, openDeleteDialog } = workerActions;
    	const skills = skillsOf(worker);
    	const robot = isRobotWorker(worker);
    	const missing = !robot && worker.exists === false;
    	const mounted = worker.mounted === true;
    	const description = typeof worker.description === "string" ? worker.description.trim() : "";
    	const anyBusy = mutating || corrupt;
    	const canOpen = !mutating && !robot;
    	const actions = robot ? [] : [
    		h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "open",
    			variant: "outline",
    			size: "sm",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 13 }),
    			disabled: mutating,
    			"aria-label": `${t("newSession")} ${workerDisplayName(worker)}`,
    			onClick: () => openWorker(worker)
    		}, t("newSession")),
    		mounted ? null : h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "mount",
    			variant: "outline",
    			size: "sm",
    			icon: busy === `mount:${worker.id}` ? h(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
    				state: "ongoing",
    				size: 13
    			}) : h(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			"aria-label": `${t("mount")} ${workerDisplayName(worker)}`,
    			onClick: () => mountWorker(worker)
    		}, busy === `mount:${worker.id}` ? t("mounting") : t("mount")),
    		h(_deepseek_ai_dsh_client_ui_primitives.Button, {
    			key: "delete",
    			variant: "outline",
    			size: "sm",
    			className: "buka-workers-danger",
    			icon: h(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 13 }),
    			disabled: anyBusy,
    			"aria-label": `${t("delete")} ${workerDisplayName(worker)}`,
    			onClick: () => openDeleteDialog(worker)
    		}, t("delete"))
    	];
    	return h("li", {
    		className: `buka-workers-card${canOpen ? " is-clickable" : ""}${robot ? " is-robot" : ""}`,
    		key: worker.id,
    		"aria-busy": busy !== null ? true : void 0,
    		onClick: () => {
    			if (canOpen) openDetail(worker);
    		}
    	}, h("div", { className: "buka-workers-cardHead" }, h("div", { className: "buka-workers-titleRow" }, h("div", { className: "buka-workers-titleCluster" }, renderAvatar(worker.avatar, 26), h("button", {
    		type: "button",
    		className: "buka-workers-cardTitle",
    		title: workerIdentityLabel(worker),
    		"aria-label": `${t("openDetail")} ${workerDisplayName(worker)}`,
    		disabled: !canOpen,
    		onClick: (event) => {
    			event.stopPropagation();
    			if (canOpen) openDetail(worker);
    		}
    	}, workerIdentityLabel(worker)), h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: robot ? "info" : "neutral" }, robot ? t("driverRobot") : t("driverAgent")), robot ? null : h(MountedTag, {
    		t,
    		worker
    	}), robot ? null : h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "neutral" }, countBadge(skills.length, t)), missing ? h(_deepseek_ai_dsh_client_ui_primitives.Tag, { tone: "warning" }, t("missingDir")) : null), h("div", {
    		className: "buka-workers-titleActions",
    		onClick: (event) => event.stopPropagation()
    	}, ...actions.filter(Boolean))), h("p", { className: `buka-workers-cardDesc${description === "" ? " is-empty" : ""}` }, description === "" ? t("noDescription") : description), robot ? h("p", { className: "buka-workers-hint" }, t("robotReadOnly")) : null, missing ? h("p", { className: "buka-workers-hint" }, t("missingDirHint")) : null));
    }
    /** 列表页：登记文件提示、加载 / 失败 / 空状态与执行者卡片（不展示目录）。 */
    function WorkerList({ t, state, actions }) {
    	const { corrupt, registry, list, data, workers } = state;
    	const corruptNotice = corrupt ? h("p", {
    		className: "buka-workers-notice",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 16 }), h("span", null, t("corruptNote"), " ", h("code", { className: "buka-workers-inlineCode" }, registry))) : null;
    	return h("div", { className: "buka-workers-pageBody" }, corruptNotice, list.error === null ? null : h("p", {
    		className: "buka-workers-failure",
    		role: "alert"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), `${t("loadFailed")} ${list.error}`), list.loading && data === null ? h("p", {
    		className: "buka-workers-statusWithDot",
    		role: "status"
    	}, h(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")) : null, data === null ? null : workers.length === 0 && !list.loading && !corrupt ? h("p", { className: "buka-workers-empty" }, t("empty")) : h("ul", { className: "buka-workers-cards" }, ...workers.map((worker) => h(WorkerCard, {
    		t,
    		worker,
    		state,
    		actions,
    		key: worker.id
    	}))));
    }
    // .build/workflows/client/workers/components/workers-page.js
    /**
    * 「执行者」页签（首页 Worker Tab 的内容）。
    *
    * 页面只保存 UI 状态；执行者列表（登记表）来自 Host 的 `/buka-workers/list`，
    * 挂载 / 摘除 / 打开工作区则通过注入的 `getService` 取 DSH 的 Client
    * Service，两者都失败时用 Toast 说明原因。
    *
    * 本文件只做装配：状态在 `state.ts`，动作在 `actions/`，各视图与对话框在
    * `components/`。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/components/workers-page
    */
    /**
    * 「执行者」页签（首页 Worker Tab 的内容）。
    *
    */
    function WorkersPage(props) {
    	const t = props.t;
    	const state = useWorkersState({ getService: typeof props.getService === "function" ? props.getService : () => null });
    	const actions = createWorkerActions(state, t);
    	const detail = createDetailActions(state, t);
    	const skillActions = createSkillActions(state, t);
    	const { selectedWorker, notice, setNotice } = state;
    	return h("div", { className: "buka-workers-page" }, h(PageHeader, {
    		t,
    		state,
    		actions,
    		detail,
    		skillActions,
    		topTabs: props.topTabs
    	}), h("div", { className: "buka-workers-body" }, selectedWorker === null ? h(WorkerList, {
    		t,
    		state,
    		actions
    	}) : h(WorkerDetail, {
    		t,
    		worker: selectedWorker,
    		state,
    		detailActions: detail,
    		skillActions
    	})), notice === null ? null : h(_deepseek_ai_dsh_client_ui_primitives.Toast, {
    		key: notice.seq,
    		text: notice.text,
    		tone: notice.kind === "success" ? "success" : void 0,
    		icon: notice.kind === "success" ? void 0 : h(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
    		holdMs: 3200,
    		onDone: () => setNotice(null)
    	}), h(CreateWorkerDialog, {
    		t,
    		state,
    		actions
    	}), h(AvatarDialog, {
    		t,
    		state,
    		detail
    	}), h(RenameDialog, {
    		t,
    		state,
    		detail
    	}), h(DeleteWorkerDialog, {
    		t,
    		state,
    		actions
    	}), h(InstallSkillsModal, {
    		t,
    		state,
    		skillActions
    	}));
    }
    // .build/workflows/client/home.js
    /**
    * 面板首页：顶部 Workflow / Worker 两个页签，下面按页签挂载对应的页面。
    *
    * 页签由 hash 驱动：`#/workers`（或 `#/workers/…`）落在 Worker 页签，其余
    * hash 都是工作流路由，落在 Workflow 页签。刷新、浏览器前进 / 后退、执行者
    * 影响面弹窗里的「打开作业」（写 `#/job/...`）都靠同一个 hashchange 监听。
    *
    * 只挂载活动页签：切页签会卸载另一页，执行者页的选中态 / 草稿不跨页签保留
    * （与合并前两个侧边栏面板互切的行为一致）；工作流页的路由与数据都在 hash
    * 与 Host 里，重新挂载即可恢复。
    */
    /** Worker 页签的 hash：`#/workers` 或其后缀路由。 */
    const WORKERS_HASH = /^#\/workers(?:\/|$)/u;
    /** 没有工作流 hash 可恢复时写的列表页地址。 */
    const WORKFLOWS_DEFAULT_HASH = "#/workflows";
    /** 当前 hash；非浏览器环境（或读取失败）返回空串。 */
    function currentHash() {
    	if (typeof window === "undefined") return "";
    	try {
    		return window.location.hash;
    	} catch {
    		return "";
    	}
    }
    /** hash → 页签：`#/workers…` 是 Worker，其余都按工作流路由处理。 */
    function tabOf(hash) {
    	return WORKERS_HASH.test(hash) ? "worker" : "workflow";
    }
    /**
    * 只保留工作流一侧的 hash：Worker 页签的 hash 或空 hash 都归一成列表页。
    *
    * @param hash
    * @returns 可以写回地址栏的工作流 hash
    */
    function workflowHashOf(hash) {
    	if (hash === "" || WORKERS_HASH.test(hash)) return WORKFLOWS_DEFAULT_HASH;
    	return hash;
    }
    /** 页面首次挂载时的页签；非浏览器环境默认 Workflow。 */
    function initialTab() {
    	return tabOf(currentHash());
    }
    /**
    * 把页签写回地址栏。Worker 页签用 `#/workers`；Workflow 页签恢复上一次的
    * 工作流 hash（没有就写列表页）。hash 未变化时不产生历史记录。
    *
    * @param tab 目标页签
    * @param lastWorkflowHash 切回 Workflow 页签时恢复的工作流 hash
    */
    function writeTabHash(tab, lastWorkflowHash) {
    	if (typeof window === "undefined") return;
    	const hash = tab === "worker" ? "#/workers" : lastWorkflowHash || WORKFLOWS_DEFAULT_HASH;
    	try {
    		if (window.location.hash === hash) return;
    		window.location.hash = hash;
    	} catch {}
    }
    /**
    * 面板首页。
    *
    * @param props 工作流词典、执行者词典与 Client Service 取值器
    * @returns React 元素
    */
    function HomePage(props) {
    	const { t, workersT } = props;
    	const getService = typeof props.getService === "function" ? props.getService : () => null;
    	const [tab, setTab] = react.default.useState(initialTab);
    	const lastWorkflowHash = react.default.useRef(workflowHashOf(currentHash()));
    	react.default.useEffect(() => {
    		if (typeof window === "undefined") return void 0;
    		const onHash = () => {
    			const hash = window.location.hash;
    			if (tabOf(hash) === "workflow") lastWorkflowHash.current = workflowHashOf(hash);
    			setTab(tabOf(hash));
    		};
    		window.addEventListener("hashchange", onHash);
    		return () => window.removeEventListener("hashchange", onHash);
    	}, []);
    	/** 切页签：先写 hash，再切内存状态；工作流页重新挂载时按 hash 恢复路由。 */
    	function selectTab(next) {
    		writeTabHash(next, lastWorkflowHash.current);
    		setTab(next);
    	}
    	const tabs = [{
    		value: "workflow",
    		label: h(TabLabel, { text: t("topTabWorkflow") }),
    		id: "buka-workflows-hometab-workflow",
    		panelId: "buka-workflows-homepanel-workflow"
    	}, {
    		value: "worker",
    		label: h(TabLabel, { text: t("topTabWorker") }),
    		id: "buka-workflows-hometab-worker",
    		panelId: "buka-workflows-homepanel-worker"
    	}];
    	const topTabs = h(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
    		size: "sm",
    		className: "buka-workflows-homeTabList",
    		label: t("topTabsAria"),
    		value: tab,
    		onChange: selectTab,
    		items: tabs
    	});
    	return h("div", { className: "buka-workflows-home" }, h("div", { className: "buka-workflows-frame" }, tab === "worker" ? h(WorkersPage, {
    		t: workersT,
    		getService,
    		topTabs
    	}) : h(WorkflowsPage, {
    		t,
    		getService,
    		topTabs,
    		useSessionStatus: props.useSessionStatus
    	})));
    }
    // .build/workflows/client/styles.js
    /**
    * 页面样式：两个页签共用的内容列 + 页签带 + 标题行 + 内容区。
    * 间距与字号只用 `theme.ts` 的刻度变量。
    *
    * 列表条目（`.buka-workflows-card`）的背景只在内容列内，不再用负 margin
    * 外扩：两个页面既是滚动容器又带 `overflow-x:hidden`，外扩的部分会被裁掉，
    * 滚动条出现 / 消失时右侧还会跟着抖。滚动容器统一 `scrollbar-gutter:stable`，
    * 让滚动条一出现就预留槽位，切页签时版面不横移。
    */
    /** 页面样式。 */
    const CSS$1 = `

    .buka-workflows-home{
    --buka-column:1120px;
    --buka-inset:clamp(24px,4vw,48px);
    --buka-space-1:4px;
    --buka-space-2:8px;
    --buka-space-3:12px;
    --buka-space-4:16px;
    --buka-space-5:24px;
    --buka-space-6:32px;
    --buka-space-7:48px;
    --buka-text-page:20px;
    --buka-text-section:15px;
    --buka-text-title:14px;
    --buka-text-body:13px;
    --buka-text-meta:12px;
    --buka-text-code:11px;
    --buka-line-16:16px;
    --buka-line-18:18px;
    --buka-line-20:20px;
    --buka-line-22:22px;
    --buka-line-28:28px;
    --buka-control-sm:28px;
    --buka-control-md:36px;
    --buka-control-sm-pad:0 10px;
    --buka-control-md-pad:0 14px;
    --buka-motion-fast:120ms;
    --buka-motion:160ms;
    --buka-ease:cubic-bezier(.2,0,0,1);
    --buka-shadow-menu:0 8px 24px rgb(0 0 0 / 16%);
    --buka-shadow-dialog:0 24px 64px rgb(0 0 0 / 24%);
    --buka-overlay:rgb(17 20 28 / 24%);
    }
    /* 交互面一律带过渡：悬停 / 按下只改变背景或颜色，不做位移，避免抖动。 */
    .buka-workflows-card,.buka-workflows-filter,.buka-workflows-back,.buka-workflows-taskCard,.buka-workflows-node,.buka-workflows-drawerClose,.buka-workflows-foldSummary,.buka-workers-card,.buka-workers-iconButton,.buka-workers-avatarOption,.buka-workers-workspace,.buka-workers-candidate{transition:background-color var(--buka-motion-fast) var(--buka-ease),border-color var(--buka-motion-fast) var(--buka-ease),color var(--buka-motion-fast) var(--buka-ease),box-shadow var(--buka-motion-fast) var(--buka-ease),opacity var(--buka-motion-fast) var(--buka-ease)}
    /* 进入动画只做透明度：内容区在滚动容器里，任何 transform 都会临时撑大
       scrollable overflow，滚动条会跟着闪一条 5px 竖条。 */
    @keyframes buka-enter{from{opacity:0}to{opacity:1}}
    @keyframes buka-pop{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
    @media (width<=767px){.buka-workflows-home{--buka-inset:20px}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-home{--buka-motion-fast:0ms;--buka-motion:0ms}}

    .buka-workflows-home{box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-inset, clamp(24px,4vw,48px));background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;justify-content:center;overflow:hidden}
    .buka-workflows-frame{width:100%;max-width:var(--buka-column, 1120px);min-height:0;display:flex;flex-direction:column}
    .buka-workflows-homeTabList{width:fit-content;max-width:100%}
    .buka-workflows-page{box-sizing:border-box;flex:1 1 auto;min-height:0;width:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}
    .buka-workflows-page.is-graph{overflow:hidden}
    .buka-workflows-head{box-sizing:border-box;flex:none;padding:calc(var(--buka-space-5, 24px) + var(--dsh-frame-top-clearance,0px)) 0 0;background:var(--dsw-alias-bg-base);z-index:2;position:sticky;top:0}
    .buka-workflows-headInner{width:100%;display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
    .buka-workflows-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-4, 16px);min-height:var(--buka-control-sm, 28px)}
    .buka-workflows-barTabs{display:flex;align-items:center;min-width:0;flex:1 1 auto}
    .buka-workflows-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:var(--buka-space-3, 12px) var(--buka-space-4, 16px);min-width:0}
    .buka-workflows-titleGroup{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
    .buka-workflows-title{font-size:var(--buka-text-page, 20px);font-weight:500;line-height:var(--buka-line-28, 28px);margin:0;overflow-wrap:anywhere}
    .buka-workflows-titleMeta{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
    .buka-workflows-titleSub{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);font-weight:400}
    .buka-workflows-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
    .buka-workflows-back{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
    .buka-workflows-back svg{transform:rotate(180deg)}
    @media (hover:hover){.buka-workflows-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-back:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-tabs{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex:none;overflow-x:auto;overscroll-behavior-x:contain}
    .buka-workflows-tabList{width:fit-content;max-width:100%}
    .buka-workflows-body{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:var(--buka-space-5, 24px) 0 var(--buka-space-7, 48px);animation:buka-enter var(--buka-motion, 160ms) var(--buka-ease, cubic-bezier(.2,0,0,1))}
    .buka-workflows-body.is-graph{overflow:hidden;padding-bottom:0}
    .buka-workflows-body.is-graph .buka-workflows-detail,.buka-workflows-body.is-graph .buka-workflows-definitionPane,.buka-workflows-body.is-graph .buka-workflows-graphPane{flex:1 1 auto;min-height:0}
    .buka-workflows-more{position:relative;display:inline-flex}
    .buka-workflows-moreSummary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;height:var(--buka-control-sm, 28px);padding:var(--buka-control-sm-pad, 0 10px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);background:0 0}
    .buka-workflows-moreSummary::-webkit-details-marker{display:none}
    .buka-workflows-moreMenu{animation:buka-pop var(--buka-motion-fast, 120ms) var(--buka-ease, cubic-bezier(.2,0,0,1));position:absolute;right:0;top:calc(100% + 4px);z-index:5;padding:var(--buka-space-2, 8px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgb(0 0 0 / 16%);min-width:120px}
    .buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);margin:0}
    .buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workflows-emptyBox{display:flex;flex-direction:column;align-items:flex-start;gap:var(--buka-space-2, 8px);padding:var(--buka-space-2, 8px) 0}
    .buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
    .buka-workflows-failureBox{display:flex;flex-direction:column;align-items:flex-start;gap:var(--buka-space-3, 12px)}
    .buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px var(--buka-space-1, 4px);overflow-wrap:anywhere;word-break:break-all}
    .buka-workflows-pre{margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;width:100%;box-sizing:border-box}
    .buka-workflows-pre.is-tall{max-height:360px}
    .buka-workflows-pre.is-inline{max-height:160px;margin:2px 0}
    .buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:var(--buka-control-sm, 28px);padding:var(--buka-control-sm-pad, 0 10px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-smallButton.is-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
    .buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:var(--buka-control-sm, 28px);padding:var(--buka-control-sm-pad, 0 10px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-textButton{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-textButton:hover{text-decoration:underline}
    .buka-workflows-confirm{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workflows-confirmText{color:var(--dsw-alias-state-warn-primary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-notice{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
    .buka-workflows-noticeText{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);flex:1 1 260px}
    .buka-workflows-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
    .buka-workflows-listPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
    .buka-workflows-jobsPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
    .buka-workflows-tag{display:inline-flex;align-items:center;height:18px;padding:0 var(--buka-space-2, 8px);border-radius:999px;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
    .buka-workflows-resultMeta{margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-card{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-md);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);width:100%;margin:0;font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-card.is-disabled{opacity:.55}
    .buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
    .buka-workflows-cardTitle{font-size:var(--buka-text-title, 14px);font-weight:500;line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere;min-width:0}
    .buka-workflows-cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .buka-workflows-cardTags{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex:none;flex-wrap:wrap}
    .buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px var(--buka-space-1, 4px)}
    .buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workflows-progress{display:block;width:100%;height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:2px}
    .buka-workflows-progressBar{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
    .buka-workflows-progressBar.is-completed{background:var(--dsw-alias-state-success-primary)}
    .buka-workflows-progressBar.is-failed,.buka-workflows-progressBar.is-cancelled{background:var(--dsw-alias-state-error-primary)}
    .buka-workflows-filters{display:flex;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
    .buka-workflows-filter{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);height:28px;padding:0 var(--buka-space-3, 12px);border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);cursor:pointer}
    @media (hover:hover){.buka-workflows-filter:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-filter.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
    .buka-workflows-filterCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
    .buka-workflows-filter.is-active .buka-workflows-filterCount{color:inherit}
    .buka-workflows-detail{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);min-width:0}
    .buka-workflows-section{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workflows-sectionTitle{font-size:var(--buka-text-section, 15px);font-weight:600;line-height:var(--buka-line-22, 22px);margin:0;color:var(--dsw-alias-label-primary)}
    .buka-workflows-kv{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px)}
    .buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:var(--buka-space-1, 4px) var(--buka-space-3, 12px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);flex:0 0 96px;min-width:0}
    .buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0;flex:1 1 auto}
    .buka-workflows-values{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
    .buka-workflows-valueRow{display:flex;flex-wrap:wrap;gap:var(--buka-space-1, 4px) var(--buka-space-3, 12px);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workflows-valueKey{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);color:var(--dsw-alias-label-tertiary);flex:0 0 96px;min-width:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-valueValue{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
    .buka-workflows-definitionPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0;min-height:0}
    .buka-workflows-definitionToolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-3, 12px);flex-wrap:wrap}
    .buka-workflows-graphPane{display:flex;flex-direction:column;min-width:0;min-height:0}
    .buka-workflows-graphViewport{display:flex;align-items:flex-start;justify-content:center;width:100%;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}
    .buka-workflows-graphScaleBox{position:relative;flex:none;margin:auto}
    .buka-workflows-graphFooter{flex:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--buka-space-2, 8px) var(--buka-space-5, 24px);padding:var(--buka-space-3, 12px) 0 var(--buka-space-3, 12px);border-top:0.5px solid var(--dsw-alias-border-l1)}
    .buka-workflows-graphHint{margin:0;flex:1 1 240px;min-width:0}
    .buka-workflows-graphCanvas{position:absolute;left:0;top:0;flex:none}
    .buka-workflows-graphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
    .buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.5;stroke-linecap:round;opacity:.7;transition:opacity 140ms ease,stroke-width 140ms ease}
    .buka-workflows-edgeGroup.is-back .buka-workflows-edge{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:5 4;opacity:.9}
    .buka-workflows-edge.is-taken{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2;opacity:1}
    .buka-workflows-edgeGroup.is-selected .buka-workflows-edge{stroke:var(--dsw-alias-brand-primary);stroke-width:2.4;opacity:1}
    .buka-workflows-hitPath{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
    .buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.8;pointer-events:none;transition:opacity 140ms ease}
    .buka-workflows-edgeArrow.is-back{fill:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-edgeArrow.is-taken{fill:var(--dsw-alias-brand-primary);opacity:1}
    .buka-workflows-edgeLabel{fill:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);paint-order:stroke;stroke:var(--dsw-alias-bg-base);stroke-width:3px;stroke-linejoin:round;pointer-events:none;user-select:none;transition:fill 140ms ease}
    .buka-workflows-edgeLabel.is-back{fill:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-edgeLabel.is-taken{fill:var(--dsw-alias-brand-primary)}
    .buka-workflows-edgeGroup.is-hovered .buka-workflows-edgeLabel{fill:var(--dsw-alias-brand-primary);font-weight:600}
    .buka-workflows-edgeGroup.is-hovered .buka-workflows-edge{stroke-width:2.4;opacity:1}
    .buka-workflows-edgeGroup.is-hovered .buka-workflows-edgeArrow{opacity:1}
    .buka-workflows-edgeGroup.is-dimmed .buka-workflows-edge{opacity:.5}
    .buka-workflows-edgeGroup.is-dimmed .buka-workflows-edgeArrow{opacity:.5}
    @media (prefers-reduced-motion:reduce){.buka-workflows-edge,.buka-workflows-edgeArrow,.buka-workflows-edgeLabel{transition:none}.buka-workflows-edgeTip{animation:none}}
    .buka-workflows-edgeTip{position:fixed;z-index:30;max-width:min(280px,calc(100vw - 24px));padding:var(--buka-space-1, 4px) var(--buka-space-2, 8px);border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 14px rgb(0 0 0 / 14%);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);white-space:normal;overflow-wrap:anywhere;pointer-events:none;animation:buka-workflows-edgeTip-in 120ms ease-out}
    .buka-workflows-edgeTip::before{content:'';position:absolute;left:-5px;top:50%;transform:translateY(-50%);border:5px solid transparent;border-right-color:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-edgeTip.is-flipped::before{left:auto;right:-5px;border-right-color:transparent;border-left-color:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-edgeTip.is-back{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}
    @keyframes buka-workflows-edgeTip-in{from{opacity:0}to{opacity:1}}
    .buka-workflows-nodeWrap{position:absolute;z-index:2}
    .buka-workflows-node{position:relative;display:flex;align-items:center;gap:var(--buka-space-2, 8px);width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 10px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;overflow:visible}
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
    .buka-workflows-nodeCorner{position:absolute;top:-8px;right:-6px;z-index:1;display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:16px;box-sizing:border-box;padding:0 var(--buka-space-1, 4px);border-radius:999px;font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);font-weight:600;line-height:var(--buka-line-16, 16px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base)}
    .buka-workflows-nodeCorner.is-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-success-primary)}
    .buka-workflows-nodeCorner.is-running{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-brand-primary)}
    .buka-workflows-nodeCorner.is-waiting{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-nodeCorner.is-failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-error-primary)}
    .buka-workflows-nodeAttention{position:absolute;top:-4px;left:-4px;z-index:2;width:8px;height:8px;box-sizing:border-box;border-radius:50%;background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base);pointer-events:none}
    .buka-workflows-nodeLabel{font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-16, 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}

    .buka-workflows-legend{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--buka-space-2, 8px) var(--buka-space-4, 16px);color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);min-width:0}
    .buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:var(--buka-space-2, 8px) var(--buka-space-3, 12px)}
    .buka-workflows-legendItem{display:inline-flex;align-items:center;gap:var(--buka-space-1, 4px)}
    .buka-workflows-legendNode{box-sizing:border-box;width:20px;height:10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2)}
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
    .buka-workflows-boardPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-board{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:var(--buka-space-2, 8px)}
    .buka-workflows-boardGrid{display:grid;grid-template-columns:148px repeat(5,minmax(150px,1fr));gap:var(--buka-space-2, 8px);min-width:940px}
    .buka-workflows-boardDivider{grid-column:1/-1;height:0;border-top:1px dashed var(--dsw-alias-border-l2)}
    .buka-workflows-boardHeader{display:contents}
    .buka-workflows-boardRowHead{display:flex;flex-direction:column;gap:2px;padding:var(--buka-space-2, 8px) 0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
    .buka-workflows-boardHeader>.buka-workflows-boardRowHead{background:transparent;padding-top:0}
    .buka-workflows-boardColumnHead{font-size:var(--buka-text-code, 11px);font-weight:600;line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:0 2px var(--buka-space-1, 4px)}
    .buka-workflows-boardColumnHead.is-ready{color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-boardRow{display:contents}
    .buka-workflows-boardRowTitle{font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workflows-boardRowExecutor{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-boardRowMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
    .buka-workflows-boardCell{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0;min-height:52px;padding:var(--buka-space-1, 4px);border-radius:var(--dsw-radius-sm);border:0.5px dashed var(--dsw-alias-border-l1)}
    .buka-workflows-boardCell.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
    .buka-workflows-boardCompact{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
    .buka-workflows-boardGroup{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
    .buka-workflows-boardGroupTitle{display:flex;align-items:center;gap:var(--buka-space-2, 8px);margin:0;font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary)}
    .buka-workflows-boardGroupTitle.is-ready{color:var(--dsw-alias-state-warn-primary)}
    .buka-workflows-boardGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px)}
    .buka-workflows-taskList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
    .buka-workflows-taskItem{display:flex;min-width:0}
    .buka-workflows-taskItem>.buka-workflows-taskCard{width:100%}
    .buka-workflows-taskCard{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);width:100%;box-sizing:border-box;text-align:left;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font:inherit;color:inherit;cursor:pointer}
    @media (hover:hover){.buka-workflows-taskCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workflows-taskCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workflows-taskCard.is-running{border-color:var(--dsw-alias-brand-primary)}
    .buka-workflows-taskCard.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent)}
    .buka-workflows-taskCard.is-failed,.buka-workflows-taskCard.is-blocked{border-color:var(--dsw-alias-state-error-primary)}
    .buka-workflows-taskCardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workflows-taskCardType{font-size:var(--buka-text-meta, 12px);font-weight:500;line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere;min-width:0}
    .buka-workflows-taskCardPosition{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
    .buka-workflows-taskCardMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-taskCardSummary{color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .buka-workflows-overview{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);min-width:0}
    .buka-workflows-overviewCard{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0}
    .buka-workflows-finalCard{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
    .buka-workflows-finalHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workflows-inlineGroup{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workflows-outputsPane{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);min-width:0}
    .buka-workflows-outputGroup{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workflows-outputGroupHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
    .buka-workflows-outputGroupTitle{font-size:var(--buka-text-body, 13px);font-weight:600;line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
    .buka-workflows-outputGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);margin-left:auto}
    .buka-workflows-asset{display:flex;align-items:flex-start;gap:var(--buka-space-3, 12px);flex-wrap:wrap;padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-assetMain{display:flex;flex-direction:column;gap:3px;min-width:180px;flex:1 1 auto}
    .buka-workflows-assetActions{display:flex;align-items:center;gap:var(--buka-space-3, 12px);flex-wrap:wrap;flex:none}
    .buka-workflows-attachmentList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
    .buka-workflows-attachment{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-18, 18px);text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
    @media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
    .buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);flex:none}
    .buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);flex:1 1 auto;min-width:120px;overflow-wrap:anywhere}
    .buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:var(--buka-text-code, 11px);flex:none}
    .buka-workflows-attachmentDownload:hover{text-decoration:underline}
    .buka-workflows-depList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
    .buka-workflows-depRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-depLink{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:var(--buka-text-meta, 12px);cursor:pointer;text-align:left}
    .buka-workflows-depLink:hover{text-decoration:underline}
    .buka-workflows-depSummary{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);flex:1 1 100%;overflow-wrap:anywhere}
    .buka-workflows-attemptList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
    .buka-workflows-attempt{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
    .buka-workflows-attemptHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
    .buka-workflows-attemptMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-result{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
    .buka-workflows-actionRow{display:flex;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
    .buka-workflows-select{width:100%;padding:var(--buka-space-2, 8px) var(--buka-space-2, 8px);border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-l0);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px)}
    .buka-workflows-taskForm{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
    .buka-workflows-contractBody{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workflows-tagRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workflows-initialList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
    .buka-workflows-initialRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-initialMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-clamped{display:flex;flex-direction:column;align-items:flex-start;gap:var(--buka-space-1, 4px);min-width:0}
    .buka-workflows-clampedText{margin:0;width:100%;box-sizing:border-box;overflow-wrap:anywhere;white-space:pre-wrap}
    .buka-workflows-clampedText.is-clamped{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:normal}
    .buka-workflows-drawerText{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
    .buka-workflows-required{color:var(--dsw-alias-state-warn-primary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
    .buka-workflows-typeList{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-typeCard{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px);border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);min-width:0}
    .buka-workflows-typeRowHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
    .buka-workflows-typeName{font-size:var(--buka-text-body, 13px);font-weight:600;line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
    .buka-workflows-typeTags{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;margin-left:auto}
    .buka-workflows-typeDesc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-contractStack{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-contractStack.is-tight{gap:var(--buka-space-1, 4px)}
    .buka-workflows-contractBlock{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
    .buka-workflows-contractLine{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--buka-space-1, 4px) var(--buka-space-3, 12px);align-items:start;min-width:0}
    .buka-workflows-contractLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-18, 18px);white-space:nowrap;padding-top:2px}
    .buka-workflows-contractValue{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
    .buka-workflows-contractFields{display:flex;flex-wrap:wrap;gap:var(--buka-space-1, 4px) var(--buka-space-2, 8px);min-width:0}
    .buka-workflows-contractField{display:inline-flex;align-items:baseline;gap:var(--buka-space-1, 4px);max-width:100%;padding:1px var(--buka-space-2, 8px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);min-width:0}
    .buka-workflows-contractField .buka-workflows-inlineCode{flex:none;background:0;padding:0;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
    .buka-workflows-contractType{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);flex:none}
    .buka-workflows-contractDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-statStrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:1px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-border-l1);overflow:hidden}
    .buka-workflows-stat{display:flex;flex-direction:column;gap:1px;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);background:var(--dsw-alias-bg-layer-1);min-width:0}
    .buka-workflows-statValue{font-size:var(--buka-text-title, 14px);font-weight:600;line-height:var(--buka-line-20, 20px);color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .buka-workflows-statLabel{font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-tertiary)}
    .buka-workflows-resultText{margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);white-space:pre-wrap;overflow-wrap:anywhere}
    .buka-workflows-resultBlock{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
    .buka-workflows-subLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);font-weight:500;line-height:var(--buka-line-16, 16px)}
    .buka-workflows-deliverable{padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 5%,transparent)}
    .buka-workflows-field{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
    .buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);font-weight:500;line-height:var(--buka-line-18, 18px);display:flex;align-items:center;gap:var(--buka-space-1, 4px);flex-wrap:wrap}
    .buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-input{width:100%}
    .buka-workflows-textarea{box-sizing:border-box;width:100%;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);resize:vertical}
    .buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workflows-formActions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--buka-space-2, 8px);margin-top:var(--buka-space-1, 4px)}
    .buka-workflows-dialogForm{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
    .buka-workflows-dialogSection{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-dialogSectionTitle{margin:0;font-size:var(--buka-text-body, 13px);font-weight:600;line-height:var(--buka-line-20, 20px)}
    .buka-workflows-restartTasks{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px)}
    .buka-workflows-restartTaskList{margin:0;padding:0 0 0 var(--buka-space-4, 16px);display:flex;flex-direction:column;gap:2px}
    .buka-workflows-restartTask{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
    .buka-workflows-avatarMissing{background:var(--dsw-alias-fill-secondary);border-color:var(--dsw-alias-border-secondary);color:var(--dsw-alias-label-tertiary);font-weight:600}
    .buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(720px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
    .buka-workflows-inspector.buka-workflows-inspector{width:min(640px,100vw)}
    .buka-workflows-nodeTasks.buka-workflows-nodeTasks{width:min(480px,100vw)}
    @keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
    @media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
    @media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
    .buka-workflows-drawerHead{flex:none;padding:var(--buka-space-4, 16px) var(--buka-space-5, 24px);border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
    .buka-workflows-drawerHeadRow{display:flex;align-items:flex-start;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-drawerHeading{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
    .buka-workflows-drawerAvatar{margin-top:3px}
    .buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
    .buka-workflows-drawerTitle{flex:0 1 auto;min-width:0;margin:0;font-size:var(--buka-text-section, 15px);font-weight:600;line-height:var(--buka-line-22, 22px);overflow-wrap:anywhere}
    .buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workflows-drawerActions{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex:none;margin-left:auto;min-width:0}
    .buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:var(--buka-space-1, 4px);color:var(--dsw-alias-brand-primary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);text-decoration:none;border-radius:var(--dsw-radius-sm)}
    .buka-workflows-drawerDownload:hover{text-decoration:underline}
    .buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}
    @media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:var(--buka-space-4, 16px);overflow:auto;overscroll-behavior:contain;padding:var(--buka-space-4, 16px) var(--buka-space-4, 16px) var(--buka-space-5, 24px)}
    .buka-workflows-drawerBody .buka-workflows-sectionTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workflows-drawerTabbed{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-drawerTabBar{display:flex;align-items:center;min-width:0;overflow-x:auto;overscroll-behavior-x:contain}
    .buka-workflows-drawerTabPanel{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px);min-width:0}
    .buka-workflows-drawerStack{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px);min-width:0}
    .buka-workflows-sectionHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
    .buka-workflows-fold{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-foldSummary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-20, 20px);border-radius:var(--dsw-radius-sm)}
    .buka-workflows-foldSummary:hover{color:var(--dsw-alias-label-primary)}
    .buka-workflows-fold[open] .buka-workflows-foldSummary{margin-bottom:var(--buka-space-2, 8px);color:var(--dsw-alias-label-primary)}
    .buka-workflows-foldBody{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    .buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
    @media (width<=767px){
    .buka-workflows-title{font-size:18px;line-height:var(--buka-line-28, 28px)}
    .buka-workflows-titleSub{flex:1 1 100%}
    .buka-workflows-body{padding:var(--buka-space-5, 24px) 0 var(--buka-space-6, 32px)}
    .buka-workflows-body.is-graph{padding-bottom:0}
    .buka-workflows-graphFooter{gap:var(--buka-space-2, 8px);padding-bottom:var(--buka-space-2, 8px)}
    .buka-workflows-legend{justify-content:flex-start;width:100%}
    .buka-workflows-sectionTitle{font-size:var(--buka-text-title, 14px)}
    .buka-workflows-overviewCard{padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px)}
    .buka-workflows-valueRow{flex-direction:column;gap:2px}
    }
    .buka-workflows-unavailableNotice{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);margin:0 0 var(--buka-space-3, 12px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-warning);background:var(--dsw-alias-fill-warning);color:var(--dsw-alias-label-primary)}
    .buka-workflows-unavailableTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-18, 18px)}
    .buka-workflows-unavailableHint{margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary)}
    .buka-workflows-unavailableList{margin:0;padding-left:var(--buka-space-4, 16px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
    .buka-workflows-unavailableTag{display:inline-flex;align-items:center;padding:1px var(--buka-space-2, 8px);border-radius:999px;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);border:0.5px solid var(--dsw-alias-border-warning);color:var(--dsw-alias-label-warning)}
    `;
    // .build/workflows/client/workers/i18n.js
    /**
    * 「执行者」页面的英文与简体中文词典。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/i18n
    */
    /** 英文文案。 */
    const en = {
    	title: "Workers",
    	refresh: "Refresh",
    	loading: "Loading…",
    	loadFailed: "Request failed:",
    	empty: "No workers yet. Creating one adds a directory in the plugin folder and mounts it to the sidebar workspace list.",
    	corruptNote: "The worker registry cannot be read. Fix or delete the file, then refresh:",
    	createFieldId: "Identifier",
    	createIdPlaceholder: "Identifier, e.g. writer",
    	createIdHint: "Required and immutable. It becomes the worker directory and the reference key used by workflows; lowercase letters, digits, \"_\" and \"-\", starting with a letter.",
    	createFieldName: "Name (optional)",
    	createNamePlaceholder: "Display name, e.g. Writer",
    	createNameHint: "Shown in the UI only; it can be changed later. When empty, the identifier is shown.",
    	create: "Create worker",
    	close: "Close",
    	creating: "Creating…",
    	avatar: "Avatar",
    	chooseAvatar: "Choose an avatar",
    	changeAvatar: "Change avatar",
    	avatarUpdated: "Avatar updated.",
    	avatarSaveFailed: "Could not update the avatar:",
    	descriptionLabel: "Responsibilities",
    	descriptionPlaceholder: "e.g. Turns meeting notes into a three-point summary",
    	descriptionHint: "Workflows read this line to decide whether to hand a node to this worker. State in one sentence what the worker is responsible for.",
    	noDescription: "No responsibilities yet.",
    	tabSettings: "Settings",
    	descriptionSaved: "Responsibilities saved.",
    	descriptionSaveFailed: "Could not save the responsibilities:",
    	modelTitle: "Model",
    	modelHint: "Pick the model this agent uses for new sessions. Existing sessions keep their own model and can switch with /model.",
    	modelFollowDefault: "Follow the default model",
    	modelFollowDefaultHint: "New sessions use the host default model.",
    	modelProvider: "Provider",
    	modelModelLabel: "Model",
    	modelEffort: "Reasoning effort",
    	modelEffortDefault: "Adapter default",
    	modelCurrent: "Current model:",
    	modelSaved: "Model saved.",
    	modelSaveFailed: "Could not save the model:",
    	modelLoadFailed: "Could not read the model catalog:",
    	modelEmpty: "No models are available. Configure a provider in the DSH model settings first.",
    	modelSomeFailed: "Some providers could not be read:",
    	modelUnavailable: "This composition has no model catalog (ctx.llm is unavailable), so no model can be selected.",
    	created: "Created worker:",
    	createExisting: "Worker already existed:",
    	createFailed: "Could not create the worker:",
    	createMountFailed: "The worker was created, but mounting it to a workspace failed. Use “Mount” to retry:",
    	createEmptyId: "Enter a worker identifier first.",
    	rename: "Rename worker",
    	renameLabel: "Rename",
    	renameFieldLabel: "Name",
    	renameHint: "Only the display name changes: the directory and the workspace stay where they are. Leave it empty to show the identifier.",
    	renameSame: "The new name is the same as the current name.",
    	renameSaveFailed: "Could not rename the worker:",
    	renamed: "Renamed worker:",
    	newSession: "New session",
    	reveal: "Open in Finder",
    	revealFailed: "Could not open the folder:",
    	openFailed: "Could not open the worker:",
    	openUnmounted: "This worker is not mounted to a workspace yet. Click “Mount” first.",
    	openDetail: "Open details",
    	mount: "Mount",
    	mounting: "Mounting…",
    	mounted: "Mounted to a workspace:",
    	mountFailed: "Could not mount the worker:",
    	delete: "Delete",
    	deleteTitle: "Delete worker",
    	deleteConfirm: "Delete permanently",
    	deleting: "Deleting…",
    	cancel: "Cancel",
    	deleted: "Deleted worker:",
    	deleteFailed: "Could not delete the worker:",
    	deleteHardDeleteNote: "Delete is permanent: the registry entry, the worker directory and its workspace registration are removed together. AGENTS.md and the project skills inside the directory disappear with it; there is no recycle bin.",
    	deleteImpactLoading: "Reading what this deletion affects…",
    	deleteImpactFailed: "Could not read the impact:",
    	deleteDir: "Directory to delete",
    	deleteMounted: "This worker is mounted; its workspace registration is removed too.",
    	deleteNotMounted: "This worker is not mounted; there is no workspace registration to remove.",
    	deleteFinishedJobs: "Finished jobs that referenced it:",
    	deleteAffectedWorkflows: "Workflows that will become unavailable:",
    	deleteNoWorkflows: "No workflow references this worker.",
    	deleteOpenJob: "Open job",
    	deleteBlockedTitle: "Running jobs block deletion",
    	deleteBlockedByJobs: "Running jobs reference this worker. Terminate those jobs on their job pages first, then delete the worker; force delete is not available.",
    	deleteHint: "The worker directory and files are kept.",
    	skillsBadge: "{n} skills",
    	mountedBadge: "Mounted",
    	unmountedBadge: "Not mounted",
    	driverAgent: "Agent",
    	driverRobot: "Robot",
    	robotReadOnly: "Built-in robot: read-only, with no directory, session or settings.",
    	missingDir: "Missing directory",
    	missingDirHint: "This worker directory no longer exists. You can delete the record and create it again.",
    	missingDirDetail: "This worker directory no longer exists, so file browsing and skills operations will fail.",
    	back: "Back to workers",
    	tabsLabel: "Worker detail sections",
    	tabFiles: "Files",
    	tabSkills: "Skills",
    	skillsTitle: "Installed skills",
    	skillsIntroBefore: "Project-level skills are installed with ",
    	skillsIntroMiddle: " into ",
    	skillsIntroAfter: " (plus a Claude Code link in .claude/skills).",
    	sourcePlaceholder: "Source, e.g. vercel-labs/agent-skills",
    	installSkills: "Install skills",
    	installDialogTitle: "Install skills",
    	installSourceLabel: "Source",
    	loadSkills: "List skills",
    	loadingSkills: "Reading skills…",
    	installIdle: "Enter a source, or pick a repository from the Skills favourites, then list its skills.",
    	skillsFound: "{n} skills available",
    	selectAllSkills: "Select all",
    	selectedSkills: "Selected {n} of {m}",
    	alreadyInstalled: "Installed",
    	installedHint: "Skills that are already installed cannot be selected.",
    	installSelected: "Install selected",
    	installSelectedCount: "Install {n}",
    	installingSkills: "Installing {n}…",
    	installEmptySelection: "Select at least one skill.",
    	favouritesLabel: "Skills favourites",
    	favouritesEmpty: "No favourite repositories in the Skills plugin yet.",
    	errAvailableFailed: "Could not read the skill list:",
    	errListUnparsed: "Could not read a skill list from this source. See the command output below.",
    	errInvalidSkills: "Select valid skills.",
    	skillInstalled: "Installed skill from:",
    	removeSkill: "Remove",
    	confirmRemoveSkill: "Confirm remove",
    	removing: "Removing…",
    	skillRemoved: "Removed skill:",
    	updateSkills: "Update",
    	updatingSkills: "Updating…",
    	skillsUpToDate: "All skills are up to date.",
    	updateAllWorkers: "Update all workers",
    	updatingAllWorkers: "Updating all…",
    	updateAllSummary: "Updated {n} skill(s); {f} skill failure(s), {s} worker(s) skipped.",
    	skillsEmpty: "No project-level skills are installed in this worker yet.",
    	skillErrorTitle: "The skills command failed:",
    	outputLabel: "Command output",
    	filesTitle: "Files",
    	filesHint: "Browse the worker directory read-only. Content opens on the right; editing and saving belong to the builder tools.",
    	filesTreeAria: "Worker directory tree",
    	filesSelectFile: "Select a file to view its content.",
    	filesEmpty: "This worker directory has no files yet.",
    	filesLoadFailed: "Could not read the directory:",
    	filesReadFailed: "Could not read the file:",
    	filesTooLarge: "The file is {n}, above the 256 KiB preview limit. Open it in an external editor.",
    	filesBinary: "This binary file cannot be previewed.",
    	filesEmptyFile: "This file is empty.",
    	filesTruncated: "The directory is large; only part of it is shown.",
    	filesLinesTruncated: "The file is long; showing the first {n} lines.",
    	filesCode: "Code",
    	filesWrap: "Wrap lines",
    	filesUnwrap: "No wrap",
    	filesCopy: "Copy",
    	filesCopied: "Copied",
    	filesWindow: "Showing {shown} of {total} lines",
    	filesCollapseAria: "Collapse hidden lines",
    	filesExpandAria: "Expand {n} hidden lines",
    	filesCollapse: "Collapse",
    	filesExpand: "Expand",
    	save: "Save",
    	saving: "Saving…",
    	noWorkspacesCreate: "This client has no workspaces service, so the worker cannot be mounted to the workspace list.",
    	noWorkspacesDelete: "This client has no workspaces service, so the workspace registration cannot be removed.",
    	noUiWorkspace: "This client has no uiWorkspace service, so the worker conversation cannot be opened.",
    	avatarSprout: "Sprout",
    	avatarSun: "Sun",
    	avatarCat: "Cat",
    	avatarFox: "Fox",
    	avatarPanda: "Panda",
    	avatarOwl: "Owl",
    	avatarWhale: "Whale",
    	avatarOctopus: "Octopus",
    	avatarBee: "Bee",
    	avatarRocket: "Rocket",
    	avatarDino: "Dino",
    	avatarGhost: "Ghost",
    	avatarPenguin: "Penguin",
    	avatarUnicorn: "Unicorn",
    	avatarMushroom: "Mushroom",
    	errInvalidId: "Invalid identifier: use ^[a-z][a-z0-9_-]{0,63}$ (lowercase letters, digits, \"_\" and \"-\", starting with a letter). It cannot be changed after creation.",
    	errInvalidName: "Invalid name: use a single line of at most 64 characters.",
    	errInvalidAvatar: "That avatar is not available. Pick one from the list.",
    	errNotDirectory: "A file already exists at that path, so no directory could be created.",
    	errUnknownWorker: "This worker is no longer in the registry. Refresh and try again.",
    	errIdTaken: "That identifier is already taken. Pick another one.",
    	errInvalidUpdate: "This request is missing the update flag, so the name was not changed.",
    	errMissingDirectory: "The worker directory does not exist, so this operation cannot run.",
    	errRegistryUnreadable: "The worker registry cannot be read, so this change was cancelled. Fix or delete the file, then refresh.",
    	errRobotWorker: "Robots are read-only: they have no directory or session, so this change is not available.",
    	errBuiltinWorker: "Built-in workers cannot be created, changed or removed.",
    	errOutsideRoot: "The worker directory is outside the worker root, so it was not deleted.",
    	errWorkspaceUnavailable: "The workspace registry is unavailable, so the worker could not be deleted safely. Refresh and try again.",
    	errInvalidDriver: "Only agents can be created; robots are built into the plugin.",
    	errInvalidModel: "The model selection is invalid. Pick a provider and model from the catalog.",
    	workflowStatusActive: "Available",
    	workflowStatusRetired: "Disabled",
    	workflowStatusDraft: "Draft",
    	errTooLarge: "AGENTS.md is larger than 512 KiB and cannot be saved.",
    	errInvalidContent: "The AGENTS.md content must be text.",
    	errInvalidSource: "Invalid source. Use an npx skills source such as owner/repo.",
    	errInvalidSkill: "Invalid skill name.",
    	errNpxFailed: "npx skills failed. See the command output below.",
    	errSkillsUnavailable: "The Skills plugin (@buka/dsh-plugin-skills) is not installed, so worker skills cannot be updated.",
    	errUpdateFailed: "Could not update skills:"
    };
    /** 简体中文文案。 */
    const zh = {
    	title: "执行者",
    	refresh: "刷新",
    	loading: "正在读取…",
    	loadFailed: "请求失败：",
    	empty: "还没有执行者。创建执行者会在插件目录下新建目录，并挂到侧边栏的工作区列表。",
    	corruptNote: "执行者登记文件无法读取，请修复或删除该文件后刷新：",
    	createFieldId: "标识符",
    	createIdPlaceholder: "标识符，如 writer",
    	createIdHint: "必填，创建后不可修改；它同时是执行者目录名与工作流引用键。只能用小写字母、数字、_ 与 -，且以小写字母开头。",
    	createFieldName: "名称（可选）",
    	createNamePlaceholder: "展示名，如 写作助手",
    	createNameHint: "只用于展示，可随时修改；留空时显示标识符。",
    	create: "创建执行者",
    	close: "关闭",
    	creating: "创建中…",
    	avatar: "头像",
    	chooseAvatar: "选择头像",
    	changeAvatar: "更换头像",
    	avatarUpdated: "已更换头像。",
    	avatarSaveFailed: "更换头像失败：",
    	descriptionLabel: "职责",
    	descriptionPlaceholder: "例如：负责把会议记录整理成三点结论",
    	descriptionHint: "工作流会读它来决定是否把节点交给这个执行者；用一句话写清这个执行者负责什么。",
    	noDescription: "还没有填写职责。",
    	tabSettings: "设置",
    	descriptionSaved: "职责已保存。",
    	descriptionSaveFailed: "保存职责失败：",
    	modelTitle: "模型",
    	modelHint: "选择这个智能体新开会话时使用的模型；已有会话保留自己的模型，可以在会话里用 /model 切换。",
    	modelFollowDefault: "跟随默认模型",
    	modelFollowDefaultHint: "新会话使用宿主当前默认模型。",
    	modelProvider: "提供方",
    	modelModelLabel: "模型",
    	modelEffort: "推理强度",
    	modelEffortDefault: "适配器默认",
    	modelCurrent: "当前模型：",
    	modelSaved: "已保存模型。",
    	modelSaveFailed: "保存模型失败：",
    	modelLoadFailed: "读取模型目录失败：",
    	modelEmpty: "当前没有可用模型，请先在 DSH 的模型设置里配置提供方。",
    	modelSomeFailed: "部分提供方读取失败：",
    	modelUnavailable: "当前组合没有模型目录（ctx.llm 不可用），无法为智能体选择模型。",
    	created: "已创建执行者：",
    	createExisting: "执行者已存在：",
    	createFailed: "创建失败：",
    	createMountFailed: "执行者已创建，但挂载到工作区失败，可点「挂载」重试：",
    	createEmptyId: "先填一个执行者标识符。",
    	rename: "重命名执行者",
    	renameLabel: "重命名",
    	renameFieldLabel: "名称",
    	renameHint: "只改展示名：目录与工作区都保持原位。留空表示清空名称、改回显示标识符。",
    	renameSame: "新名称与当前名称相同。",
    	renameSaveFailed: "重命名失败：",
    	renamed: "已重命名为：",
    	newSession: "新会话",
    	reveal: "打开 Finder",
    	revealFailed: "打开文件夹失败：",
    	openFailed: "打开失败：",
    	openUnmounted: "这个执行者还没有挂载到工作区，先点「挂载」。",
    	openDetail: "打开详情",
    	mount: "挂载",
    	mounting: "挂载中…",
    	mounted: "已挂载到工作区：",
    	mountFailed: "挂载失败：",
    	delete: "删除",
    	deleteTitle: "删除执行者",
    	deleteConfirm: "永久删除",
    	deleting: "正在删除…",
    	cancel: "取消",
    	deleted: "已删除执行者：",
    	deleteFailed: "删除失败：",
    	deleteHardDeleteNote: "删除是硬删：登记条目、执行者目录与工作区注册会一起消失。目录里的 AGENTS.md 与项目 skills 也会一起消失，没有回收站。",
    	deleteImpactLoading: "正在读取删除影响面…",
    	deleteImpactFailed: "读取删除影响面失败：",
    	deleteDir: "将被删除的目录",
    	deleteMounted: "这个执行者已挂载，工作区注册会一起摘掉。",
    	deleteNotMounted: "这个执行者没有挂载，没有工作区注册需要摘掉。",
    	deleteFinishedJobs: "引用它的已结束作业数：",
    	deleteAffectedWorkflows: "会因此变成不可用的工作流：",
    	deleteNoWorkflows: "没有工作流引用这个执行者。",
    	deleteOpenJob: "打开作业",
    	deleteBlockedTitle: "运行中的作业阻塞删除",
    	deleteBlockedByJobs: "有引用这个执行者的运行中作业。请先在这些作业的作业页主动终止它们，再回来删除；不提供强制删除。",
    	deleteHint: "执行者目录、文件保留。",
    	skillsBadge: "{n} 个技能",
    	mountedBadge: "已挂载",
    	unmountedBadge: "未挂载",
    	driverAgent: "智能体",
    	driverRobot: "机器人",
    	robotReadOnly: "内建机器人：只读，没有目录、会话与配置。",
    	missingDir: "目录缺失",
    	missingDirHint: "这个执行者目录已经不存在了，可以删除记录后重新创建。",
    	missingDirDetail: "这个执行者目录已经不存在了，文件浏览与 skills 操作都会失败。",
    	back: "返回执行者列表",
    	tabsLabel: "执行者详情页签",
    	tabFiles: "文件",
    	tabSkills: "技能",
    	skillsTitle: "已安装 skills",
    	skillsIntroBefore: "项目级 skills 通过 ",
    	skillsIntroMiddle: " 安装到 ",
    	skillsIntroAfter: "（并给 Claude Code 建 .claude/skills 链接）。",
    	sourcePlaceholder: "来源，如 vercel-labs/agent-skills",
    	installSkills: "安装 skills",
    	installDialogTitle: "安装 skills",
    	installSourceLabel: "来源",
    	loadSkills: "读取 skills",
    	loadingSkills: "正在读取 skills…",
    	installIdle: "填一个来源，或从 Skills 收藏夹里选一个仓库，然后读取其中的 skills。",
    	skillsFound: "共 {n} 个 skills",
    	selectAllSkills: "全选",
    	selectedSkills: "已选 {n} / {m}",
    	alreadyInstalled: "已安装",
    	installedHint: "已安装的 skill 不能重复勾选。",
    	installSelected: "安装选中的",
    	installSelectedCount: "安装 {n} 个",
    	installingSkills: "正在安装 {n} 个…",
    	installEmptySelection: "至少选一个 skill。",
    	favouritesLabel: "Skills 收藏夹",
    	favouritesEmpty: "Skills 插件里还没有收藏仓库。",
    	errAvailableFailed: "读取 skill 清单失败：",
    	errListUnparsed: "无法从这个来源读出 skill 清单，命令输出见下方。",
    	errInvalidSkills: "skills 不合法。",
    	skillInstalled: "已安装 skill：",
    	removeSkill: "移除",
    	confirmRemoveSkill: "确认移除",
    	removing: "移除中…",
    	skillRemoved: "已移除 skill：",
    	updateSkills: "更新",
    	updatingSkills: "更新中…",
    	skillsUpToDate: "所有 skill 都已是最新。",
    	updateAllWorkers: "更新全部执行者",
    	updatingAllWorkers: "正在全部更新…",
    	updateAllSummary: "已更新 {n} 个 skill；{f} 个 skill 失败，跳过 {s} 个执行者。",
    	skillsEmpty: "这个执行者还没有安装项目级 skills。",
    	skillErrorTitle: "skills 命令执行失败：",
    	outputLabel: "命令输出",
    	filesTitle: "文件",
    	filesHint: "以只读方式浏览执行者目录；内容显示在右侧，编辑与保存交给 builder 工具。",
    	filesTreeAria: "执行者目录树",
    	filesSelectFile: "选择一个文件查看内容。",
    	filesEmpty: "这个执行者目录里还没有文件。",
    	filesLoadFailed: "读取目录失败：",
    	filesReadFailed: "读取文件失败：",
    	filesTooLarge: "文件大小 {n}，超过 256 KiB 的预览上限；请用外部编辑器打开。",
    	filesBinary: "这是二进制文件，不提供预览。",
    	filesEmptyFile: "这个文件是空的。",
    	filesTruncated: "目录较大，只展示了一部分。",
    	filesLinesTruncated: "文件较长，只显示前 {n} 行。",
    	filesCode: "代码",
    	filesWrap: "自动换行",
    	filesUnwrap: "取消换行",
    	filesCopy: "复制",
    	filesCopied: "已复制",
    	filesWindow: "显示 {shown} / {total} 行",
    	filesCollapseAria: "折叠隐藏行",
    	filesExpandAria: "展开 {n} 个隐藏行",
    	filesCollapse: "折叠",
    	filesExpand: "展开",
    	save: "保存",
    	saving: "保存中…",
    	noWorkspacesCreate: "当前客户端没有 workspaces 服务，无法把执行者挂载到工作区列表。",
    	noWorkspacesDelete: "当前客户端没有 workspaces 服务，无法移除工作区注册。",
    	noUiWorkspace: "当前客户端没有 uiWorkspace 服务，无法打开执行者会话。",
    	avatarSprout: "嫩芽",
    	avatarSun: "太阳",
    	avatarCat: "小猫",
    	avatarFox: "狐狸",
    	avatarPanda: "熊猫",
    	avatarOwl: "猫头鹰",
    	avatarWhale: "鲸鱼",
    	avatarOctopus: "章鱼",
    	avatarBee: "蜜蜂",
    	avatarRocket: "火箭",
    	avatarDino: "恐龙",
    	avatarGhost: "幽灵",
    	avatarPenguin: "企鹅",
    	avatarUnicorn: "独角兽",
    	avatarMushroom: "蘑菇",
    	errInvalidId: "标识符不合法：需匹配 ^[a-z][a-z0-9_-]{0,63}$（小写字母开头，可带小写字母、数字、_ 与 -），且创建后不可修改。",
    	errInvalidName: "名称不合法：需要不超过 64 个字符的单行文本。",
    	errInvalidAvatar: "这个头像不可用，请从列表里重新选一个。",
    	errNotDirectory: "目标路径已存在且不是目录，无法创建。",
    	errUnknownWorker: "这个执行者已不在登记表里，请刷新后重试。",
    	errIdTaken: "这个标识符已被占用，请换一个。",
    	errInvalidUpdate: "请求缺少 update 标记，名称未修改。",
    	errMissingDirectory: "执行者目录不存在，无法执行这个操作。",
    	errRegistryUnreadable: "执行者登记文件无法读取，本次修改已取消；请修复或删除该文件后刷新。",
    	errRobotWorker: "机器人只读：没有目录与会话，不能执行这个操作。",
    	errBuiltinWorker: "内建执行者不可创建、修改或删除。",
    	errOutsideRoot: "执行者目录不在执行者根目录下，已拒绝删除。",
    	errWorkspaceUnavailable: "工作区注册服务不可用，无法安全删除这个执行者；请刷新后重试。",
    	errInvalidDriver: "只能创建智能体；机器人由插件内建。",
    	errInvalidModel: "模型选择无效，请从模型目录里重新选择提供方与模型。",
    	workflowStatusActive: "可用",
    	workflowStatusRetired: "已停用",
    	workflowStatusDraft: "草稿",
    	errTooLarge: "AGENTS.md 超过 512 KiB，无法保存。",
    	errInvalidContent: "AGENTS.md 内容必须是文本。",
    	errInvalidSource: "来源不合法：请填 owner/repo 这类 npx skills 来源。",
    	errInvalidSkill: "skill 名称不合法。",
    	errNpxFailed: "npx skills 执行失败，输出见下方。",
    	errSkillsUnavailable: "没有找到 Skills 插件（@buka/dsh-plugin-skills），无法更新执行者 skills。",
    	errUpdateFailed: "更新 skills 失败："
    };
    // .build/workflows/client/workers/styles.js
    /**
    * 「执行者」页面的样式。
    *
    * 结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片列表），颜色与
    * 尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
    *
    * 列表条目（`.buka-workers-card`）的背景只在内容列内，不再用负 margin 外扩：
    * 页面是滚动容器且 `overflow-x:hidden`，外扩部分会被裁掉，滚动条出现 / 消失
    * 时右侧还会跟着抖；滚动容器统一 `scrollbar-gutter:stable` 预留槽位。
    *
    * @module @buka/dsh-plugin-workflows/workers/client/styles
    */
    /**
    * 页面样式：结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片
    * 列表），颜色与尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
    */
    const CSS = `
    .buka-workers-page{box-sizing:border-box;flex:1 1 auto;min-height:0;width:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}
    .buka-workers-head{box-sizing:border-box;flex:none;padding:calc(var(--buka-space-5, 24px) + var(--dsh-frame-top-clearance,0px)) 0 0;background:var(--dsw-alias-bg-base);z-index:2;position:sticky;top:0}
    .buka-workers-headInner{width:100%;display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
    .buka-workers-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-4, 16px);min-height:var(--buka-control-sm, 28px)}
    .buka-workers-barTabs{display:flex;align-items:center;min-width:0;flex:1 1 auto}
    .buka-workers-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workers-heading{flex:1 1 auto;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
    .buka-workers-title{margin:0;font-size:var(--buka-text-page, 20px);font-weight:500;line-height:var(--buka-line-28, 28px);overflow-wrap:anywhere}
    .buka-workers-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:var(--buka-space-2, 8px);flex:none;flex-wrap:wrap;min-width:0}
    .buka-workers-body{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:var(--buka-space-5, 24px) 0 var(--buka-space-7, 48px)}
    .buka-workers-pageBody{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px)}
    .buka-workers-detail{display:flex;flex-direction:column;gap:var(--buka-space-6, 32px);flex:1 1 auto;min-height:0}
    .buka-workers-status,.buka-workers-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workers-statusWithDot{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workers-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:var(--buka-space-3, 12px);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);display:flex;flex-wrap:wrap}
    .buka-workers-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:var(--buka-space-2, 8px);margin:0;padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);display:flex}
    .buka-workers-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
    .buka-workers-alert{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:var(--buka-space-2, 8px);margin:0;padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);display:flex;flex-direction:column}
    .buka-workers-alertHead{display:flex;align-items:flex-start;gap:var(--buka-space-2, 8px)}
    .buka-workers-alertHead>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
    .buka-workers-output{margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;width:100%;box-sizing:border-box}
    .buka-workers-outputLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);margin-top:2px}
    .buka-workers-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workers-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workers-inlineCode{font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px var(--buka-space-1, 4px);margin:0 2px;overflow-wrap:anywhere;word-break:break-all}
    .buka-workers-back svg{transform:rotate(180deg)}
    .buka-workers-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
    .buka-workers-card{border-radius:var(--dsw-radius-md);min-width:0;margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px)}
    .buka-workers-card.is-clickable{cursor:pointer}
    @media (hover:hover){.buka-workers-card.is-clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workers-card.is-clickable:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workers-cardHead{flex-direction:column;gap:var(--buka-space-1, 4px);padding:0;display:flex}
    .buka-workers-cardHead .buka-workers-titleRow{align-items:center}
    .buka-workers-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;display:flex}
    .buka-workers-titleActions{flex:none;align-items:center;gap:var(--buka-space-2, 8px);display:inline-flex;flex-wrap:wrap;justify-content:flex-end}
    .buka-workers-cardTitle{box-sizing:border-box;min-width:0;max-width:100%;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:var(--buka-text-title, 14px);font-weight:500;line-height:var(--buka-line-20, 20px);text-align:left;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
    .buka-workers-cardTitle:disabled{cursor:default}
    .buka-workers-cardTitle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm)}
    .buka-workers-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
    .buka-workers-avatarButton{padding:0;margin:0;border:0;background:0 0;line-height:0;cursor:pointer}
    @media (hover:hover){.buka-workers-avatarButton:hover{filter:brightness(.97)}}
    .buka-workers-avatarButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .buka-workers-avatarField{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
    .buka-workers-avatarGrid{display:grid;grid-template-columns:repeat(8,40px);gap:var(--buka-space-2, 8px);justify-content:start}
    @media (width<=480px){.buka-workers-avatarGrid{grid-template-columns:repeat(4,40px)}}
    .buka-workers-avatarOption{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer}
    @media (hover:hover){.buka-workers-avatarOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workers-avatarOption.is-selected{border-color:var(--dsw-alias-brand-primary);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
    .buka-workers-avatarOption:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    .buka-workers-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-18, 18px);display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;padding-left:34px}
    .buka-workers-cardDesc.is-empty{color:var(--dsw-alias-label-caption)}
    .buka-workers-workspaces{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0 calc(-1 * var(--buka-space-1, 4px));padding:0}
    .buka-workers-workspace{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:var(--buka-space-3, 12px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);margin:0;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
    @media (hover:hover){.buka-workers-workspace:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workers-workspace:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-workers-workspace:disabled{cursor:default;opacity:.72}
    .buka-workers-workspace>svg{flex:none;color:var(--dsw-alias-label-caption)}
    .buka-workers-workspaceText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
    .buka-workers-workspaceTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .buka-workers-workspacePath{font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .buka-workers-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--buka-space-4, 16px);padding:2px 0}
    .buka-workers-settingText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:var(--buka-space-1, 4px)}
    .buka-workers-settingHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workers-settingTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);font-weight:500;color:var(--dsw-alias-label-primary)}
    .buka-workers-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workers-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
    .buka-workers-switch.is-on{background:var(--dsw-alias-brand-primary)}
    .buka-workers-switch:disabled{cursor:default;opacity:.6}
    .buka-workers-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .buka-workers-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
    .buka-workers-switch.is-on .buka-workers-switchThumb{transform:translateX(16px)}
    @media (prefers-reduced-motion:reduce){.buka-workers-switch,.buka-workers-switchThumb{transition:none}}
    .buka-workers-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workers-card .buka-workers-hint{padding-left:34px}
    .buka-workers-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
    .buka-workers-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
    @media (hover:hover){.buka-workers-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
    .buka-workers-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
    .buka-workers-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-workers-sourceRow{display:flex;flex-wrap:wrap;align-items:center;gap:var(--buka-space-2, 8px)}
    .buka-workers-input{flex:1 1 260px;display:flex;min-width:0}
    .buka-workers-submit,.buka-workers-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 var(--buka-space-3, 12px);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workers-dialogForm{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
    .buka-workers-field{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
    .buka-workers-fieldLabel{color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);font-weight:500;line-height:var(--buka-line-20, 20px)}
    .buka-workers-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
    .buka-workers-select{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0 var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workers-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
    .buka-workers-select:disabled{opacity:.6}
    .buka-workers-modelSection{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
    .buka-workers-formActions{display:flex;align-items:center;gap:var(--buka-space-2, 8px)}
    .buka-workers-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
    .buka-workers-section{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
    .buka-workers-agentsSection{flex:1 1 auto;min-height:0}
    .buka-workers-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-3, 12px);flex-wrap:wrap}
    .buka-workers-sectionActions{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workers-sectionTitle{margin:0;font-size:var(--buka-text-section, 15px);font-weight:600;line-height:var(--buka-line-22, 22px)}
    .buka-workers-skillList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
    .buka-workers-skillRow{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:var(--dsw-radius-md);padding:var(--buka-space-2, 8px) var(--buka-space-2, 8px);margin:0 calc(-1 * var(--buka-space-2, 8px))}
    .buka-workers-skillHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
    .buka-workers-skillSource{max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .buka-workers-skillName{font-family:var(--ds-font-family-code);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
    .buka-workers-skillActions{flex:none;margin-left:auto;align-items:center;gap:var(--buka-space-2, 8px);display:inline-flex;flex-wrap:wrap}
    .buka-workers-skillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
    .buka-workers-headingRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0}
    .buka-workers-headingRow .buka-workers-title{flex:0 1 auto;min-width:0}
    .buka-workers-headingTag{flex:none;display:inline-flex;align-items:center;margin-left:2px}
    .buka-workers-descriptionInput{box-sizing:border-box;width:100%;min-height:60px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);tab-size:2}
    .buka-workers-descriptionInput.is-tall{min-height:140px}
    .buka-workers-descriptionInput::placeholder{color:var(--dsw-alias-label-caption)}
    .buka-workers-descriptionInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .buka-workers-descriptionInput:disabled{opacity:.65}
    .buka-workers-backButton{flex:none;margin-left:calc(-1 * var(--buka-space-1, 4px))}
    .buka-workers-tabs{display:flex;align-items:center;min-width:0;flex:none;overflow-x:auto;overscroll-behavior-x:contain}
    .buka-workers-tabList{width:fit-content;max-width:100%}
    .buka-workers-panel{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);flex:1 1 auto;min-height:0}
    .buka-workers-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
    .buka-workers-jobBlocker{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px)}
    .buka-workers-plainList{margin:0;padding-left:var(--buka-space-4, 16px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
    .buka-workers-candidatesHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
    .buka-workers-candidates{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0;padding:var(--buka-space-1, 4px);list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
    .buka-workers-candidate{display:flex;align-items:flex-start;gap:var(--buka-space-3, 12px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);cursor:pointer}
    @media (hover:hover){.buka-workers-candidate:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workers-candidate.isDisabled{cursor:not-allowed;opacity:.62}
    .buka-workers-candidateInput{flex:none;margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary)}
    .buka-workers-candidateText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
    .buka-workers-candidateName{font-family:var(--ds-font-family-code);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
    .buka-workers-candidateDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .buka-workers-candidateTag{flex:none;margin-left:auto;padding-left:var(--buka-space-2, 8px);display:inline-flex;align-items:center}
    .buka-workers-settings{display:flex;flex-direction:column;gap:var(--buka-space-6, 32px)}
    .buka-workers-settings>section+section{padding-top:var(--buka-space-6, 32px);border-top:0.5px solid var(--dsw-alias-border-l1)}
    .buka-workers-filesSection{flex:1 1 auto;min-height:0}
    .buka-workers-filesHeading{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
    .buka-workers-filesLayout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:var(--buka-space-4, 16px);min-height:0;flex:1 1 auto}
    .buka-workers-fileTree{box-sizing:border-box;display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0;max-height:520px;overflow:auto;overscroll-behavior:contain;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:var(--buka-space-2, 8px);background:var(--dsw-alias-bg-layer-1)}
    .buka-workers-fileTreeList{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none}
    .buka-workers-fileTreeItem{min-width:0;margin:0;padding:0}
    .buka-workers-fileTreeSummary{display:flex;align-items:center;gap:6px;padding:var(--buka-space-1, 4px) var(--buka-space-2, 8px);border-radius:var(--dsw-radius-sm);cursor:pointer;color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);list-style:none}
    .buka-workers-fileTreeSummary::-webkit-details-marker{display:none}
    .buka-workers-fileTreeSummary>svg,.buka-workers-fileTreeFile>svg{flex:none}
    @media (hover:hover){.buka-workers-fileTreeSummary:hover{background:var(--dsw-alias-interactive-bg-hover)}}
    .buka-workers-fileTreeFile{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;padding:var(--buka-space-1, 4px) var(--buka-space-2, 8px);border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);text-align:left;cursor:pointer}
    @media (hover:hover){.buka-workers-fileTreeFile:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
    .buka-workers-fileTreeFile.is-selected{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
    .buka-workers-fileTreeFile:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
    .buka-workers-fileTreeName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .buka-workers-filePreview{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0;min-height:0;max-height:520px;overflow:auto;overscroll-behavior:contain}
    .buka-workers-filePreviewHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-3, 12px);min-width:0}
    .buka-workers-filePreviewPath{min-width:0;font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
    .buka-workers-filePreviewMeta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
    .buka-workers-fileCode{width:100%}
    @media (width<=720px){.buka-workers-filesLayout{grid-template-columns:1fr}.buka-workers-fileTree{max-height:240px}.buka-workers-filePreview{max-height:none}}
    .buka-workers-favorites{display:flex;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
    .buka-workers-selectAll{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
    `;
    // .build/workflows/client/index.js
    /**
    * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的一个入口，页面首页
    * 顶部两个页签——「工作流」与「执行者」。
    *
    * 两半页面各自的契约不变：
    *
    * - 「执行者」页（`workers/`）负责「工作区身份」：挂载 / 删除工作区注册 /
    *   打开会话都走 DSH 的 Client Service（`workspaces.*`、`uiWorkspace.*`），
    *   磁盘内容由 Host 的 `/buka-workers/*` 路由处理。
    * - 「工作流」页（本目录其余模块）只做一条链：工作流列表 → 工作流
    *   （作业 / 结构图）→ 作业（概览 / 实时流程 / 看板 / 资产），数据与动作来自
    *   Host 的 `/buka-workflows/*` 路由。
    *
    * 两个页签由 `home.ts` 的 `HomePage` 装配：页签由 hash 驱动（`#/workers`
    * ↔ 执行者页签），跨页签跳转（如删除影响面里的「打开作业」）只写 hash。
    *
    * DSH 的面板由两处注册拼成（见 `@deepseek-ai/dsh-client-ui-sidebar` 与
    * `@deepseek-ai/dsh-client-ui-layout` 的契约）：
    *
    * - `sidebar.panellist` 里的一个图标组件：侧边栏负责按钮、tooltip 与选中态，
    *   图标只拿 `{ size, active }`；
    * - `main` 里以同一个 id 为 key 的页面组件：侧边栏点选时布局挂载它。
    *   组件的 props 由插槽位置与 `inject()` 决定：`t` 按 `locale` 绑定本命名空间，
    *   `workersT` 按执行者命名空间绑定，`getService` 取 DSH 的 Client Service。
    *
    * 本文件只导出 `inject` 与 `apply`：`window.__ModuleLoader__.load({ id, factory })`
    * 那层外壳由构建脚本 `scripts/build-clients.ts` 在构建时生成，源码里不写死包名。
    * 模块顶层只有纯声明（常量、文案、样式、辅助函数），不注册插槽、不发请求、
    * 不碰 DOM；所有副作用都在 `apply(ctx)` 里。
    */
    const inject = ["slots", "locale"];
    /**
    * 注册唯一的侧边栏条目与首页（两个页签），并在插件生效期注入文案与样式。
    */
    function apply(ctx) {
    	/**
    	* 页面从插件上下文里取 DSH 的 Client Service。`ctx.get` 在服务不存在
    	* 时会抛错，这里统一收敛成 null，由页面给出可读提示。
    	*
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
    	}), "buka-workers: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-workflows";
    		tag.textContent = CSS;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-workers: styles");
    	ctx.effect(() => ctx.locale.register(NS$1, {
    		zh: zh$1,
    		en: en$1
    	}), "buka-workflows: dictionaries");
    	ctx.effect(() => {
    		const tag = document.createElement("style");
    		tag.dataset.plugin = "@buka/dsh-plugin-workflows";
    		tag.textContent = CSS$1;
    		document.head.appendChild(tag);
    		return () => tag.remove();
    	}, "buka-workflows: styles");
    	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    		name: "sidebar.panellist",
    		id: PANEL_ID,
    		order: 30,
    		label: () => ctx.locale.bind(NS$1)("panel"),
    		locale: NS$1
    	}, WorkflowsPanelIcon));
    	ctx.slots.inject("main", () => ctx.slots.register({
    		name: "main",
    		key: PANEL_ID,
    		locale: NS$1,
    		inject: () => ({
    			getService,
    			workersT: ctx.locale.bind(NS)
    		})
    	}, HomePage));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports
  },
})
