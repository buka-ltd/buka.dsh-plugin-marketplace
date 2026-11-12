/**
 * 插件配置与数据目录解析。
 *
 * v4 只有少量运行参数：数据目录（大文本 / 附件 / 迁移标记）、任务超时、
 * 轮询间隔、附件限额、编排 preset 与机器人会话 preset。作业 / 任务元数据
 * 进 `ctx.storageDomain`，不在这里配置。
 *
 * @module @buka/dsh-plugin-workflows/options
 */

import os from 'node:os'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'

/** 插件全局目录名。 */
const PLUGIN_CACHE_DIR = 'dsh-plugin-workflows'

/** 默认数据目录名。 */
const DEFAULTS = {
  /** 不设默认超时：任务耗时取决于模型速度与任务大小，硬截止容易误杀。 */
  taskTimeoutMs: 0,
  pollIntervalMs: 1500,
  maxAttachmentBytes: 8 * 1024 * 1024,
  maxAttachmentsPerTask: 20,
  maxTaskAttachmentsBytes: 64 * 1024 * 1024,
  maxInlineAttachmentBytes: 32 * 1024,
  maxResultTextBytes: 2 * 1024 * 1024,
  orchestratorPresets: ['workflow-orchestrator'],
  robotPreset: 'standard',
}

/** `Config` 解析后的形状。 */
export interface WorkflowsConfig {
  readonly dataDir: string
  readonly taskTimeoutMs: number
  readonly pollIntervalMs: number
  readonly maxAttachmentBytes: number
  readonly maxAttachmentsPerTask: number
  readonly maxTaskAttachmentsBytes: number
  readonly maxInlineAttachmentBytes: number
  readonly maxResultTextBytes: number
  readonly orchestratorPresets: string[]
  readonly robotPreset: string
}

/** 合并默认值之后的配置。 */
export interface ResolvedOptions {
  dataDir: string
  taskTimeoutMs: number
  pollIntervalMs: number
  maxAttachmentBytes: number
  maxAttachmentsPerTask: number
  maxTaskAttachmentsBytes: number
  maxInlineAttachmentBytes: number
  maxResultTextBytes: number
  orchestratorPresets: string[]
  robotPreset: string
}

/** 插件配置。 */
export const Config = z.object({
  dataDir: z
    .string()
    .default(defaultDataDir())
    .description(
      '插件数据目录：渲染后的 prompt、结果全文、作业附件与迁移标记。作业 / 任务元数据在 storageDomain 里。支持 ~ 前缀。',
    ),
  taskTimeoutMs: z
    .number()
    .step(1)
    .min(0)
    .default(DEFAULTS.taskTimeoutMs)
    .description('单个任务的默认硬超时（毫秒）；0 表示不超时。'),
  pollIntervalMs: z
    .number()
    .step(1)
    .min(100)
    .default(DEFAULTS.pollIntervalMs)
    .description('观察任务会话是否结束轮的轮询间隔（毫秒）。'),
  maxAttachmentBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxAttachmentBytes)
    .description('单个附件的字节上限。'),
  maxAttachmentsPerTask: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxAttachmentsPerTask)
    .description('一次任务完成最多提交的附件数量。'),
  maxTaskAttachmentsBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxTaskAttachmentsBytes)
    .description('一次任务完成的附件总量字节上限。'),
  maxInlineAttachmentBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxInlineAttachmentBytes)
    .description('可在 prompt 里内联的单个文本附件字节上限。'),
  maxResultTextBytes: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULTS.maxResultTextBytes)
    .description('写入作业目录的结果全文上限；超出部分截断并在记录里标注。'),
  orchestratorPresets: z
    .array(z.string())
    .default(DEFAULTS.orchestratorPresets)
    .description(
      '能保存 / 读取工作流定义的 agent preset 名单。留空表示不做收窄（所有会话可见）。推荐只保留随插件发布的 `workflow-orchestrator`。',
    ),
  robotPreset: z
    .string()
    .default(DEFAULTS.robotPreset)
    .description('机器人任务会话使用的 agent preset。'),
})

/**
 * 合并配置与默认值。
 *
 * @param config 插件配置（可能缺省）
 * @returns 合并后的配置
 */
export function resolveOptions(config: WorkflowsConfig | undefined): ResolvedOptions {
  const orchestratorPresets = Array.isArray(config?.orchestratorPresets)
    ? config.orchestratorPresets
        .map((preset) => String(preset).trim())
        .filter((preset) => preset !== '')
    : DEFAULTS.orchestratorPresets
  const robotPreset = typeof config?.robotPreset === 'string' ? config.robotPreset.trim() : ''
  return {
    dataDir: resolveDataDir(config?.dataDir),
    taskTimeoutMs: nonNegative(config?.taskTimeoutMs) ?? DEFAULTS.taskTimeoutMs,
    pollIntervalMs: positive(config?.pollIntervalMs) ?? DEFAULTS.pollIntervalMs,
    maxAttachmentBytes: positive(config?.maxAttachmentBytes) ?? DEFAULTS.maxAttachmentBytes,
    maxAttachmentsPerTask:
      positive(config?.maxAttachmentsPerTask) ?? DEFAULTS.maxAttachmentsPerTask,
    maxTaskAttachmentsBytes:
      positive(config?.maxTaskAttachmentsBytes) ?? DEFAULTS.maxTaskAttachmentsBytes,
    maxInlineAttachmentBytes:
      positive(config?.maxInlineAttachmentBytes) ?? DEFAULTS.maxInlineAttachmentBytes,
    maxResultTextBytes: positive(config?.maxResultTextBytes) ?? DEFAULTS.maxResultTextBytes,
    orchestratorPresets,
    robotPreset: robotPreset === '' ? DEFAULTS.robotPreset : robotPreset,
  }
}

/**
 * 解析数据目录：默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows`。
 *
 * @param value 配置里的目录（支持 ~ 前缀）
 * @param env 环境变量
 * @returns 绝对路径
 */
export function resolveDataDir(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return defaultDataDir(env)
  if (text === '~') return path.join(homeDir(env), '.cache', PLUGIN_CACHE_DIR)
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.resolve(homeDir(env), text.slice(2))
  }
  return path.resolve(text)
}

/**
 * 默认数据目录。
 *
 * @param env 环境变量
 * @returns 默认数据目录
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const cacheHome =
    typeof env.XDG_CACHE_HOME === 'string' && env.XDG_CACHE_HOME.trim() !== ''
      ? env.XDG_CACHE_HOME.trim()
      : path.join(homeDir(env), '.cache')
  return path.join(cacheHome, PLUGIN_CACHE_DIR)
}

/**
 * 用户主目录。
 *
 * @param env 环境变量
 * @returns 主目录
 */
function homeDir(env: NodeJS.ProcessEnv): string {
  const home = typeof env.HOME === 'string' ? env.HOME.trim() : ''
  return home === '' ? os.homedir() : home
}

/**
 * 正整数字段或默认值。
 *
 * @param value 待校验的值
 * @returns 正整数或 undefined
 */
function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * 非负整数字段或默认值。
 *
 * @param value 待校验的值
 * @returns 非负整数或 undefined
 */
function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
