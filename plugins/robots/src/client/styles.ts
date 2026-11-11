/**
 * 「机器人」页面的样式。
 *
 * 结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片列表），颜色与
 * 尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
 *
 * @module @buka/dsh-plugin-robots/client/styles
 */

/**
 * 页面样式：结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片
 * 列表），颜色与尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
 */
export const CSS = `
.buka-robots-page{--buka-robots-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-robots-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden auto;overscroll-behavior:contain}
@media (width<=767px){.buka-robots-page{--buka-robots-inset:20px}}
.buka-robots-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-robots-inset));max-width:none;margin-inline:calc(-1 * var(--buka-robots-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-robots-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-robots-headInner{width:100%;max-width:960px;margin-inline:auto;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px}
.buka-robots-heading{order:1;flex:1 1 auto;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:6px}
.buka-robots-title{margin:0;font-size:20px;font-weight:500;line-height:28px;overflow-wrap:anywhere}
.buka-robots-toolbar{order:2;display:flex;align-items:center;gap:8px}
.buka-robots-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:32px 0 48px}
.buka-robots-pageBody{display:flex;flex-direction:column;gap:24px}
.buka-robots-detail{display:flex;flex-direction:column;gap:32px;flex:1 1 auto;min-height:0}
.buka-robots-status,.buka-robots-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-robots-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-robots-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;margin:0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.buka-robots-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}
.buka-robots-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-robots-alert{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex;flex-direction:column}
.buka-robots-alertHead{display:flex;align-items:flex-start;gap:8px}
.buka-robots-alertHead>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-robots-output{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;width:100%;box-sizing:border-box}
.buka-robots-outputLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:2px}
.buka-robots-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;margin:0 2px;overflow-wrap:anywhere;word-break:break-all}
.buka-robots-back svg{transform:rotate(180deg)}
.buka-robots-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-robots-card{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px}
.buka-robots-card.is-clickable{cursor:pointer}
@media (hover:hover){.buka-robots-card.is-clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-card.is-clickable:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-robots-cardHead{flex-direction:column;gap:6px;padding:8px;display:flex}
.buka-robots-titleRow{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}
.buka-robots-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
.buka-robots-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap;justify-content:flex-end}
.buka-robots-cardTitle{box-sizing:border-box;min-width:0;max-width:100%;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:14px;font-weight:500;line-height:20px;text-align:left;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.buka-robots-cardTitle:disabled{cursor:default}
.buka-robots-cardTitle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm)}
.buka-robots-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-robots-avatarButton{padding:0;margin:0;border:0;background:0 0;line-height:0;cursor:pointer}
@media (hover:hover){.buka-robots-avatarButton:hover{filter:brightness(.97)}}
.buka-robots-avatarButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-robots-avatarField{display:flex;flex-direction:column;gap:8px}
.buka-robots-avatarGrid{display:grid;grid-template-columns:repeat(8,40px);gap:8px;justify-content:start}
@media (width<=480px){.buka-robots-avatarGrid{grid-template-columns:repeat(4,40px)}}
.buka-robots-avatarOption{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer}
@media (hover:hover){.buka-robots-avatarOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-avatarOption.is-selected{border-color:var(--dsw-alias-brand-primary);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-robots-avatarOption:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-robots-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;padding-left:34px}
.buka-robots-workspaces{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0 -4px;padding:0}
.buka-robots-workspace{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:12px;padding:8px 10px;margin:0;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
@media (hover:hover){.buka-robots-workspace:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-workspace:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-workspace:disabled{cursor:default;opacity:.72}
.buka-robots-workspace>svg{flex:none;color:var(--dsw-alias-label-caption)}
.buka-robots-workspaceText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-robots-workspaceTitle{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-robots-workspacePath{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-robots-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:2px 0}
.buka-robots-settingText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.buka-robots-settingHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.buka-robots-settingTitle{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.buka-robots-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
.buka-robots-switch.is-on{background:var(--dsw-alias-brand-primary)}
.buka-robots-switch:disabled{cursor:default;opacity:.6}
.buka-robots-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-robots-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
.buka-robots-switch.is-on .buka-robots-switchThumb{transform:translateX(16px)}
@media (prefers-reduced-motion:reduce){.buka-robots-switch,.buka-robots-switchThumb{transition:none}}
.buka-robots-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.buka-robots-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
@media (hover:hover){.buka-robots-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-robots-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-robots-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-sourceRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.buka-robots-input{flex:1 1 260px;display:flex;min-width:0}
.buka-robots-submit,.buka-robots-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-robots-dialogForm{display:flex;flex-direction:column;gap:16px}
.buka-robots-field{display:flex;flex-direction:column;gap:6px}
.buka-robots-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.buka-robots-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
.buka-robots-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.buka-robots-section{display:flex;flex-direction:column;gap:12px}
.buka-robots-agentsSection{flex:1 1 auto;min-height:0}
.buka-robots-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.buka-robots-sectionTitle{margin:0;font-size:15px;font-weight:600;line-height:22px}
.buka-robots-skillList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-robots-skillRow{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:var(--dsw-radius-md);padding:8px 8px;margin:0 -8px}
.buka-robots-skillHead{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.buka-robots-skillName{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.buka-robots-skillActions{flex:none;margin-left:auto;align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap}
.buka-robots-skillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
.buka-robots-textarea{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:260px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:20px;padding:10px 12px;tab-size:2}
.buka-robots-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.buka-robots-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-textarea:disabled{opacity:.65}
.buka-robots-headingRow{display:flex;align-items:center;gap:6px;min-width:0}
.buka-robots-headingRow .buka-robots-title{flex:0 1 auto;min-width:0}
.buka-robots-headingTag{flex:none;display:inline-flex;align-items:center;margin-left:2px}
.buka-robots-descriptionInput{box-sizing:border-box;width:100%;min-height:60px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;tab-size:2}
.buka-robots-descriptionInput.is-tall{min-height:140px}
.buka-robots-descriptionInput::placeholder{color:var(--dsw-alias-label-caption)}
.buka-robots-descriptionInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-robots-descriptionInput:disabled{opacity:.65}
.buka-robots-backButton{flex:none;margin-left:-4px}
.buka-robots-tabs{flex:100%;order:3;display:flex}
.buka-robots-tabList{width:fit-content;min-width:240px}
@media (width<=372px){.buka-robots-tabList{min-width:0}}
.buka-robots-panel{display:flex;flex-direction:column;gap:24px;flex:1 1 auto;min-height:0}
.buka-robots-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-robots-candidatesHead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.buka-robots-candidates{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0;padding:4px;list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.buka-robots-candidate{display:flex;align-items:flex-start;gap:10px;padding:7px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}
@media (hover:hover){.buka-robots-candidate:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-robots-candidate.isDisabled{cursor:not-allowed;opacity:.62}
.buka-robots-candidateInput{flex:none;margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary)}
.buka-robots-candidateText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-robots-candidateName{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-robots-candidateDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-robots-candidateTag{flex:none;margin-left:auto;padding-left:8px;display:inline-flex;align-items:center}
.buka-robots-favorites{display:flex;flex-wrap:wrap;gap:8px}
.buka-robots-selectAll{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
`
