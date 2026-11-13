/**
 * 页面样式：沿用 Workers / Skills 页的标题行 + 内容区 + 卡片结构；
 * 工作流页补定义图，作业页补贴纸摘要、实时流程、看板与资产池。
 */

/** 页面样式。 */
export const CSS = `
.buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
@media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
.buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:2;position:sticky;top:0}
.buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
.buka-workflows-page.is-mid .buka-workflows-headInner,.buka-workflows-page.is-mid .buka-workflows-body{max-width:1120px}
.buka-workflows-page.is-wide .buka-workflows-headInner,.buka-workflows-page.is-wide .buka-workflows-body{max-width:1280px}
.buka-workflows-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 16px;min-width:0}
.buka-workflows-titleGroup{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.buka-workflows-title{font-size:20px;font-weight:500;line-height:28px;margin:0;overflow-wrap:anywhere}
.buka-workflows-titleMeta{display:inline-flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.buka-workflows-titleSub{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;font-weight:400}
.buka-workflows-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.buka-workflows-back{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.buka-workflows-back svg{transform:rotate(180deg)}
@media (hover:hover){.buka-workflows-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-back:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-tabs{display:flex;align-items:center;gap:8px;padding:14px 0 0;min-width:0;overflow-x:auto;overscroll-behavior-x:contain}
.buka-workflows-tabList{width:fit-content;max-width:100%}
.buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;display:flex;flex-direction:column;padding:28px 0 48px;scrollbar-gutter:stable}
.buka-workflows-more{position:relative;display:inline-flex}
.buka-workflows-moreSummary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;background:0 0}
.buka-workflows-moreSummary::-webkit-details-marker{display:none}
.buka-workflows-moreMenu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;padding:6px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgb(0 0 0 / 16%);min-width:120px}
.buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-workflows-emptyBox{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:8px 0}
.buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-failureBox{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;overflow-wrap:anywhere;word-break:break-all}
.buka-workflows-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;width:100%;box-sizing:border-box}
.buka-workflows-pre.is-tall{max-height:360px}
.buka-workflows-pre.is-inline{max-height:160px;margin:2px 0}
.buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:28px;padding:0 10px;font-size:12px;line-height:18px}
.buka-workflows-smallButton.is-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
.buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-workflows-textButton{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm)}
.buka-workflows-textButton:hover{text-decoration:underline}
.buka-workflows-confirm{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.buka-workflows-confirmText{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.buka-workflows-notice{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
.buka-workflows-noticeText{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px;flex:1 1 260px}
.buka-workflows-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.buka-workflows-listPane{display:flex;flex-direction:column;gap:12px}
.buka-workflows-listToolbar{display:flex;align-items:center;justify-content:flex-end;min-height:18px}
.buka-workflows-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-xl);padding:10px 8px;margin:0 -8px;font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-card.is-disabled{opacity:.55}
.buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.buka-workflows-cardTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:18px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workflows-cardTags{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap}
.buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px 5px}
.buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-progress{display:block;width:100%;height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:2px}
.buka-workflows-progressBar{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
.buka-workflows-progressBar.is-completed{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-progressBar.is-failed,.buka-workflows-progressBar.is-cancelled{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.buka-workflows-filter{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
@media (hover:hover){.buka-workflows-filter:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-filter.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
.buka-workflows-filterCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px;line-height:16px}
.buka-workflows-filter.is-active .buka-workflows-filterCount{color:inherit}
.buka-workflows-detail{display:flex;flex-direction:column;gap:20px;min-width:0}
.buka-workflows-section{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.buka-workflows-sectionTitle{font-size:15px;font-weight:600;line-height:22px;margin:0;color:var(--dsw-alias-label-primary)}
.buka-workflows-kv{display:flex;flex-direction:column;gap:4px}
.buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;line-height:18px}
.buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);min-width:96px}
.buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0;flex:1 1 auto}
.buka-workflows-values{display:flex;flex-direction:column;gap:8px}
.buka-workflows-valueRow{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;line-height:20px}
.buka-workflows-valueKey{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);min-width:120px;font-size:12px;line-height:18px}
.buka-workflows-valueValue{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.buka-workflows-details{display:flex;flex-direction:column;gap:6px;min-width:0}
.buka-workflows-detailsSummary{cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;width:fit-content;border-radius:var(--dsw-radius-sm)}
.buka-workflows-detailsSummary:hover{color:var(--dsw-alias-label-secondary)}
.buka-workflows-details[open] .buka-workflows-detailsSummary{margin-bottom:4px}
.buka-workflows-definitionPane{display:flex;flex-direction:column;gap:12px;min-width:0}
.buka-workflows-definitionToolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.buka-workflows-graphPane{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-graphViewport{width:100%;overflow:hidden;overscroll-behavior:contain}
.buka-workflows-graphScaleBox{position:relative;flex:none;margin:0 auto}
.buka-workflows-graphCanvas{position:absolute;left:0;top:0;flex:none}
.buka-workflows-graphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
.buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.5;stroke-linecap:round;opacity:.7}
.buka-workflows-edgeGroup.is-back .buka-workflows-edge{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:5 4;opacity:.9}
.buka-workflows-edge.is-taken{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2;opacity:1}
.buka-workflows-edgeGroup.is-selected .buka-workflows-edge{stroke:var(--dsw-alias-brand-primary);stroke-width:2.4;opacity:1}
.buka-workflows-hitPath{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
.buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.8;pointer-events:none}
.buka-workflows-edgeArrow.is-back{fill:var(--dsw-alias-state-warn-primary)}
.buka-workflows-edgeArrow.is-taken{fill:var(--dsw-alias-brand-primary);opacity:1}
.buka-workflows-edgeTip{position:absolute;z-index:4;transform:translate(-50%,-50%);padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 2px 10px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;white-space:nowrap;pointer-events:none}
.buka-workflows-graphCaption{text-align:center}
.buka-workflows-nodeWrap{position:absolute;z-index:2}
.buka-workflows-node{position:relative;display:flex;align-items:center;gap:6px;width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;overflow:visible}
button.buka-workflows-node{cursor:pointer}
@media (hover:hover){button.buka-workflows-node:hover{background:var(--dsw-alias-interactive-bg-hover)}}
button.buka-workflows-node:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.buka-workflows-node.is-start,.buka-workflows-node.is-end{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-style:dashed}
.buka-workflows-node.is-human{border-color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-node.is-worker{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.buka-workflows-node.is-idle{border-style:dashed;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.buka-workflows-node.is-running{border-color:var(--dsw-alias-brand-primary);animation:buka-workflows-pulse 1.8s ease-out infinite}
.buka-workflows-node.is-waiting{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent)}
.buka-workflows-node.is-failed{border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}
.buka-workflows-node.is-done{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}
.buka-workflows-node.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.buka-workflows-node.is-running{animation:none}}
.buka-workflows-nodeAvatar{flex:none}
.buka-workflows-nodeCorner{position:absolute;top:-8px;right:-6px;z-index:1;display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:16px;box-sizing:border-box;padding:0 4px;border-radius:999px;font-family:var(--ds-font-family-code);font-size:9.5px;font-weight:600;line-height:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base)}
.buka-workflows-nodeCorner.is-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-success-primary)}
.buka-workflows-nodeCorner.is-running{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-brand-primary)}
.buka-workflows-nodeCorner.is-waiting{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-nodeCorner.is-failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-error-primary)}
.buka-workflows-nodeLabel{font-size:12.5px;font-weight:600;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}

.buka-workflows-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;width:100%}
.buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.buka-workflows-legendItem{display:inline-flex;align-items:center;gap:5px}
.buka-workflows-legendNode{box-sizing:border-box;width:20px;height:10px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2)}
.buka-workflows-legendNode.is-start,.buka-workflows-legendNode.is-end{border-style:dashed}
.buka-workflows-legendNode.is-worker{border-color:var(--dsw-alias-brand-primary)}
.buka-workflows-legendNode.is-human{border-color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
.buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption)}
.buka-workflows-legendLine.is-back{border-top-color:var(--dsw-alias-state-warn-primary);border-top-style:dashed}
.buka-workflows-legendLine.is-taken{border-top-color:var(--dsw-alias-brand-primary);border-top-width:2.2px}
.buka-workflows-boardPane{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-board{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:8px}
.buka-workflows-boardGrid{display:grid;grid-template-columns:148px repeat(5,minmax(150px,1fr));gap:6px;min-width:940px}
.buka-workflows-boardHeader{display:contents}
.buka-workflows-boardRowHead{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
.buka-workflows-boardHeader>.buka-workflows-boardRowHead{background:transparent;padding-top:0}
.buka-workflows-boardColumnHead{font-size:10.5px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:0 2px 4px}
.buka-workflows-boardColumnHead.is-ready{color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-boardRow{display:contents}
.buka-workflows-boardRowTitle{font-size:12px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-boardRowExecutor{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
.buka-workflows-boardRowMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.buka-workflows-boardRow.is-starter .buka-workflows-boardRowHead{border-left:2px solid var(--dsw-alias-border-l2)}
.buka-workflows-boardCell{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:52px;padding:4px;border-radius:var(--dsw-radius-sm);border:0.5px dashed var(--dsw-alias-border-l1)}
.buka-workflows-boardCell.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
.buka-workflows-boardCompact{display:flex;flex-direction:column;gap:16px}
.buka-workflows-boardGroup{display:flex;flex-direction:column;gap:8px}
.buka-workflows-boardGroupTitle{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary)}
.buka-workflows-boardGroupTitle.is-ready{color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-boardGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px}
.buka-workflows-taskList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-taskItem{display:flex;min-width:0}
.buka-workflows-taskItem>.buka-workflows-taskCard{width:100%}
.buka-workflows-taskCard{display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;text-align:left;padding:8px 9px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-taskCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-taskCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-taskCard.is-running{border-color:var(--dsw-alias-brand-primary)}
.buka-workflows-taskCard.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent)}
.buka-workflows-taskCard.is-failed,.buka-workflows-taskCard.is-blocked{border-color:var(--dsw-alias-state-error-primary)}
.buka-workflows-taskCardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}
.buka-workflows-taskCardType{font-size:12px;font-weight:500;line-height:18px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-taskCardPosition{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.buka-workflows-taskCardMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
.buka-workflows-taskCardSummary{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workflows-overview{display:flex;flex-direction:column;gap:24px;min-width:0}
.buka-workflows-overviewCard{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0}
.buka-workflows-finalCard{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
.buka-workflows-finalHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.buka-workflows-inlineGroup{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.buka-workflows-outputsPane{display:flex;flex-direction:column;gap:20px;min-width:0}
.buka-workflows-outputGroup{display:flex;flex-direction:column;gap:8px;min-width:0}
.buka-workflows-outputGroupHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-outputGroupTitle{font-size:13px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-outputGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px;margin-left:auto}
.buka-workflows-asset{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.buka-workflows-assetMain{display:flex;flex-direction:column;gap:3px;min-width:180px;flex:1 1 auto}
.buka-workflows-assetActions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none}
.buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:18px;text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
@media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
.buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
.buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1 1 auto;min-width:120px;overflow-wrap:anywhere}
.buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11px;flex:none}
.buka-workflows-attachmentDownload:hover{text-decoration:underline}
.buka-workflows-depList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-depRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px}
.buka-workflows-depLink{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.buka-workflows-depLink:hover{text-decoration:underline}
.buka-workflows-depSummary{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:1 1 100%;overflow-wrap:anywhere}
.buka-workflows-attemptList{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.buka-workflows-attempt{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
.buka-workflows-attemptHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-attemptMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.buka-workflows-sessionRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-result{display:flex;flex-direction:column;gap:12px}
.buka-workflows-taskForm{display:flex;flex-direction:column;gap:10px}
.buka-workflows-contractBody{display:flex;flex-direction:column;gap:8px;min-width:0}
.buka-workflows-tagRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.buka-workflows-initialList{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.buka-workflows-initialRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-initialMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;font-size:12px;line-height:18px}
.buka-workflows-clamped{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}
.buka-workflows-clampedText{margin:0;width:100%;box-sizing:border-box;overflow-wrap:anywhere;white-space:pre-wrap}
.buka-workflows-clampedText.is-clamped{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:normal}
.buka-workflows-drawerText{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-required{color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:16px}
.buka-workflows-typeList{display:flex;flex-direction:column;min-width:0}
.buka-workflows-typeRow{display:flex;flex-direction:column;gap:5px;padding:12px 0;border-top:0.5px solid var(--dsw-alias-border-l1);min-width:0}
.buka-workflows-typeRow:first-child{border-top:0;padding-top:0}
.buka-workflows-typeRow:last-child{padding-bottom:0}
.buka-workflows-typeRowHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-typeName{font-size:13px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-typeTags{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.buka-workflows-typeDesc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;overflow-wrap:anywhere}
.buka-workflows-contractStack{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-contractStack.is-tight{gap:5px}
.buka-workflows-contractBlock{display:flex;flex-direction:column;gap:4px;min-width:0}
.buka-workflows-contractLine{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;align-items:start;min-width:0}
.buka-workflows-contractLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap;padding-top:2px}
.buka-workflows-contractValue{display:flex;flex-direction:column;gap:4px;min-width:0}
.buka-workflows-contractFields{display:flex;flex-wrap:wrap;gap:4px 6px;min-width:0}
.buka-workflows-contractField{display:inline-flex;align-items:baseline;gap:5px;max-width:100%;padding:1px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:17px;min-width:0}
.buka-workflows-contractField .buka-workflows-inlineCode{flex:none;background:0;padding:0;font-size:11px;line-height:17px}
.buka-workflows-contractType{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10px;line-height:16px;flex:none}
.buka-workflows-contractDesc{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;overflow-wrap:anywhere}
.buka-workflows-statStrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:1px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-border-l1);overflow:hidden}
.buka-workflows-stat{display:flex;flex-direction:column;gap:1px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.buka-workflows-statValue{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.buka-workflows-statLabel{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.buka-workflows-resultText{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.buka-workflows-resultBlock{display:flex;flex-direction:column;gap:5px;min-width:0}
.buka-workflows-subLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;line-height:16px}
.buka-workflows-deliverable{padding:10px 12px;border-radius:var(--dsw-radius-md);border:0.5px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 5%,transparent)}
.buka-workflows-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px;overflow-wrap:anywhere}
.buka-workflows-input{width:100%}
.buka-workflows-textarea,.buka-workflows-select{box-sizing:border-box;width:100%;padding:6px 8px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;line-height:18px;resize:vertical}
.buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-formActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
.buka-workflows-dialogForm{display:flex;flex-direction:column;gap:14px}
.buka-workflows-dialogSection{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-dialogSectionTitle{margin:0;font-size:13px;font-weight:600;line-height:20px}
.buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(560px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
.buka-workflows-inspector.buka-workflows-inspector{width:min(460px,100vw)}
.buka-workflows-nodeTasks.buka-workflows-nodeTasks{width:min(480px,100vw)}
@keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
@media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
@media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
.buka-workflows-drawerHead{flex:none;padding:14px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-drawerHeadRow{display:flex;align-items:flex-start;gap:10px;min-width:0}
.buka-workflows-drawerHeading{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.buka-workflows-drawerAvatar{margin-top:3px}
.buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-drawerTitle{flex:0 1 auto;min-width:0;margin:0;font-size:15px;font-weight:600;line-height:22px;overflow-wrap:anywhere}
.buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-drawerActions{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto;min-width:0}
.buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;border-radius:var(--dsw-radius-sm)}
.buka-workflows-drawerDownload:hover{text-decoration:underline}
.buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}
@media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px;overflow:auto;overscroll-behavior:contain;padding:16px 16px 28px}
.buka-workflows-drawerBody .buka-workflows-sectionTitle{font-size:13px;line-height:20px}
.buka-workflows-drawerBody .buka-workflows-valueKey{min-width:88px}
.buka-workflows-drawerBody .buka-workflows-kvKey{min-width:80px}
.buka-workflows-sectionHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:17px;overflow-wrap:anywhere}
.buka-workflows-fold{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:10px;min-width:0}
.buka-workflows-foldSummary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:20px;border-radius:var(--dsw-radius-sm)}
.buka-workflows-foldSummary:hover{color:var(--dsw-alias-label-primary)}
.buka-workflows-fold[open] .buka-workflows-foldSummary{margin-bottom:8px;color:var(--dsw-alias-label-primary)}
.buka-workflows-foldBody{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
@media (width<=767px){
.buka-workflows-title{font-size:18px;line-height:26px}
.buka-workflows-titleSub{flex:1 1 100%}
.buka-workflows-body{padding:20px 0 36px}
.buka-workflows-sectionTitle{font-size:14px}
.buka-workflows-overviewCard{padding:10px 12px}
.buka-workflows-valueRow{flex-direction:column;gap:2px}
}
`
