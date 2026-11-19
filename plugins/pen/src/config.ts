/**
 * 插件配置：pen（pencil）MCP 服务怎么启动。
 *
 * 这些字段对应 DSH 里一条 `@deepseek-ai/dsh-mcp-client` 条目；默认值就是
 * pen.dev 桌面版捆绑的 stdio 服务。命令路径随安装位置变化，在插件设置里
 * 覆盖即可。
 *
 * @module @buka/dsh-plugin-pen/config
 */

import z from '@deepseek-ai/schemastery'

/**
 * pen.dev 桌面版在 macOS 上捆绑的 MCP 服务；App 装在别处时改 `command`。
 */
export const DEFAULT_COMMAND =
  '/Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64'

/** 桌面版要求的启动参数。 */
export const DEFAULT_ARGS: readonly string[] = ['--app', 'desktop']

/** 工具的模型侧命名空间：`mcp__pencil__<tool>`。 */
export const DEFAULT_SERVER_NAME = 'pencil'

/** 插件配置：只在需要时启动 pen MCP。 */
export const Config = z.object({
  /** MCP 服务名；决定工具名前缀 `mcp__<serverName>__`。 */
  serverName: z
    .string()
    .pattern(/^[A-Za-z0-9_-]{1,32}$/)
    .default(DEFAULT_SERVER_NAME),
  /** stdio 可执行文件。 */
  command: z.string().min(1).default(DEFAULT_COMMAND),
  /** 传给可执行文件的参数。 */
  args: z.array(z.string()).default([...DEFAULT_ARGS]),
  /** 额外环境变量，合并到 DSH 清洗过的环境上。 */
  env: z.dict(z.string()).default({}),
  /** 子进程工作目录；空字符串表示继承 Host。 */
  cwd: z.string().default(''),
  /** 单次工具调用超时（毫秒）。 */
  toolCallTimeoutMs: z.number().min(1).default(60_000),
  /** 首次连接 + 拉取工具列表的预算（毫秒）；勾选后的首轮消息会等它。 */
  startupTimeoutMs: z.number().min(1).default(20_000),
})

/** Host 解析后的配置形状；只读，插件不改写。 */
export interface PenConfig {
  readonly serverName: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly toolCallTimeoutMs: number
  readonly startupTimeoutMs: number
}
