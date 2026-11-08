/**
 * 一次性工作流的执行器。
 *
 * 顺序执行节点，同一个 robot 在一次运行里只开一个会话：首次进入交给
 * `ctx.bukaRobots.startSession()` 新开，之后传回 sessionId 续接（服务先 compact，
 * 再发新的边 prompt），拿到结果后决定下一节点；gate 节点调用 `ctx.approval.request()`
 * 弹一次原生审批，批准 / 拒绝各走一条出边。每一步都会把状态快照、事件与
 * 节点结果写到 `WorkflowRunStore`，但整个运行不依赖磁盘恢复：宿主重启后
 * 未结束的运行只会被标成 `interrupted`。
 *
 * 本模块不 import 任何 DSH 包，依赖全部由调用方注入，便于单测。
 *
 * @module @buka/dsh-plugin-workflows/engine
 */

import { randomUUID } from 'node:crypto'

import { chooseNextRule } from './routing.js'
import { renderTemplate } from './template.js'
import { truncateUtf8 } from './run-store.js'

/** 运行级错误：节点失败、超出步数、缺少服务等。 */
export class WorkflowRunError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message)
    this.name = 'WorkflowRunError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/** 运行被取消。 */
export class WorkflowCancelledError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'WorkflowCancelledError'
  }
}

/**
 * 执行一份已校验的 plan。
 *
 * @param {{
 *   plan: NonNullable<import('./definition.js').validateDefinition extends (...args: any[]) => infer R ? R['plan'] : never>,
 *   definition: unknown,
 *   store: import('./run-store.js').WorkflowRunStore,
 *   robots: { startSession: (request: Record<string, unknown>) => Promise<any> },
 *   approval: { request: (request: Record<string, unknown>) => Promise<string> } | undefined,
 *   agent: { id: string },
 *   signal?: AbortSignal,
 *   options?: { nodeTimeoutMs?: number, maxNodeTextBytes?: number, previewBytes?: number, robotPreset?: string },
 *   onRunCreated?: (runId: string) => void,
 *   logger?: { warn?: (message: string) => void },
 * }} input
 * @returns {Promise<Record<string, any>>}
 */
export async function runWorkflow(input) {
  const { plan, store, robots, approval, agent, signal } = input
  const options = input.options ?? {}
  const logger = input.logger
  const nodeTimeoutMs = positive(options.nodeTimeoutMs) ?? 10 * 60 * 1000
  const maxNodeTextBytes = positive(options.maxNodeTextBytes) ?? 64 * 1024
  const previewBytes = positive(options.previewBytes) ?? 4000

  if (typeof agent?.id !== 'string' || agent.id === '') {
    throw new WorkflowRunError('a workflow run needs the creating agent')
  }

  const now = () => Date.now()
  const runId = createRunId()
  // 运行序号在创建运行前分配：它是持久递增的，删除旧记录也不会回退。
  const runSeq = await store.allocateSeq()
  /** @type {Record<string, any>} */
  const run = {
    version: 1,
    runId,
    seq: runSeq,
    goal: plan.goal,
    status: 'running',
    createdAt: now(),
    updatedAt: now(),
    finishedAt: null,
    createdBy: { sessionId: agent.id },
    current: null,
    pendingGate: null,
    steps: [],
    // 每个机器人在这次运行里只有一个会话：重复进入同一机器人的节点时复用它，
    // 进入前先 compact，而不是再开一个新会话。
    sessions: [],
    result: null,
    error: null,
  }

  await store.create({ run, definition: input.definition, plan })
  // 运行记录已经落盘：后台模式的调用方可以立刻拿到 runId 而不必等引擎跑完。
  input.onRunCreated?.(runId)

  /** 已完成节点最近一次的结果，供后续 prompt 模板引用。 */
  /** @type {Record<string, { text?: string, data?: unknown, decision?: string, robot?: string, sessionId?: string }>} */
  const values = {}
  /** @type {Map<string, number>} */
  const visits = new Map()
  let nodeId = plan.start
  let step = 0
  let seq = 0
  /**
   * 下一条要进入的机器人节点附带的边 prompt 模板。只有“走到某条边”才设置，
   * 进入目标节点时渲染并拼在节点 prompt 前面；正常顺序进入（start 或无 prompt
   * 的边）为 null。
   *
   * @type {string | null}
   */
  let edgePrompt = null

  /**
   * 写一次状态快照。
   *
   * @returns {Promise<void>}
   */
  async function save() {
    run.updatedAt = now()
    await store.save(run)
  }

  /**
   * 结束运行并落盘。
   *
   * @param {string} status 'completed' | 'failed' | 'rejected' | 'cancelled'
   * @param {{ nodeId?: string | null, message?: string }} [extra]
   * @returns {Promise<Record<string, any>>}
   */
  async function finish(status, extra = {}) {
    run.status = status
    run.updatedAt = now()
    run.finishedAt = run.updatedAt
    run.current = null
    run.pendingGate = null
    run.result = {
      status,
      lastNode: extra.nodeId ?? null,
      ...(extra.message === undefined ? {} : { message: extra.message }),
      ...(status === 'failed' && run.error !== null ? { error: run.error } : {}),
    }
    await save()
    await store.appendEvent(runId, 'run/end', { status, result: run.result })
    return toToolRun(run)
  }

  /**
   * 失败收尾。
   *
   * @param {unknown} error
   * @returns {Promise<Record<string, any>>}
   */
  async function fail(error) {
    run.error = describeError(error)
    logger?.warn?.(`buka-workflows: run ${runId} failed: ${run.error}`)
    return await finish('failed', { nodeId: run.current?.nodeId ?? null })
  }

  try {
    while (true) {
      throwIfAborted(signal)
      const node = plan.nodes[nodeId]
      if (node === undefined) throw new WorkflowRunError(`workflow node "${nodeId}" is missing`)

      if (node.type === 'start') {
        // start 节点不执行、不占步数：它只是把第一条边的 prompt 交给真正的
        // 第一个机器人节点。
        const rule = Array.isArray(node.next) ? node.next[0] : null
        if (rule === null || rule === undefined) {
          throw new WorkflowRunError(`start node "${nodeId}" has no outgoing edge`)
        }
        if (typeof rule.prompt !== 'string' || rule.prompt === '') {
          throw new WorkflowRunError(`start node "${nodeId}" edge has no prompt`)
        }
        assertKnownNode(plan, rule.to)
        edgePrompt = rule.prompt
        nodeId = rule.to
        continue
      }

      if (node.type === 'end') {
        // 终止节点只表达结束状态；页面上展示的「最终交付物」由最后一次机器人
        // 执行的落盘结果决定，不来自定义。
        return await finish(node.status ?? 'completed', { nodeId })
      }

      step += 1
      if (step > plan.maxSteps) {
        throw new WorkflowRunError(`workflow exceeded its ${plan.maxSteps}-step limit`)
      }
      const visit = (visits.get(nodeId) ?? 0) + 1
      visits.set(nodeId, visit)
      if (node.type === 'robot' && node.maxVisits !== undefined && visit > node.maxVisits) {
        throw new WorkflowRunError(`robot node "${nodeId}" exceeded its ${node.maxVisits}-visit limit`)
      }

      seq += 1
      const startedAt = now()
      run.current = {
        nodeId,
        visit,
        type: node.type,
        robot: node.robot ?? null,
        sessionId: null,
        startedAt,
      }
      run.status = 'running'
      await save()
      await store.appendEvent(runId, 'node/start', {
        nodeId,
        visit,
        type: node.type,
        ...(node.robot === undefined ? {} : { robot: node.robot }),
      })

      if (node.type === 'robot') {
        throwIfAborted(signal)
        if (typeof robots?.startSession !== 'function') {
          throw new WorkflowRunError(
            'robot node needs the Buka Robots service (ctx.bukaRobots); install @buka/dsh-plugin-robots',
          )
        }
        const prompt = renderNodePrompt(node, edgePrompt, values, plan, step, runId)
        edgePrompt = null
        const previousSession = findRobotSession(run, node.robot)
        const previousSessionId =
          typeof previousSession?.sessionId === 'string' && previousSession.sessionId !== ''
            ? previousSession.sessionId
            : ''
        const result = await runRobotNode({
          robots,
          node,
          prompt,
          signal,
          nodeTimeoutMs,
          agent,
          agentPreset: options.robotPreset,
          logger,
          sessionId: previousSessionId,
          title: robotSessionTitle(run, node),
          onSession: async (sessionInfo) => {
            if (run.current === null || run.current.nodeId !== nodeId) return
            run.current.sessionId = typeof sessionInfo?.sessionId === 'string' ? sessionInfo.sessionId : null
            run.current.sessionResumed = sessionInfo?.resumed === true
            await save()
            await store.appendEvent(runId, 'node/session', {
              nodeId,
              visit,
              sessionId: run.current.sessionId,
              resumed: run.current.sessionResumed === true,
            })
          },
        })
        const finishedAt = now()
        const data = result.structured ?? null
        const resultSessionId =
          typeof result.sessionId === 'string' && result.sessionId !== '' ? result.sessionId : null
        const resumed =
          result.resumed === true && previousSessionId !== '' && resultSessionId === previousSessionId
        values[nodeId] = {
          text: result.text ?? '',
          data,
          robot: node.robot,
          sessionId: resultSessionId ?? '',
        }
        rememberRobotSession(run, node.robot, {
          sessionId: resultSessionId,
          nodeId,
          visit,
          resumed,
          at: finishedAt,
        })
        const preview = truncateUtf8(result.text ?? '', previewBytes)
        /** @type {Record<string, any>} */
        const record = {
          seq,
          nodeId,
          visit,
          type: 'robot',
          robot: node.robot,
          sessionId: resultSessionId,
          status: result.stopReason === 'completed' ? 'completed' : 'failed',
          stopReason: result.stopReason,
          startedAt,
          finishedAt,
          text: preview.text,
          textTruncated: preview.truncated,
          data,
          error: result.error ?? null,
          resumed,
          compacted: result.compacted === true,
          ...(typeof result.compactionError === 'string' && result.compactionError !== ''
            ? { compactionError: result.compactionError }
            : {}),
          ...(typeof result.resumeError === 'string' && result.resumeError !== ''
            ? { sessionResetReason: result.resumeError }
            : {}),
        }
        run.steps.push(record)
        run.current = null
        await store.saveNodeResult(runId, seq, nodeId, {
          nodeId,
          visit,
          robot: node.robot,
          sessionId: resultSessionId,
          stopReason: result.stopReason,
          error: result.error ?? null,
          structured: data,
          resumed,
          compacted: result.compacted === true,
          ...(typeof result.compactionError === 'string' && result.compactionError !== ''
            ? { compactionError: result.compactionError }
            : {}),
          // 每次执行的输入（渲染后的提示词）单独落盘，页面按次查看时不会再和
          // 其他执行混在一起。
          prompt: truncateUtf8(prompt, maxNodeTextBytes).text,
          text: truncateUtf8(result.text ?? '', maxNodeTextBytes).text,
        })
        await store.appendEvent(runId, 'node/end', {
          nodeId,
          visit,
          stopReason: result.stopReason,
          sessionId: resultSessionId,
          resumed,
          compacted: result.compacted === true,
        })
        await save()

        if (result.stopReason !== 'completed') {
          throw new WorkflowRunError(
            `robot node "${nodeId}" ended with ${result.stopReason}${
              result.error === undefined || result.error === null ? '' : `: ${result.error}`
            }`,
          )
        }

        const rule = chooseNextRule(node, { data })
        await store.appendEvent(runId, 'route', { nodeId, next: rule?.to ?? null })
        await save()
        if (rule === null) return await finish('completed', { nodeId })
        assertKnownNode(plan, rule.to)
        edgePrompt = typeof rule.prompt === 'string' && rule.prompt !== '' ? rule.prompt : null
        nodeId = rule.to
        continue
      }

      if (node.type === 'gate') {
        if (typeof approval?.request !== 'function') {
          throw new WorkflowRunError(
            'gate node needs the approval service, which is unavailable in this composition',
          )
        }
        run.status = 'waiting'
        run.pendingGate = {
          nodeId,
          title: node.title,
          detail: node.detail,
          requestedAt: now(),
        }
        await save()
        await store.appendEvent(runId, 'gate/waiting', { nodeId })

        let outcome
        try {
          outcome = await approval.request({
            agent,
            toolName: 'buka_workflow_gate',
            reason: gateReason(node),
            signal,
          })
        } catch (error) {
          run.pendingGate = null
          if (signal?.aborted === true) throw new WorkflowCancelledError('gate approval was cancelled')
          throw new WorkflowRunError(`gate "${nodeId}" approval failed: ${describeError(error)}`, {
            cause: error,
          })
        }

        const decision = mapApproval(outcome)
        const finishedAt = now()
        run.pendingGate = null
        run.current = null
        run.status = 'running'
        run.steps.push({
          seq,
          nodeId,
          visit,
          type: 'gate',
          robot: null,
          sessionId: null,
          status: decision,
          decision,
          startedAt,
          finishedAt,
          text: '',
          error: decision === 'unavailable' ? 'approval unavailable' : null,
        })
        values[nodeId] = { decision }
        await store.appendEvent(runId, 'gate/decided', { nodeId, decision })
        await save()

        if (decision === 'cancelled') {
          return await finish('cancelled', { nodeId, message: 'gate approval was cancelled' })
        }
        if (decision === 'unavailable') {
          throw new WorkflowRunError(`gate "${nodeId}" approval is unavailable in this composition`)
        }
        const target = decision === 'approved' ? node.onApprove : node.onReject
        if (target === null || target === undefined) {
          return await finish(decision === 'approved' ? 'completed' : 'rejected', { nodeId })
        }
        assertKnownNode(plan, target.to)
        edgePrompt = typeof target.prompt === 'string' && target.prompt !== '' ? target.prompt : null
        nodeId = target.to
        continue
      }

      throw new WorkflowRunError(`unsupported node type "${String(node.type)}"`)
    }
  } catch (error) {
    if (error instanceof WorkflowCancelledError || signal?.aborted === true) {
      run.error = error instanceof Error ? error.message : 'workflow cancelled'
      return await finish('cancelled', { nodeId: run.current?.nodeId ?? null })
    }
    return await fail(error)
  }
}

/**
 * 渲染一个机器人节点的最终提示词。
 *
 * 新格式只在进入节点的边上定义 prompt；旧格式的节点 prompt 仍然兼容，若同时存在
 * 边 prompt，则边 prompt 排在节点 prompt 前面（“为什么这次会来到这里”先说）。
 *
 * @param {Record<string, any>} node
 * @param {string | null} edgePrompt
 * @param {Record<string, any>} values
 * @param {{ goal?: string }} plan
 * @param {number} step
 * @param {string} runId
 * @returns {string}
 */
export function renderNodePrompt(node, edgePrompt, values, plan, step, runId) {
  const context = { goal: plan.goal, nodes: values, step, runId }
  const base = typeof node.prompt === 'string' && node.prompt !== '' ? renderTemplate(node.prompt, context) : ''
  const edge =
    typeof edgePrompt === 'string' && edgePrompt !== '' ? renderTemplate(edgePrompt, context) : ''
  if (edge !== '' && base !== '') return `${edge}\n\n${base}`
  if (edge !== '') return edge
  if (base !== '') return base
  throw new WorkflowRunError(`robot node "${node.id}" has no prompt on its incoming edge`)
}

/**
 * 执行一个机器人节点，把启动 / 通信失败收敛成结果对象而不是抛出。
 *
 * @param {{
 *   robots: { startSession: (request: Record<string, unknown>) => Promise<any> },
 *   node: Record<string, any>,
 *   prompt: string,
 *   signal?: AbortSignal,
 *   nodeTimeoutMs: number,
 *   agent?: { id: string, ctx?: unknown },
 *   agentPreset?: string | undefined,
 *   logger?: { warn?: (message: string) => void },
 *   sessionId?: string,
 *   title?: string,
 *   onSession?: (info: { sessionId: string, resumed: boolean }) => Promise<void> | void,
 * }} input
 * @returns {Promise<Record<string, any>>}
 */
async function runRobotNode({
  robots,
  node,
  prompt,
  signal,
  nodeTimeoutMs,
  agent,
  agentPreset,
  logger,
  sessionId,
  title,
  onSession,
}) {
  /** @type {any} */
  let session
  try {
    session = await robots.startSession({
      robot: node.robot,
      prompt,
      ...(agent === undefined ? {} : { agent }),
      // 编排器自己跑在专用 preset 上；机器人节点要落到普通工作 preset，
      // 不能继承编排器的 persona 与工具集。
      ...(typeof agentPreset === 'string' && agentPreset !== '' ? { agentPreset } : {}),
      report: node.report === true,
      // 机器人会话的首条消息来源是 `buka-robot`，DSH 的自动标题不会处理它；
      // 由工作流给会话一个可读标题（运行目标 · 机器人），侧边栏才不是「未命名」。
      ...(typeof title === 'string' && title !== '' ? { title } : {}),
      ...(node.agentOptions === undefined ? {} : { agentOptions: node.agentOptions }),
      timeoutMs: node.timeoutMs ?? nodeTimeoutMs,
      approval: 'never',
      signal,
      ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
    })
    if (typeof session?.id === 'string' && session.id !== '') {
      try {
        await onSession?.({ sessionId: session.id, resumed: session.resumed === true })
      } catch (error) {
        logger?.warn?.(`buka-workflows: could not record the node session: ${describeError(error)}`)
      }
    }
    const result = await session.result
    return {
      sessionId: typeof result?.sessionId === 'string' ? result.sessionId : (session.id ?? null),
      text: typeof result?.text === 'string' ? result.text : '',
      structured: result?.structured,
      stopReason: typeof result?.stopReason === 'string' ? result.stopReason : 'error',
      error: result?.error ?? null,
      resumed: result?.resumed === true || session.resumed === true,
      compacted: result?.compacted === true,
      ...(typeof result?.compactionError === 'string' && result.compactionError !== ''
        ? { compactionError: result.compactionError }
        : {}),
      ...(typeof result?.resumeError === 'string' && result.resumeError !== ''
        ? { resumeError: result.resumeError }
        : {}),
    }
  } catch (error) {
    const message = describeError(error)
    logger?.warn?.(`buka-workflows: robot node "${node.id}" failed to start: ${message}`)
    return {
      sessionId: session?.id ?? null,
      text: '',
      structured: undefined,
      stopReason: signal?.aborted === true ? 'aborted' : 'error',
      error: message,
    }
  }
}

/**
 * DSH 会话标题的 UTF-8 字节上限（与 `session-title` 服务的 `maxTitleBytes` 一致）。
 */
const SESSION_TITLE_MAX_BYTES = 80

/**
 * 机器人会话的标题：`运行目标 · 机器人`。
 *
 * 机器人会话的第一条用户消息来源是 `buka-robot`，DSH 的自动标题只看 `user`
 * 来源的消息，所以不会给这类会话生成标题。工作流在进入节点时显式命名，
 * 侧边栏里才能一眼看出这段对话属于哪次运行、哪个机器人。
 *
 * 标题按 UTF-8 字节裁剪：机器人名优先保留，运行目标裁到剩余预算里；运行没有
 * goal 时退回 `工作流 <runId>`。
 *
 * @param {{ goal?: unknown, runId?: unknown }} run
 * @param {{ robot?: unknown }} node
 * @returns {string}
 */
export function robotSessionTitle(run, node) {
  const robot = typeof node?.robot === 'string' ? node.robot.trim() : ''
  const goal = typeof run?.goal === 'string' ? run.goal.replace(/\s+/gu, ' ').trim() : ''
  const runId = typeof run?.runId === 'string' ? run.runId.trim() : ''
  const base = goal !== '' ? goal : runId !== '' ? `工作流 ${runId}` : '工作流'
  if (robot === '') return clipUtf8(base, SESSION_TITLE_MAX_BYTES)
  const suffix = ` · ${robot}`
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  if (suffixBytes >= SESSION_TITLE_MAX_BYTES) return clipUtf8(robot, SESSION_TITLE_MAX_BYTES)
  const clipped = clipUtf8(base, SESSION_TITLE_MAX_BYTES - suffixBytes).trimEnd()
  return clipped === '' ? clipUtf8(robot, SESSION_TITLE_MAX_BYTES) : `${clipped}${suffix}`
}

/**
 * 按 UTF-8 字节裁剪，不切断码点。
 *
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function clipUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let used = 0
  let output = ''
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/**
 * 找到某个机器人在这次运行里的会话记录。
 *
 * @param {Record<string, any>} run
 * @param {unknown} robot
 * @returns {Record<string, any> | undefined}
 */
function findRobotSession(run, robot) {
  if (!Array.isArray(run?.sessions) || typeof robot !== 'string' || robot === '') return undefined
  return run.sessions.find((entry) => entry?.robot === robot)
}

/**
 * 记录 / 更新某个机器人的会话。一个机器人整个运行只保留一个会话；续接失败
 * 退回新会话时更新 sessionId，并把 `resets` 加一。
 *
 * @param {Record<string, any>} run
 * @param {unknown} robot
 * @param {{
 *   sessionId: string | null,
 *   nodeId: string,
 *   visit: number,
 *   resumed: boolean,
 *   at: number,
 * }} input
 * @returns {void}
 */
function rememberRobotSession(run, robot, { sessionId, nodeId, visit, resumed, at }) {
  if (typeof robot !== 'string' || robot === '') return
  if (!Array.isArray(run.sessions)) run.sessions = []
  const existing = findRobotSession(run, robot)
  if (sessionId === null) {
    if (existing !== undefined) {
      existing.visits = (Number.isInteger(existing.visits) ? existing.visits : 0) + 1
      existing.lastNodeId = nodeId
      existing.lastVisit = visit
    }
    return
  }
  if (existing === undefined) {
    run.sessions.push({
      robot,
      sessionId,
      firstNodeId: nodeId,
      lastNodeId: nodeId,
      visits: 1,
      createdAt: at,
    })
    return
  }
  if (existing.sessionId !== sessionId && !resumed) existing.resets = (existing.resets ?? 0) + 1
  existing.sessionId = sessionId
  existing.lastNodeId = nodeId
  existing.lastVisit = visit
  existing.visits = (Number.isInteger(existing.visits) ? existing.visits : 0) + 1
}

/**
 * 审批结果映射。
 *
 * @param {unknown} outcome
 * @returns {'approved' | 'rejected' | 'cancelled' | 'unavailable'}
 */
export function mapApproval(outcome) {
  switch (outcome) {
    case 'allowed-once':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unavailable'
  }
}

/**
 * 审批框里展示的原因。
 *
 * @param {Record<string, any>} node
 * @returns {string}
 */
export function gateReason(node) {
  const detail = typeof node.detail === 'string' && node.detail.trim() !== '' ? `：${node.detail.trim()}` : ''
  return `工作流门禁「${node.title}」正在等待授权${detail}`
}

/**
 * 把运行记录转成工具返回值（不携带完整节点文本）。
 *
 * @param {Record<string, any>} run
 * @returns {Record<string, any>}
 */
export function toToolRun(run) {
  return {
    runId: run.runId,
    seq: Number.isInteger(run.seq) ? run.seq : null,
    status: run.status,
    goal: run.goal,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? null,
    current: run.current ?? null,
    pendingGate: run.pendingGate ?? null,
    sessions: Array.isArray(run.sessions) ? run.sessions.map((session) => ({ ...session })) : [],
    steps: Array.isArray(run.steps) ? run.steps.map((step) => ({ ...step })) : [],
    result: run.result ?? null,
    error: run.error ?? null,
  }
}

/**
 * 生成 run id。
 *
 * @returns {string}
 */
function createRunId() {
  return `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

/**
 * 断言目标节点存在。
 *
 * @param {{ nodes: Record<string, unknown> }} plan
 * @param {string} nodeId
 * @returns {void}
 */
function assertKnownNode(plan, nodeId) {
  if (plan.nodes[nodeId] === undefined) {
    throw new WorkflowRunError(`workflow transition points at unknown node "${nodeId}"`)
  }
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw new WorkflowCancelledError('workflow was cancelled')
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positive(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
