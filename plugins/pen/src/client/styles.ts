/**
 * 勾选框与标题标记的样式。
 *
 * 勾选框的尺寸、颜色与 hover / focus 行为照抄 DSH 新会话行的官方 worktree
 * 勾选框（13px / 28px 高、14px 复选框、`--dsw-*` 主题变量），保证两种配色下
 * 都跟旁边的控件对齐。标题标记照抄会话标题行里的次级信息（12px、第三级文字
 * 颜色、4px 图标间距），和标题、官方动作按钮排在同一行。
 *
 * @module @buka/dsh-plugin-pen/client/styles
 */

/** 注入到 `document.head` 的样式表。 */
export const CSS = `.buka-pen-root{flex:none;align-items:center;gap:2px;min-width:0;display:inline-flex}
.buka-pen-toggle{border-radius:var(--dsw-radius-sm);min-width:0;height:28px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
@media (hover:hover){.buka-pen-toggle:hover:not([data-disabled]){background:var(--dsw-alias-interactive-bg-hover)}}
.buka-pen-toggle[data-disabled]{color:var(--dsw-alias-label-dimmed);cursor:default}
.buka-pen-brand{align-items:center;gap:4px;min-width:0;display:inline-flex}
.buka-pen-logo{width:12px;height:auto;flex:none;display:block;object-fit:contain}
.buka-pen-toggle:has(.buka-pen-checkbox:focus-visible){outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-pen-checkbox{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:inherit;flex:none;margin:0}
.buka-pen-checkbox:focus-visible{outline:none}
.buka-pen-warning{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:700;line-height:1}
.buka-pen-mark{flex:none;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px;font-weight:500;line-height:18px;display:inline-flex}
.buka-pen-mark-icon{flex:none;display:block}
`
