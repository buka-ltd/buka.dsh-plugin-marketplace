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

import type { Context } from '@deepseek-ai/cordis'
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { WorkflowAccess } from './access.ts'
import { resolveWorkflowAccess } from './access.ts'
import type { WorkflowsConfig } from './options.ts'
import { resolveOptions } from './options.ts'
import { describeError } from './render.ts'
import { registerWorkflowRoutes } from './routes.ts'
import { WorkflowRunStore } from './run-store.ts'
import { createSessionToolVisibility, createWorkflowSessionTools } from './session-tools.ts'
import { defaultSettings, readSettings, resolveSettingsFile } from './settings.ts'
import { WorkflowSupervisor } from './supervisor.ts'
import { registerWorkflowTools } from './tools.ts'

export type { WorkflowsConfig } from './options.ts'
export { Config, defaultRunsDir, resolveRunsDir } from './options.ts'
export {
  renderCancel,
  renderPlanResult,
  renderRun,
  renderStart,
  renderStatus,
  renderTemplates,
} from './render.ts'

/** 自动归档的巡检间隔：设置按小时计，每小时扫一次足够。 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 不是一回事。 */
export const name = 'tool-buka-workflows'

/** 依赖的服务：只需要工具注册表；robots / userQuestions 在调用时按需获取。 */
export const inject = ['tools']

export function apply(ctx: Context, config: WorkflowsConfig): void {
  const options = resolveOptions(config)
  const settingsFile = resolveSettingsFile(options.runsDir)
  const store = new WorkflowRunStore({
    dir: options.runsDir,
    maxRuns: options.maxRuns,
    maxAttachmentBytes: options.maxAttachmentBytes,
    maxAttachmentsPerNode: options.maxAttachmentsPerNode,
    maxNodeAttachmentsBytes: options.maxNodeAttachmentsBytes,
    maxInlineAttachmentBytes: options.maxInlineAttachmentBytes,
    retention: defaultSettings().archive,
    logger: ctx.logger,
  })

  // 观察者常驻 Host 生命周期：订阅全局会话事件，驱动后台运行并在启动时恢复。
  const supervisor = new WorkflowSupervisor({
    ctx,
    store,
    options: {
      nodeTimeoutMs: options.nodeTimeoutMs,
      maxNodeTextBytes: options.maxNodeTextBytes,
      robotPreset: options.robotPreset,
    },
    logger: ctx.logger,
  })
  ctx.inject(['bukaRobots'], (robotsCtx) => {
    supervisor.attachRobots(robotsCtx.bukaRobots)
  })
  ctx.effect(
    () => () => {
      void supervisor.dispose().catch((error) => {
        ctx.logger?.warn?.(`buka-workflows: 释放观察者失败：${describeError(error)}`)
      })
    },
    'buka-workflows: dispose observer',
  )

  /** 自动归档巡检定时器；存储初始化完成后启动，插件卸载时停掉。 */
  let sweepTimer: NodeJS.Timeout | null = null
  ctx.effect(
    () => () => {
      if (sweepTimer !== null) clearInterval(sweepTimer)
      sweepTimer = null
    },
    'buka-workflows: stop archive sweeper',
  )

  /** 启动每小时巡检：自动归档 / 删除只依赖这一个定时器与启动时的一次扫描。 */
  function startSweeper(): void {
    if (sweepTimer !== null) return
    sweepTimer = setInterval(() => {
      store.sweep().catch((error) => {
        ctx.logger?.warn?.(`buka-workflows: 自动归档巡检失败：${describeError(error)}`)
      })
    }, SWEEP_INTERVAL_MS)
    // 定时器不应该阻止宿主退出。
    sweepTimer.unref?.()
  }

  /**
   * 存储初始化（建目录、回填序号、按设置清理）只做一次；随后由观察者恢复上次
   * 进程留下的未完成运行。归档设置从设置文件读取，页面保存后会立即更新策略
   * 并再扫一次。
   */
  let ready: Promise<void> | undefined
  function ensureReady(): Promise<void> {
    ready ??= (async () => {
      const settings = await readSettings({ file: settingsFile })
      store.setRetention(settings.archive)
      await store.init()
      startSweeper()
      const existing = ctx.get('bukaRobots')
      if (existing !== undefined && existing !== null) supervisor.attachRobots(existing)
      await supervisor.resumeAll()
    })()
    return ready
  }
  // 插件加载后就开始巡检与恢复，不必等到第一次打开页面或调用工具。
  void ensureReady().catch((error) => {
    ctx.logger?.warn?.(`buka-workflows: 初始化运行记录失败：${describeError(error)}`)
  })

  /**
   * 判定某个 agent 能否看到 / 调用工作流工具。
   *
   * 只放行配置里点名的 preset 的根会话；preset 服务不可用时保持可见。
   *
   * @param agent
   * @returns
   */
  function accessOf(agent: { id?: string | null | undefined } | null | undefined): WorkflowAccess {
    return resolveWorkflowAccess({
      allowed: options.orchestratorPresets,
      agentId: typeof agent?.id === 'string' ? agent.id : '',
      sessions: ctx.get('sessions'),
      agentPresets: ctx.get('agentPresets'),
    })
  }

  /** 工具在每一步的可见性条件。 */
  const visibleWhen = (context: ToolActivationContext): boolean => accessOf(context?.agent).visible

  /**
   * 调用时兜底再校验一次：即便绕过可见性判断直接调用也要被挡住。
   *
   * @param agent
   * @returns
   */
  function assertOrchestrator(
    agent: { id?: string | null | undefined } | null | undefined,
  ): WorkflowAccess {
    const access = accessOf(agent)
    if (access.visible) return access
    throw new Error(
      `workflow tools are only available to the ${options.orchestratorPresets.join(' / ')} preset (reason: ${access.reason})`,
    )
  }
  registerWorkflowTools({
    ctx,
    options,
    store,
    supervisor,
    ensureReady,
    assertOrchestrator,
    visibleWhen,
  })

  // ---- 机器人节点会话里的只读观测工具 -----------------------------------
  //
  // 四个工具全局注册，但只对运行记录里出现过的机器人会话可见。会话索引在插件
  // 启动时从 run.steps / run.sessions 重建，所以运行结束或 DSH 重启后重新打开
  // 机器人会话时工具仍在；手动机器人会话不属于任何运行，看不到它们。
  const sessionTools = createWorkflowSessionTools({
    defineTool,
    store,
    resolveSession: (sessionId) => supervisor.sessionRun(sessionId),
  })
  const sessionToolVisibleWhen = createSessionToolVisibility({
    ensureIndex: () => supervisor.ensureSessionIndex(),
    resolveSession: (sessionId) => supervisor.sessionRun(sessionId),
  })
  for (const tool of sessionTools) {
    ctx.tools.register(tool, { when: sessionToolVisibleWhen })
  }
  // ---- 浏览器一半的路由 ----------------------------------------------------
  //
  // 页面只读取落盘的运行记录，不提供“运行工作流”：workflow 由 agent 在会话里
  // 现场创建；唯一的写入口是自动归档设置（settings 文件）。路由沿用 web 组合
  // 的信任栅栏，只接受本机、已认证的浏览器请求。
  registerWorkflowRoutes({ ctx, store, settingsFile, ensureReady })
}
