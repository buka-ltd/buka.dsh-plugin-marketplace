/**
 * 勾选框与会话标题标记的文案。
 *
 * 两处可见文字都是品牌名，不做翻译：勾选框是「Pen」（前面是 Pen 的 logo，见
 * `logo.ts`），会话标题旁是「Pen MCP」。只有 tooltip 的说明随 DSH 的界面
 * 语言切换。
 *
 * @module @buka/dsh-plugin-pen/client/dictionary
 */

/** 界面文案的命名空间；插槽的 `locale` 与 `ctx.locale.bind` 共用它。 */
export const NS = 'pen'

/** 勾选框文字：品牌名，不随界面语言变化。 */
export const LABEL = 'Pen'

/** 会话标题旁标记的文字：同样是不翻译的品牌名。 */
export const MARK_LABEL = 'Pen MCP'

/** 中文文案。 */
export const zh = {
  hint: '勾选后，这个会话会加载 Pen（pen.dev）的 MCP 工具；会话中随时可用 /pen 开启、/pen off 关闭。',
  hintPending: '会话开始后自动连接 Pen MCP。',
  hintConnecting: '正在连接 Pen MCP…',
  hintReady: '这个会话已加载 Pen MCP 工具（mcp__pencil__*）。',
  hintFailed: 'Pen MCP 连接失败：',
}

/** 文案键；英文词典必须覆盖同一组键。 */
export type PenKey = keyof typeof zh

/** 英文文案。 */
export const en: Record<PenKey, string> = {
  hint: 'When checked, this session loads the Pen (pen.dev) MCP tools. During a session, /pen enables them and /pen off disables them.',
  hintPending: 'Pen MCP connects when the session starts.',
  hintConnecting: 'Connecting to Pen MCP…',
  hintReady: 'This session has the Pen MCP tools (mcp__pencil__*).',
  hintFailed: 'Could not connect to Pen MCP: ',
}
