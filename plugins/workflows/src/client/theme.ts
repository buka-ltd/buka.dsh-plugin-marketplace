/**
 * 界面刻度：间距、字号、内容列宽、控件尺寸与阴影的唯一出处。
 *
 * 两个页签（工作流 / 执行者）的样式字符串都只引用这里的变量，不再各自写
 * 一次性数值。刻度按 2px 网格收敛成固定档位：间距 {@link space} 六档、
 * 字号 {@link text} 六档，超出的数值一律就近落档。
 *
 * 变量挂在 `.buka-workflows-home`（两个页签共同的根节点）上，只对插件页面
 * 生效，不写 `:root`，避免影响宿主界面。
 *
 * @module @buka/dsh-plugin-workflows/client/theme
 */

/**
 * 刻度变量。数值含义见各分组注释；新增界面时先在这里找档位，找不到再加。
 */
export const THEME = `
.buka-workflows-home{
--buka-column:1120px;
--buka-inset:clamp(24px,4vw,48px);
--buka-space-1:4px;
--buka-space-2:8px;
--buka-space-3:12px;
--buka-space-4:16px;
--buka-space-5:24px;
--buka-space-6:32px;
--buka-space-7:48px;
--buka-text-page:20px;
--buka-text-section:15px;
--buka-text-title:14px;
--buka-text-body:13px;
--buka-text-meta:12px;
--buka-text-code:11px;
--buka-line-16:16px;
--buka-line-18:18px;
--buka-line-20:20px;
--buka-line-22:22px;
--buka-line-28:28px;
--buka-control-sm:28px;
--buka-control-md:36px;
--buka-control-sm-pad:0 10px;
--buka-control-md-pad:0 14px;
--buka-motion-fast:120ms;
--buka-motion:160ms;
--buka-ease:cubic-bezier(.2,0,0,1);
--buka-shadow-menu:0 8px 24px rgb(0 0 0 / 16%);
--buka-shadow-dialog:0 24px 64px rgb(0 0 0 / 24%);
--buka-overlay:rgb(17 20 28 / 24%);
}
/* 交互面一律带过渡：悬停 / 按下只改变背景或颜色，不做位移，避免抖动。 */
.buka-workflows-card,.buka-workflows-filter,.buka-workflows-back,.buka-workflows-taskCard,.buka-workflows-node,.buka-workflows-typesItem,.buka-workflows-drawerClose,.buka-workflows-foldSummary,.buka-workers-card,.buka-workers-iconButton,.buka-workers-avatarOption,.buka-workers-workspace,.buka-workers-candidate{transition:background-color var(--buka-motion-fast) var(--buka-ease),border-color var(--buka-motion-fast) var(--buka-ease),color var(--buka-motion-fast) var(--buka-ease),box-shadow var(--buka-motion-fast) var(--buka-ease),opacity var(--buka-motion-fast) var(--buka-ease)}
/* 进入动画只做透明度：内容区在滚动容器里，任何 transform 都会临时撑大
   scrollable overflow，滚动条会跟着闪一条 5px 竖条。 */
@keyframes buka-enter{from{opacity:0}to{opacity:1}}
@keyframes buka-pop{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@media (width<=767px){.buka-workflows-home{--buka-inset:20px}}
@media (prefers-reduced-motion:reduce){.buka-workflows-home{--buka-motion-fast:0ms;--buka-motion:0ms}}
`
