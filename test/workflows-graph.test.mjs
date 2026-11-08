/**
 * @buka/dsh-plugin-workflows 图模型的单测。
 *
 * 覆盖：节点状态、连线分类与「是否走过」、门禁分支、缺定义快照时的兜底链、
 * 分层坐标与回边 / 自环路径。全部是纯函数，不读盘、不启动 DSH。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { validateDefinition } from '../plugins/workflows/lib/definition.js'
import {
  LANE_GAP,
  RAIL_BASE,
  RAIL_PAD,
  ROW_GAP,
  ROW_HEIGHT,
  buildRunGraph,
  layoutRunGraph,
} from '../plugins/workflows/lib/graph.js'

/**
 * 校验一份定义，返回可以直接喂给图模型的定义快照。
 *
 * @param {Record<string, any>} raw
 * @returns {{ plan: Record<string, any>, definition: Record<string, any> }}
 */
function snapshot(raw) {
  const parsed = validateDefinition(raw)
  assert.equal(parsed.ok, true, `definition should be valid: ${JSON.stringify(parsed.errors)}`)
  return { plan: parsed.plan, definition: raw }
}

/**
 * 找一条边。
 *
 * @param {Array<Record<string, any>>} edges
 * @param {string} from
 * @param {string} to
 * @returns {Record<string, any>}
 */
function edgeOf(edges, from, to) {
  const edge = edges.find((item) => item.from === from && item.to === to)
  assert.ok(edge, `expected an edge ${from} -> ${to}`)
  return edge
}

test('graph: linear run marks the reached end node and the traversed edge', () => {
  const definition = snapshot({
    goal: 'linear',
    start: 'work',
    nodes: [
      { id: 'work', type: 'robot', robot: 'writer', summary: '写一份草稿', prompt: 'do it', next: 'end' },
      { id: 'end', type: 'end', status: 'completed' },
    ],
  })
  const run = {
    runId: 'wf-test-linear',
    status: 'completed',
    current: null,
    pendingGate: null,
    steps: [
      {
        seq: 1,
        nodeId: 'work',
        type: 'robot',
        robot: 'writer',
        status: 'completed',
        stopReason: 'completed',
        startedAt: 100,
        finishedAt: 1100,
        sessionId: 'session-1',
        text: 'DONE',
        data: { status: 'ok' },
      },
    ],
    result: { status: 'completed', lastNode: 'end' },
  }

  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  assert.equal(graph.start, 'work')
  assert.deepEqual(graph.order, ['work', 'end'])

  const work = graph.nodes.find((node) => node.id === 'work')
  assert.equal(work.state, 'completed')
  assert.equal(work.visits, 1)
  assert.equal(work.durationMs, 1000)
  assert.equal(work.sessionId, 'session-1')
  assert.equal(work.robot, 'writer')
  assert.equal(work.task, 'do it')
  assert.equal(work.summary, '写一份草稿')
  assert.equal(work.outputText, 'DONE')

  const end = graph.nodes.find((node) => node.id === 'end')
  assert.equal(end.state, 'completed')

  const edge = edgeOf(graph.edges, 'work', 'end')
  assert.equal(edge.kind, 'next')
  assert.equal(edge.traversed, true)

  const layout = layoutRunGraph(graph)
  assert.equal(layout.rowHeight, ROW_HEIGHT)
  assert.equal(layout.rowGap, ROW_GAP)
  assert.equal(layout.width, RAIL_BASE + RAIL_PAD)
  assert.equal(layout.height, 2 * ROW_HEIGHT + ROW_GAP)
  assert.deepEqual(layout.rows, [
    { id: 'work', index: 0, y: ROW_HEIGHT / 2 },
    { id: 'end', index: 1, y: ROW_HEIGHT + ROW_GAP + ROW_HEIGHT / 2 },
  ])
  const edgeLayout = layout.edges[0]
  assert.equal(edgeLayout.lane, 0, 'adjacent downward edges stay on the rail')
  assert.equal(
    edgeLayout.d,
    `M${RAIL_BASE},${ROW_HEIGHT / 2} L${RAIL_BASE},${ROW_HEIGHT + ROW_GAP + ROW_HEIGHT / 2}`,
  )
  assert.equal(layout.dotX, RAIL_BASE, 'without loop lanes the rail keeps its base x')
  const rowOf = new Map(layout.rows.map((row) => [row.id, row]))
  assert.deepEqual(edgeLayout.arrow, {
    x: RAIL_BASE,
    y: (rowOf.get('work').y + rowOf.get('end').y) / 2,
    angle: 90,
  })
})

test('graph: robot nodes carry the avatar from the robots avatar map', () => {
  const definition = snapshot({
    goal: 'avatars',
    start: 'work',
    nodes: [
      { id: 'work', type: 'robot', robot: 'writer', summary: '写一份草稿', prompt: 'do it', next: 'review' },
      { id: 'review', type: 'robot', robot: 'reviewer', prompt: 'review it', next: 'end' },
      { id: 'end', type: 'end', status: 'completed' },
    ],
  })
  const run = {
    runId: 'wf-test-avatars',
    status: 'running',
    current: { nodeId: 'review' },
    pendingGate: null,
    steps: [
      {
        seq: 1,
        nodeId: 'work',
        type: 'robot',
        robot: 'writer',
        status: 'completed',
        stopReason: 'completed',
        startedAt: 1,
        finishedAt: 2,
      },
    ],
    result: null,
  }

  // 有头像表：robot 节点带 id；门禁 / 终止节点没有；表里没有的机器人也是 null。
  const graph = buildRunGraph({ run, definition, avatars: { writer: 'panda', reviewer: 42 } })
  assert.ok(graph)
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('work').avatar, 'panda')
  assert.equal(byId.get('review').avatar, null, 'non-string avatar values are ignored')
  assert.equal(byId.get('end').avatar, null)
  assert.equal('avatar' in byId.get('end'), true, 'the field is stable for every node')

  // 没有头像表（robots 插件没装 / 运行记录引用已删除的机器人）：全部是 null。
  const bare = buildRunGraph({ run, definition })
  assert.ok(bare)
  for (const node of bare.nodes) assert.equal(node.avatar, null)
})

test('graph: conditional routing highlights only the taken branch', () => {
  const definition = snapshot({
    start: 'work',
    nodes: [
      {
        id: 'work',
        type: 'robot',
        robot: 'writer',
        prompt: 'route me',
        report: true,
        next: [
          { when: { field: 'status', equals: 'ok' }, to: 'ok_end' },
          { to: 'bad_end' },
        ],
      },
      { id: 'ok_end', type: 'end', status: 'completed' },
      { id: 'bad_end', type: 'end', status: 'failed' },
    ],
  })
  const run = {
    runId: 'wf-test-branch',
    status: 'completed',
    current: null,
    pendingGate: null,
    steps: [{ seq: 1, nodeId: 'work', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2 }],
    result: { status: 'completed', lastNode: 'ok_end' },
  }

  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  assert.equal(edgeOf(graph.edges, 'work', 'ok_end').traversed, true)
  assert.equal(edgeOf(graph.edges, 'work', 'bad_end').traversed, false)
  assert.deepEqual(edgeOf(graph.edges, 'work', 'ok_end').when, { field: 'status', equals: 'ok' })
  assert.equal(edgeOf(graph.edges, 'work', 'bad_end').when, null)

  assert.equal(graph.nodes.find((node) => node.id === 'ok_end').state, 'completed')
  assert.equal(graph.nodes.find((node) => node.id === 'bad_end').state, 'idle')

  const layout = layoutRunGraph(graph)
  // 同一行顺序：work、ok_end、bad_end；跨行的分支边绕到右侧 lane。
  const rowOf = new Map(layout.rows.map((row) => [row.id, row]))
  assert.equal(rowOf.get('work').index, 0)
  assert.equal(rowOf.get('ok_end').index, 1)
  assert.equal(rowOf.get('bad_end').index, 2)
  assert.equal(rowOf.get('bad_end').y, 2 * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2)
  assert.equal(edgeOf(layout.edges, 'work', 'ok_end').lane, 0)
  assert.equal(edgeOf(layout.edges, 'work', 'bad_end').lane, 1)
  assert.equal(layout.width, RAIL_BASE + LANE_GAP + RAIL_PAD)
})

test('graph: a rejected gate without targets ends the run at the gate', () => {
  const definition = snapshot({
    start: 'gate',
    nodes: [{ id: 'gate', type: 'gate', title: '确认', detail: '是否继续？' }],
  })
  const run = {
    runId: 'wf-test-gate-reject',
    status: 'rejected',
    current: null,
    pendingGate: null,
    steps: [
      {
        seq: 1,
        nodeId: 'gate',
        type: 'gate',
        status: 'rejected',
        decision: 'rejected',
        startedAt: 1,
        finishedAt: 2,
      },
    ],
    result: { status: 'rejected', lastNode: 'gate' },
  }

  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  assert.equal(graph.edges.length, 0)
  const gate = graph.nodes.find((node) => node.id === 'gate')
  assert.equal(gate.state, 'rejected')
  assert.equal(gate.decision, 'rejected')
  assert.equal(layoutRunGraph(graph).height, ROW_HEIGHT)
})

test('graph: gate branches are classified and the approved path is traversed', () => {
  const definition = snapshot({
    start: 'gate',
    nodes: [
      { id: 'gate', type: 'gate', title: '确认', onApprove: 'approve_path', onReject: 'reject_path' },
      { id: 'approve_path', type: 'robot', robot: 'publisher', prompt: 'publish', next: 'done' },
      { id: 'reject_path', type: 'robot', robot: 'writer', prompt: 'revise', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  const run = {
    runId: 'wf-test-gate-approve',
    status: 'completed',
    current: null,
    pendingGate: null,
    steps: [
      { seq: 1, nodeId: 'gate', type: 'gate', status: 'approved', decision: 'approved', startedAt: 1, finishedAt: 2 },
      {
        seq: 2,
        nodeId: 'approve_path',
        type: 'robot',
        status: 'completed',
        startedAt: 3,
        finishedAt: 4,
        sessionId: 'session-2',
      },
    ],
    result: { status: 'completed', lastNode: 'done' },
  }

  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  assert.equal(edgeOf(graph.edges, 'gate', 'approve_path').kind, 'approve')
  assert.equal(edgeOf(graph.edges, 'gate', 'approve_path').traversed, true)
  assert.equal(edgeOf(graph.edges, 'gate', 'reject_path').kind, 'reject')
  assert.equal(edgeOf(graph.edges, 'gate', 'reject_path').traversed, false)
  assert.equal(edgeOf(graph.edges, 'approve_path', 'done').traversed, true)
  assert.equal(edgeOf(graph.edges, 'reject_path', 'done').traversed, false)

  assert.equal(graph.nodes.find((node) => node.id === 'gate').state, 'approved')
  assert.equal(graph.nodes.find((node) => node.id === 'reject_path').state, 'idle')
  assert.equal(graph.nodes.find((node) => node.id === 'done').state, 'completed')

  // 拓扑行序保持定义顺序：gate、approve_path、reject_path、done。
  const layout = layoutRunGraph(graph)
  const rowOf = new Map(layout.rows.map((row) => [row.id, row]))
  assert.equal(rowOf.get('reject_path').index, 2)
  assert.equal(rowOf.get('done').index, 3)
  assert.equal(rowOf.get('done').y, 3 * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2)
  // 相邻边留在主干；两条跨两行的边各自占一条 lane。
  assert.equal(edgeOf(layout.edges, 'gate', 'approve_path').lane, 0)
  assert.equal(edgeOf(layout.edges, 'reject_path', 'done').lane, 0)
  assert.equal(edgeOf(layout.edges, 'gate', 'reject_path').lane, 1)
  assert.equal(edgeOf(layout.edges, 'approve_path', 'done').lane, 2)
  assert.equal(layout.width, RAIL_BASE + 2 * LANE_GAP + RAIL_PAD)
})

test('graph: the running node and the waiting gate carry live state', () => {
  const definition = snapshot({
    start: 'a',
    nodes: [
      { id: 'a', type: 'robot', robot: 'r1', prompt: 'a', next: 'b' },
      { id: 'b', type: 'robot', robot: 'r2', prompt: 'b', next: 'gate' },
      { id: 'gate', type: 'gate', title: '确认' },
    ],
  })

  const running = buildRunGraph({
    run: {
      runId: 'wf-test-running',
      status: 'running',
      current: { nodeId: 'b', visit: 1, type: 'robot' },
      pendingGate: null,
      steps: [{ seq: 1, nodeId: 'a', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2 }],
      result: null,
    },
    definition,
  })
  assert.ok(running)
  assert.equal(running.nodes.find((node) => node.id === 'a').state, 'completed')
  assert.equal(running.nodes.find((node) => node.id === 'b').state, 'running')
  assert.equal(edgeOf(running.edges, 'a', 'b').traversed, true)

  const waiting = buildRunGraph({
    run: {
      runId: 'wf-test-waiting',
      status: 'waiting',
      current: { nodeId: 'gate', visit: 1, type: 'gate' },
      pendingGate: { nodeId: 'gate', title: '确认' },
      steps: [
        { seq: 1, nodeId: 'a', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2 },
        { seq: 2, nodeId: 'b', type: 'robot', status: 'completed', startedAt: 3, finishedAt: 4 },
      ],
      result: null,
    },
    definition,
  })
  assert.ok(waiting)
  assert.equal(waiting.nodes.find((node) => node.id === 'gate').state, 'waiting')
  assert.equal(edgeOf(waiting.edges, 'b', 'gate').traversed, true)
})

test('graph: without a definition snapshot the steps become a linear chain', () => {
  const graph = buildRunGraph({
    run: {
      runId: 'wf-test-synthetic',
      status: 'completed',
      current: null,
      pendingGate: null,
      steps: [
        { seq: 1, nodeId: 'first', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2 },
        { seq: 2, nodeId: 'second', type: 'robot', status: 'completed', startedAt: 3, finishedAt: 4 },
      ],
      result: { status: 'completed', lastNode: 'second' },
    },
    definition: null,
  })
  assert.ok(graph)
  assert.equal(graph.start, 'first')
  assert.deepEqual(graph.order, ['first', 'second'])
  assert.equal(graph.edges.length, 1)
  assert.equal(edgeOf(graph.edges, 'first', 'second').kind, 'next')
  assert.equal(edgeOf(graph.edges, 'first', 'second').traversed, true)
  assert.equal(graph.nodes.find((node) => node.id === 'first').state, 'completed')
})

test('graph: an old record with an unreachable node keeps it on its own row and flags it', () => {
  // 新定义会在校验阶段拒绝不可达节点；这里手工构造定义快照，模拟修复前落盘的旧记录。
  const raw = {
    start: 'a',
    nodes: [
      { id: 'a', type: 'robot', robot: 'r', prompt: 'a', next: 'b' },
      { id: 'b', type: 'robot', robot: 'r', prompt: 'b' },
      { id: 'orphan', type: 'robot', robot: 'r', prompt: 'unused' },
    ],
  }
  const definition = {
    plan: {
      goal: '',
      start: raw.start,
      maxSteps: 8,
      nodes: Object.fromEntries(raw.nodes.map((node) => [node.id, node])),
      order: raw.nodes.map((node) => node.id),
    },
    definition: raw,
  }
  const graph = buildRunGraph({
    run: {
      runId: 'wf-test-orphan',
      status: 'completed',
      current: null,
      pendingGate: null,
      steps: [],
      result: null,
    },
    definition,
  })
  assert.ok(graph)
  const orphan = graph.nodes.find((node) => node.id === 'orphan')
  assert.equal(orphan.unreachable, true, 'nothing leads to the orphan, so it can never run')
  assert.equal(graph.nodes.find((node) => node.id === 'a').unreachable, false)
  assert.equal(graph.nodes.find((node) => node.id === 'b').unreachable, false)
  const layout = layoutRunGraph(graph)
  const rowOf = new Map(layout.rows.map((row) => [row.id, row]))
  assert.equal(rowOf.get('orphan').index, 2)
  assert.equal(rowOf.get('orphan').y, 2 * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2)
})

test('graph: backward edges and self loops are routed to the side', () => {
  const definition = snapshot({
    start: 'a',
    nodes: [
      { id: 'a', type: 'robot', robot: 'r', prompt: 'a', next: [{ to: 'b' }] },
      { id: 'b', type: 'robot', robot: 'r', prompt: 'b', next: [{ to: 'a' }, { to: 'loop' }] },
      { id: 'loop', type: 'robot', robot: 'r', prompt: 'loop', next: [{ to: 'loop' }] },
    ],
  })
  const graph = buildRunGraph({
    run: {
      runId: 'wf-test-back',
      status: 'cancelled',
      current: null,
      pendingGate: null,
      steps: [
        { seq: 1, nodeId: 'a', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2 },
        { seq: 2, nodeId: 'b', type: 'robot', status: 'completed', startedAt: 3, finishedAt: 4 },
      ],
      result: { status: 'cancelled', lastNode: 'b' },
    },
    definition,
  })
  assert.ok(graph)
  const layout = layoutRunGraph(graph)
  const backward = edgeOf(layout.edges, 'b', 'a')
  assert.match(backward.d, /^M.*C/u, 'back edges turn into a side lane')
  assert.equal(backward.lane, 1)
  assert.equal(backward.arrow.angle, -90, 'the arrow points back up')
  const selfLoop = layout.edges.find((edge) => edge.from === 'loop' && edge.to === 'loop')
  assert.ok(selfLoop)
  assert.match(selfLoop.d, /^M.*C/u)
  assert.equal(selfLoop.lane, 1)
  // 绕行线还在轨道右侧，主干仍从 RAIL_BASE 开始。
  assert.equal(layout.dotX, RAIL_BASE)
  assert.equal(layout.width, RAIL_BASE + LANE_GAP + RAIL_PAD)
})

test('graph: a loop run counts revisits and marks the back edge', () => {
  const definition = snapshot({
    goal: '反复检查直到通过',
    start: 'check',
    maxSteps: 12,
    nodes: [
      {
        id: 'check',
        type: 'robot',
        robot: 'reviewer',
        prompt: '检查当前稿',
        report: true,
        maxVisits: 5,
        next: [
          { when: { field: 'ok', equals: true }, to: 'done' },
          // 一条不会命中的条件出口：skip 是可达分支，只是这次没走到。
          { when: { field: 'ok', equals: 'audit' }, to: 'skip' },
          { to: 'fix' },
        ],
      },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修复问题', next: 'check' },
      { id: 'skip', type: 'robot', robot: 'auditor', prompt: '补充审计', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  /**
   * @param {number} seq
   * @param {string} nodeId
   * @param {number} visit
   * @param {Record<string, any>} [data]
   * @returns {Record<string, any>}
   */
  function step(seq, nodeId, visit, data = {}) {
    return {
      seq,
      nodeId,
      visit,
      type: 'robot',
      status: 'completed',
      stopReason: 'completed',
      startedAt: seq * 10,
      finishedAt: seq * 10 + 5,
      sessionId: `session-${seq}`,
      text: `${nodeId} #${visit}`,
      data,
    }
  }
  const run = {
    runId: 'wf-test-loop',
    status: 'completed',
    current: null,
    pendingGate: null,
    steps: [
      step(1, 'check', 1, { ok: false }),
      step(2, 'fix', 1),
      step(3, 'check', 2, { ok: false }),
      step(4, 'fix', 2),
      step(5, 'check', 3, { ok: true }),
    ],
    result: { status: 'completed', lastNode: 'done' },
  }

  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  const check = graph.nodes.find((node) => node.id === 'check')
  const fix = graph.nodes.find((node) => node.id === 'fix')
  const skip = graph.nodes.find((node) => node.id === 'skip')
  const done = graph.nodes.find((node) => node.id === 'done')
  assert.equal(check.visits, 3)
  assert.equal(check.state, 'completed')
  assert.equal(check.lastSeq, 5)
  assert.equal(fix.visits, 2)
  assert.equal(skip.visits, 0)
  assert.equal(skip.state, 'idle', 'the branch that was never taken stays idle')
  assert.equal(done.state, 'completed')

  const intoFix = edgeOf(graph.edges, 'check', 'fix')
  assert.equal(intoFix.traversals, 2)
  assert.equal(intoFix.loop, true, 'the forward edge of a cycle is still a cycle edge')
  const back = edgeOf(graph.edges, 'fix', 'check')
  assert.equal(back.traversals, 2)
  assert.equal(back.traversed, true)
  assert.equal(back.loop, true)
  const toDone = edgeOf(graph.edges, 'check', 'done')
  assert.equal(toDone.rules, 1)
  assert.equal(toDone.traversals, 1)
  const untouched = edgeOf(graph.edges, 'skip', 'done')
  assert.equal(untouched.traversals, 0)
  assert.equal(untouched.traversed, false)

  const layout = layoutRunGraph(graph)
  const rowOf = new Map(layout.rows.map((row) => [row.id, row]))
  // 拓扑行序：check、fix、skip、done——没走到的 skip 仍在 done 上方，不会误导。
  assert.equal(rowOf.get('check').index, 0)
  assert.equal(rowOf.get('fix').index, 1)
  assert.equal(rowOf.get('skip').index, 2)
  assert.equal(rowOf.get('done').index, 3)
  const backEdge = edgeOf(layout.edges, 'fix', 'check')
  assert.equal(backEdge.lane, 1, 'the one-row loop uses the inner lane')
  assert.equal(backEdge.arrow.angle, -90, 'the back edge points back up')
  // 循环不再画图标：回边 + 正向边的两个箭头围成环即可。
  assert.equal('glyph' in backEdge, false)
  const intoDone = edgeOf(layout.edges, 'check', 'done')
  assert.equal(intoDone.lane, 3, 'the widest branch is pushed to the outermost lane')
  const intoSkip = edgeOf(layout.edges, 'check', 'skip')
  assert.equal(intoSkip.lane, 2, 'the untaken branch sits between the loop and the end branch')
  assert.ok(backEdge.lane < intoDone.lane, 'the nested loop stays inside the branch lane')
  const skippedEdge = edgeOf(layout.edges, 'skip', 'done')
  assert.equal(skippedEdge.loop, false, 'an untaken branch is not a cycle edge')
  assert.equal(skippedEdge.arrow.angle, 90, 'a plain branch edge still points downward')
  assert.equal(layout.dotX, RAIL_BASE)
  assert.equal(layout.width, RAIL_BASE + 3 * LANE_GAP + RAIL_PAD)
  assert.ok(backEdge.d.endsWith(`,${rowOf.get('check').y}`), 'the back edge ends on the check dot')
  assertNoCrossings(layout)
})

test('graph: rules pointing at the same target merge into one drawn edge', () => {
  const definition = snapshot({
    start: 'check',
    nodes: [
      {
        id: 'check',
        type: 'robot',
        robot: 'reviewer',
        prompt: '检查',
        report: true,
        next: [
          { when: { field: 'ok', equals: true }, to: 'done' },
          { when: { field: 'step', equals: 5 }, to: 'done' },
          { to: 'fix' },
        ],
      },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修复', next: 'check' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  const graph = buildRunGraph({
    run: {
      runId: 'wf-test-merge',
      status: 'completed',
      current: null,
      pendingGate: null,
      steps: [
        { seq: 1, nodeId: 'check', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2, data: { ok: true } },
      ],
      result: { status: 'completed', lastNode: 'done' },
    },
    definition,
  })
  assert.ok(graph)
  const toDone = edgeOf(graph.edges, 'check', 'done')
  assert.equal(toDone.rules, 2, 'two rules with the same target become one edge')
  assert.deepEqual(toDone.whens, [
    { field: 'ok', equals: true },
    { field: 'step', equals: 5 },
  ])
  assert.equal(toDone.hasDefault, false)
  const toFix = edgeOf(graph.edges, 'check', 'fix')
  assert.equal(toFix.rules, 1)
  assert.equal(toFix.hasDefault, true, 'the rule without a condition is the default branch')
  assert.equal(graph.edges.filter((edge) => edge.from === 'check').length, 2, 'one line per target')
})


/**
 * 把一条 layout 边采样成折线（支持 M / L / C 三种路径命令）。
 *
 * @param {Record<string, any>} edge
 * @returns {Array<{ x: number, y: number }>}
 */
function sampleEdge(edge) {
  const tokens = [...edge.d.matchAll(/([MLC])([^MLC]*)/gu)]
  assert.ok(tokens.length > 0, `unexpected edge path: ${edge.d}`)
  const points = []
  let current = null
  for (const token of tokens) {
    const numbers = token[2]
      .trim()
      .split(/[\s,]+/u)
      .filter((value) => value !== '')
      .map(Number)
    if (token[1] === 'M') {
      current = { x: numbers[0], y: numbers[1] }
      points.push(current)
      continue
    }
    if (token[1] === 'L') {
      current = { x: numbers[0], y: numbers[1] }
      points.push(current)
      continue
    }
    const start = current
    const c1 = { x: numbers[0], y: numbers[1] }
    const c2 = { x: numbers[2], y: numbers[3] }
    const end = { x: numbers[4], y: numbers[5] }
    const steps = 16
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps
      const u = 1 - t
      points.push({
        x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
        y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
      })
    }
    current = end
  }
  return points
}

/**
 * 两段线段是否相交；平行、共线的一律忽略。
 *
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @param {{x:number,y:number}} c
 * @param {{x:number,y:number}} d
 * @returns {{x:number,y:number} | null}
 */
function segmentIntersection(a, b, c, d) {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
  if (Math.abs(denominator) < 1e-9) return null
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

/**
 * 断言整张图里没有落在节点圆点之外的交叉。
 *
 * @param {ReturnType<typeof layoutRunGraph>} layout
 * @returns {void}
 */
function assertNoCrossings(layout) {
  const lines = layout.edges.map((edge) => sampleEdge(edge))
  const dots = layout.rows.map((row) => ({ x: layout.dotX, y: row.y }))
  for (let left = 0; left < lines.length; left += 1) {
    for (let right = left + 1; right < lines.length; right += 1) {
      for (let i = 0; i + 1 < lines[left].length; i += 1) {
        for (let j = 0; j + 1 < lines[right].length; j += 1) {
          const hit = segmentIntersection(lines[left][i], lines[left][i + 1], lines[right][j], lines[right][j + 1])
          if (hit === null) continue
          // 连线允许在节点圆点处汇合，只禁止圆点之外交叉。
          const atDot = dots.some((dot) => Math.hypot(dot.x - hit.x, dot.y - hit.y) < 8)
          assert.ok(
            atDot,
            `edges ${layout.edges[left].from}->${layout.edges[left].to} and ` +
              `${layout.edges[right].from}->${layout.edges[right].to} cross at ${JSON.stringify(hit)}`,
          )
        }
      }
    }
  }
}

test('graph: nested arcs never cross on a loop run', () => {
  const definition = snapshot({
    goal: '反复检查直到通过',
    start: 'check',
    nodes: [
      {
        id: 'check',
        type: 'robot',
        robot: 'reviewer',
        prompt: '检查',
        report: true,
        next: [
          { when: { field: 'ok', equals: true }, to: 'done' },
          { when: { field: 'step', equals: 9 }, to: 'audit' },
          { to: 'fix' },
        ],
      },
      { id: 'fix', type: 'robot', robot: 'fixer', prompt: '修复', next: 'check' },
      { id: 'audit', type: 'robot', robot: 'auditor', prompt: '审计', next: 'done' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  const graph = buildRunGraph({
    run: {
      runId: 'wf-test-crossing',
      status: 'completed',
      current: null,
      pendingGate: null,
      steps: [
        { seq: 1, nodeId: 'check', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2, data: { ok: false } },
        { seq: 2, nodeId: 'fix', type: 'robot', status: 'completed', startedAt: 3, finishedAt: 4 },
        { seq: 3, nodeId: 'check', type: 'robot', status: 'completed', startedAt: 5, finishedAt: 6, data: { ok: true } },
      ],
      result: { status: 'completed', lastNode: 'done' },
    },
    definition,
  })
  assert.ok(graph)
  assertNoCrossings(layoutRunGraph(graph))
})

test('graph: long output and long prompts are truncated for the card', () => {
  const longText = 'x'.repeat(400)
  const longPrompt = `task ${'y'.repeat(400)}`
  const definition = snapshot({
    start: 'work',
    nodes: [{ id: 'work', type: 'robot', robot: 'r', prompt: longPrompt, next: 'end' }, { id: 'end', type: 'end' }],
  })
  const graph = buildRunGraph({
    run: {
      runId: 'wf-test-truncate',
      status: 'completed',
      current: null,
      pendingGate: null,
      steps: [{ seq: 1, nodeId: 'work', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2, text: longText }],
      result: { status: 'completed', lastNode: 'end' },
    },
    definition,
  })
  assert.ok(graph)
  const work = graph.nodes.find((node) => node.id === 'work')
  assert.equal(work.outputText.length, 160)
  assert.ok(work.outputText.endsWith('…'))
  assert.equal(work.task.length, 160)
  assert.ok(work.task.endsWith('…'))
})

test('graph: an invalid run yields null', () => {
  assert.equal(buildRunGraph({ run: null }), null)
  assert.equal(buildRunGraph(null), null)
})

test('graph: edges carry their names, merging rules to one target', () => {
  const definition = snapshot({
    goal: 'edge names',
    start: 'a',
    nodes: [
      {
        id: 'a',
        type: 'robot',
        robot: 'worker',
        prompt: 'go',
        next: [
          { when: { field: 'x', equals: 1 }, to: 'b', name: '快路径' },
          { when: { field: 'x', equals: 2 }, to: 'b', name: '慢路径' },
          { to: 'c', name: '  ' },
        ],
      },
      { id: 'b', type: 'robot', robot: 'worker', prompt: 'b', next: 'gate' },
      { id: 'c', type: 'robot', robot: 'worker', prompt: 'c', next: 'done' },
      { id: 'gate', type: 'gate', title: '确认', onApprove: 'done', onReject: 'c' },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  const run = {
    runId: 'wf-edge-names',
    status: 'running',
    current: { nodeId: 'b' },
    pendingGate: null,
    steps: [{ seq: 1, nodeId: 'a', type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2 }],
    result: null,
  }
  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  const merged = edgeOf(graph.edges, 'a', 'b')
  assert.deepEqual(merged.names, ['快路径', '慢路径'])
  assert.equal(merged.rules, 2)
  assert.deepEqual(edgeOf(graph.edges, 'a', 'c').names, [], 'blank edge names are dropped')
  // 图模型只保留名字；条件仍是路由数据，不作为「边配置」暴露给悬停。
  assert.deepEqual(edgeOf(graph.edges, 'a', 'b').whens.length, 2)
  for (const edge of graph.edges.filter((item) => item.kind !== 'next')) {
    assert.deepEqual(edge.names, [], 'gate edges have no custom name')
  }
})

test('graph: a start node is a completed marker, not a step', () => {
  const definition = snapshot({
    goal: 'dev/test loop',
    nodes: [
      { id: 'start', type: 'start', next: [{ to: 'dev', name: '开始开发', prompt: '实现导出功能。' }] },
      {
        id: 'dev',
        type: 'robot',
        robot: 'coder',
        summary: '实现导出功能',
        next: [{ to: 'test', name: '开发完成', prompt: '检查开发结果：{{nodes.dev.text}}' }],
      },
      {
        id: 'test',
        type: 'robot',
        robot: 'tester',
        summary: '检查导出实现',
        report: true,
        next: [
          { when: { field: 'passed', equals: false }, to: 'dev', name: '测试打回', prompt: '测试打回：{{nodes.test.text}}' },
          { to: 'done', name: '测试通过' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  })
  const run = {
    runId: 'wf-start-node',
    status: 'completed',
    current: null,
    pendingGate: null,
    steps: [
      { seq: 1, nodeId: 'dev', visit: 1, type: 'robot', status: 'completed', startedAt: 1, finishedAt: 2, text: '初版' },
      { seq: 2, nodeId: 'test', visit: 1, type: 'robot', status: 'completed', startedAt: 3, finishedAt: 4, text: '打回', data: { passed: false } },
      { seq: 3, nodeId: 'dev', visit: 2, type: 'robot', status: 'completed', startedAt: 5, finishedAt: 6, text: '修复' },
      { seq: 4, nodeId: 'test', visit: 2, type: 'robot', status: 'completed', startedAt: 7, finishedAt: 8, text: '通过', data: { passed: true } },
    ],
    result: { status: 'completed', lastNode: 'done' },
  }
  const graph = buildRunGraph({ run, definition })
  assert.ok(graph)
  assert.equal(graph.start, 'start')
  const start = graph.nodes.find((node) => node.id === 'start')
  assert.equal(start.type, 'start')
  assert.equal(start.state, 'completed')
  assert.equal(start.visits, 0, 'start never appears in run.steps')
  const startEdge = edgeOf(graph.edges, 'start', 'dev')
  assert.equal(startEdge.traversed, true, 'the start edge is walked even though start has no step')
  assert.deepEqual(startEdge.names, ['开始开发'])
  assert.deepEqual(edgeOf(graph.edges, 'test', 'dev').names, ['测试打回'])
  const layout = layoutRunGraph(graph)
  assert.equal(layout.rows[0].id, 'start')
  assert.equal(layout.rows.length, 4)
})
