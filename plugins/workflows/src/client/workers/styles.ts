/**
 * 「执行者」页面的样式。
 *
 * 结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片列表），颜色与
 * 尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
 *
 * 列表条目（`.buka-workers-card`）的背景只在内容列内，不再用负 margin 外扩：
 * 页面是滚动容器且 `overflow-x:hidden`，外扩部分会被裁掉，滚动条出现 / 消失
 * 时右侧还会跟着抖；滚动容器统一 `scrollbar-gutter:stable` 预留槽位。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/styles
 */

/**
 * 页面样式：结构与 Skills / Plugins 页面一致（标题行、960px 内容区、卡片
 * 列表），颜色与尺寸只用主题 token 和 DSH 的圆角 / 焦点 token。
 */
export const CSS = `
.buka-workers-page{box-sizing:border-box;flex:1 1 auto;min-height:0;width:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}
.buka-workers-head{box-sizing:border-box;flex:none;padding:calc(var(--buka-space-5, 24px) + var(--dsh-frame-top-clearance,0px)) 0 0;background:var(--dsw-alias-bg-base);z-index:2;position:sticky;top:0}
.buka-workers-headInner{width:100%;display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
.buka-workers-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-4, 16px);min-height:var(--buka-control-sm, 28px)}
.buka-workers-barTabs{display:flex;align-items:center;min-width:0;flex:1 1 auto}
.buka-workers-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workers-head .buka-workers-titleRow{align-items:center;gap:var(--buka-space-3, 12px) var(--buka-space-4, 16px)}
.buka-workers-heading{flex:1 1 auto;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
.buka-workers-title{margin:0;font-size:var(--buka-text-page, 20px);font-weight:500;line-height:var(--buka-line-28, 28px);overflow-wrap:anywhere}
.buka-workers-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:var(--buka-space-2, 8px);flex:none;flex-wrap:wrap;min-width:0}
.buka-workers-openAnchor{display:inline-flex;min-width:0}
.buka-workers-openSplit{display:inline-flex;align-items:stretch;min-width:0}
.buka-workers-openSplit .buka-workers-openMain{border-top-right-radius:0;border-bottom-right-radius:0}
.buka-workers-openMore{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;margin:0;padding:0 var(--buka-space-1, 4px);border:0.5px solid var(--dsw-alias-border-l4);border-left:0;border-radius:0 var(--dsw-radius-md) var(--dsw-radius-md) 0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}
@media (hover:hover){.buka-workers-openMore:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.buka-workers-openMore:disabled{cursor:default;opacity:.6}
.buka-workers-openMore:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:calc(-1 * var(--dsw-focus-ring-width))}
.buka-workers-appIcon{flex:none;border-radius:3px;object-fit:contain}
.buka-workers-body{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:var(--buka-space-5, 24px) 0 var(--buka-space-7, 48px)}
.buka-workers-pageBody{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px)}
.buka-workers-detail{display:flex;flex-direction:column;gap:var(--buka-space-6, 32px);flex:1 1 auto;min-height:0}
.buka-workers-status,.buka-workers-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workers-statusWithDot{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workers-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:var(--buka-space-3, 12px);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);display:flex;flex-wrap:wrap}
.buka-workers-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:var(--buka-space-2, 8px);margin:0;padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);display:flex}
.buka-workers-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-workers-alert{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:var(--buka-space-2, 8px);margin:0;padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);display:flex;flex-direction:column}
.buka-workers-alertHead{display:flex;align-items:flex-start;gap:var(--buka-space-2, 8px)}
.buka-workers-alertHead>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-workers-output{margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;width:100%;box-sizing:border-box}
.buka-workers-outputLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);margin-top:2px}
.buka-workers-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workers-inlineCode{font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px var(--buka-space-1, 4px);margin:0 2px;overflow-wrap:anywhere;word-break:break-all}
.buka-workers-back svg{transform:rotate(180deg)}
.buka-workers-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-workers-card{border-radius:var(--dsw-radius-md);min-width:0;margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px)}
.buka-workers-card.is-clickable{cursor:pointer}
@media (hover:hover){.buka-workers-card.is-clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-card.is-clickable:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workers-cardHead{flex-direction:column;gap:var(--buka-space-1, 4px);padding:0;display:flex}
.buka-workers-cardHead .buka-workers-titleRow{align-items:center}
.buka-workers-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;display:flex}
.buka-workers-titleActions{flex:none;align-items:center;gap:var(--buka-space-2, 8px);display:inline-flex;flex-wrap:wrap;justify-content:flex-end}
.buka-workers-cardTitle{box-sizing:border-box;min-width:0;max-width:100%;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:var(--buka-text-title, 14px);font-weight:500;line-height:var(--buka-line-20, 20px);text-align:left;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.buka-workers-cardTitle:disabled{cursor:default}
.buka-workers-cardTitle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm)}
.buka-workers-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workers-avatarButton{padding:0;margin:0;border:0;background:0 0;line-height:0;cursor:pointer}
@media (hover:hover){.buka-workers-avatarButton:hover{filter:brightness(.97)}}
.buka-workers-avatarButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-workers-avatarField{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
.buka-workers-avatarGrid{display:grid;grid-template-columns:repeat(8,40px);gap:var(--buka-space-2, 8px);justify-content:start}
@media (width<=480px){.buka-workers-avatarGrid{grid-template-columns:repeat(4,40px)}}
.buka-workers-avatarOption{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer}
@media (hover:hover){.buka-workers-avatarOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-avatarOption.is-selected{border-color:var(--dsw-alias-brand-primary);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workers-avatarOption:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-workers-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-18, 18px);display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;padding-left:34px}
.buka-workers-cardDesc.is-empty{color:var(--dsw-alias-label-caption)}
.buka-workers-workspaces{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0 calc(-1 * var(--buka-space-1, 4px));padding:0}
.buka-workers-workspace{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:var(--buka-space-3, 12px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);margin:0;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
@media (hover:hover){.buka-workers-workspace:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-workspace:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-workspace:disabled{cursor:default;opacity:.72}
.buka-workers-workspace>svg{flex:none;color:var(--dsw-alias-label-caption)}
.buka-workers-workspaceText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-workers-workspaceTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-workers-workspacePath{font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.buka-workers-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--buka-space-4, 16px);padding:2px 0}
.buka-workers-settingText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:var(--buka-space-1, 4px)}
.buka-workers-settingHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workers-settingTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);font-weight:500;color:var(--dsw-alias-label-primary)}
.buka-workers-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workers-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
.buka-workers-switch.is-on{background:var(--dsw-alias-brand-primary)}
.buka-workers-switch:disabled{cursor:default;opacity:.6}
.buka-workers-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-workers-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
.buka-workers-switch.is-on .buka-workers-switchThumb{transform:translateX(16px)}
@media (prefers-reduced-motion:reduce){.buka-workers-switch,.buka-workers-switchThumb{transition:none}}
.buka-workers-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workers-card .buka-workers-hint{padding-left:34px}
.buka-workers-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.buka-workers-iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex;padding:0}
@media (hover:hover){.buka-workers-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workers-iconButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workers-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 var(--buka-space-3, 12px);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workers-dialogForm{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
.buka-workers-field{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
.buka-workers-fieldLabel{color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);font-weight:500;line-height:var(--buka-line-20, 20px)}
.buka-workers-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
.buka-workers-select{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0 var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workers-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.buka-workers-select:disabled{opacity:.6}
.buka-workers-modelSection{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
.buka-workers-formActions{display:flex;align-items:center;gap:var(--buka-space-2, 8px)}
.buka-workers-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workers-section{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
.buka-workers-agentsSection{flex:1 1 auto;min-height:0}
.buka-workers-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-3, 12px);flex-wrap:wrap}
.buka-workers-autosave{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);min-height:18px;text-align:right}
.buka-workers-sectionActions{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workers-sectionTitle{margin:0;font-size:var(--buka-text-section, 15px);font-weight:600;line-height:var(--buka-line-22, 22px)}
.buka-workers-skillList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-workers-skillRow{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:var(--dsw-radius-md);padding:var(--buka-space-2, 8px) var(--buka-space-2, 8px);margin:0 calc(-1 * var(--buka-space-2, 8px))}
.buka-workers-skillHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
.buka-workers-skillSource{max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis}
.buka-workers-skillName{font-family:var(--ds-font-family-code);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.buka-workers-skillActions{flex:none;margin-left:auto;align-items:center;gap:var(--buka-space-2, 8px);display:inline-flex;flex-wrap:wrap}
.buka-workers-skillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
.buka-workers-headingRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workers-headingRow .buka-workers-title{flex:0 1 auto;min-width:0}
.buka-workers-headingTag{flex:none;display:inline-flex;align-items:center;margin-left:2px}
.buka-workers-descriptionInput{box-sizing:border-box;width:100%;min-height:60px;resize:vertical;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);tab-size:2}
.buka-workers-descriptionInput.is-tall{min-height:140px}
.buka-workers-descriptionInput::placeholder{color:var(--dsw-alias-label-caption)}
.buka-workers-descriptionInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:calc(-1 * var(--dsw-focus-ring-width))}
.buka-workers-descriptionInput:disabled{opacity:.65}
.buka-workers-backButton{flex:none;margin-left:calc(-1 * var(--buka-space-1, 4px))}
.buka-workers-detailTabs{display:flex;align-items:center;gap:0;min-width:0;flex:none;overflow-x:auto;overscroll-behavior-x:contain;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.buka-workers-detailTab{position:relative;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);height:40px;margin:0;padding:0 var(--buka-space-3, 12px);border:0;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--buka-text-title, 14px);line-height:var(--buka-line-20, 20px);white-space:nowrap;cursor:pointer}
@media (hover:hover){.buka-workers-detailTab:hover{color:var(--dsw-alias-label-primary)}}
.buka-workers-detailTab[aria-selected="true"]{color:var(--dsw-alias-label-primary);font-weight:500}
.buka-workers-detailTab[aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:1px;background:var(--dsw-alias-state-business-primary)}
.buka-workers-detailTab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:calc(-1 * var(--dsw-focus-ring-width))}
.buka-workers-tabDot{width:7px;height:7px;flex:none;border-radius:999px;background:var(--dsw-alias-state-business-primary)}
.buka-workers-panel{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);flex:1 1 auto;min-height:0}
.buka-workers-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workers-jobBlocker{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px)}
.buka-workers-plainList{margin:0;padding-left:var(--buka-space-4, 16px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.buka-workers-candidatesHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workers-candidates{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:0;padding:var(--buka-space-1, 4px);list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.buka-workers-candidate{display:flex;align-items:flex-start;gap:var(--buka-space-3, 12px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);cursor:pointer}
@media (hover:hover){.buka-workers-candidate:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-candidate.isDisabled{cursor:not-allowed;opacity:.62}
.buka-workers-candidateInput{flex:none;margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary)}
.buka-workers-candidateText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-workers-candidateName{font-family:var(--ds-font-family-code);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
.buka-workers-candidateDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workers-candidateTag{flex:none;margin-left:auto;padding-left:var(--buka-space-2, 8px);display:inline-flex;align-items:center}
.buka-workers-settings{display:flex;flex-direction:column;gap:var(--buka-space-6, 32px)}
.buka-workers-settings>section+section{padding-top:var(--buka-space-6, 32px);border-top:0.5px solid var(--dsw-alias-border-l1)}
.buka-workers-filesSection{flex:1 1 auto;min-height:0}
.buka-workers-filesHeading{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
.buka-workers-filesLayout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:var(--buka-space-4, 16px);min-height:0;flex:1 1 auto}
.buka-workers-fileTree{box-sizing:border-box;display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0;max-height:520px;overflow:auto;overscroll-behavior:contain;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:var(--buka-space-2, 8px);background:var(--dsw-alias-bg-layer-1)}
.buka-workers-fileTreeList{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none}
.buka-workers-fileTreeItem{min-width:0;margin:0;padding:0}
.buka-workers-fileTreeSummary{display:flex;align-items:center;gap:6px;padding:var(--buka-space-1, 4px) var(--buka-space-2, 8px);border-radius:var(--dsw-radius-sm);cursor:pointer;color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);list-style:none}
.buka-workers-fileTreeSummary::-webkit-details-marker{display:none}
.buka-workers-fileTreeSummary>svg,.buka-workers-fileTreeFile>svg{flex:none}
@media (hover:hover){.buka-workers-fileTreeSummary:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-fileTreeFile{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;padding:var(--buka-space-1, 4px) var(--buka-space-2, 8px);border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);text-align:left;cursor:pointer}
@media (hover:hover){.buka-workers-fileTreeFile:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.buka-workers-fileTreeFile.is-selected{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
.buka-workers-fileTreeFile:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.buka-workers-fileTreeName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.buka-workers-filePreview{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0;min-height:0;max-height:520px;overflow:auto;overscroll-behavior:contain}
.buka-workers-filePreviewHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workers-filePreviewPath{min-width:0;font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.buka-workers-filePreviewMeta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
.buka-workers-fileCode{width:100%}
@media (width<=720px){.buka-workers-filesLayout{grid-template-columns:1fr}.buka-workers-fileTree{max-height:240px}.buka-workers-filePreview{max-height:none}}
.buka-workers-repos{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto;overscroll-behavior:contain;margin:0;padding:var(--buka-space-1, 4px);list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.buka-workers-repo{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:var(--buka-space-3, 12px);margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
@media (hover:hover){.buka-workers-repo:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workers-repo.is-selected{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.buka-workers-repo:disabled{cursor:default;opacity:.62}
.buka-workers-repo:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workers-repoText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.buka-workers-repoSource{font-family:var(--ds-font-family-code);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
.buka-workers-repoNote{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workers-repoCount{flex:none;color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}

.buka-workers-selectAll{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
`
