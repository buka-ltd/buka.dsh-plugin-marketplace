/**
 * 页面样式常量。
 *
 * @module @buka/dsh-plugin-bell/client/styles
 */

/** 页面样式：只用主题 token，类名带插件前缀，避免影响其他页面。 */
export const CSS = `
.buka-bell-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.buka-bell-heading{margin:0;font-size:18px;font-weight:600}
.buka-bell-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.buka-bell-rows{display:flex;flex-direction:column;margin-top:4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.buka-bell-row{display:flex;align-items:center;gap:16px;width:100%;padding:16px 4px;border:0;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.buka-bell-row:hover:not(:disabled){background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
.buka-bell-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.buka-bell-row:disabled{opacity:.55;cursor:default}
.buka-bell-label{flex:1;min-width:0;font-size:14px;line-height:20px}
.buka-bell-rowValue{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-secondary)}
.buka-bell-rowChevron{flex:none;font-size:15px;line-height:1;color:var(--dsw-alias-label-secondary)}
.buka-bell-back{align-self:flex-start;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.buka-bell-back:hover{text-decoration:underline}
.buka-bell-back:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-bell-soundList{display:flex;flex-direction:column;margin-top:4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.buka-bell-soundRow{display:flex;align-items:center;gap:10px;width:100%;padding:11px 4px;border-bottom:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
.buka-bell-soundRow:hover{background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
.buka-bell-soundRow[data-checked='true']{color:var(--dsw-alias-brand-primary)}
.buka-bell-soundRow[data-disabled='true']{opacity:.55;cursor:default}
.buka-bell-radio{appearance:none;-webkit-appearance:none;box-sizing:border-box;display:grid;place-content:center;flex:none;width:14px;height:14px;margin:0;border:1px solid var(--dsw-alias-border-l4);border-radius:50%;background-color:var(--dsw-alias-bg-layer-1);cursor:pointer}
.buka-bell-radio::before{content:'';width:6px;height:6px;border-radius:50%;background-color:var(--dsw-alias-brand-primary);transform:scale(0);transition:transform .12s ease}
.buka-bell-radio:checked{border-color:var(--dsw-alias-brand-primary)}
.buka-bell-radio:checked::before{transform:scale(1)}
.buka-bell-radio:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-bell-radio:disabled{cursor:default}
.buka-bell-soundName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.buka-bell-muted{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.buka-bell-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
`
