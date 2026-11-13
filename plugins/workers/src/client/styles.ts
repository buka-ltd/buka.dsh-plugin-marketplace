/**
 * 「打工人」页面的样式。
 *
 * 结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片列表），颜色与
 * 尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
 *
 * @module @buka/dsh-plugin-workers/client/styles
 */

/**
 * 页面样式：结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片
 * 列表），颜色与尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
 */
export const CSS = `
.buka-workers-page{--buka-workers-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workers-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden auto;overscroll-behavior:contain}
@media (width<=767px){.buka-workers-page{--buka-workers-inset:20px}}
.buka-workers-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workers-inset));max-width:none;margin-inline:calc(-1 * var(--buka-workers-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workers-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-workers-headInner{width:100%;max-width:960px;margin-inline:auto;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px}
.buka-workers-heading{order:1;flex:1 1 auto;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:6px}
.buka-workers-title{margin:0;font-size:20px;font-weight:500;line-height:28px;overflow-wrap:anywhere}
.buka-workers-toolbar{order:2;display:flex;align-items:center;gap:8px}
.buka-workers-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:32px 0 48px}
.buka-workers-pageBody{display:flex;flex-direction:column;gap:24px}
.buka-workers-detail{display:flex;flex-direction:column;gap:32px;flex:1 1 auto;min-height:0}
.buka-workers-status,.buka-workers-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-workers-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-workers-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;margin:0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.buka-workers-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}
.buka-workers-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-workers-alert{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex;flex-direction:column}
.buka-workers-alertHead{display:flex;align-items:flex-start;gap:8px}
.buka-workers-alertHead>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-workers-output{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;width:100%;box-sizing:border-box}
.buka-workers-outputLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:2px}
.buka-workers-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workers-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workers-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;margin:0 2px;overflow-wrap:anywhere;word-break:break-all}
.buka-workers-back svg{transform:rotate(180deg)}
.buka-workers-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-workers-card{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px}
.buka-workers-card.is-clickable{cursor:pointer}
@media (hover:hover){.buka-workers-card.is-clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-card.is-clickable:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workers-cardHead{flex-direction:column;gap:6px;padding:8px;display:flex}
.buka-workers-titleRow{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}
.buka-workers-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
.buka-workers-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap;justify-content:flex-end}
.buka-workers-cardTitle{box-sizing:border-box;min-width:0;max-width:100%;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:14px;font-weight:500;line-height:20px;text-align:left;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.buka-workers-cardTitle:disabled{cursor:default}
.buka-workers-cardTitle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm)}
.buka-workers-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workers-avatarButton{padding:0;margin:0;border:0;background:0 0;line-height:0;cursor:pointer}
@media (hover:hover){.buka-workers-avatarButton:hover{filter:brightness(.97)}}
.buka-workers-avatarButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-workers-avatarField{display:flex;flex-direction:column;gap:8px}
.buka-workers-avatarGrid{display:grid;grid-template-columns:repeat(8,40px);gap:8px;justify-content:start}
@media (width<=480px){.buka-workers-avatarGrid{grid-template-columns:repeat(4,40px)}}
.buka-workers-avatarOption{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer}
@media (hover:hover){.buka-workers-avatarOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-avatarOption.is-selected{border-color:var(--dsw-alias-brand-primary);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workers-avatarOption:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-workers-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;padding-left:34px}
.buka-workers-workspaces{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0 -4px;padding:0}
.buka-workers-workspace{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:12px;padding:8px 10px;margin:0;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
@media (hover:hover){.buka-workers-workspace:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-workspace:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-workspace:disabled{cursor:default;opacity:.72}
.buka-workers-workspace>svg{flex:none;color:var(--dsw-alias-label-caption)}
.buka-workers-workspaceText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-workers-workspaceTitle{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-workers-workspacePath{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-workers-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:2px 0}
.buka-workers-settingText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.buka-workers-settingHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.buka-workers-settingTitle{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.buka-workers-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workers-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
.buka-workers-switch.is-on{background:var(--dsw-alias-brand-primary)}
.buka-workers-switch:disabled{cursor:default;opacity:.6}
.buka-workers-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-workers-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
.buka-workers-switch.is-on .buka-workers-switchThumb{transform:translateX(16px)}
@media (prefers-reduced-motion:reduce){.buka-workers-switch,.buka-workers-switchThumb{transition:none}}
.buka-workers-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workers-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.buka-workers-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
@media (hover:hover){.buka-workers-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workers-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workers-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-sourceRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.buka-workers-input{flex:1 1 260px;display:flex;min-width:0}
.buka-workers-submit,.buka-workers-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-workers-dialogForm{display:flex;flex-direction:column;gap:16px}
.buka-workers-field{display:flex;flex-direction:column;gap:6px}
.buka-workers-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.buka-workers-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
.buka-workers-select{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0 8px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.buka-workers-select:disabled{opacity:.6}
.buka-workers-modelSection{display:flex;flex-direction:column;gap:16px}
.buka-workers-formActions{display:flex;align-items:center;gap:8px}
.buka-workers-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.buka-workers-section{display:flex;flex-direction:column;gap:12px}
.buka-workers-agentsSection{flex:1 1 auto;min-height:0}
.buka-workers-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.buka-workers-sectionTitle{margin:0;font-size:15px;font-weight:600;line-height:22px}
.buka-workers-skillList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-workers-skillRow{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:var(--dsw-radius-md);padding:8px 8px;margin:0 -8px}
.buka-workers-skillHead{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.buka-workers-skillName{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.buka-workers-skillActions{flex:none;margin-left:auto;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap}
.buka-workers-skillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
.buka-workers-textarea{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:260px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:20px;padding:10px 12px;tab-size:2}
.buka-workers-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.buka-workers-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-textarea:disabled{opacity:.65}
.buka-workers-headingRow{display:flex;align-items:center;gap:6px;min-width:0}
.buka-workers-headingRow .buka-workers-title{flex:0 1 auto;min-width:0}
.buka-workers-headingTag{flex:none;display:inline-flex;align-items:center;margin-left:2px}
.buka-workers-descriptionInput{box-sizing:border-box;width:100%;min-height:60px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;tab-size:2}
.buka-workers-descriptionInput.is-tall{min-height:140px}
.buka-workers-descriptionInput::placeholder{color:var(--dsw-alias-label-caption)}
.buka-workers-descriptionInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-descriptionInput:disabled{opacity:.65}
.buka-workers-backButton{flex:none;margin-left:-4px}
.buka-workers-tabs{flex:100%;order:3;display:flex}
.buka-workers-tabList{width:fit-content;min-width:240px}
@media (width<=372px){.buka-workers-tabList{min-width:0}}
.buka-workers-panel{display:flex;flex-direction:column;gap:24px;flex:1 1 auto;min-height:0}
.buka-workers-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workers-candidatesHead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.buka-workers-candidates{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0;padding:4px;list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.buka-workers-candidate{display:flex;align-items:flex-start;gap:10px;padding:7px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}
@media (hover:hover){.buka-workers-candidate:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-candidate.isDisabled{cursor:not-allowed;opacity:.62}
.buka-workers-candidateInput{flex:none;margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary)}
.buka-workers-candidateText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-workers-candidateName{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workers-candidateDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workers-candidateTag{flex:none;margin-left:auto;padding-left:8px;display:inline-flex;align-items:center}
.buka-workers-favorites{display:flex;flex-wrap:wrap;gap:8px}
.buka-workers-selectAll{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
`
