/**
 * 机器人节点会话里的四个只读工作流工具。
 *
 * 这些工具注册在 workflows 插件上，但只对「运行记录里出现过的机器人会话」可见
 * （可见性由 supervisor 维护的 sessionId → runId 索引决定）。工具不写运行记录，
 * 也不允许切换运行：每个工具都从调用者会话反查它所属的那一次运行。
 *
 * - `buka_workflow_overview`：紧凑的节点图 + 节点概要/状态 + 执行序号列表；
 * - `buka_workflow_execution_input`：某次执行实际收到的输入；
 * - `buka_workflow_execution_output`：某次执行的输出与附件清单；
 * - `buka_workflow_execution_attachment`：列出附件，或分段读取一个附件。
 *
 * 总览刻意不返回 prompt / 最终文本 / 附件内容 / 边的 prompt，避免把整份运行记录塞进
 * 上下文；需要细节时按执行序号单独取。本模块不 import DSH 包，`defineTool`
 * 由入口注入，便于用假 store 单测。
 *
 * @module @buka/dsh-plugin-workflows/session-tools
 */

import { buildRunGraph } from './graph.ts'
import type { WorkflowActiveNode, WorkflowRunRecord, WorkflowStep } from './run-store.ts'

/** 展示用的附件清单项。 */
interface AttachmentLine {
  index: number
  name: string
  bytes: number
  description: string | null
}

/** 执行列表里的一行。 */
interface ExecutionRow {
  seq: number | null
  nodeId: string
  visit: number | null
  type: string | null
  robot: string | null
  status: string
  route: string | null
  routeTo: string | null
  attachments: number
  startedAt: string | null
  finishedAt: string | null
}

/** 定义快照里的节点：只读展示需要的几个字段。 */
interface SnapshotNode {
  [key: string]: unknown
  id?: string
  type?: string
  title?: string
  detail?: string
  next?: unknown[]
}

/** 四个只读工具依赖的 store 方法（结构类型，便于用假 store 单测）。 */
export interface SessionToolStore {
  readRun(runId: string): Promise<WorkflowRunRecord | null>
  readDefinition(runId: string): Promise<Record<string, unknown> | null>
  readNodeResult(
    runId: string,
    seq: number,
    nodeId: string,
  ): Promise<Record<string, unknown> | null>
  readAttachment(
    runId: string,
    seq: number,
    nodeId: string,
    name: string,
    options?: { offset?: number | undefined; maxBytes?: number | undefined },
  ): Promise<Record<string, unknown> | null>
}

/** 会话 id → 所属运行。 */
type ResolveSession = (sessionId: string) => { runId: string } | null | undefined

/** 判断普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 总览里目标 / 节点概要 / 错误的最大字符数。 */
const GOAL_LIMIT = 240
const SUMMARY_LIMIT = 160
const ERROR_LIMIT = 300
const EDGE_NAME_LIMIT = 80

/** 附件工具一次读取的默认 / 最大字节数。 */
const DEFAULT_ATTACHMENT_READ_BYTES = 64 * 1024
const MAX_ATTACHMENT_READ_BYTES = 256 * 1024

/**
 * 压成一行并截断。
 *
 * @param value 原始值
 * @param max 字符上限
 * @returns 单行文本
 */
function clipText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text === '') return ''
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

/**
 * 字节数 → 简短大小。
 *
 * @param value 字节数
 * @returns 简短大小
 */
function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '?'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

/**
 * 节点结果里的附件清单，只保留展示需要的字段。
 *
 * @param value 节点结果里的 `attachments`
 * @returns 展示用的附件清单
 */
function attachmentManifest(value: unknown): AttachmentLine[] {
  if (!Array.isArray(value)) return []
  return (value as unknown[])
    .filter(
      (entry): entry is Record<string, unknown> & { name: string } =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).name === 'string',
    )
    .map((entry, fallbackIndex) => ({
      index:
        typeof entry.index === 'number' && Number.isInteger(entry.index)
          ? entry.index
          : fallbackIndex,
      name: entry.name,
      bytes: typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : 0,
      description:
        typeof entry.description === 'string' && entry.description !== ''
          ? entry.description
          : null,
    }))
}

/**
 * 附件清单的展示文本。
 *
 * @param attachments 附件清单
 * @returns 展示文本行
 */
function attachmentLines(attachments: ReadonlyArray<AttachmentLine>): string[] {
  return attachments.map((entry) => {
    const description = entry.description === null ? '' : ` — ${entry.description}`
    return `- #${entry.index} ${entry.name} (${formatBytes(entry.bytes)})${description}`
  })
}

/**
 * 时间戳 → ISO 字符串。
 *
 * @param value 时间戳
 * @returns ISO 字符串；非法时是 `null`
 */
function isoTime(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  try {
    return new Date(value).toISOString()
  } catch {
    return null
  }
}

/**
 * 按 id 从定义快照里取节点；优先用规范化后的 plan。
 *
 * @param definition 定义快照
 * @param nodeId 节点 id
 * @returns 节点；找不到时是 `null`
 */
function definitionNode(definition: unknown, nodeId: string): SnapshotNode | null {
  if (typeof nodeId !== 'string' || nodeId === '') return null
  const plan = isRecord(definition) ? definition.plan : undefined
  const planned = isRecord(plan) && isRecord(plan.nodes) ? plan.nodes[nodeId] : undefined
  if (planned !== null && typeof planned === 'object') return planned as SnapshotNode
  const raw = isRecord(definition) ? definition.definition : undefined
  const nodes = isRecord(raw) && Array.isArray(raw.nodes) ? (raw.nodes as unknown[]) : []
  const found = nodes.find(
    (node) => node !== null && typeof node === 'object' && (node as SnapshotNode).id === nodeId,
  )
  return (found as SnapshotNode | undefined) ?? null
}

/**
 * 读取运行；不存在时给出明确错误。
 *
 * @param store 运行存储
 * @param runId 运行 id
 * @returns 运行记录
 */
async function readRunOrThrow(store: SessionToolStore, runId: string): Promise<WorkflowRunRecord> {
  const run = await store.readRun(runId)
  if (run === null || run === undefined) {
    throw new Error(
      `workflow run "${runId}" is no longer available; it may have been archived or deleted`,
    )
  }
  return run
}

/**
 * 校验执行序号。
 *
 * @param value 执行序号
 * @returns 合法的执行序号
 */
function requireSeq(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      'seq must be a positive integer execution number from the buka_workflow_overview execution list',
    )
  }
  return value
}

/**
 * 一次执行的当前状态：正在跑的节点还没进 run.steps。
 *
 * @param run 运行记录
 * @param current 活跃节点
 * @returns 执行状态
 */
function currentStatus(run: WorkflowRunRecord, current: WorkflowActiveNode): string {
  if (current?.type === 'user') {
    return run.pendingUser?.nodeId === current.nodeId ? 'waiting' : 'running'
  }
  return 'running'
}

/**
 * 运行中的活跃节点列表：并发用 run.active，旧记录退回单值 run.current。
 *
 * @param run 运行记录
 * @returns 活跃节点列表
 */
function activesOf(run: WorkflowRunRecord): WorkflowActiveNode[] {
  if (Array.isArray(run.active)) {
    return run.active.filter(
      (entry): entry is WorkflowActiveNode => entry !== null && typeof entry === 'object',
    )
  }
  if (run.current !== null && typeof run.current === 'object') return [run.current]
  return []
}

/**
 * 执行列表，按 seq 升序；包含正在执行的 current。
 *
 * @param run 运行记录
 * @returns 执行列表
 */
function executionList(run: WorkflowRunRecord): ExecutionRow[] {
  const steps: WorkflowStep[] = Array.isArray(run.steps) ? run.steps : []
  const list: ExecutionRow[] = []
  for (const step of steps) {
    if (step === null || typeof step !== 'object') continue
    list.push({
      seq: typeof step.seq === 'number' && Number.isInteger(step.seq) ? step.seq : null,
      nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
      visit: typeof step.visit === 'number' && Number.isInteger(step.visit) ? step.visit : null,
      type: typeof step.type === 'string' ? step.type : null,
      robot: typeof step.robot === 'string' && step.robot !== '' ? step.robot : null,
      status: typeof step.status === 'string' && step.status !== '' ? step.status : 'unknown',
      route: typeof step.route === 'string' && step.route !== '' ? step.route : null,
      routeTo: typeof step.routeTo === 'string' && step.routeTo !== '' ? step.routeTo : null,
      attachments: Array.isArray(step.attachments) ? step.attachments.length : 0,
      startedAt: isoTime(step.startedAt),
      finishedAt: isoTime(step.finishedAt),
    })
  }
  for (const current of activesOf(run)) {
    if (list.some((item) => item.seq === current.seq)) continue
    list.push({
      seq: typeof current.seq === 'number' && Number.isInteger(current.seq) ? current.seq : null,
      nodeId: typeof current.nodeId === 'string' ? current.nodeId : '',
      visit:
        typeof current.visit === 'number' && Number.isInteger(current.visit) ? current.visit : null,
      type: typeof current.type === 'string' ? current.type : null,
      robot: typeof current.robot === 'string' && current.robot !== '' ? current.robot : null,
      status: currentStatus(run, current),
      route: null,
      routeTo: null,
      attachments: 0,
      startedAt: isoTime(current.startedAt),
      finishedAt: null,
    })
  }
  list.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
  return list
}

/**
 * 按 seq 找一次执行；优先 run.steps，其次 current。
 *
 * @param run 运行记录
 * @param seq 执行序号
 * @returns 命中的执行；找不到时是 `null`
 */
function findExecution(
  run: WorkflowRunRecord,
  seq: number,
): { step: Record<string, unknown>; running: boolean } | null {
  const steps: WorkflowStep[] = Array.isArray(run.steps) ? run.steps : []
  const step = steps.find((item) => item !== null && typeof item === 'object' && item.seq === seq)
  if (step !== undefined) return { step, running: false }
  const current = activesOf(run).find((item) => item.seq === seq)
  if (current !== undefined) {
    return {
      step: {
        ...current,
        status: currentStatus(run, current),
        stopReason: null,
      },
      running: true,
    }
  }
  return null
}

/**
 * 总览的返回值：只保留图结构与状态，不夹带执行内容。
 *
 * @param run 运行记录
 * @param definition 定义快照
 * @returns 总览返回值
 */
function overviewValue(
  run: WorkflowRunRecord,
  definition: Record<string, unknown> | null,
): Record<string, unknown> {
  const model = buildRunGraph({ run, definition })
  const actives = activesOf(run)
  const current: WorkflowActiveNode | null = actives[0] ?? null
  const pendingUser = run.pendingUser
  const pendingInteraction = run.pendingInteraction
  const nodes = (Array.isArray(model?.nodes) ? model.nodes : []).map((node) => ({
    id: typeof node.id === 'string' ? node.id : '',
    type: typeof node.type === 'string' ? node.type : null,
    state: typeof node.state === 'string' ? node.state : 'idle',
    visits: Number.isInteger(node.visits) ? node.visits : 0,
    lastSeq: Number.isInteger(node.lastSeq) ? node.lastSeq : null,
    summary:
      node.type === 'robot'
        ? clipText(node.summary, SUMMARY_LIMIT)
        : node.type === 'user'
          ? clipText(node.title, SUMMARY_LIMIT)
          : null,
    robot:
      node.type === 'robot' && typeof node.robot === 'string' && node.robot !== ''
        ? node.robot
        : null,
    unreachable: node.unreachable === true,
  }))
  const edges = (Array.isArray(model?.edges) ? model.edges : []).map((edge) => ({
    from: typeof edge.from === 'string' ? edge.from : '',
    to: typeof edge.to === 'string' ? edge.to : '',
    kind: typeof edge.kind === 'string' ? edge.kind : 'next',
    names: (Array.isArray(edge.names) ? edge.names : [])
      .map((name) => clipText(name, EDGE_NAME_LIMIT))
      .filter((name) => name !== ''),
    traversed: edge.traversed === true,
    traversals: Number.isInteger(edge.traversals) ? edge.traversals : 0,
    loop: edge.loop === true,
  }))
  return {
    run: {
      runId: typeof run.runId === 'string' ? run.runId : '',
      seq: Number.isInteger(run.seq) ? run.seq : null,
      status: typeof run.status === 'string' ? run.status : 'unknown',
      goal: clipText(run.goal, GOAL_LIMIT),
      createdAt: isoTime(run.createdAt),
      finishedAt: isoTime(run.finishedAt),
      current:
        current !== null
          ? {
              nodeId: typeof current.nodeId === 'string' ? current.nodeId : '',
              seq: Number.isInteger(current.seq) ? current.seq : null,
              type: typeof current.type === 'string' ? current.type : null,
              visit: Number.isInteger(current.visit) ? current.visit : null,
              robot:
                typeof current.robot === 'string' && current.robot !== '' ? current.robot : null,
            }
          : null,
      active: actives.map((active) => ({
        nodeId: typeof active.nodeId === 'string' ? active.nodeId : '',
        seq: Number.isInteger(active.seq) ? active.seq : null,
        type: typeof active.type === 'string' ? active.type : null,
        visit: Number.isInteger(active.visit) ? active.visit : null,
        robot: typeof active.robot === 'string' && active.robot !== '' ? active.robot : null,
      })),
      pendingUser:
        pendingUser !== null && pendingUser !== undefined
          ? {
              nodeId: typeof pendingUser.nodeId === 'string' ? pendingUser.nodeId : '',
              title: clipText(pendingUser.title, SUMMARY_LIMIT),
            }
          : null,
      pendingInteraction:
        pendingInteraction !== null && pendingInteraction !== undefined
          ? {
              kind: typeof pendingInteraction.kind === 'string' ? pendingInteraction.kind : null,
              nodeId:
                typeof pendingInteraction.nodeId === 'string' ? pendingInteraction.nodeId : '',
              seq: Number.isInteger(pendingInteraction.seq) ? pendingInteraction.seq : null,
            }
          : null,
      error: clipText(run.error, ERROR_LIMIT) || null,
    },
    nodes,
    edges,
    executions: executionList(run),
  }
}
/**
 * 总览的紧凑文本。
 *
 * @param value 总览返回值
 * @returns 展示文本
 */
function renderOverview(value: unknown): string {
  const valueRecord = isRecord(value) ? value : {}
  const run = isRecord(valueRecord.run) ? valueRecord.run : {}
  const seq = run.seq
  const label = typeof seq === 'number' && Number.isInteger(seq) ? `#${seq} ` : ''
  const lines = [`workflow ${label}${run.runId ?? ''} — ${run.status ?? 'unknown'}`]
  if (typeof run.goal === 'string' && run.goal !== '') lines.push(`goal: ${run.goal}`)
  if (typeof run.createdAt === 'string' && run.createdAt !== '')
    lines.push(`created: ${run.createdAt}`)
  if (typeof run.finishedAt === 'string' && run.finishedAt !== '')
    lines.push(`finished: ${run.finishedAt}`)
  const actives = Array.isArray(run.active) ? run.active : []
  const currentList = actives.length > 0 ? actives : run.current ? [run.current] : []
  for (const current of currentList) {
    const item = isRecord(current) ? current : {}
    const currentSeq = item.seq
    const suffix =
      typeof currentSeq === 'number' && Number.isInteger(currentSeq)
        ? ` (execution #${currentSeq})`
        : ''
    lines.push(`current: ${String(item.nodeId)}${suffix}`)
  }
  if (run.pendingUser !== null && run.pendingUser !== undefined) {
    const pending = isRecord(run.pendingUser) ? run.pendingUser : {}
    lines.push(`waiting at user node: ${String(pending.title || pending.nodeId)}`)
  }
  if (run.pendingInteraction !== null && run.pendingInteraction !== undefined) {
    const pending = isRecord(run.pendingInteraction) ? run.pendingInteraction : {}
    lines.push(
      `waiting for user: ${String(pending.kind ?? 'interaction')} at ${String(pending.nodeId)}`,
    )
  }
  if (typeof run.error === 'string' && run.error !== '') lines.push(`error: ${run.error}`)

  const nodes = Array.isArray(valueRecord.nodes) ? valueRecord.nodes : []
  lines.push('nodes:')
  if (nodes.length === 0) lines.push('- (none)')
  for (const rawNode of nodes) {
    const node = isRecord(rawNode) ? rawNode : {}
    const state = node.state === 'idle' ? 'not reached' : String(node.state)
    const markers: string[] = []
    if (node.unreachable === true) markers.push('unreachable')
    const visits = node.visits
    if (typeof visits === 'number' && visits > 1) markers.push(`×${visits}`)
    const lastSeq = node.lastSeq
    if (typeof lastSeq === 'number' && Number.isInteger(lastSeq)) markers.push(`last=#${lastSeq}`)
    const robot = node.robot === null || node.robot === undefined ? '' : ` ${String(node.robot)}`
    const summary =
      node.summary === null || node.summary === undefined || node.summary === ''
        ? ''
        : ` — ${String(node.summary)}`
    lines.push(
      `- ${String(node.id)} [${String(node.type ?? 'unknown')}${robot}] ${state}${markers.length > 0 ? ` ${markers.join(' ')}` : ''}${summary}`,
    )
  }

  const edges = Array.isArray(valueRecord.edges) ? valueRecord.edges : []
  lines.push('edges:')
  if (edges.length === 0) lines.push('- (none)')
  for (const rawEdge of edges) {
    const edge = isRecord(rawEdge) ? rawEdge : {}
    const names = Array.isArray(edge.names) ? edge.names : []
    const nameText = names.length > 0 ? ` ${names.map((name) => String(name)).join(' / ')}` : ''
    const markers: string[] = []
    if (edge.loop === true) markers.push('loop')
    const traversals = edge.traversals
    if (edge.traversed === true) markers.push(`×${String(traversals)}`)
    lines.push(
      `- ${String(edge.from)} -> ${String(edge.to)} [${String(edge.kind)}${nameText}]${markers.length > 0 ? ` ${markers.join(' ')}` : ''}`,
    )
  }

  const executions = Array.isArray(valueRecord.executions) ? valueRecord.executions : []
  lines.push('executions:')
  if (executions.length === 0) lines.push('- (none)')
  for (const rawExecution of executions) {
    const execution = isRecord(rawExecution) ? rawExecution : {}
    const robot =
      execution.robot === null || execution.robot === undefined ? '' : ` ${String(execution.robot)}`
    const route =
      execution.route === null || execution.route === undefined
        ? ''
        : ` route=${String(execution.route)}`
    const time = execution.finishedAt ?? execution.startedAt
    const stamp = typeof time === 'string' && time !== '' ? ` ${time}` : ''
    const attachmentsCount = execution.attachments
    const attachments =
      typeof attachmentsCount === 'number' && attachmentsCount > 0
        ? ` attachments=${attachmentsCount}`
        : ''
    lines.push(
      `- #${String(execution.seq ?? '?')} ${String(execution.nodeId)} [${String(execution.type ?? 'unknown')}${robot}] ${String(execution.status)}${route}${attachments}${stamp}`,
    )
  }
  return lines.join('\n')
}
/**
 * 输入工具的展示文本。
 *
 * @param value 输入工具返回值
 * @returns 展示文本
 */
function renderExecutionInput(value: unknown): string {
  const record = isRecord(value) ? value : {}
  const robot =
    record.robot === null || record.robot === undefined ? '' : ` · robot "${String(record.robot)}"`
  const lines = [
    `execution #${String(record.seq ?? '?')} · ${String(record.type ?? 'unknown')} "${String(record.nodeId ?? '')}"${robot} · ${String(record.status ?? 'unknown')}`,
    '',
    typeof record.input === 'string' && record.input !== '' ? record.input : '(empty input)',
  ]
  if (record.truncated === true) lines.push('', '(input was truncated when it was recorded)')
  return lines.join('\n')
}
/**
 * 输出工具的展示文本。正文优先；正文为空时才展示结构化 JSON，避免重复。
 *
 * @param value 输出工具返回值
 * @returns 展示文本
 */
function renderExecutionOutput(value: unknown): string {
  const record = isRecord(value) ? value : {}
  const robot =
    record.robot === null || record.robot === undefined ? '' : ` · robot "${String(record.robot)}"`
  const stop =
    typeof record.stopReason === 'string' && record.stopReason !== ''
      ? ` (${record.stopReason})`
      : ''
  const route =
    typeof record.route === 'string' && record.route !== '' ? ` route=${record.route}` : ''
  const lines = [
    `execution #${String(record.seq ?? '?')} · ${String(record.type ?? 'unknown')} "${String(record.nodeId ?? '')}"${robot} · ${String(record.status ?? 'unknown')}${stop}${route}`,
    '',
  ]
  if (typeof record.output === 'string' && record.output !== '') {
    lines.push(record.output)
  } else if (record.structured !== null && record.structured !== undefined) {
    lines.push(JSON.stringify(record.structured, null, 2))
  } else {
    lines.push('(no output text)')
  }
  if (typeof record.error === 'string' && record.error !== '')
    lines.push('', `error: ${record.error}`)
  if (record.truncated === true) lines.push('', '(output was truncated when it was recorded)')
  const attachments = Array.isArray(record.attachments) ? record.attachments : []
  if (attachments.length > 0) {
    lines.push('', 'attachments:')
    lines.push(...attachmentLines(attachmentManifest(attachments)))
    lines.push(
      `use buka_workflow_execution_attachment with seq=${String(record.seq ?? '?')} and name to read one; binary/large files stay on disk`,
    )
  }
  return lines.join('\n')
}
/**
 * 附件工具的展示文本：列表或单文件内容。
 *
 * @param value 附件工具返回值
 * @returns 展示文本
 */
function renderExecutionAttachment(value: unknown): string {
  const record = isRecord(value) ? value : {}
  const robot =
    record.robot === null || record.robot === undefined ? '' : ` · robot "${String(record.robot)}"`
  const lines = [
    `execution #${String(record.seq ?? '?')} · ${String(record.type ?? 'unknown')} "${String(record.nodeId ?? '')}"${robot} · ${String(record.status ?? 'unknown')}`,
    '',
  ]
  const attachment = record.attachment
  if (attachment === null || attachment === undefined) {
    const attachments = Array.isArray(record.attachments) ? record.attachments : []
    if (attachments.length === 0) {
      lines.push('(no attachments)')
    } else {
      lines.push('attachments:')
      lines.push(...attachmentLines(attachmentManifest(attachments)))
      lines.push('')
      lines.push('pass name to read one attachment')
    }
    return lines.join('\n')
  }
  const attachmentRecord = isRecord(attachment) ? attachment : {}
  const description =
    typeof attachmentRecord.description === 'string' && attachmentRecord.description !== ''
      ? ` — ${attachmentRecord.description}`
      : ''
  lines.push(
    `attachment #${String(attachmentRecord.index ?? '?')} ${String(attachmentRecord.name ?? '')} (${formatBytes(attachmentRecord.bytes)})${description}`,
  )
  if (typeof attachmentRecord.path === 'string' && attachmentRecord.path !== '') {
    lines.push(`path: ${attachmentRecord.path}`)
  }
  lines.push('')
  if (attachmentRecord.binary === true) {
    lines.push('(binary file; read it from the path instead of embedding it in a prompt)')
  } else if (typeof attachmentRecord.text === 'string' && attachmentRecord.text !== '') {
    lines.push(attachmentRecord.text)
  } else {
    lines.push('(empty text)')
  }
  if (attachmentRecord.truncated === true) {
    const offset = attachmentRecord.offset
    const read = attachmentRecord.read
    const next =
      (typeof offset === 'number' && Number.isInteger(offset) ? offset : 0) +
      (typeof read === 'number' && Number.isInteger(read) ? read : 0)
    lines.push('', `(truncated; continue with offset=${next})`)
  }
  return lines.join('\n')
}
/**
 * 四个工具共用的可见性条件：只对工作流机器人会话可见。
 *
 * 条件在每一步都会执行；`ensureIndex` 只建一次索引。任何索引构建失败都按
 * “不可见”处理，不能让一个坏运行记录让会话的 step preparation 失败。
 *
 * @param input 索引构建与运行反查
 * @returns 工具可见性条件
 */
export function createSessionToolVisibility(
  {
    ensureIndex,
    resolveSession,
  }: {
    ensureIndex: () => Promise<void>
    resolveSession: ResolveSession
  } = {
    ensureIndex: async () => undefined,
    resolveSession: () => null,
  },
): (context: {
  agent?: { id?: string } | undefined
  signal?: AbortSignal | undefined
}) => Promise<boolean> {
  if (typeof ensureIndex !== 'function')
    throw new TypeError('createSessionToolVisibility: ensureIndex is required')
  if (typeof resolveSession !== 'function') {
    throw new TypeError('createSessionToolVisibility: resolveSession is required')
  }
  return async (context) => {
    if (context?.signal?.aborted) return false
    try {
      await ensureIndex()
    } catch {
      return false
    }
    if (context?.signal?.aborted) return false
    const binding = resolveSession(context?.agent?.id ?? '')
    return binding !== null && binding !== undefined
  }
}

/**
 * 创建四个只读工具。
 *
 * @param input 工具工厂、运行存储与会话反查
 * @returns 注册用的四个工具定义
 */
export function createWorkflowSessionTools<T>({
  defineTool,
  store,
  resolveSession,
}: {
  defineTool: (definition: never) => T
  store: SessionToolStore
  resolveSession: ResolveSession
}): T[] {
  if (typeof defineTool !== 'function')
    throw new TypeError('createWorkflowSessionTools: defineTool is required')
  if (store === null || typeof store !== 'object')
    throw new TypeError('createWorkflowSessionTools: store is required')
  if (typeof resolveSession !== 'function') {
    throw new TypeError('createWorkflowSessionTools: resolveSession is required')
  }

  /**
   * 官方 `defineTool` 的泛型会从 schema 反推精确返回值；这里的工具定义按运行时
   * 形状书写，统一在这个边界收口（运行时仍由 DSH 按其 schema 校验）。
   */
  function tool(definition: Record<string, unknown>): T {
    return (defineTool as unknown as (definition: Record<string, unknown>) => T)(definition)
  }

  /**
   * 从调用者会话反查运行；解析不到时说明这些工具只属于工作流机器人会话。
   *
   * @param exec 工具执行上下文
   * @returns 运行 id
   */
  function runIdOf(exec: unknown): string {
    const agent = isRecord(exec) && isRecord(exec.agent) ? exec.agent : null
    const sessionId = agent !== null && typeof agent.id === 'string' ? agent.id : ''
    const binding = sessionId === '' ? null : resolveSession(sessionId)
    const runId = typeof binding?.runId === 'string' ? binding.runId : ''
    if (runId === '') {
      throw new Error(
        'workflow inspection tools are only available to robot sessions that belong to a workflow run',
      )
    }
    return runId
  }

  return [
    tool({
      name: 'buka_workflow_overview',
      description:
        'Inspect the workflow run this robot session belongs to. Returns a compact node graph (node ids, types, summaries, states, edges), the current status, and the numbered execution list in execution order. It never returns prompts, final texts, edge prompts or other execution details: use buka_workflow_execution_input / buka_workflow_execution_output with an execution number from this list when you need the details of one execution.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            run: { type: 'json', required: true, description: 'Compact run status and pointers.' },
            nodes: {
              type: 'json',
              required: true,
              description: 'Workflow nodes with state and summary.',
            },
            edges: { type: 'json', required: true, description: 'Workflow edges without prompts.' },
            executions: {
              type: 'json',
              required: true,
              description: 'Executions in sequence order.',
            },
          },
        },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderOverview(value) }],
      },
      async execute(_args: unknown, exec: unknown) {
        const runId = runIdOf(exec)
        const run = await readRunOrThrow(store, runId)
        const definition = await store.readDefinition(runId)
        return overviewValue(run, definition)
      },
    }),

    tool({
      name: 'buka_workflow_execution_input',
      description:
        'Read the exact input recorded for one execution of the workflow run this robot session belongs to. Use the execution number (seq) from the buka_workflow_overview execution list. A robot execution returns the rendered prompt that was sent to that robot session; a user execution returns the title, rendered instruction and choices that were shown to the user. Read-only.',
      parameters: {
        seq: {
          type: 'number',
          required: true,
          description: 'Execution number (seq) from the buka_workflow_overview execution list.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seq: { type: 'number', required: true },
            nodeId: { type: 'string', required: true },
            visit: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
            type: { type: 'string', required: true },
            robot: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            status: { type: 'string', required: true },
            input: { type: 'string', required: true },
            truncated: { type: 'boolean', required: true },
          },
        },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: renderExecutionInput(value) },
        ],
      },
      async execute(args: Record<string, unknown>, exec: unknown) {
        const runId = runIdOf(exec)
        const seq = requireSeq(args?.seq)
        const run = await readRunOrThrow(store, runId)
        const found = findExecution(run, seq)
        if (found === null) {
          throw new Error(
            `execution #${seq} was not found in workflow run "${runId}"; use the execution list from buka_workflow_overview`,
          )
        }
        const step = found.step
        if (step.type === 'user') {
          const definition = await store.readDefinition(runId)
          const node = definitionNode(
            definition,
            typeof step.nodeId === 'string' ? step.nodeId : '',
          )
          const pending =
            found.running && run.pendingUser?.nodeId === step.nodeId ? run.pendingUser : null
          const title = pending?.title ?? (typeof node?.title === 'string' ? node.title : '')
          const detail =
            typeof pending?.detail === 'string' && pending.detail !== ''
              ? pending.detail
              : typeof step.input === 'string' && step.input !== ''
                ? step.input
                : typeof node?.detail === 'string'
                  ? node.detail
                  : ''
          const options: unknown[] = Array.isArray(pending?.options)
            ? (pending.options as unknown[])
            : Array.isArray(node?.next)
              ? (node.next as unknown[])
              : []
          const optionLines = options
            .filter(
              (option): option is Record<string, unknown> =>
                option !== null &&
                typeof option === 'object' &&
                typeof (option as Record<string, unknown>).label === 'string',
            )
            .map(
              (option) =>
                `- ${String(option.label)}${typeof option.description === 'string' && option.description !== '' ? `: ${option.description}` : ''}`,
            )
          const parts = [title, detail]
          if (optionLines.length > 0) parts.push(`choices:\n${optionLines.join('\n')}`)
          return {
            seq,
            nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
            visit: Number.isInteger(step.visit) ? step.visit : null,
            type: 'user',
            robot: null,
            status: found.running
              ? 'waiting'
              : typeof step.status === 'string'
                ? step.status
                : 'unknown',
            input: parts.filter((part) => typeof part === 'string' && part !== '').join('\n'),
            truncated: false,
          }
        }
        const result = await store.readNodeResult(
          runId,
          seq,
          typeof step.nodeId === 'string' ? step.nodeId : '',
        )
        let input = typeof result?.prompt === 'string' ? result.prompt : ''
        const runningActive = found.running
          ? activesOf(run).find((item) => item.seq === seq)
          : undefined
        if (
          input === '' &&
          runningActive !== undefined &&
          typeof runningActive.prompt === 'string'
        ) {
          input = runningActive.prompt
        }
        if (input === '') {
          throw new Error(
            `execution #${seq} (node "${step.nodeId}") has no recorded input in workflow run "${runId}"`,
          )
        }
        return {
          seq,
          nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
          visit: Number.isInteger(step.visit) ? step.visit : null,
          type: typeof step.type === 'string' ? step.type : 'robot',
          robot: typeof step.robot === 'string' && step.robot !== '' ? step.robot : null,
          status: typeof step.status === 'string' ? step.status : 'unknown',
          input,
          truncated: result?.promptTruncated === true,
        }
      },
    }),

    tool({
      name: 'buka_workflow_execution_output',
      description:
        'Read the recorded output of one execution of the workflow run this robot session belongs to. Use the execution number (seq) from the buka_workflow_overview execution list. A robot execution returns its final text, structured JSON result, attachment manifest, route, stop reason and error; a node that aborted the workflow reports stopReason "aborted" with its reason in error. A user execution returns the readable answer transcript plus the chosen route and recorded answers. A running execution has no output yet. Use buka_workflow_execution_attachment to read an attachment. Read-only.',
      parameters: {
        seq: {
          type: 'number',
          required: true,
          description: 'Execution number (seq) from the buka_workflow_overview execution list.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seq: { type: 'number', required: true },
            nodeId: { type: 'string', required: true },
            visit: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
            type: { type: 'string', required: true },
            robot: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            status: { type: 'string', required: true },
            stopReason: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            output: { type: 'string', required: true },
            structured: { type: 'json', required: true },
            attachments: {
              type: 'array',
              required: true,
              description:
                'Attachment manifest for this execution; use buka_workflow_execution_attachment to read one.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'number', required: true },
                  name: { type: 'string', required: true },
                  bytes: { type: 'number', required: true },
                  description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                },
              },
            },
            route: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            routeTo: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            error: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            truncated: { type: 'boolean', required: true },
            finishedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          },
        },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: renderExecutionOutput(value) },
        ],
      },
      async execute(args: Record<string, unknown>, exec: unknown) {
        const runId = runIdOf(exec)
        const seq = requireSeq(args?.seq)
        const run = await readRunOrThrow(store, runId)
        const found = findExecution(run, seq)
        if (found === null) {
          throw new Error(
            `execution #${seq} was not found in workflow run "${runId}"; use the execution list from buka_workflow_overview`,
          )
        }
        const step = found.step
        if (step.type === 'user') {
          if (found.running) {
            throw new Error(
              `execution #${seq} (user "${step.nodeId}") is still waiting for the user and has no output yet`,
            )
          }
          const answers = Array.isArray(step.answers) ? step.answers : []
          return {
            seq,
            nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
            visit: Number.isInteger(step.visit) ? step.visit : null,
            type: 'user',
            robot: null,
            status: typeof step.status === 'string' ? step.status : 'unknown',
            stopReason: null,
            output: typeof step.text === 'string' ? step.text : '',
            structured: {
              route: typeof step.route === 'string' && step.route !== '' ? step.route : null,
              routeTo:
                typeof step.routeTo === 'string' && step.routeTo !== '' ? step.routeTo : null,
              answers,
            },
            attachments: [],
            route: typeof step.route === 'string' && step.route !== '' ? step.route : null,
            routeTo: typeof step.routeTo === 'string' && step.routeTo !== '' ? step.routeTo : null,
            error: typeof step.error === 'string' && step.error !== '' ? step.error : null,
            truncated: false,
            finishedAt: isoTime(step.finishedAt),
          }
        }
        if (found.running) {
          throw new Error(
            `execution #${seq} (node "${step.nodeId}") is still running and has no output yet`,
          )
        }
        const result = await store.readNodeResult(
          runId,
          seq,
          typeof step.nodeId === 'string' ? step.nodeId : '',
        )
        if (result === null) {
          throw new Error(
            `execution #${seq} (node "${step.nodeId}") has no recorded output in workflow run "${runId}"`,
          )
        }
        return {
          seq,
          nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
          visit: Number.isInteger(step.visit) ? step.visit : null,
          type: typeof step.type === 'string' ? step.type : 'robot',
          robot: typeof step.robot === 'string' && step.robot !== '' ? step.robot : null,
          status: typeof step.status === 'string' ? step.status : 'unknown',
          stopReason:
            typeof result.stopReason === 'string'
              ? result.stopReason
              : typeof step.stopReason === 'string'
                ? step.stopReason
                : null,
          output: typeof result.text === 'string' ? result.text : '',
          structured: result.structured ?? step.data ?? null,
          attachments: attachmentManifest(result.attachments),
          route: typeof step.route === 'string' && step.route !== '' ? step.route : null,
          routeTo: typeof step.routeTo === 'string' && step.routeTo !== '' ? step.routeTo : null,
          error:
            typeof result.error === 'string' && result.error !== ''
              ? result.error
              : typeof step.error === 'string' && step.error !== ''
                ? step.error
                : null,
          truncated: result.textTruncated === true,
          finishedAt: isoTime(step.finishedAt ?? result.finishedAt),
        }
      },
    }),

    tool({
      name: 'buka_workflow_execution_attachment',
      description:
        'List or read the attachment files recorded for one execution of the workflow run this robot session belongs to. Use the execution number (seq) from the buka_workflow_overview execution list. Omit name to list the attachment manifest; pass name to read one file. Text is returned up to maxBytes (default 64 KiB) and can be continued with offset; binary files return metadata and an absolute path instead of text. Read-only: only attachments recorded for this run are accessible.',
      parameters: {
        seq: {
          type: 'number',
          required: true,
          description: 'Execution number (seq) from the buka_workflow_overview execution list.',
        },
        name: {
          type: 'string',
          description: 'Attachment name from the manifest. Omit to list all attachments.',
        },
        offset: {
          type: 'number',
          description: 'Byte offset for reading a text attachment. Defaults to 0.',
        },
        maxBytes: {
          type: 'number',
          description: 'Maximum bytes to read (default 64 KiB, capped at 256 KiB).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seq: { type: 'number', required: true },
            nodeId: { type: 'string', required: true },
            type: { type: 'string', required: true },
            robot: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            status: { type: 'string', required: true },
            attachments: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'number', required: true },
                  name: { type: 'string', required: true },
                  bytes: { type: 'number', required: true },
                  description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                },
              },
            },
            attachment: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    index: { type: 'number', required: true },
                    name: { type: 'string', required: true },
                    description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                    bytes: { type: 'number', required: true },
                    path: { type: 'string', required: true },
                    text: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                    binary: { type: 'boolean', required: true },
                    truncated: { type: 'boolean', required: true },
                    offset: { type: 'number', required: true },
                    read: { type: 'number', required: true },
                  },
                },
                { type: 'null' },
              ],
              required: true,
            },
          },
        },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: renderExecutionAttachment(value) },
        ],
      },
      async execute(args: Record<string, unknown>, exec: unknown) {
        const runId = runIdOf(exec)
        const seq = requireSeq(args?.seq)
        const run = await readRunOrThrow(store, runId)
        const found = findExecution(run, seq)
        if (found === null) {
          throw new Error(
            `execution #${seq} was not found in workflow run "${runId}"; use the execution list from buka_workflow_overview`,
          )
        }
        const step = found.step
        if (found.running) {
          throw new Error(
            `execution #${seq} (node "${step.nodeId}") is still running and has no attachments yet`,
          )
        }
        if (step.type === 'user') {
          if (typeof args?.name === 'string' && args.name.trim() !== '') {
            throw new Error(`execution #${seq} (user "${step.nodeId}") has no attachments`)
          }
          return {
            seq,
            nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
            type: 'user',
            robot: null,
            status: found.running
              ? 'waiting'
              : typeof step.status === 'string'
                ? step.status
                : 'unknown',
            attachments: [],
            attachment: null,
          }
        }
        const result = await store.readNodeResult(
          runId,
          seq,
          typeof step.nodeId === 'string' ? step.nodeId : '',
        )
        if (result === null) {
          throw new Error(
            `execution #${seq} (node "${step.nodeId}") has no recorded output in workflow run "${runId}"`,
          )
        }
        const attachments = attachmentManifest(result.attachments)
        const name = typeof args?.name === 'string' ? args.name.trim() : ''
        if (name === '') {
          return {
            seq,
            nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
            type: typeof step.type === 'string' ? step.type : 'robot',
            robot: typeof step.robot === 'string' && step.robot !== '' ? step.robot : null,
            status: typeof step.status === 'string' ? step.status : 'unknown',
            attachments,
            attachment: null,
          }
        }
        const rawOffset = args?.offset
        if (
          rawOffset !== undefined &&
          (typeof rawOffset !== 'number' || !Number.isInteger(rawOffset) || rawOffset < 0)
        ) {
          throw new Error('offset must be a non-negative integer')
        }
        const rawMaxBytes = args?.maxBytes
        if (
          rawMaxBytes !== undefined &&
          (typeof rawMaxBytes !== 'number' || !Number.isInteger(rawMaxBytes) || rawMaxBytes <= 0)
        ) {
          throw new Error('maxBytes must be a positive integer')
        }
        const maxBytes =
          typeof rawMaxBytes === 'number' && Number.isInteger(rawMaxBytes)
            ? Math.min(rawMaxBytes, MAX_ATTACHMENT_READ_BYTES)
            : DEFAULT_ATTACHMENT_READ_BYTES
        const attachment = await store.readAttachment(
          runId as string,
          seq,
          step.nodeId as string,
          name,
          {
            offset: typeof rawOffset === 'number' && Number.isInteger(rawOffset) ? rawOffset : 0,
            maxBytes,
          },
        )
        if (attachment === null) {
          const available = attachments.map((entry) => entry.name).join(', ')
          throw new Error(
            `attachment "${name}" was not found for execution #${seq}; available: ${available === '' ? '(none)' : available}`,
          )
        }
        return {
          seq,
          nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
          type: typeof step.type === 'string' ? step.type : 'robot',
          robot: typeof step.robot === 'string' && step.robot !== '' ? step.robot : null,
          status: typeof step.status === 'string' ? step.status : 'unknown',
          attachments,
          attachment,
        }
      },
    }),
  ]
}

export { renderExecutionInput, renderExecutionOutput, renderOverview }
