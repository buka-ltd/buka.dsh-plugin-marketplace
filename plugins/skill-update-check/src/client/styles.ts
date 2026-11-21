/**
 * 提示的样式。
 *
 * 这是输入框卡片下方统计行里的环境提示条：24px 高、12px 字号。颜色用
 * DSH 主题 token：有更新时是 `--dsw-alias-state-warn-primary`，检查失败时
 * 退到 `--dsw-alias-state-error-primary`。浅色 tint 用 `color-mix` 从同一个
 * token 派生，两种主题都跟着走。
 *
 * 统计行是 flex 容器：`activity` / `usage` 两个统计条目由插槽渲染，之后的
 * 「上下文已用」圆环由输入框自己追加。提示要排在这个圆环之后，而插槽只能
 * 决定条目之间的顺序，所以用 flex 的 `order` 把它放到所有默认项（含圆环）
 * 后面。圆环不在时效果同样成立：提示仍然在统计行最右端。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/styles
 */

/** 注入到 `document.head` 的样式表。 */
export const CSS = `.buka-skill-update-check-badge{order:1;align-items:center;gap:5px;height:24px;min-width:0;max-width:200px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border:none;border-radius:var(--dsw-radius-sm);padding:0 8px;font-size:12px;font-weight:600;line-height:18px;display:inline-flex}
@media (hover:hover){.buka-skill-update-check-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}}
.buka-skill-update-check-badge[data-state=error]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
@media (hover:hover){.buka-skill-update-check-badge[data-state=error]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}}
.buka-skill-update-check-badge[data-busy]{cursor:progress;opacity:.65}
.buka-skill-update-check-badge:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.buka-skill-update-check-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.buka-skill-update-check-errorMark{font-size:12px;font-weight:700;line-height:1}
`
