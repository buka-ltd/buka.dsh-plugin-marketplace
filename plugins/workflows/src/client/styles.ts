/**
 * 页面样式：两个页签共用的内容列 + 页签带 + 标题行 + 内容区。
 * 间距与字号只用 `theme.ts` 的刻度变量。
 *
 * 列表条目（`.buka-workflows-card`）的背景只在内容列内，不再用负 margin
 * 外扩：两个页面既是滚动容器又带 `overflow-x:hidden`，外扩的部分会被裁掉，
 * 滚动条出现 / 消失时右侧还会跟着抖。滚动容器统一 `scrollbar-gutter:stable`，
 * 让滚动条一出现就预留槽位，切页签时版面不横移。
 */

/** 页面样式。 */
import { THEME } from './theme.ts'

export const CSS = `
${THEME}
.buka-workflows-home{box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-inset, clamp(24px,4vw,48px));background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;justify-content:center;overflow:hidden}
.buka-workflows-frame{width:100%;max-width:var(--buka-column, 1120px);min-height:0;display:flex;flex-direction:column}
.buka-workflows-homeTabList{width:fit-content;max-width:100%}
.buka-workflows-page{box-sizing:border-box;flex:1 1 auto;min-height:0;width:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}
.buka-workflows-page.is-graph{overflow:hidden}
.buka-workflows-head{box-sizing:border-box;flex:none;padding:calc(var(--buka-space-5, 24px) + var(--dsh-frame-top-clearance,0px)) 0 0;background:var(--dsw-alias-bg-base);z-index:2;position:sticky;top:0}
.buka-workflows-headInner{width:100%;display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
.buka-workflows-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-4, 16px);min-height:var(--buka-control-sm, 28px)}
.buka-workflows-barTabs{display:flex;align-items:center;min-width:0;flex:1 1 auto}
.buka-workflows-titleRow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:var(--buka-space-3, 12px) var(--buka-space-4, 16px);min-width:0}
.buka-workflows-titleGroup{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex:1 1 auto;flex-wrap:wrap}
.buka-workflows-title{font-size:var(--buka-text-page, 20px);font-weight:500;line-height:var(--buka-line-28, 28px);margin:0;overflow-wrap:anywhere}
.buka-workflows-titleMeta{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
.buka-workflows-titleSub{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);font-weight:400}
.buka-workflows-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
.buka-workflows-back{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.buka-workflows-back svg{transform:rotate(180deg)}
@media (hover:hover){.buka-workflows-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-back:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-tabs{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex:none;overflow-x:auto;overscroll-behavior-x:contain}
.buka-workflows-tabList{width:fit-content;max-width:100%}
.buka-workflows-body{box-sizing:border-box;width:100%;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:var(--buka-space-5, 24px) 0 var(--buka-space-7, 48px);animation:buka-enter var(--buka-motion, 160ms) var(--buka-ease, cubic-bezier(.2,0,0,1))}
.buka-workflows-body.is-graph{overflow:hidden;padding-bottom:0}
.buka-workflows-body.is-graph .buka-workflows-detail,.buka-workflows-body.is-graph .buka-workflows-definitionPane,.buka-workflows-body.is-graph .buka-workflows-graphPane{flex:1 1 auto;min-height:0}
.buka-workflows-more{position:relative;display:inline-flex}
.buka-workflows-moreSummary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;height:var(--buka-control-sm, 28px);padding:var(--buka-control-sm-pad, 0 10px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);background:0 0}
.buka-workflows-moreSummary::-webkit-details-marker{display:none}
.buka-workflows-moreMenu{animation:buka-pop var(--buka-motion-fast, 120ms) var(--buka-ease, cubic-bezier(.2,0,0,1));position:absolute;right:0;top:calc(100% + 4px);z-index:5;padding:var(--buka-space-2, 8px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgb(0 0 0 / 16%);min-width:120px}
.buka-workflows-statusWithDot{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);margin:0}
.buka-workflows-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workflows-emptyBox{display:flex;flex-direction:column;align-items:flex-start;gap:var(--buka-space-2, 8px);padding:var(--buka-space-2, 8px) 0}
.buka-workflows-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workflows-failure{color:var(--dsw-alias-state-error-primary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
.buka-workflows-failureBox{display:flex;flex-direction:column;align-items:flex-start;gap:var(--buka-space-3, 12px)}
.buka-workflows-inlineCode{font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);padding:1px var(--buka-space-1, 4px);overflow-wrap:anywhere;word-break:break-all}
.buka-workflows-pre{margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;width:100%;box-sizing:border-box}
.buka-workflows-pre.is-tall{max-height:360px}
.buka-workflows-pre.is-inline{max-height:160px;margin:2px 0}
.buka-workflows-smallButton{border-radius:var(--dsw-radius-md);height:var(--buka-control-sm, 28px);padding:var(--buka-control-sm-pad, 0 10px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-smallButton.is-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
.buka-workflows-toolbarButton{border-radius:var(--dsw-radius-md);height:var(--buka-control-sm, 28px);padding:var(--buka-control-sm-pad, 0 10px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-textButton{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm)}
.buka-workflows-textButton:hover{text-decoration:underline}
.buka-workflows-confirm{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workflows-confirmText{color:var(--dsw-alias-state-warn-primary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-notice{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
.buka-workflows-noticeText{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);flex:1 1 260px}
.buka-workflows-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.buka-workflows-listPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
.buka-workflows-jobsPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
.buka-workflows-tag{display:inline-flex;align-items:center;height:18px;padding:0 var(--buka-space-2, 8px);border-radius:999px;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.buka-workflows-resultMeta{margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-tertiary)}
.buka-workflows-card{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);box-sizing:border-box;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-md);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);width:100%;margin:0;font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-card:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-card:active{background:var(--dsw-alias-interactive-bg-active)}
.buka-workflows-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-card.is-disabled{opacity:.55}
.buka-workflows-cardHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workflows-cardTitleGroup{display:flex;align-items:center;gap:var(--buka-space-2, 8px);min-width:0;flex-wrap:wrap}
.buka-workflows-cardTitle{font-size:var(--buka-text-title, 14px);font-weight:500;line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere;min-width:0}
.buka-workflows-cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workflows-cardTags{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex:none;flex-wrap:wrap}
.buka-workflows-seq{flex:none;font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-tertiary);padding:1px var(--buka-space-1, 4px)}
.buka-workflows-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workflows-progress{display:block;width:100%;height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:2px}
.buka-workflows-progressBar{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
.buka-workflows-progressBar.is-completed{background:var(--dsw-alias-state-success-primary)}
.buka-workflows-progressBar.is-failed,.buka-workflows-progressBar.is-cancelled{background:var(--dsw-alias-state-error-primary)}
.buka-workflows-filters{display:flex;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
.buka-workflows-filter{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);height:28px;padding:0 var(--buka-space-3, 12px);border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);cursor:pointer}
@media (hover:hover){.buka-workflows-filter:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-filter.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
.buka-workflows-filterCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
.buka-workflows-filter.is-active .buka-workflows-filterCount{color:inherit}
.buka-workflows-detail{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);min-width:0}
.buka-workflows-section{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workflows-sectionTitle{font-size:var(--buka-text-section, 15px);font-weight:600;line-height:var(--buka-line-22, 22px);margin:0;color:var(--dsw-alias-label-primary)}
.buka-workflows-kv{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px)}
.buka-workflows-kvRow{display:flex;flex-wrap:wrap;gap:var(--buka-space-1, 4px) var(--buka-space-3, 12px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-kvKey{color:var(--dsw-alias-label-tertiary);flex:0 0 96px;min-width:0}
.buka-workflows-kvValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0;flex:1 1 auto}
.buka-workflows-values{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
.buka-workflows-valueRow{display:flex;flex-wrap:wrap;gap:var(--buka-space-1, 4px) var(--buka-space-3, 12px);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workflows-valueKey{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);color:var(--dsw-alias-label-tertiary);flex:0 0 96px;min-width:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-valueValue{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.buka-workflows-definitionPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0;min-height:0}
.buka-workflows-definitionToolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--buka-space-3, 12px);flex-wrap:wrap}
.buka-workflows-graphPane{display:flex;flex-direction:column;min-width:0;min-height:0}
.buka-workflows-graphViewport{display:flex;align-items:flex-start;justify-content:center;width:100%;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}
.buka-workflows-graphScaleBox{position:relative;flex:none;margin:auto}
.buka-workflows-graphFooter{flex:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--buka-space-2, 8px) var(--buka-space-5, 24px);padding:var(--buka-space-3, 12px) 0 var(--buka-space-3, 12px);border-top:0.5px solid var(--dsw-alias-border-l1)}
.buka-workflows-graphHint{margin:0;flex:1 1 240px;min-width:0}
.buka-workflows-graphCanvas{position:absolute;left:0;top:0;flex:none}
.buka-workflows-graphSvg{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:visible}
.buka-workflows-edge{fill:none;stroke:var(--dsw-alias-label-caption);stroke-width:1.5;stroke-linecap:round;opacity:.7;transition:opacity 140ms ease,stroke-width 140ms ease}
.buka-workflows-edgeGroup.is-back .buka-workflows-edge{stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:5 4;opacity:.9}
.buka-workflows-edge.is-taken{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2;opacity:1}
.buka-workflows-edgeGroup.is-selected .buka-workflows-edge{stroke:var(--dsw-alias-brand-primary);stroke-width:2.4;opacity:1}
.buka-workflows-hitPath{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
.buka-workflows-edgeArrow{fill:var(--dsw-alias-label-caption);opacity:.8;pointer-events:none;transition:opacity 140ms ease}
.buka-workflows-edgeArrow.is-back{fill:var(--dsw-alias-state-warn-primary)}
.buka-workflows-edgeArrow.is-taken{fill:var(--dsw-alias-brand-primary);opacity:1}
.buka-workflows-edgeLabel{fill:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);paint-order:stroke;stroke:var(--dsw-alias-bg-base);stroke-width:3px;stroke-linejoin:round;pointer-events:none;user-select:none;transition:fill 140ms ease}
.buka-workflows-edgeLabel.is-back{fill:var(--dsw-alias-state-warn-primary)}
.buka-workflows-edgeLabel.is-taken{fill:var(--dsw-alias-brand-primary)}
.buka-workflows-edgeGroup.is-hovered .buka-workflows-edgeLabel{fill:var(--dsw-alias-brand-primary);font-weight:600}
.buka-workflows-edgeGroup.is-hovered .buka-workflows-edge{stroke-width:2.4;opacity:1}
.buka-workflows-edgeGroup.is-hovered .buka-workflows-edgeArrow{opacity:1}
.buka-workflows-edgeGroup.is-dimmed .buka-workflows-edge{opacity:.5}
.buka-workflows-edgeGroup.is-dimmed .buka-workflows-edgeArrow{opacity:.5}
@media (prefers-reduced-motion:reduce){.buka-workflows-edge,.buka-workflows-edgeArrow,.buka-workflows-edgeLabel{transition:none}.buka-workflows-edgeTip{animation:none}}
.buka-workflows-edgeTip{position:fixed;z-index:30;max-width:min(280px,calc(100vw - 24px));padding:var(--buka-space-1, 4px) var(--buka-space-2, 8px);border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 14px rgb(0 0 0 / 14%);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);white-space:normal;overflow-wrap:anywhere;pointer-events:none;animation:buka-workflows-edgeTip-in 120ms ease-out}
.buka-workflows-edgeTip::before{content:'';position:absolute;left:-5px;top:50%;transform:translateY(-50%);border:5px solid transparent;border-right-color:var(--dsw-alias-bg-layer-1)}
.buka-workflows-edgeTip.is-flipped::before{left:auto;right:-5px;border-right-color:transparent;border-left-color:var(--dsw-alias-bg-layer-1)}
.buka-workflows-edgeTip.is-back{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}
@keyframes buka-workflows-edgeTip-in{from{opacity:0}to{opacity:1}}
.buka-workflows-nodeWrap{position:absolute;z-index:2}
.buka-workflows-node{position:relative;display:flex;align-items:center;gap:var(--buka-space-2, 8px);width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 10px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;overflow:visible}
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
.buka-workflows-nodeCorner{position:absolute;top:-8px;right:-6px;z-index:1;display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:16px;box-sizing:border-box;padding:0 var(--buka-space-1, 4px);border-radius:999px;font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);font-weight:600;line-height:var(--buka-line-16, 16px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base)}
.buka-workflows-nodeCorner.is-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-success-primary)}
.buka-workflows-nodeCorner.is-running{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-brand-primary)}
.buka-workflows-nodeCorner.is-waiting{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-nodeCorner.is-failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-error-primary)}
.buka-workflows-nodeAttention{position:absolute;top:-4px;left:-4px;z-index:2;width:8px;height:8px;box-sizing:border-box;border-radius:50%;background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base);pointer-events:none}
.buka-workflows-nodeLabel{font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-16, 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}

.buka-workflows-legend{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--buka-space-2, 8px) var(--buka-space-4, 16px);color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);min-width:0}
.buka-workflows-legendGroup{display:flex;flex-wrap:wrap;align-items:center;gap:var(--buka-space-2, 8px) var(--buka-space-3, 12px)}
.buka-workflows-legendItem{display:inline-flex;align-items:center;gap:var(--buka-space-1, 4px)}
.buka-workflows-legendNode{box-sizing:border-box;width:20px;height:10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2)}
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
.buka-workflows-boardPane{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-board{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:var(--buka-space-2, 8px)}
.buka-workflows-boardGrid{display:grid;grid-template-columns:148px repeat(5,minmax(150px,1fr));gap:var(--buka-space-2, 8px);min-width:940px}
.buka-workflows-boardDivider{grid-column:1/-1;height:0;border-top:1px dashed var(--dsw-alias-border-l2)}
.buka-workflows-boardHeader{display:contents}
.buka-workflows-boardRowHead{display:flex;flex-direction:column;gap:2px;padding:var(--buka-space-2, 8px) 0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
.buka-workflows-boardHeader>.buka-workflows-boardRowHead{background:transparent;padding-top:0}
.buka-workflows-boardColumnHead{font-size:var(--buka-text-code, 11px);font-weight:600;line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:0 2px var(--buka-space-1, 4px)}
.buka-workflows-boardColumnHead.is-ready{color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-boardRow{display:contents}
.buka-workflows-boardRowTitle{font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workflows-boardRowExecutor{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-boardRowMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
.buka-workflows-boardCell{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0;min-height:52px;padding:var(--buka-space-1, 4px);border-radius:var(--dsw-radius-sm);border:0.5px dashed var(--dsw-alias-border-l1)}
.buka-workflows-boardCell.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
.buka-workflows-boardCompact{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px)}
.buka-workflows-boardGroup{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px)}
.buka-workflows-boardGroupTitle{display:flex;align-items:center;gap:var(--buka-space-2, 8px);margin:0;font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary)}
.buka-workflows-boardGroupTitle.is-ready{color:var(--dsw-alias-state-warn-primary)}
.buka-workflows-boardGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px)}
.buka-workflows-taskList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
.buka-workflows-taskItem{display:flex;min-width:0}
.buka-workflows-taskItem>.buka-workflows-taskCard{width:100%}
.buka-workflows-taskCard{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);width:100%;box-sizing:border-box;text-align:left;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font:inherit;color:inherit;cursor:pointer}
@media (hover:hover){.buka-workflows-taskCard:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-workflows-taskCard:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.buka-workflows-taskCard.is-running{border-color:var(--dsw-alias-brand-primary)}
.buka-workflows-taskCard.is-ready{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent)}
.buka-workflows-taskCard.is-failed,.buka-workflows-taskCard.is-blocked{border-color:var(--dsw-alias-state-error-primary)}
.buka-workflows-taskCardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workflows-taskCardType{font-size:var(--buka-text-meta, 12px);font-weight:500;line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere;min-width:0}
.buka-workflows-taskCardPosition{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
.buka-workflows-taskCardMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-taskCardSummary{color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.buka-workflows-overview{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);min-width:0}
.buka-workflows-overviewCard{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0}
.buka-workflows-finalCard{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
.buka-workflows-finalHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workflows-inlineGroup{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workflows-outputsPane{display:flex;flex-direction:column;gap:var(--buka-space-5, 24px);min-width:0}
.buka-workflows-outputGroup{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workflows-outputGroupHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
.buka-workflows-outputGroupTitle{font-size:var(--buka-text-body, 13px);font-weight:600;line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
.buka-workflows-outputGroupCount{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);margin-left:auto}
.buka-workflows-asset{display:flex;align-items:flex-start;gap:var(--buka-space-3, 12px);flex-wrap:wrap;padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-assetMain{display:flex;flex-direction:column;gap:3px;min-width:180px;flex:1 1 auto}
.buka-workflows-assetActions{display:flex;align-items:center;gap:var(--buka-space-3, 12px);flex-wrap:wrap;flex:none}
.buka-workflows-attachmentList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
.buka-workflows-attachment{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-attachmentLink{display:inline;max-width:100%;margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-18, 18px);text-align:left;text-decoration:none;overflow-wrap:anywhere;cursor:pointer;border-radius:var(--dsw-radius-sm)}
@media (hover:hover){.buka-workflows-attachmentLink:hover{text-decoration:underline}}
.buka-workflows-attachmentMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);flex:none}
.buka-workflows-attachmentDescription{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);flex:1 1 auto;min-width:120px;overflow-wrap:anywhere}
.buka-workflows-attachmentDownload{margin-left:auto;color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:var(--buka-text-code, 11px);flex:none}
.buka-workflows-attachmentDownload:hover{text-decoration:underline}
.buka-workflows-depList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
.buka-workflows-depRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-depLink{margin:0;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:var(--buka-text-meta, 12px);cursor:pointer;text-align:left}
.buka-workflows-depLink:hover{text-decoration:underline}
.buka-workflows-depSummary{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);flex:1 1 100%;overflow-wrap:anywhere}
.buka-workflows-attemptList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
.buka-workflows-attempt{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2)}
.buka-workflows-attemptHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
.buka-workflows-attemptMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-result{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
.buka-workflows-actionRow{display:flex;flex-wrap:wrap;gap:var(--buka-space-2, 8px)}
.buka-workflows-select{width:100%;padding:var(--buka-space-2, 8px) var(--buka-space-2, 8px);border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-l0);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px)}
.buka-workflows-taskForm{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
.buka-workflows-contractBody{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);min-width:0}
.buka-workflows-contentCard{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);min-width:0}
.buka-workflows-markdown{min-width:0;white-space:normal}
.buka-workflows-tagRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap}
.buka-workflows-initialList{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);margin:0;padding:0;list-style:none}
.buka-workflows-initialRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-initialMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-clamped{display:flex;flex-direction:column;align-items:flex-start;gap:var(--buka-space-1, 4px);min-width:0}
.buka-workflows-clampedText{margin:0;width:100%;box-sizing:border-box;overflow-wrap:anywhere;white-space:pre-wrap}
.buka-workflows-clampedText.is-clamped{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:normal}
.buka-workflows-drawerText{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
.buka-workflows-required{color:var(--dsw-alias-state-warn-primary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
.buka-workflows-typeList{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-typeCard{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px);border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);min-width:0}
.buka-workflows-typeRowHead{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
.buka-workflows-typeName{font-size:var(--buka-text-body, 13px);font-weight:600;line-height:var(--buka-line-20, 20px);overflow-wrap:anywhere}
.buka-workflows-typeTags{display:inline-flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;margin-left:auto}
.buka-workflows-typeDesc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-contractStack{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-contractStack.is-tight{gap:var(--buka-space-1, 4px)}
.buka-workflows-contractBlock{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
.buka-workflows-contractLine{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--buka-space-1, 4px) var(--buka-space-3, 12px);align-items:start;min-width:0}
.buka-workflows-contractLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-18, 18px);white-space:nowrap;padding-top:2px}
.buka-workflows-contractValue{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
.buka-workflows-contractFields{display:flex;flex-wrap:wrap;gap:var(--buka-space-1, 4px) var(--buka-space-2, 8px);min-width:0}
.buka-workflows-contractField{display:inline-flex;align-items:baseline;gap:var(--buka-space-1, 4px);max-width:100%;padding:1px var(--buka-space-2, 8px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);min-width:0}
.buka-workflows-contractField .buka-workflows-inlineCode{flex:none;background:0;padding:0;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px)}
.buka-workflows-contractType{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);flex:none}
.buka-workflows-contractDesc{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-statStrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:1px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-border-l1);overflow:hidden}
.buka-workflows-stat{display:flex;flex-direction:column;gap:1px;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);background:var(--dsw-alias-bg-layer-1);min-width:0}
.buka-workflows-statValue{font-size:var(--buka-text-title, 14px);font-weight:600;line-height:var(--buka-line-20, 20px);color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.buka-workflows-statLabel{font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);color:var(--dsw-alias-label-tertiary)}
.buka-workflows-resultText{margin:0;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px);white-space:pre-wrap;overflow-wrap:anywhere}
.buka-workflows-resultBlock{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
.buka-workflows-subLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-code, 11px);font-weight:500;line-height:var(--buka-line-16, 16px)}
.buka-workflows-deliverable{padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 5%,transparent)}
.buka-workflows-field{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);min-width:0}
.buka-workflows-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);font-weight:500;line-height:var(--buka-line-18, 18px);display:flex;align-items:center;gap:var(--buka-space-1, 4px);flex-wrap:wrap}
.buka-workflows-fieldHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-input{width:100%}
.buka-workflows-textarea{box-sizing:border-box;width:100%;padding:var(--buka-space-2, 8px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);resize:vertical}
.buka-workflows-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workflows-formActions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--buka-space-2, 8px);margin-top:var(--buka-space-1, 4px)}
.buka-workflows-dialogForm{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px)}
.buka-workflows-dialogSection{display:flex;flex-direction:column;gap:var(--buka-space-2, 8px);padding:var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-dialogSectionTitle{margin:0;font-size:var(--buka-text-body, 13px);font-weight:600;line-height:var(--buka-line-20, 20px)}
.buka-workflows-restartTasks{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px)}
.buka-workflows-restartTaskList{margin:0;padding:0 0 0 var(--buka-space-4, 16px);display:flex;flex-direction:column;gap:2px}
.buka-workflows-restartTask{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workflows-avatar{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid transparent;line-height:1;user-select:none}
.buka-workflows-avatarMissing{background:var(--dsw-alias-fill-secondary);border-color:var(--dsw-alias-border-secondary);color:var(--dsw-alias-label-tertiary);font-weight:600}
.buka-workflows-drawer.buka-workflows-drawer{position:fixed;inset-block:0;right:0;left:auto;width:min(720px,100vw);max-width:none;max-height:none;height:auto;margin:0;padding:0;gap:0;border-radius:0;border-left:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgb(0 0 0 / 18%);display:flex;flex-direction:column;overflow:hidden;animation:buka-workflows-drawer-in 160ms ease-out}
.buka-workflows-inspector.buka-workflows-inspector{width:min(640px,100vw)}
.buka-workflows-nodeTasks.buka-workflows-nodeTasks{width:min(480px,100vw)}
@keyframes buka-workflows-drawer-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
@media (prefers-reduced-motion:reduce){.buka-workflows-drawer.buka-workflows-drawer{animation:none}}
@media (width<=767px){.buka-workflows-drawer.buka-workflows-drawer{width:100vw}}
.buka-workflows-drawerHead{flex:none;padding:var(--buka-space-4, 16px) var(--buka-space-5, 24px);border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.buka-workflows-drawerHeadRow{display:flex;align-items:flex-start;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-drawerHeading{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.buka-workflows-drawerAvatar{margin-top:3px}
.buka-workflows-drawerTitleRow{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex-wrap:wrap;min-width:0}
.buka-workflows-drawerTitle{flex:0 1 auto;min-width:0;margin:0;font-size:var(--buka-text-section, 15px);font-weight:600;line-height:var(--buka-line-22, 22px);overflow-wrap:anywhere}
.buka-workflows-drawerMeta{color:var(--dsw-alias-label-tertiary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);overflow-wrap:anywhere}
.buka-workflows-drawerActions{display:flex;align-items:center;gap:var(--buka-space-2, 8px);flex:none;margin-left:auto;min-width:0}
.buka-workflows-drawerDownload{display:inline-flex;align-items:center;gap:var(--buka-space-1, 4px);color:var(--dsw-alias-brand-primary);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);text-decoration:none;border-radius:var(--dsw-radius-sm)}
.buka-workflows-drawerDownload:hover{text-decoration:underline}
.buka-workflows-drawerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}
@media (hover:hover){.buka-workflows-drawerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-workflows-drawerBody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:var(--buka-space-4, 16px);overflow:auto;overscroll-behavior:contain;padding:var(--buka-space-4, 16px) var(--buka-space-4, 16px) var(--buka-space-5, 24px)}
.buka-workflows-drawerBody .buka-workflows-sectionTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-20, 20px)}
.buka-workflows-drawerTabbed{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-drawerTabBar{display:flex;align-items:center;min-width:0;overflow-x:auto;overscroll-behavior-x:contain}
.buka-workflows-drawerTabPanel{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px);min-width:0}
.buka-workflows-drawerStack{display:flex;flex-direction:column;gap:var(--buka-space-4, 16px);min-width:0}
.buka-workflows-sectionHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);overflow-wrap:anywhere}
.buka-workflows-fold{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-foldSummary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);font-size:var(--buka-text-meta, 12px);font-weight:600;line-height:var(--buka-line-20, 20px);border-radius:var(--dsw-radius-sm)}
.buka-workflows-foldSummary:hover{color:var(--dsw-alias-label-primary)}
.buka-workflows-fold[open] .buka-workflows-foldSummary{margin-bottom:var(--buka-space-2, 8px);color:var(--dsw-alias-label-primary)}
.buka-workflows-foldBody{display:flex;flex-direction:column;gap:var(--buka-space-3, 12px);min-width:0}
.buka-workflows-drawerImage{max-width:100%;height:auto;object-fit:contain;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.buka-workflows-drawerFrame{display:block;width:100%;min-height:420px;height:100%;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
@media (width<=767px){
.buka-workflows-title{font-size:18px;line-height:var(--buka-line-28, 28px)}
.buka-workflows-titleSub{flex:1 1 100%}
.buka-workflows-body{padding:var(--buka-space-5, 24px) 0 var(--buka-space-6, 32px)}
.buka-workflows-body.is-graph{padding-bottom:0}
.buka-workflows-graphFooter{gap:var(--buka-space-2, 8px);padding-bottom:var(--buka-space-2, 8px)}
.buka-workflows-legend{justify-content:flex-start;width:100%}
.buka-workflows-sectionTitle{font-size:var(--buka-text-title, 14px)}
.buka-workflows-overviewCard{padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px)}
.buka-workflows-valueRow{flex-direction:column;gap:2px}
}
.buka-workflows-unavailableNotice{display:flex;flex-direction:column;gap:var(--buka-space-1, 4px);margin:0 0 var(--buka-space-3, 12px);padding:var(--buka-space-3, 12px) var(--buka-space-3, 12px);border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-warning);background:var(--dsw-alias-fill-warning);color:var(--dsw-alias-label-primary)}
.buka-workflows-unavailableTitle{font-size:var(--buka-text-body, 13px);line-height:var(--buka-line-18, 18px)}
.buka-workflows-unavailableHint{margin:0;font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary)}
.buka-workflows-unavailableList{margin:0;padding-left:var(--buka-space-4, 16px);font-size:var(--buka-text-meta, 12px);line-height:var(--buka-line-18, 18px);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.buka-workflows-unavailableTag{display:inline-flex;align-items:center;padding:1px var(--buka-space-2, 8px);border-radius:999px;font-size:var(--buka-text-code, 11px);line-height:var(--buka-line-16, 16px);border:0.5px solid var(--dsw-alias-border-warning);color:var(--dsw-alias-label-warning)}
`
