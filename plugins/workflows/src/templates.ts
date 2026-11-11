/**
 * 工作流模板目录：给「工作流编排」preset 参考的**抽象流程**。
 *
 * 模板不是可运行的定义：机器人节点里的 `robot` 是抽象角色名（例如「开发」「测试」），
 * 而不是某个真实机器人；节点也不声明 `output`。编排 agent 建真实工作流时，先用
 * `buka_robots` 看真正拥有的机器人，再参考这里的流程结构，把抽象角色替换成真实
 * 机器人、按需求补上每个机器人节点的 `output` 与边 prompt——**参考流程，不照搬**。
 *
 * 每个模板带一份 `description`，告诉 agent 什么时候应该参考它；浏览器一半的
 * 「工作流 → 模板」页签用它做卡片说明，编排 agent 通过只读工具
 * `buka_workflow_templates` 读到同一份目录。
 *
 * 模板是随插件发布的静态数据，只读；本模块不依赖 DSH，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-workflows/templates
 */

/** 单个模板最多节点数。 */
export const MAX_TEMPLATE_NODES = 200

/** 模板 id 的合法字符集：小写字母 / 数字 / 连字符。 */
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u

/** 模板名称的最大字符数。 */
const MAX_NAME_LENGTH = 120

/** 模板描述的最大字符数。 */
const MAX_DESCRIPTION_LENGTH = 2000

/** 抽象角色名的最大字符数（与可运行定义的机器人名上限一致）。 */
const MAX_ROBOT_NAME_LENGTH = 128

/** 用户介入节点标题的最大字符数。 */
const MAX_USER_TITLE_LENGTH = 200

/** 模板里的节点类型。 */
const NODE_TYPES = new Set(['start', 'robot', 'user', 'join', 'end'])

/** 模板里的一条出边。 */
export interface TemplateEdge {
  to: string
  name?: string
  label?: string
  prompt?: string
}

/** 模板里的一个节点。 */
export interface TemplateNode {
  id: string
  type: 'start' | 'robot' | 'user' | 'join' | 'end'
  next?: TemplateEdge[]
  robot?: string
  summary?: string
  title?: string
  detail?: string
  inputs?: string[]
  status?: string
}

/** 一份抽象工作流模板。 */
export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  nodes: TemplateNode[]
}

/**
 * 抽象工作流模板目录。
 *
 * `nodes` 复用可运行定义的节点图形状（start / robot / user / end + 出边），但有
 * 三点刻意不同，用来强调「这是参考」：robot 节点的 `robot` 是抽象角色名、没有
 * `output`；边上的 `prompt` 只描述交付关系，不写具体任务；整体不含 `goal`。
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'develop-test',
    name: '开发与测试',
    description:
      '当需求涉及代码或配置改动，并且要走完「开发 → 测试 → 验收 → 合并 → 配置 → 构建部署 → 生产回归」的完整交付链路时参考。它演示了几种常见情况：开发被拆成多个仓库并行、测试不通过打回开发循环、测试需要用户介入操作、以及「当前条件无法完成需求测试」时交用户决定是否调整需求或放弃。参考时把「开发 / 测试 / 运维」替换成你真正拥有的机器人（先用 buka_robots 看清单），并给每个机器人节点补上它要交回的结果 schema。',
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [
          {
            to: 'plan',
            name: 'begin',
            prompt: '按需求拆解改动范围，确定涉及哪些仓库，并规划开发顺序。',
          },
        ],
      },
      {
        id: 'plan',
        type: 'robot',
        robot: '开发',
        summary: '拆解需求，规划各仓库的改动范围',
        next: [
          {
            to: 'dev-backend',
            name: '后端',
            prompt: '实现后端服务改动（仓库 A），本地自测通过后交回。',
          },
          {
            to: 'dev-frontend',
            name: '前端',
            prompt: '实现前端页面改动（仓库 B），本地自测通过后交回。',
          },
        ],
      },
      {
        id: 'dev-backend',
        type: 'robot',
        robot: '开发',
        summary: '实现后端服务改动（仓库 A）并自测',
        next: [{ to: 'merge', name: '完成', prompt: '后端改动完成，进入集成步骤。' }],
      },
      {
        id: 'dev-frontend',
        type: 'robot',
        robot: '开发',
        summary: '实现前端页面改动（仓库 B）并自测',
        next: [{ to: 'merge', name: '完成', prompt: '前端改动完成，进入集成步骤。' }],
      },
      {
        id: 'merge',
        type: 'robot',
        robot: '开发',
        summary: '集成各仓库改动并部署到测试环境（只有一个仓库时无需合并）',
        next: [
          {
            to: 'test',
            name: '已部署',
            prompt: '改动已集成并部署到测试环境，请验证是否满足需求。',
          },
        ],
      },
      {
        id: 'test',
        type: 'robot',
        robot: '测试',
        summary: '验证改动是否满足需求',
        next: [
          { to: 'accept', name: '通过', prompt: '测试通过，进入验收。' },
          {
            to: 'dev-backend',
            name: '不通过',
            prompt: '测试不通过，按失败信息回到开发修复后重新提交。',
          },
          { to: 'user-help', name: '需用户介入', prompt: '测试需要用户完成某项操作后才能继续。' },
          {
            to: 'user-blocked',
            name: '无法完成',
            prompt: '当前条件无法完成需求测试，交用户决定下一步。',
          },
        ],
      },
      {
        id: 'user-help',
        type: 'user',
        title: '需要用户介入操作',
        detail: '测试环节需要你完成某个操作（提供账号、配置环境、确认外部依赖等）后才能继续。',
        next: [{ to: 'test', name: 'resume', label: '已完成，继续测试' }],
      },
      {
        id: 'user-blocked',
        type: 'user',
        title: '条件无法完成需求测试',
        detail: '当前条件（环境 / 数据 / 依赖 / 需求本身）下无法完成需求测试，请决定下一步。',
        next: [
          { to: 'plan', name: 'adjust', label: '调整需求后重来' },
          { to: 'end-rejected', name: 'abandon', label: '放弃本次需求' },
        ],
      },
      {
        id: 'accept',
        type: 'user',
        title: '验收',
        detail: '改动已通过测试，请验收确认是否可以进入发布流程。',
        next: [
          { to: 'config', name: 'ok', label: '验收通过' },
          { to: 'dev-backend', name: 'rework', label: '验收不通过' },
        ],
      },
      {
        id: 'config',
        type: 'robot',
        robot: '运维',
        summary: '按发布要求调整配置',
        next: [{ to: 'deploy', name: '完成', prompt: '配置已就绪，请构建并部署到生产。' }],
      },
      {
        id: 'deploy',
        type: 'robot',
        robot: '运维',
        summary: '构建并部署到生产',
        next: [
          { to: 'regression', name: '已部署', prompt: '已部署到生产，请做生产环境回归验证。' },
        ],
      },
      {
        id: 'regression',
        type: 'robot',
        robot: '测试',
        summary: '生产环境回归验证',
        next: [
          { to: 'end-done', name: '通过', prompt: '回归通过，发布完成。' },
          {
            to: 'config',
            name: '回滚/修复',
            prompt: '回归发现问题，回到配置 / 修复后再重新部署。',
          },
        ],
      },
      { id: 'end-done', type: 'end', status: 'completed' },
      { id: 'end-rejected', type: 'end', status: 'rejected' },
    ],
  },
  {
    id: 'draft-review',
    name: '起草与审校',
    description:
      '当交付物是一份需要质量把关的文字内容（文档、方案、文案、公告等）时参考。它演示「起草 → 审校 → 人工定稿」的主流程，以及审校不通过退回重写、审校需要用户澄清事实等分支。参考时把「起草 / 审校」替换成真实的机器人，并给节点补上各自的结果 schema。',
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [{ to: 'draft', name: 'begin', prompt: '按需求起草内容并交回全文。' }],
      },
      {
        id: 'draft',
        type: 'robot',
        robot: '起草',
        summary: '起草内容',
        next: [{ to: 'review', name: '完成', prompt: '起草完成，请审校内容质量与准确性。' }],
      },
      {
        id: 'review',
        type: 'robot',
        robot: '审校',
        summary: '审校内容',
        next: [
          { to: 'finalize', name: '通过', prompt: '审校通过，请用户确认定稿。' },
          { to: 'draft', name: '需修改', prompt: '审校不通过，按修改意见重写后重新提交。' },
          { to: 'clarify', name: '需澄清', prompt: '内容需要用户澄清事实 / 口径后才能继续审校。' },
        ],
      },
      {
        id: 'clarify',
        type: 'user',
        title: '澄清需求',
        detail: '审校过程中有些事实或口径需要你澄清，请说明后继续。',
        next: [{ to: 'draft', name: 'resume', label: '已澄清，继续修改' }],
      },
      {
        id: 'finalize',
        type: 'user',
        title: '确认定稿',
        detail: '内容已经过审校，请确认是否定稿。',
        next: [
          { to: 'done', name: 'ok', label: '定稿' },
          { to: 'draft', name: 'revise', label: '继续修改' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  },
  {
    id: 'research-report',
    name: '调研与报告',
    description:
      '当任务需要先搜集资料、再汇总结论交给用户确认时参考。它演示「调研 → 报告 → 人工确认」的主流程，以及调研缺资料需用户提供、报告缺材料回调研补充、用户不满意可重写或补充调研等分支。参考时把「调研 / 报告」替换成真实机器人，并给节点补上结果 schema。',
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [
          { to: 'research', name: 'begin', prompt: '围绕主题搜集资料，整理出关键事实与来源。' },
        ],
      },
      {
        id: 'research',
        type: 'robot',
        robot: '调研',
        summary: '搜集资料',
        next: [
          { to: 'report', name: '完成', prompt: '资料充分，请把材料汇总成结论报告。' },
          {
            to: 'user-source',
            name: '需用户提供',
            prompt: '缺少关键资料或访问权限，需要用户提供后才能继续。',
          },
        ],
      },
      {
        id: 'user-source',
        type: 'user',
        title: '提供资料 / 权限',
        detail: '调研缺少关键资料或访问权限，请你提供后继续。',
        next: [{ to: 'research', name: 'resume', label: '已提供，继续调研' }],
      },
      {
        id: 'report',
        type: 'robot',
        robot: '报告',
        summary: '汇总报告',
        next: [
          { to: 'confirm', name: '完成', prompt: '报告完成，请用户确认结论。' },
          { to: 'research', name: '缺材料', prompt: '材料不足，请补充调研后再完善报告。' },
        ],
      },
      {
        id: 'confirm',
        type: 'user',
        title: '确认结论',
        detail: '请查看调研结论，确认是否接受。',
        next: [
          { to: 'done', name: 'ok', label: '接受' },
          { to: 'research', name: 'more', label: '补充调研' },
          { to: 'report', name: 'rewrite', label: '重写报告' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  },
  {
    id: 'collect-analyze',
    name: '采集与分析',
    description:
      '当需要先采集数据或素材、再分析产出结论，并且结论需要人工把关时参考。它演示「采集 → 分析 → 人工确认」的主流程，以及采集缺数据源需用户提供、分析发现素材不足回采集补充、用户不满意可重分析或重采集等分支。参考时把「采集 / 分析」替换成真实机器人，并给节点补上结果 schema。',
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [{ to: 'collect', name: 'begin', prompt: '采集任务所需的数据或素材，整理后交回。' }],
      },
      {
        id: 'collect',
        type: 'robot',
        robot: '采集',
        summary: '采集数据 / 素材',
        next: [
          { to: 'analyze', name: '完成', prompt: '采集完成，请分析数据并给出结论。' },
          {
            to: 'user-data',
            name: '需用户协助',
            prompt: '缺少数据源或访问凭证，需要用户提供后才能继续采集。',
          },
        ],
      },
      {
        id: 'user-data',
        type: 'user',
        title: '提供数据 / 凭证',
        detail: '采集缺少数据源或访问凭证，请你提供后继续。',
        next: [{ to: 'collect', name: 'resume', label: '已提供，继续采集' }],
      },
      {
        id: 'analyze',
        type: 'robot',
        robot: '分析',
        summary: '分析并出结论',
        next: [
          { to: 'confirm', name: '完成', prompt: '分析完成，请用户确认结论。' },
          { to: 'collect', name: '素材不足', prompt: '素材不足，请补充采集后再分析。' },
        ],
      },
      {
        id: 'confirm',
        type: 'user',
        title: '确认结论',
        detail: '请查看分析结论，确认是否接受。',
        next: [
          { to: 'done', name: 'ok', label: '接受' },
          { to: 'analyze', name: 'redo', label: '重新分析' },
          { to: 'collect', name: 'recollect', label: '重新采集' },
        ],
      },
      { id: 'done', type: 'end', status: 'completed' },
    ],
  },
  {
    id: 'parallel-fanout',
    name: '并行分派与汇合',
    description:
      '当一项工作可以拆成多个互不依赖的任务、并行执行后再汇总结果时参考：一个规划节点 fan-out 出多个任务（每个任务一个机器人并行跑），join 节点等所有实际启动的任务都完成后放行到下游汇总。参考时把「规划 / 执行 / 汇总」替换成真实机器人，并给节点补上各自的结果 schema 与具体 prompt。',
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: [{ to: 'plan', name: 'begin', prompt: '拆解需求，规划并行任务。' }],
      },
      {
        id: 'plan',
        type: 'robot',
        robot: '规划',
        summary: '拆解需求，规划并行任务',
        next: [
          { to: 'task-a', name: '任务A', prompt: '完成并行任务 A。' },
          { to: 'task-b', name: '任务B', prompt: '完成并行任务 B。' },
          { to: 'task-c', name: '任务C', prompt: '完成并行任务 C。' },
        ],
      },
      { id: 'task-a', type: 'robot', robot: '执行', summary: '并行任务 A' },
      { id: 'task-b', type: 'robot', robot: '执行', summary: '并行任务 B' },
      { id: 'task-c', type: 'robot', robot: '执行', summary: '并行任务 C' },
      {
        id: 'merge',
        type: 'join',
        inputs: ['task-a', 'task-b', 'task-c'],
        next: [{ to: 'summarize', prompt: '全部并行任务完成，汇总结果。' }],
      },
      {
        id: 'summarize',
        type: 'robot',
        robot: '汇总',
        summary: '汇总各并行任务的结果',
        next: [{ to: 'end', name: '完成' }],
      },
      { id: 'end', type: 'end', status: 'completed' },
    ],
  },
]

/**
 * 模板清单（含完整 `nodes`）。浏览器「模板」页签与 Host 路由直接用它。
 *
 * @returns 模板清单
 */
export function listTemplates(): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES
}

/**
 * 按 id 取一份模板；找不到返回 null。
 *
 * @param id 模板 id
 * @returns 找到的模板；不存在时是 `null`
 */
export function findTemplate(id: string): WorkflowTemplate | null {
  if (typeof id !== 'string') return null
  const target = id.trim()
  return WORKFLOW_TEMPLATES.find((template) => template.id === target) ?? null
}

/**
 * 模板的摘要（不含 `nodes`）：给编排 agent 的清单，让它在选模板时先看
 * 名字与「什么时候该参考」。
 *
 * @param templates 模板清单
 * @returns 模板摘要
 */
export function summarizeTemplates(
  templates: ReadonlyArray<WorkflowTemplate> = WORKFLOW_TEMPLATES,
): Array<{ id: string; name: string; description: string }> {
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
  }))
}

/**
 * 把一份模板转成给模型看的可读流程：名字 + 描述 + 按拓扑顺序排的节点流。
 * 只做展示，不校验结构（校验见 `validateTemplates`）。
 *
 * @param template 模板
 * @returns 给模型看的可读流程
 */
export function describeTemplate(template: WorkflowTemplate): string {
  const lines = [`workflow template "${template.name}" (id: ${template.id})`, template.description]
  const nodes = Array.isArray(template.nodes) ? template.nodes : []
  if (nodes.length === 0) return lines.join('\n')
  lines.push('abstract flow (roles are placeholders — map them to real robots):')
  const order = topoOrder(nodes)
  for (const id of order) {
    const node = nodes.find((item) => item.id === id)
    if (node === undefined) continue
    const role =
      node.type === 'robot' && typeof node.robot === 'string' ? ` role=${node.robot}` : ''
    const title = typeof node.title === 'string' && node.title !== '' ? ` "${node.title}"` : ''
    const routes = (Array.isArray(node.next) ? node.next : [])
      .map((rule) => {
        const label =
          typeof rule.label === 'string' && rule.label !== '' ? ` (label: ${rule.label})` : ''
        return typeof rule.name === 'string' ? `${rule.name}→${rule.to}${label}` : `→${rule.to}`
      })
      .filter((text) => text !== '')
    const inputsText =
      node.type === 'join'
        ? `  inputs=${(Array.isArray(node.inputs) ? node.inputs : []).join(', ')}`
        : ''
    lines.push(
      `- ${node.id} [${node.type}${role}]${title}${inputsText}${routes.length === 0 ? '' : `  edges=${routes.join(' | ')}`}`,
    )
  }
  return lines.join('\n')
}

/**
 * 校验模板目录的结构，返回 `{ ok, errors }`。这是**宽松**校验：不要求 robot 节点
 * 声明 `output`、不检查边 prompt 的模板变量，只保证目录能被页面与 agent 安全地
 * 读出来（id 唯一、名字 / 描述存在、节点与出边引用自洽、start 唯一且可到达所有节点）。
 *
 * @param input 模板目录
 * @returns 校验结果
 */
export function validateTemplates(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, errors: ['templates must be a non-empty array'] }
  }

  const ids = new Set<string>()
  for (const [index, raw] of (input as unknown[]).entries()) {
    const path = `templates[${index}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${path} must be an object`)
      continue
    }
    const record = raw as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!TEMPLATE_ID_PATTERN.test(id)) {
      errors.push(
        `${path}.id must be 1-64 lowercase letters, digits or "-", starting with a letter or digit`,
      )
    } else if (ids.has(id)) {
      errors.push(`${path}.id duplicates template "${id}"`)
    } else {
      ids.add(id)
    }
    if (typeof record.name !== 'string' || record.name.trim() === '') {
      errors.push(`${path}.name must be a non-empty name`)
    } else if (record.name.trim().length > MAX_NAME_LENGTH) {
      errors.push(`${path}.name must be at most ${MAX_NAME_LENGTH} characters`)
    }
    if (typeof record.description !== 'string' || record.description.trim() === '') {
      errors.push(`${path}.description must be a non-empty description`)
    } else if (record.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`${path}.description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
    }
    if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
      errors.push(`${path}.nodes must be a non-empty array`)
      continue
    }
    validateTemplateNodes(record.nodes as unknown[], `${path}.nodes`, errors)
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 校验一份模板里的节点与出边。
 *
 * @param nodes 模板节点数组
 * @param path 出错时使用的路径前缀
 * @param errors 错误列表
 */
function validateTemplateNodes(
  nodes: ReadonlyArray<unknown>,
  path: string,
  errors: string[],
): void {
  if (nodes.length > MAX_TEMPLATE_NODES) {
    errors.push(`${path} must contain at most ${MAX_TEMPLATE_NODES} nodes`)
  }
  const ids = new Set<string>()
  const startIds: string[] = []
  for (const [index, raw] of nodes.entries()) {
    const nodePath = `${path}[${index}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${nodePath} must be an object`)
      continue
    }
    const record = raw as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id === '') {
      errors.push(`${nodePath}.id must be a non-empty id`)
      continue
    }
    if (ids.has(id)) {
      errors.push(`${nodePath}.id duplicates node "${id}"`)
      continue
    }
    ids.add(id)
    const type = typeof record.type === 'string' ? record.type.trim() : ''
    if (!NODE_TYPES.has(type)) {
      errors.push(`${nodePath}.type must be "start", "robot", "user", "join" or "end"`)
      continue
    }
    if (type === 'start') startIds.push(id)
    if (type === 'robot') {
      const robot = typeof record.robot === 'string' ? record.robot.trim() : ''
      if (robot === '') errors.push(`${nodePath}.robot must be a non-empty abstract role name`)
      else if (robot.length > MAX_ROBOT_NAME_LENGTH) {
        errors.push(`${nodePath}.robot must be at most ${MAX_ROBOT_NAME_LENGTH} characters`)
      }
    }
    if (type === 'user' && (typeof record.title !== 'string' || record.title.trim() === '')) {
      errors.push(`${nodePath}.title must be a non-empty title`)
    } else if (
      type === 'user' &&
      typeof record.title === 'string' &&
      record.title.trim().length > MAX_USER_TITLE_LENGTH
    ) {
      errors.push(`${nodePath}.title must be at most ${MAX_USER_TITLE_LENGTH} characters`)
    }
  }

  if (startIds.length !== 1) {
    errors.push(`${path} must contain exactly one start node`)
  }

  // 出边必须指向存在的节点；不允许指回 start。
  for (const [index, raw] of nodes.entries()) {
    const nodePath = `${path}[${index}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id === '' || !ids.has(id)) continue
    const next: unknown[] = Array.isArray(record.next) ? record.next : []
    for (const [ruleIndex, rule] of next.entries()) {
      if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
        errors.push(`${nodePath}.next[${ruleIndex}] must be an object`)
        continue
      }
      const ruleRecord = rule as Record<string, unknown>
      const to = typeof ruleRecord.to === 'string' ? ruleRecord.to.trim() : ''
      if (to === '') {
        errors.push(`${nodePath}.next[${ruleIndex}].to must be a non-empty node id`)
      } else if (!ids.has(to)) {
        errors.push(`${nodePath}.next[${ruleIndex}].to references unknown node "${to}"`)
      } else if (to === 'start') {
        errors.push(`${nodePath}.next[${ruleIndex}].to must not point back at the start node`)
      }
    }
  }

  // 所有节点都必须能从 start 走到，否则模板里的这一步永远不会被参考到。
  if (
    startIds.length === 1 &&
    !errors.some((message) => message.includes('must contain exactly one start'))
  ) {
    const reachable = reachableFrom(nodes, startIds[0] as string)
    for (const id of ids) {
      if (!reachable.has(id)) errors.push(`${path}: node "${id}" is not reachable from start`)
    }
  }
}

/**
 * 从 start 出发按出边做一次 BFS。
 *
 * @param nodes 模板节点数组
 * @param start 起始节点 id
 * @returns 从 start 可达的节点 id
 */
function reachableFrom(nodes: ReadonlyArray<unknown>, start: string): Set<string> {
  const byId = new Map<string, Record<string, unknown>>()
  for (const node of nodes) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) continue
    const record = node as Record<string, unknown>
    if (typeof record.id === 'string') byId.set(record.id, record)
  }
  // 任务 → 引用它的 join 反向索引（join.inputs 表达的是入边）。
  const inputJoins = new Map<string, string[]>()
  for (const node of nodes) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) continue
    const record = node as Record<string, unknown>
    if (record.type !== 'join') continue
    for (const input of Array.isArray(record.inputs) ? record.inputs : []) {
      if (typeof input !== 'string') continue
      const list = inputJoins.get(input)
      if (list === undefined)
        inputJoins.set(input, [typeof record.id === 'string' ? record.id : ''])
      else list.push(typeof record.id === 'string' ? record.id : '')
    }
  }
  const seen = new Set<string>()
  const queue: string[] = [start]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (node === undefined) continue
    for (const rule of Array.isArray(node.next) ? node.next : []) {
      if (
        rule !== null &&
        typeof rule === 'object' &&
        typeof (rule as Record<string, unknown>).to === 'string' &&
        (rule as Record<string, unknown>).to !== ''
      ) {
        queue.push((rule as Record<string, unknown>).to as string)
      }
    }
    if (node.type === 'robot') queue.push(...(inputJoins.get(id) ?? []))
  }
  return seen
}

/**
 * 节点的拓扑排序：模板里允许环（例如「测试 → 开发」回边），排序只保证 start 在前、
 * 并尽量按出边顺序排列；环内节点按首次出现位置排。
 *
 * @param nodes 模板节点数组
 * @returns 拓扑排序后的节点 id
 */
function topoOrder(nodes: ReadonlyArray<TemplateNode>): string[] {
  const ids = nodes.map((node) => node.id)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const start = nodes.find((node) => node.type === 'start')
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string | undefined): void => {
    if (id === undefined || seen.has(id)) return
    seen.add(id)
    order.push(id)
    const node = byId.get(id)
    for (const rule of Array.isArray(node?.next) ? node.next : []) {
      if (typeof rule?.to === 'string' && rule.to !== '') visit(rule.to)
    }
  }
  visit(start === undefined ? ids[0] : start.id)
  for (const id of ids) visit(id)
  return order
}
