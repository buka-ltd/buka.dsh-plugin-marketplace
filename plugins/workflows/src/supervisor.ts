/**
 * 工作流观察者（Host 生命周期服务）。
 *
 * 这里不在任何会话的 `result` promise 上等待：节点 prompt 投进机器人会话后
 * 立即返回，观察者订阅全局 `session/event`，等这一轮 `turn/end` 后读会话日志、
 * 校验 JSON 的 `next`、写 step 并按边路由到下一个节点。会话异常终止
 * （disposed / interrupted）时，观察者尝试 resume 同一会话、发“继续”prompt；
 * 续接失败直接终止运行并写明原因，不新开会话；宿主重启后由 `resumeAll()`
 * 从落盘的 `run.json` 继续，续接失败则标成 interrupted。
 *
 * 一个 run 同时只有一个活跃节点；每个 run 的推进串行化，避免事件竞争导致
 * 重复 dispatch。运行状态以磁盘上的 run.json 为权威，内存里只有活跃句柄。
 * 节点正常完成时会把结果里的附件复制到该次执行的节点目录，并把清单写进
 * run.steps / 节点结果 / 模板上下文。
 *
 * 观察者还维护 `sessionId → runId` 索引，供机器人会话里的四个只读工具判断
 * 可见性：启动时从 `run.steps` / `run.sessions` 重建，dispatch / 恢复时实时
 * 补充，运行结束后保留，所以重新打开机器人会话仍能查看这次运行。
 *
 * @module @buka/dsh-plugin-workflows/supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkflowNode } from './definition.ts'
import {
  advance,
  advanceInner,
  arriveEnd,
  fail,
  finish,
  maybeFinish,
} from './engine/supervisor-advance.ts'
import {
  armTimeout,
  dispatchRobot,
  onTimeout,
  rejectHandle,
  requireSameSession,
  requireVisibleHandle,
  startRobotNode,
} from './engine/supervisor-dispatch.ts'
import {
  clearInteraction,
  disposeEntry,
  onAgentDisposed,
  onHumanRequest,
  onSessionDisposed,
  onSessionEvent,
  recordInteraction,
  subscribe,
} from './engine/supervisor-events.ts'
import {
  attachRobots,
  cancel,
  dispose,
  ensureSessionIndex,
  rememberSession,
  sessionRun,
  start,
} from './engine/supervisor-lifecycle.ts'
import { completeNode } from './engine/supervisor-node.ts'
import { recoverNode, recoverRun, resumeAll } from './engine/supervisor-recovery.ts'
import { resumeActive } from './engine/supervisor-resume.ts'
import {
  activateJoins,
  activeNodeId,
  buildSessionIndex,
  canDispatch,
  clearEntryPlanMode,
  contributeJoins,
  createContext,
  creatorAgent,
  deriveFrontier,
  dispatchEntriesForRun,
  enqueue,
  findActive,
  rebuildFromSteps,
  removeActive,
  removeEntry,
  save,
  saveRunningNodeResult,
  sessionRequest,
  waitForRobots,
} from './engine/supervisor-state.ts'
import { abortNode, handlePlanGate, processTurn, retryResult } from './engine/supervisor-turn.ts'
import type {
  ContextInput,
  DispatchEntry,
  FinishExtra,
  FrontierItem,
  NodeExtra,
  RetryResultInput,
  RobotHandle,
  RobotResult,
  RobotService,
  RunContext,
  StartInput,
  SupervisorInit,
  SupervisorLogger,
  SupervisorOptions,
} from './engine/supervisor-types.ts'
import { positive } from './engine/supervisor-types.ts'
import { runUser } from './engine/supervisor-user.ts'
import type { WorkflowActiveNode, WorkflowRunRecord, WorkflowRunStore } from './run-store.ts'

export class WorkflowSupervisor {
  declare readonly ctx: Context
  declare readonly store: WorkflowRunStore
  declare readonly options: SupervisorOptions
  declare readonly logger: SupervisorLogger | undefined
  declare readonly runs: Map<string, RunContext>
  declare readonly dispatchBySession: Map<string, DispatchEntry>
  declare readonly sessionRuns: Map<string, { runId: string }>
  declare sessionIndexPromise: Promise<void> | null
  declare readonly queues: Map<string, Promise<unknown>>
  declare unsubscribes: Array<() => void> | null
  declare disposed: boolean
  declare robots: RobotService | null
  declare readonly robotsWaiters: Array<(robots: RobotService) => void>
  declare recovered: boolean

  /**
   * @param input 上下文、运行存储、限额选项与可选日志器
   */
  constructor({ ctx, store, options = {}, logger }: SupervisorInit) {
    this.ctx = ctx
    this.store = store
    this.options = {
      nodeTimeoutMs: positive(options.nodeTimeoutMs) ?? 0,
      maxNodeTextBytes: positive(options.maxNodeTextBytes) ?? 64 * 1024,
      previewBytes: positive(options.previewBytes) ?? 4000,
      robotPreset: typeof options.robotPreset === 'string' ? options.robotPreset : '',
    }
    this.logger = logger
    this.runs = new Map()
    this.dispatchBySession = new Map()
    /**
     * 机器人会话 id → 所属运行。运行结束后重新打开会话时，四个只读工具靠它
     * 判断可见性；启动时从运行记录重建，dispatch / 恢复时实时补充。
     *
     * @type
     */
    this.sessionRuns = new Map()
    this.sessionIndexPromise = null
    this.queues = new Map()
    this.unsubscribes = null
    this.disposed = false
    this.robots = null
    this.robotsWaiters = []
    this.recovered = false
    this.subscribe()
  }

  createContext(input: ContextInput): RunContext {
    return createContext(this, input)
  }

  rebuildFromSteps(ctx: RunContext): void {
    rebuildFromSteps(this, ctx)
  }

  enqueue(runId: string, task: () => Promise<unknown>): Promise<unknown> {
    return enqueue(this, runId, task)
  }

  deriveFrontier(ctx: RunContext): FrontierItem[] {
    return deriveFrontier(this, ctx)
  }

  activeNodeId(ctx: RunContext): string | null {
    return activeNodeId(this, ctx)
  }

  findActive(ctx: RunContext, seq: number): WorkflowActiveNode | null {
    return findActive(this, ctx, seq)
  }

  removeActive(ctx: RunContext, current: WorkflowActiveNode): void {
    removeActive(this, ctx, current)
  }

  activateJoins(ctx: RunContext, startedIds: string[]): void {
    activateJoins(this, ctx, startedIds)
  }

  async contributeJoins(ctx: RunContext, nodeId: string): Promise<void> {
    return contributeJoins(this, ctx, nodeId)
  }

  async save(ctx: RunContext): Promise<void> {
    return save(this, ctx)
  }

  async saveRunningNodeResult(
    ctx: RunContext,
    current: WorkflowActiveNode,
    node: WorkflowNode,
    prompt: string,
    startedAt: number,
  ): Promise<void> {
    return saveRunningNodeResult(this, ctx, current, node, prompt, startedAt)
  }

  sessionRequest(ctx: RunContext, node: WorkflowNode, sessionId: string): Record<string, unknown> {
    return sessionRequest(this, ctx, node, sessionId)
  }

  creatorAgent(ctx: RunContext): unknown {
    return creatorAgent(this, ctx)
  }

  canDispatch(robots: RobotService | null | undefined): boolean {
    return canDispatch(this, robots)
  }

  dispatchEntriesForRun(runId: string): DispatchEntry[] {
    return dispatchEntriesForRun(this, runId)
  }

  removeEntry(entry: DispatchEntry): void {
    removeEntry(this, entry)
  }

  clearEntryPlanMode(entry: Pick<DispatchEntry, 'planMode' | 'handle'>): void {
    clearEntryPlanMode(this, entry)
  }

  async waitForRobots(): Promise<RobotService | null> {
    return waitForRobots(this)
  }

  async buildSessionIndex(): Promise<void> {
    return buildSessionIndex(this)
  }

  subscribe(): void {
    subscribe(this)
  }

  onHumanRequest<T>(event: string, request: unknown, next: () => T): T {
    return onHumanRequest(this, event, request, next)
  }

  async recordInteraction(
    ctx: RunContext,
    entry: DispatchEntry,
    kind: 'question' | 'approval',
    request: unknown,
    interactionId: string,
    planReview = false,
  ): Promise<void> {
    return recordInteraction(this, ctx, entry, kind, request, interactionId, planReview)
  }

  async clearInteraction(ctx: RunContext, interactionId: string): Promise<void> {
    return clearInteraction(this, ctx, interactionId)
  }

  onSessionEvent(session: Session, event: SessionEvent): void {
    onSessionEvent(this, session, event)
  }

  onSessionDisposed(session: Session): void {
    onSessionDisposed(this, session)
  }

  onAgentDisposed(payload: unknown): void {
    onAgentDisposed(this, payload)
  }

  disposeEntry(ctx: RunContext, sessionId: string | null): void {
    disposeEntry(this, ctx, sessionId)
  }

  attachRobots(robots: unknown): void {
    attachRobots(this, robots)
  }

  async ensureSessionIndex(): Promise<void> {
    return ensureSessionIndex(this)
  }

  sessionRun(sessionId: string): { runId: string } | null {
    return sessionRun(this, sessionId)
  }

  rememberSession(runId: string, sessionId: string): void {
    rememberSession(this, runId, sessionId)
  }

  async start(input: StartInput): Promise<Record<string, unknown>> {
    return start(this, input)
  }

  async cancel(runId: string, reason = 'cancelled by the workflow orchestrator'): Promise<boolean> {
    return cancel(this, runId, reason)
  }

  async dispose(): Promise<void> {
    return dispose(this)
  }

  async resumeAll(): Promise<{ recovered: number; interrupted: number }> {
    return resumeAll(this)
  }

  async recoverRun(run: WorkflowRunRecord): Promise<'recovered' | 'interrupted' | 'skipped'> {
    return recoverRun(this, run)
  }

  async recoverNode(entry: DispatchEntry, reason: string): Promise<void> {
    return recoverNode(this, entry, reason)
  }

  async resumeActive(
    ctx: RunContext,
    current: WorkflowActiveNode,
  ): Promise<'recovered' | 'interrupted'> {
    return resumeActive(this, ctx, current)
  }

  advance(ctx: RunContext): Promise<unknown> {
    return advance(this, ctx)
  }

  async advanceInner(ctx: RunContext): Promise<void> {
    return advanceInner(this, ctx)
  }

  async arriveEnd(ctx: RunContext, node: WorkflowNode): Promise<void> {
    return arriveEnd(this, ctx, node)
  }

  async maybeFinish(ctx: RunContext): Promise<void> {
    return maybeFinish(this, ctx)
  }

  async finish(
    ctx: RunContext,
    status: string,
    extra: FinishExtra = {},
  ): Promise<WorkflowRunRecord> {
    return finish(this, ctx, status, extra)
  }

  async fail(ctx: RunContext, error: unknown): Promise<WorkflowRunRecord> {
    return fail(this, ctx, error)
  }

  async startRobotNode(
    ctx: RunContext,
    node: WorkflowNode,
    edgePrompt: string | null,
  ): Promise<void> {
    return startRobotNode(this, ctx, node, edgePrompt)
  }

  async dispatchRobot(
    robots: RobotService,
    request: Record<string, unknown>,
  ): Promise<RobotHandle> {
    return dispatchRobot(this, robots, request)
  }

  armTimeout(ctx: RunContext, entry: DispatchEntry): void {
    armTimeout(this, ctx, entry)
  }

  async onTimeout(ctx: RunContext, entry: DispatchEntry, timeoutMs: number): Promise<void> {
    return onTimeout(this, ctx, entry, timeoutMs)
  }

  async requireVisibleHandle(handle: RobotHandle): Promise<RobotHandle> {
    return requireVisibleHandle(this, handle)
  }

  async requireSameSession(handle: RobotHandle, sessionId: string): Promise<void> {
    return requireSameSession(this, handle, sessionId)
  }

  async rejectHandle(handle: RobotHandle, message: string): Promise<never> {
    return rejectHandle(this, handle, message)
  }

  async processTurn(entry: DispatchEntry, _session: Session, event: SessionEvent): Promise<void> {
    return processTurn(this, entry, _session, event)
  }

  async handlePlanGate(
    ctx: RunContext,
    entry: DispatchEntry,
    current: WorkflowActiveNode,
    node: WorkflowNode,
    result: RobotResult,
  ): Promise<boolean> {
    return handlePlanGate(this, ctx, entry, current, node, result)
  }

  async retryResult(
    ctx: RunContext,
    entry: DispatchEntry,
    node: WorkflowNode,
    input: RetryResultInput,
  ): Promise<boolean> {
    return retryResult(this, ctx, entry, node, input)
  }

  async abortNode(
    ctx: RunContext,
    current: WorkflowActiveNode,
    node: WorkflowNode,
    result: RobotResult,
    reason: string,
    extra: NodeExtra = {},
  ): Promise<void> {
    return abortNode(this, ctx, current, node, result, reason, extra)
  }

  async completeNode(
    ctx: RunContext,
    current: WorkflowActiveNode,
    node: WorkflowNode,
    result: RobotResult,
    extra: NodeExtra,
  ): Promise<void> {
    return completeNode(this, ctx, current, node, result, extra)
  }

  async runUser(ctx: RunContext, node: WorkflowNode): Promise<void> {
    return runUser(this, ctx, node)
  }
}
