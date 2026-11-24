/**
 * @buka/dsh-plugin-workflows 流程图布局：回向通道与跨层前向通道的走线与防重叠约束。
 *
 * 这里直接跑浏览器侧的 `graph/layout.ts`，不启动 DSH、也不渲染 React：
 * 回向通道固定走右侧、跨层前向通道固定走左侧，向上的线与向下的线不能共用车道；
 * 回向通道必须是水平/垂直线段，线之间不能有共线重叠，也不能穿过别的节点；
 * 跨层前向通道要绕过中间层，不能垂直贯穿中间层的节点。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const { layoutGraph } = await import(
  pathToFileURL(path.resolve('plugins/workflows/src/client/graph/layout.ts')).href
)

/** 节点简写。 */
const position = (id, label) => ({ id, label, kind: 'position', executor: { kind: 'worker' } })

/** 线性流程 + 三条回连：一条贯穿两层、一条相邻层、一条与上面完全错开。 */
const CHAIN = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('qa', '测试'),
    position('accept', '验收'),
    position('build', '构建'),
    position('approve', '审批'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa' },
    { id: 'qa.dev.rework', label: '测试打回', from: 'qa', to: 'dev', back: true },
    { id: 'qa.accept', label: '提验收', from: 'qa', to: 'accept' },
    { id: 'accept.dev.rework', label: '验收打回', from: 'accept', to: 'dev', back: true },
    { id: 'accept.build', label: '验收通过', from: 'accept', to: 'build' },
    { id: 'build.approve', label: '提审', from: 'build', to: 'approve' },
    { id: 'approve.build.rework', label: '重新构建', from: 'approve', to: 'build', back: true },
    { id: 'approve.end', label: '交付', from: 'approve', to: 'end' },
  ],
}

/** 同一层并排两个岗位；回连分别退回左边和右边，走线不能穿过另一个岗位。 */
const WIDE = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('qa', '测试'),
    position('accept', '验收'),
    position('build', '构建'),
    position('approve', '审批'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'start.qa', label: '并行受理', from: 'start', to: 'qa' },
    { id: 'dev.accept', label: '交验收', from: 'dev', to: 'accept' },
    { id: 'qa.accept', label: '测试通过', from: 'qa', to: 'accept' },
    { id: 'accept.build', label: '构建', from: 'accept', to: 'build' },
    { id: 'build.approve', label: '提审', from: 'build', to: 'approve' },
    { id: 'approve.dev.rework', label: '打回复审', from: 'approve', to: 'dev', back: true },
    { id: 'approve.qa.rework', label: '打回测试', from: 'approve', to: 'qa', back: true },
    { id: 'approve.end', label: '交付', from: 'approve', to: 'end' },
  ],
}

/** 同层回连：两个岗位都挂在开始节点后面。 */
const SAME_LAYER = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('qa', '测试'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'start.qa', label: '并行受理', from: 'start', to: 'qa' },
    { id: 'dev.qa.rework', label: '同层打回', from: 'dev', to: 'qa', back: true },
    { id: 'qa.end', label: '交付', from: 'qa', to: 'end' },
  ],
}

/** 主流程里有一节点跳过下一层、直达下下层。 */
const SPAN = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('qa', '测试'),
    position('accept', '验收'),
    position('build', '构建'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa' },
    { id: 'dev.accept', label: '直接验收', from: 'dev', to: 'accept' },
    { id: 'qa.accept', label: '测试通过', from: 'qa', to: 'accept' },
    { id: 'accept.build', label: '构建', from: 'accept', to: 'build' },
    { id: 'build.end', label: '交付', from: 'build', to: 'end' },
  ],
}

/** 跨三层的通道：源与目标之间隔着两行节点。 */
const LONG_SPAN = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('qa', '测试'),
    position('accept', '验收'),
    position('build', '构建'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa' },
    { id: 'qa.accept', label: '提验收', from: 'qa', to: 'accept' },
    { id: 'accept.dev.rework', label: '验收打回', from: 'accept', to: 'dev', back: true },
    { id: 'dev.build', label: '直接构建', from: 'dev', to: 'build' },
    { id: 'accept.build', label: '构建', from: 'accept', to: 'build' },
    { id: 'build.end', label: '交付', from: 'build', to: 'end' },
  ],
}

/** 跨层通道的源节点夹在同排兄弟中间，两侧侧边都被挡住。 */
const BLOCKED = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('triage', '分诊'),
    position('design', '设计'),
    position('dev', '开发'),
    position('ops', '运维'),
    position('qa', '测试'),
    position('accept', '验收'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.triage', label: '提交', from: 'start', to: 'triage' },
    { id: 'triage.design', label: '设计单', from: 'triage', to: 'design' },
    { id: 'triage.dev', label: '开发单', from: 'triage', to: 'dev' },
    { id: 'triage.ops', label: '运维单', from: 'triage', to: 'ops' },
    { id: 'design.qa', label: '设计稿', from: 'design', to: 'qa' },
    { id: 'dev.qa', label: '提测', from: 'dev', to: 'qa' },
    { id: 'ops.qa', label: '部署', from: 'ops', to: 'qa' },
    { id: 'dev.accept', label: '直接验收', from: 'dev', to: 'accept' },
    { id: 'qa.accept', label: '测试通过', from: 'qa', to: 'accept' },
    { id: 'accept.end', label: '交付', from: 'accept', to: 'end' },
  ],
}

/** 回向通道的目标夹在同排兄弟中间，目标那一侧的侧边被挡住。 */
const BACK_BLOCKED = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('design', '设计'),
    position('ops', '运维'),
    position('accept', '验收'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'start.design', label: '并行受理', from: 'start', to: 'design' },
    { id: 'start.ops', label: '并行受理', from: 'start', to: 'ops' },
    { id: 'dev.accept', label: '开发完成', from: 'dev', to: 'accept' },
    { id: 'design.accept', label: '设计完成', from: 'design', to: 'accept' },
    { id: 'ops.accept', label: '部署完成', from: 'ops', to: 'accept' },
    { id: 'accept.design.rework', label: '打回设计', from: 'accept', to: 'design', back: true },
    { id: 'accept.end', label: '交付', from: 'accept', to: 'end' },
  ],
}

/** 两条回连打回同一个夹在中间的岗位：目标右侧被挡，只能都从底边折回。 */
const BACK_FALLBACK = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('qa', '测试'),
    position('ops', '运维'),
    position('accept', '验收'),
    position('build', '构建'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'start.qa', label: '并行受理', from: 'start', to: 'qa' },
    { id: 'start.ops', label: '并行受理', from: 'start', to: 'ops' },
    { id: 'dev.accept', label: '开发完成', from: 'dev', to: 'accept' },
    { id: 'qa.accept', label: '测试完成', from: 'qa', to: 'accept' },
    { id: 'ops.accept', label: '部署完成', from: 'ops', to: 'accept' },
    { id: 'accept.build', label: '提审', from: 'accept', to: 'build' },
    { id: 'accept.dev.rework', label: '验收打回', from: 'accept', to: 'dev', back: true },
    { id: 'build.dev.rework', label: '复审打回', from: 'build', to: 'dev', back: true },
    { id: 'build.end', label: '交付', from: 'build', to: 'end' },
  ],
}

/** 发布确认同时下发数据库 / 配置变更，另有一条跳层直连执行发布的长标签通道。 */
const SKIP = {
  nodes: [
    { id: 'start', label: '开始', kind: 'start' },
    position('dev', '开发'),
    position('approve', '发布确认'),
    position('db', '变更数据库'),
    position('config', '变更配置'),
    position('release', '执行发布'),
    { id: 'end', label: '结束', kind: 'end' },
  ],
  edges: [
    { id: 'start.dev', label: '受理', from: 'start', to: 'dev' },
    { id: 'dev.approve', label: '提发布确认', from: 'dev', to: 'approve' },
    { id: 'approve.db', label: '变更数据库', from: 'approve', to: 'db' },
    { id: 'approve.config', label: '变更配置', from: 'approve', to: 'config' },
    { id: 'approve.release', label: '跳过变更直接发布', from: 'approve', to: 'release' },
    { id: 'db.release', label: '汇入发布', from: 'db', to: 'release' },
    { id: 'config.release', label: '执行发布', from: 'config', to: 'release' },
    { id: 'release.end', label: '交付报告', from: 'release', to: 'end' },
  ],
}

test('回向通道只用直角折线，线之间不重叠', () => {
  const layout = layoutGraph(CHAIN.nodes, CHAIN.edges)
  const back = layout.edges.filter((edge) => edge.kind === 'back')
  assert.equal(back.length, 3, '三条回连都应被识别')

  for (const edge of back) {
    const points = parsePath(edge.d)
    assert.ok(points.length >= 4, `${edge.id} 至少要走三段`)
    for (const segment of segmentsOf(points)) {
      assert.ok(isOrthogonal(segment), `${edge.id} 的每一段都必须是水平或垂直的`)
    }
  }

  for (let left = 0; left < back.length; left += 1) {
    for (let right = left + 1; right < back.length; right += 1) {
      const first = back[left]
      const second = back[right]
      if (first === undefined || second === undefined) continue
      for (const a of segmentsOf(parsePath(first.d))) {
        for (const b of segmentsOf(parsePath(second.d))) {
          assert.ok(
            collinearOverlap(a, b) < 0.01,
            `${first.id} 与 ${second.id} 不能有共线重叠的线段`,
          )
        }
      }
    }
  }

  const sharedTarget = back.filter((edge) => edge.to === 'dev')
  assert.equal(sharedTarget.length, 2, '开发节点应收到两条回连')
  const [first, second] = sharedTarget
  assert.ok(first !== undefined && second !== undefined)
  assert.notEqual(first.arrow.y, second.arrow.y, '同一目标的入线要在侧边上下错开')
})

test('回向通道固定走右侧，目标侧被挡也不换到左侧', () => {
  const layout = layoutGraph(WIDE.nodes, WIDE.edges)
  const back = layout.edges.filter((edge) => edge.kind === 'back')
  assert.equal(back.length, 2)
  for (const edge of back) {
    assert.equal(pathCrossesNode(edge, layout.nodes), null, `${edge.id} 不能穿过别的节点`)
  }

  const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width / 2))
  const lanes = back.map((edge) => verticalLaneX(parsePath(edge.d)))
  assert.ok(
    lanes.every((lane) => lane > nodeRight),
    '回连一律走右侧车道：目标右边被同排岗位挡住时退回层间空隙，不换到左侧',
  )
})

test('同层回向通道源侧被挡时从行外折回，仍然只用直角折线', () => {
  const layout = layoutGraph(SAME_LAYER.nodes, SAME_LAYER.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.qa.rework')
  assert.ok(edge !== undefined)
  const points = parsePath(edge.d)
  assert.equal(points.length, 4, '源侧被挡时直接下到行间轨道：出线、绕行、进节点')
  for (const segment of segmentsOf(points)) {
    assert.ok(isOrthogonal(segment), '同层回连的每一段也必须是水平或垂直的')
  }
  assert.ok((points[0]?.y ?? 0) < (points[1]?.y ?? 0), '回连从源节点底边出线，不能先穿过右边的岗位')
  assert.equal(pathCrossesNode(edge, layout.nodes), null, '同层回连不能穿过别的节点')
})

test('同层回向通道源侧没被挡时走右侧车道', () => {
  const edges = SAME_LAYER.edges.map((edge) =>
    edge.id === 'dev.qa.rework' ? { ...edge, id: 'qa.dev.rework', from: 'qa', to: 'dev' } : edge,
  )
  const layout = layoutGraph(SAME_LAYER.nodes, edges)
  const edge = layout.edges.find((item) => item.id === 'qa.dev.rework')
  assert.ok(edge !== undefined)
  const points = parsePath(edge.d)
  assert.equal(points.length, 5, '源侧没被挡时走外侧车道：出线、绕行、进节点')
  for (const segment of segmentsOf(points)) assert.ok(isOrthogonal(segment))
  assert.equal(pathCrossesNode(edge, layout.nodes), null)

  const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width / 2))
  assert.ok(verticalLaneX(points) > nodeRight, '同层回连也走右侧车道')
})

test('并行前向通道的名称沿曲线错开，避免同排压字', () => {
  const layout = layoutGraph(
    [
      { id: 'start', label: '开始', kind: 'start' },
      position('dev', '开发'),
      { id: 'end', label: '结束', kind: 'end' },
    ],
    [
      { id: 'start.dev.a', label: '受理', from: 'start', to: 'dev' },
      { id: 'start.dev.b', label: '加急受理', from: 'start', to: 'dev' },
    ],
  )
  const [first, second] = layout.edges
  assert.equal(layout.edges.length, 2)
  assert.ok(first !== undefined && second !== undefined)
  assert.ok(first.labelAt !== null && second.labelAt !== null)
  assert.ok(first.labelAt.y < second.labelAt.y, '并行标签应分别靠近起点和终点')
  assert.ok(
    Math.abs(first.labelAt.y - second.labelAt.y) >= 12,
    '并行标签的垂直间距应足够容纳一行文字',
  )
})

test('跳过一层的前向通道绕过中间层，不垂直贯穿节点', () => {
  const layout = layoutGraph(SPAN.nodes, SPAN.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.accept')
  assert.ok(edge !== undefined, '跨层通道应被识别出来')
  assert.equal(edge.kind, 'forward')
  assert.ok(!edge.d.includes('C'), '跨层通道应走直角折线，不能一条直线穿过中间层')
  for (const segment of segmentsOf(parsePath(edge.d))) {
    assert.ok(isOrthogonal(segment), '跨层通道的每一段都必须是水平或垂直的')
  }
  assert.equal(pathCrossesNode(edge, layout.nodes), null, '跨层通道不能穿过中间层的节点')

  const nodeLeft = Math.min(...layout.nodes.map((node) => node.x - node.width / 2))
  const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width / 2))
  const lanes = segmentsOf(parsePath(edge.d)).filter(
    (segment) => Math.abs(segment.a.x - segment.b.x) < 0.01,
  )
  assert.ok(
    lanes.some((lane) => lane.a.x < nodeLeft || lane.a.x > nodeRight),
    '跨层通道的纵向车道应绕在所有节点之外',
  )
})

test('跨两层以上的前向通道同样绕行，且不与回向通道共线', () => {
  const layout = layoutGraph(LONG_SPAN.nodes, LONG_SPAN.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.build')
  assert.ok(edge !== undefined)
  assert.ok(!edge.d.includes('C'), '跨多层的通道也不能直接穿过中间层')
  assert.equal(pathCrossesNode(edge, layout.nodes), null)

  // 回向通道与跨层通道都是直角折线：两两之间不能有共线重叠。
  const straight = layout.edges.filter((item) => !item.d.includes('C'))
  for (let left = 0; left < straight.length; left += 1) {
    for (let right = left + 1; right < straight.length; right += 1) {
      const first = straight[left]
      const second = straight[right]
      if (first === undefined || second === undefined) continue
      for (const a of segmentsOf(parsePath(first.d))) {
        for (const b of segmentsOf(parsePath(second.d))) {
          assert.ok(
            collinearOverlap(a, b) < 0.01,
            `${first.id} 与 ${second.id} 不能有共线重叠的线段`,
          )
        }
      }
    }
  }
})

test('跨层通道与相邻通道的端点错开，不挤在同一节点口', () => {
  const layout = layoutGraph(SPAN.nodes, SPAN.edges)
  const adjacent = layout.edges.find((item) => item.id === 'qa.accept')
  const straddle = layout.edges.find((item) => item.id === 'dev.accept')
  const devQa = layout.edges.find((item) => item.id === 'dev.qa')
  assert.ok(adjacent !== undefined && straddle !== undefined && devQa !== undefined)

  assert.notEqual(
    startPointOf(devQa.d).x,
    startPointOf(straddle.d).x,
    '跨层通道从侧边出线，不能和相邻层的出线挤在底边中点',
  )
  assert.notEqual(
    endPointOf(adjacent.d).x,
    endPointOf(straddle.d).x,
    '同一目标的多条入线不能在顶边中点叠在一起',
  )
})

test('侧边没被挡住时，跨层通道贴着节点左侧走，不横穿整行', () => {
  const layout = layoutGraph(SPAN.nodes, SPAN.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.accept')
  assert.ok(edge !== undefined)
  const points = parsePath(edge.d)
  assert.equal(points.length, 4, '两侧都能从侧边进出时，只需出线、绕行、进线四段')

  const dev = layout.nodes.find((node) => node.id === 'dev')
  const accept = layout.nodes.find((node) => node.id === 'accept')
  assert.ok(dev !== undefined && accept !== undefined)
  const startX = points[0]?.x ?? 0
  const endX = points.at(-1)?.x ?? 0
  assert.ok(
    Math.abs(startX - (dev.x - dev.width / 2)) < 1,
    '从源节点左侧边出线，不横穿源行的层间空隙',
  )
  assert.ok(
    Math.abs(endX - (accept.x - accept.width / 2)) < 1,
    '从目标节点左侧边进线，不横穿目标行的层间空隙',
  )
})

test('回向通道与跨层通道分居右侧 / 左侧，向上的线不与向下的线共用车道', () => {
  const layout = layoutGraph(LONG_SPAN.nodes, LONG_SPAN.edges)
  const rework = layout.edges.find((item) => item.id === 'accept.dev.rework')
  const straddle = layout.edges.find((item) => item.id === 'dev.build')
  assert.ok(rework !== undefined && straddle !== undefined)

  const nodeLeft = Math.min(...layout.nodes.map((node) => node.x - node.width / 2))
  const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width / 2))
  const backLane = verticalLaneX(parsePath(rework.d))
  const downLane = verticalLaneX(parsePath(straddle.d))
  assert.ok(backLane > nodeRight, '回向通道绕右侧车道')
  assert.ok(downLane < nodeLeft, '跨层前向通道绕左侧车道，不和回向通道共用')

  const dev = layout.nodes.find((node) => node.id === 'dev')
  assert.ok(dev !== undefined)
  assert.ok(
    startPointOf(straddle.d).x < dev.x,
    '跨层通道从 dev 左侧出线，不会和回向通道在右侧抢端口',
  )
  assert.ok(endPointOf(rework.d).x > dev.x, '回向通道从 dev 右侧进线，和跨层通道分居两侧')
})

test('跨层通道侧边被同排兄弟挡住时，仍走左侧并退回层间空隙轨道', () => {
  const layout = layoutGraph(BLOCKED.nodes, BLOCKED.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.accept')
  assert.ok(edge !== undefined)
  const points = parsePath(edge.d)
  assert.equal(points.length, 5, '底边出线 → 源轨道 → 车道 → 目标行 → 侧边入线')
  for (const segment of segmentsOf(points)) {
    assert.ok(isOrthogonal(segment), '退回轨道后仍然只能走水平 / 垂直线段')
  }
  assert.equal(pathCrossesNode(edge, layout.nodes), null, '退回轨道后也不能穿过别的节点')

  const nodeLeft = Math.min(...layout.nodes.map((node) => node.x - node.width / 2))
  assert.ok(verticalLaneX(points) < nodeLeft, '源侧被挡也不换到右侧，跨层通道固定走左侧')
})

test('回向通道目标侧被兄弟挡住时，从层间空隙折回目标底边', () => {
  const layout = layoutGraph(BACK_BLOCKED.nodes, BACK_BLOCKED.edges)
  const edge = layout.edges.find((item) => item.id === 'accept.design.rework')
  assert.ok(edge !== undefined)
  assert.equal(pathCrossesNode(edge, layout.nodes), null, '回向通道不能从同排兄弟节点上横穿过去')
  const segments = segmentsOf(parsePath(edge.d))
  assert.ok(segments.length >= 4)
  for (const segment of segments) assert.ok(isOrthogonal(segment))
  const last = segments.at(-1)
  assert.ok(last !== undefined && last.a.y > last.b.y, '底边入线应向上进入目标节点')
})

test('多条回连从同一个节点底边折回时，入口横向错开', () => {
  const layout = layoutGraph(BACK_FALLBACK.nodes, BACK_FALLBACK.edges)
  const back = layout.edges.filter((edge) => edge.kind === 'back')
  assert.equal(back.length, 2)
  for (const edge of back) {
    assert.equal(pathCrossesNode(edge, layout.nodes), null, `${edge.id} 不能穿过别的节点`)
  }

  const ends = back.map((edge) => endPointOf(edge.d))
  assert.ok(
    Math.abs((ends[0]?.x ?? 0) - (ends[1]?.x ?? 0)) >= 1,
    '两条回连不能在目标底边的同一个入口叠在一起',
  )
  for (let left = 0; left < back.length; left += 1) {
    for (let right = left + 1; right < back.length; right += 1) {
      const first = back[left]
      const second = back[right]
      if (first === undefined || second === undefined) continue
      for (const a of segmentsOf(parsePath(first.d))) {
        for (const b of segmentsOf(parsePath(second.d))) {
          assert.ok(
            collinearOverlap(a, b) < 0.01,
            `${first.id} 与 ${second.id} 不能有共线重叠的线段`,
          )
        }
      }
    }
  }
})

test('跨层通道的长标签压在绕行车道中间，不偏到节点那一侧', () => {
  const layout = layoutGraph(SKIP.nodes, SKIP.edges)
  const edge = layout.edges.find((item) => item.id === 'approve.release')
  assert.ok(edge !== undefined)
  assert.ok(edge.labelAt !== null, '跨层通道要给出标签落位')

  const run = laneRunOf(edge.d)
  assert.ok(run !== null, '跨层通道应有一条纵向车道')
  assert.ok(Math.abs(edge.labelAt.x - run.x) < 0.01, '标签横向居中在车道上，不能偏到节点那一侧')
  assert.ok(Math.abs(edge.labelAt.y - (run.top + run.bottom) / 2) < 0.01, '标签落在绕行段的中点')

  // 长标签既不压住卡片，也不能被画布裁掉：车道与画布都为标签让过位。
  const box = labelBoxOf(edge)
  assert.ok(box.left >= 0, '标签不能越过画布左边界')
  assert.ok(box.right <= layout.width, '标签不能越过画布右边界')
  assert.ok(box.right <= run.x + 44 + 0.01, '标签的右半边不超过给自己的留白')
  for (const node of layout.nodes) {
    assert.equal(overlapsNode(box, node), false, `标签不能压在 ${node.id} 上`)
  }
})

test('跨层通道的短标签同样压在自己的车道中间', () => {
  const layout = layoutGraph(SPAN.nodes, SPAN.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.accept')
  assert.ok(edge !== undefined)
  assert.ok(edge.labelAt !== null)

  const run = laneRunOf(edge.d)
  assert.ok(run !== null)
  assert.ok(Math.abs(edge.labelAt.x - run.x) < 0.01, '标签横向居中在车道上')
  assert.ok(Math.abs(edge.labelAt.y - (run.top + run.bottom) / 2) < 0.01, '标签落在绕行段的中点')
  for (const node of layout.nodes) {
    assert.equal(overlapsNode(labelBoxOf(edge), node), false, `标签不能压在 ${node.id} 上`)
  }
})

/** 解析 `M x y L x y ...` 形式的路径。 */
function parsePath(d) {
  const tokens = d.trim().split(/\s+/)
  const points = []
  for (let index = 0; index < tokens.length; index += 3) {
    const command = tokens[index]
    assert.ok(command === 'M' || command === 'L', `直角通道只允许 M / L，收到 ${String(command)}`)
    const x = Number(tokens[index + 1])
    const y = Number(tokens[index + 2])
    assert.ok(Number.isFinite(x) && Number.isFinite(y), '路径坐标必须是数字')
    points.push({ x, y })
  }
  return points
}

/** 路径的起点坐标（兼容 M/L 与 M/C 两种写法）。 */
function startPointOf(d) {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  return { x: numbers[0], y: numbers[1] }
}

/** 路径的终点坐标（兼容 M/L 与 M/C 两种写法）。 */
function endPointOf(d) {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  return { x: numbers.at(-2), y: numbers.at(-1) }
}

/** 把点序列拆成线段。 */
function segmentsOf(points) {
  const segments = []
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (a === undefined || b === undefined) continue
    segments.push({ a, b })
  }
  return segments
}

/** 线段是否水平或垂直。 */
function isOrthogonal(segment) {
  return Math.abs(segment.a.x - segment.b.x) < 0.01 || Math.abs(segment.a.y - segment.b.y) < 0.01
}

/** 两条共线线段重叠的长度。 */
function collinearOverlap(left, right) {
  if (
    Math.abs(left.a.y - left.b.y) < 0.01 &&
    Math.abs(right.a.y - right.b.y) < 0.01 &&
    Math.abs(left.a.y - right.a.y) < 0.01
  ) {
    return (
      Math.min(Math.max(left.a.x, left.b.x), Math.max(right.a.x, right.b.x)) -
      Math.max(Math.min(left.a.x, left.b.x), Math.min(right.a.x, right.b.x))
    )
  }
  if (
    Math.abs(left.a.x - left.b.x) < 0.01 &&
    Math.abs(right.a.x - right.b.x) < 0.01 &&
    Math.abs(left.a.x - right.a.x) < 0.01
  ) {
    return (
      Math.min(Math.max(left.a.y, left.b.y), Math.max(right.a.y, right.b.y)) -
      Math.max(Math.min(left.a.y, left.b.y), Math.min(right.a.y, right.b.y))
    )
  }
  return 0
}

/** 路径是否穿过除起终点以外的节点内部。 */
function pathCrossesNode(edge, nodes) {
  const own = new Set([edge.from, edge.to])
  for (const segment of segmentsOf(parsePath(edge.d))) {
    for (const node of nodes) {
      if (own.has(node.id)) continue
      const left = node.x - node.width / 2 + 1
      const right = node.x + node.width / 2 - 1
      const top = node.y - node.height / 2 + 1
      const bottom = node.y + node.height / 2 - 1
      if (Math.abs(segment.a.x - segment.b.x) < 0.01) {
        if (segment.a.x <= left || segment.a.x >= right) continue
        const low = Math.min(segment.a.y, segment.b.y)
        const high = Math.max(segment.a.y, segment.b.y)
        if (high > top && low < bottom) return node.id
      } else {
        if (segment.a.y <= top || segment.a.y >= bottom) continue
        const low = Math.min(segment.a.x, segment.b.x)
        const high = Math.max(segment.a.x, segment.b.x)
        if (high > left && low < right) return node.id
      }
    }
  }
  return null
}

/** 回向通道最外侧那段的 x：取最长的一条垂直线段。 */
function verticalLaneX(points) {
  let bestX = 0
  let bestLength = 0
  for (const segment of segmentsOf(points)) {
    if (Math.abs(segment.a.x - segment.b.x) >= 0.01) continue
    const length = Math.abs(segment.a.y - segment.b.y)
    if (length <= bestLength) continue
    bestLength = length
    bestX = segment.a.x
  }
  return bestX
}

/** 路径里最长的一条垂直线段：车道的位置与纵向范围。 */
function laneRunOf(d) {
  let best = null
  for (const segment of segmentsOf(parsePath(d))) {
    if (Math.abs(segment.a.x - segment.b.x) >= 0.01) continue
    const length = Math.abs(segment.a.y - segment.b.y)
    if (best !== null && length <= best.length) continue
    best = {
      x: segment.a.x,
      length,
      top: Math.min(segment.a.y, segment.b.y),
      bottom: Math.max(segment.a.y, segment.b.y),
    }
  }
  return best
}

/** 标签的估算包围盒：与布局层一致，11px 字号、中文按一个字宽算。 */
function labelBoxOf(edge) {
  const chars = [...edge.label]
  const width = Math.min(chars.length, 14) * 11
  const x = edge.labelAt?.x ?? 0
  const y = edge.labelAt?.y ?? 0
  return { left: x - width / 2, right: x + width / 2, top: y - 6, bottom: y + 6 }
}

/** 标签包围盒是否与节点卡片重叠。 */
function overlapsNode(box, node) {
  return (
    box.right > node.x - node.width / 2 &&
    box.left < node.x + node.width / 2 &&
    box.bottom > node.y - node.height / 2 &&
    box.top < node.y + node.height / 2
  )
}
