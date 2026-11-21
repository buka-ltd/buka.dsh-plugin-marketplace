/**
 * 提示与更新弹窗的样式。
 *
 * 提示是输入框卡片下方统计行里的环境提示条：24px 高、12px 字号。颜色用
 * DSH 主题 token：有更新时是 `--dsw-alias-state-warn-primary`，检查失败时
 * 退到 `--dsw-alias-state-error-primary`。浅色 tint 用 `color-mix` 从同一个
 * token 派生，两种主题都跟着走。
 *
 * 统计行是 flex 容器：`activity` / `usage` 两个统计条目由插槽渲染，之后的
 * 「上下文已用」圆环由输入框自己追加。提示要排在这个圆环之后，而插槽只能
 * 决定条目之间的顺序，所以用 flex 的 `order` 把它放到所有默认项（含圆环）
 * 后面。圆环不在时效果同样成立：提示仍然在统计行最右端。
 *
 * 弹窗复用 `Modal` 的标题 / 遮罩 / 页脚布局，这里只排内容：一行一个过期
 * skill，名字在左、按钮在右；空状态居中。颜色与圆角只用主题 token。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/styles
 */

/** 注入到 `document.head` 的样式表。 */
export const CSS = `.buka-skill-update-check-badge{order:1;align-items:center;gap:5px;height:24px;min-width:0;max-width:200px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border:none;border-radius:var(--dsw-radius-sm);padding:0 8px;font-size:12px;font-weight:600;line-height:18px;display:inline-flex}
@media (hover:hover){.buka-skill-update-check-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}}
.buka-skill-update-check-badge[data-state=error]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
@media (hover:hover){.buka-skill-update-check-badge[data-state=error]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}}
.buka-skill-update-check-badge[data-state=done]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
@media (hover:hover){.buka-skill-update-check-badge[data-state=done]:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent)}}
.buka-skill-update-check-badge:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.buka-skill-update-check-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.buka-skill-update-check-errorMark{font-size:12px;font-weight:700;line-height:1}
.buka-skill-update-check-modal{max-height:100%}
.buka-skill-update-check-modalContent{min-height:0;overflow:auto}
.buka-skill-update-check-dialog{box-sizing:border-box;width:100%;min-width:0;flex-direction:column;gap:10px;display:flex}
.buka-skill-update-check-status{color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;margin:0;font-size:13px;line-height:20px;display:flex}
.buka-skill-update-check-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.buka-skill-update-check-notice{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;margin:0;font-size:13px;line-height:20px;display:flex}
.buka-skill-update-check-failure{color:var(--dsw-alias-state-error-primary);align-items:flex-start;gap:6px;margin:0;font-size:13px;line-height:20px;display:flex;overflow-wrap:anywhere}
.buka-skill-update-check-failure>:first-child{flex:none;margin-top:3px}
.buka-skill-update-check-list{flex-direction:column;gap:2px;max-height:320px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}
.buka-skill-update-check-row{border-radius:var(--dsw-radius-md);align-items:center;gap:12px;min-height:40px;padding:4px 8px;display:flex}
@media (hover:hover){.buka-skill-update-check-row:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-skill-update-check-rowMain{flex:1 1 auto;min-width:0;flex-direction:column;gap:1px;display:flex}
.buka-skill-update-check-name{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:hidden}
.buka-skill-update-check-source{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;overflow:hidden}
.buka-skill-update-check-rowStatus{flex:none;color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;font-size:12px;line-height:18px;display:inline-flex}
.buka-skill-update-check-empty{flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:40px 16px;text-align:center;display:flex}
.buka-skill-update-check-emptyIcon{color:var(--dsw-alias-state-success-primary);display:inline-flex}
.buka-skill-update-check-emptyIconNeutral{color:var(--dsw-alias-label-tertiary);display:inline-flex}
.buka-skill-update-check-emptyTitle{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:500;line-height:20px}
.buka-skill-update-check-emptyHint{margin:0;max-width:40ch;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-wrap:balance}
.buka-skill-update-check-modified{color:var(--dsw-alias-state-warn-primary);align-items:center;gap:6px;margin:0;font-size:12px;line-height:18px;display:flex;overflow-wrap:anywhere}
`
