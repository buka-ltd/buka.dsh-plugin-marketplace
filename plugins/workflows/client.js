/**
 * `@buka/dsh-plugin-workflows` 的浏览器一半：侧边栏的「工作流」页面。
 *
 * 这一半只做**只读观测**：workflow 由编排 preset（默认 `workflow-orchestrator`）
 * 的会话现场创建，没有可复用的流程列表，也没有“从这里启动流程”的入口。页面
 * 展示落盘的运行记录：
 *
 * - 列表：最近运行的状态、目标、runId、开始时间；
 * - 详情：纵向节点图 + 右侧节点详情；节点详情按「第几次执行」拆成 Tab，每个
 *   Tab 只放那一次的输入（渲染后的提示词）与输出（最终文本、附件下载、结构化数据、会话）；
 * - 每个节点可以「打开会话」，复用 DSH 的 `uiWorkspace.openSession(sessionId)`；
 *   客户端会话列表里还没有这个会话时先补一次 `sessions.refresh()`。
 *
 * 运行记录由 Host 的 `/buka-workflows/runs` 与 `/buka-workflows/run` 两条只读
 * 路由提供，附件下载走 `/buka-workflows/attachment`；有运行在跑时每 1.5 秒刷新一次（否则 5 秒），后台运行也能看到进度。
 *
 * 客户端模块格式固定为 `window.__ModuleLoader__.load({ id, factory })`，
 * `id` 必须等于包名。工厂函数顶层只有纯声明；所有副作用都在 `apply(ctx)` 里。
 */
window.__ModuleLoader__.load({
  id: '@buka/dsh-plugin-workflows',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      Button,
      Tooltip,
      Tag,
      Toast,
      StateDot,
      Input,
      Modal,
      IconChevronRightOutlineRegular,
      IconFolderOpenOutlineRegular,
      IconNewChatOutlineRegular,
      IconRefreshOutlineRegular,
      IconSettingsOutlineRegular,
      IconWarningOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** 词典命名空间。 */
    const NS = 'buka-workflows'

    /** 侧边栏条目 id 与 `main` 的 key 必须相同。 */
    const PANEL_ID = 'buka-workflows'


    /** 与 Host 一半（`lib/index.js`）的路由常量保持一致。 */
    const RUNS_ROUTE = '/buka-workflows/runs'
    const RUN_ROUTE = '/buka-workflows/run'
    const SETTINGS_ROUTE = '/buka-workflows/settings'

    /** 自动归档默认值：运行结束 24 小时后归档、168 小时后删除。 */
    const DEFAULT_ARCHIVE_HOURS = 24
    const DEFAULT_DELETE_HOURS = 168

    /** 页面刷新间隔：正在跑的运行也能看到节点进度。 */
    const REFRESH_MS = 5000

    /** 有运行在跑时缩短的刷新间隔：后台调度时这张图是唯一的观测点。 */
    const LIVE_REFRESH_MS = 1500

    /**
     * 预设头像的显示表：id 与 robots 插件的 `lib/avatar.js` 一一对应。插件之间
     * 不互相 import，所以两个浏览器一半各维护一份同一 id → emoji / 底色的映射；
     * 增删头像时要同步 `plugins/robots/client.js`。图模型只带 id，不认识的 id
     * 当作没有头像。
     */
    const AVATARS = {
      sprout: { emoji: '🌱', color: '#34A853' },
      sun: { emoji: '☀️', color: '#F2A60C' },
      cat: { emoji: '🐱', color: '#F2994A' },
      fox: { emoji: '🦊', color: '#EB6A4E' },
      panda: { emoji: '🐼', color: '#6B7280' },
      owl: { emoji: '🦉', color: '#8D6E63' },
      whale: { emoji: '🐳', color: '#4A90E2' },
      octopus: { emoji: '🐙', color: '#9B51E0' },
      bee: { emoji: '🐝', color: '#D9A400' },
      rocket: { emoji: '🚀', color: '#5B6BFF' },
      dino: { emoji: '🦖', color: '#27AE60' },
      ghost: { emoji: '👻', color: '#94A3B8' },
      penguin: { emoji: '🐧', color: '#2D9CDB' },
      unicorn: { emoji: '🦄', color: '#BB6BD9' },
      mushroom: { emoji: '🍄', color: '#EB5757' },
    }

    /**
     * 通用型机器人的固定头像：它不在普通预设表里，但 robots 服务的
     * `avatarMap()` 会返回 `robot`，节点图需要照常画 🤖。
     */
    const GENERAL_AVATAR = { emoji: '🤖', color: '#3B82F6' }

    /** 英文文案。 */
    const en = {
      panel: 'Workflows',
      title: 'Workflows',
      welcome: 'No workflow runs yet.',
      welcomeHint:
        'Start a session with the workflow-orchestrator preset and ask it to run a workflow. Gate-free runs continue in the background after the tool call returns; their node sessions appear here as the graph advances.',
      refresh: 'Refresh',
      loading: 'Loading…',
      loadFailed: 'Request failed:',
      empty: 'No workflow runs have been recorded yet.',
      back: 'Back to runs',
      error: 'Error',
      stopReason: 'Stop reason',
      openSession: 'Open session',
      openSessionFailed: 'Could not open the node session:',
      noUiWorkspace: 'This client has no uiWorkspace service, so the node session cannot be opened.',
      nodeSession: 'Robot session',
      nodeSessionsLegacy:
        'This node ran in more than one session (only in an older record); open the one you need.',
      waitingForAnswer: 'A robot is waiting for your answer',
      waitingForApproval: 'A robot is waiting for your approval',
      openAnswerSession: 'Open session to answer',
      openApprovalSession: 'Open session to approve',
      waitingForUser: 'Waiting for you',
      sessionLive: 'Current session',
      sessionCompacted: 'History compacted',
      sessionRecovering: 'Recovering (attempt {n})',
      sessionRecovered: 'Recovered',
      sessionCompactFailed: 'History compaction failed; the prompt was sent without it:',
      sessionReset: 'Could not resume the old session, so a new one was started:',
      unknown: 'Unknown',
      statusCompleted: 'Completed',
      statusRunning: 'Running',
      statusWaiting: 'Waiting',
      statusFailed: 'Failed',
      statusRejected: 'Rejected',
      statusCancelled: 'Cancelled',
      statusInterrupted: 'Interrupted',
      statusApproved: 'Approved',
      legendTypes: 'Node types',
      legendStates: 'Node states',
      legendEdges: 'Edges',
      legendTraversed: 'Traversed',
      legendPending: 'Not taken',
      legendApprove: 'Approve',
      legendReject: 'Reject',
      legendDone: 'Done',
      legendRunning: 'Running',
      legendWaiting: 'Waiting',
      legendFailed: 'Failed',
      legendIdle: 'Not run',
      visitsLabel: 'Visits',
      typeStart: 'Start',
      typeRobot: 'Robot',
      typeGate: 'Gate',
      typeEnd: 'End',
      stateIdle: 'Not run',
      stateUnavailable: 'Approval unavailable',
      inspector: 'Node detail',
      nodeNotRun: 'This node has not run in this workflow.',
      nodeStart: 'Start',
      startNodeHint:
        'The start node does not execute: it only gives the first real node its prompt through its outgoing edge. That prompt shows up in the first execution tab of the node it points to.',
      nodeUnreachable:
        'Nothing in this definition leads to this node, so it never runs. New definitions reject unreachable nodes; this line only explains a run recorded before that rule.',
      nodeExecutor: 'Executor',
      nodePrompt: 'Prompt',
      execution: 'Execution',
      executionInput: 'Task info',
      executionOutput: 'Output result',
      executionAttachments: 'Attachments',
      executionOutputAttachmentsOnly: 'No text output; see the attachments below.',
      attachmentDownload: 'Download',
      attachmentCount: '{n} attachments',
      routeLabel: 'Route',
      executionNoInput: 'This execution recorded no input.',
      executionInputMissing:
        'No input was recorded for this execution. Older runs did not persist a per-entry prompt, so the definition template is not shown again.',
      executionNoOutput: 'This execution produced no text output.',
      executionTimedOut: 'Timed out',
      executionAborted: 'Node aborted the run',
      executionPrev: 'Previous step',
      executionPrevNone: 'This is the first execution in this run.',
      executionNext: 'Next step',
      executionNextEnded: 'The run ended after this execution.',
      executionEnded: 'Run ended',
      executionStart: 'Run start',
      nodeExecutions: 'Executions',
      nodeTimeout: 'Timeout',
      nodeMaxVisits: 'Max visits',
      nodeEndStatus: 'End status',
      gateDetail: 'Gate detail',
      finalDeliverable: 'Final output',
      finalDeliverableEmpty: 'This run produced no robot output.',
      finalDeliverableFrom: 'From',
      promptTruncated: 'The prompt is truncated for display.',
      noGraph: 'This run has no saved definition snapshot, so the node graph cannot be drawn.',
      graphEmpty: 'The saved definition has no nodes.',
      settings: 'Archive settings',
      archiveSettingsTitle: 'Automatic archive',
      archiveEnabled: 'Automatic archive',
      archiveEnabledDesc:
        'Finished runs leave the list after the archive time, and are deleted with their record after the delete time. Runs that are still going are never archived or deleted.',
      settingsEnabled: 'On',
      settingsDisabled: 'Off',
      settingsLoading: 'Reading settings…',
      settingsLoadFailed: 'Could not read settings:',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      saved: 'Settings saved.',
      archiveAfterHours: 'Archive after',
      archiveAfterHoursHint: 'In hours, counted from when the run finished. Default 24 hours (1 day).',
      deleteAfterHours: 'Delete after',
      deleteAfterHoursHint:
        'In hours, counted from when the run finished; it must be later than the archive time. Default 168 hours (7 days).',
      hoursUnit: 'hours',
      archiveDefaultsHint:
        'Defaults: archive after 1 day (24 hours), delete after 7 days (168 hours). Whole hours only.',
      archiveInvalid: 'The archive time must be a whole number of hours between 1 and 720.',
      deleteInvalid: 'The delete time must be a whole number of hours between 2 and 8760.',
      deleteBeforeArchive: 'The delete time must be later than the archive time.',
      archiveView: 'Archived',
      archiveTitle: 'Archived workflows',
      archiveBack: 'Back to list',
      archiveEmpty: 'No archived runs yet.',
      archived: 'Archived',
    }

    /** 简体中文文案。 */
    const zh = {
      panel: '工作流',
      title: '工作流',
      welcome: '还没有运行过工作流。',
      welcomeHint:
        '用 workflow-orchestrator preset 新建一个会话，让它跑一个工作流；不含门禁的运行在工具返回后仍在后台调度节点会话，图会随执行推进。',
      refresh: '刷新',
      loading: '正在读取…',
      loadFailed: '请求失败：',
      empty: '还没有记录任何工作流运行。',
      back: '返回运行列表',
      error: '错误',
      stopReason: '停止原因',
      openSession: '打开会话',
      openSessionFailed: '打开节点会话失败：',
      noUiWorkspace: '当前客户端没有 uiWorkspace 服务，无法打开节点会话。',
      nodeSession: '机器人会话',
      nodeSessionsLegacy: '这个节点在多个会话里执行过（仅存在于旧记录）；需要看哪次就打开哪个会话。',
      waitingForAnswer: '机器人正在等待你回答',
      waitingForApproval: '机器人正在等待你批准',
      openAnswerSession: '打开会话回答',
      openApprovalSession: '打开会话审批',
      waitingForUser: '等待用户',
      sessionLive: '当前会话',
      sessionCompacted: '已压缩历史',
      sessionRecovering: '恢复中（第 {n} 次）',
      sessionRecovered: '已恢复',
      sessionCompactFailed: '历史压缩失败，已直接继续：',
      sessionReset: '旧会话无法续接，已新建会话：',
      unknown: '未知',
      statusCompleted: '已完成',
      statusRunning: '运行中',
      statusWaiting: '等待中',
      statusFailed: '失败',
      statusRejected: '已拒绝',
      statusCancelled: '已取消',
      statusInterrupted: '已中断',
      statusApproved: '已批准',
      legendTypes: '节点类型',
      legendStates: '节点状态',
      legendEdges: '连线',
      legendTraversed: '已走过',
      legendPending: '未走过',
      legendApprove: '批准',
      legendReject: '拒绝',
      legendDone: '已完成',
      legendRunning: '运行中',
      legendWaiting: '等待授权',
      legendFailed: '失败',
      legendIdle: '未运行',
      visitsLabel: '执行次数',
      typeStart: '开始',
      typeRobot: '机器人',
      typeGate: '门禁',
      typeEnd: '终止',
      stateIdle: '未运行',
      stateUnavailable: '审批不可用',
      inspector: '节点详情',
      nodeNotRun: '这个节点在本次运行中还没有执行。',
      nodeStart: '起点',
      startNodeHint:
        '开始节点不执行：它只通过出边给第一个真实节点定义 prompt，那条 prompt 会出现在目标节点第一次执行的「任务信息」里。',
      nodeUnreachable:
        '定义里没有任何连线能到达这个节点，所以它不会执行。新定义里这种节点会直接校验失败，这里只用于回看旧记录。',
      nodeExecutor: '执行人',
      nodePrompt: '提示词',
      execution: '执行',
      executionInput: '任务信息',
      executionOutput: '输出结果',
      executionAttachments: '附件',
      executionOutputAttachmentsOnly: '这次执行没有文本输出，请查看下面的附件。',
      attachmentDownload: '下载',
      attachmentCount: '{n} 个附件',
      routeLabel: '路由',
      executionNoInput: '这次执行没有记录输入。',
      executionInputMissing: '这次执行没有记录输入；旧运行没有按次落盘提示词，所以这里不重复展示定义里的模板。',
      executionNoOutput: '这次执行没有文本输出。',
      executionTimedOut: '超时',
      executionAborted: '节点主动终止运行',
      executionPrev: '上一步',
      executionPrevNone: '这是本次运行的第一次执行。',
      executionNext: '下一步',
      executionNextEnded: '这次执行后运行结束。',
      executionEnded: '运行结束',
      executionStart: '运行起点',
      nodeExecutions: '执行记录',
      nodeTimeout: '超时',
      nodeMaxVisits: '最多访问',
      nodeEndStatus: '终止状态',
      gateDetail: '门禁说明',
      finalDeliverable: '最终输出',
      finalDeliverableEmpty: '这次运行没有机器人输出。',
      finalDeliverableFrom: '来自',
      promptTruncated: '提示词过长，仅展示前面一部分。',
      noGraph: '这次运行没有保存定义快照，无法绘制节点图。',
      graphEmpty: '保存的定义里没有节点。',
      settings: '归档设置',
      archiveSettingsTitle: '自动归档设置',
      archiveEnabled: '自动归档',
      archiveEnabledDesc: '结束的运行超过归档时间后从列表里隐藏；超过删除时间后连同记录一起删除。仍在运行的运行不会被归档或删除。',
      settingsEnabled: '已启用',
      settingsDisabled: '已停用',
      settingsLoading: '正在读取设置…',
      settingsLoadFailed: '读取设置失败：',
      save: '保存',
      saving: '正在保存…',
      cancel: '取消',
      saved: '设置已保存。',
      archiveAfterHours: '归档时间',
      archiveAfterHoursHint: '按小时计，从运行结束算起。默认 24 小时（1 天）。',
      deleteAfterHours: '删除时间',
      deleteAfterHoursHint: '按小时计，从运行结束算起，必须晚于归档时间。默认 168 小时（7 天）。',
      hoursUnit: '小时',
      archiveDefaultsHint: '默认：超过 1 天（24 小时）自动归档，超过 7 天（168 小时）自动删除。时间按整小时填写。',
      archiveInvalid: '归档时间需为 1–720 之间的整数小时。',
      deleteInvalid: '删除时间需为 2–8760 之间的整数小时。',
      deleteBeforeArchive: '删除时间必须晚于归档时间。',
      archiveView: '已归档',
      archiveTitle: '已归档的工作流',
      archiveBack: '返回列表',
      archiveEmpty: '还没有已归档的运行。',
      archived: '已归档',
    }

    /** 页面样式：沿用 Robots / Skills 页的标题行 + 960px 内容区 + 卡片结构。 */
    const CSS = `
.buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
@media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
.buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));max-width:none;margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
.buka-workflows-titleRow{display:flex;flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:16px;min-width:0}
.buka-workflows-titleCluster{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px}
.buka-workflows-title{margin:0;font-size:20px;font-weight:500;line-height:28px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-toolbar{flex:none;display:flex;align-items:center;gap:8px}
.buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;display:flex;flex-direction:column;padding:32px 0 24px}
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
.buka-workflows-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
@media (hover:hover){.buka-workflows-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workflows-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workflows-backButton{flex:none;margin-left:-4px}
.buka-workflows-back svg{transform:rotate(180deg)}
.buka-workflows-split{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:32px;align-items:start}
@media (width<=860px){.buka-workflows-split{grid-template-columns:minmax(0,1fr)}}
.buka-workflows-graphPane{min-width:0}
.buka-workflows-detailPane{min-width:0;position:sticky;top:0}
@media (width<=860px){.buka-workflows-detailPane{position:static}}
.buka-workflows-vgraph{position:relative;min-width:0}
.buka-workflows-vgraphRows{position:relative;display:flex;flex-direction:column}
.buka-workflows-vgraphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
.buka-workflows-vgraphRow{display:flex;align-items:center;min-width:0}
.buka-workflows-vgraphRail{flex:none}
.buka-workflows-vgraphCapsuleWrap{flex:1 1 auto;min-width:0;display:flex;align-items:center}
.buka-workflows-capsule{flex:none;display:inline-flex;align-items:center;max-width:280px;box-sizing:border-box;margin:0;padding:3px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.buka-workflows-capsule.is-robot{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.buka-workflows-capsule.has-avatar{padding-left:4px}
.buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workflows-capsuleAvatar{margin-right:6px}
.buka-workflows-inspectorAvatar{margin-right:2px}
.buka-workflows-capsule.is-gate{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-capsule.is-end{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.buka-workflows-capsule.is-start{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-capsule.is-idle{border-color:var(--dsw-alias-border-l2);border-style:dashed;color:var(--dsw-alias-label-tertiary)}
.buka-workflows-capsule.is-running{animation:buka-workflows-pulse 1.8s ease-out infinite}
.buka-workflows-visitBadge{flex:none;margin-left:6px;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
@media (hover:hover){.buka-workflows-capsule:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-capsule:focus-visible,.buka-workflows-capsule.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.buka-workflows-capsule.is-running{animation:none}}
.buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.25;stroke-dasharray:4 4;stroke-linecap:round;opacity:.6;transition:stroke-width .16s ease,opacity .16s ease,stroke .16s ease}
.buka-workflows-edge.is-traversed{stroke:var(--dsw-alias-brand-primary);stroke-width:1.75;stroke-dasharray:none;opacity:1}
.buka-workflows-edge.is-approve{stroke:var(--dsw-alias-state-success-primary)}
.buka-workflows-edge.is-reject{stroke:var(--dsw-alias-state-error-primary)}
.buka-workflows-edge.is-approve:not(.is-traversed),.buka-workflows-edge.is-reject:not(.is-traversed){opacity:.45}
.buka-workflows-edge.is-hovered{stroke-width:2.5;opacity:1;stroke-dasharray:none}
.buka-workflows-edge.is-next.is-hovered{stroke:var(--dsw-alias-brand-primary)}
.buka-workflows-edge.is-approve.is-hovered{stroke:var(--dsw-alias-state-success-primary)}
.buka-workflows-edge.is-reject.is-hovered{stroke:var(--dsw-alias-state-error-primary)}
.buka-workflows-edge.is-dimmed:not(.is-hovered){opacity:.5}
.buka-workflows-edgeHit{fill:none;stroke:transparent;stroke-width:14;stroke-linecap:round;pointer-events:stroke}
.buka-workflows-edgeTip{position:fixed;z-index:1000;max-width:240px;box-sizing:border-box;padding:4px 9px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:16px;font-weight:500;box-shadow:0 4px 12px rgba(17,20,28,.12);pointer-events:none;overflow-wrap:anywhere}
.buka-workflows-edgeTip.is-anchored{transform:translateY(-50%)}
.buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.7;transition:opacity .16s ease,fill .16s ease}
.buka-workflows-edgeArrow.is-traversed{fill:var(--dsw-alias-brand-primary);opacity:1}
.buka-workflows-edgeArrow.is-approve{fill:var(--dsw-alias-state-success-primary)}
.buka-workflows-edgeArrow.is-reject{fill:var(--dsw-alias-state-error-primary)}
.buka-workflows-edgeArrow.is-approve,.buka-workflows-edgeArrow.is-reject{opacity:.9}
.buka-workflows-edgeArrow.is-approve:not(.is-traversed),.buka-workflows-edgeArrow.is-reject:not(.is-traversed){opacity:.5}
.buka-workflows-edgeArrow.is-hovered{opacity:1}
.buka-workflows-edgeArrow.is-next.is-hovered{fill:var(--dsw-alias-brand-primary)}
.buka-workflows-edgeArrow.is-approve.is-hovered{fill:var(--dsw-alias-state-success-primary)}
.buka-workflows-edgeArrow.is-reject.is-hovered{fill:var(--dsw-alias-state-error-primary)}
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
.buka-workflows-legendCapsule.is-gate{border-color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendCapsule.is-end{border-color:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendCapsule.is-start{border-color:var(--dsw-alias-border-l2)}
.buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
.buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption);border-top-style:dashed}
.buka-workflows-legendLine.is-traversed{border-top-color:var(--dsw-alias-brand-primary);border-top-style:solid}
.buka-workflows-legendLine.is-approve{border-top-color:var(--dsw-alias-state-success-primary);border-top-style:solid}
.buka-workflows-legendLine.is-reject{border-top-color:var(--dsw-alias-state-error-primary)}
.buka-workflows-inspector{display:flex;flex-direction:column;gap:14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:14px 16px}
.buka-workflows-inspectorHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-inspectorTitle{flex:1 1 auto;min-width:0;font-size:15px;font-weight:500;line-height:22px;overflow-wrap:anywhere}
.buka-workflows-inspectorId{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-markdown-code-block);border-radius:var(--dsw-radius-sm);padding:1px 5px;overflow-wrap:anywhere}
.buka-workflows-inspectorClose{margin-left:auto}
.buka-workflows-inspectorSection{display:flex;flex-direction:column;gap:8px}
.buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.buka-workflows-attachmentLink{color:var(--dsw-alias-brand-primary);text-decoration:none;font-family:var(--ds-font-family-code);font-size:11px;overflow-wrap:anywhere}
.buka-workflows-attachmentLink:hover{text-decoration:underline}
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
`

    /**
     * 把失败原因转成展示文本。
     *
     * @param {unknown} failure
     * @returns {string}
     */
    function messageOf(failure) {
      return failure instanceof Error ? failure.message : String(failure)
    }

    /**
     * 边名字的落点：钉在轨道右侧、这条线中段的高度上，不跟着鼠标走。中段正好
     * 落在两行胶囊之间，名字不会压住节点；拿不到 SVG 几何时返回 `null`，退回
     * 鼠标位置。
     *
     * @param {unknown} path 悬浮中的命中区 path
     * @param {unknown} arrow 这条线的中段箭头
     * @param {number} railWidth 轨道宽度
     * @returns {{ left: number, top: number } | null}
     */
    function edgeTipAnchor(path, arrow, railWidth) {
      if (path === null || typeof path !== 'object') return null
      const svg = path.ownerSVGElement
      if (svg === null || svg === undefined || typeof svg.getBoundingClientRect !== 'function') return null
      if (arrow === null || typeof arrow !== 'object') return null
      if (typeof arrow.x !== 'number' || typeof arrow.y !== 'number') return null
      const rect = svg.getBoundingClientRect()
      return { left: rect.left + railWidth, top: rect.top + arrow.y }
    }

    /**
     * 边名字 tooltip 的位置：优先用钉住的中段落点，否则跟随鼠标；两种情况都夹
     * 在视口内，靠近右 / 下边缘时不会被裁掉。测试环境没有 `window`，此时直接
     * 用原值。
     *
     * @param {{ x: number, y: number, anchor?: { left: number, top: number } | null }} tip
     * @returns {{ left: string, top: string }}
     */
    function edgeTipPosition(tip) {
      const anchor = tip.anchor ?? null
      const left = anchor === null ? tip.x + 12 : anchor.left
      const top = anchor === null ? tip.y + 14 : anchor.top
      const width =
        typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0
      const height =
        typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 0
      if (width <= 0 || height <= 0) return { left: `${left}px`, top: `${top}px` }
      // 钉住的落点是名字的中心高度，跟随鼠标的落点是名字的左上角。
      const minTop = anchor === null ? 8 : 24
      const maxTop = height - (anchor === null ? 40 : 24)
      return {
        left: `${Math.max(8, Math.min(left, width - 248))}px`,
        top: `${Math.max(minTop, Math.min(top, maxTop))}px`,
      }
    }

    /**
     * 请求 Host 的 JSON 路由；非 2xx 或 `ok !== true` 时抛出带 `code` 的错误。
     *
     * @param {string} url
     * @returns {Promise<any>}
     */
    async function requestJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => null)
      if (!response.ok || body === null || body.ok !== true) {
        const error = new Error(body?.message ?? `HTTP ${response.status}`)
        error.code = body?.code
        throw error
      }
      return body
    }

    /**
     * 状态 → Tag tone。
     *
     * @param {string} status
     * @returns {'success' | 'info' | 'warning' | 'neutral'}
     */
    function statusTone(status) {
      switch (status) {
        case 'completed':
        case 'approved':
          return 'success'
        case 'running':
        case 'waiting':
          return 'info'
        case 'failed':
        case 'rejected':
        case 'cancelled':
        case 'interrupted':
        case 'unavailable':
          return 'warning'
        default:
          return 'neutral'
      }
    }

    /**
     * 状态 → 本地化文案。
     *
     * @param {function(string): string} t
     * @param {string} status
     * @returns {string}
     */
    function statusLabel(t, status) {
      switch (status) {
        case 'completed':
          return t('statusCompleted')
        case 'running':
          return t('statusRunning')
        case 'waiting':
          return t('statusWaiting')
        case 'failed':
          return t('statusFailed')
        case 'rejected':
          return t('statusRejected')
        case 'cancelled':
          return t('statusCancelled')
        case 'interrupted':
          return t('statusInterrupted')
        case 'approved':
          return t('statusApproved')
        case 'unavailable':
          return t('stateUnavailable')
        case 'idle':
          return t('stateIdle')
        default:
          return t('unknown')
      }
    }

    /**
     * 时间戳 → 本地时间。
     *
     * @param {unknown} value
     * @returns {string}
     */
    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      try {
        return new Date(value).toLocaleString()
      } catch {
        return '—'
      }
    }

    /**
     * 节点耗时。
     *
     * @param {Record<string, any>} step
     * @returns {string}
     */
    function formatDuration(step) {
      const started = typeof step?.startedAt === 'number' ? step.startedAt : null
      const finished = typeof step?.finishedAt === 'number' ? step.finishedAt : null
      if (started === null || finished === null || finished < started) return ''
      return formatMs(finished - started)
    }

    /**
     * 毫秒数 → 简短耗时。
     *
     * @param {unknown} value
     * @returns {string}
     */
    function formatMs(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
      if (value < 1000) return `${Math.max(1, Math.round(value))}ms`
      const seconds = value / 1000
      if (seconds < 60) return `${seconds.toFixed(1)}s`
      return `${(seconds / 60).toFixed(1)}min`
    }

    /**
     * 字节数 → 简短的附件大小。
     *
     * @param {unknown} value
     * @returns {string}
     */
    function formatBytes(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
      if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
    }

    /**
     * 附件下载地址：只用运行 id、执行序号、节点 id 与清单里的文件名。
     *
     * @param {Record<string, any> | null} run
     * @param {Record<string, any>} step
     * @param {Record<string, any>} attachment
     * @returns {string}
     */
    function attachmentHref(run, step, attachment) {
      const params = new URLSearchParams({
        runId: typeof run?.runId === 'string' ? run.runId : '',
        seq: String(step?.seq ?? ''),
        nodeId: typeof step?.nodeId === 'string' ? step.nodeId : '',
        name: typeof attachment?.name === 'string' ? attachment.name : '',
      })
      return `/buka-workflows/attachment?${params.toString()}`
    }

    /**
     * 附件清单：文件名、大小、描述与下载入口。
     *
     * @param {Record<string, any> | null} run
     * @param {Record<string, any>} step
     * @param {Array<Record<string, any>>} attachments
     * @returns {object | null}
     */
    function renderAttachments(t, run, step, attachments) {
      if (!Array.isArray(attachments) || attachments.length === 0) return null
      return h(
        'ul',
        { className: 'buka-workflows-attachmentList' },
        attachments.map((attachment, index) =>
          h(
            'li',
            {
              key: `${String(attachment?.index ?? index)}-${String(attachment?.name ?? '')}`,
              className: 'buka-workflows-attachment',
            },
            h(
              'a',
              {
                className: 'buka-workflows-attachmentLink',
                href: attachmentHref(run, step, attachment),
                download: typeof attachment?.name === 'string' ? attachment.name : undefined,
              },
              h('span', { className: 'buka-workflows-attachmentName' }, String(attachment?.name ?? 'attachment')),
            ),
            h('span', { className: 'buka-workflows-attachmentMeta' }, formatBytes(attachment?.bytes)),
            typeof attachment?.description === 'string' && attachment.description !== ''
              ? h('span', { className: 'buka-workflows-attachmentDescription' }, attachment.description)
              : null,
            h(
              'a',
              {
                className: 'buka-workflows-attachmentDownload',
                href: attachmentHref(run, step, attachment),
                download: typeof attachment?.name === 'string' ? attachment.name : undefined,
              },
              t('attachmentDownload'),
            ),
          ),
        ),
      )
    }

    /**
     * 按字符数截断长文本（prompt 可能有 256 KiB，不能整段渲染）。
     *
     * @param {unknown} value
     * @param {number} limit
     * @returns {{ text: string, truncated: boolean }}
     */
    function truncateText(value, limit) {
      if (typeof value !== 'string' || value === '') return { text: '', truncated: false }
      if (value.length <= limit) return { text: value, truncated: false }
      return { text: value.slice(0, limit), truncated: true }
    }

    /**
     * 节点步骤概要：创建者写的 summary，缺省时退回提示词的第一行。
     *
     * @param {Record<string, any> | null} config
     * @returns {string}
     */
    function summaryText(config) {
      if (config === null || typeof config !== 'object') return ''
      const summary = typeof config.summary === 'string' ? config.summary.trim() : ''
      if (summary !== '') return summary
      const prompt = typeof config.prompt === 'string' ? config.prompt : ''
      const first = prompt
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '')
      if (first === undefined) return ''
      return truncateText(first, 160).text
    }

    /**
     * 头像 id → 预设；不认识的 id 返回 null（图上就不画头像）。
     *
     * @param {unknown} id
     * @returns {{ emoji: string, color: string } | null}
     */
    function avatarPreset(id) {
      if (id === 'robot') return GENERAL_AVATAR
      return typeof id === 'string' && Object.hasOwn(AVATARS, id) ? AVATARS[id] : null
    }

    /**
     * 机器人头像小圆片：emoji 画在预设色的浅底上。[size] 是直径（px），`className`
     * 给胶囊 / 详情标题这类不同位置补间距。
     *
     * @param {unknown} avatar 头像 id
     * @param {number} size
     * @param {string} [className]
     * @returns {object | null} React 元素；没有头像时返回 null
     */
    function renderAvatar(avatar, size, className = '') {
      const preset = avatarPreset(avatar)
      if (preset === null) return null
      return h(
        'span',
        {
          className: `buka-workflows-avatar${className === '' ? '' : ` ${className}`}`,
          style: {
            width: `${size}px`,
            height: `${size}px`,
            fontSize: `${Math.max(8, Math.round(size * 0.62))}px`,
            backgroundColor: `color-mix(in srgb, ${preset.color} 18%, transparent)`,
            borderColor: `color-mix(in srgb, ${preset.color} 38%, transparent)`,
          },
          'aria-hidden': true,
        },
        preset.emoji,
      )
    }

    /**
     * 节点标题：步骤概要就是标题。机器人节点用创建者写的 summary（旧定义退回
     * 提示词第一行，再退回机器人名），门禁用标题，终止节点用 id。
     *
     * @param {Record<string, any>} node 图模型里的节点
     * @param {Record<string, any> | null} config 定义快照里的节点
     * @returns {string}
     */
    function nodeTitle(node, config) {
      if (node.type === 'robot') return summaryText(config) || node.robot || node.id
      if (node.type === 'gate') return node.title || node.id
      return node.id
    }

    /**
     * 结果字段里的标量值 → 可读文本。
     *
     * @param {unknown} value
     * @returns {string}
     */
    function dataValueText(value) {
      if (value === null) return 'null'
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length} items]`
      if (typeof value === 'object') return '{}'
      return String(value)
    }

    /**
     * 节点类型 → 本地化名称。
     *
     * @param {function(string): string} t
     * @param {string} type
     * @returns {string}
     */
    function typeLabel(t, type) {
      if (type === 'start') return t('typeStart')
      if (type === 'robot') return t('typeRobot')
      if (type === 'gate') return t('typeGate')
      if (type === 'end') return t('typeEnd')
      return String(type)
    }

    /**
     * 节点状态 → 卡片样式类。
     *
     * @param {string} state
     * @returns {'done' | 'running' | 'waiting' | 'failed' | 'idle'}
     */
    function stateClass(state) {
      switch (state) {
        case 'completed':
        case 'approved':
          return 'done'
        case 'running':
          return 'running'
        case 'waiting':
          return 'waiting'
        case 'failed':
        case 'rejected':
        case 'cancelled':
        case 'interrupted':
        case 'unavailable':
          return 'failed'
        default:
          return 'idle'
      }
    }

    /**
     * 从定义快照里取一个节点的原始配置（用于提示词、门禁说明）。
     *
     * @param {unknown} definition
     * @param {string} id
     * @returns {Record<string, any> | null}
     */
    function definitionNode(definition, id) {
      if (definition === null || typeof definition !== 'object') return null
      const plan = definition.plan
      if (plan !== null && typeof plan === 'object' && plan.nodes !== null && typeof plan.nodes === 'object') {
        const node = plan.nodes[id]
        if (node !== null && typeof node === 'object') return node
      }
      const raw = definition.definition
      if (raw !== null && typeof raw === 'object' && Array.isArray(raw.nodes)) {
        for (const node of raw.nodes) {
          if (node !== null && typeof node === 'object' && node.id === id) return node
        }
      }
      return null
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
     * @param {Record<string, any>} node 图模型里的节点
     * @param {Array<Record<string, any>>} nodeSteps 该节点的执行记录
     * @param {string} liveSession 运行中节点在 `run.current` 上的会话 id（没有则为空串）
     * @param {Record<string, any> | null} run 运行记录
     * @returns {string[]}
     */
    function collectNodeSessionIds(node, nodeSteps, liveSession, run) {
      const ids = []
      const seen = new Set()
      /** @param {unknown} value */
      const add = (value) => {
        if (typeof value !== 'string' || value === '' || seen.has(value)) return
        seen.add(value)
        ids.push(value)
      }
      add(liveSession)
      const sessions = Array.isArray(run?.sessions) ? run.sessions : []
      for (const session of sessions) {
        if (session === null || typeof session !== 'object') continue
        const entries = Array.isArray(session.entries) ? session.entries : []
        let listedHere = false
        for (const entry of entries) {
          if (entry === null || typeof entry !== 'object' || entry.nodeId !== node.id) continue
          listedHere = true
          add(typeof entry.sessionId === 'string' ? entry.sessionId : session.sessionId)
        }
        if (listedHere) continue
        // 旧记录没有 entries：会话记录按机器人归属，节点本身也按首末节点兜底。
        const sameRobot =
          node.type === 'robot' && typeof node.robot === 'string' && node.robot !== '' && session.robot === node.robot
        const touchesNode = session.firstNodeId === node.id || session.lastNodeId === node.id
        if (sameRobot || touchesNode) add(session.sessionId)
      }
      for (const step of nodeSteps) add(step?.sessionId)
      return ids
    }

    /**
     * 一行「键：值」。
     *
     * @param {string} key
     * @param {string} value
     * @returns {object} React 元素
     */
    function kvRow(key, value) {
      return h(
        'div',
        { className: 'buka-workflows-kvRow' },
        h('span', { className: 'buka-workflows-kvKey' }, key),
        h('span', { className: 'buka-workflows-kvValue' }, value),
      )
    }

    /**
     * 侧边栏图标：两个节点与一条连接线。
     *
     * @param {{ size: number }} props
     * @returns {object} React 元素
     */
    function WorkflowsPanelIcon({ size }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
        },
        h('rect', {
          x: 2,
          y: 3,
          width: 4.4,
          height: 4.4,
          rx: 1.4,
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('rect', {
          x: 9.6,
          y: 8.6,
          width: 4.4,
          height: 4.4,
          rx: 1.4,
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('path', {
          d: 'M6.4 5.2h2.2a2 2 0 0 1 2 2v1.4',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * 侧边栏「工作流」页面。
     *
     * @param {{ t: function, getService: function(string): any }} props
     * @returns {object} React 元素
     */
    function WorkflowsPage(props) {
      const t = props.t
      const getService = typeof props.getService === 'function' ? props.getService : () => null

      /** 列表状态。 */
      const [list, setList] = React.useState({ status: 'loading', runs: [], archivedCount: 0, error: null })

      /** 当前查看的 runId；null 表示列表视图。 */
      const [selectedId, setSelectedId] = React.useState(null)

      /** 详情状态。 */
      const [detail, setDetail] = React.useState({ status: 'idle', data: null, error: null })

      /** 手动刷新与定时刷新都递增它。 */
      const [tick, setTick] = React.useState(0)

      /** Toast 文案。 */
      const [notice, setNotice] = React.useState(null)

      /** 节点图里选中的节点 id；null 表示没有打开节点详情。 */
      const [selectedNodeId, setSelectedNodeId] = React.useState(null)

      /** 详情里选中的第几次执行；null 表示默认看最近一次。 */
      const [executionIndex, setExecutionIndex] = React.useState(null)

      /**
       * 鼠标悬停的边名字：`{ key, kind, text, x, y }`。只展示名字，不展示提示词等
       * 运行配置——那些信息对观察运行没有帮助。
       */
      const [edgeTip, setEdgeTip] = React.useState(null)

      /** 列表是否只看已归档的运行。 */
      const [showArchived, setShowArchived] = React.useState(false)

      /** 自动归档设置对话框是否打开。 */
      const [settingsOpen, setSettingsOpen] = React.useState(false)

      /** 设置草稿；小时存字符串，输入框直接绑它。null 表示还没读到设置。 */
      const [settingsDraft, setSettingsDraft] = React.useState(null)

      /** 正在读取设置。 */
      const [settingsLoading, setSettingsLoading] = React.useState(false)

      /** 正在保存设置。 */
      const [settingsSaving, setSettingsSaving] = React.useState(false)

      /** 设置相关的错误文案。 */
      const [settingsError, setSettingsError] = React.useState(null)

      // 列表：首次加载与每次刷新；归档视图只取已归档的运行。
      React.useEffect(() => {
        let cancelled = false
        setList((previous) => ({
          ...previous,
          status: previous.runs.length > 0 ? previous.status : 'loading',
        }))
        requestJson(RUNS_ROUTE + (showArchived ? '?archived=1' : '')).then(
          (body) => {
            if (cancelled) return
            setList({
              status: 'ready',
              runs: Array.isArray(body.runs) ? body.runs : [],
              archivedCount: typeof body.archivedCount === 'number' ? body.archivedCount : 0,
              error: null,
            })
          },
          (failure) => {
            if (cancelled) return
            setList((previous) => ({ ...previous, status: 'ready', error: messageOf(failure) }))
          },
        )
        return () => {
          cancelled = true
        }
      }, [tick, showArchived])

      // 详情：选中 run 后加载，并随刷新更新。
      React.useEffect(() => {
        if (selectedId === null) {
          setDetail({ status: 'idle', data: null, error: null })
          return undefined
        }
        let cancelled = false
        setDetail((previous) => ({
          status: previous.data === null ? 'loading' : previous.status,
          data: previous.data,
          error: null,
        }))
        requestJson(`${RUN_ROUTE}?runId=${encodeURIComponent(selectedId)}`).then(
          (body) => {
            if (cancelled) return
            setDetail({ status: 'ready', data: body, error: null })
          },
          (failure) => {
            if (cancelled) return
            setDetail((previous) => ({ ...previous, status: 'ready', error: messageOf(failure) }))
          },
        )
        return () => {
          cancelled = true
        }
      }, [selectedId, tick])

      // 页面打开期间定时刷新：有运行在跑时快一点，否则保持低频。
      const live =
        (Array.isArray(list.runs) &&
          list.runs.some((run) => run?.status === 'running' || run?.status === 'waiting')) ||
        detail.data?.run?.status === 'running' ||
        detail.data?.run?.status === 'waiting'
      React.useEffect(() => {
        const timer = setInterval(() => setTick((value) => value + 1), live ? LIVE_REFRESH_MS : REFRESH_MS)
        return () => clearInterval(timer)
      }, [live])

      // 换一次运行就收起上一个节点详情。
      React.useEffect(() => {
        setSelectedNodeId(null)
        setExecutionIndex(null)
        setEdgeTip(null)
      }, [selectedId])

      // 边上的悬浮名字钉在线中段；页面一滚动 / 尺寸变化就把旧坐标收起来，避免
      // 名字停在已经离开的位置。监听器只在“有/没有”之间切换，不跟着每次
      // mousemove 重装。
      const hasEdgeTip = edgeTip !== null
      React.useEffect(() => {
        if (!hasEdgeTip) return undefined
        const hide = () => setEdgeTip(null)
        window.addEventListener('scroll', hide, true)
        window.addEventListener('resize', hide)
        return () => {
          window.removeEventListener('scroll', hide, true)
          window.removeEventListener('resize', hide)
        }
      }, [hasEdgeTip])

      /**
       * 用 Toast 显示一次操作结果。
       *
       * @param {'success' | 'error'} kind
       * @param {string} text
       */
      function flash(kind, text) {
        setNotice({ kind, text, seq: Date.now() + Math.random() })
      }

      /** 手动刷新。 */
      function reload() {
        setTick((value) => value + 1)
      }

      /**
       * 校验设置草稿里的两个小时数：必须是整数、落在范围内，且删除晚于归档。
       *
       * @param {{ enabled: boolean, archiveHours: string, deleteHours: string }} draft
       * @returns {string | null} 错误文案；null 表示通过
       */
      function settingsValidationError(draft) {
        const archiveText = String(draft.archiveHours ?? '').trim()
        const deleteText = String(draft.deleteHours ?? '').trim()
        if (!/^\d+$/u.test(archiveText)) return t('archiveInvalid')
        const archiveHours = Number(archiveText)
        if (archiveHours < 1 || archiveHours > 720) return t('archiveInvalid')
        if (!/^\d+$/u.test(deleteText)) return t('deleteInvalid')
        const deleteHours = Number(deleteText)
        if (deleteHours < 2 || deleteHours > 8760) return t('deleteInvalid')
        if (deleteHours <= archiveHours) return t('deleteBeforeArchive')
        return null
      }

      /**
       * 打开自动归档设置对话框：先清空草稿，再读 Host 的当前设置。读失败时留在
       * 对话框里说明原因；读取期间显示 loading。
       */
      async function openSettingsDialog() {
        setSettingsOpen(true)
        setSettingsError(null)
        setSettingsDraft(null)
        setSettingsLoading(true)
        try {
          const body = await requestJson(SETTINGS_ROUTE)
          const settings = body.settings ?? {}
          setSettingsDraft({
            enabled: settings.enabled === true,
            archiveHours: String(settings.archiveAfterHours ?? DEFAULT_ARCHIVE_HOURS),
            deleteHours: String(settings.deleteAfterHours ?? DEFAULT_DELETE_HOURS),
          })
        } catch (failure) {
          setSettingsError(`${t('settingsLoadFailed')} ${messageOf(failure)}`)
        } finally {
          setSettingsLoading(false)
        }
      }

      /** 关闭设置对话框；保存中不响应关闭。 */
      function closeSettingsDialog() {
        if (settingsSaving) return
        setSettingsOpen(false)
        setSettingsError(null)
        setSettingsDraft(null)
      }

      /**
       * 保存自动归档设置：校验通过后写回 Host，成功后关闭对话框并刷新列表（归档
       * 结果可能刚刚变化）。
       */
      async function saveSettings() {
        const draft = settingsDraft
        if (draft === null || settingsValidationError(draft) !== null) return
        setSettingsSaving(true)
        setSettingsError(null)
        try {
          const response = await fetch(SETTINGS_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              enabled: draft.enabled,
              archiveAfterHours: Number(draft.archiveHours),
              deleteAfterHours: Number(draft.deleteHours),
            }),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || body === null || body.ok !== true) {
            const error = new Error(body?.message ?? `HTTP ${response.status}`)
            error.code = body?.code
            throw error
          }
          setSettingsOpen(false)
          setSettingsDraft(null)
          flash('success', t('saved'))
          reload()
        } catch (failure) {
          setSettingsError(`${t('settingsSaveFailed')} ${messageOf(failure)}`)
        } finally {
          setSettingsSaving(false)
        }
      }

      /**
       * 取一个 DSH Client Service；不存在时返回 null。
       *
       * @param {string} serviceName
       * @returns {any | null}
       */
      function service(serviceName) {
        try {
          return getService(serviceName)
        } catch {
          return null
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
       * @param {string} sessionId
       * @returns {Promise<void>}
       */
      async function refreshSessionsIfUnknown(sessionId) {
        const sessions = service('sessions')
        if (sessions === null || typeof sessions.refresh !== 'function') return
        let known = false
        try {
          known = sessions.list?.getSnapshot?.()?.byId?.[sessionId] !== undefined
        } catch {
          known = false
        }
        if (known) return
        try {
          await sessions.refresh()
        } catch (failure) {
          // 刷新失败时仍然尝试打开：openSession 会给出真正的错误原因。
          console.warn('buka-workflows: refreshing the session list failed:', failure)
        }
      }

      /**
       * 打开某个节点会话。
       *
       * @param {Record<string, any>} step
       * @returns {Promise<void>}
       */
      async function openSession(step) {
        const sessionId = typeof step?.sessionId === 'string' ? step.sessionId : ''
        if (sessionId === '') return
        const uiWorkspace = service('uiWorkspace')
        if (uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') {
          flash('error', t('noUiWorkspace'))
          return
        }
        try {
          await refreshSessionsIfUnknown(sessionId)
          uiWorkspace.openSession(sessionId)
        } catch (failure) {
          flash('error', `${t('openSessionFailed')} ${messageOf(failure)}`)
        }
      }

      /**
       * 聚焦到一次执行（或一个没有执行记录的节点）：选中目标节点，并打开它的
       * 那一次执行；终止节点没有执行记录，就只切换节点。
       *
       * @param {string} nodeId
       * @param {number | null} [seq] 目标执行的 seq
       */
      function focusExecution(nodeId, seq = null) {
        const steps = Array.isArray(detail.data?.run?.steps) ? detail.data.run.steps : []
        const list = steps.filter((other) => other?.nodeId === nodeId)
        const index = seq === null ? -1 : list.findIndex((other) => other?.seq === seq)
        setSelectedNodeId(nodeId)
        setExecutionIndex(index < 0 ? null : index)
      }

      /**
       * 胶囊文案：机器人节点优先用创建者写的步骤概要（旧定义没有时退回机器人
       * 名），门禁用标题，终止节点用 id。
       *
       * @param {Record<string, any>} node
       * @returns {string}
       */
      function capsuleText(node) {
        if (node.type === 'robot') return node.summary || node.robot || node.id
        if (node.type === 'gate') return node.title || node.id
        if (node.type === 'start') return t('typeStart')
        return node.id
      }

      /**
       * 默认选中的节点：
       * - 有正在执行 / 等待授权的节点 → 那个节点；
       * - 运行已完成 → 它最后走到的终止节点（没有就找任意已到达的终止节点），
       *   让页面一进来就展示最终输出；
       * - 其他状态 → 最近执行过的节点；
       * - 都没有 → 起点。
       *
       * @param {Record<string, any>} graph
       * @param {Record<string, any> | null} run
       * @returns {string | null}
       */
      function defaultNodeId(graph, run) {
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
        const live = nodes.find((node) => node.state === 'running' || node.state === 'waiting')
        if (live !== undefined) return live.id

        if (run?.status === 'completed') {
          const lastNode = typeof run?.result?.lastNode === 'string' ? run.result.lastNode : ''
          const reachedEnd = nodes.find((node) => node.id === lastNode && node.type === 'end')
          if (reachedEnd !== undefined) return reachedEnd.id
          const anyReachedEnd = nodes.find((node) => node.type === 'end' && node.visits > 0)
          if (anyReachedEnd !== undefined) return anyReachedEnd.id
        }

        let latest = null
        for (const node of nodes) {
          if (node.visits > 0 && (latest === null || (node.lastSeq ?? 0) > (latest.lastSeq ?? 0))) latest = node
        }
        if (latest !== null) return latest.id
        const start = nodes.find((node) => node.id === graph.start)
        return start?.id ?? nodes[0]?.id ?? null
      }

      /**
       * 一条边在悬停时展示的名字。
       *
       * - 机器人节点的边：创建者写的 `name`；多条规则合并成一条边时按顺序并列；
       * - 门禁边：直接用「批准 / 拒绝」，这已经是这条边的全部含义；
       * - 没写名字的机器人边：不展示，不拿目标 id 凑数。
       *
       * @param {Record<string, any>} edge
       * @returns {string}
       */
      function edgeLabel(edge) {
        const names = Array.isArray(edge?.names)
          ? edge.names.filter((name) => typeof name === 'string' && name !== '')
          : []
        if (names.length > 0) return names.join(' / ')
        if (edge?.kind === 'approve') return t('legendApprove')
        if (edge?.kind === 'reject') return t('legendReject')
        return ''
      }

      /**
       * 节点类型 → Tag tone；颜色用于区分类型。
       *
       * @param {string} type
       * @returns {'info' | 'warning' | 'success' | 'neutral'}
       */
      function typeTone(type) {
        if (type === 'start') return 'neutral'
        if (type === 'robot') return 'info'
        if (type === 'gate') return 'warning'
        if (type === 'end') return 'success'
        return 'neutral'
      }

      /**
       * 图例：节点类型（胶囊颜色）、节点状态（轨道圆点）与连线。
       *
       * @returns {object} React 元素
       */
      function renderLegend() {
        const states = [
          ['done', t('legendDone')],
          ['running', t('legendRunning')],
          ['waiting', t('legendWaiting')],
          ['failed', t('legendFailed')],
          ['idle', t('legendIdle')],
        ]
        return h(
          'div',
          { className: 'buka-workflows-legend' },
          h(
            'span',
            { className: 'buka-workflows-legendGroup' },
            h('span', { className: 'buka-workflows-legendTitle' }, t('legendTypes')),
            ...['start', 'robot', 'gate', 'end'].map((type) =>
              h(
                'span',
                { key: type, className: 'buka-workflows-legendItem' },
                h('span', {
                  className: `buka-workflows-legendCapsule is-${type}`,
                  'aria-hidden': true,
                }),
                typeLabel(t, type),
              ),
            ),
          ),
          h(
            'span',
            { className: 'buka-workflows-legendGroup' },
            h('span', { className: 'buka-workflows-legendTitle' }, t('legendStates')),
            ...states.map(([kind, label]) =>
              h(
                'span',
                { key: kind, className: 'buka-workflows-legendItem' },
                h('span', { className: `buka-workflows-legendDot is-${kind}`, 'aria-hidden': true }),
                label,
              ),
            ),
          ),
          h(
            'span',
            { className: 'buka-workflows-legendGroup' },
            h('span', { className: 'buka-workflows-legendTitle' }, t('legendEdges')),
            ...['traversed', '', 'approve', 'reject'].map((kind, index) => {
              const labels = [t('legendTraversed'), t('legendPending'), t('legendApprove'), t('legendReject')]
              return h(
                'span',
                { key: `${kind || 'pending'}-${index}`, className: 'buka-workflows-legendItem' },
                h('span', {
                  className: `buka-workflows-legendLine${kind === '' ? '' : ` is-${kind}`}`,
                  'aria-hidden': true,
                }),
                labels[index],
              )
            }),
          ),
        )
      }

      /**
       * 纵向节点图：左边是轨道 + 胶囊，右边由页面渲染节点详情。
       *
       * @param {Record<string, any>} graph 路由返回的图模型（含行坐标与连线）
       * @param {string | null} activeNodeId 当前选中的节点
       * @returns {object} React 元素
       */
      function renderGraph(graph, activeNodeId) {
        const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
        if (nodes.length === 0) return h('p', { className: 'buka-workflows-empty' }, t('graphEmpty'))
        const edges = Array.isArray(graph.edges) ? graph.edges : []
        const rows = Array.isArray(graph.rows) ? graph.rows : []
        const rowById = new Map(rows.map((row) => [row.id, row]))
        const railWidth = typeof graph.width === 'number' ? graph.width : 28
        const height = typeof graph.height === 'number' ? graph.height : 0
        const rowHeight = typeof graph.rowHeight === 'number' ? graph.rowHeight : 56
        const rowGap = typeof graph.rowGap === 'number' ? graph.rowGap : 12
        const dotX = typeof graph.dotX === 'number' ? graph.dotX : 14
        const rowCenters = rows.map((row) => row.y).sort((left, right) => left - right)
        /**
         * 边名字的纵向落点：箭头正好压在某一行上时（自环、跨偶数行的回边），
         * 挪到相邻两行之间的空隙里，避免标签盖住节点胶囊。
         *
         * @param {number} y
         * @returns {number}
         */
        const labelY = (y) => {
          const row = rowCenters.find((center) => Math.abs(center - y) < rowHeight / 2)
          if (row === undefined) return y
          const next = rowCenters.find((center) => center > row)
          if (next !== undefined) return (row + next) / 2
          const previous = rowCenters.filter((center) => center < row).pop()
          return previous === undefined ? y : (previous + row) / 2
        }
        const hoveredEdgeKey = edgeTip === null ? null : edgeTip.key
        const drawableEdges = edges.filter((edge) => typeof edge.d === 'string' && edge.d !== '')
        const hoveredEdge =
          hoveredEdgeKey === null ? null : (drawableEdges.find((edge) => edge.key === hoveredEdgeKey) ?? null)
        return h(
          'div',
          { className: 'buka-workflows-graphPane' },
          h(
            'div',
            { className: 'buka-workflows-vgraph' },
            h(
              'svg',
              {
                className: 'buka-workflows-vgraphSvg',
                width: railWidth,
                height,
                viewBox: `0 0 ${railWidth} ${height}`,
                'aria-hidden': true,
              },
              // 悬浮的线不换颜色、也不铺光晕，只是变成实线、略粗一点并压住其他线；
              // 名字单独钉在轨道右侧，所以这里先把其余线画完，最后补画悬浮的那条。
              ...drawableEdges
                .filter((edge) => edge !== hoveredEdge)
                .map((edge) =>
                  h('path', {
                    key: edge.key,
                    className: `buka-workflows-edge is-${edge.kind}${
                      edge.traversed === true ? ' is-traversed' : ''
                    }${hoveredEdge === null ? '' : ' is-dimmed'}`,
                    d: edge.d,
                  }),
                ),
              hoveredEdge === null
                ? null
                : h('path', {
                    key: hoveredEdge.key,
                    className: `buka-workflows-edge is-${hoveredEdge.kind}${
                      hoveredEdge.traversed === true ? ' is-traversed' : ''
                    } is-hovered`,
                    d: hoveredEdge.d,
                  }),
              // 方向箭头放在每条线自己的中段，避免多支箭头都挤在圆点旁边。
              ...edges.map((edge) => {
                const arrow = edge.arrow
                if (arrow === null || typeof arrow !== 'object') return null
                if (typeof arrow.x !== 'number' || typeof arrow.y !== 'number') return null
                const hovered = hoveredEdgeKey === edge.key
                return h(
                  'g',
                  {
                    key: `arrow-${edge.key}`,
                    className: `buka-workflows-edgeArrow is-${edge.kind}${
                      edge.traversed === true ? ' is-traversed' : ''
                    }${hovered ? ' is-hovered' : ''}${
                      hoveredEdge !== null && !hovered ? ' is-dimmed' : ''
                    }`,
                    transform: `translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle ?? 90})`,
                  },
                  h('path', { d: 'M-3.5,-4 L3.5,0 L-3.5,4 Z' }),
                )
              }),
              // 透明加粗的命中区：边本身只有 1px 多，直接用可见线做 hover 太
              // 难命中。名字只出现在悬浮时，不写进静态图里。
              ...edges.map((edge) => {
                if (typeof edge.d !== 'string' || edge.d === '') return null
                const label = edgeLabel(edge)
                if (label === '') return null
                const show = (event) => {
                  const arrow = edge.arrow
                  const anchor =
                    arrow !== null &&
                    typeof arrow === 'object' &&
                    typeof arrow.x === 'number' &&
                    typeof arrow.y === 'number'
                      ? edgeTipAnchor(event.currentTarget, { x: arrow.x, y: labelY(arrow.y) }, railWidth)
                      : null
                  setEdgeTip({
                    key: edge.key,
                    kind: edge.kind,
                    text: label,
                    x: event.clientX,
                    y: event.clientY,
                    anchor,
                  })
                }
                return h('path', {
                  key: `hit-${edge.key}`,
                  className: 'buka-workflows-edgeHit',
                  d: edge.d,
                  // 名字钉在线中段，不再跟着鼠标走，所以只需进入时算一次位置。
                  onMouseEnter: show,
                  onMouseLeave: () =>
                    setEdgeTip((current) => (current !== null && current.key === edge.key ? null : current)),
                })
              }),
              ...nodes.map((node) => {
                const row = rowById.get(node.id)
                if (row === undefined) return null
                return h('circle', {
                  key: `dot-${node.id}`,
                  className: `buka-workflows-vgraphDot is-${stateClass(node.state)}`,
                  cx: dotX,
                  cy: row.y,
                  r: 4,
                })
              }),
            ),
            h(
              'div',
              { className: 'buka-workflows-vgraphRows' },
              ...nodes.map((node) => {
                const row = rowById.get(node.id)
                if (row === undefined) return null
                const state = typeof node.state === 'string' ? node.state : 'idle'
                const kind = stateClass(state)
                const selected = activeNodeId === node.id
                return h(
                  'div',
                  {
                    key: node.id,
                    className: 'buka-workflows-vgraphRow',
                    style: { height: rowHeight, marginBottom: row.index === nodes.length - 1 ? 0 : rowGap },
                  },
                  h('span', { className: 'buka-workflows-vgraphRail', style: { width: railWidth } }),
                  h(
                    'span',
                    { className: 'buka-workflows-vgraphCapsuleWrap' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: `buka-workflows-capsule is-${node.type}${kind === 'idle' ? ' is-idle' : ''}${
                          kind === 'running' ? ' is-running' : ''
                        }${selected ? ' is-selected' : ''}${
                          typeof node.avatar === 'string' && node.avatar !== '' ? ' has-avatar' : ''
                        }`,
                        title: `${node.id} · ${typeLabel(t, node.type)} · ${statusLabel(t, state)}`,
                        'aria-pressed': selected,
                        // 点胶囊换节点时回到「最近一次执行」；点执行记录里的「下一步」
                        // 则用 focusExecution 指定具体的那一次。
                        onClick: () => {
                          setSelectedNodeId(node.id)
                          setExecutionIndex(null)
                        },
                      },
                      renderAvatar(node.avatar, 20, 'buka-workflows-capsuleAvatar'),
                      capsuleText(node),
                    ),
                    node.visits > 1
                      ? h(
                          'span',
                          {
                            className: 'buka-workflows-visitBadge',
                            title: `${t('visitsLabel')}: ${node.visits}`,
                          },
                          `×${node.visits}`,
                        )
                      : null,
                  ),
                )
              }),
            ),
          ),
        )
      }

      /**
       * 一次执行的 Tab 内容：当次输入（渲染后的提示词）、当次输出、会话，以及这次
       * 执行把运行带到了哪个节点的哪一次执行（点一下就能跳过去）。
       *
       * @param {Record<string, any>} step
       * @param {Record<string, any> | null} full 落盘的节点结果全文（旧记录可能没有）
       * @param {Record<string, any> | null} config 定义快照里的节点
       * @param {Record<string, any>} node 图模型里的节点
       * @param {Array<Record<string, any>>} steps 整个运行按顺序记下的所有执行
       * @param {unknown} definition 定义快照（下一步要拿目标节点的步骤概要）
       * @param {Record<string, any> | null} graph 图模型（同上）
       * @param {Record<string, any> | null} run 运行记录（最后一步用它找到终止节点）
       * @param {Array<string>} [nodeSessionIds] 节点级已经展示过的会话 id（这里不再重复）
       * @returns {object} React 元素
       */
      function renderExecution(step, full, config, node, steps, definition, graph, run, nodeSessionIds = []) {
        const decision = typeof step.decision === 'string' && step.decision !== '' ? step.decision : null
        const visit = typeof step.visit === 'number' ? step.visit : 1
        // 这次执行选中的边名字（v2 由机器人 JSON 的 next 决定）；只作为标签展示，
        // 不把整份 JSON 铺成 key/value。
        const route = typeof step.route === 'string' ? step.route.trim() : ''
        // 每次进入的输入优先用那次落盘的渲染后 prompt。定义里的 prompt 只属于第一次
        // 进入节点时那条边，所以 visit > 1 又没有落盘 prompt 时不能再拿它冒充这次输入。
        let promptText = typeof full?.prompt === 'string' && full.prompt !== '' ? full.prompt : ''
        let inputMissing = false
        if (node.type === 'gate') {
          const detail = typeof config?.detail === 'string' ? config.detail : ''
          const title = typeof config?.title === 'string' ? config.title : ''
          promptText = detail !== '' ? detail : title
        } else if (promptText === '') {
          if (visit === 1) promptText = typeof config?.prompt === 'string' ? config.prompt : ''
          else inputMissing = true
        }
        const stepText = typeof step.text === 'string' ? step.text : ''
        const fullText = typeof full?.text === 'string' ? full.text : ''
        let outputText = fullText !== '' ? fullText : stepText
        if (node.type === 'gate' && decision !== null) outputText = statusLabel(t, decision)
        const attachments = Array.isArray(full?.attachments)
          ? full.attachments
          : Array.isArray(step.attachments)
            ? step.attachments
            : []
        const duration = formatDuration(step)
        // 运行是按 seq 顺序记下每次执行的，所以「这一次的下一步」就是 seq + 1 的那次执行；
        // 没有下一次执行说明运行到这里就结束了（终止节点本身不产生执行记录）。
        const nextStep = steps.find((other) => other?.seq === step.seq + 1) ?? null
        const nextNode =
          nextStep === null
            ? null
            : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === nextStep.nodeId) ?? null
        const nextTitle =
          nextStep === null
            ? ''
            : nextNode === null
              ? nextStep.nodeId
              : nodeTitle(nextNode, definitionNode(definition, nextStep.nodeId))
        const nextVisit = nextStep !== null && typeof nextStep.visit === 'number' ? nextStep.visit : 1
        // 终止节点本身不产生执行记录，所以「最后一次执行」的下一步只能从运行结果
        // 里的 lastNode 拿到；它通常就是这次执行走向的那个结束节点。
        const lastSeq = steps.reduce((max, other) => Math.max(max, typeof other?.seq === 'number' ? other.seq : 0), 0)
        const result = run !== null && typeof run?.result === 'object' ? run.result : null
        const endTarget =
          nextStep === null && step.seq === lastSeq && typeof result?.lastNode === 'string' && result.lastNode !== step.nodeId
            ? result.lastNode
            : null
        const endNode =
          endTarget === null
            ? null
            : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === endTarget) ?? null
        const endTitle = endNode === null ? endTarget : nodeTitle(endNode, definitionNode(definition, endTarget))

        /** 下一步的目标：优先下一次执行，其次这次执行走到的终止节点。 */
        const nextTarget =
          nextStep !== null
            ? { nodeId: nextStep.nodeId, seq: nextStep.seq, title: nextTitle, visit: `#${nextVisit}` }
            : endTarget !== null
              ? { nodeId: endTarget, seq: null, title: endTitle, visit: null }
              : null

        // 「上一步」就是运行里 seq - 1 的那次执行；第一次执行没有上一步时，
        // 新格式还可以退回到开始节点（它不执行，但能解释这条链路从哪来）。
        const prevStep = steps.find((other) => other?.seq === step.seq - 1) ?? null
        const prevNode =
          prevStep === null
            ? null
            : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === prevStep.nodeId) ?? null
        const prevTitle =
          prevStep === null
            ? ''
            : prevNode === null
              ? prevStep.nodeId
              : nodeTitle(prevNode, definitionNode(definition, prevStep.nodeId))
        const prevVisit = prevStep !== null && typeof prevStep.visit === 'number' ? prevStep.visit : 1
        const startNode =
          (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === graph?.start) ?? null
        const firstTarget =
          prevStep === null && step.seq === 1 && startNode?.type === 'start' && startNode.id !== step.nodeId
            ? { nodeId: startNode.id, seq: null, title: t('typeStart'), visit: null }
            : null
        const prevTarget =
          prevStep !== null
            ? { nodeId: prevStep.nodeId, seq: prevStep.seq, title: prevTitle, visit: `#${prevVisit}` }
            : firstTarget

        return h(
          'div',
          {
            key: `${String(step.seq)}-${String(step.nodeId)}`,
            className: 'buka-workflows-tabPanel',
            role: 'tabpanel',
          },
          h(
            'div',
            { className: 'buka-workflows-tabMeta' },
            h(Tag, { tone: statusTone(step.status) }, statusLabel(t, step.status)),
            route === '' ? null : h(Tag, { tone: 'neutral' }, `${t('routeLabel')}: ${route}`),
            attachments.length === 0
              ? null
              : h(
                  Tag,
                  { tone: 'neutral' },
                  String(t('attachmentCount')).replace('{n}', String(attachments.length)),
                ),
            typeof step.startedAt === 'number'
              ? h('span', { className: 'buka-workflows-meta' }, formatTime(step.startedAt))
              : null,
            duration === '' ? null : h('span', { className: 'buka-workflows-meta' }, duration),
            step.compacted === true ? h(Tag, { tone: 'success' }, t('sessionCompacted')) : null,
            step.recovered === true ? h(Tag, { tone: 'info' }, t('sessionRecovered')) : null,
            step.timedOut === true ? h(Tag, { tone: 'warning' }, t('executionTimedOut')) : null,
            step.aborted === true ? h(Tag, { tone: 'warning' }, t('executionAborted')) : null,
          ),
          h(
            'div',
            { className: 'buka-workflows-inspectorSection' },
            h('span', { className: 'buka-workflows-label' }, t('executionInput')),
            promptText === ''
              ? h(
                  'p',
                  { className: 'buka-workflows-hint' },
                  t(inputMissing ? 'executionInputMissing' : 'executionNoInput'),
                )
              : h('pre', { className: 'buka-workflows-pre' }, promptText),
          ),
          h(
            'div',
            { className: 'buka-workflows-inspectorSection' },
            h('span', { className: 'buka-workflows-label' }, t('executionOutput')),
            outputText === ''
              ? h(
                  'p',
                  { className: 'buka-workflows-hint' },
                  t(attachments.length === 0 ? 'executionNoOutput' : 'executionOutputAttachmentsOnly'),
                )
              : h('pre', { className: 'buka-workflows-pre' }, outputText),
          ),
          attachments.length === 0
            ? null
            : h(
                'div',
                { className: 'buka-workflows-inspectorSection' },
                h('span', { className: 'buka-workflows-label' }, t('executionAttachments')),
                renderAttachments(t, run, step, attachments),
              ),
          typeof step.error === 'string' && step.error !== ''
            ? h('p', { className: 'buka-workflows-failure', role: 'alert' }, `${t('error')}: ${step.error}`)
            : null,
          typeof step.stopReason === 'string' && step.stopReason !== '' && step.stopReason !== 'completed'
            ? h('p', { className: 'buka-workflows-warn' }, `${t('stopReason')}: ${step.stopReason}`)
            : null,
          typeof step.compactionError === 'string' && step.compactionError !== ''
            ? h('p', { className: 'buka-workflows-warn' }, `${t('sessionCompactFailed')} ${step.compactionError}`)
            : null,
          typeof step.sessionResetReason === 'string' && step.sessionResetReason !== ''
            ? h('p', { className: 'buka-workflows-warn' }, `${t('sessionReset')} ${step.sessionResetReason}`)
            : null,
          // 节点级已经展示过这个节点的会话，这里只给不属于节点会话的旧执行保留
          // 自己的入口，避免历史会话无处可打开。
          typeof step.sessionId === 'string' &&
          step.sessionId !== '' &&
          !nodeSessionIds.includes(step.sessionId)
            ? h(
                'div',
                { className: 'buka-workflows-stepActions' },
                h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    className: 'buka-workflows-smallButton',
                    icon: h(IconNewChatOutlineRegular, { size: 13 }),
                    onClick: () => openSession(step),
                  },
                  t('openSession'),
                ),
                h('code', { className: 'buka-workflows-inlineCode' }, step.sessionId),
              )
            : null,
          h(
            'div',
            { className: 'buka-workflows-executionNav' },
            h(
              'div',
              { className: 'buka-workflows-navSide is-prev' },
              h('span', { className: 'buka-workflows-label' }, t('executionPrev')),
              prevTarget === null
                ? h('p', { className: 'buka-workflows-hint' }, t('executionPrevNone'))
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'buka-workflows-prevLink',
                      title: prevTarget.visit === null ? prevTarget.title : `${prevTarget.title} ${prevTarget.visit}`,
                      onClick: () => focusExecution(prevTarget.nodeId, prevTarget.seq),
                    },
                    h('span', { className: 'buka-workflows-prevArrow', 'aria-hidden': true }, '←'),
                    h('span', { className: 'buka-workflows-prevTitle' }, prevTarget.title),
                    prevTarget.visit === null
                      ? h('span', { className: 'buka-workflows-prevVisit' }, t('executionStart'))
                      : h('span', { className: 'buka-workflows-prevVisit' }, prevTarget.visit),
                  ),
            ),
            h(
              'div',
              { className: 'buka-workflows-navSide is-next' },
              h('span', { className: 'buka-workflows-label' }, t('executionNext')),
              nextTarget === null
                ? h('p', { className: 'buka-workflows-hint' }, t('executionNextEnded'))
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'buka-workflows-nextLink',
                      title: nextTarget.visit === null ? nextTarget.title : `${nextTarget.title} ${nextTarget.visit}`,
                      onClick: () => focusExecution(nextTarget.nodeId, nextTarget.seq),
                    },
                    h('span', { className: 'buka-workflows-nextTitle' }, nextTarget.title),
                    nextTarget.visit === null
                      ? h('span', { className: 'buka-workflows-nextVisit' }, t('executionEnded'))
                      : h('span', { className: 'buka-workflows-nextVisit' }, nextTarget.visit),
                    h('span', { className: 'buka-workflows-nextArrow', 'aria-hidden': true }, '→'),
                  ),
            ),
          ),
        )
      }

      /**
       * 右侧的节点详情：节点配置与按执行拆开的 Tab（输入 / 输出 / 会话 / 下一步）。
       *
       * @param {Record<string, any> | null} node
       * @param {unknown} definition
       * @param {Record<string, any>} graph
       * @param {Array<Record<string, any>>} steps
       * @param {Map<string, Record<string, any>>} fullResults
       * @param {Record<string, any> | null} run 运行记录
       * @returns {object} React 元素
       */
      function renderNodePanel(node, definition, graph, steps, fullResults, run) {
        if (node === null) return h('p', { className: 'buka-workflows-hint' }, t('nodeNotRun'))
        const config = definitionNode(definition, node.id)
        const nodeSteps = steps.filter((step) => step?.nodeId === node.id)
        const state = typeof node.state === 'string' ? node.state : 'idle'
        const rows = []
        if (node.type === 'robot') {
          rows.push(kvRow(t('nodeExecutor'), node.robot || '—'))
          if (typeof node.timeoutMs === 'number') rows.push(kvRow(t('nodeTimeout'), formatMs(node.timeoutMs) || '—'))
          if (typeof node.maxVisits === 'number') rows.push(kvRow(t('nodeMaxVisits'), String(node.maxVisits)))
        } else if (node.type === 'gate') {
          rows.push(kvRow(t('typeGate'), node.title || '—'))
          if (typeof node.detail === 'string' && node.detail !== '') rows.push(kvRow(t('gateDetail'), node.detail))
        } else if (node.type === 'end') {
          rows.push(kvRow(t('nodeEndStatus'), statusLabel(t, node.endStatus ?? 'completed')))
        }
        const template = truncateText(config?.prompt, 4000)
        const isStart = node.type === 'start'
        const title = isStart ? t('typeStart') : nodeTitle(node, config)
        const current =
          run !== null && typeof run === 'object' && run.current !== null && typeof run.current === 'object'
            ? run.current
            : null
        // 机器人会话在进入节点后、执行结束前就会落到 run.current 上，所以运行中的
        // 节点也能看到并打开当前会话；它也是这个节点优先展示的会话。
        const isLiveNode = current !== null && current.nodeId === node.id
        const liveSession = isLiveNode && typeof current.sessionId === 'string' ? current.sessionId : ''
        // 节点级只展示一次会话：正常情况一个节点只有一个会话；旧记录里一个节点可能
        // 在几个会话中执行过，需要逐个列出才能打开每一段历史。
        const nodeSessionIds = collectNodeSessionIds(node, nodeSteps, liveSession, run)
        // 运行中的节点还没有 durationMs，直接用 startedAt 算实时耗时；页面 tick 会
        // 重渲染，所以这个数字会走。已结束的节点继续用 durationMs。
        const liveStartedAt =
          isLiveNode && typeof current.startedAt === 'number' && Number.isFinite(current.startedAt)
            ? current.startedAt
            : null
        const liveDuration = liveStartedAt === null ? '' : formatMs(Date.now() - liveStartedAt)
        const duration = liveDuration !== '' ? liveDuration : formatMs(node.durationMs)
        // 恢复中的运行在节点标题旁标出第几次恢复尝试。
        const recoveryAttempts =
          isLiveNode && typeof current.recoveryAttempts === 'number' && Number.isFinite(current.recoveryAttempts)
            ? current.recoveryAttempts
            : 1
        const recoveringText =
          isLiveNode && current.recovering === true
            ? String(t('sessionRecovering')).replace('{n}', String(recoveryAttempts))
            : ''

        // 终止节点自己不执行、没有输出；它代表整个运行结束，所以这里展示这次运行
        // 最后交出来的机器人正文或附件（按 seq 找最后一次有文本或附件的机器人
        // 执行），而不是定义里写死的说明文字。来源节点 + 第几次执行可以点回去。
        let finalStep = null
        let finalText = ''
        let finalAttachments = []
        if (node.type === 'end' && node.state !== 'idle') {
          for (let index = steps.length - 1; index >= 0; index -= 1) {
            const candidate = steps[index]
            if (candidate?.type !== 'robot' || typeof candidate.nodeId !== 'string') continue
            const full = fullResults.get(`${String(candidate.seq)}:${candidate.nodeId}`) ?? null
            const text =
              typeof full?.text === 'string' && full.text !== ''
                ? full.text
                : typeof candidate.text === 'string'
                  ? candidate.text
                  : ''
            const attachments = Array.isArray(full?.attachments)
              ? full.attachments
              : Array.isArray(candidate.attachments)
                ? candidate.attachments
                : []
            if (text === '' && attachments.length === 0) continue
            finalStep = candidate
            finalText = text
            finalAttachments = attachments
            break
          }
        }
        const finalNode =
          finalStep === null
            ? null
            : (Array.isArray(graph?.nodes) ? graph.nodes : []).find((item) => item?.id === finalStep.nodeId) ?? null
        const finalTitle =
          finalStep === null
            ? ''
            : finalNode === null
              ? finalStep.nodeId
              : nodeTitle(finalNode, definitionNode(definition, finalStep.nodeId))
        const finalVisit = finalStep !== null && typeof finalStep.visit === 'number' ? finalStep.visit : 1

        // 每次执行一个 Tab：输入是那一次的渲染后提示词，输出是那一次交付的正文。
        const activeIndex =
          nodeSteps.length === 0
            ? -1
            : executionIndex === null
              ? nodeSteps.length - 1
              : Math.min(Math.max(executionIndex, 0), nodeSteps.length - 1)
        const activeStep = activeIndex === -1 ? null : nodeSteps[activeIndex]
        const activeFull =
          activeStep === null
            ? null
            : fullResults.get(`${String(activeStep.seq)}:${String(activeStep.nodeId)}`) ?? null
        const executions =
          nodeSteps.length === 0 || activeStep === null
            ? h('p', { className: 'buka-workflows-hint' }, t('nodeNotRun'))
            : h(
                'div',
                { className: 'buka-workflows-executions' },
                h(
                  'div',
                  { className: 'buka-workflows-tabs', role: 'tablist', 'aria-label': t('nodeExecutions') },
                  ...nodeSteps.map((step, index) => {
                    const visit = typeof step.visit === 'number' ? step.visit : index + 1
                    return h(
                      'button',
                      {
                        key: `${String(step.seq)}-${String(step.nodeId)}`,
                        type: 'button',
                        role: 'tab',
                        'aria-selected': index === activeIndex,
                        className: `buka-workflows-tab${index === activeIndex ? ' is-active' : ''}`,
                        title: `${t('execution')} ${visit} · ${statusLabel(t, step.status)}`,
                        onClick: () => setExecutionIndex(index),
                      },
                      h('span', {
                        className: `buka-workflows-tabDot is-${stateClass(step.status)}`,
                        'aria-hidden': true,
                      }),
                      `#${visit}`,
                    )
                  }),
                ),
                renderExecution(activeStep, activeFull, config, node, steps, definition, graph, run, nodeSessionIds),
              )

        // 节点级只展示一次会话：只有一个会话时是一个「打开会话」入口；旧记录里有多个
        // 会话时逐个列出，并说明这是旧记录，避免历史会话没有入口。
        const sessionBar =
          node.type !== 'robot' || nodeSessionIds.length === 0
            ? null
            : h(
                'div',
                { className: 'buka-workflows-sessionBar' },
                h('span', { className: 'buka-workflows-label' }, t('nodeSession')),
                nodeSessionIds.length === 1
                  ? [
                      h('code', { key: 'session', className: 'buka-workflows-inlineCode' }, nodeSessionIds[0]),
                      liveSession !== '' ? h(Tag, { key: 'live', tone: 'info' }, t('sessionLive')) : null,
                      h(
                        Button,
                        {
                          key: 'open',
                          variant: 'outline',
                          size: 'sm',
                          className: 'buka-workflows-smallButton',
                          icon: h(IconNewChatOutlineRegular, { size: 13 }),
                          onClick: () => openSession({ sessionId: nodeSessionIds[0] }),
                        },
                        t('openSession'),
                      ),
                    ]
                  : [
                      h('span', { key: 'hint', className: 'buka-workflows-hint' }, t('nodeSessionsLegacy')),
                      h(
                        'span',
                        { key: 'list', className: 'buka-workflows-sessionList' },
                        ...nodeSessionIds.map((sessionId) =>
                          h(
                            'span',
                            { key: sessionId, className: 'buka-workflows-sessionRow' },
                            h('code', { className: 'buka-workflows-inlineCode' }, sessionId),
                            sessionId === liveSession ? h(Tag, { tone: 'info' }, t('sessionLive')) : null,
                            h(
                              Button,
                              {
                                variant: 'outline',
                                size: 'sm',
                                className: 'buka-workflows-smallButton',
                                icon: h(IconNewChatOutlineRegular, { size: 13 }),
                                onClick: () => openSession({ sessionId }),
                              },
                              t('openSession'),
                            ),
                          ),
                        ),
                      ),
                    ],
              )

        return h(
          'div',
          { className: 'buka-workflows-inspector', role: 'region', 'aria-label': t('inspector') },
          h(
            'div',
            { className: 'buka-workflows-inspectorHead' },
            renderAvatar(node.avatar, 22, 'buka-workflows-inspectorAvatar'),
            h('span', { className: 'buka-workflows-inspectorTitle' }, title),
            title === node.id ? null : h('code', { className: 'buka-workflows-inspectorId' }, node.id),
            node.id === graph?.start ? h(Tag, { tone: 'neutral' }, t('nodeStart')) : null,
            isStart ? null : h(Tag, { tone: typeTone(node.type) }, typeLabel(t, node.type)),
            isStart ? null : h(Tag, { tone: statusTone(state) }, statusLabel(t, state)),
            recoveringText === '' ? null : h(Tag, { tone: 'warning' }, recoveringText),
            node.visits > 1 ? h('span', { className: 'buka-workflows-meta' }, `×${node.visits}`) : null,
            duration === '' ? null : h('span', { className: 'buka-workflows-meta' }, duration),
          ),
          rows.length === 0 ? null : h('div', { className: 'buka-workflows-kv' }, ...rows),
          sessionBar,
          isStart ? h('p', { className: 'buka-workflows-hint' }, t('startNodeHint')) : null,
          node.type === 'end' && node.state !== 'idle'
            ? h(
                'div',
                { className: 'buka-workflows-inspectorSection' },
                h('span', { className: 'buka-workflows-label' }, t('finalDeliverable')),
                finalStep === null
                  ? h('p', { className: 'buka-workflows-hint' }, t('finalDeliverableEmpty'))
                  : finalText === ''
                    ? h('p', { className: 'buka-workflows-hint' }, t('executionOutputAttachmentsOnly'))
                    : h('pre', { className: 'buka-workflows-pre' }, finalText),
                finalStep === null ? null : renderAttachments(t, run, finalStep, finalAttachments),
                finalStep === null
                  ? null
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'buka-workflows-nextLink',
                        title: `${finalTitle} #${String(finalVisit)}`,
                        onClick: () => focusExecution(finalStep.nodeId, finalStep.seq),
                      },
                      h('span', { className: 'buka-workflows-nextArrow', 'aria-hidden': true }, '←'),
                      h(
                        'span',
                        { className: 'buka-workflows-nextTitle' },
                        `${t('finalDeliverableFrom')} ${finalTitle}`,
                      ),
                      h('span', { className: 'buka-workflows-nextVisit' }, `#${String(finalVisit)}`),
                    ),
              )
            : null,
          node.unreachable === true
            ? h('p', { className: 'buka-workflows-hint' }, t('nodeUnreachable'))
            : null,
          nodeSteps.length === 0 && template.text !== ''
            ? h(
                'div',
                { className: 'buka-workflows-inspectorSection' },
                h('span', { className: 'buka-workflows-label' }, t('nodePrompt')),
                h('pre', { className: 'buka-workflows-pre' }, template.text),
                template.truncated ? h('p', { className: 'buka-workflows-hint' }, t('promptTruncated')) : null,
              )
            : null,
          node.type === 'end' || isStart
            ? null
            : h(
                'div',
                { className: 'buka-workflows-inspectorSection' },
                h('span', { className: 'buka-workflows-label' }, t('nodeExecutions')),
                executions,
              ),
        )
      }

      /**
       * 列表视图。
       *
       * @returns {object} React 元素
       */
      function renderList() {
        if (list.error !== null && list.runs.length === 0) {
          return h(
            'div',
            { className: 'buka-workflows-listPane' },
            h(
              'p',
              { className: 'buka-workflows-failure', role: 'alert' },
              `${t('loadFailed')} ${list.error}`,
            ),
          )
        }
        if (list.status === 'loading' && list.runs.length === 0) {
          return h(
            'div',
            { className: 'buka-workflows-listPane' },
            h(
              'p',
              { className: 'buka-workflows-statusWithDot', role: 'status' },
              h(StateDot, { state: 'ongoing' }),
              t('loading'),
            ),
          )
        }
        if (list.runs.length === 0) {
          return h(
            'div',
            { className: 'buka-workflows-listPane' },
            h(
              'div',
              { className: 'buka-workflows-emptyBox' },
              h('p', { className: 'buka-workflows-empty' }, showArchived ? t('archiveEmpty') : t('welcome')),
              showArchived ? null : h('p', { className: 'buka-workflows-hint' }, t('welcomeHint')),
            ),
          )
        }
        return h(
          'div',
          { className: 'buka-workflows-listPane' },
          h(
            'ul',
            { className: 'buka-workflows-cards' },
            ...list.runs.map((run) =>
              h(
                'li',
                { key: run.runId },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'buka-workflows-card',
                    onClick: () => setSelectedId(run.runId),
                  },
                  h(
                    'span',
                    { className: 'buka-workflows-cardHead' },
                    h(
                      'span',
                      { className: 'buka-workflows-cardTitleGroup' },
                      typeof run.seq === 'number'
                        ? h('span', { className: 'buka-workflows-seq' }, `#${run.seq}`)
                        : null,
                      h('span', { className: 'buka-workflows-cardTitle' }, run.goal || run.runId),
                    ),
                    h(
                      'span',
                      { className: 'buka-workflows-cardTags' },
                      typeof run.archivedAt === 'number' ? h(Tag, { tone: 'neutral' }, t('archived')) : null,
                      run.waitingForUser === true ? h(Tag, { tone: 'warning' }, t('waitingForUser')) : null,
                      h(Tag, { tone: statusTone(run.status) }, statusLabel(t, run.status)),
                    ),
                  ),
                  h(
                    'span',
                    { className: 'buka-workflows-meta' },
                    `${run.runId} · ${formatTime(run.createdAt)}${
                      typeof run.error === 'string' && run.error !== '' ? ` · ${run.error}` : ''
                    }`,
                  ),
                ),
              ),
            ),
          ),
        )
      }

      /**
       * 运行在等待用户时（机器人提问 / 请求批准）的提示条：说明在等什么，并提供
       * 直达当前机器人会话的入口。数据由 supervisor 写在 `run.pendingInteraction`。
       *
       * @param {Record<string, any> | null} run 运行记录
       * @returns {object | null} React 元素；没有等待中的交互时返回 null
       */
      function renderInteractionNotice(run) {
        const interaction =
          run !== null && typeof run === 'object' && run.pendingInteraction !== null && typeof run.pendingInteraction === 'object'
            ? run.pendingInteraction
            : null
        if (interaction === null) return null
        const approval = interaction.kind === 'approval'
        const toolName = typeof interaction.toolName === 'string' ? interaction.toolName.trim() : ''
        const nodeId = typeof interaction.nodeId === 'string' ? interaction.nodeId : ''
        const sessionId = typeof interaction.sessionId === 'string' ? interaction.sessionId : ''
        const askedAt =
          typeof interaction.askedAt === 'number' && Number.isFinite(interaction.askedAt)
            ? formatTime(interaction.askedAt)
            : ''
        // 批准展示工具/原因；提问展示第一个问题（其余问题在会话里继续回答）。
        let body = ''
        if (approval) {
          const displayReason = typeof interaction.displayReason === 'string' ? interaction.displayReason.trim() : ''
          const reason = typeof interaction.reason === 'string' ? interaction.reason.trim() : ''
          body = displayReason !== '' ? displayReason : reason
        } else {
          const questions = Array.isArray(interaction.questions) ? interaction.questions : []
          const first = questions[0] !== null && typeof questions[0] === 'object' ? questions[0] : null
          const question = typeof first?.question === 'string' ? first.question.trim() : ''
          const header = typeof first?.header === 'string' ? first.header.trim() : ''
          body = question !== '' ? question : header
        }
        const title = approval
          ? `${t('waitingForApproval')}${toolName === '' ? '' : ` ${toolName}`}`
          : t('waitingForAnswer')
        return h(
          'div',
          { className: 'buka-workflows-interactionNotice', role: 'status' },
          h(
            'div',
            { className: 'buka-workflows-interactionHead' },
            h('span', { className: 'buka-workflows-interactionTitle' }, title),
            nodeId === '' ? null : h('code', { className: 'buka-workflows-inlineCode' }, nodeId),
            askedAt === '' ? null : h('span', { className: 'buka-workflows-meta' }, askedAt),
          ),
          body === '' ? null : h('p', { className: 'buka-workflows-interactionBody' }, body),
          sessionId === ''
            ? null
            : h(
                'div',
                { className: 'buka-workflows-interactionActions' },
                h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    className: 'buka-workflows-smallButton',
                    icon: h(IconNewChatOutlineRegular, { size: 13 }),
                    onClick: () => openSession({ sessionId }),
                  },
                  t(approval ? 'openApprovalSession' : 'openAnswerSession'),
                ),
              ),
        )
      }

      /**
       * 详情视图。
       *
       * @returns {object} React 元素
       */
      function renderDetail() {
        if (detail.error !== null && detail.data === null) {
          return h('p', { className: 'buka-workflows-failure', role: 'alert' }, `${t('loadFailed')} ${detail.error}`)
        }
        if (detail.status === 'loading' && detail.data === null) {
          return h(
            'p',
            { className: 'buka-workflows-statusWithDot', role: 'status' },
            h(StateDot, { state: 'ongoing' }),
            t('loading'),
          )
        }
        const run = detail.data?.run
        if (run === null || run === undefined) {
          return h('p', { className: 'buka-workflows-empty' }, t('empty'))
        }
        const steps = Array.isArray(run.steps) ? run.steps : []
        const nodeResults = Array.isArray(detail.data.nodeResults) ? detail.data.nodeResults : []
        const fullResults = new Map(
          nodeResults.map((result) => [`${String(result.seq)}:${String(result.nodeId)}`, result]),
        )
        const definition = detail.data.definition ?? null
        const graph = detail.data.graph !== null && typeof detail.data.graph === 'object' ? detail.data.graph : null
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
        const activeNodeId =
          selectedNodeId !== null && nodes.some((node) => node.id === selectedNodeId)
            ? selectedNodeId
            : graph === null
              ? null
              : defaultNodeId(graph, run)
        const activeNode = activeNodeId === null ? null : nodes.find((node) => node.id === activeNodeId) ?? null
        const graphBody =
          graph === null
            ? h('p', { className: 'buka-workflows-empty' }, t('noGraph'))
            : renderGraph(graph, activeNodeId)
        return h(
          'div',
          { className: 'buka-workflows-pageBody buka-workflows-detail' },
          renderInteractionNotice(run),
          h(
            'div',
            { className: 'buka-workflows-split' },
            graphBody,
            h(
              'div',
              { className: 'buka-workflows-detailPane' },
              renderNodePanel(activeNode, definition, graph, steps, fullResults, run),
            ),
          ),
        )
      }

      /**
       * 详情页底部的图例与说明。它固定占据页面底部，不跟内容一起滚动，内容再长
       * 也不会把它顶下去。
       *
       * @returns {object} React 元素
       */
      function renderFooter() {
        return h(
          'footer',
          { className: 'buka-workflows-footer' },
          renderLegend(),
        )
      }

      /**
       * 自动归档设置对话框：启用开关 + 归档 / 删除小时数 + 保存。打开时先读 Host
       * 的当前设置，输入按整小时校验；读 / 存失败都留在框里说明原因。
       *
       * @returns {object} React 元素
       */
      function renderSettingsDialog() {
        const draft = settingsDraft
        const validation = draft === null ? null : settingsValidationError(draft)
        const saving = settingsSaving
        const canSave = !saving && !settingsLoading && draft !== null && validation === null
        /** @param {string} text */
        const formError = (text) => h('p', { className: 'buka-workflows-formError', role: 'alert' }, text)
        const body = []
        if (settingsLoading) {
          body.push(h('p', { className: 'buka-workflows-hint' }, t('settingsLoading')))
        }
        if (draft === null) {
          if (!settingsLoading && settingsError !== null) body.push(formError(settingsError))
        } else {
          body.push(
            h(
              'div',
              { className: 'buka-workflows-settingRow' },
              h(
                'div',
                { className: 'buka-workflows-settingText' },
                h(
                  'div',
                  { className: 'buka-workflows-settingHead' },
                  h('span', { className: 'buka-workflows-settingTitle' }, t('archiveEnabled')),
                  h(
                    Tag,
                    { tone: draft.enabled ? 'success' : 'neutral' },
                    draft.enabled ? t('settingsEnabled') : t('settingsDisabled'),
                  ),
                ),
                h('span', { className: 'buka-workflows-settingDesc' }, t('archiveEnabledDesc')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': draft.enabled,
                  'aria-label': t('archiveEnabled'),
                  className: `buka-workflows-switch${draft.enabled ? ' is-on' : ''}`,
                  disabled: saving,
                  onClick: () =>
                    setSettingsDraft((current) =>
                      current === null ? current : { ...current, enabled: !current.enabled },
                    ),
                },
                h('span', { className: 'buka-workflows-switchThumb', 'aria-hidden': true }),
              ),
            ),
            h(
              'div',
              { className: 'buka-workflows-hoursField' },
              h('span', { className: 'buka-workflows-fieldLabel' }, t('archiveAfterHours')),
              h(
                'div',
                { className: 'buka-workflows-hoursControl' },
                h(Input, {
                  type: 'number',
                  min: 1,
                  max: 720,
                  step: 1,
                  value: draft.archiveHours,
                  disabled: saving || !draft.enabled,
                  className: 'buka-workflows-hoursInput',
                  onChange: (event) =>
                    setSettingsDraft((current) =>
                      current === null ? current : { ...current, archiveHours: String(event.target.value) },
                    ),
                }),
                h('span', { className: 'buka-workflows-hoursUnit' }, t('hoursUnit')),
              ),
              h('span', { className: 'buka-workflows-fieldHint' }, t('archiveAfterHoursHint')),
            ),
            h(
              'div',
              { className: 'buka-workflows-hoursField' },
              h('span', { className: 'buka-workflows-fieldLabel' }, t('deleteAfterHours')),
              h(
                'div',
                { className: 'buka-workflows-hoursControl' },
                h(Input, {
                  type: 'number',
                  min: 2,
                  max: 8760,
                  step: 1,
                  value: draft.deleteHours,
                  disabled: saving || !draft.enabled,
                  className: 'buka-workflows-hoursInput',
                  onChange: (event) =>
                    setSettingsDraft((current) =>
                      current === null ? current : { ...current, deleteHours: String(event.target.value) },
                    ),
                }),
                h('span', { className: 'buka-workflows-hoursUnit' }, t('hoursUnit')),
              ),
              h('span', { className: 'buka-workflows-fieldHint' }, t('deleteAfterHoursHint')),
            ),
            h('p', { className: 'buka-workflows-hint' }, t('archiveDefaultsHint')),
          )
          if (validation !== null) body.push(formError(validation))
          if (settingsError !== null) body.push(formError(settingsError))
        }
        return h(
          Modal,
          {
            open: settingsOpen,
            onClose: closeSettingsDialog,
            title: t('archiveSettingsTitle'),
            closeLabel: t('close'),
            footer: h(
              React.Fragment,
              null,
              h(Button, { variant: 'outline', onClick: closeSettingsDialog, disabled: saving }, t('cancel')),
              h(
                Button,
                { variant: 'primary', type: 'button', onClick: saveSettings, disabled: !canSave },
                saving ? t('saving') : t('save'),
              ),
            ),
          },
          h('div', { className: 'buka-workflows-dialogForm' }, ...body),
        )
      }

      const selectedRun = selectedId !== null ? detail.data?.run ?? null : null

      /**
       * 标题：普通列表用「工作流」，归档列表用「已归档的工作流」；详情标题在
       * 有运行序号时是「#N · 目标」，否则退回目标或 runId。
       */
      const headingText =
        selectedId === null
          ? showArchived
            ? t('archiveTitle')
            : t('title')
          : selectedRun === null
            ? String(selectedId)
            : typeof selectedRun.seq === 'number'
              ? `#${selectedRun.seq} · ${selectedRun.goal || selectedRun.runId}`
              : String(selectedRun.goal || selectedRun.runId)

      return h(
        'div',
        { className: 'buka-workflows-page' },
        h(
          'header',
          { className: 'buka-workflows-head' },
          h(
            'div',
            { className: 'buka-workflows-headInner' },
            h(
              'div',
              { className: 'buka-workflows-titleRow' },
              h(
                'div',
                { className: 'buka-workflows-titleCluster' },
                selectedId === null && !showArchived
                  ? null
                  : h(
                      Tooltip,
                      {
                        label: selectedId === null ? t('archiveBack') : t('back'),
                        side: 'top',
                        delayMs: 400,
                      },
                      h(
                        'button',
                        {
                          type: 'button',
                          className:
                            'buka-workflows-iconButton buka-workflows-back buka-workflows-backButton',
                          'aria-label': selectedId === null ? t('archiveBack') : t('back'),
                          onClick: () => {
                            if (selectedId === null) setShowArchived(false)
                            else setSelectedId(null)
                          },
                        },
                        h(IconChevronRightOutlineRegular, { size: 16 }),
                      ),
                    ),
                h(
                  'h1',
                  { className: 'buka-workflows-title' },
                  headingText,
                ),
              ),
              h(
                'div',
                { className: 'buka-workflows-toolbar' },
                ...(selectedId === null
                  ? [
                      showArchived
                        ? null
                        : h(
                            Button,
                            {
                              variant: 'outline',
                              size: 'sm',
                              className: 'buka-workflows-toolbarButton',
                              icon: h(IconFolderOpenOutlineRegular, { size: 13 }),
                              onClick: () => setShowArchived(true),
                            },
                            list.archivedCount > 0
                              ? `${t('archiveView')} (${list.archivedCount})`
                              : t('archiveView'),
                          ),
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          className: 'buka-workflows-toolbarButton',
                          icon: h(IconSettingsOutlineRegular, { size: 13 }),
                          onClick: openSettingsDialog,
                        },
                        t('settings'),
                      ),
                    ]
                  : [
                      typeof selectedRun?.archivedAt === 'number'
                        ? h(Tag, { tone: 'neutral' }, t('archived'))
                        : null,
                      h('code', { className: 'buka-workflows-inlineCode' }, selectedRun?.runId ?? selectedId),
                      h(
                        Tag,
                        { tone: statusTone(selectedRun?.status ?? '') },
                        statusLabel(t, selectedRun?.status ?? ''),
                      ),
                    ]),
                h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'sm',
                    className: 'buka-workflows-toolbarButton',
                    icon: h(IconRefreshOutlineRegular, { size: 13 }),
                    onClick: reload,
                  },
                  t('refresh'),
                ),
              ),
            ),
          ),
        ),
        h('div', { className: 'buka-workflows-body' }, selectedId === null ? renderList() : renderDetail()),
        selectedId === null ? null : renderFooter(),
        renderSettingsDialog(),
        notice === null
          ? null
          : h(Toast, {
              key: notice.seq,
              text: notice.text,
              tone: notice.kind === 'success' ? 'success' : undefined,
              icon: notice.kind === 'success' ? undefined : h(IconWarningOutlineRegular, {}),
              holdMs: 3200,
              onDone: () => setNotice(null),
            }),
        edgeTip === null
          ? null
          : h(
              'div',
              {
                className: `buka-workflows-edgeTip${edgeTip.anchor ? ' is-anchored' : ''}`,
                role: 'tooltip',
                style: edgeTipPosition(edgeTip),
              },
              edgeTip.text,
            ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * 注册侧边栏条目与主面板页面，并注入文案与样式。
       *
       * @param {object} ctx 浏览器插件上下文
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS)

        /**
         * 页面从插件上下文里取 DSH 的 Client Service；不存在时返回 null。
         *
         * @param {string} serviceName
         * @returns {any | null}
         */
        function getService(serviceName) {
          try {
            return ctx.get(serviceName) ?? null
          } catch {
            return null
          }
        }

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-workflows: dictionaries')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@buka/dsh-plugin-workflows'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'buka-workflows: styles')

        // 侧边栏图标：id 与 main 的 key 相同。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 31,
              label: () => t('panel'),
              locale: NS,
            },
            WorkflowsPanelIcon,
          ),
        )

        // 主面板页面。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ getService }),
            },
            WorkflowsPage,
          ),
        )
      },
    }
  },
})
