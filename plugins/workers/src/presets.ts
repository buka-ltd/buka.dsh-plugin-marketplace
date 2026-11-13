/**
 * 随插件发布的预设打工人：全新安装时自动建好的两个起步打工人。
 *
 * 预设打工人只是「初始默认值」，本身与用户在页面上创建的打工人没有区别：
 * 它们会正常登记进 `workers.json`、挂载成 DSH 工作区，用户可以像对待任何打工人
 * 一样重命名、改头像、改职责、编辑 AGENTS.md、装 skills 或删除。插件**不会**在
 * 每次启动时强行补回被删掉的预设——只有登记表里一个打工人都没有（全新安装 /
 * 清空）时才会做一次种子初始化。
 *
 * 本模块只依赖 Node 内置能力，可被 `node --test` 直接 import。
 *
 * @module @buka/dsh-plugin-workers/presets
 */

import { buildWorker } from './builder.ts'
import { readWorkerRegistry } from './worker-store.ts'

/** 软件工程师：负责功能的设计与实现。 */
const SOFTWARE_ENGINEER_AGENTS = `# AGENTS.md

这是「软件工程师」打工人的协作说明。这个目录同时是一个 DSH 工作区。

## 职责

负责软件功能的设计与实现：编写代码、修复缺陷、重构、跑测试、整理提交。

## 约定

- 动手前先读仓库里已有的文档、脚本与测试，并遵循项目自己的 AGENTS.md 与架构约定。
- 提交信息用 Conventional Commits；一个 commit 只做一件事。
- 改完代码要跑相关测试，确认没有引入回归再交回结果。
- 不扩大改动范围：只做被委派的事，不顺手改无关代码。
- 交付时说明改了什么、为什么这样改、以及验证方式。
`

/** 质量保障工程师：负责测试与质量把关。 */
const QA_ENGINEER_AGENTS = `# AGENTS.md

这是「质量保障工程师」打工人的协作说明。这个目录同时是一个 DSH 工作区。

## 职责

负责质量保障：设计并执行测试、检查覆盖率、回归验证、审查变更是否引入风险。

## 约定

- 测试优先：先理解预期行为与边界条件，再写或跑测试。
- 覆盖关键路径与边界用例；对不确定的行为先确认预期，再下结论。
- 发现问题给出可复现的步骤、预期与实际差异、以及风险等级，不直接改实现。
- 回归时对照变更范围，确认没有顺带破坏已有行为。
- 交付时给出结论（通过 / 有问题）与依据，而不是只报现象。
`

/**
 * 预设打工人清单（按显示顺序）。
 *
 */
export const PRESET_WORKERS: ReadonlyArray<{
  name: string
  avatar: string
  description: string
  agents: string
}> = Object.freeze([
  {
    name: '软件工程师',
    avatar: 'rocket',
    description:
      '负责软件功能的设计与实现：写代码、修 bug、重构、跑测试、整理提交；用于编码、实现需求、修缺陷等开发任务。',
    agents: SOFTWARE_ENGINEER_AGENTS,
  },
  {
    name: '质量保障工程师',
    avatar: 'owl',
    description:
      '负责质量保障：设计并执行测试、检查覆盖率、回归验证、审查变更是否引入风险；用于测试、验收、质量把关等任务。',
    agents: QA_ENGINEER_AGENTS,
  },
])

/**
 * 全新安装时把预设打工人补进登记表（幂等）。
 *
 * 只在登记表**一个打工人都没有**时才做种子初始化：这样全新安装立刻有两个
 * 起步打工人，而已有打工人的用户不会被塞进预设，删除预设后也不会在下次启动
 * 被补回。登记表损坏时直接拒绝，绝不覆盖用户文件。
 *
 */
export async function seedPresetWorkers({
  workersDir,
  file,
  workspaceRegistry,
}: {
  workersDir?: string | undefined
  file?: string | undefined
  workspaceRegistry?:
    | {
        list?: () => Array<{ id?: unknown; path?: unknown }>
        create?: (directory: string) => Promise<{ id?: unknown }>
      }
    | null
    | undefined
} = {}): Promise<{ corrupt: boolean; seeded: string[] }> {
  const registry = await readWorkerRegistry({ file })
  if (registry.corrupt) return { corrupt: true, seeded: [] }
  // 内建机器人（clock）不算「用户打工人」：只有已经存在智能体
  // 打工人时才跳过种子初始化，否则全新安装永远补不出两个起步打工人。
  const agents = registry.workers.filter((worker) => worker.driver === 'agent')
  if (agents.length > 0) return { corrupt: false, seeded: [] }

  const seeded: string[] = []
  for (const preset of PRESET_WORKERS) {
    const result = await buildWorker({
      workersDir,
      file,
      name: preset.name,
      avatar: preset.avatar,
      description: preset.description,
      agents: preset.agents,
      workspaceRegistry,
    })
    if (result.created) seeded.push(result.worker.name)
  }
  return { corrupt: false, seeded }
}
