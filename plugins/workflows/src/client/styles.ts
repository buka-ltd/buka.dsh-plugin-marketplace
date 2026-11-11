/**
 * 页面样式：沿用 Robots / Skills 页的标题行 + 960px 内容区 + 卡片结构。
 */

/** 页面样式：沿用 Robots / Skills 页的标题行 + 960px 内容区 + 卡片结构。 */
export const CSS = `
.buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
@media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
.buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));max-width:none;margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
.buka-workflows-titleRow{display:flex;flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:16px;min-width:0}
.buka-workflows-toolbar{flex:none;display:flex;align-items:center;gap:8px}
.buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:32px 0 24px}
.buka-workflows-pageBody{display:flex;flex-direction:column;gap:20px}
.buka-workflows-detail{display:flex;flex-direction:column;gap:28px}
.buka-workflows-status,.buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-workflows-emptyBox{display:flex;flex-direction:column;gap:10px;padding:8px 0}
.buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-warn{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-workflows-listPane{display:flex;flex-direction:column;gap:16px}
.buka-workflows-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-xl);padding:12px 8px;margin:0 -8px;font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.buka-workflows-cardTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:6px;min-width:0}
.buka-workflows-cardTags{display:flex;align-items:center;gap:6px;flex:none}
.buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px 5px}
.buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.buka-workflows-steps{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.buka-workflows-step{display:flex;flex-direction:column;gap:8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:12px}
.buka-workflows-stepHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-node{font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-stepMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-left:auto;overflow-wrap:anywhere}
.buka-workflows-stepActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;overflow-wrap:anywhere;word-break:break-all}
.buka-workflows-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;width:100%;box-sizing:border-box}
.buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:28px;padding:0 10px;font-size:12px;line-height:18px}
.buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-workflows-back svg{transform:rotate(180deg)}
.buka-workflows-graphPane{flex:none;min-width:0;width:max-content;max-width:none;margin-inline:auto}
.buka-workflows-vgraph{position:relative;flex:none}
.buka-workflows-vgraphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
.buka-workflows-vgraphNode{position:absolute;z-index:2;display:flex;align-items:center}
.buka-workflows-capsule{flex:1 1 auto;display:inline-flex;align-items:center;width:100%;height:100%;box-sizing:border-box;margin:0;padding:3px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;overflow:hidden;white-space:nowrap}
.buka-workflows-capsuleText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.buka-workflows-vgraphNode .buka-workflows-visitBadge{position:absolute;right:-6px;top:50%;transform:translateY(-50%);margin-left:0;padding-left:4px;background:var(--dsw-alias-bg-base)}
.buka-workflows-vgraphNode .buka-workflows-capsule.is-selected{outline-offset:1px}
.buka-workflows-capsule.is-robot{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.buka-workflows-capsule.has-avatar{padding-left:4px}
.buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workflows-capsuleAvatar{margin-right:6px}
.buka-workflows-inspectorAvatar{margin-right:2px}
.buka-workflows-capsule.is-user{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-capsule.is-end{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.buka-workflows-capsule.is-join{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.buka-workflows-capsule.is-start{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-capsule.is-idle{border-color:var(--dsw-alias-border-l2);border-style:dashed;color:var(--dsw-alias-label-tertiary)}
.buka-workflows-capsule.is-running{animation:buka-workflows-pulse 1.8s ease-out infinite}
.buka-workflows-visitBadge{flex:none;margin-left:6px;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
@media (hover:hover){.buka-workflows-capsule:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-capsule:focus-visible,.buka-workflows-capsule.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.buka-workflows-capsule.is-running{animation:none}}
.buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.25;stroke-dasharray:4 4;stroke-linecap:round;opacity:.6;transition:stroke-width .16s ease,opacity .16s ease,stroke .16s ease}
.buka-workflows-edge.is-static{stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5;stroke-dasharray:none;opacity:.85}
.buka-workflows-edge.is-traversed{stroke:var(--dsw-alias-brand-primary);stroke-width:1.75;stroke-dasharray:none;opacity:1}
.buka-workflows-edge.is-selected{stroke:var(--dsw-alias-brand-primary);stroke-width:2.5;stroke-dasharray:none;opacity:1}
.buka-workflows-edge.is-hovered{stroke-width:2.5;opacity:1;stroke-dasharray:none}
.buka-workflows-edge.is-next.is-hovered{stroke:var(--dsw-alias-brand-primary)}
.buka-workflows-edge.is-success{stroke:var(--dsw-alias-state-success-primary)}
.buka-workflows-edge.is-failure{stroke:var(--dsw-alias-state-error-primary)}
.buka-workflows-edge.is-success.is-hovered{stroke:var(--dsw-alias-state-success-primary)}
.buka-workflows-edge.is-failure.is-hovered{stroke:var(--dsw-alias-state-error-primary)}
.buka-workflows-edge.is-dimmed:not(.is-hovered){opacity:.5}
.buka-workflows-edgeHit{fill:none;stroke:transparent;stroke-width:14;stroke-linecap:round;pointer-events:stroke;cursor:pointer}
.buka-workflows-edgeHit:focus-visible{stroke:var(--dsw-alias-brand-primary);stroke-width:4;opacity:.25;outline:none}
.buka-workflows-edgeTip{position:fixed;z-index:1000;max-width:240px;box-sizing:border-box;padding:4px 9px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:16px;font-weight:500;box-shadow:0 4px 12px rgba(17,20,28,.12);pointer-events:none;overflow-wrap:anywhere}
.buka-workflows-edgeTip.is-anchored{transform:translateY(-50%)}
.buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.7;transition:opacity .16s ease,fill .16s ease}
.buka-workflows-edgeArrow.is-static{fill:var(--dsw-alias-label-tertiary);opacity:.85}
.buka-workflows-edgeArrow.is-traversed{fill:var(--dsw-alias-brand-primary);opacity:1}
.buka-workflows-edgeArrow.is-selected{fill:var(--dsw-alias-brand-primary);opacity:1}
.buka-workflows-edgeArrow.is-hovered{opacity:1}
.buka-workflows-edgeArrow.is-next.is-hovered{fill:var(--dsw-alias-brand-primary)}
.buka-workflows-edgeArrow.is-success{fill:var(--dsw-alias-state-success-primary)}
.buka-workflows-edgeArrow.is-failure{fill:var(--dsw-alias-state-error-primary)}
.buka-workflows-edgeArrow.is-success.is-hovered{fill:var(--dsw-alias-state-success-primary)}
.buka-workflows-edgeArrow.is-failure.is-hovered{fill:var(--dsw-alias-state-error-primary)}
.buka-workflows-edgeArrow.is-dimmed:not(.is-hovered){opacity:.5}
.buka-workflows-vgraphDot{stroke:var(--dsw-alias-bg-layer-1);stroke-width:1.5;fill:var(--dsw-alias-state-idle-primary)}
.buka-workflows-vgraphDot.is-running{fill:var(--dsw-alias-brand-primary)}
.buka-workflows-vgraphDot.is-waiting{fill:var(--dsw-alias-state-warn-primary)}
.buka-workflows-vgraphDot.is-done{fill:var(--dsw-alias-state-success-primary)}
.buka-workflows-vgraphDot.is-failed{fill:var(--dsw-alias-state-error-primary)}
.buka-workflows-footer{box-sizing:border-box;width:100%;max-width:960px;margin-inline:auto;flex:none;display:flex;flex-direction:column;gap:10px;padding:14px 0 24px;border-top:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.buka-workflows-footer .buka-workflows-hint{margin:0}
.buka-workflows-legend{display:flex;flex-wrap:wrap;gap:10px 24px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.buka-workflows-legendTitle{color:var(--dsw-alias-label-secondary);font-weight:500}
.buka-workflows-legendItem{display:inline-flex;align-items:center;gap:5px}
.buka-workflows-legendCapsule{box-sizing:border-box;width:26px;height:11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}
.buka-workflows-legendCapsule.is-robot{border-color:var(--dsw-alias-brand-primary)}
.buka-workflows-legendCapsule.is-user{border-color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendCapsule.is-end{border-color:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendCapsule.is-join{border-color:var(--dsw-alias-state-business-primary)}
.buka-workflows-legendCapsule.is-start{border-color:var(--dsw-alias-border-l2)}
.buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
.buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption);border-top-style:dashed}
.buka-workflows-legendLine.is-static{border-top-color:var(--dsw-alias-label-tertiary);border-top-style:solid}
.buka-workflows-legendLine.is-traversed{border-top-color:var(--dsw-alias-brand-primary);border-top-style:solid}
.buka-workflows-inspector{display:flex;flex-direction:column;gap:14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:14px 16px}
.buka-workflows-inspectorHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-inspectorTitle{flex:1 1 auto;min-width:0;font-size:15px;font-weight:500;line-height:22px;overflow-wrap:anywhere}
.buka-workflows-inspectorId{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-markdown-code-block);border-radius:var(--dsw-radius-sm);padding:1px 5px;overflow-wrap:anywhere}
.buka-workflows-inspectorClose{margin-left:auto}
.buka-workflows-inspectorSection{display:flex;flex-direction:column;gap:8px}
.buka-workflows-nodeDrawer .buka-workflows-inspector{border:0;background:0 0;padding:0}
.buka-workflows-edgeRules{display:flex;flex-direction:column;gap:8px}
.buka-workflows-edgeRule{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
.buka-workflows-edgeRuleHead{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
.buka-workflows-edgeRuleDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-edgeRule .buka-workflows-pre{max-height:200px;margin-top:6px}
.buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:18px;text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
@media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
.buka-workflows-attachmentLink:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
.buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1;min-width:120px}
.buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11px;flex:none}
.buka-workflows-attachmentDownload:hover{text-decoration:underline}
.buka-workflows-executions{display:flex;flex-direction:column;gap:12px}
.buka-workflows-tabs{display:flex;flex-wrap:wrap;gap:6px}
.buka-workflows-tab{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:2px 10px;cursor:pointer}
@media (hover:hover){.buka-workflows-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-tab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-tab.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base)}
.buka-workflows-tabDot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.buka-workflows-tabDot.is-done{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-tabDot.is-failed{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-tabDot.is-running{background:var(--dsw-alias-brand-primary)}
.buka-workflows-tabDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
.buka-workflows-tabPanel{display:flex;flex-direction:column;gap:12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:12px}
.buka-workflows-tabMeta{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.buka-workflows-kv{display:flex;flex-direction:column;gap:4px}
.buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;line-height:18px}
.buka-workflows-sessionBar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
.buka-workflows-sessionBar .buka-workflows-inlineCode{font-size:12px}
.buka-workflows-sessionList{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0}
.buka-workflows-sessionRow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-interactionNotice{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:100%;padding:12px 14px;border:0.5px solid var(--dsw-alias-state-warn-primary);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.buka-workflows-interactionHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-interactionTitle{flex:1 1 auto;min-width:0;color:var(--dsw-alias-state-warn-primary);font-size:13px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-interactionBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.buka-workflows-interactionActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.buka-workflows-userNotice{display:flex;flex-direction:column;gap:8px}
.buka-workflows-userNoticeGroup{display:flex;flex-direction:column;gap:6px}
.buka-workflows-userChoiceList,.buka-workflows-userQuestionList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-userChoice,.buka-workflows-userQuestion{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-userChoiceLabel,.buka-workflows-userQuestionHeader{color:var(--dsw-alias-label-primary);font-weight:500}
.buka-workflows-userChoiceDesc{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.buka-workflows-userQuestionText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);min-width:72px}
.buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
.buka-workflows-executionNav{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-secondary);display:flex;justify-content:space-between;gap:16px}
.buka-workflows-navSide{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.buka-workflows-navSide.is-next{align-items:flex-end;text-align:right}
.buka-workflows-navSide .buka-workflows-hint{margin:0}
.buka-workflows-prevLink,.buka-workflows-nextLink{display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary);cursor:pointer;border-radius:var(--dsw-radius-sm);max-width:100%}
.buka-workflows-prevLink:hover,.buka-workflows-nextLink:hover{text-decoration:underline}
.buka-workflows-prevLink:focus-visible,.buka-workflows-nextLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-workflows-prevArrow,.buka-workflows-nextArrow{color:var(--dsw-alias-label-tertiary)}
.buka-workflows-prevTitle,.buka-workflows-nextTitle{font-size:12px;font-weight:500}
.buka-workflows-prevVisit,.buka-workflows-nextVisit{color:var(--dsw-alias-label-secondary)}
.buka-workflows-dialogForm{display:flex;flex-direction:column;gap:16px}
.buka-workflows-settingRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:2px 0}
.buka-workflows-settingText{display:flex;flex-direction:column;gap:4px;min-width:0}
.buka-workflows-settingHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.buka-workflows-settingTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}
.buka-workflows-settingDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;margin:2px 0 0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease}
.buka-workflows-switch.is-on{background:var(--dsw-alias-brand-primary)}
.buka-workflows-switch:disabled{cursor:default;opacity:.6}
.buka-workflows-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-workflows-switchThumb{width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(17,20,28,.24);transition:transform .16s ease}
.buka-workflows-switch.is-on .buka-workflows-switchThumb{transform:translateX(16px)}
@media (prefers-reduced-motion:reduce){.buka-workflows-switch,.buka-workflows-switchThumb{transition:none}}
.buka-workflows-hoursField{display:flex;flex-direction:column;gap:6px}
.buka-workflows-hoursControl{display:flex;align-items:center;gap:8px}
.buka-workflows-hoursInput{width:88px}
.buka-workflows-hoursUnit{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-tabbar{flex:1 1 auto;min-width:0}
.buka-workflows-tabList{width:fit-content;min-width:240px}
@media (width<=372px){.buka-workflows-tabList{min-width:0}}
.buka-workflows-templateList{display:flex;flex-direction:column;gap:16px}
.buka-workflows-templateCard{display:flex;flex-direction:column;gap:8px;width:100%;box-sizing:border-box;text-align:left;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-md);padding:14px 16px;font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-templateCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-templateCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-templateHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-templateTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-templateChevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary)}
.buka-workflows-templateDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-templateDetail{display:flex;flex-direction:column;gap:20px}
.buka-workflows-flow{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.buka-workflows-flowStep{display:flex;flex-direction:column;gap:6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:10px 12px}
.buka-workflows-flowHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.buka-workflows-flowIndex{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.buka-workflows-flowSummary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-flowTransitions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.buka-workflows-templateBackButton{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;background:0 0;color:var(--dsw-alias-label-caption);cursor:pointer;border-radius:var(--dsw-radius-sm);padding:0;margin-left:-4px}
@media (hover:hover){.buka-workflows-templateBackButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-templateBackButton:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workflows-templateBackButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-workflows-detailBackButton{align-self:flex-start}
.buka-workflows-templateTransitions{display:flex;flex-direction:column;gap:8px}
.buka-workflows-templateTransition{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
.buka-workflows-templateTransitionHead{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
.buka-workflows-templateTransitionBody{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(560px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
@keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
@media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
@media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
.buka-workflows-drawerHead{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 18px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:8px;min-width:0}
.buka-workflows-drawerTitle{flex:1 1 auto;min-width:0;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-drawerActions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;border-radius:var(--dsw-radius-sm)}
.buka-workflows-drawerDownload:hover{text-decoration:underline}
.buka-workflows-drawerDownload:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-left:auto;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
@media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-drawerClose:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto;overscroll-behavior:contain;padding:16px 18px 24px}
.buka-workflows-drawerStatus{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-workflows-drawerMarkdown{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-drawerCode{margin:0}
.buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
`
