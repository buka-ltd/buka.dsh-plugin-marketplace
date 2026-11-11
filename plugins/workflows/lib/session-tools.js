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

import { buildRunGraph } from './graph.js'

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
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function clipText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text === '') return ''
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

/**
 * 字节数 → 简短大小。
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '?'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

/**
 * 节点结果里的附件清单，只保留展示需要的字段。
 *
 * @param {unknown} value
 * @returns {Array<{ index: number, name: string, bytes: number, description: string | null }>}
 */
function attachmentManifest(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.name === 'string')
    .map((entry, fallbackIndex) => ({
      index: Number.isInteger(entry.index) ? entry.index : fallbackIndex,
      name: entry.name,
      bytes: typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : 0,
      description:
        typeof entry.description === 'string' && entry.description !== '' ? entry.description : null,
    }))
}

/**
 * 附件清单的展示文本。
 *
 * @param {Array<{ index: number, name: string, bytes: number, description: string | null }>} attachments
 * @returns {string[]}
 */
function attachmentLines(attachments) {
  return attachments.map((entry) => {
    const description = entry.description === null ? '' : ` — ${entry.description}`
    return `- #${entry.index} ${entry.name} (${formatBytes(entry.bytes)})${description}`
  })
}

/**
 * 时间戳 → ISO 字符串。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function isoTime(value) {
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
 * @param {unknown} definition
 * @param {string} nodeId
 * @returns {Record<string, any> | null}
 */
function definitionNode(definition, nodeId) {
  if (typeof nodeId !== 'string' || nodeId === '') return null
  const plan = definition?.plan
  const planned = plan !== null && typeof plan === 'object' ? plan.nodes?.[nodeId] : undefined
  if (planned !== null && typeof planned === 'object') return planned
  const raw = definition?.definition
  const nodes = raw !== null && typeof raw === 'object' && Array.isArray(raw.nodes) ? raw.nodes : []
  const found = nodes.find((node) => node !== null && typeof node === 'object' && node.id === nodeId)
  return found ?? null
}

/**
 * 读取运行；不存在时给出明确错误。
 *
 * @param {{ readRun: (runId: string) => Promise<Record<string, any> | null> }} store
 * @param {string} runId
 * @returns {Promise<Record<string, any>>}
 */
async function readRunOrThrow(store, runId) {
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
 * @param {unknown} value
 * @returns {number}
 */
function requireSeq(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      'seq must be a positive integer execution number from the buka_workflow_overview execution list',
    )
  }
  return value
}

/**
 * 一次执行的当前状态：正在跑的节点还没进 run.steps。
 *
 * @param {Record<string, any>} run
 * @param {Record<string, any>} current
 * @returns {string}
 */
function currentStatus(run, current) {
  if (current?.type === 'user') {
    return run.pendingUser?.nodeId === current.nodeId ? 'waiting' : 'running'
  }
  return 'running'
}

/**
 * 运行中的活跃节点列表：并发用 run.active，旧记录退回单值 run.current。
 *
 * @param {Record<string, any>} run
 * @returns {Array<Record<string, any>>}
 */
function activesOf(run) {
  if (Array.isArray(run.active)) {
    return run.active.filter((entry) => entry !== null && typeof entry === 'object')
  }
  if (run.current !== null && typeof run.current === 'object') return [run.current]
  return []
}

/**
 * 执行列表，按 seq 升序；包含正在执行的 current。
 *
 * @param {Record<string, any>} run
 * @returns {Array<Record<string, any>>}
 */
function executionList(run) {
  const steps = Array.isArray(run.steps) ? run.steps : []
  /** @type {Array<Record<string, any>>} */
  const list = []
  for (const step of steps) {
    if (step === null || typeof step !== 'object') continue
    list.push({
      seq: Number.isInteger(step.seq) ? step.seq : null,
      nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
      visit: Number.isInteger(step.visit) ? step.visit : null,
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
      seq: Number.isInteger(current.seq) ? current.seq : null,
      nodeId: typeof current.nodeId === 'string' ? current.nodeId : '',
      visit: Number.isInteger(current.visit) ? current.visit : null,
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
 * @param {Record<string, any>} run
 * @param {number} seq
 * @returns {{ step: Record<string, any>, running: boolean } | null}
 */
function findExecution(run, seq) {
  const steps = Array.isArray(run.steps) ? run.steps : []
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
 * @param {Record<string, any>} run
 * @param {Record<string, any> | null} definition
 * @returns {Record<string, any>}
 */
function overviewValue(run, definition) {
  const model = buildRunGraph({ run, definition })
  const actives = activesOf(run)
  const current = actives[0] ?? null
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
    robot: node.type === 'robot' && typeof node.robot === 'string' && node.robot !== '' ? node.robot : null,
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
        current !== null && typeof current === 'object'
          ? {
              nodeId: typeof current.nodeId === 'string' ? current.nodeId : '',
              seq: Number.isInteger(current.seq) ? current.seq : null,
              type: typeof current.type === 'string' ? current.type : null,
              visit: Number.isInteger(current.visit) ? current.visit : null,
              robot: typeof current.robot === 'string' && current.robot !== '' ? current.robot : null,
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
        pendingUser !== null && typeof pendingUser === 'object'
          ? {
              nodeId: typeof pendingUser.nodeId === 'string' ? pendingUser.nodeId : '',
              title: clipText(pendingUser.title, SUMMARY_LIMIT),
            }
          : null,
      pendingInteraction:
        pendingInteraction !== null && typeof pendingInteraction === 'object'
          ? {
              kind: typeof pendingInteraction.kind === 'string' ? pendingInteraction.kind : null,
              nodeId: typeof pendingInteraction.nodeId === 'string' ? pendingInteraction.nodeId : '',
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
 * @param {Record<string, any>} value
 * @returns {string}
 */
function renderOverview(value) {
  const run = value?.run ?? {}
  const label = Number.isInteger(run.seq) ? `#${run.seq} ` : ''
  const lines = [`workflow ${label}${run.runId ?? ''} — ${run.status ?? 'unknown'}`]
  if (typeof run.goal === 'string' && run.goal !== '') lines.push(`goal: ${run.goal}`)
  if (typeof run.createdAt === 'string' && run.createdAt !== '') lines.push(`created: ${run.createdAt}`)
  if (typeof run.finishedAt === 'string' && run.finishedAt !== '') lines.push(`finished: ${run.finishedAt}`)
  const actives = Array.isArray(run.active) ? run.active : []
  for (const current of actives.length > 0 ? actives : (run.current ? [run.current] : [])) {
    const seq = Number.isInteger(current.seq) ? ` (execution #${current.seq})` : ''
    lines.push(`current: ${current.nodeId}${seq}`)
  }
  if (run.pendingUser !== null && run.pendingUser !== undefined) {
    lines.push(`waiting at user node: ${run.pendingUser.title || run.pendingUser.nodeId}`)
  }
  if (run.pendingInteraction !== null && run.pendingInteraction !== undefined) {
    lines.push(`waiting for user: ${run.pendingInteraction.kind ?? 'interaction'} at ${run.pendingInteraction.nodeId}`)
  }
  if (typeof run.error === 'string' && run.error !== '') lines.push(`error: ${run.error}`)

  const nodes = Array.isArray(value?.nodes) ? value.nodes : []
  lines.push('nodes:')
  if (nodes.length === 0) lines.push('- (none)')
  for (const node of nodes) {
    const state = node.state === 'idle' ? 'not reached' : node.state
    const markers = []
    if (node.unreachable === true) markers.push('unreachable')
    if (node.visits > 1) markers.push(`×${node.visits}`)
    if (Number.isInteger(node.lastSeq)) markers.push(`last=#${node.lastSeq}`)
    const robot = node.robot === null || node.robot === undefined ? '' : ` ${node.robot}`
    const summary = node.summary === null || node.summary === undefined || node.summary === '' ? '' : ` — ${node.summary}`
    lines.push(
      `- ${node.id} [${node.type ?? 'unknown'}${robot}] ${state}${markers.length > 0 ? ` ${markers.join(' ')}` : ''}${summary}`,
    )
  }

  const edges = Array.isArray(value?.edges) ? value.edges : []
  lines.push('edges:')
  if (edges.length === 0) lines.push('- (none)')
  for (const edge of edges) {
    const nameText = edge.names.length > 0 ? ` ${edge.names.join(' / ')}` : ''
    const markers = []
    if (edge.loop === true) markers.push('loop')
    if (edge.traversed === true) markers.push(`×${edge.traversals}`)
    lines.push(
      `- ${edge.from} -> ${edge.to} [${edge.kind}${nameText}]${markers.length > 0 ? ` ${markers.join(' ')}` : ''}`,
    )
  }

  const executions = Array.isArray(value?.executions) ? value.executions : []
  lines.push('executions:')
  if (executions.length === 0) lines.push('- (none)')
  for (const execution of executions) {
    const robot = execution.robot === null || execution.robot === undefined ? '' : ` ${execution.robot}`
    const route = execution.route === null || execution.route === undefined ? '' : ` route=${execution.route}`
    const time = execution.finishedAt ?? execution.startedAt
    const stamp = typeof time === 'string' && time !== '' ? ` ${time}` : ''
    const attachments =
      Number.isInteger(execution.attachments) && execution.attachments > 0
        ? ` attachments=${execution.attachments}`
        : ''
    lines.push(
      `- #${execution.seq ?? '?'} ${execution.nodeId} [${execution.type ?? 'unknown'}${robot}] ${execution.status}${route}${attachments}${stamp}`,
    )
  }
  return lines.join('\n')
}

/**
 * 输入工具的展示文本。
 *
 * @param {Record<string, any>} value
 * @returns {string}
 */
function renderExecutionInput(value) {
  const robot = value?.robot === null || value?.robot === undefined ? '' : ` · robot "${value.robot}"`
  const lines = [
    `execution #${value?.seq ?? '?'} · ${value?.type ?? 'unknown'} "${value?.nodeId ?? ''}"${robot} · ${value?.status ?? 'unknown'}`,
    '',
    typeof value?.input === 'string' && value.input !== '' ? value.input : '(empty input)',
  ]
  if (value?.truncated === true) lines.push('', '(input was truncated when it was recorded)')
  return lines.join('\n')
}

/**
 * 输出工具的展示文本。正文优先；正文为空时才展示结构化 JSON，避免重复。
 *
 * @param {Record<string, any>} value
 * @returns {string}
 */
function renderExecutionOutput(value) {
  const robot = value?.robot === null || value?.robot === undefined ? '' : ` · robot "${value.robot}"`
  const stop = typeof value?.stopReason === 'string' && value.stopReason !== '' ? ` (${value.stopReason})` : ''
  const route = typeof value?.route === 'string' && value.route !== '' ? ` route=${value.route}` : ''
  const lines = [
    `execution #${value?.seq ?? '?'} · ${value?.type ?? 'unknown'} "${value?.nodeId ?? ''}"${robot} · ${value?.status ?? 'unknown'}${stop}${route}`,
    '',
  ]
  if (typeof value?.output === 'string' && value.output !== '') {
    lines.push(value.output)
  } else if (value?.structured !== null && value?.structured !== undefined) {
    lines.push(JSON.stringify(value.structured, null, 2))
  } else {
    lines.push('(no output text)')
  }
  if (typeof value?.error === 'string' && value.error !== '') lines.push('', `error: ${value.error}`)
  if (value?.truncated === true) lines.push('', '(output was truncated when it was recorded)')
  const attachments = Array.isArray(value?.attachments) ? value.attachments : []
  if (attachments.length > 0) {
    lines.push('', 'attachments:')
    lines.push(...attachmentLines(attachments))
    lines.push(
      `use buka_workflow_execution_attachment with seq=${value?.seq ?? '?'} and name to read one; binary/large files stay on disk`,
    )
  }
  return lines.join('\n')
}


/**
 * 附件工具的展示文本：列表或单文件内容。
 *
 * @param {Record<string, any>} value
 * @returns {string}
 */
function renderExecutionAttachment(value) {
  const robot = value?.robot === null || value?.robot === undefined ? '' : ` · robot "${value.robot}"`
  const lines = [
    `execution #${value?.seq ?? '?'} · ${value?.type ?? 'unknown'} "${value?.nodeId ?? ''}"${robot} · ${value?.status ?? 'unknown'}`,
    '',
  ]
  const attachment = value?.attachment
  if (attachment === null || attachment === undefined) {
    const attachments = Array.isArray(value?.attachments) ? value.attachments : []
    if (attachments.length === 0) {
      lines.push('(no attachments)')
    } else {
      lines.push('attachments:')
      lines.push(...attachmentLines(attachments))
      lines.push('')
      lines.push('pass name to read one attachment')
    }
    return lines.join('\n')
  }
  const description =
    typeof attachment.description === 'string' && attachment.description !== ''
      ? ` — ${attachment.description}`
      : ''
  lines.push(`attachment #${attachment.index ?? '?'} ${attachment.name ?? ''} (${formatBytes(attachment.bytes)})${description}`)
  if (typeof attachment.path === 'string' && attachment.path !== '') lines.push(`path: ${attachment.path}`)
  lines.push('')
  if (attachment.binary === true) {
    lines.push('(binary file; read it from the path instead of embedding it in a prompt)')
  } else if (typeof attachment.text === 'string' && attachment.text !== '') {
    lines.push(attachment.text)
  } else {
    lines.push('(empty text)')
  }
  if (attachment.truncated === true) {
    const next = (Number.isInteger(attachment.offset) ? attachment.offset : 0) +
      (Number.isInteger(attachment.read) ? attachment.read : 0)
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
 * @param {{
 *   ensureIndex: () => Promise<void>,
 *   resolveSession: (sessionId: string) => { runId: string } | null | undefined,
 * }} input
 * @returns {(context: { agent?: { id?: string }, signal?: AbortSignal }) => Promise<boolean>}
 */
export function createSessionToolVisibility({ ensureIndex, resolveSession } = {}) {
  if (typeof ensureIndex !== 'function') throw new TypeError('createSessionToolVisibility: ensureIndex is required')
  if (typeof resolveSession !== 'function') {
    throw new TypeError('createSessionToolVisibility: resolveSession is required')
  }
  return async (context) => {
    if (context?.signal?.aborted === true) return false
    try {
      await ensureIndex()
    } catch {
      return false
    }
    if (context?.signal?.aborted === true) return false
    const binding = resolveSession(context?.agent?.id)
    return binding !== null && binding !== undefined
  }
}

/**
 * 创建四个只读工具。
 *
 * @param {{
 *   defineTool: Function,
 *   store: {
 *     readRun: (runId: string) => Promise<Record<string, any> | null>,
 *     readDefinition: (runId: string) => Promise<Record<string, any> | null>,
 *     readNodeResult: (runId: string, seq: number, nodeId: string) => Promise<Record<string, any> | null>,
 *     readAttachment: (runId: string, seq: number, nodeId: string, name: string, options?: { offset?: number, maxBytes?: number }) => Promise<Record<string, any> | null>,
 *   },
 *   resolveSession: (sessionId: string) => { runId: string } | null | undefined,
 * }} input
 * @returns {Array<Record<string, any>>}
 */
export function createWorkflowSessionTools({ defineTool, store, resolveSession } = {}) {
  if (typeof defineTool !== 'function') throw new TypeError('createWorkflowSessionTools: defineTool is required')
  if (store === null || typeof store !== 'object') throw new TypeError('createWorkflowSessionTools: store is required')
  if (typeof resolveSession !== 'function') {
    throw new TypeError('createWorkflowSessionTools: resolveSession is required')
  }

  /**
   * 从调用者会话反查运行；解析不到时说明这些工具只属于工作流机器人会话。
   *
   * @param {any} exec
   * @returns {string}
   */
  function runIdOf(exec) {
    const sessionId = typeof exec?.agent?.id === 'string' ? exec.agent.id : ''
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
    defineTool({
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
            nodes: { type: 'json', required: true, description: 'Workflow nodes with state and summary.' },
            edges: { type: 'json', required: true, description: 'Workflow edges without prompts.' },
            executions: { type: 'json', required: true, description: 'Executions in sequence order.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderOverview(value) }],
      },
      async execute(_args, exec) {
        const runId = runIdOf(exec)
        const run = await readRunOrThrow(store, runId)
        const definition = await store.readDefinition(runId)
        return overviewValue(run, definition)
      },
    }),

    defineTool({
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
        render: (_args, value) => [{ type: 'text', text: renderExecutionInput(value) }],
      },
      async execute(args, exec) {
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
          const node = definitionNode(definition, step.nodeId)
          const pending = found.running && run.pendingUser?.nodeId === step.nodeId ? run.pendingUser : null
          const title = pending?.title ?? (typeof node?.title === 'string' ? node.title : '')
          const detail =
            typeof pending?.detail === 'string' && pending.detail !== ''
              ? pending.detail
              : typeof step.input === 'string' && step.input !== ''
                ? step.input
                : typeof node?.detail === 'string'
                  ? node.detail
                  : ''
          const options = Array.isArray(pending?.options)
            ? pending.options
            : Array.isArray(node?.next)
              ? node.next
              : []
          const optionLines = options
            .filter((option) => option !== null && typeof option === 'object' && typeof option.label === 'string')
            .map(
              (option) =>
                `- ${option.label}${typeof option.description === 'string' && option.description !== '' ? `: ${option.description}` : ''}`,
            )
          const parts = [title, detail]
          if (optionLines.length > 0) parts.push(`choices:\n${optionLines.join('\n')}`)
          return {
            seq,
            nodeId: typeof step.nodeId === 'string' ? step.nodeId : '',
            visit: Number.isInteger(step.visit) ? step.visit : null,
            type: 'user',
            robot: null,
            status: found.running ? 'waiting' : typeof step.status === 'string' ? step.status : 'unknown',
            input: parts.filter((part) => typeof part === 'string' && part !== '').join('\n'),
            truncated: false,
          }
        }
        const result = await store.readNodeResult(runId, seq, step.nodeId)
        let input = typeof result?.prompt === 'string' ? result.prompt : ''
        const runningActive = found.running ? activesOf(run).find((item) => item.seq === seq) : undefined
        if (input === '' && runningActive !== undefined && typeof runningActive.prompt === 'string') {
          input = runningActive.prompt
        }
        if (input === '') {
          throw new Error(`execution #${seq} (node "${step.nodeId}") has no recorded input in workflow run "${runId}"`)
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

    defineTool({
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
              description: 'Attachment manifest for this execution; use buka_workflow_execution_attachment to read one.',
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
        render: (_args, value) => [{ type: 'text', text: renderExecutionOutput(value) }],
      },
      async execute(args, exec) {
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
              routeTo: typeof step.routeTo === 'string' && step.routeTo !== '' ? step.routeTo : null,
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
          throw new Error(`execution #${seq} (node "${step.nodeId}") is still running and has no output yet`)
        }
        const result = await store.readNodeResult(runId, seq, step.nodeId)
        if (result === null) {
          throw new Error(`execution #${seq} (node "${step.nodeId}") has no recorded output in workflow run "${runId}"`)
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

    defineTool({
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
        render: (_args, value) => [{ type: 'text', text: renderExecutionAttachment(value) }],
      },
      async execute(args, exec) {
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
          throw new Error(`execution #${seq} (node "${step.nodeId}") is still running and has no attachments yet`)
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
            status: found.running ? 'waiting' : typeof step.status === 'string' ? step.status : 'unknown',
            attachments: [],
            attachment: null,
          }
        }
        const result = await store.readNodeResult(runId, seq, step.nodeId)
        if (result === null) {
          throw new Error(`execution #${seq} (node "${step.nodeId}") has no recorded output in workflow run "${runId}"`)
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
        if (args?.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) {
          throw new Error('offset must be a non-negative integer')
        }
        if (args?.maxBytes !== undefined && (!Number.isInteger(args.maxBytes) || args.maxBytes <= 0)) {
          throw new Error('maxBytes must be a positive integer')
        }
        const maxBytes = Number.isInteger(args?.maxBytes)
          ? Math.min(args.maxBytes, MAX_ATTACHMENT_READ_BYTES)
          : DEFAULT_ATTACHMENT_READ_BYTES
        const attachment = await store.readAttachment(runId, seq, step.nodeId, name, {
          offset: Number.isInteger(args?.offset) ? args.offset : 0,
          maxBytes,
        })
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
