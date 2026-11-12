/**
 * 页面样式：沿用 Robots / Skills 页的标题行 + 内容区 + 卡片结构，并补上
 * v4 的看板、流程图、任务抽屉、附件库与时间线。
 */

/** 页面样式。 */
export const CSS = `
.buka-workflows-page{--buka-workflows-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-workflows-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden}
@media (width<=767px){.buka-workflows-page{--buka-workflows-inset:20px}}
.buka-workflows-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-workflows-inset));max-width:none;margin-inline:calc(-1 * var(--buka-workflows-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-workflows-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-workflows-headInner{width:100%;max-width:960px;margin-inline:auto}
.buka-workflows-page.is-wide .buka-workflows-headInner{max-width:1280px}
.buka-workflows-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px;min-width:0}
.buka-workflows-titleGroup{display:flex;align-items:center;gap:10px;min-width:0}
.buka-workflows-title{font-size:16px;font-weight:600;line-height:24px;margin:0;overflow-wrap:anywhere}
.buka-workflows-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.buka-workflows-body{box-sizing:border-box;width:100%;max-width:960px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:24px 0 24px}
.buka-workflows-body.is-wide{max-width:1280px}
.buka-workflows-footer{box-sizing:border-box;width:100%;max-width:1280px;margin-inline:auto;flex:none;display:flex;align-items:center;padding:10px 0 20px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.buka-workflows-back svg{transform:rotate(180deg)}
.buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-workflows-emptyBox{display:flex;flex-direction:column;gap:8px;padding:8px 0}
.buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-failureBox{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.buka-workflows-warn{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px 5px;overflow-wrap:anywhere;word-break:break-all}
.buka-workflows-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;width:100%;box-sizing:border-box}
.buka-workflows-pre.is-tall{max-height:360px}
.buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:28px;padding:0 10px;font-size:12px;line-height:18px}
.buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-workflows-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.buka-workflows-listPane{display:flex;flex-direction:column;gap:14px}
.buka-workflows-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-xl);padding:12px 8px;margin:0 -8px;font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.buka-workflows-cardTitle{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-cardTags{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap}
.buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px 5px}
.buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-detail{display:flex;flex-direction:column;gap:20px;min-width:0}
.buka-workflows-section{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.buka-workflows-sectionTitle{font-size:13px;font-weight:600;line-height:20px;margin:0;color:var(--dsw-alias-label-primary)}
.buka-workflows-kv{display:flex;flex-direction:column;gap:4px}
.buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;line-height:18px}
.buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);min-width:88px}
.buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
.buka-workflows-workflowHead,.buka-workflows-jobHead{display:flex;flex-direction:column;gap:8px}
.buka-workflows-workflowTitleGroup,.buka-workflows-jobTitleGroup{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-workflowTitle,.buka-workflows-jobTitle{font-size:18px;font-weight:600;line-height:26px;margin:0;overflow-wrap:anywhere}
.buka-workflows-workflowDesc{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-jobMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-deliveryNotice{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
.buka-workflows-positionList{display:flex;flex-direction:column;gap:10px}
.buka-workflows-positionCard{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-positionHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.buka-workflows-positionLabel{font-size:14px;font-weight:500;line-height:20px}
.buka-workflows-positionDesc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-typeList{display:flex;flex-direction:column;gap:6px}
.buka-workflows-typeCard{padding:8px 10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.buka-workflows-typeHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer;min-width:0}
.buka-workflows-typeLabel{font-size:13px;font-weight:500;line-height:20px}
.buka-workflows-typeDesc{margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-typeColumns{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:8px}
.buka-workflows-typeColumn{display:flex;flex-direction:column;gap:6px;min-width:0}
.buka-workflows-requiresRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}
.buka-workflows-schemaList{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.buka-workflows-schemaField{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;line-height:18px}
.buka-workflows-schemaType{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px}
.buka-workflows-required{color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:16px}
.buka-workflows-edgeList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-edgeRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-edgeArrowText{color:var(--dsw-alias-label-tertiary)}
.buka-workflows-edgeTypes{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.buka-workflows-contractGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.buka-workflows-contractBody{display:flex;flex-direction:column;gap:8px}
.buka-workflows-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px;overflow-wrap:anywhere}
.buka-workflows-input{width:100%}
.buka-workflows-textarea,.buka-workflows-select{box-sizing:border-box;width:100%;padding:6px 8px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;line-height:18px;resize:vertical}
.buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-formActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
.buka-workflows-dialogForm{display:flex;flex-direction:column;gap:12px}
.buka-workflows-viewTabs{display:flex;align-items:center;min-width:0}
.buka-workflows-tabList{width:fit-content;min-width:280px}
.buka-workflows-viewBody{display:flex;flex-direction:column;gap:12px;min-width:0}
.buka-workflows-boardPane{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-board{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:8px}
.buka-workflows-boardGrid{display:grid;grid-template-columns:156px repeat(5,minmax(168px,1fr));gap:6px;min-width:1020px}
.buka-workflows-boardHeader{display:contents}
.buka-workflows-boardRowHead{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
.buka-workflows-boardHeader>.buka-workflows-boardRowHead{background:transparent;padding-top:0}
.buka-workflows-boardColumnHead{font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:0 2px 4px}
.buka-workflows-boardRow{display:contents}
.buka-workflows-boardRowTitle{font-size:12px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-boardRowExecutor{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
.buka-workflows-boardRowMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.buka-workflows-boardRow.is-start .buka-workflows-boardRowHead,.buka-workflows-boardRow.is-end .buka-workflows-boardRowHead{border-left:2px solid var(--dsw-alias-border-l2)}
.buka-workflows-boardCell{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:52px;padding:4px;border-radius:var(--dsw-radius-sm);border:0.5px dashed var(--dsw-alias-border-l1)}
.buka-workflows-taskCard{display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;text-align:left;padding:8px 9px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-taskCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-taskCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-taskCard.is-running{border-color:var(--dsw-alias-brand-primary)}
.buka-workflows-taskCard.is-failed,.buka-workflows-taskCard.is-blocked{border-color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-taskCardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}
.buka-workflows-taskCardType{font-size:12px;font-weight:500;line-height:18px;overflow-wrap:anywhere;min-width:0}
.buka-workflows-taskCardMeta{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;overflow-wrap:anywhere}
.buka-workflows-taskCardSummary{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workflows-taskCardStatus{display:none}
.buka-workflows-tablePane{display:flex;flex-direction:column;gap:10px;min-width:0}
.buka-workflows-table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}
.buka-workflows-table th{text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);padding:6px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l2);white-space:nowrap}
.buka-workflows-table td{padding:7px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l1);vertical-align:middle;overflow-wrap:anywhere}
.buka-workflows-tableRow{cursor:pointer}
.buka-workflows-tableRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.buka-workflows-tableRow:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
.buka-workflows-tableTime{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.buka-workflows-attachmentList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.buka-workflows-attachment{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.buka-workflows-attachmentMain{display:flex;flex-direction:column;gap:2px;min-width:160px;flex:1 1 auto}
.buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:18px;text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
@media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
.buka-workflows-attachmentSource{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;text-align:left;cursor:pointer;overflow-wrap:anywhere}
.buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
.buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1 1 auto;min-width:120px;overflow-wrap:anywhere}
.buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11px;flex:none}
.buka-workflows-attachmentDownload:hover{text-decoration:underline}
.buka-workflows-timeline{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
.buka-workflows-timelineItem{display:flex;gap:10px;padding:0 0 14px;position:relative}
.buka-workflows-timelineItem::before{content:'';position:absolute;left:4px;top:12px;bottom:0;width:1px;background:var(--dsw-alias-border-l2)}
.buka-workflows-timelineItem:last-child::before{display:none}
.buka-workflows-timelineDot{flex:none;width:9px;height:9px;margin-top:4px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);z-index:1}
.buka-workflows-timelineItem.is-success .buka-workflows-timelineDot{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-timelineItem.is-warning .buka-workflows-timelineDot{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-timelineItem.is-info .buka-workflows-timelineDot{background:var(--dsw-alias-brand-primary)}
.buka-workflows-timelineBody{display:flex;flex-direction:column;gap:2px;min-width:0}
.buka-workflows-timelineHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.buka-workflows-timelineLabel{font-size:12px;font-weight:500;line-height:18px}
.buka-workflows-timelineTime{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.buka-workflows-timelineDetail{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
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
.buka-workflows-sessionBar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
.buka-workflows-result{display:flex;flex-direction:column;gap:12px}
.buka-workflows-taskForm{display:flex;flex-direction:column;gap:10px}
.buka-workflows-graphPane{display:flex;flex-direction:column;gap:10px;min-width:0;align-items:center}
.buka-workflows-vgraph{position:relative;flex:none;margin-inline:auto}
.buka-workflows-vgraphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
.buka-workflows-vgraphNode{position:absolute;z-index:2;display:flex;align-items:center}
.buka-workflows-capsule{flex:1 1 auto;display:inline-flex;align-items:center;width:100%;height:100%;box-sizing:border-box;margin:0;padding:3px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;overflow:hidden;white-space:nowrap}
button.buka-workflows-capsule{cursor:pointer}
.buka-workflows-capsule.has-avatar{padding-left:4px}
.buka-workflows-capsuleAvatar{margin-right:6px}
.buka-workflows-capsuleText{flex:1 1 auto;display:flex;align-items:center;gap:6px;min-width:0}
.buka-workflows-capsuleLabel{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.buka-workflows-capsuleMeta{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:10.5px;line-height:16px}
.buka-workflows-capsule.is-start,.buka-workflows-capsule.is-end{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-capsule.is-robot{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.buka-workflows-capsule.is-human{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-capsule.is-end{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.buka-workflows-capsule.is-idle{border-style:dashed}
.buka-workflows-capsule.is-running{animation:buka-workflows-pulse 1.8s ease-out infinite}
.buka-workflows-capsule.is-selected{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@media (hover:hover){button.buka-workflows-capsule:hover{background:var(--dsw-alias-interactive-bg-hover)}}
button.buka-workflows-capsule:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@keyframes buka-workflows-pulse{0%{box-shadow:0 0 0 0 var(--dsw-alias-brand-primary)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.buka-workflows-capsule.is-running{animation:none}}
.buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.5;stroke-linecap:round;opacity:.75}
.buka-workflows-edge.is-back{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:4 4;opacity:.8}
.buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.8}
.buka-workflows-edgeArrow.is-back{fill:var(--dsw-alias-state-warn-primary)}
.buka-workflows-graphCaption{text-align:center}
.buka-workflows-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 20px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;width:100%}
.buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.buka-workflows-legendTitle{color:var(--dsw-alias-label-secondary);font-weight:500}
.buka-workflows-legendItem{display:inline-flex;align-items:center;gap:5px}
.buka-workflows-legendCapsule{box-sizing:border-box;width:26px;height:11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}
.buka-workflows-legendCapsule.is-robot{border-color:var(--dsw-alias-brand-primary)}
.buka-workflows-legendCapsule.is-human{border-color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendCapsule.is-end{border-color:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.buka-workflows-legendDot.is-done{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-legendDot.is-running{background:var(--dsw-alias-brand-primary)}
.buka-workflows-legendDot.is-waiting{background:var(--dsw-alias-state-warn-primary)}
.buka-workflows-legendDot.is-failed{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-legendLine{box-sizing:border-box;width:18px;height:0;border-top:1.5px solid var(--dsw-alias-label-caption)}
.buka-workflows-legendLine.is-back{border-top-color:var(--dsw-alias-state-warn-primary);border-top-style:dashed}
.buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(600px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
@keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
@media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
@media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
.buka-workflows-drawerHead{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 18px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:8px;min-width:0}
.buka-workflows-drawerTitle{flex:1 1 auto;min-width:0;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-workflows-drawerActions{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;border-radius:var(--dsw-radius-sm)}
.buka-workflows-drawerDownload:hover{text-decoration:underline}
.buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-left:auto;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}
@media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px;overflow:auto;overscroll-behavior:contain;padding:16px 18px 28px}
.buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
`
