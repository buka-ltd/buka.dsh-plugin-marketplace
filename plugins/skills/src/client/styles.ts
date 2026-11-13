/**
 * 页面的 CSS 常量。
 *
 * 结构与 Plugins 页面一致（标题行、Tab 行、960px 内容区、卡片列表），颜色与
 * 尺寸只用主题 token 和 DSH 的圆角/焦点 token。
 *
 * `.buka-skills-page` 自己就是滚动容器。DSH 的滚动条是**占位**的经典滚动条：
 * 「已安装」比视口高、出现滚动条，「收藏」没有；滚动条一出现/一消失，
 * 内容盒就窄/宽一个滚动条宽度，居中的标题、Tab 行和列表整体左右平移
 * 半个滚动条宽度——切 Tab 时看起来就是整页左右抖一下。`scrollbar-gutter:
 * stable` 常驻预留滚动条槽位，两个 Tab 内容盒等宽，版面不再跟着滚动条跳。
 *
 * @module @buka/dsh-plugin-skills/client/styles
 */

/** 页面样式。 */
const CSS = `
.buka-skills-page{--buka-skills-inset:clamp(24px,4vw,48px);box-sizing:border-box;height:100%;min-height:0;padding:0 var(--buka-skills-inset);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;overflow:hidden auto;scrollbar-gutter:stable;overscroll-behavior:contain}
@media (width<=767px){.buka-skills-page{--buka-skills-inset:20px}}
.buka-skills-head{box-sizing:border-box;width:calc(100% + 2 * var(--buka-skills-inset));max-width:none;margin-inline:calc(-1 * var(--buka-skills-inset));flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) var(--buka-skills-inset) 0;background:var(--dsw-alias-bg-base);z-index:1;position:sticky;top:0}
.buka-skills-headInner{width:100%;max-width:960px;margin-inline:auto;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px}
.buka-skills-heading{order:1;min-width:0;max-width:100%}
.buka-skills-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.buka-skills-toolbar{order:2;display:flex;align-items:center;gap:8px}
.buka-skills-tabs{flex:100%;order:3;display:flex}
.buka-skills-tabList{width:fit-content;min-width:240px}
@media (width<=372px){.buka-skills-tabList{min-width:0}}
.buka-skills-body{box-sizing:border-box;width:100%;max-width:960px;flex:none;display:flex;flex-direction:column;padding:32px 0 48px}
.buka-skills-panel{display:flex;flex-direction:column;gap:24px}
.buka-skills-status,.buka-skills-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-skills-statusWithDot{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.buka-skills-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;margin:0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.buka-skills-notice{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}
.buka-skills-notice>svg{color:var(--dsw-alias-state-warn-primary);flex:none;margin-top:2px}
.buka-skills-path{font-family:var(--ds-font-family-code);font-size:11px;overflow-wrap:anywhere}
.buka-skills-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.buka-skills-card{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px}
.buka-skills-cardHead{flex-direction:column;gap:4px;padding:8px;display:flex}
.buka-skills-titleRow{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}
.buka-skills-titleCluster{flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
.buka-skills-titleActions{flex:none;align-items:center;gap:8px;display:inline-flex}
.buka-skills-cardTitle{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
.buka-skills-cardLink{color:inherit;text-decoration:none;cursor:pointer}
@media (hover:hover){.buka-skills-cardLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}}
.buka-skills-cardLink:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.buka-skills-chevron{border-radius:var(--dsw-radius-sm);width:20px;height:20px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;margin-right:-2px;padding:0;display:inline-flex}
.buka-skills-chevron>svg{transition:transform .12s ease}
.buka-skills-chevron[aria-expanded=true]>svg{transform:rotate(90deg)}
@media (hover:hover){.buka-skills-chevron:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.buka-skills-chevron:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-skills-tree{margin:2px 0 0;padding:0 0 0 28px;list-style:none;display:flex;flex-direction:column;gap:1px}
.buka-skills-treeItem{min-width:0;flex-direction:column;gap:1px;display:flex}
.buka-skills-treeToggle{box-sizing:border-box;width:100%;min-width:0;gap:6px;padding:2px 6px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;font-size:13px;line-height:20px;display:flex;align-items:center}
.buka-skills-treeToggle>svg{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s ease}
.buka-skills-treeToggle[aria-expanded=true]>svg{transform:rotate(90deg)}
@media (hover:hover){.buka-skills-treeToggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.buka-skills-treeToggle:focus-visible{border-radius:var(--dsw-radius-sm);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.buka-skills-treeName{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.buka-skills-treeCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px}
.buka-skills-treeGroup{margin:0;padding:0 0 0 16px;list-style:none;flex-direction:column;gap:1px;display:flex}
.buka-skills-treeSkill{min-width:0;border-radius:var(--dsw-radius-sm);flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;padding:2px 6px;display:flex}
@media (hover:hover){.buka-skills-treeSkill:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-skills-treeSkillMain{min-width:0;flex:1 1 160px;flex-direction:column;display:flex}
.buka-skills-treeSkillName{min-width:0;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;line-height:20px}
.buka-skills-treeSkillDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:1;-webkit-box-orient:vertical;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere}
.buka-skills-treeSkillAction{flex:0 1 auto;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;display:flex}
.buka-skills-treeArea{flex-direction:column;gap:2px;display:flex}
.buka-skills-treeStatus{padding:2px 6px 2px 34px}
.buka-skills-treeFailure{gap:8px;padding:2px 6px 2px 34px;display:flex;flex-wrap:wrap;align-items:center}
.buka-skills-cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}
.buka-skills-meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.buka-skills-hint{color:var(--dsw-alias-state-warn-primary);margin:2px 0 0;font-size:12px;line-height:18px}
.buka-skills-danger{color:var(--dsw-alias-state-error-primary);--dsh-button-outline-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.buka-skills-toolbarButton{border-radius:var(--dsw-radius-md);height:32px;padding:0 12px;font-size:13px;line-height:20px}
.buka-skills-saveForm{display:flex;flex-direction:column;gap:16px}
.buka-skills-field{display:flex;flex-direction:column;gap:6px}
.buka-skills-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.buka-skills-fieldInput{box-sizing:border-box;display:flex;width:100%;min-width:0}
.buka-skills-formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.buka-skills-targetBody{flex-direction:column;gap:12px;display:flex}
.buka-skills-targetList{flex-direction:column;gap:4px;max-height:300px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}
.buka-skills-targetOption{box-sizing:border-box;width:100%;border:1px solid transparent;border-radius:var(--dsw-radius-md);background:0 0;color:inherit;text-align:left;cursor:pointer;font:inherit;flex-direction:column;gap:2px;padding:8px 10px;display:flex}
@media (hover:hover){.buka-skills-targetOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.buka-skills-targetOption:focus-visible{border-radius:var(--dsw-radius-md);outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.buka-skills-targetOption:disabled{cursor:default;opacity:.6}
.buka-skills-targetOption.isSelected{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}
.buka-skills-targetName{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.buka-skills-targetPath{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.buka-skills-targetHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.buka-skills-targetFailure{color:var(--dsw-alias-state-error-primary);align-items:flex-start;gap:8px;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.buka-skills-targetFailure>svg{flex:none;margin-top:2px}
`

export { CSS }
