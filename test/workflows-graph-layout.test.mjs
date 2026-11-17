/**
 * @buka/dsh-plugin-workflows 流程图布局：回向通道的直角走线与防重叠约束。
 *
 * 这里直接跑浏览器侧的 `graph/layout.ts`，不启动 DSH、也不渲染 React：
 * 回向通道必须是水平/垂直线段，线之间不能有共线重叠，也不能穿过别的节点。
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

test('回向通道按同排岗位分布选边，不穿过别的节点', () => {
  const layout = layoutGraph(WIDE.nodes, WIDE.edges)
  const back = layout.edges.filter((edge) => edge.kind === 'back')
  assert.equal(back.length, 2)
  for (const edge of back) {
    assert.equal(pathCrossesNode(edge, layout.nodes), null, `${edge.id} 不能穿过别的节点`)
  }

  const nodeLeft = Math.min(...layout.nodes.map((node) => node.x - node.width / 2))
  const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width / 2))
  const lanes = back.map((edge) => verticalLaneX(parsePath(edge.d)))
  assert.ok(
    lanes.some((lane) => lane < nodeLeft),
    '退回左侧岗位的回连应走左侧车道',
  )
  assert.ok(
    lanes.some((lane) => lane > nodeRight),
    '退回右侧岗位的回连应走右侧车道',
  )
})

test('同层回向通道绕到行外，仍然只用直角折线', () => {
  const layout = layoutGraph(SAME_LAYER.nodes, SAME_LAYER.edges)
  const edge = layout.edges.find((item) => item.id === 'dev.qa.rework')
  assert.ok(edge !== undefined)
  const points = parsePath(edge.d)
  assert.equal(points.length, 5, '同层回连要走：出线、绕行、进节点')
  for (const segment of segmentsOf(points)) {
    assert.ok(isOrthogonal(segment), '同层回连的每一段也必须是水平或垂直的')
  }
  assert.ok((points[1]?.x ?? 0) < (points[0]?.x ?? 0), '回连从左边出线，不能先穿过右边的岗位')
  assert.equal(pathCrossesNode(edge, layout.nodes), null, '同层回连不能穿过别的节点')
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

/** 解析 `M x y L x y ...` 形式的路径。 */
function parsePath(d) {
  const tokens = d.trim().split(/\s+/)
  const points = []
  for (let index = 0; index < tokens.length; index += 3) {
    const command = tokens[index]
    assert.ok(command === 'M' || command === 'L', `回向通道只允许 M / L，收到 ${String(command)}`)
    const x = Number(tokens[index + 1])
    const y = Number(tokens[index + 2])
    assert.ok(Number.isFinite(x) && Number.isFinite(y), '路径坐标必须是数字')
    points.push({ x, y })
  }
  return points
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
