/**
 * 提示的样式。
 *
 * 高度、字号与圆角对齐输入框工具栏里的其它紧凑控件（26px 左右），颜色用
 * DSH 主题 token：有更新时是 `--dsw-alias-state-warn-primary`，检查失败时
 * 退到 `--dsw-alias-state-error-primary`。浅色 tint 用 `color-mix` 从同一个
 * token 派生，两种主题都跟着走。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/styles
 */

/** 注入到 `document.head` 的样式表。 */
export const CSS = `.buka-skill-update-check-badge{align-items:center;gap:5px;height:24px;min-width:0;max-width:200px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border:none;border-radius:var(--dsw-radius-sm);padding:0 8px;font-size:12px;font-weight:600;line-height:18px;display:inline-flex}
@media (hover:hover){.buka-skill-update-check-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}}
.buka-skill-update-check-badge[data-state=error]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
@media (hover:hover){.buka-skill-update-check-badge[data-state=error]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}}
.buka-skill-update-check-badge[data-busy]{cursor:progress;opacity:.65}
.buka-skill-update-check-badge:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.buka-skill-update-check-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.buka-skill-update-check-errorMark{font-size:12px;font-weight:700;line-height:1}
`
