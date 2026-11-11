/**
 * 插件配置与运行目录解析：Config schema、默认值与 runs 目录。
 */

import os from 'node:os'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_MAX_ATTACHMENTS_PER_NODE,
  DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
  DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
} from './attachments.ts'

/** 插件配置：`Config` 解析后的形状。 */
export interface WorkflowsConfig {
  readonly runsDir: string
  readonly maxRuns: number
  readonly nodeTimeoutMs: number
  readonly maxSteps: number
  readonly maxNodeTextBytes: number
  readonly maxAttachmentBytes: number
  readonly maxAttachmentsPerNode: number
  readonly maxNodeAttachmentsBytes: number
  readonly maxInlineAttachmentBytes: number
  readonly orchestratorPresets: string[]
  readonly robotPreset: string
}

/** 合并默认值之后的配置。 */
export interface ResolvedOptions {
  runsDir: string
  maxRuns: number
  nodeTimeoutMs: number
  maxSteps: number
  maxNodeTextBytes: number
  maxAttachmentBytes: number
  maxAttachmentsPerNode: number
  maxNodeAttachmentsBytes: number
  maxInlineAttachmentBytes: number
  orchestratorPresets: string[]
  robotPreset: string
}
/** 插件全局目录名。 */
const PLUGIN_CACHE_DIR = 'dsh-plugin-workflows'
/** 默认配置。 */
const DEFAULTS = {
  runsDir: defaultRunsDir(),
  maxRuns: 200,
  // 默认不超时：节点耗时取决于模型速度、任务大小与网络，硬截止很容易误杀。
  // 需要边界的定义可以显式写 robot 节点的 timeoutMs。
  nodeTimeoutMs: 0,
  maxSteps: 64,
  maxNodeTextBytes: 64 * 1024,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  maxAttachmentsPerNode: DEFAULT_MAX_ATTACHMENTS_PER_NODE,
  maxNodeAttachmentsBytes: DEFAULT_MAX_NODE_ATTACHMENTS_BYTES,
  maxInlineAttachmentBytes: DEFAULT_MAX_INLINE_ATTACHMENT_BYTES,
  orchestratorPresets: ['workflow-orchestrator'],
  robotPreset: 'standard',
}

/**
 * 可配置的运行记录目录与限额。
 */
export const Config = z.object({
  runsDir: z
    .string()
    .default(DEFAULTS.runsDir)
    .description('运行记录目录；每次运行在它下面建一个子目录。支持 ~ 前缀。'),
  maxRuns: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxRuns)
    .description(
      '已归档运行最多保留多少条；超出时从最旧的已归档运行开始删除。未归档记录不受这个上限影响。',
    ),
  nodeTimeoutMs: z
    .number()
    .step(1)
    .min(0)
    .default(DEFAULTS.nodeTimeoutMs)
    .description(
      '单个机器人节点的默认硬超时（毫秒）；0 表示不超时。默认不超时，建议由定义按节点显式设置 timeoutMs。',
    ),
  maxSteps: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxSteps)
    .description('单次工作流的最大节点步数。'),
  maxNodeTextBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxNodeTextBytes)
    .description('每个节点结果全文落盘时的字节上限。'),
  maxAttachmentBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxAttachmentBytes)
    .description('单个节点附件的字节上限。'),
  maxAttachmentsPerNode: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxAttachmentsPerNode)
    .description('每次执行最多允许的附件数量。'),
  maxNodeAttachmentsBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxNodeAttachmentsBytes)
    .description('每次执行的附件总量字节上限。'),
  maxInlineAttachmentBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxInlineAttachmentBytes)
    .description('可在 prompt 中用 .text 内联的单个文本附件字节上限。'),
  orchestratorPresets: z
    .array(z.string())
    .default(DEFAULTS.orchestratorPresets)
    .description(
      '能看到并调用工作流工具的 agent preset 名单。留空表示不做收窄（所有会话可见）；推荐只保留随插件发布的 `workflow-orchestrator`。',
    ),
  robotPreset: z
    .string()
    .default(DEFAULTS.robotPreset)
    .description(
      '机器人节点会话使用的 agent preset。编排器跑在专用 preset 上，机器人节点不能继承它，否则会带上编排 persona 且缺少工作工具。',
    ),
})
/**
 * 合并配置与默认值，并解析 runs 目录。
 *
 * @param config 插件配置
 * @returns 合并默认值之后的配置
 */
export function resolveOptions(config: WorkflowsConfig | undefined): ResolvedOptions {
  const orchestratorPresets = Array.isArray(config?.orchestratorPresets)
    ? config.orchestratorPresets
        .map((preset) => String(preset).trim())
        .filter((preset) => preset !== '')
    : DEFAULTS.orchestratorPresets
  const robotPreset = typeof config?.robotPreset === 'string' ? config.robotPreset.trim() : ''
  return {
    runsDir: resolveRunsDir(config?.runsDir),
    maxRuns: positive(config?.maxRuns) ?? DEFAULTS.maxRuns,
    nodeTimeoutMs: positive(config?.nodeTimeoutMs) ?? DEFAULTS.nodeTimeoutMs,
    maxSteps: positive(config?.maxSteps) ?? DEFAULTS.maxSteps,
    maxNodeTextBytes: positive(config?.maxNodeTextBytes) ?? DEFAULTS.maxNodeTextBytes,
    maxAttachmentBytes: positive(config?.maxAttachmentBytes) ?? DEFAULTS.maxAttachmentBytes,
    maxAttachmentsPerNode:
      positive(config?.maxAttachmentsPerNode) ?? DEFAULTS.maxAttachmentsPerNode,
    maxNodeAttachmentsBytes:
      positive(config?.maxNodeAttachmentsBytes) ?? DEFAULTS.maxNodeAttachmentsBytes,
    maxInlineAttachmentBytes:
      positive(config?.maxInlineAttachmentBytes) ?? DEFAULTS.maxInlineAttachmentBytes,
    orchestratorPresets,
    robotPreset: robotPreset === '' ? DEFAULTS.robotPreset : robotPreset,
  }
}
/**
 * 解析 runs 目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/runs`。
 *
 * @param value 配置里的目录（支持 ~ 前缀）
 * @param env 环境变量
 * @returns 绝对路径
 */
export function resolveRunsDir(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return defaultRunsDir(env)
  if (text === '~') return path.join(homeDir(env), `.cache`, PLUGIN_CACHE_DIR, 'runs')
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.resolve(homeDir(env), text.slice(2))
  }
  return path.resolve(text)
}
/**
 * 默认运行目录。
 *
 * @param env 环境变量
 * @returns 默认 runs 目录
 */
export function defaultRunsDir(env: NodeJS.ProcessEnv = process.env): string {
  const cacheHome =
    typeof env.XDG_CACHE_HOME === 'string' && env.XDG_CACHE_HOME.trim() !== ''
      ? env.XDG_CACHE_HOME.trim()
      : path.join(homeDir(env), '.cache')
  return path.join(cacheHome, PLUGIN_CACHE_DIR, 'runs')
}
/**
 * @param env 环境变量
 * @returns 用户主目录
 */
function homeDir(env: NodeJS.ProcessEnv): string {
  const home = typeof env.HOME === 'string' ? env.HOME.trim() : ''
  return home === '' ? os.homedir() : home
}
/**
 * @param value 待校验的值
 * @returns 正整数或 undefined
 */
function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
